# MMOLite — Comprehensive QA Testing Checklist
*Version: V1.0005 | Target: All Systems*

---

## How to Use This Document

- Work top to bottom within each section.
- Mark each item: ✅ Pass | ❌ Fail | ⚠️ Partial/Note | ➖ N/A (not testable right now)
- When marking ❌ or ⚠️ write a short note: what happened vs. what was expected.
- Spawn a fresh account for each major section unless the section says to reuse an existing one.
- You'll need at least **two client sessions** (two separate machines or two LOVE instances) for multiplayer tests.

---

## Section 0 — Environment Setup

| # | Step | Expected |
|---|------|----------|
| 0.1 | Launch the server (`npm start`) | Server starts, logs "Server listening on port 3000/3001", no crash |
| 0.2 | Launch the LOVE client (`love client/`) | Login screen appears, no Lua errors in console |
| 0.3 | Check console for any startup errors or unhandled exceptions | None |
| 0.4 | (Production) SSH into KVM1, confirm `pm2 status` shows mmolite and mmolite-master as **online** | Both online |
| 0.5 | (Production) SSH into KVM2, confirm `pm2 status` shows mmolite as **online** | Online |

---

## Section 1 — Connection & Authentication

### 1.1 Account Creation

| # | Step | Expected |
|---|------|----------|
| 1.1.1 | Enter a new username on the login screen and press login | Account created, moves to race selection or game |
| 1.1.2 | Try a username with special characters (e.g. `test<script>`) | Sanitized or rejected gracefully |
| 1.1.3 | Try an empty username | Error message shown, does not crash |
| 1.1.4 | Try a very long username (50+ chars) | Rejected or truncated |
| 1.1.5 | Create an account, disconnect, log back in with same username | Recognized as existing account, no duplicate created |
| 1.1.6 | Log in from two clients simultaneously with the same account | Second login kicks the first session (or vice versa) |

### 1.2 PIN System

| # | Step | Expected |
|---|------|----------|
| 1.2.1 | On a new account, set a PIN when prompted | PIN saved, not stored in plaintext |
| 1.2.2 | Disconnect and reconnect — enter the correct PIN | Allowed in |
| 1.2.3 | Enter a wrong PIN | Rejected with error message |
| 1.2.4 | Enter wrong PIN 3+ times | Rate-limited or locked temporarily |

### 1.3 Session & Rate Limits

| # | Step | Expected |
|---|------|----------|
| 1.3.1 | Connect and disconnect rapidly 10 times from same IP | Rate limit kicks in around attempt 60/hr (may need scripting) |
| 1.3.2 | Open 4+ simultaneous connections from same IP | 4th connection rejected (max 3 per IP) |
| 1.3.3 | Reconnect after exactly 24 hours | Session expired, must re-authenticate |

---

## Section 2 — Character Creation

### 2.1 Race Selection

| # | Step | Expected |
|---|------|----------|
| 2.1.1 | On a new account, press `E` on the race selection NPCs | Race selection screen appears |
| 2.1.2 | Inspect all 8 race descriptions shown | Correct stats/perks displayed for each |
| 2.1.3 | Select **Human** | Character created as Human; no re-selection possible |
| 2.1.4 | Try sending `race_select` event after already having a race | Server rejects with error |
| 2.1.5 | Repeat test above for each race on separate accounts: Elf, Orc, Dwarf, Gnome, Goblin, Lizard Folk, Cat Folk | Each race sets correct base stats and racial feat |

### 2.2 Stat Allocation

| # | Step | Expected |
|---|------|----------|
| 2.2.1 | Press `C` (character sheet) on a new character | Shows 5 free stat points to allocate |
| 2.2.2 | Allocate all 5 points across different stats | Stats update, points reach 0 |
| 2.2.3 | Try to allocate more points than available | Rejected |
| 2.2.4 | Verify stat points are awarded every 3 levels upon level-up | +1 point shown at level 3, 6, 9, etc. |

### 2.3 Awakening / Mounts

| # | Step | Expected |
|---|------|----------|
| 2.3.1 | Call `get_available_awakenings` | Returns valid awakening options for the character's race |
| 2.3.2 | Select an awakening via `select_awakening` | Awakening saved to account |
| 2.3.3 | Use `set_mount` with a valid mount ID | Mount stored on account |
| 2.3.4 | Use `set_mount` with an invalid mount ID | Rejected gracefully |

---

## Section 3 — Overworld Movement & Zones

### 3.1 Basic Movement

| # | Step | Expected |
|---|------|----------|
| 3.1.1 | Press W/A/S/D | Character moves in correct direction |
| 3.1.2 | Hold a direction key | Character continues moving smoothly |
| 3.1.3 | Walk into an impassable tile (tree, water, wall) | Movement blocked, no position desync |
| 3.1.4 | Move rapidly and check server corrects position if needed | `zone_move_corrected` fires and snaps client back if too far off |
| 3.1.5 | Move while over-encumbered (carry > limit) | Movement blocked, "too encumbered" message shown |

### 3.2 Zone Transitions

| # | Step | Expected |
|---|------|----------|
| 3.2.1 | Walk to a zone connection point and press `E` | Zone transition occurs, `zone_state` received |
| 3.2.2 | Enter a private property zone without permission | `zone_error: This property is private` |
| 3.2.3 | Enter a zone that is at capacity | `zone_error: Zone is full` |
| 3.2.4 | Enter a zone while in active combat | `zone_error: Cannot leave while in combat` |
| 3.2.5 | Enter 5 different zones and check correct zone names/IDs | Each zone displays correct name |
| 3.2.6 | Visit all 10 anchor towns (list in `director/director-lich.js`) | Each town loads, NPCs visible |
| 3.2.7 | Press `M` to open the zone list / world map | Map opens; press M again or Esc to close |

### 3.3 Chunk Streaming (Overworld)

| # | Step | Expected |
|---|------|----------|
| 3.3.1 | Walk in any direction for 30+ seconds | New chunks stream in smoothly, no empty black squares |
| 3.3.2 | Walk back the same path | Previously seen chunks reload correctly |
| 3.3.3 | Stand still for 60 seconds then move | No stale chunk errors |

### 3.4 Biome Weather

| # | Step | Expected |
|---|------|----------|
| 3.4.1 | Enter a zone — check for `biome_weather` message | Weather reported correctly for the biome |
| 3.4.2 | Wait for weather tick (every 5 minutes server-side) | Weather can change; client notified |
| 3.4.3 | Verify weather effects shown in HUD or tooltip | Effect description visible |

### 3.5 NPC Interaction (Overworld)

| # | Step | Expected |
|---|------|----------|
| 3.5.1 | Walk up to any NPC and press `E` | `npc_interact_result` shows dialogue |
| 3.5.2 | Interact with a Portal Nexus NPC | Portal panel opens |
| 3.5.3 | Interact with an NPC shop keeper | NPC shop panel opens |
| 3.5.4 | Interact with the Adventure Guild NPC | Guild signup dialogue shown |
| 3.5.5 | Interact with an NPC while karma ≤ -30 | Guard hostile message; NPC refuses or attacks |
| 3.5.6 | Interact with an NPC after unlocking favorable faction rep | Dialogue changes / discount shown |
| 3.5.7 | Choose an NPC dialogue option (`npc_dialogue_choice`) | Correct action fires (rumor reveal, faction rep gain, etc.) |
| 3.5.8 | Try interacting with a sleeping NPC (outside sleep hours) | NPC responds; inside sleep hours gets "sleeping" message |

### 3.6 Town Rumors

| # | Step | Expected |
|---|------|----------|
| 3.6.1 | Enter a town zone | `town_rumors` event received with 1–5 rumors |
| 3.6.2 | Verify rumors shown are appropriate for that town's pool | No rumors from unrelated towns |

### 3.7 Chat

| # | Step | Expected |
|---|------|----------|
| 3.7.1 | Press Enter, type a message, press Enter again | Message appears in zone chat for nearby players |
| 3.7.2 | Test chat range — two players 50+ tiles apart | Players beyond range don't see the message (proximity chat) |
| 3.7.3 | Send a slur-filtered word | Message blocked or filtered |
| 3.7.4 | Try sending empty message | No message sent |
| 3.7.5 | Spam 10 messages quickly | Rate limited after threshold |

---

## Section 4 — Resource Harvesting

| # | Step | Expected |
|---|------|----------|
| 4.1 | Hover over a resource node and press `E` | `harvest_result` event, resource added to inventory |
| 4.2 | Harvest a resource at insufficient skill level | `harvest_error` with reason |
| 4.3 | Harvest same node repeatedly until depleted | `resource_depleted` event fires; node grays out for other players |
| 4.4 | Stand too far from a resource and press `E` | `harvest_error: Too far away` |
| 4.5 | Harvest rapidly (spam E) | Rate limited — `harvest_error: Harvesting too fast` |
| 4.6 | Verify mining gives stone/iron/ore per biome config | Correct resources for each type (wood=woodcutting, fish=fishing, etc.) |
| 4.7 | Harvest with a Dwarf character | +25% mining/crafting bonus applies (yields more or XP boosted) |
| 4.8 | Check for rare resource drops (Dwarf/Lizard Folk racial bonus) | `bonus_drop` event occasionally fires |
| 4.9 | Check for rare seed drops during herb/plant harvesting | `bonus_drop` with rare seed type |
| 4.10 | Verify correct skill XP awarded (Mining, Woodcutting, Farming, Fishing) | Skill level increases after enough harvests |
| 4.11 | Harvest with tool equipped that has low durability | `durability_warning` or `item_broken` event fires |

---

## Section 5 — Inventory & Equipment

### 5.1 Inventory

| # | Step | Expected |
|---|------|----------|
| 5.1.1 | Press `I` | Inventory panel opens |
| 5.1.2 | Press `I` again | Inventory panel closes |
| 5.1.3 | Verify all harvested resources appear in inventory | Correct types and quantities |
| 5.1.4 | Open inventory when encumbered | Encumbrance level shown |
| 5.1.5 | Use `item_sell` on an item in inventory | Item removed, coins added |
| 5.1.6 | Try to sell an item you don't own | Rejected |

### 5.2 Equipment Panel

| # | Step | Expected |
|---|------|----------|
| 5.2.1 | Press `G` | Equipment panel opens showing all slots |
| 5.2.2 | Equip an item via `item_equip` | Item moves to correct slot, stats update |
| 5.2.3 | Unequip via `item_unequip` | Item returns to inventory |
| 5.2.4 | Equip a weapon — check weapon special ability name shown in HUD | Weapon special visible |
| 5.2.5 | Open equipment panel, check durability bars on all items | Durability values shown correctly |
| 5.2.6 | Press `G` again or Esc | Panel closes |

### 5.3 Item Tooltips

| # | Step | Expected |
|---|------|----------|
| 5.3.1 | Hover mouse over item in inventory | Tooltip shows: name, rarity, stats, affixes, curses (if any) |
| 5.3.2 | Hover over equipped card | Tooltip shows all card effects including passive rider |

### 5.4 Loot Catalog & Portraits

| # | Step | Expected |
|---|------|----------|
| 5.4.1 | Send `loot_catalog` event | Full loot table returned |
| 5.4.2 | Send `portraits_get` | Portrait list returned |
| 5.4.3 | Set avatar via `avatar_set` | Avatar saved to account |
| 5.4.4 | Set item showcase via `profile_set_showcase` | Showcase saved |

---

## Section 6 — Crafting System

### 6.1 Recipes & Station Requirements

| # | Step | Expected |
|---|------|----------|
| 6.1.1 | Press `I` then go to Crafting tab | Recipes panel shown |
| 6.1.2 | Interact with a Forge object, open crafting — check filter | Only forge-compatible recipes shown |
| 6.1.3 | Attempt to craft without being near required station | `craft_error: No valid crafting station nearby` (or similar) |
| 6.1.4 | Stand next to a forge and attempt a forge recipe | Craft proceeds |
| 6.1.5 | Check all station types: Forge, Anvil, Alchemy Table, Loom, Brewery, Enchanting Table, Cauldron | Each shows correct recipes when filtering |

### 6.2 Crafting a Basic Item

| # | Step | Expected |
|---|------|----------|
| 6.2.1 | Have required materials; attempt `craft_item` | Minigame triggered OR item crafted directly |
| 6.2.2 | Complete the minigame successfully (`craft_minigame_result` with success) | Item added to inventory with quality bonus |
| 6.2.3 | Fail the minigame (`craft_minigame_result` with fail) | Item still crafted but at lower quality (or lost, per design) |
| 6.2.4 | Craft with insufficient materials | `craft_error` with clear reason |
| 6.2.5 | Craft with insufficient skill level | `craft_error` mentioning skill requirement |
| 6.2.6 | Craft same item at skill level 1 vs. skill level 67 | Higher skill yields better base stats (+up to 20%) |
| 6.2.7 | Dwarf crafting (+25% bonus) — compare output to Human | Dwarf gets measurably better crafting quality or XP |

### 6.3 Item Enhancement

| # | Step | Expected |
|---|------|----------|
| 6.3.1 | `repair_item` on a damaged item | Durability restored, costs materials |
| 6.3.2 | `emergency_repair` with no materials | Uses alternate method or error |
| 6.3.3 | `gem_socket_item` on a compatible item | Gem applied, stats changed |
| 6.3.4 | `apply_augment` | Augment applied, existing stats modified |
| 6.3.5 | `imbue_ring` with mana crystal | Ring imbued with magic effect |
| 6.3.6 | `inscribe_scroll` | Scroll inscription saved; usable in dungeon slot |
| 6.3.7 | `consume_food` — check stat buff applied | Buff visible in character sheet |

---

## Section 7 — Card System

### 7.1 Opening Packs

| # | Step | Expected |
|---|------|----------|
| 7.1.1 | Level up to trigger card pack award | `pendingPacks` > 0 on account |
| 7.1.2 | Send `card_open_pack` | 5–7 cards returned, added to `rpgCards` |
| 7.1.3 | Open a pack as Elf | ~40% of cards should be from magic-tagged pool |
| 7.1.4 | Open a pack as Goblin | ~35% of cards forced to stealth-tagged pool |
| 7.1.5 | Open a pack as Cat Folk | ~40% forced luck-tagged pool; +20% rarity bump chance observed |
| 7.1.6 | Open a pack as Lizard Folk | ~25% forced ritual-tagged pool |
| 7.1.7 | Open 50 packs; verify rarity distribution approximates 45/25/15/8/4/2/0.8/0.2% | Within statistical tolerance |
| 7.1.8 | Verify 1.5% curse chance per card — after 50+ packs some cursed cards exist | Cursed cards appear in collection |
| 7.1.9 | Check that affixes are rolled on cards of correct rarities (0 for common, 1 for uncommon, 2 for rare, etc.) | Affix counts match AFFIX_COUNT_BY_RARITY |
| 7.1.10 | Open pack with no pending packs | Rejected with error |

### 7.2 Card Collection Panel

| # | Step | Expected |
|---|------|----------|
| 7.2.1 | Press `K` | Card collection panel opens |
| 7.2.2 | Scroll through cards | All owned cards visible |
| 7.2.3 | Hover card — check affixes, passiveRider, evolution data shown | Tooltip complete |
| 7.2.4 | Switch to vendor tab | Vendor catalog loaded |
| 7.2.5 | Switch to loadouts tab | Saved loadouts shown |

### 7.3 Equipping Cards

| # | Step | Expected |
|---|------|----------|
| 7.3.1 | Equip a card (`card_equip`) | Card moves to equipped slot, effects active |
| 7.3.2 | Equip past the slot limit (slot count varies by level: +1 at 10/20/30/40) | Rejected if no free slot |
| 7.3.3 | Unequip a card (`card_unequip`) | Card returns to collection |
| 7.3.4 | Equip a racial innate card to a character of wrong race | Rejected |
| 7.3.5 | Verify luck_bonus from Cat Folk card equipment affects subsequent pack rolls | Luck bonus aggregated via `getPlayerLuck` |

### 7.4 Card Fusion

| # | Step | Expected |
|---|------|----------|
| 7.4.1 | Select two cards of same rarity and fuse | Result is next rarity tier |
| 7.4.2 | Fuse two copies of the same card | Effects stack with 5% bonus |
| 7.4.3 | Fuse two different cards of same rarity | Hybrid card with both effect sets merged |
| 7.4.4 | Fuse a card at max fusion level (2) | Rejected or noted as max |
| 7.4.5 | Verify affixes merge correctly (highest tier per id from both cards) | Combined affix set correct |
| 7.4.6 | Check passiveRider preserved after fusion | passiveRider from card1 or card2 present |

### 7.5 Card Evolution

| # | Step | Expected |
|---|------|----------|
| 7.5.1 | Equip a card and gain combat XP | `evoXp` on card increases |
| 7.5.2 | Reach evolution threshold (100 XP) | Evolution prompt sent to client |
| 7.5.3 | Choose evolution path A via `card_choose_evolution_path` | Card takes path A effects |
| 7.5.4 | Choose evolution path B | Card takes path B effects |
| 7.5.5 | Check `get_card_evolution_info` for a card | Returns evoXp, stage, available paths |

### 7.6 Card Vendor

| # | Step | Expected |
|---|------|----------|
| 7.6.1 | `card_vendor_buy` — buy a Common card | Coins deducted, card added to collection |
| 7.6.2 | `card_vendor_buy` — buy an Uncommon card | Works with enough coins |
| 7.6.3 | `card_vendor_buy` with insufficient coins | Rejected with error |
| 7.6.4 | `card_vendor_sell` — sell a card | Coins added (25% base value × style multiplier) |
| 7.6.5 | Sell a golden/holographic/prismatic card | Higher sell value than normal |

### 7.7 Card Curses & Cleansing

| # | Step | Expected |
|---|------|----------|
| 7.7.1 | Find a cursed card in collection | Curse shown in tooltip |
| 7.7.2 | `cleanse_card_curse` without a purification_crystal | Rejected |
| 7.7.3 | `cleanse_card_curse` with a purification_crystal | Curse removed, crystal consumed |

### 7.8 Card Loadouts

| # | Step | Expected |
|---|------|----------|
| 7.8.1 | `card_save_loadout` with a name | Loadout saved |
| 7.8.2 | `card_load_loadout` | Cards equipped as saved |
| 7.8.3 | `get_card_loadouts` | All saved loadouts returned |
| 7.8.4 | Save more than the allowed loadout count | Rejected or oldest overwritten |

### 7.9 Card Shop (Real-money/special)

| # | Step | Expected |
|---|------|----------|
| 7.9.1 | `browse_card_shop` | Card shop inventory returned |
| 7.9.2 | `buy_card` with sufficient currency | Card added, currency deducted |

---

## Section 8 — NPC Shop

| # | Step | Expected |
|---|------|----------|
| 8.1 | Interact with a shopkeeper NPC | NPC shop panel opens |
| 8.2 | `npc_shop_browse` | List of available shops returned |
| 8.3 | `npc_shop_prices` for a specific shopId | Price list returned with fluctuated prices |
| 8.4 | `npc_shop_buy` — buy 1 item with enough coins | Item added to inventory, coins deducted |
| 8.5 | `npc_shop_buy` — buy 0 or negative quantity | Rejected |
| 8.6 | `npc_shop_buy` with insufficient coins | Rejected with error |
| 8.7 | `npc_shop_sell` — sell a resource | Resource removed, coins added |
| 8.8 | Buy then sell back — verify sell price < buy price (spread exists) | Economy not exploitable at 1:1 |
| 8.9 | Check that prices fluctuate after 30 seconds | Buy/sell pressure causes small price change |
| 8.10 | Test Presence stat (high vs. low) — verify up to 30% discount | High Presence character gets cheaper prices |
| 8.11 | `npc_shop_all_prices` | Returns all shop prices in one call |

---

## Section 9 — Player Auction House

| # | Step | Expected |
|---|------|----------|
| 9.1 | Press `J` (when not in dungeon/starter town context) | Auction house panel opens |
| 9.2 | `mmo_auction_browse` with no filters | Returns all active listings |
| 9.3 | `mmo_auction_browse` with filters (rarity, type) | Correctly filtered results |
| 9.4 | `mmo_auction_list_card` with price and duration | Card listed; deducted from collection |
| 9.5 | `mmo_auction_list_resource` | Resource listed |
| 9.6 | `mmo_auction_buy` the listing from a second account | Buyer gets item; seller gets coins minus 5% fee |
| 9.7 | `mmo_auction_cancel` own listing | Item returned to owner |
| 9.8 | Try to `mmo_auction_buy` your own listing | Rejected |
| 9.9 | Try to buy a listing that another client already purchased simultaneously | Purchase lock prevents race condition; second buyer gets error |
| 9.10 | Let a listing expire (24h or test with shortened time) | Listing removed, item returned to seller |
| 9.11 | `mmo_auction_my_listings` | Only own listings returned |
| 9.12 | Try to list a race-locked card (lizardfolk ritual) with wrong race account | Rejected |

---

## Section 10 — P2P Trading

| # | Step | Expected |
|---|------|----------|
| 10.1 | Player A sends `trade_request` to Player B | Player B receives trade request popup |
| 10.2 | Player B accepts (`trade_accept`) | Trade window opens for both |
| 10.3 | Both players offer items/resources/coins (`trade_offer`) | Offers visible on both sides |
| 10.4 | Both confirm (`trade_confirm`) | Items swapped atomically |
| 10.5 | One player cancels (`trade_cancel`) | Trade cancelled, items returned |
| 10.6 | Player A offers more coins than they have | Rejected |
| 10.7 | Try trading a racial-innate card to a different race | Rejected with restriction message |
| 10.8 | Trade disconnects mid-session (disconnect one client) | Items not lost, trade cancelled cleanly |
| 10.9 | Trade request times out (no response within window) | Request expires, `trade_expired` message |

---

## Section 11 — Guild System

| # | Step | Expected |
|---|------|----------|
| 11.1 | `guild_create` with a unique name | Guild created, creator is leader |
| 11.2 | `guild_create` with a duplicate name | Rejected |
| 11.3 | `guild_list` | All active guilds shown |
| 11.4 | `guild_join` (player B joins) | Player added to guild |
| 11.5 | `guild_leave` | Player removed; guild persists |
| 11.6 | Last member leaves guild | Guild dissolved (or kept empty, per design) |
| 11.7 | `guild_chat` | Message visible only to guild members |
| 11.8 | Non-guild member sends `guild_chat` | Rejected |
| 11.9 | `guild_vault_browse` | Guild vault contents shown |
| 11.10 | `guild_vault_deposit` — deposit a resource | Resource in vault |
| 11.11 | `guild_vault_withdraw` — withdraw as guild member | Resource returned to inventory |
| 11.12 | Non-member tries vault operations | Rejected |
| 11.13 | Restart server — check guild still exists | **Known limitation:** guilds are runtime-only; this is expected to FAIL. Document it. |

---

## Section 12 — Party System

| # | Step | Expected |
|---|------|----------|
| 12.1 | `party_create` | Party created, creator is leader |
| 12.2 | `party_invite` Player B | B receives invite |
| 12.3 | `party_accept` (Player B) | B joins party |
| 12.4 | Press `Y` | Party panel shows all members |
| 12.5 | `party_chat` | Message visible only to party members |
| 12.6 | `party_kick` a member (as leader) | Member removed |
| 12.7 | Non-leader tries to `party_kick` | Rejected |
| 12.8 | `party_leave` | Player leaves; remaining members still in party |
| 12.9 | Leader leaves | Leadership transfers or party disbands |
| 12.10 | Party of 4 members — try to invite a 5th | Rejected (max 4 per party) |

---

## Section 13 — Dungeon System

### 13.1 Entering the Rift

| # | Step | Expected |
|---|------|----------|
| 13.1.1 | Approach the Rift entrance NPC in starter town; press `E` | Adventure Guild signup prompt shown |
| 13.1.2 | `dungeon_guild_signup` — join the Adventure Guild | Guild rank set to Stone (rank 1) |
| 13.1.3 | Sign up again after already member | "Already a member" message |
| 13.1.4 | Interact with Rift entrance after joining | `dungeon_enter` with dungeonId "rift" |
| 13.1.5 | Verify floor 1 loads: castle theme, BSP/MAZE layout | Floor tiles visible, fog of war active |

### 13.2 Entering an Overworld Cave

| # | Step | Expected |
|---|------|----------|
| 13.2.1 | Find a cave entrance on the overworld and press `E` | `cave_enter` sent; if dungeon cave, `cave_is_dungeon` response |
| 13.2.2 | Enter cave dungeon without guild membership | Allowed (no guild requirement for caves) |
| 13.2.3 | Cave floors are 3–10 based on biome | Correct floor count |
| 13.2.4 | Cave final floor has a boss | Boss present on last floor |

### 13.3 Dungeon Movement

| # | Step | Expected |
|---|------|----------|
| 13.3.1 | WASD movement inside dungeon | Player moves tile by tile, fog of war reveals |
| 13.3.2 | Walk into a wall tile | Blocked; position unchanged |
| 13.3.3 | Move to STAIRS_DOWN tile and press `E` | `dungeon_descend` — next floor loads |
| 13.3.4 | Move to STAIRS_UP tile and press `E` | `dungeon_ascend` — previous floor loads |
| 13.3.5 | On floor 1, step on ENTRANCE tile and press `E` | `dungeon_exit` — return to overworld |
| 13.3.6 | Press `Q` | Immediate dungeon exit |

### 13.4 Combat

| # | Step | Expected |
|---|------|----------|
| 13.4.1 | Walk adjacent to an enemy | Enemy notice/alert indicator shown |
| 13.4.2 | `dungeon_attack` targeting an enemy | Combat initiated; enemy HP reduced |
| 13.4.3 | Enemy attacks back on its turn | Player HP reduced correctly |
| 13.4.4 | Kill an enemy | XP awarded, enemy corpse spawns |
| 13.4.5 | `dungeon_examine_corpse` | Loot table shown |
| 13.4.6 | Player HP reaches 0 | Player downed; `player_downed` event (bleedout timer starts; ally can revive within window) |
| 13.4.7 | Adjacent ally uses `revive_player` within 2 tiles | Player revived |
| 13.4.8 | No one revives downed player in time | Permadeath confirmed; teleported to town |
| 13.4.9 | Press `F` in dungeon — weapon special attack | Fires if charge is full; charge resets |
| 13.4.10 | Press `1`/`2`/`3`/`4` — inscription slot abilities | Inscription fires if not on cooldown |
| 13.4.11 | `use_ability` — general ability use | Ability effect applied |
| 13.4.12 | `use_card_ability` | Card ability effect applied, cooldown set |
| 13.4.13 | `dungeon_get_combat_state` | Returns current combat state |

### 13.5 Chests & Loot

| # | Step | Expected |
|---|------|----------|
| 13.5.1 | Find a chest — stand adjacent and press `E` | `dungeon_open_chest` sent |
| 13.5.2 | Chest opens — receive items | Loot added to inventory; item mutations may apply |
| 13.5.3 | Try to open an already-opened chest | Rejected or no result |
| 13.5.4 | Boss chest (floor 10 Rift) | Better loot; 8% curse chance on boss drops |
| 13.5.5 | Verify player luck (Cat Folk / luck cards) affects chest rolls | Higher luck = better items statistically |

### 13.6 Dungeon NPCs & Resources

| # | Step | Expected |
|---|------|----------|
| 13.6.1 | Find an NPC inside dungeon; press `E` | `dungeon_interact_npc` — dialogue/merchant shown |
| 13.6.2 | `dungeon_form_interact` on a form/altar | Appropriate event response |
| 13.6.3 | `dungeon_harvest` on a dungeon resource node | Resource added to inventory |
| 13.6.4 | `dungeon_interact_animal` | Animal interaction result shown |

### 13.7 Dungeon Lighting

| # | Step | Expected |
|---|------|----------|
| 13.7.1 | Enter a dark dungeon without torch | Vision limited |
| 13.7.2 | Press `T` (use torch) | Torch lit, vision radius expands |
| 13.7.3 | `dungeon_place_torch` | Torch placed on a tile, illuminates area |
| 13.7.4 | `dungeon_use_lantern` | Lantern provides persistent light |
| 13.7.5 | Press `V` | Cycles vision type (normal / darkvision / thermal) |
| 13.7.6 | Dwarf/Goblin/Cat Folk enter dark dungeon | Darkvision automatically applied |
| 13.7.7 | Lizard Folk in dungeon | Thermal vision active |

### 13.8 Rift-Only: Camps

| # | Step | Expected |
|---|------|----------|
| 13.8.1 | `dungeon_camp_place` — place a camp in valid spot | Camp placed on floor |
| 13.8.2 | `dungeon_camp_action` — cook food at camp | Food cooked, stat buff applied |
| 13.8.3 | `dungeon_camp_action` — use shrine buff | Buff applied |
| 13.8.4 | Camp ambush triggers (random chance) | Enemy spawns near camp |

### 13.9 Rift Quests & Leaderboard

| # | Step | Expected |
|---|------|----------|
| 13.9.1 | `dungeon_quest_list` | 3–5 daily quests shown (today's seed) |
| 13.9.2 | Complete a quest objective (kill X enemies etc.) | `quest_progress` events fire |
| 13.9.3 | `dungeon_quest_complete` when requirements met | Reward given, quest marked done |
| 13.9.4 | Try to complete same quest twice | Rejected |
| 13.9.5 | `dungeon_leaderboard` | Top Rift delvers shown |
| 13.9.6 | Press `L` | Leaderboard panel toggles |

### 13.10 Boss Floor (Floor 10+)

| # | Step | Expected |
|---|------|----------|
| 13.10.1 | Reach floor 10 of the Rift | ARENA layout, boss enemy present |
| 13.10.2 | Defeat the boss | Rift sealed panel shows rewards (gold/XP/mana crystals/card packs) |
| 13.10.3 | Every 10th floor is an ARENA boss | Floors 10, 20, 30 all have boss |

### 13.11 Lich Raid

| # | Step | Expected |
|---|------|----------|
| 13.11.1 | Multiple parties gather at raid entrance | Gathering panel shows party count and player count |
| 13.11.2 | `raid_force_start` as leader | Raid begins scaling to group size |
| 13.11.3 | `raid_enter_floor` | Party enters raid floor |
| 13.11.4 | Min required / max 32 players enforced | Over 32 players cannot join |

### 13.12 Dungeon Chat

| # | Step | Expected |
|---|------|----------|
| 13.12.1 | Press Enter in dungeon, type a message | `dungeon_chat` — message visible to all on same floor |
| 13.12.2 | Party member on different floor cannot see the message | Floor-isolated chat |

---

## Section 14 — Portal System

| # | Step | Expected |
|---|------|----------|
| 14.1 | Interact with Portal Nexus NPC | `portal_list` sent; portal panel opens |
| 14.2 | Select a destination town | `portal_travel` sent; teleported to destination |
| 14.3 | Verify all 10 anchor towns are listed as destinations | All towns available |
| 14.4 | Travel to town, then immediately travel again | 30-second cooldown enforced |
| 14.5 | `home_teleport` (press `H`) | Teleported to home/respawn point |
| 14.6 | Craft a personal portal on player plot (`portal_craft`) | Portal object placed on plot; requires crafting lv20 + materials |
| 14.7 | Use personal portal (`portal_travel` with personal portal ID) | Teleports to owner's plot |
| 14.8 | `portal_destroy` own portal | Portal removed |
| 14.9 | Non-owner tries to `portal_destroy` | Rejected |

---

## Section 15 — Plot & Placement System

### 15.1 Plot Claiming

| # | Step | Expected |
|---|------|----------|
| 15.1.1 | Press `P` in overworld | `claim_plot` sent |
| 15.1.2 | Plot claim succeeds | Plot highlighted; player assigned plotId |
| 15.1.3 | Try to claim a plot while already owning one | Rejected |
| 15.1.4 | Try to claim a plot someone else owns | Rejected |
| 15.1.5 | Press `P` while owning a plot (first time) | Unclaim confirmation prompt shown |
| 15.1.6 | Press `P` again to confirm | `unclaim_plot {confirmed: true}` sent; plot released |
| 15.1.7 | After releasing, another player can claim the same plot | Confirmed claimable |
| 15.2.8 | `set_plot_access` — set private/public/friends-only | Access mode saved |

### 15.2 Object Placement

| # | Step | Expected |
|---|------|----------|
| 15.2.1 | On owned plot, `place_object` with a valid object type | Object appears at position |
| 15.2.2 | Place the same object type that already fills its limit | Rejected |
| 15.2.3 | Try placing an object on someone else's plot | Rejected |
| 15.2.4 | `remove_object` | Object removed |
| 15.2.5 | `interact_object` with a storage chest | Chest opens/closes |
| 15.2.6 | `get_placed_objects` | All placed objects on plot returned |
| 15.2.7 | Interact with Forge on plot | Crafting panel opens with forge filter |
| 15.2.8 | Interact with Alchemy Table | Crafting panel with alchemy_table filter |
| 15.2.9 | Interact with bed | `furniture_interact` sent with action "sleep" |

---

## Section 16 — Farming System

| # | Step | Expected |
|---|------|----------|
| 16.1 | Press `F` | Farming panel opens |
| 16.2 | Interact with a crop_plot object on plot | Farming panel opens with that plot selected |
| 16.3 | `plant_seed` with a valid seed in inventory | Crop planted at stage 0 |
| 16.4 | `plant_seed` without that seed type | Rejected |
| 16.5 | `water_crop` | Crop watered; growth timer updated |
| 16.6 | Crop reaches stage 3 | Harvestable |
| 16.7 | `harvest_crop` on stage 3 crop | Produce added to inventory, plot reset |
| 16.8 | `check_crops` | All crop states returned |
| 16.9 | `animal_buy` at a farm shop | Animal added to account |
| 16.10 | `animal_place` in an animal pen on plot | Animal placed |
| 16.11 | `animal_feed` | Hunger decreases; happiness increases |
| 16.12 | Wait for animal to produce products (time-based) | Products in pending queue |
| 16.13 | `animal_collect` | Products added to inventory |
| 16.14 | `animal_name` | Animal name saved |

---

## Section 17 — Karma & Faction System

### 17.1 Karma

| # | Step | Expected |
|---|------|----------|
| 17.1.1 | `karma_status` | Returns current karma value |
| 17.1.2 | Perform a hostile action (attack NPC etc.) | Karma decreases |
| 17.1.3 | Karma drops below -20 | Auto-bounty placed (`bounty_placed` event) |
| 17.1.4 | `bounty_list` | Active bounties shown |
| 17.1.5 | Karma drops below -30 | Guards become hostile; `guard_hostile` event fires |
| 17.1.6 | Perform positive actions | Karma increases back toward 0 |

### 17.2 Factions

| # | Step | Expected |
|---|------|----------|
| 17.2.1 | `faction_status` | Returns reputation with all 11 factions |
| 17.2.2 | `faction_list` | Lists all available factions |
| 17.2.3 | Gain rep with a faction (via NPC dialogue or quest) | Rep increases; label changes (Hostile→Neutral→Friendly etc.) |
| 17.2.4 | High faction rep at shop (Friendly/Honored/Exalted) | NPC shop discount applied (up to +20%) |
| 17.2.5 | Hostile faction rep | Shop prices increase (up to -20%) or refused service |

---

## Section 18 — Companions & Pets

### 18.1 Companions

| # | Step | Expected |
|---|------|----------|
| 18.1.1 | `companion_hire` with a valid class | Companion hired (max 2) |
| 18.1.2 | `companion_hire` when at max (2) | Rejected |
| 18.1.3 | `companion_list` | Both companions shown with stats |
| 18.1.4 | `companion_status` for a companion ID | Stats, level, wages shown |
| 18.1.5 | `companion_dismiss` | Companion removed |
| 18.1.6 | Daily wage deduction (server tick) | Coins deducted automatically |
| 18.1.7 | Insufficient coins for wages | Companion leaves or warning shown |

### 18.2 Pets

| # | Step | Expected |
|---|------|----------|
| 18.2.1 | `pet_tame` near a tameable animal | Pet added (max check enforced) |
| 18.2.2 | `pet_list` | All owned pets shown |
| 18.2.3 | `pet_feed` a pet | Hunger decreases, happiness increases |
| 18.2.4 | `pet_set_active` | Active pet set; buffs applied |
| 18.2.5 | Pet hunger/happiness decay over time | Stats decrease passively |
| 18.2.6 | Pet evolves at evolution threshold | Stage 1→2→3 with improved stats |

---

## Section 19 — Ascension (Prestige)

| # | Step | Expected |
|---|------|----------|
| 19.1 | `ascension_status` before level 100 | "Not eligible" message |
| 19.2 | Reach level 100 and send `ascension_status` | Eligible; shows 8-node AP tree |
| 19.3 | `ascension_confirm` | Prestige; level reset; ascension points granted |
| 19.4 | `ascension_spend_ap` on a valid node | Node unlocked; bonus applied |
| 19.5 | Spend AP on a node already unlocked | Rejected |
| 19.6 | Spend more AP than available | Rejected |

---

## Section 20 — Prison System

| # | Step | Expected |
|---|------|----------|
| 20.1 | `jail_status` | Returns prison status if jailed |
| 20.2 | Get arrested (via karma/bounty trigger) | Player jailed; `arrestPlayer` event |
| 20.3 | `jail_bail` with enough coins | Released; coins deducted |
| 20.4 | `jail_bail` with insufficient coins | Rejected |
| 20.5 | `jail_serve_time` | Wait timer starts; released after duration |
| 20.6 | Jailed player tries to move to another zone | Blocked (jailed) |

---

## Section 21 — Afflictions

| # | Step | Expected |
|---|------|----------|
| 21.1 | `affliction_status` | Returns any active afflictions |
| 21.2 | Expose character to vampire (director system active) | Vampire exposure tracked |
| 21.3 | `cure_vampire_exposure` in time | Exposure cleared |
| 21.4 | Let exposure progress — become vampire | Vampire affliction applied |
| 21.5 | Werewolf pack encounter during full moon | Lycanthropy exposure possible |
| 21.6 | `cure_lycanthropy` | Lycanthropy cured |

---

## Section 22 — Corruption System

| # | Step | Expected |
|---|------|----------|
| 22.1 | Enter a corrupted chunk — check HUD | Corruption level shown |
| 22.2 | Press `F` in corrupted area | `corruption_cleanse` sent (requires purification_crystal) |
| 22.3 | Press `R` in corrupted area with cleansing card equipped | `corruption_card_cleanse` sent; HP/mana drained |
| 22.4 | Successful cleanse | `corruption_cleanse_result` success; chunk corruption reduced |
| 22.5 | Cleanse without required item/card | Error shown |
| 22.6 | Cleanse when HP too low (would die) | "Not enough life force" error |
| 22.7 | Nearby players receive `corruption_update` after cleanse | Other clients see updated corruption |

---

## Section 23 — DMs & Friends

### 23.1 Friends

| # | Step | Expected |
|---|------|----------|
| 23.1.1 | `friend_request_send` to a valid player ID | Request sent |
| 23.1.2 | `friend_request_send` to yourself | Rejected |
| 23.1.3 | `friend_request_send` to already-friend | Rejected |
| 23.1.4 | `friend_request_accept` | Both players now friends |
| 23.1.5 | `friend_request_reject` | Request deleted |
| 23.1.6 | `friends_list_get` | Returns full friends list |
| 23.1.7 | `friend_remove` | Friend removed from both sides |
| 23.1.8 | `friend_block` | Player blocked; cannot interact |
| 23.1.9 | `friend_unblock` | Block removed |
| 23.1.10 | `friend_invite_game` | Game invite sent to friend |
| 23.1.11 | `profile_request` for another player | Profile returned |

### 23.2 Direct Messages

| # | Step | Expected |
|---|------|----------|
| 23.2.1 | `dm_set_public_key` | Encryption key stored |
| 23.2.2 | `dm_get_public_key` for another player | Their public key returned |
| 23.2.3 | `dm_send` a message | Message delivered to recipient |
| 23.2.4 | `dm_history` | Conversation history returned |
| 23.2.5 | `dm_conversations` | All DM conversations listed |
| 23.2.6 | `dm_delete_message` | Message removed |
| 23.2.7 | Send DM to blocked user | Rejected |

---

## Section 24 — Knowledge / Lore System

| # | Step | Expected |
|---|------|----------|
| 24.1 | Press `B` | Knowledge panel opens |
| 24.2 | `knowledge_get` with default tab | Returns unlocked glossary terms |
| 24.3 | Harvest a resource that triggers a knowledge unlock | `knowledge_term_unlocked` event fires |
| 24.4 | Find a lore book in dungeon / world | Book entry shown as available |
| 24.5 | `knowledge_read_book` for an available book | Full book text returned |
| 24.6 | `knowledge_read_book` for a book not yet found | Rejected |
| 24.7 | Check glossary entries reference valid book IDs | No broken unlockTrigger references |

---

## Section 25 — Wild Encounters & Animals

| # | Step | Expected |
|---|------|----------|
| 25.1 | `wild_encounter_check` while moving in wilderness | Returns encounter or null |
| 25.2 | `zone_interact_animal` near an animal | Animal interaction result |
| 25.3 | Animal already interacted with | Error: "already interacted" |
| 25.4 | Stand too far from animal | Error: "Too far from animal" |
| 25.5 | Lizard Folk interacting with ocean animals | Bonus from Aquatic Heritage |

---

## Section 26 — Director Systems (Background AI Events)

*These are server-side ticking processes — observe the world state over time.*

| # | Step | Expected |
|---|------|----------|
| 26.1 | Wait 10+ minutes; check if vampire infiltration has ticked | Vampires may appear in a town; `world_event` broadcast |
| 26.2 | If 3+ vampire NPCs active, epidemic triggers | Epidemic warning broadcast |
| 26.3 | If 5+ vampires, abandoned crypt spawns | Dungeon `vampire_crypt_*` available |
| 26.4 | Clear vampire lair (`dungeon_exit` after boss kill) | `clearLair` removes that dungeon |
| 26.5 | Check lunar cycle (14-day) — full moon night | Werewolf packs spawn; lycanthropy exposure enabled |
| 26.6 | Werewolf pack defeated | Pack removed from state |
| 26.7 | Lich corruption spreading over time | More chunks become corrupted |

---

## Section 27 — World Calendar & Time

| # | Step | Expected |
|---|------|----------|
| 27.1 | Connect to server — check `calendar_update` event | Year 500, valid month/day/season |
| 27.2 | Wait 60 seconds | Calendar advances; another `calendar_update` broadcast |
| 27.3 | Season changes correctly at month boundaries | Season label updates |
| 27.4 | Full moon on day 14 of lunar cycle | `isFullMoon()` = true; werewolves active |

---

## Section 28 — Character Slots & Multi-Character

| # | Step | Expected |
|---|------|----------|
| 28.1 | `character_list` | All characters on account shown |
| 28.2 | `character_create` | New character created (within slot limit) |
| 28.3 | `character_switch` | Switch to another character |
| 28.4 | `character_rename` | Name updated |
| 28.5 | `character_delete` | Character removed (confirm prompt) |
| 28.6 | `get_name_lists` | Fantasy name suggestions returned |
| 28.7 | `hall_of_heroes` (press `H` while on hall tab) | Permadeath memorial list shown |

---

## Section 29 — Leviathan

| # | Step | Expected |
|---|------|----------|
| 29.1 | Encounter Leviathan in ocean area | Aggro window shown on client |
| 29.2 | Press `R` during aggro window | `leviathan_flee` sent; player escapes |
| 29.3 | `leviathan_engage` | Combat with Leviathan begins |
| 29.4 | `leviathan_info` | Stats and info returned |

---

## Section 30 — Quests (Overworld)

| # | Step | Expected |
|---|------|----------|
| 30.1 | `quest_list` from an NPC | Available quests shown |
| 30.2 | `quest_accept` a quest | Quest added to active quests |
| 30.3 | Complete the quest objective | `quest_progress` events fire |
| 30.4 | `quest_turnin` when complete | Reward given; quest removed |
| 30.5 | Try to accept a quest already accepted | Rejected or shows current progress |

---

## Section 31 — Admin Panel (Server Hosts Only)

| # | Step | Expected |
|---|------|----------|
| 31.1 | Press `F10` as a host account | Admin panel opens |
| 31.2 | Press `F10` or Esc | Admin panel closes |
| 31.3 | Press `F10` as non-host | Nothing happens (no panel) |

---

## Section 32 — Keybinding Completeness Check

Verify all keybindings function correctly in the appropriate context:

| Key | Context | Action |
|-----|---------|--------|
| W/A/S/D | Overworld | Move character |
| W/A/S/D | Dungeon (out of combat) | Move tile-by-tile |
| Enter | Any | Open/send chat |
| E | Overworld | Interact (NPC / resource / zone connection / object) |
| E | Dungeon | Interact (stairs / chest / NPC / corpse) |
| I | Any (not dungeon) | Toggle inventory |
| G | Any | Toggle equipment panel |
| C | Any | Toggle character sheet |
| K | Any | Toggle card collection |
| M | Any | Toggle world map / zone list |
| P | Overworld | Claim / unclaim plot |
| B | Any | Toggle knowledge panel |
| F | Overworld, corrupted tile | Corruption cleanse |
| F | Dungeon | Toggle farming panel (overworld context) OR weapon special (dungeon) |
| R | Overworld, corrupted tile | Card-based corruption cleanse / leviathan flee |
| H | Any | Home teleport |
| T | Dungeon, dark | Use torch |
| V | Dungeon | Toggle vision type |
| Q | Dungeon | Quick-exit dungeon |
| J | Dungeon | Toggle dungeon quests |
| J | Town (not dungeon) | Toggle auction house |
| L | Any | Toggle leaderboard |
| Y | Any | Toggle party panel |
| 1/2/3/4 | Dungeon (out of combat) | Use inscription slot |
| Space | Chat | Send message |
| Esc | Any | Close topmost panel / cancel current action |
| F10 | Any (host only) | Toggle admin panel |

---

## Section 33 — Edge Cases & Exploit Checks

| # | Scenario | Expected |
|---|----------|----------|
| 33.1 | Send malformed JSON in any socket event | Server handles gracefully; no crash |
| 33.2 | Send negative quantity in any buy/sell event | Rejected |
| 33.3 | Craft with quantities set to 0 | Rejected |
| 33.4 | Move while `inCombat` flag is true | Movement blocked |
| 33.5 | Send `dungeon_descend` while not in dungeon | Rejected |
| 33.6 | Equip more cards than available slots | Rejected |
| 33.7 | Auction buy with race-locked item from wrong race | Rejected |
| 33.8 | Try to place object on a plot you don't own | Rejected |
| 33.9 | Craft an item without the required skill level | Rejected |
| 33.10 | Harvest a resource from a depleted node | `harvest_error: depleted` |
| 33.11 | Log in as a jailed player — check movement | Blocked while jailed |
| 33.12 | Try to use card ability on cooldown | `use_card_ability` rejected |
| 33.13 | Two players buy same auction listing simultaneously | One gets it; other gets "already sold" |
| 33.14 | Trade with a player who disconnects mid-trade | Items not lost; trade cancelled |
| 33.15 | Overflow attack by sending 1000+ events per second | Rate limit kicks in; connection not dropped |

---

## Section 34 — Performance & Stability

| # | Scenario | Expected |
|---|----------|----------|
| 34.1 | 10+ players in the same zone moving simultaneously | No visible position desync |
| 34.2 | 10+ players chatting at once | Messages delivered in order, no crash |
| 34.3 | Server running for 2+ hours — check memory usage | No memory leak; stable |
| 34.4 | Rapidly enter/exit dungeon 10 times | No orphaned dungeon state; clean each time |
| 34.5 | Large inventory (200+ items) — open inventory panel | Panel loads without freeze |
| 34.6 | 63+ card templates in collection — open card panel | Panel renders within 1 second |
| 34.7 | Chunk generation at world edge (max coordinates) | Generates or returns empty; no crash |

---

## Section 35 — Known Limitations (Document, Don't File as Bugs)

These are confirmed incomplete features — note if they behave differently than listed:

| # | Limitation | Confirm Still Present |
|---|-----------|----------------------|
| 35.1 | Guild persistence: guilds lost on server restart | ☐ Confirmed |
| 35.2 | Auction house listings: lost on server restart | ☐ Confirmed |
| ~~35.3~~ | ~~Quest progress not tracked (overworld quests)~~ | **FIXED** — gather/craft/kill/skill_milestone/dungeon tracking is now wired. `quest_list`, `quest_accept`, `quest_turnin` all implemented in overworld.js. |
| 35.4 | PvP combat not implemented | ☐ Confirmed |
| 35.5 | Dungeon skills (dungeon_dwelling/delving) have no in-game effect | ☐ Confirmed |
| 35.6 | Evo-linked card affixes not checked during evolution/fusion | ☐ Confirmed |
| 35.7 | Ascension `rift_veteran` (start-floor skip) not implemented | ☐ Confirmed |
| 35.8 | Ascension `eternal_mark` cosmetic glow not rendered on client | ☐ Confirmed |
| 35.9 | Enemy patrol wandering (timer-based) not implemented | ☐ Confirmed |
| 35.10 | Client UI for auction house and NPC shops incomplete | ☐ Confirmed |

---

## Bug Report Template

When logging a bug, include:

```
Bug ID: [sequential number]
Section: [e.g., Section 7.4 Card Fusion]
Severity: Critical / High / Medium / Low
Repro steps:
  1. ...
  2. ...
  3. ...
Expected: ...
Actual: ...
Account/race used: ...
Server (KVM1 / KVM2 / local): ...
Screenshot / log snippet: [attach]
```

---

*End of MMOLite QA Checklist — V1.0005*
