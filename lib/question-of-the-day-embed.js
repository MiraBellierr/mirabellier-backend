const crypto = require("crypto");
const sharp = require("sharp");

const {
  buildEmbeddedFontsCss,
  escapeHtml,
  escapeJsonForHtml,
  escapeSvg,
  wrapText,
} = require("./share-preview-utils");

const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;
const CARD_X = 96;
const CARD_Y = 78;
const CARD_WIDTH = 1008;
const CARD_HEIGHT = 474;
const PROMPT_X = 144;
const PROMPT_Y = 232;
const PROMPT_WIDTH = 912;
const PROMPT_HEIGHT = 232;
const RENDERER_VERSION = "qotd-render-v4";
const DEFAULT_DESCRIPTION = "Today's public question on Mirabellier.";

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
    RENDERER_VERSION,
    currentRecordedDate || "",
    question?.recordedDate || "",
    question?.updatedAt || "",
    question?.prompt || "",
  ].join("|");

  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function buildQuestionPreviewState({ currentRecordedDate, question }) {
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
      : "There is no live question on Mirabellier right now.",
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

function buildPromptLayout(prompt) {
  const candidates = [
    { maxChars: 44, maxLines: 3, fontSize: 42, lineHeight: 46 },
    { maxChars: 50, maxLines: 4, fontSize: 38, lineHeight: 42 },
    { maxChars: 56, maxLines: 4, fontSize: 34, lineHeight: 38 },
    { maxChars: 62, maxLines: 5, fontSize: 30, lineHeight: 34 },
    { maxChars: 68, maxLines: 6, fontSize: 27, lineHeight: 31 },
    { maxChars: 74, maxLines: 7, fontSize: 24, lineHeight: 28 },
    { maxChars: 80, maxLines: 8, fontSize: 21, lineHeight: 25 },
  ];
  const availableHeight = 132;

  for (const candidate of candidates) {
    const lines = wrapText(prompt, candidate.maxChars, Number.POSITIVE_INFINITY);
    const textHeight =
      candidate.fontSize + Math.max(lines.length - 1, 0) * candidate.lineHeight;

    if (lines.length <= candidate.maxLines && textHeight <= availableHeight) {
      return {
        ...candidate,
        lines,
      };
    }
  }

  const fallback = candidates[candidates.length - 1];
  return {
    ...fallback,
    lines: wrapText(prompt, fallback.maxChars, fallback.maxLines),
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

function buildMainCard() {
  return `
    <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="34" fill="rgba(255,255,255,0.82)" />
    <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="34" fill="none" stroke="#93c5fd" stroke-width="3" />
  `;
}

function buildCarriedOverBanner() {
  return `
    <rect x="${PROMPT_X}" y="196" width="318" height="34" rx="17" fill="#fffbeb" stroke="#f59e0b" stroke-width="1.5" />
    <text x="${PROMPT_X + 18}" y="218" font-family="QuicksandPreview, sans-serif" font-size="15" font-weight="700" fill="#b45309">still active because it has no answers yet</text>
  `;
}

function renderQuestionSvg(state) {
  const activeRecordedDate = state.question?.recordedDate || state.currentRecordedDate;
  const titleDate = formatHeadingDate(activeRecordedDate);
  const promptLayout = state.question
    ? buildPromptLayout(state.question.prompt)
    : { lines: [], fontSize: 28, lineHeight: 32 };
  const promptMarkup = promptLayout.lines
    .map(
      (line, index) =>
        `<tspan x="${PROMPT_X + 26}" dy="${index === 0 ? 0 : promptLayout.lineHeight}">${escapeSvg(line)}</tspan>`,
    )
    .join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}">
      <defs>
        <style>
          ${buildEmbeddedFontsCss()}
        </style>
      </defs>
      ${buildBackground()}
      ${buildMainCard()}
      <rect x="898" y="118" width="132" height="42" rx="21" fill="#dbeafe" />
      <text x="964" y="145" text-anchor="middle" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="22" font-weight="700" fill="#1d4ed8">${escapeSvg(titleDate || "today")}</text>
      <text x="144" y="160" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="56" font-weight="700" fill="#1d4ed8">today&apos;s question</text>
      ${state.carriedOver ? buildCarriedOverBanner() : ""}
      <rect x="${PROMPT_X}" y="${PROMPT_Y}" width="${PROMPT_WIDTH}" height="${PROMPT_HEIGHT}" rx="28" fill="#eef5ff" />
      <rect x="${PROMPT_X}" y="${PROMPT_Y}" width="${PROMPT_WIDTH}" height="${PROMPT_HEIGHT}" rx="28" fill="none" stroke="#bfdbfe" stroke-width="2.5" />
      <text x="${PROMPT_X + 28}" y="${PROMPT_Y + 38}" font-family="QuicksandPreview, sans-serif" font-size="17" font-weight="700" letter-spacing="2.2" fill="#60a5fa">PROMPT</text>
      <text x="${PROMPT_X + 28}" y="${PROMPT_Y + 82}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="${promptLayout.fontSize}" font-weight="700" fill="#1e3a8a">
        ${promptMarkup}
      </text>
    </svg>
  `;
}

function renderEmptySvg(state) {
  const titleDate = formatHeadingDate(state.currentRecordedDate);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}">
      <defs>
        <style>
          ${buildEmbeddedFontsCss()}
        </style>
      </defs>
      ${buildBackground()}
      ${buildMainCard()}
      <rect x="898" y="118" width="132" height="42" rx="21" fill="#dbeafe" />
      <text x="964" y="145" text-anchor="middle" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="22" font-weight="700" fill="#1d4ed8">${escapeSvg(titleDate || "today")}</text>
      <text x="144" y="160" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="56" font-weight="700" fill="#1d4ed8">today&apos;s question</text>
      <rect x="${PROMPT_X}" y="${PROMPT_Y}" width="${PROMPT_WIDTH}" height="${PROMPT_HEIGHT}" rx="28" fill="#eef5ff" />
      <rect x="${PROMPT_X}" y="${PROMPT_Y}" width="${PROMPT_WIDTH}" height="${PROMPT_HEIGHT}" rx="28" fill="none" stroke="#bfdbfe" stroke-width="2.5" />
      <text x="${PROMPT_X + 28}" y="${PROMPT_Y + 38}" font-family="QuicksandPreview, sans-serif" font-size="17" font-weight="700" letter-spacing="2.2" fill="#60a5fa">PROMPT</text>
      <text x="${PROMPT_X + 28}" y="${PROMPT_Y + 106}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="34" font-weight="700" fill="#1e3a8a">No active question yet.</text>
      <text x="${PROMPT_X + 28}" y="${PROMPT_Y + 154}" font-family="QuicksandPreview, sans-serif" font-size="22" font-weight="700" fill="#475569">The next prompt will appear here as soon as it goes live.</text>
    </svg>
  `;
}

async function renderQuestionPreviewBuffer(state) {
  const svg =
    state.variant === "empty"
      ? renderEmptySvg(state)
      : renderQuestionSvg(state);

  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = {
  buildQuestionImagePath,
  buildQuestionPreviewState,
  buildQuestionShareHtml,
  getQuestionPreviewDimensions,
  renderQuestionPreviewBuffer,
};
