// handlers/npc-shop.js
// NPC Shop system with supply/demand price fluctuation.
// Prices fluctuate based on player buy/sell activity, drifting back to base over time.
// Events: npc_shop_browse, npc_shop_buy, npc_shop_sell, npc_shop_prices

var rpgData = require('../rpg-data');
var factions = require('./factions');

// ---------------------------------------------------------------------------
// Base prices for all tradeable resources (in coins)
// ---------------------------------------------------------------------------

var BASE_PRICES = {
  wood: 5,
  stone: 8,
  iron_ore: 15,
  iron_bar: 35,
  bronze_ore: 12,
  bronze_bar: 30,
  fish: 10,
  cooked_fish: 25,
  shellfish: 12,
  seaweed: 6,
  wheat: 8,
  herbs: 12,
  vegetables: 8,
  mushroom: 10,
  bread: 20,
  stew: 45,
  glass_sand: 10,
  glass: 25,
  glass_lens: 60,
  glass_vial: 30,
  cogs: 15,
  gears: 25,
  springs: 20,
  clockwork_core: 120,
  mana_crystal: 50,
  gem_rough: 40,
  gem_cut: 100,
  potion_health: 35,
  potion_mana: 40,
  // Seeds
  wheat_seed: 10,
  herb_seed: 15,
  vegetable_seed: 12,
  mushroom_spore: 20,
  berry_seed: 25,
  tea_leaf_seed: 40,
  pumpkin_seed: 35,
  corn_seed: 30,
  rare_flower_seed: 100,
  ancient_seed: 500,
  // Seasonal exotic seeds
  frost_lily_seed: 45,
  void_root_seed: 120,
  sun_wheat_seed: 20,
  shadow_moss_seed: 18,
  blood_vine_seed: 60,
  crystal_berry_seed: 80,
  storm_grain_seed: 35,
  ember_pepper_seed: 30,
  moon_petal_seed: 90,
  deep_mushroom_seed: 22,
  // Seasonal exotic crops
  frost_lily: 35,
  void_root: 100,
  sun_wheat: 10,
  shadow_moss: 12,
  blood_vine: 50,
  crystal_berry: 65,
  storm_grain: 18,
  ember_pepper: 16,
  moon_petal: 75,
  deep_mushroom: 15,
  // Animal products
  egg: 8,
  milk: 12,
  raw_wool: 15,
  raw_meat: 10,
  feather: 5,
  honey: 30,
  cheese: 20,
  butter: 15,
  animal_feed: 12,
  // New crops
  berries: 10,
  tea_leaves: 20,
  pumpkin: 25,
  corn: 12,
  rare_flower: 80,
  ancient_fruit: 200,
};

// ---------------------------------------------------------------------------
// Shop definitions by location/biome
// ---------------------------------------------------------------------------

var SHOPS = {
  general: {
    name: 'General Store',
    description: 'Buys and sells common goods',
    inventory: ['wood', 'stone', 'iron_ore', 'iron_bar', 'wheat', 'herbs', 'vegetables', 'bread'],
  },
  blacksmith: {
    name: 'Blacksmith',
    description: 'Metals and forged goods',
    inventory: ['iron_ore', 'iron_bar', 'bronze_ore', 'bronze_bar', 'cogs', 'gears', 'springs'],
  },
  fishmonger: {
    name: 'Fishmonger',
    description: 'Fresh catch from the seas',
    inventory: ['fish', 'cooked_fish', 'shellfish', 'seaweed'],
  },
  alchemist: {
    name: 'Alchemist',
    description: 'Potions, crystals, and glassware',
    inventory: ['glass_vial', 'glass', 'glass_lens', 'mana_crystal', 'potion_health', 'potion_mana', 'herbs'],
  },
  jeweler: {
    name: 'Jeweler',
    description: 'Gems and precious materials',
    inventory: ['gem_rough', 'gem_cut', 'glass_lens', 'mana_crystal'],
  },
  engineer: {
    name: 'Gnomish Engineer',
    description: 'Clockwork parts and mechanisms',
    inventory: ['cogs', 'gears', 'springs', 'clockwork_core', 'glass_lens'],
  },
  provisions: {
    name: 'Provisions Merchant',
    description: 'Food and cooking supplies',
    inventory: ['wheat', 'herbs', 'vegetables', 'mushroom', 'fish', 'bread', 'stew', 'cooked_fish'],
  },
  seedshop: {
    name: 'Seed Merchant',
    description: 'Seeds for farming',
    inventory: ['wheat_seed', 'herb_seed', 'vegetable_seed', 'mushroom_spore', 'berry_seed', 'tea_leaf_seed', 'pumpkin_seed', 'corn_seed', 'rare_flower_seed', 'ancient_seed'],
  },
  rancher: {
    name: 'Rancher',
    description: 'Animal supplies and products',
    inventory: ['egg', 'milk', 'raw_wool', 'raw_meat', 'feather', 'honey', 'cheese', 'butter', 'animal_feed'],
  },
};

// ---------------------------------------------------------------------------
// Price fluctuation state
// ---------------------------------------------------------------------------

// Current price multipliers: tracks how far each resource is from base
// Starts at 1.0 (base price). Range: 0.3 to 3.0
var priceMultipliers = {};
// Pressure: positive = buying pressure (price goes up), negative = selling pressure (price goes down)
var pricePressure = {};

// Initialize
for (var res in BASE_PRICES) {
  priceMultipliers[res] = 1.0;
  pricePressure[res] = 0;
}

// Price tick settings
var TICK_INTERVAL_MS = 30000; // Update prices every 30 seconds
var PRESSURE_DECAY = 0.85;    // Pressure decays by 15% each tick
var PRESSURE_TO_PRICE = 0.02; // How much pressure affects price per tick
var DRIFT_RATE = 0.005;       // Natural drift back toward base price per tick
var MIN_MULTIPLIER = 0.5;
var MAX_MULTIPLIER = 2.0;

// Buy/sell markup
var BUY_MARKUP = 1.2;   // Players pay 20% over current market price
var SELL_DISCOUNT = 0.8; // Players receive 80% of current market price

var priceTickTimer = null;

function tickPrices() {
  for (var res in BASE_PRICES) {
    // Apply pressure to multiplier
    var pressure = pricePressure[res] || 0;
    priceMultipliers[res] += pressure * PRESSURE_TO_PRICE;

    // Natural drift back toward 1.0
    if (priceMultipliers[res] > 1.0) {
      priceMultipliers[res] -= DRIFT_RATE;
      if (priceMultipliers[res] < 1.0) priceMultipliers[res] = 1.0;
    } else if (priceMultipliers[res] < 1.0) {
      priceMultipliers[res] += DRIFT_RATE;
      if (priceMultipliers[res] > 1.0) priceMultipliers[res] = 1.0;
    }

    // Clamp
    if (priceMultipliers[res] < MIN_MULTIPLIER) priceMultipliers[res] = MIN_MULTIPLIER;
    if (priceMultipliers[res] > MAX_MULTIPLIER) priceMultipliers[res] = MAX_MULTIPLIER;

    // Decay pressure
    pricePressure[res] = (pricePressure[res] || 0) * PRESSURE_DECAY;
  }
}

function getBuyPrice(resource) {
  var base = BASE_PRICES[resource];
  if (!base) return null;
  return Math.max(1, Math.round(base * (priceMultipliers[resource] || 1.0) * BUY_MARKUP));
}

function getSellPrice(resource) {
  var base = BASE_PRICES[resource];
  if (!base) return null;
  return Math.max(1, Math.round(base * (priceMultipliers[resource] || 1.0) * SELL_DISCOUNT));
}

function getShopPrices(shopId) {
  var shop = SHOPS[shopId];
  if (!shop) return null;

  var prices = [];
  for (var i = 0; i < shop.inventory.length; i++) {
    var res = shop.inventory[i];
    var displayName = res.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    prices.push({
      resource: res,
      name: displayName,
      buyPrice: getBuyPrice(res),
      sellPrice: getSellPrice(res),
      basePrice: BASE_PRICES[res],
      trend: (priceMultipliers[res] || 1.0) > 1.05 ? 'up' : (priceMultipliers[res] || 1.0) < 0.95 ? 'down' : 'stable',
      multiplier: Math.round((priceMultipliers[res] || 1.0) * 100) / 100,
    });
  }
  return { shop: { id: shopId, name: shop.name, description: shop.description }, prices: prices };
}

// Per-account purchase lock to prevent concurrent buy/sell race conditions
var purchaseLocks = new Set();

// Start price ticker
priceTickTimer = setInterval(tickPrices, TICK_INTERVAL_MS);
priceTickTimer.unref();

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = {
  SHOPS: SHOPS,
  BASE_PRICES: BASE_PRICES,

  applySeasonalOverrides: function(overrides) {
    if (overrides.SHOPS) { SHOPS = overrides.SHOPS; module.exports.SHOPS = SHOPS; }
    if (overrides.BASE_PRICES) {
      BASE_PRICES = overrides.BASE_PRICES;
      module.exports.BASE_PRICES = BASE_PRICES;
      // Re-init price multipliers for new resources
      for (var res in BASE_PRICES) {
        if (!(res in priceMultipliers)) { priceMultipliers[res] = 1.0; pricePressure[res] = 0; }
      }
    }
  },

  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, checkEventRate } = deps;

    // --- npc_shop_browse: get available shops ---
    socket.on('npc_shop_browse', function() {

      var shopList = [];
      for (var shopId in SHOPS) {
        shopList.push({
          id: shopId,
          name: SHOPS[shopId].name,
          description: SHOPS[shopId].description,
          itemCount: SHOPS[shopId].inventory.length,
        });
      }
      socket.emit('npc_shop_list', { shops: shopList });
    });

    // --- npc_shop_prices: get prices for a specific shop ---
    socket.on('npc_shop_prices', function(data) {
      if (!data || typeof data.shopId !== 'string') return;

      var result = getShopPrices(data.shopId);
      if (!result) {
        socket.emit('npc_shop_error', { message: 'Shop not found' });
        return;
      }

      socket.emit('npc_shop_prices_result', result);
    });

    // --- npc_shop_buy: buy resources from NPC ---
    socket.on('npc_shop_buy', function(data) {
      if (!data || typeof data.shopId !== 'string' || typeof data.resource !== 'string' || typeof data.amount !== 'number') {
        socket.emit('npc_shop_error', { message: 'Invalid request' });
        return;
      }

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var shop = SHOPS[data.shopId];
      if (!shop) { socket.emit('npc_shop_error', { message: 'Shop not found' }); return; }

      // Check shop sells this resource
      if (shop.inventory.indexOf(data.resource) === -1) {
        socket.emit('npc_shop_error', { message: 'This shop does not sell ' + data.resource.replace(/_/g, ' ') });
        return;
      }

      var amount = Math.floor(data.amount);
      if (amount < 1 || amount > 100) {
        socket.emit('npc_shop_error', { message: 'Amount must be 1-100' });
        return;
      }

      var unitPrice = getBuyPrice(data.resource);
      var totalCost = unitPrice * amount;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      // Apply Presence stat discount BEFORE coin check (2% per point above 5)
      var presenceDiscount = 1.0;
      if (acc.rpgStats && acc.rpgStats.presence > 5) {
        presenceDiscount = 1 - ((acc.rpgStats.presence - 5) * 0.02);
        if (presenceDiscount < 0.7) presenceDiscount = 0.7; // cap at 30% discount
        totalCost = Math.max(amount, Math.round(totalCost * presenceDiscount));
      }

      // Apply faction reputation discount
      try {
        var factionsHandler = require('./factions');
        var state = deps.state;
        var playerZoneId = state ? state.playerZones.get(socket.id) : null;
        if (playerZoneId) {
          var factionId = factionsHandler.getFactionForZone(playerZoneId);
          if (factionId && acc.factionRep) {
            var factionDiscount = factionsHandler.getRepDiscount(acc.factionRep[factionId] || 0);
            if (factionDiscount !== 0) {
              totalCost = Math.max(amount, Math.round(totalCost * (1 - factionDiscount)));
            }
          }
        }
      } catch (_fErr) { /* factions handler not available */ }

      // Apply town reputation discount/surcharge (-5% to +5%)
      try {
        var _state2 = deps.state;
        var _pZoneId = _state2 ? _state2.playerZones.get(socket.id) : null;
        if (_pZoneId && acc.townReputation) {
          var townScore = acc.townReputation[_pZoneId] || 0;
          var townDiscount = Math.max(-0.05, Math.min(0.05, townScore * 0.0005));
          if (townDiscount !== 0) {
            totalCost = Math.max(amount, Math.round(totalCost * (1 - townDiscount)));
          }
        }
      } catch (_tErr) { /* town rep not available */ }

      // Guard hostility check (karma)
      try {
        var karmaHandler = require('./karma');
        if (karmaHandler.isGuardHostile(acc)) {
          socket.emit('npc_shop_error', { message: 'The shopkeeper refuses to serve you. Your reputation is too dark.' });
          return;
        }
      } catch (_kErr) { /* karma handler not available */ }

      if ((acc.chips || 0) < totalCost) {
        socket.emit('npc_shop_error', { message: 'Not enough coins (need ' + totalCost + ')' });
        return;
      }

      // Acquire purchase lock to prevent concurrent buy race conditions
      if (purchaseLocks.has(key)) {
        socket.emit('npc_shop_error', { message: 'Transaction in progress, try again' });
        return;
      }
      purchaseLocks.add(key);
      try {
        // Weight check before purchase — don't take coins if player can't carry
        var accountWeight = require('../account-weight');
        var perUnit = accountWeight.ITEM_WEIGHTS[data.resource] || accountWeight.ITEM_WEIGHTS.default;
        if (!accountWeight.canCarryWeight(acc, perUnit * amount)) {
          socket.emit('npc_shop_error', { message: 'You are too encumbered to carry that.' });
          return;
        }

        // Deduct coins and add resources
        var newBalance = accounts.updateChips(key, -totalCost);
        var addResult = accounts.addResource(key, data.resource, amount);
        if (addResult && addResult.error) {
          // Refund coins — resource add failed (weight race)
          accounts.updateChips(key, totalCost);
          socket.emit('npc_shop_error', { message: addResult.error });
          return;
        }

        // Add buying pressure (price goes up)
        pricePressure[data.resource] = (pricePressure[data.resource] || 0) + (amount * 0.1);

        var displayName = data.resource.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        socket.emit('npc_shop_bought', {
          resource: data.resource,
          amount: amount,
          totalCost: totalCost,
          unitPrice: unitPrice,
          coins: newBalance != null ? newBalance : 0,
          inventory: accounts.getMMOInventory(key),
          message: 'Bought ' + amount + ' ' + displayName + ' for ' + totalCost + ' coins',
        });

        // Award faction reputation for shopping in this town
        try {
          var buyRepState = deps.state;
          var buyRepZoneId = buyRepState ? buyRepState.playerZones.get(socket.id) : null;
          if (buyRepZoneId) {
            var buyRepFaction = factions.getFactionForZone(buyRepZoneId);
            if (buyRepFaction) {
              var freshRepAcc = accounts.loadAccount(key);
              if (freshRepAcc) {
                factions.addRep(freshRepAcc, buyRepFaction, 50);
                accounts.saveAccount(freshRepAcc);
              }
            }
          }
        } catch (_repErr) { /* faction rep not critical */ }
      } finally {
        purchaseLocks.delete(key);
      }
    });

    // --- npc_shop_sell: sell resources to NPC ---
    socket.on('npc_shop_sell', function(data) {
      if (!data || typeof data.resource !== 'string' || typeof data.amount !== 'number') {
        socket.emit('npc_shop_error', { message: 'Invalid request' });
        return;
      }

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      // Any shop buys anything (for convenience), but at sell discount
      var amount = Math.floor(data.amount);
      if (amount < 1 || amount > 100) {
        socket.emit('npc_shop_error', { message: 'Amount must be 1-100' });
        return;
      }

      if (!BASE_PRICES[data.resource]) {
        socket.emit('npc_shop_error', { message: 'Cannot sell that item' });
        return;
      }

      // Acquire purchase lock
      if (purchaseLocks.has(key)) {
        socket.emit('npc_shop_error', { message: 'Transaction in progress, try again' });
        return;
      }
      purchaseLocks.add(key);
      try {
        // Validate resource availability BEFORE any mutations (C-6 fix)
        var inv = accounts.getMMOInventory(key);
        if (!inv || (inv[data.resource] || 0) < amount) {
          socket.emit('npc_shop_error', { message: 'Not enough ' + data.resource.replace(/_/g, ' ') });
          return;
        }

        var unitPrice = getSellPrice(data.resource);
        var totalPayment = unitPrice * amount;

        // Apply Presence stat bonus (2% per point above 5)
        var acc = accounts.loadAccount(key);
        if (acc && acc.rpgStats && acc.rpgStats.presence > 5) {
          var presenceBonus = 1 + ((acc.rpgStats.presence - 5) * 0.02);
          if (presenceBonus > 1.3) presenceBonus = 1.3; // cap at 30% bonus
          totalPayment = Math.round(totalPayment * presenceBonus);
        }

        // Anti-arbitrage guard (C-6 fix): ensure sell price never exceeds 95% of buy price.
        // High-Presence players could otherwise buy at 0.84x and sell at 1.04x for risk-free profit.
        var buyPrice = getBuyPrice(data.resource);
        var maxSellTotal = Math.floor(buyPrice * 0.95) * amount;
        if (totalPayment > maxSellTotal) {
          totalPayment = maxSellTotal;
        }

        // Credit coins FIRST, then remove resources (C-6 fix).
        // If removeResource fails after crediting, deduct coins back.
        // This prevents the player from losing resources without compensation.
        var chipResult = accounts.updateChips(key, totalPayment);
        if (chipResult === null) {
          socket.emit('npc_shop_error', { message: 'Transaction failed' });
          return;
        }

        var removed = accounts.removeResource(key, data.resource, amount);
        if (removed === null) {
          // Rollback: deduct the coins we just credited
          accounts.updateChips(key, -totalPayment);
          socket.emit('npc_shop_error', { message: 'Not enough ' + data.resource.replace(/_/g, ' ') });
          return;
        }

        // Add selling pressure (price goes down)
        pricePressure[data.resource] = (pricePressure[data.resource] || 0) - (amount * 0.1);

        var displayName = data.resource.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        socket.emit('npc_shop_sold', {
          resource: data.resource,
          amount: amount,
          totalPayment: totalPayment,
          unitPrice: unitPrice,
          coins: chipResult != null ? chipResult : 0,
          inventory: accounts.getMMOInventory(key),
          message: 'Sold ' + amount + ' ' + displayName + ' for ' + totalPayment + ' coins',
        });

        // Award faction reputation for selling in this town
        try {
          var sellRepState = deps.state;
          var sellRepZoneId = sellRepState ? sellRepState.playerZones.get(socket.id) : null;
          if (sellRepZoneId && acc) {
            var sellRepFaction = factions.getFactionForZone(sellRepZoneId);
            if (sellRepFaction) {
              var freshSellAcc = accounts.loadAccount(key);
              if (freshSellAcc) {
                factions.addRep(freshSellAcc, sellRepFaction, 25);
                accounts.saveAccount(freshSellAcc);
              }
            }
          }
        } catch (_repErr) { /* faction rep not critical */ }
      } finally {
        purchaseLocks.delete(key);
      }
    });

    // --- npc_shop_all_prices: get all resource prices (market overview) ---
    socket.on('npc_shop_all_prices', function() {

      var allPrices = [];
      for (var res in BASE_PRICES) {
        var displayName = res.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        allPrices.push({
          resource: res,
          name: displayName,
          buyPrice: getBuyPrice(res),
          sellPrice: getSellPrice(res),
          basePrice: BASE_PRICES[res],
          trend: (priceMultipliers[res] || 1.0) > 1.05 ? 'up' : (priceMultipliers[res] || 1.0) < 0.95 ? 'down' : 'stable',
          multiplier: Math.round((priceMultipliers[res] || 1.0) * 100) / 100,
        });
      }

      socket.emit('npc_shop_market_overview', { prices: allPrices });
    });
  }
};
