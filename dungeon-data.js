// dungeon-data.js
// Dungeon generation data and algorithms for rift dungeons and biome caves.
// BSP room placement, enemy pools, loot tables, quest templates, guild ranks.
// Deterministic generation using seeded RNG from worldgen.js.

var worldgen = require('./worldgen');
var seededRandom = worldgen.seededRandom;
var chunkSeed = worldgen.chunkSeed;

var dungeonAnimal = require('./dungeon-animal');
var dungeonProgression = require('./dungeon-progression');
var dungeonThemes = require('./dungeon-themes');

// Destructure animal morphing exports
var FORM_INTERACTABLES = dungeonAnimal.FORM_INTERACTABLES;
var FORM_INTERACTABLE_KEYS = dungeonAnimal.FORM_INTERACTABLE_KEYS;
var THEME_FORM_INTERACTABLE_WEIGHTS = dungeonAnimal.THEME_FORM_INTERACTABLE_WEIGHTS;
var selectFormInteractable = dungeonAnimal.selectFormInteractable;
var generateFormInteractables = dungeonAnimal.generateFormInteractables;
var DUNGEON_ANIMALS = dungeonAnimal.DUNGEON_ANIMALS;
var ANIMAL_SPEAK_CATEGORIES = dungeonAnimal.ANIMAL_SPEAK_CATEGORIES;
var ANIMAL_DIALOGUES = dungeonAnimal.ANIMAL_DIALOGUES;
var ANIMAL_DIALOGUE_DEFAULT = dungeonAnimal.ANIMAL_DIALOGUE_DEFAULT;
var getAnimalDialogue = dungeonAnimal.getAnimalDialogue;
var generateAnimalNpcs = dungeonAnimal.generateAnimalNpcs;

// Destructure progression exports
var GUILD_RANKS = dungeonProgression.GUILD_RANKS;
var QUEST_TEMPLATES = dungeonProgression.QUEST_TEMPLATES;
var CAMP_CONFIG = dungeonProgression.CAMP_CONFIG;
var DUNGEON_SKILL_PERKS = dungeonProgression.DUNGEON_SKILL_PERKS;
var getDungeonSkillBonuses = dungeonProgression.getDungeonSkillBonuses;
var generateDailyQuests = dungeonProgression.generateDailyQuests;

// Destructure theme exports
var CASTLE_THEMES = dungeonThemes.CASTLE_THEMES;
var WILD_THEMES = dungeonThemes.WILD_THEMES;
var BIOME_DUNGEON_THEMES = dungeonThemes.BIOME_DUNGEON_THEMES;
var THEME_COLORS = dungeonThemes.THEME_COLORS;
var THEME_ELEMENT_MAP = dungeonThemes.THEME_ELEMENT_MAP;
var THEME_COMBAT_PROPERTIES = dungeonThemes.THEME_COMBAT_PROPERTIES;
var THEME_LAYOUT_MAP = dungeonThemes.THEME_LAYOUT_MAP;
var selectLayout = dungeonThemes.selectLayout;
var THEME_POOL_FALLBACK = dungeonThemes.THEME_POOL_FALLBACK;
var getEnemyPool = dungeonThemes.getEnemyPool;
var THEME_BONUS_LOOT = dungeonThemes.THEME_BONUS_LOOT;

var dungeonEnemyTypes = require('./dungeon-enemy-types');
var BOSS_MECHANICS = dungeonEnemyTypes.BOSS_MECHANICS;
var CLASS_TEMPLATES = dungeonEnemyTypes.CLASS_TEMPLATES;
var CLASS_TEMPLATE_KEYS = dungeonEnemyTypes.CLASS_TEMPLATE_KEYS;
var BOSS_MECHANIC_MAP = dungeonEnemyTypes.BOSS_MECHANIC_MAP;
var ENEMY_RANKS = dungeonEnemyTypes.ENEMY_RANKS;
var promoteEnemy = dungeonEnemyTypes.promoteEnemy;

var dungeonLootTables = require('./dungeon-loot-tables');
var CHEST_LOOT = dungeonLootTables.CHEST_LOOT;
var ENEMY_LOOT = dungeonLootTables.ENEMY_LOOT;
var rollEnemyLoot = dungeonLootTables.rollEnemyLoot;
var getTrapDamage = dungeonLootTables.getTrapDamage;

var dungeonFloorHazards = require('./dungeon-floor-hazards');
var TRAP_TYPES = dungeonFloorHazards.TRAP_TYPES;
var TRAP_TYPE_KEYS = dungeonFloorHazards.TRAP_TYPE_KEYS;
var SPECIAL_EVENTS = dungeonFloorHazards.SPECIAL_EVENTS;
var FLOOR_MODIFIERS = dungeonFloorHazards.FLOOR_MODIFIERS;
var selectFloorModifier = dungeonFloorHazards.selectFloorModifier;

// ---------------------------------------------------------------------------
// Seed prefixes & cache limits
// ---------------------------------------------------------------------------

var RIFT_SEED_PREFIX = 'rift:';
var CAVE_SEED_PREFIX = 'cave:';
var WORLD_DUNGEON_SEED_PREFIX = 'world:';
var STRUCTURE_SEED_PREFIX = 'struct:';
var MINI_RIFT_SEED_PREFIX = 'minirift:';
var MAX_FLOOR_CACHE = 64;
var TILE_SIZE = 32;

// ---------------------------------------------------------------------------
// Floor size tables
// ---------------------------------------------------------------------------

var RIFT_FLOOR_SIZE = {
  small:  { width: 40, height: 30, minRooms: 4,  maxRooms: 6  },
  medium: { width: 56, height: 42, minRooms: 6,  maxRooms: 10 },
  large:  { width: 72, height: 54, minRooms: 10, maxRooms: 14 },
  huge:   { width: 96, height: 72, minRooms: 14, maxRooms: 20 },
};

var CAVE_FLOOR_SIZE = {
  small:  { width: 36, height: 28, minRooms: 3,  maxRooms: 5  },
  medium: { width: 48, height: 36, minRooms: 5,  maxRooms: 8  },
  large:  { width: 64, height: 48, minRooms: 8,  maxRooms: 12 },
};

// Raid floor size — large arena for 8-16 player encounters
var RAID_FLOOR_SIZE = { width: 120, height: 90, minRooms: 4, maxRooms: 6 };

// ---------------------------------------------------------------------------
// Cave floors by biome (min/max floor count for biome caves)
// ---------------------------------------------------------------------------

var CAVE_FLOORS_BY_BIOME = {
  0:  { min: 2, max: 4  },   // WATER - underwater grottoes
  1:  { min: 3, max: 6  },   // DESERT - sand tombs
  2:  { min: 5, max: 10 },   // MOUNTAIN - deep mines
  3:  { min: 3, max: 5  },   // SCORCHED_SANDS - lava tubes
  4:  { min: 2, max: 5  },   // STEPPES - burial mounds
  5:  { min: 3, max: 7  },   // FOREST - root caverns
  6:  { min: 2, max: 4  },   // PLAINS - shallow caves
  7:  { min: 4, max: 8  },   // SWAMP - flooded ruins
  8:  { min: 3, max: 6  },   // HOLY_DOMINION - catacombs
  9:  { min: 2, max: 5  },   // GNOMISH_ISLES - tinker tunnels
  10: { min: 3, max: 6  },   // MECHSPIRE - clockwork depths
  11: { min: 2, max: 4  },   // CLOCKWORK_HARBOR - harbor vaults
};

// ---------------------------------------------------------------------------
// Tile types
// ---------------------------------------------------------------------------

var TILE = {
  WALL:        0,
  FLOOR:       1,
  CORRIDOR:    2,
  DOOR:        3,
  STAIRS_UP:   4,
  STAIRS_DOWN: 5,
  ENTRANCE:    6,
  EXIT:        7,
  CHEST:       8,
  TRAP:        9,
  CAMP_SPOT:   10,
  SHRINE:      11,
  BOSS_DOOR:   12,
  SHORTCUT:    13,
  CORPSE:      14,
};

// Bind TILE constant into dungeon-animal so its generators can check floor tiles
dungeonAnimal.init(TILE);

// ---------------------------------------------------------------------------
// Enemy archetype defaults — abilities, detection radii per archetype
// ---------------------------------------------------------------------------

var ENEMY_DEFAULTS = {
  bruiser:    { detectionRadius: 4, abilities: [{ id: 'heavy_strike', name: 'Heavy Strike', damage: 1.5, range: 1, windUp: 2, cooldown: 4, weight: 10 }] },
  skirmisher: { detectionRadius: 5, abilities: [{ id: 'quick_slash', name: 'Quick Slash', damage: 1.0, range: 1, windUp: 1, cooldown: 2, weight: 10 }] },
  ranged:     { detectionRadius: 6, abilities: [{ id: 'ranged_shot', name: 'Ranged Shot', damage: 1.2, range: 4, windUp: 2, cooldown: 3, weight: 10 }] },
  controller: { detectionRadius: 5, abilities: [{ id: 'debuff_strike', name: 'Cursed Touch', damage: 0.8, range: 2, windUp: 2, cooldown: 5, weight: 10, effect: 'slow', effectChance: 0.4 }] },
  support:    { detectionRadius: 5, abilities: [{ id: 'ally_heal', name: 'Mend', heals: true, healAmount: 15, range: 3, windUp: 2, cooldown: 6, weight: 15 }, { id: 'support_strike', name: 'Strike', damage: 0.7, range: 1, windUp: 1, cooldown: 3, weight: 5 }] },
  elite:      { detectionRadius: 6, abilities: [{ id: 'heavy_strike', name: 'Heavy Strike', damage: 1.5, range: 1, windUp: 2, cooldown: 4, weight: 10 }, { id: 'power_slam', name: 'Power Slam', damage: 2.0, range: 1, windUp: 3, cooldown: 6, weight: 8, effect: 'stun', effectChance: 0.3 }] },
};

// ---------------------------------------------------------------------------
// Difficulty Tiers — player-selectable difficulty for dungeon runs
// Each tier scales enemy stats, spawn rates, and rewards.
// ---------------------------------------------------------------------------

var DIFFICULTY_TIERS = {
  standard: { id: 'standard', name: 'Standard',   hpMult: 1.0,  atkMult: 1.0,  defMult: 1.0,  eliteChance: 0.05,  rareChance: 0.02,  championChance: 0.005, xpMult: 1.0,  goldMult: 1.0,  lootBonus: 0.0  },
  veteran:  { id: 'veteran',  name: 'Veteran',     hpMult: 1.3,  atkMult: 1.2,  defMult: 1.15, eliteChance: 0.10,  rareChance: 0.04,  championChance: 0.01,  xpMult: 1.3,  goldMult: 1.25, lootBonus: 0.10 },
  elite:    { id: 'elite',    name: 'Elite',        hpMult: 1.7,  atkMult: 1.4,  defMult: 1.3,  eliteChance: 0.15,  rareChance: 0.08,  championChance: 0.02,  xpMult: 1.6,  goldMult: 1.5,  lootBonus: 0.20 },
  mythic:   { id: 'mythic',   name: 'Mythic',       hpMult: 2.2,  atkMult: 1.7,  defMult: 1.5,  eliteChance: 0.25,  rareChance: 0.12,  championChance: 0.05,  xpMult: 2.0,  goldMult: 2.0,  lootBonus: 0.35 },
};

// ---------------------------------------------------------------------------
// Archetype inference from enemy template name/stats
// ---------------------------------------------------------------------------

// Name-pattern to archetype mapping. Order matters: first match wins.
var _ARCHETYPE_NAME_PATTERNS = [
  // Skirmisher: fast, fragile creatures
  { pattern: /rat|bat|imp|wolf|hound|wasp|spider|fish|eel|beetle|toad|crawler|slug|spirit|scarab|roach|maggot|viper|snake|asp|pup|raptor|insect|vulture|brood|parasite|jelly|spawn|piranha|familiar|kobold|scout|whelp|drone|sprocket/i, archetype: 'skirmisher' },
  // Ranged: stays at distance
  { pattern: /archer|wisp|banshee|phoenix|spitter|overcharge/i, archetype: 'ranged' },
  // Controller: debuffs and magic
  { pattern: /mage|crystallomancer|lich|shade|shaman|demon|fiend|necro|priest|sorcerer|weaver|warper|succubus|incubus|devourer|chorister|preacher|druid|stargazer|alchemist|heretic|bishop|cardinal|specter/i, archetype: 'controller' },
  // Support: heals/buffs allies
  { pattern: /hive mind|siren/i, archetype: 'support' },
  // Bruiser: tanky melee
  { pattern: /guard|knight|golem|titan|colossus|bear|treant|crab|worm|drake|yeti|naga|revenant|horror|brute|behemoth|troll|guardian|sentinel|construct|gargoyle|effigy|champion|automaton|sauropod|triceratops|mammoth|juggernaut|berserker|warchief|reaver|matriarch|lurker|huntsman|stalker|lycan|pack|howler|brawler/i, archetype: 'bruiser' },
  // Hollowed/Maddened humanoids default to bruiser
  { pattern: /hollowed|maddened|cursed|consumed|cocooned|victim|villager|merchant|livestock|thrall|zealot|apprentice|acolyte|worker|food|sailor|traveler|blind|noble|servant|dweller|feeder/i, archetype: 'bruiser' },
];

function inferArchetype(template) {
  // If the template already has an explicit archetype, use it
  if (template.archetype) return template.archetype;
  var name = template.name || '';
  for (var i = 0; i < _ARCHETYPE_NAME_PATTERNS.length; i++) {
    if (_ARCHETYPE_NAME_PATTERNS[i].pattern.test(name)) {
      return _ARCHETYPE_NAME_PATTERNS[i].archetype;
    }
  }
  // Fallback heuristic: high def relative to atk = bruiser, high atk low hp = skirmisher
  if (template.def > template.atk) return 'bruiser';
  if (template.hp <= 25 && template.atk >= 8) return 'skirmisher';
  return 'bruiser';
}

// Enemy pools + floor layouts — extracted to dungeon-enemy-pools.js
var _enemyPoolsData = require('./dungeon-enemy-pools');
var ENEMY_POOLS = _enemyPoolsData.ENEMY_POOLS;
var FLOOR_LAYOUTS = _enemyPoolsData.FLOOR_LAYOUTS;

// Also add cave floor counts for missing biomes
CAVE_FLOORS_BY_BIOME[12] = { min: 3, max: 6  };  // WASTES
CAVE_FLOORS_BY_BIOME[13] = { min: 2, max: 4  };  // BEACH
CAVE_FLOORS_BY_BIOME[14] = { min: 4, max: 8  };  // FROSTBOUND
CAVE_FLOORS_BY_BIOME[15] = { min: 3, max: 6  };  // SOUTHERN_WASTES
CAVE_FLOORS_BY_BIOME[16] = { min: 3, max: 7  };  // ELVEN_SOUTH


// Bind FLOOR_LAYOUTS and ENEMY_POOLS into dungeon-themes for selectLayout/getEnemyPool
dungeonThemes.init({ FLOOR_LAYOUTS: FLOOR_LAYOUTS, ENEMY_POOLS: ENEMY_POOLS });

// ---------------------------------------------------------------------------
// Shared corridor carving utilities (used by multiple layout generators)
// ---------------------------------------------------------------------------

function carveCorridorH(grid, width, height, y, x1, x2) {
  var startX = Math.min(x1, x2);
  var endX = Math.max(x1, x2);
  for (var cx = startX; cx <= endX; cx++) {
    if (y >= 0 && y < height && cx >= 0 && cx < width) {
      if (grid[y][cx] === TILE.WALL) {
        grid[y][cx] = TILE.CORRIDOR;
      }
    }
  }
}

function carveCorridorV(grid, width, height, x, y1, y2) {
  var startY = Math.min(y1, y2);
  var endY = Math.max(y1, y2);
  for (var cy = startY; cy <= endY; cy++) {
    if (cy >= 0 && cy < height && x >= 0 && x < width) {
      if (grid[cy][x] === TILE.WALL) {
        grid[cy][x] = TILE.CORRIDOR;
      }
    }
  }
}

function connectRoomsOnGrid(grid, width, height, roomA, roomB, rng) {
  if (rng() < 0.5) {
    carveCorridorH(grid, width, height, roomA.centerY, roomA.centerX, roomB.centerX);
    carveCorridorV(grid, width, height, roomB.centerX, roomA.centerY, roomB.centerY);
  } else {
    carveCorridorV(grid, width, height, roomA.centerX, roomA.centerY, roomB.centerY);
    carveCorridorH(grid, width, height, roomB.centerY, roomA.centerX, roomB.centerX);
  }
}

function initGrid(width, height) {
  var grid = [];
  for (var y = 0; y < height; y++) {
    grid[y] = [];
    for (var x = 0; x < width; x++) {
      grid[y][x] = TILE.WALL;
    }
  }
  return grid;
}

function ensureMinRooms(grid, width, height, rooms) {
  if (rooms.length < 2) {
    var fallbackRooms = [
      { x: 3, y: 3, w: 6, h: 5 },
      { x: width - 11, y: height - 9, w: 6, h: 5 },
    ];
    for (var fi = rooms.length; fi < 2; fi++) {
      var fb = fallbackRooms[fi];
      for (var fy = fb.y; fy < fb.y + fb.h; fy++) {
        for (var fx = fb.x; fx < fb.x + fb.w; fx++) {
          if (fy >= 0 && fy < height && fx >= 0 && fx < width) {
            grid[fy][fx] = TILE.FLOOR;
          }
        }
      }
      rooms.push({
        x: fb.x, y: fb.y, w: fb.w, h: fb.h,
        centerX: Math.floor(fb.x + fb.w / 2),
        centerY: Math.floor(fb.y + fb.h / 2),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Layout generator: BSP Rooms (original algorithm)
// ---------------------------------------------------------------------------

function generateBSPLayout(width, height, rng, minRooms, maxRooms) {
  var grid = initGrid(width, height);

  var targetRooms = minRooms + Math.floor(rng() * (maxRooms - minRooms + 1));
  var rooms = [];
  var maxAttempts = targetRooms * 30;

  for (var attempt = 0; attempt < maxAttempts && rooms.length < targetRooms; attempt++) {
    var rw = 4 + Math.floor(rng() * 5); // 4-8
    var rh = 4 + Math.floor(rng() * 3); // 4-6
    var rx = 2 + Math.floor(rng() * (width - rw - 4));
    var ry = 2 + Math.floor(rng() * (height - rh - 4));

    var overlap = false;
    for (var ri = 0; ri < rooms.length; ri++) {
      var other = rooms[ri];
      if (rx - 2 < other.x + other.w && rx + rw + 2 > other.x &&
          ry - 2 < other.y + other.h && ry + rh + 2 > other.y) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;

    for (var cy = ry; cy < ry + rh; cy++) {
      for (var cx = rx; cx < rx + rw; cx++) {
        grid[cy][cx] = TILE.FLOOR;
      }
    }

    rooms.push({
      x: rx, y: ry, w: rw, h: rh,
      centerX: Math.floor(rx + rw / 2),
      centerY: Math.floor(ry + rh / 2),
    });
  }

  ensureMinRooms(grid, width, height, rooms);

  for (var ci = 0; ci < rooms.length - 1; ci++) {
    connectRoomsOnGrid(grid, width, height, rooms[ci], rooms[ci + 1], rng);
  }

  if (rooms.length > 3) {
    var extraCount = 1 + Math.floor(rng() * 2);
    for (var ei = 0; ei < extraCount; ei++) {
      var a = Math.floor(rng() * rooms.length);
      var b = Math.floor(rng() * rooms.length);
      if (a !== b) {
        connectRoomsOnGrid(grid, width, height, rooms[a], rooms[b], rng);
      }
    }
  }

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout generator: Maze (recursive backtracker)
// ---------------------------------------------------------------------------

function generateMazeLayout(width, height, rng, minRooms, maxRooms) {
  var grid = initGrid(width, height);

  // Maze cells: each cell is 3x3 tiles (1 floor center + wall border)
  var cellsX = Math.floor((width - 2) / 3);
  var cellsY = Math.floor((height - 2) / 3);
  if (cellsX < 3) cellsX = 3;
  if (cellsY < 3) cellsY = 3;

  var visited = [];
  for (var my = 0; my < cellsY; my++) {
    visited[my] = [];
    for (var mx = 0; mx < cellsX; mx++) {
      visited[my][mx] = false;
    }
  }

  function cellToTile(cx, cy) {
    return { x: 1 + cx * 3 + 1, y: 1 + cy * 3 + 1 };
  }

  function carveCell(cx, cy) {
    var t = cellToTile(cx, cy);
    if (t.y >= 0 && t.y < height && t.x >= 0 && t.x < width) {
      grid[t.y][t.x] = TILE.CORRIDOR;
    }
  }

  function carvePassage(cx1, cy1, cx2, cy2) {
    var t1 = cellToTile(cx1, cy1);
    var t2 = cellToTile(cx2, cy2);
    var px = (t1.x + t2.x) >> 1;
    var py = (t1.y + t2.y) >> 1;
    if (py >= 0 && py < height && px >= 0 && px < width) {
      grid[py][px] = TILE.CORRIDOR;
    }
  }

  // Iterative backtracker (avoids stack overflow on large grids)
  var stack = [];
  var startCX = Math.floor(rng() * cellsX);
  var startCY = Math.floor(rng() * cellsY);
  visited[startCY][startCX] = true;
  carveCell(startCX, startCY);
  stack.push({ x: startCX, y: startCY });

  var dirs = [
    { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
  ];

  while (stack.length > 0) {
    var cur = stack[stack.length - 1];
    var neighbors = [];
    for (var di = 0; di < dirs.length; di++) {
      var nx = cur.x + dirs[di].dx;
      var ny = cur.y + dirs[di].dy;
      if (nx >= 0 && nx < cellsX && ny >= 0 && ny < cellsY && !visited[ny][nx]) {
        neighbors.push({ x: nx, y: ny });
      }
    }

    if (neighbors.length === 0) {
      stack.pop();
    } else {
      var chosen = neighbors[Math.floor(rng() * neighbors.length)];
      visited[chosen.y][chosen.x] = true;
      carvePassage(cur.x, cur.y, chosen.x, chosen.y);
      carveCell(chosen.x, chosen.y);
      stack.push(chosen);
    }
  }

  // Create rooms: expand every 4th cell into a larger room (5x3)
  var rooms = [];
  var targetRoomCount = minRooms + Math.floor(rng() * (maxRooms - minRooms + 1));
  var candidates = [];
  for (var rcy = 0; rcy < cellsY; rcy++) {
    for (var rcx = 0; rcx < cellsX; rcx++) {
      if ((rcy * cellsX + rcx) % 4 === 0) {
        candidates.push({ cx: rcx, cy: rcy });
      }
    }
  }

  // Shuffle candidates (Fisher-Yates)
  for (var si = candidates.length - 1; si > 0; si--) {
    var sj = Math.floor(rng() * (si + 1));
    var tmp = candidates[si];
    candidates[si] = candidates[sj];
    candidates[sj] = tmp;
  }

  var roomCount = Math.min(targetRoomCount, candidates.length);
  for (var ri = 0; ri < roomCount; ri++) {
    var cand = candidates[ri];
    var t = cellToTile(cand.cx, cand.cy);
    var rmx = t.x - 2;
    var rmy = t.y - 1;
    var rmw = 5;
    var rmh = 3;
    if (rmx < 1) rmx = 1;
    if (rmy < 1) rmy = 1;
    if (rmx + rmw >= width - 1) rmw = width - 2 - rmx;
    if (rmy + rmh >= height - 1) rmh = height - 2 - rmy;
    if (rmw < 3) rmw = 3;
    if (rmh < 3) rmh = 3;

    for (var fy = rmy; fy < rmy + rmh && fy < height - 1; fy++) {
      for (var fx = rmx; fx < rmx + rmw && fx < width - 1; fx++) {
        grid[fy][fx] = TILE.FLOOR;
      }
    }

    rooms.push({
      x: rmx, y: rmy, w: rmw, h: rmh,
      centerX: Math.floor(rmx + rmw / 2),
      centerY: Math.floor(rmy + rmh / 2),
    });
  }

  ensureMinRooms(grid, width, height, rooms);

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout generator: Lake (water-filled with walkway bridges)
// ---------------------------------------------------------------------------

function generateLakeLayout(width, height, rng, minRooms, maxRooms) {
  var grid = initGrid(width, height);
  var rooms = [];

  // Main walkway path from left side to right side
  var pathY = Math.floor(height / 2) + Math.floor(rng() * 6) - 3;
  var pathWidth = 1 + Math.floor(rng() * 2); // 1-2 tiles wide
  var curX = 2;
  var curY = pathY;

  while (curX < width - 3) {
    for (var pw = 0; pw < pathWidth; pw++) {
      var py = curY + pw;
      if (py >= 1 && py < height - 1 && curX >= 1 && curX < width - 1) {
        grid[py][curX] = TILE.CORRIDOR;
      }
    }

    var moveRoll = rng();
    if (moveRoll < 0.55) {
      curX++;
    } else if (moveRoll < 0.75) {
      curX++;
      curY = Math.max(2, Math.min(height - 3 - pathWidth, curY - 1));
    } else if (moveRoll < 0.95) {
      curX++;
      curY = Math.max(2, Math.min(height - 3 - pathWidth, curY + 1));
    } else {
      if (rng() < 0.5) {
        curY = Math.max(2, curY - 1);
      } else {
        curY = Math.min(height - 3 - pathWidth, curY + 1);
      }
    }
  }

  // Branch paths (2-4 branches off the main path)
  var branchCount = 2 + Math.floor(rng() * 3);
  var walkTiles = [];
  for (var sy = 0; sy < height; sy++) {
    for (var sx = 0; sx < width; sx++) {
      if (grid[sy][sx] === TILE.CORRIDOR) {
        walkTiles.push({ x: sx, y: sy });
      }
    }
  }

  for (var bi = 0; bi < branchCount && walkTiles.length > 0; bi++) {
    var branchStart = walkTiles[Math.floor(rng() * walkTiles.length)];
    var bx = branchStart.x;
    var by = branchStart.y;
    var bDir = rng() < 0.5 ? -1 : 1;
    var bLen = 5 + Math.floor(rng() * 10);

    for (var bs = 0; bs < bLen; bs++) {
      if (by >= 1 && by < height - 1 && bx >= 1 && bx < width - 1) {
        grid[by][bx] = TILE.CORRIDOR;
      }
      by += bDir;
      if (rng() < 0.3) bx += (rng() < 0.5 ? -1 : 1);
      bx = Math.max(1, Math.min(width - 2, bx));
      by = Math.max(1, Math.min(height - 2, by));
    }
  }

  // Create 3-6 small island rooms connected to walkways
  var islandCount = 3 + Math.floor(rng() * 4);
  walkTiles = [];
  for (var sy2 = 0; sy2 < height; sy2++) {
    for (var sx2 = 0; sx2 < width; sx2++) {
      if (grid[sy2][sx2] === TILE.CORRIDOR) {
        walkTiles.push({ x: sx2, y: sy2 });
      }
    }
  }

  for (var ii = 0; ii < islandCount && walkTiles.length > 0; ii++) {
    var anchor = walkTiles[Math.floor(rng() * walkTiles.length)];
    var offX = (rng() < 0.5 ? -1 : 1) * (2 + Math.floor(rng() * 3));
    var offY = (rng() < 0.5 ? -1 : 1) * (2 + Math.floor(rng() * 3));
    var iw = 3 + Math.floor(rng() * 3); // 3-5
    var ih = 3 + Math.floor(rng() * 2); // 3-4
    var ix = Math.max(1, Math.min(width - iw - 1, anchor.x + offX));
    var iy = Math.max(1, Math.min(height - ih - 1, anchor.y + offY));

    for (var iry = iy; iry < iy + ih; iry++) {
      for (var irx = ix; irx < ix + iw; irx++) {
        grid[iry][irx] = TILE.FLOOR;
      }
    }

    var room = {
      x: ix, y: iy, w: iw, h: ih,
      centerX: Math.floor(ix + iw / 2),
      centerY: Math.floor(iy + ih / 2),
    };
    rooms.push(room);

    connectRoomsOnGrid(grid, width, height, room, { centerX: anchor.x, centerY: anchor.y }, rng);
  }

  // Place some single-tile bridges across water gaps
  var bridgeCount = 2 + Math.floor(rng() * 4);
  for (var bri = 0; bri < bridgeCount; bri++) {
    var bridgeX = 3 + Math.floor(rng() * (width - 6));
    var bridgeY = 3 + Math.floor(rng() * (height - 6));
    if (grid[bridgeY][bridgeX] === TILE.WALL) {
      var hasNearby = false;
      for (var ndy = -2; ndy <= 2 && !hasNearby; ndy++) {
        for (var ndx = -2; ndx <= 2 && !hasNearby; ndx++) {
          var checkY = bridgeY + ndy;
          var checkX = bridgeX + ndx;
          if (checkY >= 0 && checkY < height && checkX >= 0 && checkX < width) {
            if (grid[checkY][checkX] === TILE.CORRIDOR || grid[checkY][checkX] === TILE.FLOOR) {
              hasNearby = true;
            }
          }
        }
      }
      if (hasNearby) {
        grid[bridgeY][bridgeX] = TILE.FLOOR;
      }
    }
  }

  ensureMinRooms(grid, width, height, rooms);

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout generator: Open Cavern (1-2 huge rooms with pillars)
// ---------------------------------------------------------------------------

function generateOpenCavernLayout(width, height, rng, minRooms, maxRooms) {
  var grid = initGrid(width, height);
  var rooms = [];

  var bigRoomCount = 1 + (rng() < 0.5 ? 1 : 0); // 1 or 2

  if (bigRoomCount === 1) {
    var margin = 3;
    var rw = Math.floor(width * (0.6 + rng() * 0.2));
    var rh = Math.floor(height * (0.6 + rng() * 0.2));
    var rx = Math.floor((width - rw) / 2);
    var ry = Math.floor((height - rh) / 2);
    if (rx < margin) rx = margin;
    if (ry < margin) ry = margin;
    if (rx + rw > width - margin) rw = width - margin - rx;
    if (ry + rh > height - margin) rh = height - margin - ry;

    for (var cy = ry; cy < ry + rh; cy++) {
      for (var cx = rx; cx < rx + rw; cx++) {
        grid[cy][cx] = TILE.FLOOR;
      }
    }

    rooms.push({
      x: rx, y: ry, w: rw, h: rh,
      centerX: Math.floor(rx + rw / 2),
      centerY: Math.floor(ry + rh / 2),
    });
  } else {
    var margin2 = 3;
    var halfW = Math.floor((width - margin2 * 3) / 2);
    var roomH = Math.floor(height * (0.55 + rng() * 0.15));
    var roomY = Math.floor((height - roomH) / 2);
    if (roomY < margin2) roomY = margin2;
    if (roomY + roomH > height - margin2) roomH = height - margin2 - roomY;

    var r1x = margin2;
    var r1w = halfW;
    for (var c1y = roomY; c1y < roomY + roomH; c1y++) {
      for (var c1x = r1x; c1x < r1x + r1w; c1x++) {
        grid[c1y][c1x] = TILE.FLOOR;
      }
    }
    rooms.push({
      x: r1x, y: roomY, w: r1w, h: roomH,
      centerX: Math.floor(r1x + r1w / 2),
      centerY: Math.floor(roomY + roomH / 2),
    });

    var r2x = margin2 + halfW + margin2;
    var r2w = halfW;
    if (r2x + r2w > width - margin2) r2w = width - margin2 - r2x;
    for (var c2y = roomY; c2y < roomY + roomH; c2y++) {
      for (var c2x = r2x; c2x < r2x + r2w; c2x++) {
        grid[c2y][c2x] = TILE.FLOOR;
      }
    }
    rooms.push({
      x: r2x, y: roomY, w: r2w, h: roomH,
      centerX: Math.floor(r2x + r2w / 2),
      centerY: Math.floor(roomY + roomH / 2),
    });

    // Connect rooms with wide corridor (3 tiles)
    var connY = Math.floor(roomY + roomH / 2);
    for (var cw = -1; cw <= 1; cw++) {
      var corridorY = connY + cw;
      if (corridorY >= 0 && corridorY < height) {
        carveCorridorH(grid, width, height, corridorY, r1x + r1w, r2x);
      }
    }
  }

  // Scatter pillar clusters (2x2 WALL blocks) inside rooms for cover
  for (var pi = 0; pi < rooms.length; pi++) {
    var rm = rooms[pi];
    var pillarCount = 3 + Math.floor(rng() * 5);
    for (var pj = 0; pj < pillarCount; pj++) {
      var ppx = rm.x + 2 + Math.floor(rng() * Math.max(1, rm.w - 4));
      var ppy = rm.y + 2 + Math.floor(rng() * Math.max(1, rm.h - 4));
      if (Math.abs(ppx - rm.centerX) < 2 && Math.abs(ppy - rm.centerY) < 2) continue;
      for (var pdy = 0; pdy < 2; pdy++) {
        for (var pdx = 0; pdx < 2; pdx++) {
          var tpx = ppx + pdx;
          var tpy = ppy + pdy;
          if (tpy >= rm.y + 1 && tpy < rm.y + rm.h - 1 && tpx >= rm.x + 1 && tpx < rm.x + rm.w - 1) {
            grid[tpy][tpx] = TILE.WALL;
          }
        }
      }
    }
  }

  // Add small alcoves (3x3 rooms) along the walls
  var alcoveCount = 3 + Math.floor(rng() * 4);
  for (var ai = 0; ai < alcoveCount; ai++) {
    var parentRoom = rooms[Math.floor(rng() * rooms.length)];
    var side = Math.floor(rng() * 4);
    var ax, ay;
    if (side === 0) {
      ax = parentRoom.x + 1 + Math.floor(rng() * Math.max(1, parentRoom.w - 4));
      ay = parentRoom.y - 3;
    } else if (side === 1) {
      ax = parentRoom.x + 1 + Math.floor(rng() * Math.max(1, parentRoom.w - 4));
      ay = parentRoom.y + parentRoom.h;
    } else if (side === 2) {
      ax = parentRoom.x - 3;
      ay = parentRoom.y + 1 + Math.floor(rng() * Math.max(1, parentRoom.h - 4));
    } else {
      ax = parentRoom.x + parentRoom.w;
      ay = parentRoom.y + 1 + Math.floor(rng() * Math.max(1, parentRoom.h - 4));
    }

    ax = Math.max(1, Math.min(width - 4, ax));
    ay = Math.max(1, Math.min(height - 4, ay));

    for (var acy = ay; acy < ay + 3 && acy < height - 1; acy++) {
      for (var acx = ax; acx < ax + 3 && acx < width - 1; acx++) {
        grid[acy][acx] = TILE.FLOOR;
      }
    }

    var alcove = {
      x: ax, y: ay, w: 3, h: 3,
      centerX: ax + 1, centerY: ay + 1,
    };
    rooms.push(alcove);

    connectRoomsOnGrid(grid, width, height, alcove, parentRoom, rng);
  }

  ensureMinRooms(grid, width, height, rooms);

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout generator: Temple Halls (long parallel halls with cross-connections)
// ---------------------------------------------------------------------------

function generateTempleHallsLayout(width, height, rng, minRooms, maxRooms) {
  var grid = initGrid(width, height);
  var rooms = [];

  var hallCount = 3 + Math.floor(rng() * 3); // 3-5
  var hallSpacing = Math.floor((height - 4) / (hallCount + 1));
  var hallWidth = 3;
  var hallMarginX = 3;

  var halls = [];
  for (var hi = 0; hi < hallCount; hi++) {
    var hallY = hallSpacing * (hi + 1) - Math.floor(hallWidth / 2);
    hallY = Math.max(2, Math.min(height - hallWidth - 2, hallY));
    var hallStartX = hallMarginX;
    var hallEndX = width - hallMarginX;
    var hallW = hallEndX - hallStartX;

    for (var hy = hallY; hy < hallY + hallWidth; hy++) {
      for (var hx = hallStartX; hx < hallEndX; hx++) {
        if (hy >= 0 && hy < height && hx >= 0 && hx < width) {
          grid[hy][hx] = TILE.FLOOR;
        }
      }
    }

    var hall = {
      x: hallStartX, y: hallY, w: hallW, h: hallWidth,
      centerX: Math.floor(hallStartX + hallW / 2),
      centerY: Math.floor(hallY + hallWidth / 2),
    };
    halls.push(hall);
    rooms.push(hall);
  }

  // 2-4 vertical cross-connections
  var crossCount = 2 + Math.floor(rng() * 3);
  for (var ci = 0; ci < crossCount; ci++) {
    var crossX = hallMarginX + 3 + Math.floor(rng() * Math.max(1, width - hallMarginX * 2 - 6));
    var crossWidth = 2 + Math.floor(rng() * 2); // 2-3 tiles

    var topHall = halls[0];
    var botHall = halls[halls.length - 1];
    var startY = topHall.y;
    var endY = botHall.y + botHall.h;

    for (var ccy = startY; ccy < endY; ccy++) {
      for (var ccx = crossX; ccx < crossX + crossWidth; ccx++) {
        if (ccy >= 0 && ccy < height && ccx >= 0 && ccx < width) {
          if (grid[ccy][ccx] === TILE.WALL) {
            grid[ccy][ccx] = TILE.CORRIDOR;
          }
        }
      }
    }
  }

  // Place small rooms (4x4) at intersection points
  var intersectionRoomCount = 0;
  var maxIntersectionRooms = Math.min(maxRooms - rooms.length, hallCount * crossCount);
  for (var ihi = 0; ihi < halls.length && intersectionRoomCount < maxIntersectionRooms; ihi++) {
    var iHall = halls[ihi];
    for (var isx = iHall.x; isx < iHall.x + iHall.w - 3; isx++) {
      var aboveIsCorridor = (iHall.y - 1 >= 0 && grid[iHall.y - 1][isx] === TILE.CORRIDOR);
      var belowIsCorridor = (iHall.y + iHall.h < height && grid[iHall.y + iHall.h][isx] === TILE.CORRIDOR);
      if ((aboveIsCorridor || belowIsCorridor) && rng() < 0.4 && intersectionRoomCount < maxIntersectionRooms) {
        var irx = Math.max(1, Math.min(width - 5, isx - 1));
        var iry = Math.max(1, Math.min(height - 5, iHall.y - 1));
        for (var iry2 = iry; iry2 < iry + 4 && iry2 < height - 1; iry2++) {
          for (var irx2 = irx; irx2 < irx + 4 && irx2 < width - 1; irx2++) {
            grid[iry2][irx2] = TILE.FLOOR;
          }
        }
        rooms.push({
          x: irx, y: iry, w: 4, h: 4,
          centerX: irx + 2, centerY: iry + 2,
        });
        intersectionRoomCount++;
        isx += 6;
      }
    }
  }

  // Add alcoves along halls
  var alcoveCount = 2 + Math.floor(rng() * 3);
  for (var ali = 0; ali < alcoveCount; ali++) {
    var alcoveHall = halls[Math.floor(rng() * halls.length)];
    var alcoveX = alcoveHall.x + 2 + Math.floor(rng() * Math.max(1, alcoveHall.w - 6));
    var above = rng() < 0.5;
    var alcoveY = above ? alcoveHall.y - 3 : alcoveHall.y + alcoveHall.h;
    alcoveY = Math.max(1, Math.min(height - 4, alcoveY));
    alcoveX = Math.max(1, Math.min(width - 4, alcoveX));

    for (var aly = alcoveY; aly < alcoveY + 3 && aly < height - 1; aly++) {
      for (var alx = alcoveX; alx < alcoveX + 3 && alx < width - 1; alx++) {
        grid[aly][alx] = TILE.FLOOR;
      }
    }

    var alRoom = {
      x: alcoveX, y: alcoveY, w: 3, h: 3,
      centerX: alcoveX + 1, centerY: alcoveY + 1,
    };
    rooms.push(alRoom);
    connectRoomsOnGrid(grid, width, height, alRoom, alcoveHall, rng);
  }

  ensureMinRooms(grid, width, height, rooms);

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout generator: Arena (large central room + surrounding chambers)
// ---------------------------------------------------------------------------

function generateArenaLayout(width, height, rng, minRooms, maxRooms) {
  var grid = initGrid(width, height);
  var rooms = [];

  // Central room: 40-50% of floor space
  var centerFrac = 0.4 + rng() * 0.1;
  var crw = Math.floor(width * Math.sqrt(centerFrac));
  var crh = Math.floor(height * Math.sqrt(centerFrac));
  if (crw < 8) crw = 8;
  if (crh < 6) crh = 6;
  var crx = Math.floor((width - crw) / 2);
  var cry = Math.floor((height - crh) / 2);
  crx = Math.max(2, crx);
  cry = Math.max(2, cry);
  if (crx + crw > width - 2) crw = width - 2 - crx;
  if (cry + crh > height - 2) crh = height - 2 - cry;

  for (var cy = cry; cy < cry + crh; cy++) {
    for (var cx = crx; cx < crx + crw; cx++) {
      grid[cy][cx] = TILE.FLOOR;
    }
  }

  var centralRoom = {
    x: crx, y: cry, w: crw, h: crh,
    centerX: Math.floor(crx + crw / 2),
    centerY: Math.floor(cry + crh / 2),
  };
  rooms.push(centralRoom);

  // Scatter pillar obstacles in central room
  var pillarCount = 2 + Math.floor(rng() * 4);
  for (var pi = 0; pi < pillarCount; pi++) {
    var ppx = crx + 3 + Math.floor(rng() * Math.max(1, crw - 6));
    var ppy = cry + 3 + Math.floor(rng() * Math.max(1, crh - 6));
    if (Math.abs(ppx - centralRoom.centerX) < 2 && Math.abs(ppy - centralRoom.centerY) < 2) continue;
    for (var pdy = 0; pdy < 2; pdy++) {
      for (var pdx = 0; pdx < 2; pdx++) {
        var tpx = ppx + pdx;
        var tpy = ppy + pdy;
        if (tpy >= cry + 1 && tpy < cry + crh - 1 && tpx >= crx + 1 && tpx < crx + crw - 1) {
          grid[tpy][tpx] = TILE.WALL;
        }
      }
    }
  }

  // 4-8 smaller rooms arranged around the perimeter
  var perimRoomCount = 4 + Math.floor(rng() * 5);
  var positions = [];
  positions.push({ x: crx + Math.floor(crw / 2) - 3, y: cry - 7 });
  positions.push({ x: crx + Math.floor(crw / 2) - 3, y: cry + crh + 2 });
  positions.push({ x: crx - 8, y: cry + Math.floor(crh / 2) - 2 });
  positions.push({ x: crx + crw + 2, y: cry + Math.floor(crh / 2) - 2 });
  positions.push({ x: crx - 7, y: cry - 6 });
  positions.push({ x: crx + crw + 1, y: cry - 6 });
  positions.push({ x: crx - 7, y: cry + crh + 1 });
  positions.push({ x: crx + crw + 1, y: cry + crh + 1 });

  // Shuffle positions
  for (var si = positions.length - 1; si > 0; si--) {
    var sj = Math.floor(rng() * (si + 1));
    var tmp = positions[si];
    positions[si] = positions[sj];
    positions[sj] = tmp;
  }

  for (var pri = 0; pri < perimRoomCount && pri < positions.length; pri++) {
    var pos = positions[pri];
    var prw = 4 + Math.floor(rng() * 3); // 4-6
    var prh = 4 + Math.floor(rng() * 3); // 4-6
    var prx = Math.max(1, Math.min(width - prw - 1, pos.x));
    var pry = Math.max(1, Math.min(height - prh - 1, pos.y));

    for (var pcy = pry; pcy < pry + prh; pcy++) {
      for (var pcx = prx; pcx < prx + prw; pcx++) {
        if (pcy >= 0 && pcy < height && pcx >= 0 && pcx < width) {
          grid[pcy][pcx] = TILE.FLOOR;
        }
      }
    }

    var perimRoom = {
      x: prx, y: pry, w: prw, h: prh,
      centerX: Math.floor(prx + prw / 2),
      centerY: Math.floor(pry + prh / 2),
    };
    rooms.push(perimRoom);

    connectRoomsOnGrid(grid, width, height, perimRoom, centralRoom, rng);
  }

  ensureMinRooms(grid, width, height, rooms);

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout generator: Island (scattered platforms connected by narrow bridges)
// ---------------------------------------------------------------------------

function generateIslandLayout(width, height, rng, minRooms, maxRooms) {
  var grid = initGrid(width, height);
  var rooms = [];

  var islandCount = 5 + Math.floor(rng() * 6); // 5-10
  islandCount = Math.max(islandCount, minRooms);
  if (islandCount > maxRooms) islandCount = maxRooms;
  var maxAttempts = islandCount * 40;
  var attempts = 0;

  while (rooms.length < islandCount && attempts < maxAttempts) {
    attempts++;
    var iw = 3 + Math.floor(rng() * 3); // 3-5
    var ih = 3 + Math.floor(rng() * 3); // 3-5
    var ix = 2 + Math.floor(rng() * (width - iw - 4));
    var iy = 2 + Math.floor(rng() * (height - ih - 4));

    var overlap = false;
    for (var ri = 0; ri < rooms.length; ri++) {
      var other = rooms[ri];
      if (ix - 3 < other.x + other.w && ix + iw + 3 > other.x &&
          iy - 3 < other.y + other.h && iy + ih + 3 > other.y) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;

    for (var icy = iy; icy < iy + ih; icy++) {
      for (var icx = ix; icx < ix + iw; icx++) {
        grid[icy][icx] = TILE.FLOOR;
      }
    }

    rooms.push({
      x: ix, y: iy, w: iw, h: ih,
      centerX: Math.floor(ix + iw / 2),
      centerY: Math.floor(iy + ih / 2),
    });
  }

  ensureMinRooms(grid, width, height, rooms);

  // Connect rooms with single-tile-wide bridges
  for (var ci = 0; ci < rooms.length - 1; ci++) {
    var roomA = rooms[ci];
    var roomB = rooms[ci + 1];

    if (rng() < 0.4) {
      if (Math.abs(roomA.centerY - roomB.centerY) <= 2) {
        carveCorridorH(grid, width, height, roomA.centerY, roomA.centerX, roomB.centerX);
      } else if (Math.abs(roomA.centerX - roomB.centerX) <= 2) {
        carveCorridorV(grid, width, height, roomA.centerX, roomA.centerY, roomB.centerY);
      } else {
        connectRoomsOnGrid(grid, width, height, roomA, roomB, rng);
      }
    } else {
      connectRoomsOnGrid(grid, width, height, roomA, roomB, rng);
    }
  }

  // 1-2 extra cross-connections
  if (rooms.length > 3) {
    var extraConns = 1 + Math.floor(rng() * 2);
    for (var ei = 0; ei < extraConns; ei++) {
      var a = Math.floor(rng() * rooms.length);
      var b = Math.floor(rng() * rooms.length);
      if (a !== b) {
        connectRoomsOnGrid(grid, width, height, rooms[a], rooms[b], rng);
      }
    }
  }

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout generator: Organic (cellular automata cave generation)
// ---------------------------------------------------------------------------

function generateOrganicLayout(width, height, rng, minRooms, maxRooms) {
  // Step 1: Fill grid randomly (45% FLOOR, 55% WALL)
  var grid = [];
  for (var y = 0; y < height; y++) {
    grid[y] = [];
    for (var x = 0; x < width; x++) {
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        grid[y][x] = TILE.WALL;
      } else {
        grid[y][x] = (rng() < 0.45) ? TILE.FLOOR : TILE.WALL;
      }
    }
  }

  // Step 2: Run 5 iterations of cellular automata
  for (var iter = 0; iter < 5; iter++) {
    var newGrid = [];
    for (var ny = 0; ny < height; ny++) {
      newGrid[ny] = [];
      for (var nx = 0; nx < width; nx++) {
        if (ny === 0 || ny === height - 1 || nx === 0 || nx === width - 1) {
          newGrid[ny][nx] = TILE.WALL;
          continue;
        }
        var wallCount = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (dy === 0 && dx === 0) continue;
            var ny2 = ny + dy;
            var nx2 = nx + dx;
            if (ny2 < 0 || ny2 >= height || nx2 < 0 || nx2 >= width) {
              wallCount++;
            } else if (grid[ny2][nx2] === TILE.WALL) {
              wallCount++;
            }
          }
        }

        if (grid[ny][nx] === TILE.WALL) {
          newGrid[ny][nx] = (wallCount >= 4) ? TILE.WALL : TILE.FLOOR;
        } else {
          newGrid[ny][nx] = (wallCount >= 5) ? TILE.WALL : TILE.FLOOR;
        }
      }
    }
    grid = newGrid;
  }

  // Step 3: Flood-fill to find the largest connected region
  var regionMap = [];
  for (var ry = 0; ry < height; ry++) {
    regionMap[ry] = [];
    for (var rx = 0; rx < width; rx++) {
      regionMap[ry][rx] = -1;
    }
  }

  var regions = [];
  var regionId = 0;

  for (var fy = 1; fy < height - 1; fy++) {
    for (var fx = 1; fx < width - 1; fx++) {
      if (grid[fy][fx] === TILE.FLOOR && regionMap[fy][fx] === -1) {
        var regionTiles = [];
        var queue = [{ x: fx, y: fy }];
        regionMap[fy][fx] = regionId;

        while (queue.length > 0) {
          var cur = queue.shift();
          regionTiles.push(cur);
          var floodDirs = [
            { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
            { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
          ];
          for (var fdi = 0; fdi < floodDirs.length; fdi++) {
            var fnx = cur.x + floodDirs[fdi].dx;
            var fny = cur.y + floodDirs[fdi].dy;
            if (fnx >= 0 && fnx < width && fny >= 0 && fny < height &&
                grid[fny][fnx] === TILE.FLOOR && regionMap[fny][fnx] === -1) {
              regionMap[fny][fnx] = regionId;
              queue.push({ x: fnx, y: fny });
            }
          }
        }

        regions.push(regionTiles);
        regionId++;
      }
    }
  }

  // Step 4: Find largest region, fill all others with WALL
  var largestIdx = 0;
  var largestSize = 0;
  for (var li = 0; li < regions.length; li++) {
    if (regions[li].length > largestSize) {
      largestSize = regions[li].length;
      largestIdx = li;
    }
  }

  for (var ri2 = 0; ri2 < regions.length; ri2++) {
    if (ri2 !== largestIdx) {
      var tiles = regions[ri2];
      for (var ti = 0; ti < tiles.length; ti++) {
        grid[tiles[ti].y][tiles[ti].x] = TILE.WALL;
      }
    }
  }

  // Defensive: if too few floor tiles, force open space
  if (largestSize < 20) {
    var forcedX = Math.floor(width / 4);
    var forcedY = Math.floor(height / 4);
    var forcedW = Math.floor(width / 2);
    var forcedH = Math.floor(height / 2);
    for (var fry = forcedY; fry < forcedY + forcedH; fry++) {
      for (var frx = forcedX; frx < forcedX + forcedW; frx++) {
        if (fry > 0 && fry < height - 1 && frx > 0 && frx < width - 1) {
          grid[fry][frx] = TILE.FLOOR;
        }
      }
    }
  }

  // Step 5: Identify rooms as rectangular sub-regions within the organic shape
  var rooms = [];
  var usedCells = [];
  for (var uy = 0; uy < height; uy++) {
    usedCells[uy] = [];
    for (var ux = 0; ux < width; ux++) {
      usedCells[uy][ux] = false;
    }
  }

  var targetRoomCount = minRooms + Math.floor(rng() * (maxRooms - minRooms + 1));
  var roomAttempts = 0;
  var maxRoomAttempts = targetRoomCount * 50;

  while (rooms.length < targetRoomCount && roomAttempts < maxRoomAttempts) {
    roomAttempts++;
    var osx = 2 + Math.floor(rng() * (width - 4));
    var osy = 2 + Math.floor(rng() * (height - 4));
    if (grid[osy][osx] !== TILE.FLOOR || usedCells[osy][osx]) continue;

    // Try to expand a rectangle from this point
    var orw = 1;
    var orh = 1;
    while (orw < 6 && osx + orw < width - 1 && grid[osy][osx + orw] === TILE.FLOOR && !usedCells[osy][osx + orw]) orw++;
    var canExpand = true;
    while (orh < 5 && osy + orh < height - 1 && canExpand) {
      for (var chk = osx; chk < osx + orw; chk++) {
        if (grid[osy + orh][chk] !== TILE.FLOOR || usedCells[osy + orh][chk]) {
          canExpand = false;
          break;
        }
      }
      if (canExpand) orh++;
    }

    if (orw >= 3 && orh >= 3) {
      for (var ucy = osy; ucy < osy + orh; ucy++) {
        for (var ucx = osx; ucx < osx + orw; ucx++) {
          usedCells[ucy][ucx] = true;
        }
      }
      rooms.push({
        x: osx, y: osy, w: orw, h: orh,
        centerX: Math.floor(osx + orw / 2),
        centerY: Math.floor(osy + orh / 2),
      });
    }
  }

  ensureMinRooms(grid, width, height, rooms);

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout dispatcher: selects and runs the appropriate generator
// ---------------------------------------------------------------------------

function generateLayoutForFloor(layout, width, height, rng, minRooms, maxRooms) {
  switch (layout) {
    case 'maze':          return generateMazeLayout(width, height, rng, minRooms, maxRooms);
    case 'lake':          return generateLakeLayout(width, height, rng, minRooms, maxRooms);
    case 'open_cavern':   return generateOpenCavernLayout(width, height, rng, minRooms, maxRooms);
    case 'temple_halls':  return generateTempleHallsLayout(width, height, rng, minRooms, maxRooms);
    case 'arena':         return generateArenaLayout(width, height, rng, minRooms, maxRooms);
    case 'island':        return generateIslandLayout(width, height, rng, minRooms, maxRooms);
    case 'organic':       return generateOrganicLayout(width, height, rng, minRooms, maxRooms);
    case 'raid_arena':    return generateRaidArenaLayout(width, height, rng);
    case 'ocean_arena':   return generateOceanArenaLayout(width, height, rng);
    case 'bsp_rooms':     // fall through
    default:              return generateBSPLayout(width, height, rng, minRooms, maxRooms);
  }
}

// ---------------------------------------------------------------------------
// Layout: RAID_ARENA — large central arena + waiting room + barrier + 4 alcoves
// Used for raid boss floors (every 50th rift floor).
// ---------------------------------------------------------------------------
function generateRaidArenaLayout(width, height, rng) {
  // Initialize grid with walls
  var grid = [];
  for (var y = 0; y < height; y++) {
    grid[y] = [];
    for (var x = 0; x < width; x++) {
      grid[y][x] = TILE.WALL;
    }
  }

  var rooms = [];

  // Room 1: Waiting room (south side, smaller)
  var waitW = 30, waitH = 20;
  var waitX = Math.floor((width - waitW) / 2);
  var waitY = height - waitH - 2;
  for (var wy = waitY; wy < waitY + waitH; wy++) {
    for (var wx = waitX; wx < waitX + waitW; wx++) {
      grid[wy][wx] = TILE.FLOOR;
    }
  }
  rooms.push({
    x: waitX, y: waitY, w: waitW, h: waitH,
    centerX: waitX + Math.floor(waitW / 2),
    centerY: waitY + Math.floor(waitH / 2),
  });

  // Barrier row (BOSS_DOOR tiles separating waiting room from arena)
  var barrierY = waitY - 1;
  for (var bx = waitX + 4; bx < waitX + waitW - 4; bx++) {
    grid[barrierY][bx] = TILE.BOSS_DOOR;
  }

  // Room 2: Main arena (large central area)
  var arenaW = Math.floor(width * 0.7);
  var arenaH = Math.floor(height * 0.5);
  var arenaX = Math.floor((width - arenaW) / 2);
  var arenaY = Math.floor((barrierY - arenaH) / 2) + 2;
  for (var ay = arenaY; ay < arenaY + arenaH; ay++) {
    for (var ax = arenaX; ax < arenaX + arenaW; ax++) {
      grid[ay][ax] = TILE.FLOOR;
    }
  }
  // Add pillar cover (scattered walls within arena for tactical positioning)
  var pillarCount = 8 + Math.floor(rng() * 6);
  for (var pi = 0; pi < pillarCount; pi++) {
    var px = arenaX + 3 + Math.floor(rng() * (arenaW - 6));
    var py = arenaY + 3 + Math.floor(rng() * (arenaH - 6));
    // 2x2 pillar
    if (py + 1 < arenaY + arenaH && px + 1 < arenaX + arenaW) {
      grid[py][px] = TILE.WALL;
      grid[py][px + 1] = TILE.WALL;
      grid[py + 1][px] = TILE.WALL;
      grid[py + 1][px + 1] = TILE.WALL;
    }
  }
  rooms.push({
    x: arenaX, y: arenaY, w: arenaW, h: arenaH,
    centerX: arenaX + Math.floor(arenaW / 2),
    centerY: arenaY + Math.floor(arenaH / 2),
  });

  // Connect barrier to arena with corridor
  for (var cy = arenaY + arenaH; cy <= barrierY; cy++) {
    for (var cx = waitX + 8; cx < waitX + waitW - 8; cx++) {
      if (grid[cy][cx] === TILE.WALL) grid[cy][cx] = TILE.CORRIDOR;
    }
  }

  // Room 3-6: 4 alcoves at corners of arena (for raid mechanics)
  var alcoveSize = 8;
  var alcovePositions = [
    { x: arenaX - alcoveSize - 1, y: arenaY },                              // top-left
    { x: arenaX + arenaW + 1,     y: arenaY },                              // top-right
    { x: arenaX - alcoveSize - 1, y: arenaY + arenaH - alcoveSize },        // bottom-left
    { x: arenaX + arenaW + 1,     y: arenaY + arenaH - alcoveSize },        // bottom-right
  ];
  for (var ai = 0; ai < alcovePositions.length; ai++) {
    var aPos = alcovePositions[ai];
    if (aPos.x < 1 || aPos.x + alcoveSize >= width - 1) continue;
    if (aPos.y < 1 || aPos.y + alcoveSize >= height - 1) continue;

    for (var aly = aPos.y; aly < aPos.y + alcoveSize; aly++) {
      for (var alx = aPos.x; alx < aPos.x + alcoveSize; alx++) {
        grid[aly][alx] = TILE.FLOOR;
      }
    }
    // Connect alcove to arena with corridor
    var connY = aPos.y + Math.floor(alcoveSize / 2);
    var connStartX = (aPos.x < arenaX) ? aPos.x + alcoveSize : arenaX + arenaW;
    var connEndX = (aPos.x < arenaX) ? arenaX : aPos.x;
    for (var ccx = Math.min(connStartX, connEndX); ccx <= Math.max(connStartX, connEndX); ccx++) {
      if (grid[connY][ccx] === TILE.WALL) grid[connY][ccx] = TILE.CORRIDOR;
    }

    rooms.push({
      x: aPos.x, y: aPos.y, w: alcoveSize, h: alcoveSize,
      centerX: aPos.x + Math.floor(alcoveSize / 2),
      centerY: aPos.y + Math.floor(alcoveSize / 2),
    });
  }

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Enemy scaling
// ---------------------------------------------------------------------------

function scaleEnemy(template, floorNum, theme) {
  var mult = Math.max(0, floorNum - 1);
  var archetype = inferArchetype(template);
  var defaults = ENEMY_DEFAULTS[archetype] || ENEMY_DEFAULTS.bruiser;
  var scaledHp = Math.floor(template.hp * (1 + mult * 0.12));
  // Resolve combat properties: template overrides theme defaults
  var themeCombat = (theme && THEME_COMBAT_PROPERTIES[theme]) || {};
  return {
    id:              template.id,
    name:            template.name,
    hp:              scaledHp,
    maxHp:           scaledHp,
    atk:             Math.floor(template.atk  * (1 + mult * 0.08)),
    def:             Math.floor(template.def  * (1 + mult * 0.05)),
    xp:              Math.floor(template.xp   * (1 + mult * 0.20)),
    gold:            Math.floor(template.gold * (1 + mult * 0.15)),
    archetype:       archetype,
    detectionRadius: (template.detectionRadius != null) ? template.detectionRadius : defaults.detectionRadius,
    abilities:       template.abilities || defaults.abilities,
    resistances:     template.resistances || themeCombat.resistances || null,
    weaknesses:      template.weaknesses  || themeCombat.weaknesses  || null,
    damageType:      template.damageType  || themeCombat.damageType  || null,
    element:         template.element || (theme ? (THEME_ELEMENT_MAP[theme] || null) : null),
    invisibility:    template.invisibility || null,
    isLiving:        (template.isLiving !== undefined) ? template.isLiving : undefined,
  };
}

function scaleBoss(template, floorNum, theme) {
  var mult = Math.max(0, floorNum - 1);
  var defaults = ENEMY_DEFAULTS.elite;
  var scaledHp = Math.floor(template.hp * (1 + mult * 0.15));
  var scaledAtk = Math.floor(template.atk * (1 + mult * 0.10));

  // Build boss-specific abilities: use template overrides or elite defaults
  var abilities = template.abilities || [
    { id: 'heavy_strike', name: 'Heavy Strike', damage: 1.5, range: 1, windUp: 2, cooldown: 4, weight: 10 },
    { id: 'power_slam', name: 'Power Slam', damage: 2.0, range: 1, windUp: 3, cooldown: 6, weight: 8, effect: 'stun', effectChance: 0.3 },
    { id: 'boss_roar', name: 'Terrifying Roar', damage: 0.6, range: 3, windUp: 1, cooldown: 8, weight: 6, effect: 'fear', effectChance: 0.5 },
  ];

  // Build boss phases: use template overrides or generate defaults
  var phases = template.phases || [
    {
      threshold: 0.6,
      name: 'Enraged',
      atkMult: 1.3,
      abilities: [
        { id: 'enraged_strike', name: 'Enraged Strike', damage: 1.8, range: 1, windUp: 2, cooldown: 3, weight: 12 },
        { id: 'power_slam', name: 'Power Slam', damage: 2.0, range: 1, windUp: 3, cooldown: 5, weight: 10, effect: 'stun', effectChance: 0.4 },
      ],
      speed: 2,
    },
    {
      threshold: 0.3,
      name: 'Desperate',
      atkMult: 1.6,
      abilities: [
        { id: 'desperate_flurry', name: 'Desperate Flurry', damage: 2.2, range: 1, windUp: 1, cooldown: 3, weight: 14 },
        { id: 'death_throes', name: 'Death Throes', damage: 1.5, range: 2, windUp: 2, cooldown: 4, weight: 10, effect: 'bleed', effectChance: 0.6 },
      ],
      detectionRadius: 8,
    },
  ];

  // Resolve combat properties: template overrides theme defaults
  var themeCombat = (theme && THEME_COMBAT_PROPERTIES[theme]) || {};

  return {
    id:              template.id,
    name:            template.name,
    hp:              scaledHp,
    maxHp:           scaledHp,
    atk:             scaledAtk,
    def:             Math.floor(template.def  * (1 + mult * 0.08)),
    xp:              Math.floor(template.xp   * (1 + mult * 0.30)),
    gold:            Math.floor(template.gold * (1 + mult * 0.25)),
    isBoss:          true,
    archetype:       'elite',
    detectionRadius: defaults.detectionRadius,
    cardPackReward:  true,
    abilities:       abilities,
    phases:          phases,
    resistances:     template.resistances || themeCombat.resistances || null,
    weaknesses:      template.weaknesses  || themeCombat.weaknesses  || null,
    damageType:      template.damageType  || themeCombat.damageType  || null,
    element:         template.element || (theme ? (THEME_ELEMENT_MAP[theme] || null) : null),
    mechanic:        template.mechanic || BOSS_MECHANIC_MAP[template.id] || null,
    mechanicDef:     (template.mechanic || BOSS_MECHANIC_MAP[template.id]) ? (BOSS_MECHANICS[template.mechanic || BOSS_MECHANIC_MAP[template.id]] || null) : null,
  };
}

// ---------------------------------------------------------------------------
// Dungeon NPCs
// ---------------------------------------------------------------------------

var DUNGEON_NPCS = [
  {
    id: 'prisoner',
    name: 'Imprisoned Adventurer',
    dialogue: 'Thank you for freeing me! Take this as a reward.',
    reward: { gold: 20, xp: 15 },
    questHook: 'escort_to_exit',
  },
  {
    id: 'lost_merchant',
    name: 'Lost Merchant',
    dialogue: 'I got separated from my caravan. Would you like to trade?',
    reward: null,
    questHook: 'trade_opportunity',
  },
  {
    id: 'wounded_knight',
    name: 'Wounded Knight',
    dialogue: 'I can barely stand... the boss on the next floor is fearsome. Take my shield.',
    reward: { defBoost: 3, duration: 300 },
    questHook: null,
  },
  {
    id: 'trapped_mage',
    name: 'Trapped Mage',
    dialogue: 'These wards are too strong for me alone. Help me break free and I will aid you.',
    reward: { atkBoost: 5, duration: 180 },
    questHook: 'mage_companion',
  },
  {
    id: 'escaped_prisoner',
    name: 'Escaped Prisoner',
    dialogue: 'The guards are distracted. I mapped a shortcut to the lower floors.',
    reward: { revealMap: true },
    questHook: 'shortcut_reveal',
  },
];

var dungeonCorpsesData = require('./dungeon-corpses');
var DUNGEON_CORPSES = dungeonCorpsesData.DUNGEON_CORPSES;


// ---------------------------------------------------------------------------
// getThemeForFloor — determines which visual/gameplay theme to use
// ---------------------------------------------------------------------------

function getThemeForFloor(floorNum, seed, options) {
  // Allow forced theme from world dungeons (opts.theme overrides all selection)
  if (options && options.theme) return options.theme;

  // Use themeSeed (if provided) for theme RNG so themes stay stable
  // even when the main seed rotates daily (caves/world dungeons).
  var themeSeedStr = (options && options.themeSeed) ? options.themeSeed : seed;
  var rng = seededRandom(chunkSeed(floorNum, 0, themeSeedStr + ':theme'));
  var type = (options && options.type) || 'rift';

  if (type === 'cave') {
    var biome = (options && options.biome != null) ? options.biome : 5;
    var themes = BIOME_DUNGEON_THEMES[biome];
    if (!themes || themes.length === 0) themes = BIOME_DUNGEON_THEMES[5];
    var idx = Math.floor(rng() * themes.length);
    return themes[idx];
  }

  // Rift: floors 1-5 use castle themes, 6+ use wild themes
  if (floorNum <= 5) {
    var cIdx = Math.floor(rng() * CASTLE_THEMES.length);
    return CASTLE_THEMES[cIdx];
  }

  var wIdx = Math.floor(rng() * WILD_THEMES.length);
  return WILD_THEMES[wIdx];
}

// ---------------------------------------------------------------------------
// getCaveDepth — returns number of floors for a biome cave
// ---------------------------------------------------------------------------

function getCaveDepth(biome, caveKey) {
  var range = CAVE_FLOORS_BY_BIOME[biome];
  if (!range) range = { min: 2, max: 4 };
  var rng = seededRandom(chunkSeed(biome, 0, CAVE_SEED_PREFIX + caveKey));
  var depth = range.min + Math.floor(rng() * (range.max - range.min + 1));
  return depth;
}

// ---------------------------------------------------------------------------
// Layout: OCEAN_ARENA — open water arena for leviathan encounters
// Spawn platform (bottom), large open arena (center/top), debris + pillars.
// ---------------------------------------------------------------------------
function generateOceanArenaLayout(width, height, rng) {
  var grid = [];
  for (var y = 0; y < height; y++) {
    grid[y] = [];
    for (var x = 0; x < width; x++) {
      grid[y][x] = TILE.WALL;
    }
  }

  var rooms = [];

  // Player spawn platform (bottom section)
  var spawnW = Math.min(30, Math.floor(width * 0.4));
  var spawnH = Math.min(15, Math.floor(height * 0.18));
  var spawnX = Math.floor((width - spawnW) / 2);
  var spawnY = height - spawnH - 2;
  for (var sy = spawnY; sy < spawnY + spawnH; sy++) {
    for (var sx = spawnX; sx < spawnX + spawnW; sx++) {
      grid[sy][sx] = TILE.FLOOR;
    }
  }
  rooms.push({
    x: spawnX, y: spawnY, w: spawnW, h: spawnH,
    centerX: spawnX + Math.floor(spawnW / 2),
    centerY: spawnY + Math.floor(spawnH / 2),
  });

  // Main arena (center/top — large open water area)
  var arenaW = Math.floor(width * 0.75);
  var arenaH = Math.floor(height * 0.55);
  var arenaX = Math.floor((width - arenaW) / 2);
  var arenaY = 3;
  for (var ay = arenaY; ay < arenaY + arenaH; ay++) {
    for (var ax = arenaX; ax < arenaX + arenaW; ax++) {
      grid[ay][ax] = TILE.FLOOR;
    }
  }
  rooms.push({
    x: arenaX, y: arenaY, w: arenaW, h: arenaH,
    centerX: arenaX + Math.floor(arenaW / 2),
    centerY: arenaY + Math.floor(arenaH / 2),
  });

  // Connecting corridor (spawn platform to arena)
  var corrX = Math.floor(width / 2) - 3;
  var corrTopY = arenaY + arenaH;
  var corrBotY = spawnY;
  for (var cy = corrTopY; cy < corrBotY; cy++) {
    for (var cx = corrX; cx < corrX + 6; cx++) {
      if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
        grid[cy][cx] = TILE.FLOOR;
      }
    }
  }

  // Floating debris: 1x1 WALL obstacles scattered in arena
  var debrisCount = 6 + Math.floor(rng() * 8);
  for (var di = 0; di < debrisCount; di++) {
    var dx = arenaX + 2 + Math.floor(rng() * (arenaW - 4));
    var dy = arenaY + 2 + Math.floor(rng() * (arenaH - 4));
    grid[dy][dx] = TILE.WALL;
  }

  // Coral pillars: 3x3 WALL clusters
  var pillarCount = 3 + Math.floor(rng() * 4);
  for (var pi = 0; pi < pillarCount; pi++) {
    var px = arenaX + 4 + Math.floor(rng() * (arenaW - 8));
    var py = arenaY + 4 + Math.floor(rng() * (arenaH - 8));
    for (var ppy = py; ppy < py + 3 && ppy < arenaY + arenaH - 1; ppy++) {
      for (var ppx = px; ppx < px + 3 && ppx < arenaX + arenaW - 1; ppx++) {
        grid[ppy][ppx] = TILE.WALL;
      }
    }
  }

  // 2x2 debris clusters
  var clusterCount = 2 + Math.floor(rng() * 3);
  for (var ci = 0; ci < clusterCount; ci++) {
    var cxx = arenaX + 3 + Math.floor(rng() * (arenaW - 6));
    var cyy = arenaY + 3 + Math.floor(rng() * (arenaH - 6));
    if (cyy + 1 < arenaY + arenaH && cxx + 1 < arenaX + arenaW) {
      grid[cyy][cxx] = TILE.WALL;
      grid[cyy][cxx + 1] = TILE.WALL;
      grid[cyy + 1][cxx] = TILE.WALL;
      grid[cyy + 1][cxx + 1] = TILE.WALL;
    }
  }

  return { grid: grid, rooms: rooms, spawnRoom: rooms[0], arenaRoom: rooms[1] };
}


// ---------------------------------------------------------------------------
// generateFloor — layout-aware floor generation with enemies, chests, traps, NPCs
// ---------------------------------------------------------------------------

function generateFloor(floorNum, seed, options) {
  var opts = options || {};
  var type = opts.type || 'rift';
  var totalFloors = opts.totalFloors || 0;
  var difficulty = DIFFICULTY_TIERS[opts.difficulty] || DIFFICULTY_TIERS.standard;

  // Create seeded RNG
  var floorSeed = chunkSeed(floorNum, 0, (type === 'cave' ? CAVE_SEED_PREFIX : RIFT_SEED_PREFIX) + seed);
  var rng = seededRandom(floorSeed);

  // Determine theme
  var theme = getThemeForFloor(floorNum, seed, opts);

  // Pick floor size based on floor number and type
  var sizeKey;
  if (type === 'cave') {
    if (floorNum <= 2) sizeKey = 'small';
    else if (floorNum <= 5) sizeKey = 'medium';
    else sizeKey = 'large';
  } else {
    if (floorNum <= 3)       sizeKey = 'small';
    else if (floorNum <= 8)  sizeKey = 'medium';
    else if (floorNum <= 15) sizeKey = 'large';
    else                     sizeKey = 'huge';
  }

  var sizeTable = (type === 'cave') ? CAVE_FLOOR_SIZE : RIFT_FLOOR_SIZE;
  var size = sizeTable[sizeKey];
  var width = size.width;
  var height = size.height;
  var minRooms = size.minRooms;
  var maxRooms = size.maxRooms;

  // Determine boss floor early (needed for layout selection)
  var isBossFloor = false;
  if (type === 'rift') {
    isBossFloor = (floorNum % 10 === 0);
  } else if (type === 'cave' && totalFloors > 0) {
    isBossFloor = (floorNum === totalFloors);
  }

  // Determine raid boss floor (every 50th rift floor)
  var isRaidBossFloor = false;
  if (type === 'rift' && floorNum > 0 && floorNum % 50 === 0) {
    isRaidBossFloor = true;
    isBossFloor = true; // Raid floors are also boss floors
  }

  // Select layout: raid floors use RAID_ARENA, boss floors use ARENA, otherwise theme-based
  var layout;
  if (isRaidBossFloor) {
    layout = FLOOR_LAYOUTS.RAID_ARENA;
    // Override size for raid arena
    width = RAID_FLOOR_SIZE.width;
    height = RAID_FLOOR_SIZE.height;
    minRooms = RAID_FLOOR_SIZE.minRooms;
    maxRooms = RAID_FLOOR_SIZE.maxRooms;
  } else {
    layout = isBossFloor ? FLOOR_LAYOUTS.ARENA : selectLayout(theme, rng);
  }

  // Generate grid + rooms using the selected layout generator
  var result = generateLayoutForFloor(layout, width, height, rng, minRooms, maxRooms);
  var grid = result.grid;
  var rooms = result.rooms;

  // Place doors at room-corridor transitions (max 2 per room)
  for (var di = 0; di < rooms.length; di++) {
    var room = rooms[di];
    var doorCount = 0;
    var doorMaxPerRoom = 2;

    // Check room perimeter for corridor adjacency
    for (var dy = room.y - 1; dy <= room.y + room.h && doorCount < doorMaxPerRoom; dy++) {
      for (var dx = room.x - 1; dx <= room.x + room.w && doorCount < doorMaxPerRoom; dx++) {
        // Only check edge cells
        if (dy === room.y - 1 || dy === room.y + room.h ||
            dx === room.x - 1 || dx === room.x + room.w) {
          if (dy >= 0 && dy < height && dx >= 0 && dx < width) {
            if (grid[dy][dx] === TILE.CORRIDOR) {
              // Verify this corridor cell is adjacent to a floor cell inside the room
              var adjFloor = false;
              var neighbors = [
                { nx: dx - 1, ny: dy }, { nx: dx + 1, ny: dy },
                { nx: dx, ny: dy - 1 }, { nx: dx, ny: dy + 1 },
              ];
              for (var ni = 0; ni < neighbors.length; ni++) {
                var n = neighbors[ni];
                if (n.nx >= room.x && n.nx < room.x + room.w &&
                    n.ny >= room.y && n.ny < room.y + room.h) {
                  adjFloor = true;
                  break;
                }
              }
              if (adjFloor) {
                grid[dy][dx] = TILE.DOOR;
                doorCount++;
              }
            }
          }
        }
      }
    }
  }

  // Place STAIRS_UP in first room center, STAIRS_DOWN in last room center
  var firstRoom = rooms[0];
  var lastRoom = rooms[rooms.length - 1];
  grid[firstRoom.centerY][firstRoom.centerX] = TILE.STAIRS_UP;

  if (floorNum === 1) {
    grid[firstRoom.centerY][firstRoom.centerX] = TILE.ENTRANCE;
  }

  grid[lastRoom.centerY][lastRoom.centerX] = TILE.STAIRS_DOWN;

  // If boss floor, replace a door in the last room with BOSS_DOOR
  if (isBossFloor) {
    grid[lastRoom.centerY][lastRoom.centerX] = TILE.EXIT;
    var bossDoored = false;
    for (var bdy = lastRoom.y - 1; bdy <= lastRoom.y + lastRoom.h && !bossDoored; bdy++) {
      for (var bdx = lastRoom.x - 1; bdx <= lastRoom.x + lastRoom.w && !bossDoored; bdx++) {
        if (bdy >= 0 && bdy < height && bdx >= 0 && bdx < width) {
          if (grid[bdy][bdx] === TILE.DOOR) {
            grid[bdy][bdx] = TILE.BOSS_DOOR;
            bossDoored = true;
          }
        }
      }
    }
  }

  // Determine enemy tier based on floor depth
  var enemyTier;
  if (isBossFloor) {
    enemyTier = 'boss';
  } else if (floorNum <= 3) {
    enemyTier = 'shallow';
  } else if (floorNum <= 7) {
    enemyTier = 'mid';
  } else {
    enemyTier = 'deep';
  }

  // Allow forced enemy pool from world dungeons (opts.enemyPool overrides theme-based)
  var effectivePoolTheme = (opts.enemyPool && ENEMY_POOLS[opts.enemyPool]) ? opts.enemyPool : theme;
  var pool = ENEMY_POOLS[effectivePoolTheme] || getEnemyPool(theme);

  // Place enemies, chests, traps, NPCs per room
  var enemies = [];
  var chests = [];
  var traps = [];
  var npcs = [];
  var campSpots = [];
  var corpses = [];
  var campsPlaced = 0;

  for (var ri2 = 0; ri2 < rooms.length; ri2++) {
    var rm = rooms[ri2];
    var isFirstRoom = (ri2 === 0);
    var isLastRoom = (ri2 === rooms.length - 1);

    // Skip enemy placement in the entrance room
    if (isFirstRoom) {
      // Place a camp spot in the first room (rift only)
      if (type === 'rift' && campsPlaced < CAMP_CONFIG.maxCampsPerFloor) {
        var campX = rm.x + 1 + Math.floor(rng() * (rm.w - 2));
        var campY = rm.y + 1 + Math.floor(rng() * (rm.h - 2));
        if (grid[campY][campX] === TILE.FLOOR) {
          grid[campY][campX] = TILE.CAMP_SPOT;
          campSpots.push({ x: campX, y: campY, roomIndex: ri2 });
          campsPlaced++;
        }
      }
      continue;
    }

    // Enemies: 2-5 per room (boss room on boss floor gets boss enemy)
    if (isLastRoom && isBossFloor) {
      var bossTemplates = pool.boss;
      if (bossTemplates && bossTemplates.length > 0) {
        var bossTemplate = bossTemplates[Math.floor(rng() * bossTemplates.length)];
        var boss = scaleBoss(bossTemplate, floorNum, effectivePoolTheme);

        // Apply difficulty scaling to boss
        if (difficulty.id !== 'standard') {
          boss.hp = Math.floor(boss.hp * difficulty.hpMult);
          boss.maxHp = boss.hp;
          boss.atk = Math.floor(boss.atk * difficulty.atkMult);
          boss.def = Math.floor(boss.def * difficulty.defMult);
          boss.xp = Math.floor(boss.xp * difficulty.xpMult);
          boss.gold = Math.floor(boss.gold * difficulty.goldMult);
        }

        boss.x = rm.centerX;
        boss.y = rm.centerY + 1;
        if (boss.y >= rm.y + rm.h) boss.y = rm.centerY;
        boss.difficulty = difficulty.id;
        enemies.push(boss);
      }
    } else {
      var tierEnemies = pool[enemyTier];
      if (!tierEnemies || tierEnemies.length === 0) tierEnemies = pool.shallow;
      var enemyCount = 2 + Math.floor(rng() * 4); // 2-5
      for (var ec = 0; ec < enemyCount; ec++) {
        var et = tierEnemies[Math.floor(rng() * tierEnemies.length)];
        var enemy = scaleEnemy(et, floorNum, effectivePoolTheme);

        // Rank promotion: roll for elite/rare/champion based on difficulty
        var rankRoll = rng();
        if (rankRoll < difficulty.championChance) {
          promoteEnemy(enemy, 'champion', null, rng);
        } else if (rankRoll < difficulty.championChance + difficulty.rareChance) {
          promoteEnemy(enemy, 'rare', null, rng);
        } else if (rankRoll < difficulty.championChance + difficulty.rareChance + difficulty.eliteChance) {
          promoteEnemy(enemy, 'elite', null, rng);
        }

        // Apply difficulty stat scaling
        if (difficulty.id !== 'standard') {
          enemy.hp = Math.floor(enemy.hp * difficulty.hpMult);
          enemy.maxHp = enemy.hp;
          enemy.atk = Math.floor(enemy.atk * difficulty.atkMult);
          enemy.def = Math.floor(enemy.def * difficulty.defMult);
          enemy.xp = Math.floor(enemy.xp * difficulty.xpMult);
          enemy.gold = Math.floor(enemy.gold * difficulty.goldMult);
        }

        // Place within room bounds (avoid center which might have stairs)
        enemy.x = rm.x + 1 + Math.floor(rng() * (rm.w - 2));
        enemy.y = rm.y + 1 + Math.floor(rng() * (rm.h - 2));
        enemies.push(enemy);
      }
    }

    // Chests: 0-1 per room (higher chance deeper)
    var chestChance = 0.15 + floorNum * 0.02;
    if (chestChance > 0.60) chestChance = 0.60;
    if (rng() < chestChance) {
      var chestX = rm.x + 1 + Math.floor(rng() * (rm.w - 2));
      var chestY = rm.y + 1 + Math.floor(rng() * (rm.h - 2));
      if (grid[chestY][chestX] === TILE.FLOOR) {
        grid[chestY][chestX] = TILE.CHEST;

        // Determine loot tier
        var tierRoll = rng();
        var lootTier;
        if (tierRoll < 0.50)      lootTier = 'common';
        else if (tierRoll < 0.80) lootTier = 'uncommon';
        else if (tierRoll < 0.95) lootTier = 'rare';
        else                      lootTier = 'legendary';

        var lootDef = CHEST_LOOT[lootTier];
        var chestGold = lootDef.goldMin + Math.floor(rng() * (lootDef.goldMax - lootDef.goldMin + 1));
        var chestResource = lootDef.resources[Math.floor(rng() * lootDef.resources.length)];
        var chestCard = rng() < lootDef.cardChance;

        chests.push({
          x: chestX,
          y: chestY,
          tier: lootTier,
          gold: chestGold,
          resource: chestResource,
          resourceAmount: 1 + Math.floor(rng() * 3),
          hasCard: chestCard,
          roomIndex: ri2,
          opened: false,
        });
      }
    }

    // Traps: 0-1 per room (deeper floors = more traps)
    var trapChance = 0.10 + floorNum * 0.015;
    if (trapChance > 0.45) trapChance = 0.45;
    if (rng() < trapChance) {
      var trapX = rm.x + 1 + Math.floor(rng() * (rm.w - 2));
      var trapY = rm.y + 1 + Math.floor(rng() * (rm.h - 2));
      if (grid[trapY][trapX] === TILE.FLOOR) {
        grid[trapY][trapX] = TILE.TRAP;
        var trapTypeKey = TRAP_TYPE_KEYS[Math.floor(rng() * TRAP_TYPE_KEYS.length)];
        var trapTypeDef = TRAP_TYPES[trapTypeKey];
        traps.push({
          x: trapX,
          y: trapY,
          type: trapTypeKey,
          name: trapTypeDef.name,
          damage: Math.floor(getTrapDamage(floorNum) * trapTypeDef.damageFactor),
          effect: trapTypeDef.effect || null,
          effectDuration: trapTypeDef.effectDuration || 0,
          tickDamage: trapTypeDef.tickDamage || 0,
          roomIndex: ri2,
          triggered: false,
        });
      }
    }

    // NPCs: 10% chance per room
    if (rng() < 0.10) {
      var npcTemplate = DUNGEON_NPCS[Math.floor(rng() * DUNGEON_NPCS.length)];
      var npcX = rm.x + 1 + Math.floor(rng() * (rm.w - 2));
      var npcY = rm.y + 1 + Math.floor(rng() * (rm.h - 2));
      npcs.push({
        id: npcTemplate.id,
        name: npcTemplate.name,
        dialogue: npcTemplate.dialogue,
        reward: npcTemplate.reward,
        questHook: npcTemplate.questHook,
        x: npcX,
        y: npcY,
        roomIndex: ri2,
        interacted: false,
      });
    }

    // Camp spots: place in a mid-floor room (rift only)
    if (type === 'rift' && campsPlaced < CAMP_CONFIG.maxCampsPerFloor) {
      var midRoom = Math.floor(rooms.length / 2);
      if (ri2 === midRoom) {
        var cx2 = rm.x + 1 + Math.floor(rng() * (rm.w - 2));
        var cy2 = rm.y + 1 + Math.floor(rng() * (rm.h - 2));
        if (grid[cy2][cx2] === TILE.FLOOR) {
          grid[cy2][cx2] = TILE.CAMP_SPOT;
          campSpots.push({ x: cx2, y: cy2, roomIndex: ri2 });
          campsPlaced++;
        }
      }
    }

    // Corpses / dead adventurers: 0-1 per room (no corpses on boss floors)
    if (!isBossFloor) {
      var corpseChance = 0.08 + floorNum * 0.01;
      if (corpseChance > 0.30) corpseChance = 0.30;
      if (rng() < corpseChance) {
        var corpseX = rm.x + 1 + Math.floor(rng() * (rm.w - 2));
        var corpseY = rm.y + 1 + Math.floor(rng() * (rm.h - 2));
        if (grid[corpseY][corpseX] === TILE.FLOOR) {
          grid[corpseY][corpseX] = TILE.CORPSE;
          // Select template: prefer theme-affinity matches
          var corpsePool = [];
          for (var cpi = 0; cpi < DUNGEON_CORPSES.length; cpi++) {
            var ct = DUNGEON_CORPSES[cpi];
            if (ct.themeAffinity === null || ct.themeAffinity.indexOf(theme) >= 0) {
              corpsePool.push(ct);
            }
          }
          if (corpsePool.length === 0) corpsePool = DUNGEON_CORPSES;
          var corpseTemplate = corpsePool[Math.floor(rng() * corpsePool.length)];
          // Scale gold with floor depth
          var corpseGoldMin = corpseTemplate.goldMin + (floorNum >= 10 ? Math.floor(floorNum * 0.5) : 0);
          var corpseGoldMax = corpseTemplate.goldMax + (floorNum >= 10 ? Math.floor(floorNum * 1.0) : 0);
          var corpseGold = corpseGoldMin + Math.floor(rng() * (corpseGoldMax - corpseGoldMin + 1));
          // Resource roll
          var corpseResource = null;
          var corpseResourceAmt = 0;
          if (rng() < corpseTemplate.resourceChance) {
            corpseResource = corpseTemplate.resources[Math.floor(rng() * corpseTemplate.resources.length)];
            corpseResourceAmt = 1 + Math.floor(rng() * 2);
            // Deeper floors: rarer resources from template pool
            if (floorNum >= 20 && corpseTemplate.resources.length > 1) {
              corpseResource = corpseTemplate.resources[Math.floor(rng() * corpseTemplate.resources.length)];
              corpseResourceAmt += 1;
            }
          }
          var corpseHasCard = rng() < corpseTemplate.cardChance;
          corpses.push({
            x: corpseX,
            y: corpseY,
            id: corpseTemplate.id,
            name: corpseTemplate.name,
            description: corpseTemplate.description,
            gold: corpseGold,
            resource: corpseResource,
            resourceAmount: corpseResourceAmt,
            hasCard: corpseHasCard,
            bookChanceMult: corpseTemplate.bookChanceMult,
            roomIndex: ri2,
            examined: false,
          });
        }
      }
    }
  }

  // Special events: 1% chance per floor
  var specialEvent = null;
  if (rng() < 0.01) {
    specialEvent = SPECIAL_EVENTS[Math.floor(rng() * SPECIAL_EVENTS.length)];
  }

  // Floor modifier: rolled per floor (none on floors 1-3)
  var floorModifier = selectFloorModifier(rng, floorNum);

  // Cap invisible enemies: 0 on floors 1-2, max 2 on floors 3+
  // Remove invisibility from excess enemies (convert them to normal enemies)
  if (floorNum < 3) {
    for (var ivi = 0; ivi < enemies.length; ivi++) {
      if (enemies[ivi].invisibility) enemies[ivi].invisibility = null;
    }
  } else {
    var invisCount = 0;
    var MAX_INVISIBLE_PER_FLOOR = 2;
    for (var ivi2 = 0; ivi2 < enemies.length; ivi2++) {
      if (enemies[ivi2].invisibility) {
        invisCount++;
        if (invisCount > MAX_INVISIBLE_PER_FLOOR) {
          enemies[ivi2].invisibility = null;
        }
      }
    }
  }

  // Build the floor object (without form interactables/animals yet — they need the full floor ref)
  var floorObj = {
    floorNum:     floorNum,
    seed:         floorSeed,
    type:         type,
    theme:        theme,
    layout:       layout,
    themeColors:  THEME_COLORS[theme] || THEME_COLORS.stone_keep,
    sizeKey:      sizeKey,
    width:        width,
    height:       height,
    grid:         grid,
    rooms:        rooms,
    enemies:      enemies,
    chests:       chests,
    traps:        traps,
    npcs:         npcs,
    corpses:      corpses,
    campSpots:    campSpots,
    isBossFloor:  isBossFloor,
    isRaidBossFloor: isRaidBossFloor,
    specialEvent: specialEvent,
    floorModifier: floorModifier,
    stairsUp:     { x: firstRoom.centerX, y: firstRoom.centerY },
    stairsDown:   { x: lastRoom.centerX, y: lastRoom.centerY },
    formInteractables: [],
    animalNpcs:   [],
  };

  // Generate form-gated interactables (1-3 per floor, floors 2+)
  floorObj.formInteractables = generateFormInteractables(floorObj, rng);

  // Generate ambient animal NPCs (0-2 per floor)
  floorObj.animalNpcs = generateAnimalNpcs(floorObj, rng);

  return floorObj;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Overworld arena generation — small arenas for FF-style instanced combat
// ---------------------------------------------------------------------------

function generateOverworldArena(biomeId, seed) {
  var ARENA_W = 16;
  var ARENA_H = 12;
  var rng = seededRandom(typeof seed === 'string' ? chunkSeed(0, 0, seed) : (seed || 1));

  var result = generateArenaLayout(ARENA_W, ARENA_H, rng, 1, 1);
  var grid = result.grid;
  var rooms = result.rooms;

  // Pick theme from biome — seeded random from full biome theme list for variety
  var biomeThemes = BIOME_DUNGEON_THEMES[biomeId] || ['stone_keep'];
  var themeName = biomeThemes[Math.floor(rng() * biomeThemes.length)] || 'stone_keep';
  var themeColors = THEME_COLORS[themeName] || THEME_COLORS.stone_keep;

  // Central room is always rooms[0]
  var central = rooms[0] || { x: 2, y: 2, w: 12, h: 8, centerX: 8, centerY: 6 };

  // Player entrance: bottom-center of central room
  var entranceX = central.centerX;
  var entranceY = central.y + central.h - 2;
  if (entranceY >= ARENA_H) entranceY = ARENA_H - 2;
  // Ensure entrance tile is floor
  if (grid[entranceY] && grid[entranceY][entranceX] !== TILE.FLOOR) {
    grid[entranceY][entranceX] = TILE.FLOOR;
  }

  // Enemy spawn: top-center of central room
  var enemyX = central.centerX;
  var enemyY = central.y + 1;
  if (enemyY < 0) enemyY = 1;
  if (grid[enemyY] && grid[enemyY][enemyX] !== TILE.FLOOR) {
    grid[enemyY][enemyX] = TILE.FLOOR;
  }

  return {
    grid: grid,
    themeColors: themeColors,
    themeName: themeName,
    rooms: rooms,
    width: ARENA_W,
    height: ARENA_H,
    entranceX: entranceX,
    entranceY: entranceY,
    enemyX: enemyX,
    enemyY: enemyY,
  };
}

// ---------------------------------------------------------------------------
// Overworld Structures — imported from dungeon-structures.js
// ---------------------------------------------------------------------------

var _structureData = require('./dungeon-structures');
var STRUCTURE_TYPES = _structureData.STRUCTURE_TYPES;
var STRUCTURE_ENEMY_POOLS = _structureData.STRUCTURE_ENEMY_POOLS;

// Register structure enemy pools into the main ENEMY_POOLS table so generateFloor()
// can resolve them via opts.enemyPool the same way world dungeons do.
var _structPoolKeys = Object.keys(STRUCTURE_ENEMY_POOLS);
for (var _spi = 0; _spi < _structPoolKeys.length; _spi++) {
  var _spk = _structPoolKeys[_spi];
  if (!ENEMY_POOLS[_spk]) {
    ENEMY_POOLS[_spk] = STRUCTURE_ENEMY_POOLS[_spk];
  }
}

// ---------------------------------------------------------------------------
// generateStructureFloor — wrapper around generateFloor() for overworld structures
// ---------------------------------------------------------------------------

/**
 * Generate a floor for an overworld structure dungeon.
 * @param {object} structDef - A STRUCTURE_TYPES entry (e.g. STRUCTURE_TYPES.BANDIT_CAMP)
 * @param {number} floorNum - Floor number (1-based)
 * @param {string} seed - Unique seed for this structure instance (e.g. structure ID)
 * @param {number} totalFloors - Total floors for this instance
 * @returns {object} floor object (same shape as generateFloor output)
 */
function generateStructureFloor(structDef, floorNum, seed, totalFloors) {
  if (!structDef) return null;
  totalFloors = totalFloors || structDef.floors.max;

  // Pick theme deterministically: use the structure's themes list
  var themeRng = seededRandom(chunkSeed(floorNum, 0, STRUCTURE_SEED_PREFIX + seed + ':theme'));
  var theme = structDef.themes[Math.floor(themeRng() * structDef.themes.length)];

  // Generate using the standard pipeline — type 'cave' for finite sizing
  var floor = generateFloor(floorNum, STRUCTURE_SEED_PREFIX + seed, {
    type: 'cave',
    isRift: false,
    biome: (structDef.biomes && structDef.biomes.length > 0) ? structDef.biomes[0] : 6,
    totalFloors: totalFloors,
    theme: theme,
    enemyPool: structDef.enemyPool,
    themeSeed: STRUCTURE_SEED_PREFIX + seed,
  });

  // Apply xp multiplier to all enemies
  if (floor && structDef.xpMultiplier && structDef.xpMultiplier !== 1.0) {
    for (var ei = 0; ei < floor.enemies.length; ei++) {
      floor.enemies[ei].xp = Math.floor((floor.enemies[ei].xp || 10) * structDef.xpMultiplier);
    }
  }

  // Apply loot tier bias to chests for structure difficulty
  if (floor && structDef.lootTier) {
    var tierBias = structDef.lootTier;
    for (var ci = 0; ci < floor.chests.length; ci++) {
      // Upgrade chests based on structure loot tier
      if (tierBias === 'uncommon' && floor.chests[ci].tier === 'common') {
        if (themeRng() < 0.4) floor.chests[ci].tier = 'uncommon';
      } else if (tierBias === 'rare') {
        if (floor.chests[ci].tier === 'common' && themeRng() < 0.5) floor.chests[ci].tier = 'uncommon';
        if (floor.chests[ci].tier === 'uncommon' && themeRng() < 0.3) floor.chests[ci].tier = 'rare';
      }
    }
  }

  // Mark rescuable NPCs if the structure type has them
  if (floor && structDef.rescueNpcs) {
    // Add a rescuable NPC to a mid-room if one doesn't already exist
    var rescueRng = seededRandom(chunkSeed(floorNum, 1, STRUCTURE_SEED_PREFIX + seed + ':rescue'));
    if (rescueRng() < 0.6 && floor.rooms.length > 2) {
      var rescueRoomIdx = 1 + Math.floor(rescueRng() * (floor.rooms.length - 2));
      var rescueRoom = floor.rooms[rescueRoomIdx];
      var rNpcX = rescueRoom.x + 1 + Math.floor(rescueRng() * Math.max(1, rescueRoom.w - 2));
      var rNpcY = rescueRoom.y + 1 + Math.floor(rescueRng() * Math.max(1, rescueRoom.h - 2));
      floor.npcs.push({
        id: 'captive_villager_' + floorNum,
        name: 'Captive Villager',
        dialogue: 'Thank the gods you found me! Please, take this as thanks for my rescue.',
        reward: { gold: 20 + floorNum * 10, xp: 30 + floorNum * 15 },
        questHook: null,
        x: rNpcX,
        y: rNpcY,
        roomIndex: rescueRoomIdx,
        interacted: false,
        rescuable: true,
      });
    }
  }

  return floor;
}

// ---------------------------------------------------------------------------
// Mini-Rift floor generation
// ---------------------------------------------------------------------------
// Themes progress: floors 1-5 hollow_breach, 6-14 shattered_veil, 15-20 desperation_core
// Final floor always ARENA layout with boss. Enemy stats scale with tier.

var MINI_RIFT_TIER_TABLE = [
  { maxFloors: 7,  tier: 1, difficulty: 'easy',    lootTier: 'uncommon',   xpMult: 1.2, minLevel: 5,  corruptionRadius: 3, lifetimeH: 4 },
  { maxFloors: 10, tier: 2, difficulty: 'medium',   lootTier: 'uncommon',   xpMult: 1.4, minLevel: 10, corruptionRadius: 4, lifetimeH: 5 },
  { maxFloors: 14, tier: 3, difficulty: 'hard',     lootTier: 'rare',       xpMult: 1.6, minLevel: 15, corruptionRadius: 5, lifetimeH: 6 },
  { maxFloors: 17, tier: 4, difficulty: 'hard',     lootTier: 'rare',       xpMult: 1.8, minLevel: 20, corruptionRadius: 5, lifetimeH: 7 },
  { maxFloors: 20, tier: 5, difficulty: 'extreme',  lootTier: 'ultra_rare', xpMult: 2.0, minLevel: 25, corruptionRadius: 6, lifetimeH: 8 },
];

var MINI_RIFT_BOSS_REWARDS = [
  { tier: 1, gold: 75,  darkCrystal: 3, purificationCrystal: 1, cardPacks: 1, xpBonus: 200 },
  { tier: 2, gold: 100, darkCrystal: 4, purificationCrystal: 1, cardPacks: 1, xpBonus: 400 },
  { tier: 3, gold: 150, darkCrystal: 5, purificationCrystal: 2, cardPacks: 2, xpBonus: 700 },
  { tier: 4, gold: 200, darkCrystal: 6, purificationCrystal: 2, cardPacks: 2, xpBonus: 1000 },
  { tier: 5, gold: 300, darkCrystal: 7, purificationCrystal: 3, cardPacks: 3, xpBonus: 1500 },
];

function getMiniRiftTier(totalFloors) {
  for (var i = 0; i < MINI_RIFT_TIER_TABLE.length; i++) {
    if (totalFloors <= MINI_RIFT_TIER_TABLE[i].maxFloors) return MINI_RIFT_TIER_TABLE[i];
  }
  return MINI_RIFT_TIER_TABLE[MINI_RIFT_TIER_TABLE.length - 1];
}

function getMiniRiftBossRewards(tier) {
  if (tier >= 1 && tier <= MINI_RIFT_BOSS_REWARDS.length) return MINI_RIFT_BOSS_REWARDS[tier - 1];
  return MINI_RIFT_BOSS_REWARDS[0];
}

function generateMiniRiftFloor(riftDef, floorNum, seed, totalFloors) {
  if (!riftDef) return null;
  totalFloors = totalFloors || riftDef.totalFloors || 10;

  // Select theme based on floor depth
  var theme;
  if (floorNum <= 5) theme = 'hollow_breach';
  else if (floorNum <= 14) theme = 'shattered_veil';
  else theme = 'desperation_core';

  var isFinalFloor = (floorNum === totalFloors);
  var tierInfo = getMiniRiftTier(totalFloors);
  var tierScale = 0.8 + (tierInfo.tier * 0.15);

  // Generate using the standard pipeline — type 'cave' for finite sizing
  var floor = generateFloor(floorNum, MINI_RIFT_SEED_PREFIX + seed, {
    type: 'cave',
    isRift: false,
    biome: 12, // WASTES — void terrain
    totalFloors: totalFloors,
    theme: theme,
    enemyPool: 'hollow_breach',
    themeSeed: MINI_RIFT_SEED_PREFIX + seed,
  });

  if (!floor) return null;

  // Scale enemy HP/ATK by tier
  for (var ei = 0; ei < floor.enemies.length; ei++) {
    var e = floor.enemies[ei];
    e.hp = Math.floor((e.hp || 30) * tierScale);
    e.atk = Math.floor((e.atk || 8) * tierScale);
    e.xp = Math.floor((e.xp || 10) * tierInfo.xpMult);
    e.gold = Math.floor((e.gold || 5) * tierScale);
  }

  // Upgrade chests based on rift loot tier
  var themeRng = seededRandom(chunkSeed(floorNum, 0, MINI_RIFT_SEED_PREFIX + seed + ':loot'));
  if (tierInfo.lootTier) {
    for (var ci = 0; ci < floor.chests.length; ci++) {
      if (tierInfo.lootTier === 'uncommon' && floor.chests[ci].tier === 'common') {
        if (themeRng() < 0.5) floor.chests[ci].tier = 'uncommon';
      } else if (tierInfo.lootTier === 'rare') {
        if (floor.chests[ci].tier === 'common' && themeRng() < 0.6) floor.chests[ci].tier = 'uncommon';
        if (floor.chests[ci].tier === 'uncommon' && themeRng() < 0.35) floor.chests[ci].tier = 'rare';
      } else if (tierInfo.lootTier === 'ultra_rare') {
        if (floor.chests[ci].tier === 'common') floor.chests[ci].tier = 'uncommon';
        if (floor.chests[ci].tier === 'uncommon' && themeRng() < 0.5) floor.chests[ci].tier = 'rare';
        if (floor.chests[ci].tier === 'rare' && themeRng() < 0.2) floor.chests[ci].tier = 'ultra_rare';
      }
    }
  }

  // Tag floor with mini-rift metadata
  floor.isMiniRift = true;
  floor.riftTier = tierInfo.tier;
  floor.isFinalFloor = isFinalFloor;

  return floor;
}

module.exports = {
  // Constants
  RIFT_SEED_PREFIX,
  CAVE_SEED_PREFIX,
  WORLD_DUNGEON_SEED_PREFIX,
  MINI_RIFT_SEED_PREFIX,
  MAX_FLOOR_CACHE,
  TILE_SIZE,
  RIFT_FLOOR_SIZE,
  CAVE_FLOOR_SIZE,
  RAID_FLOOR_SIZE,
  CAVE_FLOORS_BY_BIOME,
  BIOME_DUNGEON_THEMES,

  // Tiles
  TILE,

  // Themes
  CASTLE_THEMES,
  WILD_THEMES,
  THEME_COLORS,

  // Enemies
  ENEMY_DEFAULTS,
  ENEMY_POOLS,
  THEME_POOL_FALLBACK,
  THEME_ELEMENT_MAP,
  THEME_COMBAT_PROPERTIES,
  getEnemyPool,
  inferArchetype,
  scaleEnemy,

  // Boss Mechanics
  BOSS_MECHANICS,
  BOSS_MECHANIC_MAP,

  // Enemy Ranks & Class Templates
  ENEMY_RANKS,
  CLASS_TEMPLATES,
  CLASS_TEMPLATE_KEYS,
  promoteEnemy,

  // Difficulty
  DIFFICULTY_TIERS,
  scaleBoss,

  // Loot
  CHEST_LOOT,
  ENEMY_LOOT,
  THEME_BONUS_LOOT,
  rollEnemyLoot,
  getTrapDamage,

  // Traps
  TRAP_TYPES,
  TRAP_TYPE_KEYS,

  // Events, NPCs, Corpses & Floor Modifiers
  SPECIAL_EVENTS,
  DUNGEON_NPCS,
  DUNGEON_CORPSES,
  FLOOR_MODIFIERS,
  selectFloorModifier,

  // Progression
  GUILD_RANKS,
  QUEST_TEMPLATES,

  // Camp
  CAMP_CONFIG,

  // Dungeon Skill Perks
  DUNGEON_SKILL_PERKS,
  getDungeonSkillBonuses,

  // Layout system
  FLOOR_LAYOUTS,
  THEME_LAYOUT_MAP,
  selectLayout,

  // Generation functions
  getThemeForFloor,
  getCaveDepth,
  generateDailyQuests,
  generateFloor,
  generateOceanArenaLayout,
  generateOverworldArena,

  // Animal morphing exploration
  FORM_INTERACTABLES,
  FORM_INTERACTABLE_KEYS,
  THEME_FORM_INTERACTABLE_WEIGHTS,
  selectFormInteractable,
  generateFormInteractables,
  DUNGEON_ANIMALS,
  ANIMAL_SPEAK_CATEGORIES,
  ANIMAL_DIALOGUES,
  ANIMAL_DIALOGUE_DEFAULT,
  getAnimalDialogue,
  generateAnimalNpcs,

  // Overworld Structures
  STRUCTURE_SEED_PREFIX,
  STRUCTURE_TYPES,
  STRUCTURE_ENEMY_POOLS,
  generateStructureFloor,

  // Mini-Rift system
  MINI_RIFT_SEED_PREFIX,
  MINI_RIFT_TIER_TABLE,
  MINI_RIFT_BOSS_REWARDS,
  getMiniRiftTier,
  getMiniRiftBossRewards,
  generateMiniRiftFloor,
};
