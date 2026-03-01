// director/director-raid.js
// Raid boss floor management.
// Gates dungeon progression at milestone depths (floor 50, 100, ...)
// with massive bosses requiring 8-16 players to cooperate.

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var MIN_RAID_PLAYERS     = 8;
var MAX_RAID_PLAYERS     = 16;
var RAID_FLOOR_INTERVAL  = 50;    // Every 50th floor is a raid floor
var RAID_ENRAGE_TIMER_S  = 120;   // 120 seconds DPS check
var RAID_BOSS_HP_MULT    = 10;    // 10x normal HP
var RAID_BOSS_ATK_MULT   = 3;     // 3x normal ATK

// Raid mechanics pool
var RAID_MECHANICS = [
  {
    id: 'pressure_plates',
    name: 'Pressure Plates',
    description: '3 players must stand on marked tiles simultaneously!',
    requiredPlayers: 3,
  },
  {
    id: 'shield_break',
    name: 'Shield Break',
    description: 'Destroy the barrier pillars to remove the boss shield!',
  },
  {
    id: 'enrage_timer',
    name: 'Enrage',
    description: 'The boss grows enraged! Defeat it before time runs out!',
    timerSeconds: RAID_ENRAGE_TIMER_S,
  },
];

// ---------------------------------------------------------------------------
// Per-raid state
// ---------------------------------------------------------------------------

/** @type {Map<string, object>} zoneId -> raid state */
var raidStates = new Map();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a floor number is a raid floor.
 * Only applies to Rift dungeon floors.
 */
function isRaidFloor(floorNum, dungeonType) {
  if (dungeonType !== 'rift') return false;
  return floorNum > 0 && floorNum % RAID_FLOOR_INTERVAL === 0;
}

/**
 * Generate a raid boss for a given floor.
 * Uses floor number as a scaling factor.
 */
function generateRaidBoss(floorNum, seed) {
  var bossIndex = Math.floor(floorNum / RAID_FLOOR_INTERVAL) - 1;
  var scaleFactor = 1 + (floorNum / 50) * 0.5;

  // Raid boss templates
  var BOSS_TEMPLATES = [
    { name: 'Rift Colossus',      baseHp: 5000, baseAtk: 45, phases: 3, mechanic: 'pressure_plates' },
    { name: 'The Devourer',       baseHp: 6000, baseAtk: 40, phases: 4, mechanic: 'shield_break' },
    { name: 'Abyssal Warden',     baseHp: 4500, baseAtk: 50, phases: 3, mechanic: 'enrage_timer' },
    { name: 'Chronos the Undying', baseHp: 7000, baseAtk: 35, phases: 5, mechanic: 'pressure_plates' },
    { name: 'Void Sovereign',     baseHp: 8000, baseAtk: 55, phases: 4, mechanic: 'shield_break' },
  ];

  var template = BOSS_TEMPLATES[bossIndex % BOSS_TEMPLATES.length];
  var hp = Math.floor(template.baseHp * RAID_BOSS_HP_MULT * scaleFactor);
  var atk = Math.floor(template.baseAtk * RAID_BOSS_ATK_MULT * scaleFactor);

  // Generate phases
  var phases = [];
  for (var p = 0; p < template.phases; p++) {
    var phaseHpThreshold = 1 - ((p + 1) / template.phases);
    phases.push({
      phase: p + 1,
      hpThreshold: phaseHpThreshold,
      atkMultiplier: 1 + (p * 0.2),
      description: 'Phase ' + (p + 1) + ' — ' + (p === template.phases - 1 ? 'Final Stand!' : 'Growing stronger...'),
    });
  }

  // Get mechanic
  var mechanic = null;
  for (var mi = 0; mi < RAID_MECHANICS.length; mi++) {
    if (RAID_MECHANICS[mi].id === template.mechanic) {
      mechanic = Object.assign({}, RAID_MECHANICS[mi]);
      break;
    }
  }

  return {
    name: template.name,
    hp: hp,
    maxHp: hp,
    atk: atk,
    def: Math.floor(atk * 0.3),
    isBoss: true,
    isRaidBoss: true,
    phases: phases,
    currentPhase: 0,
    mechanic: mechanic,
    invincible: true, // Until barrier drops
    floorNum: floorNum,
    abilities: [
      { name: 'Crushing Blow', damage: Math.floor(atk * 1.5), cooldown: 3, range: 2 },
      { name: 'Ground Slam', damage: Math.floor(atk * 0.8), cooldown: 5, range: 4, aoe: true },
      { name: 'Void Breath', damage: Math.floor(atk * 2.0), cooldown: 8, range: 3 },
    ],
  };
}

/**
 * Initialize raid state for a floor.
 */
function initRaidState(zoneId, floorNum) {
  if (raidStates.has(zoneId)) return raidStates.get(zoneId);

  var boss = generateRaidBoss(floorNum);

  var rs = {
    state: 'waiting',        // waiting, active, completed
    playerCount: 0,
    minPlayers: MIN_RAID_PLAYERS,
    maxPlayers: MAX_RAID_PLAYERS,
    boss: boss,
    bossName: boss.name,
    barrierActive: true,
    wipeCount: 0,
    mechanics: boss.mechanic,
    floorNum: floorNum,
    players: new Set(),
    startedAt: null,
  };
  raidStates.set(zoneId, rs);
  return rs;
}

/**
 * Player joined a raid floor.
 */
function playerJoinedRaidFloor(zoneId, socketId, io) {
  var rs = raidStates.get(zoneId);
  if (!rs) return;
  if (rs.state === 'completed') return;

  rs.players.add(socketId);
  rs.playerCount = rs.players.size;

  // Broadcast updated state
  if (io) {
    io.to('zone:' + zoneId).emit('raid_state_update', {
      state: rs.state,
      playerCount: rs.playerCount,
      minPlayers: rs.minPlayers,
      bossName: rs.bossName,
      barrierActive: rs.barrierActive,
    });
  }

  // Check if barrier should drop
  if (rs.playerCount >= rs.minPlayers && rs.barrierActive) {
    dropBarrier(zoneId, io);
  }
}

/**
 * Player left a raid floor.
 */
function playerLeftRaidFloor(zoneId, socketId, io) {
  var rs = raidStates.get(zoneId);
  if (!rs) return;

  rs.players.delete(socketId);
  rs.playerCount = rs.players.size;

  // Broadcast updated state
  if (io) {
    io.to('zone:' + zoneId).emit('raid_state_update', {
      state: rs.state,
      playerCount: rs.playerCount,
      minPlayers: rs.minPlayers,
      bossName: rs.bossName,
      barrierActive: rs.barrierActive,
    });
  }
}

/**
 * Drop the raid barrier and start the encounter.
 */
function dropBarrier(zoneId, io) {
  var rs = raidStates.get(zoneId);
  if (!rs) return;

  rs.barrierActive = false;
  rs.state = 'active';
  rs.startedAt = Date.now();
  rs.boss.invincible = false;

  if (io) {
    io.to('zone:' + zoneId).emit('raid_boss_ready', {
      bossName: rs.bossName,
      floorNum: rs.floorNum,
    });
  }

  console.log('[raid] Barrier dropped on ' + zoneId + ' — ' + rs.playerCount + ' players vs ' + rs.bossName);
}

/**
 * Handle a raid wipe (all players dead or boss resets).
 */
function handleRaidWipe(zoneId, io) {
  var rs = raidStates.get(zoneId);
  if (!rs) return;

  rs.wipeCount++;
  rs.state = 'waiting';
  rs.barrierActive = true;
  rs.boss.invincible = true;

  // Reset boss to current phase HP (not full HP) — compute phase from actual HP at wipe
  var hpPct = rs.boss.hp / rs.boss.maxHp;
  var effectivePhase = 0;
  for (var pi = 0; pi < rs.boss.phases.length; pi++) {
    if (hpPct <= rs.boss.phases[pi].hpThreshold) {
      effectivePhase = pi + 1;
      break;
    }
  }
  if (effectivePhase > 0 && rs.boss.phases[effectivePhase - 1]) {
    rs.boss.hp = Math.floor(rs.boss.maxHp * rs.boss.phases[effectivePhase - 1].hpThreshold);
  } else {
    rs.boss.hp = rs.boss.maxHp;
  }
  rs.boss.currentPhase = effectivePhase;

  if (io) {
    io.to('zone:' + zoneId).emit('raid_boss_wipe', {
      wipeCount: rs.wipeCount,
      bossHpPercent: Math.round((rs.boss.hp / rs.boss.maxHp) * 100),
    });

    io.to('zone:' + zoneId).emit('raid_state_update', {
      state: rs.state,
      playerCount: rs.playerCount,
      minPlayers: rs.minPlayers,
      bossName: rs.bossName,
      barrierActive: rs.barrierActive,
    });
  }

  console.log('[raid] Wipe #' + rs.wipeCount + ' on ' + zoneId);
}

/**
 * Get raid state for a floor.
 */
function getRaidState(zoneId) {
  return raidStates.get(zoneId) || null;
}

/**
 * Clean up raid state for a floor.
 */
function cleanupRaid(zoneId) {
  raidStates.delete(zoneId);
}

/**
 * Broadcast raid boss HP update (called from combat tick).
 */
function broadcastBossHp(zoneId, io, hp, maxHp, name, phase) {
  if (!io) return;
  io.to('zone:' + zoneId).emit('raid_boss_hp', {
    hp: hp,
    maxHp: maxHp,
    name: name,
    phase: phase,
  });
}

/**
 * Broadcast a raid mechanic activation.
 */
function broadcastMechanic(zoneId, io, mechanic, tiles) {
  if (!io) return;
  io.to('zone:' + zoneId).emit('raid_boss_mechanic', {
    mechanicId: mechanic.id,
    name: mechanic.name,
    description: mechanic.description,
    tiles: tiles || [],
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  isRaidFloor: isRaidFloor,
  generateRaidBoss: generateRaidBoss,
  initRaidState: initRaidState,
  playerJoinedRaidFloor: playerJoinedRaidFloor,
  playerLeftRaidFloor: playerLeftRaidFloor,
  handleRaidWipe: handleRaidWipe,
  getRaidState: getRaidState,
  cleanupRaid: cleanupRaid,
  broadcastBossHp: broadcastBossHp,
  broadcastMechanic: broadcastMechanic,
  MIN_RAID_PLAYERS: MIN_RAID_PLAYERS,
  MAX_RAID_PLAYERS: MAX_RAID_PLAYERS,
  RAID_FLOOR_INTERVAL: RAID_FLOOR_INTERVAL,
};
