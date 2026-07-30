# MMOLite — Architecture

Node.js (Socket.IO) server plus a LOVE 2D (Lua) client. This is the reference
for how the two halves fit together and where state lives.

---

## Project Overview
A massive multiplayer online RPG built with Node.js (Socket.IO) server and LOVE 2D (Lua) client. Originally evolved from BossCord (a Discord-like platform with minigames), now a full fantasy MMO with 2D overworld exploration, crafting, trading, guilds, and a comprehensive RPG card gacha system.

---

## Production Infrastructure & Deployment

Official-shard deployment details (server addresses, SSH access, process
layout, firewall rules, per-shard configs) are **not documented in this
repository** — they live in the operator's private runbook. What matters
for anyone reading the code:

- The server is a plain Node.js app: `node server.js`, port from
  `process.env.PORT`. Env secrets load from `MMOLITE_ENV_FILE`.
- Multi-shard setups run one server process per shard plus a master shard
  registry; each shard gets its own `shard-config.json` **written on the
  server, never committed or deployed from a checkout**.
- `ecosystem.config.js` (PM2) is likewise per-server and never deployed
  from a checkout.
- Accounts are per-shard, AES-256-GCM encrypted JSON files.

### Build (for testers)
Run `build.bat` from the MMOLite project root on Windows. Creates `build/MMOLite/` with fused LOVE exe + bundled server (esbuild minified). Uses `local-server-config.json` (no master heartbeat) for offline/LAN play.

## Architecture

### Server (Node.js)
- **Entry:** `server.js` (Express + Socket.IO, `node server.js` or `npm start`)
- **Port:** `process.env.PORT || 3000`
- **Env secrets:** `/etc/mmolite/app.env` (or `MMOLITE_ENV_FILE`)
- **Account encryption:** AES-256-GCM with key rotation via `/etc/mmolite/account_secrets.json`
- **Accounts stored:** `./accounts/` directory (one encrypted JSON file per account)

### Client (LOVE 2D / Lua)
- **Location:** `client/` directory
- **Entry:** `client/main.lua`
- **Scenes:** `client/scenes/login.lua`, `shards.lua`, `race_select.lua`, `game.lua`
- **Networking:** `client/lib/net.lua` (Socket.IO client)
- **Run:** `love client/` from project root

### Handler Pattern
All socket handlers export `{ init(io, socket, deps) }` and are registered in `socket.js`. The `deps` object contains shared state, accounts, utilities, and service instances.

---
