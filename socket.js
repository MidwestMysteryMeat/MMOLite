// socket.js
// Socket.IO event handler for MMOLite.
// Thin router: requires modules, creates shared state, wires handler files.

const crypto = require('crypto');
const state = require('./state');
const accounts = require('./accounts');
const filter = require('./filter');
const ratelimit = require('./ratelimit');
const pow = require('./pow');
const shardBridge = require('./shard-bridge');
const loot = require('./loot');

// Handler modules — shared utilities
const { checkEventRate, applyRateGrace, clearSocketCooldowns, sanitizeText, validateUrl, enrichInventory } = require('./handlers/helpers');

// MMO handlers (NEW)
const zoneHandler = require('./handlers/zone');
const overworldHandler = require('./handlers/overworld');
const partyHandler = require('./handlers/party');
const monstersHandler = require('./handlers/monsters');
const guildHandler = require('./handlers/guild');
const tradeHandler = require('./handlers/trade');
const craftingHandler = require('./handlers/crafting');
const placementHandler = require('./handlers/placement');
const characterCreationHandler = require('./handlers/character-creation');
const rpgCardsHandler = require('./handlers/rpg-cards');
const mmoAuctionHandler = require('./handlers/mmo-auction');
const npcShopHandler = require('./handlers/npc-shop');
const cardShopHandler = require('./handlers/card-shop');
const plotHandler = require('./handlers/plot');
const mmoModerationHandler = require('./handlers/mmo-moderation');
const portalHandler = require('./handlers/portal');
const characterSlotsHandler = require('./handlers/character-slots');
const dungeonHandler = require('./handlers/dungeon');
const dungeonCombatHandler = require('./handlers/dungeon-combat-handler');
const leviathanHandler = require('./handlers/leviathan');
const combatHandler = require('./handlers/combat');
const knowledgeHandler = require('./handlers/knowledge');
const farmingHandler = require('./handlers/farming');
const karmaHandler = require('./handlers/karma');
const factionsHandler = require('./handlers/factions');
const companionsHandler = require('./handlers/companions');
const petsHandler = require('./handlers/pets');
const ascensionHandler = require('./handlers/ascension');
const prisonHandler = require('./handlers/prison');
const afflictionsHandler = require('./handlers/afflictions');
const masteryHandler = require('./handlers/mastery');

// Shared handlers (kept from BossCord era but still used)
const inventoryHandler = require('./handlers/inventory');
const accountsHandler = require('./handlers/accounts');
const friendsHandler = require('./handlers/friends');
const dmsHandler = require('./handlers/dms');
const updateWarningHandler = require('./handlers/update-warning');
const disconnectHandler = require('./handlers/disconnect');
const challengesHandler = require('./handlers/challenges');
const doomHandler = require('./handlers/doom');
const worldSystemsHandler = require('./handlers/world-systems');

// Moderator account keys — loaded from MODERATOR_KEYS env var (comma-separated)
const MODERATORS = new Set(
  (process.env.MODERATOR_KEYS || '').split(',').map(k => k.trim()).filter(Boolean)
);

function isModerator(socketId) {
  const key = socketAccountMap.get(socketId);
  return key && MODERATORS.has(key);
}

/** @type {object|null} */
let _director = null;


// Track account keys linked to sockets: Map<socketId, accountKey>
const socketAccountMap = new Map();

// Track the first connected socket as server host (for offline/LAN admin)
var _serverHostSocketId = null;
var _serverHostAccountKey = null;  // Remember host's account key for reconnection
function isServerHost(socketId) {
  return process.env.OFFLINE_MODE === '1' && socketId === _serverHostSocketId;
}
// Reverse index: Map<accountKey, Set<socketId>> for O(1) lookups by account
const accountSocketMap = new Map();

function _linkSocket(socketId, accountKey) {
  socketAccountMap.set(socketId, accountKey);
  if (!accountSocketMap.has(accountKey)) accountSocketMap.set(accountKey, new Set());
  accountSocketMap.get(accountKey).add(socketId);
}
function _unlinkSocket(socketId) {
  var key = socketAccountMap.get(socketId);
  if (key && accountSocketMap.has(key)) {
    accountSocketMap.get(key).delete(socketId);
    if (accountSocketMap.get(key).size === 0) accountSocketMap.delete(key);
  }
  socketAccountMap.delete(socketId);
}
function _getSocketsForAccount(accountKey) {
  return accountSocketMap.get(accountKey) || new Set();
}

// Session tokens: issued after full auth (PoW + PIN) on default namespace.
// Namespace connections (/games, /market) must present a valid session token.
// Map<token, { accountKey, socketId, ip, createdAt }>
const sessionTokens = new Map();

// Periodic session token cleanup (remove tokens older than 24 hours)
setInterval(function() {
  var now = Date.now();
  var maxAge = 24 * 60 * 60 * 1000;
  for (var _ref of sessionTokens) {
    var _token = _ref[0], _data = _ref[1];
    if (now - _data.createdAt > maxAge) {
      sessionTokens.delete(_token);
    }
  }
}, 60 * 60 * 1000);

// Concurrent connection tracking: Map<ip, Set<socketId>>
const MAX_CONCURRENT_PER_IP = 3;
const ipConnections = new Map();

// ---------------------------------------------------------------------------
// Wire up all Socket.IO event handlers.
// ---------------------------------------------------------------------------
function setupSocket(io) {
  // Load persisted guilds from disk on startup
  guildHandler.loadAllGuilds(state);

  // Load persisted auction listings from disk on startup
  mmoAuctionHandler.loadAuctionListings();

  // Cleanup expired accounts every 6 hours
  setInterval(function() {
    accounts.cleanupExpiredAccounts();
  }, 6 * 60 * 60 * 1000);
  setTimeout(function() { accounts.cleanupExpiredAccounts(); }, 30000);

  // Run background re-encryption once on startup
  setTimeout(function() { accounts.reencryptAccounts(); }, 60000);

  // Broadcast server stats every 30 seconds
  setInterval(function() {
    var stats = {
      online: state.users.size,
      members: accounts.getMemberCount(),
    };
    // Include lich corruption summary if active
    if (_director && _director.getLichDirector) {
      var lichDir = _director.getLichDirector();
      if (lichDir) {
        var corruptedCount = lichDir.getTotalCorruptedChunks();
        if (corruptedCount > 0) {
          stats.corruption = { totalChunks: corruptedCount, hordes: lichDir.getActiveHordes().length };
        }
      }
    }
    io.emit('server_stats', stats);
  }, 30000);

  io.on('connection', async (socket) => {
    // Debug: log Engine.IO transport events (only when DEBUG env var is set)
    if (process.env.DEBUG && socket.conn) {
      const eid = socket.id.substring(0, 8);
      console.log('[eio] ' + eid + ' transport=' + socket.conn.transport.name);
      socket.conn.on('error', function(err) { console.log('[eio] ' + eid + ' ERROR: ' + err); });
      socket.conn.on('close', function(reason) { console.log('[eio] ' + eid + ' CLOSE: ' + reason); });
      socket.conn.on('upgrading', function(t) { console.log('[eio] ' + eid + ' upgrading to ' + t.name); });
      socket.conn.on('upgrade', function(t) { console.log('[eio] ' + eid + ' upgraded to ' + t.name); });
    }
    // Store client IP for rate limiting
    socket._clientIp = ratelimit.getIp(socket);
    const clientIp = socket._clientIp || socket.id;

    ratelimit.incrementConnections();

    // Reject banned IPs
    if (ratelimit.isBanned(clientIp)) {
      ratelimit.decrementConnections();
      socket.emit('error', { message: 'You have been temporarily banned. Try again later.' });
      socket.disconnect(true);
      return;
    }

    // Connection rate limit: max 60 connections per IP per hour
    if (!ratelimit.check(clientIp, 'connect', 60, 3600000)) {
      ratelimit.decrementConnections();
      socket.emit('error', { message: 'Too many connections. Try again later.' });
      socket.disconnect(true);
      return;
    }

    // Concurrent connection cap
    const existingConns = ipConnections.get(clientIp);
    if (existingConns && existingConns.size >= MAX_CONCURRENT_PER_IP) {
      ratelimit.decrementConnections();
      socket.emit('error', { message: 'Too many simultaneous connections.' });
      socket.disconnect(true);
      return;
    }
    if (!ipConnections.has(clientIp)) ipConnections.set(clientIp, new Set());
    ipConnections.get(clientIp).add(socket.id);

    function _removeFromIpTracking() {
      const cs = ipConnections.get(clientIp);
      if (cs) { cs.delete(socket.id); if (cs.size === 0) ipConnections.delete(clientIp); }
    }

    // Proof-of-Work verification
    const powChallenge = socket.handshake.auth && socket.handshake.auth.powChallenge;
    const powNonce = socket.handshake.auth && socket.handshake.auth.powNonce;
    // Skip PoW entirely in offline mode when client signals 'offline'
    const skipPow = process.env.OFFLINE_MODE === '1' && powChallenge === 'offline';
    if (!skipPow) {
      const powResult = pow.verify(powChallenge, powNonce);
      if (!powResult.valid) {
        ratelimit.decrementConnections();
        _removeFromIpTracking();
        socket.emit('error', { message: 'Connection requires proof-of-work. ' + (powResult.error || '') });
        socket.disconnect(true);
        return;
      }
    }

    // Server password check (if SHARD_PASSWORD is set)
    if (process.env.SHARD_PASSWORD) {
      const clientPassword = socket.handshake.auth && socket.handshake.auth.serverPassword;
      if (clientPassword !== process.env.SHARD_PASSWORD) {
        ratelimit.decrementConnections();
        _removeFromIpTracking();
        socket.emit('password_required', { message: 'Server password required' });
        socket.disconnect(true);
        return;
      }
    }

    // ------------------------------------------------------------------
    // Connection: create identity (with optional account key)
    // ------------------------------------------------------------------
    const customName = socket.handshake.auth && socket.handshake.auth.name
      ? socket.handshake.auth.name
      : null;
    const accountKey = socket.handshake.auth && socket.handshake.auth.accountKey
      ? socket.handshake.auth.accountKey
      : null;

    // Reject invalid account keys
    if (accountKey && (accountKey.length < 12 || !/^[a-zA-Z0-9]+$/.test(accountKey))) {
      ratelimit.decrementConnections();
      _removeFromIpTracking();
      socket.emit('error', { message: 'Invalid account key. Keys must be 12+ alphanumeric characters.' });
      socket.disconnect(true);
      return;
    }

    let linkedAccount = null;
    if (accountKey) {
      if (shardBridge.isMasterMode) {
        // Master mode: checkout character from master server
        var authPin = socket.handshake.auth && socket.handshake.auth.pin;
        try {
          linkedAccount = await new Promise(function(resolve, reject) {
            shardBridge.checkoutCharacter(accountKey, authPin, function(err, acc) {
              if (err) return reject(err);
              resolve(acc);
            });
          });
        } catch (checkoutErr) {
          var errMsg = checkoutErr.message || 'Authentication failed';
          if (errMsg.includes('PIN required') || errMsg.includes('Invalid PIN')) {
            ratelimit.decrementConnections();
            _removeFromIpTracking();
            socket.emit('pin_required', { message: 'PIN required for this account' });
            socket.disconnect(true);
            return;
          }
          if (!ratelimit.check(clientIp, 'auth_fail', 5, 900000)) {
            ratelimit.decrementConnections();
            _removeFromIpTracking();
            socket.emit('error', { message: 'Too many failed login attempts. Try again in 15 minutes.' });
            socket.disconnect(true);
            return;
          }
          ratelimit.decrementConnections();
          _removeFromIpTracking();
          socket.emit('error', { message: errMsg });
          socket.disconnect(true);
          return;
        }
      } else {
        // Standalone mode: local account lookup
        linkedAccount = accounts.loadAccount(accountKey);
        if (!linkedAccount) {
          if (!ratelimit.check(clientIp, 'auth_fail', 5, 900000)) {
            ratelimit.decrementConnections();
            _removeFromIpTracking();
            socket.emit('error', { message: 'Too many failed login attempts. Try again in 15 minutes.' });
            socket.disconnect(true);
            return;
          }
        }

        // PIN verification disabled — standalone desktop game, no security benefit.
        // PIN handlers (account_set_pin, account_change_pin) kept for future optional use.
        // if (linkedAccount && !linkedAccount.temp) {
        //   var authPin = socket.handshake.auth && socket.handshake.auth.pin;
        //   if (linkedAccount.pinHash) {
        //     if (!authPin || !(await accounts.verifyPin(authPin, linkedAccount.pinHash))) {
        //       if (!ratelimit.check(clientIp, 'auth_fail', 5, 900000)) {
        //         ratelimit.decrementConnections();
        //         _removeFromIpTracking();
        //         socket.emit('error', { message: 'Too many failed login attempts. Try again in 15 minutes.' });
        //         socket.disconnect(true);
        //         return;
        //       }
        //       ratelimit.decrementConnections();
        //       _removeFromIpTracking();
        //       socket.emit('pin_required', { message: 'PIN required for this account' });
        //       socket.disconnect(true);
        //       return;
        //     }
        //   } else {
        //     if (authPin && typeof authPin === 'string' && authPin.length >= 4 && authPin.length <= 8 && /^[a-zA-Z0-9]+$/.test(authPin)) {
        //       await accounts.setPinForAccount(linkedAccount.key, authPin);
        //       console.log('[auth] ' + linkedAccount.username + ' set PIN during login');
        //     }
        //   }
        // }
      }
    }

    // Enforce one session per account key (O(1) via reverse index)
    if (linkedAccount && accountKey) {
      var existingSockets = _getSocketsForAccount(accountKey);
      for (var existingSocketId of existingSockets) {
        if (existingSocketId !== socket.id) {
          const existingSocket = io.sockets.sockets.get(existingSocketId);
          if (existingSocket && existingSocket.connected) {
            ratelimit.decrementConnections();
            _removeFromIpTracking();
            socket.emit('error', { message: 'This key is already in use in another session.' });
            socket.disconnect(true);
            return;
          }
          _unlinkSocket(existingSocketId);
          break;
        }
      }
    }

    const user = state.createUser(
      socket.id,
      linkedAccount ? (linkedAccount._characterName || linkedAccount.username) : customName,
      linkedAccount ? linkedAccount.username : customName
    );

    // Link account
    if (linkedAccount) {
      user.color = linkedAccount.color;
      user.avatar = linkedAccount.avatar || null;
      user.race = linkedAccount.race || null;
      user.tag = state.generateTag(accountKey);
      _linkSocket(socket.id, accountKey);
      linkedAccount.lastSeen = Date.now();
      accounts.saveAccount(linkedAccount);
    }

    // Auto-create permanent account for new players (key assigned by server)
    if (!linkedAccount) {
      var newAccount;
      if (shardBridge.isMasterMode) {
        try {
          newAccount = await new Promise(function(resolve, reject) {
            shardBridge.createAccountViaMaster(user.name, user.color, function(err, acc) {
              if (err) return reject(err);
              resolve(acc);
            });
          });
        } catch (_) {
          newAccount = accounts.createAccount(user.name, user.color);
        }
      } else {
        newAccount = accounts.createAccount(user.name, user.color);
      }
      if (newAccount) {
        _linkSocket(socket.id, newAccount.key);
        linkedAccount = newAccount;
      }
      if (loot.PROFILE_PORTRAITS && loot.PROFILE_PORTRAITS.length > 0) {
        var randomPortrait = loot.PROFILE_PORTRAITS[Math.floor(Math.random() * loot.PROFILE_PORTRAITS.length)];
        user.avatar = randomPortrait.img || null;
        if (linkedAccount && user.avatar) {
          linkedAccount.avatar = user.avatar;
          linkedAccount.avatarId = randomPortrait.id || null;
          accounts.saveAccount(linkedAccount);
        }
      }
    }

    console.log(`[connect] ${user.name} (${socket.id})${linkedAccount ? (linkedAccount.temp ? ' [TEMP]' : ' [ACCOUNT]') : ''}`);

    // Issue session token for namespace auth
    const sessionToken = crypto.randomBytes(24).toString('hex');
    sessionTokens.set(sessionToken, {
      accountKey: socketAccountMap.get(socket.id) || null,
      socketId: socket.id,
      ip: clientIp,
      createdAt: Date.now(),
    });
    socket._mmoliteSessionToken = sessionToken;

    // Load last location for returning players
    var lastLocation = linkedAccount ? accounts.getLastLocation(linkedAccount.key) : null;

    // Pre-fetch characterList to log and reuse in identity payload
    var _charList = linkedAccount ? accounts.getCharacterList(linkedAccount.key) : null;
    if (_charList) {
      console.log('[socket] Identity characterList: ' + _charList.characters.length + ' chars');
    }

    // Track server host in offline mode.
    // First connect becomes host. If host disconnects and reconnects (same account), restore status.
    if (process.env.OFFLINE_MODE === '1' && !_serverHostSocketId) {
      if (!_serverHostAccountKey || (accountKey && accountKey === _serverHostAccountKey)) {
        _serverHostSocketId = socket.id;
        if (accountKey) _serverHostAccountKey = accountKey;
      }
    }

    // Send identity — MMOLite version with zones instead of rooms
    socket.emit('identity', {
      id: user.id,
      name: user.name,
      color: user.color,
      tag: user.tag,
      avatar: user.avatar || null,
      joinedAt: user.joinedAt,
      sessionToken: sessionToken,
      account: linkedAccount ? {
        key: linkedAccount.key,
        needsPin: !(linkedAccount.pinHash || linkedAccount.hasPin),
        temp: !!linkedAccount.temp,
        chips: linkedAccount.chips,
        coins: linkedAccount.chips,
        stats: linkedAccount.stats,
        createdAt: linkedAccount.createdAt,
        slurFilter: !!linkedAccount.slurFilter,
        avatar: linkedAccount.avatar || null,
        avatarId: linkedAccount.avatarId || null,
        tosAccepted: !!(linkedAccount.metadata && linkedAccount.metadata.tosAccepted),
        level: linkedAccount.level || 1,
        xp: linkedAccount.xp || 0,
        guildId: linkedAccount.guildId || null,
        skills: linkedAccount.skills || {},
        mmoInventory: linkedAccount.mmoInventory || { items: [] },
        equipment: linkedAccount.equipment || { axe: null, pickaxe: null, weapon: null, shield: null, head: null, body: null, accessory: null },
        race: linkedAccount.race || null,
        rpgStats: linkedAccount.rpgStats || null,
        cardSlots: linkedAccount.cardSlots || require('./rpg-data').getCardSlotCount(linkedAccount.level || 1),
        activeCardSlots: linkedAccount.activeCardSlots || require('./rpg-data').getActiveCardSlotCount(linkedAccount.level || 1),
        passiveCardSlots: linkedAccount.passiveCardSlots || require('./rpg-data').getPassiveCardSlotCount(linkedAccount.level || 1),
        pendingPacks: linkedAccount.pendingPacks || 0,
        mount: linkedAccount.mount || null,
        plotId: linkedAccount.plotId || null,
        permadeath: !!linkedAccount.permadeath,
        ascensionMark: !!linkedAccount.ascensionMark,
        ascensionCount: linkedAccount.ascensionCount || 0,
        dungeonProgress: linkedAccount.dungeonProgress || {
          guildMember: false, guildXp: 0, guildRank: 'stone',
          deepestFloor: 0, totalKills: 0, totalDeaths: 0, bossesKilled: 0,
          clearedCaves: {}, activeCave: null,
        },
        characterList: _charList,
      } : null,
      isMod: isModerator(socket.id),
      // MMO: zones instead of rooms
      zones: state.getZoneList(),
      startZone: lastLocation ? lastLocation.zoneId : 'starter_town',
      startPosition: lastLocation ? { x: lastLocation.x, y: lastLocation.y } : null,
      world: {
        timeOfDay: state.world.timeOfDay,
        weather: state.world.weather,
      },
      // Static game data (sent once on connect instead of per zone_state)
      gameData: {
        rarityInfo: require('./rpg-data').RARITY_TIERS,
        skillDefinitions: require('./rpg-data').SKILL_DEFINITIONS,
        statNames: require('./rpg-data').STAT_NAMES,
      },
    });

    // Send server stats
    socket.emit('server_stats', {
      online: state.users.size,
      members: accounts.getMemberCount(),
    });

    // Seasonal visual config
    try {
      var seasonal = require('./seasonal');
      socket.emit('season_visual_update', seasonal.getVisual());
    } catch (_svErr) { /* seasonal not loaded yet */ }

    // Slur filter
    if (linkedAccount && linkedAccount.slurFilter) {
      socket.emit('slur_filter_updated', { enabled: true, pattern: filter.getFilterPattern() });
    }

    // PIN setup prompt for legacy accounts
    if (linkedAccount && !linkedAccount.temp && !linkedAccount.pinHash) {
      socket.emit('pin_setup_required', { message: 'Please set a 4-digit PIN to secure your account' });
    }

    // Notify friends this user came online (O(1) per friend via reverse index)
    if (linkedAccount && !linkedAccount.temp) {
      var friendsData = accounts.getFriendsData(linkedAccount.key);
      if (friendsData && friendsData.friends.length > 0) {
        for (var fi = 0; fi < friendsData.friends.length; fi++) {
          var fk = friendsData.friends[fi].key;
          var friendSockets = _getSocketsForAccount(fk);
          for (var sid of friendSockets) {
            var fs = io.sockets.sockets.get(sid);
            if (fs) fs.emit('friend_status_changed', { key: linkedAccount.key, online: true });
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // Build deps object for handler modules
    // ------------------------------------------------------------------
    function _boundEnrichInventory(key) {
      return enrichInventory(accounts, loot, key);
    }

    const deps = {
      user: user,
      socketAccountMap: socketAccountMap,
      ipConnections: ipConnections,
      accounts: accounts,
      state: state,
      filter: filter,
      ratelimit: ratelimit,
      pow: pow,
      loot: loot,
      checkEventRate: checkEventRate,
      applyRateGrace: applyRateGrace,
      sanitizeText: sanitizeText,
      validateUrl: validateUrl,
      isModerator: isModerator,
      enrichInventory: _boundEnrichInventory,
      MODERATORS: MODERATORS,
      _removeFromIpTracking: _removeFromIpTracking,
      sessionTokens: sessionTokens,
      challengesHandler: challengesHandler,
      directorMetrics: _director ? _director.getMetrics() : null,
      directorMicro: _director ? _director.getMicroDirector() : null,
      directorRaid: _director ? _director.getRaid() : null,
      directorOcean: _director ? _director.getOceanDirector() : null,
      directorLich: _director ? _director.getLichDirector() : null,
      directorRifts: _director ? _director.getRiftsDirector() : null,
      directorWerewolf: _director ? _director.getWerewolfDirector() : null,
      directorVampire: _director ? _director.getVampireDirector() : null,
      getPlayerCombat: dungeonHandler.getPlayerCombat,
      serverRules: shardBridge.config && shardBridge.config.rules ? shardBridge.config.rules : null,
      isServerHost: isServerHost,
      _unlinkSocket: _unlinkSocket,
      getSocketsForAccount: _getSocketsForAccount,
    };

    // ------------------------------------------------------------------
    // Register all handler modules
    // ------------------------------------------------------------------

    // MMO core handlers
    zoneHandler.init(io, socket, deps);
    overworldHandler.init(io, socket, deps);
    partyHandler.init(io, socket, deps);
    monstersHandler.init(io, socket, deps);
    guildHandler.init(io, socket, deps);
    tradeHandler.init(io, socket, deps);
    craftingHandler.init(io, socket, deps);
    placementHandler.init(io, socket, deps);
    plotHandler.init(io, socket, deps);
    mmoModerationHandler.init(io, socket, deps);
    characterCreationHandler.init(io, socket, deps);
    rpgCardsHandler.init(io, socket, deps);
    mmoAuctionHandler.init(io, socket, deps);
    npcShopHandler.init(io, socket, deps);
    cardShopHandler.init(io, socket, deps);
    portalHandler.init(io, socket, deps);
    characterSlotsHandler.init(io, socket, deps);
    dungeonHandler.init(io, socket, deps);
    dungeonCombatHandler.init(io, socket, deps);
    leviathanHandler.init(io, socket, deps);
    combatHandler.init(io, socket, deps);
    knowledgeHandler.init(io, socket, deps);
    farmingHandler.init(io, socket, deps);
    karmaHandler.init(io, socket, deps);
    factionsHandler.init(io, socket, deps);
    companionsHandler.init(io, socket, deps);
    petsHandler.init(io, socket, deps);
    ascensionHandler.init(io, socket, deps);
    prisonHandler.init(io, socket, deps);
    afflictionsHandler.init(io, socket, deps);
    masteryHandler.init(io, socket, deps);

    // Shared handlers
    inventoryHandler.init(io, socket, deps);
    accountsHandler.init(io, socket, deps);
    updateWarningHandler.init(io, socket, deps);
    friendsHandler.init(io, socket, deps);
    dmsHandler.init(io, socket, deps);
    challengesHandler.init(io, socket, deps);
    doomHandler.init(io, socket, deps);
    worldSystemsHandler.init(io, socket, deps);
    disconnectHandler.init(io, socket, deps);

    // TOS acceptance
    socket.on('tos_accept', function() {
      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;
      var acc = accounts.loadAccount(accKey);
      if (!acc || acc.temp) return;
      if (!acc.metadata) acc.metadata = {};
      acc.metadata.tosAccepted = true;
      acc.metadata.tosDate = Date.now();
      accounts.saveAccount(acc);
    });
  });
}

// ---------------------------------------------------------------------------
// Cross-namespace chip update broadcaster
// ---------------------------------------------------------------------------
function broadcastChipsUpdate(io, accountKey, newChips, reason) {
  var sockets = _getSocketsForAccount(accountKey);
  for (var sid of sockets) {
    var s = io.sockets.sockets.get(sid);
    if (s) s.emit('chips_updated', { chips: newChips, reason: reason });
  }
}

function setDirector(director) {
  _director = director;
}

function getSocketAccountMap() { return socketAccountMap; }
module.exports = { setupSocket, socketAccountMap, getSocketAccountMap, MODERATORS, sessionTokens, setDirector };
