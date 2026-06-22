const express = require("express");
const { ArenaHttpError } = require("../lib/arena-service");
const {
  getEligibleCards,
  joinMatchmaking,
  leaveMatchmaking,
  checkMatchmaking,
  startSoloGame,
  submitDeck,
  getGameState,
  submitAction,
} = require("../lib/tcg-service");

module.exports = (app, { db, authFromReq }) => {
  const router = express.Router();

  function requireAuthUser(req) {
    const user = authFromReq(req);
    if (!user) {
      throw new ArenaHttpError(401, "Authentication required.", "TCG_UNAUTHENTICATED");
    }
    return user;
  }

  function setNoStore(res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  function handleError(error, res) {
    if (error instanceof ArenaHttpError) {
      setNoStore(res);
      return res.status(error.status).json({ code: error.code, error: error.message });
    }
    const status = error.status || 500;
    setNoStore(res);
    res.status(status).json({ code: error.code || "TCG_ERROR", error: error.message });
  }

  // Get eligible cards for TCG deck building
  router.get("/eligible-cards", (req, res) => {
    try {
      const user = requireAuthUser(req);
      const cards = getEligibleCards(db, user.id);
      setNoStore(res);
      res.json({ cards });
    } catch (error) {
      handleError(error, res);
    }
  });

  // Join matchmaking queue
  router.post("/queue", (req, res) => {
    try {
      const user = requireAuthUser(req);
      const result = joinMatchmaking(db, user.id);
      setNoStore(res);
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  // Leave matchmaking queue
  router.delete("/queue", (req, res) => {
    try {
      const user = requireAuthUser(req);
      const result = leaveMatchmaking(db, user.id);
      setNoStore(res);
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  // Start solo game (play against yourself)
  router.post("/solo", (req, res) => {
    try {
      const user = requireAuthUser(req);
      const { elementPool, deckCards, mode } = req.body || {};
      const result = startSoloGame(db, user.id, elementPool, deckCards, mode);
      setNoStore(res);
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  // Get user's active game (for resuming after page refresh)
  router.get("/active-game", (req, res) => {
    try {
      const user = requireAuthUser(req);
      const game = db.prepare(
        `SELECT id FROM tcg_games WHERE (player1Id = ? OR player2Id = ?) AND state = 'playing' LIMIT 1`
      ).get(user.id, user.id);
      setNoStore(res);
      res.json(game ? { gameId: game.id } : { gameId: null });
    } catch (error) {
      handleError(error, res);
    }
  });

  // Check matchmaking status
  router.get("/queue", (req, res) => {
    try {
      const user = requireAuthUser(req);
      const result = checkMatchmaking(db, user.id);
      setNoStore(res);
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  // Submit deck for a game
  router.post("/game/:gameId/deck", (req, res) => {
    try {
      const user = requireAuthUser(req);
      const { cards } = req.body || {};
      const result = submitDeck(db, req.params.gameId, user.id, cards);
      setNoStore(res);
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  // Get game state
  router.get("/game/:gameId", (req, res) => {
    try {
      const user = requireAuthUser(req);
      const state = getGameState(db, req.params.gameId, user.id);
      setNoStore(res);
      res.json(state);
    } catch (error) {
      handleError(error, res);
    }
  });

  // Submit a game action
  router.post("/game/:gameId/action", (req, res) => {
    try {
      const user = requireAuthUser(req);
      const result = submitAction(db, req.params.gameId, user.id, req.body || {});
      setNoStore(res);
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.use("/tcg", router);
};
