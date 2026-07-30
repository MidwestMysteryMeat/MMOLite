# Audit findings and verification — 2026-07-30

This supersedes the first static-analysis write-up from the same day. The
initial pass was useful, but three conclusions needed correction after tracing
the actual runtime paths and reproducing the gates.

## Confirmed and fixed

### Card evolution consumed only one earned threshold

`account-rpg-evolution.js` used a `while`, but returned unconditionally from its
first iteration. Replacing it with `if` preserved that bug: a card granted
enough cumulative XP for stages 1–3 stopped at stage 1.

The loop now consumes every earned threshold. A one-stage grant preserves the
legacy result object; a multi-stage grant adds an ordered `events` array so no
affix or mutation event is lost. Post-max XP likewise consumes every earned
500-XP bonus interval. Three regression tests cover one-stage compatibility,
multi-stage advancement, and multiple post-max bonuses.

### Two auction read endpoints still lacked throttling

The main browse/list/buy/cancel endpoints already called `applyRateGrace`, so
the February report’s blanket “no auction rate limiting” statement was stale.
`mmo_auction_market_price` and `mmo_auction_market_health` were the two
survivors; both now use the same auction rate bucket.

The old auction stale-balance report was also imprecise. The handler is
synchronous and Node socket callbacks cannot interleave inside its
load/check/save sequence. Even so, the intended atomicity was obscured by an
“in-process lock” that never queued or blocked anything. It has been replaced
with `accounts.trySpendChips`, which performs the sufficient-funds check and
deduction in one non-async operation. The auction purchase path is locked to
that API by regression tests.

### Disconnect cleanup depended on listener order

Zone cleanup needs the account mapping and final player position, while the
shared disconnect handler removes those values. It happened to work only
because the zone listener was registered first.

`handlers/zone.js` now publishes an idempotent `socket.data.cleanupZone` hook.
`handlers/disconnect.js` invokes it before unlinking/removing shared state,
regardless of event-listener order. A regression asserts the hook can still
read both the account map and user state when called.

### Sprite-sheet loader required a module that did not exist

`client/lib/sprite-sheet.lua` called `require("lib.json").decode`, but
`client/lib/json.lua` does not exist. The `require` also executed before
`pcall`, so the loader always crashed on first use.

The loader now reuses the dependency-free decoder exported by
`client/lib/net.lua`, checks decode failures, and has a headless Lua smoke test
covering manifest parsing, image creation, quad creation, and playback.

### The LÖVE client had no meaningful static gate

Once the standard LÖVE globals and style-only warnings were configured,
Luacheck exposed 30 actionable warnings: dead state/stores, four shadowed
bindings, and one same-scope redeclaration. They are resolved and
`luacheck client` now reports 0 warnings / 0 errors across 68 Lua files.

### Generated sprite metadata was unverified

There are 657 generated manifests, not 796 runtime manifests; the larger count
included palette/support JSON. `tests/sprite-assets.test.js` now ratchets the
manifest count and validates:

- index ↔ manifest membership;
- sheet and frame references;
- safe sheet filenames;
- frame rectangles and animation references;
- PNG signatures and frame bounds whenever owner-licensed sheets are present.

Use `MMOLITE_REQUIRE_LOCAL_ASSETS=1` to require every local sheet. That strict
mode passes on the owner checkout. Fresh public clones omit the licensed PNGs,
so normal tests validate the tracked metadata without requiring private art.

## Corrections to the first audit

### `socket.js` did not have a client-emitted double-join race

The flagged code is the Socket.IO `connection` callback, not a `join` event a
client can emit twice. Each connection gets its own handler invocation and
`linkedAccount` binding. After the master checkout `await`, JavaScript resumes
one callback at a time; the existing-session check and `_linkSocket` call run
without another await, so a second socket observes the first link. The
`require-atomic-updates` suppression remains local and now documents this
actual reasoning. No auth-flow change was justified.

### The sprite manifests do have a loader

The first grep missed `client/lib/sprite-sheet.lua`. It is currently dormant
(no runtime scene imports it), but it was still broken and is now tested so it
can be integrated safely.

### The original “seven clean gates” claim was too broad

The JavaScript gate was clean, but the Lua client had never been included.
The combined `npm run lint` command now covers pinned ESLint plus Luacheck.

## Current verification

- `npm run lint` — ESLint clean; Luacheck 0 warnings / 0 errors in 68 files.
- `npm test` — 11 suites, 205/205 assertions.
- `npm run test:client` — headless sprite loader passes.
- Strict local asset validation — 657 manifests and all available PNG bounds
  pass.
- `npm audit --omit=dev` — 0 production vulnerabilities.

The full dependency audit currently reports a development-only advisory
through Jest’s globbing stack. Jest and ESLint are pinned to their current
versions, and the installed `brace-expansion` patch releases are newer than the
advisory’s publication. Do not run `npm audit fix --force`: npm currently
proposes downgrading Jest to 25, which would be a breaking and misleading
“fix.” Recheck once the advisory metadata catches up.
