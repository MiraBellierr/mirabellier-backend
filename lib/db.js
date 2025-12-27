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
  createdAt TEXT
)`).run();

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
