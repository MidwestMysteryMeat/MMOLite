// handlers/ascension.js
// Ascension/Prestige system -- reset character progression for permanent bonuses.
// Events: ascension_status, ascension_confirm, ascension_spend_ap

var rpgData = require('../rpg-data');

var ASCENSION_TREE = {
  iron_resolve: {
    name: 'Iron Resolve',
    desc: '+5% max HP per rank',
    apCost: 1,
    maxRank: 5,
    effect: { type: 'stat_pct', stat: 'vigor', value: 0.05 },
  },
  deep_knowledge: {
    name: 'Deep Knowledge',
    desc: '+5% XP gain per rank',
    apCost: 1,
    maxRank: 5,
    effect: { type: 'xp_pct', value: 0.05 },
  },
  seasoned_traveler: {
    name: 'Seasoned Traveler',
    desc: '+3% move speed per rank',
    apCost: 1,
    maxRank: 5,
    effect: { type: 'speed_pct', value: 0.03 },
  },
  hoarders_instinct: {
    name: "Hoarder's Instinct",
    desc: '+20 carry capacity per rank',
    apCost: 1,
    maxRank: 3,
    effect: { type: 'carry_flat', value: 20 },
  },
  artisan_legacy: {
    name: 'Artisan Legacy',
    desc: '+10% crafting quality window per rank',
    apCost: 2,
    maxRank: 3,
    effect: { type: 'crafting_window_pct', value: 0.10 },
  },
  lucky_star: {
    name: 'Lucky Star',
    desc: '+1% card rarity bump per rank',
    apCost: 2,
    maxRank: 3,
    effect: { type: 'card_luck_pct', value: 0.01 },
  },
  rift_veteran: {
    name: 'Rift Veteran',
    desc: '+5 floor starting bonus in Rift',
    apCost: 3,
    maxRank: 2,
    effect: { type: 'rift_start_floor', value: 5 },
  },
  eternal_mark: {
    name: 'Eternal Mark',
    desc: 'Cosmetic: Ascension glow on character portrait',
    apCost: 1,
    maxRank: 1,
    effect: { type: 'cosmetic', id: 'ascension_glow' },
  },
};

// AP awarded per ascension: base 10, +5 per subsequent ascension
function getApReward(ascensionCount) {
  return 10 + (ascensionCount * 5);
}

// Check if player can ascend (must be level 100)
function canAscend(account) {
  return account.level >= 100;
}

// Perform ascension
function doAscend(account) {
  if (!canAscend(account)) return { ok: false, error: 'Must be level 100 to ascend.' };
  var currentCount = account.ascensionCount || 0;
  var ap = getApReward(currentCount);
  // Preserve across reset (don't clear):
  var prevAp = account.ascensionPoints || 0;
  var prevTree = account.ascensionTree || {};
  // Reset character progression
  account.level = 1;
  account.xp = 0;
  account.skills = rpgData.getDefaultSkills();
  account.rpgStats = rpgData.getDefaultStats();
  account.pendingPacks = 0;
  // Reset mastery points (skills reset to 1), preserve invested nodes
  account.skillMasteryPoints = {};
  // Set ascension fields (persist)
  account.ascensionCount = currentCount + 1;
  account.ascensionPoints = prevAp + ap;
  account.ascensionTree = prevTree;
  account.ascensionMark = true;
  return { ok: true, apGained: ap, totalAp: account.ascensionPoints, ascensionCount: account.ascensionCount };
}

function init(io, socket, deps) {
  var accounts = deps.accounts;
  var socketAccountMap = deps.socketAccountMap;

  socket.on('ascension_status', function() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;
    socket.emit('ascension_status', {
      canAscend: canAscend(account),
      ascensionCount: account.ascensionCount || 0,
      ascensionPoints: account.ascensionPoints || 0,
      ascensionTree: account.ascensionTree || {},
      ascensionMark: account.ascensionMark || false,
      tree: ASCENSION_TREE,
    });
  });

  socket.on('ascension_confirm', function() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) {
      socket.emit('ascension_result', { ok: false, error: 'Load failed.' });
      return;
    }
    var result = doAscend(account);
    if (result.ok) {
      accounts.saveAccount(account);
      socket.emit('ascension_result', result);
    } else {
      socket.emit('ascension_result', result);
    }
  });

  socket.on('ascension_spend_ap', function(data) {
    if (!data || typeof data.nodeId !== 'string') return;
    var nodeId = data.nodeId;
    var node = ASCENSION_TREE[nodeId];
    if (!node) {
      socket.emit('ascension_ap_result', { ok: false, error: 'Unknown node.' });
      return;
    }
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;
    if (!account.ascensionTree) account.ascensionTree = {};
    if (!account.ascensionPoints) account.ascensionPoints = 0;
    var currentRank = account.ascensionTree[nodeId] || 0;
    if (currentRank >= node.maxRank) {
      socket.emit('ascension_ap_result', { ok: false, error: 'Max rank reached.' });
      return;
    }
    if (account.ascensionPoints < node.apCost) {
      socket.emit('ascension_ap_result', { ok: false, error: 'Insufficient AP.' });
      return;
    }
    account.ascensionPoints -= node.apCost;
    account.ascensionTree[nodeId] = currentRank + 1;
    accounts.saveAccount(account);
    socket.emit('ascension_ap_result', {
      ok: true,
      nodeId: nodeId,
      rank: account.ascensionTree[nodeId],
      apLeft: account.ascensionPoints,
    });
  });
}

module.exports = {
  init: init,
  canAscend: canAscend,
  doAscend: doAscend,
  ASCENSION_TREE: ASCENSION_TREE,
  getApReward: getApReward,
  applySeasonalOverrides: function(overrides) {
    if (overrides.ASCENSION_TREE) {
      ASCENSION_TREE = overrides.ASCENSION_TREE;
      module.exports.ASCENSION_TREE = ASCENSION_TREE;
    }
  },
};
