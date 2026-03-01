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

    if (comment.parentId && commentsById[comment.parentId]) {
      commentsById[comment.parentId].children.push(node);
      return;
    }

    nested.push(node);
  });

  return nested;
}

function mapPicRow(row, getUserById, userPublic) {
  const rawComments = row.comments ? JSON.parse(row.comments) : [];
  return {
    ...row,
    likes: row.likes ? JSON.parse(row.likes) : [],
    comments: buildNestedComments(rawComments, getUserById, userPublic),
    author: row.authorUsername,
    authorAvatar: row.authorAvatar,
  };
}

function resolvePictureOwnerId(authFromReq, req) {
  const userFromToken = authFromReq(req);
  return userFromToken ? userFromToken.id : req.body.userId || null;
}

module.exports = function registerPicsRoutes(app, deps) {
  const {
    db,
    getUserById,
    userPublic,
    authFromReq,
    imageUpload,
    optimizeImage,
  } = deps;

  app.post("/upload-pic", imageUpload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Image file is required." });
      }

      const filename = req.file.filename;
      const title = req.body.title || filename.replace(/\.[^/.]+$/, "");
      const id = Date.now().toString();
      const createdAt = new Date().toISOString();
      const userId = resolvePictureOwnerId(authFromReq, req);
      const url = `/images/${filename}`;

      if (req.file.path) {
        await optimizeImage(req.file.path);
      }

      db.prepare(
        "INSERT INTO pics (id, title, url, userId, likes, comments, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        title,
        url,
        userId,
        JSON.stringify([]),
        JSON.stringify([]),
        createdAt,
      );

      res.status(201).json({
        id,
        title,
        url,
        userId: userId || null,
        likes: [],
        comments: [],
        createdAt,
      });
    } catch (err) {
      res.status(500).json({
        error: "Picture upload failed",
        details: err.message,
        type: err.name || "ProcessingError",
      });
    }
  });

  app.get("/pics", (req, res) => {
    try {
      const rows = db
        .prepare(
          "SELECT p.*, u.username as authorUsername, u.avatar as authorAvatar FROM pics p LEFT JOIN users u ON u.id = p.userId ORDER BY createdAt DESC",
        )
        .all();

      const enriched = rows.map((row) =>
        mapPicRow(row, getUserById, userPublic),
      );
      res.json(enriched);
    } catch {
      res.status(500).json({ error: "Failed to fetch pics" });
    }
  });

  app.post("/pics/:id/like", (req, res) => {
    try {
      const userFromToken = authFromReq(req);
      if (!userFromToken) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const pictureId = req.params.id;
      const picture = db
        .prepare("SELECT likes FROM pics WHERE id = ?")
        .get(pictureId);
      if (!picture) return res.status(404).json({ error: "Picture not found" });

      const likes = picture.likes ? JSON.parse(picture.likes) : [];
      const userId = userFromToken.id;
      const existingIndex = likes.indexOf(userId);

      if (existingIndex > -1) likes.splice(existingIndex, 1);
      else likes.push(userId);

      db.prepare("UPDATE pics SET likes = ? WHERE id = ?").run(
        JSON.stringify(likes),
        pictureId,
      );

      res.json({ likes, liked: likes.includes(userId) });
    } catch {
      res.status(500).json({ error: "Failed to like picture" });
    }
  });

  app.post("/pics/:id/comment", (req, res) => {
    try {
      const userFromToken = authFromReq(req);
      if (!userFromToken) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const pictureId = req.params.id;
      const { text, parentId } = req.body;
      const picture = db
        .prepare("SELECT comments FROM pics WHERE id = ?")
        .get(pictureId);
      if (!picture) return res.status(404).json({ error: "Picture not found" });

      const comments = picture.comments ? JSON.parse(picture.comments) : [];
      const newComment = {
        id: Date.now().toString(),
        text,
        userId: userFromToken.id,
        createdAt: new Date().toISOString(),
        parentId: parentId || null,
        children: [],
      };

      comments.push(newComment);
      db.prepare("UPDATE pics SET comments = ? WHERE id = ?").run(
        JSON.stringify(comments),
        pictureId,
      );

      res.status(201).json(newComment);
    } catch {
      res.status(500).json({ error: "Failed to add comment" });
    }
  });
};
