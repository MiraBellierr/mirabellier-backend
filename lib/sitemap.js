const fs = require('fs');
const path = require('path');

/**
 * Generates sitemap.xml with all content
 * Call this after creating/updating blog posts, videos, or pics
 * 
 * Automatically detects environment and uses correct output path:
 * - Production: /var/www/mirabellier/dist/sitemap.xml
 * - Development: ./public/sitemap.xml
 */
function collectSitemapEntries(db) {
  const WEBSITE_BASE = process.env.WEBSITE_BASE || 'https://mirabellier.com';

  // Static routes
  const staticRoutes = [
    { path: '/', priority: '1.0', changefreq: 'weekly' },
    { path: '/home', priority: '0.8', changefreq: 'weekly' },
    { path: '/about', priority: '0.8', changefreq: 'monthly' },
    { path: '/blog', priority: '0.9', changefreq: 'daily' },
    { path: '/videos', priority: '0.8', changefreq: 'weekly' },
    { path: '/pics', priority: '0.8', changefreq: 'weekly' },
  ];

  const entries = [];

  // Add static routes
  for (const route of staticRoutes) {
    entries.push({
      url: `${WEBSITE_BASE}${route.path}`,
      lastmod: new Date().toISOString().split('T')[0],
      priority: route.priority,
      changefreq: route.changefreq,
    });
  }

  // Fetch and add blog posts
  try {
    const posts = db.prepare('SELECT id, title, createdAt FROM posts ORDER BY createdAt DESC').all();
    if (posts && Array.isArray(posts)) {
      posts.forEach((post) => {
        // Generate slug from title
        const slug = post.title
          ? post.title
              .toLowerCase()
              .trim()
              .replace(/[^\w\s-]/g, '')
              .replace(/\s+/g, '-')
              .replace(/-+/g, '-')
          : '';

        const postUrl = `${WEBSITE_BASE}/blog/${slug ? (slug + '-' + post.id) : post.id}`;
        const lastmod = post.createdAt
          ? new Date(post.createdAt).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];

        entries.push({
          url: postUrl,
          lastmod,
          priority: '0.7',
          changefreq: 'monthly',
        });
      });
    }
  } catch (err) {
    console.warn('Could not fetch blog posts for sitemap:', err.message);
  }

  // Fetch and add videos
  // No per-video URLs needed; rely on static /videos route

  // Fetch and add pics
  // No per-picture URLs needed; rely on static /pics route

  return entries;
}

function generateSitemap(db, publicDir = null) {
  try {
    if (!publicDir) {
      // Auto-detect production vs development environment
      const isProduction = process.env.NODE_ENV === 'production' || 
                          fs.existsSync('/var/www/mirabellier/dist');
      
      if (isProduction) {
        // Production: write to dist folder
        publicDir = '/var/www/mirabellier/dist';
      } else {
        // Development: write to public folder
        publicDir = path.join(__dirname, '..', '..', 'public');
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
  </url>`
      )
      .join('');

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls}
</urlset>`;

    // Write to file
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    const outputPath = path.join(publicDir, 'sitemap.xml');
    fs.writeFileSync(outputPath, sitemap, 'utf-8');

    console.log(`✅ Sitemap generated: ${outputPath} (${entries.length} entries)`);
    return true;
  } catch (err) {
    console.error('❌ Error generating sitemap:', err);
    return false;
  }
}

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  };
  return str.replace(/[&<>"']/g, (char) => map[char] || char);
}

module.exports = { generateSitemap, collectSitemapEntries };
