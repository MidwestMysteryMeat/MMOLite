// director/director-metrics.js
// Per-player stress tracking for the AI Event Director.
// Tracks HP, damage taken, deaths, idle time, and computes a stress level (0-1)
// that drives micro/zone/macro director decisions.

'use strict';

// ---------------------------------------------------------------------------
// Stress formula weights
// ---------------------------------------------------------------------------
var HP_FACTOR_WEIGHT    = 0.40;
var DAMAGE_FACTOR_WEIGHT = 0.35;
var DEATH_FACTOR_WEIGHT = 0.25;

// Damage decay per tick (10% decay each AI tick ~300ms)
var DAMAGE_DECAY_RATE = 0.10;

// Tier thresholds
var STRUGGLING_STRESS = 0.6;
var STRUGGLING_DEATHS = 3;
var THRIVING_STRESS   = 0.2;
var THRIVING_HP_PCT   = 0.80;

// ---------------------------------------------------------------------------
// Per-player metrics storage
// ---------------------------------------------------------------------------

/** @type {Map<string, object>} socketId -> MetricsObject */
var playerMetrics = new Map();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize metrics for a player entering the dungeon system.
 */
function initPlayer(socketId, accountData) {
  var overallLevel = (accountData && accountData.level) || 1;
  var cardPowerScore = 0;
  if (accountData && accountData.rpgCards) {
    var cards = accountData.rpgCards;
    for (var i = 0; i < cards.length; i++) {
      cardPowerScore += (cards[i].power || 0);
    }
  }

  playerMetrics.set(socketId, {
    stressLevel: 0,
    recentDamageTaken: 0,
    currentHpPercent: 1.0,
    sessionDeaths: 0,
    playerTier: 'average',   // struggling, average, thriving
    currentDungeonFloor: 0,
    idleSeconds: 0,
    overallLevel: overallLevel,
    cardPowerScore: cardPowerScore,
    lastActivityAt: Date.now(),
    // Skill metrics
    totalTurns: 0,
    effectiveTurns: 0,       // turns where player dealt damage or healed
    totalDamageDealt: 0,
    totalApSpent: 0,
    turnEfficiency: 0,       // effectiveTurns / totalTurns (0-1)
    damagePerAp: 0,          // totalDamageDealt / totalApSpent
    combatRating: 0,         // composite skill score (0-1)
  });
}

/**
 * Remove metrics when player disconnects.
 */
function removePlayer(socketId) {
  playerMetrics.delete(socketId);
}

/**
 * Record damage taken by a player (called from processAIResults).
 */
function recordDamageTaken(socketId, damage) {
  var m = playerMetrics.get(socketId);
  if (!m) return;
  m.recentDamageTaken += damage;
  m.lastActivityAt = Date.now();
}

/**
 * Update player's current HP percentage.
 */
function updateHpPercent(socketId, currentHp, maxHp) {
  var m = playerMetrics.get(socketId);
  if (!m) return;
  if (maxHp > 0) {
    m.currentHpPercent = Math.max(0, Math.min(1, currentHp / maxHp));
  }
}

/**
 * Record a player death.
 */
function recordDeath(socketId) {
  var m = playerMetrics.get(socketId);
  if (!m) return;
  m.sessionDeaths++;
  m.lastActivityAt = Date.now();
}

/**
 * Update which floor a player is on.
 */
function setFloor(socketId, floorNum) {
  var m = playerMetrics.get(socketId);
  if (!m) return;
  m.currentDungeonFloor = floorNum;
}

/**
 * Record player activity (movement, attack, etc.) to reset idle timer.
 */
function recordActivity(socketId) {
  var m = playerMetrics.get(socketId);
  if (!m) return;
  m.lastActivityAt = Date.now();
}

/**
 * Record that a player completed a combat turn.
 * @param {string} socketId
 * @param {number} damageDealt - total damage the player dealt this turn
 * @param {number} apSpent - action points spent this turn (usually 1)
 * @param {boolean} wasEffective - true if the turn dealt damage or healed an ally
 */
function recordTurn(socketId, damageDealt, apSpent, wasEffective) {
  var m = playerMetrics.get(socketId);
  if (!m) return;
  m.totalTurns++;
  if (wasEffective) m.effectiveTurns++;
  m.totalDamageDealt += (damageDealt || 0);
  m.totalApSpent += (apSpent || 1);
  m.lastActivityAt = Date.now();
}

/**
 * Compute stress for a single player. Called each AI tick.
 * Decays damage, updates idle time, classifies tier.
 */
function computeStress(socketId) {
  var m = playerMetrics.get(socketId);
  if (!m) return null;

  // Decay recent damage
  m.recentDamageTaken *= (1 - DAMAGE_DECAY_RATE);
  if (m.recentDamageTaken < 0.5) m.recentDamageTaken = 0;

  // Update idle seconds
  m.idleSeconds = (Date.now() - m.lastActivityAt) / 1000;

  // HP factor: 0 at full HP, 1 at 0 HP
  var hpFactor = 1 - m.currentHpPercent;

  // Damage factor: normalize recent damage (cap at ~100 for full stress)
  var damageFactor = Math.min(1, m.recentDamageTaken / 100);

  // Death factor: 0 at 0 deaths, approaches 1 at 5+ deaths
  var deathFactor = Math.min(1, m.sessionDeaths / 5);

  // Weighted stress
  m.stressLevel = (hpFactor * HP_FACTOR_WEIGHT) +
                  (damageFactor * DAMAGE_FACTOR_WEIGHT) +
                  (deathFactor * DEATH_FACTOR_WEIGHT);
  m.stressLevel = Math.max(0, Math.min(1, m.stressLevel));

  // Compute skill metrics
  if (m.totalTurns > 0) {
    m.turnEfficiency = m.effectiveTurns / m.totalTurns;
  }
  if (m.totalApSpent > 0) {
    m.damagePerAp = m.totalDamageDealt / m.totalApSpent;
  }
  // Combat rating: weighted composite of turn efficiency (40%), normalized
  // damage-per-AP (30%), and survival factor (30%)
  var normDpa = Math.min(1, m.damagePerAp / 50); // 50 dmg/ap = perfect
  var survivalFactor = m.currentHpPercent * (1 - Math.min(1, m.sessionDeaths / 5));
  m.combatRating = m.turnEfficiency * 0.40 + normDpa * 0.30 + survivalFactor * 0.30;
  m.combatRating = Math.max(0, Math.min(1, m.combatRating));

  // Classify tier
  if (m.stressLevel >= STRUGGLING_STRESS || m.sessionDeaths >= STRUGGLING_DEATHS) {
    m.playerTier = 'struggling';
  } else if (m.stressLevel <= THRIVING_STRESS && m.sessionDeaths === 0 && m.currentHpPercent > THRIVING_HP_PCT) {
    m.playerTier = 'thriving';
  } else {
    m.playerTier = 'average';
  }

  return m;
}

/**
 * Get metrics for a single player.
 */
function getPlayerMetrics(socketId) {
  return playerMetrics.get(socketId) || null;
}

/**
 * Compute 75th-percentile stress from a list of socket IDs.
 * This protects the weakest member of the party.
 */
function getPartyStress75th(socketIds) {
  if (!socketIds || socketIds.length === 0) return 0;

  var stresses = [];
  for (var i = 0; i < socketIds.length; i++) {
    var m = playerMetrics.get(socketIds[i]);
    if (m) stresses.push(m.stressLevel);
  }
  if (stresses.length === 0) return 0;

  stresses.sort(function(a, b) { return a - b; });
  var idx = Math.floor(stresses.length * 0.75);
  idx = Math.min(idx, stresses.length - 1);
  return stresses[idx];
}

/**
 * Zone-level aggregation: returns tier distribution for players in a zone.
 */
function getZoneAggregates(socketIds) {
  var result = {
    total: 0,
    struggling: 0,
    average: 0,
    thriving: 0,
    avgStress: 0,
    avgIdleSeconds: 0,
  };
  if (!socketIds || socketIds.length === 0) return result;

  var totalStress = 0;
  var totalIdle = 0;
  for (var i = 0; i < socketIds.length; i++) {
    var m = playerMetrics.get(socketIds[i]);
    if (!m) continue;
    result.total++;
    totalStress += m.stressLevel;
    totalIdle += m.idleSeconds;
    if (m.playerTier === 'struggling') result.struggling++;
    else if (m.playerTier === 'thriving') result.thriving++;
    else result.average++;
  }

  if (result.total > 0) {
    result.avgStress = totalStress / result.total;
    result.avgIdleSeconds = totalIdle / result.total;
  }
  return result;
}

/**
 * Global aggregation: returns server-wide metrics summary.
 */
function getGlobalAggregates() {
  var result = {
    totalPlayers: 0,
    avgStress: 0,
    idleRate: 0,
    dungeonParticipation: 0,
    tierBreakdown: { struggling: 0, average: 0, thriving: 0 },
  };

  var totalStress = 0;
  var idleCount = 0;
  var dungeonCount = 0;

  playerMetrics.forEach(function(m) {
    result.totalPlayers++;
    totalStress += m.stressLevel;
    if (m.idleSeconds > 60) idleCount++;
    if (m.currentDungeonFloor > 0) dungeonCount++;

    if (m.playerTier === 'struggling') result.tierBreakdown.struggling++;
    else if (m.playerTier === 'thriving') result.tierBreakdown.thriving++;
    else result.tierBreakdown.average++;
  });

  if (result.totalPlayers > 0) {
    result.avgStress = totalStress / result.totalPlayers;
    result.idleRate = idleCount / result.totalPlayers;
    result.dungeonParticipation = dungeonCount / result.totalPlayers;
  }
  return result;
}

/**
 * Get all tracked socket IDs.
 */
function getAllPlayerIds() {
  var ids = [];
  playerMetrics.forEach(function(_, sid) { ids.push(sid); });
  return ids;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  initPlayer: initPlayer,
  removePlayer: removePlayer,
  recordDamageTaken: recordDamageTaken,
  updateHpPercent: updateHpPercent,
  recordDeath: recordDeath,
  setFloor: setFloor,
  recordActivity: recordActivity,
  recordTurn: recordTurn,
  computeStress: computeStress,
  getPlayerMetrics: getPlayerMetrics,
  getPartyStress75th: getPartyStress75th,
  getZoneAggregates: getZoneAggregates,
  getGlobalAggregates: getGlobalAggregates,
  getAllPlayerIds: getAllPlayerIds,
};
