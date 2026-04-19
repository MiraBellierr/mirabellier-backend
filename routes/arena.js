const express = require("express");
const {
  ArenaHttpError,
  buyShopItem,
  craftShopRecipe,
  drawDailyCard,
  getArenaCollectionPayload,
  getArenaProfilePayload,
  getArenaShopPayload,
  getLeaderboard,
  runFight,
  selectCollectionCard,
  useConsumable,
} = require("../lib/arena-service");

function setNoStoreHeaders(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function requireAuthUser(req, authFromReq) {
  const user = authFromReq(req);
  if (!user) {
    throw new ArenaHttpError(401, "Authentication required.", "ARENA_UNAUTHENTICATED");
  }
  return user;
}

function handleArenaError(error, res) {
  if (error instanceof ArenaHttpError) {
    setNoStoreHeaders(res);
    return res.status(error.status).json({
      code: error.code,
      error: error.message,
      ...error.details,
    });
  }

  if (error && typeof error === "object" && error.code === "MAL_CONFIG_MISSING") {
    setNoStoreHeaders(res);
    return res.status(503).json({
      code: "MAL_CONFIG_MISSING",
      error: error.message,
    });
  }

  if (error && typeof error === "object" && error.code === "MAL_POOL_EMPTY") {
    setNoStoreHeaders(res);
    return res.status(503).json({
      code: "MAL_POOL_EMPTY",
      error:
        "Arena card pool is currently unavailable. Please try again in a moment.",
    });
  }

  if (error && typeof error === "object" && error.code === "MAL_SOURCE_RATE_LIMIT") {
    setNoStoreHeaders(res);
    return res.status(503).json({
      code: "MAL_SOURCE_RATE_LIMIT",
      error:
        "Arena card source is rate-limited right now. Please retry in a moment.",
      retryAfterMs:
        Number.isFinite(Number(error.retryAfterMs)) && Number(error.retryAfterMs) > 0
          ? Number(error.retryAfterMs)
          : undefined,
    });
  }

  setNoStoreHeaders(res);
  return res.status(500).json({
    code: "ARENA_FAILED",
    error: "Arena request failed.",
  });
}

module.exports = function registerArenaRoutes(app, deps) {
  const { db, authFromReq } = deps;
  const router = express.Router();

  router.get("/profile", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const payload = getArenaProfilePayload(db, user.id);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.get("/collection", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const payload = getArenaCollectionPayload(db, user.id, {
        limit: req.query?.limit,
      });
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.post("/collection/select-card", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const cardInstanceId = String(req.body?.cardInstanceId || "").trim();
      if (!cardInstanceId) {
        throw new ArenaHttpError(
          400,
          "cardInstanceId is required.",
          "ARENA_CARD_INSTANCE_REQUIRED",
        );
      }

      const payload = selectCollectionCard(db, user.id, cardInstanceId);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.post("/fight", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const payload = await runFight(db, user.id);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.post("/draw-card", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const payload = await drawDailyCard(db, user.id);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.get("/shop", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const payload = getArenaShopPayload(db, user.id);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.post("/shop/buy", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const itemId = String(req.body?.itemId || "").trim();
      if (!itemId) {
        throw new ArenaHttpError(400, "itemId is required.", "ARENA_ITEM_REQUIRED");
      }

      const payload = buyShopItem(db, user.id, itemId);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.post("/shop/use-consumable", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const itemId = String(req.body?.itemId || "").trim();
      if (!itemId) {
        throw new ArenaHttpError(400, "itemId is required.", "ARENA_ITEM_REQUIRED");
      }

      const payload = useConsumable(db, user.id, itemId);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.post("/shop/craft", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const recipeId = String(req.body?.recipeId || "").trim();
      const quantity = req.body?.quantity;
      if (!recipeId) {
        throw new ArenaHttpError(400, "recipeId is required.", "ARENA_RECIPE_REQUIRED");
      }

      const payload = craftShopRecipe(db, user.id, recipeId, quantity);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.get("/leaderboard", (req, res) => {
    try {
      const metric = String(req.query?.metric || "level");
      const limit = req.query?.limit;
      const payload = getLeaderboard(db, metric, limit);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  app.use("/arena", router);
};
