// handlers/pets.js
// Pet taming and mount evolution system.
// Events: pet_tame, pet_list, pet_feed, pet_set_active

var crypto = require('crypto');
var na = require('../nature-algorithms');

var TAMEABLE_CREATURES = {
  // biome -> [{ type, name, tamingLevel, tamingItem, baseSpeed, evolutions }]
  forest: [
    { type: 'forest_wolf', name: 'Forest Wolf', tamingLevel: 5, tamingItem: 'raw_meat', baseSpeed: 1.10,
      evolutions: [{level:10, name:'Elder Wolf', speedBonus:0.05},{level:20, name:'Dire Wolf', speedBonus:0.10}] },
    { type: 'forest_deer', name: 'Forest Deer', tamingLevel: 3, tamingItem: 'herbs',    baseSpeed: 1.15,
      evolutions: [{level:10, name:'Swift Deer', speedBonus:0.05},{level:20, name:'Ancient Stag', speedBonus:0.10}] },
  ],
  plains: [
    { type: 'plains_horse', name: 'Plains Horse', tamingLevel: 8, tamingItem: 'wheat', baseSpeed: 1.20,
      evolutions: [{level:15, name:'Warhorse', speedBonus:0.05},{level:30, name:'Champion Steed', speedBonus:0.15}] },
  ],
  desert: [
    { type: 'desert_lizard', name: 'Desert Lizard', tamingLevel: 4, tamingItem: 'mushroom', baseSpeed: 1.08,
      evolutions: [{level:10, name:'Sand Drake', speedBonus:0.07},{level:20, name:'Dune Serpent', speedBonus:0.12}] },
  ],
  tundra: [
    { type: 'tundra_fox', name: 'Tundra Fox', tamingLevel: 6, tamingItem: 'cooked_fish', baseSpeed: 1.12,
      evolutions: [{level:10, name:'Arctic Fox', speedBonus:0.08}] },
  ],
  ocean: [
    { type: 'sea_turtle', name: 'Sea Turtle', tamingLevel: 10, tamingItem: 'seaweed', baseSpeed: 1.05,
      evolutions: [{level:15, name:'Great Sea Turtle', speedBonus:0.10}] },
  ],
  mountains: [
    { type: 'mountain_goat', name: 'Mountain Goat', tamingLevel: 5, tamingItem: 'herbs', baseSpeed: 1.12,
      evolutions: [{level:10, name:'Alpine Ram', speedBonus:0.08},{level:25, name:'Thunderhorn', speedBonus:0.15}] },
  ],
};

var PET_CARE = {
  hungerDecayPerHour: 5,   // -5 hunger per real hour
  happinessDecayPerHour: 3, // -3 happiness per real hour
  maxStat: 100,
};

function calculatePetSpeed(pet) {
  var baseSpeed = pet.baseSpeed || 1.0;
  var evoBonus = 0;
  // Use GA-evolved stats if available, else fall back to template
  if (pet.evoStats && pet.evoStats.speedBonus) {
    evoBonus = pet.evoStats.speedBonus;
  } else if (pet.evolutionLevel >= 2 && pet.evolutions && pet.evolutions[1]) {
    evoBonus = pet.evolutions[1].speedBonus;
  } else if (pet.evolutionLevel >= 1 && pet.evolutions && pet.evolutions[0]) {
    evoBonus = pet.evolutions[0].speedBonus;
  }
  // Neglect penalty: if hunger < 20 or happiness < 20, -20% speed
  var neglectPenalty = 0;
  if ((pet.hunger || 0) < 20 || (pet.happiness || 0) < 20) neglectPenalty = 0.20;
  return Math.max(0.8, baseSpeed + evoBonus - neglectPenalty);
}

function _findCreatureTemplate(creatureType) {
  var found = null;
  var biomes = Object.keys(TAMEABLE_CREATURES);
  for (var b = 0; b < biomes.length; b++) {
    var arr = TAMEABLE_CREATURES[biomes[b]];
    for (var c = 0; c < arr.length; c++) {
      if (arr[c].type === creatureType) { found = arr[c]; break; }
    }
    if (found) break;
  }
  return found;
}

function init(io, socket, deps) {
  var accounts = deps.accounts;
  var socketAccountMap = deps.socketAccountMap;
  var vipPerks = deps.vipPerks;
  var getCachedVipStatus = deps.getCachedVipStatus;

  // Attempt to tame a nearby creature
  socket.on('pet_tame', function(data) {
    if (!data || typeof data.creatureType !== 'string') return;
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;

    // Check if player already has max pets
    var pets = account.petData || [];
    var _petVip = getCachedVipStatus ? getCachedVipStatus(key) : null;
    var _maxPets = vipPerks ? vipPerks.getMaxPets(_petVip) : 2;
    if (pets.length >= _maxPets) {
      socket.emit('pet_error', { message: 'You can only have ' + _maxPets + ' pets.' });
      return;
    }

    // Find creature template
    var creatureInfo = _findCreatureTemplate(data.creatureType);
    if (!creatureInfo) {
      socket.emit('pet_error', { message: 'Cannot tame this creature.' });
      return;
    }

    // Check taming skill
    var tamingSkill = (account.skills && account.skills.animal_taming) ? account.skills.animal_taming.level : 0;
    if (tamingSkill < creatureInfo.tamingLevel) {
      socket.emit('pet_error', { message: 'Need Animal Taming level ' + creatureInfo.tamingLevel + '.' });
      return;
    }

    // Check taming item in inventory
    var inv = account.mmoInventory || {};
    if (!inv[creatureInfo.tamingItem] || inv[creatureInfo.tamingItem] <= 0) {
      socket.emit('pet_error', { message: 'You need ' + creatureInfo.tamingItem.replace(/_/g, ' ') + ' to tame this.' });
      return;
    }

    // Consume taming item
    inv[creatureInfo.tamingItem]--;

    // Create pet
    var pet = {
      id: crypto.randomBytes(6).toString('hex'),
      type: creatureInfo.type,
      name: creatureInfo.name,
      baseSpeed: creatureInfo.baseSpeed,
      evolutions: creatureInfo.evolutions,
      evolutionLevel: 0,
      evolutionXp: 0,
      hunger: 80,
      happiness: 80,
      tamedAt: Date.now(),
      lastFed: Date.now(),
    };
    if (!account.petData) account.petData = [];
    account.petData.push(pet);
    accounts.saveAccount(account);
    socket.emit('pet_tamed', { pet: pet });
  });

  socket.on('pet_list', function() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;
    var pets = (account.petData || []).map(function(p) {
      return Object.assign({}, p, { currentSpeed: calculatePetSpeed(p) });
    });
    socket.emit('pet_list', { pets: pets });
  });

  socket.on('pet_feed', function(data) {
    if (!data || typeof data.petId !== 'string') return;
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;
    var pet = (account.petData || []).find(function(p) { return p.id === data.petId; });
    if (!pet) {
      socket.emit('pet_error', { message: 'Pet not found.' });
      return;
    }
    // Consume food from inventory
    var food = data.food || 'cooked_fish';
    var inv = account.mmoInventory || {};
    if (!inv[food] || inv[food] <= 0) {
      socket.emit('pet_error', { message: 'No ' + food.replace(/_/g, ' ') + ' to feed.' });
      return;
    }
    inv[food]--;
    pet.hunger = Math.min(100, (pet.hunger || 0) + 30);
    pet.happiness = Math.min(100, (pet.happiness || 0) + 10);
    pet.lastFed = Date.now();
    accounts.saveAccount(account);
    socket.emit('pet_fed', { petId: pet.id, hunger: pet.hunger, happiness: pet.happiness });
  });

  socket.on('pet_set_active', function(data) {
    if (!data) return;
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;
    var petId = data.petId || null;
    if (petId !== null) {
      var found = (account.petData || []).find(function(p) { return p.id === petId; });
      if (!found) {
        socket.emit('pet_error', { message: 'Pet not found.' });
        return;
      }
    }
    account.activePet = petId;
    accounts.saveAccount(account);
    socket.emit('pet_active_set', { petId: petId });
  });
}

/**
 * Tick pet hunger/happiness decay for an account.
 * Call periodically (e.g., every hour) from server.js.
 */
function tickPetDecay(account, vipStatus) {
  if (!account.petData || account.petData.length === 0) return;
  var vipPerksModule = require('../vip-perks');
  var hungerRate = vipPerksModule.getPetHungerDecayRate(vipStatus);
  var now = Date.now();
  for (var i = 0; i < account.petData.length; i++) {
    var pet = account.petData[i];
    if (pet.dormant) continue;
    var lastCheck = pet.lastDecayTick || pet.lastFed || pet.tamedAt || now;
    var hoursElapsed = (now - lastCheck) / (3600 * 1000);
    if (hoursElapsed < 1) continue;
    var fullHours = Math.floor(hoursElapsed);
    pet.hunger = Math.max(0, (pet.hunger || 100) - hungerRate * fullHours);
    pet.happiness = Math.max(0, (pet.happiness || 100) - PET_CARE.happinessDecayPerHour * fullHours);
    pet.lastDecayTick = now;
  }
}

/**
 * Award evolution XP to the active pet. Auto-evolve at thresholds.
 * Call from dungeon kill rewards.
 * @returns evolution result or null
 */
// Evolution stat templates per stage (crossover targets for GA)
var EVO_STAT_TEMPLATES = {
  1: { speedBonus: 1.0, stamina: 1.1, loyalty: 1.0, carryCapacity: 1.05 },
  2: { speedBonus: 1.0, stamina: 1.25, loyalty: 1.15, carryCapacity: 1.15 },
};

function awardPetEvoXp(account, xpAmount) {
  if (!account.activePet || !account.petData) return null;
  var pet = null;
  for (var i = 0; i < account.petData.length; i++) {
    if (account.petData[i].id === account.activePet) { pet = account.petData[i]; break; }
  }
  if (!pet || !pet.evolutions) return null;
  pet.evolutionXp = (pet.evolutionXp || 0) + xpAmount;
  // Check evolution thresholds
  var maxEvo = pet.evolutions.length;
  if (pet.evolutionLevel >= maxEvo) return null; // Already at max
  var threshold = pet.evolutions[pet.evolutionLevel].level * 100; // level * 100 XP per stage
  if (pet.evolutionXp >= threshold) {
    pet.evolutionXp -= threshold;
    pet.evolutionLevel++;
    var evoInfo = pet.evolutions[pet.evolutionLevel - 1];

    // GA-inspired stat variance: crossover pet's current stats with template,
    // then mutate. Happiness biases mutations positive, hunger affects stamina.
    var template = EVO_STAT_TEMPLATES[pet.evolutionLevel] || EVO_STAT_TEMPLATES[1];
    var parentStats = {
      speedBonus: evoInfo.speedBonus || 0.05,
      stamina: pet.evoStats ? pet.evoStats.stamina : 1.0,
      loyalty: pet.evoStats ? pet.evoStats.loyalty : 1.0,
      carryCapacity: pet.evoStats ? pet.evoStats.carryCapacity : 1.0,
    };

    // Crossover: 60% template, 40% parent
    var crossed = na.petStatCrossover(parentStats, template);

    // Mutate: happiness (0-100) maps to 0-1 bias, ±10% perturbation
    var happinessBias = (pet.happiness || 50) / 100;
    var mutated = na.petStatMutate(crossed, 0.10, happinessBias);

    // Store evolved stats on pet
    pet.evoStats = {
      speedBonus: Math.round(mutated.speedBonus * 1000) / 1000,
      stamina: Math.round(mutated.stamina * 1000) / 1000,
      loyalty: Math.round(mutated.loyalty * 1000) / 1000,
      carryCapacity: Math.round(mutated.carryCapacity * 1000) / 1000,
    };

    return {
      evolved: true,
      newLevel: pet.evolutionLevel,
      newName: evoInfo.name,
      evoStats: pet.evoStats,
    };
  }
  return null;
}

module.exports = {
  init: init,
  calculatePetSpeed: calculatePetSpeed,
  tickPetDecay: tickPetDecay,
  awardPetEvoXp: awardPetEvoXp,
  TAMEABLE_CREATURES: TAMEABLE_CREATURES,
  PET_CARE: PET_CARE,
  applySeasonalOverrides: function(overrides) {
    if (overrides.TAMEABLE_CREATURES) {
      TAMEABLE_CREATURES = overrides.TAMEABLE_CREATURES;
      module.exports.TAMEABLE_CREATURES = TAMEABLE_CREATURES;
    }
  },
};
