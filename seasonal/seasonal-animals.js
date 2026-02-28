// seasonal/seasonal-animals.js
// Procedural farm animal pool generator. Picks 4-6 animals per season from
// a master pool, varies costs and production intervals by season.

var rng = require('./seasonal-rng');

var ANIMAL_MASTER_POOL = [
  // Original 5
  { key: 'chicken',        cost: 50,  feedType: 'wheat',      feedAmount: 1, feedInterval: 600,  products: [{ type: 'egg', min: 1, max: 2 }, { type: 'feather', min: 1, max: 1, chance: 0.30 }], productInterval: 300,  farmLevel: 5,  maxPerPen: 4, seasonal: null },
  { key: 'cow',            cost: 200, feedType: 'wheat',      feedAmount: 3, feedInterval: 600,  products: [{ type: 'milk', min: 1, max: 1 }],                                                   productInterval: 600,  farmLevel: 10, maxPerPen: 2, seasonal: null },
  { key: 'sheep',          cost: 150, feedType: 'wheat',      feedAmount: 2, feedInterval: 600,  products: [{ type: 'raw_wool', min: 1, max: 2 }],                                                productInterval: 900,  farmLevel: 8,  maxPerPen: 3, seasonal: null },
  { key: 'pig',            cost: 120, feedType: 'vegetables', feedAmount: 2, feedInterval: 600,  products: [{ type: 'mushroom', min: 1, max: 3, chance: 0.60 }],                                  productInterval: 1200, farmLevel: 12, maxPerPen: 3, seasonal: null },
  { key: 'bee_hive',       cost: 300, feedType: null,         feedAmount: 0, feedInterval: 0,    products: [{ type: 'honey', min: 1, max: 1 }],                                                   productInterval: 1800, farmLevel: 15, maxPerPen: 1, seasonal: null },
  // Exotic animals
  { key: 'crystal_moth',   cost: 250, feedType: 'herbs',      feedAmount: 1, feedInterval: 600,  products: [{ type: 'mana_crystal', min: 1, max: 1, chance: 0.40 }],                              productInterval: 1500, farmLevel: 18, maxPerPen: 2, seasonal: null },
  { key: 'fire_salamander',cost: 350, feedType: 'mushroom',   feedAmount: 2, feedInterval: 600,  products: [{ type: 'transmutation_dust', min: 1, max: 1, chance: 0.50 }],                        productInterval: 1800, farmLevel: 20, maxPerPen: 1, seasonal: 'Sunreign' },
  { key: 'frost_hare',     cost: 100, feedType: 'herbs',      feedAmount: 1, feedInterval: 600,  products: [{ type: 'raw_wool', min: 1, max: 2 }, { type: 'raw_meat', min: 1, max: 1, chance: 0.20 }], productInterval: 600, farmLevel: 6, maxPerPen: 4, seasonal: 'Frosthollow' },
  { key: 'shadow_cat',     cost: 280, feedType: 'raw_meat',   feedAmount: 2, feedInterval: 600,  products: [{ type: 'hide', min: 1, max: 1, chance: 0.30 }],                                     productInterval: 1200, farmLevel: 14, maxPerPen: 2, seasonal: null },
  { key: 'golden_goose',   cost: 500, feedType: 'wheat',      feedAmount: 3, feedInterval: 600,  products: [{ type: 'egg', min: 1, max: 1 }, { type: 'feather', min: 1, max: 2 }],               productInterval: 900,  farmLevel: 22, maxPerPen: 1, seasonal: null },
];

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'animals');

  // Filter: include non-seasonal animals + those matching current season
  var available = ANIMAL_MASTER_POOL.filter(function(a) {
    return !a.seasonal || a.seasonal === calendarSeason;
  });

  var count = rng.range(r, 4, 6);
  var selected = rng.pickN(r, available, count);

  var ANIMAL_DEFINITIONS = {};
  for (var i = 0; i < selected.length; i++) {
    var animal = selected[i];
    ANIMAL_DEFINITIONS[animal.key] = {
      cost: rng.varyInt(r, animal.cost, 0.30),
      feedType: animal.feedType,
      feedAmount: animal.feedAmount,
      feedInterval: animal.feedInterval,
      products: animal.products,
      productInterval: rng.varyInt(r, animal.productInterval, 0.25),
      farmLevel: animal.farmLevel,
      maxPerPen: animal.maxPerPen,
    };
  }

  return { ANIMAL_DEFINITIONS: ANIMAL_DEFINITIONS };
}

module.exports = {
  generate: generate,
  ANIMAL_MASTER_POOL: ANIMAL_MASTER_POOL,
};
