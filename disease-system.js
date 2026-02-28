// disease-system.js
// Multi-disease CA plague system.
// Each disease has unique spread rules, symptoms, cures, and cross-system interactions.
// Operates on chunk grid via CA engine with SIR-model inspired state transitions.

'use strict';

var ca = require('./cellular-automata');
var worldgen = require('./worldgen');

var _io = null;
var _state = null;
var _accounts = null;

// ---------------------------------------------------------------------------
// Disease definitions
// ---------------------------------------------------------------------------

var DISEASES = {
  crimson_wasting: {
    id: 'crimson_wasting',
    name: 'The Crimson Wasting',
    description: 'A blood-borne plague that drains vitality. Spreads through combat contact.',
    spreadChance: 0.12,         // per-neighbor per-tick
    incubationTicks: 3,         // ticks in EXPOSED before INFECTED
    recoveryTicks: 8,           // ticks in INFECTED before QUARANTINED
    quarantineTicks: 5,         // ticks in QUARANTINED before RECOVERED
    immunityTicks: 20,          // ticks RECOVERED stays immune
    spreadBiomeMod: { 7: 1.5, 5: 0.8, 2: 0.5 }, // swamp boost, forest slow, mountain block
    playerDamagePerTick: 3,
    playerDebuffs: { speedMult: 0.85, combatMod: -0.10 },
    cureItem: 'crimson_antidote',
    sourceCorruptionMin: 40,    // corruption level to seed this disease
    loreHint: 'The blood remembers what the mind forgets.',
  },
  spore_blight: {
    id: 'spore_blight',
    name: 'Spore Blight',
    description: 'Fungal spores that rot wood and weaken structures. Spreads in forests and swamps.',
    spreadChance: 0.15,
    incubationTicks: 2,
    recoveryTicks: 6,
    quarantineTicks: 4,
    immunityTicks: 15,
    spreadBiomeMod: { 5: 1.8, 7: 1.6, 6: 1.0, 1: 0.2, 2: 0.3 }, // forest/swamp=fast, desert/mountain=slow
    playerDamagePerTick: 1,
    playerDebuffs: { speedMult: 0.90, combatMod: -0.05 },
    cureItem: 'purified_salve',
    sourceCorruptionMin: 0,     // can spawn independently in swamps
    loreHint: 'The forest breathes what the earth cannot hold.',
  },
  shadow_fever: {
    id: 'shadow_fever',
    name: 'Shadow Fever',
    description: 'A curse-borne illness from rift energies. Amplified by corruption.',
    spreadChance: 0.08,
    incubationTicks: 4,
    recoveryTicks: 10,
    quarantineTicks: 6,
    immunityTicks: 25,
    spreadBiomeMod: { 12: 1.5 }, // wastes boost
    playerDamagePerTick: 5,
    playerDebuffs: { speedMult: 0.75, combatMod: -0.15 },
    cureItem: 'divine_tincture',
    sourceCorruptionMin: 60,
    loreHint: 'The fever burns where light cannot reach.',
  },
  lich_rot: {
    id: 'lich_rot',
    name: "Lich's Rot",
    description: 'Necrotic decay spreading from the highest corruption zones. The Soldier\'s desperation made flesh.',
    spreadChance: 0.06,
    incubationTicks: 5,
    recoveryTicks: 12,
    quarantineTicks: 8,
    immunityTicks: 30,
    spreadBiomeMod: { 8: 0.3 }, // holy dominion resists
    playerDamagePerTick: 8,
    playerDebuffs: { speedMult: 0.70, combatMod: -0.20 },
    cureItem: 'holy_relic_shard',
    sourceCorruptionMin: 80,
    loreHint: 'He did not choose to rot. The rot chose him.',
  },
  moonplague: {
    id: 'moonplague',
    name: 'Moonplague',
    description: 'Lycanthropic illness that waxes with the lunar cycle. Werewolf director amplifies spread.',
    spreadChance: 0.10,
    incubationTicks: 2,
    recoveryTicks: 7,
    quarantineTicks: 3,
    immunityTicks: 14,
    spreadBiomeMod: { 5: 1.3, 6: 1.2 }, // forest/plains
    playerDamagePerTick: 2,
    playerDebuffs: { speedMult: 0.80, combatMod: 0.05 }, // slight combat buff (feral)
    cureItem: 'moonsilver_elixir',
    sourceCorruptionMin: 0,     // triggered by werewolf director
    loreHint: 'The moon sings to the blood.',
  },
};

// ---------------------------------------------------------------------------
// State: per-disease chunk grids
// ---------------------------------------------------------------------------

// diseaseGrids[diseaseId] = { 'cx,cy': { state, ticksInState, sourceId } }
var diseaseGrids = {};

// Player infection tracking: playerDiseases[accountKey] = { diseaseId: { state, ticksInState, infectedAt } }
var playerDiseases = {};

// Last tick timestamp per disease
var lastDiseaseTickMs = {};

var DISEASE_TICK_INTERVAL = 3600000; // 1 hour between disease ticks (chunk grid)
var PLAYER_SYMPTOM_INTERVAL = 30000; // 30s between player symptom checks

var lastPlayerSymptomCheck = 0;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init(io, state, accounts) {
  _io = io;
  _state = state;
  _accounts = accounts;

  // Initialize empty grids
  for (var did in DISEASES) {
    if (!diseaseGrids[did]) diseaseGrids[did] = {};
    if (!lastDiseaseTickMs[did]) lastDiseaseTickMs[did] = 0;
  }
}

// ---------------------------------------------------------------------------
// Seed disease from external triggers
// ---------------------------------------------------------------------------

// Seed a disease at a chunk (called by lich/vampire/werewolf directors)
function seedDisease(diseaseId, cx, cy, sourceId) {
  var disease = DISEASES[diseaseId];
  if (!disease) return false;
  if (!diseaseGrids[diseaseId]) diseaseGrids[diseaseId] = {};

  var key = cx + ',' + cy;
  if (diseaseGrids[diseaseId][key]) return false; // already present

  diseaseGrids[diseaseId][key] = {
    state: ca.DISEASE_STATE.INFECTED,
    ticksInState: 0,
    sourceId: sourceId || 'natural',
  };

  console.log('[disease] Seeded ' + disease.name + ' at (' + cx + ',' + cy + ')');
  return true;
}

// Infect a player directly (called by combat, vampire bites, etc.)
function infectPlayer(accountKey, diseaseId) {
  var disease = DISEASES[diseaseId];
  if (!disease) return false;
  if (!playerDiseases[accountKey]) playerDiseases[accountKey] = {};
  if (playerDiseases[accountKey][diseaseId]) return false; // already has it

  playerDiseases[accountKey][diseaseId] = {
    state: ca.DISEASE_STATE.EXPOSED,
    ticksInState: 0,
    infectedAt: Date.now(),
  };
  return true;
}

// Cure a player of a specific disease
function curePlayer(accountKey, diseaseId) {
  if (!playerDiseases[accountKey]) return false;
  if (!playerDiseases[accountKey][diseaseId]) return false;
  delete playerDiseases[accountKey][diseaseId];
  if (Object.keys(playerDiseases[accountKey]).length === 0) {
    delete playerDiseases[accountKey];
  }
  return true;
}

// ---------------------------------------------------------------------------
// CA chunk tick (per disease)
// ---------------------------------------------------------------------------

function _tickDiseaseGrid(diseaseId) {
  var disease = DISEASES[diseaseId];
  if (!disease) return;
  var grid = diseaseGrids[diseaseId];
  if (!grid) return;

  var DS = ca.DISEASE_STATE;

  // Rule for existing cells
  function ruleTable(cell, neighbors, cx, cy) {
    var nextTicks = cell.ticksInState + 1;

    switch (cell.state) {
      case DS.EXPOSED:
        if (nextTicks >= disease.incubationTicks) return DS.INFECTED;
        break;
      case DS.INFECTED:
        if (nextTicks >= disease.recoveryTicks) return DS.QUARANTINED;
        break;
      case DS.QUARANTINED:
        if (nextTicks >= disease.quarantineTicks) return DS.RECOVERED;
        break;
      case DS.RECOVERED:
        if (nextTicks >= disease.immunityTicks) return -1; // remove cell
        break;
    }
    return null; // no state change
  }

  // Rule for empty cells adjacent to infected cells (spread)
  function emptyRuleTable(neighbors, cx, cy) {
    var infectedCount = ca.countNeighborsInState(neighbors, DS.INFECTED);
    if (infectedCount === 0) return null;

    var chance = disease.spreadChance * infectedCount;

    // Biome modifier
    var biome = worldgen.getBiome(cx, cy);
    if (biome === 0) chance *= 0.1; // water nearly blocks
    if (disease.spreadBiomeMod[biome] !== undefined) {
      chance *= disease.spreadBiomeMod[biome];
    }

    // Holy biome resistance
    if (biome === 8) chance *= 0.3; // holy dominion resists

    if (Math.random() > chance) return null;

    return {
      state: DS.EXPOSED,
      ticksInState: 0,
      sourceId: 'spread',
    };
  }

  // Run CA tick with spread
  var result = ca.tickWithSpread(grid, ruleTable, emptyRuleTable, 4);

  // Post-process: increment ticksInState, remove cells marked -1
  var nextGrid = result.grid;
  var keys = Object.keys(nextGrid);
  for (var i = 0; i < keys.length; i++) {
    var cell = nextGrid[keys[i]];
    if (cell.state === -1) {
      delete nextGrid[keys[i]];
    } else {
      cell.ticksInState = (cell.ticksInState || 0) + 1;
      // Reset tick counter on state transition
      if (cell.state !== grid[keys[i]] ? (grid[keys[i]] || {}).state : cell.state) {
        cell.ticksInState = 0;
      }
    }
  }

  diseaseGrids[diseaseId] = nextGrid;
}

// ---------------------------------------------------------------------------
// Player symptom tick
// ---------------------------------------------------------------------------

function _tickPlayerSymptoms() {
  var now = Date.now();
  if (now - lastPlayerSymptomCheck < PLAYER_SYMPTOM_INTERVAL) return;
  lastPlayerSymptomCheck = now;

  if (!_state || !_state.playerZones || !_state.playerPositions) return;
  if (!_accounts) return;

  var DS = ca.DISEASE_STATE;

  // Check players in overworld for new infections from chunk diseases
  _state.playerZones.forEach(function(zoneId, socketId) {
    if (zoneId !== 'overworld') return;
    var pos = _state.playerPositions.get(socketId);
    if (!pos) return;

    var cx = Math.floor(pos.x / 512);
    var cy = Math.floor(pos.y / 512);
    var key = cx + ',' + cy;

    // Find account key for this socket
    var accKey = null;
    if (_state._socketAccountMap) {
      accKey = _state._socketAccountMap.get(socketId);
    }
    if (!accKey) return;

    // Check each disease grid for infection at player's chunk
    for (var did in diseaseGrids) {
      var cell = diseaseGrids[did][key];
      if (!cell || cell.state !== DS.INFECTED) continue;

      // 5% chance per symptom tick to catch disease from infected chunk
      if (Math.random() < 0.05) {
        var infected = infectPlayer(accKey, did);
        if (infected && _io) {
          var sock = _io.sockets.sockets.get(socketId);
          if (sock) {
            sock.emit('disease_contracted', {
              diseaseId: did,
              name: DISEASES[did].name,
              message: DISEASES[did].loreHint,
            });
          }
        }
      }
    }

    // Progress player disease states
    if (!playerDiseases[accKey]) return;
    for (var pdid in playerDiseases[accKey]) {
      var pstate = playerDiseases[accKey][pdid];
      var disease = DISEASES[pdid];
      if (!disease) continue;

      pstate.ticksInState++;

      // State progression
      if (pstate.state === DS.EXPOSED && pstate.ticksInState >= disease.incubationTicks * 10) {
        pstate.state = DS.INFECTED;
        pstate.ticksInState = 0;
      } else if (pstate.state === DS.INFECTED) {
        // Apply symptoms
        var sock = _io ? _io.sockets.sockets.get(socketId) : null;
        if (sock) {
          sock.emit('disease_symptom', {
            diseaseId: pdid,
            name: disease.name,
            damage: disease.playerDamagePerTick,
            debuffs: disease.playerDebuffs,
          });
        }

        if (pstate.ticksInState >= disease.recoveryTicks * 10) {
          pstate.state = DS.QUARANTINED;
          pstate.ticksInState = 0;
        }
      } else if (pstate.state === DS.QUARANTINED && pstate.ticksInState >= disease.quarantineTicks * 10) {
        pstate.state = DS.RECOVERED;
        pstate.ticksInState = 0;
      } else if (pstate.state === DS.RECOVERED && pstate.ticksInState >= disease.immunityTicks * 10) {
        delete playerDiseases[accKey][pdid];
        if (Object.keys(playerDiseases[accKey]).length === 0) {
          delete playerDiseases[accKey];
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Main tick (called from director/index.js every 60s)
// ---------------------------------------------------------------------------

function tick(io, state, accounts, socketAccountMap) {
  if (!_io) _io = io;
  if (!_state) _state = state;
  if (!_accounts) _accounts = accounts;
  if (socketAccountMap) _state._socketAccountMap = socketAccountMap;

  var now = Date.now();

  // Chunk disease ticks (hourly per disease)
  for (var did in DISEASES) {
    if (now - (lastDiseaseTickMs[did] || 0) >= DISEASE_TICK_INTERVAL) {
      lastDiseaseTickMs[did] = now;
      _tickDiseaseGrid(did);
    }
  }

  // Player symptom ticks (every 30s)
  _tickPlayerSymptoms();
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function getDiseasesAtChunk(cx, cy) {
  var result = [];
  var key = cx + ',' + cy;
  for (var did in diseaseGrids) {
    if (diseaseGrids[did][key]) {
      result.push({
        diseaseId: did,
        name: DISEASES[did].name,
        state: diseaseGrids[did][key].state,
      });
    }
  }
  return result;
}

function getPlayerDiseases(accountKey) {
  return playerDiseases[accountKey] || {};
}

function getDiseaseGridSummary(diseaseId) {
  var grid = diseaseGrids[diseaseId];
  if (!grid) return { total: 0, infected: 0, exposed: 0 };
  var DS = ca.DISEASE_STATE;
  var total = 0;
  var infected = 0;
  var exposed = 0;
  var keys = Object.keys(grid);
  for (var i = 0; i < keys.length; i++) {
    total++;
    if (grid[keys[i]].state === DS.INFECTED) infected++;
    if (grid[keys[i]].state === DS.EXPOSED) exposed++;
  }
  return { total: total, infected: infected, exposed: exposed };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function getState() {
  return {
    diseaseGrids: diseaseGrids,
    playerDiseases: playerDiseases,
    lastDiseaseTickMs: lastDiseaseTickMs,
  };
}

function loadState(saved) {
  if (!saved) return;
  if (saved.diseaseGrids) diseaseGrids = saved.diseaseGrids;
  if (saved.playerDiseases) playerDiseases = saved.playerDiseases;
  if (saved.lastDiseaseTickMs) lastDiseaseTickMs = saved.lastDiseaseTickMs;
  var total = 0;
  for (var did in diseaseGrids) total += Object.keys(diseaseGrids[did]).length;
  console.log('[disease] Loaded state: ' + total + ' disease cells across ' + Object.keys(diseaseGrids).length + ' diseases');
}

function reset() {
  diseaseGrids = {};
  playerDiseases = {};
  lastDiseaseTickMs = {};
  for (var did in DISEASES) {
    diseaseGrids[did] = {};
    lastDiseaseTickMs[did] = 0;
  }
  console.log('[disease] State fully reset');
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

  // External triggers
  seedDisease: seedDisease,
  infectPlayer: infectPlayer,
  curePlayer: curePlayer,

  // Queries
  getDiseasesAtChunk: getDiseasesAtChunk,
  getPlayerDiseases: getPlayerDiseases,
  getDiseaseGridSummary: getDiseaseGridSummary,

  // Constants
  DISEASES: DISEASES,
};
