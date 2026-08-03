// tests/bot-strain.js
// Bot/strain testing — simulate N concurrent players performing activities.
// Run: node tests/bot-strain.js [options]
//
// Options:
//   --url      Server URL (default: http://localhost:$PORT, else 3001)
//   --bots     Number of bot accounts (default: 20)
//   --duration Duration in seconds (default: 30)
//   --verbose  Print per-bot event counts
//
// The bots perform a realistic mix of activities:
//   • Connect and authenticate (uses temp account flow)
//   • zone_enter into starter_town
//   • Periodic zone_move (random walk)
//   • Periodic zone_chat
//   • Every 5s: simulate resource_harvest attempt
//   • Measure latency via ping_server / pong_server
//   • Disconnect cleanly at end

'use strict';

const crypto = require('crypto');
const http   = require('http');
const https  = require('https');

let io;
try {
  io = require('socket.io-client');
} catch (e) {
  console.error('socket.io-client not installed. Run: npm install --save-dev socket.io-client');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// PoW helpers — mirrors pow.js on the server side
// ---------------------------------------------------------------------------

function hasLeadingZeros(hashBuf, difficulty) {
  const fullBytes = Math.floor(difficulty / 8);
  for (let i = 0; i < fullBytes; i++) {
    if (hashBuf[i] !== 0) return false;
  }
  const remainBits = difficulty % 8;
  if (remainBits > 0) {
    const mask = 0xff << (8 - remainBits) & 0xff;
    if ((hashBuf[fullBytes] & mask) !== 0) return false;
  }
  return true;
}

function solvePoW(challenge, difficulty) {
  let nonce = 0;
  while (true) {
    const n = nonce.toString(36);
    const hash = crypto.createHash('sha256').update(challenge + n).digest();
    if (hasLeadingZeros(hash, difficulty)) return n;
    nonce++;
  }
}

function fetchChallenge(baseUrl, callback) {
  const url = baseUrl.replace(/\/$/, '') + '/api/pow/challenge?type=connect';
  const lib = url.startsWith('https') ? https : http;
  lib.get(url, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        callback(null, data);
      } catch (e) {
        callback(e);
      }
    });
  }).on('error', callback);
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf('--' + name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}

// Mirrors server.js's own resolution (PORT env, then shard-config.json's
// port, which ships as 3001). The old 3000 default pointed at nothing.
const SERVER_URL  = getArg('url', 'http://localhost:' + (process.env.PORT || 3001));
const BOT_COUNT   = parseInt(getArg('bots', '20'), 10);
const DURATION_S  = parseInt(getArg('duration', '30'), 10);
const VERBOSE     = args.includes('--verbose');

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const metrics = {
  connected: 0,
  connectFailed: 0,
  disconnected: 0,
  eventsRx: 0,
  eventsTx: 0,
  errors: 0,
  latencySamples: [],
};

// ---------------------------------------------------------------------------
// Bot factory
// ---------------------------------------------------------------------------

function createBot(index) {
  const botName = 'StrainBot_' + index + '_' + Math.random().toString(36).slice(2, 6);
  const botPin   = '0000';

  let socket = null;
  let connected = false;
  let rxCount = 0;
  let txCount = 0;
  let lastPingSent = 0;

  function send(event, data) {
    if (connected) {
      socket.emit(event, data);
      txCount++;
      metrics.eventsTx++;
    }
  }

  function onEvent() {
    rxCount++;
    metrics.eventsRx++;
  }

  function randomMove() {
    const directions = ['up', 'down', 'left', 'right'];
    const dir = directions[Math.floor(Math.random() * directions.length)];
    send('zone_move', { direction: dir });
  }

  function doHarvest() {
    // Pick a random resource type the bot might encounter
    const types = ['wood', 'stone', 'herbs', 'fish', 'iron_ore'];
    send('resource_harvest', {
      resourceId: 'node_' + Math.floor(Math.random() * 100),
      resourceType: types[Math.floor(Math.random() * types.length)],
    });
  }

  function doPing() {
    lastPingSent = Date.now();
    send('ping_server', {});
  }

  function connectWithAuth(powChallenge, powNonce) {
    socket = io(SERVER_URL, {
      // The server is websocket-only by default (SOCKET_TRANSPORTS in
      // server.js) because the Love2D client speaks websocket directly.
      // socket.io-client defaults to polling-then-upgrade, so without this
      // every bot dies on "xhr poll error" before the upgrade is attempted.
      transports: ['websocket'],
      timeout: 10000,
      reconnection: false,
      auth: {
        name: botName,
        powChallenge: powChallenge,
        powNonce: powNonce,
      },
    });

    socket.on('connect', () => {
      connected = true;
      metrics.connected++;
    });

    socket.on('connect_error', (err) => {
      metrics.connectFailed++;
      if (VERBOSE) console.error('[bot' + index + '] connect_error:', err.message);
    });

    socket.on('disconnect', () => {
      connected = false;
      metrics.disconnected++;
    });

    // Listen for auth result (various patterns)
    socket.on('login_result', (data) => {
      onEvent();
      if (data && (data.success || data.ok)) {
        send('zone_enter', { zoneId: 'starter_town' });
      }
    });

    socket.on('identity', (data) => {
      onEvent();
      send('zone_enter', { zoneId: 'starter_town' });
    });

    socket.on('zone_state', (data) => {
      onEvent();
      // Start activity loop
      startActivity();
    });

    socket.on('pong_server', () => {
      onEvent();
      const latency = Date.now() - lastPingSent;
      metrics.latencySamples.push(latency);
    });

    // Count all other events
    const trackedEvents = [
      'zone_player_joined', 'zone_player_left', 'resource_harvested', 'resource_gone',
      'zone_chat_message', 'harvest_failed', 'harvest_success', 'xp_gained',
      'dungeon_error', 'quest_progress', 'item_dropped',
    ];
    for (const ev of trackedEvents) {
      socket.on(ev, onEvent);
    }

    socket.on('error', (err) => {
      metrics.errors++;
      if (VERBOSE) console.error('[bot' + index + '] error:', err);
    });
  }

  let moveInterval = null;
  let harvestInterval = null;
  let pingInterval = null;

  function startActivity() {
    // Random walk every 1-2s
    moveInterval = setInterval(() => {
      if (Math.random() < 0.7) randomMove();
      if (Math.random() < 0.05) {
        send('zone_chat', { message: 'Bot ' + index + ' active' });
      }
    }, 1000 + Math.random() * 1000);

    // Harvest every 5-8s
    harvestInterval = setInterval(doHarvest, 5000 + Math.random() * 3000);

    // Ping every 10s for latency measurement
    pingInterval = setInterval(doPing, 10000);
  }

  function stop() {
    clearInterval(moveInterval);
    clearInterval(harvestInterval);
    clearInterval(pingInterval);
    if (socket) socket.disconnect();
    if (VERBOSE) {
      console.log('[bot' + index + '] tx=' + txCount + ' rx=' + rxCount);
    }
  }

  function connect() {
    fetchChallenge(SERVER_URL, (err, data) => {
      if (err || !data || !data.challenge) {
        metrics.connectFailed++;
        if (VERBOSE) console.error('[bot' + index + '] challenge fetch failed:', err && err.message);
        return;
      }
      const nonce = solvePoW(data.challenge, data.difficulty);
      connectWithAuth(data.challenge, nonce);
    });
  }

  return { connect, stop };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('=== MMOLite Bot Strain Test ===');
console.log('URL:      ' + SERVER_URL);
console.log('Bots:     ' + BOT_COUNT);
console.log('Duration: ' + DURATION_S + 's');
console.log('');

const bots = [];
for (let i = 0; i < BOT_COUNT; i++) {
  const bot = createBot(i);
  bots.push(bot);
}

// Stagger connections over 2s to avoid thundering herd
let connectIdx = 0;
const connectInterval = setInterval(() => {
  if (connectIdx < bots.length) {
    bots[connectIdx++].connect();
  } else {
    clearInterval(connectInterval);
  }
}, Math.floor(2000 / BOT_COUNT));

// Progress ticker every 5s
let elapsed = 0;
const ticker = setInterval(() => {
  elapsed += 5;
  console.log('[' + elapsed + 's] connected=' + metrics.connected +
    ' failed=' + metrics.connectFailed +
    ' tx=' + metrics.eventsTx +
    ' rx=' + metrics.eventsRx +
    ' errors=' + metrics.errors);
}, 5000);

// Stop after duration
setTimeout(() => {
  clearInterval(ticker);
  console.log('\n--- Stopping bots ---');
  for (const bot of bots) bot.stop();

  // Wait for disconnects to propagate
  setTimeout(() => {
    const latencies = metrics.latencySamples;
    const avgLat = latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 'N/A';
    const maxLat = latencies.length > 0 ? Math.max(...latencies) : 'N/A';

    console.log('\n=== Results ===');
    console.log('Bots connected:    ' + metrics.connected + ' / ' + BOT_COUNT);
    console.log('Connect failures:  ' + metrics.connectFailed);
    console.log('Events sent:       ' + metrics.eventsTx);
    console.log('Events received:   ' + metrics.eventsRx);
    console.log('Errors:            ' + metrics.errors);
    console.log('Avg latency:       ' + avgLat + 'ms');
    console.log('Max latency:       ' + maxLat + 'ms');
    console.log('Latency samples:   ' + latencies.length);

    const success = metrics.connected >= Math.floor(BOT_COUNT * 0.8);
    if (success) {
      console.log('\n✓ PASS — at least 80% of bots connected successfully');
      process.exit(0);
    } else {
      console.log('\n✗ FAIL — fewer than 80% of bots connected');
      process.exit(1);
    }
  }, 2000);
}, DURATION_S * 1000);
