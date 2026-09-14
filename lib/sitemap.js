const fs = require("fs");
const path = require("path");
const { getShrineSitemapRoutes } = require("./shrines");
const { resolveDiscoveryOutputDir } = require("./discovery-output");
const { buildPostUrl } = require("./post-url");

/**
 * Normalise a thumbnail value into an absolute URL for the image sitemap.
 * Values arrive as an absolute URL, a `/images/...` path, or a bare filename.
 */
function resolveImageUrl(thumbnail, websiteBase) {
  const value = String(thumbnail || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${websiteBase}${value}`;
  return `${websiteBase}/images/${value}`;
}

/**
 * Generates sitemap.xml with all content
 * Call this after creating or updating blog posts
 *
 * Output path resolution lives in `lib/discovery-output.js`: production now
 * serves the frontend release tree (`FRONTEND_DEPLOY_PATH`, i.e.
 * `/var/www/mirabellier.com/current`) instead of the retired
 * `/var/www/mirabellier/dist`, and development writes to the frontend
 * `public/` directory.
 */
function collectSitemapEntries(db) {
  const WEBSITE_BASE = (
    process.env.WEBSITE_BASE || "https://mirabellier.com"
  ).replace(/\/+$/, "");

  // Static routes. `/home` is deliberately absent: it is a client-side alias of
  // `/` (see HOME_ALIAS_PATHS in src/App.tsx) whose canonical is `/`, so
  // listing it only advertises a duplicate.
  const staticRoutes = [
    { path: "/", priority: "1.0", changefreq: "weekly" },
    { path: "/about", priority: "0.8", changefreq: "monthly" },
    { path: "/now", priority: "0.6", changefreq: "weekly" },
    { path: "/changelog", priority: "0.5", changefreq: "weekly" },
    { path: "/uses", priority: "0.5", changefreq: "monthly" },
    { path: "/links", priority: "0.5", changefreq: "monthly" },
    { path: "/stats", priority: "0.5", changefreq: "daily" },
    { path: "/projects", priority: "0.8", changefreq: "monthly" },
    { path: "/anime", priority: "0.8", changefreq: "daily" },
    { path: "/fanart", priority: "0.7", changefreq: "weekly" },
    { path: "/twitch", priority: "0.7", changefreq: "hourly" },
    { path: "/pixies", priority: "0.8", changefreq: "daily" },
    { path: "/question-of-the-day", priority: "0.8", changefreq: "daily" },
    {
      path: "/question-of-the-day/archive",
      priority: "0.7",
      changefreq: "daily",
    },
    { path: "/quotes", priority: "0.8", changefreq: "daily" },
    { path: "/blog", priority: "0.9", changefreq: "daily" },
    { path: "/privacy", priority: "0.4", changefreq: "yearly" },
    { path: "/terms", priority: "0.4", changefreq: "yearly" },
    { path: "/arena/skill-tree", priority: "0.5", changefreq: "monthly" },
  ];

  const entries = [];

  // Add static routes
  for (const route of staticRoutes) {
    entries.push({
      url: `${WEBSITE_BASE}${route.path}`,
      lastmod: new Date().toISOString().split("T")[0],
      priority: route.priority,
      changefreq: route.changefreq,
    });
  }

  // Shrine pages come from two sources and both are real:
  //   - `shrine_pages` in the database (owner-created rooms: kana, rimuru, ...)
  //   - the built-in rooms hardcoded in lib/shrines.js (kanna, rossina), which
  //     have dedicated components in the SPA (`src/pages/Kanna.tsx`, ...)
  // Merge them, preferring the database row when a path exists in both so an
  // owner edit wins over the built-in defaults.
  try {
    const shrineRows = db
      .prepare(
        "SELECT path, title, image, priority, changefreq, updatedAt, createdAt FROM shrine_pages ORDER BY path",
      )
      .all();

    const byPath = new Map();
    const today = new Date().toISOString().split("T")[0];

    for (const route of getShrineSitemapRoutes()) {
      byPath.set(route.path, {
        url: `${WEBSITE_BASE}${route.path}`,
        lastmod: today,
        priority: route.priority || "0.7",
        changefreq: route.changefreq || "monthly",
      });
    }

    for (const shrine of shrineRows || []) {
      const lastModifiedSource = shrine.updatedAt || shrine.createdAt;
      const imageUrl = resolveImageUrl(shrine.image, WEBSITE_BASE);

      byPath.set(shrine.path, {
        url: `${WEBSITE_BASE}${shrine.path}`,
        lastmod: lastModifiedSource
          ? new Date(lastModifiedSource).toISOString().split("T")[0]
          : today,
        priority: shrine.priority || "0.7",
        changefreq: shrine.changefreq || "monthly",
        ...(imageUrl
          ? { images: [{ url: imageUrl, title: shrine.title || "Shrine" }] }
          : {}),
      });
    }

    entries.push(...byPath.values());
  } catch {
    // Table missing/renamed: keep the hardcoded built-in shrines.
    for (const route of getShrineSitemapRoutes()) {
      entries.push({
        url: `${WEBSITE_BASE}${route.path}`,
        lastmod: new Date().toISOString().split("T")[0],
        priority: route.priority || "0.7",
        changefreq: route.changefreq || "monthly",
      });
    }
  }

  // Fetch and add blog posts
  try {
    const posts = db
      .prepare(
        "SELECT id, title, thumbnail, createdAt, updatedAt FROM posts ORDER BY COALESCE(updatedAt, createdAt) DESC",
      )
      .all();

    if (posts && Array.isArray(posts)) {
      posts.forEach((post) => {
        const postUrl = buildPostUrl(WEBSITE_BASE, post);
        const lastModifiedSource = post.updatedAt || post.createdAt;
        const lastmod = lastModifiedSource
          ? new Date(lastModifiedSource).toISOString().split("T")[0]
          : new Date().toISOString().split("T")[0];
        const imageUrl = resolveImageUrl(post.thumbnail, WEBSITE_BASE);

        entries.push({
          url: postUrl,
          lastmod,
          priority: "0.7",
          changefreq: "monthly",
          ...(imageUrl
            ? { images: [{ url: imageUrl, title: post.title || "Untitled" }] }
            : {}),
        });
      });
    }
  } catch {
    // Ignore post lookup failures and keep static sitemap entries.
  }

  try {
    const currentRecordedDate = new Date().toISOString().slice(0, 10);
    // Mirror the archive route exactly (`getArchiveCutoffRecordedDate` in
    // routes/question-of-the-day.js). A day is public once it is *before* the
    // active carried question — the active day itself still lives on
    // /question-of-the-day, and days queued after it are not published yet.
    // Listing `recordedDate < today` instead published URLs whose route 404s
    // (the live sitemap carried 94 such soft-404s) and leaked scheduled
    // prompts scheduled between the active day and today.
    const activeRecordedDate = db
      .prepare(
        `SELECT recordedDate
         FROM daily_questions
         WHERE recordedDate <= ? AND archivedAt IS NULL
         ORDER BY recordedDate ASC
         LIMIT 1`,
      )
      .get(currentRecordedDate)?.recordedDate;
    const archiveCutoffRecordedDate =
      activeRecordedDate || currentRecordedDate;

    const archivedQuestions = db
      .prepare(
        `SELECT recordedDate, createdAt, updatedAt
         FROM daily_questions
         WHERE recordedDate < ?
         ORDER BY recordedDate DESC`,
      )
      .all(archiveCutoffRecordedDate);

    if (archivedQuestions && Array.isArray(archivedQuestions)) {
      archivedQuestions.forEach((question) => {
        const lastModifiedSource = question.updatedAt || question.createdAt;
        const lastmod = lastModifiedSource
          ? new Date(lastModifiedSource).toISOString().split("T")[0]
          : new Date().toISOString().split("T")[0];

        entries.push({
          url: `${WEBSITE_BASE}/question-of-the-day/archive/${question.recordedDate}`,
          lastmod,
          priority: "0.6",
          changefreq: "monthly",
        });
      });
    }
  } catch {
    // Ignore archive lookup failures and keep other sitemap entries.
  }

  return entries;
}

function generateSitemap(db, publicDir = null) {
  try {
    const outputDir = resolveDiscoveryOutputDir(publicDir);
    const entries = collectSitemapEntries(db);

    // Generate XML
    const urls = entries
      .map(
        (entry) => `
  <url>
    <loc>${escapeXml(entry.url)}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>${renderImages(entry.images)}
  </url>`,
      )
      .join("");

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls}
</urlset>`;

    // Write to file
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(path.join(outputDir, "sitemap.xml"), sitemap, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Render Google's image-sitemap extension entries for a URL. Kept separate so
 * both the post and shrine branches produce identical markup.
 */
function renderImages(images) {
  if (!Array.isArray(images) || images.length === 0) return "";

  return images
    .filter((image) => image && image.url)
    .map(
      (image) => `
    <image:image>
      <image:loc>${escapeXml(image.url)}</image:loc>${
        image.title
          ? `
      <image:title>${escapeXml(image.title)}</image:title>`
          : ""
      }
    </image:image>`,
    )
    .join("");
}

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  };
  return str.replace(/[&<>"']/g, (char) => map[char] || char);
}

module.exports = { generateSitemap, collectSitemapEntries };
