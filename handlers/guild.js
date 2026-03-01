// handlers/guild.js
// Guild/clan system — persistent social groups.

var fs = require('fs');
var path = require('path');
var challengesHandler = require('./challenges');
var rpgData = require('../rpg-data');

// Per-guild vault operation lock: prevents concurrent deposit/withdraw race conditions
var vaultLocks = new Set();
// Per-guild join lock: prevents concurrent join race (member overflow)
var guildJoinLocks = new Set();

// ---------------------------------------------------------------------------
// Guild Persistence
// ---------------------------------------------------------------------------

var GUILDS_DIR = path.join(__dirname, '..', 'data', 'guilds');
var _pendingGuildSaves = new Map(); // guildId -> timeout handle
var GUILD_SAVE_DEBOUNCE_MS = 1000;

try { fs.mkdirSync(GUILDS_DIR, { recursive: true }); } catch (e) { /* ignore */ }

function saveGuild(guild) {
  var guildId = guild.id;
  if (_pendingGuildSaves.has(guildId)) {
    clearTimeout(_pendingGuildSaves.get(guildId));
  }
  _pendingGuildSaves.set(guildId, setTimeout(function() {
    _pendingGuildSaves.delete(guildId);
    var fp = path.join(GUILDS_DIR, guildId + '.json');
    var data = JSON.stringify(guild);
    fs.writeFile(fp, data, function(err) {
      if (err) console.error('[guild] Save failed:', err.message);
    });
  }, GUILD_SAVE_DEBOUNCE_MS));
}

function deleteGuildFile(guildId) {
  var fp = path.join(GUILDS_DIR, guildId + '.json');
  fs.unlink(fp, function(err) {
    if (err && err.code !== 'ENOENT') console.error('[guild] Delete failed:', err.message);
  });
}

function loadAllGuilds(state) {
  try {
    var files = fs.readdirSync(GUILDS_DIR);
    var loaded = 0;
    for (var i = 0; i < files.length; i++) {
      if (!files[i].endsWith('.json')) continue;
      try {
        var fp = path.join(GUILDS_DIR, files[i]);
        var guild = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (guild && guild.id) {
          state.guilds.set(guild.id, guild);
          loaded++;
        }
      } catch (err) {
        console.error('[guild] Failed to load ' + files[i] + ':', err.message);
      }
    }
    if (loaded > 0) console.log('[guild] Loaded ' + loaded + ' guilds from disk');
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[guild] loadAllGuilds error:', err.message);
  }
}

module.exports = {
  loadAllGuilds: loadAllGuilds,

  init(io, socket, deps) {
    var { user, state, socketAccountMap, accounts, checkEventRate } = deps;

    // --- guild_create: create a new guild ---
    socket.on('guild_create', function(data) {
      if (!data || typeof data.name !== 'string') return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      // Check if already in a guild
      if (acc.guildId) {
        socket.emit('guild_error', { message: 'Already in a guild. Leave first.' });
        return;
      }

      var guildName = state.sanitizeText(data.name).slice(0, 32);
      if (guildName.length < 2) {
        socket.emit('guild_error', { message: 'Guild name too short' });
        return;
      }

      var guildId = state.generateId();
      var guild = {
        id: guildId,
        name: guildName,
        leaderId: key,
        leaderName: acc.username,
        members: [{ key: key, name: acc.username, role: 'leader', joinedAt: Date.now() }],
        maxMembers: 50,
        createdAt: Date.now(),
        description: (data.description ? state.sanitizeText(data.description).slice(0, 200) : ''),
        vault: { cards: [], resources: {} },
      };

      state.guilds.set(guildId, guild);
      saveGuild(guild);
      acc.guildId = guildId;
      accounts.saveAccount(acc);

      socket.join('guild:' + guildId);
      socket.emit('guild_created', {
        guildId: guildId,
        name: guildName,
        members: guild.members,
      });

      // --- Track guild join achievement (creating counts as joining) ---
      var guildCreateKey = socketAccountMap.get(socket.id);
      if (guildCreateKey) {
        var guildCreateUnlocks = challengesHandler.trackAchievementProgress(accounts, guildCreateKey, 'guild_join', 1, socket);
        challengesHandler.emitAchievementUnlocks(socket, accounts, guildCreateUnlocks);
      }
    });

    // --- guild_list: list all guilds ---
    socket.on('guild_list', function() {

      var result = [];
      for (var entry of state.guilds) {
        var g = entry[1];
        result.push({
          id: g.id,
          name: g.name,
          leaderName: g.leaderName,
          memberCount: g.members.length,
          maxMembers: g.maxMembers,
          description: g.description,
        });
      }
      socket.emit('guild_list_result', { guilds: result });
    });

    // --- guild_join: request to join a guild ---
    socket.on('guild_join', function(data) {
      if (!data || typeof data.guildId !== 'string') return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      if (acc.guildId) {
        socket.emit('guild_error', { message: 'Already in a guild' });
        return;
      }

      var guild = state.guilds.get(data.guildId);
      if (!guild) {
        socket.emit('guild_error', { message: 'Guild not found' });
        return;
      }

      // Lock guild to prevent concurrent join race (member overflow)
      if (guildJoinLocks.has(data.guildId)) {
        socket.emit('guild_error', { message: 'Guild is busy, try again' });
        return;
      }
      guildJoinLocks.add(data.guildId);
      try {
        if (guild.members.length >= guild.maxMembers) {
          socket.emit('guild_error', { message: 'Guild is full' });
          return;
        }

        guild.members.push({ key: key, name: acc.username, role: 'member', joinedAt: Date.now() });
        saveGuild(guild);
        acc.guildId = guild.id;
        accounts.saveAccount(acc);

        socket.join('guild:' + guild.id);

        io.to('guild:' + guild.id).emit('guild_updated', {
          guildId: guild.id,
          members: guild.members.map(function(m) { return { name: m.name, role: m.role }; }),
          event: acc.username + ' joined the guild',
        });

        // --- Track guild join achievement ---
        var guildJoinUnlocks = challengesHandler.trackAchievementProgress(accounts, key, 'guild_join', 1, socket);
        challengesHandler.emitAchievementUnlocks(socket, accounts, guildJoinUnlocks);
      } finally {
        guildJoinLocks.delete(data.guildId);
      }
    });

    // --- guild_leave: leave current guild ---
    socket.on('guild_leave', function() {

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc || !acc.guildId) {
        socket.emit('guild_error', { message: 'Not in a guild' });
        return;
      }

      var guild = state.guilds.get(acc.guildId);
      if (!guild) {
        acc.guildId = null;
        accounts.saveAccount(acc);
        return;
      }

      // Remove from members
      guild.members = guild.members.filter(function(m) { return m.key !== key; });

      socket.leave('guild:' + guild.id);

      // Disband if leader leaves and no members remain
      if (guild.leaderId === key) {
        if (guild.members.length > 0) {
          guild.leaderId = guild.members[0].key;
          guild.members[0].role = 'leader';
          guild.leaderName = guild.members[0].name;
          saveGuild(guild);
        } else {
          // Cancel any pending debounced save before deleting
          if (_pendingGuildSaves.has(guild.id)) {
            clearTimeout(_pendingGuildSaves.get(guild.id));
            _pendingGuildSaves.delete(guild.id);
          }
          state.guilds.delete(guild.id);
          deleteGuildFile(guild.id);
        }
      } else {
        saveGuild(guild);
      }

      acc.guildId = null;
      accounts.saveAccount(acc);

      socket.emit('guild_left', { guildId: guild.id });

      if (state.guilds.has(guild.id)) {
        io.to('guild:' + guild.id).emit('guild_updated', {
          guildId: guild.id,
          members: guild.members.map(function(m) { return { name: m.name, role: m.role }; }),
          event: acc.username + ' left the guild',
        });
      }
    });

    // --- guild_chat: send message to guild ---
    socket.on('guild_chat', function(data) {
      if (!data || typeof data.message !== 'string') return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc || !acc.guildId) return;

      var content = state.sanitizeText(data.message).slice(0, 200);
      if (content.length === 0) return;

      io.to('guild:' + acc.guildId).emit('guild_message', {
        authorId: socket.id,
        authorName: acc.username,
        authorColor: acc.color || user.color,
        content: content,
        timestamp: Date.now(),
      });
    });

    // --- guild_vault_browse: view guild vault contents ---
    socket.on('guild_vault_browse', function() {

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc || !acc.guildId) {
        socket.emit('guild_error', { message: 'Not in a guild' });
        return;
      }

      var guild = state.guilds.get(acc.guildId);
      if (!guild) return;

      if (!guild.vault) guild.vault = { cards: [], resources: {} };

      socket.emit('guild_vault_contents', {
        guildId: guild.id,
        cards: guild.vault.cards,
        resources: guild.vault.resources,
      });
    });

    // --- guild_vault_deposit: deposit cards or resources into guild vault ---
    socket.on('guild_vault_deposit', function(data) {
      if (!data) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc || !acc.guildId) {
        socket.emit('guild_error', { message: 'Not in a guild' });
        return;
      }

      var guild = state.guilds.get(acc.guildId);
      if (!guild) return;

      // Acquire vault lock to prevent concurrent mutations
      if (vaultLocks.has(guild.id)) {
        socket.emit('guild_error', { message: 'Vault is busy, try again' });
        return;
      }
      vaultLocks.add(guild.id);

      try {
        if (!guild.vault) guild.vault = { cards: [], resources: {} };

        // Deposit a resource
        if (data.type === 'resource' && typeof data.resource === 'string' && typeof data.amount === 'number' && data.amount > 0) {
          var amt = Math.min(999999, Math.max(1, Math.floor(data.amount)));
          var removed = accounts.removeResource(key, data.resource, amt);
          if (removed === null) {
            socket.emit('guild_error', { message: 'Not enough ' + data.resource });
            return;
          }
          guild.vault.resources[data.resource] = (guild.vault.resources[data.resource] || 0) + amt;
          saveGuild(guild);

          io.to('guild:' + guild.id).emit('guild_vault_updated', {
            guildId: guild.id,
            event: acc.username + ' deposited ' + amt + ' ' + data.resource,
            resources: guild.vault.resources,
            cards: guild.vault.cards,
          });
          return;
        }

        // Deposit a card
        if (data.type === 'card' && typeof data.cardInstanceId === 'string') {
          if (!acc.rpgCards) {
            socket.emit('guild_error', { message: 'No cards to deposit' });
            return;
          }

          // Cannot deposit equipped cards
          if (acc.equippedCards) {
            for (var j = 0; j < acc.equippedCards.length; j++) {
              if (acc.equippedCards[j] === data.cardInstanceId) {
                socket.emit('guild_error', { message: 'Unequip card before depositing' });
                return;
              }
            }
          }

          var cardIdx = -1;
          for (var i = 0; i < acc.rpgCards.length; i++) {
            if (acc.rpgCards[i].instanceId === data.cardInstanceId) {
              cardIdx = i;
              break;
            }
          }
          if (cardIdx === -1) {
            socket.emit('guild_error', { message: 'Card not found' });
            return;
          }

          var MAX_VAULT_CARDS = 500;
          if (guild.vault.cards.length >= MAX_VAULT_CARDS) {
            socket.emit('guild_error', { message: 'Guild vault is full (max ' + MAX_VAULT_CARDS + ' cards).' });
            return;
          }
          var card = acc.rpgCards.splice(cardIdx, 1)[0];
          card.depositedBy = key;
          guild.vault.cards.push(card);
          accounts.saveAccount(acc);
          saveGuild(guild);

          io.to('guild:' + guild.id).emit('guild_vault_updated', {
            guildId: guild.id,
            event: acc.username + ' deposited card: ' + card.name,
            resources: guild.vault.resources,
            cards: guild.vault.cards,
          });
          return;
        }

        socket.emit('guild_error', { message: 'Invalid deposit request' });
      } finally {
        vaultLocks.delete(guild.id);
      }
    });

    // --- guild_vault_withdraw: withdraw from guild vault (officer+ only) ---
    socket.on('guild_vault_withdraw', function(data) {
      if (!data) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc || !acc.guildId) {
        socket.emit('guild_error', { message: 'Not in a guild' });
        return;
      }

      var guild = state.guilds.get(acc.guildId);
      if (!guild) return;

      // Check rank: only leader or officer can withdraw
      var member = null;
      for (var m = 0; m < guild.members.length; m++) {
        if (guild.members[m].key === key) { member = guild.members[m]; break; }
      }
      if (!member || (member.role !== 'leader' && member.role !== 'officer')) {
        socket.emit('guild_error', { message: 'Only officers and leaders can withdraw from vault' });
        return;
      }

      // Acquire vault lock to prevent concurrent mutations
      if (vaultLocks.has(guild.id)) {
        socket.emit('guild_error', { message: 'Vault is busy, try again' });
        return;
      }
      vaultLocks.add(guild.id);

      try {
        if (!guild.vault) guild.vault = { cards: [], resources: {} };

        // Withdraw resource
        if (data.type === 'resource' && typeof data.resource === 'string' && typeof data.amount === 'number' && data.amount > 0) {
          var amt = Math.min(999999, Math.max(1, Math.floor(data.amount)));
          var available = guild.vault.resources[data.resource] || 0;
          if (available < amt) {
            socket.emit('guild_error', { message: 'Vault does not have enough ' + data.resource });
            return;
          }
          var addResult = accounts.addResource(key, data.resource, amt);
          if (!addResult || addResult.error) {
            socket.emit('guild_error', { message: addResult && addResult.error ? addResult.error : 'Could not add resource' });
            return;
          }
          guild.vault.resources[data.resource] -= amt;
          if (guild.vault.resources[data.resource] <= 0) delete guild.vault.resources[data.resource];
          saveGuild(guild);

          io.to('guild:' + guild.id).emit('guild_vault_updated', {
            guildId: guild.id,
            event: acc.username + ' withdrew ' + amt + ' ' + data.resource,
            resources: guild.vault.resources,
            cards: guild.vault.cards,
          });
          return;
        }

        // Withdraw card
        if (data.type === 'card' && typeof data.cardInstanceId === 'string') {
          var cardIdx = -1;
          for (var ci = 0; ci < guild.vault.cards.length; ci++) {
            if (guild.vault.cards[ci].instanceId === data.cardInstanceId) {
              cardIdx = ci;
              break;
            }
          }
          if (cardIdx === -1) {
            socket.emit('guild_error', { message: 'Card not found in vault' });
            return;
          }

          if (!acc.rpgCards) acc.rpgCards = [];
          if (acc.rpgCards.length >= rpgData.MAX_CARD_COLLECTION) {
            socket.emit('guild_error', { message: 'Card collection full (' + rpgData.MAX_CARD_COLLECTION + ' max)' });
            return;
          }
          var card = guild.vault.cards.splice(cardIdx, 1)[0];
          delete card.depositedBy;
          acc.rpgCards.push(card);
          accounts.saveAccount(acc);
          saveGuild(guild);

          io.to('guild:' + guild.id).emit('guild_vault_updated', {
            guildId: guild.id,
            event: acc.username + ' withdrew card: ' + card.name,
            resources: guild.vault.resources,
            cards: guild.vault.cards,
          });
          return;
        }

        socket.emit('guild_error', { message: 'Invalid withdraw request' });
      } finally {
        vaultLocks.delete(guild.id);
      }
    });
  }
};
