const express = require("express");
const { isOwner } = require("../lib/authz");
const {
  drawArenaCard,
  ensureArenaCardPool,
  getArenaCharacterCatalog,
  rarityFromCharacterRank,
} = require("../lib/arena-characters");

const CARD_IV_MIN = 0;
const CARD_IV_MAX = 31;

function setNoStoreHeaders(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function toPositiveInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createCard(malCard) {
  const catalogSize = getArenaCharacterCatalog().characters.length;
  const rarity = rarityFromCharacterRank(
    malCard.popularity,
    catalogSize > 0 ? catalogSize : 5000,
  );
  const ivPower = randomInt(CARD_IV_MIN, CARD_IV_MAX);
  const ivGuard = randomInt(CARD_IV_MIN, CARD_IV_MAX);
  const ivSpeed = randomInt(CARD_IV_MIN, CARD_IV_MAX);
  const ivLuck = randomInt(CARD_IV_MIN, CARD_IV_MAX);

  return {
    cardInstanceId: makeId("card"),
    malId: toPositiveInt(malCard.malId, 0),
    title: malCard.title,
    url: malCard.url,
    imageUrl: malCard.imageUrl,
    meanScore:
      malCard.meanScore === null || malCard.meanScore === undefined
        ? null
        : Number(malCard.meanScore),
    popularity:
      malCard.popularity === null || malCard.popularity === undefined
        ? null
        : Number(malCard.popularity),
    favorites:
      malCard.favorites === null || malCard.favorites === undefined
        ? null
        : Number(malCard.favorites),
    nsfw: typeof malCard.nsfw === "string" ? malCard.nsfw : null,
    rarity,
    iv: {
      power: ivPower,
      guard: ivGuard,
      speed: ivSpeed,
      luck: ivLuck,
      total: ivPower + ivGuard + ivSpeed + ivLuck,
    },
    drawnAt: nowIso(),
  };
}

module.exports = function registerAdminRoutes(app, deps) {
  const { db, authFromReq } = deps;
  const router = express.Router();

  router.get("/users/lookup", (req, res) => {
    setNoStoreHeaders(res);
    try {
      const user = authFromReq(req);
      if (!isOwner(user)) return res.status(403).json({ error: "Forbidden" });

      const username = String(req.query.username || "").trim();
      if (!username) {
        return res.status(400).json({ error: "username query param is required" });
      }

      const target = db
        .prepare("SELECT id, username, avatar FROM users WHERE username = ?")
        .get(username);
      if (!target) {
        return res.status(404).json({ error: "User not found" });
      }

      const profile = db
        .prepare("SELECT * FROM arena_profiles WHERE userId = ?")
        .get(target.id);

      res.json({
        id: target.id,
        username: target.username,
        avatar: target.avatar || null,
        hasArenaProfile: Boolean(profile),
        coins: profile?.coins ?? null,
        level: profile?.level ?? null,
        dailyDrawsUsed: profile?.dailyCardDrawCount ?? 0,
        lastCardDrawDate: profile?.lastCardDrawDate ?? null,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to look up user" });
    }
  });

  router.post("/users/:userId/coins", (req, res) => {
    setNoStoreHeaders(res);
    try {
      const user = authFromReq(req);
      if (!isOwner(user)) return res.status(403).json({ error: "Forbidden" });

      const targetUserId = req.params.userId;
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: "amount must be a positive number" });
      }

      const profile = db
        .prepare("SELECT * FROM arena_profiles WHERE userId = ?")
        .get(targetUserId);
      if (!profile) {
        return res.status(404).json({ error: "User has no arena profile" });
      }

      const added = Math.trunc(amount);
      const newCoins = profile.coins + added;
      const newLifetime = (profile.lifetimeCoinsEarned ?? 0) + added;
      const now = nowIso();
      db.prepare(
        "UPDATE arena_profiles SET coins = ?, lifetimeCoinsEarned = ?, updatedAt = ? WHERE userId = ?",
      ).run(newCoins, newLifetime, now, targetUserId);

      res.json({
        userId: targetUserId,
        coins: newCoins,
        added,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to add coins" });
    }
  });

  router.post("/users/:userId/cards", async (req, res) => {
    setNoStoreHeaders(res);
    try {
      const user = authFromReq(req);
      if (!isOwner(user)) return res.status(403).json({ error: "Forbidden" });

      const targetUserId = req.params.userId;
      const count = Math.min(Math.max(Number(req.body?.count) || 1, 1), 20);

      const profile = db
        .prepare("SELECT * FROM arena_profiles WHERE userId = ?")
        .get(targetUserId);
      if (!profile) {
        return res.status(404).json({ error: "User has no arena profile" });
      }

      await ensureArenaCardPool(db);
      const cards = [];
      for (let i = 0; i < count; i++) {
        const malCard = await drawArenaCard(db);
        const card = createCard(malCard);
        if (!card) continue;

        const now = nowIso();
        db.prepare(
          `INSERT OR IGNORE INTO arena_card_collection (
            id, userId, cardInstanceId, cardJson, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          makeId("collection"),
          targetUserId,
          card.cardInstanceId,
          JSON.stringify(card),
          now,
          now,
        );
        cards.push({ title: card.title, rarity: card.rarity });
      }

      res.json({
        userId: targetUserId,
        added: cards.length,
        cards,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to add cards" });
    }
  });

  router.post("/users/:userId/reset-draws", (req, res) => {
    setNoStoreHeaders(res);
    try {
      const user = authFromReq(req);
      if (!isOwner(user)) return res.status(403).json({ error: "Forbidden" });

      const targetUserId = req.params.userId;
      const profile = db
        .prepare("SELECT * FROM arena_profiles WHERE userId = ?")
        .get(targetUserId);
      if (!profile) {
        return res.status(404).json({ error: "User has no arena profile" });
      }

      const now = nowIso();
      db.prepare(
        "UPDATE arena_profiles SET dailyCardDrawCount = 0, lastCardDrawDate = NULL, updatedAt = ? WHERE userId = ?",
      ).run(now, targetUserId);

      res.json({
        userId: targetUserId,
        message: "Daily draws reset. User can now open packs again.",
        dailyDrawsUsed: 0,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to reset draws" });
    }
  });

  app.use("/admin", router);
};
