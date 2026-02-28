// handlers/monsters.js
// Monster collection, roster management, evolution.
// Overworld monster spawning, combat, and despawning.

var worldgen = require('../worldgen');
var dungeonCombat = require('../dungeon-combat');
var dungeonData = require('../dungeon-data');
var rpgData = require('../rpg-data');
var masteryCore = require('../mastery/mastery-core');
var directorZone = require('../director/director-zone');
var corpseLoot = require('./corpse-loot');

// Biome ID to element mapping for overworld monster element assignment (Fix 2)
var BIOME_ELEMENT_MAP = {
  0: 'ice',         // WATER
  1: 'earth',       // DESERT
  2: 'earth',       // MOUNTAIN
  3: 'fire',        // SCORCHED_SANDS
  4: 'wind',        // STEPPES
  5: 'earth',       // FOREST
  6: null,          // PLAINS (neutral)
  7: 'poison',      // SWAMP
  8: 'holy',        // HOLY_DOMINION
  9: 'lightning',   // GNOMISH_ISLES
  10: 'lightning',  // MECHSPIRE
  11: 'lightning',  // CLOCKWORK_HARBOR
  12: 'dark',       // WASTES
  13: 'ice',        // BEACH
  14: 'ice',        // FROSTBOUND
  15: 'dark',       // SOUTHERN_WASTES
  16: 'arcane',     // ELVEN_SOUTH
};

// ---------------------------------------------------------------------------
// Overworld monster definitions — biome-appropriate creatures
// ---------------------------------------------------------------------------

var OVERWORLD_MONSTERS = [
  {
    id: 'forest_wolf',
    name: 'Forest Wolf',
    hp: 35, atk: 10, def: 4, xp: 15, goldDrop: 5,
    level: 1,
    biomes: [5, 16],  // FOREST, ELVEN_SOUTH
    possibleLoot: [
      { type: 'herbs', chance: 0.15, amount: 1 },
    ],
    evolvesTo: 'dire_wolf', evolveLevel: 8,
  },
  {
    id: 'mountain_goat',
    name: 'Mountain Goat',
    hp: 45, atk: 8, def: 8, xp: 18, goldDrop: 6,
    level: 2,
    biomes: [2],  // MOUNTAIN
    possibleLoot: [
      { type: 'stone', chance: 0.20, amount: 1 },
    ],
    evolvesTo: 'mountain_ram', evolveLevel: 10,
  },
  {
    id: 'desert_scorpion',
    name: 'Desert Scorpion',
    hp: 30, atk: 14, def: 5, xp: 20, goldDrop: 7,
    level: 3,
    biomes: [1, 3],  // DESERT, SCORCHED_SANDS
    possibleLoot: [
      { type: 'glass_sand', chance: 0.20, amount: 1 },
    ],
    evolvesTo: 'emperor_scorpion', evolveLevel: 12, evolveItem: 'mana_crystal',
  },
  {
    id: 'plains_boar',
    name: 'Plains Boar',
    hp: 50, atk: 9, def: 6, xp: 16, goldDrop: 5,
    level: 1,
    biomes: [6, 8],  // PLAINS, HOLY_DOMINION
    possibleLoot: [
      { type: 'wheat', chance: 0.15, amount: 1 },
    ],
    evolvesTo: 'war_boar', evolveLevel: 8,
  },
  {
    id: 'snow_bear',
    name: 'Snow Bear',
    hp: 80, atk: 18, def: 10, xp: 35, goldDrop: 12,
    level: 5,
    biomes: [14],  // FROSTBOUND
    possibleLoot: [
      { type: 'fish', chance: 0.20, amount: 1 },
    ],
    evolvesTo: 'frost_titan_bear', evolveLevel: 15, evolveItem: 'mana_crystal',
  },
  {
    id: 'swamp_lizard',
    name: 'Swamp Lizard',
    hp: 40, atk: 11, def: 5, xp: 18, goldDrop: 6,
    level: 2,
    biomes: [7],  // SWAMP
    possibleLoot: [
      { type: 'mushroom', chance: 0.20, amount: 1 },
      { type: 'herbs', chance: 0.10, amount: 1 },
    ],
    evolvesTo: 'marsh_drake', evolveLevel: 10,
  },
  {
    id: 'cave_bat',
    name: 'Cave Bat',
    hp: 20, atk: 7, def: 2, xp: 10, goldDrop: 3,
    level: 1,
    biomes: [2, 5, 7, 12],  // MOUNTAIN, FOREST, SWAMP, WASTES
    possibleLoot: [],
    evolvesTo: 'shadow_bat', evolveLevel: 6,
  },
  {
    id: 'shore_crab',
    name: 'Shore Crab',
    hp: 30, atk: 8, def: 10, xp: 14, goldDrop: 4,
    level: 1,
    biomes: [13],  // BEACH
    possibleLoot: [
      { type: 'shellfish', chance: 0.25, amount: 1 },
    ],
    evolvesTo: 'ironshell_crab', evolveLevel: 8,
  },
  {
    id: 'volcanic_imp',
    name: 'Volcanic Imp',
    hp: 28, atk: 15, def: 3, xp: 22, goldDrop: 8,
    level: 4,
    biomes: [3, 12],  // SCORCHED_SANDS, WASTES
    possibleLoot: [
      { type: 'iron_ore', chance: 0.10, amount: 1 },
    ],
  },
  {
    id: 'dark_sprite',
    name: 'Dark Sprite',
    hp: 22, atk: 12, def: 2, xp: 16, goldDrop: 6,
    level: 2,
    biomes: [5, 16, 7],  // FOREST, ELVEN_SOUTH, SWAMP
    possibleLoot: [
      { type: 'mana_crystal', chance: 0.05, amount: 1 },
      { type: 'herbs', chance: 0.15, amount: 1 },
    ],
  },
  {
    id: 'steppe_hawk',
    name: 'Steppe Hawk',
    hp: 25, atk: 13, def: 3, xp: 15, goldDrop: 5,
    level: 2,
    biomes: [4],  // STEPPES
    possibleLoot: [],
  },
  {
    id: 'sand_viper',
    name: 'Sand Viper',
    hp: 24, atk: 16, def: 3, xp: 20, goldDrop: 7,
    level: 3,
    biomes: [1, 3],  // DESERT, SCORCHED_SANDS
    possibleLoot: [
      { type: 'herbs', chance: 0.12, amount: 1 },
    ],
  },
  {
    id: 'frost_spider',
    name: 'Frost Spider',
    hp: 32, atk: 11, def: 5, xp: 18, goldDrop: 6,
    level: 3,
    biomes: [14, 2],  // FROSTBOUND, MOUNTAIN
    possibleLoot: [],
  },
  {
    id: 'clockwork_beetle',
    name: 'Clockwork Beetle',
    hp: 38, atk: 10, def: 12, xp: 22, goldDrop: 8,
    level: 3,
    biomes: [9, 10, 11],  // GNOMISH_ISLES, MECHSPIRE, CLOCKWORK_HARBOR
    possibleLoot: [
      { type: 'cogs', chance: 0.20, amount: 1 },
      { type: 'springs', chance: 0.10, amount: 1 },
    ],
  },
  {
    id: 'waste_crawler',
    name: 'Waste Crawler',
    hp: 60, atk: 14, def: 8, xp: 28, goldDrop: 10,
    level: 4,
    biomes: [12, 15],  // WASTES, SOUTHERN_WASTES
    possibleLoot: [
      { type: 'stone', chance: 0.15, amount: 1 },
    ],
  },

  {
    id: 'goblin_scout',
    name: 'Goblin Scout',
    hp: 25, atk: 11, def: 3, xp: 16, goldDrop: 6,
    level: 2,
    biomes: [12, 15, 5, 7],  // WASTES, SOUTHERN_WASTES, FOREST, SWAMP
    possibleLoot: [
      { type: 'herbs', chance: 0.10, amount: 1 },
    ],
  },
  {
    id: 'restless_undead',
    name: 'Restless Undead',
    hp: 32, atk: 10, def: 4, xp: 18, goldDrop: 5,
    level: 2,
    biomes: [12, 15, 8],  // WASTES, SOUTHERN_WASTES, HOLY_DOMINION
    possibleLoot: [
      { type: 'iron_ore', chance: 0.08, amount: 1 },
    ],
  },

  // ── Evolved Forms ──
  {
    id: 'dire_wolf', name: 'Dire Wolf',
    hp: 70, atk: 18, def: 8, xp: 30, goldDrop: 12,
    level: 8, biomes: [5, 16],
    possibleLoot: [{ type: 'herbs', chance: 0.20, amount: 2 }],
  },
  {
    id: 'mountain_ram', name: 'Mountain Ram',
    hp: 90, atk: 14, def: 16, xp: 35, goldDrop: 14,
    level: 10, biomes: [2],
    possibleLoot: [{ type: 'stone', chance: 0.25, amount: 2 }],
  },
  {
    id: 'emperor_scorpion', name: 'Emperor Scorpion',
    hp: 65, atk: 28, def: 10, xp: 45, goldDrop: 18,
    level: 12, biomes: [1, 3],
    possibleLoot: [{ type: 'glass_sand', chance: 0.25, amount: 2 }, { type: 'mana_crystal', chance: 0.08, amount: 1 }],
  },
  {
    id: 'war_boar', name: 'War Boar',
    hp: 100, atk: 16, def: 12, xp: 32, goldDrop: 12,
    level: 8, biomes: [6, 8],
    possibleLoot: [{ type: 'wheat', chance: 0.20, amount: 2 }],
  },
  {
    id: 'frost_titan_bear', name: 'Frost Titan Bear',
    hp: 160, atk: 32, def: 18, xp: 70, goldDrop: 30,
    level: 15, biomes: [14],
    possibleLoot: [{ type: 'fish', chance: 0.25, amount: 2 }, { type: 'mana_crystal', chance: 0.10, amount: 1 }],
  },
  {
    id: 'marsh_drake', name: 'Marsh Drake',
    hp: 85, atk: 20, def: 10, xp: 36, goldDrop: 14,
    level: 10, biomes: [7],
    possibleLoot: [{ type: 'mushroom', chance: 0.25, amount: 2 }, { type: 'herbs', chance: 0.15, amount: 2 }],
  },
  {
    id: 'shadow_bat', name: 'Shadow Bat',
    hp: 40, atk: 14, def: 4, xp: 20, goldDrop: 8,
    level: 6, biomes: [2, 5, 7, 12],
    possibleLoot: [{ type: 'dark_crystal', chance: 0.05, amount: 1 }],
  },
  {
    id: 'ironshell_crab', name: 'Ironshell Crab',
    hp: 60, atk: 14, def: 22, xp: 28, goldDrop: 10,
    level: 8, biomes: [13],
    possibleLoot: [{ type: 'shellfish', chance: 0.30, amount: 2 }, { type: 'iron_ore', chance: 0.10, amount: 1 }],
  },
];

// Build a lookup: biomeId -> array of monster definitions that spawn there
var BIOME_MONSTER_MAP = {};
for (var mi = 0; mi < OVERWORLD_MONSTERS.length; mi++) {
  var mdef = OVERWORLD_MONSTERS[mi];
  for (var bi = 0; bi < mdef.biomes.length; bi++) {
    var biomeId = mdef.biomes[bi];
    if (!BIOME_MONSTER_MAP[biomeId]) BIOME_MONSTER_MAP[biomeId] = [];
    BIOME_MONSTER_MAP[biomeId].push(mdef);
  }
}

// ---------------------------------------------------------------------------
// Spawn system constants
// ---------------------------------------------------------------------------

var SPAWN_INTERVAL_MS = 45000;       // Check spawns every 45 seconds
var PATROL_INTERVAL_MS = 2000;       // Monster movement tick every 2 seconds
var MAX_MONSTERS_PER_ZONE = 80;      // Global cap for overworld monsters
var MONSTERS_PER_PLAYER = 6;         // Target monsters spawned near each player
var SPAWN_RADIUS_PX = 400;           // Spawn within 400px of a player
var MIN_PLAYER_DISTANCE_PX = 100;    // Don't spawn within 100px of any player
var DESPAWN_TIME_MS = 5 * 60 * 1000; // 5 minutes without attack -> despawn
var ATTACK_RANGE_PX = 64;            // Max distance to attack a monster
var ATTACK_COOLDOWN_MS = 800;        // Per-player attack cooldown
var MONSTER_RETALIATION_DELAY_MS = 200; // Slight delay before monster hits back
var PATROL_WANDER_RADIUS = 200;      // Max wander distance from spawn point
var PATROL_SPEED_PX_S = 40;          // Pixels per second wander speed
var PATROL_IDLE_MIN_MS = 3000;       // Min idle pause between moves
var PATROL_IDLE_MAX_MS = 8000;       // Max idle pause between moves
var CHASE_RANGE_PX = 150;            // Detection range for chasing players
var CHASE_SPEED_PX_S = 60;           // Chase speed (faster than wander)
var CHASE_LEASH_PX = 350;            // Max distance from spawn before returning

// Time-of-day monster multipliers
function getTimeMultipliers() {
  var timeOfDay = (_state && _state.world && _state.world.timeOfDay) || 'day';
  var mults;
  switch (timeOfDay) {
    case 'night': mults = { spawnRate: 1.5, aggroRange: 1.5, statMult: 1.2 }; break;
    case 'dusk':  mults = { spawnRate: 1.2, aggroRange: 1.3, statMult: 1.1 }; break;
    case 'dawn':  mults = { spawnRate: 0.8, aggroRange: 1.0, statMult: 1.0 }; break;
    default:      mults = { spawnRate: 1.0, aggroRange: 1.0, statMult: 1.0 }; break;
  }
  // Weather modifiers
  var weather = (_state && _state.world && _state.world.weather) || 'clear';
  if (weather === 'storm') {
    mults.spawnRate *= 1.3;
    mults.aggroRange *= 0.8;
  } else if (weather === 'fog') {
    mults.spawnRate *= 1.1;
    mults.aggroRange *= 0.6;
  } else if (weather === 'rain') {
    mults.spawnRate *= 1.05;
    mults.aggroRange *= 0.9;
  } else if (weather === 'snow') {
    mults.spawnRate *= 0.9;
    mults.aggroRange *= 0.85;
  }
  return mults;
}

// Unique ID counter for spawned monsters (resets on server restart, that's fine)
var _nextMonsterId = 1;

function generateMonsterId() {
  return 'mob_' + (_nextMonsterId++);
}

// ---------------------------------------------------------------------------
// Biome-based monster selection for a world position
// ---------------------------------------------------------------------------

function selectMonsterForPosition(worldX, worldY) {
  var biome = worldgen.getBiomeAtPixel(worldX, worldY);
  var pool = BIOME_MONSTER_MAP[biome];
  if (!pool || pool.length === 0) {
    // Fallback: use plains_boar or cave_bat as generic monsters
    pool = BIOME_MONSTER_MAP[6]; // PLAINS
    if (!pool || pool.length === 0) return null;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------------------------
// Spawn a single monster instance from a definition
// ---------------------------------------------------------------------------

function spawnMonster(def, x, y) {
  var now = Date.now();
  var timeMult = getTimeMultipliers();
  var sm = timeMult.statMult;
  var scaledHp = Math.round(def.hp * sm);
  return {
    id: generateMonsterId(),
    type: def.id,
    name: def.name,
    x: Math.round(x),
    y: Math.round(y),
    hp: scaledHp,
    maxHp: scaledHp,
    atk: Math.round(def.atk * sm),
    def: Math.round(def.def * sm),
    xp: def.xp,
    goldDrop: def.goldDrop,
    level: def.level,
    possibleLoot: def.possibleLoot,
    alive: true,
    spawnTime: now,
    lastAttackedTime: 0,
    // Patrol state
    spawnX: Math.round(x),
    spawnY: Math.round(y),
    patrolMode: 'idle',   // idle | wander | chase | returning
    patrolTargetX: null,
    patrolTargetY: null,
    idleUntil: now + PATROL_IDLE_MIN_MS + Math.random() * (PATROL_IDLE_MAX_MS - PATROL_IDLE_MIN_MS),
    chaseTargetSid: null,
    inCombat: false,
  };
}

// ---------------------------------------------------------------------------
// Get client-safe monster data (strip server-only fields)
// ---------------------------------------------------------------------------

function monsterToClient(m) {
  return {
    id: m.id,
    type: m.type,
    name: m.name,
    x: m.x,
    y: m.y,
    hp: m.hp,
    maxHp: m.maxHp,
    level: m.level,
    patrolMode: m.patrolMode || 'idle',
  };
}

// ---------------------------------------------------------------------------
// Module-level references set during first init call
// ---------------------------------------------------------------------------

var _io = null;
var _state = null;
var _accounts = null;
var _socketAccountMap = null;
var _serverRules = null;
var _spawnTimerStarted = false;
var _attackCooldowns = new Map(); // socketId -> timestamp
var _overworldCombatPlayers = new Map(); // socketId -> { monsterId, zoneId, combatId }

// ---------------------------------------------------------------------------
// Spawn ticker — runs globally once, not per-socket
// ---------------------------------------------------------------------------

function startSpawnTicker() {
  if (_spawnTimerStarted) return;
  _spawnTimerStarted = true;

  setInterval(function() {
    try {
      runSpawnCycle();
      runDespawnCycle();
    } catch (err) {
      console.error('[monsters] Spawn tick error:', err.message);
    }
  }, SPAWN_INTERVAL_MS);

  // Patrol ticker — monster movement AI
  setInterval(function() {
    try {
      runPatrolCycle();
    } catch (err) {
      console.error('[monsters] Patrol tick error:', err.message);
    }
  }, PATROL_INTERVAL_MS);

  console.log('[monsters] Overworld spawn ticker started (' + SPAWN_INTERVAL_MS + 'ms interval)');
  console.log('[monsters] Patrol ticker started (' + PATROL_INTERVAL_MS + 'ms interval)');
}

function runSpawnCycle() {
  // Only spawn in chunk-based zones (overworld, hollow_earth)
  var zones = _state.zones;
  for (var entry of zones) {
    var zoneId = entry[0];
    var zone = entry[1];

    // Only chunk-based zones with players get monster spawns
    if (!zone.chunkCache) continue;
    if (zone.members.size === 0) continue;

    var monsterList = _state.zoneMonsters.get(zoneId);
    if (!monsterList) {
      monsterList = [];
      _state.zoneMonsters.set(zoneId, monsterList);
    }

    // Count alive monsters
    var aliveCount = 0;
    for (var ci = 0; ci < monsterList.length; ci++) {
      if (monsterList[ci].alive) aliveCount++;
    }

    // Don't exceed global cap
    if (aliveCount >= MAX_MONSTERS_PER_ZONE) continue;

    // Spawn monsters near each player, up to the per-player target
    var playerPositions = _state.playerPositions;
    var playerZones = _state.playerZones;

    // Collect all player positions in this zone
    var zonePlayers = [];
    for (var sid of zone.members) {
      var ppos = playerPositions.get(sid);
      if (ppos) zonePlayers.push({ sid: sid, x: ppos.x, y: ppos.y });
    }

    if (zonePlayers.length === 0) continue;

    // For each player, check how many monsters are already nearby
    for (var pi = 0; pi < zonePlayers.length; pi++) {
      var player = zonePlayers[pi];

      // Count monsters near this player
      var nearbyCount = 0;
      for (var mi2 = 0; mi2 < monsterList.length; mi2++) {
        var m = monsterList[mi2];
        if (!m.alive) continue;
        var mdx = m.x - player.x;
        var mdy = m.y - player.y;
        if (mdx * mdx + mdy * mdy < SPAWN_RADIUS_PX * SPAWN_RADIUS_PX * 4) {
          nearbyCount++;
        }
      }

      // Spawn up to target, but throttle to 2 per tick per player to avoid lag spikes
      // Time-of-day: increase effective target at night/dusk
      // Director zone spawn multiplier adjusts density based on zone stress
      var timeMults = getTimeMultipliers();
      var zoneSpawnMult = directorZone.getSpawnMultiplier(zoneId);
      var effectiveTarget = Math.round(MONSTERS_PER_PLAYER * timeMults.spawnRate * zoneSpawnMult);
      var toSpawn = Math.min(2, effectiveTarget - nearbyCount);
      if (toSpawn <= 0) continue;
      if (aliveCount >= MAX_MONSTERS_PER_ZONE) break;

      for (var si = 0; si < toSpawn; si++) {
        // Pick a random position within spawn radius of player
        var angle = Math.random() * Math.PI * 2;
        var dist = MIN_PLAYER_DISTANCE_PX + Math.random() * (SPAWN_RADIUS_PX - MIN_PLAYER_DISTANCE_PX);
        var sx = player.x + Math.cos(angle) * dist;
        var sy = player.y + Math.sin(angle) * dist;

        // Clamp to world bounds
        if (sx < 0) sx = 0;
        if (sy < 0) sy = 0;
        if (sx > zone.width) sx = zone.width;
        if (sy > zone.height) sy = zone.height;

        // Check spawn position is walkable
        if (worldgen.getBiomeAtPixel && worldgen.isWalkable) {
          if (!worldgen.isWalkable(sx, sy, null)) continue;
        }

        // Don't spawn too close to any player
        var tooClose = false;
        for (var pj = 0; pj < zonePlayers.length; pj++) {
          var ddx = sx - zonePlayers[pj].x;
          var ddy = sy - zonePlayers[pj].y;
          if (ddx * ddx + ddy * ddy < MIN_PLAYER_DISTANCE_PX * MIN_PLAYER_DISTANCE_PX) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        // Select monster type based on biome at spawn location
        var def = selectMonsterForPosition(sx, sy);
        if (!def) continue;

        var mob = spawnMonster(def, sx, sy);
        monsterList.push(mob);
        aliveCount++;

        // Broadcast spawn to zone
        _io.to('zone:' + zoneId).emit('zone_monster_spawned', monsterToClient(mob));

        if (aliveCount >= MAX_MONSTERS_PER_ZONE) break;
      }
    }

    // Spawn world containers near players (rare chance each cycle)
    var existingContainers = _state.zoneWorldContainers.get(zoneId);
    var containerCount = existingContainers ? existingContainers.length : 0;
    if (containerCount < 10 && Math.random() < 0.08) {
      // Pick a random player position and spawn near it
      var playerKeys = Array.from(zone.members);
      if (playerKeys.length > 0) {
        var randPid = playerKeys[Math.floor(Math.random() * playerKeys.length)];
        var pPos = _state.playerPositions.get(randPid);
        if (pPos) {
          var cx = pPos.x + (Math.random() - 0.5) * 400;
          var cy = pPos.y + (Math.random() - 0.5) * 400;
          corpseLoot.spawnWorldContainer(zoneId, cx, cy, 1);
        }
      }
    }
  }
}

function runDespawnCycle() {
  var now = Date.now();
  var zones = _state.zones;

  for (var entry of zones) {
    var zoneId = entry[0];
    var zone = entry[1];
    if (!zone.chunkCache) continue;

    var monsterList = _state.zoneMonsters.get(zoneId);
    if (!monsterList) continue;

    var removedIds = [];
    var kept = [];

    for (var i = 0; i < monsterList.length; i++) {
      var m = monsterList[i];

      // Remove dead monsters immediately
      if (!m.alive) {
        removedIds.push(m.id);
        continue;
      }

      // Despawn if alive for too long without being attacked
      var timeSinceAttack = m.lastAttackedTime > 0 ? (now - m.lastAttackedTime) : (now - m.spawnTime);
      if (timeSinceAttack >= DESPAWN_TIME_MS) {
        // Check if any player is nearby before despawning
        var hasNearbyPlayer = false;
        for (var sid of zone.members) {
          var ppos = _state.playerPositions.get(sid);
          if (ppos) {
            var ddx = ppos.x - m.x;
            var ddy = ppos.y - m.y;
            if (ddx * ddx + ddy * ddy < SPAWN_RADIUS_PX * SPAWN_RADIUS_PX) {
              hasNearbyPlayer = true;
              break;
            }
          }
        }

        if (!hasNearbyPlayer) {
          removedIds.push(m.id);
          continue;
        }
      }

      kept.push(m);
    }

    // Update the list if anything was removed
    if (removedIds.length > 0) {
      _state.zoneMonsters.set(zoneId, kept);
      // Broadcast despawns
      for (var ri = 0; ri < removedIds.length; ri++) {
        _io.to('zone:' + zoneId).emit('zone_monster_died', { id: removedIds[ri] });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-engage combat — called by patrol tick when monster catches a player
// Mirrors zone_combat_engage but runs outside a socket handler scope.
// ---------------------------------------------------------------------------

function _engageMonsterCombat(io, monster, playerSocketId, zoneId) {
  // Look up player socket
  var playerSocket = io.sockets.sockets.get(playerSocketId);
  if (!playerSocket) return;

  // Prevent double-engagement
  if (_overworldCombatPlayers.has(playerSocketId)) return;
  if (dungeonCombat.getCombatBySocketId(playerSocketId)) return;
  if (monster.inCombat || !monster.alive) return;

  var zone = _state.zones.get(zoneId);
  if (!zone || !zone.chunkCache) return;

  var pos = _state.playerPositions.get(playerSocketId);
  if (!pos) return;

  var accKey = _socketAccountMap.get(playerSocketId);
  if (!accKey) return;

  var acc = _accounts.loadAccount(accKey);
  if (!acc) return;

  // Biome from monster position
  var biomeId = 6;
  if (worldgen.getBiomeAtPixel) {
    biomeId = worldgen.getBiomeAtPixel(monster.x, monster.y);
    if (biomeId === null || biomeId === undefined) biomeId = 6;
  }

  var arena = dungeonData.generateOverworldArena(biomeId, monster.id);

  // Build player combat state
  var computed = rpgData.computeStats(acc.rpgStats || rpgData.getDefaultStats(), acc.level || 1, acc.race);

  var equippedCardObjects = [];
  if (acc.rpgCards && Array.isArray(acc.rpgCards) && acc.equippedCards && Array.isArray(acc.equippedCards)) {
    var _cardMap = {};
    for (var cm = 0; cm < acc.rpgCards.length; cm++) {
      if (acc.rpgCards[cm] && acc.rpgCards[cm].instanceId) {
        _cardMap[acc.rpgCards[cm].instanceId] = acc.rpgCards[cm];
      }
    }
    for (var ce = 0; ce < acc.equippedCards.length; ce++) {
      var _cid = acc.equippedCards[ce];
      if (_cid && _cardMap[_cid]) equippedCardObjects.push(_cardMap[_cid]);
    }
  }

  var bonusHp = 0, bonusCrit = 0, bonusDodge = 0, bonusMeleeDmg = 0, bonusMagicDmg = 0;
  var bonusDungeonDmg = 0, bonusBossDmg = 0, bonusDungeonDef = 0;
  for (var ci = 0; ci < equippedCardObjects.length; ci++) {
    var card = equippedCardObjects[ci];
    if (!card || !card.effects) continue;
    for (var ei = 0; ei < card.effects.length; ei++) {
      var eff = card.effects[ei];
      if (eff.type === 'hp_bonus') bonusHp += (eff.value || 0);
      if (eff.type === 'crit_bonus') bonusCrit += (eff.value || 0);
      if (eff.type === 'dodge_bonus') bonusDodge += (eff.value || 0);
      if (eff.type === 'melee_damage_bonus') {
        var val = (acc.race && eff.raceValue && acc.race === (card.raceBonus || '')) ? eff.raceValue : (eff.value || 0);
        bonusMeleeDmg += val;
      }
      if (eff.type === 'dungeon_damage_bonus') bonusDungeonDmg += (eff.value || 0);
      if (eff.type === 'boss_damage_bonus') bonusBossDmg += (eff.value || 0);
      if (eff.type === 'dungeon_def_bonus') bonusDungeonDef += (eff.value || 0);
      if (eff.type === 'stat_boost_all') bonusHp += (eff.value || 0) * 10;
    }
  }

  var maxHp = computed.hp + bonusHp;
  var handStats = _accounts.getEquippedHandStats ? _accounts.getEquippedHandStats(accKey) : { mainHand: null, offHand: null };
  var mh = handStats.mainHand;
  var oh = handStats.offHand;
  var weaponDamage = mh ? (mh.damage || 0) : 0;
  var weaponMagicDamage = mh ? (mh.magicDamage || 0) : 0;
  var weaponCategory = mh ? (mh.category || 'melee_blade') : 'melee_blade';
  var weaponRange = mh ? (mh.range || 1.5) : 1.5;
  var weaponSpeed = mh ? (mh.speed || 1.0) : 1.0;
  var blockChance = 0;
  var offHandDefense = 0;
  if (oh) {
    if (oh.slot === 'shield' || oh.defense) {
      blockChance = oh.blockChance || 0;
      offHandDefense = oh.defense || 0;
    }
  }
  var armorStats = _accounts.getEquippedArmorStats ? _accounts.getEquippedArmorStats(accKey) : { totalDefense: 0, totalMagicResist: 0, totalMagicDamage: 0, totalCritBonus: 0, totalSpeedMod: 0 };
  var armorTotal = armorStats.totalDefense + offHandDefense;

  var combatSkillBonuses = rpgData.getCombatSkillBonuses(acc.skills, weaponCategory);
  var combatMastery = masteryCore.getSkillMasteryBonuses(acc, weaponCategory);

  var armorType = 'none';
  if (acc.equipment && acc.equipment.chest && acc.mmoInventory && acc.mmoInventory.items) {
    var bodyItem = acc.mmoInventory.items.find(function(it) { return it.id === acc.equipment.chest; });
    if (bodyItem) {
      var bodyType = bodyItem.type || '';
      if (bodyType.indexOf('leather') >= 0) armorType = 'leather';
      else if (bodyType.indexOf('cloth') >= 0 || bodyType.indexOf('robe') >= 0) armorType = 'cloth';
      else if (bodyType.indexOf('mithril') >= 0 || bodyType.indexOf('plate') >= 0 || bodyType.indexOf('steel') >= 0 || bodyType.indexOf('iron') >= 0 || bodyType.indexOf('gold') >= 0 || bodyType.indexOf('silver') >= 0) armorType = 'plate';
      else if (bodyType.indexOf('bronze') >= 0 || bodyType.indexOf('copper') >= 0 || bodyType.indexOf('chain') >= 0 || bodyType.indexOf('mail') >= 0) armorType = 'chain';
    }
  }

  var combat = {
    hp: maxHp,
    maxHp: maxHp,
    mana: 50 + ((acc.rpgStats || {}).acumen || 5) * 5,
    maxMana: 50 + ((acc.rpgStats || {}).acumen || 5) * 5,
    critChance: computed.critChance + bonusCrit + (combatSkillBonuses.critBonus || 0) + armorStats.totalCritBonus + (combatMastery.crit_chance_pct || 0),
    dodgeChance: computed.dodgeChance + bonusDodge,
    meleeDmgMult: computed.meleeDamageMultiplier + bonusMeleeDmg + (combatSkillBonuses.damageBonus || 0) + (combatMastery.damage_pct || 0),
    magicDmgMult: computed.magicPowerMultiplier + bonusMagicDmg + (combatMastery.spell_damage_pct || 0),
    dungeonDmgBonus: bonusDungeonDmg,
    bossDmgBonus: bonusBossDmg,
    dungeonDefBonus: bonusDungeonDef,
    hpRegen: computed.hpRegen,
    baseArmor: computed.baseArmor + armorTotal,
    magicResist: (computed.magicResist || 0) + armorStats.totalMagicResist,
    armorType: armorType,
    weaponDamage: weaponDamage,
    weaponMagicDamage: weaponMagicDamage + armorStats.totalMagicDamage,
    weaponCategory: weaponCategory,
    weaponRange: weaponRange,
    weaponSpeed: weaponSpeed,
    blockChance: blockChance,
  };

  var players = [{
    socketId: playerSocketId,
    x: arena.entranceX,
    y: arena.entranceY,
    name: acc.username || 'Player',
    race: acc.race,
    rpgStats: acc.rpgStats || rpgData.getDefaultStats(),
    level: acc.level || 1,
    equippedCards: equippedCardObjects,
    combat: combat,
  }];

  var archetype = dungeonData.inferArchetype(monster);
  var enemyDefaults = dungeonData.ENEMY_DEFAULTS[archetype] || dungeonData.ENEMY_DEFAULTS.bruiser;
  var monsterElement = monster.element || (BIOME_ELEMENT_MAP[biomeId] || null);
  var enemies = [{
    id: monster.id,
    name: monster.name,
    hp: monster.hp,
    maxHp: monster.maxHp,
    atk: monster.atk,
    def: monster.def,
    speed: 8 + (monster.level || 1),
    xp: monster.xp,
    gold: monster.goldDrop,
    archetype: archetype,
    abilities: enemyDefaults.abilities || [],
    x: arena.enemyX,
    y: arena.enemyY,
    lootTable: monster.possibleLoot,
    element: monsterElement,
    alive: true,
  }];

  var arenaFloor = {
    grid: arena.grid,
    rooms: arena.rooms,
    width: arena.width,
    height: arena.height,
  };

  // Capture references for callbacks closure
  var capturedZoneId = zoneId;
  var capturedMonsterId = monster.id;
  var capturedMonster = monster;
  var capturedAccKey = accKey;
  var capturedSocketId = playerSocketId;
  var capturedArenaGrid = arena.grid;
  var capturedArenaTheme = arena.themeColors;

  var callbacks = {
    broadcastToFloor: function(event, eventData) {
      if (event === 'tc_combat_start') {
        var playerUnitId = 'player_' + capturedSocketId;
        var enriched = {};
        for (var k in eventData) { enriched[k] = eventData[k]; }
        enriched.myUnitId = playerUnitId;
        enriched.arenaGrid = capturedArenaGrid;
        enriched.arenaTheme = capturedArenaTheme;
        var targetSocket = io.sockets.sockets.get(capturedSocketId);
        if (targetSocket) targetSocket.emit(event, enriched);
      } else if (event === 'tc_combat_end') {
        var result = eventData.result;
        var targetSock = io.sockets.sockets.get(capturedSocketId);

        if (result === 'victory') {
          var xpRate = (_serverRules && _serverRules.xpRate) ? _serverRules.xpRate : undefined;
          var xpResult = _accounts.addSkillXp(capturedAccKey, 'melee', capturedMonster.xp, xpRate);

          // Monster XP: award XP to player's active monster
          try {
            var monAcc = _accounts.loadAccount(capturedAccKey);
            if (monAcc && monAcc.monsters && monAcc.activeParty && monAcc.activeParty.length > 0) {
              var activeMonId = monAcc.activeParty[0];
              var activeMon = monAcc.monsters.find(function(m) { return m.instanceId === activeMonId; });
              if (activeMon) {
                if (!activeMon.xp) activeMon.xp = 0;
                if (!activeMon.level) activeMon.level = 1;
                activeMon.xp += capturedMonster.xp;
                var monXpNeeded = Math.floor(50 * Math.pow(activeMon.level, 1.5));
                while (activeMon.xp >= monXpNeeded && activeMon.level < 100) {
                  activeMon.xp -= monXpNeeded;
                  activeMon.level++;
                  if (activeMon.baseHp) activeMon.baseHp = Math.round(activeMon.baseHp * 1.03);
                  if (activeMon.baseAtk) activeMon.baseAtk = Math.round(activeMon.baseAtk * 1.03);
                  if (activeMon.baseDef) activeMon.baseDef = Math.round(activeMon.baseDef * 1.03);
                  activeMon.maxHp = activeMon.baseHp;
                  activeMon.hp = activeMon.maxHp;
                  monXpNeeded = Math.floor(50 * Math.pow(activeMon.level, 1.5));
                }
                _accounts.saveAccount(monAcc);
              }
            }
          } catch (monXpErr) {
            console.error('[overworld_combat] Monster XP error:', monXpErr.message);
          }

          // Phantom Skill XP: skinning for beast-type, anatomy for all kills
          var _owBeastPattern = /wolf|bear|boar|spider|lizard|bat|crab|scorpion|viper|raptor|toad|beetle|hound|drake|serpent|worm|ape|bird|insect|crawler|goat|imp|hawk/i;
          if (capturedMonster.name && _owBeastPattern.test(capturedMonster.name)) {
            _accounts.addSkillXp(capturedAccKey, 'skinning', 10 + Math.floor(Math.random() * 11), xpRate);
          }
          _accounts.addSkillXp(capturedAccKey, 'anatomy', 3, xpRate);

          // Gold
          var goldAmount = capturedMonster.goldDrop;
          if (goldAmount > 0) _accounts.updateChips(capturedAccKey, goldAmount);

          // Loot
          var lootDropped = [];
          if (capturedMonster.possibleLoot && capturedMonster.possibleLoot.length > 0) {
            for (var li = 0; li < capturedMonster.possibleLoot.length; li++) {
              var loot = capturedMonster.possibleLoot[li];
              if (Math.random() < loot.chance) {
                var addResult = _accounts.addResource(capturedAccKey, loot.type, loot.amount);
                if (addResult) {
                  var itemName = loot.type.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
                  lootDropped.push({ type: loot.type, name: itemName, amount: loot.amount });
                }
              }
            }
          }

          // Remove monster from zone
          capturedMonster.alive = false;
          capturedMonster.hp = 0;
          capturedMonster.inCombat = false;
          var mList = _state.zoneMonsters.get(capturedZoneId);
          if (mList) {
            for (var ri = mList.length - 1; ri >= 0; ri--) {
              if (mList[ri].id === capturedMonsterId) { mList.splice(ri, 1); break; }
            }
          }
          io.to('zone:' + capturedZoneId).emit('zone_monster_died', { id: capturedMonsterId });

          if (targetSock) {
            targetSock.emit('zone_monster_killed', {
              id: capturedMonsterId,
              name: capturedMonster.name,
              xp: capturedMonster.xp,
              gold: goldAmount,
              loot: lootDropped,
              skillLevel: xpResult ? xpResult.level : 1,
              skillXp: xpResult ? xpResult.xp : 0,
              xpNeeded: xpResult ? xpResult.xpNeeded : 100,
              leveledUp: xpResult ? xpResult.leveledUp : false,
              overallLevel: xpResult ? xpResult.overallLevel : 1,
              overallLeveledUp: xpResult ? xpResult.overallLeveledUp : false,
              pendingPacks: xpResult ? xpResult.pendingPacks : 0,
            });
          }

          // Quest progress
          try {
            var qAcc = _accounts.loadAccount(capturedAccKey);
            if (qAcc && qAcc.questProgress && qAcc.questProgress.active) {
              var qChanged = false;
              for (var qi = 0; qi < qAcc.questProgress.active.length; qi++) {
                var quest = qAcc.questProgress.active[qi];
                var tmpl = rpgData.WORLD_QUEST_TEMPLATES ? rpgData.WORLD_QUEST_TEMPLATES.find(function(t) { return t.questId === quest.questId; }) : null;
                if (tmpl && tmpl.type === 'kill' && (tmpl.target.monster === capturedMonster.baseId || tmpl.target.monster === capturedMonster.templateId)) {
                  quest.progress = Math.min(quest.progress + 1, quest.targetCount);
                  qChanged = true;
                  if (targetSock) {
                    targetSock.emit('quest_progress', { questId: quest.questId, progress: quest.progress, targetCount: quest.targetCount, complete: quest.progress >= quest.targetCount });
                  }
                }
              }
              if (qChanged) _accounts.saveAccount(qAcc);
            }
          } catch (qErr) { /* non-fatal */ }

          // Durability
          try {
            var durAcc = _accounts.loadAccount(capturedAccKey);
            if (durAcc && durAcc.equipment) {
              var durCardEffects = _accounts.getEquippedCardEffects ? _accounts.getEquippedCardEffects(capturedAccKey) : [];
              var durWarnings = [];
              var owWepResults = _accounts.reduceWeaponDurability(durAcc, 0.01, durCardEffects);
              if (owWepResults) { for (var owwi = 0; owwi < owWepResults.length; owwi++) durWarnings.push(owWepResults[owwi]); }
              var owArmorResults = _accounts.reduceArmorDurability(durAcc, 0.005, durCardEffects);
              for (var owdi = 0; owdi < owArmorResults.length; owdi++) durWarnings.push(owArmorResults[owdi]);
              _accounts.saveAccount(durAcc);
              if (targetSock) {
                for (var dwi = 0; dwi < durWarnings.length; dwi++) {
                  if (durWarnings[dwi].broken) {
                    targetSock.emit('item_broken', { slot: durWarnings[dwi].slot, itemName: durWarnings[dwi].itemName });
                  } else if (durWarnings[dwi].lowDurability) {
                    targetSock.emit('durability_warning', { slot: durWarnings[dwi].slot, itemName: durWarnings[dwi].itemName, durability: durWarnings[dwi].durability, maxDurability: durWarnings[dwi].maxDurability });
                  }
                }
              }
            }
          } catch (owDurErr) {
            console.error('[overworld_combat] Durability error:', owDurErr.message);
          }
        } else {
          // Defeat: restore monster
          capturedMonster.hp = capturedMonster.maxHp;
          capturedMonster.inCombat = false;
        }

        _overworldCombatPlayers.delete(capturedSocketId);
        if (targetSock) targetSock.emit(event, eventData);
      } else {
        var sock = io.sockets.sockets.get(capturedSocketId);
        if (sock) sock.emit(event, eventData);
      }
    },

    emitToPlayer: function(socketId, event, eventData) {
      var targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) targetSocket.emit(event, eventData);
    },

    awardKillRewards: function() {
      // Handled in broadcastToFloor tc_combat_end
    },

    handleDeath: function() {
      // Handled in broadcastToFloor tc_combat_end defeat path
    },

    getPlayerInfo: function(socketId) {
      var pAccKey = _socketAccountMap.get(socketId);
      if (!pAccKey) return null;
      var pAcc = _accounts.loadAccount(pAccKey);
      if (!pAcc) return null;
      return {
        accKey: pAccKey,
        race: pAcc.race,
        rpgStats: pAcc.rpgStats || rpgData.getDefaultStats(),
        level: pAcc.level || 1,
        equippedCards: pAcc.equippedCards || [],
        name: pAcc.username || 'Player',
      };
    },
  };

  // Mark in-combat
  monster.inCombat = true;
  var overworldDungeonId = 'overworld_' + monster.id + '_' + Date.now();
  _overworldCombatPlayers.set(playerSocketId, {
    monsterId: monster.id,
    zoneId: zoneId,
    dungeonId: overworldDungeonId,
  });

  // Start combat
  dungeonCombat.initCombat(overworldDungeonId, players, enemies, arenaFloor, callbacks);
}

// ---------------------------------------------------------------------------
// Patrol AI — monster wandering, chasing, and leashing
// ---------------------------------------------------------------------------

function runPatrolCycle() {
  var now = Date.now();
  var zones = _state.zones;

  for (var entry of zones) {
    var zoneId = entry[0];
    var zone = entry[1];
    if (!zone.chunkCache) continue;
    if (zone.members.size === 0) continue;

    var monsterList = _state.zoneMonsters.get(zoneId);
    if (!monsterList || monsterList.length === 0) continue;

    // Collect player positions in this zone
    var zonePlayers = [];
    for (var sid of zone.members) {
      var ppos = _state.playerPositions.get(sid);
      if (ppos) zonePlayers.push({ sid: sid, x: ppos.x, y: ppos.y });
    }

    var positionUpdates = [];
    var stepPx = PATROL_SPEED_PX_S * (PATROL_INTERVAL_MS / 1000);
    var chaseStepPx = CHASE_SPEED_PX_S * (PATROL_INTERVAL_MS / 1000);

    for (var mi = 0; mi < monsterList.length; mi++) {
      var m = monsterList[mi];
      if (!m.alive || m.inCombat) continue;

      var moved = false;

      // --- Check for nearby players to chase ---
      if (m.patrolMode !== 'chase') {
        var closestPlayer = null;
        var _aggroMult = getTimeMultipliers().aggroRange;
        var _effectiveChaseRange = CHASE_RANGE_PX * _aggroMult;
        var closestDistSq = _effectiveChaseRange * _effectiveChaseRange;
        for (var pi = 0; pi < zonePlayers.length; pi++) {
          var p = zonePlayers[pi];
          // Don't chase players already in combat
          if (_overworldCombatPlayers.has(p.sid)) continue;
          var cdx = p.x - m.x;
          var cdy = p.y - m.y;
          var cdistSq = cdx * cdx + cdy * cdy;
          if (cdistSq < closestDistSq) {
            closestDistSq = cdistSq;
            closestPlayer = p;
          }
        }
        if (closestPlayer) {
          m.patrolMode = 'chase';
          m.chaseTargetSid = closestPlayer.sid;
          m.patrolTargetX = null;
          m.patrolTargetY = null;
        }
      }

      // --- State machine ---
      if (m.patrolMode === 'idle') {
        if (now >= m.idleUntil) {
          // Pick a random wander target near spawn
          var angle = Math.random() * Math.PI * 2;
          var dist = 30 + Math.random() * (PATROL_WANDER_RADIUS - 30);
          var wx = m.spawnX + Math.cos(angle) * dist;
          var wy = m.spawnY + Math.sin(angle) * dist;

          // Check walkability
          if (worldgen.isWalkable && !worldgen.isWalkable(wx, wy, null)) {
            // Try again next tick
            m.idleUntil = now + 1000;
          } else {
            m.patrolMode = 'wander';
            m.patrolTargetX = wx;
            m.patrolTargetY = wy;
          }
        }
      } else if (m.patrolMode === 'wander') {
        // Move toward wander target
        var wdx = m.patrolTargetX - m.x;
        var wdy = m.patrolTargetY - m.y;
        var wdist = Math.sqrt(wdx * wdx + wdy * wdy);

        if (wdist <= stepPx) {
          // Arrived at target
          m.x = Math.round(m.patrolTargetX);
          m.y = Math.round(m.patrolTargetY);
          m.patrolMode = 'idle';
          m.idleUntil = now + PATROL_IDLE_MIN_MS + Math.random() * (PATROL_IDLE_MAX_MS - PATROL_IDLE_MIN_MS);
          m.patrolTargetX = null;
          m.patrolTargetY = null;
          moved = true;
        } else {
          // Step toward target
          var wnx = wdx / wdist;
          var wny = wdy / wdist;
          var wnewX = Math.round(m.x + wnx * stepPx);
          var wnewY = Math.round(m.y + wny * stepPx);
          if (!worldgen.isWalkable || worldgen.isWalkable(wnewX, wnewY, null)) {
            m.x = wnewX;
            m.y = wnewY;
            moved = true;
          } else {
            // Blocked by terrain, pick new wander target
            m.patrolMode = 'idle';
            m.idleUntil = now + PATROL_IDLE_MIN_MS;
            m.patrolTargetX = null;
            m.patrolTargetY = null;
          }
        }
      } else if (m.patrolMode === 'chase') {
        // Find chase target position
        var targetPos = null;
        if (m.chaseTargetSid) {
          targetPos = _state.playerPositions.get(m.chaseTargetSid);
          // Also verify player is still in this zone
          var targetZone = _state.playerZones.get(m.chaseTargetSid);
          if (targetZone !== zoneId) targetPos = null;
          // Don't chase players already in combat
          if (_overworldCombatPlayers.has(m.chaseTargetSid)) targetPos = null;
        }

        if (!targetPos) {
          // Target lost, return to spawn
          m.patrolMode = 'returning';
          m.chaseTargetSid = null;
          m.patrolTargetX = m.spawnX;
          m.patrolTargetY = m.spawnY;
        } else {
          // Check leash distance from spawn
          var ldx = m.x - m.spawnX;
          var ldy = m.y - m.spawnY;
          if (ldx * ldx + ldy * ldy > CHASE_LEASH_PX * CHASE_LEASH_PX) {
            // Leashed, return to spawn
            m.patrolMode = 'returning';
            m.chaseTargetSid = null;
            m.patrolTargetX = m.spawnX;
            m.patrolTargetY = m.spawnY;
          } else {
            // Move toward player
            var chdx = targetPos.x - m.x;
            var chdy = targetPos.y - m.y;
            var chdist = Math.sqrt(chdx * chdx + chdy * chdy);

            if (chdist > CHASE_RANGE_PX * 2.5) {
              // Player ran far, give up
              m.patrolMode = 'returning';
              m.chaseTargetSid = null;
              m.patrolTargetX = m.spawnX;
              m.patrolTargetY = m.spawnY;
            } else if (chdist <= ATTACK_RANGE_PX && m.chaseTargetSid && !m.inCombat) {
              // Monster caught the player — auto-engage combat
              var engageTarget = m.chaseTargetSid;
              m.patrolMode = 'idle';
              m.chaseTargetSid = null;
              _engageMonsterCombat(_io, m, engageTarget, zoneId);
            } else if (chdist > 5) {
              var cnx = chdx / chdist;
              var cny = chdy / chdist;
              var cnewX = Math.round(m.x + cnx * chaseStepPx);
              var cnewY = Math.round(m.y + cny * chaseStepPx);
              if (!worldgen.isWalkable || worldgen.isWalkable(cnewX, cnewY, null)) {
                m.x = cnewX;
                m.y = cnewY;
                moved = true;
              } else {
                // Blocked by terrain, stop chasing
                m.patrolMode = 'returning';
                m.chaseTargetSid = null;
                m.patrolTargetX = m.spawnX;
                m.patrolTargetY = m.spawnY;
              }
            }
          }
        }
      } else if (m.patrolMode === 'returning') {
        // Move back toward spawn
        var rdx = m.patrolTargetX - m.x;
        var rdy = m.patrolTargetY - m.y;
        var rdist = Math.sqrt(rdx * rdx + rdy * rdy);

        if (rdist <= chaseStepPx) {
          m.x = Math.round(m.spawnX);
          m.y = Math.round(m.spawnY);
          m.patrolMode = 'idle';
          m.idleUntil = now + PATROL_IDLE_MIN_MS;
          m.patrolTargetX = null;
          m.patrolTargetY = null;
          moved = true;
        } else {
          var rnx = rdx / rdist;
          var rny = rdy / rdist;
          var rnewX = Math.round(m.x + rnx * chaseStepPx);
          var rnewY = Math.round(m.y + rny * chaseStepPx);
          if (!worldgen.isWalkable || worldgen.isWalkable(rnewX, rnewY, null)) {
            m.x = rnewX;
            m.y = rnewY;
            moved = true;
          } else {
            // Blocked returning, snap to spawn
            m.x = Math.round(m.spawnX);
            m.y = Math.round(m.spawnY);
            m.patrolMode = 'idle';
            m.idleUntil = now + PATROL_IDLE_MIN_MS;
            moved = true;
          }
        }
      }

      if (moved) {
        positionUpdates.push({ id: m.id, x: m.x, y: m.y, patrolMode: m.patrolMode });
      }
    }

    // Broadcast position updates for this zone
    if (positionUpdates.length > 0) {
      _io.to('zone:' + zoneId).emit('zone_monster_positions', { monsters: positionUpdates });
    }
  }
}

// ---------------------------------------------------------------------------
// Combat calculation helpers
// ---------------------------------------------------------------------------

function calculatePlayerDamage(acc) {
  var might = 5; // default
  if (acc.rpgStats && typeof acc.rpgStats.might === 'number') {
    might = acc.rpgStats.might;
  }
  // baseDamage = 5 + (might * 2)
  var baseDamage = 5 + (might * 2);
  return baseDamage;
}

function calculateMonsterDamage(monster, acc) {
  var playerDef = 0;
  if (acc.rpgStats && typeof acc.rpgStats.vigor === 'number') {
    // Armor-like reduction from vigor: each point gives ~0.5 def
    playerDef = Math.floor(acc.rpgStats.vigor * 0.5);
  }
  var damage = Math.max(1, monster.atk - playerDef);
  return damage;
}

// ---------------------------------------------------------------------------
// Handler module
// ---------------------------------------------------------------------------

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, checkEventRate, applyRateGrace, state } = deps;

    // Store module-level references for the spawn ticker (only set once)
    if (!_io) _io = io;
    if (!_state) _state = state;
    if (!_accounts) _accounts = accounts;
    if (!_socketAccountMap) _socketAccountMap = socketAccountMap;
    if (!_serverRules) _serverRules = (deps.serverRules) ? deps.serverRules : null;

    // Start the global spawn ticker on first handler init
    startSpawnTicker();

    // --- monster_list: get player's monster roster ---
    socket.on('monster_list', function() {

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      socket.emit('monster_roster', {
        monsters: acc.monsters || [],
        activeParty: acc.activeParty || [],
      });
    });

    // --- monster_set_active: set active party of up to 6 ---
    socket.on('monster_set_active', function(data) {
      if (!data || !Array.isArray(data.monsterIds)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      // Validate all IDs exist in roster and limit to 6
      var monsters = acc.monsters || [];
      var validIds = [];
      for (var i = 0; i < Math.min(data.monsterIds.length, 6); i++) {
        var id = data.monsterIds[i];
        var found = monsters.find(function(m) { return m.instanceId === id; });
        if (found) validIds.push(id);
      }

      if (validIds.length === 0) {
        socket.emit('monster_error', { message: 'No valid monsters selected' });
        return;
      }

      acc.activeParty = validIds;
      accounts.saveAccount(acc);

      socket.emit('monster_party_updated', {
        activeParty: validIds,
      });
    });

    // --- monster_evolve: evolve a monster if conditions met ---
    socket.on('monster_evolve', function(data) {
      if (!data || typeof data.monsterId !== 'string') return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      var monsters = acc.monsters || [];
      var monster = monsters.find(function(m) { return m.instanceId === data.monsterId; });
      if (!monster) {
        socket.emit('monster_error', { message: 'Monster not found' });
        return;
      }

      // Look up base definition for evolution data
      var baseDef = OVERWORLD_MONSTERS.find(function(m) { return m.id === monster.baseId; });
      if (!baseDef || !baseDef.evolvesTo) {
        socket.emit('monster_evolve_result', { monsterId: data.monsterId, success: false, message: 'This monster cannot evolve.' });
        return;
      }

      // Check level requirement
      if ((monster.level || 1) < baseDef.evolveLevel) {
        socket.emit('monster_evolve_result', { monsterId: data.monsterId, success: false,
          message: 'Requires level ' + baseDef.evolveLevel + ' (current: ' + (monster.level || 1) + ')' });
        return;
      }

      // Check item requirement
      if (baseDef.evolveItem) {
        var inv = acc.mmoInventory || {};
        if ((inv[baseDef.evolveItem] || 0) < 1) {
          var itemName = baseDef.evolveItem.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
          socket.emit('monster_evolve_result', { monsterId: data.monsterId, success: false,
            message: 'Requires 1 ' + itemName });
          return;
        }
        // Consume item
        accounts.addResource(key, baseDef.evolveItem, -1);
      }

      // Look up evolved form
      var evolvedDef = OVERWORLD_MONSTERS.find(function(m) { return m.id === baseDef.evolvesTo; });
      if (!evolvedDef) {
        socket.emit('monster_evolve_result', { monsterId: data.monsterId, success: false, message: 'Evolved form data not found.' });
        return;
      }

      // Transform monster
      var oldName = monster.name;
      monster.baseId = evolvedDef.id;
      monster.name = evolvedDef.name;
      // Scale stats: +20% on top of evolved base
      monster.baseHp = Math.round(evolvedDef.hp * 1.2);
      monster.baseAtk = Math.round(evolvedDef.atk * 1.2);
      monster.baseDef = Math.round(evolvedDef.def * 1.2);
      monster.hp = monster.baseHp;
      monster.maxHp = monster.baseHp;
      monster.evolved = true;

      accounts.saveAccount(acc);

      socket.emit('monster_evolve_result', {
        monsterId: data.monsterId,
        success: true,
        oldName: oldName,
        newName: evolvedDef.name,
        monster: {
          instanceId: monster.instanceId,
          baseId: monster.baseId,
          name: monster.name,
          level: monster.level,
          hp: monster.hp,
          maxHp: monster.maxHp,
          baseAtk: monster.baseAtk,
          baseDef: monster.baseDef,
          evolved: true,
        },
      });
    });

    // --- monster_capture: attempt to capture an overworld monster ---
    socket.on('monster_capture', function(data) {
      if (!data || typeof data.monsterId !== 'string') return;
      if (!applyRateGrace(socket, 'monster_capture', 10, 3000)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      // Check player has taming_net
      var inv = acc.mmoInventory || {};
      if ((inv['taming_net'] || 0) < 1) {
        socket.emit('monster_error', { message: 'You need a Taming Net to capture monsters.' });
        return;
      }

      // Find the monster in the player's zone
      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;
      var monsterList = state.zoneMonsters.get(zoneId);
      if (!monsterList) {
        socket.emit('monster_error', { message: 'No monsters nearby.' });
        return;
      }

      var monster = null;
      for (var i = 0; i < monsterList.length; i++) {
        if (monsterList[i].id === data.monsterId && monsterList[i].alive) {
          monster = monsterList[i];
          break;
        }
      }
      if (!monster) {
        socket.emit('monster_error', { message: 'Monster not found.' });
        return;
      }

      // Must be below 25% HP
      var hpRatio = monster.hp / monster.maxHp;
      if (hpRatio > 0.25) {
        socket.emit('monster_capture_result', { success: false, monsterId: data.monsterId,
          message: 'Monster is too healthy to capture. Weaken it below 25% HP first.' });
        return;
      }

      // Consume taming net
      accounts.addResource(key, 'taming_net', -1);

      // Capture chance: 30% base + level advantage bonus
      var playerLevel = acc.level || 1;
      var monsterLevel = monster.level || 1;
      var levelBonus = Math.max(0, (playerLevel - monsterLevel) * 0.03);
      var captureChance = Math.min(0.30 + levelBonus, 0.80); // cap at 80%

      if (Math.random() > captureChance) {
        socket.emit('monster_capture_result', { success: false, monsterId: data.monsterId,
          message: 'The monster broke free!' });
        return;
      }

      // Success! Add monster to player's roster
      if (!acc.monsters) acc.monsters = [];
      var baseDef = OVERWORLD_MONSTERS.find(function(m) { return m.id === monster.baseId || m.id === monster.templateId; });
      var instanceId = 'mon_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      acc.monsters.push({
        instanceId: instanceId,
        baseId: baseDef ? baseDef.id : (monster.baseId || monster.templateId || 'unknown'),
        name: monster.name,
        level: monster.level || 1,
        xp: 0,
        hp: baseDef ? baseDef.hp : monster.maxHp,
        maxHp: baseDef ? baseDef.hp : monster.maxHp,
        baseHp: baseDef ? baseDef.hp : monster.maxHp,
        baseAtk: baseDef ? baseDef.atk : (monster.atk || 5),
        baseDef: baseDef ? baseDef.def : (monster.def || 3),
        capturedAt: Date.now(),
      });
      accounts.saveAccount(acc);

      // Remove monster from zone
      monster.alive = false;
      monster.hp = 0;
      for (var ri = monsterList.length - 1; ri >= 0; ri--) {
        if (monsterList[ri].id === data.monsterId) {
          monsterList.splice(ri, 1);
          break;
        }
      }
      io.to('zone:' + zoneId).emit('zone_monster_died', { id: data.monsterId });

      socket.emit('monster_capture_result', {
        success: true,
        monsterId: data.monsterId,
        monster: {
          instanceId: instanceId,
          baseId: baseDef ? baseDef.id : 'unknown',
          name: monster.name,
          level: monster.level || 1,
        },
        message: 'Captured ' + monster.name + '!',
      });
    });

    // --- monster_rename: rename a monster ---
    socket.on('monster_rename', function(data) {
      if (!data || typeof data.monsterId !== 'string' || typeof data.name !== 'string') return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      var monsters = acc.monsters || [];
      var monster = monsters.find(function(m) { return m.instanceId === data.monsterId; });
      if (!monster) {
        socket.emit('monster_error', { message: 'Monster not found' });
        return;
      }

      var newName = data.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 20);
      if (newName.length === 0) {
        socket.emit('monster_error', { message: 'Invalid name' });
        return;
      }

      monster.nickname = newName;
      accounts.saveAccount(acc);

      socket.emit('monster_renamed', {
        monsterId: data.monsterId,
        name: newName,
      });
    });

    // =====================================================================
    // Overworld monster combat — FF-style instanced turn-based combat
    // =====================================================================

    // --- zone_combat_engage: initiate turn-based combat with an overworld monster ---
    socket.on('zone_combat_engage', function(data) {
      if (!data || typeof data.monsterId !== 'string') return;

      // Prevent double-engagement
      if (_overworldCombatPlayers.has(socket.id)) {
        socket.emit('zone_attack_error', { message: 'Already in combat' });
        return;
      }

      // Also check if already in dungeon-combat engine combat
      if (dungeonCombat.getCombatBySocketId(socket.id)) {
        socket.emit('zone_attack_error', { message: 'Already in combat' });
        return;
      }

      // Validate player is in a zone
      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;

      var zone = state.zones.get(zoneId);
      if (!zone || !zone.chunkCache) {
        socket.emit('zone_attack_error', { message: 'Cannot attack here' });
        return;
      }

      // Get player position
      var pos = state.playerPositions.get(socket.id);
      if (!pos) return;

      // Find the monster
      var monsterList = state.zoneMonsters.get(zoneId);
      if (!monsterList) return;

      var monster = null;
      for (var i = 0; i < monsterList.length; i++) {
        if (monsterList[i].id === data.monsterId && monsterList[i].alive && !monsterList[i].inCombat) {
          monster = monsterList[i];
          break;
        }
      }

      if (!monster) {
        socket.emit('zone_attack_error', { message: 'Monster not found or already in combat' });
        return;
      }

      // Range check
      var dx = pos.x - monster.x;
      var dy = pos.y - monster.y;
      var distSq = dx * dx + dy * dy;
      if (distSq > ATTACK_RANGE_PX * ATTACK_RANGE_PX) {
        socket.emit('zone_attack_error', { message: 'Too far away' });
        return;
      }

      // Load player account for stats
      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;

      var acc = accounts.loadAccount(accKey);
      if (!acc) return;

      // Determine biome from monster's world position
      var biomeId = 6; // default: PLAINS
      if (worldgen.getBiomeAtPixel) {
        biomeId = worldgen.getBiomeAtPixel(monster.x, monster.y);
        if (biomeId === null || biomeId === undefined) biomeId = 6;
      }

      // Generate arena
      var arena = dungeonData.generateOverworldArena(biomeId, monster.id);

      // Build player combat state (mirroring dungeon.js initPlayerCombatState)
      var computed = rpgData.computeStats(acc.rpgStats || rpgData.getDefaultStats(), acc.level || 1, acc.race);

      // Resolve equipped card IDs to full card objects
      var equippedCardObjects = [];
      if (acc.rpgCards && Array.isArray(acc.rpgCards) && acc.equippedCards && Array.isArray(acc.equippedCards)) {
        var _cardMap = {};
        for (var cm = 0; cm < acc.rpgCards.length; cm++) {
          if (acc.rpgCards[cm] && acc.rpgCards[cm].instanceId) {
            _cardMap[acc.rpgCards[cm].instanceId] = acc.rpgCards[cm];
          }
        }
        for (var ce = 0; ce < acc.equippedCards.length; ce++) {
          var _cid = acc.equippedCards[ce];
          if (_cid && _cardMap[_cid]) equippedCardObjects.push(_cardMap[_cid]);
        }
      }

      // Collect card bonuses
      var bonusHp = 0, bonusCrit = 0, bonusDodge = 0, bonusMeleeDmg = 0, bonusMagicDmg = 0;
      var bonusDungeonDmg = 0, bonusBossDmg = 0, bonusDungeonDef = 0;
      if (equippedCardObjects.length > 0) {
        for (var ci = 0; ci < equippedCardObjects.length; ci++) {
          var card = equippedCardObjects[ci];
          if (!card || !card.effects) continue;
          for (var ei = 0; ei < card.effects.length; ei++) {
            var eff = card.effects[ei];
            if (eff.type === 'hp_bonus') bonusHp += (eff.value || 0);
            if (eff.type === 'crit_bonus') bonusCrit += (eff.value || 0);
            if (eff.type === 'dodge_bonus') bonusDodge += (eff.value || 0);
            if (eff.type === 'melee_damage_bonus') {
              var val = (acc.race && eff.raceValue && acc.race === (card.raceBonus || '')) ? eff.raceValue : (eff.value || 0);
              bonusMeleeDmg += val;
            }
            if (eff.type === 'dungeon_damage_bonus') bonusDungeonDmg += (eff.value || 0);
            if (eff.type === 'boss_damage_bonus') bonusBossDmg += (eff.value || 0);
            if (eff.type === 'dungeon_def_bonus') bonusDungeonDef += (eff.value || 0);
            if (eff.type === 'stat_boost_all') bonusHp += (eff.value || 0) * 10;
          }
        }
      }

      var maxHp = computed.hp + bonusHp;
      // Use dual-hand stats
      var handStats = accounts.getEquippedHandStats ? accounts.getEquippedHandStats(accKey) : { mainHand: null, offHand: null };
      var mh = handStats.mainHand;
      var oh = handStats.offHand;
      var weaponDamage = mh ? (mh.damage || 0) : 0;
      var weaponMagicDamage = mh ? (mh.magicDamage || 0) : 0;
      var weaponCategory = mh ? (mh.category || 'melee_blade') : 'melee_blade';
      var weaponRange = mh ? (mh.range || 1.5) : 1.5;
      var weaponSpeed = mh ? (mh.speed || 1.0) : 1.0;
      var blockChance = 0;
      var offHandDefense = 0;
      if (oh) {
        if (oh.slot === 'shield' || oh.defense) {
          blockChance = oh.blockChance || 0;
          offHandDefense = oh.defense || 0;
        }
      }
      var armorStats = accounts.getEquippedArmorStats ? accounts.getEquippedArmorStats(accKey) : { totalDefense: 0, totalMagicResist: 0, totalMagicDamage: 0, totalCritBonus: 0, totalSpeedMod: 0 };
      var armorTotal = armorStats.totalDefense + offHandDefense;

      // Compute combat skill bonuses from weapon proficiency (Fix 4)
      var combatSkillBonuses = rpgData.getCombatSkillBonuses(acc.skills, weaponCategory);
      var combatMastery = masteryCore.getSkillMasteryBonuses(acc, weaponCategory);

      // Infer armor type from equipped chest armor (Fix 3)
      var armorType = 'none';
      if (acc.equipment && acc.equipment.chest && acc.mmoInventory && acc.mmoInventory.items) {
        var bodyItem = acc.mmoInventory.items.find(function(it) { return it.id === acc.equipment.chest; });
        if (bodyItem) {
          var bodyType = bodyItem.type || '';
          if (bodyType.indexOf('leather') >= 0) armorType = 'leather';
          else if (bodyType.indexOf('cloth') >= 0 || bodyType.indexOf('robe') >= 0) armorType = 'cloth';
          else if (bodyType.indexOf('mithril') >= 0 || bodyType.indexOf('plate') >= 0 || bodyType.indexOf('steel') >= 0 || bodyType.indexOf('iron') >= 0 || bodyType.indexOf('gold') >= 0 || bodyType.indexOf('silver') >= 0) armorType = 'plate';
          else if (bodyType.indexOf('bronze') >= 0 || bodyType.indexOf('copper') >= 0 || bodyType.indexOf('chain') >= 0 || bodyType.indexOf('mail') >= 0) armorType = 'chain';
        }
      }

      var combat = {
        hp: maxHp,
        maxHp: maxHp,
        mana: 50 + ((acc.rpgStats || {}).acumen || 5) * 5,
        maxMana: 50 + ((acc.rpgStats || {}).acumen || 5) * 5,
        critChance: computed.critChance + bonusCrit + (combatSkillBonuses.critBonus || 0) + armorStats.totalCritBonus + (combatMastery.crit_chance_pct || 0),
        dodgeChance: computed.dodgeChance + bonusDodge,
        meleeDmgMult: computed.meleeDamageMultiplier + bonusMeleeDmg + (combatSkillBonuses.damageBonus || 0) + (combatMastery.damage_pct || 0),
        magicDmgMult: computed.magicPowerMultiplier + bonusMagicDmg + (combatMastery.spell_damage_pct || 0),
        dungeonDmgBonus: bonusDungeonDmg,
        bossDmgBonus: bonusBossDmg,
        dungeonDefBonus: bonusDungeonDef,
        hpRegen: computed.hpRegen,
        baseArmor: computed.baseArmor + armorTotal,
        magicResist: (computed.magicResist || 0) + armorStats.totalMagicResist,
        armorType: armorType,
        weaponDamage: weaponDamage,
        weaponMagicDamage: weaponMagicDamage + armorStats.totalMagicDamage,
        weaponCategory: weaponCategory,
        weaponRange: weaponRange,
        weaponSpeed: weaponSpeed,
        blockChance: blockChance,
      };

      // Build player array for combat engine
      var players = [{
        socketId: socket.id,
        x: arena.entranceX,
        y: arena.entranceY,
        name: user.name || acc.username || 'Player',
        race: acc.race,
        rpgStats: acc.rpgStats || rpgData.getDefaultStats(),
        level: acc.level || 1,
        equippedCards: equippedCardObjects,
        combat: combat,
      }];

      // Convert overworld monster to dungeon-combat enemy format
      var archetype = dungeonData.inferArchetype(monster);
      var enemyDefaults = dungeonData.ENEMY_DEFAULTS[archetype] || dungeonData.ENEMY_DEFAULTS.bruiser;
      // Assign element from biome (Fix 2)
      var monsterElement = monster.element || (BIOME_ELEMENT_MAP[biomeId] || null);
      var enemies = [{
        id: monster.id,
        name: monster.name,
        hp: monster.hp,
        maxHp: monster.maxHp,
        atk: monster.atk,
        def: monster.def,
        speed: 8 + (monster.level || 1),
        xp: monster.xp,
        gold: monster.goldDrop,
        archetype: archetype,
        abilities: enemyDefaults.abilities || [],
        x: arena.enemyX,
        y: arena.enemyY,
        lootTable: monster.possibleLoot,
        element: monsterElement,
        alive: true,
      }];

      // Build arena floor object matching what dungeon-combat expects
      var arenaFloor = {
        grid: arena.grid,
        rooms: arena.rooms,
        width: arena.width,
        height: arena.height,
      };

      // Capture references for callbacks closure
      var capturedZoneId = zoneId;
      var capturedMonsterId = monster.id;
      var capturedMonster = monster;
      var capturedAccKey = accKey;
      var capturedSocketId = socket.id;
      var capturedArenaGrid = arena.grid;
      var capturedArenaTheme = arena.themeColors;

      // Build callbacks — 2-arg broadcastToFloor matching dungeon-combat.js actual call signature
      var callbacks = {
        broadcastToFloor: function(event, eventData) {
          if (event === 'tc_combat_start') {
            // Inject per-player myUnitId and arena data
            var playerUnitId = 'player_' + capturedSocketId;
            var enriched = {};
            for (var k in eventData) { enriched[k] = eventData[k]; }
            enriched.myUnitId = playerUnitId;
            enriched.arenaGrid = capturedArenaGrid;
            enriched.arenaTheme = capturedArenaTheme;
            var targetSocket = io.sockets.sockets.get(capturedSocketId);
            if (targetSocket) targetSocket.emit(event, enriched);
          } else if (event === 'tc_combat_end') {
            // Handle combat end: determine victory/defeat
            var result = eventData.result;
            var targetSock = io.sockets.sockets.get(capturedSocketId);

            if (result === 'victory') {
              // Award XP (melee skill)
              var xpRate = (_serverRules && _serverRules.xpRate) ? _serverRules.xpRate : undefined;
              var xpResult = accounts.addSkillXp(capturedAccKey, 'melee', capturedMonster.xp, xpRate);

              // Monster XP: award XP to player's active monster
              try {
                var monAcc = accounts.loadAccount(capturedAccKey);
                if (monAcc && monAcc.monsters && monAcc.activeParty && monAcc.activeParty.length > 0) {
                  var activeMonId = monAcc.activeParty[0]; // Lead monster gets XP
                  var activeMon = monAcc.monsters.find(function(m) { return m.instanceId === activeMonId; });
                  if (activeMon) {
                    if (!activeMon.xp) activeMon.xp = 0;
                    if (!activeMon.level) activeMon.level = 1;
                    activeMon.xp += capturedMonster.xp;
                    // Level up: xp threshold = 50 * level^1.5
                    var monXpNeeded = Math.floor(50 * Math.pow(activeMon.level, 1.5));
                    while (activeMon.xp >= monXpNeeded && activeMon.level < 100) {
                      activeMon.xp -= monXpNeeded;
                      activeMon.level++;
                      if (activeMon.baseHp) activeMon.baseHp = Math.round(activeMon.baseHp * 1.03);
                      if (activeMon.baseAtk) activeMon.baseAtk = Math.round(activeMon.baseAtk * 1.03);
                      if (activeMon.baseDef) activeMon.baseDef = Math.round(activeMon.baseDef * 1.03);
                      activeMon.maxHp = activeMon.baseHp;
                      activeMon.hp = activeMon.maxHp;
                      monXpNeeded = Math.floor(50 * Math.pow(activeMon.level, 1.5));
                    }
                    accounts.saveAccount(monAcc);
                  }
                }
              } catch (monXpErr) {
                console.error('[overworld_combat] Monster XP error:', monXpErr.message);
              }

              // Phantom Skill XP: Skinning for beast-type overworld kills (10-20 XP)
              var _owBeastPattern = /wolf|bear|boar|spider|lizard|bat|crab|scorpion|viper|raptor|toad|beetle|hound|drake|serpent|worm|ape|bird|insect|crawler|goat|imp|hawk/i;
              if (capturedMonster.name && _owBeastPattern.test(capturedMonster.name)) {
                accounts.addSkillXp(capturedAccKey, 'skinning', 10 + Math.floor(Math.random() * 11), xpRate);
              }
              // Phantom Skill XP: Anatomy on all overworld kills
              accounts.addSkillXp(capturedAccKey, 'anatomy', 3, xpRate);

              // Remove monster from zone and spawn lootable corpse
              capturedMonster.alive = false;
              capturedMonster.hp = 0;
              capturedMonster.inCombat = false;
              var mList = state.zoneMonsters.get(capturedZoneId);
              if (mList) {
                for (var ri = mList.length - 1; ri >= 0; ri--) {
                  if (mList[ri].id === capturedMonsterId) {
                    mList.splice(ri, 1);
                    break;
                  }
                }
              }

              // Broadcast death to zone
              io.to('zone:' + capturedZoneId).emit('zone_monster_died', { id: capturedMonsterId });

              // Spawn lootable corpse with procedural loot at death position
              var _corpse = corpseLoot.spawnCorpse(capturedZoneId, capturedMonster);

              // Send kill rewards to player (XP/skill only — gold/loot in corpse)
              if (targetSock) {
                targetSock.emit('zone_monster_killed', {
                  id: capturedMonsterId,
                  name: capturedMonster.name,
                  xp: capturedMonster.xp,
                  gold: 0,
                  loot: [],
                  corpseId: _corpse ? _corpse.id : null,
                  skillLevel: xpResult ? xpResult.level : 1,
                  skillXp: xpResult ? xpResult.xp : 0,
                  xpNeeded: xpResult ? xpResult.xpNeeded : 100,
                  leveledUp: xpResult ? xpResult.leveledUp : false,
                  overallLevel: xpResult ? xpResult.overallLevel : 1,
                  overallLeveledUp: xpResult ? xpResult.overallLeveledUp : false,
                  pendingPacks: xpResult ? xpResult.pendingPacks : 0,
                });
              }

              // --- Quest progress: kill-type quests ---
              try {
                var qAcc = accounts.loadAccount(capturedAccKey);
                if (qAcc && qAcc.questProgress && qAcc.questProgress.active) {
                  var rpgData = require('../rpg-data');
                  var qChanged = false;
                  for (var qi = 0; qi < qAcc.questProgress.active.length; qi++) {
                    var quest = qAcc.questProgress.active[qi];
                    var tmpl = rpgData.WORLD_QUEST_TEMPLATES ? rpgData.WORLD_QUEST_TEMPLATES.find(function(t) { return t.questId === quest.questId; }) : null;
                    if (tmpl && tmpl.type === 'kill' && (tmpl.target.monster === capturedMonster.baseId || tmpl.target.monster === capturedMonster.templateId)) {
                      quest.progress = Math.min(quest.progress + 1, quest.targetCount);
                      qChanged = true;
                      if (targetSock) {
                        targetSock.emit('quest_progress', { questId: quest.questId, progress: quest.progress, targetCount: quest.targetCount, complete: quest.progress >= quest.targetCount });
                      }
                    }
                  }
                  if (qChanged) accounts.saveAccount(qAcc);
                }
              } catch (qErr) { /* quest progress error is non-fatal */ }

              // --- Durability loss: weapon 1% per kill, armor 0.5% per hit taken ---
              try {
                var durAcc = accounts.loadAccount(capturedAccKey);
                if (durAcc && durAcc.equipment) {
                  var durCardEffects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(capturedAccKey) : [];
                  var durWarnings = [];
                  var owWepResults = accounts.reduceWeaponDurability(durAcc, 0.01, durCardEffects);
                  if (owWepResults) { for (var owwi = 0; owwi < owWepResults.length; owwi++) durWarnings.push(owWepResults[owwi]); }
                  var owArmorResults = accounts.reduceArmorDurability(durAcc, 0.005, durCardEffects);
                  for (var owdi = 0; owdi < owArmorResults.length; owdi++) durWarnings.push(owArmorResults[owdi]);
                  accounts.saveAccount(durAcc);
                  if (targetSock) {
                    for (var owwi = 0; owwi < durWarnings.length; owwi++) {
                      if (durWarnings[owwi].broken) {
                        targetSock.emit('item_broken', { slot: durWarnings[owwi].slot, itemName: durWarnings[owwi].itemName });
                      } else if (durWarnings[owwi].lowDurability) {
                        targetSock.emit('durability_warning', { slot: durWarnings[owwi].slot, itemName: durWarnings[owwi].itemName, durability: durWarnings[owwi].durability, maxDurability: durWarnings[owwi].maxDurability });
                      }
                    }
                  }
                }
              } catch (owDurErr) {
                console.error('[overworld_combat] Durability error:', owDurErr.message);
              }
            } else {
              // Defeat: restore monster to full HP
              capturedMonster.hp = capturedMonster.maxHp;
              capturedMonster.inCombat = false;
            }

            // Release player from combat tracking
            _overworldCombatPlayers.delete(capturedSocketId);

            // Forward the combat end event to the player
            if (targetSock) targetSock.emit(event, eventData);
          } else {
            // All other combat events: emit to participant socket
            var sock = io.sockets.sockets.get(capturedSocketId);
            if (sock) sock.emit(event, eventData);
          }
        },

        emitToPlayer: function(socketId, event, eventData) {
          var targetSocket = io.sockets.sockets.get(socketId);
          if (targetSocket) targetSocket.emit(event, eventData);
        },

        awardKillRewards: function(enemyUnit) {
          // Rewards are handled in the broadcastToFloor tc_combat_end callback
          // This is called per-enemy by dungeon-combat.js during victory
        },

        handleDeath: function(socketId) {
          // Player died in combat — full cleanup handled by tc_combat_end defeat path
          // No separate emit needed; tc_combat_end broadcasts defeat result
        },

        getPlayerInfo: function(socketId) {
          var pAccKey = socketAccountMap.get(socketId);
          if (!pAccKey) return null;
          var pAcc = accounts.loadAccount(pAccKey);
          if (!pAcc) return null;
          return {
            accKey: pAccKey,
            race: pAcc.race,
            rpgStats: pAcc.rpgStats || rpgData.getDefaultStats(),
            level: pAcc.level || 1,
            equippedCards: pAcc.equippedCards || [],
            name: pAcc.username || 'Player',
          };
        },
      };

      // Mark monster as in-combat to prevent double-engagement
      monster.inCombat = true;

      // Track combat participant
      var overworldDungeonId = 'overworld_' + monster.id + '_' + Date.now();
      _overworldCombatPlayers.set(socket.id, {
        monsterId: monster.id,
        zoneId: zoneId,
        dungeonId: overworldDungeonId,
      });

      // Start combat via the dungeon combat engine
      dungeonCombat.initCombat(overworldDungeonId, players, enemies, arenaFloor, callbacks);
    });

    // --- Send current zone monsters when player enters a zone ---
    // Listen for zone_enter indirectly: when player joins a zone, they receive zone_state.
    // We hook into the zone_enter flow by watching for playerZones changes.
    // Instead, we send monsters after zone_state is sent. We do this by listening
    // for the socket joining a room and then responding.
    // The cleanest approach: client requests monsters after zone_enter.
    socket.on('zone_monsters_request', function() {

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;

      var zone = state.zones.get(zoneId);
      if (!zone || !zone.chunkCache) {
        // Non-overworld zones have no wild monsters
        socket.emit('zone_monsters', { monsters: [] });
        return;
      }

      var monsterList = state.zoneMonsters.get(zoneId);
      if (!monsterList || monsterList.length === 0) {
        socket.emit('zone_monsters', { monsters: [] });
        return;
      }

      // Filter to alive monsters near the player (within view distance)
      var pos = state.playerPositions.get(socket.id);
      var clientMonsters = [];
      var VIEW_DIST_SQ = 1200 * 1200; // send monsters within ~1200px

      for (var i = 0; i < monsterList.length; i++) {
        var m = monsterList[i];
        if (!m.alive) continue;
        if (pos) {
          var mdx = m.x - pos.x;
          var mdy = m.y - pos.y;
          if (mdx * mdx + mdy * mdy > VIEW_DIST_SQ) continue;
        }
        clientMonsters.push(monsterToClient(m));
      }

      socket.emit('zone_monsters', { monsters: clientMonsters });
    });

    // --- Periodic monster position sync for nearby monsters ---
    // Client can request monsters near their current position
    socket.on('zone_monsters_nearby', function() {

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;

      var zone = state.zones.get(zoneId);
      if (!zone || !zone.chunkCache) return;

      var monsterList = state.zoneMonsters.get(zoneId);
      if (!monsterList) return;

      var pos = state.playerPositions.get(socket.id);
      if (!pos) return;

      var clientMonsters = [];
      var NEARBY_SQ = 800 * 800;

      for (var i = 0; i < monsterList.length; i++) {
        var m = monsterList[i];
        if (!m.alive) continue;
        var mdx = m.x - pos.x;
        var mdy = m.y - pos.y;
        if (mdx * mdx + mdy * mdy <= NEARBY_SQ) {
          clientMonsters.push(monsterToClient(m));
        }
      }

      socket.emit('zone_monsters', { monsters: clientMonsters });
    });

    // --- Clean up attack cooldowns and combat tracking on disconnect ---
    socket.on('disconnect', function() {
      _attackCooldowns.delete(socket.id);

      // Notify combat engine so autoDefend is enabled for faster resolution
      if (_overworldCombatPlayers.has(socket.id)) {
        var owCombat = dungeonCombat.getCombatBySocketId(socket.id);
        if (owCombat) {
          dungeonCombat.handlePlayerDisconnect(owCombat.id, socket.id);
        }
      }
      _overworldCombatPlayers.delete(socket.id);
    });
  },

  // Check if a player is currently in overworld combat
  isInOverworldCombat: function(socketId) {
    return _overworldCombatPlayers.has(socketId);
  },

  // Expose for external use (e.g., from zone.js zone_enter hook)
  getZoneMonsters: function(zoneId) {
    if (!_state) return [];
    var monsterList = _state.zoneMonsters.get(zoneId);
    if (!monsterList) return [];
    var result = [];
    for (var i = 0; i < monsterList.length; i++) {
      if (monsterList[i].alive) result.push(monsterToClient(monsterList[i]));
    }
    return result;
  },

  // Expose monster definitions for other systems
  OVERWORLD_MONSTERS: OVERWORLD_MONSTERS,
};
