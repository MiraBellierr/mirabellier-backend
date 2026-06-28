const {
  nowIso, makeId, clamp, toInt, toPositiveInt,
  MARKET_MIN_PRICE, MARKET_MAX_PRICE, MARKET_MAX_ACTIVE_LISTINGS,
  MARKET_MAX_PAGE_SIZE, MARKET_IV_BANDS, getMarketIvBand,
  getCardShopPrice, RARITY_TO_RANK, CARD_IV_MAX, MARKET_SALES_SAMPLE_SIZE,
} = require("./utils");
const { normalizeSelectedCard, insertCollectionCard } = require("./cards");
const { ensureArenaProfile, getArenaProfilePayload } = require("./profile");
const { hasActiveFight } = require("./playback");
const { createArenaNotification } = require("./notifications");
const { ArenaHttpError } = require("./utils");
const { S2C } = require("../websocket-events");

// WS helper
function _wsEmit() { return require("../websocket-server").getWebSocketManager(); }


function getMarketPrice(db, malId, ivBand, rarity) {
  const rows = db
    .prepare(
      `SELECT price
       FROM arena_market_listings
       WHERE status = 'sold' AND malId = ? AND ivBand = ?
       ORDER BY soldAt DESC
       LIMIT ?`,
    )
    .all(toPositiveInt(malId, 0), ivBand, MARKET_SALES_SAMPLE_SIZE);

  if (rows.length > 0) {
    const total = rows.reduce((sum, row) => sum + toPositiveInt(row.price, 0), 0);
    return {
      value: Math.round(total / rows.length),
      source: "sales_average",
      sampleSize: rows.length,
    };
  }

  return {
    value: getCardShopPrice(rarity),
    source: "shop_baseline",
    sampleSize: 0,
  };
}

function getArenaMarketPriceGuide(db, userId, input = {}) {
  ensureArenaProfile(db, userId);
  const malId = toPositiveInt(input.malId, 0);
  const ivTotal = clamp(toPositiveInt(input.ivTotal, 0), 0, CARD_IV_MAX * 4);
  const rarity = String(input.rarity || "").trim().toUpperCase();
  if (!malId || !RARITY_TO_RANK.has(rarity)) {
    throw new ArenaHttpError(
      400,
      "Valid malId, ivTotal, and rarity are required.",
      "ARENA_MARKET_PRICE_GUIDE_INVALID",
    );
  }
  const ivBand = getMarketIvBand(ivTotal);
  return {
    malId,
    ivBand,
    marketPrice: getMarketPrice(db, malId, ivBand.id, rarity),
  };
}

function normalizeMarketListingRow(db, row, viewerUserId) {
  if (!row) return null;
  const card = normalizeSelectedCard(row.cardJson);
  if (!card) return null;

  return {
    listingId: row.id,
    seller: {
      userId: row.sellerUserId,
      username: row.sellerUsername || "Unknown player",
      avatar: row.sellerAvatar || null,
    },
    buyerUserId: row.buyerUserId || null,
    card,
    ivBand: row.ivBand,
    price: toPositiveInt(row.price, 0),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    soldAt: row.soldAt || null,
    cancelledAt: row.cancelledAt || null,
    isMine: Boolean(viewerUserId && row.sellerUserId === viewerUserId),
    marketPrice: getMarketPrice(db, row.malId, row.ivBand, row.rarity),
  };
}

function getMarketListingById(db, listingId, viewerUserId) {
  const row = db
    .prepare(
      `SELECT
         listing.*,
         seller.username AS sellerUsername,
         seller.avatar AS sellerAvatar
       FROM arena_market_listings listing
       LEFT JOIN users seller ON seller.id = listing.sellerUserId
       WHERE listing.id = ?
       LIMIT 1`,
    )
    .get(listingId);
  return normalizeMarketListingRow(db, row, viewerUserId);
}

function getArenaMarketListings(db, userId, options = {}) {
  ensureArenaProfile(db, userId);
  const page = Math.max(toPositiveInt(options.page, 1), 1);
  const limit = clamp(
    toPositiveInt(options.limit, 12) || 12,
    1,
    MARKET_MAX_PAGE_SIZE,
  );
  const clauses = ["listing.status = 'active'"];
  const params = [];
  const search = String(options.search || "").trim();
  const rarity = String(options.rarity || "").trim().toUpperCase();
  const ivBand = String(options.ivBand || "").trim();

  if (search) {
    clauses.push("listing.cardTitle LIKE ? COLLATE NOCASE");
    params.push(`%${search}%`);
  }
  if (RARITY_TO_RANK.has(rarity)) {
    clauses.push("listing.rarity = ?");
    params.push(rarity);
  }
  if (MARKET_IV_BANDS.some((band) => band.id === ivBand)) {
    clauses.push("listing.ivBand = ?");
    params.push(ivBand);
  }
  if (options.sellerUserId) {
    clauses.push("listing.sellerUserId = ?");
    params.push(String(options.sellerUserId));
  }

  const sortSql = {
    newest: "listing.createdAt DESC",
    "price-asc": "listing.price ASC, listing.createdAt DESC",
    "price-desc": "listing.price DESC, listing.createdAt DESC",
    "iv-asc": "listing.ivTotal ASC, listing.createdAt DESC",
    "iv-desc": "listing.ivTotal DESC, listing.createdAt DESC",
  }[String(options.sort || "newest")] || "listing.createdAt DESC";
  const whereSql = clauses.join(" AND ");
  const total = toPositiveInt(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM arena_market_listings listing
         WHERE ${whereSql}`,
      )
      .get(...params)?.count,
    0,
  );
  const rows = db
    .prepare(
      `SELECT
         listing.*,
         seller.username AS sellerUsername,
         seller.avatar AS sellerAvatar
       FROM arena_market_listings listing
       LEFT JOIN users seller ON seller.id = listing.sellerUserId
       WHERE ${whereSql}
       ORDER BY ${sortSql}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, (page - 1) * limit);

  return {
    profile: getArenaProfilePayload(db, userId),
    listings: rows
      .map((row) => normalizeMarketListingRow(db, row, userId))
      .filter(Boolean),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    ivBands: MARKET_IV_BANDS,
  };
}

function getMyArenaMarketListings(db, userId) {
  return getArenaMarketListings(db, userId, {
    sellerUserId: userId,
    page: 1,
    limit: MARKET_MAX_ACTIVE_LISTINGS,
    sort: "newest",
  });
}

function createArenaMarketListing(db, userId, input = {}) {
  const cardInstanceId = String(input.cardInstanceId || "").trim();
  const price = Number(input.price);
  if (!cardInstanceId) {
    throw new ArenaHttpError(
      400,
      "cardInstanceId is required.",
      "ARENA_CARD_INSTANCE_REQUIRED",
    );
  }
  if (
    !Number.isSafeInteger(price) ||
    price < MARKET_MIN_PRICE ||
    price > MARKET_MAX_PRICE
  ) {
    throw new ArenaHttpError(
      400,
      `Price must be a whole number from ${MARKET_MIN_PRICE} to ${MARKET_MAX_PRICE}.`,
      "ARENA_MARKET_PRICE_INVALID",
      { minPrice: MARKET_MIN_PRICE, maxPrice: MARKET_MAX_PRICE },
    );
  }

  const listingId = makeId("market");
  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    if (hasActiveFight(db, userId)) {
      throw new ArenaHttpError(
        409,
        "Finish your active fight before listing a card.",
        "ARENA_MARKET_FIGHT_ACTIVE",
      );
    }

    const activeCount = toPositiveInt(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM arena_market_listings
           WHERE sellerUserId = ? AND status = 'active'`,
        )
        .get(userId)?.count,
      0,
    );
    if (activeCount >= MARKET_MAX_ACTIVE_LISTINGS) {
      throw new ArenaHttpError(
        409,
        `You can have at most ${MARKET_MAX_ACTIVE_LISTINGS} active listings.`,
        "ARENA_MARKET_LISTING_LIMIT",
        { maxActiveListings: MARKET_MAX_ACTIVE_LISTINGS },
      );
    }

    const collectionRow = db
      .prepare(
        `SELECT cardJson
         FROM arena_card_collection
         WHERE userId = ? AND cardInstanceId = ?
         LIMIT 1`,
      )
      .get(userId, cardInstanceId);
    if (!collectionRow) {
      throw new ArenaHttpError(
        404,
        "Card not found in your collection.",
        "ARENA_COLLECTION_CARD_NOT_FOUND",
      );
    }
    const card = normalizeSelectedCard(collectionRow.cardJson);
    if (!card) {
      throw new ArenaHttpError(
        409,
        "Stored card data is invalid.",
        "ARENA_COLLECTION_CARD_INVALID",
      );
    }

    const ivTotal = clamp(toPositiveInt(card.iv?.total, 0), 0, CARD_IV_MAX * 4);
    const ivBand = getMarketIvBand(ivTotal).id;
    const now = nowIso();
    db.prepare(
      `INSERT INTO arena_market_listings (
        id, sellerUserId, buyerUserId, cardInstanceId, cardJson,
        cardTitle, malId, rarity, ivTotal, ivBand, price, status,
        createdAt, updatedAt, soldAt, cancelledAt
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL)`,
    ).run(
      listingId,
      userId,
      card.cardInstanceId,
      JSON.stringify(card),
      card.title,
      card.malId,
      card.rarity,
      ivTotal,
      ivBand,
      price,
      now,
      now,
    );

    const removed = db
      .prepare(
        `DELETE FROM arena_card_collection
         WHERE userId = ? AND cardInstanceId = ?`,
      )
      .run(userId, cardInstanceId);
    if (removed.changes !== 1) {
      throw new ArenaHttpError(
        409,
        "The card could not be moved into market escrow.",
        "ARENA_MARKET_ESCROW_FAILED",
      );
    }

    if (profile.selectedCard?.cardInstanceId === cardInstanceId) {
      db.prepare(
        `UPDATE arena_profiles
         SET selectedCardJson = NULL, updatedAt = ?
         WHERE userId = ?`,
      ).run(now, userId);
    }
  });

  tx();
  const w = _wsEmit();
  if (w) w.broadcast({ type: S2C.ARENA_MARKET_CHANGED, data: {} });
  return {
    listing: getMarketListingById(db, listingId, userId),
    profile: getArenaProfilePayload(db, userId),
  };
}

function cancelArenaMarketListing(db, userId, listingId) {
  const normalizedListingId = String(listingId || "").trim();
  const tx = db.transaction(() => {
    ensureArenaProfile(db, userId);
    const row = db
      .prepare(
        `SELECT *
         FROM arena_market_listings
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedListingId);
    if (!row) {
      throw new ArenaHttpError(
        404,
        "Market listing not found.",
        "ARENA_MARKET_LISTING_NOT_FOUND",
      );
    }
    if (row.sellerUserId !== userId) {
      throw new ArenaHttpError(
        403,
        "You can only cancel your own listings.",
        "ARENA_MARKET_NOT_SELLER",
      );
    }
    if (row.status !== "active") {
      throw new ArenaHttpError(
        409,
        "This listing is no longer active.",
        "ARENA_MARKET_LISTING_INACTIVE",
      );
    }

    const card = normalizeSelectedCard(row.cardJson);
    if (!card) {
      throw new ArenaHttpError(
        409,
        "Stored listing card data is invalid.",
        "ARENA_MARKET_CARD_INVALID",
      );
    }
    const now = nowIso();
    const updated = db
      .prepare(
        `UPDATE arena_market_listings
         SET status = 'cancelled', cancelledAt = ?, updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(now, now, normalizedListingId);
    if (updated.changes !== 1) {
      throw new ArenaHttpError(
        409,
        "This listing is no longer active.",
        "ARENA_MARKET_LISTING_INACTIVE",
      );
    }
    insertCollectionCard(db, userId, card);
  });

  tx();
  const w = _wsEmit();
  if (w) w.broadcast({ type: S2C.ARENA_MARKET_CHANGED, data: {} });
  return {
    listing: getMarketListingById(db, normalizedListingId, userId),
    profile: getArenaProfilePayload(db, userId),
  };
}

function buyArenaMarketListing(db, userId, listingId) {
  const normalizedListingId = String(listingId || "").trim();
  const tx = db.transaction(() => {
    const buyer = ensureArenaProfile(db, userId);
    const row = db
      .prepare(
        `SELECT *
         FROM arena_market_listings
         WHERE id = ?
         LIMIT 1`,
      )
      .get(normalizedListingId);
    if (!row) {
      throw new ArenaHttpError(
        404,
        "Market listing not found.",
        "ARENA_MARKET_LISTING_NOT_FOUND",
      );
    }
    if (row.status !== "active") {
      throw new ArenaHttpError(
        409,
        "This listing is no longer active.",
        "ARENA_MARKET_LISTING_INACTIVE",
      );
    }
    if (row.sellerUserId === userId) {
      throw new ArenaHttpError(
        409,
        "You cannot buy your own listing.",
        "ARENA_MARKET_SELF_PURCHASE",
      );
    }
    if (buyer.coins < row.price) {
      throw new ArenaHttpError(
        400,
        "Not enough coins.",
        "ARENA_NOT_ENOUGH_COINS",
        { requiredCoins: row.price },
      );
    }
    const duplicate = db
      .prepare(
        `SELECT id
         FROM arena_card_collection
         WHERE userId = ? AND cardInstanceId = ?
         LIMIT 1`,
      )
      .get(userId, row.cardInstanceId);
    if (duplicate) {
      throw new ArenaHttpError(
        409,
        "This card is already in your collection.",
        "ARENA_MARKET_CARD_DUPLICATE",
      );
    }
    const card = normalizeSelectedCard(row.cardJson);
    if (!card) {
      throw new ArenaHttpError(
        409,
        "Stored listing card data is invalid.",
        "ARENA_MARKET_CARD_INVALID",
      );
    }

    ensureArenaProfile(db, row.sellerUserId);
    const now = nowIso();
    const updated = db
      .prepare(
        `UPDATE arena_market_listings
         SET status = 'sold', buyerUserId = ?, soldAt = ?, updatedAt = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(userId, now, now, normalizedListingId);
    if (updated.changes !== 1) {
      throw new ArenaHttpError(
        409,
        "This listing is no longer active.",
        "ARENA_MARKET_LISTING_INACTIVE",
      );
    }
    db.prepare(
      `UPDATE arena_profiles
       SET coins = coins - ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(row.price, now, userId);
    db.prepare(
      `UPDATE arena_profiles
       SET coins = coins + ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(row.price, now, row.sellerUserId);
    insertCollectionCard(db, userId, card);

    const buyerUser = db.prepare("SELECT username FROM users WHERE id = ?").get(userId);
    const buyerName = buyerUser?.username || "Someone";
    createArenaNotification(
      db,
      row.sellerUserId,
      "market_sold",
      "Your card was bought",
      `${buyerName} bought ${row.cardTitle} (${row.rarity}) for ${row.price.toLocaleString()} coins.`,
      "/arena/market",
    );
  });

  tx();
  const w = _wsEmit();
  if (w) w.broadcast({ type: S2C.ARENA_MARKET_CHANGED, data: {} });
  return {
    listing: getMarketListingById(db, normalizedListingId, userId),
    profile: getArenaProfilePayload(db, userId),
  };
}

module.exports = {
  getMarketPrice,
  getArenaMarketPriceGuide,
  normalizeMarketListingRow,
  getMarketListingById,
  getArenaMarketListings,
  getMyArenaMarketListings,
  createArenaMarketListing,
  cancelArenaMarketListing,
  buyArenaMarketListing,
};
