const path = require("path");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  buildProfileEmbedPath,
  buildProfileImageVersion,
  renderProfileEmbedBuffer,
} = require("../lib/profile-embed");
const {
  handleHumanSpaRequest,
  sendFrontendRedirectConfigError,
} = require("../lib/spa-entry");
const { getUserPermissions, getUserRoles } = require("../lib/authz");
const {
  FollowError,
  getFollowState,
  toggleFollow,
} = require("../lib/user-follows");

function configureDiscordStrategy(findOrCreateDiscordUser) {
  passport.use(
    new DiscordStrategy(
      {
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackURL:
          process.env.DISCORD_CALLBACK_URL ||
          "http://localhost:3000/auth/discord/callback",
        scope: ["identify"],
      },
      (accessToken, refreshToken, profile, cb) => {
        try {
          const user = findOrCreateDiscordUser(profile);
          return cb(null, user);
        } catch (err) {
          return cb(err);
        }
      },
    ),
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseJsonArray(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function countLikesForUser(postRows, userId) {
  let count = 0;

  postRows.forEach((post) => {
    if (parseJsonArray(post.likes).includes(userId)) {
      count++;
    }
  });

  return count;
}

function countCommentsForUser(postRows, userId) {
  let count = 0;

  postRows.forEach((post) => {
    parseJsonArray(post.comments).forEach((comment) => {
      if (comment && comment.userId === userId) {
        count++;
      }
    });
  });

  return count;
}

function buildProfileSeoPage({
  user,
  protocol,
  host,
  requestPath,
  spaPath,
}) {
  const title = `${escapeHtml(user.username)}'s Profile`;

  const imageVersion = buildProfileImageVersion(user);
  const imageUrl = `${protocol}://${host}${buildProfileEmbedPath(
    user.username,
    imageVersion,
  )}`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
    <meta property="og:type" content="profile" />
    <meta property="og:title" content="${title}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:width" content="${PREVIEW_WIDTH}" />
    <meta property="og:image:height" content="${PREVIEW_HEIGHT}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:url" content="${protocol}://${host}${requestPath}" />
    <meta property="profile:username" content="${escapeHtml(user.username)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
    <link rel="canonical" href="${protocol}://${host}${spaPath}" />
  </head>
  <body>
  </body>
</html>`;
}

async function maybeOptimizeUploadedImage(
  files,
  key,
  optimizeImage,
  imagesDir,
) {
  if (!files?.[key]) return undefined;

  const uploadedFile = files[key][0];
  await optimizeImage(path.join(imagesDir, uploadedFile.filename));
  return `/images/${uploadedFile.filename}`;
}

function normalizeOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function isLocalhostHost(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function resolveFrontendOrigin(rawOrigin, fallbackFrontendUrl) {
  const fallbackOrigin = normalizeOrigin(fallbackFrontendUrl);
  const requestedOrigin = normalizeOrigin(rawOrigin);

  if (!requestedOrigin) return fallbackOrigin || "http://localhost:5173";

  const fallback = fallbackOrigin ? new URL(fallbackOrigin) : null;
  const requested = new URL(requestedOrigin);

  if (fallback && requested.origin === fallback.origin) {
    return requested.origin;
  }

  if (isLocalhostHost(requested.hostname)) {
    return requested.origin;
  }

  return fallbackOrigin || "http://localhost:5173";
}

const OAUTH_ORIGIN_COOKIE = "oauth_frontend_origin";
const SESSION_COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME || "mirabellier_session";
const SESSION_COOKIE_MAX_AGE_SECONDS = Number.parseInt(
  process.env.SESSION_COOKIE_MAX_AGE_SECONDS || "",
  10,
);

function isSecureRequest(req) {
  if (req.secure) return true;
  const forwardedProto = req.get("x-forwarded-proto");
  if (!forwardedProto) return false;
  return forwardedProto.split(",")[0].trim().toLowerCase() === "https";
}

function buildAuthenticatedUserPayload(user, userPublic) {
  return {
    ...userPublic(user),
    roles: getUserRoles(user),
    permissions: getUserPermissions(user),
  };
}

function shouldUseSecureCookies(req) {
  const configured = String(process.env.SESSION_COOKIE_SECURE || "").trim();
  if (configured.toLowerCase() === "true") return true;
  if (configured.toLowerCase() === "false") return false;
  return isSecureRequest(req);
}

function buildCookieString(req, name, value, maxAgeSeconds) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, maxAgeSeconds)}`,
  ];

  if (shouldUseSecureCookies(req)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function appendSetCookieHeader(res, cookieValue) {
  const existing = res.getHeader("Set-Cookie");

  if (!existing) {
    res.setHeader("Set-Cookie", [cookieValue]);
    return;
  }

  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookieValue]);
    return;
  }

  res.setHeader("Set-Cookie", [existing, cookieValue]);
}

function setOauthOriginCookie(req, res, origin) {
  appendSetCookieHeader(
    res,
    buildCookieString(req, OAUTH_ORIGIN_COOKIE, origin, 600),
  );
}

function clearOauthOriginCookie(req, res) {
  appendSetCookieHeader(
    res,
    buildCookieString(req, OAUTH_ORIGIN_COOKIE, "", 0),
  );
}

function setSessionCookie(req, res, token) {
  const maxAge = Number.isFinite(SESSION_COOKIE_MAX_AGE_SECONDS)
    ? SESSION_COOKIE_MAX_AGE_SECONDS
    : 60 * 60 * 24 * 30;
  appendSetCookieHeader(
    res,
    buildCookieString(req, SESSION_COOKIE_NAME, token, maxAge),
  );
}

function clearSessionCookie(req, res) {
  appendSetCookieHeader(res, buildCookieString(req, SESSION_COOKIE_NAME, "", 0));
}

function getBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth) return "";
  const parts = auth.split(" ");
  if (parts.length !== 2) return "";
  return parts[1];
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

function getRequestedFrontendOrigin(req) {
  if (typeof req.query.redirect_origin === "string") {
    return req.query.redirect_origin;
  }

  if (typeof req.headers.origin === "string") {
    return req.headers.origin;
  }

  if (typeof req.headers.referer === "string") {
    return req.headers.referer;
  }

  return "";
}

function isLikelyCrawler(userAgent) {
  const value = String(userAgent || "").toLowerCase();
  return /bot|crawler|spider|google-inspectiontool|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandex|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot/.test(
    value,
  );
}

function shouldRedirectToSpa(req) {
  return !isLikelyCrawler(req.get("user-agent"));
}

async function handleProfileEmbedImage(req, res, getUserByUsername, imagesDir) {
  try {
    const user = getUserByUsername(req.params.username);
    if (!user) {
      return res.status(404).send("User not found");
    }

    const imageBuffer = await renderProfileEmbedBuffer({
      user,
      imagesDir,
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(imageBuffer.length));
    res.setHeader(
      "Cache-Control",
      typeof req.query.v === "string" && req.query.v.trim().length > 0
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300",
    );
    return res.send(imageBuffer);
  } catch {
    return res.status(500).send("Failed to render profile preview image");
  }
}

module.exports = function registerAuthRoutes(app, deps) {
  const {
    db,
    IMAGES_DIR,
    optimizeImage,
    makeToken,
    createSession,
    getUserByUsername,
    getUserById,
    updateUserById,
    userPublic,
    authFromReq,
    imageUpload,
    findOrCreateDiscordUser,
  } = deps;

  configureDiscordStrategy(findOrCreateDiscordUser);

  // Discord OAuth login
  app.get("/auth/discord", (req, res, next) => {
    const configuredFrontendUrl =
      process.env.FRONTEND_URL || "http://localhost:5173";
    const rawRequestedOrigin = getRequestedFrontendOrigin(req);
    const frontendOrigin = resolveFrontendOrigin(
      rawRequestedOrigin,
      configuredFrontendUrl,
    );
    setOauthOriginCookie(req, res, frontendOrigin);

    return passport.authenticate("discord", { state: frontendOrigin })(
      req,
      res,
      next,
    );
  });

  // Discord OAuth callback
  app.get(
    "/auth/discord/callback",
    passport.authenticate("discord", {
      session: false,
      failureRedirect: "/login",
    }),
    (req, res) => {
      try {
        const user = req.user;
        const token = makeToken();
        createSession(token, user.id);
        setSessionCookie(req, res, token);

        const configuredFrontendUrl =
          process.env.FRONTEND_URL || "http://localhost:5173";
        const stateOrigin =
          typeof req.query.state === "string" ? req.query.state : "";
        const cookieOrigin = readCookieValue(req, OAUTH_ORIGIN_COOKIE);
        const frontendOrigin = resolveFrontendOrigin(
          stateOrigin || cookieOrigin,
          configuredFrontendUrl,
        );
        clearOauthOriginCookie(req, res);

        res.redirect(`${frontendOrigin}/auth/callback`);
      } catch {
        res.redirect("/login?error=auth_failed");
      }
    },
  );

  app.get("/me", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });
      res.json(buildAuthenticatedUserPayload(user, userPublic));
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  app.get("/user/:id", (req, res) => {
    try {
      const user = getUserById(req.params.id);
      if (!user) return res.status(404).json({ error: "not found" });

      // Cache user profiles for 5 minutes
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(userPublic(user));
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  app.get("/user/by-username/:username", (req, res) => {
    try {
      const user = getUserByUsername(req.params.username);
      if (!user) return res.status(404).json({ error: "not found" });

      // Cache user profiles for 5 minutes
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(userPublic(user));
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // ── Follow graph ──
  function handleFollowError(err, res) {
    if (err instanceof FollowError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: "failed" });
  }

  app.get("/user/:id/follow", (req, res) => {
    try {
      const viewer = authFromReq(req);
      res.setHeader("Cache-Control", "no-store");
      res.json(getFollowState(db, viewer, req.params.id));
    } catch (err) {
      handleFollowError(err, res);
    }
  });

  app.post("/user/:id/follow", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });
      res.setHeader("Cache-Control", "no-store");
      res.json(toggleFollow(db, user, req.params.id));
    } catch (err) {
      handleFollowError(err, res);
    }
  });

  app.get("/profile-embed/:username.png", (req, res) =>
    handleProfileEmbedImage(req, res, getUserByUsername, IMAGES_DIR),
  );
  app.get("/api/profile-embed/:username.png", (req, res) =>
    handleProfileEmbedImage(req, res, getUserByUsername, IMAGES_DIR),
  );

  app.post("/logout", (req, res) => {
    try {
      const bearerToken = getBearerToken(req);
      const cookieToken = readCookieValue(req, SESSION_COOKIE_NAME);
      const tokens = Array.from(
        new Set([bearerToken, cookieToken].filter((value) => value)),
      );

      if (tokens.length === 0) {
        clearSessionCookie(req, res);
        return res.status(401).json({ error: "unauthenticated" });
      }

      const removeSession = db.prepare("DELETE FROM sessions WHERE token = ?");
      for (const token of tokens) {
        removeSession.run(token);
      }

      clearSessionCookie(req, res);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "logout failed" });
    }
  });

  app.post(
    "/me",
    imageUpload.fields([
      { name: "avatar", maxCount: 1 },
      { name: "banner", maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        const user = authFromReq(req);
        if (!user) return res.status(401).json({ error: "unauthenticated" });

        let avatar = req.body && req.body.avatar ? req.body.avatar : undefined;
        let banner = req.body && req.body.banner ? req.body.banner : undefined;

        const optimizedAvatar = await maybeOptimizeUploadedImage(
          req.files,
          "avatar",
          optimizeImage,
          IMAGES_DIR,
        );
        if (optimizedAvatar !== undefined) avatar = optimizedAvatar;

        const optimizedBanner = await maybeOptimizeUploadedImage(
          req.files,
          "banner",
          optimizeImage,
          IMAGES_DIR,
        );
        if (optimizedBanner !== undefined) banner = optimizedBanner;

        const updated = updateUserById(user.id, {
          username: req.body.username,
          avatar,
          banner,
          bio: req.body.bio,
          location: req.body.location,
          website: req.body.website,
        });

        res.json(buildAuthenticatedUserPayload(updated, userPublic));
      } catch (err) {
        if (err.message === "username taken") {
          return res.status(409).json({ error: "username taken" });
        }
        res.status(500).json({ error: "update failed" });
      }
    },
  );

  app.get("/user/:id/stats", (req, res) => {
    try {
      const id = req.params.id;
      const user = getUserById(id);
      if (!user) return res.status(404).json({ error: "not found" });

      const postsCount =
        db
          .prepare("SELECT COUNT(*) as count FROM posts WHERE userId = ?")
          .get(id)?.count || 0;

      const postInteractions = db
        .prepare("SELECT likes, comments FROM posts")
        .all();
      const likesCount = countLikesForUser(postInteractions, id);
      const commentsCount = countCommentsForUser(postInteractions, id);

      const recentPosts = db
        .prepare(
          "SELECT id, title, createdAt FROM posts WHERE userId = ? ORDER BY createdAt DESC LIMIT 5",
        )
        .all(id);

      res.json({
        postsCount,
        likesCount,
        commentsCount,
        recentPosts,
      });
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // Server-side rendered profile page for social sharing
  app.get("/profile/:username", (req, res) => {
    try {
      const username = req.params.username;
      const user = getUserByUsername(username);
      if (!user) return res.status(404).send("User not found");
      const spaPath = `/profile/${username}`;
      if (shouldRedirectToSpa(req)) {
        if (handleHumanSpaRequest(req, res, spaPath)) return;
        return sendFrontendRedirectConfigError(req, res, spaPath);
      }

      const host = req.get("host");
      const protocol =
        req.headers["x-forwarded-proto"] || req.protocol || "http";
      const requestPath = req.originalUrl || req.path || `/profile/${username}`;

      const html = buildProfileSeoPage({
        user,
        protocol,
        host,
        requestPath,
        spaPath,
      });

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch {
      res.status(500).send("Server error");
    }
  });
};
