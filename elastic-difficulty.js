// elastic-difficulty.js
// Elastic difficulty system — feeds director metrics back into combat parameters.
// Adjusts reinforcement rate, enemy aggression, and boss ability timing based on
// real-time tension scoring. Sits between director-metrics (data) and
// combat-scaling / director-micro (execution).
//
// Layer 1 runtime: fast, deterministic, per-tick adjustments.

'use strict';

// ---------------------------------------------------------------------------
// Tension bands — maps stress ranges to difficulty modifiers
// ---------------------------------------------------------------------------

// Each band defines how combat parameters shift when party stress falls in range.
// stressRange: [min, max) of 75th-percentile party stress (0-1)
var TENSION_BANDS = [
  {
    id: 'bored',
    stressRange: [0, 0.10],
    reinforcementRate: 1.5,    // +50% faster reinforcement spawning
    detectionBonus: +3,        // enemies spot players from further
    enemyAggressionMod: 1.3,   // enemies prioritize attack over idle
    bossAbilityCooldownMod: 0.7, // boss uses abilities 30% faster
    lootBonusMod: 1.15,        // +15% loot quality for harder fights
    label: 'Escalating',
  },
  {
    id: 'coasting',
    stressRange: [0.10, 0.25],
    reinforcementRate: 1.2,
    detectionBonus: +1,
    enemyAggressionMod: 1.1,
    bossAbilityCooldownMod: 0.9,
    lootBonusMod: 1.05,
    label: 'Pressing',
  },
  {
    id: 'engaged',
    stressRange: [0.25, 0.50],
    reinforcementRate: 1.0,    // baseline
    detectionBonus: 0,
    enemyAggressionMod: 1.0,
    bossAbilityCooldownMod: 1.0,
    lootBonusMod: 1.0,
    label: 'Balanced',
  },
  {
    id: 'pressured',
    stressRange: [0.50, 0.70],
    reinforcementRate: 0.7,    // -30% slower reinforcements
    detectionBonus: -1,
    enemyAggressionMod: 0.9,
    bossAbilityCooldownMod: 1.2,
    lootBonusMod: 1.0,
    label: 'Easing',
  },
  {
    id: 'overwhelmed',
    stressRange: [0.70, 1.01],
    reinforcementRate: 0.4,    // -60% slower reinforcements
    detectionBonus: -2,
    enemyAggressionMod: 0.7,   // enemies less aggressive
    bossAbilityCooldownMod: 1.5, // boss waits longer between abilities
    lootBonusMod: 1.1,         // slight loot comfort for struggling players
    label: 'Mercy',
  },
];

// ---------------------------------------------------------------------------
// Per-floor elastic state
// ---------------------------------------------------------------------------

// floorId -> { band, smoothedStress, historyWindow, adjustments }
var floorElasticState = new Map();

var SMOOTHING_ALPHA = 0.15;  // EMA smoothing for stress transitions
var HISTORY_WINDOW = 20;     // ticks of stress history for trend detection

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

// Get the tension band for a given stress level
function _getBand(stress) {
  for (var i = 0; i < TENSION_BANDS.length; i++) {
    var band = TENSION_BANDS[i];
    if (stress >= band.stressRange[0] && stress < band.stressRange[1]) {
      return band;
    }
  }
  return TENSION_BANDS[2]; // default to 'engaged'
}

// Detect stress trend from history window
function _getTrend(history) {
  if (history.length < 4) return 'stable';
  var recent = 0;
  var older = 0;
  var half = Math.floor(history.length / 2);
  for (var i = 0; i < half; i++) older += history[i];
  for (var j = half; j < history.length; j++) recent += history[j];
  older /= half;
  recent /= (history.length - half);

  var delta = recent - older;
  if (delta > 0.08) return 'rising';
  if (delta < -0.08) return 'falling';
  return 'stable';
}

/**
 * Compute elastic difficulty adjustments for a floor.
 * Called each AI tick (~300ms) after director-metrics.computeStress.
 *
 * @param {string} floorId - Zone/floor identifier
 * @param {number} partyStress75th - 75th percentile party stress (0-1)
 * @param {number} playerCount - Number of alive players on floor
 * @returns {object} Adjustment modifiers for this tick
 */
function computeAdjustments(floorId, partyStress75th, playerCount) {
  var es = floorElasticState.get(floorId);
  if (!es) {
    es = {
      smoothedStress: partyStress75th,
      history: [],
      lastBandId: 'engaged',
      bandTransitions: 0,
      tickCount: 0,
    };
    floorElasticState.set(floorId, es);
  }

  // EMA smooth the stress to prevent jitter
  es.smoothedStress = es.smoothedStress * (1 - SMOOTHING_ALPHA) + partyStress75th * SMOOTHING_ALPHA;

  // Track history
  es.history.push(es.smoothedStress);
  if (es.history.length > HISTORY_WINDOW) es.history.shift();
  es.tickCount++;

  // Get band from smoothed stress
  var band = _getBand(es.smoothedStress);

  // Track band transitions (useful for analytics)
  if (band.id !== es.lastBandId) {
    es.bandTransitions++;
    es.lastBandId = band.id;
  }

  var trend = _getTrend(es.history);

  // Build adjustment object
  var adj = {
    bandId: band.id,
    bandLabel: band.label,
    smoothedStress: Math.round(es.smoothedStress * 100) / 100,
    trend: trend,
    reinforcementRate: band.reinforcementRate,
    detectionBonus: band.detectionBonus,
    enemyAggressionMod: band.enemyAggressionMod,
    bossAbilityCooldownMod: band.bossAbilityCooldownMod,
    lootBonusMod: band.lootBonusMod,
    bandTransitions: es.bandTransitions,
  };

  // Trend-based micro-adjustments: if stress is rising fast, ease off preemptively
  if (trend === 'rising' && band.id !== 'overwhelmed') {
    adj.reinforcementRate *= 0.85;
    adj.enemyAggressionMod *= 0.95;
  } else if (trend === 'falling' && band.id !== 'bored') {
    adj.reinforcementRate *= 1.1;
    adj.enemyAggressionMod *= 1.05;
  }

  // Player count scaling: solo players get gentler elastic adjustments
  if (playerCount === 1) {
    // Solo gets more aggressive mercy, less aggressive escalation
    if (adj.reinforcementRate > 1.0) adj.reinforcementRate = 1.0 + (adj.reinforcementRate - 1.0) * 0.5;
    if (adj.reinforcementRate < 1.0) adj.reinforcementRate = 1.0 - (1.0 - adj.reinforcementRate) * 1.3;
    adj.reinforcementRate = Math.max(0.2, adj.reinforcementRate);
  }

  return adj;
}

/**
 * Apply elastic adjustments to a reinforcement cooldown.
 * Modifies the cooldown ticks based on current elastic band.
 *
 * @param {number} baseCooldown - Base cooldown in ticks
 * @param {object} adjustments - From computeAdjustments()
 * @returns {number} Adjusted cooldown
 */
function adjustReinforcementCooldown(baseCooldown, adjustments) {
  if (!adjustments) return baseCooldown;
  // Higher rate = lower cooldown
  return Math.max(10, Math.round(baseCooldown / adjustments.reinforcementRate));
}

/**
 * Apply elastic adjustments to enemy detection radius.
 *
 * @param {number} baseRadius - Base detection radius
 * @param {object} adjustments - From computeAdjustments()
 * @returns {number} Adjusted radius
 */
function adjustDetectionRadius(baseRadius, adjustments) {
  if (!adjustments) return baseRadius;
  return Math.max(2, baseRadius + adjustments.detectionBonus);
}

/**
 * Get loot quality modifier for current elastic state.
 *
 * @param {string} floorId
 * @returns {number} Loot quality multiplier (1.0 = baseline)
 */
function getLootModifier(floorId) {
  var es = floorElasticState.get(floorId);
  if (!es) return 1.0;
  var band = _getBand(es.smoothedStress);
  return band.lootBonusMod;
}

/**
 * Get boss ability cooldown modifier.
 *
 * @param {string} floorId
 * @returns {number} Cooldown multiplier (< 1.0 = faster, > 1.0 = slower)
 */
function getBossAbilityCooldownMod(floorId) {
  var es = floorElasticState.get(floorId);
  if (!es) return 1.0;
  var band = _getBand(es.smoothedStress);
  return band.bossAbilityCooldownMod;
}

/**
 * Get current elastic state summary for a floor (for debugging/UI).
 */
function getFloorElasticState(floorId) {
  var es = floorElasticState.get(floorId);
  if (!es) return null;
  var band = _getBand(es.smoothedStress);
  return {
    bandId: band.id,
    bandLabel: band.label,
    smoothedStress: Math.round(es.smoothedStress * 100) / 100,
    trend: _getTrend(es.history),
    bandTransitions: es.bandTransitions,
    tickCount: es.tickCount,
  };
}

/**
 * Clean up state for a floor that no longer has players.
 */
function cleanupFloor(floorId) {
  floorElasticState.delete(floorId);
}

/**
 * Reset all elastic state (doom ascension / server restart).
 */
function reset() {
  floorElasticState.clear();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  computeAdjustments: computeAdjustments,
  adjustReinforcementCooldown: adjustReinforcementCooldown,
  adjustDetectionRadius: adjustDetectionRadius,
  getLootModifier: getLootModifier,
  getBossAbilityCooldownMod: getBossAbilityCooldownMod,
  getFloorElasticState: getFloorElasticState,
  cleanupFloor: cleanupFloor,
  reset: reset,
  TENSION_BANDS: TENSION_BANDS,
};
