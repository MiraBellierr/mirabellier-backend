const express = require("express");
const {
  advancePlaybackFightTurn,
  activateArenaSkill,
  ArenaHttpError,
  buyArenaShopCard,
  buyShopItem,
  craftShopRecipe,
  createArenaUpdate,
  deleteArenaUpdate,
  drawDailyCard,
  equipShopItem,
  getArenaCardShopPayload,
  getArenaCollectionPayload,
  getArenaProfilePayload,
  getArenaSkillTreePayload,
  getArenaShopPayload,
  getArenaUpdates,
  getLeaderboard,
  getPlaybackFightState,
  hasActiveFight,
  runFight,
  resetArenaSkills,
  selectCollectionCard,
  skipPlaybackFightToEnd,
  startPlaybackFight,
  useConsumable,
} = require("../lib/arena-service");
const { isOwner } = require("../lib/authz");
const {
  TurnstileError,
  verifyTurnstileToken,
} = require("../lib/turnstile");
const { checkArenaFightRateLimit } = require("../lib/arena-fight-guard");

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
  if (error instanceof TurnstileError) {
    setNoStoreHeaders(res);
    return res.status(error.status).json({
      code: error.code,
      error: error.message,
    });
  }

  if (error instanceof ArenaHttpError) {
    setNoStoreHeaders(res);
    return res.status(error.status).json({
      code: error.code,
      error: error.message,
      ...error.details,
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
      const profile = getArenaProfilePayload(db, user.id);
      const activeFight = getPlaybackFightState(db, user.id);
      setNoStoreHeaders(res);
      res.json({ ...profile, activeFight });
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.get("/updates", (req, res) => {
    try {
      const updates = getArenaUpdates(db, { limit: req.query?.limit });
      setNoStoreHeaders(res);
      res.json({ updates });
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.post("/updates", (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      if (!isOwner(user)) {
        throw new ArenaHttpError(
          403,
          "Only the site owner can publish Arena updates.",
          "ARENA_UPDATE_FORBIDDEN",
        );
      }
      const update = createArenaUpdate(db, user.id, {
        title: req.body?.title,
        body: req.body?.body,
      });
      setNoStoreHeaders(res);
      res.status(201).json({ update });
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.delete("/updates/:updateId", (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      if (!isOwner(user)) {
        throw new ArenaHttpError(
          403,
          "Only the site owner can delete Arena updates.",
          "ARENA_UPDATE_FORBIDDEN",
        );
      }
      const payload = deleteArenaUpdate(db, req.params.updateId);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.post("/verify", async (req, res) => {
    try {
      await verifyTurnstileToken(req, req.body?.turnstileToken, "arena_fight");
      setNoStoreHeaders(res);
      res.json({ ok: true });
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

  router.get("/skill-tree", (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const payload = getArenaSkillTreePayload(db, user.id);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.post("/skill-tree/activate", (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const nodeId = String(req.body?.nodeId || "").trim();
      if (!nodeId) {
        throw new ArenaHttpError(
          400,
          "nodeId is required.",
          "ARENA_SKILL_NODE_REQUIRED",
        );
      }
      const payload = activateArenaSkill(db, user.id, nodeId);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.post("/skill-tree/reset", (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const payload = resetArenaSkills(db, user.id);
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
      if (hasActiveFight(db, user.id)) {
        throw new ArenaHttpError(
          409,
          "A fight is already in progress. Finish it first.",
          "ARENA_FIGHT_ACTIVE",
          { activeFight: getPlaybackFightState(db, user.id) },
        );
      }
      const rateLimit = checkArenaFightRateLimit(req, user.id);
      if (!rateLimit.allowed) {
        throw new ArenaHttpError(
          429,
          "Too many fight attempts. Please wait before trying again.",
          "ARENA_FIGHT_RATE_LIMIT",
          { retryAfterMs: rateLimit.retryAfterMs },
        );
      }
      const payload = await runFight(db, user.id);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.post("/fight/start", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const rateLimit = checkArenaFightRateLimit(req, user.id);
      if (!rateLimit.allowed) {
        throw new ArenaHttpError(
          429,
          "Too many fight attempts. Please wait before trying again.",
          "ARENA_FIGHT_RATE_LIMIT",
          { retryAfterMs: rateLimit.retryAfterMs },
        );
      }
      const payload = await startPlaybackFight(db, user.id);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.get("/fight/state", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const state = getPlaybackFightState(db, user.id);
      setNoStoreHeaders(res);
      res.json({ activeFight: state });
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.post("/fight/advance", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const payload = advancePlaybackFightTurn(db, user.id);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.post("/fight/skip", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const payload = skipPlaybackFightToEnd(db, user.id);
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

  router.get("/shop/cards", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const payload = await getArenaCardShopPayload(db, user.id);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      handleArenaError(error, res);
    }
  });

  router.post("/shop/cards/buy", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const payload = await buyArenaShopCard(db, user.id, {
        kind: req.body?.kind,
        offerId: req.body?.offerId,
      });
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

  router.post("/shop/equip", async (req, res) => {
    try {
      const user = requireAuthUser(req, authFromReq);
      const itemId = String(req.body?.itemId || "").trim();
      if (!itemId) {
        throw new ArenaHttpError(400, "itemId is required.", "ARENA_ITEM_REQUIRED");
      }

      const payload = equipShopItem(db, user.id, itemId);
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
