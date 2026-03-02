// master-server/vip.js — VIP State Authority
// All VIP state lives on the master server. One JSON file per account key in data/vip/.
// Encrypted AES-256-GCM with write-behind cache (same pattern as accounts).

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var dataDir = require('../data-dir');
var vipPerks = require('../vip-perks');

// ---------------------------------------------------------------------------
// Encryption — reuse parent accounts module key chain
// ---------------------------------------------------------------------------

var ENCRYPTION_KEYS = [];
var CURRENT_VERSION = 0;
var KEYS_FILE = process.env.MMOLITE_KEYS_FILE || '/etc/mmolite/account_secrets.json';

try {
  if (fs.existsSync(KEYS_FILE)) {
    var _keysConfig = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    if (_keysConfig.keys && Array.isArray(_keysConfig.keys) && _keysConfig.keys.length > 0) {
      CURRENT_VERSION = typeof _keysConfig.current === 'number' ? _keysConfig.current : 0;
      for (var i = 0; i < _keysConfig.keys.length; i++) {
        var entry = _keysConfig.keys[i];
        if (typeof entry.version === 'number' && typeof entry.secret === 'string') {
          ENCRYPTION_KEYS.push({
            version: entry.version,
            key: crypto.createHash('sha256').update(entry.secret).digest(),
          });
        }
      }
      if (ENCRYPTION_KEYS.length > 0) {
        console.log('[vip] Loaded ' + ENCRYPTION_KEYS.length + ' encryption keys, current version: ' + CURRENT_VERSION);
      }
    }
  }
} catch (err) {
  console.error('[vip] Failed to load encryption keys:', err.message);
}

// Fallback to env var (matches accounts.js fallback chain)
if (ENCRYPTION_KEYS.length === 0) {
  var _secret = process.env.ACCOUNT_SECRET || null;
  if (!_secret) {
    console.error('[vip] No ACCOUNT_SECRET env var and no keys file at ' + KEYS_FILE);
    _secret = 'dev-vip-secret-key-32-bytes-pad!';
  }
  var keyBuf = crypto.createHash('sha256').update(_secret).digest();
  ENCRYPTION_KEYS.push({ version: 0, key: keyBuf });
}

function _getCurrentKey() {
  for (var i = 0; i < ENCRYPTION_KEYS.length; i++) {
    if (ENCRYPTION_KEYS[i].version === CURRENT_VERSION) return ENCRYPTION_KEYS[i];
  }
  return ENCRYPTION_KEYS[0];
}

function _encryptData(plaintext) {
  var currentKey = _getCurrentKey();
  var iv = crypto.randomBytes(12);
  var cipher = crypto.createCipheriv('aes-256-gcm', currentKey.key, iv);
  var encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  var authTag = cipher.getAuthTag();
  if (CURRENT_VERSION === 0) {
    return Buffer.concat([iv, authTag, encrypted]);
  }
  var vByte = Buffer.alloc(1);
  vByte[0] = currentKey.version;
  return Buffer.concat([vByte, iv, authTag, encrypted]);
}

function _decryptData(buffer) {
  if (buffer.length < 29) return null;

  // Try versioned format
  var firstByte = buffer[0];
  for (var i = 0; i < ENCRYPTION_KEYS.length; i++) {
    if (ENCRYPTION_KEYS[i].version === firstByte && firstByte > 0) {
      try {
        var iv = buffer.slice(1, 13);
        var authTag = buffer.slice(13, 29);
        var ciphertext = buffer.slice(29);
        var decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEYS[i].key, iv);
        decipher.setAuthTag(authTag);
        var decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return decrypted.toString('utf8');
      } catch (_) { continue; }
    }
  }

  // Try legacy format (no version byte)
  for (var j = 0; j < ENCRYPTION_KEYS.length; j++) {
    try {
      var legIv = buffer.slice(0, 12);
      var legTag = buffer.slice(12, 28);
      var legCipher = buffer.slice(28);
      var legDecipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEYS[j].key, legIv);
      legDecipher.setAuthTag(legTag);
      var legDecrypted = Buffer.concat([legDecipher.update(legCipher), legDecipher.final()]);
      return legDecrypted.toString('utf8');
    } catch (_) { continue; }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Storage — file-based with write-behind cache
// ---------------------------------------------------------------------------

var VIP_DIR = dataDir.subdir('vip');
var vipCache = new Map();
var pendingWrites = new Map();
var CACHE_MAX = 2000;

function _vipPath(accountKey) {
  var hash = crypto.createHash('sha256').update(accountKey).digest('hex');
  return path.join(VIP_DIR, hash + '.vip');
}

function _defaultVipState(accountKey) {
  return {
    accountKey: accountKey,
    tier: 'free',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    plan: null,
    expiresAt: 0,
    sovereignBalance: 0,
    lastSovereignGrant: 0,
    permanentPurchases: {},
    tokenInventory: 0,
    lastModified: Date.now(),
  };
}

function loadVipState(accountKey) {
  if (vipCache.has(accountKey)) return vipCache.get(accountKey);

  var fp = _vipPath(accountKey);
  try {
    if (fs.existsSync(fp)) {
      var buf = fs.readFileSync(fp);
      var json = _decryptData(buf);
      if (json) {
        var state = JSON.parse(json);
        vipCache.set(accountKey, state);
        return state;
      }
    }
  } catch (err) {
    console.error('[vip] Failed to load VIP state for ' + accountKey.substring(0, 6) + '...:', err.message);
  }

  return null;
}

function getOrCreateVipState(accountKey) {
  var existing = loadVipState(accountKey);
  if (existing) return existing;
  var state = _defaultVipState(accountKey);
  vipCache.set(accountKey, state);
  return state;
}

function saveVipState(state) {
  if (!state || !state.accountKey) return;
  state.lastModified = Date.now();
  vipCache.set(state.accountKey, state);

  var key = state.accountKey;
  if (pendingWrites.has(key)) clearTimeout(pendingWrites.get(key));
  pendingWrites.set(key, setTimeout(function() {
    pendingWrites.delete(key);
    var fp = _vipPath(key);
    var jsonStr = JSON.stringify(state);
    var encrypted = _encryptData(jsonStr);
    fs.promises.writeFile(fp, encrypted)
      .catch(function(err) { console.error('[vip] Async write error:', err.message); });
  }, 500));

  _evictOldCache();
}

function _evictOldCache() {
  if (vipCache.size <= CACHE_MAX) return;
  var iter = vipCache.keys();
  while (vipCache.size > CACHE_MAX * 0.8) {
    var result = iter.next();
    if (result.done) break;
    var oldest = result.value;
    if (pendingWrites.has(oldest)) continue;
    vipCache.delete(oldest);
  }
}

function flushAll() {
  for (var entry of pendingWrites) {
    var key = entry[0];
    var timer = entry[1];
    clearTimeout(timer);
    pendingWrites.delete(key);
    var state = vipCache.get(key);
    if (state) {
      try {
        var fp = _vipPath(key);
        var jsonStr = JSON.stringify(state);
        var encrypted = _encryptData(jsonStr);
        fs.writeFileSync(fp, encrypted);
      } catch (err) {
        console.error('[vip] Flush error for ' + key.substring(0, 6) + '...:', err.message);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Processed Stripe event dedup (prevent replay)
// ---------------------------------------------------------------------------

var processedStripeEvents = new Set();
var STRIPE_EVENT_MAX = 5000;

function isStripeEventProcessed(eventId) {
  return processedStripeEvents.has(eventId);
}

function markStripeEventProcessed(eventId) {
  processedStripeEvents.add(eventId);
  if (processedStripeEvents.size > STRIPE_EVENT_MAX) {
    // Evict oldest half
    var arr = Array.from(processedStripeEvents);
    processedStripeEvents.clear();
    for (var i = Math.floor(arr.length / 2); i < arr.length; i++) {
      processedStripeEvents.add(arr[i]);
    }
  }
}

// ---------------------------------------------------------------------------
// VIP State Mutations
// ---------------------------------------------------------------------------

var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

var PLAN_DURATIONS = {
  monthly: 30 * 24 * 60 * 60 * 1000,
  quarterly: 90 * 24 * 60 * 60 * 1000,
  annual: 365 * 24 * 60 * 60 * 1000,
};

function activateVip(accountKey, plan, stripeCustomerId, stripeSubscriptionId) {
  var state = getOrCreateVipState(accountKey);
  state.tier = 'vip';
  state.plan = plan || 'monthly';
  state.stripeCustomerId = stripeCustomerId || state.stripeCustomerId;
  state.stripeSubscriptionId = stripeSubscriptionId || state.stripeSubscriptionId;

  var duration = PLAN_DURATIONS[state.plan] || PLAN_DURATIONS.monthly;
  var now = Date.now();
  // If already VIP with time remaining, extend from expiry
  if (state.expiresAt > now) {
    state.expiresAt += duration;
  } else {
    state.expiresAt = now + duration;
  }

  // Grant monthly Sovereign stipend
  state.sovereignBalance += 300;
  state.lastSovereignGrant = now;

  saveVipState(state);
  return state;
}

function renewVip(accountKey) {
  var state = loadVipState(accountKey);
  if (!state) return null;

  var duration = PLAN_DURATIONS[state.plan] || PLAN_DURATIONS.monthly;
  var now = Date.now();
  if (state.expiresAt > now) {
    state.expiresAt += duration;
  } else {
    state.expiresAt = now + duration;
  }

  // Monthly stipend
  state.sovereignBalance += 300;
  state.lastSovereignGrant = now;

  saveVipState(state);
  return state;
}

function cancelSubscription(accountKey) {
  var state = loadVipState(accountKey);
  if (!state) return null;
  // Let paid period run out — just clear the subscription link
  state.stripeSubscriptionId = null;
  state.plan = null;
  saveVipState(state);
  return state;
}

function checkAndLapse(accountKey) {
  var state = loadVipState(accountKey);
  if (!state) return null;
  if (state.tier === 'vip' && state.expiresAt <= Date.now()) {
    state.tier = 'free';
    saveVipState(state);
  }
  return state;
}

function consumeToken(accountKey) {
  var state = getOrCreateVipState(accountKey);
  if (state.tokenInventory < 1) return { success: false, error: 'No tokens available' };

  state.tokenInventory--;
  state.tier = 'vip';
  var now = Date.now();
  if (state.expiresAt > now) {
    state.expiresAt += THIRTY_DAYS_MS;
  } else {
    state.expiresAt = now + THIRTY_DAYS_MS;
  }
  saveVipState(state);
  return { success: true, state: state };
}

function addTokens(accountKey, count) {
  var state = getOrCreateVipState(accountKey);
  state.tokenInventory += count;
  saveVipState(state);
  return state;
}

function transferTokens(fromKey, toKey, count) {
  var fromState = getOrCreateVipState(fromKey);
  if (fromState.tokenInventory < count) {
    return { success: false, error: 'Insufficient tokens' };
  }
  var toState = getOrCreateVipState(toKey);
  fromState.tokenInventory -= count;
  toState.tokenInventory += count;
  saveVipState(fromState);
  saveVipState(toState);
  return { success: true, fromTokens: fromState.tokenInventory, toTokens: toState.tokenInventory };
}

// ---------------------------------------------------------------------------
// Sovereign Operations
// ---------------------------------------------------------------------------

function addSovereigns(accountKey, amount) {
  var state = getOrCreateVipState(accountKey);
  state.sovereignBalance += amount;
  saveVipState(state);
  return state;
}

function purchaseItem(accountKey, itemId) {
  var state = getOrCreateVipState(accountKey);
  var validation = vipPerks.validatePurchase(itemId, state.permanentPurchases, state.sovereignBalance);
  if (!validation.valid) return { success: false, error: validation.error };

  var item = validation.item;
  state.sovereignBalance -= item.cost;
  if (item.type === 'permanent') {
    state.permanentPurchases[itemId] = true;
  }
  saveVipState(state);
  return { success: true, state: state, item: item };
}

// ---------------------------------------------------------------------------
// Monthly grant (called from tick)
// ---------------------------------------------------------------------------

function grantMonthlySovereigns(accountKey) {
  var state = loadVipState(accountKey);
  if (!state || !vipPerks.isVip(state)) return null;

  var now = Date.now();
  var elapsed = now - (state.lastSovereignGrant || 0);
  if (elapsed < 28 * 24 * 60 * 60 * 1000) return null; // Not yet due

  state.sovereignBalance += 300;
  state.lastSovereignGrant = now;
  saveVipState(state);
  return state;
}

// ---------------------------------------------------------------------------
// Status query (for shard consumption)
// ---------------------------------------------------------------------------

function getVipStatus(accountKey) {
  var state = checkAndLapse(accountKey);
  if (!state) {
    return {
      tier: 'free',
      expiresAt: 0,
      sovereignBalance: 0,
      permanentPurchases: {},
      tokenInventory: 0,
      perks: vipPerks.buildPerksSummary(null),
    };
  }
  return {
    tier: state.tier,
    expiresAt: state.expiresAt,
    sovereignBalance: state.sovereignBalance,
    permanentPurchases: state.permanentPurchases,
    tokenInventory: state.tokenInventory,
    perks: vipPerks.buildPerksSummary(state),
  };
}

module.exports = {
  loadVipState: loadVipState,
  getOrCreateVipState: getOrCreateVipState,
  saveVipState: saveVipState,
  flushAll: flushAll,
  isStripeEventProcessed: isStripeEventProcessed,
  markStripeEventProcessed: markStripeEventProcessed,
  activateVip: activateVip,
  renewVip: renewVip,
  cancelSubscription: cancelSubscription,
  checkAndLapse: checkAndLapse,
  consumeToken: consumeToken,
  addTokens: addTokens,
  transferTokens: transferTokens,
  addSovereigns: addSovereigns,
  purchaseItem: purchaseItem,
  grantMonthlySovereigns: grantMonthlySovereigns,
  getVipStatus: getVipStatus,
  PLAN_DURATIONS: PLAN_DURATIONS,
};
