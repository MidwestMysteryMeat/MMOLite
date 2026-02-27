// director/index.js
// AI Event Director — orchestration entry point.
// Initializes all director tiers (Micro, Zone, Macro) and the Raid system.
// Micro director piggybacks on the existing AI tick in handlers/dungeon.js.
// Zone and Macro directors run on their own intervals.

'use strict';

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

  console.log('[director] AI Event Director initialized (micro=per-tick, zone=30s, macro=5min, ocean=60s, lich=60s, raids=5min, vampire=10min, werewolf=15min, rifts=3min)');
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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  init: init,
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
};
