// account-inventory.js — Badge/title inventory + MMO item inventory
// Needs loadAccount/saveAccount via init(deps).

var accountWeight = require('./account-weight');
var gridSizes = require('./inventory-grid-sizes');

var loadAccount;
var saveAccount;

var MAX_INVENTORY = 200;

function init(deps) {
  loadAccount = deps.loadAccount;
  saveAccount = deps.saveAccount;
}

function addInventoryItem(key, instanceItem) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!account.inventory) account.inventory = [];
  if (account.inventory.length >= MAX_INVENTORY) return { error: 'Inventory full' };
  account.inventory.push({
    id: instanceItem.instanceId,
    itemId: instanceItem.itemId,
    modifier: instanceItem.modifier || null,
    serial: instanceItem.serial || null,
    obtainedAt: instanceItem.obtainedAt || Date.now(),
    source: instanceItem.source || 'unknown',
  });
  saveAccount(account);
  return account.inventory;
}

function removeInventoryItem(key, instanceId) {
  const account = loadAccount(key);
  if (!account || !account.inventory) return null;
  const idx = account.inventory.findIndex(i => i.id === instanceId);
  if (idx === -1) return null;
  const removed = account.inventory.splice(idx, 1)[0];
  // Unequip if this item was equipped
  if (account.equipped) {
    if (account.equipped.badge === removed.itemId) account.equipped.badge = null;
    if (account.equipped.title === removed.itemId) account.equipped.title = null;
  }
  saveAccount(account);
  return removed;
}

function equipItem(key, instanceId) {
  const account = loadAccount(key);
  if (!account || !account.inventory) return null;
  const invItem = account.inventory.find(i => i.id === instanceId);
  if (!invItem) return null;
  if (!account.equipped) account.equipped = { badge: null, title: null };
  // Determine type from itemId prefix
  if (invItem.itemId.startsWith('badge_')) {
    account.equipped.badge = invItem.itemId;
  } else if (invItem.itemId.startsWith('title_')) {
    account.equipped.title = invItem.itemId;
  } else {
    return null; // collectibles can't be equipped
  }
  saveAccount(account);
  return account.equipped;
}

function unequipItem(key, type) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!account.equipped) account.equipped = { badge: null, title: null };
  if (type === 'badge') account.equipped.badge = null;
  else if (type === 'title') account.equipped.title = null;
  else return null;
  saveAccount(account);
  return account.equipped;
}

function getInventory(key) {
  const account = loadAccount(key);
  if (!account) return { inventory: [], equipped: { badge: null, title: null } };
  return {
    inventory: account.inventory || [],
    equipped: account.equipped || { badge: null, title: null },
  };
}

function getMMOInventory(key) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!account.mmoInventory) return { wood: 0, stone: 0, iron_ore: 0, iron_bar: 0, items: [] };
  return account.mmoInventory;
}

function addMMOItem(key, item) {
  var account = loadAccount(key);
  if (!account) return null;
  if (!account.mmoInventory) account.mmoInventory = { wood: 0, stone: 0, iron_ore: 0, iron_bar: 0, items: [] };
  if (!account.mmoInventory.items) account.mmoInventory.items = [];
  // Weight check — reject if item would exceed carry capacity
  var itemWeight = accountWeight.getItemWeight(item);
  if (!accountWeight.canCarryWeight(account, itemWeight)) {
    return { error: 'Too heavy to carry' };
  }
  // Stamp grid dimensions if missing
  if (typeof item.gridW !== 'number' || typeof item.gridH !== 'number') {
    var sz = gridSizes.getGridSize(item);
    item.gridW = sz.w;
    item.gridH = sz.h;
  }
  // Grid is the primary capacity gate — item must fit in a grid
  var gridInv = require('./account-grid-inventory');
  gridInv.initGrid(account);
  var gridResult = gridInv.gridAutoAdd(account, item);
  if (!gridResult.ok) {
    return { error: gridResult.reason || 'No space in inventory' };
  }
  // gridAutoAdd already calls _ensureItemInInventory, so item is in mmoInventory.items[]
  saveAccount(account);
  // Return inventory + grid info for callers that emit grid_item_added
  var result = account.mmoInventory;
  result._gridRev = account.grid ? account.grid.rev : 0;
  result._gridPlacement = gridResult.placement || null;
  result._gridTarget = gridResult.target || 'grid';
  return result;
}

function removeMMOItem(key, itemId) {
  var account = loadAccount(key);
  if (!account) return null;
  if (!account.mmoInventory || !account.mmoInventory.items) return null;
  var idx = -1;
  for (var i = 0; i < account.mmoInventory.items.length; i++) {
    if (account.mmoInventory.items[i].id === itemId) { idx = i; break; }
  }
  if (idx === -1) return null;
  var removed = account.mmoInventory.items.splice(idx, 1)[0];
  // Also remove from whichever grid the item occupies
  if (account.grid) {
    var gridInv = require('./account-grid-inventory');
    gridInv.gridRemoveItem(account, itemId);
    // Also check pocket and sub-grids
    if (account.pocket && account.pocket.placements && account.pocket.placements[itemId]) {
      gridInv.pocketRemove(account, itemId);
    }
  }
  saveAccount(account);
  return removed;
}

module.exports = {
  init,
  MAX_INVENTORY,
  addInventoryItem,
  removeInventoryItem,
  equipItem,
  unequipItem,
  getInventory,
  getMMOInventory,
  addMMOItem,
  removeMMOItem,
};
