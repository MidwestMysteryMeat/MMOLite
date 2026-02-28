// seasonal/seasonal-crops.js
// Procedural crop pool generator. Picks 8-12 crops per season from a master pool
// and applies calendar-season modifiers to growth rates, yields, and availability.

var rng = require('./seasonal-rng');

// Master pool of all possible crops (current 10 + 10 exotic)
var CROP_MASTER_POOL = [
  // Original crops
  { key: 'wheat_seed',      output: 'wheat',         growthTime: 600,  farmLevel: 1,  xp: 15,  yieldMin: 2, yieldMax: 4, seedBackChance: 0.30, nightBonus: false, coldTolerant: false },
  { key: 'herb_seed',       output: 'herbs',         growthTime: 480,  farmLevel: 1,  xp: 12,  yieldMin: 1, yieldMax: 3, seedBackChance: 0.25, nightBonus: false, coldTolerant: false },
  { key: 'vegetable_seed',  output: 'vegetables',    growthTime: 720,  farmLevel: 3,  xp: 20,  yieldMin: 2, yieldMax: 5, seedBackChance: 0,    nightBonus: false, coldTolerant: false },
  { key: 'mushroom_spore',  output: 'mushroom',      growthTime: 360,  farmLevel: 2,  xp: 18,  yieldMin: 1, yieldMax: 3, seedBackChance: 0,    nightBonus: true,  coldTolerant: true },
  { key: 'berry_seed',      output: 'berries',       growthTime: 540,  farmLevel: 5,  xp: 22,  yieldMin: 3, yieldMax: 6, seedBackChance: 0,    nightBonus: false, coldTolerant: false },
  { key: 'tea_leaf_seed',   output: 'tea_leaves',    growthTime: 900,  farmLevel: 8,  xp: 30,  yieldMin: 1, yieldMax: 2, seedBackChance: 0,    nightBonus: false, coldTolerant: false },
  { key: 'pumpkin_seed',    output: 'pumpkin',       growthTime: 1200, farmLevel: 10, xp: 40,  yieldMin: 1, yieldMax: 2, seedBackChance: 0,    nightBonus: false, coldTolerant: false },
  { key: 'corn_seed',       output: 'corn',          growthTime: 900,  farmLevel: 7,  xp: 28,  yieldMin: 2, yieldMax: 4, seedBackChance: 0,    nightBonus: false, coldTolerant: false },
  { key: 'rare_flower_seed',output: 'rare_flower',   growthTime: 1800, farmLevel: 15, xp: 60,  yieldMin: 1, yieldMax: 1, seedBackChance: 0.05, nightBonus: false, coldTolerant: false },
  { key: 'ancient_seed',    output: 'ancient_fruit',  growthTime: 3600, farmLevel: 25, xp: 100, yieldMin: 1, yieldMax: 1, seedBackChance: 0.02, nightBonus: false, coldTolerant: false },
  // Exotic crops
  { key: 'frost_lily_seed',    output: 'frost_lily',     growthTime: 800,  farmLevel: 6,  xp: 25, yieldMin: 1, yieldMax: 2, seedBackChance: 0.10, nightBonus: true,  coldTolerant: true },
  { key: 'void_root_seed',     output: 'void_root',      growthTime: 1500, farmLevel: 18, xp: 55, yieldMin: 1, yieldMax: 1, seedBackChance: 0,    nightBonus: true,  coldTolerant: true },
  { key: 'sun_wheat_seed',     output: 'sun_wheat',      growthTime: 500,  farmLevel: 4,  xp: 18, yieldMin: 2, yieldMax: 5, seedBackChance: 0.20, nightBonus: false, coldTolerant: false },
  { key: 'shadow_moss_seed',   output: 'shadow_moss',    growthTime: 400,  farmLevel: 3,  xp: 14, yieldMin: 2, yieldMax: 4, seedBackChance: 0.15, nightBonus: true,  coldTolerant: true },
  { key: 'blood_vine_seed',    output: 'blood_vine',     growthTime: 1200, farmLevel: 12, xp: 42, yieldMin: 1, yieldMax: 2, seedBackChance: 0,    nightBonus: false, coldTolerant: false },
  { key: 'crystal_berry_seed', output: 'crystal_berry',  growthTime: 1000, farmLevel: 14, xp: 48, yieldMin: 1, yieldMax: 3, seedBackChance: 0.05, nightBonus: false, coldTolerant: true },
  { key: 'storm_grain_seed',   output: 'storm_grain',    growthTime: 700,  farmLevel: 9,  xp: 32, yieldMin: 2, yieldMax: 4, seedBackChance: 0.10, nightBonus: false, coldTolerant: false },
  { key: 'ember_pepper_seed',  output: 'ember_pepper',   growthTime: 600,  farmLevel: 7,  xp: 26, yieldMin: 2, yieldMax: 3, seedBackChance: 0,    nightBonus: false, coldTolerant: false },
  { key: 'moon_petal_seed',    output: 'moon_petal',     growthTime: 1400, farmLevel: 16, xp: 52, yieldMin: 1, yieldMax: 1, seedBackChance: 0.08, nightBonus: true,  coldTolerant: false },
  { key: 'deep_mushroom_seed', output: 'deep_mushroom',  growthTime: 450,  farmLevel: 5,  xp: 20, yieldMin: 1, yieldMax: 3, seedBackChance: 0.10, nightBonus: true,  coldTolerant: true },
];

// Season modifiers
var SEASON_MODS = {
  Frosthollow: { growthMult: 1.40, yieldBonus: 0,  seedBackBonus: 0,    xpMult: 1.0,  nightBonusBoost: true,  coldOnly: true,  pickCount: { min: 8, max: 10 } },
  Brightbloom: { growthMult: 1.00, yieldBonus: 1,  seedBackBonus: 0.05, xpMult: 1.0,  nightBonusBoost: false, coldOnly: false, pickCount: { min: 10, max: 12 } },
  Sunreign:    { growthMult: 0.80, yieldBonus: 0,  seedBackBonus: 0,    xpMult: 1.0,  nightBonusBoost: false, coldOnly: false, pickCount: { min: 9, max: 12 } },
  Ashwane:     { growthMult: 1.10, yieldBonus: 0,  seedBackBonus: 0,    xpMult: 1.25, nightBonusBoost: false, coldOnly: false, pickCount: { min: 7, max: 9 } },
};

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'crops');
  var mod = SEASON_MODS[calendarSeason] || SEASON_MODS.Brightbloom;

  // Filter pool by season constraints
  var available = CROP_MASTER_POOL;
  if (mod.coldOnly) {
    // Frosthollow: only cold-tolerant crops available
    available = available.filter(function(c) { return c.coldTolerant; });
    // Always include a few basics even in winter
    var basics = CROP_MASTER_POOL.filter(function(c) {
      return c.key === 'wheat_seed' || c.key === 'herb_seed';
    });
    for (var b = 0; b < basics.length; b++) {
      if (available.indexOf(basics[b]) === -1) available.push(basics[b]);
    }
  }

  var count = rng.range(r, mod.pickCount.min, mod.pickCount.max);
  var selected = rng.pickN(r, available, count);

  var CROP_DEFINITIONS = {};
  for (var i = 0; i < selected.length; i++) {
    var crop = selected[i];
    var def = {
      output: crop.output,
      growthTime: Math.round(crop.growthTime * mod.growthMult),
      farmLevel: crop.farmLevel,
      xp: Math.round(crop.xp * mod.xpMult),
      yieldMin: crop.yieldMin,
      yieldMax: crop.yieldMax + mod.yieldBonus,
      seedBackChance: Math.min(0.50, crop.seedBackChance + mod.seedBackBonus),
      nightBonus: crop.nightBonus || mod.nightBonusBoost,
    };
    // Apply per-crop variation (+/-10%)
    def.growthTime = rng.varyInt(r, def.growthTime, 0.10);
    def.xp = rng.varyInt(r, def.xp, 0.10);
    CROP_DEFINITIONS[crop.key] = def;
  }

  return { CROP_DEFINITIONS: CROP_DEFINITIONS };
}

// All possible crop outputs — for pre-registration in ALL_RESOURCE_TYPES
var ALL_CROP_OUTPUTS = [];
var ALL_CROP_SEEDS = [];
for (var i = 0; i < CROP_MASTER_POOL.length; i++) {
  ALL_CROP_OUTPUTS.push(CROP_MASTER_POOL[i].output);
  ALL_CROP_SEEDS.push(CROP_MASTER_POOL[i].key);
}

module.exports = {
  generate: generate,
  ALL_CROP_OUTPUTS: ALL_CROP_OUTPUTS,
  ALL_CROP_SEEDS: ALL_CROP_SEEDS,
  CROP_MASTER_POOL: CROP_MASTER_POOL,
};
