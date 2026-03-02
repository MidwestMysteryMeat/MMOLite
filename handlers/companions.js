// handlers/companions.js
// NPC Companion Hireling system -- hire NPC companions that aid in combat.
// Events: companion_hire, companion_list, companion_dismiss, companion_status

var crypto = require('crypto');

var COMPANION_CLASSES = {
  soldier:    { name: 'Soldier',     dailyWage: 50,  baseDmg: 15, baseHp: 100, abilityTag: 'melee'   },
  archer:     { name: 'Archer',      dailyWage: 60,  baseDmg: 12, baseHp: 80,  abilityTag: 'ranged'  },
  battle_mage:{ name: 'Battle Mage', dailyWage: 80,  baseDmg: 20, baseHp: 70,  abilityTag: 'magic'   },
  healer:     { name: 'Healer',      dailyWage: 90,  baseDmg: 5,  baseHp: 75,  abilityTag: 'heal'    },
  thief:      { name: 'Thief',       dailyWage: 70,  baseDmg: 18, baseHp: 65,  abilityTag: 'stealth' },
  berserker:  { name: 'Berserker',   dailyWage: 65,  baseDmg: 25, baseHp: 90,  abilityTag: 'berserk' },
};

var MAX_COMPANIONS = 2;

function getCompanionDamage(companion) {
  var cls = COMPANION_CLASSES[companion.class];
  if (!cls || companion.hp <= 0) return 0;
  return cls.baseDmg;
}

function getTotalCompanionDamage(account) {
  var total = 0;
  var companions = account.companions || [];
  for (var i = 0; i < companions.length; i++) {
    total += getCompanionDamage(companions[i]);
  }
  return total;
}

// Deduct daily wages for all companions on an account. Dismiss if insufficient funds.
function deductCompanionWages(account) {
  if (!account.companions || account.companions.length === 0) return;
  var now = Date.now();
  var DAY_MS = 24 * 60 * 60 * 1000;
  var toRemove = [];
  for (var i = 0; i < account.companions.length; i++) {
    var c = account.companions[i];
    var cls = COMPANION_CLASSES[c.class];
    if (!cls) continue;
    // Check if a day has passed since last payment
    var lastPaid = c.last_paid || c.hired_at || now;
    if (now - lastPaid >= DAY_MS) {
      if ((account.chips || 0) >= cls.dailyWage) {
        account.chips -= cls.dailyWage;
        c.last_paid = now;
      } else {
        // Cannot afford -- dismiss companion
        toRemove.push(i);
      }
    }
  }
  // Remove dismissed companions (iterate in reverse to preserve indices)
  for (var r = toRemove.length - 1; r >= 0; r--) {
    account.companions.splice(toRemove[r], 1);
  }
}

function init(io, socket, deps) {
  var accounts = deps.accounts;
  var socketAccountMap = deps.socketAccountMap;
  var vipPerks = deps.vipPerks;
  var getCachedVipStatus = deps.getCachedVipStatus;

  socket.on('companion_hire', function(data) {
    if (!data || typeof data.companionClass !== 'string') return;
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;

    var companions = account.companions || [];
    var _compVip = getCachedVipStatus ? getCachedVipStatus(key) : null;
    var _maxComp = vipPerks ? vipPerks.getMaxCompanions(_compVip) : MAX_COMPANIONS;
    if (companions.length >= _maxComp) {
      socket.emit('companion_error', { message: 'You can only have ' + _maxComp + ' companions.' });
      return;
    }

    var cls = COMPANION_CLASSES[data.companionClass];
    if (!cls) {
      socket.emit('companion_error', { message: 'Unknown companion class.' });
      return;
    }

    // Hiring fee = 3x daily wage upfront
    var hiringFee = cls.dailyWage * 3;
    if ((account.chips || 0) < hiringFee) {
      socket.emit('companion_error', { message: 'Not enough coins. Hiring costs ' + hiringFee + ' coins.' });
      return;
    }

    var newChips = accounts.updateChips(key, -hiringFee);
    if (newChips === null) {
      socket.emit('companion_error', { message: 'Failed to process payment.' });
      return;
    }
    account.chips = newChips;
    var companion = {
      id: crypto.randomBytes(6).toString('hex'),
      class: data.companionClass,
      name: cls.name,
      level: 1,
      hp: cls.baseHp,
      maxHp: cls.baseHp,
      hired_at: Date.now(),
      last_paid: Date.now(),
    };
    if (!account.companions) account.companions = [];
    account.companions.push(companion);
    accounts.saveAccount(account);
    socket.emit('companion_hired', { companion: companion, coins: account.chips });
  });

  socket.on('companion_list', function() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;
    var companions = (account.companions || []).map(function(c) {
      var cls = COMPANION_CLASSES[c.class];
      return {
        id: c.id,
        class: c.class,
        name: c.name,
        level: c.level,
        hp: c.hp,
        maxHp: c.maxHp,
        dailyWage: cls ? cls.dailyWage : 0,
        baseDmg: cls ? cls.baseDmg : 0,
      };
    });
    socket.emit('companion_list', { companions: companions });
  });

  socket.on('companion_dismiss', function(data) {
    if (!data || typeof data.companionId !== 'string') return;
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;
    var companions = account.companions || [];
    var idx = -1;
    for (var i = 0; i < companions.length; i++) {
      if (companions[i].id === data.companionId) { idx = i; break; }
    }
    if (idx === -1) {
      socket.emit('companion_error', { message: 'Companion not found.' });
      return;
    }
    companions.splice(idx, 1);
    account.companions = companions;
    accounts.saveAccount(account);
    socket.emit('companion_dismissed', { companionId: data.companionId });
  });

  socket.on('companion_status', function(data) {
    if (!data || typeof data.companionId !== 'string') return;
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;
    var companion = (account.companions || []).find(function(c) { return c.id === data.companionId; });
    if (!companion) {
      socket.emit('companion_error', { message: 'Companion not found.' });
      return;
    }
    var cls = COMPANION_CLASSES[companion.class];
    socket.emit('companion_status', {
      id: companion.id,
      class: companion.class,
      name: companion.name,
      level: companion.level,
      hp: companion.hp,
      maxHp: companion.maxHp,
      dailyWage: cls ? cls.dailyWage : 0,
      baseDmg: cls ? cls.baseDmg : 0,
    });
  });
}

module.exports = {
  init: init,
  COMPANION_CLASSES: COMPANION_CLASSES,
  MAX_COMPANIONS: MAX_COMPANIONS,
  getCompanionDamage: getCompanionDamage,
  getTotalCompanionDamage: getTotalCompanionDamage,
  deductCompanionWages: deductCompanionWages,
  applySeasonalOverrides: function(overrides) {
    if (overrides.COMPANION_CLASSES) {
      COMPANION_CLASSES = overrides.COMPANION_CLASSES;
      module.exports.COMPANION_CLASSES = COMPANION_CLASSES;
    }
  },
};
