// combat-scaling.js
// Difficulty scaling, group scaling, raid scaling, and reinforcement spawning.
// Extracted from dungeon-combat.js — re-exported for backward compatibility.

'use strict';

var dungeonAI = require('./dungeon-ai');
var combatGrid = require('./combat-grid');
var WALKABLE_TILES = combatGrid.WALKABLE_TILES;

var SOLO_HP_SCALE, SOLO_ATK_SCALE, DUO_HP_SCALE, DUO_ATK_SCALE;
var TRIO_HP_SCALE, TRIO_ATK_SCALE, OFFLINE_STAT_SCALE;
var RALLY_PLAYER_THRESHOLD, RALLY_INTERVAL_TURNS, RALLY_MAX_ENEMIES;
var RALLY_STAT_SCALE_PER_PLAYER;

function init(deps) {
  SOLO_HP_SCALE = deps.SOLO_HP_SCALE;
  SOLO_ATK_SCALE = deps.SOLO_ATK_SCALE;
  DUO_HP_SCALE = deps.DUO_HP_SCALE;
  DUO_ATK_SCALE = deps.DUO_ATK_SCALE;
  TRIO_HP_SCALE = deps.TRIO_HP_SCALE;
  TRIO_ATK_SCALE = deps.TRIO_ATK_SCALE;
  OFFLINE_STAT_SCALE = deps.OFFLINE_STAT_SCALE;
  RALLY_PLAYER_THRESHOLD = deps.RALLY_PLAYER_THRESHOLD;
  RALLY_INTERVAL_TURNS = deps.RALLY_INTERVAL_TURNS;
  RALLY_MAX_ENEMIES = deps.RALLY_MAX_ENEMIES;
  RALLY_STAT_SCALE_PER_PLAYER = deps.RALLY_STAT_SCALE_PER_PLAYER;
}

function countAlivePlayers(combat) {
  var count = 0;
  var iter = combat.units.values();
  var entry = iter.next();
  while (!entry.done) {
    if (entry.value.type === 'player' && entry.value.alive) count++;
    entry = iter.next();
  }
  return count;
}

function applyGroupScaling(combat) {
  var playerCount = countAlivePlayers(combat);
  var isOffline = process.env.OFFLINE_MODE === '1';

  if (playerCount === 1) {
    combat.groupScaling = { hpMult: SOLO_HP_SCALE, atkMult: SOLO_ATK_SCALE, tier: 'solo' };
  } else if (playerCount === 2) {
    combat.groupScaling = { hpMult: DUO_HP_SCALE, atkMult: DUO_ATK_SCALE, tier: 'duo' };
  } else if (playerCount === 3) {
    combat.groupScaling = { hpMult: TRIO_HP_SCALE, atkMult: TRIO_ATK_SCALE, tier: 'trio' };
  } else if (playerCount === 4) {
    combat.groupScaling = { hpMult: 1.0, atkMult: 1.0, tier: 'party' };
  } else {
    var extraPlayers = playerCount - 4;
    combat.groupScaling = {
      hpMult: 1 + extraPlayers * RALLY_STAT_SCALE_PER_PLAYER,
      atkMult: 1 + extraPlayers * RALLY_STAT_SCALE_PER_PLAYER,
      tier: 'rally',
    };
    combat.rallyScaling = {
      playerCount: playerCount,
      hpMult: combat.groupScaling.hpMult,
      atkMult: combat.groupScaling.atkMult,
      reinforceRate: Math.ceil(extraPlayers / 4),
      lastReinforceAt: 0,
    };
  }

  if (isOffline) {
    combat.groupScaling.hpMult *= OFFLINE_STAT_SCALE;
    combat.groupScaling.atkMult *= OFFLINE_STAT_SCALE;
    combat.groupScaling.offlineMode = true;
  }

  if (playerCount < RALLY_PLAYER_THRESHOLD) {
    combat.rallyScaling = null;
  }

  var eIter = combat.units.values();
  var eEntry = eIter.next();
  while (!eEntry.done) {
    var u = eEntry.value;
    if (u.type === 'enemy' && u.alive) {
      var baseHp = u._baseHp || u.maxHp;
      var baseAtk = (u.combat && u._baseAtk) ? u._baseAtk : ((u.combat && u.combat.atk) || 10);
      var baseWpn = u._baseWeaponDamage || ((u.combat && u.combat.weaponDamage) || 0);
      var scaledMaxHp = Math.ceil(baseHp * combat.groupScaling.hpMult);
      var hpRatio = u.maxHp > 0 ? (u.hp / u.maxHp) : 1;
      u.maxHp = scaledMaxHp;
      u.hp = Math.ceil(scaledMaxHp * hpRatio);
      if (u.combat) {
        u.combat.atk = Math.ceil(baseAtk * combat.groupScaling.atkMult);
        u.combat.weaponDamage = Math.ceil(baseWpn * combat.groupScaling.atkMult);
      }
    }
    eEntry = eIter.next();
  }
}

function applyRaidScaling(combat) {
  var playerCount = 0;
  var iter = combat.units.values();
  var entry = iter.next();
  while (!entry.done) {
    if (entry.value.type === 'player' && entry.value.alive) playerCount++;
    entry = iter.next();
  }

  if (playerCount < 8) return;

  var extraPlayers = playerCount - 8;
  var hpMult = 1 + extraPlayers * 0.08;
  var atkMult = 1 + extraPlayers * 0.05;

  var totalHpMult = (combat.groupScaling ? combat.groupScaling.hpMult : 1) * hpMult;
  var totalAtkMult = (combat.groupScaling ? combat.groupScaling.atkMult : 1) * atkMult;

  var eIter = combat.units.values();
  var eEntry = eIter.next();
  while (!eEntry.done) {
    var u = eEntry.value;
    if (u.type === 'enemy' && u.alive) {
      var baseHp = u._baseHp || u.maxHp;
      var baseAtk = u._baseAtk || ((u.combat && u.combat.atk) || 10);
      var scaledMaxHp = Math.ceil(baseHp * totalHpMult);
      var hpR = u.maxHp > 0 ? (u.hp / u.maxHp) : 1;
      u.maxHp = scaledMaxHp;
      u.hp = Math.ceil(scaledMaxHp * hpR);
      if (u.combat && u.combat.atk) {
        u.combat.atk = Math.ceil(baseAtk * totalAtkMult);
      }
    }
    eEntry = eIter.next();
  }

  combat.raidScaling = { playerCount: playerCount, hpMult: hpMult, atkMult: atkMult };
}

function checkReinforcements(combat) {
  if (!combat.rallyScaling) return;
  if (combat.turnNumber - combat.rallyScaling.lastReinforceAt < RALLY_INTERVAL_TURNS) return;

  var aliveEnemies = 0;
  var iter = combat.units.values();
  var entry = iter.next();
  while (!entry.done) {
    if (entry.value.type === 'enemy' && entry.value.alive) aliveEnemies++;
    entry = iter.next();
  }

  if (aliveEnemies >= RALLY_MAX_ENEMIES) return;

  combat.rallyScaling.lastReinforceAt = combat.turnNumber;
  var toSpawn = Math.min(combat.rallyScaling.reinforceRate, RALLY_MAX_ENEMIES - aliveEnemies);
  if (toSpawn <= 0) return;

  var floor = combat.floor;
  if (!floor || !floor.grid) return;

  var edgeTiles = [];
  var rW = floor.width || floor.grid[0].length;
  var rH = floor.height || floor.grid.length;
  for (var ey = 0; ey < rH; ey++) {
    for (var ex = 0; ex < rW; ex++) {
      if (ex > 2 && ex < rW - 3 && ey > 2 && ey < rH - 3) continue;
      if (floor.grid[ey] && floor.grid[ey][ex] !== undefined) {
        var tileVal = floor.grid[ey][ex];
        if (WALKABLE_TILES[tileVal]) {
          var occupied = false;
          var oIter = combat.units.values();
          var oEntry = oIter.next();
          while (!oEntry.done) {
            if (oEntry.value.alive && oEntry.value.x === ex && oEntry.value.y === ey) {
              occupied = true;
              break;
            }
            oEntry = oIter.next();
          }
          if (!occupied) edgeTiles.push({ x: ex, y: ey });
        }
      }
    }
  }

  if (edgeTiles.length === 0) return;

  var baseEnemies = combat.enemyTemplates || [];
  if (baseEnemies.length === 0) return;

  var newEnemies = [];
  var timestamp = Date.now();

  for (var si = 0; si < toSpawn; si++) {
    if (edgeTiles.length === 0) break;

    var tileIdx = Math.floor(Math.random() * edgeTiles.length);
    var spawnTile = edgeTiles.splice(tileIdx, 1)[0];

    var baseEnemy = baseEnemies[Math.floor(Math.random() * baseEnemies.length)];

    var rEId = 'rally_' + si + '_' + timestamp;
    var rESpeed = baseEnemy.speed || 8;
    var rEArchetype = baseEnemy.archetype || 'bruiser';
    var rArchData = dungeonAI.ARCHETYPES ? dungeonAI.ARCHETYPES[rEArchetype] : null;
    var rEMP = (rArchData && rArchData.speed) ? rArchData.speed + 1 : 2;

    var rBaseHp = baseEnemy.hp || baseEnemy.maxHp || 50;
    var rScaledHp = Math.ceil(rBaseHp * combat.rallyScaling.hpMult);
    var rBaseAtk = baseEnemy.atk || 10;
    var rScaledAtk = Math.ceil(rBaseAtk * combat.rallyScaling.atkMult);

    var rallyUnit = {
      id: rEId,
      type: 'enemy',
      socketId: null,
      name: baseEnemy.name || 'Reinforcement',
      x: spawnTile.x,
      y: spawnTile.y,
      ct: 0,
      speed: rESpeed,
      hp: rScaledHp,
      maxHp: rScaledHp,
      mp: rEMP,
      ap: 1,
      rp: 1,
      momentumShield: 0,
      statusEffects: [],
      combat: {
        atk: rScaledAtk,
        def: baseEnemy.def || 0,
        range: baseEnemy.range || 1,
        speed: rESpeed,
        weaponDamage: rScaledAtk,
      },
      level: baseEnemy.level || 1,
      archetype: rEArchetype,
      abilities: [],
      alive: true,
      autoDefend: false,
      isReinforcement: true,
    };

    combat.units.set(rEId, rallyUnit);
    newEnemies.push({
      id: rEId,
      name: rallyUnit.name,
      x: spawnTile.x,
      y: spawnTile.y,
      hp: rScaledHp,
      maxHp: rScaledHp,
      archetype: rEArchetype,
    });
  }

  if (newEnemies.length > 0 && combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_combat_reinforcements', {
      combatId: combat.id,
      turnNumber: combat.turnNumber,
      newEnemies: newEnemies,
      playerCount: combat.rallyScaling.playerCount,
    });
  }
}

module.exports = {
  init: init,
  countAlivePlayers: countAlivePlayers,
  applyGroupScaling: applyGroupScaling,
  applyRaidScaling: applyRaidScaling,
  checkReinforcements: checkReinforcements,
};
