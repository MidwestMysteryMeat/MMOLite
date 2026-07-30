# The Rift: Atmospheric & Immersive Feature Design
## MMOLite Dungeon System — Narrative Design Document

**Document Author:** Narrative Design
**Scope:** The Rift (infinite, daily-seeded) + Overworld Caves (finite, location-seeded)
**Tech Stack:** Node.js + Socket.IO (server), LOVE 2D / Lua (client, 2D colored rectangles/circles)
**Date:** February 2026

---

## Design Philosophy

Every feature in this document serves a dual mandate: it must make the dungeon *feel alive*, and it must make the player *want to go deeper*. The Rift is not a neutral game space — it is a wound in the world, a place where the boundary between what was and what is has grown thin. Atmosphere is not decoration. It is information. Every ambient event, every corpse, every whispered inscription tells the player something true about this place and costs them nothing but attention.

The constraint of 2D colored rectangles is an asset, not a limitation. Text and color carry enormous emotional weight. These features are designed to work *within* that constraint, treating the screen as a stage where tone is set by palette shifts, overlay text, and particle geometry rather than illustration.

---

## PRIORITY TIER 1: Maximum Impact, Minimum Effort
*These features run almost entirely on existing event infrastructure.*

---

### Feature 1: Atmosphere Events — The Floor Breathes

**Name:** Ambient Floor Events (AFEs)

**Description:**
Each floor, on a seeded timer, emits a broadcast event to all players on that zone. These are purely narrative — they produce a text message in a dedicated "atmosphere" color channel and optionally shift the screen tint briefly. No mechanical effect. No player action required. They establish that the dungeon is a living place with its own agenda.

**Themes it fits:**
All 31 themes, with theme-specific event pools. Samples below:

| Theme | Event Text |
|---|---|
| `stone_keep` | *Somewhere behind the walls, something drags itself across stone.* |
| `lava_rift` | *The floor shudders. A crack splits open three tiles east, glowing orange before sealing.* |
| `fungal_forest` | *The spores thicken. Your lungs ache with something sweet and wrong.* |
| `frozen_depths` | *A sound like a vast bell, felt more than heard. Then: silence.* |
| `shadow_realm` | *Your shadow moves a half-second behind you. Then catches up.* |
| `bone_yard` | *Teeth marks on the wall. Fresh ones.* |
| `astral_rift` | *Stars appear in the ceiling. Wrong stars. None of them are named.* |
| `coral_grotto` | *The water at the edge of the room ripples, though nothing touched it.* |
| `catacombs` | *A prayer, half-remembered. Someone carved it here while they still could.* |
| `vampire_castle` | *The candles dim simultaneously. When they brighten, there is one fewer shadow than before.* |
| `clockwork_maze` | *A gear turns. Then another. Then everything stops. Then it all starts again.* |
| `silent_floor` modifier | *[No event fires. The silence IS the event.]* |

**Server-side implementation:**
In `startFloorAI()` in `handlers/dungeon.js`, alongside the existing AI tick interval, add a secondary interval for AFE broadcasting. The AFE pool is selected from `dungeon-data.js` using the floor's `theme` property and a seeded RNG. Timer: every 45–90 seconds (randomized per floor using floor seed).

```javascript
// In startFloorAI(), after the existing setInterval:
var afePool = dungeonData.getAtmosphereEvents(floor.theme, floor.floorModifier);
var afeTimer = Math.floor(45000 + rng() * 45000); // 45-90s
var afeInterval = setInterval(function() {
  var players = getFloorPlayersArray(zoneId);
  if (players.length === 0) return;
  var evt = afePool[Math.floor(Math.random() * afePool.length)];
  _io.to('zone:' + zoneId).emit('dungeon_atmosphere', {
    text: evt.text,
    tint: evt.tint || null,     // { r, g, b, a } for brief screen tint
    duration: evt.duration || 4000,
  });
}, afeTimer);
```

**New data needed in `dungeon-data.js`:**
Add `ATMOSPHERE_EVENTS` object keyed by theme. Each entry: `{ text, tint: {r,g,b,a}, duration }`. Approximately 8–12 events per theme, seeded selection prevents repetition.

**Client-side (LOVE 2D):**
- Display event text in the chat/log area using a distinct muted amber/gray color (separate from player chat, system messages, and combat log).
- Optional: if `tint` is provided, briefly overlay the entire screen with a semi-transparent colored rectangle (alpha ~0.06, fade in over 1s, hold 2s, fade out over 1s). Lava themes pulse orange. Shadow realm pulses deep violet. Frozen depths flash pale blue.
- No sound assets required — the text IS the sound.

**Implementation complexity:** SMALL
New data array + one broadcast interval + one client emit handler. No mechanical state changes.

**Expansion hooks:**
- Floor modifier `silent_floor` suppresses all AFEs — already thematically appropriate.
- Future: certain AFEs could have a 5% chance to spawn a bonus enemy or secret room marker.

---

### Feature 2: Lore Objects — What the Dead Left Behind

**Name:** Discoverable Lore Objects (DLOs)

**Description:**
Procedurally placed interactable tiles on the floor grid — corpses, journals, inscriptions, scratched messages, and shattered relics. When a player walks adjacent and presses E (the existing interact key), they receive a lore text. Each object is a piece of environmental storytelling that makes the floor feel like somewhere that had a history before the players arrived.

The critical design constraint: **lore objects must feel found, not presented.** They appear as non-blocking floor tiles with a distinct accent-colored indicator. The player must choose to read them.

**Object types and visual representation:**
| Object | Tile Color | Indicator Shape |
|---|---|---|
| Corpse | Dark red-brown rectangle | Small pulsing red circle (2px) |
| Journal / Tome | Dark amber rectangle | Small glowing amber dot |
| Wall inscription | Same as wall color, lighter shade | No indicator — must be noticed |
| Broken gear/relic | Gray rectangle, theme accent dot | Faint theme-accent circle |
| Skeleton with item | Off-white circle | Small white dot |

**Themes and lore object types:**

`stone_keep` / `throne_dungeon` — **Fallen soldiers' journals, royal decrees scratched into walls by prisoners**
Sample: *"Day 14. The Iron Castellan sealed the lower gates himself. I heard him say 'let them keep the darkness company.' I am still here. The darkness has learned my name."*

`crystal_cavern` / `gnomish_workshop` — **Miner's logs, excavation notes, expedition manifests**
Sample: *"Vein depth: 340ft. Crystal resonance: 7.2. Do not strike the blue ones. I repeat, DO NOT STRIKE the blue ones. — Foreman Tikk (final entry)"*

`catacombs` / `sunken_cathedral` — **Prayers, burial rites, heresies scratched beneath official text**
Sample (official text visible): *"Here rests a servant of the Dominion, faithful unto death."*
Sample (scratched beneath): *"He was not faithful. He was afraid. We all were. — S."*

`lava_rift` / `infernal_pit` / `ashen_observatory` — **Scorched fragments, heat-warped notes**
Sample: *"The heat is structural. The Ashen ones did not discover fire. They discovered that fire was already here, waiting. This is its house. We are guests."*

`shadow_realm` / `void_debris` / `abyssal_dark` — **Messages written in wrong directions, ink that seems to move**
Sample: *"IF YOU ARE READING THIS YOU ARE ALREADY TOO DEEP. (The words are calm. The handwriting is not.)"*

`ancient_library` / `sand_tomb` / `elven_reliquary` — **Academic annotations, expedition reports**
Sample: *"The Reliquary predates the Second Compact by at least three centuries. The wards are not protective. I believe they are commemorative. Whatever they are mourning, it has not stopped."*

**Race-specific interactions:**
This is the feature that makes the game's 8-race system feel meaningful inside the dungeon.

| Race | Special interaction condition | Effect |
|---|---|---|
| Dwarf | `stone_keep`, `crystal_cavern`, `iron_forge` — dwarven runes on wall | Reveals additional lore text in Dwarvish + Common. "Your fingers recognize the mason's marks — this was cut by Ironhold craftsmen, three generations back." |
| Elf | Any magic-adjacent theme — `elven_reliquary`, `shadow_realm`, `astral_rift`, `celestial_spire` | "You sense the residue of old casting — whoever worked this room was fluent in the Third Form. They stopped mid-word." (+small XP bonus to Magic skill) |
| Gnome | `clockwork_maze`, `gnomish_workshop`, `cogwork_foundry` | "The mechanism is recognizable — a pre-Collapse Mechspire design, modified by someone who understood the intent but not the execution. There is a bypass." (Reveals nearby hidden shortcut tile) |
| Goblin | Any loot-adjacent object | "Your hands find the lining before your eyes do. (You retrieve a hidden coin pouch the corpse was sitting on.)" (+small gold bonus, hidden unless Goblin) |
| Lizard Folk | `coral_grotto`, `flooded_ruins`, `tidal_vault`, `sunken_depths` | "The markings are Draconic — old dialect, coastal variant. A water ritual ward, disrupted. You feel where it was anchored." (Reveals hidden chest tile if within 3 tiles) |
| Cat Folk | Any object | "Something feels wrong about this one. (You circle it twice before touching it.)" — 15% chance to detect if it's a mimic chest nearby |
| Orc | `orc_barrow`, `bone_yard`, `ruined_village` | "Your clan uses a similar burial marker. This one has been defaced — the name was removed deliberately. Dishonored." (Reveals enemy patrol pattern — shows enemy path on minimap) |
| Human | Any inscribed text | "You recognize the administrative notation — this was a Dominion outpost. The records stop abruptly." (No mechanical bonus, but unique lore text acknowledging Human political history) |

**Server-side implementation:**
Add `loreObjects` array to the floor object during `generateFloor()` in `dungeon-data.js`. Each object:
```javascript
{
  x: int, y: int,
  type: 'corpse' | 'journal' | 'inscription' | 'relic' | 'skeleton',
  themeId: string,          // which theme pool to pull from
  loreId: string,           // specific lore entry key
  raceBonus: string | null, // which race gets bonus interaction, or null
  interacted: false,
  hidden: false,            // wall inscriptions require adjacency, not sight
}
```

Add new socket event `dungeon_interact_lore` in `handlers/dungeon.js` (mirrors existing `dungeon_interact_npc` pattern exactly — proximity check, one-time interaction, emits result).

Add `LORE_OBJECTS` data structure in `dungeon-data.js`:
```javascript
var LORE_OBJECTS = {
  stone_keep: [
    { id: 'sk_journal_1', type: 'journal', text: '...', raceBonus: 'dwarf', raceBonusText: '...' },
    // ...
  ],
  // one pool per theme, 6-10 entries each, seeded selection per floor
};
```

**Client-side (LOVE 2D):**
- Lore objects render as a slightly lighter rectangle on the floor tile grid, with a 4px accent-colored circle (theme accent color) that pulses slowly (sine wave alpha 0.4–0.9, period ~2s).
- Wall inscriptions render as wall-colored but with a faint highlight edge — discoverable by proximity, not map scanning.
- On interaction: display lore text in a centered text box with a thin border in the theme's accent color. Text fades in line-by-line (60ms per line). Player presses E or space to dismiss.
- Race bonus text appears below the standard text in a different color (the player's race color from character creation).

**Implementation complexity:** MEDIUM
New data structure, one new socket event, client render pass for lore tiles, text display modal. Approximately 3-4 days of implementation work. The lore content itself (writing) is the majority of the effort.

**Cross-references:**
- Uses existing proximity check pattern from `dungeon_interact_npc`.
- Uses existing `TILE` system — lore objects sit ON walkable tiles, not as new tile types.
- Race data already available via `acc.race` in handler.

**Expansion hooks:**
- Lore objects can be tied to a "Lore Codex" collection system — players build a library of found texts that persist between delves.
- Chain lore: object A references "the mage in the eastern room" — object B is that mage's body. Finding both triggers a special combined entry.

---

## PRIORITY TIER 2: High Impact, Moderate Effort
*These features need new data structures and client rendering logic.*

---

### Feature 3: Pre-Boss Atmospheric Progression

**Name:** The Warning Signs

**Description:**
The three floors immediately preceding a boss floor (floors 7, 8, 9 before the floor-10 boss; floors 17, 18, 19 before floor-20; etc.) receive escalating atmospheric signals that something is coming. The boss floor itself has a distinct entrance sequence. This transforms what is currently a flat progression into a narrative arc: approach, dread, confrontation.

**Three-phase approach:**

**Phase 1 — Floor N-3 (e.g., floor 7):** Standard AFEs shift to a "disturbed" variant pool. Enemies appear more agitated (already in chase state more frequently). One guaranteed lore object references the boss entity by implication:
- `stone_keep` path: *"The Castellan's orders came down this morning. No one comes back up. We are to hold until... we are to hold."*
- `lava_rift` path: *"The Emberwarden woke. We heard it through three floors of rock. We are leaving."*
- `fungal_forest` path: *"The Bloom does not sleep. It does not eat. It only spreads. The next floor is already part of it."*

**Phase 2 — Floor N-2 (e.g., floor 8):** Enemy behavior changes. All enemies on this floor flee toward the walls when reduced to 30% HP — they are afraid of something below. AFE events become more frequent (every 30s instead of 60s). A dedicated zone-wide message fires 60 seconds after player entry:
*"The air pressure changes. Something massive exhaled below you."*

**Phase 3 — Floor N-1 (e.g., floor 9):** The floor's color palette is tinted (screen overlay at alpha 0.04) in the boss's signature color. Boss door tile is already present in the layout (this exists in `TILE.BOSS_DOOR`). Add: a ring of dead enemy corpses in the first room, pre-placed, not spawned from kills. A wounded NPC (guaranteed spawn) speaks only one line of dialogue with no reward:
*"Don't go through. I beg you. Don't go through."* — and then disappears (marked interacted immediately after).

**Boss Floor Entry Sequence:**
When a player steps onto `TILE.BOSS_DOOR`, before the boss fight begins, emit `dungeon_boss_intro` event to all zone players. Client displays a 3-second blackout with theme-colored text:

```
[BOSS FLOOR — Floor 10]

The Iron Castellan

"He sealed himself in three centuries ago.
 He hasn't slowed down."
```

Each boss has:
- A **title line** (the boss name)
- A **one-line epitaph** (flavor text only, 12-18 words)
- A **silence duration** (1-3 seconds of black screen before fight begins)

Boss epitaphs (samples):

| Boss | Epitaph |
|---|---|
| The Iron Castellan | *"He sealed himself in. He hasn't slowed down."* |
| The Prismatic Queen | *"Every gemstone in these caves was once part of something that breathed."* |
| The Emberwarden | *"It is not angry. It is hungry. The difference stopped mattering around the third century."* |
| The Frost Colossus | *"The cold came first. The Colossus formed around it, the way a pearl forms."* |
| The Hollow King | *"He forgot his name. He kept the crown."* |

**Post-boss narrative (boss death reward text):**
When `enemyDied` is true and `enemy.isBoss` is true in `dungeon_attack` handler, alongside the existing card pack award, emit a `dungeon_boss_death` event with a narrative payload:

```javascript
socket.emit('dungeon_boss_death', {
  bossName: enemy.name,
  deathText: getBossDeathText(enemy.id, floor.theme),
  cardPackAwarded: true,
  floorCleared: true,
});
```

Sample death texts:
- Iron Castellan: *"The armor falls. Inside, for just a moment before the rust takes everything, you see the face of a man who was very, very tired."*
- Prismatic Queen: *"The crystals shatter outward in a final bloom. In the silence that follows, the cave is just a cave again."*
- Emberwarden: *"The fire goes out. The floor is still warm. It will be warm for a long time."*

**Server-side implementation:**
- Add `isBossApproach` flag to floor generation: `floor.bossApproachPhase = (floorNum % 10 >= 7 && floorNum % 10 <= 9) ? (floorNum % 10 - 6) : 0`
- Add `BOSS_INTRO_DATA` object in `dungeon-data.js` keyed by boss enemy ID.
- Add `BOSS_DEATH_TEXT` object in `dungeon-data.js` keyed by boss enemy ID.
- Modify `dungeon_attack` handler: when boss dies, emit `dungeon_boss_death` with narrative payload.
- Add `dungeon_boss_intro` emit when player steps on `TILE.BOSS_DOOR`.

**Client-side (LOVE 2D):**
- Boss intro: full black screen overlay (alpha 1.0), fade in title text over 1s, hold 2s, fade out. Begin fight.
- Boss death text: centered text box with theme accent border, text fades in slowly. Player dismisses with any key.
- Pre-boss floor tint: semi-transparent rectangle over full viewport, alpha 0.04, boss's accent color.

**Implementation complexity:** MEDIUM
New data tables, modifications to existing boss death handling (which is already partially implemented — `cardPackAwarded` already exists), one new client-side sequence.

---

### Feature 4: Environmental Hazards — The Floor Fights Back

**Name:** Theme-Locked Environmental Hazards

**Description:**
Beyond traps (which already exist via `TILE.TRAP`), certain themes have environmental hazards that activate on a timer or on a trigger. These are not enemies. They are the dungeon asserting that it is not a safe space to stand still.

Unlike traps, hazards affect all players and are visible before they trigger. The tension comes from seeing them and deciding whether to move.

**Hazard designs by theme:**

**1. Lava Flow (`lava_rift`, `infernal_pit`, `dragons_den`)**
- Certain floor tiles are designated lava channels (pre-generated, not random).
- Every 20 seconds, a broadcast: *"The lava shifts."* Affected tiles glow bright orange.
- 3-second warning, then tiles deal damage (15 HP) to any player standing on them.
- Visual: tiles pulse from `floor_color` to `{r:255, g:100, b:20}` (theme accent) over the 3-second warning.
- Lizard Folk have thermal vision — they see the lava channel tiles highlighted at all times (sent as extra tile metadata on floor state).

**2. Cave-In (`crystal_cavern`, `iron_forge`, `troll_caves`, any MOUNTAIN biome cave)**
- A room is designated as "unstable" at floor gen time.
- On entry to that room by any player, a 10-second warning message fires: *"The ceiling groans. Small rocks fall."*
- After 10 seconds: 5–8 random floor tiles in the room become impassable for 30 seconds (rendered as dark gray blocking rectangles).
- Dwarf racial bonus: Tremor sense (already in their racial data) — receive the warning at 15 seconds instead of 10.
- No HP damage (keeps it accessible). Pure movement disruption.

**3. Flooding (`flooded_ruins`, `coral_grotto`, `tidal_vault`, `sunken_depths`)**
- Water rises over 60-second cycles. Three states: low, mid, high.
- Low (default): standard movement.
- Mid: movement speed penalty (-1 tile per move action), broadcast: *"The water rises. Your boots are soaked."*
- High: all floor tiles in the room deal 3 HP per 5 seconds of standing still. Broadcast: *"The water is at your chest. Something brushes your leg."*
- Lizard Folk are immune to flooding entirely. They receive a unique message: *"You let the water close over your head. You can breathe here. The others cannot."*
- The cycle resets every 180 seconds (3 minutes). High state lasts 30 seconds before draining.

**4. Psychic Static (`shadow_realm`, `void_debris`, `astral_rift`)**
- Every 45 seconds, a static burst fires: the player's screen fills with brief text noise for 1 second (a rapid sequence of single words displayed in random positions on screen: "WRONG" / "LOST" / "BELOW" / "FORGETTING" / scattered random). Not seizure-inducing — just unsettling text overlays at low alpha.
- During the burst, the minimap (if implemented) goes blank for 5 seconds.
- Elf racial bonus: "Millennial Memory" means Elves resist psychic effects — they receive only the minimap blackout, not the text noise. Their screen message: *"You feel the static break against your mind like water against stone."*

**5. Magical Surge (`elven_reliquary`, `celestial_spire`, `puzzle_labyrinth`)**
- Shrine tiles on this floor occasionally "misfire" — instead of granting a buff, they emit a random effect (could be a debuff: -5 DEF for 30s, or a positive: +10 HP regen).
- Broadcast when surge occurs: *"A ward activates without being touched. You feel it from across the room."*
- The shrine tile visually pulses aggressively (rapid color shift between theme accent and white) for 10 seconds before surging — players can see it coming.

**6. Fungal Spore Cloud (`fungal_forest`, `plague_warren`, `spider_hive`)**
- Certain floor tiles emit spore clouds on a timer (every 90 seconds).
- Affected tiles are shown as a pale green-tinted overlay circle (not a solid tile).
- Players standing in the cloud take 2 HP per 5 seconds and receive a "disoriented" status that causes their movement confirmations to occasionally be delayed by 0.2s server-side.
- Clearing the cloud: players can attack the source tile (a large fungal growth, rendered as a mid-sized dark green circle) to destroy it — one hit if you reach it.

**Server-side implementation:**
Add `environmentalHazards` array to floor object at generation time. Each hazard:
```javascript
{
  type: 'lava_flow' | 'cave_in' | 'flood' | 'psychic_static' | 'magical_surge' | 'spore_cloud',
  tiles: [{x, y}],     // affected tiles
  state: 'dormant',    // current state machine state
  nextTick: timestamp, // when next state change fires
  roomId: int,         // which BSP room this belongs to
}
```

Add hazard tick processing inside the existing `startFloorAI()` interval — hazards update on each AI tick (checking timestamps). Broadcast `dungeon_hazard_update` events to the zone.

Race-specific hazard immunity data: add `raceHazardImmunities` to the race definitions in `rpg-data.js`, or handle inline in the hazard resolution code using `acc.race`.

**Client-side (LOVE 2D):**
- Lava tiles: pulsing orange rectangle overlay on floor tile.
- Cave-in tiles (blocked): dark gray rectangle, slightly smaller than tile.
- Flood state: blue-tinted overlay on room rectangles, alpha increases with flood level (0.1 mid, 0.25 high).
- Psychic static: rapid text word-spawning at random screen positions, alpha 0.3–0.5, 1 second duration.
- Spore cloud: expanding pale-green circle overlay from source tile, radius 3 tiles.

**Implementation complexity:** MEDIUM-LARGE
Server hazard state machine is the main effort. Client overlay rendering adds complexity. Race immunity checks are straightforward given existing `acc.race` access.

---

### Feature 5: NPC Encounters — Humans in the Dark

**Name:** Expanded NPC Encounter System

**Description:**
The existing `DUNGEON_NPCS` array has 5 generic NPCs with functional but thin dialogue. This feature replaces the generic dialogue with deep, race-sensitive, theme-sensitive characters who reveal world lore through interaction rather than exposition dumps.

The design principle: **every NPC must have a reason to be in this specific dungeon.** A prisoner in the shadow realm is different from a prisoner in the clockwork maze. A merchant who wandered into lava caves is not the same person as a merchant who wandered into the catacombs.

**New NPC types and dialogue frameworks:**

**1. The Rival Delver (floor 5+)**
A player-class NPC from a different race who has made it deeper than you and is heading back up. They offer information about what lies below. Their race determines their personality and what information they carry.

Race dialogue variants (selecting by seeded RNG for this floor):
- *Dwarf Delver:* "Floor twelve's got a vein of starstone under the east corridor — I marked it with chalk. My knees gave out before I could get to it. It's yours if you can read Dwarvish marks." (Reveals a hidden resource node on floor 12 — sent as DLO marker.)
- *Elf Delver:* "Something old is awake on fifteen. Old like before-the-compact old. I didn't fight it. I walked backward very slowly. That's my advice." (Increases enemy detection radius on floor 15 by 1 — sent as floor metadata.)
- *Goblin Delver:* "I counted the guards. Fourteen in the next room. But three of them are bored, and bored guards face the wrong way." (Reveals enemy patrol positions for next floor — sends enemy initial positions as 'patrol_hint' metadata.)
- *Gnome Delver:* "The lock on the boss door is a Tinker Mark VII. I could open it in four minutes if my hands weren't — well. There's a bypass panel behind the shrine. Look for the blue gear." (Reveals hidden shortcut on boss floor.)
- *Orc Delver:* "The pack on nine learned my smell. I had to break through a wall." (No mechanical bonus. Just a moment of characterization. The wall it broke through is in the floor data — a broken-wall tile added to floor 9.)
- *Human Delver:* "I'm documenting this for the Delvers' Guild archive. Which means you're going to die down there and I'm going to write about it. No offense." (Can sell you a "floor map" — reveals fog of war for one room on next floor, costs 30 coins.)
- *Cat Folk Delver:* "I don't know what's down there. I turned back because it felt wrong. Trust the feeling." (Grants Cat Folk race bonus to all players on floor until they descend — +15% general luck for loot rolls.)
- *Lizard Folk Delver:* "The water on eleven has changed. Something upstream." (Grants flood state warning 30 seconds earlier for all players on floor 11.)

**2. The Cartographer's Ghost (any floor, 6% chance)**
Not a living NPC. A translucent figure (rendered as white circle at alpha 0.4, slowly drifting) who was the first person to map this particular floor, centuries ago. They cannot communicate normally but will, if interacted with, mark one room on the floor with a "ghost marker" — something worth finding. They offer no dialogue. They point.

Visual: white circle, 0.4 alpha, moves along a pre-set path (2-tile drift, returns). On interaction: they face the player, hold still for 2 seconds, then move in the direction of the marked room. The room they mark always contains: an unopened chest, a lore object, or a shortcut tile.

This NPC requires no dialogue writing. The interaction IS the lore.

**3. The Trapped Merchant (sanctuary floor modifier only, plus ~3% other floors)**
Already exists as `lost_merchant` but currently has no actual trade inventory. Expand: the merchant's stock is seeded to the dungeon theme. Prices are 20% above NPC shop prices (they're desperate but not foolish).

Theme-specific stock (3-5 items per theme):
- `lava_rift`: Heat Salve (reduces lava/fire damage by 50% for 2 floors), Ashen Rope (climbing tool, flavor only), Fireproof Wrap (armor item placeholder).
- `frozen_depths`: Warming Oil (+10 HP on consumption), Fur-Lined Grip (melee damage in cold themes +5%), Ice Pick (Dwarf bonus: reveals hidden wall passages in ice themes).
- `catacombs`/`bone_yard`: Holy Water (bonus damage to undead this floor, 2 uses), Burial Wax (seal a chest — another player cannot open it — dungeon co-op tool), Censer of Calm (removes disoriented status).
- `shadow_realm`: Light Crystal (eliminates psychic static for this floor), Mirror Shard (reveals one enemy's true position when it's in stealth), Memory Herb (restores minimap after blackout instantly).

This connects to the existing `sanctuary` floor modifier which already has `guaranteedMerchant: true`.

**4. The Echo (deep floors 20+, boss-approach floors)**
A figure that looks exactly like one of the players currently on the floor, but wrong. It moves erratically. It does not attack. When interacted with, it shows the player their own death — a brief text sequence describing how they *would* die if they face the boss unprepared.

The Echo's warning is mechanically accurate: it describes the boss's strongest ability based on the boss enemy template data. This is the one NPC that turns flavor into genuine tactical information.

Sample Echo dialogue (for player approaching Iron Castellan floor):
*"You approach it wrong. You attack first. It catches your wrist. It squeezes. You hear your own bones before you feel them. —Don't attack first."*
This tells the player: the Iron Castellan has a counter-strike ability (heavy strike on player's first attack). The Echo is flavor text that is also a strategy guide.

**5. Race-Specific Dungeon NPCs:**
Certain themes now spawn an NPC that only a specific race can fully interact with:

| NPC | Theme | Race Required | What they offer |
|---|---|---|---|
| Ironhold Survivor | `iron_forge`, `stone_keep`, `crystal_cavern` | Dwarf | Reveals entire floor map (dwarven cartography, full room layout). Non-Dwarves get: "She speaks too fast in a dialect you can't follow, but she seems to be warning you about something east of here." (Highlights eastern half of floor.) |
| Elven Shade | `elven_reliquary`, `shadow_realm`, `celestial_spire` | Elf | Teaches a one-floor magic buff (+3 acumen effect for this floor). Non-Elves get: "The figure speaks in Old Elvish. The words feel important. You catch one: 'careful.'" (Reveals trap locations for this floor.) |
| Khanate Scout | `orc_barrow`, `bone_yard`, `ruined_village` | Orc | Tells exact number and type of enemies remaining on this floor. Non-Orcs get: "He counts something on his fingers, holds up a number. You take it as the enemy count." (Shows total enemy count, no detail.) |
| Tinker Apprentice | `gnomish_workshop`, `clockwork_maze`, `cogwork_foundry` | Gnome | Can disable all traps on this floor remotely (Cogworking skill check). Non-Gnomes get: "She fiddles with something. Half the pressure plates click harmlessly. Not all of them." (Disables 50% of traps randomly.) |

**Server-side implementation:**
Extend `DUNGEON_NPCS` array with new NPC templates. Add `raceRequired` field, `themeRequired` field, `dialogueByRace` object. In `dungeon_interact_npc` handler, check `acc.race` against `npc.raceRequired` and select the appropriate dialogue branch.

Add NPC stock to merchant NPCs: `npc.stock = []` array with item objects. New socket event `dungeon_merchant_buy` with proximity check.

**Client-side (LOVE 2D):**
- Standard NPC: medium-sized circle in NPC-designated color (light blue) with name label.
- Ghost/Echo: white/near-white circle at alpha 0.4, slightly larger, slow drift animation (lerp position ±2 tiles, 4s period).
- Race-specific NPC: same circle but with a ring in the player's race color if the player's race matches.
- Merchant: circle with a coin-colored (amber) inner dot.

**Implementation complexity:** MEDIUM
Extends existing NPC infrastructure. Race check is trivial (one comparison). The bulk of the work is writing the dialogue variants — mechanically it's one new field check per NPC interaction.

---

## PRIORITY TIER 3: Deep Atmosphere, Larger Lift
*These features require more significant new systems but create the most memorable moments.*

---

### Feature 6: Camp Storytelling — What Soldiers Say Around Fires

**Name:** Campfire Narrative Events

**Description:**
When players place a camp (Rift only, existing `dungeon_camp_place` event), and multiple players are within camp radius, a campfire storytelling system activates. This is the one feature designed explicitly for the co-op experience (up to 4 players). After a cooldown period at camp, the server fires a "campfire story" — a short narrative fragment delivered as if one of the fictional travelers is speaking. In solo play, the player's own character reflects. In group play, the narrative acknowledges the group.

**Campfire story triggers:**
- 30 seconds after camp is placed.
- Again every 90 seconds while players remain in camp radius.
- One "dream vision" event if a player rests for 60+ consecutive seconds (simulated by a check against their last movement timestamp).

**Campfire story pools (by floor theme):**

`stone_keep` / `throne_dungeon`:
- *"My father told me the Iron Castellan was a man once. Served four kings. Watched three of them make promises they kept and one of them make a promise he didn't. The dungeon sealed itself the night of the fourth king's funeral. No one can explain what the connection is. My father thought the castle was grieving."*
- *"I've been in fourteen dungeons. This one's the only one that feels like it remembers when people lived here."*

`lava_rift` / `infernal_pit`:
- *"The fire breathers — the ones that come from further south, near the scorched lands — they say the Emberwarden is not a creature. They say it's a concentration of heat so old it developed opinions. I used to think that was superstition."*
- *"The first Rift delvers didn't make maps. They made obituaries. One for each floor, written in advance. You filled in the details later, if you came back."*

`fungal_forest` / `plague_warren`:
- *"I know someone who ate a spore-cap down here on a dare. Just one. She said she could hear the fungus thinking for three days after. She laughed when she told the story. But she never went back underground."*

`shadow_realm` / `void_debris`:
- *"The theory is that the shadow realm isn't a place. It's a memory the Rift has — something that happened here, replaying over and over. If that's true, we're not exploring it. We're inside it."*

`catacombs` / `sunken_cathedral`:
- *"When the cathedral sank — no one knows why it sank — the congregation was still inside. They kept holding services. The records go for six months. Then they stop. The services don't."*

**Dream vision events (solo rest):**
If one player is stationary for 60 seconds at camp, emit `dungeon_dream` event. Dreams are theme-specific and give fractured hints about the floor — not tactical information, but emotional resonance:

`stone_keep` dream: *"You dream of a door. Behind it, someone is counting — methodically, patiently, without stopping. You don't know what they're counting. You wake up hoping it isn't you."*

`crystal_cavern` dream: *"Every crystal in the cave is a preserved moment. You dream of standing in one. You can see out. You can see someone outside, looking in. You try to wave. Your arm won't move. It was already this way when you got here."*

`lava_rift` dream: *"You dream of the heat before fire. The state between cold and burning. You understand, in the dream, that this is where the Emberwarden lives. Not in the lava. In the moment before it."*

**Server-side implementation:**
Add `campfireStoryTick` to camp state in `dungeon_camp_action` handler. When camp is placed:
```javascript
floor.activeCamp = {
  x, y, radius: CAMP_CONFIG.campRadius,
  playersPresent: [],
  lastStoryAt: Date.now(),
  storyInterval: 90000,
};
```
Add a campfire story check inside the existing ambush flush timer loop (already fires every 5 seconds). When `Date.now() - lastStoryAt >= storyInterval`, select a story from theme pool, broadcast `dungeon_campfire_story` to zone.

Add `CAMPFIRE_STORIES` and `DREAM_VISIONS` data structures to `dungeon-data.js`, keyed by theme. 6-8 stories per theme, 3-5 dreams per theme.

**Client-side (LOVE 2D):**
- Campfire story: text appears in the chat/atmosphere log in a warm amber color (distinct from AFEs which are gray/muted). Prefixed with a small flame indicator: `[~]` or similar ASCII.
- Dream vision: full-screen dim (alpha 0.7 black overlay), text center-screen in white, italic if font supports it, held until player presses any key.
- If multiple players are present: the story text is attributed to "your companion" or "the silence" depending on player count.

**Implementation complexity:** SMALL-MEDIUM
Story pool data + one new emit inside existing camp infrastructure. The dream vision overlay is the only new client code of any complexity.

---

### Feature 7: Fog of War Narrative Events — What Hides in the Unseen

**Name:** Darkness Speaks

**Description:**
When the existing fog of war system obscures a tile, that tile is hidden. This feature adds events that fire *from* the fog — sounds, text, and brief visual flickers that come from areas the player hasn't yet explored. The dungeon stops being a space to clear and becomes a space to approach cautiously.

**Fog events (text-based, fire on entering a new fog-adjacent tile):**

General (any theme, 25% chance on fog adjacency):
- *"Something breathes in the dark ahead."*
- *"A light, just for a moment. Then it's gone."*

Theme-specific (fire when player is within 3 tiles of an unvisited room):

`stone_keep`: *"Armor clanking. Rhythmic. Patrol."*
`lava_rift`: *"The heat triples in that direction."*
`shadow_realm`: *"Something in the dark just turned toward you."*
`fungal_forest`: *"The spores are thicker ahead. Something large is disturbing them."*
`frozen_depths`: *"A crack. Ice. Something moving beneath it."*
`coral_grotto`: *"The water ahead is dark. Darker than it should be."*
`catacombs`: *"Praying. Someone is praying, just ahead."*
`clockwork_maze`: *"The gears stop. They're listening."*

**Darkvision racial interaction:**
Dwarves, Goblins, and Cat Folk have darkvision (per the racial data in `client/scenes/race_select.lua` and `client/lib/lighting.lua`). For these races, the fog-event radius expands by 1 tile — they hear/sense from slightly further. The fog event text changes slightly for darkvision races:

Standard: *"Something breathes in the dark ahead."*
Darkvision: *"You see, barely, the outline of something large. It doesn't see you. Yet."*

This makes darkvision feel mechanically AND narratively meaningful.

**Visual component:**
When a fog event fires, the fog-covered tiles in the indicated direction briefly pulse with the theme's accent color at very low alpha (0.1) for 1 second. This is the visual representation of the "sound" without requiring audio assets.

**Server-side implementation:**
Add fog event check to `dungeon_move` handler. On each player movement, calculate adjacency to unvisited rooms (track `floor.visitedRooms` per socket). When a new room is adjacent (within 3 tiles), run RNG check, select themed event text, emit `dungeon_fog_event` to that specific socket (not broadcast — personal to the approaching player).

```javascript
// In dungeon_move handler:
var adjacentUnvisited = checkFogAdjacency(floor, tileX, tileY, info.visitedRooms);
if (adjacentUnvisited && Math.random() < 0.25) {
  var fogEvt = selectFogEvent(floor.theme, acc.race);
  socket.emit('dungeon_fog_event', {
    text: fogEvt.text,
    direction: adjacentUnvisited.direction, // 'north'/'south'/'east'/'west'
    accentColor: themeColors.accent,
  });
}
```

**Client-side (LOVE 2D):**
- Text in atmosphere log, directional indicator appended: *"Something breathes in the dark to the north."*
- Fog tiles in indicated direction pulse briefly with accent color.
- Darkvision players: text is slightly different (stored in event payload as `darkvisionText` field alongside base `text`).

**Implementation complexity:** MEDIUM
Requires room-visit tracking per player (small state object), fog adjacency check (geometric, straightforward), two new data tables, one new emit per move (rate-limited by the existing move rate limit).

---

### Feature 8: Blood Trails and Evidence of Passage

**Name:** The Floor Has Memory

**Description:**
On floors where other players (from the same daily seed, not necessarily current session) have died recently, certain pre-placed environmental markers appear. Since player death sends them back to town (already implemented), the floor can "remember" that death with a visual trace.

This is also the mechanism for the existing `blood_moon` floor modifier to feel physically present rather than just a stat change.

**Two systems within this feature:**

**8A: Death Markers (Rift-specific, global state)**
When any player dies on a Rift floor, add a `deathMarker` to that floor's server-side state:
```javascript
floor.deathMarkers.push({
  x: deathX, y: deathY,
  playerRace: acc.race,
  floorNum: info.floorNum,
  message: generateDeathMessage(acc.race, enemy.name, floor.theme),
  timestamp: Date.now(),
});
```
Death markers persist for the day (same seed duration). When the next player enters that floor, the death marker appears as a dark red tile marker. On interaction (press E), it shows:

*"Here, [Race], fell to [Enemy Name]. [Theme-specific final words]."*

Race-specific final words:
- Dwarf: *"The stone remembers."*
- Elf: *"The last thing they saw: [enemy name]."*
- Orc: *"They died standing."*
- Goblin: *"They were not where they said they would be."*
- Gnome: *"Their last calculation was wrong by one."*
- Lizard Folk: *"They did not swim away in time."*
- Cat Folk: *"They had nine. This was the ninth."*
- Human: *"Documented for the Guild record."*

In solo play, these markers are the closest the dungeon gets to multiplayer presence — evidence that others tried, and failed.

**8B: Blood Moon modifier visual (existing modifier, new narrative)**
The `blood_moon` floor modifier already exists with `enemyRegenPerTick`. Add: at floor entry, the initial floor state broadcast includes `bloodMoonActive: true`. Client renders a permanent low-alpha red vignette (corners of screen, alpha 0.08). Atmospheric events during blood moon are exclusively from a "blood_moon" event pool:
- *"The walls weep. You choose not to examine what color."*
- *"An enemy regenerates a wound you watched open. It does not seem surprised."*
- *"The crimson is everywhere. It has been everywhere for a long time."*

**Server-side implementation:**
- Add `deathMarkers` array to rift floor state (initialized empty, persists per session).
- In `handlePlayerDeath` function in handler, push death marker with position, race, enemy name.
- Add `death_marker` to lore object interaction path (same handler as DLOs, Feature 2).
- Add `DEATH_MESSAGES` object keyed by race to `dungeon-data.js`.
- `blood_moon` modifications: extend existing modifier processing in `startFloorAI()`.

**Client-side (LOVE 2D):**
- Death markers: small dark red rectangle on floor tile, 0.6 alpha.
- Blood moon vignette: four semi-transparent red rectangles at screen corners, alpha 0.08.

**Implementation complexity:** SMALL-MEDIUM for 8A (death marker placement is simple, interaction reuses DLO handler). SMALL for 8B (one new client-side render element).

---

### Feature 9: Boss Encounter Enhancements — Enemy Panic

**Name:** The Panic Signal

**Description:**
In the existing AI system, enemies have states: patrol, chase, search, return. This feature adds a temporary new behavioral signal: **fleeing panic**, triggered when the boss is engaged. When a player steps onto the boss floor and combat begins, ALL non-boss enemies remaining on the boss floor enter a flee state, moving to the outer walls and ceasing attacks for 60 seconds. This is purely narrative — the smaller creatures know what the boss is, and they want to be very far from it.

Visually: enemies that were chasing the player suddenly stop, turn, and press against the nearest wall. They remain alive and on the floor but stop attacking. After 60 seconds they resume normal AI.

**Additional boss approach signal — the Stampede:**
On floor N-1 (pre-boss floor), a special "enemy migration" event fires 30 seconds after player entry. A wave of 3-5 weak enemies enters from the BOSS_DOOR tile (below), moving quickly toward the exit stairs. These enemies do not attack unless attacked. They are running AWAY from the boss floor. They use the weakest enemy from the current theme's enemy pool.

Broadcast to zone: *"Something small and fast is moving up the stairs. Several somethings. They don't stop to look at you."*

If attacked, they die immediately (1 HP, no loot, 0 XP — they're not worth killing). If left alone, they reach the stairs and despawn. They serve no mechanical purpose. Their purpose is to make the player think: what did they see down there that scared them this badly?

**Server-side implementation:**
- Boss engagement check: when `dungeon_attack` targets `enemy.isBoss`, broadcast `dungeon_boss_engaged` to zone. In AI tick handler, add boss-engaged flag check — enemies in flee state move toward nearest wall (move AI: find walkable tile adjacent to wall, set as target, stop attacking).
- Stampede: add `stampede` event type to floor events. Fire from `startFloorAI` on boss-approach floors, 30-second delay after first player entry.
- `dungeon_enemy_flee` event: client receives enemy flee updates, renders enemies moving to walls.

**Client-side (LOVE 2D):**
- Enemies in flee state: their colored circle gains a small white outline (panicked visual).
- Stampede enemies: rendered as very small circles (8px instead of 16px), moving fast (2 tiles per second toward exit).

**Implementation complexity:** MEDIUM
AI state modification for flee behavior + one new broadcast event. The stampede is essentially a pre-scripted enemy spawn with fixed behavior.

---

### Feature 10: The Shortcut System — Wayfinder's Reward

**Name:** Hidden Shortcuts and Wayfinder Lore

**Description:**
`TILE.SHORTCUT` already exists in the tile system but is not yet narratively framed. This feature gives shortcuts both a lore identity and a discovery mechanism that makes finding them feel like genuine exploration rather than map scanning.

**Two shortcut types:**

**10A: Structural Shortcuts**
Pre-generated alternate passages between rooms that are hidden behind wall tiles. To find them, a player must:
- Have a Gnome's racial ability (Tinker Savant — they can feel drafts through walls, bonus shortcut detection radius 3 tiles).
- OR interact with an "Escaped Prisoner" NPC (already in `DUNGEON_NPCS` with `questHook: 'shortcut_reveal'`).
- OR stand adjacent to the shortcut tile for 5+ seconds (slow discovery — anyone can find them if they're patient enough to hug walls).

Discovery reveals the tile as a walkable passage tile. It stays revealed for all players on that zone (shared discovery).

Shortcut lore text on first discovery (race-specific):
- Gnome: *"There. The air pressure is different — someone carved this in a hurry, didn't square the edges. Quick work. Smart work."*
- Other races: *"A gap in the wall. Someone put it here deliberately. Someone who knew this place, and wanted a way out."*

**10B: Warden Shortcuts**
On certain floors, a long-dead floor warden (past Guild member, Stone rank, centuries ago) has left a chalk map fragment on the wall showing a route the current players haven't discovered yet. Finding it (lore object interaction) marks the shortcut tile on the client-side minimap.

Warden journal fragment (always accompanies the map):
*"Floor [N]. Added rear passage per Guild protocol — accessible from northeast corner. Widened for armored parties. Note: do not use during water events. — Warden Grell, Bronze Rank, Year 847."*

This makes the Guild's history feel real. The Guild is not just a progress gate — it was populated by real people who left evidence of their work.

**Server-side implementation:**
Minimal — shortcut tile already exists. Add `shortcut.hidden = true` flag to generated shortcut tiles. Reveal logic: `shortcut.hidden = false` on discovery condition. Broadcast `dungeon_tile_revealed` with tile position when discovered.

**Client-side (LOVE 2D):**
- Hidden shortcut: rendered as wall tile (players cannot see it).
- Revealed shortcut: rendered as a distinct tile — lighter shade of wall color, with a small accent-colored arrow indicator pointing through it.
- Minimap (if implemented): shortcut shown as dotted line between rooms.

**Implementation complexity:** SMALL
Mostly leveraging existing `TILE.SHORTCUT` infrastructure. Discovery mechanic is a simple flag flip.

---

### Feature 11: The Guild Archive — Leaderboard with Humanity

**Name:** Delvers' Memorial and Record Wall

**Description:**
The leaderboard already exists (`dungeon_leaderboard` event, `leaderboard` object with `deepestFloor`, `mostKills`, `fastestBoss`). This feature adds narrative weight to the leaderboard by making it a physical object in the dungeon world: **the Record Wall** inside the Adventure Guild entrance, and a corresponding **Memorial Board** for players who died on record-setting attempts.

**The Record Wall (in-dungeon, Rift antechamber):**
When a player enters the Rift antechamber (`rift_antechamber` zone), they can interact with the Record Wall (a designated tile). It displays:

```
THE ADVENTURE GUILD — DAILY RECORD WALL
Seed: [date]

DEEPEST DESCENT:  [PlayerName] ([Race]) — Floor [N]
GREATEST SLAUGHTER: [PlayerName] ([Race]) — [N] kills
FASTEST CONQUEST: [PlayerName] ([Race]) — [Boss] in [time]s

"These names stand today. Tomorrow, the Rift resets,
 and tomorrow's names are yet unknown."
```

**The Memorial Board (persistent, day-over-day):**
Separately, a `Memorial Board` tile tracks players who held a record at time of death on that floor. Data persists across the daily reset (stored in account metadata `dungeon.memorialRecord`). A player whose name appears on the Memorial Board receives a permanent bronze star next to their name in all game UI — a tiny thing, but meaningful.

Memorial board entry format:
*"[PlayerName] ([Race]) — Reached floor [N] on [date]. Fell to [enemy]. Record stood for [H hours M minutes]."*

**Expansion hook:** Legendary rank Guild members (future content) can commission a permanent stone plaque for their best run, visible to all future delvers entering the Rift.

**Server-side implementation:**
Extend existing `leaderboard` object with `daily_memorials` array. Populate in `handlePlayerDeath`. Add `dungeon_leaderboard` emit to include memorial data. Add `record_wall` interactable object to `rift_antechamber` zone (or handle as a special NPC in dungeon entry area).

**Client-side (LOVE 2D):**
The leaderboard panel already exists (referenced in game.lua dungeon rendering). Add memorial sub-panel, rendered in faded amber text below the records.

**Implementation complexity:** SMALL
Extends existing leaderboard data. One new data field (`daily_memorials`), one new tile in the antechamber zone, existing UI panel extended.

---

## PRIORITY TIER 4: Ambitious, Reserve for Later
*High impact, high effort. Design now, implement when core systems are stable.*

---

### Feature 12: The Rift's Voice — Floor-Wide Narrative Escalation

**Name:** Rift Escalation Arc

**Description:**
The Rift is daily-seeded, but it has no narrative shape — floor 50 feels mechanically the same as floor 5, only harder. This feature adds a **narrative escalation arc** that gives the daily Rift a story, even though the floor layout changes daily.

**Six narrative tiers, based on floor depth:**

| Floors | Tier Name | Narrative State |
|---|---|---|
| 1-5 | Threshold | The Rift is new. It is curious about you. |
| 6-15 | Recognition | The Rift has seen adventurers before. It knows how this goes. |
| 16-30 | The Change | Something in the Rift responds differently to players who reach this depth. |
| 31-50 | The Knowing | The Rift is no longer neutral. It is watching you specifically. |
| 51-80 | The Deep Accord | At this depth, the distinction between adventurer and Rift begins to blur. |
| 81+ | The Unspeakable | Records exist of adventurers reaching this depth. The records stop there. |

Each tier has a distinct set of atmospheric events, NPC interactions, and floor modifier weights. Tier 3+ unlocks new `DUNGEON_NPCS` types (e.g., "Echo of a Previous You" — a ghost that carries memories of YOUR character's previous deep delves, if any exist in account data).

**Server-side implementation:**
Add `getRiftTier(floorNum)` function to `dungeon-data.js`. Pass tier to AFE selection, NPC pool selection, and floor modifier weight adjustment. Tier data: `RIFT_TIERS` object with per-tier pools.

**Implementation complexity:** LARGE
Requires distinct content pools per tier (6+ separate pools for atmosphere events, NPCs, etc.) and tier-aware modifications to every content system above.

---

### Feature 13: Persistent Floor Scars — The Rift Remembers

**Name:** Cross-Session Floor Memory

**Description:**
Certain events that players trigger leave permanent marks on the Rift's seed data for the day. Not on the floor layout (which is deterministic), but on an overlay of "player-caused events" stored server-side.

- A boss killed by a party: the boss floor has a "defeated" aura for the rest of the day — different ambient colors, different NPCs (survivors celebrating/mourning), different loot (post-battle salvage).
- A specific lore object that multiple players have read: the next NPC encounter on that floor references it. ("I found the warden's journal too. We didn't read the part about the water event closely enough.")
- A shortcut discovered by one player: it remains revealed for all players for the day. The discoverer's name is on a chalk mark beside it.

**Server-side implementation:**
Add `riftDayMemory` object to server state (not persisted to disk, lasts the session/day):
```javascript
var riftDayMemory = {
  defeatedBosses: new Set(), // floor numbers where boss was killed today
  readLoreObjects: {},       // loreId -> [playerNames who read it]
  discoveredShortcuts: {},   // floorNum -> [shortcutPositions]
  deathMarkers: {},          // floorNum -> [{ x, y, race, enemyName }]
};
```
This already partially overlaps with Feature 8 (death markers). The cross-session memory is the unifying architecture for all persistent-within-day data.

**Implementation complexity:** LARGE
The data structure is simple, but ensuring all content systems read from it consistently requires threading it through every floor event. Architectural commitment before later features build on it.

---

## Implementation Roadmap

Listed by priority order (highest atmosphere-to-effort ratio first):

| Priority | Feature | Complexity | Estimated Dev Time | Atmosphere Impact |
|---|---|---|---|---|
| 1 | Atmosphere Events (AFEs) | Small | 1-2 days | Very High |
| 2 | Lore Objects (DLOs) | Medium | 3-5 days | Very High |
| 3 | Campfire Storytelling | Small-Medium | 2-3 days | High (co-op) |
| 4 | Pre-Boss Progression | Medium | 2-3 days | Very High |
| 5 | Fog of War Events | Medium | 2-3 days | High |
| 6 | NPC Expansion | Medium | 3-4 days | High |
| 7 | Blood Trails / Death Markers | Small-Medium | 1-2 days | Medium-High |
| 8 | Environmental Hazards | Medium-Large | 4-7 days | High |
| 9 | Boss Panic / Stampede | Medium | 2-3 days | High |
| 10 | Shortcut Discovery | Small | 1 day | Medium |
| 11 | Guild Memorial / Record Wall | Small | 1 day | Medium |
| 12 | Rift Escalation Arc | Large | 8-12 days | Very High |
| 13 | Persistent Floor Scars | Large | 5-8 days | High (long-term) |

**Recommended sprint order:**
1. Features 1 + 7 (both small, immediately transform tone with minimal code)
2. Feature 2 (lore objects — anchor for all other storytelling)
3. Features 3 + 4 (campfire + pre-boss — reward deep delvers)
4. Feature 6 (NPC expansion — makes world feel populated)
5. Feature 5 (fog events — deepens exploration)
6. Feature 8 (hazards — adds moment-to-moment tension)
7. Features 9 + 10 + 11 (polish and system completion)
8. Features 12 + 13 (long-term, after content foundation exists)

---

## New Socket Events Required

| Event Name | Direction | Purpose |
|---|---|---|
| `dungeon_atmosphere` | server → client | Floor ambient event text + optional tint |
| `dungeon_interact_lore` | client → server | Player interacts with a lore object |
| `dungeon_lore_result` | server → client | Returns lore text, race bonus if applicable |
| `dungeon_boss_intro` | server → client | Boss entrance sequence |
| `dungeon_boss_death` | server → client | Boss death narrative text |
| `dungeon_hazard_update` | server → client | Environmental hazard state change |
| `dungeon_fog_event` | server → client | Fog-of-war narrative event (personal) |
| `dungeon_campfire_story` | server → client | Campfire narrative broadcast |
| `dungeon_dream` | server → client | Solo rest dream vision |
| `dungeon_fog_event` | server → client | Fog-adjacent room event (personal) |
| `dungeon_tile_revealed` | server → client | Shortcut/hidden tile discovered |
| `dungeon_boss_engaged` | server → client | Boss combat started, enemy flee signal |
| `dungeon_stampede` | server → client | Pre-boss enemy stampede event |
| `dungeon_merchant_buy` | client → server | Buy from trapped merchant |

---

## New Data Structures Required in `dungeon-data.js`

```javascript
// Feature 1
var ATMOSPHERE_EVENTS = { [themeId]: [{ text, tint, duration }] };

// Feature 2
var LORE_OBJECTS = { [themeId]: [{ id, type, text, raceBonus, raceBonusText }] };
var RACE_LORE_INTERACTIONS = { [raceId]: { themes: [], bonusText, bonusEffect } };

// Feature 3 (boss)
var BOSS_INTRO_DATA = { [bossId]: { title, epitaph, silenceDuration } };
var BOSS_DEATH_TEXT = { [bossId]: { text } };

// Feature 4 (hazards)
var THEME_HAZARDS = { [themeId]: [{ type, weight, config }] };

// Feature 5 (NPCs)
// Extend DUNGEON_NPCS entries with: raceRequired, themeRequired, dialogueByRace, stock

// Feature 6 (campfire)
var CAMPFIRE_STORIES = { [themeId]: [{ text, soloText, groupText }] };
var DREAM_VISIONS = { [themeId]: [{ text }] };

// Feature 7 (fog)
var FOG_EVENTS = { [themeId]: [{ text, darkvisionText }] };

// Feature 8 (death)
var DEATH_MESSAGES = { [raceId]: { finalWords } };

// Feature 12 (rift tiers)
var RIFT_TIERS = [{ minFloor, maxFloor, name, afePool, npcPool, modifierWeights }];
```

---

## Lore Canon Notes

The following world-building facts are established by these features and must be maintained consistently:

1. **The Rift is not neutral.** It responds to depth. It has been there long enough to have preferences.
2. **The Adventure Guild is old.** Warden Grell (Year 847) pre-dates the current players by centuries. Other named wardens should follow this convention.
3. **The Iron Castellan was human once.** He sealed himself in. This should be the working model for all humanoid bosses — they were people. What happened to them is the dungeon's true story.
4. **Racial dungeon interactions must feel earned, not cosmetic.** Dwarves read dwarven ruins because this is a world where Ironhold actually built things underground. Lizard Folk are immune to flooding because their aquatic heritage is genuine, not a game stat.
5. **The daily seed means yesterday's records matter.** The Guild tracks this. The Memorial Board is the game's acknowledgment that player loss is real and worth commemorating.
6. **Lore objects should never be written in the voice of the game — always in the voice of the person who left them.** The reader of a dead soldier's journal is not reading documentation. They are reading a person.

---

*End of Document*
