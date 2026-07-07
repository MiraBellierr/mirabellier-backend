/**
 * Arena subsystem constants extracted from utils.js.
 * This file contains only pure data — no functions, no side effects.
 * @module lib/arena/_constants
 */

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
const MAX_ACTIVE_CONSUMABLE_EFFECTS = 4;
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

module.exports = {
  CARD_IV_MIN,
  CARD_IV_MAX,
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
  MARKET_MIN_PRICE,
  MARKET_MAX_PRICE,
  MARKET_MAX_ACTIVE_LISTINGS,
  MARKET_MAX_PAGE_SIZE,
  MARKET_SALES_SAMPLE_SIZE,
  MARKET_IV_BANDS,
  CARD_SHOP_DAILY_OFFER_COUNT,
  CARD_SHOP_PRICES,
  CARD_SHOP_MAX_PRICE,
  CARD_SHOP_RANDOM_PRICE,
  CARD_SHOP_GENERATION_ATTEMPTS,
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
};
