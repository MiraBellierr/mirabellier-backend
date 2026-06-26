const path = require("path");
const Database = require("better-sqlite3");
const fs = require("fs");

const DB_FILE =
  process.env.DB_FILE || path.join(__dirname, "..", "database.sqlite3");

function ensureDbDirectoryExists(filePath) {
  const dbDir = path.dirname(filePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

function configurePragmas(db) {
  // Write-Ahead Logging for better concurrency
  db.pragma("journal_mode = WAL");
  // Faster writes with minimal risk
  db.pragma("synchronous = NORMAL");
  // 64MB cache
  db.pragma("cache_size = -64000");
  // Store temp tables in memory
  db.pragma("temp_store = MEMORY");
  // 256MB memory-mapped I/O
  db.pragma("mmap_size = 268435456");
}

function createBaseTables(db) {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    passwordHash TEXT,
    avatar TEXT,
    createdAt TEXT
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    userId TEXT
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    title TEXT,
    content TEXT,
    userId TEXT,
    author TEXT,
    shortDescription TEXT,
    thumbnail TEXT,
    likes TEXT,
    comments TEXT,
    createdAt TEXT,
    updatedAt TEXT
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS anime (
    id TEXT PRIMARY KEY,
    title TEXT,
    url TEXT,
    img TEXT,
    ord INTEGER
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS myanimelist_anime_snapshots (
    feedKey TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    fetchedAt TEXT NOT NULL,
    payloadJson TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS quote_snapshots (
    recordedDate TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    sourceType TEXT NOT NULL,
    displayDate TEXT,
    publishedAt TEXT,
    fetchedAt TEXT NOT NULL,
    fallbackReason TEXT,
    quotesJson TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS guestbook_entries (
    id TEXT PRIMARY KEY,
    userId TEXT,
    author TEXT NOT NULL,
    message TEXT NOT NULL,
    website TEXT,
    mood TEXT,
    x INTEGER,
    y INTEGER,
    createdAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS daily_questions (
    recordedDate TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    createdByUserId TEXT,
    lockedAt TEXT,
    archivedAt TEXT,
    discordNotifiedAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS daily_question_answers (
    id TEXT PRIMARY KEY,
    recordedDate TEXT NOT NULL,
    userId TEXT,
    guestName TEXT,
    identityType TEXT NOT NULL,
    identityKey TEXT NOT NULL,
    answer TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS shrine_pages (
    slug TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    excerpt TEXT,
    image TEXT,
    imageAlt TEXT,
    schemaType TEXT,
    aboutJson TEXT,
    keywordsJson TEXT,
    ctaLabel TEXT,
    priority TEXT,
    changefreq TEXT,
    payloadJson TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_profiles (
    userId TEXT PRIMARY KEY,
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    coins INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    winStreak INTEGER NOT NULL DEFAULT 0,
    hp INTEGER NOT NULL DEFAULT 120,
    power INTEGER NOT NULL DEFAULT 12,
    guard INTEGER NOT NULL DEFAULT 12,
    speed INTEGER NOT NULL DEFAULT 10,
    effectHit INTEGER NOT NULL DEFAULT 3,
    lifetimeCoinsEarned INTEGER NOT NULL DEFAULT 0,
    eloRating INTEGER NOT NULL DEFAULT 1000,
    eloMatches INTEGER NOT NULL DEFAULT 0,
    peakElo INTEGER NOT NULL DEFAULT 1000,
    selectedCardJson TEXT,
    lastCardDrawDate TEXT,
    dailyCardDrawCount INTEGER NOT NULL DEFAULT 0,
    catalogVersion TEXT NOT NULL DEFAULT 'v1',
    effectsJson TEXT,
    lastFightAt TEXT,
    dailyOpponentCount INTEGER NOT NULL DEFAULT 0,
    lastOpponentDate TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_inventory (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    itemId TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_equipment_pieces (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    slot TEXT NOT NULL,
    mainStatType TEXT NOT NULL,
    mainStatValue REAL NOT NULL,
    subStats TEXT NOT NULL,
    equipped INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_fights (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    opponentUserId TEXT,
    result TEXT NOT NULL,
    roundsJson TEXT NOT NULL,
    xpDelta INTEGER NOT NULL DEFAULT 0,
    coinDelta INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_card_collection (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    cardInstanceId TEXT NOT NULL,
    cardJson TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_daily_card_offers (
    offerId TEXT PRIMARY KEY,
    offerDate TEXT NOT NULL,
    slot INTEGER NOT NULL,
    malId INTEGER NOT NULL,
    cardJson TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_daily_card_purchases (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    offerId TEXT NOT NULL,
    offerDate TEXT NOT NULL,
    purchasedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_market_listings (
    id TEXT PRIMARY KEY,
    sellerUserId TEXT NOT NULL,
    buyerUserId TEXT,
    cardInstanceId TEXT NOT NULL,
    cardJson TEXT NOT NULL,
    cardTitle TEXT NOT NULL,
    malId INTEGER NOT NULL,
    rarity TEXT NOT NULL,
    ivTotal INTEGER NOT NULL,
    ivBand TEXT NOT NULL,
    price INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    soldAt TEXT,
    cancelledAt TEXT
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_updates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    createdByUserId TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_mal_card_pool (
    malId INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    imageUrl TEXT NOT NULL,
    meanScore REAL,
    popularity INTEGER,
    favorites INTEGER,
    nsfw TEXT,
    fetchedAt TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_active_fights (
    userId TEXT PRIMARY KEY,
    fightId TEXT NOT NULL,
    cursor INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'active',
    simulationJson TEXT NOT NULL,
    opponentJson TEXT NOT NULL,
    playerEffectsJson TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_skill_allocations (
    userId TEXT NOT NULL,
    nodeId TEXT NOT NULL,
    activatedAt TEXT NOT NULL,
    PRIMARY KEY (userId, nodeId)
  )`,
  ).run();

    db.prepare(
      `CREATE TABLE IF NOT EXISTS arena_trade_listings (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    cardInstanceId TEXT NOT NULL,
    cardJson TEXT NOT NULL,
    cardTitle TEXT NOT NULL,
    malId INTEGER NOT NULL,
    rarity TEXT NOT NULL,
    ivTotal INTEGER NOT NULL,
    element TEXT,
    wantedRarity TEXT,
    wantedElement TEXT,
    wantedCardJson TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    cancelledAt TEXT
  )`,
    ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_trade_requests (
    id TEXT PRIMARY KEY,
    askerId TEXT NOT NULL,
    responderId TEXT NOT NULL,
    listingId TEXT,
    askerCardInstanceId TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    respondedAt TEXT,
    cancelledAt TEXT
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_trade_sessions (
    id TEXT PRIMARY KEY,
    requestId TEXT NOT NULL,
    askerId TEXT NOT NULL,
    responderId TEXT NOT NULL,
    askerCardInstanceId TEXT,
    responderCardInstanceId TEXT,
    askerCardInstanceIdsJson TEXT,
    responderCardInstanceIdsJson TEXT,
    askerCoins INTEGER NOT NULL DEFAULT 0,
    responderCoins INTEGER NOT NULL DEFAULT 0,
    askerConfirmed INTEGER NOT NULL DEFAULT 0,
    responderConfirmed INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    completedAt TEXT
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_notifications (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    link TEXT,
    metadata TEXT,
    isRead INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS arena_hall_of_fame (
    id TEXT PRIMARY KEY,
    month TEXT NOT NULL,
    entriesJson TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  ).run();
}

function createTcgTables(db) {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS tcg_games (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'queue',
    currentTurn INTEGER NOT NULL DEFAULT 0,
    currentPlayerId TEXT,
    player1Id TEXT NOT NULL,
    player2Id TEXT NOT NULL,
    player1Score INTEGER NOT NULL DEFAULT 0,
    player2Score INTEGER NOT NULL DEFAULT 0,
    winnerId TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS tcg_game_state (
    gameId TEXT PRIMARY KEY,
    stateJson TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS tcg_matchmaking (
    userId TEXT PRIMARY KEY,
    joinedAt TEXT NOT NULL
  )`,
  ).run();
}

function ensureColumn(table, column, definition) {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    const found = info.some((row) => row.name === column);
    if (!found) {
      db.prepare(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
      ).run();
    }
  } catch {
    // Keep startup resilient if a migration step fails.
  }
}

function migrateLuckToEffectHit(db) {
  try {
    const info = db.prepare("PRAGMA table_info(arena_profiles)").all();
    const hasEffectHit = info.some((row) => row.name === "effectHit");
    const hasLuck = info.some((row) => row.name === "luck");
    if (hasEffectHit && hasLuck) {
      db.prepare("UPDATE arena_profiles SET effectHit = luck WHERE luck IS NOT NULL AND (effectHit = 3 OR effectHit IS NULL)").run();
    }
  } catch {
    // resilient
  }
}

function ensureColumns(db) {
  ensureColumn("posts", "shortDescription", "TEXT");
  ensureColumn("posts", "thumbnail", "TEXT");
  ensureColumn("posts", "tags", "TEXT");
  ensureColumn("posts", "likes", "TEXT");
  ensureColumn("posts", "comments", "TEXT");
  ensureColumn("posts", "updatedAt", "TEXT");

  ensureColumn("users", "bio", "TEXT");
  ensureColumn("users", "banner", "TEXT");
  ensureColumn("users", "location", "TEXT");
  ensureColumn("users", "website", "TEXT");
  ensureColumn("users", "discordId", "TEXT");

  ensureColumn("guestbook_entries", "x", "INTEGER");
  ensureColumn("guestbook_entries", "y", "INTEGER");

  ensureColumn("daily_questions", "lockedAt", "TEXT");
  ensureColumn("daily_questions", "archivedAt", "TEXT");
  ensureColumn("daily_questions", "discordNotifiedAt", "TEXT");

  ensureColumn("shrine_pages", "description", "TEXT");
  ensureColumn("shrine_pages", "excerpt", "TEXT");
  ensureColumn("shrine_pages", "image", "TEXT");
  ensureColumn("shrine_pages", "imageAlt", "TEXT");
  ensureColumn("shrine_pages", "schemaType", "TEXT");
  ensureColumn("shrine_pages", "aboutJson", "TEXT");
  ensureColumn("shrine_pages", "keywordsJson", "TEXT");
  ensureColumn("shrine_pages", "ctaLabel", "TEXT");
  ensureColumn("shrine_pages", "priority", "TEXT");
  ensureColumn("shrine_pages", "changefreq", "TEXT");
  ensureColumn("shrine_pages", "payloadJson", "TEXT");
  ensureColumn("shrine_pages", "updatedAt", "TEXT");

  ensureColumn("arena_trade_listings", "note", "TEXT");
  ensureColumn("arena_trade_listings", "wantedCardJson", "TEXT");
  ensureColumn("arena_notifications", "metadata", "TEXT");
  ensureColumn("arena_trade_requests", "listingId", "TEXT");

  ensureColumn("arena_trade_sessions", "askerCoins", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("arena_trade_sessions", "responderCoins", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("arena_trade_sessions", "askerCardInstanceIdsJson", "TEXT");
  ensureColumn("arena_trade_sessions", "responderCardInstanceIdsJson", "TEXT");

  ensureColumn("arena_profiles", "level", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("arena_profiles", "xp", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("arena_profiles", "coins", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("arena_profiles", "wins", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("arena_profiles", "losses", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("arena_profiles", "winStreak", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("arena_profiles", "hp", "INTEGER NOT NULL DEFAULT 120");
  ensureColumn("arena_profiles", "power", "INTEGER NOT NULL DEFAULT 12");
  ensureColumn("arena_profiles", "guard", "INTEGER NOT NULL DEFAULT 12");
  ensureColumn("arena_profiles", "speed", "INTEGER NOT NULL DEFAULT 10");
  ensureColumn("arena_profiles", "effectHit", "INTEGER NOT NULL DEFAULT 3");
  migrateLuckToEffectHit(db);
  ensureColumn(
    "arena_profiles",
    "lifetimeCoinsEarned",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn("arena_profiles", "eloRating", "INTEGER NOT NULL DEFAULT 1000");
  ensureColumn("arena_profiles", "eloMatches", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("arena_profiles", "peakElo", "INTEGER NOT NULL DEFAULT 1000");
  ensureColumn("arena_profiles", "selectedCardJson", "TEXT");
  ensureColumn("arena_profiles", "lastCardDrawDate", "TEXT");
  ensureColumn("arena_profiles", "dailyCardDrawCount", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("arena_profiles", "catalogVersion", "TEXT NOT NULL DEFAULT 'v1'");
  ensureColumn("arena_profiles", "effectsJson", "TEXT");
  ensureColumn("arena_profiles", "lastFightAt", "TEXT");
  ensureColumn("arena_profiles", "dailyOpponentCount", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("arena_profiles", "lastOpponentDate", "TEXT");
  ensureColumn("arena_profiles", "createdAt", "TEXT");
  ensureColumn("arena_profiles", "updatedAt", "TEXT");
  ensureColumn("arena_card_collection", "isFavorite", "INTEGER NOT NULL DEFAULT 0");

  ensureColumn("arena_mal_card_pool", "favorites", "INTEGER");
}

function createIndexes(db) {
  try {
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_posts_userId ON posts(userId)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_posts_createdAt ON posts(createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId)`,
    ).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_anime_ord ON anime(ord)`).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_myanimelist_anime_snapshots_fetchedAt ON myanimelist_anime_snapshots(fetchedAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_quote_snapshots_fetchedAt ON quote_snapshots(fetchedAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_guestbook_entries_createdAt ON guestbook_entries(createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_daily_questions_updatedAt ON daily_questions(updatedAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_daily_question_answers_recordedDate_createdAt ON daily_question_answers(recordedDate, createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_question_answers_identity ON daily_question_answers(recordedDate, identityType, identityKey)`,
    ).run();
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_shrine_pages_path ON shrine_pages(path)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_profiles_level ON arena_profiles(level DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_profiles_coins ON arena_profiles(coins DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_profiles_updatedAt ON arena_profiles(updatedAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_profiles_elo ON arena_profiles(eloRating DESC, eloMatches DESC, peakElo DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_inventory_userId ON arena_inventory(userId)`,
    ).run();
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_arena_inventory_user_item ON arena_inventory(userId, itemId)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_eq_pieces_user ON arena_equipment_pieces(userId)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_eq_pieces_equipped ON arena_equipment_pieces(userId, slot, equipped)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_skill_allocations_userId ON arena_skill_allocations(userId)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_fights_userId_createdAt ON arena_fights(userId, createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_card_collection_userId_createdAt ON arena_card_collection(userId, createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_arena_card_collection_user_card_instance ON arena_card_collection(userId, cardInstanceId)`,
    ).run();
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_arena_daily_card_offers_date_slot ON arena_daily_card_offers(offerDate, slot)`,
    ).run();
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_arena_daily_card_offers_date_malId ON arena_daily_card_offers(offerDate, malId)`,
    ).run();
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_arena_daily_card_purchases_user_offer ON arena_daily_card_purchases(userId, offerId)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_daily_card_purchases_user_date ON arena_daily_card_purchases(userId, offerDate)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_market_active_created ON arena_market_listings(status, createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_market_seller_status ON arena_market_listings(sellerUserId, status, createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_market_sales_average ON arena_market_listings(status, malId, ivBand, soldAt DESC)`,
    ).run();
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_arena_market_active_card ON arena_market_listings(cardInstanceId) WHERE status = 'active'`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_updates_createdAt ON arena_updates(createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_trade_listings_active_created ON arena_trade_listings(status, createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_trade_listings_user_status ON arena_trade_listings(userId, status, createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_arena_trade_listings_active_card ON arena_trade_listings(cardInstanceId) WHERE status = 'active'`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_trade_requests_responder ON arena_trade_requests(responderId, status, createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_trade_requests_asker ON arena_trade_requests(askerId, status, createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_trade_sessions_participants ON arena_trade_sessions(askerId, responderId, status)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_notifications_user_unread ON arena_notifications(userId, isRead, createdAt DESC)`,
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_arena_mal_card_pool_fetchedAt ON arena_mal_card_pool(fetchedAt DESC)`,
    ).run();
  } catch {
    // Startup should continue even if index creation fails.
  }
}

ensureDbDirectoryExists(DB_FILE);
const db = new Database(DB_FILE);
configurePragmas(db);
createBaseTables(db);
createTcgTables(db);
ensureColumns(db);
createIndexes(db);

module.exports = { db };
