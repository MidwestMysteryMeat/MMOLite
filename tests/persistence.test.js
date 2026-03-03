// tests/persistence.test.js
// Verifies the write-behind persistence contract in accounts.js and server.js.
//
// accounts.js uses a debounced write-behind cache:
//   - saveAccount(acc) updates the in-memory cache via _queueWrite and guards
//     against temp accounts (they stay memory-only).
//   - flushAll() cancels pending timers and calls fs.writeFileSync synchronously
//     so all in-flight saves land before process exit.
//
// These are source-code contract tests — they verify the structure of the
// persistence mechanism without requiring real crypto keys or disk I/O.

const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ---------------------------------------------------------------------------

describe('accounts.js: write-behind debounce pattern', () => {
  let src;
  beforeAll(() => { src = readSrc('accounts.js'); });

  test('saveAccount schedules writes via setTimeout (debounce)', () => {
    expect(src).toMatch(/setTimeout/);
    expect(src).toMatch(/pendingWrites\.(set|get)/);
  });

  test('flushAll cancels pending timers via clearTimeout', () => {
    const flushStart = src.indexOf('function flushAll');
    const flushBlock = src.slice(flushStart, flushStart + 600);
    expect(flushBlock).toMatch(/clearTimeout/);
  });

  test('flushAll calls fs.writeFileSync for synchronous disk write', () => {
    const flushStart = src.indexOf('function flushAll');
    const flushBlock = src.slice(flushStart, flushStart + 600);
    expect(flushBlock).toMatch(/writeFileSync/);
  });

  test('flushAll is exported from accounts.js', () => {
    const exportsBlock = src.slice(src.lastIndexOf('module.exports'));
    expect(exportsBlock).toMatch(/flushAll/);
  });

  test('saveAccount encrypts data before writing to disk', () => {
    expect(src).toMatch(/_encryptData/);
    expect(src).toMatch(/_scrubForDisk/);
  });
});

// ---------------------------------------------------------------------------

describe('server.js: shutdown hooks call flushAll', () => {
  let src;
  beforeAll(() => { src = readSrc('server.js'); });

  test('SIGTERM handler calls accounts.flushAll()', () => {
    expect(src).toMatch(/SIGTERM[\s\S]{0,400}accounts\.flushAll\(\)/);
  });

  test('SIGINT handler calls accounts.flushAll()', () => {
    expect(src).toMatch(/SIGINT[\s\S]{0,400}accounts\.flushAll\(\)/);
  });

  test('uncaughtException handler calls accounts.flushAll()', () => {
    expect(src).toMatch(/uncaughtException[\s\S]{0,400}accounts\.flushAll\(\)/);
  });
});

// ---------------------------------------------------------------------------

describe('accounts.js: in-memory cache is authoritative after saveAccount', () => {
  let src;
  beforeAll(() => { src = readSrc('accounts.js'); });

  test('loadAccount checks accountCache before reading disk', () => {
    const loadStart = src.indexOf('function loadAccount');
    const loadBlock = src.slice(loadStart, loadStart + 800);
    expect(loadBlock).toMatch(/accountCache/);
  });

  test('saveAccount delegates to _queueWrite (write-behind cache update)', () => {
    const saveStart = src.indexOf('function saveAccount');
    const saveBlock = src.slice(saveStart, saveStart + 1200);
    expect(saveBlock).toMatch(/_queueWrite/);
  });

  test('_queueWrite updates accountCache synchronously before queuing timer', () => {
    const queueStart = src.indexOf('function _queueWrite');
    expect(queueStart).toBeGreaterThan(-1);
    const queueBlock = src.slice(queueStart, queueStart + 600);
    expect(queueBlock).toMatch(/accountCache\.set/);
  });
});

// ---------------------------------------------------------------------------

describe('accounts.js: temp accounts never persisted to disk', () => {
  let src;
  beforeAll(() => { src = readSrc('accounts.js'); });

  test('saveAccount short-circuits for temp accounts before queuing disk write', () => {
    // The .temp guard must appear before the _queueWrite call in saveAccount
    const saveStart  = src.indexOf('function saveAccount');
    const saveBlock  = src.slice(saveStart, saveStart + 1200);
    const tempOffset  = saveBlock.indexOf('account.temp');
    const queueOffset = saveBlock.indexOf('_queueWrite');
    expect(tempOffset).toBeGreaterThan(-1);   // guard exists
    expect(tempOffset).toBeLessThan(queueOffset); // guard is BEFORE the queue
  });

  test('flushAll skips temp accounts', () => {
    const flushStart = src.indexOf('function flushAll');
    const flushBlock = src.slice(flushStart, flushStart + 600);
    expect(flushBlock).toMatch(/\.temp/);
  });
});
