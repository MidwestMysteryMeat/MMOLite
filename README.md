# MMOLite

**A fantasy MMO RPG — Node.js/Socket.IO authoritative server with a Love2D client — featuring gacha card collection, dungeons, raids, guilds, and a player economy.**

## What it does

MMOLite is a small-scale persistent multiplayer RPG. Players create characters (multi-slot, with permadeath and a Hall of Heroes), explore zones, fight tactical turn-based combat and raid bosses, collect and fuse gacha cards, trade on an auction house, join guilds and parties, own plots/housing, farm, tame pets, and grind mastery trees. The server is authoritative and persistent (write-behind encrypted account cache); the client is a Love2D desktop app with LAN discovery and Steam Cloud saves. It's sharded via a master-server and supports VIP/Stripe monetization.

## Status

**Playable, server-solid, content-deep — client UI lags the backend.** 192/192 backend tests pass (`jest`), including an event-contract test that ratchets client↔server desync to zero. Notable rough edges:

- The full TCG **trading + battle-challenge flow is implemented server-side but has no client UI** — a complete dormant feature
- Gacha cards render as procedural frames (no per-card art) despite 18k+ assets available
- No tutorial/onboarding; new players face a systems-dense game cold
- No mail, LFG queue, or guild bank/leveling yet

## How to run

Requires Node 18+ and [LÖVE 11.4](https://love2d.org/) for the client.

```
npm install
ACCOUNT_SECRET=<any-random-string> node server.js   # server refuses to boot without this

# tests
npx jest --testPathPattern="tests/" --forceExit --detectOpenHandles

# client
love client/
```

Runtime state (accounts, guilds, plots) is written under `data/` and gitignored.

## Screenshots

_TODO — add client captures (character select, dungeon combat, card collection)._

## Known issues / roadmap

See [`docs/GAP_ANALYSIS.md`](docs/GAP_ANALYSIS.md). Priority order: wire the dormant TCG trade UI (server already done) → CI → tutorial chain → player mail + quest journal → card art → LFG/season pass/guild depth.

## AI development note

Developed with AI assistance — **Anthropic Claude** (Claude Code) for implementation and **OpenAI Codex** for review — per the workflow in `CLAUDE.md` and `AGENTS.md`, under a strict "read before writing / trace the call path / preserve behavior" persona. Human direction set the architecture, game design, and priorities. The 2026-07-02 debug + audit pass (account-corruption fix in `deleteCharacter`, secret cleanup) was done with Claude. The backend is covered by tests, but audit the security-sensitive paths (payments, auth, account persistence) yourself before relying on them.

## License

MIT — see [LICENSE](LICENSE). Third-party art/asset packs under `client/assets/` retain their own licenses (see the `LICENSE`/`CREDITS` files alongside them, e.g. the GPL-3.0 bazaar tileset).

## Art & audio licensing

This repo intentionally contains **no art or audio**. Those assets are
purchased packs licensed to the project owner only and are stripped from
version control (see `client/assets/ASSETS_PLACEHOLDER.md` and
`tools/asset-pipeline/ASSETS_PLACEHOLDER.md`). The code expects them at
their original paths on the owner's machine; fresh clones run with
placeholders/silence where the engine allows.
