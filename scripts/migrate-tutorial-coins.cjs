#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const BACKEND_ROOT = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(BACKEND_ROOT, ".env") });

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv) {
  const options = {
    apply: false,
    dbFile: process.env.DB_FILE || path.join(BACKEND_ROOT, "database.sqlite3"),
    backupFile: "",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.apply = false;
      continue;
    }
    if (arg === "--backup") {
      const val = argv[i + 1];
      if (!val || val.startsWith("--")) {
        throw new Error("--backup requires a file path.");
      }
      options.backupFile = val;
      i += 1;
      continue;
    }
    if (arg.startsWith("--backup=")) {
      options.backupFile = arg.slice("--backup=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: node scripts/migrate-tutorial-coins.cjs [flags]",
          "",
          "Sets tutorialComplete = 20 for users who already received the old 10K bonus",
          "(tutorialComplete = 1). This prevents double-dipping after the P12 spread change.",
          "",
          "Flags:",
          "  --apply         Apply changes (default: dry-run only)",
          "  --dry-run       Report only, no writes",
          "  --backup <path> Backup DB file before applying",
          "  --help, -h      Show this help",
        ].join("\n"),
      );
      process.exit(0);
    }
  }

  return options;
}

function main() {
  const args = process.argv.slice(2);
  let options;
  try {
    options = parseArgs(args);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }

  if (options.apply && !options.backupFile) {
    options.backupFile =
      path.dirname(options.dbFile) +
      "/database-backup-" +
      timestampForFile() +
      ".sqlite3";
  }

  if (options.apply) {
    fs.copyFileSync(options.dbFile, options.backupFile);
    console.log("Backed up database to:", options.backupFile);
  }

  const db = new Database(options.dbFile);
  db.pragma("journal_mode = WAL");

  const rows = db
    .prepare("SELECT userId, level, tutorialComplete FROM arena_profiles WHERE tutorialComplete = 1")
    .all();

  console.log(`Found ${rows.length} users with tutorialComplete = 1.`);

  if (rows.length > 0) {
    for (const row of rows) {
      console.log(`  userId=${row.userId} level=${row.level} tutorialComplete=${row.tutorialComplete}`);
    }

    if (options.apply) {
      db.prepare(
        "UPDATE arena_profiles SET tutorialComplete = 20 WHERE tutorialComplete = 1"
      ).run();
      console.log(`\n✅ Set tutorialComplete = 20 for ${rows.length} user(s).`);
    } else {
      console.log("\n(DRY RUN — no changes were written. Re-run with --apply to write.)");
    }
  } else {
    console.log("No migration needed.");
  }

  db.close();
}

main();
