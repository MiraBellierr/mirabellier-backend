const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const sharp = require("sharp");

const {
  buildEmbeddedFontsCss,
  buildRepoImageDataUri,
  escapeHtml,
  escapeJsonForHtml,
  escapeSvg,
  limitLength,
  wrapText,
} = require("./share-preview-utils");

const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;
const CARD_X = 88;
const CARD_Y = 66;
const CARD_WIDTH = PREVIEW_WIDTH - CARD_X * 2;
const CARD_HEIGHT = PREVIEW_HEIGHT - CARD_Y * 2;
const CARD_PADDING_X = 46;
const AVATAR_SIZE = 96;
const RENDERER_VERSION = "qotd-answer-render-v2";

let cachedFlowerPromise = null;

function loadFlowerAsset() {
  if (!cachedFlowerPromise) {
    cachedFlowerPromise = buildRepoImageDataUri("public/flower.png", {
      width: 72,
      fit: "inside",
      withoutEnlargement: true,
    }).catch(() => null);
  }

  return cachedFlowerPromise;
}

function getInitials(displayName) {
  const cleaned = String(displayName || "").trim();
  if (!cleaned) {
    return "??";
  }

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

async function readAvatarBuffer(avatar, imagesDir) {
  const value = String(avatar || "").trim();
  if (!value) {
    return null;
  }

  try {
    if (/^https?:\/\//i.test(value)) {
      const response = await axios.get(value, {
        responseType: "arraybuffer",
        timeout: 8000,
        headers: {
          Accept: "image/avif,image/webp,image/png,image/*,*/*;q=0.8",
          "User-Agent": "Mirabellier/1.0 (+https://mirabellier.com)",
        },
      });
      return Buffer.from(response.data);
    }

    if (imagesDir) {
      const relative = value.startsWith("/images/")
        ? value.slice("/images/".length)
        : value.replace(/^\/+/, "");
      const filePath = path.join(imagesDir, decodeURIComponent(relative));
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath);
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function buildAvatarDataUri(avatar, imagesDir) {
  const inputBuffer = await readAvatarBuffer(avatar, imagesDir);
  if (!inputBuffer) {
    return null;
  }

  try {
    const output = await sharp(inputBuffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    return `data:image/png;base64,${output.toString("base64")}`;
  } catch {
    return null;
  }
}

function buildVersion(answer) {
  const input = [
    RENDERER_VERSION,
    answer?.id || "",
    answer?.answer || "",
    answer?.displayName || "",
    answer?.avatar || "",
  ].join("|");

  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function buildAnswerPreviewState({ answer } = {}) {
  const normalized =
    answer && typeof answer.answer === "string" && answer.answer.trim()
      ? {
          id: String(answer.id || ""),
          answer: String(answer.answer || "").replace(/\s+/g, " ").trim(),
          displayName:
            String(answer.displayName || "Anonymous").trim() || "Anonymous",
          avatar: answer.avatar ? String(answer.avatar) : "",
        }
      : null;

  return {
    variant: normalized ? "answer" : "missing",
    id: normalized?.id || "",
    answer: normalized?.answer || "",
    displayName: normalized?.displayName || "",
    avatar: normalized?.avatar || "",
    title: normalized
      ? `${normalized.displayName} · Question of the Day`
      : "Question of the Day",
    imageAlt: normalized
      ? `${normalized.displayName}'s answer to the Mirabellier question of the day.`
      : "A preview image of Mirabellier's question of the day.",
    version: buildVersion(normalized),
  };
}

function getAnswerPreviewDimensions() {
  return { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT };
}

function buildAnswerImagePath(id, version) {
  const encodedId = encodeURIComponent(String(id || ""));
  const encodedVersion = encodeURIComponent(String(version || "fallback"));
  return `/question-of-the-day/answers/${encodedId}/embed-image.png?v=${encodedVersion}`;
}

function buildAnswerPageUrl(protocol, host, id) {
  const encodedId = encodeURIComponent(String(id || ""));
  return `${protocol}://${host}/question-of-the-day/answers/${encodedId}`;
}

// Intentionally emits no description meta (name/og/twitter) and no body copy:
// the shared card is meant to unfurl in Discord as the image alone.
function buildAnswerShareHtml({ state, protocol, host }) {
  const canonicalUrl = buildAnswerPageUrl(protocol, host, state.id);
  const imageUrl = `${protocol}://${host}${buildAnswerImagePath(
    state.id,
    state.version,
  )}`;
  const dimensions = getAnswerPreviewDimensions();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: state.title,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
    image: [imageUrl],
    ...(state.answer ? { text: state.answer } : {}),
    ...(state.displayName
      ? { creator: { "@type": "Person", name: state.displayName } }
      : {}),
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
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <meta name="theme-color" content="#f472b6" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(state.title)}" />
    <meta property="og:site_name" content="Mirabellier" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:width" content="${dimensions.width}" />
    <meta property="og:image:height" content="${dimensions.height}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:alt" content="${escapeHtml(state.imageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(state.title)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
    <meta name="twitter:image:alt" content="${escapeHtml(state.imageAlt)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <script type="application/ld+json">${escapeJsonForHtml(jsonLd)}</script>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(state.title)}</h1>
      <p><a href="${escapeHtml(canonicalUrl)}">Open the question of the day</a></p>
    </main>
  </body>
</html>`;
}

function buildAnswerLayout(answerText, availableHeight, availableWidth) {
  const candidates = [
    { fontSize: 52, lineHeight: 64, charWidth: 0.6 },
    { fontSize: 46, lineHeight: 58, charWidth: 0.6 },
    { fontSize: 40, lineHeight: 51, charWidth: 0.6 },
    { fontSize: 35, lineHeight: 45, charWidth: 0.6 },
    { fontSize: 31, lineHeight: 40, charWidth: 0.6 },
    { fontSize: 27, lineHeight: 35, charWidth: 0.6 },
    { fontSize: 23, lineHeight: 30, charWidth: 0.6 },
    { fontSize: 20, lineHeight: 26, charWidth: 0.6 },
  ];

  for (const candidate of candidates) {
    const maxChars = Math.max(
      12,
      Math.floor(availableWidth / (candidate.fontSize * candidate.charWidth)),
    );
    const lines = wrapText(answerText, maxChars, Number.POSITIVE_INFINITY);
    const textHeight =
      candidate.fontSize + Math.max(lines.length - 1, 0) * candidate.lineHeight;

    if (textHeight <= availableHeight) {
      return { ...candidate, lines };
    }
  }

  const fallback = candidates[candidates.length - 1];
  const maxChars = Math.max(
    12,
    Math.floor(availableWidth / (fallback.fontSize * fallback.charWidth)),
  );
  const maxLines = Math.max(
    1,
    Math.floor((availableHeight - fallback.fontSize) / fallback.lineHeight) + 1,
  );

  return {
    ...fallback,
    lines: wrapText(answerText, maxChars, maxLines),
  };
}

function buildBackground() {
  return `
    <defs>
      <linearGradient id="pageBg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#f8fbff" />
        <stop offset="100%" stop-color="#e8f3ff" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#pageBg)" />
    <circle cx="154" cy="122" r="106" fill="rgba(252, 207, 232, 0.22)" />
    <circle cx="1058" cy="92" r="112" fill="rgba(147, 197, 253, 0.26)" />
    <circle cx="1084" cy="548" r="172" fill="rgba(147, 197, 253, 0.18)" />
  `;
}

function renderAnswerSvg(state, { flowerDataUri, avatarDataUri }) {
  const innerX = CARD_X + CARD_PADDING_X;
  const innerWidth = CARD_WIDTH - CARD_PADDING_X * 2;

  const identityTop = CARD_Y + 52;
  const avatarR = 42;
  const avatarCx = innerX + avatarR;
  const avatarCy = identityTop + avatarR;
  const nameX = avatarCx + avatarR + 24;
  const initials = getInitials(state.displayName);

  const answerTop = avatarCy + avatarR + 44;
  const answerBottom = CARD_Y + CARD_HEIGHT - 46;
  const availableHeight = Math.max(120, answerBottom - answerTop);

  const answerLayout = buildAnswerLayout(
    state.answer,
    availableHeight,
    innerWidth,
  );
  const answerMarkup = answerLayout.lines
    .map(
      (line, index) =>
        `<tspan x="${innerX}" dy="${index === 0 ? 0 : answerLayout.lineHeight}">${escapeSvg(line)}</tspan>`,
    )
    .join("");
  const answerBaseline = answerTop + answerLayout.fontSize;

  const avatarMarkup = avatarDataUri
    ? `<clipPath id="qotdAvatarClip"><circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}" /></clipPath>
       <image href="${avatarDataUri}" x="${avatarCx - avatarR}" y="${avatarCy - avatarR}" width="${avatarR * 2}" height="${avatarR * 2}" clip-path="url(#qotdAvatarClip)" preserveAspectRatio="xMidYMid slice" />
       <circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}" fill="none" stroke="#93c5fd" stroke-width="3" />`
    : `<circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}" fill="#dbeafe" stroke="#93c5fd" stroke-width="3" />
       <text x="${avatarCx}" y="${avatarCy + 10}" text-anchor="middle" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="28" font-weight="700" fill="#2563eb">${escapeSvg(initials)}</text>`;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}">
      <defs>
        <style>
          ${buildEmbeddedFontsCss()}
        </style>
        <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="24" flood-color="#93c5fd" flood-opacity="0.35" />
        </filter>
      </defs>
      ${buildBackground()}
      <g filter="url(#cardShadow)">
        <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="28" fill="rgba(255,255,255,0.82)" />
      </g>
      <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="28" fill="none" stroke="#93c5fd" stroke-width="2.5" />
      ${
        flowerDataUri
          ? `<image href="${flowerDataUri}" x="${CARD_X + CARD_WIDTH - 74}" y="${CARD_Y - 26}" width="64" height="64" preserveAspectRatio="xMidYMid meet" />`
          : ""
      }
      ${avatarMarkup}
      <text x="${nameX}" y="${avatarCy + 12}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="36" font-weight="700" fill="#1d4ed8">${escapeSvg(limitLength(state.displayName, 32))}</text>
      <text x="${innerX}" y="${answerBaseline}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="${answerLayout.fontSize}" font-weight="700" fill="#1e3a8a">${answerMarkup}</text>
    </svg>
  `;
}

function renderMissingSvg() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}">
      <defs>
        <style>
          ${buildEmbeddedFontsCss()}
        </style>
      </defs>
      ${buildBackground()}
      <text x="${PREVIEW_WIDTH / 2}" y="${PREVIEW_HEIGHT / 2}" text-anchor="middle" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="42" font-weight="700" fill="#1e3a8a">This answer is no longer available.</text>
    </svg>
  `;
}

async function renderAnswerPreviewBuffer(state, options = {}) {
  if (!state || state.variant === "missing") {
    return sharp(Buffer.from(renderMissingSvg())).png().toBuffer();
  }

  const [flowerDataUri, avatarDataUri] = await Promise.all([
    loadFlowerAsset(),
    buildAvatarDataUri(state.avatar, options.imagesDir),
  ]);
  const svg = renderAnswerSvg(state, { flowerDataUri, avatarDataUri });
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = {
  buildAnswerImagePath,
  buildAnswerPageUrl,
  buildAnswerPreviewState,
  buildAnswerShareHtml,
  getAnswerPreviewDimensions,
  renderAnswerPreviewBuffer,
};
