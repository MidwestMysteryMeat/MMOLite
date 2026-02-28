// handlers/accounts.js
// Socket handlers: account_create, account_profile, account_delete,
//                  toggle_slur_filter, leaderboard_get,
//                  gif_favorites_get, gif_favorite_add, gif_favorite_remove,
//                  get_user_profile

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, filter, pow, checkEventRate, applyRateGrace, validateUrl, state } = deps;

    // ------------------------------------------------------------------
    // Account: create
    // ------------------------------------------------------------------
    socket.on('account_create', async (data) => {
      try {
        if (!applyRateGrace(socket, 'account_create', 6, 3600000)) return;
        // Proof-of-Work verification (harder difficulty for account creation)
        const acPowChallenge = data && data.powChallenge;
        const acPowNonce = data && data.powNonce;
        const acPowResult = pow.verify(acPowChallenge, acPowNonce);
        if (!acPowResult.valid) {
          socket.emit('error', { message: 'Account creation requires proof-of-work. ' + (acPowResult.error || '') });
          return;
        }

        const existingKey = socketAccountMap.get(socket.id);

        // If already has a permanent account, reject
        if (existingKey && !accounts.isTempAccount(existingKey)) {
          socket.emit('error', { message: 'Already linked to an account' });
          return;
        }

        // Require a 4-8 character alphanumeric PIN for account security
        var pin = data && data.pin;
        if (!pin || typeof pin !== 'string' || pin.length < 4 || pin.length > 8 || !/^[a-zA-Z0-9]+$/.test(pin)) {
          socket.emit('error', { message: 'A 4-8 character alphanumeric PIN is required to claim your key' });
          return;
        }

        let account;
        if (existingKey && accounts.isTempAccount(existingKey)) {
          // Promote temp account to permanent (preserving chips, stats, inventory, cards, etc.)
          account = accounts.promoteTempAccount(existingKey);
          if (!account) {
            socket.emit('error', { message: 'Failed to claim key' });
            return;
          }
        } else {
          // Fresh creation (fallback)
          account = accounts.createAccount(user.name, user.color);
          if (!account) {
            socket.emit('error', { message: 'Failed to create account' });
            return;
          }
        }

        socketAccountMap.set(socket.id, account.key);
        // Set the PIN for the new account (async scrypt)
        await accounts.setPinForAccount(account.key, pin);
        socket.emit('account_created', {
          key: account.key,
          chips: account.chips,
          stats: account.stats,
          createdAt: account.createdAt,
        });
        console.log(`[account] ${user.name} claimed key (${existingKey ? 'promoted from temp' : 'new'})`);
      } catch (err) {
        console.error('[account_create] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Account: set PIN (for legacy accounts that don't have one)
    // ------------------------------------------------------------------
    socket.on('account_set_pin', async (data) => {
      try {
        var key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('error', { message: 'No account linked' });
          return;
        }
        var acc = accounts.loadAccount(key);
        if (!acc || acc.temp) {
          socket.emit('error', { message: 'Permanent account required' });
          return;
        }
        // Don't allow changing PIN through this handler — only setting for first time
        if (acc.pinHash) {
          socket.emit('error', { message: 'PIN already set' });
          return;
        }
        var pin = data && data.pin;
        if (!pin || typeof pin !== 'string' || pin.length < 4 || pin.length > 8 || !/^[a-zA-Z0-9]+$/.test(pin)) {
          socket.emit('error', { message: 'PIN must be 4-8 alphanumeric characters' });
          return;
        }
        if (await accounts.setPinForAccount(key, pin)) {
          socket.emit('pin_set_success', { message: 'PIN set successfully' });
          console.log('[account] ' + user.name + ' set their account PIN');
        } else {
          socket.emit('error', { message: 'Failed to set PIN' });
        }
      } catch (err) {
        console.error('[account_set_pin] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Account: change PIN (requires current PIN verification)
    // ------------------------------------------------------------------
    socket.on('account_change_pin', async (data) => {
      try {
        var key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'No account linked' }); return; }
        var acc = accounts.loadAccount(key);
        if (!acc || acc.temp) { socket.emit('error', { message: 'Permanent account required' }); return; }
        if (!acc.pinHash) { socket.emit('error', { message: 'No PIN set. Use account_set_pin instead.' }); return; }
        if (!data || typeof data.currentPin !== 'string' || typeof data.newPin !== 'string') {
          socket.emit('error', { message: 'Current PIN and new PIN required' });
          return;
        }
        if (!(await accounts.verifyPin(data.currentPin, acc.pinHash))) {
          socket.emit('error', { message: 'Current PIN is incorrect' });
          return;
        }
        if (!data.newPin || data.newPin.length < 4 || data.newPin.length > 8 || !/^[a-zA-Z0-9]+$/.test(data.newPin)) {
          socket.emit('error', { message: 'New PIN must be 4-8 alphanumeric characters' });
          return;
        }
        if (await accounts.setPinForAccount(key, data.newPin)) {
          socket.emit('pin_changed', { message: 'PIN changed successfully' });
          console.log('[account] ' + user.name + ' changed their PIN');
        } else {
          socket.emit('error', { message: 'Failed to change PIN' });
        }
      } catch (err) {
        console.error('[account_change_pin] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Account: get profile
    // ------------------------------------------------------------------
    socket.on('account_profile', () => {
      try {
        const key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('account_data', null);
          return;
        }
        const account = accounts.loadAccount(key);
        if (!account) {
          socket.emit('account_data', null);
          return;
        }
        socket.emit('account_data', {
          key: account.temp ? undefined : account.key,
          temp: !!account.temp,
          username: account.username,
          color: account.color,
          chips: account.chips,
          stats: account.stats,
          createdAt: account.createdAt,
          slurFilter: !!account.slurFilter,
        });
      } catch (err) {
        console.error('[account_profile] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Account: delete (requires PIN re-authentication)
    // ------------------------------------------------------------------
    socket.on('account_delete', async (data) => {
      try {
        const key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('error', { message: 'No account linked' });
          return;
        }
        // Require PIN re-authentication for this destructive action
        const acc = accounts.loadAccount(key);
        if (acc && acc.pinHash) {
          var pin = data && data.pin;
          if (!pin || !(await accounts.verifyPin(pin, acc.pinHash))) {
            socket.emit('error', { message: 'Enter your PIN to confirm account deletion' });
            return;
          }
        } else if (acc && !acc.pinHash) {
          // Legacy accounts without PIN: require key confirmation
          if (!data || data.confirmKey !== key) {
            socket.emit('error', { message: 'Please confirm your account key to delete this account.' });
            return;
          }
        }
        accounts.deleteAccount(key);
        socketAccountMap.delete(socket.id);
        socket.emit('account_deleted');
        console.log(`[account] ${user.name} deleted their account`);
      } catch (err) {
        console.error('[account_delete] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Slur Filter: toggle on/off
    // ------------------------------------------------------------------
    socket.on('toggle_slur_filter', () => {
      try {
        const key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('error', { message: 'Need an account to use the filter' });
          return;
        }
        const acc = accounts.loadAccount(key);
        if (!acc) return;
        acc.slurFilter = !acc.slurFilter;
        accounts.saveAccount(acc);
        if (acc.slurFilter) {
          socket.emit('slur_filter_updated', { enabled: true, pattern: filter.getFilterPattern() });
        } else {
          socket.emit('slur_filter_updated', { enabled: false, pattern: null });
        }
      } catch (err) {
        console.error('[toggle_slur_filter] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Leaderboard
    // ------------------------------------------------------------------
    socket.on('leaderboard_get', () => {
      try {
        const board = accounts.getLeaderboard(50);
        socket.emit('leaderboard_data', { leaderboard: board });
      } catch (err) {
        console.error('[leaderboard_get] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // GIF Favorites: get
    // ------------------------------------------------------------------
    socket.on('gif_favorites_get', () => {
      try {
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('gif_favorites', { gifs: [] }); return; }
        socket.emit('gif_favorites', { gifs: accounts.getFavoriteGifs(key) });
      } catch (err) {
        console.error('[gif_favorites_get] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // GIF Favorites: add
    // ------------------------------------------------------------------
    socket.on('gif_favorite_add', (data) => {
      try {
        if (!data || typeof data.url !== 'string') return;
        var safeUrl = validateUrl(data.url);
        if (!safeUrl) { socket.emit('error', { message: 'Invalid URL' }); return; }
        var safePreview = data.preview ? validateUrl(data.preview) : safeUrl;
        if (!safePreview) safePreview = safeUrl;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account to save favorites' }); return; }
        const gifs = accounts.addFavoriteGif(key, safeUrl, safePreview);
        if (gifs) socket.emit('gif_favorites', { gifs });
      } catch (err) {
        console.error('[gif_favorite_add] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // GIF Favorites: remove
    // ------------------------------------------------------------------
    socket.on('gif_favorite_remove', (data) => {
      try {
        if (!data || typeof data.url !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) return;
        const gifs = accounts.removeFavoriteGif(key, data.url);
        if (gifs) socket.emit('gif_favorites', { gifs });
      } catch (err) {
        console.error('[gif_favorite_remove] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // User Profile: public profile lookup by tag (Username#ABCD)
    // ------------------------------------------------------------------
    socket.on('get_user_profile', (data) => {
      try {
        if (checkEventRate && !checkEventRate(socket, 'get_user_profile', 2)) return;
        if (!data || typeof data.tag !== 'string') return;

        var fullTag = data.tag;
        var hashIdx = fullTag.lastIndexOf('#');
        if (hashIdx <= 0 || fullTag.length - hashIdx - 1 < 4) {
          // Invalid tag format — try to return basic info from online users
          socket.emit('user_profile', { username: fullTag, tag: fullTag, color: '#dcddde' });
          return;
        }

        var tagName = fullTag.slice(0, hashIdx).trim();
        var tagDisc = fullTag.slice(hashIdx + 1).trim();

        // Try to find a permanent account by tag
        var targetKey = accounts.findAccountByTag(tagName, tagDisc);
        if (targetKey) {
          var acc = accounts.loadAccount(targetKey);
          if (acc) {
            var stats = acc.stats || {};
            var cards = acc.cards || [];
            var createdAt = acc.createdAt || Date.now();
            var now = Date.now();
            var ageDays = Math.floor((now - createdAt) / (24 * 60 * 60 * 1000));
            var ageText;
            if (ageDays < 1) {
              ageText = 'Member since today';
            } else if (ageDays === 1) {
              ageText = 'Member for 1 day';
            } else {
              ageText = 'Member for ' + ageDays + ' days';
            }

            socket.emit('user_profile', {
              username: acc.username,
              tag: fullTag,
              color: acc.color || '#f0b232',
              chips: acc.chips || 0,
              accountAge: ageText,
              gamesPlayed: stats.gamesPlayed || 0,
              gamesWon: stats.wins || 0,
              totalMessages: stats.messagesPosted || 0,
              tcgCardsOwned: cards.length,
              achievements: [],
            });
            return;
          }
        }

        // No permanent account found — look for the user among online users
        // by matching username and tag discriminator
        var found = false;
        for (var [sid, u] of state.users) {
          if (u.name === tagName && u.tag === tagDisc) {
            socket.emit('user_profile', {
              username: u.name,
              tag: fullTag,
              color: u.color || '#dcddde',
              chips: null,
              accountAge: 'Guest',
              gamesPlayed: 0,
              gamesWon: 0,
              totalMessages: 0,
              tcgCardsOwned: 0,
              achievements: [],
            });
            found = true;
            break;
          }
        }

        if (!found) {
          // Return basic info from the tag itself
          socket.emit('user_profile', {
            username: tagName,
            tag: fullTag,
            color: '#dcddde',
            chips: null,
            accountAge: 'Unknown',
            gamesPlayed: 0,
            gamesWon: 0,
            totalMessages: 0,
            tcgCardsOwned: 0,
            achievements: [],
          });
        }
      } catch (err) {
        console.error('[get_user_profile] Error:', err.message);
      }
    });
  }
};
