// handlers/mmo-moderation.js
// MMO-specific moderation tools for admins.

// Server-side mute store: accKey -> expiry timestamp (ms).
// Keyed by account key so mutes survive reconnects.
var _mutes = new Map();

// Called by zone_chat to enforce server-side mutes.
function isMuted(accKey) {
  var expiry = _mutes.get(accKey);
  if (!expiry) return false;
  if (Date.now() >= expiry) {
    _mutes.delete(accKey);
    return false;
  }
  return true;
}

module.exports = {
  isMuted: isMuted,

  init(io, socket, deps) {
    var { user, state, socketAccountMap, accounts, checkEventRate, isModerator } = deps;

    // --- mod_mute_player: mute a player in zone chat ---
    socket.on('mod_mute_player', function(data) {
      if (!isModerator || !isModerator(socket.id)) {
        socket.emit('mod_error', { message: 'Not authorized' });
        return;
      }
      if (!data || typeof data.targetId !== 'string') return;

      var targetUser = state.users.get(data.targetId);
      if (!targetUser) {
        socket.emit('mod_error', { message: 'Player not found' });
        return;
      }

      var duration = data.duration || 300; // default 5 minutes
      var targetKey = socketAccountMap.get(data.targetId);
      if (targetKey) {
        // Store expiry by account key so mute survives reconnect
        _mutes.set(targetKey, Date.now() + duration * 1000);
      }

      io.to(data.targetId).emit('mod_muted', {
        duration: duration,
        reason: data.reason || 'Muted by moderator',
      });

      socket.emit('mod_action_result', {
        action: 'mute',
        targetId: data.targetId,
        targetName: targetUser.name,
        duration: duration,
      });

      console.log('[mod] ' + user.name + ' muted ' + targetUser.name + ' for ' + duration + 's');
    });

    // --- mod_kick_player: kick a player from server ---
    socket.on('mod_kick_player', function(data) {
      if (!isModerator || !isModerator(socket.id)) {
        socket.emit('mod_error', { message: 'Not authorized' });
        return;
      }
      if (!data || typeof data.targetId !== 'string') return;

      var targetUser = state.users.get(data.targetId);
      if (!targetUser) {
        socket.emit('mod_error', { message: 'Player not found' });
        return;
      }

      io.to(data.targetId).emit('mod_kicked', {
        reason: data.reason || 'Kicked by moderator',
      });

      // Disconnect the target socket
      var targetSocket = io.sockets.sockets.get(data.targetId);
      if (targetSocket) {
        targetSocket.disconnect(true);
      }

      socket.emit('mod_action_result', {
        action: 'kick',
        targetId: data.targetId,
        targetName: targetUser.name,
      });

      console.log('[mod] ' + user.name + ' kicked ' + targetUser.name);
    });

    // --- mod_teleport_player: teleport a player to a zone ---
    socket.on('mod_teleport_player', function(data) {
      if (!isModerator || !isModerator(socket.id)) {
        socket.emit('mod_error', { message: 'Not authorized' });
        return;
      }
      if (!data || typeof data.targetId !== 'string' || typeof data.zoneId !== 'string') return;

      var zone = state.zones.get(data.zoneId);
      if (!zone) {
        socket.emit('mod_error', { message: 'Zone not found' });
        return;
      }

      var targetUser = state.users.get(data.targetId);
      if (!targetUser) {
        socket.emit('mod_error', { message: 'Player not found' });
        return;
      }

      // Force zone transition on target
      var prevZone = state.playerZones.get(data.targetId);
      if (prevZone) {
        var targetSocket = io.sockets.sockets.get(data.targetId);
        if (targetSocket) {
          targetSocket.leave('zone:' + prevZone);
        }
        io.to('zone:' + prevZone).emit('player_left_zone', {
          playerId: data.targetId,
          playerName: targetUser.name,
          zoneId: prevZone,
        });
      }

      if (prevZone) state.leaveZone(data.targetId);
      state.joinZone(data.targetId, data.zoneId, data.x || 0, data.y || 0);

      var targetSock = io.sockets.sockets.get(data.targetId);
      if (targetSock) {
        targetSock.join('zone:' + data.zoneId);
        targetSock.emit('zone_state', state.getZoneState(data.zoneId));
        targetSock.emit('mod_teleported', {
          zoneId: data.zoneId,
          reason: data.reason || 'Teleported by moderator',
        });
      }

      socket.emit('mod_action_result', {
        action: 'teleport',
        targetId: data.targetId,
        targetName: targetUser.name,
        zoneId: data.zoneId,
      });

      console.log('[mod] ' + user.name + ' teleported ' + targetUser.name + ' to ' + data.zoneId);
    });

    // --- admin_update_rules: update server rules (xp rate, drop rate, pvp) ---
    socket.on('admin_update_rules', function(data) {
      // Allow moderators OR the server host (first connected client in offline/LAN mode)
      if (!isModerator(socket.id) && !deps.isServerHost(socket.id)) return;
      if (!data || typeof data !== 'object') return;

      var rules = deps.serverRules;
      if (!rules) {
        rules = {};
        deps.serverRules = rules;
      }

      // Only allow updating specific rule fields
      if (typeof data.xpRate === 'number' && data.xpRate >= 0.5 && data.xpRate <= 5.0) {
        rules.xpRate = data.xpRate;
      }
      if (typeof data.dropRate === 'number' && data.dropRate >= 0.5 && data.dropRate <= 5.0) {
        rules.dropRate = data.dropRate;
      }
      if (typeof data.pvpEnabled === 'boolean') {
        rules.pvpEnabled = data.pvpEnabled;
      }

      // Broadcast updated rules to all connected clients
      io.emit('server_rules_updated', { rules: rules });
      socket.emit('admin_result', { action: 'update_rules', success: true, rules: rules });
    });

    // --- admin_kick_player: admin kick (distinct from mod_kick_player) ---
    socket.on('admin_kick_player', function(data) {
      if (!isModerator(socket.id) && !deps.isServerHost(socket.id)) return;
      if (!data || typeof data.targetId !== 'string') return;

      var targetSocket = io.sockets.sockets.get(data.targetId);
      if (!targetSocket) {
        socket.emit('admin_result', { action: 'kick', success: false, message: 'Player not found' });
        return;
      }

      targetSocket.emit('admin_kicked', { message: data.reason || 'Kicked by server admin' });
      targetSocket.disconnect(true);
      socket.emit('admin_result', { action: 'kick', success: true, targetId: data.targetId });
    });

    // --- admin_shutdown: graceful server shutdown with countdown ---
    socket.on('admin_shutdown', function(data) {
      if (!isModerator(socket.id) && !deps.isServerHost(socket.id)) return;

      // Broadcast shutdown warning
      io.emit('server_shutdown', { message: 'Server is shutting down...', countdown: 5 });

      socket.emit('admin_result', { action: 'shutdown', success: true });

      // Graceful shutdown after 5 seconds — save all accounts first
      setTimeout(function() {
        io.emit('server_shutdown', { message: 'Server closed', countdown: 0 });

        // Save all connected players' accounts before exiting
        try {
          if (socketAccountMap && accounts) {
            socketAccountMap.forEach(function(accKey) {
              try {
                var acc = accounts.loadAccount(accKey);
                if (acc) accounts.saveAccount(acc);
              } catch (e) {
                console.warn('[admin_shutdown] Failed to save account ' + accKey + ':', e.message);
              }
            });
            console.log('[admin_shutdown] All accounts saved');
          }
        } catch (e) {
          console.warn('[admin_shutdown] Account save error:', e.message);
        }

        // Short delay for final socket emissions to flush
        setTimeout(function() {
          process.exit(0);
        }, 500);
      }, 5000);
    });
  }
};
