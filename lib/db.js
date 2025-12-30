const path = require('path');
const Database = require('better-sqlite3');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'database.sqlite3');
console.log('Using database file:', DB_FILE);
const db = new Database(DB_FILE);

// Enable performance optimizations
db.pragma('journal_mode = WAL'); // Write-Ahead Logging for better concurrency
db.pragma('synchronous = NORMAL'); // Faster writes with minimal risk
db.pragma('cache_size = -64000'); // 64MB cache
db.pragma('temp_store = MEMORY'); // Store temp tables in memory
db.pragma('mmap_size = 268435456'); // 256MB memory-mapped I/O

db.prepare(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  passwordHash TEXT,
  avatar TEXT,
  createdAt TEXT
)`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  userId TEXT
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  title TEXT,
  content TEXT,
  userId TEXT,
  author TEXT,
  shortDescription TEXT,
  thumbnail TEXT,
  createdAt TEXT
)`).run();

function ensureColumn(table, column, definition) {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    const found = info.some((row) => row.name === column);
    if (!found) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
      console.log(`Added column ${column} to ${table}`);
    }
  } catch (err) {
    console.error(`Failed to ensure column ${column} on ${table}:`, err);
  }
}

ensureColumn('posts', 'shortDescription', 'TEXT');
ensureColumn('posts', 'thumbnail', 'TEXT');
ensureColumn('posts', 'tags', 'TEXT');

ensureColumn('users', 'bio', 'TEXT');
ensureColumn('users', 'banner', 'TEXT');
ensureColumn('users', 'location', 'TEXT');
ensureColumn('users', 'website', 'TEXT');
ensureColumn('users', 'discordId', 'TEXT');

db.prepare(`CREATE TABLE IF NOT EXISTS videos (
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
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS anime (
  id TEXT PRIMARY KEY,
  title TEXT,
  url TEXT,
  img TEXT,
  ord INTEGER
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS pics (
  id TEXT PRIMARY KEY,
  title TEXT,
  url TEXT,
  userId TEXT,
  likes TEXT,
  comments TEXT,
  createdAt TEXT
)`).run();

// Create indexes for faster queries
try {
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_posts_userId ON posts(userId)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_posts_createdAt ON posts(createdAt DESC)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_videos_userId ON videos(userId)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_videos_createdAt ON videos(createdAt DESC)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_pics_userId ON pics(userId)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_pics_createdAt ON pics(createdAt DESC)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_anime_ord ON anime(ord)`).run();
  console.log('Database indexes created successfully');
} catch (err) {
  console.error('Failed to create indexes:', err);
}

module.exports = { db };
