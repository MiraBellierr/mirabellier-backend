const express = require("express");
const path = require("path");
const fs = require("fs");
const { isOwner } = require("../lib/authz");
const {
  handleHumanSpaRequest,
  sendFrontendRedirectConfigError,
} = require("../lib/spa-entry");
const {
  normalizeTikTokUrl,
  normalizeTikTokQueueEntry,
  readTikTokList,
  fetchTikTokMetadata,
  fetchTikTokOembed,
} = require("../lib/tiktok");
const {
  classifyPlatform,
  resolveSocialVideo,
  downloadSocialVideo,
  stripHashtags,
  transcodeToH264,
} = require("../lib/social");
const { mirrorAvatarToPng } = require("../lib/avatar-png");

const VIDEO_TITLE_MAX_LENGTH = 4000;
const COMMENT_MAX_LENGTH = 500;
const MAX_VIDEO_TAGS = 10;
const MAX_TAG_LENGTH = 20;
const MAX_AUTHOR_USERNAME_LENGTH = 32;
const SEO_CAPTION_MAX_LENGTH = 200;

const IMPORT_JOBS = new Map();
const IMPORT_JOB_MAX_AGE_MS = 15 * 60 * 1000;
let importJobSequence = 0;

const TAG_LIKE_WEIGHT = 3;
const TAG_COMMENT_WEIGHT = 5;
const ENGAGEMENT_LIKE_WEIGHT = 1;
const ENGAGEMENT_COMMENT_WEIGHT = 2;

function parseLikes(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseTags(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sanitizeTag(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, MAX_TAG_LENGTH);
}

function sanitizeTags(raw) {
  const seen = new Set();
  const tags = [];
  for (const entry of parseTags(raw)) {
    const tag = sanitizeTag(entry);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_VIDEO_TAGS) break;
  }
  return tags;
}

function truncateCodePoints(value, maxLength) {
  const chars = Array.from(String(value || ""));
  if (chars.length <= maxLength) return String(value || "");
  return chars.slice(0, maxLength).join("");
}

function validateAuthorUsername(raw) {
  const value = String(raw || "").trim();
  if (!value) return "Username cannot be empty";
  if (Array.from(value).length > MAX_AUTHOR_USERNAME_LENGTH) {
    return "Username must be 32 characters or fewer";
  }
  return null;
}

function mapAuthor(row) {
  if (!row.authorId) return null;
  return {
    id: row.authorId,
    username: row.authorUsername || "unknown",
    avatar: row.authorAvatar || null,
    bio: row.authorBio || null,
  };
}

function mapVideoRow(row, viewerId) {
  const likes = parseLikes(row.likes);
  return {
    id: row.id,
    title: String(row.title || "").trim(),
    tags: parseTags(row.tags),
    url: `/videos/${row.filename}`,
    mimeType: row.mimeType || "video/mp4",
    sizeBytes: row.sizeBytes || 0,
    durationSeconds: row.durationSeconds ?? null,
    likesCount: likes.length,
    likedByMe: Boolean(viewerId && likes.includes(viewerId)),
    commentsCount: row.commentsCount || 0,
    createdAt: row.createdAt,
    author: mapAuthor(row),
  };
}

function mapCommentRow(row) {
  return {
    id: row.id,
    content: String(row.content || ""),
    createdAt: row.createdAt,
    author: {
      id: row.authorId,
      username: row.authorUsername || "unknown",
      avatar: row.authorAvatar || null,
    },
  };
}

function setNoStoreHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isLikelyCrawler(userAgent) {
  const value = String(userAgent || "").toLowerCase();
  if (/whatsapp/.test(value) && !value.includes("mozilla")) {
    return true;
  }
  return /bot|crawler|spider|preview|pinterest|redditbot|embedly|viber|kakaotalk|facebookexternalhit|twitterbot|discordbot|slackbot|linkedinbot|google-inspectiontool|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandex/.test(
    value,
  );
}

function trimSeoCaption(raw) {
  const collapsed = String(raw || "").trim().replace(/\s+/g, " ");
  return collapsed.length > SEO_CAPTION_MAX_LENGTH
    ? `${collapsed.slice(0, SEO_CAPTION_MAX_LENGTH - 3)}…`
    : collapsed;
}

function buildVideoSeoPage({ row, protocol, host, requestPath }) {
  const username = String(row.authorUsername || "unknown");
  const pageTitle = `@${username} · Pixies`;
  const caption = trimSeoCaption(row.title);
  const description =
    caption || `Watch this pixie by @${username} on Mirabellier.`;
  const pageUrl = `${protocol}://${host}${requestPath}`;
  const videoUrl = `${protocol}://${host}/videos/${row.filename}`;
  const mimeType = row.mimeType || "video/mp4";

  const rawAvatar = String(row.authorAvatar || "");
  const avatarUrl = rawAvatar
    ? /^https?:\/\//i.test(rawAvatar)
      ? rawAvatar
      : `${protocol}://${host}${rawAvatar}`
    : "";
  const imageUrl = avatarUrl || `${protocol}://${host}/background.jpg`;
  const imageAlt = `@${username} on Pixies`;

  const imageTags = `    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
    <meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}" />`;

  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: pageTitle,
    description,
    thumbnailUrl: imageUrl,
    contentUrl: videoUrl,
    uploadDate: String(row.createdAt || "").slice(0, 10),
    author: { "@type": "Person", name: username },
  });

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="video.other" />
    <meta property="og:site_name" content="Mirabellier" />
    <meta property="og:title" content="${escapeHtml(pageTitle)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(pageUrl)}" />
    <meta property="og:video" content="${escapeHtml(videoUrl)}" />
    <meta property="og:video:secure_url" content="${escapeHtml(videoUrl)}" />
    <meta property="og:video:type" content="${escapeHtml(mimeType)}" />
${imageTags}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(pageUrl)}" />
    <script type="application/ld+json">${escapeHtml(structuredData)}</script>
  </head>
  <body></body>
</html>`;
}

module.exports = function registerVideoRoutes(app, deps) {
  const { db, authFromReq, VIDEOS_DIR, IMAGES_DIR, videoUpload } = deps;
  const router = express.Router();

  function isValidAvatarUrl(raw) {
    const value = String(raw || "").trim();
    if (!value) return true;
    if (/^\/images\/[A-Za-z0-9._/+-]+$/.test(value)) return true;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  const selectAllVideos = db.prepare(
    `SELECT v.id, v.userId, v.title, v.tags, v.filename, v.mimeType, v.sizeBytes, v.durationSeconds, v.likes, v.createdAt,
            u.id AS authorId, u.username AS authorUsername, u.avatar AS authorAvatar, u.bio AS authorBio,
            (SELECT COUNT(*) FROM user_video_comments c WHERE c.videoId = v.id) AS commentsCount
     FROM user_videos v
     LEFT JOIN users u ON u.id = v.userId
     ORDER BY v.createdAt DESC`,
  );

  const selectUserVideos = db.prepare(
    `SELECT v.id, v.userId, v.title, v.tags, v.filename, v.mimeType, v.sizeBytes, v.durationSeconds, v.likes, v.createdAt,
            u.id AS authorId, u.username AS authorUsername, u.avatar AS authorAvatar, u.bio AS authorBio,
            (SELECT COUNT(*) FROM user_video_comments c WHERE c.videoId = v.id) AS commentsCount
     FROM user_videos v
     LEFT JOIN users u ON u.id = v.userId
     WHERE v.userId = ?
     ORDER BY v.createdAt DESC`,
  );

  const selectVideoById = db.prepare(
    `SELECT v.id, v.userId, v.title, v.tags, v.filename, v.mimeType, v.sizeBytes, v.durationSeconds, v.likes, v.createdAt,
            u.id AS authorId, u.username AS authorUsername, u.avatar AS authorAvatar, u.bio AS authorBio,
            (SELECT COUNT(*) FROM user_video_comments c WHERE c.videoId = v.id) AS commentsCount
     FROM user_videos v
     LEFT JOIN users u ON u.id = v.userId
     WHERE v.id = ?`,
  );

  const insertVideo = db.prepare(
    `INSERT INTO user_videos (id, userId, title, tags, filename, mimeType, sizeBytes, durationSeconds, likes, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
  );

  const selectDistinctTags = db.prepare(
    `SELECT DISTINCT tags FROM user_videos WHERE tags IS NOT NULL`,
  );

  const selectCommentedVideoTags = db.prepare(
    `SELECT v.tags
     FROM user_video_comments c
     JOIN user_videos v ON v.id = c.videoId
     WHERE c.userId = ?`,
  );

  const selectViewedVideoIds = db.prepare(
    `SELECT videoId FROM user_video_views WHERE userId = ?`,
  );

  const insertVideoView = db.prepare(
    `INSERT OR IGNORE INTO user_video_views (id, videoId, userId, createdAt)
     VALUES (?, ?, ?, ?)`,
  );

  const selectUserByUsername = db.prepare(
    `SELECT id, username, avatar, passwordHash, discordId FROM users WHERE username = ?`,
  );

  const insertUser = db.prepare(
    `INSERT INTO users (id, username, avatar, createdAt) VALUES (?, ?, ?, ?)`,
  );

  const updateUserAvatar = db.prepare(
    `UPDATE users SET avatar = ? WHERE id = ?`,
  );

  function resolveAuthorWithAvatar({ username, avatar }) {
    const existing = selectUserByUsername.get(username);
    if (!existing) {
      const authorId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const now = new Date().toISOString();
      insertUser.run(authorId, username, avatar, now);
      return { id: authorId, username, avatar };
    }
    // Placeholder authors (created by earlier admin imports/uploads) have no
    // password or Discord link — refresh their avatar to the real one.
    // Real registered accounts always keep their own avatar.
    if (avatar && !existing.passwordHash && !existing.discordId) {
      updateUserAvatar.run(avatar, existing.id);
      return { id: existing.id, username: existing.username, avatar };
    }
    return {
      id: existing.id,
      username: existing.username,
      avatar: existing.avatar,
    };
  }

  const updateVideoLikes = db.prepare(
    `UPDATE user_videos SET likes = ? WHERE id = ?`,
  );

  const deleteVideoById = db.prepare(`DELETE FROM user_videos WHERE id = ?`);

  const selectVideoComments = db.prepare(
    `SELECT c.id, c.content, c.createdAt,
            u.id AS authorId, u.username AS authorUsername, u.avatar AS authorAvatar
     FROM user_video_comments c
     LEFT JOIN users u ON u.id = c.userId
     WHERE c.videoId = ?
     ORDER BY c.createdAt DESC`,
  );

  const insertVideoComment = db.prepare(
    `INSERT INTO user_video_comments (id, videoId, userId, content, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const selectCommentById = db.prepare(
    `SELECT c.*, v.userId AS videoOwnerId
     FROM user_video_comments c
     LEFT JOIN user_videos v ON v.id = c.videoId
     WHERE c.id = ?`,
  );

  const deleteCommentById = db.prepare(
    `DELETE FROM user_video_comments WHERE id = ?`,
  );

  const deleteVideoComments = db.prepare(
    `DELETE FROM user_video_comments WHERE videoId = ?`,
  );

  const selectStoredVideoId = db.prepare(
    `SELECT id FROM user_videos WHERE id = ?`,
  );

  const updateVideoFile = db.prepare(
    `UPDATE user_videos SET filename = ?, mimeType = ?, sizeBytes = ? WHERE id = ?`,
  );

  // Direct uploads are stored as-is so the original quality is never touched,
  // then this background pass probes the file and — only when needed —
  // remuxes or re-encodes it (H.264/AAC + faststart, same resolution and
  // frame rate) so every device can stream it. The DB row is repointed to the
  // new file when one is produced.
  function finalizeUploadedVideo(rowId, originalFilePath) {
    void (async () => {
      try {
        const result = await transcodeToH264(originalFilePath);
        if (!result.converted) return;
        if (!selectStoredVideoId.get(rowId)) {
          await fs.promises.unlink(result.filePath).catch(() => {});
          return;
        }
        updateVideoFile.run(
          path.basename(result.filePath),
          result.mimeType,
          result.sizeBytes,
          rowId,
        );
        if (result.filePath !== originalFilePath) {
          await fs.promises.unlink(originalFilePath).catch(() => {});
        }
      } catch (err) {
        // Keep the original file so nothing is lost; the pixie stays as
        // uploaded and the repair script can convert it later.
        console.error(
          "Could not make uploaded video playable everywhere:",
          err instanceof Error ? err.message : err,
        );
      }
    })();
  }

  function buildViewerTagWeights(viewerId, videoRows) {
    const weights = new Map();
    const addTags = (rawTags, weight) => {
      for (const tag of parseTags(rawTags)) {
        weights.set(tag, (weights.get(tag) || 0) + weight);
      }
    };

    for (const row of videoRows) {
      if (parseLikes(row.likes).includes(viewerId)) {
        addTags(row.tags, TAG_LIKE_WEIGHT);
      }
    }

    const commentedRows = selectCommentedVideoTags.all(viewerId);
    for (const row of commentedRows) {
      addTags(row.tags, TAG_COMMENT_WEIGHT);
    }

    return weights;
  }

  function tagAffinity(row, weights) {
    let affinity = 0;
    for (const tag of parseTags(row.tags)) {
      affinity += weights.get(tag) || 0;
    }
    return affinity;
  }

  function scoreVideo(row, weights) {
    const likes = parseLikes(row.likes).length;
    const comments = row.commentsCount || 0;

    return (
      tagAffinity(row, weights) +
      ENGAGEMENT_LIKE_WEIGHT * Math.log1p(likes) +
      ENGAGEMENT_COMMENT_WEIGHT * Math.log1p(comments)
    );
  }

  // ── Upload a video ──
  router.post("/", videoUpload.single("video"), (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });

      if (!req.file) {
        return res.status(400).json({ error: "No video provided" });
      }

      const rawTitle = String(req.body?.title || "").trim();
      const title = rawTitle.slice(0, VIDEO_TITLE_MAX_LENGTH);

      const tags = sanitizeTags(req.body?.tags);
      if (tags.length === 0) {
        const filePath = path.join(VIDEOS_DIR, req.file.filename);
        fs.promises.unlink(filePath).catch(() => {});
        return res
          .status(400)
          .json({ error: "At least one tag is required" });
      }

      let durationSeconds = null;
      const rawDuration = Number.parseFloat(req.body?.durationSeconds);
      if (Number.isFinite(rawDuration) && rawDuration > 0) {
        durationSeconds = rawDuration;
      }

      const id = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const createdAt = new Date().toISOString();

      insertVideo.run(
        id,
        user.id,
        title,
        JSON.stringify(tags),
        req.file.filename,
        req.file.mimetype || "video/mp4",
        req.file.size || 0,
        durationSeconds,
        createdAt,
      );

      finalizeUploadedVideo(id, path.join(VIDEOS_DIR, req.file.filename));

      setNoStoreHeaders(res);
      res.status(201).json(mapVideoRow(selectVideoById.get(id), user.id));
    } catch (err) {
      if (req.file) {
        const filePath = path.join(VIDEOS_DIR, req.file.filename);
        fs.promises.unlink(filePath).catch(() => {});
      }
      res.status(500).json({ error: "Upload failed" });
    }
  });

  // ── Admin upload with custom author (owner only) ──
  router.post("/admin", videoUpload.single("video"), (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });
      if (!isOwner(user)) return res.status(403).json({ error: "forbidden" });

      const cleanupFile = () => {
        if (!req.file) return;
        const filePath = path.join(VIDEOS_DIR, req.file.filename);
        fs.promises.unlink(filePath).catch(() => {});
      };

      if (!req.file) {
        return res.status(400).json({ error: "No video provided" });
      }

      const rawUsername = String(req.body?.username || "").trim();
      const usernameError = validateAuthorUsername(rawUsername);
      if (usernameError) {
        cleanupFile();
        return res.status(400).json({ error: usernameError });
      }

      const rawAvatar = String(req.body?.avatarUrl || "").trim();
      let avatar = null;
      if (rawAvatar) {
        if (!isValidAvatarUrl(rawAvatar)) {
          cleanupFile();
          return res.status(400).json({ error: "Invalid avatar URL" });
        }
        avatar = rawAvatar;
      }

      const tags = sanitizeTags(req.body?.tags);

      const title = String(req.body?.title || "")
        .trim()
        .slice(0, VIDEO_TITLE_MAX_LENGTH);

      let durationSeconds = null;
      const rawDuration = Number.parseFloat(req.body?.durationSeconds);
      if (Number.isFinite(rawDuration) && rawDuration > 0) {
        durationSeconds = rawDuration;
      }

      const authorUser = resolveAuthorWithAvatar({
        username: rawUsername,
        avatar,
      });

      const id = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const createdAt = new Date().toISOString();

      insertVideo.run(
        id,
        authorUser.id,
        title,
        JSON.stringify(tags),
        req.file.filename,
        req.file.mimetype || "video/mp4",
        req.file.size || 0,
        durationSeconds,
        createdAt,
      );

      finalizeUploadedVideo(id, path.join(VIDEOS_DIR, req.file.filename));

      setNoStoreHeaders(res);
      res.status(201).json(mapVideoRow(selectVideoById.get(id), user.id));
    } catch (err) {
      if (req.file) {
        const filePath = path.join(VIDEOS_DIR, req.file.filename);
        fs.promises.unlink(filePath).catch(() => {});
      }
      res.status(500).json({ error: "Upload failed" });
    }
  });

  // ── TikTok import queue (owner only) ──
  router.get("/admin/tiktok/queue", async (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });
      if (!isOwner(user)) return res.status(403).json({ error: "forbidden" });

      const entries = readTikTokList()
        .map(normalizeTikTokQueueEntry)
        .filter(Boolean);

      const shuffled = entries
        .map((entry) => ({ entry, order: Math.random() }))
        .sort((a, b) => a.order - b.order)
        .map(({ entry }) => entry);

      const rawLimit = Number.parseInt(String(req.query.limit || "12"), 10);
      const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 12, 1), 50);

      const selected = shuffled.slice(0, limit);

      const enriched = await Promise.all(
        selected.map(async (entry) => {
          const needsMeta =
            !entry.username || !entry.caption || !entry.thumbnailUrl;
          if (!needsMeta) return entry;
          try {
            const oembed = await fetchTikTokOembed(entry.url);
            if (!oembed) return entry;
            return {
              ...entry,
              username: entry.username || oembed.username || undefined,
              caption: entry.caption || oembed.caption || undefined,
              thumbnailUrl:
                entry.thumbnailUrl || oembed.thumbnailUrl || undefined,
            };
          } catch {
            return entry;
          }
        }),
      );

      setNoStoreHeaders(res);
      res.json(enriched);
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // ── Public feed (personalized for authenticated viewers) ──
  router.get("/feed", (req, res) => {
    try {
      const viewer = authFromReq(req);
      const rows = selectAllVideos.all();
      const includeId =
        typeof req.query.include === "string" ? req.query.include : null;
      const excludeIds = new Set(
        typeof req.query.exclude === "string"
          ? req.query.exclude
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean)
          : [],
      );
      const rawLimit = Number.parseInt(String(req.query.limit || "10"), 10);
      const limit = Math.min(
        Math.max(Number.isFinite(rawLimit) ? rawLimit : 10, 1),
        50,
      );
      let ordered = rows;

      if (viewer) {
        const seenIds = new Set();
        for (const row of rows) {
          if (parseLikes(row.likes).includes(viewer.id)) {
            seenIds.add(row.id);
          }
        }
        for (const view of selectViewedVideoIds.all(viewer.id)) {
          seenIds.add(view.videoId);
        }
        if (includeId) seenIds.delete(includeId);

        const unwatched = rows.filter((row) => !seenIds.has(row.id));
        const watched = rows.filter((row) => seenIds.has(row.id));

        const weights = buildViewerTagWeights(viewer.id, rows);
        if (weights.size > 0) {
          const scored = unwatched.map((row) => ({
            row,
            affinity: tagAffinity(row, weights),
            score: scoreVideo(row, weights),
          }));
          const hasSuitableTags = scored.some(
            (entry) => entry.affinity > 0,
          );
          if (hasSuitableTags) {
            scored.sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              if (a.row.createdAt > b.row.createdAt) return -1;
              if (a.row.createdAt < b.row.createdAt) return 1;
              return 0;
            });
          }
          ordered = [...scored.map((entry) => entry.row), ...watched];
        } else {
          ordered = [...unwatched, ...watched];
        }
      }

      if (includeId) {
        ordered = ordered.filter((row) => row.id !== includeId);
        const includeRow = rows.find((row) => row.id === includeId);
        if (includeRow) ordered = [includeRow, ...ordered];
      }

      if (excludeIds.size > 0) {
        ordered = ordered.filter((row) => !excludeIds.has(row.id));
      }

      setNoStoreHeaders(res);
      res.json(
        ordered.slice(0, limit).map((row) => mapVideoRow(row, viewer?.id)),
      );
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // ── Tag suggestions (video-only corpus) ──
  router.get("/tags", (_req, res) => {
    try {
      const rows = selectDistinctTags.all();
      const counts = new Map();
      for (const row of rows) {
        for (const tag of parseTags(row.tags)) {
          counts.set(tag, (counts.get(tag) || 0) + 1);
        }
      }
      const sorted = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .map(([tag]) => tag);
      setNoStoreHeaders(res);
      res.json(sorted);
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // ── Videos by user ──
  router.get("/user/:userId", (req, res) => {
    try {
      const viewer = authFromReq(req);
      const rows = selectUserVideos.all(String(req.params.userId));
      setNoStoreHeaders(res);
      res.json(rows.map((row) => mapVideoRow(row, viewer?.id)));
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // ── Record a view (marks the video as watched for this user) ──
  router.post("/:id/view", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });

      const row = selectVideoById.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: "not found" });

      const id = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      insertVideoView.run(id, row.id, user.id, new Date().toISOString());

      setNoStoreHeaders(res);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // ── Toggle like ──
  router.post("/:id/like", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });

      const row = selectVideoById.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: "not found" });

      const likes = parseLikes(row.likes);
      const existingIndex = likes.indexOf(user.id);
      let liked = false;

      if (existingIndex >= 0) {
        likes.splice(existingIndex, 1);
      } else {
        likes.push(user.id);
        liked = true;
      }

      updateVideoLikes.run(JSON.stringify(likes), row.id);
      setNoStoreHeaders(res);
      res.json({ liked, likesCount: likes.length });
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // ── List comments ──
  router.get("/:id/comments", (req, res) => {
    try {
      const video = selectVideoById.get(String(req.params.id));
      if (!video) return res.status(404).json({ error: "not found" });

      const rows = selectVideoComments.all(video.id);
      setNoStoreHeaders(res);
      res.json(rows.map(mapCommentRow));
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // ── Add a comment ──
  router.post("/:id/comments", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });

      const video = selectVideoById.get(String(req.params.id));
      if (!video) return res.status(404).json({ error: "not found" });

      const content = String(req.body?.content || "").trim();
      if (!content) {
        return res.status(400).json({ error: "Comment cannot be empty" });
      }
      if (content.length > COMMENT_MAX_LENGTH) {
        return res.status(400).json({ error: "Comment is too long" });
      }

      const id = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const createdAt = new Date().toISOString();
      insertVideoComment.run(id, video.id, user.id, content, createdAt);

      setNoStoreHeaders(res);
      res.status(201).json({
        id,
        content,
        createdAt,
        author: {
          id: user.id,
          username: user.username,
          avatar: user.avatar || null,
        },
      });
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // ── Delete a comment (author, video owner, or site owner) ──
  router.delete("/:id/comments/:commentId", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });

      const comment = selectCommentById.get(String(req.params.commentId));
      if (!comment) return res.status(404).json({ error: "not found" });

      const isAuthor = comment.userId === user.id;
      const isVideoOwner = comment.videoOwnerId === user.id;
      if (!isAuthor && !isVideoOwner && !isOwner(user)) {
        return res.status(403).json({ error: "forbidden" });
      }

      deleteCommentById.run(comment.id);
      setNoStoreHeaders(res);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // ── Delete a video ──
  router.delete("/:id", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });

      const row = selectVideoById.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: "not found" });

      const isVideoOwner = row.userId === user.id;
      if (!isVideoOwner && !isOwner(user)) {
        return res.status(403).json({ error: "forbidden" });
      }

      deleteVideoById.run(row.id);
      deleteVideoComments.run(row.id);

      const filePath = path.join(VIDEOS_DIR, row.filename);
      fs.promises.unlink(filePath).catch(() => {});

      setNoStoreHeaders(res);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // ── Resolve TikTok video metadata (owner only) ──
  router.post("/admin/tiktok-resolve", async (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });
      if (!isOwner(user)) return res.status(403).json({ error: "forbidden" });

      const metadata = await fetchTikTokMetadata(req.body?.url);
      if (metadata.error) {
        return res.status(502).json({ error: metadata.error });
      }

      setNoStoreHeaders(res);
      res.json({
        username: metadata.username || "",
        avatarUrl: metadata.avatarUrl || "",
        caption: stripHashtags(metadata.caption || ""),
        hashtags: metadata.tags || [],
        durationSeconds: metadata.durationSeconds ?? null,
        coverUrl: metadata.thumbnailUrl || "",
      });
    } catch (err) {
      res.status(502).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to resolve TikTok video",
      });
    }
  });

  // ── Avatar preview proxy (owner only) ──
  // IG/TikTok CDN avatar links are token-bound to the server's IP and 403
  // from the browser. Mirror server-side and redirect to the local copy so
  // the admin form's avatar preview renders.
  router.get("/admin/avatar-proxy", async (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });
      if (!isOwner(user)) return res.status(403).json({ error: "forbidden" });

      const rawUrl = String(req.query.url || "").trim();
      let parsed = null;
      try {
        parsed = new URL(rawUrl);
      } catch {
        parsed = null;
      }
      if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
        return res.status(400).json({ error: "Invalid avatar URL" });
      }

      const mirrored = await mirrorAvatarToPng(rawUrl, IMAGES_DIR);
      if (mirrored !== rawUrl) {
        return res.redirect(mirrored);
      }

      // Mirroring failed (source refused) — stream what the server can reach.
      try {
        const remote = await fetch(rawUrl, {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(12000),
        });
        if (!remote.ok || !remote.body) {
          return res.status(502).json({ error: "Avatar unavailable" });
        }
        res.setHeader("Content-Type", remote.headers.get("content-type") || "image/jpeg");
        setNoStoreHeaders(res);
        const reader = remote.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } catch {
        res.status(502).json({ error: "Avatar unavailable" });
      }
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // ── Resolve TikTok / Instagram / YouTube metadata (owner only). Runs as a
  // background job so the admin form can show progress while TikTok/IG
  // throttle; poll GET /admin/resolve/status/:jobId. ──
  router.post("/admin/resolve", async (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });
      if (!isOwner(user)) return res.status(403).json({ error: "forbidden" });

      const rawUrl = String(req.body?.url || "").trim();
      if (!classifyPlatform(rawUrl)) {
        return res.status(400).json({
          error:
            "Unsupported URL — paste a TikTok, Instagram reel, or YouTube Shorts link",
        });
      }

      pruneImportJobs();
      importJobSequence += 1;
      const job = {
        jobId: `resolve-${Date.now()}-${importJobSequence}`,
        ownerId: user.id,
        state: "queued",
        stage: "queued",
        message: "Starting…",
        progress: 0,
        error: null,
        result: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      IMPORT_JOBS.set(job.jobId, job);
      performResolveJob(job, rawUrl).catch((err) => {
        Object.assign(job, {
          state: "error",
          error: err instanceof Error ? err.message : "Failed to fetch details",
          updatedAt: Date.now(),
        });
      });

      setNoStoreHeaders(res);
      res.status(202).json({ jobId: job.jobId });
    } catch {
      res.status(500).json({ error: "Failed to fetch details" });
    }
  });

  // ── Resolve job status (owner only) ──
  router.get("/admin/resolve/status/:jobId", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });
      if (!isOwner(user)) return res.status(403).json({ error: "forbidden" });

      const job = IMPORT_JOBS.get(String(req.params.jobId));
      if (!job) return res.status(404).json({ error: "Job not found" });
      setNoStoreHeaders(res);
      res.json(importJobSnapshot(job));
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // ── Social import jobs: run in the background so the admin form can show
  // real-time progress while the video resolves/downloads. ──

  function pruneImportJobs() {
    const now = Date.now();
    for (const [id, job] of IMPORT_JOBS) {
      if (now - job.createdAt > IMPORT_JOB_MAX_AGE_MS) IMPORT_JOBS.delete(id);
    }
  }

  // "Creep" the bar inside long stages (resolve/download can take minutes
  // while TikTok/IG throttle) so progress never looks frozen.
  function startJobCreep(job, from, to) {
    job.progress = from;
    const interval = setInterval(() => {
      if (job.state !== "running" || job.progress >= to) return;
      job.progress = Math.min(
        to,
        job.progress + 0.7 + Math.random() * 1.4,
      );
      job.updatedAt = Date.now();
    }, 700);
    return interval;
  }

  function importJobSnapshot(job) {
    return {
      jobId: job.jobId,
      state: job.state,
      stage: job.stage,
      message: job.message,
      progress: Math.round(job.progress),
      error: job.error || null,
      result: job.result || null,
      reel: job.reel || null,
    };
  }

  async function performResolveJob(job, rawUrl) {
    const update = (stage, message, progress) => {
      Object.assign(job, {
        state: "running",
        stage,
        message,
        progress,
        updatedAt: Date.now(),
      });
    };
    const creep = startJobCreep(job, 3, 92);
    try {
      update("resolve", "Fetching video details…", 3);
      const resolved = await resolveSocialVideo(rawUrl);
      Object.assign(job, {
        state: "done",
        stage: "done",
        message: "Details ready!",
        progress: 100,
        result: {
          platform: resolved.platform,
          username: resolved.username || "",
          avatarUrl: String(resolved.avatarUrl || "").trim(),
          caption: resolved.caption || "",
          hashtags: resolved.hashtags || [],
          durationSeconds: resolved.durationSeconds ?? null,
          coverUrl: resolved.coverUrl || "",
        },
        updatedAt: Date.now(),
      });
    } catch (err) {
      Object.assign(job, {
        state: "error",
        error: err instanceof Error ? err.message : "Failed to fetch details",
        updatedAt: Date.now(),
      });
    } finally {
      clearInterval(creep);
    }
  }

  async function performImportJob(job, body) {
    const update = (stage, message, progress) => {
      Object.assign(job, {
        state: "running",
        stage,
        message,
        progress,
        updatedAt: Date.now(),
      });
    };
    let creep = null;

    const rawUrl = String(body.url || "").trim();
    let downloadedFilePath = null;
    try {
      update("resolve", "Fetching video details…", 4);
      creep = startJobCreep(job, 4, 30);
      let resolved = null;
      try {
        resolved = await resolveSocialVideo(rawUrl);
      } catch {
        resolved = null;
      }

      const username = truncateCodePoints(
        String(body.username || "").trim() ||
          String(resolved?.username || "").trim(),
        MAX_AUTHOR_USERNAME_LENGTH,
      );
      if (!username) {
        Object.assign(job, {
          state: "error",
          error:
            "Could not determine an author username — fill in the username field",
        });
        return;
      }

      clearInterval(creep);
      update("download", "Downloading video…", 34);
      creep = startJobCreep(job, 34, 82);
      const destBase = path.join(
        VIDEOS_DIR,
        `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
      );
      const downloaded = await downloadSocialVideo(rawUrl, destBase, {
        metadata: resolved,
      });
      downloadedFilePath = downloaded.filePath;

      clearInterval(creep);
      update("process", "Making the video playable on every device…", 86);
      creep = startJobCreep(job, 86, 94);
      const converted = await transcodeToH264(downloaded.filePath);
      if (converted.converted && converted.filePath !== downloaded.filePath) {
        await fs.promises.unlink(downloaded.filePath).catch(() => {});
        downloadedFilePath = converted.filePath;
      }
      const sizeBytes = converted.sizeBytes;
      const mimeType = converted.mimeType;
      let avatar =
        String(body.avatarUrl || "").trim() ||
        String(resolved?.avatarUrl || "").trim() ||
        null;
      if (avatar && /^https?:\/\//i.test(avatar)) {
        avatar = await mirrorAvatarToPng(avatar, IMAGES_DIR);
      }
      const durationSeconds = resolved?.durationSeconds ?? null;
      const id = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

      const authorUser = resolveAuthorWithAvatar({ username, avatar });
      const createdAt = new Date().toISOString();
      insertVideo.run(
        id,
        authorUser.id,
        body.title,
        JSON.stringify(body.tags),
        path.basename(downloadedFilePath),
        mimeType,
        sizeBytes,
        durationSeconds,
        createdAt,
      );

      clearInterval(creep);
      Object.assign(job, {
        state: "done",
        stage: "done",
        message: "Video imported!",
        progress: 100,
        reel: mapVideoRow(selectVideoById.get(id), job.ownerId),
        updatedAt: Date.now(),
      });
    } catch (err) {
      clearInterval(creep);
      if (downloadedFilePath) {
        fs.promises.unlink(downloadedFilePath).catch(() => {});
      }
      const message =
        err instanceof Error ? err.message : "Import failed";
      Object.assign(job, {
        state: "error",
        error: message,
        message: "Import failed",
        updatedAt: Date.now(),
      });
    }
  }

  function destBaseFor(_idPlaceholder, _rawUrl) {
    return path.join(
      VIDEOS_DIR,
      `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
    );
  }

  // ── Import a social video (owner only): starts a background job so the
  // admin form can stream progress. Poll GET /admin/import/status/:jobId. ──
  router.post("/admin/import", async (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });
      if (!isOwner(user)) return res.status(403).json({ error: "forbidden" });

      const rawUrl = String(req.body?.url || "").trim();
      const platform = classifyPlatform(rawUrl);
      if (!platform) {
        return res.status(400).json({
          error:
            "Unsupported URL — paste a TikTok, Instagram reel, or YouTube Shorts link",
        });
      }

      const providedUsername = String(req.body?.username || "").trim();
      const providedUsernameError = validateAuthorUsername(providedUsername);
      if (providedUsername && providedUsernameError) {
        return res.status(400).json({ error: providedUsernameError });
      }

      const providedAvatar = String(req.body?.avatarUrl || "").trim();
      if (providedAvatar && !isValidAvatarUrl(providedAvatar)) {
        return res.status(400).json({ error: "Invalid avatar URL" });
      }

      pruneImportJobs();
      importJobSequence += 1;
      const job = {
        jobId: `import-${Date.now()}-${importJobSequence}`,
        ownerId: user.id,
        state: "queued",
        stage: "queued",
        message: "Starting import…",
        progress: 0,
        error: null,
        reel: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      IMPORT_JOBS.set(job.jobId, job);

      const body = {
        url: rawUrl,
        username: providedUsername,
        avatarUrl: providedAvatar,
        tags: sanitizeTags(req.body?.tags),
        title: String(req.body?.title || "").trim().slice(0, VIDEO_TITLE_MAX_LENGTH),
      };
      performImportJob(job, body).catch((err) => {
        Object.assign(job, {
          state: "error",
          error: err instanceof Error ? err.message : "Import failed",
          updatedAt: Date.now(),
        });
      });

      setNoStoreHeaders(res);
      res.status(202).json({ jobId: job.jobId });
    } catch {
      res.status(500).json({ error: "Import failed" });
    }
  });

  // ── Import job status (owner only) ──
  router.get("/admin/import/status/:jobId", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });
      if (!isOwner(user)) return res.status(403).json({ error: "forbidden" });

      const job = IMPORT_JOBS.get(String(req.params.jobId));
      if (!job) return res.status(404).json({ error: "Job not found" });
      setNoStoreHeaders(res);
      res.json(importJobSnapshot(job));
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });

  // ── Pixies SPA handoffs (humans get the frontend app) ──
  app.get("/pixies", (req, res) => {
    if (handleHumanSpaRequest(req, res, "/pixies")) return;
    sendFrontendRedirectConfigError(req, res, "/pixies");
  });

  app.get("/pixies/upload", (req, res) => {
    if (handleHumanSpaRequest(req, res, "/pixies/upload")) return;
    sendFrontendRedirectConfigError(req, res, "/pixies/upload");
  });

  app.get("/admin/pixies", (req, res) => {
    if (handleHumanSpaRequest(req, res, "/admin/pixies")) return;
    sendFrontendRedirectConfigError(req, res, "/admin/pixies");
  });

  app.get("/admin/tiktok", (req, res) => {
    if (handleHumanSpaRequest(req, res, "/admin/tiktok")) return;
    sendFrontendRedirectConfigError(req, res, "/admin/tiktok");
  });

  // ── Pixie share links: SEO preview for crawlers, SPA for humans ──
  app.get("/pixies/:videoId", (req, res) => {
    try {
      const videoId = String(req.params.videoId || "");
      const row = selectVideoById.get(videoId);
      const spaPath = row ? `/pixies/${videoId}` : "/pixies";
      if (!isLikelyCrawler(req.get("user-agent"))) {
        if (handleHumanSpaRequest(req, res, spaPath)) return;
        return sendFrontendRedirectConfigError(req, res, spaPath);
      }
      if (!row) return res.status(404).send("Video not found");
      const protocol =
        req.headers["x-forwarded-proto"] || req.protocol || "http";
      const host = req.get("host");
      const requestPath = req.originalUrl || req.path || spaPath;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(buildVideoSeoPage({ row, protocol, host, requestPath }));
    } catch {
      res.status(500).send("Server error");
    }
  });

  app.use("/videos", router);
};
