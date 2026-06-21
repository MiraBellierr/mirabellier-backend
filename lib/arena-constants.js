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

const CATALOG_VERSION = "v2";
const ECONOMY_BOOST_FIGHT_DURATION = 20;
const DEFENSIVE_BOOST_FIGHT_DURATION = 8;
const RARITY_BOOST_FIGHT_DURATION = 3;

const TIER_CONFIG = [
  {
    tier: "Rookie",
    unlockLevel: 1,
    materialPrices: [90, 120, 150],
    gear: [
      {
        id: "rustblade_weapon",
        name: "Rustblade",
        slot: "weapon",
        stats: { power: 6 },
        sprite: { sheet: "game.png", row: 4, col: 1, size: 32 },
        passive: {
          key: "opening_slash",
          trigger: "onAttack",
          priority: 10,
          when: [{ left: "attack.turn", op: "==", right: 1 }],
          actions: [{ type: "addFlatDamage", value: 4 }],
        },
      },
      {
        id: "twigbow_weapon",
        name: "Twig Bow",
        slot: "weapon",
        stats: { power: 4, speed: 3 },
        sprite: { sheet: "game.png", row: 5, col: 4, size: 32 },
        passive: {
          key: "first_actor_boost",
          trigger: "onAttack",
          priority: 9,
          when: [{ left: "attack.isFirstActor", op: "==", right: true }],
          actions: [{ type: "scaleDamagePct", value: 8 }],
        },
      },
      {
        id: "patchwork_helm",
        name: "Patchwork Helm",
        slot: "armor",
        stats: { guard: 6, hp: 10 },
        sprite: { sheet: "game.png", row: 6, col: 3, size: 32 },
        passive: {
          key: "patchwork_deflect",
          trigger: "onDamageTaken",
          priority: 6,
          actions: [{ type: "reduceIncomingDamageFlat", value: 2, chancePct: 10 }],
        },
      },
      {
        id: "copper_ring",
        name: "Copper Ring",
        slot: "charm",
        stats: { luck: 4 },
        sprite: { sheet: "game.png", row: 7, col: 4, size: 32 },
        passive: {
          key: "coin_blessing_small",
          trigger: "onWin",
          priority: 4,
          actions: [{ type: "rewardBonusPct", target: "coins", value: 5 }],
        },
      },
    ],
    consumables: [
      {
        id: "red_tonic",
        name: "Red Tonic",
        sprite: { sheet: "game.png", row: 8, col: 0, size: 32 },
        consumableEffect: {
          kind: "shield_fight_start",
          amount: 40,
          charges: DEFENSIVE_BOOST_FIGHT_DURATION,
        },
      },
      {
        id: "green_draft",
        name: "Green Draft",
        sprite: { sheet: "game.png", row: 8, col: 2, size: 32 },
        consumableEffect: {
          kind: "exp_boost",
          pct: 50,
          fights: ECONOMY_BOOST_FIGHT_DURATION,
        },
      },
      {
        id: "amber_draft",
        name: "Amber Draft",
        sprite: { sheet: "game.png", row: 8, col: 3, size: 32 },
        consumableEffect: {
          kind: "coin_boost",
          pct: 150,
          fights: ECONOMY_BOOST_FIGHT_DURATION,
        },
      },
    ],
    materials: [
      {
        id: "driftwood_shard",
        name: "Driftwood Shard",
        sprite: { sheet: "game.png", row: 16, col: 0, size: 32 },
      },
      {
        id: "satchel_cloth",
        name: "Satchel Cloth",
        sprite: { sheet: "game.png", row: 6, col: 12, size: 32 },
      },
      {
        id: "timber_plank",
        name: "Timber Plank",
        sprite: { sheet: "game.png", row: 18, col: 11, size: 32 },
      },
    ],
  },
  {
    tier: "Bronze",
    unlockLevel: 8,
    materialPrices: [360, 420, 480],
    gear: [
      {
        id: "riversteel_saber",
        name: "Riversteel Saber",
        slot: "weapon",
        stats: { power: 12, speed: 4 },
        sprite: { sheet: "game.png", row: 4, col: 2, size: 32 },
        passive: {
          key: "riversteel_edge",
          trigger: "onAttack",
          priority: 10,
          actions: [{ type: "bonusCritChancePct", value: 10 }],
        },
      },
      {
        id: "guard_cap",
        name: "Guard Cap",
        slot: "armor",
        stats: { guard: 12 },
        sprite: { sheet: "game.png", row: 6, col: 1, size: 32 },
        passive: {
          key: "guard_cap_focus",
          trigger: "onDamageTaken",
          priority: 6,
          actions: [{ type: "grantTempGuard", value: 4, turns: 1, chancePct: 20 }],
        },
      },
      {
        id: "iron_cuirass",
        name: "Iron Cuirass",
        slot: "armor",
        stats: { guard: 10, hp: 18 },
        sprite: { sheet: "game.png", row: 6, col: 6, size: 32 },
        passive: {
          key: "thorn_reflect_small",
          trigger: "onDamageTaken",
          priority: 7,
          actions: [{ type: "reflectFlatDamage", value: 2 }],
        },
      },
      {
        id: "azure_ring",
        name: "Azure Ring",
        slot: "charm",
        stats: { luck: 8, speed: 5 },
        sprite: { sheet: "game.png", row: 7, col: 5, size: 32 },
        passive: {
          key: "evasion_primer",
          trigger: "onFightStart",
          priority: 8,
          actions: [{ type: "addEvasionPct", value: 4 }],
        },
      },
    ],
    consumables: [
      {
        id: "frost_elixir",
        name: "Frost Elixir",
        sprite: { sheet: "game.png", row: 8, col: 5, size: 32 },
        consumableEffect: {
          kind: "evade_next_fight",
          pct: 25,
          fights: DEFENSIVE_BOOST_FIGHT_DURATION,
        },
      },
      {
        id: "viridian_elixir",
        name: "Viridian Elixir",
        sprite: { sheet: "game.png", row: 8, col: 6, size: 32 },
        consumableEffect: {
          kind: "upgrade_lowest_rarity",
          charges: RARITY_BOOST_FIGHT_DURATION,
        },
      },
      {
        id: "fuse_bomb",
        name: "Fuse Bomb",
        sprite: { sheet: "game.png", row: 9, col: 11, size: 32 },
        consumableEffect: { kind: "first_hit_true_damage", value: 40, charges: 2 },
      },
    ],
    materials: [
      {
        id: "azure_ore",
        name: "Azure Ore",
        sprite: { sheet: "game.png", row: 15, col: 1, size: 32 },
      },
      {
        id: "gold_ingot",
        name: "Gold Ingot",
        sprite: { sheet: "game.png", row: 15, col: 2, size: 32 },
      },
      {
        id: "brown_dust",
        name: "Brown Dust",
        sprite: { sheet: "game.png", row: 18, col: 1, size: 32 },
      },
    ],
  },
  {
    tier: "Silver",
    unlockLevel: 16,
    materialPrices: [1100, 1300, 1500],
    gear: [
      {
        id: "dawnfang_blade",
        name: "Dawnfang Blade",
        slot: "weapon",
        stats: { power: 22, speed: 6 },
        sprite: { sheet: "game.png", row: 4, col: 6, size: 32 },
        passive: {
          key: "dawnfang_pressure",
          trigger: "onAttack",
          priority: 11,
          when: [{ left: "defender.hpPct", op: ">", right: 70 }],
          actions: [{ type: "scaleDamagePct", value: 12 }],
        },
      },
      {
        id: "knight_helm",
        name: "Knight Helm",
        slot: "armor",
        stats: { guard: 24, hp: 20 },
        sprite: { sheet: "game.png", row: 6, col: 5, size: 32 },
        passive: {
          key: "knight_wall",
          trigger: "onDamageTaken",
          priority: 8,
          actions: [{ type: "reduceIncomingDamagePct", value: 8 }],
        },
      },
      {
        id: "laurel_pendant",
        name: "Laurel Pendant",
        slot: "charm",
        stats: { luck: 12 },
        sprite: { sheet: "game.png", row: 7, col: 6, size: 32 },
        passive: {
          key: "rarity_coin_blessing",
          trigger: "onWin",
          priority: 5,
          actions: [{ type: "rarityCoinBonusPct", value: 10 }],
        },
      },
      {
        id: "verdant_core",
        name: "Verdant Core",
        slot: "charm",
        stats: { hp: 24, luck: 10 },
        sprite: { sheet: "game.png", row: 16, col: 2, size: 32 },
        passive: {
          key: "verdant_regen",
          trigger: "onDamageTaken",
          priority: 7,
          actions: [{ type: "healFlat", value: 4, maxTriggersPerFight: 3 }],
        },
      },
    ],
    consumables: [
      {
        id: "sun_elixir",
        name: "Sun Elixir",
        sprite: { sheet: "game.png", row: 8, col: 7, size: 32 },
        consumableEffect: {
          kind: "coin_boost",
          pct: 250,
          fights: 30,
        },
      },
      {
        id: "star_tonic",
        name: "Star Tonic",
        sprite: { sheet: "game.png", row: 8, col: 8, size: 32 },
        consumableEffect: {
          kind: "exp_boost",
          pct: 100,
          fights: ECONOMY_BOOST_FIGHT_DURATION,
        },
      },
      {
        id: "lantern_oil",
        name: "Lantern Oil",
        sprite: { sheet: "game.png", row: 9, col: 8, size: 32 },
        consumableEffect: { kind: "bonus_vs_higher_rarity", pct: 25, charges: 2 },
      },
    ],
    materials: [
      {
        id: "azure_powder",
        name: "Azure Powder",
        sprite: { sheet: "game.png", row: 18, col: 6, size: 32 },
      },
      {
        id: "verdant_powder",
        name: "Verdant Powder",
        sprite: { sheet: "game.png", row: 18, col: 7, size: 32 },
      },
      {
        id: "clear_crystal",
        name: "Clear Crystal",
        sprite: { sheet: "game.png", row: 15, col: 3, size: 32 },
      },
    ],
  },
  {
    tier: "Gold",
    unlockLevel: 28,
    materialPrices: [4600, 5200, 5800],
    gear: [
      {
        id: "twinlight_blades",
        name: "Twinlight Blades",
        slot: "weapon",
        stats: { power: 34, speed: 12 },
        sprite: { sheet: "game.png", row: 4, col: 9, size: 32 },
        passive: {
          key: "double_strike",
          trigger: "onDamageDealt",
          priority: 12,
          actions: [{ type: "extraStrikePct", chancePct: 12, value: 40 }],
        },
      },
      {
        id: "waraxe_howl",
        name: "Waraxe Howl",
        slot: "weapon",
        stats: { power: 38, speed: 8 },
        sprite: { sheet: "game.png", row: 4, col: 10, size: 32 },
        passive: {
          key: "crit_burst",
          trigger: "onDamageDealt",
          priority: 10,
          when: [{ left: "attack.critical", op: "==", right: true }],
          actions: [{ type: "scaleDamagePct", value: 35 }],
        },
      },
      {
        id: "sky_hood",
        name: "Sky Hood",
        slot: "armor",
        stats: { guard: 34, hp: 30, luck: 6 },
        sprite: { sheet: "game.png", row: 6, col: 8, size: 32 },
        passive: {
          key: "sky_last_stand",
          trigger: "onDamageTaken",
          priority: 11,
          when: [{ left: "self.hpPct", op: "<", right: 40 }],
          actions: [{ type: "applyShield", value: 20, maxTriggersPerFight: 1 }],
        },
      },
      {
        id: "violet_core",
        name: "Violet Core",
        slot: "charm",
        stats: { luck: 18, speed: 10 },
        sprite: { sheet: "game.png", row: 16, col: 4, size: 32 },
        passive: {
          key: "luck_to_power",
          trigger: "onFightStart",
          priority: 10,
          actions: [{ type: "scaleLuckIntoPowerPct", value: 20 }],
        },
      },
    ],
    consumables: [
      {
        id: "seeker_lens",
        name: "Seeker Lens",
        sprite: { sheet: "game.png", row: 9, col: 7, size: 32 },
        consumableEffect: { kind: "reroll_keep_higher", charges: 2 },
      },
      {
        id: "oath_ribbon",
        name: "Oath Ribbon",
        sprite: { sheet: "game.png", row: 10, col: 10, size: 32 },
        consumableEffect: { kind: "streak_shield", charges: 3 },
      },
      {
        id: "treasure_cache",
        name: "Treasure Cache",
        sprite: { sheet: "game.png", row: 10, col: 11, size: 32 },
        consumableEffect: { kind: "coin_boost", pct: 500, wins: 20 },
      },
    ],
    materials: [
      {
        id: "ember_dust",
        name: "Ember Dust",
        sprite: { sheet: "game.png", row: 18, col: 4, size: 32 },
      },
      {
        id: "scarlet_dust",
        name: "Scarlet Dust",
        sprite: { sheet: "game.png", row: 18, col: 5, size: 32 },
      },
      {
        id: "gray_feather",
        name: "Gray Feather",
        sprite: { sheet: "game.png", row: 15, col: 9, size: 32 },
      },
    ],
  },
  {
    tier: "Mythic",
    unlockLevel: 42,
    materialPrices: [16000, 18000, 20000],
    gear: [
      {
        id: "reaper_glaive",
        name: "Reaper Glaive",
        slot: "weapon",
        stats: { power: 52, speed: 14 },
        sprite: { sheet: "game.png", row: 4, col: 12, size: 32 },
        passive: {
          key: "execute_strike",
          trigger: "onAttack",
          priority: 14,
          when: [{ left: "defender.hpPct", op: "<", right: 30 }],
          actions: [{ type: "addFlatDamage", value: 18 }],
        },
      },
      {
        id: "wyrm_hood",
        name: "Wyrm Hood",
        slot: "armor",
        stats: { guard: 48, hp: 42, luck: 8 },
        sprite: { sheet: "game.png", row: 6, col: 9, size: 32 },
        passive: {
          key: "crit_nullifier",
          trigger: "onDamageTaken",
          priority: 15,
          when: [{ left: "attack.critical", op: "==", right: true }],
          actions: [{ type: "cancelCritical", maxTriggersPerFight: 1 }],
        },
      },
      {
        id: "titan_greaves",
        name: "Titan Greaves",
        slot: "armor",
        stats: { guard: 44, hp: 46 },
        sprite: { sheet: "game.png", row: 7, col: 2, size: 32 },
        passive: {
          key: "flat_reduction",
          trigger: "onDamageTaken",
          priority: 9,
          actions: [{ type: "reduceIncomingDamageFlat", value: 4 }],
        },
      },
      {
        id: "crimson_core",
        name: "Crimson Core",
        slot: "charm",
        stats: { luck: 22, power: 8 },
        sprite: { sheet: "game.png", row: 16, col: 0, size: 32 },
        passive: {
          key: "exp_blessing",
          trigger: "onWin",
          priority: 5,
          actions: [{ type: "rewardBonusPct", target: "xp", value: 12 }],
        },
      },
    ],
    consumables: [
      {
        id: "prism_draught",
        name: "Prism Draught",
        sprite: { sheet: "game.png", row: 8, col: 14, size: 32 },
        consumableEffect: {
          kind: "guarantee_ssr_plus",
          charges: RARITY_BOOST_FIGHT_DURATION,
        },
      },
      {
        id: "sacred_candles",
        name: "Sacred Candles",
        sprite: { sheet: "game.png", row: 9, col: 10, size: 32 },
        consumableEffect: { kind: "shield_fight_start", amount: 60, charges: 3 },
      },
      {
        id: "gate_key",
        name: "Gate Key",
        sprite: { sheet: "game.png", row: 10, col: 9, size: 32 },
        consumableEffect: { kind: "cooldown_bypass", charges: 2 },
      },
    ],
    materials: [
      {
        id: "arcane_powder",
        name: "Arcane Powder",
        sprite: { sheet: "game.png", row: 18, col: 8, size: 32 },
      },
      {
        id: "ivory_feather",
        name: "Ivory Feather",
        sprite: { sheet: "game.png", row: 15, col: 10, size: 32 },
      },
      {
        id: "rose_crystal",
        name: "Rose Crystal",
        sprite: { sheet: "game.png", row: 15, col: 5, size: 32 },
      },
    ],
  },
  {
    tier: "Cosmic",
    unlockLevel: 58,
    materialPrices: [52000, 56000, 60000],
    gear: [
      {
        id: "orbit_scepter",
        name: "Orbit Scepter",
        slot: "weapon",
        stats: { power: 64, speed: 20, luck: 8 },
        sprite: { sheet: "game.png", row: 4, col: 11, size: 32 },
        passive: {
          key: "speed_surge_damage",
          trigger: "onAttack",
          priority: 12,
          actions: [{ type: "scaleBySpeedPct", value: 15 }],
        },
      },
      {
        id: "aegis_crown",
        name: "Aegis Crown",
        slot: "armor",
        stats: { guard: 60, hp: 56, luck: 12 },
        sprite: { sheet: "game.png", row: 6, col: 4, size: 32 },
        passive: {
          key: "first_hits_guard",
          trigger: "onDamageTaken",
          priority: 16,
          actions: [{ type: "reduceIncomingDamagePct", value: 30, maxTriggersPerFight: 2 }],
        },
      },
      {
        id: "azure_core",
        name: "Azure Core",
        slot: "charm",
        stats: { luck: 26, speed: 16, guard: 10 },
        sprite: { sheet: "game.png", row: 16, col: 1, size: 32 },
        passive: {
          key: "counter_burst",
          trigger: "onDamageTaken",
          priority: 9,
          actions: [{ type: "counterDamagePct", chancePct: 20, value: 50 }],
        },
      },
      {
        id: "void_core",
        name: "Void Core",
        slot: "charm",
        stats: { luck: 28, speed: 18, power: 10 },
        sprite: { sheet: "game.png", row: 16, col: 5, size: 32 },
        passive: {
          key: "void_pressure",
          trigger: "onFightStart",
          priority: 11,
          actions: [{ type: "reduceOpponentLuckPct", value: 20 }],
        },
      },
    ],
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
        consumableEffect: { kind: "double_passive_trigger", fights: 3 },
      },
      {
        id: "chrono_vial",
        name: "Chrono Vial",
        sprite: { sheet: "game.png", row: 17, col: 4, size: 32 },
        consumableEffect: { kind: "restore_consumable_charge", charges: 1 },
      },
    ],
    materials: [
      {
        id: "verdant_gem",
        name: "Verdant Gem",
        sprite: { sheet: "game.png", row: 18, col: 9, size: 32 },
      },
      {
        id: "pale_gem",
        name: "Pale Gem",
        sprite: { sheet: "game.png", row: 18, col: 10, size: 32 },
      },
      {
        id: "lunar_gem",
        name: "Lunar Gem",
        sprite: { sheet: "game.png", row: 18, col: 11, size: 32 },
      },
    ],
  },
];

const SHOP_TIERS = TIER_CONFIG.map((entry) => entry.tier);
const TIER_UNLOCK_LEVELS = Object.fromEntries(
  TIER_CONFIG.map((entry) => [entry.tier, entry.unlockLevel]),
);

const GEAR_CRAFT_COIN_FEES = [80, 350, 1200, 5000, 18000, 60000];
const CONSUMABLE_CRAFT_COIN_FEES = [48, 200, 640, 2000, 7200, 24000];

function normalizeGearItem(tierConfig, item) {
  return {
    id: item.id,
    name: item.name,
    tier: tierConfig.tier,
    unlockLevel: tierConfig.unlockLevel,
    price: 0,
    type: "gear",
    slot: item.slot,
    acquisition: "craft",
    stats: item.stats || {},
    sprite: item.sprite,
    passive: item.passive || null,
  };
}

function normalizeConsumableItem(tierConfig, item) {
  return {
    id: item.id,
    name: item.name,
    tier: tierConfig.tier,
    unlockLevel: tierConfig.unlockLevel,
    price: 0,
    type: "consumable",
    acquisition: "craft",
    consumableEffect: item.consumableEffect || null,
    sprite: item.sprite,
  };
}

function normalizeMaterialItem(tierConfig, item, index) {
  return {
    id: item.id,
    name: item.name,
    tier: tierConfig.tier,
    unlockLevel: tierConfig.unlockLevel,
    price: Number(tierConfig.materialPrices[index] || 0),
    type: "material",
    acquisition: "buy",
    sprite: item.sprite,
  };
}

function buildRecipes() {
  const recipes = [];

  TIER_CONFIG.forEach((tierConfig, tierIndex) => {
    const tierSlug = tierConfig.tier.toLowerCase();

    // Material prices per index: material A, B, C
    const matPrice = tierConfig.materialPrices;

    const gearSpecs = [
      { qty: [[0, 4], [1, 2], [2, 1]] },
      { qty: [[0, 2], [1, 4], [2, 1]] },
      { qty: [[0, 1], [1, 2], [2, 4]] },
      { qty: [[0, 3], [1, 3], [2, 2]] },
    ];

    tierConfig.gear.forEach((gearItem, index) => {
      const materialCost = gearSpecs[index].qty.reduce(
        (sum, [mIdx, qty]) => sum + (matPrice[mIdx] || 0) * qty,
        0,
      );
      recipes.push({
        id: `${tierSlug}_gear_${index + 1}`,
        tier: tierConfig.tier,
        unlockLevel: tierConfig.unlockLevel,
        output: { itemId: gearItem.id, quantity: 1 },
        coinCost: GEAR_CRAFT_COIN_FEES[tierIndex] + materialCost,
        inputs: [],
      });
    });

    const consumableSpecs = [
      { qty: [[0, 2], [2, 1]] },
      { qty: [[1, 2], [0, 1]] },
      { qty: [[2, 2], [1, 1]] },
    ];

    tierConfig.consumables.forEach((consumableItem, index) => {
      const materialCost = consumableSpecs[index].qty.reduce(
        (sum, [mIdx, qty]) => sum + (matPrice[mIdx] || 0) * qty,
        0,
      );
      recipes.push({
        id: `${tierSlug}_cons_${index + 1}`,
        tier: tierConfig.tier,
        unlockLevel: tierConfig.unlockLevel,
        output: { itemId: consumableItem.id, quantity: 1 },
        coinCost: CONSUMABLE_CRAFT_COIN_FEES[tierIndex] + materialCost,
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

const SHOP_ITEMS = TIER_CONFIG.flatMap((tierConfig) => [
  ...tierConfig.gear.map((item) => normalizeGearItem(tierConfig, item)),
  ...tierConfig.consumables.map((item) => normalizeConsumableItem(tierConfig, item)),
]).map((item) => ({
  ...item,
  recipeId: RECIPE_BY_OUTPUT_ITEM.get(item.id) || null,
}));

const LEGACY_SHOP_ITEMS = [
  {
    id: "tin_sword",
    price: 300,
    type: "gear",
    slot: "weapon",
    tier: "Rookie",
  },
  {
    id: "worn_jacket",
    price: 280,
    type: "gear",
    slot: "armor",
    tier: "Rookie",
  },
  {
    id: "lucky_clip",
    price: 260,
    type: "gear",
    slot: "charm",
    tier: "Rookie",
  },
  {
    id: "cracked_xp_tome",
    price: 160,
    type: "consumable",
    tier: "Rookie",
  },
  {
    id: "small_coin_ticket",
    price: 144,
    type: "consumable",
    tier: "Rookie",
  },
  {
    id: "iron_katana",
    price: 1300,
    type: "gear",
    slot: "weapon",
    tier: "Bronze",
  },
  {
    id: "reinforced_vest",
    price: 1200,
    type: "gear",
    slot: "armor",
    tier: "Bronze",
  },
  {
    id: "rabbit_foot",
    price: 1400,
    type: "gear",
    slot: "charm",
    tier: "Bronze",
  },
  {
    id: "refocus_potion",
    price: 760,
    type: "consumable",
    tier: "Bronze",
  },
  {
    id: "streak_shield",
    price: 1280,
    type: "consumable",
    tier: "Bronze",
  },
  {
    id: "moonsteel_blade",
    price: 5200,
    type: "gear",
    slot: "weapon",
    tier: "Silver",
  },
  {
    id: "aegis_coat",
    price: 5000,
    type: "gear",
    slot: "armor",
    tier: "Silver",
  },
  {
    id: "star_pendant",
    price: 4600,
    type: "gear",
    slot: "charm",
    tier: "Silver",
  },
  {
    id: "veteran_manual",
    price: 3440,
    type: "consumable",
    tier: "Silver",
  },
  {
    id: "golden_contract",
    price: 3360,
    type: "consumable",
    tier: "Silver",
  },
  {
    id: "dragonfang_saber",
    price: 22000,
    type: "gear",
    slot: "weapon",
    tier: "Gold",
  },
  {
    id: "saint_guard_plate",
    price: 21000,
    type: "gear",
    slot: "armor",
    tier: "Gold",
  },
  {
    id: "oracle_sigil",
    price: 24000,
    type: "gear",
    slot: "charm",
    tier: "Gold",
  },
  {
    id: "ssr_lure",
    price: 12000,
    type: "consumable",
    tier: "Gold",
  },
  {
    id: "fortune_vault",
    price: 14400,
    type: "consumable",
    tier: "Gold",
  },
  {
    id: "celestial_reaper",
    price: 90000,
    type: "gear",
    slot: "weapon",
    tier: "Mythic",
  },
  {
    id: "eternal_aegis",
    price: 86000,
    type: "gear",
    slot: "armor",
    tier: "Mythic",
  },
  {
    id: "fate_crown",
    price: 95000,
    type: "gear",
    slot: "charm",
    tier: "Mythic",
  },
  {
    id: "ur_sigil",
    price: 52000,
    type: "consumable",
    tier: "Mythic",
  },
  {
    id: "ascension_scroll",
    price: 120000,
    type: "instant",
    tier: "Mythic",
  },
];

const LEGACY_ITEM_DEFINITIONS = Object.fromEntries(
  LEGACY_SHOP_ITEMS.map((item) => [item.id, item]),
);

const LEGACY_ITEM_MAP = {
  tin_sword: "rustblade_weapon",
  worn_jacket: "patchwork_helm",
  lucky_clip: "copper_ring",
  cracked_xp_tome: "green_draft",
  small_coin_ticket: "amber_draft",
  iron_katana: "riversteel_saber",
  reinforced_vest: "iron_cuirass",
  rabbit_foot: "azure_ring",
  refocus_potion: "viridian_elixir",
  streak_shield: "oath_ribbon",
  moonsteel_blade: "dawnfang_blade",
  aegis_coat: "knight_helm",
  star_pendant: "laurel_pendant",
  veteran_manual: "star_tonic",
  golden_contract: "sun_elixir",
  dragonfang_saber: "waraxe_howl",
  saint_guard_plate: "sky_hood",
  oracle_sigil: "violet_core",
  ssr_lure: "seeker_lens",
  fortune_vault: "treasure_cache",
  celestial_reaper: "reaper_glaive",
  eternal_aegis: "aegis_crown",
  fate_crown: "void_core",
  ur_sigil: "prism_draught",
  ascension_scroll: "solar_cauldron",
};

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
  luck: 6,
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
  luck: 1,
};

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
};

module.exports = {
  ARENA_EFFECT_DEFAULTS,
  BASE_PROFILE,
  CATALOG_VERSION,
  DAILY_CARD_DRAW_LIMIT,
  DEFAULT_MAL_POOL_REFRESH_MINUTES,
  FIGHT_COOLDOWN_MS,
  GEAR_CRAFT_COIN_FEES,
  LEVEL_UP_GAINS,
  LEGACY_ITEM_DEFINITIONS,
  LEGACY_ITEM_MAP,
  RARITY_CONFIG,
  RARITY_ORDER,
  SHOP_ITEMS,
  SHOP_RECIPES,
  SHOP_TIERS,
  TIER_UNLOCK_LEVELS,
};