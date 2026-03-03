# 3D → 2D Sprite Pipeline

Converts FBX / UE5 assets into LÖVE 2D sprite sheets.

---

## Architecture

```
UE5 .uasset / .pak
        │
        ▼
[ Stage 1: Export ]   ue5_export.py  (umodel CLI or UE5 Python API)
        │
        ▼ .fbx + .png textures
[ Stage 2: Render ]   blender_render.py  (headless Blender, isometric/top-down)
        │
        ▼ individual PNGs per frame/direction
[ Stage 3: Pack   ]   sprite_packer.py  (shelf bin-packer, alpha trim)
        │
        ▼ sprite sheets (.png) + manifests (.json)
[ Stage 4: Deploy ]   run_pipeline.py copies to client/assets/sprites/
        │
        ▼
   LÖVE 2D game — client/lib/sprite-sheet.lua
```

---

## Prerequisites

| Tool      | Version   | Download |
|-----------|-----------|----------|
| Blender   | 3.6 / 4.x | https://www.blender.org/download/ |
| Python    | 3.10+     | https://python.org |
| Pillow    | 10+       | `pip install Pillow` |
| umodel    | latest    | https://www.gildor.org/en/projects/umodel |

---

## Quick Start

### 1. Install Python deps
```bat
pip install Pillow
```

### 2. Export FBX from UE5 assets

**Option A — umodel (recommended for 600 GB bulk, no UE5 running needed):**
```bat
python ue5_export.py --mode umodel ^
    --input  "D:\EpicFabAssets\Content" ^
    --output "D:\pipeline\fbx" ^
    --umodel "tools\umodel\umodel.exe" ^
    --game   ue5
```

**Option B — UE5 Python API (must be inside UE5 editor):**
```python
# Edit > Execute Python Script
import ue5_export
ue5_export.export_via_ue5_api("/Game/", "D:/pipeline/fbx", ["StaticMesh","SkeletalMesh"])
```

### 3. Test one asset end-to-end
```bat
python run_pipeline.py ^
    --single "D:\pipeline\fbx\characters\goblin.fbx" ^
    --type   character ^
    --anim   walk ^
    --blender "C:\Program Files\Blender Foundation\Blender 4.1\blender.exe"
```
Check `client/assets/sprites/goblin/` for the result.

### 4. Full batch run (with resume support)
```bat
python run_pipeline.py ^
    --fbx-root "D:\pipeline\fbx" ^
    --blender  "C:\Program Files\Blender Foundation\Blender 4.1\blender.exe" ^
    --workers  4 ^
    --resume
```
Progress is saved to `pipeline_progress.json` — safe to kill and restart.

---

## Config (`config.json`)

Key settings per asset type:

| Key                 | Meaning |
|---------------------|---------|
| `resolution`        | Render size in pixels (64 / 128 / 256) |
| `directions`        | Y-rotation angles to render [0, 90, 180, 270] = 4-dir |
| `direction_names`   | Labels: south / west / north / east |
| `export_animations` | Whether to render animation frames |
| `sheet_max_size`    | Max sprite sheet dimension (2048 / 4096) |
| `camera_type`       | `isometric` \| `top_down` \| `side` |
| `match_keywords`    | Filename/path keywords to auto-classify this type |

### Camera types
- **isometric** — 54.7° elevation + 45° azimuth (standard game iso). Best for buildings, characters.
- **top_down** — Looking straight down. Best for weapons, items on the ground.
- **side** — Platformer side view. Useful for UI item icons.

### Animation rendering
Blender renders every frame of matching action strips. Action names are matched by keyword:
- `--anim walk` matches any action whose name contains "walk"
- Renders output as `<asset>_<direction>_<frame_number>.png`

---

## Output Structure

```
output/
  frames/
    goblin/
      goblin_south.png          ← static (no anim)
      goblin_walk_south_0001.png
      goblin_walk_south_0002.png
      ...
      goblin_frames.json        ← per-asset render manifest
  sheets/
    goblin/
      goblin_00.png             ← packed sprite sheet
      goblin.json               ← manifest (frame rects + animation groups)

client/assets/sprites/
  goblin/
    goblin_00.png
    goblin.json
  sprite_index.json             ← global index of all loaded assets
```

---

## LÖVE 2D Integration

### Basic usage
```lua
local SpriteSheet = require("lib.sprite-sheet")

-- Load once (e.g. in love.load or zone load)
local goblinSprite = SpriteSheet.load("assets/sprites/goblin")

-- In update:
SpriteSheet.playFacing(goblinSprite, "goblin_walk", player.facing)
SpriteSheet.update(goblinSprite, dt)

-- In draw (replaces the primitive rectangle/circle draw):
SpriteSheet.draw(goblinSprite, player.x, player.y, 0.5)
```

### Registry (shared across handlers)
```lua
-- Preload at zone entry
SpriteSheet.preload({
    "assets/sprites/goblin",
    "assets/sprites/human_male",
    "assets/sprites/orc",
})

-- Draw anywhere without re-loading
local sp = SpriteSheet.get("assets/sprites/goblin")
SpriteSheet.playFacing(sp, "goblin_walk", "down")
SpriteSheet.update(sp, dt)
SpriteSheet.draw(sp, x, y)

-- Release on zone exit
SpriteSheet.releaseAll()
```

### Dropping into existing player draw code
Find the player draw loop in `client/scenes/game-draw/world.lua` and replace the
primitive block with a sprite draw, keeping the rest (name labels, HP bars, etc.) intact.

---

## Scale / Performance Notes for 647 GB

- **Don't process everything at once.** Start with one asset category (e.g. characters) and validate the output looks correct before running the full batch.
- **Disk space budget:** ~647 GB in → roughly 5–20 GB of sprites out (depends on resolution + animation count). Final sprite sheets compress well (zopfli/pngcrush pass optional).
- **Worker count:** Set `--workers` to half your logical CPU count. Each Blender instance is single-threaded but they run in parallel. Memory usage: ~2–4 GB per Blender worker.
- **Estimated time:** ~30–120 seconds per asset in Blender EEVEE (static) / 2–10 min per animated character. For 1000 static props at 2 workers: ~8–25 hours.
- **Resume:** The pipeline saves `pipeline_progress.json`. Safe to kill and restart — already-rendered assets are skipped by checking for the `_frames.json` marker file.
- **Texture baking:** If textures don't appear correctly, you may need to bake them to vertex colors or a single atlas in Blender. Add `--bake-textures` as an enhancement to `blender_render.py`.
- **LOD / decimation:** For very heavy meshes, add a Decimate modifier in the Blender script (reduce poly count before rendering). Doesn't affect 2D output quality.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Blender renders black/missing textures | FBX textures may use relative paths. Use umodel which exports textures alongside FBX, or embed textures on UE5 export. |
| Objects too small/large in output | Adjust `padding_factor` in config.json (1.0 = tight fit, 1.5 = lots of padding). |
| Character faces wrong direction | Add offset to `directions` array (e.g. `[45, 135, 225, 315]`). |
| Animation name not found | Print `bpy.data.actions.keys()` in Blender script to see actual action names, then adjust `--anim` keyword. |
| Sprite appears flipped | Flip `scale` to `(-scale, scale)` in `SpriteSheet.draw()`. |
| Sheet is mostly empty space | Enable alpha trimming (default on). Check `trim_alpha()` handles your image mode. |
