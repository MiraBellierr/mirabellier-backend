const express = require("express");
const { isOwner } = require("../lib/authz");
const {
  TurnstileError,
  verifyTurnstileToken,
} = require("../lib/turnstile");

const MAX_ENTRIES = 100;
const MAX_NAME_LENGTH = 40;
const MAX_MESSAGE_LENGTH = 400;
const NOTE_SIZE = 280;
const BOARD_IMAGE_WIDTH = 1199;
const BOARD_IMAGE_HEIGHT = 678;
const BOARD_SCALE = 3;
const BOARD_WIDTH = BOARD_IMAGE_WIDTH * BOARD_SCALE;
const BOARD_HEIGHT = BOARD_IMAGE_HEIGHT * BOARD_SCALE;
const BOARD_PADDING = 48;
const GRID_COLUMNS = 6;
const ALLOWED_MOODS = new Set([
  "sparkly",
  "cozy",
  "sleepy",
  "sunny",
  "chaotic",
]);

function collapseWhitespace(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function sanitizeName(value) {
  return collapseWhitespace(value).slice(0, MAX_NAME_LENGTH);
}

function sanitizeMessage(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

function sanitizeMood(value) {
  const normalized = collapseWhitespace(value).toLowerCase();
  return ALLOWED_MOODS.has(normalized) ? normalized : "sparkly";
}

function sanitizeWebsite(value) {
  const trimmed = collapseWhitespace(value);
  if (!trimmed) return null;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString().slice(0, 200);
  } catch {
    return null;
  }
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sanitizeCoordinate(value, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(clampNumber(parsed, 0, max));
}

function getFallbackPosition(index) {
  const column = index % GRID_COLUMNS;
  const row = Math.floor(index / GRID_COLUMNS);
  const x = BOARD_PADDING + column * (NOTE_SIZE + 32);
  const y = BOARD_PADDING + row * (NOTE_SIZE + 42);

  return {
    x: clampNumber(x, 0, BOARD_WIDTH - NOTE_SIZE),
    y: clampNumber(y, 0, BOARD_HEIGHT - NOTE_SIZE),
  };
}

function pickWebsite(row, user) {
  if (user && user.website) return user.website;
  return row.website || null;
}

function mapEntryRow(row, getUserById, userPublic, index = 0) {
  const user = row.userId ? userPublic(getUserById(row.userId)) : null;
  const fallbackPosition = getFallbackPosition(index);
  const x =
    typeof row.x === "number"
      ? sanitizeCoordinate(row.x, BOARD_WIDTH - NOTE_SIZE)
      : fallbackPosition.x;
  const y =
    typeof row.y === "number"
      ? sanitizeCoordinate(row.y, BOARD_HEIGHT - NOTE_SIZE)
      : fallbackPosition.y;
  return {
    id: row.id,
    author: user?.username || row.author || "Anonymous",
    message: row.message,
    website: pickWebsite(row, user),
    mood: sanitizeMood(row.mood),
    x,
    y,
    createdAt: row.createdAt,
    user: user
      ? {
          id: user.id,
          username: user.username,
          avatar: user.avatar || null,
        }
      : null,
  };
}

module.exports = function registerGuestbookRoutes(app, deps) {
  const { db, authFromReq, getUserById, userPublic } = deps;
  const router = express.Router();

  router.get("/", (req, res) => {
    try {
      const rows = db
        .prepare(
          "SELECT id, userId, author, message, website, mood, x, y, createdAt FROM guestbook_entries ORDER BY createdAt DESC LIMIT ?",
        )
        .all(MAX_ENTRIES);

      res.setHeader("Cache-Control", "no-store");
      res.json(
        rows.map((row, index) =>
          mapEntryRow(row, getUserById, userPublic, index),
        ),
      );
    } catch {
      res.status(500).json({ error: "Failed to fetch guestbook entries" });
    }
  });

  router.post("/", async (req, res) => {
    try {
      await verifyTurnstileToken(req, req.body?.turnstileToken, "guestbook");
      const user = authFromReq(req);
      const author = user ? user.username : sanitizeName(req.body?.name);
      const message = sanitizeMessage(req.body?.message);
      const website = user ? null : sanitizeWebsite(req.body?.website);
      const mood = sanitizeMood(req.body?.mood);
      const existingCount =
        db.prepare("SELECT COUNT(*) as count FROM guestbook_entries").get()
          ?.count || 0;
      const fallbackPosition = getFallbackPosition(existingCount);
      const x =
        sanitizeCoordinate(req.body?.x, BOARD_WIDTH - NOTE_SIZE) ??
        fallbackPosition.x;
      const y =
        sanitizeCoordinate(req.body?.y, BOARD_HEIGHT - NOTE_SIZE) ??
        fallbackPosition.y;

      if (!author) {
        return res.status(400).json({ error: "Name is required" });
      }

      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const createdAt = new Date().toISOString();

      db.prepare(
        "INSERT INTO guestbook_entries (id, userId, author, message, website, mood, x, y, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        user ? user.id : null,
        author,
        message,
        website,
        mood,
        x,
        y,
        createdAt,
      );

      const row = db
        .prepare(
          "SELECT id, userId, author, message, website, mood, x, y, createdAt FROM guestbook_entries WHERE id = ?",
        )
        .get(id);

      res.status(201).json(mapEntryRow(row, getUserById, userPublic, 0));
    } catch (error) {
      if (error instanceof TurnstileError) {
        return res.status(error.status).json({
          error: error.message,
          code: error.code,
        });
      }
      res.status(500).json({ error: "Failed to sign the guestbook" });
    }
  });

  router.patch("/:id/position", (req, res) => {
    try {
      const x = sanitizeCoordinate(req.body?.x, BOARD_WIDTH - NOTE_SIZE);
      const y = sanitizeCoordinate(req.body?.y, BOARD_HEIGHT - NOTE_SIZE);

      if (x === null || y === null) {
        return res.status(400).json({ error: "Valid x and y are required" });
      }

      const result = db
        .prepare("UPDATE guestbook_entries SET x = ?, y = ? WHERE id = ?")
        .run(x, y, req.params.id);

      if (result.changes === 0) {
        return res.status(404).json({ error: "Guestbook entry not found" });
      }

      const row = db
        .prepare(
          "SELECT id, userId, author, message, website, mood, x, y, createdAt FROM guestbook_entries WHERE id = ?",
        )
        .get(req.params.id);

      res.json(mapEntryRow(row, getUserById, userPublic, 0));
    } catch {
      res.status(500).json({ error: "Failed to move the note" });
    }
  });

  router.delete("/:id", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!isOwner(user)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const result = db
        .prepare("DELETE FROM guestbook_entries WHERE id = ?")
        .run(req.params.id);

      if (result.changes === 0) {
        return res.status(404).json({ error: "Guestbook entry not found" });
      }

      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Failed to delete guestbook note" });
    }
  });

  app.use("/guestbook", router);
};
