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
  calculateCardSacrificePayout,
  craftShopRecipe,
  calculateRoundPower,
  computeElementMultiplier,
  computeEvasionChance,
  computeMaxHp,
  computeShieldPiercePct,
  convertMaxLevelOverflowXp,
  calculateLossXp,
  calculateWinCoins,
  calculateWinXp,
  createArenaMarketListing,
  createArenaTradeListing,
  createArenaUpdate,
  deleteArenaUpdate,
  drawDailyCard,
  equipShopItem,
  ensureArenaProfile,
  getArenaCardShopPayload,
  getArenaArchivePayload,
  getArenaCollectionPayload,
  getArenaMarketListings,
  getArenaShopPayload,
  getArenaProfilePayload,
  getArenaSkillTreePayload,
  getArenaTradeListings,
  getArenaUpdates,
  getCardAffinity,
  getLeaderboard,
  getPlaybackFightState,
  incrementDailyOpponentCount,
  finalizePlaybackFightRewards,
  loadCombatSnapshot,
  acceptTradeRequest,
  applyFightEffectUsage,
  confirmTrade,
  normalizeArenaEffects,
  offerCardInTrade,
  rarityFromCharacterRank,
  resolveRoundWinner,
  resetArenaSkills,
  rerollArenaCardShopOffers,
  runFight,
  sacrificeCollectionCards,
  selectCollectionCard,
  sendTradeRequest,
  skipPlaybackFightToEnd,
  startPlaybackFight,
  upsertInventoryItem,
  useConsumable,
  xpToNext,
  DAILY_OPPONENT_LIMIT_MIN,
} = require("../lib/arena");
const registerArenaRoutes = require("../routes/arena");
const { initializeSchema } = require("../lib/db");
const { CATALOG_VERSION, SHOP_ITEMS } = require("../lib/arena-constants");

const {
  buildPassiveRuntime,
  buildNpcOpponent,
  calculateAttackOutcome,
  calculateEloExchange,
  chooseEloOpponent,
  consumeTempGuard,
  getDailyOpponentLimit,
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
  assert.equal(calculateWinXp(20, 2, 3), 70);
  assert.equal(calculateWinCoins(20, 12), 130);
});

test("day 3 balance formulas cap snowballing and reward max-level overflow", () => {
  assert.equal(computeMaxHp({ hp: 100, power: 50, guard: 50, speed: 50 }), 230);
  assert.equal(calculateWinXp(20, 2, 127), 71);
  assert.equal(calculateWinXp(70, 3, 127), 198);
  assert.equal(calculateWinCoins(20, 12, 20), 169);
  assert.equal(
    computeElementMultiplier(1.3, { effectHit: 100 }, { effectHit: 0 }),
    1.8,
  );
  assert.equal(computeShieldPiercePct({ effectHit: 72 }), 7);

  const profile = {
    level: 70,
    xp: 123,
    coins: 10,
    lifetimeCoinsEarned: 25,
  };
  assert.equal(convertMaxLevelOverflowXp(profile), 123);
  assert.equal(profile.xp, 0);
  assert.equal(profile.coins, 133);
  assert.equal(profile.lifetimeCoinsEarned, 148);
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
  assert.equal(result.breakdown.rarityPower, 12.24);
  assert.ok(result.breakdown.malScoreBonus >= 0);
  assert.ok(result.breakdown.popularityBonus >= 0);
});

test("attack evasion chance is capped at 44 percent", () => {
  const sharedInput = {
    attackerStats: { power: 100, speed: 1 },
    defenderStats: { hp: 100, guard: 1, speed: 500 },
    attackerRarity: "C",
    defenderRarity: "C",
    extraDefenderEvasionPct: 95,
  };

  assert.equal(
    calculateAttackOutcome({ ...sharedInput, randomFn: () => 0.43 }).avoided,
    true,
  );
  assert.equal(
    calculateAttackOutcome({ ...sharedInput, randomFn: () => 0.45 }).avoided,
    false,
  );
});

test("evasion chance is driven by relative speed gap", () => {
  const chance = (attackerSpeed, defenderSpeed, extraPct = 0) =>
    Number(
      computeEvasionChance(
        { speed: attackerSpeed },
        { speed: defenderSpeed },
        extraPct,
      ).toFixed(3),
  );

  assert.equal(chance(50, 50), 0.03);
  assert.equal(chance(50, 60), 0.046);
  assert.equal(chance(60, 50), 0.02);
  assert.equal(chance(50, 160), 0.205);
  assert.equal(chance(10, 167, 12), 0.4);
  assert.equal(chance(1, 500, 95), 0.44);
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

test("card sacrifice pays balanced coins and removes only confirmed cards", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", coins: 100 });
  const common = { ...makeCard(1, "C"), cardInstanceId: "sac-c", iv: { power: 0, guard: 0, speed: 0, effectHit: 0, total: 0 } };
  const rainbow = { ...makeCard(2, "UR"), cardInstanceId: "sac-ur", rainbow: true, iv: { power: 31, guard: 31, speed: 31, effectHit: 31, total: 124 } };
  insertCollectionCardFixture(db, "u1", common);
  insertCollectionCardFixture(db, "u1", rainbow);

  assert.equal(calculateCardSacrificePayout(common), 10);
  assert.equal(calculateCardSacrificePayout(rainbow), Math.floor(1800 * 1.4));

  const preview = sacrificeCollectionCards(db, "u1", {
    cardInstanceIds: ["sac-c", "sac-ur"],
    confirm: false,
  });
  assert.equal(preview.coinsGained, 0);
  assert.equal(preview.preview.totalCoins, 2530);
  assert.equal(preview.collectionTotal, 2);

  const result = sacrificeCollectionCards(db, "u1", {
    cardInstanceIds: ["sac-c", "sac-ur"],
    confirm: true,
  });
  assert.deepEqual(result.sacrificedCardInstanceIds, ["sac-c", "sac-ur"]);
  assert.equal(result.coinsGained, 2530);
  assert.equal(result.profile.coins, 2630);
  assert.equal(result.collectionTotal, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM arena_card_collection WHERE userId = ?").get("u1").count,
    0,
  );
});

test("card sacrifice blocks protected, traded, duplicate, and unowned cards", () => {
  const db = createTestDb();
  const selected = { ...makeCard(1, "R"), cardInstanceId: "sac-selected" };
  const favorite = { ...makeCard(2, "R"), cardInstanceId: "sac-favorite" };
  const market = { ...makeCard(3, "R"), cardInstanceId: "sac-market" };
  const tradeListing = { ...makeCard(4, "R"), cardInstanceId: "sac-trade-listing" };
  const tradeSession = { ...makeCard(5, "R"), cardInstanceId: "sac-trade-session" };
  const safe = { ...makeCard(6, "R"), cardInstanceId: "sac-safe" };
  const otherUser = { ...makeCard(7, "R"), cardInstanceId: "sac-other-user" };
  insertProfile(db, { userId: "u1", selectedCard: selected });
  for (const card of [selected, favorite, market, tradeListing, tradeSession, safe]) {
    insertCollectionCardFixture(db, "u1", card);
  }
  insertCollectionCardFixture(db, "u2", otherUser);
  db.prepare(
    "UPDATE arena_card_collection SET isFavorite = 1 WHERE userId = ? AND cardInstanceId = ?",
  ).run("u1", favorite.cardInstanceId);
  insertMarketListingFixture(db, {
    id: "market-sacrifice-block",
    sellerUserId: "u1",
    card: market,
    price: 50,
    status: "active",
  });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_trade_listings (
      id, userId, cardInstanceId, cardJson, cardTitle, malId, rarity, ivTotal,
      element, wantedRarity, wantedElement, wantedCardJson, note, status, createdAt, updatedAt, cancelledAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 'active', ?, ?, NULL)`,
  ).run(
    "trade-sacrifice-block",
    "u1",
    tradeListing.cardInstanceId,
    JSON.stringify(tradeListing),
    tradeListing.title,
    tradeListing.malId,
    tradeListing.rarity,
    tradeListing.iv.total,
    tradeListing.element || null,
    now,
    now,
  );
  db.prepare(
    `INSERT INTO arena_trade_sessions (
      id, requestId, askerId, responderId, askerCardInstanceId, responderCardInstanceId,
      askerCardInstanceIdsJson, responderCardInstanceIdsJson, askerCoins, responderCoins,
      askerConfirmed, responderConfirmed, status, createdAt, updatedAt, completedAt
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, 0, 0, 0, 'active', ?, ?, NULL)`,
  ).run(
    "session-sacrifice-block",
    "request-sacrifice-block",
    "u1",
    "u2",
    tradeSession.cardInstanceId,
    JSON.stringify([tradeSession.cardInstanceId]),
    JSON.stringify([]),
    now,
    now,
  );

  assert.throws(
    () => sacrificeCollectionCards(db, "u1", { cardInstanceIds: ["sac-safe", "sac-safe"], confirm: false }),
    /Duplicate card IDs/,
  );

  const preview = sacrificeCollectionCards(db, "u1", {
    cardInstanceIds: [
      selected.cardInstanceId,
      favorite.cardInstanceId,
      market.cardInstanceId,
      tradeListing.cardInstanceId,
      tradeSession.cardInstanceId,
      otherUser.cardInstanceId,
      safe.cardInstanceId,
    ],
    confirm: false,
  }).preview;

  const reasons = new Map(preview.items.map((item) => [item.cardInstanceId, item.blockedReason]));
  assert.equal(reasons.get(selected.cardInstanceId), "selected");
  assert.equal(reasons.get(favorite.cardInstanceId), "favorite");
  assert.equal(reasons.get(market.cardInstanceId), "market_listed");
  assert.equal(reasons.get(tradeListing.cardInstanceId), "trade_listed");
  assert.equal(reasons.get(tradeSession.cardInstanceId), "trade_session");
  assert.equal(reasons.get(otherUser.cardInstanceId), "not_found");
  assert.equal(reasons.get(safe.cardInstanceId), null);

  assert.throws(
    () => sacrificeCollectionCards(db, "u1", {
      cardInstanceIds: [selected.cardInstanceId, safe.cardInstanceId],
      confirm: true,
    }),
    /cannot be sacrificed/,
  );
  assert.ok(
    db.prepare("SELECT id FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ?")
      .get("u1", safe.cardInstanceId),
  );
});

test("card affinity is exposed and contributes as card IV bonus", () => {
  const db = createTestDb();
  const card = makeCard(1, "R");
  insertProfile(db, {
    userId: "u1",
    hp: 120,
    power: 12,
    guard: 12,
    speed: 10,
    effectHit: 6,
    selectedCard: card,
  });
  insertCollectionCardFixture(db, "u1", card);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_card_affinity (
      userId, malId, fights, wins, affinityLevel, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("u1", card.malId, 250, 200, 5, now, now);

  const profile = getArenaProfilePayload(db, "u1");
  assert.equal(profile.selectedCard.affinity.level, 5);
  assert.deepEqual(profile.stats.affinity, {
    hp: 0,
    power: 2,
    guard: 1,
    speed: 1,
    effectHit: 1,
  });
  assert.equal(profile.stats.total.power, 19);
  assert.equal(profile.stats.total.effectHit, 13);

  const collection = getArenaCollectionPayload(db, "u1");
  assert.equal(collection.cards[0].affinity.level, 5);

  const snapshot = loadCombatSnapshot(db, ensureArenaProfile(db, "u1"));
  assert.equal(snapshot.totalStats.power, profile.stats.total.power);
  assert.equal(snapshot.totalStats.effectHit, profile.stats.total.effectHit);
});

test("collection can sort cards by affinity", () => {
  const db = createTestDb();
  const low = makeCard(1, "R");
  const high = makeCard(2, "R");
  const none = makeCard(3, "R");
  insertProfile(db, { userId: "u1", selectedCard: low });
  insertCollectionCardFixture(db, "u1", low);
  insertCollectionCardFixture(db, "u1", high);
  insertCollectionCardFixture(db, "u1", none);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_card_affinity (
      userId, malId, fights, wins, affinityLevel, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "u1", low.malId, 25, 10, 2, now, now,
    "u1", high.malId, 250, 200, 5, now, now,
  );

  const descending = getArenaCollectionPayload(db, "u1", { sort: "affinity-desc" });
  assert.deepEqual(descending.cards.map((card) => card.cardInstanceId), [
    high.cardInstanceId,
    low.cardInstanceId,
    none.cardInstanceId,
  ]);

  const ascending = getArenaCollectionPayload(db, "u1", { sort: "affinity-asc" });
  assert.deepEqual(ascending.cards.map((card) => card.cardInstanceId), [
    none.cardInstanceId,
    low.cardInstanceId,
    high.cardInstanceId,
  ]);
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

test("60-turn timeout tiebreak compares remaining HP percentage", async () => {
  const db = createTestDb();
  const player = makeCombatSnapshot({
    id: 1,
    stats: { hp: 240, power: 16, guard: 50, speed: 10, effectHit: 0 },
  });
  const opponent = makeCombatSnapshot({
    id: 2,
    stats: { hp: 1200, power: 1, guard: 20, speed: 0, effectHit: 0 },
  });

  const result = await simulateFight(db, { player, opponent, randomFn: () => 0.5 });
  const finalTurn = result.rounds.at(-1);

  assert.equal(result.rounds.length, 60);
  assert.ok(finalTurn.playerHp < finalTurn.opponentHp);
  assert.ok(
    finalTurn.playerHp / result.battle.maxHp.player >
      finalTurn.opponentHp / result.battle.maxHp.opponent,
  );
  assert.equal(result.playerWon, true);
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

test("fight loss grants consolation XP and 0 coins", async () => {
  const db = createTestDb();
  const today = new Date().toISOString();
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
  db.prepare(
    "UPDATE arena_profiles SET dailyOpponentCount = 7, lastOpponentDate = ? WHERE userId = ?",
  ).run(today, "u1");

  const response = await runFight(db, "u1");
  assert.equal(response.result, "loss");
  assert.ok(response.battle);
  assert.equal(
    response.rewards.xp,
    Math.floor(calculateLossXp(response.opponent.level, 1, 4) * 1.2),
  );
  assert.ok(response.rewards.xp > 1);
  assert.equal(response.rewards.coins, 0);
  assert.equal(response.profile.losses, 1);
  assert.equal(response.profile.effects.expBoostWinsRemaining, 49);
  assert.equal(response.profile.effects.coinBoostWinsRemaining, 39);
  const row = db
    .prepare("SELECT dailyOpponentCount FROM arena_profiles WHERE userId = ?")
    .get("u1");
  assert.equal(row.dailyOpponentCount, 0);
});

test("daily opponent count resets only when defender day changes", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    selectedCard: makeCard(1, "C"),
  });

  db.prepare(
    "UPDATE arena_profiles SET dailyOpponentCount = 4, lastOpponentDate = ? WHERE userId = ?",
  ).run("2026-01-01T12:00:00.000Z", "u1");

  incrementDailyOpponentCount(db, "u1");
  let row = db
    .prepare("SELECT dailyOpponentCount, lastOpponentDate FROM arena_profiles WHERE userId = ?")
    .get("u1");
  assert.equal(row.dailyOpponentCount, 1);

  incrementDailyOpponentCount(db, "u1");
  row = db
    .prepare("SELECT dailyOpponentCount FROM arena_profiles WHERE userId = ?")
    .get("u1");
  assert.equal(row.dailyOpponentCount, 2);
});

test("daily opponent limit scales with total arena profiles", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", selectedCard: makeCard(1, "C") });
  insertProfile(db, { userId: "u2", selectedCard: makeCard(2, "C") });
  insertProfile(db, { userId: "u3", selectedCard: makeCard(3, "C") });

  assert.equal(getDailyOpponentLimit(db), DAILY_OPPONENT_LIMIT_MIN);

  for (let id = 4; id <= 60; id += 1) {
    insertProfile(db, {
      userId: `u${id}`,
      selectedCard: makeCard(id, "C"),
    });
  }

  assert.equal(getDailyOpponentLimit(db), 120);
});

test("active fighters clear their defender count and daily cap skips overused defenders", async () => {
  const db = createTestDb();
  const today = new Date().toISOString();
  const dailyOpponentLimit = DAILY_OPPONENT_LIMIT_MIN;
  insertProfile(db, {
    userId: "u1",
    level: 10,
    selectedCard: makeCard(1, "R"),
  });
  insertProfile(db, {
    userId: "u2",
    level: 10,
    eloRating: 1000,
    selectedCard: makeCard(2, "R"),
  });
  insertProfile(db, {
    userId: "u3",
    level: 10,
    eloRating: 1010,
    selectedCard: makeCard(3, "R"),
  });
  db.prepare(
    "UPDATE arena_profiles SET dailyOpponentCount = ?, lastOpponentDate = ? WHERE userId = ?",
  ).run(12, today, "u1");
  db.prepare(
    "UPDATE arena_profiles SET dailyOpponentCount = ?, lastOpponentDate = ? WHERE userId = ?",
  ).run(dailyOpponentLimit, today, "u2");
  db.prepare(
    "UPDATE arena_profiles SET dailyOpponentCount = ?, lastOpponentDate = ? WHERE userId = ?",
  ).run(dailyOpponentLimit, "2026-01-01T00:00:00.000Z", "u3");

  assert.equal(getDailyOpponentLimit(db), dailyOpponentLimit);
  assert.equal(chooseEloOpponent(db, "u1", () => 0).userId, "u3");

  const result = await runFight(db, "u1");
  assert.equal(result.opponent.userId, "u3");
  const activePlayer = db
    .prepare("SELECT dailyOpponentCount FROM arena_profiles WHERE userId = ?")
    .get("u1");
  assert.equal(activePlayer.dailyOpponentCount, 0);
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
  assert.equal(getCardAffinity(db, "u1", 1).fights, 1);

  const repeated = getPlaybackFightState(db, "u1");
  assert.deepEqual(repeated?.rewards, resumed.rewards);
  assert.equal(getArenaProfilePayload(db, "u1").eloMatches, 1);
  assert.equal(getArenaProfilePayload(db, "u2").eloMatches, 1);
  assert.equal(getCardAffinity(db, "u1", 1).fights, 1);

  const skippedAgain = skipPlaybackFightToEnd(db, "u1");
  assert.deepEqual(skippedAgain?.rewards, resumed.rewards);
  const finalizedAgain = finalizePlaybackFightRewards(db, "u1");
  assert.deepEqual(finalizedAgain?.rewards, resumed.rewards);
  assert.equal(getCardAffinity(db, "u1", 1).fights, 1);
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
  assert.equal(getCardAffinity(db, "u1", 1).fights, 1);

  const repeatedAdvance = advancePlaybackFightTurn(db, "u1");
  assert.deepEqual(repeatedAdvance.rewards, resumed.rewards);
  assert.equal(getArenaProfilePayload(db, "u1").eloMatches, 1);
  assert.equal(getArenaProfilePayload(db, "u2").eloMatches, 1);
  assert.equal(getCardAffinity(db, "u1", 1).fights, 1);
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

test("playback fight snapshot applies sigil and affinity as card IV", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 5,
    selectedCard: makeCard(1, "R"),
  });
  const maxIvCard = {
    ...makeCard(2, "SR"),
    iv: {
      power: 31,
      guard: 31,
      speed: 31,
      effectHit: 31,
      total: 124,
    },
    cardItemStats: {
      hp: 0,
      power: 3,
      guard: 1,
      speed: 1,
      effectHit: 1,
    },
    cardItemIds: ["apex_sigil"],
  };
  insertProfile(db, {
    userId: "u2",
    level: 5,
    hp: 150,
    power: 40,
    guard: 20,
    speed: 15,
    effectHit: 9,
    selectedCard: maxIvCard,
  });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_card_affinity (
      userId, malId, fights, wins, affinityLevel, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("u2", maxIvCard.malId, 250, 200, 5, now, now);

  const fight = await startPlaybackFight(db, "u1");

  assert.equal(fight.opponent.stats.power, 52);
  assert.deepEqual(fight.opponent.statBreakdown.card, {
    hp: 16,
    power: 12,
    guard: 11,
    speed: 11,
    effectHit: 11,
  });
  assert.equal(fight.opponent.selectedCard.cardItemStats.power, 3);
  assert.equal(fight.opponent.selectedCard.affinity.level, 5);
});

test("playback fight player stats include sigil and affinity card IV", async () => {
  const db = createTestDb();
  const maxIvCard = {
    ...makeCard(1, "SR"),
    iv: {
      power: 31,
      guard: 31,
      speed: 31,
      effectHit: 31,
      total: 124,
    },
    cardItemStats: {
      hp: 0,
      power: 3,
      guard: 1,
      speed: 1,
      effectHit: 1,
    },
    cardItemIds: ["apex_sigil"],
  };
  insertProfile(db, {
    userId: "u1",
    level: 5,
    hp: 150,
    power: 40,
    guard: 20,
    speed: 15,
    effectHit: 9,
    selectedCard: maxIvCard,
  });
  insertProfile(db, {
    userId: "u2",
    level: 5,
    selectedCard: makeCard(2, "R"),
  });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_card_affinity (
      userId, malId, fights, wins, affinityLevel, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("u1", maxIvCard.malId, 250, 200, 5, now, now);

  const fight = await startPlaybackFight(db, "u1");
  const snapshot = loadCombatSnapshot(db, ensureArenaProfile(db, "u1"));

  assert.equal(
    fight.battle.maxHp.player,
    computeMaxHp(snapshot.totalStats, snapshot.equipmentPct?.hpPct || 0),
  );
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

test("Apex Sigil rejects selected cards below max IV", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 1,
    coins: 200000,
    selectedCard: makeCard(1, "C"),
  });
  buyShopItem(db, "u1", "apex_sigil");

  assert.throws(
    () => useConsumable(db, "u1", "apex_sigil"),
    { code: "ARENA_CARD_MAX_IV_REQUIRED" },
  );

  const shop = getArenaShopPayload(db, "u1");
  const item = shop.cardItems.find((candidate) => candidate.id === "apex_sigil");
  assert.equal(item.ownedQuantity, 1);
});

test("Apex Sigil adds permanent card IV to max IV selected card", () => {
  const db = createTestDb();
  const maxIvCard = {
    ...makeCard(1, "C"),
    iv: {
      power: 31,
      guard: 31,
      speed: 31,
      effectHit: 31,
      total: 124,
    },
  };
  insertProfile(db, {
    userId: "u1",
    level: 1,
    coins: 200000,
    selectedCard: maxIvCard,
  });
  buyShopItem(db, "u1", "apex_sigil");

  const result = useConsumable(db, "u1", "apex_sigil");
  const selectedCard = result.shop.profile.selectedCard;

  assert.equal(selectedCard.cardItemStats.power, 3);
  assert.equal(selectedCard.cardItemStats.guard, 1);
  assert.equal(selectedCard.cardItemStats.speed, 1);
  assert.equal(selectedCard.cardItemStats.effectHit, 1);
  assert.deepEqual(selectedCard.cardItemIds, ["apex_sigil"]);
  assert.equal(result.shop.profile.stats.card.hp, 16);
  assert.equal(result.shop.profile.stats.card.power, 11);
  assert.equal(result.shop.profile.stats.card.guard, 10);
  assert.equal(result.shop.profile.stats.card.speed, 10);
  assert.equal(result.shop.profile.stats.card.effectHit, 10);
});

test("Apex Sigil can only be used once per card", () => {
  const db = createTestDb();
  const maxIvCard = {
    ...makeCard(1, "C"),
    iv: {
      power: 31,
      guard: 31,
      speed: 31,
      effectHit: 31,
      total: 124,
    },
  };
  insertProfile(db, {
    userId: "u1",
    level: 1,
    coins: 400000,
    selectedCard: maxIvCard,
  });
  buyShopItem(db, "u1", "apex_sigil");
  buyShopItem(db, "u1", "apex_sigil");
  useConsumable(db, "u1", "apex_sigil");

  assert.throws(
    () => useConsumable(db, "u1", "apex_sigil"),
    { code: "ARENA_CARD_ITEM_ALREADY_APPLIED" },
  );
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

test("Phoenix Feather active marker clears after final death save charge is spent", () => {
  const effects = normalizeArenaEffects({
    deathSaveCharges: 1,
    activeConsumables: [
      {
        itemId: "sun_elixir",
        kind: "death_save",
        activatedAt: new Date().toISOString(),
      },
    ],
  });

  const result = applyFightEffectUsage(effects, { usedDeathSave: true });

  assert.equal(result.deathSaveCharges, 0);
  assert.deepEqual(result.activeConsumables, []);
});

test("expired Phoenix Feather marker is pruned when effects are normalized", () => {
  const result = normalizeArenaEffects({
    deathSaveCharges: 0,
    activeConsumables: [
      {
        itemId: "sun_elixir",
        kind: "death_save",
        activatedAt: new Date().toISOString(),
      },
    ],
  });

  assert.deepEqual(result.activeConsumables, []);
});

test("Chrono Vial does not trigger as a low-HP heal", async () => {
  const db = createTestDb();
  const player = makeCombatSnapshot({
    id: 1,
    stats: { hp: 300, power: 1, guard: 50, speed: 10, effectHit: 0 },
  });
  const opponent = makeCombatSnapshot({
    id: 2,
    stats: { hp: 300, power: 1, guard: 50, speed: 0, effectHit: 0 },
  });

  const result = await simulateFight(db, {
    player,
    opponent,
    playerEffects: {
      selfReviveCharges: 1,
      selfReviveHpThresholdPct: 95,
    },
    randomFn: () => 0.5,
  });

  assert.equal(result.effectUsage.usedSelfRevive, false);
});

test("Chrono Vial revives on KO", async () => {
  const db = createTestDb();
  const player = makeCombatSnapshot({
    id: 1,
    stats: { hp: 120, power: 1, guard: 1, speed: 1, effectHit: 0 },
  });
  const opponent = makeCombatSnapshot({
    id: 2,
    stats: { hp: 120, power: 300, guard: 10, speed: 10, effectHit: 0 },
  });

  const result = await simulateFight(db, {
    player,
    opponent,
    playerEffects: {
      selfReviveCharges: 1,
      selfReviveHpThresholdPct: 50,
    },
    randomFn: () => 0.5,
  });

  assert.equal(result.effectUsage.usedSelfRevive, true);
  const expectedReviveHp = Math.ceil(result.battle.maxHp.player * 0.5);
  assert.ok(result.battle.console.some(
    (entry) => entry.line === `Card 1 revived to ${expectedReviveHp} HP (Chrono Vial)`,
  ));
});

test("combined consumable damage multipliers are capped", async () => {
  const db = createTestDb();
  const player = makeCombatSnapshot({
    id: 1,
    stats: { hp: 1000, power: 80, guard: 20, speed: 100, effectHit: 0 },
  });
  const opponent = makeCombatSnapshot({
    id: 2,
    stats: { hp: 1000, power: 10, guard: 10, speed: 1, effectHit: 0 },
  });

  const baseline = await simulateFight(db, {
    player: makeCombatSnapshot({
      id: 1,
      stats: { hp: 1000, power: 80, guard: 20, speed: 100, effectHit: 0 },
    }),
    opponent: makeCombatSnapshot({
      id: 2,
      stats: { hp: 1000, power: 10, guard: 10, speed: 1, effectHit: 0 },
    }),
    randomFn: () => 0.99,
  });
  const boosted = await simulateFight(db, {
    player,
    opponent,
    playerEffects: {
      damageBoostPct: 200,
      damageBoostFightsRemaining: 1,
      firstAttackDoubleCharges: 1,
    },
    randomFn: () => 0.99,
  });

  const baselineHit = baseline.rounds.find((round) => round.attacker === "player" && !round.avoided);
  const boostedHit = boosted.rounds.find((round) => round.attacker === "player" && !round.avoided);
  assert.ok(baselineHit);
  assert.ok(boostedHit);
  assert.ok(boostedHit.damage <= baselineHit.damage * 5);
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

test("leaderboard XP progress uses the shared xpToNext formula", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 10,
    xp: xpToNext(10) / 2,
    selectedCard: makeCard(1, "C"),
  });

  const board = getLeaderboard(db, "level", { perPage: 10 });
  assert.equal(board.entries[0].user.id, "u1");
  assert.equal(board.entries[0].xpToNext, xpToNext(10));
  assert.equal(board.entries[0].xpProgress, 0.5);
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

test("accepting a listing trade with both cards completes the swap", () => {
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
  assert.equal(accepted.completed, true);
  assert.equal(accepted.askerCard.cardInstanceId, offeredCard.cardInstanceId);
  assert.equal(accepted.responderCard.cardInstanceId, listedCard.cardInstanceId);

  const session = db
    .prepare("SELECT id FROM arena_trade_sessions WHERE requestId = ?")
    .get(request.requestId);
  assert.equal(session, undefined);
  assert.ok(
    db
      .prepare("SELECT id FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ?")
      .get("u1", offeredCard.cardInstanceId),
  );
  assert.ok(
    db
      .prepare("SELECT id FROM arena_card_collection WHERE userId = ? AND cardInstanceId = ?")
      .get("u2", listedCard.cardInstanceId),
  );
  assert.equal(
    db
      .prepare("SELECT status FROM arena_trade_requests WHERE id = ?")
      .get(request.requestId).status,
    "accepted",
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
    ["POST", "/arena/collection/sacrifice"],
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

test("npc opponents receive synthetic equipment and skill bonuses", async () => {
  const db = createTestDb();
  const npc = await buildNpcOpponent(db, 60);
  const snapshot = loadCombatSnapshot(db, npc);

  assert.equal(npc.isNpc, true);
  assert.ok(snapshot.equipmentStats.power > 0);
  assert.ok(snapshot.equipmentStats.guard > 0);
  assert.ok(snapshot.skillStats.hp > 0);
  assert.ok(snapshot.equipmentPctStats.dmgPct > 0);
  assert.ok(snapshot.totalStats.power > snapshot.baseStats.power);
});

// ── Consumable cap & stacking tests ──

const ALL_CONSUMABLES = [
  { id: "red_tonic", recipe: "rookie_cons_1", kind: "shield_fight_start", field: "fightStartShieldCharges", value: 100, pctField: "fightStartShieldAmount", pctValue: 60 },
  { id: "green_draft", recipe: "rookie_cons_2", kind: "damage_boost", field: "damageBoostFightsRemaining", value: 500, pctField: "damageBoostPct", pctValue: 20 },
  { id: "amber_draft", recipe: "rookie_cons_3", kind: "speed_boost", field: "speedBoostFightsRemaining", value: 500, pctField: "speedBoostPct", pctValue: 12 },
  { id: "frost_elixir", recipe: "bronze_cons_1", kind: "evade_next_fight", field: "evadeBoostFightsRemaining", value: 250, pctField: "evadeBoostPct", pctValue: 10 },
  { id: "viridian_elixir", recipe: "bronze_cons_2", kind: "iv_boost", field: "ivBoostCharges", value: 250 },
  { id: "fuse_bomb", recipe: "bronze_cons_3", kind: "first_hit_true_damage", field: "firstHitTrueDamageCharges", value: 250, pctField: "firstHitTrueDamageValue", pctValue: 100 },
  { id: "exp_tome", recipe: "bronze_cons_4", kind: "exp_boost", field: "expBoostWinsRemaining", value: 250, pctField: "expBoostPct", pctValue: 100 },
  { id: "sun_elixir", recipe: "silver_cons_1", kind: "death_save", field: "deathSaveCharges", value: 500 },
  { id: "star_tonic", recipe: "silver_cons_2", kind: "stat_steroid", field: "statSteroidFightsRemaining", value: 500, pctField: "statSteroidPct", pctValue: 15 },
  { id: "lantern_oil", recipe: "silver_cons_3", kind: "bonus_vs_higher_rarity", field: "higherRarityDamageBonusPctCharges", value: 500, pctField: "higherRarityDamageBonusPct", pctValue: 50 },
  { id: "seeker_lens", recipe: "gold_cons_1", kind: "crit_chance", field: "critChanceBoostFightsRemaining", value: 500, pctField: "critChanceBoostPct", pctValue: 20 },
  { id: "oath_ribbon", recipe: "gold_cons_2", kind: "guard_boost", field: "guardBoostFightsRemaining", value: 500, pctField: "guardBoostPct", pctValue: 15 },
  { id: "treasure_cache", recipe: "gold_cons_3", kind: "match_rarity", field: "matchRarityCharges", value: 750 },
  { id: "prism_draught", recipe: "mythic_cons_1", kind: "first_attack_double", field: "firstAttackDoubleCharges", value: 1000 },
  { id: "sacred_candles", recipe: "mythic_cons_2", kind: "shield_fight_start", field: "fightStartShieldCharges", value: 1000, pctField: "fightStartShieldAmount", pctValue: 80 },
  { id: "gate_key", recipe: "mythic_cons_3", kind: "vampiric_heal", field: "vampiricHealFightsRemaining", value: 1000, pctField: "vampiricHealPct", pctValue: 20 },
  { id: "void_cauldron", recipe: "cosmic_cons_2", kind: "double_passive_trigger", field: "doublePassiveTriggerFightsRemaining", value: 1000 },
  { id: "chrono_vial", recipe: "cosmic_cons_3", kind: "self_revive", field: "selfReviveCharges", value: 1000, pctField: "selfReviveHpThresholdPct", pctValue: 50 },
];

test("all consumables define valid effects with positive durations", () => {
  ALL_CONSUMABLES.forEach(({ id, value }) => {
    const effect = getConsumableEffect(id);
    assert.ok(effect.kind, `${id} should define a kind`);
    assert.ok(value > 0, `${id} duration should be positive`);
  });
});

test("Frost Elixir applies +10% evade with 250 fight duration", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "bronze_cons_1");
  const effect = getConsumableEffect("frost_elixir");
  const result = useConsumable(db, "u1", "frost_elixir");
  assert.equal(result.effects.evadeBoostPct, effect.pct);
  assert.equal(result.effects.evadeBoostFightsRemaining, effect.fights);
});

test("Viridian Elixir applies +5 IV boost with 250 charges", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "bronze_cons_2");
  const effect = getConsumableEffect("viridian_elixir");
  const result = useConsumable(db, "u1", "viridian_elixir");
  assert.equal(result.effects.ivBoostCharges, effect.charges);
});

test("Sage's Tome applies +100% exp boost with 250 fight duration", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 10000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "bronze_cons_4");
  const effect = getConsumableEffect("exp_tome");
  const result = useConsumable(db, "u1", "exp_tome");
  assert.equal(result.effects.expBoostPct, effect.pct);
  assert.equal(result.effects.expBoostWinsRemaining, effect.fights);
});

test("Sacred Candles applies +80 shield with 1000 charges", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 50, coins: 100000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "mythic_cons_2");
  const effect = getConsumableEffect("sacred_candles");
  const result = useConsumable(db, "u1", "sacred_candles");
  assert.equal(result.effects.fightStartShieldCharges, effect.charges);
  assert.equal(result.effects.fightStartShieldAmount, effect.amount);
});

test("Void Cauldron applies double passive trigger with 1000 fight duration", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 60, coins: 200000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "cosmic_cons_2");
  const effect = getConsumableEffect("void_cauldron");
  const result = useConsumable(db, "u1", "void_cauldron");
  assert.equal(result.effects.doublePassiveTriggerFightsRemaining, effect.fights);
});

test("Chrono Vial applies 50% self-revive heal with 1000 charges", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 60, coins: 200000, selectedCard: makeCard(1, "C") });
  craftShopRecipe(db, "u1", "cosmic_cons_3");
  const effect = getConsumableEffect("chrono_vial");
  const result = useConsumable(db, "u1", "chrono_vial");
  assert.equal(effect.hpPct, 50);
  assert.equal(result.effects.selfReviveHpThresholdPct, effect.hpPct);
  assert.equal(result.effects.selfReviveCharges, effect.charges);
});

test("Solar Cauldron ascension applies +1 all stats and enforces cooldown", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 60, coins: 500000, selectedCard: makeCard(1, "C") });
  // Craft two so the second use attempt has one in inventory
  craftShopRecipe(db, "u1", "cosmic_cons_1");
  craftShopRecipe(db, "u1", "cosmic_cons_1");

  const before = getArenaProfilePayload(db, "u1");
  const result = useConsumable(db, "u1", "solar_cauldron");
  const after = getArenaProfilePayload(db, "u1");

  // Stats should increase by 1 each
  assert.equal(after.stats.total.hp, before.stats.total.hp + 1);
  assert.equal(after.stats.total.power, before.stats.total.power + 1);
  assert.equal(after.stats.total.guard, before.stats.total.guard + 1);
  assert.equal(after.stats.total.speed, before.stats.total.speed + 1);
  assert.equal(after.stats.total.effectHit, before.stats.total.effectHit + 1);

  // Cooldown timestamp should be set
  assert.ok(result.effects.ascensionLastPurchasedAt);
  assert.ok(new Date(result.effects.ascensionLastPurchasedAt).getTime() > Date.now() - 10000);

  // Second use within cooldown should throw
  assert.throws(
    () => useConsumable(db, "u1", "solar_cauldron"),
    /Solar|ascension|cooldown|ARENA_ASCENSION_COOLDOWN/i,
  );
});

test("consumable stacking is additive", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 20, coins: 100000, selectedCard: makeCard(1, "C") });

  craftShopRecipe(db, "u1", "silver_cons_1");
  const r1 = useConsumable(db, "u1", "sun_elixir");
  assert.equal(r1.effects.deathSaveCharges, 500, "1st use should give 500");

  craftShopRecipe(db, "u1", "silver_cons_1");
  const r2 = useConsumable(db, "u1", "sun_elixir");
  assert.equal(r2.effects.deathSaveCharges, 1000, "2nd use should add another 500");

  craftShopRecipe(db, "u1", "silver_cons_1");
  const r3 = useConsumable(db, "u1", "sun_elixir");
  assert.equal(r3.effects.deathSaveCharges, 1500, "3rd use should add another 500");
});

test("consumable recipes are not level locked", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 1, coins: 500000, selectedCard: makeCard(1, "C") });

  const result = craftShopRecipe(db, "u1", "cosmic_cons_3");

  assert.equal(result.outputItemId, "chrono_vial");
  assert.equal(result.shop.recipes.find((recipe) => recipe.id === "cosmic_cons_3")?.unlocked, true);
});

test("consumable inventory is capped per item", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 1, coins: 500000, selectedCard: makeCard(1, "C") });

  upsertInventoryItem(db, "u1", "red_tonic", 99);
  assert.throws(
    () => upsertInventoryItem(db, "u1", "red_tonic", 1),
    (error) => error instanceof ArenaHttpError && error.code === "ARENA_INVENTORY_CAP",
  );

  const shop = getArenaShopPayload(db, "u1");
  const redTonic = shop.shop.flatMap((tier) => tier.items).find((item) => item.id === "red_tonic");
  const redTonicRecipe = shop.recipes.find((recipe) => recipe.id === "rookie_cons_1");
  assert.equal(redTonic?.canCraft, false);
  assert.equal(redTonicRecipe?.canCraft, false);
});

test("active consumable effects replace the oldest after six kinds", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 60, coins: 500000, selectedCard: makeCard(1, "C") });

  // Use 6 different consumables — all should stay active (cap is 6).
  [
    ["rookie_cons_1", "red_tonic"],
    ["rookie_cons_2", "green_draft"],
    ["rookie_cons_3", "amber_draft"],
    ["bronze_cons_1", "frost_elixir"],
    ["silver_cons_1", "sun_elixir"],
    ["bronze_cons_2", "viridian_elixir"],
  ].forEach(([recipeId, itemId]) => {
    craftShopRecipe(db, "u1", recipeId);
    useConsumable(db, "u1", itemId);
  });

  const profile = getArenaProfilePayload(db, "u1");
  const activeKinds = profile.effects.activeConsumables.map((entry) => entry.kind);

  // All 6 should be active (no replacement yet).
  assert.deepEqual(activeKinds, [
    "shield_fight_start",
    "damage_boost",
    "speed_boost",
    "evade_next_fight",
    "death_save",
    "iv_boost",
  ]);
  assert.equal(profile.effects.fightStartShieldCharges, 100);
  assert.equal(profile.effects.damageBoostFightsRemaining, 500);
  assert.equal(profile.effects.deathSaveCharges, 500);
  assert.equal(profile.effects.ivBoostCharges, 250);
});

test("seventh consumable without force throws ARENA_CONSUMABLE_CAP_REACHED", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 60, coins: 500000, selectedCard: makeCard(1, "C") });

  // Fill the cap with 6 different consumables.
  [
    ["rookie_cons_1", "red_tonic"],
    ["rookie_cons_2", "green_draft"],
    ["rookie_cons_3", "amber_draft"],
    ["bronze_cons_1", "frost_elixir"],
    ["silver_cons_1", "sun_elixir"],
    ["bronze_cons_2", "viridian_elixir"],
  ].forEach(([recipeId, itemId]) => {
    craftShopRecipe(db, "u1", recipeId);
    useConsumable(db, "u1", itemId);
  });

  // Try a 7th without force — should throw.
  craftShopRecipe(db, "u1", "bronze_cons_3"); // Fuse Bomb
  let capError;
  assert.throws(
    () => useConsumable(db, "u1", "fuse_bomb"),
    (err) => {
      capError = err;
      return err.code === "ARENA_CONSUMABLE_CAP_REACHED";
    },
  );
  assert.equal(capError.details.activeConsumables.length, 6);
  assert.equal(capError.details.activeConsumables[0].itemId, "red_tonic");
  assert.equal(capError.details.activeConsumables[0].itemName, "Red Tonic");

  // Profile should be unchanged (transaction rolled back).
  const profile = getArenaProfilePayload(db, "u1");
  assert.equal(profile.effects.activeConsumables.length, 6);
  assert.equal(profile.effects.firstHitTrueDamageCharges, 0);
});

test("Solar Cauldron ascension does not count toward active consumable cap", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 60, coins: 500000, selectedCard: makeCard(1, "C") });

  [
    ["rookie_cons_1", "red_tonic"],
    ["rookie_cons_2", "green_draft"],
    ["rookie_cons_3", "amber_draft"],
    ["bronze_cons_1", "frost_elixir"],
    ["silver_cons_1", "sun_elixir"],
    ["bronze_cons_2", "viridian_elixir"],
  ].forEach(([recipeId, itemId]) => {
    craftShopRecipe(db, "u1", recipeId);
    useConsumable(db, "u1", itemId);
  });

  craftShopRecipe(db, "u1", "cosmic_cons_1");
  const result = useConsumable(db, "u1", "solar_cauldron");
  const activeKinds = result.effects.activeConsumables.map((entry) => entry.kind);

  assert.equal(result.effects.ascensionCount, 1);
  assert.equal(result.effects.activeConsumables.length, 6);
  assert.ok(!activeKinds.includes("ascension"));
  assert.deepEqual(activeKinds, [
    "shield_fight_start",
    "damage_boost",
    "speed_boost",
    "evade_next_fight",
    "death_save",
    "iv_boost",
  ]);
});

test("Phoenix Feather top-up does not require replacing oldest when tracking marker is missing", () => {
  const db = createTestDb();
  const now = new Date().toISOString();
  insertProfile(db, {
    userId: "u1",
    level: 60,
    coins: 500000,
    selectedCard: makeCard(1, "C"),
    effects: {
      fightStartShieldAmount: 60,
      fightStartShieldCharges: 100,
      damageBoostPct: 20,
      damageBoostFightsRemaining: 500,
      speedBoostPct: 12,
      speedBoostFightsRemaining: 500,
      evadeBoostPct: 10,
      evadeBoostFightsRemaining: 250,
      firstHitTrueDamageValue: 100,
      firstHitTrueDamageCharges: 250,
      ivBoostCharges: 250,
      deathSaveCharges: 1,
      activeConsumables: [
        { itemId: "red_tonic", kind: "shield_fight_start", activatedAt: now },
        { itemId: "green_draft", kind: "damage_boost", activatedAt: now },
        { itemId: "amber_draft", kind: "speed_boost", activatedAt: now },
        { itemId: "frost_elixir", kind: "evade_next_fight", activatedAt: now },
        { itemId: "fuse_bomb", kind: "first_hit_true_damage", activatedAt: now },
        { itemId: "viridian_elixir", kind: "iv_boost", activatedAt: now },
      ],
    },
  });
  upsertInventoryItem(db, "u1", "sun_elixir", 1);

  const result = useConsumable(db, "u1", "sun_elixir");

  assert.equal(result.effects.deathSaveCharges, 501);
  assert.equal(result.effects.fightStartShieldCharges, 100);
  assert.equal(result.effects.activeConsumables.length, 6);
});

test("expired Phoenix Feather marker is pruned before active consumable cap check", () => {
  const db = createTestDb();
  const now = new Date().toISOString();
  insertProfile(db, {
    userId: "u1",
    level: 60,
    coins: 500000,
    selectedCard: makeCard(1, "C"),
    effects: {
      fightStartShieldAmount: 60,
      fightStartShieldCharges: 100,
      damageBoostPct: 20,
      damageBoostFightsRemaining: 500,
      speedBoostPct: 12,
      speedBoostFightsRemaining: 500,
      evadeBoostPct: 10,
      evadeBoostFightsRemaining: 250,
      firstHitTrueDamageValue: 100,
      firstHitTrueDamageCharges: 250,
      deathSaveCharges: 0,
      activeConsumables: [
        { itemId: "red_tonic", kind: "shield_fight_start", activatedAt: now },
        { itemId: "green_draft", kind: "damage_boost", activatedAt: now },
        { itemId: "amber_draft", kind: "speed_boost", activatedAt: now },
        { itemId: "frost_elixir", kind: "evade_next_fight", activatedAt: now },
        { itemId: "fuse_bomb", kind: "first_hit_true_damage", activatedAt: now },
        { itemId: "sun_elixir", kind: "death_save", activatedAt: now },
      ],
    },
  });
  upsertInventoryItem(db, "u1", "sun_elixir", 1);

  const result = useConsumable(db, "u1", "sun_elixir");
  const activeKinds = result.effects.activeConsumables.map((entry) => entry.kind);

  assert.equal(result.effects.deathSaveCharges, 500);
  assert.deepEqual(activeKinds, [
    "shield_fight_start",
    "damage_boost",
    "speed_boost",
    "evade_next_fight",
    "first_hit_true_damage",
    "death_save",
  ]);
});

test("seventh consumable with force replaces the oldest active kind", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 60, coins: 500000, selectedCard: makeCard(1, "C") });

  // Fill the cap with 6 different consumables.
  [
    ["rookie_cons_1", "red_tonic"],
    ["rookie_cons_2", "green_draft"],
    ["rookie_cons_3", "amber_draft"],
    ["bronze_cons_1", "frost_elixir"],
    ["silver_cons_1", "sun_elixir"],
    ["bronze_cons_2", "viridian_elixir"],
  ].forEach(([recipeId, itemId]) => {
    craftShopRecipe(db, "u1", recipeId);
    useConsumable(db, "u1", itemId);
  });

  // Use a 7th with force — the oldest (red_tonic) should be replaced.
  craftShopRecipe(db, "u1", "bronze_cons_3"); // Fuse Bomb
  useConsumable(db, "u1", "fuse_bomb", true);

  const profile = getArenaProfilePayload(db, "u1");
  const activeKinds = profile.effects.activeConsumables.map((entry) => entry.kind);

  assert.deepEqual(activeKinds, [
    "damage_boost",
    "speed_boost",
    "evade_next_fight",
    "death_save",
    "iv_boost",
    "first_hit_true_damage",
  ]);
  // Oldest (red_tonic / shield_fight_start) was cleared.
  assert.equal(profile.effects.fightStartShieldCharges, 0);
  assert.equal(profile.effects.fightStartShieldAmount, 0);
  // Remaining effects should be intact.
  assert.equal(profile.effects.damageBoostFightsRemaining, 500);
  assert.equal(profile.effects.deathSaveCharges, 500);
  assert.equal(profile.effects.firstHitTrueDamageCharges, 250);
});

test("seventh consumable with force can replace a chosen active kind", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 60, coins: 500000, selectedCard: makeCard(1, "C") });

  [
    ["rookie_cons_1", "red_tonic"],
    ["rookie_cons_2", "green_draft"],
    ["rookie_cons_3", "amber_draft"],
    ["bronze_cons_1", "frost_elixir"],
    ["silver_cons_1", "sun_elixir"],
    ["bronze_cons_2", "viridian_elixir"],
  ].forEach(([recipeId, itemId]) => {
    craftShopRecipe(db, "u1", recipeId);
    useConsumable(db, "u1", itemId);
  });

  craftShopRecipe(db, "u1", "bronze_cons_3"); // Fuse Bomb
  useConsumable(db, "u1", "fuse_bomb", {
    force: true,
    replaceItemId: "amber_draft",
  });

  const profile = getArenaProfilePayload(db, "u1");
  const activeKinds = profile.effects.activeConsumables.map((entry) => entry.kind);

  assert.deepEqual(activeKinds, [
    "shield_fight_start",
    "damage_boost",
    "evade_next_fight",
    "death_save",
    "iv_boost",
    "first_hit_true_damage",
  ]);
  assert.equal(profile.effects.speedBoostFightsRemaining, 0);
  assert.equal(profile.effects.speedBoostPct, 0);
  assert.equal(profile.effects.fightStartShieldCharges, 100);
  assert.equal(profile.effects.firstHitTrueDamageCharges, 250);
});

test("consumable pct uses Math.max across different tiers", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 50, coins: 200000, selectedCard: makeCard(1, "C") });

  // Use red_tonic (60 shield) then sacred_candles (80 shield) — should keep 80
  craftShopRecipe(db, "u1", "rookie_cons_1");
  useConsumable(db, "u1", "red_tonic");

  craftShopRecipe(db, "u1", "mythic_cons_2");
  const result = useConsumable(db, "u1", "sacred_candles");

  assert.equal(result.effects.fightStartShieldAmount, 80, "should keep the higher shield amount");
  assert.equal(result.effects.fightStartShieldCharges, 1100);
});

test("evade boost pct is capped at 95", () => {
  const effects = normalizeArenaEffects({ evadeBoostPct: 150, evadeBoostFightsRemaining: 10 });
  assert.equal(effects.evadeBoostPct, 95);
});

test("damage boost pct is capped at 200", () => {
  const effects = normalizeArenaEffects({ damageBoostPct: 250, damageBoostFightsRemaining: 10 });
  assert.equal(effects.damageBoostPct, 200);
});

test("vampiric heal pct is capped at 100", () => {
  const effects = normalizeArenaEffects({ vampiricHealPct: 150, vampiricHealFightsRemaining: 10 });
  assert.equal(effects.vampiricHealPct, 100);
});

test("first hit true damage value is capped at 9999", () => {
  const effects = normalizeArenaEffects({ firstHitTrueDamageValue: 15000, firstHitTrueDamageCharges: 10 });
  assert.equal(effects.firstHitTrueDamageValue, 9999);
});

test("fight start shield amount is capped at 9999", () => {
  const effects = normalizeArenaEffects({ fightStartShieldAmount: 20000, fightStartShieldCharges: 10 });
  assert.equal(effects.fightStartShieldAmount, 9999);
});

test("higher rarity damage bonus pct is capped at 300", () => {
  const effects = normalizeArenaEffects({ higherRarityDamageBonusPct: 500, higherRarityDamageBonusPctCharges: 10 });
  assert.equal(effects.higherRarityDamageBonusPct, 300);
});

test("self revive threshold pct is capped at 95", () => {
  const effects = normalizeArenaEffects({ selfReviveHpThresholdPct: 120, selfReviveCharges: 10 });
  assert.equal(effects.selfReviveHpThresholdPct, 95);
});

test("non-consumable effect duration fields respect EFFECT_DURATION_LIMITS caps", () => {
  const overblown = {
    coinBoostWinsRemaining: 9999,
    drawBonusChanceWinsRemaining: 9999,
    rerollKeepHigherCharges: 9999,
    streakShieldCharges: 9999,
    upgradeLowestRarityCharges: 9999,
    guaranteeSsrPlusCharges: 9999,
    gateKeyCharges: 9999,
  };

  const effects = normalizeArenaEffects(overblown);

  const limits = {
    coinBoostWinsRemaining: 40,
    drawBonusChanceWinsRemaining: 60,
    rerollKeepHigherCharges: 4,
    streakShieldCharges: 6,
    upgradeLowestRarityCharges: 6,
    guaranteeSsrPlusCharges: 6,
    gateKeyCharges: 4,
  };

  Object.entries(limits).forEach(([field, cap]) => {
    assert.equal(effects[field], cap, `${field} should clamp to ${cap}`);
  });
});

test("repeated consumable stacking is additive", () => {
  const db = createTestDb();
  insertProfile(db, { userId: "u1", level: 50, coins: 500000, selectedCard: makeCard(1, "C") });

  for (let i = 0; i < 5; i++) {
    craftShopRecipe(db, "u1", "rookie_cons_3");
    const result = useConsumable(db, "u1", "amber_draft");
    assert.equal(result.effects.speedBoostFightsRemaining, 500 * (i + 1));
    assert.equal(result.effects.speedBoostPct, 12);
  }

  const profile = getArenaProfilePayload(db, "u1");
  assert.equal(profile.effects.speedBoostFightsRemaining, 2500);
});

test("consumable duration fields normalize large values unchanged", () => {
  const consumableFields = [
    { id: "exp_tome", field: "expBoostWinsRemaining", base: 250 },
    { id: "frost_elixir", field: "evadeBoostFightsRemaining", base: 250 },
    { id: "fuse_bomb", field: "firstHitTrueDamageCharges", base: 250 },
    { id: "viridian_elixir", field: "ivBoostCharges", base: 250 },
    { id: "green_draft", field: "damageBoostFightsRemaining", base: 500 },
    { id: "amber_draft", field: "speedBoostFightsRemaining", base: 500 },
    { id: "seeker_lens", field: "critChanceBoostFightsRemaining", base: 500 },
    { id: "oath_ribbon", field: "guardBoostFightsRemaining", base: 500 },
    { id: "sun_elixir", field: "deathSaveCharges", base: 500 },
    { id: "lantern_oil", field: "higherRarityDamageBonusPctCharges", base: 500 },
    { id: "star_tonic", field: "statSteroidFightsRemaining", base: 500 },
    { id: "gate_key", field: "vampiricHealFightsRemaining", base: 1000 },
    { id: "void_cauldron", field: "doublePassiveTriggerFightsRemaining", base: 1000 },
    { id: "prism_draught", field: "firstAttackDoubleCharges", base: 1000 },
    { id: "chrono_vial", field: "selfReviveCharges", base: 1000 },
    { id: "red_tonic", field: "fightStartShieldCharges", base: 100 },
    { id: "sacred_candles", field: "fightStartShieldCharges", base: 1000 },
    { id: "treasure_cache", field: "matchRarityCharges", base: 750 },
  ];

  consumableFields.forEach(({ id, field, base }) => {
    const effect = getConsumableEffect(id);
    const actualBase = effect.charges || effect.fights || 0;
    assert.equal(actualBase, base, `${id} base should be ${base}`);

    const effects = normalizeArenaEffects({ [field]: 99999 });
    assert.equal(effects[field], 99999, `${field} should not clamp`);
  });
});
