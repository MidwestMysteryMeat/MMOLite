# LPC Sprite Assets for LÖVE2D Game

**Downloaded:** 2026-01-29
**Location:** `C:\Users\<you>\LOVEGAME_work\assets\sprites\lpc\`
**Source:** OpenGameArt.org - Liberated Pixel Cup (LPC) Assets

## Quick Start

This directory contains a comprehensive collection of LPC (Liberated Pixel Cup) sprite assets organized for use in your LÖVE2D game.

### Directory Structure

```
lpc/
├── characters/     - Player and NPC sprites (dark elves, werewolf, folk, revised basics)
├── creatures/      - Animals and monsters (dragons, birds, pigs, chicken, horses)
├── tilesets/       - Environment tiles (interiors, desert, farm, winter, walls, terrain)
├── objects/        - Items and props (containers, boats)
├── animations/     - Special animations and weapons (push/carry, medieval weapons)
├── CREDITS.txt     - Complete attribution and licensing information
├── MANIFEST.md     - Detailed asset documentation and integration guide
└── README.md       - This file
```

## What's Included

### Character Assets (5 packs)
- **LPC Dark Elves** - Dark elf variants with full animations
- **Werewolf** - 48x64 werewolf sprites (4 variants)
- **LPC Folk** - Modular character heads (11 species/types)
- **LPC Revised Character Basics** - Comprehensive character system (11 skin tones, 18 hairstyles, 17 clothing options)
- **Character Animations** - Additional character sprites (CC0)

### Creature Assets (6 packs)
- **Red Dragon** - 4 flying dragon sprite sheets with attacks
- **Flying Dragon Rework** - Single/twin-headed dragon variants
- **LPC Birds** - 5 bird species (bluejay, eagle, cardinal, robin, sparrow)
- **Horse Riding** - Character + horse riding animations
- **Pigs** - Pig, boar, and piglet (64x64, 48x64)
- **Chicken** - 32x32 chicken sprites

### Tileset Assets (10 packs)
- **Stone Home Interior** - Interior tiles (32x32)
- **Bazaar Rework** - Marketplace tiles and objects
- **Beach/Desert** - Shells, cacti, desert plants, sand dunes
- **Dock Tileset** - Wooden dock structures
- **Desert Ruins** - Modular ruins (Egyptian/Greek inspired)
- **Cobblestone Paths** - 512x512 tileset with town objects
- **Farm** - Barns, silos, fencing, windmills, equipment
- **Walls** - 300+ wall tiles in various styles
- **Winter Tiles** - Winter terrain and pine trees
- **Tiled Terrains** - Comprehensive terrain atlas with Tiled config
- **Unfinished Tileset** - Fantasy map elements (CC0)

### Object Assets (2 packs)
- **Containers** - Boxes, barrels, sacks, glassware, pottery
- **Wooden Boat** - 72x72 boat sprites (requires 7-Zip extraction)

### Animation & Weapon Assets (3 packs)
- **Push and Carry** - Special movement animations
- **Extended Weapon Animations** - Longsword, dagger, mace, rapier, etc.
- **Medieval Weapons** - Flail, halberd, war axe

## File Organization

- **Extracted folders** - Organized content from ZIP archives
- **Original archives** - Preserved .zip files for backup
- **Individual sprites** - Direct PNG files for single assets

## Key Files

### CREDITS.txt
Contains complete attribution and licensing information for all assets. **You must include this file or equivalent attribution in your game distribution.**

### MANIFEST.md
Comprehensive documentation including:
- Detailed asset descriptions
- File locations and contents
- Sprite dimensions and animation formats
- LÖVE2D integration examples
- Usage notes and tips

## Quick Integration (LÖVE2D)

### Disable Texture Filtering
```lua
-- In main.lua, before loading sprites
love.graphics.setDefaultFilter("nearest", "nearest")
```

### Loading Characters
```lua
local character = love.graphics.newImage("assets/sprites/lpc/characters/revised_basics/body/male/light.png")
local frameWidth, frameHeight = 64, 64
```

### Loading Tilesets
```lua
local tileset = love.graphics.newImage("assets/sprites/lpc/tilesets/stone_house_interior.png")
local tileSize = 32
```

### Standard LPC Frame Layout
Most character sprites follow this row layout:
- Row 0: Spellcast
- Row 1: Thrust
- Row 2: Walk
- Row 3: Slash
- Row 4: Shoot
- Row 5: Hurt

Each row has 4 direction groups: [Up, Left, Down, Right]

## Licensing

All assets are open source with various compatible licenses:
- **CC-BY 3.0/4.0** - Attribution required
- **CC-BY-SA 3.0/4.0** - Attribution + ShareAlike
- **GPL 2.0/3.0** - Copyleft, source available
- **OGA-BY 3.0** - OpenGameArt.org attribution
- **CC0** - Public domain

See CREDITS.txt for specific licensing per asset.

## Standard Sprite Sizes

| Type | Size | Notes |
|------|------|-------|
| Character | 64x64 | Per frame |
| Tile | 32x32 | Standard grid |
| Small Creature | 32x32, 48x64 | Chicken, piglet |
| Large Creature | 144x128, 191x161 | Dragons |
| Weapon Grid | 192x192 | Medieval weapons |

## Asset Status

### Successfully Downloaded & Extracted
- ✓ All 26 asset packs downloaded
- ✓ All ZIP archives extracted
- ✓ Files organized by category
- ⚠ wooden_boat.7z requires 7-Zip (not extracted)

### Archive Files Preserved
Original .zip files kept for backup in each category folder.

## Attribution Requirements

When publishing your game:
1. Include CREDITS.txt or equivalent attribution page
2. Credit original authors as listed
3. Link back to OpenGameArt.org pages
4. Comply with license terms (CC-BY, CC-BY-SA, GPL)

## Additional Resources

- **Full Documentation:** See MANIFEST.md for detailed integration guide
- **LPC Base:** https://opengameart.org/content/liberated-pixel-cup-0
- **LÖVE2D Wiki:** https://love2d.org/wiki/Main_Page
- **Tiled Editor:** https://www.mapeditor.org/

## Getting Started

1. **Read MANIFEST.md** for detailed asset information
2. **Check CREDITS.txt** for licensing requirements
3. **Browse extracted folders** to see available sprites
4. **Set texture filtering** to "nearest" in your LÖVE2D project
5. **Start with revised_basics/** for character creation
6. **Use terrain/** or **stone_house_interior.png** for environments

## Recommended First Assets to Use

### For Character Creation
- `characters/revised_basics/` - Most comprehensive system
- `animations/weapons_extended/` - Weapon animations
- `characters/folk/` - Character head variations

### For Environments
- `tilesets/terrain/` - Base terrain (grass, sand, water)
- `tilesets/stone_house_interior.png` - Interior rooms
- `tilesets/farm/` - Outdoor farm buildings

### For NPCs and Enemies
- `creatures/chicken.png`, `creatures/pigs/` - Farm animals
- `creatures/bird_*.png` - Ambient wildlife
- `creatures/reddragonfly*.png` - Flying boss enemy

### For Objects
- `objects/containers/` - Chests, barrels, crates
- `tilesets/PathAndObjects.png` - Town furniture and decorations

## Need Help?

- Check MANIFEST.md for detailed asset documentation
- Visit OpenGameArt.org for asset discussions
- Review CREDITS.txt for original asset links
- Check individual README files in extracted folders

---

**Compiled by:** Claude Code
**For:** LÖVE2D game development
**Date:** 2026-01-29

All assets from OpenGameArt.org under open licenses. See CREDITS.txt for complete attribution.
