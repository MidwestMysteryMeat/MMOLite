// accounts.js — Optional persistent account system for MMOLite
// File-per-account storage in data/accounts/{key}.json
// Accounts survive daily wipes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

var db = null;
try { db = require('./db'); } catch (_) {}

const ACCOUNTS_DIR = path.join(__dirname, 'data', 'accounts');
const KEY_LENGTH = 12;
const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; // no ambiguous chars

// ─── Multi-key encryption with rotation support ───
// Supports versioned encryption keys via /etc/mmolite/account_secrets.json
// Falls back to single ACCOUNT_SECRET env var for backward compatibility.
var ENCRYPTION_KEYS = []; // Array of { version: number, key: Buffer(32) }
var CURRENT_VERSION = 0;
var KEYS_FILE = process.env.MMOLITE_KEYS_FILE || '/etc/mmolite/account_secrets.json';

try {
  if (fs.existsSync(KEYS_FILE)) {
    var _keysConfig = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    if (_keysConfig.keys && Array.isArray(_keysConfig.keys) && _keysConfig.keys.length > 0) {
      CURRENT_VERSION = typeof _keysConfig.current === 'number' ? _keysConfig.current : 0;
      for (var _ki = 0; _ki < _keysConfig.keys.length; _ki++) {
        var _entry = _keysConfig.keys[_ki];
        if (typeof _entry.version === 'number' && typeof _entry.secret === 'string') {
          ENCRYPTION_KEYS.push({
            version: _entry.version,
            key: crypto.createHash('sha256').update(_entry.secret).digest()
          });
        }
      }
      console.log('[accounts] Loaded ' + ENCRYPTION_KEYS.length + ' encryption keys, current version: ' + CURRENT_VERSION);
    }
  }
} catch (_keysErr) {
  console.error('[accounts] Failed to load ' + KEYS_FILE + ':', _keysErr.message);
}

// Fallback: single ACCOUNT_SECRET env var (version 0)
if (ENCRYPTION_KEYS.length === 0) {
  var _ACCOUNT_SECRET = process.env.ACCOUNT_SECRET || null;
  if (!_ACCOUNT_SECRET) {
    console.error('[accounts] FATAL: No ACCOUNT_SECRET environment variable set and no keys file found at ' + KEYS_FILE + '.');
    console.error('[accounts] Set the ACCOUNT_SECRET env var before starting the server.');
    console.error('[accounts] Example: ACCOUNT_SECRET=your-random-secret-here node server.js');
    process.exit(1);
  }
  ENCRYPTION_KEYS.push({
    version: 0,
    key: crypto.createHash('sha256').update(_ACCOUNT_SECRET).digest()
  });
  CURRENT_VERSION = 0;
}

function _getCurrentKey() {
  for (var i = 0; i < ENCRYPTION_KEYS.length; i++) {
    if (ENCRYPTION_KEYS[i].version === CURRENT_VERSION) return ENCRYPTION_KEYS[i];
  }
  return ENCRYPTION_KEYS[ENCRYPTION_KEYS.length - 1]; // fallback to last
}

function _getKeyByVersion(version) {
  for (var i = 0; i < ENCRYPTION_KEYS.length; i++) {
    if (ENCRYPTION_KEYS[i].version === version) return ENCRYPTION_KEYS[i];
  }
  return null;
}

// ─── Zero-knowledge key storage ───
// Runtime map: keyHash -> rawKey (populated when users log in, cleared on disconnect)
const keyHashMap = new Map();

function _keyHash(key) {
  return crypto.createHash('sha256').update(key.replace(/[^a-zA-Z0-9]/g, '')).digest('hex');
}

// ─── PIN hashing (scrypt, Node built-in) ───
const PIN_SALT_LEN = 16;
const PIN_KEY_LEN = 32;

function hashPin(pin) {
  return new Promise(function(resolve, reject) {
    var salt = crypto.randomBytes(PIN_SALT_LEN);
    crypto.scrypt(pin, salt, PIN_KEY_LEN, { N: 16384, r: 8, p: 1 }, function(err, hash) {
      if (err) return reject(err);
      resolve(salt.toString('hex') + ':' + hash.toString('hex'));
    });
  });
}

function verifyPin(pin, stored) {
  if (!pin || !stored || typeof stored !== 'string') return Promise.resolve(false);
  var parts = stored.split(':');
  if (parts.length !== 2) return Promise.resolve(false);
  try {
    var salt = Buffer.from(parts[0], 'hex');
    var expected = Buffer.from(parts[1], 'hex');
    if (salt.length !== PIN_SALT_LEN || expected.length !== PIN_KEY_LEN) return Promise.resolve(false);
    // Try multiple scrypt param sets to handle hashes from before param changes
    var paramSets = [
      { N: 16384, r: 8, p: 1 },  // current
      { N: 16384, r: 8, p: 2 },  // intermediate legacy
    ];
    return new Promise(function(resolve) {
      var idx = 0;
      function tryNext() {
        if (idx >= paramSets.length) return resolve(false);
        var params = paramSets[idx++];
        try {
          crypto.scrypt(pin, salt, PIN_KEY_LEN, params, function(err, hash) {
            if (!err && crypto.timingSafeEqual(hash, expected)) return resolve(true);
            tryNext();
          });
        } catch (_) { tryNext(); }
      }
      tryNext();
    });
  } catch (_) {
    return Promise.resolve(false);
  }
}

async function setPinForAccount(key, pin) {
  if (!pin || typeof pin !== 'string' || pin.length < 4 || pin.length > 8 || !/^[a-zA-Z0-9]+$/.test(pin)) return false;
  var acc = loadAccount(key);
  if (!acc) return false;
  acc.pinHash = await hashPin(pin);
  saveAccount(acc);
  return true;
}

// ─── AES-256-GCM encryption helpers ───

function _encryptData(plaintext) {
  var currentKey = _getCurrentKey();
  var iv = crypto.randomBytes(12); // 96-bit IV for GCM
  var cipher = crypto.createCipheriv('aes-256-gcm', currentKey.key, iv);
  var encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  var authTag = cipher.getAuthTag();
  if (CURRENT_VERSION === 0) {
    // Legacy format (no version prefix) for backward compatibility
    return Buffer.concat([iv, authTag, encrypted]);
  }
  // Versioned format: version(1) + iv(12) + authTag(16) + ciphertext
  var vByte = Buffer.alloc(1);
  vByte[0] = currentKey.version;
  return Buffer.concat([vByte, iv, authTag, encrypted]);
}

function _decryptData(buffer) {
  if (buffer.length < 29) return null; // 12 + 16 + 1 minimum

  // Strategy 1: Try versioned format (first byte = known version > 0)
  var firstByte = buffer[0];
  if (firstByte > 0 && buffer.length >= 30) {
    var vKey = _getKeyByVersion(firstByte);
    if (vKey) {
      try {
        var vIv = buffer.slice(1, 13);
        var vTag = buffer.slice(13, 29);
        var vCipher = buffer.slice(29);
        var vDecipher = crypto.createDecipheriv('aes-256-gcm', vKey.key, vIv);
        vDecipher.setAuthTag(vTag);
        var vDec = Buffer.concat([vDecipher.update(vCipher), vDecipher.final()]);
        return vDec.toString('utf8');
      } catch (_) { /* fall through to legacy */ }
    }
  }

  // Strategy 2: Legacy format (no version prefix) — try all keys newest-first
  for (var i = ENCRYPTION_KEYS.length - 1; i >= 0; i--) {
    try {
      var iv = buffer.slice(0, 12);
      var authTag = buffer.slice(12, 28);
      var ciphertext = buffer.slice(28);
      var decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEYS[i].key, iv);
      decipher.setAuthTag(authTag);
      var decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf8');
    } catch (_) { continue; }
  }
  return null;
}

// In-memory store for temporary accounts (never written to disk)
const tempAccounts = new Map();

// ─── Tag index for O(1) friend lookups (Finding #9) ───
// Map<"username_lower:TAG", accountKey>
const tagIndex = new Map();

// ─── Write-behind cache for async I/O ───
const accountCache = new Map();
const CACHE_MAX = 5000;
const pendingWrites = new Map(); // key -> timeout handle

function _queueWrite(account) {
  const key = account.key;
  if (account.temp) return; // temps never hit disk
  // Update cache immediately
  accountCache.set(key, account);
  _evictCache();
  // Debounce disk write — at most once per 500ms per account
  if (pendingWrites.has(key)) clearTimeout(pendingWrites.get(key));
  pendingWrites.set(key, setTimeout(() => {
    pendingWrites.delete(key);
    const fp = accountPath(key);
    if (!fp) return;
    var scrubbed = _scrubForDisk(account);
    var jsonStr = JSON.stringify(scrubbed);
    var encrypted = _encryptData(jsonStr);
    fs.promises.writeFile(fp, encrypted)
      .catch(err => console.error('[accounts] Async write error:', err.message));
  }, 500));
}

// Evict oldest cache entries when over limit (Map iterates in insertion order)
function _evictCache() {
  if (accountCache.size <= CACHE_MAX) return;
  const iter = accountCache.keys();
  while (accountCache.size > CACHE_MAX * 0.8) {
    const oldest = iter.next().value;
    if (oldest) accountCache.delete(oldest);
    else break;
  }
}

// ─── Zero-knowledge scrub/restore for disk persistence ───

function _scrubForDisk(account) {
  // Shallow copy — only deep-clone fields that need mutation (friends, blocked, friendRequests, dms)
  var copy = Object.assign({}, account);
  // Replace raw key with hash
  if (copy.key) {
    copy.keyHash = _keyHash(copy.key);
    copy.tag = keyToTag(copy.key);
    delete copy.key;
  }
  // Hash friend keys (clone array + each entry)
  if (copy.friends && Array.isArray(copy.friends)) {
    copy.friends = copy.friends.map(function(f) {
      var hashed = Object.assign({}, f);
      if (hashed.key) { hashed.keyHash = _keyHash(hashed.key); delete hashed.key; }
      return hashed;
    });
  }
  // Hash blocked keys (clone array)
  if (copy.blocked && Array.isArray(copy.blocked)) {
    copy.blocked = copy.blocked.map(function(k) { return typeof k === 'string' && k.length < 64 ? _keyHash(k) : k; });
  }
  // Hash friend request keys (clone object + arrays)
  if (copy.friendRequests) {
    copy.friendRequests = Object.assign({}, copy.friendRequests);
    if (copy.friendRequests.incoming && Array.isArray(copy.friendRequests.incoming)) {
      copy.friendRequests.incoming = copy.friendRequests.incoming.map(function(r) {
        var hashed = Object.assign({}, r);
        if (hashed.fromKey) { hashed.fromKeyHash = _keyHash(hashed.fromKey); delete hashed.fromKey; }
        return hashed;
      });
    }
    if (copy.friendRequests.outgoing && Array.isArray(copy.friendRequests.outgoing)) {
      copy.friendRequests.outgoing = copy.friendRequests.outgoing.map(function(r) {
        var hashed = Object.assign({}, r);
        if (hashed.toKey) { hashed.toKeyHash = _keyHash(hashed.toKey); delete hashed.toKey; }
        return hashed;
      });
    }
  }
  // Hash DM conversation keys (clone dms object + conversations)
  if (copy.dms && copy.dms.conversations) {
    copy.dms = Object.assign({}, copy.dms);
    var newConvos = {};
    for (var convKey in copy.dms.conversations) {
      var hashedConvKey = convKey.length < 64 ? _keyHash(convKey) : convKey;
      newConvos[hashedConvKey] = copy.dms.conversations[convKey];
    }
    copy.dms.conversations = newConvos;
  }
  return copy;
}

function _restoreFromDisk(diskAccount, rawKey) {
  var account = JSON.parse(JSON.stringify(diskAccount));
  // Restore raw key
  account.key = rawKey;
  delete account.keyHash;
  // Restore friend keys from runtime keyHashMap
  if (account.friends && Array.isArray(account.friends)) {
    account.friends = account.friends.map(function(f) {
      if (f.keyHash && keyHashMap.has(f.keyHash)) {
        f.key = keyHashMap.get(f.keyHash);
        delete f.keyHash;
      } else if (f.keyHash) {
        // Friend not online — keep hash as placeholder, resolve later
        f.key = f.keyHash;
      }
      return f;
    });
  }
  // Restore blocked keys from runtime map
  if (account.blocked && Array.isArray(account.blocked)) {
    account.blocked = account.blocked.map(function(h) {
      return keyHashMap.has(h) ? keyHashMap.get(h) : h;
    });
  }
  // Restore friend request keys from runtime map
  if (account.friendRequests) {
    if (account.friendRequests.incoming && Array.isArray(account.friendRequests.incoming)) {
      account.friendRequests.incoming = account.friendRequests.incoming.map(function(r) {
        if (r.fromKeyHash) {
          r.fromKey = keyHashMap.has(r.fromKeyHash) ? keyHashMap.get(r.fromKeyHash) : r.fromKeyHash;
          delete r.fromKeyHash;
        }
        return r;
      });
    }
    if (account.friendRequests.outgoing && Array.isArray(account.friendRequests.outgoing)) {
      account.friendRequests.outgoing = account.friendRequests.outgoing.map(function(r) {
        if (r.toKeyHash) {
          r.toKey = keyHashMap.has(r.toKeyHash) ? keyHashMap.get(r.toKeyHash) : r.toKeyHash;
          delete r.toKeyHash;
        }
        return r;
      });
    }
  }
  // Restore DM conversation keys
  if (account.dms && account.dms.conversations) {
    var newConvos = {};
    for (var convHash in account.dms.conversations) {
      var realKey = keyHashMap.has(convHash) ? keyHashMap.get(convHash) : convHash;
      newConvos[realKey] = account.dms.conversations[convHash];
    }
    account.dms.conversations = newConvos;
  }
  return account;
}

// Force-flush all pending writes to disk (call on shutdown)
function flushAll() {
  for (const [key, timer] of pendingWrites) {
    clearTimeout(timer);
    pendingWrites.delete(key);
    const account = accountCache.get(key);
    if (!account || account.temp) continue;
    const fp = accountPath(key);
    if (!fp) continue;
    // Synchronous write on shutdown — must complete before exit
    try {
      var scrubbed = _scrubForDisk(account);
      var jsonStr = JSON.stringify(scrubbed);
      var encrypted = _encryptData(jsonStr);
      fs.writeFileSync(fp, encrypted);
    } catch (err) {
      console.error('[accounts] Flush write error for', key, ':', err.message);
    }
  }
}

// Safe sync existence check (used only for rare key-collision detection on create)
function _fileExistsSync(fp) {
  if (!fp) return false;
  try { fs.accessSync(fp); return true; } catch (_) { return false; }
}

const rpgData = require('./rpg-data');

// ---------------------------------------------------------------------------
// Character Slots System — "Swap-In / Swap-Out" Pattern
// ---------------------------------------------------------------------------
const MAX_CHARACTERS_PER_ACCOUNT = 4;

// Fields that belong to a character (extracted/restored during character switch)
const CHARACTER_FIELDS = [
  'monsters', 'activeParty', 'level', 'xp', 'guildId', 'questProgress',
  'craftingRecipes', 'skills', 'mmoInventory', 'equipment', 'plotId',
  'race', 'rpgStats', 'rpgCards', 'equippedCards', 'cardSlots', 'activeCardSlots', 'passiveCardSlots',
  'pendingPacks', 'pityPullsSinceLegendary', 'mount', 'lastZone', 'lastPosition', 'chips',
  'dungeonProgress',
  'knowledge',
  'permadeath',
  'awakenings',
  // --- New systems ---
  'karma',
  'activeBounty',
  'crimeHistory',
  'factionRep',
  'companions',
  'ascensionCount',
  'ascensionPoints',
  'ascensionTree',
  'ascensionMark',
  'petData',
  'activePet',
  'npcRelationships',
  'townReputation',
  'pendingCrafts',
  'jailState',
  'skillMasteryPoints',
  'skillMasteryNodes',
];

// Returns default value for a character field (mirrors createAccount defaults)
function _getDefaultForField(field) {
  switch (field) {
    case 'monsters': return [];
    case 'activeParty': return [];
    case 'level': return 1;
    case 'xp': return 0;
    case 'guildId': return null;
    case 'questProgress': return {};
    case 'craftingRecipes': return [];
    case 'skills': return rpgData.getDefaultSkills();
    case 'mmoInventory': return { wood: 0, stone: 0, iron_ore: 0, iron_bar: 0, items: [] };
    case 'equipment': return { axe: null, pickaxe: null };
    case 'plotId': return null;
    case 'race': return null;
    case 'rpgStats': return rpgData.getDefaultStats();
    case 'rpgCards': return [];
    case 'equippedCards': return [];
    case 'cardSlots': return 1;
    case 'activeCardSlots': return 1;
    case 'passiveCardSlots': return 0;
    case 'pendingPacks': return 0;
    case 'pityPullsSinceLegendary': return 0;
    case 'mount': return null;
    case 'lastZone': return null;
    case 'lastPosition': return null;
    case 'chips': return 0;
    case 'dungeonProgress': return {
      guildMember: false,
      guildXp: 0,
      guildRank: 'stone',
      deepestFloor: 0,
      totalKills: 0,
      totalDeaths: 0,
      bossesKilled: 0,
      dailyQuests: {},
      lastQuestDate: null,
      clearedCaves: {},
      activeCave: null,
      activeCaveFloor: 0,
    };
    case 'knowledge': return {
      glossaryUnlocked: [],
      booksDiscovered: [],
      glossaryTriggersFired: [],
    };
    case 'permadeath': return false;
    case 'awakenings': return [];
    // --- New systems ---
    case 'karma': return 0;
    case 'activeBounty': return null;
    case 'crimeHistory': return [];
    case 'factionRep': return {};
    case 'companions': return [];
    case 'ascensionCount': return 0;
    case 'ascensionPoints': return 0;
    case 'ascensionTree': return {};
    case 'ascensionMark': return false;
    case 'petData': return [];
    case 'activePet': return null;
    case 'npcRelationships': return {};
    case 'townReputation': return {};
    case 'pendingCrafts': return [];
    case 'jailState':
      return { inJail: false, crime: null, releasedAt: 0, bail: 0, jailZoneId: null, arrestedAt: 0 };
    case 'skillMasteryPoints': return {};
    case 'skillMasteryNodes': return {};
    default: return null;
  }
}

const ACCOUNT_EXPIRY_DAYS = 3650; // ~10 years — effectively permanent for MMO accounts
const ACCOUNT_EXPIRY_MS = ACCOUNT_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
const MAX_CHIPS = 999999999; // ~1 billion cap

// Sanitize usernames — only letters, digits, and spaces (no special chars)
function sanitizeName(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[^a-zA-Z0-9 ]/g, '').trim();
}

// Tag generation: must match state.js generateTag() exactly
// Uses HMAC-SHA256 for deterministic but non-reversible tags
var TAG_ALPHANUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function keyToTag(key) {
  if (!key || typeof key !== 'string') return '????';
  var hmac = crypto.createHmac('sha256', process.env.TAG_HMAC_SECRET || 'mmolite-tag-v1').update(key).digest();
  var tag = '';
  for (var i = 0; i < 4; i++) {
    tag += TAG_ALPHANUM[hmac[i] % TAG_ALPHANUM.length];
  }
  return tag;
}

// Get 4-char discriminator from account key (safe to share publicly)
function getDiscriminator(key) {
  return keyToTag(key);
}

// Get user's friend tag: "Username#ABCD"
function getUserTag(key) {
  var acc = loadAccount(key);
  if (!acc) return null;
  return acc.username + '#' + keyToTag(key);
}

// Update tag index for an account
function _updateTagIndex(acc, rawKey) {
  if (!acc || acc.temp || !acc.username) return;
  var tag = acc.tag || (rawKey ? keyToTag(rawKey) : null);
  if (!tag) return;
  var indexKey = acc.username.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim() + ':' + tag.toUpperCase();
  tagIndex.set(indexKey, rawKey || (acc.keyHash && keyHashMap.has(acc.keyHash) ? keyHashMap.get(acc.keyHash) : null));
}

// Find a permanent account by friend tag (Username#discriminator)
// Uses in-memory index for O(1) lookup; falls back to disk scan if index miss
function findAccountByTag(username, discriminator) {
  var normalized = (username || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (!normalized || !discriminator || discriminator.length < 4) return null;
  var disc = discriminator.toUpperCase();

  // O(1) index lookup
  var indexKey = normalized + ':' + disc;
  if (tagIndex.has(indexKey)) {
    var cachedKey = tagIndex.get(indexKey);
    if (cachedKey) return cachedKey;
  }

  // Fallback: full scan (populates index as it goes)
  var files;
  try { files = fs.readdirSync(ACCOUNTS_DIR); } catch (e) { return null; }

  var scanned = 0;
  var MAX_SCAN = 500;
  for (var i = 0; i < files.length; i++) {
    if (++scanned > MAX_SCAN) break;
    if (!files[i].endsWith('.json')) continue;
    var fp = path.join(ACCOUNTS_DIR, files[i]);
    try {
      var buf = fs.readFileSync(fp);
      var acc;
      try {
        var decrypted = _decryptData(buf);
        if (decrypted) acc = JSON.parse(decrypted);
      } catch (_) {}
      if (!acc) {
        try { acc = JSON.parse(buf.toString('utf8')); } catch (_) {}
      }
      if (!acc || acc.temp) continue;
      var tag = acc.tag || (acc.key ? keyToTag(acc.key) : null);
      // Populate index for future lookups
      if (acc.username && tag) {
        var ik = acc.username.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim() + ':' + tag.toUpperCase();
        var resolvedKey = acc.key || (acc.keyHash && keyHashMap.has(acc.keyHash) ? keyHashMap.get(acc.keyHash) : null);
        tagIndex.set(ik, resolvedKey);
      }
      if (tag !== disc) continue;
      if (acc.username && acc.username.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim() === normalized) {
        if (acc.key) return acc.key;
        if (acc.keyHash && keyHashMap.has(acc.keyHash)) return keyHashMap.get(acc.keyHash);
        return null;
      }
    } catch (_) { continue; }
  }
  return null;
}

// Ensure directory exists
fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
if (ENCRYPTION_KEYS.length > 0) {
  console.log('[accounts] Encryption enabled (' + ENCRYPTION_KEYS.length + ' key(s), current version: ' + CURRENT_VERSION + ')');
}

// ─── Startup: pre-populate keyHashMap from all account files ───
// This allows friend key resolution to work immediately after restart
// without waiting for each user to log in.
// Exported as preloadKeyIndex() so server.js can call it after the server starts listening.
async function preloadKeyIndex() {
  try {
    var allFiles = await fs.promises.readdir(ACCOUNTS_DIR);
    var files = allFiles.filter(function(f) { return f.endsWith('.json'); });
    var loaded = 0;
    for (var i = 0; i < files.length; i++) {
      var fp = path.join(ACCOUNTS_DIR, files[i]);
      try {
        var buf = await fs.promises.readFile(fp);
        var decrypted = _decryptData(buf);
        if (!decrypted) continue;
        var acc = JSON.parse(decrypted);
        // For hash-named files, we need some way to recover the raw key.
        // The raw key is NOT stored on disk (keyHash is stored instead).
        // But we CAN pre-populate the keyHash -> file mapping for future resolution.
        // Log pinHash status for debugging
        if (acc.keyHash) {
          console.log('[accounts-preload] file=' + files[i].slice(0, 8) + '... username=' + (acc.username || '?') + ' pinHash=' + (acc.pinHash ? 'SET' : 'NOT_SET'));
        }
        loaded++;
      } catch (e) { /* skip corrupt files */ }
    }
    if (loaded > 0) console.log('[accounts] Pre-loaded ' + loaded + ' account file(s) for diagnostics');
  } catch (e) {
    // data dir might not exist yet
    console.log('[accounts] preloadKeyIndex: data dir not ready (' + (e.message || 'unknown error') + ')');
  }
}

function generateKey() {
  let key = '';
  // Rejection sampling to eliminate modulo bias
  const maxValid = 256 - (256 % KEY_CHARS.length);
  while (key.length < KEY_LENGTH) {
    const byte = crypto.randomBytes(1)[0];
    if (byte < maxValid) {
      key += KEY_CHARS[byte % KEY_CHARS.length];
    }
  }
  return key;
}

function accountPath(key) {
  // Sanitize key to prevent directory traversal
  var safeKey = key.replace(/[^a-zA-Z0-9]/g, '');
  if (safeKey.length < 12) return null;
  var hash = crypto.createHash('sha256').update(safeKey).digest('hex');
  return path.join(ACCOUNTS_DIR, hash + '.json');
}

function _legacyAccountPath(key) {
  var safeKey = key.replace(/[^a-zA-Z0-9]/g, '');
  if (safeKey.length !== KEY_LENGTH) return null;
  return path.join(ACCOUNTS_DIR, safeKey + '.json');
}

function createAccount(username, color) {
  let key;
  let attempts = 0;
  do {
    key = generateKey();
    attempts++;
    if (attempts > 100) return null; // safety
  } while (accountCache.has(key) || _fileExistsSync(accountPath(key)));

  var cleanUsername = sanitizeName(username || 'Anon').slice(0, 20) || 'Anon';
  var now = Date.now();

  // Build initial character data
  var initialChar = {};
  for (var fi = 0; fi < CHARACTER_FIELDS.length; fi++) {
    initialChar[CHARACTER_FIELDS[fi]] = _getDefaultForField(CHARACTER_FIELDS[fi]);
  }
  initialChar.name = cleanUsername;
  initialChar.createdAt = now;

  const account = {
    key,
    username: cleanUsername,
    color: color || '#f0b232',
    createdAt: now,
    lastSeen: now,
    stats: {
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      highScore: 0,
      cordsPosted: 0,
    },
    slurFilter: false,
    favoriteGifs: [],
    uploads: [],
    metadata: {},
    // Character slots
    characters: [initialChar],
    activeCharacterIndex: 0,
    maxCharacters: MAX_CHARACTERS_PER_ACCOUNT,
    _characterName: cleanUsername,
    _characterCreatedAt: now,
    // Character-specific fields at top level (active character)
    monsters: [],
    activeParty: [],
    level: 1,
    xp: 0,
    guildId: null,
    questProgress: {},
    craftingRecipes: [],
    skills: rpgData.getDefaultSkills(),
    mmoInventory: { wood: 0, stone: 0, iron_ore: 0, iron_bar: 0, items: [] },
    equipment: { axe: null, pickaxe: null },
    plotId: null,
    race: null,
    rpgStats: rpgData.getDefaultStats(),
    rpgCards: [],
    equippedCards: [],
    cardSlots: 1,
    activeCardSlots: 1,
    passiveCardSlots: 0,
    pendingPacks: 0,
    pityPullsSinceLegendary: 0,
    mount: null,
    lastZone: null,
    lastPosition: null,
    chips: 0,
    leviathanKills: {},
    leviathanTotalKills: 0,
    awakenings: [],
  };

  saveAccount(account);
  return account;
}

function selectAwakening(key, awakeningId) {
  var account = loadAccount(key);
  if (!account) return { error: 'Account not found' };
  if (!account.awakenings) account.awakenings = [];

  // Validate the awakening exists and player qualifies
  var available = rpgData.getAvailableAwakenings(
    account.level || 1,
    account.rpgStats || rpgData.getDefaultStats(),
    account.awakenings
  );

  var found = null;
  for (var i = 0; i < available.length; i++) {
    if (available[i].id === awakeningId) {
      found = available[i];
      break;
    }
  }

  if (!found) return { error: 'Awakening not available or already chosen' };

  account.awakenings.push(awakeningId);
  saveAccount(account);
  return { success: true, awakening: found, awakenings: account.awakenings };
}

function createTempAccount(username, color) {
  let key;
  let attempts = 0;
  do {
    key = 'tmp_' + generateKey().slice(0, 9);
    attempts++;
    if (attempts > 100) return null;
  } while (tempAccounts.has(key));

  var cleanUsername = sanitizeName(username || 'Anon').slice(0, 20) || 'Anon';
  var now = Date.now();

  var initialChar = {};
  for (var fi = 0; fi < CHARACTER_FIELDS.length; fi++) {
    initialChar[CHARACTER_FIELDS[fi]] = _getDefaultForField(CHARACTER_FIELDS[fi]);
  }
  initialChar.name = cleanUsername;
  initialChar.createdAt = now;

  const account = {
    key,
    temp: true,
    username: cleanUsername,
    color: color || '#f0b232',
    createdAt: now,
    lastSeen: now,
    stats: { gamesPlayed: 0, wins: 0, losses: 0, highScore: 0, cordsPosted: 0 },
    slurFilter: false,
    favoriteGifs: [],
    uploads: [],
    metadata: {},
    characters: [initialChar],
    activeCharacterIndex: 0,
    maxCharacters: MAX_CHARACTERS_PER_ACCOUNT,
    _characterName: cleanUsername,
    _characterCreatedAt: now,
    monsters: [],
    activeParty: [],
    level: 1,
    xp: 0,
    guildId: null,
    questProgress: {},
    craftingRecipes: [],
    skills: rpgData.getDefaultSkills(),
    mmoInventory: { wood: 0, stone: 0, iron_ore: 0, iron_bar: 0, items: [] },
    equipment: { axe: null, pickaxe: null },
    plotId: null,
    race: null,
    rpgStats: rpgData.getDefaultStats(),
    rpgCards: [],
    equippedCards: [],
    cardSlots: 1,
    activeCardSlots: 1,
    passiveCardSlots: 0,
    pendingPacks: 0,
    pityPullsSinceLegendary: 0,
    mount: null,
    lastZone: null,
    lastPosition: null,
    chips: 0,
  };
  tempAccounts.set(key, account);
  return account;
}

function promoteTempAccount(tempKey) {
  const temp = tempAccounts.get(tempKey);
  if (!temp) return null;

  // Generate a real permanent key
  let newKey;
  let attempts = 0;
  do {
    newKey = generateKey();
    attempts++;
    if (attempts > 100) return null;
  } while (accountCache.has(newKey) || _fileExistsSync(accountPath(newKey)));

  // Transfer all data to permanent account
  const permanent = Object.assign({}, temp, { key: newKey });
  delete permanent.temp;

  permanent.lastSeen = Date.now();
  // Cache immediately and queue async write
  accountCache.set(newKey, permanent);
  _queueWrite(permanent);

  // Remove from temp store
  tempAccounts.delete(tempKey);
  return permanent;
}

function isTempAccount(key) {
  return tempAccounts.has(key);
}

function isAccountExpired(account) {
  if (!account) return false;
  const lastActive = account.lastSeen || account.createdAt || 0;
  return (Date.now() - lastActive) > ACCOUNT_EXPIRY_MS;
}

// Lazy migration: wrap existing top-level character data into characters[0]
function _migrateToMultiCharacter(account) {
  if (!account.hallOfHeroes) account.hallOfHeroes = [];
  if (account.characters) return;
  var charData = {};
  for (var i = 0; i < CHARACTER_FIELDS.length; i++) {
    var field = CHARACTER_FIELDS[i];
    charData[field] = account[field] !== undefined ? account[field] : _getDefaultForField(field);
  }
  charData.name = account.username || 'Character';
  charData.createdAt = account.createdAt || Date.now();
  account.characters = [charData];
  account.activeCharacterIndex = 0;
  account.maxCharacters = MAX_CHARACTERS_PER_ACCOUNT;
  account._characterName = charData.name;
  account._characterCreatedAt = charData.createdAt;
}

function loadAccount(key) {
  if (!key || typeof key !== 'string') return null;
  // Check in-memory temp accounts first
  if (tempAccounts.has(key)) return tempAccounts.get(key);

  // Check write-behind cache
  if (accountCache.has(key)) {
    const cached = accountCache.get(key);
    if (isAccountExpired(cached)) {
      accountCache.delete(key);
      // Queue async deletion from disk
      const fp = accountPath(key);
      if (fp) fs.promises.unlink(fp).catch(() => {});
      return null;
    }
    // Lazy migration to multi-character system
    _migrateToMultiCharacter(cached);
    return cached;
  }

  // Fall back to disk read
  const fp = accountPath(key);
  if (!fp) return null;

  try {
    var raw, account;
    if (fs.existsSync(fp)) {
      // New encrypted format
      var encBuf = fs.readFileSync(fp);
      var decrypted = _decryptData(encBuf);
      if (!decrypted) return null;
      account = JSON.parse(decrypted);
    } else {
      // Try legacy plaintext format for migration
      var legacyFp = _legacyAccountPath(key);
      if (!legacyFp || !fs.existsSync(legacyFp)) return null;
      raw = fs.readFileSync(legacyFp, 'utf8');
      account = JSON.parse(raw);
      // Migrate: scrub and write encrypted to new path, delete old file
      var scrubbed = _scrubForDisk(account);
      var jsonStr = JSON.stringify(scrubbed);
      var encrypted = _encryptData(jsonStr);
      fs.writeFileSync(fp, encrypted);
      fs.promises.unlink(legacyFp).catch(() => {});
      console.log('[accounts] Migrated account to encrypted storage: ' + key.slice(0, 3) + '...');
    }
    // Validate: either legacy format (raw key) or new format (keyHash)
    if (!account) return null;
    if (account.keyHash) {
      // New format: validate hash matches
      if (account.keyHash !== _keyHash(key)) return null;
      // Restore full account from disk format
      account = _restoreFromDisk(account, key);
    } else if (account.key !== key) {
      return null;
    }
    if (isAccountExpired(account)) {
      fs.promises.unlink(fp).catch(() => {});
      return null;
    }
    // Lazy migration to multi-character system
    _migrateToMultiCharacter(account);
    accountCache.set(key, account);
    keyHashMap.set(_keyHash(key), key);
    _updateTagIndex(account, key);
    _evictCache();
    return account;
  } catch (_) {
    // File not found or corrupt — try PostgreSQL as last resort
    if (db && db.isConnected) {
      // Note: this is synchronous context but db returns Promise.
      // We can't block here, so we fire an async load and cache it for
      // the next call. First call returns null, subsequent calls hit cache.
      db.getAccount(key).then(function(dbAccount) {
        if (dbAccount && !isAccountExpired(dbAccount)) {
          accountCache.set(key, dbAccount);
          keyHashMap.set(_keyHash(key), key);
          _updateTagIndex(dbAccount, key);
        }
      }).catch(function(err) { console.warn('[accounts] db cache load failed:', err.message); });
    }
    return null;
  }
}

function saveAccount(account) {
  if (!account || !account.key) return false;
  account.lastSeen = Date.now();

  // Sync active character's top-level fields back into characters array
  if (account.characters && typeof account.activeCharacterIndex === 'number') {
    var idx = account.activeCharacterIndex;
    if (idx >= 0 && idx < account.characters.length) {
      var charData = account.characters[idx];
      for (var ci = 0; ci < CHARACTER_FIELDS.length; ci++) {
        var cf = CHARACTER_FIELDS[ci];
        charData[cf] = account[cf] !== undefined ? account[cf] : _getDefaultForField(cf);
      }
      charData.name = account._characterName || charData.name || account.username;
      charData.createdAt = account._characterCreatedAt || charData.createdAt;
    }
  }

  // Temp accounts stay in memory only
  if (account.temp) {
    tempAccounts.set(account.key, account);
    return true;
  }

  // Write-behind: update cache immediately, queue async disk write
  _queueWrite(account);
  keyHashMap.set(_keyHash(account.key), account.key);

  // Dual-write to PostgreSQL (fire-and-forget, file is still primary)
  if (db && db.isConnected) {
    db.saveAccount(account.key, account).catch(function(err) { console.warn('[accounts] db save failed for', account.key, ':', err.message); });
  }

  return true;
}

// ─── In-process chip lock to prevent TOCTOU race conditions ───
// Serializes chip operations per account key so concurrent async callers
// cannot interleave load-modify-save across await boundaries.
// The synchronous updateChips/setChips acquire the lock, perform the mutation
// synchronously (safe in single-threaded Node.js), and return the result.
// The lock also prevents interleaving if callers yield between operations.
const _chipLocks = new Map(); // key -> { queue: Promise, depth: number }

// Acquire a per-key lock. Returns a release function.
// In synchronous code, lock acquisition is non-blocking because Node.js is single-threaded.
function _acquireChipLock(key) {
  var entry = _chipLocks.get(key);
  if (!entry) {
    entry = { queue: Promise.resolve(), depth: 0 };
    _chipLocks.set(key, entry);
  }
  entry.depth++;
  return function release() {
    entry.depth--;
    if (entry.depth <= 0) {
      _chipLocks.delete(key);
    }
  };
}

function updateChips(key, amount) {
  if (typeof amount !== 'number' || !isFinite(amount) || isNaN(amount)) return null;
  var release = _acquireChipLock(key);
  try {
    const account = loadAccount(key);
    if (!account) return null;
    account.chips = Math.min(MAX_CHIPS, Math.max(0, (account.chips || 0) + amount));
    saveAccount(account);
    return account.chips;
  } finally {
    release();
  }
}

function setChips(key, amount) {
  var release = _acquireChipLock(key);
  try {
    const account = loadAccount(key);
    if (!account) return null;
    account.chips = Math.min(MAX_CHIPS, Math.max(0, amount));
    saveAccount(account);
    return account.chips;
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// RPG card collection, equip/fusion/pack — extracted to account-rpg-cards.js
// Require early so getEquippedCardEffects is available for account-skills init.
// init() is deferred until after account-rpg-evolution is loaded (needs _spreadMutation).
// ---------------------------------------------------------------------------
var _accountRpgCards = require('./account-rpg-cards');
var addCard = _accountRpgCards.addCard;
var removeCard = _accountRpgCards.removeCard;
var getCards = _accountRpgCards.getCards;
var acquireCardLock = _accountRpgCards.acquireCardLock;
var releaseCardLock = _accountRpgCards.releaseCardLock;
var addPendingPack = _accountRpgCards.addPendingPack;
var openPendingPack = _accountRpgCards.openPendingPack;
var equipRpgCard = _accountRpgCards.equipRpgCard;
var unequipRpgCard = _accountRpgCards.unequipRpgCard;
var fuseRpgCards = _accountRpgCards.fuseRpgCards;
var getRpgCards = _accountRpgCards.getRpgCards;
var getEquippedCardEffects = _accountRpgCards.getEquippedCardEffects;
var getPlayerLuck = _accountRpgCards.getPlayerLuck;
var invalidateCardEffectsCache = _accountRpgCards.invalidateCardEffectsCache;
var MAX_CARDS = _accountRpgCards.MAX_CARDS;

// ---------------------------------------------------------------------------
// Skill system — extracted to account-skills.js
// ---------------------------------------------------------------------------
var _accountSkills = require('./account-skills');
_accountSkills.init({ loadAccount: loadAccount, saveAccount: saveAccount, getEquippedCardEffects: getEquippedCardEffects, rpgData: rpgData });
var xpForLevel = _accountSkills.xpForLevel;
var getSkill = _accountSkills.getSkill;
var addSkillXp = _accountSkills.addSkillXp;

var ALLOWED_STAT_KEYS = new Set([
  'gamesPlayed', 'wins', 'losses', 'highScore', 'cordsPosted', 'cordsLiked',
  'messagesPosted', 'chipsWon', 'chipsLost', 'itemsCollected', 'tradesCompleted',
  'battlesWon', 'battlesLost', 'clickerClicks', 'giftsGiven', 'giftsReceived',
  'slotsPlayed', 'plinkoPlayed', 'scratchPlayed', 'lootboxOpened', 'coinFlipsPlayed',
  'pokerPlayed', 'blackjackPlayed', 'lieroPlayed', 'lieroWins', 'lieroKills',
]);

function updateStats(key, statUpdates) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!account.stats) account.stats = {};
  for (const [k, v] of Object.entries(statUpdates)) {
    if (!ALLOWED_STAT_KEYS.has(k)) continue;
    if (typeof v === 'number') {
      account.stats[k] = (account.stats[k] || 0) + v;
    } else {
      account.stats[k] = v;
    }
  }
  saveAccount(account);
  return account.stats;
}

function deleteAccount(key) {
  // Check temp accounts first
  if (tempAccounts.has(key)) {
    tempAccounts.delete(key);
    return true;
  }
  // Clear from cache and cancel pending writes
  accountCache.delete(key);
  if (pendingWrites.has(key)) {
    clearTimeout(pendingWrites.get(key));
    pendingWrites.delete(key);
  }
  const fp = accountPath(key);
  if (!fp) return false;
  // Async delete from disk
  fs.promises.unlink(fp).catch(() => {});
  // Also try deleting legacy path for migrated accounts
  var legacyFp = _legacyAccountPath(key);
  if (legacyFp) fs.promises.unlink(legacyFp).catch(() => {});
  return true;
}

function getPublicProfile(key) {
  const account = loadAccount(key);
  if (!account) return null;
  return {
    username: account.username,
    color: account.color,
    chips: account.chips,
    createdAt: account.createdAt,
    stats: account.stats || {},
  };
}

const MAX_FAVORITE_GIFS = 50;

function addFavoriteGif(key, gifUrl, previewUrl) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!account.favoriteGifs) account.favoriteGifs = [];
  // Don't duplicate
  if (account.favoriteGifs.some(g => g.url === gifUrl)) return account.favoriteGifs;
  account.favoriteGifs.unshift({ url: gifUrl, preview: previewUrl || gifUrl, addedAt: Date.now() });
  if (account.favoriteGifs.length > MAX_FAVORITE_GIFS) account.favoriteGifs.pop();
  saveAccount(account);
  return account.favoriteGifs;
}

function removeFavoriteGif(key, gifUrl) {
  const account = loadAccount(key);
  if (!account || !account.favoriteGifs) return null;
  account.favoriteGifs = account.favoriteGifs.filter(g => g.url !== gifUrl);
  saveAccount(account);
  return account.favoriteGifs;
}

function getFavoriteGifs(key) {
  const account = loadAccount(key);
  if (!account) return [];
  return account.favoriteGifs || [];
}

// Cache leaderboard to avoid scanning disk every request
let _leaderboardCache = null;
let _leaderboardCacheTime = 0;
const LEADERBOARD_CACHE_MS = 30 * 1000; // refresh every 30 seconds
let _leaderboardRefreshing = false;

// Non-blocking async leaderboard refresh
function _refreshLeaderboardAsync() {
  if (_leaderboardRefreshing) return;
  _leaderboardRefreshing = true;
  fs.promises.readdir(ACCOUNTS_DIR).then(files => {
    files = files.filter(f => f.endsWith('.json'));
    return Promise.all(files.map(f => {
      var fp = path.join(ACCOUNTS_DIR, f);
      return fs.promises.readFile(fp).then(buf => {
        var acc;
        // Try encrypted format first
        try {
          var decrypted = _decryptData(buf);
          if (decrypted) acc = JSON.parse(decrypted);
        } catch (_) {}
        // Fallback: plaintext JSON
        if (!acc) {
          try { acc = JSON.parse(buf.toString('utf8')); } catch (_) {}
        }
        if (!acc) return null;
        return { data: acc, key: acc.key || null, tag: acc.tag || (acc.key ? keyToTag(acc.key) : null) };
      }).catch(() => null);
    }));
  }).then(results => {
    const entries = results.filter(Boolean).map(r => ({
      username: r.data.username || 'Anon',
      color: r.data.color || '#f0b232',
      avatar: r.data.avatar || null,
      chips: r.data.chips || 0,
      stats: r.data.stats || {},
      tag: r.tag || (r.key ? keyToTag(r.key) : '????'),
      createdAt: r.data.createdAt,
      lastSeen: r.data.lastSeen,
    }));
    entries.sort((a, b) => b.chips - a.chips);
    _leaderboardCache = entries;
    _leaderboardCacheTime = Date.now();
  }).catch(err => {
    console.error('[accounts] Leaderboard refresh error:', err.message);
  }).finally(() => {
    _leaderboardRefreshing = false;
  });
}

function getLeaderboard(limit) {
  limit = limit || 50;
  const now = Date.now();
  if (_leaderboardCache && now - _leaderboardCacheTime < LEADERBOARD_CACHE_MS) {
    return _leaderboardCache.slice(0, limit);
  }
  // Prefer PostgreSQL leaderboard if available (indexed, no disk scan)
  if (db && db.isConnected) {
    db.getLeaderboard(limit).then(function(entries) {
      if (entries && entries.length > 0) {
        _leaderboardCache = entries;
        _leaderboardCacheTime = Date.now();
      }
    }).catch(function(err) { console.warn('[accounts] db leaderboard fetch failed:', err.message); });
  } else {
    // Trigger non-blocking file scan refresh in the background
    _refreshLeaderboardAsync();
  }
  // Return stale data if available, otherwise empty
  return _leaderboardCache ? _leaderboardCache.slice(0, limit) : [];
}

// ─── Inventory management — extracted to account-inventory.js ───
var _accountInventory = require('./account-inventory');
_accountInventory.init({ loadAccount, saveAccount });
var MAX_INVENTORY = _accountInventory.MAX_INVENTORY;
var addInventoryItem = _accountInventory.addInventoryItem;
var removeInventoryItem = _accountInventory.removeInventoryItem;
var equipItem = _accountInventory.equipItem;
var unequipItem = _accountInventory.unequipItem;
var getInventory = _accountInventory.getInventory;

// ─── TCG Card collection — extracted to account-rpg-cards.js ───
// (addCard, removeCard, getCards, MAX_CARDS wired from _accountRpgCards above)

// ─── Showcase favorites (items user wants to show off) ───

const MAX_SHOWCASE = 6;

function setShowcase(key, showcaseItems) {
  const account = loadAccount(key);
  if (!account) return null;
  // Validate: only allow strings or numbers in showcase array
  var safe = [];
  var items = (showcaseItems || []).slice(0, MAX_SHOWCASE);
  for (var i = 0; i < items.length; i++) {
    if (typeof items[i] === 'string' || typeof items[i] === 'number') {
      safe.push(items[i]);
    }
  }
  account.showcase = safe;
  saveAccount(account);
  return account.showcase;
}

function getShowcase(key) {
  const account = loadAccount(key);
  if (!account) return [];
  return account.showcase || [];
}

// ─── Clicker idle game state ───

function _safeNum(val, fallback) {
  if (typeof val !== 'number' || !isFinite(val) || isNaN(val)) return fallback;
  return val;
}

function updateClickerState(key, state) {
  const account = loadAccount(key);
  if (!account) return null;
  // Sanitize: only allow known fields, reject non-plain objects
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  if (Object.getPrototypeOf(state) !== Object.prototype && Object.getPrototypeOf(state) !== null) return null;
  // Sanitize levels: only allow safe keys with finite numeric values, cap at 50 entries
  var safeLevels = Object.create(null);
  if (state.levels && typeof state.levels === 'object' && !Array.isArray(state.levels)) {
    var levelKeys = Object.keys(state.levels);
    for (var i = 0; i < Math.min(levelKeys.length, 50); i++) {
      var lk = levelKeys[i];
      if (typeof lk === 'string' && /^[a-zA-Z0-9_]+$/.test(lk) && typeof state.levels[lk] === 'number' && isFinite(state.levels[lk])) {
        safeLevels[lk] = Math.max(0, Math.floor(state.levels[lk]));
      }
    }
  }
  account.clickerState = {
    chips: _safeNum(state.chips, 0),
    levels: safeLevels,
    totalClicks: _safeNum(state.totalClicks, 0),
    totalEarned: _safeNum(state.totalEarned, 0),
    lastSaveTime: Date.now(),
    _collectDay: typeof state._collectDay === 'string' ? state._collectDay.slice(0, 10) : null,
    _collectTotal: _safeNum(state._collectTotal, 0),
    lastInterestDate: typeof state.lastInterestDate === 'string' ? state.lastInterestDate.slice(0, 10) : null,
  };
  saveAccount(account);
  return account.clickerState;
}

function getClickerState(key) {
  const account = loadAccount(key);
  if (!account) return null;
  return account.clickerState || null;
}

// ─── Slot Upgrades ───

function getSlotUpgrades(key) {
  const account = loadAccount(key);
  return account ? (account.slotUpgrades || {}) : {};
}

function updateSlotUpgrades(key, upgrades) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!upgrades || typeof upgrades !== 'object' || Array.isArray(upgrades)) return null;
  var safe = {};
  var keys = Object.keys(upgrades);
  for (var i = 0; i < Math.min(keys.length, 50); i++) {
    var k = keys[i];
    if (typeof k === 'string' && /^[a-zA-Z0-9_]+$/.test(k) && typeof upgrades[k] === 'number') {
      safe[k] = Math.max(0, Math.floor(upgrades[k]));
    }
  }
  account.slotUpgrades = safe;
  saveAccount(account);
  return safe;
}

// ─── Scratch Upgrades ───

function getScratchUpgrades(key) {
  const account = loadAccount(key);
  return account ? (account.scratchUpgrades || {}) : {};
}

function updateScratchUpgrades(key, upgrades) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!upgrades || typeof upgrades !== 'object' || Array.isArray(upgrades)) return null;
  var safe = {};
  var keys = Object.keys(upgrades);
  for (var i = 0; i < Math.min(keys.length, 50); i++) {
    var k = keys[i];
    if (typeof k === 'string' && /^[a-zA-Z0-9_]+$/.test(k) && typeof upgrades[k] === 'number') {
      safe[k] = Math.max(0, Math.floor(upgrades[k]));
    }
  }
  account.scratchUpgrades = safe;
  saveAccount(account);
  return safe;
}

// Friends system — extracted to account-friends.js
var accountFriends = require('./account-friends');
accountFriends.init({ loadAccount: loadAccount, saveAccount: saveAccount, getPublicProfile: getPublicProfile, _keyHash: _keyHash, keyHashMap: keyHashMap });
var MAX_FRIENDS = accountFriends.MAX_FRIENDS;
var MAX_FRIEND_REQUESTS = accountFriends.MAX_FRIEND_REQUESTS;
var MAX_BLOCKED = accountFriends.MAX_BLOCKED;
var sendFriendRequest = accountFriends.sendFriendRequest;
var acceptFriendRequest = accountFriends.acceptFriendRequest;
var rejectFriendRequest = accountFriends.rejectFriendRequest;
var removeFriend = accountFriends.removeFriend;
var blockUser = accountFriends.blockUser;
var unblockUser = accountFriends.unblockUser;
var getFriendsData = accountFriends.getFriendsData;

// E2E Encrypted Direct Messages — extracted to account-dms.js
var accountDMs = require('./account-dms');
accountDMs.init({ loadAccount: loadAccount, saveAccount: saveAccount });
var MAX_DM_CONVERSATIONS = accountDMs.MAX_DM_CONVERSATIONS;
var MAX_DM_MESSAGES = accountDMs.MAX_DM_MESSAGES;
var setPublicKey = accountDMs.setPublicKey;
var getPublicKeyE2E = accountDMs.getPublicKey;
var storeDM = accountDMs.storeDM;
var getDMHistory = accountDMs.getDMHistory;
var getDMConversations = accountDMs.getDMConversations;
var deleteDMMessage = accountDMs.deleteDMMessage;
var clearDMs = accountDMs.clearDMs;

// ─── Clear DMs for ALL accounts (used during daily wipe) ───
function clearAllDMs() {
  // Clear from cache
  for (var [key, account] of accountCache) {
    if (account && account.dms && !account.temp) {
      account.dms = { conversations: {} };
      _queueWrite(account);
    }
  }
  // Also scan disk for accounts not in cache
  try {
    var files = fs.readdirSync(ACCOUNTS_DIR);
    for (var i = 0; i < files.length; i++) {
      if (!files[i].endsWith('.json')) continue;
      var fp = path.join(ACCOUNTS_DIR, files[i]);
      try {
        var buf = fs.readFileSync(fp);
        var acc;
        try {
          var decrypted = _decryptData(buf);
          if (decrypted) acc = JSON.parse(decrypted);
        } catch (_) {}
        if (!acc) {
          try { acc = JSON.parse(buf.toString('utf8')); } catch (_) {}
        }
        if (acc && acc.dms && Object.keys(acc.dms.conversations || {}).length > 0) {
          acc.dms = { conversations: {} };
          // Write scrubbed version for accounts not in cache
          var accKey = acc.key || (acc.keyHash && keyHashMap.has(acc.keyHash) ? keyHashMap.get(acc.keyHash) : null);
          if (!accKey || !accountCache.has(accKey)) {
            var scrubbed = acc.key ? _scrubForDisk(acc) : acc; // already scrubbed if no raw key
            var jsonStr = JSON.stringify(scrubbed);
            var encrypted = _encryptData(jsonStr);
            fs.writeFileSync(fp, encrypted);
          }
        }
      } catch (_) { continue; }
    }
  } catch (_) {}
  console.log('[accounts] All DM conversations cleared');
}

// Cleanup expired accounts (async, non-blocking)
function cleanupExpiredAccounts() {
  fs.promises.readdir(ACCOUNTS_DIR).then(files => {
    files = files.filter(f => f.endsWith('.json'));
    let cleaned = 0;
    return Promise.all(files.map(file => {
      const fp = path.join(ACCOUNTS_DIR, file);
      return fs.promises.readFile(fp).then(buf => {
        var acc;
        try {
          var decrypted = _decryptData(buf);
          if (decrypted) acc = JSON.parse(decrypted);
        } catch (_) {}
        if (!acc) {
          try { acc = JSON.parse(buf.toString('utf8')); } catch (_) {}
        }
        if (acc && isAccountExpired(acc)) {
          // Handle both legacy (raw key) and new (keyHash) formats
          if (acc.key) accountCache.delete(acc.key);
          if (acc.keyHash) {
            var resolvedKey = keyHashMap.get(acc.keyHash);
            if (resolvedKey) accountCache.delete(resolvedKey);
            keyHashMap.delete(acc.keyHash);
          }
          cleaned++;
          return fs.promises.unlink(fp).catch(() => {});
        }
      }).catch(() => { /* skip corrupt files */ });
    })).then(() => {
      if (cleaned > 0) console.log('[accounts] Cleaned up ' + cleaned + ' expired accounts');
      return cleaned;
    });
  }).catch(err => {
    console.error('[accounts] Cleanup error:', err.message);
  });
  return 0;
}

// ─── Background re-encryption: migrate files from old key versions to current ───
var _reencryptRunning = false;
function reencryptAccounts() {
  if (_reencryptRunning) return;
  if (ENCRYPTION_KEYS.length <= 1 && CURRENT_VERSION === 0) return; // nothing to rotate
  _reencryptRunning = true;
  var migrated = 0;
  fs.promises.readdir(ACCOUNTS_DIR).then(function(files) {
    files = files.filter(function(f) { return f.endsWith('.json'); });
    return files.reduce(function(chain, file) {
      return chain.then(function() {
        var fp = path.join(ACCOUNTS_DIR, file);
        return fs.promises.readFile(fp).then(function(buf) {
          // If current version > 0, check if file already has current version prefix
          if (CURRENT_VERSION > 0 && buf.length >= 30 && buf[0] === CURRENT_VERSION) {
            return; // already current
          }
          var plaintext = _decryptData(buf);
          if (!plaintext) return; // corrupt or undecryptable — skip
          var reencrypted = _encryptData(plaintext);
          return fs.promises.writeFile(fp, reencrypted).then(function() { migrated++; });
        }).catch(function() { /* skip errors */ });
      });
    }, Promise.resolve());
  }).then(function() {
    if (migrated > 0) console.log('[accounts] Re-encrypted ' + migrated + ' account files to key version ' + CURRENT_VERSION);
  }).catch(function(err) {
    console.error('[accounts] Re-encryption error:', err.message);
  }).finally(function() {
    _reencryptRunning = false;
  });
}

// ---------------------------------------------------------------------------
// Iterate all accounts — decrypt, apply callback, re-encrypt, write.
// Synchronous: used by doom ascension (server is paused, all players kicked).
// Also updates accountCache for any in-memory copies.
// ---------------------------------------------------------------------------

function iterateAllAccounts(callback) {
  var files;
  try { files = fs.readdirSync(ACCOUNTS_DIR); } catch (e) { return 0; }
  files = files.filter(function(f) { return f.endsWith('.json'); });

  var processed = 0;
  for (var i = 0; i < files.length; i++) {
    var fp = path.join(ACCOUNTS_DIR, files[i]);
    try {
      var buf = fs.readFileSync(fp);
      var plaintext = _decryptData(buf);
      if (!plaintext) continue; // corrupt or undecryptable — skip

      var account = JSON.parse(plaintext);
      if (!account) continue;

      // Apply the callback (e.g. doomWipeAccount)
      callback(account);

      // Re-serialize and write (account on disk uses scrubbed format with keyHash)
      var jsonStr = JSON.stringify(account);
      var encrypted = _encryptData(jsonStr);
      fs.writeFileSync(fp, encrypted);
      processed++;
    } catch (err) {
      console.error('[accounts] iterateAllAccounts error for ' + files[i] + ':', err.message);
    }
  }

  // Also wipe any cached accounts still in memory
  accountCache.forEach(function(acc) {
    if (acc && !acc.temp) callback(acc);
  });

  return processed;
}

// ─── MMO Resource Inventory ───

// Per-account resource lock to prevent TOCTOU races (same pattern as _chipLocks)
const _resourceLocks = new Map();

function _acquireResourceLock(key) {
  var entry = _resourceLocks.get(key);
  if (!entry) {
    entry = { depth: 0 };
    _resourceLocks.set(key, entry);
  }
  entry.depth++;
  return function release() {
    entry.depth--;
    if (entry.depth <= 0) {
      _resourceLocks.delete(key);
    }
  };
}

function addResource(key, resourceType, amount) {
  if (rpgData.ALL_RESOURCE_TYPES.indexOf(resourceType) === -1) return null;
  if (typeof amount !== 'number' || amount <= 0) return null;
  var release = _acquireResourceLock(key);
  try {
    const account = loadAccount(key);
    if (!account) return null;
    if (!account.mmoInventory) account.mmoInventory = { wood: 0, stone: 0, iron_ore: 0, iron_bar: 0, items: [] };
    account.mmoInventory[resourceType] = (account.mmoInventory[resourceType] || 0) + amount;
    saveAccount(account);
    return account.mmoInventory;
  } finally {
    release();
  }
}

function removeResource(key, resourceType, amount) {
  if (rpgData.ALL_RESOURCE_TYPES.indexOf(resourceType) === -1) return null;
  if (typeof amount !== 'number' || amount <= 0) return null;
  var release = _acquireResourceLock(key);
  try {
    const account = loadAccount(key);
    if (!account) return null;
    if (!account.mmoInventory) return null;
    var current = account.mmoInventory[resourceType] || 0;
    if (current < amount) return null; // not enough
    account.mmoInventory[resourceType] = current - amount;
    saveAccount(account);
    return account.mmoInventory;
  } finally {
    release();
  }
}

var getMMOInventory = _accountInventory.getMMOInventory;
var addMMOItem = _accountInventory.addMMOItem;
var removeMMOItem = _accountInventory.removeMMOItem;

var equipData = require('./equipment-data');
var EQUIPMENT_SLOTS = equipData.EQUIPMENT_SLOTS;
var VALID_AXES = equipData.VALID_AXES;
var VALID_PICKAXES = equipData.VALID_PICKAXES;
var COMBAT_SKILL_FOR_CATEGORY = equipData.COMBAT_SKILL_FOR_CATEGORY;
var RARITY_COMBAT_LEVEL = equipData.RARITY_COMBAT_LEVEL;
var WEAPON_TYPES = equipData.WEAPON_TYPES;
var DURABILITY_BY_MATERIAL = equipData.DURABILITY_BY_MATERIAL;
var ARMOR_SLOTS = equipData.ARMOR_SLOTS;
var WEAPON_SLOTS = equipData.WEAPON_SLOTS;
var TOOL_SLOTS = equipData.TOOL_SLOTS;
var JEWELRY_SLOTS = equipData.JEWELRY_SLOTS;
var REPAIR_MATERIAL_COST = equipData.REPAIR_MATERIAL_COST;
var getItemMaterial = equipData.getItemMaterial;
var getMaxDurability = equipData.getMaxDurability;
var ensureItemDurability = equipData.ensureItemDurability;
var DUAL_WIELD_COMBOS = equipData.DUAL_WIELD_COMBOS;
var categorizeHandItem = equipData.categorizeHandItem;

var _accountEquipment = require('./account-equipment');
_accountEquipment.init({ loadAccount: loadAccount, saveAccount: saveAccount });
var reduceDurability = _accountEquipment.reduceDurability;
var reduceArmorDurability = _accountEquipment.reduceArmorDurability;
var reduceWeaponDurability = _accountEquipment.reduceWeaponDurability;
var getEquipmentDurability = _accountEquipment.getEquipmentDurability;
var repairEquipmentSlot = _accountEquipment.repairEquipmentSlot;
var isItemBroken = _accountEquipment.isItemBroken;
var migrateHandSlots = _accountEquipment.migrateHandSlots;
var getDefaultEquipment = _accountEquipment.getDefaultEquipment;
var getEquipment = _accountEquipment.getEquipment;
var equipMMOItem = _accountEquipment.equipMMOItem;
var unequipMMOItem = _accountEquipment.unequipMMOItem;
var resolveItemStats = _accountEquipment.resolveItemStats;
var getEquippedHandStats = _accountEquipment.getEquippedHandStats;
var getEquippedWeaponStats = _accountEquipment.getEquippedWeaponStats;
var getEquippedArmorTotal = _accountEquipment.getEquippedArmorTotal;
var getEquippedArmorStats = _accountEquipment.getEquippedArmorStats;
var getGenericCombo = _accountEquipment.getGenericCombo;
var getDualWieldCombo = _accountEquipment.getDualWieldCombo;

function getPlotId(key) {
  var account = loadAccount(key);
  if (!account) return null;
  return account.plotId || null;
}

function setPlotId(key, plotId) {
  var account = loadAccount(key);
  if (!account) return false;
  account.plotId = plotId;
  saveAccount(account);
  return true;
}

function getLastLocation(key) {
  var account = loadAccount(key);
  if (!account) return null;
  if (!account.lastZone) return null;
  return {
    zoneId: account.lastZone,
    x: account.lastPosition ? account.lastPosition.x : 0,
    y: account.lastPosition ? account.lastPosition.y : 0,
  };
}

function setLastLocation(key, zoneId, x, y) {
  var account = loadAccount(key);
  if (!account) return false;
  account.lastZone = zoneId;
  account.lastPosition = { x: Math.floor(x), y: Math.floor(y) };
  saveAccount(account);
  return true;
}

// ---------------------------------------------------------------------------
// RPG: Race selection
// ---------------------------------------------------------------------------

function setRace(key, raceId) {
  if (!rpgData.RACE_IDS.includes(raceId)) return { error: 'Invalid race' };
  var account = loadAccount(key);
  if (!account) return { error: 'Account not found' };
  if (account.race != null) return { error: 'Race already chosen (permanent)' };
  account.race = raceId;
  // Apply racial stat bumps
  if (!account.rpgStats) account.rpgStats = rpgData.getDefaultStats();
  rpgData.applyRaceBumps(account.rpgStats, raceId);
  saveAccount(account);
  return { success: true, race: raceId, rpgStats: account.rpgStats };
}

// ---------------------------------------------------------------------------
// RPG: Stat allocation
// ---------------------------------------------------------------------------

function allocateStatPoint(key, statName) {
  if (!rpgData.STAT_KEYS.includes(statName)) return { error: 'Invalid stat' };
  var account = loadAccount(key);
  if (!account) return { error: 'Account not found' };
  if (!account.rpgStats) account.rpgStats = rpgData.getDefaultStats();
  if ((account.rpgStats.freePoints || 0) <= 0) return { error: 'No free stat points' };
  account.rpgStats[statName]++;
  account.rpgStats.freePoints--;
  saveAccount(account);
  return { success: true, rpgStats: account.rpgStats, computedStats: rpgData.computeStats(account.rpgStats, account.level, account.race) };
}

function getComputedStats(key) {
  var account = loadAccount(key);
  if (!account) return null;
  return rpgData.computeStats(account.rpgStats || rpgData.getDefaultStats(), account.level || 1, account.race);
}

// (account-rpg-cards required earlier, before account-skills init)

// ---------------------------------------------------------------------------
// RPG: Mount management
// ---------------------------------------------------------------------------

function setMount(key, mountType) {
  var account = loadAccount(key);
  if (!account) return null;
  account.mount = mountType || null;
  saveAccount(account);
  return account.mount;
}

function getMount(key) {
  var account = loadAccount(key);
  if (!account) return null;
  return account.mount || null;
}

// ---------------------------------------------------------------------------
// Character slots / Hall of Heroes — extracted to account-characters.js
// ---------------------------------------------------------------------------
var _accountCharacters = require('./account-characters');
_accountCharacters.init({
  loadAccount: loadAccount, saveAccount: saveAccount,
  _getDefaultForField: _getDefaultForField, CHARACTER_FIELDS: CHARACTER_FIELDS,
  MAX_CHARACTERS_PER_ACCOUNT: MAX_CHARACTERS_PER_ACCOUNT, sanitizeName: sanitizeName,
});
var createCharacter = _accountCharacters.createCharacter;
var switchCharacter = _accountCharacters.switchCharacter;
var deleteCharacter = _accountCharacters.deleteCharacter;
var getCharacterList = _accountCharacters.getCharacterList;
var archiveToHallOfHeroes = _accountCharacters.archiveToHallOfHeroes;
var getHallOfHeroes = _accountCharacters.getHallOfHeroes;
var deleteActiveCharacterForPermadeath = _accountCharacters.deleteActiveCharacterForPermadeath;
var incrementLeviathanKill = _accountCharacters.incrementLeviathanKill;

// ---------------------------------------------------------------------------
// Weight / Encumbrance System — extracted to account-weight.js
// ---------------------------------------------------------------------------
var _accountWeight = require('./account-weight');
var ITEM_WEIGHTS = _accountWeight.ITEM_WEIGHTS;
var getCarryCapacity = _accountWeight.getCarryCapacity;
var getCurrentWeight = _accountWeight.getCurrentWeight;
var getEncumbranceLevel = _accountWeight.getEncumbranceLevel;
var getSpeedMultiplier = _accountWeight.getSpeedMultiplier;

// ---------------------------------------------------------------------------
// Card evolution / mutation — extracted to account-rpg-evolution.js
// ---------------------------------------------------------------------------
var _accountRpgEvolution = require('./account-rpg-evolution');
_accountRpgEvolution.init({ loadAccount: loadAccount, saveAccount: saveAccount, invalidateCardEffectsCache: invalidateCardEffectsCache });
var gainCardEvolutionXp = _accountRpgEvolution.gainCardEvolutionXp;
var gainArchetypeCategoryXp = _accountRpgEvolution.gainArchetypeCategoryXp;
var applyEvolutionPath = _accountRpgEvolution.applyEvolutionPath;

// Deferred init: account-rpg-cards needs _spreadMutation from evolution (circular dep)
_accountRpgCards.init({ loadAccount: loadAccount, saveAccount: saveAccount, _spreadMutation: _accountRpgEvolution._spreadMutation });

module.exports = {
  createAccount,
  createTempAccount,
  promoteTempAccount,
  isTempAccount,
  loadAccount,
  saveAccount,
  updateChips,
  setChips,
  updateStats,
  deleteAccount,
  getPublicProfile,
  addFavoriteGif,
  removeFavoriteGif,
  getFavoriteGifs,
  getLeaderboard,
  addInventoryItem,
  removeInventoryItem,
  equipItem,
  unequipItem,
  getInventory,
  addCard,
  removeCard,
  getCards,
  setShowcase,
  getShowcase,
  updateClickerState,
  getClickerState,
  getSlotUpgrades,
  updateSlotUpgrades,
  getScratchUpgrades,
  updateScratchUpgrades,
  cleanupExpiredAccounts,
  isAccountExpired,
  getDiscriminator,
  getUserTag,
  findAccountByTag,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  blockUser,
  unblockUser,
  getFriendsData,
  flushAll,
  setPublicKey,
  getPublicKey: getPublicKeyE2E,
  storeDM,
  getDMHistory,
  getDMConversations,
  ACCOUNTS_DIR,
  MAX_INVENTORY,
  MAX_CARDS,
  MAX_SHOWCASE,
  MAX_FRIENDS,
  MAX_FRIEND_REQUESTS,
  MAX_BLOCKED,
  ACCOUNT_EXPIRY_DAYS,
  MAX_CHIPS,
  MAX_DM_CONVERSATIONS,
  MAX_DM_MESSAGES,
  hashPin,
  verifyPin,
  setPinForAccount,
  clearDMs,
  clearAllDMs,
  deleteDMMessage,
  reencryptAccounts,
  keyHashMap,
  _keyHash,
  searchUsernames,
  getMemberCount,
  getSkill,
  addSkillXp,
  xpForLevel,
  addResource,
  removeResource,
  acquireResourceLock: _acquireResourceLock,
  getMMOInventory,
  addMMOItem,
  removeMMOItem,
  getEquipment,
  equipMMOItem,
  unequipMMOItem,
  getEquippedWeaponStats,
  getEquippedHandStats,
  getDualWieldCombo,
  categorizeHandItem,
  DUAL_WIELD_COMBOS,
  getEquippedArmorTotal,
  getEquippedArmorStats,
  resolveItemStats,
  EQUIPMENT_SLOTS,
  WEAPON_TYPES,
  COMBAT_SKILL_FOR_CATEGORY,
  RARITY_COMBAT_LEVEL,
  // Durability system
  ARMOR_SLOTS,
  WEAPON_SLOTS,
  TOOL_SLOTS,
  JEWELRY_SLOTS,
  ensureItemDurability,
  reduceDurability,
  reduceArmorDurability,
  reduceWeaponDurability,
  getEquipmentDurability,
  repairEquipmentSlot,
  isItemBroken,
  getItemMaterial,
  getMaxDurability,
  DURABILITY_BY_MATERIAL,
  REPAIR_MATERIAL_COST,
  getPlotId,
  setPlotId,
  getLastLocation,
  setLastLocation,
  // RPG
  setRace,
  allocateStatPoint,
  getComputedStats,
  addPendingPack,
  openPendingPack,
  equipRpgCard,
  unequipRpgCard,
  fuseRpgCards,
  getRpgCards,
  getEquippedCardEffects,
  getPlayerLuck,
  invalidateCardEffectsCache,
  gainCardEvolutionXp,
  gainArchetypeCategoryXp,
  applyEvolutionPath,
  selectAwakening,
  setMount,
  getMount,
  rpgData,
  acquireCardLock,
  releaseCardLock,
  // Character slots
  MAX_CHARACTERS_PER_ACCOUNT,
  CHARACTER_FIELDS,
  createCharacter,
  switchCharacter,
  deleteCharacter,
  getCharacterList,
  // Permadeath / Hall of Heroes
  archiveToHallOfHeroes,
  getHallOfHeroes,
  deleteActiveCharacterForPermadeath,
  // Leviathan kill tracking
  incrementLeviathanKill,
  // Shard bridge: import account from master server into local cache
  importAccount,
  // Async startup preload (call after server starts listening)
  preloadKeyIndex,
  // Weight / Encumbrance
  ITEM_WEIGHTS,
  getCarryCapacity,
  getCurrentWeight,
  getEncumbranceLevel,
  getSpeedMultiplier,
  // Doom ascension: iterate all accounts through encrypted pipeline
  iterateAllAccounts,
};

// Import an account object from the master server into the local cache.
// Used by shard-bridge.js to inject character data without needing disk files.
function importAccount(accountData) {
  if (!accountData || !accountData.key) return null;
  accountCache.set(accountData.key, accountData);
  return accountData;
}

function getMemberCount() {
  return _leaderboardCache ? _leaderboardCache.length : 0;
}

// Search permanent accounts by partial username (uses leaderboard cache)
function searchUsernames(query, limit) {
  limit = limit || 10;
  if (!query || typeof query !== 'string') return [];
  var q = query.toLowerCase().trim();
  if (q.length < 1) return [];
  var results = [];
  var seen = new Set();
  // Search leaderboard cache first (already loaded in memory)
  if (_leaderboardCache) {
    for (var i = 0; i < _leaderboardCache.length; i++) {
      var entry = _leaderboardCache[i];
      if (entry.username && entry.username.toLowerCase().indexOf(q) !== -1) {
        var key = entry.username.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ name: entry.username, color: entry.color || '#f0b232', tag: entry.tag || '' });
          if (results.length >= limit) return results;
        }
      }
    }
  }
  // Also scan accountCache for any not in leaderboard
  for (var [, acc] of accountCache) {
    if (acc && acc.username && !acc.temp && acc.username.toLowerCase().indexOf(q) !== -1) {
      var k = acc.username.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        results.push({ name: acc.username, color: acc.color || '#f0b232', tag: '' });
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}
