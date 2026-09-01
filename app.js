const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const http = require("http");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const passport = require("passport");
const compression = require("compression");

const app = express();
const PORT = process.env.PORT || 5000;
const API_PREFIX = "/v1";
const SESSION_COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME || "mirabellier_session";

function createCompressionMiddleware() {
  return compression({
    level: 6, // Balance between speed and compression
    threshold: 1024, // Only compress responses > 1KB
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
  });
}

function keepAliveMiddleware(req, res, next) {
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Keep-Alive", "timeout=5, max=100");
  next();
}

function normalizeApiPrefixMiddleware(req, _res, next) {
  if (req.url === API_PREFIX || req.url.startsWith(`${API_PREFIX}/`)) {
    const normalizedPath = req.url.slice(API_PREFIX.length);
    req.url = normalizedPath || "/";
  }
  next();
}

function createCorsMiddleware() {
  const normalizeOrigin = (origin) => String(origin || "").trim().replace(/\/$/, "");
  const configuredFrontendUrl = normalizeOrigin(process.env.FRONTEND_URL || "");
  const configuredFrontendUrls = String(process.env.FRONTEND_URLS || "")
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter(Boolean);
  const allowedOrigins = new Set([
    configuredFrontendUrl,
    ...configuredFrontendUrls,
    "https://mirabellier.com",
    "https://www.mirabellier.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ].filter(Boolean));

  return cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(normalizeOrigin(origin))) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Origin",
      "Accept",
      "X-Requested-With",
    ],
  });
}

function serverTimingMiddleware(req, res, next) {
  const startedAt = Date.now();
  const originalSend = res.send;

  res.send = function patchedSend(...args) {
    const durationMs = Date.now() - startedAt;
    if (!res.headersSent) {
      res.setHeader("Server-Timing", `total;dur=${durationMs}`);
    }
    return originalSend.apply(res, args);
  };

  next();
}

const USER_AGENT_VARY_PREFIXES = [
  "/anime",
  "/blog",
  "/profile",
  "/question-of-the-day",
  "/quotes",
  "/shrine",
];

function varyUserAgentForSpaPreviewRoutes(req, res, next) {
  if (req.method !== "GET") {
    next();
    return;
  }

  const path = String(req.path || "");
  const shouldVary = USER_AGENT_VARY_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );

  if (!shouldVary) {
    next();
    return;
  }

  const existingVary = String(res.getHeader("Vary") || "");
  if (!/\bUser-Agent\b/i.test(existingVary)) {
    const nextVary = existingVary ? `${existingVary}, User-Agent` : "User-Agent";
    res.setHeader("Vary", nextVary);
  }

  next();
}

function readCookieValue(req, key) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return "";

  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const cookieKey = trimmed.slice(0, separatorIndex);
    if (cookieKey !== key) continue;
    const rawValue = trimmed.slice(separatorIndex + 1);
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return "";
}

function getBearerTokenFromReq(req) {
  const auth = req.headers.authorization;
  if (!auth) return "";
  const parts = auth.split(" ");
  if (parts.length !== 2) return "";
  return parts[1];
}

function getSessionCookieTokenFromReq(req) {
  return readCookieValue(req, SESSION_COOKIE_NAME);
}

function registerMiddlewares(app) {
  app.use(createCompressionMiddleware());
  app.use(keepAliveMiddleware);
  app.use(normalizeApiPrefixMiddleware);
  app.use(createCorsMiddleware());
  app.use(varyUserAgentForSpaPreviewRoutes);
  app.use(bodyParser.json({ limit: "1gb" }));
  app.use(bodyParser.urlencoded({ limit: "1gb", extended: true }));
  app.use(passport.initialize());
  app.use(serverTimingMiddleware);
}

const { db } = require("./lib/db");
const users = require("./lib/users");
const uploads = require("./lib/uploads");
const { generateSitemap } = require("./lib/sitemap");
const { ensureIndexNowKeyFile } = require("./lib/indexnow");
const { startQuoteOfTheDayScheduler } = require("./lib/quote-of-the-day");
const {
  maybeNotifyNewQuestionOfTheDayDrop,
  startQuestionOfTheDayDiscordScheduler,
} = require("./lib/question-of-the-day-discord");

function authFromReq(req) {
  const bearerToken = getBearerTokenFromReq(req);
  if (bearerToken) {
    const userFromBearer = users.getUserByToken(bearerToken);
    if (userFromBearer) {
      return userFromBearer;
    }
  }

  const cookieToken = getSessionCookieTokenFromReq(req);
  if (!cookieToken) return null;
  return users.getUserByToken(cookieToken);
}

function registerRoutes(app) {
  require("./routes/posts")(app, {
    db,
    getUserById: users.getUserById,
    userPublic: users.userPublic,
    authFromReq,
  });

  require("./routes/images")(app, { IMAGES_DIR: uploads.IMAGES_DIR });
  require("./routes/quotes")(app);
  require("./routes/shrines")(app, { db, authFromReq });

  require("./routes/auth")(app, {
    db,
    IMAGES_DIR: uploads.IMAGES_DIR,
    optimizeImage: uploads.optimizeImage,
    makeToken: users.makeToken,
    createSession: users.createSession,
    getUserByUsername: users.getUserByUsername,
    getUserById: users.getUserById,
    getUserByToken: users.getUserByToken,
    updateUserById: users.updateUserById,
    userPublic: users.userPublic,
    authFromReq,
    imageUpload: uploads.imageUpload,
    findOrCreateDiscordUser: users.findOrCreateDiscordUser,
  });

  require("./routes/anime")(app, { db, authFromReq });
  require("./routes/fanart")(app);
  require("./routes/twitch")(app, { db, authFromReq });
  require("./routes/arena")(app, { db, authFromReq });
  require("./routes/tcg")(app, { db, authFromReq });
  require("./routes/admin")(app, { db, authFromReq });
  require("./routes/guestbook")(app, {
    db,
    authFromReq,
    getUserById: users.getUserById,
    userPublic: users.userPublic,
  });
  require("./routes/question-of-the-day")(app, {
    db,
    authFromReq,
    getUserById: users.getUserById,
    userPublic: users.userPublic,
    generateSitemap,
    notifyQuestionOfTheDayDrop: () => maybeNotifyNewQuestionOfTheDayDrop(db),
  });
}

function imageUploadHandler(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "No image provided" });
  }

  const imagePath = path.join(uploads.IMAGES_DIR, req.file.filename);
  return uploads
    .optimizeImage(imagePath)
    .then(() =>
      res.json({
        path: `/images/${req.file.filename}`,
        webp: `/images/${path.basename(req.file.filename, path.extname(req.file.filename))}.webp`,
      }),
    )
    .catch(() => res.status(500).json({ error: "Upload failed" }));
}

function createStaticMiddleware(directory) {
  return express.static(directory, {
    maxAge: "365d",
    immutable: true,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  });
}

registerMiddlewares(app);
registerRoutes(app);
generateSitemap(db);
startQuoteOfTheDayScheduler();
startQuestionOfTheDayDiscordScheduler(db);
const { startHallOfFameScheduler } = require("./lib/arena-hall-of-fame-scheduler");
startHallOfFameScheduler(db);
const { startTwitchScheduler } = require("./lib/twitch-scheduler");
startTwitchScheduler(db);
const indexNowKeyResult = ensureIndexNowKeyFile();
if (indexNowKeyResult.ok === false) {
  console.warn(`[indexnow] ${indexNowKeyResult.error}`);
}

// Image upload endpoint for blog posts with optimization
app.post("/posts-img", uploads.imageUpload.single("image"), imageUploadHandler);

// Serve static files with long cache headers
app.use("/images", createStaticMiddleware(uploads.IMAGES_DIR));

// ── WebSocket infrastructure ──

const WebSocketEvents = require("./lib/websocket-events");
const { initWebSocketServer } = require("./lib/websocket-server");
const { startPlaybackFight, advancePlaybackFightTurn, skipPlaybackFightToEnd } = require("./lib/arena/playback");
const { getCurrentlyWatchingAnimeFeed } = require("./lib/mal-anime");

// WS auth token endpoint — returns a short-lived token for WebSocket connection
app.post("/auth/ws-token", (req, res) => {
  try {
    const user = authFromReq(req);
    if (!user) return res.status(401).json({ error: "unauthenticated" });
    const wsManager = require("./lib/websocket-server").getWebSocketManager();
    if (!wsManager) return res.status(503).json({ error: "WebSocket not available" });
    const token = wsManager.createWsToken(user.id);
    res.json({ token });
  } catch {
    res.status(500).json({ error: "failed" });
  }
});

const httpServer = http.createServer(app);

initWebSocketServer(httpServer, {
  db,
  handleMessage(userId, msg, reply) {
    switch (msg.type) {
      case WebSocketEvents.C2S.ARENA_FIGHT_START: {
        startPlaybackFight(db, userId).then(
          (state) => reply({ type: WebSocketEvents.S2C.ARENA_FIGHT_TURN, data: state }),
          (err) => reply({
            type: WebSocketEvents.S2C.ARENA_FIGHT_ERROR,
            data: { code: err.code || "ARENA_FIGHT_ERROR", message: err.message },
          }),
        );
        break;
      }
      case WebSocketEvents.C2S.ARENA_FIGHT_ADVANCE: {
        try {
          const state = advancePlaybackFightTurn(db, userId);
          if (state.isFinished) {
            reply({ type: WebSocketEvents.S2C.ARENA_FIGHT_FINISHED, data: state });
          } else {
            reply({ type: WebSocketEvents.S2C.ARENA_FIGHT_TURN, data: state });
          }
        } catch (err) {
          reply({
            type: WebSocketEvents.S2C.ARENA_FIGHT_ERROR,
            data: { code: err.code || "ARENA_FIGHT_ERROR", message: err.message },
          });
        }
        break;
      }
      case WebSocketEvents.C2S.ARENA_FIGHT_SKIP: {
        try {
            const state = skipPlaybackFightToEnd(db, userId);
          reply({ type: WebSocketEvents.S2C.ARENA_FIGHT_FINISHED, data: state });
        } catch (err) {
          reply({
            type: WebSocketEvents.S2C.ARENA_FIGHT_ERROR,
            data: { code: err.code || "ARENA_FIGHT_ERROR", message: err.message },
          });
        }
        break;
      }
      case WebSocketEvents.C2S.ANIME_SUBSCRIBE: {
        getCurrentlyWatchingAnimeFeed(db).then(
          (data) => reply({ type: WebSocketEvents.S2C.ANIME_CURRENTLY_WATCHING, data }),
          (err) => reply({
            type: WebSocketEvents.S2C.ANIME_CURRENTLY_WATCHING,
            data: { code: err.code || "MAL_UNAVAILABLE", error: err.message },
          }),
        );
        break;
      }
    }
  },
});

httpServer.listen(PORT);
