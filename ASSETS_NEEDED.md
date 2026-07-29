# ASSETS_NEEDED — asset replacement manifest

Art and audio were purchased packs licensed to the project owner only, so they
are **stripped from this repo** (see `client/assets/ASSETS_PLACEHOLDER.md` and
`tools/asset-pipeline/ASSETS_PLACEHOLDER.md`). This manifest lists every asset
path the code references, what belongs there, and what happens on a fresh
clone when the file is missing.

**A fresh clone boots and plays without any of these files.** Every load site
on the live boot path is guarded (`love.filesystem.getInfo` checks and/or
`pcall`): missing images fall back to colored-rectangle / primitive rendering,
missing audio is silence. The only unguarded loaders live in two dormant
libraries — see [Unguarded load sites](#unguarded-load-sites).

Dimensions/formats below were measured from the owner's untracked local copies
(~22,000 media files on the dev machine; counts noted per group are what the
shipped game uses, not hard minimums).

Legend: **Optional** = game degrades gracefully without it. No asset in this
repo is **Required** for boot; "Required*" marks files needed for a feature to
be visible/audible at all.

---

## 1. Item & UI icons — `client/assets/icons/`

Loader: `client/lib/assets.lua` (lazy LRU cache; `getInfo` + `pcall`,
case-insensitive index built at `assets.init()` — an empty/missing directory
indexes to nothing and is harmless). Consumed by the grid inventory
(`client/scenes/grid-inventory.lua:370,446`) and equipment UI. Server sends
`icon` path hints relative to `assets/icons/` (see group 6).

All icons on the dev machine are **256×256 PNG** (RGBA, mostly uppercase
`.PNG` extensions — the loader is case-insensitive).

| path | type | format | dimensions | used for | required/optional | fallback behavior |
|---|---|---|---|---|---|---|
| `client/assets/icons/weapons/*.PNG` (~514) | item icon | PNG | 256×256 | weapon/shield/tool item icons (`Sword_01.PNG`, `Dagger_02.PNG`, …) | Optional | colored rarity rectangle + item initial |
| `client/assets/icons/armor/*.PNG` (~526) | item icon | PNG | 256×256 | armor slots (head/chest/legs/…) | Optional | colored rarity rectangle |
| `client/assets/icons/resources/*.PNG` (~304) | item icon | PNG | 256×256 | ores, bars, food, herbs, rings, necklaces | Optional | colored rarity rectangle |
| `client/assets/icons/loot/*.PNG` (~203) | item icon | PNG | 256×256 | potions, scrolls, backpacks, rigs, crates | Optional | colored rarity rectangle |
| `client/assets/icons/items/*.PNG` (~77) | item icon | PNG | 256×256 | alchemy/misc items (`Alchemy_01_tea.PNG`, …) | Optional | colored rarity rectangle |
| `client/assets/icons/building/*.PNG` (~105) | UI icon | PNG | 256×256 | plot/structure UI | Optional | primitive drawing |
| `client/assets/icons/professions/*.PNG` (~639) | UI icon | PNG | 256×256 | profession/skill-line art | Optional | text label only |
| `client/assets/icons/quest/*.PNG` (~159) | UI icon | PNG | 256×256 | quest UI art | Optional | text label only |
| `client/assets/icons/skills/*.PNG` (~70) | UI icon | PNG | 256×256 | ability icons (`Skill_Attack.PNG`, …) | Optional | text label only |
| `client/assets/icons/tech/*.PNG` (~70) | UI icon | PNG | 256×256 | tech/upgrade UI | Optional | text label only |

## 2. NPC dialogue portraits — `client/assets/icons/portraits/<group>/`

Loader: `client/scenes/game-draw/world.lua:1941` (`pcall`-guarded, cached).
The server's handcrafted NPC JSON supplies `portrait` as a path relative to
`assets/icons/portraits/` (e.g. `elf/Elf_02.PNG`). Drawn at 72px in the
dialogue panel; any square source works.

Groups on the dev machine (487 files total, all 256×256 PNG): `animals`,
`demons`, `dwarf`, `elf`, `giants`, `gnome`, `goblin`, `gods`, `human`,
`misc`, `monsters`, `orc`, `siege`, `undead`, `vampires`.

| path | type | format | dimensions | used for | required/optional | fallback behavior |
|---|---|---|---|---|---|---|
| `client/assets/icons/portraits/<group>/*.PNG` (~487) | portrait | PNG | 256×256 | NPC dialogue panel portrait | Optional | drawn placeholder box (explicit fallback branch at `world.lua:1950-1956`) |

## 3. Audio — `client/assets/audio/`

Loader: `client/lib/audio.lua` (`BASE = "assets/audio/"`, every load goes
through `getInfo` + `pcall` — missing files are silent no-ops). Numbered
families are discovered by `scanFiles()` (audio.lua:382), so partial sets
work: supply any subset of the numbered names and only those play. All files
are **Ogg Vorbis** (`.ogg`); stereo, 44.1 kHz is what the originals use.

### 3a. Music — `client/assets/audio/music/`

Track names are hard-coded in `MUSIC_TRACKS` (audio.lua:197-217). Three-part
tracks stream `start` once then loop `loop`; exact filenames (including
spaces/parentheses) matter.

| path | type | format | dimensions | used for | required/optional | fallback behavior |
|---|---|---|---|---|---|---|
| `music/beginning (start\|middle_loop\|end).ogg` | music (3-part) | OGG | — | overworld/town playlists | Optional | silence |
| `music/darkness follows (start part 1\|middle_loop\|end).ogg` | music (3-part) | OGG | — | dungeon horror playlist | Optional | silence |
| `music/finale (start\|middle_loop\|end).ogg` | music (3-part) | OGG | — | boss/inferno playlist | Optional | silence |
| `music/heat (start\|middle_loop\|end).ogg` | music (3-part) | OGG | — | fire themes + combat pool | Optional | silence |
| `music/pitch black (start\|middle_loop\|end).ogg` | music (3-part) | OGG | — | void/horror playlist | Optional | silence |
| `music/subliminal (start\|middle_loop\|end).ogg` | music (3-part) | OGG | — | ice/eerie playlist | Optional | silence |
| `music/undercover (start\|middle_loop\|end).ogg` | music (3-part) | OGG | — | stealth/mystery playlist | Optional | silence |
| `music/ambient_ost_mx_1_(beginning\|middle\|end).ogg` | music (3-part) | OGG | — | ambient overworld playlist | Optional | silence |
| `music/fight (loop).ogg`, `firefight (loop).ogg`, `death close by (loop).ogg`, `pressure (loop).ogg`, `last chapter (loop).ogg`, `too late (loop).ogg` | music (single loop) | OGG | — | combat + machine-theme playlists | Optional | silence |
| `music/hope (complete track).ogg`, `no way out (complete track).ogg`, `sinister awakens (complete track).ogg`, `something in the forest (complete track).ogg`, `swarm (complete track).ogg` | music (one-shot) | OGG | — | town/forest/organic playlists | Optional | silence |

35 files referenced by name (dev machine holds 45).

### 3b. Ambience — `client/assets/audio/ambience/`

Referenced by `THEME_AMBIENCE` / `ZONE_AMBIENCE` / `WEATHER_AMBIENT`
(audio.lua:103-165). Looping beds, streamed.

| path | type | format | dimensions | used for | required/optional | fallback behavior |
|---|---|---|---|---|---|---|
| `ambience/ambience_d1_loop.ogg` … `ambience_d28_outdoors_loop.ogg` (incl. `d26_1`, `d27_1`; 31 files) | ambient loop | OGG | — | per-dungeon-theme + overworld/town beds | Optional | silence |
| `ambience/ambience_strings_mx_1.ogg` | ambient loop | OGG | — | building interiors | Optional | silence |
| `ambience/ambience_rythm_slow_mx_1.ogg`, `ambience_rythm_fast_mx_1.ogg`, `ambience_whispers_mx_1.ogg`, `ambience_the_mystery_mx_1.ogg` | weather layer | OGG | — | rain / storm / snow / fog overlay | Optional | silence |

### 3c. SFX families (scanned numbered sets — any subset works)

| path | type | format | dimensions | used for | required/optional | fallback behavior |
|---|---|---|---|---|---|---|
| `footsteps/footstep_concrete_a_1..15.ogg` | SFX set | OGG | — | default/self/other-player footsteps (also dungeon steps) | Optional | silence |
| `footsteps/footstep_wood_a_1..20.ogg` | SFX set | OGG | — | wood-surface footsteps (forest/buildings) | Optional | silence |
| `footsteps/footstep_metal_a_1..4.ogg` | SFX set | OGG | — | metal-surface footsteps | Optional | silence |
| `ui/gui_click_1..12.ogg` | SFX set | OGG | — | button click | Optional | silence |
| `ui/gui_submit_1..5.ogg` | SFX set | OGG | — | form submit / confirm | Optional | silence |
| `ui/ui_warning_mx_1.ogg`, `ui/ui_return_mx_1.ogg` | SFX | OGG | — | warning + back navigation | Optional | silence |
| `combat/hit_1..5.ogg` | SFX set | OGG | — | melee hit | Optional | silence |
| `combat/universal_swing_miss_light_ufx_1..2.ogg` | SFX set | OGG | — | attack miss | Optional | silence |
| `combat/slash_bloody_heavy_ufx_1..3.ogg` | SFX set | OGG | — | heavy/crit hit | Optional | silence |
| `combat/sharp_slash_body_ufx_1.ogg` | SFX | OGG | — | slash | Optional | silence |
| `combat/sword_clash_ufx_1.ogg` | SFX | OGG | — | block | Optional | silence |
| `combat/bones_breaking_1.ogg` | SFX | OGG | — | death | Optional | silence |
| `combat/sword_draw_ufx_1.ogg` | SFX | OGG | — | weapon draw / combat start | Optional | silence |
| `items/player_level_up_ufx_1.ogg` | SFX | OGG | — | level-up | Optional | silence |
| `items/item_pickup_ufx_1.ogg`, `items/item_equip_ufx_1.ogg` | SFX | OGG | — | pickup / equip | Optional | silence |
| `items/inventory_open.ogg`, `items/inventory_close.ogg` | SFX | OGG | — | inventory toggle | Optional | silence |
| `items/container_open_small_ufx_1.ogg` | SFX | OGG | — | container/loot open | Optional | silence |
| `items/glass_break_ufx_1.ogg` | SFX | OGG | — | item break | Optional | silence |
| `items/item_upgrade_ufx_1..3.ogg` | SFX set | OGG | — | upgrade success | Optional | silence |
| `items/new_objective_ufx_1.ogg` | SFX | OGG | — | quest objective ping | Optional | silence |
| `doors/door_1_open.ogg`, `doors/lever_1.ogg`, `doors/crack_1_wood.ogg` | SFX | OGG | — | door / lever / trap | Optional | silence |
| `portal/portal_1_start.ogg` | SFX | OGG | — | portal activation | Optional | silence |
| `explosions/explosion_close_long_ufx_1..4.ogg` | SFX set | OGG | — | explosions | Optional | silence |
| `cinematic/sfx_impact_mx_1.ogg`, `sfx_gong_mx_1.ogg`, `sfx_descent_mx_1.ogg`, `sfx_drums_mx_1.ogg`, `sfx_ritual_mx_1.ogg` | stinger | OGG | — | combat start / victory / defeat / turn banner / pack open | Optional | silence |
| `creatures/monster_roar_1..7.ogg`, `creatures/monster_roar_distant_1..4.ogg` | SFX set | OGG | — | creature roars (near/far) | Optional | silence |
| `horror/stinger_ph_1..6.ogg` | SFX set | OGG | — | dark-floor horror stingers (30 s cooldown) | Optional | silence |
| `machines/*.ogg` (38 on dev disk) | SFX | OGG | — | **not referenced by any code path** (reserved) | Optional (unused) | n/a |

## 4. Rendered sprite sheets — `client/assets/sprites/SK_*`, `SM_*`

Output of the `tools/asset-pipeline/` 3D→2D pipeline (see
`tools/asset-pipeline/PIPELINE.md`). Each sprite lives in its own folder:
`<Name>/<Name>.json` (**tracked** — 677 manifests are in the repo) plus
`<Name>_00.png` … sheet images (**stripped**). Sheets are shelf-packed,
**2048 px wide × variable height** on the dev machine. Loader:
`client/lib/sprite-sheet.lua`; index: `client/assets/sprites/sprite_index.json`
(tracked).

| path | type | format | dimensions | used for | required/optional | fallback behavior |
|---|---|---|---|---|---|---|
| `client/assets/sprites/SK_*/SK_*_00.png` (~93 sheets, 4-direction character frames) | sprite sheet | PNG | 2048×24–128 | layered character/equipment rendering (`lib/layered-sprite.lua` — not yet wired into scenes) | Optional | primitive (shape) rendering; **error if loaded via unguarded `SpriteSheet.load/get`** |
| `client/assets/sprites/SM_*/SM_*_00.png` (~564 sheets, props/buildings) | sprite sheet | PNG | 2048×~64 | isometric props/buildings (`lib/iso-map.lua` — not yet wired into scenes) | Optional | primitive rendering; same unguarded caveat |
| `client/assets/sprites/buildings/<assetId>/…` | sprite sheet | PNG+JSON | — | expected by `lib/iso-map.lua:174` for map objects | Optional | **directory does not exist even on the dev machine** — any `IsoMap.addObject` call would hit an unguarded error (see below) |

## 5. LPC art packs — `client/assets/sprites/{characters,creatures,tilesets,objects,animations}/`

Liberated Pixel Cup packs from OpenGameArt (CC-BY-SA 3.0 / GPL 3.0 / OGA-BY /
CC0 — **freely re-downloadable**, unlike the purchased packs above). Full
per-pack documentation, sources, and license terms are already tracked — see
`client/assets/sprites/README.md`, `client/assets/sprites/MANIFEST.md`, and
`client/assets/sprites/CREDITS.txt`; this manifest does not duplicate them.

**No current code path loads these** — they are referenced only in those docs'
usage examples. ~18,000 PNGs on the dev machine (characters mostly 192×256 /
512×256 / 384×256 LPC 64px-grid sheets; tilesets up to 1024×1024; creatures
512×512). Attribution files (`CREDITS-*`, `Attribution.txt`, `LICENSE*`,
`sources.md`) remain tracked so replacements can be re-fetched.

| path | type | format | dimensions | used for | required/optional | fallback behavior |
|---|---|---|---|---|---|---|
| `client/assets/sprites/characters/**` | LPC char sheets | PNG | 64px grid (192×256 …) | future LPC character rendering (docs only) | Optional | not loaded |
| `client/assets/sprites/creatures/**` | LPC creatures | PNG | 512×512 typical | future creature rendering (docs only) | Optional | not loaded |
| `client/assets/sprites/tilesets/**` | LPC tilesets | PNG (+tracked `.tmx`/`.tsx`) | 32px tiles | future tile maps (docs only) | Optional | not loaded |
| `client/assets/sprites/objects/**`, `animations/**` | LPC props/anims | PNG | varies | future props/weapon anims (docs only) | Optional | not loaded |

## 6. Server-side asset references

The Node server never opens these files — it only sends path strings that the
LÖVE client (or the web writing tool) resolves. Missing files therefore cost
nothing server-side.

| path | type | format | dimensions | used for | required/optional | fallback behavior |
|---|---|---|---|---|---|---|
| `equipment-data.js` `icon:` fields (~190, e.g. `weapons/Sword_0.PNG`) | icon path hint | — | — | client resolves under `client/assets/icons/` | Optional | client colored-rectangle fallback |
| `loot.js` `img:` fields (~161, e.g. `/icons/weapons/Arrow_01.PNG`) | web-style path | — | — | crate/loot art hints | Optional | emoji `icon` field is used instead |
| `loot.js` `PROFILE_PORTRAITS` `img: '/icons/characters/*.png'` | web-style path | — | — | profile pictures | Optional | **no `icons/characters/` dir exists anywhere (dev machine included)** — always falls back to the emoji `icon` field; dangling data, not a crash |
| `card-templates.js` / `rpg-data.js` `icon: 'skills/Enchantment/'`-style values (~719) | directory-only hint | — | — | card/skill art | Optional | trailing-slash values never resolve to a file; client falls back to text/emoji |
| `data/npcs/**/*.json` `portrait` fields (untracked, hand-authored) | portrait path | — | — | resolved by group 2 | Optional | placeholder box |

## 7. Not needed (already in repo / procedural)

- **Fonts** — every `love.graphics.newFont(<size>)` call uses LÖVE's bundled
  default font; no font files are referenced.
- **Particles** — `client/lib/particles.lua` generates its texture in code
  (`love.image.newImageData`).
- **`game.ico`** — tracked in the repo (window/build icon, `build.bat:103`).
- **Sprite JSON manifests, `sprite_index.json`, LPC credit/license files,
  `.tmx`/`.tsx` maps** — all tracked.

---

## Unguarded load sites

These are the only loaders that **raise** instead of falling back when a file
is missing. Both live in libraries that **no scene currently `require`s** —
the shipped boot path (login → shards → character/race select → game) never
executes them. They become fresh-clone crashes only if `iso-map` /
`layered-sprite` get wired into a scene, or if `SpriteSheet.load`/`get` is
called directly instead of `SpriteSheet.preload` (which is pcall-guarded).

| file:line | call | crashes when |
|---|---|---|
| `client/lib/sprite-sheet.lua:27` | `error("sprite-sheet: cannot read <json>")` in `parse_manifest` | `SpriteSheet.load()` on a folder with no `<name>.json` |
| `client/lib/sprite-sheet.lua:33` | `error(... "JSON parse error")` | corrupt manifest |
| `client/lib/sprite-sheet.lua:82` | `error("sprite-sheet: cannot load image <png>")` | manifest present (677 are tracked!) but sheet PNG stripped — **this is the exact fresh-clone state**, so any direct `SpriteSheet.load/get` of a tracked `SK_*`/`SM_*` folder raises |
| `client/lib/iso-map.lua:174` | `SpriteSheet.get("assets/sprites/buildings/" .. aid)` — unguarded | first `IsoMap.addObject()` with any assetId (`buildings/` doesn't exist at all) |
| `client/lib/layered-sprite.lua:52` | `SpriteSheet.get(base_asset_path)` — unguarded | first `LayeredSprite.new()` on a fresh clone |

Recommended hardening if these libs get activated: route all loads through
`SpriteSheet.preload`-style `pcall` and return `nil` on failure (the callers
already tolerate `nil` sheets).

## Fresh-clone behavior summary

| group | referenced files | on dev disk | missing-file behavior |
|---|---|---|---|
| 1. Item/UI icons | open-ended (server hints) | 2,667 PNG | colored rectangles |
| 2. Portraits | per NPC JSON | 487 PNG | placeholder box |
| 3. Audio | ~150 named + numbered sets | 560 OGG | silence |
| 4. Rendered sprite sheets | 677 manifests tracked | 657 PNG | primitives (unguarded if loaded directly) |
| 5. LPC packs | docs only | ~18,000 PNG | not loaded |
| 6. Server path hints | ~1,100 strings | — | client-side fallbacks |
