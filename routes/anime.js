const express = require("express");
const {
  buildAnimeShareHtml,
  getPreviewDimensions,
  isLikelyCrawler,
  loadAnimePreviewState,
  renderAnimePreviewBuffer,
  resolveProtocol,
} = require("../lib/anime-embed");
const { CONFIG_ERROR_CODE: MAL_CONFIG_ERROR_CODE, getCurrentlyWatchingAnimeFeed } = require("../lib/mal-anime");

function setNoStoreHeaders(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function setEmbedImageCacheHeaders(res, hasVersionQuery) {
  if (hasVersionQuery) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=300");
}

module.exports = function registerAnimeRoutes(app, { db }) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    try {
      const host = req.get("host") || "mirabellier.com";
      const protocol = resolveProtocol(req);
      const state = await loadAnimePreviewState(db);
      const redirectToSpa = !isLikelyCrawler(req.get("user-agent"));
      const html = buildAnimeShareHtml({
        state,
        protocol,
        host,
        spaPath: "/anime",
        redirectToSpa,
      });

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      setNoStoreHeaders(res);
      res.send(html);
    } catch {
      res.status(500).send("Server error");
    }
  });

  router.get("/currently-watching", async (req, res) => {
    try {
      const payload = await getCurrentlyWatchingAnimeFeed(db);
      setNoStoreHeaders(res);
      res.json(payload);
    } catch (error) {
      const isConfigError = error?.code === MAL_CONFIG_ERROR_CODE;
      setNoStoreHeaders(res);
      res.status(isConfigError ? 503 : 502).json({
        code: isConfigError ? MAL_CONFIG_ERROR_CODE : "MAL_UNAVAILABLE",
        error: isConfigError
          ? error.message
          : "Failed to refresh the MyAnimeList currently watching feed.",
      });
    }
  });

  router.get("/currently-watching/embed-image.png", async (req, res) => {
    try {
      const state = await loadAnimePreviewState(db);
      const dimensions = getPreviewDimensions(state);
      const imageBuffer = await renderAnimePreviewBuffer(state);

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", String(imageBuffer.length));
      res.setHeader("X-Preview-Version", String(state.version || "fallback"));
      res.setHeader("X-Preview-Width", String(dimensions.width));
      res.setHeader("X-Preview-Height", String(dimensions.height));
      setEmbedImageCacheHeaders(
        res,
        typeof req.query.v === "string" && req.query.v.trim().length > 0,
      );
      res.send(imageBuffer);
    } catch {
      res.status(500).send("Failed to render anime preview image");
    }
  });

  app.use("/anime", router);
};
