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
const CARD_X = 72;
const CARD_Y = 52;
const CARD_WIDTH = 1056;
const CARD_HEIGHT = 526;
const PROMPT_X = 116;
const PROMPT_Y = 226;
const PROMPT_WIDTH = 968;
const PROMPT_HEIGHT = 264;
const RENDERER_VERSION = "qotd-render-v2";
const DEFAULT_DESCRIPTION =
  "Answer one public question each UTC day, then browse the archive of past prompts and answers.";

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

function buildPromptLayout(prompt) {
  const candidates = [
    { maxChars: 34, maxLines: 3, fontSize: 54, lineHeight: 58 },
    { maxChars: 38, maxLines: 4, fontSize: 48, lineHeight: 52 },
    { maxChars: 42, maxLines: 4, fontSize: 44, lineHeight: 48 },
    { maxChars: 46, maxLines: 5, fontSize: 40, lineHeight: 43 },
    { maxChars: 50, maxLines: 5, fontSize: 36, lineHeight: 39 },
    { maxChars: 56, maxLines: 6, fontSize: 32, lineHeight: 35 },
    { maxChars: 62, maxLines: 7, fontSize: 28, lineHeight: 31 },
    { maxChars: 68, maxLines: 8, fontSize: 25, lineHeight: 28 },
  ];
  const availableHeight = 160;

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
    <rect width="100%" height="100%" fill="#f8fbff" />
    <circle cx="140" cy="110" r="100" fill="rgba(252, 207, 232, 0.34)" />
    <circle cx="1050" cy="96" r="110" fill="rgba(147, 197, 253, 0.34)" />
    <circle cx="1100" cy="560" r="160" fill="rgba(147, 197, 253, 0.28)" />
  `;
}

function buildMainCard() {
  return `
    <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="36" fill="#ffffff" />
    <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="36" fill="none" stroke="#60a5fa" stroke-width="6" />
  `;
}

function buildCarriedOverBanner() {
  return `
    <rect x="${PROMPT_X}" y="182" width="${PROMPT_WIDTH}" height="34" rx="17" fill="#fffbeb" stroke="#f59e0b" stroke-width="2" />
    <text x="${PROMPT_X + 18}" y="204" font-family="QuicksandPreview, sans-serif" font-size="16" font-weight="700" fill="#b45309">still active because it has not received an answer yet</text>
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
      <text x="118" y="106" font-family="QuicksandPreview, sans-serif" font-size="18" font-weight="700" letter-spacing="3" fill="#60a5fa">mirabellier.com / question of the day</text>
      <rect x="848" y="96" width="200" height="48" rx="24" fill="#dbeafe" />
      <text x="948" y="128" text-anchor="middle" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="24" font-weight="700" fill="#1d4ed8">${escapeSvg(titleDate || "today")}</text>
      <text x="116" y="164" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="66" font-weight="700" fill="#1d4ed8">question of the day</text>
      ${state.carriedOver ? buildCarriedOverBanner() : ""}
      <rect x="${PROMPT_X}" y="${PROMPT_Y}" width="${PROMPT_WIDTH}" height="${PROMPT_HEIGHT}" rx="28" fill="#eff6ff" />
      <rect x="${PROMPT_X}" y="${PROMPT_Y}" width="${PROMPT_WIDTH}" height="${PROMPT_HEIGHT}" rx="28" fill="none" stroke="#bfdbfe" stroke-width="3" />
      <text x="${PROMPT_X + 26}" y="${PROMPT_Y + 36}" font-family="QuicksandPreview, sans-serif" font-size="22" font-weight="700" letter-spacing="2" fill="#60a5fa">TODAY&apos;S PROMPT</text>
      <text x="${PROMPT_X + 26}" y="${PROMPT_Y + 82}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="${promptLayout.fontSize}" font-weight="700" fill="#1e3a8a">
        ${promptMarkup}
      </text>
      <text x="118" y="560" font-family="QuicksandPreview, sans-serif" font-size="20" font-weight="700" fill="#475569">Answer one public question each UTC day, then browse the archive on mirabellier.com.</text>
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
      <text x="118" y="106" font-family="QuicksandPreview, sans-serif" font-size="18" font-weight="700" letter-spacing="3" fill="#60a5fa">mirabellier.com / question of the day</text>
      <rect x="848" y="96" width="200" height="48" rx="24" fill="#dbeafe" />
      <text x="948" y="128" text-anchor="middle" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="24" font-weight="700" fill="#1d4ed8">${escapeSvg(titleDate || "today")}</text>
      <text x="116" y="164" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="66" font-weight="700" fill="#1d4ed8">question of the day</text>
      <rect x="${PROMPT_X}" y="${PROMPT_Y}" width="${PROMPT_WIDTH}" height="${PROMPT_HEIGHT}" rx="28" fill="#eff6ff" />
      <rect x="${PROMPT_X}" y="${PROMPT_Y}" width="${PROMPT_WIDTH}" height="${PROMPT_HEIGHT}" rx="28" fill="none" stroke="#bfdbfe" stroke-width="3" />
      <text x="${PROMPT_X + 26}" y="${PROMPT_Y + 36}" font-family="QuicksandPreview, sans-serif" font-size="22" font-weight="700" letter-spacing="2" fill="#60a5fa">TODAY&apos;S PROMPT</text>
      <text x="${PROMPT_X + 26}" y="${PROMPT_Y + 116}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="34" font-weight="700" fill="#1e3a8a">No active question yet.</text>
      <text x="${PROMPT_X + 26}" y="${PROMPT_Y + 164}" font-family="QuicksandPreview, sans-serif" font-size="23" font-weight="700" fill="#475569">The next prompt will appear here as soon as it goes live.</text>
      <text x="118" y="560" font-family="QuicksandPreview, sans-serif" font-size="20" font-weight="700" fill="#475569">Answer one public question each UTC day, then browse the archive on mirabellier.com.</text>
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
