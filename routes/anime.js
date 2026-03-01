const express = require("express");

const OWNER_DISCORD_ID = "548050617889980426";
const EDITOR_USERNAME = "mira";

function isOwner(user) {
  return Boolean(user && user.discordId === OWNER_DISCORD_ID);
}

function canPatch(user) {
  return Boolean(user && user.username === EDITOR_USERNAME);
}

function buildPatchFields(body) {
  const updates = [];
  const params = [];

  if (typeof body.title !== "undefined") {
    updates.push("title = ?");
    params.push(body.title);
  }
  if (typeof body.url !== "undefined") {
    updates.push("url = ?");
    params.push(body.url);
  }
  if (typeof body.img !== "undefined") {
    updates.push("img = ?");
    params.push(body.img);
  }
  if (typeof body.ord !== "undefined") {
    updates.push("ord = ?");
    params.push(body.ord);
  }

  return { updates, params };
}

module.exports = function registerAnimeRoutes(app, { db, authFromReq }) {
  const router = express.Router();

  router.get("/", (req, res) => {
    try {
      const rows = db
        .prepare("SELECT id, title, url, img, ord FROM anime ORDER BY ord ASC")
        .all();

      // Cache anime list for 10 minutes
      res.setHeader(
        "Cache-Control",
        "public, max-age=600, stale-while-revalidate=1200",
      );
      res.json(rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch anime list" });
    }
  });

  router.post("/", express.json(), (req, res) => {
    try {
      const user = authFromReq(req);
      if (!isOwner(user)) return res.status(403).json({ error: "Forbidden" });

      const list = Array.isArray(req.body) ? req.body : [];
      const deleteAll = db.prepare("DELETE FROM anime");
      const insert = db.prepare(
        "INSERT INTO anime (id, title, url, img, ord) VALUES (?, ?, ?, ?, ?)",
      );
      const transaction = db.transaction((items) => {
        deleteAll.run();
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          const id = item.id || `${Date.now()}-${index}`;
          insert.run(
            id,
            item.title || "",
            item.url || "",
            item.img || "",
            index,
          );
        }
      });

      transaction(list);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Failed to update anime list" });
    }
  });

  router.delete("/:id", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!isOwner(user)) return res.status(403).json({ error: "Forbidden" });

      db.prepare("DELETE FROM anime WHERE id = ?").run(req.params.id);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Failed to delete" });
    }
  });

  router.patch("/:id", express.json(), (req, res) => {
    try {
      const user = authFromReq(req);
      if (!canPatch(user)) return res.status(403).json({ error: "Forbidden" });

      const id = req.params.id;
      const { updates, params } = buildPatchFields(req.body || {});
      if (updates.length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      params.push(id);
      const statement = db.prepare(
        `UPDATE anime SET ${updates.join(", ")} WHERE id = ?`,
      );
      const info = statement.run(...params);
      if (info.changes === 0)
        return res.status(404).json({ error: "Not found" });

      const row = db
        .prepare("SELECT id, title, url, img, ord FROM anime WHERE id = ?")
        .get(id);
      res.json(row);
    } catch {
      res.status(500).json({ error: "Failed to update item" });
    }
  });

  app.use("/anime", router);
};
