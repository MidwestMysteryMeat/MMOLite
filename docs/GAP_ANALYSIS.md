# MMOLite — Gap Analysis vs. MMO / Gacha Genre Staples

_Date: 2026-07-02. Basis: full handler/director/seasonal inventory, client scene
sweep, keyword verification per claim. Suite state: 192/192 jest tests green,
198 server JS + 68 client Lua files syntax-clean, event contracts ratcheted to 0
in both directions._

## What MMOLite already has (do not rebuild)

Multi-character accounts with permadeath + Hall of Heroes, encrypted DMs, friends,
grid inventory + weight, gacha cards with pity/fusion/affixes/evolution/pools,
auction house with market-health telemetry, player-to-player trade, bank, guilds
(basic), plots/housing + placement + deeds, farming, pets + companions + seasonal
variants, mounts (inventory-based), mastery trees (combat/crafting/exploration/
gathering), ascension, factions, karma + prison, knowledge system, portals,
dungeons + tactical combat (tc_*), raid directors (lich, ocean/leviathan, rifts,
vampire, werewolf, macro/micro zone directors), world quests + quest boards,
daily challenges, achievements, leaderboards, titles, moderation tools, VIP +
Stripe payments, shard master-server, LAN discovery, Steam Cloud saves, minimap,
18,649 art/audio assets.

---

## A. Gameplay/UX gaps (verified absent, ranked by payoff ÷ effort)

### A1. Onboarding / tutorial — HIGHEST retention payoff
Zero tutorial code anywhere. A new player spawns into a systems-dense MMO
(cards + masteries + factions + karma) with no guidance. Every retention curve
in this genre dies here first.
**Hooks:** quest system + world quest tracking already exist — a scripted
"first hour" quest chain with UI highlights needs no new infrastructure.
Seasonal-dialogue NPCs can carry it.

### A2. Structured PvP: duels — dead button today — LOW effort
`client/scenes/game.lua:462` ships a "Duel (PvP)" context-menu action with **no
server handler** — it silently does nothing. Either implement or remove; a dead
button erodes trust.
**Hooks:** tc_* tactical combat engine already handles turn-based encounters;
a duel is a 2-player tc_ instance with a wager wrapper. Arena queues can come
later (needs A4).

### A3. Player mail / offline delivery — LOW-MEDIUM
No mailbox. Trade requires both players online; there is no way to send items,
gold, or messages to offline players (DMs are online-oriented chat). Standard
in every MMO since 2004, and it compounds the auction house (sale proceeds
should be deliverable offline).
**Hooks:** account persistence + write-behind cache handle offline mutation
already (auction outbid refunds prove the pattern); add `mailbox[]` to account
schema + claim UI in the social panel.

### A4. LFG / group finder — MEDIUM
Parties, dungeons, and raid directors exist, but grouping is manual chat. A
simple "queue for dungeon X → auto-party when N ready" matcher would multiply
usage of the content that already exists.
**Hooks:** master-server already tracks shard populations; party.js has the
invite/join flow to reuse.

### A5. Battle pass / season reward track — MEDIUM (monetization)
An entire `seasonal/` directory (17 modules: crops, pets, NPCs, shops, weather,
skills…) rotates content, but no season reward track monetizes or spotlights
it. Stripe + VIP infrastructure is already live — the pass is a data table +
progress bar, not new payments work.
**Hooks:** daily challenges already award progress-shaped events; route them
into a season XP track with free/premium lanes.

### A6. Guild depth: bank, leveling, wars — MEDIUM
guild.js covers membership only. No guild bank (bank.js is per-player), no
guild progression/perks, no guild-vs-guild objectives. Guilds are the #1
retention structure in the genre.
**Hooks:** plots/deeds could host guild halls; faction war scaffolding
(factions.js + director-zone) is adjacent for territory objectives.

### A7. Quest journal consolidation — LOW (verify scope first)
World quests, boards, and challenges each surface separately; there is no
single journal panel (`quest_journal`/`quest_log`: zero hits). Players lose
track of active objectives across systems. Panels.lua already draws list
panels — this is UI consolidation, not new systems.

### A8. Cosmetic economy: dyes — LOW (later)
Transmog/skin hooks exist (19 files), dyes do not (0 hits). With layered
sprites (`lib/layered-sprite.lua`) tint channels are cheap, and cosmetics are
the least pay-to-win monetization lane.

Explicitly not recommended now: battlegrounds (needs A2+A4 first), cross-shard
raids (master-server complexity), player-driven economy rework (auction
telemetry says the market functions).

---

## B. Art/content gaps

Unlike a typical indie MMO, assets are NOT the bottleneck (18,649 files, full
audio taxonomy: ambience/cinematic/combat/creatures/footsteps/horror/machines).
The gaps are bindings, not files:

### B1. Card art — biggest visual win
`card-templates.js` contains **zero art references**; gacha cards render as
procedural frames. For a gacha game, unique card art is the collection's
emotional core — even reusing existing creature/portrait assets per template
(an `art:` field + atlas lookup) would transform pack-opening.

### B2. Mount visuals
Mounts are inventory-flag based (`character-creation.js` mount_error paths);
verify whether mounted players render differently. Layered-sprite supports an
additional layer if not.

### B3. Dead-feature client strings
The Duel button (A2) is the confirmed one; sweep other context-menu actions
against `handlers/` the same way before shipping each UI build (the
event-contracts test covers socket events but not menu-action strings).

---

## C. Engineering gaps

### C1. CI — now that the repo is on GitHub
192 jest tests + a strain bot exist but nothing runs them automatically. Add
`.github/workflows/test.yml` running `npm ci && npx jest --forceExit` on push.
The event-contract ratchet test makes CI unusually valuable here — it catches
client/server desync at PR time.

### C2. Secret hygiene
`data/writing_tool_token.txt` sat untracked next to committed code and was
caught heading into git once already (now gitignored). Rotate that token, and
prefer env vars per the existing `*.env` ignore pattern.

## Suggested sequencing

1. **A2 duels** (dead button, engine exists) + **C1 CI** — days
2. **A1 tutorial chain** — the retention unlock
3. **A3 mail** + **A7 quest journal** — QoL pair
4. **B1 card art binding** — content pass, no code risk
5. **A4 LFG → A5 season pass → A6 guild depth** — the retention ladder
