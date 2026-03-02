// handlers/trade.js
// Player-to-player trading handler.

var challengesHandler = require('./challenges');
var rpgData = require('../rpg-data');

// Per-account trade execution lock: prevents a player from executing two trades simultaneously
var tradeExecLocks = new Set();

module.exports = {
  // Active trades: Map<tradeId, trade>
  _trades: new Map(),

  init(io, socket, deps) {
    var { user, state, socketAccountMap, accounts, checkEventRate, applyRateGrace, getCachedVipStatus } = deps;
    var shardBridge = require('../shard-bridge');
    var trades = this._trades;

    // --- trade_request: initiate a trade ---
    socket.on('trade_request', function(data) {
      if (!data || typeof data.targetId !== 'string') return;
      if (!applyRateGrace(socket, 'trade_request', 12, 10000)) return;

      // Must be in same zone
      var myZone = state.playerZones.get(socket.id);
      var targetZone = state.playerZones.get(data.targetId);
      if (!myZone || myZone !== targetZone) {
        socket.emit('trade_error', { message: 'Target not in your zone' });
        return;
      }

      var tradeId = state.generateId();
      var trade = {
        id: tradeId,
        initiator: socket.id,
        target: data.targetId,
        offers: {},      // socketId -> { items: [], chips: 0 }
        confirmed: {},   // socketId -> boolean
        state: 'pending', // pending, active, confirmed, completed, cancelled
        createdAt: Date.now(),
      };
      trade.offers[socket.id] = { items: [], chips: 0 };
      trade.offers[data.targetId] = { items: [], chips: 0 };
      trade.confirmed[socket.id] = false;
      trade.confirmed[data.targetId] = false;

      trades.set(tradeId, trade);

      io.to(data.targetId).emit('trade_request_received', {
        tradeId: tradeId,
        fromId: socket.id,
        fromName: user.name,
      });

      socket.emit('trade_request_sent', { tradeId: tradeId, targetId: data.targetId });

      // Auto-expire after 30 seconds if not accepted
      trade._expiryTimer = setTimeout(function() {
        var t = trades.get(tradeId);
        if (t && t.state === 'pending') {
          trades.delete(tradeId);
          io.to(socket.id).emit('trade_expired', { tradeId: tradeId });
          io.to(data.targetId).emit('trade_expired', { tradeId: tradeId });
        }
      }, 30000);
      if (trade._expiryTimer && trade._expiryTimer.unref) trade._expiryTimer.unref();
    });

    // --- trade_accept: accept a trade request ---
    socket.on('trade_accept', function(data) {
      if (!data || typeof data.tradeId !== 'string') return;

      var trade = trades.get(data.tradeId);
      if (!trade || trade.state !== 'pending' || trade.target !== socket.id) {
        socket.emit('trade_error', { message: 'Trade not found or not for you' });
        return;
      }

      trade.state = 'active';
      if (trade._expiryTimer) { clearTimeout(trade._expiryTimer); trade._expiryTimer = null; }

      io.to(trade.initiator).emit('trade_started', { tradeId: trade.id });
      socket.emit('trade_started', { tradeId: trade.id });
    });

    // --- trade_offer: update what you're offering ---
    socket.on('trade_offer', function(data) {
      if (!data || typeof data.tradeId !== 'string') return;
      if (!applyRateGrace(socket, 'trade_offer', 20, 3000)) return;

      var trade = trades.get(data.tradeId);
      if (!trade || trade.state !== 'active') return;
      if (socket.id !== trade.initiator && socket.id !== trade.target) return;

      var offerKey = socketAccountMap.get(socket.id);
      if (!offerKey) return;

      // Validate and sanitize offered items against actual inventory
      var validatedItems = [];
      if (Array.isArray(data.items)) {
        var offerAcc = accounts.loadAccount(offerKey);
        var offerInv = accounts.getMMOInventory(offerKey);
        if (!offerAcc || !offerInv) return;

        var receiverId = (socket.id === trade.initiator) ? trade.target : trade.initiator;
        var receiverKey = socketAccountMap.get(receiverId);
        var receiverAcc = receiverKey ? accounts.loadAccount(receiverKey) : null;

        for (var vi = 0; vi < Math.min(data.items.length, 10); vi++) {
          var rawItem = data.items[vi];
          if (!rawItem || typeof rawItem !== 'object') continue;

          if (rawItem.type === 'resource' && typeof rawItem.resource === 'string' && typeof rawItem.amount === 'number') {
            var amt = Math.floor(rawItem.amount);
            if (amt < 1) continue;
            // Validate player actually has this resource in sufficient quantity
            var have = offerInv[rawItem.resource] || 0;
            if (have < amt) amt = have;
            if (amt > 0) {
              validatedItems.push({ type: 'resource', resource: rawItem.resource, amount: amt });
            }
          } else if (rawItem.type === 'card' && typeof rawItem.cardInstanceId === 'string') {
            // Validate card exists in player's inventory
            if (offerAcc.rpgCards) {
              var cardObj = null;
              for (var ci = 0; ci < offerAcc.rpgCards.length; ci++) {
                if (offerAcc.rpgCards[ci].instanceId === rawItem.cardInstanceId) {
                  cardObj = offerAcc.rpgCards[ci];
                  break;
                }
              }
              if (cardObj) {
                // Validate card can be traded to the receiver's race (receiverAcc loaded above the loop)
                if (receiverAcc && receiverAcc.race && !rpgData.canTradeCardToRace(cardObj, receiverAcc.race)) {
                  socket.emit('trade_error', { message: 'That card cannot be traded to a ' + receiverAcc.race + ' character' });
                } else {
                  validatedItems.push({ type: 'card', cardInstanceId: rawItem.cardInstanceId });
                }
              }
            }
          } else if (rawItem.type === 'vip_token' && typeof rawItem.amount === 'number') {
            // VIP token trade — validate sender has tokens via cached VIP status
            var tokenAmt = Math.floor(rawItem.amount);
            if (tokenAmt < 1 || tokenAmt > 10) continue;
            var senderVip = getCachedVipStatus ? getCachedVipStatus(offerKey) : null;
            var senderTokens = senderVip ? (senderVip.tokenInventory || 0) : 0;
            if (senderTokens >= tokenAmt) {
              validatedItems.push({ type: 'vip_token', amount: tokenAmt });
            }
          }
        }
      }

      trade.offers[socket.id].items = validatedItems;

      if (typeof data.chips === 'number' && data.chips >= 0) {
        // Clamp coins to what the player actually has (offerAcc already loaded above)
        var maxChips = offerAcc ? (offerAcc.chips || 0) : 0;
        trade.offers[socket.id].chips = Math.min(Math.floor(data.chips), maxChips);
      }

      // Reset confirmations when offer changes
      trade.confirmed[trade.initiator] = false;
      trade.confirmed[trade.target] = false;

      // Notify other party
      var otherId = (socket.id === trade.initiator) ? trade.target : trade.initiator;
      io.to(otherId).emit('trade_offer_updated', {
        tradeId: trade.id,
        fromId: socket.id,
        offer: trade.offers[socket.id],
      });
    });

    // --- trade_confirm: lock in your offer ---
    socket.on('trade_confirm', function(data) {
      if (!data || typeof data.tradeId !== 'string') return;
      if (!applyRateGrace(socket, 'trade_confirm', 12, 5000)) return;

      var trade = trades.get(data.tradeId);
      if (!trade || trade.state !== 'active') return;
      if (socket.id !== trade.initiator && socket.id !== trade.target) return;

      trade.confirmed[socket.id] = true;

      var otherId = (socket.id === trade.initiator) ? trade.target : trade.initiator;
      io.to(otherId).emit('trade_partner_confirmed', { tradeId: trade.id });

      // If both confirmed, execute trade
      if (trade.confirmed[trade.initiator] && trade.confirmed[trade.target]) {
        // Execute the trade: swap resources, items, cards, and coins between accounts
        var initKey = socketAccountMap.get(trade.initiator);
        var targKey = socketAccountMap.get(trade.target);
        if (!initKey || !targKey) {
          io.to(trade.initiator).emit('trade_error', { message: 'Trade failed: account not found' });
          io.to(trade.target).emit('trade_error', { message: 'Trade failed: account not found' });
          trades.delete(trade.id);
          return;
        }

        // Acquire execution locks on both accounts to prevent double-spend
        if (tradeExecLocks.has(initKey) || tradeExecLocks.has(targKey)) {
          socket.emit('trade_error', { message: 'Transaction in progress, try again' });
          return;
        }
        tradeExecLocks.add(initKey);
        tradeExecLocks.add(targKey);

        try {
          var initOffer = trade.offers[trade.initiator];
          var targOffer = trade.offers[trade.target];

          // ---------------------------------------------------------------
          // RE-VALIDATE all offered items at execution time (C-4 fix).
          // Between offer and confirm, a player could have spent/traded
          // resources elsewhere. Verify everything BEFORE any transfers.
          // ---------------------------------------------------------------
          var initAcc = accounts.loadAccount(initKey);
          var targAcc = accounts.loadAccount(targKey);
          if (!initAcc || !targAcc) {
            io.to(trade.initiator).emit('trade_error', { message: 'Trade failed' });
            io.to(trade.target).emit('trade_error', { message: 'Trade failed' });
            trades.delete(trade.id);
            return;
          }

          // Validate coins for both parties
          if ((initOffer.chips || 0) > (initAcc.chips || 0)) {
            io.to(trade.initiator).emit('trade_error', { message: 'Not enough coins' });
            io.to(trade.target).emit('trade_error', { message: 'Trade failed: partner lacks coins' });
            trades.delete(trade.id);
            return;
          }
          if ((targOffer.chips || 0) > (targAcc.chips || 0)) {
            io.to(trade.target).emit('trade_error', { message: 'Not enough coins' });
            io.to(trade.initiator).emit('trade_error', { message: 'Trade failed: partner lacks coins' });
            trades.delete(trade.id);
            return;
          }

          // Re-validate all offered resources and cards still exist
          function validateOffer(accKey, acc, offer, receiverAcc, label) {
            var inv = accounts.getMMOInventory(accKey);
            if (!inv) return label + ' inventory unavailable';
            var items = offer.items || [];
            var incomingCardCount = 0;
            for (var vi = 0; vi < items.length; vi++) {
              var item = items[vi];
              if (item.type === 'resource' && item.resource && item.amount > 0) {
                var have = inv[item.resource] || 0;
                if (have < item.amount) {
                  return label + ' no longer has enough ' + item.resource.replace(/_/g, ' ');
                }
              } else if (item.type === 'card' && item.cardInstanceId) {
                var cardObj = null;
                if (acc.rpgCards) {
                  for (var ci = 0; ci < acc.rpgCards.length; ci++) {
                    if (acc.rpgCards[ci].instanceId === item.cardInstanceId) {
                      cardObj = acc.rpgCards[ci];
                      break;
                    }
                  }
                }
                if (!cardObj) {
                  return label + ' no longer has an offered card';
                }
                // Re-validate racial trading restrictions
                if (receiverAcc && receiverAcc.race && !rpgData.canTradeCardToRace(cardObj, receiverAcc.race)) {
                  return 'A card cannot be traded to a ' + receiverAcc.race + ' character';
                }
                incomingCardCount++;
              } else if (item.type === 'vip_token' && item.amount > 0) {
                var senderVip = getCachedVipStatus ? getCachedVipStatus(accKey) : null;
                var senderTokens = senderVip ? (senderVip.tokenInventory || 0) : 0;
                if (senderTokens < item.amount) {
                  return label + ' no longer has enough VIP tokens';
                }
              }
            }
            // Check receiver collection cap
            if (incomingCardCount > 0 && receiverAcc) {
              var receiverCards = (receiverAcc.rpgCards || []).length;
              if (receiverCards + incomingCardCount > rpgData.MAX_CARD_COLLECTION) {
                return 'Receiver\'s card collection is full (' + rpgData.MAX_CARD_COLLECTION + ' max)';
              }
            }
            return null; // all valid
          }

          var initValidationError = validateOffer(initKey, initAcc, initOffer, targAcc, 'Initiator');
          if (initValidationError) {
            io.to(trade.initiator).emit('trade_error', { message: 'Trade failed: ' + initValidationError });
            io.to(trade.target).emit('trade_error', { message: 'Trade failed: partner resources changed' });
            trades.delete(trade.id);
            return;
          }
          var targValidationError = validateOffer(targKey, targAcc, targOffer, initAcc, 'Partner');
          if (targValidationError) {
            io.to(trade.target).emit('trade_error', { message: 'Trade failed: ' + targValidationError });
            io.to(trade.initiator).emit('trade_error', { message: 'Trade failed: partner resources changed' });
            trades.delete(trade.id);
            return;
          }

          // ---------------------------------------------------------------
          // All validations passed — proceed with atomic transfers
          // ---------------------------------------------------------------

          // Swap coins — compute net delta per party to avoid crash-window duplication
          var initNetChips = (targOffer.chips || 0) - (initOffer.chips || 0);
          var targNetChips = (initOffer.chips || 0) - (targOffer.chips || 0);
          var initFinalChips = initNetChips !== 0 ? accounts.updateChips(initKey, initNetChips) : ((initAcc || {}).chips || 0);
          var targFinalChips = targNetChips !== 0 ? accounts.updateChips(targKey, targNetChips) : ((targAcc || {}).chips || 0);

          // Swap resources: each offer.items can contain { type: 'resource', resource: 'wood', amount: 5 }
          // or { type: 'card', cardInstanceId: 'xxx' }
          // Collect all card transfers first, then save both accounts once
          var pendingCardTransfers = [];

          function transferItems(fromKey, toKey, items) {
            for (var i = 0; i < items.length; i++) {
              var item = items[i];
              if (item.type === 'resource' && item.resource && item.amount > 0) {
                var removed = accounts.removeResource(fromKey, item.resource, item.amount);
                if (removed !== null) {
                  accounts.addResource(toKey, item.resource, item.amount);
                }
              } else if (item.type === 'card' && item.cardInstanceId) {
                pendingCardTransfers.push({ fromKey: fromKey, toKey: toKey, cardInstanceId: item.cardInstanceId });
              } else if (item.type === 'vip_token' && item.amount > 0) {
                // VIP token transfer — atomic on master
                if (shardBridge.isMasterMode) {
                  shardBridge.masterRequest('POST', '/api/vip/transfer-tokens', {
                    fromKey: fromKey, toKey: toKey, count: item.amount,
                  }, function(tErr, tData) {
                    if (tErr || !tData || !tData.success) {
                      console.error('[trade] VIP token transfer failed:', tErr ? tErr.message : (tData && tData.error));
                    }
                  });
                }
              }
            }
          }

          transferItems(initKey, targKey, initOffer.items || []);
          transferItems(targKey, initKey, targOffer.items || []);

          // Execute card transfers atomically: modify both accounts in memory, then save both
          if (pendingCardTransfers.length > 0) {
            if (initAcc && targAcc) {
              if (!initAcc.rpgCards) initAcc.rpgCards = [];
              if (!targAcc.rpgCards) targAcc.rpgCards = [];
              for (var pci = 0; pci < pendingCardTransfers.length; pci++) {
                var xfer = pendingCardTransfers[pci];
                var srcAcc = xfer.fromKey === initKey ? initAcc : targAcc;
                var dstAcc = xfer.toKey === initKey ? initAcc : targAcc;
                if (!srcAcc.rpgCards || !dstAcc.rpgCards) continue;
                var cardIdx = -1;
                for (var ci = 0; ci < srcAcc.rpgCards.length; ci++) {
                  if (srcAcc.rpgCards[ci].instanceId === xfer.cardInstanceId) {
                    cardIdx = ci;
                    break;
                  }
                }
                if (cardIdx !== -1) {
                  var card = srcAcc.rpgCards.splice(cardIdx, 1)[0];
                  dstAcc.rpgCards.push(card);
                }
              }
              // Save both accounts together — minimizes crash window
              try {
                accounts.saveAccount(initAcc);
                accounts.saveAccount(targAcc);
              } catch (saveErr) {
                console.error('[trade] Card transfer save failed:', saveErr.message);
              }
            }
          }

          trade.state = 'completed';
          trades.delete(trade.id);

          // Send updated inventories
          var initInv = accounts.getMMOInventory(initKey);
          var targInv = accounts.getMMOInventory(targKey);

          io.to(trade.initiator).emit('trade_completed', {
            tradeId: trade.id,
            inventory: initInv,
            coins: initFinalChips,
          });
          io.to(trade.target).emit('trade_completed', {
            tradeId: trade.id,
            inventory: targInv,
            coins: targFinalChips,
          });

          // --- Track daily challenge & achievement progress for trades ---
          var initSocket = io.sockets.sockets.get(trade.initiator);
          var targSocket = io.sockets.sockets.get(trade.target);
          challengesHandler.trackChallengeProgress(accounts, initKey, 'trade', 1);
          challengesHandler.trackChallengeProgress(accounts, targKey, 'trade', 1);
          var initTradeUnlocks = challengesHandler.trackAchievementProgress(accounts, initKey, 'trade', 1, initSocket);
          var targTradeUnlocks = challengesHandler.trackAchievementProgress(accounts, targKey, 'trade', 1, targSocket);
          challengesHandler.emitAchievementUnlocks(initSocket, accounts, initTradeUnlocks);
          challengesHandler.emitAchievementUnlocks(targSocket, accounts, targTradeUnlocks);
        } finally {
          tradeExecLocks.delete(initKey);
          tradeExecLocks.delete(targKey);
        }
      }
    });

    // --- trade_cancel: cancel a trade ---
    socket.on('trade_cancel', function(data) {
      if (!data || typeof data.tradeId !== 'string') return;

      var trade = trades.get(data.tradeId);
      if (!trade) return;
      if (socket.id !== trade.initiator && socket.id !== trade.target) return;

      trade.state = 'cancelled';
      trades.delete(trade.id);

      // Clear execution locks for both parties to prevent orphaned locks (BUG-6)
      var initKey = socketAccountMap.get(trade.initiator);
      var targKey = socketAccountMap.get(trade.target);
      if (initKey) tradeExecLocks.delete(initKey);
      if (targKey) tradeExecLocks.delete(targKey);

      io.to(trade.initiator).emit('trade_cancelled', { tradeId: trade.id, cancelledBy: socket.id });
      io.to(trade.target).emit('trade_cancelled', { tradeId: trade.id, cancelledBy: socket.id });
    });

    // --- disconnect: clean up any active trades involving this socket ---
    socket.on('disconnect', function() {
      // Collect trades to cancel first to avoid mutating the Map during iteration
      var toCancel = [];
      for (var entry of trades) {
        var trade = entry[1];
        if (trade.initiator === socket.id || trade.target === socket.id) {
          toCancel.push(trade);
        }
      }
      for (var ci = 0; ci < toCancel.length; ci++) {
        var t = toCancel[ci];
        var otherId = t.initiator === socket.id ? t.target : t.initiator;
        t.state = 'cancelled';
        trades.delete(t.id);
        io.to(otherId).emit('trade_cancelled', { tradeId: t.id, cancelledBy: socket.id, reason: 'disconnect' });
      }
      tradeExecLocks.delete(socketAccountMap.get(socket.id));
    });
  }
};
