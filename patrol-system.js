// patrol-system.js
// ACO-based NPC patrol system for visible faction army movement.
// Pheromone trails on the chunk grid guide patrol units along emergent routes.
// Faction patrols deposit pheromone as they move — well-patrolled borders
// accumulate influence, neglected areas lose it.
//
// Patrol types:
//   lich_horde     — undead hordes marching from corruption toward towns
//   luminary       — Holy Dominion paladins patrolling holy borders
//   bandit         — bandit warbands roaming between camps
//   faction_army   — generic faction military patrols

'use strict';

var na = require('./nature-algorithms');
var worldgen = require('./worldgen');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var PATROL_TICK_INTERVAL = 60000; // 60s between patrol movement ticks
var MAX_PATROLS_PER_FACTION = 8;
var PATROL_LIFESPAN_MS = 30 * 60 * 1000; // 30 min max lifespan
var PATROL_STEP_RANGE = 2; // max chunks moved per tick

// Faction configurations
var FACTION_CONFIGS = {
  lich_horde: {
    color: '#44ff44',
    hostile: true,
    baseStrength: 5,
    spawnNearCorruption: true,
    targetTowns: true,
    depositAmount: 1.5,
    description: 'Undead Horde',
  },
  luminary: {
    color: '#ffdd44',
    hostile: false,
    baseStrength: 8,
    spawnNearTowns: true,
    patrolBorders: true,
    depositAmount: 1.0,
    description: 'Luminary Patrol',
  },
  bandit: {
    color: '#cc4444',
    hostile: true,
    baseStrength: 3,
    spawnWilderness: true,
    targetRoads: true,
    depositAmount: 0.8,
    description: 'Bandit Warband',
  },
  faction_army: {
    color: '#4488ff',
    hostile: false,
    baseStrength: 6,
    spawnNearTowns: true,
    patrolBorders: true,
    depositAmount: 1.0,
    description: 'Faction Army',
  },
};

// Heuristic weights for ACO path selection
function _borderHeuristic(cx, cy, targetCX, targetCY) {
  // Inverse distance to target: closer = more attractive
  var dist = Math.abs(cx - targetCX) + Math.abs(cy - targetCY);
  return 1.0 / (1 + dist * 0.1);
}

function _wildernessHeuristic(cx, cy) {
  // Prefer chunks far from towns
  var originCX = worldgen.WORLD_SCALE.originCX;
  var originCY = worldgen.WORLD_SCALE.originCY;
  var minTownDist = Infinity;
  var towns = TOWN_POSITIONS;
  for (var ti = 0; ti < towns.length; ti++) {
    var d = Math.abs(cx - (originCX + towns[ti].refX)) + Math.abs(cy - (originCY + towns[ti].refY));
    if (d < minTownDist) minTownDist = d;
  }
  return Math.min(2.0, minTownDist * 0.1);
}

// Town positions (shared with director-lich)
var TOWN_POSITIONS = [
  { id: 'starter_town', name: 'The Holy Dominion', refX: 35, refY: 42 },
  { id: 'solara', name: 'Solara', refX: 40, refY: 38 },
  { id: 'sylvaris', name: 'Sylvaris', refX: 45, refY: 55 },
  { id: 'ironhold', name: 'Ironhold', refX: 32, refY: 8 },
  { id: 'kragmor', name: 'Kragmor', refX: 18, refY: 25 },
  { id: 'bonetrap', name: 'BoneTrap', refX: 10, refY: 38 },
  { id: 'murkmire', name: 'Murkmire', refX: 15, refY: 52 },
  { id: 'mechspire', name: 'Mechspire', refX: 95, refY: 38 },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

var aco = null;  // ACO instance (created on init)
var patrols = []; // array of { id, factionId, cx, cy, targetCX, targetCY, strength, path, spawnedAt, config }
var _io = null;
var _state = null;
var lastTick = 0;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function init(io, state) {
  _io = io;
  _state = state;

  aco = na.createACO({
    factions: Object.keys(FACTION_CONFIGS),
    evaporationRate: 0.03,
    depositAmount: 1.0,
    alpha: 1.0,
    beta: 2.5,
    initialPheromone: 0.1,
  });

  console.log('[patrol] ACO patrol system initialized (' + Object.keys(FACTION_CONFIGS).length + ' factions)');
}

// ---------------------------------------------------------------------------
// Patrol spawning
// ---------------------------------------------------------------------------

function _countPatrolsForFaction(factionId) {
  var count = 0;
  for (var i = 0; i < patrols.length; i++) {
    if (patrols[i].factionId === factionId) count++;
  }
  return count;
}

function _pickRandomTown() {
  return TOWN_POSITIONS[Math.floor(Math.random() * TOWN_POSITIONS.length)];
}

function spawnPatrol(factionId, cx, cy, targetCX, targetCY, strength) {
  var config = FACTION_CONFIGS[factionId];
  if (!config) return null;

  if (_countPatrolsForFaction(factionId) >= MAX_PATROLS_PER_FACTION) return null;

  var patrol = {
    id: factionId + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    factionId: factionId,
    cx: cx,
    cy: cy,
    targetCX: targetCX,
    targetCY: targetCY,
    strength: strength || config.baseStrength,
    path: [{ cx: cx, cy: cy }],
    spawnedAt: Date.now(),
    description: config.description,
    hostile: config.hostile,
    color: config.color,
  };

  patrols.push(patrol);

  // Broadcast spawn
  if (_io) {
    _io.emit('patrol_spawned', {
      id: patrol.id,
      factionId: factionId,
      cx: cx,
      cy: cy,
      targetCX: targetCX,
      targetCY: targetCY,
      strength: patrol.strength,
      description: patrol.description,
      hostile: patrol.hostile,
      color: patrol.color,
    });
  }

  return patrol;
}

// Spawn luminary patrol from a random town, patrolling border
function spawnLuminaryPatrol() {
  var originCX = worldgen.WORLD_SCALE.originCX;
  var originCY = worldgen.WORLD_SCALE.originCY;
  var town = _pickRandomTown();
  var spawnCX = originCX + town.refX;
  var spawnCY = originCY + town.refY;

  // Target: another town (patrol route between towns)
  var target = _pickRandomTown();
  while (target.id === town.id) target = _pickRandomTown();
  var targetCX = originCX + target.refX;
  var targetCY = originCY + target.refY;

  return spawnPatrol('luminary', spawnCX, spawnCY, targetCX, targetCY, 6 + Math.floor(Math.random() * 4));
}

// Spawn bandit warband in wilderness between towns
function spawnBanditPatrol() {
  var originCX = worldgen.WORLD_SCALE.originCX;
  var originCY = worldgen.WORLD_SCALE.originCY;
  // Pick a wild area between two towns
  var t1 = _pickRandomTown();
  var t2 = _pickRandomTown();
  while (t2.id === t1.id) t2 = _pickRandomTown();

  var midCX = originCX + Math.floor((t1.refX + t2.refX) / 2) + Math.floor(Math.random() * 6) - 3;
  var midCY = originCY + Math.floor((t1.refY + t2.refY) / 2) + Math.floor(Math.random() * 6) - 3;

  // Target: roam toward a town
  var targetTown = _pickRandomTown();
  return spawnPatrol('bandit', midCX, midCY, originCX + targetTown.refX, originCY + targetTown.refY, 2 + Math.floor(Math.random() * 4));
}

// Spawn lich horde from corrupted chunk toward nearest town
function spawnLichHorde(corruptedCX, corruptedCY, strength) {
  var originCX = worldgen.WORLD_SCALE.originCX;
  var originCY = worldgen.WORLD_SCALE.originCY;
  // Find nearest town
  var bestTown = null;
  var bestDist = Infinity;
  for (var ti = 0; ti < TOWN_POSITIONS.length; ti++) {
    var t = TOWN_POSITIONS[ti];
    var d = Math.abs(corruptedCX - (originCX + t.refX)) + Math.abs(corruptedCY - (originCY + t.refY));
    if (d < bestDist) { bestDist = d; bestTown = t; }
  }
  if (!bestTown) return null;
  return spawnPatrol('lich_horde', corruptedCX, corruptedCY,
    originCX + bestTown.refX, originCY + bestTown.refY, strength || 5);
}

// ---------------------------------------------------------------------------
// Patrol movement tick — ACO-driven path selection
// ---------------------------------------------------------------------------

function tick() {
  var now = Date.now();
  if (now - lastTick < PATROL_TICK_INTERVAL) return;
  lastTick = now;

  // Evaporate pheromone
  aco.evaporate();

  // Remove expired patrols
  patrols = patrols.filter(function(p) {
    if (now - p.spawnedAt > PATROL_LIFESPAN_MS) {
      if (_io) _io.emit('patrol_despawned', { id: p.id, factionId: p.factionId });
      return false;
    }
    return true;
  });

  // Move each patrol
  for (var pi = 0; pi < patrols.length; pi++) {
    var patrol = patrols[pi];
    _movePatrol(patrol);
  }

  // Auto-spawn patrols if below minimum
  _autoSpawn();
}

function _movePatrol(patrol) {
  var config = FACTION_CONFIGS[patrol.factionId];
  if (!config) return;

  // Build candidate next chunks (4-directional within step range)
  var candidates = [];
  for (var dx = -PATROL_STEP_RANGE; dx <= PATROL_STEP_RANGE; dx++) {
    for (var dy = -PATROL_STEP_RANGE; dy <= PATROL_STEP_RANGE; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (Math.abs(dx) + Math.abs(dy) > PATROL_STEP_RANGE) continue;
      var ncx = patrol.cx + dx;
      var ncy = patrol.cy + dy;
      // Basic bounds check
      if (ncx < 0 || ncy < 0) continue;
      candidates.push({ cx: ncx, cy: ncy });
    }
  }

  if (candidates.length === 0) return;

  // Determine heuristic based on patrol type
  var heuristicFn;
  if (config.targetTowns || config.patrolBorders) {
    heuristicFn = _borderHeuristic;
  } else if (config.spawnWilderness || config.targetRoads) {
    heuristicFn = function(cx, cy) { return _wildernessHeuristic(cx, cy); };
  } else {
    heuristicFn = _borderHeuristic;
  }

  // ACO chooses next chunk
  var next = aco.chooseNext(patrol.factionId, patrol.cx, patrol.cy, candidates,
    heuristicFn, patrol.targetCX, patrol.targetCY);

  if (!next) return;

  // Move
  patrol.cx = next.cx;
  patrol.cy = next.cy;
  patrol.path.push({ cx: next.cx, cy: next.cy });

  // Deposit pheromone at new location
  aco.deposit(patrol.factionId, next.cx, next.cy, config.depositAmount);

  // Broadcast movement
  if (_io) {
    _io.emit('patrol_moved', {
      id: patrol.id,
      factionId: patrol.factionId,
      cx: next.cx,
      cy: next.cy,
      strength: patrol.strength,
    });
  }

  // Check if reached target
  var distToTarget = Math.abs(patrol.cx - patrol.targetCX) + Math.abs(patrol.cy - patrol.targetCY);
  if (distToTarget <= 2) {
    // Patrol reached destination — pick new target or despawn
    if (config.patrolBorders) {
      // Loop: pick a new town target
      var originCX = worldgen.WORLD_SCALE.originCX;
      var originCY = worldgen.WORLD_SCALE.originCY;
      var newTarget = _pickRandomTown();
      patrol.targetCX = originCX + newTarget.refX;
      patrol.targetCY = originCY + newTarget.refY;
    } else {
      // One-way patrols (hordes, bandits) trigger arrival event and despawn
      if (_io) {
        _io.emit('patrol_arrived', {
          id: patrol.id,
          factionId: patrol.factionId,
          cx: patrol.cx,
          cy: patrol.cy,
          strength: patrol.strength,
          hostile: patrol.hostile,
          description: patrol.description,
        });
      }
      // Mark for removal
      patrol.spawnedAt = 0;
    }
  }
}

// Auto-spawn patrols to maintain minimum population
function _autoSpawn() {
  // Luminary patrols: maintain 2-3
  if (_countPatrolsForFaction('luminary') < 2) {
    spawnLuminaryPatrol();
  }

  // Bandit patrols: maintain 1-2
  if (_countPatrolsForFaction('bandit') < 1 && Math.random() < 0.3) {
    spawnBanditPatrol();
  }
}

// ---------------------------------------------------------------------------
// Public query API
// ---------------------------------------------------------------------------

// Get all active patrols (for client rendering)
function getActivePatrols() {
  return patrols.map(function(p) {
    return {
      id: p.id,
      factionId: p.factionId,
      cx: p.cx,
      cy: p.cy,
      strength: p.strength,
      description: p.description,
      hostile: p.hostile,
      color: p.color,
    };
  });
}

// Get patrols near a specific chunk
function getPatrolsNear(cx, cy, radius) {
  var nearby = [];
  for (var i = 0; i < patrols.length; i++) {
    var p = patrols[i];
    if (Math.abs(p.cx - cx) + Math.abs(p.cy - cy) <= radius) {
      nearby.push(p);
    }
  }
  return nearby;
}

// Get pheromone hotspots for a faction (for client visualization)
function getPheromoneHotspots(factionId, topN) {
  if (!aco) return [];
  return aco.getHotspots(factionId, topN || 20);
}

// Reset all patrols (doom ascension / server restart)
function reset() {
  patrols = [];
  if (aco) aco.resetAll();
}

// State persistence
function getState() {
  return {
    patrols: patrols,
    aco: aco ? aco.getState() : null,
  };
}

function loadState(saved) {
  if (!saved) return;
  if (saved.patrols) patrols = saved.patrols;
  if (saved.aco && aco) aco.loadState(saved.aco);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  init: init,
  tick: tick,
  spawnPatrol: spawnPatrol,
  spawnLuminaryPatrol: spawnLuminaryPatrol,
  spawnBanditPatrol: spawnBanditPatrol,
  spawnLichHorde: spawnLichHorde,
  getActivePatrols: getActivePatrols,
  getPatrolsNear: getPatrolsNear,
  getPheromoneHotspots: getPheromoneHotspots,
  reset: reset,
  getState: getState,
  loadState: loadState,
  FACTION_CONFIGS: FACTION_CONFIGS,
};
