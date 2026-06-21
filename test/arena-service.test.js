const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const {
  ArenaHttpError,
  __test,
  advancePlaybackFightTurn,
  activateArenaSkill,
  buyArenaShopCard,
  buyShopItem,
  craftShopRecipe,
  calculateRoundPower,
  calculateWinCoins,
  calculateWinXp,
  drawDailyCard,
  equipShopItem,
  getArenaCardShopPayload,
  getArenaCollectionPayload,
  getArenaProfilePayload,
  getArenaSkillTreePayload,
  getLeaderboard,
  getPlaybackFightState,
  rarityFromCharacterRank,
  resolveRoundWinner,
  resetArenaSkills,
  runFight,
  selectCollectionCard,
  startPlaybackFight,
  useConsumable,
  xpToNext,
} = require("../lib/arena-service");
const { SHOP_ITEMS } = require("../lib/arena-constants");

const {
  buildPassiveRuntime,
  calculateAttackOutcome,
  consumeTempGuard,
  getCardShopPrice,
  isRandomCardOfferAvailable,
  rollFightMaterialRewards,
  runPassivesForTrigger,
  simulateFight,
} = __test;

function createTestDb() {
  const db = new Database(":memory:");

  db.prepare(
    `CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      avatar TEXT
    )`,
  ).run();

  db.prepare(
    `CREATE TABLE arena_profiles (
      userId TEXT PRIMARY KEY,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      coins INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      winStreak INTEGER NOT NULL DEFAULT 0,
      hp INTEGER NOT NULL DEFAULT 120,
      power INTEGER NOT NULL DEFAULT 12,
      guard INTEGER NOT NULL DEFAULT 12,
      speed INTEGER NOT NULL DEFAULT 10,
      luck INTEGER NOT NULL DEFAULT 6,
      lifetimeCoinsEarned INTEGER NOT NULL DEFAULT 0,
      selectedCardJson TEXT,
      lastCardDrawDate TEXT,
      dailyCardDrawCount INTEGER NOT NULL DEFAULT 0,
      catalogVersion TEXT NOT NULL DEFAULT 'v2',
      effectsJson TEXT,
      lastFightAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`,
  ).run();

  db.prepare(
    `CREATE TABLE arena_inventory (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      itemId TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`,
  ).run();

  db.prepare(
    `CREATE TABLE arena_equipment (
      userId TEXT NOT NULL,
      slot TEXT NOT NULL,
      itemId TEXT NOT NULL,
      equippedAt TEXT NOT NULL,
      PRIMARY KEY (userId, slot)
    )`,
  ).run();

  db.prepare(
    `CREATE TABLE arena_fights (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      opponentUserId TEXT,
      result TEXT NOT NULL,
      roundsJson TEXT NOT NULL,
      xpDelta INTEGER NOT NULL DEFAULT 0,
      coinDelta INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    )`,
  ).run();

  db.prepare(
    `CREATE TABLE arena_card_collection (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      cardInstanceId TEXT NOT NULL,
      cardJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`,
  ).run();

  db.prepare(
    `CREATE TABLE arena_mal_card_pool (
      malId INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      imageUrl TEXT NOT NULL,
      meanScore REAL,
      popularity INTEGER,
      favorites INTEGER,
      nsfw TEXT,
      fetchedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`,
  ).run();

  db.prepare(
    `CREATE TABLE arena_daily_card_offers (
      offerId TEXT PRIMARY KEY,
      offerDate TEXT NOT NULL,
      slot INTEGER NOT NULL,
      malId INTEGER NOT NULL,
      cardJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE (offerDate, slot),
      UNIQUE (offerDate, malId)
    )`,
  ).run();

  db.prepare(
    `CREATE TABLE arena_daily_card_purchases (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      offerId TEXT NOT NULL,
      offerDate TEXT NOT NULL,
      purchasedAt TEXT NOT NULL,
      UNIQUE (userId, offerId)
    )`,
  ).run();

  db.prepare(
    `CREATE TABLE arena_skill_allocations (
      userId TEXT NOT NULL,
      nodeId TEXT NOT NULL,
      activatedAt TEXT NOT NULL,
      PRIMARY KEY (userId, nodeId)
    )`,
  ).run();

  db.prepare(
    `CREATE TABLE arena_active_fights (
      userId TEXT PRIMARY KEY,
      fightId TEXT NOT NULL,
      cursor INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'active',
      simulationJson TEXT NOT NULL,
      opponentJson TEXT NOT NULL,
      playerEffectsJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`,
  ).run();

  const now = new Date().toISOString();
  db.prepare("INSERT INTO users (id, username, avatar) VALUES (?, ?, ?)").run(
    "u1",
    "player1",
    null,
  );
  db.prepare("INSERT INTO users (id, username, avatar) VALUES (?, ?, ?)").run(
    "u2",
    "player2",
    null,
  );
  db.prepare("INSERT INTO users (id, username, avatar) VALUES (?, ?, ?)").run(
    "u3",
    "player3",
    null,
  );

  db.prepare(
    `INSERT INTO arena_mal_card_pool (
      malId, title, url, imageUrl, meanScore, popularity, favorites, nsfw, fetchedAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    1,
    "Character A",
    "https://myanimelist.net/character/1",
    "https://cdn.test/a.jpg",
    8.2,
    100,
    1000,
    "white",
    now,
    now,
    now,
  );
  db.prepare(
    `INSERT INTO arena_mal_card_pool (
      malId, title, url, imageUrl, meanScore, popularity, favorites, nsfw, fetchedAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    2,
    "Character B",
    "https://myanimelist.net/character/2",
    "https://cdn.test/b.jpg",
    7.9,
    350,
    75000,
    "white",
    now,
    now,
    now,
  );

  for (let id = 3; id <= 7; id += 1) {
    db.prepare(
      `INSERT INTO arena_mal_card_pool (
        malId, title, url, imageUrl, meanScore, popularity, favorites, nsfw, fetchedAt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      `Character ${id}`,
      `https://myanimelist.net/character/${id}`,
      `https://cdn.test/${id}.jpg`,
      7.5 + id / 10,
      400 + id,
      1000 * id,
      "white",
      now,
      now,
      now,
    );
  }

  return db;
}

function insertProfile(db, input) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_profiles (
      userId, level, xp, coins, wins, losses, winStreak,
      hp, power, guard, speed, luck, lifetimeCoinsEarned,
      selectedCardJson, lastCardDrawDate, dailyCardDrawCount, catalogVersion, effectsJson, lastFightAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.userId,
    input.level ?? 1,
    input.xp ?? 0,
    input.coins ?? 0,
    input.wins ?? 0,
    input.losses ?? 0,
    input.winStreak ?? 0,
    input.hp ?? 120,
    input.power ?? 12,
    input.guard ?? 12,
    input.speed ?? 10,
    input.luck ?? 6,
    input.lifetimeCoinsEarned ?? 0,
    input.selectedCard ? JSON.stringify(input.selectedCard) : null,
    input.lastCardDrawDate ?? null,
    input.dailyCardDrawCount ?? 0,
    input.catalogVersion ?? "v2",
    JSON.stringify(
      input.effects ?? {
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
      },
    ),
    input.lastFightAt ?? null,
    now,
    now,
  );
}

function makeCard(id = 1, rarity = "C") {
  return {
    cardInstanceId: `card-${id}`,
    malId: id,
    title: `Card ${id}`,
    url: `https://myanimelist.net/character/${id}`,
    imageUrl: `https://cdn.test/${id}.jpg`,
    meanScore: 8,
    popularity: 200,
    favorites: 10000,
    nsfw: "white",
    rarity,
    iv: {
      power: 20,
      guard: 20,
      speed: 20,
      luck: 20,
      total: 80,
    },
    drawnAt: new Date().toISOString(),
  };
}

function findPassive(key) {
  const item = SHOP_ITEMS.find((candidate) => candidate.passive?.key === key);
  assert.ok(item, `Missing passive fixture: ${key}`);
  return item.passive;
}

function makeCombatSnapshot({
  id,
  rarity = "C",
  stats = {},
  activePassives = [],
}) {
  const totalStats = {
    hp: 120,
    power: 20,
    guard: 12,
    speed: 10,
    luck: 6,
    ...stats,
  };

  return {
    profile: { level: 1 },
    selectedCard: makeCard(id, rarity),
    rarity,
    baseStats: { ...totalStats },
    totalStats: { ...totalStats },
    activePassives,
  };
}

function makeEffects(overrides = {}) {
  return {
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
    ...overrides,
  };
}

test("xp formula and reward formulas stay stable", () => {
  assert.equal(xpToNext(1), 120);
  assert.equal(xpToNext(10), 4080);
  assert.equal(calculateWinXp(20, 2, 3), 41);
  assert.equal(calculateWinCoins(20, 12, 16), 93);
});

test("round power includes metadata and rarity modifiers", () => {
  const result = calculateRoundPower({
    power: 10,
    guard: 10,
    speed: 10,
    luck: 10,
    equipmentBonus: 5,
    rarity: "SSR",
    card: {
      meanScore: 8,
      popularity: 250,
    },
    randomFn: () => 0.5,
  });

  assert.equal(typeof result.value, "number");
  assert.equal(result.breakdown.rarityPower, 34);
  assert.ok(result.breakdown.malScoreBonus >= 0);
  assert.ok(result.breakdown.popularityBonus >= 0);
});

test("character rank maps to the configured rarity percentiles", () => {
  assert.equal(rarityFromCharacterRank(1, 100), "UR");
  assert.equal(rarityFromCharacterRank(2, 100), "SSR");
  assert.equal(rarityFromCharacterRank(5, 100), "SSR");
  assert.equal(rarityFromCharacterRank(6, 100), "SR");
  assert.equal(rarityFromCharacterRank(15, 100), "SR");
  assert.equal(rarityFromCharacterRank(16, 100), "R");
  assert.equal(rarityFromCharacterRank(40, 100), "R");
  assert.equal(rarityFromCharacterRank(41, 100), "C");
  assert.equal(rarityFromCharacterRank(100, 100), "C");
});

test("stored cards with zero favorites are normalized to C rarity", () => {
  const db = createTestDb();
  const card = makeCard(99, "SR");
  card.favorites = 0;

  insertProfile(db, {
    userId: "u1",
    selectedCard: card,
  });

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_card_collection (id, userId, cardInstanceId, cardJson, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "collection-1",
    "u1",
    card.cardInstanceId,
    JSON.stringify(card),
    now,
    now,
  );

  const profile = getArenaProfilePayload(db, "u1");
  assert.equal(profile.selectedCard?.rarity, "C");

  const collection = getArenaCollectionPayload(db, "u1");
  assert.equal(collection.cards[0]?.rarity, "C");
});

test("profile totals expose and include selected card IV combat bonuses", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    hp: 120,
    power: 12,
    guard: 12,
    speed: 10,
    luck: 6,
    selectedCard: makeCard(1, "R"),
  });

  const profile = getArenaProfilePayload(db, "u1");
  assert.deepEqual(profile.stats.card, {
    hp: 20,
    power: 6,
    guard: 6,
    speed: 6,
    luck: 6,
  });
  assert.deepEqual(profile.stats.total, {
    hp: 140,
    power: 18,
    guard: 18,
    speed: 16,
    luck: 12,
  });
});

test("Riversteel applies its critical bonus before attack resolution", () => {
  const selfRuntime = buildPassiveRuntime();
  const mods = runPassivesForTrigger({
    trigger: "onAttack",
    passives: [findPassive("riversteel_edge")],
    selfStats: { power: 10, guard: 10, speed: 10, luck: 10 },
    opponentStats: { power: 10, guard: 10, speed: 10, luck: 10 },
    selfRuntime,
    opponentRuntime: buildPassiveRuntime(),
    context: { self: {}, opponent: {}, attack: {} },
    randomFn: () => 0.99,
  });

  assert.equal(mods.bonusCritChancePct, 10);
});

test("Guard Cap grants temporary guard without permanently mutating stats", () => {
  const stats = { power: 10, guard: 12, speed: 10, luck: 10 };
  const runtime = buildPassiveRuntime();
  runPassivesForTrigger({
    trigger: "onDamageTaken",
    passives: [findPassive("guard_cap_focus")],
    selfStats: stats,
    opponentStats: { power: 10, guard: 10, speed: 10, luck: 10 },
    selfRuntime: runtime,
    opponentRuntime: buildPassiveRuntime(),
    context: { self: {}, opponent: {}, attack: {} },
    randomFn: () => 0,
  });

  assert.equal(stats.guard, 12);
  assert.deepEqual(runtime.tempGuard, { amount: 4, remainingHits: 1 });
  assert.equal(consumeTempGuard(runtime), 4);
  assert.deepEqual(runtime.tempGuard, { amount: 0, remainingHits: 0 });
  assert.equal(consumeTempGuard(runtime), 0);
});

test("Twinlight rolls its extra-strike chance exactly once", () => {
  let randomCalls = 0;
  const mods = runPassivesForTrigger({
    trigger: "onDamageDealt",
    passives: [findPassive("double_strike")],
    selfStats: { power: 10, guard: 10, speed: 10, luck: 10 },
    opponentStats: { power: 10, guard: 10, speed: 10, luck: 10 },
    selfRuntime: buildPassiveRuntime(),
    opponentRuntime: buildPassiveRuntime(),
    context: { self: {}, defender: {}, attack: {} },
    randomFn: () => {
      randomCalls += 1;
      return 0.1;
    },
  });

  assert.equal(randomCalls, 1);
  assert.equal(mods.extraStrikeChancePct, 100);
  assert.equal(mods.extraStrikeDamagePct, 40);
});

test("Fuse Bomb true damage bypasses reductions and critical scaling", () => {
  const sequence = () => {
    const values = [0.99, 0.5, 0.5, 0];
    return () => values.shift() ?? 0.5;
  };
  const input = {
    attackerStats: { power: 30, guard: 10, speed: 10, luck: 10 },
    defenderStats: { power: 10, guard: 30, speed: 10, luck: 10 },
    attackerRarity: "C",
    defenderDamageReductionPct: 80,
    defenderDamageReductionFlat: 100,
  };
  const normal = calculateAttackOutcome({
    ...input,
    randomFn: sequence(),
  });
  const bomb = calculateAttackOutcome({
    ...input,
    attackerTrueDamage: 25,
    randomFn: sequence(),
  });

  assert.equal(normal.critical, true);
  assert.equal(bomb.critical, true);
  assert.equal(bomb.damage, normal.damage);
  assert.equal(bomb.trueDamage, 25);
});

test("Verdant Core restores actual battle HP after damage", async () => {
  const result = await simulateFight(null, {
    player: makeCombatSnapshot({
      id: 1,
      stats: { power: 25, speed: 20 },
    }),
    opponent: makeCombatSnapshot({
      id: 2,
      stats: { hp: 180, guard: 18 },
      activePassives: [findPassive("verdant_regen")],
    }),
    playerEffects: makeEffects(),
    randomFn: () => 0.99,
  });

  assert.ok(result.battle.console.some((entry) => entry.line.includes("recovered 4 HP")));
});

test("all potion effects last 50 fights", () => {
  const durationFieldByItemId = {
    red_tonic: "charges",
    green_draft: "fights",
    amber_draft: "fights",
    frost_elixir: "fights",
    viridian_elixir: "charges",
    sun_elixir: "fights",
    star_tonic: "fights",
    prism_draught: "charges",
  };

  Object.entries(durationFieldByItemId).forEach(([itemId, durationField]) => {
    const item = SHOP_ITEMS.find((candidate) => candidate.id === itemId);
    assert.ok(item, `Missing potion fixture: ${itemId}`);
    assert.equal(item.consumableEffect?.[durationField], 50);
  });
});

test("fight-start passive shields absorb damage before HP is lost", async () => {
  const opponent = makeCombatSnapshot({
    id: 2,
    stats: { power: 40, speed: 30 },
  });
  const baseline = await simulateFight(null, {
    player: makeCombatSnapshot({
      id: 1,
      stats: { guard: 10, speed: 5 },
    }),
    opponent,
    playerEffects: makeEffects(),
    randomFn: () => 0.99,
  });
  const result = await simulateFight(null, {
    player: makeCombatSnapshot({
      id: 1,
      stats: { guard: 10, speed: 5 },
      activePassives: [
        {
          key: "skill:defense_resolve_1",
          trigger: "onFightStart",
          priority: 20,
          when: [],
          actions: [{ type: "applyShield", value: 6 }],
        },
      ],
    }),
    opponent,
    playerEffects: makeEffects(),
    randomFn: () => 0.99,
  });

  const baselineHit = baseline.rounds.find(
    (turn) => turn.attacker === "opponent" && !turn.avoided,
  );
  const firstIncomingHit = result.rounds.find(
    (turn) => turn.attacker === "opponent" && !turn.avoided,
  );
  assert.ok(baselineHit);
  assert.ok(firstIncomingHit);
  assert.ok(result.battle.console.some((entry) => entry.line.includes("starts with a shield of 6")));
  assert.ok(result.battle.console.some((entry) => entry.line.includes("shield absorbed 6 HP")));
  assert.equal(result.battle.initialShield.player, 6);
  assert.equal(firstIncomingHit.playerShield, 0);
  assert.equal(baselineHit.damage - firstIncomingHit.damage, 6);
});

test("consumable fight-start shields are applied and marked for consumption", async () => {
  const result = await simulateFight(null, {
    player: makeCombatSnapshot({
      id: 1,
      stats: { guard: 10, speed: 5 },
    }),
    opponent: makeCombatSnapshot({
      id: 2,
      stats: { power: 40, speed: 30 },
    }),
    playerEffects: makeEffects({
      fightStartShieldCharges: 1,
      fightStartShieldAmount: 20,
    }),
    randomFn: () => 0.99,
  });

  assert.equal(result.effectUsage.usedFightStartShield, true);
  assert.ok(result.battle.console.some((entry) => entry.line.includes("starts with a shield of 20")));
  assert.ok(result.battle.console.some((entry) => entry.line.includes("shield absorbed 20 HP")));
  assert.equal(result.battle.initialShield.player, 20);
  assert.ok(result.rounds.some((turn) => turn.playerShield < 20));
});

test("Fuse Bomb is consumed only after a non-evaded hit", async () => {
  const player = makeCombatSnapshot({ id: 1 });
  const opponent = makeCombatSnapshot({ id: 2 });
  const effects = makeEffects({
    firstHitTrueDamageCharges: 1,
    firstHitTrueDamageValue: 25,
  });

  const evaded = await simulateFight(null, {
    player,
    opponent,
    playerEffects: effects,
    randomFn: () => 0,
  });
  const landed = await simulateFight(null, {
    player,
    opponent,
    playerEffects: effects,
    randomFn: () => 0.99,
  });

  assert.equal(evaded.effectUsage.usedFirstHitTrueDamage, false);
  assert.equal(landed.effectUsage.usedFirstHitTrueDamage, true);
});

test("Lantern Oil is consumed only against a higher-rarity opponent", async () => {
  const effects = makeEffects({
    higherRarityDamageBonusPctCharges: 1,
    higherRarityDamageBonusPct: 10,
  });
  const equalRarity = await simulateFight(null, {
    player: makeCombatSnapshot({ id: 1, rarity: "R" }),
    opponent: makeCombatSnapshot({ id: 2, rarity: "R" }),
    playerEffects: effects,
    randomFn: () => 0.99,
  });
  const higherRarity = await simulateFight(null, {
    player: makeCombatSnapshot({ id: 1, rarity: "R" }),
    opponent: makeCombatSnapshot({ id: 2, rarity: "SSR" }),
    playerEffects: effects,
    randomFn: () => 0.99,
  });

  assert.equal(equalRarity.effectUsage.usedHigherRarityBonus, false);
  assert.equal(higherRarity.effectUsage.usedHigherRarityBonus, true);
});

test("fight materials roll zero or one item from each of tiers one through three", () => {
  const values = [0.9, 0, 0.1, 0.9, 0.99];
  const rewards = rollFightMaterialRewards(() => values.shift() ?? 0);

  assert.deepEqual(
    rewards.map((reward) => ({
      tier: reward.tier,
      quantity: reward.quantity,
    })),
    [
      { tier: "Rookie", quantity: 1 },
      { tier: "Silver", quantity: 1 },
    ],
  );
});

test("tie break uses speed before coinflip", () => {
  assert.equal(
    resolveRoundWinner({
      playerPower: 100,
      opponentPower: 100,
      playerSpeed: 12,
      opponentSpeed: 11,
      randomFn: () => 0,
    }),
    "player",
  );
  assert.equal(
    resolveRoundWinner({
      playerPower: 100,
      opponentPower: 100,
      playerSpeed: 10,
      opponentSpeed: 10,
      randomFn: () => 0.9,
    }),
    "player",
  );
});

test("skill points are retroactive and bank beyond the initial tree", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 1 });
  assert.equal(getArenaSkillTreePayload(db, "u1").earnedPoints, 0);

  db.prepare("UPDATE arena_profiles SET level = 2 WHERE userId = ?").run("u1");
  assert.equal(getArenaSkillTreePayload(db, "u1").earnedPoints, 1);

  db.prepare("UPDATE arena_profiles SET level = 20 WHERE userId = ?").run("u1");
  assert.equal(getArenaSkillTreePayload(db, "u1").earnedPoints, 19);

  db.prepare("UPDATE arena_profiles SET level = 50 WHERE userId = ?").run("u1");
  const levelFifty = getArenaSkillTreePayload(db, "u1");
  assert.equal(levelFifty.earnedPoints, 49);
  assert.equal(levelFifty.availablePoints, 49);
});

test("skill activation enforces points, prerequisites, duplicates, and allows branch mixing", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 4 });

  assert.throws(
    () => activateArenaSkill(db, "u1", "offense_might_2"),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_SKILL_PREREQUISITE",
  );

  activateArenaSkill(db, "u1", "offense_might_1");
  activateArenaSkill(db, "u1", "defense_vitality_1");
  const mixed = activateArenaSkill(db, "u1", "utility_fortune_1");
  assert.equal(mixed.spentPoints, 3);
  assert.equal(mixed.availablePoints, 0);

  assert.throws(
    () => activateArenaSkill(db, "u1", "offense_might_1"),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_SKILL_ALREADY_ACTIVE",
  );
  assert.throws(
    () => activateArenaSkill(db, "u1", "offense_swiftness_1"),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_SKILL_POINTS_REQUIRED",
  );
});

test("skill stats and passives are derived into arena profiles", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 5 });

  activateArenaSkill(db, "u1", "offense_might_1");
  activateArenaSkill(db, "u1", "defense_vitality_1");
  activateArenaSkill(db, "u1", "offense_fury_1");
  activateArenaSkill(db, "u1", "defense_resolve_1");

  const profile = getArenaProfilePayload(db, "u1");
  assert.equal(profile.stats.skill.power, 2);
  assert.equal(profile.stats.skill.hp, 8);
  assert.equal(profile.stats.total.power, profile.stats.base.power + 2);
  assert.equal(profile.stats.total.hp, profile.stats.base.hp + 8);
  assert.ok(
    profile.activePassives.some(
      (passive) => passive.key === "skill:offense_fury_1",
    ),
  );
  assert.ok(
    profile.activePassives.some(
      (passive) =>
        passive.key === "skill:defense_resolve_1" &&
        passive.actions.some(
          (action) => action.type === "applyShield" && action.value === 6,
        ),
    ),
  );
});

test("skill reset charges 100 coins per level and refunds allocations", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 10, coins: 999 });
  activateArenaSkill(db, "u1", "offense_might_1");

  assert.throws(
    () => resetArenaSkills(db, "u1"),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_SKILL_RESET_COINS",
  );

  db.prepare("UPDATE arena_profiles SET coins = 1500 WHERE userId = ?").run("u1");
  const reset = resetArenaSkills(db, "u1");
  assert.equal(reset.spentPoints, 0);
  assert.equal(reset.availablePoints, 9);
  assert.equal(reset.coins, 500);

  assert.throws(
    () => resetArenaSkills(db, "u1"),
    (error) =>
      error instanceof ArenaHttpError && error.code === "ARENA_SKILL_RESET_EMPTY",
  );
});

test("fight loss grants exactly 1 exp and 0 coins", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 1,
    xp: 0,
    coins: 0,
    wins: 0,
    losses: 0,
    winStreak: 4,
    power: 1,
    guard: 1,
    speed: 1,
    luck: 1,
    effects: makeEffects({
      expBoostPct: 20,
      expBoostWinsRemaining: 50,
      coinBoostPct: 20,
      coinBoostWinsRemaining: 50,
    }),
    selectedCard: makeCard(1, "C"),
  });
  insertProfile(db, {
    userId: "u2",
    level: 45,
    xp: 0,
    coins: 0,
    wins: 100,
    losses: 5,
    winStreak: 0,
    power: 400,
    guard: 400,
    speed: 400,
    luck: 400,
    selectedCard: makeCard(2, "UR"),
  });

  const response = await runFight(db, "u1");
  assert.equal(response.result, "loss");
  assert.ok(response.battle);
  assert.equal(response.rewards.xp, 1);
  assert.equal(response.rewards.coins, 0);
  assert.ok(response.rewards.materialDrops.length <= 3);
  assert.ok(
    response.rewards.materialDrops.every(
      (drop) =>
        ["Rookie", "Bronze", "Silver"].includes(drop.tier) &&
        drop.quantity === 1,
    ),
  );
  assert.equal(response.profile.losses, 1);
  assert.equal(response.profile.effects.expBoostWinsRemaining, 49);
  assert.equal(response.profile.effects.coinBoostWinsRemaining, 49);
});

test("fight includes hp battle console events", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    selectedCard: makeCard(1, "R"),
  });
  insertProfile(db, {
    userId: "u2",
    selectedCard: makeCard(2, "R"),
  });

  const result = await runFight(db, "u1");
  assert.ok(result.battle);
  assert.ok(result.battle.maxHp.player > 0);
  assert.ok(result.battle.maxHp.opponent > 0);
  assert.ok(result.battle.console.length > 0);
  assert.ok(result.battle.console.some((entry) => entry.line.includes("is attacking")));
});

test("playback fight state keeps finalized exp and coin rewards", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    selectedCard: makeCard(1, "R"),
  });
  insertProfile(db, {
    userId: "u2",
    selectedCard: makeCard(2, "R"),
  });

  let fight = await startPlaybackFight(db, "u1");
  while (!fight.isFinished) {
    fight = advancePlaybackFightTurn(db, "u1");
  }

  const persisted = getPlaybackFightState(db, "u1");
  assert.ok(persisted?.rewards);
  assert.ok(persisted.rewards.xp >= 1);
  assert.ok(persisted.rewards.coins >= 0);
  assert.deepEqual(persisted.rewards, fight.rewards);
});

test("fight cooldown blocks rapid repeat fights", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    lastFightAt: new Date().toISOString(),
    selectedCard: makeCard(1, "C"),
  });
  insertProfile(db, {
    userId: "u2",
    level: 2,
    selectedCard: makeCard(2, "C"),
  });

  await assert.rejects(
    async () => {
      await runFight(db, "u1");
    },
    (error) =>
      error instanceof ArenaHttpError && error.code === "ARENA_FIGHT_COOLDOWN",
  );
});

test("buying material consumes coins", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 10,
    coins: 1000,
    selectedCard: makeCard(1, "C"),
  });

  const buyResult = buyShopItem(db, "u1", "azure_ore");
  assert.equal(buyResult.purchasedItemId, "azure_ore");
  assert.equal(buyResult.shop.profile.coins, 640);
});

test("card shop shares five unique daily offers and refreshes by UTC date", async () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", coins: 5000 });
  insertProfile(db, { userId: "u2", coins: 5000 });

  const first = await getArenaCardShopPayload(db, "u1", {
    recordedDate: "2099-01-01",
  });
  const second = await getArenaCardShopPayload(db, "u2", {
    recordedDate: "2099-01-01",
  });
  const nextDay = await getArenaCardShopPayload(db, "u1", {
    recordedDate: "2099-01-02",
  });

  assert.equal(first.dailyOffers.length, 5);
  assert.deepEqual(first.prices, {
    C: 50,
    R: 100,
    SR: 1000,
    SSR: 5000,
    UR: 10000,
  });
  assert.ok(
    first.dailyOffers.every(
      (offer) => offer.price === first.prices[offer.card.rarity],
    ),
  );
  assert.equal(first.randomOffer, null);
  assert.equal(
    new Set(first.dailyOffers.map((offer) => offer.card.malId)).size,
    5,
  );
  assert.deepEqual(second.dailyOffers, first.dailyOffers);
  assert.equal(first.nextRefreshAt, "2099-01-02T00:00:00.000Z");
  assert.equal(nextDay.offerDate, "2099-01-02");
  assert.ok(
    nextDay.dailyOffers.every(
      (offer) =>
        !first.dailyOffers.some(
          (previousOffer) => previousOffer.offerId === offer.offerId,
        ),
    ),
  );
});

test("card shop prices cards by rarity", () => {
  assert.equal(getCardShopPrice("C"), 50);
  assert.equal(getCardShopPrice("R"), 100);
  assert.equal(getCardShopPrice("SR"), 1000);
  assert.equal(getCardShopPrice("SSR"), 5000);
  assert.equal(getCardShopPrice("UR"), 10000);
});

test("random card offer is removed at the June 23, 2026 UTC cutoff", async () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", coins: 1000 });

  assert.equal(isRandomCardOfferAvailable("2026-06-22"), true);
  assert.equal(isRandomCardOfferAvailable("2026-06-23"), false);
  const before = await getArenaCardShopPayload(db, "u1", {
    recordedDate: "2026-06-22",
  });
  const cutoff = await getArenaCardShopPayload(db, "u1", {
    recordedDate: "2026-06-23",
  });
  assert.equal(before.randomOffer?.price, 500);
  assert.equal(before.randomOffer?.endsAt, "2026-06-23T00:00:00.000Z");
  assert.equal(cutoff.randomOffer, null);
  await assert.rejects(
    () =>
      buyArenaShopCard(
        db,
        "u1",
        { kind: "random" },
        { recordedDate: "2026-06-23" },
      ),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_RANDOM_CARD_OFFER_ENDED",
  );
  assert.equal(getArenaProfilePayload(db, "u1").coins, 1000);
});

test("daily card purchases are sold per account and preserve selected card", async () => {
  const db = createTestDb();
  const selectedCard = makeCard(99, "SSR");
  insertProfile(db, {
    userId: "u1",
    coins: 20000,
    selectedCard,
  });
  insertProfile(db, {
    userId: "u2",
    coins: 20000,
    selectedCard: makeCard(98, "SR"),
  });

  const shop = await getArenaCardShopPayload(db, "u1");
  const offer = shop.dailyOffers[0];
  const firstPurchase = await buyArenaShopCard(db, "u1", {
    kind: "daily",
    offerId: offer.offerId,
  });

  assert.equal(firstPurchase.pricePaid, offer.price);
  assert.equal(firstPurchase.profile.coins, 20000 - offer.price);
  assert.equal(
    firstPurchase.profile.selectedCard.cardInstanceId,
    selectedCard.cardInstanceId,
  );
  assert.equal(firstPurchase.card.malId, offer.card.malId);
  assert.equal(firstPurchase.card.rarity, offer.card.rarity);
  assert.deepEqual(firstPurchase.card.iv, offer.card.iv);
  assert.notEqual(firstPurchase.card.cardInstanceId, offer.card.cardInstanceId);
  assert.equal(
    firstPurchase.cardShop.dailyOffers.find(
      (candidate) => candidate.offerId === offer.offerId,
    )?.sold,
    true,
  );

  await assert.rejects(
    () =>
      buyArenaShopCard(db, "u1", {
        kind: "daily",
        offerId: offer.offerId,
      }),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_CARD_SHOP_ALREADY_SOLD",
  );

  const otherAccountShop = await getArenaCardShopPayload(db, "u2");
  assert.equal(
    otherAccountShop.dailyOffers.find(
      (candidate) => candidate.offerId === offer.offerId,
    )?.sold,
    false,
  );
  const secondPurchase = await buyArenaShopCard(db, "u2", {
    kind: "daily",
    offerId: offer.offerId,
  });
  assert.notEqual(
    secondPurchase.card.cardInstanceId,
    firstPurchase.card.cardInstanceId,
  );
});

test("random card purchases remain available and failures never charge coins", async () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", coins: 1250 });
  insertProfile(db, { userId: "u2", coins: 2000 });
  insertProfile(db, { userId: "u3", coins: 500 });

  const drawCommonCard = async () => ({
    malId: 7,
    title: "Common Character",
    url: "https://myanimelist.net/character/7",
    imageUrl: "https://cdn.test/7.jpg",
    meanScore: 7,
    popularity: Number.MAX_SAFE_INTEGER,
    favorites: 0,
    nsfw: "white",
  });
  const first = await buyArenaShopCard(
    db,
    "u1",
    { kind: "random" },
    { recordedDate: "2026-06-22", drawCard: drawCommonCard },
  );
  const second = await buyArenaShopCard(
    db,
    "u1",
    { kind: "random" },
    { recordedDate: "2026-06-22", drawCard: drawCommonCard },
  );
  assert.equal(first.card.rarity, "C");
  assert.equal(first.pricePaid, 500);
  assert.equal(second.profile.coins, 250);
  assert.notEqual(first.card.cardInstanceId, second.card.cardInstanceId);
  assert.equal(getArenaCollectionPayload(db, "u1").cards.length, 2);

  await assert.rejects(
    () =>
      buyArenaShopCard(
        db,
        "u1",
        { kind: "random" },
        { recordedDate: "2026-06-22" },
      ),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_NOT_ENOUGH_COINS" &&
      error.details.requiredCoins === 500,
  );
  assert.equal(getArenaProfilePayload(db, "u1").coins, 250);
  assert.equal(getArenaCollectionPayload(db, "u1").cards.length, 2);

  const ultraRare = await buyArenaShopCard(
    db,
    "u3",
    { kind: "random" },
    {
      recordedDate: "2026-06-22",
      drawCard: async () => ({
        malId: 1,
        title: "Ultra Rare Character",
        url: "https://myanimelist.net/character/1",
        imageUrl: "https://cdn.test/1.jpg",
        meanScore: 9,
        popularity: 1,
        favorites: 100000,
        nsfw: "white",
      }),
    },
  );
  assert.equal(ultraRare.card.rarity, "UR");
  assert.equal(ultraRare.pricePaid, 500);
  assert.equal(getArenaProfilePayload(db, "u3").coins, 0);
  assert.equal(getArenaCollectionPayload(db, "u3").cards.length, 1);

  await assert.rejects(
    () =>
      buyArenaShopCard(
        db,
        "u2",
        { kind: "random" },
        {
          recordedDate: "2026-06-22",
          drawCard: async () => {
            throw new Error("source unavailable");
          },
        },
      ),
    /source unavailable/,
  );
  assert.equal(getArenaProfilePayload(db, "u2").coins, 2000);
  assert.equal(getArenaCollectionPayload(db, "u2").cards.length, 0);
});

test("crafting gear consumes materials and equips output", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 10,
    coins: 3000,
    selectedCard: makeCard(1, "C"),
  });

  for (let index = 0; index < 4; index += 1) {
    buyShopItem(db, "u1", "driftwood_shard");
  }
  for (let index = 0; index < 2; index += 1) {
    buyShopItem(db, "u1", "satchel_cloth");
  }
  buyShopItem(db, "u1", "timber_plank");

  const crafted = craftShopRecipe(db, "u1", "rookie_gear_1");
  assert.equal(crafted.craftedRecipeId, "rookie_gear_1");
  assert.equal(crafted.outputItemId, "rustblade_weapon");
  assert.equal(crafted.craftedQuantity, 1);
  assert.equal(crafted.shop.equipped.weapon?.itemId, "rustblade_weapon");
});

test("owned gear can be re-equipped from inventory", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 20,
    coins: 0,
    selectedCard: makeCard(1, "C"),
  });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_inventory (id, userId, itemId, quantity, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("inventory-rustblade", "u1", "rustblade_weapon", 1, now, now);
  db.prepare(
    `INSERT INTO arena_inventory (id, userId, itemId, quantity, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("inventory-riversteel", "u1", "riversteel_saber", 1, now, now);
  db.prepare(
    `INSERT INTO arena_equipment (userId, slot, itemId, equippedAt)
     VALUES (?, ?, ?, ?)`,
  ).run("u1", "weapon", "riversteel_saber", now);

  const equipped = equipShopItem(db, "u1", "rustblade_weapon");
  assert.equal(equipped.equippedItemId, "rustblade_weapon");
  assert.equal(equipped.slot, "weapon");
  assert.equal(equipped.shop.equipped.weapon?.itemId, "rustblade_weapon");
  assert.equal(
    equipped.shop.shop
      .flatMap((tier) => tier.items)
      .find((item) => item.id === "riversteel_saber")?.ownedQuantity,
    1,
  );
});

test("using consumable applies effect and consumes quantity", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 20,
    coins: 10000,
    selectedCard: makeCard(1, "C"),
  });

  buyShopItem(db, "u1", "driftwood_shard");
  buyShopItem(db, "u1", "driftwood_shard");
  buyShopItem(db, "u1", "timber_plank");
  craftShopRecipe(db, "u1", "rookie_cons_1");

  const useResult = useConsumable(db, "u1", "red_tonic");
  assert.equal(useResult.activatedItemId, "red_tonic");
  assert.equal(useResult.effects.fightStartShieldCharges, 50);
  assert.equal(useResult.effects.fightStartShieldAmount, 20);

  const profile = getArenaProfilePayload(db, "u1");
  assert.equal(profile.effects.fightStartShieldCharges, 50);
  assert.equal(profile.effects.fightStartShieldAmount, 20);
});

test("rich leaderboard sorts by coins then lifetime earned", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 10,
    coins: 500,
    lifetimeCoinsEarned: 1000,
    selectedCard: makeCard(1, "C"),
  });
  insertProfile(db, {
    userId: "u2",
    level: 10,
    coins: 900,
    lifetimeCoinsEarned: 900,
    selectedCard: makeCard(2, "C"),
  });
  insertProfile(db, {
    userId: "u3",
    level: 10,
    coins: 900,
    lifetimeCoinsEarned: 1200,
    selectedCard: makeCard(3, "C"),
  });

  const board = getLeaderboard(db, "rich", 10);
  assert.equal(board.entries[0].user.id, "u3");
  assert.equal(board.entries[1].user.id, "u2");
});

test("daily draw is limited to ten cards per day", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
  });

  for (let index = 0; index < 10; index += 1) {
    const draw = await drawDailyCard(db, "u1");
    assert.ok(draw.card);
    assert.ok(draw.profile.selectedCard);
    assert.equal(draw.profile.dailyDrawLimit, 10);
    assert.equal(draw.profile.dailyDrawsUsed, index + 1);
    assert.equal(draw.profile.dailyDrawsRemaining, Math.max(10 - (index + 1), 0));
  }

  const collection = getArenaCollectionPayload(db, "u1");
  assert.ok(collection.cards.length >= 10);

  await assert.rejects(
    async () => {
      await drawDailyCard(db, "u1");
    },
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_DAILY_DRAW_LIMIT",
  );
});

test("collection card can be selected as active card", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
  });

  const drawResult = await drawDailyCard(db, "u1");
  const card = drawResult.card;
  const switched = selectCollectionCard(db, "u1", card.cardInstanceId);

  assert.equal(switched.selectedCard.cardInstanceId, card.cardInstanceId);
  assert.equal(switched.profile.selectedCard?.cardInstanceId, card.cardInstanceId);
});

test("first player can fight npc fallback when no real opponent", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    selectedCard: makeCard(1, "R"),
  });

  const result = await runFight(db, "u1");
  assert.equal(result.opponent.isNpc, true);
  assert.equal(result.opponent.displayName, "Training Slime");
});
