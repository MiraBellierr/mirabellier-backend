const {
  getShrinePageByPath,
  getShrinePageBySlug,
} = require("../lib/shrines");

function setNoStoreHeaders(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function isLikelyCrawler(userAgent) {
  const value = String(userAgent || "").toLowerCase();
  return /bot|crawler|spider|google-inspectiontool|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandex|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot/.test(
    value,
  );
}

function resolveAssetUrl(asset, protocol, host) {
  if (!asset) return `${protocol}://${host}/background.jpg`;
  if (/^https?:\/\//i.test(asset)) return asset;
  if (asset.startsWith("/")) return `${protocol}://${host}${asset}`;
  return `${protocol}://${host}/${asset}`;
}

function resolveProtocol(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];

  if (typeof forwardedProto === "string" && forwardedProto.trim()) {
    return forwardedProto.split(",")[0].trim();
  }

  return req.protocol || "http";
}

function buildShrineSeoPage({
  title,
  description,
  excerpt,
  imageUrl,
  imageAlt,
  schemaType,
  about,
  keywords,
  protocol,
  host,
  spaPath,
  redirectUrl,
  redirectToSpa,
  ctaLabel,
}) {
  const canonicalUrl = `${protocol}://${host}${spaPath}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": schemaType || "WebPage",
    name: title,
    description,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
    isPartOf: {
      "@type": "WebSite",
      name: "Mirabellier",
      url: "https://mirabellier.com/",
    },
    ...(imageUrl ? { image: [imageUrl] } : {}),
    ...(about && about.length
      ? {
          about: about.map((entry) => ({
            "@type": "Thing",
            name: entry,
          })),
        }
      : {}),
    ...(keywords && keywords.length ? { keywords: keywords.join(", ") } : {}),
  };

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    ${keywords && keywords.length ? `<meta name="keywords" content="${escapeHtml(keywords.join(", "))}" />` : ""}
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:site_name" content="Mirabellier" />
    <meta property="og:url" content="${canonicalUrl}" />
    ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}" />` : ""}
    ${imageAlt ? `<meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />` : ""}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />` : ""}
    ${imageAlt ? `<meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}" />` : ""}
    <link rel="canonical" href="${canonicalUrl}" />
    <script type="application/ld+json">${escapeJsonForHtml(jsonLd)}</script>
    ${redirectToSpa ? `<script>window.location.replace('${redirectUrl}')</script>` : ""}
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
      ${excerpt ? `<p>${escapeHtml(excerpt)}</p>` : ""}
      <p><a href="${escapeHtml(canonicalUrl)}">${escapeHtml(ctaLabel || "Open shrine page")}</a></p>
    </main>
  </body>
</html>`;
}

function renderShrinePage(req, res, shrinePage) {
  if (!shrinePage) {
    return res.status(404).send("Not found");
  }

  try {
    const host = req.get("host") || "mirabellier.com";
    const protocol = resolveProtocol(req);
    const redirectToSpa = !isLikelyCrawler(req.get("user-agent"));
    const imageUrl = resolveAssetUrl(shrinePage.image, protocol, host);
    const redirectUrl = `${protocol}://${host}${shrinePage.path}?_spa=1`;

    const html = buildShrineSeoPage({
      title: shrinePage.title,
      description: shrinePage.description,
      excerpt: shrinePage.excerpt,
      imageUrl,
      imageAlt: shrinePage.imageAlt,
      schemaType: shrinePage.schemaType,
      about: shrinePage.about,
      keywords: shrinePage.keywords,
      protocol,
      host,
      spaPath: shrinePage.path,
      redirectUrl,
      redirectToSpa,
      ctaLabel: shrinePage.ctaLabel,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    setNoStoreHeaders(res);
    return res.send(html);
  } catch {
    return res.status(500).send("Server error");
  }
}

module.exports = function registerShrineRoutes(app) {
  app.get("/shrine", (req, res) => {
    renderShrinePage(req, res, getShrinePageByPath("/shrine"));
  });

  app.get("/shrine/:slug", (req, res) => {
    renderShrinePage(req, res, getShrinePageBySlug(req.params.slug));
  });
};
