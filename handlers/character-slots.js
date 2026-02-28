// handlers/character-slots.js
// Character slot management: list, create, switch, delete.
// Events: character_list, character_create, character_switch, character_delete

var rpgData = require('../rpg-data');

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, state, checkEventRate } = deps;

    // --- character_list: get all characters for this account ---
    socket.on('character_list', function() {
      var key = socketAccountMap.get(socket.id);
      if (!key) { console.log('[char-slots] character_list: no account key for socket ' + socket.id); socket.emit('character_list_result', { error: 'No account' }); return; }

      var result = accounts.getCharacterList(key);
      if (!result) { console.log('[char-slots] character_list: getCharacterList returned null for key ' + key.slice(0,3) + '...'); socket.emit('character_list_result', { error: 'Account not found' }); return; }

      console.log('[char-slots] character_list: returning ' + result.characters.length + ' characters');
      socket.emit('character_list_result', result);
    });

    // --- character_create: create a new character slot ---
    socket.on('character_create', function(data) {
      console.log('[char-slots] character_create received from ' + socket.id + ': ' + JSON.stringify(data));
      var key = socketAccountMap.get(socket.id);
      if (!key) { console.log('[char-slots] character_create: no account key'); socket.emit('character_created', { error: 'No account' }); return; }

      var name = (data && typeof data.name === 'string') ? data.name : 'New Character';
      var permadeath = !!(data && data.permadeath);
      var result = accounts.createCharacter(key, name, { permadeath: permadeath });
      if (result.error) {
        console.log('[char-slots] character_create error: ' + result.error);
        socket.emit('character_created', { error: result.error });
        return;
      }

      // Restore pocket contents from previous permadeath/doom character
      accounts.restorePocketFromLegacy(accounts.loadAccount(key));

      var list = accounts.getCharacterList(key);
      console.log('[char-slots] character_create success: index=' + result.characterIndex + ', total=' + list.characters.length);
      socket.emit('character_created', {
        success: true,
        characterIndex: result.characterIndex,
        characterList: list,
      });
    });

    // --- character_switch: save current, promote target ---
    socket.on('character_switch', function(data) {
      var key = socketAccountMap.get(socket.id);
      if (!key) { socket.emit('character_switch_result', { error: 'No account' }); return; }

      if (!data || typeof data.index !== 'number') {
        socket.emit('character_switch_result', { error: 'Invalid index' });
        return;
      }

      // Leave any active zone before switching
      state.leaveZone(socket.id);

      // Leave old guild room if any
      var acc = accounts.loadAccount(key);
      if (acc && acc.guildId) {
        socket.leave('guild:' + acc.guildId);
      }

      var result = accounts.switchCharacter(key, data.index);
      if (result.error) {
        socket.emit('character_switch_result', { error: result.error });
        return;
      }

      // Reload account with new active character
      acc = accounts.loadAccount(key);
      if (!acc) {
        socket.emit('character_switch_result', { error: 'Failed to reload account' });
        return;
      }

      // Join new character's guild room if any
      if (acc.guildId) {
        socket.join('guild:' + acc.guildId);
      }

      // Update user display name to character name
      if (user) {
        user.name = acc._characterName || acc.username;
        user.username = acc.username;
        user.color = acc.color;
      }

      // Load last location for this character
      var lastLocation = accounts.getLastLocation(key);

      // Re-emit full identity with isCharacterSwitch flag
      socket.emit('identity', {
        id: user ? user.id : socket.id,
        name: user ? user.name : (acc._characterName || acc.username || 'User'),
        color: user ? user.color : (acc.color || '#f0b232'),
        tag: user ? user.tag : '',
        avatar: acc.avatar || null,
        joinedAt: user ? user.joinedAt : Date.now(),
        isCharacterSwitch: true,
        account: {
          key: acc.key,
          needsPin: !(acc.pinHash || acc.hasPin),
          temp: !!acc.temp,
          chips: acc.chips,
          coins: acc.chips,
          stats: acc.stats,
          createdAt: acc.createdAt,
          slurFilter: !!acc.slurFilter,
          avatar: acc.avatar || null,
          avatarId: acc.avatarId || null,
          tosAccepted: !!(acc.metadata && acc.metadata.tosAccepted),
          level: acc.level || 1,
          xp: acc.xp || 0,
          guildId: acc.guildId || null,
          skills: acc.skills || {},
          mmoInventory: acc.mmoInventory || { items: [] },
          equipment: acc.equipment || { axe: null, pickaxe: null },
          race: acc.race || null,
          rpgStats: acc.rpgStats || null,
          cardSlots: acc.cardSlots || rpgData.getCardSlotCount(acc.level || 1),
          activeCardSlots: acc.activeCardSlots || rpgData.getActiveCardSlotCount(acc.level || 1),
          passiveCardSlots: acc.passiveCardSlots || rpgData.getPassiveCardSlotCount(acc.level || 1),
          pendingPacks: acc.pendingPacks || 0,
          mount: acc.mount || null,
          plotId: acc.plotId || null,
          characterList: accounts.getCharacterList(key),
        },
        zones: state.getZoneList(),
        startZone: lastLocation ? lastLocation.zoneId : 'starter_town',
        startPosition: lastLocation ? { x: lastLocation.x, y: lastLocation.y } : null,
        world: {
          timeOfDay: state.world.timeOfDay,
          weather: state.world.weather,
        },
      });
    });

    // --- get_name_lists: client fetches the allowed name parts for rename ---
    socket.on('get_name_lists', function() {
      socket.emit('name_lists', {
        prefixes: state.COLOR_PREFIXES,
        names: state.CHARACTER_NAMES,
      });
    });

    // --- character_rename: rename the selected character via dropdown parts ---
    socket.on('character_rename', function(data) {
      var key = socketAccountMap.get(socket.id);
      if (!key) { socket.emit('character_renamed', { error: 'No account' }); return; }

      if (!data || typeof data.prefix !== 'string' || typeof data.name !== 'string' || typeof data.number !== 'number') {
        socket.emit('character_renamed', { error: 'Invalid rename data' });
        return;
      }

      // Validate parts against allowed lists
      if (state.COLOR_PREFIXES.indexOf(data.prefix) === -1) {
        socket.emit('character_renamed', { error: 'Invalid prefix' });
        return;
      }
      if (state.CHARACTER_NAMES.indexOf(data.name) === -1) {
        socket.emit('character_renamed', { error: 'Invalid name' });
        return;
      }
      var num = Math.floor(data.number);
      if (num < 1 || num > 99) {
        socket.emit('character_renamed', { error: 'Number must be 1-99' });
        return;
      }

      var newName = (data.prefix + ' ' + data.name + ' ' + num).slice(0, 20);

      var acc = accounts.loadAccount(key);
      if (!acc) { socket.emit('character_renamed', { error: 'Account not found' }); return; }

      acc.username = newName;
      acc._characterName = newName;
      accounts.saveAccount(acc);

      // Update live user display name
      if (user) {
        user.name = newName;
      }

      var list = accounts.getCharacterList(key);
      socket.emit('character_renamed', { success: true, newName: newName, characterList: list });
    });

    // --- character_delete: remove a character slot (requires PIN) ---
    socket.on('character_delete', function(data) {
      var key = socketAccountMap.get(socket.id);
      if (!key) { socket.emit('character_deleted', { error: 'No account' }); return; }

      if (!data || typeof data.index !== 'number') {
        socket.emit('character_deleted', { error: 'Invalid index' });
        return;
      }

      var acc = accounts.loadAccount(key);
      if (!acc) { socket.emit('character_deleted', { error: 'Account not found' }); return; }

      // PIN verification for permanent accounts
      if (!acc.temp) {
        if (!acc.pinHash) {
          socket.emit('character_deleted', { error: 'Set a PIN before deleting characters' });
          return;
        }
        if (!data.pin || typeof data.pin !== 'string') {
          socket.emit('character_deleted', { error: 'PIN required to delete a character' });
          return;
        }
        accounts.verifyPin(data.pin, acc.pinHash).then(function(valid) {
          if (!valid) {
            socket.emit('character_deleted', { error: 'Invalid PIN' });
            return;
          }
          _doDelete(key, data.index);
        });
        return;
      }

      _doDelete(key, data.index);

      function _doDelete(accKey, targetIndex) {
        var result = accounts.deleteCharacter(accKey, targetIndex);
        if (result.error) {
          socket.emit('character_deleted', { error: result.error });
          return;
        }
        var list = accounts.getCharacterList(accKey);
        socket.emit('character_deleted', { success: true, characterList: list });
      }
    });

    // --- hall_of_heroes: retrieve fallen permadeath characters ---
    socket.on('hall_of_heroes', function() {
      var key = socketAccountMap.get(socket.id);
      if (!key) { socket.emit('hall_of_heroes_result', { error: 'No account' }); return; }
      var heroes = accounts.getHallOfHeroes(key);
      socket.emit('hall_of_heroes_result', { heroes: heroes });
    });
  },
};
