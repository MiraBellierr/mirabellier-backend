const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const passport = require("passport");
const compression = require("compression");

const app = express();
const PORT = process.env.PORT || 5000;

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

function registerMiddlewares(app) {
  app.use(createCompressionMiddleware());
  app.use(keepAliveMiddleware);
  app.use(cors());
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

function authFromReq(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const parts = auth.split(" ");
  if (parts.length !== 2) return null;
  const token = parts[1];
  return users.getUserByToken(token);
}

function registerRoutes(app) {
  require("./routes/posts")(app, {
    db,
    getUserById: users.getUserById,
    userPublic: users.userPublic,
    authFromReq,
  });

  require("./routes/videos")(app, {
    db,
    getUserById: users.getUserById,
    userPublic: users.userPublic,
    authFromReq,
    videoUpload: uploads.videoUpload,
  });

  require("./routes/pics")(app, {
    db,
    getUserById: users.getUserById,
    userPublic: users.userPublic,
    authFromReq,
    imageUpload: uploads.imageUpload,
    optimizeImage: uploads.optimizeImage,
  });

  require("./routes/images")(app, { IMAGES_DIR: uploads.IMAGES_DIR });

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
const indexNowKeyResult = ensureIndexNowKeyFile();
if (indexNowKeyResult.ok === false) {
  console.warn(`[indexnow] ${indexNowKeyResult.error}`);
}

// Image upload endpoint for blog posts with optimization
app.post("/posts-img", uploads.imageUpload.single("image"), imageUploadHandler);

// Serve static files with long cache headers
app.use("/videos", createStaticMiddleware(uploads.VIDEOS_DIR));
app.use("/images", createStaticMiddleware(uploads.IMAGES_DIR));

app.listen(PORT);
