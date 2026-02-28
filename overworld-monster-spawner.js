// overworld-monster-spawner.js
// Overworld monster data, biome selection, spawning, despawning, and client serialization.

var worldgen = require('./worldgen');
var directorZone = require('./director/director-zone');

var _io = null;
var _state = null;
var _corpseLoot = null;

function init(deps) {
  if (deps.io) _io = deps.io;
  if (deps.state) _state = deps.state;
  if (deps.corpseLoot) _corpseLoot = deps.corpseLoot;
}

// Biome ID to element mapping for overworld monster element assignment
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

var SPAWN_INTERVAL_MS = 45000;
var MAX_MONSTERS_PER_ZONE = 80;
var MONSTERS_PER_PLAYER = 6;
var SPAWN_RADIUS_PX = 400;
var MIN_PLAYER_DISTANCE_PX = 100;
var DESPAWN_TIME_MS = 5 * 60 * 1000;
var ATTACK_RANGE_PX = 64;

// Unique ID counter for spawned monsters (resets on server restart, that's fine)
var _nextMonsterId = 1;

function generateMonsterId() {
  return 'mob_' + (_nextMonsterId++);
}

// ---------------------------------------------------------------------------
// Time-of-day monster multipliers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Biome-based monster selection for a world position
// ---------------------------------------------------------------------------

function selectMonsterForPosition(worldX, worldY) {
  var biome = worldgen.getBiomeAtPixel(worldX, worldY);
  var pool = BIOME_MONSTER_MAP[biome];
  if (!pool || pool.length === 0) {
    pool = BIOME_MONSTER_MAP[6]; // PLAINS fallback
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
    spawnX: Math.round(x),
    spawnY: Math.round(y),
    patrolMode: 'idle',
    patrolTargetX: null,
    patrolTargetY: null,
    idleUntil: now + 3000 + Math.random() * 5000,
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
// Spawn cycle — spawns monsters near players in chunk-based zones
// ---------------------------------------------------------------------------

function runSpawnCycle() {
  var zones = _state.zones;
  for (var entry of zones) {
    var zoneId = entry[0];
    var zone = entry[1];

    if (!zone.chunkCache) continue;
    if (zone.members.size === 0) continue;

    var monsterList = _state.zoneMonsters.get(zoneId);
    if (!monsterList) {
      monsterList = [];
      _state.zoneMonsters.set(zoneId, monsterList);
    }

    var aliveCount = 0;
    for (var ci = 0; ci < monsterList.length; ci++) {
      if (monsterList[ci].alive) aliveCount++;
    }

    if (aliveCount >= MAX_MONSTERS_PER_ZONE) continue;

    var playerPositions = _state.playerPositions;

    var zonePlayers = [];
    for (var sid of zone.members) {
      var ppos = playerPositions.get(sid);
      if (ppos) zonePlayers.push({ sid: sid, x: ppos.x, y: ppos.y });
    }

    if (zonePlayers.length === 0) continue;

    for (var pi = 0; pi < zonePlayers.length; pi++) {
      var player = zonePlayers[pi];

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

      var timeMults = getTimeMultipliers();
      var zoneSpawnMult = directorZone.getSpawnMultiplier(zoneId);
      var effectiveTarget = Math.round(MONSTERS_PER_PLAYER * timeMults.spawnRate * zoneSpawnMult);
      var toSpawn = Math.min(2, effectiveTarget - nearbyCount);
      if (toSpawn <= 0) continue;
      if (aliveCount >= MAX_MONSTERS_PER_ZONE) break;

      for (var si = 0; si < toSpawn; si++) {
        var angle = Math.random() * Math.PI * 2;
        var dist = MIN_PLAYER_DISTANCE_PX + Math.random() * (SPAWN_RADIUS_PX - MIN_PLAYER_DISTANCE_PX);
        var sx = player.x + Math.cos(angle) * dist;
        var sy = player.y + Math.sin(angle) * dist;

        if (sx < 0) sx = 0;
        if (sy < 0) sy = 0;
        if (sx > zone.width) sx = zone.width;
        if (sy > zone.height) sy = zone.height;

        if (worldgen.getBiomeAtPixel && worldgen.isWalkable) {
          if (!worldgen.isWalkable(sx, sy, null)) continue;
        }

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

        var def = selectMonsterForPosition(sx, sy);
        if (!def) continue;

        var mob = spawnMonster(def, sx, sy);
        monsterList.push(mob);
        aliveCount++;

        _io.to('zone:' + zoneId).emit('zone_monster_spawned', monsterToClient(mob));

        if (aliveCount >= MAX_MONSTERS_PER_ZONE) break;
      }
    }

    // Spawn world containers near players (rare chance each cycle)
    var existingContainers = _state.zoneWorldContainers.get(zoneId);
    var containerCount = existingContainers ? existingContainers.length : 0;
    if (containerCount < 10 && Math.random() < 0.08) {
      var playerKeys = Array.from(zone.members);
      if (playerKeys.length > 0) {
        var randPid = playerKeys[Math.floor(Math.random() * playerKeys.length)];
        var pPos = _state.playerPositions.get(randPid);
        if (pPos) {
          var cx = pPos.x + (Math.random() - 0.5) * 400;
          var cy = pPos.y + (Math.random() - 0.5) * 400;
          _corpseLoot.spawnWorldContainer(zoneId, cx, cy, 1);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Despawn cycle — removes dead or stale monsters from zones
// ---------------------------------------------------------------------------

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

      if (!m.alive) {
        removedIds.push(m.id);
        continue;
      }

      var timeSinceAttack = m.lastAttackedTime > 0 ? (now - m.lastAttackedTime) : (now - m.spawnTime);
      if (timeSinceAttack >= DESPAWN_TIME_MS) {
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

    if (removedIds.length > 0) {
      _state.zoneMonsters.set(zoneId, kept);
      for (var ri = 0; ri < removedIds.length; ri++) {
        _io.to('zone:' + zoneId).emit('zone_monster_died', { id: removedIds[ri] });
      }
    }
  }
}

module.exports = {
  init: init,
  BIOME_ELEMENT_MAP: BIOME_ELEMENT_MAP,
  OVERWORLD_MONSTERS: OVERWORLD_MONSTERS,
  SPAWN_INTERVAL_MS: SPAWN_INTERVAL_MS,
  ATTACK_RANGE_PX: ATTACK_RANGE_PX,
  getTimeMultipliers: getTimeMultipliers,
  selectMonsterForPosition: selectMonsterForPosition,
  spawnMonster: spawnMonster,
  monsterToClient: monsterToClient,
  runSpawnCycle: runSpawnCycle,
  runDespawnCycle: runDespawnCycle,
};
