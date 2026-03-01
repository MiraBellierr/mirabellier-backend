const { generateSitemap } = require("../lib/sitemap");

const MAX_TAGS = 5;

function sanitizeTag(value) {
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 10);
}

function normalizeTags(rawTags) {
  if (!Array.isArray(rawTags)) return [];

  return Array.from(new Set(rawTags.map(sanitizeTag).filter(Boolean))).slice(
    0,
    MAX_TAGS,
  );
}

function parseTagsInput(tagsInput) {
  if (Array.isArray(tagsInput)) return tagsInput;

  if (typeof tagsInput === "string") {
    if (!tagsInput) return [];
    return tagsInput
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function parseStoredTags(tagsValue) {
  if (!tagsValue) return [];
  const parsed = JSON.parse(tagsValue);
  if (!Array.isArray(parsed)) return [];
  return normalizeTags(parsed);
}

function parseStoredContent(contentValue) {
  return contentValue ? JSON.parse(contentValue) : null;
}

function mapPostRow(row) {
  return {
    id: row.id,
    title: row.title,
    content: parseStoredContent(row.content),
    tags: parseStoredTags(row.tags),
    shortDescription: row.shortDescription || null,
    thumbnail: row.thumbnail || null,
    userId: row.userId,
    author: row.userId
      ? row.authorName || row.author || "Unknown"
      : row.author || "Unknown",
    authorAvatar: row.userId
      ? row.authorAvatar || null
      : row.authorAvatar || null,
    createdAt: row.createdAt,
  };
}

function extractPlainText(node) {
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractPlainText).join(" ");
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text || "";
  if (node.content) return extractPlainText(node.content);
  return "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(input) {
  if (!input) return "";
  return String(input)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function parseBlogId(rawId) {
  if (!rawId) return "";
  if (!rawId.includes("-")) return rawId;
  return rawId.split("-").pop() || rawId;
}

function buildImageUrl(thumbnail, protocol, host) {
  if (!thumbnail) return "";
  if (/^https?:\/\//i.test(thumbnail)) return thumbnail;
  if (thumbnail.startsWith("/")) return `${protocol}://${host}${thumbnail}`;
  return `${protocol}://${host}/images/${thumbnail}`;
}

function buildBlogRedirectPage({
  title,
  description,
  imageUrl,
  protocol,
  host,
  requestPath,
  spaPath,
  redirectUrl,
}) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}" />` : ""}
    <meta property="og:url" content="${protocol}://${host}${requestPath}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />` : ""}
    <link rel="canonical" href="${protocol}://${host}${spaPath}" />
    <script>window.location.replace('${redirectUrl}')</script>
  </head>
  <body>
  </body>
</html>`;
}

function resolvePostAuthor(existingUserId, user, fallbackAuthor) {
  if (!existingUserId) return fallbackAuthor || "Unknown";
  return user ? user.username : fallbackAuthor || "Unknown";
}

function resolveAuthorAvatar(existingUserId, user) {
  if (!existingUserId) return null;
  return user ? user.avatar : null;
}

module.exports = function registerPostsRoutes(app, deps) {
  const { db, getUserById, authFromReq } = deps;

  app.get("/posts", (req, res) => {
    try {
      const rows = db
        .prepare(
          "SELECT p.*, u.username as authorName, u.avatar as authorAvatar FROM posts p LEFT JOIN users u ON p.userId = u.id ORDER BY createdAt DESC",
        )
        .all();

      const posts = rows.map(mapPostRow);
      // Cache for 60 seconds, allow stale content for 300s while revalidating
      res.setHeader(
        "Cache-Control",
        "public, max-age=60, stale-while-revalidate=300",
      );
      res.json(posts);
    } catch {
      res.status(500).json({ error: "failed to fetch posts" });
    }
  });

  app.get("/posts/:id", (req, res) => {
    try {
      const row = db
        .prepare(
          "SELECT p.*, u.username as authorName, u.avatar as authorAvatar FROM posts p LEFT JOIN users u ON p.userId = u.id WHERE p.id = ?",
        )
        .get(req.params.id);

      if (!row) return res.status(404).json({ error: "Not found" });

      const post = mapPostRow(row);
      // Cache individual posts for 5 minutes
      res.setHeader(
        "Cache-Control",
        "public, max-age=300, stale-while-revalidate=600",
      );
      res.json(post);
    } catch {
      res.status(500).json({ error: "failed to fetch post" });
    }
  });

  // Server-side SEO page for individual blog post (for social crawlers)
  app.get("/blog/:id", (req, res) => {
    try {
      const rawId = req.params.id || "";
      const id = parseBlogId(rawId) || rawId;
      const post = db
        .prepare(
          "SELECT p.*, u.username as authorName, u.avatar as authorAvatar FROM posts p LEFT JOIN users u ON p.userId = u.id WHERE p.id = ?",
        )
        .get(id);

      if (!post) return res.status(404).send("Not found");

      const title = post.title || "Untitled";
      let description = post.shortDescription || "";

      if (!description && post.content) {
        try {
          const parsed = JSON.parse(post.content);
          if (parsed && typeof parsed === "object") {
            description = extractPlainText(parsed).slice(0, 160);
          }
        } catch {
          // Keep existing behavior: ignore invalid rich text payloads.
        }
      }

      const host = req.get("host");
      const protocol =
        req.headers["x-forwarded-proto"] || req.protocol || "http";
      const imageUrl = buildImageUrl(post.thumbnail || null, protocol, host);

      const slug = slugify(title);
      const spaPath = `/blog/${slug ? `${slug}-${id}` : id}`;
      const requestPath = req.originalUrl || req.path || `/blog/${rawId}`;
      const redirectUrl = `${protocol}://${host}${spaPath}?_spa=1`;

      const html = buildBlogRedirectPage({
        title,
        description,
        imageUrl,
        protocol,
        host,
        requestPath,
        spaPath,
        redirectUrl,
      });

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch {
      res.status(500).send("Server error");
    }
  });

  // Return all unique tags used across posts
  app.get("/tags", (req, res) => {
    try {
      const rows = db
        .prepare("SELECT tags FROM posts WHERE tags IS NOT NULL")
        .all();

      const allTags = [];
      rows.forEach((row) => {
        try {
          const parsed = JSON.parse(row.tags);
          if (Array.isArray(parsed)) {
            parsed.forEach((tag) => allTags.push(sanitizeTag(tag)));
          }
        } catch {
          // Ignore invalid tag entries to keep endpoint resilient.
        }
      });

      const uniqueTags = Array.from(new Set(allTags))
        .filter(Boolean)
        .slice(0, 1000);
      res.json(uniqueTags);
    } catch {
      res.status(500).json({ error: "failed to fetch tags" });
    }
  });

  app.post("/posts", (req, res) => {
    try {
      const userFromToken = authFromReq(req);
      const userId = userFromToken ? userFromToken.id : req.body.userId;

      const id = Date.now().toString();
      const title = req.body.title || req.body.name || "Untitled";
      const contentObj = req.body.content || req.body.body || {};
      const shortDescription =
        req.body.shortDescription || req.body.description || null;
      const thumbnail = req.body.thumbnail || null;
      const tags = normalizeTags(parseTagsInput(req.body.tags));
      const createdAt = new Date().toISOString();

      db.prepare(
        "INSERT INTO posts (id, title, content, userId, author, shortDescription, thumbnail, tags, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        title,
        JSON.stringify(contentObj),
        userId || null,
        req.body.author || null,
        shortDescription,
        thumbnail,
        JSON.stringify(tags),
        createdAt,
      );

      const user = userId ? getUserById(userId) : null;
      const response = {
        id,
        title,
        content: contentObj,
        shortDescription,
        thumbnail,
        tags,
        userId: userId || null,
        author: userId
          ? user
            ? user.username
            : req.body.author || "Unknown"
          : req.body.author || "Unknown",
        authorAvatar: userId ? (user ? user.avatar : null) : null,
        createdAt,
      };

      generateSitemap(db);
      res.status(201).json(response);
    } catch {
      res.status(500).json({ error: "failed to save post" });
    }
  });

  app.put("/posts/:id", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthorized" });

      const id = req.params.id;
      const existing = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
      if (!existing) return res.status(404).json({ error: "Not found" });

      if (!existing.userId || existing.userId !== user.id) {
        return res.status(403).json({ error: "forbidden" });
      }

      const title = req.body.title || existing.title;
      const contentObj =
        req.body.content !== undefined
          ? req.body.content
          : existing.content
            ? JSON.parse(existing.content)
            : {};
      const shortDescription =
        req.body.shortDescription !== undefined
          ? req.body.shortDescription
          : existing.shortDescription;
      const thumbnail =
        req.body.thumbnail !== undefined
          ? req.body.thumbnail
          : existing.thumbnail;
      const rawTags =
        req.body.tags !== undefined
          ? parseTagsInput(req.body.tags)
          : existing.tags
            ? JSON.parse(existing.tags)
            : [];
      const tags = normalizeTags(rawTags);

      db.prepare(
        "UPDATE posts SET title = ?, content = ?, shortDescription = ?, thumbnail = ?, tags = ? WHERE id = ?",
      ).run(
        title,
        JSON.stringify(contentObj),
        shortDescription,
        thumbnail,
        JSON.stringify(tags),
        id,
      );

      const authorUser = getUserById(user.id);
      const response = {
        id,
        title,
        content: contentObj,
        shortDescription: shortDescription || null,
        thumbnail: thumbnail || null,
        tags: tags || [],
        userId: existing.userId || null,
        author: resolvePostAuthor(existing.userId, authorUser, existing.author),
        authorAvatar: resolveAuthorAvatar(existing.userId, authorUser),
        createdAt: existing.createdAt,
      };

      generateSitemap(db);
      res.json(response);
    } catch {
      res.status(500).json({ error: "failed to update post" });
    }
  });

  app.delete("/posts/:id", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthorized" });

      const id = req.params.id;
      const existing = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
      if (!existing) return res.status(404).json({ error: "Not found" });

      if (!existing.userId || existing.userId !== user.id) {
        return res.status(403).json({ error: "forbidden" });
      }

      db.prepare("DELETE FROM posts WHERE id = ?").run(id);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "failed to delete post" });
    }
  });
};
