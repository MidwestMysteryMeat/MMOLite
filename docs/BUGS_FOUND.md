# Static analysis findings — 2026-07-30 audit

Found by adding eslint to the repo for the first time. It had no lint config, as
did every repo in the account.

The rule set is deliberately correctness-only — no formatting rules. Full config
and the reason for each mute is in `eslint.config.mjs`.

**Result: 7 initial errors → 2 real findings, both clarity rather than crashes,
plus 1 open concern left unfixed on purpose.** No behaviour changed.

---

## 1. `account-rpg-evolution.js` — a `while` that was never a loop

| | |
|---|---|
| **Rule** | `no-unreachable-loop` |
| **Severity** | Clarity (behaviour already single-advance) |

```js
// Check for stage advancement (stages 0 -> 3)
while (card.evolutionStage < 3) {
    var threshold = template.evolutionThresholds[card.evolutionStage];
    if (card.evolutionXp < threshold) break;
    card.evolutionStage++;
    ...
    return { ... };        // <-- unconditional, 90 lines down
}
```

The body ends in an unconditional `return`, so the loop could only ever run once.
The `while` and the comment ("stages 0 -> 3") both suggest it was meant to advance
a card through multiple stages when it banks enough XP at once. It never did.

**This is left as single-advance on purpose, not "fixed" into a real loop.** The
return payload is single-advance shaped — one `newStage`, one `grantedAffix`, one
`mutation` — so making it iterate would need a redesign of the return contract and
of how the client renders an evolution event. That is a gameplay decision, not a
lint fix.

**Change made:** `while` → `if`, with the threshold guard hoisted into the
condition (the `break` could not survive the conversion). Behaviour is identical;
the code now states what it actually does.

**Open question for the owner:** should a card that banks two stages' worth of XP
in one grant advance twice? Today it advances once and the caller must grant again.

---

## 2. `handlers/dungeon.js` — take-first-key written as a loop

| | |
|---|---|
| **Rule** | `no-unreachable-loop` |
| **Severity** | Clarity |

```js
var partyIter = lichRaidState.parties.keys();
var pk = partyIter.next();
while (!pk.done) {
    firstPartyId = pk.value;
    break;
}
```

Correct, but it reads as an iteration over parties when it only ever takes the
first. Rewritten as an explicit `.next()` with an `if`. Behaviour identical.

---

## 3. `socket.js` — possible race on `linkedAccount` (NOT fixed)

| | |
|---|---|
| **Rule** | `require-atomic-updates` |
| **Severity** | Flagged, not changed |

`linkedAccount` is reassigned after an `await`. It is a `let` declared inside the
join handler, so each invocation owns its own binding and two different sockets
cannot corrupt each other's value — which is why this is suppressed at the site
with that reasoning written next to it, rather than silently downgrading the rule
globally.

**The deeper concern is real and remains open.** If a single client emits `join`
twice in quick succession, two handler invocations interleave across that `await`
and both can proceed to create or link an account. That is a double-join hazard
independent of this variable, and the fix is a per-socket join guard — a change to
the auth flow, which needs a demonstrated repro before anyone touches it on a repo
with live deployments. Not attempted here.

---

## Verified NOT bugs

Four of the seven initial errors were correct code. Recorded so nobody "fixes"
them later:

- **`combat-astar.js:64`** and **`tests/bot-strain.js:53`** (`no-constant-condition`) —
  `while (true)` is correct for a binary-heap sink-down and for a proof-of-work
  solver. The rule is now `{ checkLoops: "allExceptWhileTrue" }`, which still
  catches genuinely constant `if`/`for` conditions.
- **`tests/event-contracts.test.js:22,59`** (`no-cond-assign`) — the idiomatic
  `while ((m = pattern.exec(src)) !== null)`. The rule is now `"except-parens"`,
  which still catches an accidental `if (a = b)`.

---

## Not yet triaged

- **~4,800 lines of dated audit/report docs** (`MMOLite-Feature-Audit`,
  `NETWORK_OPTIMIZATION_REPORT`, `CROSS_PROJECT_LORE_AUDIT`, `art-mvp-audit`,
  `RELIABILITY_TEST_GAP_REPORT_2026-03-02`, `Codebase-Cleanup-Report`). They read
  like build artifacts, but `Codebase-Cleanup-Report` still carries at least one
  open finding (BUG-8: the real XP formulas — `80 * n^1.7`,
  `SKILL_MAX_LEVEL = Infinity` — are documented nowhere). These need reading, not
  bulk deletion.
- **`client/assets/sprites/*.json`** (796 files). Possibly the same build-output
  class as the 1,314 files already untracked, but a grep found no loader either
  way. Verify by booting the client and watching for 404s before removing any.
- **The LOVE client** (`client/`, Lua) has no lint config yet. `.luacheckrc`
  modelled on Frosthold's would be the next step.

---

## Verification

- `npx eslint .` — 0 errors
- `npx jest` — 192/192 pass
- `ACCOUNT_SECRET=… PORT=0 node server.js` — boots and stays up (the Redis and
  PostgreSQL fallback messages are expected without that infrastructure)
