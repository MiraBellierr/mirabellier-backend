const fs = require("fs");
const path = require("path");

let cachedSpaEntry = null;

function resolveSpaEntryCandidates() {
  const candidates = [];
  const customSpaEntry = String(process.env.SPA_ENTRY_FILE || "").trim();

  if (customSpaEntry) {
    candidates.push(path.resolve(customSpaEntry));
  }

  candidates.push(path.resolve(__dirname, "..", "..", "dist", "index.html"));
  return candidates;
}

function loadSpaEntry() {
  if (cachedSpaEntry) {
    return cachedSpaEntry;
  }

  const candidates = resolveSpaEntryCandidates();
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    cachedSpaEntry = {
      path: candidate,
      html: fs.readFileSync(candidate, "utf8"),
    };
    return cachedSpaEntry;
  }

  return null;
}

function sendSpaEntry(res) {
  const entry = loadSpaEntry();
  if (!entry) {
    return false;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  res.send(entry.html);
  return true;
}

module.exports = {
  sendSpaEntry,
};
