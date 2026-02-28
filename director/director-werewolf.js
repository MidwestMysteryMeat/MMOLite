// director/director-werewolf.js
// Werewolf Lunar Cycle System — tracks the moon phase, spawns werewolf packs
// during full moons, and handles player lycanthropy exposure.
//
// LORE CONTEXT:
// Fenris' Den is not a cave. It is a wound. Something tore a hole in the world
// where the forest meets the mountains, and the thing that crawled out of it
// was not wolf and not man but something older than both. The pack that guards
// the Den does not hunt for food. They hunt for purpose. Every full moon they
// pour out of the wound like blood from a cut and run until they find something
// worth biting.
//
// Lycanthropy is not a curse. It is an invitation. The wolves want company.
// They have been alone in the dark for a very long time.

'use strict';

var worldgen = require('../worldgen');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var FULL_MOON_CYCLE_MS = 14 * 24 * 60 * 60 * 1000;    // 14 real days between full moons
var FULL_MOON_DURATION_MS = 2 * 24 * 60 * 60 * 1000;   // full moon lasts 2 real days
var PACK_SPAWN_RADIUS = 15;                              // chunks from Fenris' Den
var PACK_SPAWN_CHANCE = 0.40;                            // 40% chance per tick to spawn a pack
var MAX_ACTIVE_PACKS = 4;
var LYCANTHROPY_CHANCE = 0.15;                           // 15% chance of infection per exposure
var INFECTION_RADIUS_CHUNKS = 3;                         // proximity to pack for exposure

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

var lastFullMoon = null;            // date string of last full moon (e.g. '2026-02-26')
var nextFullMoon = null;            // timestamp (ms) of next full moon start
var fullMoonStartedAt = null;       // timestamp (ms) when current full moon began
var isFullMoonActive = false;
var lastBroadcast = 0;              // timestamp of last full_moon_rising broadcast

// Active werewolf packs: [{ id, cx, cy, spawnedAt, strength }]
var activePacks = [];

// Player lycanthropy tracking: { accountKey: { infectedAt, stage } }
// Stages: 'exposed' -> 'infected' -> 'turned'
var lycanthropePlayers = {};

// Werewolf source dungeons (built from WORLD_DUNGEONS)
var werewolfSources = [];

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function _buildWerewolfSources() {
  var dungeons = worldgen.WORLD_DUNGEONS;
  werewolfSources = [];
  for (var i = 0; i < dungeons.length; i++) {
    var d = dungeons[i];
    if (d.theme === 'werewolf_den') {
      werewolfSources.push({
        dungeonId: d.id,
        cx: d._chunkX,
        cy: d._chunkY,
        name: d.name,
      });
    }
  }
  console.log('[werewolf] Found ' + werewolfSources.length + ' werewolf source(s): ' +
    werewolfSources.map(function(s) { return s.name + ' (' + s.cx + ',' + s.cy + ')'; }).join(', '));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _isNight(state) {
  if (state && typeof state.getTimeOfDay === 'function') {
    return state.getTimeOfDay() === 'night';
  }
  return false; // default to daytime if state unavailable
}

function _getTodayString() {
  var d = new Date();
  return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
}

// ---------------------------------------------------------------------------
// Lunar cycle management
// ---------------------------------------------------------------------------

function _checkFullMoon() {
  var now = Date.now();

  // First-time initialization: schedule the first full moon
  if (nextFullMoon === null) {
    nextFullMoon = now + FULL_MOON_CYCLE_MS;
    console.log('[werewolf] First full moon scheduled in ' + Math.round(FULL_MOON_CYCLE_MS / 3600000) + ' hours');
    return;
  }

  // Check if a new full moon should start
  if (!isFullMoonActive && now >= nextFullMoon) {
    isFullMoonActive = true;
    fullMoonStartedAt = now;
    lastFullMoon = _getTodayString();
    // Schedule next full moon cycle
    nextFullMoon = now + FULL_MOON_CYCLE_MS;
    console.log('[werewolf] Full moon rising! Duration: ' + Math.round(FULL_MOON_DURATION_MS / 3600000) + ' hours');
    return;
  }

  // Check if the active full moon should end
  if (isFullMoonActive && fullMoonStartedAt !== null) {
    if (now >= fullMoonStartedAt + FULL_MOON_DURATION_MS) {
      isFullMoonActive = false;
      fullMoonStartedAt = null;

      // Clear all packs when the moon wanes
      if (activePacks.length > 0) {
        console.log('[werewolf] Full moon waning. Clearing ' + activePacks.length + ' packs.');
        activePacks = [];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pack spawning
// ---------------------------------------------------------------------------

function _spawnPackIfNeeded(io, state) {
  if (!isFullMoonActive) return;
  if (activePacks.length >= MAX_ACTIVE_PACKS) return;
  if (Math.random() > PACK_SPAWN_CHANCE) return;
  if (werewolfSources.length === 0) return;

  // Pick a random werewolf source
  var source = werewolfSources[Math.floor(Math.random() * werewolfSources.length)];

  // Pick random chunk within PACK_SPAWN_RADIUS of source
  var dx = Math.floor(Math.random() * (PACK_SPAWN_RADIUS * 2 + 1)) - PACK_SPAWN_RADIUS;
  var dy = Math.floor(Math.random() * (PACK_SPAWN_RADIUS * 2 + 1)) - PACK_SPAWN_RADIUS;
  var randCX = source.cx + dx;
  var randCY = source.cy + dy;

  // Avoid water
  var biome = worldgen.getBiome(randCX, randCY);
  if (biome === 0) return; // WATER — try next tick

  var pack = {
    id: 'pack_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
    cx: randCX,
    cy: randCY,
    spawnedAt: Date.now(),
    strength: 3 + Math.floor(Math.random() * 5),
  };
  activePacks.push(pack);

  // Broadcast world event
  if (io) {
    io.emit('world_event', {
      title: 'Werewolf Pack Howling!',
      description: 'A werewolf pack has been spotted in the wilderness. The full moon rises...',
      type: 'werewolf_pack',
      cx: pack.cx,
      cy: pack.cy,
      strength: pack.strength,
    });
  }

  console.log('[werewolf] Pack spawned: ' + pack.id + ' at (' + pack.cx + ',' + pack.cy + ') strength=' + pack.strength);
}

// ---------------------------------------------------------------------------
// Lycanthropy exposure check
// ---------------------------------------------------------------------------

function _checkLycanthropy(io, state, accounts, socketAccountMap) {
  if (!isFullMoonActive) return;
  if (!_isNight(state)) return;
  if (activePacks.length === 0) return;
  if (!state || !state.playerZones || !state.playerPositions) return;
  if (!socketAccountMap) return;

  state.playerZones.forEach(function(zoneId, socketId) {
    // Only overworld players can be exposed
    if (zoneId !== 'overworld') return;

    var pos = state.playerPositions.get(socketId);
    if (!pos) return;

    var playerCX = Math.floor(pos.x / 512);
    var playerCY = Math.floor(pos.y / 512);

    // Check proximity to all active packs
    for (var pi = 0; pi < activePacks.length; pi++) {
      var pack = activePacks[pi];
      var dist = Math.abs(playerCX - pack.cx) + Math.abs(playerCY - pack.cy);
      if (dist > INFECTION_RADIUS_CHUNKS) continue;

      // Roll for lycanthropy
      if (Math.random() > LYCANTHROPY_CHANCE) continue;

      // Get account key for this socket
      var accountKey = socketAccountMap.get(socketId);
      if (!accountKey) continue;

      // Load from account as fallback (restores state after server restart)
      var existing = lycanthropePlayers[accountKey];
      if (!existing && accounts) {
        var chkAcc = accounts.loadAccount(accountKey);
        if (chkAcc && chkAcc.lycanthropy) {
          existing = lycanthropePlayers[accountKey] = chkAcc.lycanthropy;
        }
      }

      var sock = io ? io.sockets.sockets.get(socketId) : null;

      if (!existing) {
        // First exposure
        lycanthropePlayers[accountKey] = {
          infectedAt: Date.now(),
          stage: 'exposed',
        };
        if (accounts) {
          var expAcc = accounts.loadAccount(accountKey);
          if (expAcc) { expAcc.lycanthropy = lycanthropePlayers[accountKey]; accounts.saveAccount(expAcc); }
        }
        if (sock) {
          sock.emit('lycanthropy_exposure', {
            stage: 'exposed',
            message: 'You feel a strange feral energy wash over you. The howling seems to resonate in your bones...',
          });
        }
        console.log('[werewolf] Player ' + accountKey + ' exposed to lycanthropy');
      } else if (existing.stage === 'exposed') {
        // Escalate to infected
        existing.stage = 'infected';
        existing.infectedAt = Date.now();
        if (accounts) {
          var infAcc = accounts.loadAccount(accountKey);
          if (infAcc) { infAcc.lycanthropy = existing; accounts.saveAccount(infAcc); }
        }
        if (sock) {
          sock.emit('lycanthropy_infected', {
            stage: 'infected',
            message: 'The wolf blood burns through your veins. Your senses sharpen. The transformation has begun...',
          });
        }
        console.log('[werewolf] Player ' + accountKey + ' infected with lycanthropy');
      }
      // Already infected or turned — no further escalation from pack exposure

      // Only one infection event per player per tick
      break;
    }
  });
}

// ---------------------------------------------------------------------------
// Main tick (called from director/index.js on interval)
// ---------------------------------------------------------------------------

function tick(io, state, accounts, socketAccountMap) {
  // 1. Update lunar cycle
  _checkFullMoon();

  // 2. Clean expired packs (older than full moon duration)
  var now = Date.now();
  if (activePacks.length > 0) {
    activePacks = activePacks.filter(function(p) {
      return now - p.spawnedAt < FULL_MOON_DURATION_MS;
    });
  }

  // 3. Spawn new packs if needed
  _spawnPackIfNeeded(io, state);

  // 4. Check lycanthropy exposure for overworld players
  _checkLycanthropy(io, state, accounts, socketAccountMap);

  // 5. Broadcast full moon rising (once per activation)
  if (isFullMoonActive && fullMoonStartedAt !== null && lastBroadcast < fullMoonStartedAt) {
    lastBroadcast = now;
    if (io) {
      io.emit('full_moon_rising', {
        message: 'The full moon rises over the land. Beware the howling in the wilderness...',
        duration: FULL_MOON_DURATION_MS,
        startedAt: fullMoonStartedAt,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

function isFullMoon() {
  return isFullMoonActive;
}

function getLycanthropyStatus(accountKey) {
  return lycanthropePlayers[accountKey] || null;
}

function cureLycanthropy(accountKey, accounts) {
  delete lycanthropePlayers[accountKey];
  if (accounts) {
    var acc = accounts.loadAccount(accountKey);
    if (acc && acc.lycanthropy) {
      delete acc.lycanthropy;
      accounts.saveAccount(acc);
    }
  }
}

function getActivePacks() {
  return activePacks.slice();
}

function getWerewolfSources() {
  return werewolfSources.slice();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  init: function() {
    _buildWerewolfSources();
    if (nextFullMoon === null) {
      nextFullMoon = Date.now() + FULL_MOON_CYCLE_MS;
      console.log('[werewolf] Initialized. First full moon in ' + Math.round(FULL_MOON_CYCLE_MS / 3600000) + ' hours');
    }
  },
  tick: tick,
  isFullMoon: isFullMoon,
  getLycanthropyStatus: getLycanthropyStatus,
  cureLycanthropy: cureLycanthropy,
  getActivePacks: getActivePacks,
  getWerewolfSources: getWerewolfSources,
  reset: function() {
    nextFullMoon = Date.now() + FULL_MOON_CYCLE_MS;
    fullMoonStartedAt = null;
    isFullMoonActive = false;
    lastBroadcast = 0;
    activePacks = [];
    lycanthropePlayers = {};
    console.log('[werewolf] State fully reset');
  },
};
