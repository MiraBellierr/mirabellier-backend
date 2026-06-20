const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const {
  migrateArenaCardRarities,
} = require("../scripts/migrate-arena-card-rarities.cjs");

function createMigrationDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE arena_card_collection (
      id TEXT PRIMARY KEY,
      cardJson TEXT
    );
    CREATE TABLE arena_profiles (
      userId TEXT PRIMARY KEY,
      selectedCardJson TEXT
    );
    CREATE TABLE arena_daily_card_offers (
      offerId TEXT PRIMARY KEY,
      cardJson TEXT
    );
  `);
  return db;
}

function card(favorites, rarity, extra = {}) {
  return JSON.stringify({
    malId: 1,
    title: "Test Card",
    imageUrl: "https://example.com/card.jpg",
    favorites,
    rarity,
    iv: { power: 1, guard: 2, speed: 3, luck: 4, total: 10 },
    ...extra,
  });
}

test("card rarity migration previews and applies all stored card locations", () => {
  const db = createMigrationDb();
  db.prepare(
    `INSERT INTO arena_card_collection (id, cardJson) VALUES (?, ?)`,
  ).run("collection-1", card(30000, "SSR", { marker: "preserved" }));
  db.prepare(
    `INSERT INTO arena_profiles (userId, selectedCardJson) VALUES (?, ?)`,
  ).run("user-1", card(25000, "UR"));
  db.prepare(
    `INSERT INTO arena_daily_card_offers (offerId, cardJson) VALUES (?, ?)`,
  ).run("offer-1", card(0, "SR"));

  const preview = migrateArenaCardRarities(db);
  assert.equal(preview.apply, false);
  assert.equal(preview.totalChanged, 3);
  assert.equal(
    JSON.parse(
      db.prepare(`SELECT cardJson FROM arena_card_collection`).get().cardJson,
    ).rarity,
    "SSR",
  );

  const applied = migrateArenaCardRarities(db, { apply: true });
  assert.equal(applied.totalChanged, 3);

  const collected = JSON.parse(
    db.prepare(`SELECT cardJson FROM arena_card_collection`).get().cardJson,
  );
  const selected = JSON.parse(
    db.prepare(`SELECT selectedCardJson FROM arena_profiles`).get()
      .selectedCardJson,
  );
  const offer = JSON.parse(
    db.prepare(`SELECT cardJson FROM arena_daily_card_offers`).get().cardJson,
  );

  assert.equal(collected.rarity, "UR");
  assert.equal(collected.marker, "preserved");
  assert.deepEqual(collected.iv, {
    power: 1,
    guard: 2,
    speed: 3,
    luck: 4,
    total: 10,
  });
  assert.equal(selected.rarity, "SSR");
  assert.equal(offer.rarity, "C");
  db.close();
});

test("card rarity migration leaves missing favorites and invalid JSON untouched", () => {
  const db = createMigrationDb();
  db.prepare(
    `INSERT INTO arena_card_collection (id, cardJson) VALUES (?, ?)`,
  ).run("missing-favorites", card(undefined, "SR"));
  db.prepare(
    `INSERT INTO arena_profiles (userId, selectedCardJson) VALUES (?, ?)`,
  ).run("invalid-json", "{not-json");

  const result = migrateArenaCardRarities(db, { apply: true });
  assert.equal(result.totalChanged, 0);
  assert.equal(result.totalSkippedMissing, 1);
  assert.equal(result.totalInvalidJson, 1);
  assert.equal(
    db
      .prepare(`SELECT selectedCardJson FROM arena_profiles`)
      .get().selectedCardJson,
    "{not-json",
  );
  db.close();
});
