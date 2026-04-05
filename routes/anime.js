const express = require("express");
const {
  CONFIG_ERROR_CODE,
  getCurrentlyWatchingAnimeFeed,
} = require("../lib/mal-anime");

module.exports = function registerAnimeRoutes(app, { db }) {
  const router = express.Router();

  router.get("/currently-watching", async (req, res) => {
    try {
      const payload = await getCurrentlyWatchingAnimeFeed(db);
      res.setHeader("Cache-Control", "no-store");
      res.json(payload);
    } catch (error) {
      const isConfigError = error?.code === CONFIG_ERROR_CODE;
      res.setHeader("Cache-Control", "no-store");
      res.status(isConfigError ? 503 : 502).json({
        code: isConfigError ? CONFIG_ERROR_CODE : "MAL_UNAVAILABLE",
        error: isConfigError
          ? error.message
          : "Failed to refresh the MyAnimeList currently watching feed.",
      });
    }
  });

  app.use("/anime", router);
};
