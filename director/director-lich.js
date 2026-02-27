// director/director-lich.js
// Lich Corruption System — world-threatening emergent event director.
//
// LORE CONTEXT:
// The entity driving this system is not a monster born of chaos. He was a man.
// A Dominion warrior — the most devout and capable soldier of his age — sent by
// the Prophet-King to deploy Heaven's Atlas against Calidar, the Elven and Dark
// Elven capital of Fortuna. He carried it in a great metal container because it
// glowed sickly green and burned to the touch. He swept through the city like
// a plague and placed the device at its heart and activated it.
//
// A Dark Elven god punished him: implanted a malicious artifact in his chest,
// forced him into the Rift at the epicenter of the detonation, and tasked him
// with retrieving five divine souls across infinite shifting floors. He spent
// what felt like aeons on those floors — hollow replica beings, impossible
// architectures, existence measured in decades per day. He retrieved all five
// souls. The god took them, tore the artifact from his chest, and moved the Rift
// to the old human capital as eternal punishment for Dominion arrogance.
//
// He has been inside it ever since — five hundred years of divine fragments
// stitched into his limbs and skull, the remnants of defeated gods making him
// something that cannot die and cannot leave. He is not a monster by nature.
// He is a soldier trying to reach his god, Helios, to beg for help.
// He will never reach Helios. Helios is sealed below Solara, barely alive,
// his essence siphoned by the Cardinals for five hundred years.
//
// The corruption spreading from his sanctums is not malice. It is desperation.
// The necromancers he sends are not conquerors. They are messengers tearing
// holes in the world so he can reach through them.
// Nothing they do will free him. But the holes they tear are real.
// And what falls through them is real.
// And the world is running out of ways to close them.
//
// Corruption spreads daily from lich_sanctum dungeon entrances across
// overworld chunks. Water tiles block spread. Players in corrupted areas
// take periodic shadow damage. Clearing the lich dungeon cleanses nearby
// corruption. Towns can be attacked by undead hordes at high corruption.

'use strict';

var worldgen = require('../worldgen');
var overworldRifts = null; // lazy-loaded to avoid circular require
function _getOverworldRifts() {
  if (!overworldRifts) {
    try { overworldRifts = require('../overworld-rifts'); } catch (e) { /* not loaded yet */ }
  }
  return overworldRifts;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Corruption spread
var SPREAD_RADIUS = 3;           // max chunks per daily tick
var SPREAD_CHANCE = 0.10;        // 10% chance per candidate chunk per tick
var WATER_BLOCKS_SPREAD = true;  // water biome blocks corruption
var MAX_CORRUPTION_LEVEL = 100;  // full corruption
var CORRUPTION_PER_SPREAD = 15;  // corruption added per spread tick
var NATURAL_DECAY_RATE = 2;      // corruption lost per day in uncorrupted-adjacent areas
var CLEANSE_RADIUS = 8;          // chunks cleansed when lich dungeon cleared
var CLEANSE_AMOUNT = 50;         // corruption removed per cleanse

// Horde mechanics
var HORDE_CORRUPTION_THRESHOLD = 60;  // corruption level to spawn undead horde events
var TOWN_ATTACK_THRESHOLD = 80;       // corruption level to trigger town attacks
var HORDE_SPAWN_INTERVAL = 300000;    // 5 min between horde spawn checks

// Player debuff
var CORRUPTION_DEBUFF_INTERVAL = 10000;  // 10s between shadow damage ticks
var CORRUPTION_DEBUFF_DAMAGE = 5;        // base shadow damage per tick
var CORRUPTION_DEBUFF_SCALING = 0.1;     // extra damage per corruption level

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Map of corrupted overworld chunks: 'cx,cy' -> { level: 0-100, sourceId, lastSpread }
var corruptedChunks = {};
var lastDailySpread = null;  // date string of last spread tick
var lastHordeCheck = 0;
var corruptionSources = [];  // computed from WORLD_DUNGEONS on init

// Active undead hordes: array of { id, cx, cy, strength, targetTown, spawnedAt }
var activeHordes = [];

// Player debuff tracking: socketId -> lastDebuffTick timestamp
var playerDebuffTimers = {};

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function _buildCorruptionSources() {
  // Find all lich_sanctum-themed world dungeons as corruption sources
  var dungeons = worldgen.WORLD_DUNGEONS;
  corruptionSources = [];
  for (var i = 0; i < dungeons.length; i++) {
    var d = dungeons[i];
    if (d.theme === 'lich_sanctum') {
      corruptionSources.push({
        dungeonId: d.id,
        cx: d._chunkX,
        cy: d._chunkY,
        name: d.name,
      });
    }
  }
  console.log('[lich] Found ' + corruptionSources.length + ' corruption source(s): ' +
    corruptionSources.map(function(s) { return s.name + ' (' + s.cx + ',' + s.cy + ')'; }).join(', '));
}

// ---------------------------------------------------------------------------
// Daily spread tick — called on interval (60s check, acts once per day)
// ---------------------------------------------------------------------------

function _getTodayString() {
  var d = new Date();
  return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
}

function _dailySpread() {
  var today = _getTodayString();
  if (lastDailySpread === today) return false; // already spread today
  lastDailySpread = today;

  console.log('[lich] Daily corruption spread tick for ' + today);

  // 1. Seed corruption at sources if not already present
  for (var si = 0; si < corruptionSources.length; si++) {
    var src = corruptionSources[si];
    var srcKey = src.cx + ',' + src.cy;
    if (!corruptedChunks[srcKey]) {
      corruptedChunks[srcKey] = {
        level: MAX_CORRUPTION_LEVEL,
        sourceId: src.dungeonId,
        lastSpread: today,
      };
    } else {
      // Source chunk always at max
      corruptedChunks[srcKey].level = MAX_CORRUPTION_LEVEL;
    }
  }

  // 1b. Seed corruption from active mini-rifts
  var riftMod = _getOverworldRifts();
  if (riftMod) {
    var allRifts = riftMod.getAllRifts();
    for (var ri = 0; ri < allRifts.length; ri++) {
      var rift = allRifts[ri];
      if (rift.destroyed || rift.cleared) continue;
      var riftLevel = 70 + (rift.tier || 1) * 6; // 76-100
      var riftKey = rift.chunkX + ',' + rift.chunkY;
      if (!corruptedChunks[riftKey]) {
        corruptedChunks[riftKey] = {
          level: riftLevel,
          sourceId: 'minirift_' + rift.riftId,
          lastSpread: today,
        };
      } else {
        corruptedChunks[riftKey].level = Math.max(corruptedChunks[riftKey].level, riftLevel);
      }
    }
  }

  // 2. Spread from existing corrupted chunks
  var newChunks = {};
  var keys = Object.keys(corruptedChunks);
  for (var ki = 0; ki < keys.length; ki++) {
    var key = keys[ki];
    var chunk = corruptedChunks[key];
    if (chunk.level < 30) continue; // too weak to spread

    var parts = key.split(',');
    var cx = parseInt(parts[0], 10);
    var cy = parseInt(parts[1], 10);

    // Try spreading to adjacent chunks within SPREAD_RADIUS
    for (var dx = -SPREAD_RADIUS; dx <= SPREAD_RADIUS; dx++) {
      for (var dy = -SPREAD_RADIUS; dy <= SPREAD_RADIUS; dy++) {
        if (dx === 0 && dy === 0) continue;
        var dist = Math.abs(dx) + Math.abs(dy);
        if (dist > SPREAD_RADIUS) continue;

        var ncx = cx + dx;
        var ncy = cy + dy;
        var nkey = ncx + ',' + ncy;

        // Skip already heavily corrupted
        if (corruptedChunks[nkey] && corruptedChunks[nkey].level >= MAX_CORRUPTION_LEVEL) continue;

        // Distance-based spread chance (closer = higher chance)
        var chance = SPREAD_CHANCE * (1.0 - (dist - 1) / SPREAD_RADIUS);
        if (Math.random() > chance) continue;

        // Water blocks spread
        if (WATER_BLOCKS_SPREAD) {
          var biome = worldgen.getBiome(ncx, ncy);
          if (biome === 0) continue; // WATER
        }

        var addAmount = Math.floor(CORRUPTION_PER_SPREAD * (1.0 - dist / (SPREAD_RADIUS + 1)));
        if (addAmount < 1) addAmount = 1;

        if (corruptedChunks[nkey]) {
          corruptedChunks[nkey].level = Math.min(MAX_CORRUPTION_LEVEL,
            corruptedChunks[nkey].level + addAmount);
        } else {
          newChunks[nkey] = {
            level: addAmount,
            sourceId: chunk.sourceId,
            lastSpread: today,
          };
        }
      }
    }
  }

  // Apply new chunks
  var newKeys = Object.keys(newChunks);
  for (var ni = 0; ni < newKeys.length; ni++) {
    corruptedChunks[newKeys[ni]] = newChunks[newKeys[ni]];
  }

  // 3. Natural decay for chunks far from sources
  for (var di = 0; di < keys.length; di++) {
    var dkey = keys[di];
    var dchunk = corruptedChunks[dkey];
    // Check if adjacent to a source
    var nearSource = false;
    for (var sci = 0; sci < corruptionSources.length; sci++) {
      var s = corruptionSources[sci];
      var dparts = dkey.split(',');
      var ddist = Math.abs(parseInt(dparts[0], 10) - s.cx) + Math.abs(parseInt(dparts[1], 10) - s.cy);
      if (ddist <= 2) { nearSource = true; break; }
    }
    // Also check proximity to active mini-rifts
    if (!nearSource && riftMod) {
      var dRifts = riftMod.getAllRifts();
      var dparts2 = dkey.split(',');
      var dpx = parseInt(dparts2[0], 10);
      var dpy = parseInt(dparts2[1], 10);
      for (var dri = 0; dri < dRifts.length; dri++) {
        if (dRifts[dri].destroyed || dRifts[dri].cleared) continue;
        var drd = Math.abs(dpx - dRifts[dri].chunkX) + Math.abs(dpy - dRifts[dri].chunkY);
        if (drd <= (dRifts[dri].corruptionRadius || 3)) { nearSource = true; break; }
      }
    }
    if (!nearSource) {
      dchunk.level = Math.max(0, dchunk.level - NATURAL_DECAY_RATE);
      if (dchunk.level <= 0) {
        delete corruptedChunks[dkey];
      }
    }
  }

  var totalCorrupted = Object.keys(corruptedChunks).length;
  console.log('[lich] Corruption spread complete: ' + totalCorrupted + ' corrupted chunks, ' + newKeys.length + ' new');
  return true;
}

// ---------------------------------------------------------------------------
// Cleanse corruption (called when lich dungeon boss is killed)
// ---------------------------------------------------------------------------

function cleanseCorruption(dungeonId) {
  var source = null;
  for (var i = 0; i < corruptionSources.length; i++) {
    if (corruptionSources[i].dungeonId === dungeonId) {
      source = corruptionSources[i];
      break;
    }
  }
  if (!source) return { cleansed: 0 };

  var cleansed = 0;
  var keys = Object.keys(corruptedChunks);
  for (var ki = 0; ki < keys.length; ki++) {
    var key = keys[ki];
    var parts = key.split(',');
    var dist = Math.abs(parseInt(parts[0], 10) - source.cx) + Math.abs(parseInt(parts[1], 10) - source.cy);
    if (dist <= CLEANSE_RADIUS) {
      corruptedChunks[key].level -= CLEANSE_AMOUNT;
      if (corruptedChunks[key].level <= 0) {
        delete corruptedChunks[key];
      }
      cleansed++;
    }
  }

  console.log('[lich] Cleansed ' + cleansed + ' chunks near ' + source.name);
  return { cleansed: cleansed, sourceName: source.name };
}

// ---------------------------------------------------------------------------
// Horde management
// ---------------------------------------------------------------------------

// Find nearest anchor town to a chunk position
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

function _findNearestTown(cx, cy) {
  var best = null;
  var bestDist = Infinity;
  var originCX = worldgen.WORLD_SCALE.originCX;
  var originCY = worldgen.WORLD_SCALE.originCY;
  for (var i = 0; i < ANCHOR_TOWNS.length; i++) {
    var t = ANCHOR_TOWNS[i];
    var tcx = originCX + t.refX;
    var tcy = originCY + t.refY;
    var dist = Math.abs(cx - tcx) + Math.abs(cy - tcy);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best;
}

function _checkHordes(io, state) {
  var now = Date.now();
  if (now - lastHordeCheck < HORDE_SPAWN_INTERVAL) return;
  lastHordeCheck = now;

  // Remove expired hordes (older than 10 minutes)
  activeHordes = activeHordes.filter(function(h) {
    return now - h.spawnedAt < 600000;
  });

  // Check high-corruption areas for horde spawning
  var keys = Object.keys(corruptedChunks);
  for (var ki = 0; ki < keys.length; ki++) {
    var chunk = corruptedChunks[keys[ki]];
    if (chunk.level < HORDE_CORRUPTION_THRESHOLD) continue;

    var parts = keys[ki].split(',');
    var cx = parseInt(parts[0], 10);
    var cy = parseInt(parts[1], 10);

    // Don't spawn too many hordes
    if (activeHordes.length >= 5) break;

    // 5% chance per high-corruption chunk per check
    if (Math.random() > 0.05) continue;

    var nearestTown = _findNearestTown(cx, cy);
    var strength = Math.floor(chunk.level / 10);

    var horde = {
      id: 'horde_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      cx: cx,
      cy: cy,
      strength: strength,
      targetTown: nearestTown ? nearestTown.id : null,
      targetTownName: nearestTown ? nearestTown.name : 'unknown',
      spawnedAt: now,
    };
    activeHordes.push(horde);

    // Broadcast horde event
    if (io) {
      io.emit('world_event', {
        title: 'Undead Horde Spotted!',
        description: 'An undead horde (strength ' + strength + ') is marching toward ' +
          horde.targetTownName + '. The corruption spreads. He is still searching for a way through.',
        type: 'lich_horde',
        hordeId: horde.id,
        targetTown: horde.targetTown,
        strength: strength,
      });
    }

    // Town attack at very high corruption
    if (chunk.level >= TOWN_ATTACK_THRESHOLD && nearestTown) {
      if (io) {
        io.to('zone:' + nearestTown.id).emit('town_under_attack', {
          attackerType: 'undead_horde',
          strength: strength,
          hordeId: horde.id,
          message: 'Undead forces are attacking ' + nearestTown.name + '. He has found a new way to reach through. Defend the town.',
        });
      }
    }

    console.log('[lich] Horde spawned: strength=' + strength + ', target=' + horde.targetTownName);

    // Check for plot raids near high-corruption chunks
    if (chunk.level >= 50) {
      try {
        var baseRaids = require('./director-raids');
        // Look for player plots near this chunk
        if (state && state.zones) {
          state.zones.forEach(function(zone, zoneId) {
            if (zone && zone.type === 'plot' && zone.ownerKey && Math.random() < 0.10) {
              baseRaids.triggerCorruptionRaid(io, state, null, null, zoneId);
            }
          });
        }
      } catch (e) { /* director-raids not available */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Player debuff tick — called from zone movement handler
// ---------------------------------------------------------------------------

function getCorruptionLevel(cx, cy) {
  var key = cx + ',' + cy;
  var chunk = corruptedChunks[key];
  return chunk ? chunk.level : 0;
}

function getCorruptionDebuff(cx, cy) {
  var level = getCorruptionLevel(cx, cy);
  if (level <= 0) return null;
  return {
    level: level,
    damage: Math.floor(CORRUPTION_DEBUFF_DAMAGE + level * CORRUPTION_DEBUFF_SCALING),
    interval: CORRUPTION_DEBUFF_INTERVAL,
  };
}

function shouldApplyDebuff(socketId) {
  var now = Date.now();
  var last = playerDebuffTimers[socketId] || 0;
  if (now - last < CORRUPTION_DEBUFF_INTERVAL) return false;
  playerDebuffTimers[socketId] = now;
  return true;
}

function clearDebuffTimer(socketId) {
  delete playerDebuffTimers[socketId];
}

// ---------------------------------------------------------------------------
// Get corruption state for client (visible chunks only)
// ---------------------------------------------------------------------------

function getCorruptionForArea(centerCX, centerCY, radius) {
  var result = {};
  for (var dx = -radius; dx <= radius; dx++) {
    for (var dy = -radius; dy <= radius; dy++) {
      var key = (centerCX + dx) + ',' + (centerCY + dy);
      if (corruptedChunks[key]) {
        result[key] = corruptedChunks[key].level;
      }
    }
  }
  return result;
}

function getTotalCorruptedChunks() {
  return Object.keys(corruptedChunks).length;
}

function getActiveHordes() {
  return activeHordes;
}

// ---------------------------------------------------------------------------
// Main tick (60s interval from director/index.js)
// ---------------------------------------------------------------------------

function tick(io, state, accounts, socketAccountMap) {
  // Daily spread
  var didSpread = _dailySpread();

  // Horde checks
  _checkHordes(io, state);

  // Apply debuffs to players in corrupted overworld chunks
  if (state && state.playerZones && state.playerPositions) {
    state.playerZones.forEach(function(zoneId, socketId) {
      if (zoneId !== 'overworld') return; // only overworld

      var pos = state.playerPositions.get(socketId);
      if (!pos) return;

      var cx = Math.floor(pos.x / 512);
      var cy = Math.floor(pos.y / 512);
      var debuff = getCorruptionDebuff(cx, cy);
      if (!debuff) return;

      if (!shouldApplyDebuff(socketId)) return;

      // Check equipped cards for corruption_resist effect
      var finalDamage = debuff.damage;
      if (accounts && socketAccountMap) {
        var crAccKey = socketAccountMap.get(socketId);
        if (crAccKey) {
          var crAcc = accounts.loadAccount(crAccKey);
          if (crAcc && crAcc.rpgCards && crAcc.equippedCards) {
            var crCardMap = {};
            for (var cri = 0; cri < crAcc.rpgCards.length; cri++) {
              crCardMap[crAcc.rpgCards[cri].instanceId] = crAcc.rpgCards[cri];
            }
            var totalResist = 0;
            for (var crei = 0; crei < crAcc.equippedCards.length; crei++) {
              var crId = crAcc.equippedCards[crei];
              if (!crId || !crCardMap[crId]) continue;
              var crCard = crCardMap[crId];
              if (crCard.effects) {
                for (var crefi = 0; crefi < crCard.effects.length; crefi++) {
                  if (crCard.effects[crefi].type === 'corruption_resist') {
                    totalResist += crCard.effects[crefi].value || 0;
                  }
                }
              }
            }
            if (totalResist > 0) {
              finalDamage = Math.max(1, Math.floor(finalDamage * (1 - Math.min(totalResist, 0.9))));
            }
          }
        }
      }

      // Send corruption damage to player
      var sock = io.sockets.sockets.get(socketId);
      if (sock) {
        sock.emit('corruption_damage', {
          damage: finalDamage,
          level: debuff.level,
          message: 'The corruption seeps into your bones — the touch of a man who has been divine-touched for five centuries and has not yet found his way home...',
        });
      }
    });
  }

  // If spread happened, broadcast corruption update to all overworld players
  if (didSpread && io) {
    _broadcastCorruptionToOverworldPlayers(io, state);
  }
}

function _broadcastCorruptionToOverworldPlayers(io, state) {
  if (!state || !state.playerZones || !state.playerPositions) return;

  state.playerZones.forEach(function(zoneId, socketId) {
    if (zoneId !== 'overworld') return;

    var pos = state.playerPositions.get(socketId);
    if (!pos) return;

    var cx = Math.floor(pos.x / 512);
    var cy = Math.floor(pos.y / 512);
    var corruption = getCorruptionForArea(cx, cy, 10);

    var sock = io.sockets.sockets.get(socketId);
    if (sock) {
      sock.emit('corruption_update', { chunks: corruption });
    }
  });
}

// ---------------------------------------------------------------------------
// Serialization (for server restart persistence)
// ---------------------------------------------------------------------------

function getState() {
  return {
    corruptedChunks: corruptedChunks,
    lastDailySpread: lastDailySpread,
    activeHordes: activeHordes,
  };
}

function loadState(saved) {
  if (!saved) return;
  if (saved.corruptedChunks) corruptedChunks = saved.corruptedChunks;
  if (saved.lastDailySpread) lastDailySpread = saved.lastDailySpread;
  if (saved.activeHordes) activeHordes = saved.activeHordes;
  console.log('[lich] Loaded corruption state: ' + Object.keys(corruptedChunks).length + ' corrupted chunks');
}

// ---------------------------------------------------------------------------
// Player Cleanse (active corruption removal via purification crystal)
// ---------------------------------------------------------------------------

var PLAYER_CLEANSE_RADIUS = 3;
var PLAYER_CLEANSE_AMOUNT = 25;

function playerCleanse(cx, cy, playerId, bonuses) {
  var cleansed = 0;
  var updatedChunks = {};
  var radiusBonus = (bonuses && bonuses.radiusBonus) ? bonuses.radiusBonus : 0;
  var amountBonus = (bonuses && bonuses.amountBonus) ? bonuses.amountBonus : 0;
  var effectiveRadius = PLAYER_CLEANSE_RADIUS + radiusBonus;
  var effectiveAmount = Math.ceil(PLAYER_CLEANSE_AMOUNT * (1 + amountBonus));

  for (var dx = -effectiveRadius; dx <= effectiveRadius; dx++) {
    for (var dy = -effectiveRadius; dy <= effectiveRadius; dy++) {
      var key = (cx + dx) + ',' + (cy + dy);
      if (corruptedChunks[key]) {
        corruptedChunks[key].level -= effectiveAmount;
        if (corruptedChunks[key].level <= 0) {
          delete corruptedChunks[key];
          updatedChunks[key] = 0;
        } else {
          updatedChunks[key] = corruptedChunks[key].level;
        }
        cleansed++;
      }
    }
  }

  if (cleansed > 0) {
    console.log('[lich] Player ' + playerId + ' cleansed ' + cleansed + ' chunks near (' + cx + ',' + cy + ')');
  }

  return { cleansed: cleansed, chunks: updatedChunks };
}

// ---------------------------------------------------------------------------
// Cleanse rift corruption (called when mini-rift boss is killed)
// Full cleanse within radius — deletes corrupted chunks entirely.
// ---------------------------------------------------------------------------

function cleanseRiftCorruption(cx, cy, radius) {
  if (!cx && cx !== 0) return 0;
  var cleansed = 0;
  var keys = Object.keys(corruptedChunks);
  for (var ki = 0; ki < keys.length; ki++) {
    var key = keys[ki];
    var parts = key.split(',');
    var kcx = parseInt(parts[0], 10);
    var kcy = parseInt(parts[1], 10);
    var dist = Math.abs(kcx - cx) + Math.abs(kcy - cy);
    if (dist <= radius) {
      delete corruptedChunks[key];
      cleansed++;
    }
  }
  if (cleansed > 0) {
    console.log('[lich] Rift corruption cleansed: ' + cleansed + ' chunks around (' + cx + ',' + cy + ') radius ' + radius);
  }
  return cleansed;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Lifecycle
  init: _buildCorruptionSources,
  tick: tick,
  getState: getState,
  loadState: loadState,

  // Corruption queries
  getCorruptionLevel: getCorruptionLevel,
  getCorruptionDebuff: getCorruptionDebuff,
  getCorruptionForArea: getCorruptionForArea,
  getTotalCorruptedChunks: getTotalCorruptedChunks,
  cleanseCorruption: cleanseCorruption,
  cleanseRiftCorruption: cleanseRiftCorruption,
  playerCleanse: playerCleanse,

  // Debuff
  shouldApplyDebuff: shouldApplyDebuff,
  clearDebuffTimer: clearDebuffTimer,

  // Hordes
  getActiveHordes: getActiveHordes,

  // Constants (for handler use)
  CORRUPTION_DEBUFF_DAMAGE: CORRUPTION_DEBUFF_DAMAGE,
  CORRUPTION_DEBUFF_SCALING: CORRUPTION_DEBUFF_SCALING,
};
