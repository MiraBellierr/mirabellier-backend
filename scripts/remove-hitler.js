/**
 * Removes "Hitler, Adolf" completely from the site:
 * 1. Removes the character from mal-characters.json
 * 2. Deletes all cards with that title from all DB tables
 *
 * Usage:  node scripts/remove-hitler.js
 * Dry run: node scripts/remove-hitler.js --dry
 */
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_FILE =
  process.env.DB_FILE || path.join(__dirname, "..", "database.sqlite3");
const CATALOG_FILE =
  process.env.MAL_CHARACTERS_FILE
    ? path.resolve(__dirname, "..", process.env.MAL_CHARACTERS_FILE)
    : path.resolve(__dirname, "..", "data", "mal-characters.json");

const TARGET_NAME = "Hitler, Adolf";
const CENSORED_NAME = "A.H.";
const dryRun = process.argv.includes("--dry");
const backupCatalog = !dryRun;

function main() {
  const tag = dryRun ? "[DRY RUN] " : "";

  // ---- Step 1: Remove from mal-characters.json ----
  console.log(`${tag}Removing from catalog: "${TARGET_NAME}"`);

  const raw = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
  if (!raw || !Array.isArray(raw.characters)) {
    console.error("Catalog has no characters array.");
    process.exit(1);
  }

  const beforeCount = raw.characters.length;
  const removedIds = [];
  raw.characters = raw.characters.filter((entry) => {
    if (entry.name === TARGET_NAME || entry.name === CENSORED_NAME) {
      removedIds.push(Number(entry.id));
      return false;
    }
    return true;
  });

  const catalogRemoved = beforeCount - raw.characters.length;
  console.log(`${tag}  Removed ${catalogRemoved} character(s) from catalog.`);

  if (!dryRun && catalogRemoved > 0) {
    if (backupCatalog) {
      const backupPath = CATALOG_FILE + ".bak." + Date.now();
      fs.copyFileSync(CATALOG_FILE, backupPath);
      console.log(`  Backup saved: ${backupPath}`);
    }
    raw.generatedAt = new Date().toISOString();
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(raw, null, 2), "utf8");
  }

  // ---- Step 2: Remove from database ----
  const db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");

  const tables = [
    { table: "arena_card_collection", idCol: "id", cardCol: "cardJson", keyCol: "id" },
    { table: "arena_profiles", idCol: "userId", cardCol: "selectedCardJson", keyCol: "userId" },
    { table: "arena_market_listings", idCol: "id", cardCol: "cardJson", keyCol: "id" },
    { table: "arena_trade_listings", idCol: "id", cardCol: "cardJson", keyCol: "id" },
    { table: "arena_daily_card_offers", idCol: "offerId", cardCol: "cardJson", keyCol: "offerId" },
  ];

  let totalRemoved = 0;

  for (const { table, idCol, cardCol, keyCol } of tables) {
    const rows = db.prepare(
      `SELECT ${keyCol}, ${cardCol} FROM ${table} WHERE ${cardCol} IS NOT NULL`,
    ).all();

    const toDelete = [];

    for (const row of rows) {
      let card;
      try { card = JSON.parse(row[cardCol]); } catch { continue; }
      if (!card) continue;

      if (
        card.title === TARGET_NAME ||
        card.title === CENSORED_NAME ||
        (removedIds.length > 0 && removedIds.includes(Number(card.malId)))
      ) {
        toDelete.push({ key: row[keyCol], title: card.title, malId: card.malId });
      }
    }

    if (toDelete.length > 0) {
      const tx = db.transaction(() => {
        for (const entry of toDelete) {
          if (!dryRun) {
            if (table === "arena_profiles") {
              // Nullify selected card instead of deleting the profile row
              db.prepare(
                `UPDATE arena_profiles SET selectedCardJson = NULL, updatedAt = ? WHERE userId = ?`,
              ).run(new Date().toISOString(), entry.key);
            } else {
              db.prepare(
                `DELETE FROM ${table} WHERE ${keyCol} = ?`,
              ).run(entry.key);
            }
          }
          console.log(`  ${tag}${table}: ${entry.title} (malId=${entry.malId})`);
        }
      });
      tx();
      totalRemoved += toDelete.length;
    }
  }

  console.log(`${tag}Done. ${catalogRemoved} from catalog, ${totalRemoved} from database.`);

  db.close();
}

main();
