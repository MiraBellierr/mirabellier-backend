const {
  ARENA_EFFECT_DEFAULTS,
  BASE_PROFILE,
  CATALOG_VERSION,
  DAILY_CARD_DRAW_LIMIT,
  FIGHT_COOLDOWN_MS,
  LEGACY_ITEM_DEFINITIONS,
  LEGACY_ITEM_MAP,
  LEVEL_UP_GAINS,
  RARITY_CONFIG,
  RARITY_ORDER,
  SHOP_ITEMS,
  SHOP_RECIPES,
  SHOP_TIERS,
} = require("./arena-constants");
const {
  drawArenaCard,
  ensureArenaCardPool,
  getArenaCharacterCatalog,
  rarityFromCharacterRank,
} = require("./arena-characters");
const {
  SKILL_TREE_BRANCHES,
  SKILL_TREE_NODES,
  SKILL_TREE_NODES_BY_ID,
  computeSkillBonuses,
} = require("./arena-skill-tree");

const CARD_IV_MIN = 0;
const CARD_IV_MAX = 31;
const CARD_SHOP_DAILY_OFFER_COUNT = 5;
const CARD_SHOP_PRICES = Object.freeze({
  C: 50,
  R: 100,
  SR: 1000,
  SSR: 5000,
  UR: 10000,
});
const CARD_SHOP_MAX_PRICE = Math.max(...Object.values(CARD_SHOP_PRICES));
const CARD_SHOP_RANDOM_PRICE = 500;
const CARD_SHOP_GENERATION_ATTEMPTS = 60;

const SHOP_ITEMS_BY_ID = new Map(SHOP_ITEMS.map((item) => [item.id, item]));
const SHOP_RECIPES_BY_ID = new Map(SHOP_RECIPES.map((recipe) => [recipe.id, recipe]));
const TIER_TO_INDEX = new Map(SHOP_TIERS.map((tier, index) => [tier, index]));
const FIGHT_MATERIAL_POOLS = SHOP_TIERS.slice(0, 3).map((tier) =>
  SHOP_ITEMS.filter((item) => item.type === "material" && item.tier === tier),
);
const SLOT_ORDER = ["weapon", "armor", "charm"];
const RARITY_TO_RANK = new Map(RARITY_ORDER.map((rarity, index) => [rarity, index]));

function tierToIndex(tier) {
  return TIER_TO_INDEX.get(tier) ?? 0;
}

function getCardShopPrice(rarity) {
  const normalizedRarity = String(rarity || "").trim().toUpperCase();
  return CARD_SHOP_PRICES[normalizedRarity] ?? CARD_SHOP_MAX_PRICE;
}

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
    rerollKeepHigherCharges: toPositiveInt(
      parsed.rerollKeepHigherCharges ?? parsed.refocusCharges,
    ),
    streakShieldCharges: toPositiveInt(parsed.streakShieldCharges),
    upgradeLowestRarityCharges: toPositiveInt(parsed.upgradeLowestRarityCharges),
    guaranteeSsrPlusCharges: toPositiveInt(parsed.guaranteeSsrPlusCharges),
    ascensionLastPurchasedAt:
      typeof parsed.ascensionLastPurchasedAt === "string" &&
      parsed.ascensionLastPurchasedAt
        ? parsed.ascensionLastPurchasedAt
        : null,
    fightStartShieldCharges: toPositiveInt(parsed.fightStartShieldCharges),
    fightStartShieldAmount: clamp(toPositiveInt(parsed.fightStartShieldAmount), 0, 9999),
    evadeBoostPct: clamp(toPositiveInt(parsed.evadeBoostPct), 0, 95),
    evadeBoostFightsRemaining: toPositiveInt(parsed.evadeBoostFightsRemaining),
    firstHitTrueDamageCharges: toPositiveInt(parsed.firstHitTrueDamageCharges),
    firstHitTrueDamageValue: clamp(toPositiveInt(parsed.firstHitTrueDamageValue), 0, 9999),
    higherRarityDamageBonusPctCharges: toPositiveInt(
      parsed.higherRarityDamageBonusPctCharges,
    ),
    higherRarityDamageBonusPct: clamp(
      toPositiveInt(parsed.higherRarityDamageBonusPct),
      0,
      300,
    ),
    gateKeyCharges: toPositiveInt(parsed.gateKeyCharges),
    doublePassiveTriggerFightsRemaining: toPositiveInt(
      parsed.doublePassiveTriggerFightsRemaining,
    ),
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

  const favorites =
    source.favorites === null || source.favorites === undefined
      ? null
      : Number(source.favorites);

  const storedRarity = typeof source.rarity === "string" ? source.rarity : "C";
  const baseRarity = RARITY_CONFIG[storedRarity] ? storedRarity : "C";
  const rarity = Number.isFinite(favorites) && favorites <= 0 ? "C" : baseRarity;
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
    favorites,
    nsfw: typeof source.nsfw === "string" ? source.nsfw : null,
    rarity,
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
  const catalogSize = Number(options.catalogSize);
  const rarity =
    options.rarity ||
    rarityFromCharacterRank(
      malCard.popularity,
      Number.isFinite(catalogSize) && catalogSize > 0
        ? catalogSize
        : getArenaCharacterCatalog().characters.length,
    );
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

function createPurchasedCard(card) {
  const normalized = normalizeSelectedCard(card);
  if (!normalized) return null;
  return {
    ...normalized,
    cardInstanceId: makeId("card"),
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
    catalogVersion:
      typeof row.catalogVersion === "string" && row.catalogVersion
        ? row.catalogVersion
        : "v1",
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
      catalogVersion,
      effectsJson,
      lastFightAt,
      createdAt,
      updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    CATALOG_VERSION,
    serializeEffects(ARENA_EFFECT_DEFAULTS),
    null,
    now,
    now,
  );
}

function mapLegacyItemId(itemId) {
  return LEGACY_ITEM_MAP[itemId] || itemId;
}

function chooseBestOwnedGearForSlot(quantitiesByItemId, slot) {
  let chosen = null;
  let chosenTier = -1;

  quantitiesByItemId.forEach((quantity, itemId) => {
    if (quantity <= 0) return;
    const item = SHOP_ITEMS_BY_ID.get(itemId);
    if (!item || item.type !== "gear" || item.slot !== slot) return;
    const itemTier = tierToIndex(item.tier);
    if (itemTier > chosenTier) {
      chosenTier = itemTier;
      chosen = item.id;
    }
  });

  return chosen;
}

function migrateProfileToCatalogV2(db, profile) {
  if (profile.catalogVersion === CATALOG_VERSION) return;

  const now = nowIso();
  const tx = db.transaction(() => {
    const inventoryRows = getInventoryRows(db, profile.userId);
    const equipmentRows = getEquippedRows(db, profile.userId);
    const mergedQuantities = new Map();
    let refundCoins = 0;

    inventoryRows.forEach((row) => {
      const quantity = Math.max(toInt(row.quantity, 0), 0);
      if (quantity <= 0) return;

      const sourceItemId = String(row.itemId || "");
      const targetItemId = mapLegacyItemId(sourceItemId);
      const targetItem = SHOP_ITEMS_BY_ID.get(targetItemId);
      if (!targetItem) return;

      if (targetItem.type === "gear") {
        const current = mergedQuantities.get(targetItemId) || 0;
        const keepable = Math.max(1 - current, 0);
        const keepQuantity = Math.min(quantity, keepable);
        const extraQuantity = quantity - keepQuantity;
        mergedQuantities.set(targetItemId, current + keepQuantity);
        if (extraQuantity > 0) {
          const sourceDef = LEGACY_ITEM_DEFINITIONS[sourceItemId] || targetItem;
          refundCoins += Math.floor(toInt(sourceDef.price, 0) * 0.4 * extraQuantity);
        }
      } else {
        mergedQuantities.set(
          targetItemId,
          (mergedQuantities.get(targetItemId) || 0) + quantity,
        );
      }
    });

    db.prepare("DELETE FROM arena_inventory WHERE userId = ?").run(profile.userId);
    mergedQuantities.forEach((quantity, itemId) => {
      if (quantity <= 0) return;
      db.prepare(
        `INSERT INTO arena_inventory (id, userId, itemId, quantity, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(makeId("inv"), profile.userId, itemId, quantity, now, now);
    });

    const nextEquippedBySlot = {};
    SLOT_ORDER.forEach((slot) => {
      nextEquippedBySlot[slot] = null;
    });

    equipmentRows.forEach((row) => {
      const slot = String(row.slot || "");
      if (!SLOT_ORDER.includes(slot)) return;
      const mapped = mapLegacyItemId(row.itemId);
      const mappedItem = SHOP_ITEMS_BY_ID.get(mapped);
      if (!mappedItem || mappedItem.type !== "gear" || mappedItem.slot !== slot) return;
      if ((mergedQuantities.get(mapped) || 0) <= 0) return;
      nextEquippedBySlot[slot] = mapped;
    });

    SLOT_ORDER.forEach((slot) => {
      if (nextEquippedBySlot[slot]) return;
      const fallback = chooseBestOwnedGearForSlot(mergedQuantities, slot);
      if (fallback) nextEquippedBySlot[slot] = fallback;
    });

    db.prepare("DELETE FROM arena_equipment WHERE userId = ?").run(profile.userId);
    SLOT_ORDER.forEach((slot) => {
      const itemId = nextEquippedBySlot[slot];
      if (!itemId) return;
      db.prepare(
        `INSERT INTO arena_equipment (userId, slot, itemId, equippedAt)
         VALUES (?, ?, ?, ?)`,
      ).run(profile.userId, slot, itemId, now);
    });

    const migratedEffects = normalizeArenaEffects(profile.effects);
    db.prepare(
      `UPDATE arena_profiles
       SET coins = ?,
           effectsJson = ?,
           catalogVersion = ?,
           updatedAt = ?
       WHERE userId = ?`,
    ).run(
      Math.max(toInt(profile.coins, 0) + refundCoins, 0),
      serializeEffects(migratedEffects),
      CATALOG_VERSION,
      now,
      profile.userId,
    );
  });

  tx();
}

function ensureArenaProfile(db, userId) {
  let row = db.prepare("SELECT * FROM arena_profiles WHERE userId = ?").get(userId);
  if (!row) {
    createArenaProfile(db, userId);
    row = db.prepare("SELECT * FROM arena_profiles WHERE userId = ?").get(userId);
  }

  let profile = mapArenaProfileRow(row);
  if (profile && profile.catalogVersion !== CATALOG_VERSION) {
    migrateProfileToCatalogV2(db, profile);
    row = db.prepare("SELECT * FROM arena_profiles WHERE userId = ?").get(userId);
    profile = mapArenaProfileRow(row);
  }

  return profile;
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

function getSkillAllocationRows(db, userId) {
  return db
    .prepare(
      `SELECT userId, nodeId, activatedAt
       FROM arena_skill_allocations
       WHERE userId = ?
       ORDER BY activatedAt ASC, nodeId ASC`,
    )
    .all(userId);
}

function getSkillState(db, profile) {
  const allocations = getSkillAllocationRows(db, profile.userId);
  const allocatedNodeIds = allocations.map((row) => row.nodeId);
  const earnedPoints = Math.max(toInt(profile.level, 1) - 1, 0);
  const spentPoints = allocations.length;
  const availablePoints = Math.max(earnedPoints - spentPoints, 0);
  const resetCost = Math.max(toInt(profile.level, 1), 1) * 100;
  const bonuses = computeSkillBonuses(allocatedNodeIds);

  return {
    allocations,
    allocatedNodeIds,
    earnedPoints,
    spentPoints,
    availablePoints,
    resetCost,
    stats: bonuses.stats,
    passives: bonuses.passives,
  };
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

function passiveMagnitude(passive) {
  if (!passive || !Array.isArray(passive.actions)) return 0;
  return passive.actions.reduce((sum, action) => {
    const value =
      toInt(action?.value, 0) +
      toInt(action?.chancePct, 0) +
      toInt(action?.maxTriggersPerFight, 0) +
      toInt(action?.turns, 0);
    return sum + value;
  }, 0);
}

function resolveActivePassives(equippedRows) {
  const passiveByKey = new Map();

  equippedRows.forEach((row) => {
    const item = SHOP_ITEMS_BY_ID.get(row.itemId);
    if (!item || item.type !== "gear" || !item.passive) return;
    const passive = item.passive;
    if (!passive.key) return;

    const candidate = {
      key: String(passive.key),
      trigger: passive.trigger,
      priority: toInt(passive.priority, 0),
      when: Array.isArray(passive.when) ? passive.when : [],
      actions: Array.isArray(passive.actions) ? passive.actions : [],
      source: {
        itemId: item.id,
        itemName: item.name,
        slot: item.slot,
        tier: item.tier,
        equippedAt: row.equippedAt || null,
      },
    };

    const existing = passiveByKey.get(candidate.key);
    if (!existing) {
      passiveByKey.set(candidate.key, candidate);
      return;
    }

    const existingTier = tierToIndex(existing.source.tier);
    const candidateTier = tierToIndex(candidate.source.tier);
    if (candidateTier > existingTier) {
      passiveByKey.set(candidate.key, candidate);
      return;
    }

    if (candidateTier < existingTier) return;

    const existingMagnitude = passiveMagnitude(existing);
    const candidateMagnitude = passiveMagnitude(candidate);
    if (candidateMagnitude > existingMagnitude) {
      passiveByKey.set(candidate.key, candidate);
      return;
    }

    if (candidateMagnitude < existingMagnitude) return;

    if (
      typeof row.equippedAt === "string" &&
      typeof existing.source.equippedAt === "string" &&
      Date.parse(row.equippedAt) > Date.parse(existing.source.equippedAt)
    ) {
      passiveByKey.set(candidate.key, candidate);
    }
  });

  return Array.from(passiveByKey.values()).sort((a, b) => b.priority - a.priority);
}

function buildMaterialInventory(inventoryMap) {
  const materials = {};
  inventoryMap.forEach((entry, itemId) => {
    const item = SHOP_ITEMS_BY_ID.get(itemId);
    if (!item || item.type !== "material") return;
    materials[itemId] = entry.quantity;
  });
  return materials;
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
  const cardStats = profile.selectedCard
    ? cardIvStatBonus(profile.selectedCard)
    : { hp: 0, power: 0, guard: 0, speed: 0, luck: 0 };
  const skillStats = options.skillStats || {
    hp: 0,
    power: 0,
    guard: 0,
    speed: 0,
    luck: 0,
  };

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
      card: cardStats,
      skill: skillStats,
      total: {
        hp: profile.hp + equipmentStats.hp + cardStats.hp + skillStats.hp,
        power:
          profile.power + equipmentStats.power + cardStats.power + skillStats.power,
        guard:
          profile.guard + equipmentStats.guard + cardStats.guard + skillStats.guard,
        speed:
          profile.speed + equipmentStats.speed + cardStats.speed + skillStats.speed,
        luck: profile.luck + equipmentStats.luck + cardStats.luck + skillStats.luck,
      },
    },
    selectedCard: profile.selectedCard,
    canDrawCard,
    catalogVersion: profile.catalogVersion || CATALOG_VERSION,
    dailyDrawLimit: DAILY_CARD_DRAW_LIMIT,
    dailyDrawsUsed,
    dailyDrawsRemaining: Math.max(DAILY_CARD_DRAW_LIMIT - dailyDrawsUsed, 0),
    nextCardDrawAt: canDrawCard ? null : getNextCardDrawAt(profile.lastCardDrawDate),
    lastCardDrawDate: profile.lastCardDrawDate,
    lifetimeCoinsEarned: profile.lifetimeCoinsEarned,
    effects: profile.effects,
    equipment: equippedItems,
    activePassives: Array.isArray(options.activePassives) ? options.activePassives : [],
    materialInventory: options.materialInventory || {},
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
  const inventoryMap = getInventoryMap(db, userId);
  const equippedRows = getEquippedRows(db, userId);
  const { equipped, stats: equipmentStats } = computeEquipmentStats(equippedRows);
  const skillState = getSkillState(db, profile);
  const activePassives = [
    ...resolveActivePassives(equippedRows),
    ...skillState.passives,
  ].sort((a, b) => b.priority - a.priority);
  const materialInventory = buildMaterialInventory(inventoryMap);
  const recentFights = readRecentFights(db, userId, 10);

  return toPublicProfile(profile, equipmentStats, equipped, {
    activePassives,
    skillStats: skillState.stats,
    skillTree: {
      earnedPoints: skillState.earnedPoints,
      spentPoints: skillState.spentPoints,
      availablePoints: skillState.availablePoints,
      resetCost: skillState.resetCost,
    },
    materialInventory,
    recentFights,
  });
}

function getArenaSkillTreePayload(db, userId) {
  const profile = ensureArenaProfile(db, userId);
  const skillState = getSkillState(db, profile);
  return {
    branches: SKILL_TREE_BRANCHES,
    nodes: SKILL_TREE_NODES,
    allocations: skillState.allocations,
    earnedPoints: skillState.earnedPoints,
    spentPoints: skillState.spentPoints,
    availablePoints: skillState.availablePoints,
    level: profile.level,
    coins: profile.coins,
    resetCost: skillState.resetCost,
    stats: skillState.stats,
  };
}

function activateArenaSkill(db, userId, nodeId) {
  const normalizedNodeId = String(nodeId || "").trim();
  const node = SKILL_TREE_NODES_BY_ID.get(normalizedNodeId);
  if (!node) {
    throw new ArenaHttpError(
      404,
      "Skill node not found.",
      "ARENA_SKILL_NOT_FOUND",
    );
  }

  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    const state = getSkillState(db, profile);
    if (state.allocatedNodeIds.includes(normalizedNodeId)) {
      throw new ArenaHttpError(
        409,
        "This skill is already active.",
        "ARENA_SKILL_ALREADY_ACTIVE",
      );
    }
    if (
      node.prerequisiteId &&
      !state.allocatedNodeIds.includes(node.prerequisiteId)
    ) {
      throw new ArenaHttpError(
        409,
        "Activate the previous skill in this chain first.",
        "ARENA_SKILL_PREREQUISITE",
        { prerequisiteId: node.prerequisiteId },
      );
    }
    if (state.availablePoints < 1) {
      throw new ArenaHttpError(
        409,
        "No skill points are available.",
        "ARENA_SKILL_POINTS_REQUIRED",
      );
    }

    db.prepare(
      `INSERT INTO arena_skill_allocations (userId, nodeId, activatedAt)
       VALUES (?, ?, ?)`,
    ).run(userId, normalizedNodeId, nowIso());
  });

  tx();
  return getArenaSkillTreePayload(db, userId);
}

function resetArenaSkills(db, userId) {
  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    const state = getSkillState(db, profile);
    if (state.spentPoints === 0) {
      throw new ArenaHttpError(
        409,
        "There are no activated skills to reset.",
        "ARENA_SKILL_RESET_EMPTY",
      );
    }
    if (profile.coins < state.resetCost) {
      throw new ArenaHttpError(
        409,
        "Not enough coins to reset the skill tree.",
        "ARENA_SKILL_RESET_COINS",
        { requiredCoins: state.resetCost },
      );
    }

    const now = nowIso();
    db.prepare("DELETE FROM arena_skill_allocations WHERE userId = ?").run(userId);
    db.prepare(
      `UPDATE arena_profiles
       SET coins = ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(profile.coins - state.resetCost, now, userId);
  });

  tx();
  return getArenaSkillTreePayload(db, userId);
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

function assertFightCooldown(profile, options = {}) {
  const { effects, allowGateKey = false } = options;
  const parsed = Date.parse(profile.lastFightAt || "");
  if (!Number.isFinite(parsed)) return { bypassedWithGateKey: false };
  const elapsed = Date.now() - parsed;
  if (elapsed >= FIGHT_COOLDOWN_MS) return { bypassedWithGateKey: false };

  if (
    allowGateKey &&
    effects &&
    toPositiveInt(effects.gateKeyCharges, 0) > 0
  ) {
    effects.gateKeyCharges -= 1;
    return { bypassedWithGateKey: true };
  }

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
  const skillState = getSkillState(db, profile);
  const activePassives = [
    ...resolveActivePassives(equippedRows),
    ...skillState.passives,
  ].sort((a, b) => b.priority - a.priority);
  const selectedCard = normalizeSelectedCard(options.overrideCard || profile.selectedCard);
  const cardStats = selectedCard
    ? cardIvStatBonus(selectedCard)
    : { hp: 0, power: 0, guard: 0, speed: 0, luck: 0 };

  return {
    profile,
    equipped,
    activePassives,
    equipmentStats,
    skillStats: skillState.stats,
    equipmentBonus: weightedEquipmentBonus(equipmentStats),
    selectedCard,
    rarity: selectedCard?.rarity || "C",
    baseStats: {
      hp: profile.hp + cardStats.hp + skillState.stats.hp,
      power: profile.power + cardStats.power + skillState.stats.power,
      guard: profile.guard + cardStats.guard + skillState.stats.guard,
      speed: profile.speed + cardStats.speed + skillState.stats.speed,
      luck: profile.luck + cardStats.luck + skillState.stats.luck,
    },
    totalStats: {
      hp: profile.hp + equipmentStats.hp + cardStats.hp + skillState.stats.hp,
      power:
        profile.power +
        equipmentStats.power +
        cardStats.power +
        skillState.stats.power,
      guard:
        profile.guard +
        equipmentStats.guard +
        cardStats.guard +
        skillState.stats.guard,
      speed:
        profile.speed +
        equipmentStats.speed +
        cardStats.speed +
        skillState.stats.speed,
      luck:
        profile.luck +
        equipmentStats.luck +
        cardStats.luck +
        skillState.stats.luck,
    },
  };
}

function consumeWinBoosts(effects, xpGain, coinGain) {
  let nextXp = xpGain;
  let nextCoins = coinGain;

  if (effects.expBoostWinsRemaining > 0 && effects.expBoostPct > 0) {
    nextXp = Math.floor(nextXp * (1 + effects.expBoostPct / 100));
  }

  if (effects.coinBoostWinsRemaining > 0 && effects.coinBoostPct > 0) {
    nextCoins = Math.floor(nextCoins * (1 + effects.coinBoostPct / 100));
  }

  return {
    xpGain: Math.max(toInt(nextXp, 0), 0),
    coinGain: Math.max(toInt(nextCoins, 0), 0),
  };
}

function consumeFightBoostDurations(effects) {
  if (effects.expBoostWinsRemaining > 0) {
    effects.expBoostWinsRemaining -= 1;
    if (effects.expBoostWinsRemaining === 0) effects.expBoostPct = 0;
  }
  if (effects.coinBoostWinsRemaining > 0) {
    effects.coinBoostWinsRemaining -= 1;
    if (effects.coinBoostWinsRemaining === 0) effects.coinBoostPct = 0;
  }
}

function applyFightEffectUsage(effects, effectUsage) {
  const next = normalizeArenaEffects(effects);

  if (effectUsage.usedRerollKeepHigher && next.rerollKeepHigherCharges > 0) {
    next.rerollKeepHigherCharges -= 1;
  }
  if (effectUsage.usedUpgradeLowest && next.upgradeLowestRarityCharges > 0) {
    next.upgradeLowestRarityCharges -= 1;
  }
  if (effectUsage.usedGuaranteeSsrPlus && next.guaranteeSsrPlusCharges > 0) {
    next.guaranteeSsrPlusCharges -= 1;
  }
  if (effectUsage.usedFightStartShield && next.fightStartShieldCharges > 0) {
    next.fightStartShieldCharges -= 1;
    if (next.fightStartShieldCharges === 0) {
      next.fightStartShieldAmount = 0;
    }
  }
  if (effectUsage.usedEvadeBoost && next.evadeBoostFightsRemaining > 0) {
    next.evadeBoostFightsRemaining -= 1;
    if (next.evadeBoostFightsRemaining === 0) {
      next.evadeBoostPct = 0;
    }
  }
  if (effectUsage.usedFirstHitTrueDamage && next.firstHitTrueDamageCharges > 0) {
    next.firstHitTrueDamageCharges -= 1;
    if (next.firstHitTrueDamageCharges === 0) {
      next.firstHitTrueDamageValue = 0;
    }
  }
  if (
    effectUsage.usedHigherRarityBonus &&
    next.higherRarityDamageBonusPctCharges > 0
  ) {
    next.higherRarityDamageBonusPctCharges -= 1;
    if (next.higherRarityDamageBonusPctCharges === 0) {
      next.higherRarityDamageBonusPct = 0;
    }
  }
  if (
    effectUsage.usedDoublePassiveTrigger &&
    next.doublePassiveTriggerFightsRemaining > 0
  ) {
    next.doublePassiveTriggerFightsRemaining -= 1;
  }
  if (effectUsage.usedGateKeyBypass && next.gateKeyCharges > 0) {
    next.gateKeyCharges -= 1;
  }

  return next;
}

function getWonRoundRarityCoinReward(simulation) {
  if (!simulation?.playerWon) return 0;
  const base = Number(RARITY_CONFIG[simulation.playerRarity]?.coinReward || 0);
  const bonusPct = Number(simulation?.passiveRewardBonus?.rarityCoinPct || 0);
  return Math.max(0, Math.floor(base * (1 + bonusPct / 100)));
}

function rollFightMaterialRewards(randomFn = Math.random) {
  return FIGHT_MATERIAL_POOLS.flatMap((pool) => {
    const quantity = randomInt(0, 1, randomFn);
    if (quantity === 0 || pool.length === 0) return [];
    const item = pool[randomInt(0, pool.length - 1, randomFn)];
    return [
      {
        itemId: item.id,
        itemName: item.name,
        tier: item.tier,
        quantity,
      },
    ];
  });
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

function computeEvasionChance(attackerStats, defenderStats, extraDefenderEvasionPct = 0) {
  return clamp(
    0.04 +
      toInt(defenderStats?.speed, 0) * 0.002 +
      toInt(defenderStats?.luck, 0) * 0.0015 -
      toInt(attackerStats?.speed, 0) * 0.001 +
      Number(extraDefenderEvasionPct || 0) / 100,
    0.02,
    0.8,
  );
}

function calculateAttackOutcome(input) {
  const {
    attackerStats,
    defenderStats,
    attackerRarity,
    bonusCritChancePct = 0,
    attackerDamageFlat = 0,
    attackerDamagePct = 0,
    attackerTrueDamage = 0,
    defenderDamageReductionPct = 0,
    defenderDamageReductionFlat = 0,
    extraDefenderEvasionPct = 0,
    randomFn = Math.random,
  } = input;

  const evasionChance = computeEvasionChance(
    attackerStats,
    defenderStats,
    extraDefenderEvasionPct,
  );
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
  damage += toInt(attackerDamageFlat, 0);
  damage = Math.floor(damage * (1 + Number(attackerDamagePct || 0) / 100));

  const critChance = clamp(
    0.05 + toInt(attackerStats?.luck, 0) * 0.0035 + Number(bonusCritChancePct || 0) / 100,
    0.05,
    0.95,
  );
  const critical = randomFn() < critChance;
  if (critical) {
    damage = Math.max(1, Math.floor(damage * 1.5));
  }

  damage = Math.floor(damage * (1 - Number(defenderDamageReductionPct || 0) / 100));
  damage -= toInt(defenderDamageReductionFlat, 0);
  damage = Math.max(1, damage);
  const trueDamage = Math.max(toInt(attackerTrueDamage, 0), 0);

  return {
    avoided: false,
    critical,
    damage,
    trueDamage,
  };
}

function getValueAtPath(source, path) {
  if (!source || typeof source !== "object") return undefined;
  if (typeof path !== "string" || !path) return undefined;
  return path.split(".").reduce((cursor, part) => {
    if (!cursor || typeof cursor !== "object") return undefined;
    return cursor[part];
  }, source);
}

function evaluatePassiveWhen(conditions, context) {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  return conditions.every((condition) => {
    const left = getValueAtPath(context, condition.left);
    const right = condition.right;
    switch (condition.op) {
      case "==":
        return left === right;
      case "!=":
        return left !== right;
      case ">":
        return Number(left) > Number(right);
      case ">=":
        return Number(left) >= Number(right);
      case "<":
        return Number(left) < Number(right);
      case "<=":
        return Number(left) <= Number(right);
      default:
        return false;
    }
  });
}

function canFirePassiveAction(runtimeState, actionKey, maxTriggersPerFight) {
  const maxTriggers = toPositiveInt(maxTriggersPerFight, 0);
  if (maxTriggers <= 0) return true;
  const current = runtimeState.actionUses[actionKey] || 0;
  if (current >= maxTriggers) return false;
  runtimeState.actionUses[actionKey] = current + 1;
  return true;
}

function buildPassiveRuntime() {
  return {
    shield: 0,
    evasionPct: 0,
    cancelCriticalCharges: 0,
    tempGuard: {
      amount: 0,
      remainingHits: 0,
    },
    actionUses: {},
    rewardBonusPct: {
      xp: 0,
      coins: 0,
    },
    rarityCoinBonusPct: 0,
  };
}

function consumeTempGuard(runtime) {
  const activeGuard =
    runtime.tempGuard.remainingHits > 0 ? runtime.tempGuard.amount : 0;
  if (activeGuard <= 0) return 0;

  runtime.tempGuard.remainingHits -= 1;
  if (runtime.tempGuard.remainingHits === 0) {
    runtime.tempGuard.amount = 0;
  }
  return activeGuard;
}

function runPassivesForTrigger(input) {
  const {
    trigger,
    passives,
    selfStats,
    opponentStats,
    selfRuntime,
    opponentRuntime,
    context,
    randomFn = Math.random,
    passiveChanceMultiplier = 1,
  } = input;

  const mods = {
    attackDamageFlat: 0,
    attackDamagePct: 0,
    bonusCritChancePct: 0,
    damageReductionPct: 0,
    damageReductionFlat: 0,
    reflectFlatDamage: 0,
    counterDamagePct: 0,
    extraStrikeChancePct: 0,
    extraStrikeDamagePct: 0,
    healFlat: 0,
  };

  passives.forEach((passive) => {
    if (!passive || passive.trigger !== trigger) return;
    if (!evaluatePassiveWhen(passive.when, context)) return;

    const actions = Array.isArray(passive.actions) ? passive.actions : [];
    actions.forEach((action, actionIndex) => {
      const actionKey = `${passive.key}:${trigger}:${actionIndex}`;
      if (
        !canFirePassiveAction(selfRuntime, actionKey, action?.maxTriggersPerFight)
      ) {
        return;
      }

      const type = String(action?.type || "");
      const chancePct = clamp(
        toPositiveInt(action?.chancePct, 100) * Number(passiveChanceMultiplier || 1),
        0,
        100,
      );
      if (chancePct < 100 && randomFn() * 100 >= chancePct) {
        return;
      }

      const value = Number(action?.value || 0);

      if (type === "addFlatDamage") {
        mods.attackDamageFlat += value;
      } else if (type === "scaleDamagePct") {
        mods.attackDamagePct += value;
      } else if (type === "scaleBySpeedPct") {
        mods.attackDamageFlat += Math.floor(toInt(selfStats.speed, 0) * (value / 100));
      } else if (type === "bonusCritChancePct") {
        mods.bonusCritChancePct += value;
      } else if (type === "reduceIncomingDamagePct") {
        mods.damageReductionPct += value;
      } else if (type === "reduceIncomingDamageFlat") {
        mods.damageReductionFlat += value;
      } else if (type === "applyShield") {
        selfRuntime.shield += toInt(value, 0);
      } else if (type === "healFlat") {
        mods.healFlat += Math.max(toInt(value, 0), 0);
      } else if (type === "rewardBonusPct") {
        const target = String(action?.target || "");
        if (target === "xp" || target === "coins") {
          selfRuntime.rewardBonusPct[target] += value;
        }
      } else if (type === "rarityCoinBonusPct") {
        selfRuntime.rarityCoinBonusPct += value;
      } else if (type === "reflectFlatDamage") {
        mods.reflectFlatDamage += value;
      } else if (type === "counterDamagePct") {
        mods.counterDamagePct += value;
      } else if (type === "addEvasionPct") {
        selfRuntime.evasionPct += value;
      } else if (type === "grantTempGuard") {
        selfRuntime.tempGuard.amount = Math.max(
          selfRuntime.tempGuard.amount,
          toInt(value, 0),
        );
        selfRuntime.tempGuard.remainingHits = Math.max(
          selfRuntime.tempGuard.remainingHits,
          toPositiveInt(action?.turns, 1),
        );
      } else if (type === "cancelCritical") {
        selfRuntime.cancelCriticalCharges += Math.max(toInt(value, 1), 1);
      } else if (type === "scaleLuckIntoPowerPct") {
        selfStats.power += Math.floor(toInt(selfStats.luck, 0) * (value / 100));
      } else if (type === "reduceOpponentLuckPct") {
        opponentStats.luck = Math.max(
          1,
          Math.floor(toInt(opponentStats.luck, 0) * (1 - value / 100)),
        );
      } else if (type === "extraStrikePct") {
        mods.extraStrikeChancePct = 100;
        mods.extraStrikeDamagePct = Math.max(mods.extraStrikeDamagePct, value);
      }
    });
  });

  return mods;
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

  const effectUsage = {
    usedRerollKeepHigher: false,
    usedUpgradeLowest: false,
    usedGuaranteeSsrPlus: false,
    usedFightStartShield: false,
    usedEvadeBoost: false,
    usedFirstHitTrueDamage: false,
    usedHigherRarityBonus: false,
    usedDoublePassiveTrigger: false,
  };

  if (playerEffects.guaranteeSsrPlusCharges > 0) {
    effectUsage.usedGuaranteeSsrPlus = true;
    if (rarityRank(playerRarity) < 3) {
      playerRarity = "SSR";
    }
  }

  if (playerEffects.upgradeLowestRarityCharges > 0) {
    playerRarity = upgradeRarityOneStep(playerRarity);
    effectUsage.usedUpgradeLowest = true;
  }

  if (playerEffects.rerollKeepHigherCharges > 0) {
    const rerolledCard = createDrawnCard(await drawArenaCard(db));
    const keepRerolled = rarityRank(rerolledCard.rarity) > rarityRank(playerRarity);
    if (keepRerolled) {
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
    }
    effectUsage.usedRerollKeepHigher = true;
  }

  const playerRuntime = buildPassiveRuntime();
  const opponentRuntime = buildPassiveRuntime();
  const playerPassives = Array.isArray(player.activePassives) ? player.activePassives : [];
  const opponentPassives = Array.isArray(opponent.activePassives)
    ? opponent.activePassives
    : [];
  const passiveChanceMultiplier = playerEffects.doublePassiveTriggerFightsRemaining > 0 ? 2 : 1;
  effectUsage.usedDoublePassiveTrigger =
    playerEffects.doublePassiveTriggerFightsRemaining > 0;

  if (playerEffects.fightStartShieldCharges > 0 && playerEffects.fightStartShieldAmount > 0) {
    playerRuntime.shield += playerEffects.fightStartShieldAmount;
    effectUsage.usedFightStartShield = true;
  }

  if (playerEffects.evadeBoostFightsRemaining > 0 && playerEffects.evadeBoostPct > 0) {
    playerRuntime.evasionPct += playerEffects.evadeBoostPct;
    effectUsage.usedEvadeBoost = true;
  }

  const provisionalPlayerMaxHp = computeMaxHp(playerTotalStats);
  const provisionalOpponentMaxHp = computeMaxHp(opponent.totalStats);
  const fightStartContextPlayer = {
    self: { hp: provisionalPlayerMaxHp, maxHp: provisionalPlayerMaxHp },
    opponent: { hp: provisionalOpponentMaxHp, maxHp: provisionalOpponentMaxHp },
    attack: { turn: 0, isFirstActor: false, critical: false },
  };
  runPassivesForTrigger({
    trigger: "onFightStart",
    passives: playerPassives,
    selfStats: playerTotalStats,
    opponentStats: opponent.totalStats,
    selfRuntime: playerRuntime,
    opponentRuntime,
    context: fightStartContextPlayer,
    randomFn,
    passiveChanceMultiplier,
  });
  runPassivesForTrigger({
    trigger: "onFightStart",
    passives: opponentPassives,
    selfStats: opponent.totalStats,
    opponentStats: playerTotalStats,
    selfRuntime: opponentRuntime,
    opponentRuntime: playerRuntime,
    context: {
      self: { hp: provisionalOpponentMaxHp, maxHp: provisionalOpponentMaxHp },
      opponent: { hp: provisionalPlayerMaxHp, maxHp: provisionalPlayerMaxHp },
      attack: { turn: 0, isFirstActor: false, critical: false },
    },
    randomFn,
    passiveChanceMultiplier: 1,
  });

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

  if (playerRuntime.shield > 0) {
    pushConsole(`${playerName} starts with a shield of ${playerRuntime.shield}`);
  }
  if (opponentRuntime.shield > 0) {
    pushConsole(`${opponentName} starts with a shield of ${opponentRuntime.shield}`);
  }
  const initialShield = {
    player: playerRuntime.shield,
    opponent: opponentRuntime.shield,
  };

  const hasHigherRarityBonus =
    playerEffects.higherRarityDamageBonusPctCharges > 0 &&
    rarityRank(playerRarity) < rarityRank(opponentRarity);
  effectUsage.usedHigherRarityBonus = hasHigherRarityBonus;

  let firstHitBombConsumed = false;

  const runAttack = (attackerSide, firstActor) => {
    if (playerHp <= 0 || opponentHp <= 0) return;
    turnCounter += 1;

    const attackerIsPlayer = attackerSide === "player";
    const attackerName = attackerIsPlayer ? playerName : opponentName;
    const defenderName = attackerIsPlayer ? opponentName : playerName;
    const attackerStats = attackerIsPlayer ? playerTotalStats : opponent.totalStats;
    const defenderStats = attackerIsPlayer ? opponent.totalStats : playerTotalStats;
    const attackerRarity = attackerIsPlayer ? playerRarity : opponentRarity;
    const attackerRuntime = attackerIsPlayer ? playerRuntime : opponentRuntime;
    const defenderRuntime = attackerIsPlayer ? opponentRuntime : playerRuntime;
    const attackerPassives = attackerIsPlayer ? playerPassives : opponentPassives;
    const defenderPassives = attackerIsPlayer ? opponentPassives : playerPassives;
    const attackerHp = attackerIsPlayer ? playerHp : opponentHp;
    const defenderHp = attackerIsPlayer ? opponentHp : playerHp;
    const attackerMaxHp = attackerIsPlayer ? maxPlayerHp : maxOpponentHp;
    const defenderMaxHp = attackerIsPlayer ? maxOpponentHp : maxPlayerHp;

    pushConsole(`${attackerName} is attacking ${defenderName}`);

    const onAttackMods = runPassivesForTrigger({
      trigger: "onAttack",
      passives: attackerPassives,
      selfStats: attackerStats,
      opponentStats: defenderStats,
      selfRuntime: attackerRuntime,
      opponentRuntime: defenderRuntime,
      context: {
        self: {
          hp: attackerHp,
          maxHp: attackerMaxHp,
          hpPct: attackerMaxHp > 0 ? (attackerHp / attackerMaxHp) * 100 : 0,
          stats: attackerStats,
        },
        defender: {
          hp: defenderHp,
          maxHp: defenderMaxHp,
          hpPct: defenderMaxHp > 0 ? (defenderHp / defenderMaxHp) * 100 : 0,
          stats: defenderStats,
        },
        attack: {
          turn: turnCounter,
          isFirstActor: firstActor,
          critical: false,
        },
      },
      randomFn,
      passiveChanceMultiplier: attackerIsPlayer ? passiveChanceMultiplier : 1,
    });

    const pendingTrueDamage =
      attackerIsPlayer &&
      playerEffects.firstHitTrueDamageCharges > 0 &&
      !firstHitBombConsumed
        ? playerEffects.firstHitTrueDamageValue
        : 0;

    if (attackerIsPlayer && hasHigherRarityBonus) {
      onAttackMods.attackDamagePct += playerEffects.higherRarityDamageBonusPct;
    }

    const activeTempGuard =
      defenderRuntime.tempGuard.remainingHits > 0
        ? defenderRuntime.tempGuard.amount
        : 0;
    const effectiveDefenderStats =
      activeTempGuard > 0
        ? {
            ...defenderStats,
            guard: toInt(defenderStats.guard, 0) + activeTempGuard,
          }
        : defenderStats;

    const outcome = calculateAttackOutcome({
      attackerStats,
      defenderStats: effectiveDefenderStats,
      attackerRarity,
      bonusCritChancePct: onAttackMods.bonusCritChancePct,
      attackerDamageFlat: onAttackMods.attackDamageFlat,
      attackerDamagePct: onAttackMods.attackDamagePct,
      attackerTrueDamage: pendingTrueDamage,
      extraDefenderEvasionPct: defenderRuntime.evasionPct,
      randomFn,
    });

    if (outcome.avoided) {
      consumeTempGuard(defenderRuntime);
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
        playerShield: playerRuntime.shield,
        opponentShield: opponentRuntime.shield,
      });
      return;
    }

    if (pendingTrueDamage > 0) {
      firstHitBombConsumed = true;
      effectUsage.usedFirstHitTrueDamage = true;
    }

    consumeTempGuard(defenderRuntime);

    const onDamageTakenMods = runPassivesForTrigger({
      trigger: "onDamageTaken",
      passives: defenderPassives,
      selfStats: defenderStats,
      opponentStats: attackerStats,
      selfRuntime: defenderRuntime,
      opponentRuntime: attackerRuntime,
      context: {
        self: {
          hp: defenderHp,
          maxHp: defenderMaxHp,
          hpPct: defenderMaxHp > 0 ? (defenderHp / defenderMaxHp) * 100 : 0,
          stats: defenderStats,
        },
        opponent: {
          hp: attackerHp,
          maxHp: attackerMaxHp,
          hpPct: attackerMaxHp > 0 ? (attackerHp / attackerMaxHp) * 100 : 0,
          stats: attackerStats,
        },
        attack: {
          turn: turnCounter,
          isFirstActor: firstActor,
          critical: outcome.critical,
        },
      },
      randomFn,
      passiveChanceMultiplier: attackerIsPlayer ? 1 : passiveChanceMultiplier,
    });

    if (outcome.critical && defenderRuntime.cancelCriticalCharges > 0) {
      defenderRuntime.cancelCriticalCharges -= 1;
      outcome.critical = false;
      outcome.damage = Math.max(1, Math.floor(outcome.damage / 1.5));
      pushConsole(`${defenderName} nullified a critical hit`);
    }

    let finalDamage = outcome.damage;
    finalDamage = Math.floor(
      finalDamage * (1 - Number(onDamageTakenMods.damageReductionPct || 0) / 100),
    );
    finalDamage -= toInt(onDamageTakenMods.damageReductionFlat, 0);
    finalDamage = Math.max(1, finalDamage);

    const onDamageDealtMods = runPassivesForTrigger({
      trigger: "onDamageDealt",
      passives: attackerPassives,
      selfStats: attackerStats,
      opponentStats: defenderStats,
      selfRuntime: attackerRuntime,
      opponentRuntime: defenderRuntime,
      context: {
        self: {
          hp: attackerHp,
          maxHp: attackerMaxHp,
          hpPct: attackerMaxHp > 0 ? (attackerHp / attackerMaxHp) * 100 : 0,
          stats: attackerStats,
        },
        defender: {
          hp: defenderHp,
          maxHp: defenderMaxHp,
          hpPct: defenderMaxHp > 0 ? (defenderHp / defenderMaxHp) * 100 : 0,
          stats: defenderStats,
        },
        attack: {
          turn: turnCounter,
          isFirstActor: firstActor,
          critical: outcome.critical,
        },
      },
      randomFn,
      passiveChanceMultiplier: attackerIsPlayer ? passiveChanceMultiplier : 1,
    });

    finalDamage += toInt(onDamageDealtMods.attackDamageFlat, 0);
    finalDamage = Math.floor(
      finalDamage * (1 + Number(onDamageDealtMods.attackDamagePct || 0) / 100),
    );

    if (onDamageDealtMods.extraStrikeChancePct > 0) {
      const bonusStrike = Math.max(
        1,
        Math.floor(finalDamage * (Number(onDamageDealtMods.extraStrikeDamagePct || 0) / 100)),
      );
      finalDamage += bonusStrike;
      pushConsole(`${attackerName} triggered an extra strike for ${bonusStrike} HP`);
    }

    finalDamage += Math.max(toInt(outcome.trueDamage, 0), 0);

    if (defenderRuntime.shield > 0) {
      const absorbed = Math.min(defenderRuntime.shield, finalDamage);
      defenderRuntime.shield -= absorbed;
      finalDamage -= absorbed;
      if (absorbed > 0) {
        pushConsole(`${defenderName}'s shield absorbed ${absorbed} HP`);
      }
    }

    finalDamage = Math.max(0, finalDamage);

    if (attackerIsPlayer) {
      opponentHp = Math.max(0, opponentHp - finalDamage);
    } else {
      playerHp = Math.max(0, playerHp - finalDamage);
    }

    const healAmount = Math.max(toInt(onDamageTakenMods.healFlat, 0), 0);
    if (healAmount > 0) {
      if (attackerIsPlayer && opponentHp > 0) {
        const before = opponentHp;
        opponentHp = Math.min(maxOpponentHp, opponentHp + healAmount);
        if (opponentHp > before) {
          pushConsole(`${defenderName} recovered ${opponentHp - before} HP`);
        }
      } else if (!attackerIsPlayer && playerHp > 0) {
        const before = playerHp;
        playerHp = Math.min(maxPlayerHp, playerHp + healAmount);
        if (playerHp > before) {
          pushConsole(`${defenderName} recovered ${playerHp - before} HP`);
        }
      }
    }

    if (finalDamage > 0) {
      pushConsole(`${attackerName} dealt ${finalDamage} damage${outcome.critical ? " (CRIT)" : ""}`);
    } else {
      pushConsole(`${attackerName} dealt 0 damage`);
    }

    const reflect = Math.max(toInt(onDamageTakenMods.reflectFlatDamage, 0), 0);
    if (reflect > 0) {
      if (attackerIsPlayer) {
        playerHp = Math.max(0, playerHp - reflect);
      } else {
        opponentHp = Math.max(0, opponentHp - reflect);
      }
      pushConsole(`${defenderName} reflected ${reflect} HP`);
    }

    const counterPct = Math.max(Number(onDamageTakenMods.counterDamagePct || 0), 0);
    if (counterPct > 0 && finalDamage > 0) {
      const counterDamage = Math.max(1, Math.floor(finalDamage * (counterPct / 100)));
      if (attackerIsPlayer) {
        playerHp = Math.max(0, playerHp - counterDamage);
      } else {
        opponentHp = Math.max(0, opponentHp - counterDamage);
      }
      pushConsole(`${defenderName} countered for ${counterDamage} HP`);
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
      damage: finalDamage,
      playerHp,
      opponentHp,
      playerShield: playerRuntime.shield,
      opponentShield: opponentRuntime.shield,
    });
  };

  const maxTurns = 60;
  while (playerHp > 0 && opponentHp > 0 && turnCounter < maxTurns) {
    const playerActsFirst =
      playerTotalStats.speed + randomInt(0, 8, randomFn) >=
      opponent.totalStats.speed + randomInt(0, 8, randomFn);

    if (playerActsFirst) {
      runAttack("player", true);
      if (opponentHp <= 0) break;
      runAttack("opponent", false);
    } else {
      runAttack("opponent", true);
      if (playerHp <= 0) break;
      runAttack("player", false);
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

  if (playerWon) {
    runPassivesForTrigger({
      trigger: "onWin",
      passives: playerPassives,
      selfStats: playerTotalStats,
      opponentStats: opponent.totalStats,
      selfRuntime: playerRuntime,
      opponentRuntime,
      context: {
        self: { hp: playerHp, maxHp: maxPlayerHp, hpPct: (playerHp / maxPlayerHp) * 100 },
        opponent: {
          hp: opponentHp,
          maxHp: maxOpponentHp,
          hpPct: (opponentHp / maxOpponentHp) * 100,
        },
        attack: { turn: turnCounter, isFirstActor: false, critical: false },
      },
      randomFn,
      passiveChanceMultiplier,
    });
  } else {
    runPassivesForTrigger({
      trigger: "onLose",
      passives: playerPassives,
      selfStats: playerTotalStats,
      opponentStats: opponent.totalStats,
      selfRuntime: playerRuntime,
      opponentRuntime,
      context: {
        self: { hp: playerHp, maxHp: maxPlayerHp, hpPct: (playerHp / maxPlayerHp) * 100 },
        opponent: {
          hp: opponentHp,
          maxHp: maxOpponentHp,
          hpPct: (opponentHp / maxOpponentHp) * 100,
        },
        attack: { turn: turnCounter, isFirstActor: false, critical: false },
      },
      randomFn,
      passiveChanceMultiplier,
    });
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
      initialShield,
      turns,
      console: battleConsole,
    },
    playerRoundsWon: playerWon ? 1 : 0,
    opponentRoundsWon: playerWon ? 0 : 1,
    xpRoundsWon,
    playerRarity,
    playerWon,
    passiveRewardBonus: {
      xpPct: playerRuntime.rewardBonusPct.xp,
      coinsPct: playerRuntime.rewardBonusPct.coins,
      rarityCoinPct: playerRuntime.rarityCoinBonusPct,
    },
    effectUsage,
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

  const preflightEffects = normalizeArenaEffects(profile.effects);
  assertFightCooldown(profile, { effects: preflightEffects, allowGateKey: true });

  const opponentSelection = await selectOpponentForFight(db, userId);
  const opponentProfile = opponentSelection.profile;

  const playerSnapshot = loadCombatSnapshot(db, profile);
  const opponentSnapshot = loadCombatSnapshot(db, opponentProfile);
  const simulation = await simulateFight(db, {
    player: playerSnapshot,
    opponent: opponentSnapshot,
    playerEffects: preflightEffects,
  });

  const now = nowIso();
  const tx = db.transaction(() => {
    const current = ensureArenaProfile(db, userId);
    if (!current.selectedCard) {
      throw new ArenaHttpError(409, "Draw a card to start.", "ARENA_CARD_REQUIRED");
    }
    const effects = normalizeArenaEffects(current.effects);
    const cooldownResult = assertFightCooldown(current, {
      effects,
      allowGateKey: true,
    });

    const nextEffects = applyFightEffectUsage(effects, {
      ...simulation.effectUsage,
      usedGateKeyBypass: cooldownResult.bypassedWithGateKey,
    });
    const currentSnapshot = loadCombatSnapshot(db, current);
    const rarityCoinReward = getWonRoundRarityCoinReward(simulation);
    let xpDelta = 1;
    let coinDelta = 0;

    if (simulation.playerWon) {
      let baseXp = calculateWinXp(
        opponentSnapshot.profile.level,
        simulation.xpRoundsWon,
        current.winStreak,
      );
      let baseCoins = calculateWinCoins(
        opponentSnapshot.profile.level,
        rarityCoinReward,
        currentSnapshot.totalStats.luck,
      );
      baseXp = Math.floor(
        baseXp * (1 + Number(simulation?.passiveRewardBonus?.xpPct || 0) / 100),
      );
      baseCoins = Math.floor(
        baseCoins * (1 + Number(simulation?.passiveRewardBonus?.coinsPct || 0) / 100),
      );
      const adjusted = consumeWinBoosts(nextEffects, baseXp, baseCoins);
      xpDelta = adjusted.xpGain;
      coinDelta = adjusted.coinGain;
      current.wins += 1;
      current.winStreak += 1;
    } else {
      current.losses += 1;
      if (nextEffects.streakShieldCharges > 0) {
        nextEffects.streakShieldCharges -= 1;
      } else {
        current.winStreak = 0;
      }
    }

    consumeFightBoostDurations(nextEffects);

    const materialDrops = rollFightMaterialRewards();
    materialDrops.forEach((drop) => {
      upsertInventoryItem(db, current.userId, drop.itemId, drop.quantity);
    });

    current.xp += xpDelta;
    current.coins += coinDelta;
    current.lifetimeCoinsEarned += coinDelta;
    const levelsGained = applyLevelUps(current);
    current.effects = nextEffects;
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
      materialDrops,
      bypassedCooldownWithGateKey: cooldownResult.bypassedWithGateKey,
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
      materialDrops: result.materialDrops,
    },
    effectUsage: {
      ...simulation.effectUsage,
      usedGateKeyBypass: result.bypassedCooldownWithGateKey,
    },
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

function readDailyCardShopOffers(db, offerDate) {
  return db
    .prepare(
      `SELECT offerId, offerDate, slot, malId, cardJson, createdAt
       FROM arena_daily_card_offers
       WHERE offerDate = ?
       ORDER BY slot ASC`,
    )
    .all(offerDate)
    .map((row) => ({
      offerId: row.offerId,
      offerDate: row.offerDate,
      slot: toPositiveInt(row.slot, 0),
      malId: toPositiveInt(row.malId, 0),
      card: normalizeSelectedCard(row.cardJson),
      createdAt: row.createdAt,
    }))
    .filter((offer) => offer.card);
}

async function ensureDailyCardShopOffers(db, offerDate = getCurrentRecordedDate()) {
  await ensureArenaCardPool(db);

  for (
    let attempt = 0;
    attempt < CARD_SHOP_GENERATION_ATTEMPTS;
    attempt += 1
  ) {
    const offers = readDailyCardShopOffers(db, offerDate);
    if (offers.length >= CARD_SHOP_DAILY_OFFER_COUNT) {
      return offers.slice(0, CARD_SHOP_DAILY_OFFER_COUNT);
    }

    const usedMalIds = new Set(offers.map((offer) => offer.malId));
    const usedSlots = new Set(offers.map((offer) => offer.slot));
    const slot = Array.from(
      { length: CARD_SHOP_DAILY_OFFER_COUNT },
      (_, index) => index,
    ).find((candidate) => !usedSlots.has(candidate));
    if (slot === undefined) break;

    const malCard = await drawArenaCard(db);
    const malId = toPositiveInt(malCard?.malId, 0);
    if (!malId || usedMalIds.has(malId)) continue;

    const card = createDrawnCard(malCard);
    const now = nowIso();
    db.prepare(
      `INSERT OR IGNORE INTO arena_daily_card_offers (
        offerId, offerDate, slot, malId, cardJson, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `card-offer-${offerDate}-${slot}-${malId}`,
      offerDate,
      slot,
      malId,
      JSON.stringify(card),
      now,
      now,
    );
  }

  const offers = readDailyCardShopOffers(db, offerDate);
  if (offers.length < CARD_SHOP_DAILY_OFFER_COUNT) {
    throw new ArenaHttpError(
      503,
      "Daily card offers could not be prepared. Please try again shortly.",
      "ARENA_CARD_SHOP_UNAVAILABLE",
    );
  }
  return offers.slice(0, CARD_SHOP_DAILY_OFFER_COUNT);
}

function buildArenaCardShopPayload(db, userId, offerDate) {
  const profile = ensureArenaProfile(db, userId);
  const offers = readDailyCardShopOffers(db, offerDate).slice(
    0,
    CARD_SHOP_DAILY_OFFER_COUNT,
  );
  const purchasedOfferIds = new Set(
    db
      .prepare(
        `SELECT offerId
         FROM arena_daily_card_purchases
         WHERE userId = ? AND offerDate = ?`,
      )
      .all(userId, offerDate)
      .map((row) => row.offerId),
  );

  return {
    offerDate,
    nextRefreshAt: `${addDaysToRecordedDate(offerDate, 1)}T00:00:00.000Z`,
    prices: CARD_SHOP_PRICES,
    profile: getArenaProfilePayload(db, userId),
    dailyOffers: offers.map((offer) => {
      const sold = purchasedOfferIds.has(offer.offerId);
      const price = getCardShopPrice(offer.card.rarity);
      return {
        offerId: offer.offerId,
        card: offer.card,
        price,
        sold,
        canBuy: !sold && profile.coins >= price,
      };
    }),
    randomOffer: {
      offerId: "random-card",
      price: CARD_SHOP_RANDOM_PRICE,
      canBuy: profile.coins >= CARD_SHOP_RANDOM_PRICE,
    },
  };
}

async function getArenaCardShopPayload(db, userId, options = {}) {
  const offerDate =
    typeof options.recordedDate === "string" && options.recordedDate
      ? options.recordedDate
      : getCurrentRecordedDate();
  await ensureDailyCardShopOffers(db, offerDate);
  return buildArenaCardShopPayload(db, userId, offerDate);
}

async function buyArenaShopCard(db, userId, input = {}, options = {}) {
  const kind = input.kind === "daily" ? "daily" : input.kind === "random" ? "random" : "";
  if (!kind) {
    throw new ArenaHttpError(
      400,
      "Card purchase kind must be daily or random.",
      "ARENA_CARD_SHOP_KIND_REQUIRED",
    );
  }

  const offerDate = getCurrentRecordedDate();
  const currentProfile = ensureArenaProfile(db, userId);
  let offer = null;
  let purchasedCard = null;
  let purchasePrice = CARD_SHOP_RANDOM_PRICE;

  if (kind === "daily") {
    const offerId = String(input.offerId || "").trim();
    if (!offerId) {
      throw new ArenaHttpError(
        400,
        "offerId is required for a daily card.",
        "ARENA_CARD_SHOP_OFFER_REQUIRED",
      );
    }
    await ensureDailyCardShopOffers(db, offerDate);
    offer = readDailyCardShopOffers(db, offerDate).find(
      (candidate) => candidate.offerId === offerId,
    );
    if (!offer) {
      throw new ArenaHttpError(
        404,
        "This daily card offer is no longer available.",
        "ARENA_CARD_SHOP_OFFER_NOT_FOUND",
      );
    }
    purchasedCard = createPurchasedCard(offer.card);
    purchasePrice = getCardShopPrice(offer.card.rarity);
  } else {
    if (currentProfile.coins < CARD_SHOP_RANDOM_PRICE) {
      throw new ArenaHttpError(
        400,
        "Not enough coins.",
        "ARENA_NOT_ENOUGH_COINS",
        { requiredCoins: CARD_SHOP_RANDOM_PRICE },
      );
    }
    await ensureArenaCardPool(db);
    const drawCard =
      typeof options.drawCard === "function" ? options.drawCard : drawArenaCard;
    const malCard = await drawCard(db);
    purchasedCard = createDrawnCard(malCard);
  }

  if (!purchasedCard) {
    throw new ArenaHttpError(
      503,
      "The card could not be prepared. Please try again shortly.",
      "ARENA_CARD_SHOP_UNAVAILABLE",
    );
  }
  if (currentProfile.coins < purchasePrice) {
    throw new ArenaHttpError(
      400,
      "Not enough coins.",
      "ARENA_NOT_ENOUGH_COINS",
      { requiredCoins: purchasePrice },
    );
  }

  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    if (profile.coins < purchasePrice) {
      throw new ArenaHttpError(
        400,
        "Not enough coins.",
        "ARENA_NOT_ENOUGH_COINS",
        { requiredCoins: purchasePrice },
      );
    }

    if (kind === "daily") {
      const existingPurchase = db
        .prepare(
          `SELECT id
           FROM arena_daily_card_purchases
           WHERE userId = ? AND offerId = ?
           LIMIT 1`,
        )
        .get(userId, offer.offerId);
      if (existingPurchase) {
        throw new ArenaHttpError(
          409,
          "You already bought this daily card.",
          "ARENA_CARD_SHOP_ALREADY_SOLD",
        );
      }

      db.prepare(
        `INSERT INTO arena_daily_card_purchases (
          id, userId, offerId, offerDate, purchasedAt
        ) VALUES (?, ?, ?, ?, ?)`,
      ).run(
        makeId("card-purchase"),
        userId,
        offer.offerId,
        offerDate,
        nowIso(),
      );
    }

    const updatedAt = nowIso();
    db.prepare(
      `UPDATE arena_profiles
       SET coins = ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(profile.coins - purchasePrice, updatedAt, userId);
    insertCollectionCard(db, userId, purchasedCard);
  });

  tx();
  const cardShop = await getArenaCardShopPayload(db, userId);
  return {
    kind,
    purchasedOfferId: kind === "daily" ? offer.offerId : "random-card",
    pricePaid: purchasePrice,
    card: purchasedCard,
    profile: cardShop.profile,
    cardShop,
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
    const isOwned = ownedQuantity > 0;
    const unlocked = profile.level >= item.unlockLevel;
    const isEquipped =
      item.type === "gear" && item.slot ? equippedBySlot[item.slot] === item.id : false;
    const recipe = item.recipeId ? SHOP_RECIPES_BY_ID.get(item.recipeId) : null;
    const canBuy =
      item.acquisition === "buy" &&
      unlocked &&
      profile.coins >= toInt(item.price, 0);
    let canCraft = false;
    if (item.acquisition === "craft" && recipe && unlocked) {
      const hasCoins = profile.coins >= toInt(recipe.coinCost, 0);
      const hasInputs = recipe.inputs.every((entry) => {
        const owned = inventoryMap.get(entry.itemId)?.quantity || 0;
        return owned >= toInt(entry.quantity, 0);
      });
      const gearAlreadyOwned =
        item.type === "gear" && (inventoryMap.get(item.id)?.quantity || 0) > 0;
      canCraft = hasCoins && hasInputs && !gearAlreadyOwned;
    }

    let cooldownEndsAt = null;
    if (
      item.type === "consumable" &&
      item.consumableEffect?.kind === "ascension" &&
      profile.effects.ascensionLastPurchasedAt
    ) {
      const parsed = Date.parse(profile.effects.ascensionLastPurchasedAt);
      if (Number.isFinite(parsed)) {
        const cooldownMs =
          Number(item.consumableEffect.cooldownDays || 7) * 24 * 60 * 60 * 1000;
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
      canBuy: canBuy && !cooldownEndsAt,
      canCraft: canCraft && !cooldownEndsAt,
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
  const recipes = SHOP_RECIPES.map((recipe) => {
    const outputItem = SHOP_ITEMS_BY_ID.get(recipe.output.itemId);
    const unlocked = profile.level >= recipe.unlockLevel;
    const hasCoins = profile.coins >= toInt(recipe.coinCost, 0);
    const inputState = recipe.inputs.map((entry) => {
      const owned = inventoryMap.get(entry.itemId)?.quantity || 0;
      const item = SHOP_ITEMS_BY_ID.get(entry.itemId);
      return {
        itemId: entry.itemId,
        itemName: item?.name || entry.itemId,
        required: toInt(entry.quantity, 0),
        owned,
      };
    });
    const hasInputs = inputState.every((entry) => entry.owned >= entry.required);
    const outputOwned = inventoryMap.get(recipe.output.itemId)?.quantity || 0;
    const blockedByGearOwnership =
      outputItem?.type === "gear" && outputOwned > 0;

    return {
      ...recipe,
      output: {
        ...recipe.output,
        itemName: outputItem?.name || recipe.output.itemId,
      },
      inputs: inputState,
      unlocked,
      canCraft: unlocked && hasCoins && hasInputs && !blockedByGearOwnership,
    };
  });

  return {
    catalogVersion: CATALOG_VERSION,
    profile: getArenaProfilePayload(db, userId),
    shop,
    recipes,
    equipped,
  };
}

function enforceAscensionCooldown(profile, item) {
  const cooldownDays = Number(item?.consumableEffect?.cooldownDays || 7);
  const previous = profile.effects.ascensionLastPurchasedAt;
  if (!previous) return;
  const parsed = Date.parse(previous);
  if (!Number.isFinite(parsed)) return;
  const cooldownEndsAt = parsed + cooldownDays * 24 * 60 * 60 * 1000;
  if (cooldownEndsAt > Date.now()) {
    throw new ArenaHttpError(
      409,
      "Solar Cauldron can only be used once every 7 days.",
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

    if (item.acquisition !== "buy") {
      throw new ArenaHttpError(
        400,
        "This item is crafted, not bought directly.",
        "ARENA_ITEM_CRAFT_ONLY",
      );
    }

    if (profile.coins < item.price) {
      throw new ArenaHttpError(400, "Not enough coins.", "ARENA_NOT_ENOUGH_COINS");
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
    } else if (item.type === "consumable" || item.type === "material") {
      upsertInventoryItem(db, userId, item.id, 1);
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
  const effect = item.consumableEffect || {};
  const effects = normalizeArenaEffects(profile.effects);
  const now = nowIso();

  if (effect.kind === "exp_boost") {
    effects.expBoostPct = Math.max(effects.expBoostPct, toPositiveInt(effect.pct, 0));
    effects.expBoostWinsRemaining += toPositiveInt(effect.fights ?? effect.wins, 0);
  } else if (effect.kind === "coin_boost") {
    effects.coinBoostPct = Math.max(effects.coinBoostPct, toPositiveInt(effect.pct, 0));
    effects.coinBoostWinsRemaining += toPositiveInt(effect.fights ?? effect.wins, 0);
  } else if (effect.kind === "reroll_keep_higher") {
    effects.rerollKeepHigherCharges += toPositiveInt(effect.charges, 1);
  } else if (effect.kind === "streak_shield") {
    effects.streakShieldCharges += toPositiveInt(effect.charges, 1);
  } else if (effect.kind === "upgrade_lowest_rarity") {
    effects.upgradeLowestRarityCharges += toPositiveInt(effect.charges, 1);
  } else if (effect.kind === "guarantee_ssr_plus") {
    effects.guaranteeSsrPlusCharges += toPositiveInt(effect.charges, 1);
  } else if (effect.kind === "shield_fight_start") {
    effects.fightStartShieldAmount = Math.max(
      effects.fightStartShieldAmount,
      toPositiveInt(effect.amount, 0),
    );
    effects.fightStartShieldCharges += toPositiveInt(effect.charges, 1);
  } else if (effect.kind === "evade_next_fight") {
    effects.evadeBoostPct = Math.max(effects.evadeBoostPct, toPositiveInt(effect.pct, 0));
    effects.evadeBoostFightsRemaining += toPositiveInt(effect.fights, 1);
  } else if (effect.kind === "first_hit_true_damage") {
    effects.firstHitTrueDamageValue = Math.max(
      effects.firstHitTrueDamageValue,
      toPositiveInt(effect.value, 0),
    );
    effects.firstHitTrueDamageCharges += toPositiveInt(effect.charges, 1);
  } else if (effect.kind === "bonus_vs_higher_rarity") {
    effects.higherRarityDamageBonusPct = Math.max(
      effects.higherRarityDamageBonusPct,
      toPositiveInt(effect.pct, 0),
    );
    effects.higherRarityDamageBonusPctCharges += toPositiveInt(effect.charges, 1);
  } else if (effect.kind === "cooldown_bypass") {
    effects.gateKeyCharges += toPositiveInt(effect.charges, 1);
  } else if (effect.kind === "double_passive_trigger") {
    effects.doublePassiveTriggerFightsRemaining += toPositiveInt(effect.fights, 1);
  } else if (effect.kind === "restore_consumable_charge") {
    const restored =
      effects.rerollKeepHigherCharges > 0
        ? "rerollKeepHigherCharges"
        : effects.upgradeLowestRarityCharges > 0
          ? "upgradeLowestRarityCharges"
          : effects.guaranteeSsrPlusCharges > 0
            ? "guaranteeSsrPlusCharges"
            : effects.streakShieldCharges > 0
              ? "streakShieldCharges"
              : effects.fightStartShieldCharges > 0
                ? "fightStartShieldCharges"
                : effects.gateKeyCharges > 0
                  ? "gateKeyCharges"
                  : effects.evadeBoostFightsRemaining > 0
                    ? "evadeBoostFightsRemaining"
                    : effects.firstHitTrueDamageCharges > 0
                      ? "firstHitTrueDamageCharges"
                      : effects.higherRarityDamageBonusPctCharges > 0
                        ? "higherRarityDamageBonusPctCharges"
                        : effects.expBoostWinsRemaining > 0
                          ? "expBoostWinsRemaining"
                          : effects.coinBoostWinsRemaining > 0
                            ? "coinBoostWinsRemaining"
                            : null;
    if (!restored) {
      throw new ArenaHttpError(
        409,
        "No eligible consumable charge to restore.",
        "ARENA_NO_CHARGE_TO_RESTORE",
      );
    }
    effects[restored] += toPositiveInt(effect.charges, 1);
  } else if (effect.kind === "ascension") {
    enforceAscensionCooldown(profile, item);
    profile.hp += 1;
    profile.power += 1;
    profile.guard += 1;
    profile.speed += 1;
    profile.luck += 1;
    effects.ascensionLastPurchasedAt = now;
  } else {
    throw new ArenaHttpError(400, "Unsupported consumable effect.");
  }

  return effects;
}

function equipShopItem(db, userId, itemId) {
  const item = SHOP_ITEMS_BY_ID.get(String(itemId || "").trim());
  if (!item) {
    throw new ArenaHttpError(404, "Item not found.", "ARENA_ITEM_NOT_FOUND");
  }
  if (item.type !== "gear" || !item.slot) {
    throw new ArenaHttpError(400, "Only gear can be equipped.", "ARENA_ITEM_NOT_GEAR");
  }

  const inventory = getInventoryMap(db, userId);
  if ((inventory.get(item.id)?.quantity || 0) <= 0) {
    throw new ArenaHttpError(403, "You do not own this gear.", "ARENA_GEAR_NOT_OWNED");
  }

  upsertEquippedItem(db, userId, item.slot, item.id);
  return {
    equippedItemId: item.id,
    slot: item.slot,
    shop: getArenaShopPayload(db, userId),
  };
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
      `UPDATE arena_profiles
       SET hp = ?, power = ?, guard = ?, speed = ?, luck = ?, effectsJson = ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(
      profile.hp,
      profile.power,
      profile.guard,
      profile.speed,
      profile.luck,
      serializeEffects(nextEffects),
      updatedAt,
      userId,
    );

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

function craftShopRecipe(db, userId, recipeId, quantityInput = 1) {
  const recipe = SHOP_RECIPES_BY_ID.get(String(recipeId || "").trim());
  if (!recipe) {
    throw new ArenaHttpError(404, "Recipe not found.", "ARENA_RECIPE_NOT_FOUND");
  }

  const quantity = clamp(toPositiveInt(quantityInput, 1), 1, 20);
  const outputItem = SHOP_ITEMS_BY_ID.get(recipe.output.itemId);
  if (!outputItem) {
    throw new ArenaHttpError(409, "Recipe output item missing.");
  }

  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    if (profile.level < recipe.unlockLevel) {
      throw new ArenaHttpError(403, "Level too low for this recipe.", "ARENA_RECIPE_LOCKED");
    }

    const inventory = getInventoryMap(db, userId);
    const craftCount = outputItem.type === "gear" ? 1 : quantity;
    const totalCoinCost = toInt(recipe.coinCost, 0) * craftCount;
    if (profile.coins < totalCoinCost) {
      throw new ArenaHttpError(400, "Not enough coins.", "ARENA_NOT_ENOUGH_COINS");
    }

    recipe.inputs.forEach((entry) => {
      const owned = inventory.get(entry.itemId)?.quantity || 0;
      const required = toInt(entry.quantity, 0) * craftCount;
      if (owned < required) {
        throw new ArenaHttpError(
          400,
          "Missing crafting materials.",
          "ARENA_RECIPE_MATERIALS_MISSING",
        );
      }
    });

    if (outputItem.type === "gear" && (inventory.get(outputItem.id)?.quantity || 0) > 0) {
      throw new ArenaHttpError(
        409,
        "Gear already owned.",
        "ARENA_GEAR_ALREADY_OWNED",
      );
    }

    recipe.inputs.forEach((entry) => {
      const required = toInt(entry.quantity, 0) * craftCount;
      upsertInventoryItem(db, userId, entry.itemId, -required);
    });
    upsertInventoryItem(
      db,
      userId,
      outputItem.id,
      toInt(recipe.output.quantity, 1) * craftCount,
    );

    if (outputItem.type === "gear" && outputItem.slot) {
      upsertEquippedItem(db, userId, outputItem.slot, outputItem.id);
    }

    profile.coins -= totalCoinCost;
    profile.updatedAt = nowIso();
    db.prepare("UPDATE arena_profiles SET coins = ?, updatedAt = ? WHERE userId = ?").run(
      profile.coins,
      profile.updatedAt,
      userId,
    );

    return {
      recipe,
      craftedQuantity: toInt(recipe.output.quantity, 1) * craftCount,
      outputItemId: outputItem.id,
    };
  });

  const result = tx();
  return {
    craftedRecipeId: result.recipe.id,
    outputItemId: result.outputItemId,
    craftedQuantity: result.craftedQuantity,
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

// ---------------------------------------------------------------------------
// Server-side fight playback (active fight persistence)
// ---------------------------------------------------------------------------

function getActiveFightRow(db, userId) {
  return db
    .prepare("SELECT * FROM arena_active_fights WHERE userId = ?")
    .get(userId);
}

function hasActiveFight(db, userId) {
  const row = getActiveFightRow(db, userId);
  return row ? row.state === "active" : false;
}

function deleteActiveFight(db, userId) {
  db.prepare("DELETE FROM arena_active_fights WHERE userId = ?").run(userId);
}

function getPlaybackFightState(db, userId) {
  const row = getActiveFightRow(db, userId);
  if (!row) return null;

  let simulation;
  try {
    simulation = JSON.parse(row.simulationJson);
  } catch {
    deleteActiveFight(db, userId);
    return null;
  }

  let opponent;
  try {
    opponent = JSON.parse(row.opponentJson);
  } catch {
    opponent = {};
  }

  const cursor = toInt(row.cursor, 0);
  const isFinished = row.state === "finished";
  const allTurns = Array.isArray(simulation.rounds) ? simulation.rounds : [];
  const totalTurns = allTurns.length;
  const revealedTurns = allTurns.slice(0, cursor);

  // Derive HP from the last revealed turn (or max HP if none yet)
  let playerHp = simulation.battle?.maxHp?.player ?? 0;
  let opponentHp = simulation.battle?.maxHp?.opponent ?? 0;
  let playerShield = simulation.battle?.initialShield?.player ?? 0;
  let opponentShield = simulation.battle?.initialShield?.opponent ?? 0;
  if (cursor > 0 && revealedTurns.length > 0) {
    const last = revealedTurns[revealedTurns.length - 1];
    playerHp = last.playerHp ?? playerHp;
    opponentHp = last.opponentHp ?? opponentHp;
    playerShield = last.playerShield ?? playerShield;
    opponentShield = last.opponentShield ?? opponentShield;
  }

  const consoleLines = Array.isArray(simulation.battle?.console)
    ? simulation.battle.console
    : [];

  return {
    fightId: row.fightId,
    cursor,
    totalTurns,
    isFinished,
    result: isFinished ? (simulation.playerWon ? "win" : "loss") : null,
    opponent,
    battle: {
      maxHp: simulation.battle?.maxHp ?? { player: 0, opponent: 0 },
      currentHp: { player: playerHp, opponent: opponentHp },
      currentShield: { player: playerShield, opponent: opponentShield },
      console: consoleLines,
    },
    turns: revealedTurns,
    score: {
      player: simulation.playerRoundsWon,
      opponent: simulation.opponentRoundsWon,
    },
    rewards: isFinished
      ? {
          xp: toPositiveInt(simulation.rewards?.xp, 0),
          coins: toPositiveInt(simulation.rewards?.coins, 0),
          rarityCoinReward: toPositiveInt(
            simulation.rewards?.rarityCoinReward,
            0,
          ),
          levelsGained: toPositiveInt(simulation.rewards?.levelsGained, 0),
          materialDrops: Array.isArray(simulation.rewards?.materialDrops)
            ? simulation.rewards.materialDrops
            : Array.isArray(simulation.materialDrops)
              ? simulation.materialDrops
              : [],
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function startPlaybackFight(db, userId) {
  await ensureArenaCardPool(db);

  const profile = ensureArenaProfile(db, userId);
  if (!profile.selectedCard) {
    throw new ArenaHttpError(
      409,
      "Draw a card to start.",
      "ARENA_CARD_REQUIRED",
    );
  }

  if (hasActiveFight(db, userId)) {
    const existing = getPlaybackFightState(db, userId);
    throw new ArenaHttpError(
      409,
      "A fight is already in progress. Finish it first.",
      "ARENA_FIGHT_ACTIVE",
      { activeFight: existing },
    );
  }

  const preflightEffects = normalizeArenaEffects(profile.effects);
  const cooldownResult = assertFightCooldown(profile, {
    effects: preflightEffects,
    allowGateKey: true,
  });
  // assertFightCooldown already decrements preflightEffects.gateKeyCharges internally

  const opponentSelection = await selectOpponentForFight(db, userId);
  const opponentProfile = opponentSelection.profile;

  const playerSnapshot = loadCombatSnapshot(db, profile);
  const opponentSnapshot = loadCombatSnapshot(db, opponentProfile);

  const simulation = await simulateFight(db, {
    player: playerSnapshot,
    opponent: opponentSnapshot,
    playerEffects: preflightEffects,
  });
  simulation.materialDrops = rollFightMaterialRewards();

  const now = nowIso();
  const fightId = makeId("fight");

  const tx = db.transaction(() => {
    if (hasActiveFight(db, userId)) {
      throw new ArenaHttpError(
        409,
        "A fight is already in progress.",
        "ARENA_FIGHT_ACTIVE",
      );
    }

    const current = ensureArenaProfile(db, userId);
    const effects = normalizeArenaEffects(current.effects);
    if (cooldownResult.bypassedWithGateKey && effects.gateKeyCharges > 0) {
      effects.gateKeyCharges -= 1;
    }

    db.prepare(
      `UPDATE arena_profiles
       SET effectsJson = ?, lastFightAt = ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(serializeEffects(effects), now, now, userId);

    db.prepare(
      `INSERT OR REPLACE INTO arena_active_fights (
        userId, fightId, cursor, state,
        simulationJson, opponentJson, playerEffectsJson,
        createdAt, updatedAt
      ) VALUES (?, ?, 0, 'active', ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      fightId,
      JSON.stringify(simulation),
      JSON.stringify({
        userId: opponentSelection.profile.userId,
        displayName: opponentSelection.displayName,
        isNpc: opponentSelection.isNpc,
        level: opponentSelection.profile.level,
        stats: opponentSnapshot.totalStats,
        equipment: opponentSnapshot.equipped,
        selectedCard: opponentSnapshot.selectedCard,
      }),
      JSON.stringify(preflightEffects),
      now,
      now,
    );
  });

  tx();

  return getPlaybackFightState(db, userId);
}

function advancePlaybackFightTurn(db, userId) {
  const row = getActiveFightRow(db, userId);
  if (!row) {
    throw new ArenaHttpError(
      404,
      "No active fight. Start one first.",
      "ARENA_NO_ACTIVE_FIGHT",
    );
  }

  if (row.state === "finished") {
    return getPlaybackFightState(db, userId);
  }

  let simulation;
  try {
    simulation = JSON.parse(row.simulationJson);
  } catch {
    deleteActiveFight(db, userId);
    throw new ArenaHttpError(500, "Fight data corrupted.");
  }

  const allTurns = Array.isArray(simulation.rounds) ? simulation.rounds : [];
  const totalTurns = allTurns.length;
  const nextCursor = Math.min(row.cursor + 1, totalTurns);
  const isNowFinished = nextCursor >= totalTurns;

  db.prepare(
    `UPDATE arena_active_fights
     SET cursor = ?, state = ?, updatedAt = ?
     WHERE userId = ?`,
  ).run(nextCursor, isNowFinished ? "finished" : "active", nowIso(), userId);

  if (isNowFinished) {
    finalizePlaybackFightRewards(db, userId);
  }

  return getPlaybackFightState(db, userId);
}

function skipPlaybackFightToEnd(db, userId) {
  const row = getActiveFightRow(db, userId);
  if (!row) {
    throw new ArenaHttpError(
      404,
      "No active fight. Start one first.",
      "ARENA_NO_ACTIVE_FIGHT",
    );
  }

  if (row.state === "finished") {
    return getPlaybackFightState(db, userId);
  }

  let simulation;
  try {
    simulation = JSON.parse(row.simulationJson);
  } catch {
    deleteActiveFight(db, userId);
    throw new ArenaHttpError(500, "Fight data corrupted.");
  }

  const totalTurns = Array.isArray(simulation.rounds)
    ? simulation.rounds.length
    : 0;

  db.prepare(
    `UPDATE arena_active_fights
     SET cursor = ?, state = 'finished', updatedAt = ?
     WHERE userId = ?`,
  ).run(totalTurns, nowIso(), userId);

  finalizePlaybackFightRewards(db, userId);

  return getPlaybackFightState(db, userId);
}

function finalizePlaybackFightRewards(db, userId) {
  const row = getActiveFightRow(db, userId);
  if (!row || row.state !== "finished") return null;

  let simulation;
  try {
    simulation = JSON.parse(row.simulationJson);
  } catch {
    return null;
  }
  if (simulation.rewards && typeof simulation.rewards === "object") {
    return { rewards: simulation.rewards };
  }

  let opponent;
  try {
    opponent = JSON.parse(row.opponentJson);
  } catch {
    opponent = {};
  }

  const tx = db.transaction(() => {
    const current = ensureArenaProfile(db, userId);
    const effects = normalizeArenaEffects(current.effects);

    // Gate key was already consumed at fight start in startPlaybackFight's tx.
    // Only apply the simulation-scoped effect usage (no usedGateKeyBypass).
    const effectUsage = simulation.effectUsage || {};
    const nextEffects = applyFightEffectUsage(effects, effectUsage);

    const currentSnapshot = loadCombatSnapshot(db, current);
    const rarityCoinReward = getWonRoundRarityCoinReward(simulation);

    let xpDelta = 1;
    let coinDelta = 0;

    if (simulation.playerWon) {
      let baseXp = calculateWinXp(
        opponent.level ?? 1,
        simulation.xpRoundsWon ?? 1,
        current.winStreak,
      );
      let baseCoins = calculateWinCoins(
        opponent.level ?? 1,
        rarityCoinReward,
        currentSnapshot.totalStats.luck,
      );
      baseXp = Math.floor(
        baseXp *
          (1 + Number(simulation?.passiveRewardBonus?.xpPct || 0) / 100),
      );
      baseCoins = Math.floor(
        baseCoins *
          (1 + Number(simulation?.passiveRewardBonus?.coinsPct || 0) / 100),
      );
      const adjusted = consumeWinBoosts(nextEffects, baseXp, baseCoins);
      xpDelta = adjusted.xpGain;
      coinDelta = adjusted.coinGain;
      current.wins += 1;
      current.winStreak += 1;
    } else {
      current.losses += 1;
      if (nextEffects.streakShieldCharges > 0) {
        nextEffects.streakShieldCharges -= 1;
      } else {
        current.winStreak = 0;
      }
    }

    consumeFightBoostDurations(nextEffects);

    const materialDrops = Array.isArray(simulation.materialDrops)
      ? simulation.materialDrops
      : [];
    materialDrops.forEach((drop) => {
      const item = SHOP_ITEMS_BY_ID.get(drop?.itemId);
      const quantity = clamp(toPositiveInt(drop?.quantity, 0), 0, 1);
      if (
        item?.type === "material" &&
        TIER_TO_INDEX.get(item.tier) <= 2 &&
        quantity > 0
      ) {
        upsertInventoryItem(db, current.userId, item.id, quantity);
      }
    });

    current.xp += xpDelta;
    current.coins += coinDelta;
    current.lifetimeCoinsEarned += coinDelta;
    const levelsGained = applyLevelUps(current);
    current.effects = nextEffects;
    current.updatedAt = nowIso();

    db.prepare(
      `UPDATE arena_profiles
       SET level = ?, xp = ?, coins = ?,
           wins = ?, losses = ?, winStreak = ?,
           hp = ?, power = ?, guard = ?, speed = ?, luck = ?,
           lifetimeCoinsEarned = ?, effectsJson = ?, updatedAt = ?
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
      current.updatedAt,
      current.userId,
    );

    db.prepare(
      `INSERT INTO arena_fights (
        id, userId, opponentUserId, result,
        roundsJson, xpDelta, coinDelta, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.fightId,
      current.userId,
      opponent.userId || "unknown",
      simulation.playerWon ? "win" : "loss",
      JSON.stringify(simulation.rounds),
      xpDelta,
      coinDelta,
      nowIso(),
    );

    const rewards = {
      xp: xpDelta,
      coins: coinDelta,
      rarityCoinReward,
      levelsGained,
      materialDrops,
    };
    simulation.rewards = rewards;
    db.prepare(
      `UPDATE arena_active_fights
       SET simulationJson = ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(JSON.stringify(simulation), nowIso(), userId);

    return {
      rewards,
    };
  });

  return tx();
}

module.exports = {
  ArenaHttpError,
  __test: {
    buildPassiveRuntime,
    calculateAttackOutcome,
    consumeTempGuard,
    getCardShopPrice,
    loadCombatSnapshot,
    rollFightMaterialRewards,
    runPassivesForTrigger,
    simulateFight,
  },
  advancePlaybackFightTurn,
  calculateRoundPower,
  calculateWinCoins,
  calculateWinXp,
  deleteActiveFight,
  drawDailyCard,
  activateArenaSkill,
  buyArenaShopCard,
  getArenaCollectionPayload,
  getArenaCardShopPayload,
  getArenaProfilePayload,
  getArenaSkillTreePayload,
  getArenaShopPayload,
  getCurrentRecordedDate,
  getLeaderboard,
  getPlaybackFightState,
  hasActiveFight,
  normalizeArenaEffects,
  rarityFromCharacterRank,
  runFight,
  resetArenaSkills,
  selectCollectionCard,
  resolveRoundWinner,
  skipPlaybackFightToEnd,
  startPlaybackFight,
  useConsumable,
  buyShopItem,
  craftShopRecipe,
  equipShopItem,
  xpToNext,
};
