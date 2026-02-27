// handlers/farming.js
// Farming, animal husbandry, and furniture interaction handler.
// Handles: plant_seed, water_crop, harvest_crop, check_crops,
//          animal_buy, animal_place, animal_feed, animal_collect, animal_name,
//          furniture_interact
// Also exports farmingTick() for server.js to call on interval.

var crypto = require('crypto');
var rpgData = require('../rpg-data');
var placement = require('./placement');
var helpers = require('./helpers');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var INTERACT_RANGE = 100;    // max px for farming interactions
var WATER_TROUGH_RANGE = 200;
var WELL_RANGE = 400;
var SPRINKLER_RANGE = 150;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId() {
  return crypto.randomBytes(6).toString('hex');
}

function distanceSq(x1, y1, x2, y2) {
  var dx = x1 - x2;
  var dy = y1 - y2;
  return dx * dx + dy * dy;
}

function getPlayerPos(state, socketId) {
  return state.playerPositions.get(socketId);
}

function getPlayerZone(state, socketId) {
  var zoneId = state.playerZones.get(socketId);
  if (!zoneId) return null;
  return state.zones.get(zoneId);
}

function findPlacedObject(zone, objectId) {
  if (!zone || !zone.placedObjects) return null;
  for (var i = 0; i < zone.placedObjects.length; i++) {
    if (zone.placedObjects[i] && zone.placedObjects[i].id === objectId) {
      return zone.placedObjects[i];
    }
  }
  return null;
}

// Check if a crop_plot or garden_bed has a nearby water source
function hasWaterSource(zone, objX, objY) {
  if (!zone || !zone.placedObjects) return false;
  for (var i = 0; i < zone.placedObjects.length; i++) {
    var o = zone.placedObjects[i];
    if (!o) continue;
    var range = 0;
    if (o.type === 'water_trough') range = WATER_TROUGH_RANGE;
    else if (o.type === 'well') range = WELL_RANGE;
    else continue;
    if (distanceSq(objX, objY, o.x || 0, o.y || 0) <= range * range) return true;
  }
  return false;
}

// Collect furniture effects active on a zone
function getZoneFurnitureEffects(zone) {
  var effects = {};
  if (!zone || !zone.placedObjects) return effects;
  var effectCounts = {};
  for (var i = 0; i < zone.placedObjects.length; i++) {
    var obj = zone.placedObjects[i];
    if (!obj) continue;
    var def = rpgData.FURNITURE_EFFECTS[obj.type];
    if (!def) continue;
    var key = obj.type;
    effectCounts[key] = (effectCounts[key] || 0) + 1;
    if (effectCounts[key] <= def.stackLimit) {
      if (!effects[def.effect]) effects[def.effect] = 0;
      effects[def.effect] += (typeof def.value === 'number' ? def.value : 0);
    }
  }
  return effects;
}

// Get time-of-day growth multiplier
function getTimeGrowthMultiplier(state, nightBonus) {
  var timeOfDay = (state.world && state.world.timeOfDay) || 'day';
  if (nightBonus && timeOfDay === 'night') return 1.50; // mushrooms +50% at night
  switch (timeOfDay) {
    case 'day':  return 1.30;
    case 'dawn': return 1.15;
    case 'dusk': return 1.15;
    case 'night': return 0.80;
    default: return 1.0;
  }
}

// ---------------------------------------------------------------------------
// Farming Tick (called from server.js every 60s)
// ---------------------------------------------------------------------------

var _tickCount = 0;

function farmingTick(state, io, accounts) {
  _tickCount++;

  var weather = (state.world && state.world.weather) || 'clear';
  var isRaining = (weather === 'rain' || weather === 'storm');

  // Iterate all zones looking for plots with crops/animals
  state.zones.forEach(function(zone, zoneId) {
    if (!zone || zone.type !== 'plot') return;
    if (!zone.placedObjects || !Array.isArray(zone.placedObjects)) return;

    var furnitureEffects = getZoneFurnitureEffects(zone);
    var changed = false;

    for (var i = 0; i < zone.placedObjects.length; i++) {
      var obj = zone.placedObjects[i];
      if (!obj) continue;

      // ---- CROP GROWTH ----
      if ((obj.type === 'crop_plot' || obj.type === 'garden_bed') && obj.crop && obj.crop.stage < 4) {
        var cropDef = rpgData.CROP_DEFINITIONS[obj.crop.seedType];
        if (!cropDef) continue;

        // Auto-water from rain or sprinklers
        if (isRaining) {
          obj.crop.wateredToday = true;
        }
        if (!obj.crop.wateredToday) {
          // Check sprinklers
          for (var s = 0; s < zone.placedObjects.length; s++) {
            var sp = zone.placedObjects[s];
            if (sp && sp.type === 'sprinkler') {
              if (distanceSq(obj.x || 0, obj.y || 0, sp.x || 0, sp.y || 0) <= SPRINKLER_RANGE * SPRINKLER_RANGE) {
                obj.crop.wateredToday = true;
                break;
              }
            }
          }
        }

        // Growth rate calculation
        var growthRate = 1.0;
        growthRate *= obj.crop.wateredToday ? 1.5 : 0.5;
        growthRate *= getTimeGrowthMultiplier(state, cropDef.nightBonus);
        if (isRaining) growthRate *= 1.1;
        // Furniture: clock bonus
        if (furnitureEffects.crop_growth) growthRate *= (1 + furnitureEffects.crop_growth);

        // Advance growth
        var stageTime = cropDef.growthTime / 3; // 3 stages to go through (seed->sprout->growing->mature)
        var progressPerTick = (60 / stageTime) * growthRate;
        obj.crop.growthProgress = (obj.crop.growthProgress || 0) + progressPerTick;

        if (obj.crop.growthProgress >= 1.0 && obj.crop.stage < 3) {
          obj.crop.stage++;
          obj.crop.growthProgress = 0;
        } else if (obj.crop.stage === 3) {
          // Mature — check for withering
          var timeSincePlant = Date.now() - (obj.crop.plantedAt || Date.now());
          var witherTime = cropDef.growthTime * rpgData.CROP_WITHER_MULTIPLIER * 1000;
          if (timeSincePlant > witherTime) {
            // Scarecrow can prevent
            var witherPrevent = furnitureEffects.wither_prevent || 0;
            if (Math.random() >= witherPrevent) {
              obj.crop.stage = 4; // withered
            }
          }
        }

        // Degrade quality if not watered
        if (!obj.crop.wateredToday && obj.crop.stage < 3) {
          obj.crop.quality = Math.max(0.5, (obj.crop.quality || 1.0) - 0.10);
        }

        changed = true;
      }

      // ---- ANIMAL PRODUCTION ----
      if (obj.type === 'animal_pen' && obj.animals && obj.animals.length > 0) {
        var now = Date.now();
        for (var a = 0; a < obj.animals.length; a++) {
          var animal = obj.animals[a];
          if (!animal) continue;
          var animalDef = rpgData.ANIMAL_DEFINITIONS[animal.animalType];
          if (!animalDef) continue;

          // Happiness decay if not fed
          if (animalDef.feedType && animalDef.feedInterval > 0) {
            var timeSinceFed = now - (animal.lastFed || now);
            var missedFeedings = Math.floor(timeSinceFed / (animalDef.feedInterval * 1000));
            if (missedFeedings > 0) {
              animal.happiness = Math.max(0, (animal.happiness || rpgData.ANIMAL_HAPPINESS_MAX) - missedFeedings * rpgData.ANIMAL_HAPPINESS_MISS_PENALTY);
            }
          }

          // Product accumulation
          var timeSinceCollect = now - (animal.lastCollected || now);
          var productCycles = Math.floor(timeSinceCollect / (animalDef.productInterval * 1000));
          if (productCycles > 0 && animal.happiness >= rpgData.ANIMAL_HAPPINESS_STOP_THRESHOLD) {
            if (!animal.pendingProducts) animal.pendingProducts = [];

            var productMult = 1.0;
            if (animal.happiness < rpgData.ANIMAL_HAPPINESS_HALF_THRESHOLD) productMult = 0.5;

            for (var pc = 0; pc < Math.min(productCycles, 3); pc++) {
              for (var pi = 0; pi < animalDef.products.length; pi++) {
                var prod = animalDef.products[pi];
                if (prod.chance && Math.random() > prod.chance) continue;
                var qty = Math.floor(Math.random() * (prod.max - prod.min + 1)) + prod.min;
                qty = Math.max(1, Math.round(qty * productMult));
                // Cap pending products
                if (animal.pendingProducts.length < rpgData.ANIMAL_MAX_PENDING_PRODUCTS) {
                  animal.pendingProducts.push({ type: prod.type, amount: qty });
                }
              }
            }
            animal.lastCollected = now;
            changed = true;
          }
        }
      }
    }

    // Reset wateredToday at dawn
    var timeOfDay = (state.world && state.world.timeOfDay) || 'day';
    if (timeOfDay === 'dawn') {
      for (var d = 0; d < zone.placedObjects.length; d++) {
        var dobj = zone.placedObjects[d];
        if (dobj && dobj.crop && dobj.crop.wateredToday) {
          dobj.crop.wateredToday = false;
          changed = true;
        }
      }
    }

    // Save and broadcast every 5th tick (5 minutes)
    if (changed) {
      placement.savePlacements(zoneId, zone.placedObjects);
    }
    if (_tickCount % 5 === 0 && zone.ownerKey) {
      // Broadcast crop/animal state to zone players
      var cropStates = [];
      var animalStates = [];
      for (var b = 0; b < zone.placedObjects.length; b++) {
        var bobj = zone.placedObjects[b];
        if (!bobj) continue;
        if (bobj.crop) {
          cropStates.push({ id: bobj.id, x: bobj.x, y: bobj.y, crop: bobj.crop });
        }
        if (bobj.type === 'animal_pen' && bobj.animals) {
          animalStates.push({ id: bobj.id, x: bobj.x, y: bobj.y, animals: bobj.animals });
        }
      }
      if (cropStates.length > 0 || animalStates.length > 0) {
        io.to('zone:' + zoneId).emit('farm_update', { crops: cropStates, animals: animalStates });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Socket Handler
// ---------------------------------------------------------------------------

function init(io, socket, deps) {
  var state = deps.state;
  var accounts = deps.accounts;
  var socketAccountMap = deps.socketAccountMap;

  // ------------------------------------------------------------------
  // plant_seed: plant a seed on a crop_plot or garden_bed
  // ------------------------------------------------------------------
  socket.on('plant_seed', function(data) {
    try {
      if (!data || typeof data.plotId !== 'string' || typeof data.seedType !== 'string') {
        socket.emit('farm_error', { message: 'Invalid request' });
        return;
      }
      if (!helpers.applyRateGrace(socket, 'plant_seed', 20, 10000)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      var pos = getPlayerPos(state, socket.id);
      var zone = getPlayerZone(state, socket.id);
      if (!pos || !zone) {
        socket.emit('farm_error', { message: 'Not in a zone' });
        return;
      }

      // Validate plot ownership
      if (zone.type !== 'plot' || zone.ownerKey !== key) {
        socket.emit('farm_error', { message: 'You can only plant on your own plot' });
        return;
      }

      var plotObj = findPlacedObject(zone, data.plotId);
      if (!plotObj || (plotObj.type !== 'crop_plot' && plotObj.type !== 'garden_bed')) {
        socket.emit('farm_error', { message: 'Invalid crop plot' });
        return;
      }

      // Check proximity
      if (distanceSq(pos.x, pos.y, plotObj.x || 0, plotObj.y || 0) > INTERACT_RANGE * INTERACT_RANGE) {
        socket.emit('farm_error', { message: 'Too far from crop plot' });
        return;
      }

      // Check plot is empty
      if (plotObj.crop && plotObj.crop.stage < 4) {
        socket.emit('farm_error', { message: 'This plot already has a crop growing' });
        return;
      }

      // Validate seed type
      var cropDef = rpgData.CROP_DEFINITIONS[data.seedType];
      if (!cropDef) {
        socket.emit('farm_error', { message: 'Unknown seed type' });
        return;
      }

      // Check farming level
      var account = accounts.loadAccount(key);
      var farmLevel = (account && account.skills && account.skills.farming) ? account.skills.farming.level || 1 : 1;
      if (farmLevel < cropDef.farmLevel) {
        socket.emit('farm_error', { message: 'Requires farming level ' + cropDef.farmLevel });
        return;
      }

      // Consume seed
      var removeResult = accounts.removeResource(key, data.seedType, 1);
      if (removeResult === null) {
        socket.emit('farm_error', { message: 'No ' + data.seedType.replace(/_/g, ' ') + ' in inventory' });
        return;
      }

      // Plant the crop
      plotObj.crop = {
        seedType: data.seedType,
        stage: 0,
        growthProgress: 0.0,
        plantedAt: Date.now(),
        lastWatered: 0,
        wateredToday: false,
        quality: 1.0,
      };

      // Save and notify
      var zoneId = state.playerZones.get(socket.id);
      placement.savePlacements(zoneId, zone.placedObjects);

      // Award small farming XP
      var xpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : undefined;
      accounts.addSkillXp(key, 'farming', 5, xpRate);

      socket.emit('seed_planted', {
        plotId: data.plotId,
        seedType: data.seedType,
        crop: plotObj.crop,
        inventory: accounts.getMMOInventory(key),
      });
    } catch (err) {
      console.error('[plant_seed] Error:', err.message);
      socket.emit('farm_error', { message: 'Internal error' });
    }
  });

  // ------------------------------------------------------------------
  // water_crop: water a crop plot
  // ------------------------------------------------------------------
  socket.on('water_crop', function(data) {
    try {
      if (!data || typeof data.plotId !== 'string') {
        socket.emit('farm_error', { message: 'Invalid request' });
        return;
      }
      if (!helpers.applyRateGrace(socket, 'water_crop', 30, 10000)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      var pos = getPlayerPos(state, socket.id);
      var zone = getPlayerZone(state, socket.id);
      if (!pos || !zone) return;

      var plotObj = findPlacedObject(zone, data.plotId);
      if (!plotObj || !plotObj.crop || plotObj.crop.stage >= 4) {
        socket.emit('farm_error', { message: 'No active crop to water' });
        return;
      }

      if (distanceSq(pos.x, pos.y, plotObj.x || 0, plotObj.y || 0) > INTERACT_RANGE * INTERACT_RANGE) {
        socket.emit('farm_error', { message: 'Too far from crop' });
        return;
      }

      // Need water source nearby
      if (!hasWaterSource(zone, plotObj.x || 0, plotObj.y || 0)) {
        socket.emit('farm_error', { message: 'No water source nearby (need water trough or well)' });
        return;
      }

      plotObj.crop.wateredToday = true;
      plotObj.crop.lastWatered = Date.now();

      var zoneId = state.playerZones.get(socket.id);
      placement.savePlacements(zoneId, zone.placedObjects);

      socket.emit('crop_watered', { plotId: data.plotId, crop: plotObj.crop });
    } catch (err) {
      console.error('[water_crop] Error:', err.message);
      socket.emit('farm_error', { message: 'Internal error' });
    }
  });

  // ------------------------------------------------------------------
  // harvest_crop: harvest a mature crop
  // ------------------------------------------------------------------
  socket.on('harvest_crop', function(data) {
    try {
      if (!data || typeof data.plotId !== 'string') {
        socket.emit('farm_error', { message: 'Invalid request' });
        return;
      }
      if (!helpers.applyRateGrace(socket, 'harvest_crop', 20, 10000)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      var pos = getPlayerPos(state, socket.id);
      var zone = getPlayerZone(state, socket.id);
      if (!pos || !zone) return;

      var plotObj = findPlacedObject(zone, data.plotId);
      if (!plotObj || !plotObj.crop) {
        socket.emit('farm_error', { message: 'No crop to harvest' });
        return;
      }

      if (plotObj.crop.stage !== 3) {
        if (plotObj.crop.stage === 4) {
          // Withered: clear it
          plotObj.crop = null;
          var zoneId0 = state.playerZones.get(socket.id);
          placement.savePlacements(zoneId0, zone.placedObjects);
          socket.emit('crop_cleared', { plotId: data.plotId, message: 'Withered crop cleared' });
          return;
        }
        socket.emit('farm_error', { message: 'Crop not yet mature' });
        return;
      }

      if (distanceSq(pos.x, pos.y, plotObj.x || 0, plotObj.y || 0) > INTERACT_RANGE * INTERACT_RANGE) {
        socket.emit('farm_error', { message: 'Too far from crop' });
        return;
      }

      var cropDef = rpgData.CROP_DEFINITIONS[plotObj.crop.seedType];
      if (!cropDef) {
        socket.emit('farm_error', { message: 'Unknown crop type' });
        return;
      }

      // Calculate yield
      var quality = plotObj.crop.quality || 1.0;
      var baseYield = Math.floor(Math.random() * (cropDef.yieldMax - cropDef.yieldMin + 1)) + cropDef.yieldMin;
      var totalYield = Math.max(1, Math.round(baseYield * quality));

      // Card effects
      var cardEffects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(key) : [];
      var cropYieldBonus = 0;
      for (var ce = 0; ce < cardEffects.length; ce++) {
        if (cardEffects[ce].type === 'crop_yield_bonus') cropYieldBonus += (cardEffects[ce].value || 0);
      }
      if (cropYieldBonus > 0) totalYield = Math.max(1, Math.round(totalYield * (1 + cropYieldBonus)));

      // Add resources
      accounts.addResource(key, cropDef.output, totalYield);

      // Seed back chance
      var seedBack = false;
      if (cropDef.seedBackChance > 0 && Math.random() < cropDef.seedBackChance) {
        accounts.addResource(key, plotObj.crop.seedType, 1);
        seedBack = true;
      }

      // Award farming XP
      var xpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : undefined;
      accounts.addSkillXp(key, 'farming', cropDef.xp, xpRate);

      // Clear crop
      plotObj.crop = null;
      var zoneId = state.playerZones.get(socket.id);
      placement.savePlacements(zoneId, zone.placedObjects);

      socket.emit('crop_harvested', {
        plotId: data.plotId,
        output: cropDef.output,
        amount: totalYield,
        seedBack: seedBack,
        xp: cropDef.xp,
        inventory: accounts.getMMOInventory(key),
      });
    } catch (err) {
      console.error('[harvest_crop] Error:', err.message);
      socket.emit('farm_error', { message: 'Internal error' });
    }
  });

  // ------------------------------------------------------------------
  // check_crops: get all crop/animal states on player's plot
  // ------------------------------------------------------------------
  socket.on('check_crops', function() {
    try {
      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      var zone = getPlayerZone(state, socket.id);
      if (!zone) return;

      var crops = [];
      var animals = [];
      if (zone.placedObjects) {
        for (var i = 0; i < zone.placedObjects.length; i++) {
          var obj = zone.placedObjects[i];
          if (!obj) continue;
          if (obj.crop) {
            crops.push({ id: obj.id, x: obj.x, y: obj.y, type: obj.type, crop: obj.crop });
          }
          if (obj.type === 'animal_pen' && obj.animals) {
            animals.push({ id: obj.id, x: obj.x, y: obj.y, animals: obj.animals });
          }
        }
      }

      socket.emit('crop_status', { crops: crops, animals: animals });
    } catch (err) {
      console.error('[check_crops] Error:', err.message);
    }
  });

  // ------------------------------------------------------------------
  // animal_buy: purchase an animal
  // ------------------------------------------------------------------
  socket.on('animal_buy', function(data) {
    try {
      if (!data || typeof data.animalType !== 'string') {
        socket.emit('farm_error', { message: 'Invalid request' });
        return;
      }
      if (!helpers.applyRateGrace(socket, 'animal_buy', 10, 10000)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var animalDef = rpgData.ANIMAL_DEFINITIONS[data.animalType];
      if (!animalDef) {
        socket.emit('farm_error', { message: 'Unknown animal type' });
        return;
      }

      // Check farming level
      var account = accounts.loadAccount(key);
      if (!account) return;
      var farmLevel = (account.skills && account.skills.farming) ? account.skills.farming.level || 1 : 1;
      if (farmLevel < animalDef.farmLevel) {
        socket.emit('farm_error', { message: 'Requires farming level ' + animalDef.farmLevel });
        return;
      }

      // Deduct coins
      if ((account.chips || 0) < animalDef.cost) {
        socket.emit('farm_error', { message: 'Not enough coins (need ' + animalDef.cost + ')' });
        return;
      }
      account.chips -= animalDef.cost;

      // Add animal to ownedAnimals
      if (!account.mmoInventory) account.mmoInventory = {};
      if (!account.mmoInventory.ownedAnimals) account.mmoInventory.ownedAnimals = [];

      var newAnimal = {
        id: 'ani_' + generateId(),
        animalType: data.animalType,
        name: data.animalType.charAt(0).toUpperCase() + data.animalType.slice(1),
        happiness: rpgData.ANIMAL_HAPPINESS_MAX,
        lastFed: Date.now(),
        lastCollected: Date.now(),
        pendingProducts: [],
      };
      account.mmoInventory.ownedAnimals.push(newAnimal);
      accounts.saveAccount(account);

      socket.emit('animal_bought', {
        animal: newAnimal,
        coins: account.chips,
      });
    } catch (err) {
      console.error('[animal_buy] Error:', err.message);
      socket.emit('farm_error', { message: 'Internal error' });
    }
  });

  // ------------------------------------------------------------------
  // animal_place: move animal from ownedAnimals to an animal_pen
  // ------------------------------------------------------------------
  socket.on('animal_place', function(data) {
    try {
      if (!data || typeof data.penId !== 'string' || typeof data.animalId !== 'string') {
        socket.emit('farm_error', { message: 'Invalid request' });
        return;
      }
      if (!helpers.applyRateGrace(socket, 'animal_place', 10, 10000)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      var pos = getPlayerPos(state, socket.id);
      var zone = getPlayerZone(state, socket.id);
      if (!pos || !zone) return;

      if (zone.type !== 'plot' || zone.ownerKey !== key) {
        socket.emit('farm_error', { message: 'You can only place animals on your own plot' });
        return;
      }

      var penObj = findPlacedObject(zone, data.penId);
      if (!penObj || penObj.type !== 'animal_pen') {
        socket.emit('farm_error', { message: 'Invalid animal pen' });
        return;
      }

      if (distanceSq(pos.x, pos.y, penObj.x || 0, penObj.y || 0) > INTERACT_RANGE * INTERACT_RANGE) {
        socket.emit('farm_error', { message: 'Too far from pen' });
        return;
      }

      // Find animal in owned list
      var account = accounts.loadAccount(key);
      if (!account || !account.mmoInventory || !account.mmoInventory.ownedAnimals) {
        socket.emit('farm_error', { message: 'No animals owned' });
        return;
      }

      var animalIdx = -1;
      for (var i = 0; i < account.mmoInventory.ownedAnimals.length; i++) {
        if (account.mmoInventory.ownedAnimals[i].id === data.animalId) {
          animalIdx = i;
          break;
        }
      }
      if (animalIdx === -1) {
        socket.emit('farm_error', { message: 'Animal not found in inventory' });
        return;
      }

      var animal = account.mmoInventory.ownedAnimals[animalIdx];
      var animalDef = rpgData.ANIMAL_DEFINITIONS[animal.animalType];
      if (!animalDef) {
        socket.emit('farm_error', { message: 'Unknown animal type' });
        return;
      }

      // Check capacity
      if (!penObj.animals) penObj.animals = [];
      var sameTypeCount = 0;
      for (var j = 0; j < penObj.animals.length; j++) {
        if (penObj.animals[j].animalType === animal.animalType) sameTypeCount++;
      }
      if (sameTypeCount >= animalDef.maxPerPen) {
        socket.emit('farm_error', { message: 'Pen is full for this animal type (max ' + animalDef.maxPerPen + ')' });
        return;
      }

      // Move animal from inventory to pen
      account.mmoInventory.ownedAnimals.splice(animalIdx, 1);
      penObj.animals.push(animal);
      accounts.saveAccount(account);

      var zoneId = state.playerZones.get(socket.id);
      placement.savePlacements(zoneId, zone.placedObjects);

      socket.emit('animal_placed', {
        penId: data.penId,
        animal: animal,
        animals: penObj.animals,
      });
    } catch (err) {
      console.error('[animal_place] Error:', err.message);
      socket.emit('farm_error', { message: 'Internal error' });
    }
  });

  // ------------------------------------------------------------------
  // animal_feed: feed animals in a pen
  // ------------------------------------------------------------------
  socket.on('animal_feed', function(data) {
    try {
      if (!data || typeof data.penId !== 'string') {
        socket.emit('farm_error', { message: 'Invalid request' });
        return;
      }
      if (!helpers.applyRateGrace(socket, 'animal_feed', 20, 10000)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      var pos = getPlayerPos(state, socket.id);
      var zone = getPlayerZone(state, socket.id);
      if (!pos || !zone) return;

      var penObj = findPlacedObject(zone, data.penId);
      if (!penObj || penObj.type !== 'animal_pen' || !penObj.animals || penObj.animals.length === 0) {
        socket.emit('farm_error', { message: 'No animals to feed' });
        return;
      }

      if (distanceSq(pos.x, pos.y, penObj.x || 0, penObj.y || 0) > INTERACT_RANGE * INTERACT_RANGE) {
        socket.emit('farm_error', { message: 'Too far from pen' });
        return;
      }

      // Calculate total feed needed
      var feedNeeded = {};
      for (var i = 0; i < penObj.animals.length; i++) {
        var animal = penObj.animals[i];
        var def = rpgData.ANIMAL_DEFINITIONS[animal.animalType];
        if (!def || !def.feedType) continue;
        feedNeeded[def.feedType] = (feedNeeded[def.feedType] || 0) + def.feedAmount;
      }

      // Check and deduct resources
      var mmoInv = accounts.getMMOInventory(key);
      for (var feedType in feedNeeded) {
        if ((mmoInv[feedType] || 0) < feedNeeded[feedType]) {
          socket.emit('farm_error', { message: 'Not enough ' + feedType.replace(/_/g, ' ') + ' (need ' + feedNeeded[feedType] + ')' });
          return;
        }
      }
      for (var ft in feedNeeded) {
        accounts.removeResource(key, ft, feedNeeded[ft]);
      }

      // Feed all animals
      var now = Date.now();
      for (var j = 0; j < penObj.animals.length; j++) {
        penObj.animals[j].lastFed = now;
        penObj.animals[j].happiness = Math.min(rpgData.ANIMAL_HAPPINESS_MAX, (penObj.animals[j].happiness || 50) + 20);
      }

      var zoneId = state.playerZones.get(socket.id);
      placement.savePlacements(zoneId, zone.placedObjects);

      // Award farming XP
      var xpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : undefined;
      accounts.addSkillXp(key, 'farming', 5 * penObj.animals.length, xpRate);

      socket.emit('animals_fed', {
        penId: data.penId,
        animals: penObj.animals,
        inventory: accounts.getMMOInventory(key),
      });
    } catch (err) {
      console.error('[animal_feed] Error:', err.message);
      socket.emit('farm_error', { message: 'Internal error' });
    }
  });

  // ------------------------------------------------------------------
  // animal_collect: collect pending products from an animal pen
  // ------------------------------------------------------------------
  socket.on('animal_collect', function(data) {
    try {
      if (!data || typeof data.penId !== 'string') {
        socket.emit('farm_error', { message: 'Invalid request' });
        return;
      }
      if (!helpers.applyRateGrace(socket, 'animal_collect', 20, 10000)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      var pos = getPlayerPos(state, socket.id);
      var zone = getPlayerZone(state, socket.id);
      if (!pos || !zone) return;

      var penObj = findPlacedObject(zone, data.penId);
      if (!penObj || penObj.type !== 'animal_pen' || !penObj.animals) {
        socket.emit('farm_error', { message: 'No animal pen found' });
        return;
      }

      if (distanceSq(pos.x, pos.y, penObj.x || 0, penObj.y || 0) > INTERACT_RANGE * INTERACT_RANGE) {
        socket.emit('farm_error', { message: 'Too far from pen' });
        return;
      }

      // Collect all pending products
      var collected = {};
      var totalXp = 0;
      for (var i = 0; i < penObj.animals.length; i++) {
        var animal = penObj.animals[i];
        if (!animal.pendingProducts || animal.pendingProducts.length === 0) continue;

        for (var p = 0; p < animal.pendingProducts.length; p++) {
          var prod = animal.pendingProducts[p];
          accounts.addResource(key, prod.type, prod.amount);
          collected[prod.type] = (collected[prod.type] || 0) + prod.amount;
          totalXp += 5;
        }
        animal.pendingProducts = [];
      }

      if (Object.keys(collected).length === 0) {
        socket.emit('farm_error', { message: 'No products to collect' });
        return;
      }

      var zoneId = state.playerZones.get(socket.id);
      placement.savePlacements(zoneId, zone.placedObjects);

      // Award farming XP
      var xpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : undefined;
      accounts.addSkillXp(key, 'farming', totalXp, xpRate);

      socket.emit('products_collected', {
        penId: data.penId,
        collected: collected,
        xp: totalXp,
        inventory: accounts.getMMOInventory(key),
      });
    } catch (err) {
      console.error('[animal_collect] Error:', err.message);
      socket.emit('farm_error', { message: 'Internal error' });
    }
  });

  // ------------------------------------------------------------------
  // animal_name: rename an animal
  // ------------------------------------------------------------------
  socket.on('animal_name', function(data) {
    try {
      if (!data || typeof data.penId !== 'string' || typeof data.animalId !== 'string' || typeof data.name !== 'string') {
        socket.emit('farm_error', { message: 'Invalid request' });
        return;
      }
      if (!helpers.applyRateGrace(socket, 'animal_name', 10, 10000)) return;

      var name = data.name.trim().substring(0, 20);
      if (name.length < 2) {
        socket.emit('farm_error', { message: 'Name must be 2-20 characters' });
        return;
      }

      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      var zone = getPlayerZone(state, socket.id);
      if (!zone) return;

      var penObj = findPlacedObject(zone, data.penId);
      if (!penObj || !penObj.animals) return;

      for (var i = 0; i < penObj.animals.length; i++) {
        if (penObj.animals[i].id === data.animalId) {
          penObj.animals[i].name = name;
          var zoneId = state.playerZones.get(socket.id);
          placement.savePlacements(zoneId, zone.placedObjects);
          socket.emit('animal_named', { penId: data.penId, animalId: data.animalId, name: name });
          return;
        }
      }
      socket.emit('farm_error', { message: 'Animal not found in pen' });
    } catch (err) {
      console.error('[animal_name] Error:', err.message);
    }
  });

  // ------------------------------------------------------------------
  // furniture_interact: interact with furniture (bed sleep, etc.)
  // ------------------------------------------------------------------
  socket.on('furniture_interact', function(data) {
    try {
      if (!data || typeof data.objectId !== 'string') {
        socket.emit('farm_error', { message: 'Invalid request' });
        return;
      }
      if (!helpers.applyRateGrace(socket, 'furniture_interact', 10, 10000)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      var pos = getPlayerPos(state, socket.id);
      var zone = getPlayerZone(state, socket.id);
      if (!pos || !zone) return;

      var obj = findPlacedObject(zone, data.objectId);
      if (!obj) {
        socket.emit('farm_error', { message: 'Object not found' });
        return;
      }

      if (distanceSq(pos.x, pos.y, obj.x || 0, obj.y || 0) > INTERACT_RANGE * INTERACT_RANGE) {
        socket.emit('farm_error', { message: 'Too far away' });
        return;
      }

      var furnitureDef = rpgData.FURNITURE_EFFECTS[obj.type];
      if (!furnitureDef) {
        socket.emit('farm_error', { message: 'Not interactable' });
        return;
      }

      var action = data.action || 'use';

      // Bed: sleep action
      if (obj.type === 'bed' && action === 'sleep') {
        var buffData = furnitureDef.value;
        socket.emit('furniture_effect', {
          objectId: data.objectId,
          type: 'rested_buff',
          buff: {
            stat: 'vigor',
            value: buffData.vigBonus,
            duration: buffData.duration,
          },
          xpBonus: buffData.xpBonus,
          message: 'You feel well-rested! +' + buffData.vigBonus + ' VIG, +' + Math.round(buffData.xpBonus * 100) + '% XP for ' + Math.round(buffData.duration / 60) + ' minutes',
        });
        return;
      }

      socket.emit('farm_error', { message: 'No action available for this object' });
    } catch (err) {
      console.error('[furniture_interact] Error:', err.message);
      socket.emit('farm_error', { message: 'Internal error' });
    }
  });
}

module.exports = { init: init, farmingTick: farmingTick, getZoneFurnitureEffects: getZoneFurnitureEffects };
