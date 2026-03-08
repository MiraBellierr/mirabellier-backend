const { generateSitemap } = require("../lib/sitemap");
const {
  getWebsiteBase,
  queueIndexNowSubmission,
} = require("../lib/indexnow");

const MAX_TAGS = 10;

function sanitizeTag(value) {
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 20);
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
    if (!likesValue) return [];
    if (typeof likesValue === "string") {
      const parsed = JSON.parse(likesValue);
      return Array.isArray(parsed) ? parsed : [];
    }
    return Array.isArray(likesValue) ? likesValue : [];
  } catch {
    return [];
  }
}

function parseLikesForMutation(likesValue) {
  return parseLikesForList(likesValue);
}

function parseCommentsForMutation(commentsValue) {
  try {
    if (!commentsValue) return [];
    if (typeof commentsValue === "string") {
      const parsed = JSON.parse(commentsValue);
      return Array.isArray(parsed) ? parsed : [];
    }
    return Array.isArray(commentsValue) ? commentsValue : [];
  } catch {
    return [];
  }
}

function parseCommentsForList(commentsValue, getUserById, userPublic) {
  return buildNestedComments(
    parseCommentsForMutation(commentsValue),
    getUserById,
    userPublic,
  );
}

function mapPostRow(row, getUserById, userPublic) {
  return {
    id: row.id,
    title: row.title,
    content: parseStoredContent(row.content),
    tags: parseStoredTags(row.tags),
    likes: parseLikesForList(row.likes),
    comments: parseCommentsForList(row.comments, getUserById, userPublic),
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
    updatedAt: row.updatedAt || row.createdAt,
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

function buildBlogPath(title, id) {
  const slug = slugify(title);
  return `/blog/${slug ? `${slug}-${id}` : id}`;
}

function buildSiteUrl(pathname) {
  const normalizedPath = String(pathname || "").startsWith("/")
    ? pathname
    : `/${pathname}`;
  return `${getWebsiteBase()}${normalizedPath}`;
}

function buildBlogUrl(title, id) {
  return buildSiteUrl(buildBlogPath(title, id));
}

function buildIndexNowUrlsForPost(title, id) {
  return [buildBlogUrl(title, id), buildSiteUrl("/blog")];
}

function buildImageUrl(thumbnail, protocol, host) {
  if (!thumbnail) return "";
  if (/^https?:\/\//i.test(thumbnail)) return thumbnail;
  if (thumbnail.startsWith("/")) return `${protocol}://${host}${thumbnail}`;
  return `${protocol}://${host}/images/${thumbnail}`;
}

function buildProfileUrl(authorName, protocol, host) {
  if (!authorName) return "";
  return `${protocol}://${host}/profile/${encodeURIComponent(authorName)}`;
}

function escapeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function buildPostDescription(post) {
  if (post.shortDescription) {
    return String(post.shortDescription).trim();
  }

  if (post.content) {
    try {
      const parsed = JSON.parse(post.content);
      if (parsed && typeof parsed === "object") {
        const extracted = extractPlainText(parsed).trim();
        if (extracted) {
          return extracted.slice(0, 160);
        }
      }
    } catch {
      // Ignore malformed rich text and fall back to title.
    }
  }

  return post.title || "Untitled";
}

function buildPostExcerpt(post, maxLength = 320) {
  if (!post.content) return "";

  try {
    const parsed = JSON.parse(post.content);
    if (parsed && typeof parsed === "object") {
      const extracted = extractPlainText(parsed)
        .replace(/\s+/g, " ")
        .trim();
      if (extracted) {
        return extracted.slice(0, maxLength);
      }
    }
  } catch {
    // Ignore malformed content and return no excerpt.
  }

  return "";
}

function isLikelyCrawler(userAgent) {
  const value = String(userAgent || "").toLowerCase();
  return /bot|crawler|spider|google-inspectiontool|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandex|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot/.test(
    value,
  );
}

function buildBlogRedirectPage({
  title,
  description,
  excerpt,
  imageUrl,
  authorName,
  authorUrl,
  publishedTime,
  modifiedTime,
  tags,
  protocol,
  host,
  spaPath,
  redirectUrl,
  redirectToSpa,
}) {
  const canonicalUrl = `${protocol}://${host}${spaPath}`;
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: title,
    description,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
    datePublished: publishedTime,
    dateModified: modifiedTime || publishedTime,
    author: {
      "@type": "Person",
      name: authorName,
      ...(authorUrl ? { url: authorUrl } : {}),
    },
    publisher: {
      "@type": "Person",
      name: "Mirabellier",
      url: "https://mirabellier.com/",
    },
    ...(imageUrl ? { image: [imageUrl] } : {}),
    ...(tags && tags.length ? { keywords: tags.join(", ") } : {}),
  };
  const articleTagMeta = (tags || [])
    .map(
      (tag) =>
        `<meta property="article:tag" content="${escapeHtml(tag)}" />`,
    )
    .join("\n    ");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:site_name" content="Mirabellier" />
    ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}" />` : ""}
    ${imageUrl ? `<meta property="og:image:alt" content="${escapeHtml(title)}" />` : ""}
    <meta property="og:url" content="${canonicalUrl}" />
    ${publishedTime ? `<meta property="article:published_time" content="${escapeHtml(publishedTime)}" />` : ""}
    ${modifiedTime ? `<meta property="article:modified_time" content="${escapeHtml(modifiedTime)}" />` : ""}
    ${authorName ? `<meta property="article:author" content="${escapeHtml(authorName)}" />` : ""}
    ${articleTagMeta}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />` : ""}
    ${imageUrl ? `<meta name="twitter:image:alt" content="${escapeHtml(title)}" />` : ""}
    <link rel="canonical" href="${canonicalUrl}" />
    <script type="application/ld+json">${escapeJsonForHtml(articleJsonLd)}</script>
    ${redirectToSpa ? `<script>window.location.replace('${redirectUrl}')</script>` : ""}
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
      ${excerpt && excerpt !== description ? `<p>${escapeHtml(excerpt)}</p>` : ""}
      <p><a href="${escapeHtml(canonicalUrl)}">Read full post</a></p>
    </main>
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

function refreshSearchDiscovery(db, urls = []) {
  generateSitemap(db);
  if (urls.length) {
    void queueIndexNowSubmission(urls);
  }
}

module.exports = function registerPostsRoutes(app, deps) {
  const { db, getUserById, userPublic, authFromReq } = deps;

  app.get("/posts", (req, res) => {
    try {
      const rows = db
        .prepare(
          "SELECT p.*, u.username as authorName, u.avatar as authorAvatar FROM posts p LEFT JOIN users u ON p.userId = u.id ORDER BY createdAt DESC",
        )
        .all();

      const posts = rows.map((row) => mapPostRow(row, getUserById, userPublic));
      res.setHeader("Cache-Control", "no-store");
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

      const post = mapPostRow(row, getUserById, userPublic);
      res.setHeader("Cache-Control", "no-store");
      res.json(post);
    } catch {
      res.status(500).json({ error: "failed to fetch post" });
    }
  });

  app.post("/posts/:id/comments", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });

      const postId = req.params.id;
      const text = (req.body.text || "").toString().trim().slice(0, 2000);
      const parentId = req.body.parentId ? String(req.body.parentId) : null;

      if (!text) return res.status(400).json({ error: "text required" });

      const row = db.prepare("SELECT comments FROM posts WHERE id = ?").get(postId);
      if (!row) return res.status(404).json({ error: "post not found" });

      const comments = parseCommentsForMutation(row.comments);
      const comment = {
        id: Date.now().toString(),
        userId: user.id,
        text,
        parentId,
        createdAt: new Date().toISOString(),
      };

      comments.push(comment);
      db.prepare("UPDATE posts SET comments = ? WHERE id = ?").run(
        JSON.stringify(comments),
        postId,
      );

      res
        .status(201)
        .json({ ...comment, user: userPublic(user), children: [] });
    } catch {
      res.status(500).json({ error: "failed to add comment" });
    }
  });

  app.post("/posts/:id/like", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: "unauthenticated" });

      const postId = req.params.id;
      const action = req.body && req.body.action ? req.body.action : "like";
      const row = db.prepare("SELECT likes FROM posts WHERE id = ?").get(postId);
      if (!row) return res.status(404).json({ error: "post not found" });

      let likes = parseLikesForMutation(row.likes);

      if (action === "like") {
        if (!likes.includes(user.id)) likes.push(user.id);
      } else if (action === "unlike") {
        likes = likes.filter((id) => id !== user.id);
      } else {
        return res.status(400).json({ error: "invalid action" });
      }

      db.prepare("UPDATE posts SET likes = ? WHERE id = ?").run(
        JSON.stringify(likes),
        postId,
      );

      res.json({ likes, liked: likes.includes(user.id) });
    } catch {
      res.status(500).json({ error: "failed to update likes" });
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
      const description = buildPostDescription(post);
      const excerpt = buildPostExcerpt(post);
      const tags = parseStoredTags(post.tags);
      const publishedTime = post.createdAt || new Date().toISOString();
      const modifiedTime = post.updatedAt || post.createdAt || publishedTime;
      const authorName = post.userId
        ? post.authorName || post.author || "Unknown"
        : post.author || "Unknown";

      const host = req.get("host");
      const protocol =
        req.headers["x-forwarded-proto"] || req.protocol || "http";
      const imageUrl = buildImageUrl(post.thumbnail || null, protocol, host);
      const authorUrl = post.userId
        ? buildProfileUrl(authorName, protocol, host)
        : "";
      const redirectToSpa = !isLikelyCrawler(req.get("user-agent"));

      const spaPath = buildBlogPath(title, id);
      const redirectUrl = `${protocol}://${host}${spaPath}?_spa=1`;

      const html = buildBlogRedirectPage({
        title,
        description,
        excerpt,
        imageUrl,
        authorName,
        authorUrl,
        publishedTime,
        modifiedTime,
        tags,
        protocol,
        host,
        spaPath,
        redirectUrl,
        redirectToSpa,
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
      const updatedAt = createdAt;

      db.prepare(
        "INSERT INTO posts (id, title, content, userId, author, shortDescription, thumbnail, tags, likes, comments, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        title,
        JSON.stringify(contentObj),
        userId || null,
        req.body.author || null,
        shortDescription,
        thumbnail,
        JSON.stringify(tags),
        JSON.stringify([]),
        JSON.stringify([]),
        createdAt,
        updatedAt,
      );

      const user = userId ? getUserById(userId) : null;
      const response = {
        id,
        title,
        content: contentObj,
        shortDescription,
        thumbnail,
        tags,
        likes: [],
        comments: [],
        userId: userId || null,
        author: userId
          ? user
            ? user.username
            : req.body.author || "Unknown"
          : req.body.author || "Unknown",
        authorAvatar: userId ? (user ? user.avatar : null) : null,
        createdAt,
        updatedAt,
      };

      refreshSearchDiscovery(db, buildIndexNowUrlsForPost(title, id));
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
      const updatedAt = new Date().toISOString();

      db.prepare(
        "UPDATE posts SET title = ?, content = ?, shortDescription = ?, thumbnail = ?, tags = ?, updatedAt = ? WHERE id = ?",
      ).run(
        title,
        JSON.stringify(contentObj),
        shortDescription,
        thumbnail,
        JSON.stringify(tags),
        updatedAt,
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
        likes: parseLikesForList(existing.likes),
        comments: parseCommentsForList(
          existing.comments,
          getUserById,
          userPublic,
        ),
        userId: existing.userId || null,
        author: resolvePostAuthor(existing.userId, authorUser, existing.author),
        authorAvatar: resolveAuthorAvatar(existing.userId, authorUser),
        createdAt: existing.createdAt,
        updatedAt,
      };

      refreshSearchDiscovery(db, buildIndexNowUrlsForPost(title, id));
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
      refreshSearchDiscovery(db, buildIndexNowUrlsForPost(existing.title, id));
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "failed to delete post" });
    }
  });
};
