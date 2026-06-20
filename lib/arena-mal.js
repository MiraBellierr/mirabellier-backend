const axios = require("axios");

const JIKAN_API_BASE = (process.env.JIKAN_API_BASE || "https://api.jikan.moe/v4").replace(
  /\/$/,
  "",
);
const JIKAN_HEALTH_PATH = process.env.JIKAN_HEALTH_PATH || "/health";
const SOURCE_TIMEOUT_MS = 15000;
const MAX_SOURCE_RETRIES = 3;
const CHARACTER_ID_MIN = 1;
const CHARACTER_ID_MAX = 44196;
const MAX_RANDOM_ID_ATTEMPTS = 10;

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value), min), max);
}

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function readCharacterImage(node) {
  if (typeof node?.images?.jpg?.large_image_url === "string") {
    return node.images.jpg.large_image_url.trim();
  }
  if (typeof node?.images?.jpg?.image_url === "string") {
    return node.images.jpg.image_url.trim();
  }
  if (typeof node?.images?.webp?.large_image_url === "string") {
    return node.images.webp.large_image_url.trim();
  }
  if (typeof node?.images?.webp?.image_url === "string") {
    return node.images.webp.image_url.trim();
  }
  return "";
}

function inferCharacterMeanScore(favorites) {
  const fav = Number(favorites);
  if (!Number.isFinite(fav) || fav <= 0) {
    return null;
  }
  const inferred = 6 + Math.log10(fav + 1) / 1.25;
  return Number(clamp(inferred, 6, 10).toFixed(2));
}

function normalizeCharacterNode(node) {
  const malId = Number(node?.mal_id);
  const title = normalizeString(node?.name);
  const imageUrl = readCharacterImage(node);
  const rank = Number(node?.rank);
  const favorites = Number(node?.favorites);

  if (!Number.isFinite(malId) || malId <= 0) return null;
  if (!title || !imageUrl) return null;

  const popularity = Number.isFinite(rank) && rank > 0 ? Math.trunc(rank) : null;
  const favoritesCount =
    Number.isFinite(favorites) && favorites >= 0 ? Math.trunc(favorites) : null;

  return {
    malId: Math.trunc(malId),
    title,
    url: `https://myanimelist.net/character/${Math.trunc(malId)}`,
    imageUrl,
    meanScore: inferCharacterMeanScore(favorites),
    popularity,
    favorites: favoritesCount,
    nsfw: "unknown",
  };
}

function randomCharacterId(randomFn = Math.random) {
  return (
    Math.floor(randomFn() * (CHARACTER_ID_MAX - CHARACTER_ID_MIN + 1)) +
    CHARACTER_ID_MIN
  );
}

function makeRateLimitError(error) {
  const mapped = new Error(
    "Arena character source is rate-limited right now. Please try again shortly.",
  );
  mapped.code = "MAL_SOURCE_RATE_LIMIT";
  const retryAfterSec = Number(error?.response?.headers?.["retry-after"]);
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    mapped.retryAfterMs = retryAfterSec * 1000;
  }
  return mapped;
}

async function fetchJikanPage(path, params) {
  for (let attempt = 0; attempt < MAX_SOURCE_RETRIES; attempt += 1) {
    try {
      return await axios.get(`${JIKAN_API_BASE}${path}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mirabellier Arena/1.0 (+https://mirabellier.com)",
        },
        params,
        timeout: SOURCE_TIMEOUT_MS,
      });
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      const retryAfterSec = Number(error?.response?.headers?.["retry-after"]);
      const shouldRetry =
        status === 429 ||
        status >= 500 ||
        error?.code === "ECONNABORTED" ||
        error?.code === "ETIMEDOUT";

      if (!shouldRetry || attempt >= MAX_SOURCE_RETRIES - 1) {
        throw error;
      }

      const waitMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : (attempt + 1) * 1200;
      await sleep(waitMs);
    }
  }

  throw new Error("Jikan request failed unexpectedly.");
}

async function checkJikanHealth() {
  return axios.get(`${JIKAN_API_BASE}${JIKAN_HEALTH_PATH}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mirabellier Arena/1.0 (+https://mirabellier.com)",
    },
    timeout: SOURCE_TIMEOUT_MS,
    validateStatus: () => true,
  });
}

async function fetchRandomCharacterCard(randomFn = Math.random) {
  for (let attempt = 0; attempt < MAX_RANDOM_ID_ATTEMPTS; attempt += 1) {
    const characterId = randomCharacterId(randomFn);

    try {
      const response = await fetchJikanPage(`/characters/${characterId}`, {});
      const normalized = normalizeCharacterNode(response?.data?.data);
      if (normalized) {
        return normalized;
      }
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if (status === 429) {
        throw makeRateLimitError(error);
      }
      if (status === 404 || status === 400) {
        continue;
      }
    }
  }

  const error = new Error(
    "Character source returned no entries with usable images for Arena draw.",
  );
  error.code = "MAL_POOL_EMPTY";
  throw error;
}

function readPoolMeta(db) {
  const row = db
    .prepare(
      `SELECT fetchedAt, COUNT(*) AS count
       FROM arena_mal_card_pool
       GROUP BY fetchedAt
       ORDER BY fetchedAt DESC
       LIMIT 1`,
    )
    .get();

  if (!row) {
    return {
      fetchedAt: null,
      count: 0,
    };
  }

  return {
    fetchedAt: row.fetchedAt || null,
    count: Number(row.count) || 0,
  };
}

function isPoolFresh(meta) {
  return Boolean(meta && meta.count > 0);
}

function pickRandomArenaCard(db) {
  return db
    .prepare(
      `SELECT malId, title, url, imageUrl, meanScore, popularity, favorites, nsfw
       FROM arena_mal_card_pool
       ORDER BY RANDOM()
       LIMIT 1`,
    )
    .get();
}

function mapDbCardRow(card) {
  if (!card) return null;
  return {
    malId: Number(card.malId),
    title: card.title,
    url: card.url,
    imageUrl: card.imageUrl,
    meanScore:
      card.meanScore === null || card.meanScore === undefined
        ? null
        : Number(card.meanScore),
    popularity:
      card.popularity === null || card.popularity === undefined
        ? null
        : toInt(card.popularity, null),
    favorites:
      card.favorites === null || card.favorites === undefined
        ? null
        : toInt(card.favorites, null),
    nsfw: card.nsfw,
  };
}

async function refreshArenaCardPool(db) {
  const meta = readPoolMeta(db);
  return {
    fetchedAt: meta.fetchedAt || nowIso(),
    count: meta.count,
    stale: false,
  };
}

async function ensureArenaCardPool(db) {
  const meta = readPoolMeta(db);
  return {
    fetchedAt: meta.fetchedAt,
    count: meta.count,
    stale: false,
    source: "random_character_id",
  };
}

async function drawArenaCard(db) {
  const preferDbPool = db && db.name === ":memory:";
  if (preferDbPool) {
    const pooled = mapDbCardRow(pickRandomArenaCard(db));
    if (pooled) return pooled;
  }

  try {
    return await fetchRandomCharacterCard();
  } catch (error) {
    if (error?.code === "MAL_SOURCE_RATE_LIMIT") {
      throw error;
    }

    const pooled = mapDbCardRow(pickRandomArenaCard(db));
    if (pooled) return pooled;

    if (Number(error?.response?.status || 0) === 429) {
      throw makeRateLimitError(error);
    }

    const empty = new Error("Arena character card source is currently unavailable.");
    empty.code = "MAL_POOL_EMPTY";
    throw empty;
  }
}

async function fetchArenaPoolCandidates() {
  return [];
}

module.exports = {
  checkJikanHealth,
  drawArenaCard,
  ensureArenaCardPool,
  fetchArenaPoolCandidates,
  isPoolFresh,
  normalizeCharacterNode,
  refreshArenaCardPool,
};

