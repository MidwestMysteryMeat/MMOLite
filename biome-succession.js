// biome-succession.js
// Ecological succession CA — chunks track ecological state.
// Natural progression based on neighbor count. Corruption reverts.
// Post-doom recovery regrows the world.

'use strict';

var ca = require('./cellular-automata');
var worldgen = require('./worldgen');

var _state = null;

var ES = ca.ECOLOGY_STATE;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var SUCCESSION_TICK_INTERVAL = 3600000; // 1 hour between ecology ticks

// Transition rules: how many neighbors of target state needed to advance
var ADVANCE_RULES = {};
ADVANCE_RULES[ES.BARREN]    = { target: ES.GRASSLAND,  minNeighbors: 2, chance: 0.15 };
ADVANCE_RULES[ES.GRASSLAND] = { target: ES.SCRUBLAND,  minNeighbors: 3, chance: 0.10 };
ADVANCE_RULES[ES.SCRUBLAND] = { target: ES.FOREST,     minNeighbors: 3, chance: 0.08 };
ADVANCE_RULES[ES.FOREST]    = { target: ES.OLD_GROWTH, minNeighbors: 4, chance: 0.05 };

// Biomes that support ecological growth
var GROWABLE_BIOMES = {};
GROWABLE_BIOMES[worldgen.BIOME.PLAINS] = true;
GROWABLE_BIOMES[worldgen.BIOME.FOREST] = true;
GROWABLE_BIOMES[worldgen.BIOME.SWAMP] = true;
GROWABLE_BIOMES[worldgen.BIOME.HOLY_DOMINION] = true;
GROWABLE_BIOMES[worldgen.BIOME.STEPPES] = true;

// Biomes with reduced growth
var SLOW_GROWTH_BIOMES = {};
SLOW_GROWTH_BIOMES[worldgen.BIOME.DESERT] = 0.2;
SLOW_GROWTH_BIOMES[worldgen.BIOME.MOUNTAIN] = 0.4;
SLOW_GROWTH_BIOMES[worldgen.BIOME.FROSTBOUND] = 0.3;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// ecologyGrid: 'cx,cy' -> { state: ES.*, ticksInState }
var ecologyGrid = {};
var lastSuccessionTick = 0;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init(state) {
  _state = state;

  if (Object.keys(ecologyGrid).length === 0) {
    _seedEcology();
  }
}

function _seedEcology() {
  var ox = worldgen.WORLD_SCALE.originCX;
  var oy = worldgen.WORLD_SCALE.originCY;

  // Seed ecology for the playable area based on biome
  for (var dx = -50; dx <= 100; dx++) {
    for (var dy = -50; dy <= 80; dy++) {
      var cx = ox + dx;
      var cy = oy + dy;
      var biome = worldgen.getBiome(cx, cy);

      // Only seed growable and slow-growth biomes
      if (!GROWABLE_BIOMES[biome] && SLOW_GROWTH_BIOMES[biome] === undefined) continue;

      var state;
      if (biome === worldgen.BIOME.FOREST) {
        state = ES.FOREST;
      } else if (biome === worldgen.BIOME.SWAMP) {
        state = ES.SCRUBLAND;
      } else if (biome === worldgen.BIOME.PLAINS || biome === worldgen.BIOME.HOLY_DOMINION) {
        state = ES.GRASSLAND;
      } else if (biome === worldgen.BIOME.DESERT || biome === worldgen.BIOME.FROSTBOUND) {
        state = ES.BARREN;
      } else {
        state = ES.GRASSLAND;
      }

      ecologyGrid[cx + ',' + cy] = { state: state, ticksInState: 0 };
    }
  }

  console.log('[ecology] Seeded ' + Object.keys(ecologyGrid).length + ' ecology cells');
}

// ---------------------------------------------------------------------------
// Succession tick
// ---------------------------------------------------------------------------

function _tickSuccession(corruptedChunks) {
  var nextGrid = {};
  var changes = 0;
  var keys = Object.keys(ecologyGrid);

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var cell = ecologyGrid[key];
    var coords = ca.parseKey(key);
    var cx = coords[0];
    var cy = coords[1];

    // Copy cell
    var newCell = { state: cell.state, ticksInState: cell.ticksInState + 1 };

    // Check if corruption is present — revert toward barren
    if (corruptedChunks && corruptedChunks[key]) {
      var corruptionLevel = corruptedChunks[key].level || 0;
      if (corruptionLevel >= 50 && cell.state > ES.BARREN) {
        // High corruption forces regression
        if (Math.random() < 0.3) {
          newCell.state = cell.state - 1;
          newCell.ticksInState = 0;
          changes++;
        }
      } else if (corruptionLevel >= 20 && cell.state > ES.GRASSLAND) {
        // Moderate corruption slows growth
        if (Math.random() < 0.1) {
          newCell.state = cell.state - 1;
          newCell.ticksInState = 0;
          changes++;
        }
      }
      nextGrid[key] = newCell;
      continue;
    }

    // Natural succession: check neighbor counts
    var rule = ADVANCE_RULES[cell.state];
    if (rule) {
      var nkeys = ca.getNeighbors8(cx, cy);
      var advancedNeighbors = 0;
      for (var n = 0; n < nkeys.length; n++) {
        var ncell = ecologyGrid[nkeys[n]];
        if (ncell && ncell.state >= rule.target) advancedNeighbors++;
      }

      if (advancedNeighbors >= rule.minNeighbors) {
        var chance = rule.chance;

        // Biome growth modifier
        var biome = worldgen.getBiome(cx, cy);
        if (SLOW_GROWTH_BIOMES[biome] !== undefined) {
          chance *= SLOW_GROWTH_BIOMES[biome];
        }

        // Weather modifier: rain helps growth
        if (_state && _state.getBiomeWeather) {
          var weather = _state.getBiomeWeather(biome);
          if (weather === 'rain') chance *= 1.5;
          else if (weather === 'storm') chance *= 0.5;
        }

        if (Math.random() < chance) {
          newCell.state = rule.target;
          newCell.ticksInState = 0;
          changes++;
        }
      }
    }

    nextGrid[key] = newCell;
  }

  ecologyGrid = nextGrid;
  return changes;
}

// ---------------------------------------------------------------------------
// External triggers
// ---------------------------------------------------------------------------

// Logging/mining reverts ecology
function damageEcology(cx, cy, severity) {
  var key = cx + ',' + cy;
  var cell = ecologyGrid[key];
  if (!cell) return;

  if (severity === 'heavy' && cell.state > ES.BARREN) {
    cell.state = ES.BARREN;
    cell.ticksInState = 0;
  } else if (severity === 'light' && cell.state > ES.GRASSLAND) {
    cell.state = cell.state - 1;
    cell.ticksInState = 0;
  }
}

// Force revert after doom ascension
function revertAll() {
  var keys = Object.keys(ecologyGrid);
  for (var i = 0; i < keys.length; i++) {
    ecologyGrid[keys[i]].state = ES.GRASSLAND;
    ecologyGrid[keys[i]].ticksInState = 0;
  }
  console.log('[ecology] All ecology reverted to grassland (post-doom)');
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function getEcologyState(cx, cy) {
  var cell = ecologyGrid[cx + ',' + cy];
  return cell ? cell.state : -1;
}

function getEcologyName(state) {
  switch (state) {
    case ES.BARREN: return 'barren';
    case ES.GRASSLAND: return 'grassland';
    case ES.SCRUBLAND: return 'scrubland';
    case ES.FOREST: return 'forest';
    case ES.OLD_GROWTH: return 'old_growth';
    default: return 'unknown';
  }
}

function getEcologyForArea(centerCX, centerCY, radius) {
  var result = {};
  for (var dx = -radius; dx <= radius; dx++) {
    for (var dy = -radius; dy <= radius; dy++) {
      var key = (centerCX + dx) + ',' + (centerCY + dy);
      if (ecologyGrid[key]) {
        result[key] = ecologyGrid[key].state;
      }
    }
  }
  return result;
}

// Resource bonus based on ecology state
function getResourceBonus(cx, cy) {
  var cell = ecologyGrid[cx + ',' + cy];
  if (!cell) return 1.0;
  switch (cell.state) {
    case ES.BARREN: return 0.5;
    case ES.GRASSLAND: return 0.8;
    case ES.SCRUBLAND: return 1.0;
    case ES.FOREST: return 1.3;
    case ES.OLD_GROWTH: return 1.6;
    default: return 1.0;
  }
}

// ---------------------------------------------------------------------------
// Main tick
// ---------------------------------------------------------------------------

function tick(state, corruptedChunks) {
  if (!_state) _state = state;

  var now = Date.now();
  if (now - lastSuccessionTick < SUCCESSION_TICK_INTERVAL) return;
  lastSuccessionTick = now;

  var changes = _tickSuccession(corruptedChunks);
  if (changes > 0) {
    console.log('[ecology] Succession tick: ' + changes + ' state changes');
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function getState() {
  return {
    ecologyGrid: ecologyGrid,
    lastSuccessionTick: lastSuccessionTick,
  };
}

function loadState(saved) {
  if (!saved) return;
  if (saved.ecologyGrid) ecologyGrid = saved.ecologyGrid;
  if (saved.lastSuccessionTick) lastSuccessionTick = saved.lastSuccessionTick;
  console.log('[ecology] Loaded state: ' + Object.keys(ecologyGrid).length + ' ecology cells');
}

function reset() {
  ecologyGrid = {};
  lastSuccessionTick = 0;
  _seedEcology();
  console.log('[ecology] State fully reset');
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
  revertAll: revertAll,
  damageEcology: damageEcology,

  // Queries
  getEcologyState: getEcologyState,
  getEcologyName: getEcologyName,
  getEcologyForArea: getEcologyForArea,
  getResourceBonus: getResourceBonus,

  // Constants
  ECOLOGY_STATE: ES,
};
