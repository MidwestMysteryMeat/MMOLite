// seasonal/seasonal-pets.js
// Procedural tameable creature generator. Picks 7-10 creatures per season
// from a master pool across biomes, varies speeds and evolution thresholds.

var rng = require('./seasonal-rng');

var PET_MASTER_POOL = [
  // Original 7
  { type: 'forest_wolf',   name: 'Forest Wolf',   biome: 'forest',    tamingLevel: 5,  tamingItem: 'raw_meat',    baseSpeed: 1.10, evolutions: [{level:10, name:'Elder Wolf', speedBonus:0.05},{level:20, name:'Dire Wolf', speedBonus:0.10}] },
  { type: 'forest_deer',   name: 'Forest Deer',   biome: 'forest',    tamingLevel: 3,  tamingItem: 'herbs',       baseSpeed: 1.15, evolutions: [{level:10, name:'Swift Deer', speedBonus:0.05},{level:20, name:'Ancient Stag', speedBonus:0.10}] },
  { type: 'plains_horse',  name: 'Plains Horse',  biome: 'plains',    tamingLevel: 8,  tamingItem: 'wheat',       baseSpeed: 1.20, evolutions: [{level:15, name:'Warhorse', speedBonus:0.05},{level:30, name:'Champion Steed', speedBonus:0.15}] },
  { type: 'desert_lizard', name: 'Desert Lizard', biome: 'desert',    tamingLevel: 4,  tamingItem: 'mushroom',    baseSpeed: 1.08, evolutions: [{level:10, name:'Sand Drake', speedBonus:0.07},{level:20, name:'Dune Serpent', speedBonus:0.12}] },
  { type: 'tundra_fox',    name: 'Tundra Fox',    biome: 'tundra',    tamingLevel: 6,  tamingItem: 'cooked_fish', baseSpeed: 1.12, evolutions: [{level:10, name:'Arctic Fox', speedBonus:0.08}] },
  { type: 'sea_turtle',    name: 'Sea Turtle',    biome: 'ocean',     tamingLevel: 10, tamingItem: 'seaweed',     baseSpeed: 1.05, evolutions: [{level:15, name:'Great Sea Turtle', speedBonus:0.10}] },
  { type: 'mountain_goat', name: 'Mountain Goat', biome: 'mountains', tamingLevel: 5,  tamingItem: 'herbs',       baseSpeed: 1.12, evolutions: [{level:10, name:'Alpine Ram', speedBonus:0.08},{level:25, name:'Thunderhorn', speedBonus:0.15}] },
  // Exotic creatures
  { type: 'frost_bear',     name: 'Frost Bear',     biome: 'tundra',    tamingLevel: 12, tamingItem: 'raw_meat',    baseSpeed: 1.05, evolutions: [{level:15, name:'Glacial Bear', speedBonus:0.05},{level:25, name:'Permafrost Guardian', speedBonus:0.12}] },
  { type: 'shadow_panther', name: 'Shadow Panther', biome: 'forest',    tamingLevel: 14, tamingItem: 'raw_meat',    baseSpeed: 1.18, evolutions: [{level:12, name:'Shade Stalker', speedBonus:0.06},{level:22, name:'Void Panther', speedBonus:0.14}] },
  { type: 'crystal_drake',  name: 'Crystal Drake',  biome: 'mountains', tamingLevel: 18, tamingItem: 'mana_crystal',baseSpeed: 1.14, evolutions: [{level:20, name:'Prism Drake', speedBonus:0.08},{level:35, name:'Crystal Wyrm', speedBonus:0.18}] },
  { type: 'ember_hawk',     name: 'Ember Hawk',     biome: 'desert',    tamingLevel: 10, tamingItem: 'raw_meat',    baseSpeed: 1.16, evolutions: [{level:12, name:'Fire Hawk', speedBonus:0.06},{level:24, name:'Phoenix Raptor', speedBonus:0.14}] },
  { type: 'storm_eagle',    name: 'Storm Eagle',    biome: 'highlands', tamingLevel: 15, tamingItem: 'cooked_fish', baseSpeed: 1.20, evolutions: [{level:18, name:'Thunder Eagle', speedBonus:0.08},{level:30, name:'Tempest Lord', speedBonus:0.16}] },
  { type: 'plains_bison',   name: 'Plains Bison',   biome: 'plains',    tamingLevel: 7,  tamingItem: 'wheat',       baseSpeed: 1.06, evolutions: [{level:14, name:'Great Bison', speedBonus:0.06},{level:28, name:'Ironhide Bull', speedBonus:0.12}] },
  { type: 'swamp_croc',     name: 'Swamp Croc',     biome: 'swamp',     tamingLevel: 9,  tamingItem: 'raw_meat',    baseSpeed: 1.04, evolutions: [{level:12, name:'Marsh Croc', speedBonus:0.05},{level:22, name:'Ancient Crocodile', speedBonus:0.10}] },
  { type: 'reef_dolphin',   name: 'Reef Dolphin',   biome: 'ocean',     tamingLevel: 11, tamingItem: 'fish',        baseSpeed: 1.22, evolutions: [{level:14, name:'Sea Dancer', speedBonus:0.08},{level:26, name:'Ocean Herald', speedBonus:0.14}] },
];

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'pets');

  var count = rng.range(r, 7, 10);
  var selected = rng.pickN(r, PET_MASTER_POOL, count);

  // Build biome-keyed output (same shape as TAMEABLE_CREATURES)
  var TAMEABLE_CREATURES = {};
  for (var i = 0; i < selected.length; i++) {
    var pet = selected[i];
    var biome = pet.biome;
    if (!TAMEABLE_CREATURES[biome]) TAMEABLE_CREATURES[biome] = [];

    // Vary base speed +/-10%
    var speed = rng.varyRound(r, pet.baseSpeed, 0.10);
    speed = Math.max(1.0, speed);

    // Vary evolution thresholds
    var evos = [];
    for (var e = 0; e < pet.evolutions.length; e++) {
      var evo = pet.evolutions[e];
      evos.push({
        level: rng.varyInt(r, evo.level, 0.15),
        name: evo.name,
        speedBonus: rng.varyRound(r, evo.speedBonus, 0.10),
      });
    }

    TAMEABLE_CREATURES[biome].push({
      type: pet.type,
      name: pet.name,
      tamingLevel: pet.tamingLevel,
      tamingItem: pet.tamingItem,
      baseSpeed: speed,
      evolutions: evos,
    });
  }

  return { TAMEABLE_CREATURES: TAMEABLE_CREATURES };
}

module.exports = {
  generate: generate,
  PET_MASTER_POOL: PET_MASTER_POOL,
};
