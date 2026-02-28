// director/director-raids.js
// NPC base raid orchestration system.
// Raids trigger via lich corruption (>=50 near player plots) OR random macro world events.
// Check every 5 minutes. Max 1 raid per plot per game-day.
// Only targets plots of players who logged in within 24h.

'use strict';

var portalHandler = require('../handlers/portal');
var placement = require('../handlers/placement');
var ca = require('../cellular-automata');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var RAID_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
var RAID_ALERT_DURATION = 60000;          // 60s warning before raid starts
var RAID_TOTAL_DURATION = 10 * 60 * 1000; // 10 minutes total
var WAVE_DELAYS = [0, 120000, 240000];    // 0s, 2min, 4min
var WAVE_SIZES = [3, 5, 8];              // enemies per wave
var MIN_CORRUPTION_FOR_RAID = 50;
var RANDOM_RAID_CHANCE = 0.02;            // 2% chance per eligible plot per check
var MAX_ACTIVE_RAIDS = 3;                 // global cap on simultaneous raids

// Structure HP values (NPC damage only, no decay, no PvP)
var STRUCTURE_HP = {
  wall: 200, stone_wall: 200,
  fence: 80, stone_fence: 100, iron_fence: 150,
  forge: 100, iron_anvil: 100, crafting_table: 100, upgrade_station: 100,
  cauldron: 100, loom: 100, alchemy_table: 100, enchanting_table: 100,
  tanning_rack: 100, brewery: 100, jewelers_bench: 100,
  advanced_forge: 150, master_forge: 200,
  advanced_alchemy_table: 150, master_alchemy_table: 200,
  advanced_loom: 150, master_loom: 200,
  advanced_brewery: 150, master_brewery: 200,
  advanced_enchanting_table: 150,
  bed: 50, bookshelf: 50, table: 50, chair: 50, barrel: 50, crate: 50,
  banner: 50, lantern: 50, torch_sconce: 50, signpost: 50, flower_pot: 50,
  painting: 50, rug: 50, clock: 50, trophy_mount: 50, statue: 80,
  well: 150, animal_pen: 120, scarecrow: 60, sprinkler: 80,
  crop_plot: 60, garden_bed: 60, water_trough: 80,
  storage_chest: 100, door: 100,
};

// Raid enemy templates
var RAID_ENEMIES = {
  wave1: [
    { id: 'raid_skeleton', name: 'Raiding Skeleton', hp: 30, atk: 5, def: 2, xp: 15 },
    { id: 'raid_zombie', name: 'Shambling Corpse', hp: 40, atk: 4, def: 3, xp: 12 },
    { id: 'raid_imp', name: 'Imp Marauder', hp: 25, atk: 6, def: 1, xp: 18 },
  ],
  wave2: [
    { id: 'raid_ghoul', name: 'Ghoul Ravager', hp: 60, atk: 8, def: 4, xp: 25 },
    { id: 'raid_wraith', name: 'Bound Wraith', hp: 50, atk: 10, def: 3, xp: 30 },
    { id: 'raid_orc_raider', name: 'Orc Raider', hp: 70, atk: 7, def: 5, xp: 28 },
  ],
  wave3: [
    { id: 'raid_revenant', name: 'Revenant Captain', hp: 120, atk: 14, def: 8, xp: 60 },
    { id: 'raid_bone_golem', name: 'Bone Golem', hp: 200, atk: 12, def: 12, xp: 80 },
    { id: 'raid_shadow_knight', name: 'Shadow Knight', hp: 150, atk: 16, def: 10, xp: 70 },
  ],
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

var activeRaids = [];       // { plotZoneId, ownerKey, startedAt, wave, enemies[], status }
var raidedToday = new Set(); // plotZoneIds that have been raided this game-day
var lastGameDay = 0;         // track game day for daily reset

// ---------------------------------------------------------------------------
// Tick (called every 5min from director/index.js)
// ---------------------------------------------------------------------------

function tick(io, state, accounts, socketAccountMap) {
  var now = Date.now();

  // Reset daily raid tracking on new game day
  var currentDay = state.world ? (state.world.directorState ? state.world.directorState.narrativeDay : 0) : 0;
  if (currentDay !== lastGameDay) {
    raidedToday.clear();
    lastGameDay = currentDay;
  }

  // Process active raids
  for (var ri = activeRaids.length - 1; ri >= 0; ri--) {
    var raid = activeRaids[ri];
    var elapsed = now - raid.startedAt;

    // Raid complete after total duration
    if (elapsed >= RAID_TOTAL_DURATION) {
      _endRaid(io, state, accounts, raid, 'timeout');
      activeRaids.splice(ri, 1);
      continue;
    }

    // Spawn waves
    for (var wi = 0; wi < WAVE_DELAYS.length; wi++) {
      if (!raid.wavesSpawned[wi] && elapsed >= RAID_ALERT_DURATION + WAVE_DELAYS[wi]) {
        _spawnWave(io, state, raid, wi);
        raid.wavesSpawned[wi] = true;
      }
    }

    // Check if all enemies defeated
    var allDead = true;
    for (var ei = 0; ei < raid.enemies.length; ei++) {
      if (raid.enemies[ei].alive) { allDead = false; break; }
    }
    if (allDead && raid.wavesSpawned[2]) {
      _endRaid(io, state, accounts, raid, 'victory');
      activeRaids.splice(ri, 1);
    }
  }

  // Don't start new raids if at cap
  if (activeRaids.length >= MAX_ACTIVE_RAIDS) return;

  // Check plots for new raid triggers
  state.zones.forEach(function(zone, zoneId) {
    if (!zone || zone.type !== 'plot') return;
    if (!zone.ownerKey) return;
    if (raidedToday.has(zoneId)) return;
    if (activeRaids.some(function(r) { return r.plotZoneId === zoneId; })) return;

    // Only raid plots of recently active players (within 24h)
    var ownerAcc = accounts.loadAccount(zone.ownerKey);
    if (!ownerAcc) return;
    var lastSeen = ownerAcc.lastSeen || 0;
    if (now - lastSeen > 24 * 60 * 60 * 1000) return;

    // Raid trigger: random chance
    var shouldRaid = false;
    if (Math.random() < RANDOM_RAID_CHANCE) {
      shouldRaid = true;
    }

    if (shouldRaid) {
      _startRaid(io, state, accounts, socketAccountMap, zone, zoneId);
    }
  });
}

// ---------------------------------------------------------------------------
// Raid lifecycle
// ---------------------------------------------------------------------------

function _startRaid(io, state, accounts, socketAccountMap, zone, zoneId) {
  var ownerKey = zone.ownerKey;
  raidedToday.add(zoneId);

  var raid = {
    plotZoneId: zoneId,
    ownerKey: ownerKey,
    startedAt: Date.now(),
    wave: 0,
    enemies: [],
    wavesSpawned: [false, false, false],
    status: 'alert',
  };
  activeRaids.push(raid);

  // Set raid alert flag for home teleport bypass
  portalHandler._activeRaidAlerts.add(ownerKey);

  // Alert the owner
  io.to('zone:' + zoneId).emit('base_raid_alert', {
    plotZoneId: zoneId,
    message: 'Your base is under threat! Enemies will arrive in 60 seconds. Use home teleport to defend!',
    alertDuration: RAID_ALERT_DURATION,
  });

  // Also notify owner's socket if they're online elsewhere
  for (var entry of socketAccountMap) {
    if (entry[1] === ownerKey) {
      var ownerSocket = io.sockets.sockets.get(entry[0]);
      if (ownerSocket) {
        ownerSocket.emit('base_raid_alert', {
          plotZoneId: zoneId,
          message: 'Your base is under threat! Enemies arrive in 60 seconds. Home teleport cooldown bypassed!',
          alertDuration: RAID_ALERT_DURATION,
        });
      }
    }
  }

  console.log('[raids] Raid started on plot ' + zoneId + ' (owner: ' + ownerKey + ')');
}

// Build multi-source BFS cost map from zone edges, respecting wall colliders.
// Returns distance map: 'tx,ty' -> distance (tile coords, 32px per tile)
function _buildRaidCostMap(zone) {
  var ZONE_SIZE = 4096;
  var TILE = 32;
  var gridW = Math.floor(ZONE_SIZE / TILE);
  var gridH = Math.floor(ZONE_SIZE / TILE);

  // Build wall set from placed objects
  var blocked = {};
  if (zone.placedObjects) {
    for (var oi = 0; oi < zone.placedObjects.length; oi++) {
      var obj = zone.placedObjects[oi];
      if (!obj) continue;
      var isWall = obj.type === 'wall' || obj.type === 'stone_wall' ||
                   obj.type === 'fence' || obj.type === 'stone_fence' || obj.type === 'iron_fence';
      var isDoor = obj.type === 'door' && !obj.open;
      if (isWall || isDoor) {
        var tx = Math.floor(obj.x / TILE);
        var ty = Math.floor(obj.y / TILE);
        blocked[tx + ',' + ty] = true;
      }
    }
  }

  // Edge sources (all tiles along zone perimeter)
  var sources = [];
  for (var e = 0; e < gridW; e++) {
    sources.push(e + ',0');
    sources.push(e + ',' + (gridH - 1));
  }
  for (var ey = 1; ey < gridH - 1; ey++) {
    sources.push('0,' + ey);
    sources.push((gridW - 1) + ',' + ey);
  }

  // Multi-source BFS
  var costMap = ca.multiSourceBFS(sources, function(cx, cy) {
    if (cx < 0 || cx >= gridW || cy < 0 || cy >= gridH) return false;
    return !blocked[cx + ',' + cy];
  }, gridW + gridH);

  return costMap;
}

function _spawnWave(io, state, raid, waveIndex) {
  var pool = waveIndex === 0 ? RAID_ENEMIES.wave1 : (waveIndex === 1 ? RAID_ENEMIES.wave2 : RAID_ENEMIES.wave3);
  var count = WAVE_SIZES[waveIndex];

  var zone = state.zones.get(raid.plotZoneId);
  if (!zone) return;

  // Build cost map via multi-source BFS from zone edges toward center
  // Enemies use this to path around walls toward structures
  var costMap = _buildRaidCostMap(zone);

  for (var i = 0; i < count; i++) {
    var template = pool[Math.floor(Math.random() * pool.length)];
    // Spawn at zone edges (varied positions)
    var edge = Math.floor(Math.random() * 4);
    var x, y;
    switch (edge) {
      case 0: x = 50; y = Math.random() * 4096; break;         // left
      case 1: x = 4046; y = Math.random() * 4096; break;       // right
      case 2: x = Math.random() * 4096; y = 50; break;         // top
      default: x = Math.random() * 4096; y = 4046; break;      // bottom
    }

    var enemy = {
      id: 'raid_' + Date.now() + '_' + i + '_' + Math.floor(Math.random() * 1000),
      type: template.id,
      name: template.name,
      hp: template.hp,
      maxHp: template.hp,
      atk: template.atk,
      def: template.def,
      xp: template.xp,
      x: Math.round(x),
      y: Math.round(y),
      alive: true,
      raidId: raid.plotZoneId,
      wave: waveIndex,
      costMap: costMap, // shared cost map for pathing
    };
    raid.enemies.push(enemy);
  }

  // Broadcast wave spawn to zone
  io.to('zone:' + raid.plotZoneId).emit('raid_wave', {
    wave: waveIndex + 1,
    totalWaves: 3,
    enemies: raid.enemies.filter(function(e) { return e.wave === waveIndex && e.alive; }).map(function(e) {
      return { id: e.id, type: e.type, name: e.name, hp: e.hp, maxHp: e.maxHp, x: e.x, y: e.y };
    }),
    message: 'Wave ' + (waveIndex + 1) + ' of 3!',
  });

  console.log('[raids] Wave ' + (waveIndex + 1) + ' spawned for ' + raid.plotZoneId + ' (' + count + ' enemies)');
}

function _endRaid(io, state, accounts, raid, result) {
  var zone = state.zones.get(raid.plotZoneId);

  if (result === 'victory') {
    // Rewards
    var essenceReward = 5 + Math.floor(Math.random() * 11); // 5-15
    var crystalReward = 1 + Math.floor(Math.random() * 3);  // 1-3
    var farmXpReward = 150; // 50 per wave

    accounts.addResource(raid.ownerKey, 'dungeon_essence', essenceReward);
    accounts.addResource(raid.ownerKey, 'mana_crystal', crystalReward);
    accounts.addSkillXp(raid.ownerKey, 'farming', farmXpReward);

    // 10% rare seed
    if (Math.random() < 0.10) {
      var seedTypes = ['rare_flower_seed', 'ancient_seed'];
      accounts.addResource(raid.ownerKey, seedTypes[Math.floor(Math.random() * seedTypes.length)], 1);
    }

    // All structures respawn to full HP (no permanent loss on victory)
    if (zone && zone.placedObjects) {
      for (var i = 0; i < zone.placedObjects.length; i++) {
        if (zone.placedObjects[i] && zone.placedObjects[i]._raidDamage) {
          delete zone.placedObjects[i]._raidDamage;
        }
      }
      placement.savePlacements(raid.plotZoneId, zone.placedObjects);
    }

    io.to('zone:' + raid.plotZoneId).emit('raid_ended', {
      result: 'victory',
      rewards: { dungeon_essence: essenceReward, mana_crystal: crystalReward, farming_xp: farmXpReward },
      message: 'Raid defeated! Your base is safe.',
    });
  } else {
    // Timeout/defeat: surviving mobs each destroy 1 random non-wall object
    var survivingMobs = raid.enemies.filter(function(e) { return e.alive; }).length;
    var destroyedObjects = [];

    if (zone && zone.placedObjects && survivingMobs > 0) {
      var nonWallObjects = [];
      for (var j = 0; j < zone.placedObjects.length; j++) {
        var obj = zone.placedObjects[j];
        if (obj && obj.type !== 'wall' && obj.type !== 'stone_wall') {
          nonWallObjects.push(j);
        }
      }
      // Each surviving mob destroys 1 random non-wall object
      var destroyCount = Math.min(survivingMobs, nonWallObjects.length);
      for (var k = 0; k < destroyCount; k++) {
        if (nonWallObjects.length === 0) break;
        var randIdx = Math.floor(Math.random() * nonWallObjects.length);
        var objIdx = nonWallObjects[randIdx];
        if (zone.placedObjects[objIdx]) {
          destroyedObjects.push(zone.placedObjects[objIdx].type);
          zone.placedObjects.splice(objIdx, 1);
          // Remove this entry from the pool, then decrement all higher indices
          nonWallObjects.splice(randIdx, 1);
          for (var m = 0; m < nonWallObjects.length; m++) {
            if (nonWallObjects[m] > objIdx) nonWallObjects[m]--;
          }
        }
      }
      placement.savePlacements(raid.plotZoneId, zone.placedObjects);
    }

    io.to('zone:' + raid.plotZoneId).emit('raid_ended', {
      result: 'defeat',
      destroyed: destroyedObjects,
      message: 'The raiders overwhelmed your defenses. ' + destroyedObjects.length + ' objects were destroyed.',
    });
  }

  // Clear raid alert
  portalHandler._activeRaidAlerts.delete(raid.ownerKey);

  console.log('[raids] Raid ended on ' + raid.plotZoneId + ': ' + result);
}

// ---------------------------------------------------------------------------
// Enemy attack tick (called every 30s — separate from the 5-min lifecycle tick)
// ---------------------------------------------------------------------------

var ATTACK_CHANCE_PER_ENEMY = 0.60; // 60% chance each enemy attacks per tick
var PLAYER_TARGET_WEIGHT = 0.80;    // 80% prefer targeting a player if present

function attackTick(io, state, accounts, socketAccountMap) {
  if (activeRaids.length === 0) return;

  for (var ri = 0; ri < activeRaids.length; ri++) {
    var raid = activeRaids[ri];
    var zone = state.zones.get(raid.plotZoneId);
    if (!zone) continue;

    // Gather players currently in the raid zone
    var zonePlayers = [];
    if (state.playerZones && socketAccountMap) {
      state.playerZones.forEach(function(zoneId, socketId) {
        if (zoneId !== raid.plotZoneId) return;
        var pKey = socketAccountMap.get(socketId);
        if (pKey) zonePlayers.push({ socketId: socketId, key: pKey });
      });
    }

    for (var ei = 0; ei < raid.enemies.length; ei++) {
      var enemy = raid.enemies[ei];
      if (!enemy.alive) continue;
      if (Math.random() > ATTACK_CHANCE_PER_ENEMY) continue;

      // Pick target: player or placed object
      var attackPlayer = zonePlayers.length > 0 && Math.random() < PLAYER_TARGET_WEIGHT;

      if (attackPlayer) {
        // Deal damage to a random player in the zone
        var target = zonePlayers[Math.floor(Math.random() * zonePlayers.length)];
        var acc = accounts.loadAccount(target.key);
        if (!acc) continue;
        var defense = (acc.rpgStats && acc.rpgStats.defense) ? acc.rpgStats.defense : 0;
        var dmg = Math.max(1, enemy.atk - Math.floor(defense / 4));
        if (acc.rpgStats) {
          acc.rpgStats.hp = Math.max(0, (acc.rpgStats.hp || 0) - dmg);
          accounts.saveAccount(acc);
        }
        var pSock = io.sockets.sockets.get(target.socketId);
        if (pSock) {
          pSock.emit('raid_enemy_attack', {
            enemyName: enemy.name,
            damage: dmg,
            hp: acc.rpgStats ? acc.rpgStats.hp : 0,
            maxHp: acc.rpgStats ? acc.rpgStats.maxHp : 0,
          });
        }
      } else if (zone.placedObjects && zone.placedObjects.length > 0) {
        // Deal damage to a random non-wall placed object
        var candidates = [];
        for (var oi = 0; oi < zone.placedObjects.length; oi++) {
          var obj = zone.placedObjects[oi];
          if (obj && obj.type !== 'wall' && obj.type !== 'stone_wall') {
            candidates.push(oi);
          }
        }
        if (candidates.length === 0) continue;
        var pickedOi = candidates[Math.floor(Math.random() * candidates.length)];
        var pickedObj = zone.placedObjects[pickedOi];
        if (!pickedObj) continue;

        // Initialize object HP from STRUCTURE_HP if not set
        if (pickedObj._hp === undefined) {
          pickedObj._hp = STRUCTURE_HP[pickedObj.type] || 100;
        }
        pickedObj._hp = Math.max(0, pickedObj._hp - enemy.atk);

        if (pickedObj._hp <= 0) {
          // Object destroyed mid-raid
          var destroyedType = pickedObj.type;
          zone.placedObjects.splice(pickedOi, 1);
          placement.savePlacements(raid.plotZoneId, zone.placedObjects);
          io.to('zone:' + raid.plotZoneId).emit('raid_object_destroyed', {
            objectType: destroyedType,
            enemyName: enemy.name,
            message: 'A ' + destroyedType.replace(/_/g, ' ') + ' was destroyed by ' + enemy.name + '!',
          });
        } else {
          io.to('zone:' + raid.plotZoneId).emit('raid_object_damaged', {
            objectType: pickedObj.type,
            enemyName: enemy.name,
            hp: pickedObj._hp,
            maxHp: STRUCTURE_HP[pickedObj.type] || 100,
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API for combat integration
// ---------------------------------------------------------------------------

function getRaidByZone(zoneId) {
  for (var i = 0; i < activeRaids.length; i++) {
    if (activeRaids[i].plotZoneId === zoneId) return activeRaids[i];
  }
  return null;
}

function damageRaidEnemy(zoneId, enemyId, damage) {
  var raid = getRaidByZone(zoneId);
  if (!raid) return null;

  for (var i = 0; i < raid.enemies.length; i++) {
    var enemy = raid.enemies[i];
    if (enemy.id === enemyId && enemy.alive) {
      enemy.hp = Math.max(0, enemy.hp - damage);
      if (enemy.hp <= 0) {
        enemy.alive = false;
      }
      return enemy;
    }
  }
  return null;
}

function getActiveRaids() {
  return activeRaids;
}

// ---------------------------------------------------------------------------
// Trigger from lich corruption (called from director-lich.js)
// ---------------------------------------------------------------------------

function triggerCorruptionRaid(io, state, accounts, socketAccountMap, plotZoneId) {
  var zone = state.zones.get(plotZoneId);
  if (!zone || zone.type !== 'plot' || !zone.ownerKey) return;
  if (raidedToday.has(plotZoneId)) return;
  if (activeRaids.some(function(r) { return r.plotZoneId === plotZoneId; })) return;
  if (activeRaids.length >= MAX_ACTIVE_RAIDS) return;

  _startRaid(io, state, accounts, socketAccountMap, zone, plotZoneId);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  tick: tick,
  attackTick: attackTick,
  getRaidByZone: getRaidByZone,
  damageRaidEnemy: damageRaidEnemy,
  getActiveRaids: getActiveRaids,
  triggerCorruptionRaid: triggerCorruptionRaid,
  STRUCTURE_HP: STRUCTURE_HP,
  reset: function() {
    activeRaids = [];
    raidedToday.clear();
    lastGameDay = 0;
    console.log('[raids] State fully reset');
  },
};
