#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const JIKAN_API_BASE = (process.env.JIKAN_API_BASE || "https://api.jikan.moe/v4").replace(
  /\/$/,
  "",
);
const DEFAULT_START_ID = 1;
const DEFAULT_END_ID = 44000;
const DEFAULT_DELAY_MS = 250;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_FLUSH_EVERY = 100;
const DEFAULT_MAX_RETRIES = 4;
const PROGRESS_BAR_WIDTH = 24;
const PROGRESS_TICK_MS = 120;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseArgs(argv) {
  const defaults = {
    startId: DEFAULT_START_ID,
    endId: DEFAULT_END_ID,
    delayMs: DEFAULT_DELAY_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    flushEvery: DEFAULT_FLUSH_EVERY,
    maxRetries: DEFAULT_MAX_RETRIES,
    outFile: path.resolve(__dirname, "..", "data", "jikan-characters.json"),
    resume: true,
    help: false,
  };

  const options = { ...defaults };

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

    const [key, rawValue] = arg.slice(2).split("=", 2);
    const value = rawValue ?? "";

    if (key === "start") options.startId = parsePositiveInt(value, options.startId);
    if (key === "end") options.endId = parsePositiveInt(value, options.endId);
    if (key === "delay") options.delayMs = parseNonNegativeInt(value, options.delayMs);
    if (key === "timeout") options.timeoutMs = parsePositiveInt(value, options.timeoutMs);
    if (key === "flush-every") {
      options.flushEvery = parsePositiveInt(value, options.flushEvery);
    }
    if (key === "retries") options.maxRetries = parsePositiveInt(value, options.maxRetries);
    if (key === "out") {
      options.outFile = path.resolve(process.cwd(), value || options.outFile);
    }
  }

  if (options.endId < options.startId) {
    throw new Error(`Invalid range: end (${options.endId}) is less than start (${options.startId}).`);
  }

  return options;
}

function printHelp() {
  console.log(`Fetch character image URLs and favorites from Jikan.

Usage:
  node scripts/fetch-jikan-characters.cjs [options]

Options:
  --start=<id>        Start character ID (default: ${DEFAULT_START_ID})
  --end=<id>          End character ID (default: ${DEFAULT_END_ID})
  --delay=<ms>        Delay between requests (default: ${DEFAULT_DELAY_MS})
  --timeout=<ms>      Request timeout (default: ${DEFAULT_TIMEOUT_MS})
  --flush-every=<n>   Save JSON every N IDs (default: ${DEFAULT_FLUSH_EVERY})
  --retries=<n>       Retries for 429/5xx/timeout (default: ${DEFAULT_MAX_RETRIES})
  --out=<path>        Output JSON path
  --resume            Resume from existing output file (default)
  --no-resume         Start fresh and overwrite output file
  --help, -h          Show this help
`);
}

function getImageUrl(character) {
  return (
    character?.image?.webp?.image_url ||
    character?.images?.jpg?.large_image_url ||
    character?.images?.jpg?.image_url ||
    character?.images?.webp?.large_image_url ||
    character?.images?.webp?.image_url ||
    null
  );
}

function normalizeCharacter(character, fallbackId) {
  const malId = Number(character?.mal_id);
  const id = Number.isFinite(malId) && malId > 0 ? Math.trunc(malId) : fallbackId;
  const favorites = Number(character?.favorites);

  return {
    id,
    name: typeof character?.name === "string" ? character.name.trim() : "",
    imageUrl: getImageUrl(character),
    favorites: Number.isFinite(favorites) && favorites >= 0 ? Math.trunc(favorites) : null,
    url:
      typeof character?.url === "string" && character.url
        ? character.url
        : `https://myanimelist.net/character/${id}`,
  };
}

async function fetchCharacterById(id, options) {
  const url = `${JIKAN_API_BASE}/characters/${id}`;

  for (let attempt = 1; attempt <= options.maxRetries; attempt += 1) {
    try {
      const response = await axios.get(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mirabellier Jikan Export/1.0 (+https://mirabellier.com)",
        },
        timeout: options.timeoutMs,
      });

      const character = response?.data?.data;
      if (!character || typeof character !== "object") {
        return { kind: "missing" };
      }
      return { kind: "ok", data: normalizeCharacter(character, id) };
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      const retryAfterSec = Number(error?.response?.headers?.["retry-after"]);
      const isNotFound = status === 404 || status === 400;
      if (isNotFound) {
        return { kind: "missing" };
      }

      const isRetryable =
        status === 429 ||
        status >= 500 ||
        error?.code === "ECONNABORTED" ||
        error?.code === "ETIMEDOUT";

      if (!isRetryable || attempt >= options.maxRetries) {
        return {
          kind: "failed",
          status: status || null,
          message: error?.message || "Unknown request error",
        };
      }

      const backoffMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : 1000 * attempt;
      await sleep(backoffMs);
    }
  }

  return { kind: "failed", status: null, message: "Retry loop exhausted unexpectedly" };
}

function ensureOutputDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function saveOutput(filePath, payload) {
  ensureOutputDir(filePath);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function createEmptyOutput(startId, endId) {
  return {
    source: `${JIKAN_API_BASE}/characters/{id}`,
    startId,
    endId,
    lastProcessedId: startId - 1,
    generatedAt: nowIso(),
    stats: {
      processed: 0,
      found: 0,
      missing: 0,
      failed: 0,
    },
    failures: [],
    characters: [],
  };
}

function loadOutput(filePath, options) {
  if (!options.resume || !fs.existsSync(filePath)) {
    return createEmptyOutput(options.startId, options.endId);
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return createEmptyOutput(options.startId, options.endId);
    }

    if (!Array.isArray(parsed.characters)) parsed.characters = [];
    if (!parsed.stats || typeof parsed.stats !== "object") {
      parsed.stats = { processed: 0, found: 0, missing: 0, failed: 0 };
    }
    if (!Array.isArray(parsed.failures)) parsed.failures = [];

    parsed.startId = parsePositiveInt(parsed.startId, options.startId);
    parsed.endId = parsePositiveInt(parsed.endId, options.endId);
    parsed.lastProcessedId = parseNonNegativeInt(
      parsed.lastProcessedId,
      parsed.startId - 1,
    );
    return parsed;
  } catch {
    return createEmptyOutput(options.startId, options.endId);
  }
}

function rebuildStats(output) {
  const found = Array.isArray(output.characters) ? output.characters.length : 0;
  const failed = Array.isArray(output.failures) ? output.failures.length : 0;
  const processed = Math.max(
    0,
    Number(output.lastProcessedId) - Number(output.startId) + 1,
  );
  const missing = Math.max(0, processed - found - failed);

  output.stats = { processed, found, missing, failed };
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function normalizeConsoleText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value, maxLength) {
  const normalized = normalizeConsoleText(value);
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 1) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, maxLength - 1)}~`;
}

function buildProgressBar(percent, width = PROGRESS_BAR_WIDTH) {
  const clamped = Math.min(Math.max(Number(percent) || 0, 0), 100);
  const filled = Math.round((clamped / 100) * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function createProgressConsole() {
  const interactive = Boolean(process.stdout && process.stdout.isTTY);
  const spinnerFrames = ["|", "/", "-", "\\"];
  let spinnerIndex = 0;
  let lastLineLength = 0;
  let lastRenderAt = 0;
  let lastSnapshot = null;

  function fitToTerminal(line) {
    const columns = Number(process.stdout?.columns || 0);
    if (!columns || line.length <= columns - 1) return line;
    if (columns <= 8) return line.slice(0, columns);
    return `${line.slice(0, columns - 2)}~`;
  }

  function writeInteractiveLine(line) {
    const fitted = fitToTerminal(line);
    const padding = Math.max(0, lastLineLength - fitted.length);
    process.stdout.write(`\r${fitted}${" ".repeat(padding)}`);
    lastLineLength = fitted.length;
  }

  function clearInteractiveLine() {
    if (!interactive || lastLineLength <= 0) return;
    process.stdout.write(`\r${" ".repeat(lastLineLength)}\r`);
    lastLineLength = 0;
  }

  function render(snapshot, force = false) {
    lastSnapshot = snapshot;
    if (!interactive) return;

    const now = Date.now();
    if (!force && now - lastRenderAt < PROGRESS_TICK_MS) return;
    lastRenderAt = now;

    spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
    const spinner = spinnerFrames[spinnerIndex];
    const percent =
      snapshot.total > 0 ? (snapshot.processed / snapshot.total) * 100 : 100;
    const rate = snapshot.elapsedSec > 0 ? snapshot.processed / snapshot.elapsedSec : 0;

    const line =
      `${spinner} ${buildProgressBar(percent)} ${percent.toFixed(1)}% ` +
      `run ${formatNumber(snapshot.processed)}/${formatNumber(snapshot.total)} ` +
      `id=${formatNumber(snapshot.currentId)} ` +
      `found=${formatNumber(snapshot.found)} ` +
      `missing=${formatNumber(snapshot.missing)} ` +
      `failed=${formatNumber(snapshot.failed)} ` +
      `rate=${rate.toFixed(2)}/s ` +
      `eta=${formatDuration(snapshot.etaSec)} ` +
      `elapsed=${formatDuration(snapshot.elapsedSec)} ` +
      `name="${truncateText(snapshot.currentName || snapshot.currentStatus || "n/a", 32)}" ` +
      `fav=${snapshot.currentFavorites === null ? "-" : formatNumber(snapshot.currentFavorites)}`;

    writeInteractiveLine(line);
  }

  function info(message) {
    if (interactive) {
      clearInteractiveLine();
      console.log(message);
      if (lastSnapshot) {
        render(lastSnapshot, true);
      }
      return;
    }

    console.log(message);
  }

  function finish(snapshot) {
    render(snapshot, true);
    if (interactive) {
      process.stdout.write("\n");
    }
  }

  return {
    render,
    info,
    finish,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const output = loadOutput(options.outFile, options);
  output.startId = options.startId;
  output.endId = options.endId;

  const characterMap = new Map();
  for (const entry of output.characters) {
    const id = Number(entry?.id);
    if (Number.isFinite(id) && id > 0) {
      characterMap.set(Math.trunc(id), entry);
    }
  }

  let startAt = options.startId;
  if (options.resume) {
    const resumeFrom = parseNonNegativeInt(output.lastProcessedId, options.startId - 1) + 1;
    startAt = Math.max(options.startId, resumeFrom);
  }

  if (startAt > options.endId) {
    rebuildStats(output);
    output.generatedAt = nowIso();
    saveOutput(options.outFile, output);
    console.log(`Nothing to do. Output already covers ${options.startId}..${options.endId}.`);
    console.log(`Saved: ${options.outFile}`);
    return;
  }

  const progressConsole = createProgressConsole();
  const runTotal = options.endId - startAt + 1;
  const runStartedAtMs = Date.now();

  progressConsole.info("Fetching Jikan characters...");
  progressConsole.info(`Range: ${startAt} -> ${options.endId}`);
  progressConsole.info(
    `Delay: ${options.delayMs}ms | Flush every: ${options.flushEvery} IDs`,
  );
  progressConsole.info(`Output: ${options.outFile}`);

  let sinceFlush = 0;
  let runProcessed = 0;
  let lastCharacterMeta = {
    status: "starting",
    name: null,
    favorites: null,
  };

  function makeProgressSnapshot(currentId) {
    const elapsedSec = (Date.now() - runStartedAtMs) / 1000;
    const rate = elapsedSec > 0 ? runProcessed / elapsedSec : 0;
    const remaining = Math.max(0, runTotal - runProcessed);
    const etaSec = rate > 0 ? remaining / rate : Infinity;
    const found = characterMap.size;
    const failed = output.failures.length;
    const processedOverall = Math.max(0, output.lastProcessedId - options.startId + 1);
    const missing = Math.max(0, processedOverall - found - failed);

    return {
      currentId,
      processed: runProcessed,
      total: runTotal,
      found,
      missing,
      failed,
      elapsedSec,
      etaSec,
      currentStatus: lastCharacterMeta.status,
      currentName: lastCharacterMeta.name,
      currentFavorites: lastCharacterMeta.favorites,
    };
  }

  for (let id = startAt; id <= options.endId; id += 1) {
    const result = await fetchCharacterById(id, options);

    if (result.kind === "ok") {
      characterMap.set(result.data.id, result.data);
      lastCharacterMeta = {
        status: "ok",
        name: result.data.name,
        favorites: result.data.favorites,
      };
    } else if (result.kind === "missing") {
      lastCharacterMeta = {
        status: "missing",
        name: null,
        favorites: null,
      };
    } else if (result.kind === "failed") {
      output.failures.push({
        id,
        status: result.status,
        message: result.message,
      });
      lastCharacterMeta = {
        status: "failed",
        name: null,
        favorites: null,
      };
      if (output.failures.length > 5000) {
        output.failures = output.failures.slice(output.failures.length - 5000);
      }
    }

    output.lastProcessedId = id;
    sinceFlush += 1;
    runProcessed += 1;
    progressConsole.render(makeProgressSnapshot(id));

    if (sinceFlush >= options.flushEvery || id === options.endId) {
      output.characters = Array.from(characterMap.values()).sort((a, b) => a.id - b.id);
      rebuildStats(output);
      output.generatedAt = nowIso();
      saveOutput(options.outFile, output);
      sinceFlush = 0;

      progressConsole.info(
        `Checkpoint saved at ID ${id}: processed=${formatNumber(output.stats.processed)} found=${formatNumber(output.stats.found)} missing=${formatNumber(output.stats.missing)} failed=${formatNumber(output.stats.failed)}`,
      );
    }

    if (id < options.endId && options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }

  const finalSnapshot = makeProgressSnapshot(options.endId);
  progressConsole.finish(finalSnapshot);
  console.log("Done.");
  console.log(
    `Final: processed=${output.stats.processed} found=${output.stats.found} missing=${output.stats.missing} failed=${output.stats.failed}`,
  );
  console.log(`Saved: ${options.outFile}`);
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
