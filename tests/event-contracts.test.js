// tests/event-contracts.test.js
// Layer 1: Contract tests — verify every server emit has a client listener.
// Scans server .js files for any *.emit('event') calls and all client scene
// .lua files for client:on() registrations, then diffs them.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// --- helpers ---

function collectServerEmits(dir) {
  const emits = new Set();
  // Match any variable ending in .emit('event') — covers socket, io, ns,
  // targetSocket, targetSock, kickedSocket, sock, etc.
  const pattern = /\w+(?:\.to\([^)]*\))?\.emit\(\s*['"]([^'"]+)['"]/g;

  function scanFile(fp) {
    const src = fs.readFileSync(fp, 'utf8');
    let m;
    while ((m = pattern.exec(src)) !== null) {
      emits.add(m[1]);
    }
    pattern.lastIndex = 0;
  }

  function scanDir(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(d, e.name);
      if (e.isDirectory() && !['node_modules', 'tests', 'client', 'build'].includes(e.name)) {
        scanDir(fp);
      } else if (e.isFile() && e.name.endsWith('.js')) {
        scanFile(fp);
      }
    }
  }
  scanDir(dir);
  return emits;
}

function collectClientListeners() {
  const listeners = new Set();
  const pattern = /client:on\(\s*["']([^"']+)['"]/g;

  // Scan all .lua files under client/scenes/ (includes game.lua, login.lua,
  // character_select.lua, shards.lua, and all game-handlers/)
  function scanLuaDir(d) {
    if (!fs.existsSync(d)) return;
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) {
        scanLuaDir(fp);
      } else if (e.isFile() && e.name.endsWith('.lua')) {
        const src = fs.readFileSync(fp, 'utf8');
        let m;
        while ((m = pattern.exec(src)) !== null) listeners.add(m[1]);
        pattern.lastIndex = 0;
      }
    }
  }
  scanLuaDir(path.join(ROOT, 'client', 'scenes'));

  return listeners;
}

// Events the server emits that are intentionally handled only server-to-server
// or broadcast-only (no per-client UI needed), so we skip them in the diff.
const KNOWN_SERVER_ONLY = new Set([
  // Socket.IO internals / room management
  'connection', 'disconnect', 'error',
  // Admin broadcast only
  'server_shutdown', 'admin_kicked',
  // World events broadcast to all — client handles via world_event
  'world_event',
  // Internal director emits (no client panel yet)
  // Challenge / achievement helpers that emit generically
  'challenge_progress', 'achievement_unlocked',
  // Party room emits — client handles via party_updated / party_left already
  'party_message',
  // Overworld broadcast (positional) — handled by zone_state
  'zone_state', 'zone_player_joined', 'zone_player_left', 'zone_players',
  // Legacy BossCord events (not MMO)
  'game_state', 'room_list', 'room_joined', 'room_left', 'chat',
  // Structural cleared (broadcast, no dedicated panel yet)
  'structure_cleared', 'rift_destroyed',
]);

// Events the client listens to that aren't emitted by current server code
// (e.g. future UI hooks, or emitted via non-standard variable names the regex misses).
const KNOWN_CLIENT_EXTRA = new Set([
  'connect', 'disconnect', 'connect_error',
  // Emitted via callbacks.broadcastToFloor / callbacks.emitToPlayer (indirect)
  'tc_combat_start', 'tc_combat_turn', 'tc_combat_end',
  'tc_combat_initiative', 'tc_combat_reaction',
  'tc_units_spawned', 'tc_corruption_zones',
  'tc_boss_phase_change', 'tc_boss_soul_harvest', 'tc_boss_attack',
  // Emitted via lichRaidBroadcast (indirect)
  'raid_activated', 'raid_cancelled', 'raid_complete',
  'raid_boss_engage', 'raid_boss_phase', 'raid_warning', 'raid_gathering_update',
  // Emitted via callbacks.broadcastToFloor in director-ocean.js
  'leviathan_enrage', 'leviathan_part_destroyed', 'leviathan_phase_change',
]);

// ---------------------------------------------------------------

describe('Event Contracts: Server emits ↔ Client listeners', () => {
  let serverEmits;
  let clientListeners;

  beforeAll(() => {
    serverEmits = collectServerEmits(ROOT);
    clientListeners = collectClientListeners();
  });

  test('client game.lua should exist', () => {
    expect(fs.existsSync(path.join(ROOT, 'client', 'scenes', 'game.lua'))).toBe(true);
  });

  test('server emits at least 30 distinct event names', () => {
    expect(serverEmits.size).toBeGreaterThan(30);
  });

  test('client registers at least 30 distinct listeners', () => {
    expect(clientListeners.size).toBeGreaterThan(30);
  });

  test('server emits → client handlers: report missing (informational)', () => {
    const missing = [];
    for (const ev of serverEmits) {
      if (KNOWN_SERVER_ONLY.has(ev)) continue;
      if (!clientListeners.has(ev)) {
        missing.push(ev);
      }
    }
    // This is informational — the game is in active development.
    // We record the count so regressions show up as increases.
    console.log('[contracts] Server events missing client handler: ' + missing.length + ' of ' + serverEmits.size);
    if (missing.length > 0) {
      console.log('[contracts] Sample missing:', missing.sort().slice(0, 20).join(', '));
    }
    // Coverage ratchet: tighten this as client handlers are wired up.
    // Widened regex captures 421 server emits; 312 covered = 74%.
    const covered = serverEmits.size - missing.length;
    const coveragePct = covered / serverEmits.size;
    expect(coveragePct).toBeGreaterThan(0.73);
  });

  test('client listeners with no server emit: report orphaned (informational)', () => {
    const orphaned = [];
    for (const ev of clientListeners) {
      if (KNOWN_CLIENT_EXTRA.has(ev)) continue;
      if (!serverEmits.has(ev)) {
        orphaned.push(ev);
      }
    }
    console.log('[contracts] Client listeners with no matching server emit: ' + orphaned.length);
    if (orphaned.length > 0) {
      console.log('[contracts] Orphaned:', orphaned.sort().join(', '));
    }
    // Ratchet: widened regex + scan scope eliminated all false-positive orphans.
    expect(orphaned.length).toBeLessThanOrEqual(0);
  });
});
