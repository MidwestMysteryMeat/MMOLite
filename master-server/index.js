// master-server/index.js
// MMOLite Master List Server
// Central authority for: shard registry, account storage, character transfers.
// Shards communicate with this server via HTTP to checkout/checkin characters.
// Clients fetch the shard list from this server.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');

// Load env vars from /etc/mmolite/app.env (same as server.js)
try {
  var _envFile = process.env.MMOLITE_ENV_FILE || '/etc/mmolite/app.env';
  if (fs.existsSync(_envFile)) {
    var _envLines = fs.readFileSync(_envFile, 'utf8').split('\n');
    for (var _ei = 0; _ei < _envLines.length; _ei++) {
      var _line = _envLines[_ei].trim();
      if (!_line || _line[0] === '#') continue;
      var _eq = _line.indexOf('=');
      if (_eq > 0) {
        var _k = _line.slice(0, _eq).trim();
        var _v = _line.slice(_eq + 1).trim();
        if (!process.env[_k]) process.env[_k] = _v;
      }
    }
  }
} catch (_envErr) {
  console.error('[master] Warning: Could not load env file:', _envErr.message);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = process.env.MASTER_PORT || 4000;
const SHARD_SECRET = process.env.SHARD_SECRET || 'mmolite-dev-secret';
const HEARTBEAT_TIMEOUT = 90000; // 90s — remove shards that stop heartbeating

// Warn (or refuse) if using default secret in production
if (SHARD_SECRET === 'mmolite-dev-secret') {
  if (process.env.NODE_ENV === 'production') {
    console.error('[master] FATAL: SHARD_SECRET is still the default dev secret. Set a strong SHARD_SECRET env var for production.');
    process.exit(1);
  } else {
    console.warn('[master] WARNING: Using default dev shard secret. Set SHARD_SECRET env var before deploying to production.');
  }
}

// Load parent accounts module (shared encryption, PIN hashing, etc.)
const accounts = require('../accounts');

// ---------------------------------------------------------------------------
// Shard Registry (in-memory, heartbeat-based)
// ---------------------------------------------------------------------------

// Map<shardId, shardInfo>
const shards = new Map();

// Map<accountKey, { shardId, checkedOutAt }> — track which shard has each character
const characterLocks = new Map();

// Prune stale shards every 30s
setInterval(function () {
  var now = Date.now();
  for (var entry of shards) {
    if (now - entry[1].lastSeen > HEARTBEAT_TIMEOUT) {
      console.log('[master] Shard timed out: ' + entry[0] + ' (' + entry[1].name + ')');
      // Release all character locks held by this shard
      for (var lock of characterLocks) {
        if (lock[1].shardId === entry[0]) {
          characterLocks.delete(lock[0]);
        }
      }
      shards.delete(entry[0]);
    }
  }
}, 30000).unref();

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '2mb' }));

// CORS — allow all (Love2D clients + shards)
app.use(function (req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shard-Secret');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------------------
// Auth middleware for shard-to-master calls
// ---------------------------------------------------------------------------

function requireShardAuth(req, res, next) {
  var secret = req.headers['x-shard-secret'];
  if (!secret || secret !== SHARD_SECRET) {
    return res.status(403).json({ success: false, error: 'Invalid shard secret' });
  }
  next();
}

// ---------------------------------------------------------------------------
// API: Shard Registry
// ---------------------------------------------------------------------------

// GET /api/shards — public, clients fetch this
app.get('/api/shards', function (req, res) {
  var list = [];
  for (var entry of shards) {
    var s = entry[1];
    list.push({
      shardId: s.shardId,
      name: s.name,
      description: s.description || '',
      host: s.host,
      port: s.port,
      maxPlayers: s.maxPlayers,
      currentPlayers: s.currentPlayers,
      rules: s.rules || {},
      version: s.version || '1.0.0',
      official: !!s.official,
    });
  }
  res.json({ shards: list });
});

// POST /api/shards/heartbeat — shards call this every 30s
app.post('/api/shards/heartbeat', requireShardAuth, function (req, res) {
  var b = req.body;
  if (!b || !b.shardId || !b.name || !b.port) {
    return res.status(400).json({ success: false, error: 'Missing required fields: shardId, name, port' });
  }

  // Determine the shard's public host from the request if not provided
  var host = b.host || req.ip || req.connection.remoteAddress || '127.0.0.1';
  // Strip IPv6 prefix
  if (host.startsWith('::ffff:')) host = host.slice(7);

  shards.set(b.shardId, {
    shardId: b.shardId,
    name: b.name,
    description: b.description || '',
    host: host,
    port: b.port,
    maxPlayers: b.maxPlayers || 50,
    currentPlayers: b.currentPlayers || 0,
    rules: b.rules || {},
    version: b.version || '1.0.0',
    official: !!b.official,
    lastSeen: Date.now(),
  });

  res.json({ success: true });
});

// POST /api/shards/deregister — shard shutting down cleanly
app.post('/api/shards/deregister', requireShardAuth, function (req, res) {
  var b = req.body;
  if (!b || !b.shardId) {
    return res.status(400).json({ success: false, error: 'Missing shardId' });
  }
  // Release all character locks for this shard
  for (var lock of characterLocks) {
    if (lock[1].shardId === b.shardId) {
      characterLocks.delete(lock[0]);
    }
  }
  shards.delete(b.shardId);
  console.log('[master] Shard deregistered: ' + b.shardId);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// API: Account Authentication
// ---------------------------------------------------------------------------

// POST /api/accounts/authenticate — shard verifies a player's credentials
app.post('/api/accounts/authenticate', requireShardAuth, async function (req, res) {
  try {
    var b = req.body;
    if (!b || !b.accountKey) {
      return res.status(400).json({ success: false, error: 'Missing accountKey' });
    }

    var key = b.accountKey;
    var pin = b.pin || null;

    // Validate key format
    if (key.length < 12 || !/^[a-zA-Z0-9]+$/.test(key)) {
      return res.status(400).json({ success: false, error: 'Invalid key format' });
    }

    var acc = accounts.loadAccount(key);
    if (!acc) {
      return res.json({ success: false, error: 'Account not found' });
    }

    // PIN verification for permanent accounts
    if (!acc.temp && acc.pinHash) {
      if (!pin) {
        return res.json({ success: false, error: 'PIN required', needsPin: true });
      }
      var pinValid = await accounts.verifyPin(pin, acc.pinHash);
      if (!pinValid) {
        return res.json({ success: false, error: 'Invalid PIN' });
      }
    }

    // Return safe account data (strip sensitive fields)
    var safeAccount = Object.assign({}, acc);
    safeAccount.hasPin = !!safeAccount.pinHash;
    delete safeAccount.pinHash; // don't send hash to shards

    res.json({ success: true, account: safeAccount });
  } catch (err) {
    console.error('[master] Auth error:', err.message);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// POST /api/accounts/create — shard creates a new account
app.post('/api/accounts/create', requireShardAuth, function (req, res) {
  try {
    var b = req.body;
    var username = (b && b.username) || null;
    var color = (b && b.color) || null;

    var acc = accounts.createAccount(username, color);
    if (!acc) {
      return res.status(500).json({ success: false, error: 'Failed to create account' });
    }

    res.json({ success: true, account: acc });
  } catch (err) {
    console.error('[master] Create account error:', err.message);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// POST /api/accounts/set-pin — shard sets PIN for an account
app.post('/api/accounts/set-pin', requireShardAuth, async function (req, res) {
  try {
    var b = req.body;
    if (!b || !b.accountKey || !b.pin) {
      return res.status(400).json({ success: false, error: 'Missing accountKey or pin' });
    }
    var result = await accounts.setPinForAccount(b.accountKey, b.pin);
    res.json({ success: result });
  } catch (err) {
    console.error('[master] Set PIN error:', err.message);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// API: Character Transfer (checkout/checkin)
// ---------------------------------------------------------------------------

// POST /api/characters/checkout — shard requests a character for a connecting player
app.post('/api/characters/checkout', requireShardAuth, function (req, res) {
  try {
    var b = req.body;
    if (!b || !b.accountKey || !b.shardId) {
      return res.status(400).json({ success: false, error: 'Missing accountKey or shardId' });
    }

    var key = b.accountKey;
    var shardId = b.shardId;

    // Check if character is already checked out to another shard
    var existing = characterLocks.get(key);
    if (existing && existing.shardId !== shardId) {
      // Check if the other shard is still alive
      var otherShard = shards.get(existing.shardId);
      if (otherShard && Date.now() - otherShard.lastSeen < HEARTBEAT_TIMEOUT) {
        return res.json({
          success: false,
          error: 'Character is currently on shard: ' + (otherShard.name || existing.shardId),
          lockedBy: existing.shardId,
        });
      }
      // Other shard is dead — release the lock
      characterLocks.delete(key);
    }

    var acc = accounts.loadAccount(key);
    if (!acc) {
      return res.json({ success: false, error: 'Account not found' });
    }

    // Lock character to this shard
    characterLocks.set(key, { shardId: shardId, checkedOutAt: Date.now() });

    // Return full account data (strip pinHash for security)
    var safeAccount = Object.assign({}, acc);
    safeAccount.hasPin = !!safeAccount.pinHash;
    delete safeAccount.pinHash;

    console.log('[master] Character ' + key.substring(0, 6) + '... checked out to shard ' + shardId);
    res.json({ success: true, account: safeAccount });
  } catch (err) {
    console.error('[master] Checkout error:', err.message);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// POST /api/characters/checkin — shard returns a character (player disconnected)
app.post('/api/characters/checkin', requireShardAuth, function (req, res) {
  try {
    var b = req.body;
    if (!b || !b.accountKey || !b.shardId) {
      return res.status(400).json({ success: false, error: 'Missing accountKey or shardId' });
    }

    var key = b.accountKey;
    var shardId = b.shardId;

    // Verify this shard holds the lock
    var lock = characterLocks.get(key);
    if (lock && lock.shardId !== shardId) {
      return res.json({ success: false, error: 'Character locked by another shard' });
    }

    // Merge updated account data
    if (b.account) {
      var existing = accounts.loadAccount(key);
      if (existing) {
        // Preserve pinHash (shards don't have it)
        var pinHash = existing.pinHash;
        // Merge: shard data overwrites everything except security fields
        var updated = Object.assign({}, existing, b.account);
        updated.key = key; // ensure key is correct
        updated.pinHash = pinHash; // restore pinHash
        updated.lastSeen = Date.now();
        accounts.saveAccount(updated);
      }
    }

    // Release lock
    characterLocks.delete(key);

    console.log('[master] Character ' + key.substring(0, 6) + '... checked in from shard ' + shardId);
    res.json({ success: true });
  } catch (err) {
    console.error('[master] Checkin error:', err.message);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// POST /api/characters/save — periodic save without releasing the lock
app.post('/api/characters/save', requireShardAuth, function (req, res) {
  try {
    var b = req.body;
    if (!b || !b.accountKey || !b.shardId || !b.account) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }

    var key = b.accountKey;
    var shardId = b.shardId;

    // Verify lock
    var lock = characterLocks.get(key);
    if (lock && lock.shardId !== shardId) {
      return res.json({ success: false, error: 'Character locked by another shard' });
    }

    var existing = accounts.loadAccount(key);
    if (existing) {
      var pinHash = existing.pinHash;
      var updated = Object.assign({}, existing, b.account);
      updated.key = key;
      updated.pinHash = pinHash;
      updated.lastSeen = Date.now();
      accounts.saveAccount(updated);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[master] Save error:', err.message);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// API: Health
// ---------------------------------------------------------------------------

app.get('/api/health', function (req, res) {
  res.json({
    status: 'ok',
    type: 'master',
    uptime: Math.floor(process.uptime()),
    shards: shards.size,
    accounts: accounts.getMemberCount(),
    characterLocks: characterLocks.size,
  });
});

// ---------------------------------------------------------------------------
// API: PoW challenge (clients can get challenges from master too)
// ---------------------------------------------------------------------------

var pow;
try { pow = require('../pow'); } catch (_) { pow = null; }

if (pow) {
  app.get('/api/pow/challenge', function (req, res) {
    var type = req.query.type === 'account' ? 'account' : 'connect';
    var challenge = pow.generateChallenge(type);
    res.json(challenge);
  });
}

// ---------------------------------------------------------------------------
// Catch-all
// ---------------------------------------------------------------------------

app.all('*', function (req, res) {
  res.status(404).json({ error: 'Not found' });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function gracefulShutdown(signal) {
  console.log('[master] ' + signal + ' received.');
  accounts.flushAll();
  process.exit(0);
}
process.on('SIGTERM', function () { gracefulShutdown('SIGTERM'); });
process.on('SIGINT', function () { gracefulShutdown('SIGINT'); });

process.on('uncaughtException', function (err) {
  console.error('[master] Uncaught exception:', err.stack || err.message);
  accounts.flushAll();
  setTimeout(function () { process.exit(1); }, 500);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, function () {
  console.log('');
  console.log('==============================================');
  console.log('  MMOLite Master Server on port ' + PORT);
  console.log('  Shard registry + account authority');
  console.log('  Shards authenticate with X-Shard-Secret');
  console.log('==============================================');
  console.log('');
});
