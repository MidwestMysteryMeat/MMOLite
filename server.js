// server.js — Main entry point for MMOLite
// Pokemon-style MMO game server. Love2D client connects via Socket.IO.

const fs = require('fs');
const crypto = require('crypto');

// Write PID to file so the LOVE client can shut us down cleanly
if (process.env.MMOLITE_PID_FILE) {
  try { fs.writeFileSync(process.env.MMOLITE_PID_FILE, String(process.pid)); } catch (_) {}
}

// Load env vars from /etc/mmolite/app.env (secrets stay out of source code)
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
  console.error('[server] Warning: Could not load env file:', _envErr.message);
}

const express = require('express');
const http = require('http');
const { createServer } = http;
const { Server } = require('socket.io');
const { setupSocket, socketAccountMap, sessionTokens, setDirector } = require('./socket');
const director = require('./director');
const accounts = require('./accounts');
const state = require('./state');
const loot = require('./loot');
const ratelimit = require('./ratelimit');
const pow = require('./pow');
const shardBridge = require('./shard-bridge');
const overworldStructures = require('./overworld-structures');
const farmingHandler = require('./handlers/farming');
const rpgData = require('./rpg-data');
const rumorSystem = require('./rumor-system');
const companionsHandler = require('./handlers/companions');
const petsHandler = require('./handlers/pets');

const redis = require('./redis');
const db = require('./db');
const compression = require('compression');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
const server = createServer(app);

app.use(compression());
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

// Security headers (simplified — no web UI to protect)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.removeHeader('X-Powered-By');
  // Debug: log socket.io HTTP requests (only when DEBUG env var is set)
  if (process.env.DEBUG && req.url && req.url.startsWith('/socket.io/')) {
    const sid = req.query && req.query.sid ? req.query.sid.substring(0, 8) + '...' : 'none';
    console.log('[http] ' + req.method + ' sid=' + sid + ' t=' + (req.query && req.query.t || '?'));
    const origEnd = res.end;
    res.end = function() {
      console.log('[http] RES ' + req.method + ' sid=' + sid + ' status=' + res.statusCode + ' len=' + (res.getHeader('Content-Length') || '?'));
      origEnd.apply(res, arguments);
    };
  }
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (res.statusCode >= 400 || ms > 2000) {
      console.log('[api] ' + req.method + ' ' + req.path + ' ' + res.statusCode + ' ' + ms + 'ms ip=' + (ratelimit.getIp(req) || '?'));
    }
  });
  next();
});

// Socket.IO — Love2D clients don't send Origin headers, so allow null origin
// In production, only allow origins specified via ALLOWED_ORIGINS env var (comma-separated)
const ALLOWED_ORIGINS = [];
if (process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS.split(',').forEach(function(o) {
    var trimmed = o.trim();
    if (trimmed) ALLOWED_ORIGINS.push(trimmed);
  });
}
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000', 'http://localhost:8443');
}
var socketTransports = process.env.SOCKET_TRANSPORTS
  ? process.env.SOCKET_TRANSPORTS.split(',').map(function(t) { return t.trim(); })
  : ['websocket'];
const io = new Server(server, {
  path: '/socket.io/',
  transports: socketTransports,
  maxHttpBufferSize: 500000,
  pingInterval: 25000,
  pingTimeout: 10000,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 1 },
    threshold: 1024,
    serverMaxWindowBits: 13,
  },
  cors: {
    origin: function(origin, cb) {
      // Love2D clients send no Origin header — allow null origin
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      // In dev mode with no ALLOWED_ORIGINS configured, allow all for convenience
      if (process.env.NODE_ENV !== 'production') return cb(null, true);
      // Production: reject unknown origins
      return cb('Origin not allowed', false);
    },
    credentials: true,
    methods: ['GET', 'POST'],
  },
  allowRequest: (req, cb) => {
    // Love2D sends no Origin — skip origin check, keep connection limit
    if (ratelimit.getConnectionCount() >= ratelimit.MAX_GLOBAL_CONNECTIONS) {
      return cb('Server full', false);
    }
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// Redis adapter for multi-process (PM2 cluster) support
// ---------------------------------------------------------------------------
if (process.env.OFFLINE_MODE !== '1') {
  redis.ready.then(function(ok) {
    if (ok && redis.pubClient && redis.subClient) {
      try {
        var createAdapter = require('@socket.io/redis-adapter').createAdapter;
        io.adapter(createAdapter(redis.pubClient, redis.subClient));
        console.log('[server] Redis adapter attached for multi-process support');
      } catch (err) {
        console.warn('[server] Could not attach Redis adapter:', err.message);
      }
      // Initialize cross-process state sync
      state.initSync(redis).catch(function(err) { console.warn('[server] Redis state sync failed, running single-process:', err.message); });
    }
  }).catch(function(err) { console.warn('[server] Redis connection failed:', err.message); });
}

setupSocket(io);

// Initialize AI Event Director
setDirector(director);
director.init(io, state, accounts, socketAccountMap);

// Initialize overworld structures system
overworldStructures.init(state);

// Overworld structures tick (every 5 minutes — spawn/expire structures)
setInterval(function() {
  try {
    overworldStructures.tick(state, io);
  } catch (err) {
    console.error('[server] Overworld structures tick error:', err.message);
  }
}, 5 * 60 * 1000);
// Run first tick after 30s to let server warm up
setTimeout(function() {
  try {
    overworldStructures.tick(state, io);
  } catch (err) {
    console.error('[server] Overworld structures initial tick error:', err.message);
  }
}, 30000);

// Farming tick (every 60s — crop growth, animal production, watering)
setInterval(function() {
  try {
    farmingHandler.farmingTick(state, io, accounts);
  } catch (err) {
    console.error('[server] Farming tick error:', err.message);
  }
}, 60000);

// Biome weather tick (every 5 minutes -- update per-biome weather)
setInterval(function() {
  try {
    var biomes = ['ocean','deep_ocean','beach','plains','forest','dense_forest','swamp','desert','tundra','frozen','mountains','highlands','volcanic','cave','underground','hollow_earth','coastal'];
    biomes.forEach(function(biomeId) {
      var newWeather = rpgData.getWeatherForBiome(biomeId);
      state.setBiomeWeather(biomeId, newWeather);
    });
  } catch (err) {
    console.error('[server] Biome weather tick error:', err.message);
  }
}, 5 * 60 * 1000);

// Rumor refresh tick (every 30 minutes)
rumorSystem.refreshAllTownRumors({});
setInterval(function() {
  try {
    rumorSystem.refreshAllTownRumors({});
  } catch (err) {
    console.error('[server] Rumor refresh tick error:', err.message);
  }
}, 30 * 60 * 1000);

// Calendar advancement tick (check every 60s, advance when interval elapsed)
var _lastCalendarSeason = state.world.calendar.season;
setInterval(function() {
  try {
    var advanced = state.advanceCalendar();
    if (advanced) {
      var cal = state.getCalendar();
      io.emit('calendar_update', cal);
      console.log('[calendar] Advanced to day ' + cal.day + ' of ' + cal.monthName + ', year ' + cal.year + ' (' + cal.season + ')');

      // Detect calendar season change — regenerate seasonal data
      if (cal.season !== _lastCalendarSeason) {
        _lastCalendarSeason = cal.season;
        try {
          var _seasonal = require('./seasonal');
          _seasonal.onSeasonChange(state.world.seasonSeed, cal.season);
          io.emit('season_visual_update', _seasonal.getVisual());
          console.log('[seasonal] Season changed to ' + cal.season + ' — regenerated and broadcast visuals');
        } catch (sErr) {
          console.error('[seasonal] Season change error:', sErr.message);
        }
      }
    }
  } catch (err) {
    console.error('[calendar] Tick error:', err.message);
  }
}, 60000);

// Companion wage tick (every 24 hours -- deduct wages for online players)
setInterval(function() {
  try {
    var keys = new Set(socketAccountMap.values());
    keys.forEach(function(key) {
      var acc = accounts.loadAccount(key);
      if (acc && acc.companions && acc.companions.length > 0) {
        companionsHandler.deductCompanionWages(acc);
        accounts.saveAccount(acc);
      }
    });
  } catch (err) {
    console.error('[server] Companion wage tick error:', err.message);
  }
}, 24 * 60 * 60 * 1000);

// Pet decay tick (every hour -- hunger/happiness decay for online players' pets)
setInterval(function() {
  try {
    var keys = new Set(socketAccountMap.values());
    keys.forEach(function(key) {
      var acc = accounts.loadAccount(key);
      if (acc && acc.petData && acc.petData.length > 0) {
        petsHandler.tickPetDecay(acc);
        accounts.saveAccount(acc);
      }
    });
  } catch (err) {
    console.error('[server] Pet decay tick error:', err.message);
  }
}, 3600000); // 1 hour

// CORS for REST API — use same origin policy as Socket.IO
app.use('/api', function(req, res, next) {
  var origin = req.headers.origin;
  if (!origin || ALLOWED_ORIGINS.includes(origin) || process.env.NODE_ENV !== 'production') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------------------
// Master API Proxy — forwards master-specific routes to localhost:MASTER_PORT
// This allows remote shards to reach the master API through the shard's port
// when the master port is not externally accessible.
// ---------------------------------------------------------------------------
var MASTER_PORT = process.env.MASTER_PORT || 4000;
var MASTER_PROXY_PATHS = [
  '/api/shards',
  '/api/accounts/authenticate',
  '/api/accounts/create',
  '/api/accounts/set-pin',
  '/api/characters/checkout',
  '/api/characters/checkin',
  '/api/characters/save',
];

function proxyToMaster(req, res) {
  // Body already parsed by express.json() — re-serialize for forwarding
  var postData = (req.body && Object.keys(req.body).length > 0) ? JSON.stringify(req.body) : '';
  var options = {
    hostname: '127.0.0.1',
    port: MASTER_PORT,
    path: req.originalUrl,
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'X-Shard-Secret': req.headers['x-shard-secret'] || '',
    },
    timeout: 10000,
  };
  var proxyReq = http.request(options, function(proxyRes) {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on('error', function(err) {
    res.status(502).json({ error: 'Master server unavailable: ' + err.message });
  });
  proxyReq.on('timeout', function() {
    proxyReq.destroy();
    res.status(504).json({ error: 'Master server timeout' });
  });
  if (postData) proxyReq.write(postData);
  proxyReq.end();
}

// Only proxy if this shard is co-located with the master (master mode + local master)
if (shardBridge.isMasterMode && shardBridge.config.masterServerUrl &&
    (shardBridge.config.masterServerUrl.includes('127.0.0.1') || shardBridge.config.masterServerUrl.includes('localhost'))) {
  MASTER_PROXY_PATHS.forEach(function(p) {
    app.all(p, proxyToMaster);
    // Also handle subpaths
    app.all(p + '/*', proxyToMaster);
  });
  console.log('[server] Master API proxy enabled on port ' + (process.env.PORT || shardBridge.config.port || '?') + ' -> localhost:' + MASTER_PORT);
}

// ---------------------------------------------------------------------------
// REST endpoints — MMO
// ---------------------------------------------------------------------------

app.get('/api/zones', (req, res) => {
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_zones', 20, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  res.json({ zones: state.getZoneList() });
});

app.get('/api/zone/:id/players', (req, res) => {
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_zone_players', 30, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  var zoneId = req.params.id;
  var zone = state.zones.get(zoneId);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  res.json({ zoneId: zoneId, playerCount: zone.members.size, players: state.getPlayersInZone(zoneId) });
});

app.get('/api/account/lookup/:key', (req, res) => {
  if (!req.params.key || req.params.key.length < 12 || !/^[a-zA-Z0-9]+$/.test(req.params.key)) {
    return res.status(400).json({ error: 'Invalid key format' });
  }
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'account_lookup', 3, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  const profile = accounts.getPublicProfile(req.params.key);
  setTimeout(() => {
    if (!profile) return res.json({ username: null, color: null });
    res.json({ username: profile.username, color: profile.color });
  }, 50 + Math.random() * 50);
});

app.get('/api/health', (req, res) => {
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_health', 60, 60000, { skipViolation: true })) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    zones: state.zones.size,
    players: state.users.size,
    world: {
      timeOfDay: state.world.timeOfDay,
      weather: state.world.weather,
    },
    shard: {
      id: shardBridge.config.shardId,
      name: shardBridge.config.shardName,
      version: shardBridge.config.version,
      masterMode: shardBridge.isMasterMode,
    },
  });
});

// ---------------------------------------------------------------------------
// REST endpoints — Proof-of-Work challenge
// ---------------------------------------------------------------------------
app.get('/api/pow/challenge', (req, res) => {
  const type = req.query.type === 'account' ? 'account' : 'connect';
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'pow_challenge', 60, 3600000, { skipViolation: true })) {
    return res.status(429).json({ error: 'Too many challenge requests.' });
  }
  const challenge = pow.generateChallenge(type);
  res.json(challenge);
});

// ---------------------------------------------------------------------------
// REST endpoints — Admin (deploy tooling)
// ---------------------------------------------------------------------------
app.post('/api/admin/update-warning', (req, res) => {
  var adminSecret = process.env.ADMIN_DEPLOY_SECRET;
  if (!adminSecret) return res.status(503).json({ error: 'Not configured' });
  var auth = req.headers['authorization'] || '';
  var expected = 'Bearer ' + adminSecret;
  var authBuf = Buffer.from(auth, 'utf8');
  var expectedBuf = Buffer.from(expected, 'utf8');
  if (authBuf.length !== expectedBuf.length || !require('crypto').timingSafeEqual(authBuf, expectedBuf)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.body && req.body.clear) {
    io.emit('update_warning', { message: null, clear: true });
    console.log('[admin] Update warning cleared via API');
    return res.json({ success: true, action: 'cleared' });
  }
  var message = (req.body && typeof req.body.message === 'string')
    ? req.body.message.slice(0, 200)
    : 'Server update incoming. May be briefly unavailable.';
  var minutesLeft = (req.body && typeof req.body.minutesLeft === 'number')
    ? req.body.minutesLeft : null;
  io.emit('update_warning', { message: message, minutesLeft: minutesLeft });
  console.log('[admin] Update warning triggered: ' + message);
  res.json({ success: true, message: message });
});

// Block scanner probes
const BLOCKED_PATHS = [
  '/.env', '/.git/*', '/.htaccess', '/.htpasswd',
  '/wp-admin*', '/wp-login*', '/wp-content*', '/wp-includes*',
  '/server.js', '/package.json', '/package-lock.json', '/node_modules*',
  '/metrics', '/graphql', '/swagger', '/swagger-ui*', '/api-docs*',
  '/admin', '/admin/*', '/debug', '/debug/*',
  '/phpinfo*', '/phpmyadmin*', '/xmlrpc.php',
  '/actuator*', '/console', '/config*',
];
app.all(BLOCKED_PATHS, (req, res) => {
  console.log('[security] Blocked path probe: ' + req.path + ' ip=' + (ratelimit.getIp(req) || '?'));
  res.status(404).send('Not found');
});

// Catch-all for unmatched routes
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});
app.all('*', (req, res) => {
  res.status(404).send('MMOLite game server. Connect via Love2D client.');
});

// ---------------------------------------------------------------------------
// Zone tick broadcast — send player positions per zone
// ---------------------------------------------------------------------------
setInterval(function() {
  var worldPayload = { time: state.world.timeOfDay, weather: state.world.weather };
  for (var entry of state.zones) {
    var zoneId = entry[0];
    var zone = entry[1];
    if (zone.members.size > 0) {
      if (zone.chunkCache && zone.members.size > 20) {
        // Large chunk-based zones: send per-player filtered positions (nearby only)
        // Build a chunk-bucket map first to avoid O(n²) scanning per player
        var CHUNK_SIZE = 512;
        var CHUNK_RADIUS = 5; // 5 chunks = 2560px, matches original RADIUS_SQ
        var chunkBuckets = new Map(); // 'cx,cy' -> [{ id, pos }]
        for (var sid of zone.members) {
          var pos = state.playerPositions.get(sid);
          if (!pos) continue;
          var bx = Math.floor(pos.x / CHUNK_SIZE);
          var by = Math.floor(pos.y / CHUNK_SIZE);
          var bkey = bx + ',' + by;
          if (!chunkBuckets.has(bkey)) chunkBuckets.set(bkey, []);
          chunkBuckets.get(bkey).push({ id: sid, pos: pos });
        }
        for (var sid of zone.members) {
          var myPos = state.playerPositions.get(sid);
          if (!myPos) continue;
          var mcx = Math.floor(myPos.x / CHUNK_SIZE);
          var mcy = Math.floor(myPos.y / CHUNK_SIZE);
          var nearby = [];
          for (var ncx = mcx - CHUNK_RADIUS; ncx <= mcx + CHUNK_RADIUS; ncx++) {
            for (var ncy = mcy - CHUNK_RADIUS; ncy <= mcy + CHUNK_RADIUS; ncy++) {
              var bucket = chunkBuckets.get(ncx + ',' + ncy);
              if (!bucket) continue;
              for (var bi = 0; bi < bucket.length; bi++) {
                var entry = bucket[bi];
                nearby.push({ id: entry.id, x: entry.pos.x, y: entry.pos.y, f: entry.pos.facing });
              }
            }
          }
          io.to(sid).emit('zone_positions', { players: nearby, time: worldPayload.time, weather: worldPayload.weather });
        }
      } else {
        // Small zones or few players: broadcast all positions
        var positions = [];
        for (var sid of zone.members) {
          var pos = state.playerPositions.get(sid);
          if (pos) positions.push({ id: sid, x: pos.x, y: pos.y, f: pos.facing });
        }
        io.to('zone:' + zoneId).emit('zone_positions', {
          players: positions,
          time: worldPayload.time,
          weather: worldPayload.weather,
        });
      }
    }
  }
}, 10000); // Recovery-only sync every 10s (real-time updates via zone_move deltas)

// Event loop lag monitoring
try {
  var perfHooks = require('perf_hooks');
  var eld = perfHooks.monitorEventLoopDelay({ resolution: 50 });
  eld.enable();
  setInterval(function() {
    var p99 = eld.percentile(99) / 1e6; // ns -> ms
    var mean = eld.mean / 1e6;
    if (p99 > 100) {
      console.warn('[perf] Event loop lag — mean=' + mean.toFixed(1) + 'ms p99=' + p99.toFixed(1) + 'ms');
    }
    eld.reset();
  }, 30000);
} catch (_perfErr) {
  // perf_hooks not available on older Node versions
}

// World time cycle — advance day/night every minute
// Only broadcast when time phase or weather actually changes (HIGH-1 perf fix)
var _lastTimePhase = state.world.timeOfDay;
var _lastWeather = state.world.weather;
setInterval(function() {
  var prevPhase = state.world.timeOfDay;
  var prevWeather = state.world.weather;
  state.advanceWorldTime();
  if (state.world.timeOfDay !== prevPhase || state.world.weather !== prevWeather) {
    _lastTimePhase = state.world.timeOfDay;
    _lastWeather = state.world.weather;
    io.emit('world_time', { timeOfDay: state.world.timeOfDay, weather: state.world.weather });
  }
}, 60000);

// ---------------------------------------------------------------------------
// Daily wipe — ephemeral state resets at midnight UTC (accounts persist)
// ---------------------------------------------------------------------------
function scheduleNextWipe() {
  const now = new Date();
  const nextMidnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0
  ));
  const msUntilMidnight = nextMidnight.getTime() - now.getTime();

  const ms5 = msUntilMidnight - 5 * 60 * 1000;
  if (ms5 > 0) {
    setTimeout(() => {
      io.emit('wipe_warning', { message: 'Server wipe in 5 minutes. Zone state will be cleared.', minutesLeft: 5 });
    }, ms5);
  }

  const ms1 = msUntilMidnight - 60 * 1000;
  if (ms1 > 0) {
    setTimeout(() => {
      io.emit('wipe_warning', { message: 'Server wipe in 1 minute.', minutesLeft: 1 });
    }, ms1);
  }

  setTimeout(() => {
    io.emit('server_wipe', { message: 'Daily wipe complete.' });

    // Flush all pending account writes before disconnecting — prevents data loss
    // for players who are mid-action when the wipe fires.
    accounts.flushAll();

    // Wipe ephemeral state (zones keep definitions, clear players/chat)
    state.wipeEphemeral();

    io.disconnectSockets(true);

    // Reset game state
    try { var macroDir = director.getMacroDirector(); if (macroDir && macroDir.reset) macroDir.reset(); } catch (_) {}
    accounts.clearAllDMs();
    overworldStructures.reset();

    console.log('[wipe] Daily wipe executed.');
    scheduleNextWipe();
  }, msUntilMidnight);

  const h = Math.floor(msUntilMidnight / 3600000);
  const m = Math.floor((msUntilMidnight % 3600000) / 60000);
  console.log(`[wipe] Next wipe in ${h}h ${m}m (midnight UTC)`);
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function gracefulShutdown(signal) {
  console.log('[server] ' + signal + ' received.');
  try {
    io.emit('update_warning', { message: 'Server restarting. Back in a moment.', minutesLeft: 0 });
  } catch (e) {}
  setTimeout(function() {
    // Save all characters back to master and deregister shard
    shardBridge.saveAllCharacters();
    shardBridge.stopHeartbeat();
    accounts.flushAll();
    try { director.saveState(); } catch (_) {}
    try { loot.flushSerialCounter(); } catch (_) {}
    try { db.close(); } catch (_) {}
    server.close(function() {
      console.log('[server] Shut down gracefully.');
      process.exit(0);
    });
    setTimeout(function() {
      console.log('[server] Forcing exit.');
      process.exit(0);
    }, 5000);
  }, 1000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason instanceof Error ? reason.stack || reason.message : reason);
});

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err.stack || err.message);
  try { accounts.flushAll(); } catch (_) {}
  setTimeout(() => process.exit(1), 500);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || shardBridge.config.port || 8443;

// Store shard password for socket.js to check (env var takes priority over config)
var shardPassword = process.env.SHARD_PASSWORD || shardBridge.config.password || null;
if (shardPassword) {
  shardBridge.config.password = shardPassword;
}

server.listen(PORT, () => {
  console.log('');
  console.log('==============================================');
  console.log(`  MMOLite running on port ${PORT}`);
  if (process.env.OFFLINE_MODE === '1') {
    console.log('  ** Server running in OFFLINE MODE **');
  } else {
    console.log('  KVM2: <shard1-ip>');
  }
  console.log('  Pokemon-style MMO game server');
  console.log('  Love2D client connects via Socket.IO');
  if (process.env.OFFLINE_MODE !== '1') {
    console.log('  Daily wipe at midnight UTC.');
  }
  if (shardPassword) {
    console.log('  Password protected: YES');
  }
  console.log('==============================================');
  console.log('');

  // Create default zones on startup
  state.initDefaultZones();

  // Seasonal world system — generate definitions from doom-cycle seed
  var seasonal = require('./seasonal');
  var worldgen = require('./worldgen');
  var seasonSeed = state.world.seasonSeed || worldgen.chunkSeed(state.world.doomAscensionCount || 0, 0, 'mmolite_season');
  state.world.seasonSeed = seasonSeed;
  seasonal.generate(seasonSeed, state.world.calendar.season);
  seasonal.apply();

  // Async account preload (non-blocking — replaces synchronous IIFE at module load)
  accounts.preloadKeyIndex().catch(function(err) {
    console.error('[server] preloadKeyIndex error:', err.message);
  });

  // Start shard bridge heartbeat (registers with master server) — skip in offline mode
  if (process.env.OFFLINE_MODE !== '1') {
    shardBridge.startHeartbeat(function() { return state.users.size; });
  } else {
    console.log('[server] Offline mode — skipping shard heartbeat');
  }

  // Skip daily wipe in offline/local mode — no reason to reset solo play
  if (process.env.OFFLINE_MODE !== '1') {
    scheduleNextWipe();
  } else {
    console.log('[wipe] Offline mode — daily wipe disabled');
  }

  // ---------------------------------------------------------------------------
  // LAN discovery broadcast (UDP)
  // ---------------------------------------------------------------------------
  if (process.env.OFFLINE_MODE === '1' || !shardBridge.isMasterMode) {
    var dgram = require('dgram');
    var os = require('os');
    var udpBroadcast = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    udpBroadcast.bind(function() {
      udpBroadcast.setBroadcast(true);

      var broadcastInterval = setInterval(function() {
        // Determine local LAN IP
        var localIP = '127.0.0.1';
        var interfaces = os.networkInterfaces();
        var ifNames = Object.keys(interfaces);
        for (var i = 0; i < ifNames.length; i++) {
          var addrs = interfaces[ifNames[i]];
          for (var j = 0; j < addrs.length; j++) {
            if (addrs[j].family === 'IPv4' && !addrs[j].internal) {
              localIP = addrs[j].address;
              break;
            }
          }
          if (localIP !== '127.0.0.1') break;
        }

        var playerCount = io.engine ? io.engine.clientsCount : 0;
        var packet = JSON.stringify({
          type: 'MMOLITE_SHARD',
          name: shardBridge.config.shardName || 'Local Server',
          host: localIP,
          port: PORT,
          players: playerCount,
          maxPlayers: shardBridge.config.maxPlayers || 8,
          version: '1.0.0',
          hasPassword: !!(process.env.SHARD_PASSWORD || shardBridge.config.password),
          rules: shardBridge.config.rules || {},
        });

        var buf = Buffer.from(packet);
        udpBroadcast.send(buf, 0, buf.length, 5050, '255.255.255.255');
      }, 3000);

      console.log('[server] LAN broadcast started on UDP port 5050');

      // Clean up on shutdown
      process.on('SIGINT', function() { clearInterval(broadcastInterval); udpBroadcast.close(); });
      process.on('SIGTERM', function() { clearInterval(broadcastInterval); udpBroadcast.close(); });
    });
  }
});
