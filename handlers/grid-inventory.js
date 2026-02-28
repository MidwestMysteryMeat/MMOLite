// handlers/grid-inventory.js
// Socket handler for Tarkov-style grid inventory operations.
// Events: grid_move, grid_equip, grid_unequip, grid_swap, grid_drop,
//         grid_split_stack, grid_sort, grid_pocket_move, grid_sync

'use strict';

var gridInv = require('../account-grid-inventory');
var equipData = require('../equipment-data');
var accountEquipment = require('../account-equipment');
var accountWeight = require('../account-weight');
var gridSizes = require('../inventory-grid-sizes');

function init(io, socket, deps) {
  var accounts = deps.accounts;
  var socketAccountMap = deps.socketAccountMap;
  var state = deps.state;

  // Helper: load account for this socket
  function _getAccount() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return null;
    return accounts.loadAccount(key);
  }

  function _getKey() {
    return socketAccountMap.get(socket.id);
  }

  // Helper: validate revision and reject stale mutations
  function _checkRev(account, clientRev) {
    gridInv.initGrid(account);
    if (typeof clientRev !== 'number') return false;
    return clientRev === account.grid.rev;
  }

  // Helper: send full resync
  function _sendResync(account, reason) {
    socket.emit('grid_reject', {
      reason: reason,
      fullState: gridInv.getFullInventoryState(account),
    });
  }

  // Helper: save and send update
  function _commitUpdate(account, mutation) {
    accounts.saveAccount(account);
    socket.emit('grid_update', {
      mutation: mutation,
      rev: account.grid.rev,
    });
  }

  // ------------------------------------------------------------------
  // grid_sync — full inventory state request
  // ------------------------------------------------------------------
  socket.on('grid_sync', function() {
    var account = _getAccount();
    if (!account) return;

    // Ensure grid is initialized + migrated
    gridInv.initGrid(account);
    if (!account.grid.placements || Object.keys(account.grid.placements).length === 0) {
      var items = (account.mmoInventory && account.mmoInventory.items) || [];
      if (items.length > 0) {
        gridInv.migrateFromFlatInventory(account);
        accounts.saveAccount(account);
      }
    }

    socket.emit('grid_state', gridInv.getFullInventoryState(account));
  });

  // ------------------------------------------------------------------
  // grid_move — move/rotate item within a grid
  // ------------------------------------------------------------------
  socket.on('grid_move', function(data) {
    if (!data || typeof data.itemId !== 'string') return;
    var account = _getAccount();
    if (!account) return;

    if (!_checkRev(account, data.rev)) {
      _sendResync(account, 'Revision mismatch');
      return;
    }

    var targetGrid = data.targetGrid || 'grid';
    var result;

    if (targetGrid === 'grid') {
      result = gridInv.gridMoveItem(account, data.itemId, data.x, data.y, data.rotated);
    } else {
      // Transfer between grids
      var fromGrid = _findItemGrid(account, data.itemId);
      result = gridInv.gridTransfer(account, data.itemId, fromGrid, targetGrid, data.x, data.y, data.rotated);
    }

    if (!result.ok) {
      _sendResync(account, result.reason);
      return;
    }

    _commitUpdate(account, { type: 'move', itemId: data.itemId, x: data.x, y: data.y, rotated: data.rotated, targetGrid: targetGrid });
  });

  // ------------------------------------------------------------------
  // grid_equip — move item from grid to equipment slot
  // ------------------------------------------------------------------
  socket.on('grid_equip', function(data) {
    if (!data || typeof data.itemId !== 'string' || typeof data.slot !== 'string') return;
    var account = _getAccount();
    if (!account) return;

    if (!_checkRev(account, data.rev)) {
      _sendResync(account, 'Revision mismatch');
      return;
    }

    // Validate slot
    if (equipData.EQUIPMENT_SLOTS.indexOf(data.slot) === -1 &&
        data.slot !== 'backpack' && data.slot !== 'rig') {
      _sendResync(account, 'Invalid equipment slot');
      return;
    }

    // Use existing skill/slot validation from account-equipment for non-container slots
    if (data.slot !== 'backpack' && data.slot !== 'rig') {
      var equipResult = accounts.equipMMOItem(_getKey(), data.slot, data.itemId);
      if (!equipResult || equipResult.error) {
        _sendResync(account, (equipResult && equipResult.error) || 'Cannot equip item');
        return;
      }
      // Now remove the item from its grid position
      var freshAccount = accounts.loadAccount(_getKey());
      gridInv.initGrid(freshAccount);
      _removeFromAnyGrid(freshAccount, data.itemId);
      freshAccount.grid.rev++;
      accounts.saveAccount(freshAccount);
      socket.emit('grid_update', {
        mutation: { type: 'equip', itemId: data.itemId, slot: data.slot },
        rev: freshAccount.grid.rev,
      });
      return;
    }

    // Container equip (backpack/rig)
    var item = _findItemInAccount(account, data.itemId);
    if (!item) { _sendResync(account, 'Item not found'); return; }

    // Initialize sub-grid on the container item
    var containerSize = gridSizes.getContainerGridSize(item);
    if (!containerSize) { _sendResync(account, 'Item is not a container'); return; }

    if (!item.subGrid) {
      var gridModule = require('../inventory-grid');
      item.subGrid = gridModule.createGrid(containerSize.w, containerSize.h);
    }

    var result = gridInv.gridSwapToEquip(account, data.itemId, data.slot);
    if (!result.ok) {
      _sendResync(account, result.reason);
      return;
    }

    _commitUpdate(account, { type: 'equip', itemId: data.itemId, slot: data.slot });
  });

  // ------------------------------------------------------------------
  // grid_unequip — move equipped item back to grid
  // ------------------------------------------------------------------
  socket.on('grid_unequip', function(data) {
    if (!data || typeof data.slot !== 'string') return;
    var account = _getAccount();
    if (!account) return;

    if (!_checkRev(account, data.rev)) {
      _sendResync(account, 'Revision mismatch');
      return;
    }

    var result = gridInv.gridUnequipToGrid(account, data.slot);
    if (!result.ok) {
      _sendResync(account, result.reason);
      return;
    }

    _commitUpdate(account, { type: 'unequip', slot: data.slot });
  });

  // ------------------------------------------------------------------
  // grid_swap — swap grid item with equipped item in one operation
  // ------------------------------------------------------------------
  socket.on('grid_swap', function(data) {
    if (!data || typeof data.itemId !== 'string' || typeof data.slot !== 'string') return;
    var account = _getAccount();
    if (!account) return;

    if (!_checkRev(account, data.rev)) {
      _sendResync(account, 'Revision mismatch');
      return;
    }

    var result = gridInv.gridSwapToEquip(account, data.itemId, data.slot);
    if (!result.ok) {
      _sendResync(account, result.reason);
      return;
    }

    _commitUpdate(account, { type: 'swap', itemId: data.itemId, slot: data.slot });
  });

  // ------------------------------------------------------------------
  // grid_drop — drop item from grid to ground
  // ------------------------------------------------------------------
  socket.on('grid_drop', function(data) {
    if (!data || typeof data.itemId !== 'string') return;
    var key = _getKey();
    var account = _getAccount();
    if (!account || !key) return;

    if (!_checkRev(account, data.rev)) {
      _sendResync(account, 'Revision mismatch');
      return;
    }

    var item = _findItemInAccount(account, data.itemId);
    if (!item) { _sendResync(account, 'Item not found'); return; }

    // Remove from grid
    _removeFromAnyGrid(account, data.itemId);

    // Remove from mmoInventory.items
    if (account.mmoInventory && account.mmoInventory.items) {
      var idx = -1;
      for (var i = 0; i < account.mmoInventory.items.length; i++) {
        if (account.mmoInventory.items[i].id === data.itemId) { idx = i; break; }
      }
      if (idx !== -1) account.mmoInventory.items.splice(idx, 1);
    }

    account.grid.rev++;

    // Emit loot_dropped to zone for pickup by other players
    var user = state.users.get(socket.id);
    var zoneId = state.playerZones.get(socket.id);
    if (user && zoneId) {
      io.to('zone:' + zoneId).emit('loot_dropped', {
        item: item,
        x: user.x || 0,
        y: user.y || 0,
        droppedBy: user.name,
        zoneId: zoneId,
      });
    }

    _commitUpdate(account, { type: 'drop', itemId: data.itemId });
  });

  // ------------------------------------------------------------------
  // grid_split_stack — split a stackable into two stacks
  // ------------------------------------------------------------------
  socket.on('grid_split_stack', function(data) {
    if (!data || typeof data.itemId !== 'string' || typeof data.count !== 'number') return;
    var account = _getAccount();
    if (!account) return;

    if (!_checkRev(account, data.rev)) {
      _sendResync(account, 'Revision mismatch');
      return;
    }

    var result = gridInv.gridSplitStack(account, data.itemId, data.count, data.x, data.y);
    if (!result.ok) {
      _sendResync(account, result.reason);
      return;
    }

    _commitUpdate(account, { type: 'split', itemId: data.itemId, count: data.count, newItem: result.newItem });
  });

  // ------------------------------------------------------------------
  // grid_sort — auto-sort/compact grid
  // ------------------------------------------------------------------
  socket.on('grid_sort', function(data) {
    data = data || {};
    var account = _getAccount();
    if (!account) return;

    if (!_checkRev(account, data.rev)) {
      _sendResync(account, 'Revision mismatch');
      return;
    }

    var result = gridInv.gridSort(account);
    if (!result.ok) {
      _sendResync(account, result.reason || 'Sort failed');
      return;
    }

    accounts.saveAccount(account);
    // Send full state after sort for clean re-render
    socket.emit('grid_state', gridInv.getFullInventoryState(account));
  });

  // ------------------------------------------------------------------
  // grid_pocket_move — move item to/from/within pocket
  // ------------------------------------------------------------------
  socket.on('grid_pocket_move', function(data) {
    if (!data || typeof data.itemId !== 'string') return;
    var account = _getAccount();
    if (!account) return;

    if (!_checkRev(account, data.rev)) {
      _sendResync(account, 'Revision mismatch');
      return;
    }

    var fromGrid = data.fromGrid || _findItemGrid(account, data.itemId);
    var toGrid = data.toGrid || 'pocket';

    var result = gridInv.gridTransfer(account, data.itemId, fromGrid, toGrid, data.x, data.y, false);
    if (!result.ok) {
      _sendResync(account, result.reason);
      return;
    }

    _commitUpdate(account, { type: 'pocket_move', itemId: data.itemId, x: data.x, y: data.y, fromGrid: fromGrid, toGrid: toGrid });
  });

  // ------------------------------------------------------------------
  // Compatibility shims for old equip/unequip events
  // ------------------------------------------------------------------

  // Old clients may still send equip_mmo_item / unequip_mmo_item.
  // These are handled by account-equipment.js directly but we also
  // need to update grid positions. The existing handler in inventory.js
  // remains — we just ensure grid state is consistent on next grid_sync.

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  function _findItemInAccount(account, itemId) {
    if (!account.mmoInventory || !account.mmoInventory.items) return null;
    var items = account.mmoInventory.items;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === itemId) return items[i];
    }
    return null;
  }

  function _findItemGrid(account, itemId) {
    gridInv.initGrid(account);
    if (account.grid.placements[itemId]) return 'grid';
    if (account.pocket.placements[itemId]) return 'pocket';
    // Check containers
    var containerSlots = ['backpack', 'rig'];
    for (var ci = 0; ci < containerSlots.length; ci++) {
      var cs = containerSlots[ci];
      if (account.equipment && account.equipment[cs]) {
        var cItem = _findItemInAccount(account, account.equipment[cs]);
        if (cItem && cItem.subGrid && cItem.subGrid.placements[itemId]) return cs;
      }
    }
    return 'grid';
  }

  function _removeFromAnyGrid(account, itemId) {
    var gridModule = require('../inventory-grid');
    gridInv.initGrid(account);
    if (account.grid.placements[itemId]) { gridModule.remove(account.grid, itemId); return; }
    if (account.pocket.placements[itemId]) { gridModule.remove(account.pocket, itemId); return; }
    var containerSlots = ['backpack', 'rig'];
    for (var ci = 0; ci < containerSlots.length; ci++) {
      var cs = containerSlots[ci];
      if (account.equipment && account.equipment[cs]) {
        var cItem = _findItemInAccount(account, account.equipment[cs]);
        if (cItem && cItem.subGrid && cItem.subGrid.placements[itemId]) {
          gridModule.remove(cItem.subGrid, itemId);
          return;
        }
      }
    }
  }
}

module.exports = { init: init };
