// account-grid-inventory.js — Persistence bridge for Tarkov-style grid inventory.
// Wraps inventory-grid.js engine with account loading/saving.
// Uses init(deps) pattern to receive loadAccount/saveAccount.

'use strict';

var grid = require('./inventory-grid');
var gridSizes = require('./inventory-grid-sizes');

var loadAccount;
var saveAccount;

var DEFAULT_GRID_WIDTH = 10;
var DEFAULT_GRID_HEIGHT = 6;
var DEFAULT_POCKET_WIDTH = 2;
var DEFAULT_POCKET_HEIGHT = 2;

function init(deps) {
  loadAccount = deps.loadAccount;
  saveAccount = deps.saveAccount;
}

// -------------------------------------------------------------------------
// Ensure account has grid/pocket structures
// -------------------------------------------------------------------------
function initGrid(account) {
  if (!account) return;
  if (!account.grid) {
    account.grid = grid.createGrid(DEFAULT_GRID_WIDTH, DEFAULT_GRID_HEIGHT);
  }
  if (!account.pocket) {
    account.pocket = grid.createGrid(DEFAULT_POCKET_WIDTH, DEFAULT_POCKET_HEIGHT);
  }
  // Ensure placements map exists (older saves may lack it)
  if (!account.grid.placements) account.grid.placements = {};
  if (!account.pocket.placements) account.pocket.placements = {};
}

// -------------------------------------------------------------------------
// Migration: flat mmoInventory.items[] → grid placement
// -------------------------------------------------------------------------
function migrateFromFlatInventory(account) {
  if (!account) return;
  if (!account.mmoInventory || !account.mmoInventory.items) return;
  // Already migrated if grid has placements
  if (account.grid && Object.keys(account.grid.placements).length > 0) return;

  initGrid(account);

  // Stamp grid dimensions on items that lack them
  var items = account.mmoInventory.items;
  for (var i = 0; i < items.length; i++) {
    _stampGridDims(items[i]);
  }

  // Auto-place each item
  var overflow = [];
  for (var j = 0; j < items.length; j++) {
    var item = items[j];
    var fit = grid.findFit(account.grid, item);
    if (fit) {
      grid.place(account.grid, item, fit.x, fit.y, fit.rotated);
    } else {
      overflow.push(item.id);
    }
  }

  if (overflow.length > 0) {
    console.log('[grid-migrate] ' + overflow.length + ' items overflowed for account ' + (account.key || 'unknown'));
  }

  return overflow;
}

// -------------------------------------------------------------------------
// Stamp gridW/gridH on an item if missing
// -------------------------------------------------------------------------
function _stampGridDims(item) {
  if (!item) return;
  if (typeof item.gridW === 'number' && typeof item.gridH === 'number') return;
  var size = gridSizes.getGridSize(item);
  item.gridW = size.w;
  item.gridH = size.h;
}

// -------------------------------------------------------------------------
// Add item to grid at specific position
// -------------------------------------------------------------------------
function gridAddItem(account, item, x, y, rotated) {
  initGrid(account);
  _stampGridDims(item);

  if (!grid.canPlace(account.grid, item, x, y, rotated)) {
    return { ok: false, reason: 'Cannot place item there' };
  }

  grid.place(account.grid, item, x, y, rotated);
  account.grid.rev++;

  // Ensure item is in mmoInventory.items
  _ensureItemInInventory(account, item);

  return { ok: true, rev: account.grid.rev };
}

// -------------------------------------------------------------------------
// Remove item from grid
// -------------------------------------------------------------------------
function gridRemoveItem(account, itemId) {
  initGrid(account);

  if (!account.grid.placements[itemId]) {
    return { ok: false, reason: 'Item not in grid' };
  }

  grid.remove(account.grid, itemId);
  account.grid.rev++;
  return { ok: true, rev: account.grid.rev };
}

// -------------------------------------------------------------------------
// Move item within grid (remove + place)
// -------------------------------------------------------------------------
function gridMoveItem(account, itemId, newX, newY, rotated) {
  initGrid(account);

  var item = _findItem(account, itemId);
  if (!item) return { ok: false, reason: 'Item not found' };

  // Save old placement before removal
  var oldPlacement = account.grid.placements[itemId];
  if (!oldPlacement) return { ok: false, reason: 'Item not placed in grid' };

  // Remove from current position
  grid.remove(account.grid, itemId);

  // Try to place at new position
  if (!grid.canPlace(account.grid, item, newX, newY, rotated)) {
    // Restore original position
    grid.place(account.grid, item, oldPlacement.x, oldPlacement.y, oldPlacement.rotated);
    return { ok: false, reason: 'Cannot place item at target position' };
  }

  grid.place(account.grid, item, newX, newY, rotated);
  account.grid.rev++;
  return { ok: true, rev: account.grid.rev };
}

// -------------------------------------------------------------------------
// Auto-add item: try main grid → backpack sub-grid → rig sub-grid → reject
// -------------------------------------------------------------------------
function gridAutoAdd(account, item) {
  initGrid(account);
  _stampGridDims(item);

  // Try main grid
  var fit = grid.findFit(account.grid, item);
  if (fit) {
    grid.place(account.grid, item, fit.x, fit.y, fit.rotated);
    account.grid.rev++;
    _ensureItemInInventory(account, item);
    return { ok: true, target: 'grid', placement: fit, rev: account.grid.rev };
  }

  // Try backpack sub-grid
  var bpResult = _trySubGrid(account, 'backpack', item);
  if (bpResult) {
    _ensureItemInInventory(account, item);
    return bpResult;
  }

  // Try rig sub-grid
  var rigResult = _trySubGrid(account, 'rig', item);
  if (rigResult) {
    _ensureItemInInventory(account, item);
    return rigResult;
  }

  return { ok: false, reason: 'No space in inventory' };
}

// Try placing item in a container's sub-grid
function _trySubGrid(account, containerSlot, item) {
  if (!account.equipment || !account.equipment[containerSlot]) return null;

  var containerId = account.equipment[containerSlot];
  var containerItem = _findItem(account, containerId);
  if (!containerItem || !containerItem.subGrid) return null;

  var fit = grid.findFit(containerItem.subGrid, item);
  if (fit) {
    grid.place(containerItem.subGrid, item, fit.x, fit.y, fit.rotated);
    containerItem.subGrid.rev++;
    return { ok: true, target: containerSlot, placement: fit, rev: containerItem.subGrid.rev };
  }
  return null;
}

// -------------------------------------------------------------------------
// Move item between grids (main ↔ container ↔ pocket)
// -------------------------------------------------------------------------
function gridTransfer(account, itemId, fromGrid, toGrid, x, y, rotated) {
  var item = _findItem(account, itemId);
  if (!item) return { ok: false, reason: 'Item not found' };

  var srcGrid = _resolveGrid(account, fromGrid);
  var dstGrid = _resolveGrid(account, toGrid);
  if (!srcGrid || !dstGrid) return { ok: false, reason: 'Invalid grid target' };

  var oldPlacement = srcGrid.placements[itemId];
  if (!oldPlacement) return { ok: false, reason: 'Item not in source grid' };

  // Remove from source, try to place in destination
  grid.remove(srcGrid, itemId);
  if (!grid.canPlace(dstGrid, item, x, y, rotated)) {
    // Restore to source
    grid.place(srcGrid, item, oldPlacement.x, oldPlacement.y, oldPlacement.rotated);
    return { ok: false, reason: 'No space in target grid' };
  }

  grid.place(dstGrid, item, x, y, rotated);
  srcGrid.rev++;
  dstGrid.rev++;
  return { ok: true, rev: account.grid.rev };
}

function _resolveGrid(account, gridName) {
  if (gridName === 'grid' || gridName === 'main') return account.grid;
  if (gridName === 'pocket') return account.pocket;
  // Container sub-grids
  if (gridName === 'backpack' || gridName === 'rig') {
    if (!account.equipment || !account.equipment[gridName]) return null;
    var cItem = _findItem(account, account.equipment[gridName]);
    return cItem ? cItem.subGrid : null;
  }
  return null;
}

// -------------------------------------------------------------------------
// Pocket operations
// -------------------------------------------------------------------------
function pocketAdd(account, item, x, y) {
  initGrid(account);
  _stampGridDims(item);

  if (!grid.canPlace(account.pocket, item, x, y, false)) {
    return { ok: false, reason: 'Cannot place in pocket' };
  }

  grid.place(account.pocket, item, x, y, false);
  account.pocket.rev++;
  _ensureItemInInventory(account, item);
  return { ok: true, rev: account.pocket.rev };
}

function pocketRemove(account, itemId) {
  initGrid(account);

  if (!account.pocket.placements[itemId]) {
    return { ok: false, reason: 'Item not in pocket' };
  }

  grid.remove(account.pocket, itemId);
  account.pocket.rev++;
  return { ok: true, rev: account.pocket.rev };
}

// -------------------------------------------------------------------------
// Equip from grid / unequip to grid
// -------------------------------------------------------------------------
function gridSwapToEquip(account, itemId, slot) {
  initGrid(account);
  var item = _findItem(account, itemId);
  if (!item) return { ok: false, reason: 'Item not found' };

  // Remove item from whatever grid it's in
  _removeFromAnyGrid(account, itemId);

  // If something is already in the slot, auto-place it in grid
  var currentEquipped = account.equipment ? account.equipment[slot] : null;
  if (currentEquipped) {
    var oldItem = _findItem(account, currentEquipped);
    if (oldItem) {
      _stampGridDims(oldItem);
      var fit = grid.findFit(account.grid, oldItem);
      if (fit) {
        grid.place(account.grid, oldItem, fit.x, fit.y, fit.rotated);
      } else {
        // Can't fit old item — reject the swap
        // Re-place the original item
        var restore = grid.findFit(account.grid, item);
        if (restore) grid.place(account.grid, item, restore.x, restore.y, restore.rotated);
        return { ok: false, reason: 'No space for currently equipped item' };
      }
    }
  }

  if (!account.equipment) account.equipment = {};
  account.equipment[slot] = itemId;
  account.grid.rev++;
  return { ok: true, rev: account.grid.rev };
}

function gridUnequipToGrid(account, slot) {
  initGrid(account);
  if (!account.equipment || !account.equipment[slot]) {
    return { ok: false, reason: 'Nothing equipped in slot' };
  }

  var itemId = account.equipment[slot];

  // If unequipping a container, check its sub-grid
  if (slot === 'backpack' || slot === 'rig') {
    var containerItem = _findItem(account, itemId);
    if (containerItem && containerItem.subGrid) {
      var subItems = Object.keys(containerItem.subGrid.placements);
      if (subItems.length > 0) {
        // Move sub-grid items to main grid first
        for (var si = 0; si < subItems.length; si++) {
          var subItem = _findItem(account, subItems[si]);
          if (!subItem) continue;
          grid.remove(containerItem.subGrid, subItems[si]);
          var subFit = grid.findFit(account.grid, subItem);
          if (!subFit) {
            return { ok: false, reason: 'Cannot unequip container — no room for its contents' };
          }
          grid.place(account.grid, subItem, subFit.x, subFit.y, subFit.rotated);
        }
      }
    }
  }

  var item = _findItem(account, itemId);
  if (!item) {
    account.equipment[slot] = null;
    return { ok: true, rev: account.grid.rev };
  }

  _stampGridDims(item);
  var fit = grid.findFit(account.grid, item);
  if (!fit) return { ok: false, reason: 'No space in inventory' };

  grid.place(account.grid, item, fit.x, fit.y, fit.rotated);
  account.equipment[slot] = null;
  account.grid.rev++;
  return { ok: true, rev: account.grid.rev };
}

// -------------------------------------------------------------------------
// Stack splitting
// -------------------------------------------------------------------------
function gridSplitStack(account, itemId, count, x, y) {
  initGrid(account);
  var item = _findItem(account, itemId);
  if (!item) return { ok: false, reason: 'Item not found' };
  if (!item.stackSize || item.stackSize <= 1) return { ok: false, reason: 'Item is not stackable' };
  if (count < 1 || count >= item.stackSize) return { ok: false, reason: 'Invalid split count' };

  // Create new stack item
  var newItem = {};
  for (var k in item) {
    if (item.hasOwnProperty(k)) newItem[k] = item[k];
  }
  newItem.id = _generateSplitId();
  newItem.stackSize = count;
  newItem.gridW = item.gridW;
  newItem.gridH = item.gridH;

  if (!grid.canPlace(account.grid, newItem, x, y, false)) {
    return { ok: false, reason: 'Cannot place split stack there' };
  }

  // Reduce original stack
  item.stackSize -= count;

  // Place new stack
  grid.place(account.grid, newItem, x, y, false);
  _ensureItemInInventory(account, newItem);
  account.grid.rev++;

  return { ok: true, newItem: newItem, rev: account.grid.rev };
}

function _generateSplitId() {
  return 'split_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

// -------------------------------------------------------------------------
// Sort / compact
// -------------------------------------------------------------------------
function gridSort(account) {
  initGrid(account);
  var itemsMap = _buildItemsMap(account);
  var result = grid.compact(account.grid, itemsMap);
  account.grid = result.grid;
  account.grid.rev++;
  return { ok: true, rev: account.grid.rev, overflow: result.overflow };
}

// -------------------------------------------------------------------------
// Get full inventory state for client sync
// -------------------------------------------------------------------------
function getFullInventoryState(account) {
  initGrid(account);
  var items = (account.mmoInventory && account.mmoInventory.items) || [];
  var eq = account.equipment || {};

  // Build container sub-grid snapshots
  var containers = {};
  var containerSlots = ['backpack', 'rig'];
  for (var ci = 0; ci < containerSlots.length; ci++) {
    var cs = containerSlots[ci];
    if (eq[cs]) {
      var cItem = _findItem(account, eq[cs]);
      if (cItem && cItem.subGrid) {
        containers[cs] = grid.serialize(cItem.subGrid);
      }
    }
  }

  return {
    grid: grid.serialize(account.grid),
    pocket: grid.serialize(account.pocket),
    equipment: eq,
    containers: containers,
    items: items,
    rev: account.grid.rev,
  };
}

// -------------------------------------------------------------------------
// Revision-based mutation (optimistic locking)
// -------------------------------------------------------------------------
function applyMutation(account, mutation, clientRev) {
  initGrid(account);

  if (clientRev !== account.grid.rev) {
    return { ok: false, reason: 'Revision mismatch', fullState: getFullInventoryState(account) };
  }

  var result;
  switch (mutation.type) {
    case 'move':
      result = gridMoveItem(account, mutation.itemId, mutation.x, mutation.y, mutation.rotated);
      break;
    case 'transfer':
      result = gridTransfer(account, mutation.itemId, mutation.fromGrid, mutation.toGrid, mutation.x, mutation.y, mutation.rotated);
      break;
    case 'equip':
      result = gridSwapToEquip(account, mutation.itemId, mutation.slot);
      break;
    case 'unequip':
      result = gridUnequipToGrid(account, mutation.slot);
      break;
    case 'split':
      result = gridSplitStack(account, mutation.itemId, mutation.count, mutation.x, mutation.y);
      break;
    case 'sort':
      result = gridSort(account);
      break;
    case 'pocket_move':
      result = gridTransfer(account, mutation.itemId, mutation.fromGrid || 'grid', 'pocket', mutation.x, mutation.y, false);
      break;
    default:
      return { ok: false, reason: 'Unknown mutation type' };
  }

  if (!result.ok) {
    return { ok: false, reason: result.reason, fullState: getFullInventoryState(account) };
  }

  return { ok: true, rev: account.grid.rev };
}

// -------------------------------------------------------------------------
// Pocket persistence for permadeath / doom-ascension
// -------------------------------------------------------------------------

// Call on permadeath — saves pocket contents to account root
function preservePocketOnPermadeath(account) {
  if (!account) return;
  initGrid(account);

  var pocketItemIds = Object.keys(account.pocket.placements);
  if (pocketItemIds.length === 0) {
    account.hiddenPocketLegacy = null;
    return;
  }

  // Deep-copy pocket grid and the actual items
  var pocketItems = [];
  var items = (account.mmoInventory && account.mmoInventory.items) || [];
  for (var i = 0; i < pocketItemIds.length; i++) {
    for (var j = 0; j < items.length; j++) {
      if (items[j].id === pocketItemIds[i]) {
        pocketItems.push(JSON.parse(JSON.stringify(items[j])));
        break;
      }
    }
  }

  account.hiddenPocketLegacy = {
    cells: JSON.parse(JSON.stringify(account.pocket.cells)),
    placements: JSON.parse(JSON.stringify(account.pocket.placements)),
    width: account.pocket.width,
    height: account.pocket.height,
    items: pocketItems,
  };
}

// Call on new character creation — restore pocket from legacy
function restorePocketFromLegacy(account) {
  if (!account || !account.hiddenPocketLegacy) return;
  initGrid(account);

  var legacy = account.hiddenPocketLegacy;
  account.pocket.cells = legacy.cells || {};
  account.pocket.placements = legacy.placements || {};
  account.pocket.width = legacy.width || DEFAULT_POCKET_WIDTH;
  account.pocket.height = legacy.height || DEFAULT_POCKET_HEIGHT;
  account.pocket.rev = 0;

  // Add legacy items to new character's inventory
  if (legacy.items && legacy.items.length > 0) {
    if (!account.mmoInventory) account.mmoInventory = { wood: 0, stone: 0, iron_ore: 0, iron_bar: 0, items: [] };
    if (!account.mmoInventory.items) account.mmoInventory.items = [];
    for (var i = 0; i < legacy.items.length; i++) {
      // Avoid duplicates
      var exists = false;
      for (var j = 0; j < account.mmoInventory.items.length; j++) {
        if (account.mmoInventory.items[j].id === legacy.items[i].id) { exists = true; break; }
      }
      if (!exists) account.mmoInventory.items.push(legacy.items[i]);
    }
  }

  // Keep legacy until explicitly cleared (persists across doom too)
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function _findItem(account, itemId) {
  if (!account.mmoInventory || !account.mmoInventory.items) return null;
  var items = account.mmoInventory.items;
  for (var i = 0; i < items.length; i++) {
    if (items[i].id === itemId) return items[i];
  }
  return null;
}

function _ensureItemInInventory(account, item) {
  if (!account.mmoInventory) account.mmoInventory = { wood: 0, stone: 0, iron_ore: 0, iron_bar: 0, items: [] };
  if (!account.mmoInventory.items) account.mmoInventory.items = [];
  for (var i = 0; i < account.mmoInventory.items.length; i++) {
    if (account.mmoInventory.items[i].id === item.id) return;
  }
  account.mmoInventory.items.push(item);
}

function _removeFromAnyGrid(account, itemId) {
  // Main grid
  if (account.grid && account.grid.placements[itemId]) {
    grid.remove(account.grid, itemId);
    return;
  }
  // Pocket
  if (account.pocket && account.pocket.placements[itemId]) {
    grid.remove(account.pocket, itemId);
    return;
  }
  // Container sub-grids
  var containerSlots = ['backpack', 'rig'];
  for (var ci = 0; ci < containerSlots.length; ci++) {
    if (account.equipment && account.equipment[containerSlots[ci]]) {
      var cItem = _findItem(account, account.equipment[containerSlots[ci]]);
      if (cItem && cItem.subGrid && cItem.subGrid.placements[itemId]) {
        grid.remove(cItem.subGrid, itemId);
        return;
      }
    }
  }
}

function _buildItemsMap(account) {
  var map = {};
  if (account.mmoInventory && account.mmoInventory.items) {
    var items = account.mmoInventory.items;
    for (var i = 0; i < items.length; i++) {
      map[items[i].id] = items[i];
    }
  }
  return map;
}

module.exports = {
  init: init,
  initGrid: initGrid,
  migrateFromFlatInventory: migrateFromFlatInventory,
  gridAddItem: gridAddItem,
  gridRemoveItem: gridRemoveItem,
  gridMoveItem: gridMoveItem,
  gridAutoAdd: gridAutoAdd,
  gridTransfer: gridTransfer,
  pocketAdd: pocketAdd,
  pocketRemove: pocketRemove,
  gridSwapToEquip: gridSwapToEquip,
  gridUnequipToGrid: gridUnequipToGrid,
  gridSplitStack: gridSplitStack,
  gridSort: gridSort,
  getFullInventoryState: getFullInventoryState,
  applyMutation: applyMutation,
  preservePocketOnPermadeath: preservePocketOnPermadeath,
  restorePocketFromLegacy: restorePocketFromLegacy,

  DEFAULT_GRID_WIDTH: DEFAULT_GRID_WIDTH,
  DEFAULT_GRID_HEIGHT: DEFAULT_GRID_HEIGHT,
  DEFAULT_POCKET_WIDTH: DEFAULT_POCKET_WIDTH,
  DEFAULT_POCKET_HEIGHT: DEFAULT_POCKET_HEIGHT,
};
