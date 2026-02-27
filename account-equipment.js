'use strict';

var equipData = require('./equipment-data');
var EQUIPMENT_SLOTS = equipData.EQUIPMENT_SLOTS;
var VALID_AXES = equipData.VALID_AXES;
var VALID_PICKAXES = equipData.VALID_PICKAXES;
var COMBAT_SKILL_FOR_CATEGORY = equipData.COMBAT_SKILL_FOR_CATEGORY;
var RARITY_COMBAT_LEVEL = equipData.RARITY_COMBAT_LEVEL;
var WEAPON_TYPES = equipData.WEAPON_TYPES;
var ARMOR_SLOTS = equipData.ARMOR_SLOTS;
var WEAPON_SLOTS = equipData.WEAPON_SLOTS;
var TOOL_SLOTS = equipData.TOOL_SLOTS;
var JEWELRY_SLOTS = equipData.JEWELRY_SLOTS;
var REPAIR_MATERIAL_COST = equipData.REPAIR_MATERIAL_COST;
var getItemMaterial = equipData.getItemMaterial;
var ensureItemDurability = equipData.ensureItemDurability;
var DUAL_WIELD_COMBOS = equipData.DUAL_WIELD_COMBOS;
var categorizeHandItem = equipData.categorizeHandItem;

var loadAccount;
var saveAccount;

function init(deps) {
  loadAccount = deps.loadAccount;
  saveAccount = deps.saveAccount;
}

function reduceDurability(account, slot, percentLoss, cardEffects) {
  if (!account || !account.equipment) return null;
  var itemId = account.equipment[slot];
  if (!itemId) return null;
  if (!account.mmoInventory || !account.mmoInventory.items) return null;
  var item = null;
  for (var i = 0; i < account.mmoInventory.items.length; i++) {
    if (account.mmoInventory.items[i].id === itemId) {
      item = account.mmoInventory.items[i];
      break;
    }
  }
  if (!item) return null;

  if (JEWELRY_SLOTS.indexOf(slot) !== -1) return null;

  ensureItemDurability(item);

  var indestructibleChance = 0;
  if (cardEffects) {
    for (var ci = 0; ci < cardEffects.length; ci++) {
      if (cardEffects[ci].type === 'indestructible_chance') indestructibleChance += (cardEffects[ci].value || 0);
    }
  }
  if (indestructibleChance > 0 && Math.random() < indestructibleChance) {
    return { broken: false, durability: item.durability, maxDurability: item.maxDurability, slot: slot, saved: true };
  }

  var lossMult = 1.0;
  if (cardEffects) {
    for (var cj = 0; cj < cardEffects.length; cj++) {
      var ce = cardEffects[cj];
      if (ce.type === 'weapon_durability_bonus' && WEAPON_SLOTS.indexOf(slot) !== -1) lossMult -= (ce.value || 0);
      if (ce.type === 'armor_durability_bonus' && ARMOR_SLOTS.indexOf(slot) !== -1) lossMult -= (ce.value || 0);
      if (ce.type === 'tool_durability_bonus' && TOOL_SLOTS.indexOf(slot) !== -1) lossMult -= (ce.value || 0);
    }
  }
  if (lossMult < 0.1) lossMult = 0.1;

  var lossAmount = Math.max(1, Math.round(item.maxDurability * percentLoss * lossMult));
  var wasBroken = item.durability <= 0;
  item.durability = Math.max(0, item.durability - lossAmount);
  var nowBroken = item.durability <= 0 && !wasBroken;

  return {
    broken: nowBroken,
    durability: item.durability,
    maxDurability: item.maxDurability,
    slot: slot,
    itemName: item.name || item.type,
    lowDurability: item.durability > 0 && item.durability <= item.maxDurability * 0.25,
  };
}

function reduceArmorDurability(account, percentLoss, cardEffects) {
  var results = [];
  for (var i = 0; i < ARMOR_SLOTS.length; i++) {
    var r = reduceDurability(account, ARMOR_SLOTS[i], percentLoss, cardEffects);
    if (r) results.push(r);
  }
  return results;
}

function reduceWeaponDurability(account, percentLoss, cardEffects) {
  var results = [];
  for (var i = 0; i < WEAPON_SLOTS.length; i++) {
    var r = reduceDurability(account, WEAPON_SLOTS[i], percentLoss, cardEffects);
    if (r) results.push(r);
  }
  return results;
}

function getEquipmentDurability(key) {
  var account = loadAccount(key);
  if (!account) return {};
  var eq = account.equipment || {};
  var inv = (account.mmoInventory && account.mmoInventory.items) ? account.mmoInventory.items : [];
  var durabilityInfo = {};
  var needsSave = false;
  for (var si = 0; si < EQUIPMENT_SLOTS.length; si++) {
    var slot = EQUIPMENT_SLOTS[si];
    var itemId = eq[slot];
    if (!itemId) continue;
    var item = null;
    for (var ii = 0; ii < inv.length; ii++) {
      if (inv[ii].id === itemId) { item = inv[ii]; break; }
    }
    if (!item) continue;
    if (typeof item.durability !== 'number') {
      ensureItemDurability(item);
      needsSave = true;
    }
    durabilityInfo[slot] = {
      durability: item.durability,
      maxDurability: item.maxDurability,
      broken: item.durability <= 0,
      low: item.durability > 0 && item.durability <= item.maxDurability * 0.25,
      itemName: item.name || item.type,
    };
  }
  if (needsSave) saveAccount(account);
  return durabilityInfo;
}

function repairEquipmentSlot(key, slot, cardEffects) {
  var account = loadAccount(key);
  if (!account) return { error: 'Account not found' };
  if (!account.equipment) return { error: 'No equipment' };
  if (EQUIPMENT_SLOTS.indexOf(slot) === -1) return { error: 'Invalid slot' };
  var itemId = account.equipment[slot];
  if (!itemId) return { error: 'Nothing equipped in that slot' };
  if (!account.mmoInventory || !account.mmoInventory.items) return { error: 'Inventory error' };
  var item = null;
  for (var i = 0; i < account.mmoInventory.items.length; i++) {
    if (account.mmoInventory.items[i].id === itemId) { item = account.mmoInventory.items[i]; break; }
  }
  if (!item) return { error: 'Equipped item not found in inventory' };

  ensureItemDurability(item);

  if (item.durability >= item.maxDurability) return { error: 'Item is already at full durability' };

  var missingPercent = (item.maxDurability - item.durability) / item.maxDurability;
  var material = getItemMaterial(item.type);
  var costInfo = REPAIR_MATERIAL_COST[material] || { resource: 'iron_bar', multiplier: 1 };

  var baseCost = Math.max(1, Math.ceil(missingPercent * 10 * costInfo.multiplier));

  var costReduction = 0;
  if (cardEffects) {
    for (var ci = 0; ci < cardEffects.length; ci++) {
      if (cardEffects[ci].type === 'repair_cost_reduction') costReduction += (cardEffects[ci].value || 0);
    }
  }
  if (costReduction > 0) {
    baseCost = Math.max(1, Math.round(baseCost * (1 - costReduction)));
  }

  var currentAmount = account.mmoInventory[costInfo.resource] || 0;
  if (currentAmount < baseCost) {
    var resName = costInfo.resource.replace(/_/g, ' ');
    return { error: 'Not enough ' + resName + ' (need ' + baseCost + ', have ' + currentAmount + ')' };
  }

  account.mmoInventory[costInfo.resource] = currentAmount - baseCost;

  var durabilityRestored = item.maxDurability - item.durability;
  item.durability = item.maxDurability;

  var repairXp = Math.max(1, Math.round(durabilityRestored * 0.5));

  saveAccount(account);

  return {
    success: true,
    cost: { resource: costInfo.resource, amount: baseCost },
    durabilityRestored: durabilityRestored,
    xpAwarded: repairXp,
    slot: slot,
    itemName: item.name || item.type,
  };
}

function isItemBroken(item) {
  if (!item) return false;
  if (typeof item.durability !== 'number') return false;
  return item.durability <= 0;
}

function migrateHandSlots(account) {
  if (!account.equipment) return;
  if (account.equipment.weapon !== undefined) {
    account.equipment.main_hand = account.equipment.weapon;
    delete account.equipment.weapon;
  }
  if (account.equipment.shield !== undefined) {
    account.equipment.off_hand = account.equipment.shield;
    delete account.equipment.shield;
  }
  for (var ri = 3; ri <= 6; ri++) {
    if (account.equipment['ring' + ri] === undefined) {
      account.equipment['ring' + ri] = null;
    }
  }
}

function getDefaultEquipment() {
  return { axe: null, pickaxe: null, main_hand: null, off_hand: null, head: null, chest: null, undershirt: null, arms: null, hands: null, legs: null, feet: null, ring1: null, ring2: null, ring3: null, ring4: null, ring5: null, ring6: null, necklace: null };
}

function getEquipment(key) {
  var account = loadAccount(key);
  if (!account) return getDefaultEquipment();
  migrateHandSlots(account);
  var eq = account.equipment || {};
  for (var si = 0; si < EQUIPMENT_SLOTS.length; si++) {
    if (eq[EQUIPMENT_SLOTS[si]] === undefined) eq[EQUIPMENT_SLOTS[si]] = null;
  }
  return eq;
}

function equipMMOItem(key, slot, itemId) {
  var account = loadAccount(key);
  if (!account) return null;
  if (!account.equipment) account.equipment = getDefaultEquipment();
  migrateHandSlots(account);
  if (EQUIPMENT_SLOTS.indexOf(slot) === -1) return null;
  if (!account.mmoInventory || !account.mmoInventory.items) return null;
  var item = account.mmoInventory.items.find(function(i) { return i.id === itemId; });
  if (!item) return null;
  if (slot === 'axe' && !VALID_AXES[item.type]) return null;
  if (slot === 'pickaxe' && !VALID_PICKAXES[item.type]) return null;
  if (slot !== 'axe' && slot !== 'pickaxe') {
    var weaponDef = WEAPON_TYPES[item.type];
    if (!weaponDef) return null;

    if (slot === 'main_hand' || slot === 'off_hand') {
      var slotMatch = (weaponDef.slot === 'weapon' || weaponDef.slot === 'shield');
      if (!slotMatch) return null;
      var otherSlot = (slot === 'main_hand') ? 'off_hand' : 'main_hand';
      if (account.equipment[otherSlot] === itemId) {
        return { error: 'Item already equipped in other hand' };
      }
      if (slot === 'main_hand' && weaponDef.handedness === '2h') {
        account.equipment.off_hand = null;
      }
    } else if (slot === 'ring2' || slot === 'ring3' || slot === 'ring4' || slot === 'ring5' || slot === 'ring6') {
      if (weaponDef.slot !== 'ring1') return null;
    } else {
      var slotMatch = (weaponDef.slot === slot);
      if (!slotMatch) return null;
    }

    if (weaponDef.category && weaponDef.rarity) {
      var requiredSkill = COMBAT_SKILL_FOR_CATEGORY[weaponDef.category];
      var requiredLevel = RARITY_COMBAT_LEVEL[weaponDef.rarity] || 0;
      if (requiredSkill && requiredLevel > 0) {
        var skills = account.skills || {};
        var playerSkill = skills[requiredSkill];
        var playerLevel = (playerSkill && playerSkill.level) ? playerSkill.level : 0;
        if (playerLevel < requiredLevel) {
          return { error: 'Requires ' + requiredSkill.charAt(0).toUpperCase() + requiredSkill.slice(1) + ' Lv.' + requiredLevel };
        }
      }
    }
  }
  ensureItemDurability(item);

  account.equipment[slot] = itemId;
  saveAccount(account);
  return account.equipment;
}

function unequipMMOItem(key, slot) {
  var account = loadAccount(key);
  if (!account) return null;
  if (!account.equipment) account.equipment = getDefaultEquipment();
  if (EQUIPMENT_SLOTS.indexOf(slot) === -1) return null;
  account.equipment[slot] = null;
  saveAccount(account);
  return account.equipment;
}

function resolveItemStats(item) {
  if (!item) return null;
  var baseDef = WEAPON_TYPES[item.type] || {};

  if (item.stats) {
    var resolved = {};
    for (var k in baseDef) {
      if (baseDef.hasOwnProperty(k)) resolved[k] = baseDef[k];
    }
    for (var s in item.stats) {
      if (item.stats.hasOwnProperty(s)) resolved[s] = item.stats[s];
    }
    resolved.quality = item.quality || null;
    resolved.rarity = item.rarity || baseDef.rarity || 'common';
    resolved.sockets = item.sockets || 0;
    resolved.socketedGems = item.socketedGems || [];
    resolved.augment = item.augment || null;
    resolved.setId = item.setId || null;
    resolved.setPieceId = item.setPieceId || null;
    resolved.uniqueId = item.uniqueId || null;
    resolved.uniqueEffect = item.uniqueEffect || null;
    resolved.wandProps = item.wandProps || null;
    resolved.imbued = item.imbued || false;
    resolved.effects = item.effects || baseDef.effects || null;
    resolved.prefix = item.prefix || null;
    resolved.prefixStats = item.prefixStats || null;
    resolved.suffix = item.suffix || null;
    resolved.suffixStats = item.suffixStats || null;
    resolved.handedness = item.handedness || baseDef.handedness || null;
    return resolved;
  }

  return baseDef;
}

function getEquippedHandStats(key) {
  var account = loadAccount(key);
  if (!account) return { mainHand: null, offHand: null, mainHandItemId: null, offHandItemId: null };
  migrateHandSlots(account);
  var eq = account.equipment || {};
  var inv = (account.mmoInventory && account.mmoInventory.items) || [];

  function getHandItem(slotId) {
    if (!eq[slotId]) return null;
    var item = inv.find(function(i) { return i.id === eq[slotId]; });
    if (!item || isItemBroken(item)) return null;
    return resolveItemStats(item);
  }

  return {
    mainHand: getHandItem('main_hand'),
    offHand: getHandItem('off_hand'),
    mainHandItemId: eq.main_hand || null,
    offHandItemId: eq.off_hand || null,
  };
}

function getEquippedWeaponStats(key) {
  var handStats = getEquippedHandStats(key);
  return handStats.mainHand;
}

function getEquippedArmorTotal(key) {
  var account = loadAccount(key);
  if (!account) return 0;
  migrateHandSlots(account);
  var eq = account.equipment || {};
  var inv = (account.mmoInventory && account.mmoInventory.items) ? account.mmoInventory.items : [];
  var totalDef = 0;
  var armorSlots = ['head', 'chest', 'undershirt', 'arms', 'hands', 'legs', 'feet'];
  for (var i = 0; i < armorSlots.length; i++) {
    var slotItemId = eq[armorSlots[i]];
    if (!slotItemId) continue;
    var slotItem = inv.find(function(it) { return it.id === slotItemId; });
    if (!slotItem) continue;
    if (isItemBroken(slotItem)) continue;
    var def = resolveItemStats(slotItem);
    if (def && def.defense) totalDef += def.defense;
  }
  return totalDef;
}

function getEquippedArmorStats(key) {
  var account = loadAccount(key);
  if (!account) return { totalDefense: 0, totalMagicResist: 0, totalMagicDamage: 0, totalCritBonus: 0, totalSpeedMod: 0 };
  migrateHandSlots(account);
  var eq = account.equipment || {};
  var inv = (account.mmoInventory && account.mmoInventory.items) ? account.mmoInventory.items : [];
  var stats = { totalDefense: 0, totalMagicResist: 0, totalMagicDamage: 0, totalCritBonus: 0, totalSpeedMod: 0 };
  var armorSlots = ['head', 'chest', 'undershirt', 'arms', 'hands', 'legs', 'feet', 'ring1', 'ring2', 'ring3', 'ring4', 'ring5', 'ring6', 'necklace'];
  for (var i = 0; i < armorSlots.length; i++) {
    var slotItemId = eq[armorSlots[i]];
    if (!slotItemId) continue;
    var slotItem = inv.find(function(it) { return it.id === slotItemId; });
    if (!slotItem) continue;
    if (isItemBroken(slotItem)) continue;
    var def = resolveItemStats(slotItem);
    if (!def) continue;
    if (def.defense) stats.totalDefense += def.defense;
    if (def.magicResist) stats.totalMagicResist += def.magicResist;
    if (def.magicDamage) stats.totalMagicDamage += def.magicDamage;
    if (def.critBonus) stats.totalCritBonus += def.critBonus;
    if (def.speedBonus) stats.totalSpeedMod += def.speedBonus;
    if (def.speedPenalty) stats.totalSpeedMod -= def.speedPenalty;
  }
  return stats;
}

function getGenericCombo(mhCat, ohCat, handStats) {
  var mhDef = handStats.mainHand;
  var ohDef = handStats.offHand;
  if (mhDef && ohDef && mhDef.handedness === '2h' && ohDef.handedness === '2h') {
    return DUAL_WIELD_COMBOS['2h_2h'];
  }
  var rangedCats = { bow: 1, crossbow: 1 };
  if (rangedCats[mhCat]) {
    if (ohCat === 'shield') return DUAL_WIELD_COMBOS['ranged_shield'];
    if (ohCat === 'dagger') return DUAL_WIELD_COMBOS['ranged_dagger'];
  }
  if (ohCat === 'shield' && mhCat !== 'shield') return DUAL_WIELD_COMBOS['weapon_shield'];
  if (mhCat === 'shield' && ohCat !== 'shield') return DUAL_WIELD_COMBOS['weapon_shield'];
  return null;
}

function getDualWieldCombo(key) {
  var handStats = getEquippedHandStats(key);
  if (!handStats.mainHand && !handStats.offHand) return null;

  var mhCat = categorizeHandItem(handStats.mainHand);
  var ohCat = categorizeHandItem(handStats.offHand);

  if (!mhCat || !ohCat) return null;

  var comboKey = mhCat + '_' + ohCat;
  var combo = DUAL_WIELD_COMBOS[comboKey];
  if (!combo) {
    comboKey = ohCat + '_' + mhCat;
    combo = DUAL_WIELD_COMBOS[comboKey];
  }
  if (!combo) {
    combo = getGenericCombo(mhCat, ohCat, handStats);
  }

  return combo || null;
}

module.exports = {
  init: init,
  reduceDurability: reduceDurability,
  reduceArmorDurability: reduceArmorDurability,
  reduceWeaponDurability: reduceWeaponDurability,
  getEquipmentDurability: getEquipmentDurability,
  repairEquipmentSlot: repairEquipmentSlot,
  isItemBroken: isItemBroken,
  migrateHandSlots: migrateHandSlots,
  getDefaultEquipment: getDefaultEquipment,
  getEquipment: getEquipment,
  equipMMOItem: equipMMOItem,
  unequipMMOItem: unequipMMOItem,
  resolveItemStats: resolveItemStats,
  getEquippedHandStats: getEquippedHandStats,
  getEquippedWeaponStats: getEquippedWeaponStats,
  getEquippedArmorTotal: getEquippedArmorTotal,
  getEquippedArmorStats: getEquippedArmorStats,
  getGenericCombo: getGenericCombo,
  getDualWieldCombo: getDualWieldCombo,
};
