// tests/disconnect-cleanup.integration.test.js
// Layer 5+: Disconnect cleanup invariants.
// Verifies that handlers/disconnect.js cleans up all shared-state maps
// when a socket disconnects. Uses lightweight mocks — no full server boot.

// Prevent shard-bridge (which requires accounts.js, which requires ACCOUNT_SECRET)
// from loading. disconnect.js already handles this with try/catch but Jest's
// process.exit interceptor fires before the catch runs.
jest.mock('../shard-bridge', () => null);

const path = require('path');
const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Minimal mock factory helpers
// ---------------------------------------------------------------------------

function makeSocket(id, sessionToken) {
  const listeners = {};
  return {
    id,
    _mmoliteSessionToken: sessionToken || null,
    on(event, fn) { listeners[event] = fn; },
    emit() {},
    to() { return { emit() {} }; },
    leave() {},
    _trigger(event, ...args) {
      if (listeners[event]) listeners[event](...args);
    },
  };
}

function makeState(socketId, accKey) {
  const users = new Map([[socketId, { id: socketId, name: 'TestPlayer' }]]);
  const playerZones = new Map([[socketId, 'starter_town']]);
  const parties = new Map();
  const activeBattles = new Map();
  const playerPartyMap = new Map();
  const _survivalVisitedChunks = new Map([[accKey, true]]);

  return {
    users,
    playerZones,
    parties,
    activeBattles,
    playerPartyMap,
    _survivalVisitedChunks,
    getPlayerParty(sid) { return playerPartyMap.get(sid) || null; },
    removeUser(sid) { users.delete(sid); },
    endBattle(id) { activeBattles.delete(id); },
    zones: new Map(),
  };
}

function makeAccounts(accKey) {
  const acc = { key: accKey, username: 'TestPlayer', lastSeen: 0, temp: false };
  const cache = new Map([[accKey, acc]]);
  return {
    isTempAccount: () => false,
    loadAccount: (k) => cache.get(k) || null,
    saveAccount: (a) => { cache.set(a.key, a); },
    getFriendsData: () => null,
    getExportableSnapshot: () => null,
    deleteAccount: () => {},
  };
}

// ---------------------------------------------------------------------------

describe('Disconnect cleanup: state.users', () => {
  const SOCKET_ID = 'socket_abc';
  const ACC_KEY   = 'acc_test_1';

  let socket, state, accounts, socketAccountMap, sessionTokens;

  beforeEach(() => {
    socket           = makeSocket(SOCKET_ID, 'tok_1');
    state            = makeState(SOCKET_ID, ACC_KEY);
    accounts         = makeAccounts(ACC_KEY);
    socketAccountMap = new Map([[SOCKET_ID, ACC_KEY]]);
    sessionTokens    = new Map([['tok_1', SOCKET_ID]]);

    const io = { sockets: { sockets: new Map([[SOCKET_ID, socket]]) } };

    const deps = {
      socketAccountMap,
      accounts,
      state,
      _removeFromIpTracking: () => {},
      ratelimit: { decrementConnections: () => {} },
      sessionTokens,
      _unlinkSocket: (sid) => { socketAccountMap.delete(sid); },
      getSocketsForAccount: () => new Set(),
      directorLich: null,
    };

    const disconnectHandler = require(path.join(ROOT, 'handlers', 'disconnect'));
    disconnectHandler.init(io, socket, deps);
  });

  test('removes user from state.users on disconnect', () => {
    expect(state.users.has(SOCKET_ID)).toBe(true);
    socket._trigger('disconnect', 'transport close');
    expect(state.users.has(SOCKET_ID)).toBe(false);
  });

  test('removes entry from socketAccountMap on disconnect', () => {
    expect(socketAccountMap.has(SOCKET_ID)).toBe(true);
    socket._trigger('disconnect', 'transport close');
    expect(socketAccountMap.has(SOCKET_ID)).toBe(false);
  });

  test('clears session token on disconnect', () => {
    expect(sessionTokens.has('tok_1')).toBe(true);
    socket._trigger('disconnect', 'transport close');
    expect(sessionTokens.has('tok_1')).toBe(false);
    expect(socket._mmoliteSessionToken).toBeNull();
  });

  test('clears survival visited chunks on disconnect', () => {
    expect(state._survivalVisitedChunks.has(ACC_KEY)).toBe(true);
    socket._trigger('disconnect', 'transport close');
    expect(state._survivalVisitedChunks.has(ACC_KEY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('Disconnect cleanup: battle teardown', () => {
  const P1        = 'socket_p1';
  const P2        = 'socket_p2';
  const ACC_KEY2  = 'acc_battle_p2';
  const BATTLE_ID = 'battle_001';

  let p1Emitted;

  beforeEach(() => {
    p1Emitted = [];

    const p1Socket = makeSocket(P1);
    p1Socket.emit = (ev, data) => p1Emitted.push({ ev, data });
    const p2Socket = makeSocket(P2);

    const state = makeState(P2, ACC_KEY2);
    state.activeBattles.set(BATTLE_ID, {
      state: 'active',
      participants: [{ socketId: P1 }, { socketId: P2 }],
    });

    const io = {
      sockets: { sockets: new Map([[P1, p1Socket], [P2, p2Socket]]) },
      to: (sid) => ({
        emit: (ev, d) => { if (sid === P1) p1Emitted.push({ ev, data: d }); },
      }),
    };

    const deps = {
      socketAccountMap: new Map([[P2, ACC_KEY2]]),
      accounts: makeAccounts(ACC_KEY2),
      state,
      _removeFromIpTracking: () => {},
      ratelimit: { decrementConnections: () => {} },
      sessionTokens: new Map(),
      _unlinkSocket: () => {},
      getSocketsForAccount: () => new Set(),
      directorLich: null,
    };

    const disconnectHandler = require(path.join(ROOT, 'handlers', 'disconnect'));
    disconnectHandler.init(io, p2Socket, deps);
    p2Socket._trigger('disconnect', 'transport close');
  });

  test('sends battle_end to remaining participant when opponent disconnects', () => {
    const battleEndEvent = p1Emitted.find(e => e.ev === 'battle_end');
    expect(battleEndEvent).toBeDefined();
    expect(battleEndEvent.data).toMatchObject({ reason: 'opponent_disconnected' });
  });
});

// ---------------------------------------------------------------------------

describe('Disconnect cleanup: unknown socket', () => {
  test('handles disconnect for socket not in state.users without throwing', () => {
    const socket = makeSocket('unknown_sock', 'tok_orphan');
    const sessionTokens = new Map([['tok_orphan', 'unknown_sock']]);
    const state = {
      users: new Map(),
      getPlayerParty: () => null,
      removeUser: () => {},
      activeBattles: new Map(),
      _survivalVisitedChunks: new Map(),
      playerZones: new Map(),
    };

    const io = { sockets: { sockets: new Map() } };
    const deps = {
      socketAccountMap: new Map(),
      accounts: makeAccounts('nobody'),
      state,
      _removeFromIpTracking: () => {},
      ratelimit: { decrementConnections: () => {} },
      sessionTokens,
      _unlinkSocket: () => {},
      getSocketsForAccount: () => new Set(),
      directorLich: null,
    };

    const disconnectHandler = require(path.join(ROOT, 'handlers', 'disconnect'));
    disconnectHandler.init(io, socket, deps);

    expect(() => socket._trigger('disconnect', 'transport error')).not.toThrow();
    // Session token cleaned up even for sockets not in state.users
    expect(sessionTokens.has('tok_orphan')).toBe(false);
  });
});
