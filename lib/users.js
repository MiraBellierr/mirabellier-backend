const { db } = require("./db");
const crypto = require("crypto");
const { serializePublicUser } = require("./public-user");
const { sanitizeWebsite, sanitizeMediaUrl } = require("./sanitize-website");

const SESSION_SECRET = process.env.SESSION_SECRET;
const USER_UPDATE_FIELDS = ["avatar", "bio", "banner", "location", "website"];

// Profile field constraints. Username is ASCII-only (letters, digits, and
// . _ -) so visually-confusable Unicode (e.g. Cyrillic і for "i") cannot be
// used to impersonate another handle.
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,30}$/;
const MAX_BIO_LENGTH = 500;
const MAX_LOCATION_LENGTH = 100;

// Server-side session lifetime. Kept in step with the auth cookie's Max-Age so a
// token cannot outlive its cookie. Defaults to 30 days.
const SESSION_TTL_MS = (() => {
  const seconds = Number.parseInt(
    process.env.SESSION_COOKIE_MAX_AGE_SECONDS || "",
    10,
  );
  return (Number.isFinite(seconds) && seconds > 0
    ? seconds
    : 60 * 60 * 24 * 30) * 1000;
})();

function signSessionId(id) {
  if (!SESSION_SECRET) return id;

  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(id)
    .digest("hex");
  return `${id}.${signature}`;
}

// When a signing secret is configured the signature is enforced: a token with
// no signature, a malformed signature, or a mismatch is rejected outright
// (constant-time compare). With no secret configured, signing is a no-op and
// every token shape is accepted.
function isValidSignedToken(token) {
  if (!SESSION_SECRET) return true;

  const separatorIndex = String(token).indexOf(".");
  if (separatorIndex === -1) return false;

  const id = token.slice(0, separatorIndex);
  const providedSignature = token.slice(separatorIndex + 1);
  const expectedSignature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(id)
    .digest("hex");

  let providedBuffer;
  let expectedBuffer;
  try {
    providedBuffer = Buffer.from(providedSignature, "hex");
    expectedBuffer = Buffer.from(expectedSignature, "hex");
  } catch {
    return false;
  }
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

// Only the SHA-256 of a session token is persisted, so a leaked database file
// (or an old backup) does not hand over usable session tokens.
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
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
  return serializePublicUser(user);
}

function getUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}

function getUserByUsernameCaseInsensitive(username) {
  return db
    .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
    .get(username);
}

function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function createSession(token, userId) {
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (token, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)",
  ).run(
    hashToken(token),
    userId,
    new Date(now).toISOString(),
    new Date(now + SESSION_TTL_MS).toISOString(),
  );
}

function deleteSession(token) {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token = ?").run(hashToken(token));
}

// Drop every session for a user. Used on an identity change (username edit) so
// a stale cookie cannot keep riding the old identity; the caller re-issues a
// fresh session for the current device.
function revokeUserSessions(userId) {
  db.prepare("DELETE FROM sessions WHERE userId = ?").run(String(userId));
}

// Drop sessions that have expired (or predate the createdAt/expiresAt columns
// and can no longer be matched anyway).
function sweepExpiredSessions() {
  try {
    db.prepare(
      "DELETE FROM sessions WHERE expiresAt IS NULL OR expiresAt <= ?",
    ).run(new Date().toISOString());
  } catch {
    // Non-fatal: a failed sweep just means stale rows linger until the next one.
  }
}

function getUserByToken(token) {
  if (!token) return null;
  if (!isValidSignedToken(token)) return null;

  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      "SELECT u.*, s.expiresAt AS __sessionExpiresAt FROM sessions s JOIN users u ON s.userId = u.id WHERE s.token = ?",
    )
    .get(tokenHash);
  if (!row) return null;

  const expiresAt = Date.parse(row.__sessionExpiresAt || "");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(tokenHash);
    return null;
  }

  delete row.__sessionExpiresAt;
  return row;
}

function updateUserById(
  id,
  { username, avatar, bio, banner, location, website },
) {
  const user = getUserById(id);
  if (!user) return null;

  // An empty / whitespace username means "not provided" (a form that always
  // submits the field), not an attempt to blank it — skip it, don't 400.
  const nextUsername =
    username === undefined ? undefined : String(username).trim();
  if (nextUsername && nextUsername !== user.username) {
    if (!USERNAME_PATTERN.test(nextUsername)) {
      throw new Error("invalid username");
    }
    const existing = getUserByUsernameCaseInsensitive(nextUsername);
    if (existing && existing.id !== id) throw new Error("username taken");
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(
      nextUsername,
      id,
    );
  }

  // Never persist a raw client string for fields that are rendered as href/src.
  // An empty string is a deliberate "clear this field"; only `undefined` skips.
  const normalize = (value, sanitize) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    return sanitize(value);
  };
  const capLength = (max) => (value) => String(value).slice(0, max);

  const updates = {
    avatar: normalize(avatar, sanitizeMediaUrl),
    bio: normalize(bio, capLength(MAX_BIO_LENGTH)),
    banner: normalize(banner, sanitizeMediaUrl),
    location: normalize(location, capLength(MAX_LOCATION_LENGTH)),
    website: normalize(website, sanitizeWebsite),
  };
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

// Sweep once at boot, then hourly. Unref so the timer never keeps the process
// (or a test runner) alive on its own.
sweepExpiredSessions();
const sessionSweepTimer = setInterval(sweepExpiredSessions, 60 * 60 * 1000);
if (typeof sessionSweepTimer.unref === "function") sessionSweepTimer.unref();

module.exports = {
  makeToken,
  userPublic,
  getUserByUsername,
  getUserById,
  createSession,
  deleteSession,
  revokeUserSessions,
  getUserByToken,
  sweepExpiredSessions,
  updateUserById,
  findOrCreateDiscordUser,
};
