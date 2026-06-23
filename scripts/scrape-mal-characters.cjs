#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const SOURCE_URL = "https://myanimelist.net/character.php";
const PAGE_SIZE = 50;
const DEFAULT_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_OUT_FILE = path.resolve(
  __dirname,
  "..",
  "data",
    "mal-characters.json",
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv) {
  const options = {
    startLimit: 0,
    maxPages: Infinity,
    delayMs: DEFAULT_DELAY_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    outFile: DEFAULT_OUT_FILE,
    resume: true,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--resume") {
      options.resume = true;
      continue;
    }
    if (arg === "--no-resume") {
      options.resume = false;
      continue;
    }
    if (!arg.startsWith("--")) continue;

    const [key, rawValue = ""] = arg.slice(2).split("=", 2);
    if (key === "start" || key === "start-limit") {
      options.startLimit = parseNonNegativeInt(rawValue, options.startLimit);
    }
    if (key === "pages" || key === "max-pages") {
      options.maxPages = parsePositiveInt(rawValue, options.maxPages);
    }
    if (key === "delay") {
      options.delayMs = parseNonNegativeInt(rawValue, options.delayMs);
    }
    if (key === "timeout") {
      options.timeoutMs = parsePositiveInt(rawValue, options.timeoutMs);
    }
    if (key === "retries") {
      options.maxRetries = parsePositiveInt(rawValue, options.maxRetries);
    }
    if (key === "out") {
      options.outFile = path.resolve(process.cwd(), rawValue || options.outFile);
    }
  }

  if (options.startLimit % PAGE_SIZE !== 0) {
    throw new Error(`--start must be a multiple of ${PAGE_SIZE}.`);
  }

  return options;
}

function printHelp() {
  console.log(`Scrape characters from MyAnimeList's character ranking pages.

Usage:
  node scripts/scrape-mal-characters.cjs [options]

Options:
  --start=<limit>     Initial ?limit= value (default: 0)
  --pages=<count>     Stop after this many pages (default: all pages)
  --delay=<ms>        Delay between pages (default: ${DEFAULT_DELAY_MS})
  --timeout=<ms>      Request timeout (default: ${DEFAULT_TIMEOUT_MS})
  --retries=<count>   Retries for rate limits and temporary errors (default: ${DEFAULT_MAX_RETRIES})
  --out=<path>        Output JSON path (default: data/mal-characters.json)
  --resume            Continue from an existing output file (default)
  --no-resume         Start fresh and overwrite the output file
  --help, -h          Show this help

Examples:
  npm run scrape:mal:characters
  npm run scrape:mal:characters -- --pages=2 --no-resume
`);
}

function decodeHtml(value) {
  const namedEntities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return String(value || "").replace(
    /&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi,
    (entity, code) => {
      if (code[0] !== "#") {
        return namedEntities[code.toLowerCase()] ?? entity;
      }

      const hexadecimal = code[1]?.toLowerCase() === "x";
      const number = Number.parseInt(code.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (!Number.isFinite(number)) return entity;

      try {
        return String.fromCodePoint(number);
      } catch {
        return entity;
      }
    },
  );
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function parseAttributes(tag) {
  const attributes = {};
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;

  while ((match = pattern.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }

  return attributes;
}

function normalizeImageUrl(rawUrl) {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl, SOURCE_URL);
    url.pathname = url.pathname.replace(/^\/r\/\d+x\d+(?=\/images\/)/, "");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function findCharacterAnchor(rowHtml) {
  const anchorPattern = /(<a\b[^>]*>)([\s\S]*?)<\/a>/gi;
  let fallback = null;
  let match;

  while ((match = anchorPattern.exec(rowHtml)) !== null) {
    const attributes = parseAttributes(match[1]);
    const href = attributes.href || "";
    const characterMatch = href.match(
      /^https?:\/\/myanimelist\.net\/character\/(\d+)(?:\/[^?#"']*)?/i,
    );
    if (!characterMatch) continue;

    const candidate = {
      id: Number.parseInt(characterMatch[1], 10),
      name: stripTags(match[2]),
      url: href,
      classes: String(attributes.class || "").split(/\s+/),
    };

    if (candidate.classes.includes("fw-b") || candidate.classes.includes("fs14")) {
      return candidate;
    }
    fallback ??= candidate;
  }

  return fallback;
}

function findAnimeMangaEntries(rowHtml) {
  const entries = [];
  const anchorPattern = /(<a\b[^>]*>)([\s\S]*?)<\/a>/gi;
  let match;
  const seen = new Set();

  while ((match = anchorPattern.exec(rowHtml)) !== null) {
    const attributes = parseAttributes(match[1]);
    const href = (attributes.href || "").trim();
    if (!href) continue;

    const idMatch = href.match(
      /^https?:\/\/myanimelist\.net\/(anime|manga)\/(\d+)(?:\/[^?#"']*)?/i,
    );
    if (!idMatch) continue;

    const type = idMatch[1].toLowerCase();
    const id = Number.parseInt(idMatch[2], 10);
    const name = stripTags(match[2]);
    if (!name) continue;

    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({ name, url: href, type });
  }

  return entries;
}

function findImageUrl(rowHtml) {
  const imageTags = rowHtml.match(/<img\b[^>]*>/gi) || [];

  for (const tag of imageTags) {
    const attributes = parseAttributes(tag);
    const rawUrl = attributes["data-src"] || attributes.src;
    if (rawUrl) return normalizeImageUrl(rawUrl);
  }

  return null;
}

function findFavorites(rowHtml) {
  const match = rowHtml.match(
    /<td\b[^>]*class=["'][^"']*\bfavorites\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i,
  );
  if (!match) return null;

  const digits = stripTags(match[1]).replace(/[^\d]/g, "");
  return digits ? Number.parseInt(digits, 10) : 0;
}

function parseCharacters(html) {
  const characters = [];
  const rowPattern =
    /<tr\b[^>]*class=["'][^"']*\branking-list\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;
  let match;

  while ((match = rowPattern.exec(html)) !== null) {
    const rowHtml = match[1];
    const character = findCharacterAnchor(rowHtml);
    if (!character || !character.name) continue;

    characters.push({
      id: character.id,
      name: character.name,
      imageUrl: findImageUrl(rowHtml),
      favorites: findFavorites(rowHtml),
      url: character.url,
      appearances: findAnimeMangaEntries(rowHtml),
    });
  }

  return characters;
}

async function fetchPage(limit, options) {
  const url = `${SOURCE_URL}?limit=${limit}`;

  for (let attempt = 1; attempt <= options.maxRetries; attempt += 1) {
    try {
      const response = await axios.get(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/137.0 Safari/537.36",
        },
        responseType: "text",
        timeout: options.timeoutMs,
      });

      return { html: response.data, url };
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      const retryAfterSeconds = Number(error?.response?.headers?.["retry-after"]);
      const retryable =
        status === 429 ||
        status >= 500 ||
        error?.code === "ECONNABORTED" ||
        error?.code === "ETIMEDOUT" ||
        error?.code === "ECONNRESET";

      if (!retryable || attempt >= options.maxRetries) {
        throw new Error(`Could not fetch ${url}: ${error.message}`);
      }

      const waitMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : attempt * 2000;
      console.warn(
        `Request failed${status ? ` (${status})` : ""}; retrying in ${waitMs}ms...`,
      );
      await sleep(waitMs);
    }
  }

  throw new Error(`Could not fetch ${url}.`);
}

function createOutput(startLimit) {
  return {
    source: `${SOURCE_URL}?limit={limit}`,
    pageSize: PAGE_SIZE,
    startLimit,
    nextLimit: startLimit,
    complete: false,
    completionReason: null,
    generatedAt: new Date().toISOString(),
    characters: [],
  };
}

function loadOutput(options) {
  if (!options.resume || !fs.existsSync(options.outFile)) {
    return createOutput(options.startLimit);
  }

  const parsed = JSON.parse(fs.readFileSync(options.outFile, "utf8"));
  if (!parsed || !Array.isArray(parsed.characters)) {
    throw new Error(`Existing output is not a valid scraper file: ${options.outFile}`);
  }

  parsed.nextLimit = parseNonNegativeInt(parsed.nextLimit, options.startLimit);
  parsed.complete = Boolean(parsed.complete);
  parsed.completionReason =
    typeof parsed.completionReason === "string" ? parsed.completionReason : null;
  return parsed;
}

function saveOutput(filePath, output) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const output = loadOutput(options);
  if (
    options.resume &&
    output.complete &&
    ["empty-page", "short-page"].includes(output.completionReason)
  ) {
    console.log(`Nothing to do: ${options.outFile} is already marked complete.`);
    return;
  }

  const characterMap = new Map(
    output.characters
      .filter((character) => Number.isFinite(Number(character?.id)))
      .map((character) => [Number(character.id), character]),
  );
  let limit = options.resume ? output.nextLimit : options.startLimit;
  let pagesScraped = 0;

  console.log(`Scraping MyAnimeList characters from ?limit=${limit}...`);
  console.log(`Saving checkpoints to ${options.outFile}`);

  while (pagesScraped < options.maxPages) {
    const { html, url } = await fetchPage(limit, options);
    const pageCharacters = parseCharacters(html);

    if (pageCharacters.length === 0) {
      if (pagesScraped === 0 && characterMap.size === 0) {
        throw new Error(
          `No character rows found at ${url}. MyAnimeList may have changed its markup or blocked the request.`,
        );
      }

      output.complete = true;
      output.completionReason = "empty-page";
      output.generatedAt = new Date().toISOString();
      saveOutput(options.outFile, output);
      break;
    }

    let newCharacters = 0;
    for (const character of pageCharacters) {
      if (!characterMap.has(character.id)) newCharacters += 1;
      characterMap.set(character.id, character);
    }

    pagesScraped += 1;
    const nextLimit = limit + PAGE_SIZE;
    const shortPage = pageCharacters.length < PAGE_SIZE;

    output.characters = Array.from(characterMap.values());
    output.nextLimit = nextLimit;
    output.complete = shortPage;
    output.completionReason = shortPage ? "short-page" : null;
    output.generatedAt = new Date().toISOString();
    saveOutput(options.outFile, output);

    console.log(
      `?limit=${limit}: found ${pageCharacters.length}, added ${newCharacters}, total ${output.characters.length}`,
    );

    if (shortPage) break;

    limit = nextLimit;
    if (pagesScraped < options.maxPages && options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }

  console.log(
    `${output.complete ? "Done" : "Stopped after the requested page limit"}. ` +
      `Saved ${output.characters.length} characters to ${options.outFile}`,
  );
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exitCode = 1;
});