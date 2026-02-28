// director/index.js
// AI Event Director — orchestration entry point.
// Initializes all director tiers (Micro, Zone, Macro) and the Raid system.
// Micro director piggybacks on the existing AI tick in handlers/dungeon.js.
// Zone and Macro directors run on their own intervals.

'use strict';

var fs = require('fs');
var path = require('path');
var directorMetrics = require('./director-metrics');
var directorMicro   = require('./director-micro');
var directorZone    = require('./director-zone');
var directorMacro   = require('./director-macro');
var directorRaid    = require('./director-raid');
var directorOcean   = require('./director-ocean');
var directorLich    = require('./director-lich');
var directorBaseRaids = require('./director-raids');
var directorVampire  = require('./director-vampire');
var directorWerewolf = require('./director-werewolf');
var directorRifts    = require('./director-rifts');
var doomAscension    = require('../doom-ascension');
var diseaseSystem    = require('../disease-system');
var weatherProp      = require('../weather-propagation');
var influenceMaps    = require('../influence-maps');
var biomeSuccession  = require('../biome-succession');
var patrolSystem     = require('../patrol-system');

var _io = null;
var _state = null;
var _accounts = null;
var _socketAccountMap = null;
var _zoneInterval = null;
var _macroInterval = null;
var _oceanInterval = null;
var _lichInterval = null;
var _baseRaidsInterval = null;
var _vampireInterval = null;
var _werewolfInterval = null;
var _riftsInterval = null;
var _diseaseInterval = null;
var _weatherInterval = null;
var _influenceInterval = null;
var _ecologyInterval = null;
var _patrolInterval = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the director system.
 * Call after all handlers are set up and io is ready.
 */
function init(io, state, accounts, socketAccountMap) {
  _io = io;
  _state = state;
  _accounts = accounts;
  _socketAccountMap = socketAccountMap;

  // Initialize zone director (30s interval)
  _zoneInterval = setInterval(function() {
    try {
      directorZone.tick(_io, _state, directorMetrics);
    } catch (err) {
      console.error('[director] Zone tick error:', err.message);
    }
  }, 30000);
  if (_zoneInterval && _zoneInterval.unref) _zoneInterval.unref();

  // Initialize macro director (5min interval)
  _macroInterval = setInterval(function() {
    try {
      directorMacro.tick(_io, _state, directorMetrics, directorZone);
    } catch (err) {
      console.error('[director] Macro tick error:', err.message);
    }
  }, 5 * 60 * 1000);
  if (_macroInterval && _macroInterval.unref) _macroInterval.unref();

  // Initialize ocean director (60s interval)
  _oceanInterval = setInterval(function() {
    try {
      directorOcean.tick(_io, _state, _accounts, _socketAccountMap);
    } catch (err) {
      console.error('[director] Ocean tick error:', err.message);
    }
  }, 60000);
  if (_oceanInterval && _oceanInterval.unref) _oceanInterval.unref();

  // Load persisted director state before starting tick intervals
  loadState();

  // Initialize lich corruption director (60s interval, daily spread + debuff ticks)
  directorLich.init();
  _lichInterval = setInterval(function() {
    try {
      directorLich.tick(_io, _state, _accounts, _socketAccountMap);
    } catch (err) {
      console.error('[director] Lich tick error:', err.message);
    }
  }, 60000);
  if (_lichInterval && _lichInterval.unref) _lichInterval.unref();

  // Initialize base raids director (5min lifecycle tick + 30s attack tick)
  _baseRaidsInterval = setInterval(function() {
    try {
      directorBaseRaids.tick(_io, _state, _accounts, _socketAccountMap);
    } catch (err) {
      console.error('[director] Base raids tick error:', err.message);
    }
  }, 5 * 60 * 1000);
  if (_baseRaidsInterval && _baseRaidsInterval.unref) _baseRaidsInterval.unref();

  setInterval(function() {
    try {
      directorBaseRaids.attackTick(_io, _state, _accounts, _socketAccountMap);
    } catch (err) {
      console.error('[director] Raids attack tick error:', err.message);
    }
  }, 30000).unref();

  // Initialize vampire infiltration director (10min interval)
  directorVampire.init();
  _vampireInterval = setInterval(function() {
    try {
      directorVampire.tick(_io, _state, _accounts, _socketAccountMap);
    } catch (err) {
      console.error('[director] Vampire tick error:', err.message);
    }
  }, 10 * 60 * 1000);
  if (_vampireInterval && _vampireInterval.unref) _vampireInterval.unref();

  // Initialize werewolf lunar cycle director (15min interval)
  directorWerewolf.init();
  _werewolfInterval = setInterval(function() {
    try {
      directorWerewolf.tick(_io, _state, _accounts, _socketAccountMap);
    } catch (err) {
      console.error('[director] Werewolf tick error:', err.message);
    }
  }, 15 * 60 * 1000);
  if (_werewolfInterval && _werewolfInterval.unref) _werewolfInterval.unref();

  // Initialize mini-rift director (3min interval)
  directorRifts.init(_state);
  _riftsInterval = setInterval(function() {
    try {
      directorRifts.tick(_io, _state, _accounts, _socketAccountMap);
    } catch (err) {
      console.error('[director] Rifts tick error:', err.message);
    }
  }, 3 * 60 * 1000);
  if (_riftsInterval && _riftsInterval.unref) _riftsInterval.unref();

  // Initialize disease system (60s interval, hourly chunk ticks internally)
  diseaseSystem.init(_io, _state, _accounts);
  _diseaseInterval = setInterval(function() {
    try {
      diseaseSystem.tick(_io, _state, _accounts, _socketAccountMap);
    } catch (err) {
      console.error('[director] Disease tick error:', err.message);
    }
  }, 60000);
  if (_diseaseInterval && _diseaseInterval.unref) _diseaseInterval.unref();

  // Initialize weather propagation (5min interval, CA-based)
  weatherProp.init(_io, _state);
  _weatherInterval = setInterval(function() {
    try {
      weatherProp.tick(_io, _state);
    } catch (err) {
      console.error('[director] Weather tick error:', err.message);
    }
  }, 5 * 60 * 1000);
  if (_weatherInterval && _weatherInterval.unref) _weatherInterval.unref();

  // Initialize influence maps (10min interval)
  influenceMaps.init(_io, _state);
  _influenceInterval = setInterval(function() {
    try {
      influenceMaps.tick(_io, _state);
    } catch (err) {
      console.error('[director] Influence tick error:', err.message);
    }
  }, 10 * 60 * 1000);
  if (_influenceInterval && _influenceInterval.unref) _influenceInterval.unref();

  // Initialize biome succession (60s interval, hourly CA ticks internally)
  biomeSuccession.init(_state);
  _ecologyInterval = setInterval(function() {
    try {
      var lichState = directorLich.getState();
      biomeSuccession.tick(_state, lichState ? lichState.corruptedChunks : null);
    } catch (err) {
      console.error('[director] Ecology tick error:', err.message);
    }
  }, 60000);
  if (_ecologyInterval && _ecologyInterval.unref) _ecologyInterval.unref();

  // Initialize ACO patrol system (60s interval — patrols move via pheromone trails)
  patrolSystem.init(_io, _state);
  _patrolInterval = setInterval(function() {
    try {
      patrolSystem.tick();
    } catch (err) {
      console.error('[director] Patrol tick error:', err.message);
    }
  }, 60000);
  if (_patrolInterval && _patrolInterval.unref) _patrolInterval.unref();

  // Initialize doom ascension module — wire director refs for world reset
  var overworldStructures = null;
  try { overworldStructures = require('../overworld-structures'); } catch (e) { /* not loaded yet */ }
  doomAscension.init(_io, _state, _accounts, {
    lich: directorLich,
    vampire: directorVampire,
    werewolf: directorWerewolf,
    raids: directorBaseRaids,
    rifts: directorRifts,
    structures: overworldStructures,
    disease: diseaseSystem,
    weather: weatherProp,
    influence: influenceMaps,
    ecology: biomeSuccession,
    patrol: patrolSystem,
    saveState: saveState,
  });

  console.log('[director] AI Event Director initialized (micro=per-tick, zone=30s, macro=5min, ocean=60s, lich=60s, raids=5min, vampire=10min, werewolf=15min, rifts=3min, disease=60s, weather=5min, influence=10min, ecology=60s, patrol=60s, doom=wired)');
}

/**
 * Get references to director subsystems (for injection into handler deps).
 */
function getMetrics() {
  return directorMetrics;
}

function getMicroDirector() {
  return directorMicro;
}

function getZoneDirector() {
  return directorZone;
}

function getMacroDirector() {
  return directorMacro;
}

function getRaid() {
  return directorRaid;
}

function getOceanDirector() {
  return directorOcean;
}

function getLichDirector() {
  return directorLich;
}

function getBaseRaidsDirector() {
  return directorBaseRaids;
}

function getVampireDirector() {
  return directorVampire;
}

function getWerewolfDirector() {
  return directorWerewolf;
}

function getRiftsDirector() {
  return directorRifts;
}

function getDiseaseSystem() {
  return diseaseSystem;
}

function getWeatherPropagation() {
  return weatherProp;
}

function getInfluenceMaps() {
  return influenceMaps;
}

function getBiomeSuccession() {
  return biomeSuccession;
}

function getPatrolSystem() {
  return patrolSystem;
}

// ---------------------------------------------------------------------------
// State persistence — save/load director state across server restarts
// ---------------------------------------------------------------------------

var STATE_FILE = path.join(__dirname, '..', 'data', 'director-state.json');

function saveState() {
  try {
    var state = {
      lich: directorLich.getState(),
      rifts: directorRifts.getState(),
      disease: diseaseSystem.getState(),
      weather: weatherProp.getState(),
      influence: influenceMaps.getState(),
      ecology: biomeSuccession.getState(),
      patrol: patrolSystem.getState(),
    };
    var dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf8');
    console.log('[director] State saved (' + Object.keys(state.lich.corruptedChunks || {}).length + ' corrupted chunks)');
  } catch (err) {
    console.error('[director] Failed to save state:', err.message);
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      var saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (saved.lich) directorLich.loadState(saved.lich);
      if (saved.rifts) directorRifts.loadState(saved.rifts);
      if (saved.disease) diseaseSystem.loadState(saved.disease);
      if (saved.weather) weatherProp.loadState(saved.weather);
      if (saved.influence) influenceMaps.loadState(saved.influence);
      if (saved.ecology) biomeSuccession.loadState(saved.ecology);
      if (saved.patrol) patrolSystem.loadState(saved.patrol);
      console.log('[director] State loaded from disk');
    }
  } catch (err) {
    console.error('[director] Failed to load state:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  init: init,
  saveState: saveState,
  getMetrics: getMetrics,
  getMicroDirector: getMicroDirector,
  getZoneDirector: getZoneDirector,
  getMacroDirector: getMacroDirector,
  getRaid: getRaid,
  getOceanDirector: getOceanDirector,
  getLichDirector: getLichDirector,
  getBaseRaidsDirector: getBaseRaidsDirector,
  getVampireDirector: getVampireDirector,
  getWerewolfDirector: getWerewolfDirector,
  getRiftsDirector: getRiftsDirector,
  getDiseaseSystem: getDiseaseSystem,
  getWeatherPropagation: getWeatherPropagation,
  getInfluenceMaps: getInfluenceMaps,
  getBiomeSuccession: getBiomeSuccession,
  getPatrolSystem: getPatrolSystem,
};
