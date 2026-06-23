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
  Fire:  { Fire: 1, Water: 0.5, Earth: 2, Wind: 1, Light: 1, Dark: 1 },
  Water: { Fire: 2, Water: 1, Earth: 0.5, Wind: 1, Light: 1, Dark: 1 },
  Earth: { Fire: 0.5, Water: 2, Earth: 1, Wind: 1, Light: 1, Dark: 1 },
  Wind:  { Fire: 1, Water: 1, Earth: 1, Wind: 1, Light: 2, Dark: 0.5 },
  Light: { Fire: 1, Water: 1, Earth: 1, Wind: 0.5, Light: 1, Dark: 2 },
  Dark:  { Fire: 1, Water: 1, Earth: 1, Wind: 2, Light: 0.5, Dark: 1 },
};
const ECONOMY_BOOST_FIGHT_DURATION = 20;
const DEFENSIVE_BOOST_FIGHT_DURATION = 8;
const RARITY_BOOST_FIGHT_DURATION = 3;

const ROLLABLE_EQUIPMENT = [
  {
    id: "weapon_roll",
    name: "Weapon",
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
    "hp", "power", "guard", "speed", "luck", "hpPct", "dmgPct", "defendPct", "crit", "critDmg",
  ],
  ranges: {
    hp: [30, 50],
    power: [1, 10],
    guard: [1, 10],
    speed: [1, 10],
    luck: [1, 10],
    hpPct: [1, 10],
    dmgPct: [5, 45],
    defendPct: [5, 45],
    crit: [5, 25],
    critDmg: [10, 60],
  },
  count: 4,
};

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
          amount: 60,
          charges: DEFENSIVE_BOOST_FIGHT_DURATION,
        },
      },
      {
        id: "green_draft",
        name: "Berserker's Brew",
        sprite: { sheet: "game.png", row: 8, col: 2, size: 32 },
        consumableEffect: {
          kind: "damage_boost",
          pct: 20,
          fights: 10,
        },
      },
      {
        id: "amber_draft",
        name: "Scout's Whistle",
        sprite: { sheet: "game.png", row: 8, col: 3, size: 32 },
        consumableEffect: {
          kind: "speed_boost",
          pct: 12,
          fights: 10,
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
          pct: 35,
          fights: 5,
        },
      },
      {
        id: "viridian_elixir",
        name: "Viridian Elixir",
        sprite: { sheet: "game.png", row: 8, col: 6, size: 32 },
        consumableEffect: {
          kind: "iv_boost",
          total: 5,
          charges: 3,
        },
      },
      {
        id: "fuse_bomb",
        name: "Fuse Bomb",
        sprite: { sheet: "game.png", row: 9, col: 11, size: 32 },
        consumableEffect: { kind: "first_hit_true_damage", value: 100, charges: 2 },
      },
      {
        id: "exp_tome",
        name: "Sage's Tome",
        sprite: { sheet: "game.png", row: 8, col: 5, size: 32 },
        consumableEffect: {
          kind: "exp_boost",
          pct: 100,
          fights: 20,
        },
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
        name: "Phoenix Feather",
        sprite: { sheet: "game.png", row: 8, col: 7, size: 32 },
        consumableEffect: {
          kind: "death_save",
          charges: 2,
        },
      },
      {
        id: "star_tonic",
        name: "Titan Draught",
        sprite: { sheet: "game.png", row: 8, col: 8, size: 32 },
        consumableEffect: {
          kind: "stat_steroid",
          pct: 15,
          fights: 5,
        },
      },
      {
        id: "lantern_oil",
        name: "Lantern Oil",
        sprite: { sheet: "game.png", row: 9, col: 8, size: 32 },
        consumableEffect: { kind: "bonus_vs_higher_rarity", pct: 50, charges: 3 },
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
        consumableEffect: { kind: "crit_chance", pct: 20, fights: 3 },
      },
      {
        id: "oath_ribbon",
        name: "Oath Ribbon",
        sprite: { sheet: "game.png", row: 10, col: 10, size: 32 },
        consumableEffect: { kind: "guard_boost", pct: 15, fights: 5 },
      },
      {
        id: "treasure_cache",
        name: "Arcane Mirror",
        sprite: { sheet: "game.png", row: 10, col: 11, size: 32 },
        consumableEffect: { kind: "match_rarity", charges: 2 },
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
          kind: "first_attack_double",
          charges: 2,
        },
      },
      {
        id: "sacred_candles",
        name: "Sacred Candles",
        sprite: { sheet: "game.png", row: 9, col: 10, size: 32 },
        consumableEffect: { kind: "shield_fight_start", amount: 80, charges: 3 },
      },
      {
        id: "gate_key",
        name: "Vampiric Fang",
        sprite: { sheet: "game.png", row: 10, col: 9, size: 32 },
        consumableEffect: { kind: "vampiric_heal", pct: 20, fights: 3 },
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
        consumableEffect: { kind: "self_revive", hpPct: 20, charges: 2 },
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

    const consumableSpecs = [
      { qty: [[0, 2], [2, 1]] },
      { qty: [[1, 2], [0, 1]] },
      { qty: [[2, 2], [1, 1]] },
      { qty: [[0, 1], [1, 1], [2, 1]] },
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
  ELEMENT_COLORS,
  ELEMENT_EFFECTIVENESS,
  ELEMENTS,
  FIGHT_COOLDOWN_MS,
  LEVEL_UP_GAINS,
  RARITY_CONFIG,
  RARITY_ORDER,
  ROLLABLE_EQUIPMENT,
  SHOP_ITEMS,
  SHOP_RECIPES,
  SHOP_TIERS,
  SUB_STAT_POOL,
  TIER_UNLOCK_LEVELS,
};