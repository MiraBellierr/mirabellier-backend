const crypto = require("crypto");
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
const RENDERER_VERSION = "qotd-answer-render-v1";
const DEFAULT_DESCRIPTION = "An answer to Mirabellier's Question of the Day.";

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

function formatRecordedDate(recordedDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(recordedDate || ""))) {
    return "";
  }

  const parsed = new Date(`${recordedDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
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

function buildVersion(answer) {
  const input = [
    RENDERER_VERSION,
    answer?.id || "",
    answer?.recordedDate || "",
    answer?.prompt || "",
    answer?.answer || "",
    answer?.displayName || "",
    answer?.createdAt || "",
  ].join("|");

  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function buildAnswerPreviewState({ answer } = {}) {
  const normalized =
    answer && typeof answer.answer === "string" && answer.answer.trim()
      ? {
          id: String(answer.id || ""),
          recordedDate: String(answer.recordedDate || ""),
          prompt: String(answer.prompt || ""),
          answer: String(answer.answer || "").replace(/\s+/g, " ").trim(),
          displayName: String(answer.displayName || "Anonymous").trim() ||
            "Anonymous",
          createdAt: String(answer.createdAt || ""),
        }
      : null;

  const displayDate = normalized
    ? formatRecordedDate(normalized.recordedDate)
    : "";
  const title = normalized
    ? `${normalized.displayName} answered — Question of the Day`
    : "Question of the Day";
  const description = normalized
    ? limitLength(
        `"${normalized.answer}" — ${normalized.displayName}${
          displayDate ? `, ${displayDate}` : ""
        }`,
        200,
      )
    : DEFAULT_DESCRIPTION;

  return {
    variant: normalized ? "answer" : "missing",
    id: normalized?.id || "",
    recordedDate: normalized?.recordedDate || "",
    displayDate,
    prompt: normalized?.prompt || "",
    answer: normalized?.answer || "",
    displayName: normalized?.displayName || "",
    title,
    description,
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
    ...(state.displayName ? { creator: { "@type": "Person", name: state.displayName } } : {}),
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
    <meta name="theme-color" content="#f472b6" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(state.title)}" />
    <meta property="og:description" content="${escapeHtml(state.description)}" />
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
    <meta name="twitter:description" content="${escapeHtml(state.description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
    <meta name="twitter:image:alt" content="${escapeHtml(state.imageAlt)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <script type="application/ld+json">${escapeJsonForHtml(jsonLd)}</script>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(state.title)}</h1>
      ${state.prompt ? `<p><strong>${escapeHtml(state.prompt)}</strong></p>` : ""}
      ${state.answer ? `<blockquote>${escapeHtml(state.answer)}</blockquote>` : ""}
      <p><a href="${escapeHtml(canonicalUrl)}">Open the question of the day</a></p>
    </main>
  </body>
</html>`;
}

function buildAnswerLayout(answerText, availableHeight) {
  const candidates = [
    { maxChars: 34, fontSize: 46, lineHeight: 58 },
    { maxChars: 40, fontSize: 40, lineHeight: 51 },
    { maxChars: 46, fontSize: 35, lineHeight: 45 },
    { maxChars: 52, fontSize: 31, lineHeight: 40 },
    { maxChars: 60, fontSize: 27, lineHeight: 35 },
    { maxChars: 70, fontSize: 23, lineHeight: 30 },
    { maxChars: 82, fontSize: 20, lineHeight: 26 },
  ];

  for (const candidate of candidates) {
    const lines = wrapText(
      answerText,
      candidate.maxChars,
      Number.POSITIVE_INFINITY,
    );
    const textHeight =
      candidate.fontSize + Math.max(lines.length - 1, 0) * candidate.lineHeight;

    if (textHeight <= availableHeight) {
      return { ...candidate, lines };
    }
  }

  const fallback = candidates[candidates.length - 1];
  const maxLines = Math.max(
    1,
    Math.floor(
      (availableHeight - fallback.fontSize) / fallback.lineHeight,
    ) + 1,
  );

  return {
    ...fallback,
    lines: wrapText(answerText, fallback.maxChars, maxLines),
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

function renderAnswerSvg(state, flowerDataUri) {
  const innerX = CARD_X + CARD_PADDING_X;
  const innerWidth = CARD_WIDTH - CARD_PADDING_X * 2;

  const eyebrowY = CARD_Y + 52;
  const promptLines = state.prompt
    ? wrapText(state.prompt, 58, 2)
    : [];
  const promptTop = eyebrowY + 40;
  const promptLineHeight = 30;
  const promptMarkup = promptLines
    .map(
      (line, index) =>
        `<tspan x="${innerX}" dy="${index === 0 ? 0 : promptLineHeight}">${escapeSvg(line)}</tspan>`,
    )
    .join("");
  const promptBlockHeight = promptLines.length
    ? 24 + Math.max(promptLines.length - 1, 0) * promptLineHeight
    : 0;

  const dividerY = promptTop + promptBlockHeight + 24;

  const footerHeight = 92;
  const answerTop = dividerY + 30;
  const answerBottom = CARD_Y + CARD_HEIGHT - footerHeight - 24;
  const availableHeight = Math.max(120, answerBottom - answerTop);

  const answerLayout = buildAnswerLayout(state.answer, availableHeight);
  const answerMarkup = answerLayout.lines
    .map(
      (line, index) =>
        `<tspan x="${innerX}" dy="${index === 0 ? 0 : answerLayout.lineHeight}">${escapeSvg(line)}</tspan>`,
    )
    .join("");
  const answerBaseline = answerTop + answerLayout.fontSize;

  const footerY = CARD_Y + CARD_HEIGHT - footerHeight;
  const avatarR = 26;
  const avatarCx = innerX + avatarR;
  const avatarCy = footerY + 40;
  const initials = getInitials(state.displayName);
  const bylineX = avatarCx + avatarR + 18;
  const metaText = state.displayDate
    ? `answered ${state.displayDate}`
    : "answered on Mirabellier";

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
      <text x="${innerX}" y="${eyebrowY}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="20" font-weight="700" letter-spacing="4" fill="#60a5fa">QUESTION OF THE DAY</text>
      ${
        promptMarkup
          ? `<text x="${innerX}" y="${promptTop}" font-family="QuicksandPreview, sans-serif" font-size="22" font-weight="700" fill="#1d4ed8">${promptMarkup}</text>`
          : ""
      }
      <line x1="${innerX}" y1="${dividerY}" x2="${innerX + innerWidth}" y2="${dividerY}" stroke="#bfdbfe" stroke-width="2" />
      <text x="${innerX}" y="${answerBaseline}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="${answerLayout.fontSize}" font-weight="700" fill="#1e3a8a">${answerMarkup}</text>
      <circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}" fill="#dbeafe" />
      <text x="${avatarCx}" y="${avatarCy + 6}" text-anchor="middle" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="18" font-weight="700" fill="#2563eb">${escapeSvg(initials)}</text>
      <text x="${bylineX}" y="${avatarCy - 4}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="24" font-weight="700" fill="#1d4ed8">${escapeSvg(limitLength(state.displayName, 42))}</text>
      <text x="${bylineX}" y="${avatarCy + 22}" font-family="QuicksandPreview, sans-serif" font-size="16" font-weight="700" fill="#60a5fa">${escapeSvg(metaText)}</text>
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

async function renderAnswerPreviewBuffer(state) {
  if (!state || state.variant === "missing") {
    return sharp(Buffer.from(renderMissingSvg())).png().toBuffer();
  }

  const flowerDataUri = await loadFlowerAsset();
  const svg = renderAnswerSvg(state, flowerDataUri);
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
