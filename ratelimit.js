// ratelimit.js — Ephemeral IP-based rate limiter for BossCord
// IPs held in memory ONLY, auto-purged after TTL. Never written to disk.

const IP_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // clean every 10 minutes
const MAX_GLOBAL_CONNECTIONS = 5000;

// --- Violation tracking (exponential backoff) ---
// Map<ip, { count: number, windowStart: number }>
const violations = new Map();
const VIOLATION_WINDOW_MS = 60 * 60 * 1000; // 1 hour window for violation accumulation

// --- Auto-ban system ---
// Map<ip, { bannedAt: number, expiresAt: number }>
const bannedIps = new Map();
const BAN_THRESHOLD = 50; // violations in 1 hour triggers auto-ban
const BAN_DURATION_MS = 60 * 60 * 1000; // 1 hour ban

// --- Global connection counter ---
let connectionCount = 0;

// Map<ip, { events: Map<eventName, [timestamps]>, firstSeen: number }>
const ipStore = new Map();

// --- Security event logging ---
/**
 * Log a structured security event to console.
 * @param {string} event - Event name (e.g. 'rate_limit_exceeded', 'ip_banned')
 * @param {object} data - Contextual data to include in the log
 */
function logSecurity(event, data) {
  const entry = {
    level: 'SECURITY',
    timestamp: Date.now(),
    event: event,
    ...data,
  };
  console.log(`[SECURITY] ${JSON.stringify(entry)}`);
}

// Auto-purge expired IPs, stale violations, and expired bans
setInterval(() => {
  const now = Date.now();

  // Purge expired IP entries
  for (const [ip, data] of ipStore) {
    if (now - data.firstSeen > IP_TTL_MS) {
      ipStore.delete(ip);
    }
  }

  // Purge expired violations
  for (const [ip, v] of violations) {
    if (now - v.windowStart > VIOLATION_WINDOW_MS) {
      violations.delete(ip);
    }
  }

  // Purge expired bans
  for (const [ip, ban] of bannedIps) {
    if (now >= ban.expiresAt) {
      bannedIps.delete(ip);
      logSecurity('ban_expired', { ip: ip });
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

/**
 * Check if an IP is currently banned.
 * Also handles lazy expiry (cleans up if ban has expired).
 * @param {string} ip
 * @returns {boolean}
 */
function isBanned(ip) {
  if (!ip) return false;
  // No bans in offline/solo mode
  if (process.env.OFFLINE_MODE === '1') return false;
  const ban = bannedIps.get(ip);
  if (!ban) return false;
  if (Date.now() >= ban.expiresAt) {
    bannedIps.delete(ip);
    logSecurity('ban_expired', { ip: ip });
    return false;
  }
  return true;
}

/**
 * Manually ban an IP for the default ban duration.
 * @param {string} ip
 * @param {number} [durationMs] - Optional custom duration, defaults to BAN_DURATION_MS
 */
function banIp(ip, durationMs) {
  if (!ip) return;
  const duration = typeof durationMs === 'number' && durationMs > 0 ? durationMs : BAN_DURATION_MS;
  const now = Date.now();
  bannedIps.set(ip, { bannedAt: now, expiresAt: now + duration });
  logSecurity('ip_banned', { ip: ip, durationMs: duration });
}

/**
 * Record a violation for an IP. If threshold is exceeded, auto-ban.
 * @param {string} ip
 * @param {string} event - The event/action that triggered the violation
 */
function recordViolation(ip, event) {
  if (!ip) return;
  const now = Date.now();
  let v = violations.get(ip);
  if (!v || now - v.windowStart > VIOLATION_WINDOW_MS) {
    // Start a fresh window
    v = { count: 0, windowStart: now };
    violations.set(ip, v);
  }
  v.count++;

  if (v.count > BAN_THRESHOLD) {
    banIp(ip);
    logSecurity('auto_ban_triggered', { ip: ip, violations: v.count, triggerEvent: event });
    // Reset violation count after banning so they start fresh post-ban
    violations.delete(ip);
  }
}

/**
 * Get the current violation count for an IP.
 * @param {string} ip
 * @returns {number}
 */
function getViolationCount(ip) {
  if (!ip) return 0;
  const v = violations.get(ip);
  if (!v) return 0;
  // If window has expired, clean up and return 0
  if (Date.now() - v.windowStart > VIOLATION_WINDOW_MS) {
    violations.delete(ip);
    return 0;
  }
  return v.count;
}

/**
 * Get or create an IP entry (refreshes on access but expires from firstSeen).
 */
function getEntry(ip) {
  if (!ip) return null;
  let entry = ipStore.get(ip);
  if (!entry || Date.now() - entry.firstSeen > IP_TTL_MS) {
    entry = { events: new Map(), firstSeen: Date.now() };
    ipStore.set(ip, entry);
  }
  return entry;
}

/**
 * Calculate an effective (tighter) max based on violation count.
 * More violations = lower effective max, making limits stricter.
 * Uses exponential backoff: effective_max = max / (2 ^ min(violationCount, 5))
 * Floor of 1 to always allow at least 1 action per window.
 * @param {number} max - Original max allowed in window
 * @param {number} violationCount - Current violation count for the IP
 * @returns {number} Adjusted max
 */
function getEffectiveMax(max, violationCount) {
  if (violationCount <= 0) return max;
  // Cap the exponent at 5 to avoid reducing to near-zero too aggressively
  const exponent = Math.min(violationCount, 5);
  const divisor = Math.pow(2, exponent);
  return Math.max(1, Math.floor(max / divisor));
}

/**
 * Check if an action is allowed for this IP.
 * @param {string} ip - Client IP
 * @param {string} event - Event/action name (e.g. 'account_create', 'connect', 'upload')
 * @param {number} max - Max allowed in window
 * @param {number} windowMs - Time window in ms
 * @param {object} [opts] - Options
 * @param {boolean} [opts.skipViolation] - If true, don't apply violation escalation or record violations
 * @returns {boolean} true if allowed
 */
function check(ip, event, max, windowMs, opts) {
  // No rate limiting in offline/solo mode
  if (process.env.OFFLINE_MODE === '1') return true;

  // Banned IPs are always denied
  if (isBanned(ip)) {
    logSecurity('banned_ip_attempt', { ip: ip, action: event });
    return false;
  }

  const entry = getEntry(ip);
  if (!entry) return true; // no IP = allow (fallback)

  const now = Date.now();
  let timestamps = entry.events.get(event);
  if (!timestamps) {
    timestamps = [];
    entry.events.set(event, timestamps);
  }

  // Prune old timestamps
  while (timestamps.length > 0 && now - timestamps[0] > windowMs) {
    timestamps.shift();
  }

  // Apply exponential backoff unless skipViolation is set
  var effectiveMax = max;
  if (!(opts && opts.skipViolation)) {
    const violationCount = getViolationCount(ip);
    effectiveMax = getEffectiveMax(max, violationCount);
  }

  if (timestamps.length >= effectiveMax) {
    // Rate limit exceeded — record violation unless skipViolation
    if (!(opts && opts.skipViolation)) {
      recordViolation(ip, event);
      const vc = getViolationCount(ip);
      logSecurity('rate_limit_exceeded', { ip: ip, action: event, effectiveMax: effectiveMax, originalMax: max, violations: vc });
    }
    return false;
  }
  timestamps.push(now);
  return true;
}

/**
 * Extract client IP from a socket handshake or HTTP request.
 * Uses X-Real-IP (set by nginx from $remote_addr, not client-spoofable)
 * as the primary source. Falls back to X-Forwarded-For first entry only
 * if X-Real-IP is absent. Direct connection address used as last resort.
 */
function _isTrustedProxy(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function getIp(source) {
  if (!source) return null;

  // Socket.IO socket
  if (source.handshake) {
    const directIp = source.handshake.address;
    // Only trust proxy headers if connection comes from loopback (nginx)
    if (_isTrustedProxy(directIp)) {
      const headers = source.handshake.headers || {};
      if (headers['x-real-ip']) return headers['x-real-ip'].trim();
      if (headers['x-forwarded-for']) return headers['x-forwarded-for'].split(',')[0].trim();
    }
    return directIp || null;
  }

  // Express request (with trust proxy set, req.ip is reliable)
  if (source.ip) return source.ip;
  const directIp = source.connection?.remoteAddress || null;
  if (_isTrustedProxy(directIp)) {
    const headers = source.headers || {};
    if (headers['x-real-ip']) return headers['x-real-ip'].trim();
    if (headers['x-forwarded-for']) return headers['x-forwarded-for'].split(',')[0].trim();
  }
  return directIp;
}

/**
 * Return the current event count for a key within the window, without
 * consuming a slot or recording any violations. Safe to call freely.
 * @param {string} key - IP or socket ID
 * @param {string} event - Event/action name
 * @param {number} windowMs - Time window in ms
 * @returns {number} Number of events recorded within the window
 */
function peekCount(key, event, windowMs) {
  const entry = ipStore.get(key);
  if (!entry) return 0;
  const timestamps = entry.events.get(event);
  if (!timestamps || timestamps.length === 0) return 0;
  const cutoff = Date.now() - windowMs;
  let count = 0;
  // Timestamps are in ascending order; count from the end
  for (let i = timestamps.length - 1; i >= 0; i--) {
    if (timestamps[i] > cutoff) count++;
    else break;
  }
  return count;
}

/**
 * How many IPs are currently tracked (for monitoring).
 */
function size() {
  return ipStore.size;
}

// --- Global connection counter ---

function getConnectionCount() {
  return connectionCount;
}

function incrementConnections() {
  connectionCount++;
  return connectionCount;
}

function decrementConnections() {
  if (connectionCount > 0) connectionCount--;
  return connectionCount;
}

module.exports = {
  check,
  peekCount,
  getIp,
  size,
  IP_TTL_MS,
  isBanned,
  banIp,
  logSecurity,
  getConnectionCount,
  incrementConnections,
  decrementConnections,
  MAX_GLOBAL_CONNECTIONS,
  getViolationCount,
};
