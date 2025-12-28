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

function updateUserById(id, { username, avatar, bio, banner, location, website }) {
  const user = getUserById(id);
  if (!user) return null;
  if (username && username !== user.username) {
    const existing = getUserByUsername(username);
    if (existing && existing.id !== id) throw new Error('username taken');
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, id);
  }
  if (avatar !== undefined) {
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, id);
  }
  if (bio !== undefined) {
    db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, id);
  }
  if (banner !== undefined) {
    db.prepare('UPDATE users SET banner = ? WHERE id = ?').run(banner, id);
  }
  if (location !== undefined) {
    db.prepare('UPDATE users SET location = ? WHERE id = ?').run(location, id);
  }
  if (website !== undefined) {
    db.prepare('UPDATE users SET website = ? WHERE id = ?').run(website, id);
  }
  return getUserById(id);
}

function findOrCreateDiscordUser(discordProfile) {
  // Check if user exists by Discord ID
  const existingUser = db.prepare('SELECT * FROM users WHERE discordId = ?').get(discordProfile.id);
  if (existingUser) {
    // Update avatar and banner if they've changed
    const avatar = discordProfile.avatar 
      ? `https://cdn.discordapp.com/avatars/${discordProfile.id}/${discordProfile.avatar}.png`
      : null;
    const banner = discordProfile.banner 
      ? `https://cdn.discordapp.com/banners/${discordProfile.id}/${discordProfile.banner}.png?size=600`
      : null;
    
    if (avatar !== existingUser.avatar || banner !== existingUser.banner) {
      db.prepare('UPDATE users SET avatar = ?, banner = ? WHERE id = ?').run(avatar, banner, existingUser.id);
      return getUserById(existingUser.id);
    }
    return existingUser;
  }
  
  // Create new user from Discord profile
  const id = Date.now().toString();
  const username = discordProfile.username || `discord_${discordProfile.id}`;
  const avatar = discordProfile.avatar 
    ? `https://cdn.discordapp.com/avatars/${discordProfile.id}/${discordProfile.avatar}.png`
    : null;
  const banner = discordProfile.banner 
    ? `https://cdn.discordapp.com/banners/${discordProfile.id}/${discordProfile.banner}.png?size=600`
    : null;
  const createdAt = new Date().toISOString();
  
  db.prepare('INSERT INTO users (id, username, discordId, avatar, banner, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, username, discordProfile.id, avatar, banner, createdAt);
  
  return getUserById(id);
}

module.exports = {
  makeToken,
  userPublic,
  getUserByUsername,
  getUserById,
  createSession,
  getUserByToken,
  updateUserById,
  findOrCreateDiscordUser,
};
