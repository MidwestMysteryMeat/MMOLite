// handlers/bank.js
// Town Bank — global vault accessible from any town's banker NPC.
// Stores gold, resources, and items. Fully preserved through doom ascension.
// Events: bank_open, bank_deposit_gold, bank_withdraw_gold,
//         bank_deposit_resource, bank_withdraw_resource,
//         bank_deposit_item, bank_withdraw_item, bank_buy_slots

var BANK_INTERACT_RANGE = 80;
var BASE_SLOTS = 50;
var SLOTS_PER_EXPANSION = 10;
var MAX_EXPANSIONS = 15;
var EXPANSION_BASE_COST = 5000;

// Per-account lock to prevent concurrent deposit/withdraw race conditions
var bankLocks = new Set();

function _ensureVault(account) {
  if (!account.bankVault) {
    account.bankVault = { gold: 0, resources: {}, items: [], maxSlots: BASE_SLOTS, expansionsPurchased: 0 };
  }
  if (typeof account.bankVault.gold !== 'number') account.bankVault.gold = 0;
  if (!account.bankVault.resources) account.bankVault.resources = {};
  if (!Array.isArray(account.bankVault.items)) account.bankVault.items = [];
  if (typeof account.bankVault.maxSlots !== 'number') account.bankVault.maxSlots = BASE_SLOTS;
  if (typeof account.bankVault.expansionsPurchased !== 'number') account.bankVault.expansionsPurchased = 0;
}

function _getNextExpansionCost(vault) {
  return EXPANSION_BASE_COST * (1 + vault.expansionsPurchased);
}

function _bankContentsPayload(vault) {
  return {
    gold: vault.gold,
    resources: vault.resources,
    items: vault.items,
    maxSlots: vault.maxSlots,
    expansionsPurchased: vault.expansionsPurchased,
    nextExpansionCost: vault.expansionsPurchased < MAX_EXPANSIONS ? _getNextExpansionCost(vault) : null,
  };
}

function _findBankerNpc(state, socketId) {
  var zoneId = state.playerZones.get(socketId);
  if (!zoneId) return null;
  var zone = state.zones.get(zoneId);
  if (!zone || !zone.npcs) return null;
  for (var i = 0; i < zone.npcs.length; i++) {
    if (zone.npcs[i].type === 'banker') return zone.npcs[i];
  }
  return null;
}

function _isNearBanker(state, socketId) {
  var banker = _findBankerNpc(state, socketId);
  if (!banker) return false;
  var pos = state.playerPositions.get(socketId);
  if (!pos) return false;
  var dx = pos.x - banker.x;
  var dy = pos.y - banker.y;
  return (dx * dx + dy * dy) <= (BANK_INTERACT_RANGE * BANK_INTERACT_RANGE);
}

module.exports = {
  init(io, socket, deps) {
    var { socketAccountMap, accounts, state, checkEventRate } = deps;

    // --- bank_open: request bank contents ---
    socket.on('bank_open', function() {
      if (!checkEventRate(socket, 'bank_open', 5, 2000)) return;
      if (!_isNearBanker(state, socket.id)) {
        socket.emit('bank_error', { message: 'You must be near a banker' });
        return;
      }
      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      var acc = accounts.loadAccount(key);
      if (!acc) return;
      _ensureVault(acc);
      socket.emit('bank_contents', _bankContentsPayload(acc.bankVault));
    });

    // --- bank_deposit_gold ---
    socket.on('bank_deposit_gold', function(data) {
      if (!checkEventRate(socket, 'bank_op', 10, 2000)) return;
      if (!data || typeof data.amount !== 'number') return;
      if (!_isNearBanker(state, socket.id)) {
        socket.emit('bank_error', { message: 'You must be near a banker' });
        return;
      }
      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      if (bankLocks.has(key)) { socket.emit('bank_error', { message: 'Transaction in progress' }); return; }
      bankLocks.add(key);
      try {
        var acc = accounts.loadAccount(key);
        if (!acc) return;
        _ensureVault(acc);
        var amount = Math.floor(data.amount);
        if (amount < 1) { socket.emit('bank_error', { message: 'Invalid amount' }); return; }
        if (acc.chips < amount) { socket.emit('bank_error', { message: 'Not enough gold' }); return; }
        acc.chips -= amount;
        acc.bankVault.gold += amount;
        accounts.saveAccount(acc);
        socket.emit('bank_result', {
          success: true, action: 'deposit_gold',
          bank: _bankContentsPayload(acc.bankVault),
          chips: acc.chips,
        });
      } finally {
        bankLocks.delete(key);
      }
    });

    // --- bank_withdraw_gold ---
    socket.on('bank_withdraw_gold', function(data) {
      if (!checkEventRate(socket, 'bank_op', 10, 2000)) return;
      if (!data || typeof data.amount !== 'number') return;
      if (!_isNearBanker(state, socket.id)) {
        socket.emit('bank_error', { message: 'You must be near a banker' });
        return;
      }
      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      if (bankLocks.has(key)) { socket.emit('bank_error', { message: 'Transaction in progress' }); return; }
      bankLocks.add(key);
      try {
        var acc = accounts.loadAccount(key);
        if (!acc) return;
        _ensureVault(acc);
        var amount = Math.floor(data.amount);
        if (amount < 1) { socket.emit('bank_error', { message: 'Invalid amount' }); return; }
        if (acc.bankVault.gold < amount) { socket.emit('bank_error', { message: 'Not enough gold in bank' }); return; }
        acc.bankVault.gold -= amount;
        acc.chips += amount;
        accounts.saveAccount(acc);
        socket.emit('bank_result', {
          success: true, action: 'withdraw_gold',
          bank: _bankContentsPayload(acc.bankVault),
          chips: acc.chips,
        });
      } finally {
        bankLocks.delete(key);
      }
    });

    // --- bank_deposit_resource ---
    socket.on('bank_deposit_resource', function(data) {
      if (!checkEventRate(socket, 'bank_op', 10, 2000)) return;
      if (!data || typeof data.resource !== 'string' || typeof data.amount !== 'number') return;
      if (!_isNearBanker(state, socket.id)) {
        socket.emit('bank_error', { message: 'You must be near a banker' });
        return;
      }
      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      if (bankLocks.has(key)) { socket.emit('bank_error', { message: 'Transaction in progress' }); return; }
      bankLocks.add(key);
      try {
        var amount = Math.floor(data.amount);
        if (amount < 1) { socket.emit('bank_error', { message: 'Invalid amount' }); return; }
        var acc = accounts.loadAccount(key);
        if (!acc) return;
        var result = accounts.removeResource(key, data.resource, amount);
        if (!result) { socket.emit('bank_error', { message: 'Not enough resources' }); return; }
        _ensureVault(acc);
        acc.bankVault.resources[data.resource] = (acc.bankVault.resources[data.resource] || 0) + amount;
        accounts.saveAccount(acc);
        socket.emit('bank_result', {
          success: true, action: 'deposit_resource',
          bank: _bankContentsPayload(acc.bankVault),
          inventory: acc.mmoInventory,
        });
      } finally {
        bankLocks.delete(key);
      }
    });

    // --- bank_withdraw_resource ---
    socket.on('bank_withdraw_resource', function(data) {
      if (!checkEventRate(socket, 'bank_op', 10, 2000)) return;
      if (!data || typeof data.resource !== 'string' || typeof data.amount !== 'number') return;
      if (!_isNearBanker(state, socket.id)) {
        socket.emit('bank_error', { message: 'You must be near a banker' });
        return;
      }
      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      if (bankLocks.has(key)) { socket.emit('bank_error', { message: 'Transaction in progress' }); return; }
      bankLocks.add(key);
      try {
        var acc = accounts.loadAccount(key);
        if (!acc) return;
        _ensureVault(acc);
        var amount = Math.floor(data.amount);
        if (amount < 1) { socket.emit('bank_error', { message: 'Invalid amount' }); return; }
        var banked = acc.bankVault.resources[data.resource] || 0;
        if (banked < amount) { socket.emit('bank_error', { message: 'Not enough in bank' }); return; }
        // Weight check before withdrawing to inventory
        var perUnit = accounts.ITEM_WEIGHTS[data.resource] || accounts.ITEM_WEIGHTS.default;
        if (!accounts.canCarryWeight(acc, perUnit * amount)) {
          socket.emit('bank_error', { message: 'Too heavy to carry' });
          return;
        }
        acc.bankVault.resources[data.resource] = banked - amount;
        if (acc.bankVault.resources[data.resource] <= 0) delete acc.bankVault.resources[data.resource];
        if (!acc.mmoInventory) acc.mmoInventory = { wood: 0, stone: 0, iron_ore: 0, iron_bar: 0, items: [] };
        acc.mmoInventory[data.resource] = (acc.mmoInventory[data.resource] || 0) + amount;
        accounts.saveAccount(acc);
        socket.emit('bank_result', {
          success: true, action: 'withdraw_resource',
          bank: _bankContentsPayload(acc.bankVault),
          inventory: acc.mmoInventory,
        });
      } finally {
        bankLocks.delete(key);
      }
    });

    // --- bank_deposit_item ---
    socket.on('bank_deposit_item', function(data) {
      if (!checkEventRate(socket, 'bank_op', 10, 2000)) return;
      if (!data || typeof data.itemId !== 'string') return;
      if (!_isNearBanker(state, socket.id)) {
        socket.emit('bank_error', { message: 'You must be near a banker' });
        return;
      }
      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      if (bankLocks.has(key)) { socket.emit('bank_error', { message: 'Transaction in progress' }); return; }
      bankLocks.add(key);
      try {
        var acc = accounts.loadAccount(key);
        if (!acc) return;
        _ensureVault(acc);
        if (acc.bankVault.items.length >= acc.bankVault.maxSlots) {
          socket.emit('bank_error', { message: 'Bank vault is full' });
          return;
        }
        var removed = accounts.removeMMOItem(key, data.itemId);
        if (!removed) { socket.emit('bank_error', { message: 'Item not found in inventory' }); return; }
        // Reload after removeMMOItem (it does its own save)
        acc = accounts.loadAccount(key);
        _ensureVault(acc);
        acc.bankVault.items.push(removed);
        accounts.saveAccount(acc);
        socket.emit('bank_result', {
          success: true, action: 'deposit_item',
          bank: _bankContentsPayload(acc.bankVault),
          inventory: acc.mmoInventory,
        });
      } finally {
        bankLocks.delete(key);
      }
    });

    // --- bank_withdraw_item ---
    socket.on('bank_withdraw_item', function(data) {
      if (!checkEventRate(socket, 'bank_op', 10, 2000)) return;
      if (!data || typeof data.itemIndex !== 'number') return;
      if (!_isNearBanker(state, socket.id)) {
        socket.emit('bank_error', { message: 'You must be near a banker' });
        return;
      }
      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      if (bankLocks.has(key)) { socket.emit('bank_error', { message: 'Transaction in progress' }); return; }
      bankLocks.add(key);
      try {
        var acc = accounts.loadAccount(key);
        if (!acc) return;
        _ensureVault(acc);
        var idx = Math.floor(data.itemIndex);
        if (idx < 0 || idx >= acc.bankVault.items.length) {
          socket.emit('bank_error', { message: 'Invalid item index' });
          return;
        }
        var item = acc.bankVault.items[idx];
        // Use addMMOItem — handles weight, grid placement, and capacity
        var addResult = accounts.addMMOItem(key, item);
        if (addResult && addResult.error) {
          socket.emit('bank_error', { message: addResult.error });
          return;
        }
        // Reload after addMMOItem (it does its own save)
        acc = accounts.loadAccount(key);
        _ensureVault(acc);
        acc.bankVault.items.splice(idx, 1);
        accounts.saveAccount(acc);
        socket.emit('bank_result', {
          success: true, action: 'withdraw_item',
          bank: _bankContentsPayload(acc.bankVault),
          inventory: acc.mmoInventory,
        });
      } finally {
        bankLocks.delete(key);
      }
    });

    // --- bank_buy_slots ---
    socket.on('bank_buy_slots', function() {
      if (!checkEventRate(socket, 'bank_op', 5, 2000)) return;
      if (!_isNearBanker(state, socket.id)) {
        socket.emit('bank_error', { message: 'You must be near a banker' });
        return;
      }
      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      if (bankLocks.has(key)) { socket.emit('bank_error', { message: 'Transaction in progress' }); return; }
      bankLocks.add(key);
      try {
        var acc = accounts.loadAccount(key);
        if (!acc) return;
        _ensureVault(acc);
        if (acc.bankVault.expansionsPurchased >= MAX_EXPANSIONS) {
          socket.emit('bank_error', { message: 'Maximum vault size reached' });
          return;
        }
        var cost = _getNextExpansionCost(acc.bankVault);
        if (acc.chips < cost) {
          socket.emit('bank_error', { message: 'Not enough gold (need ' + cost + ')' });
          return;
        }
        acc.chips -= cost;
        acc.bankVault.expansionsPurchased += 1;
        acc.bankVault.maxSlots = BASE_SLOTS + (acc.bankVault.expansionsPurchased * SLOTS_PER_EXPANSION);
        accounts.saveAccount(acc);
        socket.emit('bank_result', {
          success: true, action: 'buy_slots',
          bank: _bankContentsPayload(acc.bankVault),
          chips: acc.chips,
          message: 'Vault expanded to ' + acc.bankVault.maxSlots + ' slots',
        });
      } finally {
        bankLocks.delete(key);
      }
    });
  },
};
