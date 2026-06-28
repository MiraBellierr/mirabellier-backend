const { ARENA_EFFECT_DEFAULTS } = require("../arena-constants");
const {
  clamp, toInt, toPositiveInt, EFFECT_DURATION_LIMITS,
} = require("./utils");

function clampEffectDuration(key, value) {
  return clamp(toPositiveInt(value), 0, EFFECT_DURATION_LIMITS[key] ?? Number.MAX_SAFE_INTEGER);
}


function normalizeArenaEffects(value) {
  let parsed = {};

  if (value && typeof value === "object") {
    parsed = value;
  } else if (typeof value === "string" && value.trim()) {
    try {
      const decoded = JSON.parse(value);
      if (decoded && typeof decoded === "object") {
        parsed = decoded;
      }
    } catch {
      parsed = {};
    }
  }

  return {
    expBoostPct: clamp(toPositiveInt(parsed.expBoostPct), 0, 200),
    expBoostWinsRemaining: clampEffectDuration(
      "expBoostWinsRemaining",
      parsed.expBoostWinsRemaining,
    ),
    coinBoostPct: clamp(toPositiveInt(parsed.coinBoostPct), 0, 200),
    coinBoostWinsRemaining: clampEffectDuration(
      "coinBoostWinsRemaining",
      parsed.coinBoostWinsRemaining,
    ),
    drawBonusChancePct: clamp(toPositiveInt(parsed.drawBonusChancePct), 0, 100),
    drawBonusChanceWinsRemaining: clampEffectDuration(
      "drawBonusChanceWinsRemaining",
      parsed.drawBonusChanceWinsRemaining,
    ),
    rerollKeepHigherCharges: clampEffectDuration(
      "rerollKeepHigherCharges",
      parsed.rerollKeepHigherCharges ?? parsed.refocusCharges,
    ),
    streakShieldCharges: clampEffectDuration(
      "streakShieldCharges",
      parsed.streakShieldCharges,
    ),
    upgradeLowestRarityCharges: clampEffectDuration(
      "upgradeLowestRarityCharges",
      parsed.upgradeLowestRarityCharges,
    ),
    guaranteeSsrPlusCharges: clampEffectDuration(
      "guaranteeSsrPlusCharges",
      parsed.guaranteeSsrPlusCharges,
    ),
    ascensionLastPurchasedAt:
      typeof parsed.ascensionLastPurchasedAt === "string" &&
      parsed.ascensionLastPurchasedAt
        ? parsed.ascensionLastPurchasedAt
        : null,
    fightStartShieldCharges: clampEffectDuration(
      "fightStartShieldCharges",
      parsed.fightStartShieldCharges,
    ),
    fightStartShieldAmount: clamp(toPositiveInt(parsed.fightStartShieldAmount), 0, 9999),
    evadeBoostPct: clamp(toPositiveInt(parsed.evadeBoostPct), 0, 95),
    evadeBoostFightsRemaining: clampEffectDuration(
      "evadeBoostFightsRemaining",
      parsed.evadeBoostFightsRemaining,
    ),
    firstHitTrueDamageCharges: clampEffectDuration(
      "firstHitTrueDamageCharges",
      parsed.firstHitTrueDamageCharges,
    ),
    firstHitTrueDamageValue: clamp(toPositiveInt(parsed.firstHitTrueDamageValue), 0, 9999),
    higherRarityDamageBonusPctCharges: clampEffectDuration(
      "higherRarityDamageBonusPctCharges",
      parsed.higherRarityDamageBonusPctCharges,
    ),
    higherRarityDamageBonusPct: clamp(
      toPositiveInt(parsed.higherRarityDamageBonusPct),
      0,
      300,
    ),
    gateKeyCharges: clampEffectDuration("gateKeyCharges", parsed.gateKeyCharges),
    doublePassiveTriggerFightsRemaining: clampEffectDuration(
      "doublePassiveTriggerFightsRemaining",
      parsed.doublePassiveTriggerFightsRemaining,
    ),
    damageBoostPct: clamp(toPositiveInt(parsed.damageBoostPct), 0, 200),
    damageBoostFightsRemaining: clampEffectDuration("damageBoostFightsRemaining", parsed.damageBoostFightsRemaining),
    speedBoostPct: clamp(toPositiveInt(parsed.speedBoostPct), 0, 200),
    speedBoostFightsRemaining: clampEffectDuration("speedBoostFightsRemaining", parsed.speedBoostFightsRemaining),
    deathSaveCharges: clampEffectDuration("deathSaveCharges", parsed.deathSaveCharges),
    statSteroidPct: clamp(toPositiveInt(parsed.statSteroidPct), 0, 200),
    statSteroidFightsRemaining: clampEffectDuration("statSteroidFightsRemaining", parsed.statSteroidFightsRemaining),
    matchRarityCharges: clampEffectDuration("matchRarityCharges", parsed.matchRarityCharges),
    vampiricHealPct: clamp(toPositiveInt(parsed.vampiricHealPct), 0, 100),
    vampiricHealFightsRemaining: clampEffectDuration("vampiricHealFightsRemaining", parsed.vampiricHealFightsRemaining),
    critChanceBoostPct: clamp(toPositiveInt(parsed.critChanceBoostPct), 0, 200),
    critChanceBoostFightsRemaining: clampEffectDuration("critChanceBoostFightsRemaining", parsed.critChanceBoostFightsRemaining),
    guardBoostPct: clamp(toPositiveInt(parsed.guardBoostPct), 0, 200),
    guardBoostFightsRemaining: clampEffectDuration("guardBoostFightsRemaining", parsed.guardBoostFightsRemaining),
    firstAttackDoubleCharges: clampEffectDuration("firstAttackDoubleCharges", parsed.firstAttackDoubleCharges),
    ivBoostCharges: clampEffectDuration("ivBoostCharges", parsed.ivBoostCharges),
    selfReviveHpThresholdPct: clamp(toPositiveInt(parsed.selfReviveHpThresholdPct), 0, 95),
    selfReviveCharges: clampEffectDuration("selfReviveCharges", parsed.selfReviveCharges),
  };
}

function serializeEffects(effects) {
  return JSON.stringify(normalizeArenaEffects(effects));
}

module.exports = {
  normalizeArenaEffects,
  serializeEffects,
};
