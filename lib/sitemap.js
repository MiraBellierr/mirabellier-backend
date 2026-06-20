const fs = require("fs");
const path = require("path");
const { getShrineSitemapRoutes } = require("./shrines");

/**
 * Generates sitemap.xml with all content
 * Call this after creating or updating blog posts
 *
 * Automatically detects environment and uses correct output path:
 * - Production: /var/www/mirabellier/dist/sitemap.xml
 * - Development: ./public/sitemap.xml
 */
function collectSitemapEntries(db) {
  const WEBSITE_BASE = (
    process.env.WEBSITE_BASE || "https://mirabellier.com"
  ).replace(/\/+$/, "");

  // Static routes
  const staticRoutes = [
    { path: "/", priority: "1.0", changefreq: "weekly" },
    { path: "/home", priority: "0.8", changefreq: "weekly" },
    { path: "/about", priority: "0.8", changefreq: "monthly" },
    { path: "/projects", priority: "0.8", changefreq: "monthly" },
    { path: "/anime", priority: "0.8", changefreq: "daily" },
    ...getShrineSitemapRoutes(),
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

  // Fetch and add blog posts
  try {
    const posts = db
      .prepare(
        "SELECT id, title, createdAt, updatedAt FROM posts ORDER BY COALESCE(updatedAt, createdAt) DESC",
      )
      .all();

    if (posts && Array.isArray(posts)) {
      posts.forEach((post) => {
        // Generate slug from title
        const slug = post.title
          ? post.title
              .toLowerCase()
              .trim()
              .replace(/[^\w\s-]/g, "")
              .replace(/\s+/g, "-")
              .replace(/-+/g, "-")
          : "";

        const postUrl = `${WEBSITE_BASE}/blog/${slug ? `${slug}-${post.id}` : post.id}`;
        const lastModifiedSource = post.updatedAt || post.createdAt;
        const lastmod = lastModifiedSource
          ? new Date(lastModifiedSource).toISOString().split("T")[0]
          : new Date().toISOString().split("T")[0];

        entries.push({
          url: postUrl,
          lastmod,
          priority: "0.7",
          changefreq: "monthly",
        });
      });
    }
  } catch {
    // Ignore post lookup failures and keep static sitemap entries.
  }

  try {
    const currentRecordedDate = new Date().toISOString().slice(0, 10);
    const archivedQuestions = db
      .prepare(
        `SELECT recordedDate, createdAt, updatedAt
         FROM daily_questions
         WHERE recordedDate < ?
         ORDER BY recordedDate DESC`,
      )
      .all(currentRecordedDate);

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
    if (!publicDir) {
      // Auto-detect production vs development environment
      const isProduction =
        process.env.NODE_ENV === "production" ||
        fs.existsSync("/var/www/mirabellier/dist");

      if (isProduction) {
        // Production: write to dist folder
        publicDir = "/var/www/mirabellier/dist";
      } else {
        // Development: write to public folder
        publicDir = path.join(__dirname, "..", "..", "public");
      }
    }
    const entries = collectSitemapEntries(db);

    // Generate XML
    const urls = entries
      .map(
        (entry) => `
  <url>
    <loc>${escapeXml(entry.url)}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
      )
      .join("");

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls}
</urlset>`;

    // Write to file
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    fs.writeFileSync(path.join(publicDir, "sitemap.xml"), sitemap, "utf-8");
    return true;
  } catch {
    return false;
  }
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
