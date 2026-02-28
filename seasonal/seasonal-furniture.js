// seasonal/seasonal-furniture.js
// Procedural furniture effects generator. Picks 8-10 furniture types per season
// from a master pool, varies effect values and stack limits.

var rng = require('./seasonal-rng');

var FURNITURE_MASTER_POOL = [
  // Original 8
  { key: 'bed',           effect: 'rested_buff',    baseValue: { vigBonus: 2, xpBonus: 0.10, duration: 600 }, stackLimit: 1, description: 'Sleep → +2 VIG, +10% XP for 10min', valueIsObj: true },
  { key: 'bookshelf',     effect: 'skill_xp_bonus', baseValue: 0.05,  stackLimit: 3,  description: '+5% all skill XP on plot (max 15%)' },
  { key: 'lantern',       effect: 'night_penalty',  baseValue: -0.10, stackLimit: 6,  description: '-10% night penalty on plot' },
  { key: 'clock',         effect: 'crop_growth',    baseValue: 0.05,  stackLimit: 1,  description: '+5% crop growth speed' },
  { key: 'scarecrow',     effect: 'wither_prevent', baseValue: 0.15,  stackLimit: 4,  description: '15% prevent crop wither' },
  { key: 'well',          effect: 'water_radius',   baseValue: 400,   stackLimit: 1,  description: '400px water radius (vs 200px trough)' },
  { key: 'sprinkler',     effect: 'auto_water',     baseValue: 150,   stackLimit: 99, description: 'Auto-water crops within 150px each tick' },
  { key: 'trophy_mount',  effect: 'presence_bonus', baseValue: 1,     stackLimit: 5,  description: '+1 Presence per trophy' },
  // Exotic furniture
  { key: 'frost_hearth',    effect: 'cold_resist',    baseValue: 0.10,  stackLimit: 2,  description: '+10% cold resistance on plot' },
  { key: 'sun_dial',        effect: 'day_bonus',      baseValue: 0.08,  stackLimit: 1,  description: '+8% resource yield during day' },
  { key: 'rain_barrel',     effect: 'rain_harvest',   baseValue: 0.05,  stackLimit: 3,  description: '+5% crop growth during rain' },
  { key: 'wind_chime',      effect: 'mood_boost',     baseValue: 0.03,  stackLimit: 4,  description: '+3% companion happiness retention' },
  { key: 'crystal_lamp',    effect: 'mana_regen',     baseValue: 0.02,  stackLimit: 3,  description: '+2% mana regen on plot' },
  { key: 'alchemist_shelf', effect: 'potion_bonus',   baseValue: 0.10,  stackLimit: 2,  description: '+10% potion crafting quality' },
];

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'furniture');

  var count = rng.range(r, 8, 10);
  var selected = rng.pickN(r, FURNITURE_MASTER_POOL, count);

  var FURNITURE_EFFECTS = {};
  for (var i = 0; i < selected.length; i++) {
    var furn = selected[i];
    var value = furn.baseValue;
    if (!furn.valueIsObj) {
      value = rng.varyRound(r, furn.baseValue, 0.20);
    }
    FURNITURE_EFFECTS[furn.key] = {
      effect: furn.effect,
      value: value,
      stackLimit: furn.stackLimit,
      description: furn.description,
    };
  }

  return { FURNITURE_EFFECTS: FURNITURE_EFFECTS };
}

module.exports = {
  generate: generate,
  FURNITURE_MASTER_POOL: FURNITURE_MASTER_POOL,
};
