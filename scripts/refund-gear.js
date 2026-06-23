/**
 * One-off script: Remove all gear from all players and compensate with coins.
 *
 * Usage:  node scripts/refund-gear.js
 * Dry run: node scripts/refund-gear.js --dry
 *
 * Compensation amounts match the recipe coin cost per gear item.
 */
const path = require("path");
const Database = require("better-sqlite3");

const DB_FILE =
  process.env.DB_FILE || path.join(__dirname, "..", "database.sqlite3");

const GEAR_REFUND_MAP = {
  rustblade_weapon: 830,
  twigbow_weapon: 890,
  patchwork_helm: 1010,
  copper_ring: 1010,
  riversteel_saber: 3110,
  guard_cap: 3230,
  iron_cuirass: 3470,
  azure_ring: 3650,
  dawnfang_blade: 9800,
  knight_helm: 10200,
  laurel_pendant: 10600,
  verdant_core: 11000,
  twinlight_blades: 41200,
  waraxe_howl: 42200,
  sky_hood: 43200,
  violet_core: 44200,
  reaper_glaive: 142000,
  wyrm_hood: 144000,
  titan_greaves: 146000,
  crimson_core: 148000,
  orbit_scepter: 472000,
  aegis_crown: 474000,
  azure_core: 476000,
  void_core: 478000,
};

const dryRun = process.argv.includes("--dry");

function main() {
  const db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");

  const profiles = db
    .prepare("SELECT userId, coins FROM arena_profiles")
    .all();

  const now = new Date().toISOString();

  let totalCompensated = 0;
  let playersCompensated = 0;
  let totalGearRemoved = 0;

  const tx = db.transaction(() => {
    for (const profile of profiles) {
      const { userId } = profile;

      // Count gear in inventory
      const invRows = db
        .prepare(
          "SELECT itemId, quantity FROM arena_inventory WHERE userId = ?",
        )
        .all(userId);

      let refund = 0;
      const gearIdsToDelete = [];

      for (const row of invRows) {
        const amount = GEAR_REFUND_MAP[row.itemId];
        if (amount) {
          refund += amount * Math.max(Number(row.quantity) || 0, 1);
          gearIdsToDelete.push(row.itemId);
        }
      }

      // Count gear in equipment slots
      const eqRows = db
        .prepare("SELECT itemId FROM arena_equipment WHERE userId = ?")
        .all(userId);

      const alreadyRefunded = new Set(gearIdsToDelete);
      for (const row of eqRows) {
        const amount = GEAR_REFUND_MAP[row.itemId];
        if (amount && !alreadyRefunded.has(row.itemId)) {
          refund += amount;
          gearIdsToDelete.push(row.itemId);
          alreadyRefunded.add(row.itemId);
        }
      }

      if (refund <= 0 && gearIdsToDelete.length === 0) continue;

      if (dryRun) {
        console.log(
          `[DRY] ${userId}: +${refund.toLocaleString()} coins · remove ${gearIdsToDelete.length} gear`,
        );
        continue;
      }

      // Add coins
      db.prepare(
        "UPDATE arena_profiles SET coins = coins + ?, updatedAt = ? WHERE userId = ?",
      ).run(refund, now, userId);

      // Delete gear from inventory
      if (gearIdsToDelete.length > 0) {
        const placeholders = gearIdsToDelete.map(() => "?").join(",");
        db.prepare(
          `DELETE FROM arena_inventory WHERE userId = ? AND itemId IN (${placeholders})`,
        ).run(userId, ...gearIdsToDelete);
      }

      // Delete from old equipment table
      db.prepare("DELETE FROM arena_equipment WHERE userId = ?").run(userId);

      totalCompensated += refund;
      playersCompensated += 1;
      totalGearRemoved += gearIdsToDelete.length;

      console.log(
        `${userId}: +${refund.toLocaleString()} coins · removed ${gearIdsToDelete.length} gear`,
      );
    }
  });

  tx();

  const tag = dryRun ? "[DRY RUN]" : "[LIVE]";
  console.log(
    `${tag} Done. ${playersCompensated} players · ${totalCompensated.toLocaleString()} coins · ${totalGearRemoved} gear removed`,
  );

  db.close();
}

main();
