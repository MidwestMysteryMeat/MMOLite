// seasonal/seasonal-shops.js
// Shop inventory/price variation generator. Shuffles shop inventories,
// adds seasonal items, fluctuates base prices +/-20%, applies scarcity.

var rng = require('./seasonal-rng');

// Seasonal items that may appear in shops
var SEASONAL_ITEMS = {
  Frosthollow: ['frost_lily_seed', 'deep_mushroom_seed', 'shadow_moss_seed'],
  Brightbloom: ['sun_wheat_seed', 'berry_seed', 'herb_seed'],
  Sunreign:    ['ember_pepper_seed', 'storm_grain_seed', 'blood_vine_seed'],
  Ashwane:     ['void_root_seed', 'moon_petal_seed', 'crystal_berry_seed'],
};

// Resource categories for scarcity pricing
var RESOURCE_CATEGORIES = {
  metals: ['iron_ore', 'iron_bar', 'bronze_ore', 'bronze_bar'],
  food: ['wheat', 'herbs', 'vegetables', 'mushroom', 'bread', 'stew', 'fish', 'cooked_fish'],
  alchemy: ['glass_vial', 'glass', 'mana_crystal', 'potion_health', 'potion_mana'],
  textiles: ['raw_wool', 'hide', 'leather', 'thread', 'cloth'],
  seeds: ['wheat_seed', 'herb_seed', 'vegetable_seed', 'mushroom_spore', 'berry_seed', 'tea_leaf_seed'],
};

// Base shop definitions (for rebuilding)
var BASE_SHOPS = {
  general:    { name: 'General Store',       description: 'Buys and sells common goods',    inventory: ['wood', 'stone', 'iron_ore', 'iron_bar', 'wheat', 'herbs', 'vegetables', 'bread'] },
  blacksmith: { name: 'Blacksmith',          description: 'Metals and forged goods',         inventory: ['iron_ore', 'iron_bar', 'bronze_ore', 'bronze_bar', 'cogs', 'gears', 'springs'] },
  fishmonger: { name: 'Fishmonger',          description: 'Fresh catch from the seas',       inventory: ['fish', 'cooked_fish', 'shellfish', 'seaweed'] },
  alchemist:  { name: 'Alchemist',           description: 'Potions, crystals, and glassware', inventory: ['glass_vial', 'glass', 'glass_lens', 'mana_crystal', 'potion_health', 'potion_mana', 'herbs'] },
  jeweler:    { name: 'Jeweler',             description: 'Gems and precious materials',     inventory: ['gem_rough', 'gem_cut', 'glass_lens', 'mana_crystal'] },
  engineer:   { name: 'Gnomish Engineer',    description: 'Clockwork parts and mechanisms',  inventory: ['cogs', 'gears', 'springs', 'clockwork_core', 'glass_lens'] },
  provisions: { name: 'Provisions Merchant', description: 'Food and cooking supplies',       inventory: ['wheat', 'herbs', 'vegetables', 'mushroom', 'fish', 'bread', 'stew', 'cooked_fish'] },
  seedshop:   { name: 'Seed Merchant',       description: 'Seeds for farming',               inventory: ['wheat_seed', 'herb_seed', 'vegetable_seed', 'mushroom_spore', 'berry_seed', 'tea_leaf_seed', 'pumpkin_seed', 'corn_seed', 'rare_flower_seed', 'ancient_seed'] },
  rancher:    { name: 'Rancher',             description: 'Animal supplies and products',    inventory: ['egg', 'milk', 'raw_wool', 'raw_meat', 'feather', 'honey', 'cheese', 'butter', 'animal_feed'] },
};

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'shops');

  // Build shops with shuffled inventories + seasonal items
  var SHOPS = {};
  var seasonItems = SEASONAL_ITEMS[calendarSeason] || [];

  for (var shopId in BASE_SHOPS) {
    var base = BASE_SHOPS[shopId];
    var inv = rng.shuffle(r, base.inventory);

    // Add 1-3 seasonal items to seedshop and general store
    if (shopId === 'seedshop' || shopId === 'general') {
      var toAdd = rng.pickN(r, seasonItems, rng.range(r, 1, 3));
      for (var a = 0; a < toAdd.length; a++) {
        if (inv.indexOf(toAdd[a]) === -1) inv.push(toAdd[a]);
      }
    }

    SHOPS[shopId] = {
      name: base.name,
      description: base.description,
      inventory: inv,
    };
  }

  // Base prices — fluctuate +/-20%, one category gets scarcity (+30-50%)
  var BASE_PRICES = _getDefaultPrices();
  for (var res in BASE_PRICES) {
    BASE_PRICES[res] = rng.varyInt(r, BASE_PRICES[res], 0.20);
    if (BASE_PRICES[res] < 1) BASE_PRICES[res] = 1;
  }

  // Pick one scarcity category
  var catKeys = Object.keys(RESOURCE_CATEGORIES);
  var scarceKey = rng.pick(r, catKeys);
  var scarceItems = RESOURCE_CATEGORIES[scarceKey];
  var scarceMult = rng.rangeFloat(r, 1.30, 1.50);
  for (var s = 0; s < scarceItems.length; s++) {
    if (BASE_PRICES[scarceItems[s]]) {
      BASE_PRICES[scarceItems[s]] = Math.round(BASE_PRICES[scarceItems[s]] * scarceMult);
    }
  }

  return { SHOPS: SHOPS, BASE_PRICES: BASE_PRICES };
}

function _getDefaultPrices() {
  // Inline the base prices rather than requiring npc-shop (avoid circular dep)
  return {
    wood: 5, stone: 8, iron_ore: 15, iron_bar: 35,
    bronze_ore: 12, bronze_bar: 30,
    fish: 10, cooked_fish: 25, shellfish: 12, seaweed: 6,
    wheat: 8, herbs: 12, vegetables: 8, mushroom: 10, bread: 20, stew: 45,
    glass_sand: 10, glass: 25, glass_lens: 60, glass_vial: 30,
    cogs: 15, gears: 25, springs: 20, clockwork_core: 120,
    mana_crystal: 50, gem_rough: 40, gem_cut: 100,
    potion_health: 35, potion_mana: 40,
    wheat_seed: 10, herb_seed: 15, vegetable_seed: 12,
    mushroom_spore: 20, berry_seed: 25, tea_leaf_seed: 40,
    pumpkin_seed: 35, corn_seed: 30, rare_flower_seed: 100, ancient_seed: 500,
    egg: 8, milk: 12, raw_wool: 15, raw_meat: 10, feather: 5, honey: 30,
    cheese: 20, butter: 15, animal_feed: 12,
    berries: 10, tea_leaves: 20, pumpkin: 25, corn: 12, rare_flower: 80, ancient_fruit: 200,
    frost_lily_seed: 45, void_root_seed: 120, sun_wheat_seed: 20, shadow_moss_seed: 18,
    blood_vine_seed: 60, crystal_berry_seed: 80, storm_grain_seed: 35, ember_pepper_seed: 30,
    moon_petal_seed: 90, deep_mushroom_seed: 22,
    frost_lily: 35, void_root: 100, sun_wheat: 10, shadow_moss: 12,
    blood_vine: 50, crystal_berry: 65, storm_grain: 18, ember_pepper: 16,
    moon_petal: 75, deep_mushroom: 15,
  };
}

module.exports = {
  generate: generate,
};
