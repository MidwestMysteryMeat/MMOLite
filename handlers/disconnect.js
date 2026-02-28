// handlers/disconnect.js
// Socket handler: disconnect (full cleanup including friend offline notifications)

const { clearSocketCooldowns } = require('./helpers');

module.exports = {
  init(io, socket, deps) {
    var { socketAccountMap, accounts, state, _removeFromIpTracking, ratelimit, sessionTokens, _unlinkSocket, getSocketsForAccount, directorLich } = deps;
    var shardBridge;
    try { shardBridge = require('../shard-bridge'); } catch (_) { shardBridge = null; }

    socket.on('disconnect', (reason) => {
      try {
        ratelimit.decrementConnections();
        _removeFromIpTracking();

        const disconnectingUser = state.users.get(socket.id);
        if (!disconnectingUser) {
          console.log(`[disconnect] Unknown socket ${socket.id} (${reason})`);
          return;
        }

        const accKey = socketAccountMap.get(socket.id);
        const wasTemp = accKey ? accounts.isTempAccount(accKey) : true;

        // Notify friends this user went offline (O(1) per friend via reverse index)
        if (accKey && !wasTemp) {
          try {
            var friendsData = accounts.getFriendsData(accKey);
            if (friendsData && friendsData.friends.length > 0) {
              for (var fi = 0; fi < friendsData.friends.length; fi++) {
                var fk = friendsData.friends[fi].key;
                var friendSockets = getSocketsForAccount ? getSocketsForAccount(fk) : new Set();
                for (var sid of friendSockets) {
                  if (sid !== socket.id) {
                    var fSocket = io.sockets.sockets.get(sid);
                    if (fSocket) fSocket.emit('friend_status_changed', { key: accKey, online: false });
                  }
                }
              }
            }
          } catch (_) {}
        }

        if (accKey) {
          if (wasTemp) {
            accounts.deleteAccount(accKey);
          } else {
            const acc = accounts.loadAccount(accKey);
            if (acc) {
              acc.lastSeen = Date.now();
              if (acc.dms) acc.dms = { conversations: {} };
              accounts.saveAccount(acc);
            }
            // Checkin character back to master server
            if (shardBridge && shardBridge.isMasterMode) {
              shardBridge.checkinCharacter(accKey, function(err) {
                if (err) console.error('[disconnect] Checkin failed:', err.message);
              });
            }
          }
          // Clean up both socketAccountMap and accountSocketMap reverse index (C-5 fix).
          // Previously only socketAccountMap was cleared, leaving a dead socket ID
          // in accountSocketMap which caused "already connected" lockout on reconnect.
          if (typeof _unlinkSocket === 'function') {
            _unlinkSocket(socket.id);
          } else {
            socketAccountMap.delete(socket.id);
          }
        }

        // Clean up session token (O(1) via stored reference)
        if (sessionTokens && socket._mmoliteSessionToken) {
          sessionTokens.delete(socket._mmoliteSessionToken);
          socket._mmoliteSessionToken = null;
        }

        // Clean up survival visited chunks to prevent memory leak
        if (accKey && state._survivalVisitedChunks) {
          state._survivalVisitedChunks.delete(accKey);
        }

        const userName = disconnectingUser.name;

        // Leave current zone and broadcast to zone members
        var currentZoneId = state.playerZones.get(socket.id);
        if (currentZoneId) {
          socket.to('zone:' + currentZoneId).emit('player_left_zone', {
            playerId: socket.id,
            playerName: userName,
            zoneId: currentZoneId,
          });
        }

        // Leave party
        var party = state.getPlayerParty(socket.id);
        if (party) {
          party.members.delete(socket.id);
          socket.leave('party:' + party.id);
          if (party.leader === socket.id) {
            if (party.members.size > 0) {
              party.leader = party.members.values().next().value;
            } else {
              state.parties.delete(party.id);
            }
          }
          if (state.parties.has(party.id)) {
            var memberList = [];
            for (var memberId of party.members) {
              var u = state.users.get(memberId);
              if (u) memberList.push({ id: u.id, name: u.name, color: u.color });
            }
            io.to('party:' + party.id).emit('party_updated', {
              partyId: party.id,
              leader: party.leader,
              members: memberList,
              event: userName + ' disconnected',
            });
          }
        }

        // Clean up active battles — collect IDs first to avoid mutating Map during iteration
        var battleIdsToEnd = [];
        for (var [battleId, battle] of state.activeBattles) {
          var isParticipant = false;
          for (var bi = 0; bi < battle.participants.length; bi++) {
            if (battle.participants[bi].socketId === socket.id) { isParticipant = true; break; }
          }
          if (isParticipant) {
            battle.state = 'finished';
            for (var bj = 0; bj < battle.participants.length; bj++) {
              if (battle.participants[bj].socketId !== socket.id) {
                io.to(battle.participants[bj].socketId).emit('battle_end', {
                  battleId: battleId,
                  reason: 'opponent_disconnected',
                });
              }
            }
            battleIdsToEnd.push(battleId);
          }
        }
        for (var ei = 0; ei < battleIdsToEnd.length; ei++) {
          state.endBattle(battleIdsToEnd[ei]);
        }

        // Clean up lich corruption debuff timer
        if (directorLich && directorLich.clearDebuffTimer) {
          directorLich.clearDebuffTimer(socket.id);
        }

        // Clean up graceful rate-limit cooldowns
        clearSocketCooldowns(socket.id);

        state.removeUser(socket.id);

        console.log(`[disconnect] ${userName} (${socket.id}) -- ${reason}`);
      } catch (err) {
        console.error('[disconnect] Error during cleanup:', err.message);
        try { state.removeUser(socket.id); } catch (_) {}
      }
    });
  }
};
