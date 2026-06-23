/**
 * Backfills the "from" field on existing cardJson entries in arena_card_collection.
 * Reads the character catalog for each card's malId and adds the first anime appearance.
 *
 * Usage:  node scripts/backfill-card-from.js
 * Dry run: node scripts/backfill-card-from.js --dry
 */
const path = require("path");
const Database = require("better-sqlite3");
const fs = require("fs");

const DB_FILE =
  process.env.DB_FILE || path.join(__dirname, "..", "database.sqlite3");
const CATALOG_FILE =
  process.env.MAL_CHARACTERS_FILE
    ? path.resolve(__dirname, "..", process.env.MAL_CHARACTERS_FILE)
    : path.resolve(__dirname, "..", "data", "mal-characters.json");

const dryRun = process.argv.includes("--dry");

function buildCatalogMap() {
  const raw = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
  const map = new Map();

  if (!raw || !Array.isArray(raw.characters)) {
    console.error("Catalog has no characters array.");
    process.exit(1);
  }

  for (const entry of raw.characters) {
    const malId = Number(entry.id);
    if (!Number.isFinite(malId) || malId <= 0) continue;
    const firstAnime = ((entry.appearances || [])
      .find((a) => a.type === "anime" && a.name)
      || (entry.appearances || [])[0]
      || {}).name || null;
    if (firstAnime) {
      map.set(malId, firstAnime);
    }
  }

  return map;
}

function main() {
  console.log("Building catalog map...");
  const catalogMap = buildCatalogMap();
  console.log(`Catalog: ${catalogMap.size} characters with appearance data.`);

  const db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");

  const rows = db.prepare(
    "SELECT id, userId, cardInstanceId, cardJson FROM arena_card_collection",
  ).all();

  let updated = 0;
  let skipped = 0;
  let already = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      let card;
      try {
        card = JSON.parse(row.cardJson);
      } catch {
        skipped++;
        continue;
      }

      if (!card || !card.malId) {
        skipped++;
        continue;
      }

      if (card.from) {
        already++;
        continue;
      }

      const from = catalogMap.get(Number(card.malId));
      if (!from) {
        skipped++;
        continue;
      }

      card.from = from;

      if (!dryRun) {
        db.prepare(
          "UPDATE arena_card_collection SET cardJson = ?, updatedAt = ? WHERE id = ?",
        ).run(JSON.stringify(card), new Date().toISOString(), row.id);
      }

      updated++;
      if (updated % 100 === 0) {
        console.log(`  ${updated} updated...`);
      }
    }
  });

  tx();

  const tag = dryRun ? "[DRY RUN] " : "";
  console.log(
    `${tag}Collection: ${updated} updated, ${already} already had from, ${skipped} skipped.`,
  );

  // Also backfill selected cards in arena_profiles
  const profileRows = db.prepare(
    "SELECT userId, selectedCardJson FROM arena_profiles WHERE selectedCardJson IS NOT NULL",
  ).all();

  let selUpdated = 0;
  let selSkipped = 0;
  let selAlready = 0;

  const tx2 = db.transaction(() => {
    for (const row of profileRows) {
      let card;
      try {
        card = JSON.parse(row.selectedCardJson);
      } catch {
        selSkipped++;
        continue;
      }

      if (!card || !card.malId) {
        selSkipped++;
        continue;
      }

      if (card.from) {
        selAlready++;
        continue;
      }

      const from = catalogMap.get(Number(card.malId));
      if (!from) {
        selSkipped++;
        continue;
      }

      card.from = from;

      if (!dryRun) {
        db.prepare(
          "UPDATE arena_profiles SET selectedCardJson = ?, updatedAt = ? WHERE userId = ?",
        ).run(JSON.stringify(card), new Date().toISOString(), row.userId);
      }

      selUpdated++;
    }
  });

  tx2();

  console.log(
    `${tag}Selected: ${selUpdated} updated, ${selAlready} already had from, ${selSkipped} skipped.`,
  );

  db.close();
}

main();
