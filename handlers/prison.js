// handlers/prison.js
// Jail and prison system for MMOLite.
// Handles player arrest, bail payment, and time-serving.
// Karma threshold for arrest: <= -50 (severe criminal).

'use strict';

// Crime types and their durations/bail costs
var CRIME_DEFINITIONS = {
  node_theft:    { durationMs: 5  * 60 * 1000, bail: 50,  label: 'Resource Theft'    },
  player_theft:  { durationMs: 15 * 60 * 1000, bail: 200, label: 'Player Theft'      },
  assault:       { durationMs: 10 * 60 * 1000, bail: 150, label: 'Assault'           },
  murder:        { durationMs: 30 * 60 * 1000, bail: 500, label: 'Murder'            },
  trespassing:   { durationMs: 3  * 60 * 1000, bail: 30,  label: 'Trespassing'       },
  contraband:    { durationMs: 8  * 60 * 1000, bail: 100, label: 'Carrying Contraband'},
};

var JAIL_ZONE_ID = 'town_jail';
var KARMA_ARREST_THRESHOLD = -50;  // karma at or below this = guards can arrest

// ---------------------------------------------------------------------------
// Core arrest/release functions (exported for use by other handlers)
// ---------------------------------------------------------------------------

function arrestPlayer(account, crime, jailZoneId) {
  var crimeDef = CRIME_DEFINITIONS[crime] || CRIME_DEFINITIONS['assault'];
  account.jailState = {
    inJail: true,
    crime: crime,
    crimeLabel: crimeDef.label,
    releasedAt: Date.now() + crimeDef.durationMs,
    bail: crimeDef.bail,
    jailZoneId: jailZoneId || JAIL_ZONE_ID,
    arrestedAt: Date.now(),
  };
  return account.jailState;
}

function isJailed(account) {
  if (!account || !account.jailState) return false;
  if (!account.jailState.inJail) return false;
  // Pure check — does not mutate account (callers handle persistence)
  return Date.now() < account.jailState.releasedAt;
}

function releasePlayer(account) {
  if (account && account.jailState) {
    account.jailState.inJail = false;
  }
}

function getRemainingTime(account) {
  if (!isJailed(account)) return 0;
  return Math.max(0, account.jailState.releasedAt - Date.now());
}

// ---------------------------------------------------------------------------
// Socket handler
// ---------------------------------------------------------------------------

function init(io, socket, deps) {
  var accounts = deps.accounts;
  var state = deps.state;
  var socketAccountMap = deps.socketAccountMap;

  // Get current jail status
  socket.on('jail_status', function() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;

    if (!isJailed(account)) {
      if (account.jailState && account.jailState.inJail) {
        account.jailState.inJail = false;
        accounts.saveAccount(account);
      }
      socket.emit('jail_status', { inJail: false });
      return;
    }

    socket.emit('jail_status', {
      inJail: true,
      crime: account.jailState.crime,
      crimeLabel: account.jailState.crimeLabel,
      remainingMs: getRemainingTime(account),
      bail: account.jailState.bail,
      jailZoneId: account.jailState.jailZoneId,
    });
  });

  // Pay bail to get out early
  socket.on('jail_bail', function() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;

    if (!isJailed(account)) {
      socket.emit('jail_bail', { ok: false, error: 'You are not in jail.' });
      return;
    }

    var bail = account.jailState.bail;
    if ((account.chips || 0) < bail) {
      socket.emit('jail_bail', { ok: false, error: 'You need ' + bail + ' coins to pay bail.' });
      return;
    }

    var newChips = accounts.updateChips(key, -bail);
    if (newChips !== null) account.chips = newChips;
    releasePlayer(account);
    accounts.saveAccount(account);

    socket.emit('jail_bail', { ok: true, coinsSpent: bail, message: 'Bail paid. You are free — for now.' });
    socket.emit('jail_status', { inJail: false });
  });

  // Serve time (voluntarily wait out sentence — client can poll this)
  socket.on('jail_serve_time', function() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;

    if (!isJailed(account)) {
      // Already released (time served naturally)
      socket.emit('jail_serve_time', { ok: true, released: true, message: 'You have served your time.' });
      socket.emit('jail_status', { inJail: false });
      accounts.saveAccount(account);
      return;
    }

    var remaining = getRemainingTime(account);
    socket.emit('jail_serve_time', {
      ok: true,
      released: false,
      remainingMs: remaining,
      message: 'Time remaining: ' + Math.ceil(remaining / 1000) + ' seconds.',
    });
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  init: init,
  arrestPlayer: arrestPlayer,
  isJailed: isJailed,
  releasePlayer: releasePlayer,
  getRemainingTime: getRemainingTime,
  CRIME_DEFINITIONS: CRIME_DEFINITIONS,
  KARMA_ARREST_THRESHOLD: KARMA_ARREST_THRESHOLD,
  JAIL_ZONE_ID: JAIL_ZONE_ID,
};
