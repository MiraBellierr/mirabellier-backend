const { ROLLABLE_EQUIPMENT, SUB_STAT_POOL } = require("../arena-constants");
const {
  nowIso, makeId, clamp, toInt, toPositiveInt, rollInRange,
} = require("./utils");
const { ArenaHttpError } = require("./utils");

const MAX_LOADOUTS = 5;
const MAX_ENHANCEMENT_LEVEL = 15;
const REROLL_SUBSTAT_COIN_COST = 500;


function getEquipmentPiecesRows(db, userId) {
  return db
    .prepare(
      `SELECT id, userId, slot, mainStatType, mainStatValue, enhancementLevel, subStats, equipped, locked, createdAt
       FROM arena_equipment_pieces
       WHERE userId = ?
       ORDER BY createdAt ASC`,
    )
    .all(userId);
}

function getEquippedPiecesRows(db, userId) {
  return db
    .prepare(
      `SELECT id, userId, slot, mainStatType, mainStatValue, enhancementLevel, subStats, equipped, locked, createdAt
       FROM arena_equipment_pieces
       WHERE userId = ? AND equipped = 1`,
    )
    .all(userId);
}

function getEquippedPieceBySlot(db, userId, slot) {
  return db
    .prepare(
      `SELECT id, userId, slot, mainStatType, mainStatValue, enhancementLevel, subStats, equipped, locked, createdAt
       FROM arena_equipment_pieces
       WHERE userId = ? AND slot = ? AND equipped = 1`,
    )
    .get(userId, slot) || null;
}

function insertEquipmentPiece(db, userId, piece) {
  const now = nowIso();
  const id = makeId("eqp");
  db.prepare(
    `INSERT INTO arena_equipment_pieces (id, userId, slot, mainStatType, mainStatValue, enhancementLevel, subStats, equipped, createdAt)
     VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?)`,
  ).run(id, userId, piece.slot, piece.mainStatType, piece.mainStatValue, JSON.stringify(piece.subStats), now);
  return id;
}

function normalizeSubStatType(type) {
  return type === "crit" ? "critRate" : type;
}

function getSubStatRange(type) {
  return SUB_STAT_POOL.ranges[normalizeSubStatType(type)] || null;
}

function getLoadoutNamesForPiece(db, userId, pieceId) {
  return db
    .prepare(
      `SELECT name
       FROM arena_equipment_loadouts
       WHERE userId = ?
         AND (weaponPieceId = ? OR armorPieceId = ? OR charmPieceId = ?)`,
    )
    .all(userId, pieceId, pieceId, pieceId)
    .map((row) => row.name);
}

function assertPieceNotInLoadout(db, userId, pieceId) {
  const loadoutNames = getLoadoutNamesForPiece(db, userId, pieceId);
  if (loadoutNames.length > 0) {
    throw new ArenaHttpError(
      400,
      "Remove this piece from saved loadouts before scrapping it.",
      "ARENA_PIECE_IN_LOADOUT",
      { loadoutNames },
    );
  }
}

function getEnhancementCoinCost(currentLevel) {
  const level = clamp(toInt(currentLevel, 0), 0, MAX_ENHANCEMENT_LEVEL);
  if (level >= MAX_ENHANCEMENT_LEVEL) return null;
  return Math.round(350 * (1.45 ** level));
}

function parseSubStatsJson(subStatsJson) {
  try {
    const parsed = JSON.parse(subStatsJson || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toPublicEquipmentPiece(row, includeEquipped = false) {
  const enhancementLevel = clamp(toInt(row.enhancementLevel, 0), 0, MAX_ENHANCEMENT_LEVEL);
  const piece = {
    id: row.id,
    slot: row.slot,
    mainStatType: row.mainStatType,
    mainStatValue: row.mainStatValue,
    enhancementLevel,
    enhancedMainStatValue: (Number(row.mainStatValue) || 0) + enhancementLevel,
    subStats: parseSubStatsJson(row.subStats),
    locked: !!row.locked,
    createdAt: row.createdAt,
  };
  if (includeEquipped) piece.equipped = !!row.equipped;
  return piece;
}

function getPieceForUpgrade(db, userId, pieceId) {
  const piece = db
    .prepare(
      `SELECT id, userId, slot, mainStatType, mainStatValue, enhancementLevel, subStats, equipped, locked, createdAt
       FROM arena_equipment_pieces
       WHERE id = ? AND userId = ?`,
    )
    .get(pieceId, userId);
  if (!piece) {
    throw new ArenaHttpError(404, "Equipment piece not found.", "ARENA_PIECE_NOT_FOUND");
  }
  return piece;
}

function getConsumableFodderPiece(db, userId, fodderPieceId, targetPieceId) {
  const fodder = getPieceForUpgrade(db, userId, fodderPieceId);
  if (fodder.id === targetPieceId) {
    throw new ArenaHttpError(400, "Choose a different fodder piece.", "ARENA_FODDER_TARGET_MATCH");
  }
  if (fodder.equipped) {
    throw new ArenaHttpError(400, "Unequip fodder gear first.", "ARENA_FODDER_EQUIPPED");
  }
  if (fodder.locked) {
    throw new ArenaHttpError(400, "Unlock the fodder piece before using it.", "ARENA_PIECE_LOCKED");
  }
  assertPieceNotInLoadout(db, userId, fodder.id);
  return fodder;
}

function spendCoinsAndFodderPiece(db, userId, cost, fodderPieceId) {
  const profile = db
    .prepare("SELECT coins FROM arena_profiles WHERE userId = ?")
    .get(userId);
  if (!profile) {
    throw new ArenaHttpError(404, "Arena profile not found.", "ARENA_PROFILE_NOT_FOUND");
  }
  if (toInt(profile.coins, 0) < cost) {
    throw new ArenaHttpError(400, "Not enough coins.", "ARENA_NOT_ENOUGH_COINS");
  }

  const now = nowIso();
  db.prepare("DELETE FROM arena_equipment_pieces WHERE id = ? AND userId = ?").run(fodderPieceId, userId);
  db.prepare("UPDATE arena_profiles SET coins = coins - ?, updatedAt = ? WHERE userId = ?").run(cost, now, userId);
}

function enhanceEquipmentPiece(db, userId, pieceId, fodderPieceId) {
  const cleanPieceId = String(pieceId || "").trim();
  const cleanFodderPieceId = String(fodderPieceId || "").trim();
  if (!cleanPieceId) {
    throw new ArenaHttpError(400, "pieceId is required.", "ARENA_PIECE_REQUIRED");
  }
  if (!cleanFodderPieceId) {
    throw new ArenaHttpError(400, "fodderPieceId is required.", "ARENA_FODDER_REQUIRED");
  }

  const tx = db.transaction(() => {
    const piece = getPieceForUpgrade(db, userId, cleanPieceId);
    getConsumableFodderPiece(db, userId, cleanFodderPieceId, piece.id);
    const currentLevel = clamp(toInt(piece.enhancementLevel, 0), 0, MAX_ENHANCEMENT_LEVEL);
    const coinCost = getEnhancementCoinCost(currentLevel);
    if (coinCost === null) {
      throw new ArenaHttpError(
        409,
        "This equipment is already fully enhanced.",
        "ARENA_EQUIPMENT_MAX_ENHANCEMENT",
      );
    }

    spendCoinsAndFodderPiece(db, userId, coinCost, cleanFodderPieceId);
    db.prepare(
      `UPDATE arena_equipment_pieces
       SET enhancementLevel = ?
       WHERE id = ? AND userId = ?`,
    ).run(currentLevel + 1, piece.id, userId);

    return {
      pieceId: piece.id,
      fodderPieceId: cleanFodderPieceId,
      previousLevel: currentLevel,
      enhancementLevel: currentLevel + 1,
      coinCost,
    };
  });

  return tx();
}

function rerollEquipmentSubStat(db, userId, pieceId, subStatIndex, fodderPieceId) {
  const cleanPieceId = String(pieceId || "").trim();
  const cleanFodderPieceId = String(fodderPieceId || "").trim();
  const index = toInt(subStatIndex, -1);
  if (!cleanPieceId) {
    throw new ArenaHttpError(400, "pieceId is required.", "ARENA_PIECE_REQUIRED");
  }
  if (!cleanFodderPieceId) {
    throw new ArenaHttpError(400, "fodderPieceId is required.", "ARENA_FODDER_REQUIRED");
  }

  const tx = db.transaction(() => {
    const piece = getPieceForUpgrade(db, userId, cleanPieceId);
    getConsumableFodderPiece(db, userId, cleanFodderPieceId, piece.id);
    const subStats = parseSubStatsJson(piece.subStats);
    if (index < 0 || index >= subStats.length) {
      throw new ArenaHttpError(400, "Valid subStatIndex is required.", "ARENA_SUBSTAT_REQUIRED");
    }

    const oldSubStat = subStats[index] || {};
    const range = getSubStatRange(oldSubStat.type);
    if (!range) {
      throw new ArenaHttpError(400, "Unsupported substat type.", "ARENA_SUBSTAT_UNSUPPORTED");
    }

    const newSubStat = {
      type: normalizeSubStatType(oldSubStat.type),
      value: rollInRange(range[0], range[1]),
    };
    subStats[index] = newSubStat;

    spendCoinsAndFodderPiece(db, userId, REROLL_SUBSTAT_COIN_COST, cleanFodderPieceId);
    db.prepare(
      `UPDATE arena_equipment_pieces
       SET subStats = ?
       WHERE id = ? AND userId = ?`,
    ).run(JSON.stringify(subStats), piece.id, userId);

    return {
      pieceId: piece.id,
      fodderPieceId: cleanFodderPieceId,
      subStatIndex: index,
      oldSubStat,
      newSubStat,
      coinCost: REROLL_SUBSTAT_COIN_COST,
    };
  });

  return tx();
}

function equipEquipmentPiece(db, userId, pieceId) {
  const piece = db
    .prepare(
      `SELECT id, userId, slot FROM arena_equipment_pieces WHERE id = ? AND userId = ?`,
    )
    .get(pieceId, userId);
  if (!piece) {
    throw new ArenaHttpError(404, "Equipment piece not found.", "ARENA_PIECE_NOT_FOUND");
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE arena_equipment_pieces SET equipped = 0 WHERE userId = ? AND slot = ? AND equipped = 1`,
    ).run(userId, piece.slot);
    db.prepare(
      `UPDATE arena_equipment_pieces SET equipped = 1 WHERE id = ? AND userId = ?`,
    ).run(pieceId, userId);
  });
  tx();
}

function unequipEquipmentSlot(db, userId, slot) {
  db.prepare(
    `UPDATE arena_equipment_pieces SET equipped = 0 WHERE userId = ? AND slot = ? AND equipped = 1`,
  ).run(userId, slot);
}

function fodderEquipmentPiece(db, userId, pieceId, refundAmount) {
  const piece = db.prepare(
    "SELECT equipped, locked FROM arena_equipment_pieces WHERE id = ? AND userId = ?",
  ).get(pieceId, userId);
  if (!piece) throw new ArenaHttpError(404, "Piece not found.", "ARENA_PIECE_NOT_FOUND");
  if (piece.equipped) throw new ArenaHttpError(400, "Unequip before foddering.", "ARENA_PIECE_EQUIPPED");
  if (piece.locked) throw new ArenaHttpError(400, "Unlock the piece before scrapping.", "ARENA_PIECE_LOCKED");
  assertPieceNotInLoadout(db, userId, pieceId);

  const FODDER_PRICE = typeof refundAmount === "number" && refundAmount > 0 ? refundAmount : 500;
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM arena_equipment_pieces WHERE id = ? AND userId = ?").run(pieceId, userId);
    db.prepare("UPDATE arena_profiles SET coins = coins + ?, updatedAt = ? WHERE userId = ?").run(FODDER_PRICE, now, userId);
  });
  tx();
  return { fodderPieceId: pieceId, coinsGained: FODDER_PRICE };
}

function lockEquipmentPiece(db, userId, pieceId) {
  const piece = db.prepare(
    "SELECT id FROM arena_equipment_pieces WHERE id = ? AND userId = ?",
  ).get(pieceId, userId);
  if (!piece) throw new ArenaHttpError(404, "Piece not found.", "ARENA_PIECE_NOT_FOUND");

  db.prepare("UPDATE arena_equipment_pieces SET locked = 1 WHERE id = ? AND userId = ?").run(pieceId, userId);
  return { pieceId, locked: true };
}

function unlockEquipmentPiece(db, userId, pieceId) {
  const piece = db.prepare(
    "SELECT id FROM arena_equipment_pieces WHERE id = ? AND userId = ?",
  ).get(pieceId, userId);
  if (!piece) throw new ArenaHttpError(404, "Piece not found.", "ARENA_PIECE_NOT_FOUND");

  db.prepare("UPDATE arena_equipment_pieces SET locked = 0 WHERE id = ? AND userId = ?").run(pieceId, userId);
  return { pieceId, locked: false };
}

function getEquipmentLoadouts(db, userId) {
  const rows = db
    .prepare(
      `SELECT id, name, weaponPieceId, armorPieceId, charmPieceId, createdAt
       FROM arena_equipment_loadouts
       WHERE userId = ?
       ORDER BY createdAt DESC`,
    )
    .all(userId);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    weaponPieceId: row.weaponPieceId || null,
    armorPieceId: row.armorPieceId || null,
    charmPieceId: row.charmPieceId || null,
    createdAt: row.createdAt,
  }));
}

function saveEquipmentLoadout(db, userId, name) {
  const cleanName = String(name || "").trim().slice(0, 40) || "Loadout";
  const existing = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM arena_equipment_loadouts WHERE userId = ?`,
    )
    .get(userId);
  if (existing.cnt >= MAX_LOADOUTS) {
    throw new ArenaHttpError(
      409,
      `You can only save up to ${MAX_LOADOUTS} loadouts.`,
      "ARENA_LOADOUT_LIMIT",
    );
  }

  const equipped = getEquippedPiecesRows(db, userId);
  const pieceBySlot = {};
  equipped.forEach((p) => {
    pieceBySlot[p.slot] = p.id;
  });

  const id = makeId("ld");
  const now = nowIso();
  db.prepare(
    `INSERT INTO arena_equipment_loadouts (id, userId, name, weaponPieceId, armorPieceId, charmPieceId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    cleanName,
    pieceBySlot.weapon || null,
    pieceBySlot.armor || null,
    pieceBySlot.charm || null,
    now,
  );

  return {
    id,
    name: cleanName,
    weaponPieceId: pieceBySlot.weapon || null,
    armorPieceId: pieceBySlot.armor || null,
    charmPieceId: pieceBySlot.charm || null,
    createdAt: now,
  };
}

function restoreEquipmentLoadout(db, userId, loadoutId) {
  const loadout = db
    .prepare(
      `SELECT id, userId, weaponPieceId, armorPieceId, charmPieceId
       FROM arena_equipment_loadouts
       WHERE id = ? AND userId = ?`,
    )
    .get(loadoutId, userId);
  if (!loadout) {
    throw new ArenaHttpError(
      404,
      "Loadout not found.",
      "ARENA_LOADOUT_NOT_FOUND",
    );
  }

  const slots = ["weapon", "armor", "charm"];
  const pieceIds = [loadout.weaponPieceId, loadout.armorPieceId, loadout.charmPieceId];
  const restored = [];

  const tx = db.transaction(() => {
    slots.forEach((slot, i) => {
      const pieceId = pieceIds[i];
      if (!pieceId) return;

      const piece = db
        .prepare(
          `SELECT id FROM arena_equipment_pieces WHERE id = ? AND userId = ?`,
        )
        .get(pieceId, userId);
      if (!piece) return;

      db.prepare(
        `UPDATE arena_equipment_pieces SET equipped = 0 WHERE userId = ? AND slot = ? AND equipped = 1`,
      ).run(userId, slot);
      db.prepare(
        `UPDATE arena_equipment_pieces SET equipped = 1 WHERE id = ? AND userId = ?`,
      ).run(pieceId, userId);
      restored.push(slot);
    });
  });
  tx();

  return { loadoutId, restored };
}

function deleteEquipmentLoadout(db, userId, loadoutId) {
  const result = db
    .prepare(`DELETE FROM arena_equipment_loadouts WHERE id = ? AND userId = ?`)
    .run(loadoutId, userId);
  if (result.changes === 0) {
    throw new ArenaHttpError(
      404,
      "Loadout not found.",
      "ARENA_LOADOUT_NOT_FOUND",
    );
  }
  return { success: true, loadoutId };
}

function rollEquipmentPiece(slot) {
  const equipmentDef = ROLLABLE_EQUIPMENT.find((e) => e.slot === slot);
  if (!equipmentDef) return null;

  let mainStatType;
  let mainStatValue;

  if (equipmentDef.mainStat.type === "random") {
    const chosen = equipmentDef.mainStat.options[Math.floor(Math.random() * equipmentDef.mainStat.options.length)];
    mainStatType = chosen.type;
    mainStatValue = rollInRange(chosen.min, chosen.max);
  } else {
    mainStatType = equipmentDef.mainStat.type;
    mainStatValue = rollInRange(equipmentDef.mainStat.min, equipmentDef.mainStat.max);
  }

  // Pick 4 unique sub-stats
  const pool = [...SUB_STAT_POOL.pool];
  const subStats = [];
  for (let i = 0; i < SUB_STAT_POOL.count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const type = pool.splice(idx, 1)[0];
    const range = getSubStatRange(type);
    subStats.push({ type, value: rollInRange(range[0], range[1]) });
  }

  return { slot, mainStatType, mainStatValue, subStats };
}

function computeEquipmentStats(db, userId) {
  const pieceRows = getEquippedPiecesRows(db, userId);
  const flatStats = {
    hp: 0,
    power: 0,
    guard: 0,
    speed: 0,
    effectHit: 0,
  };
  const pctStats = {
    hpPct: 0,
    dmgPct: 0,
    defendPct: 0,
    critChancePct: 0,
    critDmgPct: 0,
  };
  const equipped = {
    weapon: null,
    armor: null,
    charm: null,
  };

  pieceRows.forEach((row) => {
    let subStatsArray = [];
    try { subStatsArray = JSON.parse(row.subStats || "[]"); } catch { /* keep empty */ }

    const pieceData = {
      id: row.id,
      slot: row.slot,
      mainStatType: row.mainStatType,
      mainStatValue: row.mainStatValue,
      enhancementLevel: clamp(toInt(row.enhancementLevel, 0), 0, MAX_ENHANCEMENT_LEVEL),
      enhancedMainStatValue: (Number(row.mainStatValue) || 0) +
        clamp(toInt(row.enhancementLevel, 0), 0, MAX_ENHANCEMENT_LEVEL),
      subStats: subStatsArray,
      createdAt: row.createdAt,
    };
    equipped[row.slot] = pieceData;

    // Main stat
    let mainVal = Number(row.mainStatValue) || 0;
    mainVal += clamp(toInt(row.enhancementLevel, 0), 0, MAX_ENHANCEMENT_LEVEL);
    switch (row.mainStatType) {
      case "hp": flatStats.hp += mainVal; break;
      case "power": flatStats.power += mainVal; break;
      case "guard": flatStats.guard += mainVal; break;
      case "critRate": pctStats.critChancePct += mainVal; break;
      case "critDmg": pctStats.critDmgPct += mainVal; break;
    }

    // Sub stats
    subStatsArray.forEach((s) => {
      const val = Number(s.value) || 0;
      switch (s.type) {
        case "hp": flatStats.hp += val; break;
        case "power": flatStats.power += val; break;
        case "guard": flatStats.guard += val; break;
        case "speed": flatStats.speed += val; break;
        case "effectHit": flatStats.effectHit += val; break;
        case "hpPct": pctStats.hpPct += val; break;
        case "dmgPct": pctStats.dmgPct += val; break;
        case "defendPct": pctStats.defendPct += val; break;
        case "crit":
        case "critRate": pctStats.critChancePct += val; break;
        case "critDmg": pctStats.critDmgPct += val; break;
      }
    });
  });

  return {
    stats: {
      hp: flatStats.hp,
      power: flatStats.power,
      guard: flatStats.guard,
      speed: flatStats.speed,
      effectHit: flatStats.effectHit,
    },
    pct: pctStats,
    equipped,
  };
}

function weightedEquipmentBonus(stats) {
  return (
    (stats.power || 0) * 2.0 +
    (stats.guard || 0) * 1.7 +
    (stats.speed || 0) * 1.5
  );
}

module.exports = {
  getEquipmentPiecesRows,
  getEquippedPiecesRows,
  getEquippedPieceBySlot,
  toPublicEquipmentPiece,
  insertEquipmentPiece,
  equipEquipmentPiece,
  unequipEquipmentSlot,
  fodderEquipmentPiece,
  lockEquipmentPiece,
  unlockEquipmentPiece,
  enhanceEquipmentPiece,
  rerollEquipmentSubStat,
  getEnhancementCoinCost,
  MAX_ENHANCEMENT_LEVEL,
  REROLL_SUBSTAT_COIN_COST,
  getEquipmentLoadouts,
  saveEquipmentLoadout,
  restoreEquipmentLoadout,
  deleteEquipmentLoadout,
  rollEquipmentPiece,
  computeEquipmentStats,
  weightedEquipmentBonus,
};
