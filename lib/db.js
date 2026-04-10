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
    `CREATE TABLE IF NOT EXISTS anime (
    id TEXT PRIMARY KEY,
    title TEXT,
    url TEXT,
    img TEXT,
    ord INTEGER
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS myanimelist_anime_snapshots (
    feedKey TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    fetchedAt TEXT NOT NULL,
    payloadJson TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS quote_snapshots (
    recordedDate TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    sourceType TEXT NOT NULL,
    displayDate TEXT,
    publishedAt TEXT,
    fetchedAt TEXT NOT NULL,
    fallbackReason TEXT,
    quotesJson TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS guestbook_entries (
    id TEXT PRIMARY KEY,
    userId TEXT,
    author TEXT NOT NULL,
    message TEXT NOT NULL,
    website TEXT,
    mood TEXT,
    x INTEGER,
    y INTEGER,
    createdAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS daily_questions (
    recordedDate TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    createdByUserId TEXT,
    lockedAt TEXT,
    archivedAt TEXT,
    discordNotifiedAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS daily_question_answers (
    id TEXT PRIMARY KEY,
    recordedDate TEXT NOT NULL,
    userId TEXT,
    guestName TEXT,
    identityType TEXT NOT NULL,
    identityKey TEXT NOT NULL,
    answer TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS shrine_pages (
    slug TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    excerpt TEXT,
    image TEXT,
    imageAlt TEXT,
    schemaType TEXT,
    aboutJson TEXT,
    keywordsJson TEXT,
    ctaLabel TEXT,
    priority TEXT,
    changefreq TEXT,
    payloadJson TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
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

  ensureColumn("guestbook_entries", "x", "INTEGER");
  ensureColumn("guestbook_entries", "y", "INTEGER");

  ensureColumn("daily_questions", "lockedAt", "TEXT");
  ensureColumn("daily_questions", "archivedAt", "TEXT");
  ensureColumn("daily_questions", "discordNotifiedAt", "TEXT");

  ensureColumn("shrine_pages", "description", "TEXT");
  ensureColumn("shrine_pages", "excerpt", "TEXT");
  ensureColumn("shrine_pages", "image", "TEXT");
  ensureColumn("shrine_pages", "imageAlt", "TEXT");
  ensureColumn("shrine_pages", "schemaType", "TEXT");
  ensureColumn("shrine_pages", "aboutJson", "TEXT");
  ensureColumn("shrine_pages", "keywordsJson", "TEXT");
  ensureColumn("shrine_pages", "ctaLabel", "TEXT");
  ensureColumn("shrine_pages", "priority", "TEXT");
  ensureColumn("shrine_pages", "changefreq", "TEXT");
  ensureColumn("shrine_pages", "payloadJson", "TEXT");
  ensureColumn("shrine_pages", "updatedAt", "TEXT");
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
      `CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId)`,
    ).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_anime_ord ON anime(ord)`).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_myanimelist_anime_snapshots_fetchedAt ON myanimelist_anime_snapshots(fetchedAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_quote_snapshots_fetchedAt ON quote_snapshots(fetchedAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_guestbook_entries_createdAt ON guestbook_entries(createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_daily_questions_updatedAt ON daily_questions(updatedAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_daily_question_answers_recordedDate_createdAt ON daily_question_answers(recordedDate, createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_question_answers_identity ON daily_question_answers(recordedDate, identityType, identityKey)`,
    ).run();
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_shrine_pages_path ON shrine_pages(path)`,
    ).run();
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
