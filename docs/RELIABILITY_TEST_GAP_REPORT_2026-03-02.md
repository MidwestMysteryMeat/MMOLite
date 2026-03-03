# MMOLite Reliability Test Gap Report
Date: 2026-03-02
Author: Codex audit pass — updated post-sprint

## Executive Summary (Post-Sprint)
- All automated tests green: **189/189 tests passed** (8 suites, up from 170/170 in 6 suites).
- Genuinely missing client handlers: **30** (down from 96 raw, after 6 handlers added + 60 allowlisted).
- Orphan client listeners: **0** (unchanged — good).
- New gates added: hard ratchet on genuinely-missing count, KNOWN_INTENTIONAL_UNHANDLED allowlist requires documented rationale.

---

## Baseline Before Sprint
- Tests: 170/170 pass, 6 suites
- Server events discovered: **427**
- Client listener events discovered: **352**
- Raw missing server→client handlers: **96**
- Orphan client listeners: **0**
- Coverage ratchet: >73% (informational only, no hard gate on missing events)

---

## Sprint Results (2026-03-02)

### New Client Handlers Added (6 events)
| Event | Handler file | Payload |
|-------|-------------|---------|
| `inventory_data` | `game-handlers/inventory.lua` (new) | `{inventory:[...], equipped:{badge,title}}` |
| `equipped_updated` | `game-handlers/inventory.lua` (new) | `{badge, title}` |
| `remove_result` | `game-handlers/placement.lua` (new) | `{success, message?, inventory?}` |
| `card_ability_error` | `game-handlers/equipment.lua` | `{message, cooldownRemaining?}` |
| `monster_error` | `game-handlers/monster.lua` | `{message}` |
| `card_shop_error` | `game-handlers/cards.lua` | `{message}` |

### New State Tables Added (game.lua)
- `game._lootInv = { items = {}, equipped = {} }` — stores enriched loot items and social equipped (badge/title)

### New Test Files Added (2)
- `tests/disconnect-cleanup.integration.test.js` — 7 tests covering state.users, socketAccountMap, sessionTokens, survival chunks, and battle teardown on disconnect
- `tests/persistence.test.js` — 10 tests verifying accounts.js write-behind contract (debounce, flushAll, cache authority, temp-account guard) and server.js shutdown hook wiring

### Event Contract Test Hardened
- Added `KNOWN_INTENTIONAL_UNHANDLED` set (60 events) with documented reasons (web-only, legacy, moderation, DM-infra, deferred UI)
- Changed from informational coverage% to hard gate: **genuinely missing ≤ 65**
- Removed false-positive informational test wording
- Orphan cap remains ≤ 0

---

## Current State

### Metrics
- Suites: **8/8 pass**
- Tests: **189/189 pass**
- Server events: **427**
- Client listeners: **352** (net +6 from new handler modules)
- Genuinely missing (not handled, not allowlisted): **30**
- Intentionally allowlisted: **60**
- Orphan client listeners: **0**

### Remaining Genuine Gaps (30 events — next triage priority)
```
ability_used, card_abilities_list, card_ability_used, card_fuse_error,
card_shop_bought, card_shop_inventory, combat_ability_used, death_respawn,
dot_tick, dungeon_animal_fled, dungeon_animal_interacted, dungeon_chest_opened,
dungeon_exit_complete, dungeon_force_exit, dungeon_form_interactable_explored,
dungeon_npc_interacted, item_picked, item_removed, item_sold, key_drop,
mmo_auction_sold, monster_renamed, mount_error, new_message, npc_error,
pack_awarded, raid_enemy_attack, raid_object_damaged, raid_object_destroyed,
special_crate_result
```

**Triage guidance for next pass:**
- `card_shop_bought`, `card_shop_inventory` — card shop panel needs state + handler
- `special_crate_result` — crate open success feedback (simple floating text)
- `item_sold`, `item_picked`, `item_removed` — inventory feedback events
- `dungeon_*` family — dungeon UI events (likely need draw-side state updates)
- `npc_error`, `mount_error`, `monster_renamed` — simple error/confirmation feedback
- `new_message` — DM notification badge in HUD (short-term deliverable)
- `pack_awarded` — card pack award notification (simple chat message)
- `mmo_auction_sold` — auction sale notification
- `raid_*` — raid combat broadcast events (need raid panel handlers)

---

## Quality Gates (Active)

| Gate | Threshold | Status |
|------|-----------|--------|
| All Jest suites pass | 8/8 | ✓ |
| Orphan client listeners | ≤ 0 | ✓ 0 |
| Genuinely missing server→client handlers | ≤ 65 | ✓ 30 |
| New missing events must be in KNOWN_INTENTIONAL_UNHANDLED | required | ✓ enforced |

---

## Recommended Next Steps

### Short-term (close the remaining 30)
1. Add handlers for simple feedback events: `special_crate_result`, `item_sold`, `npc_error`, `mount_error`, `monster_renamed`, `pack_awarded`, `mmo_auction_sold`
2. Wire `card_shop_bought` + `card_shop_inventory` to card shop panel state (`game._cardVendor` or new state table)
3. Handle `new_message` as a DM notification badge in the HUD
4. Triage `dungeon_*` events — some may already be handled under aliases

### Medium-term (Phase 3 from original plan)
- Add scenario integration tests: placement chest/door lock/unlock round-trips
- Add account/profile update persistence-after-reconnect test
- Add rate-limit event (`rate_warning`, `rate_cooldown`) client-side visibility test

### Ongoing
- Tighten the missing-count ratchet from 65 as gaps are closed
- Add per-subsystem smoke tests to CI matrix (social, inventory, dungeon, combat, economy)
- Shrink KNOWN_INTENTIONAL_UNHANDLED as deferred features are implemented
