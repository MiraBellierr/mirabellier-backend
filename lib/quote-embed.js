const sharp = require("sharp");

const {
  buildEmbeddedFontsCss,
  escapeHtml,
  escapeJsonForHtml,
  escapeSvg,
  wrapText,
} = require("./share-preview-utils");

const PREVIEW_WIDTH = 1200;
const CARD_X = 72;
const CARD_Y = 54;
const CARD_WIDTH = PREVIEW_WIDTH - CARD_X * 2;
const CARD_PADDING_X = 40;
const HEADER_HEIGHT = 138;
const BANNER_HEIGHT = 82;
const SECTION_GAP = 18;
const FOOTER_HEIGHT = 58;
const EMPTY_HEIGHT = 560;
const FALLBACK_HEIGHT = 640;
const DEFAULT_DESCRIPTION =
  "Daily quotes across love, art, nature, humor, and more.";

function formatRecordedDate(recordedDate) {
  if (!recordedDate) {
    return "Daily snapshot";
  }

  const parsed = new Date(`${recordedDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return "Daily snapshot";
  }

  return parsed.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
  });
}

function formatUtcDateTime(value) {
  if (!value) {
    return "Unknown";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(parsed));
}

function normalizeQuoteEntry(entry) {
  return {
    key: String(entry?.key || ""),
    category: String(entry?.category || "Quote"),
    quote: String(entry?.quote || ""),
    author: String(entry?.author || "Unknown"),
  };
}

function buildQuotePreviewState(input) {
  const normalizedQuotes = Array.isArray(input?.quotes)
    ? input.quotes.map(normalizeQuoteEntry).filter((entry) => entry.quote)
    : [];
  let variant = "list";

  if (!normalizedQuotes.length) {
    variant = input?.message ? "fallback" : "empty";
  }

  return {
    variant,
    stale: Boolean(input?.stale),
    quotes: normalizedQuotes,
    fetchedAt: input?.fetchedAt || null,
    recordedDate: input?.recordedDate || null,
    displayDate: input?.displayDate || null,
    message: input?.message || "",
    title: "Mirabellier Quotes",
    description:
      variant === "fallback"
        ? "The daily quote preview is temporarily unavailable."
        : variant === "empty"
          ? "No daily quotes are available right now."
          : DEFAULT_DESCRIPTION,
    imageAlt: "A preview image of the daily quotes on Mirabellier.",
    version:
      input?.fetchedAt ||
      (input?.recordedDate ? `date-${input.recordedDate}` : "quotes-fallback"),
  };
}

function buildQuoteImagePath(version) {
  const encodedVersion = encodeURIComponent(String(version || "quotes-fallback"));
  return `/quotes/embed-image.png?v=${encodedVersion}`;
}

function buildQuoteLayouts(quotes) {
  return quotes.map((entry, index) => {
    const isFeatured = index === 0;
    const lines = wrapText(
      entry.quote,
      isFeatured ? 44 : 50,
      Number.POSITIVE_INFINITY,
    );
    const lineHeight = isFeatured ? 38 : 30;
    const height =
      (isFeatured ? 144 : 112) + Math.max(lines.length, 1) * lineHeight;

    return {
      ...entry,
      isFeatured,
      lines,
      lineHeight,
      height,
    };
  });
}

function computePreviewHeight(state) {
  if (state.variant === "fallback") {
    return FALLBACK_HEIGHT;
  }

  if (state.variant === "empty") {
    return EMPTY_HEIGHT + (state.stale ? BANNER_HEIGHT : 0);
  }

  const layouts = buildQuoteLayouts(state.quotes);
  const contentHeight =
    layouts.reduce((total, layout) => total + layout.height, 0) +
    Math.max(layouts.length - 1, 0) * SECTION_GAP;

  return (
    CARD_Y * 2 +
    HEADER_HEIGHT +
    (state.stale ? BANNER_HEIGHT : 0) +
    contentHeight +
    FOOTER_HEIGHT
  );
}

function getQuotePreviewDimensions(state) {
  return {
    width: PREVIEW_WIDTH,
    height: computePreviewHeight(state),
  };
}

function buildQuoteShareHtml({
  state,
  protocol,
  host,
  spaPath = "/quotes",
  redirectToSpa,
}) {
  const canonicalUrl = `${protocol}://${host}${spaPath}`;
  const redirectUrl = `${canonicalUrl}?_spa=1`;
  const imageUrl = `${protocol}://${host}${buildQuoteImagePath(state.version)}`;
  const dimensions = getQuotePreviewDimensions(state);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: state.title,
    description: state.description,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
    image: [imageUrl],
    isPartOf: {
      "@type": "WebSite",
      name: "Mirabellier",
      url: `${protocol}://${host}/`,
    },
  };

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(state.title)}</title>
    <meta name="description" content="${escapeHtml(state.description)}" />
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(state.title)}" />
    <meta property="og:description" content="${escapeHtml(state.description)}" />
    <meta property="og:site_name" content="Mirabellier" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:width" content="${dimensions.width}" />
    <meta property="og:image:height" content="${dimensions.height}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:alt" content="${escapeHtml(state.imageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(state.title)}" />
    <meta name="twitter:description" content="${escapeHtml(state.description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
    <meta name="twitter:image:alt" content="${escapeHtml(state.imageAlt)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <script type="application/ld+json">${escapeJsonForHtml(jsonLd)}</script>
    ${redirectToSpa ? `<script>window.location.replace('${escapeHtml(redirectUrl)}')</script>` : ""}
  </head>
  <body>
    <main>
      <h1>${escapeHtml(state.title)}</h1>
      <p>${escapeHtml(state.description)}</p>
      <p><a href="${escapeHtml(canonicalUrl)}">Open the quotes page</a></p>
    </main>
  </body>
</html>`;
}

function buildStaleBanner(state) {
  return `
    <g>
      <rect x="${CARD_X + CARD_PADDING_X}" y="${CARD_Y + HEADER_HEIGHT - 12}" width="${CARD_WIDTH - CARD_PADDING_X * 2}" height="64" rx="20" fill="#fffbeb" stroke="#f59e0b" stroke-width="2" />
      <text x="${CARD_X + CARD_PADDING_X + 24}" y="${CARD_Y + HEADER_HEIGHT + 24}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="20" font-weight="700" fill="#b45309">
        BrainyQuote did not refresh yet for the current UTC day.
      </text>
      <text x="${CARD_X + CARD_PADDING_X + 24}" y="${CARD_Y + HEADER_HEIGHT + 48}" font-family="QuicksandPreview, sans-serif" font-size="18" font-weight="600" fill="#92400e">
        Showing the last successful snapshot from ${escapeSvg(formatUtcDateTime(state.fetchedAt))}.
      </text>
    </g>
  `;
}

function renderListSvg(state, dimensions) {
  const layouts = buildQuoteLayouts(state.quotes);
  let currentY = CARD_Y + HEADER_HEIGHT;

  if (state.stale) {
    currentY += BANNER_HEIGHT;
  }

  const sectionsMarkup = layouts
    .map((layout, index) => {
      const quoteTextMarkup = layout.lines
        .map(
          (line, lineIndex) =>
            `<tspan x="${CARD_X + CARD_PADDING_X + 30}" dy="${lineIndex === 0 ? 0 : layout.lineHeight}">${escapeSvg(line)}</tspan>`,
        )
        .join("");
      const sectionY = currentY;
      currentY += layout.height + (index < layouts.length - 1 ? SECTION_GAP : 0);

      return `
        <g>
          <rect x="${CARD_X + CARD_PADDING_X}" y="${sectionY}" width="${CARD_WIDTH - CARD_PADDING_X * 2}" height="${layout.height}" rx="${layout.isFeatured ? 30 : 24}" fill="${layout.isFeatured ? "rgba(239,246,255,0.96)" : "rgba(255,255,255,0.92)"}" stroke="${layout.isFeatured ? "#93c5fd" : "#dbeafe"}" stroke-width="3" />
          <rect x="${CARD_X + CARD_PADDING_X + 22}" y="${sectionY + 20}" width="${layout.isFeatured ? 240 : 220}" height="36" rx="18" fill="${layout.isFeatured ? "#dbeafe" : "#eff6ff"}" />
          <text x="${CARD_X + CARD_PADDING_X + 42}" y="${sectionY + 44}" font-family="QuicksandPreview, sans-serif" font-size="${layout.isFeatured ? 20 : 18}" font-weight="700" fill="#1d4ed8">${escapeSvg(layout.category)}</text>
          <text x="${CARD_X + CARD_PADDING_X + 30}" y="${sectionY + (layout.isFeatured ? 100 : 88)}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="${layout.isFeatured ? 36 : 28}" font-weight="700" fill="#1e3a8a">
            ${quoteTextMarkup}
          </text>
          <text x="${CARD_X + CARD_PADDING_X + 30}" y="${sectionY + layout.height - 26}" font-family="QuicksandPreview, sans-serif" font-size="${layout.isFeatured ? 24 : 22}" font-weight="700" fill="#475569">- ${escapeSvg(layout.author)}</text>
        </g>
      `;
    })
    .join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 ${dimensions.width} ${dimensions.height}">
      <defs>
        <linearGradient id="quotePageGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#fdfcff" />
          <stop offset="54%" stop-color="#eff6ff" />
          <stop offset="100%" stop-color="#dbeafe" />
        </linearGradient>
        <linearGradient id="quoteCardGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.98)" />
          <stop offset="100%" stop-color="rgba(255,255,255,0.92)" />
        </linearGradient>
        <style>
          ${buildEmbeddedFontsCss()}
        </style>
      </defs>
      <rect width="100%" height="100%" fill="url(#quotePageGradient)" />
      <circle cx="154" cy="144" r="136" fill="rgba(251, 207, 232, 0.22)" />
      <circle cx="${dimensions.width - 132}" cy="${dimensions.height - 110}" r="172" fill="rgba(147,197,253,0.22)" />
      <circle cx="${dimensions.width - 240}" cy="128" r="94" fill="rgba(219,234,254,0.75)" />
      <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_WIDTH}" height="${dimensions.height - CARD_Y * 2}" rx="36" fill="url(#quoteCardGradient)" stroke="#60a5fa" stroke-width="7" />
      <text x="${CARD_X + CARD_PADDING_X}" y="${CARD_Y + 38}" font-family="QuicksandPreview, sans-serif" font-size="18" font-weight="700" fill="#60a5fa" letter-spacing="2">mirabellier.com / quotes</text>
      <text x="${CARD_X + CARD_PADDING_X}" y="${CARD_Y + 98}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="48" font-weight="700" fill="#1d4ed8">quote of the day</text>
      <text x="${CARD_X + CARD_PADDING_X}" y="${CARD_Y + 130}" font-family="QuicksandPreview, sans-serif" font-size="22" font-weight="700" fill="#475569">Daily quotes across love, art, nature, humor, and more.</text>
      <rect x="${CARD_X + CARD_WIDTH - 296}" y="${CARD_Y + 26}" width="236" height="44" rx="22" fill="#dbeafe" />
      <text x="${CARD_X + CARD_WIDTH - 178}" y="${CARD_Y + 54}" text-anchor="middle" font-family="QuicksandPreview, sans-serif" font-size="20" font-weight="700" fill="#1d4ed8">${escapeSvg(state.displayDate || formatRecordedDate(state.recordedDate))}</text>
      ${state.stale ? buildStaleBanner(state) : ""}
      ${sectionsMarkup}
      <text x="${CARD_X + CARD_PADDING_X}" y="${dimensions.height - CARD_Y - 22}" font-family="QuicksandPreview, sans-serif" font-size="19" font-weight="700" fill="#64748b">Snapshot source: BrainyQuote. Shared preview hosted on mirabellier.com.</text>
    </svg>
  `;
}

function renderEmptySvg(state, dimensions) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 ${dimensions.width} ${dimensions.height}">
      <defs>
        <linearGradient id="quoteEmptyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#fdfcff" />
          <stop offset="54%" stop-color="#eff6ff" />
          <stop offset="100%" stop-color="#dbeafe" />
        </linearGradient>
        <style>
          ${buildEmbeddedFontsCss()}
        </style>
      </defs>
      <rect width="100%" height="100%" fill="url(#quoteEmptyGradient)" />
      <circle cx="158" cy="150" r="138" fill="rgba(251, 207, 232, 0.22)" />
      <circle cx="1034" cy="108" r="122" fill="rgba(191,219,254,0.55)" />
      <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_WIDTH}" height="${dimensions.height - CARD_Y * 2}" rx="36" fill="rgba(255,255,255,0.95)" stroke="#60a5fa" stroke-width="7" />
      <text x="${CARD_X + CARD_PADDING_X}" y="${CARD_Y + 38}" font-family="QuicksandPreview, sans-serif" font-size="18" font-weight="700" fill="#60a5fa" letter-spacing="2">mirabellier.com / quotes</text>
      <text x="${CARD_X + CARD_PADDING_X}" y="${CARD_Y + 98}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="48" font-weight="700" fill="#1d4ed8">quote of the day</text>
      <rect x="${CARD_X + 126}" y="${CARD_Y + 188}" width="${CARD_WIDTH - 252}" height="186" rx="30" fill="rgba(239,246,255,0.92)" stroke="#bfdbfe" stroke-width="3" />
      <text x="${dimensions.width / 2}" y="${CARD_Y + 272}" text-anchor="middle" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="38" font-weight="700" fill="#1d4ed8">No daily quotes are available right now.</text>
      <text x="${dimensions.width / 2}" y="${CARD_Y + 318}" text-anchor="middle" font-family="QuicksandPreview, sans-serif" font-size="24" font-weight="700" fill="#475569">The next quote snapshot will appear here once it is ready.</text>
    </svg>
  `;
}

function renderFallbackSvg(state, dimensions) {
  const lines = wrapText(
    state.message || "The daily quote snapshot is temporarily unavailable.",
    38,
    3,
  );
  const messageMarkup = lines
    .map(
      (line, index) =>
        `<tspan x="${CARD_X + CARD_PADDING_X + 30}" dy="${index === 0 ? 0 : 38}">${escapeSvg(line)}</tspan>`,
    )
    .join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 ${dimensions.width} ${dimensions.height}">
      <defs>
        <linearGradient id="quoteFallbackGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#fdfcff" />
          <stop offset="54%" stop-color="#eff6ff" />
          <stop offset="100%" stop-color="#dbeafe" />
        </linearGradient>
        <style>
          ${buildEmbeddedFontsCss()}
        </style>
      </defs>
      <rect width="100%" height="100%" fill="url(#quoteFallbackGradient)" />
      <circle cx="154" cy="154" r="138" fill="rgba(251, 207, 232, 0.22)" />
      <circle cx="1028" cy="530" r="170" fill="rgba(147,197,253,0.22)" />
      <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_WIDTH}" height="${dimensions.height - CARD_Y * 2}" rx="36" fill="rgba(255,255,255,0.95)" stroke="#60a5fa" stroke-width="7" />
      <text x="${CARD_X + CARD_PADDING_X}" y="${CARD_Y + 38}" font-family="QuicksandPreview, sans-serif" font-size="18" font-weight="700" fill="#60a5fa" letter-spacing="2">mirabellier.com / quotes</text>
      <text x="${CARD_X + CARD_PADDING_X}" y="${CARD_Y + 98}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="48" font-weight="700" fill="#1d4ed8">quote of the day</text>
      <rect x="${CARD_X + CARD_PADDING_X}" y="${CARD_Y + 170}" width="640" height="236" rx="30" fill="rgba(239,246,255,0.92)" stroke="#bfdbfe" stroke-width="3" />
      <text x="${CARD_X + CARD_PADDING_X + 30}" y="${CARD_Y + 230}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="36" font-weight="700" fill="#1d4ed8">Quote preview status</text>
      <text x="${CARD_X + CARD_PADDING_X + 30}" y="${CARD_Y + 286}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="32" font-weight="700" fill="#1e3a8a">
        ${messageMarkup}
      </text>
      <text x="${CARD_X + CARD_PADDING_X + 30}" y="${CARD_Y + 376}" font-family="QuicksandPreview, sans-serif" font-size="24" font-weight="700" fill="#475569">The page will share cleanly again after the next successful quote snapshot.</text>
      <rect x="${CARD_X + CARD_WIDTH - 324}" y="${CARD_Y + 180}" width="244" height="206" rx="28" fill="#dbeafe" stroke="#93c5fd" stroke-width="3" />
      <text x="${CARD_X + CARD_WIDTH - 202}" y="${CARD_Y + 266}" text-anchor="middle" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="34" font-weight="700" fill="#1d4ed8">daily</text>
      <text x="${CARD_X + CARD_WIDTH - 202}" y="${CARD_Y + 312}" text-anchor="middle" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="34" font-weight="700" fill="#1d4ed8">quotes</text>
      <text x="${CARD_X + CARD_WIDTH - 202}" y="${CARD_Y + 350}" text-anchor="middle" font-family="QuicksandPreview, sans-serif" font-size="22" font-weight="700" fill="#475569">will appear here</text>
    </svg>
  `;
}

async function renderQuotePreviewBuffer(state) {
  const dimensions = getQuotePreviewDimensions(state);
  const svg =
    state.variant === "fallback"
      ? renderFallbackSvg(state, dimensions)
      : state.variant === "empty"
        ? renderEmptySvg(state, dimensions)
        : renderListSvg(state, dimensions);

  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = {
  buildQuoteImagePath,
  buildQuotePreviewState,
  buildQuoteShareHtml,
  getQuotePreviewDimensions,
  renderQuotePreviewBuffer,
};
