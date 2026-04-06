const crypto = require("crypto");
const sharp = require("sharp");

const {
  buildEmbeddedFontsCss,
  buildRepoImageDataUri,
  escapeHtml,
  escapeJsonForHtml,
  escapeSvg,
  wrapText,
} = require("./share-preview-utils");

const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;
const CARD_X = 78;
const CARD_Y = 84;
const CARD_WIDTH = 1044;
const CARD_HEIGHT = 462;
const DEFAULT_DESCRIPTION =
  "Answer one public question each UTC day, then browse the archive of past prompts and answers.";

let cachedAssetsPromise = null;

function formatHeadingDate(recordedDate) {
  if (!recordedDate) {
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
  });
}

function buildVersion(currentRecordedDate, question) {
  const input = [
    currentRecordedDate || "",
    question?.recordedDate || "",
    question?.updatedAt || "",
    question?.prompt || "",
  ].join("|");

  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function buildQuestionPreviewState({
  currentRecordedDate,
  question,
}) {
  const normalizedQuestion =
    question && typeof question.prompt === "string"
      ? {
          recordedDate: question.recordedDate || "",
          prompt: question.prompt || "",
          updatedAt: question.updatedAt || "",
        }
      : null;
  const carriedOver = Boolean(
    normalizedQuestion &&
      normalizedQuestion.recordedDate &&
      normalizedQuestion.recordedDate !== currentRecordedDate,
  );

  return {
    variant: normalizedQuestion ? "question" : "empty",
    currentRecordedDate: currentRecordedDate || "",
    question: normalizedQuestion,
    carriedOver,
    title: "Mirabellier Question of the Day",
    description: normalizedQuestion
      ? DEFAULT_DESCRIPTION
      : "There is no live question right now. Check back soon for the next prompt.",
    imageAlt: "A preview image of Mirabellier's question of the day page.",
    version: buildVersion(currentRecordedDate, normalizedQuestion),
  };
}

function getQuestionPreviewDimensions() {
  return {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
  };
}

function buildQuestionImagePath(version) {
  const encodedVersion = encodeURIComponent(String(version || "fallback"));
  return `/question-of-the-day/embed-image.png?v=${encodedVersion}`;
}

function buildQuestionShareHtml({
  state,
  protocol,
  host,
  spaPath = "/question-of-the-day",
  redirectToSpa,
}) {
  const canonicalUrl = `${protocol}://${host}${spaPath}`;
  const redirectUrl = `${canonicalUrl}?_spa=1`;
  const imageUrl = `${protocol}://${host}${buildQuestionImagePath(state.version)}`;
  const dimensions = getQuestionPreviewDimensions();
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
      <p><a href="${escapeHtml(canonicalUrl)}">Open the question of the day page</a></p>
    </main>
  </body>
</html>`;
}

async function loadQuestionAssets() {
  if (!cachedAssetsPromise) {
    cachedAssetsPromise = Promise.all([
      buildRepoImageDataUri("public/light.webp", {
        width: PREVIEW_WIDTH,
        height: PREVIEW_HEIGHT,
      }),
    ]).then(([background]) => ({
      background,
    }));
  }

  return cachedAssetsPromise;
}

function buildPromptLayout(prompt, carriedOver) {
  const promptTop = carriedOver ? 250 : 190;
  const promptTextTop = promptTop + 38;
  const availableHeight = 490 - promptTextTop;
  const candidates = [
    { maxChars: 56, maxLines: 4, fontSize: 32, lineHeight: 40 },
    { maxChars: 64, maxLines: 5, fontSize: 30, lineHeight: 38 },
    { maxChars: 70, maxLines: 6, fontSize: 28, lineHeight: 35 },
    { maxChars: 76, maxLines: 7, fontSize: 26, lineHeight: 33 },
    { maxChars: 82, maxLines: 8, fontSize: 24, lineHeight: 30 },
  ];

  for (const candidate of candidates) {
    const lines = wrapText(prompt, candidate.maxChars, Number.POSITIVE_INFINITY);
    const textHeight =
      candidate.fontSize + Math.max(lines.length - 1, 0) * candidate.lineHeight;

    if (lines.length <= candidate.maxLines && textHeight <= availableHeight) {
      return {
        ...candidate,
        lines,
        promptTop,
      };
    }
  }

  const fallback = candidates[candidates.length - 1];
  return {
    ...fallback,
    lines: wrapText(prompt, fallback.maxChars, fallback.maxLines),
    promptTop,
  };
}

function buildMainSection(state, assets) {
  const activeRecordedDate = state.question?.recordedDate || state.currentRecordedDate;
  const titleDate = formatHeadingDate(activeRecordedDate);
  const promptLayout = state.question
    ? buildPromptLayout(state.question.prompt, state.carriedOver)
    : { lines: [], fontSize: 24, lineHeight: 32, promptTop: 190 };
  const promptMarkup = promptLayout.lines
    .map(
      (line, index) =>
        `<tspan x="${CARD_X + 34}" dy="${index === 0 ? 0 : promptLayout.lineHeight}">${escapeSvg(line)}</tspan>`,
    )
    .join("");
  const bannerMarkup = state.carriedOver
    ? `
      <rect x="${CARD_X + 18}" y="${CARD_Y + 92}" width="${CARD_WIDTH - 36}" height="62" rx="18" fill="#fffbeb" stroke="#f59e0b" stroke-width="2" />
      <text x="${CARD_X + 44}" y="${CARD_Y + 138}" font-family="QuicksandPreview, sans-serif" font-size="18" font-weight="700" fill="#b45309">
        This question is still active because it has not received an answer yet.
      </text>
    `
    : "";

  return `
    <g>
      <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="26" fill="rgba(255,255,255,0.6)" />
      <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="26" fill="none" stroke="#93c5fd" stroke-width="2.5" />
      <text x="${CARD_X + 34}" y="${CARD_Y + 48}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="36" font-weight="700" fill="#1d4ed8">Question of the day${titleDate ? ` (${escapeSvg(titleDate)})` : ""}</text>
      ${bannerMarkup}
      <text x="${CARD_X + 34}" y="${CARD_Y + promptLayout.promptTop}" font-family="QuicksandPreview, sans-serif" font-size="18" font-weight="700" fill="#2563eb">Question:</text>
      <text x="${CARD_X + 34}" y="${CARD_Y + promptLayout.promptTop + 38}" font-family="QuicksandPreview, sans-serif" font-size="${promptLayout.fontSize}" font-weight="700" fill="#334155">
        ${promptMarkup}
      </text>
      <text x="${CARD_X + 34}" y="${CARD_Y + 430}" font-family="QuicksandPreview, sans-serif" font-size="17" font-weight="700" fill="#60a5fa">Guests can answer too. Add a name first on the live page.</text>
    </g>
  `;
}

function renderQuestionSvg(state, assets) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}">
      <defs>
        <style>
          ${buildEmbeddedFontsCss()}
        </style>
      </defs>
      ${assets.background ? `<image href="${assets.background}" x="0" y="0" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" preserveAspectRatio="xMidYMid slice" />` : `<rect width="100%" height="100%" fill="#eaf4ff" />`}
      <rect width="100%" height="100%" fill="rgba(255,255,255,0.18)" />
      ${buildMainSection(state, assets)}
    </svg>
  `;
}

function renderEmptySvg(state, assets) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}">
      <defs>
        <style>
          ${buildEmbeddedFontsCss()}
        </style>
      </defs>
      ${assets.background ? `<image href="${assets.background}" x="0" y="0" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" preserveAspectRatio="xMidYMid slice" />` : `<rect width="100%" height="100%" fill="#eaf4ff" />`}
      <rect width="100%" height="100%" fill="rgba(255,255,255,0.18)" />
      <g>
        <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="26" fill="rgba(255,255,255,0.6)" />
        <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="26" fill="none" stroke="#93c5fd" stroke-width="2.5" />
        <text x="${CARD_X + 34}" y="${CARD_Y + 48}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="36" font-weight="700" fill="#1d4ed8">Question of the day (${escapeSvg(formatHeadingDate(state.currentRecordedDate))})</text>
        <text x="${CARD_X + 34}" y="${CARD_Y + 192}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="38" font-weight="700" fill="#1d4ed8">No active question yet.</text>
        <text x="${CARD_X + 34}" y="${CARD_Y + 246}" font-family="QuicksandPreview, sans-serif" font-size="24" font-weight="700" fill="#475569">The answer form opens again as soon as the next active question is available.</text>
      </g>
    </svg>
  `;
}

async function renderQuestionPreviewBuffer(state) {
  const assets = await loadQuestionAssets();
  const svg =
    state.variant === "empty"
      ? renderEmptySvg(state, assets)
      : renderQuestionSvg(state, assets);

  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = {
  buildQuestionImagePath,
  buildQuestionPreviewState,
  buildQuestionShareHtml,
  getQuestionPreviewDimensions,
  renderQuestionPreviewBuffer,
};
