// inventory-grid-sizes.js — Item grid dimensions for Tarkov-style inventory.
// Maps item type/slot to width×height in grid cells.
// Pure data — no dependencies.

var GRID_SIZES = {
  // Weapons — 2h are taller
  weapon_2h:    { w: 1, h: 3 },
  weapon_1h:    { w: 1, h: 2 },
  shield:       { w: 2, h: 2 },

  // Armor
  head:         { w: 2, h: 2 },
  chest:        { w: 2, h: 3 },
  legs:         { w: 2, h: 2 },
  feet:         { w: 2, h: 1 },
  hands:        { w: 2, h: 1 },
  arms:         { w: 2, h: 1 },
  undershirt:   { w: 2, h: 2 },

  // Jewelry — small
  ring:         { w: 1, h: 1 },
  necklace:     { w: 1, h: 1 },

  // Tools
  axe:          { w: 1, h: 2 },
  pickaxe:      { w: 1, h: 2 },

  // Consumables / scrolls — tiny
  consumable:   { w: 1, h: 1 },
  scroll:       { w: 1, h: 1 },

  // Containers
  backpack:     { w: 2, h: 3 },
  rig:          { w: 2, h: 2 },

  default:      { w: 1, h: 1 },
};

// Sub-grid dimensions for container items when equipped
var CONTAINER_SIZES = {
  // Backpacks
  leather_satchel:    { w: 2, h: 2 },
  adventurer_pack:    { w: 3, h: 2 },
  explorer_backpack:  { w: 3, h: 3 },
  mithril_frame:      { w: 4, h: 3 },

  // Rigs
  belt_pouch:         { w: 2, h: 1 },
  utility_vest:       { w: 2, h: 2 },
  tactical_rig:       { w: 3, h: 2 },
};

// Resolve the grid dimensions for a given item object.
// Uses item.slot + item.handedness to pick the right size key.
function getGridSize(item) {
  if (!item) return GRID_SIZES.default;

  // Already stamped
  if (typeof item.gridW === 'number' && typeof item.gridH === 'number') {
    return { w: item.gridW, h: item.gridH };
  }

  // Container types
  if (item.type && CONTAINER_SIZES[item.type]) {
    return GRID_SIZES[item.containerSlot || 'backpack'] || GRID_SIZES.default;
  }

  var slot = item.slot;

  // Weapon slot — differentiate 1h vs 2h
  if (slot === 'weapon') {
    var hand = item.handedness || '1h';
    return hand === '2h' ? GRID_SIZES.weapon_2h : GRID_SIZES.weapon_1h;
  }

  // Shield
  if (slot === 'shield') return GRID_SIZES.shield;

  // Ring variants (ring1 through ring6)
  if (slot && slot.indexOf('ring') === 0) return GRID_SIZES.ring;

  // Direct slot match
  if (slot && GRID_SIZES[slot]) return GRID_SIZES[slot];

  // Consumable/scroll by isConsumable flag or type prefix
  if (item.isConsumable) return GRID_SIZES.consumable;
  if (item.type && item.type.indexOf('scroll') === 0) return GRID_SIZES.scroll;

  // Tool types
  if (item.type && item.type.indexOf('axe') !== -1 && item.type.indexOf('pickaxe') === -1) return GRID_SIZES.axe;
  if (item.type && item.type.indexOf('pickaxe') !== -1) return GRID_SIZES.pickaxe;

  return GRID_SIZES.default;
}

// Get the sub-grid dimensions a container provides when equipped
function getContainerGridSize(item) {
  if (!item || !item.type) return null;
  return CONTAINER_SIZES[item.type] || null;
}

module.exports = {
  GRID_SIZES: GRID_SIZES,
  CONTAINER_SIZES: CONTAINER_SIZES,
  getGridSize: getGridSize,
  getContainerGridSize: getContainerGridSize,
};
