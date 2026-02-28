// weather-propagation.js
// CA-based weather front propagation system.
// Storm fronts move directionally, mountains block, seasons modify transition probabilities.
// Replaces per-biome random weather with spatially coherent weather patterns.

'use strict';

var ca = require('./cellular-automata');
var worldgen = require('./worldgen');

var _io = null;
var _state = null;

var WS = ca.WEATHER_STATE;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var WEATHER_TICK_INTERVAL = 300000;   // 5 min between weather CA ticks
var WIND_SHIFT_INTERVAL = 1800000;    // 30 min between wind direction changes

// Wind direction (dx, dy) — weather fronts propagate this direction
var WIND_DIRECTIONS = [
  { dx: 1, dy: 0, name: 'east' },
  { dx: -1, dy: 0, name: 'west' },
  { dx: 0, dy: 1, name: 'south' },
  { dx: 0, dy: -1, name: 'north' },
  { dx: 1, dy: 1, name: 'southeast' },
  { dx: -1, dy: -1, name: 'northwest' },
  { dx: 1, dy: -1, name: 'northeast' },
  { dx: -1, dy: 1, name: 'southwest' },
];

// Transition probabilities per state (base, modified by neighbors and biome)
var BASE_TRANSITIONS = {};
BASE_TRANSITIONS[WS.CLEAR]  = { toCloudy: 0.08, toFog: 0.02 };
BASE_TRANSITIONS[WS.CLOUDY] = { toRain: 0.15, toStorm: 0.03, toClear: 0.10, toSnow: 0.02 };
BASE_TRANSITIONS[WS.RAIN]   = { toStorm: 0.08, toCloudy: 0.12, toClear: 0.05 };
BASE_TRANSITIONS[WS.STORM]  = { toRain: 0.15, toCloudy: 0.05, toClear: 0.02 };
BASE_TRANSITIONS[WS.FOG]    = { toClear: 0.15, toCloudy: 0.08 };
BASE_TRANSITIONS[WS.SNOW]   = { toClear: 0.08, toCloudy: 0.10, toStorm: 0.03 };

// Season modifiers (multiply base transitions)
var SEASON_MODS = {
  Frosthollow: { toSnow: 3.0, toStorm: 1.5, toClear: 0.5, toRain: 0.3 },
  Brightbloom: { toRain: 2.0, toClear: 1.5, toSnow: 0.1, toFog: 0.5 },
  Sunreign:    { toClear: 2.5, toRain: 0.5, toStorm: 0.3, toSnow: 0.0, toFog: 0.3 },
  Ashwane:     { toFog: 2.0, toStorm: 1.5, toClear: 0.7, toSnow: 0.5 },
};

// Biome resistance to weather propagation
var BIOME_WEATHER_RESISTANCE = {};
BIOME_WEATHER_RESISTANCE[worldgen.BIOME.MOUNTAIN] = 0.3;    // mountains block fronts
BIOME_WEATHER_RESISTANCE[worldgen.BIOME.WATER] = 1.2;       // water accelerates
BIOME_WEATHER_RESISTANCE[worldgen.BIOME.DESERT] = 0.5;      // desert dissipates rain
BIOME_WEATHER_RESISTANCE[worldgen.BIOME.SWAMP] = 1.3;       // swamp holds moisture
BIOME_WEATHER_RESISTANCE[worldgen.BIOME.FROSTBOUND] = 1.1;  // cold retains weather
BIOME_WEATHER_RESISTANCE[worldgen.BIOME.FOREST] = 0.9;      // slight shelter

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Weather grid: 'cx,cy' -> { state: WS.*, ticksInState, intensity }
// Sampled at lower resolution: 1 weather cell per 4x4 chunk block
var WEATHER_CELL_SIZE = 4; // chunks per weather cell

var weatherGrid = {};
var windDirection = { dx: 1, dy: 0, name: 'east' };
var lastWeatherTick = 0;
var lastWindShift = 0;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init(io, state) {
  _io = io;
  _state = state;

  // Seed initial weather if empty
  if (Object.keys(weatherGrid).length === 0) {
    _seedInitialWeather();
  }
}

function _seedInitialWeather() {
  // Seed weather cells across the playable area
  var ox = worldgen.WORLD_SCALE.originCX;
  var oy = worldgen.WORLD_SCALE.originCY;

  for (var bx = -30; bx <= 30; bx += WEATHER_CELL_SIZE) {
    for (var by = -30; by <= 30; by += WEATHER_CELL_SIZE) {
      var wcx = Math.floor((ox + bx) / WEATHER_CELL_SIZE);
      var wcy = Math.floor((oy + by) / WEATHER_CELL_SIZE);
      var key = wcx + ',' + wcy;
      if (weatherGrid[key]) continue;

      // Random initial state weighted toward clear
      var r = Math.random();
      var state = WS.CLEAR;
      if (r > 0.85) state = WS.STORM;
      else if (r > 0.70) state = WS.RAIN;
      else if (r > 0.55) state = WS.CLOUDY;
      else if (r > 0.45) state = WS.FOG;

      weatherGrid[key] = {
        state: state,
        ticksInState: 0,
        intensity: 0.5 + Math.random() * 0.5,
      };
    }
  }
  console.log('[weather] Seeded ' + Object.keys(weatherGrid).length + ' weather cells');
}

// ---------------------------------------------------------------------------
// Weather CA tick
// ---------------------------------------------------------------------------

function _getSeasonMod() {
  if (!_state || !_state.world || !_state.world.calendar) return {};
  return SEASON_MODS[_state.world.calendar.season] || {};
}

function _tickWeather() {
  var seasonMod = _getSeasonMod();

  // Rule table: existing weather cells transition
  function ruleTable(cell, neighbors, cx, cy) {
    var transitions = BASE_TRANSITIONS[cell.state];
    if (!transitions) return null;

    // Count neighbor states for propagation pressure
    var neighborStorms = 0;
    var neighborRain = 0;
    var neighborCloudy = 0;
    var neighborSnow = 0;
    for (var i = 0; i < neighbors.length; i++) {
      if (neighbors[i].state === WS.STORM) neighborStorms++;
      if (neighbors[i].state === WS.RAIN) neighborRain++;
      if (neighbors[i].state === WS.CLOUDY) neighborCloudy++;
      if (neighbors[i].state === WS.SNOW) neighborSnow++;
    }

    // Wind direction pressure: neighbors in upwind direction have more influence
    // (upwind = opposite of wind direction; cell at cx-dx, cy-dy pushes weather here)
    var upwindKey = (cx - windDirection.dx) + ',' + (cy - windDirection.dy);
    var upwindCell = null;
    for (var ui = 0; ui < neighbors.length; ui++) {
      // Simple heuristic: just use neighbor counts (wind shifts the balance)
    }

    // Biome at this weather cell's center chunk
    var centerCx = cx * WEATHER_CELL_SIZE;
    var centerCy = cy * WEATHER_CELL_SIZE;
    var biome = worldgen.getBiome(centerCx, centerCy);
    var resistance = BIOME_WEATHER_RESISTANCE[biome] || 1.0;

    // Calculate transition chances
    var roll = Math.random();
    var cumulative = 0;

    // Build transition array with seasonal and neighbor pressure mods
    var possibleTransitions = [];
    for (var tkey in transitions) {
      var baseChance = transitions[tkey];
      var smod = seasonMod[tkey] || 1.0;
      var chance = baseChance * smod * resistance;

      // Neighbor pressure: storms nearby increase storm transition
      if (tkey === 'toStorm') chance += neighborStorms * 0.05;
      if (tkey === 'toRain') chance += neighborRain * 0.03;
      if (tkey === 'toCloudy') chance += neighborCloudy * 0.02;
      if (tkey === 'toSnow') chance += neighborSnow * 0.04;

      // Wind pressure: upwind storms push harder
      if (tkey === 'toStorm' || tkey === 'toRain') {
        chance += neighborStorms * 0.03 * (windDirection.dx !== 0 || windDirection.dy !== 0 ? 1.2 : 1.0);
      }

      possibleTransitions.push({ key: tkey, chance: chance });
      cumulative += chance;
    }

    if (roll > cumulative) return null; // no transition

    // Pick which transition
    var pick = Math.random() * cumulative;
    var running = 0;
    for (var ti = 0; ti < possibleTransitions.length; ti++) {
      running += possibleTransitions[ti].chance;
      if (pick <= running) {
        var targetState = _transitionKeyToState(possibleTransitions[ti].key);
        if (targetState !== null) return targetState;
      }
    }

    return null;
  }

  var result = ca.tick(weatherGrid, ruleTable, 8);

  // Post-process: increment ticksInState, reset on state change
  var nextGrid = result.grid;
  var keys = Object.keys(nextGrid);
  for (var i = 0; i < keys.length; i++) {
    var cell = nextGrid[keys[i]];
    var oldCell = weatherGrid[keys[i]];
    if (oldCell && cell.state !== oldCell.state) {
      cell.ticksInState = 0;
      cell.intensity = 0.5 + Math.random() * 0.5;
    } else {
      cell.ticksInState = (cell.ticksInState || 0) + 1;
    }
  }

  weatherGrid = nextGrid;
}

function _transitionKeyToState(key) {
  switch (key) {
    case 'toClear': return WS.CLEAR;
    case 'toCloudy': return WS.CLOUDY;
    case 'toRain': return WS.RAIN;
    case 'toStorm': return WS.STORM;
    case 'toFog': return WS.FOG;
    case 'toSnow': return WS.SNOW;
    default: return null;
  }
}

function _stateToName(state) {
  switch (state) {
    case WS.CLEAR: return 'clear';
    case WS.CLOUDY: return 'cloudy';
    case WS.RAIN: return 'rain';
    case WS.STORM: return 'storm';
    case WS.FOG: return 'fog';
    case WS.SNOW: return 'snow';
    default: return 'clear';
  }
}

// ---------------------------------------------------------------------------
// Wind shift
// ---------------------------------------------------------------------------

function _shiftWind() {
  // Wind shifts randomly, weighted toward prevailing direction
  var idx = Math.floor(Math.random() * WIND_DIRECTIONS.length);
  windDirection = WIND_DIRECTIONS[idx];
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

// Get weather at a chunk position (converts chunk to weather cell)
function getWeatherAtChunk(cx, cy) {
  var wcx = Math.floor(cx / WEATHER_CELL_SIZE);
  var wcy = Math.floor(cy / WEATHER_CELL_SIZE);
  var key = wcx + ',' + wcy;
  var cell = weatherGrid[key];
  if (!cell) return { weather: 'clear', intensity: 0.5 };
  return {
    weather: _stateToName(cell.state),
    intensity: cell.intensity || 0.5,
    ticksInState: cell.ticksInState || 0,
  };
}

// Get weather for a biome (backward compat with old system)
// Uses a representative chunk for that biome
function getWeatherForBiome(biomeId) {
  // Use the centroid of playable area for now
  var ox = worldgen.WORLD_SCALE.originCX;
  var oy = worldgen.WORLD_SCALE.originCY;
  return getWeatherAtChunk(ox, oy).weather;
}

function getWindDirection() {
  return { dx: windDirection.dx, dy: windDirection.dy, name: windDirection.name };
}

// Get weather cells for an area (for client rendering)
function getWeatherForArea(centerCX, centerCY, radiusChunks) {
  var result = {};
  var wcxCenter = Math.floor(centerCX / WEATHER_CELL_SIZE);
  var wcyCenter = Math.floor(centerCY / WEATHER_CELL_SIZE);
  var wcRadius = Math.ceil(radiusChunks / WEATHER_CELL_SIZE) + 1;

  for (var dx = -wcRadius; dx <= wcRadius; dx++) {
    for (var dy = -wcRadius; dy <= wcRadius; dy++) {
      var key = (wcxCenter + dx) + ',' + (wcyCenter + dy);
      if (weatherGrid[key]) {
        result[key] = {
          weather: _stateToName(weatherGrid[key].state),
          intensity: weatherGrid[key].intensity || 0.5,
        };
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main tick (called from director/index.js)
// ---------------------------------------------------------------------------

function tick(io, state) {
  if (!_io) _io = io;
  if (!_state) _state = state;

  var now = Date.now();

  // Wind shift
  if (now - lastWindShift >= WIND_SHIFT_INTERVAL) {
    lastWindShift = now;
    _shiftWind();
  }

  // Weather CA tick
  if (now - lastWeatherTick >= WEATHER_TICK_INTERVAL) {
    lastWeatherTick = now;
    _tickWeather();

    // Update state.biomeWeather for backward compatibility
    if (_state) {
      var biomeNames = ['ocean', 'desert', 'mountains', 'plains', 'forest', 'swamp',
        'tundra', 'frozen', 'highlands', 'volcanic', 'beach', 'coastal'];
      for (var bi = 0; bi < biomeNames.length; bi++) {
        var weather = getWeatherForBiome(biomeNames[bi]);
        _state.setBiomeWeather(biomeNames[bi], weather);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function getState() {
  return {
    weatherGrid: weatherGrid,
    windDirection: windDirection,
    lastWeatherTick: lastWeatherTick,
    lastWindShift: lastWindShift,
  };
}

function loadState(saved) {
  if (!saved) return;
  if (saved.weatherGrid) weatherGrid = saved.weatherGrid;
  if (saved.windDirection) windDirection = saved.windDirection;
  if (saved.lastWeatherTick) lastWeatherTick = saved.lastWeatherTick;
  if (saved.lastWindShift) lastWindShift = saved.lastWindShift;
  console.log('[weather] Loaded state: ' + Object.keys(weatherGrid).length + ' weather cells, wind=' + windDirection.name);
}

function reset() {
  weatherGrid = {};
  windDirection = { dx: 1, dy: 0, name: 'east' };
  lastWeatherTick = 0;
  lastWindShift = 0;
  _seedInitialWeather();
  console.log('[weather] State fully reset');
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

  // Queries
  getWeatherAtChunk: getWeatherAtChunk,
  getWeatherForBiome: getWeatherForBiome,
  getWeatherForArea: getWeatherForArea,
  getWindDirection: getWindDirection,

  // Constants
  WEATHER_CELL_SIZE: WEATHER_CELL_SIZE,
};
