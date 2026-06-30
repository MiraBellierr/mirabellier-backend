const {
  RARITY_ORDER,
  SHOP_TIERS,
} = require("../arena-constants");

// Card IV range
const CARD_IV_MIN = 0;
const CARD_IV_MAX = 31;

// ELO constants
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

// ---------------------------------------------------------------------------
// Market constants
// ---------------------------------------------------------------------------
const MARKET_MIN_PRICE = 1;
const MARKET_MAX_PRICE = 1_000_000;
const MARKET_MAX_ACTIVE_LISTINGS = 20;
const MARKET_MAX_PAGE_SIZE = 50;
const MARKET_SALES_SAMPLE_SIZE = 30;
const MARKET_IV_BANDS = Object.freeze([
  { id: "0-31", min: 0, max: 31 },
  { id: "32-62", min: 32, max: 62 },
  { id: "63-93", min: 63, max: 93 },
  { id: "94-124", min: 94, max: 124 },
]);

// ---------------------------------------------------------------------------
// Card shop constants
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Trade constants
// ---------------------------------------------------------------------------
const MAX_TRADE_LISTINGS = 20;
const TRADE_SESSION_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Update constants
// ---------------------------------------------------------------------------
const ARENA_UPDATE_MAX_TITLE_LENGTH = 100;
const ARENA_UPDATE_MAX_BODY_LENGTH = 1000;

// ---------------------------------------------------------------------------
// Misc constants
// ---------------------------------------------------------------------------
const RECENT_OPPONENT_LIMIT = 5;
const DAILY_OPPONENT_LIMIT_MULTIPLIER = 2;
const DAILY_OPPONENT_LIMIT_MIN = 10;
const DAILY_OPPONENT_LIMIT_MAX = 200;
const ELO_MATCHMAKING_POOL_SIZE = 5;
const ELO_MATCHMAKING_CANDIDATE_LIMIT = 20;
const MAX_ACTIVE_CONSUMABLE_EFFECTS = 6;
const MAX_COMBINED_DAMAGE_MULTIPLIER = 5;
const MAX_CONSUMABLE_INVENTORY_QUANTITY = 99;
const EFFECT_DURATION_LIMITS = Object.freeze({
  coinBoostWinsRemaining: 40,
  drawBonusChanceWinsRemaining: 60,
  rerollKeepHigherCharges: 4,
  streakShieldCharges: 6,
  upgradeLowestRarityCharges: 6,
  guaranteeSsrPlusCharges: 6,
  gateKeyCharges: 4,
});

// Derived lookups
const RARITY_TO_RANK = new Map(RARITY_ORDER.map((rarity, index) => [rarity, index]));
const SLOT_ORDER = ["weapon", "armor", "charm"];

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------
class ArenaHttpError extends Error {
  constructor(status, message, code = "ARENA_ERROR", details = {}) {
    super(message);
    this.name = "ArenaHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
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

function rollInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getValueAtPath(source, path) {
  if (!source || typeof source !== "object") return undefined;
  if (typeof path !== "string" || !path) return undefined;
  return path.split(".").reduce((cursor, part) => {
    if (!cursor || typeof cursor !== "object") return undefined;
    return cursor[part];
  }, source);
}

function toCombatName(input, fallback) {
  if (typeof input === "string" && input.trim()) return input.trim();
  return fallback;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Progression helpers
// ---------------------------------------------------------------------------
function xpToNext(level) {
  const currentLevel = Math.max(toInt(level, 1), 1);
  return 80 + 25 * currentLevel * currentLevel;
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

// ---------------------------------------------------------------------------
// Card shop price helpers
// ---------------------------------------------------------------------------
function getCardShopPrice(rarity) {
  const normalizedRarity = String(rarity || "").trim().toUpperCase();
  return CARD_SHOP_PRICES[normalizedRarity] ?? CARD_SHOP_MAX_PRICE;
}

function isRandomCardOfferAvailable(recordedDate = getCurrentRecordedDate()) {
  const day = new Date(recordedDate + "T00:00:00Z").getUTCDay();
  return day === 0 || day === 2 || day === 4 || day === 6;
}

// ---------------------------------------------------------------------------
// Market helpers
// ---------------------------------------------------------------------------
function getMarketIvBand(ivTotal) {
  const total = clamp(toPositiveInt(ivTotal, 0), 0, CARD_IV_MAX * 4);
  return (
    MARKET_IV_BANDS.find((band) => total >= band.min && total <= band.max) ||
    MARKET_IV_BANDS[0]
  );
}

// ---------------------------------------------------------------------------
// Elo helpers
// ---------------------------------------------------------------------------
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

  const winnerK = getEloKFactor(winner?.eloMatches);
  const loserK = getEloKFactor(loser?.eloMatches);

  const ratingDiff = loserRating - winnerRating;
  const winnerExpected = 1 / (1 + Math.pow(10, ratingDiff / ELO_SCALE));

  const avgK = Math.round((winnerK + loserK) / 2);
  const rawDelta = Math.round(avgK * (1 - winnerExpected));

  const maxDelta =
    isEloProvisional(winner?.eloMatches) || isEloProvisional(loser?.eloMatches)
      ? ELO_MAX_DELTA_PROVISIONAL
      : ELO_MAX_DELTA_ESTABLISHED;
  const delta = Math.min(rawDelta, maxDelta, loserRating - ELO_MIN_RATING);

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

module.exports = {
  // Error class
  ArenaHttpError,

  // Constants
  CARD_IV_MIN,
  CARD_IV_MAX,
  CARD_SHOP_DAILY_OFFER_COUNT,
  CARD_SHOP_PRICES,
  CARD_SHOP_MAX_PRICE,
  CARD_SHOP_RANDOM_PRICE,
  CARD_SHOP_GENERATION_ATTEMPTS,
  MARKET_MIN_PRICE,
  MARKET_MAX_PRICE,
  MARKET_MAX_ACTIVE_LISTINGS,
  MARKET_MAX_PAGE_SIZE,
  MARKET_SALES_SAMPLE_SIZE,
  MARKET_IV_BANDS,
  MAX_TRADE_LISTINGS,
  TRADE_SESSION_TIMEOUT_MS,
  ARENA_UPDATE_MAX_TITLE_LENGTH,
  ARENA_UPDATE_MAX_BODY_LENGTH,
  RECENT_OPPONENT_LIMIT,
  DAILY_OPPONENT_LIMIT_MULTIPLIER,
  DAILY_OPPONENT_LIMIT_MIN,
  DAILY_OPPONENT_LIMIT_MAX,
  ELO_MATCHMAKING_POOL_SIZE,
  ELO_MATCHMAKING_CANDIDATE_LIMIT,
  MAX_ACTIVE_CONSUMABLE_EFFECTS,
  MAX_COMBINED_DAMAGE_MULTIPLIER,
  MAX_CONSUMABLE_INVENTORY_QUANTITY,
  EFFECT_DURATION_LIMITS,
  RARITY_TO_RANK,
  SLOT_ORDER,
  ELO_DEFAULT_RATING,
  ELO_MIN_RATING,
  ELO_PROVISIONAL_MATCHES,
  ELO_PROVISIONAL_K,
  ELO_ESTABLISHED_K,
  ELO_VETERAN_K,
  ELO_VETERAN_MATCHES,
  ELO_SCALE,
  ELO_MAX_DELTA_PROVISIONAL,
  ELO_MAX_DELTA_ESTABLISHED,

  // Pure helpers
  nowIso,
  makeId,
  clamp,
  toInt,
  toPositiveInt,
  randomInt,
  rollInRange,
  getValueAtPath,
  toCombatName,

  // Date helpers
  getCurrentRecordedDate,
  addDaysToRecordedDate,
  getNextCardDrawAt,

  // Progression helpers
  xpToNext,
  rarityRank,
  rarityAtRank,
  upgradeRarityOneStep,

  // Card shop helpers
  getCardShopPrice,
  isRandomCardOfferAvailable,

  // Market helpers
  getMarketIvBand,

  // Elo helpers
  isEloProvisional,
  getEloKFactor,
  calculateEloExchange,
};
