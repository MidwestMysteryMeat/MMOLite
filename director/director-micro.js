// director/director-micro.js
// Per-dungeon pacing director (L4D-style).
// Runs inside the existing AI tick loop, adjusting enemy pressure based on
// party stress. 4-state pacing cycle: RELAX -> BUILDUP -> SUSTAINED_PEAK -> PEAK_FADE.

'use strict';

var directorMetrics = require('./director-metrics');
var elasticDifficulty = require('../elastic-difficulty');

// ---------------------------------------------------------------------------
// Pacing state machine
// ---------------------------------------------------------------------------

var PACING = {
  RELAX:          'RELAX',
  BUILDUP:        'BUILDUP',
  SUSTAINED_PEAK: 'SUSTAINED_PEAK',
  PEAK_FADE:      'PEAK_FADE',
};

// Duration in ticks (~300ms each) for each state
var STATE_DURATION = {
  RELAX:          50,   // ~15s of calm
  BUILDUP:        30,   // ~9s ramp up
  SUSTAINED_PEAK: 40,   // ~12s high pressure
  PEAK_FADE:      20,   // ~6s cool down
};

// Detection radius modifiers per state
var DETECTION_MOD = {
  RELAX:          -2,
  BUILDUP:         0,
  SUSTAINED_PEAK: +2,
  PEAK_FADE:      +1,
};

// Stress thresholds that override normal pacing
var STRESS_FORCE_RELAX   = 0.7;   // If 75th percentile stress > 0.7, force relax
var STRESS_SKIP_BUILDUP  = 0.15;  // If stress < 0.15, skip to sustained peak faster

// Reinforcement config
var REINFORCEMENT_COOLDOWN_TICKS = 60;  // ~18s between reinforcement waves
var MAX_REINFORCEMENTS_PER_WAVE  = 2;

// ---------------------------------------------------------------------------
// Per-floor director state
// ---------------------------------------------------------------------------

/** @type {Map<string, object>} zoneId -> floor director state */
var floorDirectorState = new Map();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Called each AI tick (~300ms) for a dungeon floor.
 * Skipped on boss floors and raid floors (those have hand-authored pacing).
 *
 * @param {string} zoneId - The zone/floor identifier
 * @param {object} floor - The floor object with enemies array
 * @param {Array} playerList - Array of {id, x, y} for players on floor
 * @param {object} combatStates - Map of socketId -> combat state
 * @returns {object|null} - Actions to apply: { detectionMod, reinforcements }
 */
function tick(zoneId, floor, playerList, combatStates) {
  if (!playerList || playerList.length === 0) return null;

  // Skip on boss/raid floors
  if (floor.isBossFloor || floor.isRaidBossFloor) return null;

  // Get or create director state for this floor
  var ds = floorDirectorState.get(zoneId);
  if (!ds) {
    ds = {
      pacingState: PACING.RELAX,
      pacingTimer: STATE_DURATION.RELAX,
      partyStress75th: 0,
      detectionRadiusModifier: DETECTION_MOD.RELAX,
      reinforcementCooldown: REINFORCEMENT_COOLDOWN_TICKS,
    };
    floorDirectorState.set(zoneId, ds);
  }

  // Compute stress for all players on this floor
  var socketIds = [];
  for (var i = 0; i < playerList.length; i++) {
    socketIds.push(playerList[i].id);
    directorMetrics.computeStress(playerList[i].id);
  }

  // Get 75th percentile party stress
  ds.partyStress75th = directorMetrics.getPartyStress75th(socketIds);

  // Emergency override: if party is under extreme stress, force RELAX
  if (ds.partyStress75th >= STRESS_FORCE_RELAX && ds.pacingState !== PACING.RELAX) {
    ds.pacingState = PACING.RELAX;
    ds.pacingTimer = STATE_DURATION.RELAX;
  }

  // Tick the pacing timer
  ds.pacingTimer--;
  if (ds.pacingTimer <= 0) {
    // Advance to next state
    switch (ds.pacingState) {
      case PACING.RELAX:
        // If party is very comfortable, accelerate buildup
        if (ds.partyStress75th < STRESS_SKIP_BUILDUP) {
          ds.pacingState = PACING.SUSTAINED_PEAK;
          ds.pacingTimer = STATE_DURATION.SUSTAINED_PEAK;
        } else {
          ds.pacingState = PACING.BUILDUP;
          ds.pacingTimer = STATE_DURATION.BUILDUP;
        }
        break;
      case PACING.BUILDUP:
        ds.pacingState = PACING.SUSTAINED_PEAK;
        ds.pacingTimer = STATE_DURATION.SUSTAINED_PEAK;
        break;
      case PACING.SUSTAINED_PEAK:
        ds.pacingState = PACING.PEAK_FADE;
        ds.pacingTimer = STATE_DURATION.PEAK_FADE;
        break;
      case PACING.PEAK_FADE:
        ds.pacingState = PACING.RELAX;
        ds.pacingTimer = STATE_DURATION.RELAX;
        break;
    }
  }

  // Update detection radius modifier
  ds.detectionRadiusModifier = DETECTION_MOD[ds.pacingState] || 0;

  // Compute elastic difficulty adjustments
  var elastic = elasticDifficulty.computeAdjustments(zoneId, ds.partyStress75th, playerList.length);

  // Apply detection radius adjustments to enemies (pacing + elastic combined)
  var detMod = ds.detectionRadiusModifier;
  for (var ei = 0; ei < floor.enemies.length; ei++) {
    var enemy = floor.enemies[ei];
    if (enemy.alive === false) continue;
    var baseRadius = enemy.baseDetectionRadius || enemy.detectionRadius || 4;
    enemy.detectionRadius = elasticDifficulty.adjustDetectionRadius(baseRadius + detMod, elastic);
  }

  // Handle reinforcements during SUSTAINED_PEAK (elastic adjusts cooldown)
  var reinforcements = null;
  if (ds.pacingState === PACING.SUSTAINED_PEAK) {
    ds.reinforcementCooldown--;
    if (ds.reinforcementCooldown <= 0) {
      reinforcements = spawnReinforcements(floor, playerList);
      ds.reinforcementCooldown = elasticDifficulty.adjustReinforcementCooldown(REINFORCEMENT_COOLDOWN_TICKS, elastic);
    }
  } else {
    // Reset cooldown outside peak
    ds.reinforcementCooldown = elasticDifficulty.adjustReinforcementCooldown(REINFORCEMENT_COOLDOWN_TICKS, elastic);
  }

  return {
    pacingState: ds.pacingState,
    detectionMod: detMod,
    partyStress: ds.partyStress75th,
    elastic: elastic,
    reinforcements: reinforcements,
  };
}

/**
 * Spawn reinforcement enemies from out-of-LOS tiles during sustained peak.
 */
function spawnReinforcements(floor, playerList) {
  if (!floor.enemies || floor.enemies.length === 0) return null;

  // Count alive enemies
  var aliveCount = 0;
  for (var i = 0; i < floor.enemies.length; i++) {
    if (floor.enemies[i].alive !== false) aliveCount++;
  }

  // Don't spawn if already plenty of enemies
  if (aliveCount >= 15) return null;

  // Find a dead enemy to "respawn" (recycle from killed pool)
  var spawned = [];
  var spawnCount = 0;
  for (var j = 0; j < floor.enemies.length && spawnCount < MAX_REINFORCEMENTS_PER_WAVE; j++) {
    var dead = floor.enemies[j];
    if (dead.alive !== false) continue;

    // Find a spawn position away from all players (out of LOS)
    var spawnPos = findOutOfLOSPosition(floor, playerList);
    if (!spawnPos) continue;

    // Revive the enemy at the new position
    dead.alive = true;
    dead.x = spawnPos.x;
    dead.y = spawnPos.y;
    dead.hp = dead.maxHp || 30;
    dead.aiState = 'idle';
    dead.aiTimer = 0;
    dead.targetId = null;
    dead.spawnX = spawnPos.x;
    dead.spawnY = spawnPos.y;
    dead.changed = true;

    spawned.push({
      index: j,
      x: spawnPos.x,
      y: spawnPos.y,
      name: dead.name,
    });
    spawnCount++;
  }

  return spawned.length > 0 ? spawned : null;
}

/**
 * Find a walkable tile that is not in line-of-sight of any player.
 */
function findOutOfLOSPosition(floor, playerList) {
  var grid = floor.grid;
  var width = floor.width;
  var height = floor.height;

  // Try random positions (up to 30 attempts)
  for (var attempt = 0; attempt < 30; attempt++) {
    var x = Math.floor(Math.random() * width);
    var y = Math.floor(Math.random() * height);

    // Must be walkable
    if (grid[y][x] !== 1 && grid[y][x] !== 2) continue; // FLOOR or CORRIDOR

    // Check not occupied by enemy
    var occupied = false;
    for (var ei = 0; ei < floor.enemies.length; ei++) {
      if (floor.enemies[ei].alive !== false && floor.enemies[ei].x === x && floor.enemies[ei].y === y) {
        occupied = true;
        break;
      }
    }
    if (occupied) continue;

    // Check out of LOS from all players (at least 8 tiles away)
    var tooClose = false;
    for (var pi = 0; pi < playerList.length; pi++) {
      var dx = Math.abs(x - playerList[pi].x);
      var dy = Math.abs(y - playerList[pi].y);
      if (dx + dy < 8) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    return { x: x, y: y };
  }
  return null;
}

/**
 * Clean up state for a floor that no longer has players.
 */
function cleanupFloor(zoneId) {
  floorDirectorState.delete(zoneId);
  elasticDifficulty.cleanupFloor(zoneId);
}

/**
 * Get the current pacing state for debugging/UI.
 */
function getFloorState(zoneId) {
  return floorDirectorState.get(zoneId) || null;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  tick: tick,
  cleanupFloor: cleanupFloor,
  getFloorState: getFloorState,
  PACING: PACING,
};
