// influence-maps.js
// Faction influence map system.
// Per-chunk faction influence values seeded by structures, spreading to neighbors,
// decaying with distance. Factions control towns when influence exceeds threshold.
// Also provides corruption pressure influence for weighted graph diffusion.

'use strict';

var worldgen = require('./worldgen');
var ca = require('./cellular-automata');

var _io = null;
var _state = null;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var INFLUENCE_TICK_INTERVAL = 600000;  // 10 min between influence ticks
var INFLUENCE_DECAY_RATE = 0.05;       // 5% decay per tick for unsupported influence
var INFLUENCE_SPREAD_RATE = 0.15;      // 15% of source spreads to neighbors per tick
var CONTROL_THRESHOLD = 60;            // influence > 60 = faction controls chunk
var MAX_INFLUENCE = 100;

// Faction structure influence values (seeded by NPCs, player actions, buildings)
var STRUCTURE_INFLUENCE = {
  faction_outpost: 30,
  faction_watchtower: 20,
  faction_banner: 10,
  town_center: 50,
};

// Terrain influence modifiers (roads accelerate, mountains slow)
var TERRAIN_INFLUENCE_MULT = {};
TERRAIN_INFLUENCE_MULT[worldgen.BIOME.MOUNTAIN] = 0.3;       // mountains resist influence
TERRAIN_INFLUENCE_MULT[worldgen.BIOME.WATER] = 0.0;          // water blocks influence
TERRAIN_INFLUENCE_MULT[worldgen.BIOME.DESERT] = 0.7;         // desert slows spread
TERRAIN_INFLUENCE_MULT[worldgen.BIOME.SWAMP] = 0.5;          // swamp resists
TERRAIN_INFLUENCE_MULT[worldgen.BIOME.HOLY_DOMINION] = 1.2;  // holy dominion loyal
TERRAIN_INFLUENCE_MULT[worldgen.BIOME.FOREST] = 0.8;         // forest modest resistance
TERRAIN_INFLUENCE_MULT[worldgen.BIOME.PLAINS] = 1.0;         // plains normal
TERRAIN_INFLUENCE_MULT[worldgen.BIOME.FROSTBOUND] = 0.4;     // frostbound harsh

// Faction home zones — where they seed max influence
var FACTION_HOMES = {
  holy_dominion:    { refX: 35, refY: 42 },
  luminary_inquest: { refX: 45, refY: 55 },
  iron_vanguard:    { refX: 32, refY: 8 },
  khanate:          { refX: 18, refY: 25 },
  veiled_hand:      { refX: 10, refY: 38 },
  lizard_covenant:  { refX: 15, refY: 52 },
  tinkers_council:  { refX: 95, refY: 38 },
  fortune_guild:    { refX: 35, refY: -8 },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// influenceGrid[factionId] = { 'cx,cy': influenceValue (0-100) }
var influenceGrids = {};

// Corruption pressure map: { 'cx,cy': pressure (0-100) }
// Used by weighted graph diffusion model for lich corruption
var corruptionPressure = {};

// Faction control map: { 'cx,cy': factionId } (which faction dominates each chunk)
var controlMap = {};

var lastInfluenceTick = 0;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init(io, state) {
  _io = io;
  _state = state;

  // Initialize faction grids
  for (var fid in FACTION_HOMES) {
    if (!influenceGrids[fid]) influenceGrids[fid] = {};
  }

  // Seed home influence if empty
  if (_isEmpty()) {
    _seedHomeInfluence();
  }
}

function _isEmpty() {
  for (var fid in influenceGrids) {
    if (Object.keys(influenceGrids[fid]).length > 0) return false;
  }
  return true;
}

function _seedHomeInfluence() {
  var ox = worldgen.WORLD_SCALE.originCX;
  var oy = worldgen.WORLD_SCALE.originCY;

  for (var fid in FACTION_HOMES) {
    var home = FACTION_HOMES[fid];
    var cx = ox + home.refX;
    var cy = oy + home.refY;

    // Seed 5-chunk radius around home with decaying influence
    for (var dx = -5; dx <= 5; dx++) {
      for (var dy = -5; dy <= 5; dy++) {
        var dist = Math.abs(dx) + Math.abs(dy);
        if (dist > 5) continue;
        var ncx = cx + dx;
        var ncy = cy + dy;
        var biome = worldgen.getBiome(ncx, ncy);
        if (biome === worldgen.BIOME.WATER) continue;

        var influence = Math.max(10, MAX_INFLUENCE - dist * 15);
        var key = ncx + ',' + ncy;
        influenceGrids[fid][key] = influence;
      }
    }
  }

  _updateControlMap();
  console.log('[influence] Seeded home influence for ' + Object.keys(FACTION_HOMES).length + ' factions');
}

// ---------------------------------------------------------------------------
// Influence tick — weighted graph diffusion
// ---------------------------------------------------------------------------

function _tickInfluence() {
  for (var fid in influenceGrids) {
    var grid = influenceGrids[fid];
    var newGrid = {};
    var keys = Object.keys(grid);

    // Pass 1: decay existing influence
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = grid[key];

      // Home chunks don't decay
      var isHome = _isHomeTerritoryChunk(fid, key);
      if (isHome) {
        newGrid[key] = Math.max(val, 50); // home territory floor
        continue;
      }

      // Decay
      var decayed = val * (1 - INFLUENCE_DECAY_RATE);
      if (decayed < 1) continue; // remove negligible influence
      newGrid[key] = decayed;
    }

    // Pass 2: spread influence to neighbors
    var spreadAdditions = {};
    for (var si = 0; si < keys.length; si++) {
      var skey = keys[si];
      var sval = grid[skey];
      if (sval < 10) continue; // too weak to spread

      var coords = ca.parseKey(skey);
      var neighbors = ca.getNeighbors4(coords[0], coords[1]);

      for (var n = 0; n < neighbors.length; n++) {
        var nkey = neighbors[n];
        var nc = ca.parseKey(nkey);
        var biome = worldgen.getBiome(nc[0], nc[1]);
        var terrainMult = TERRAIN_INFLUENCE_MULT[biome];
        if (terrainMult === undefined) terrainMult = 1.0;
        if (terrainMult === 0) continue; // blocked (water)

        var spreadAmount = sval * INFLUENCE_SPREAD_RATE * terrainMult;

        // Contested: opposing faction influence reduces spread
        var opposingPressure = _getOpposingInfluence(fid, nkey);
        if (opposingPressure > 0) {
          spreadAmount *= Math.max(0.1, 1 - opposingPressure / MAX_INFLUENCE);
        }

        if (spreadAmount < 0.5) continue;

        if (!spreadAdditions[nkey]) spreadAdditions[nkey] = 0;
        spreadAdditions[nkey] += spreadAmount;
      }
    }

    // Apply spread additions
    for (var akey in spreadAdditions) {
      var current = newGrid[akey] || 0;
      newGrid[akey] = Math.min(MAX_INFLUENCE, current + spreadAdditions[akey]);
    }

    influenceGrids[fid] = newGrid;
  }

  _updateControlMap();
}

function _isHomeTerritoryChunk(factionId, key) {
  var home = FACTION_HOMES[factionId];
  if (!home) return false;
  var ox = worldgen.WORLD_SCALE.originCX;
  var oy = worldgen.WORLD_SCALE.originCY;
  var hcx = ox + home.refX;
  var hcy = oy + home.refY;
  var coords = ca.parseKey(key);
  return Math.abs(coords[0] - hcx) + Math.abs(coords[1] - hcy) <= 2;
}

function _getOpposingInfluence(excludeFactionId, key) {
  var maxOpposing = 0;
  for (var fid in influenceGrids) {
    if (fid === excludeFactionId) continue;
    var val = influenceGrids[fid][key] || 0;
    if (val > maxOpposing) maxOpposing = val;
  }
  return maxOpposing;
}

// ---------------------------------------------------------------------------
// Corruption pressure map (weighted graph diffusion for lich system)
// ---------------------------------------------------------------------------

// Update corruption pressure based on corruption sources and terrain resistance
function updateCorruptionPressure(corruptedChunks) {
  corruptionPressure = {};
  if (!corruptedChunks) return;

  var keys = Object.keys(corruptedChunks);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var level = corruptedChunks[key].level || 0;
    if (level < 10) continue;

    // Set base pressure at corrupted chunk
    corruptionPressure[key] = level;

    // Diffuse to neighbors with terrain resistance
    var coords = ca.parseKey(key);
    var neighbors = ca.getNeighbors8(coords[0], coords[1]);
    for (var n = 0; n < neighbors.length; n++) {
      var nkey = neighbors[n];
      var nc = ca.parseKey(nkey);
      var biome = worldgen.getBiome(nc[0], nc[1]);

      // Terrain resistance for corruption
      var resistance = 1.0;
      if (biome === worldgen.BIOME.WATER) resistance = 0.1;
      else if (biome === worldgen.BIOME.MOUNTAIN) resistance = 0.3;
      else if (biome === worldgen.BIOME.HOLY_DOMINION) resistance = 0.4;
      else if (biome === worldgen.BIOME.FOREST) resistance = 0.7;
      else if (biome === worldgen.BIOME.DESERT) resistance = 0.9;
      else if (biome === worldgen.BIOME.SWAMP) resistance = 1.2; // swamp amplifies

      var pressure = level * 0.3 * resistance;
      if (pressure < 1) continue;

      var existing = corruptionPressure[nkey] || 0;
      corruptionPressure[nkey] = Math.min(MAX_INFLUENCE, existing + pressure);
    }
  }
}

// Get corruption spread weight for a target chunk (used by lich director)
function getCorruptionSpreadWeight(cx, cy) {
  var key = cx + ',' + cy;
  var pressure = corruptionPressure[key] || 0;
  var biome = worldgen.getBiome(cx, cy);

  // Base terrain resistance
  var resistance = 1.0;
  if (biome === worldgen.BIOME.WATER) resistance = 0.1;
  else if (biome === worldgen.BIOME.MOUNTAIN) resistance = 0.3;
  else if (biome === worldgen.BIOME.HOLY_DOMINION) resistance = 0.4;
  else if (biome === worldgen.BIOME.FOREST) resistance = 0.7;

  // Holy faction influence reduces corruption spread
  var holyInfluence = (influenceGrids.holy_dominion || {})[key] || 0;
  if (holyInfluence > 30) {
    resistance *= Math.max(0.2, 1 - holyInfluence / 200);
  }

  return {
    pressure: pressure,
    resistance: resistance,
    weight: pressure * resistance,
  };
}

// ---------------------------------------------------------------------------
// Control map
// ---------------------------------------------------------------------------

function _updateControlMap() {
  controlMap = {};
  // Collect all unique chunk keys across all factions
  var allKeys = {};
  for (var fid in influenceGrids) {
    var keys = Object.keys(influenceGrids[fid]);
    for (var i = 0; i < keys.length; i++) {
      allKeys[keys[i]] = true;
    }
  }

  for (var key in allKeys) {
    var bestFaction = null;
    var bestInfluence = 0;
    for (var fid in influenceGrids) {
      var val = influenceGrids[fid][key] || 0;
      if (val > bestInfluence) {
        bestInfluence = val;
        bestFaction = fid;
      }
    }
    if (bestFaction && bestInfluence >= CONTROL_THRESHOLD) {
      controlMap[key] = bestFaction;
    }
  }
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

function getControllingFaction(cx, cy) {
  return controlMap[cx + ',' + cy] || null;
}

function getFactionInfluence(factionId, cx, cy) {
  var grid = influenceGrids[factionId];
  if (!grid) return 0;
  return grid[cx + ',' + cy] || 0;
}

function getInfluenceForArea(centerCX, centerCY, radius) {
  var result = {};
  for (var dx = -radius; dx <= radius; dx++) {
    for (var dy = -radius; dy <= radius; dy++) {
      var key = (centerCX + dx) + ',' + (centerCY + dy);
      if (controlMap[key]) {
        result[key] = controlMap[key];
      }
    }
  }
  return result;
}

// Add influence from player action (quest completion, structure placement)
function addPlayerInfluence(factionId, cx, cy, amount) {
  if (!influenceGrids[factionId]) influenceGrids[factionId] = {};
  var key = cx + ',' + cy;
  var current = influenceGrids[factionId][key] || 0;
  influenceGrids[factionId][key] = Math.min(MAX_INFLUENCE, current + amount);
}

// ---------------------------------------------------------------------------
// Main tick
// ---------------------------------------------------------------------------

function tick(io, state) {
  if (!_io) _io = io;
  if (!_state) _state = state;

  var now = Date.now();
  if (now - lastInfluenceTick < INFLUENCE_TICK_INTERVAL) return;
  lastInfluenceTick = now;

  _tickInfluence();
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function getState() {
  return {
    influenceGrids: influenceGrids,
    controlMap: controlMap,
    lastInfluenceTick: lastInfluenceTick,
  };
}

function loadState(saved) {
  if (!saved) return;
  if (saved.influenceGrids) influenceGrids = saved.influenceGrids;
  if (saved.controlMap) controlMap = saved.controlMap;
  if (saved.lastInfluenceTick) lastInfluenceTick = saved.lastInfluenceTick;
  var totalCells = 0;
  for (var fid in influenceGrids) totalCells += Object.keys(influenceGrids[fid]).length;
  console.log('[influence] Loaded state: ' + totalCells + ' influence cells');
}

function reset() {
  influenceGrids = {};
  controlMap = {};
  corruptionPressure = {};
  lastInfluenceTick = 0;
  for (var fid in FACTION_HOMES) {
    influenceGrids[fid] = {};
  }
  _seedHomeInfluence();
  console.log('[influence] State fully reset');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  init: init,
  tick: tick,
  reset: reset,
  getState: getState,
  loadState: loadState,

  // Faction queries
  getControllingFaction: getControllingFaction,
  getFactionInfluence: getFactionInfluence,
  getInfluenceForArea: getInfluenceForArea,
  addPlayerInfluence: addPlayerInfluence,

  // Corruption pressure (for lich director)
  updateCorruptionPressure: updateCorruptionPressure,
  getCorruptionSpreadWeight: getCorruptionSpreadWeight,

  // Constants
  CONTROL_THRESHOLD: CONTROL_THRESHOLD,
  FACTION_HOMES: FACTION_HOMES,
};
