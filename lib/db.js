const path = require('path');
const Database = require('better-sqlite3');

const DB_FILE = process.env.DB_FILE;
const db = new Database(DB_FILE);

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

module.exports = { db };
