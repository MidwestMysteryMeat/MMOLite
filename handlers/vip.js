// handlers/vip.js — Shard-side VIP handler
// Mediates between client and master VIP APIs.
// Socket events: vip_status, vip_consume_token, vip_sovereign_shop, vip_sovereign_purchase

var vipPerks = require('../vip-perks');
var vipOverflow = require('../vip-overflow');
var shardBridge = require('../shard-bridge');

// In-memory VIP cache per account key: { status, fetchedAt }
var vipStatusCache = new Map();
var CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Clean stale cache entries every 10 minutes
var _cacheCleanupTimer = setInterval(function() {
  var now = Date.now();
  for (var entry of vipStatusCache) {
    if (now - entry[1].fetchedAt > CACHE_TTL * 2) {
      vipStatusCache.delete(entry[0]);
    }
  }
}, 600000);
_cacheCleanupTimer.unref();

// ---------------------------------------------------------------------------
// Fetch VIP status from master (or cache)
// ---------------------------------------------------------------------------

function getVipStatus(accountKey, callback) {
  var cached = vipStatusCache.get(accountKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return callback(null, cached.status);
  }

  if (!shardBridge.isMasterMode) {
    // Standalone mode — no VIP
    var freeStatus = {
      tier: 'free', expiresAt: 0, sovereignBalance: 0,
      permanentPurchases: {}, tokenInventory: 0,
      perks: vipPerks.buildPerksSummary(null),
    };
    return callback(null, freeStatus);
  }

  shardBridge.masterRequest('GET', '/api/vip/status?accountKey=' + encodeURIComponent(accountKey), null, function(err, data) {
    if (err || !data || !data.success) {
      // On master failure, use last-known cached state (never grant speculatively)
      if (cached) return callback(null, cached.status);
      return callback(err || new Error('VIP status fetch failed'));
    }
    vipStatusCache.set(accountKey, { status: data.vipStatus, fetchedAt: Date.now() });
    callback(null, data.vipStatus);
  });
}

// Synchronous cache read for perk lookups in hot paths.
// Returns cached VIP status or null (treated as free player).
function getCachedVipStatus(accountKey) {
  var cached = vipStatusCache.get(accountKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.status;
  }
  return null;
}

// Invalidate cache for a specific account (after mutations)
function invalidateCache(accountKey) {
  vipStatusCache.delete(accountKey);
}

module.exports = {
  getVipStatus: getVipStatus,
  getCachedVipStatus: getCachedVipStatus,
  invalidateCache: invalidateCache,
  vipStatusCache: vipStatusCache,

  init(io, socket, deps) {
    var { socketAccountMap, accounts, checkEventRate } = deps;

    // --- vip_status: query current VIP state ---
    socket.on('vip_status', function() {
      if (!checkEventRate(socket, 'vip_status', 5, 5000)) return;
      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      getVipStatus(key, function(err, status) {
        if (err) {
          socket.emit('vip_error', { message: 'Could not fetch VIP status' });
          return;
        }
        socket.emit('vip_status_result', status);
      });
    });

    // --- vip_consume_token: use a VIP token ---
    socket.on('vip_consume_token', function() {
      if (!checkEventRate(socket, 'vip_consume_token', 3, 10000)) return;
      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      if (!shardBridge.isMasterMode) {
        socket.emit('vip_error', { message: 'VIP not available in standalone mode' });
        return;
      }

      shardBridge.masterRequest('POST', '/api/vip/consume-token', { accountKey: key }, function(err, data) {
        if (err || !data || !data.success) {
          socket.emit('vip_error', { message: (data && data.error) || 'Token consumption failed' });
          return;
        }
        invalidateCache(key);
        // Clear overflow on reactivation
        var acc = accounts.loadAccount(key);
        if (acc) {
          vipOverflow.clearOverflow(acc);
          accounts.saveAccount(acc);
        }
        socket.emit('vip_token_consumed', {
          success: true,
          tier: data.vipStatus.tier,
          expiresAt: data.vipStatus.expiresAt,
          tokenInventory: data.vipStatus.tokenInventory,
        });
      });
    });

    // --- vip_sovereign_shop: get shop catalog ---
    socket.on('vip_sovereign_shop', function() {
      if (!checkEventRate(socket, 'vip_sovereign_shop', 5, 5000)) return;
      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      getVipStatus(key, function(err, status) {
        if (err) {
          socket.emit('vip_error', { message: 'Could not fetch VIP status' });
          return;
        }
        var catalog = vipPerks.getShopCatalog(status.permanentPurchases);
        socket.emit('vip_sovereign_shop_result', { items: catalog });
      });
    });

    // --- vip_sovereign_purchase: buy from Sovereign shop ---
    socket.on('vip_sovereign_purchase', function(data) {
      if (!checkEventRate(socket, 'vip_sovereign_purchase', 3, 5000)) return;
      if (!data || typeof data.itemId !== 'string') return;
      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      if (!shardBridge.isMasterMode) {
        socket.emit('vip_error', { message: 'VIP not available in standalone mode' });
        return;
      }

      shardBridge.masterRequest('POST', '/api/vip/purchase', { accountKey: key, itemId: data.itemId }, function(err, respData) {
        if (err || !respData || !respData.success) {
          socket.emit('vip_error', { message: (respData && respData.error) || 'Purchase failed' });
          return;
        }
        invalidateCache(key);
        socket.emit('vip_sovereign_purchased', {
          success: true,
          itemId: data.itemId,
          sovereignBalance: respData.sovereignBalance,
          permanentPurchases: respData.permanentPurchases,
        });
      });
    });

    // --- disconnect: clean up cache ---
    socket.on('disconnect', function() {
      var key = socketAccountMap.get(socket.id);
      if (key) {
        // Check if VIP lapsed for overflow
        var cached = vipStatusCache.get(key);
        if (cached && cached.status && cached.status.tier === 'vip' && cached.status.expiresAt <= Date.now()) {
          var acc = accounts.loadAccount(key);
          if (acc) {
            vipOverflow.applyOverflow(acc, cached.status);
            accounts.saveAccount(acc);
          }
        }
      }
    });
  },
};
