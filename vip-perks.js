// vip-perks.js — Pure perk resolution utility
// Stateless module. Given VIP status + permanent purchases, returns effective perk values.
// Every system that checks VIP calls this module. No external deps.

// ---------------------------------------------------------------------------
// Sovereign Shop Catalog
// ---------------------------------------------------------------------------

var SOVEREIGN_SHOP = [
  // Storage expansions
  { id: 'bank_tab_1', name: 'Bank Tab I', cost: 200, type: 'permanent', category: 'storage', description: '+10 bank slots', requires: null },
  { id: 'bank_tab_2', name: 'Bank Tab II', cost: 350, type: 'permanent', category: 'storage', description: '+10 bank slots', requires: 'bank_tab_1' },
  { id: 'bank_tab_3', name: 'Bank Tab III', cost: 500, type: 'permanent', category: 'storage', description: '+10 bank slots', requires: 'bank_tab_2' },
  { id: 'hidden_stash_1', name: 'Hidden Stash I', cost: 150, type: 'permanent', category: 'storage', description: '+2 pocket slots', requires: null },
  { id: 'hidden_stash_2', name: 'Hidden Stash II', cost: 250, type: 'permanent', category: 'storage', description: '+2 pocket slots', requires: 'hidden_stash_1' },
  { id: 'card_vault_1', name: 'Card Vault I', cost: 200, type: 'permanent', category: 'storage', description: '+50 card collection cap', requires: null },
  { id: 'card_vault_2', name: 'Card Vault II', cost: 350, type: 'permanent', category: 'storage', description: '+50 card collection cap', requires: 'card_vault_1' },
  { id: 'pack_mule_1', name: 'Pack Mule I', cost: 150, type: 'permanent', category: 'storage', description: '+10 carry weight', requires: null },
  { id: 'pack_mule_2', name: 'Pack Mule II', cost: 250, type: 'permanent', category: 'storage', description: '+10 carry weight', requires: 'pack_mule_1' },

  // Character slots
  { id: 'char_slot_5', name: '5th Character Slot', cost: 300, type: 'permanent', category: 'character', description: '+1 character slot', requires: null },
  { id: 'char_slot_6', name: '6th Character Slot', cost: 400, type: 'permanent', category: 'character', description: '+1 character slot', requires: 'char_slot_5' },
  { id: 'char_slot_7', name: '7th Character Slot', cost: 500, type: 'permanent', category: 'character', description: '+1 character slot', requires: 'char_slot_6' },
  { id: 'char_slot_8', name: '8th Character Slot', cost: 600, type: 'permanent', category: 'character', description: '+1 character slot', requires: 'char_slot_7' },

  // Cosmetics
  { id: 'cosmetic_gold_name', name: 'Gold Name Color', cost: 100, type: 'permanent', category: 'cosmetic', description: 'Gold name color' },
  { id: 'cosmetic_silver_name', name: 'Silver Name Color', cost: 75, type: 'permanent', category: 'cosmetic', description: 'Silver name color' },
  { id: 'cosmetic_crimson_name', name: 'Crimson Name Color', cost: 75, type: 'permanent', category: 'cosmetic', description: 'Crimson name color' },
  { id: 'cosmetic_crown_badge', name: 'Crown Badge', cost: 150, type: 'permanent', category: 'cosmetic', description: 'Crown chat badge' },
  { id: 'cosmetic_star_badge', name: 'Star Badge', cost: 100, type: 'permanent', category: 'cosmetic', description: 'Star chat badge' },
  { id: 'cosmetic_gold_border', name: 'Gold Profile Border', cost: 200, type: 'permanent', category: 'cosmetic', description: 'Gold profile border' },
  { id: 'title_patron', name: '"Patron" Title', cost: 50, type: 'permanent', category: 'cosmetic', description: 'Patron title' },
  { id: 'title_benefactor', name: '"Benefactor" Title', cost: 50, type: 'permanent', category: 'cosmetic', description: 'Benefactor title' },
  { id: 'emote_fireworks', name: 'Fireworks Emote', cost: 75, type: 'permanent', category: 'cosmetic', description: 'Fireworks emote' },
  { id: 'emote_confetti', name: 'Confetti Emote', cost: 75, type: 'permanent', category: 'cosmetic', description: 'Confetti emote' },

  // Convenience (consumable — one-use, re-purchasable)
  { id: 'name_change', name: 'Name Change', cost: 150, type: 'consumable', category: 'convenience', description: 'Change your character name' },
  { id: 'race_change', name: 'Race Change', cost: 300, type: 'consumable', category: 'convenience', description: 'Change your race' },
  { id: 'appearance_reset', name: 'Appearance Reset', cost: 100, type: 'consumable', category: 'convenience', description: 'Reset character appearance' },
];

var SHOP_BY_ID = {};
for (var i = 0; i < SOVEREIGN_SHOP.length; i++) {
  SHOP_BY_ID[SOVEREIGN_SHOP[i].id] = SOVEREIGN_SHOP[i];
}

// ---------------------------------------------------------------------------
// VIP Status Helpers
// ---------------------------------------------------------------------------

function isVip(vipStatus) {
  if (!vipStatus) return false;
  return vipStatus.tier === 'vip' && vipStatus.expiresAt > Date.now();
}

function getXpMultiplier(vipStatus) {
  return isVip(vipStatus) ? 1.12 : 1.0;
}

function getPortalCooldown(vipStatus) {
  return isVip(vipStatus) ? 0 : 30000;
}

function getAuctionPerks(vipStatus) {
  if (isVip(vipStatus)) {
    return { feePercent: 2, maxListings: 30, expiryMs: 72 * 60 * 60 * 1000 };
  }
  return { feePercent: 5, maxListings: 20, expiryMs: 24 * 60 * 60 * 1000 };
}

function getMaxPets(vipStatus) {
  return isVip(vipStatus) ? 3 : 2;
}

function getMaxCompanions(vipStatus) {
  return isVip(vipStatus) ? 3 : 2;
}

function getPetHungerDecayRate(vipStatus) {
  return isVip(vipStatus) ? 3.5 : 5;
}

function getCardPullLuckBonus(vipStatus) {
  return isVip(vipStatus) ? 0.03 : 0;
}

// ---------------------------------------------------------------------------
// Permanent Purchase Helpers (survive VIP lapse)
// ---------------------------------------------------------------------------

function hasPermanentPurchase(permanentPurchases, itemId) {
  if (!permanentPurchases) return false;
  return !!permanentPurchases[itemId];
}

function getMaxCharacterSlots(permanentPurchases) {
  var base = 4;
  var slotIds = ['char_slot_5', 'char_slot_6', 'char_slot_7', 'char_slot_8'];
  for (var i = 0; i < slotIds.length; i++) {
    if (hasPermanentPurchase(permanentPurchases, slotIds[i])) base++;
  }
  return base;
}

function getCarryCapacityBonus(permanentPurchases) {
  var bonus = 0;
  if (hasPermanentPurchase(permanentPurchases, 'pack_mule_1')) bonus += 10;
  if (hasPermanentPurchase(permanentPurchases, 'pack_mule_2')) bonus += 10;
  return bonus;
}

function getBankSlotBonus(permanentPurchases) {
  var bonus = 0;
  if (hasPermanentPurchase(permanentPurchases, 'bank_tab_1')) bonus += 10;
  if (hasPermanentPurchase(permanentPurchases, 'bank_tab_2')) bonus += 10;
  if (hasPermanentPurchase(permanentPurchases, 'bank_tab_3')) bonus += 10;
  return bonus;
}

function getCardCollectionBonus(permanentPurchases) {
  var bonus = 0;
  if (hasPermanentPurchase(permanentPurchases, 'card_vault_1')) bonus += 50;
  if (hasPermanentPurchase(permanentPurchases, 'card_vault_2')) bonus += 50;
  return bonus;
}

// ---------------------------------------------------------------------------
// Shop helpers
// ---------------------------------------------------------------------------

function getShopCatalog(permanentPurchases) {
  var catalog = [];
  for (var i = 0; i < SOVEREIGN_SHOP.length; i++) {
    var item = SOVEREIGN_SHOP[i];
    var owned = item.type === 'permanent' && hasPermanentPurchase(permanentPurchases, item.id);
    var locked = false;
    if (item.requires && !hasPermanentPurchase(permanentPurchases, item.requires)) {
      locked = true;
    }
    catalog.push({
      id: item.id,
      name: item.name,
      cost: item.cost,
      type: item.type,
      category: item.category,
      owned: owned,
      locked: locked,
      description: item.description,
    });
  }
  return catalog;
}

function validatePurchase(itemId, permanentPurchases, sovereignBalance) {
  var item = SHOP_BY_ID[itemId];
  if (!item) return { valid: false, error: 'Item not found' };
  if (sovereignBalance < item.cost) return { valid: false, error: 'Insufficient Sovereigns' };
  if (item.type === 'permanent' && hasPermanentPurchase(permanentPurchases, itemId)) {
    return { valid: false, error: 'Already owned' };
  }
  if (item.requires && !hasPermanentPurchase(permanentPurchases, item.requires)) {
    return { valid: false, error: 'Prerequisite not owned: ' + SHOP_BY_ID[item.requires].name };
  }
  return { valid: true, item: item };
}

// ---------------------------------------------------------------------------
// Build perks summary for client
// ---------------------------------------------------------------------------

function buildPerksSummary(vipStatus) {
  var active = isVip(vipStatus);
  return {
    xpMultiplier: active ? 1.12 : 1.0,
    portalCooldown: active ? 0 : 30000,
    auctionFee: active ? 2 : 5,
    auctionListings: active ? 30 : 20,
    auctionExpiry: active ? 72 : 24,
    petSlots: active ? 3 : 2,
    companionSlots: active ? 3 : 2,
    petHungerDecay: active ? 3.5 : 5,
    cardLuckBonus: active ? 0.03 : 0,
    monthlyPack: active,
    monthlySovereigns: active ? 300 : 0,
    chatBadge: active ? 'vip' : null,
    nameColor: active ? 'gold' : null,
    title: active ? 'Patron' : null,
  };
}

module.exports = {
  SOVEREIGN_SHOP: SOVEREIGN_SHOP,
  SHOP_BY_ID: SHOP_BY_ID,
  isVip: isVip,
  getXpMultiplier: getXpMultiplier,
  getPortalCooldown: getPortalCooldown,
  getAuctionPerks: getAuctionPerks,
  getMaxPets: getMaxPets,
  getMaxCompanions: getMaxCompanions,
  getPetHungerDecayRate: getPetHungerDecayRate,
  getCardPullLuckBonus: getCardPullLuckBonus,
  hasPermanentPurchase: hasPermanentPurchase,
  getMaxCharacterSlots: getMaxCharacterSlots,
  getCarryCapacityBonus: getCarryCapacityBonus,
  getBankSlotBonus: getBankSlotBonus,
  getCardCollectionBonus: getCardCollectionBonus,
  getShopCatalog: getShopCatalog,
  validatePurchase: validatePurchase,
  buildPerksSummary: buildPerksSummary,
};
