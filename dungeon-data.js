// dungeon-data.js
// Dungeon generation data and algorithms for rift dungeons and biome caves.
// Enemy pools, loot tables, quest templates, guild ranks, floor assembly.
// Layout generators live in dungeon-layouts.js.
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

var dungeonLayouts = require('./dungeon-layouts');
dungeonLayouts.init({ TILE: TILE });
var generateLayoutForFloor = dungeonLayouts.generateLayoutForFloor;
var generateArenaLayout = dungeonLayouts.generateArenaLayout;
var generateOceanArenaLayout = dungeonLayouts.generateOceanArenaLayout;

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
// Flood-fill connectivity check — verifies start tile can reach target tile
// ---------------------------------------------------------------------------

var _WALKABLE_FOR_FLOOD = {};
_WALKABLE_FOR_FLOOD[TILE.FLOOR] = true;
_WALKABLE_FOR_FLOOD[TILE.CORRIDOR] = true;
_WALKABLE_FOR_FLOOD[TILE.DOOR] = true;
_WALKABLE_FOR_FLOOD[TILE.STAIRS_UP] = true;
_WALKABLE_FOR_FLOOD[TILE.STAIRS_DOWN] = true;
_WALKABLE_FOR_FLOOD[TILE.ENTRANCE] = true;
_WALKABLE_FOR_FLOOD[TILE.EXIT] = true;
_WALKABLE_FOR_FLOOD[TILE.CHEST] = true;
_WALKABLE_FOR_FLOOD[TILE.TRAP] = true;
_WALKABLE_FOR_FLOOD[TILE.CAMP_SPOT] = true;
_WALKABLE_FOR_FLOOD[TILE.SHRINE] = true;
_WALKABLE_FOR_FLOOD[TILE.BOSS_DOOR] = true;
_WALKABLE_FOR_FLOOD[TILE.SHORTCUT] = true;
_WALKABLE_FOR_FLOOD[TILE.CORPSE] = true;

function _floodFillConnected(grid, width, height, sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return true;
  var visited = {};
  var queue = [sx + sy * width];
  visited[sx + ',' + sy] = true;
  var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  while (queue.length > 0) {
    var idx = queue.shift();
    var cx = idx % width;
    var cy = (idx - cx) / width;
    for (var d = 0; d < 4; d++) {
      var nx = cx + dirs[d][0];
      var ny = cy + dirs[d][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      var nk = nx + ',' + ny;
      if (visited[nk]) continue;
      if (!_WALKABLE_FOR_FLOOD[grid[ny][nx]]) continue;
      if (nx === tx && ny === ty) return true;
      visited[nk] = true;
      queue.push(nx + ny * width);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// generateFloor — layout-aware floor generation with enemies, chests, traps, NPCs
// Wrapped with connectivity retry: regenerates with incremented seed if
// stairs_up cannot reach stairs_down (max 3 retries).
// ---------------------------------------------------------------------------

var MAX_FLOOR_RETRIES = 3;

function generateFloor(floorNum, seed, options) {
  for (var _retry = 0; _retry <= MAX_FLOOR_RETRIES; _retry++) {
    var _effectiveSeed = _retry === 0 ? seed : seed + _retry;
    var result = _generateFloorInner(floorNum, _effectiveSeed, options);
    // Connectivity check: can stairs_up reach stairs_down?
    var su = result.stairsUp;
    var sd = result.stairsDown;
    if (_floodFillConnected(result.grid, result.width, result.height, su.x, su.y, sd.x, sd.y)) {
      return result;
    }
  }
  // All retries exhausted — return last attempt anyway
  return _generateFloorInner(floorNum, seed + MAX_FLOOR_RETRIES + 1, options);
}

function _generateFloorInner(floorNum, seed, options) {
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
    // Fallback: if no DOOR found, carve one at the room edge
    if (!bossDoored) {
      var bdFx = lastRoom.x;
      var bdFy = lastRoom.centerY;
      if (bdFx > 0) bdFx = lastRoom.x - 1;
      if (bdFx >= 0 && bdFx < width && bdFy >= 0 && bdFy < height) {
        grid[bdFy][bdFx] = TILE.BOSS_DOOR;
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

  // Per-visit spawn entropy: mix visitCount into the RNG stream so that
  // enemy/entity placement varies each time the floor is regenerated (after
  // LRU eviction or daily reset) while the layout (grid, rooms, doors) stays
  // deterministic from the base seed.
  var visitCount = opts.visitCount || 0;
  if (visitCount > 0) {
    var spawnSeed = chunkSeed(floorSeed, visitCount, 'spawn_entropy');
    rng = seededRandom(spawnSeed);
  }

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
      // Place a camp spot in the first room (rift only) — retry up to 5 times
      if (type === 'rift' && campsPlaced < CAMP_CONFIG.maxCampsPerFloor) {
        for (var _campRetry = 0; _campRetry < 5; _campRetry++) {
          var campX = rm.x + 1 + Math.floor(rng() * (rm.w - 2));
          var campY = rm.y + 1 + Math.floor(rng() * (rm.h - 2));
          if (grid[campY][campX] === TILE.FLOOR) {
            grid[campY][campX] = TILE.CAMP_SPOT;
            campSpots.push({ x: campX, y: campY, roomIndex: ri2 });
            campsPlaced++;
            break;
          }
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

    // Camp spots: place in a mid-floor room (rift only) — retry up to 5 times
    if (type === 'rift' && campsPlaced < CAMP_CONFIG.maxCampsPerFloor) {
      var midRoom = Math.floor(rooms.length / 2);
      if (ri2 === midRoom) {
        for (var _campRetry2 = 0; _campRetry2 < 5; _campRetry2++) {
          var cx2 = rm.x + 1 + Math.floor(rng() * (rm.w - 2));
          var cy2 = rm.y + 1 + Math.floor(rng() * (rm.h - 2));
          if (grid[cy2][cx2] === TILE.FLOOR) {
            grid[cy2][cx2] = TILE.CAMP_SPOT;
            campSpots.push({ x: cx2, y: cy2, roomIndex: ri2 });
            campsPlaced++;
            break;
          }
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

  // Deconflict enemy positions — no two enemies on the same tile
  var _occupiedTiles = {};
  for (var _dci = 0; _dci < enemies.length; _dci++) {
    var _ek = enemies[_dci].x + ',' + enemies[_dci].y;
    if (_occupiedTiles[_ek] || grid[enemies[_dci].y][enemies[_dci].x] !== TILE.FLOOR) {
      // Nudge to an adjacent FLOOR tile that isn't occupied
      var _nudged = false;
      var _dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
      for (var _nd = 0; _nd < _dirs.length && !_nudged; _nd++) {
        var _nx = enemies[_dci].x + _dirs[_nd][0];
        var _ny = enemies[_dci].y + _dirs[_nd][1];
        var _nk = _nx + ',' + _ny;
        if (_nx >= 0 && _nx < width && _ny >= 0 && _ny < height &&
            grid[_ny][_nx] === TILE.FLOOR && !_occupiedTiles[_nk]) {
          enemies[_dci].x = _nx;
          enemies[_dci].y = _ny;
          _occupiedTiles[_nk] = true;
          _nudged = true;
        }
      }
      if (!_nudged) {
        // Can't place — mark at current position anyway (rare edge case)
        _occupiedTiles[_ek] = true;
      }
    } else {
      _occupiedTiles[_ek] = true;
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
