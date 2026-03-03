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

// Events the server emits that are intentionally unhandled by the Love2D client.
// Each entry must have a documented reason. Add here rather than leaving gaps
// untracked. Triage categories:
//   web-only:   handled by web client; no Love2D panel built
//   legacy:     BossCord-era event; not part of MMO flow
//   moderation: moderator tool output; no regular player UI needed
//   dm-infra:   server-internal DM encryption key exchange
//   deferred:   feature planned but client panel not yet built
const KNOWN_INTENTIONAL_UNHANDLED = new Set([
  // web-only — social profile, account management, GIF picker
  'account_data',          // web dashboard; no Love2D UI
  'user_profile',          // web social profile page; no Love2D UI
  'pin_changed',           // web account-settings flow; no Love2D UI
  'gif_favorites',         // BossCord GIF picker; not in MMO
  // legacy BossCord (not MMO systems)
  'tcg_table_invite',      // BossCord TCG table invite
  'game_invite',           // BossCord multiplayer invite
  'user_joined',           // BossCord room join broadcast
  'user_left',             // BossCord room leave broadcast
  // moderation — moderator tool outputs; no regular player UI
  'mod_action_result',     // moderator action confirmation; web only
  'mod_error',             // moderator error output; web only
  'mute_result',           // moderator mute confirmation; web only
  'slur_filter_updated',   // admin filter management; web only
  // dm-infra — server-internal DM encryption key exchange
  'dm_key_rotated',
  'dm_key_request',
  'dm_key_response',
  'dm_key_confirmed',
  // deferred — friends panel not yet built in Love2D
  'friends_list',
  'friend_request_received',
  'friend_request_accepted',
  'friend_request_declined',
  'friend_removed',
  'friend_status_changed',
  // deferred — DM chat panel not yet built in Love2D
  'dm_received',
  'dm_sent',
  'dm_history_result',
  'dm_conversations_result',
  // deferred — server admin/wipe notification
  'wipe_warning',
  'server_wipe',
  // deferred — challenges panel not yet implemented
  'daily_challenges',
  'challenge_complete',
  // deferred — pet evolution and passive regen ticker UI
  'pet_evolved',
  'passive_regen',
  // deferred — PvP battle panel not yet built
  'battle_end',
  'battle_start',
  // deferred — public profile viewer not yet built
  'profile_result',
  'profile_data',
  // deferred — server update countdown HUD not yet built
  'update_warning',
  // deferred — achievements panel not yet built
  'achievements',
  'challenge_claimed',
  // deferred — awakening system UI not yet built
  'available_awakenings',
  'awakening_error',
  'awakening_selected',
  // web-only — avatar, showcase, portraits, race list (login/web flow)
  'avatar_updated',
  'showcase_updated',
  'portraits_list',
  'race_list',
  'account_deleted',
  'pin_set_success',
  // web-only — leaderboard, loot catalog (web dashboard)
  'leaderboard_data',
  'loot_catalog_data',
  // legacy BossCord — TCG card lobbies
  'card_lobbies_updated',
  'card_lobby_update',
  // moderation — mod action outputs (kicked, muted, teleported)
  'mod_kicked',
  'mod_muted',
  'mod_teleported',
  // DM infrastructure
  'dm_public_key',
  'dm_public_key_set',
  'dm_conversations_list',
  // deferred — friends request list (full social panel not built)
  'friend_invite_sent',
  'friend_request_sent',
  'friend_requests_list',
  // deferred — gacha rates and NPC market overview panels not built
  'gacha_rates',
  'npc_shop_market_overview',
  // deferred — calendar and full moon (world tick broadcasts, no HUD yet)
  'calendar_update',
  'full_moon_rising',
  // deferred — plot and structure lifecycle (no client panel yet)
  'plot_access_updated',
  'structure_expired',
  'structure_spawned',
  // deferred — auction notifications (minor, auction panel handles browsing)
  'mmo_auction_market_health',
  'mmo_auction_market_price',
  // deferred — town infiltration tracker not built
  'town_infiltration_update',
  // BossCord room messaging (no room/channel concept in Love2D game client)
  'new_message',
]);

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
    const genuinelyMissing = [];
    const allowlisted = [];
    for (const ev of serverEmits) {
      if (KNOWN_SERVER_ONLY.has(ev)) continue;
      if (!clientListeners.has(ev)) {
        if (KNOWN_INTENTIONAL_UNHANDLED.has(ev)) {
          allowlisted.push(ev);
        } else {
          genuinelyMissing.push(ev);
        }
      }
    }
    console.log('[contracts] Genuinely missing handlers: ' + genuinelyMissing.length + ' of ' + serverEmits.size);
    console.log('[contracts] Intentionally allowlisted: ' + allowlisted.length);
    if (genuinelyMissing.length > 0) {
      console.log('[contracts] Missing (not allowlisted):', genuinelyMissing.sort().join(', '));
    }
    // Hard gate: genuinely missing events (not in KNOWN_INTENTIONAL_UNHANDLED) must not
    // exceed the ratchet. To add a new missing event, add it to KNOWN_INTENTIONAL_UNHANDLED
    // above with a documented reason. Tighten this number as gaps are closed.
    // Baseline (2026-03-02 sprint complete): 0 genuine gaps, 61 allowlisted.
    expect(genuinelyMissing.length).toBeLessThanOrEqual(0);
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
