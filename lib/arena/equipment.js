const {
  ARENA_EFFECT_DEFAULTS,
  BASE_PROFILE,
  CATALOG_VERSION,
  DAILY_CARD_DRAW_LIMIT,
  ELEMENT_EFFECTIVENESS,
  ELEMENTS,
  FIGHT_COOLDOWN_MS,
  LEVEL_UP_GAINS,
  MAX_LEVEL,
  MAX_DAILY_OPPONENT_COUNT,
  RARITY_CONFIG,
  RARITY_ORDER,
  ROLLABLE_EQUIPMENT,
  SHOP_ITEMS,
  SHOP_RECIPES,
  SHOP_TIERS,
  SUB_STAT_POOL,
} = require("../arena-constants");
const {
  drawArenaCard,
  ensureArenaCardPool,
  getArenaCharacterCatalog,
  rarityFromCharacterRank,
} = require("../arena-characters");
const {
  SKILL_TREE_BRANCHES,
  SKILL_TREE_NODES,
  SKILL_TREE_NODES_BY_ID,
  computeSkillBonuses,
} = require("../arena-skill-tree");

const { S2C } = require("../websocket-events");

function _wsEmit() {
  return require("../websocket-server").getWebSocketManager();
}

function _notifyUser(userId, type, data) {
  const w = _wsEmit();
  if (w) w.sendToUser(userId, { type, data });
}

function _notifyUsers(userIds, type, data) {
  const w = _wsEmit();
  if (w) w.sendToUsers(userIds, { type, data });
}

function _notifyUnreadCount(userId) {
  const w = _wsEmit();
  if (w) {
    const db = require("../db").db;
    const count = db
      .prepare(`SELECT COUNT(*) AS count FROM arena_notifications WHERE userId = ? AND isRead = 0`)
      .get(userId)?.count;
    w.sendToUser(userId, { type: S2C.ARENA_NOTIFICATION_UNREAD_COUNT, data: { count: count || 0 } });
  }
}

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
const CARD_SHOP_RANDOM_PRICE = 2500;
const CARD_SHOP_GENERATION_ATTEMPTS = 60;
const MARKET_MIN_PRICE = 1;
const MARKET_MAX_PRICE = 1_000_000;
const MARKET_MAX_ACTIVE_LISTINGS = 20;
const MARKET_MAX_PAGE_SIZE = 50;
const MARKET_SALES_SAMPLE_SIZE = 30;
const ARENA_UPDATE_MAX_TITLE_LENGTH = 100;
const ARENA_UPDATE_MAX_BODY_LENGTH = 1000;
const MAX_TRADE_LISTINGS = 20;
const TRADE_SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const MARKET_IV_BANDS = Object.freeze([
  { id: "0-31", min: 0, max: 31 },
  { id: "32-62", min: 32, max: 62 },
  { id: "63-93", min: 63, max: 93 },
  { id: "94-124", min: 94, max: 124 },
]);

const SHOP_ITEMS_BY_ID = new Map(SHOP_ITEMS.map((item) => [item.id, item]));
const SHOP_RECIPES_BY_ID = new Map(SHOP_RECIPES.map((recipe) => [recipe.id, recipe]));
const TIER_TO_INDEX = new Map(SHOP_TIERS.map((tier, index) => [tier, index]));
const SLOT_ORDER = ["weapon", "armor", "charm"];
const RARITY_TO_RANK = new Map(RARITY_ORDER.map((rarity, index) => [rarity, index]));
const ELO_DEFAULT_RATING = 1000;
const ELO_MIN_RATING = 100;
const ELO_PROVISIONAL_MATCHES = 10;
const ELO_PROVISIONAL_K = 48;
const ELO_ESTABLISHED_K = 24;
const ELO_VETERAN_K = 16;
const ELO_VETERAN_MATCHES = 60;
const ELO_SCALE = 400;
const ELO_MAX_DELTA_PROVISIONAL = 48;
const ELO_MAX_DELTA_ESTABLISHED = 32;
const ELO_MATCHMAKING_POOL_SIZE = 5;
const ELO_MATCHMAKING_CANDIDATE_LIMIT = 20;
const RECENT_OPPONENT_LIMIT = 5;
const EFFECT_DURATION_LIMITS = Object.freeze({
  expBoostWinsRemaining: 500,
  coinBoostWinsRemaining: 40,
  drawBonusChanceWinsRemaining: 60,
  rerollKeepHigherCharges: 4,
  streakShieldCharges: 6,
  upgradeLowestRarityCharges: 6,
  guaranteeSsrPlusCharges: 6,
  fightStartShieldCharges: 2000,
  evadeBoostFightsRemaining: 500,
  firstHitTrueDamageCharges: 500,
  higherRarityDamageBonusPctCharges: 1000,
  gateKeyCharges: 4,
  doublePassiveTriggerFightsRemaining: 1000,
  damageBoostFightsRemaining: 500,
  speedBoostFightsRemaining: 500,
  deathSaveCharges: 1000,
  statSteroidFightsRemaining: 1000,
  matchRarityCharges: 1500,
  vampiricHealFightsRemaining: 1000,
  critChanceBoostFightsRemaining: 500,
  guardBoostFightsRemaining: 500,
  firstAttackDoubleCharges: 1000,
  ivBoostCharges: 500,
  selfReviveCharges: 1000,
});

function tierToIndex(tier) {
  return TIER_TO_INDEX.get(tier) ?? 0;
}

function getCardShopPrice(rarity) {
  const normalizedRarity = String(rarity || "").trim().toUpperCase();
  return CARD_SHOP_PRICES[normalizedRarity] ?? CARD_SHOP_MAX_PRICE;
}

function isRandomCardOfferAvailable(recordedDate = getCurrentRecordedDate()) {
  const day = new Date(recordedDate + "T00:00:00Z").getUTCDay();
  return day === 0 || day === 2 || day === 4 || day === 6;
}

function getMarketIvBand(ivTotal) {
  const total = clamp(toPositiveInt(ivTotal, 0), 0, CARD_IV_MAX * 4);
  return (
    MARKET_IV_BANDS.find((band) => total >= band.min && total <= band.max) ||
    MARKET_IV_BANDS[0]
  );
}

// ArenaHttpError imported from ./utils


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
  return 80 + 25 * currentLevel * currentLevel;
}

function isEloProvisional(matches) {
  return toPositiveInt(matches, 0) < ELO_PROVISIONAL_MATCHES;
}

function getEloKFactor(matches) {
  if (isEloProvisional(matches)) return ELO_PROVISIONAL_K;
  if (toPositiveInt(matches, 0) < ELO_VETERAN_MATCHES) return ELO_ESTABLISHED_K;
  return ELO_VETERAN_K;
}

function calculateEloExchange(winner, loser) {
  const winnerRating = Math.max(
    toInt(winner?.eloRating, ELO_DEFAULT_RATING),
    ELO_MIN_RATING,
  );
  const loserRating = Math.max(
    toInt(loser?.eloRating, ELO_DEFAULT_RATING),
    ELO_MIN_RATING,
  );

  // Use per-player K-factors instead of a shared one
  const winnerK = getEloKFactor(winner?.eloMatches);
  const loserK = getEloKFactor(loser?.eloMatches);

  // Standard ELO expected score (no rounding)
  const ratingDiff = loserRating - winnerRating;
  const winnerExpected = 1 / (1 + Math.pow(10, ratingDiff / ELO_SCALE));

  // Delta: loser transfers points to winner
  // Use average K-factor for a balanced exchange
  const avgK = Math.round((winnerK + loserK) / 2);
  const rawDelta = Math.round(avgK * (1 - winnerExpected));

  // Cap delta per match — protects established players from huge swings
  const maxDelta =
    isEloProvisional(winner?.eloMatches) || isEloProvisional(loser?.eloMatches)
      ? ELO_MAX_DELTA_PROVISIONAL
      : ELO_MAX_DELTA_ESTABLISHED;
  const delta = Math.min(rawDelta, maxDelta, loserRating - ELO_MIN_RATING);

  // When the rating gap is very large (>600), reduce the exchange further
  // to prevent established players from farming or dumping rating
  const largeGapPenalty =
    Math.abs(ratingDiff) > 600 ? 0.5 + (600 / (Math.abs(ratingDiff) + 600)) : 1;
  const finalDelta = Math.round(Math.max(1, delta * largeGapPenalty));

  return {
    kFactor: avgK,
    delta: finalDelta,
    winnerBefore: winnerRating,
    winnerAfter: winnerRating + finalDelta,
    loserBefore: loserRating,
    loserAfter: loserRating - finalDelta,
  };
}

function clampEffectDuration(key, value) {
  return clamp(
    toPositiveInt(value),
    0,
    EFFECT_DURATION_LIMITS[key] ?? Number.MAX_SAFE_INTEGER,
  );
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
    expBoostWinsRemaining: clampEffectDuration(
      "expBoostWinsRemaining",
      parsed.expBoostWinsRemaining,
    ),
    coinBoostPct: clamp(toPositiveInt(parsed.coinBoostPct), 0, 200),
    coinBoostWinsRemaining: clampEffectDuration(
      "coinBoostWinsRemaining",
      parsed.coinBoostWinsRemaining,
    ),
    drawBonusChancePct: clamp(toPositiveInt(parsed.drawBonusChancePct), 0, 100),
    drawBonusChanceWinsRemaining: clampEffectDuration(
      "drawBonusChanceWinsRemaining",
      parsed.drawBonusChanceWinsRemaining,
    ),
    rerollKeepHigherCharges: clampEffectDuration(
      "rerollKeepHigherCharges",
      parsed.rerollKeepHigherCharges ?? parsed.refocusCharges,
    ),
    streakShieldCharges: clampEffectDuration(
      "streakShieldCharges",
      parsed.streakShieldCharges,
    ),
    upgradeLowestRarityCharges: clampEffectDuration(
      "upgradeLowestRarityCharges",
      parsed.upgradeLowestRarityCharges,
    ),
    guaranteeSsrPlusCharges: clampEffectDuration(
      "guaranteeSsrPlusCharges",
      parsed.guaranteeSsrPlusCharges,
    ),
    ascensionLastPurchasedAt:
      typeof parsed.ascensionLastPurchasedAt === "string" &&
      parsed.ascensionLastPurchasedAt
        ? parsed.ascensionLastPurchasedAt
        : null,
    fightStartShieldCharges: clampEffectDuration(
      "fightStartShieldCharges",
      parsed.fightStartShieldCharges,
    ),
    fightStartShieldAmount: clamp(toPositiveInt(parsed.fightStartShieldAmount), 0, 9999),
    evadeBoostPct: clamp(toPositiveInt(parsed.evadeBoostPct), 0, 95),
    evadeBoostFightsRemaining: clampEffectDuration(
      "evadeBoostFightsRemaining",
      parsed.evadeBoostFightsRemaining,
    ),
    firstHitTrueDamageCharges: clampEffectDuration(
      "firstHitTrueDamageCharges",
      parsed.firstHitTrueDamageCharges,
    ),
    firstHitTrueDamageValue: clamp(toPositiveInt(parsed.firstHitTrueDamageValue), 0, 9999),
    higherRarityDamageBonusPctCharges: clampEffectDuration(
      "higherRarityDamageBonusPctCharges",
      parsed.higherRarityDamageBonusPctCharges,
    ),
    higherRarityDamageBonusPct: clamp(
      toPositiveInt(parsed.higherRarityDamageBonusPct),
      0,
      300,
    ),
    gateKeyCharges: clampEffectDuration("gateKeyCharges", parsed.gateKeyCharges),
    doublePassiveTriggerFightsRemaining: clampEffectDuration(
      "doublePassiveTriggerFightsRemaining",
      parsed.doublePassiveTriggerFightsRemaining,
    ),
    damageBoostPct: clamp(toPositiveInt(parsed.damageBoostPct), 0, 200),
    damageBoostFightsRemaining: clampEffectDuration("damageBoostFightsRemaining", parsed.damageBoostFightsRemaining),
    speedBoostPct: clamp(toPositiveInt(parsed.speedBoostPct), 0, 200),
    speedBoostFightsRemaining: clampEffectDuration("speedBoostFightsRemaining", parsed.speedBoostFightsRemaining),
    deathSaveCharges: clampEffectDuration("deathSaveCharges", parsed.deathSaveCharges),
    statSteroidPct: clamp(toPositiveInt(parsed.statSteroidPct), 0, 200),
    statSteroidFightsRemaining: clampEffectDuration("statSteroidFightsRemaining", parsed.statSteroidFightsRemaining),
    matchRarityCharges: clampEffectDuration("matchRarityCharges", parsed.matchRarityCharges),
    vampiricHealPct: clamp(toPositiveInt(parsed.vampiricHealPct), 0, 100),
    vampiricHealFightsRemaining: clampEffectDuration("vampiricHealFightsRemaining", parsed.vampiricHealFightsRemaining),
    critChanceBoostPct: clamp(toPositiveInt(parsed.critChanceBoostPct), 0, 200),
    critChanceBoostFightsRemaining: clampEffectDuration("critChanceBoostFightsRemaining", parsed.critChanceBoostFightsRemaining),
    guardBoostPct: clamp(toPositiveInt(parsed.guardBoostPct), 0, 200),
    guardBoostFightsRemaining: clampEffectDuration("guardBoostFightsRemaining", parsed.guardBoostFightsRemaining),
    firstAttackDoubleCharges: clampEffectDuration("firstAttackDoubleCharges", parsed.firstAttackDoubleCharges),
    ivBoostCharges: clampEffectDuration("ivBoostCharges", parsed.ivBoostCharges),
    selfReviveHpThresholdPct: clamp(toPositiveInt(parsed.selfReviveHpThresholdPct), 0, 95),
    selfReviveCharges: clampEffectDuration("selfReviveCharges", parsed.selfReviveCharges),
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
  const ivEffectHit = clamp(toPositiveInt(iv.effectHit, 0), CARD_IV_MIN, CARD_IV_MAX);

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
    element: ELEMENTS.includes(source.element) ? source.element : null,
    from: typeof source.from === "string" ? source.from.trim() || null : null,
    iv: {
      power: ivPower,
      guard: ivGuard,
      speed: ivSpeed,
      effectHit: ivEffectHit,
      total: ivPower + ivGuard + ivSpeed + ivEffectHit,
    },
    drawnAt: typeof source.drawnAt === "string" ? source.drawnAt : null,
    rainbow: !!source.rainbow,
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

function countCollectionCards(db, userId, search = "", element = "", ivFilters = {}, duplicates = false) {
  const term = String(search || "").trim();
  const elem = String(element || "").trim();
  const minPower = toPositiveInt(ivFilters.minPower, 0) || 0;
  const minGuard = toPositiveInt(ivFilters.minGuard, 0) || 0;
  const minSpeed = toPositiveInt(ivFilters.minSpeed, 0) || 0;
  const minLuck  = toPositiveInt(ivFilters.minLuck, 0) || 0;
  const hasIv = minPower > 0 || minGuard > 0 || minSpeed > 0 || minLuck > 0;
  const hasSearch = !!term;
  const hasElement = !!elem;
  const showDuplicates = !!duplicates;

  if (!hasSearch && !hasElement && !hasIv && !showDuplicates) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM arena_card_collection
         WHERE userId = ?`,
      )
      .get(userId);
    return Number(row?.total || 0);
  }

  const conditions = ["userId = ?"];
  const params = [userId];

  if (hasSearch) {
    const like = `%${term}%`;
    conditions.push(`(LOWER(json_extract(cardJson, '$.title')) LIKE LOWER(?)
      OR LOWER(json_extract(cardJson, '$.rarity')) LIKE LOWER(?)
      OR LOWER(json_extract(cardJson, '$.from')) LIKE LOWER(?)
      OR CAST(json_extract(cardJson, '$.malId') AS TEXT) LIKE ?)`);
    params.push(like, like, like, like);
  }

  if (hasElement) {
    conditions.push("json_extract(cardJson, '$.element') = ?");
    params.push(elem);
  }

  if (showDuplicates) {
    conditions.push(`json_extract(cardJson, '$.malId') IN (
      SELECT json_extract(cardJson, '$.malId')
      FROM arena_card_collection
      WHERE userId = ?
      GROUP BY json_extract(cardJson, '$.malId')
      HAVING COUNT(*) > 1
    )`);
    params.push(userId);
  }

  if (minPower > 0) {
    conditions.push("CAST(json_extract(cardJson, '$.iv.power') AS INTEGER) >= ?");
    params.push(minPower);
  }
  if (minGuard > 0) {
    conditions.push("CAST(json_extract(cardJson, '$.iv.guard') AS INTEGER) >= ?");
    params.push(minGuard);
  }
  if (minSpeed > 0) {
    conditions.push("CAST(json_extract(cardJson, '$.iv.speed') AS INTEGER) >= ?");
    params.push(minSpeed);
  }
  if (minLuck > 0) {
    conditions.push("CAST(json_extract(cardJson, '$.iv.effectHit') AS INTEGER) >= ?");
    params.push(minLuck);
  }

  const row = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM arena_card_collection
       WHERE ${conditions.join(" AND ")}`,
    )
    .get(...params);
  return Number(row?.total || 0);
}

function readCollectionCards(db, userId, { limit = 24, offset = 0, sort = "recent", search = "", element = "", minPower = 0, minGuard = 0, minSpeed = 0, minLuck = 0, duplicates = false } = {}) {
  let orderBy = "createdAt DESC";
  if (sort === "rarity-desc" || sort === "RH") {
    orderBy = `(CASE json_extract(cardJson, '$.rarity')
      WHEN 'UR' THEN 4
      WHEN 'SSR' THEN 3
      WHEN 'SR' THEN 2
      WHEN 'R' THEN 1
      ELSE 0
    END) DESC, createdAt DESC`;
  } else if (sort === "rarity-asc" || sort === "RL") {
    orderBy = `(CASE json_extract(cardJson, '$.rarity')
      WHEN 'UR' THEN 4
      WHEN 'SSR' THEN 3
      WHEN 'SR' THEN 2
      WHEN 'R' THEN 1
      ELSE 0
    END) ASC, createdAt DESC`;
  } else if (sort === "iv-desc" || sort === "IH") {
    orderBy = "(json_extract(cardJson, '$.iv.total')) DESC, createdAt DESC";
  } else if (sort === "iv-asc" || sort === "IL") {
    orderBy = "(json_extract(cardJson, '$.iv.total')) ASC, createdAt DESC";
  } else if (sort === "power-desc") {
    orderBy = "CAST(json_extract(cardJson, '$.iv.power') AS INTEGER) DESC, createdAt DESC";
  } else if (sort === "guard-desc") {
    orderBy = "CAST(json_extract(cardJson, '$.iv.guard') AS INTEGER) DESC, createdAt DESC";
  } else if (sort === "speed-desc") {
    orderBy = "CAST(json_extract(cardJson, '$.iv.speed') AS INTEGER) DESC, createdAt DESC";
  } else if (sort === "effectHit-desc") {
    orderBy = "CAST(json_extract(cardJson, '$.iv.effectHit') AS INTEGER) DESC, createdAt DESC";
  }

  const term = String(search || "").trim();
  const elem = String(element || "").trim();
  const mP = toPositiveInt(minPower, 0) || 0;
  const mG = toPositiveInt(minGuard, 0) || 0;
  const mS = toPositiveInt(minSpeed, 0) || 0;
  const mL = toPositiveInt(minLuck, 0) || 0;

  const conditions = ["userId = ?"];
  const params = [userId];

  if (term) {
    const like = `%${term}%`;
    conditions.push(`(LOWER(json_extract(cardJson, '$.title')) LIKE LOWER(?)
      OR LOWER(json_extract(cardJson, '$.rarity')) LIKE LOWER(?)
      OR LOWER(json_extract(cardJson, '$.from')) LIKE LOWER(?)
      OR CAST(json_extract(cardJson, '$.malId') AS TEXT) LIKE ?)`);
    params.push(like, like, like, like);
  }

  if (elem) {
    conditions.push("json_extract(cardJson, '$.element') = ?");
    params.push(elem);
  }

  if (duplicates) {
    conditions.push(`json_extract(cardJson, '$.malId') IN (
      SELECT json_extract(cardJson, '$.malId')
      FROM arena_card_collection
      WHERE userId = ?
      GROUP BY json_extract(cardJson, '$.malId')
      HAVING COUNT(*) > 1
    )`);
    params.push(userId);
  }

  if (mP > 0) {
    conditions.push("CAST(json_extract(cardJson, '$.iv.power') AS INTEGER) >= ?");
    params.push(mP);
  }
  if (mG > 0) {
    conditions.push("CAST(json_extract(cardJson, '$.iv.guard') AS INTEGER) >= ?");
    params.push(mG);
  }
  if (mS > 0) {
    conditions.push("CAST(json_extract(cardJson, '$.iv.speed') AS INTEGER) >= ?");
    params.push(mS);
  }
  if (mL > 0) {
    conditions.push("CAST(json_extract(cardJson, '$.iv.effectHit') AS INTEGER) >= ?");
    params.push(mL);
  }

  params.push(toPositiveInt(limit, 24), toPositiveInt(offset, 0));

  const sql = `SELECT cardJson, isFavorite
    FROM arena_card_collection
    WHERE ${conditions.join(" AND ")}
    ORDER BY isFavorite DESC, ${orderBy}
    LIMIT ? OFFSET ?`;

  const rows = db
    .prepare(sql)
    .all(...params);

  return rows
    .map((row) => {
      const card = normalizeSelectedCard(row.cardJson);
      if (!card) return null;
      card.isFavorite = !!row.isFavorite;
      return card;
    })
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
  const ivEffectHit = randomInt(ivMin, ivMax, randomFn);

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
    element: ELEMENTS.includes(malCard.element) ? malCard.element : null,
    from: malCard.from || null,
    rarity,
    iv: {
      power: ivPower,
      guard: ivGuard,
      speed: ivSpeed,
      effectHit: ivEffectHit,
      total: ivPower + ivGuard + ivSpeed + ivEffectHit,
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
    effectHit: Math.max(toInt(row.effectHit, BASE_PROFILE.effectHit), 1),
    lifetimeCoinsEarned: Math.max(
      toInt(row.lifetimeCoinsEarned, BASE_PROFILE.lifetimeCoinsEarned),
      0,
    ),
    eloRating: Math.max(
      toInt(row.eloRating, BASE_PROFILE.eloRating),
      ELO_MIN_RATING,
    ),
    eloMatches: Math.max(
      toInt(row.eloMatches, BASE_PROFILE.eloMatches),
      0,
    ),
    peakElo: Math.max(
      toInt(row.peakElo, BASE_PROFILE.peakElo),
      ELO_MIN_RATING,
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
    dailyOpponentCount: Math.max(toInt(row.dailyOpponentCount, 0), 0),
    lastOpponentDate: typeof row.lastOpponentDate === "string" && row.lastOpponentDate ? row.lastOpponentDate : null,
    tutorialComplete: !!row.tutorialComplete,
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
      effectHit,
      lifetimeCoinsEarned,
      eloRating,
      eloMatches,
      peakElo,
      selectedCardJson,
      lastCardDrawDate,
      dailyCardDrawCount,
      catalogVersion,
      effectsJson,
      lastFightAt,
      tutorialComplete,
      createdAt,
      updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    BASE_PROFILE.effectHit,
    BASE_PROFILE.lifetimeCoinsEarned,
    BASE_PROFILE.eloRating,
    BASE_PROFILE.eloMatches,
    BASE_PROFILE.peakElo,
    null,
    null,
    0,
    CATALOG_VERSION,
    serializeEffects(ARENA_EFFECT_DEFAULTS),
    null,
    0,
    now,
    now,
  );
}

// Gear refund amounts by item ID for catalog v2→v3 migration.
// Approximates the original recipe coin cost per gear item.
const GEAR_REFUND_MAP = {
  rustblade_weapon: 830,
  twigbow_weapon: 890,
  patchwork_helm: 1010,
  copper_ring: 1010,
  riversteel_saber: 3110,
  guard_cap: 3230,
  iron_cuirass: 3470,
  azure_ring: 3650,
  dawnfang_blade: 9800,
  knight_helm: 10200,
  laurel_pendant: 10600,
  verdant_core: 11000,
  twinlight_blades: 41200,
  waraxe_howl: 42200,
  sky_hood: 43200,
  violet_core: 44200,
  reaper_glaive: 142000,
  wyrm_hood: 144000,
  titan_greaves: 146000,
  crimson_core: 148000,
  orbit_scepter: 472000,
  aegis_crown: 474000,
  azure_core: 476000,
  void_core: 478000,
};

function migrateProfileToCatalogV3(db, profile) {
  if (profile.catalogVersion === CATALOG_VERSION) return;

  const now = nowIso();
  const tx = db.transaction(() => {
    const inventoryRows = getInventoryRows(db, profile.userId);
    const equipmentRows = getEquippedRows(db, profile.userId);
    let refundCoins = 0;

    // Count gear items in inventory
    const gearOwned = new Set();
    inventoryRows.forEach((row) => {
      const quantity = Math.max(toInt(row.quantity, 0), 0);
      if (quantity <= 0) return;
      const refund = GEAR_REFUND_MAP[row.itemId];
      if (refund) {
        refundCoins += refund * quantity;
        gearOwned.add(row.itemId);
      }
    });

    // Count gear items in equipment
    equipmentRows.forEach((row) => {
      const refund = GEAR_REFUND_MAP[row.itemId];
      if (refund && !gearOwned.has(row.itemId)) {
        refundCoins += refund;
        gearOwned.add(row.itemId);
      }
    });

    // Delete gear rows from arena_inventory
    const gearIds = Object.keys(GEAR_REFUND_MAP);
    if (gearIds.length > 0) {
      const placeholders = gearIds.map(() => "?").join(",");
      db.prepare(
        `DELETE FROM arena_inventory WHERE userId = ? AND itemId IN (${placeholders})`,
      ).run(profile.userId, ...gearIds);
    }

    // Drop old arena_equipment rows
    db.prepare("DELETE FROM arena_equipment WHERE userId = ?").run(profile.userId);

    // Update profile coins + catalog version
    db.prepare(
      `UPDATE arena_profiles
       SET coins = ?,
           catalogVersion = ?,
           updatedAt = ?
       WHERE userId = ?`,
    ).run(
      Math.max(toInt(profile.coins, 0) + refundCoins, 0),
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
    migrateProfileToCatalogV3(db, profile);
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

function getEquipmentPiecesRows(db, userId) {
  return db
    .prepare(
      `SELECT id, userId, slot, mainStatType, mainStatValue, subStats, equipped, createdAt
       FROM arena_equipment_pieces
       WHERE userId = ?
       ORDER BY createdAt ASC`,
    )
    .all(userId);
}

function getEquippedPiecesRows(db, userId) {
  return db
    .prepare(
      `SELECT id, userId, slot, mainStatType, mainStatValue, subStats, equipped, createdAt
       FROM arena_equipment_pieces
       WHERE userId = ? AND equipped = 1`,
    )
    .all(userId);
}

function getEquippedPieceBySlot(db, userId, slot) {
  return db
    .prepare(
      `SELECT id, userId, slot, mainStatType, mainStatValue, subStats, equipped, createdAt
       FROM arena_equipment_pieces
       WHERE userId = ? AND slot = ? AND equipped = 1`,
    )
    .get(userId, slot) || null;
}

function insertEquipmentPiece(db, userId, piece) {
  const now = nowIso();
  const id = makeId("eqp");
  db.prepare(
    `INSERT INTO arena_equipment_pieces (id, userId, slot, mainStatType, mainStatValue, subStats, equipped, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, userId, piece.slot, piece.mainStatType, piece.mainStatValue, JSON.stringify(piece.subStats), now);
  return id;
}

function equipEquipmentPiece(db, userId, pieceId) {
  const piece = db
    .prepare(
      `SELECT id, userId, slot FROM arena_equipment_pieces WHERE id = ? AND userId = ?`,
    )
    .get(pieceId, userId);
  if (!piece) {
    throw new ArenaHttpError(404, "Equipment piece not found.", "ARENA_PIECE_NOT_FOUND");
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE arena_equipment_pieces SET equipped = 0 WHERE userId = ? AND slot = ? AND equipped = 1`,
    ).run(userId, piece.slot);
    db.prepare(
      `UPDATE arena_equipment_pieces SET equipped = 1 WHERE id = ? AND userId = ?`,
    ).run(pieceId, userId);
  });
  tx();
}

function unequipEquipmentSlot(db, userId, slot) {
  db.prepare(
    `UPDATE arena_equipment_pieces SET equipped = 0 WHERE userId = ? AND slot = ? AND equipped = 1`,
  ).run(userId, slot);
}

function fodderEquipmentPiece(db, userId, pieceId, refundAmount) {
  const piece = db.prepare(
    "SELECT equipped FROM arena_equipment_pieces WHERE id = ? AND userId = ?",
  ).get(pieceId, userId);
  if (!piece) throw new ArenaHttpError(404, "Piece not found.", "ARENA_PIECE_NOT_FOUND");
  if (piece.equipped) throw new ArenaHttpError(400, "Unequip before foddering.", "ARENA_PIECE_EQUIPPED");

  const FODDER_PRICE = typeof refundAmount === "number" && refundAmount > 0 ? refundAmount : 500;
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM arena_equipment_pieces WHERE id = ? AND userId = ?").run(pieceId, userId);
    db.prepare("UPDATE arena_profiles SET coins = coins + ?, updatedAt = ? WHERE userId = ?").run(FODDER_PRICE, now, userId);
  });
  tx();
  return { fodderPieceId: pieceId, coinsGained: FODDER_PRICE };
}

const MAX_LOADOUTS = 5;

function getEquipmentLoadouts(db, userId) {
  const rows = db
    .prepare(
      `SELECT id, name, weaponPieceId, armorPieceId, charmPieceId, createdAt
       FROM arena_equipment_loadouts
       WHERE userId = ?
       ORDER BY createdAt DESC`,
    )
    .all(userId);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    weaponPieceId: row.weaponPieceId || null,
    armorPieceId: row.armorPieceId || null,
    charmPieceId: row.charmPieceId || null,
    createdAt: row.createdAt,
  }));
}

function saveEquipmentLoadout(db, userId, name) {
  const cleanName = String(name || "").trim().slice(0, 40) || "Loadout";
  const existing = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM arena_equipment_loadouts WHERE userId = ?`,
    )
    .get(userId);
  if (existing.cnt >= MAX_LOADOUTS) {
    throw new ArenaHttpError(
      409,
      `You can only save up to ${MAX_LOADOUTS} loadouts.`,
      "ARENA_LOADOUT_LIMIT",
    );
  }

  const equipped = getEquippedPiecesRows(db, userId);
  const pieceBySlot = {};
  equipped.forEach((p) => {
    pieceBySlot[p.slot] = p.id;
  });

  const id = makeId("ld");
  const now = nowIso();
  db.prepare(
    `INSERT INTO arena_equipment_loadouts (id, userId, name, weaponPieceId, armorPieceId, charmPieceId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    cleanName,
    pieceBySlot.weapon || null,
    pieceBySlot.armor || null,
    pieceBySlot.charm || null,
    now,
  );

  return {
    id,
    name: cleanName,
    weaponPieceId: pieceBySlot.weapon || null,
    armorPieceId: pieceBySlot.armor || null,
    charmPieceId: pieceBySlot.charm || null,
    createdAt: now,
  };
}

function restoreEquipmentLoadout(db, userId, loadoutId) {
  const loadout = db
    .prepare(
      `SELECT id, userId, weaponPieceId, armorPieceId, charmPieceId
       FROM arena_equipment_loadouts
       WHERE id = ? AND userId = ?`,
    )
    .get(loadoutId, userId);
  if (!loadout) {
    throw new ArenaHttpError(
      404,
      "Loadout not found.",
      "ARENA_LOADOUT_NOT_FOUND",
    );
  }

  const slots = ["weapon", "armor", "charm"];
  const pieceIds = [loadout.weaponPieceId, loadout.armorPieceId, loadout.charmPieceId];
  const restored = [];

  const tx = db.transaction(() => {
    slots.forEach((slot, i) => {
      const pieceId = pieceIds[i];
      if (!pieceId) return;

      const piece = db
        .prepare(
          `SELECT id FROM arena_equipment_pieces WHERE id = ? AND userId = ?`,
        )
        .get(pieceId, userId);
      if (!piece) return;

      db.prepare(
        `UPDATE arena_equipment_pieces SET equipped = 0 WHERE userId = ? AND slot = ? AND equipped = 1`,
      ).run(userId, slot);
      db.prepare(
        `UPDATE arena_equipment_pieces SET equipped = 1 WHERE id = ? AND userId = ?`,
      ).run(pieceId, userId);
      restored.push(slot);
    });
  });
  tx();

  return { loadoutId, restored };
}

function deleteEquipmentLoadout(db, userId, loadoutId) {
  const result = db
    .prepare(`DELETE FROM arena_equipment_loadouts WHERE id = ? AND userId = ?`)
    .run(loadoutId, userId);
  if (result.changes === 0) {
    throw new ArenaHttpError(
      404,
      "Loadout not found.",
      "ARENA_LOADOUT_NOT_FOUND",
    );
  }
  return { success: true, loadoutId };
}

function rollInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollEquipmentPiece(slot) {
  const equipmentDef = ROLLABLE_EQUIPMENT.find((e) => e.slot === slot);
  if (!equipmentDef) return null;

  let mainStatType;
  let mainStatValue;

  if (equipmentDef.mainStat.type === "random") {
    const chosen = equipmentDef.mainStat.options[Math.floor(Math.random() * equipmentDef.mainStat.options.length)];
    mainStatType = chosen.type;
    mainStatValue = rollInRange(chosen.min, chosen.max);
  } else {
    mainStatType = equipmentDef.mainStat.type;
    mainStatValue = rollInRange(equipmentDef.mainStat.min, equipmentDef.mainStat.max);
  }

  // Pick 4 unique sub-stats
  const pool = [...SUB_STAT_POOL.pool];
  const subStats = [];
  for (let i = 0; i < SUB_STAT_POOL.count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const type = pool.splice(idx, 1)[0];
    const range = SUB_STAT_POOL.ranges[type];
    subStats.push({ type, value: rollInRange(range[0], range[1]) });
  }

  return { slot, mainStatType, mainStatValue, subStats };
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

function computeEquipmentStats(db, userId) {
  const pieceRows = getEquippedPiecesRows(db, userId);
  const flatStats = {
    hp: 0,
    power: 0,
    guard: 0,
    speed: 0,
    effectHit: 0,
  };
  const pctStats = {
    hpPct: 0,
    dmgPct: 0,
    defendPct: 0,
    critChancePct: 0,
    critDmgPct: 0,
  };
  const equipped = {
    weapon: null,
    armor: null,
    charm: null,
  };

  pieceRows.forEach((row) => {
    let subStatsArray = [];
    try { subStatsArray = JSON.parse(row.subStats || "[]"); } catch { /* keep empty */ }

    const pieceData = {
      id: row.id,
      slot: row.slot,
      mainStatType: row.mainStatType,
      mainStatValue: row.mainStatValue,
      subStats: subStatsArray,
      createdAt: row.createdAt,
    };
    equipped[row.slot] = pieceData;

    // Main stat
    let mainVal = Number(row.mainStatValue) || 0;
    switch (row.mainStatType) {
      case "hp": flatStats.hp += mainVal; break;
      case "power": flatStats.power += mainVal; break;
      case "guard": flatStats.guard += mainVal; break;
      case "critRate": pctStats.critChancePct += mainVal; break;
      case "critDmg": pctStats.critDmgPct += mainVal; break;
    }

    // Sub stats
    subStatsArray.forEach((s) => {
      const val = Number(s.value) || 0;
      switch (s.type) {
        case "hp": flatStats.hp += val; break;
        case "power": flatStats.power += val; break;
        case "guard": flatStats.guard += val; break;
        case "speed": flatStats.speed += val; break;
        case "effectHit": flatStats.effectHit += val; break;
        case "hpPct": pctStats.hpPct += val; break;
        case "dmgPct": pctStats.dmgPct += val; break;
        case "defendPct": pctStats.defendPct += val; break;
        case "crit": pctStats.critChancePct += val; break;
        case "critDmg": pctStats.critDmgPct += val; break;
      }
    });
  });

  return {
    stats: {
      hp: flatStats.hp,
      power: flatStats.power,
      guard: flatStats.guard,
      speed: flatStats.speed,
      effectHit: flatStats.effectHit,
    },
    pct: pctStats,
    equipped,
  };
}

function weightedEquipmentBonus(stats) {
  return (
    (stats.power || 0) * 2.0 +
    (stats.guard || 0) * 1.7 +
    (stats.speed || 0) * 1.5
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

function toPublicProfile(profile, equipmentStats, equippedItems, equipmentPctStats = {}, options = {}) {
  const totalFights = profile.wins + profile.losses;
  const nextXp = xpToNext(profile.level);
  const dailyDrawsUsed = getDailyCardDrawsUsed(profile);
  const canDrawCard = dailyDrawsUsed < DAILY_CARD_DRAW_LIMIT;
  const cardStats = profile.selectedCard
    ? cardIvStatBonus(profile.selectedCard)
    : { hp: 0, power: 0, guard: 0, speed: 0, effectHit: 0 };
  const skillStats = options.skillStats || {
    hp: 0,
    power: 0,
    guard: 0,
    speed: 0,
    effectHit: 0,
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
    eloRating: profile.eloRating,
    eloMatches: profile.eloMatches,
    peakElo: profile.peakElo,
    eloProvisional: isEloProvisional(profile.eloMatches),
    tutorialComplete: !!profile.tutorialComplete,
    stats: {
      base: {
        hp: profile.hp,
        power: profile.power,
        guard: profile.guard,
        speed: profile.speed,
        effectHit: profile.effectHit,
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
        effectHit: profile.effectHit + equipmentStats.effectHit + cardStats.effectHit + skillStats.effectHit,
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
    equipmentPct: equipmentPctStats || {},
    activePassives: Array.isArray(options.activePassives) ? options.activePassives : [],
    materialInventory: options.materialInventory || {},
    equipmentPieces: Array.isArray(options.equipmentPieces) ? options.equipmentPieces : [],
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
  const { equipped, stats: equipmentStats, pct: equipmentPctStats } = computeEquipmentStats(db, userId);
  const skillState = getSkillState(db, profile);
  const activePassives = [...skillState.passives].sort((a, b) => b.priority - a.priority);
  const materialInventory = buildMaterialInventory(inventoryMap);
  const recentFights = readRecentFights(db, userId, 10);

  const equipmentPieces = getEquipmentPiecesRows(db, userId).map((row) => {
    let subStats = [];
    try { subStats = JSON.parse(row.subStats || "[]"); } catch { /* keep empty */ }
    return {
      id: row.id,
      slot: row.slot,
      mainStatType: row.mainStatType,
      mainStatValue: row.mainStatValue,
      subStats,
      equipped: !!row.equipped,
      createdAt: row.createdAt,
    };
  });

  const equipmentLoadouts = getEquipmentLoadouts(db, userId);

  return toPublicProfile(profile, equipmentStats, equipped, equipmentPctStats, {
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
    equipmentPieces,
    equipmentLoadouts,
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
  const page = Math.max(toPositiveInt(options.page, 1), 1);
  const perPage = clamp(toPositiveInt(options.perPage, 24), 1, 100);
  const offset = (page - 1) * perPage;
  const rawSort = String(options.sort || "").trim();
  const validSorts = ["recent", "rarity-desc", "rarity-asc", "iv-desc", "iv-asc", "RH", "RL", "IH", "IL", "power-desc", "guard-desc", "speed-desc", "effectHit-desc"];
  const sort = validSorts.includes(rawSort) ? rawSort : "recent";
  const search = String(options.search || "").trim();
  const element = String(options.element || "").trim();
  const duplicates = options.duplicates === true || options.duplicates === "true" || options.duplicates === "1";

  const total = countCollectionCards(db, userId, search, element, {}, duplicates);
  const totalPages = Math.max(Math.ceil(total / perPage), 1);
  const cards = readCollectionCards(db, userId, { limit: perPage, offset, sort, search, element, duplicates });

  return {
    profile: getArenaProfilePayload(db, userId),
    cards,
    page,
    perPage,
    totalPages,
    total,
    sort,
    search: search || undefined,
    element: element || undefined,
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

function toggleCollectionCardFavorite(db, userId, cardInstanceId) {
  const normalizedId = String(cardInstanceId || "").trim();
  if (!normalizedId) {
    throw new ArenaHttpError(400, "cardInstanceId is required.", "ARENA_CARD_INSTANCE_REQUIRED");
  }

  const row = db
    .prepare(
      "SELECT isFavorite FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ?",
    )
    .get(userId, normalizedId);

  if (!row) {
    throw new ArenaHttpError(404, "Card not found in collection.", "ARENA_CARD_NOT_FOUND");
  }

  const newValue = row.isFavorite ? 0 : 1;
  db.prepare(
    "UPDATE arena_card_collection SET isFavorite = ?, updatedAt = ? WHERE userId = ? AND cardInstanceId = ?",
  ).run(newValue, nowIso(), userId, normalizedId);

  return { cardInstanceId: normalizedId, isFavorite: !!newValue };
}

function mintRainbowCard(db, userId, id1, id2) {
  const card1Id = String(id1 || "").trim();
  const card2Id = String(id2 || "").trim();

  if (!card1Id || !card2Id) {
    throw new ArenaHttpError(400, "Two card instance IDs are required.", "ARENA_MINT_TWO_CARDS_REQUIRED");
  }
  if (card1Id === card2Id) {
    throw new ArenaHttpError(400, "You must select two different cards.", "ARENA_MINT_DUPLICATE_CARD");
  }

  const card1Row = db.prepare(
    "SELECT cardJson FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ? LIMIT 1",
  ).get(userId, card1Id);
  const card2Row = db.prepare(
    "SELECT cardJson FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ? LIMIT 1",
  ).get(userId, card2Id);

  if (!card1Row) {
    throw new ArenaHttpError(404, "First card not found in your collection.", "ARENA_MINT_CARD_NOT_FOUND");
  }
  if (!card2Row) {
    throw new ArenaHttpError(404, "Second card not found in your collection.", "ARENA_MINT_CARD_NOT_FOUND");
  }

  const card1 = normalizeSelectedCard(card1Row.cardJson);
  const card2 = normalizeSelectedCard(card2Row.cardJson);
  if (!card1 || !card2) {
    throw new ArenaHttpError(409, "Stored card data is invalid.", "ARENA_COLLECTION_CARD_INVALID");
  }

  if (card1.malId !== card2.malId) {
    throw new ArenaHttpError(400, "Both cards must be the same character to mint.", "ARENA_MINT_DIFFERENT_CHARACTERS");
  }
  // Check neither card is in an active market listing
  const marketCheck = db.prepare(
    "SELECT id FROM arena_market_listings WHERE cardInstanceId IN (?, ?) AND status = 'active' LIMIT 1",
  ).get(card1Id, card2Id);
  if (marketCheck) {
    throw new ArenaHttpError(409, "A card is currently listed on the market.", "ARENA_MINT_CARD_LISTED");
  }

  // Check neither card is in an active trade listing
  const tradeListingCheck = db.prepare(
    "SELECT id FROM arena_trade_listings WHERE cardInstanceId IN (?, ?) AND status = 'active' LIMIT 1",
  ).get(card1Id, card2Id);
  if (tradeListingCheck) {
    throw new ArenaHttpError(409, "A card is currently in an active trade listing.", "ARENA_MINT_CARD_TRADED");
  }

  // Check neither card is in an active trade session
  if (
    findActiveTradeSessionUsingCard(db, card1Id) ||
    findActiveTradeSessionUsingCard(db, card2Id)
  ) {
    throw new ArenaHttpError(409, "A card is currently in an active trade session.", "ARENA_MINT_CARD_TRADED");
  }

  // Always use the first (left) card's IVs as the base, then randomly distribute 5 bonus points (capped at CARD_IV_MAX)
  const baseIv = {
    power: card1.iv.power,
    guard: card1.iv.guard,
    speed: card1.iv.speed,
    effectHit: card1.iv.effectHit,
  };
  const stats = ["power", "guard", "speed", "effectHit"];
  const mintedIv = { ...baseIv, total: 0 };
  for (let i = 0; i < 5; i++) {
    const eligible = stats.filter((s) => mintedIv[s] < CARD_IV_MAX);
    if (!eligible.length) break;
    const pick = eligible[randomInt(0, eligible.length - 1)];
    mintedIv[pick]++;
  }
  mintedIv.total = mintedIv.power + mintedIv.guard + mintedIv.speed + mintedIv.effectHit;

  const now = nowIso();
  const newCard = {
    ...card1,
    cardInstanceId: makeId("card"),
    iv: mintedIv,
    rainbow: true,
    title: card1.title.replace(/\s*\(rainbow\)\s*$/, "") + " (rainbow)",
    drawnAt: now,
  };

  // Delete input cards from collection
  db.prepare(
    "DELETE FROM arena_card_collection WHERE userId = ? AND cardInstanceId IN (?, ?)",
  ).run(userId, card1Id, card2Id);

  // If the selected card was one of the consumed cards, reset selection
  const profile = db.prepare("SELECT selectedCardJson FROM arena_profiles WHERE userId = ?").get(userId);
  if (profile) {
    const selected = normalizeSelectedCard(profile.selectedCardJson);
    if (selected && (selected.cardInstanceId === card1Id || selected.cardInstanceId === card2Id)) {
      db.prepare("UPDATE arena_profiles SET selectedCardJson = NULL, updatedAt = ? WHERE userId = ?").run(now, userId);
    }
  }

  // Insert the minted card
  insertCollectionCard(db, userId, newCard);

  return {
    card: newCard,
    profile: getArenaProfilePayload(db, userId),
  };
}

function getMarketPrice(db, malId, ivBand, rarity) {
  const rows = db
    .prepare(
      `SELECT price
       FROM arena_market_listings
       WHERE status = 'sold' AND malId = ? AND ivBand = ?
       ORDER BY soldAt DESC
       LIMIT ?`,
    )
    .all(toPositiveInt(malId, 0), ivBand, MARKET_SALES_SAMPLE_SIZE);

  if (rows.length > 0) {
    const total = rows.reduce((sum, row) => sum + toPositiveInt(row.price, 0), 0);
    return {
      value: Math.round(total / rows.length),
      source: "sales_average",
      sampleSize: rows.length,
    };
  }

  return {
    value: getCardShopPrice(rarity),
    source: "shop_baseline",
    sampleSize: 0,
  };
}

function getArenaMarketPriceGuide(db, userId, input = {}) {
  ensureArenaProfile(db, userId);
  const malId = toPositiveInt(input.malId, 0);
  const ivTotal = clamp(toPositiveInt(input.ivTotal, 0), 0, CARD_IV_MAX * 4);
  const rarity = String(input.rarity || "").trim().toUpperCase();
  if (!malId || !RARITY_TO_RANK.has(rarity)) {
    throw new ArenaHttpError(
      400,
      "Valid malId, ivTotal, and rarity are required.",
      "ARENA_MARKET_PRICE_GUIDE_INVALID",
    );
  }
  const ivBand = getMarketIvBand(ivTotal);
  return {
    malId,
    ivBand,
    marketPrice: getMarketPrice(db, malId, ivBand.id, rarity),
  };
}

function normalizeArenaUpdateText(value, maxLength) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function mapArenaUpdateRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getArenaUpdates(db, options = {}) {
  const limit = clamp(toPositiveInt(options.limit, 5) || 5, 1, 50);
  return db
    .prepare(
      `SELECT id, title, body, createdAt, updatedAt
       FROM arena_updates
       ORDER BY createdAt DESC, rowid DESC
       LIMIT ?`,
    )
    .all(limit)
    .map(mapArenaUpdateRow);
}

function createArenaUpdate(db, userId, input = {}) {
  const title = normalizeArenaUpdateText(
    input.title,
    ARENA_UPDATE_MAX_TITLE_LENGTH,
  );
  const body = normalizeArenaUpdateText(
    input.body,
    ARENA_UPDATE_MAX_BODY_LENGTH,
  );
  if (!title) {
    throw new ArenaHttpError(
      400,
      "Update title is required.",
      "ARENA_UPDATE_TITLE_REQUIRED",
    );
  }
  if (!body) {
    throw new ArenaHttpError(
      400,
      "Update message is required.",
      "ARENA_UPDATE_BODY_REQUIRED",
    );
  }
  const id = makeId("arena-update");
  const now = nowIso();
  db.prepare(
    `INSERT INTO arena_updates (
      id, title, body, createdByUserId, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, title, body, userId, now, now);
  return mapArenaUpdateRow(
    db
      .prepare(
        `SELECT id, title, body, createdAt, updatedAt
         FROM arena_updates
         WHERE id = ?`,
      )
      .get(id),
  );
}

function deleteArenaUpdate(db, updateId) {
  const normalizedId = String(updateId || "").trim();
  const result = db
    .prepare("DELETE FROM arena_updates WHERE id = ?")
    .run(normalizedId);
  if (result.changes !== 1) {
    throw new ArenaHttpError(
      404,
      "Arena update not found.",
      "ARENA_UPDATE_NOT_FOUND",
    );
  }
  return { deletedUpdateId: normalizedId };
}

function normalizeMarketListingRow(db, row, viewerUserId) {
  if (!row) return null;
  const card = normalizeSelectedCard(row.cardJson);
  if (!card) return null;

  return {
    listingId: row.id,
    seller: {
      userId: row.sellerUserId,
      username: row.sellerUsername || "Unknown player",
      avatar: row.sellerAvatar || null,
    },
    buyerUserId: row.buyerUserId || null,
    card,
    ivBand: row.ivBand,
    price: toPositiveInt(row.price, 0),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    soldAt: row.soldAt || null,
    cancelledAt: row.cancelledAt || null,
    isMine: Boolean(viewerUserId && row.sellerUserId === viewerUserId),
    marketPrice: getMarketPrice(db, row.malId, row.ivBand, row.rarity),
  };
}

function getMarketListingById(db, listingId, viewerUserId) {
  const row = db
    .prepare(
      `SELECT
         listing.*,
         seller.username AS sellerUsername,
         seller.avatar AS sellerAvatar
       FROM arena_market_listings listing
       LEFT JOIN users seller ON seller.id = listing.sellerUserId
       WHERE listing.id = ?
       LIMIT 1`,
    )
    .get(listingId);
  return normalizeMarketListingRow(db, row, viewerUserId);
}

function getArenaMarketListings(db, userId, options = {}) {
  ensureArenaProfile(db, userId);
  const page = Math.max(toPositiveInt(options.page, 1), 1);
  const limit = clamp(
    toPositiveInt(options.limit, 12) || 12,
    1,
    MARKET_MAX_PAGE_SIZE,
  );
  const clauses = ["listing.status = 'active'"];
  const params = [];
  const search = String(options.search || "").trim();
  const rarity = String(options.rarity || "").trim().toUpperCase();
  const ivBand = String(options.ivBand || "").trim();

  if (search) {
    clauses.push("listing.cardTitle LIKE ? COLLATE NOCASE");
    params.push(`%${search}%`);
  }
  if (RARITY_TO_RANK.has(rarity)) {
    clauses.push("listing.rarity = ?");
    params.push(rarity);
  }
  if (MARKET_IV_BANDS.some((band) => band.id === ivBand)) {
    clauses.push("listing.ivBand = ?");
    params.push(ivBand);
  }
  if (options.sellerUserId) {
    clauses.push("listing.sellerUserId = ?");
    params.push(String(options.sellerUserId));
  }

  const sortSql = {
    newest: "listing.createdAt DESC",
    "price-asc": "listing.price ASC, listing.createdAt DESC",
    "price-desc": "listing.price DESC, listing.createdAt DESC",
    "iv-asc": "listing.ivTotal ASC, listing.createdAt DESC",
    "iv-desc": "listing.ivTotal DESC, listing.createdAt DESC",
  }[String(options.sort || "newest")] || "listing.createdAt DESC";
  const whereSql = clauses.join(" AND ");
  const total = toPositiveInt(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM arena_market_listings listing
         WHERE ${whereSql}`,
      )
      .get(...params)?.count,
    0,
  );
  const rows = db
    .prepare(
      `SELECT
         listing.*,
         seller.username AS sellerUsername,
         seller.avatar AS sellerAvatar
       FROM arena_market_listings listing
       LEFT JOIN users seller ON seller.id = listing.sellerUserId
       WHERE ${whereSql}
       ORDER BY ${sortSql}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, (page - 1) * limit);

  return {
    profile: getArenaProfilePayload(db, userId),
    listings: rows
      .map((row) => normalizeMarketListingRow(db, row, userId))
      .filter(Boolean),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    ivBands: MARKET_IV_BANDS,
  };
}

function getMyArenaMarketListings(db, userId) {
  return getArenaMarketListings(db, userId, {
    sellerUserId: userId,
    page: 1,
    limit: MARKET_MAX_ACTIVE_LISTINGS,
    sort: "newest",
  });
}

function createArenaMarketListing(db, userId, input = {}) {
  const cardInstanceId = String(input.cardInstanceId || "").trim();
  const price = Number(input.price);
  if (!cardInstanceId) {
    throw new ArenaHttpError(
      400,
      "cardInstanceId is required.",
      "ARENA_CARD_INSTANCE_REQUIRED",
    );
  }
  if (
    !Number.isSafeInteger(price) ||
    price < MARKET_MIN_PRICE ||
    price > MARKET_MAX_PRICE
  ) {
    throw new ArenaHttpError(
      400,
      `Price must be a whole number from ${MARKET_MIN_PRICE} to ${MARKET_MAX_PRICE}.`,
      "ARENA_MARKET_PRICE_INVALID",
      { minPrice: MARKET_MIN_PRICE, maxPrice: MARKET_MAX_PRICE },
    );
  }

  const listingId = makeId("market");
  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    if (hasActiveFight(db, userId)) {
      throw new ArenaHttpError(
        409,
        "Finish your active fight before listing a card.",
        "ARENA_MARKET_FIGHT_ACTIVE",
      );
    }

    const activeCount = toPositiveInt(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM arena_market_listings
           WHERE sellerUserId = ? AND status = 'active'`,
        )
        .get(userId)?.count,
      0,
    );
    if (activeCount >= MARKET_MAX_ACTIVE_LISTINGS) {
      throw new ArenaHttpError(
        409,
        `You can have at most ${MARKET_MAX_ACTIVE_LISTINGS} active listings.`,
        "ARENA_MARKET_LISTING_LIMIT",
        { maxActiveListings: MARKET_MAX_ACTIVE_LISTINGS },
      );
    }

    const collectionRow = db
      .prepare(
        `SELECT cardJson
         FROM arena_card_collection
         WHERE userId = ? AND cardInstanceId = ?
         LIMIT 1`,
      )
      .get(userId, cardInstanceId);
    if (!collectionRow) {
      throw new ArenaHttpError(
        404,
        "Card not found in your collection.",
        "ARENA_COLLECTION_CARD_NOT_FOUND",
      );
    }
    const card = normalizeSelectedCard(collectionRow.cardJson);
    if (!card) {
      throw new ArenaHttpError(
        409,
        "Stored card data is invalid.",
        "ARENA_COLLECTION_CARD_INVALID",
      );
    }

    const ivTotal = clamp(toPositiveInt(card.iv?.total, 0), 0, CARD_IV_MAX * 4);
    const ivBand = getMarketIvBand(ivTotal).id;
    const now = nowIso();
    db.prepare(
      `INSERT INTO arena_market_listings (
        id, sellerUserId, buyerUserId, cardInstanceId, cardJson,
        cardTitle, malId, rarity, ivTotal, ivBand, price, status,
        createdAt, updatedAt, soldAt, cancelledAt
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL)`,
    ).run(
      listingId,
      userId,
      card.cardInstanceId,
      JSON.stringify(card),
      card.title,
      card.malId,
      card.rarity,
      ivTotal,
      ivBand,
      price,
      now,
      now,
    );

    const removed = db
      .prepare(
        `DELETE FROM arena_card_collection
         WHERE userId = ? AND cardInstanceId = ?`,
      )
      .run(userId, cardInstanceId);
    if (removed.changes !== 1) {
      throw new ArenaHttpError(
        409,
        "The card could not be moved into market escrow.",
        "ARENA_MARKET_ESCROW_FAILED",
      );
    }

    if (profile.selectedCard?.cardInstanceId === cardInstanceId) {
      db.prepare(
        `UPDATE arena_profiles
         SET selectedCardJson = NULL, updatedAt = ?
         WHERE userId = ?`,
      ).run(now, userId);
    }
  });

  tx();
  const w = _wsEmit();
  if (w) w.broadcast({ type: S2C.ARENA_MARKET_CHANGED, data: {} });
  return {
    listing: getMarketListingById(db, listingId, userId),
    profile: getArenaProfilePayload(db, userId),
  };
}

function cancelArenaMarketListing(db, userId, listingId) {
  const normalizedListingId = String(listingId || "").trim();
  const tx = db.transaction(() => {
    ensureArenaProfile(db, userId);
    const row = db
      .prepare(
        `SELECT *
         FROM arena_market_listings
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedListingId);
    if (!row) {
      throw new ArenaHttpError(
        404,
        "Market listing not found.",
        "ARENA_MARKET_LISTING_NOT_FOUND",
      );
    }
    if (row.sellerUserId !== userId) {
      throw new ArenaHttpError(
        403,
        "You can only cancel your own listings.",
        "ARENA_MARKET_NOT_SELLER",
      );
    }
    if (row.status !== "active") {
      throw new ArenaHttpError(
        409,
        "This listing is no longer active.",
        "ARENA_MARKET_LISTING_INACTIVE",
      );
    }

    const card = normalizeSelectedCard(row.cardJson);
    if (!card) {
      throw new ArenaHttpError(
        409,
        "Stored listing card data is invalid.",
        "ARENA_MARKET_CARD_INVALID",
      );
    }
    const now = nowIso();
    const updated = db
      .prepare(
        `UPDATE arena_market_listings
         SET status = 'cancelled', cancelledAt = ?, updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(now, now, normalizedListingId);
    if (updated.changes !== 1) {
      throw new ArenaHttpError(
        409,
        "This listing is no longer active.",
        "ARENA_MARKET_LISTING_INACTIVE",
      );
    }
    insertCollectionCard(db, userId, card);
  });

  tx();
  const w = _wsEmit();
  if (w) w.broadcast({ type: S2C.ARENA_MARKET_CHANGED, data: {} });
  return {
    listing: getMarketListingById(db, normalizedListingId, userId),
    profile: getArenaProfilePayload(db, userId),
  };
}

function buyArenaMarketListing(db, userId, listingId) {
  const normalizedListingId = String(listingId || "").trim();
  const tx = db.transaction(() => {
    const buyer = ensureArenaProfile(db, userId);
    const row = db
      .prepare(
        `SELECT *
         FROM arena_market_listings
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedListingId);
    if (!row) {
      throw new ArenaHttpError(
        404,
        "Market listing not found.",
        "ARENA_MARKET_LISTING_NOT_FOUND",
      );
    }
    if (row.status !== "active") {
      throw new ArenaHttpError(
        409,
        "This listing is no longer active.",
        "ARENA_MARKET_LISTING_INACTIVE",
      );
    }
    if (row.sellerUserId === userId) {
      throw new ArenaHttpError(
        409,
        "You cannot buy your own listing.",
        "ARENA_MARKET_SELF_PURCHASE",
      );
    }
    if (buyer.coins < row.price) {
      throw new ArenaHttpError(
        400,
        "Not enough coins.",
        "ARENA_NOT_ENOUGH_COINS",
        { requiredCoins: row.price },
      );
    }
    const duplicate = db
      .prepare(
        `SELECT id
         FROM arena_card_collection
         WHERE userId = ? AND cardInstanceId = ?
         LIMIT 1`,
      )
      .get(userId, row.cardInstanceId);
    if (duplicate) {
      throw new ArenaHttpError(
        409,
        "This card is already in your collection.",
        "ARENA_MARKET_CARD_DUPLICATE",
      );
    }
    const card = normalizeSelectedCard(row.cardJson);
    if (!card) {
      throw new ArenaHttpError(
        409,
        "Stored listing card data is invalid.",
        "ARENA_MARKET_CARD_INVALID",
      );
    }

    ensureArenaProfile(db, row.sellerUserId);
    const now = nowIso();
    const updated = db
      .prepare(
        `UPDATE arena_market_listings
         SET status = 'sold', buyerUserId = ?, soldAt = ?, updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(userId, now, now, normalizedListingId);
    if (updated.changes !== 1) {
      throw new ArenaHttpError(
        409,
        "This listing is no longer active.",
        "ARENA_MARKET_LISTING_INACTIVE",
      );
    }
    db.prepare(
      `UPDATE arena_profiles
       SET coins = coins - ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(row.price, now, userId);
    db.prepare(
      `UPDATE arena_profiles
       SET coins = coins + ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(row.price, now, row.sellerUserId);
    insertCollectionCard(db, userId, card);

    const buyerUser = db.prepare("SELECT username FROM users WHERE id = ?").get(userId);
    const buyerName = buyerUser?.username || "Someone";
    createArenaNotification(
      db,
      row.sellerUserId,
      "market_sold",
      "Your card was bought",
      `${buyerName} bought ${row.cardTitle} (${row.rarity}) for ${row.price.toLocaleString()} coins.`,
      "/arena/market",
    );
  });

  tx();
  const w = _wsEmit();
  if (w) w.broadcast({ type: S2C.ARENA_MARKET_CHANGED, data: {} });
  return {
    listing: getMarketListingById(db, normalizedListingId, userId),
    profile: getArenaProfilePayload(db, userId),
  };
}

function searchArenaUsers(db, query) {
  const term = String(query || "").trim();
  if (!term) return [];
  return db
    .prepare(
      `SELECT id, username, avatar
       FROM users
       WHERE username LIKE ? COLLATE NOCASE
       ORDER BY username ASC
       LIMIT 10`,
    )
    .all(`${term}%`);
}

function cardFromCatalogCharacter(character, catalogSize) {
  if (!character) return null;
  return {
    cardInstanceId: `wanted-${character.malId}`,
    malId: character.malId,
    title: character.title,
    url: character.url,
    imageUrl: character.imageUrl,
    meanScore: character.meanScore,
    popularity: character.popularity,
    favorites: character.favorites,
    nsfw: character.nsfw,
    rarity: rarityFromCharacterRank(character.popularity, catalogSize),
    element: character.element || null,
    from: character.from || null,
    iv: {
      power: 0,
      guard: 0,
      speed: 0,
      effectHit: 0,
      total: 0,
    },
    drawnAt: null,
  };
}

function getWantedTradeCard(malId) {
  const catalog = getArenaCharacterCatalog();
  const character = catalog.byMalId.get(toPositiveInt(malId, 0));
  return cardFromCatalogCharacter(character, catalog.characters.length);
}

function searchArenaTradeCards(query) {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return [];
  const catalog = getArenaCharacterCatalog();
  return catalog.characters
    .filter((character) => {
      const title = String(character.title || "").toLowerCase();
      const from = String(character.from || "").toLowerCase();
      return title.includes(term) || from.includes(term);
    })
    .slice(0, 20)
    .map((character) => cardFromCatalogCharacter(character, catalog.characters.length))
    .filter(Boolean);
}

function characterArchiveSearchNames(character) {
  const title = String(character?.title || "").trim();
  if (!title) return [];
  const names = [title];
  const commaIndex = title.indexOf(",");
  if (commaIndex > 0) {
    const familyName = title.slice(0, commaIndex).trim();
    const givenName = title.slice(commaIndex + 1).trim();
    if (familyName && givenName) {
      names.push(`${givenName} ${familyName}`);
      names.push(`${familyName} ${givenName}`);
    }
  }
  return names;
}

function characterMatchesArchiveSearch(character, term) {
  if (!term) return true;
  const names = characterArchiveSearchNames(character);
  const appearances = Array.isArray(character.appearances)
    ? character.appearances
    : [];
  return (
    names.some((name) => name.toLowerCase().includes(term)) ||
    appearances.some((appearance) =>
      String(appearance?.name || "").toLowerCase().includes(term),
    )
  );
}

function parseTradeCardIds(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function uniqueTradeCardIds(ids) {
  return [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
}

function tradeCardIdsForSide(row, side) {
  const legacyKey = `${side}CardInstanceId`;
  const jsonKey = `${side}CardInstanceIdsJson`;
  return uniqueTradeCardIds([
    ...parseTradeCardIds(row?.[jsonKey]),
    row?.[legacyKey],
  ]);
}

function serializeTradeCardIds(ids) {
  const normalized = uniqueTradeCardIds(ids);
  return normalized.length ? JSON.stringify(normalized) : null;
}

function primaryTradeCardId(ids) {
  return uniqueTradeCardIds(ids)[0] || null;
}

function findActiveTradeSessionUsingCard(db, cardInstanceId, excludeSessionId = "") {
  const normalizedCardId = String(cardInstanceId || "").trim();
  if (!normalizedCardId) return null;
  const rows = db
    .prepare(
      `SELECT id, askerCardInstanceId, responderCardInstanceId,
              askerCardInstanceIdsJson, responderCardInstanceIdsJson
       FROM arena_trade_sessions
       WHERE status = 'active' AND id != ?`,
    )
    .all(String(excludeSessionId || "").trim());
  return rows.find((row) =>
    tradeCardIdsForSide(row, "asker").includes(normalizedCardId) ||
    tradeCardIdsForSide(row, "responder").includes(normalizedCardId),
  ) || null;
}

function loadTradeCardsForOwner(db, ownerId, cardInstanceIds) {
  return uniqueTradeCardIds(cardInstanceIds)
    .map((cardInstanceId) => {
      const row = db
        .prepare(
          `SELECT cardJson
           FROM arena_card_collection
           WHERE userId = ? AND cardInstanceId = ?
           LIMIT 1`,
        )
        .get(ownerId, cardInstanceId);
      return row ? normalizeSelectedCard(row.cardJson) : null;
    })
    .filter(Boolean);
}

function getOwnedArchiveMalIds(db, userId) {
  const rows = db
    .prepare("SELECT cardJson FROM arena_card_collection WHERE userId = ?")
    .all(userId);
  const owned = new Set();
  for (const row of rows) {
    const card = normalizeSelectedCard(row.cardJson);
    if (card?.malId) owned.add(card.malId);
  }
  return owned;
}

function getArenaArchivePayload(db, userId, options = {}) {
  const page = Math.max(toPositiveInt(options.page, 1), 1);
  const perPage = clamp(toPositiveInt(options.perPage, 24), 1, 100);
  const search = String(options.search || "").trim();
  const rawOwnership = String(options.ownership || "").trim();
  const ownership = ["owned", "not-owned"].includes(rawOwnership)
    ? rawOwnership
    : "all";
  const term = search.toLowerCase();
  const catalog = getArenaCharacterCatalog();
  const ownedMalIds = getOwnedArchiveMalIds(db, userId);
  const searchedCharacters = term
    ? catalog.characters.filter((character) =>
        characterMatchesArchiveSearch(character, term),
      )
    : catalog.characters;
  const characters = ownership === "all"
    ? searchedCharacters
    : searchedCharacters.filter((character) => {
        const isOwned = ownedMalIds.has(character.malId);
        return ownership === "owned" ? isOwned : !isOwned;
      });
  const total = characters.length;
  const totalPages = Math.max(Math.ceil(total / perPage), 1);
  const offset = (page - 1) * perPage;
  const cards = characters
    .slice(offset, offset + perPage)
    .map((character) => {
      const card = cardFromCatalogCharacter(character, catalog.characters.length);
      return card ? { ...card, owned: ownedMalIds.has(character.malId) } : null;
    })
    .filter(Boolean);

  return {
    cards,
    page,
    perPage,
    totalPages,
    total,
    search: search || undefined,
    ownership,
  };
}

function createArenaTradeListing(db, userId, input = {}) {
  const cardInstanceId = String(input.cardInstanceId || "").trim();
  const wantedCardInstanceId = String(input.wantedCardInstanceId || "").trim();
  const wantedCardMalId = toPositiveInt(input.wantedCardMalId, 0);
  const wantedRarity = String(input.wantedRarity || "").trim().toUpperCase() || null;
  const wantedElement = String(input.wantedElement || "").trim() || null;
  const note = String(input.note || "").trim() || null;
  if (!cardInstanceId) {
    throw new ArenaHttpError(
      400,
      "cardInstanceId is required.",
      "ARENA_CARD_INSTANCE_REQUIRED",
    );
  }
  if (wantedRarity && !RARITY_TO_RANK.has(wantedRarity)) {
    throw new ArenaHttpError(
      400,
      "Invalid wanted rarity.",
      "ARENA_TRADE_RARITY_INVALID",
    );
  }
  if (wantedElement && !ELEMENTS.includes(wantedElement)) {
    throw new ArenaHttpError(
      400,
      "Invalid wanted element.",
      "ARENA_TRADE_ELEMENT_INVALID",
    );
  }

  const listingId = makeId("tradelisting");
  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    if (hasActiveFight(db, userId)) {
      throw new ArenaHttpError(
        409,
        "Finish your active fight before listing a card.",
        "ARENA_TRADE_FIGHT_ACTIVE",
      );
    }

    const activeCount = toPositiveInt(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM arena_trade_listings
           WHERE userId = ? AND status = 'active'`,
        )
        .get(userId)?.count,
      0,
    );
    if (activeCount >= MAX_TRADE_LISTINGS) {
      throw new ArenaHttpError(
        409,
        `You can have at most ${MAX_TRADE_LISTINGS} active trade listings.`,
        "ARENA_TRADE_LISTING_LIMIT",
        { maxActiveListings: MAX_TRADE_LISTINGS },
      );
    }

    const alreadyListed = db
      .prepare(
        `SELECT id
         FROM arena_trade_listings
         WHERE cardInstanceId = ? AND status = 'active'
         LIMIT 1`,
      )
      .get(cardInstanceId);
    if (alreadyListed) {
      throw new ArenaHttpError(
        409,
        "This card is already in an active trade listing.",
        "ARENA_TRADE_CARD_ALREADY_LISTED",
      );
    }

    const alreadyInSession = findActiveTradeSessionUsingCard(db, cardInstanceId);
    if (alreadyInSession) {
      throw new ArenaHttpError(
        409,
        "This card is already in an active trade session.",
        "ARENA_TRADE_CARD_IN_SESSION",
      );
    }

    const collectionRow = db
      .prepare(
        `SELECT cardJson
         FROM arena_card_collection
         WHERE userId = ? AND cardInstanceId = ?
         LIMIT 1`,
      )
      .get(userId, cardInstanceId);
    if (!collectionRow) {
      throw new ArenaHttpError(
        404,
        "Card not found in your collection.",
        "ARENA_COLLECTION_CARD_NOT_FOUND",
      );
    }
    const card = normalizeSelectedCard(collectionRow.cardJson);
    if (!card) {
      throw new ArenaHttpError(
        409,
        "Stored card data is invalid.",
        "ARENA_COLLECTION_CARD_INVALID",
      );
    }
    let wantedCard = wantedCardMalId ? getWantedTradeCard(wantedCardMalId) : null;
    if (wantedCardMalId && !wantedCard) {
      throw new ArenaHttpError(
        404,
        "Requested card was not found.",
        "ARENA_TRADE_WANTED_CARD_NOT_FOUND",
      );
    }
    if (!wantedCard && wantedCardInstanceId) {
      const wantedRow = db
        .prepare(
          `SELECT cardJson
           FROM arena_card_collection
           WHERE userId = ? AND cardInstanceId = ?
           LIMIT 1`,
        )
        .get(userId, wantedCardInstanceId);
      if (!wantedRow) {
        throw new ArenaHttpError(
          404,
          "Requested card not found in your collection.",
          "ARENA_TRADE_WANTED_CARD_NOT_FOUND",
        );
      }
      wantedCard = normalizeSelectedCard(wantedRow.cardJson);
      if (!wantedCard) {
        throw new ArenaHttpError(
          409,
          "Requested card data is invalid.",
          "ARENA_TRADE_WANTED_CARD_INVALID",
        );
      }
    }

    const ivTotal = clamp(toPositiveInt(card.iv?.total, 0), 0, CARD_IV_MAX * 4);
    const now = nowIso();
    db.prepare(
      `INSERT INTO arena_trade_listings (
        id, userId, cardInstanceId, cardJson,
        cardTitle, malId, rarity, ivTotal, element,
        wantedRarity, wantedElement, wantedCardJson, note, status,
        createdAt, updatedAt, cancelledAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
    ).run(
      listingId,
      userId,
      card.cardInstanceId,
      JSON.stringify(card),
      card.title,
      card.malId,
      card.rarity,
      ivTotal,
      card.element || null,
      wantedRarity,
      wantedElement,
      wantedCard ? JSON.stringify(wantedCard) : null,
      note,
      now,
      now,
    );

    const removed = db
      .prepare(
        `DELETE FROM arena_card_collection
         WHERE userId = ? AND cardInstanceId = ?`,
      )
      .run(userId, cardInstanceId);
    if (removed.changes !== 1) {
      throw new ArenaHttpError(
        409,
        "The card could not be moved into trade escrow.",
        "ARENA_TRADE_ESCROW_FAILED",
      );
    }

    if (profile.selectedCard?.cardInstanceId === cardInstanceId) {
      db.prepare(
        `UPDATE arena_profiles
         SET selectedCardJson = NULL, updatedAt = ?
         WHERE userId = ?`,
      ).run(now, userId);
    }
  });

  tx();
  const w = _wsEmit();
  if (w) w.broadcast({ type: S2C.ARENA_TRADE_LISTING_CHANGED, data: {} });
  return {
    listing: normalizeTradeListingRow(db, listingId, userId),
    profile: getArenaProfilePayload(db, userId),
  };
}

function normalizeTradeListingRow(db, listingId, userId) {
  const row = db
    .prepare(
      `SELECT listing.*, u.username, u.avatar,
        (SELECT COUNT(*) > 0 FROM arena_trade_sessions
         WHERE (askerId = listing.userId OR responderId = listing.userId)
           AND status = 'active') AS hasActiveSession,
        (SELECT COUNT(*) > 0 FROM arena_trade_requests
         WHERE ((askerId = ? AND responderId = listing.userId) OR (askerId = listing.userId AND responderId = ?))
           AND status = 'pending') AS hasPendingRequest
       FROM arena_trade_listings listing
       LEFT JOIN users u ON u.id = listing.userId
       WHERE listing.id = ?
       LIMIT 1`,
    )
    .get(userId, userId, listingId);
  if (!row) return null;

  const card = normalizeSelectedCard(row.cardJson);
  const wantedCard = row.wantedCardJson
    ? normalizeSelectedCard(row.wantedCardJson)
    : null;
  return {
    id: row.id,
    userId: row.userId,
    username: row.username || "Unknown",
    avatar: row.avatar || null,
    card: card || { title: row.cardTitle, malId: row.malId, rarity: row.rarity, imageUrl: "" },
    wantedCard,
    wantedRarity: row.wantedRarity || null,
    wantedElement: row.wantedElement || null,
    note: row.note || null,
    status: row.status,
    hasActiveSession: row.hasActiveSession === 1,
    hasPendingRequest: row.hasPendingRequest === 1,
    createdAt: row.createdAt,
  };
}

function getArenaTradeListings(db, userId, options = {}) {
  ensureArenaProfile(db, userId);
  const page = Math.max(toPositiveInt(options.page, 1), 1);
  const limit = clamp(
    toPositiveInt(options.limit, 12) || 12,
    1,
    MARKET_MAX_PAGE_SIZE,
  );
  const clauses = ["listing.status = 'active'"];
  const params = [];
  const wantedRarity = String(options.wantedRarity || "").trim().toUpperCase();
  const wantedElement = String(options.wantedElement || "").trim();
  const search = String(options.search || "").trim();

  if (search) {
    clauses.push("listing.cardTitle LIKE ? COLLATE NOCASE");
    params.push(`%${search}%`);
  }
  if (RARITY_TO_RANK.has(wantedRarity)) {
    clauses.push("listing.wantedRarity = ?");
    params.push(wantedRarity);
  }
  if (ELEMENTS.includes(wantedElement)) {
    clauses.push("listing.wantedElement = ?");
    params.push(wantedElement);
  }
  if (options.userId) {
    clauses.push("listing.userId = ?");
    params.push(String(options.userId));
  }

  const whereSql = clauses.join(" AND ");
  const total = toPositiveInt(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM arena_trade_listings listing
         WHERE ${whereSql}`,
      )
      .get(...params)?.count,
    0,
  );
  const rows = db
    .prepare(
      `SELECT
         listing.*,
         u.username,
         u.avatar,
         (SELECT COUNT(*) > 0 FROM arena_trade_sessions
          WHERE (askerId = listing.userId OR responderId = listing.userId)
            AND status = 'active') AS hasActiveSession,
         (SELECT COUNT(*) > 0 FROM arena_trade_requests
          WHERE ((askerId = ? AND responderId = listing.userId) OR (askerId = listing.userId AND responderId = ?))
            AND status = 'pending') AS hasPendingRequest
       FROM arena_trade_listings listing
       LEFT JOIN users u ON u.id = listing.userId
       WHERE ${whereSql}
       ORDER BY listing.createdAt DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, userId, ...params, limit, (page - 1) * limit);

  return {
    profile: getArenaProfilePayload(db, userId),
    listings: rows.map((row) => {
      const card = normalizeSelectedCard(row.cardJson);
      const wantedCard = row.wantedCardJson
        ? normalizeSelectedCard(row.wantedCardJson)
        : null;
      return {
        id: row.id,
        userId: row.userId,
        username: row.username || "Unknown",
        avatar: row.avatar || null,
        card: card || { title: row.cardTitle, malId: row.malId, rarity: row.rarity, imageUrl: "" },
        wantedCard,
        wantedRarity: row.wantedRarity || null,
        wantedElement: row.wantedElement || null,
        note: row.note || null,
        status: row.status,
        hasActiveSession: row.hasActiveSession === 1,
        hasPendingRequest: row.hasPendingRequest === 1,
        createdAt: row.createdAt,
      };
    }),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

function getMyArenaTradeListings(db, userId) {
  return getArenaTradeListings(db, userId, {
    userId,
    page: 1,
    limit: MAX_TRADE_LISTINGS,
  });
}

function cancelArenaTradeListing(db, userId, listingId) {
  const normalizedListingId = String(listingId || "").trim();
  const tx = db.transaction(() => {
    ensureArenaProfile(db, userId);
    const row = db
      .prepare(
        `SELECT *
         FROM arena_trade_listings
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedListingId);
    if (!row) {
      throw new ArenaHttpError(
        404,
        "Trade listing not found.",
        "ARENA_TRADE_LISTING_NOT_FOUND",
      );
    }
    if (row.userId !== userId) {
      throw new ArenaHttpError(
        403,
        "You can only cancel your own listings.",
        "ARENA_TRADE_NOT_OWNER",
      );
    }
    if (row.status !== "active") {
      throw new ArenaHttpError(
        409,
        "This listing is no longer active.",
        "ARENA_TRADE_LISTING_INACTIVE",
      );
    }

    const card = normalizeSelectedCard(row.cardJson);
    if (!card) {
      throw new ArenaHttpError(
        409,
        "Stored listing card data is invalid.",
        "ARENA_TRADE_CARD_INVALID",
      );
    }
    const now = nowIso();
    const updated = db
      .prepare(
        `UPDATE arena_trade_listings
         SET status = 'cancelled', cancelledAt = ?, updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(now, now, normalizedListingId);
    if (updated.changes !== 1) {
      throw new ArenaHttpError(
        409,
        "This listing is no longer active.",
        "ARENA_TRADE_LISTING_INACTIVE",
      );
    }
    insertCollectionCard(db, userId, card);

    // Cancel pending trade requests where this user is the responder
    db.prepare(
      `UPDATE arena_trade_requests
       SET status = 'cancelled', cancelledAt = ?, updatedAt = ?
       WHERE responderId = ? AND status = 'pending'`,
    ).run(now, now, userId);

    // Cancel active trade sessions tied to this listing's owner via trade requests
    const activeSessions = db
      .prepare(
        `SELECT s.id, s.askerId, s.responderId
         FROM arena_trade_sessions s
         JOIN arena_trade_requests r ON r.id = s.requestId
         WHERE s.status = 'active'
           AND r.responderId = ?`,
      )
      .all(userId);
    for (const session of activeSessions) {
      db.prepare(
        `UPDATE arena_trade_sessions
         SET status = 'cancelled', updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      ).run(now, session.id);

      const otherId = session.askerId === userId ? session.responderId : session.askerId;
      createArenaNotification(
        db, otherId, "trade_denied",
        "Trade session cancelled",
        `The trade listing was removed, so the session was cancelled.`,
        "/arena/trade",
      );
    }
  });

  tx();
  const w = _wsEmit();
  if (w) w.broadcast({ type: S2C.ARENA_TRADE_LISTING_CHANGED, data: {} });
  return {
    listing: normalizeTradeListingRow(db, normalizedListingId, userId),
    profile: getArenaProfilePayload(db, userId),
  };
}

function sendTradeRequest(db, askerId, responderId, cardInstanceId, options = {}) {
  const listingId = String(options.listingId || "").trim() || null;
  if (!responderId) {
    throw new ArenaHttpError(
      400,
      "responderId is required.",
      "ARENA_TRADE_RESPONDER_REQUIRED",
    );
  }
  if (askerId === responderId) {
    throw new ArenaHttpError(
      400,
      "You cannot trade with yourself.",
      "ARENA_TRADE_SELF",
    );
  }

  const responder = db
    .prepare("SELECT id FROM users WHERE id = ? LIMIT 1")
    .get(responderId);
  if (!responder) {
    throw new ArenaHttpError(
      404,
      "User not found.",
      "ARENA_TRADE_USER_NOT_FOUND",
    );
  }

  const tx = db.transaction(() => {
    ensureArenaProfile(db, askerId);

    let listingRow = null;
    if (listingId) {
      listingRow = db
        .prepare(
          `SELECT *
           FROM arena_trade_listings
           WHERE id = ? AND userId = ? AND status = 'active'
           LIMIT 1`,
        )
        .get(listingId, responderId);
      if (!listingRow) {
        throw new ArenaHttpError(
          404,
          "Trade listing not found.",
          "ARENA_TRADE_LISTING_NOT_FOUND",
        );
      }
    }

    const existingPending = db
      .prepare(
        `SELECT id
         FROM arena_trade_requests
         WHERE ((askerId = ? AND responderId = ?) OR (askerId = ? AND responderId = ?))
           AND status = 'pending'
         LIMIT 1`,
      )
      .get(askerId, responderId, responderId, askerId);
    if (existingPending) {
      throw new ArenaHttpError(
        409,
        "A trade request already exists between you and this user.",
        "ARENA_TRADE_REQUEST_EXISTS",
      );
    }

    if (cardInstanceId) {
      const collectionRow = db
        .prepare(
          `SELECT cardJson
           FROM arena_card_collection
           WHERE userId = ? AND cardInstanceId = ?
           LIMIT 1`,
        )
        .get(askerId, cardInstanceId);
      if (!collectionRow) {
        throw new ArenaHttpError(
          404,
          "Card not found in your collection.",
          "ARENA_COLLECTION_CARD_NOT_FOUND",
        );
      }
      if (listingRow?.wantedCardJson) {
        const offeredCard = normalizeSelectedCard(collectionRow.cardJson);
        const wantedCard = normalizeSelectedCard(listingRow.wantedCardJson);
        if (
          !offeredCard ||
          !wantedCard ||
          toPositiveInt(offeredCard.malId, 0) !== toPositiveInt(wantedCard.malId, 0)
        ) {
          throw new ArenaHttpError(
            400,
            "This listing is requesting a specific card.",
            "ARENA_TRADE_WANTED_CARD_REQUIRED",
          );
        }
      }
    } else if (listingRow?.wantedCardJson) {
      throw new ArenaHttpError(
        400,
        "This listing is requesting a specific card.",
        "ARENA_TRADE_WANTED_CARD_REQUIRED",
      );
    }

    const requestId = makeId("tradereq");
    const now = nowIso();

    // Cancel any active sessions between these two users
    db.prepare(
      `UPDATE arena_trade_sessions
       SET status = 'cancelled', updatedAt = ?
       WHERE ((askerId = ? AND responderId = ?) OR (askerId = ? AND responderId = ?))
         AND status = 'active'`,
    ).run(now, askerId, responderId, responderId, askerId);

    db.prepare(
      `INSERT INTO arena_trade_requests (
        id, askerId, responderId, listingId, askerCardInstanceId,
        status, createdAt, updatedAt, respondedAt, cancelledAt
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL)`,
    ).run(requestId, askerId, responderId, listingId, cardInstanceId || null, now, now);

    const askerUser = db.prepare("SELECT username FROM users WHERE id = ?").get(askerId);
    const askerName = askerUser?.username || "Someone";

    let metadata = null;
    if (cardInstanceId) {
      const cardRow = db
        .prepare("SELECT cardJson FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ? LIMIT 1")
        .get(askerId, cardInstanceId);
      if (cardRow) {
        const card = normalizeSelectedCard(cardRow.cardJson);
        if (card) {
          const listedRow = listingRow || db
            .prepare("SELECT cardJson FROM arena_trade_listings WHERE userId = ? AND status = 'active' LIMIT 1")
            .get(responderId);
          const responderCard = listedRow ? normalizeSelectedCard(listedRow.cardJson) : null;
          const wantedCard = listedRow?.wantedCardJson
            ? normalizeSelectedCard(listedRow.wantedCardJson)
            : null;
          metadata = JSON.stringify({
            requestId,
            listingId,
            askerCard: card,
            responderCard: responderCard || null,
            wantedCard: wantedCard || null,
          });
        }
      }
    } else {
      metadata = JSON.stringify({ requestId, listingId });
    }

    createArenaNotification(
      db,
      responderId,
      "trade_request",
      `${askerName} wants to trade`,
      `${askerName} sent you a trade request.`,
      "/arena/trade",
      metadata || JSON.stringify({ requestId }),
    );

    return requestId;
  });

  const requestId = tx();
  _notifyUser(responderId, S2C.ARENA_TRADE_REQUEST_NEW, { requestId, askerId });
  return { requestId };
}

function getIncomingTradeRequests(db, userId) {
  const rows = db
    .prepare(
      `SELECT
         r.*,
         asker.username AS askerUsername,
         asker.avatar AS askerAvatar
       FROM arena_trade_requests r
       LEFT JOIN users asker ON asker.id = r.askerId
       WHERE r.responderId = ? AND r.status = 'pending'
       ORDER BY r.createdAt DESC
       LIMIT 10`,
    )
    .all(userId);

  return rows.map((row) => ({
    id: row.id,
    askerId: row.askerId,
    askerUsername: row.askerUsername || "Unknown",
    askerAvatar: row.askerAvatar || null,
    responderId: row.responderId,
    status: row.status,
    createdAt: row.createdAt,
  }));
}

function acceptTradeRequest(db, userId, requestId) {
  const normalizedId = String(requestId || "").trim();
  const tx = db.transaction(() => {
    ensureArenaProfile(db, userId);
    const row = db
      .prepare(
        `SELECT *
         FROM arena_trade_requests
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedId);
    if (!row) {
      throw new ArenaHttpError(
        404,
        "Trade request not found.",
        "ARENA_TRADE_REQUEST_NOT_FOUND",
      );
    }
    if (row.responderId !== userId) {
      throw new ArenaHttpError(
        403,
        "This request is not for you.",
        "ARENA_TRADE_NOT_RESPONDER",
      );
    }
    if (row.status !== "pending") {
      throw new ArenaHttpError(
        409,
        "This trade request is no longer pending.",
        "ARENA_TRADE_REQUEST_NOT_PENDING",
      );
    }

    const now = nowIso();

    const listingRow = row.listingId
      ? db
          .prepare("SELECT id, cardJson FROM arena_trade_listings WHERE id = ? AND userId = ? AND status = 'active' LIMIT 1")
          .get(row.listingId, userId)
      : db
          .prepare("SELECT id, cardJson FROM arena_trade_listings WHERE userId = ? AND status = 'active' LIMIT 1")
          .get(userId);
    if (row.listingId && !listingRow) {
      throw new ArenaHttpError(
        409,
        "This trade listing is no longer active.",
        "ARENA_TRADE_LISTING_INACTIVE",
      );
    }

    // Helper to create a session and cancel old sessions/requests
    const createSession = (sessionCardInstanceId, sessionCardOwnerId, extraCards = {}) => {
      // Cancel any previous active sessions between these two users
      db.prepare(
        `UPDATE arena_trade_sessions
         SET status = 'cancelled', updatedAt = ?
         WHERE ((askerId = ? AND responderId = ?) OR (askerId = ? AND responderId = ?))
           AND status = 'active'`,
      ).run(now, row.askerId, userId, userId, row.askerId);

      const askerCardIds = uniqueTradeCardIds([
        sessionCardOwnerId === row.askerId ? sessionCardInstanceId : null,
        extraCards.askerCardInstanceId,
      ]);
      const responderCardIds = uniqueTradeCardIds([
        sessionCardOwnerId === userId ? sessionCardInstanceId : null,
        extraCards.responderCardInstanceId,
      ]);

      const sessionId = makeId("tradesess");
      db.prepare(
        `INSERT INTO arena_trade_sessions (id, requestId, askerId, responderId,
           askerCardInstanceId, responderCardInstanceId,
           askerCardInstanceIdsJson, responderCardInstanceIdsJson,
           status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      ).run(
        sessionId, normalizedId, row.askerId, userId,
        primaryTradeCardId(askerCardIds),
        primaryTradeCardId(responderCardIds),
        serializeTradeCardIds(askerCardIds),
        serializeTradeCardIds(responderCardIds),
        now, now,
      );

      // Cancel the listing if we consumed its card
      if (sessionCardOwnerId === userId && listingRow) {
        const listingCard = normalizeSelectedCard(listingRow.cardJson);
        if (!listingCard || !listingCard.cardInstanceId) {
          throw new ArenaHttpError(409, "Your listing card data is invalid.", "ARENA_TRADE_INVALID_LISTING_CARD");
        }
        insertCollectionCard(db, userId, listingCard);
        db.prepare(
          `UPDATE arena_trade_listings
           SET status = 'cancelled', cancelledAt = ?, updatedAt = ?
           WHERE id = ? AND status = 'active'`,
        ).run(now, now, listingRow.id);
      }

      db.prepare(
        `UPDATE arena_trade_requests
         SET status = 'accepted', respondedAt = ?, updatedAt = ?
         WHERE id = ? AND status = 'pending'`,
      ).run(now, now, normalizedId);

      // Cancel other pending requests for this responder
      db.prepare(
        `UPDATE arena_trade_requests
         SET status = 'cancelled', cancelledAt = ?, updatedAt = ?
         WHERE responderId = ? AND status = 'pending' AND id != ?`,
      ).run(now, now, userId, normalizedId);

      // Cancel other pending sessions involving this responder
      db.prepare(
        `UPDATE arena_trade_sessions
         SET status = 'cancelled', updatedAt = ?
         WHERE (askerId = ? OR responderId = ?) AND status = 'active' AND id != ?`,
      ).run(now, userId, userId, sessionId);

      const responderUser = db.prepare("SELECT username FROM users WHERE id = ?").get(userId);
      const responderName = responderUser?.username || "Someone";
      const askerUser = db.prepare("SELECT username FROM users WHERE id = ?").get(row.askerId);
      const askerName = askerUser?.username || "Someone";

      createArenaNotification(
        db, row.askerId, "trade_accepted",
        `${responderName} accepted your trade request!`,
        "Go to the trade page to offer cards.",
        "/arena/trade",
        JSON.stringify({ requestId: normalizedId, sessionId }),
      );

      createArenaNotification(
        db, userId, "trade_accepted",
        `You accepted ${askerName} trade request`,
        "Go to the trade page to offer cards.",
        "/arena/trade",
        JSON.stringify({ requestId: normalizedId, sessionId }),
      );

      const responderNotifRow = db.prepare(
        `SELECT id FROM arena_notifications
         WHERE userId = ? AND type = 'trade_request' AND metadata LIKE '%' || ? || '%'
         ORDER BY createdAt DESC LIMIT 1`,
      ).get(userId, normalizedId);
      if (responderNotifRow) {
        db.prepare(
          `UPDATE arena_notifications SET title = ?, body = NULL WHERE id = ?`,
        ).run(`You accepted ${askerName} trade request`, responderNotifRow.id);
      }

      _notifyUser(row.askerId, S2C.ARENA_TRADE_REQUEST_UPDATE, { requestId: normalizedId, status: "accepted", sessionId });
      return { sessionId };
    };

    // Case A: No listing AND no asker card → create empty session
    if (!listingRow && !row.askerCardInstanceId) {
      return createSession(null, null);
    }

    // Case B: Responder has listing, asker has no card → session with listing card pre-placed
    if (listingRow && !row.askerCardInstanceId) {
      const responderCard = normalizeSelectedCard(listingRow.cardJson);
      if (!responderCard || !responderCard.cardInstanceId) {
        throw new ArenaHttpError(409, "Your listing card data is invalid.", "ARENA_TRADE_INVALID_LISTING_CARD");
      }
      return createSession(responderCard.cardInstanceId, userId);
    }

    // Case C: Asker has card, responder has no listing → session with asker card pre-placed
    if (!listingRow && row.askerCardInstanceId) {
      const askerCardRow = db
        .prepare("SELECT cardJson FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ? LIMIT 1")
        .get(row.askerId, row.askerCardInstanceId);
      if (!askerCardRow) {
        throw new ArenaHttpError(409, "The asker's card is no longer available.", "ARENA_COLLECTION_CARD_NOT_FOUND");
      }
      const askerCard = normalizeSelectedCard(askerCardRow.cardJson);
      if (!askerCard || !askerCard.cardInstanceId) {
        throw new ArenaHttpError(409, "The asker's card data is invalid.", "ARENA_COLLECTION_CARD_INVALID");
      }
      return createSession(askerCard.cardInstanceId, row.askerId);
    }

    // Case D: Both have cards → start a normal confirmation session.
    const responderCard = normalizeSelectedCard(listingRow.cardJson);
    if (!responderCard || !responderCard.cardInstanceId) {
      throw new ArenaHttpError(409, "Your listing card data is invalid.", "ARENA_TRADE_INVALID_LISTING_CARD");
    }
    const askerCardRow = db
      .prepare("SELECT cardJson FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ? LIMIT 1")
      .get(row.askerId, row.askerCardInstanceId);
    if (!askerCardRow) {
      throw new ArenaHttpError(
        409,
        "The asker's card is no longer available.",
        "ARENA_COLLECTION_CARD_NOT_FOUND",
      );
    }
    const askerCard = normalizeSelectedCard(askerCardRow.cardJson);
    if (!askerCard) {
      throw new ArenaHttpError(
        409,
        "The asker's card data is invalid.",
        "ARENA_COLLECTION_CARD_INVALID",
      );
    }
    return createSession(responderCard.cardInstanceId, userId, {
      askerCardInstanceId: askerCard.cardInstanceId,
    });
  });

  return tx();
}

function denyTradeRequest(db, userId, requestId) {
  const normalizedId = String(requestId || "").trim();
  const tx = db.transaction(() => {
    ensureArenaProfile(db, userId);
    const row = db
      .prepare(
        `SELECT *
         FROM arena_trade_requests
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedId);
    if (!row) {
      throw new ArenaHttpError(
        404,
        "Trade request not found.",
        "ARENA_TRADE_REQUEST_NOT_FOUND",
      );
    }
    if (row.responderId !== userId) {
      throw new ArenaHttpError(
        403,
        "This request is not for you.",
        "ARENA_TRADE_NOT_RESPONDER",
      );
    }
    if (row.status !== "pending") {
      throw new ArenaHttpError(
        409,
        "This trade request is no longer pending.",
        "ARENA_TRADE_REQUEST_NOT_PENDING",
      );
    }

    const now = nowIso();
    db.prepare(
      `UPDATE arena_trade_requests
       SET status = 'denied', respondedAt = ?, updatedAt = ?
       WHERE id = ? AND status = 'pending'`,
    ).run(now, now, normalizedId);

    // Notify asker
    const responderUser = db.prepare("SELECT username FROM users WHERE id = ?").get(userId);
    const responderName = responderUser?.username || "Someone";
    const denyMeta = { askerCard: null, responderCard: null };
    if (row.askerCardInstanceId) {
      const askerCardRow = db.prepare("SELECT cardJson FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ? LIMIT 1")
        .get(row.askerId, row.askerCardInstanceId);
      if (askerCardRow) denyMeta.askerCard = normalizeSelectedCard(askerCardRow.cardJson);
    }
    const responderListedRow = row.listingId
      ? db.prepare("SELECT cardJson FROM arena_trade_listings WHERE id = ? AND userId = ? AND status = 'active' LIMIT 1")
        .get(row.listingId, userId)
      : db.prepare("SELECT cardJson FROM arena_trade_listings WHERE userId = ? AND status = 'active' LIMIT 1")
        .get(userId);
    if (responderListedRow) denyMeta.responderCard = normalizeSelectedCard(responderListedRow.cardJson);
    createArenaNotification(
      db, row.askerId, "trade_denied",
      `${responderName} denied your trade request`,
      null,
      "/arena/trade",
      JSON.stringify(denyMeta),
    );

    const askerUser = db.prepare("SELECT username FROM users WHERE id = ?").get(row.askerId);
    const askerName = askerUser?.username || "Someone";
    const responderNotif = db.prepare(
      `SELECT id FROM arena_notifications
       WHERE userId = ? AND type = 'trade_request' AND metadata LIKE '%' || ? || '%'
       ORDER BY createdAt DESC LIMIT 1`,
    ).get(userId, normalizedId);
    if (responderNotif) {
      db.prepare(
        `UPDATE arena_notifications SET title = ?, body = NULL WHERE id = ?`,
      ).run(`You denied ${askerName} trade request`, responderNotif.id);
    }
    _notifyUser(row.askerId, S2C.ARENA_TRADE_REQUEST_UPDATE, { requestId: normalizedId, status: "denied" });
  });

  tx();
  return { status: "denied" };
}

function cancelTradeRequest(db, userId, requestId) {
  const normalizedId = String(requestId || "").trim();
  const tx = db.transaction(() => {
    ensureArenaProfile(db, userId);
    const row = db
      .prepare(
        `SELECT *
         FROM arena_trade_requests
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedId);
    if (!row) {
      throw new ArenaHttpError(
        404,
        "Trade request not found.",
        "ARENA_TRADE_REQUEST_NOT_FOUND",
      );
    }
    if (row.askerId !== userId) {
      throw new ArenaHttpError(
        403,
        "You can only cancel your own trade requests.",
        "ARENA_TRADE_NOT_ASKER",
      );
    }
    if (row.status !== "pending") {
      throw new ArenaHttpError(
        409,
        "This trade request is no longer pending.",
        "ARENA_TRADE_REQUEST_NOT_PENDING",
      );
    }

    const now = nowIso();
    db.prepare(
      `UPDATE arena_trade_requests
       SET status = 'cancelled', cancelledAt = ?, updatedAt = ?
       WHERE id = ? AND status = 'pending'`,
    ).run(now, now, normalizedId);
    _notifyUser(row.responderId, S2C.ARENA_TRADE_REQUEST_UPDATE, { requestId: normalizedId, status: "cancelled" });
  });

  tx();
  return { status: "cancelled" };
}

function getTradeSession(db, userId, sessionId) {
  const normalizedId = String(sessionId || "").trim();
  const row = db
    .prepare(
      `SELECT
         s.*,
         asker.username AS askerUsername,
         responder.username AS responderUsername
       FROM arena_trade_sessions s
       LEFT JOIN users asker ON asker.id = s.askerId
       LEFT JOIN users responder ON responder.id = s.responderId
       WHERE s.id = ?
       LIMIT 1`,
    )
    .get(normalizedId);
  if (!row) return null;

  if (row.askerId !== userId && row.responderId !== userId) {
    throw new ArenaHttpError(
      403,
      "You are not a participant in this trade.",
      "ARENA_TRADE_NOT_PARTICIPANT",
    );
  }

  const askerCardIds = tradeCardIdsForSide(row, "asker");
  const responderCardIds = tradeCardIdsForSide(row, "responder");

  // Auto-cancel if either participant no longer has their placed cards
  if (row.status === "active") {
    let cardsMissing = false;
    for (const cardInstanceId of askerCardIds) {
      const askerOwns = db
        .prepare("SELECT id FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ? LIMIT 1")
        .get(row.askerId, cardInstanceId);
      if (!askerOwns) cardsMissing = true;
    }
    for (const cardInstanceId of responderCardIds) {
      const responderOwns = db
        .prepare("SELECT id FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ? LIMIT 1")
        .get(row.responderId, cardInstanceId);
      if (!responderOwns) cardsMissing = true;
    }
    if (cardsMissing) {
      const now = nowIso();
      db.prepare(
        `UPDATE arena_trade_sessions
         SET status = 'cancelled', updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      ).run(now, normalizedId);
      row.status = "cancelled";
    }
  }

  const askerCards = loadTradeCardsForOwner(
    db,
    row.status === "completed" ? row.responderId : row.askerId,
    askerCardIds,
  );
  const responderCards = loadTradeCardsForOwner(
    db,
    row.status === "completed" ? row.askerId : row.responderId,
    responderCardIds,
  );

  return {
    id: row.id,
    askerId: row.askerId,
    askerUsername: row.askerUsername || "Unknown",
    responderId: row.responderId,
    responderUsername: row.responderUsername || "Unknown",
    askerCard: askerCards[0] || null,
    responderCard: responderCards[0] || null,
    askerCards,
    responderCards,
    askerCoins: typeof row.askerCoins === "number" ? row.askerCoins : 0,
    responderCoins: typeof row.responderCoins === "number" ? row.responderCoins : 0,
    askerConfirmed: row.askerConfirmed === 1,
    responderConfirmed: row.responderConfirmed === 1,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function clearSelectedCardsForCompletedTrade(db, session, now) {
  const clearIfSelected = (ownerId, cardInstanceIds) => {
    const ids = uniqueTradeCardIds(cardInstanceIds);
    if (!ownerId || ids.length === 0) return;
    const profile = db
      .prepare("SELECT selectedCardJson FROM arena_profiles WHERE userId = ? LIMIT 1")
      .get(ownerId);
    const selectedCard = normalizeSelectedCard(profile?.selectedCardJson);
    if (!selectedCard?.cardInstanceId || !ids.includes(selectedCard.cardInstanceId)) return;
    db.prepare("UPDATE arena_profiles SET selectedCardJson = NULL, updatedAt = ? WHERE userId = ?")
      .run(now, ownerId);
  };

  clearIfSelected(session.askerId, tradeCardIdsForSide(session, "asker"));
  clearIfSelected(session.responderId, tradeCardIdsForSide(session, "responder"));
}

function offerCardInTrade(db, userId, sessionId, cardInstanceId) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedCardId = String(cardInstanceId || "").trim();
  if (!normalizedCardId) {
    throw new ArenaHttpError(
      400,
      "cardInstanceId is required.",
      "ARENA_CARD_INSTANCE_REQUIRED",
    );
  }

  const tx = db.transaction(() => {
    ensureArenaProfile(db, userId);
    const session = db
      .prepare(
        `SELECT *
         FROM arena_trade_sessions
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedSessionId);
    if (!session) {
      throw new ArenaHttpError(
        404,
        "Trade session not found.",
        "ARENA_TRADE_SESSION_NOT_FOUND",
      );
    }
    if (session.status !== "active") {
      throw new ArenaHttpError(
        409,
        "This trade session is no longer active.",
        "ARENA_TRADE_SESSION_INACTIVE",
      );
    }
    if (session.askerId !== userId && session.responderId !== userId) {
      throw new ArenaHttpError(
        403,
        "You are not a participant in this trade.",
        "ARENA_TRADE_NOT_PARTICIPANT",
      );
    }

    const collectionRow = db
      .prepare(
        `SELECT cardJson
         FROM arena_card_collection
         WHERE userId = ? AND cardInstanceId = ?
         LIMIT 1`,
      )
      .get(userId, normalizedCardId);
    if (!collectionRow) {
      throw new ArenaHttpError(
        404,
        "Card not found in your collection.",
        "ARENA_COLLECTION_CARD_NOT_FOUND",
      );
    }

    const otherCardInSession = findActiveTradeSessionUsingCard(db, normalizedCardId, normalizedSessionId);
    if (otherCardInSession) {
      throw new ArenaHttpError(
        409,
        "This card is already in another active trade session.",
        "ARENA_TRADE_CARD_IN_SESSION",
      );
    }

    const now = nowIso();
    if (session.askerId === userId) {
      const nextIds = uniqueTradeCardIds([
        ...tradeCardIdsForSide(session, "asker"),
        normalizedCardId,
      ]);
      db.prepare(
        `UPDATE arena_trade_sessions
         SET askerCardInstanceId = ?,
             askerCardInstanceIdsJson = ?,
             askerConfirmed = 0,
             responderConfirmed = 0,
             updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      ).run(
        primaryTradeCardId(nextIds),
        serializeTradeCardIds(nextIds),
        now,
        normalizedSessionId,
      );
    } else {
      const nextIds = uniqueTradeCardIds([
        ...tradeCardIdsForSide(session, "responder"),
        normalizedCardId,
      ]);
      db.prepare(
        `UPDATE arena_trade_sessions
         SET responderCardInstanceId = ?,
             responderCardInstanceIdsJson = ?,
             askerConfirmed = 0,
             responderConfirmed = 0,
             updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      ).run(
        primaryTradeCardId(nextIds),
        serializeTradeCardIds(nextIds),
        now,
        normalizedSessionId,
      );
    }
  });

  tx();
  const session = getTradeSession(db, userId, normalizedSessionId);
  _notifyUsers([session.askerId, session.responderId].filter(Boolean), S2C.ARENA_TRADE_SESSION_UPDATE, session);
  return session;
}

function removeCardFromTrade(db, userId, sessionId, cardInstanceId = null) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedCardId = String(cardInstanceId || "").trim();
  const tx = db.transaction(() => {
    ensureArenaProfile(db, userId);
    const session = db
      .prepare(
        `SELECT *
         FROM arena_trade_sessions
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedSessionId);
    if (!session) {
      throw new ArenaHttpError(
        404,
        "Trade session not found.",
        "ARENA_TRADE_SESSION_NOT_FOUND",
      );
    }
    if (session.status !== "active") {
      throw new ArenaHttpError(
        409,
        "This trade session is no longer active.",
        "ARENA_TRADE_SESSION_INACTIVE",
      );
    }
    if (session.askerId !== userId && session.responderId !== userId) {
      throw new ArenaHttpError(
        403,
        "You are not a participant in this trade.",
        "ARENA_TRADE_NOT_PARTICIPANT",
      );
    }

    const now = nowIso();
    if (session.askerId === userId) {
      const currentIds = tradeCardIdsForSide(session, "asker");
      const nextIds = normalizedCardId
        ? currentIds.filter((id) => id !== normalizedCardId)
        : [];
      db.prepare(
        `UPDATE arena_trade_sessions
         SET askerCardInstanceId = ?,
             askerCardInstanceIdsJson = ?,
             askerConfirmed = 0,
             responderConfirmed = 0,
             updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      ).run(
        primaryTradeCardId(nextIds),
        serializeTradeCardIds(nextIds),
        now,
        normalizedSessionId,
      );
    } else {
      const currentIds = tradeCardIdsForSide(session, "responder");
      const nextIds = normalizedCardId
        ? currentIds.filter((id) => id !== normalizedCardId)
        : [];
      db.prepare(
        `UPDATE arena_trade_sessions
          SET responderCardInstanceId = ?,
              responderCardInstanceIdsJson = ?,
              askerConfirmed = 0,
              responderConfirmed = 0,
              updatedAt = ?
          WHERE id = ? AND status = 'active'`,
      ).run(
        primaryTradeCardId(nextIds),
        serializeTradeCardIds(nextIds),
        now,
        normalizedSessionId,
      );
    }
  });

  tx();
  const session = getTradeSession(db, userId, normalizedSessionId);
  _notifyUsers([session.askerId, session.responderId].filter(Boolean), S2C.ARENA_TRADE_SESSION_UPDATE, session);
  return session;
}

function offerCoinInTrade(db, userId, sessionId, amount) {
  const normalizedSessionId = String(sessionId || "").trim();
  const coinAmount = Math.max(0, Math.floor(Number(amount) || 0));
  if (coinAmount <= 0) {
    throw new ArenaHttpError(
      400,
      "You must offer a positive amount of coins.",
      "ARENA_COINS_INVALID_AMOUNT",
    );
  }

  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    if (profile.coins < coinAmount) {
      throw new ArenaHttpError(
        400,
        "You do not have enough coins.",
        "ARENA_COINS_INSUFFICIENT",
      );
    }
    const session = db
      .prepare(
        `SELECT *
         FROM arena_trade_sessions
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedSessionId);
    if (!session) {
      throw new ArenaHttpError(
        404,
        "Trade session not found.",
        "ARENA_TRADE_SESSION_NOT_FOUND",
      );
    }
    if (session.status !== "active") {
      throw new ArenaHttpError(
        409,
        "This trade session is no longer active.",
        "ARENA_TRADE_SESSION_INACTIVE",
      );
    }
    if (session.askerId !== userId && session.responderId !== userId) {
      throw new ArenaHttpError(
        403,
        "You are not a participant in this trade.",
        "ARENA_TRADE_NOT_PARTICIPANT",
      );
    }

    const now = nowIso();
    if (session.askerId === userId) {
      db.prepare(
        `UPDATE arena_trade_sessions
         SET askerCoins = ?, askerConfirmed = 0, responderConfirmed = 0, updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      ).run(coinAmount, now, normalizedSessionId);
    } else {
      db.prepare(
        `UPDATE arena_trade_sessions
         SET responderCoins = ?, askerConfirmed = 0, responderConfirmed = 0, updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      ).run(coinAmount, now, normalizedSessionId);
    }
  });

  tx();
  const session = getTradeSession(db, userId, normalizedSessionId);
  _notifyUsers([session.askerId, session.responderId].filter(Boolean), S2C.ARENA_TRADE_SESSION_UPDATE, session);
  return session;
}

function removeCoinFromTrade(db, userId, sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  const tx = db.transaction(() => {
    ensureArenaProfile(db, userId);
    const session = db
      .prepare(
        `SELECT *
         FROM arena_trade_sessions
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedSessionId);
    if (!session) {
      throw new ArenaHttpError(
        404,
        "Trade session not found.",
        "ARENA_TRADE_SESSION_NOT_FOUND",
      );
    }
    if (session.status !== "active") {
      throw new ArenaHttpError(
        409,
        "This trade session is no longer active.",
        "ARENA_TRADE_SESSION_INACTIVE",
      );
    }
    if (session.askerId !== userId && session.responderId !== userId) {
      throw new ArenaHttpError(
        403,
        "You are not a participant in this trade.",
        "ARENA_TRADE_NOT_PARTICIPANT",
      );
    }

    const now = nowIso();
    if (session.askerId === userId) {
      db.prepare(
        `UPDATE arena_trade_sessions
         SET askerCoins = 0, askerConfirmed = 0, responderConfirmed = 0, updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      ).run(now, normalizedSessionId);
    } else {
      db.prepare(
        `UPDATE arena_trade_sessions
         SET responderCoins = 0, askerConfirmed = 0, responderConfirmed = 0, updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      ).run(now, normalizedSessionId);
    }
  });

  tx();
  const session = getTradeSession(db, userId, normalizedSessionId);
  _notifyUsers([session.askerId, session.responderId].filter(Boolean), S2C.ARENA_TRADE_SESSION_UPDATE, session);
  return session;
}

function confirmTrade(db, userId, sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  const tx = db.transaction(() => {
    ensureArenaProfile(db, userId);
    const session = db
      .prepare(
        `SELECT *
         FROM arena_trade_sessions
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedSessionId);
    if (!session) {
      throw new ArenaHttpError(
        404,
        "Trade session not found.",
        "ARENA_TRADE_SESSION_NOT_FOUND",
      );
    }
    if (session.status !== "active") {
      throw new ArenaHttpError(
        409,
        "This trade session is no longer active.",
        "ARENA_TRADE_SESSION_INACTIVE",
      );
    }
    if (session.askerId !== userId && session.responderId !== userId) {
      throw new ArenaHttpError(
        403,
        "You are not a participant in this trade.",
        "ARENA_TRADE_NOT_PARTICIPANT",
      );
    }

    const isAsker = session.askerId === userId;
    const userCardInstanceIds = tradeCardIdsForSide(session, isAsker ? "asker" : "responder");
    const userCoins = isAsker ? (session.askerCoins || 0) : (session.responderCoins || 0);

    // Validate card ownership if cards are placed
    for (const userCardInstanceId of userCardInstanceIds) {
      const collectionRow = db
        .prepare(
          `SELECT cardJson
           FROM arena_card_collection
           WHERE userId = ? AND cardInstanceId = ?
           LIMIT 1`,
        )
        .get(userId, userCardInstanceId);
      if (!collectionRow) {
        throw new ArenaHttpError(
          404,
          "Your offered card was not found in your collection.",
          "ARENA_COLLECTION_CARD_NOT_FOUND",
        );
      }
      const card = normalizeSelectedCard(collectionRow.cardJson);
      if (!card) {
        throw new ArenaHttpError(
          409,
          "Your card data is invalid.",
          "ARENA_COLLECTION_CARD_INVALID",
        );
      }
    }

    // Validate coin balance if coins are offered
    if (userCoins > 0) {
      const freshProfile = db
        .prepare("SELECT coins FROM arena_profiles WHERE userId = ?")
        .get(userId);
      if (!freshProfile || freshProfile.coins < userCoins) {
        throw new ArenaHttpError(
          400,
          "You do not have enough coins.",
          "ARENA_COINS_INSUFFICIENT",
        );
      }
    }

    const now = nowIso();
    if (isAsker) {
      db.prepare(
        `UPDATE arena_trade_sessions
         SET askerConfirmed = 1, updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      ).run(now, normalizedSessionId);
    } else {
      db.prepare(
        `UPDATE arena_trade_sessions
         SET responderConfirmed = 1, updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      ).run(now, normalizedSessionId);
    }

    // Check if both confirmed
    const updated = db
      .prepare(
        `SELECT *
         FROM arena_trade_sessions
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedSessionId);

    if (updated.askerConfirmed === 1 && updated.responderConfirmed === 1) {
      const askerCardInstanceIds = tradeCardIdsForSide(updated, "asker");
      const responderCardInstanceIds = tradeCardIdsForSide(updated, "responder");
      const askerCoinAmount = updated.askerCoins || 0;
      const responderCoinAmount = updated.responderCoins || 0;

      // Validate coin balances again before executing
      if (askerCoinAmount > 0) {
        const askerProfile = db
          .prepare("SELECT coins FROM arena_profiles WHERE userId = ?")
          .get(updated.askerId);
        if (!askerProfile || askerProfile.coins < askerCoinAmount) {
          throw new ArenaHttpError(
            400,
            "Asker no longer has enough coins.",
            "ARENA_COINS_INSUFFICIENT",
          );
        }
      }
      if (responderCoinAmount > 0) {
        const responderProfile = db
          .prepare("SELECT coins FROM arena_profiles WHERE userId = ?")
          .get(updated.responderId);
        if (!responderProfile || responderProfile.coins < responderCoinAmount) {
          throw new ArenaHttpError(
            400,
            "Responder no longer has enough coins.",
            "ARENA_COINS_INSUFFICIENT",
          );
        }
      }

      const loadOfferedCards = (ownerId, cardInstanceIds) =>
        cardInstanceIds.map((cardInstanceId) => {
          const row = db
            .prepare(
              `SELECT cardJson, id
               FROM arena_card_collection
               WHERE userId = ? AND cardInstanceId = ?
               LIMIT 1`,
            )
            .get(ownerId, cardInstanceId);
          if (!row) {
            throw new ArenaHttpError(
              409,
              "One of the cards is no longer available.",
              "ARENA_TRADE_CARD_UNAVAILABLE",
            );
          }
          const card = normalizeSelectedCard(row.cardJson);
          if (!card) {
            throw new ArenaHttpError(
              409,
              "One of the cards has invalid data.",
              "ARENA_COLLECTION_CARD_INVALID",
            );
          }
          return card;
        });

      const askerCards = loadOfferedCards(updated.askerId, askerCardInstanceIds);
      const responderCards = loadOfferedCards(updated.responderId, responderCardInstanceIds);

      // Transfer cards
      for (const cardInstanceId of askerCardInstanceIds) {
        db.prepare(
          `DELETE FROM arena_card_collection
           WHERE userId = ? AND cardInstanceId = ?`,
        ).run(updated.askerId, cardInstanceId);
      }
      for (const cardInstanceId of responderCardInstanceIds) {
        db.prepare(
          `DELETE FROM arena_card_collection
           WHERE userId = ? AND cardInstanceId = ?`,
        ).run(updated.responderId, cardInstanceId);
      }
      for (const card of askerCards) {
        insertCollectionCard(db, updated.responderId, card);
      }
      for (const card of responderCards) {
        insertCollectionCard(db, updated.askerId, card);
      }

      if (
        askerCardInstanceIds.length !== askerCards.length ||
        responderCardInstanceIds.length !== responderCards.length
      ) {
          throw new ArenaHttpError(
            409,
            "One of the cards is no longer available.",
            "ARENA_TRADE_CARD_UNAVAILABLE",
          );
      }

      clearSelectedCardsForCompletedTrade(db, updated, now);

      // Transfer coins
      if (askerCoinAmount > 0) {
        db.prepare("UPDATE arena_profiles SET coins = coins - ?, updatedAt = ? WHERE userId = ?")
          .run(askerCoinAmount, now, updated.askerId);
        db.prepare("UPDATE arena_profiles SET coins = coins + ?, updatedAt = ? WHERE userId = ?")
          .run(askerCoinAmount, now, updated.responderId);
      }
      if (responderCoinAmount > 0) {
        db.prepare("UPDATE arena_profiles SET coins = coins - ?, updatedAt = ? WHERE userId = ?")
          .run(responderCoinAmount, now, updated.responderId);
        db.prepare("UPDATE arena_profiles SET coins = coins + ?, updatedAt = ? WHERE userId = ?")
          .run(responderCoinAmount, now, updated.askerId);
      }

      db.prepare(
        `UPDATE arena_trade_sessions
         SET status = 'completed', completedAt = ?, updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      ).run(now, now, normalizedSessionId);
    }
  });

  tx();
  const session = getTradeSession(db, userId, normalizedSessionId);
  _notifyUsers([session.askerId, session.responderId].filter(Boolean), S2C.ARENA_TRADE_SESSION_UPDATE, session);
  return session;
}

function unconfirmTrade(db, userId, sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  const tx = db.transaction(() => {
    ensureArenaProfile(db, userId);
    const session = db
      .prepare(
        `SELECT *
         FROM arena_trade_sessions
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedSessionId);
    if (!session) {
      throw new ArenaHttpError(
        404,
        "Trade session not found.",
        "ARENA_TRADE_SESSION_NOT_FOUND",
      );
    }
    if (session.status !== "active") {
      throw new ArenaHttpError(
        409,
        "This trade session is no longer active.",
        "ARENA_TRADE_SESSION_INACTIVE",
      );
    }
    if (session.askerId !== userId && session.responderId !== userId) {
      throw new ArenaHttpError(
        403,
        "You are not a participant in this trade.",
        "ARENA_TRADE_NOT_PARTICIPANT",
      );
    }

    const now = nowIso();
    if (session.askerId === userId && session.askerConfirmed === 1) {
      db.prepare(
        `UPDATE arena_trade_sessions
         SET askerConfirmed = 0, updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      ).run(now, normalizedSessionId);
    } else if (session.responderId === userId && session.responderConfirmed === 1) {
      db.prepare(
        `UPDATE arena_trade_sessions
         SET responderConfirmed = 0, updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      ).run(now, normalizedSessionId);
    }
  });

  tx();
  const session = getTradeSession(db, userId, normalizedSessionId);
  _notifyUsers([session.askerId, session.responderId].filter(Boolean), S2C.ARENA_TRADE_SESSION_UPDATE, session);
  return session;
}

function cancelTradeSession(db, userId, sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  let otherUserId;
  const tx = db.transaction(() => {
    ensureArenaProfile(db, userId);
    const session = db
      .prepare(
        `SELECT *
         FROM arena_trade_sessions
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedSessionId);
    if (!session) {
      throw new ArenaHttpError(
        404,
        "Trade session not found.",
        "ARENA_TRADE_SESSION_NOT_FOUND",
      );
    }
    if (session.status !== "active") {
      throw new ArenaHttpError(
        409,
        "This trade session is no longer active.",
        "ARENA_TRADE_SESSION_INACTIVE",
      );
    }
    if (session.askerId !== userId && session.responderId !== userId) {
      throw new ArenaHttpError(
        403,
        "You are not a participant in this trade.",
        "ARENA_TRADE_NOT_PARTICIPANT",
      );
    }

    otherUserId = session.askerId === userId ? session.responderId : session.askerId;
    const now = nowIso();
    db.prepare(
      `UPDATE arena_trade_sessions
       SET status = 'cancelled', updatedAt = ?
       WHERE id = ? AND status = 'active'`,
    ).run(now, normalizedSessionId);
  });

  tx();
  _notifyUsers([userId, otherUserId].filter(Boolean), S2C.ARENA_TRADE_SESSION_UPDATE, { status: "cancelled", sessionId: normalizedSessionId });
  return { status: "cancelled" };
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
      Math.floor(clamp(toPositiveInt(iv.guard, 0), CARD_IV_MIN, CARD_IV_MAX) / 2),
    power: Math.floor(clamp(toPositiveInt(iv.power, 0), CARD_IV_MIN, CARD_IV_MAX) / 3),
    guard: Math.floor(clamp(toPositiveInt(iv.guard, 0), CARD_IV_MIN, CARD_IV_MAX) / 3),
    speed: Math.floor(clamp(toPositiveInt(iv.speed, 0), CARD_IV_MIN, CARD_IV_MAX) / 3),
    effectHit: Math.floor(clamp(toPositiveInt(iv.effectHit, 0), CARD_IV_MIN, CARD_IV_MAX) / 3),
  };
}

function calculateRoundPower(input) {
  const {
    power,
    guard,
    speed,
    equipmentBonus,
    rarity,
    level = 1,
    card,
    randomFn = Math.random,
  } = input;

  const rarityPower = Number(RARITY_CONFIG[rarity]?.powerBonus || 0) * (1 + (level ?? 1) * 0.02);
  const { malScoreBonus, popularityBonus } = metadataBonuses(card);
  const noise = randomInt(-10, 10, randomFn);

  return {
    value:
      power * 2.0 +
      guard * 1.7 +
      speed * 1.5 +
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

  while (profile.xp >= nextThreshold && profile.level < MAX_LEVEL) {
    profile.xp -= nextThreshold;
    profile.level += 1;
    profile.hp += LEVEL_UP_GAINS.hp;
    profile.power += LEVEL_UP_GAINS.power;
    profile.guard += LEVEL_UP_GAINS.guard;
    profile.speed += LEVEL_UP_GAINS.speed;
    profile.effectHit += LEVEL_UP_GAINS.effectHit;
    leveledUp += 1;
    nextThreshold = xpToNext(profile.level);
  }

  // Cap XP at 0 when at max level
  if (profile.level >= MAX_LEVEL) {
    profile.xp = 0;
  }

  return leveledUp;
}

function calculateWinXp(opponentLevel, roundsWon, currentWinStreak) {
  return (
    10 +
    Math.floor(opponentLevel * 2.5) +
    toInt(roundsWon, 0) * 2 +
    Math.floor(Math.log2(toInt(currentWinStreak, 0) + 1)) * 3
  );
}

function calculateWinCoins(opponentLevel, rarityCoinReward) {
  return (
    18 +
    toInt(opponentLevel, 0) * 5 +
    toInt(rarityCoinReward, 0)
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
  const { equipped, stats: equipmentStats, pct: equipmentPctStats } = computeEquipmentStats(db, profile.userId);
  const skillState = getSkillState(db, profile);
  const activePassives = [...skillState.passives].sort((a, b) => b.priority - a.priority);
  const selectedCard = normalizeSelectedCard(options.overrideCard || profile.selectedCard);
  const cardStats = selectedCard
    ? cardIvStatBonus(selectedCard)
    : { hp: 0, power: 0, guard: 0, speed: 0, effectHit: 0 };

  return {
    profile,
    equipped,
    activePassives,
    equipmentStats,
    equipmentPctStats,
    skillStats: skillState.stats,
    equipmentBonus: weightedEquipmentBonus(equipmentStats),
    selectedCard,
    rarity: selectedCard?.rarity || "C",
    baseStats: {
      hp: profile.hp + cardStats.hp + skillState.stats.hp,
      power: profile.power + cardStats.power + skillState.stats.power,
      guard: profile.guard + cardStats.guard + skillState.stats.guard,
      speed: profile.speed + cardStats.speed + skillState.stats.speed,
      effectHit: profile.effectHit + cardStats.effectHit + skillState.stats.effectHit,
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
      effectHit:
        profile.effectHit +
        equipmentStats.effectHit +
        cardStats.effectHit +
        skillState.stats.effectHit,
    },
  };
}

function resolveFightOpponentProfile(db, opponentSelection) {
  if (opponentSelection.isNpc) {
    return opponentSelection.profile;
  }
  return ensureArenaProfile(db, opponentSelection.profile.userId);
}

function buildFightStatBreakdown(snapshot) {
  const profile = snapshot.profile;
  const cardStats = snapshot.selectedCard
    ? cardIvStatBonus(snapshot.selectedCard)
    : { hp: 0, power: 0, guard: 0, speed: 0, effectHit: 0 };

  return {
    base: {
      hp: profile.hp,
      power: profile.power,
      guard: profile.guard,
      speed: profile.speed,
      effectHit: profile.effectHit,
    },
    equipment: { ...snapshot.equipmentStats },
    card: cardStats,
    skill: { ...snapshot.skillStats },
    total: { ...snapshot.totalStats },
  };
}

function buildPublicFightOpponentSnapshot(opponentSelection, opponentSnapshot) {
  const profile = opponentSnapshot.profile;

  return {
    userId: profile.userId,
    displayName: opponentSelection.displayName,
    isNpc: opponentSelection.isNpc,
    level: profile.level,
    eloRating: opponentSelection.isNpc ? null : profile.eloRating,
    eloMatches: opponentSelection.isNpc ? 0 : profile.eloMatches,
    eloProvisional: opponentSelection.isNpc
      ? false
      : isEloProvisional(profile.eloMatches),
    stats: { ...opponentSnapshot.totalStats },
    statBreakdown: buildFightStatBreakdown(opponentSnapshot),
    equipment: opponentSnapshot.equipped,
    equipmentPct: { ...(opponentSnapshot.equipmentPctStats || {}) },
    effects: normalizeArenaEffects(profile.effects || {}),
    activePassives: Array.isArray(opponentSnapshot.activePassives)
      ? opponentSnapshot.activePassives
      : [],
    selectedCard: opponentSnapshot.selectedCard,
  };
}

function loadFightOpponent(db, opponentSelection) {
  const profile = resolveFightOpponentProfile(db, opponentSelection);
  const snapshot = loadCombatSnapshot(db, profile);
  return {
    profile,
    snapshot,
    publicSnapshot: buildPublicFightOpponentSnapshot(opponentSelection, snapshot),
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
  if (effects.drawBonusChanceWinsRemaining > 0) {
    effects.drawBonusChanceWinsRemaining -= 1;
    if (effects.drawBonusChanceWinsRemaining === 0) effects.drawBonusChancePct = 0;
  }
}

function tryGrantBonusDraw(db, userId, effects) {
  if (!effects.drawBonusChancePct || effects.drawBonusChancePct <= 0) return null;
  if (Math.random() * 100 >= effects.drawBonusChancePct) return null;
  const catalog = getArenaCharacterCatalog();
  const index = Math.floor(Math.random() * catalog.characters.length);
  const malCard = { ...catalog.characters[index] };
  const drawnCard = createDrawnCard(malCard);
  insertCollectionCard(db, userId, drawnCard);
  return drawnCard;
}

function applyFightEffectUsage(effects, effectUsage) {
  const next = normalizeArenaEffects(effects);

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
  if (effectUsage.usedHigherRarityBonus && next.higherRarityDamageBonusPctCharges > 0) {
    next.higherRarityDamageBonusPctCharges -= 1;
    if (next.higherRarityDamageBonusPctCharges === 0) {
      next.higherRarityDamageBonusPct = 0;
    }
  }
  if (effectUsage.usedDoublePassiveTrigger && next.doublePassiveTriggerFightsRemaining > 0) {
    next.doublePassiveTriggerFightsRemaining -= 1;
  }
  if (effectUsage.usedDamageBoost && next.damageBoostFightsRemaining > 0) {
    next.damageBoostFightsRemaining -= 1;
    if (next.damageBoostFightsRemaining === 0) {
      next.damageBoostPct = 0;
    }
  }
  if (effectUsage.usedSpeedBoost && next.speedBoostFightsRemaining > 0) {
    next.speedBoostFightsRemaining -= 1;
    if (next.speedBoostFightsRemaining === 0) {
      next.speedBoostPct = 0;
    }
  }
  if (effectUsage.usedDeathSave && next.deathSaveCharges > 0) {
    next.deathSaveCharges -= 1;
  }
  if (effectUsage.usedStatSteroid && next.statSteroidFightsRemaining > 0) {
    next.statSteroidFightsRemaining -= 1;
    if (next.statSteroidFightsRemaining === 0) {
      next.statSteroidPct = 0;
    }
  }
  if (effectUsage.usedMatchRarity && next.matchRarityCharges > 0) {
    next.matchRarityCharges -= 1;
  }
  if (effectUsage.usedVampiricHeal && next.vampiricHealFightsRemaining > 0) {
    next.vampiricHealFightsRemaining -= 1;
    if (next.vampiricHealFightsRemaining === 0) {
      next.vampiricHealPct = 0;
    }
  }
  if (effectUsage.usedCritChanceBoost && next.critChanceBoostFightsRemaining > 0) {
    next.critChanceBoostFightsRemaining -= 1;
    if (next.critChanceBoostFightsRemaining === 0) {
      next.critChanceBoostPct = 0;
    }
  }
  if (effectUsage.usedIvBoost && next.ivBoostCharges > 0) {
    next.ivBoostCharges -= 1;
  }
  if (effectUsage.usedGuardBoost && next.guardBoostFightsRemaining > 0) {
    next.guardBoostFightsRemaining -= 1;
    if (next.guardBoostFightsRemaining === 0) {
      next.guardBoostPct = 0;
    }
  }
  if (effectUsage.usedFirstAttackDouble && next.firstAttackDoubleCharges > 0) {
    next.firstAttackDoubleCharges -= 1;
  }
  if (effectUsage.usedSelfRevive && next.selfReviveCharges > 0) {
    next.selfReviveCharges -= 1;
    if (next.selfReviveCharges === 0) {
      next.selfReviveHpThresholdPct = 0;
    }
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

function rollFightMaterialRewards() {
  return [];
}

function toCombatName(input, fallback) {
  if (typeof input === "string" && input.trim()) return input.trim();
  return fallback;
}

function computeMaxHp(stats, hpPct = 0) {
  const hpBase = toInt(stats?.hp, 1);
  const guardBonus = Math.floor(toInt(stats?.guard, 0) * 1.5);
  const utilityBonus = Math.floor(
    (toInt(stats?.power, 0) + toInt(stats?.speed, 0)) * 0.7,
  );
  const base = Math.max(30, hpBase + guardBonus + utilityBonus);
  return Math.max(30, Math.floor(base * (1 + hpPct / 100)));
}

function computeEvasionChance(attackerStats, defenderStats, extraDefenderEvasionPct = 0) {
  return clamp(
    0.04 +
      toInt(defenderStats?.speed, 0) * 0.004 -
      toInt(attackerStats?.speed, 0) * 0.002 +
      Number(extraDefenderEvasionPct || 0) / 100,
    0.02,
    0.6,
  );
}

function calculateAttackOutcome(input) {
  const {
    attackerStats,
    defenderStats,
    attackerRarity,
    attackerLevel = 1,
    defenderRarity,
    defenderLevel = 1,
    bonusCritChancePct = 0,
    attackerDamageFlat = 0,
    attackerDamagePct = 0,
    attackerTrueDamage = 0,
    defenderDamageReductionPct = 0,
    defenderDamageReductionFlat = 0,
    extraDefenderEvasionPct = 0,
    baseCritMultiplier = 1.0,
    elementMult = 1,
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
      baseCritMultiplier: 0,
    };
  }

  const rarityPower = Number(RARITY_CONFIG[attackerRarity]?.powerBonus || 0) * (1 + (attackerLevel ?? 1) * 0.02);
  const attackRoll =
    toInt(attackerStats?.power, 0) * 1.8 +
    toInt(attackerStats?.speed, 0) * 0.7 +
    rarityPower +
    randomInt(-6, 12, randomFn);
  const defenseRoll =
    toInt(defenderStats?.guard, 0) * 1.6 +
    toInt(defenderStats?.speed, 0) * 0.35 +
    (Number(RARITY_CONFIG[defenderRarity]?.powerBonus || 0)) * (1 + (defenderLevel ?? 1) * 0.02) +
    randomInt(-4, 8, randomFn);

  let damage = Math.max(1, Math.floor(attackRoll - defenseRoll * 0.55));
  damage += toInt(attackerDamageFlat, 0);
  damage = Math.floor(damage * (1 + Number(attackerDamagePct || 0) / 100));

  let critical = false;
  const critChance = clamp(
    0.05 + Number(bonusCritChancePct || 0) / 100,
    0.05,
    0.95,
  );
  if (elementMult > 1.0) {
    // Super-effective hits can still crit, but at halved chance
    critical = randomFn() < critChance * 0.5;
  } else {
    critical = randomFn() < critChance;
  }
  if (critical) {
    damage = Math.max(1, Math.floor(damage * Math.max(baseCritMultiplier, 0)));
  }

  const defDivisor = 1 + Number(defenderDamageReductionPct || 0) / 100;
  damage = Math.floor(damage / defDivisor);
  damage -= toInt(defenderDamageReductionFlat, 0);
  damage = Math.max(1, damage);
  const trueDamage = Math.max(toInt(attackerTrueDamage, 0), 0);

  return {
    avoided: false,
    critical,
    damage,
    trueDamage,
    baseCritMultiplier,
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
    reduceElementEffectivenessPct: 0,
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
      } else if (type === "reduceElementEffectivenessPct") {
        selfRuntime.reduceElementEffectivenessPct += value;
      } else if (type === "extraStrikePct") {
        mods.extraStrikeChancePct = 100;
        mods.extraStrikeDamagePct = Math.max(mods.extraStrikeDamagePct, value);
      }
    });
  });

  return mods;
}

function chooseEloOpponent(db, userId, randomFn = Math.random) {
  const player = ensureArenaProfile(db, userId);

  const recentOpponentRows = db
    .prepare(
      `SELECT opponentUserId
       FROM arena_fights
       WHERE userId = ? AND opponentUserId NOT LIKE 'npc:%'
       ORDER BY createdAt DESC
       LIMIT ?`,
    )
    .all(userId, RECENT_OPPONENT_LIMIT);
  const recentOpponentIds = new Set(
    recentOpponentRows
      .map((row) => row.opponentUserId)
      .filter(Boolean),
  );

  const candidates = db
    .prepare(
      `SELECT p.*
       FROM arena_profiles p
       JOIN users u ON u.id = p.userId
       WHERE p.userId <> ?
         AND p.selectedCardJson IS NOT NULL
       ORDER BY ABS(p.eloRating - ?) ASC,
                p.eloMatches DESC,
                p.eloRating DESC
       LIMIT ?`,
    )
    .all(userId, player.eloRating, ELO_MATCHMAKING_CANDIDATE_LIMIT)
    .map(mapArenaProfileRow)
    .filter(Boolean);

  const freshCandidates = candidates.filter(
    (candidate) => !recentOpponentIds.has(candidate.userId),
  );
  const pool = (freshCandidates.length > 0 ? freshCandidates : candidates).slice(
    0,
    ELO_MATCHMAKING_POOL_SIZE,
  );

  if (pool.length === 0) return null;

  const idx = Math.floor(randomFn() * pool.length);
  return pool[idx];
}

function applyEloResult(db, attackerUserId, opponentUserId, attackerWon) {
  const attacker = ensureArenaProfile(db, attackerUserId);
  const opponent = ensureArenaProfile(db, opponentUserId);
  const winner = attackerWon ? attacker : opponent;
  const loser = attackerWon ? opponent : attacker;
  const exchange = calculateEloExchange(winner, loser);
  const winnerMatches = winner.eloMatches + 1;
  const loserMatches = loser.eloMatches + 1;
  const winnerPeak = Math.max(winner.peakElo, exchange.winnerAfter);
  const loserPeak = Math.max(loser.peakElo, exchange.loserAfter);
  const updatedAt = nowIso();

  db.prepare(
    `UPDATE arena_profiles
     SET eloRating = ?, eloMatches = ?, peakElo = ?, updatedAt = ?
     WHERE userId = ?`,
  ).run(
    exchange.winnerAfter,
    winnerMatches,
    winnerPeak,
    updatedAt,
    winner.userId,
  );
  db.prepare(
    `UPDATE arena_profiles
     SET eloRating = ?, eloMatches = ?, peakElo = ?, updatedAt = ?
     WHERE userId = ?`,
  ).run(
    exchange.loserAfter,
    loserMatches,
    loserPeak,
    updatedAt,
    loser.userId,
  );

  const attackerBefore = attackerWon
    ? exchange.winnerBefore
    : exchange.loserBefore;
  const attackerAfter = attackerWon
    ? exchange.winnerAfter
    : exchange.loserAfter;
  const opponentBefore = attackerWon
    ? exchange.loserBefore
    : exchange.winnerBefore;
  const opponentAfter = attackerWon
    ? exchange.loserAfter
    : exchange.winnerAfter;

  return {
    rated: true,
    kFactor: exchange.kFactor,
    playerBefore: attackerBefore,
    playerAfter: attackerAfter,
    playerDelta: attackerAfter - attackerBefore,
    opponentBefore,
    opponentAfter,
    opponentDelta: opponentAfter - opponentBefore,
  };
}

function incrementDailyOpponentCount(db, userId) {
  if (!userId) return;
  const now = nowIso();
  db.prepare(
    `UPDATE arena_profiles
     SET dailyOpponentCount = CASE
       WHEN lastOpponentDate > datetime('now', '-5 hours') THEN dailyOpponentCount + 1
       ELSE 1
     END,
     lastOpponentDate = ?
     WHERE userId = ?`,
  ).run(now, userId);
}

function resetDailyOpponentCount(db, userId) {
  if (!userId) return;
  db.prepare(
    `UPDATE arena_profiles SET dailyOpponentCount = 0 WHERE userId = ?`,
  ).run(userId);
}

function resetAllDefenderCaps(db) {
  db.prepare(
    "UPDATE arena_profiles SET dailyOpponentCount = 0, lastOpponentDate = NULL",
  ).run();
}

const NPC_TEMPLATES = [
  {
    id: "training-slime",
    displayName: "Training Slime",
    levelMax: 4,
    rarity: "C",
    ivRange: { min: 4, max: 14 },
    statScale: 0.75,
  },
  {
    id: "shadow-pupil",
    displayName: "Shadow Pupil",
    levelMax: 9,
    rarity: "R",
    ivRange: { min: 6, max: 16 },
    statScale: 0.78,
  },
  {
    id: "steel-paladin",
    displayName: "Steel Paladin",
    levelMax: 19,
    rarity: "R",
    ivRange: { min: 10, max: 22 },
    statScale: 0.82,
  },
  {
    id: "arcane-knight",
    displayName: "Arcane Knight",
    levelMax: 34,
    rarity: "SR",
    ivRange: { min: 14, max: 26 },
    statScale: 0.87,
  },
  {
    id: "dread-lord",
    displayName: "Dread Lord",
    levelMax: 49,
    rarity: "SR",
    ivRange: { min: 18, max: 30 },
    statScale: 0.92,
  },
  {
    id: "celestial-warden",
    displayName: "Celestial Warden",
    levelMax: 64,
    rarity: "SSR",
    ivRange: { min: 20, max: 31 },
    statScale: 0.95,
  },
  {
    id: "void-archon",
    displayName: "Void Archon",
    levelMax: 70,
    rarity: "UR",
    ivRange: { min: 22, max: 31 },
    statScale: 0.98,
  },
];

function getNpcTemplateForLevel(npcLevel) {
  for (const t of NPC_TEMPLATES) {
    if (npcLevel <= t.levelMax) return t;
  }
  return NPC_TEMPLATES[NPC_TEMPLATES.length - 1];
}

async function buildNpcOpponent(db, playerLevel = 1) {
  const npcLevel = Math.max(1, Math.min(playerLevel, 70));
  const template = getNpcTemplateForLevel(npcLevel);

  const malCard = await drawArenaCard(db);
  const npcCard = createDrawnCard(malCard, {
    rarity: template.rarity,
    ivMin: template.ivRange.min,
    ivMax: template.ivRange.max,
  });

  const levelDelta = npcLevel - 1;
  const baseStats = {
    hp: BASE_PROFILE.hp + LEVEL_UP_GAINS.hp * levelDelta,
    power: BASE_PROFILE.power + LEVEL_UP_GAINS.power * levelDelta,
    guard: BASE_PROFILE.guard + LEVEL_UP_GAINS.guard * levelDelta,
    speed: BASE_PROFILE.speed + LEVEL_UP_GAINS.speed * levelDelta,
    effectHit: BASE_PROFILE.effectHit + LEVEL_UP_GAINS.effectHit * levelDelta,
  };

  return {
    userId: `npc:${template.id}`,
    level: npcLevel,
    xp: 0,
    coins: 0,
    wins: 0,
    losses: 0,
    winStreak: 0,
    hp: Math.floor(baseStats.hp * template.statScale),
    power: Math.floor(baseStats.power * template.statScale),
    guard: Math.floor(baseStats.guard * template.statScale),
    speed: Math.floor(baseStats.speed * template.statScale),
    effectHit: Math.floor(baseStats.effectHit * template.statScale),
    lifetimeCoinsEarned: 0,
    eloRating: 600 + Math.floor(Math.random() * 400) + (npcLevel - 1) * 10,
    eloMatches: 0,
    peakElo: ELO_DEFAULT_RATING,
    selectedCard: npcCard,
    lastCardDrawDate: getCurrentRecordedDate(),
    effects: normalizeArenaEffects(ARENA_EFFECT_DEFAULTS),
    lastFightAt: null,
    createdAt: null,
    updatedAt: null,
    isNpc: true,
    displayName: template.displayName,
  };
}

async function selectOpponentForFight(db, userId) {
  const player = ensureArenaProfile(db, userId);

  // Levels 1-4 only fight NPCs
  if (player.level < 5) {
    const npc = await buildNpcOpponent(db, player.level);
    return { profile: npc, isNpc: true, displayName: npc.displayName };
  }

  const realOpponent = chooseEloOpponent(db, userId);

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

  // Fall back to NPC if no real opponent available
  const npc = await buildNpcOpponent(db, player.level);
  return { profile: npc, isNpc: true, displayName: npc.displayName };
}

async function simulateFight(db, input) {
  const { player, opponent, playerEffects: rawEffects, opponentEffects: rawOppEffects, randomFn = Math.random } = input;
  const playerEffects = normalizeArenaEffects(rawEffects || {});
  const opponentEffects = normalizeArenaEffects(rawOppEffects || {});

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
  let opponentCard = opponent.selectedCard;
  let opponentRarity = opponent.rarity;
  const playerName = toCombatName(playerCard.title, "Player");
  const opponentName = toCombatName(opponentCard.title, "Opponent");

  const playerElement = ELEMENTS.includes(playerCard.element) ? playerCard.element : null;
  const opponentElement = ELEMENTS.includes(opponentCard.element) ? opponentCard.element : null;

  function getElementEffectiveness(attackerElement, defenderElement) {
    if (!attackerElement || !defenderElement) return null;
    if (!ELEMENT_EFFECTIVENESS[attackerElement] || !ELEMENT_EFFECTIVENESS[attackerElement][defenderElement]) return null;
    const mult = ELEMENT_EFFECTIVENESS[attackerElement][defenderElement];
    if (mult > 1.0) return "super-effective";
    if (mult < 1.0) return "not-very-effective";
    return null;
  }

  const playerVsOpponentEffectiveness = getElementEffectiveness(playerElement, opponentElement);
  const opponentVsPlayerEffectiveness = getElementEffectiveness(opponentElement, playerElement);

  const effectUsage = {
    usedRerollKeepHigher: false,
    usedUpgradeLowest: false,
    usedGuaranteeSsrPlus: false,
    usedFightStartShield: false,
    usedEvadeBoost: false,
    usedFirstHitTrueDamage: false,
    usedHigherRarityBonus: false,
    usedDoublePassiveTrigger: false,
    usedDamageBoost: false,
    usedSpeedBoost: false,
    usedDeathSave: false,
    usedStatSteroid: false,
    usedMatchRarity: false,
    usedVampiricHeal: false,
    usedCritChanceBoost: false,
    usedGuardBoost: false,
    usedFirstAttackDouble: false,
    usedSelfRevive: false,
    usedIvBoost: false,
  };

  const oppEffectUsage = {
    usedFightStartShield: false,
    usedEvadeBoost: false,
    usedFirstHitTrueDamage: false,
    usedHigherRarityBonus: false,
    usedDoublePassiveTrigger: false,
    usedDamageBoost: false,
    usedSpeedBoost: false,
    usedDeathSave: false,
    usedStatSteroid: false,
    usedMatchRarity: false,
    usedVampiricHeal: false,
    usedCritChanceBoost: false,
    usedGuardBoost: false,
    usedFirstAttackDouble: false,
    usedSelfRevive: false,
    usedIvBoost: false,
  };

  // ---- New consumable effects applied at fight start ----

  if (playerEffects.damageBoostFightsRemaining > 0 && playerEffects.damageBoostPct > 0) {
    effectUsage.usedDamageBoost = true;
  }

  if (playerEffects.speedBoostFightsRemaining > 0 && playerEffects.speedBoostPct > 0) {
    playerTotalStats.speed = Math.floor(playerTotalStats.speed * (1 + playerEffects.speedBoostPct / 100));
    playerBaseStats.speed = Math.floor(playerBaseStats.speed * (1 + playerEffects.speedBoostPct / 100));
    effectUsage.usedSpeedBoost = true;
  }

  if (playerEffects.statSteroidFightsRemaining > 0 && playerEffects.statSteroidPct > 0) {
    const pct = 1 + playerEffects.statSteroidPct / 100;
    playerTotalStats.power = Math.floor(playerTotalStats.power * pct);
    playerTotalStats.guard = Math.floor(playerTotalStats.guard * pct);
    playerTotalStats.speed = Math.floor(playerTotalStats.speed * pct);
    playerTotalStats.effectHit = Math.floor(playerTotalStats.effectHit * pct);
    playerBaseStats.power = Math.floor(playerBaseStats.power * pct);
    playerBaseStats.guard = Math.floor(playerBaseStats.guard * pct);
    playerBaseStats.speed = Math.floor(playerBaseStats.speed * pct);
    playerBaseStats.effectHit = Math.floor(playerBaseStats.effectHit * pct);
    effectUsage.usedStatSteroid = true;
  }

  if (playerEffects.guardBoostFightsRemaining > 0 && playerEffects.guardBoostPct > 0) {
    playerTotalStats.guard = Math.floor(playerTotalStats.guard * (1 + playerEffects.guardBoostPct / 100));
    playerBaseStats.guard = Math.floor(playerBaseStats.guard * (1 + playerEffects.guardBoostPct / 100));
    effectUsage.usedGuardBoost = true;
  }

  if (playerEffects.critChanceBoostFightsRemaining > 0 && playerEffects.critChanceBoostPct > 0) {
    effectUsage.usedCritChanceBoost = true;
  }

  if (playerEffects.ivBoostCharges > 0) {
    const boostedCard = { ...playerCard, iv: { ...playerCard.iv } };
    const ivStats = ["power", "guard", "speed", "effectHit"];
    const totalBoost = 5;
    for (let i = 0; i < totalBoost; i++) {
      const stat = ivStats[Math.floor(randomFn() * ivStats.length)];
      boostedCard.iv[stat] = Math.min((boostedCard.iv[stat] || 0) + 1, CARD_IV_MAX);
    }
    boostedCard.iv.total = ivStats.reduce((s, k) => s + (boostedCard.iv[k] || 0), 0);

    const origCardStats = cardIvStatBonus(playerCard);
    const boostedCardStats = cardIvStatBonus(boostedCard);
    const statDelta = (key) => (boostedCardStats[key] || 0) - (origCardStats[key] || 0);

    playerTotalStats.hp += statDelta("hp");
    playerTotalStats.power += statDelta("power");
    playerTotalStats.guard += statDelta("guard");
    playerTotalStats.speed += statDelta("speed");
    playerTotalStats.effectHit += statDelta("effectHit");
    playerBaseStats.hp += statDelta("hp");
    playerBaseStats.power += statDelta("power");
    playerBaseStats.guard += statDelta("guard");
    playerBaseStats.speed += statDelta("speed");
    playerBaseStats.effectHit += statDelta("effectHit");

    playerCard = boostedCard;
    effectUsage.usedIvBoost = true;
  }

  if (playerEffects.matchRarityCharges > 0) {
    const oppRank = rarityRank(opponentRarity);
    const playerRank = rarityRank(playerRarity);
    if (oppRank > playerRank) {
      playerRarity = opponentRarity;
    }
    effectUsage.usedMatchRarity = true;
  }

  if (playerEffects.vampiricHealFightsRemaining > 0 && playerEffects.vampiricHealPct > 0) {
    effectUsage.usedVampiricHeal = true;
  }

  // ---- End new consumable effects ----

  // ---- Opponent consumable effects applied at fight start ----

  if (opponentEffects.damageBoostFightsRemaining > 0 && opponentEffects.damageBoostPct > 0) {
    oppEffectUsage.usedDamageBoost = true;
  }

  if (opponentEffects.speedBoostFightsRemaining > 0 && opponentEffects.speedBoostPct > 0) {
    opponent.totalStats.speed = Math.floor(opponent.totalStats.speed * (1 + opponentEffects.speedBoostPct / 100));
    oppEffectUsage.usedSpeedBoost = true;
  }

  if (opponentEffects.statSteroidFightsRemaining > 0 && opponentEffects.statSteroidPct > 0) {
    const pct = 1 + opponentEffects.statSteroidPct / 100;
    opponent.totalStats.power = Math.floor(opponent.totalStats.power * pct);
    opponent.totalStats.guard = Math.floor(opponent.totalStats.guard * pct);
    opponent.totalStats.speed = Math.floor(opponent.totalStats.speed * pct);
    opponent.totalStats.effectHit = Math.floor(opponent.totalStats.effectHit * pct);
    oppEffectUsage.usedStatSteroid = true;
  }

  if (opponentEffects.guardBoostFightsRemaining > 0 && opponentEffects.guardBoostPct > 0) {
    opponent.totalStats.guard = Math.floor(opponent.totalStats.guard * (1 + opponentEffects.guardBoostPct / 100));
    oppEffectUsage.usedGuardBoost = true;
  }

  if (opponentEffects.critChanceBoostFightsRemaining > 0 && opponentEffects.critChanceBoostPct > 0) {
    oppEffectUsage.usedCritChanceBoost = true;
  }

  if (opponentEffects.ivBoostCharges > 0) {
    const boostedCard = { ...opponentCard, iv: { ...opponentCard.iv } };
    const ivStats = ["power", "guard", "speed", "effectHit"];
    const totalBoost = 5;
    for (let i = 0; i < totalBoost; i++) {
      const stat = ivStats[Math.floor(randomFn() * ivStats.length)];
      boostedCard.iv[stat] = Math.min((boostedCard.iv[stat] || 0) + 1, CARD_IV_MAX);
    }
    boostedCard.iv.total = ivStats.reduce((s, k) => s + (boostedCard.iv[k] || 0), 0);

    const origCardStats = cardIvStatBonus(opponentCard);
    const boostedCardStats = cardIvStatBonus(boostedCard);
    const statDelta = (key) => (boostedCardStats[key] || 0) - (origCardStats[key] || 0);

    opponent.totalStats.hp += statDelta("hp");
    opponent.totalStats.power += statDelta("power");
    opponent.totalStats.guard += statDelta("guard");
    opponent.totalStats.speed += statDelta("speed");
    opponent.totalStats.effectHit += statDelta("effectHit");

    opponentCard = boostedCard;
    oppEffectUsage.usedIvBoost = true;
  }

  if (opponentEffects.matchRarityCharges > 0) {
    const playerRank = rarityRank(playerRarity);
    const oppRank = rarityRank(opponentRarity);
    if (playerRank > oppRank) {
      opponentRarity = playerRarity;
    }
    oppEffectUsage.usedMatchRarity = true;
  }

  if (opponentEffects.vampiricHealFightsRemaining > 0 && opponentEffects.vampiricHealPct > 0) {
    oppEffectUsage.usedVampiricHeal = true;
  }

  // ---- End opponent consumable effects ----

  const playerRuntime = buildPassiveRuntime();
  const opponentRuntime = buildPassiveRuntime();
  const playerPassives = Array.isArray(player.activePassives) ? player.activePassives : [];
  const opponentPassives = Array.isArray(opponent.activePassives)
    ? opponent.activePassives
    : [];
  const passiveChanceMultiplier = playerEffects.doublePassiveTriggerFightsRemaining > 0 ? 2 : 1;
  const opponentPassiveChanceMultiplier = opponentEffects.doublePassiveTriggerFightsRemaining > 0 ? 2 : 1;
  effectUsage.usedDoublePassiveTrigger =
    playerEffects.doublePassiveTriggerFightsRemaining > 0;
  oppEffectUsage.usedDoublePassiveTrigger =
    opponentEffects.doublePassiveTriggerFightsRemaining > 0;

  if (playerEffects.fightStartShieldCharges > 0 && playerEffects.fightStartShieldAmount > 0) {
    playerRuntime.shield += playerEffects.fightStartShieldAmount;
    effectUsage.usedFightStartShield = true;
  }

  if (opponentEffects.fightStartShieldCharges > 0 && opponentEffects.fightStartShieldAmount > 0) {
    opponentRuntime.shield += opponentEffects.fightStartShieldAmount;
    oppEffectUsage.usedFightStartShield = true;
  }

  if (playerEffects.evadeBoostFightsRemaining > 0 && playerEffects.evadeBoostPct > 0) {
    playerRuntime.evasionPct += playerEffects.evadeBoostPct;
    effectUsage.usedEvadeBoost = true;
  }

  if (opponentEffects.evadeBoostFightsRemaining > 0 && opponentEffects.evadeBoostPct > 0) {
    opponentRuntime.evasionPct += opponentEffects.evadeBoostPct;
    oppEffectUsage.usedEvadeBoost = true;
  }

  const playerHpPct = player.equipmentPctStats?.hpPct || 0;
  const opponentHpPct = opponent.equipmentPctStats?.hpPct || 0;
  const provisionalPlayerMaxHp = computeMaxHp(playerTotalStats, playerHpPct);
  const provisionalOpponentMaxHp = computeMaxHp(opponent.totalStats, opponentHpPct);
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
    passiveChanceMultiplier: opponentPassiveChanceMultiplier,
  });

  const turns = [];
  const battleConsole = [];
  const maxPlayerHp = computeMaxHp(playerTotalStats, playerHpPct);
  const maxOpponentHp = computeMaxHp(opponent.totalStats, opponentHpPct);
  let playerHp = maxPlayerHp;
  let opponentHp = maxOpponentHp;
  let turnCounter = 0;

  const pushConsole = (line) => {
    battleConsole.push({
      line,
      playerHp,
      opponentHp,
      turn: turnCounter,
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

  const hasOpponentHigherRarityBonus =
    opponentEffects.higherRarityDamageBonusPctCharges > 0 &&
    rarityRank(opponentRarity) < rarityRank(playerRarity);
  oppEffectUsage.usedHigherRarityBonus = hasOpponentHigherRarityBonus;

  let firstHitBombConsumed = false;
  let opponentFirstHitBombConsumed = false;

  const runAttack = (attackerSide, firstActor) => {
    if (playerHp <= 0 || opponentHp <= 0) return;
    turnCounter += 1;

    const attackerIsPlayer = attackerSide === "player";
    const attackerName = attackerIsPlayer ? playerName : opponentName;
    const defenderName = attackerIsPlayer ? opponentName : playerName;
    const attackerStats = attackerIsPlayer ? playerTotalStats : opponent.totalStats;
    const defenderStats = attackerIsPlayer ? opponent.totalStats : playerTotalStats;
    const attackerRarity = attackerIsPlayer ? playerRarity : opponentRarity;
    const defenderRarity = attackerIsPlayer ? opponentRarity : playerRarity;
    const attackerElement = attackerIsPlayer ? playerElement : opponentElement;
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
          elementEffective: attackerIsPlayer ? playerVsOpponentEffectiveness : opponentVsPlayerEffectiveness,
        },
      },
      randomFn,
      passiveChanceMultiplier: attackerIsPlayer ? passiveChanceMultiplier : opponentPassiveChanceMultiplier,
    });

    const pendingTrueDamage =
      attackerIsPlayer
        ? (playerEffects.firstHitTrueDamageCharges > 0 && !firstHitBombConsumed
            ? playerEffects.firstHitTrueDamageValue
            : 0)
        : (opponentEffects.firstHitTrueDamageCharges > 0 && !opponentFirstHitBombConsumed
            ? opponentEffects.firstHitTrueDamageValue
            : 0);

    // Apply equipment percentage stats
    const attackerPct = attackerIsPlayer ? (player.equipmentPctStats || {}) : (opponent.equipmentPctStats || {});
    const defenderPct = attackerIsPlayer ? (opponent.equipmentPctStats || {}) : (player.equipmentPctStats || {});
    onAttackMods.attackDamagePct += attackerPct.dmgPct || 0;
    onAttackMods.bonusCritChancePct += attackerPct.critChancePct || 0;
    const equipmentCritDmgPct = attackerPct.critDmgPct || 0;
    const equipmentDefendPct = defenderPct.defendPct || 0;

    if (attackerIsPlayer && hasHigherRarityBonus) {
      onAttackMods.attackDamagePct += playerEffects.higherRarityDamageBonusPct;
    }
    if (!attackerIsPlayer && hasOpponentHigherRarityBonus) {
      onAttackMods.attackDamagePct += opponentEffects.higherRarityDamageBonusPct;
    }

    if (attackerIsPlayer && playerEffects.damageBoostFightsRemaining > 0 && playerEffects.damageBoostPct > 0) {
      onAttackMods.attackDamagePct += playerEffects.damageBoostPct;
      effectUsage.usedDamageBoost = true;
    }
    if (!attackerIsPlayer && opponentEffects.damageBoostFightsRemaining > 0 && opponentEffects.damageBoostPct > 0) {
      onAttackMods.attackDamagePct += opponentEffects.damageBoostPct;
      oppEffectUsage.usedDamageBoost = true;
    }

    if (attackerIsPlayer && playerEffects.critChanceBoostFightsRemaining > 0 && playerEffects.critChanceBoostPct > 0) {
      onAttackMods.bonusCritChancePct += playerEffects.critChanceBoostPct;
      effectUsage.usedCritChanceBoost = true;
    }
    if (!attackerIsPlayer && opponentEffects.critChanceBoostFightsRemaining > 0 && opponentEffects.critChanceBoostPct > 0) {
      onAttackMods.bonusCritChancePct += opponentEffects.critChanceBoostPct;
      oppEffectUsage.usedCritChanceBoost = true;
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

    const elementMult = attackerIsPlayer
      ? (ELEMENT_EFFECTIVENESS[playerElement]?.[opponentElement] ?? 1)
      : (ELEMENT_EFFECTIVENESS[opponentElement]?.[playerElement] ?? 1);
    let effectiveElementMult = elementMult;
    if (elementMult > 1.0) {
      effectiveElementMult = 1.3 + toInt(attackerStats?.effectHit, 0) * 0.02 - toInt(defenderStats?.effectHit, 0) * 0.01;
      const reduction = toInt(defenderRuntime?.reduceElementEffectivenessPct, 0);
      if (reduction > 0) {
        effectiveElementMult = Math.max(1.0, effectiveElementMult * (1 - reduction / 100));
      }
    }

    const outcome = calculateAttackOutcome({
      attackerStats,
      defenderStats: effectiveDefenderStats,
      attackerRarity,
      attackerLevel: attackerIsPlayer ? player.level : opponent.level,
      defenderRarity,
      defenderLevel: attackerIsPlayer ? opponent.level : player.level,
      bonusCritChancePct: onAttackMods.bonusCritChancePct,
      attackerDamageFlat: onAttackMods.attackDamageFlat,
      attackerDamagePct: onAttackMods.attackDamagePct,
      attackerTrueDamage: pendingTrueDamage,
      defenderDamageReductionPct: equipmentDefendPct,
      extraDefenderEvasionPct: defenderRuntime.evasionPct,
      baseCritMultiplier: 1.0 + equipmentCritDmgPct / 100,
      elementMult: effectiveElementMult,
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
        elementEffective: attackerIsPlayer ? playerVsOpponentEffectiveness : opponentVsPlayerEffectiveness,
        elementAttacker: attackerElement,
      });
      return;
    }

    // Apply element effectiveness multiplier to damage
    outcome.damage = Math.max(1, Math.floor(outcome.damage * effectiveElementMult));

    let firstAttackDoubled = false;
    if (attackerIsPlayer && playerEffects.firstAttackDoubleCharges > 0 && turnCounter === 1) {
      outcome.damage *= 2;
      firstAttackDoubled = true;
      effectUsage.usedFirstAttackDouble = true;
    }
    if (!attackerIsPlayer && opponentEffects.firstAttackDoubleCharges > 0 && turnCounter === 1) {
      outcome.damage *= 2;
      firstAttackDoubled = true;
      oppEffectUsage.usedFirstAttackDouble = true;
    }

    if (pendingTrueDamage > 0) {
      if (attackerIsPlayer) {
        firstHitBombConsumed = true;
        effectUsage.usedFirstHitTrueDamage = true;
      } else {
        opponentFirstHitBombConsumed = true;
        oppEffectUsage.usedFirstHitTrueDamage = true;
      }
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
      passiveChanceMultiplier: attackerIsPlayer ? opponentPassiveChanceMultiplier : passiveChanceMultiplier,
    });

    if (outcome.critical && defenderRuntime.cancelCriticalCharges > 0) {
      defenderRuntime.cancelCriticalCharges -= 1;
      outcome.critical = false;
      outcome.damage = Math.max(1, Math.floor(outcome.damage / (outcome.baseCritMultiplier || 1.0)));
      pushConsole(`${defenderName} nullified a critical hit`);
    }

    let finalDamage = outcome.damage;
    const takenDivisor = 1 + Number(onDamageTakenMods.damageReductionPct || 0) / 100;
    finalDamage = Math.floor(finalDamage / takenDivisor);
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
      passiveChanceMultiplier: attackerIsPlayer ? passiveChanceMultiplier : opponentPassiveChanceMultiplier,
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
      // Player's vampiric heal (attacker heals)
      if (playerEffects.vampiricHealFightsRemaining > 0 && playerEffects.vampiricHealPct > 0 && finalDamage > 0) {
        const heal = Math.floor(finalDamage * (playerEffects.vampiricHealPct / 100));
        if (heal > 0) {
          playerHp = Math.min(maxPlayerHp, playerHp + heal);
          pushConsole(`${playerName} healed ${heal} HP`);
        }
        effectUsage.usedVampiricHeal = true;
      }
      // Opponent's death save and self-revive (defender saves)
      if (opponentHp <= 0 && opponentEffects.deathSaveCharges > 0 && !oppEffectUsage.usedDeathSave) {
        opponentHp = 1;
        oppEffectUsage.usedDeathSave = true;
        pushConsole(`${opponentName} survived KO with 1 HP (Phoenix Feather)`);
      }
      if (opponentHp > 0 && opponentEffects.selfReviveCharges > 0 && opponentEffects.selfReviveHpThresholdPct > 0 && !oppEffectUsage.usedSelfRevive) {
        const hpPct = (opponentHp / maxOpponentHp) * 100;
        if (hpPct <= opponentEffects.selfReviveHpThresholdPct) {
          opponentHp = maxOpponentHp;
          oppEffectUsage.usedSelfRevive = true;
          pushConsole(`${opponentName} fully restored HP (Chrono Vial)`);
        }
      }
    } else {
      playerHp = Math.max(0, playerHp - finalDamage);
      // Opponent's vampiric heal (attacker heals)
      if (opponentEffects.vampiricHealFightsRemaining > 0 && opponentEffects.vampiricHealPct > 0 && finalDamage > 0) {
        const heal = Math.floor(finalDamage * (opponentEffects.vampiricHealPct / 100));
        if (heal > 0) {
          opponentHp = Math.min(maxOpponentHp, opponentHp + heal);
          pushConsole(`${opponentName} healed ${heal} HP`);
        }
        oppEffectUsage.usedVampiricHeal = true;
      }
      // Player's death save and self-revive (defender saves)
      if (playerHp <= 0 && playerEffects.deathSaveCharges > 0 && !effectUsage.usedDeathSave) {
        playerHp = 1;
        effectUsage.usedDeathSave = true;
        pushConsole(`${playerName} survived KO with 1 HP (Phoenix Feather)`);
      }
      if (playerHp > 0 && playerEffects.selfReviveCharges > 0 && playerEffects.selfReviveHpThresholdPct > 0 && !effectUsage.usedSelfRevive) {
        const hpPct = (playerHp / maxPlayerHp) * 100;
        if (hpPct <= playerEffects.selfReviveHpThresholdPct) {
          playerHp = maxPlayerHp;
          effectUsage.usedSelfRevive = true;
          pushConsole(`${playerName} fully restored HP (Chrono Vial)`);
        }
      }
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
      elementEffective: attackerIsPlayer ? playerVsOpponentEffectiveness : opponentVsPlayerEffectiveness,
      elementAttacker: attackerElement,
    });
  };

  const maxTurns = 60;
  while (playerHp > 0 && opponentHp > 0 && turnCounter < maxTurns) {
    const playerActsFirst =
      playerTotalStats.speed + randomInt(0, 4, randomFn) >=
      opponent.totalStats.speed + randomInt(0, 4, randomFn);

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
  const opponentState = loadFightOpponent(db, opponentSelection);
  const opponentProfile = opponentState.profile;

  const playerSnapshot = loadCombatSnapshot(db, profile);
  const opponentSnapshot = opponentState.snapshot;
  const opponentPreflightEffects = normalizeArenaEffects(opponentProfile.effects || {});
  const simulation = await simulateFight(db, {
    player: playerSnapshot,
    opponent: opponentSnapshot,
    playerEffects: preflightEffects,
    opponentEffects: opponentPreflightEffects,
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
      consumeFightBoostDurations(nextEffects);
      tryGrantBonusDraw(db, userId, nextEffects);
    } else {
      current.losses += 1;
      if (nextEffects.streakShieldCharges > 0) {
        nextEffects.streakShieldCharges -= 1;
      } else {
        current.winStreak = 0;
      }
    }

    const materialDrops = [];

    current.xp += xpDelta;
    current.coins += coinDelta;
    current.lifetimeCoinsEarned += coinDelta;
    const levelsGained = applyLevelUps(current);

    const tutorialMilestone = current.tutorialComplete || 0;
    for (const milestone of [5, 8, 12, 16, 20]) {
      if (current.level >= milestone && tutorialMilestone < milestone) {
        current.coins += 2000;
        current.lifetimeCoinsEarned += 2000;
        current.tutorialComplete = milestone;
      }
    }

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
            effectHit = ?,
            lifetimeCoinsEarned = ?,
           effectsJson = ?,
           lastFightAt = ?,
           updatedAt = ?,
           tutorialComplete = ?
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
      current.effectHit,
      current.lifetimeCoinsEarned,
      serializeEffects(current.effects),
      current.lastFightAt,
      current.updatedAt,
      current.tutorialComplete ? 1 : 0,
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

    const elo = opponentSelection.isNpc
      ? {
          rated: false,
          kFactor: 0,
          playerBefore: current.eloRating,
          playerAfter: current.eloRating,
          playerDelta: 0,
          opponentBefore: null,
          opponentAfter: null,
          opponentDelta: 0,
        }
      : applyEloResult(
          db,
          current.userId,
          opponentSnapshot.profile.userId,
          simulation.playerWon,
        );

    if (!opponentSelection.isNpc && opponentSnapshot.profile?.userId) {
      incrementDailyOpponentCount(db, opponentSnapshot.profile.userId);
    }

    resetDailyOpponentCount(db, current.userId);

    return {
      levelsGained,
      xpDelta,
      coinDelta,
      rarityCoinReward,
      materialDrops,
      elo,
      bypassedCooldownWithGateKey: cooldownResult.bypassedWithGateKey,
    };
  });

  const result = tx();
  const refreshed = getArenaProfilePayload(db, userId);

  return {
    result: simulation.playerWon ? "win" : "loss",
    opponent: opponentState.publicSnapshot,
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
      elo: result.elo,
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
       SET lastCardDrawDate = ?, dailyCardDrawCount = ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(today, nextDrawCount, nowIso(), userId);

    insertCollectionCard(db, userId, drawnCard);
  });

  tx();
  return {
    card: drawnCard,
    profile: getArenaProfilePayload(db, userId),
  };
}

const DEFAULT_PACK_SIZE = 5;

async function drawArenaPack(db, userId, count = DEFAULT_PACK_SIZE) {
  const drawCount = Math.max(1, Math.min(count, DAILY_CARD_DRAW_LIMIT));
  await ensureArenaCardPool(db);
  const today = getCurrentRecordedDate();

  const malCards = [];
  for (let i = 0; i < drawCount; i++) {
    malCards.push(await drawArenaCard(db));
  }

  const drawnCards = malCards.map((mal) => createDrawnCard(mal));

  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    const drawsUsedToday = getDailyCardDrawsUsed(profile, today);
    const remaining = DAILY_CARD_DRAW_LIMIT - drawsUsedToday;

    if (remaining <= 0) {
      throw new ArenaHttpError(
        409,
        `You can only draw ${DAILY_CARD_DRAW_LIMIT} cards per day.`,
        "ARENA_DAILY_DRAW_LIMIT",
        { nextDrawAt: getNextCardDrawAt(profile.lastCardDrawDate) },
      );
    }

    const actualCount = Math.min(drawnCards.length, remaining);
    const pulled = drawnCards.slice(0, actualCount);

    const nextDrawCount = profile.lastCardDrawDate === today
      ? drawsUsedToday + actualCount
      : actualCount;

    db.prepare(
      `UPDATE arena_profiles
       SET lastCardDrawDate = ?, dailyCardDrawCount = ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(today, nextDrawCount, nowIso(), userId);

    for (const card of pulled) {
      insertCollectionCard(db, userId, card);
    }
  });

  tx();
  const cardsWithOwned = drawnCards.map((card) => {
    const ownedCount = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM arena_card_collection
           WHERE userId = ?
             AND json_extract(cardJson, '$.malId') = ?`,
        )
        .get(userId, card.malId).count || 0,
    );
    return { ...card, ownedCount };
  });
  return {
    cards: cardsWithOwned,
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

async function ensureDailyCardShopOffers(
  db,
  offerDate = getCurrentRecordedDate(),
  options = {},
) {
  await ensureArenaCardPool(db);
  const excludedMalIds = new Set(
    Array.isArray(options.excludedMalIds)
      ? options.excludedMalIds.map((id) => toPositiveInt(id, 0)).filter(Boolean)
      : [],
  );
  const drawCard =
    typeof options.drawCard === "function" ? options.drawCard : drawArenaCard;

  for (
    let attempt = 0;
    attempt < CARD_SHOP_GENERATION_ATTEMPTS;
    attempt += 1
  ) {
    const offers = readDailyCardShopOffers(db, offerDate);
    if (offers.length >= CARD_SHOP_DAILY_OFFER_COUNT) {
      return offers.slice(0, CARD_SHOP_DAILY_OFFER_COUNT);
    }

    const usedMalIds = new Set([
      ...offers.map((offer) => offer.malId),
      ...excludedMalIds,
    ]);
    const usedSlots = new Set(offers.map((offer) => offer.slot));
    const slot = Array.from(
      { length: CARD_SHOP_DAILY_OFFER_COUNT },
      (_, index) => index,
    ).find((candidate) => !usedSlots.has(candidate));
    if (slot === undefined) break;

    const malCard = await drawCard(db);
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

function buildArenaCardShopPayload(db, userId, offerDate, forceRandomPack = false) {
  const profile = ensureArenaProfile(db, userId);
  const offers = readDailyCardShopOffers(db, offerDate).slice(
    0,
    CARD_SHOP_DAILY_OFFER_COUNT,
  );
  const soldOfferIds = new Set(
    db
      .prepare(
        `SELECT DISTINCT offerId
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
      const sold = soldOfferIds.has(offer.offerId);
      const price = getCardShopPrice(offer.card.rarity);
      const ownedCount = Number(
        db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM arena_card_collection
             WHERE userId = ?
               AND json_extract(cardJson, '$.malId') = ?`,
          )
          .get(userId, offer.card.malId).count || 0,
      );
      return {
        offerId: offer.offerId,
        card: offer.card,
        price,
        sold,
        canBuy: !sold && profile.coins >= price,
        ownedCount,
      };
    }),
    randomOffer: forceRandomPack || isRandomCardOfferAvailable(offerDate)
      ? {
          offerId: "random-card",
          price: CARD_SHOP_RANDOM_PRICE,
          canBuy: profile.coins >= CARD_SHOP_RANDOM_PRICE,
          endsAt: `${addDaysToRecordedDate(offerDate, 1)}T00:00:00.000Z`,
        }
      : null,
  };
}

async function getArenaCardShopPayload(db, userId, options = {}) {
  const offerDate =
    typeof options.recordedDate === "string" && options.recordedDate
      ? options.recordedDate
      : getCurrentRecordedDate();
  await ensureDailyCardShopOffers(db, offerDate, {
    drawCard: options.drawCard,
  });
  return buildArenaCardShopPayload(db, userId, offerDate, options.forceRandomPack);
}

async function rerollArenaCardShopOffers(db, options = {}) {
  const offerDate =
    typeof options.recordedDate === "string" && options.recordedDate
      ? options.recordedDate
      : getCurrentRecordedDate();
  const previousOffers = readDailyCardShopOffers(db, offerDate);
  const previousMalIds = previousOffers.map((offer) => offer.malId);

  const clearOffers = db.transaction(() => {
    const deletedPurchases = db
      .prepare("DELETE FROM arena_daily_card_purchases WHERE offerDate = ?")
      .run(offerDate).changes;
    const deletedOffers = db
      .prepare("DELETE FROM arena_daily_card_offers WHERE offerDate = ?")
      .run(offerDate).changes;
    return { deletedOffers, deletedPurchases };
  });

  const deleted = clearOffers();
  let offers;
  try {
    offers = await ensureDailyCardShopOffers(db, offerDate, {
      drawCard: options.drawCard,
      excludedMalIds: previousMalIds,
    });
  } catch {
    clearOffers();
    offers = await ensureDailyCardShopOffers(db, offerDate, {
      drawCard: options.drawCard,
    });
  }

  return {
    offerDate,
    nextRefreshAt: `${addDaysToRecordedDate(offerDate, 1)}T00:00:00.000Z`,
    rerolledAt: nowIso(),
    deletedOffers: deleted.deletedOffers,
    deletedPurchases: deleted.deletedPurchases,
    dailyOffers: offers.map((offer) => ({
      offerId: offer.offerId,
      card: offer.card,
      price: getCardShopPrice(offer.card.rarity),
    })),
  };
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

  const offerDate =
    typeof options.recordedDate === "string" && options.recordedDate
      ? options.recordedDate
      : getCurrentRecordedDate();
  const currentProfile = ensureArenaProfile(db, userId);
  let offer = null;
  let purchasedCard = null;
  let purchasedCards = null;
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
    if (!isRandomCardOfferAvailable(offerDate) && !options.forceRandomPack) {
      throw new ArenaHttpError(
        410,
        "Random pack is only available on Saturday, Sunday, Tuesday, and Thursday.",
        "ARENA_RANDOM_CARD_NOT_TODAY",
      );
    }
    if (currentProfile.coins < CARD_SHOP_RANDOM_PRICE) {
      throw new ArenaHttpError(
        400,
        "Not enough coins.",
        "ARENA_NOT_ENOUGH_COINS",
        { requiredCoins: CARD_SHOP_RANDOM_PRICE },
      );
    }
    await ensureArenaCardPool(db);
    const malCards = [];
    for (let i = 0; i < 5; i++) {
      const drawCard =
        typeof options.drawCard === "function" ? options.drawCard : drawArenaCard;
      malCards.push(await drawCard(db));
    }
    purchasedCards = malCards.map((mal) => createDrawnCard(mal));
  }

  if (!purchasedCard && !purchasedCards) {
    throw new ArenaHttpError(
      503,
      "The pack could not be prepared. Please try again shortly.",
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
           WHERE userId = ? AND offerId = ? AND offerDate = ?
           LIMIT 1`,
        )
        .get(userId, offer.offerId, offerDate);
      if (existingPurchase) {
        throw new ArenaHttpError(
          409,
          "This daily card was already bought.",
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
    if (purchasedCard) {
      insertCollectionCard(db, userId, purchasedCard);
    }
    if (purchasedCards) {
      for (const card of purchasedCards) {
        insertCollectionCard(db, userId, card);
      }
    }
  });

  tx();
  const cardShop = await getArenaCardShopPayload(db, userId, {
    recordedDate: offerDate,
  });
  return {
    kind,
    purchasedOfferId: kind === "daily" ? offer.offerId : "random-pack",
    pricePaid: purchasePrice,
    card: purchasedCard || undefined,
    cards: purchasedCards || undefined,
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

function buildShopCatalog(profile, inventoryMap) {
  const equipmentItems = [];
  const tierItems = [];

  SHOP_ITEMS.forEach((item) => {
    const ownedQuantity = inventoryMap.get(item.id)?.quantity || 0;
    const isOwned = ownedQuantity > 0;
    const unlocked = profile.level >= item.unlockLevel;
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
      canCraft = hasCoins && hasInputs;
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

    const enriched = {
      ...item,
      ownedQuantity,
      isOwned,
      isEquipped: false,
      unlocked,
      canBuy: canBuy && !cooldownEndsAt,
      canCraft: canCraft && !cooldownEndsAt,
      cooldownEndsAt,
    };

    if (item.tier === null) {
      equipmentItems.push(enriched);
    } else {
      tierItems.push(enriched);
    }
  });

  const tieredCatalog = SHOP_TIERS.map((tier) => ({
    tier,
    items: tierItems.filter((item) => item.tier === tier),
  }));

  return { equipment: equipmentItems, shop: tieredCatalog };
}

function getArenaShopPayload(db, userId) {
  const profile = ensureArenaProfile(db, userId);
  const inventoryMap = getInventoryMap(db, userId);
  const { equipment, shop } = buildShopCatalog(profile, inventoryMap);
  const { equipped } = computeEquipmentStats(db, userId);
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

    return {
      ...recipe,
      output: {
        ...recipe.output,
        itemName: outputItem?.name || recipe.output.itemId,
      },
      inputs: inputState,
      unlocked,
      canCraft: unlocked && hasCoins && hasInputs,
    };
  });

  return {
    catalogVersion: CATALOG_VERSION,
    profile: getArenaProfilePayload(db, userId),
    equipment,
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

    profile.coins -= item.price;
    profile.updatedAt = nowIso();

    let appliedInstantly = false;
    let rolledPieceId = null;
    let rolledPieceData = null;
    const effects = normalizeArenaEffects(profile.effects);
    if (item.type === "gear") {
      const piece = rollEquipmentPiece(item.slot);
      if (!piece) {
        throw new ArenaHttpError(500, "Failed to roll equipment piece.");
      }
      rolledPieceId = insertEquipmentPiece(db, userId, piece);
      rolledPieceData = { ...piece };
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
           effectHit = ?,
           effectsJson = ?,
           updatedAt = ?
       WHERE userId = ?`,
    ).run(
      profile.coins,
      profile.hp,
      profile.power,
      profile.guard,
      profile.speed,
      profile.effectHit,
      serializeEffects(effects),
      profile.updatedAt,
      userId,
    );

    return {
      item,
      appliedInstantly,
      rolledPieceId,
      rolledPieceData,
    };
  });

  const result = tx();
  return {
    purchasedItemId: result.item.id,
    appliedInstantly: result.appliedInstantly,
    rolledPieceId: result.rolledPieceId || null,
    rolledPiece: result.rolledPieceData || null,
    shop: getArenaShopPayload(db, userId),
  };
}

function applyConsumableEffect(profile, item) {
  const effect = item.consumableEffect || {};
  const effects = normalizeArenaEffects(profile.effects);
  const now = nowIso();

  if (effect.kind === "damage_boost") {
    effects.damageBoostPct = Math.max(effects.damageBoostPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.damageBoostFightsRemaining = Math.min(
      effects.damageBoostFightsRemaining + fights,
      Math.max(effects.damageBoostFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "speed_boost") {
    effects.speedBoostPct = Math.max(effects.speedBoostPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.speedBoostFightsRemaining = Math.min(
      effects.speedBoostFightsRemaining + fights,
      Math.max(effects.speedBoostFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "death_save") {
    const charges = toPositiveInt(effect.charges, 1);
    effects.deathSaveCharges = Math.min(
      effects.deathSaveCharges + charges,
      Math.max(effects.deathSaveCharges, charges * 2),
    );
  } else if (effect.kind === "stat_steroid") {
    effects.statSteroidPct = Math.max(effects.statSteroidPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.statSteroidFightsRemaining = Math.min(
      effects.statSteroidFightsRemaining + fights,
      Math.max(effects.statSteroidFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "match_rarity") {
    const charges = toPositiveInt(effect.charges, 1);
    effects.matchRarityCharges = Math.min(
      effects.matchRarityCharges + charges,
      Math.max(effects.matchRarityCharges, charges * 2),
    );
  } else if (effect.kind === "vampiric_heal") {
    effects.vampiricHealPct = Math.max(effects.vampiricHealPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.vampiricHealFightsRemaining = Math.min(
      effects.vampiricHealFightsRemaining + fights,
      Math.max(effects.vampiricHealFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "crit_chance") {
    effects.critChanceBoostPct = Math.max(effects.critChanceBoostPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.critChanceBoostFightsRemaining = Math.min(
      effects.critChanceBoostFightsRemaining + fights,
      Math.max(effects.critChanceBoostFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "guard_boost") {
    effects.guardBoostPct = Math.max(effects.guardBoostPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.guardBoostFightsRemaining = Math.min(
      effects.guardBoostFightsRemaining + fights,
      Math.max(effects.guardBoostFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "first_attack_double") {
    const charges = toPositiveInt(effect.charges, 1);
    effects.firstAttackDoubleCharges = Math.min(
      effects.firstAttackDoubleCharges + charges,
      Math.max(effects.firstAttackDoubleCharges, charges * 2),
    );
  } else if (effect.kind === "iv_boost") {
    const charges = toPositiveInt(effect.charges, 1);
    effects.ivBoostCharges = Math.min(
      effects.ivBoostCharges + charges,
      Math.max(effects.ivBoostCharges, charges * 2),
    );
  } else if (effect.kind === "exp_boost") {
    effects.expBoostPct = Math.max(effects.expBoostPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.expBoostWinsRemaining = Math.min(
      effects.expBoostWinsRemaining + fights,
      Math.max(effects.expBoostWinsRemaining, fights * 2),
    );
  } else if (effect.kind === "self_revive") {
    effects.selfReviveHpThresholdPct = Math.max(
      effects.selfReviveHpThresholdPct,
      toPositiveInt(effect.hpPct, 0),
    );
    const charges = toPositiveInt(effect.charges, 1);
    effects.selfReviveCharges = Math.min(
      effects.selfReviveCharges + charges,
      Math.max(effects.selfReviveCharges, charges * 2),
    );
  } else if (effect.kind === "shield_fight_start") {
    effects.fightStartShieldAmount = Math.max(
      effects.fightStartShieldAmount,
      toPositiveInt(effect.amount, 0),
    );
    const charges = toPositiveInt(effect.charges, 1);
    effects.fightStartShieldCharges = Math.min(
      effects.fightStartShieldCharges + charges,
      Math.max(effects.fightStartShieldCharges, charges * 2),
    );
  } else if (effect.kind === "evade_next_fight") {
    effects.evadeBoostPct = Math.max(effects.evadeBoostPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.evadeBoostFightsRemaining = Math.min(
      effects.evadeBoostFightsRemaining + fights,
      Math.max(effects.evadeBoostFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "first_hit_true_damage") {
    effects.firstHitTrueDamageValue = Math.max(
      effects.firstHitTrueDamageValue,
      toPositiveInt(effect.value, 0),
    );
    const charges = toPositiveInt(effect.charges, 1);
    effects.firstHitTrueDamageCharges = Math.min(
      effects.firstHitTrueDamageCharges + charges,
      Math.max(effects.firstHitTrueDamageCharges, charges * 2),
    );
  } else if (effect.kind === "bonus_vs_higher_rarity") {
    effects.higherRarityDamageBonusPct = Math.max(
      effects.higherRarityDamageBonusPct,
      toPositiveInt(effect.pct, 0),
    );
    const charges = toPositiveInt(effect.charges, 1);
    effects.higherRarityDamageBonusPctCharges = Math.min(
      effects.higherRarityDamageBonusPctCharges + charges,
      Math.max(effects.higherRarityDamageBonusPctCharges, charges * 2),
    );
  } else if (effect.kind === "double_passive_trigger") {
    const fights = toPositiveInt(effect.fights, 1);
    effects.doublePassiveTriggerFightsRemaining = Math.min(
      effects.doublePassiveTriggerFightsRemaining + fights,
      Math.max(effects.doublePassiveTriggerFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "restore_consumable_charge") {
    const restored =
      effects.firstAttackDoubleCharges > 0
        ? "firstAttackDoubleCharges"
        : effects.selfReviveCharges > 0
          ? "selfReviveCharges"
          : effects.deathSaveCharges > 0
            ? "deathSaveCharges"
            : effects.matchRarityCharges > 0
              ? "matchRarityCharges"
              : effects.fightStartShieldCharges > 0
                ? "fightStartShieldCharges"
                : effects.critChanceBoostFightsRemaining > 0
                  ? "critChanceBoostFightsRemaining"
                  : effects.guardBoostFightsRemaining > 0
                    ? "guardBoostFightsRemaining"
                    : effects.statSteroidFightsRemaining > 0
                      ? "statSteroidFightsRemaining"
                      : effects.damageBoostFightsRemaining > 0
                        ? "damageBoostFightsRemaining"
                        : effects.speedBoostFightsRemaining > 0
                          ? "speedBoostFightsRemaining"
                          : effects.firstHitTrueDamageCharges > 0
                            ? "firstHitTrueDamageCharges"
                            : effects.higherRarityDamageBonusPctCharges > 0
                              ? "higherRarityDamageBonusPctCharges"
                              : effects.vampiricHealFightsRemaining > 0
                                ? "vampiricHealFightsRemaining"
                                : effects.evadeBoostFightsRemaining > 0
                                  ? "evadeBoostFightsRemaining"
                                  : effects.streakShieldCharges > 0
                                    ? "streakShieldCharges"
                                    : effects.doublePassiveTriggerFightsRemaining > 0
                                      ? "doublePassiveTriggerFightsRemaining"
                                      : null;
    if (!restored) {
      throw new ArenaHttpError(
        409,
        "No eligible consumable charge to restore.",
        "ARENA_NO_CHARGE_TO_RESTORE",
      );
    }
    const charges = toPositiveInt(effect.charges, 1);
    effects[restored] = Math.min(
      effects[restored] + charges,
      Math.max(effects[restored], charges * 2),
    );
  } else if (effect.kind === "ascension") {
    enforceAscensionCooldown(profile, item);
    profile.hp += 1;
    profile.power += 1;
    profile.guard += 1;
    profile.speed += 1;
    profile.effectHit += 1;
    effects.ascensionLastPurchasedAt = now;
  } else {
    throw new ArenaHttpError(400, "Unsupported consumable effect.");
  }

  return normalizeArenaEffects(effects);
}

function equipShopItem(db, userId, pieceId) {
  if (!pieceId || typeof pieceId !== "string" || !pieceId.trim()) {
    throw new ArenaHttpError(400, "pieceId is required.", "ARENA_PIECE_REQUIRED");
  }

  equipEquipmentPiece(db, userId, pieceId.trim());

  const piece = db
    .prepare(`SELECT id, slot FROM arena_equipment_pieces WHERE id = ? AND userId = ?`)
    .get(pieceId.trim(), userId);
  if (!piece) {
    throw new ArenaHttpError(404, "Equipment piece not found.", "ARENA_PIECE_NOT_FOUND");
  }

  return {
    equippedPieceId: piece.id,
    slot: piece.slot,
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
       SET hp = ?, power = ?, guard = ?, speed = ?, effectHit = ?, effectsJson = ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(
      profile.hp,
      profile.power,
      profile.guard,
      profile.speed,
      profile.effectHit,
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
    const craftCount = quantity;
    const totalCoinCost = toInt(recipe.coinCost, 0) * craftCount;
    if (profile.coins < totalCoinCost) {
      throw new ArenaHttpError(400, "Not enough coins.", "ARENA_NOT_ENOUGH_COINS");
    }

    upsertInventoryItem(
      db,
      userId,
      outputItem.id,
      toInt(recipe.output.quantity, 1) * craftCount,
    );

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

function countLeaderboardEntries(db, normalizedMetric) {
  if (normalizedMetric === "win_rate") {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total FROM arena_profiles p
         WHERE (p.wins + p.losses) >= 50`,
      )
      .get();
    return Number(row?.total || 0);
  }
  const row = db
    .prepare(`SELECT COUNT(*) AS total FROM arena_profiles`)
    .get();
  return Number(row?.total || 0);
}

function getLeaderboard(db, metric, options = {}) {
  const page = Math.max(toPositiveInt(options.page, 1), 1);
  const perPage = clamp(toPositiveInt(options.perPage, 50), 1, 100);
  const offset = (page - 1) * perPage;
  const normalizedMetric = String(metric || "level").toLowerCase();

  if (!["level", "win_rate", "rich", "elo"].includes(normalizedMetric)) {
    throw new ArenaHttpError(
      400,
      "Invalid leaderboard metric. Use level, win_rate, rich, or elo.",
      "ARENA_INVALID_LEADERBOARD_METRIC",
    );
  }

  const total = countLeaderboardEntries(db, normalizedMetric);
  const totalPages = Math.max(Math.ceil(total / perPage), 1);

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
           p.eloRating,
           p.eloMatches,
           p.peakElo,
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
          LIMIT ? OFFSET ?`,
       )
       .all(perPage, offset);
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
           p.eloRating,
           p.eloMatches,
           p.peakElo,
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
          LIMIT ? OFFSET ?`,
       )
       .all(perPage, offset);
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
           p.eloRating,
           p.eloMatches,
           p.peakElo,
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
          LIMIT ? OFFSET ?`,
       )
       .all(perPage, offset);
   } else if (normalizedMetric === "elo") {
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
           p.eloRating,
           p.eloMatches,
           p.peakElo,
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
          ORDER BY p.eloRating DESC, p.eloMatches DESC, p.peakElo DESC, p.updatedAt ASC
          LIMIT ? OFFSET ?`,
       )
       .all(perPage, offset);
   }

  return {
    metric: normalizedMetric,
    page,
    perPage,
    totalPages,
    total,
    entries: rows.map((row, index) => ({
      rank: offset + index + 1,
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
      eloRating: Math.max(
        toInt(row.eloRating, ELO_DEFAULT_RATING),
        ELO_MIN_RATING,
      ),
      eloMatches: toPositiveInt(row.eloMatches, 0),
      peakElo: Math.max(
        toInt(row.peakElo, ELO_DEFAULT_RATING),
        ELO_MIN_RATING,
      ),
      eloProvisional: isEloProvisional(row.eloMatches),
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

function parsePlaybackSimulation(row) {
  return JSON.parse(row.simulationJson);
}

function reconcilePlaybackFightRow(db, userId, row, simulation) {
  const allTurns = Array.isArray(simulation.rounds) ? simulation.rounds : [];
  const totalTurns = allTurns.length;
  const cursor = toInt(row.cursor, 0);
  let changed = false;

  if (row.state !== "finished" && cursor >= totalTurns) {
    db.prepare(
      `UPDATE arena_active_fights
       SET cursor = ?, state = 'finished', updatedAt = ?
       WHERE userId = ?`,
    ).run(totalTurns, nowIso(), userId);
    row = getActiveFightRow(db, userId);
    changed = true;
  }

  if (row?.state === "finished" && !simulation.rewards) {
    finalizePlaybackFightRewards(db, userId);
    row = getActiveFightRow(db, userId);
    changed = true;
  }

  if (!changed || !row) {
    return { row, simulation };
  }

  try {
    return { row, simulation: parsePlaybackSimulation(row) };
  } catch {
    deleteActiveFight(db, userId);
    return { row: null, simulation: null };
  }
}

function getPlaybackFightState(db, userId) {
  let row = getActiveFightRow(db, userId);
  if (!row) return null;

  let simulation;
  try {
    simulation = parsePlaybackSimulation(row);
  } catch {
    deleteActiveFight(db, userId);
    return null;
  }

  ({ row, simulation } = reconcilePlaybackFightRow(db, userId, row, simulation));
  if (!row || !simulation) return null;

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
    ? simulation.battle.console.filter(e => (e.turn || 0) <= cursor)
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
          elo:
            simulation.rewards?.elo &&
            typeof simulation.rewards.elo === "object"
              ? simulation.rewards.elo
              : null,
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
  const opponentState = loadFightOpponent(db, opponentSelection);
  const opponentProfile = opponentState.profile;

  const playerSnapshot = loadCombatSnapshot(db, profile);
  const opponentSnapshot = opponentState.snapshot;
  const opponentPreflightEffects = normalizeArenaEffects(opponentProfile.effects || {});
  const simulation = await simulateFight(db, {
    player: playerSnapshot,
    opponent: opponentSnapshot,
    playerEffects: preflightEffects,
    opponentEffects: opponentPreflightEffects,
  });
  simulation.materialDrops = [];

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
      JSON.stringify(opponentState.publicSnapshot),
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
      consumeFightBoostDurations(nextEffects);
      tryGrantBonusDraw(db, userId, nextEffects);
    } else {
      current.losses += 1;
      if (nextEffects.streakShieldCharges > 0) {
        nextEffects.streakShieldCharges -= 1;
      } else {
        current.winStreak = 0;
      }
    }

    const materialDrops = [];

    current.xp += xpDelta;
    current.coins += coinDelta;
    current.lifetimeCoinsEarned += coinDelta;
    const levelsGained = applyLevelUps(current);

    const tutorialMilestone = current.tutorialComplete || 0;
    for (const milestone of [5, 8, 12, 16, 20]) {
      if (current.level >= milestone && tutorialMilestone < milestone) {
        current.coins += 2000;
        current.lifetimeCoinsEarned += 2000;
        current.tutorialComplete = milestone;
      }
    }

    current.effects = nextEffects;
    current.updatedAt = nowIso();

    db.prepare(
      `UPDATE arena_profiles
       SET level = ?, xp = ?, coins = ?,
           wins = ?, losses = ?, winStreak = ?,
           hp = ?, power = ?, guard = ?, speed = ?, effectHit = ?,
           lifetimeCoinsEarned = ?, effectsJson = ?, updatedAt = ?,
           tutorialComplete = ?
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
      current.effectHit,
      current.lifetimeCoinsEarned,
      serializeEffects(current.effects),
      current.updatedAt,
      current.tutorialComplete ? 1 : 0,
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

    const opponentUserId = String(opponent.userId || "");
    const elo =
      opponent.isNpc ||
      !opponentUserId ||
      opponentUserId.startsWith("npc:")
      ? {
          rated: false,
          kFactor: 0,
          playerBefore: current.eloRating,
          playerAfter: current.eloRating,
          playerDelta: 0,
          opponentBefore: null,
          opponentAfter: null,
          opponentDelta: 0,
        }
      : applyEloResult(
          db,
          current.userId,
          opponentUserId,
          simulation.playerWon,
        );

    if (opponentUserId && !String(opponentUserId).startsWith("npc:")) {
      incrementDailyOpponentCount(db, opponentUserId);
    }

    resetDailyOpponentCount(db, current.userId);

    const rewards = {
      xp: xpDelta,
      coins: coinDelta,
      rarityCoinReward,
      levelsGained,
      materialDrops,
      elo,
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

function createArenaNotification(db, userId, type, title, body = null, link = null, metadata = null) {
  const now = nowIso();
  const id = makeId("notif");
  db.prepare(
    `INSERT INTO arena_notifications (id, userId, type, title, body, link, metadata, isRead, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, userId, type, title, body || null, link || null, metadata || null, now);
  _notifyUser(userId, S2C.ARENA_NOTIFICATION_NEW, { id, type, title, body, link, metadata, createdAt: now });
  _notifyUnreadCount(userId);
}

function getArenaNotifications(db, userId, options = {}) {
  const page = Math.max(toPositiveInt(options.page, 1), 1);
  const limit = clamp(toPositiveInt(options.limit, 20) || 20, 1, 50);

  const total = toPositiveInt(
    db
      .prepare(`SELECT COUNT(*) AS count FROM arena_notifications WHERE userId = ?`)
      .get(userId)?.count,
    0,
  );
  const rows = db
    .prepare(
      `SELECT * FROM arena_notifications
       WHERE userId = ?
       ORDER BY isRead ASC, createdAt DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, limit, (page - 1) * limit);

  return {
    notifications: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body || null,
      link: row.link || null,
      metadata: row.metadata || null,
      isRead: row.isRead === 1,
      createdAt: row.createdAt,
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

function getArenaNotificationUnreadCount(db, userId) {
  return toPositiveInt(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM arena_notifications
         WHERE userId = ? AND isRead = 0`,
      )
      .get(userId)?.count,
    0,
  );
}

function markArenaNotificationRead(db, userId, notificationId) {
  const result = db
    .prepare(
      `UPDATE arena_notifications SET isRead = 1
       WHERE id = ? AND userId = ?`,
    )
    .run(notificationId, userId);
  if (result.changes > 0) _notifyUnreadCount(userId);
  return { updated: result.changes > 0 };
}

function markAllArenaNotificationsRead(db, userId) {
  const result = db
    .prepare(
      `UPDATE arena_notifications SET isRead = 1
       WHERE userId = ? AND isRead = 0`,
    )
    .run(userId);
  if (result.changes > 0) _notifyUnreadCount(userId);
  return { updated: result.changes };
}

function getMintDuplicates(db, userId) {
  const dupRows = db.prepare(`
    SELECT CAST(json_extract(cardJson, '$.malId') AS INTEGER) AS malId, COUNT(*) AS cnt
    FROM arena_card_collection
    WHERE userId = ?
    GROUP BY malId
    HAVING cnt >= 2
    ORDER BY cnt DESC
  `).all(userId);

  if (!dupRows.length) return [];

  const malIds = dupRows.map(r => r.malId);
  const placeholders = malIds.map(() => "?").join(",");

  const cardRows = db.prepare(`
    SELECT cardJson
    FROM arena_card_collection
    WHERE userId = ? AND CAST(json_extract(cardJson, '$.malId') AS INTEGER) IN (${placeholders})
    ORDER BY CAST(json_extract(cardJson, '$.malId') AS INTEGER) DESC, createdAt DESC
  `).all(userId, ...malIds);

  const groups = new Map();
  for (const row of cardRows) {
    const card = JSON.parse(row.cardJson);
    const list = groups.get(card.malId);
    if (list) {
      list.push(card);
    } else {
      groups.set(card.malId, [card]);
    }
  }

  return Array.from(groups.entries()).map(([malId, cards]) => ({
    malId,
    cards,
    total: cards.length,
  }));
}

function snapshotAndResetElo(db) {
  const now = nowIso();
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const month = d.toISOString().slice(0, 7);

  const existing = db.prepare("SELECT id FROM arena_hall_of_fame WHERE id = ?").get(month);
  if (existing) return { month, snapshot: false };

  const topEntries = db
    .prepare(
      `SELECT p.userId, u.username, u.avatar, p.level, p.eloRating, p.eloMatches, p.peakElo
       FROM arena_profiles p
       JOIN users u ON u.id = p.userId
       WHERE p.eloMatches > 0
       ORDER BY p.eloRating DESC, p.eloMatches DESC, p.peakElo DESC
       LIMIT 3`,
    )
    .all()
    .map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      username: row.username || "Unknown",
      avatar: row.avatar || null,
      level: row.level,
      eloRating: row.eloRating,
      eloMatches: row.eloMatches,
      peakElo: row.peakElo,
    }));

  db.prepare(
    "INSERT INTO arena_hall_of_fame (id, month, entriesJson, createdAt) VALUES (?, ?, ?, ?)",
  ).run(month, month, JSON.stringify(topEntries), now);

  db.prepare(
    "UPDATE arena_profiles SET eloRating = 1000, eloMatches = 0, peakElo = 1000",
  ).run();

  return { month, snapshot: true, entries: topEntries };
}

function getHallOfFame(db, options = {}) {
  const { month, page = 1, perPage = 12 } = options;

  if (month) {
    const row = db
      .prepare("SELECT * FROM arena_hall_of_fame WHERE id = ?")
      .get(month);

    return {
      months: row
        ? [
            {
              month: row.month,
              entries: JSON.parse(row.entriesJson),
              createdAt: row.createdAt,
            },
          ]
        : [],
      page: 1,
      perPage,
      totalPages: row ? 1 : 0,
      total: row ? 1 : 0,
    };
  }

  const total = db.prepare("SELECT COUNT(*) AS count FROM arena_hall_of_fame").get().count;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const offset = (page - 1) * perPage;

  const rows = db
    .prepare(
      "SELECT * FROM arena_hall_of_fame ORDER BY month DESC LIMIT ? OFFSET ?",
    )
    .all(perPage, offset);

  return {
    months: rows.map((row) => ({
      month: row.month,
      entries: JSON.parse(row.entriesJson),
      createdAt: row.createdAt,
    })),
    page,
    perPage,
    totalPages,
    total,
  };
}

module.exports = {
  getEquipmentPiecesRows,
  getEquippedPiecesRows,
  getEquippedPieceBySlot,
  insertEquipmentPiece,
  equipEquipmentPiece,
  rollEquipmentPiece,
  computeEquipmentStats,
  weightedEquipmentBonus,
  passiveMagnitude,
  resolveActivePassives,
  getEquipmentLoadouts,
  saveEquipmentLoadout,
  restoreEquipmentLoadout,
  deleteEquipmentLoadout,
  unequipEquipmentSlot,
  fodderEquipmentPiece,
};
const { ArenaHttpError } = require("./utils");
