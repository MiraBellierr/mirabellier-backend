const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const {
  ArenaHttpError,
  createArenaUpdate,
  deleteArenaUpdate,
  getArenaUpdates,
} = require("../lib/arena-service");

function createDb() {
  const db = new Database(":memory:");
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
  return db;
}

test("arena updates are validated, listed newest first, and deletable", () => {
  const db = createDb();
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
  assert.equal(updates[0].id, second.id);
  assert.equal(updates[1].id, first.id);
  assert.deepEqual(deleteArenaUpdate(db, first.id), {
    deletedUpdateId: first.id,
  });
  assert.equal(getArenaUpdates(db).length, 1);
});
