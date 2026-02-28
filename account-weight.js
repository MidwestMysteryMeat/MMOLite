// account-weight.js — Weight / Encumbrance System
// Pure computation on account objects. No loadAccount/saveAccount needed.

// ---------------------------------------------------------------------------
// Per-type weights for stackable resources and named items
// ---------------------------------------------------------------------------

var ITEM_WEIGHTS = {
  // Resources — raw materials
  wood: 1, stone: 2, iron_ore: 2, iron_bar: 3,
  copper_ore: 1.5, copper_bar: 2, bronze_ore: 2, bronze_bar: 3,
  silver_ore: 2, silver_bar: 3, gold_ore: 2.5, gold_bar: 4,
  steel_bar: 3.5, mithril_ore: 3, mithril_bar: 5,
  coal: 1.5, sand: 1.5, clay: 2, leather: 1, hide: 2, cloth: 0.5,
  silk: 0.5, thread: 0.2, bone: 1, feather: 0.1, scale: 0.5,

  // Resources — food & ingredients
  fish: 1, cooked_fish: 1, raw_meat: 1, grilled_meat: 1,
  shellfish: 1, seaweed: 0.5, wheat: 0.5, herbs: 0.5,
  vegetables: 1, mushroom: 0.5, bread: 0.5, stew: 1,
  corn: 0.5, pumpkin: 2, berries: 0.3, fruit: 0.5, honey: 1,
  cheese_wheel: 2, corn_bread: 0.5, pumpkin_pie: 1, honey_cake: 1,
  herb_tea: 0.5, ancient_fruit_wine: 1,

  // Resources — crafting components
  glass_sand: 1, glass: 1, glass_lens: 0.5, glass_vial: 0.5,
  cogs: 1, gears: 1, springs: 0.5, clockwork_core: 2,
  mana_crystal: 0.5, gem_rough: 1, gem_cut: 0.5,
  purification_crystal: 1, soulstone: 0.5,

  // Consumables — potions / brews / food items
  potion_health: 0.5, potion_mana: 0.5, potion_stamina: 0.5,
  elixir_might: 0.5, elixir_speed: 0.5, flask_fire: 0.5,
  antidote: 0.5,
  ale: 1, mead: 1, wine: 1, spirits: 1,
  fortified_ale: 1, battle_brew: 1,
  pickled_vegetables: 1, herb_preserves: 1,
  berry_jam: 1, fruit_jam: 1,

  // Scrolls — lightweight
  scroll_of_protection: 0.2, scroll_of_recall: 0.2,
  rune_stone_fire: 0.3, rune_stone_ice: 0.3,

  // Structures / placeables (heavy)
  forge: 30, anvil: 25, storage_chest: 15, wall: 10, door: 8,
  raft: 40, boat: 60, brewery: 50, preserving_station: 30, jam_maker: 20,
  loom: 25, sewing_table: 20, tanning_rack: 15,
  cart: 0, pack_mule: 0, // carry aids don't count toward their own weight

  default: 1,
};

// ---------------------------------------------------------------------------
// Slot-based weight tables for procedurally generated equipment
// ---------------------------------------------------------------------------
// These resolve weight when an item's type isn't in ITEM_WEIGHTS directly.
// Key: equipment slot. Value: { armorType -> weight } or flat weight.

var SLOT_WEIGHTS = {
  // Weapons — by category + handedness
  weapon: {
    '1h_melee_blade':  4,   // swords, daggers use material modifier
    '1h_melee_blunt':  5,
    '2h_melee_blade':  7,   // battle axes, spears, scythes
    '2h_melee_blunt':  8,   // great hammers
    '2h_archery':      3,   // bows, crossbows
    '1h_magic':        2,   // wands
    '2h_magic':        4,   // staffs
    'default':         5,
  },
  shield: 6,

  // Armor — by armorType
  head:       { cloth: 0.5, leather: 1,   chain: 2,   plate: 3,   default: 2 },
  chest:      { cloth: 1,   leather: 3,   chain: 5,   plate: 8,   default: 4 },
  undershirt: { cloth: 0.5, leather: 1,   chain: 3,   plate: 4,   default: 1 },
  arms:       { cloth: 0.3, leather: 0.8, chain: 1.5, plate: 2.5, default: 1.5 },
  hands:      { cloth: 0.3, leather: 0.5, chain: 1,   plate: 2,   default: 1 },
  legs:       { cloth: 0.5, leather: 2,   chain: 4,   plate: 6,   default: 3 },
  feet:       { cloth: 0.5, leather: 1,   chain: 2,   plate: 3,   default: 2 },

  // Jewelry — very light
  ring1: 0.1, ring2: 0.1, ring3: 0.1, ring4: 0.1, ring5: 0.1, ring6: 0.1,
  necklace: 0.2,
};

// Material weight multipliers — heavier metals = heavier gear
var MATERIAL_WEIGHT_MULT = {
  wooden: 0.6, copper: 0.8, bronze: 0.9, iron: 1.0,
  steel: 1.1, silver: 1.0, gold: 1.3, mithril: 0.7,  // mithril is famously light
  cloth: 0.4, leather: 0.6, silk: 0.3, enchanted: 0.5,
  reinforced_leather: 0.8, padded: 0.7,
};

// ---------------------------------------------------------------------------
// getItemWeight — resolve an item's physical weight
// ---------------------------------------------------------------------------
// Priority:
//   1. item.weight (explicitly stamped by generateItem)
//   2. ITEM_WEIGHTS[item.type] (named type match)
//   3. Slot-based lookup with armorType/category/handedness
//   4. ITEM_WEIGHTS.default fallback

function getItemWeight(item) {
  if (!item) return 0;

  // 1. Explicit weight on the item object (set by generateItem)
  if (typeof item.weight === 'number') return item.weight;

  // 2. Direct type lookup
  if (item.type && ITEM_WEIGHTS[item.type] !== undefined) {
    return ITEM_WEIGHTS[item.type];
  }

  // 3. Slot-based resolution for generated equipment
  var slot = item.slot;
  if (slot && SLOT_WEIGHTS[slot] !== undefined) {
    var slotDef = SLOT_WEIGHTS[slot];

    if (slot === 'weapon') {
      // Weapon: resolve by handedness + category
      var hand = item.handedness || '1h';
      var cat = item.category || 'melee_blade';
      var weapKey = hand + '_' + cat;
      var baseW = (typeof slotDef === 'object' && slotDef[weapKey]) || slotDef['default'] || 5;
      // Apply material multiplier from type prefix
      var matMult = _extractMaterialMult(item.type);
      return Math.round(baseW * matMult * 10) / 10;
    }

    if (typeof slotDef === 'object') {
      // Armor slot: resolve by armorType
      var armorType = item.armorType || 'default';
      var armorW = slotDef[armorType] || slotDef['default'] || 2;
      var armorMatMult = _extractMaterialMult(item.type);
      return Math.round(armorW * armorMatMult * 10) / 10;
    }

    // Flat weight (shield, jewelry)
    return slotDef;
  }

  // 4. Consumables
  if (item.isConsumable) return 0.5;

  return ITEM_WEIGHTS.default;
}

// Extract material multiplier from item type string (e.g. "iron_sword" -> "iron" -> 1.0)
function _extractMaterialMult(type) {
  if (!type) return 1.0;
  var parts = type.split('_');
  for (var i = 0; i < Math.min(parts.length, 2); i++) {
    if (MATERIAL_WEIGHT_MULT[parts[i]] !== undefined) {
      return MATERIAL_WEIGHT_MULT[parts[i]];
    }
  }
  // Check two-word prefixes
  if (parts.length >= 2) {
    var twoWord = parts[0] + '_' + parts[1];
    if (MATERIAL_WEIGHT_MULT[twoWord] !== undefined) {
      return MATERIAL_WEIGHT_MULT[twoWord];
    }
  }
  return 1.0;
}

// ---------------------------------------------------------------------------
// canCarryWeight — check if adding weight would exceed capacity
// ---------------------------------------------------------------------------

function canCarryWeight(account, additionalWeight) {
  var cap = getCarryCapacity(account);
  var cur = getCurrentWeight(account);
  return (cur + additionalWeight) <= cap;
}

// ---------------------------------------------------------------------------
// Carry capacity
// ---------------------------------------------------------------------------

function getCarryCapacity(account) {
  var vigor = (account.rpgStats && account.rpgStats.vigor) || 5;
  var base = 50;
  var vigBonus = vigor * 5;
  // Cart/pack animal bonus
  var cartBonus = 0;
  if (account.mmoInventory && account.mmoInventory.items) {
    account.mmoInventory.items.forEach(function(item) {
      if (item.type === 'cart') cartBonus += 100;
      if (item.type === 'pack_mule') cartBonus += 100;
    });
  }
  // Ascension bonus
  var ascTree = account.ascensionTree || {};
  var ascCarry = (ascTree['hoarders_instinct'] || 0) * 20;
  return base + vigBonus + cartBonus + ascCarry;
}

// ---------------------------------------------------------------------------
// Current weight
// ---------------------------------------------------------------------------

function getCurrentWeight(account) {
  var inv = account.mmoInventory || {};
  var weight = 0;
  // Resources (numeric fields)
  Object.keys(inv).forEach(function(key) {
    if (key === 'items') return;
    var qty = inv[key];
    if (typeof qty === 'number' && qty > 0) {
      weight += qty * (ITEM_WEIGHTS[key] || ITEM_WEIGHTS.default);
    }
  });
  // Items (array) — use getItemWeight for proper resolution
  if (Array.isArray(inv.items)) {
    inv.items.forEach(function(item) {
      weight += getItemWeight(item);
    });
  }
  return Math.round(weight * 10) / 10;
}

// ---------------------------------------------------------------------------
// Encumbrance level
// ---------------------------------------------------------------------------

function getEncumbranceLevel(account) {
  var cap = getCarryCapacity(account);
  var cur = getCurrentWeight(account);
  var pct = cur / cap;
  if (pct > 1.0) return 'overloaded'; // cannot move
  if (pct > 0.90) return 'heavy';    // -40% speed
  if (pct > 0.75) return 'moderate'; // -20% speed
  return 'normal';
}

// ---------------------------------------------------------------------------
// Speed multiplier
// ---------------------------------------------------------------------------

function getSpeedMultiplier(account) {
  var enc = getEncumbranceLevel(account);
  var base;
  if (enc === 'overloaded') return 0;
  if (enc === 'heavy') base = 0.60;
  else if (enc === 'moderate') base = 0.80;
  else base = 1.0;
  // Ascension: Seasoned Traveler (+3% speed per rank)
  var ascTree = account.ascensionTree || {};
  var ascSpeed = (ascTree['seasoned_traveler'] || 0) * 0.03;
  return base * (1 + ascSpeed);
}

module.exports = {
  ITEM_WEIGHTS: ITEM_WEIGHTS,
  SLOT_WEIGHTS: SLOT_WEIGHTS,
  MATERIAL_WEIGHT_MULT: MATERIAL_WEIGHT_MULT,
  getItemWeight: getItemWeight,
  canCarryWeight: canCarryWeight,
  getCarryCapacity: getCarryCapacity,
  getCurrentWeight: getCurrentWeight,
  getEncumbranceLevel: getEncumbranceLevel,
  getSpeedMultiplier: getSpeedMultiplier,
};
