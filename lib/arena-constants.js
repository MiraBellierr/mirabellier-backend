const RARITY_ORDER = ["C", "R", "SR", "SSR", "UR"];

const RARITY_CONFIG = {
  C: {
    id: "C",
    weight: 60,
    powerBonus: 0,
    coinReward: 0,
  },
  R: {
    id: "R",
    weight: 25,
    powerBonus: 3,
    coinReward: 3,
  },
  SR: {
    id: "SR",
    weight: 10,
    powerBonus: 7,
    coinReward: 7,
  },
  SSR: {
    id: "SSR",
    weight: 4,
    powerBonus: 12,
    coinReward: 12,
  },
  UR: {
    id: "UR",
    weight: 1,
    powerBonus: 18,
    coinReward: 18,
  },
};

const CATALOG_VERSION = "v3";

const ELEMENTS = ["Fire", "Water", "Earth", "Wind", "Light", "Dark"];

const ELEMENT_COLORS = {
  Fire: "#e74c3c",
  Water: "#3498db",
  Earth: "#27ae60",
  Wind: "#2ecc71",
  Light: "#f1c40f",
  Dark: "#8e44ad",
};

const ELEMENT_EFFECTIVENESS = {
  Fire:  { Fire: 1, Water: 0.7, Earth: 1.3, Wind: 1, Light: 1, Dark: 1 },
  Water: { Fire: 1.3, Water: 1, Earth: 0.7, Wind: 1, Light: 1, Dark: 1 },
  Earth: { Fire: 0.7, Water: 1.3, Earth: 1, Wind: 1, Light: 1, Dark: 1 },
  Wind:  { Fire: 1, Water: 1, Earth: 1, Wind: 1, Light: 1.3, Dark: 0.7 },
  Light: { Fire: 1, Water: 1, Earth: 1, Wind: 0.7, Light: 1, Dark: 1.3 },
  Dark:  { Fire: 1, Water: 1, Earth: 1, Wind: 1.3, Light: 0.7, Dark: 1 },
};
const ECONOMY_BOOST_FIGHT_DURATION = 20;
const DEFENSIVE_BOOST_FIGHT_DURATION = 8;
const RARITY_BOOST_FIGHT_DURATION = 3;

const ROLLABLE_EQUIPMENT = [
  {
    id: "weapon_roll",
    name: "Blade",
    slot: "weapon",
    price: 1000,
    acquisition: "buy",
    type: "gear",
    mainStat: { type: "power", min: 1, max: 10 },
  },
  {
    id: "armour_roll",
    name: "Armour",
    slot: "armor",
    price: 1000,
    acquisition: "buy",
    type: "gear",
    mainStat: { type: "guard", min: 1, max: 10 },
  },
  {
    id: "charm_roll",
    name: "Charm",
    slot: "charm",
    price: 1000,
    acquisition: "buy",
    type: "gear",
    mainStat: {
      type: "random",
      options: [
        { type: "critRate", min: 5, max: 25 },
        { type: "critDmg", min: 10, max: 60 },
      ],
    },
  },
];

const SUB_STAT_POOL = {
  pool: [
    "hp", "power", "guard", "speed", "effectHit", "hpPct", "dmgPct", "defendPct", "critRate", "critDmg",
  ],
  ranges: {
    hp: [30, 50],
    power: [1, 10],
    guard: [1, 10],
    speed: [1, 10],
    effectHit: [1, 10],
    hpPct: [3, 10],
    dmgPct: [10, 20],
    defendPct: [10, 25],
    critRate: [8, 20],
    critDmg: [15, 50],
  },
  count: 4,
};

const TIER_CONFIG = [
  {
    tier: "Rookie",
    unlockLevel: 1,
    consumables: [
      {
        id: "red_tonic",
        name: "Red Tonic",
        sprite: { sheet: "game.png", row: 8, col: 0, size: 32 },
        consumableEffect: {
          kind: "shield_fight_start",
          amount: 60,
          charges: 100,
        },
      },
      {
        id: "green_draft",
        name: "Berserker's Brew",
        sprite: { sheet: "game.png", row: 8, col: 2, size: 32 },
        consumableEffect: {
          kind: "damage_boost",
          pct: 20,
          fights: 500,
        },
      },
      {
        id: "amber_draft",
        name: "Scout's Whistle",
        sprite: { sheet: "game.png", row: 8, col: 3, size: 32 },
        consumableEffect: {
          kind: "speed_boost",
          pct: 12,
          fights: 500,
        },
      },
    ],
  },
  {
    tier: "Bronze",
    unlockLevel: 8,
    consumables: [
      {
        id: "frost_elixir",
        name: "Frost Elixir",
        sprite: { sheet: "game.png", row: 8, col: 5, size: 32 },
        consumableEffect: {
          kind: "evade_next_fight",
        pct: 10,
        fights: 250,
        },
      },
      {
        id: "viridian_elixir",
        name: "Viridian Elixir",
        sprite: { sheet: "game.png", row: 8, col: 6, size: 32 },
        consumableEffect: {
          kind: "iv_boost",
          total: 5,
          charges: 250,
        },
      },
      {
        id: "fuse_bomb",
        name: "Fuse Bomb",
        sprite: { sheet: "game.png", row: 9, col: 11, size: 32 },
        consumableEffect: { kind: "first_hit_true_damage", value: 100, charges: 250 },
      },
      {
        id: "exp_tome",
        name: "Sage's Tome",
        sprite: { sheet: "game.png", row: 8, col: 5, size: 32 },
        consumableEffect: {
          kind: "exp_boost",
          pct: 100,
          fights: 250,
        },
      },
    ],
  },
  {
    tier: "Silver",
    unlockLevel: 16,
    consumables: [
      {
        id: "sun_elixir",
        name: "Phoenix Feather",
        sprite: { sheet: "game.png", row: 8, col: 7, size: 32 },
        consumableEffect: {
          kind: "death_save",
          charges: 500,
        },
      },
      {
        id: "star_tonic",
        name: "Titan Draught",
        sprite: { sheet: "game.png", row: 8, col: 8, size: 32 },
        consumableEffect: {
          kind: "stat_steroid",
          pct: 15,
          fights: 500,
        },
      },
      {
        id: "lantern_oil",
        name: "Lantern Oil",
        sprite: { sheet: "game.png", row: 9, col: 8, size: 32 },
        consumableEffect: { kind: "bonus_vs_higher_rarity", pct: 50, charges: 500 },
      },
    ],
  },
  {
    tier: "Gold",
    unlockLevel: 28,
    consumables: [
      {
        id: "seeker_lens",
        name: "Seeker Lens",
        sprite: { sheet: "game.png", row: 9, col: 7, size: 32 },
        consumableEffect: { kind: "crit_chance", pct: 20, fights: 500 },
      },
      {
        id: "oath_ribbon",
        name: "Oath Ribbon",
        sprite: { sheet: "game.png", row: 10, col: 10, size: 32 },
        consumableEffect: { kind: "guard_boost", pct: 15, fights: 500 },
      },
      {
        id: "treasure_cache",
        name: "Arcane Mirror",
        sprite: { sheet: "game.png", row: 10, col: 11, size: 32 },
        consumableEffect: { kind: "match_rarity", charges: 750 },
      },
    ],
  },
  {
    tier: "Mythic",
    unlockLevel: 42,
    consumables: [
      {
        id: "prism_draught",
        name: "Prism Draught",
        sprite: { sheet: "game.png", row: 8, col: 14, size: 32 },
        consumableEffect: {
          kind: "first_attack_double",
          charges: 1000,
        },
      },
      {
        id: "sacred_candles",
        name: "Sacred Candles",
        sprite: { sheet: "game.png", row: 9, col: 10, size: 32 },
        consumableEffect: { kind: "shield_fight_start", amount: 80, charges: 1000 },
      },
      {
        id: "gate_key",
        name: "Vampiric Fang",
        sprite: { sheet: "game.png", row: 10, col: 9, size: 32 },
        consumableEffect: { kind: "vampiric_heal", pct: 20, fights: 1000 },
      },
    ],
  },
  {
    tier: "Cosmic",
    unlockLevel: 58,
    consumables: [
      {
        id: "solar_cauldron",
        name: "Solar Cauldron",
        sprite: { sheet: "game.png", row: 17, col: 8, size: 32 },
        consumableEffect: { kind: "ascension", cooldownDays: 7 },
      },
      {
        id: "void_cauldron",
        name: "Void Cauldron",
        sprite: { sheet: "game.png", row: 17, col: 9, size: 32 },
        consumableEffect: { kind: "double_passive_trigger", fights: 1000 },
      },
      {
        id: "chrono_vial",
        name: "Chrono Vial",
        sprite: { sheet: "game.png", row: 17, col: 4, size: 32 },
        consumableEffect: { kind: "self_revive", hpPct: 50, charges: 1000 },
      },
    ],
  },
];

const CARD_ITEM_CONFIG = [
  {
    id: "apex_sigil",
    name: "Apex Sigil",
    unlockLevel: 1,
    price: 120000,
    type: "card",
    acquisition: "buy",
    consumableEffect: {
      kind: "max_iv_card_stat_bonus",
      stats: { power: 3, guard: 1, speed: 1, effectHit: 1 },
    },
    sprite: { sheet: "game.png", row: 10, col: 8, size: 32 },
  },
];

const SHOP_TIERS = TIER_CONFIG.map((entry) => entry.tier);
const TIER_UNLOCK_LEVELS = Object.fromEntries(
  TIER_CONFIG.map((entry) => [entry.tier, entry.unlockLevel]),
);

function normalizeConsumableItem(tierConfig, item) {
  return {
    id: item.id,
    name: item.name,
    tier: tierConfig.tier,
    unlockLevel: 1,
    price: 0,
    type: "consumable",
    acquisition: "craft",
    consumableEffect: item.consumableEffect || null,
    sprite: item.sprite,
  };
}

function buildRecipes() {
  const recipes = [];

  // Flat coin costs per tier for crafting consumables
  const CRAFT_COIN_COSTS = [200, 800, 3200, 10000, 36000, 120000];

  TIER_CONFIG.forEach((tierConfig, tierIndex) => {
    const tierSlug = tierConfig.tier.toLowerCase();

    tierConfig.consumables.forEach((consumableItem, index) => {
      recipes.push({
        id: `${tierSlug}_cons_${index + 1}`,
        tier: tierConfig.tier,
        unlockLevel: 1,
        output: { itemId: consumableItem.id, quantity: 1 },
        coinCost: CRAFT_COIN_COSTS[tierIndex],
        inputs: [],
      });
    });
  });

  return recipes;
}

const SHOP_RECIPES = buildRecipes();
const RECIPE_BY_OUTPUT_ITEM = new Map(
  SHOP_RECIPES.map((recipe) => [recipe.output.itemId, recipe.id]),
);

const SHOP_ITEMS = [
  ...ROLLABLE_EQUIPMENT.map((item) => ({
    id: item.id,
    name: item.name,
    tier: null,
    unlockLevel: 1,
    price: item.price,
    type: item.type,
    slot: item.slot,
    acquisition: item.acquisition,
    mainStat: item.mainStat,
    sprite: null,
    recipeId: null,
  })),
  ...TIER_CONFIG.flatMap((tierConfig) => [
    ...tierConfig.consumables.map((item) => normalizeConsumableItem(tierConfig, item)),
  ]),
  ...CARD_ITEM_CONFIG.map((item) => ({
    id: item.id,
    name: item.name,
    tier: null,
    unlockLevel: item.unlockLevel,
    price: item.price,
    type: item.type,
    acquisition: item.acquisition,
    consumableEffect: item.consumableEffect,
    sprite: item.sprite,
    recipeId: null,
  })),
].map((item) => ({
  ...item,
  recipeId: item.recipeId || RECIPE_BY_OUTPUT_ITEM.get(item.id) || null,
}));

const BASE_PROFILE = {
  level: 1,
  xp: 0,
  coins: 0,
  wins: 0,
  losses: 0,
  winStreak: 0,
  hp: 120,
  power: 12,
  guard: 12,
  speed: 10,
  effectHit: 3,
  lifetimeCoinsEarned: 0,
  eloRating: 1000,
  eloMatches: 0,
  peakElo: 1000,
};

const LEVEL_UP_GAINS = {
  hp: 8,
  power: 2,
  guard: 2,
  speed: 1,
  effectHit: 1,
};

const MAX_LEVEL = 70;

const MAX_DAILY_OPPONENT_COUNT = 30;

const FIGHT_COOLDOWN_MS = 5000;
const DEFAULT_MAL_POOL_REFRESH_MINUTES = 120;
const DAILY_CARD_DRAW_LIMIT = 10;

const ARENA_EFFECT_DEFAULTS = {
  expBoostPct: 0,
  expBoostWinsRemaining: 0,
  coinBoostPct: 0,
  coinBoostWinsRemaining: 0,
  rerollKeepHigherCharges: 0,
  streakShieldCharges: 0,
  upgradeLowestRarityCharges: 0,
  guaranteeSsrPlusCharges: 0,
  ascensionLastPurchasedAt: null,
  ascensionCount: 0,
  fightStartShieldCharges: 0,
  fightStartShieldAmount: 0,
  evadeBoostPct: 0,
  evadeBoostFightsRemaining: 0,
  firstHitTrueDamageCharges: 0,
  firstHitTrueDamageValue: 0,
  higherRarityDamageBonusPctCharges: 0,
  higherRarityDamageBonusPct: 0,
  gateKeyCharges: 0,
  doublePassiveTriggerFightsRemaining: 0,
  activeConsumables: [],
};

module.exports = {
  ARENA_EFFECT_DEFAULTS,
  BASE_PROFILE,
  CATALOG_VERSION,
  DAILY_CARD_DRAW_LIMIT,
  DEFAULT_MAL_POOL_REFRESH_MINUTES,
  ELEMENT_COLORS,
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
  TIER_UNLOCK_LEVELS,
};
