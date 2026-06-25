const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

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
  getArenaCollectionPayload,
  getArenaMarketListings,
  getArenaProfilePayload,
  getArenaSkillTreePayload,
  getArenaTradeListings,
  getArenaUpdates,
  getLeaderboard,
  getPlaybackFightState,
  normalizeArenaEffects,
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
const { SHOP_ITEMS } = require("../lib/arena-constants");

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
      effectHit INTEGER NOT NULL DEFAULT 3,
      lifetimeCoinsEarned INTEGER NOT NULL DEFAULT 0,
      eloRating INTEGER NOT NULL DEFAULT 1000,
      eloMatches INTEGER NOT NULL DEFAULT 0,
      peakElo INTEGER NOT NULL DEFAULT 1000,
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
    `CREATE TABLE arena_equipment_pieces (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      slot TEXT NOT NULL,
      mainStatType TEXT NOT NULL,
      mainStatValue REAL NOT NULL,
      subStats TEXT NOT NULL,
      equipped INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
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
    `CREATE TABLE arena_market_listings (
      id TEXT PRIMARY KEY,
      sellerUserId TEXT NOT NULL,
      buyerUserId TEXT,
      cardInstanceId TEXT NOT NULL,
      cardJson TEXT NOT NULL,
      cardTitle TEXT NOT NULL,
      malId INTEGER NOT NULL,
      rarity TEXT NOT NULL,
      ivTotal INTEGER NOT NULL,
      ivBand TEXT NOT NULL,
      price INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      soldAt TEXT,
      cancelledAt TEXT
    )`,
  ).run();
  db.prepare(
    `CREATE UNIQUE INDEX idx_arena_market_active_card
     ON arena_market_listings(cardInstanceId)
     WHERE status = 'active'`,
  ).run();

  db.prepare(
    `CREATE TABLE arena_updates (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      createdByUserId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`,
  ).run();

  db.prepare(
    `CREATE TABLE arena_trade_listings (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      cardInstanceId TEXT NOT NULL,
      cardJson TEXT NOT NULL,
      cardTitle TEXT NOT NULL,
      malId INTEGER NOT NULL,
      rarity TEXT NOT NULL,
      ivTotal INTEGER NOT NULL,
      element TEXT,
      wantedRarity TEXT,
      wantedElement TEXT,
      wantedCardJson TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      cancelledAt TEXT
    )`,
  ).run();
  db.prepare(
    `CREATE TABLE arena_trade_requests (
      id TEXT PRIMARY KEY,
      askerId TEXT NOT NULL,
      responderId TEXT NOT NULL,
      listingId TEXT,
      askerCardInstanceId TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      respondedAt TEXT,
      cancelledAt TEXT
    )`,
  ).run();
  db.prepare(
    `CREATE TABLE arena_trade_sessions (
      id TEXT PRIMARY KEY,
      requestId TEXT NOT NULL,
      askerId TEXT NOT NULL,
      responderId TEXT NOT NULL,
      askerCardInstanceId TEXT,
      responderCardInstanceId TEXT,
      askerCoins INTEGER NOT NULL DEFAULT 0,
      responderCoins INTEGER NOT NULL DEFAULT 0,
      askerConfirmed INTEGER NOT NULL DEFAULT 0,
      responderConfirmed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      completedAt TEXT
    )`,
  ).run();
  db.prepare(
    `CREATE TABLE arena_notifications (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      metadata TEXT,
      isRead INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
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
    input.catalogVersion ?? "v2",
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

test("xp formula and reward formulas stay stable", () => {
  assert.equal(xpToNext(1), 120);
  assert.equal(xpToNext(10), 4080);
  assert.equal(calculateWinXp(20, 2, 3), 67);
  assert.equal(calculateWinCoins(20, 12), 90);
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

test("potion effects use short tactical durations", () => {
  const durationByItemId = {
    red_tonic: ["charges", 8],
    green_draft: ["fights", 10],
    amber_draft: ["fights", 10],
    frost_elixir: ["fights", 5],
    viridian_elixir: ["charges", 3],
    sun_elixir: ["charges", 2],
    star_tonic: ["fights", 5],
    fuse_bomb: ["charges", 2],
    lantern_oil: ["charges", 3],
    seeker_lens: ["fights", 3],
    oath_ribbon: ["fights", 5],
    treasure_cache: ["charges", 2],
    prism_draught: ["charges", 2],
    sacred_candles: ["charges", 3],
    gate_key: ["fights", 3],
    chrono_vial: ["charges", 2],
  };

  Object.entries(durationByItemId).forEach(([itemId, [durationField, duration]]) => {
    const item = SHOP_ITEMS.find((candidate) => candidate.id === itemId);
    assert.ok(item, `Missing potion fixture: ${itemId}`);
    assert.equal(item.consumableEffect?.[durationField], duration);
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

  assert.equal(effects.expBoostWinsRemaining, 40);
  assert.equal(effects.coinBoostWinsRemaining, 40);
  assert.equal(effects.rerollKeepHigherCharges, 4);
  assert.equal(effects.streakShieldCharges, 6);
  assert.equal(effects.upgradeLowestRarityCharges, 6);
  assert.equal(effects.guaranteeSsrPlusCharges, 6);
  assert.equal(effects.fightStartShieldCharges, 16);
  assert.equal(effects.evadeBoostFightsRemaining, 16);
  assert.equal(effects.firstHitTrueDamageCharges, 4);
  assert.equal(effects.higherRarityDamageBonusPctCharges, 6);
  assert.equal(effects.gateKeyCharges, 4);
  assert.equal(effects.doublePassiveTriggerFightsRemaining, 6);
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

test("fights no longer drop crafting materials", () => {
  assert.deepEqual(rollFightMaterialRewards(), []);
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
  assert.deepEqual(response.rewards.materialDrops, []);
  assert.equal(response.profile.losses, 1);
  assert.equal(response.profile.effects.expBoostWinsRemaining, 40);
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
  insertProfile(db, {
    userId: "u1",
    level: 10,
    coins: 1000,
    selectedCard: makeCard(1, "C"),
  });

  const cardShop = await getArenaCardShopPayload(db, "u1", {
    recordedDate: "2099-01-01",
  });
  const offer = cardShop.dailyOffers[0];
  assert.ok(offer, "expected a card offer");

  const buyResult = await buyArenaShopCard(db, "u1", { kind: "daily", offerId: offer.offerId }, { recordedDate: "2099-01-01" });
  assert.equal(buyResult.purchasedOfferId, offer.offerId);
  assert.ok(buyResult.profile.coins < 1000);
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

test("daily card purchases are sold globally and preserve selected card", async () => {
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
    true,
  );
  await assert.rejects(
    () =>
      buyArenaShopCard(db, "u2", {
        kind: "daily",
        offerId: offer.offerId,
      }, {
        recordedDate: "2099-02-01",
      }),
    (error) =>
      error instanceof ArenaHttpError &&
      error.code === "ARENA_CARD_SHOP_ALREADY_SOLD",
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

test("crafting gear consumes coins and equips output", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 10,
    coins: 3000,
    selectedCard: makeCard(1, "C"),
  });

  const crafted = craftShopRecipe(db, "u1", "rookie_gear_1");
  assert.equal(crafted.craftedRecipeId, "rookie_gear_1");
  assert.equal(crafted.outputItemId, "rustblade_weapon");
  assert.equal(crafted.craftedQuantity, 1);
  assert.equal(crafted.shop.equipped.weapon?.itemId, "rustblade_weapon");
  assert.ok(crafted.shop.profile.coins < 3000);
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

  craftShopRecipe(db, "u1", "rookie_cons_1");

  const useResult = useConsumable(db, "u1", "red_tonic");
  assert.equal(useResult.activatedItemId, "red_tonic");
  assert.equal(useResult.effects.fightStartShieldCharges, 8);
  assert.equal(useResult.effects.fightStartShieldAmount, 60);

  const profile = getArenaProfilePayload(db, "u1");
  assert.equal(profile.effects.fightStartShieldCharges, 8);
  assert.equal(profile.effects.fightStartShieldAmount, 60);
});

test("Berserker's Brew applies +20% damage boost", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "rookie_cons_2");
  const result = useConsumable(db, "u1", "green_draft");
  assert.equal(result.effects.damageBoostPct, 20);
  assert.equal(result.effects.damageBoostFightsRemaining, 10);
});

test("Scout's Whistle applies +12% speed boost", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "rookie_cons_3");
  const result = useConsumable(db, "u1", "amber_draft");
  assert.equal(result.effects.speedBoostPct, 12);
  assert.equal(result.effects.speedBoostFightsRemaining, 10);
});

test("Phoenix Feather applies death save charges", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "silver_cons_1");
  const result = useConsumable(db, "u1", "sun_elixir");
  assert.equal(result.effects.deathSaveCharges, 2);
});

test("Titan Draught applies +15% all stats", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "silver_cons_2");
  const result = useConsumable(db, "u1", "star_tonic");
  assert.equal(result.effects.statSteroidPct, 15);
  assert.equal(result.effects.statSteroidFightsRemaining, 5);
});

test("Seeker Lens applies +20% crit chance", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 30, coins: 100000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "gold_cons_1");
  const result = useConsumable(db, "u1", "seeker_lens");
  assert.equal(result.effects.critChanceBoostPct, 20);
  assert.equal(result.effects.critChanceBoostFightsRemaining, 3);
});

test("Oath Ribbon applies +15% guard boost", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 30, coins: 100000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "gold_cons_2");
  const result = useConsumable(db, "u1", "oath_ribbon");
  assert.equal(result.effects.guardBoostPct, 15);
  assert.equal(result.effects.guardBoostFightsRemaining, 5);
});

test("Arcane Mirror applies match rarity charges", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 30, coins: 100000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "gold_cons_3");
  const result = useConsumable(db, "u1", "treasure_cache");
  assert.equal(result.effects.matchRarityCharges, 2);
});

test("Prism Draught applies first attack double charges", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 50, coins: 100000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "mythic_cons_1");
  const result = useConsumable(db, "u1", "prism_draught");
  assert.equal(result.effects.firstAttackDoubleCharges, 2);
});

test("Vampiric Fang applies 20% lifesteal", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 50, coins: 100000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "mythic_cons_3");
  const result = useConsumable(db, "u1", "gate_key");
  assert.equal(result.effects.vampiricHealPct, 20);
  assert.equal(result.effects.vampiricHealFightsRemaining, 3);
});

test("Fuse Bomb deals +100 true damage", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "bronze_cons_3");
  const result = useConsumable(db, "u1", "fuse_bomb");
  assert.equal(result.effects.firstHitTrueDamageValue, 100);
  assert.equal(result.effects.firstHitTrueDamageCharges, 2);
});

test("Lantern Oil applies +50% damage vs higher rarity", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "silver_cons_3");
  const result = useConsumable(db, "u1", "lantern_oil");
  assert.equal(result.effects.higherRarityDamageBonusPct, 50);
  assert.equal(result.effects.higherRarityDamageBonusPctCharges, 3);
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
