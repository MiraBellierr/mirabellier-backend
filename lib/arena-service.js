const {
  ARENA_EFFECT_DEFAULTS,
  BASE_PROFILE,
  DAILY_CARD_DRAW_LIMIT,
  FIGHT_COOLDOWN_MS,
  LEVEL_UP_GAINS,
  RARITY_CONFIG,
  RARITY_ORDER,
  SHOP_ITEMS,
  SHOP_TIERS,
} = require("./arena-constants");
const { drawArenaCard, ensureArenaCardPool } = require("./arena-mal");

const CARD_IV_MIN = 0;
const CARD_IV_MAX = 31;
const CHARACTER_FAVORITES_MIN = 53;
const CHARACTER_FAVORITES_MAX = 178693;

const SHOP_ITEMS_BY_ID = new Map(SHOP_ITEMS.map((item) => [item.id, item]));
const RARITY_WEIGHT_SUM = RARITY_ORDER.reduce(
  (sum, rarity) => sum + Number(RARITY_CONFIG[rarity]?.weight || 0),
  0,
);
const RARITY_TO_RANK = new Map(RARITY_ORDER.map((rarity, index) => [rarity, index]));
const RARITY_PROGRESS_BANDS = (() => {
  let cursor = 0;
  return RARITY_ORDER.map((rarity) => {
    cursor += Number(RARITY_CONFIG[rarity]?.weight || 0) / RARITY_WEIGHT_SUM;
    return { rarity, upperBound: cursor };
  });
})();

class ArenaHttpError extends Error {
  constructor(status, message, code = "ARENA_ERROR", details = {}) {
    super(message);
    this.name = "ArenaHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value), min), max);
}

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function toPositiveInt(value, fallback = 0) {
  return Math.max(toInt(value, fallback), 0);
}

function randomInt(min, max, randomFn = Math.random) {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  if (high <= low) return low;
  return Math.floor(randomFn() * (high - low + 1)) + low;
}

function getCurrentRecordedDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function addDaysToRecordedDate(recordedDate, days) {
  const [year, month, day] = String(recordedDate || "")
    .split("-")
    .map((value) => Number(value));
  const nextDate = new Date(Date.UTC(year, month - 1, day));
  nextDate.setUTCDate(nextDate.getUTCDate() + Number(days || 0));
  return nextDate.toISOString().slice(0, 10);
}

function getNextCardDrawAt(lastCardDrawDate) {
  if (!lastCardDrawDate) return null;
  const nextDate = addDaysToRecordedDate(lastCardDrawDate, 1);
  return `${nextDate}T00:00:00.000Z`;
}

function xpToNext(level) {
  const currentLevel = Math.max(toInt(level, 1), 1);
  return 80 + 40 * currentLevel * currentLevel;
}

function normalizeArenaEffects(value) {
  let parsed = {};

  if (value && typeof value === "object") {
    parsed = value;
  } else if (typeof value === "string" && value.trim()) {
    try {
      const decoded = JSON.parse(value);
      if (decoded && typeof decoded === "object") {
        parsed = decoded;
      }
    } catch {
      parsed = {};
    }
  }

  return {
    expBoostPct: clamp(toPositiveInt(parsed.expBoostPct), 0, 200),
    expBoostWinsRemaining: toPositiveInt(parsed.expBoostWinsRemaining),
    coinBoostPct: clamp(toPositiveInt(parsed.coinBoostPct), 0, 200),
    coinBoostWinsRemaining: toPositiveInt(parsed.coinBoostWinsRemaining),
    refocusCharges: toPositiveInt(parsed.refocusCharges),
    streakShieldCharges: toPositiveInt(parsed.streakShieldCharges),
    upgradeLowestRarityCharges: toPositiveInt(parsed.upgradeLowestRarityCharges),
    guaranteeSsrPlusCharges: toPositiveInt(parsed.guaranteeSsrPlusCharges),
    ascensionLastPurchasedAt:
      typeof parsed.ascensionLastPurchasedAt === "string" &&
      parsed.ascensionLastPurchasedAt
        ? parsed.ascensionLastPurchasedAt
        : null,
  };
}

function serializeEffects(effects) {
  return JSON.stringify(normalizeArenaEffects(effects));
}

function rarityRank(rarity) {
  return RARITY_TO_RANK.get(rarity) ?? 0;
}

function rarityAtRank(rank) {
  const normalized = clamp(rank, 0, RARITY_ORDER.length - 1);
  return RARITY_ORDER[normalized];
}

function upgradeRarityOneStep(rarity) {
  return rarityAtRank(rarityRank(rarity) + 1);
}

function rollRarity(randomFn = Math.random) {
  const roll = randomFn() * RARITY_WEIGHT_SUM;
  let cursor = 0;

  for (const rarity of RARITY_ORDER) {
    cursor += Number(RARITY_CONFIG[rarity]?.weight || 0);
    if (roll < cursor) return rarity;
  }

  return "C";
}

function rarityFromFavorites(favorites, randomFn = Math.random) {
  const numeric = Number(favorites);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return rollRarity(randomFn);
  }

  const clampedFav = clamp(numeric, CHARACTER_FAVORITES_MIN, CHARACTER_FAVORITES_MAX);
  const low = Math.log(CHARACTER_FAVORITES_MIN);
  const high = Math.log(CHARACTER_FAVORITES_MAX);
  const progress = high > low ? (Math.log(clampedFav) - low) / (high - low) : 0;

  for (const band of RARITY_PROGRESS_BANDS) {
    if (progress < band.upperBound) {
      return band.rarity;
    }
  }

  return "UR";
}

function normalizeSelectedCard(value) {
  let source = null;

  if (value && typeof value === "object") {
    source = value;
  } else if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") {
        source = parsed;
      }
    } catch {
      source = null;
    }
  }

  if (!source) return null;

  const malId = toPositiveInt(source.malId, 0);
  const title = typeof source.title === "string" ? source.title : "";
  const imageUrl = typeof source.imageUrl === "string" ? source.imageUrl : "";
  if (!malId || !title || !imageUrl) return null;

  const rarity = typeof source.rarity === "string" ? source.rarity : "C";
  const iv = source.iv && typeof source.iv === "object" ? source.iv : {};
  const ivPower = clamp(toPositiveInt(iv.power, 0), CARD_IV_MIN, CARD_IV_MAX);
  const ivGuard = clamp(toPositiveInt(iv.guard, 0), CARD_IV_MIN, CARD_IV_MAX);
  const ivSpeed = clamp(toPositiveInt(iv.speed, 0), CARD_IV_MIN, CARD_IV_MAX);
  const ivLuck = clamp(toPositiveInt(iv.luck, 0), CARD_IV_MIN, CARD_IV_MAX);

  return {
    cardInstanceId:
      typeof source.cardInstanceId === "string" && source.cardInstanceId
        ? source.cardInstanceId
        : makeId("card"),
    malId,
    title,
    url: typeof source.url === "string" ? source.url : "",
    imageUrl,
    meanScore:
      source.meanScore === null || source.meanScore === undefined
        ? null
        : Number(source.meanScore),
    popularity:
      source.popularity === null || source.popularity === undefined
        ? null
        : Number(source.popularity),
    favorites:
      source.favorites === null || source.favorites === undefined
        ? null
        : Number(source.favorites),
    nsfw: typeof source.nsfw === "string" ? source.nsfw : null,
    rarity: RARITY_CONFIG[rarity] ? rarity : "C",
    iv: {
      power: ivPower,
      guard: ivGuard,
      speed: ivSpeed,
      luck: ivLuck,
      total: ivPower + ivGuard + ivSpeed + ivLuck,
    },
    drawnAt: typeof source.drawnAt === "string" ? source.drawnAt : null,
  };
}

function serializeSelectedCard(card) {
  if (!card) return null;
  return JSON.stringify(card);
}

function insertCollectionCard(db, userId, card) {
  if (!card || !card.cardInstanceId) return;
  const now = nowIso();
  db.prepare(
    `INSERT OR IGNORE INTO arena_card_collection (
      id,
      userId,
      cardInstanceId,
      cardJson,
      createdAt,
      updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    makeId("collection"),
    userId,
    card.cardInstanceId,
    JSON.stringify(card),
    now,
    now,
  );
}

function readCollectionCards(db, userId, limit = 200) {
  const rows = db
    .prepare(
      `SELECT cardJson
       FROM arena_card_collection
       WHERE userId = ?
       ORDER BY createdAt DESC
       LIMIT ?`,
    )
    .all(userId, clamp(toPositiveInt(limit, 200), 1, 500));

  return rows
    .map((row) => normalizeSelectedCard(row.cardJson))
    .filter(Boolean);
}

function createDrawnCard(malCard, options = {}, randomFn = Math.random) {
  const rarity = options.rarity || rarityFromFavorites(malCard.favorites, randomFn);
  const ivMin = Number.isFinite(options.ivMin) ? Number(options.ivMin) : CARD_IV_MIN;
  const ivMax = Number.isFinite(options.ivMax) ? Number(options.ivMax) : CARD_IV_MAX;
  const ivPower = randomInt(ivMin, ivMax, randomFn);
  const ivGuard = randomInt(ivMin, ivMax, randomFn);
  const ivSpeed = randomInt(ivMin, ivMax, randomFn);
  const ivLuck = randomInt(ivMin, ivMax, randomFn);

  return {
    cardInstanceId: makeId("card"),
    malId: toPositiveInt(malCard.malId, 0),
    title: malCard.title,
    url: malCard.url,
    imageUrl: malCard.imageUrl,
    meanScore:
      malCard.meanScore === null || malCard.meanScore === undefined
        ? null
        : Number(malCard.meanScore),
    popularity:
      malCard.popularity === null || malCard.popularity === undefined
        ? null
        : Number(malCard.popularity),
    favorites:
      malCard.favorites === null || malCard.favorites === undefined
        ? null
        : Number(malCard.favorites),
    nsfw: typeof malCard.nsfw === "string" ? malCard.nsfw : null,
    rarity,
    iv: {
      power: ivPower,
      guard: ivGuard,
      speed: ivSpeed,
      luck: ivLuck,
      total: ivPower + ivGuard + ivSpeed + ivLuck,
    },
    drawnAt: nowIso(),
  };
}

function mapArenaProfileRow(row) {
  if (!row) return null;

  return {
    userId: row.userId,
    level: Math.max(toInt(row.level, BASE_PROFILE.level), 1),
    xp: Math.max(toInt(row.xp, BASE_PROFILE.xp), 0),
    coins: Math.max(toInt(row.coins, BASE_PROFILE.coins), 0),
    wins: Math.max(toInt(row.wins, BASE_PROFILE.wins), 0),
    losses: Math.max(toInt(row.losses, BASE_PROFILE.losses), 0),
    winStreak: Math.max(toInt(row.winStreak, BASE_PROFILE.winStreak), 0),
    hp: Math.max(toInt(row.hp, BASE_PROFILE.hp), 1),
    power: Math.max(toInt(row.power, BASE_PROFILE.power), 1),
    guard: Math.max(toInt(row.guard, BASE_PROFILE.guard), 1),
    speed: Math.max(toInt(row.speed, BASE_PROFILE.speed), 1),
    luck: Math.max(toInt(row.luck, BASE_PROFILE.luck), 1),
    lifetimeCoinsEarned: Math.max(
      toInt(row.lifetimeCoinsEarned, BASE_PROFILE.lifetimeCoinsEarned),
      0,
    ),
    selectedCard: normalizeSelectedCard(row.selectedCardJson),
    lastCardDrawDate:
      typeof row.lastCardDrawDate === "string" && row.lastCardDrawDate
        ? row.lastCardDrawDate
        : null,
    dailyCardDrawCount: Math.max(toInt(row.dailyCardDrawCount, 0), 0),
    effects: normalizeArenaEffects(row.effectsJson || ARENA_EFFECT_DEFAULTS),
    lastFightAt: row.lastFightAt || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
}

function createArenaProfile(db, userId) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO arena_profiles (
      userId,
      level,
      xp,
      coins,
      wins,
      losses,
      winStreak,
      hp,
      power,
      guard,
      speed,
      luck,
      lifetimeCoinsEarned,
      selectedCardJson,
      lastCardDrawDate,
      dailyCardDrawCount,
      effectsJson,
      lastFightAt,
      createdAt,
      updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    BASE_PROFILE.level,
    BASE_PROFILE.xp,
    BASE_PROFILE.coins,
    BASE_PROFILE.wins,
    BASE_PROFILE.losses,
    BASE_PROFILE.winStreak,
    BASE_PROFILE.hp,
    BASE_PROFILE.power,
    BASE_PROFILE.guard,
    BASE_PROFILE.speed,
    BASE_PROFILE.luck,
    BASE_PROFILE.lifetimeCoinsEarned,
    null,
    null,
    0,
    serializeEffects(ARENA_EFFECT_DEFAULTS),
    null,
    now,
    now,
  );
}

function ensureArenaProfile(db, userId) {
  let row = db.prepare("SELECT * FROM arena_profiles WHERE userId = ?").get(userId);
  if (!row) {
    createArenaProfile(db, userId);
    row = db.prepare("SELECT * FROM arena_profiles WHERE userId = ?").get(userId);
  }
  return mapArenaProfileRow(row);
}

function getInventoryRows(db, userId) {
  return db
    .prepare(
      `SELECT id, userId, itemId, quantity, createdAt, updatedAt
       FROM arena_inventory
       WHERE userId = ?
       ORDER BY createdAt ASC`,
    )
    .all(userId);
}

function getInventoryMap(db, userId) {
  const rows = getInventoryRows(db, userId);
  const inventory = new Map();
  rows.forEach((row) => {
    const quantity = Math.max(toInt(row.quantity, 0), 0);
    if (quantity > 0) {
      inventory.set(row.itemId, {
        id: row.id,
        itemId: row.itemId,
        quantity,
        createdAt: row.createdAt || null,
        updatedAt: row.updatedAt || null,
      });
    }
  });
  return inventory;
}

function getEquippedRows(db, userId) {
  return db
    .prepare(
      `SELECT userId, slot, itemId, equippedAt
       FROM arena_equipment
       WHERE userId = ?`,
    )
    .all(userId);
}

function computeEquipmentStats(equippedRows) {
  const stats = {
    hp: 0,
    power: 0,
    guard: 0,
    speed: 0,
    luck: 0,
  };
  const equipped = {
    weapon: null,
    armor: null,
    charm: null,
  };

  equippedRows.forEach((row) => {
    const item = SHOP_ITEMS_BY_ID.get(row.itemId);
    if (!item || item.type !== "gear" || !item.slot) return;

    equipped[item.slot] = {
      itemId: item.id,
      name: item.name,
      slot: item.slot,
      tier: item.tier,
      stats: item.stats || {},
      equippedAt: row.equippedAt || null,
    };

    const itemStats = item.stats || {};
    stats.hp += toInt(itemStats.hp, 0);
    stats.power += toInt(itemStats.power, 0);
    stats.guard += toInt(itemStats.guard, 0);
    stats.speed += toInt(itemStats.speed, 0);
    stats.luck += toInt(itemStats.luck, 0);
  });

  return {
    equipped,
    stats,
  };
}

function weightedEquipmentBonus(stats) {
  return (
    stats.power * 2.0 +
    stats.guard * 1.7 +
    stats.speed * 1.5 +
    stats.luck * 1.0
  );
}

function getDailyCardDrawsUsed(profile, date = getCurrentRecordedDate()) {
  if (profile.lastCardDrawDate !== date) return 0;

  const explicitCount = Math.max(toInt(profile.dailyCardDrawCount, 0), 0);
  if (explicitCount > 0) {
    return clamp(explicitCount, 0, DAILY_CARD_DRAW_LIMIT);
  }

  // Backward compatibility for rows created before dailyCardDrawCount existed.
  return profile.selectedCard ? 1 : 0;
}

function canDrawDailyCard(profile) {
  return getDailyCardDrawsUsed(profile) < DAILY_CARD_DRAW_LIMIT;
}

function toPublicProfile(profile, equipmentStats, equippedItems, options = {}) {
  const totalFights = profile.wins + profile.losses;
  const nextXp = xpToNext(profile.level);
  const dailyDrawsUsed = getDailyCardDrawsUsed(profile);
  const canDrawCard = dailyDrawsUsed < DAILY_CARD_DRAW_LIMIT;

  return {
    userId: profile.userId,
    level: profile.level,
    xp: profile.xp,
    xpToNext: nextXp,
    xpProgress: nextXp > 0 ? profile.xp / nextXp : 0,
    coins: profile.coins,
    wins: profile.wins,
    losses: profile.losses,
    totalFights,
    winRate: totalFights > 0 ? profile.wins / totalFights : 0,
    winStreak: profile.winStreak,
    stats: {
      base: {
        hp: profile.hp,
        power: profile.power,
        guard: profile.guard,
        speed: profile.speed,
        luck: profile.luck,
      },
      equipment: equipmentStats,
      total: {
        hp: profile.hp + equipmentStats.hp,
        power: profile.power + equipmentStats.power,
        guard: profile.guard + equipmentStats.guard,
        speed: profile.speed + equipmentStats.speed,
        luck: profile.luck + equipmentStats.luck,
      },
    },
    selectedCard: profile.selectedCard,
    canDrawCard,
    dailyDrawLimit: DAILY_CARD_DRAW_LIMIT,
    dailyDrawsUsed,
    dailyDrawsRemaining: Math.max(DAILY_CARD_DRAW_LIMIT - dailyDrawsUsed, 0),
    nextCardDrawAt: canDrawCard ? null : getNextCardDrawAt(profile.lastCardDrawDate),
    lastCardDrawDate: profile.lastCardDrawDate,
    lifetimeCoinsEarned: profile.lifetimeCoinsEarned,
    effects: profile.effects,
    equipment: equippedItems,
    lastFightAt: profile.lastFightAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    ...options,
  };
}

function readRecentFights(db, userId, limit = 10) {
  const rows = db
    .prepare(
      `SELECT id, opponentUserId, result, roundsJson, xpDelta, coinDelta, createdAt
       FROM arena_fights
       WHERE userId = ?
       ORDER BY createdAt DESC
       LIMIT ?`,
    )
    .all(userId, clamp(toPositiveInt(limit, 10), 1, 25));

  return rows.map((row) => {
    let rounds = [];
    try {
      const parsed = JSON.parse(row.roundsJson || "[]");
      rounds = Array.isArray(parsed) ? parsed : [];
    } catch {
      rounds = [];
    }

    return {
      id: row.id,
      opponentUserId: row.opponentUserId,
      result: row.result,
      rounds,
      xpDelta: toInt(row.xpDelta, 0),
      coinDelta: toInt(row.coinDelta, 0),
      createdAt: row.createdAt || null,
    };
  });
}

function getArenaProfilePayload(db, userId) {
  const profile = ensureArenaProfile(db, userId);
  const equippedRows = getEquippedRows(db, userId);
  const { equipped, stats: equipmentStats } = computeEquipmentStats(equippedRows);
  const recentFights = readRecentFights(db, userId, 10);

  return toPublicProfile(profile, equipmentStats, equipped, {
    recentFights,
  });
}

function getArenaCollectionPayload(db, userId, options = {}) {
  const limit = clamp(toPositiveInt(options.limit, 200), 1, 500);
  return {
    profile: getArenaProfilePayload(db, userId),
    cards: readCollectionCards(db, userId, limit),
    limit,
  };
}

function selectCollectionCard(db, userId, cardInstanceId) {
  const normalizedCardInstanceId = String(cardInstanceId || "").trim();
  if (!normalizedCardInstanceId) {
    throw new ArenaHttpError(
      400,
      "cardInstanceId is required.",
      "ARENA_CARD_INSTANCE_REQUIRED",
    );
  }

  ensureArenaProfile(db, userId);
  const row = db
    .prepare(
      `SELECT cardJson
       FROM arena_card_collection
       WHERE userId = ? AND cardInstanceId = ?
       LIMIT 1`,
    )
    .get(userId, normalizedCardInstanceId);

  if (!row) {
    throw new ArenaHttpError(
      404,
      "Card not found in your collection.",
      "ARENA_COLLECTION_CARD_NOT_FOUND",
    );
  }

  const selectedCard = normalizeSelectedCard(row.cardJson);
  if (!selectedCard) {
    throw new ArenaHttpError(
      409,
      "Stored card data is invalid.",
      "ARENA_COLLECTION_CARD_INVALID",
    );
  }

  db.prepare(
    `UPDATE arena_profiles
     SET selectedCardJson = ?, updatedAt = ?
     WHERE userId = ?`,
  ).run(serializeSelectedCard(selectedCard), nowIso(), userId);

  return {
    selectedCard,
    profile: getArenaProfilePayload(db, userId),
  };
}

function metadataBonuses(card) {
  const mean = Number(card?.meanScore);
  const popularity = Number(card?.popularity);
  const malScoreBonus = Number.isFinite(mean) ? clamp((mean - 6) * 4, 0, 16) : 0;
  const popularityBonus = Number.isFinite(popularity)
    ? clamp((2500 - popularity) / 250, 0, 10)
    : 0;

  return {
    malScoreBonus,
    popularityBonus,
  };
}

function cardIvStatBonus(card) {
  const iv = card?.iv && typeof card.iv === "object" ? card.iv : {};
  return {
    hp:
      Math.floor(clamp(toPositiveInt(iv.guard, 0), CARD_IV_MIN, CARD_IV_MAX) / 2) +
      Math.floor(clamp(toPositiveInt(iv.luck, 0), CARD_IV_MIN, CARD_IV_MAX) / 2),
    power: Math.floor(clamp(toPositiveInt(iv.power, 0), CARD_IV_MIN, CARD_IV_MAX) / 3),
    guard: Math.floor(clamp(toPositiveInt(iv.guard, 0), CARD_IV_MIN, CARD_IV_MAX) / 3),
    speed: Math.floor(clamp(toPositiveInt(iv.speed, 0), CARD_IV_MIN, CARD_IV_MAX) / 3),
    luck: Math.floor(clamp(toPositiveInt(iv.luck, 0), CARD_IV_MIN, CARD_IV_MAX) / 3),
  };
}

function calculateRoundPower(input) {
  const {
    power,
    guard,
    speed,
    luck,
    equipmentBonus,
    rarity,
    card,
    randomFn = Math.random,
  } = input;

  const rarityPower = Number(RARITY_CONFIG[rarity]?.powerBonus || 0);
  const { malScoreBonus, popularityBonus } = metadataBonuses(card);
  const noise = randomInt(-10, 10, randomFn);

  return {
    value:
      power * 2.0 +
      guard * 1.7 +
      speed * 1.5 +
      luck * 1.0 +
      equipmentBonus +
      rarityPower +
      malScoreBonus +
      popularityBonus +
      noise,
    breakdown: {
      rarityPower,
      malScoreBonus,
      popularityBonus,
      noise,
    },
  };
}

function resolveRoundWinner(input) {
  const { playerPower, opponentPower, playerSpeed, opponentSpeed, randomFn } = input;
  if (playerPower > opponentPower) return "player";
  if (opponentPower > playerPower) return "opponent";
  if (playerSpeed > opponentSpeed) return "player";
  if (opponentSpeed > playerSpeed) return "opponent";
  return (randomFn || Math.random)() >= 0.5 ? "player" : "opponent";
}

function applyLevelUps(profile) {
  let leveledUp = 0;
  let nextThreshold = xpToNext(profile.level);

  while (profile.xp >= nextThreshold) {
    profile.xp -= nextThreshold;
    profile.level += 1;
    profile.hp += LEVEL_UP_GAINS.hp;
    profile.power += LEVEL_UP_GAINS.power;
    profile.guard += LEVEL_UP_GAINS.guard;
    profile.speed += LEVEL_UP_GAINS.speed;
    profile.luck += LEVEL_UP_GAINS.luck;
    leveledUp += 1;
    nextThreshold = xpToNext(profile.level);
  }

  return leveledUp;
}

function calculateWinXp(opponentLevel, roundsWon, currentWinStreak) {
  return (
    10 +
    Math.floor(opponentLevel * 1.2) +
    toInt(roundsWon, 0) * 2 +
    Math.min(toInt(currentWinStreak, 0), 10)
  );
}

function calculateWinCoins(opponentLevel, rarityCoinReward, totalLuck) {
  return (
    18 +
    toInt(opponentLevel, 0) * 3 +
    toInt(rarityCoinReward, 0) +
    Math.floor(toInt(totalLuck, 0) / 5)
  );
}

function assertFightCooldown(profile) {
  const parsed = Date.parse(profile.lastFightAt || "");
  if (!Number.isFinite(parsed)) return;
  const elapsed = Date.now() - parsed;
  if (elapsed >= FIGHT_COOLDOWN_MS) return;

  throw new ArenaHttpError(
    429,
    "Fight cooldown active. Please wait a few seconds before fighting again.",
    "ARENA_FIGHT_COOLDOWN",
    { retryAfterMs: FIGHT_COOLDOWN_MS - elapsed },
  );
}

function loadCombatSnapshot(db, profile, options = {}) {
  const equippedRows = getEquippedRows(db, profile.userId);
  const { equipped, stats: equipmentStats } = computeEquipmentStats(equippedRows);
  const selectedCard = normalizeSelectedCard(options.overrideCard || profile.selectedCard);
  const cardStats = selectedCard
    ? cardIvStatBonus(selectedCard)
    : { hp: 0, power: 0, guard: 0, speed: 0, luck: 0 };

  return {
    profile,
    equipped,
    equipmentStats,
    equipmentBonus: weightedEquipmentBonus(equipmentStats),
    selectedCard,
    rarity: selectedCard?.rarity || "C",
    baseStats: {
      hp: profile.hp + cardStats.hp,
      power: profile.power + cardStats.power,
      guard: profile.guard + cardStats.guard,
      speed: profile.speed + cardStats.speed,
      luck: profile.luck + cardStats.luck,
    },
    totalStats: {
      hp: profile.hp + equipmentStats.hp + cardStats.hp,
      power: profile.power + equipmentStats.power + cardStats.power,
      guard: profile.guard + equipmentStats.guard + cardStats.guard,
      speed: profile.speed + equipmentStats.speed + cardStats.speed,
      luck: profile.luck + equipmentStats.luck + cardStats.luck,
    },
  };
}

function consumeWinBoosts(effects, xpGain, coinGain) {
  let nextXp = xpGain;
  let nextCoins = coinGain;

  if (effects.expBoostWinsRemaining > 0 && effects.expBoostPct > 0) {
    nextXp = Math.floor(nextXp * (1 + effects.expBoostPct / 100));
    effects.expBoostWinsRemaining = Math.max(effects.expBoostWinsRemaining - 1, 0);
    if (effects.expBoostWinsRemaining === 0) effects.expBoostPct = 0;
  }

  if (effects.coinBoostWinsRemaining > 0 && effects.coinBoostPct > 0) {
    nextCoins = Math.floor(nextCoins * (1 + effects.coinBoostPct / 100));
    effects.coinBoostWinsRemaining = Math.max(effects.coinBoostWinsRemaining - 1, 0);
    if (effects.coinBoostWinsRemaining === 0) effects.coinBoostPct = 0;
  }

  return {
    xpGain: Math.max(toInt(nextXp, 0), 0),
    coinGain: Math.max(toInt(nextCoins, 0), 0),
  };
}

function applyFightEffectUsage(effects, effectUsage) {
  const next = normalizeArenaEffects(effects);

  if (effectUsage.usedRefocus && next.refocusCharges > 0) {
    next.refocusCharges -= 1;
  }
  if (effectUsage.usedUpgradeLowest && next.upgradeLowestRarityCharges > 0) {
    next.upgradeLowestRarityCharges -= 1;
  }
  if (effectUsage.usedGuaranteeSsrPlus && next.guaranteeSsrPlusCharges > 0) {
    next.guaranteeSsrPlusCharges -= 1;
  }

  return next;
}

function getWonRoundRarityCoinReward(simulation) {
  if (!simulation?.playerWon) return 0;
  return Number(RARITY_CONFIG[simulation.playerRarity]?.coinReward || 0);
}

function toCombatName(input, fallback) {
  if (typeof input === "string" && input.trim()) return input.trim();
  return fallback;
}

function computeMaxHp(stats) {
  const hpBase = toInt(stats?.hp, 1);
  const guardBonus = Math.floor(toInt(stats?.guard, 0) * 2.2);
  const utilityBonus = Math.floor(
    (toInt(stats?.power, 0) + toInt(stats?.speed, 0) + toInt(stats?.luck, 0)) * 0.2,
  );
  return Math.max(30, hpBase + guardBonus + utilityBonus);
}

function computeEvasionChance(attackerStats, defenderStats) {
  return clamp(
    0.04 +
      toInt(defenderStats?.speed, 0) * 0.002 +
      toInt(defenderStats?.luck, 0) * 0.0015 -
      toInt(attackerStats?.speed, 0) * 0.001,
    0.02,
    0.32,
  );
}

function calculateAttackOutcome(input) {
  const {
    attackerStats,
    defenderStats,
    attackerRarity,
    randomFn = Math.random,
  } = input;

  const evasionChance = computeEvasionChance(attackerStats, defenderStats);
  if (randomFn() < evasionChance) {
    return {
      avoided: true,
      critical: false,
      damage: 0,
    };
  }

  const rarityPower = Number(RARITY_CONFIG[attackerRarity]?.powerBonus || 0);
  const attackRoll =
    toInt(attackerStats?.power, 0) * 1.8 +
    toInt(attackerStats?.speed, 0) * 0.7 +
    toInt(attackerStats?.luck, 0) * 0.4 +
    rarityPower * 0.65 +
    randomInt(-6, 12, randomFn);
  const defenseRoll =
    toInt(defenderStats?.guard, 0) * 1.6 +
    toInt(defenderStats?.speed, 0) * 0.35 +
    toInt(defenderStats?.luck, 0) * 0.25 +
    randomInt(-4, 8, randomFn);

  let damage = Math.max(1, Math.floor(attackRoll - defenseRoll * 0.55));
  const critChance = clamp(0.05 + toInt(attackerStats?.luck, 0) * 0.0035, 0.05, 0.3);
  const critical = randomFn() < critChance;
  if (critical) {
    damage = Math.max(1, Math.floor(damage * 1.5));
  }

  return {
    avoided: false,
    critical,
    damage,
  };
}

function chooseRandomOpponent(db, userId) {
  const row = db
    .prepare(
      `SELECT p.*
       FROM arena_profiles p
       JOIN users u ON u.id = p.userId
       WHERE p.userId <> ? AND p.selectedCardJson IS NOT NULL
       ORDER BY RANDOM()
       LIMIT 1`,
    )
    .get(userId);

  return mapArenaProfileRow(row);
}

async function buildNpcOpponent(db) {
  const malCard = await drawArenaCard(db);
  const npcCard = createDrawnCard(
    malCard,
    { rarity: "C", ivMin: 8, ivMax: 18 },
  );

  return {
    userId: "npc:training-slime",
    level: 1,
    xp: 0,
    coins: 0,
    wins: 0,
    losses: 0,
    winStreak: 0,
    hp: 95,
    power: 10,
    guard: 10,
    speed: 8,
    luck: 5,
    lifetimeCoinsEarned: 0,
    selectedCard: npcCard,
    lastCardDrawDate: getCurrentRecordedDate(),
    effects: normalizeArenaEffects(ARENA_EFFECT_DEFAULTS),
    lastFightAt: null,
    createdAt: null,
    updatedAt: null,
    isNpc: true,
    displayName: "Training Slime",
  };
}

async function selectOpponentForFight(db, userId) {
  const realOpponent = chooseRandomOpponent(db, userId);
  if (realOpponent) {
    const user = db
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(realOpponent.userId);
    return {
      profile: realOpponent,
      isNpc: false,
      displayName: user?.username || "Unknown",
    };
  }

  const npc = await buildNpcOpponent(db);
  return {
    profile: npc,
    isNpc: true,
    displayName: npc.displayName,
  };
}

async function simulateFight(db, input) {
  const { player, opponent, playerEffects, randomFn = Math.random } = input;

  if (!player.selectedCard) {
    throw new ArenaHttpError(
      409,
      "Draw a card to start fighting.",
      "ARENA_CARD_REQUIRED",
    );
  }

  if (!opponent.selectedCard) {
    throw new ArenaHttpError(
      409,
      "No valid opponent card available.",
      "ARENA_OPPONENT_CARD_MISSING",
    );
  }

  let playerCard = player.selectedCard;
  let playerRarity = player.rarity;
  const playerBaseStats = { ...player.baseStats };
  const playerTotalStats = { ...player.totalStats };
  const opponentCard = opponent.selectedCard;
  const opponentRarity = opponent.rarity;
  const playerName = toCombatName(playerCard.title, "Player");
  const opponentName = toCombatName(opponentCard.title, "Opponent");

  let usedGuaranteeSsrPlus = false;
  if (playerEffects.guaranteeSsrPlusCharges > 0 && rarityRank(playerRarity) < 3) {
    playerRarity = "SSR";
    usedGuaranteeSsrPlus = true;
  } else if (playerEffects.guaranteeSsrPlusCharges > 0) {
    usedGuaranteeSsrPlus = true;
  }

  let usedUpgradeLowest = false;
  if (playerEffects.upgradeLowestRarityCharges > 0) {
    playerRarity = upgradeRarityOneStep(playerRarity);
    usedUpgradeLowest = true;
  }

  let usedRefocus = false;
  if (playerEffects.refocusCharges > 0) {
    const rerolledCard = createDrawnCard(await drawArenaCard(db));
    const previousBonus = cardIvStatBonus(playerCard);
    const nextBonus = cardIvStatBonus(rerolledCard);
    playerBaseStats.hp += nextBonus.hp - previousBonus.hp;
    playerBaseStats.power += nextBonus.power - previousBonus.power;
    playerBaseStats.guard += nextBonus.guard - previousBonus.guard;
    playerBaseStats.speed += nextBonus.speed - previousBonus.speed;
    playerBaseStats.luck += nextBonus.luck - previousBonus.luck;
    playerTotalStats.hp += nextBonus.hp - previousBonus.hp;
    playerTotalStats.power += nextBonus.power - previousBonus.power;
    playerTotalStats.guard += nextBonus.guard - previousBonus.guard;
    playerTotalStats.speed += nextBonus.speed - previousBonus.speed;
    playerTotalStats.luck += nextBonus.luck - previousBonus.luck;
    playerCard = rerolledCard;
    playerRarity = rerolledCard.rarity;
    usedRefocus = true;
  }

  const turns = [];
  const battleConsole = [];
  const maxPlayerHp = computeMaxHp(playerTotalStats);
  const maxOpponentHp = computeMaxHp(opponent.totalStats);
  let playerHp = maxPlayerHp;
  let opponentHp = maxOpponentHp;
  let turnCounter = 0;

  const pushConsole = (line) => {
    battleConsole.push({
      line,
      playerHp,
      opponentHp,
    });
  };

  const runAttack = (attackerSide) => {
    if (playerHp <= 0 || opponentHp <= 0) return;
    turnCounter += 1;

    const attackerIsPlayer = attackerSide === "player";
    const attackerName = attackerIsPlayer ? playerName : opponentName;
    const defenderName = attackerIsPlayer ? opponentName : playerName;
    const attackerStats = attackerIsPlayer ? playerTotalStats : opponent.totalStats;
    const defenderStats = attackerIsPlayer ? opponent.totalStats : playerTotalStats;
    const attackerRarity = attackerIsPlayer ? playerRarity : opponentRarity;

    pushConsole(`${attackerName} attacked ${defenderName}`);
    const outcome = calculateAttackOutcome({
      attackerStats,
      defenderStats,
      attackerRarity,
      randomFn,
    });

    if (outcome.avoided) {
      pushConsole(`${defenderName} avoided the attack`);
      turns.push({
        turn: turnCounter,
        attacker: attackerSide,
        attackerName,
        defender: attackerIsPlayer ? "opponent" : "player",
        defenderName,
        attackerRarity,
        avoided: true,
        critical: false,
        damage: 0,
        playerHp,
        opponentHp,
      });
      return;
    }

    if (attackerIsPlayer) {
      opponentHp = Math.max(0, opponentHp - outcome.damage);
    } else {
      playerHp = Math.max(0, playerHp - outcome.damage);
    }

    pushConsole(`${defenderName} took ${outcome.damage} HP`);
    if (outcome.critical) {
      pushConsole(`${attackerName} landed a critical hit`);
    }

    turns.push({
      turn: turnCounter,
      attacker: attackerSide,
      attackerName,
      defender: attackerIsPlayer ? "opponent" : "player",
      defenderName,
      attackerRarity,
      avoided: false,
      critical: outcome.critical,
      damage: outcome.damage,
      playerHp,
      opponentHp,
    });
  };

  const maxTurns = 60;
  while (playerHp > 0 && opponentHp > 0 && turnCounter < maxTurns) {
    const playerActsFirst =
      playerTotalStats.speed + randomInt(0, 8, randomFn) >=
      opponent.totalStats.speed + randomInt(0, 8, randomFn);

    if (playerActsFirst) {
      runAttack("player");
      if (opponentHp <= 0) break;
      runAttack("opponent");
    } else {
      runAttack("opponent");
      if (playerHp <= 0) break;
      runAttack("player");
    }
  }

  let playerWon = false;
  if (playerHp <= 0 && opponentHp <= 0) {
    playerWon =
      resolveRoundWinner({
        playerPower: playerTotalStats.power,
        opponentPower: opponent.totalStats.power,
        playerSpeed: playerTotalStats.speed,
        opponentSpeed: opponent.totalStats.speed,
        randomFn,
      }) === "player";
    if (playerWon) {
      playerHp = Math.max(playerHp, 1);
      opponentHp = 0;
    } else {
      opponentHp = Math.max(opponentHp, 1);
      playerHp = 0;
    }
  } else if (opponentHp <= 0) {
    playerWon = true;
  } else if (playerHp <= 0) {
    playerWon = false;
  } else {
    playerWon =
      resolveRoundWinner({
        playerPower: playerHp,
        opponentPower: opponentHp,
        playerSpeed: playerTotalStats.speed,
        opponentSpeed: opponent.totalStats.speed,
        randomFn,
      }) === "player";
    if (playerWon) {
      opponentHp = 0;
    } else {
      playerHp = 0;
    }
  }

  const xpRoundsWon = clamp(4 - Math.ceil(turnCounter / 6), 1, 3);
  const winnerName = playerWon ? playerName : opponentName;
  pushConsole(`${winnerName} wins the battle`);

  return {
    rounds: turns,
    battle: {
      maxHp: {
        player: maxPlayerHp,
        opponent: maxOpponentHp,
      },
      finalHp: {
        player: playerHp,
        opponent: opponentHp,
      },
      turns,
      console: battleConsole,
    },
    playerRoundsWon: playerWon ? 1 : 0,
    opponentRoundsWon: playerWon ? 0 : 1,
    xpRoundsWon,
    playerRarity,
    playerWon,
    effectUsage: {
      usedRefocus,
      usedUpgradeLowest,
      usedGuaranteeSsrPlus,
    },
  };
}

async function runFight(db, userId) {
  await ensureArenaCardPool(db);

  const profile = ensureArenaProfile(db, userId);
  if (!profile.selectedCard) {
    throw new ArenaHttpError(
      409,
      "Draw a card to start.",
      "ARENA_CARD_REQUIRED",
    );
  }

  assertFightCooldown(profile);

  const opponentSelection = await selectOpponentForFight(db, userId);
  const opponentProfile = opponentSelection.profile;

  const playerSnapshot = loadCombatSnapshot(db, profile);
  const opponentSnapshot = loadCombatSnapshot(db, opponentProfile);
  const simulation = await simulateFight(db, {
    player: playerSnapshot,
    opponent: opponentSnapshot,
    playerEffects: profile.effects,
  });

  const now = nowIso();
  const tx = db.transaction(() => {
    const current = ensureArenaProfile(db, userId);
    if (!current.selectedCard) {
      throw new ArenaHttpError(409, "Draw a card to start.", "ARENA_CARD_REQUIRED");
    }
    assertFightCooldown(current);

    const effects = applyFightEffectUsage(current.effects, simulation.effectUsage);
    const currentSnapshot = loadCombatSnapshot(db, current);
    const rarityCoinReward = getWonRoundRarityCoinReward(simulation);
    let xpDelta = 1;
    let coinDelta = 0;

    if (simulation.playerWon) {
      const baseXp = calculateWinXp(
        opponentSnapshot.profile.level,
        simulation.xpRoundsWon,
        current.winStreak,
      );
      const baseCoins = calculateWinCoins(
        opponentSnapshot.profile.level,
        rarityCoinReward,
        currentSnapshot.totalStats.luck,
      );
      const adjusted = consumeWinBoosts(effects, baseXp, baseCoins);
      xpDelta = adjusted.xpGain;
      coinDelta = adjusted.coinGain;
      current.wins += 1;
      current.winStreak += 1;
    } else {
      current.losses += 1;
      if (effects.streakShieldCharges > 0) {
        effects.streakShieldCharges -= 1;
      } else {
        current.winStreak = 0;
      }
    }

    current.xp += xpDelta;
    current.coins += coinDelta;
    current.lifetimeCoinsEarned += coinDelta;
    const levelsGained = applyLevelUps(current);
    current.effects = effects;
    current.lastFightAt = now;
    current.updatedAt = now;

    db.prepare(
      `UPDATE arena_profiles
       SET level = ?,
           xp = ?,
           coins = ?,
           wins = ?,
           losses = ?,
           winStreak = ?,
           hp = ?,
           power = ?,
           guard = ?,
           speed = ?,
           luck = ?,
           lifetimeCoinsEarned = ?,
           effectsJson = ?,
           lastFightAt = ?,
           updatedAt = ?
       WHERE userId = ?`,
    ).run(
      current.level,
      current.xp,
      current.coins,
      current.wins,
      current.losses,
      current.winStreak,
      current.hp,
      current.power,
      current.guard,
      current.speed,
      current.luck,
      current.lifetimeCoinsEarned,
      serializeEffects(current.effects),
      current.lastFightAt,
      current.updatedAt,
      current.userId,
    );

    db.prepare(
      `INSERT INTO arena_fights (
        id,
        userId,
        opponentUserId,
        result,
        roundsJson,
        xpDelta,
        coinDelta,
        createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      makeId("fight"),
      current.userId,
      opponentSnapshot.profile.userId,
      simulation.playerWon ? "win" : "loss",
      JSON.stringify(simulation.rounds),
      xpDelta,
      coinDelta,
      now,
    );

    return {
      levelsGained,
      xpDelta,
      coinDelta,
      rarityCoinReward,
    };
  });

  const result = tx();
  const refreshed = getArenaProfilePayload(db, userId);

  return {
    result: simulation.playerWon ? "win" : "loss",
    opponent: {
      userId: opponentSnapshot.profile.userId,
      displayName: opponentSelection.displayName,
      isNpc: opponentSelection.isNpc,
      level: opponentSnapshot.profile.level,
      stats: opponentSnapshot.totalStats,
      equipment: opponentSnapshot.equipped,
      selectedCard: opponentSnapshot.selectedCard,
    },
    battle: simulation.battle,
    rounds: simulation.rounds,
    score: {
      player: simulation.playerRoundsWon,
      opponent: simulation.opponentRoundsWon,
    },
    rewards: {
      xp: result.xpDelta,
      coins: result.coinDelta,
      rarityCoinReward: result.rarityCoinReward,
      levelsGained: result.levelsGained,
    },
    effectUsage: simulation.effectUsage,
    profile: refreshed,
  };
}

async function drawDailyCard(db, userId) {
  await ensureArenaCardPool(db);
  const malCard = await drawArenaCard(db);
  const drawnCard = createDrawnCard(malCard);
  const today = getCurrentRecordedDate();
  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    const drawsUsedToday = getDailyCardDrawsUsed(profile, today);

    if (drawsUsedToday >= DAILY_CARD_DRAW_LIMIT) {
      throw new ArenaHttpError(
        409,
        `You can only draw ${DAILY_CARD_DRAW_LIMIT} cards per day.`,
        "ARENA_DAILY_DRAW_LIMIT",
        { nextDrawAt: getNextCardDrawAt(profile.lastCardDrawDate) },
      );
    }

    const nextDrawCount = profile.lastCardDrawDate === today ? drawsUsedToday + 1 : 1;

    db.prepare(
      `UPDATE arena_profiles
       SET selectedCardJson = ?, lastCardDrawDate = ?, dailyCardDrawCount = ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(serializeSelectedCard(drawnCard), today, nextDrawCount, nowIso(), userId);

    insertCollectionCard(db, userId, drawnCard);
  });

  tx();
  return {
    card: drawnCard,
    profile: getArenaProfilePayload(db, userId),
  };
}

function upsertInventoryItem(db, userId, itemId, quantityDelta) {
  const existing = db
    .prepare(
      `SELECT id, quantity
       FROM arena_inventory
       WHERE userId = ? AND itemId = ?
       LIMIT 1`,
    )
    .get(userId, itemId);
  const now = nowIso();

  if (!existing) {
    if (quantityDelta <= 0) {
      throw new ArenaHttpError(400, "Inventory quantity cannot go below zero.");
    }
    db.prepare(
      `INSERT INTO arena_inventory (id, userId, itemId, quantity, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(makeId("inv"), userId, itemId, quantityDelta, now, now);
    return quantityDelta;
  }

  const nextQuantity = toInt(existing.quantity, 0) + toInt(quantityDelta, 0);
  if (nextQuantity < 0) {
    throw new ArenaHttpError(400, "Inventory quantity cannot go below zero.");
  }

  if (nextQuantity === 0) {
    db.prepare("DELETE FROM arena_inventory WHERE id = ?").run(existing.id);
    return 0;
  }

  db.prepare("UPDATE arena_inventory SET quantity = ?, updatedAt = ? WHERE id = ?").run(
    nextQuantity,
    now,
    existing.id,
  );
  return nextQuantity;
}

function upsertEquippedItem(db, userId, slot, itemId) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO arena_equipment (userId, slot, itemId, equippedAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(userId, slot) DO UPDATE SET
       itemId = excluded.itemId,
       equippedAt = excluded.equippedAt`,
  ).run(userId, slot, itemId, now);
}

function buildShopCatalog(profile, inventoryMap, equippedRows) {
  const equippedBySlot = {};
  equippedRows.forEach((row) => {
    equippedBySlot[row.slot] = row.itemId;
  });

  const items = SHOP_ITEMS.map((item) => {
    const ownedQuantity = inventoryMap.get(item.id)?.quantity || 0;
    const isOwned = ownedQuantity > 0 || item.type === "instant";
    const unlocked = profile.level >= item.unlockLevel;
    const isEquipped =
      item.type === "gear" && item.slot ? equippedBySlot[item.slot] === item.id : false;
    const canBuyLevel = unlocked;
    const canBuyCoins = profile.coins >= item.price;
    const isAscension = item.effect?.kind === "ascension";

    let cooldownEndsAt = null;
    if (isAscension && profile.effects.ascensionLastPurchasedAt) {
      const parsed = Date.parse(profile.effects.ascensionLastPurchasedAt);
      if (Number.isFinite(parsed)) {
        const cooldownMs = Number(item.effect.cooldownDays || 7) * 24 * 60 * 60 * 1000;
        const cooldownEnds = parsed + cooldownMs;
        if (cooldownEnds > Date.now()) {
          cooldownEndsAt = new Date(cooldownEnds).toISOString();
        }
      }
    }

    return {
      ...item,
      ownedQuantity,
      isOwned,
      isEquipped,
      unlocked,
      canBuy: canBuyLevel && canBuyCoins && !cooldownEndsAt,
      cooldownEndsAt,
    };
  });

  return SHOP_TIERS.map((tier) => ({
    tier,
    items: items.filter((item) => item.tier === tier),
  }));
}

function getArenaShopPayload(db, userId) {
  const profile = ensureArenaProfile(db, userId);
  const inventoryMap = getInventoryMap(db, userId);
  const equippedRows = getEquippedRows(db, userId);
  const shop = buildShopCatalog(profile, inventoryMap, equippedRows);
  const equipped = computeEquipmentStats(equippedRows).equipped;

  return {
    profile: getArenaProfilePayload(db, userId),
    shop,
    equipped,
  };
}

function enforceAscensionCooldown(profile, item) {
  const cooldownDays = Number(item?.effect?.cooldownDays || 7);
  const previous = profile.effects.ascensionLastPurchasedAt;
  if (!previous) return;
  const parsed = Date.parse(previous);
  if (!Number.isFinite(parsed)) return;
  const cooldownEndsAt = parsed + cooldownDays * 24 * 60 * 60 * 1000;
  if (cooldownEndsAt > Date.now()) {
    throw new ArenaHttpError(
      409,
      "Ascension Scroll can only be purchased once every 7 days.",
      "ARENA_ASCENSION_COOLDOWN",
      { cooldownEndsAt: new Date(cooldownEndsAt).toISOString() },
    );
  }
}

function buyShopItem(db, userId, itemId) {
  const item = SHOP_ITEMS_BY_ID.get(itemId);
  if (!item) {
    throw new ArenaHttpError(404, "Item not found.", "ARENA_ITEM_NOT_FOUND");
  }

  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    if (profile.level < item.unlockLevel) {
      throw new ArenaHttpError(403, "Level too low for this item.", "ARENA_ITEM_LOCKED");
    }

    if (profile.coins < item.price) {
      throw new ArenaHttpError(400, "Not enough coins.", "ARENA_NOT_ENOUGH_COINS");
    }

    if (item.type === "instant" && item.effect?.kind === "ascension") {
      enforceAscensionCooldown(profile, item);
    }

    const inventory = getInventoryMap(db, userId);
    const ownedQuantity = inventory.get(item.id)?.quantity || 0;
    if (item.type === "gear" && ownedQuantity > 0) {
      throw new ArenaHttpError(
        409,
        "Gear is already owned. Equip your current copy instead.",
        "ARENA_GEAR_ALREADY_OWNED",
      );
    }

    profile.coins -= item.price;
    profile.updatedAt = nowIso();

    let appliedInstantly = false;
    const effects = normalizeArenaEffects(profile.effects);
    if (item.type === "gear") {
      upsertInventoryItem(db, userId, item.id, 1);
      upsertEquippedItem(db, userId, item.slot, item.id);
    } else if (item.type === "consumable") {
      upsertInventoryItem(db, userId, item.id, 1);
    } else if (item.type === "instant" && item.effect?.kind === "ascension") {
      profile.hp += 1;
      profile.power += 1;
      profile.guard += 1;
      profile.speed += 1;
      profile.luck += 1;
      effects.ascensionLastPurchasedAt = profile.updatedAt;
      appliedInstantly = true;
    }

    db.prepare(
      `UPDATE arena_profiles
       SET coins = ?,
           hp = ?,
           power = ?,
           guard = ?,
           speed = ?,
           luck = ?,
           effectsJson = ?,
           updatedAt = ?
       WHERE userId = ?`,
    ).run(
      profile.coins,
      profile.hp,
      profile.power,
      profile.guard,
      profile.speed,
      profile.luck,
      serializeEffects(effects),
      profile.updatedAt,
      userId,
    );

    return {
      item,
      appliedInstantly,
    };
  });

  const result = tx();
  return {
    purchasedItemId: result.item.id,
    appliedInstantly: result.appliedInstantly,
    shop: getArenaShopPayload(db, userId),
  };
}

function applyConsumableEffect(profile, item) {
  const effect = item.effect || {};
  const effects = normalizeArenaEffects(profile.effects);

  if (effect.kind === "exp_boost") {
    effects.expBoostPct = Math.max(effects.expBoostPct, toPositiveInt(effect.pct, 0));
    effects.expBoostWinsRemaining += toPositiveInt(effect.wins, 0);
  } else if (effect.kind === "coin_boost") {
    effects.coinBoostPct = Math.max(effects.coinBoostPct, toPositiveInt(effect.pct, 0));
    effects.coinBoostWinsRemaining += toPositiveInt(effect.wins, 0);
  } else if (effect.kind === "refocus_reroll") {
    effects.refocusCharges += toPositiveInt(effect.charges, 1);
  } else if (effect.kind === "streak_shield") {
    effects.streakShieldCharges += toPositiveInt(effect.charges, 1);
  } else if (effect.kind === "upgrade_lowest_rarity") {
    effects.upgradeLowestRarityCharges += toPositiveInt(effect.charges, 1);
  } else if (effect.kind === "guarantee_ssr_plus") {
    effects.guaranteeSsrPlusCharges += toPositiveInt(effect.charges, 1);
  } else {
    throw new ArenaHttpError(400, "Unsupported consumable effect.");
  }

  return effects;
}

function useConsumable(db, userId, itemId) {
  const item = SHOP_ITEMS_BY_ID.get(itemId);
  if (!item || item.type !== "consumable") {
    throw new ArenaHttpError(404, "Consumable not found.", "ARENA_CONSUMABLE_NOT_FOUND");
  }

  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    const inventory = getInventoryMap(db, userId);
    const owned = inventory.get(item.id)?.quantity || 0;
    if (owned <= 0) {
      throw new ArenaHttpError(
        400,
        "Consumable is not owned.",
        "ARENA_CONSUMABLE_NOT_OWNED",
      );
    }

    upsertInventoryItem(db, userId, item.id, -1);
    const nextEffects = applyConsumableEffect(profile, item);
    const updatedAt = nowIso();

    db.prepare(
      "UPDATE arena_profiles SET effectsJson = ?, updatedAt = ? WHERE userId = ?",
    ).run(serializeEffects(nextEffects), updatedAt, userId);

    return {
      item,
      effects: nextEffects,
    };
  });

  const result = tx();
  return {
    activatedItemId: result.item.id,
    effects: result.effects,
    shop: getArenaShopPayload(db, userId),
  };
}

function parseLeaderboardLimit(input) {
  const limit = toPositiveInt(input, 50);
  return clamp(limit || 50, 1, 100);
}

function getLeaderboard(db, metric, limitInput) {
  const limit = parseLeaderboardLimit(limitInput);
  const normalizedMetric = String(metric || "level").toLowerCase();

  if (!["level", "win_rate", "rich"].includes(normalizedMetric)) {
    throw new ArenaHttpError(
      400,
      "Invalid leaderboard metric. Use level, win_rate, or rich.",
      "ARENA_INVALID_LEADERBOARD_METRIC",
    );
  }

  let rows = [];
  if (normalizedMetric === "level") {
    rows = db
      .prepare(
        `SELECT
           p.userId,
           u.username,
           u.avatar,
           p.level,
           p.xp,
           p.coins,
           p.wins,
           p.losses,
           p.winStreak,
           p.lifetimeCoinsEarned,
           p.updatedAt,
           (p.wins + p.losses) AS totalFights,
           CASE WHEN (p.wins + p.losses) > 0
             THEN CAST(p.wins AS REAL) / CAST((p.wins + p.losses) AS REAL)
             ELSE 0 END AS winRate,
           CASE WHEN (80 + 40 * p.level * p.level) > 0
             THEN CAST(p.xp AS REAL) / CAST((80 + 40 * p.level * p.level) AS REAL)
             ELSE 0 END AS xpProgress
         FROM arena_profiles p
         JOIN users u ON u.id = p.userId
         ORDER BY p.level DESC, xpProgress DESC, p.wins DESC, p.updatedAt ASC
         LIMIT ?`,
      )
      .all(limit);
  } else if (normalizedMetric === "win_rate") {
    rows = db
      .prepare(
        `SELECT
           p.userId,
           u.username,
           u.avatar,
           p.level,
           p.xp,
           p.coins,
           p.wins,
           p.losses,
           p.winStreak,
           p.lifetimeCoinsEarned,
           p.updatedAt,
           (p.wins + p.losses) AS totalFights,
           CASE WHEN (p.wins + p.losses) > 0
             THEN CAST(p.wins AS REAL) / CAST((p.wins + p.losses) AS REAL)
             ELSE 0 END AS winRate,
           CASE WHEN (80 + 40 * p.level * p.level) > 0
             THEN CAST(p.xp AS REAL) / CAST((80 + 40 * p.level * p.level) AS REAL)
             ELSE 0 END AS xpProgress
         FROM arena_profiles p
         JOIN users u ON u.id = p.userId
         WHERE (p.wins + p.losses) >= 50
         ORDER BY winRate DESC, totalFights DESC, p.level DESC, p.updatedAt ASC
         LIMIT ?`,
      )
      .all(limit);
  } else if (normalizedMetric === "rich") {
    rows = db
      .prepare(
        `SELECT
           p.userId,
           u.username,
           u.avatar,
           p.level,
           p.xp,
           p.coins,
           p.wins,
           p.losses,
           p.winStreak,
           p.lifetimeCoinsEarned,
           p.updatedAt,
           (p.wins + p.losses) AS totalFights,
           CASE WHEN (p.wins + p.losses) > 0
             THEN CAST(p.wins AS REAL) / CAST((p.wins + p.losses) AS REAL)
             ELSE 0 END AS winRate,
           CASE WHEN (80 + 40 * p.level * p.level) > 0
             THEN CAST(p.xp AS REAL) / CAST((80 + 40 * p.level * p.level) AS REAL)
             ELSE 0 END AS xpProgress
         FROM arena_profiles p
         JOIN users u ON u.id = p.userId
         ORDER BY p.coins DESC, p.lifetimeCoinsEarned DESC, p.level DESC, p.updatedAt ASC
         LIMIT ?`,
      )
      .all(limit);
  }

  return {
    metric: normalizedMetric,
    limit,
    entries: rows.map((row, index) => ({
      rank: index + 1,
      user: {
        id: row.userId,
        username: row.username,
        avatar: row.avatar || null,
      },
      level: toInt(row.level, 1),
      xp: toInt(row.xp, 0),
      xpToNext: xpToNext(toInt(row.level, 1)),
      xpProgress: Number(row.xpProgress || 0),
      wins: toInt(row.wins, 0),
      losses: toInt(row.losses, 0),
      totalFights: toInt(row.totalFights, 0),
      winRate: Number(row.winRate || 0),
      coins: toInt(row.coins, 0),
      lifetimeCoinsEarned: toInt(row.lifetimeCoinsEarned, 0),
      updatedAt: row.updatedAt || null,
    })),
  };
}

module.exports = {
  ArenaHttpError,
  calculateRoundPower,
  calculateWinCoins,
  calculateWinXp,
  drawDailyCard,
  getArenaCollectionPayload,
  getArenaProfilePayload,
  getArenaShopPayload,
  getCurrentRecordedDate,
  getLeaderboard,
  normalizeArenaEffects,
  rarityFromFavorites,
  rollRarity,
  runFight,
  selectCollectionCard,
  resolveRoundWinner,
  useConsumable,
  buyShopItem,
  xpToNext,
};
