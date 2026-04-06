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
const DEFAULT_DESCRIPTION =
  "Answer one public question each UTC day, then browse the archive of past prompts and answers.";

function formatRecordedDate(recordedDate) {
  if (!recordedDate) {
    return "Unknown day";
  }

  const parsed = new Date(`${recordedDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown day";
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

function renderQuestionSvg(state) {
  const activeRecordedDate = state.question?.recordedDate || state.currentRecordedDate;
  const promptLines = state.question
    ? wrapText(state.question.prompt, 44, 6)
    : [];
  const promptFontSize =
    promptLines.length <= 3
      ? 54
      : promptLines.length === 4
        ? 46
        : promptLines.length === 5
          ? 38
          : 32;
  const promptLineHeight = promptFontSize + 8;
  const promptMarkup = promptLines
    .map(
      (line, index) =>
        `<tspan x="142" dy="${index === 0 ? 0 : promptLineHeight}">${escapeSvg(line)}</tspan>`,
    )
    .join("");
  const carryOverBanner = state.carriedOver
    ? `
      <rect x="118" y="210" width="760" height="62" rx="22" fill="#fffbeb" stroke="#f59e0b" stroke-width="2" />
      <text x="146" y="246" font-family="QuicksandPreview, sans-serif" font-size="22" font-weight="700" fill="#b45309">
        This question is still active on ${escapeSvg(formatRecordedDate(state.currentRecordedDate))} because nobody answered it yet.
      </text>
    `
    : "";
  const promptCardY = state.carriedOver ? 282 : 226;
  const promptCardHeight = state.carriedOver ? 248 : 264;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}">
      <defs>
        <linearGradient id="qotdPageGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#fdfcff" />
          <stop offset="54%" stop-color="#eff6ff" />
          <stop offset="100%" stop-color="#dbeafe" />
        </linearGradient>
        <linearGradient id="qotdCardGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.98)" />
          <stop offset="100%" stop-color="rgba(255,255,255,0.92)" />
        </linearGradient>
        <style>
          ${buildEmbeddedFontsCss()}
        </style>
      </defs>
      <rect width="100%" height="100%" fill="url(#qotdPageGradient)" />
      <circle cx="150" cy="142" r="132" fill="rgba(251, 207, 232, 0.22)" />
      <circle cx="1048" cy="104" r="112" fill="rgba(191,219,254,0.55)" />
      <circle cx="1032" cy="548" r="168" fill="rgba(147,197,253,0.25)" />
      <rect x="74" y="54" width="1052" height="522" rx="36" fill="url(#qotdCardGradient)" stroke="#60a5fa" stroke-width="7" />
      <text x="118" y="106" font-family="QuicksandPreview, sans-serif" font-size="18" font-weight="700" fill="#60a5fa" letter-spacing="2">mirabellier.com / question of the day</text>
      <text x="118" y="168" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="52" font-weight="700" fill="#1d4ed8">question of the day</text>
      <rect x="850" y="96" width="198" height="48" rx="24" fill="#dbeafe" />
      <text x="949" y="126" text-anchor="middle" font-family="QuicksandPreview, sans-serif" font-size="22" font-weight="700" fill="#1d4ed8">${escapeSvg(formatRecordedDate(activeRecordedDate))}</text>
      ${carryOverBanner}
      <rect x="118" y="${promptCardY}" width="964" height="${promptCardHeight}" rx="30" fill="rgba(239,246,255,0.95)" stroke="#bfdbfe" stroke-width="3" />
      <text x="142" y="${promptCardY + 36}" font-family="QuicksandPreview, sans-serif" font-size="20" font-weight="700" fill="#60a5fa" letter-spacing="1.2">TODAY'S PROMPT</text>
      <text x="142" y="${promptCardY + 82}" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="${promptFontSize}" font-weight="700" fill="#1e3a8a">
        ${promptMarkup}
      </text>
      <text x="118" y="560" font-family="QuicksandPreview, sans-serif" font-size="22" font-weight="700" fill="#475569">Answer one public question each UTC day, then browse the archive on mirabellier.com.</text>
    </svg>
  `;
}

function renderEmptySvg(state) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}">
      <defs>
        <linearGradient id="qotdEmptyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#fdfcff" />
          <stop offset="54%" stop-color="#eff6ff" />
          <stop offset="100%" stop-color="#dbeafe" />
        </linearGradient>
        <style>
          ${buildEmbeddedFontsCss()}
        </style>
      </defs>
      <rect width="100%" height="100%" fill="url(#qotdEmptyGradient)" />
      <circle cx="164" cy="150" r="136" fill="rgba(251, 207, 232, 0.24)" />
      <circle cx="1032" cy="110" r="120" fill="rgba(191,219,254,0.55)" />
      <rect x="74" y="54" width="1052" height="522" rx="36" fill="rgba(255,255,255,0.95)" stroke="#60a5fa" stroke-width="7" />
      <text x="118" y="106" font-family="QuicksandPreview, sans-serif" font-size="18" font-weight="700" fill="#60a5fa" letter-spacing="2">mirabellier.com / question of the day</text>
      <text x="118" y="168" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="52" font-weight="700" fill="#1d4ed8">question of the day</text>
      <rect x="850" y="96" width="198" height="48" rx="24" fill="#dbeafe" />
      <text x="949" y="126" text-anchor="middle" font-family="QuicksandPreview, sans-serif" font-size="22" font-weight="700" fill="#1d4ed8">${escapeSvg(formatRecordedDate(state.currentRecordedDate))}</text>
      <rect x="156" y="236" width="888" height="198" rx="32" fill="rgba(239,246,255,0.92)" stroke="#bfdbfe" stroke-width="3" />
      <text x="600" y="316" text-anchor="middle" font-family="FredokaPreview, QuicksandPreview, sans-serif" font-size="40" font-weight="700" fill="#1d4ed8">No active question yet.</text>
      <text x="600" y="362" text-anchor="middle" font-family="QuicksandPreview, sans-serif" font-size="26" font-weight="700" fill="#475569">The next prompt will appear here as soon as it goes live.</text>
      <text x="118" y="520" font-family="QuicksandPreview, sans-serif" font-size="22" font-weight="700" fill="#475569">The page stays ready for the next UTC-day question on mirabellier.com.</text>
    </svg>
  `;
}

async function renderQuestionPreviewBuffer(state) {
  const svg =
    state.variant === "empty" ? renderEmptySvg(state) : renderQuestionSvg(state);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = {
  buildQuestionImagePath,
  buildQuestionPreviewState,
  buildQuestionShareHtml,
  getQuestionPreviewDimensions,
  renderQuestionPreviewBuffer,
};
