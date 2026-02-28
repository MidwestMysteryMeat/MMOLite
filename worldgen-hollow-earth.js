// worldgen-hollow-earth.js
// Hollow Earth sub-world generation — underground biome system mirroring surface geography

var seededRandom, chunkSeed;
var CHUNK_SIZE, TILE_SIZE, TILES_PER_CHUNK, WORLD_CHUNKS_X, WORLD_CHUNKS_Y;
var getBiome, BIOME;
var FEATURE_NONE, FEATURE_CAVE_ENTRANCE, FEATURE_LAKE, FEATURE_SHALLOW_WATER, FEATURE_RIVER, FEATURE_THICK_FOREST;

function init(deps) {
  seededRandom = deps.seededRandom;
  chunkSeed = deps.chunkSeed;
  CHUNK_SIZE = deps.CHUNK_SIZE;
  TILE_SIZE = deps.TILE_SIZE;
  TILES_PER_CHUNK = deps.TILES_PER_CHUNK;
  WORLD_CHUNKS_X = deps.WORLD_CHUNKS_X;
  WORLD_CHUNKS_Y = deps.WORLD_CHUNKS_Y;
  getBiome = deps.getBiome;
  BIOME = deps.BIOME;
  FEATURE_NONE = deps.FEATURE_NONE;
  FEATURE_CAVE_ENTRANCE = deps.FEATURE_CAVE_ENTRANCE;
  FEATURE_LAKE = deps.FEATURE_LAKE;
  FEATURE_SHALLOW_WATER = deps.FEATURE_SHALLOW_WATER;
  FEATURE_RIVER = deps.FEATURE_RIVER;
  FEATURE_THICK_FOREST = deps.FEATURE_THICK_FOREST;
}

// ===========================================================================
// HOLLOW EARTH — Underground world (same dimensions as surface)
// ===========================================================================

const HE_BIOME = {
  STONE: 100,
  DANK_CAVE: 101,
  MUSHROOM_FOREST: 102,
  BIOLUMINESCENT: 103,
  UNDERGROUND_JUNGLE: 104,
  CRYSTAL_CAVERN: 105,
  LAVA_FIELDS: 106,
  UNDERGROUND_LAKE: 107,
  FUNGAL_SWAMP: 108,
  DEEP_DARK: 109,
  ROOT_NETWORK: 110,
  HOLLOW_PLAINS: 111,
};

const HE_BIOME_NAMES = {
  [HE_BIOME.STONE]: 'Barren Stone',
  [HE_BIOME.DANK_CAVE]: 'Dank Caverns',
  [HE_BIOME.MUSHROOM_FOREST]: 'Mushroom Forest',
  [HE_BIOME.BIOLUMINESCENT]: 'Bioluminescent Grotto',
  [HE_BIOME.UNDERGROUND_JUNGLE]: 'Underground Jungle',
  [HE_BIOME.CRYSTAL_CAVERN]: 'Crystal Cavern',
  [HE_BIOME.LAVA_FIELDS]: 'Lava Fields',
  [HE_BIOME.UNDERGROUND_LAKE]: 'The Sunless Sea',
  [HE_BIOME.FUNGAL_SWAMP]: 'Fungal Swamp',
  [HE_BIOME.DEEP_DARK]: 'The Deep Dark',
  [HE_BIOME.ROOT_NETWORK]: 'The Root Network',
  [HE_BIOME.HOLLOW_PLAINS]: 'Hollow Plains',
};

const HE_BIOME_COLORS = {
  [HE_BIOME.STONE]: { r: 70, g: 65, b: 60 },
  [HE_BIOME.DANK_CAVE]: { r: 50, g: 50, b: 45 },
  [HE_BIOME.MUSHROOM_FOREST]: { r: 90, g: 55, b: 100 },
  [HE_BIOME.BIOLUMINESCENT]: { r: 30, g: 80, b: 90 },
  [HE_BIOME.UNDERGROUND_JUNGLE]: { r: 25, g: 75, b: 30 },
  [HE_BIOME.CRYSTAL_CAVERN]: { r: 70, g: 90, b: 130 },
  [HE_BIOME.LAVA_FIELDS]: { r: 120, g: 45, b: 20 },
  [HE_BIOME.UNDERGROUND_LAKE]: { r: 25, g: 45, b: 80 },
  [HE_BIOME.FUNGAL_SWAMP]: { r: 55, g: 65, b: 35 },
  [HE_BIOME.DEEP_DARK]: { r: 20, g: 18, b: 25 },
  [HE_BIOME.ROOT_NETWORK]: { r: 60, g: 45, b: 30 },
  [HE_BIOME.HOLLOW_PLAINS]: { r: 55, g: 70, b: 50 },
};

const HE_BIOME_SPEED = {
  [HE_BIOME.STONE]: 0.7,
  [HE_BIOME.DANK_CAVE]: 0.6,
  [HE_BIOME.MUSHROOM_FOREST]: 0.7,
  [HE_BIOME.BIOLUMINESCENT]: 0.8,
  [HE_BIOME.UNDERGROUND_JUNGLE]: 0.5,
  [HE_BIOME.CRYSTAL_CAVERN]: 0.8,
  [HE_BIOME.LAVA_FIELDS]: 0.4,
  [HE_BIOME.UNDERGROUND_LAKE]: 0,       // impassable
  [HE_BIOME.FUNGAL_SWAMP]: 0.5,
  [HE_BIOME.DEEP_DARK]: 0.3,
  [HE_BIOME.ROOT_NETWORK]: 0.6,
  [HE_BIOME.HOLLOW_PLAINS]: 0.9,
};

const HE_BIOME_RESOURCES = {
  [HE_BIOME.STONE]: [
    { type: 'stone', name: 'Cave Stone', skill: 'mining', minLevel: 1, xp: 15, weight: 4 },
    { type: 'iron', name: 'Deep Iron', skill: 'mining', minLevel: 3, xp: 30, weight: 2 },
  ],
  [HE_BIOME.DANK_CAVE]: [
    { type: 'stone', name: 'Wet Rock', skill: 'mining', minLevel: 1, xp: 15, weight: 3 },
    { type: 'iron', name: 'Rust Vein', skill: 'mining', minLevel: 3, xp: 25, weight: 2 },
  ],
  [HE_BIOME.MUSHROOM_FOREST]: [
    { type: 'tree', name: 'Giant Mushroom', skill: 'woodcutting', minLevel: 1, xp: 15, weight: 5 },
    { type: 'tree', name: 'Spore Cap', skill: 'woodcutting', minLevel: 1, xp: 12, weight: 3 },
    { type: 'stone', name: 'Mycelium Rock', skill: 'mining', minLevel: 1, xp: 15, weight: 1 },
  ],
  [HE_BIOME.BIOLUMINESCENT]: [
    { type: 'stone', name: 'Glowstone', skill: 'mining', minLevel: 3, xp: 30, weight: 3 },
    { type: 'iron', name: 'Luminite Ore', skill: 'mining', minLevel: 5, xp: 40, weight: 2 },
    { type: 'tree', name: 'Light Tendril', skill: 'woodcutting', minLevel: 1, xp: 15, weight: 2 },
  ],
  [HE_BIOME.UNDERGROUND_JUNGLE]: [
    { type: 'tree', name: 'Cave Vine', skill: 'woodcutting', minLevel: 1, xp: 12, weight: 5 },
    { type: 'tree', name: 'Root Tree', skill: 'woodcutting', minLevel: 1, xp: 15, weight: 4 },
    { type: 'stone', name: 'Jungle Stone', skill: 'mining', minLevel: 1, xp: 15, weight: 1 },
    { type: 'iron', name: 'Verdant Ore', skill: 'mining', minLevel: 3, xp: 30, weight: 1 },
  ],
  [HE_BIOME.CRYSTAL_CAVERN]: [
    { type: 'stone', name: 'Crystal Shard', skill: 'mining', minLevel: 3, xp: 35, weight: 4 },
    { type: 'iron', name: 'Prismatic Ore', skill: 'mining', minLevel: 5, xp: 45, weight: 2 },
  ],
  [HE_BIOME.LAVA_FIELDS]: [
    { type: 'stone', name: 'Obsidian', skill: 'mining', minLevel: 5, xp: 40, weight: 3 },
    { type: 'iron', name: 'Magma Core', skill: 'mining', minLevel: 7, xp: 50, weight: 1 },
  ],
  [HE_BIOME.UNDERGROUND_LAKE]: [],
  [HE_BIOME.FUNGAL_SWAMP]: [
    { type: 'tree', name: 'Mold Stalk', skill: 'woodcutting', minLevel: 1, xp: 12, weight: 4 },
    { type: 'stone', name: 'Bog Stone', skill: 'mining', minLevel: 1, xp: 15, weight: 2 },
    { type: 'iron', name: 'Corrosion Vein', skill: 'mining', minLevel: 3, xp: 30, weight: 1 },
  ],
  [HE_BIOME.DEEP_DARK]: [
    { type: 'stone', name: 'Void Rock', skill: 'mining', minLevel: 5, xp: 40, weight: 3 },
    { type: 'iron', name: 'Darksteel', skill: 'mining', minLevel: 7, xp: 55, weight: 1 },
  ],
  [HE_BIOME.ROOT_NETWORK]: [
    { type: 'tree', name: 'World Root', skill: 'woodcutting', minLevel: 3, xp: 25, weight: 4 },
    { type: 'tree', name: 'Root Fiber', skill: 'woodcutting', minLevel: 1, xp: 12, weight: 3 },
    { type: 'stone', name: 'Petrified Root', skill: 'mining', minLevel: 1, xp: 20, weight: 1 },
  ],
  [HE_BIOME.HOLLOW_PLAINS]: [
    { type: 'tree', name: 'Pale Grass Tuft', skill: 'woodcutting', minLevel: 1, xp: 10, weight: 3 },
    { type: 'stone', name: 'Smooth Stone', skill: 'mining', minLevel: 1, xp: 15, weight: 3 },
    { type: 'iron', name: 'Deep Iron', skill: 'mining', minLevel: 3, xp: 30, weight: 1 },
  ],
};

const HE_RESOURCES_PER_CHUNK = {
  [HE_BIOME.STONE]: { min: 2, max: 4 },
  [HE_BIOME.DANK_CAVE]: { min: 2, max: 4 },
  [HE_BIOME.MUSHROOM_FOREST]: { min: 4, max: 7 },
  [HE_BIOME.BIOLUMINESCENT]: { min: 3, max: 5 },
  [HE_BIOME.UNDERGROUND_JUNGLE]: { min: 5, max: 8 },
  [HE_BIOME.CRYSTAL_CAVERN]: { min: 3, max: 5 },
  [HE_BIOME.LAVA_FIELDS]: { min: 1, max: 3 },
  [HE_BIOME.UNDERGROUND_LAKE]: { min: 0, max: 0 },
  [HE_BIOME.FUNGAL_SWAMP]: { min: 3, max: 6 },
  [HE_BIOME.DEEP_DARK]: { min: 1, max: 3 },
  [HE_BIOME.ROOT_NETWORK]: { min: 4, max: 7 },
  [HE_BIOME.HOLLOW_PLAINS]: { min: 3, max: 5 },
};

// ---------------------------------------------------------------------------
// Hollow Earth biome detection
// ---------------------------------------------------------------------------
// The Hollow Earth mirrors the surface geography but transforms biomes.
// Surface continent areas become traversable underground zones,
// surface ocean areas become underground lakes / deep dark.
// The mapping creates large, coherent biome regions underground.

function getHollowEarthBiome(cx, cy) {
  if (cx < 0 || cx >= WORLD_CHUNKS_X || cy < 0 || cy >= WORLD_CHUNKS_Y) return HE_BIOME.UNDERGROUND_LAKE;

  var surfaceBiome = getBiome(cx, cy);

  // Noise for variation within regions
  var rng = seededRandom(chunkSeed(cx, cy, 'hollow_earth_biome'));
  var noise1 = rng();
  var noise2 = rng();

  // Surface water -> underground lake (subterranean seas)
  if (surfaceBiome === BIOME.WATER) return HE_BIOME.UNDERGROUND_LAKE;

  // =========================================================================
  // Large-scale Hollow Earth zone assignment (mapped to new world coordinates)
  // Reference: Hollow Earth effectively doubles the map — each surface region
  // has a corresponding underground biome set matching reference lore
  // =========================================================================

  // Northern Tundra (cy 900-1130) -> Crystal Caverns + Deep Dark
  // ref: hollow under northern tundra continent
  if (cy < 1130) {
    if (noise1 < 0.3) return HE_BIOME.CRYSTAL_CAVERN;
    if (noise1 < 0.55) return HE_BIOME.DEEP_DARK;
    if (noise1 < 0.75) return HE_BIOME.LAVA_FIELDS; // geothermal
    return HE_BIOME.STONE;
  }

  // Frostbound Reach (cy 1150-1200) -> Crystal Caverns + Lava Fields (volcanic)
  if (cy < 1200) {
    if (surfaceBiome === BIOME.FROSTBOUND) {
      if (noise1 < 0.35) return HE_BIOME.CRYSTAL_CAVERN;
      if (noise1 < 0.60) return HE_BIOME.LAVA_FIELDS;
      if (noise1 < 0.80) return HE_BIOME.DEEP_DARK;
      return HE_BIOME.STONE;
    }
    return HE_BIOME.UNDERGROUND_LAKE; // beneath frozen seas
  }

  // Great Endless Desert (cy 1200-1249) -> Lava Fields + Crystal Caverns
  // ref: lizard folk hidden river empires beneath the sands
  if (cy < 1250) {
    if (surfaceBiome === BIOME.DESERT || surfaceBiome === BIOME.SCORCHED_SANDS) {
      if (noise1 < 0.30) return HE_BIOME.LAVA_FIELDS;
      if (noise1 < 0.55) return HE_BIOME.CRYSTAL_CAVERN;
      if (noise1 < 0.75) return HE_BIOME.UNDERGROUND_LAKE; // hidden underground rivers
      return HE_BIOME.DANK_CAVE;
    }
    if (surfaceBiome === BIOME.BEACH) return noise1 < 0.5 ? HE_BIOME.DANK_CAVE : HE_BIOME.STONE;
    return HE_BIOME.UNDERGROUND_LAKE;
  }

  // Main Continent (cy 1250-1313) — the most diverse underground
  // ref: Hollow Fungal Forests, Hollow Jungle, Crystal Caverns, Bone Wastes,
  //      Storm Caverns, Deep Dwarven Realm, Subterranean Seas
  if (cy < 1314) {
    // Dwarven Mountains (cx 1018-1045, cy 1250-1268) -> Deep Dwarven Realm
    if (surfaceBiome === BIOME.MOUNTAIN) {
      if (noise1 < 0.25) return HE_BIOME.LAVA_FIELDS;
      if (noise1 < 0.55) return HE_BIOME.CRYSTAL_CAVERN;
      if (noise1 < 0.80) return HE_BIOME.DEEP_DARK;
      return HE_BIOME.STONE;
    }
    // Forests -> Underground Jungle + Root Network + Mushroom Forest
    if (surfaceBiome === BIOME.FOREST) {
      if (noise1 < 0.30) return HE_BIOME.UNDERGROUND_JUNGLE;
      if (noise1 < 0.55) return HE_BIOME.ROOT_NETWORK;
      if (noise1 < 0.75) return HE_BIOME.MUSHROOM_FOREST;
      return HE_BIOME.DANK_CAVE;
    }
    // Plains / Holy Dominion -> Hollow Plains + Mushroom Forest + Bioluminescent
    if (surfaceBiome === BIOME.PLAINS || surfaceBiome === BIOME.HOLY_DOMINION) {
      if (noise1 < 0.30) return HE_BIOME.HOLLOW_PLAINS;
      if (noise1 < 0.55) return HE_BIOME.MUSHROOM_FOREST;
      if (noise1 < 0.75) return HE_BIOME.BIOLUMINESCENT;
      return HE_BIOME.DANK_CAVE;
    }
    // Steppes -> Hollow Plains + Stone
    if (surfaceBiome === BIOME.STEPPES) {
      if (noise1 < 0.35) return HE_BIOME.HOLLOW_PLAINS;
      if (noise1 < 0.60) return HE_BIOME.STONE;
      return HE_BIOME.DANK_CAVE;
    }
    // Shadowfen -> Fungal Swamp + Mushroom Forest
    if (surfaceBiome === BIOME.SWAMP) {
      if (noise1 < 0.40) return HE_BIOME.FUNGAL_SWAMP;
      if (noise1 < 0.65) return HE_BIOME.MUSHROOM_FOREST;
      return HE_BIOME.DANK_CAVE;
    }
    // Elven South -> Bioluminescent + Root Network + Jungle
    if (surfaceBiome === BIOME.ELVEN_SOUTH) {
      if (noise1 < 0.35) return HE_BIOME.BIOLUMINESCENT;
      if (noise1 < 0.60) return HE_BIOME.ROOT_NETWORK;
      if (noise1 < 0.80) return HE_BIOME.UNDERGROUND_JUNGLE;
      return HE_BIOME.MUSHROOM_FOREST;
    }
    // Gnomish Isles -> Crystal Cavern + Bioluminescent
    if (surfaceBiome === BIOME.GNOMISH_ISLES) {
      if (noise1 < 0.40) return HE_BIOME.CRYSTAL_CAVERN;
      if (noise1 < 0.70) return HE_BIOME.BIOLUMINESCENT;
      return HE_BIOME.STONE;
    }
    // Mechspire / Clockwork -> Lava Fields (industrial underground)
    if (surfaceBiome === BIOME.MECHSPIRE || surfaceBiome === BIOME.CLOCKWORK_HARBOR) {
      if (noise1 < 0.40) return HE_BIOME.LAVA_FIELDS;
      if (noise1 < 0.70) return HE_BIOME.STONE;
      return HE_BIOME.DEEP_DARK;
    }
    // Scorched Sands -> Lava + Crystal
    if (surfaceBiome === BIOME.SCORCHED_SANDS) {
      if (noise1 < 0.40) return HE_BIOME.LAVA_FIELDS;
      return HE_BIOME.CRYSTAL_CAVERN;
    }
    // Beach/coast
    if (surfaceBiome === BIOME.BEACH) {
      return noise1 < 0.5 ? HE_BIOME.DANK_CAVE : HE_BIOME.STONE;
    }
    return HE_BIOME.STONE;
  }

  // Wastes of Calidar (cy 1314-1329) -> Bone Wastes + Deep Dark + Lava
  // ref: hollow_bone_wastes — necromantic energy, ancient battlefields
  if (cy < 1330) {
    if (surfaceBiome === BIOME.WASTES) {
      if (noise1 < 0.30) return HE_BIOME.DEEP_DARK;
      if (noise1 < 0.55) return HE_BIOME.LAVA_FIELDS;
      if (noise1 < 0.75) return HE_BIOME.CRYSTAL_CAVERN;
      return HE_BIOME.STONE;
    }
    return noise1 < 0.3 ? HE_BIOME.DANK_CAVE : HE_BIOME.STONE;
  }

  // Southern Ocean (cy 1330-1499) -> Subterranean Seas
  if (cy < 1500) return HE_BIOME.UNDERGROUND_LAKE;

  // Southern Wastes / Tundra (cy 1500-1599) -> Deep Dark + Lava
  if (cy < 1600) {
    if (noise1 < 0.35) return HE_BIOME.DEEP_DARK;
    if (noise1 < 0.60) return HE_BIOME.LAVA_FIELDS;
    return HE_BIOME.STONE;
  }

  // Southern Frostbound (cy 1600-1800) -> Crystal + Deep Dark
  if (cy < 1800) {
    if (noise1 < 0.45) return HE_BIOME.CRYSTAL_CAVERN;
    return HE_BIOME.DEEP_DARK;
  }

  // Polar Ocean (cy 1800+) -> Subterranean Seas
  return HE_BIOME.UNDERGROUND_LAKE;
}

// ---------------------------------------------------------------------------
// Hollow Earth feature generation (exit caves back to surface)
// ---------------------------------------------------------------------------

const HE_EXIT_CAVE_NAMES = [
  'Passage to the Surface', 'Skyward Shaft', 'Ascent Tunnel',
  'The Way Up', 'Surface Breach', 'Daylight Rift',
  'Emergence Point', 'Root Stairway', 'Crystal Chimney',
  'The Breathing Hole', 'Sunward Climb', 'The Upper Way',
];

function generateHollowEarthFeatures(cx, cy, worldSeed) {
  var biome = getHollowEarthBiome(cx, cy);
  if (biome === HE_BIOME.UNDERGROUND_LAKE) return { features: null, featureMeta: undefined };

  var features = new Array(TILES_PER_CHUNK * TILES_PER_CHUNK).fill(FEATURE_NONE);
  var featureMeta = [];
  var rng = seededRandom(chunkSeed(cx, cy, worldSeed + ':he_features'));

  // Exit caves (lead back to surface) — similar density to surface caves
  var exitChance = 0.012;
  if (biome === HE_BIOME.HOLLOW_PLAINS || biome === HE_BIOME.BIOLUMINESCENT) exitChance = 0.02;
  if (biome === HE_BIOME.DEEP_DARK || biome === HE_BIOME.LAVA_FIELDS) exitChance = 0.006;

  if (rng() < exitChance) {
    var tx = 2 + Math.floor(rng() * 12);
    var ty = 2 + Math.floor(rng() * 12);
    var idx = ty * TILES_PER_CHUNK + tx;
    features[idx] = FEATURE_CAVE_ENTRANCE;
    var nameIdx = Math.floor(rng() * HE_EXIT_CAVE_NAMES.length);
    featureMeta.push({
      type: 'cave',
      tx: tx,
      ty: ty,
      worldX: cx * CHUNK_SIZE + tx * TILE_SIZE + TILE_SIZE / 2,
      worldY: cy * CHUNK_SIZE + ty * TILE_SIZE + TILE_SIZE / 2,
      name: HE_EXIT_CAVE_NAMES[nameIdx],
      surfaceExit: true,  // leads back to overworld
    });
  }

  // Underground lakes in fungal swamp / dank cave
  if (biome === HE_BIOME.FUNGAL_SWAMP || biome === HE_BIOME.DANK_CAVE) {
    if (rng() < 0.15) {
      var lCX = 3 + Math.floor(rng() * 10);
      var lCY = 3 + Math.floor(rng() * 10);
      var lR = 2 + Math.floor(rng() * 2);
      for (var ly = 0; ly < TILES_PER_CHUNK; ly++) {
        for (var lx = 0; lx < TILES_PER_CHUNK; lx++) {
          var ld = Math.sqrt((lx - lCX) * (lx - lCX) + (ly - lCY) * (ly - lCY));
          var li = ly * TILES_PER_CHUNK + lx;
          if (features[li] !== FEATURE_NONE) continue;
          if (ld < lR * 0.7) features[li] = FEATURE_LAKE;
          else if (ld < lR) features[li] = FEATURE_SHALLOW_WATER;
        }
      }
    }
  }

  // Lava pools in lava fields
  if (biome === HE_BIOME.LAVA_FIELDS) {
    if (rng() < 0.25) {
      var laCX = 3 + Math.floor(rng() * 10);
      var laCY = 3 + Math.floor(rng() * 10);
      var laR = 1 + Math.floor(rng() * 3);
      for (var lay = 0; lay < TILES_PER_CHUNK; lay++) {
        for (var lax = 0; lax < TILES_PER_CHUNK; lax++) {
          var laD = Math.sqrt((lax - laCX) * (lax - laCX) + (lay - laCY) * (lay - laCY));
          var laI = lay * TILES_PER_CHUNK + lax;
          if (features[laI] !== FEATURE_NONE) continue;
          if (laD < laR) features[laI] = FEATURE_RIVER; // reuse river as lava (blocked)
        }
      }
    }
  }

  // Dense vegetation in jungle / mushroom / root
  if (biome === HE_BIOME.UNDERGROUND_JUNGLE || biome === HE_BIOME.MUSHROOM_FOREST || biome === HE_BIOME.ROOT_NETWORK) {
    if (rng() < 0.30) {
      var clusters = 1 + Math.floor(rng() * 3);
      for (var ci = 0; ci < clusters; ci++) {
        var vCX = 2 + Math.floor(rng() * 12);
        var vCY = 2 + Math.floor(rng() * 12);
        var vR = 2 + Math.floor(rng() * 3);
        for (var vy = Math.max(0, vCY - vR); vy <= Math.min(15, vCY + vR); vy++) {
          for (var vx = Math.max(0, vCX - vR); vx <= Math.min(15, vCX + vR); vx++) {
            if ((vx - vCX) * (vx - vCX) + (vy - vCY) * (vy - vCY) <= vR * vR) {
              var vi = vy * TILES_PER_CHUNK + vx;
              if (features[vi] === FEATURE_NONE) features[vi] = FEATURE_THICK_FOREST;
            }
          }
        }
      }
    }
  }

  var hasFeatures = false;
  for (var fi = 0; fi < features.length; fi++) {
    if (features[fi] !== FEATURE_NONE) { hasFeatures = true; break; }
  }

  return {
    features: hasFeatures ? features : null,
    featureMeta: featureMeta.length > 0 ? featureMeta : undefined,
  };
}

// ---------------------------------------------------------------------------
// Hollow Earth chunk generation
// ---------------------------------------------------------------------------

function generateHollowEarthChunkResources(cx, cy, worldSeed) {
  var biome = getHollowEarthBiome(cx, cy);
  var spawnTable = HE_BIOME_RESOURCES[biome];
  if (!spawnTable || spawnTable.length === 0) return [];

  var countRange = HE_RESOURCES_PER_CHUNK[biome] || { min: 0, max: 0 };
  var rng = seededRandom(chunkSeed(cx, cy, worldSeed + ':he_res'));
  var count = countRange.min + Math.floor(rng() * (countRange.max - countRange.min + 1));

  var resources = [];
  var totalWeight = 0;
  for (var w = 0; w < spawnTable.length; w++) totalWeight += spawnTable[w].weight;

  var margin = 40;
  for (var i = 0; i < count; i++) {
    var roll = rng() * totalWeight;
    var picked = spawnTable[0];
    var cumulative = 0;
    for (var j = 0; j < spawnTable.length; j++) {
      cumulative += spawnTable[j].weight;
      if (roll < cumulative) { picked = spawnTable[j]; break; }
    }

    var localX = margin + rng() * (CHUNK_SIZE - margin * 2);
    var localY = margin + rng() * (CHUNK_SIZE - margin * 2);
    var worldX = cx * CHUNK_SIZE + localX;
    var worldY = cy * CHUNK_SIZE + localY;

    var hp = picked.type === 'tree' ? 5 : picked.type === 'iron' ? 10 : 8;
    resources.push({
      id: 'he_r_' + cx + '_' + cy + '_' + i,
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

function generateHollowEarthChunk(cx, cy, worldSeed) {
  var biome = getHollowEarthBiome(cx, cy);
  var featureData = generateHollowEarthFeatures(cx, cy, worldSeed);
  var resources = generateHollowEarthChunkResources(cx, cy, worldSeed);

  // Remove resources on blocked tiles
  if (featureData.features && resources.length > 0) {
    resources = resources.filter(function(r) {
      var localX = r.x - cx * CHUNK_SIZE;
      var localY = r.y - cy * CHUNK_SIZE;
      var txx = Math.floor(localX / TILE_SIZE);
      var tyy = Math.floor(localY / TILE_SIZE);
      txx = Math.max(0, Math.min(TILES_PER_CHUNK - 1, txx));
      tyy = Math.max(0, Math.min(TILES_PER_CHUNK - 1, tyy));
      var feat = featureData.features[tyy * TILES_PER_CHUNK + txx];
      return feat !== FEATURE_RIVER && feat !== FEATURE_LAKE;
    });
  }

  return {
    cx: cx,
    cy: cy,
    biome: biome,
    biomeName: HE_BIOME_NAMES[biome] || 'Unknown Depths',
    biomeColor: HE_BIOME_COLORS[biome] || { r: 50, g: 50, b: 50 },
    walkable: biome !== HE_BIOME.UNDERGROUND_LAKE,
    speedMultiplier: HE_BIOME_SPEED[biome] || 0,
    resources: resources,
    features: featureData.features,
    featureMeta: featureData.featureMeta,
    worldX: cx * CHUNK_SIZE,
    worldY: cy * CHUNK_SIZE,
    width: CHUNK_SIZE,
    height: CHUNK_SIZE,
  };
}

module.exports = {
  init,
  HE_BIOME,
  HE_BIOME_NAMES,
  HE_BIOME_COLORS,
  HE_BIOME_SPEED,
  HE_BIOME_RESOURCES,
  HE_RESOURCES_PER_CHUNK,
  getHollowEarthBiome,
  generateHollowEarthChunk,
};
