// director/director-vampire.js
// Vampire Infiltration System — tracks vampire infiltrators in towns, simulates
// epidemic spread, and spawns "abandoned_crypt" zones when infiltration reaches
// critical thresholds.
//
// LORE CONTEXT:
// The vampires of Castle Nocturn are not mindless predators. They are the
// remnants of an ancient noble house that made a pact with something beneath the
// world — a bargain for eternal life that cost them the sun. Their infiltrators
// slip into towns at night, feeding carefully, turning the vulnerable. When enough
// of a town's populace falls under their influence, the ground itself responds:
// crypts long buried crack open, and the dead begin to walk.
//
// The epidemic is not disease. It is architecture. The vampires are building
// something underneath the living world, one stolen soul at a time.

'use strict';

var worldgen = require('../worldgen');
var rumorSystem = require('../rumor-system');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var INFILTRATION_TICK_MS = 10 * 60 * 1000;   // 10 minutes
var MAX_INFILTRATORS_PER_TOWN = 10;
var EPIDEMIC_RUMOR_THRESHOLD = 3;             // 3+ infiltrators -> epidemic rumor
var EPIDEMIC_CRYPT_THRESHOLD = 5;             // 5+ infiltrators -> spawn abandoned crypt
var SUNLIGHT_DESTROY_CHANCE = 0.35;           // 35% chance per infiltrator during day
var SPREAD_CHANCE = 0.20;                     // 20% chance to spread to adjacent town
var MAX_CRYPT_DISTANCE_CHUNKS = 15;           // abandoned crypt spawns within 15 chunks of source
var PLAYER_BITE_CHANCE = 0.06;               // 6% base chance per tick to bite a player in epidemic town

// ---------------------------------------------------------------------------
// Anchor towns (shared reference — same as lich director)
// ---------------------------------------------------------------------------

var ANCHOR_TOWNS = [
  { id: 'starter_town', name: 'The Holy Dominion', refX: 35, refY: 42 },
  { id: 'solara', name: 'Solara', refX: 40, refY: 38 },
  { id: 'sylvaris', name: 'Sylvaris', refX: 45, refY: 55 },
  { id: 'ironhold', name: 'Ironhold', refX: 32, refY: 8 },
  { id: 'kragmor', name: 'Kragmor', refX: 18, refY: 25 },
  { id: 'bonetrap', name: 'BoneTrap', refX: 10, refY: 38 },
  { id: 'murkmire', name: 'Murkmire', refX: 15, refY: 52 },
  { id: 'mechspire', name: 'Mechspire', refX: 95, refY: 38 },
  { id: 'clockwork_harbor_town', name: 'Clockwork Harbor', refX: 92, refY: 50 },
  { id: 'fortunes_rest', name: "Fortune's Rest", refX: 35, refY: -8 },
];

// Pre-compute chunk positions for anchor towns
var _townChunkPositions = {};
(function() {
  var originCX = worldgen.WORLD_SCALE.originCX;
  var originCY = worldgen.WORLD_SCALE.originCY;
  for (var i = 0; i < ANCHOR_TOWNS.length; i++) {
    var t = ANCHOR_TOWNS[i];
    _townChunkPositions[t.id] = {
      cx: originCX + t.refX,
      cy: originCY + t.refY,
    };
  }
})();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// { zoneId: infiltratorCount } e.g. { 'starter_town': 2 }
var townInfiltrators = {};

// Active abandoned crypt zones
var activeCrypts = [];

// Vampire source dungeons (built from WORLD_DUNGEONS)
var vampireSources = [];

// Timestamp of last tick
var lastTick = 0;

// Track one-time events per town to avoid repeated firing
var epidemicRumorsFired = {};   // { zoneId: true }
var cryptsSpawned = {};         // { zoneId: true }

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function _buildVampireSources() {
  var dungeons = worldgen.WORLD_DUNGEONS;
  vampireSources = [];
  for (var i = 0; i < dungeons.length; i++) {
    var d = dungeons[i];
    if (d.theme === 'vampire_castle') {
      vampireSources.push({
        dungeonId: d.id,
        cx: d._chunkX,
        cy: d._chunkY,
        name: d.name,
      });
    }
  }
  console.log('[vampire] Found ' + vampireSources.length + ' vampire source(s): ' +
    vampireSources.map(function(s) { return s.name + ' (' + s.cx + ',' + s.cy + ')'; }).join(', '));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _isDay(state) {
  if (state && typeof state.getTimeOfDay === 'function') {
    var phase = state.getTimeOfDay();
    return phase === 'day' || phase === 'dawn' || phase === 'dusk';
  }
  return true; // default to daytime if state unavailable
}

/**
 * Find towns within a given chunk distance of a position.
 * Returns up to `limit` towns sorted by distance (nearest first).
 */
function _findTownsWithinRange(cx, cy, maxDist, limit) {
  var results = [];
  for (var i = 0; i < ANCHOR_TOWNS.length; i++) {
    var t = ANCHOR_TOWNS[i];
    var pos = _townChunkPositions[t.id];
    var dist = Math.abs(cx - pos.cx) + Math.abs(cy - pos.cy);
    if (dist <= maxDist) {
      results.push({ town: t, dist: dist });
    }
  }
  results.sort(function(a, b) { return a.dist - b.dist; });
  if (limit && results.length > limit) {
    results = results.slice(0, limit);
  }
  return results;
}

/**
 * Get a town name by zone ID from ANCHOR_TOWNS.
 */
function _getTownName(zoneId) {
  for (var i = 0; i < ANCHOR_TOWNS.length; i++) {
    if (ANCHOR_TOWNS[i].id === zoneId) return ANCHOR_TOWNS[i].name;
  }
  return zoneId;
}

// ---------------------------------------------------------------------------
// Core tick logic
// ---------------------------------------------------------------------------

function _infiltrationTick(io, state, accounts, socketAccountMap) {
  var now = Date.now();
  var isDay = _isDay(state);

  // ── 1. Sunlight destruction ──
  if (isDay) {
    var townIds = Object.keys(townInfiltrators);
    for (var ti = 0; ti < townIds.length; ti++) {
      var zoneId = townIds[ti];
      var count = townInfiltrators[zoneId];
      if (count <= 0) {
        delete townInfiltrators[zoneId];
        continue;
      }

      var destroyed = 0;
      for (var inf = 0; inf < count; inf++) {
        if (Math.random() < SUNLIGHT_DESTROY_CHANCE) {
          destroyed++;
        }
      }

      if (destroyed > 0) {
        townInfiltrators[zoneId] = Math.max(0, count - destroyed);
        if (townInfiltrators[zoneId] <= 0) {
          delete townInfiltrators[zoneId];
        }

        // Notify players in this town
        if (io) {
          io.to('zone:' + zoneId).emit('vampire_sunlight', {
            zoneId: zoneId,
            destroyed: destroyed,
            remaining: townInfiltrators[zoneId] || 0,
            message: 'The morning sun burns away ' + destroyed + ' vampire infiltrator(s) lurking in ' + _getTownName(zoneId) + '.',
          });
        }
      }
    }
  }

  // ── 2. Source infiltration: each vampire_castle sends infiltrators to nearby towns ──
  for (var si = 0; si < vampireSources.length; si++) {
    var src = vampireSources[si];
    var nearbyTowns = _findTownsWithinRange(src.cx, src.cy, 30, 3);

    for (var nt = 0; nt < nearbyTowns.length; nt++) {
      var townId = nearbyTowns[nt].town.id;
      var current = townInfiltrators[townId] || 0;
      if (current < MAX_INFILTRATORS_PER_TOWN) {
        townInfiltrators[townId] = current + 1;
      }
    }
  }

  // ── 3. Spread: each infiltrated town can spread to an adjacent town ──
  var infiltratedTowns = Object.keys(townInfiltrators);
  for (var st = 0; st < infiltratedTowns.length; st++) {
    var spreadZoneId = infiltratedTowns[st];
    if (Math.random() > SPREAD_CHANCE) continue;

    var spreadPos = _townChunkPositions[spreadZoneId];
    if (!spreadPos) continue;

    // Find adjacent towns (within 30 chunks, not self)
    var adjacent = _findTownsWithinRange(spreadPos.cx, spreadPos.cy, 30, 5);
    var candidates = [];
    for (var ai = 0; ai < adjacent.length; ai++) {
      if (adjacent[ai].town.id !== spreadZoneId) {
        candidates.push(adjacent[ai].town);
      }
    }

    if (candidates.length > 0) {
      var target = candidates[Math.floor(Math.random() * candidates.length)];
      var targetCount = townInfiltrators[target.id] || 0;
      if (targetCount < MAX_INFILTRATORS_PER_TOWN) {
        townInfiltrators[target.id] = targetCount + 1;
      }
    }
  }

  // ── 4. Check epidemic thresholds ──
  var currentTowns = Object.keys(townInfiltrators);
  for (var ct = 0; ct < currentTowns.length; ct++) {
    var checkZoneId = currentTowns[ct];
    var checkCount = townInfiltrators[checkZoneId];
    var townName = _getTownName(checkZoneId);

    // Epidemic rumor threshold
    if (checkCount >= EPIDEMIC_RUMOR_THRESHOLD && !epidemicRumorsFired[checkZoneId]) {
      epidemicRumorsFired[checkZoneId] = true;

      if (rumorSystem && typeof rumorSystem.addWorldEventRumor === 'function') {
        rumorSystem.addWorldEventRumor(checkZoneId, {
          text: 'Villagers are going missing at night in ' + townName + '. Some say they\'ve been seen wandering the graveyards...',
          type: 'vampire_epidemic',
          severity: 'medium',
        });
      }

      console.log('[vampire] Epidemic rumor fired for ' + townName + ' (' + checkCount + ' infiltrators)');
    }

    // Crypt spawn threshold
    if (checkCount >= EPIDEMIC_CRYPT_THRESHOLD && !cryptsSpawned[checkZoneId]) {
      cryptsSpawned[checkZoneId] = true;
      _spawnAbandonedCrypt(io, state, checkZoneId, townName);
    }
  }

  // ── 5. Broadcast infiltration status to affected towns ──
  if (io) {
    var allTowns = Object.keys(townInfiltrators);
    for (var bt = 0; bt < allTowns.length; bt++) {
      var broadcastZoneId = allTowns[bt];
      var broadcastCount = townInfiltrators[broadcastZoneId];
      io.to('zone:' + broadcastZoneId).emit('town_infiltration_update', {
        zoneId: broadcastZoneId,
        count: broadcastCount,
        isEpidemic: broadcastCount >= EPIDEMIC_RUMOR_THRESHOLD,
      });
    }
  }

  // ── 6. Player exposure: chance of bite in epidemic-level towns ──
  if (accounts && socketAccountMap && state && state.playerZones) {
    state.playerZones.forEach(function(pZoneId, pSocketId) {
      var infCount = townInfiltrators[pZoneId] || 0;
      if (infCount < EPIDEMIC_RUMOR_THRESHOLD) return;

      // Chance scales with infiltration level
      var biteChance = PLAYER_BITE_CHANCE * (infCount / MAX_INFILTRATORS_PER_TOWN);
      if (Math.random() > biteChance) return;

      var pAccountKey = socketAccountMap.get(pSocketId);
      if (!pAccountKey) return;

      var pAcc = accounts.loadAccount(pAccountKey);
      if (!pAcc || pAcc.vampireExposed) return; // already exposed

      pAcc.vampireExposed = { exposedAt: Date.now() };
      accounts.saveAccount(pAcc);

      var pSock = io ? io.sockets.sockets.get(pSocketId) : null;
      if (pSock) {
        pSock.emit('vampire_bite_exposure', {
          message: 'You feel a sharp pain in your neck. Something in the shadows retreated before you could see it...',
          exposedAt: pAcc.vampireExposed.exposedAt,
        });
      }
      console.log('[vampire] Player ' + pAccountKey + ' bitten in ' + pZoneId + ' (' + infCount + ' infiltrators)');
    });
  }
}

// ---------------------------------------------------------------------------
// Abandoned crypt spawning
// ---------------------------------------------------------------------------

function _spawnAbandonedCrypt(io, state, originZoneId, townName) {
  // Find the vampire_castle source nearest to this town
  var townPos = _townChunkPositions[originZoneId];
  if (!townPos) {
    console.log('[vampire] Cannot spawn crypt: unknown town ' + originZoneId);
    return;
  }

  var bestSource = null;
  var bestDist = Infinity;
  for (var i = 0; i < vampireSources.length; i++) {
    var s = vampireSources[i];
    var dist = Math.abs(s.cx - townPos.cx) + Math.abs(s.cy - townPos.cy);
    if (dist < bestDist) {
      bestDist = dist;
      bestSource = s;
    }
  }

  if (!bestSource) {
    console.log('[vampire] Cannot spawn crypt: no vampire sources found');
    return;
  }

  // Pick random location within MAX_CRYPT_DISTANCE_CHUNKS of the vampire_castle source
  var attempts = 0;
  var cryptCX = 0;
  var cryptCY = 0;
  var placed = false;

  while (attempts < 20 && !placed) {
    var dx = Math.floor(Math.random() * (MAX_CRYPT_DISTANCE_CHUNKS * 2 + 1)) - MAX_CRYPT_DISTANCE_CHUNKS;
    var dy = Math.floor(Math.random() * (MAX_CRYPT_DISTANCE_CHUNKS * 2 + 1)) - MAX_CRYPT_DISTANCE_CHUNKS;
    cryptCX = bestSource.cx + dx;
    cryptCY = bestSource.cy + dy;

    // Avoid water biome
    var biome = worldgen.getBiome(cryptCX, cryptCY);
    if (biome !== 0) { // 0 = WATER
      placed = true;
    }
    attempts++;
  }

  if (!placed) {
    // Fallback: place it at the source position offset by 1
    cryptCX = bestSource.cx + 1;
    cryptCY = bestSource.cy + 1;
  }

  var cryptId = 'abandoned_crypt_' + originZoneId;

  // Create zone in state if createZone is available
  if (state && typeof state.createZone === 'function') {
    state.createZone(cryptId, {
      type: 'dungeon',
      theme: 'vampire_castle',
      width: 400,
      height: 300,
      hidden: true,
      vampireCrypt: true,
      originTown: originZoneId,
      spawnedAt: Date.now(),
    });
  }

  // Track the crypt
  activeCrypts.push({
    cryptId: cryptId,
    originTown: originZoneId,
    cx: cryptCX,
    cy: cryptCY,
    spawnedAt: Date.now(),
  });

  // Broadcast world event
  if (io) {
    io.emit('world_event', {
      title: 'Abandoned Crypt Appears!',
      description: 'A hidden crypt has appeared near ' + townName + '. The vampire epidemic has grown roots.',
      type: 'vampire_crypt',
      originTown: originZoneId,
      cx: cryptCX,
      cy: cryptCY,
    });
  }

  console.log('[vampire] Abandoned crypt spawned: ' + cryptId + ' at (' + cryptCX + ',' + cryptCY + ') near ' + townName);
}

// ---------------------------------------------------------------------------
// Lair clearing — called when a vampire_castle boss is defeated
// ---------------------------------------------------------------------------

function clearLair(dungeonId) {
  // Find the source for this dungeon
  var source = null;
  for (var i = 0; i < vampireSources.length; i++) {
    if (vampireSources[i].dungeonId === dungeonId) {
      source = vampireSources[i];
      break;
    }
  }
  if (!source) return { cleared: 0, cryptsRemoved: 0 };

  var cleared = 0;
  var cryptsRemoved = 0;

  // Remove all infiltrators from towns within 20 chunks of this source
  var townIds = Object.keys(townInfiltrators);
  for (var ti = 0; ti < townIds.length; ti++) {
    var zoneId = townIds[ti];
    var pos = _townChunkPositions[zoneId];
    if (!pos) continue;

    var dist = Math.abs(pos.cx - source.cx) + Math.abs(pos.cy - source.cy);
    if (dist <= 20) {
      cleared += townInfiltrators[zoneId];
      delete townInfiltrators[zoneId];
      // Reset one-time tracking for this town so events can re-trigger if re-infiltrated
      delete epidemicRumorsFired[zoneId];
      delete cryptsSpawned[zoneId];
    }
  }

  // Remove associated abandoned crypts
  var remainingCrypts = [];
  for (var ci = 0; ci < activeCrypts.length; ci++) {
    var crypt = activeCrypts[ci];
    // Check if this crypt was spawned near the cleared source
    var cryptDist = Math.abs(crypt.cx - source.cx) + Math.abs(crypt.cy - source.cy);
    if (cryptDist <= MAX_CRYPT_DISTANCE_CHUNKS + 5) {
      cryptsRemoved++;
      // Remove crypt zone from state
      if (state && state.zones && crypt.cryptId) {
        state.zones.delete(crypt.cryptId);
      }
    } else {
      remainingCrypts.push(crypt);
    }
  }
  activeCrypts = remainingCrypts;

  console.log('[vampire] Lair cleared: ' + source.name + ' — removed ' + cleared + ' infiltrators, ' + cryptsRemoved + ' crypts');

  return { cleared: cleared, cryptsRemoved: cryptsRemoved, sourceName: source.name };
}

// ---------------------------------------------------------------------------
// Main tick (called from director/index.js on interval)
// ---------------------------------------------------------------------------

function tick(io, state, accounts, socketAccountMap) {
  _infiltrationTick(io, state, accounts, socketAccountMap);
  lastTick = Date.now();
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

function getInfiltrationCount(zoneId) {
  return townInfiltrators[zoneId] || 0;
}

function getTownInfiltrators() {
  // Return a shallow copy to prevent external mutation
  var copy = {};
  var keys = Object.keys(townInfiltrators);
  for (var i = 0; i < keys.length; i++) {
    copy[keys[i]] = townInfiltrators[keys[i]];
  }
  return copy;
}

function getActiveCrypts() {
  return activeCrypts.slice();
}

function cureVampireExposure(accountKey, accounts) {
  if (!accounts) return false;
  var acc = accounts.loadAccount(accountKey);
  if (!acc || !acc.vampireExposed) return false;
  delete acc.vampireExposed;
  accounts.saveAccount(acc);
  return true;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  init: function() {
    _buildVampireSources();
  },
  tick: tick,
  clearLair: clearLair,
  getInfiltrationCount: getInfiltrationCount,
  getTownInfiltrators: getTownInfiltrators,
  getActiveCrypts: getActiveCrypts,
  cureVampireExposure: cureVampireExposure,
  reset: function() {
    townInfiltrators = {};
    activeCrypts = [];
    epidemicRumorsFired = {};
    cryptsSpawned = {};
    lastTick = 0;
    console.log('[vampire] State fully reset');
  },
};
