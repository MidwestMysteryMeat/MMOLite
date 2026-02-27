// handlers/karma.js
// Karma/crime system - tracks player alignment, crimes, and bounties.
// Events: karma_status, bounty_list

var KARMA_DECAY_RATE = 0.01; // per hour, toward 0
var CRIME_KARMA_COSTS = {
  node_theft: -5,        // stealing from a resource node someone else is working
  player_theft: -15,     // stealing from a player via trade exploit
  trespassing: -2,       // entering private plot without permission
  assault: -20,          // attacking another player
  murder: -30,           // killing another player
  vandalism: -8,         // destroying someone's placed object
};

var GOOD_KARMA_GAINS = {
  quest_complete: 2,
  help_player: 3,
  donate_guild: 1,
  donate_town: 2,
};

var GUARD_HOSTILITY_THRESHOLD = -30; // below this, town guards refuse service
var BOUNTY_THRESHOLD = -20;          // below this, bounty can be placed

function addKarma(account, delta, reason) {
  if (!account) return;
  if (typeof account.karma !== 'number') account.karma = 0;
  account.karma = Math.max(-100, Math.min(100, account.karma + delta));
  if (!account.crimeHistory) account.crimeHistory = [];
  if (delta < 0) {
    account.crimeHistory.unshift({ type: reason, timestamp: Date.now(), delta: delta });
    if (account.crimeHistory.length > 10) account.crimeHistory.length = 10;
    // Auto-place bounty if karma drops below threshold
    if (account.karma <= BOUNTY_THRESHOLD && !account.activeBounty) {
      account.activeBounty = {
        amount: Math.abs(account.karma) * 10,
        reason: reason,
        issuedAt: Date.now(),
      };
    } else if (account.activeBounty) {
      // Update bounty amount
      account.activeBounty.amount = Math.abs(account.karma) * 10;
    }
  } else if (delta > 0 && account.activeBounty) {
    // Karma recovered -- clear bounty if karma back above threshold
    if (account.karma > BOUNTY_THRESHOLD) {
      account.activeBounty = null;
    }
  }
}

function isGuardHostile(account) {
  return typeof account.karma === 'number' && account.karma <= GUARD_HOSTILITY_THRESHOLD;
}

function init(io, socket, deps) {
  var accounts = deps.accounts;
  var socketAccountMap = deps.socketAccountMap;

  socket.on('karma_status', function() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;
    socket.emit('karma_status', {
      karma: account.karma || 0,
      activeBounty: account.activeBounty || null,
      isGuardHostile: isGuardHostile(account),
    });
  });

  socket.on('bounty_list', function() {
    // Return list of top bounties (from in-memory scan -- bounties are rare)
    var keys = Array.from(socketAccountMap.values());
    var bounties = [];
    var checked = 0;
    if (keys.length === 0) {
      socket.emit('bounty_list', { bounties: [] });
      return;
    }
    keys.forEach(function(k) {
      var acc = accounts.loadAccount(k);
      checked++;
      if (acc && acc.activeBounty) {
        bounties.push({
          username: acc.username,
          amount: acc.activeBounty.amount,
          reason: acc.activeBounty.reason,
        });
      }
      if (checked === keys.length) {
        bounties.sort(function(a, b) { return b.amount - a.amount; });
        socket.emit('bounty_list', { bounties: bounties.slice(0, 20) });
      }
    });
  });
}

module.exports = {
  init: init,
  addKarma: addKarma,
  isGuardHostile: isGuardHostile,
  CRIME_KARMA_COSTS: CRIME_KARMA_COSTS,
  GOOD_KARMA_GAINS: GOOD_KARMA_GAINS,
  GUARD_HOSTILITY_THRESHOLD: GUARD_HOSTILITY_THRESHOLD,
  BOUNTY_THRESHOLD: BOUNTY_THRESHOLD,
};
