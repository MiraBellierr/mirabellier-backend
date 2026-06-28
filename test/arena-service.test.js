const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const express = require("express");

const {
  ArenaHttpError,
  __test,
  advancePlaybackFightTurn,
  activateArenaSkill,
  buyArenaMarketListing,
  buyArenaShopCard,
  buyShopItem,
  cancelArenaMarketListing,
  craftShopRecipe,
  calculateRoundPower,
  calculateWinCoins,
  calculateWinXp,
  createArenaMarketListing,
  createArenaTradeListing,
  createArenaUpdate,
  deleteArenaUpdate,
  drawDailyCard,
  equipShopItem,
  getArenaCardShopPayload,
  getArenaArchivePayload,
  getArenaCollectionPayload,
  getArenaMarketListings,
  getArenaProfilePayload,
  getArenaSkillTreePayload,
  getArenaTradeListings,
  getArenaUpdates,
  getLeaderboard,
  getPlaybackFightState,
  acceptTradeRequest,
  confirmTrade,
  normalizeArenaEffects,
  offerCardInTrade,
  rarityFromCharacterRank,
  resolveRoundWinner,
  resetArenaSkills,
  rerollArenaCardShopOffers,
  runFight,
  selectCollectionCard,
  sendTradeRequest,
  startPlaybackFight,
  useConsumable,
  xpToNext,
} = require("../lib/arena-service");
const registerArenaRoutes = require("../routes/arena");
const { initializeSchema } = require("../lib/db");
const { CATALOG_VERSION, SHOP_ITEMS } = require("../lib/arena-constants");

const {
  buildPassiveRuntime,
  calculateAttackOutcome,
  calculateEloExchange,
  chooseEloOpponent,
  consumeTempGuard,
  getCardShopPrice,
  getMarketIvBand,
  getMarketPrice,
  isRandomCardOfferAvailable,
  runPassivesForTrigger,
  simulateFight,
} = __test;

function createTestDb() {
  const db = new Database(":memory:");

  initializeSchema(db);

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
      hp, power, guard, speed, effectHit, lifetimeCoinsEarned,
      eloRating, eloMatches, peakElo,
      selectedCardJson, lastCardDrawDate, dailyCardDrawCount, catalogVersion, effectsJson, lastFightAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    input.effectHit ?? 6,
    input.lifetimeCoinsEarned ?? 0,
    input.eloRating ?? 1000,
    input.eloMatches ?? 0,
    input.peakElo ?? input.eloRating ?? 1000,
    input.selectedCard ? JSON.stringify(input.selectedCard) : null,
    input.lastCardDrawDate ?? null,
    input.dailyCardDrawCount ?? 0,
    input.catalogVersion ?? CATALOG_VERSION,
    JSON.stringify(
      input.effects ?? {
        expBoostPct: 0,
        expBoostWinsRemaining: 0,
        coinBoostPct: 0,
        coinBoostWinsRemaining: 0,
        drawBonusChancePct: 0,
        drawBonusChanceWinsRemaining: 0,
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
      effectHit: 20,
      total: 80,
    },
    drawnAt: new Date().toISOString(),
  };
}

function makeMalCard(id = 1, popularity = Number.MAX_SAFE_INTEGER) {
  return {
    malId: id,
    title: `Card ${id}`,
    url: `https://myanimelist.net/character/${id}`,
    imageUrl: `https://cdn.test/${id}.jpg`,
    meanScore: 8,
    popularity,
    favorites: 10000,
    nsfw: "white",
  };
}

function makeDrawSequence(ids) {
  let index = 0;
  return async () => {
    const id = ids[index % ids.length];
    index += 1;
    return makeMalCard(id);
  };
}

function insertCollectionCardFixture(db, userId, card) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_card_collection (
      id, userId, cardInstanceId, cardJson, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    `collection-${userId}-${card.cardInstanceId}`,
    userId,
    card.cardInstanceId,
    JSON.stringify(card),
    now,
    now,
  );
}

function insertMarketListingFixture(db, input) {
  const card = input.card ?? makeCard(input.malId ?? 1, input.rarity ?? "C");
  const timestamp = input.timestamp ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_market_listings (
      id, sellerUserId, buyerUserId, cardInstanceId, cardJson,
      cardTitle, malId, rarity, ivTotal, ivBand, price, status,
      createdAt, updatedAt, soldAt, cancelledAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.sellerUserId ?? "u1",
    input.buyerUserId ?? null,
    card.cardInstanceId,
    JSON.stringify(card),
    card.title,
    input.malId ?? card.malId,
    input.rarity ?? card.rarity,
    input.ivTotal ?? card.iv.total,
    input.ivBand ?? getMarketIvBand(input.ivTotal ?? card.iv.total).id,
    input.price,
    input.status ?? "active",
    timestamp,
    timestamp,
    input.status === "sold" ? timestamp : null,
    input.status === "cancelled" ? timestamp : null,
  );
}

const PASSIVE_FIXTURES = {
  riversteel_edge: {
    key: "riversteel_edge",
    trigger: "onAttack",
    priority: 10,
    actions: [{ type: "bonusCritChancePct", value: 10 }],
  },
  guard_cap_focus: {
    key: "guard_cap_focus",
    trigger: "onDamageTaken",
    priority: 6,
    actions: [{ type: "grantTempGuard", value: 4, turns: 1, chancePct: 20 }],
  },
  double_strike: {
    key: "double_strike",
    trigger: "onDamageDealt",
    priority: 12,
    actions: [{ type: "extraStrikePct", chancePct: 12, value: 40 }],
  },
  verdant_regen: {
    key: "verdant_regen",
    trigger: "onDamageTaken",
    priority: 7,
    actions: [{ type: "healFlat", value: 4, maxTriggersPerFight: 3 }],
  },
};

function findPassive(key) {
  const passive = PASSIVE_FIXTURES[key];
  assert.ok(passive, `Missing passive fixture: ${key}`);
  return passive;
}

function getConsumableEffect(itemId) {
  const item = SHOP_ITEMS.find((candidate) => candidate.id === itemId);
  assert.equal(item?.type, "consumable", `Missing consumable fixture: ${itemId}`);
  assert.ok(item.consumableEffect, `Missing consumable effect fixture: ${itemId}`);
  return item.consumableEffect;
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
    effectHit: 6,
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
    drawBonusChancePct: 0,
    drawBonusChanceWinsRemaining: 0,
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

function insertEquippedEquipmentPiece(db, userId, input = {}) {
  const now = new Date().toISOString();
  const piece = {
    id: input.id ?? `${userId}-${input.slot ?? "weapon"}-piece`,
    slot: input.slot ?? "weapon",
    mainStatType: input.mainStatType ?? "power",
    mainStatValue: input.mainStatValue ?? 10,
    subStats: input.subStats ?? [],
    createdAt: input.createdAt ?? now,
  };

  db.prepare(
    `INSERT INTO arena_equipment_pieces (
      id, userId, slot, mainStatType, mainStatValue, subStats, equipped, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    piece.id,
    userId,
    piece.slot,
    piece.mainStatType,
    piece.mainStatValue,
    JSON.stringify(piece.subStats),
    piece.createdAt,
  );

  return piece;
}

test("xp formula and reward formulas stay stable", () => {
  assert.equal(xpToNext(1), 105);
  assert.equal(xpToNext(10), 2580);
  assert.equal(calculateWinXp(20, 2, 3), 67);
  assert.equal(calculateWinCoins(20, 12), 130);
});

test("round power includes metadata and rarity modifiers", () => {
  const result = calculateRoundPower({
    power: 10,
    guard: 10,
    speed: 10,
    effectHit: 10,
    equipmentBonus: 5,
    rarity: "SSR",
    card: {
      meanScore: 8,
      popularity: 250,
    },
    randomFn: () => 0.5,
  });

  assert.equal(typeof result.value, "number");
  assert.equal(result.breakdown.rarityPower, 12);
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
    effectHit: 6,
    selectedCard: makeCard(1, "R"),
  });

  const profile = getArenaProfilePayload(db, "u1");
  assert.deepEqual(profile.stats.card, {
    hp: 10,
    power: 6,
    guard: 6,
    speed: 6,
    effectHit: 6,
  });
  assert.deepEqual(profile.stats.total, {
    hp: 130,
    power: 18,
    guard: 18,
    speed: 16,
    effectHit: 12,
  });
});

test("Riversteel applies its critical bonus before attack resolution", () => {
  const selfRuntime = buildPassiveRuntime();
  const mods = runPassivesForTrigger({
    trigger: "onAttack",
    passives: [findPassive("riversteel_edge")],
    selfStats: { power: 10, guard: 10, speed: 10, effectHit: 10 },
    opponentStats: { power: 10, guard: 10, speed: 10, effectHit: 10 },
    selfRuntime,
    opponentRuntime: buildPassiveRuntime(),
    context: { self: {}, opponent: {}, attack: {} },
    randomFn: () => 0.99,
  });

  assert.equal(mods.bonusCritChancePct, 10);
});

test("Guard Cap grants temporary guard without permanently mutating stats", () => {
  const stats = { power: 10, guard: 12, speed: 10, effectHit: 10 };
  const runtime = buildPassiveRuntime();
  runPassivesForTrigger({
    trigger: "onDamageTaken",
    passives: [findPassive("guard_cap_focus")],
    selfStats: stats,
    opponentStats: { power: 10, guard: 10, speed: 10, effectHit: 10 },
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
    selfStats: { power: 10, guard: 10, speed: 10, effectHit: 10 },
    opponentStats: { power: 10, guard: 10, speed: 10, effectHit: 10 },
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
    attackerStats: { power: 30, guard: 10, speed: 10, effectHit: 10 },
    defenderStats: { power: 10, guard: 30, speed: 10, effectHit: 10 },
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

test("potion effects define positive stackable durations", () => {
  const durationByItemId = {
    red_tonic: "charges",
    green_draft: "fights",
    amber_draft: "fights",
    frost_elixir: "fights",
    viridian_elixir: "charges",
    sun_elixir: "charges",
    star_tonic: "fights",
    fuse_bomb: "charges",
    lantern_oil: "charges",
    seeker_lens: "fights",
    oath_ribbon: "fights",
    treasure_cache: "charges",
    prism_draught: "charges",
    sacred_candles: "charges",
    gate_key: "fights",
    chrono_vial: "charges",
  };

  Object.entries(durationByItemId).forEach(([itemId, durationField]) => {
    const effect = getConsumableEffect(itemId);
    assert.ok(
      Number(effect[durationField]) > 0,
      `${itemId} should define positive ${durationField}`,
    );
  });
});

test("legacy active consumable durations are clamped to tactical maxima", () => {
  const effects = normalizeArenaEffects({
    expBoostWinsRemaining: 50,
    coinBoostWinsRemaining: 50,
    rerollKeepHigherCharges: 8,
    streakShieldCharges: 8,
    upgradeLowestRarityCharges: 50,
    guaranteeSsrPlusCharges: 50,
    fightStartShieldCharges: 50,
    evadeBoostFightsRemaining: 50,
    firstHitTrueDamageCharges: 8,
    higherRarityDamageBonusPctCharges: 8,
    gateKeyCharges: 8,
    doublePassiveTriggerFightsRemaining: 8,
  });

  assert.equal(effects.expBoostWinsRemaining, 50);
  assert.equal(effects.coinBoostWinsRemaining, 40);
  assert.equal(effects.rerollKeepHigherCharges, 4);
  assert.equal(effects.streakShieldCharges, 6);
  assert.equal(effects.upgradeLowestRarityCharges, 6);
  assert.equal(effects.guaranteeSsrPlusCharges, 6);
  assert.equal(effects.fightStartShieldCharges, 50);
  assert.equal(effects.evadeBoostFightsRemaining, 50);
  assert.equal(effects.firstHitTrueDamageCharges, 8);
  assert.equal(effects.higherRarityDamageBonusPctCharges, 8);
  assert.equal(effects.gateKeyCharges, 4);
  assert.equal(effects.doublePassiveTriggerFightsRemaining, 8);
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

test("ELO exchange uses provisional and established K factors with a rating floor", () => {
  const provisional = calculateEloExchange(
    { eloRating: 1000, eloMatches: 0 },
    { eloRating: 1000, eloMatches: 0 },
  );
  assert.equal(provisional.kFactor, 48);
  assert.equal(provisional.delta, 24);
  assert.equal(provisional.winnerAfter, 1024);
  assert.equal(provisional.loserAfter, 976);

  const upset = calculateEloExchange(
    { eloRating: 800, eloMatches: 30 },
    { eloRating: 1200, eloMatches: 30 },
  );
  assert.equal(upset.kFactor, 24);
  assert.ok(upset.delta > 12);

  const established = calculateEloExchange(
    { eloRating: 1000, eloMatches: 20 },
    { eloRating: 1000, eloMatches: 20 },
  );
  assert.equal(established.kFactor, 24);
  assert.equal(established.delta, 12);

  const floored = calculateEloExchange(
    { eloRating: 1000, eloMatches: 20 },
    { eloRating: 100, eloMatches: 20 },
  );
  assert.equal(floored.delta, 1);
  assert.equal(floored.loserAfter, 99);
});

test("ELO matchmaking prefers nearby ratings and avoids recent opponents", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    eloRating: 1000,
    selectedCard: makeCard(1, "C"),
  });
  insertProfile(db, {
    userId: "u2",
    eloRating: 1010,
    selectedCard: makeCard(2, "C"),
  });
  insertProfile(db, {
    userId: "u3",
    eloRating: 1300,
    selectedCard: makeCard(3, "C"),
  });

  assert.equal(chooseEloOpponent(db, "u1", () => 0).userId, "u2");

  db.prepare(
    `INSERT INTO arena_fights (
      id, userId, opponentUserId, result, roundsJson, xpDelta, coinDelta, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("recent", "u1", "u2", "win", "[]", 1, 1, new Date().toISOString());

  assert.equal(chooseEloOpponent(db, "u1", () => 0).userId, "u3");
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
    effectHit: 1,
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
    effectHit: 400,
    selectedCard: makeCard(2, "UR"),
  });

  const response = await runFight(db, "u1");
  assert.equal(response.result, "loss");
  assert.ok(response.battle);
  assert.equal(response.rewards.xp, 1);
  assert.equal(response.rewards.coins, 0);
  assert.equal(response.profile.losses, 1);
  assert.equal(response.profile.effects.expBoostWinsRemaining, 50);
  assert.equal(response.profile.effects.coinBoostWinsRemaining, 40);
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
    level: 5,
    selectedCard: makeCard(1, "R"),
  });
  insertProfile(db, {
    userId: "u2",
    level: 5,
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
  assert.equal(persisted.rewards.elo?.rated, true);
  assert.equal(
    persisted.rewards.elo.playerDelta + persisted.rewards.elo.opponentDelta,
    0,
  );
  assert.equal(getArenaProfilePayload(db, "u1").eloMatches, 1);
  assert.equal(getArenaProfilePayload(db, "u2").eloMatches, 1);
  assert.deepEqual(
    [
      getArenaProfilePayload(db, "u1").eloRating,
      getArenaProfilePayload(db, "u2").eloRating,
    ].sort((a, b) => a - b),
    [976, 1024],
  );
  assert.deepEqual(persisted.rewards, fight.rewards);

  const repeated = advancePlaybackFightTurn(db, "u1");
  assert.deepEqual(repeated.rewards, persisted.rewards);
  assert.equal(getArenaProfilePayload(db, "u1").eloMatches, 1);
  assert.equal(getArenaProfilePayload(db, "u2").eloMatches, 1);
});

test("playback fight state finalizes interrupted finished rows", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 5,
    selectedCard: makeCard(1, "R"),
  });
  insertProfile(db, {
    userId: "u2",
    level: 5,
    selectedCard: makeCard(2, "R"),
  });

  const started = await startPlaybackFight(db, "u1");
  const row = db
    .prepare("SELECT simulationJson FROM arena_active_fights WHERE userId = ?")
    .get("u1");
  const simulation = JSON.parse(row.simulationJson);
  delete simulation.rewards;
  db.prepare(
    `UPDATE arena_active_fights
     SET cursor = ?, state = 'finished', simulationJson = ?
     WHERE userId = ?`,
  ).run(started.totalTurns, JSON.stringify(simulation), "u1");

  const resumed = getPlaybackFightState(db, "u1");

  assert.equal(resumed?.isFinished, true);
  assert.ok(resumed?.rewards);
  assert.ok(resumed.rewards.xp >= 1);
  assert.equal(getArenaProfilePayload(db, "u1").eloMatches, 1);
  assert.equal(getArenaProfilePayload(db, "u2").eloMatches, 1);

  const repeated = getPlaybackFightState(db, "u1");
  assert.deepEqual(repeated?.rewards, resumed.rewards);
  assert.equal(getArenaProfilePayload(db, "u1").eloMatches, 1);
  assert.equal(getArenaProfilePayload(db, "u2").eloMatches, 1);
});

test("playback fight state recovers active rows already at the final cursor", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 5,
    selectedCard: makeCard(1, "R"),
  });
  insertProfile(db, {
    userId: "u2",
    level: 5,
    selectedCard: makeCard(2, "R"),
  });

  const started = await startPlaybackFight(db, "u1");
  db.prepare(
    `UPDATE arena_active_fights
     SET cursor = ?, state = 'active'
     WHERE userId = ?`,
  ).run(started.totalTurns, "u1");

  const resumed = getPlaybackFightState(db, "u1");

  assert.equal(resumed?.isFinished, true);
  assert.equal(resumed.cursor, started.totalTurns);
  assert.ok(resumed.rewards);
  assert.equal(getArenaProfilePayload(db, "u1").eloMatches, 1);
  assert.equal(getArenaProfilePayload(db, "u2").eloMatches, 1);

  const repeatedAdvance = advancePlaybackFightTurn(db, "u1");
  assert.deepEqual(repeatedAdvance.rewards, resumed.rewards);
  assert.equal(getArenaProfilePayload(db, "u1").eloMatches, 1);
  assert.equal(getArenaProfilePayload(db, "u2").eloMatches, 1);
});

test("playback fight opponent snapshot includes defender stats, equipment, and effects", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 5,
    selectedCard: makeCard(1, "R"),
  });
  insertProfile(db, {
    userId: "u2",
    level: 5,
    hp: 150,
    power: 40,
    guard: 20,
    speed: 15,
    effectHit: 9,
    effects: makeEffects({
      fightStartShieldCharges: 3,
      fightStartShieldAmount: 40,
      damageBoostPct: 20,
      damageBoostFightsRemaining: 2,
    }),
    selectedCard: makeCard(2, "SR"),
  });
  const piece = insertEquippedEquipmentPiece(db, "u2", {
    id: "u2-live-weapon",
    mainStatType: "power",
    mainStatValue: 17,
    subStats: [
      { type: "speed", value: 5 },
      { type: "defendPct", value: 9 },
    ],
  });

  const fight = await startPlaybackFight(db, "u1");

  assert.equal(fight.opponent.userId, "u2");
  assert.equal(fight.opponent.stats.power, 63);
  assert.equal(fight.opponent.statBreakdown.base.power, 40);
  assert.equal(fight.opponent.statBreakdown.equipment.power, 17);
  assert.equal(fight.opponent.statBreakdown.equipment.speed, 5);
  assert.equal(fight.opponent.statBreakdown.card.power, 6);
  assert.deepEqual(fight.opponent.statBreakdown.total, fight.opponent.stats);
  assert.equal(fight.opponent.equipment.weapon?.id, piece.id);
  assert.equal(fight.opponent.equipmentPct.defendPct, 9);
  assert.equal(fight.opponent.effects.fightStartShieldCharges, 3);
  assert.equal(fight.opponent.effects.damageBoostPct, 20);
  assert.ok(Array.isArray(fight.opponent.activePassives));
});

test("direct fight response exposes the real-time defender snapshot", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 5,
    selectedCard: makeCard(1, "R"),
  });
  insertProfile(db, {
    userId: "u2",
    level: 5,
    power: 32,
    effects: makeEffects({
      speedBoostPct: 12,
      speedBoostFightsRemaining: 1,
    }),
    selectedCard: makeCard(2, "R"),
  });
  insertEquippedEquipmentPiece(db, "u2", {
    id: "u2-direct-armor",
    slot: "armor",
    mainStatType: "guard",
    mainStatValue: 11,
    subStats: [{ type: "hpPct", value: 6 }],
  });

  const result = await runFight(db, "u1");

  assert.equal(result.opponent.userId, "u2");
  assert.equal(result.opponent.stats.power, 38);
  assert.equal(result.opponent.statBreakdown.base.power, 32);
  assert.equal(result.opponent.statBreakdown.equipment.guard, 11);
  assert.equal(result.opponent.equipment.armor?.id, "u2-direct-armor");
  assert.equal(result.opponent.equipmentPct.hpPct, 6);
  assert.equal(result.opponent.effects.speedBoostPct, 12);
  assert.ok(Array.isArray(result.opponent.activePassives));
});

test("defender snapshot reflects changes made before starting a fight", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 5,
    selectedCard: makeCard(1, "R"),
  });
  insertProfile(db, {
    userId: "u2",
    level: 5,
    power: 12,
    effects: makeEffects(),
    selectedCard: makeCard(2, "R"),
  });

  db.prepare(
    `UPDATE arena_profiles
     SET power = ?, effectsJson = ?, updatedAt = ?
     WHERE userId = ?`,
  ).run(
    55,
    JSON.stringify(makeEffects({
      fightStartShieldCharges: 2,
      fightStartShieldAmount: 25,
    })),
    new Date().toISOString(),
    "u2",
  );
  insertEquippedEquipmentPiece(db, "u2", {
    id: "u2-updated-charm",
    slot: "charm",
    mainStatType: "critRate",
    mainStatValue: 8,
    subStats: [{ type: "effectHit", value: 4 }],
  });

  const fight = await startPlaybackFight(db, "u1");

  assert.equal(fight.opponent.statBreakdown.base.power, 55);
  assert.equal(fight.opponent.stats.power, 61);
  assert.equal(fight.opponent.statBreakdown.equipment.effectHit, 4);
  assert.equal(fight.opponent.equipment.charm?.id, "u2-updated-charm");
  assert.equal(fight.opponent.equipmentPct.critChancePct, 8);
  assert.equal(fight.opponent.effects.fightStartShieldAmount, 25);
});

test("defender consumable effects are not consumed by defensive fights", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 5,
    selectedCard: makeCard(1, "R"),
  });
  insertProfile(db, {
    userId: "u2",
    level: 5,
    effects: makeEffects({
      fightStartShieldCharges: 4,
      fightStartShieldAmount: 50,
      deathSaveCharges: 1,
    }),
    selectedCard: makeCard(2, "R"),
  });

  let fight = await startPlaybackFight(db, "u1");
  while (!fight.isFinished) {
    fight = advancePlaybackFightTurn(db, "u1");
  }

  const defender = getArenaProfilePayload(db, "u2");
  assert.equal(defender.effects.fightStartShieldCharges, 4);
  assert.equal(defender.effects.fightStartShieldAmount, 50);
  assert.equal(defender.effects.deathSaveCharges, 1);
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

test("buying card shop card consumes coins", async () => {
  const db = createTestDb();
  const startingCoins = 20000;
  insertProfile(db, {
    userId: "u1",
    level: 10,
    coins: startingCoins,
    selectedCard: makeCard(1, "C"),
  });

  const cardShop = await getArenaCardShopPayload(db, "u1", {
    recordedDate: "2099-01-01",
  });
  const offer = cardShop.dailyOffers[0];
  assert.ok(offer, "expected a card offer");

  const buyResult = await buyArenaShopCard(db, "u1", { kind: "daily", offerId: offer.offerId }, { recordedDate: "2099-01-01" });
  assert.equal(buyResult.purchasedOfferId, offer.offerId);
  assert.ok(buyResult.profile.coins < startingCoins);
});

test("card shop shares five unique daily offers and refreshes by UTC date", async () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", coins: 5000 });
  insertProfile(db, { userId: "u2", coins: 5000 });

  const first = await getArenaCardShopPayload(db, "u1", {
    recordedDate: "2099-01-05",
  });
  const second = await getArenaCardShopPayload(db, "u2", {
    recordedDate: "2099-01-05",
  });
  const nextDay = await getArenaCardShopPayload(db, "u1", {
    recordedDate: "2099-01-06",
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
  assert.equal(first.nextRefreshAt, "2099-01-06T00:00:00.000Z");
  assert.equal(nextDay.offerDate, "2099-01-06");
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

test("random card offer follows the configured weekday schedule", async () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", coins: 1000 });

  assert.equal(isRandomCardOfferAvailable("2026-06-23"), true);
  assert.equal(isRandomCardOfferAvailable("2026-06-24"), false);
  const available = await getArenaCardShopPayload(db, "u1", {
    recordedDate: "2026-06-23",
  });
  const unavailable = await getArenaCardShopPayload(db, "u1", {
    recordedDate: "2026-06-24",
  });
  assert.equal(available.randomOffer?.price, 2500);
  assert.equal(available.randomOffer?.endsAt, "2026-06-24T00:00:00.000Z");
  assert.equal(unavailable.randomOffer, null);
  await assert.rejects(
    () =>
      buyArenaShopCard(
        db,
        "u1",
        { kind: "random" },
        { recordedDate: "2026-06-24" },
      ),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_RANDOM_CARD_NOT_TODAY",
  );
  assert.equal(getArenaProfilePayload(db, "u1").coins, 1000);
});

test("daily card purchases are limited to once per user and preserve selected card", async () => {
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

  const shop = await getArenaCardShopPayload(db, "u1", {
    recordedDate: "2099-02-01",
    drawCard: makeDrawSequence([1, 2, 3, 4, 5]),
  });
  const offer = shop.dailyOffers[0];
  const firstPurchase = await buyArenaShopCard(db, "u1", {
    kind: "daily",
    offerId: offer.offerId,
  }, {
    recordedDate: "2099-02-01",
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
      }, {
        recordedDate: "2099-02-01",
      }),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_CARD_SHOP_ALREADY_SOLD",
  );

  const otherAccountShop = await getArenaCardShopPayload(db, "u2", {
    recordedDate: "2099-02-01",
  });
  assert.equal(
    otherAccountShop.dailyOffers.find(
      (candidate) => candidate.offerId === offer.offerId,
    )?.sold,
    false,
  );
  const secondPurchase = await buyArenaShopCard(db, "u2", {
    kind: "daily",
    offerId: offer.offerId,
  }, {
    recordedDate: "2099-02-01",
  });

  assert.equal(secondPurchase.purchasedOfferId, offer.offerId);
  assert.equal(
    secondPurchase.cardShop.dailyOffers.find(
      (candidate) => candidate.offerId === offer.offerId,
    )?.sold,
    true,
  );
});

test("admin reroll replaces today's global card shop offers", async () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", coins: 5000 });
  insertProfile(db, { userId: "u2", coins: 5000 });

  const initial = await getArenaCardShopPayload(db, "u1", {
    recordedDate: "2099-03-01",
    drawCard: makeDrawSequence([1, 2, 3, 4, 5]),
  });
  const initialMalIds = initial.dailyOffers.map((offer) => offer.card.malId);
  await buyArenaShopCard(db, "u1", {
    kind: "daily",
    offerId: initial.dailyOffers[0].offerId,
  }, {
    recordedDate: "2099-03-01",
  });

  const rerolled = await rerollArenaCardShopOffers(db, {
    recordedDate: "2099-03-01",
    drawCard: makeDrawSequence([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  });
  const rerolledMalIds = rerolled.dailyOffers.map((offer) => offer.card.malId);

  assert.equal(rerolled.offerDate, "2099-03-01");
  assert.equal(rerolled.deletedOffers, 5);
  assert.equal(rerolled.deletedPurchases, 1);
  assert.deepEqual(rerolledMalIds, [6, 7, 8, 9, 10]);
  assert.ok(
    rerolledMalIds.every((malId) => !initialMalIds.includes(malId)),
  );

  const shopAfterReroll = await getArenaCardShopPayload(db, "u2", {
    recordedDate: "2099-03-01",
  });
  assert.equal(shopAfterReroll.dailyOffers.length, 5);
  assert.ok(shopAfterReroll.dailyOffers.every((offer) => !offer.sold));
});

test("random card purchases remain available and failures never charge coins", async () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", coins: 6250 });
  insertProfile(db, { userId: "u2", coins: 3000 });
  insertProfile(db, { userId: "u3", coins: 2500 });

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
    { recordedDate: "2026-06-23", drawCard: drawCommonCard },
  );
  const second = await buyArenaShopCard(
    db,
    "u1",
    { kind: "random" },
    { recordedDate: "2026-06-23", drawCard: drawCommonCard },
  );
  assert.equal(first.cards.length, 5);
  assert.ok(first.cards.every((card) => card.rarity === "C"));
  assert.equal(first.pricePaid, 2500);
  assert.equal(second.profile.coins, 1250);
  assert.notEqual(first.cards[0].cardInstanceId, second.cards[0].cardInstanceId);
  assert.equal(getArenaCollectionPayload(db, "u1").cards.length, 10);

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
      error.code === "ARENA_NOT_ENOUGH_COINS" &&
      error.details.requiredCoins === 2500,
  );
  assert.equal(getArenaProfilePayload(db, "u1").coins, 1250);
  assert.equal(getArenaCollectionPayload(db, "u1").cards.length, 10);

  const ultraRare = await buyArenaShopCard(
    db,
    "u3",
    { kind: "random" },
    {
      recordedDate: "2026-06-23",
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
  assert.equal(ultraRare.cards.length, 5);
  assert.ok(ultraRare.cards.every((card) => card.rarity === "UR"));
  assert.equal(ultraRare.pricePaid, 2500);
  assert.equal(getArenaProfilePayload(db, "u3").coins, 0);
  assert.equal(getArenaCollectionPayload(db, "u3").cards.length, 5);

  await assert.rejects(
    () =>
      buyArenaShopCard(
        db,
        "u2",
        { kind: "random" },
        {
          recordedDate: "2026-06-23",
          drawCard: async () => {
            throw new Error("source unavailable");
          },
        },
      ),
    /source unavailable/,
  );
  assert.equal(getArenaProfilePayload(db, "u2").coins, 3000);
  assert.equal(getArenaCollectionPayload(db, "u2").cards.length, 0);
});

test("buying rolled gear consumes coins and stores an equipment piece", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 10,
    coins: 3000,
    selectedCard: makeCard(1, "C"),
  });

  const bought = buyShopItem(db, "u1", "weapon_roll");
  assert.equal(bought.purchasedItemId, "weapon_roll");
  assert.ok(bought.rolledPieceId);
  assert.equal(bought.rolledPiece.slot, "weapon");
  assert.ok(bought.shop.profile.coins < 3000);
  assert.ok(
    bought.shop.profile.equipmentPieces.some(
      (piece) => piece.id === bought.rolledPieceId && piece.slot === "weapon",
    ),
  );
});

test("owned rolled gear can be re-equipped from inventory", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 20,
    coins: 3000,
    selectedCard: makeCard(1, "C"),
  });

  const first = buyShopItem(db, "u1", "weapon_roll");
  const second = buyShopItem(db, "u1", "weapon_roll");
  equipShopItem(db, "u1", second.rolledPieceId);

  const equipped = equipShopItem(db, "u1", first.rolledPieceId);
  assert.equal(equipped.equippedPieceId, first.rolledPieceId);
  assert.equal(equipped.slot, "weapon");
  assert.equal(equipped.shop.equipped.weapon?.id, first.rolledPieceId);
  assert.ok(
    equipped.shop.profile.equipmentPieces.some(
      (piece) => piece.id === second.rolledPieceId && piece.equipped === false,
    ),
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

  craftShopRecipe(db, "u1", "rookie_cons_1");

  const useResult = useConsumable(db, "u1", "red_tonic");
  const effect = getConsumableEffect("red_tonic");
  assert.equal(useResult.activatedItemId, "red_tonic");
  assert.equal(useResult.effects.fightStartShieldCharges, effect.charges);
  assert.equal(useResult.effects.fightStartShieldAmount, effect.amount);

  const profile = getArenaProfilePayload(db, "u1");
  assert.equal(profile.effects.fightStartShieldCharges, effect.charges);
  assert.equal(profile.effects.fightStartShieldAmount, effect.amount);
});

test("Berserker's Brew applies +20% damage boost", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "rookie_cons_2");
  const effect = getConsumableEffect("green_draft");
  const result = useConsumable(db, "u1", "green_draft");
  assert.equal(result.effects.damageBoostPct, effect.pct);
  assert.equal(result.effects.damageBoostFightsRemaining, effect.fights);
});

test("Scout's Whistle applies +12% speed boost", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "rookie_cons_3");
  const effect = getConsumableEffect("amber_draft");
  const result = useConsumable(db, "u1", "amber_draft");
  assert.equal(result.effects.speedBoostPct, effect.pct);
  assert.equal(result.effects.speedBoostFightsRemaining, effect.fights);
});

test("Phoenix Feather applies death save charges", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "silver_cons_1");
  const effect = getConsumableEffect("sun_elixir");
  const result = useConsumable(db, "u1", "sun_elixir");
  assert.equal(result.effects.deathSaveCharges, effect.charges);
});

test("Titan Draught applies +15% all stats", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "silver_cons_2");
  const effect = getConsumableEffect("star_tonic");
  const result = useConsumable(db, "u1", "star_tonic");
  assert.equal(result.effects.statSteroidPct, effect.pct);
  assert.equal(result.effects.statSteroidFightsRemaining, effect.fights);
});

test("Seeker Lens applies +20% crit chance", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 30, coins: 100000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "gold_cons_1");
  const effect = getConsumableEffect("seeker_lens");
  const result = useConsumable(db, "u1", "seeker_lens");
  assert.equal(result.effects.critChanceBoostPct, effect.pct);
  assert.equal(result.effects.critChanceBoostFightsRemaining, effect.fights);
});

test("Oath Ribbon applies +15% guard boost", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 30, coins: 100000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "gold_cons_2");
  const effect = getConsumableEffect("oath_ribbon");
  const result = useConsumable(db, "u1", "oath_ribbon");
  assert.equal(result.effects.guardBoostPct, effect.pct);
  assert.equal(result.effects.guardBoostFightsRemaining, effect.fights);
});

test("Arcane Mirror applies match rarity charges", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 30, coins: 100000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "gold_cons_3");
  const effect = getConsumableEffect("treasure_cache");
  const result = useConsumable(db, "u1", "treasure_cache");
  assert.equal(result.effects.matchRarityCharges, effect.charges);
});

test("Prism Draught applies first attack double charges", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 50, coins: 100000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "mythic_cons_1");
  const effect = getConsumableEffect("prism_draught");
  const result = useConsumable(db, "u1", "prism_draught");
  assert.equal(result.effects.firstAttackDoubleCharges, effect.charges);
});

test("Vampiric Fang applies 20% lifesteal", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 50, coins: 100000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "mythic_cons_3");
  const effect = getConsumableEffect("gate_key");
  const result = useConsumable(db, "u1", "gate_key");
  assert.equal(result.effects.vampiricHealPct, effect.pct);
  assert.equal(result.effects.vampiricHealFightsRemaining, effect.fights);
});

test("Fuse Bomb deals +100 true damage", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "bronze_cons_3");
  const effect = getConsumableEffect("fuse_bomb");
  const result = useConsumable(db, "u1", "fuse_bomb");
  assert.equal(result.effects.firstHitTrueDamageValue, effect.value);
  assert.equal(result.effects.firstHitTrueDamageCharges, effect.charges);
});

test("Lantern Oil applies +50% damage vs higher rarity", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "silver_cons_3");
  const effect = getConsumableEffect("lantern_oil");
  const result = useConsumable(db, "u1", "lantern_oil");
  assert.equal(result.effects.higherRarityDamageBonusPct, effect.pct);
  assert.equal(result.effects.higherRarityDamageBonusPctCharges, effect.charges);
});

test("Phoenix Feather prevents KO in combat", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 20,
    coins: 10000,
    selectedCard: makeCard(1, "C"),
  });
  const player = getArenaProfilePayload(db, "u1");
  const opponent = makeCombatSnapshot({ id: 2, stats: { power: 200, speed: 200 } });
  const result = await simulateFight(db, { player, opponent, playerEffects: { deathSaveCharges: 1 }, randomFn: () => 0.5 });
  // With death save, player should survive even with overpowered opponent
  assert.equal(result.effectUsage.usedDeathSave, true);
});

test("Vampiric Fang heals player on successful hit", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 20,
    coins: 10000,
    selectedCard: makeCard(1, "C"),
  });
  const player = getArenaProfilePayload(db, "u1");
  const opponent = makeCombatSnapshot({ id: 2, stats: { power: 1, speed: 1, guard: 0 } });
  const result = await simulateFight(db, { player, opponent, playerEffects: { vampiricHealPct: 20, vampiricHealFightsRemaining: 1 }, randomFn: () => 0.99 });
  assert.equal(result.effectUsage.usedVampiricHeal, true);
});

test("Berserker's Brew applies damage boost in combat", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 20,
    coins: 10000,
    selectedCard: makeCard(1, "C"),
  });
  const player = getArenaProfilePayload(db, "u1");
  const opponent = makeCombatSnapshot({ id: 2, stats: { power: 1, speed: 1, guard: 0 } });
  const result = await simulateFight(db, { player, opponent, playerEffects: { damageBoostPct: 20, damageBoostFightsRemaining: 1 }, randomFn: () => 0.99 });
  assert.equal(result.effectUsage.usedDamageBoost, true);
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

test("ELO leaderboard sorts by rating, matches, and peak rating", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    eloRating: 1200,
    eloMatches: 10,
    peakElo: 1250,
    selectedCard: makeCard(1, "C"),
  });
  insertProfile(db, {
    userId: "u2",
    eloRating: 1200,
    eloMatches: 25,
    peakElo: 1220,
    selectedCard: makeCard(2, "C"),
  });
  insertProfile(db, {
    userId: "u3",
    eloRating: 1100,
    eloMatches: 30,
    peakElo: 1300,
    selectedCard: makeCard(3, "C"),
  });

  const board = getLeaderboard(db, "elo", 10);
  assert.equal(board.entries[0].user.id, "u2");
  assert.equal(board.entries[0].eloProvisional, false);
  assert.equal(board.entries[1].user.id, "u1");
  assert.equal(board.entries[1].eloProvisional, false);
  assert.equal(board.entries[2].user.id, "u3");
});

test("daily draw is limited to ten cards per day", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
  });

  for (let index = 0; index < 10; index += 1) {
    const draw = await drawDailyCard(db, "u1");
    assert.ok(draw.card);
    assert.equal(draw.profile.selectedCard, null);
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

test("market IV totals map to the four configured bands", () => {
  assert.equal(getMarketIvBand(0).id, "0-31");
  assert.equal(getMarketIvBand(31).id, "0-31");
  assert.equal(getMarketIvBand(32).id, "32-62");
  assert.equal(getMarketIvBand(62).id, "32-62");
  assert.equal(getMarketIvBand(63).id, "63-93");
  assert.equal(getMarketIvBand(93).id, "63-93");
  assert.equal(getMarketIvBand(94).id, "94-124");
  assert.equal(getMarketIvBand(124).id, "94-124");
});

test("arena updates are validated, listed newest first, and deletable", () => {
  const db = createTestDb();
  assert.throws(
    () => createArenaUpdate(db, "u1", { title: "", body: "Message" }),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_UPDATE_TITLE_REQUIRED",
  );
  const first = createArenaUpdate(db, "u1", {
    title: "First update",
    body: "Arena is open.",
  });
  const second = createArenaUpdate(db, "u1", {
    title: "Second update",
    body: "The market is live.",
  });
  const updates = getArenaUpdates(db, { limit: 5 });
  assert.equal(updates.length, 2);
  assert.equal(updates[0].id, second.id);
  assert.equal(updates[1].id, first.id);
  assert.deepEqual(deleteArenaUpdate(db, first.id), {
    deletedUpdateId: first.id,
  });
  assert.equal(getArenaUpdates(db).length, 1);
  assert.throws(
    () => deleteArenaUpdate(db, first.id),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_UPDATE_NOT_FOUND",
  );
});

test("market price averages only the latest 30 matching completed sales", () => {
  const db = createTestDb();
  for (let index = 1; index <= 35; index += 1) {
    insertMarketListingFixture(db, {
      id: `sold-${index}`,
      card: { ...makeCard(1, "SR"), cardInstanceId: `sold-card-${index}` },
      malId: 1,
      ivTotal: 80,
      ivBand: "63-93",
      price: index,
      status: "sold",
      timestamp: new Date(Date.UTC(2026, 0, index)).toISOString(),
    });
  }
  insertMarketListingFixture(db, {
    id: "active-outlier",
    card: { ...makeCard(1, "SR"), cardInstanceId: "active-outlier-card" },
    malId: 1,
    ivTotal: 80,
    price: 999999,
    status: "active",
  });
  insertMarketListingFixture(db, {
    id: "cancelled-outlier",
    card: { ...makeCard(1, "SR"), cardInstanceId: "cancelled-outlier-card" },
    malId: 1,
    ivTotal: 80,
    price: 999999,
    status: "cancelled",
  });

  assert.deepEqual(getMarketPrice(db, 1, "63-93", "SR"), {
    value: 21,
    source: "sales_average",
    sampleSize: 30,
  });
  assert.deepEqual(getMarketPrice(db, 2, "63-93", "SR"), {
    value: getCardShopPrice("SR"),
    source: "shop_baseline",
    sampleSize: 0,
  });
});

test("listing moves a card into escrow and clears it when selected", () => {
  const db = createTestDb();
  const card = makeCard(1, "R");
  insertProfile(db, {
    userId: "u1",
    selectedCard: card,
  });
  insertCollectionCardFixture(db, "u1", card);

  const result = createArenaMarketListing(db, "u1", {
    cardInstanceId: card.cardInstanceId,
    price: 250,
  });

  assert.equal(result.listing.status, "active");
  assert.equal(result.listing.price, 250);
  assert.equal(result.profile.selectedCard, null);
  assert.equal(getArenaCollectionPayload(db, "u1").cards.length, 0);
  assert.throws(
    () => selectCollectionCard(db, "u1", card.cardInstanceId),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_COLLECTION_CARD_NOT_FOUND",
  );
});

test("listing validates price, active fights, and seller listing limits", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1" });
  const card = makeCard(1, "R");
  insertCollectionCardFixture(db, "u1", card);

  assert.throws(
    () =>
      createArenaMarketListing(db, "u1", {
        cardInstanceId: card.cardInstanceId,
        price: 1.5,
      }),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_MARKET_PRICE_INVALID",
  );

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_active_fights (
      userId, fightId, cursor, state, simulationJson, opponentJson,
      playerEffectsJson, createdAt, updatedAt
    ) VALUES (?, ?, 0, 'active', '{}', '{}', '{}', ?, ?)`,
  ).run("u1", "fight-active", now, now);
  assert.throws(
    () =>
      createArenaMarketListing(db, "u1", {
        cardInstanceId: card.cardInstanceId,
        price: 100,
      }),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_MARKET_FIGHT_ACTIVE",
  );
  db.prepare("DELETE FROM arena_active_fights WHERE userId = ?").run("u1");

  for (let index = 0; index < 20; index += 1) {
    insertMarketListingFixture(db, {
      id: `active-${index}`,
      card: {
        ...makeCard(index + 10, "C"),
        cardInstanceId: `active-card-${index}`,
      },
      sellerUserId: "u1",
      price: 10 + index,
      status: "active",
    });
  }
  assert.throws(
    () =>
      createArenaMarketListing(db, "u1", {
        cardInstanceId: card.cardInstanceId,
        price: 100,
      }),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_MARKET_LISTING_LIMIT",
  );
});

test("cancelling restores the same card without reselecting it", () => {
  const db = createTestDb();
  const card = makeCard(1, "SSR");
  insertProfile(db, { userId: "u1", selectedCard: card });
  insertProfile(db, { userId: "u2" });
  insertCollectionCardFixture(db, "u1", card);
  const created = createArenaMarketListing(db, "u1", {
    cardInstanceId: card.cardInstanceId,
    price: 5000,
  });

  assert.throws(
    () => cancelArenaMarketListing(db, "u2", created.listing.listingId),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_MARKET_NOT_SELLER",
  );
  const cancelled = cancelArenaMarketListing(
    db,
    "u1",
    created.listing.listingId,
  );
  const restored = getArenaCollectionPayload(db, "u1");
  assert.equal(cancelled.listing.status, "cancelled");
  assert.equal(restored.profile.selectedCard, null);
  assert.equal(restored.cards[0].cardInstanceId, card.cardInstanceId);
  assert.deepEqual(restored.cards[0].iv, card.iv);
});

test("buying transfers ownership and coins without inflating lifetime earnings", () => {
  const db = createTestDb();
  const card = makeCard(1, "UR");
  insertProfile(db, {
    userId: "u1",
    coins: 100,
    lifetimeCoinsEarned: 777,
  });
  insertProfile(db, {
    userId: "u2",
    coins: 1000,
    lifetimeCoinsEarned: 888,
  });
  insertProfile(db, {
    userId: "u3",
    coins: 10,
  });
  insertCollectionCardFixture(db, "u1", card);
  const created = createArenaMarketListing(db, "u1", {
    cardInstanceId: card.cardInstanceId,
    price: 600,
  });

  assert.throws(
    () => buyArenaMarketListing(db, "u1", created.listing.listingId),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_MARKET_SELF_PURCHASE",
  );
  assert.throws(
    () => buyArenaMarketListing(db, "u3", created.listing.listingId),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_NOT_ENOUGH_COINS",
  );
  const bought = buyArenaMarketListing(db, "u2", created.listing.listingId);
  const seller = getArenaProfilePayload(db, "u1");
  const buyer = getArenaProfilePayload(db, "u2");
  assert.equal(bought.listing.status, "sold");
  assert.equal(bought.listing.buyerUserId, "u2");
  assert.equal(seller.coins, 700);
  assert.equal(buyer.coins, 400);
  assert.equal(seller.lifetimeCoinsEarned, 777);
  assert.equal(buyer.lifetimeCoinsEarned, 888);
  assert.equal(getArenaCollectionPayload(db, "u1").cards.length, 0);
  assert.equal(
    getArenaCollectionPayload(db, "u2").cards[0].cardInstanceId,
    card.cardInstanceId,
  );
  assert.throws(
    () => buyArenaMarketListing(db, "u3", created.listing.listingId),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_MARKET_LISTING_INACTIVE",
  );
});

test("market listing query filters and paginates active listings", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1" });
  insertMarketListingFixture(db, {
    id: "listing-a",
    card: makeCard(1, "R"),
    rarity: "R",
    price: 300,
    status: "active",
  });
  insertMarketListingFixture(db, {
    id: "listing-b",
    card: makeCard(2, "SR"),
    rarity: "SR",
    price: 200,
    status: "active",
  });
  insertMarketListingFixture(db, {
    id: "listing-cancelled",
    card: makeCard(3, "SR"),
    rarity: "SR",
    price: 100,
    status: "cancelled",
  });

  const payload = getArenaMarketListings(db, "u1", {
    rarity: "SR",
    sort: "price-asc",
    page: 1,
    limit: 1,
  });
  assert.equal(payload.total, 1);
  assert.equal(payload.listings.length, 1);
  assert.equal(payload.listings[0].listingId, "listing-b");
  assert.equal(payload.listings[0].marketPrice.source, "shop_baseline");
});

test("trade listings can request a specific card", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", coins: 1000 });
  insertProfile(db, { userId: "u2", coins: 1000 });

  const listedCard = makeCard(21, "SR");
  const wrongOffer = makeCard(88, "R");
  const matchingOffer = { ...makeCard(1, "R"), cardInstanceId: "card-1-u2" };
  insertCollectionCardFixture(db, "u1", listedCard);
  insertCollectionCardFixture(db, "u2", wrongOffer);
  insertCollectionCardFixture(db, "u2", matchingOffer);

  const created = createArenaTradeListing(db, "u1", {
    cardInstanceId: listedCard.cardInstanceId,
    wantedCardMalId: matchingOffer.malId,
    wantedRarity: "R",
  });
  assert.equal(created.listing.wantedCard.malId, matchingOffer.malId);

  const listings = getArenaTradeListings(db, "u2");
  assert.equal(listings.listings[0].wantedCard.malId, matchingOffer.malId);

  assert.throws(
    () =>
      sendTradeRequest(
        db,
        "u2",
        "u1",
        wrongOffer.cardInstanceId,
        { listingId: created.listing.id },
      ),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_TRADE_WANTED_CARD_REQUIRED",
  );

  const request = sendTradeRequest(
    db,
    "u2",
    "u1",
    matchingOffer.cardInstanceId,
    { listingId: created.listing.id },
  );
  assert.ok(request.requestId);
  const row = db
    .prepare("SELECT listingId, askerCardInstanceId FROM arena_trade_requests WHERE id = ?")
    .get(request.requestId);
  assert.equal(row.listingId, created.listing.id);
  assert.equal(row.askerCardInstanceId, matchingOffer.cardInstanceId);
});

test("accepting a listing trade with both cards opens an active session", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", coins: 1000 });
  insertProfile(db, { userId: "u2", coins: 1000 });

  const listedCard = makeCard(21, "SR");
  const offeredCard = { ...makeCard(1, "R"), cardInstanceId: "card-1-u2" };
  insertCollectionCardFixture(db, "u1", listedCard);
  insertCollectionCardFixture(db, "u2", offeredCard);

  const listing = createArenaTradeListing(db, "u1", {
    cardInstanceId: listedCard.cardInstanceId,
    wantedCardMalId: offeredCard.malId,
  });
  const request = sendTradeRequest(
    db,
    "u2",
    "u1",
    offeredCard.cardInstanceId,
    { listingId: listing.listing.id },
  );

  const accepted = acceptTradeRequest(db, "u1", request.requestId);
  assert.ok(accepted.sessionId);

  const session = db
    .prepare("SELECT * FROM arena_trade_sessions WHERE id = ?")
    .get(accepted.sessionId);
  assert.equal(session.status, "active");
  assert.equal(session.askerId, "u2");
  assert.equal(session.responderId, "u1");
  assert.deepEqual(JSON.parse(session.askerCardInstanceIdsJson), [
    offeredCard.cardInstanceId,
  ]);
  assert.deepEqual(JSON.parse(session.responderCardInstanceIdsJson), [
    listedCard.cardInstanceId,
  ]);
  assert.ok(
    db
      .prepare("SELECT id FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ?")
      .get("u1", listedCard.cardInstanceId),
  );
  assert.equal(
    db
      .prepare("SELECT status FROM arena_trade_listings WHERE id = ?")
      .get(listing.listing.id).status,
    "cancelled",
  );
});

test("trade session offer changes reset both confirmations", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", coins: 1000 });
  insertProfile(db, { userId: "u2", coins: 1000 });

  const askerCard = makeCard(31, "SR");
  const firstResponderCard = makeCard(32, "SR");
  const replacementResponderCard = makeCard(33, "SSR");
  insertCollectionCardFixture(db, "u1", askerCard);
  insertCollectionCardFixture(db, "u2", firstResponderCard);
  insertCollectionCardFixture(db, "u2", replacementResponderCard);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_trade_sessions (
      id, requestId, askerId, responderId, askerCardInstanceId, responderCardInstanceId,
      askerConfirmed, responderConfirmed, status, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 'active', ?, ?)`,
  ).run(
    "session-confirm-reset",
    "request-confirm-reset",
    "u1",
    "u2",
    askerCard.cardInstanceId,
    firstResponderCard.cardInstanceId,
    now,
    now,
  );

  const changed = offerCardInTrade(
    db,
    "u2",
    "session-confirm-reset",
    replacementResponderCard.cardInstanceId,
  );

  assert.equal(changed.askerConfirmed, false);
  assert.equal(changed.responderConfirmed, false);
  assert.deepEqual(
    changed.responderCards.map((card) => card.cardInstanceId).sort(),
    [firstResponderCard.cardInstanceId, replacementResponderCard.cardInstanceId].sort(),
  );

  const afterResponderConfirm = confirmTrade(db, "u2", "session-confirm-reset");
  assert.equal(afterResponderConfirm.status, "active");
  assert.equal(afterResponderConfirm.askerConfirmed, false);
  assert.equal(afterResponderConfirm.responderConfirmed, true);
  assert.ok(
    db.prepare("SELECT id FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ?")
      .get("u1", askerCard.cardInstanceId),
  );
  assert.ok(
    db.prepare("SELECT id FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ?")
      .get("u2", replacementResponderCard.cardInstanceId),
  );
  assert.ok(
    db.prepare("SELECT id FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ?")
      .get("u2", firstResponderCard.cardInstanceId),
  );
});

test("completed trade session clears both traded selected cards", () => {
  const db = createTestDb();
  const askerCard = makeCard(41, "SSR");
  const responderCard = makeCard(42, "SSR");
  insertProfile(db, { userId: "u1", coins: 1000, selectedCard: askerCard });
  insertProfile(db, { userId: "u2", coins: 1000, selectedCard: responderCard });
  insertCollectionCardFixture(db, "u1", askerCard);
  insertCollectionCardFixture(db, "u2", responderCard);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_trade_sessions (
      id, requestId, askerId, responderId, askerCardInstanceId, responderCardInstanceId,
      askerConfirmed, responderConfirmed, status, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 'active', ?, ?)`,
  ).run(
    "session-selected-clear",
    "request-selected-clear",
    "u1",
    "u2",
    askerCard.cardInstanceId,
    responderCard.cardInstanceId,
    now,
    now,
  );

  const completed = confirmTrade(db, "u2", "session-selected-clear");

  assert.equal(completed.status, "completed");
  assert.equal(
    db.prepare("SELECT selectedCardJson FROM arena_profiles WHERE userId = ?").get("u1").selectedCardJson,
    null,
  );
  assert.equal(
    db.prepare("SELECT selectedCardJson FROM arena_profiles WHERE userId = ?").get("u2").selectedCardJson,
    null,
  );
});

test("completed trade session transfers multiple offered cards", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", coins: 1000 });
  insertProfile(db, { userId: "u2", coins: 1000 });

  const askerCardOne = makeCard(51, "SR");
  const askerCardTwo = makeCard(52, "SSR");
  const responderCardOne = makeCard(53, "R");
  insertCollectionCardFixture(db, "u1", askerCardOne);
  insertCollectionCardFixture(db, "u1", askerCardTwo);
  insertCollectionCardFixture(db, "u2", responderCardOne);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_trade_sessions (
      id, requestId, askerId, responderId,
      askerCardInstanceId, responderCardInstanceId,
      askerCardInstanceIdsJson, responderCardInstanceIdsJson,
      askerConfirmed, responderConfirmed, status, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'active', ?, ?)`,
  ).run(
    "session-multi-complete",
    "request-multi-complete",
    "u1",
    "u2",
    askerCardOne.cardInstanceId,
    responderCardOne.cardInstanceId,
    JSON.stringify([askerCardOne.cardInstanceId, askerCardTwo.cardInstanceId]),
    JSON.stringify([responderCardOne.cardInstanceId]),
    now,
    now,
  );

  const completed = confirmTrade(db, "u2", "session-multi-complete");

  assert.equal(completed.status, "completed");
  assert.deepEqual(
    completed.askerCards.map((card) => card.cardInstanceId).sort(),
    [askerCardOne.cardInstanceId, askerCardTwo.cardInstanceId].sort(),
  );
  assert.deepEqual(
    completed.responderCards.map((card) => card.cardInstanceId),
    [responderCardOne.cardInstanceId],
  );
  for (const card of [askerCardOne, askerCardTwo]) {
    assert.ok(
      db.prepare("SELECT id FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ?")
        .get("u2", card.cardInstanceId),
    );
  }
  assert.ok(
    db.prepare("SELECT id FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ?")
      .get("u1", responderCardOne.cardInstanceId),
  );
});

test("arena archive searches character names", () => {
  const db = createTestDb();
  const payload = getArenaArchivePayload(db, "u1", { search: "Faye Valentine", perPage: 10 });

  assert.ok(payload.total >= 1);
  assert.ok(payload.cards.some((card) => card.title === "Valentine, Faye"));
  const card = payload.cards.find((entry) => entry.title === "Valentine, Faye");
  assert.equal(card.iv.total, 0);
  assert.equal(card.drawnAt, null);
});

test("arena archive searches all appearance titles", () => {
  const db = createTestDb();
  const payload = getArenaArchivePayload(db, "u1", {
    search: "The Movie",
    perPage: 100,
  });

  assert.ok(payload.cards.some((card) => card.title === "Valentine, Faye"));
});

test("arena archive paginates catalog order by default", () => {
  const db = createTestDb();
  const payload = getArenaArchivePayload(db, "u1", { page: 1, perPage: 3 });

  assert.equal(payload.page, 1);
  assert.equal(payload.perPage, 3);
  assert.equal(payload.cards.length, 3);
  assert.ok(payload.total > 3);
  assert.ok(payload.totalPages > 1);
});

test("arena archive filters owned and not-owned catalog cards", () => {
  const db = createTestDb();
  const searchPayload = getArenaArchivePayload(db, "u1", {
    search: "Faye Valentine",
    perPage: 10,
  });
  const faye = searchPayload.cards.find((card) => card.title === "Valentine, Faye");
  assert.ok(faye);

  insertCollectionCardFixture(db, "u1", {
    ...makeCard(faye.malId),
    cardInstanceId: "owned-faye",
    title: faye.title,
  });

  const owned = getArenaArchivePayload(db, "u1", {
    search: "Faye Valentine",
    ownership: "owned",
    perPage: 10,
  });
  const notOwned = getArenaArchivePayload(db, "u1", {
    search: "Faye Valentine",
    ownership: "not-owned",
    perPage: 10,
  });

  assert.ok(owned.cards.some((card) => card.malId === faye.malId && card.owned));
  assert.ok(!notOwned.cards.some((card) => card.malId === faye.malId));
});

test("arena archive route requires authentication", async () => {
  const db = createTestDb();
  const app = express();
  registerArenaRoutes(app, { db, authFromReq: () => null });
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/arena/archive`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "ARENA_UNAUTHENTICATED");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("arena routes remain registered through compatibility entry", async () => {
  const db = createTestDb();
  const app = express();
  app.use(express.json());
  registerArenaRoutes(app, { db, authFromReq: () => null });
  const server = app.listen(0);
  const routeChecks = [
    ["GET", "/arena/profile"],
    ["GET", "/arena/updates"],
    ["POST", "/arena/updates"],
    ["DELETE", "/arena/updates/update-1"],
    ["POST", "/arena/verify"],
    ["GET", "/arena/collection"],
    ["GET", "/arena/archive"],
    ["GET", "/arena/skill-tree"],
    ["POST", "/arena/skill-tree/activate"],
    ["POST", "/arena/skill-tree/reset"],
    ["POST", "/arena/collection/select-card"],
    ["POST", "/arena/collection/toggle-favorite"],
    ["GET", "/arena/market/listings"],
    ["GET", "/arena/market/price"],
    ["GET", "/arena/market/listings/mine"],
    ["POST", "/arena/market/listings"],
    ["POST", "/arena/market/listings/listing-1/buy"],
    ["POST", "/arena/market/listings/listing-1/cancel"],
    ["POST", "/arena/fight"],
    ["POST", "/arena/fight/start"],
    ["GET", "/arena/fight/state"],
    ["POST", "/arena/fight/advance"],
    ["POST", "/arena/fight/skip"],
    ["POST", "/arena/draw-card"],
    ["POST", "/arena/draw-pack"],
    ["GET", "/arena/shop"],
    ["GET", "/arena/shop/cards"],
    ["POST", "/arena/shop/cards/buy"],
    ["POST", "/arena/shop/buy"],
    ["POST", "/arena/shop/use-consumable"],
    ["POST", "/arena/shop/equip"],
    ["POST", "/arena/shop/unequip"],
    ["POST", "/arena/shop/fodder"],
    ["POST", "/arena/shop/craft"],
    ["GET", "/arena/leaderboard"],
    ["GET", "/arena/trade/users"],
    ["GET", "/arena/trade/cards"],
    ["GET", "/arena/trade/listings"],
    ["GET", "/arena/trade/listings/mine"],
    ["POST", "/arena/trade/listings"],
    ["POST", "/arena/trade/listings/listing-1/cancel"],
    ["POST", "/arena/trade/request"],
    ["GET", "/arena/trade/request/request-1"],
    ["GET", "/arena/trade/requests/incoming"],
    ["POST", "/arena/trade/requests/request-1/accept"],
    ["POST", "/arena/trade/requests/request-1/deny"],
    ["POST", "/arena/trade/requests/request-1/cancel"],
    ["GET", "/arena/trade/session/session-1"],
    ["POST", "/arena/trade/session/session-1/offer-card"],
    ["POST", "/arena/trade/session/session-1/remove-card"],
    ["POST", "/arena/trade/session/session-1/offer-coins"],
    ["POST", "/arena/trade/session/session-1/remove-coins"],
    ["POST", "/arena/trade/session/session-1/confirm"],
    ["POST", "/arena/trade/session/session-1/unconfirm"],
    ["POST", "/arena/trade/session/session-1/cancel"],
    ["GET", "/arena/notifications"],
    ["GET", "/arena/notifications/unread-count"],
    ["POST", "/arena/notifications/notification-1/read"],
    ["GET", "/arena/mint/duplicates"],
    ["POST", "/arena/mint"],
    ["POST", "/arena/notifications/read-all"],
    ["GET", "/ar/archive"],
  ];

  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");

    for (const [method, path] of routeChecks) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method,
        headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      });
      assert.notEqual(response.status, 404, `${method} ${path} should be registered`);
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
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
  assert.equal(result.rewards.elo.rated, false);
  assert.equal(result.profile.eloRating, 1000);
  assert.equal(result.profile.eloMatches, 0);
});
