# MMOLite — Codebase Cleanup & Bug Audit Report

**Date:** February 26, 2026

---

## Table of Contents

1. [Files to Delete (Safe)](#1-files-to-delete-safe)
2. [Files to Review (Maybe Delete)](#2-files-to-review-maybe-delete)
3. [Gitignore Fixes](#3-gitignore-fixes)
4. [Critical Bugs](#4-critical-bugs)
5. [Important Bugs](#5-important-bugs)
6. [Security Issues](#6-security-issues)
7. [Monolithic File Analysis & Split Plans](#7-monolithic-file-analysis--split-plans)
8. [Code Quality Issues](#8-code-quality-issues)
9. [Priority Fix Order](#9-priority-fix-order)

---

## 1. Files to Delete (Safe)

These files are orphaned, duplicated, or junk. Safe to delete immediately.

| File | Size | Reason |
|------|------|--------|
| `analyze.js` | 1.4K | Orphaned analysis script, not imported anywhere |
| `detailed_report.js` | 1.7K | Orphaned analysis script, not imported anywhere |
| `extract.js` | 1.2K | Orphaned analysis script, not imported anywhere |
| `C:Usersjonat.bosscordtest-upload.txt` | 20B | Malformed Windows path junk file |
| `conf.lua` (root) | 14 lines | Duplicate of `client/conf.lua` |
| `main.lua` (root) | 288 lines | Duplicate of `client/main.lua` |
| `love.ico` (root) | 362K | Duplicate of `game.ico` |
| `Uninstall.exe` | 450K | Windows installer artifact |
| `love - Shortcut.lnk` | 1.4K | Windows shortcut |
| `context2.txt` | 10K | Stale session notes |
| `context3.txt` | 10K | Stale session notes |
| `context4.txt` | 17K | Stale session notes |
| `SESSION_CONTEXT.md` | 14K | Stale handoff notes from Feb 17 |

---

## 2. Files to Review (Maybe Delete)

| File | Size | Status | Notes |
|------|------|--------|-------|
| `handlers/game-chess.js` | 15K | Handler NOT registered in socket.js | Loaded but unused; decide if future feature or dead |
| `handlers/game-horseracing.js` | 28K | Handler NOT registered in socket.js | Loaded but unused |
| `handlers/game-pool.js` | 40K | Handler NOT registered in socket.js | Loaded but unused |
| `SESSION-HANDOFF-LAN-DIRECTOR.md` | 41K | Session notes from Feb 23 | Valuable but session-specific; archive to docs/ |

---

## 3. Gitignore Fixes

Ensure `.gitignore` includes:

```
# Build artifacts
build/
dist/

# Runtime data
data/accounts/
data/auction/
data/guilds/
data/placements/
data/plots/

# Server-specific config (NEVER deploy from local)
shard-config.json
ecosystem.config.js
.env

# Dependencies
node_modules/

# Logs
*.log

# System junk
*.lnk
Uninstall.exe
.DS_Store
Thumbs.db
```

---

## 4. Critical Bugs

### BUG-1: Memory Leak — `_survivalVisitedChunks` Grows Forever
**File:** `handlers/zone.js:670-679` | **Confidence: 97%**

`state._survivalVisitedChunks` is a `Map<accountKey, Set<chunkKey>>` that:
- Is never cleaned on player disconnect
- Is never cleared in `state.wipeEphemeral()`
- Grows indefinitely until server restart

**Fix:** Add cleanup in zone.js disconnect handler and in `state.wipeEphemeral()`:
```javascript
// zone.js disconnect:
if (state._survivalVisitedChunks) state._survivalVisitedChunks.delete(accKey);

// state.js wipeEphemeral():
if (this._survivalVisitedChunks) this._survivalVisitedChunks.clear();
```

### BUG-2: Missing Rate Limiting on All Auction Events
**File:** `handlers/mmo-auction.js` | **Confidence: 92%**

`checkEventRate` is imported but never called on any of the 5 auction socket events. A client can spam `mmo_auction_browse` (which does a full 500-item scan + `cleanExpired()`) at full socket speed.

**Fix:** Add to each auction handler:
```javascript
if (!checkEventRate(socket.id, 'mmo_auction', 30, 10000)) return;
```

### BUG-3: Race Condition in Auction Buy — Stale Balance Check
**File:** `handlers/mmo-auction.js:431-444` | **Confidence: 95%**

Balance check at line 431 uses a `loadAccount` snapshot, but the actual `updateChips` deduction at line 444 does a fresh load internally. Between the snapshot and deduction, another concurrent transaction could drain the balance.

**Fix:** Re-verify balance after `updateChips` or make the check+deduction atomic inside `updateChips`.

---

## 5. Important Bugs

### BUG-4: `floorAccessOrder` LRU Never Cleared on Daily Wipe
**File:** `handlers/dungeon.js:891-918` | **Confidence: 88%**

When rift floors are cleared at midnight (`riftFloors.clear()`), the `floorAccessOrder` array retains stale entries pointing to cleared Maps. Causes O(n) overhead and potential ghost entries.

**Fix:** Add `floorAccessOrder = [];` to the daily wipe path in `getRiftFloor`.

### BUG-5: `getTodayString` Uses Non-Padded Dates
**File:** `handlers/dungeon.js:883` | **Confidence: 85%**

Returns `"2026-2-9"` instead of `"2026-02-09"`. While internally consistent, inconsistent with ISO format used elsewhere.

**Fix:** Replace with `new Date().toISOString().slice(0, 10)`.

### BUG-6: Trade Cancel Can Orphan Execution Locks
**File:** `handlers/trade.js:381-393` | **Confidence: 82%**

`trade_cancel` does not check `tradeExecLocks`. If cancel fires while execution locks are held (edge case), locks could be permanently set, blocking those accounts from future trades.

**Fix:** Add `tradeExecLocks.delete()` in the cancel handler, or guard cancel against active execution.

### BUG-7: Client `debugLog` is O(n^2)
**File:** `client/scenes/game.lua:12-21` | **Confidence: 93%**

Each `debugLog` call reads the entire debug.log, appends one line, and rewrites the whole file. Quadratic I/O as the log grows.

**Fix:** Replace with `love.filesystem.append("debug.log", line .. "\n")`.

### BUG-8: XP Formula Documentation vs Code Mismatch
**File:** `accounts.js:1040`, `rpg-data.js:5906` | **Confidence: 86%**

The old CLAUDE.md said `xpForLevel(n) = 100 * n` (linear). Actual code: `Math.floor(80 * Math.pow(n, 1.7))` (polynomial). Also, `SKILL_MAX_LEVEL = Infinity` not 99 as documented. RESOLVED by removal: CLAUDE.md is gone and docs/ARCHITECTURE.md makes no XP claims, so there is no longer a contradiction to fix. The formulas remain undocumented.

**Fix:** Document the real formulas and caps somewhere authoritative (they are currently only in code).

### BUG-9: Fragile Disconnect Handler Ordering
**File:** `handlers/zone.js:1494-1517` | **Confidence: 82%**

`gridRemove` in zone.js disconnect handler depends on `state.playerPositions` still existing, which is cleared by `disconnect.js`. Currently safe because zone.js handler fires first (registered first in socket.js), but correctness depends on undocumented handler ordering.

**Fix:** Either consolidate disconnect logic or document the ordering requirement.

---

## 6. Security Issues

### SEC-1: No Rate Limiting on Auction Events
(Same as BUG-2 above) A single client can saturate the server by spamming `mmo_auction_browse`.

### SEC-2: Large Identity Payload
**File:** `socket.js:493-550` | **Confidence: 80%**

The `identity` event sends the entire card collection + full inventory on every connect. A player with 200+ cards generates a large serialization payload. Consider paginating cards or lazy-loading.

---

## 7. Monolithic File Analysis & Split Plans

### `client/scenes/game.lua` — 16,662 lines (CRITICAL)

| Section | Est. Lines | Suggested Module |
|---------|-----------|-----------------|
| Movement, camera, sprint | ~400 | `scenes/game/movement.lua` |
| Zone rendering, chunks, minimap | ~1,200 | `scenes/game/renderer.lua` |
| Chat system | ~600 | `scenes/game/chat.lua` |
| Inventory + crafting UI | ~1,800 | `scenes/game/inventory-ui.lua` |
| Card collection UI | ~1,200 | `scenes/game/cards-ui.lua` |
| Dungeon rendering + fog of war | ~2,500 | `scenes/game/dungeon-renderer.lua` |
| Dungeon HUD + combat overlay | ~1,000 | `scenes/game/dungeon-hud.lua` |
| Permadeath UI | ~400 | `scenes/game/permadeath-ui.lua` |
| Quest + leaderboard panel | ~600 | `scenes/game/quest-ui.lua` |
| Party panel | ~400 | `scenes/game/party-ui.lua` |
| Network event handlers | ~2,500 | `scenes/game/net-handlers.lua` |
| Character sheet UI | ~800 | `scenes/game/charsheet-ui.lua` |
| NPC Shop UI | ~600 | `scenes/game/shop-ui.lua` |
| Auction House UI | ~600 | `scenes/game/auction-ui.lua` |
| Trade Panel UI | ~600 | `scenes/game/trade-ui.lua` |

**Strategy:** Extract each section into a module returning `{ init, update, draw, keypressed, mousepressed }`. Main game.lua becomes coordinator.

---

### `dungeon-combat.js` — 9,691 lines

| Section | Suggested Module |
|---------|-----------------|
| Combat engine (damage calc, turns, initiative) | `dungeon/combat-engine.js` |
| Player action processing (move, attack, ability, flee) | `dungeon/combat-actions.js` |
| Enemy turn AI (ability selection, targeting) | `dungeon/combat-enemy-ai.js` |
| Reward distribution (XP, gold, loot) | `dungeon/combat-rewards.js` |
| Status effect processing | `dungeon/status-effects.js` |

---

### `handlers/dungeon.js` — 7,090 lines

| Section | Suggested Module |
|---------|-----------------|
| Floor cache + LRU management | `dungeon/floor-cache.js` |
| AI tick loop + processAIResults | `dungeon/ai-manager.js` |
| Player floor tracking + visibility | `dungeon/floor-players.js` |
| Lich Raid system | `dungeon/lich-raid.js` |
| Quest progress tracking | `dungeon/quest-tracker.js` |
| Socket event handlers | `dungeon/socket-events.js` |
| Combat state initialization | `dungeon/combat-init.js` |

---

### `rpg-data.js` — 7,266 lines

| Section | Suggested Module |
|---------|-----------------|
| Card templates (820+ cards) | `data/card-templates.js` or JSON |
| Race definitions + bonuses | `data/races.js` |
| Skill definitions | `data/skills.js` |
| Resource definitions | `data/resources.js` |
| Gacha rate computation | `gacha/rates.js` |
| Card fusion logic | `gacha/fusion.js` |
| XP and level formulas | `game/xp-formulas.js` |

---

### `dungeon-data.js` — 5,761 lines

| Section | Suggested Module |
|---------|-----------------|
| 31 theme definitions | `data/dungeon-themes.js` |
| 22+ enemy pool definitions | `data/enemy-pools.js` |
| 8 layout generators | `dungeon/generators/*.js` |
| `generateFloor` orchestrator | `dungeon/floor-generator.js` |
| Camp config + quest templates | `data/dungeon-config.js` |
| Dungeon skill perks | `data/dungeon-skills.js` |

---

### `accounts.js` — 3,945 lines

| Section | Suggested Module |
|---------|-----------------|
| Encryption/decryption | `accounts/crypto.js` |
| Cache + disk persistence | `accounts/storage.js` |
| Economy (chips/coins) | `accounts/economy.js` |
| Skill XP system | `accounts/skills.js` |
| Card management | `accounts/cards.js` |
| Social (friends, DMs) | `accounts/social.js` |

---

### Other Large Files

| File | Lines | Assessment |
|------|-------|-----------|
| `dungeon-ai.js` | 1,875 | Moderate — could extract pathfinding |
| `dungeon-vision.js` | 1,313 | OK — single responsibility |
| `worldgen.js` | 2,280 | Moderate — could extract biome generation |
| `loot-generator.js` | 1,494 | Moderate — could extract rarity weights |
| `state.js` | 1,285 | OK — manageable |
| `handlers/zone.js` | 1,520 | OK — manageable |
| `lore-books.js` | 3,625 | Narrative content — move to data/ |

---

## 8. Code Quality Issues

| Issue | Files | Description |
|-------|-------|-------------|
| `var` vs `const`/`let` inconsistency | Multiple | dungeon.js uses `var` exclusively; server.js mixes both; risky for closures in loops |
| Magic numbers in dungeon handler | `handlers/dungeon.js` | `96*72`, `512`, `350` HP — should be named constants |
| O(n) friend notification on disconnect | `handlers/disconnect.js:29-38` | Scans all sockets per friend; should use `_getSocketsForAccount` reverse index |
| Stale LRU entries after daily wipe | `handlers/dungeon.js` | `floorAccessOrder` not cleared when `riftFloors.clear()` runs |
| `debugLog` O(n^2) I/O | `client/scenes/game.lua:12-21` | Read+rewrite entire log file per call |

---

## 9. Priority Fix Order

### Immediate (Production Impact)
1. **BUG-1:** Add `_survivalVisitedChunks` cleanup to disconnect + wipeEphemeral
2. **BUG-2:** Add `checkEventRate` to all 5 auction event handlers
3. **BUG-7:** Replace `debugLog` read+write with `love.filesystem.append`

### Soon (Correctness)
4. **BUG-3:** Make auction buy balance check + deduction atomic
5. **BUG-4:** Clear `floorAccessOrder` on daily wipe
6. **BUG-5:** Replace `getTodayString` with ISO format
7. **BUG-6:** Guard trade cancel against active execution locks
8. **BUG-8:** Document the real XP formulas and skill caps (was: fix CLAUDE.md, now removed)

### File Cleanup
9. Delete 13 orphaned/junk files listed in Section 1
10. Verify .gitignore covers all items in Section 3
11. Decide fate of 3 unused game handlers

### Architecture (Plan Now, Execute Over Time)
12. Split `game.lua` (16,662 lines) into 12+ sub-modules
13. Split `dungeon-combat.js` (9,691 lines) into 5 modules
14. Split `handlers/dungeon.js` (7,090 lines) into 7 modules
15. Split `rpg-data.js` (7,266 lines) — move card templates to data files
16. Split `dungeon-data.js` (5,761 lines) into themes/enemies/generators
