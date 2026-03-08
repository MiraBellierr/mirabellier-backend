const path = require("path");
const Database = require("better-sqlite3");
const fs = require("fs");

const DB_FILE =
  process.env.DB_FILE || path.join(__dirname, "..", "database.sqlite3");

function ensureDbDirectoryExists(filePath) {
  const dbDir = path.dirname(filePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

function configurePragmas(db) {
  // Write-Ahead Logging for better concurrency
  db.pragma("journal_mode = WAL");
  // Faster writes with minimal risk
  db.pragma("synchronous = NORMAL");
  // 64MB cache
  db.pragma("cache_size = -64000");
  // Store temp tables in memory
  db.pragma("temp_store = MEMORY");
  // 256MB memory-mapped I/O
  db.pragma("mmap_size = 268435456");
}

function createBaseTables(db) {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    passwordHash TEXT,
    avatar TEXT,
    createdAt TEXT
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    userId TEXT
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    title TEXT,
    content TEXT,
    userId TEXT,
    author TEXT,
    shortDescription TEXT,
    thumbnail TEXT,
    likes TEXT,
    comments TEXT,
    createdAt TEXT,
    updatedAt TEXT
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    url TEXT,
    userId TEXT,
    likes TEXT,
    comments TEXT,
    createdAt TEXT,
    source TEXT,
    originalMetadata TEXT
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS anime (
    id TEXT PRIMARY KEY,
    title TEXT,
    url TEXT,
    img TEXT,
    ord INTEGER
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS pics (
    id TEXT PRIMARY KEY,
    title TEXT,
    url TEXT,
    userId TEXT,
    likes TEXT,
    comments TEXT,
    createdAt TEXT
  )`,
  ).run();
}

function ensureColumn(table, column, definition) {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    const found = info.some((row) => row.name === column);
    if (!found) {
      db.prepare(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
      ).run();
    }
  } catch {
    // Keep startup resilient if a migration step fails.
  }
}

function ensureColumns(db) {
  ensureColumn("posts", "shortDescription", "TEXT");
  ensureColumn("posts", "thumbnail", "TEXT");
  ensureColumn("posts", "tags", "TEXT");
  ensureColumn("posts", "likes", "TEXT");
  ensureColumn("posts", "comments", "TEXT");
  ensureColumn("posts", "updatedAt", "TEXT");

  ensureColumn("users", "bio", "TEXT");
  ensureColumn("users", "banner", "TEXT");
  ensureColumn("users", "location", "TEXT");
  ensureColumn("users", "website", "TEXT");
  ensureColumn("users", "discordId", "TEXT");
}

function createIndexes(db) {
  try {
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_posts_userId ON posts(userId)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_posts_createdAt ON posts(createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_videos_userId ON videos(userId)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_videos_createdAt ON videos(createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_pics_userId ON pics(userId)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_pics_createdAt ON pics(createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId)`,
    ).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_anime_ord ON anime(ord)`).run();
  } catch {
    // Startup should continue even if index creation fails.
  }
}

ensureDbDirectoryExists(DB_FILE);
const db = new Database(DB_FILE);
configurePragmas(db);
createBaseTables(db);
ensureColumns(db);
createIndexes(db);

module.exports = { db };
