// utility-ai.js
// Utility AI scoring system for NPC decisions.
// Replaces implicit weight tables with transparent score-based decision making.
// Used by: companions, merchants, guards, boss AI, director NPCs.

'use strict';

// ---------------------------------------------------------------------------
// Core scoring engine
// ---------------------------------------------------------------------------

// Evaluate a set of actions and return the highest-scoring one.
// actions: array of { id, name, scoreFn(context) }
// context: arbitrary data passed to score functions
// Returns: { action, score } or null if no valid actions
function evaluateBest(actions, context) {
  var best = null;
  var bestScore = -Infinity;

  for (var i = 0; i < actions.length; i++) {
    var action = actions[i];
    var score = action.scoreFn(context);
    if (score === null || score === undefined) continue; // skip disabled actions
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }

  if (!best) return null;
  return { action: best, score: bestScore };
}

// Evaluate all actions and return sorted by score (descending).
// Useful for debugging and for "top N" selection.
function evaluateAll(actions, context) {
  var results = [];
  for (var i = 0; i < actions.length; i++) {
    var score = actions[i].scoreFn(context);
    if (score === null || score === undefined) continue;
    results.push({ action: actions[i], score: score });
  }
  results.sort(function(a, b) { return b.score - a.score; });
  return results;
}

// Weighted random selection from scored actions (probabilistic behavior)
function evaluateWeightedRandom(actions, context) {
  var scored = evaluateAll(actions, context);
  if (scored.length === 0) return null;

  // Normalize scores to positive values
  var minScore = scored[scored.length - 1].score;
  var offset = minScore < 0 ? -minScore + 1 : 0;
  var totalWeight = 0;
  for (var i = 0; i < scored.length; i++) {
    totalWeight += scored[i].score + offset;
  }

  var roll = Math.random() * totalWeight;
  var cumulative = 0;
  for (var j = 0; j < scored.length; j++) {
    cumulative += scored[j].score + offset;
    if (roll <= cumulative) return scored[j];
  }
  return scored[0];
}

// ---------------------------------------------------------------------------
// Score curve functions (for building scoreFn)
// ---------------------------------------------------------------------------

// Linear: score = value * weight
function linear(value, weight) {
  return value * (weight || 1);
}

// Inverse linear: score = (1 - value) * weight (high when value is low)
function inverseLinear(value, weight) {
  return (1 - Math.max(0, Math.min(1, value))) * (weight || 1);
}

// Step function: returns weight if value >= threshold, else 0
function step(value, threshold, weight) {
  return value >= threshold ? (weight || 1) : 0;
}

// Smooth step: logistic curve centered at threshold
function smoothStep(value, threshold, weight, steepness) {
  var k = steepness || 10;
  var sigmoid = 1 / (1 + Math.exp(-k * (value - threshold)));
  return sigmoid * (weight || 1);
}

// Quadratic: score = value^2 * weight (rewards extremes)
function quadratic(value, weight) {
  return value * value * (weight || 1);
}

// Logistic growth: S-curve from 0 to maxVal
function logistic(value, midpoint, maxVal, steepness) {
  var k = steepness || 1;
  return maxVal / (1 + Math.exp(-k * (value - midpoint)));
}

// ---------------------------------------------------------------------------
// Predefined NPC behavior templates
// ---------------------------------------------------------------------------

// Guard AI: patrol, investigate, pursue, arrest, attack
var GUARD_ACTIONS = {
  patrol: function(ctx) {
    // Low priority when nothing happening
    var base = 20;
    if (ctx.threatLevel > 0) base -= ctx.threatLevel * 5;
    return Math.max(0, base);
  },
  investigate: function(ctx) {
    // Triggered by nearby disturbances
    if (!ctx.disturbanceNearby) return 0;
    return 40 + ctx.disturbanceIntensity * 10;
  },
  pursue: function(ctx) {
    if (!ctx.hostileTarget) return 0;
    var dist = ctx.targetDistance || 100;
    return 60 * inverseLinear(dist / 100, 1);
  },
  arrest: function(ctx) {
    if (!ctx.targetKarma || ctx.targetKarma > -30) return 0;
    return 70 + Math.abs(ctx.targetKarma) * 0.3;
  },
  attack: function(ctx) {
    if (!ctx.hostileTarget) return 0;
    if (ctx.targetDistance > 3) return 0; // too far for melee
    return 80 + ctx.threatLevel * 5;
  },
};

// Merchant AI: trade, restock, flee, barter
var MERCHANT_ACTIONS = {
  trade: function(ctx) {
    if (!ctx.customerNearby) return 0;
    return 50 + ctx.customerReputation * 10;
  },
  restock: function(ctx) {
    var stockRatio = ctx.currentStock / (ctx.maxStock || 1);
    return inverseLinear(stockRatio, 40);
  },
  flee: function(ctx) {
    if (ctx.threatLevel < 30) return 0;
    return ctx.threatLevel * 1.5;
  },
  bargainHard: function(ctx) {
    // Drive harder bargains when stock is low or demand is high
    var demandPressure = ctx.recentSales / (ctx.maxStock || 1);
    return linear(demandPressure, 30);
  },
};

// Companion AI: follow, assist, heal, defend, gather
var COMPANION_ACTIONS = {
  follow: function(ctx) {
    if (ctx.ownerDistance > 10) return 80; // far from owner = follow
    return 15;
  },
  assist: function(ctx) {
    if (!ctx.ownerInCombat) return 0;
    return 60 + ctx.companionCombatSkill * 5;
  },
  heal: function(ctx) {
    if (!ctx.canHeal) return 0;
    var ownerHpRatio = ctx.ownerHp / (ctx.ownerMaxHp || 1);
    return inverseLinear(ownerHpRatio, 90);
  },
  defend: function(ctx) {
    if (!ctx.hostileNearOwner) return 0;
    return 70 + ctx.companionDefenseSkill * 3;
  },
  gather: function(ctx) {
    if (ctx.ownerInCombat) return 0;
    if (!ctx.resourceNearby) return 0;
    return 30 + ctx.companionGatherSkill * 5;
  },
};

// Boss AI: adaptive decision making (for Archlich, Leviathans, etc.)
var BOSS_ACTIONS = {
  basicAttack: function(ctx) {
    return 30; // always available baseline
  },
  specialAbility: function(ctx) {
    if (ctx.abilityCooldown > 0) return 0;
    var hpRatio = ctx.bossHp / (ctx.bossMaxHp || 1);
    // Use special more when hurt
    return 50 + inverseLinear(hpRatio, 30);
  },
  summonMinions: function(ctx) {
    if (ctx.minionCount >= ctx.maxMinions) return 0;
    if (ctx.summonCooldown > 0) return 0;
    // Summon when low on minions and hurt
    var hpRatio = ctx.bossHp / (ctx.bossMaxHp || 1);
    return 40 * inverseLinear(hpRatio, 1) + inverseLinear(ctx.minionCount / ctx.maxMinions, 20);
  },
  aoeAttack: function(ctx) {
    if (ctx.aoeCooldown > 0) return 0;
    // AOE when many players clustered
    return ctx.playersInRange * 15;
  },
  heal: function(ctx) {
    if (ctx.healCooldown > 0) return 0;
    var hpRatio = ctx.bossHp / (ctx.bossMaxHp || 1);
    if (hpRatio > 0.5) return 0; // don't heal if healthy
    return inverseLinear(hpRatio, 100);
  },
  enrage: function(ctx) {
    var hpRatio = ctx.bossHp / (ctx.bossMaxHp || 1);
    if (hpRatio > 0.25) return 0;
    if (ctx.alreadyEnraged) return 0;
    return 120; // emergency priority
  },
};

// ---------------------------------------------------------------------------
// Action builder helper
// ---------------------------------------------------------------------------

// Convert a template object { actionName: scoreFn } to action array
function buildActionSet(template) {
  var actions = [];
  for (var id in template) {
    actions.push({
      id: id,
      name: id.replace(/_/g, ' '),
      scoreFn: template[id],
    });
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Core engine
  evaluateBest: evaluateBest,
  evaluateAll: evaluateAll,
  evaluateWeightedRandom: evaluateWeightedRandom,

  // Score curves
  linear: linear,
  inverseLinear: inverseLinear,
  step: step,
  smoothStep: smoothStep,
  quadratic: quadratic,
  logistic: logistic,

  // NPC templates
  GUARD_ACTIONS: GUARD_ACTIONS,
  MERCHANT_ACTIONS: MERCHANT_ACTIONS,
  COMPANION_ACTIONS: COMPANION_ACTIONS,
  BOSS_ACTIONS: BOSS_ACTIONS,
  buildActionSet: buildActionSet,
};
