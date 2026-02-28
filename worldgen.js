// worldgen.js
// Chunk-based world generation for MMOLite
// Massive world: 2000x2500 chunks, 1 chunk = 5 km = 16 tiles of 32px
// Total world: 10,000 km x 12,500 km
// Lazy chunk generation — only visited chunks are generated
//
// Based on the fantasy continental map with named regions:
//   Frostbound Reach (62,500 sq km), Great Endless Desert (187,500 sq km),
//   Dwarven Mountains, Orcish Steppes, Holy Dominion, Shadowfen, Elven South,
//   Scorched Sands, Silver Seas, Gnomish Isles (22,000 sq km), Mechspire,
//   Clockwork Harbor, Wastes of Calidar (11,250 sq km), Southern Ocean,
//   Southern Wastes, Ashen Archipelago, Great Western Isle (30,000 sq km),
//   Northern Tundra, Shimmering Sea
//
// Reference origin (0,0) mapped to chunk (1000, 1250)
// 1 chunk = 5 km, matching the reference worldgen scale

const crypto = require('crypto');
var hollowEarth = require('./worldgen-hollow-earth');

// ---------------------------------------------------------------------------
// World dimensions & scale
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 512;     // pixels per chunk
const TILE_SIZE = 32;
const TILES_PER_CHUNK = CHUNK_SIZE / TILE_SIZE; // 16
const WORLD_CHUNKS_X = 2000;
const WORLD_CHUNKS_Y = 2500;
const WORLD_WIDTH = WORLD_CHUNKS_X * CHUNK_SIZE;   // 1,024,000
const WORLD_HEIGHT = WORLD_CHUNKS_Y * CHUNK_SIZE;  // 1,280,000

// World scale: 1 chunk = 1 reference tile = 5 km
const WORLD_SCALE = {
  kmPerChunk: 5,
  sqKmPerChunk: 25,
  milesPerChunk: 3.1,
  // Reference origin offset: ref(0,0) → chunk(1000,1250)
  originCX: 1000,
  originCY: 1250,
};

// ---------------------------------------------------------------------------
// Biome types
// ---------------------------------------------------------------------------

const BIOME = {
  WATER: 0,
  DESERT: 1,
  MOUNTAIN: 2,
  SCORCHED_SANDS: 3,
  STEPPES: 4,
  FOREST: 5,
  PLAINS: 6,
  SWAMP: 7,
  HOLY_DOMINION: 8,
  GNOMISH_ISLES: 9,
  MECHSPIRE: 10,
  CLOCKWORK_HARBOR: 11,
  WASTES: 12,
  BEACH: 13,
  FROSTBOUND: 14,
  SOUTHERN_WASTES: 15,
  ELVEN_SOUTH: 16,
};

const BIOME_NAMES = {
  [BIOME.WATER]: 'The Shimmering Sea',
  [BIOME.DESERT]: 'The Great Endless Desert',
  [BIOME.MOUNTAIN]: 'Dwarven Mountains',
  [BIOME.SCORCHED_SANDS]: 'The Scorched Sands',
  [BIOME.STEPPES]: 'Orcish Steppes',
  [BIOME.FOREST]: 'Wildlands',
  [BIOME.PLAINS]: 'The Green Plains',
  [BIOME.SWAMP]: 'Shadowfen',
  [BIOME.HOLY_DOMINION]: 'The Holy Dominion',
  [BIOME.GNOMISH_ISLES]: 'Gnomish Isles',
  [BIOME.MECHSPIRE]: 'Mechspire',
  [BIOME.CLOCKWORK_HARBOR]: 'Clockwork Harbor',
  [BIOME.WASTES]: 'Wastes of Calidar',
  [BIOME.BEACH]: 'Coastline',
  [BIOME.FROSTBOUND]: 'Frostbound Reach',
  [BIOME.SOUTHERN_WASTES]: 'The Southern Wastes',
  [BIOME.ELVEN_SOUTH]: 'Elven South',
};

// Biome colors for client rendering { r, g, b } (0-255)
const BIOME_COLORS = {
  [BIOME.WATER]: { r: 50, g: 85, b: 140 },
  [BIOME.DESERT]: { r: 210, g: 185, b: 125 },
  [BIOME.MOUNTAIN]: { r: 115, g: 105, b: 95 },
  [BIOME.SCORCHED_SANDS]: { r: 185, g: 145, b: 85 },
  [BIOME.STEPPES]: { r: 165, g: 175, b: 95 },
  [BIOME.FOREST]: { r: 35, g: 85, b: 35 },
  [BIOME.PLAINS]: { r: 115, g: 155, b: 65 },
  [BIOME.SWAMP]: { r: 55, g: 75, b: 45 },
  [BIOME.HOLY_DOMINION]: { r: 135, g: 155, b: 105 },
  [BIOME.GNOMISH_ISLES]: { r: 95, g: 135, b: 75 },
  [BIOME.MECHSPIRE]: { r: 125, g: 115, b: 105 },
  [BIOME.CLOCKWORK_HARBOR]: { r: 145, g: 135, b: 115 },
  [BIOME.WASTES]: { r: 155, g: 135, b: 100 },
  [BIOME.BEACH]: { r: 200, g: 190, b: 150 },
  [BIOME.FROSTBOUND]: { r: 200, g: 210, b: 225 },
  [BIOME.SOUTHERN_WASTES]: { r: 175, g: 150, b: 110 },
  [BIOME.ELVEN_SOUTH]: { r: 50, g: 110, b: 55 },
};

// Movement speed multiplier per biome (1.0 = full speed, 0 = impassable)
const BIOME_SPEED = {
  [BIOME.WATER]: 0,
  [BIOME.DESERT]: 0.5,
  [BIOME.MOUNTAIN]: 0.6,
  [BIOME.SCORCHED_SANDS]: 0.5,
  [BIOME.STEPPES]: 0.9,
  [BIOME.FOREST]: 0.8,
  [BIOME.PLAINS]: 1.0,
  [BIOME.SWAMP]: 0.6,
  [BIOME.HOLY_DOMINION]: 1.0,
  [BIOME.GNOMISH_ISLES]: 0.9,
  [BIOME.MECHSPIRE]: 0.9,
  [BIOME.CLOCKWORK_HARBOR]: 0.9,
  [BIOME.WASTES]: 0.4,
  [BIOME.BEACH]: 0.8,
  [BIOME.FROSTBOUND]: 0.3,
  [BIOME.SOUTHERN_WASTES]: 0.4,
  [BIOME.ELVEN_SOUTH]: 0.9,
};

// ---------------------------------------------------------------------------
// Sub-chunk terrain feature types (16x16 tile grid per chunk)
// ---------------------------------------------------------------------------

const FEATURE_NONE = 0;
const FEATURE_RIVER = 1;
const FEATURE_LAKE = 2;
const FEATURE_SHALLOW_WATER = 3;
const FEATURE_THICK_FOREST = 4;
const FEATURE_CAVE_ENTRANCE = 5;
const FEATURE_RIVERBANK = 6;
const FEATURE_BRIDGE = 7;
const FEATURE_WORLD_DUNGEON = 8;

const FEATURE_SPEED = {
  [FEATURE_NONE]: -1,            // -1 = use biome speed
  [FEATURE_RIVER]: 0,            // impassable
  [FEATURE_LAKE]: 0,             // impassable
  [FEATURE_SHALLOW_WATER]: 0.3,
  [FEATURE_THICK_FOREST]: 0.2,
  [FEATURE_CAVE_ENTRANCE]: -1,   // use biome speed
  [FEATURE_RIVERBANK]: 0.5,
  [FEATURE_BRIDGE]: 0.8,         // slightly slower than normal
  [FEATURE_WORLD_DUNGEON]: -1,   // use biome speed
};

const FEATURE_COLORS = {
  [FEATURE_NONE]: null,
  [FEATURE_RIVER]: { r: 40, g: 80, b: 160 },
  [FEATURE_LAKE]: { r: 45, g: 90, b: 155 },
  [FEATURE_SHALLOW_WATER]: { r: 70, g: 120, b: 170 },
  [FEATURE_THICK_FOREST]: { r: 20, g: 55, b: 20 },
  [FEATURE_CAVE_ENTRANCE]: { r: 40, g: 35, b: 30 },
  [FEATURE_RIVERBANK]: { r: 110, g: 95, b: 60 },
  [FEATURE_BRIDGE]: { r: 140, g: 100, b: 55 },    // wooden brown
  [FEATURE_WORLD_DUNGEON]: { r: 120, g: 30, b: 30 }, // dark red — dungeon portal
};

// ---------------------------------------------------------------------------
// WORLD_DUNGEONS — fixed geographical point-of-interest dungeons
// Coordinates are reference coords: chunk = (1000 + refX, 1250 + refY)
// Anchor towns for reference:
//   Holy Dominion starter (35,42), Solara (40,38), Sylvaris (45,55),
//   Ironhold (32,8), Kragmor (18,25), BoneTrap (10,38),
//   Murkmire (15,52), Mechspire (95,38), Clockwork Harbor (92,50),
//   Fortune's Rest (35,-8)
// ---------------------------------------------------------------------------

const WORLD_DUNGEONS = [
  // ── HOLY DOMINION REGION (Human) ──
  {
    id: 'sunken_chapel',
    name: 'The Sunken Chapel',
    theme: 'sunken_cathedral',
    enemyPool: 'sunken_cathedral',
    refX: 38, refY: 44,
    minLevel: 5,
    floors: 5,
    biome: 8, // HOLY_DOMINION
    type: 'temple',
  },
  {
    id: 'vampire_castle',
    name: 'Castle Nocturn',
    theme: 'vampire_castle',
    enemyPool: 'vampire_castle',
    refX: 30, refY: 35,
    minLevel: 15,
    floors: 7,
    biome: 8, // HOLY_DOMINION
    type: 'castle',
  },
  {
    id: 'haunted_estate',
    name: 'Varek Manor',
    theme: 'haunted_manor',
    enemyPool: 'haunted_manor',
    refX: 42, refY: 43,
    minLevel: 10,
    floors: 5,
    biome: 8, // HOLY_DOMINION
    type: 'castle',
  },
  {
    id: 'celestial_sanctum',
    name: 'The Celestial Sanctum',
    theme: 'celestial_spire',
    enemyPool: 'celestial_spire',
    refX: 48, refY: 40,
    minLevel: 30,
    floors: 8,
    biome: 8, // HOLY_DOMINION
    type: 'temple',
  },

  // ── DWARVEN MOUNTAINS REGION (Dwarf / Ironhold) ──
  {
    id: 'deep_forge',
    name: 'The Deep Forge',
    theme: 'iron_forge',
    enemyPool: 'iron_forge',
    refX: 35, refY: 5,
    minLevel: 10,
    floors: 6,
    biome: 2, // MOUNTAIN
    type: 'stronghold',
  },
  {
    id: 'dragons_maw',
    name: "Dragon's Maw",
    theme: 'dragons_den',
    enemyPool: 'dragons_den',
    refX: 40, refY: 3,
    minLevel: 35,
    floors: 8,
    biome: 2, // MOUNTAIN
    type: 'den',
  },
  {
    id: 'crystal_depths',
    name: 'The Crystal Depths',
    theme: 'crystal_cavern',
    enemyPool: 'crystal_cavern',
    refX: 28, refY: 10,
    minLevel: 8,
    floors: 5,
    biome: 2, // MOUNTAIN
    type: 'ruins',
  },
  {
    id: 'troll_warren',
    name: 'Grothak\'s Warren',
    theme: 'troll_caves',
    enemyPool: 'troll_caves',
    refX: 25, refY: 6,
    minLevel: 12,
    floors: 5,
    biome: 2, // MOUNTAIN
    type: 'den',
  },

  // ── ORCISH STEPPES REGION (Orc / Kragmor) ──
  {
    id: 'warlord_barrow',
    name: 'Barrow of the Warlords',
    theme: 'orc_barrow',
    enemyPool: 'orc_barrow',
    refX: 15, refY: 20,
    minLevel: 12,
    floors: 6,
    biome: 4, // STEPPES
    type: 'ruins',
  },
  {
    id: 'lich_tower',
    name: 'The Sanctum of Veranthos',
    theme: 'lich_sanctum',
    enemyPool: 'lich_sanctum',
    refX: 20, refY: 30,
    minLevel: 25,
    floors: 7,
    biome: 4, // STEPPES
    type: 'temple',
    isRaid: true,
    minPlayers: 16,
    maxPlayers: 32,
  },

  // ── GOBLIN TERRITORY (Goblin / BoneTrap) ──
  {
    id: 'goblin_stronghold',
    name: 'Skrix\'s Stronghold',
    theme: 'goblin_warrens',
    enemyPool: 'goblin_warrens',
    refX: 7, refY: 35,
    minLevel: 8,
    floors: 6,
    biome: 6, // PLAINS (near BoneTrap)
    type: 'stronghold',
  },
  {
    id: 'plague_burrow',
    name: 'The Plague Burrow',
    theme: 'plague_warren',
    enemyPool: 'plague_warren',
    refX: 12, refY: 46,
    minLevel: 15,
    floors: 5,
    biome: 7, // SWAMP (Shadowfen)
    type: 'den',
  },

  // ── SHADOWFEN / MURKMIRE REGION (Lizard Folk) ──
  {
    id: 'shadowfen_ruins',
    name: 'Ruins of the Drowned',
    theme: 'flooded_ruins',
    enemyPool: 'flooded_ruins',
    refX: 10, refY: 50,
    minLevel: 10,
    floors: 5,
    biome: 7, // SWAMP
    type: 'ruins',
  },
  {
    id: 'fungal_grotto',
    name: 'The Spore Mother\'s Grotto',
    theme: 'fungal_forest',
    enemyPool: 'fungal_forest',
    refX: 18, refY: 55,
    minLevel: 15,
    floors: 6,
    biome: 7, // SWAMP
    type: 'den',
  },
  {
    id: 'spider_nest',
    name: 'The Broodmother\'s Nest',
    theme: 'spider_hive',
    enemyPool: 'spider_hive',
    refX: 8, refY: 48,
    minLevel: 18,
    floors: 6,
    biome: 7, // SWAMP
    type: 'den',
  },

  // ── ELVEN SOUTH (Elf / Sylvaris) ──
  {
    id: 'elven_reliquary',
    name: 'The Eternal Reliquary',
    theme: 'elven_reliquary',
    enemyPool: 'elven_reliquary',
    refX: 48, refY: 58,
    minLevel: 15,
    floors: 7,
    biome: 16, // ELVEN_SOUTH
    type: 'ruins',
  },
  {
    id: 'dinosaur_cavern',
    name: 'The Primeval Cavern',
    theme: 'dinosaur_jungle',
    enemyPool: 'dinosaur_jungle',
    refX: 45, refY: 60,
    minLevel: 20,
    floors: 6,
    biome: 16, // ELVEN_SOUTH
    type: 'den',
  },

  // ── GNOMISH ISLES / MECHSPIRE (Gnome) ──
  {
    id: 'cogwork_ruins',
    name: 'The Overclocked Foundry',
    theme: 'cogwork_foundry',
    enemyPool: 'cogwork_foundry',
    refX: 125, refY: 35,
    minLevel: 12,
    floors: 6,
    biome: 10, // MECHSPIRE
    type: 'ruins',
  },
  {
    id: 'gnomish_lab',
    name: 'Director Zero\'s Laboratory',
    theme: 'gnomish_workshop',
    enemyPool: 'gnomish_workshop',
    refX: 130, refY: 40,
    minLevel: 18,
    floors: 7,
    biome: 10, // MECHSPIRE
    type: 'ruins',
  },

  // ── DESERT / FORTUNE'S REST (Cat Folk) ──
  {
    id: 'sand_tomb',
    name: 'Tomb of the Eternal Pharaoh',
    theme: 'sand_tomb',
    enemyPool: 'sand_tomb',
    refX: 30, refY: -12,
    minLevel: 10,
    floors: 6,
    biome: 1, // DESERT
    type: 'temple',
  },
  {
    id: 'mirage_palace',
    name: 'The Mirage Palace',
    theme: 'mirage_palace',
    enemyPool: 'mirage_palace',
    refX: 40, refY: -15,
    minLevel: 20,
    floors: 7,
    biome: 1, // DESERT
    type: 'temple',
  },

  // ── OCEAN DUNGEONS (Lizard Folk / water_breathing required) ──
  {
    id: 'tidal_vault',
    name: 'The Tidebound Vault',
    theme: 'tidal_vault',
    enemyPool: 'tidal_vault',
    refX: 68, refY: 45,
    minLevel: 15,
    floors: 5,
    biome: 0, // WATER
    type: 'ocean_dungeon',
  },
  {
    id: 'sunken_abyss',
    name: 'The Sunken Abyss',
    theme: 'sunken_depths',
    enemyPool: 'sunken_depths',
    refX: 70, refY: 35,
    minLevel: 25,
    floors: 7,
    biome: 0, // WATER
    type: 'ocean_dungeon',
  },
  {
    id: 'coral_throne',
    name: 'The Coral Throne',
    theme: 'coral_grotto',
    enemyPool: 'coral_grotto',
    refX: 68, refY: 50,
    minLevel: 12,
    floors: 4,
    biome: 0, // WATER
    type: 'ocean_dungeon',
  },

  // ── SCORCHED SANDS / WASTES (remote, high level) ──
  {
    id: 'infernal_pit',
    name: 'The Infernal Pit',
    theme: 'infernal_pit',
    enemyPool: 'infernal_pit',
    refX: -20, refY: 30,
    minLevel: 30,
    floors: 8,
    biome: 3, // SCORCHED_SANDS
    type: 'den',
  },
  {
    id: 'ashen_watch',
    name: 'The Ashen Observatory',
    theme: 'ashen_observatory',
    enemyPool: 'ashen_observatory',
    refX: -15, refY: 25,
    minLevel: 25,
    floors: 6,
    biome: 3, // SCORCHED_SANDS
    type: 'ruins',
  },

  // ── FROSTBOUND REACH (remote, high level) ──
  {
    id: 'frost_citadel',
    name: 'The Winter Citadel',
    theme: 'frost_citadel',
    enemyPool: 'frost_citadel',
    refX: 30, refY: -60,
    minLevel: 30,
    floors: 8,
    biome: 14, // FROSTBOUND
    type: 'castle',
  },

  // ── FOREST / WILDLANDS (mid-level, between regions) ──
  {
    id: 'werewolf_den',
    name: 'Fenris\' Den',
    theme: 'werewolf_den',
    enemyPool: 'werewolf_den',
    refX: 55, refY: 30,
    minLevel: 15,
    floors: 5,
    biome: 5, // FOREST
    type: 'den',
  },
  {
    id: 'shadow_labyrinth',
    name: 'The Shadow Labyrinth',
    theme: 'shadow_realm',
    enemyPool: 'shadow_realm',
    refX: 5, refY: 45,
    minLevel: 25,
    floors: 7,
    biome: 7, // SWAMP
    type: 'ruins',
  },

  // ── WASTES OF CALIDAR (endgame, remote) ──
  {
    id: 'astral_tear',
    name: 'The Astral Tear',
    theme: 'astral_rift',
    enemyPool: 'astral_rift',
    refX: 35, refY: 70,
    minLevel: 35,
    floors: 9,
    biome: 12, // WASTES
    type: 'ruins',
  },
  {
    id: 'void_sanctum',
    name: 'The Void Sanctum',
    theme: 'shadow_realm',
    enemyPool: 'shadow_realm',
    refX: 40, refY: 75,
    minLevel: 40,
    floors: 10,
    biome: 12, // WASTES
    type: 'temple',
  },
];

// Build a spatial index of world dungeons keyed by chunk coords for O(1) lookup
// Key format: 'cx,cy'
var _worldDungeonChunkIndex = {};
for (var _wdi = 0; _wdi < WORLD_DUNGEONS.length; _wdi++) {
  var _wd = WORLD_DUNGEONS[_wdi];
  var _wcx = WORLD_SCALE.originCX + _wd.refX;
  var _wcy = WORLD_SCALE.originCY + _wd.refY;
  _wd._chunkX = _wcx;
  _wd._chunkY = _wcy;
  var _wkey = _wcx + ',' + _wcy;
  if (!_worldDungeonChunkIndex[_wkey]) _worldDungeonChunkIndex[_wkey] = [];
  _worldDungeonChunkIndex[_wkey].push(_wd);
}

/**
 * Get world dungeon(s) in a given chunk. Returns array or null.
 */
function getWorldDungeonsInChunk(cx, cy) {
  var key = cx + ',' + cy;
  return _worldDungeonChunkIndex[key] || null;
}

// ---------------------------------------------------------------------------
// Travel speed system (matches WORLD_TRAVERSAL_GUIDE.md, DOUBLED travel times)
// ---------------------------------------------------------------------------

// Game time: 1 game-day = 60 real seconds (1 real minute)
const GAME_DAY_SECONDS = 60;

// Overworld walk speed: at biome speed 1.0, player crosses 2 chunks per game-day
// 2 chunks * 512px = 1024px per game-day = 1024/60 = 17.07 px/s
const OVERWORLD_WALK_SPEED = 200;   // px/s on overworld (chunk-based zones) — 4x bump
const LOCAL_WALK_SPEED = 200;       // px/s in towns/buildings

// Mount/vehicle speed multipliers (relative to walk speed)
const MOUNT_SPEEDS = {
  walk: 1.0,          // 17 px/s = 2 chunks/day = 10 km/day (plains)
  horse: 2.0,         // 34 px/s = 4 chunks/day = 20 km/day
  caravan: 0.7,       // 12 px/s = 1.4 chunks/day = 7 km/day
  ship: 5.0,          // 85 px/s = 10 chunks/day = 50 km/day
  airship: 20.0,      // 340 px/s = 40 chunks/day = 200 km/day
};

// Biomes eligible for water features (rivers, lakes)
const WATER_FEATURE_BIOMES = new Set([
  BIOME.FOREST, BIOME.PLAINS, BIOME.SWAMP, BIOME.HOLY_DOMINION,
  BIOME.STEPPES, BIOME.ELVEN_SOUTH, BIOME.GNOMISH_ISLES,
  BIOME.BEACH, BIOME.CLOCKWORK_HARBOR,
]);

// Biomes eligible for thick forest patches
const THICK_FOREST_BIOMES = new Set([
  BIOME.FOREST, BIOME.ELVEN_SOUTH, BIOME.SWAMP,
]);

// Biomes eligible for cave entrances (expanded — caves everywhere)
const CAVE_BIOMES = new Set([
  BIOME.MOUNTAIN, BIOME.WASTES, BIOME.SCORCHED_SANDS,
  BIOME.FOREST, BIOME.PLAINS, BIOME.SWAMP, BIOME.STEPPES,
  BIOME.ELVEN_SOUTH, BIOME.DESERT, BIOME.FROSTBOUND,
  BIOME.HOLY_DOMINION, BIOME.GNOMISH_ISLES,
]);

// Per-biome cave spawn chance
const CAVE_CHANCE = {
  [BIOME.MOUNTAIN]: 0.06,
  [BIOME.WASTES]: 0.02,
  [BIOME.SCORCHED_SANDS]: 0.02,
  [BIOME.FOREST]: 0.015,
  [BIOME.PLAINS]: 0.008,
  [BIOME.SWAMP]: 0.02,
  [BIOME.STEPPES]: 0.008,
  [BIOME.ELVEN_SOUTH]: 0.015,
  [BIOME.DESERT]: 0.01,
  [BIOME.FROSTBOUND]: 0.01,
  [BIOME.HOLY_DOMINION]: 0.005,
  [BIOME.GNOMISH_ISLES]: 0.01,
};

// Per-biome hollow earth chance (of caves that are hollow earth portals)
const HOLLOW_EARTH_CHANCE = {
  [BIOME.MOUNTAIN]: 0.25,
  [BIOME.WASTES]: 0.15,
  [BIOME.SCORCHED_SANDS]: 0.15,
  [BIOME.FOREST]: 0.10,
  [BIOME.PLAINS]: 0.10,
  [BIOME.SWAMP]: 0.20,
  [BIOME.STEPPES]: 0.08,
  [BIOME.ELVEN_SOUTH]: 0.12,
  [BIOME.DESERT]: 0.10,
  [BIOME.FROSTBOUND]: 0.12,
  [BIOME.HOLY_DOMINION]: 0.15,
  [BIOME.GNOMISH_ISLES]: 0.10,
};

// ---------------------------------------------------------------------------
// River definitions — world-level math curves (coherent across chunks)
// ---------------------------------------------------------------------------

// Rivers mapped to new coordinate system (ref origin at cx=1000, cy=1250)
// Main continent spans cx 1000-1063, cy 1250-1313
const RIVERS = [
  // Holy River — flows through Holy Dominion (ref x~40, y=0..50) → cx ~1040, cy 1250-1300
  { name: 'Holy River',      baseX: 1040, startCY: 1250, endCY: 1300, width: 1.5, amplitude: 3,  frequency: 0.04, phase: 0 },
  // Western Fork — through steppes/plains (ref x~15, y=5..50) → cx ~1015, cy 1255-1300
  { name: 'Western Fork',    baseX: 1015, startCY: 1255, endCY: 1300, width: 1.2, amplitude: 4,  frequency: 0.03, phase: 1.2 },
  // Shadowfen Creek — wide swamp river (ref x~10, y=45..63) → cx ~1010, cy 1295-1313
  { name: 'Shadowfen Creek', baseX: 1010, startCY: 1295, endCY: 1313, width: 2.0, amplitude: 2, frequency: 0.05, phase: 2.5 },
  // Elven Stream — narrow through Elven South (ref x~53, y=50..63) → cx ~1053, cy 1300-1313
  { name: 'Elven Stream',    baseX: 1053, startCY: 1300, endCY: 1313, width: 0.8, amplitude: 2, frequency: 0.06, phase: 0.7 },
  // Plains River — central plains (ref x~30, y=10..55) → cx ~1030, cy 1260-1305
  { name: 'Plains River',    baseX: 1030, startCY: 1260, endCY: 1305, width: 1.3, amplitude: 3,  frequency: 0.035, phase: 3.1 },
];

// Cave names for lore
const CAVE_NAMES = [
  'Delvrak\'s Hollow', 'The Sunken Grotto', 'Ashvein Cavern', 'Ironmaw Pit',
  'Gloomfang Depths', 'The Whispering Chasm', 'Hollow Earth Passage', 'Embervault',
  'Stonegut Tunnel', 'Calidar\'s Maw', 'The Deep Descent', 'Shadowroot Cave',
];

/**
 * Get river center X in world-tile coords at a given world-tile Y.
 */
function getRiverWorldTileX(river, worldTileY) {
  return river.baseX * TILES_PER_CHUNK + Math.sin(worldTileY * river.frequency + river.phase) * river.amplitude * TILES_PER_CHUNK;
}

// ---------------------------------------------------------------------------
// Feature generation functions
// ---------------------------------------------------------------------------

function generateRiverFeatures(cx, cy, features) {
  var chunkStartTileX = cx * TILES_PER_CHUNK;
  var chunkStartTileY = cy * TILES_PER_CHUNK;

  for (var ri = 0; ri < RIVERS.length; ri++) {
    var river = RIVERS[ri];
    if (cy < river.startCY || cy > river.endCY) continue;

    for (var ty = 0; ty < TILES_PER_CHUNK; ty++) {
      var worldTileY = chunkStartTileY + ty;
      var riverCenterX = getRiverWorldTileX(river, worldTileY);
      var halfWidth = river.width * TILES_PER_CHUNK / 2;

      for (var tx = 0; tx < TILES_PER_CHUNK; tx++) {
        var worldTileX = chunkStartTileX + tx;
        var dist = Math.abs(worldTileX - riverCenterX);
        var idx = ty * TILES_PER_CHUNK + tx;

        if (dist < halfWidth * 0.6) {
          // Core river
          features[idx] = FEATURE_RIVER;
        } else if (dist < halfWidth * 0.85) {
          // Shallow water edge
          if (features[idx] === FEATURE_NONE) {
            features[idx] = FEATURE_SHALLOW_WATER;
          }
        } else if (dist < halfWidth * 1.2) {
          // Muddy riverbank
          if (features[idx] === FEATURE_NONE) {
            features[idx] = FEATURE_RIVERBANK;
          }
        }
      }
    }
  }
}

function generateBridgeFeatures(cx, cy, features) {
  var chunkStartTileX = cx * TILES_PER_CHUNK;
  var chunkStartTileY = cy * TILES_PER_CHUNK;
  var MIN_BRIDGE_SPACING = 48; // minimum tiles between bridges on same river

  for (var ri = 0; ri < RIVERS.length; ri++) {
    var river = RIVERS[ri];
    if (cy < river.startCY || cy > river.endCY) continue;

    // Find zero-crossings of sin(freq * Y + phase) = 0
    // Solution: freq * Y + phase = n * PI  =>  Y = (n*PI - phase) / freq
    var freq = river.frequency;
    var phase = river.phase;

    // Determine range of n values that produce zero-crossings in this chunk's Y range
    var minWorldTileY = chunkStartTileY;
    var maxWorldTileY = chunkStartTileY + TILES_PER_CHUNK - 1;
    var nMin = Math.ceil((freq * minWorldTileY + phase) / Math.PI);
    var nMax = Math.floor((freq * maxWorldTileY + phase) / Math.PI);

    for (var n = nMin; n <= nMax; n++) {
      var crossingY = (n * Math.PI - phase) / freq;
      var bridgeTileY = Math.round(crossingY);

      // Enforce minimum spacing between bridges (check modular distance)
      if (bridgeTileY % MIN_BRIDGE_SPACING > 2 && bridgeTileY % MIN_BRIDGE_SPACING < MIN_BRIDGE_SPACING - 2) continue;

      // Bridge spans 2 tiles in Y direction
      for (var bdy = 0; bdy <= 1; bdy++) {
        var worldTileY = bridgeTileY + bdy;
        var localTileY = worldTileY - chunkStartTileY;
        if (localTileY < 0 || localTileY >= TILES_PER_CHUNK) continue;

        // Get river center at this Y and compute full width + margins
        var riverCenterX = getRiverWorldTileX(river, worldTileY);
        var halfWidth = river.width * TILES_PER_CHUNK / 2;
        var bridgeHalfX = Math.ceil(halfWidth * 1.2) + 1; // river + margins

        for (var bdx = -bridgeHalfX; bdx <= bridgeHalfX; bdx++) {
          var worldTileX = Math.round(riverCenterX) + bdx;
          var localTileX = worldTileX - chunkStartTileX;
          if (localTileX < 0 || localTileX >= TILES_PER_CHUNK) continue;

          var idx = localTileY * TILES_PER_CHUNK + localTileX;
          var existing = features[idx];
          // Overwrite water features with bridge
          if (existing === FEATURE_RIVER || existing === FEATURE_SHALLOW_WATER || existing === FEATURE_RIVERBANK) {
            features[idx] = FEATURE_BRIDGE;
          }
        }
      }
    }
  }
}

function generateLakeFeatures(cx, cy, features, rng, biome) {
  if (!WATER_FEATURE_BIOMES.has(biome)) return;
  var chance = biome === BIOME.SWAMP ? 0.20 : 0.08;
  if (rng() > chance) return;

  var centerTX = 3 + Math.floor(rng() * 10);
  var centerTY = 3 + Math.floor(rng() * 10);
  var radius = 2 + Math.floor(rng() * 3);

  for (var ty = 0; ty < TILES_PER_CHUNK; ty++) {
    for (var tx = 0; tx < TILES_PER_CHUNK; tx++) {
      var dx = tx - centerTX;
      var dy = ty - centerTY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var idx = ty * TILES_PER_CHUNK + tx;

      if (features[idx] !== FEATURE_NONE) continue; // don't overwrite rivers

      if (dist < radius * 0.7) {
        features[idx] = FEATURE_LAKE;
      } else if (dist < radius) {
        features[idx] = FEATURE_SHALLOW_WATER;
      }
    }
  }
}

function generateThickForestFeatures(cx, cy, features, rng, biome) {
  if (!THICK_FOREST_BIOMES.has(biome)) return;
  var chance;
  if (biome === BIOME.FOREST) chance = 0.25;
  else if (biome === BIOME.ELVEN_SOUTH) chance = 0.30;
  else chance = 0.15; // SWAMP

  if (rng() > chance) return;

  var clusterCount = 1 + Math.floor(rng() * 3);
  for (var c = 0; c < clusterCount; c++) {
    var centerTX = 2 + Math.floor(rng() * 12);
    var centerTY = 2 + Math.floor(rng() * 12);
    var radius = 2 + Math.floor(rng() * 3);

    for (var ty = Math.max(0, centerTY - radius); ty <= Math.min(TILES_PER_CHUNK - 1, centerTY + radius); ty++) {
      for (var tx = Math.max(0, centerTX - radius); tx <= Math.min(TILES_PER_CHUNK - 1, centerTX + radius); tx++) {
        var dx = tx - centerTX;
        var dy = ty - centerTY;
        if (dx * dx + dy * dy <= radius * radius) {
          var idx = ty * TILES_PER_CHUNK + tx;
          if (features[idx] === FEATURE_NONE) {
            features[idx] = FEATURE_THICK_FOREST;
          }
        }
      }
    }
  }
}

function generateCaveFeatures(cx, cy, features, featureMeta, rng, biome) {
  if (!CAVE_BIOMES.has(biome)) return;
  var chance = CAVE_CHANCE[biome] || 0.01;

  if (rng() > chance) return;

  var tx = 2 + Math.floor(rng() * 12);
  var ty = 2 + Math.floor(rng() * 12);
  var idx = ty * TILES_PER_CHUNK + tx;

  if (features[idx] !== FEATURE_NONE) return;
  features[idx] = FEATURE_CAVE_ENTRANCE;

  // Pick a deterministic cave name
  var nameIdx = Math.floor(rng() * CAVE_NAMES.length);
  var heChance = HOLLOW_EARTH_CHANCE[biome] || 0.10;
  var isHollowEarth = rng() < heChance;
  featureMeta.push({
    type: 'cave',
    tx: tx,
    ty: ty,
    worldX: cx * CHUNK_SIZE + tx * TILE_SIZE + TILE_SIZE / 2,
    worldY: cy * CHUNK_SIZE + ty * TILE_SIZE + TILE_SIZE / 2,
    name: CAVE_NAMES[nameIdx],
    hollowEarth: isHollowEarth,
  });
}

function generateWorldDungeonFeatures(cx, cy, features, featureMeta) {
  var dungeons = getWorldDungeonsInChunk(cx, cy);
  if (!dungeons) return;
  for (var di = 0; di < dungeons.length; di++) {
    var dungeon = dungeons[di];
    // Place entrance at chunk center (tile 8,8)
    var tx = 8;
    var ty = 8;
    var idx = ty * TILES_PER_CHUNK + tx;
    // Only overwrite NONE tiles to avoid clobbering rivers
    if (features[idx] !== FEATURE_NONE) {
      // Try nearby tiles
      var placed = false;
      var offsets = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1},{dx:1,dy:1},{dx:-1,dy:-1},{dx:1,dy:-1},{dx:-1,dy:1}];
      for (var oi = 0; oi < offsets.length; oi++) {
        var ntx = tx + offsets[oi].dx;
        var nty = ty + offsets[oi].dy;
        if (ntx >= 0 && ntx < TILES_PER_CHUNK && nty >= 0 && nty < TILES_PER_CHUNK) {
          var nidx = nty * TILES_PER_CHUNK + ntx;
          if (features[nidx] === FEATURE_NONE) {
            tx = ntx;
            ty = nty;
            idx = nidx;
            placed = true;
            break;
          }
        }
      }
      if (!placed) continue; // skip if no open tile
    }
    features[idx] = FEATURE_WORLD_DUNGEON;
    featureMeta.push({
      type: 'world_dungeon',
      tx: tx,
      ty: ty,
      worldX: cx * CHUNK_SIZE + tx * TILE_SIZE + TILE_SIZE / 2,
      worldY: cy * CHUNK_SIZE + ty * TILE_SIZE + TILE_SIZE / 2,
      dungeonId: dungeon.id,
      name: dungeon.name,
      minLevel: dungeon.minLevel,
      floors: dungeon.floors,
      dungeonType: dungeon.type,
      theme: dungeon.theme,
    });
  }
}

/**
 * Orchestrator: generate all sub-chunk features for a chunk.
 * Returns { features: Int8Array|null, featureMeta: array|undefined }
 */
function generateChunkFeatures(cx, cy, worldSeed) {
  var biome = getBiome(cx, cy);

  // WATER biome: only generate if this chunk has a world dungeon (ocean dungeons)
  if (biome === BIOME.WATER) {
    var waterDungeons = getWorldDungeonsInChunk(cx, cy);
    if (!waterDungeons) return { features: null, featureMeta: undefined };
    // Generate features array for dungeon placement only
    var waterFeatures = new Array(TILES_PER_CHUNK * TILES_PER_CHUNK).fill(FEATURE_NONE);
    var waterMeta = [];
    generateWorldDungeonFeatures(cx, cy, waterFeatures, waterMeta);
    var hasWaterFeatures = false;
    for (var wi = 0; wi < waterFeatures.length; wi++) {
      if (waterFeatures[wi] !== FEATURE_NONE) { hasWaterFeatures = true; break; }
    }
    return {
      features: hasWaterFeatures ? waterFeatures : null,
      featureMeta: waterMeta.length > 0 ? waterMeta : undefined,
    };
  }

  var features = new Array(TILES_PER_CHUNK * TILES_PER_CHUNK).fill(FEATURE_NONE);
  var featureMeta = [];
  var rng = seededRandom(chunkSeed(cx, cy, worldSeed + ':features'));

  // Rivers first (world-level coherent)
  if (WATER_FEATURE_BIOMES.has(biome)) {
    generateRiverFeatures(cx, cy, features);
  }

  // Bridges at river zero-crossings (deterministic from river math)
  if (WATER_FEATURE_BIOMES.has(biome)) {
    generateBridgeFeatures(cx, cy, features);
  }

  // Lakes
  generateLakeFeatures(cx, cy, features, rng, biome);

  // Thick forest
  generateThickForestFeatures(cx, cy, features, rng, biome);

  // Caves
  generateCaveFeatures(cx, cy, features, featureMeta, rng, biome);

  // Fixed world dungeons (always placed, not RNG-dependent)
  generateWorldDungeonFeatures(cx, cy, features, featureMeta);

  // Check if any features exist
  var hasFeatures = false;
  for (var i = 0; i < features.length; i++) {
    if (features[i] !== FEATURE_NONE) { hasFeatures = true; break; }
  }

  return {
    features: hasFeatures ? features : null,
    featureMeta: featureMeta.length > 0 ? featureMeta : undefined,
  };
}

// ---------------------------------------------------------------------------
// Seeded RNG (deterministic per chunk)
// ---------------------------------------------------------------------------

function seededRandom(seed) {
  var state = seed;
  return function() {
    state = (state * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (state >>> 0) / 0xFFFFFFFF;
  };
}

function chunkSeed(cx, cy, worldSeed) {
  var str = worldSeed + ':' + cx + ':' + cy;
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Biome detection (function-based, replaces hardcoded grid)
// ---------------------------------------------------------------------------
// World layout (Y=0 is north, increases southward):
//
//   cy 0-100:       Frostbound Reach (arctic)
//   cy 100-150:     Ice-desert transition
//   cy 150-850:     Great Endless Desert (700 chunks)
//   cy 850-900:     Desert-mountain transition
//   cy 900-960:     Dwarven Mountains (60 chunks)
//   cy 960-1020:    Steppes / Plains / Holy Dominion (60 chunks)
//   cy 1020-1060:   Shadowfen / Elven South (40 chunks)
//   cy 1060-1100:   Southern coast
//   cy 1100-1500:   Wastes of Calidar (400 chunks)
//   cy 1500-1800:   Southern Ocean (300 chunks)
//   cy 1800-2200:   Southern Wastes (400 chunks)
//   cy 2200-2500:   Southern Frostbound (300 chunks)
//
//   cx 0-200:       Deep Western Ocean
//   cx 200-280:     Ashen Archipelago / Western Ocean
//   cx 280-400:     Western Ocean
//   cx 400-660:     Scorched Sands (260 chunks)
//   cx 660-690:     Western coast
//   cx 690-810:     Main Continent (120 chunks)
//   cx 810-840:     Eastern coast
//   cx 840-960:     Silver Seas
//   cx 960-1100:    Gnomish Isles
//   cx 1100-1200:   Mechspire / Clockwork Harbor
//   cx 1200-2000:   Shimmering Sea
//
// Main continent center: cx=750, cy=990

function getBiome(cx, cy) {
  if (cx < 0 || cx >= WORLD_CHUNKS_X || cy < 0 || cy >= WORLD_CHUNKS_Y) return BIOME.WATER;

  // =========================================================================
  // Geography mapped from reference worldgen (1 chunk = 1 ref tile = 5 km)
  // Reference origin (0,0) → chunk (1000, 1250)
  // Main continent: cx 1000-1063, cy 1250-1313 (64×63 chunks = 100,000 sq km)
  // =========================================================================

  // ── POLAR OCEAN (cy 0-899) ──
  if (cy < 900) {
    return BIOME.WATER;
  }

  // ── NORTHERN TUNDRA CONTINENT (cy 900-1129) ──
  // ref: x=-100..150, y=-350..-120 → cx 900-1150, cy 900-1130
  // 250×230 chunks = massive frozen continent
  if (cy < 1130) {
    if (cx >= 900 && cx < 1150) return BIOME.FROSTBOUND;
    if (cx >= 895 && cx < 900) return BIOME.BEACH;
    if (cx >= 1150 && cx < 1155) return BIOME.BEACH;
    return BIOME.WATER;
  }

  // ── NORTHERN FROZEN SEAS (cy 1130-1149) ──
  // ref: y=-120..-100 → transition zone with ice
  if (cy < 1150) {
    // Frostbound Reach island starts appearing
    if (cx >= 1010 && cx < 1060) {
      var rng = seededRandom(chunkSeed(cx, cy, 'nfrost'));
      return rng() < 0.3 ? BIOME.FROSTBOUND : BIOME.WATER;
    }
    return BIOME.WATER;
  }

  // ── FROSTBOUND REACH (cy 1150-1199) ──
  // ref: x=10..60, y=-100..-50 → cx 1010-1060, cy 1150-1200
  // 50×50 chunks = 62,500 sq km (larger than Tasmania, smaller than Iceland)
  if (cy < 1200) {
    if (cx >= 1010 && cx < 1060) return BIOME.FROSTBOUND;
    if (cx >= 1007 && cx < 1010) return BIOME.BEACH;
    if (cx >= 1060 && cx < 1063) return BIOME.BEACH;
    return BIOME.WATER;
  }

  // ── GREAT ENDLESS DESERT (cy 1200-1249) ──
  // ref: x=-50..100, y=-50..-1 → cx 950-1100, cy 1200-1249
  // 150×50 chunks = 187,500 sq km (size of Cambodia)
  if (cy < 1250) {
    // Ashen Archipelago extends into this latitude (far west)
    // ref: x=-220..-140, y=5..55 → cx 780-860 (overlaps at cy 1205+)
    if (cx >= 780 && cx < 860 && cy >= 1205) {
      var islandRng = seededRandom(chunkSeed(cx, cy, 'ashen'));
      if (islandRng() < 0.18) return BIOME.MOUNTAIN;
      return BIOME.WATER;
    }

    // Scorched Sands (west of desert) ref: x<0 → cx < 1000
    if (cx >= 900 && cx < 950) return BIOME.SCORCHED_SANDS;
    // Desert proper
    if (cx >= 950 && cx < 1100) {
      if (cx < 953) return BIOME.BEACH;
      if (cx >= 1097) return BIOME.BEACH;
      return BIOME.DESERT;
    }
    if (cx < 780) return BIOME.WATER;
    return BIOME.WATER;
  }

  // ── DESERT-MOUNTAIN TRANSITION (cy 1250, top of main continent) ──
  // This is where the desert meets the continent's northern edge

  // ── MAIN CONTINENT (cy 1250-1313) ──
  // ref: x=0..63, y=0..63 → cx 1000-1063, cy 1250-1313
  // 64×63 chunks = ~100,000 sq km
  if (cy < 1314) {
    // === WEST OF CONTINENT ===

    // Ashen Archipelago (volcanic islands, far west)
    // ref: x=-220..-140, y=5..55 → cx 780-860, cy 1255-1305
    if (cx >= 780 && cx < 860 && cy >= 1255 && cy < 1305) {
      // Great Western Isle: ref x=-200..-160, y=15..45 → cx 800-840, cy 1265-1295
      if (cx >= 800 && cx < 840 && cy >= 1265 && cy < 1295) {
        var gwiRng = seededRandom(chunkSeed(cx, cy, 'gwi'));
        // Great Western Isle is ~70% land
        if (gwiRng() < 0.70) {
          var gwiTerrain = seededRandom(chunkSeed(cx, cy, 'gwit'));
          var t = gwiTerrain();
          if (t < 0.25) return BIOME.MOUNTAIN; // volcanic peaks
          if (t < 0.40) return BIOME.FOREST;
          return BIOME.PLAINS;
        }
        return BIOME.WATER;
      }
      // Lesser islands
      var archRng = seededRandom(chunkSeed(cx, cy, 'arch'));
      if (archRng() < 0.15) return BIOME.MOUNTAIN;
      return BIOME.WATER;
    }

    // Western Ocean (between archipelago and Scorched Sands)
    if (cx < 900) return BIOME.WATER;

    // Scorched Sands (ref: x<0, extends west from continent)
    // cx 900-999 at continent latitudes
    if (cx < 1000) {
      if (cx < 920) return BIOME.WATER;
      if (cx < 925) return BIOME.BEACH;
      return BIOME.SCORCHED_SANDS;
    }

    // === MAIN CONTINENT PROPER: cx 1000-1063 ===
    if (cx < 1064) {
      // Dwarven Mountains (ref: x=18..45, y=0..18 → cx 1018-1045, cy 1250-1268)
      if (cy < 1268) {
        if (cx >= 1018 && cx < 1045) return BIOME.MOUNTAIN;
        if (cx < 1018) return BIOME.FOREST;  // Northwest forests
        return BIOME.FOREST;                   // Northeast forests
      }

      // Orcish Steppes (ref: x=8..28, y=15..35 → cx 1008-1028, cy 1265-1285)
      // Overlaps with mountains above, steppes take over below cy 1268
      if (cy < 1285) {
        if (cx >= 1008 && cx < 1028) return BIOME.STEPPES;
        // Holy Dominion (ref: x=25..55, y=25..50 → cx 1025-1055, cy 1275-1300)
        if (cy >= 1275 && cx >= 1025 && cx < 1055) return BIOME.HOLY_DOMINION;
        // Plains between steppes and dominion
        if (cx >= 1028 && cx < 1040) return BIOME.PLAINS;
        // Eastern Forests (ref: x=50..63, y=10..45 → cx 1050-1063, cy 1260-1295)
        if (cx >= 1050) return BIOME.FOREST;
        return BIOME.PLAINS;
      }

      // Holy Dominion band (cy 1285-1295)
      if (cy < 1295) {
        if (cx >= 1025 && cx < 1055) return BIOME.HOLY_DOMINION;
        if (cx < 1025) return BIOME.PLAINS;
        if (cx >= 1050) return BIOME.FOREST;
        return BIOME.PLAINS;
      }

      // Shadowfen / Elven South (ref: Shadowfen x=5..25,y=45..63; Elven x=50..63)
      // cy 1295-1313
      if (cx >= 1005 && cx < 1025) return BIOME.SWAMP;       // Shadowfen
      if (cx >= 1025 && cx < 1050) return BIOME.ELVEN_SOUTH; // Elven South
      if (cx >= 1050) return BIOME.FOREST;                     // Eastern forests (south)
      if (cx < 1005) return BIOME.SWAMP;                       // Far west swamp
      return BIOME.PLAINS;
    }

    // === EAST OF CONTINENT ===

    // Beach (east coast)
    if (cx < 1067) return BIOME.BEACH;

    // Silver Seas (ref: x=64..119, y=0..63 → cx 1064-1119, cy 1250-1313)
    // 56 chunks = 280 km ocean gap
    if (cx < 1120) return BIOME.WATER;

    // Gnomish Isles (ref: x=120..149, y=25..54 → cx 1120-1149, cy 1275-1304)
    if (cx < 1150) {
      if (cy >= 1275 && cy < 1304) {
        var gnRng = seededRandom(chunkSeed(cx, cy, 'gn'));
        if (gnRng() < 0.60) {
          // Mechspire (ref: x=120..135, y=30..45 → cx 1120-1135, cy 1280-1295)
          if (cx >= 1120 && cx < 1135 && cy >= 1280 && cy < 1295) return BIOME.MECHSPIRE;
          // Clockwork Coast (ref: x=120..140, y=45..54 → cx 1120-1140, cy 1295-1304)
          if (cy >= 1295 && cx < 1140) return BIOME.CLOCKWORK_HARBOR;
          return BIOME.GNOMISH_ISLES;
        }
        return BIOME.WATER;
      }
      // North/south of isles: water with scattered small islands
      var gnEdge = seededRandom(chunkSeed(cx, cy, 'gne'));
      if (gnEdge() < 0.1) return BIOME.GNOMISH_ISLES;
      return BIOME.WATER;
    }

    // Shimmering Sea (ref: x>150 → cx > 1150)
    return BIOME.WATER;
  }

  // ── WASTES OF CALIDAR (cy 1314-1329) ──
  // ref: x=20..50, y=64..79 → cx 1020-1050, cy 1314-1329
  // 30×15 chunks = 11,250 sq km
  if (cy < 1330) {
    if (cx >= 1020 && cx < 1050) return BIOME.WASTES;
    if (cx >= 1017 && cx < 1020) return BIOME.BEACH;
    if (cx >= 1050 && cx < 1053) return BIOME.BEACH;
    // Gnomish Isles at this latitude (southern edge)
    if (cx >= 1120 && cx < 1150) {
      var gnRng5 = seededRandom(chunkSeed(cx, cy, 'gn'));
      if (gnRng5() < 0.3) return BIOME.GNOMISH_ISLES;
      return BIOME.WATER;
    }
    return BIOME.WATER;
  }

  // ── SOUTHERN OCEAN (cy 1330-1499) ──
  // ref: x=-100..200, y=80..249 → cx 900-1200, cy 1330-1499
  // 170 chunks deep = 850 km of ocean
  if (cy < 1500) {
    return BIOME.WATER;
  }

  // ── SOUTHERN WASTES / SOUTHERN TUNDRA (cy 1500-1599) ──
  // ref: x=-100..200, y=250..349 → cx 900-1200, cy 1500-1599
  if (cy < 1600) {
    if (cx >= 900 && cx < 1200) return BIOME.SOUTHERN_WASTES;
    if (cx >= 895 && cx < 900) return BIOME.BEACH;
    if (cx >= 1200 && cx < 1205) return BIOME.BEACH;
    return BIOME.WATER;
  }

  // ── SOUTHERN POLAR FROSTBOUND (cy 1600-1800) ──
  if (cy < 1800) {
    if (cx >= 900 && cx < 1200) return BIOME.FROSTBOUND;
    if (cx >= 895 && cx < 900) return BIOME.BEACH;
    if (cx >= 1200 && cx < 1205) return BIOME.BEACH;
    return BIOME.WATER;
  }

  // ── POLAR OCEAN (cy 1800+) ──
  return BIOME.WATER;
}

// Get biome at world pixel coordinates
function getBiomeAtPixel(worldX, worldY) {
  var cx = Math.floor(worldX / CHUNK_SIZE);
  var cy = Math.floor(worldY / CHUNK_SIZE);
  return getBiome(cx, cy);
}

// Feature cache for getFeatureAtPixel (avoids regenerating chunk features per call)
var _featureCache = new Map(); // "cx,cy" -> Int8Array|null
var _featureCacheOrder = [];   // LRU eviction list
var FEATURE_CACHE_MAX = 200;
var FEATURE_CACHE_SEED = 'mmolite_world_v1';

// Get terrain feature at a world pixel position (cached)
function getFeatureAtPixel(worldX, worldY) {
  var cx = Math.floor(worldX / CHUNK_SIZE);
  var cy = Math.floor(worldY / CHUNK_SIZE);
  var cacheKey = cx + ',' + cy;
  var features = _featureCache.get(cacheKey);
  if (features === undefined) {
    var data = generateChunkFeatures(cx, cy, FEATURE_CACHE_SEED);
    features = data.features; // Int8Array or null
    // Evict oldest if at capacity
    if (_featureCacheOrder.length >= FEATURE_CACHE_MAX) {
      var evict = _featureCacheOrder.shift();
      _featureCache.delete(evict);
    }
    _featureCache.set(cacheKey, features);
    _featureCacheOrder.push(cacheKey);
  }
  if (!features) return FEATURE_NONE;
  var localX = worldX - cx * CHUNK_SIZE;
  var localY = worldY - cy * CHUNK_SIZE;
  var tx = Math.floor(localX / TILE_SIZE);
  var ty = Math.floor(localY / TILE_SIZE);
  tx = Math.max(0, Math.min(TILES_PER_CHUNK - 1, tx));
  ty = Math.max(0, Math.min(TILES_PER_CHUNK - 1, ty));
  return features[ty * TILES_PER_CHUNK + tx] || FEATURE_NONE;
}

// Check if a pixel position is walkable (optional race for aquatic races, optional animalForm)
// animalForm: string|null — active animal form name (e.g. 'fish', 'eagle', 'bat')
function isWalkable(worldX, worldY, race, animalForm) {
  var biome = getBiomeAtPixel(worldX, worldY);
  if (biome === BIOME.WATER) {
    // Lizard Folk can always walk on water
    if (race === 'lizardfolk') return true;
    // Flying forms can cross water tiles
    if (animalForm === 'bat' || animalForm === 'eagle' || animalForm === 'owl') return true;
    // Swimming/aquatic forms can enter water tiles
    if (animalForm === 'fish' || animalForm === 'turtle') return true;
    // Bear and serpent can swim through shallow/river water (not deep ocean)
    // Check if this is a coastal/lake chunk vs deep ocean by seeing if it has neighbors with land
    if (animalForm === 'bear' || animalForm === 'serpent') {
      var cx = Math.floor(worldX / CHUNK_SIZE);
      var cy = Math.floor(worldY / CHUNK_SIZE);
      // Allow if any adjacent chunk is non-water (coastal/river water)
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          var adjBiome = getBiome(cx + dx, cy + dy);
          if (adjBiome !== BIOME.WATER) return true;
        }
      }
      return false; // Deep ocean — bear/serpent cannot swim here
    }
    // Non-ocean world dungeon chunks are walkable (island biome override)
    var cx2 = Math.floor(worldX / CHUNK_SIZE);
    var cy2 = Math.floor(worldY / CHUNK_SIZE);
    var wdChunk = getWorldDungeonsInChunk(cx2, cy2);
    if (wdChunk) {
      for (var i = 0; i < wdChunk.length; i++) {
        if (wdChunk[i].type !== 'ocean_dungeon') return true;
      }
    }
    return false;
  }
  // Mountain tiles: flying forms bypass mountain slowdown (walkable anyway, just relevant for speed)
  // Check terrain features — rivers and lakes are impassable within walkable biomes
  var feat = getFeatureAtPixel(worldX, worldY);
  if (feat === FEATURE_RIVER || feat === FEATURE_LAKE) {
    // Aquatic races/forms can cross water features
    if (race === 'lizardfolk') return true;
    if (animalForm === 'fish' || animalForm === 'turtle' || animalForm === 'bat' || animalForm === 'eagle' || animalForm === 'owl') return true;
    if ((animalForm === 'bear' || animalForm === 'serpent') && feat === FEATURE_RIVER) return true;
    return false;
  }
  return true;
}

// Get speed multiplier at pixel position (optional animalForm for form-specific speed bonuses)
function getSpeedMultiplier(worldX, worldY, animalForm) {
  var biome = getBiomeAtPixel(worldX, worldY);
  if (biome === BIOME.WATER) {
    // Flying forms cross water at full speed
    if (animalForm === 'bat' || animalForm === 'eagle' || animalForm === 'owl') return 1.0;
    // Aquatic forms move fast in water
    if (animalForm === 'fish') return 1.5;
    if (animalForm === 'turtle') return 1.0;
    // Swimming land forms move slowly in water
    if (animalForm === 'bear' || animalForm === 'serpent') return 0.4;
    // Non-ocean world dungeon chunks use the dungeon's biome speed
    var cx = Math.floor(worldX / CHUNK_SIZE);
    var cy = Math.floor(worldY / CHUNK_SIZE);
    var wdChunk = getWorldDungeonsInChunk(cx, cy);
    if (wdChunk) {
      for (var i = 0; i < wdChunk.length; i++) {
        if (wdChunk[i].type !== 'ocean_dungeon') {
          return BIOME_SPEED[wdChunk[i].biome] || 0.9;
        }
      }
    }
  }
  // Flying forms bypass mountain and swamp penalties
  if (animalForm === 'bat' || animalForm === 'eagle' || animalForm === 'owl') {
    if (biome === BIOME.MOUNTAIN || biome === BIOME.SWAMP || biome === BIOME.FROSTBOUND) return 1.0;
  }
  return BIOME_SPEED[biome] || 0;
}

// ---------------------------------------------------------------------------
// Resource spawn tables per biome
// ---------------------------------------------------------------------------

const BIOME_RESOURCES = {
  [BIOME.FOREST]: [
    { type: 'tree', name: 'Oak Tree', skill: 'woodcutting', minLevel: 1, xp: 10, weight: 5 },
    { type: 'tree', name: 'Pine Tree', skill: 'woodcutting', minLevel: 1, xp: 10, weight: 3 },
    { type: 'stone', name: 'Stone', skill: 'mining', minLevel: 1, xp: 15, weight: 1 },
    { type: 'herbs', name: 'Forest Herbs', skill: 'farming', minLevel: 1, xp: 10, weight: 2 },
    { type: 'mushroom', name: 'Forest Mushroom', skill: 'farming', minLevel: 1, xp: 8, weight: 2 },
  ],
  [BIOME.PLAINS]: [
    { type: 'tree', name: 'Tree', skill: 'woodcutting', minLevel: 1, xp: 10, weight: 2 },
    { type: 'stone', name: 'Stone', skill: 'mining', minLevel: 1, xp: 15, weight: 2 },
    { type: 'wheat', name: 'Wheat Field', skill: 'farming', minLevel: 1, xp: 12, weight: 4 },
    { type: 'herbs', name: 'Wild Herbs', skill: 'farming', minLevel: 1, xp: 10, weight: 3 },
    { type: 'vegetables', name: 'Vegetable Patch', skill: 'farming', minLevel: 1, xp: 10, weight: 3 },
  ],
  [BIOME.MOUNTAIN]: [
    { type: 'stone', name: 'Boulder', skill: 'mining', minLevel: 1, xp: 15, weight: 4 },
    { type: 'iron', name: 'Iron Ore', skill: 'mining', minLevel: 3, xp: 25, weight: 3 },
    { type: 'tree', name: 'Mountain Pine', skill: 'woodcutting', minLevel: 1, xp: 10, weight: 1 },
  ],
  [BIOME.STEPPES]: [
    { type: 'tree', name: 'Scrub Tree', skill: 'woodcutting', minLevel: 1, xp: 10, weight: 2 },
    { type: 'stone', name: 'Steppe Rock', skill: 'mining', minLevel: 1, xp: 15, weight: 3 },
    { type: 'iron', name: 'Iron Deposit', skill: 'mining', minLevel: 3, xp: 25, weight: 1 },
    { type: 'herbs', name: 'Steppe Herbs', skill: 'farming', minLevel: 1, xp: 10, weight: 2 },
  ],
  [BIOME.SWAMP]: [
    { type: 'tree', name: 'Swamp Tree', skill: 'woodcutting', minLevel: 1, xp: 10, weight: 4 },
    { type: 'stone', name: 'Mossy Stone', skill: 'mining', minLevel: 1, xp: 15, weight: 1 },
    { type: 'herbs', name: 'Swamp Herbs', skill: 'farming', minLevel: 2, xp: 15, weight: 4 },
    { type: 'fish_spot', name: 'Muddy Pool', skill: 'fishing', minLevel: 1, xp: 12, weight: 3 },
    { type: 'mushroom', name: 'Mushroom Cluster', skill: 'farming', minLevel: 1, xp: 10, weight: 3 },
  ],
  [BIOME.HOLY_DOMINION]: [
    { type: 'tree', name: 'Tree', skill: 'woodcutting', minLevel: 1, xp: 10, weight: 3 },
    { type: 'stone', name: 'Stone', skill: 'mining', minLevel: 1, xp: 15, weight: 2 },
    { type: 'iron', name: 'Iron Ore', skill: 'mining', minLevel: 3, xp: 25, weight: 1 },
    { type: 'wheat', name: 'Dominion Wheat', skill: 'farming', minLevel: 1, xp: 10, weight: 3 },
    { type: 'herbs', name: 'Temple Herbs', skill: 'farming', minLevel: 2, xp: 12, weight: 2 },
  ],
  [BIOME.DESERT]: [
    { type: 'stone', name: 'Sandstone', skill: 'mining', minLevel: 1, xp: 15, weight: 2 },
  ],
  [BIOME.SCORCHED_SANDS]: [
    { type: 'stone', name: 'Charred Rock', skill: 'mining', minLevel: 1, xp: 15, weight: 2 },
    { type: 'iron', name: 'Scorched Iron', skill: 'mining', minLevel: 3, xp: 25, weight: 1 },
    { type: 'glass_sand', name: 'Glass Sand Deposit', skill: 'glassworking', minLevel: 1, xp: 15, weight: 6 },
    { type: 'gem_rough', name: 'Rough Gem Vein', skill: 'mining', minLevel: 5, xp: 30, weight: 4 },
  ],
  [BIOME.WASTES]: [
    { type: 'stone', name: 'Vitrified Rock', skill: 'mining', minLevel: 1, xp: 15, weight: 2 },
  ],
  [BIOME.GNOMISH_ISLES]: [
    { type: 'tree', name: 'Island Palm', skill: 'woodcutting', minLevel: 1, xp: 10, weight: 3 },
    { type: 'stone', name: 'Coral Rock', skill: 'mining', minLevel: 1, xp: 15, weight: 2 },
    { type: 'iron', name: 'Gnomish Ore', skill: 'mining', minLevel: 3, xp: 25, weight: 2 },
    { type: 'cogs', name: 'Island Cogs', skill: 'cogworking', minLevel: 1, xp: 12, weight: 3 },
  ],
  [BIOME.MECHSPIRE]: [
    { type: 'iron', name: 'Mech Scrap', skill: 'mining', minLevel: 3, xp: 25, weight: 4 },
    { type: 'stone', name: 'Metal Ore', skill: 'mining', minLevel: 1, xp: 15, weight: 2 },
    { type: 'cogs', name: 'Mech Cogs', skill: 'cogworking', minLevel: 1, xp: 12, weight: 3 },
    { type: 'gears', name: 'Mech Gears', skill: 'cogworking', minLevel: 2, xp: 18, weight: 2 },
    { type: 'springs', name: 'Mech Springs', skill: 'cogworking', minLevel: 2, xp: 15, weight: 2 },
  ],
  [BIOME.CLOCKWORK_HARBOR]: [
    { type: 'tree', name: 'Dock Wood', skill: 'woodcutting', minLevel: 1, xp: 10, weight: 2 },
    { type: 'iron', name: 'Harbor Iron', skill: 'mining', minLevel: 3, xp: 25, weight: 2 },
    { type: 'cogs', name: 'Scattered Cogs', skill: 'cogworking', minLevel: 1, xp: 12, weight: 5 },
    { type: 'springs', name: 'Broken Springs', skill: 'cogworking', minLevel: 2, xp: 15, weight: 3 },
    { type: 'gears', name: 'Gear Assembly', skill: 'cogworking', minLevel: 3, xp: 20, weight: 2 },
  ],
  [BIOME.BEACH]: [
    { type: 'tree', name: 'Palm Tree', skill: 'woodcutting', minLevel: 1, xp: 10, weight: 2 },
    { type: 'stone', name: 'Beach Rock', skill: 'mining', minLevel: 1, xp: 15, weight: 1 },
    { type: 'fish_spot', name: 'Fishing Spot', skill: 'fishing', minLevel: 1, xp: 12, weight: 5 },
    { type: 'shellfish_spot', name: 'Shellfish Bed', skill: 'fishing', minLevel: 2, xp: 15, weight: 3 },
    { type: 'seaweed_spot', name: 'Seaweed Patch', skill: 'fishing', minLevel: 1, xp: 8, weight: 2 },
  ],
  [BIOME.FROSTBOUND]: [
    { type: 'stone', name: 'Frozen Rock', skill: 'mining', minLevel: 5, xp: 30, weight: 1 },
  ],
  [BIOME.SOUTHERN_WASTES]: [
    { type: 'stone', name: 'Desert Stone', skill: 'mining', minLevel: 1, xp: 15, weight: 1 },
  ],
  [BIOME.ELVEN_SOUTH]: [
    { type: 'tree', name: 'Ancient Elm', skill: 'woodcutting', minLevel: 1, xp: 15, weight: 4 },
    { type: 'tree', name: 'Silver Birch', skill: 'woodcutting', minLevel: 1, xp: 12, weight: 3 },
    { type: 'stone', name: 'Elven Stone', skill: 'mining', minLevel: 1, xp: 15, weight: 1 },
    { type: 'iron', name: 'Mithril Vein', skill: 'mining', minLevel: 5, xp: 35, weight: 1 },
    { type: 'herbs', name: 'Ancient Herbs', skill: 'farming', minLevel: 3, xp: 20, weight: 3 },
    { type: 'mana_crystal_node', name: 'Mana Crystal', skill: 'magic', minLevel: 5, xp: 30, weight: 2 },
  ],
};

// Resources per chunk by biome
const RESOURCES_PER_CHUNK = {
  [BIOME.FOREST]: { min: 4, max: 7 },
  [BIOME.PLAINS]: { min: 2, max: 4 },
  [BIOME.MOUNTAIN]: { min: 3, max: 6 },
  [BIOME.STEPPES]: { min: 2, max: 4 },
  [BIOME.SWAMP]: { min: 3, max: 5 },
  [BIOME.HOLY_DOMINION]: { min: 3, max: 5 },
  [BIOME.DESERT]: { min: 0, max: 1 },
  [BIOME.SCORCHED_SANDS]: { min: 1, max: 2 },
  [BIOME.WASTES]: { min: 0, max: 1 },
  [BIOME.GNOMISH_ISLES]: { min: 3, max: 5 },
  [BIOME.MECHSPIRE]: { min: 3, max: 5 },
  [BIOME.CLOCKWORK_HARBOR]: { min: 2, max: 4 },
  [BIOME.BEACH]: { min: 1, max: 2 },
  [BIOME.WATER]: { min: 0, max: 0 },
  [BIOME.FROSTBOUND]: { min: 0, max: 1 },
  [BIOME.SOUTHERN_WASTES]: { min: 0, max: 1 },
  [BIOME.ELVEN_SOUTH]: { min: 4, max: 7 },
};

// ---------------------------------------------------------------------------
// Biome animals — ambient animal NPCs for overworld (animal form speech)
// ---------------------------------------------------------------------------

const BIOME_ANIMALS = {
  [BIOME.FOREST]:          ['wolf', 'deer', 'rabbit', 'owl', 'bear', 'fox'],
  [BIOME.PLAINS]:          ['rabbit', 'hawk', 'deer', 'fox'],
  [BIOME.MOUNTAIN]:        ['eagle', 'hawk', 'mountain_goat'],
  [BIOME.STEPPES]:         ['wolf', 'hawk', 'deer'],
  [BIOME.SWAMP]:           ['frog', 'snake', 'turtle', 'heron'],
  [BIOME.HOLY_DOMINION]:   ['cat', 'dog', 'hawk', 'rabbit'],
  [BIOME.DESERT]:          ['snake', 'scorpion', 'lizard', 'hawk'],
  [BIOME.SCORCHED_SANDS]:  ['snake', 'lizard', 'scorpion'],
  [BIOME.WASTES]:          ['snake', 'scorpion', 'bat'],
  [BIOME.GNOMISH_ISLES]:   ['parrot', 'monkey', 'cat'],
  [BIOME.MECHSPIRE]:       ['rat', 'cat', 'spider'],
  [BIOME.CLOCKWORK_HARBOR]:['cat', 'rat', 'fish'],
  [BIOME.BEACH]:           ['crab', 'heron', 'turtle'],
  [BIOME.WATER]:           ['fish', 'turtle', 'crab'],
  [BIOME.FROSTBOUND]:      ['wolf', 'owl', 'bear', 'penguin'],
  [BIOME.SOUTHERN_WASTES]: ['snake', 'hawk', 'lizard'],
  [BIOME.ELVEN_SOUTH]:     ['owl', 'deer', 'rabbit', 'fox', 'eagle'],
};

const ANIMALS_PER_CHUNK = {
  [BIOME.FOREST]:          { min: 0, max: 2 },
  [BIOME.PLAINS]:          { min: 0, max: 1 },
  [BIOME.MOUNTAIN]:        { min: 0, max: 1 },
  [BIOME.STEPPES]:         { min: 0, max: 1 },
  [BIOME.SWAMP]:           { min: 0, max: 2 },
  [BIOME.HOLY_DOMINION]:   { min: 0, max: 1 },
  [BIOME.DESERT]:          { min: 0, max: 1 },
  [BIOME.SCORCHED_SANDS]:  { min: 0, max: 1 },
  [BIOME.WASTES]:          { min: 0, max: 0 },
  [BIOME.GNOMISH_ISLES]:   { min: 0, max: 1 },
  [BIOME.MECHSPIRE]:       { min: 0, max: 1 },
  [BIOME.CLOCKWORK_HARBOR]:{ min: 0, max: 1 },
  [BIOME.BEACH]:           { min: 0, max: 1 },
  [BIOME.WATER]:           { min: 0, max: 0 },
  [BIOME.FROSTBOUND]:      { min: 0, max: 1 },
  [BIOME.SOUTHERN_WASTES]: { min: 0, max: 0 },
  [BIOME.ELVEN_SOUTH]:     { min: 0, max: 2 },
};

// Generate ambient animal NPCs for a chunk
function generateChunkAnimals(cx, cy, worldSeed) {
  var biome = getBiome(cx, cy);
  var animalPool = BIOME_ANIMALS[biome];
  if (!animalPool || animalPool.length === 0) return [];

  var countRange = ANIMALS_PER_CHUNK[biome] || { min: 0, max: 0 };
  var rng = seededRandom(chunkSeed(cx, cy, worldSeed + '_animals'));
  var count = countRange.min + Math.floor(rng() * (countRange.max - countRange.min + 1));
  if (count <= 0) return [];

  var animals = [];
  var margin = 40;
  var usable = CHUNK_SIZE - margin * 2;

  for (var i = 0; i < count; i++) {
    var animalType = animalPool[Math.floor(rng() * animalPool.length)];
    var ax = cx * CHUNK_SIZE + margin + Math.floor(rng() * usable);
    var ay = cy * CHUNK_SIZE + margin + Math.floor(rng() * usable);
    animals.push({
      id: 'ow_animal_' + cx + '_' + cy + '_' + i,
      animalType: animalType,
      name: animalType.charAt(0).toUpperCase() + animalType.slice(1),
      x: ax,
      y: ay,
      chunkX: cx,
      chunkY: cy,
      interacted: false,
    });
  }
  return animals;
}

// ---------------------------------------------------------------------------
// Chunk generation (lazy, deterministic)
// ---------------------------------------------------------------------------

function generateChunkResources(cx, cy, worldSeed) {
  var biome = getBiome(cx, cy);
  var spawnTable = BIOME_RESOURCES[biome];
  if (!spawnTable || spawnTable.length === 0) return [];

  var countRange = RESOURCES_PER_CHUNK[biome] || { min: 0, max: 0 };
  var rng = seededRandom(chunkSeed(cx, cy, worldSeed));
  var count = countRange.min + Math.floor(rng() * (countRange.max - countRange.min + 1));

  var resources = [];
  var totalWeight = 0;
  for (var w = 0; w < spawnTable.length; w++) {
    totalWeight += spawnTable[w].weight;
  }

  var margin = 40;

  for (var i = 0; i < count; i++) {
    var roll = rng() * totalWeight;
    var picked = spawnTable[0];
    var cumulative = 0;
    for (var j = 0; j < spawnTable.length; j++) {
      cumulative += spawnTable[j].weight;
      if (roll < cumulative) {
        picked = spawnTable[j];
        break;
      }
    }

    var localX = margin + rng() * (CHUNK_SIZE - margin * 2);
    var localY = margin + rng() * (CHUNK_SIZE - margin * 2);
    var worldX = cx * CHUNK_SIZE + localX;
    var worldY = cy * CHUNK_SIZE + localY;

    var hp = picked.type === 'tree' ? 5 : picked.type === 'iron' ? 10 : 8;
    resources.push({
      id: 'r_' + cx + '_' + cy + '_' + i,
      type: picked.type,
      name: picked.name,
      x: Math.floor(worldX),
      y: Math.floor(worldY),
      skill: picked.skill,
      minLevel: picked.minLevel,
      xp: picked.xp,
      chunkX: cx,
      chunkY: cy,
      hp: hp,
      maxHp: hp,
    });
  }

  return resources;
}

function generateChunk(cx, cy, worldSeed) {
  var biome = getBiome(cx, cy);

  // Override biome for non-ocean world dungeon chunks that landed on water
  // (e.g. Gnomish Isles 60% land RNG miss). Use the dungeon's intended biome
  // so the chunk is walkable and displays correctly.
  if (biome === BIOME.WATER) {
    var wdInChunk = getWorldDungeonsInChunk(cx, cy);
    if (wdInChunk) {
      for (var wdi = 0; wdi < wdInChunk.length; wdi++) {
        if (wdInChunk[wdi].type !== 'ocean_dungeon') {
          biome = wdInChunk[wdi].biome;
          break;
        }
      }
    }
  }

  var featureData = generateChunkFeatures(cx, cy, worldSeed);
  var resources = generateChunkResources(cx, cy, worldSeed);

  // Post-filter: remove resources that land on RIVER or LAKE tiles
  if (featureData.features && resources.length > 0) {
    resources = resources.filter(function(r) {
      var localX = r.x - cx * CHUNK_SIZE;
      var localY = r.y - cy * CHUNK_SIZE;
      var tx = Math.floor(localX / TILE_SIZE);
      var ty = Math.floor(localY / TILE_SIZE);
      tx = Math.max(0, Math.min(TILES_PER_CHUNK - 1, tx));
      ty = Math.max(0, Math.min(TILES_PER_CHUNK - 1, ty));
      var feat = featureData.features[ty * TILES_PER_CHUNK + tx];
      return feat !== FEATURE_RIVER && feat !== FEATURE_LAKE;
    });
  }

  return {
    cx: cx,
    cy: cy,
    biome: biome,
    biomeName: BIOME_NAMES[biome] || 'Unknown',
    biomeColor: BIOME_COLORS[biome] || { r: 100, g: 100, b: 100 },
    walkable: biome !== BIOME.WATER,
    speedMultiplier: BIOME_SPEED[biome] || 0,
    resources: resources,
    animals: generateChunkAnimals(cx, cy, worldSeed),
    features: featureData.features,
    featureMeta: featureData.featureMeta,
    worldX: cx * CHUNK_SIZE,
    worldY: cy * CHUNK_SIZE,
    width: CHUNK_SIZE,
    height: CHUNK_SIZE,
  };
}

// ---------------------------------------------------------------------------
// Visibility / chunk queries
// ---------------------------------------------------------------------------

function getVisibleChunks(cameraX, cameraY, viewWidth, viewHeight, buffer) {
  buffer = buffer || 1;
  var startCX = Math.max(0, Math.floor(cameraX / CHUNK_SIZE) - buffer);
  var startCY = Math.max(0, Math.floor(cameraY / CHUNK_SIZE) - buffer);
  var endCX = Math.min(WORLD_CHUNKS_X - 1, Math.floor((cameraX + viewWidth) / CHUNK_SIZE) + buffer);
  var endCY = Math.min(WORLD_CHUNKS_Y - 1, Math.floor((cameraY + viewHeight) / CHUNK_SIZE) + buffer);

  var chunks = [];
  for (var cy = startCY; cy <= endCY; cy++) {
    for (var cx = startCX; cx <= endCX; cx++) {
      chunks.push({ cx: cx, cy: cy });
    }
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Protected area (starter town)
// ---------------------------------------------------------------------------

function getProtectedArea() {
  // Holy Dominion inner city: cx 1035-1045, cy 1283-1290 (10×7 chunks)
  // Center of Holy Dominion (ref: x=25..55, y=25..50 → cx 1025-1055, cy 1275-1300)
  return {
    x: 1035 * CHUNK_SIZE,     // 529,920
    y: 1283 * CHUNK_SIZE,     // 656,896
    width: 10 * CHUNK_SIZE,   // 5,120
    height: 7 * CHUNK_SIZE,   // 3,584
    name: 'The Holy Dominion',
  };
}

function isProtectedArea(worldX, worldY) {
  var area = getProtectedArea();
  return worldX >= area.x && worldX < area.x + area.width &&
         worldY >= area.y && worldY < area.y + area.height;
}

// Spawn point: center of Holy Dominion
function getSpawnPoint() {
  var area = getProtectedArea();
  return {
    x: area.x + area.width / 2,
    y: area.y + area.height / 2,
  };
}

// ---------------------------------------------------------------------------
// Region name at pixel position
// ---------------------------------------------------------------------------

function getRegionName(worldX, worldY) {
  var biome = getBiomeAtPixel(worldX, worldY);
  return BIOME_NAMES[biome] || 'Unknown';
}

// ---------------------------------------------------------------------------
// Generate resources for starter town area only (for initial zone state)
// Full overworld uses lazy chunk generation
// ---------------------------------------------------------------------------

function generateStarterAreaResources(worldSeed) {
  // Only generate resources for Holy Dominion + surrounding area
  // (roughly 20x20 chunks around spawn)
  var spawn = getSpawnPoint();
  var startCX = Math.floor(spawn.x / CHUNK_SIZE) - 10;
  var startCY = Math.floor(spawn.y / CHUNK_SIZE) - 10;
  var endCX = startCX + 20;
  var endCY = startCY + 20;

  var allResources = [];
  for (var cy = startCY; cy < endCY; cy++) {
    for (var cx = startCX; cx < endCX; cx++) {
      if (cx < 0 || cx >= WORLD_CHUNKS_X || cy < 0 || cy >= WORLD_CHUNKS_Y) continue;
      var chunkResources = generateChunkResources(cx, cy, worldSeed);
      for (var i = 0; i < chunkResources.length; i++) {
        allResources.push(chunkResources[i]);
      }
    }
  }
  return allResources;
}

// Initialize Hollow Earth sub-module with shared dependencies
hollowEarth.init({
  seededRandom, chunkSeed,
  CHUNK_SIZE, TILE_SIZE, TILES_PER_CHUNK, WORLD_CHUNKS_X, WORLD_CHUNKS_Y,
  getBiome, BIOME,
  FEATURE_NONE, FEATURE_CAVE_ENTRANCE, FEATURE_LAKE, FEATURE_SHALLOW_WATER, FEATURE_RIVER, FEATURE_THICK_FOREST,
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  CHUNK_SIZE,
  TILE_SIZE,
  TILES_PER_CHUNK,
  WORLD_CHUNKS_X,
  WORLD_CHUNKS_Y,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  WORLD_SCALE,
  GAME_DAY_SECONDS,
  OVERWORLD_WALK_SPEED,
  LOCAL_WALK_SPEED,
  MOUNT_SPEEDS,
  BIOME,
  BIOME_NAMES,
  BIOME_COLORS,
  BIOME_SPEED,
  BIOME_RESOURCES,
  RESOURCES_PER_CHUNK,
  // Feature constants
  FEATURE_NONE,
  FEATURE_RIVER,
  FEATURE_LAKE,
  FEATURE_SHALLOW_WATER,
  FEATURE_THICK_FOREST,
  FEATURE_CAVE_ENTRANCE,
  FEATURE_RIVERBANK,
  FEATURE_BRIDGE,
  FEATURE_WORLD_DUNGEON,
  FEATURE_SPEED,
  FEATURE_COLORS,
  // World dungeons
  WORLD_DUNGEONS,
  getWorldDungeonsInChunk,
  RIVERS,
  getRiverWorldTileX,
  // Hollow Earth (re-exported from worldgen-hollow-earth.js)
  HE_BIOME: hollowEarth.HE_BIOME,
  HE_BIOME_NAMES: hollowEarth.HE_BIOME_NAMES,
  HE_BIOME_COLORS: hollowEarth.HE_BIOME_COLORS,
  HE_BIOME_SPEED: hollowEarth.HE_BIOME_SPEED,
  HE_BIOME_RESOURCES: hollowEarth.HE_BIOME_RESOURCES,
  HE_RESOURCES_PER_CHUNK: hollowEarth.HE_RESOURCES_PER_CHUNK,
  getHollowEarthBiome: hollowEarth.getHollowEarthBiome,
  generateHollowEarthChunk: hollowEarth.generateHollowEarthChunk,
  // Surface functions
  getBiome,
  getBiomeAtPixel,
  isWalkable,
  getFeatureAtPixel,
  getSpeedMultiplier,
  generateChunkResources,
  generateChunkFeatures,
  generateChunk,
  getVisibleChunks,
  getProtectedArea,
  isProtectedArea,
  getSpawnPoint,
  generateStarterAreaResources,
  getRegionName,
  // Animal morphing: biome animals for overworld
  BIOME_ANIMALS,
  ANIMALS_PER_CHUNK,
  generateChunkAnimals,
  // Seeded RNG primitives (used by dungeon-data.js, etc.)
  seededRandom,
  chunkSeed,
};
