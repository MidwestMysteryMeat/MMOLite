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

    var acc = accounts.loadAccount(key);
    if (!acc) return;

    // Check affliction (director memory first, then account for reconnect)
    var lycanStatus = werewolfDirector ? werewolfDirector.getLycanthropyStatus(key) : null;
    if (!lycanStatus && !acc.lycanthropy) {
      socket.emit('cure_error', { message: 'You are not afflicted with lycanthropy.' });
      return;
    }

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
      // Fallback: clear directly from the already-loaded account
      if (acc.lycanthropy) {
        delete acc.lycanthropy;
        accounts.saveAccount(acc);
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

    var acc = accounts.loadAccount(key);
    if (!acc || !acc.vampireExposed) {
      socket.emit('cure_error', { message: 'You have not been bitten by a vampire.' });
      return;
    }

    if ((acc.chips || 0) < HOLY_WATER_CURE_COST) {
      socket.emit('cure_error', {
        message: 'Curing vampire exposure requires ' + HOLY_WATER_CURE_COST + ' coins (holy water treatment).',
      });
      return;
    }

    var newChips = accounts.updateChips(key, -HOLY_WATER_CURE_COST);
    if (newChips === null) {
      socket.emit('cure_error', { message: 'Payment failed.' });
      return;
    }

    var cured = false;
    if (vampireDirector && typeof vampireDirector.cureVampireExposure === 'function') {
      cured = vampireDirector.cureVampireExposure(key, accounts);
    } else {
      // Fallback: clear directly from the already-loaded account
      if (acc.vampireExposed) {
        delete acc.vampireExposed;
        accounts.saveAccount(acc);
        cured = true;
      }
    }

    if (!cured) {
      accounts.updateChips(key, HOLY_WATER_CURE_COST);
      socket.emit('cure_error', { message: 'Treatment failed. Coins refunded.' });
      return;
    }

    socket.emit('cure_success', {
      type: 'vampire_exposure',
      message: 'The holy water purges the vampire corruption from your blood.',
      coinsSpent: HOLY_WATER_CURE_COST,
      coinsRemaining: newChips,
    });
  });

  // ── affliction_status ── (query current afflictions)
  socket.on('affliction_status', function() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return;

    var acc = accounts.loadAccount(key);
    if (!acc) return;

    var lycan = werewolfDirector ? werewolfDirector.getLycanthropyStatus(key) : null;
    if (!lycan && acc.lycanthropy) lycan = acc.lycanthropy;

    socket.emit('affliction_status', {
      lycanthropy: lycan || null,
      vampireExposed: acc.vampireExposed || null,
    });
  });
}

module.exports = { init: init };
