const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const {
  ArenaHttpError,
  buyShopItem,
  calculateRoundPower,
  calculateWinCoins,
  calculateWinXp,
  drawDailyCard,
  getArenaCollectionPayload,
  getArenaProfilePayload,
  getLeaderboard,
  rarityFromFavorites,
  resolveRoundWinner,
  runFight,
  selectCollectionCard,
  useConsumable,
  xpToNext,
} = require("../lib/arena-service");

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

  return db;
}

function insertProfile(db, input) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO arena_profiles (
      userId, level, xp, coins, wins, losses, winStreak,
      hp, power, guard, speed, luck, lifetimeCoinsEarned,
      selectedCardJson, lastCardDrawDate, dailyCardDrawCount, effectsJson, lastFightAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    JSON.stringify(
      input.effects ?? {
        expBoostPct: 0,
        expBoostWinsRemaining: 0,
        coinBoostPct: 0,
        coinBoostWinsRemaining: 0,
        refocusCharges: 0,
        streakShieldCharges: 0,
        upgradeLowestRarityCharges: 0,
        guaranteeSsrPlusCharges: 0,
        ascensionLastPurchasedAt: null,
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

test("favorites-based rarity mapping uses MAL min/max range", () => {
  assert.equal(rarityFromFavorites(0), "C");
  assert.equal(rarityFromFavorites(53), "C");
  assert.equal(rarityFromFavorites(7000), "R");
  assert.equal(rarityFromFavorites(60000), "SR");
  assert.equal(rarityFromFavorites(130000), "SSR");
  assert.equal(rarityFromFavorites(175000), "UR");
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
  assert.equal(response.profile.losses, 1);
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
  assert.ok(result.battle.console.some((entry) => entry.line.includes("attacked")));
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

test("buying gear consumes coins and equips item", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 10,
    coins: 1000,
    selectedCard: makeCard(1, "C"),
  });

  const buyResult = buyShopItem(db, "u1", "tin_sword");
  assert.equal(buyResult.purchasedItemId, "tin_sword");
  assert.equal(buyResult.shop.profile.coins, 700);
  assert.equal(buyResult.shop.equipped.weapon?.itemId, "tin_sword");
});

test("using consumable applies effect and consumes quantity", () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
    level: 20,
    coins: 1000,
    selectedCard: makeCard(1, "C"),
  });

  buyShopItem(db, "u1", "cracked_xp_tome");
  const useResult = useConsumable(db, "u1", "cracked_xp_tome");
  assert.equal(useResult.activatedItemId, "cracked_xp_tome");
  assert.equal(useResult.effects.expBoostPct, 35);
  assert.equal(useResult.effects.expBoostWinsRemaining, 1);

  const profile = getArenaProfilePayload(db, "u1");
  assert.equal(profile.effects.expBoostPct, 35);
  assert.equal(profile.effects.expBoostWinsRemaining, 1);
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

test("daily draw is limited to five cards per day", async () => {
  const db = createTestDb();
  insertProfile(db, {
    userId: "u1",
  });

  for (let index = 0; index < 5; index += 1) {
    const draw = await drawDailyCard(db, "u1");
    assert.ok(draw.card);
    assert.ok(draw.profile.selectedCard);
    assert.equal(draw.profile.dailyDrawLimit, 5);
    assert.equal(draw.profile.dailyDrawsUsed, index + 1);
    assert.equal(draw.profile.dailyDrawsRemaining, Math.max(5 - (index + 1), 0));
  }

  const collection = getArenaCollectionPayload(db, "u1");
  assert.ok(collection.cards.length >= 5);

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
