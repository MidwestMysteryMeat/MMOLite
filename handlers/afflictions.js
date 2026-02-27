// handlers/afflictions.js
// Cure events for lycanthropy and vampire exposure.
// Events: cure_lycanthropy, cure_vampire_exposure, affliction_status

'use strict';

var WOLFSBANE_CURE_COST = 200;  // coins to cure lycanthropy
var HOLY_WATER_CURE_COST = 150; // coins to cure vampire exposure

function init(io, socket, deps) {
  var accounts = deps.accounts;
  var socketAccountMap = deps.socketAccountMap;
  var werewolfDirector = deps.directorWerewolf;
  var vampireDirector = deps.directorVampire;

  // ── cure_lycanthropy ──
  socket.on('cure_lycanthropy', function() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return;

    // Check affliction (memory first, then account for reconnect recovery)
    var lycanStatus = werewolfDirector ? werewolfDirector.getLycanthropyStatus(key) : null;
    if (!lycanStatus) {
      var checkAcc = accounts.loadAccount(key);
      if (!checkAcc || !checkAcc.lycanthropy) {
        socket.emit('cure_error', { message: 'You are not afflicted with lycanthropy.' });
        return;
      }
    }

    // Cost check
    var acc = accounts.loadAccount(key);
    if (!acc) return;
    if ((acc.chips || 0) < WOLFSBANE_CURE_COST) {
      socket.emit('cure_error', {
        message: 'Curing lycanthropy requires ' + WOLFSBANE_CURE_COST + ' coins (wolfsbane treatment).',
      });
      return;
    }

    var newChips = accounts.updateChips(key, -WOLFSBANE_CURE_COST);
    if (newChips === null) {
      socket.emit('cure_error', { message: 'Payment failed.' });
      return;
    }

    if (werewolfDirector && typeof werewolfDirector.cureLycanthropy === 'function') {
      werewolfDirector.cureLycanthropy(key, accounts);
    } else {
      // Fallback: clear directly from account
      var cureAcc = accounts.loadAccount(key);
      if (cureAcc && cureAcc.lycanthropy) {
        delete cureAcc.lycanthropy;
        accounts.saveAccount(cureAcc);
      }
    }

    socket.emit('cure_success', {
      type: 'lycanthropy',
      message: 'The wolfsbane treatment burns through the infection. The feral hunger fades.',
      coinsSpent: WOLFSBANE_CURE_COST,
      coinsRemaining: newChips,
    });
  });

  // ── cure_vampire_exposure ──
  socket.on('cure_vampire_exposure', function() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return;

    var acc2 = accounts.loadAccount(key);
    if (!acc2 || !acc2.vampireExposed) {
      socket.emit('cure_error', { message: 'You have not been bitten by a vampire.' });
      return;
    }

    if ((acc2.chips || 0) < HOLY_WATER_CURE_COST) {
      socket.emit('cure_error', {
        message: 'Curing vampire exposure requires ' + HOLY_WATER_CURE_COST + ' coins (holy water treatment).',
      });
      return;
    }

    var newChips2 = accounts.updateChips(key, -HOLY_WATER_CURE_COST);
    if (newChips2 === null) {
      socket.emit('cure_error', { message: 'Payment failed.' });
      return;
    }

    var cured = false;
    if (vampireDirector && typeof vampireDirector.cureVampireExposure === 'function') {
      cured = vampireDirector.cureVampireExposure(key, accounts);
    } else {
      // Fallback: clear directly
      var vAcc = accounts.loadAccount(key);
      if (vAcc && vAcc.vampireExposed) {
        delete vAcc.vampireExposed;
        accounts.saveAccount(vAcc);
        cured = true;
      }
    }

    if (!cured) {
      // Refund — something went wrong
      accounts.updateChips(key, HOLY_WATER_CURE_COST);
      socket.emit('cure_error', { message: 'Treatment failed. Coins refunded.' });
      return;
    }

    socket.emit('cure_success', {
      type: 'vampire_exposure',
      message: 'The holy water purges the vampire corruption from your blood.',
      coinsSpent: HOLY_WATER_CURE_COST,
      coinsRemaining: newChips2,
    });
  });

  // ── affliction_status ── (query current afflictions)
  socket.on('affliction_status', function() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return;

    var acc3 = accounts.loadAccount(key);
    if (!acc3) return;

    var lycan = werewolfDirector ? werewolfDirector.getLycanthropyStatus(key) : null;
    if (!lycan && acc3.lycanthropy) lycan = acc3.lycanthropy;

    socket.emit('affliction_status', {
      lycanthropy: lycan || null,
      vampireExposed: acc3.vampireExposed || null,
    });
  });
}

module.exports = { init: init };
