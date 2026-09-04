const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

const AVATAR_CACHE_FILE =
  process.env.AVATAR_CACHE_FILE ||
  path.join(__dirname, "..", "data", "avatar-cache.json");
const AVATAR_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function readAvatarCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(AVATAR_CACHE_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAvatarCache(cache) {
  try {
    fs.writeFileSync(AVATAR_CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {
    // Cache is best-effort — never block resolution on it.
  }
}

function cachedAvatarUrl(platform, username) {
  const clean = String(username || "").trim();
  if (!clean) return null;
  const cache = readAvatarCache();
  const entry = cache[`${platform}:${clean.toLowerCase()}`];
  if (!entry?.url) return null;
  if (Date.now() - Number(entry.updatedAt || 0) > AVATAR_CACHE_MAX_AGE_MS) {
    return null;
  }
  return entry.url;
}

function rememberAvatarUrl(platform, username, avatarUrl) {
  const clean = String(username || "").trim();
  const url = String(avatarUrl || "").trim();
  if (!clean || !/^https?:\/\//i.test(url)) return;
  const key = `${platform}:${clean.toLowerCase()}`;
  const cache = readAvatarCache();
  cache[key] = { url, updatedAt: Date.now() };
  writeAvatarCache(cache);
}

const {
  buildTikTokHeaders,
  fetchTikTokMetadata,
  fetchTikTokUserInfo,
  tikTokCookieFilePath,
} = require("./tiktok");
const {
  cookieHeaderForHost,
  cookieFilePathIfExists,
} = require("./netscape-cookies");

const INSTAGRAM_COOKIES_FILE =
  process.env.INSTAGRAM_COOKIES_FILE ||
  path.join(__dirname, "..", "data", "instagram-cookies.txt");

const YOUTUBE_COOKIES_FILE =
  process.env.YOUTUBE_COOKIES_FILE ||
  path.join(__dirname, "..", "data", "youtube-cookies.txt");

const SOCIAL_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const YTDLP_BINARY =
  String(process.env.YTDLP_PATH || "yt-dlp").trim() || "yt-dlp";

// When the bgutil POT provider plugin is installed next to yt-dlp it talks to
// the provider's default address (http://127.0.0.1:4416). Set this only if you
// run the provider elsewhere (see scripts/setup-youtube-pot-provider.sh).
const YOUTUBE_POT_BASE_URL = String(
  process.env.YOUTUBE_POT_BASE_URL || "",
).trim();

const YOUTUBE_WALL_PATTERNS = [
  /confirm you(?:'|\u2019)re not a bot/i,
  /the page needs to be reloaded/i,
];

const YOUTUBE_WALL_HINT =
  "YouTube refused the request from the server's IP (bot check). " +
  "Run scripts/setup-youtube-pot-provider.sh on the server, make sure " +
  "data/youtube-cookies.txt is a fresh export from a LOGGED-IN YouTube " +
  "account (a logged-out session is still rejected), and keep yt-dlp up to " +
  "date — or download the video manually and upload the file instead.";

function isYouTubeWallMessage(message) {
  return YOUTUBE_WALL_PATTERNS.some((pattern) => pattern.test(String(message || "")));
}

function annotateYouTubeWallError(err) {
  if (!err || err.code !== "YTDLP_FAILED") return err;
  if (!isYouTubeWallMessage(err.message)) return err;
  const annotated = new Error(YOUTUBE_WALL_HINT);
  annotated.code = "YOUTUBE_WALL";
  return annotated;
}

// yt-dlp >= 2025.05.22 auto-uses an installed POT provider plugin; only a
// non-default provider address needs an explicit extractor argument.
function youTubePotExtractorArgs() {
  if (!YOUTUBE_POT_BASE_URL) return [];
  return [
    "--extractor-args",
    `youtubepot-bgutilhttp:base_url=${YOUTUBE_POT_BASE_URL}`,
  ];
}

function instagramCookiesFilePath() {
  return cookieFilePathIfExists(INSTAGRAM_COOKIES_FILE);
}

function youtubeCookiesFilePath() {
  return cookieFilePathIfExists(YOUTUBE_COOKIES_FILE);
}

function instagramCookieHeader() {
  return cookieHeaderForHost(INSTAGRAM_COOKIES_FILE, "instagram.com");
}

function parseMaxImportBytes() {
  const rawMb = Number.parseInt(
    String(process.env.VIDEO_IMPORT_MAX_MB || "200"),
    10,
  );
  const mb = Number.isFinite(rawMb) ? rawMb : 200;
  return mb * 1024 * 1024;
}

const MAX_IMPORT_BYTES = parseMaxImportBytes();
const DOWNLOAD_TIMEOUT_MS = 600000;
const STREAM_TIMEOUT_MS = 180000;
const METADATA_TIMEOUT_MS = 8000;
const PROFILE_TIMEOUT_MS = 6000;

function classifyPlatform(rawUrl) {
  let parsed = null;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (
    hostname === "tiktok.com" ||
    hostname.endsWith(".tiktok.com")
  ) {
    return "tiktok";
  }
  if (
    hostname === "instagram.com" ||
    hostname === "instagr.am" ||
    hostname.endsWith(".instagram.com")
  ) {
    return "instagram";
  }
  if (
    hostname === "youtube.com" ||
    hostname === "youtu.be" ||
    hostname === "youtube-nocookie.com" ||
    hostname.endsWith(".youtube.com")
  ) {
    return "youtube";
  }
  return null;
}

function canonicalizeYouTubeUrl(rawUrl) {
  let parsed = null;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (parsed.hostname.toLowerCase() === "youtu.be") {
    const shortId = parsed.pathname.split("/").filter(Boolean)[0];
    if (shortId) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(shortId)}`;
    }
  }

  if (parsed.hostname.toLowerCase().endsWith("youtube.com")) {
    if (parsed.pathname === "/watch") {
      const watchId = parsed.searchParams.get("v");
      if (watchId) return parsed.toString();
    }
    const match = String(parsed.pathname || "").match(
      /^\/(?:shorts|embed|live|v)\/([\w-]+)/,
    );
    if (match) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(match[1])}`;
    }
  }

  return parsed.toString();
}

function canonicalizeInstagramUrl(rawUrl) {
  let parsed = null;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (parsed.hostname.toLowerCase() === "instagr.am") {
    parsed.hostname = "instagram.com";
  }
  return parsed.toString();
}

function stripAt(raw) {
  return String(raw || "").trim().replace(/^@+/, "");
}

function extractHashtags(raw) {
  const text = String(raw || "");
  const tags = [];
  const matches = text.matchAll(/#([\p{L}\p{N}_]+)/gu);
  for (const match of matches) {
    const tag = match[1];
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function stripHashtags(raw) {
  return String(raw || "")
    .replace(/(?:^|\s)#[\p{L}\p{N}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mimeTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4" || ext === ".m4v" || ext === ".mov") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".ogv") return "video/ogg";
  if (ext === ".mkv") return "video/x-matroska";
  return "application/octet-stream";
}

function parseOembedUrl(platform, json) {
  const authorUrl = String(json?.author_url || "");
  if (platform === "youtube") {
    const match = authorUrl.match(/youtube\.com\/(@[^/?#]+)/i);
    return match ? stripAt(match[1]) : "";
  }
  if (platform === "instagram") {
    const match = authorUrl.match(/instagram\.com\/([^/?#]+)/i);
    return match ? match[1] : "";
  }
  return "";
}

async function fetchOembed(platform, url) {
  let target = null;
  if (platform === "youtube") {
    target = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  } else if (platform === "instagram") {
    target = `https://www.instagram.com/api/v1/oembed?url=${encodeURIComponent(url)}`;
  }
  if (!target) return null;

  const headers = {
    "user-agent": SOCIAL_USER_AGENT,
    accept: "application/json",
  };
  const igCookie = platform === "instagram" ? instagramCookieHeader() : "";
  if (igCookie) headers.cookie = igCookie;

  let res = null;
  try {
    res = await fetch(target, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function runYtDlp(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP_BINARY,
      args,
      {
        maxBuffer: 4 * 1024 * 1024,
        timeout: options.timeout,
        killSignal: "SIGKILL",
        windowsHide: true,
        cwd: options.cwd,
      },
      (error, stdout) => {
        if (error) {
          const detail = String(error.stderr || error.message || "").trim();
          const lastLine =
            detail.split("\n").filter(Boolean).pop() || "";
          if (error.code === "ENOENT") {
            const err = new Error(
              "yt-dlp is not installed on the server — install it to import Instagram or YouTube videos, or upload the file manually",
            );
            err.code = "YTDLP_MISSING";
            reject(err);
            return;
          }
          if (error.killed) {
            const err = new Error("Timed out downloading the video");
            err.code = "YTDLP_TIMEOUT";
            reject(err);
            return;
          }
          const err = new Error(
            String(lastLine)
              .replace(/^ERROR:\s*/i, "")
              .replace(/^yt-dlp:\s*/i, "")
              .trim() || "The video downloader failed",
          );
          err.code = "YTDLP_FAILED";
          reject(err);
          return;
        }
        resolve(String(stdout || ""));
      },
    );
  });
}

function buildPlatformYtDlpCookieArgs(platform) {
  if (platform === "tiktok") {
    const cookiesFilePath = tikTokCookieFilePath();
    if (cookiesFilePath) return ["--cookies", cookiesFilePath];
    const ttwid = String(process.env.TIKTOK_TTWID || "").trim();
    if (ttwid) return ["--add-header", `Cookie: ttwid=${ttwid}`];
    return [];
  }
  if (platform === "instagram") {
    const cookiesFilePath = instagramCookiesFilePath();
    if (cookiesFilePath) return ["--cookies", cookiesFilePath];
    return [];
  }
  if (platform === "youtube") {
    const cookiesFilePath = youtubeCookiesFilePath();
    if (cookiesFilePath) return ["--cookies", cookiesFilePath];
    return [];
  }
  return [];
}

function extractOwnerAvatarFromPages(dir) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(
      (name) => name.endsWith(".dump") || name.endsWith(".json"),
    );
  } catch {
    return null;
  }
  for (const name of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      const candidates = [];
      const collectUser = (user) => {
        if (!user || typeof user !== "object") return;
        if (user.profile_pic_url || user.profile_pic_url_hd) {
          candidates.push(user.profile_pic_url_hd || user.profile_pic_url);
        }
      };
      if (Array.isArray(parsed.items)) {
        for (const item of parsed.items) {
          collectUser(item?.user);
        }
      }
      collectUser(parsed.user);
      for (const candidate of candidates) {
        const url = unescapeJsonUrl(candidate).trim();
        if (url.startsWith("https://")) return url;
      }
    } catch {
      // Keep scanning other page files.
    }
  }
  return null;
}

async function fetchYtDlpInfo(url, options = {}) {
  const platform = options.platform;
  let pagesDir = null;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const args = ["--no-playlist", "--no-warn", "--socket-timeout", "15"];
    if (platform) {
      args.push(...buildPlatformYtDlpCookieArgs(platform));
    }
    if (platform === "youtube") {
      args.push(...youTubePotExtractorArgs());
    }
    let runOptions = {};
    if (platform === "instagram") {
      pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "igpages-"));
      args.push("--write-pages");
      runOptions = { cwd: pagesDir };
    }
    args.push("--skip-download", "--dump-single-json", url);
    try {
      const stdout = await runYtDlp(args, runOptions);
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = null;
      }
      const ownerAvatarUrl = pagesDir
        ? extractOwnerAvatarFromPages(pagesDir)
        : null;
      return { json, ownerAvatarUrl };
    } catch (err) {
      let caught = err;
      if (platform === "youtube") {
        caught = annotateYouTubeWallError(err);
      }
      lastError = caught;
      // Social platforms rate limit in bursts — one retry usually clears it.
      if (attempt === 0 && (caught.code === "YTDLP_FAILED" || caught.code === "YTDLP_TIMEOUT")) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      return { json: null, ownerAvatarUrl: null, error: caught };
    } finally {
      if (pagesDir) {
        fs.rmSync(pagesDir, { recursive: true, force: true });
      }
    }
  }
  return { json: null, ownerAvatarUrl: null, error: lastError };
}

function mapYtDlpInfo(info, platform) {
  if (!info || typeof info !== "object") return null;

  let username = "";
  if (platform === "instagram") {
    // yt-dlp puts the numeric user id in uploader_id, the handle in
    // channel, and the display name in uploader — prefer a clean handle.
    const candidates = [info.channel, info.uploader, info.uploader_id];
    username =
      candidates.map((value) => stripAt(value)).find((value) =>
        /^[A-Za-z0-9._]{1,30}$/.test(value),
      ) || "";
  } else if (platform === "youtube") {
    username = stripAt(info.uploader || info.channel || info.uploader_id);
  }

  const caption =
    platform === "youtube"
      ? String(info.title || info.description || "").trim()
      : String(info.description || info.title || "").trim();

  const tags = extractHashtags(caption);
  const explicitTags = Array.isArray(info.tags) ? info.tags : [];
  for (const tag of explicitTags) {
    const clean = stripAt(tag).trim();
    if (clean && !tags.includes(clean)) tags.push(clean);
  }

  const duration = Number(info.duration);
  const durationSeconds =
    Number.isFinite(duration) && duration > 0 ? duration : null;

  return {
    username,
    avatarUrl: null,
    caption,
    hashtags: tags,
    durationSeconds,
    coverUrl: String(info.thumbnail || "").trim() || null,
    channelUrl: String(info.channel_url || "").trim() || "",
  };
}

function unescapeJsonUrl(raw) {
  return String(raw || "")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u0025/gi, "%")
    .replace(/\\\//g, "/");
}

async function validateImageUrl(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": SOCIAL_USER_AGENT,
        accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        range: "bytes=0-1023",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    await res.arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

async function fetchOgImageUrl(pageUrl, headers = {}, options = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(pageUrl, {
        headers: {
          "user-agent": SOCIAL_USER_AGENT,
          "accept-language": "en-US,en;q=0.9",
          accept: "text/html,application/xhtml+xml",
          ...headers,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Transient per-session rate limits: retry once after a pause.
        if (res.status === 429 || res.status === 401) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }
        return null;
      }
      const html = await res.text();
      const url = extractProfileImageUrl(html);
      if (url) {
        // YouTube rotates/expires its yt3 avatar URLs quickly — only return
        // links that actually serve bytes right now.
        if (!options.validate || (await validateImageUrl(url))) {
          return url;
        }
      }
      // A short body with no image data usually means a login/error shell.
      if (html.length < 100000) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }
      return null;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  return null;
}

function extractProfileImageUrl(html) {
  const candidates = [];
  const ogMatch = String(html).match(
    /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i,
  );
  if (ogMatch) candidates.push(ogMatch[1]);
  for (const pattern of [
    /"profile_pic_url_hd"\s*:\s*"([^"]+)"/i,
    /"profile_pic_url"\s*:\s*"([^"]+)"/i,
    /"hd_profile_pic_url_info"\s*:\s*\{[^}]*?"url"\s*:\s*"([^"]+)"/i,
    /"profilePicUrl"\s*:\s*"([^"]+)"/i,
  ]) {
    const match = String(html).match(pattern);
    if (match) candidates.push(match[1]);
  }
  for (const candidate of candidates) {
    const url = unescapeJsonUrl(candidate)
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .trim();
    if (url.startsWith("https://")) return url;
  }
  return null;
}

async function enrichAvatarUrl({ platform, username, channelUrl, headers, validate }) {
  const cleanUsername = String(username || "").trim();
  const candidates = [];
  if (channelUrl && /^https:\/\//i.test(channelUrl)) {
    candidates.push(channelUrl);
  }
  if (cleanUsername) {
    if (platform === "tiktok") {
      candidates.push(
        `https://www.tiktok.com/@${encodeURIComponent(cleanUsername)}`,
      );
    } else if (platform === "youtube") {
      candidates.push(
        `https://www.youtube.com/@${encodeURIComponent(cleanUsername)}`,
      );
    } else if (platform === "instagram") {
      candidates.push(
        `https://www.instagram.com/${encodeURIComponent(cleanUsername)}/`,
      );
    }
  }
  for (const candidate of candidates) {
    const avatarUrl = await fetchOgImageUrl(candidate, headers, { validate });
    if (avatarUrl) return avatarUrl;
  }
  return null;
}

async function resolveIndirectPlatform(platform, rawUrl) {
  const label = platform === "youtube" ? "YouTube" : "Instagram";
  const canonicalUrl =
    platform === "youtube"
      ? canonicalizeYouTubeUrl(rawUrl)
      : canonicalizeInstagramUrl(rawUrl);

  const oembed = await fetchOembed(platform, canonicalUrl);
  const oembedAuthorUrl = String(oembed?.author_url || "");
  const oembedUsername = parseOembedUrl(platform, oembed);
  const oembedName =
    typeof oembed?.author_name === "string"
      ? stripAt(oembed.author_name)
      : "";
  const igProfileHeaders =
    platform === "instagram" && instagramCookieHeader()
      ? { cookie: instagramCookieHeader() }
      : undefined;

  const ytDlpResult = await fetchYtDlpInfo(canonicalUrl, { platform });
  const downloaderError = ytDlpResult.error;
  const info = mapYtDlpInfo(ytDlpResult.json, platform);

  if (!info && !oembed) {
    if (downloaderError?.code === "YTDLP_MISSING") {
      throw new Error(
        `${label} blocked the metadata lookup, and yt-dlp is not installed on the server — install it or upload the file manually`,
      );
    }
    const noCookiesHint =
      platform === "instagram" && !instagramCookiesFilePath()
        ? " Instagram login-walls anonymous requests — log in at instagram.com in a browser, export cookies to data/instagram-cookies.txt, and try again."
        : platform === "youtube" && !youtubeCookiesFilePath()
          ? " YouTube login-walls some requests from server IPs — log in at youtube.com in a browser, export cookies to data/youtube-cookies.txt, and try again."
          : "";
    throw new Error(
      `${label} did not share video details for that link.${noCookiesHint}`,
    );
  }

  const ytDlpUsername = stripAt(info?.username || "");

  const username =
    platform === "instagram"
      ? ytDlpUsername || oembedUsername || oembedName
      : oembedUsername || ytDlpUsername || oembedName;

  const caption = String(
    (info?.caption || oembed?.title || "").trim(),
  );

  const hashtags = Array.isArray(info?.hashtags)
    ? info.hashtags
    : extractHashtags(caption);

  // Instagram's web profile pages return the logged-in session user's own
  // home for ANY handle, so the author avatar must come from the media
  // owner block that yt-dlp captures (authoritative). YouTube avatars come
  // from the channel page og:image (validated — yt3 URLs rotate quickly).
  let avatarUrl =
    platform === "instagram"
      ? ytDlpResult.ownerAvatarUrl
      : await enrichAvatarUrl({
          platform,
          username: username || oembedName,
          channelUrl: info?.channelUrl || oembedAuthorUrl,
          validate: true,
        });

  if (!avatarUrl && platform === "instagram") {
    // Last resort: the profile page — but only trust it when the page
    // actually belongs to the expected author, never the session home.
    avatarUrl = await fetchInstagramAuthorProfileImage(
      username || oembedName,
      igProfileHeaders,
    );
  }

  return {
    platform,
    username,
    avatarUrl,
    caption,
    hashtags,
    durationSeconds: info?.durationSeconds ?? null,
    coverUrl:
      String(info?.coverUrl || oembed?.thumbnail_url || "").trim() || null,
  };
}

async function fetchInstagramAuthorProfileImage(username, headers) {
  const clean = String(username || "").trim();
  if (!clean) return null;
  const pageUrl = `https://www.instagram.com/${encodeURIComponent(clean)}/`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(pageUrl, {
        headers: {
          "user-agent": SOCIAL_USER_AGENT,
          "accept-language": "en-US,en;q=0.9",
          accept: "text/html,application/xhtml+xml",
          ...(headers || {}),
        },
        redirect: "follow",
        signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
      });
      if (!res.ok) {
        if ((res.status === 429 || res.status === 401) && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }
        return null;
      }
      const html = await res.text();
      // The page must belong to the expected author — Instagram serves the
      // session user's own home for any handle otherwise.
      const expectedKey = `"username":"${clean.toLowerCase()}"`;
      if (!String(html).toLowerCase().includes(expectedKey)) return null;
      const url = extractProfileImageUrl(html);
      return url || null;
    } catch {
      return null;
    }
  }
  return null;
}

function unsupportedUrlError() {
  const err = new Error(
    "Unsupported URL — paste a TikTok, Instagram reel, or YouTube Shorts link",
  );
  err.code = "UNSUPPORTED_URL";
  return err;
}

async function resolveTikTokViaYtDlp(rawUrl) {
  const result = await fetchYtDlpInfo(rawUrl, { platform: "tiktok" });
  const info = result.json;
  if (!info || typeof info !== "object") return null;

  const handle = stripAt(info.uploader || info.channel || "");
  const nickname = String(info.channel || info.uploader || "").trim();
  const caption = String(info.title || info.description || "").trim();
  const duration = Number(info.duration);
  const durationSeconds =
    Number.isFinite(duration) && duration > 0 ? duration : null;

  // Avatar resolution is handled by resolveTikTokAvatarPersistently — the
  // scrape can succeed while the profile fetch is still throttled.
  return {
    username: nickname || handle,
    avatarUrl: null,
    avatarUsernames: Array.from(
      new Set([handle, nickname].map((v) => String(v || "").trim()).filter(Boolean)),
    ),
    caption,
    tags: extractHashtags(caption),
    durationSeconds,
    thumbnailUrl: String(info.thumbnail || "").trim() || null,
    playAddr: null,
  };
}

const TIKTOK_AVATAR_RETRY_TOTAL_MS = 60000;
const TIKTOK_AVATAR_RETRY_GAP_MS = 4000;

async function tryTikTokAvatarSources(usernames) {
  for (const username of usernames) {
    try {
      const userInfo = await fetchTikTokUserInfo(username);
      if (userInfo?.avatarUrl) return userInfo.avatarUrl;
    } catch {
      // try the next alias / source
    }
  }
  for (const username of usernames) {
    const ogAvatar = await enrichAvatarUrl({
      platform: "tiktok",
      username,
    });
    if (ogAvatar) return ogAvatar;
  }
  return null;
}

async function resolveTikTokAvatarPersistently(usernames) {
  const unique = Array.from(
    new Set(
      (Array.isArray(usernames) ? usernames : [usernames])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  if (unique.length === 0) return null;

  const startedAt = Date.now();
  for (;;) {
    const cached = cachedAvatarUrl("tiktok", unique[0]);
    if (cached) return cached;

    const found = await tryTikTokAvatarSources(unique);
    if (found) return found;

    if (Date.now() - startedAt + TIKTOK_AVATAR_RETRY_GAP_MS >= TIKTOK_AVATAR_RETRY_TOTAL_MS) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, TIKTOK_AVATAR_RETRY_GAP_MS));
  }
  return cachedAvatarUrl("tiktok", unique[0]);
}

async function resolveSocialVideo(rawUrl) {
  const platform = classifyPlatform(rawUrl);
  if (!platform) throw unsupportedUrlError();

  let resolved = null;
  if (platform === "tiktok") {
    let avatarUsernames = [];
    const metadata = await fetchTikTokMetadata(rawUrl);
    if (metadata.error) {
      const fallback = await resolveTikTokViaYtDlp(rawUrl);
      if (fallback) {
        resolved = {
          platform,
          username: fallback.username || "",
          avatarUrl: fallback.avatarUrl || null,
          caption: fallback.caption || "",
          hashtags: fallback.tags || [],
          durationSeconds: fallback.durationSeconds ?? null,
          coverUrl: fallback.thumbnailUrl || null,
          playAddr: fallback.playAddr || null,
        };
        avatarUsernames = fallback.avatarUsernames || [];
      } else {
        const err = new Error(metadata.error);
        err.code = "REMOTE_REFUSED";
        throw err;
      }
    } else {
      resolved = {
        platform,
        username: metadata.username || "",
        avatarUrl: metadata.avatarUrl || null,
        caption: metadata.caption || "",
        hashtags: metadata.tags || [],
        durationSeconds: metadata.durationSeconds ?? null,
        coverUrl: metadata.thumbnailUrl || null,
        playAddr: metadata.playAddr || null,
      };

      // A scrape that only landed on oEmbed details (no playAddr, avatar,
      // or duration) means TikTok blocked the full page — enrich it via the
      // yt-dlp fallback which negotiates the challenge.
      if (!metadata.playAddr && (!metadata.avatarUrl || !metadata.durationSeconds)) {
        const fallback = await resolveTikTokViaYtDlp(rawUrl);
        if (fallback) {
          resolved.username = fallback.username || resolved.username;
          resolved.caption = fallback.caption || resolved.caption;
          resolved.hashtags =
            fallback.tags.length > 0
              ? fallback.tags
              : resolved.hashtags;
          resolved.durationSeconds =
            fallback.durationSeconds ?? resolved.durationSeconds;
          resolved.coverUrl = fallback.thumbnailUrl || resolved.coverUrl;
          avatarUsernames = fallback.avatarUsernames || [];
        }
      }
    }

    resolved.caption = stripHashtags(resolved.caption);
    if (!resolved.avatarUrl) {
      // Keep trying the avatar until TikTok stops throttling us.
      resolved.avatarUrl = await resolveTikTokAvatarPersistently(
        avatarUsernames.length > 0 ? avatarUsernames : [resolved.username],
      );
    }
  } else {
    resolved = await resolveIndirectPlatform(platform, rawUrl);
    resolved.caption = stripHashtags(resolved.caption);
  }

  if (resolved.avatarUrl) {
    rememberAvatarUrl(platform, resolved.username, resolved.avatarUrl);
  } else {
    // TikTok/Instagram block scrapes in waves — reuse a previously resolved
    // avatar for the same creator instead of leaving the field empty.
    resolved.avatarUrl = cachedAvatarUrl(platform, resolved.username);
  }
  return resolved;
}

async function streamUrlToFile(fileUrl, destPath) {
  let res = null;
  try {
    res = await fetch(fileUrl, {
      headers: buildTikTokHeaders({
        referer: "https://www.tiktok.com/",
        accept: "*/*",
      }),
      redirect: "follow",
      signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
    });
  } catch {
    throw new Error("TikTok refused the video download");
  }
  if (!res.ok || !res.body) {
    throw new Error(`TikTok refused the video download (HTTP ${res.status})`);
  }

  const output = fs.createWriteStream(destPath);
  let sizeBytes = 0;

  const settled = new Promise((resolve, reject) => {
    output.on("finish", resolve);
    output.on("error", reject);
  });

  try {
    for await (const chunk of res.body) {
      sizeBytes += chunk.length;
      if (sizeBytes > MAX_IMPORT_BYTES) {
        const err = new Error(
          `The downloaded video exceeds the ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB import limit`,
        );
        err.code = "TOO_LARGE";
        throw err;
      }
      if (!output.write(chunk)) {
        await new Promise((resolve) => output.once("drain", resolve));
      }
    }
    output.end();
    await settled;
  } catch (err) {
    output.destroy();
    await fs.promises.unlink(destPath).catch(() => {});
    throw err;
  }
  return sizeBytes;
}

const FORMAT_FALLBACKS = [
  "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b[height<=1080]/b/best",
  "bv*[height<=1080]+ba/b[height<=1080]/b/best",
  "best[height<=1080]/best",
  "b[height<=1080]/b",
  "b",
  "best",
];

function isFormatSelectionError(err) {
  const message = String(err?.message || "");
  return /requested format is not available|no matching format|format.*not available|merg.*ffmpeg|ffmpeg.*not installed/i.test(
    message,
  );
}

async function downloadWithYtDlp(url, destBase, options = {}) {
  const outTemplate = `${destBase}.%(ext)s`;

  const baseArgs = [
    "--no-playlist",
    "--no-warn",
    "--no-progress",
    "--no-part",
  ];
  if (options.platform) {
    baseArgs.push(...buildPlatformYtDlpCookieArgs(options.platform));
  }
  if (options.platform === "youtube") {
    baseArgs.push(...youTubePotExtractorArgs());
  }

  // YouTube bot-walls sometimes clear seconds after they appear (fresh cookie
  // export, POT provider warming up) — give the whole format pass one retry.
  const MAX_DOWNLOAD_PASSES = 2;
  let lastError = null;
  for (let pass = 0; pass < MAX_DOWNLOAD_PASSES; pass += 1) {
    for (let i = 0; i < FORMAT_FALLBACKS.length; i += 1) {
      const args = [
        ...baseArgs,
        "-f",
        FORMAT_FALLBACKS[i],
        "-o",
        outTemplate,
        url,
      ];
      try {
        await runYtDlp(args, { timeout: DOWNLOAD_TIMEOUT_MS });
        lastError = null;
        break;
      } catch (err) {
        let caught = err;
        if (options.platform === "youtube") {
          caught = annotateYouTubeWallError(err);
        }
        lastError = caught;
        const wallRetry =
          caught.code === "YOUTUBE_WALL" && pass < MAX_DOWNLOAD_PASSES - 1;
        const canRetry =
          isFormatSelectionError(caught) && i < FORMAT_FALLBACKS.length - 1;
        if (!canRetry) {
          if (wallRetry) break; // stop this pass; retry the whole pass below
          throw caught;
        }
      }
    }
    if (!lastError) break;
    if (lastError.code === "YOUTUBE_WALL" && pass < MAX_DOWNLOAD_PASSES - 1) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      continue;
    }
    throw lastError;
  }

  const dir = path.dirname(destBase);
  const base = path.basename(destBase);
  const entries = await fs.promises.readdir(dir);
  const matches = entries
    .filter(
      (name) =>
        name.startsWith(`${base}.`) &&
        !name.includes(".part") &&
        !name.endsWith(".ytdl"),
    )
    .sort((a, b) => {
      return (
        fs.statSync(path.join(dir, b)).mtimeMs -
        fs.statSync(path.join(dir, a)).mtimeMs
      );
    });

  if (matches.length === 0) {
    throw new Error("The video downloader produced no file");
  }

  const filePath = path.join(dir, matches[0]);
  const sizeBytes = fs.statSync(filePath).size;
  if (sizeBytes > MAX_IMPORT_BYTES) {
    await fs.promises.unlink(filePath).catch(() => {});
    const err = new Error(
      `The downloaded video exceeds the ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB import limit`,
    );
    err.code = "TOO_LARGE";
    throw err;
  }

  return {
    filePath,
    sizeBytes,
    mimeType: mimeTypeForFile(filePath),
  };
}

function cookiesFilePathHint() {
  if (tikTokCookieFilePath()) {
    return "Your TikTok cookies file may be stale — re-export it from a logged-in browser session (TIKTOK_COOKIES_FILE), or download the video manually.";
  }
  const ttwid = String(process.env.TIKTOK_TTWID || "").trim();
  return ttwid
    ? "A full logged-in cookie export usually fixes this: log in at tiktok.com in a browser, export cookies (e.g. with a cookies.txt extension) to data/tiktok-cookies.txt or set TIKTOK_COOKIES_FILE, then try again. You can also download the video manually."
    : "Log in at tiktok.com in a browser, export cookies (e.g. with a cookies.txt extension) to data/tiktok-cookies.txt or set TIKTOK_COOKIES_FILE, and try again. You can also download the video manually.";
}

async function downloadSocialVideo(rawUrl, destBase, options = {}) {
  const platform = classifyPlatform(rawUrl);
  if (!platform) throw unsupportedUrlError();

  const metadata =
    options.metadata && options.metadata.platform === platform
      ? options.metadata
      : null;

  if (platform === "tiktok") {
    let directError = null;
    if (metadata?.playAddr) {
      try {
        const sizeBytes = await streamUrlToFile(
          metadata.playAddr,
          `${destBase}.mp4`,
        );
        return {
          filePath: `${destBase}.mp4`,
          sizeBytes,
          mimeType: "video/mp4",
        };
      } catch (err) {
        directError = err instanceof Error ? err.message : String(err);
      }
    }
    try {
      return await downloadWithYtDlp(rawUrl, destBase, {
        platform: "tiktok",
      });
    } catch (err) {
      if (err.code === "YTDLP_MISSING") {
        throw new Error(
          "TikTok refused the direct video download and yt-dlp is not installed on the server — install it or download the video manually",
        );
      }
      const detail = err instanceof Error ? err.message : String(err);
      const hint = cookiesFilePathHint();
      const wrapped = new Error(
        `TikTok blocked the automatic download (direct: ${
          directError || "no video URL found"
        }; yt-dlp: ${detail}). ${hint}`,
      );
      wrapped.code = err.code || "TIKTOK_BLOCKED";
      throw wrapped;
    }
  }

  return downloadWithYtDlp(rawUrl, destBase, { platform });
}

module.exports = {
  MAX_IMPORT_BYTES,
  classifyPlatform,
  canonicalizeYouTubeUrl,
  canonicalizeInstagramUrl,
  extractHashtags,
  stripHashtags,
  mimeTypeForFile,
  mapYtDlpInfo,
  resolveSocialVideo,
  downloadSocialVideo,
};
