const express = require("express");
const path = require("path");
const fs = require("fs");
const { isOwner } = require("../lib/authz");

const VIDEO_TITLE_MAX_LENGTH = 200;
const COMMENT_MAX_LENGTH = 500;
const MAX_VIDEO_TAGS = 10;
const MAX_TAG_LENGTH = 20;
const USERNAME_PATTERN = /^[^\s/\\]{3,32}$/u;

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

module.exports = function registerVideoRoutes(app, deps) {
  const { db, authFromReq, VIDEOS_DIR, videoUpload } = deps;
  const router = express.Router();

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

  const selectUserByUsername = db.prepare(
    `SELECT id, username, avatar FROM users WHERE username = ?`,
  );

  const insertUser = db.prepare(
    `INSERT INTO users (id, username, avatar, createdAt) VALUES (?, ?, ?, ?)`,
  );

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

  function scoreVideo(row, weights) {
    let affinity = 0;
    for (const tag of parseTags(row.tags)) {
      affinity += weights.get(tag) || 0;
    }

    const likes = parseLikes(row.likes).length;
    const comments = row.commentsCount || 0;

    return (
      affinity +
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
      if (!USERNAME_PATTERN.test(rawUsername)) {
        cleanupFile();
        return res.status(400).json({
          error: "Username must be 3-32 characters without spaces or slashes",
        });
      }

      const rawAvatar = String(req.body?.avatarUrl || "").trim();
      let avatar = null;
      if (rawAvatar) {
        let parsed = null;
        try {
          parsed = new URL(rawAvatar);
        } catch {
          parsed = null;
        }
        if (
          !parsed ||
          (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        ) {
          cleanupFile();
          return res.status(400).json({ error: "Invalid avatar URL" });
        }
        avatar = rawAvatar;
      }

      const tags = sanitizeTags(req.body?.tags);
      if (tags.length === 0) {
        cleanupFile();
        return res
          .status(400)
          .json({ error: "At least one tag is required" });
      }

      const title = String(req.body?.title || "")
        .trim()
        .slice(0, VIDEO_TITLE_MAX_LENGTH);

      let durationSeconds = null;
      const rawDuration = Number.parseFloat(req.body?.durationSeconds);
      if (Number.isFinite(rawDuration) && rawDuration > 0) {
        durationSeconds = rawDuration;
      }

      // Attribute the video to an existing user with that username,
      // or create a placeholder author with the given avatar.
      let authorUser = selectUserByUsername.get(rawUsername);
      if (!authorUser) {
        const authorId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const now = new Date().toISOString();
        insertUser.run(authorId, rawUsername, avatar, now);
        authorUser = { id: authorId, username: rawUsername, avatar };
      }

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

  // ── Public feed (personalized for authenticated viewers) ──
  router.get("/feed", (req, res) => {
    try {
      const viewer = authFromReq(req);
      const rows = selectAllVideos.all();
      let ordered = rows;

      if (viewer) {
        const weights = buildViewerTagWeights(viewer.id, rows);
        const hasInteractions = weights.size > 0;
        if (hasInteractions) {
          ordered = rows
            .map((row) => ({ row, score: scoreVideo(row, weights) }))
            .sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              if (a.row.createdAt > b.row.createdAt) return -1;
              if (a.row.createdAt < b.row.createdAt) return 1;
              return 0;
            })
            .map((entry) => entry.row);
        }
      }

      setNoStoreHeaders(res);
      res.json(ordered.map((row) => mapVideoRow(row, viewer?.id)));
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

  app.use("/videos", router);
};
