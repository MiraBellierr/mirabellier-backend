const fs = require("fs");
const path = require("path");

let cachedSpaEntry = null;

function normalizeOrigin(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.origin;
  } catch {
    return "";
  }
}

function resolveProtocol(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.trim()) {
    return forwardedProto.split(",")[0].trim();
  }
  return req.protocol || "http";
}

function resolveSpaEntryCandidates() {
  const candidates = [];
  const customSpaEntry = String(process.env.SPA_ENTRY_FILE || "").trim();

  if (customSpaEntry) {
    candidates.push(path.resolve(customSpaEntry));
  }

  candidates.push(path.resolve(__dirname, "..", "..", "dist", "index.html"));
  candidates.push(path.resolve(process.cwd(), "dist", "index.html"));
  candidates.push(path.resolve("/var/www/mirabellier/dist/index.html"));
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

function resolveFrontendOrigin(req) {
  const configuredFrontend = normalizeOrigin(process.env.FRONTEND_URL);
  if (configuredFrontend) return configuredFrontend;

  const configuredWebsiteBase = normalizeOrigin(process.env.WEBSITE_BASE);
  if (configuredWebsiteBase) return configuredWebsiteBase;

  const protocol = resolveProtocol(req);
  const host = req.get("host") || "localhost";
  return `${protocol}://${host}`;
}

function normalizePathname(pathname) {
  const value = String(pathname || "");
  return value.startsWith("/") ? value : `/${value}`;
}

function buildCurrentRequestUrl(req) {
  const protocol = resolveProtocol(req);
  const host = req.get("host") || "localhost";
  const pathname = normalizePathname(req.path || "/");
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  return `${protocol}://${host}${pathname}${search}`;
}

function buildFrontendTargetUrl(req, spaPath) {
  const origin = resolveFrontendOrigin(req);
  const pathname = normalizePathname(spaPath || req.path || "/");
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  return `${origin}${pathname}${search}`;
}

function handleHumanSpaRequest(req, res, spaPath) {
  const currentUrl = buildCurrentRequestUrl(req);
  const targetUrl = buildFrontendTargetUrl(req, spaPath);

  if (currentUrl !== targetUrl) {
    res.redirect(302, targetUrl);
    return true;
  }

  return false;
}

function sendFrontendRedirectConfigError(res) {
  res
    .status(503)
    .type("text/plain")
    .send(
      "Direct-link frontend redirect is not configured correctly. Set FRONTEND_URL/WEBSITE_BASE to your real frontend origin.",
    );
  return true;
}

module.exports = {
  handleHumanSpaRequest,
  sendFrontendRedirectConfigError,
  sendSpaEntry,
};
