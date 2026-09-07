const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs");

// Point lib/db at a throwaway database before it is required.
const TMP_DB = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "users-profile-")),
  "test.sqlite3",
);
process.env.DB_FILE = TMP_DB;

const { db } = require("../lib/db");
const users = require("../lib/users");

test.after(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  fs.rmSync(path.dirname(TMP_DB), { recursive: true, force: true });
});

function makeUser(id, username) {
  db.prepare(
    "INSERT INTO users (id, username, createdAt) VALUES (?, ?, ?)",
  ).run(id, username, new Date().toISOString());
}

test("updateUserById enforces the username pattern", () => {
  makeUser("p1", "Mira");
  makeUser("p2", "bob");

  assert.throws(() => users.updateUserById("p2", { username: "ab" }), /invalid username/);
  assert.throws(() => users.updateUserById("p2", { username: "b o b" }), /invalid username/);
  assert.throws(() => users.updateUserById("p2", { username: "bбb" }), /invalid username/); // Cyrillic
  assert.throws(
    () => users.updateUserById("p2", { username: "x".repeat(31) }),
    /invalid username/,
  );

  const ok = users.updateUserById("p2", { username: "bob_2" });
  assert.equal(ok.username, "bob_2");
});

test("updateUserById rejects a case-insensitive username collision", () => {
  makeUser("p3", "Charlie");
  makeUser("p4", "dave");

  assert.throws(
    () => users.updateUserById("p4", { username: "CHARLIE" }),
    /username taken/,
  );

  // Re-casing your own handle is allowed.
  const recased = users.updateUserById("p3", { username: "charlie" });
  assert.equal(recased.username, "charlie");
});

test("updateUserById caps bio and location length", () => {
  makeUser("p5", "erin");
  const updated = users.updateUserById("p5", {
    bio: "x".repeat(999),
    location: "y".repeat(999),
  });
  assert.equal(updated.bio.length, 500);
  assert.equal(updated.location.length, 100);
});

test("revokeUserSessions drops every session for a user", () => {
  makeUser("p6", "frank");
  const tokenA = users.makeToken();
  const tokenB = users.makeToken();
  users.createSession(tokenA, "p6");
  users.createSession(tokenB, "p6");
  assert.ok(users.getUserByToken(tokenA));

  users.revokeUserSessions("p6");

  assert.equal(users.getUserByToken(tokenA), null);
  assert.equal(users.getUserByToken(tokenB), null);
});
