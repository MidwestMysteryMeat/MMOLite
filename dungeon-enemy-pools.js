// dungeon-enemy-pools.js
// Enemy pools (per theme, shallow/mid/deep/boss) and floor layout types.
// Extracted from dungeon-data.js — dungeon-data.js re-exports all names for backward compatibility.

var FLOOR_LAYOUTS = {
  BSP_ROOMS: 'bsp_rooms',       // Standard rooms + L-corridors (castles, keeps)
  MAZE: 'maze',                 // Recursive backtracker maze (tight, winding)
  LAKE: 'lake',                 // Water-filled with walkway bridges
  OPEN_CAVERN: 'open_cavern',   // 1-2 huge rooms with pillar obstacles
  TEMPLE_HALLS: 'temple_halls', // Long parallel halls with cross-connections
  ARENA: 'arena',               // Large central room + surrounding chambers
  ISLAND: 'island',             // Scattered platforms connected by bridges
  ORGANIC: 'organic',           // Cellular automata natural cave shapes
  RAID_ARENA: 'raid_arena',     // Large central arena + waiting room + barrier + alcoves
  OCEAN_ARENA: 'ocean_arena',   // Ocean leviathan arena — spawn platform + open water + debris
};

var ENEMY_POOLS = {
  stone_keep: {
    shallow: [
      { id: 'sk_guard',    name: 'Keep Guard',              hp: 40,  atk: 8,  def: 5,  xp: 15, gold: 5  },
      { id: 'sk_rat',      name: 'Giant Rat',               hp: 20,  atk: 5,  def: 2,  xp: 8,  gold: 2  },
      { id: 'sk_skeleton', name: 'Skeleton Sentry',         hp: 30,  atk: 7,  def: 3,  xp: 12, gold: 4  },
      { id: 'sk_hollowed', name: 'Hollowed Wanderer',       hp: 25,  atk: 7,  def: 3,  xp: 10, gold: 4  },
    ],
    mid: [
      { id: 'sk_knight',   name: 'Fallen Knight',           hp: 70,  atk: 14, def: 10, xp: 30, gold: 12 },
      { id: 'sk_archer',   name: 'Ghost Archer',            hp: 50,  atk: 16, def: 6,  xp: 25, gold: 10, archetype: 'ranged', abilities: [{ id: 'spectral_arrow', name: 'Spectral Arrow', damage: 1.3, range: 5, windUp: 2, cooldown: 3, weight: 10, effect: 'chill', effectChance: 0.2 }] },
      { id: 'sk_hound',    name: 'War Hound',               hp: 45,  atk: 12, def: 5,  xp: 20, gold: 8  },
      { id: 'sk_maddened', name: 'Maddened Adventurer',      hp: 55,  atk: 15, def: 7,  xp: 24, gold: 10 },
    ],
    deep: [
      { id: 'sk_warden',   name: 'Dungeon Warden',          hp: 120, atk: 22, def: 15, xp: 55, gold: 25 },
      { id: 'sk_wraith',   name: 'Armored Wraith',          hp: 90,  atk: 25, def: 12, xp: 45, gold: 20 },
      { id: 'sk_golem',    name: 'Stone Golem',             hp: 160, atk: 18, def: 22, xp: 60, gold: 30 },
      { id: 'sk_lost',     name: 'Hollowed Lost Explorer',  hp: 100, atk: 24, def: 13, xp: 48, gold: 22 },
    ],
    boss: [
      { id: 'sk_lord',     name: 'The Iron Castellan', hp: 400, atk: 35, def: 25, xp: 200, gold: 100 },
    ],
  },
  crystal_cavern: {
    shallow: [
      { id: 'cc_shard',    name: 'Crystal Shard',             hp: 25,  atk: 10, def: 8,  xp: 12, gold: 6  },
      { id: 'cc_bat',      name: 'Gem Bat',                   hp: 18,  atk: 6,  def: 2,  xp: 8,  gold: 3  },
      { id: 'cc_crawler',  name: 'Cave Crawler',              hp: 30,  atk: 7,  def: 4,  xp: 10, gold: 4  },
      { id: 'cc_hollowed', name: 'Hollowed Crystal Miner',    hp: 22,  atk: 8,  def: 5,  xp: 10, gold: 5  },
    ],
    mid: [
      { id: 'cc_golem',    name: 'Crystal Golem',             hp: 80,  atk: 15, def: 14, xp: 35, gold: 15 },
      { id: 'cc_wisp',     name: 'Prismatic Wisp',            hp: 40,  atk: 20, def: 5,  xp: 28, gold: 12 },
      { id: 'cc_spider',   name: 'Gemback Spider',            hp: 55,  atk: 13, def: 8,  xp: 25, gold: 10 },
      { id: 'cc_maddened', name: 'Maddened Gem Seeker',       hp: 48,  atk: 17, def: 6,  xp: 24, gold: 11 },
    ],
    deep: [
      { id: 'cc_titan',    name: 'Crystal Titan',             hp: 150, atk: 24, def: 20, xp: 60, gold: 30 },
      { id: 'cc_worm',     name: 'Burrowing Geode',           hp: 110, atk: 28, def: 15, xp: 50, gold: 25 },
      { id: 'cc_mage',     name: 'Crystallomancer',           hp: 85,  atk: 30, def: 10, xp: 55, gold: 28, archetype: 'controller', abilities: [{ id: 'crystal_lance', name: 'Crystal Lance', damage: 1.4, range: 3, windUp: 2, cooldown: 4, weight: 10 }, { id: 'shatter_ward', name: 'Shatter Ward', damage: 0.6, range: 2, windUp: 2, cooldown: 6, weight: 8, effect: 'armor_break', effectChance: 0.5 }] },
    ],
    boss: [
      { id: 'cc_queen',    name: 'The Prismatic Queen', hp: 450, atk: 38, def: 28, xp: 220, gold: 120 },
    ],
  },
  fungal_forest: {
    shallow: [
      { id: 'ff_spore',    name: 'Spore Walker',     hp: 22,  atk: 6,  def: 3,  xp: 9,  gold: 3  },
      { id: 'ff_toad',     name: 'Toxic Toad',       hp: 28,  atk: 8,  def: 4,  xp: 11, gold: 4  },
      { id: 'ff_beetle',   name: 'Fungus Beetle',    hp: 20,  atk: 5,  def: 6,  xp: 8,  gold: 3  },
    ],
    mid: [
      { id: 'ff_treant',   name: 'Mycelium Treant',  hp: 85,  atk: 14, def: 12, xp: 32, gold: 14 },
      { id: 'ff_shambler', name: 'Rot Shambler',     hp: 60,  atk: 16, def: 7,  xp: 26, gold: 11 },
      { id: 'ff_wasp',     name: 'Bloat Wasp',       hp: 35,  atk: 18, def: 4,  xp: 22, gold: 9  },
    ],
    deep: [
      { id: 'ff_hydra',    name: 'Spore Hydra',      hp: 140, atk: 26, def: 16, xp: 58, gold: 28 },
      { id: 'ff_brain',    name: 'Hive Mind',        hp: 100, atk: 30, def: 12, xp: 52, gold: 24, archetype: 'support', abilities: [{ id: 'psychic_pulse', name: 'Psychic Pulse', damage: 0.9, range: 3, windUp: 2, cooldown: 4, weight: 8, effect: 'confusion', effectChance: 0.4 }, { id: 'spore_heal', name: 'Spore Mend', heals: true, healAmount: 20, range: 4, windUp: 2, cooldown: 5, weight: 12 }] },
      { id: 'ff_colossus', name: 'Fungal Colossus',  hp: 170, atk: 20, def: 22, xp: 65, gold: 32 },
    ],
    boss: [
      { id: 'ff_mother',   name: 'The Spore Mother', hp: 420, atk: 36, def: 24, xp: 210, gold: 110, abilities: [{ id: 'spore_slam', name: 'Spore Slam', damage: 1.5, range: 1, windUp: 2, cooldown: 4, weight: 10 }, { id: 'toxic_cloud', name: 'Toxic Cloud', damage: 0.8, range: 3, windUp: 2, cooldown: 5, weight: 8, effect: 'poison', effectChance: 0.6 }, { id: 'regenerate', name: 'Fungal Regeneration', heals: true, healAmount: 30, range: 0, windUp: 3, cooldown: 8, weight: 6 }], phases: [{ threshold: 0.6, name: 'Spore Bloom', atkMult: 1.3, abilities: [{ id: 'spore_burst', name: 'Spore Burst', damage: 1.6, range: 2, windUp: 2, cooldown: 4, weight: 12, effect: 'poison', effectChance: 0.7 }, { id: 'root_slam', name: 'Root Slam', damage: 2.0, range: 1, windUp: 3, cooldown: 5, weight: 10, effect: 'root', effectChance: 0.4 }], speed: 2 }, { threshold: 0.3, name: 'Final Bloom', atkMult: 1.6, abilities: [{ id: 'death_spore', name: 'Death Spore', damage: 2.2, range: 3, windUp: 3, cooldown: 5, weight: 14, effect: 'poison', effectChance: 0.8 }, { id: 'fungal_wrath', name: 'Fungal Wrath', damage: 1.8, range: 1, windUp: 2, cooldown: 3, weight: 10 }], detectionRadius: 8 }] },
    ],
  },
  lava_rift: {
    shallow: [
      { id: 'lr_imp',      name: 'Magma Imp',        hp: 24,  atk: 9,  def: 3,  xp: 10, gold: 4  },
      { id: 'lr_hound',    name: 'Cinder Hound',     hp: 30,  atk: 8,  def: 4,  xp: 12, gold: 5  },
      { id: 'lr_slug',     name: 'Lava Slug',        hp: 35,  atk: 6,  def: 7,  xp: 11, gold: 5  },
    ],
    mid: [
      { id: 'lr_elem',     name: 'Fire Elemental',   hp: 75,  atk: 20, def: 8,  xp: 34, gold: 16 },
      { id: 'lr_drake',    name: 'Magma Drake',      hp: 90,  atk: 17, def: 12, xp: 38, gold: 18 },
      { id: 'lr_golem',    name: 'Obsidian Golem',   hp: 100, atk: 14, def: 18, xp: 35, gold: 15 },
    ],
    deep: [
      { id: 'lr_wyrm',     name: 'Lava Wyrm',        hp: 160, atk: 28, def: 18, xp: 65, gold: 35 },
      { id: 'lr_demon',    name: 'Infernal Demon',   hp: 130, atk: 32, def: 14, xp: 58, gold: 30 },
      { id: 'lr_phoenix',  name: 'Ash Phoenix',      hp: 110, atk: 26, def: 16, xp: 55, gold: 28, archetype: 'ranged', abilities: [{ id: 'flame_bolt', name: 'Flame Bolt', damage: 1.3, range: 4, windUp: 2, cooldown: 3, weight: 10 }, { id: 'rebirth_flame', name: 'Rebirth Flame', heals: true, healAmount: 30, range: 0, windUp: 3, cooldown: 12, weight: 5 }] },
    ],
    boss: [
      { id: 'lr_titan',    name: 'Molten Titan',     hp: 500, atk: 42, def: 30, xp: 250, gold: 140 },
    ],
  },
  frozen_depths: {
    shallow: [
      { id: 'fd_wolf',     name: 'Frost Wolf',       hp: 28,  atk: 8,  def: 4,  xp: 10, gold: 4  },
      { id: 'fd_spirit',   name: 'Ice Spirit',       hp: 20,  atk: 10, def: 3,  xp: 9,  gold: 3  },
      { id: 'fd_yeti',     name: 'Snow Yeti',        hp: 40,  atk: 7,  def: 6,  xp: 13, gold: 5  },
    ],
    mid: [
      { id: 'fd_knight',   name: 'Frozen Knight',    hp: 80,  atk: 16, def: 14, xp: 35, gold: 16 },
      { id: 'fd_banshee',  name: 'Frost Banshee',    hp: 50,  atk: 22, def: 6,  xp: 30, gold: 13, archetype: 'ranged', abilities: [{ id: 'wail', name: 'Frost Wail', damage: 1.1, range: 4, windUp: 2, cooldown: 3, weight: 10, effect: 'fear', effectChance: 0.3 }] },
      { id: 'fd_bear',     name: 'Glacier Bear',     hp: 95,  atk: 15, def: 12, xp: 33, gold: 14 },
    ],
    deep: [
      { id: 'fd_dragon',   name: 'Ice Wyrm',         hp: 150, atk: 28, def: 20, xp: 62, gold: 32 },
      { id: 'fd_lich',     name: 'Frost Lich',       hp: 100, atk: 34, def: 14, xp: 58, gold: 28, archetype: 'controller', abilities: [{ id: 'frost_bolt', name: 'Frost Bolt', damage: 1.2, range: 4, windUp: 2, cooldown: 3, weight: 10 }, { id: 'blizzard', name: 'Blizzard', damage: 0.7, range: 3, windUp: 3, cooldown: 7, weight: 7, effect: 'slow', effectChance: 0.6 }] },
      { id: 'fd_colossus', name: 'Glacial Colossus', hp: 180, atk: 22, def: 24, xp: 68, gold: 35 },
    ],
    boss: [
      { id: 'fd_queen',    name: 'The Frost Empress', hp: 480, atk: 40, def: 30, xp: 240, gold: 130 },
    ],
  },
  flooded_ruins: {
    shallow: [
      { id: 'fr_fish',     name: 'Piranha Swarm',    hp: 18,  atk: 9,  def: 2,  xp: 8,  gold: 3  },
      { id: 'fr_crab',     name: 'Rust Crab',        hp: 30,  atk: 6,  def: 8,  xp: 10, gold: 4  },
      { id: 'fr_eel',      name: 'Electric Eel',     hp: 22,  atk: 11, def: 3,  xp: 9,  gold: 4  },
    ],
    mid: [
      { id: 'fr_naga',     name: 'Ruin Naga',        hp: 70,  atk: 18, def: 10, xp: 32, gold: 14 },
      { id: 'fr_golem',    name: 'Waterlogged Golem', hp: 90, atk: 13, def: 16, xp: 30, gold: 13 },
      { id: 'fr_shade',    name: 'Drowned Shade',    hp: 55,  atk: 20, def: 6,  xp: 28, gold: 12 },
    ],
    deep: [
      { id: 'fr_kraken',   name: 'Depth Kraken',     hp: 140, atk: 26, def: 18, xp: 60, gold: 30 },
      { id: 'fr_serpent',  name: 'Abyssal Serpent',  hp: 120, atk: 30, def: 14, xp: 55, gold: 28 },
      { id: 'fr_leviathan', name: 'Ruin Leviathan',  hp: 170, atk: 24, def: 22, xp: 65, gold: 34 },
    ],
    boss: [
      { id: 'fr_king',     name: 'The Drowned King', hp: 460, atk: 38, def: 28, xp: 230, gold: 125 },
    ],
  },
  bone_yard: {
    shallow: [
      { id: 'by_skeleton', name: 'Bone Walker',              hp: 25,  atk: 7,  def: 5,  xp: 9,  gold: 3  },
      { id: 'by_ghoul',    name: 'Grave Ghoul',              hp: 30,  atk: 9,  def: 4,  xp: 11, gold: 4  },
      { id: 'by_vulture',  name: 'Carrion Vulture',          hp: 18,  atk: 8,  def: 2,  xp: 8,  gold: 3  },
      { id: 'by_hollowed', name: 'Hollowed Grave Digger',    hp: 24,  atk: 8,  def: 3,  xp: 10, gold: 4  },
    ],
    mid: [
      { id: 'by_revenant', name: 'Bone Revenant',            hp: 75,  atk: 16, def: 12, xp: 32, gold: 14 },
      { id: 'by_wraith',   name: 'Death Wraith',             hp: 55,  atk: 22, def: 6,  xp: 28, gold: 12 },
      { id: 'by_horror',   name: 'Flesh Horror',             hp: 90,  atk: 14, def: 14, xp: 34, gold: 15 },
      { id: 'by_maddened', name: 'Maddened Bone Collector',  hp: 60,  atk: 17, def: 9,  xp: 26, gold: 11 },
    ],
    deep: [
      { id: 'by_lich',     name: 'Bone Lich',                hp: 110, atk: 30, def: 14, xp: 55, gold: 28 },
      { id: 'by_dragon',   name: 'Skeletal Dragon',          hp: 160, atk: 26, def: 20, xp: 65, gold: 34 },
      { id: 'by_titan',    name: 'Ossuary Titan',            hp: 140, atk: 24, def: 22, xp: 60, gold: 30 },
    ],
    boss: [
      { id: 'by_lord',     name: 'The Bone Sovereign', hp: 440, atk: 36, def: 26, xp: 220, gold: 115 },
    ],
  },
  shadow_realm: {
    shallow: [
      { id: 'sr_shade',    name: 'Shadow Wisp',              hp: 18,  atk: 10, def: 2,  xp: 9,  gold: 4  },
      { id: 'sr_hound',    name: 'Void Hound',               hp: 28,  atk: 8,  def: 5,  xp: 11, gold: 4  },
      { id: 'sr_eye',      name: 'Floating Eye',             hp: 15,  atk: 12, def: 1,  xp: 10, gold: 5  },
      { id: 'sr_hollowed', name: 'Hollowed Shadow-Touched',  hp: 22,  atk: 9,  def: 3,  xp: 10, gold: 5  },
    ],
    mid: [
      { id: 'sr_stalker',  name: 'Shadow Stalker',           hp: 60,  atk: 22, def: 8,  xp: 34, gold: 16 },
      { id: 'sr_phantom',  name: 'Nightmare Phantom',        hp: 50,  atk: 24, def: 5,  xp: 30, gold: 14 },
      { id: 'sr_knight',   name: 'Dark Knight',              hp: 80,  atk: 18, def: 14, xp: 36, gold: 16 },
      { id: 'sr_maddened', name: 'Maddened Void-Walker',     hp: 65,  atk: 20, def: 7,  xp: 30, gold: 13 },
    ],
    deep: [
      { id: 'sr_fiend',    name: 'Void Fiend',               hp: 120, atk: 32, def: 14, xp: 60, gold: 32 },
      { id: 'sr_horror',   name: 'Eldritch Horror',          hp: 140, atk: 28, def: 18, xp: 58, gold: 30 },
      { id: 'sr_weaver',   name: 'Shadow Weaver',            hp: 100, atk: 34, def: 12, xp: 55, gold: 28, archetype: 'controller', abilities: [{ id: 'shadow_bolt', name: 'Shadow Bolt', damage: 1.3, range: 4, windUp: 2, cooldown: 3, weight: 10 }, { id: 'void_snare', name: 'Void Snare', damage: 0.5, range: 3, windUp: 2, cooldown: 6, weight: 8, effect: 'root', effectChance: 0.5 }] },
      { id: 'sr_consumed', name: 'Hollowed Consumed One',    hp: 115, atk: 30, def: 15, xp: 56, gold: 29 },
    ],
    boss: [
      { id: 'sr_lord',     name: 'The Void Harbinger', hp: 500, atk: 44, def: 30, xp: 260, gold: 150, abilities: [{ id: 'void_cleave', name: 'Void Cleave', damage: 1.8, range: 1, windUp: 2, cooldown: 4, weight: 10 }, { id: 'shadow_nova', name: 'Shadow Nova', damage: 1.2, range: 3, windUp: 3, cooldown: 6, weight: 8, effect: 'blind', effectChance: 0.5 }, { id: 'consume', name: 'Consume Reality', damage: 2.5, range: 1, windUp: 4, cooldown: 10, weight: 5, effect: 'doom', effectChance: 0.3 }], phases: [{ threshold: 0.6, name: 'Void Rift', atkMult: 1.3, abilities: [{ id: 'rift_tear', name: 'Rift Tear', damage: 2.0, range: 2, windUp: 2, cooldown: 4, weight: 12 }, { id: 'shadow_nova', name: 'Shadow Nova', damage: 1.2, range: 3, windUp: 3, cooldown: 5, weight: 10, effect: 'blind', effectChance: 0.6 }], speed: 2 }, { threshold: 0.3, name: 'Unmaking', atkMult: 1.8, abilities: [{ id: 'unmake', name: 'Unmake', damage: 3.0, range: 1, windUp: 3, cooldown: 5, weight: 14 }, { id: 'void_collapse', name: 'Void Collapse', damage: 1.5, range: 4, windUp: 4, cooldown: 6, weight: 10, effect: 'slow', effectChance: 0.8 }], detectionRadius: 10 }] },
    ],
  },
  overgrown_temple: {
    shallow: [
      { id: 'ot_vine',     name: 'Vine Creeper',     hp: 25,  atk: 7,  def: 5,  xp: 9,  gold: 3  },
      { id: 'ot_golem',    name: 'Moss Golem',       hp: 35,  atk: 6,  def: 8,  xp: 12, gold: 5  },
      { id: 'ot_snake',    name: 'Temple Viper',     hp: 18,  atk: 10, def: 2,  xp: 8,  gold: 3  },
    ],
    mid: [
      { id: 'ot_guardian', name: 'Stone Guardian',   hp: 85,  atk: 15, def: 16, xp: 35, gold: 15 },
      { id: 'ot_druid',    name: 'Wild Druid',       hp: 55,  atk: 20, def: 8,  xp: 30, gold: 13 },
      { id: 'ot_ape',      name: 'Temple Ape',       hp: 70,  atk: 17, def: 10, xp: 28, gold: 12 },
    ],
    deep: [
      { id: 'ot_hydra',    name: 'Vine Hydra',       hp: 140, atk: 26, def: 18, xp: 60, gold: 30 },
      { id: 'ot_titan',    name: 'Overgrown Titan',  hp: 160, atk: 22, def: 22, xp: 65, gold: 34 },
      { id: 'ot_spirit',   name: 'Ancient Spirit',   hp: 100, atk: 32, def: 12, xp: 55, gold: 28 },
    ],
    boss: [
      { id: 'ot_avatar',   name: 'Avatar of the Wild', hp: 460, atk: 38, def: 28, xp: 230, gold: 125 },
    ],
  },
  sand_tomb: {
    shallow: [
      { id: 'st_scarab',   name: 'Sand Scarab',      hp: 20,  atk: 7,  def: 4,  xp: 8,  gold: 3  },
      { id: 'st_mummy',    name: 'Tomb Mummy',       hp: 32,  atk: 8,  def: 6,  xp: 12, gold: 5  },
      { id: 'st_snake',    name: 'Dust Asp',         hp: 16,  atk: 10, def: 2,  xp: 9,  gold: 4  },
    ],
    mid: [
      { id: 'st_priest',   name: 'Sand Priest',      hp: 60,  atk: 20, def: 8,  xp: 32, gold: 14 },
      { id: 'st_golem',    name: 'Sandstone Golem',  hp: 90,  atk: 14, def: 16, xp: 35, gold: 15 },
      { id: 'st_jackal',   name: 'Anubis Jackal',    hp: 55,  atk: 18, def: 10, xp: 30, gold: 13 },
    ],
    deep: [
      { id: 'st_sphinx',   name: 'Tomb Sphinx',      hp: 130, atk: 28, def: 18, xp: 60, gold: 32 },
      { id: 'st_pharaoh',  name: 'Cursed Pharaoh',   hp: 120, atk: 32, def: 14, xp: 58, gold: 30 },
      { id: 'st_worm',     name: 'Sand Worm',        hp: 160, atk: 24, def: 20, xp: 65, gold: 34 },
    ],
    boss: [
      { id: 'st_king',     name: 'The Eternal Pharaoh', hp: 470, atk: 40, def: 28, xp: 240, gold: 130 },
    ],
  },
};

// ---------------------------------------------------------------------------
// NEW THEMES (12 additions)
// ---------------------------------------------------------------------------

// --- 1. iron_forge ---
// Castle category: the industrial underbelly of a great keep.
// Biomes: Mountain (2), Mechspire (10), Clockwork Harbor (11)
// Layout: ARENA — open central forge pit, surrounding catwalks
ENEMY_POOLS.iron_forge = {
  shallow: [
    { id: 'if_hollowed',   name: 'Hollowed Dwarf Smith',    hp: 28, atk: 8,  def: 5,  xp: 11, gold: 5  },
    { id: 'if_slag',       name: 'Slag Crawler',            hp: 30, atk: 6,  def: 5,  xp: 10, gold: 3  },
    { id: 'if_maddened',   name: 'Maddened Dwarf Miner',    hp: 24, atk: 9,  def: 3,  xp: 10, gold: 4  },
    { id: 'if_bellows',    name: 'Bellows Imp',             hp: 18, atk: 8,  def: 2,  xp: 9,  gold: 4  },
  ],
  mid: [
    { id: 'if_forgebound', name: 'Forgebound Dwarf',        hp: 80, atk: 16, def: 14, xp: 36, gold: 16 },
    { id: 'if_automaton',  name: 'Furnace Automaton',       hp: 75, atk: 15, def: 13, xp: 34, gold: 15 },
    { id: 'if_smelter',    name: 'Hollowed Smelter',        hp: 65, atk: 18, def: 9,  xp: 30, gold: 13 },
    { id: 'if_golem',      name: 'Slag Golem',              hp: 90, atk: 13, def: 17, xp: 34, gold: 15 },
  ],
  deep: [
    { id: 'if_juggernaut', name: 'Hollowed Juggernaut',     hp: 160, atk: 24, def: 22, xp: 65, gold: 34 },
    { id: 'if_berserker',  name: 'Maddened Forge-Lord',     hp: 130, atk: 28, def: 16, xp: 58, gold: 29 },
    { id: 'if_fiend',      name: 'Molten Fiend',            hp: 110, atk: 32, def: 12, xp: 55, gold: 27 },
  ],
  boss: [
    { id: 'if_overlord',   name: 'The Hollowed Grand Smelter', hp: 480, atk: 42, def: 32, xp: 245, gold: 135 },
  ],
};

// --- 2. haunted_manor ---
// Castle category: a cursed noble estate where the dead still dine.
// Biomes: Plains (6), Holy Dominion (8), Swamp (7)
// Layout: BSP_ROOMS — interconnected manor rooms and servant passages
ENEMY_POOLS.haunted_manor = {
  shallow: [
    { id: 'hm_hollowed',    name: 'Hollowed Human Servant',  hp: 22, atk: 8,  def: 3,  xp: 10, gold: 5  },
    { id: 'hm_poltergeist', name: 'Poltergeist',             hp: 20, atk: 9,  def: 2,  xp: 10, gold: 5  },
    { id: 'hm_maddened',    name: 'Maddened Noble',          hp: 26, atk: 7,  def: 4,  xp: 9,  gold: 5  },
    { id: 'hm_rat',         name: 'Cursed Familiar',         hp: 15, atk: 8,  def: 1,  xp: 8,  gold: 3  },
  ],
  mid: [
    { id: 'hm_specter',     name: 'Hollowed Human Specter',  hp: 55, atk: 22, def: 6,  xp: 30, gold: 13 },
    { id: 'hm_butler',      name: 'Maddened Butler',         hp: 70, atk: 16, def: 11, xp: 32, gold: 14 },
    { id: 'hm_hound',       name: 'Phantom Hound',           hp: 50, atk: 20, def: 7,  xp: 28, gold: 12 },
  ],
  deep: [
    { id: 'hm_countess',    name: 'The Hollowed Countess',   hp: 120, atk: 30, def: 14, xp: 58, gold: 30 },
    { id: 'hm_revenant',    name: 'Maddened Noble Revenant',  hp: 140, atk: 26, def: 18, xp: 62, gold: 32 },
    { id: 'hm_amalgam',     name: 'Grief Amalgam',           hp: 105, atk: 28, def: 13, xp: 55, gold: 27 },
  ],
  boss: [
    { id: 'hm_patriarch',   name: 'Lord Varek the Hollowed', hp: 440, atk: 38, def: 26, xp: 225, gold: 120 },
  ],
};

// --- 3. tidal_vault ---
// Wild category: a sea-god's drowned treasury sealed beneath tidal pressure.
// Biomes: Water (0), Beach (13), Gnomish Isles (9)
// Layout: LAKE — flooded central chamber, raised stone platforms around it
ENEMY_POOLS.tidal_vault = {
  shallow: [
    { id: 'tv_hollowed',    name: 'Hollowed Lizardfolk Diver', hp: 24, atk: 8,  def: 4,  xp: 10, gold: 4  },
    { id: 'tv_barnacle',    name: 'Barnacle Scraper',          hp: 22, atk: 7,  def: 5,  xp: 9,  gold: 3  },
    { id: 'tv_eel',         name: 'Saltfang Eel',              hp: 18, atk: 10, def: 2,  xp: 9,  gold: 4  },
    { id: 'tv_crab',        name: 'Tidal Crab',                hp: 28, atk: 6,  def: 7,  xp: 10, gold: 4  },
  ],
  mid: [
    { id: 'tv_siren',       name: 'Vault Siren',               hp: 55, atk: 22, def: 6,  xp: 30, gold: 14, archetype: 'support', abilities: [{ id: 'siren_song', name: 'Siren Song', damage: 0.9, range: 3, windUp: 2, cooldown: 4, weight: 8, effect: 'confusion', effectChance: 0.4 }, { id: 'tidal_mend', name: 'Tidal Mend', heals: true, healAmount: 18, range: 4, windUp: 2, cooldown: 5, weight: 12 }] },
    { id: 'tv_maddened',    name: 'Maddened Lizardfolk Shaman', hp: 60, atk: 20, def: 8,  xp: 31, gold: 14 },
    { id: 'tv_guardian',    name: 'Tide Guardian',              hp: 80, atk: 14, def: 16, xp: 34, gold: 15 },
    { id: 'tv_shark',       name: 'Bronze Shark',               hp: 65, atk: 19, def: 10, xp: 31, gold: 13 },
  ],
  deep: [
    { id: 'tv_warden',      name: 'Hollowed Abyssal Warden',   hp: 140, atk: 26, def: 20, xp: 62, gold: 32 },
    { id: 'tv_colossus',    name: 'Tidal Colossus',             hp: 170, atk: 22, def: 24, xp: 66, gold: 35 },
    { id: 'tv_leviathan',   name: 'Maddened Vault Leviathan',   hp: 150, atk: 30, def: 16, xp: 60, gold: 30 },
  ],
  boss: [
    { id: 'tv_kraken',      name: 'The Hollowed Tidebound Kraken', hp: 500, atk: 40, def: 30, xp: 255, gold: 145 },
  ],
};

// --- 4. plague_warren ---
// Wild category: a labyrinthine network of rat tunnels bloated with disease.
// Biomes: Swamp (7), Forest (5), Wastes (12)
// Layout: MAZE — twisting narrow passages, dead ends, ooze-flooded corridors
ENEMY_POOLS.plague_warren = {
  shallow: [
    { id: 'pw_rat',         name: 'Plague Rat',        hp: 18, atk: 6,  def: 2,  xp: 8,  gold: 3  },
    { id: 'pw_maggot',      name: 'Bloat Maggot',      hp: 24, atk: 5,  def: 4,  xp: 8,  gold: 2  },
    { id: 'pw_roach',       name: 'Bile Roach',        hp: 16, atk: 8,  def: 3,  xp: 8,  gold: 3  },
  ],
  mid: [
    { id: 'pw_carrier',     name: 'Plague Carrier',    hp: 60, atk: 16, def: 8,  xp: 28, gold: 11 },
    { id: 'pw_brute',       name: 'Infected Brute',    hp: 80, atk: 18, def: 12, xp: 34, gold: 14 },
    { id: 'pw_crawler',     name: 'Ooze Crawler',      hp: 45, atk: 20, def: 5,  xp: 26, gold: 10 },
  ],
  deep: [
    { id: 'pw_behemoth',    name: 'Plague Behemoth',   hp: 155, atk: 26, def: 18, xp: 62, gold: 30 },
    { id: 'pw_queen',       name: 'Vermin Queen',      hp: 130, atk: 28, def: 14, xp: 56, gold: 27 },
    { id: 'pw_blight',      name: 'Blight Horror',     hp: 110, atk: 30, def: 10, xp: 54, gold: 26 },
  ],
  boss: [
    { id: 'pw_father',      name: 'Father Pestilence', hp: 450, atk: 36, def: 24, xp: 230, gold: 120 },
  ],
};

// --- 5. elven_reliquary ---
// Wild category: a sealed vault of ancient elven artifacts, locked by forgotten wards.
// Biomes: Elven South (16), Forest (5)
// Layout: TEMPLE_HALLS — long symmetrical corridors, warded alcoves, inner sanctum
ENEMY_POOLS.elven_reliquary = {
  shallow: [
    { id: 'er_hollowed',    name: 'Hollowed Elf Acolyte',    hp: 22, atk: 10, def: 4,  xp: 11, gold: 5  },
    { id: 'er_ward',        name: 'Arcane Ward',             hp: 20, atk: 9,  def: 6,  xp: 10, gold: 4  },
    { id: 'er_maddened',    name: 'Maddened Elf Warden',     hp: 26, atk: 8,  def: 5,  xp: 10, gold: 4  },
    { id: 'er_sprite',      name: 'Forest Sprite',           hp: 16, atk: 8,  def: 3,  xp: 9,  gold: 4  },
  ],
  mid: [
    { id: 'er_archivist',   name: 'Hollowed Archivist',      hp: 50, atk: 22, def: 7,  xp: 32, gold: 14 },
    { id: 'er_golem',       name: 'Willow Golem',            hp: 85, atk: 15, def: 15, xp: 36, gold: 16 },
    { id: 'er_wraith',      name: 'Maddened Elf Blademaster', hp: 68, atk: 20, def: 9,  xp: 30, gold: 13 },
    { id: 'er_sentinel',    name: 'Deranged Rune Sentinel',  hp: 30, atk: 12, def: 10, xp: 25, gold: 11 },
  ],
  deep: [
    { id: 'er_corrupted',   name: 'Corrupted Elf Sorcerer',  hp: 100, atk: 34, def: 12, xp: 58, gold: 29 },
    { id: 'er_lich',        name: 'Hollowed Elven Lich',     hp: 120, atk: 32, def: 14, xp: 60, gold: 32 },
    { id: 'er_construct',   name: 'Relic Construct',         hp: 155, atk: 22, def: 22, xp: 64, gold: 33 },
  ],
  boss: [
    { id: 'er_keeper',      name: 'The Hollowed Eternal Keeper', hp: 460, atk: 40, def: 28, xp: 240, gold: 130 },
  ],
};

// --- 6. gnomish_workshop ---
// Wild category: an abandoned gnomish research facility where the experiments still run.
// Biomes: Gnomish Isles (9), Mechspire (10), Clockwork Harbor (11)
// Layout: MAZE — interlocking lab cells, steam vents, conveyor corridors
ENEMY_POOLS.gnomish_workshop = {
  shallow: [
    { id: 'gw_hollowed',    name: 'Hollowed Gnome Tinker',   hp: 20, atk: 8,  def: 3,  xp: 10, gold: 5  },
    { id: 'gw_sprocket',    name: 'Rogue Sprocket',          hp: 20, atk: 7,  def: 4,  xp: 9,  gold: 4  },
    { id: 'gw_drone',       name: 'Malfunction Drone',       hp: 18, atk: 9,  def: 3,  xp: 9,  gold: 4  },
    { id: 'gw_maddened',    name: 'Maddened Gnome Laborer',  hp: 16, atk: 9,  def: 2,  xp: 9,  gold: 4  },
  ],
  mid: [
    { id: 'gw_mk2',         name: 'Combat Mk.II',            hp: 70, atk: 17, def: 12, xp: 34, gold: 15 },
    { id: 'gw_alchemist',   name: 'Hollowed Gnome Alchemist', hp: 55, atk: 20, def: 8,  xp: 30, gold: 13 },
    { id: 'gw_colossus',    name: 'Scrap Colossus',          hp: 90, atk: 14, def: 16, xp: 35, gold: 15 },
    { id: 'gw_crazed',      name: 'Crazed Gnome Engineer',   hp: 48, atk: 22, def: 6,  xp: 28, gold: 12 },
  ],
  deep: [
    { id: 'gw_failsafe',    name: 'Project Failsafe',        hp: 145, atk: 28, def: 18, xp: 62, gold: 31 },
    { id: 'gw_siege',       name: 'Siege Engine',            hp: 170, atk: 22, def: 24, xp: 66, gold: 34 },
    { id: 'gw_experiment',  name: 'Hollowed Gnome Abomination', hp: 110, atk: 32, def: 12, xp: 58, gold: 29 },
  ],
  boss: [
    { id: 'gw_director',    name: 'The Hollowed Director Zero', hp: 490, atk: 42, def: 30, xp: 250, gold: 140 },
  ],
};

// --- 7. orc_barrow ---
// Wild category: a sacred orcish burial mound where fallen warlords refuse to sleep.
// Biomes: Steppes (4), Plains (6), Desert (1)
// Layout: OPEN_CAVERN — wide rough-cut chambers, open central barrow pit
ENEMY_POOLS.orc_barrow = {
  shallow: [
    { id: 'ob_hollowed',    name: 'Hollowed Orc Warrior',    hp: 30, atk: 9,  def: 4,  xp: 11, gold: 4  },
    { id: 'ob_shade',       name: 'Barrow Shade',            hp: 28, atk: 8,  def: 4,  xp: 10, gold: 3  },
    { id: 'ob_maddened',    name: 'Maddened Orc Berserker',  hp: 26, atk: 10, def: 2,  xp: 10, gold: 4  },
    { id: 'ob_whelp',       name: 'Dire Whelp',              hp: 24, atk: 7,  def: 3,  xp: 9,  gold: 3  },
  ],
  mid: [
    { id: 'ob_reaver',      name: 'Hollowed Orc Reaver',     hp: 80, atk: 18, def: 11, xp: 35, gold: 15 },
    { id: 'ob_shaman',      name: 'Maddened Orc Shaman',     hp: 55, atk: 22, def: 7,  xp: 31, gold: 13 },
    { id: 'ob_champion',    name: 'Pale Champion',           hp: 85, atk: 16, def: 14, xp: 36, gold: 16 },
    { id: 'ob_skull',       name: 'Warrior Skull Swarm',     hp: 40, atk: 14, def: 5,  xp: 22, gold: 10 },
  ],
  deep: [
    { id: 'ob_warchief',    name: 'Hollowed Orc Warchief',   hp: 150, atk: 28, def: 18, xp: 64, gold: 33 },
    { id: 'ob_titan',       name: 'Burial Titan',            hp: 165, atk: 24, def: 22, xp: 66, gold: 34 },
    { id: 'ob_soulrender',  name: 'Maddened Soul Render',    hp: 115, atk: 30, def: 14, xp: 57, gold: 28 },
  ],
  boss: [
    { id: 'ob_warlord',     name: "Warlord Grukk the Hollowed", hp: 465, atk: 40, def: 28, xp: 238, gold: 128 },
  ],
};

// --- 8. mirage_palace ---
// Wild category: a desert illusionist's palace that shifts and deceives.
// Biomes: Desert (1), Scorched Sands (3)
// Layout: ISLAND — rooms connected by sand-bridges that can vanish
ENEMY_POOLS.mirage_palace = {
  shallow: [
    { id: 'mp_hollowed',    name: 'Hollowed Cat Folk Nomad',  hp: 18, atk: 10, def: 2,  xp: 10, gold: 5  },
    { id: 'mp_illusion',    name: 'Sand Illusion',            hp: 16, atk: 10, def: 2,  xp: 10, gold: 5  },
    { id: 'mp_djinn',       name: 'Sand Djinn',               hp: 22, atk: 9,  def: 3,  xp: 10, gold: 5  },
    { id: 'mp_viper',       name: 'Mirage Viper',             hp: 18, atk: 8,  def: 2,  xp: 9,  gold: 4  },
  ],
  mid: [
    { id: 'mp_sphinx',      name: 'Riddle Sphinx',            hp: 70, atk: 18, def: 10, xp: 34, gold: 15 },
    { id: 'mp_maddened',    name: 'Maddened Cat Folk Dancer',  hp: 50, atk: 24, def: 6,  xp: 31, gold: 14 },
    { id: 'mp_golem',       name: 'Glass Golem',              hp: 85, atk: 14, def: 16, xp: 35, gold: 15 },
  ],
  deep: [
    { id: 'mp_sultan',      name: 'Hollowed Miragesultan',    hp: 120, atk: 30, def: 14, xp: 58, gold: 29 },
    { id: 'mp_sandwyrm',    name: 'Palace Sand Wyrm',         hp: 155, atk: 26, def: 20, xp: 64, gold: 33 },
    { id: 'mp_vizier',      name: 'Maddened Undying Vizier',   hp: 105, atk: 32, def: 11, xp: 56, gold: 27 },
  ],
  boss: [
    { id: 'mp_caliph',      name: 'The Hollowed Eternal Caliph', hp: 455, atk: 38, def: 26, xp: 235, gold: 125 },
  ],
};

// --- 9. frost_citadel ---
// Wild category: a fortress carved into a glacier by ancient beings, now locked in eternal winter.
// Biomes: Frostbound (14)
// Layout: BSP_ROOMS — carved ice-block rooms, frozen-over archways
ENEMY_POOLS.frost_citadel = {
  shallow: [
    { id: 'fc_hollowed',    name: 'Hollowed Frost Dweller',  hp: 24, atk: 9,  def: 4,  xp: 10, gold: 4  },
    { id: 'fc_sprite',      name: 'Frost Sprite',            hp: 18, atk: 9,  def: 4,  xp: 9,  gold: 4  },
    { id: 'fc_hound',       name: 'Glacial Hound',           hp: 28, atk: 7,  def: 5,  xp: 10, gold: 4  },
    { id: 'fc_maddened',    name: 'Maddened Frozen One',     hp: 20, atk: 11, def: 3,  xp: 10, gold: 5  },
  ],
  mid: [
    { id: 'fc_knight',      name: 'Hollowed Ice Knight',     hp: 80, atk: 16, def: 14, xp: 35, gold: 16 },
    { id: 'fc_warden',      name: 'Maddened Citadel Warden', hp: 90, atk: 14, def: 16, xp: 36, gold: 16 },
    { id: 'fc_mage',        name: 'Glacier Mage',            hp: 52, atk: 22, def: 7,  xp: 31, gold: 14 },
  ],
  deep: [
    { id: 'fc_titan',       name: 'Frost Titan',             hp: 170, atk: 24, def: 24, xp: 68, gold: 35 },
    { id: 'fc_lich',        name: 'Hollowed Permafrost Lich', hp: 110, atk: 34, def: 14, xp: 60, gold: 30 },
    { id: 'fc_wyrm',        name: 'Blizzard Wyrm',           hp: 150, atk: 28, def: 20, xp: 63, gold: 32 },
  ],
  boss: [
    { id: 'fc_sovereign',   name: 'The Hollowed Winter Sovereign', hp: 510, atk: 42, def: 32, xp: 260, gold: 150 },
  ],
};

// --- 10. goblin_warrens ---
// Wild category: a chaotic, trap-dense sprawl built by generations of goblin clans.
// Biomes: Forest (5), Swamp (7), Wastes (12)
// Layout: MAZE — cramped tunnels, rigged corridors, ambush pits
ENEMY_POOLS.goblin_warrens = {
  shallow: [
    { id: 'gv_hollowed',    name: 'Hollowed Goblin Grunt',   hp: 20, atk: 8,  def: 2,  xp: 9,  gold: 4  },
    { id: 'gv_trapper',     name: 'Pit Trapper',             hp: 18, atk: 6,  def: 3,  xp: 8,  gold: 5  },
    { id: 'gv_maddened',    name: 'Maddened Goblin Scrapper', hp: 16, atk: 9,  def: 1,  xp: 9,  gold: 4  },
    { id: 'gv_rat',         name: 'Warren Rat',              hp: 14, atk: 5,  def: 1,  xp: 6,  gold: 3  },
  ],
  mid: [
    { id: 'gv_warboss',     name: 'Hollowed Goblin Warboss', hp: 80, atk: 18, def: 10, xp: 34, gold: 16 },
    { id: 'gv_shaman',      name: 'Maddened Hex Shaman',     hp: 50, atk: 22, def: 6,  xp: 30, gold: 14 },
    { id: 'gv_brawler',     name: 'Cave Brawler',            hp: 70, atk: 16, def: 12, xp: 32, gold: 14 },
    { id: 'gv_crazed',      name: 'Crazed Goblin Bomber',    hp: 35, atk: 25, def: 3,  xp: 26, gold: 12 },
  ],
  deep: [
    { id: 'gv_king',        name: 'Hollowed Goblin King',    hp: 140, atk: 28, def: 16, xp: 60, gold: 31 },
    { id: 'gv_beast',       name: 'Tamed Cave Beast',        hp: 160, atk: 24, def: 20, xp: 64, gold: 33 },
    { id: 'gv_tinker',      name: 'Maddened Master Tinker',  hp: 100, atk: 32, def: 10, xp: 57, gold: 28 },
  ],
  boss: [
    { id: 'gv_overlord',    name: "Skrix the Hollowed Warchief", hp: 430, atk: 36, def: 22, xp: 220, gold: 115 },
  ],
};

// --- 11. ashen_observatory ---
// Wild category: a mountaintop observatory consumed by volcanic eruption, now haunted.
// Biomes: Mountain (2), Scorched Sands (3), Wastes (12)
// Layout: OPEN_CAVERN — shattered dome, exposed sky-shafts, ash-drifted floors
ENEMY_POOLS.ashen_observatory = {
  shallow: [
    { id: 'ao_ashfiend',    name: 'Ash Fiend',         hp: 24, atk: 9,  def: 3,  xp: 10, gold: 4  },
    { id: 'ao_cinder',      name: 'Cinder Wisp',       hp: 16, atk: 11, def: 1,  xp: 10, gold: 5  },
    { id: 'ao_vulture',     name: 'Ember Vulture',     hp: 20, atk: 8,  def: 2,  xp: 9,  gold: 4  },
  ],
  mid: [
    { id: 'ao_stargazer',   name: 'Burned Stargazer',  hp: 55, atk: 22, def: 7,  xp: 31, gold: 14 },
    { id: 'ao_drake',       name: 'Ash Drake',         hp: 80, atk: 17, def: 13, xp: 36, gold: 16 },
    { id: 'ao_golem',       name: 'Cinder Golem',      hp: 90, atk: 14, def: 17, xp: 35, gold: 15 },
  ],
  deep: [
    { id: 'ao_phoenix',     name: 'Ruined Phoenix',    hp: 120, atk: 30, def: 14, xp: 58, gold: 29 },
    { id: 'ao_titan',       name: 'Obsidian Titan',    hp: 160, atk: 26, def: 22, xp: 66, gold: 34 },
    { id: 'ao_herald',      name: 'Caldera Herald',    hp: 130, atk: 28, def: 16, xp: 60, gold: 30 },
  ],
  boss: [
    { id: 'ao_watcher',     name: 'The Ashen Watcher', hp: 475, atk: 40, def: 28, xp: 242, gold: 132 },
  ],
};

// --- 12. sunken_cathedral ---
// Wild category: a holy cathedral swallowed by the earth in an ancient catastrophe.
// Biomes: Holy Dominion (8), Swamp (7), Water (0)
// Layout: TEMPLE_HALLS — grand nave, flooded transepts, collapsed bell towers
ENEMY_POOLS.sunken_cathedral = {
  shallow: [
    { id: 'sc_zealot',      name: 'Drowned Zealot',    hp: 26, atk: 8,  def: 4,  xp: 10, gold: 4  },
    { id: 'sc_wraith',      name: 'Penitent Wraith',   hp: 18, atk: 10, def: 2,  xp: 9,  gold: 4  },
    { id: 'sc_gargoyle',    name: 'Stone Gargoyle',    hp: 32, atk: 7,  def: 7,  xp: 11, gold: 4  },
  ],
  mid: [
    { id: 'sc_inquisitor',  name: 'Fallen Inquisitor', hp: 75, atk: 18, def: 12, xp: 36, gold: 16 },
    { id: 'sc_seraph',      name: 'Corrupted Seraph',  hp: 55, atk: 22, def: 8,  xp: 32, gold: 14 },
    { id: 'sc_effigy',      name: 'Stone Effigy',      hp: 90, atk: 14, def: 16, xp: 35, gold: 15 },
  ],
  deep: [
    { id: 'sc_heretic',     name: 'High Heretic',      hp: 125, atk: 30, def: 14, xp: 58, gold: 29 },
    { id: 'sc_bishop',      name: 'Undead Bishop',     hp: 105, atk: 28, def: 13, xp: 55, gold: 27 },
    { id: 'sc_cardinal',    name: 'Void Cardinal',     hp: 145, atk: 26, def: 18, xp: 63, gold: 32 },
  ],
  boss: [
    { id: 'sc_archbishop',  name: 'The Forsaken Archbishop', hp: 470, atk: 40, def: 28, xp: 242, gold: 132 },
  ],
};

// --- 13. puzzle_labyrinth ---
// Wild category: a floor designed by something intelligent and cruel. Shifting walls,
// pressure plates, logic gates made of stone. The trapped builders went mad trying
// to solve their own creation. Conceptually the most trap-dense theme.
// Biomes: Holy Dominion (8), Gnomish Isles (9), Mountain (2)
// Layout: MAZE — shifting corridors, dead-end chambers, rune-locked gates
ENEMY_POOLS.puzzle_labyrinth = {
  shallow: [
    { id: 'pl_hollowed',    name: 'Hollowed Puzzle Scholar',   hp: 22, atk: 8,  def: 4,  xp: 10, gold: 5  },
    { id: 'pl_sentinel',    name: 'Stone Sentinel',            hp: 32, atk: 7,  def: 7,  xp: 12, gold: 4  },
    { id: 'pl_mimic',       name: 'Tile Mimic',                hp: 26, atk: 10, def: 3,  xp: 11, gold: 5  },
    { id: 'pl_maddened',    name: 'Maddened Maze Runner',      hp: 20, atk: 9,  def: 2,  xp: 9,  gold: 4  },
  ],
  mid: [
    { id: 'pl_construct',   name: 'Rune Construct',            hp: 85, atk: 15, def: 14, xp: 35, gold: 15 },
    { id: 'pl_warden',      name: 'Hollowed Labyrinth Warden', hp: 70, atk: 18, def: 10, xp: 32, gold: 14 },
    { id: 'pl_gatekeeper',  name: 'Stone Gatekeeper',          hp: 90, atk: 14, def: 16, xp: 34, gold: 15 },
    { id: 'pl_crazed',      name: 'Maddened Puzzle Architect', hp: 55, atk: 22, def: 6,  xp: 28, gold: 12 },
  ],
  deep: [
    { id: 'pl_colossus',    name: 'Rune Colossus',             hp: 160, atk: 24, def: 22, xp: 65, gold: 34 },
    { id: 'pl_weaver',      name: 'Hollowed Logic Weaver',     hp: 120, atk: 30, def: 14, xp: 58, gold: 29 },
    { id: 'pl_obelisk',     name: 'Sentient Obelisk',          hp: 140, atk: 26, def: 20, xp: 62, gold: 32 },
  ],
  boss: [
    { id: 'pl_architect',   name: 'The Architect of Madness',  hp: 460, atk: 38, def: 28, xp: 235, gold: 125 },
  ],
};

// --- 14. celestial_spire ---
// Wild category: a fragment of the divine realm pulled into the rift. Once-radiant halls
// now corrupted. The angels that guarded it have become hollowed — their light turned to
// madness, their halos cracked, their hymns turned to screams.
// Biomes: Holy Dominion (8), Elven South (16)
// Layout: TEMPLE_HALLS — grand celestial corridors, radiant inner sanctum, choir chambers
ENEMY_POOLS.celestial_spire = {
  shallow: [
    { id: 'cs_hollowed',    name: 'Hollowed Fallen Angel',       hp: 28, atk: 10, def: 5,  xp: 12, gold: 6  },
    { id: 'cs_wraith',      name: 'Light Wraith',                hp: 22, atk: 11, def: 3,  xp: 11, gold: 5  },
    { id: 'cs_construct',   name: 'Radiant Construct',           hp: 34, atk: 8,  def: 7,  xp: 13, gold: 5  },
    { id: 'cs_maddened',    name: 'Maddened Celestial Guardian',  hp: 26, atk: 9,  def: 4,  xp: 10, gold: 5  },
  ],
  mid: [
    { id: 'cs_seraph',      name: 'Corrupted Seraph',            hp: 80, atk: 20, def: 12, xp: 38, gold: 18 },
    { id: 'cs_sentinel',    name: 'Hollowed Celestial Sentinel', hp: 90, atk: 16, def: 16, xp: 36, gold: 16 },
    { id: 'cs_chorister',   name: 'Maddened Hymn Chorister',     hp: 55, atk: 24, def: 6,  xp: 32, gold: 14 },
    { id: 'cs_paladin',     name: 'Fallen Paladin',              hp: 75, atk: 18, def: 13, xp: 34, gold: 15 },
  ],
  deep: [
    { id: 'cs_archangel',   name: 'Hollowed Archangel',          hp: 150, atk: 30, def: 20, xp: 68, gold: 36 },
    { id: 'cs_throne',      name: 'Shattered Throne Guardian',   hp: 140, atk: 28, def: 22, xp: 65, gold: 34 },
    { id: 'cs_radiant',     name: 'Maddened Radiant Devourer',   hp: 125, atk: 34, def: 14, xp: 60, gold: 30 },
  ],
  boss: [
    { id: 'cs_solanthis',   name: 'Archangel Solanthis the Shattered', hp: 520, atk: 44, def: 32, xp: 270, gold: 155 },
  ],
};

// --- 15. infernal_pit ---
// Wild category: a pocket of the abyss swallowed by the rift. Brimstone, lava rivers,
// chains hanging from impossible heights. The demons here are trapped too — and they
// are furious about it. Thematically similar to lava_rift but with demonic enemies.
// Biomes: Scorched Sands (3), Wastes (12), Mountain (2)
// Layout: OPEN_CAVERN — vast brimstone caverns with chain-bridges and lava pools
ENEMY_POOLS.infernal_pit = {
  shallow: [
    { id: 'ip_hollowed',    name: 'Hollowed Damned Soul',        hp: 24, atk: 9,  def: 3,  xp: 10, gold: 4  },
    { id: 'ip_imp',         name: 'Pit Imp',                     hp: 18, atk: 10, def: 2,  xp: 9,  gold: 5  },
    { id: 'ip_hound',       name: 'Hellhound',                   hp: 30, atk: 8,  def: 5,  xp: 12, gold: 5  },
    { id: 'ip_maddened',    name: 'Maddened Devil-Touched',      hp: 22, atk: 9,  def: 3,  xp: 10, gold: 4  },
  ],
  mid: [
    { id: 'ip_succubus',    name: 'Succubus Temptress',          hp: 60, atk: 24, def: 7,  xp: 34, gold: 16 },
    { id: 'ip_chain',       name: 'Chain Demon',                 hp: 85, atk: 17, def: 14, xp: 36, gold: 16 },
    { id: 'ip_hollowed_m',  name: 'Hollowed Infernal Cultist',   hp: 70, atk: 20, def: 10, xp: 32, gold: 14 },
    { id: 'ip_incubus',     name: 'Incubus Deceiver',            hp: 55, atk: 22, def: 8,  xp: 30, gold: 14 },
  ],
  deep: [
    { id: 'ip_fiend',       name: 'Greater Pit Fiend',           hp: 160, atk: 28, def: 20, xp: 66, gold: 35 },
    { id: 'ip_torturer',    name: 'Hollowed Abyssal Torturer',   hp: 130, atk: 32, def: 16, xp: 60, gold: 30 },
    { id: 'ip_warden',      name: 'Maddened Chain Warden',       hp: 145, atk: 26, def: 22, xp: 64, gold: 33 },
  ],
  boss: [
    { id: 'ip_malachar',    name: 'Pit Lord Malachar the Chained', hp: 510, atk: 44, def: 30, xp: 260, gold: 150 },
  ],
};

// --- 16. dragons_den ---
// Wild category: the lair of an ancient dragon, pulled whole into the rift. Mountains of
// gold, charred bones, egg chambers. The dragon's hoard attracted others who became
// trapped and hollowed. The dragon itself has gone mad from confinement.
// Biomes: Mountain (2), Scorched Sands (3), Frostbound (14)
// Layout: OPEN_CAVERN — massive hoard chamber, egg alcoves, charred tunnels
ENEMY_POOLS.dragons_den = {
  shallow: [
    { id: 'dd_hollowed',    name: 'Hollowed Treasure Hunter',    hp: 24, atk: 8,  def: 3,  xp: 10, gold: 6  },
    { id: 'dd_wyrmling',    name: 'Wyrmling',                    hp: 30, atk: 9,  def: 5,  xp: 12, gold: 5  },
    { id: 'dd_kobold',      name: 'Kobold Servant',              hp: 16, atk: 7,  def: 2,  xp: 8,  gold: 4  },
    { id: 'dd_maddened',    name: 'Maddened Hoard-Cursed',       hp: 22, atk: 10, def: 3,  xp: 10, gold: 5  },
  ],
  mid: [
    { id: 'dd_dragonkin',   name: 'Dragonkin Warrior',           hp: 85, atk: 18, def: 14, xp: 38, gold: 18 },
    { id: 'dd_drake',       name: 'Drake Guard',                 hp: 90, atk: 16, def: 16, xp: 36, gold: 16 },
    { id: 'dd_hollowed_m',  name: 'Hollowed Dragon Cultist',     hp: 65, atk: 22, def: 8,  xp: 32, gold: 14 },
    { id: 'dd_kobold_e',    name: 'Kobold Elite Trapper',        hp: 50, atk: 20, def: 6,  xp: 28, gold: 12 },
  ],
  deep: [
    { id: 'dd_wyvern',      name: 'Rift-Scarred Wyvern',        hp: 160, atk: 28, def: 22, xp: 68, gold: 36 },
    { id: 'dd_guardian',     name: 'Hollowed Hoard Guardian',    hp: 140, atk: 30, def: 18, xp: 64, gold: 33 },
    { id: 'dd_ancient',     name: 'Maddened Elder Dragonkin',    hp: 150, atk: 32, def: 16, xp: 66, gold: 34 },
  ],
  boss: [
    { id: 'dd_vyraxion',    name: 'Vyraxion the Rift-Mad Wyrm', hp: 560, atk: 48, def: 34, xp: 280, gold: 160, abilities: [{ id: 'dragon_claw', name: 'Dragon Claw', damage: 1.8, range: 1, windUp: 2, cooldown: 3, weight: 10 }, { id: 'fire_breath', name: 'Fire Breath', damage: 1.5, range: 3, windUp: 3, cooldown: 6, weight: 8, effect: 'burn', effectChance: 0.6 }, { id: 'tail_sweep', name: 'Tail Sweep', damage: 1.2, range: 2, windUp: 1, cooldown: 4, weight: 7 }], phases: [{ threshold: 0.6, name: 'Rift-Fueled Rage', atkMult: 1.4, abilities: [{ id: 'rift_breath', name: 'Rift Breath', damage: 2.0, range: 4, windUp: 3, cooldown: 5, weight: 12, effect: 'burn', effectChance: 0.7 }, { id: 'dragon_claw', name: 'Dragon Claw', damage: 2.2, range: 1, windUp: 2, cooldown: 3, weight: 10 }], speed: 2 }, { threshold: 0.3, name: 'Rift Madness', atkMult: 1.8, abilities: [{ id: 'annihilate', name: 'Annihilating Breath', damage: 3.0, range: 4, windUp: 4, cooldown: 6, weight: 14, effect: 'burn', effectChance: 0.9 }, { id: 'rift_stomp', name: 'Rift Stomp', damage: 2.0, range: 2, windUp: 2, cooldown: 4, weight: 10, effect: 'stun', effectChance: 0.5 }], detectionRadius: 10 }] },
  ],
};

// --- 17. vampire_castle ---
// A gothic castle where an ancient vampire lord turned the inhabitants.
// Blood fountains, crimson tapestries, coffin rooms.
// Biomes: Holy Dominion (8), Plains (6), Swamp (7)
// Layout: BSP_ROOMS — interconnected castle chambers, coffin rooms, throne hall
ENEMY_POOLS.vampire_castle = {
  shallow: [
    { id: 'vc_thrall',     name: 'Hollowed Thrall',         hp: 22, atk: 8,  def: 3,  xp: 9,  gold: 4  },
    { id: 'vc_spawn',      name: 'Vampire Spawn',           hp: 26, atk: 9,  def: 4,  xp: 11, gold: 5  },
    { id: 'vc_bat',        name: 'Blood Bat',               hp: 16, atk: 7,  def: 2,  xp: 8,  gold: 3  },
    { id: 'vc_gargoyle',   name: 'Stone Gargoyle',          hp: 32, atk: 7,  def: 7,  xp: 12, gold: 5  },
  ],
  mid: [
    { id: 'vc_golem',      name: 'Blood Golem',             hp: 85, atk: 15, def: 14, xp: 35, gold: 15 },
    { id: 'vc_knight',     name: 'Maddened Blood Knight',   hp: 75, atk: 18, def: 11, xp: 33, gold: 14 },
    { id: 'vc_nosferatu',  name: 'Nosferatu Stalker',       hp: 55, atk: 22, def: 6,  xp: 30, gold: 13 },
    { id: 'vc_maddened',   name: 'Maddened Courtier',       hp: 60, atk: 20, def: 8,  xp: 28, gold: 12 },
  ],
  deep: [
    { id: 'vc_elder',      name: 'Elder Vampire',           hp: 140, atk: 28, def: 18, xp: 62, gold: 32 },
    { id: 'vc_bloodlord',  name: 'Hollowed Blood Lord',     hp: 130, atk: 30, def: 16, xp: 58, gold: 30 },
    { id: 'vc_abomination',name: 'Crimson Abomination',     hp: 160, atk: 24, def: 22, xp: 65, gold: 34 },
  ],
  boss: [
    { id: 'vc_count',      name: 'Count Sanguine the Eternal', hp: 480, atk: 42, def: 30, xp: 248, gold: 138 },
  ],
};

// --- 18. lich_sanctum ---
// The laboratory of a lich who achieved immortality but lost sanity over millennia.
// Phylacteries, soul cages, necromantic circles.
// Biomes: Wastes (12), Steppes (4), Holy Dominion (8)
// Layout: TEMPLE_HALLS — long ritual corridors, soul cage alcoves, inner sanctum
ENEMY_POOLS.lich_sanctum = {
  shallow: [
    { id: 'ls_apprentice', name: 'Hollowed Apprentice',     hp: 20, atk: 9,  def: 3,  xp: 10, gold: 5  },
    { id: 'ls_skelmage',   name: 'Skeletal Mage',           hp: 24, atk: 10, def: 4,  xp: 11, gold: 5  },
    { id: 'ls_wraith',     name: 'Soul Wraith',             hp: 18, atk: 11, def: 2,  xp: 10, gold: 5  },
    { id: 'ls_construct',  name: 'Bone Construct',          hp: 30, atk: 7,  def: 6,  xp: 10, gold: 4  },
  ],
  mid: [
    { id: 'ls_necro',      name: 'Maddened Necromancer',    hp: 60, atk: 22, def: 7,  xp: 32, gold: 14 },
    { id: 'ls_revenant',   name: 'Phylactery Revenant',     hp: 80, atk: 16, def: 14, xp: 35, gold: 15 },
    { id: 'ls_specter',    name: 'Caged Soul Specter',      hp: 50, atk: 24, def: 5,  xp: 30, gold: 13 },
  ],
  deep: [
    { id: 'ls_deathknight',name: 'Death Knight',            hp: 150, atk: 28, def: 20, xp: 64, gold: 33 },
    { id: 'ls_demilich',   name: 'Demi-Lich',               hp: 110, atk: 34, def: 12, xp: 58, gold: 30 },
    { id: 'ls_hollowed',   name: 'Hollowed Soul Harvester', hp: 130, atk: 30, def: 16, xp: 60, gold: 31 },
  ],
  boss: [
    { id: 'ls_archlich', name: 'Archlich Veranthos', hp: 500, atk: 44, def: 30, xp: 258, gold: 148,
      isRaidBoss: true,
      abilities: [
        { id: 'soul_drain', name: 'Soul Drain', damage: 1.5, range: 3, windUp: 2, cooldown: 4, weight: 10, effect: 'slow', effectChance: 0.4 },
        { id: 'death_coil', name: 'Death Coil', damage: 2.0, range: 4, windUp: 3, cooldown: 6, weight: 8 },
        { id: 'raise_dead', name: 'Raise Dead', heals: true, healAmount: 40, range: 0, windUp: 4, cooldown: 10, weight: 5 },
        { id: 'necrotic_burst', name: 'Necrotic Burst', damage: 1.8, range: 3, windUp: 2, cooldown: 4, weight: 12, effect: 'bleed', effectChance: 0.5 },
        { id: 'death_storm', name: 'Death Storm', damage: 2.5, range: 4, windUp: 3, cooldown: 5, weight: 14, effect: 'doom', effectChance: 0.4 },
        { id: 'soul_harvest', name: 'Soul Harvest', damage: 1.5, range: 2, windUp: 2, cooldown: 4, weight: 10, effect: 'slow', effectChance: 0.7 },
      ],
      phases: [
        { threshold: 0.7, name: 'Awakening', atkMult: 1.0, speed: 1,
          abilities: ['soul_drain', 'death_coil', 'raise_dead'],
          addsPerCycle: 2, addType: 'skeleton',
          description: 'The Archlich stirs, summoning skeletal guardians.' },
        { threshold: 0.4, name: 'Phylactery Shield', atkMult: 1.3, speed: 2,
          abilities: ['soul_drain', 'necrotic_burst'],
          bossImmune: true, phylacteryCount: 4,
          description: 'Phylacteries shield the Archlich. Destroy them!' },
        { threshold: 0.15, name: 'Necrotic Storm', atkMult: 1.5, speed: 2,
          abilities: ['death_coil', 'necrotic_burst', 'soul_harvest'],
          addsPerParty: 1, hasCorruptionZones: true, deathCoilMult: 2.0,
          description: 'Necrotic energy saturates the chamber. Avoid the corruption zones!' },
        { threshold: 0.0, name: 'Undeath Unbound', atkMult: 1.7, speed: 3,
          abilities: ['death_storm', 'soul_harvest', 'death_coil'],
          enrage: true, soulHarvestAll: true, deathStormMult: 2.5,
          detectionRadius: 9,
          description: 'The Archlich unleashes its full power in a desperate assault!' },
      ],
      // Raid scaling: base stats multiplied by (2 + playerCount * 0.5) for HP, (1.5 + playerCount * 0.05) for ATK
      raidScaling: { hpFormula: '2 + N * 0.5', atkFormula: '1.5 + N * 0.05', defMult: 1.5 },
      loot: [
        { type: 'purification_crystal', count: 3, chance: 1.0 },
        { type: 'dark_crystal', count: 5, chance: 1.0 },
        { type: 'boss_trophy', count: 1, chance: 1.0 },
        { type: 'mana_crystal', count: 10, chance: 0.8 },
      ],
    },
  ],
};

// --- 19. cogwork_foundry ---
// A massive gnomish/dwarven factory gone haywire. Assembly lines still run,
// producing mad automatons. Steam, gears, pistons.
// Biomes: Gnomish Isles (9), Mechspire (10), Clockwork Harbor (11)
// Layout: MAZE — interlocking assembly corridors, steam-vent dead ends
ENEMY_POOLS.cogwork_foundry = {
  shallow: [
    { id: 'cw_worker',     name: 'Hollowed Gnome Worker',   hp: 18, atk: 8,  def: 3,  xp: 9,  gold: 4  },
    { id: 'cw_automaton',  name: 'Rogue Automaton',         hp: 28, atk: 7,  def: 5,  xp: 10, gold: 4  },
    { id: 'cw_steamgolem', name: 'Steam Golem',             hp: 34, atk: 6,  def: 7,  xp: 12, gold: 5  },
    { id: 'cw_spider',     name: 'Gear Spider',             hp: 20, atk: 9,  def: 3,  xp: 9,  gold: 4  },
  ],
  mid: [
    { id: 'cw_engineer',   name: 'Maddened Dwarf Engineer', hp: 70, atk: 18, def: 10, xp: 34, gold: 15 },
    { id: 'cw_sentinel',   name: 'Foundry Sentinel',        hp: 85, atk: 15, def: 15, xp: 36, gold: 16 },
    { id: 'cw_overcharge', name: 'Overcharged Drone',       hp: 50, atk: 24, def: 5,  xp: 30, gold: 13 },
    { id: 'cw_maddened',   name: 'Maddened Gnome Foreman',  hp: 55, atk: 20, def: 8,  xp: 28, gold: 12 },
  ],
  deep: [
    { id: 'cw_siege',      name: 'Siege Automaton',         hp: 170, atk: 24, def: 24, xp: 68, gold: 35 },
    { id: 'cw_titan',      name: 'Foundry Titan',           hp: 140, atk: 28, def: 18, xp: 62, gold: 32 },
    { id: 'cw_hollowed',   name: 'Hollowed Master Smith',   hp: 115, atk: 32, def: 14, xp: 58, gold: 29 },
  ],
  boss: [
    { id: 'cw_engine',     name: 'The Overclocked Engine',  hp: 510, atk: 42, def: 32, xp: 255, gold: 145 },
  ],
};

// --- 20. astral_rift ---
// A tear in reality leading to the space between worlds. Floating platforms
// in void, crystallized thoughts, reality-warping corridors.
// Biomes: Wastes (12), Southern Wastes (15)
// Layout: ISLAND — scattered reality fragments connected by void bridges
ENEMY_POOLS.astral_rift = {
  shallow: [
    { id: 'at_traveler',   name: 'Hollowed Lost Traveler',  hp: 20, atk: 9,  def: 3,  xp: 10, gold: 5  },
    { id: 'at_devourer',   name: 'Thought Devourer',        hp: 22, atk: 10, def: 3,  xp: 11, gold: 5  },
    { id: 'at_shard',      name: 'Reality Shard',           hp: 26, atk: 8,  def: 6,  xp: 10, gold: 4  },
    { id: 'at_parasite',   name: 'Astral Parasite',         hp: 16, atk: 11, def: 1,  xp: 9,  gold: 4  },
  ],
  mid: [
    { id: 'at_walker',     name: 'Void Walker',             hp: 65, atk: 20, def: 9,  xp: 32, gold: 14 },
    { id: 'at_warp',       name: 'Reality Warper',          hp: 55, atk: 24, def: 6,  xp: 31, gold: 14 },
    { id: 'at_maddened',   name: 'Maddened Planeswalker',   hp: 70, atk: 18, def: 11, xp: 34, gold: 15 },
  ],
  deep: [
    { id: 'at_titan',      name: 'Astral Titan',            hp: 150, atk: 28, def: 20, xp: 64, gold: 33 },
    { id: 'at_horror',     name: 'Void Horror',             hp: 130, atk: 32, def: 14, xp: 60, gold: 30 },
    { id: 'at_hollowed',   name: 'Hollowed Rift-Bound',     hp: 110, atk: 30, def: 16, xp: 56, gold: 28 },
  ],
  boss: [
    { id: 'at_consciousness', name: 'The Rift Consciousness', hp: 490, atk: 44, def: 28, xp: 252, gold: 142 },
  ],
};

// --- 21. hollow_breach (mini-rift) ---
// Secondary rifts — The Soldier's consciousness bleeding through reality.
// The Hollow are rift inhabitants that mimic known race shapes but get the details wrong.
// Used exclusively by mini-rift dungeons (overworld-rifts.js).
ENEMY_POOLS.hollow_breach = {
  shallow: [
    { id: 'hb_mimicry',    name: 'Hollow Mimicry',          hp: 18, atk: 8,  def: 3,  xp: 9,  gold: 4, isLiving: false, element: 'shadow' },
    { id: 'hb_parasite',   name: 'Void Parasite',           hp: 22, atk: 10, def: 2,  xp: 10, gold: 4, isLiving: false, element: 'shadow' },
    { id: 'hb_shard',      name: 'Fractured Shard',         hp: 28, atk: 9,  def: 5,  xp: 11, gold: 5, isLiving: false, element: 'arcane' },
    { id: 'hb_walker',     name: 'Hollow Walker',           hp: 30, atk: 12, def: 4,  xp: 12, gold: 5, isLiving: false, element: 'shadow', archetype: 'melee' },
  ],
  mid: [
    { id: 'hb_stealer',    name: 'Shape Stealer',           hp: 55, atk: 20, def: 8,  xp: 30, gold: 14, isLiving: false, element: 'shadow', archetype: 'controller', abilities: [{ name: 'Identity Theft', damage: 12, effect: 'confuse', chance: 0.3 }] },
    { id: 'hb_weaver',     name: 'Void Weaver',             hp: 60, atk: 22, def: 7,  xp: 32, gold: 15, isLiving: false, element: 'shadow', archetype: 'caster', abilities: [{ name: 'Void Thread', damage: 15, effect: 'slow', chance: 0.35 }] },
    { id: 'hb_echo',       name: 'Desperate Echo',          hp: 65, atk: 24, def: 9,  xp: 34, gold: 16, isLiving: false, element: 'arcane', archetype: 'melee' },
    { id: 'hb_messenger',  name: 'Torn Messenger',          hp: 70, atk: 26, def: 10, xp: 36, gold: 16, isLiving: false, element: 'shadow', archetype: 'ranged', abilities: [{ name: 'Desperate Plea', damage: 18, effect: 'fear', chance: 0.25 }] },
  ],
  deep: [
    { id: 'hb_knight',     name: 'Hollow Knight',           hp: 130, atk: 30, def: 16, xp: 58, gold: 30, isLiving: false, element: 'shadow', archetype: 'melee', abilities: [{ name: 'Void Slash', damage: 22, effect: 'bleed', chance: 0.4 }] },
    { id: 'hb_horror',     name: 'Void Horror',             hp: 140, atk: 32, def: 14, xp: 62, gold: 32, isLiving: false, element: 'shadow', archetype: 'controller', abilities: [{ name: 'Reality Warp', damage: 20, effect: 'confuse', chance: 0.45 }] },
    { id: 'hb_eater',      name: 'Reality Eater',           hp: 150, atk: 34, def: 15, xp: 66, gold: 34, isLiving: false, element: 'arcane', archetype: 'caster', abilities: [{ name: 'Consume Reality', damage: 25, effect: 'drain', chance: 0.35 }] },
  ],
  boss: [
    {
      id: 'hb_anchor',
      name: 'The Rift Anchor',
      hp: 400, atk: 38, def: 24, xp: 220, gold: 130,
      isLiving: false, element: 'shadow', archetype: 'boss',
      phases: [
        { name: 'Unstable', hpThreshold: 1.0, atkMult: 1.0, defMult: 1.0 },
        { name: 'Fracturing', hpThreshold: 0.5, atkMult: 1.3, defMult: 0.9 },
        { name: 'Final Scream', hpThreshold: 0.2, atkMult: 1.6, defMult: 0.7 },
      ],
      abilities: [
        { name: 'Void Pulse', damage: 20, effect: 'knockback', chance: 0.4, cooldown: 2 },
        { name: 'Reality Shatter', damage: 30, effect: 'confuse', chance: 0.3, cooldown: 3 },
        { name: 'Summon Hollow', damage: 0, effect: 'summon', chance: 0.25, cooldown: 4, summonId: 'hb_mimicry', summonCount: 2 },
        { name: 'Desperation Wave', damage: 35, effect: 'fear', chance: 0.2, cooldown: 5 },
      ],
      drops: ['purification_crystal', 'dark_crystal', 'mana_crystal'],
    },
  ],
};

// --- 22. dinosaur_jungle ---
// A primeval jungle preserved deep underground where prehistoric beasts
// never went extinct. The rift pulled an ancient era into its walls.
// Biomes: Forest (5), Swamp (7), Elven South (16)
// Layout: ORGANIC — natural cavern shapes, overgrown with primeval flora
ENEMY_POOLS.dinosaur_jungle = {
  shallow: [
    { id: 'dj_hunter',     name: 'Hollowed Tribal Hunter',  hp: 24, atk: 8,  def: 3,  xp: 10, gold: 4  },
    { id: 'dj_raptor',     name: 'Raptor',                  hp: 28, atk: 9,  def: 4,  xp: 12, gold: 5  },
    { id: 'dj_insect',     name: 'Giant Jungle Insect',     hp: 20, atk: 7,  def: 5,  xp: 9,  gold: 3  },
    { id: 'dj_crawler',    name: 'Jungle Crawler',          hp: 22, atk: 8,  def: 3,  xp: 9,  gold: 4  },
  ],
  mid: [
    { id: 'dj_tribe',      name: 'Maddened Tribespeople',   hp: 65, atk: 18, def: 10, xp: 32, gold: 14 },
    { id: 'dj_triceratops', name: 'Armored Herbivore',      hp: 90, atk: 14, def: 16, xp: 36, gold: 16 },
    { id: 'dj_terror',     name: 'Terror Bird',             hp: 55, atk: 22, def: 6,  xp: 30, gold: 13 },
  ],
  deep: [
    { id: 'dj_alpha',      name: 'Alpha Raptor Pack',       hp: 140, atk: 28, def: 16, xp: 60, gold: 30 },
    { id: 'dj_sauropod',   name: 'Enraged Sauropod',        hp: 180, atk: 22, def: 24, xp: 68, gold: 36 },
    { id: 'dj_hollowed',   name: 'Hollowed Primal Shaman',  hp: 110, atk: 32, def: 12, xp: 56, gold: 28 },
  ],
  boss: [
    { id: 'dj_rex',        name: 'The Primeval Rex',        hp: 520, atk: 44, def: 32, xp: 260, gold: 150 },
  ],
};

// --- 22. spider_hive ---
// Web-choked tunnels housing a colony of massive spiders. Everything is
// wrapped in silk. Some victims still twitch.
// Biomes: Forest (5), Swamp (7), Mountain (2)
// Layout: ORGANIC — natural web-draped tunnels, silk-wrapped chambers
ENEMY_POOLS.spider_hive = {
  shallow: [
    { id: 'sp_cocooned',   name: 'Hollowed Cocooned Victim', hp: 22, atk: 7,  def: 4,  xp: 9,  gold: 4  },
    { id: 'sp_spinner',    name: 'Web Spinner',              hp: 20, atk: 8,  def: 3,  xp: 9,  gold: 3  },
    { id: 'sp_brood',      name: 'Brood Spider',             hp: 18, atk: 9,  def: 2,  xp: 8,  gold: 3  },
    { id: 'sp_spitter',    name: 'Venom Spitter',            hp: 24, atk: 10, def: 3,  xp: 11, gold: 5  },
  ],
  mid: [
    { id: 'sp_bonded',     name: 'Maddened Spider-Bonded',  hp: 65, atk: 20, def: 8,  xp: 32, gold: 14 },
    { id: 'sp_lurker',     name: 'Silk Lurker',             hp: 70, atk: 18, def: 11, xp: 34, gold: 15 },
    { id: 'sp_huntsman',   name: 'Giant Huntsman',          hp: 80, atk: 16, def: 13, xp: 35, gold: 15 },
  ],
  deep: [
    { id: 'sp_matriarch',  name: 'Hive Matriarch',          hp: 140, atk: 28, def: 18, xp: 62, gold: 32 },
    { id: 'sp_weaver',     name: 'Phase Weaver',            hp: 110, atk: 32, def: 12, xp: 56, gold: 28 },
    { id: 'sp_hollowed',   name: 'Hollowed Arachnid Host',  hp: 130, atk: 26, def: 20, xp: 60, gold: 30 },
  ],
  boss: [
    { id: 'sp_broodmother', name: 'The Broodmother',        hp: 470, atk: 40, def: 28, xp: 242, gold: 132, abilities: [{ id: 'fang_strike', name: 'Venomous Fang', damage: 1.6, range: 1, windUp: 2, cooldown: 3, weight: 10, effect: 'poison', effectChance: 0.5 }, { id: 'web_shot', name: 'Web Shot', damage: 0.8, range: 4, windUp: 2, cooldown: 5, weight: 8, effect: 'root', effectChance: 0.6 }, { id: 'spawn_brood', name: 'Spawn Broodlings', damage: 0.0, range: 0, windUp: 4, cooldown: 10, weight: 5 }], phases: [{ threshold: 0.6, name: 'Brood Frenzy', atkMult: 1.3, abilities: [{ id: 'frenzy_bite', name: 'Frenzy Bite', damage: 2.0, range: 1, windUp: 1, cooldown: 3, weight: 12, effect: 'poison', effectChance: 0.6 }, { id: 'web_barrage', name: 'Web Barrage', damage: 1.0, range: 3, windUp: 2, cooldown: 4, weight: 10, effect: 'root', effectChance: 0.5 }], speed: 2 }, { threshold: 0.3, name: 'Death Throes', atkMult: 1.7, abilities: [{ id: 'venom_nova', name: 'Venom Nova', damage: 2.0, range: 3, windUp: 3, cooldown: 5, weight: 14, effect: 'poison', effectChance: 0.8 }, { id: 'desperate_fang', name: 'Desperate Fang', damage: 2.5, range: 1, windUp: 1, cooldown: 3, weight: 10 }], detectionRadius: 9 }] },
  ],
};

// --- 23. sunken_depths ---
// Completely submerged floors. Bioluminescent kelp forests, drowned ruins.
// Lizard Folk can freely explore; others need rafts or swimming mounts.
// Biomes: Water (0), Beach (13)
// Layout: LAKE — vast flooded chambers, kelp forests, submerged platforms
ENEMY_POOLS.sunken_depths = {
  shallow: [
    { id: 'sd_sailor',     name: 'Hollowed Drowned Sailor', hp: 22, atk: 8,  def: 3,  xp: 9,  gold: 4  },
    { id: 'sd_fish',       name: 'Deep Sea Anglerfish',     hp: 20, atk: 9,  def: 3,  xp: 10, gold: 4  },
    { id: 'sd_jelly',      name: 'Giant Jellyfish',         hp: 18, atk: 10, def: 2,  xp: 9,  gold: 4  },
    { id: 'sd_krakenspawn',name: 'Kraken Spawn',            hp: 28, atk: 7,  def: 5,  xp: 11, gold: 5  },
  ],
  mid: [
    { id: 'sd_merfolk',    name: 'Maddened Merfolk',        hp: 65, atk: 20, def: 9,  xp: 32, gold: 14 },
    { id: 'sd_serpent',    name: 'Brine Serpent',           hp: 75, atk: 18, def: 12, xp: 34, gold: 15 },
    { id: 'sd_golem',      name: 'Coral Golem',             hp: 85, atk: 14, def: 16, xp: 35, gold: 15 },
  ],
  deep: [
    { id: 'sd_horror',     name: 'Abyssal Horror',          hp: 140, atk: 28, def: 18, xp: 62, gold: 32 },
    { id: 'sd_kraken',     name: 'Juvenile Kraken',         hp: 160, atk: 26, def: 22, xp: 66, gold: 34 },
    { id: 'sd_hollowed',   name: 'Hollowed Depth Warden',   hp: 120, atk: 30, def: 14, xp: 58, gold: 30 },
  ],
  boss: [
    { id: 'sd_leviathan',  name: 'The Abyssal Leviathan',   hp: 510, atk: 42, def: 32, xp: 258, gold: 148 },
  ],
};

// --- 24. abyssal_dark ---
// Floors consumed by absolute darkness. No natural light penetrates.
// Only darkvision races (Dwarf, Goblin, Cat Folk) can see beyond their tile.
// Biomes: Mountain (2), Wastes (12), Steppes (4)
// Layout: MAZE — pitch-dark winding passages, no landmarks
ENEMY_POOLS.abyssal_dark = {
  shallow: [
    { id: 'ad_blind',      name: 'Hollowed Blind One',      hp: 24, atk: 8,  def: 4,  xp: 10, gold: 4  },
    { id: 'ad_elemental',  name: 'Darkness Elemental',      hp: 20, atk: 10, def: 3,  xp: 10, gold: 5  },
    { id: 'ad_crawler',    name: 'Shadow Crawler',          hp: 18, atk: 9,  def: 2,  xp: 9,  gold: 4  },
    { id: 'ad_stalker',    name: 'Eyeless Stalker',         hp: 26, atk: 8,  def: 5,  xp: 11, gold: 4  },
  ],
  mid: [
    { id: 'ad_dweller',    name: 'Maddened Dark-Dweller',   hp: 70, atk: 18, def: 11, xp: 34, gold: 15 },
    { id: 'ad_feeder',     name: 'Gloom Feeder',            hp: 60, atk: 22, def: 7,  xp: 30, gold: 13 },
    { id: 'ad_lurker',     name: 'Abyss Lurker',            hp: 80, atk: 16, def: 14, xp: 35, gold: 15 },
  ],
  deep: [
    { id: 'ad_horror',     name: 'Lightless Horror',        hp: 140, atk: 28, def: 18, xp: 62, gold: 32 },
    { id: 'ad_void',       name: 'Void Incarnate',          hp: 120, atk: 32, def: 14, xp: 58, gold: 30 },
    { id: 'ad_hollowed',   name: 'Hollowed Abyss-Touched',  hp: 130, atk: 26, def: 20, xp: 60, gold: 30 },
  ],
  boss: [
    { id: 'ad_thing',      name: 'The Thing That Sees Without Eyes', hp: 480, atk: 40, def: 30, xp: 245, gold: 135 },
  ],
};

// --- 25. werewolf_den ---
// A pack of lycanthropes have hollowed out a den deep within.
// Claw marks on every wall. The howling never stops.
// Biomes: Forest (5), Plains (6), Steppes (4)
// Layout: ORGANIC — rough-hewn natural den, tunnels, central pack grounds
ENEMY_POOLS.werewolf_den = {
  shallow: [
    { id: 'wd_victim',     name: 'Hollowed Half-Turned Victim', hp: 22, atk: 8,  def: 3,  xp: 9,  gold: 4  },
    { id: 'wd_direwolf',   name: 'Dire Wolf',               hp: 28, atk: 9,  def: 4,  xp: 11, gold: 4  },
    { id: 'wd_pup',        name: 'Wolf Pup',                hp: 14, atk: 6,  def: 2,  xp: 7,  gold: 3  },
    { id: 'wd_scout',      name: 'Pack Scout',              hp: 24, atk: 10, def: 3,  xp: 10, gold: 5  },
  ],
  mid: [
    { id: 'wd_lycan',      name: 'Maddened Lycanthrope',    hp: 80, atk: 18, def: 11, xp: 35, gold: 15 },
    { id: 'wd_howler',     name: 'Howling Ravager',         hp: 65, atk: 22, def: 8,  xp: 32, gold: 14 },
    { id: 'wd_packleader', name: 'Pack Leader',             hp: 75, atk: 16, def: 13, xp: 34, gold: 15 },
  ],
  deep: [
    { id: 'wd_alpha_wolf', name: 'Alpha Dire Wolf',         hp: 150, atk: 26, def: 20, xp: 64, gold: 33 },
    { id: 'wd_berserker',  name: 'Maddened Lycan Berserker', hp: 130, atk: 30, def: 16, xp: 60, gold: 30 },
    { id: 'wd_hollowed',   name: 'Hollowed Moon-Cursed',    hp: 140, atk: 28, def: 18, xp: 62, gold: 32 },
  ],
  boss: [
    { id: 'wd_fenris',     name: 'Alpha Fenris the Moonbound', hp: 475, atk: 42, def: 28, xp: 248, gold: 136 },
  ],
};

// --- 26. troll_caves ---
// Crude cave dwellings of massive trolls. Bones piled high, crude clubs
// strewn about. The trolls regenerate — you must kill them fast.
// Biomes: Mountain (2), Forest (5), Steppes (4)
// Layout: OPEN_CAVERN — wide rough-cut troll dens, bone piles, crude shelters
ENEMY_POOLS.troll_caves = {
  shallow: [
    { id: 'tc_food',       name: 'Hollowed Troll Food',     hp: 18, atk: 6,  def: 2,  xp: 8,  gold: 3  },
    { id: 'tc_young',      name: 'Young Troll',             hp: 30, atk: 9,  def: 5,  xp: 12, gold: 5  },
    { id: 'tc_cave',       name: 'Cave Troll Runt',         hp: 26, atk: 8,  def: 4,  xp: 10, gold: 4  },
  ],
  mid: [
    { id: 'tc_troll',      name: 'Cave Troll',              hp: 90, atk: 16, def: 14, xp: 36, gold: 16 },
    { id: 'tc_rock',       name: 'Rock Troll',              hp: 85, atk: 14, def: 16, xp: 35, gold: 15 },
    { id: 'tc_shaman',     name: 'Maddened Troll Shaman',   hp: 60, atk: 22, def: 7,  xp: 30, gold: 13 },
    { id: 'tc_maddened',   name: 'Maddened Troll Brute',    hp: 80, atk: 18, def: 12, xp: 34, gold: 15 },
  ],
  deep: [
    { id: 'tc_elder',      name: 'Elder Mountain Troll',    hp: 170, atk: 24, def: 24, xp: 68, gold: 36 },
    { id: 'tc_warlord',    name: 'Troll Warlord',           hp: 150, atk: 28, def: 18, xp: 62, gold: 32 },
    { id: 'tc_hollowed',   name: 'Hollowed Troll Champion', hp: 140, atk: 26, def: 20, xp: 60, gold: 30 },
  ],
  boss: [
    { id: 'tc_grothak',    name: 'Grothak the Regenerating', hp: 500, atk: 40, def: 30, xp: 255, gold: 145 },
  ],
};

// --- 27. ruined_village ---
// An entire surface village was pulled into the rift. Buildings half-swallowed
// by stone, the villagers hollowed by exposure. A grotesque parody of normal life.
// Biomes: Plains (6), Holy Dominion (8), Forest (5)
// Layout: BSP_ROOMS — half-buried buildings, collapsed streets, ruined square
ENEMY_POOLS.ruined_village = {
  shallow: [
    { id: 'rv_villager',   name: 'Hollowed Villager',       hp: 20, atk: 7,  def: 3,  xp: 9,  gold: 4  },
    { id: 'rv_merchant',   name: 'Maddened Merchant',       hp: 22, atk: 8,  def: 3,  xp: 9,  gold: 5  },
    { id: 'rv_livestock',  name: 'Feral Livestock',         hp: 26, atk: 8,  def: 4,  xp: 10, gold: 3  },
    { id: 'rv_child',      name: 'Cursed Child (Ghostly)',  hp: 14, atk: 10, def: 1,  xp: 10, gold: 5  },
  ],
  mid: [
    { id: 'rv_guard',      name: 'Maddened Village Guard',  hp: 75, atk: 16, def: 12, xp: 33, gold: 14 },
    { id: 'rv_smith',      name: 'Hollowed Village Smith',  hp: 80, atk: 18, def: 11, xp: 35, gold: 15 },
    { id: 'rv_preacher',   name: 'Maddened Street Preacher', hp: 55, atk: 22, def: 6,  xp: 30, gold: 13 },
  ],
  deep: [
    { id: 'rv_militia',    name: 'Hollowed Militia Captain', hp: 130, atk: 28, def: 18, xp: 60, gold: 30 },
    { id: 'rv_amalgam',    name: 'Village Amalgam',         hp: 160, atk: 24, def: 22, xp: 66, gold: 34 },
    { id: 'rv_maddened',   name: 'Maddened Village Elder',  hp: 110, atk: 32, def: 12, xp: 56, gold: 28 },
  ],
  boss: [
    { id: 'rv_mayor',      name: 'The Hollowed Mayor',      hp: 460, atk: 38, def: 26, xp: 235, gold: 128 },
  ],
};

// ---------------------------------------------------------------------------
// Invisible enemy definitions — enemies with invisibility types
// Added to existing theme pools in mid/deep tiers (appear floors 3+)
// Types: 'natural', 'magical', 'spectral', 'ambush'
// ---------------------------------------------------------------------------

// --- NATURAL INVISIBILITY (5 enemies) ---
// shadow_stalker — shadow_realm mid+deep (shadow predator blending with darkness)
ENEMY_POOLS.shadow_realm.mid.push(
  { id: 'inv_shadow_stalker', name: 'Shadow Stalker',   hp: 70,  atk: 24, def: 8,  xp: 38, gold: 18, invisibility: 'natural', archetype: 'skirmisher' }
);
ENEMY_POOLS.shadow_realm.deep.push(
  { id: 'inv_shadow_stalker_d', name: 'Shadow Stalker', hp: 130, atk: 34, def: 14, xp: 62, gold: 34, invisibility: 'natural', archetype: 'skirmisher' }
);

// chameleon_lurker — fungal_forest + overgrown_temple mid (color-shifting reptilian ambusher)
ENEMY_POOLS.fungal_forest.mid.push(
  { id: 'inv_chameleon_lurker', name: 'Chameleon Lurker', hp: 65, atk: 20, def: 7, xp: 34, gold: 15, invisibility: 'natural', archetype: 'skirmisher' }
);
ENEMY_POOLS.overgrown_temple.mid.push(
  { id: 'inv_chameleon_lurker_ot', name: 'Chameleon Lurker', hp: 65, atk: 20, def: 7, xp: 34, gold: 15, invisibility: 'natural', archetype: 'skirmisher' }
);

// cave_crawler_invisible — crystal_cavern deep (translucent cave spider)
ENEMY_POOLS.crystal_cavern.deep.push(
  { id: 'inv_cave_crawler_invis', name: 'Translucent Cave Spider', hp: 120, atk: 30, def: 12, xp: 58, gold: 28, invisibility: 'natural', archetype: 'skirmisher' }
);

// dust_phantom — sand_tomb mid+deep (creature made of floating dust particles)
ENEMY_POOLS.sand_tomb.mid.push(
  { id: 'inv_dust_phantom', name: 'Dust Phantom', hp: 55, atk: 22, def: 6, xp: 32, gold: 14, invisibility: 'natural', archetype: 'skirmisher' }
);
ENEMY_POOLS.sand_tomb.deep.push(
  { id: 'inv_dust_phantom_d', name: 'Dust Phantom', hp: 115, atk: 32, def: 12, xp: 58, gold: 30, invisibility: 'natural', archetype: 'skirmisher' }
);

// wind_wraith — frozen_depths deep (invisible air elemental)
ENEMY_POOLS.frozen_depths.deep.push(
  { id: 'inv_wind_wraith', name: 'Wind Wraith', hp: 105, atk: 28, def: 10, xp: 56, gold: 28, invisibility: 'natural', archetype: 'ranged', isLiving: false,
    abilities: [{ id: 'gale_slash', name: 'Gale Slash', damage: 1.3, range: 3, windUp: 2, cooldown: 3, weight: 10 }] }
);

// --- MAGICAL INVISIBILITY (5 enemies) ---
// arcane_stalker — ancient_library fallback (sand_tomb) mid, mirage_palace mid (mage maintaining invisibility spell)
ENEMY_POOLS.sand_tomb.mid.push(
  { id: 'inv_arcane_stalker', name: 'Arcane Stalker', hp: 60, atk: 24, def: 6, xp: 36, gold: 16, invisibility: 'magical', archetype: 'ranged',
    abilities: [{ id: 'arcane_bolt', name: 'Arcane Bolt', damage: 1.2, range: 4, windUp: 2, cooldown: 3, weight: 10 }] }
);
ENEMY_POOLS.mirage_palace.mid.push(
  { id: 'inv_arcane_stalker_mp', name: 'Arcane Stalker', hp: 60, atk: 24, def: 6, xp: 36, gold: 16, invisibility: 'magical', archetype: 'ranged',
    abilities: [{ id: 'arcane_bolt', name: 'Arcane Bolt', damage: 1.2, range: 4, windUp: 2, cooldown: 3, weight: 10 }] }
);

// void_lurker — void_debris fallback (shadow_realm) deep, astral_rift deep (entity hidden by void magic)
ENEMY_POOLS.shadow_realm.deep.push(
  { id: 'inv_void_lurker', name: 'Void Lurker', hp: 140, atk: 36, def: 16, xp: 68, gold: 36, invisibility: 'magical', archetype: 'controller', isLiving: false,
    abilities: [{ id: 'void_grasp', name: 'Void Grasp', damage: 1.4, range: 2, windUp: 2, cooldown: 4, weight: 10, effect: 'slow', effectChance: 0.4 }] }
);
ENEMY_POOLS.astral_rift.deep.push(
  { id: 'inv_void_lurker_ar', name: 'Void Lurker', hp: 140, atk: 36, def: 16, xp: 68, gold: 36, invisibility: 'magical', archetype: 'controller', isLiving: false,
    abilities: [{ id: 'void_grasp', name: 'Void Grasp', damage: 1.4, range: 2, windUp: 2, cooldown: 4, weight: 10, effect: 'slow', effectChance: 0.4 }] }
);

// phantom_assassin — shadow_realm mid, goblin_warrens mid (magically cloaked assassin)
ENEMY_POOLS.shadow_realm.mid.push(
  { id: 'inv_phantom_assassin', name: 'Phantom Assassin', hp: 55, atk: 26, def: 5, xp: 36, gold: 16, invisibility: 'magical', archetype: 'skirmisher' }
);
ENEMY_POOLS.goblin_warrens.mid.push(
  { id: 'inv_phantom_assassin_gw', name: 'Phantom Assassin', hp: 55, atk: 26, def: 5, xp: 36, gold: 16, invisibility: 'magical', archetype: 'skirmisher' }
);

// invisible_guardian — sand_tomb deep, elven_reliquary deep (ancient ward made invisible by enchantment)
ENEMY_POOLS.sand_tomb.deep.push(
  { id: 'inv_invisible_guardian', name: 'Invisible Guardian', hp: 160, atk: 26, def: 22, xp: 66, gold: 34, invisibility: 'magical', archetype: 'bruiser', isLiving: false }
);
ENEMY_POOLS.elven_reliquary.deep.push(
  { id: 'inv_invisible_guardian_er', name: 'Invisible Guardian', hp: 160, atk: 26, def: 22, xp: 66, gold: 34, invisibility: 'magical', archetype: 'bruiser', isLiving: false }
);

// fey_trickster — fungal_forest mid, elven_reliquary mid (faerie using glamour magic)
ENEMY_POOLS.fungal_forest.mid.push(
  { id: 'inv_fey_trickster', name: 'Fey Trickster', hp: 45, atk: 20, def: 5, xp: 30, gold: 14, invisibility: 'magical', archetype: 'controller',
    abilities: [{ id: 'glamour_bolt', name: 'Glamour Bolt', damage: 1.0, range: 3, windUp: 2, cooldown: 4, weight: 10, effect: 'confusion', effectChance: 0.3 }] }
);
ENEMY_POOLS.elven_reliquary.mid.push(
  { id: 'inv_fey_trickster_er', name: 'Fey Trickster', hp: 45, atk: 20, def: 5, xp: 30, gold: 14, invisibility: 'magical', archetype: 'controller',
    abilities: [{ id: 'glamour_bolt', name: 'Glamour Bolt', damage: 1.0, range: 3, windUp: 2, cooldown: 4, weight: 10, effect: 'confusion', effectChance: 0.3 }] }
);

// --- SPECTRAL / ETHEREAL (4 enemies) ---
// wraith_shade — bone_yard deep, haunted_manor deep (partially phased out spirit)
ENEMY_POOLS.bone_yard.deep.push(
  { id: 'inv_wraith_shade', name: 'Wraith Shade', hp: 100, atk: 32, def: 10, xp: 58, gold: 28, invisibility: 'spectral', archetype: 'skirmisher', isLiving: false }
);
ENEMY_POOLS.haunted_manor.deep.push(
  { id: 'inv_wraith_shade_hm', name: 'Wraith Shade', hp: 100, atk: 32, def: 10, xp: 58, gold: 28, invisibility: 'spectral', archetype: 'skirmisher', isLiving: false }
);

// ethereal_watcher — haunted_manor mid, sand_tomb mid (ghost sentry)
ENEMY_POOLS.haunted_manor.mid.push(
  { id: 'inv_ethereal_watcher', name: 'Ethereal Watcher', hp: 50, atk: 22, def: 6, xp: 32, gold: 14, invisibility: 'spectral', archetype: 'ranged', isLiving: false,
    abilities: [{ id: 'spectral_gaze', name: 'Spectral Gaze', damage: 1.1, range: 4, windUp: 2, cooldown: 3, weight: 10, effect: 'fear', effectChance: 0.2 }] }
);
ENEMY_POOLS.sand_tomb.mid.push(
  { id: 'inv_ethereal_watcher_st', name: 'Ethereal Watcher', hp: 50, atk: 22, def: 6, xp: 32, gold: 14, invisibility: 'spectral', archetype: 'ranged', isLiving: false,
    abilities: [{ id: 'spectral_gaze', name: 'Spectral Gaze', damage: 1.1, range: 4, windUp: 2, cooldown: 3, weight: 10, effect: 'fear', effectChance: 0.2 }] }
);

// phase_spider — shadow_realm deep, astral_rift deep (spider that exists between planes)
ENEMY_POOLS.shadow_realm.deep.push(
  { id: 'inv_phase_spider', name: 'Phase Spider', hp: 110, atk: 30, def: 12, xp: 56, gold: 28, invisibility: 'spectral', archetype: 'skirmisher', isLiving: false }
);
ENEMY_POOLS.astral_rift.deep.push(
  { id: 'inv_phase_spider_ar', name: 'Phase Spider', hp: 110, atk: 30, def: 12, xp: 56, gold: 28, invisibility: 'spectral', archetype: 'skirmisher', isLiving: false }
);

// banshee_echo — bone_yard mid, shadow_realm mid (echo of a banshee, barely corporeal)
ENEMY_POOLS.bone_yard.mid.push(
  { id: 'inv_banshee_echo', name: 'Banshee Echo', hp: 45, atk: 24, def: 4, xp: 30, gold: 14, invisibility: 'spectral', archetype: 'ranged', isLiving: false,
    abilities: [{ id: 'echo_wail', name: 'Echo Wail', damage: 1.2, range: 3, windUp: 2, cooldown: 4, weight: 10, effect: 'fear', effectChance: 0.35 }] }
);
ENEMY_POOLS.shadow_realm.mid.push(
  { id: 'inv_banshee_echo_sr', name: 'Banshee Echo', hp: 45, atk: 24, def: 4, xp: 30, gold: 14, invisibility: 'spectral', archetype: 'ranged', isLiving: false,
    abilities: [{ id: 'echo_wail', name: 'Echo Wail', damage: 1.2, range: 3, windUp: 2, cooldown: 4, weight: 10, effect: 'fear', effectChance: 0.35 }] }
);

// --- AMBUSH STEALTH (4 enemies) ---
// mimic_chest — added to multiple theme pools deep tier (disguised as a chest)
// stone_keep, crystal_cavern, sand_tomb, bone_yard
ENEMY_POOLS.stone_keep.deep.push(
  { id: 'inv_mimic_chest', name: 'Mimic Chest', hp: 140, atk: 28, def: 18, xp: 60, gold: 40, invisibility: 'ambush', archetype: 'bruiser' }
);
ENEMY_POOLS.crystal_cavern.deep.push(
  { id: 'inv_mimic_chest_cc', name: 'Mimic Chest', hp: 140, atk: 28, def: 18, xp: 60, gold: 40, invisibility: 'ambush', archetype: 'bruiser' }
);
ENEMY_POOLS.sand_tomb.deep.push(
  { id: 'inv_mimic_chest_st', name: 'Mimic Chest', hp: 140, atk: 28, def: 18, xp: 60, gold: 40, invisibility: 'ambush', archetype: 'bruiser' }
);
ENEMY_POOLS.bone_yard.deep.push(
  { id: 'inv_mimic_chest_by', name: 'Mimic Chest', hp: 140, atk: 28, def: 18, xp: 60, gold: 40, invisibility: 'ambush', archetype: 'bruiser' }
);

// trapdoor_spider — crystal_cavern mid, spider_hive mid, fungal_forest mid (hides in floor tiles, springs up)
ENEMY_POOLS.crystal_cavern.mid.push(
  { id: 'inv_trapdoor_spider', name: 'Trapdoor Spider', hp: 60, atk: 20, def: 8, xp: 30, gold: 12, invisibility: 'ambush', archetype: 'skirmisher' }
);
ENEMY_POOLS.spider_hive.mid.push(
  { id: 'inv_trapdoor_spider_sh', name: 'Trapdoor Spider', hp: 60, atk: 20, def: 8, xp: 30, gold: 12, invisibility: 'ambush', archetype: 'skirmisher' }
);
ENEMY_POOLS.fungal_forest.mid.push(
  { id: 'inv_trapdoor_spider_ff', name: 'Trapdoor Spider', hp: 60, atk: 20, def: 8, xp: 30, gold: 12, invisibility: 'ambush', archetype: 'skirmisher' }
);

// sand_lurker — sand_tomb mid+deep (buried in sand/dirt floor)
ENEMY_POOLS.sand_tomb.mid.push(
  { id: 'inv_sand_lurker', name: 'Sand Lurker', hp: 70, atk: 18, def: 10, xp: 32, gold: 14, invisibility: 'ambush', archetype: 'bruiser' }
);
ENEMY_POOLS.sand_tomb.deep.push(
  { id: 'inv_sand_lurker_d', name: 'Sand Lurker', hp: 140, atk: 26, def: 18, xp: 62, gold: 32, invisibility: 'ambush', archetype: 'bruiser' }
);

// ceiling_lurker — stone_keep mid, iron_forge mid, haunted_manor mid (hangs from ceiling above doorways)
ENEMY_POOLS.stone_keep.mid.push(
  { id: 'inv_ceiling_lurker', name: 'Ceiling Lurker', hp: 55, atk: 22, def: 6, xp: 28, gold: 12, invisibility: 'ambush', archetype: 'skirmisher' }
);
ENEMY_POOLS.iron_forge.mid.push(
  { id: 'inv_ceiling_lurker_if', name: 'Ceiling Lurker', hp: 55, atk: 22, def: 6, xp: 28, gold: 12, invisibility: 'ambush', archetype: 'skirmisher' }
);
ENEMY_POOLS.haunted_manor.mid.push(
  { id: 'inv_ceiling_lurker_hm', name: 'Ceiling Lurker', hp: 55, atk: 22, def: 6, xp: 28, gold: 12, invisibility: 'ambush', archetype: 'skirmisher' }
);

module.exports = { FLOOR_LAYOUTS: FLOOR_LAYOUTS, ENEMY_POOLS: ENEMY_POOLS };
