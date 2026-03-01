// world-data.js
// World resource types, farming/animal definitions, furniture, station upgrades,
// biome resources, crafting recipes, food effects, crafting perks, economy
// constants, icon registry, world quests, and biome weather.

// ---------------------------------------------------------------------------
// Resource Types (extends existing wood, stone, iron_ore, iron_bar)
// ---------------------------------------------------------------------------

const ALL_RESOURCE_TYPES = [
  'wood', 'stone', 'iron_ore', 'iron_bar',
  'bronze_ore', 'bronze_bar',
  'copper_ore', 'copper_bar',
  'silver_ore', 'silver_bar',
  'gold_ore', 'gold_bar',
  'steel_bar',
  'mithril_ore', 'mithril_bar',
  'fish', 'cooked_fish', 'shellfish', 'seaweed',
  'wheat', 'herbs', 'vegetables', 'mushroom',
  'bread', 'stew',
  'glass_sand', 'glass', 'glass_lens', 'glass_vial',
  'cogs', 'gears', 'springs', 'clockwork_core',
  'mana_crystal',
  'gem_rough', 'gem_cut',
  'potion_health', 'potion_mana',
  // Dungeon resources
  'dungeon_essence', 'dark_crystal', 'boss_trophy',
  // Light sources
  'torch', 'lantern', 'oil',
  // Leviathan resources
  'leviathan_scale', 'leviathan_shell', 'leviathan_heart', 'leviathan_fang',
  'kraken_ink', 'kraken_beak', 'serpent_fang', 'storm_scale',
  'ancient_coral', 'coral_trophy', 'lightning_essence', 'sea_mount_egg',
  // Sewing / tailoring resources
  'hide', 'leather', 'wool', 'thread', 'cloth', 'silk', 'silk_cloth',
  // Alchemy products
  'potion_strength', 'potion_agility', 'potion_intellect', 'potion_resistance', 'potion_speed',
  'elixir_vigor', 'elixir_fortitude',
  'poison_vial', 'antidote',
  'flask_of_fire', 'flask_of_frost',
  'transmutation_dust', 'philosophers_stone_shard',
  // Enchanting products
  'scroll_of_protection', 'scroll_of_strength', 'scroll_of_haste',
  'rune_stone_fire', 'rune_stone_ice', 'rune_stone_lightning',
  'enchantment_shard', 'arcane_essence', 'sigil_ink',
  // Brewing products
  'ale', 'mead', 'wine', 'spirits', 'fortified_ale', 'battle_brew',
  // Corruption cleansing
  'purification_crystal',
  // Advanced materials (loot-generator)
  'stormsteel_ore', 'stormsteel_bar',
  'deepsilver_ore', 'deepsilver_bar',
  'soulforged_bar',
  'voidmetal_ore', 'voidmetal_bar',
  // Gem resources (cut gems for socketing)
  'ruby', 'emerald', 'sapphire', 'topaz', 'amethyst',
  'diamond', 'onyx', 'opal', 'moonstone',
  'jade', 'bloodstone', 'void_shard',
  // Augment resources
  'coiled_spring', 'barbed_edge', 'resonant_core', 'clockwork_sight',
  'venom_reservoir', 'mana_conduit',
  'reactive_plating', 'sigil_ward', 'dampening_weave', 'thorned_plates', 'vitality_mesh',
  // Seeds
  'wheat_seed', 'herb_seed', 'vegetable_seed', 'mushroom_spore', 'berry_seed',
  'tea_leaf_seed', 'pumpkin_seed', 'corn_seed', 'rare_flower_seed', 'ancient_seed',
  // New crops
  'berries', 'tea_leaves', 'pumpkin', 'corn', 'rare_flower', 'ancient_fruit',
  // Seasonal exotic crops
  'frost_lily', 'void_root', 'sun_wheat', 'shadow_moss', 'blood_vine',
  'crystal_berry', 'storm_grain', 'ember_pepper', 'moon_petal', 'deep_mushroom',
  // Seasonal exotic seeds
  'frost_lily_seed', 'void_root_seed', 'sun_wheat_seed', 'shadow_moss_seed',
  'blood_vine_seed', 'crystal_berry_seed', 'storm_grain_seed', 'ember_pepper_seed',
  'moon_petal_seed', 'deep_mushroom_seed',
  // Animal products
  'egg', 'milk', 'raw_wool', 'raw_meat', 'feather', 'honey', 'cheese', 'butter',
  // Animal feed
  'animal_feed',
  // Monster capture
  'taming_net',
];

// ---------------------------------------------------------------------------
// Crop Definitions (farming system)
// ---------------------------------------------------------------------------

const CROP_DEFINITIONS = {
  wheat_seed:      { output: 'wheat',        growthTime: 600,  farmLevel: 1,  xp: 15,  yieldMin: 2, yieldMax: 4, seedBackChance: 0.30, nightBonus: false },
  herb_seed:       { output: 'herbs',        growthTime: 480,  farmLevel: 1,  xp: 12,  yieldMin: 1, yieldMax: 3, seedBackChance: 0.25, nightBonus: false },
  vegetable_seed:  { output: 'vegetables',   growthTime: 720,  farmLevel: 3,  xp: 20,  yieldMin: 2, yieldMax: 5, seedBackChance: 0,    nightBonus: false },
  mushroom_spore:  { output: 'mushroom',     growthTime: 360,  farmLevel: 2,  xp: 18,  yieldMin: 1, yieldMax: 3, seedBackChance: 0,    nightBonus: true },
  berry_seed:      { output: 'berries',      growthTime: 540,  farmLevel: 5,  xp: 22,  yieldMin: 3, yieldMax: 6, seedBackChance: 0,    nightBonus: false },
  tea_leaf_seed:   { output: 'tea_leaves',   growthTime: 900,  farmLevel: 8,  xp: 30,  yieldMin: 1, yieldMax: 2, seedBackChance: 0,    nightBonus: false },
  pumpkin_seed:    { output: 'pumpkin',      growthTime: 1200, farmLevel: 10, xp: 40,  yieldMin: 1, yieldMax: 2, seedBackChance: 0,    nightBonus: false },
  corn_seed:       { output: 'corn',         growthTime: 900,  farmLevel: 7,  xp: 28,  yieldMin: 2, yieldMax: 4, seedBackChance: 0,    nightBonus: false },
  rare_flower_seed:{ output: 'rare_flower',  growthTime: 1800, farmLevel: 15, xp: 60,  yieldMin: 1, yieldMax: 1, seedBackChance: 0.05, nightBonus: false },
  ancient_seed:    { output: 'ancient_fruit', growthTime: 3600, farmLevel: 25, xp: 100, yieldMin: 1, yieldMax: 1, seedBackChance: 0.02, nightBonus: false },
};

// Growth stages: 0=seed, 1=sprout, 2=growing, 3=mature, 4=withered
const CROP_STAGES = ['seed', 'sprout', 'growing', 'mature', 'withered'];
const CROP_WITHER_MULTIPLIER = 2; // withers after 2x growthTime unharvested

// ---------------------------------------------------------------------------
// Animal Definitions (farming system)
// ---------------------------------------------------------------------------

const ANIMAL_DEFINITIONS = {
  chicken:  { cost: 50,  feedType: 'wheat',      feedAmount: 1, feedInterval: 600,  products: [{ type: 'egg', min: 1, max: 2 }, { type: 'feather', min: 1, max: 1, chance: 0.30 }], productInterval: 300,  farmLevel: 5,  maxPerPen: 4 },
  cow:      { cost: 200, feedType: 'wheat',      feedAmount: 3, feedInterval: 600,  products: [{ type: 'milk', min: 1, max: 1 }],                                                   productInterval: 600,  farmLevel: 10, maxPerPen: 2 },
  sheep:    { cost: 150, feedType: 'wheat',      feedAmount: 2, feedInterval: 600,  products: [{ type: 'raw_wool', min: 1, max: 2 }],                                                productInterval: 900,  farmLevel: 8,  maxPerPen: 3 },
  pig:      { cost: 120, feedType: 'vegetables', feedAmount: 2, feedInterval: 600,  products: [{ type: 'mushroom', min: 1, max: 3, chance: 0.60 }],                                  productInterval: 1200, farmLevel: 12, maxPerPen: 3 },
  bee_hive: { cost: 300, feedType: null,         feedAmount: 0, feedInterval: 0,     products: [{ type: 'honey', min: 1, max: 1 }],                                                  productInterval: 1800, farmLevel: 15, maxPerPen: 1 },
};

const ANIMAL_HAPPINESS_MAX = 100;
const ANIMAL_HAPPINESS_MISS_PENALTY = 5;
const ANIMAL_HAPPINESS_HALF_THRESHOLD = 49;
const ANIMAL_HAPPINESS_STOP_THRESHOLD = 25;
const ANIMAL_MAX_PENDING_PRODUCTS = 10;

// ---------------------------------------------------------------------------
// Furniture Effects (base building)
// ---------------------------------------------------------------------------

const FURNITURE_EFFECTS = {
  bed:           { effect: 'rested_buff',    value: { vigBonus: 2, xpBonus: 0.10, duration: 600 }, stackLimit: 1, description: 'Sleep → +2 VIG, +10% XP for 10min' },
  bookshelf:     { effect: 'skill_xp_bonus', value: 0.05,  stackLimit: 3,  description: '+5% all skill XP on plot (max 15%)' },
  lantern:       { effect: 'night_penalty',  value: -0.10, stackLimit: 6,  description: '-10% night penalty on plot' },
  clock:         { effect: 'crop_growth',    value: 0.05,  stackLimit: 1,  description: '+5% crop growth speed' },
  scarecrow:     { effect: 'wither_prevent', value: 0.15,  stackLimit: 4,  description: '15% prevent crop wither' },
  well:          { effect: 'water_radius',   value: 400,   stackLimit: 1,  description: '400px water radius (vs 200px trough)' },
  sprinkler:     { effect: 'auto_water',     value: 150,   stackLimit: 99, description: 'Auto-water crops within 150px each tick' },
  trophy_mount:  { effect: 'presence_bonus', value: 1,     stackLimit: 5,  description: '+1 Presence per trophy' },
};

// ---------------------------------------------------------------------------
// Station Upgrade Tiers (base building)
// ---------------------------------------------------------------------------

const STATION_UPGRADE_TIERS = {
  forge:             { tier: 1, qualityBonus: 0,    extras: {} },
  advanced_forge:    { tier: 2, qualityBonus: 0.10, extras: {},                             upgradedFrom: 'forge' },
  master_forge:      { tier: 3, qualityBonus: 0.25, extras: { rareMaterialChance: 0.05 },   upgradedFrom: 'advanced_forge' },
  alchemy_table:     { tier: 1, qualityBonus: 0,    extras: {} },
  advanced_alchemy_table: { tier: 2, qualityBonus: 0.15, extras: {},                        upgradedFrom: 'alchemy_table' },
  master_alchemy_table:   { tier: 3, qualityBonus: 0.30, extras: { doublePotionChance: 0.10 }, upgradedFrom: 'advanced_alchemy_table' },
  loom:              { tier: 1, qualityBonus: 0,    extras: {} },
  advanced_loom:     { tier: 2, qualityBonus: 0.10, extras: {},                             upgradedFrom: 'loom' },
  master_loom:       { tier: 3, qualityBonus: 0.20, extras: { materialSaveChance: 0.10 },   upgradedFrom: 'advanced_loom' },
  brewery:           { tier: 1, qualityBonus: 0,    extras: {} },
  advanced_brewery:  { tier: 2, qualityBonus: 0.10, extras: {},                             upgradedFrom: 'brewery' },
  master_brewery:    { tier: 3, qualityBonus: 0.20, extras: { doubleBrewChance: 0.08 },     upgradedFrom: 'advanced_brewery' },
  enchanting_table:  { tier: 1, qualityBonus: 0,    extras: {} },
  advanced_enchanting_table: { tier: 2, qualityBonus: 0.15, extras: { inscriptionBonus: 0.10 }, upgradedFrom: 'enchanting_table' },
};

// ---------------------------------------------------------------------------
// New Biome Resource Tables (additive to existing worldgen tables)
// ---------------------------------------------------------------------------

const NEW_BIOME_RESOURCES = {
  PLAINS: [
    { type: 'wheat', name: 'Wheat Field', skill: 'farming', minLevel: 1, xp: 12, weight: 4 },
    { type: 'herbs', name: 'Wild Herbs', skill: 'farming', minLevel: 1, xp: 10, weight: 3 },
    { type: 'vegetables', name: 'Vegetable Patch', skill: 'farming', minLevel: 1, xp: 10, weight: 3 },
    { type: 'copper_ore', name: 'Copper Vein', skill: 'mining', minLevel: 1, xp: 10, weight: 3 },
  ],
  BEACH: [
    { type: 'fish_spot', name: 'Fishing Spot', skill: 'fishing', minLevel: 1, xp: 12, weight: 5 },
    { type: 'shellfish_spot', name: 'Shellfish Bed', skill: 'fishing', minLevel: 2, xp: 15, weight: 3 },
    { type: 'seaweed_spot', name: 'Seaweed Patch', skill: 'fishing', minLevel: 1, xp: 8, weight: 2 },
  ],
  SWAMP: [
    { type: 'herbs', name: 'Swamp Herbs', skill: 'farming', minLevel: 2, xp: 15, weight: 4 },
    { type: 'fish_spot', name: 'Muddy Pool', skill: 'fishing', minLevel: 1, xp: 12, weight: 3 },
    { type: 'mushroom', name: 'Mushroom Cluster', skill: 'farming', minLevel: 1, xp: 10, weight: 3 },
  ],
  SCORCHED_SANDS: [
    { type: 'glass_sand', name: 'Glass Sand Deposit', skill: 'glassworking', minLevel: 1, xp: 15, weight: 6 },
    { type: 'gem_rough', name: 'Rough Gem Vein', skill: 'mining', minLevel: 5, xp: 30, weight: 4 },
  ],
  CLOCKWORK_HARBOR: [
    { type: 'cogs', name: 'Scattered Cogs', skill: 'cogworking', minLevel: 1, xp: 12, weight: 5 },
    { type: 'springs', name: 'Broken Springs', skill: 'cogworking', minLevel: 2, xp: 15, weight: 3 },
    { type: 'gears', name: 'Gear Assembly', skill: 'cogworking', minLevel: 3, xp: 20, weight: 2 },
  ],
  ELVEN_SOUTH: [
    { type: 'herbs', name: 'Ancient Herbs', skill: 'farming', minLevel: 3, xp: 20, weight: 3 },
    { type: 'mana_crystal_node', name: 'Mana Crystal', skill: 'magic', minLevel: 5, xp: 30, weight: 2 },
  ],
  HOLY_DOMINION: [
    { type: 'wheat', name: 'Dominion Wheat', skill: 'farming', minLevel: 1, xp: 10, weight: 3 },
    { type: 'herbs', name: 'Temple Herbs', skill: 'farming', minLevel: 2, xp: 12, weight: 2 },
  ],
  MOUNTAIN: [
    { type: 'copper_ore', name: 'Copper Vein', skill: 'mining', minLevel: 1, xp: 10, weight: 5 },
    { type: 'silver_ore', name: 'Silver Vein', skill: 'mining', minLevel: 8, xp: 35, weight: 2 },
  ],
  SNOW_MOUNTAINS: [
    { type: 'silver_ore', name: 'Frozen Silver Vein', skill: 'mining', minLevel: 8, xp: 35, weight: 3 },
    { type: 'mithril_ore', name: 'Mithril Deposit', skill: 'mining', minLevel: 15, xp: 60, weight: 1 },
  ],
  VOLCANIC: [
    { type: 'gold_ore', name: 'Gold Vein', skill: 'mining', minLevel: 10, xp: 45, weight: 2 },
    { type: 'iron_ore', name: 'Volcanic Iron', skill: 'mining', minLevel: 3, xp: 18, weight: 4 },
  ],
  DARK_FOREST: [
    { type: 'copper_ore', name: 'Hidden Copper Vein', skill: 'mining', minLevel: 1, xp: 12, weight: 3 },
    { type: 'bronze_ore', name: 'Forest Bronze Deposit', skill: 'mining', minLevel: 3, xp: 18, weight: 2 },
  ],
  DESERT: [
    { type: 'gold_ore', name: 'Desert Gold Vein', skill: 'mining', minLevel: 10, xp: 45, weight: 2 },
    { type: 'copper_ore', name: 'Sandstone Copper', skill: 'mining', minLevel: 2, xp: 12, weight: 3 },
  ],
};

// ---------------------------------------------------------------------------
// New Crafting Recipes
// ---------------------------------------------------------------------------

const NEW_RECIPES = {
  bronze_bar: {
    station: 'forge',
    cost: { bronze_ore: 2 },
    output: { type: 'bronze_bar', name: 'Bronze Bar' },
    resource: 'bronze_bar',
    skillReq: { crafting: 3 },
  },
  copper_bar: {
    station: 'forge',
    cost: { copper_ore: 2 },
    output: { type: 'copper_bar', name: 'Copper Bar' },
    resource: 'copper_bar',
    skillReq: { crafting: 1 },
  },
  silver_bar: {
    station: 'forge',
    cost: { silver_ore: 2 },
    output: { type: 'silver_bar', name: 'Silver Bar' },
    resource: 'silver_bar',
    skillReq: { crafting: 8 },
  },
  gold_bar: {
    station: 'forge',
    cost: { gold_ore: 2 },
    output: { type: 'gold_bar', name: 'Gold Bar' },
    resource: 'gold_bar',
    skillReq: { crafting: 12 },
  },
  steel_bar: {
    station: 'forge',
    cost: { iron_bar: 2, bronze_bar: 1 },
    output: { type: 'steel_bar', name: 'Steel Bar' },
    resource: 'steel_bar',
    skillReq: { crafting: 10 },
  },
  mithril_bar: {
    station: 'forge',
    cost: { mithril_ore: 3, mana_crystal: 1 },
    output: { type: 'mithril_bar', name: 'Mithril Bar' },
    resource: 'mithril_bar',
    skillReq: { crafting: 18 },
  },
  cooked_fish: {
    station: 'forge',
    cost: { fish: 1 },
    output: { type: 'cooked_fish', name: 'Cooked Fish' },
    resource: 'cooked_fish',
    skillReq: { cooking: 1 },
  },
  bread: {
    station: 'forge',
    cost: { wheat: 3 },
    output: { type: 'bread', name: 'Bread' },
    resource: 'bread',
    skillReq: { cooking: 2 },
  },
  stew: {
    station: 'forge',
    cost: { cooked_fish: 1, vegetables: 2, herbs: 1 },
    output: { type: 'stew', name: 'Hearty Stew' },
    resource: 'stew',
    skillReq: { cooking: 5 },
  },
  glass: {
    station: 'forge',
    cost: { glass_sand: 3 },
    output: { type: 'glass', name: 'Glass' },
    resource: 'glass',
    skillReq: { glassworking: 1 },
  },
  glass_lens: {
    station: 'forge',
    cost: { glass: 2 },
    output: { type: 'glass_lens', name: 'Glass Lens' },
    resource: 'glass_lens',
    skillReq: { glassworking: 5 },
  },
  glass_vial: {
    station: 'forge',
    cost: { glass: 1 },
    output: { type: 'glass_vial', name: 'Glass Vial' },
    resource: 'glass_vial',
    skillReq: { glassworking: 3 },
  },
  clockwork_core: {
    station: 'anvil',
    cost: { cogs: 5, gears: 3, springs: 2 },
    output: { type: 'clockwork_core', name: 'Clockwork Core' },
    resource: 'clockwork_core',
    skillReq: { cogworking: 10 },
  },
  potion_health: {
    station: 'none',
    cost: { herbs: 3, glass_vial: 1 },
    output: { type: 'potion_health', name: 'Health Potion' },
    resource: 'potion_health',
    skillReq: { cooking: 5 },
  },
  potion_mana: {
    station: 'none',
    cost: { mana_crystal: 1, glass_vial: 1 },
    output: { type: 'potion_mana', name: 'Mana Potion' },
    resource: 'potion_mana',
    skillReq: { magic: 5 },
  },
  gem_cut: {
    station: 'anvil',
    cost: { gem_rough: 1 },
    output: { type: 'gem_cut', name: 'Cut Gem' },
    resource: 'gem_cut',
    skillReq: { crafting: 8 },
  },
  torch: {
    station: 'none',
    cost: { wood: 2, herbs: 1 },
    output: { type: 'torch', name: 'Torch', count: 3 },
    resource: 'torch',
    skillReq: { crafting: 1 },
  },
  lantern: {
    station: 'forge',
    cost: { iron_bar: 2, glass: 1, oil: 1 },
    output: { type: 'lantern', name: 'Lantern' },
    resource: 'lantern',
    skillReq: { crafting: 8 },
  },
  oil: {
    station: 'none',
    cost: { herbs: 2, mushroom: 1 },
    output: { type: 'oil', name: 'Oil Flask', count: 2 },
    resource: 'oil',
    skillReq: { cooking: 3 },
  },

  // ===== CORRUPTION CLEANSING =====
  purification_crystal: {
    station: 'none',
    cost: { mana_crystal: 5, gem_cut: 3, herbs: 1 },
    output: { type: 'purification_crystal', name: 'Purification Crystal' },
    resource: 'purification_crystal',
    skillReq: { magic: 15 },
  },

  // ===== SEWING MATERIAL PROCESSING (loom station) =====
  leather: {
    station: 'loom',
    cost: { hide: 2 },
    output: { type: 'leather', name: 'Leather' },
    resource: 'leather',
    skillReq: { sewing: 1 },
  },
  thread: {
    station: 'loom',
    cost: { wool: 2 },
    output: { type: 'thread', name: 'Thread' },
    resource: 'thread',
    skillReq: { sewing: 1 },
  },
  cloth: {
    station: 'loom',
    cost: { thread: 3 },
    output: { type: 'cloth', name: 'Cloth' },
    resource: 'cloth',
    skillReq: { sewing: 2 },
  },
  silk_cloth: {
    station: 'loom',
    cost: { silk: 2, thread: 1 },
    output: { type: 'silk_cloth', name: 'Silk Cloth' },
    resource: 'silk_cloth',
    skillReq: { sewing: 12 },
  },
};

// ---------------------------------------------------------------------------
// NPC Card Vendor Prices
// ---------------------------------------------------------------------------

const CARD_VENDOR_PRICES = {
  common: 50,
  uncommon: 200,
};

const CARD_BUYBACK_RATE = 0.25; // 25% of base value

const RARITY_BASE_VALUE = {
  common: 50,
  uncommon: 200,
  rare: 500,
  ultra_rare: 1500,
  mythic_rare: 5000,
  legendary: 15000,
  godly: 50000,
  relic: 200000,
};

// ---------------------------------------------------------------------------
// Auction House Defaults
// ---------------------------------------------------------------------------

const AUCTION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const AUCTION_MIN_PRICE = 10;
const AUCTION_MAX_LISTINGS_PER_PLAYER = 10;

// ---------------------------------------------------------------------------
// Icon Registry - maps item/resource types to icon paths
// ---------------------------------------------------------------------------

const ICON_REGISTRY = {
  // Resources
  wood: 'resources/Logs.PNG',
  stone: 'resources/Stones.PNG',
  iron_ore: 'resources/Mineral.PNG',
  iron_bar: 'resources/Res_07_ironbar.PNG',
  copper_ore: 'resources/Res_02_cooperbar.PNG',
  copper_bar: 'resources/CopperBar.PNG',
  bronze_ore: 'resources/Res_02_cooperbar.PNG',
  bronze_bar: 'resources/CopperBar.PNG',
  silver_ore: 'resources/Res_01_silverbar.PNG',
  silver_bar: 'resources/SilverBar.PNG',
  gold_ore: 'resources/MineralGold.PNG',
  gold_bar: 'resources/Res_03_goldenbar.PNG',
  steel_bar: 'resources/Res_07_ironbar.PNG',
  mithril_ore: 'resources/Res_05_magicbar.PNG',
  mithril_bar: 'resources/Res_06_magicbar.PNG',
  mana_crystal: 'resources/Res_25_crystal.PNG',
  gem_rough: 'resources/Res_75_crystalS.PNG',
  gem_cut: 'resources/Res_76_crystalRed.PNG',
  dungeon_essence: 'resources/Res_167_MageCrystal.PNG',
  dark_crystal: 'resources/Res_109_brokenCrystal.PNG',
  boss_trophy: 'loot/Loot_34_necklace.PNG',
  fish: 'resources/FishRed.PNG',
  cooked_fish: 'resources/FishRedFried.PNG',
  shellfish: 'resources/Shell.PNG',
  seaweed: 'resources/Res_59_seaweed.PNG',
  wheat: 'resources/Spikelets.PNG',
  herbs: 'resources/Res_52_leaves.PNG',
  vegetables: 'resources/Vegetables.PNG',
  mushroom: 'resources/Mushrooms.PNG',
  bread: 'resources/Bread.PNG',
  stew: 'resources/BowlMeat.PNG',
  glass_sand: 'resources/Res_08_stones.PNG',
  glass: 'resources/Res_104_colb.PNG',
  glass_lens: 'resources/Res_105_colbEmpty.PNG',
  glass_vial: 'resources/Res_105_colbEmpty.PNG',
  cogs: 'loot/Loot_52_metal.PNG',
  gears: 'loot/Loot_52_metal.PNG',
  springs: 'loot/Loot_52_metal.PNG',
  clockwork_core: 'loot/Loot_53_sphere.PNG',
  // Potions
  potion_health: 'items/Alchemy_13_heal_potion.PNG',
  potion_mana: 'items/Alchemy_17_blue_potion.PNG',
  potion_agility: 'items/Alchemy_24_energy_potion.PNG',
  potion_strength: 'items/Alchemy_25_stamina_potion.PNG',
  potion_intellect: 'items/Alchemy_17_blue_potion.PNG',
  potion_resistance: 'items/Alchemy_26_immortal_potion.PNG',
  potion_speed: 'items/Alchemy_35_invisibility_flask.PNG',
  // Coins and currency
  coins: 'resources/GoldCoin.PNG',
  // Building materials
  forge: 'building/Forge.PNG',
  iron_anvil: 'building/Anvil.PNG',
  storage_chest: 'building/MetalChest.PNG',
  wall: 'building/StoneWall.PNG',
  door: 'building/Gates.PNG',
  bridge: 'building/PlatformWithWood.PNG',
  plot_stake: 'building/Stakes.PNG',
  // Tools
  iron_axe: 'building/BasicAxe.PNG',
  iron_pickaxe: 'building/BasicPick.PNG',
  // Loot
  iron_lock: 'quest/Quest_112_lock.PNG',
  key: 'loot/Loot_54_key.PNG',
  // Quest items
  quest_scroll: 'quest/Quest_17_scroll.PNG',
  quest_map: 'loot/Loot_153_map.PNG',
  // Skills
  skill_attack: 'skills/Skill_Attack.PNG',
  skill_defense: 'skills/Skill_Defence.PNG',
  skill_mining: 'skills/Skill_Mining.PNG',
  skill_logging: 'skills/Skill_Logging.PNG',
  skill_heal: 'skills/Skill_Heal.PNG',
};

// ---------------------------------------------------------------------------
// Food Effects (healing + buffs when consumed)
// ---------------------------------------------------------------------------

var FOOD_EFFECTS = {
  // Cooked food
  cooked_fish:   { hpRestore: 20, buff: null },
  bread:         { hpRestore: 15, buff: null },
  stew:          { hpRestore: 40, buff: { stat: 'vigor', value: 2, duration: 120 } },
  mushroom:      { hpRestore: 10, buff: null },
  shellfish:     { hpRestore: 12, buff: null },
  seaweed:       { hpRestore: 8,  buff: { stat: 'resolve', value: 1, duration: 60 } },
  herb_tea:      { hpRestore: 25, buff: { stat: 'focus', value: 2, duration: 90 } },
  grilled_meat:  { hpRestore: 35, buff: { stat: 'might', value: 1, duration: 60 } },
  berry_jam:     { hpRestore: 15, buff: { stat: 'finesse', value: 1, duration: 60 } },
  cheese_wheel:  { hpRestore: 30, buff: { stat: 'vigor', value: 2, duration: 90 } },
  corn_bread:    { hpRestore: 25, buff: { stat: 'resolve', value: 1, duration: 60 } },
  honey_cake:    { hpRestore: 35, buff: { stat: 'presence', value: 2, duration: 120 } },
  pumpkin_pie:   { hpRestore: 45, buff: { stat: 'vigor', value: 3, duration: 120 } },
  ancient_fruit_wine: { hpRestore: 50, buff: { stat: 'acumen', value: 4, duration: 180 } },

  // Alchemy potions
  potion_health:     { hpRestore: 50, buff: null },
  potion_mana:       { hpRestore: 0,  buff: { stat: 'acumen', value: 2, duration: 60 } },
  potion_strength:   { hpRestore: 0,  buff: { stat: 'might', value: 3, duration: 120 } },
  potion_agility:    { hpRestore: 0,  buff: { stat: 'finesse', value: 3, duration: 120 } },
  potion_intellect:  { hpRestore: 0,  buff: { stat: 'acumen', value: 3, duration: 120 } },
  potion_resistance: { hpRestore: 0,  buff: { stat: 'resolve', value: 3, duration: 120 } },
  potion_speed:      { hpRestore: 0,  buff: { stat: 'finesse', value: 2, duration: 60 } },
  elixir_vigor:      { hpRestore: 50, buff: { stat: 'vigor', value: 5, duration: 180 } },
  elixir_fortitude:  { hpRestore: 30, buff: { stat: 'resolve', value: 5, duration: 180 } },
  antidote:          { hpRestore: 10, buff: { stat: 'resolve', value: 1, duration: 30 } },

  // Brewing drinks
  ale:            { hpRestore: 5,  buff: { stat: 'might', value: 1, duration: 60 } },
  mead:           { hpRestore: 10, buff: { stat: 'vigor', value: 2, duration: 90 } },
  wine:           { hpRestore: 8,  buff: { stat: 'presence', value: 3, duration: 120 } },
  spirits:        { hpRestore: 5,  buff: { stat: 'might', value: 3, duration: 60 } },
  fortified_ale:  { hpRestore: 15, buff: { stat: 'vigor', value: 3, duration: 120 } },
  battle_brew:    { hpRestore: 20, buff: { stat: 'might', value: 4, duration: 180 } },

  // Scrolls (instant buff effects)
  scroll_of_protection: { hpRestore: 0, buff: { stat: 'resolve', value: 5, duration: 180 } },
  scroll_of_strength:   { hpRestore: 0, buff: { stat: 'might', value: 5, duration: 180 } },
  scroll_of_haste:      { hpRestore: 0, buff: { stat: 'finesse', value: 5, duration: 180 } },
};

// ---------------------------------------------------------------------------
// Crafting Skill Perks (unlocked at milestone skill levels)
// ---------------------------------------------------------------------------

var CRAFTING_SKILL_PERKS = {
  crafting: [
    { level: 5,  id: 'efficient_crafter', ingredientSaveChance: 0.10 },
    { level: 10, id: 'quality_work', qualityBonus: 1 },
    { level: 15, id: 'master_smith', flatItemStatBonus: 1 },
    { level: 20, id: 'batch_craft', batchCraftChance: 0.50 },
    { level: 30, id: 'grandmaster', enhancedItemChance: 0.15 },
  ],
  cooking: [
    { level: 3,  id: 'hearty_meals', foodHealMult: 1.25 },
    { level: 7,  id: 'gourmet', foodXpBuff: true },
    { level: 10, id: 'master_cook', foodHealMult: 1.50 },
    { level: 15, id: 'nutritional_expert', foodBuffDurationMult: 1.50 },
    { level: 20, id: 'legendary_chef', feastChance: 0.15 },
  ],
  sewing: [
    { level: 5,  id: 'thrifty_tailor', ingredientSaveChance: 0.05 },
    { level: 10, id: 'fine_stitching', qualityBonus: 0.05 },
    { level: 15, id: 'efficient_weaver', doubleOutputChance: 0.08, ingredientSaveChance: 0.10 },
    { level: 20, id: 'arcane_thread', qualityBonus: 0.15, magicResistBonus: 0.05 },
    { level: 25, id: 'master_tailor', masterTailorChance: 0.10, ingredientSaveChance: 0.15 },
  ],
  alchemy: [
    { level: 5,  id: 'herb_saver', ingredientSaveChance: 0.05 },
    { level: 10, id: 'potent_brews', potionPotencyBonus: 0.10 },
    { level: 15, id: 'double_distill', ingredientSaveChance: 0.10, doublePotionChance: 0.08 },
    { level: 20, id: 'alchemical_mastery', potionPotencyBonus: 0.20, potionDurationBonus: 0.15 },
    { level: 25, id: 'master_alchemist', masterAlchemistChance: 0.12, ingredientSaveChance: 0.15 },
  ],
  enchanting: [
    { level: 5,  id: 'mana_efficiency', enchantPowerBonus: 0.05 },
    { level: 10, id: 'crystal_focus', ingredientSaveChance: 0.05, enchantPowerBonus: 0.10 },
    { level: 15, id: 'double_enchant', doubleEnchantChance: 0.08 },
    { level: 20, id: 'arcane_mastery', enchantPowerBonus: 0.20, preserveBaseChance: 0.10 },
    { level: 25, id: 'master_enchanter', masterEnchantChance: 0.10, ingredientSaveChance: 0.10 },
  ],
  brewing: [
    { level: 5,  id: 'grain_saver', ingredientSaveChance: 0.05 },
    { level: 10, id: 'strong_brew', brewPotencyBonus: 0.10 },
    { level: 15, id: 'double_batch', doubleBatchChance: 0.10, ingredientSaveChance: 0.10 },
    { level: 20, id: 'aged_perfection', brewDurationBonus: 0.20 },
    { level: 25, id: 'master_brewer', masterBrewerChance: 0.12, ingredientSaveChance: 0.15 },
  ],
  leatherworking: [
    { level: 5,  id: 'hide_saver', ingredientSaveChance: 0.05 },
    { level: 10, id: 'quality_tanning', qualityBonus: 0.05 },
    { level: 15, id: 'efficient_tanner', ingredientSaveChance: 0.10, qualityBonus: 0.10 },
    { level: 20, id: 'hardened_leather', craftedArmorBonus: 2, qualityBonus: 0.15 },
    { level: 25, id: 'master_leatherworker', masterLeatherworkerChance: 0.10, ingredientSaveChance: 0.15 },
  ],
  jewelcrafting: [
    { level: 5,  id: 'gem_saver', ingredientSaveChance: 0.05 },
    { level: 10, id: 'gem_yield', qualityBonus: 0.05, gemYieldBonus: 0.10 },
    { level: 15, id: 'precision_cut', ingredientSaveChance: 0.10, qualityBonus: 0.10 },
    { level: 20, id: 'stat_imbue', statBonusOnCraft: 1, qualityBonus: 0.15 },
    { level: 25, id: 'master_jeweler', masterJewelerChance: 0.10, ingredientSaveChance: 0.15 },
  ],
};

function getCraftingSkillBonuses(account) {
  var bonuses = {};
  var skills = account.skills || {};
  var perkKeys = Object.keys(CRAFTING_SKILL_PERKS);
  for (var i = 0; i < perkKeys.length; i++) {
    var skillName = perkKeys[i];
    var skillLevel = (skills[skillName] && skills[skillName].level) ? skills[skillName].level : 1;
    var perks = CRAFTING_SKILL_PERKS[skillName];
    for (var p = 0; p < perks.length; p++) {
      var perk = perks[p];
      if (skillLevel >= perk.level) {
        var perkFields = Object.keys(perk);
        for (var f = 0; f < perkFields.length; f++) {
          var field = perkFields[f];
          // Skip metadata fields
          if (field === 'level' || field === 'id') continue;
          // Accumulate numeric bonuses, assign non-numeric directly
          if (typeof perk[field] === 'number') {
            bonuses[field] = (bonuses[field] || 0) + perk[field];
          } else {
            bonuses[field] = perk[field];
          }
        }
      }
    }
  }
  return bonuses;
}

// ---------------------------------------------------------------------------
// World Quest Templates
// ---------------------------------------------------------------------------

const WORLD_QUEST_TEMPLATES = [
  // Gathering quests
  { questId: 'wq_gather_herbs', name: 'Herb Collection', type: 'gather', description: 'Gather herbs for the local healer.',
    target: { resource: 'herbs', count: 10 }, rewards: { coins: 50, xp: 30, skillXp: { farming: 20 } },
    repeatableDaily: true, npcId: 'npc_solara_priest' },
  { questId: 'wq_gather_mushrooms', name: 'Mushroom Study', type: 'gather', description: 'Collect mushrooms for the Elder.',
    target: { resource: 'mushroom', count: 5 }, rewards: { coins: 35, xp: 25, skillXp: { farming: 15 } },
    repeatableDaily: true, npcId: 'npc_sylvaris_archivist' },
  { questId: 'wq_gather_iron', name: 'Iron Requisition', type: 'gather', description: 'Mine iron ore for the forge.',
    target: { resource: 'iron_ore', count: 8 }, rewards: { coins: 60, xp: 35, skillXp: { mining: 25 } },
    repeatableDaily: true, npcId: 'npc_ironhold_forgemaster' },
  { questId: 'wq_gather_wood', name: 'Timber Supply', type: 'gather', description: 'Chop wood for construction.',
    target: { resource: 'wood', count: 15 }, rewards: { coins: 40, xp: 20, skillXp: { woodcutting: 20 } },
    repeatableDaily: true },
  { questId: 'wq_gather_fish', name: 'Fresh Catch', type: 'gather', description: 'Catch fresh fish for the tavern.',
    target: { resource: 'fish', count: 8 }, rewards: { coins: 45, xp: 25, skillXp: { fishing: 20 } },
    repeatableDaily: true },

  // Crafting quests
  { questId: 'wq_craft_bread', name: 'Baker\'s Dozen', type: 'craft', description: 'Bake bread for the town.',
    target: { item: 'bread', count: 5 }, rewards: { coins: 55, xp: 30, skillXp: { cooking: 25 } },
    repeatableDaily: true },
  { questId: 'wq_craft_potions', name: 'Potion Restocking', type: 'craft', description: 'Brew health potions for the militia.',
    target: { item: 'potion_health', count: 3 }, rewards: { coins: 75, xp: 40, skillXp: { crafting: 30 } },
    repeatableDaily: true },
  { questId: 'wq_craft_iron_bars', name: 'Smelting Order', type: 'craft', description: 'Smelt iron ore into bars.',
    target: { item: 'iron_bar', count: 5 }, rewards: { coins: 50, xp: 30, skillXp: { crafting: 20 } },
    repeatableDaily: true },

  // More gathering quests
  { questId: 'wq_gather_shellfish', name: 'Shoreline Harvest', type: 'gather', description: 'Collect shellfish from the coastal shallows.',
    target: { resource: 'shellfish', count: 10 }, rewards: { coins: 50, xp: 30, skillXp: { fishing: 20 } },
    repeatableDaily: true, npcId: 'npc_murkmire_elder' },
  { questId: 'wq_gather_vegetables', name: 'Market Garden', type: 'gather', description: 'Bring fresh vegetables to the town market.',
    target: { resource: 'vegetables', count: 12 }, rewards: { coins: 40, xp: 25, skillXp: { farming: 20 } },
    repeatableDaily: true },
  { questId: 'wq_gather_gems', name: 'Jewel Expedition', type: 'gather', description: 'Mine rough gems from the deep veins.',
    target: { resource: 'gem_rough', count: 5 }, rewards: { coins: 90, xp: 55, skillXp: { mining: 40 } },
    repeatableDaily: true, npcId: 'npc_ironhold_forgemaster' },
  { questId: 'wq_gather_mana_crystals', name: 'Crystal Channeling', type: 'gather', description: 'Collect mana crystals pulsing with rift energy.',
    target: { resource: 'mana_crystal', count: 5 }, rewards: { coins: 100, xp: 65, skillXp: { magic: 35 } },
    repeatableDaily: true, npcId: 'npc_sylvaris_archivist' },
  { questId: 'wq_gather_seaweed', name: 'Alchemical Kelp', type: 'gather', description: 'Harvest seaweed for the apothecary.',
    target: { resource: 'seaweed', count: 8 }, rewards: { coins: 35, xp: 20, skillXp: { fishing: 15 } },
    repeatableDaily: true },
  { questId: 'wq_gather_bronze', name: 'Bronze Procurement', type: 'gather', description: 'Mine bronze ore for the engineers.',
    target: { resource: 'bronze_ore', count: 10 }, rewards: { coins: 55, xp: 30, skillXp: { mining: 22 } },
    repeatableDaily: true, npcId: 'npc_mechspire_clockwright' },

  // More crafting quests
  { questId: 'wq_craft_glass_vials', name: 'Vial Commission', type: 'craft', description: 'Blow glass vials for the alchemists.',
    target: { item: 'glass_vial', count: 6 }, rewards: { coins: 65, xp: 40, skillXp: { glassworking: 30 } },
    repeatableDaily: true, npcId: 'npc_solara_priest' },
  { questId: 'wq_craft_bronze_bars', name: 'Bronze Casting', type: 'craft', description: 'Cast bronze bars for the Gnomish engineers.',
    target: { item: 'bronze_bar', count: 5 }, rewards: { coins: 55, xp: 30, skillXp: { crafting: 20 } },
    repeatableDaily: true, npcId: 'npc_mechspire_clockwright' },
  { questId: 'wq_craft_cooked_fish', name: 'Tavern Special', type: 'craft', description: 'Cook fish for the tavern\'s evening menu.',
    target: { item: 'cooked_fish', count: 8 }, rewards: { coins: 50, xp: 30, skillXp: { cooking: 25 } },
    repeatableDaily: true },
  { questId: 'wq_craft_stew', name: 'Soldier\'s Ration', type: 'craft', description: 'Brew hearty stews for the militia barracks.',
    target: { item: 'stew', count: 4 }, rewards: { coins: 60, xp: 35, skillXp: { cooking: 30 } },
    repeatableDaily: true, npcId: 'npc_bonetrap_boss' },
  { questId: 'wq_gather_cogs', name: 'Clockwork Salvage', type: 'gather', description: 'Collect cogs from the clockwork creatures in the Gnomish Isles.',
    target: { resource: 'cogs', count: 8 }, rewards: { coins: 70, xp: 40, skillXp: { cogworking: 30 } },
    repeatableDaily: true, npcId: 'npc_mechspire_clockwright' },
  { questId: 'wq_craft_mana_potion', name: 'Mage\'s Reserve', type: 'craft', description: 'Brew mana potions for the wizard\'s tower.',
    target: { item: 'potion_mana', count: 3 }, rewards: { coins: 85, xp: 50, skillXp: { crafting: 35 } },
    repeatableDaily: true, npcId: 'npc_sylvaris_archivist' },

  // Kill quests
  { questId: 'wq_kill_vipers', name: 'Viper Menace', type: 'kill', description: 'Clear sand vipers from the trade routes.',
    target: { monster: 'sand_viper', count: 5 }, rewards: { coins: 80, xp: 50, skillXp: { melee: 30 } },
    repeatableDaily: true, npcId: 'npc_fortunes_matriarch' },
  { questId: 'wq_kill_wolves', name: 'Wolf Culling', type: 'kill', description: 'Thin the wolf population near town.',
    target: { monster: 'forest_wolf', count: 5 }, rewards: { coins: 60, xp: 40, skillXp: { melee: 25 } },
    repeatableDaily: true },
  { questId: 'wq_kill_skeletons', name: 'Rift Spillage', type: 'kill', description: 'Destroy the undead wandering from the Rift.',
    target: { monster: 'restless_undead', count: 8 }, rewards: { coins: 70, xp: 45, skillXp: { melee: 30 } },
    repeatableDaily: true, npcId: 'npc_solara_priest' },
  { questId: 'wq_kill_goblins', name: 'Goblin Scouts', type: 'kill', description: 'Drive off the goblin scouts harassing the roads.',
    target: { monster: 'goblin_scout', count: 6 }, rewards: { coins: 65, xp: 40, skillXp: { archery: 25 } },
    repeatableDaily: true, npcId: 'npc_kragmor_warchief' },
  { questId: 'wq_kill_sea_creatures', name: 'Shoreline Threat', type: 'kill', description: 'Drive back the shore crabs menacing the coast.',
    target: { monster: 'shore_crab', count: 5 }, rewards: { coins: 75, xp: 45, skillXp: { melee: 30 } },
    repeatableDaily: true, npcId: 'npc_murkmire_elder' },
  { questId: 'wq_collect_trophies', name: 'Trophy Hunter', type: 'gather', description: 'Collect boss trophies to prove your worth.',
    target: { resource: 'boss_trophy', count: 3 }, rewards: { coins: 150, xp: 100 },
    repeatableDaily: false, npcId: 'npc_kragmor_warchief' },

  // Additional gathering quests (replacing untrackable explore quests)
  { questId: 'wq_gather_stone', name: 'Quarry Work', type: 'gather', description: 'Mine stone for the construction guild.',
    target: { resource: 'stone', count: 20 }, rewards: { coins: 45, xp: 25, skillXp: { mining: 20 } },
    repeatableDaily: true },
  { questId: 'wq_kill_scorpions', name: 'Desert Patrol', type: 'kill', description: 'Clear desert scorpions from the trade routes.',
    target: { monster: 'desert_scorpion', count: 5 }, rewards: { coins: 75, xp: 45, skillXp: { melee: 30 } },
    repeatableDaily: true },
  { questId: 'wq_kill_crawlers', name: 'Waste Clearance', type: 'kill', description: 'Hunt waste crawlers in the Wastes.',
    target: { monster: 'waste_crawler', count: 3 }, rewards: { coins: 80, xp: 50, skillXp: { melee: 35 } },
    repeatableDaily: true },

  // Dungeon quests
  { questId: 'wq_dungeon_clear', name: 'Rift Expedition', type: 'dungeon', description: 'Reach floor 5 in the Rift.',
    target: { minFloor: 5 }, rewards: { coins: 120, xp: 80, skillXp: { melee: 40 } },
    repeatableDaily: true },
  { questId: 'wq_dungeon_deep', name: 'Deep Delver', type: 'dungeon', description: 'Reach floor 15 in the Rift.',
    target: { minFloor: 15 }, rewards: { coins: 250, xp: 180, skillXp: { melee: 80 } },
    repeatableDaily: true, npcId: 'npc_solara_priest' },
  { questId: 'wq_dungeon_boss', name: 'Boss Slayer', type: 'dungeon', description: 'Defeat a dungeon boss.',
    target: { bossKill: 1 }, rewards: { coins: 200, xp: 150, skillXp: { melee: 60 } },
    repeatableDaily: true },
  { questId: 'wq_dungeon_cave', name: 'Cave Explorer', type: 'dungeon', description: 'Clear an overworld cave dungeon.',
    target: { caveComplete: 1 }, rewards: { coins: 100, xp: 70 },
    repeatableDaily: true },

  // Additional crafting quests (replacing untrackable trade/guild quests)
  { questId: 'wq_craft_glass', name: 'Glassblower\'s Order', type: 'craft', description: 'Blow glass panes for the market.',
    target: { item: 'glass', count: 6 }, rewards: { coins: 55, xp: 30, skillXp: { glassworking: 25 } },
    repeatableDaily: true },
  { questId: 'wq_gather_springs', name: 'Spring Collection', type: 'gather', description: 'Collect mechanical springs for the engineers.',
    target: { resource: 'springs', count: 6 }, rewards: { coins: 60, xp: 35, skillXp: { cogworking: 20 } },
    repeatableDaily: true, npcId: 'npc_mechspire_clockwright' },

  // Skill milestone quests
  { questId: 'wq_skill_mining_10', name: 'Journeyman Miner', type: 'skill_milestone', description: 'Reach Mining level 10.',
    target: { skill: 'mining', level: 10 }, rewards: { coins: 200, xp: 100 },
    repeatableDaily: false },
  { questId: 'wq_skill_cooking_10', name: 'Journeyman Cook', type: 'skill_milestone', description: 'Reach Cooking level 10.',
    target: { skill: 'cooking', level: 10 }, rewards: { coins: 200, xp: 100 },
    repeatableDaily: false },
  { questId: 'wq_skill_fishing_10', name: 'Journeyman Fisher', type: 'skill_milestone', description: 'Reach Fishing level 10.',
    target: { skill: 'fishing', level: 10 }, rewards: { coins: 200, xp: 100 },
    repeatableDaily: false },
  { questId: 'wq_skill_crafting_10', name: 'Journeyman Craftsman', type: 'skill_milestone', description: 'Reach Crafting level 10.',
    target: { skill: 'crafting', level: 10 }, rewards: { coins: 200, xp: 100 },
    repeatableDaily: false },
  { questId: 'wq_skill_magic_15', name: 'Apprentice Mage', type: 'skill_milestone', description: 'Reach Magic level 15.',
    target: { skill: 'magic', level: 15 }, rewards: { coins: 350, xp: 180 },
    repeatableDaily: false, npcId: 'npc_sylvaris_archivist' },
  { questId: 'wq_skill_melee_20', name: 'Veteran Warrior', type: 'skill_milestone', description: 'Reach Melee level 20.',
    target: { skill: 'melee', level: 20 }, rewards: { coins: 500, xp: 250 },
    repeatableDaily: false, npcId: 'npc_kragmor_warchief' },
];

// ---------------------------------------------------------------------------
// Per-biome Weather System
// ---------------------------------------------------------------------------

var BIOME_WEATHER = {
  ocean:        { clear:40, rain:30, storm:20, fog:10, snow:0  },
  deep_ocean:   { clear:30, rain:25, storm:35, fog:10, snow:0  },
  beach:        { clear:50, rain:20, storm:15, fog:10, snow:5  },
  plains:       { clear:45, rain:25, storm:15, fog:10, snow:5  },
  forest:       { clear:30, rain:30, storm:10, fog:25, snow:5  },
  dense_forest: { clear:20, rain:35, storm:10, fog:30, snow:5  },
  swamp:        { clear:15, rain:35, storm:15, fog:35, snow:0  },
  desert:       { clear:70, rain:5,  storm:10, fog:5,  snow:0  },
  tundra:       { clear:30, rain:5,  storm:20, fog:10, snow:35 },
  frozen:       { clear:20, rain:0,  storm:25, fog:10, snow:45 },
  mountains:    { clear:35, rain:15, storm:25, fog:20, snow:5  },
  highlands:    { clear:40, rain:20, storm:20, fog:15, snow:5  },
  volcanic:     { clear:20, rain:5,  storm:40, fog:30, snow:0  },
  cave:         { clear:80, rain:0,  storm:0,  fog:20, snow:0  },
  underground:  { clear:90, rain:0,  storm:0,  fog:10, snow:0  },
  hollow_earth: { clear:60, rain:10, storm:5,  fog:25, snow:0  },
  coastal:      { clear:45, rain:25, storm:20, fog:10, snow:0  },
};

var BIOME_WEATHER_EFFECTS = {
  default:          { speedMult: 1.0,  combatMod: 0,     growthMult: 1.0 },
  forest_fog:       { speedMult: 0.85, combatMod: -0.05, growthMult: 1.0 },
  swamp_fog:        { speedMult: 0.75, combatMod: -0.10, growthMult: 1.0 },
  desert_storm:     { speedMult: 0.70, combatMod: -0.15, growthMult: 0.5 },
  tundra_snow:      { speedMult: 0.80, combatMod: -0.05, growthMult: 0.8 },
  frozen_snow:      { speedMult: 0.65, combatMod: -0.10, growthMult: 0.5 },
  plains_storm:     { speedMult: 0.85, combatMod: -0.05, growthMult: 1.2 },
  mountains_storm:  { speedMult: 0.70, combatMod: -0.10, growthMult: 1.0 },
  volcanic_storm:   { speedMult: 0.75, combatMod: -0.15, growthMult: 0.5 },
};

function getWeatherForBiome(biomeId) {
  var table = BIOME_WEATHER[biomeId] || BIOME_WEATHER.plains;
  var total = 0;
  for (var w in table) total += table[w];
  var r = Math.random() * total;
  var cum = 0;
  for (var w in table) {
    cum += table[w];
    if (r < cum) return w;
  }
  return 'clear';
}

function getBiomeWeatherEffect(biomeId, weather) {
  var key = biomeId + '_' + weather;
  return BIOME_WEATHER_EFFECTS[key] || BIOME_WEATHER_EFFECTS.default;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Resources
  ALL_RESOURCE_TYPES,

  // Farming & Animals
  CROP_DEFINITIONS,
  CROP_STAGES,
  CROP_WITHER_MULTIPLIER,
  ANIMAL_DEFINITIONS,
  ANIMAL_HAPPINESS_MAX,
  ANIMAL_HAPPINESS_MISS_PENALTY,
  ANIMAL_HAPPINESS_HALF_THRESHOLD,
  ANIMAL_HAPPINESS_STOP_THRESHOLD,
  ANIMAL_MAX_PENDING_PRODUCTS,

  // Furniture & Station Upgrades
  FURNITURE_EFFECTS,
  STATION_UPGRADE_TIERS,

  // New Resources & Recipes
  NEW_BIOME_RESOURCES,
  NEW_RECIPES,

  // Economy
  CARD_VENDOR_PRICES,
  CARD_BUYBACK_RATE,
  RARITY_BASE_VALUE,
  AUCTION_DURATION_MS,
  AUCTION_MIN_PRICE,
  AUCTION_MAX_LISTINGS_PER_PLAYER,

  // Icon Registry
  ICON_REGISTRY,

  // Food effects
  FOOD_EFFECTS,

  // Crafting skill perks
  CRAFTING_SKILL_PERKS,
  getCraftingSkillBonuses,

  // World Quests
  WORLD_QUEST_TEMPLATES,

  // Per-biome Weather
  BIOME_WEATHER,
  BIOME_WEATHER_EFFECTS,
  getWeatherForBiome,
  getBiomeWeatherEffect,
};
