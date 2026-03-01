// pow.js — Proof-of-Work challenge system for BossCord
// No third-party dependencies. SHA-256 hash puzzle.
// Clients must find a nonce where SHA256(challenge + nonce) has N leading zero bits.

const crypto = require('crypto');

// Difficulty levels (number of leading zero BITS in SHA-256 hash)
const DIFFICULTY_CONNECT = 9;    // ~512 hashes, very fast
const DIFFICULTY_ACCOUNT = 10;   // ~1K hashes, fast
var OFFLINE_DIFFICULTY = 1;      // trivial difficulty for offline/local mode

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes to solve
const CLEANUP_INTERVAL_MS = 60 * 1000;  // clean expired challenges every minute

// Track issued challenges: Map<challengeHex, { difficulty, createdAt }>
const issuedChallenges = new Map();
// Track used solutions to prevent replay: Set<challengeHex>
const usedChallenges = new Set();

// Track when used challenges were added so we can clean them up
const usedChallengeTimestamps = new Map();

// Auto-purge expired challenges (both issued and used)
setInterval(() => {
  const now = Date.now();
  for (const [ch, data] of issuedChallenges) {
    if (now - data.createdAt > CHALLENGE_TTL_MS) {
      issuedChallenges.delete(ch);
      usedChallenges.delete(ch);
      usedChallengeTimestamps.delete(ch);
    }
  }
  // Also clean up verified challenges that were removed from issuedChallenges
  for (const [ch, ts] of usedChallengeTimestamps) {
    if (now - ts > CHALLENGE_TTL_MS) {
      usedChallenges.delete(ch);
      usedChallengeTimestamps.delete(ch);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

/**
 * Generate a new PoW challenge.
 * @param {'connect'|'account'} type
 * @returns {{ challenge: string, difficulty: number }}
 */
function generateChallenge(type) {
  const difficulty = process.env.OFFLINE_MODE === '1'
    ? OFFLINE_DIFFICULTY
    : (type === 'account' ? DIFFICULTY_ACCOUNT : DIFFICULTY_CONNECT);
  const challenge = crypto.randomBytes(16).toString('hex'); // 32-char hex string
  issuedChallenges.set(challenge, { difficulty, createdAt: Date.now() });
  return { challenge, difficulty };
}

/**
 * Check if a hash has at least `difficulty` leading zero bits.
 * @param {Buffer} hashBuf - 32-byte SHA-256 hash
 * @param {number} difficulty - required leading zero bits
 * @returns {boolean}
 */
function hasLeadingZeros(hashBuf, difficulty) {
  const fullBytes = Math.floor(difficulty / 8);
  const remainBits = difficulty % 8;

  // Check full zero bytes
  for (let i = 0; i < fullBytes; i++) {
    if (hashBuf[i] !== 0) return false;
  }

  // Check remaining bits
  if (remainBits > 0) {
    const mask = 0xFF << (8 - remainBits);
    if ((hashBuf[fullBytes] & mask) !== 0) return false;
  }

  return true;
}

/**
 * Verify a PoW solution.
 * @param {string} challenge - The challenge hex string
 * @param {string} nonce - The client's nonce solution
 * @returns {{ valid: boolean, error?: string }}
 */
function verify(challenge, nonce) {
  if (!challenge || typeof challenge !== 'string') {
    return { valid: false, error: 'Missing challenge' };
  }
  if (!nonce || typeof nonce !== 'string') {
    return { valid: false, error: 'Missing nonce' };
  }
  if (nonce.length > 32) {
    return { valid: false, error: 'Nonce too long' };
  }

  // Check if challenge was issued by us
  const issued = issuedChallenges.get(challenge);
  if (!issued) {
    return { valid: false, error: 'Unknown or expired challenge' };
  }

  // Check if challenge is expired
  if (Date.now() - issued.createdAt > CHALLENGE_TTL_MS) {
    issuedChallenges.delete(challenge);
    return { valid: false, error: 'Challenge expired' };
  }

  // Check if challenge was already used (anti-replay)
  if (usedChallenges.has(challenge)) {
    return { valid: false, error: 'Challenge already used' };
  }

  // Verify the hash
  const checkDifficulty = process.env.OFFLINE_MODE === '1' ? OFFLINE_DIFFICULTY : issued.difficulty;
  const hash = crypto.createHash('sha256').update(challenge + nonce).digest();
  if (!hasLeadingZeros(hash, checkDifficulty)) {
    return { valid: false, error: 'Invalid solution' };
  }

  // Mark challenge as used (with timestamp for cleanup)
  usedChallenges.add(challenge);
  usedChallengeTimestamps.set(challenge, Date.now());
  issuedChallenges.delete(challenge);

  return { valid: true };
}

/**
 * How many active challenges (for monitoring).
 */
function activeCount() {
  return issuedChallenges.size;
}

module.exports = {
  generateChallenge,
  verify,
  activeCount,
  DIFFICULTY_CONNECT,
  DIFFICULTY_ACCOUNT,
  OFFLINE_DIFFICULTY,
};
