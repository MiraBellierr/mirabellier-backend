const {
  SHOP_ITEMS, SHOP_RECIPES, SHOP_TIERS, CATALOG_VERSION,
} = require("../arena-constants");
const {
  nowIso, makeId, clamp, toInt, toPositiveInt,
} = require("./utils");
// SHOP_ITEMS_BY_ID and SHOP_RECIPES_BY_ID
const SHOP_ITEMS_BY_ID = new Map(SHOP_ITEMS.map((item) => [item.id, item]));
const SHOP_RECIPES_BY_ID = new Map(SHOP_RECIPES.map((recipe) => [recipe.id, recipe]));
const { normalizeArenaEffects, serializeEffects } = require("./effects");
const { rollEquipmentPiece, insertEquipmentPiece, equipEquipmentPiece, computeEquipmentStats } = require("./equipment");
const { ensureArenaProfile, getArenaProfilePayload, getInventoryMap } = require("./profile");
const { ArenaHttpError } = require("./utils");


function upsertInventoryItem(db, userId, itemId, quantityDelta) {
  const existing = db
    .prepare(
      `SELECT id, quantity
       FROM arena_inventory
       WHERE userId = ? AND itemId = ?
       LIMIT 1`,
    )
    .get(userId, itemId);
  const now = nowIso();

  if (!existing) {
    if (quantityDelta <= 0) {
      throw new ArenaHttpError(400, "Inventory quantity cannot go below zero.");
    }
    db.prepare(
      `INSERT INTO arena_inventory (id, userId, itemId, quantity, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(makeId("inv"), userId, itemId, quantityDelta, now, now);
    return quantityDelta;
  }

  const nextQuantity = toInt(existing.quantity, 0) + toInt(quantityDelta, 0);
  if (nextQuantity < 0) {
    throw new ArenaHttpError(400, "Inventory quantity cannot go below zero.");
  }

  if (nextQuantity === 0) {
    db.prepare("DELETE FROM arena_inventory WHERE id = ?").run(existing.id);
    return 0;
  }

  db.prepare("UPDATE arena_inventory SET quantity = ?, updatedAt = ? WHERE id = ?").run(
    nextQuantity,
    now,
    existing.id,
  );
  return nextQuantity;
}

function upsertEquippedItem(db, userId, slot, itemId) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO arena_equipment (userId, slot, itemId, equippedAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(userId, slot) DO UPDATE SET
       itemId = excluded.itemId,
       equippedAt = excluded.equippedAt`,
  ).run(userId, slot, itemId, now);
}

function buildShopCatalog(profile, inventoryMap) {
  const equipmentItems = [];
  const tierItems = [];

  SHOP_ITEMS.forEach((item) => {
    const ownedQuantity = inventoryMap.get(item.id)?.quantity || 0;
    const isOwned = ownedQuantity > 0;
    const unlocked = profile.level >= item.unlockLevel;
    const recipe = item.recipeId ? SHOP_RECIPES_BY_ID.get(item.recipeId) : null;
    const canBuy =
      item.acquisition === "buy" &&
      unlocked &&
      profile.coins >= toInt(item.price, 0);
    let canCraft = false;
    if (item.acquisition === "craft" && recipe && unlocked) {
      const hasCoins = profile.coins >= toInt(recipe.coinCost, 0);
      const hasInputs = recipe.inputs.every((entry) => {
        const owned = inventoryMap.get(entry.itemId)?.quantity || 0;
        return owned >= toInt(entry.quantity, 0);
      });
      canCraft = hasCoins && hasInputs;
    }

    let cooldownEndsAt = null;
    if (
      item.type === "consumable" &&
      item.consumableEffect?.kind === "ascension" &&
      profile.effects.ascensionLastPurchasedAt
    ) {
      const parsed = Date.parse(profile.effects.ascensionLastPurchasedAt);
      if (Number.isFinite(parsed)) {
        const cooldownMs =
          Number(item.consumableEffect.cooldownDays || 7) * 24 * 60 * 60 * 1000;
        const cooldownEnds = parsed + cooldownMs;
        if (cooldownEnds > Date.now()) {
          cooldownEndsAt = new Date(cooldownEnds).toISOString();
        }
      }
    }

    const enriched = {
      ...item,
      ownedQuantity,
      isOwned,
      isEquipped: false,
      unlocked,
      canBuy: canBuy && !cooldownEndsAt,
      canCraft: canCraft && !cooldownEndsAt,
      cooldownEndsAt,
    };

    if (item.tier === null) {
      equipmentItems.push(enriched);
    } else {
      tierItems.push(enriched);
    }
  });

  const tieredCatalog = SHOP_TIERS.map((tier) => ({
    tier,
    items: tierItems.filter((item) => item.tier === tier),
  }));

  return { equipment: equipmentItems, shop: tieredCatalog };
}

function getArenaShopPayload(db, userId) {
  const profile = ensureArenaProfile(db, userId);
  const inventoryMap = getInventoryMap(db, userId);
  const { equipment, shop } = buildShopCatalog(profile, inventoryMap);
  const { equipped } = computeEquipmentStats(db, userId);
  const recipes = SHOP_RECIPES.map((recipe) => {
    const outputItem = SHOP_ITEMS_BY_ID.get(recipe.output.itemId);
    const unlocked = profile.level >= recipe.unlockLevel;
    const hasCoins = profile.coins >= toInt(recipe.coinCost, 0);
    const inputState = recipe.inputs.map((entry) => {
      const owned = inventoryMap.get(entry.itemId)?.quantity || 0;
      const item = SHOP_ITEMS_BY_ID.get(entry.itemId);
      return {
        itemId: entry.itemId,
        itemName: item?.name || entry.itemId,
        required: toInt(entry.quantity, 0),
        owned,
      };
    });
    const hasInputs = inputState.every((entry) => entry.owned >= entry.required);

    return {
      ...recipe,
      output: {
        ...recipe.output,
        itemName: outputItem?.name || recipe.output.itemId,
      },
      inputs: inputState,
      unlocked,
      canCraft: unlocked && hasCoins && hasInputs,
    };
  });

  return {
    catalogVersion: CATALOG_VERSION,
    profile: getArenaProfilePayload(db, userId),
    equipment,
    shop,
    recipes,
    equipped,
  };
}

function enforceAscensionCooldown(profile, item) {
  const cooldownDays = Number(item?.consumableEffect?.cooldownDays || 7);
  const previous = profile.effects.ascensionLastPurchasedAt;
  if (!previous) return;
  const parsed = Date.parse(previous);
  if (!Number.isFinite(parsed)) return;
  const cooldownEndsAt = parsed + cooldownDays * 24 * 60 * 60 * 1000;
  if (cooldownEndsAt > Date.now()) {
    throw new ArenaHttpError(
      409,
      "Solar Cauldron can only be used once every 7 days.",
      "ARENA_ASCENSION_COOLDOWN",
      { cooldownEndsAt: new Date(cooldownEndsAt).toISOString() },
    );
  }
}

function buyShopItem(db, userId, itemId) {
  const item = SHOP_ITEMS_BY_ID.get(itemId);
  if (!item) {
    throw new ArenaHttpError(404, "Item not found.", "ARENA_ITEM_NOT_FOUND");
  }

  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    if (profile.level < item.unlockLevel) {
      throw new ArenaHttpError(403, "Level too low for this item.", "ARENA_ITEM_LOCKED");
    }

    if (item.acquisition !== "buy") {
      throw new ArenaHttpError(
        400,
        "This item is crafted, not bought directly.",
        "ARENA_ITEM_CRAFT_ONLY",
      );
    }

    if (profile.coins < item.price) {
      throw new ArenaHttpError(400, "Not enough coins.", "ARENA_NOT_ENOUGH_COINS");
    }

    profile.coins -= item.price;
    profile.updatedAt = nowIso();

    let appliedInstantly = false;
    let rolledPieceId = null;
    let rolledPieceData = null;
    const effects = normalizeArenaEffects(profile.effects);
    if (item.type === "gear") {
      const piece = rollEquipmentPiece(item.slot);
      if (!piece) {
        throw new ArenaHttpError(500, "Failed to roll equipment piece.");
      }
      rolledPieceId = insertEquipmentPiece(db, userId, piece);
      rolledPieceData = { ...piece };
    } else if (item.type === "consumable" || item.type === "material") {
      upsertInventoryItem(db, userId, item.id, 1);
    }

    db.prepare(
      `UPDATE arena_profiles
       SET coins = ?,
           hp = ?,
           power = ?,
           guard = ?,
           speed = ?,
           effectHit = ?,
           effectsJson = ?,
           updatedAt = ?
       WHERE userId = ?`,
    ).run(
      profile.coins,
      profile.hp,
      profile.power,
      profile.guard,
      profile.speed,
      profile.effectHit,
      serializeEffects(effects),
      profile.updatedAt,
      userId,
    );

    return {
      item,
      appliedInstantly,
      rolledPieceId,
      rolledPieceData,
    };
  });

  const result = tx();
  return {
    purchasedItemId: result.item.id,
    appliedInstantly: result.appliedInstantly,
    rolledPieceId: result.rolledPieceId || null,
    rolledPiece: result.rolledPieceData || null,
    shop: getArenaShopPayload(db, userId),
  };
}

function applyConsumableEffect(profile, item) {
  const effect = item.consumableEffect || {};
  const effects = normalizeArenaEffects(profile.effects);
  const now = nowIso();

  if (effect.kind === "damage_boost") {
    effects.damageBoostPct = Math.max(effects.damageBoostPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.damageBoostFightsRemaining = Math.min(
      effects.damageBoostFightsRemaining + fights,
      Math.max(effects.damageBoostFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "speed_boost") {
    effects.speedBoostPct = Math.max(effects.speedBoostPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.speedBoostFightsRemaining = Math.min(
      effects.speedBoostFightsRemaining + fights,
      Math.max(effects.speedBoostFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "death_save") {
    const charges = toPositiveInt(effect.charges, 1);
    effects.deathSaveCharges = Math.min(
      effects.deathSaveCharges + charges,
      Math.max(effects.deathSaveCharges, charges * 2),
    );
  } else if (effect.kind === "stat_steroid") {
    effects.statSteroidPct = Math.max(effects.statSteroidPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.statSteroidFightsRemaining = Math.min(
      effects.statSteroidFightsRemaining + fights,
      Math.max(effects.statSteroidFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "match_rarity") {
    const charges = toPositiveInt(effect.charges, 1);
    effects.matchRarityCharges = Math.min(
      effects.matchRarityCharges + charges,
      Math.max(effects.matchRarityCharges, charges * 2),
    );
  } else if (effect.kind === "vampiric_heal") {
    effects.vampiricHealPct = Math.max(effects.vampiricHealPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.vampiricHealFightsRemaining = Math.min(
      effects.vampiricHealFightsRemaining + fights,
      Math.max(effects.vampiricHealFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "crit_chance") {
    effects.critChanceBoostPct = Math.max(effects.critChanceBoostPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.critChanceBoostFightsRemaining = Math.min(
      effects.critChanceBoostFightsRemaining + fights,
      Math.max(effects.critChanceBoostFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "guard_boost") {
    effects.guardBoostPct = Math.max(effects.guardBoostPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.guardBoostFightsRemaining = Math.min(
      effects.guardBoostFightsRemaining + fights,
      Math.max(effects.guardBoostFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "first_attack_double") {
    const charges = toPositiveInt(effect.charges, 1);
    effects.firstAttackDoubleCharges = Math.min(
      effects.firstAttackDoubleCharges + charges,
      Math.max(effects.firstAttackDoubleCharges, charges * 2),
    );
  } else if (effect.kind === "iv_boost") {
    const charges = toPositiveInt(effect.charges, 1);
    effects.ivBoostCharges = Math.min(
      effects.ivBoostCharges + charges,
      Math.max(effects.ivBoostCharges, charges * 2),
    );
  } else if (effect.kind === "exp_boost") {
    effects.expBoostPct = Math.max(effects.expBoostPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.expBoostWinsRemaining = Math.min(
      effects.expBoostWinsRemaining + fights,
      Math.max(effects.expBoostWinsRemaining, fights * 2),
    );
  } else if (effect.kind === "self_revive") {
    effects.selfReviveHpThresholdPct = Math.max(
      effects.selfReviveHpThresholdPct,
      toPositiveInt(effect.hpPct, 0),
    );
    const charges = toPositiveInt(effect.charges, 1);
    effects.selfReviveCharges = Math.min(
      effects.selfReviveCharges + charges,
      Math.max(effects.selfReviveCharges, charges * 2),
    );
  } else if (effect.kind === "shield_fight_start") {
    effects.fightStartShieldAmount = Math.max(
      effects.fightStartShieldAmount,
      toPositiveInt(effect.amount, 0),
    );
    const charges = toPositiveInt(effect.charges, 1);
    effects.fightStartShieldCharges = Math.min(
      effects.fightStartShieldCharges + charges,
      Math.max(effects.fightStartShieldCharges, charges * 2),
    );
  } else if (effect.kind === "evade_next_fight") {
    effects.evadeBoostPct = Math.max(effects.evadeBoostPct, toPositiveInt(effect.pct, 0));
    const fights = toPositiveInt(effect.fights, 1);
    effects.evadeBoostFightsRemaining = Math.min(
      effects.evadeBoostFightsRemaining + fights,
      Math.max(effects.evadeBoostFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "first_hit_true_damage") {
    effects.firstHitTrueDamageValue = Math.max(
      effects.firstHitTrueDamageValue,
      toPositiveInt(effect.value, 0),
    );
    const charges = toPositiveInt(effect.charges, 1);
    effects.firstHitTrueDamageCharges = Math.min(
      effects.firstHitTrueDamageCharges + charges,
      Math.max(effects.firstHitTrueDamageCharges, charges * 2),
    );
  } else if (effect.kind === "bonus_vs_higher_rarity") {
    effects.higherRarityDamageBonusPct = Math.max(
      effects.higherRarityDamageBonusPct,
      toPositiveInt(effect.pct, 0),
    );
    const charges = toPositiveInt(effect.charges, 1);
    effects.higherRarityDamageBonusPctCharges = Math.min(
      effects.higherRarityDamageBonusPctCharges + charges,
      Math.max(effects.higherRarityDamageBonusPctCharges, charges * 2),
    );
  } else if (effect.kind === "double_passive_trigger") {
    const fights = toPositiveInt(effect.fights, 1);
    effects.doublePassiveTriggerFightsRemaining = Math.min(
      effects.doublePassiveTriggerFightsRemaining + fights,
      Math.max(effects.doublePassiveTriggerFightsRemaining, fights * 2),
    );
  } else if (effect.kind === "restore_consumable_charge") {
    const restored =
      effects.firstAttackDoubleCharges > 0
        ? "firstAttackDoubleCharges"
        : effects.selfReviveCharges > 0
          ? "selfReviveCharges"
          : effects.deathSaveCharges > 0
            ? "deathSaveCharges"
            : effects.matchRarityCharges > 0
              ? "matchRarityCharges"
              : effects.fightStartShieldCharges > 0
                ? "fightStartShieldCharges"
                : effects.critChanceBoostFightsRemaining > 0
                  ? "critChanceBoostFightsRemaining"
                  : effects.guardBoostFightsRemaining > 0
                    ? "guardBoostFightsRemaining"
                    : effects.statSteroidFightsRemaining > 0
                      ? "statSteroidFightsRemaining"
                      : effects.damageBoostFightsRemaining > 0
                        ? "damageBoostFightsRemaining"
                        : effects.speedBoostFightsRemaining > 0
                          ? "speedBoostFightsRemaining"
                          : effects.firstHitTrueDamageCharges > 0
                            ? "firstHitTrueDamageCharges"
                            : effects.higherRarityDamageBonusPctCharges > 0
                              ? "higherRarityDamageBonusPctCharges"
                              : effects.vampiricHealFightsRemaining > 0
                                ? "vampiricHealFightsRemaining"
                                : effects.evadeBoostFightsRemaining > 0
                                  ? "evadeBoostFightsRemaining"
                                  : effects.streakShieldCharges > 0
                                    ? "streakShieldCharges"
                                    : effects.doublePassiveTriggerFightsRemaining > 0
                                      ? "doublePassiveTriggerFightsRemaining"
                                      : null;
    if (!restored) {
      throw new ArenaHttpError(
        409,
        "No eligible consumable charge to restore.",
        "ARENA_NO_CHARGE_TO_RESTORE",
      );
    }
    const charges = toPositiveInt(effect.charges, 1);
    effects[restored] = Math.min(
      effects[restored] + charges,
      Math.max(effects[restored], charges * 2),
    );
  } else if (effect.kind === "ascension") {
    enforceAscensionCooldown(profile, item);
    profile.hp += 1;
    profile.power += 1;
    profile.guard += 1;
    profile.speed += 1;
    profile.effectHit += 1;
    effects.ascensionLastPurchasedAt = now;
  } else {
    throw new ArenaHttpError(400, "Unsupported consumable effect.");
  }

  return normalizeArenaEffects(effects);
}

function equipShopItem(db, userId, pieceId) {
  if (!pieceId || typeof pieceId !== "string" || !pieceId.trim()) {
    throw new ArenaHttpError(400, "pieceId is required.", "ARENA_PIECE_REQUIRED");
  }

  equipEquipmentPiece(db, userId, pieceId.trim());

  const piece = db
    .prepare(`SELECT id, slot FROM arena_equipment_pieces WHERE id = ? AND userId = ?`)
    .get(pieceId.trim(), userId);
  if (!piece) {
    throw new ArenaHttpError(404, "Equipment piece not found.", "ARENA_PIECE_NOT_FOUND");
  }

  return {
    equippedPieceId: piece.id,
    slot: piece.slot,
    shop: getArenaShopPayload(db, userId),
  };
}

function useConsumable(db, userId, itemId) {
  const item = SHOP_ITEMS_BY_ID.get(itemId);
  if (!item || item.type !== "consumable") {
    throw new ArenaHttpError(404, "Consumable not found.", "ARENA_CONSUMABLE_NOT_FOUND");
  }

  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    const inventory = getInventoryMap(db, userId);
    const owned = inventory.get(item.id)?.quantity || 0;
    if (owned <= 0) {
      throw new ArenaHttpError(
        400,
        "Consumable is not owned.",
        "ARENA_CONSUMABLE_NOT_OWNED",
      );
    }

    upsertInventoryItem(db, userId, item.id, -1);
    const nextEffects = applyConsumableEffect(profile, item);
    const updatedAt = nowIso();

    db.prepare(
      `UPDATE arena_profiles
       SET hp = ?, power = ?, guard = ?, speed = ?, effectHit = ?, effectsJson = ?, updatedAt = ?
       WHERE userId = ?`,
    ).run(
      profile.hp,
      profile.power,
      profile.guard,
      profile.speed,
      profile.effectHit,
      serializeEffects(nextEffects),
      updatedAt,
      userId,
    );

    return {
      item,
      effects: nextEffects,
    };
  });

  const result = tx();
  return {
    activatedItemId: result.item.id,
    effects: result.effects,
    shop: getArenaShopPayload(db, userId),
  };
}

function craftShopRecipe(db, userId, recipeId, quantityInput = 1) {
  const recipe = SHOP_RECIPES_BY_ID.get(String(recipeId || "").trim());
  if (!recipe) {
    throw new ArenaHttpError(404, "Recipe not found.", "ARENA_RECIPE_NOT_FOUND");
  }

  const quantity = clamp(toPositiveInt(quantityInput, 1), 1, 20);
  const outputItem = SHOP_ITEMS_BY_ID.get(recipe.output.itemId);
  if (!outputItem) {
    throw new ArenaHttpError(409, "Recipe output item missing.");
  }

  const tx = db.transaction(() => {
    const profile = ensureArenaProfile(db, userId);
    if (profile.level < recipe.unlockLevel) {
      throw new ArenaHttpError(403, "Level too low for this recipe.", "ARENA_RECIPE_LOCKED");
    }

    const inventory = getInventoryMap(db, userId);
    const craftCount = quantity;
    const totalCoinCost = toInt(recipe.coinCost, 0) * craftCount;
    if (profile.coins < totalCoinCost) {
      throw new ArenaHttpError(400, "Not enough coins.", "ARENA_NOT_ENOUGH_COINS");
    }

    upsertInventoryItem(
      db,
      userId,
      outputItem.id,
      toInt(recipe.output.quantity, 1) * craftCount,
    );

    profile.coins -= totalCoinCost;
    profile.updatedAt = nowIso();
    db.prepare("UPDATE arena_profiles SET coins = ?, updatedAt = ? WHERE userId = ?").run(
      profile.coins,
      profile.updatedAt,
      userId,
    );

    return {
      recipe,
      craftedQuantity: toInt(recipe.output.quantity, 1) * craftCount,
      outputItemId: outputItem.id,
    };
  });

  const result = tx();
  return {
    craftedRecipeId: result.recipe.id,
    outputItemId: result.outputItemId,
    craftedQuantity: result.craftedQuantity,
    shop: getArenaShopPayload(db, userId),
  };
}

module.exports = {
  upsertInventoryItem,
  upsertEquippedItem,
  buildShopCatalog,
  getArenaShopPayload,
  enforceAscensionCooldown,
  buyShopItem,
  applyConsumableEffect,
  equipShopItem,
  useConsumable,
  craftShopRecipe,
};
