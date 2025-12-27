const bcrypt = require('bcryptjs');
const { db } = require('./db');
const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET;

function makeToken() {
  const id = crypto.randomBytes(16).toString('hex');
  if (!SESSION_SECRET) {
    return id;
  }
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(id).digest('hex');
  return `${id}.${hmac}`;
}

function userPublic(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function createUser(username, password) {
  const id = Date.now().toString();
  const passwordHash = bcrypt.hashSync(password, 10);
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO users (id, username, passwordHash, avatar, createdAt) VALUES (?, ?, ?, ?, ?)')
    .run(id, username, passwordHash, null, createdAt);
  return getUserById(id);
}

function createSession(token, userId) {
  db.prepare('INSERT INTO sessions (token, userId) VALUES (?, ?)').run(token, userId);
}

function getUserByToken(token) {
  if (!token) return null;
  if (SESSION_SECRET && token.includes('.')) {
    const [id, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(id).digest('hex');
    if (sig !== expected) return null;
  }
  return db.prepare('SELECT u.* FROM sessions s JOIN users u ON s.userId = u.id WHERE s.token = ?').get(token);
}

function updateUserById(id, { username, password, avatar }) {
  const user = getUserById(id);
  if (!user) return null;
  if (username && username !== user.username) {
    const existing = getUserByUsername(username);
    if (existing && existing.id !== id) throw new Error('username taken');
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, id);
  }
  if (password) {
    const passwordHash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(passwordHash, id);
  }
  if (avatar) {
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, id);
  }
  return getUserById(id);
}

module.exports = {
  makeToken,
  userPublic,
  getUserByUsername,
  getUserById,
  createUser,
  createSession,
  getUserByToken,
  updateUserById,
};
