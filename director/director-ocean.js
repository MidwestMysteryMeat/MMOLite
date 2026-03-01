// director/director-ocean.js
// Ocean Leviathan Director — 60s tick.
// Spawns, roams, and tracks leviathans in ocean regions.
// Handles proximity detection, danger assessment, and combat initiation.

'use strict';

var leviathanData = require('../leviathan-data');
var dungeonData   = require('../dungeon-data');
var dungeonCombat = require('../dungeon-combat');

var SIZE_TIERS        = leviathanData.SIZE_TIERS;
var PART_POSITIONS    = leviathanData.PART_POSITIONS;
var LEVIATHAN_TEMPLATES = leviathanData.LEVIATHAN_TEMPLATES;
var OCEAN_REGIONS     = leviathanData.OCEAN_REGIONS;
var LEVIATHAN_ABILITIES = leviathanData.LEVIATHAN_ABILITIES;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

var _leviathans = new Map();   // uid -> leviathan instance
var _nextUid = 1;
var _aggroTimers = new Map();  // socketId -> { timer, leviathanUid }
var _combatLeviathans = new Map(); // combatId -> leviathanUid
var _playerPreCombat = new Map();  // socketId -> { zoneId, x, y }
var MAX_ACTIVE_TOTAL = 12;
var LEVIATHAN_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
var FLEE_WINDOW_MS = 5000;

// ---------------------------------------------------------------------------
// Weighted random pick from spawn table
// ---------------------------------------------------------------------------

function weightedPick(spawnTable, rng) {
  var totalWeight = 0;
  for (var i = 0; i < spawnTable.length; i++) {
    totalWeight += spawnTable[i].weight;
  }
  var roll = rng * totalWeight;
  var cumulative = 0;
  for (var j = 0; j < spawnTable.length; j++) {
    cumulative += spawnTable[j].weight;
    if (roll < cumulative) return spawnTable[j].templateId;
  }
  return spawnTable[spawnTable.length - 1].templateId;
}

// ---------------------------------------------------------------------------
// Spawn a leviathan in a region
// ---------------------------------------------------------------------------

function spawnLeviathan(region) {
  var templateId = weightedPick(region.spawnTable, Math.random());
  var template = LEVIATHAN_TEMPLATES[templateId];
  if (!template) return null;

  var bounds = region.bounds;
  var cx = bounds.cxMin + Math.floor(Math.random() * (bounds.cxMax - bounds.cxMin + 1));
  var cy = bounds.cyMin + Math.floor(Math.random() * (bounds.cyMax - bounds.cyMin + 1));

  var scaled = leviathanData.scaleLeviathan(template, region.dangerLevel);

  var uid = 'lev_' + (_nextUid++);
  var tier = SIZE_TIERS[scaled.tier];

  var leviathan = {
    uid: uid,
    templateId: templateId,
    name: scaled.name,
    tier: scaled.tier,
    tierData: tier,
    regionId: region.id,
    dangerLevel: region.dangerLevel,
    cx: cx,
    cy: cy,
    worldX: cx * 512 + 256,
    worldY: cy * 512 + 256,
    totalHp: scaled.totalHp,
    currentHp: scaled.totalHp,
    parts: scaled.parts,
    phases: scaled.phases,
    currentPhase: 0,
    baseXp: scaled.baseXp,
    baseGold: scaled.baseGold,
    loot: scaled.loot,
    inCombat: false,
    combatId: null,
    spawnedAt: Date.now(),
    enrageTimerSec: tier.enrageTimerSec,
  };

  _leviathans.set(uid, leviathan);
  console.log('[ocean] Spawned ' + leviathan.name + ' (' + uid + ') at chunk ' + cx + ',' + cy + ' in ' + region.name);
  return leviathan;
}

// ---------------------------------------------------------------------------
// Roam: random walk +/-1 chunk, clamped to region bounds
// ---------------------------------------------------------------------------

function roamLeviathan(lev) {
  if (lev.inCombat) return;

  var region = null;
  for (var i = 0; i < OCEAN_REGIONS.length; i++) {
    if (OCEAN_REGIONS[i].id === lev.regionId) { region = OCEAN_REGIONS[i]; break; }
  }
  if (!region) return;

  var dx = Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
  var dy = Math.floor(Math.random() * 3) - 1;
  var newCx = Math.max(region.bounds.cxMin, Math.min(region.bounds.cxMax, lev.cx + dx));
  var newCy = Math.max(region.bounds.cyMin, Math.min(region.bounds.cyMax, lev.cy + dy));

  lev.cx = newCx;
  lev.cy = newCy;
  lev.worldX = newCx * 512 + 256;
  lev.worldY = newCy * 512 + 256;
}

// ---------------------------------------------------------------------------
// Count active leviathans in a region
// ---------------------------------------------------------------------------

function countInRegion(regionId) {
  var count = 0;
  var iter = _leviathans.values();
  var entry = iter.next();
  while (!entry.done) {
    if (entry.value.regionId === regionId) count++;
    entry = iter.next();
  }
  return count;
}

// ---------------------------------------------------------------------------
// 60-second tick
// ---------------------------------------------------------------------------

function tick(io, state, accounts, socketAccountMap) {
  var now = Date.now();

  // 1. Expire old leviathans not in combat
  var toRemove = [];
  var iter = _leviathans.entries();
  var entry = iter.next();
  while (!entry.done) {
    var uid = entry.value[0];
    var lev = entry.value[1];
    if (!lev.inCombat && (now - lev.spawnedAt) > LEVIATHAN_MAX_AGE_MS) {
      toRemove.push(uid);
    }
    entry = iter.next();
  }
  for (var ri = 0; ri < toRemove.length; ri++) {
    _leviathans.delete(toRemove[ri]);
  }

  // 2. Spawn in each region if below max
  var totalActive = _leviathans.size;
  for (var i = 0; i < OCEAN_REGIONS.length; i++) {
    var region = OCEAN_REGIONS[i];
    var inRegion = countInRegion(region.id);
    if (inRegion < region.maxActive && totalActive < MAX_ACTIVE_TOTAL) {
      if (Math.random() < 0.30) {
        spawnLeviathan(region);
        totalActive++;
      }
    }
  }

  // 3. Roam all non-combat leviathans
  var roamIter = _leviathans.values();
  var roamEntry = roamIter.next();
  while (!roamEntry.done) {
    roamLeviathan(roamEntry.value);
    roamEntry = roamIter.next();
  }

  // 4. Broadcast positions to nearby players in overworld
  broadcastPositions(io, state);
}

// ---------------------------------------------------------------------------
// Broadcast leviathan positions to overworld players
// ---------------------------------------------------------------------------

function broadcastPositions(io, state) {
  var overworldZone = state.zones.get('overworld');
  if (!overworldZone) return;

  var levList = [];
  var iter = _leviathans.values();
  var entry = iter.next();
  while (!entry.done) {
    var lev = entry.value;
    if (!lev.inCombat) {
      levList.push({
        id: lev.uid,
        name: lev.name,
        tier: lev.tier,
        cx: lev.cx,
        cy: lev.cy,
        worldX: lev.worldX,
        worldY: lev.worldY,
      });
    }
    entry = iter.next();
  }

  if (levList.length === 0) return;

  // Send to all overworld members (they filter by view range client-side)
  var members = overworldZone.members;
  if (members && members.size > 0) {
    var payload = { leviathans: levList };
    var mIter = members.values();
    var mEntry = mIter.next();
    while (!mEntry.done) {
      io.to(mEntry.value).emit('leviathan_positions', payload);
      mEntry = mIter.next();
    }
  }
}

// ---------------------------------------------------------------------------
// Danger assessment
// ---------------------------------------------------------------------------

function assessDanger(mount, race, level, partySize) {
  // Mount danger: determines base danger factor
  var mountDanger = 1.0;
  if (!mount) {
    mountDanger = 1.0;
  } else {
    switch (mount) {
      case 'raft':          mountDanger = 0.9; break;
      case 'boat':          mountDanger = 0.7; break;
      case 'ship':          mountDanger = 0.4; break;
      case 'sea_mount':     mountDanger = 0.3; break;
      case 'airship':       mountDanger = 0.0; break;
      case 'flying_mount':  mountDanger = 0.0; break;
      default:              mountDanger = 0.8; break;
    }
  }

  // Lizardfolk swimming (no mount) gets reduced danger
  if (!mount && race === 'lizard_folk') {
    mountDanger = 0.6;
  }

  var danger = mountDanger;

  // Party size reduction
  if (partySize >= 4)      danger *= 0.6;
  else if (partySize >= 2) danger *= 0.8;

  // Level reduction
  if (level >= 50)      danger *= 0.7;
  else if (level >= 30) danger *= 0.85;

  return Math.max(0, Math.min(1, danger));
}

// ---------------------------------------------------------------------------
// Proximity check — called from zone.js on chunk boundary crossing
// ---------------------------------------------------------------------------

function checkProximity(socket, cx, cy, account, io) {
  var iter = _leviathans.values();
  var entry = iter.next();

  while (!entry.done) {
    var lev = entry.value;
    entry = iter.next();

    if (lev.inCombat) continue;

    // Check chunk overlap (+/- tier chunks footprint)
    var tierChunks = SIZE_TIERS[lev.tier] ? SIZE_TIERS[lev.tier].chunks : 1;
    var dCx = Math.abs(cx - lev.cx);
    var dCy = Math.abs(cy - lev.cy);
    if (dCx > tierChunks || dCy > tierChunks) continue;

    // Player is within leviathan footprint
    var mount = account.mount || null;
    var race = account.race || 'human';
    var level = account.level || 1;
    var partySize = 1;
    // Try to get party size from state (passed via closure)
    // We'll just use 1 as default; party-aware code would need state ref

    var danger = assessDanger(mount, race, level, partySize);

    if (danger <= 0) {
      // Safe (flying) — informational warning only
      socket.emit('leviathan_warning', {
        leviathanId: lev.uid,
        name: lev.name,
        tier: lev.tier,
        message: 'A massive shadow moves beneath you — ' + lev.name + ' lurks below.',
        safe: true,
        canFlee: false,
      });
    } else if (danger < 0.4) {
      // Warning only — can voluntarily engage
      socket.emit('leviathan_warning', {
        leviathanId: lev.uid,
        name: lev.name,
        tier: lev.tier,
        message: lev.name + ' looms nearby! You could engage if you dare.',
        safe: false,
        canFlee: true,
      });
    } else {
      // Auto-aggro with 5s flee window
      if (_aggroTimers.has(socket.id)) return; // Already in aggro state

      socket.emit('leviathan_aggro', {
        leviathanId: lev.uid,
        name: lev.name,
        tier: lev.tier,
        fleeWindowMs: FLEE_WINDOW_MS,
      });

      var aggroTimer = setTimeout(function() {
        _aggroTimers.delete(socket.id);
        // Player didn't flee — initiate combat
        var stillLev = _leviathans.get(lev.uid);
        if (stillLev && !stillLev.inCombat) {
          initiateLeviathanCombat(socket.id, stillLev, io);
        }
      }, FLEE_WINDOW_MS);
      if (aggroTimer && aggroTimer.unref) aggroTimer.unref();

      _aggroTimers.set(socket.id, { timer: aggroTimer, leviathanUid: lev.uid });
    }

    // Only trigger for the first leviathan in range
    return;
  }
}

// ---------------------------------------------------------------------------
// Flee handling
// ---------------------------------------------------------------------------

function handleFlee(socket, leviathanId) {
  var aggroState = _aggroTimers.get(socket.id);
  if (!aggroState || aggroState.leviathanUid !== leviathanId) {
    socket.emit('leviathan_flee_failed', { message: 'No active aggro to flee from.' });
    return;
  }

  // Determine flee chance based on mount
  var mount = null;
  // We need account data — caller should pass it or we look up from the socket context
  // For simplicity, assume mount info was cached or is re-fetched
  var fleeChance = 0.5; // default
  // Mount-based flee chances will be computed from account if available
  // The handler passes account info

  var roll = Math.random();
  if (roll < fleeChance) {
    // Flee success — cancel aggro timer
    clearTimeout(aggroState.timer);
    _aggroTimers.delete(socket.id);
    socket.emit('leviathan_flee_success', { message: 'You escape the leviathan\'s grasp!' });
  } else {
    // Flee failed — immediate combat
    clearTimeout(aggroState.timer);
    _aggroTimers.delete(socket.id);
    socket.emit('leviathan_flee_failed', { message: 'You couldn\'t escape! The leviathan attacks!' });

    var lev = _leviathans.get(leviathanId);
    if (lev && !lev.inCombat) {
      initiateLeviathanCombat(socket.id, lev, socket.server);
    }
  }
}

function handleFleeWithAccount(socket, leviathanId, account, io) {
  var aggroState = _aggroTimers.get(socket.id);
  if (!aggroState || aggroState.leviathanUid !== leviathanId) {
    socket.emit('leviathan_flee_failed', { message: 'No active aggro to flee from.' });
    return;
  }

  var mount = account.mount || null;
  var fleeChance = 0.5;
  switch (mount) {
    case 'ship':          fleeChance = 0.80; break;
    case 'sea_mount':     fleeChance = 0.90; break;
    case 'boat':          fleeChance = 0.60; break;
    case 'raft':          fleeChance = 0.30; break;
    case 'airship':       fleeChance = 1.00; break;
    case 'flying_mount':  fleeChance = 1.00; break;
    default:              fleeChance = 0.40; break;
  }
  if (!mount && account.race === 'lizard_folk') fleeChance = 0.55;

  var roll = Math.random();
  if (roll < fleeChance) {
    clearTimeout(aggroState.timer);
    _aggroTimers.delete(socket.id);
    socket.emit('leviathan_flee_success', { message: 'You escape the leviathan\'s grasp!' });
  } else {
    clearTimeout(aggroState.timer);
    _aggroTimers.delete(socket.id);
    socket.emit('leviathan_flee_failed', { message: 'You couldn\'t escape! The leviathan attacks!' });

    var lev = _leviathans.get(leviathanId);
    if (lev && !lev.inCombat) {
      initiateLeviathanCombat(socket.id, lev, io);
    }
  }
}

// ---------------------------------------------------------------------------
// Combat initiation
// ---------------------------------------------------------------------------

function initiateLeviathanCombat(socketId, leviathan, io) {
  if (leviathan.inCombat) return;

  var state = require('../state');
  var accounts = require('../accounts');

  // Gather party members
  var party = state.getPlayerParty(socketId);
  var memberIds = party ? Array.from(party.members) : [socketId];

  // Save pre-combat positions for all participants
  for (var mi = 0; mi < memberIds.length; mi++) {
    var mid = memberIds[mi];
    var mZone = state.playerZones ? state.playerZones.get(mid) : null;
    var mPos = state.playerPositions ? state.playerPositions.get(mid) : null;
    if (!mZone) mZone = 'overworld';
    _playerPreCombat.set(mid, {
      zoneId: mZone,
      x: mPos ? mPos.x : 0,
      y: mPos ? mPos.y : 0,
    });
  }

  // Create temporary zone
  var zoneId = 'leviathan_' + leviathan.uid + '_' + Date.now();
  var tier = SIZE_TIERS[leviathan.tier];
  var arenaW = tier.arenaWidth;
  var arenaH = tier.arenaHeight;

  // Generate ocean arena floor
  var rngSeed = Date.now() % 100000;
  var rngState = rngSeed;
  var rng = function() {
    rngState = (rngState * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (rngState >>> 0) / 0xFFFFFFFF;
  };

  var arenaResult = leviathanData.generateOceanArenaLayout(arenaW, arenaH, rng, leviathan.tier);

  // Create temp zone in state
  state.createZone(zoneId, {
    name: leviathan.name + ' Arena',
    type: 'dungeon',
    width: arenaW * 32,
    height: arenaH * 32,
  });

  // Build floor data
  var floor = {
    grid: arenaResult.grid,
    width: arenaW,
    height: arenaH,
    theme: 'ocean_arena',
    themeColor: dungeonData.THEME_COLORS.ocean_arena,
    enemies: [],
    rooms: arenaResult.rooms,
    spawnRoom: arenaResult.spawnRoom,
  };

  // Position leviathan parts as enemies in arena
  var enemies = [];
  for (var pi = 0; pi < leviathan.parts.length; pi++) {
    var part = leviathan.parts[pi];
    if (part.hidden) continue; // Hidden parts start unavailable

    var posFn = PART_POSITIONS[part.position] || PART_POSITIONS.center;
    var pos = posFn(arenaW, arenaH);

    // Resolve ability strings to full ability definitions
    var resolvedAbilities = [];
    if (part.abilities) {
      for (var ai = 0; ai < part.abilities.length; ai++) {
        var abilityName = part.abilities[ai];
        var abilityDef = LEVIATHAN_ABILITIES[abilityName];
        if (abilityDef) {
          resolvedAbilities.push({
            id: abilityName,
            name: abilityDef.name,
            type: abilityDef.type,
            damage: abilityDef.damage || 0,
            range: abilityDef.range || 1,
            cooldown: abilityDef.cooldown || 3,
            radius: abilityDef.radius || 0,
            statusEffect: abilityDef.statusEffect || null,
            summon: abilityDef.summon || null,
            hazard: abilityDef.hazard || null,
            pullDistance: abilityDef.pullDistance || 0,
            buff: abilityDef.buff || null,
            heal: abilityDef.heal || null,
            _lastUsedTurn: 0,
          });
        } else {
          // Fallback: basic attack if ability not found
          resolvedAbilities.push({ id: abilityName, name: abilityName, type: 'attack', damage: part.atk, range: 1, cooldown: 2 });
        }
      }
    }

    enemies.push({
      id: 'lev_' + part.id,
      name: part.name,
      hp: part.hp,
      maxHp: part.hp,
      atk: part.atk,
      def: part.def,
      speed: 8,
      x: pos.x,
      y: pos.y,
      archetype: part.archetype,
      abilities: resolvedAbilities,
      isLeviathanPart: true,
      leviathanUid: leviathan.uid,
      partId: part.id,
      onDestroy: part.onDestroy,
      alive: true,
    });
  }

  // Build player data for initCombat
  var players = [];
  var spawnRoom = arenaResult.spawnRoom;
  for (var si = 0; si < memberIds.length; si++) {
    var sid = memberIds[si];
    var socketAccountMap = require('../socket').getSocketAccountMap ? require('../socket').getSocketAccountMap() : null;
    var accKey = socketAccountMap ? socketAccountMap.get(sid) : null;
    var acc = accKey ? accounts.loadAccount(accKey) : null;

    var spawnX = spawnRoom.centerX + (si % 5) * 2 - 4;
    var spawnY = spawnRoom.centerY + Math.floor(si / 5) * 2;

    players.push({
      socketId: sid,
      name: acc ? acc.username : 'Player',
      x: spawnX,
      y: spawnY,
      level: acc ? (acc.level || 1) : 1,
      race: acc ? (acc.race || 'human') : 'human',
      rpgStats: acc ? acc.rpgStats : null,
      equippedCards: acc ? (acc.equippedCards || []) : [],
      combat: acc ? accounts.getComputedStats(accKey) : {},
    });

    // Move player to temp zone
    state.joinZone(sid, zoneId, spawnX * 32, spawnY * 32);
    if (io) {
      io.to(sid).emit('zone_state', state.getZoneState(zoneId, sid));
    }
  }

  // Mark leviathan as in combat
  leviathan.inCombat = true;
  leviathan.combatId = zoneId;

  // Combat callbacks
  var levUid = leviathan.uid;
  var callbacks = {
    broadcastToFloor: function(event, data) {
      for (var bi = 0; bi < memberIds.length; bi++) {
        io.to(memberIds[bi]).emit(event, data);
      }
    },
    handleDeath: function(socketId) {
      // Player death in leviathan combat — they stay in zone but can't act
    },
    handlePartDeath: function(combat, unitId, partData) {
      var partEnemy = combat.units.get(unitId);
      if (!partEnemy) return;

      // Broadcast part destruction
      callbacks.broadcastToFloor('leviathan_part_destroyed', {
        partId: partEnemy.partId,
        partName: partEnemy.name,
        effect: partEnemy.onDestroy ? partEnemy.onDestroy.message : (partEnemy.name + ' has been destroyed!'),
      });

      // Apply onDestroy effects
      if (partEnemy.onDestroy) {
        applyOnDestroyEffect(combat, partEnemy.onDestroy, levUid);
      }
    },
    checkPhase: function(combat) {
      var lev = _leviathans.get(levUid);
      if (!lev) return;

      // Calculate remaining total HP across all alive parts
      var totalRemainingHp = 0;
      var combatIter = combat.units.values();
      var cEntry = combatIter.next();
      while (!cEntry.done) {
        var u = cEntry.value;
        if (u.isLeviathanPart && u.alive) {
          totalRemainingHp += u.hp;
        }
        cEntry = combatIter.next();
      }

      var hpRatio = totalRemainingHp / lev.totalHp;

      // Check from current+1 onward for threshold crossings
      for (var phj = lev.currentPhase + 1; phj < lev.phases.length; phj++) {
        if (hpRatio <= lev.phases[phj].threshold) {
          lev.currentPhase = phj;
          var phase = lev.phases[phj];

          // Apply atkMult to all alive parts
          var pIter = combat.units.values();
          var pEntry = pIter.next();
          while (!pEntry.done) {
            var pu = pEntry.value;
            if (pu.isLeviathanPart && pu.alive) {
              pu.combat = pu.combat || {};
              pu.combat.meleeDmgMult = phase.atkMult;
            }
            pEntry = pIter.next();
          }

          callbacks.broadcastToFloor('leviathan_phase_change', {
            phase: phase.name,
            description: phase.description,
            atkMult: phase.atkMult,
          });
          break;
        }
      }

      // Check enrage timer
      if (combat._leviathanStartTime) {
        var elapsed = (Date.now() - combat._leviathanStartTime) / 1000;
        if (elapsed >= lev.enrageTimerSec && !combat._leviathanEnraged) {
          combat._leviathanEnraged = true;
          // Double ATK on all alive parts
          var eIter = combat.units.values();
          var eEntry = eIter.next();
          while (!eEntry.done) {
            var eu = eEntry.value;
            if (eu.isLeviathanPart && eu.alive) {
              eu.atk = (eu.atk || 10) * 2;
            }
            eEntry = eIter.next();
          }
          callbacks.broadcastToFloor('leviathan_enrage', {
            message: lev.name + ' enters a BERSERK RAGE!',
          });
        }
      }
    },
    onCombatEnd: function(combat, result) {
      // Clean up combat tracking
      if (combat && combat.id) _combatLeviathans.delete(combat.id);
      else if (combatId) _combatLeviathans.delete(combatId);
      if (result === 'victory') {
        handleLeviathanKill(levUid, memberIds, io);
      }
      // Return all players to overworld
      returnPlayersToOverworld(memberIds, io, state);
      // Clean up temp zone
      if (state.zones.has(zoneId)) {
        state.zones.delete(zoneId);
      }
    },
  };

  // Init combat via dungeon-combat engine (returns combatId string, not object)
  var combatId = dungeonCombat.initCombat(zoneId, players, enemies, floor, callbacks);
  var combat = combatId ? dungeonCombat.getCombatState(combatId) : null;
  if (combat) {
    combat._leviathanStartTime = Date.now();
    combat._isLeviathanCombat = true;
    _combatLeviathans.set(combatId, levUid);
  }

  // Emit combat start to all participants
  var partsInfo = [];
  for (var pii = 0; pii < leviathan.parts.length; pii++) {
    var pp = leviathan.parts[pii];
    if (!pp.hidden) {
      partsInfo.push({ id: pp.id, name: pp.name, hp: pp.hp, maxHp: pp.hp });
    }
  }

  for (var ei = 0; ei < memberIds.length; ei++) {
    io.to(memberIds[ei]).emit('leviathan_combat_start', {
      zoneId: zoneId,
      leviathanName: leviathan.name,
      tier: leviathan.tier,
      floor: {
        grid: floor.grid,
        width: floor.width,
        height: floor.height,
        theme: floor.theme,
        themeColor: floor.themeColor,
      },
      parts: partsInfo,
    });
  }

  console.log('[ocean] Combat started: ' + leviathan.name + ' (' + levUid + ') vs ' + memberIds.length + ' player(s)');
}

// ---------------------------------------------------------------------------
// Apply onDestroy effects
// ---------------------------------------------------------------------------

function applyOnDestroyEffect(combat, destroyEffect, levUid) {
  if (!destroyEffect || !destroyEffect.effect) return;

  var iter = combat.units.values();
  var entry = iter.next();

  switch (destroyEffect.effect) {
    case 'expose_core':
      // Reduce target part's def
      while (!entry.done) {
        var u = entry.value;
        if (u.isLeviathanPart && u.partId === destroyEffect.target && u.alive) {
          u.def = Math.max(0, Math.floor(u.def * (1 - (destroyEffect.defReduction || 0.5))));
        }
        entry = iter.next();
      }
      break;

    case 'reduce_speed':
      // Reduce all parts' speed
      while (!entry.done) {
        var su = entry.value;
        if (su.isLeviathanPart && su.alive) {
          su.speed = Math.max(1, Math.floor(su.speed * (1 - (destroyEffect.speedReduction || 0.3))));
        }
        entry = iter.next();
      }
      break;

    case 'weaken_grip':
      // Reduce all remaining tentacle parts' atk
      while (!entry.done) {
        var wu = entry.value;
        if (wu.isLeviathanPart && wu.alive && wu.partId && wu.partId.indexOf('tent') === 0) {
          wu.atk = Math.max(1, wu.atk - (destroyEffect.atkReduction || 3));
        }
        entry = iter.next();
      }
      break;

    case 'disable_lure':
    case 'stop_spawns':
    case 'disable_hazard':
      // These are passive — the effect is simply that the part is dead,
      // so its abilities (mesmerize, spawn_add, create_hazard) stop firing.
      break;

    case 'expose_body':
      // Reveal a hidden body part
      var lev = _leviathans.get(levUid);
      if (!lev) break;
      for (var pi = 0; pi < lev.parts.length; pi++) {
        var part = lev.parts[pi];
        if (part.id === destroyEffect.target && part.hidden) {
          part.hidden = false;
          // Add the part to combat
          var posFn = PART_POSITIONS[part.position] || PART_POSITIONS.center;
          var pos = posFn(SIZE_TIERS[lev.tier].arenaWidth, SIZE_TIERS[lev.tier].arenaHeight);
          var newUnit = {
            id: 'lev_' + part.id,
            type: 'enemy',
            name: part.name,
            hp: part.hp,
            maxHp: part.hp,
            atk: part.atk,
            def: part.def,
            speed: 8,
            x: pos.x,
            y: pos.y,
            ct: 0,
            archetype: part.archetype,
            abilities: part.abilities,
            isLeviathanPart: true,
            leviathanUid: levUid,
            partId: part.id,
            onDestroy: part.onDestroy,
            alive: true,
            statusEffects: [],
            abilityCooldowns: new Map(),
            combat: { meleeDmgMult: 1, magicDmgMult: 1 },
          };
          combat.units.set(newUnit.id, newUnit);
          break;
        }
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Leviathan kill — awards
// ---------------------------------------------------------------------------

function handleLeviathanKill(levUid, memberIds, io) {
  var lev = _leviathans.get(levUid);
  if (!lev) return;

  var accounts = require('../accounts');
  var socketMod = null;
  try { socketMod = require('../socket'); } catch (e) { /* ignore */ }
  var socketAccountMap = socketMod && socketMod.getSocketAccountMap ? socketMod.getSocketAccountMap() : null;

  // Roll loot
  var drops = leviathanData.rollLeviathanLoot(lev.loot);

  // Distribute to all participants
  var xpPerPlayer = Math.floor(lev.baseXp / Math.max(1, memberIds.length));
  var goldPerPlayer = Math.floor(lev.baseGold / Math.max(1, memberIds.length));

  for (var i = 0; i < memberIds.length; i++) {
    var sid = memberIds[i];
    var accKey = socketAccountMap ? socketAccountMap.get(sid) : null;
    if (!accKey) continue;

    // Award XP
    accounts.addSkillXp(accKey, 'melee', xpPerPlayer);

    // Award gold
    accounts.updateChips(accKey, goldPerPlayer);

    // Award loot resources
    for (var di = 0; di < drops.length; di++) {
      accounts.addResource(accKey, drops[di].resource, drops[di].quantity);
    }

    // Track kill
    accounts.incrementLeviathanKill(accKey, lev.templateId);

    // Notify player
    io.to(sid).emit('harvest_result', {
      message: lev.name + ' defeated! You earned ' + xpPerPlayer + ' XP, ' + goldPerPlayer + ' coins.',
    });
    io.to(sid).emit('inventory_updated', accounts.getMMOInventory(accKey));
  }

  // Remove leviathan
  _leviathans.delete(levUid);
  console.log('[ocean] ' + lev.name + ' (' + levUid + ') killed by ' + memberIds.length + ' player(s)');
}

// ---------------------------------------------------------------------------
// Return players to their pre-combat overworld positions
// ---------------------------------------------------------------------------

function returnPlayersToOverworld(memberIds, io, state) {
  for (var i = 0; i < memberIds.length; i++) {
    var sid = memberIds[i];
    var preCombat = _playerPreCombat.get(sid);
    _playerPreCombat.delete(sid);

    var targetZone = (preCombat && preCombat.zoneId) ? preCombat.zoneId : 'overworld';
    var targetX = preCombat ? preCombat.x : 0;
    var targetY = preCombat ? preCombat.y : 0;

    state.joinZone(sid, targetZone, targetX, targetY);
    if (io) {
      io.to(sid).emit('zone_state', state.getZoneState(targetZone, sid));
    }
  }
}

// ---------------------------------------------------------------------------
// Voluntary engage
// ---------------------------------------------------------------------------

function handleEngage(socket, leviathanId, io) {
  var lev = _leviathans.get(leviathanId);
  if (!lev || lev.inCombat) {
    socket.emit('leviathan_flee_failed', { message: 'That leviathan is not available.' });
    return;
  }

  // Cancel any pending aggro timer
  var aggroState = _aggroTimers.get(socket.id);
  if (aggroState) {
    clearTimeout(aggroState.timer);
    _aggroTimers.delete(socket.id);
  }

  initiateLeviathanCombat(socket.id, lev, io);
}

// ---------------------------------------------------------------------------
// Info query
// ---------------------------------------------------------------------------

function getLeviathansNearby(cx, cy, radius) {
  var results = [];
  var iter = _leviathans.values();
  var entry = iter.next();
  while (!entry.done) {
    var lev = entry.value;
    if (!lev.inCombat && Math.abs(cx - lev.cx) <= radius && Math.abs(cy - lev.cy) <= radius) {
      results.push(lev);
    }
    entry = iter.next();
  }
  return results;
}

function getLeviathanInfo(leviathanId) {
  var lev = _leviathans.get(leviathanId);
  if (!lev) return null;
  return {
    name: lev.name,
    tier: lev.tier,
    totalHp: lev.totalHp,
    parts: lev.parts.map(function(p) {
      return { id: p.id, name: p.name, hp: p.hp, hidden: p.hidden || false };
    }),
    dangerLevel: lev.dangerLevel,
  };
}

// ---------------------------------------------------------------------------
// Cleanup on player disconnect
// ---------------------------------------------------------------------------

function handleDisconnect(socketId) {
  var aggroState = _aggroTimers.get(socketId);
  if (aggroState) {
    clearTimeout(aggroState.timer);
    _aggroTimers.delete(socketId);
  }
  _playerPreCombat.delete(socketId);
}

// ---------------------------------------------------------------------------
// Leviathan ability execution (called from dungeon-combat AI tick)
// ---------------------------------------------------------------------------

function executeLeviathanAbility(combat, unit, ability, targets, broadcastFn) {
  if (!ability || !unit || !unit.alive) return;

  var turnNow = combat.turn || 0;
  // Check cooldown
  if (ability._lastUsedTurn && (turnNow - ability._lastUsedTurn) < (ability.cooldown || 2)) return;
  ability._lastUsedTurn = turnNow;

  switch (ability.type) {
    case 'attack': {
      // Single-target damage + optional status effect
      for (var i = 0; i < targets.length; i++) {
        var target = combat.units.get(targets[i]);
        if (!target || !target.alive) continue;
        var dmg = Math.max(1, (ability.damage || unit.atk) - (target.combat ? (target.combat.def || 0) : 0));
        target.hp = Math.max(0, target.hp - dmg);
        if (broadcastFn) broadcastFn('tc_damage', { sourceId: unit.id, targetId: target.id, damage: dmg, ability: ability.name });
        if (ability.statusEffect && Math.random() < (ability.statusEffect.chance || 0.5)) {
          if (!target.statusEffects) target.statusEffects = [];
          target.statusEffects.push({ name: ability.statusEffect.name, duration: ability.statusEffect.duration || 2, appliedAt: turnNow });
          if (broadcastFn) broadcastFn('tc_status_applied', { targetId: target.id, effect: ability.statusEffect.name, duration: ability.statusEffect.duration });
        }
        if (target.hp <= 0) target.alive = false;
        break; // single target
      }
      break;
    }
    case 'aoe':
    case 'cone':
    case 'line': {
      // Multi-target damage
      for (var ai = 0; ai < targets.length; ai++) {
        var aoeTarget = combat.units.get(targets[ai]);
        if (!aoeTarget || !aoeTarget.alive) continue;
        var aoeDmg = Math.max(1, (ability.damage || unit.atk) - Math.floor((aoeTarget.combat ? (aoeTarget.combat.def || 0) : 0) * 0.5));
        aoeTarget.hp = Math.max(0, aoeTarget.hp - aoeDmg);
        if (broadcastFn) broadcastFn('tc_damage', { sourceId: unit.id, targetId: aoeTarget.id, damage: aoeDmg, ability: ability.name });
        if (ability.statusEffect && Math.random() < (ability.statusEffect.chance || 0.5)) {
          if (!aoeTarget.statusEffects) aoeTarget.statusEffects = [];
          aoeTarget.statusEffects.push({ name: ability.statusEffect.name, duration: ability.statusEffect.duration || 2, appliedAt: turnNow });
        }
        if (aoeTarget.hp <= 0) aoeTarget.alive = false;
      }
      break;
    }
    case 'summon': {
      // Spawn a minion unit
      if (ability.summon) {
        var summonId = 'minion_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        var minion = {
          id: summonId,
          name: 'Ocean Minion',
          hp: ability.summon.hp || 30,
          maxHp: ability.summon.hp || 30,
          atk: ability.summon.atk || 8,
          def: ability.summon.def || 3,
          speed: ability.summon.speed || 10,
          x: unit.x + (Math.random() < 0.5 ? -2 : 2),
          y: unit.y + (Math.random() < 0.5 ? -2 : 2),
          alive: true,
          isEnemy: true,
          abilities: [],
        };
        combat.units.set(summonId, minion);
        if (broadcastFn) broadcastFn('tc_summon', { sourceId: unit.id, minion: { id: summonId, name: minion.name, hp: minion.hp, maxHp: minion.maxHp, x: minion.x, y: minion.y } });
      }
      break;
    }
    case 'terrain': {
      // Create hazardous tiles
      if (ability.hazard) {
        var hazardId = 'hazard_' + Date.now();
        if (!combat._hazards) combat._hazards = [];
        combat._hazards.push({
          id: hazardId,
          x: unit.x,
          y: unit.y,
          radius: ability.hazard.radius || 2,
          damagePerTurn: ability.hazard.damagePerTurn || 8,
          duration: ability.hazard.duration || 3,
          tileType: ability.hazard.tileType || 'TOXIC_POOL',
          createdAt: turnNow,
        });
        if (broadcastFn) broadcastFn('tc_hazard_created', { x: unit.x, y: unit.y, radius: ability.hazard.radius, tileType: ability.hazard.tileType, duration: ability.hazard.duration });
      }
      break;
    }
    case 'pull': {
      // Pull a target closer to this unit
      for (var pi = 0; pi < targets.length; pi++) {
        var pullTarget = combat.units.get(targets[pi]);
        if (!pullTarget || !pullTarget.alive) continue;
        var dx = unit.x - pullTarget.x;
        var dy = unit.y - pullTarget.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          var pullDist = Math.min(ability.pullDistance || 3, dist);
          pullTarget.x += Math.round(dx / dist * pullDist);
          pullTarget.y += Math.round(dy / dist * pullDist);
        }
        if (ability.damage) {
          var pullDmg = Math.max(1, ability.damage);
          pullTarget.hp = Math.max(0, pullTarget.hp - pullDmg);
          if (pullTarget.hp <= 0) pullTarget.alive = false;
        }
        if (broadcastFn) broadcastFn('tc_pull', { sourceId: unit.id, targetId: pullTarget.id, newX: pullTarget.x, newY: pullTarget.y, damage: ability.damage || 0 });
        break; // single target
      }
      break;
    }
    case 'buff': {
      // Self-buff
      if (ability.buff) {
        if (!unit._buffs) unit._buffs = [];
        unit._buffs.push({ stat: ability.buff.stat, multiplier: ability.buff.multiplier, duration: ability.buff.duration, appliedAt: turnNow });
        if (ability.buff.stat === 'def') unit.def = Math.round(unit.def * ability.buff.multiplier);
        if (broadcastFn) broadcastFn('tc_buff', { unitId: unit.id, ability: ability.name, stat: ability.buff.stat, duration: ability.buff.duration });
      }
      break;
    }
    case 'heal': {
      // Self-heal
      if (ability.heal) {
        var healAmount = Math.round(unit.maxHp * (ability.heal.percent || 0.10));
        unit.hp = Math.min(unit.maxHp, unit.hp + healAmount);
        if (broadcastFn) broadcastFn('tc_heal', { unitId: unit.id, amount: healAmount, ability: ability.name });
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  tick: tick,
  checkProximity: checkProximity,
  assessDanger: assessDanger,
  handleFlee: handleFlee,
  handleFleeWithAccount: handleFleeWithAccount,
  handleEngage: handleEngage,
  handleDisconnect: handleDisconnect,
  getLeviathansNearby: getLeviathansNearby,
  getLeviathanInfo: getLeviathanInfo,
  initiateLeviathanCombat: initiateLeviathanCombat,
  broadcastPositions: broadcastPositions,
  executeLeviathanAbility: executeLeviathanAbility,
};
