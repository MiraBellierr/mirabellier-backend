const fs = require("fs");
const path = require("path");

let cachedFredokaFont = null;
let cachedQuicksandFont = null;

function resolveRepoPath(...segments) {
  return path.join(__dirname, "..", "..", ...segments);
}

function readFileAsBase64(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath).toString("base64");
}

function buildEmbeddedFontsCss() {
  if (!cachedFredokaFont) {
    cachedFredokaFont = readFileAsBase64(
      resolveRepoPath("public", "fonts", "fredoka-latin-variable.woff2"),
    );
  }

  if (!cachedQuicksandFont) {
    cachedQuicksandFont = readFileAsBase64(
      resolveRepoPath("public", "fonts", "quicksand-latin-variable.woff2"),
    );
  }

  const blocks = [];

  if (cachedFredokaFont) {
    blocks.push(`@font-face {
      font-family: 'FredokaPreview';
      src: url(data:font/woff2;base64,${cachedFredokaFont}) format('woff2');
    }`);
  }

  if (cachedQuicksandFont) {
    blocks.push(`@font-face {
      font-family: 'QuicksandPreview';
      src: url(data:font/woff2;base64,${cachedQuicksandFont}) format('woff2');
    }`);
  }

  return blocks.join("\n");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeSvg(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function limitLength(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(maxLength - 3, 1)).trimEnd()}...`;
}

function wrapText(value, maxCharsPerLine, maxLines = Number.POSITIVE_INFINITY) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return [""];
  }

  const words = text.split(" ");
  const lines = [];
  let currentLine = "";
  let consumedAllWords = true;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (candidate.length <= maxCharsPerLine) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      lines.push(limitLength(word, maxCharsPerLine));
      currentLine = "";
    }

    if (lines.length === maxLines) {
      consumedAllWords = index >= words.length - 1 && !currentLine;
      break;
    }
  }

  if (lines.length < maxLines && currentLine) {
    lines.push(currentLine);
  } else if (currentLine) {
    consumedAllWords = false;
  }

  if (!consumedAllWords && lines.length) {
    lines[lines.length - 1] = limitLength(lines[lines.length - 1], maxCharsPerLine);
  }

  return lines.slice(0, maxLines);
}

function isLikelyCrawler(userAgent) {
  const value = String(userAgent || "").toLowerCase();
  return /bot|crawler|spider|google-inspectiontool|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandex|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot/.test(
    value,
  );
}

function resolveProtocol(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];

  if (typeof forwardedProto === "string" && forwardedProto.trim()) {
    return forwardedProto.split(",")[0].trim();
  }

  return req.protocol || "http";
}

module.exports = {
  buildEmbeddedFontsCss,
  escapeHtml,
  escapeJsonForHtml,
  escapeSvg,
  isLikelyCrawler,
  limitLength,
  resolveProtocol,
  wrapText,
};
