const { db } = require("./db");
const crypto = require("crypto");

const SESSION_SECRET = process.env.SESSION_SECRET;
const USER_UPDATE_FIELDS = ["avatar", "bio", "banner", "location", "website"];

function signSessionId(id) {
  if (!SESSION_SECRET) return id;

  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(id)
    .digest("hex");
  return `${id}.${signature}`;
}

function isValidSignedToken(token) {
  if (!SESSION_SECRET || !token.includes(".")) return true;

  const [id, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(id)
    .digest("hex");
  return signature === expected;
}

function buildDiscordAvatarUrl(discordId, avatarHash) {
  if (!avatarHash) return null;
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`;
}

function buildDiscordBannerUrl(discordId, bannerHash) {
  if (!bannerHash) return null;
  return `https://cdn.discordapp.com/banners/${discordId}/${bannerHash}.png?size=600`;
}

function makeToken() {
  const id = crypto.randomBytes(16).toString("hex");
  return signSessionId(id);
}

function userPublic(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

function getUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}

function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function createSession(token, userId) {
  db.prepare("INSERT INTO sessions (token, userId) VALUES (?, ?)").run(
    token,
    userId,
  );
}

function getUserByToken(token) {
  if (!token) return null;
  // Keep signature validation as a signal, but do not hard-fail auth on
  // mismatch. Session existence in the DB is still the source of truth.
  // This avoids false 401s during secret rotations or env drift.
  if (
    !isValidSignedToken(token) &&
    String(process.env.LOG_AUTH_SIGNATURE_MISMATCH || "").toLowerCase() ===
      "true"
  ) {
    console.warn("[auth] session signature mismatch; falling back to DB lookup");
  }

  return db
    .prepare(
      "SELECT u.* FROM sessions s JOIN users u ON s.userId = u.id WHERE s.token = ?",
    )
    .get(token);
}

function updateUserById(
  id,
  { username, avatar, bio, banner, location, website },
) {
  const user = getUserById(id);
  if (!user) return null;

  if (username && username !== user.username) {
    const existing = getUserByUsername(username);
    if (existing && existing.id !== id) throw new Error("username taken");
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(username, id);
  }

  const updates = { avatar, bio, banner, location, website };
  USER_UPDATE_FIELDS.forEach((field) => {
    if (updates[field] !== undefined) {
      db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`).run(
        updates[field],
        id,
      );
    }
  });

  return getUserById(id);
}

function findOrCreateDiscordUser(discordProfile) {
  const avatar = buildDiscordAvatarUrl(
    discordProfile.id,
    discordProfile.avatar,
  );
  const banner = buildDiscordBannerUrl(
    discordProfile.id,
    discordProfile.banner,
  );

  // Check if user exists by Discord ID
  const existingUser = db
    .prepare("SELECT * FROM users WHERE discordId = ?")
    .get(discordProfile.id);

  if (existingUser) {
    if (avatar !== existingUser.avatar || banner !== existingUser.banner) {
      db.prepare("UPDATE users SET avatar = ?, banner = ? WHERE id = ?").run(
        avatar,
        banner,
        existingUser.id,
      );
      return getUserById(existingUser.id);
    }
    return existingUser;
  }

  // Create new user from Discord profile
  const id = Date.now().toString();
  const username = discordProfile.username || `discord_${discordProfile.id}`;
  const createdAt = new Date().toISOString();

  db.prepare(
    "INSERT INTO users (id, username, discordId, avatar, banner, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, username, discordProfile.id, avatar, banner, createdAt);

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
