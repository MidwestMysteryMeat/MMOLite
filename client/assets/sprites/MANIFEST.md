# LPC Sprite Assets Manifest

**Generated:** 2026-01-29
**Base Directory:** `C:\Users\<you>\LOVEGAME_work\assets\sprites\lpc\`
**Game Engine:** LÖVE2D
**Total Assets:** 26 asset packs

---

## Table of Contents

1. [Directory Structure](#directory-structure)
2. [Character Assets](#character-assets)
3. [Creature Assets](#creature-assets)
4. [Tileset Assets](#tileset-assets)
5. [Object Assets](#object-assets)
6. [Animation & Weapon Assets](#animation--weapon-assets)
7. [Integration Guide](#integration-guide)
8. [Sprite Specifications](#sprite-specifications)

---

## Directory Structure

```
lpc/
├── CREDITS.txt                    (Master attribution file)
├── MANIFEST.md                    (This file)
├── characters/                    (Player and NPC sprites)
│   ├── dark_elves/               (Extracted)
│   ├── folk/                     (Extracted)
│   ├── revised_basics/           (Extracted)
│   ├── werewolf-*.png            (4 variants)
│   ├── charAnimation.png
│   ├── charAnimation2.png
│   └── *.zip                     (Original archives)
├── creatures/                     (Animals and monsters)
│   ├── flying_dragon/            (Extracted)
│   ├── pigs/                     (Extracted)
│   ├── horse_riding/             (Extracted)
│   ├── reddragonfly*.png         (4 sheets)
│   ├── bird_*.png                (5 bird variants)
│   ├── chicken.png
│   └── *.zip                     (Original archives)
├── tilesets/                      (Environment tiles)
│   ├── bazaar/                   (Extracted)
│   ├── beach_desert/             (Extracted)
│   ├── desert_ruins/             (Extracted)
│   ├── farm/                     (Extracted)
│   ├── walls/                    (Extracted)
│   ├── terrain/                  (Extracted)
│   ├── stone_house_interior.png
│   ├── Artis_dock.png
│   ├── PathAndObjects.png
│   ├── winter_Tiles*.png         (3 files)
│   ├── tilesetStart5.png
│   └── *.zip                     (Original archives)
├── objects/                       (Items and props)
│   ├── containers/               (Extracted)
│   ├── wooden_boat.7z            (Requires 7-Zip to extract)
│   └── *.zip                     (Original archives)
└── animations/                    (Special actions & weapons)
    ├── push_carry/               (Extracted)
    ├── weapons_extended/         (Extracted)
    ├── medieval_weapons/         (Extracted)
    └── *.zip                     (Original archives)
```

---

## Character Assets

### 1. LPC Dark Elves
**Location:** `characters/dark_elves/`
**Format:** PNG sprite sheets
**Dimensions:** 64x64 per character frame
**License:** CC-BY-SA 3.0, GPL 3.0, GPL 2.0

**Contents:**
- Dark elf male and female variants
- Pointed ear variations
- Multiple skin tones

**Animations:**
- Walk cycle (4 directions)
- Hurt
- Slash
- Spellcast
- Shooting
- Thrusting

**Usage in LÖVE2D:**
```lua
-- Example frame layout (standard LPC)
-- Each animation row: [down, left, up, right]
-- Frame size: 64x64 pixels
local darkElf = love.graphics.newImage("lpc/characters/dark_elves/elf_female.png")
local frameWidth, frameHeight = 64, 64
```

---

### 2. Werewolf
**Location:** `characters/werewolf-*.png`
**Format:** 4 PNG files (NESW, SWEN, alt-NESW, alt-SWEN)
**Dimensions:** 48x64 per frame
**License:** CC-BY-SA 3.0

**Contents:**
- Two body style variants
- Different arm positions on side-facing frames
- Orthogonal orientation options

**Animations:**
- Idle (center frame)
- Walk (12 frames total, 3 per direction)

**Usage Notes:**
- Use NESW for North-East-South-West directional order
- Use SWEN for South-West-East-North directional order
- Choose based on your game's directional system

---

### 3. LPC Folk
**Location:** `characters/folk/`
**Format:** Modular PNG sprite sheets
**Dimensions:** Compatible with LPC v3 character bases
**License:** CC-BY-SA 3.0, GPL 3.0

**Contents:**
- **Adult heads:** warthog, mouse, rat, rabbit, pig, sheep, goblin, troll, vampire, Frankenstein, alien
- **Child heads:** mouse, rat, rabbit, pig, sheep, troll
- Compatible with adult (male, female, teen, muscular, pregnant) and child bodies

**Animations (all heads):**
- cast, thrust, walk, slash, shoot, hurt, jump, run, idle, sit

**Usage Notes:**
- Modular system - combine heads with body bases
- Requires lpctools for complete spritesheet generation
- Check CREDITS-heads.csv for detailed attribution

---

### 4. LPC Revised Character Basics
**Location:** `characters/revised_basics/`
**Format:** Comprehensive modular PNG system
**Dimensions:** Varies by component
**License:** CC-BY-SA 3.0, GPL 3.0, OGA-BY 3.0

**Contents:**
- Masculine and feminine bodies (11 skin tones)
- Swappable heads (masculine/feminine)
- 18 animated hairstyles (11 natural + 6 dyed colors)
- 17 clothing options per body type (44 color variations each)
- Facial expressions: shocked, angry, sad, happy

**Animations:**
- 4 animated sequences: idle, walk, run, jump
- 6 static poses: sitting and emoting frames
- Documentation for 24/30 FPS animation

**Usage Notes:**
- Most comprehensive character creation system
- Includes palette ramp guides
- Body guidelines included
- Perfect for player character customization

---

### 5. Character Animations (Unfinished)
**Location:** `characters/charAnimation.png`, `characters/charAnimation2.png`
**Format:** PNG sprite sheets
**License:** CC0 (Public Domain)

**Contents:**
- Character animation sprites (2 files)
- Fantasy-style elements

**Usage Notes:**
- Unfinished work, may need touching up
- Not organized in standard tileset format
- Layered .pyxel versions available from original author

---

## Creature Assets

### 6. Red Dragon
**Location:** `creatures/reddragonfly*.png` (4 files)
**Format:** 4 separate PNG sprite sheets
**File Sizes:** 169-206 KB
**License:** CC-BY 3.0

**Contents:**
- Flying dragon sprite (LPC viewpoint)
- 4 sprite sheet variations

**Animations:**
- Four directional movement
- Attack sequences
- Movement cycles
- Hit/damage sequences

**Usage Notes:**
- Created for PlayCraft mobile game
- Large flying enemy/boss sprite
- Commission by Buko Studios

---

### 7. Flying Dragon Rework
**Location:** `creatures/flying_dragon/`
**Format:** PNG with GIMP source (.xcf)
**Dimensions:** 144x128 and 191x161 pixels
**License:** CC-BY 3.0

**Contents:**
- Single-headed flying dragon
- Twin-headed dragon variant
- Stendhal-compatible format

**Animations:**
- Flying motion (12 frames, 3 per direction)
- N/E/S/W directional format

---

### 8. LPC Birds
**Location:** `creatures/bird_*.png` (15 total, 5 downloaded)
**Format:** Individual PNG files per bird variant
**Dimensions:** Standard LPC creature size
**License:** Multiple (CC-BY 4.0/3.0, CC-BY-SA 4.0/3.0, GPL 3.0/2.0, OGA-BY 3.0)

**Available Variants:**
- bird_1_bluejay.png
- bird_2_eagle.png
- bird_2_cardinal.png
- bird_3_robin.png
- bird_3_sparrow.png

**Additional variants available on OpenGameArt.org:**
- bird_1: brown, red, white_crest, white
- bird_2: black, blue, brown_1, brown_2, red, white

**Animations:**
- Flying (4 directions)
- Walking (4 directions)

**Usage Notes:**
- Perfect for ambient wildlife
- Can be used with DRM per author
- Inspired by Refuzzle's winter birds (CC0)

---

### 9. Horse Riding
**Location:** `creatures/horse_riding/`
**Format:** Algorithmically combined PNG sheets
**License:** CC-BY 3.0, GPL 3.0, GPL 2.0, OGA-BY 3.0

**Contents:**
- Character + horse riding combinations
- All standard horse colors supported
- Unicorn and pegasus pending

**Animations:**
- Walk cycle
- Gallop cycle
- Eat animation
- Stand animation

**Usage Notes:**
- Combines character and horse animations
- Incompatible with robes, capes, skirts, dresses, wings, tails
- Can use any animation except standard walk
- Algorithm modvalues.zip included

---

### 10. Pigs
**Location:** `creatures/pigs/`
**Format:** Indexed PNG (256 colors)
**Dimensions:** 64x64 (pig, boar), 48x64 (piglet)
**License:** CC-BY 3.0

**Contents:**
- Pig (64x64)
- Boar (64x64)
- Piglet (48x64)

**Animations:**
- Idle (center frames)
- Walk (12 frames, 3 per direction)
- N/E/S/W orientation

**Usage Notes:**
- Drop-in replacement for Stendhal
- Based on LPC farm animals

---

### 11. Chicken
**Location:** `creatures/chicken.png`
**Format:** Single PNG file
**Dimensions:** 32x32 pixels
**License:** CC-BY 3.0, GPL 2.0

**Animations:**
- Idle (center frames)
- Walk (12 frames, 3 per direction)
- N/E/S/W format

**Usage Notes:**
- Stendhal-compatible
- 150ms delay for animation preview

---

## Tileset Assets

### 12. Stone Home Interior
**Location:** `tilesets/stone_house_interior.png`
**Format:** Single PNG tileset
**Tile Size:** 32x32 pixels
**License:** CC-BY-SA 3.0

**Contents:**
- Stone walls (multiple variations)
- Stone floors
- Wooden floors
- Rugs
- Columns
- Stairs and stairwells
- Stair railings
- Guardrails
- Wooden half-walls

**Usage in LÖVE2D:**
```lua
local interiorTiles = love.graphics.newImage("lpc/tilesets/stone_house_interior.png")
local tileSize = 32
-- Extract tiles using quads
```

---

### 13. Bazaar Rework
**Location:** `tilesets/bazaar/`
**Format:** PNG images (indexed color) + GIMP sources (RGB)
**Tile Size:** 32x32 pixels
**Map Dimensions:** 64x64 & 128x96 tiles
**License:** CC-BY-SA 3.0/4.0, GPL 3.0

**Contents:**
- Bazaar/marketplace tiles
- Merchant tables
- Bottles
- Flowers
- Market stall elements
- Food decorations

**Usage Notes:**
- Designed for Stendhal
- Orthogonal orientation
- Sources from LPC House Interior and RPG Item Set

---

### 14. Beach / Desert
**Location:** `tilesets/beach_desert/`
**Format:** Multiple PNG tilesets
**Tile Size:** 32x32 pixels
**License:** CC-BY-SA 3.0

**Contents:**
- Seashells and starfish
- Cacti and desert plants (various sizes)
- Skeletal/bone formations
- Dry, gnarled trees
- Sand dune formations
- Desert vegetation

**Usage Notes:**
- Part of LPC outdoor tileset series
- Check CREDITS-beach-desert.txt for full attribution
- Preview uses separate LPC sand and water assets

---

### 15. Dock Tileset
**Location:** `tilesets/Artis_dock.png`
**Format:** Single PNG tileset
**Tile Size:** 32x32 pixels
**License:** CC-BY-SA 3.0

**Contents:**
- Wooden dock structures
- Wooden plank variations
- Underwater variants (LPC compatible)
- Empty support columns
- Land versions for sand, grass, jungle terrain

**Usage Notes:**
- From Evol Online
- Compatible with LPC standard
- Top-down RPG environment

---

### 16. Desert Ruins
**Location:** `tilesets/desert_ruins/`
**Format:** Large ZIP (9.1 MB) with multiple PNGs
**Tile Size:** 32x32 pixels
**License:** OGA-BY 3.0+, CC-BY 3.0+/4.0, GPL 2.0+/3.0

**Contents:**
- Interior and exterior walls
- Wall slabs and ceiling trim
- Pyramids (smooth and stairstep)
- Ruined building structures
- Modular statues (heads/bodies in decay states)
- Transitional wall pieces

**Usage Notes:**
- Egyptian/Greek architecture inspiration
- Modular construction system
- Build temples, dungeons, ancient cities
- Companion: [LPC] Jungle Ruins

---

### 17. Cobblestone Paths & Town Objects
**Location:** `tilesets/PathAndObjects.png`, `tilesets/PathAndObjects_Credits.png`
**Format:** 512x512 tileset (256 tiles)
**Tile Size:** 32x32 pixels (organized in 512x512 sheet)
**License:** CC-BY-SA 3.0 (some CC-BY 3.0)

**Contents:**
- Cobblestone path tiles and transitions
- Market booth structures
- Tables and furniture
- Horizontal docks
- Boats
- Grass and water terrain variations
- Food and object decorations
- Firewood elements

**Usage Notes:**
- Collaborative asset from multiple OGA artists
- Credits image included (PathAndObjects_Credits.png)

---

### 18. Farm
**Location:** `tilesets/farm/`
**Format:** Multiple PNGs
**Tile Size:** 32x32 pixels
**License:** CC-BY 4.0

**Contents:**
- **Buildings:** Modular barn (red/brown), towers, silos, granary, chicken coop with nesting boxes, apiary/beehives, sheds, stables
- **Fencing:** Two new designs
- **Animated:** Windmill blades, water wheels
- **Equipment:** Butter churner, cheese press, mayonnaise maker

**Design Variations:**
- Primitive style (thatched roofs, wattlework) - Medieval
- Refined style (Victorian-era aesthetic)

**Usage Notes:**
- Commissioned by Rupil
- Adapts Ivan Voirol's Slates tileset
- TheraHedwig's thatched roof designs

---

### 19. Walls
**Location:** `tilesets/walls/`
**Format:** Multiple PNGs + Wang Tile terrain data
**Tile Size:** 32x32 pixels
**License:** CC-BY-SA 3.0

**Contents:**
- 300+ wall tiles
- 32 ceiling trim variations
- Wall styles: brick, wood, metal, corrugated, timber-framed, panel, wallpaper
- Wang Tile terrain compatibility (Tiled 1.5.0+)

**Usage Notes:**
- Example scene included (lpc-interior-preview.zip)
- Compatible with [LPC] Floors, Windows & Doors
- Warning: .tsx file has 255 wang tiles (Tiled limit is 254)

---

### 20. Winter Tiles
**Location:** `tilesets/winter_TilesA2.png`, `winter_TilesA3.png`, `winter_TilesB.png`
**Format:** 3 PNG files (RPG Maker format)
**Tile Size:** 32x32 pixels
**License:** CC-BY 3.0, CC-BY-SA 3.0, GPL 3.0, OGA-BY 3.0

**Contents:**
- Winter terrain tiles
- Pine trees (original large + smaller edited variants)
- Ice/snow scenery
- RPG Maker VX/VX Ace formatted

**Attribution Required:**
"LPC Winter Tiles by Demetrius. Based on LPC: Modified Base tiles by Lanea Zimmerman, special thanks to William Thompson"

**Usage Notes:**
- Entry for "Ice is Nice" challenge
- May require reformatting for Tiled
- Complements LPC: Modified Base Tiles

---

### 21. Tiled Terrains
**Location:** `tilesets/terrain/`
**Format:** PNG atlas + TSX configuration
**Tile Size:** 32x32 pixels
**License:** CC-BY-SA 3.0, GPL 3.0

**Contents:**
- Grass
- Sand (custom replacement)
- Snow (recolored, less gray)
- Earth/soil
- Sewer tiles
- Water
- Other environmental variations

**Usage Notes:**
- Pre-configured for Tiled map editor
- Attribution.txt included (~14 contributors)
- Ready for seamless layer integration

---

### 22. Unfinished Tileset
**Location:** `tilesets/tilesetStart5.png`
**Format:** Single PNG
**License:** CC0 (Public Domain)

**Contents:**
- Fantasy-style map tileset
- Various environmental elements

**Usage Notes:**
- Not organized in proper tileset format
- May need individual element extraction
- Layered .pyxel versions available from author

---

## Object Assets

### 23. Containers
**Location:** `objects/containers/`
**Format:** Modular PNG system
**Tile Size:** Varies (standardized for holding objects)
**License:** CC-BY-SA 4.0

**Contents:**
- **Storage:** Wooden/metal crates, barrels, tubs, sacks, bags, pouches, baskets, chests
- **Glass:** Cups, flasks, pitchers, steins, beakers
- **Alchemy:** Alembics, crucibles, aludels
- **Pottery:** Pots, jars
- **Special:** Oblique crates (v4.2)

**Features:**
- Empty containers with separate lids
- Recolorable glassware contents
- Layerable liquid fills
- Standardized sizing

**Usage Notes:**
- Modular overlay system
- v4.2 includes oblique crates
- 17 contributors

---

### 24. Wooden Boat
**Location:** `objects/wooden_boat.7z`
**Format:** 7z archive (requires 7-Zip)
**Dimensions:** 72x72 pixels
**License:** CC0 (Public Domain)

**Contents:**
- 3 versions of wooden boat sprite

**Usage Notes:**
- Requires 7-Zip extraction tool
- Public domain, use freely
- Part of LPC Collection

---

## Animation & Weapon Assets

### 25. Push and Carry
**Location:** `animations/push_carry/`
**Format:** Multiple PNGs (layered system)
**Dimensions:** LPC male character size
**License:** CC-BY-SA 3.0, GPL 3.0

**Contents:**
- Push walkcycle animations
- Carry overhead walkcycle animations
- Armless walkcycle foundation
- Separate arm sheets for both animations
- Base clothing: pants, longsleeve shirt, shoes, plain hair, tunic
- Grab animation clothing variants
- Tunic for jump animation compatibility

**Animations:**
- 1-frame idle
- 8-frame walkcycle
- Integrates with Daniel Eddeland's grab animation

**Usage Notes:**
- Shoes and headgear from standard walkcycles compatible
- Torso items require arm position modifications

---

### 26. Extended Weapon Animations
**Location:** `animations/weapons_extended/`
**Format:** PNG sprite sheets (layered)
**Grid:** 192x192 for medieval weapons
**License:** CC-BY-SA 3.0, OGA-BY 3.0+, GPL 3.0

**Contents:**
- **Longsword:** walk, hurt, slash, reverse slash, thrust
- **Dagger:** walk, hurt, slash, reverse slash, thrust
- **Mace:** walk, hurt, slash
- **Other:** Rapier, saber, scythe, glow sword, farming tools

**Features:**
- Extended animation support (walk, hurt added)
- Reverse slash and thrust for daggers/longswords
- Layered format for all body types (male, female, pregnant, muscular)

**Usage Notes:**
- Check README-weapons.txt for specific licensing
- v2 release includes more weapons
- Compatible with LPC character bases

---

### 27. Medieval Weapons
**Location:** `animations/medieval_weapons/`
**Format:** PNG sprite sheets
**Grid:** 192x192
**License:** OGA-BY 3.0/4.0, GPL 3.0, CC-BY-SA 3.0/4.0

**Contents:**
- **Flail:** walk, slash, hurt
- **Halberd:** walk, slash, thrust, hurt
- **War Axe:** walk, slash, hurt

**Features:**
- Male and female LPC bases
- Created for Herodom game
- Commissioned by castelonia

**Usage Notes:**
- 192x192 grid (larger than standard LPC)
- Halberd has thrust animation
- Compatible with standard LPC bodies

---

## Integration Guide

### LÖVE2D Implementation

#### Loading LPC Sprites

```lua
-- Basic sprite loading
local sprite = {
    image = love.graphics.newImage("assets/sprites/lpc/characters/revised_basics/body/male/light.png"),
    frameWidth = 64,
    frameHeight = 64,
    animations = {}
}

-- Create quads for animation frames
function createAnimationQuads(image, frameWidth, frameHeight, startX, startY, frameCount)
    local quads = {}
    local imageWidth = image:getWidth()

    for i = 0, frameCount - 1 do
        local x = startX + (i * frameWidth)
        local y = startY
        table.insert(quads, love.graphics.newQuad(x, y, frameWidth, frameHeight, imageWidth, image:getHeight()))
    end

    return quads
end

-- Standard LPC animation layout (example for walk south)
sprite.animations.walkSouth = createAnimationQuads(sprite.image, 64, 64, 0, 512, 9)
```

#### Standard LPC Animation Rows

Most LPC character sprites follow this layout:
- Row 0 (Y=0): Spellcast
- Row 1 (Y=64): Thrust
- Row 2 (Y=128): Walk
- Row 3 (Y=192): Slash
- Row 4 (Y=256): Shoot
- Row 5 (Y=320): Hurt

Each row typically has 4 direction groups: [Up, Left, Down, Right]

#### Tileset Loading

```lua
-- Load a tileset
local tileset = love.graphics.newImage("assets/sprites/lpc/tilesets/stone_house_interior.png")
local tileSize = 32

-- Create quad for specific tile
function getTileQuad(tileX, tileY)
    return love.graphics.newQuad(
        tileX * tileSize,
        tileY * tileSize,
        tileSize,
        tileSize,
        tileset:getWidth(),
        tileset:getHeight()
    )
end
```

#### Layered Character System

```lua
-- LPC uses modular layers
local character = {
    layers = {
        body = love.graphics.newImage("lpc/characters/revised_basics/body/male/light.png"),
        hair = love.graphics.newImage("lpc/characters/revised_basics/hair/male/long_brown.png"),
        clothes = love.graphics.newImage("lpc/characters/revised_basics/clothes/tunic_blue.png"),
        weapon = love.graphics.newImage("lpc/animations/weapons_extended/longsword.png")
    }
}

-- Draw all layers
function drawCharacter(x, y, frame)
    for _, layer in pairs(character.layers) do
        love.graphics.draw(layer, frame, x, y)
    end
end
```

---

## Sprite Specifications

### Standard Dimensions

| Asset Type | Typical Size | Grid |
|-----------|-------------|------|
| Character | 64x64 | Single frame |
| Small Creature | 32x32, 48x64 | Single frame |
| Large Creature | 144x128, 191x161 | Single frame |
| Environment Tile | 32x32 | Tileset |
| Object/Item | Varies | 32x32 grid |
| Weapon Animation | 192x192 | Character frame |

### Animation Frame Counts

| Animation Type | Frame Count | Layout |
|---------------|-------------|---------|
| LPC Walk | 9 frames | 4 directions × 9 |
| LPC Idle | 1 frame | 4 directions |
| LPC Slash | 6 frames | 4 directions |
| LPC Thrust | 8 frames | 4 directions |
| LPC Spellcast | 7 frames | 4 directions |
| LPC Hurt | 6 frames | 1 direction |
| Creature Walk | 12 frames | 3 per direction |

### Color Formats

- Most tilesets: **32-bit RGBA PNG**
- Some character sprites: **Indexed PNG (256 colors)**
- GIMP sources: **RGB color (.xcf files)**

### File Organization

- **Extracted folders:** Organized by content type
- **Original archives:** Preserved as .zip files
- **Individual sprites:** Direct PNG files for single assets
- **Modular systems:** Multiple PNGs in folders

---

## Common Issues & Solutions

### Issue: ZIP file won't extract
**Solution:** Use PowerShell's `Expand-Archive` or Windows built-in ZIP extractor

### Issue: 7z file won't open (wooden_boat.7z)
**Solution:** Install 7-Zip from https://www.7-zip.org/

### Issue: Sprites appear blurry in LÖVE2D
**Solution:** Disable texture filtering
```lua
love.graphics.setDefaultFilter("nearest", "nearest")
```

### Issue: Animation frames wrong size
**Solution:** Verify frame dimensions in original asset documentation

### Issue: Tiled .tsx file won't load
**Solution:** Some tilesets exceed Tiled's 254 wang tile limit - import manually

---

## Asset Usage Examples

### Character with Equipment
1. Load base character from `revised_basics/`
2. Add hair from same folder
3. Add clothing/armor
4. Add weapon from `animations/weapons_extended/`
5. Layer draw in order: body → hair → clothes → weapon

### Farm Scene
1. Use terrain from `tilesets/terrain/` for ground
2. Add buildings from `tilesets/farm/`
3. Place animals from `creatures/` (chicken, pigs)
4. Add objects from `objects/containers/` (barrels, sacks)
5. Optional: Add NPCs from `characters/folk/`

### Desert Ruins Level
1. Base terrain: `tilesets/beach_desert/`
2. Structures: `tilesets/desert_ruins/`
3. Props: Sand dunes, cacti from beach_desert
4. Enemies: Dragons from `creatures/`
5. Objects: Containers from `objects/containers/`

---

## Credits & Attribution

**Always include CREDITS.txt with your game distribution.**

For web-based games, include attribution page linking to:
- OpenGameArt.org asset pages
- Individual artist profiles
- This manifest file

---

## Additional Resources

- **LPC Base:** https://opengameart.org/content/liberated-pixel-cup-0
- **LPC Tools:** https://github.com/joeywatts/lpc-spritesheet-generator
- **Tiled Map Editor:** https://www.mapeditor.org/
- **LÖVE2D Docs:** https://love2d.org/wiki/Main_Page

---

## Version History

- **v1.0** (2026-01-29): Initial download and organization
  - 26 asset packs downloaded
  - All files extracted (except wooden_boat.7z)
  - Complete directory structure created
  - Master credits compiled

---

**For questions about specific assets, refer to:**
- Individual README files in extracted folders
- CREDITS.txt for attribution details
- Original OpenGameArt.org URLs in CREDITS.txt

**Generated for LÖVE2D game project**
**Base directory:** `C:\Users\<you>\LOVEGAME_work\assets\sprites\lpc\`
