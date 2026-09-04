const fs = require("fs");
const path = require("path");

const { cookieHeaderForHost, cookieFilePathIfExists } = require("./netscape-cookies");

const TIKTOK_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TIKTOK_PAGE_TIMEOUT_MS = 15000;
const TIKTOK_OEMBED_TIMEOUT_MS = 5000;

const TIKTOK_LIST_PATH = path.join(__dirname, "..", "data", "tiktok-videos.json");

const TIKTOK_COOKIES_FILE =
  process.env.TIKTOK_COOKIES_FILE ||
  path.join(__dirname, "..", "data", "tiktok-cookies.txt");

function tikTokCookieFilePath() {
  return cookieFilePathIfExists(TIKTOK_COOKIES_FILE);
}

function readTikTokCookieFile() {
  const fileCookies = cookieHeaderForHost(TIKTOK_COOKIES_FILE, "tiktok.com");
  const envCookie = String(process.env.TIKTOK_TTWID || "").trim();
  if (!fileCookies && !envCookie) return "";
  const parts = [];
  if (fileCookies) parts.push(fileCookies);
  if (envCookie && !fileCookies.includes(`ttwid=${envCookie}`)) {
    parts.push(`ttwid=${envCookie}`);
  }
  return parts.join("; ");
}

function buildTikTokHeaders(extra = {}) {
  const headers = {
    "user-agent": TIKTOK_USER_AGENT,
    "accept-language": "en-US,en;q=0.9",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    ...extra,
  };

  const merged = readTikTokCookieFile();
  if (merged) headers.cookie = merged;

  return headers;
}

function normalizeTikTokUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  let parsed = null;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "tiktok.com" && !hostname.endsWith(".tiktok.com")) {
    return null;
  }

  return parsed;
}

function extractTikTokVideoId(url) {
  const match = String(url.pathname || "").match(/\/video\/(\d+)/i);
  return match ? match[1] : null;
}

function unescapeTikTokUrl(raw) {
  if (typeof raw !== "string") return raw;
  return raw
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u0025/gi, "%");
}

function extractUniversalData(html) {
  const match = String(html || "").match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractSigiState(html) {
  const htmlString = String(html || "");
  const keyIndex = htmlString.indexOf("SIGI_STATE");
  if (keyIndex === -1) return null;

  const eqIndex = htmlString.indexOf("=", keyIndex);
  if (eqIndex === -1) return null;

  const start = htmlString.indexOf("{", eqIndex);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < htmlString.length; i += 1) {
    const char = htmlString[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(htmlString.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function findItemStruct(universal, sigi, videoId) {
  if (universal) {
    const item =
      universal?.["__DEFAULT_SCOPE__"]?.["webapp.video-detail"]?.itemInfo
        ?.itemStruct;
    if (item) return item;
  }

  if (sigi && videoId) {
    const item = sigi?.ItemModule?.[videoId];
    if (item) return item;
  }

  return null;
}

function pickPlayAddr(video) {
  if (!video || typeof video !== "object") return null;

  const candidates = [];
  if (typeof video.playAddr === "string" && video.playAddr) {
    candidates.push(video.playAddr);
  }
  if (typeof video.downloadAddr === "string" && video.downloadAddr) {
    candidates.push(video.downloadAddr);
  }

  const bitrates = Array.isArray(video.bitrateInfo) ? video.bitrateInfo : [];
  const sorted = [...bitrates].sort(
    (a, b) =>
      (Number(b.Bitrate) || Number(b.bitrate) || 0) -
      (Number(a.Bitrate) || Number(a.bitrate) || 0),
  );

  for (const entry of sorted) {
    const direct =
      entry.PlayAddr?.UrlList?.[0] ||
      entry.PlayAddr?.url_list?.[0] ||
      entry.play_addr?.UrlList?.[0] ||
      entry.play_addr?.url_list?.[0] ||
      (typeof entry.playAddr === "string" ? entry.playAddr : null);
    if (typeof direct === "string" && direct) candidates.push(direct);
  }

  for (const candidate of candidates) {
    const cleaned = unescapeTikTokUrl(candidate);
    if (cleaned) return cleaned;
  }

  return null;
}

function normalizeUsername(raw) {
  return String(raw || "").trim().replace(/^@/, "");
}

function extractMetaFromItem(item) {
  if (!item || typeof item !== "object") return null;

  const author = item.author && typeof item.author === "object" ? item.author : {};
  const username = normalizeUsername(author.uniqueId || author.username || "");
  const nickname = String(author.nickname || "").trim();
  const avatarUrl = unescapeTikTokUrl(
    author.avatarLarger || author.avatarMedium || author.avatarThumb || "",
  );
  const caption = String(item.desc || "").trim();

  const tags = [];
  const textExtra = Array.isArray(item.textExtra) ? item.textExtra : [];
  for (const entry of textExtra) {
    const tag = String(entry?.hashtagName || "").trim().replace(/^#/, "");
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  const challenges = Array.isArray(item.challenges) ? item.challenges : [];
  for (const entry of challenges) {
    const tag = String(entry?.title || "").trim().replace(/^#/, "");
    if (tag && !tags.includes(tag)) tags.push(tag);
  }

  const video = item.video && typeof item.video === "object" ? item.video : {};
  const playAddr = pickPlayAddr(video);
  const duration = Number(video.duration);
  const durationSeconds =
    Number.isFinite(duration) && duration > 0 ? duration : null;
  const thumbnailUrl =
    unescapeTikTokUrl(String(video.cover || video.originCover || "").trim()) ||
    null;

  return {
    username,
    nickname,
    avatarUrl: avatarUrl || null,
    caption,
    tags,
    playAddr,
    durationSeconds,
    thumbnailUrl,
  };
}

function parseTikTokPage(html, videoId) {
  const universal = extractUniversalData(html);
  const sigi = extractSigiState(html);
  const item = findItemStruct(universal, sigi, videoId);
  if (!item) return null;
  return extractMetaFromItem(item);
}

async function fetchTikTokPage(url) {
  const res = await fetch(url, {
    headers: buildTikTokHeaders(),
    redirect: "follow",
    signal: AbortSignal.timeout(TIKTOK_PAGE_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return res.text();
}

async function fetchTikTokOembed(url) {
  const res = await fetch(
    `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
    {
      headers: buildTikTokHeaders({ accept: "application/json" }),
      signal: AbortSignal.timeout(TIKTOK_OEMBED_TIMEOUT_MS),
    },
  );
  if (!res.ok) return null;
  try {
    const json = await res.json();
    const authorUrlMatch = String(json.author_url || "").match(
      /tiktok\.com\/@([^/?#]+)/i,
    );
    return {
      username: normalizeUsername(json.author_name || ""),
      handle: authorUrlMatch ? authorUrlMatch[1] : "",
      caption: String(json.title || "").trim(),
      thumbnailUrl: String(json.thumbnail_url || "").trim() || null,
    };
  } catch {
    return null;
  }
}

function extractHashtagsFromText(raw) {
  const text = String(raw || "");
  const tags = [];
  const matches = text.matchAll(/#([\p{L}\p{N}_]+)/gu);
  for (const match of matches) {
    const tag = match[1];
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

async function fetchTikTokUserInfo(username) {
  const clean = normalizeUsername(username);
  if (!clean) return null;

  // Try the share JSON endpoint first (returns avatarLarger directly).
  try {
    const res = await fetch(
      `https://www.tiktok.com/node/share/user/@${encodeURIComponent(clean)}`,
      {
        headers: buildTikTokHeaders({ accept: "application/json" }),
        redirect: "follow",
        signal: AbortSignal.timeout(TIKTOK_PAGE_TIMEOUT_MS),
      },
    );
    if (res.ok) {
      const data = await res.json();
      const user = data?.userInfo?.user;
      const avatarUrl = user
        ? unescapeTikTokUrl(
            String(
              user.avatarLarger || user.avatarMedium || user.avatarThumb || "",
            ),
          ) || null
        : null;
      if (avatarUrl) return { avatarUrl };
    }
  } catch {
    // fall through to the profile page scrape
  }

  // Fall back to the profile page's og:image meta tag.
  try {
    const res = await fetch(
      `https://www.tiktok.com/@${encodeURIComponent(clean)}`,
      {
        headers: buildTikTokHeaders(),
        redirect: "follow",
        signal: AbortSignal.timeout(TIKTOK_PAGE_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const html = await res.text();
    const match = String(html).match(
      /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i,
    );
    const avatarUrl = match
      ? unescapeTikTokUrl(match[1]) || null
      : null;
    return avatarUrl ? { avatarUrl } : null;
  } catch {
    return null;
  }
}

async function fetchTikTokMetadata(rawUrl) {
  const url = normalizeTikTokUrl(rawUrl);
  if (!url) return { error: "Invalid TikTok URL" };

  const videoId = extractTikTokVideoId(url);

  let scraped = null;
  let scrapeError = null;
  try {
    const html = await fetchTikTokPage(url);
    if (html) {
      scraped = parseTikTokPage(html, videoId);
      if (!scraped) scrapeError = "TikTok page did not contain video data";
    } else {
      scrapeError = "TikTok refused the page request";
    }
  } catch (err) {
    scrapeError =
      err?.name === "TimeoutError"
        ? "Timed out contacting TikTok"
        : "Could not reach TikTok";
  }

  let oembed = null;
  try {
    oembed = await fetchTikTokOembed(url);
  } catch {
    oembed = null;
  }

  if (!scraped && !oembed) {
    return { error: scrapeError || "Could not load TikTok video data" };
  }

  const handle = scraped?.username || oembed?.handle || "";
  const username =
    scraped?.nickname ||
    scraped?.username ||
    oembed?.username ||
    handle ||
    "";
  const caption = scraped?.caption || oembed?.caption || "";
  let avatarUrl = scraped?.avatarUrl || null;
  let tags = scraped?.tags || [];

  if (!avatarUrl || tags.length === 0) {
    const userInfo = await fetchTikTokUserInfo(handle || username);
    if (userInfo?.avatarUrl && !avatarUrl) avatarUrl = userInfo.avatarUrl;
  }
  if (tags.length === 0) {
    tags = extractHashtagsFromText(caption);
  }

  return {
    url: url.toString(),
    videoId,
    username,
    nickname: scraped?.nickname || "",
    avatarUrl,
    caption,
    tags,
    durationSeconds: scraped?.durationSeconds ?? null,
    playAddr: scraped?.playAddr || null,
    thumbnailUrl: scraped?.thumbnailUrl || oembed?.thumbnailUrl || null,
    scrapeError: scraped ? null : scrapeError,
  };
}

function readTikTokList() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TIKTOK_LIST_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeTikTokQueueEntry(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    const url = raw.trim();
    return url ? { url, tags: [] } : null;
  }
  if (typeof raw !== "object") return null;

  const url = String(raw.url || "").trim();
  if (!url) return null;

  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((tag) => String(tag || "").trim().replace(/^#/, ""))
        .filter(Boolean)
    : [];

  return {
    url,
    username: normalizeUsername(raw.username) || undefined,
    avatarUrl: String(raw.avatarUrl || "").trim() || undefined,
    caption: String(raw.caption || "").trim() || undefined,
    tags,
    thumbnailUrl: String(raw.thumbnailUrl || "").trim() || undefined,
    videoUrl: String(raw.videoUrl || "").trim() || undefined,
  };
}

module.exports = {
  TIKTOK_LIST_PATH,
  TIKTOK_COOKIES_FILE,
  buildTikTokHeaders,
  tikTokCookieFilePath,
  normalizeTikTokUrl,
  extractTikTokVideoId,
  parseTikTokPage,
  fetchTikTokMetadata,
  fetchTikTokOembed,
  fetchTikTokUserInfo,
  readTikTokList,
  normalizeTikTokQueueEntry,
};
