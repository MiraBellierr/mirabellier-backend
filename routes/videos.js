function buildNestedComments(rawComments, getUserById, userPublic) {
  const commentsById = {};

  rawComments.forEach((comment) => {
    commentsById[comment.id] = {
      ...comment,
      children: [],
      user: comment.userId ? userPublic(getUserById(comment.userId)) : null,
    };
  });

  const nested = [];
  rawComments.forEach((comment) => {
    const node = commentsById[comment.id];
    if (!node) return;

    if (comment.parentId) {
      const parent = commentsById[comment.parentId];
      if (parent) {
        parent.children.push(node);
        return;
      }
    }

    nested.push(node);
  });

  return nested;
}

function parseLikesForList(likesValue) {
  try {
    if (likesValue === null || likesValue === undefined) return [];
    if (typeof likesValue === "string") return JSON.parse(likesValue);
    if (typeof likesValue === "number") return [];
    return [];
  } catch {
    return [];
  }
}

function parseLikesForMutation(likesValue) {
  let likes = [];
  try {
    if (likesValue) {
      likes = Array.isArray(likesValue) ? likesValue : JSON.parse(likesValue);
    }
  } catch {
    likes = [];
  }
  return likes;
}

function mapVideoRow(row, getUserById, userPublic) {
  const rawComments = row.comments ? JSON.parse(row.comments) : [];
  const comments = buildNestedComments(rawComments, getUserById, userPublic);
  const likes = parseLikesForList(row.likes);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    url: row.url,
    userId: row.userId,
    likes,
    comments,
    createdAt: row.createdAt,
    source: row.source,
    originalMetadata: row.originalMetadata
      ? JSON.parse(row.originalMetadata)
      : null,
    user: row.userId
      ? {
          id: row.userId,
          username: row.authorUsername,
          avatar: row.authorAvatar,
        }
      : null,
  };
}

function resolveVideoOwnerId(authFromReq, req) {
  const userFromToken = authFromReq(req);
  return userFromToken ? userFromToken.id : req.body.userId || null;
}

function createUploadedVideoPayload({
  id,
  title,
  description,
  filePath,
  userId,
  createdAt,
  likesCount,
}) {
  return {
    id,
    name: title,
    description,
    url: filePath,
    userId: userId || null,
    likes: likesCount,
    comments: [],
    createdAt,
    source: "upload",
    originalMetadata: null,
  };
}

module.exports = function registerVideoRoutes(app, deps) {
  const { db, getUserById, userPublic, authFromReq, videoUpload } = deps;

  app.post("/upload-video", videoUpload.single("video"), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Video file is required." });
      }

      const finalFilename = req.file.filename;
      const title =
        req.body.customTitle || finalFilename.replace(/\.[^/.]+$/, "");
      const id = Date.now().toString();
      const createdAt = new Date().toISOString();
      const userId = resolveVideoOwnerId(authFromReq, req);
      const description = req.body.description || "";
      const filePath = `/videos/${finalFilename}`;
      const likesCount = req.body.likes ? parseInt(req.body.likes, 10) : 0;

      db.prepare(
        "INSERT INTO videos (id, name, description, url, userId, likes, comments, createdAt, source, originalMetadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        title,
        description,
        filePath,
        userId,
        JSON.stringify([]),
        JSON.stringify([]),
        createdAt,
        "upload",
        null,
      );

      res.status(201).json(
        createUploadedVideoPayload({
          id,
          title,
          description,
          filePath,
          userId,
          createdAt,
          likesCount,
        }),
      );
    } catch (err) {
      res.status(500).json({
        error: "Video upload failed",
        details: err.message,
        type: err.name || "ProcessingError",
      });
    }
  });

  app.get("/videos", (req, res) => {
    try {
      const rows = db
        .prepare(
          "SELECT v.*, u.username as authorUsername, u.avatar as authorAvatar FROM videos v LEFT JOIN users u ON u.id = v.userId ORDER BY createdAt DESC",
        )
        .all();

      const enriched = rows.map((row) =>
        mapVideoRow(row, getUserById, userPublic),
      );
      // Cache videos list for 60 seconds
      res.setHeader(
        "Cache-Control",
        "public, max-age=60, stale-while-revalidate=300",
      );
      res.json(enriched);
    } catch {
      res.status(500).json({ error: "Failed to read videos" });
    }
  });

  app.post("/videos/:id/comments", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });

      const videoId = req.params.id;
      const text = (req.body.text || "").toString().trim();
      const parentId = req.body.parentId || null;

      if (!text) return res.status(400).json({ error: "text required" });

      const row = db
        .prepare("SELECT comments FROM videos WHERE id = ?")
        .get(videoId);
      if (!row) return res.status(404).json({ error: "video not found" });

      const comments = row.comments ? JSON.parse(row.comments) : [];
      const comment = {
        id: Date.now().toString(),
        userId: user.id,
        text,
        parentId,
        createdAt: new Date().toISOString(),
      };

      comments.push(comment);
      db.prepare("UPDATE videos SET comments = ? WHERE id = ?").run(
        JSON.stringify(comments),
        videoId,
      );

      res
        .status(201)
        .json({ ...comment, user: userPublic(user), children: [] });
    } catch {
      res.status(500).json({ error: "failed to add comment" });
    }
  });

  app.post("/videos/:id/like", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });

      const videoId = req.params.id;
      const action = req.body && req.body.action ? req.body.action : "like";
      const row = db
        .prepare("SELECT likes FROM videos WHERE id = ?")
        .get(videoId);
      if (!row) return res.status(404).json({ error: "video not found" });

      let likes = parseLikesForMutation(row.likes);
      const userId = user.id;

      if (action === "like") {
        if (!likes.includes(userId)) likes.push(userId);
      } else if (action === "unlike") {
        likes = likes.filter((id) => id !== userId);
      } else {
        return res.status(400).json({ error: "invalid action" });
      }

      db.prepare("UPDATE videos SET likes = ? WHERE id = ?").run(
        JSON.stringify(likes),
        videoId,
      );

      res.json({ likes });
    } catch {
      res.status(500).json({ error: "failed to update likes" });
    }
  });
};
