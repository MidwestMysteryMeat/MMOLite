// shard-bridge.js
// Bridge between a game shard and the master server.
// Handles: shard registration (heartbeat), character checkout/checkin,
// periodic character saves, and plot conflict resolution on transfer.
//
// When masterServerUrl is configured, the shard communicates with the master
// for all account operations. When not configured, runs standalone (local accounts).

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const accounts = require('./accounts');

// ---------------------------------------------------------------------------
// Configuration — loaded from shard-config.json
// ---------------------------------------------------------------------------

var config = {
  shardId: 'standalone-' + crypto.randomBytes(4).toString('hex'),
  shardName: 'Local Server',
  shardDescription: '',
  host: '',
  port: 3001,
  maxPlayers: 50,
  masterServerUrl: null,
  masterServerSecret: '',
  official: false,
  public: true,
  rules: {},
  version: '1.0.0',
};

var CONFIG_PATH = process.env.MMOLITE_CONFIG || path.join(__dirname, 'shard-config.json');
try {
  if (fs.existsSync(CONFIG_PATH)) {
    var loaded = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    Object.assign(config, loaded);
    console.log('[shard-bridge] Loaded config from ' + CONFIG_PATH + ': ' + config.shardName + ' (id=' + config.shardId + ')');
  }
} catch (err) {
  console.error('[shard-bridge] Failed to load config:', err.message);
}

var isMasterMode = !!config.masterServerUrl;
var heartbeatInterval = null;

// Track checked-out characters on this shard: Map<accountKey, true>
var checkedOutKeys = new Map();

// PLOT_SIZE and PLOT_GRID must match handlers/plot.js
var PLOT_SIZE = 512;
var PLOT_GRID = 512;

// ---------------------------------------------------------------------------
// HTTP helper — make requests to master server
// ---------------------------------------------------------------------------

function masterRequest(method, apiPath, body, callback) {
  if (!isMasterMode) {
    return callback(new Error('No master server configured'));
  }

  var url;
  try {
    url = new URL(apiPath, config.masterServerUrl);
  } catch (e) {
    return callback(new Error('Invalid master URL: ' + e.message));
  }

  var postData = body ? JSON.stringify(body) : '';
  var isHttps = url.protocol === 'https:';
  var lib = isHttps ? https : http;

  var options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'X-Shard-Secret': config.masterServerSecret,
    },
    timeout: 10000,
  };

  var req = lib.request(options, function (res) {
    var chunks = [];
    res.on('data', function (chunk) { chunks.push(chunk); });
    res.on('end', function () {
      try {
        var data = JSON.parse(Buffer.concat(chunks).toString());
        callback(null, data, res.statusCode);
      } catch (e) {
        callback(new Error('Invalid JSON from master: ' + e.message));
      }
    });
  });

  req.on('error', function (err) {
    callback(err);
  });

  req.on('timeout', function () {
    req.destroy();
    callback(new Error('Master server request timed out'));
  });

  if (postData) req.write(postData);
  req.end();
}

// ---------------------------------------------------------------------------
// Shard Registration (Heartbeat)
// ---------------------------------------------------------------------------

function startHeartbeat(getPlayerCount) {
  if (!isMasterMode) {
    console.log('[shard-bridge] No master server — running standalone');
    return;
  }

  function beat() {
    var body = {
      shardId: config.shardId,
      name: config.shardName,
      description: config.shardDescription,
      host: config.host || '',
      port: config.port,
      maxPlayers: config.maxPlayers,
      currentPlayers: getPlayerCount ? getPlayerCount() : 0,
      rules: config.rules,
      version: config.version,
      official: config.official,
    };

    masterRequest('POST', '/api/shards/heartbeat', body, function (err, data) {
      if (err) {
        console.error('[shard-bridge] Heartbeat failed:', err.message);
      }
    });
  }

  // Initial heartbeat
  beat();
  // Repeat every 30s
  heartbeatInterval = setInterval(beat, 30000);
  heartbeatInterval.unref();
  console.log('[shard-bridge] Heartbeat started -> ' + config.masterServerUrl);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (saveInterval) {
    clearInterval(saveInterval);
    saveInterval = null;
  }
  if (isMasterMode) {
    // Deregister on shutdown
    masterRequest('POST', '/api/shards/deregister', { shardId: config.shardId }, function () {});
  }
}

// ---------------------------------------------------------------------------
// Character Checkout — called when a player connects to this shard
// ---------------------------------------------------------------------------

function checkoutCharacter(accountKey, pin, callback) {
  if (!isMasterMode) {
    // Standalone mode — use local accounts
    var acc = accounts.loadAccount(accountKey);
    return callback(null, acc);
  }

  // First authenticate
  masterRequest('POST', '/api/accounts/authenticate', {
    accountKey: accountKey,
    pin: pin,
  }, function (err, data) {
    if (err) return callback(err);
    if (!data.success) return callback(new Error(data.error || 'Auth failed'));

    // Now checkout
    masterRequest('POST', '/api/characters/checkout', {
      accountKey: accountKey,
      shardId: config.shardId,
    }, function (err2, data2) {
      if (err2) return callback(err2);
      if (!data2.success) return callback(new Error(data2.error || 'Checkout failed'));

      var acc = data2.account;
      // Write to local accounts storage so accounts.js can load it
      acc.key = accountKey;
      accounts.importAccount(acc);
      checkedOutKeys.set(accountKey, true);

      callback(null, acc);
    });
  });
}

// ---------------------------------------------------------------------------
// Character Checkin — called when a player disconnects from this shard
// ---------------------------------------------------------------------------

function checkinCharacter(accountKey, callback) {
  callback = callback || function () {};

  if (!isMasterMode) {
    return callback(null);
  }

  if (!checkedOutKeys.has(accountKey)) {
    return callback(null);
  }

  // Load the current local state
  var acc = accounts.loadAccount(accountKey);
  if (!acc) {
    checkedOutKeys.delete(accountKey);
    return callback(null);
  }

  // Send back to master
  var safeAcc = Object.assign({}, acc);
  delete safeAcc.pinHash;

  masterRequest('POST', '/api/characters/checkin', {
    accountKey: accountKey,
    shardId: config.shardId,
    account: safeAcc,
  }, function (err, data) {
    if (err) {
      console.error('[shard-bridge] Checkin failed for ' + accountKey.substring(0, 6) + '...:', err.message);
    }
    checkedOutKeys.delete(accountKey);
    callback(err);
  });
}

// ---------------------------------------------------------------------------
// Periodic Save — save all checked-out characters to master without releasing
// ---------------------------------------------------------------------------

function saveAllCharacters() {
  if (!isMasterMode) return;

  for (var key of checkedOutKeys.keys()) {
    var acc = accounts.loadAccount(key);
    if (!acc) continue;

    var safeAcc = Object.assign({}, acc);
    delete safeAcc.pinHash;

    masterRequest('POST', '/api/characters/save', {
      accountKey: key,
      shardId: config.shardId,
      account: safeAcc,
    }, function (err) {
      if (err) {
        console.error('[shard-bridge] Periodic save failed:', err.message);
      }
    });
  }
}

// Save every 2 minutes
var saveInterval = null;
if (isMasterMode) {
  saveInterval = setInterval(saveAllCharacters, 2 * 60 * 1000);
  saveInterval.unref();
}

// ---------------------------------------------------------------------------
// Create Account via Master
// ---------------------------------------------------------------------------

function createAccountViaMaster(username, color, callback) {
  if (!isMasterMode) {
    var acc = accounts.createAccount(username, color);
    return callback(null, acc);
  }

  masterRequest('POST', '/api/accounts/create', {
    username: username,
    color: color,
  }, function (err, data) {
    if (err) return callback(err);
    if (!data.success) return callback(new Error(data.error || 'Create failed'));

    // Import to local cache
    var acc = data.account;
    accounts.importAccount(acc);
    checkedOutKeys.set(acc.key, true);

    // Also checkout immediately
    masterRequest('POST', '/api/characters/checkout', {
      accountKey: acc.key,
      shardId: config.shardId,
    }, function () {
      // Ignore errors — account is already imported locally
    });

    callback(null, acc);
  });
}

// ---------------------------------------------------------------------------
// Set PIN via Master
// ---------------------------------------------------------------------------

function setPinViaMaster(accountKey, pin, callback) {
  if (!isMasterMode) {
    accounts.setPinForAccount(accountKey, pin).then(function (result) {
      callback(null, result);
    }).catch(function (err) {
      callback(err);
    });
    return;
  }

  masterRequest('POST', '/api/accounts/set-pin', {
    accountKey: accountKey,
    pin: pin,
  }, function (err, data) {
    if (err) return callback(err);
    callback(null, data.success);
  });
}

// ---------------------------------------------------------------------------
// Plot Conflict Resolution
// When a character transfers to a shard where their plot position is taken,
// spiral-search outward for the nearest free adjacent plot.
// ---------------------------------------------------------------------------

function resolvePlotConflict(account, zonePlots) {
  if (!account || !account.plotId) return account;
  if (!zonePlots || zonePlots.length === 0) return account;

  // Find the account's plot data
  var myPlot = null;
  for (var i = 0; i < zonePlots.length; i++) {
    if (zonePlots[i].id === account.plotId) {
      myPlot = zonePlots[i];
      break;
    }
  }

  if (!myPlot) return account; // plot doesn't exist on this shard — nothing to resolve

  // Check if the position is already taken by another player
  var positionTaken = false;
  for (var j = 0; j < zonePlots.length; j++) {
    var plot = zonePlots[j];
    if (plot.id === myPlot.id) continue;
    if (plot.x === myPlot.x && plot.y === myPlot.y && plot.ownerKey && plot.ownerKey !== account.key) {
      positionTaken = true;
      break;
    }
  }

  if (!positionTaken) return account; // no conflict

  // Spiral search for nearest free adjacent plot position
  console.log('[shard-bridge] Plot conflict for ' + account.key.substring(0, 6) + '... at ' + myPlot.x + ',' + myPlot.y + ' — searching adjacent');

  var newPos = findFreeAdjacentPlot(myPlot.x, myPlot.y, zonePlots);
  if (newPos) {
    myPlot.x = newPos.x;
    myPlot.y = newPos.y;
    console.log('[shard-bridge] Relocated plot to ' + newPos.x + ',' + newPos.y);
  } else {
    // No free plot found within search radius — remove plot claim
    console.log('[shard-bridge] No free adjacent plot found — removing plot claim');
    account.plotId = null;
  }

  return account;
}

function findFreeAdjacentPlot(originX, originY, zonePlots) {
  // Spiral search outward from origin
  var maxRadius = 20; // search up to 20 plots away

  for (var radius = 1; radius <= maxRadius; radius++) {
    // Check all positions at this radius in a square spiral
    for (var dx = -radius; dx <= radius; dx++) {
      for (var dy = -radius; dy <= radius; dy++) {
        // Only check positions on the edge of this radius
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

        var testX = originX + dx * PLOT_GRID;
        var testY = originY + dy * PLOT_GRID;

        // Skip negative positions
        if (testX < 0 || testY < 0) continue;

        // Check if this position is free
        var occupied = false;
        for (var i = 0; i < zonePlots.length; i++) {
          if (zonePlots[i].x === testX && zonePlots[i].y === testY && zonePlots[i].ownerKey) {
            occupied = true;
            break;
          }
        }

        if (!occupied) {
          return { x: testX, y: testY };
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  config: config,
  isMasterMode: isMasterMode,
  masterRequest: masterRequest,
  startHeartbeat: startHeartbeat,
  stopHeartbeat: stopHeartbeat,
  checkoutCharacter: checkoutCharacter,
  checkinCharacter: checkinCharacter,
  createAccountViaMaster: createAccountViaMaster,
  setPinViaMaster: setPinViaMaster,
  saveAllCharacters: saveAllCharacters,
  resolvePlotConflict: resolvePlotConflict,
  checkedOutKeys: checkedOutKeys,
};
