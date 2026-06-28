const {
  computeSkillBonuses, SKILL_TREE_BRANCHES, SKILL_TREE_NODES, SKILL_TREE_NODES_BY_ID,
} = require("../arena-skill-tree");
const { nowIso, makeId, toInt, toPositiveInt } = require("./utils");
const { ArenaHttpError } = require("./utils");

// Lazy-require ensureArenaProfile to avoid circular dep with profile.js
function getProfile(db, userId) {
  return require("./profile").ensureArenaProfile(db, userId);
}


function getSkillAllocationRows(db, userId) {
  return db
    .prepare(
      `SELECT userId, nodeId, activatedAt
       FROM arena_skill_allocations
       WHERE userId = ?
       ORDER BY activatedAt ASC, nodeId ASC`,
    )
    .all(userId);
}

function getSkillState(db, profile) {
  const allocations = getSkillAllocationRows(db, profile.userId);
  const allocatedNodeIds = allocations.map((row) => row.nodeId);
  const earnedPoints = Math.max(toInt(profile.level, 1) - 1, 0);
  const spentPoints = allocations.length;
  const availablePoints = Math.max(earnedPoints - spentPoints, 0);
  const resetCost = Math.max(toInt(profile.level, 1), 1) * 100;
  const bonuses = computeSkillBonuses(allocatedNodeIds);

  return {
    allocations,
    allocatedNodeIds,
    earnedPoints,
    spentPoints,
    availablePoints,
    resetCost,
    stats: bonuses.stats,
    passives: bonuses.passives,
  };
}

function getArenaSkillTreePayload(db, userId) {
  const profile = getProfile(db, userId);
  const skillState = getSkillState(db, profile);
  return {
    branches: SKILL_TREE_BRANCHES,
    nodes: SKILL_TREE_NODES,
    allocations: skillState.allocations,
    earnedPoints: skillState.earnedPoints,
    spentPoints: skillState.spentPoints,
    availablePoints: skillState.availablePoints,
    level: profile.level,
    coins: profile.coins,
    resetCost: skillState.resetCost,
    stats: skillState.stats,
  };
}

function activateArenaSkill(db, userId, nodeId) {
  const normalizedNodeId = String(nodeId || "").trim();
  const node = SKILL_TREE_NODES_BY_ID.get(normalizedNodeId);
  if (!node) {
    throw new ArenaHttpError(
      404,
      "Skill node not found.",
      "ARENA_SKILL_NOT_FOUND",
    );
  }

  const tx = db.transaction(() => {
    const profile = getProfile(db, userId);
    const state = getSkillState(db, profile);
    if (state.allocatedNodeIds.includes(normalizedNodeId)) {
      throw new ArenaHttpError(
        409,
        "This skill is already active.",
        "ARENA_SKILL_ALREADY_ACTIVE",
      );
    }
    if (
      node.prerequisiteId &&
      !state.allocatedNodeIds.includes(node.prerequisiteId)
    ) {
      throw new ArenaHttpError(
        409,
        "Activate the previous skill in this chain first.",
        "ARENA_SKILL_PREREQUISITE",
        { prerequisiteId: node.prerequisiteId },
      );
    }
    if (state.availablePoints < 1) {
      throw new ArenaHttpError(
        409,
        "No skill points are available.",
        "ARENA_SKILL_POINTS_REQUIRED",
      );
    }

    db.prepare(
      `INSERT INTO arena_skill_allocations (userId, nodeId, activatedAt)
       VALUES (?, ?, ?)`,
    ).run(userId, normalizedNodeId, nowIso());
  });

  tx();
  return getArenaSkillTreePayload(db, userId);
}

function resetArenaSkills(db, userId) {
  const tx = db.transaction(() => {
    const profile = getProfile(db, userId);
    const state = getSkillState(db, profile);
    if (state.spentPoints === 0) {
      throw new ArenaHttpError(
        409,
        "There are no activated skills to reset.",
        "ARENA_SKILL_RESET_EMPTY",
      );
    }
    if (profile.coins < state.resetCost) {
      throw new ArenaHttpError(
        409,
        "Not enough coins to reset the skill tree.",
        "ARENA_SKILL_RESET_COINS",
        { requiredCoins: state.resetCost },
      );
    }

    const now = nowIso();
    db.prepare("DELETE FROM arena_skill_allocations WHERE userId = ?").run(userId);
    db.prepare(
      `UPDATE arena_profiles
       SET coins = ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(profile.coins - state.resetCost, now, userId);
  });

  tx();
  return getArenaSkillTreePayload(db, userId);
}

module.exports = {
  getSkillAllocationRows,
  getSkillState,
  getArenaSkillTreePayload,
  activateArenaSkill,
  resetArenaSkills,
};
