// =============================================================================
// LOOT GENERATOR — Procedural Equipment Generation, Affixes, Sets, Gems, etc.
// =============================================================================
// Implements all 10 sections from the loot evolution design doc.
// Used by: crafting.js, dungeon.js, accounts.js, character-creation.js
// =============================================================================

var crypto = require('crypto');
var accountWeight = require('./account-weight');
var _gridSizes = require('./inventory-grid-sizes');
var _equipData = require('./equipment-data');

// ---------------------------------------------------------------------------
// Section 1: WEAPON & ARMOR AFFIXES
// ---------------------------------------------------------------------------

var WEAPON_AFFIXES = {
  prefixes: {
    // Melee physical
    jagged:       { name: 'Jagged',      category: ['melee_blade', 'melee_blunt'], stats: { bleedChance: 0.10, damage: 2 }, weight: 20, minRarity: 'common' },
    serrated:     { name: 'Serrated',    category: ['melee_blade'],               stats: { bleedChance: 0.18, damage: 4 }, weight: 12, minRarity: 'uncommon' },
    cruel:        { name: 'Cruel',       category: ['melee_blade', 'melee_blunt'], stats: { critMult: 0.15, bleedChance: 0.08 }, weight: 10, minRarity: 'uncommon' },
    brutal:       { name: 'Brutal',      category: ['melee_blunt'],               stats: { armorPenetration: 0.15, damage: 3 }, weight: 14, minRarity: 'common' },
    masterwork:   { name: 'Masterwork',  category: ['melee_blade', 'melee_blunt', 'archery', 'magic'], stats: { damagePct: 0.12 }, weight: 8, minRarity: 'uncommon' },
    tempered:     { name: 'Tempered',    category: ['melee_blade', 'melee_blunt'], stats: { damagePct: 0.08, durabilityBonus: 0.20 }, weight: 15, minRarity: 'common' },
    keen:         { name: 'Keen',        category: ['melee_blade'],               stats: { critBonus: 0.06 }, weight: 13, minRarity: 'common' },
    heavy:        { name: 'Heavy',       category: ['melee_blunt', 'melee_blade'], stats: { damage: 5, speed: -0.08 }, weight: 11, minRarity: 'uncommon' },
    // Elemental
    flaming:      { name: 'Flaming',     category: ['melee_blade', 'melee_blunt', 'archery'], stats: { element: 'fire', elementDamage: 5, burnChance: 0.12 }, weight: 10, minRarity: 'uncommon' },
    frosted:      { name: 'Frosted',     category: ['melee_blade', 'melee_blunt', 'archery'], stats: { element: 'ice', elementDamage: 4, chillChance: 0.15 }, weight: 10, minRarity: 'uncommon' },
    crackling:    { name: 'Crackling',   category: ['melee_blade', 'melee_blunt', 'archery', 'magic'], stats: { element: 'lightning', elementDamage: 4, shockChance: 0.10 }, weight: 9, minRarity: 'uncommon' },
    venomous:     { name: 'Venomous',    category: ['melee_blade', 'archery'],    stats: { element: 'poison', poisonChance: 0.20, poisonDamage: 5 }, weight: 12, minRarity: 'uncommon' },
    void_touched: { name: 'Void',        category: ['melee_blade', 'melee_blunt', 'magic'], stats: { element: 'shadow', elementDamage: 6, manaDrainChance: 0.10 }, weight: 5, minRarity: 'rare' },
    holy:         { name: 'Holy',        category: ['melee_blunt', 'magic'],      stats: { element: 'holy', elementDamage: 5, bonusVsUndead: 0.25 }, weight: 6, minRarity: 'rare' },
    // Magic
    arcane:       { name: 'Arcane',      category: ['magic'],                     stats: { magicDamage: 6, spellCostReduction: 0.08 }, weight: 14, minRarity: 'common' },
    empowered:    { name: 'Empowered',   category: ['magic'],                     stats: { magicDamagePct: 0.15, aoeRadius: 1 }, weight: 7, minRarity: 'uncommon' },
    channeling:   { name: 'Channeling',  category: ['magic'],                     stats: { magicDamagePct: 0.10, chargeBonus: 0.25 }, weight: 8, minRarity: 'rare' },
    // Ranged
    piercing:     { name: 'Piercing',    category: ['archery'],                   stats: { pierceChance: 0.20, armorPenetration: 0.10 }, weight: 11, minRarity: 'uncommon' },
    unerring:     { name: 'Unerring',    category: ['archery'],                   stats: { critBonus: 0.06, accuracy: 0.10 }, weight: 10, minRarity: 'uncommon' },
    swift:        { name: 'Swift',       category: ['archery', 'melee_blade'],    stats: { speed: 0.10 }, weight: 9, minRarity: 'uncommon' },
    // Dual-wield synergy
    offhand_keen: { name: 'Off-Hand Keen', category: ['melee_blade'],             stats: { dualWieldBonus: 0.12, critBonus: 0.03 }, weight: 8, minRarity: 'uncommon', slotHint: 'off_hand' },
    mainhand_fury:{ name: 'Main-Hand Fury', category: ['melee_blade', 'melee_blunt'], stats: { comboBonus: 0.15 }, weight: 7, minRarity: 'rare', slotHint: 'main_hand' },
  },
  suffixes: {
    of_the_hawk:  { name: 'of the Hawk',     category: ['melee_blade', 'archery'],                        stats: { critBonus: 0.04, finesse: 1 }, weight: 15, minRarity: 'common' },
    of_the_bear:  { name: 'of the Bear',     category: ['melee_blunt', 'melee_blade'],                    stats: { vigor: 2 }, weight: 18, minRarity: 'common' },
    of_warding:   { name: 'of Warding',      category: ['melee_blade', 'melee_blunt', 'magic', 'archery'], stats: { resolve: 1, magicResist: 3 }, weight: 14, minRarity: 'common' },
    of_alacrity:  { name: 'of Alacrity',     category: ['melee_blade', 'archery', 'magic'],               stats: { speed: 0.08 }, weight: 12, minRarity: 'uncommon' },
    of_the_titan: { name: 'of the Titan',    category: ['melee_blunt'],                                   stats: { might: 2, damage: 3 }, weight: 9, minRarity: 'uncommon' },
    of_channeling:{ name: 'of Channeling',   category: ['magic'],                                         stats: { manaCostReduction: 0.10 }, weight: 10, minRarity: 'uncommon' },
    of_vampirism: { name: 'of Vampirism',    category: ['melee_blade', 'melee_blunt'],                    stats: { lifeSteal: 0.06 }, weight: 7, minRarity: 'rare' },
    of_the_hunt:  { name: 'of the Hunt',     category: ['archery', 'melee_blade'],                        stats: { bonusVsMoving: 0.12 }, weight: 8, minRarity: 'uncommon' },
    of_ruin:      { name: 'of Ruin',         category: ['melee_blade', 'melee_blunt', 'magic'],           stats: { armorShredOnCrit: 0.08, damagePct: 0.05 }, weight: 6, minRarity: 'rare' },
    of_focus:     { name: 'of Focus',        category: ['magic'],                                         stats: { focusGain: 3, magicDamage: 4 }, weight: 9, minRarity: 'uncommon' },
    of_momentum:  { name: 'of Momentum',     category: ['melee_blade', 'melee_blunt', 'archery'],         stats: { staminaRegen: 2 }, weight: 8, minRarity: 'uncommon' },
    of_the_sage:  { name: 'of the Sage',     category: ['magic'],                                         stats: { acumen: 2, manaRegen: 1 }, weight: 10, minRarity: 'uncommon' },
    of_ferocity:  { name: 'of Ferocity',     category: ['melee_blade', 'melee_blunt'],                    stats: { bloodlustGain: 3 }, weight: 7, minRarity: 'rare' },
    of_the_wind:  { name: 'of the Wind',     category: ['archery'],                                       stats: { range: 1, speed: 0.05 }, weight: 6, minRarity: 'rare' },
  }
};

var ARMOR_AFFIXES = {
  prefixes: {
    stalwart:     { name: 'Stalwart',    slot: ['head', 'chest', 'undershirt', 'arms', 'hands', 'legs', 'feet'], stats: { defense: 3 }, weight: 20, minRarity: 'common' },
    fortified:    { name: 'Fortified',   slot: ['chest', 'legs'],    stats: { defense: 5, speedPenalty: 0.01 }, weight: 14, minRarity: 'uncommon' },
    warded:       { name: 'Warded',      slot: ['head', 'chest', 'undershirt', 'arms', 'hands', 'legs', 'feet'], stats: { magicResist: 4 }, weight: 16, minRarity: 'common' },
    shadowweave:  { name: 'Shadowweave', slot: ['head', 'chest', 'legs'], stats: { stealthBonus: 0.10, defense: 1 }, weight: 10, minRarity: 'uncommon' },
    agile:        { name: 'Agile',       slot: ['hands', 'feet', 'legs'], stats: { speedBonus: 0.04, finesse: 1 }, weight: 12, minRarity: 'uncommon' },
    runed:        { name: 'Runed',       slot: ['head', 'chest', 'undershirt', 'arms', 'hands', 'legs', 'feet'], stats: { magicResist: 3, manaOnDamageTaken: 2 }, weight: 9, minRarity: 'rare' },
    adamantine:   { name: 'Adamantine',  slot: ['chest', 'legs'],    stats: { defense: 8, speedPenalty: 0.02 }, weight: 5, minRarity: 'rare' },
    reinforced:   { name: 'Reinforced',  slot: ['chest', 'arms', 'legs'], stats: { defense: 4, durabilityBonus: 0.25 }, weight: 13, minRarity: 'common' },
    blessed:      { name: 'Blessed',     slot: ['head', 'chest', 'undershirt'], stats: { hpRegen: 2, resolve: 1 }, weight: 8, minRarity: 'rare' },
    spiked:       { name: 'Spiked',      slot: ['chest', 'arms', 'hands'], stats: { thornsDamage: 4 }, weight: 7, minRarity: 'uncommon' },
  },
  suffixes: {
    of_the_ox:      { name: 'of the Ox',      slot: ['chest', 'legs', 'feet'],           stats: { vigor: 2 }, weight: 18, minRarity: 'common' },
    of_endurance:   { name: 'of Endurance',   slot: ['chest', 'undershirt'],             stats: { hpRegen: 2, resolve: 1 }, weight: 14, minRarity: 'common' },
    of_the_wolf:    { name: 'of the Wolf',    slot: ['feet', 'legs'],                   stats: { speedBonus: 0.05 }, weight: 12, minRarity: 'uncommon' },
    of_thorns:      { name: 'of Thorns',      slot: ['chest', 'arms', 'hands'],         stats: { thornsDamage: 3 }, weight: 8, minRarity: 'rare' },
    of_the_mage:    { name: 'of the Mage',    slot: ['head', 'chest', 'hands'],         stats: { acumen: 1, magicResist: 2 }, weight: 11, minRarity: 'uncommon' },
    of_resolve:     { name: 'of Resolve',     slot: ['head', 'chest', 'undershirt'],    stats: { resolve: 2, debuffResist: 0.10 }, weight: 10, minRarity: 'uncommon' },
    of_the_turtle:  { name: 'of the Turtle',  slot: ['chest', 'legs'],                  stats: { blockChance: 0.05 }, weight: 9, minRarity: 'uncommon' },
    of_vitality:    { name: 'of Vitality',    slot: ['chest', 'undershirt', 'legs'],    stats: { vigor: 3, hpRegen: 1 }, weight: 7, minRarity: 'rare' },
  }
};

var JEWELRY_AFFIXES = {
  prefixes: {
    gleaming:     { name: 'Gleaming',    slot: ['ring', 'necklace'], stats: { presence: 1, luck: 0.03 }, weight: 15, minRarity: 'common' },
    enchanted:    { name: 'Enchanted',   slot: ['ring', 'necklace'], stats: { acumen: 1, magicDamage: 3 }, weight: 12, minRarity: 'uncommon' },
    runic:        { name: 'Runic',       slot: ['ring', 'necklace'], stats: { magicResist: 3, manaRegen: 1 }, weight: 10, minRarity: 'uncommon' },
    ancient:      { name: 'Ancient',     slot: ['ring', 'necklace'], stats: { allStats: 1 }, weight: 5, minRarity: 'rare' },
    bloodbound:   { name: 'Bloodbound',  slot: ['ring'],             stats: { lifeSteal: 0.04, vigor: 1 }, weight: 7, minRarity: 'rare' },
    stormforged:  { name: 'Stormforged', slot: ['ring', 'necklace'], stats: { element: 'lightning', elementDamage: 3, speed: 0.03 }, weight: 6, minRarity: 'rare' },
  },
  suffixes: {
    of_power:     { name: 'of Power',    slot: ['ring', 'necklace'], stats: { might: 2 }, weight: 14, minRarity: 'common' },
    of_insight:   { name: 'of Insight',  slot: ['ring', 'necklace'], stats: { acumen: 2 }, weight: 14, minRarity: 'common' },
    of_grace:     { name: 'of Grace',    slot: ['ring', 'necklace'], stats: { finesse: 2 }, weight: 14, minRarity: 'common' },
    of_fortitude: { name: 'of Fortitude',slot: ['ring', 'necklace'], stats: { vigor: 2, resolve: 1 }, weight: 10, minRarity: 'uncommon' },
    of_the_archmage: { name: 'of the Archmage', slot: ['ring', 'necklace'], stats: { magicDamage: 6, manaCostReduction: 0.05 }, weight: 6, minRarity: 'rare' },
    of_the_champion: { name: 'of the Champion', slot: ['ring', 'necklace'], stats: { damage: 3, critBonus: 0.03 }, weight: 7, minRarity: 'rare' },
  }
};

// ---------------------------------------------------------------------------
// Section 2: MATERIAL TIERS
// ---------------------------------------------------------------------------

var MATERIAL_TIERS = {
  wooden:      { tier: 0, name: 'Wooden',      statMult: 0.50, durMult: 0.50, affixBudget: 0.7, minFloor: 0,  craftReq: 0,  resource: 'wood' },
  cloth:       { tier: 0, name: 'Cloth',        statMult: 0.50, durMult: 0.40, affixBudget: 0.7, minFloor: 0,  craftReq: 0,  resource: 'thread' },
  leather:     { tier: 0, name: 'Leather',      statMult: 0.55, durMult: 0.50, affixBudget: 0.7, minFloor: 0,  craftReq: 0,  resource: 'leather' },
  copper:      { tier: 1, name: 'Copper',       statMult: 0.65, durMult: 0.60, affixBudget: 0.8, minFloor: 1,  craftReq: 3,  resource: 'copper_bar' },
  bronze:      { tier: 2, name: 'Bronze',       statMult: 0.75, durMult: 0.75, affixBudget: 1.0, minFloor: 3,  craftReq: 10, resource: 'bronze_bar' },
  iron:        { tier: 3, name: 'Iron',         statMult: 0.85, durMult: 0.90, affixBudget: 1.0, minFloor: 8,  craftReq: 20, resource: 'iron_bar' },
  steel:       { tier: 4, name: 'Steel',        statMult: 1.00, durMult: 1.00, affixBudget: 1.1, minFloor: 15, craftReq: 35, resource: 'steel_bar' },
  silver:      { tier: 4, name: 'Silver',       statMult: 0.95, durMult: 0.88, affixBudget: 1.1, minFloor: 15, craftReq: 30, resource: 'silver_bar' },
  gold:        { tier: 5, name: 'Gold',         statMult: 1.05, durMult: 0.88, affixBudget: 1.2, minFloor: 20, craftReq: 40, resource: 'gold_bar' },
  stormsteel:  { tier: 6, name: 'Stormsteel',   statMult: 1.20, durMult: 1.15, affixBudget: 1.3, minFloor: 25, craftReq: 50, resource: 'stormsteel_bar', inherentElement: 'lightning' },
  deepsilver:  { tier: 7, name: 'Deepsilver',   statMult: 1.35, durMult: 1.25, affixBudget: 1.4, minFloor: 40, craftReq: 65, resource: 'deepsilver_bar', magicResonance: 0.10 },
  mithril:     { tier: 7, name: 'Mithril',      statMult: 1.40, durMult: 1.50, affixBudget: 1.4, minFloor: 40, craftReq: 50, resource: 'mithril_bar' },
  soulforged:  { tier: 8, name: 'Soulforged',   statMult: 1.55, durMult: 1.40, affixBudget: 1.5, minFloor: 55, craftReq: 80, resource: 'soulforged_bar', lifeLink: 0.03 },
  enchanted:   { tier: 7, name: 'Enchanted',    statMult: 1.30, durMult: 1.20, affixBudget: 1.3, minFloor: 40, craftReq: 55, resource: 'mana_crystal' },
  silk:        { tier: 4, name: 'Silk',          statMult: 0.90, durMult: 0.60, affixBudget: 1.1, minFloor: 15, craftReq: 30, resource: 'silk_cloth' },
  reinforced_leather: { tier: 3, name: 'Reinforced', statMult: 0.80, durMult: 0.80, affixBudget: 1.0, minFloor: 8, craftReq: 20, resource: 'leather' },
  padded:      { tier: 2, name: 'Padded',       statMult: 0.70, durMult: 0.60, affixBudget: 0.9, minFloor: 3,  craftReq: 10, resource: 'cloth' },
  chainmail:   { tier: 4, name: 'Chainmail',    statMult: 0.95, durMult: 0.90, affixBudget: 1.0, minFloor: 15, craftReq: 35, resource: 'iron_bar' },
  voidmetal:   { tier: 9, name: 'Voidmetal',    statMult: 1.70, durMult: 1.60, affixBudget: 1.6, minFloor: 75, craftReq: 95, resource: 'voidmetal_bar', inherentElement: 'shadow' },
};

// New resources needed for advanced materials
var NEW_RESOURCE_TYPES = [
  'stormsteel_ore', 'stormsteel_bar',
  'deepsilver_ore', 'deepsilver_bar',
  'soulforged_bar',
  'voidmetal_ore', 'voidmetal_bar',
  'ruby', 'emerald', 'sapphire', 'topaz', 'amethyst',
  'diamond', 'onyx', 'opal', 'moonstone',
  'jade', 'bloodstone', 'void_shard_gem',
];

// ---------------------------------------------------------------------------
// Section 3: QUALITY TIERS
// ---------------------------------------------------------------------------

var QUALITY_TIERS = {
  normal:     { name: 'Normal',     color: '#cccccc', minMult: 0.60, maxMult: 0.79, repairCostMult: 1.0 },
  fine:       { name: 'Fine',       color: '#22cc22', minMult: 0.80, maxMult: 0.89, repairCostMult: 1.05 },
  superior:   { name: 'Superior',   color: '#3388ff', minMult: 0.90, maxMult: 0.94, repairCostMult: 1.10 },
  masterwork: { name: 'Masterwork', color: '#aa44ff', minMult: 0.95, maxMult: 0.99, repairCostMult: 1.15 },
  pristine:   { name: 'Pristine',   color: '#ffaa00', minMult: 1.00, maxMult: 1.00, repairCostMult: 1.20 },
};

// Rarity order for comparisons
var RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, ultra_rare: 3, epic: 4, mythic_rare: 5, legendary: 6, godly: 7, relic: 8 };

// Affix chances by rarity
var AFFIX_CHANCES = {
  common:     { prefix: 0.20, suffix: 0.10 },
  uncommon:   { prefix: 0.40, suffix: 0.20 },
  rare:       { prefix: 0.80, suffix: 0.60 },
  ultra_rare: { prefix: 1.00, suffix: 0.90 },
  epic:       { prefix: 1.00, suffix: 0.90 },
  legendary:  { prefix: 1.00, suffix: 1.00 },
  godly:      { prefix: 1.00, suffix: 1.00 },
  relic:      { prefix: 1.00, suffix: 1.00 },
};

// Socket counts by rarity
var SOCKET_CHANCES = {
  common:     { min: 0, max: 0 },
  uncommon:   { min: 0, max: 1, chanceOf1: 0.30 },
  rare:       { min: 1, max: 2, chanceOf2: 0.30 },
  ultra_rare: { min: 2, max: 3, chanceOf3: 0.30 },
  epic:       { min: 2, max: 3, chanceOf3: 0.40 },
  legendary:  { min: 3, max: 3 },
  godly:      { min: 3, max: 4, chanceOf4: 0.50 },
  relic:      { min: 4, max: 4 },
};

// Min quality by rarity
var MIN_QUALITY_BY_RARITY = {
  common:     'normal',
  uncommon:   'normal',
  rare:       'fine',
  ultra_rare: 'superior',
  epic:       'superior',
  legendary:  'masterwork',
  godly:      'masterwork',
  relic:      'pristine',
};

// ---------------------------------------------------------------------------
// Section 4: SET ITEMS
// ---------------------------------------------------------------------------

var ITEM_SETS = {
  thornwarden: {
    id: 'thornwarden', name: 'Thornwarden',
    lore: 'Worn by the forest sentinels of old Sylvaris. The thorns respond to the wearer\'s rage.',
    pieces: {
      thornwarden_helm:      { baseType: 'stormsteel_helm',     slot: 'head' },
      thornwarden_chest:     { baseType: 'stormsteel_armor',    slot: 'chest' },
      thornwarden_greaves:   { baseType: 'stormsteel_greaves',  slot: 'legs' },
      thornwarden_gauntlets: { baseType: 'stormsteel_gauntlets',slot: 'hands' },
      thornwarden_boots:     { baseType: 'stormsteel_boots',    slot: 'feet' },
    },
    bonuses: {
      2: { description: '+10% thorns damage reflected', effects: { thornsDamage: 4, reflectPct: 0.10 } },
      3: { description: '+15% defense, +2 Resolve', effects: { defensePct: 0.15, resolve: 2 } },
      5: { description: 'Thornform: melee attackers 20% rooted 1 turn, +25% defense', effects: { rootOnMeleeHit: 0.20, rootDuration: 1, defensePct: 0.25 } },
    },
    tier: 'stormsteel', minFloor: 25,
  },
  ashveil: {
    id: 'ashveil', name: 'Ashveil',
    lore: 'Spun from threads of solidified smoke by gnomish engineers who studied the Rift\'s fire layers.',
    pieces: {
      ashveil_hood:   { baseType: 'enchanted_hood',   slot: 'head' },
      ashveil_robe:   { baseType: 'enchanted_robe',   slot: 'chest' },
      ashveil_pants:  { baseType: 'enchanted_pants',  slot: 'legs' },
      ashveil_gloves: { baseType: 'enchanted_gloves', slot: 'hands' },
      ashveil_boots:  { baseType: 'enchanted_boots',  slot: 'feet' },
    },
    bonuses: {
      2: { description: '+12% fire and shadow spell damage', effects: { fireDamagePct: 0.12, shadowDamagePct: 0.12 } },
      3: { description: '+8% cast speed, +3 Acumen', effects: { castSpeed: 0.08, acumen: 3 } },
      5: { description: 'Ember Echo: fire spells burn tiles 3 turns, shadow spells drain 5 mana', effects: { fireLeavesTile: 3, shadowManaDrain: 5 } },
    },
    tier: 'enchanted', minFloor: 40,
  },
  bloodfang: {
    id: 'bloodfang', name: 'Bloodfang',
    lore: 'The hide of a creature that should not exist. It still bleeds when hit.',
    pieces: {
      bloodfang_hood:   { baseType: 'soulforged_hood',   slot: 'head' },
      bloodfang_vest:   { baseType: 'soulforged_vest',   slot: 'chest' },
      bloodfang_pants:  { baseType: 'soulforged_pants',  slot: 'legs' },
      bloodfang_gloves: { baseType: 'soulforged_gloves', slot: 'hands' },
      bloodfang_boots:  { baseType: 'soulforged_boots',  slot: 'feet' },
    },
    bonuses: {
      2: { description: '+15% bloodlust gain rate', effects: { bloodlustGainPct: 0.15 } },
      3: { description: 'Killing blow heals 8% of target max HP', effects: { onKillHealPct: 0.08 } },
      5: { description: 'Blood Price: at 30% HP or less, +40% damage, 2x bloodlust', effects: { berserkerThreshold: 0.30, berserkerDmgBonus: 0.40, berserkerBloodlustMult: 2.0 } },
    },
    tier: 'soulforged', minFloor: 55,
  },
  tidecaller: {
    id: 'tidecaller', name: 'Tidecaller',
    lore: 'Salvaged from the depths by Lizard Folk divers. The coral still sings when wet.',
    pieces: {
      tidecaller_helm:   { baseType: 'deepsilver_helm',   slot: 'head' },
      tidecaller_chest:  { baseType: 'deepsilver_armor',  slot: 'chest' },
      tidecaller_greaves:{ baseType: 'deepsilver_greaves', slot: 'legs' },
      tidecaller_gauntlets:{ baseType: 'deepsilver_gauntlets', slot: 'hands' },
      tidecaller_boots:  { baseType: 'deepsilver_boots',  slot: 'feet' },
    },
    bonuses: {
      2: { description: '+10 magic resist, +5 mana regen', effects: { magicResist: 10, manaRegen: 5 } },
      3: { description: 'Ice spells 20% chance to freeze 1 turn', effects: { iceFreeze: 0.20, freezeDuration: 1 } },
      5: { description: 'Tidal Surge: every 5th spell cast triggers AoE water burst (15 magic dmg, chills)', effects: { tidalSurgeEvery: 5, tidalDamage: 15, tidalChill: true } },
    },
    tier: 'deepsilver', minFloor: 40,
  },
  ironjaw: {
    id: 'ironjaw', name: 'Ironjaw',
    lore: 'Forged in Ironhold by master smiths who never learned to quit. Neither will you.',
    pieces: {
      ironjaw_helm:      { baseType: 'mithril_helm',      slot: 'head' },
      ironjaw_chest:     { baseType: 'mithril_armor',     slot: 'chest' },
      ironjaw_greaves:   { baseType: 'mithril_greaves',   slot: 'legs' },
      ironjaw_gauntlets: { baseType: 'mithril_gauntlets', slot: 'hands' },
      ironjaw_boots:     { baseType: 'mithril_boots',     slot: 'feet' },
    },
    bonuses: {
      2: { description: '+8 flat defense, +10% block chance', effects: { defense: 8, blockChance: 0.10 } },
      3: { description: 'Take 15% less damage when below 50% HP', effects: { lowHpDamageReduction: 0.15, threshold: 0.50 } },
      5: { description: 'Unbreakable: once per dungeon, survive lethal damage at 1 HP', effects: { cheathDeath: true, cheathDeathCooldown: 'per_dungeon' } },
    },
    tier: 'mithril', minFloor: 40,
  },
};

// Reverse lookup: item type -> set id
var ITEM_SET_LOOKUP = {};
(function() {
  for (var setId in ITEM_SETS) {
    var set = ITEM_SETS[setId];
    for (var pieceId in set.pieces) {
      ITEM_SET_LOOKUP[pieceId] = setId;
    }
  }
})();

// ---------------------------------------------------------------------------
// Section 4b: UNIQUE ITEMS (Legendary/Relic with rule-breaking effects)
// ---------------------------------------------------------------------------

var UNIQUE_ITEMS = {
  scythe_of_last_breath: {
    type: 'mithril_scythe', name: 'Last Breath', rarity: 'legendary',
    flavor: '"It does not kill. It unmakes."',
    uniqueEffect: { type: 'execute_threshold', threshold: 0.15, description: 'Kills enemies below 15% HP instantly.' },
    baseStats: { damage: 36, speed: 0.75, critBonus: 0.10 },
    setOverride: null,
  },
  ring_of_echoes: {
    type: 'ring', name: 'Ring of Echoes', rarity: 'legendary',
    flavor: '"The second cast is always free."',
    uniqueEffect: { type: 'spell_echo', chance: 0.20, description: '20% chance to double-cast spells for free.' },
    baseStats: { acumen: 4, magicDamage: 6 },
  },
  staff_of_stolen_seconds: {
    type: 'mithril_staff', name: 'Stolen Seconds', rarity: 'relic',
    flavor: '"Every turn you skip, it remembers."',
    uniqueEffect: { type: 'time_debt', maxCharges: 5, description: 'Store charges when passing turns. Spend to reduce cooldowns.' },
    baseStats: { damage: 14, magicDamage: 56, speed: 1.1 },
  },
  dagger_of_coincidences: {
    type: 'mithril_dagger', name: 'Coincidences', rarity: 'legendary',
    flavor: '"It finds the soft spots."',
    uniqueEffect: { type: 'guaranteed_crit_vs_debuffed', description: 'Always crits debuffed enemies.' },
    baseStats: { damage: 20, speed: 1.5, critBonus: 0.12 },
  },
  bow_of_the_stars: {
    type: 'mithril_bow', name: 'Starfall', rarity: 'legendary',
    flavor: '"Each arrow carries a falling star."',
    uniqueEffect: { type: 'splash_on_hit', radius: 1, splashPct: 0.30, description: 'Arrows splash for 30% damage in 1 tile radius.' },
    baseStats: { damage: 30, speed: 1.2, range: 7 },
  },
  shield_of_the_mountain: {
    type: 'mithril_shield', name: 'The Mountain', rarity: 'legendary',
    flavor: '"It doesn\'t move. Neither will you."',
    uniqueEffect: { type: 'perfect_block_threshold', blockAll: true, hpThreshold: 0.90, description: 'Block all damage while above 90% HP.' },
    baseStats: { defense: 30, blockChance: 0.35 },
  },
  amulet_of_the_rift: {
    type: 'necklace', name: 'Rift Heart', rarity: 'relic',
    flavor: '"It beats in time with the dungeon."',
    uniqueEffect: { type: 'dungeon_attunement', description: 'Gain +2% to all stats per dungeon floor descended (max +40%).' },
    baseStats: { vigor: 5, acumen: 5, resolve: 5 },
  },
  mace_of_judgement: {
    type: 'mithril_mace', name: 'Final Judgement', rarity: 'legendary',
    flavor: '"Guilty."',
    uniqueEffect: { type: 'stacking_damage', stacksPerHit: 1, maxStacks: 10, dmgPerStack: 0.05, description: 'Each consecutive hit on same target deals +5% more (max +50%).' },
    baseStats: { damage: 28, speed: 0.95 },
  },
};

// ---------------------------------------------------------------------------
// Section 5: GEM TYPES & SOCKETING
// ---------------------------------------------------------------------------

var GEM_TYPES = {
  // Weapon gems
  ruby:        { name: 'Ruby',        gemType: 'weapon', effects: { damage: 4 },                          craftFrom: { gem_cut: 2, iron_bar: 1 }, craftSkill: { jewelcrafting: 15 } },
  emerald:     { name: 'Emerald',     gemType: 'weapon', effects: { poisonChance: 0.08, poisonDamage: 3 }, craftFrom: { gem_cut: 2, herbs: 3 },    craftSkill: { jewelcrafting: 20 } },
  sapphire:    { name: 'Sapphire',    gemType: 'weapon', effects: { magicDamage: 6 },                     craftFrom: { gem_cut: 2, mana_crystal: 1 }, craftSkill: { jewelcrafting: 20 } },
  topaz:       { name: 'Topaz',       gemType: 'weapon', effects: { lightningOnCrit: 8 },                 craftFrom: { gem_cut: 2, copper_bar: 2 }, craftSkill: { jewelcrafting: 25 } },
  amethyst:    { name: 'Amethyst',    gemType: 'weapon', effects: { manaDrainOnHit: 3 },                  craftFrom: { gem_cut: 3, mana_crystal: 1 }, craftSkill: { jewelcrafting: 30 } },
  // Armor gems
  diamond:     { name: 'Diamond',     gemType: 'armor',  effects: { defense: 5 },                         craftFrom: { gem_cut: 3, iron_bar: 2 }, craftSkill: { jewelcrafting: 35 } },
  onyx:        { name: 'Onyx',        gemType: 'armor',  effects: { debuffResist: 0.10 },                  craftFrom: { gem_cut: 2, dark_crystal: 1 }, craftSkill: { jewelcrafting: 30 } },
  opal:        { name: 'Opal',        gemType: 'armor',  effects: { hpRegen: 2 },                         craftFrom: { gem_cut: 2 },              craftSkill: { jewelcrafting: 15 } },
  moonstone:   { name: 'Moonstone',   gemType: 'armor',  effects: { magicResist: 5 },                     craftFrom: { gem_cut: 2, silver_bar: 1 }, craftSkill: { jewelcrafting: 25 } },
  // Utility gems (any socket)
  jade:        { name: 'Jade',        gemType: 'utility', effects: { xpBonus: 0.05 },                     craftFrom: { gem_cut: 2, herbs: 2 },    craftSkill: { jewelcrafting: 20 } },
  bloodstone:  { name: 'Bloodstone',  gemType: 'utility', effects: { lifeSteal: 0.04 },                   craftFrom: { gem_cut: 3 },              craftSkill: { jewelcrafting: 35 } },
  void_shard:  { name: 'Void Shard',  gemType: 'utility', effects: { shadowDamage: 0.08, speed: 0.03 },   craftFrom: { dark_crystal: 2 },         craftSkill: { jewelcrafting: 45 } },
};

// ---------------------------------------------------------------------------
// Section 5b: AUGMENTATION
// ---------------------------------------------------------------------------

var AUGMENT_TYPES = {
  // Weapon augments
  coiled_spring:   { name: 'Coiled Spring',   slot: 'weapon', requiredSkill: { cogworking: 20 }, effects: { speed: 0.10 },                        craftFrom: { springs: 3, cogs: 2 } },
  barbed_edge:     { name: 'Barbed Edge',      slot: 'weapon', requiredSkill: { cogworking: 30 }, effects: { bleedChance: 0.15, bleedDamage: 4 },  craftFrom: { iron_bar: 3, cogs: 1 } },
  resonant_core:   { name: 'Resonant Core',    slot: 'weapon', requiredSkill: { enchanting: 40 }, effects: { spellEcho: 0.10 },                    craftFrom: { mana_crystal: 3, arcane_essence: 2 } },
  clockwork_sight: { name: 'Clockwork Sight',  slot: 'weapon', requiredSkill: { cogworking: 35 }, effects: { range: 1, critBonus: 0.03 },          craftFrom: { glass_lens: 2, gears: 3, springs: 1 }, categoryReq: 'archery' },
  venom_reservoir: { name: 'Venom Reservoir',  slot: 'weapon', requiredSkill: { alchemy: 30 },    effects: { poisonChance: 0.25, poisonDamage: 6 }, craftFrom: { poison_vial: 3, glass_vial: 2 } },
  mana_conduit:    { name: 'Mana Conduit',     slot: 'weapon', requiredSkill: { enchanting: 35 }, effects: { manaCostReduction: 0.12, manaRegen: 2 }, craftFrom: { mana_crystal: 2, arcane_essence: 1 }, categoryReq: 'magic' },
  // Armor augments
  reactive_plating:{ name: 'Reactive Plating', slot: 'armor',  requiredSkill: { cogworking: 25 }, effects: { counterOnBlock: 0.20, counterDamage: 8 }, craftFrom: { steel_bar: 3, springs: 2 } },
  sigil_ward:      { name: 'Sigil Ward',       slot: 'armor',  requiredSkill: { enchanting: 30 }, effects: { spellAbsorb: 0.08 },                  craftFrom: { sigil_ink: 3, mana_crystal: 1 } },
  dampening_weave: { name: 'Dampening Weave',  slot: 'armor',  requiredSkill: { enchanting: 20 }, effects: { debuffDurationReduction: 0.15 },      craftFrom: { silk_cloth: 3, enchantment_shard: 2 } },
  thorned_plates:  { name: 'Thorned Plates',   slot: 'armor',  requiredSkill: { cogworking: 30 }, effects: { thornsDamage: 6 },                    craftFrom: { iron_bar: 4, cogs: 2 } },
  vitality_mesh:   { name: 'Vitality Mesh',    slot: 'armor',  requiredSkill: { alchemy: 25 },    effects: { hpRegen: 3, vigor: 1 },               craftFrom: { herbs: 5, thread: 3 } },
};

// ---------------------------------------------------------------------------
// Section 6: INSCRIPTIONS (reusable scroll abilities)
// ---------------------------------------------------------------------------

var INSCRIPTION_DEFS = {
  scroll_of_protection: {
    name: 'Shielding Inscription', cooldown: 8, maxUpgrades: 3,
    effect: { type: 'temp_buff', buffName: 'shielded', defense: 15, duration: 3 },
    upgrades: [{ defense: 20, duration: 3 }, { defense: 25, duration: 4, cooldown: 7 }, { defense: 30, duration: 4, cooldown: 6 }],
    description: 'Reduces incoming damage for multiple turns.',
  },
  scroll_of_strength: {
    name: 'Strength Inscription', cooldown: 6, maxUpgrades: 3,
    effect: { type: 'temp_buff', buffName: 'empowered', damagePct: 0.25, duration: 2 },
    upgrades: [{ damagePct: 0.30, duration: 2 }, { damagePct: 0.35, duration: 3, cooldown: 5 }, { damagePct: 0.40, duration: 3, cooldown: 5 }],
    description: 'Increases physical damage output.',
  },
  scroll_of_haste: {
    name: 'Haste Inscription', cooldown: 10, maxUpgrades: 3,
    effect: { type: 'extra_action', actions: 1 },
    upgrades: [{ actions: 1, cooldown: 9 }, { actions: 1, cooldown: 8, speedBonus: 0.15 }, { actions: 2, cooldown: 8 }],
    description: 'Grants extra actions this turn.',
  },
  rune_stone_fire: {
    name: 'Flame Rune Inscription', cooldown: 5, maxUpgrades: 3,
    effect: { type: 'elemental_burst', element: 'fire', damage: 12, duration: 2 },
    upgrades: [{ damage: 16, duration: 2 }, { damage: 20, duration: 3, cooldown: 4 }, { damage: 25, duration: 3, burnChance: 0.30 }],
    description: 'Adds fire damage to all attacks.',
  },
  rune_stone_ice: {
    name: 'Frost Rune Inscription', cooldown: 7, maxUpgrades: 3,
    effect: { type: 'aoe_debuff', element: 'ice', radius: 2, slowPct: 0.40, duration: 2 },
    upgrades: [{ slowPct: 0.50, duration: 2 }, { slowPct: 0.60, duration: 3, radius: 3 }, { slowPct: 0.60, duration: 3, radius: 3, freezeChance: 0.15, cooldown: 6 }],
    description: 'Chills nearby enemies, slowing their actions.',
  },
  rune_stone_lightning: {
    name: 'Storm Rune Inscription', cooldown: 6, maxUpgrades: 3,
    effect: { type: 'chain_attack', element: 'lightning', chains: 3, damage: 20 },
    upgrades: [{ chains: 4, damage: 25 }, { chains: 5, damage: 30, cooldown: 5 }, { chains: 6, damage: 35, stunChance: 0.15, cooldown: 5 }],
    description: 'Lightning that bounces between enemies.',
  },
};

// ---------------------------------------------------------------------------
// Section 7: WAND PROPERTIES (extend magic weapons with spell interaction)
// ---------------------------------------------------------------------------

var WAND_PROPS = {
  wooden_wand:    { spellSlots: 1, castDelay: 0,  manaChargeRate: 1.0, chargeCapable: false, alwaysCast: false },
  copper_wand:    { spellSlots: 1, castDelay: 0,  manaChargeRate: 1.05, chargeCapable: false, alwaysCast: false },
  iron_wand:      { spellSlots: 2, castDelay: 0,  manaChargeRate: 1.10, chargeCapable: false, alwaysCast: false },
  silver_wand:    { spellSlots: 2, castDelay: 0,  manaChargeRate: 1.15, chargeCapable: true, chargeMult: 1.3, alwaysCast: false },
  gold_wand:      { spellSlots: 2, castDelay: -1, manaChargeRate: 1.20, chargeCapable: true, chargeMult: 1.4, alwaysCast: false },
  mithril_wand:   { spellSlots: 3, castDelay: -1, manaChargeRate: 1.30, chargeCapable: true, chargeMult: 1.5, alwaysCast: true },
  wooden_staff:   { spellSlots: 2, castDelay: 0,  manaChargeRate: 1.0, chargeCapable: false, alwaysCast: false },
  copper_staff:   { spellSlots: 2, castDelay: 0,  manaChargeRate: 1.10, chargeCapable: false, alwaysCast: false },
  bronze_staff:   { spellSlots: 2, castDelay: 0,  manaChargeRate: 1.15, chargeCapable: true, chargeMult: 1.2, alwaysCast: false },
  iron_staff:     { spellSlots: 3, castDelay: 0,  manaChargeRate: 1.20, chargeCapable: true, chargeMult: 1.3, alwaysCast: false },
  silver_staff:   { spellSlots: 3, castDelay: -1, manaChargeRate: 1.25, chargeCapable: true, chargeMult: 1.4, alwaysCast: false },
  gold_staff:     { spellSlots: 3, castDelay: -1, manaChargeRate: 1.30, chargeCapable: true, chargeMult: 1.4, alwaysCast: true },
  mithril_staff:  { spellSlots: 4, castDelay: -1, manaChargeRate: 1.40, chargeCapable: true, chargeMult: 1.5, alwaysCast: true },
};

// Spell interactions when multiple cards loaded into wand spell slots
var WAND_SPELL_INTERACTIONS = [
  { cards: ['fireball_I', 'ice_shard'],      result: 'steam_explosion', desc: 'Fire+Ice: AoE steam burst', bonusDamage: 8, aoe: 1 },
  { cards: ['lightning_bolt', 'fireball_I'],  result: 'chain_fire',     desc: 'Lightning ignites, spreading fire', chainCount: 3, burnDuration: 2 },
  { cards: ['ice_shard', 'shadow_strike'],    result: 'frozen_shadow',  desc: 'Frozen targets take +40% shadow dmg', shadowAmp: 0.40 },
  { cards: ['heal_self_I', 'fireball_I'],     result: 'heal_burst',     desc: 'Healing pulse + burn enemies nearby', healPct: 0.15, burnRadius: 1 },
  { cards: ['lightning_bolt', 'ice_shard'],   result: 'superconductor', desc: 'Frozen+shocked: guaranteed stun 2 turns', stunDuration: 2 },
  { cards: ['shadow_strike', 'poison_blade'], result: 'blight',         desc: 'Shadow poison: DoT ignores magic resist', dotDamage: 8, dotDuration: 3 },
];

// ---------------------------------------------------------------------------
// Section 8: RING SPECIALIZATION
// ---------------------------------------------------------------------------

var RING_DESIGNS = {
  // Combat identity (ring1 archetype)
  ring_of_the_blade: {
    slot: 'ring1', name: 'Ring of the Blade', rarity: 'rare',
    effects: { critBonus: 0.05, bleedOnCrit: true, bleedDamage: 5, bleedDuration: 2 },
    description: 'Every critical hit inflicts bleeding.',
    craftFrom: { silver_bar: 3, gem_cut: 2, iron_bar: 2 }, craftSkill: { jewelcrafting: 25 },
  },
  ring_of_arcane_focus: {
    slot: 'ring1', name: 'Ring of Arcane Focus', rarity: 'rare',
    effects: { magicDamagePct: 0.12, manaCostReduction: 0.08 },
    description: 'Spells cost less and hit harder.',
    craftFrom: { gold_bar: 2, mana_crystal: 3, gem_cut: 2 }, craftSkill: { jewelcrafting: 30 },
  },
  ring_of_the_hunt: {
    slot: 'ring1', name: 'Ring of the Hunt', rarity: 'rare',
    effects: { finesse: 3, rangedDamagePct: 0.10 },
    description: 'For those who strike from distance.',
    craftFrom: { silver_bar: 2, gem_cut: 2, leather: 3 }, craftSkill: { jewelcrafting: 25 },
  },
  ring_of_brutality: {
    slot: 'ring1', name: 'Ring of Brutality', rarity: 'rare',
    effects: { damage: 4, armorPenetration: 0.08 },
    description: 'Raw force, applied directly.',
    craftFrom: { iron_bar: 4, gem_cut: 1 }, craftSkill: { jewelcrafting: 20 },
  },
  // Survival (ring2 archetype)
  ring_of_iron_will: {
    slot: 'ring2', name: 'Ring of Iron Will', rarity: 'rare',
    effects: { vigor: 4, hpRegen: 3 },
    description: 'The body refuses to break.',
    craftFrom: { iron_bar: 4, gem_cut: 2 }, craftSkill: { jewelcrafting: 20 },
  },
  ring_of_warding: {
    slot: 'ring2', name: 'Ring of Warding', rarity: 'rare',
    effects: { magicResist: 8, debuffResist: 0.15 },
    description: 'Keeps hostile magic at arm\'s length.',
    craftFrom: { silver_bar: 3, mana_crystal: 2, gem_cut: 1 }, craftSkill: { jewelcrafting: 25 },
  },
  ring_of_regeneration: {
    slot: 'ring2', name: 'Ring of Regeneration', rarity: 'rare',
    effects: { hpRegen: 5, vigor: 2 },
    description: 'Wounds close themselves.',
    craftFrom: { gold_bar: 2, herbs: 5, gem_cut: 2 }, craftSkill: { jewelcrafting: 30 },
  },
  // Resource management (ring3 archetype)
  ring_of_the_well: {
    slot: 'ring3', name: 'Ring of the Well', rarity: 'rare',
    effects: { manaMax: 10, manaRegen: 2 },
    description: 'A deeper well to draw from.',
    craftFrom: { silver_bar: 2, mana_crystal: 3 }, craftSkill: { jewelcrafting: 25 },
  },
  ring_of_fury: {
    slot: 'ring3', name: 'Ring of Fury', rarity: 'rare',
    effects: { bloodlustGainPct: 0.20, bloodlustDecayReduction: 0.15 },
    description: 'The rage builds faster and fades slower.',
    craftFrom: { iron_bar: 3, gem_cut: 2, dark_crystal: 1 }, craftSkill: { jewelcrafting: 30 },
  },
  ring_of_concentration: {
    slot: 'ring3', name: 'Ring of Concentration', rarity: 'rare',
    effects: { focusMax: 8, focusRetainOnSwitch: 0.15 },
    description: 'Keeps your edge when the target changes.',
    craftFrom: { silver_bar: 2, gem_cut: 3 }, craftSkill: { jewelcrafting: 25 },
  },
  ring_of_endurance: {
    slot: 'ring3', name: 'Ring of Endurance', rarity: 'rare',
    effects: { staminaMax: 10, staminaRegen: 2 },
    description: 'Fight longer, fight harder.',
    craftFrom: { iron_bar: 3, leather: 3, gem_cut: 1 }, craftSkill: { jewelcrafting: 20 },
  },
  // Utility (ring4 archetype)
  ring_of_the_guide: {
    slot: 'ring4', name: 'Ring of the Guide', rarity: 'uncommon',
    effects: { fogRadius: 1, trapDetect: 0.20 },
    description: 'See further, step safer.',
    craftFrom: { copper_bar: 3, gem_cut: 1 }, craftSkill: { jewelcrafting: 10 },
  },
  ring_of_fortune: {
    slot: 'ring4', name: 'Ring of Fortune', rarity: 'rare',
    effects: { lootBonus: 0.10, goldBonus: 0.15 },
    description: 'Luck has a way of finding you.',
    craftFrom: { gold_bar: 3, gem_cut: 2 }, craftSkill: { jewelcrafting: 25 },
  },
  ring_of_swiftness: {
    slot: 'ring4', name: 'Ring of Swiftness', rarity: 'uncommon',
    effects: { speedBonus: 0.08, dodgeBonus: 0.05 },
    description: 'Move before they see you.',
    craftFrom: { silver_bar: 2, gem_cut: 1 }, craftSkill: { jewelcrafting: 15 },
  },
  // Crafting/gathering (ring5 archetype)
  ring_of_the_smith: {
    slot: 'ring5', name: 'Ring of the Smith', rarity: 'uncommon',
    effects: { craftQualityBonus: 0.10, ingenuity: 2 },
    description: 'Better work through better tools.',
    craftFrom: { iron_bar: 3, gem_cut: 1 }, craftSkill: { jewelcrafting: 15 },
  },
  ring_of_the_miner: {
    slot: 'ring5', name: 'Ring of the Miner', rarity: 'uncommon',
    effects: { miningYield: 0.15, rareOreChance: 0.05 },
    description: 'The earth gives more willingly.',
    craftFrom: { copper_bar: 4, gem_cut: 1 }, craftSkill: { jewelcrafting: 10 },
  },
  ring_of_the_alchemist: {
    slot: 'ring5', name: 'Ring of the Alchemist', rarity: 'rare',
    effects: { potionEffectBonus: 0.15, doublePotionChance: 0.10 },
    description: 'Every brew has a little extra.',
    craftFrom: { gold_bar: 2, gem_cut: 2, herbs: 5 }, craftSkill: { jewelcrafting: 25 },
  },
  ring_of_the_enchanter: {
    slot: 'ring5', name: 'Ring of the Enchanter', rarity: 'rare',
    effects: { enchantPowerBonus: 0.15, manaCostReduction: 0.05 },
    description: 'Magic bends more willingly.',
    craftFrom: { mana_crystal: 3, gem_cut: 2, silver_bar: 2 }, craftSkill: { jewelcrafting: 30 },
  },
  // Special (ring6 archetype — endgame)
  ring_of_the_void_walker: {
    slot: 'ring6', name: 'Ring of the Void Walker', rarity: 'legendary',
    effects: { shadowStep: 2, shadowDamagePct: 0.20 },
    flavor: '"It takes you somewhere."',
    description: 'On kill, teleport up to 2 tiles. +20% shadow damage.',
  },
  ring_of_the_phoenix: {
    slot: 'ring6', name: 'Ring of the Phoenix', rarity: 'legendary',
    effects: { reviveOnce: true, reviveHpPct: 0.30, fireDamagePct: 0.15 },
    flavor: '"Ashes to ashes, and back again."',
    description: 'Once per dungeon, revive at 30% HP on death. +15% fire damage.',
  },
  ring_of_the_leviathan: {
    slot: 'ring6', name: 'Ring of the Leviathan', rarity: 'legendary',
    effects: { allStats: 3, waterBreathing: true, swimSpeed: 0.20 },
    flavor: '"The deep remembers your name."',
    description: '+3 all stats. Breathe underwater. +20% swim speed.',
  },
};

// Ring imbuing costs
var RING_IMBUE_COSTS = {
  rare:       { resource: 'gem_cut',       amount: 5 },
  ultra_rare: { resource: 'mana_crystal',  amount: 3 },
  legendary:  { resource: 'dark_crystal',  amount: 2 },
};

// ---------------------------------------------------------------------------
// Section 9: WEAPON SPECIALS (charge-based special attacks)
// ---------------------------------------------------------------------------

var WEAPON_SPECIALS = {
  melee_blade: {
    id: 'precise_strike', name: 'Precise Strike',
    description: 'Guaranteed crit, 150% damage.',
    chargeRegen: 15, cost: 50,
    effect: { type: 'guaranteed_crit', damageMult: 1.50 },
  },
  melee_blunt: {
    id: 'concussive_blow', name: 'Concussive Blow',
    description: 'Stun 1 turn, ignore 30% armor.',
    chargeRegen: 12, cost: 60,
    effect: { type: 'stun_attack', stunDuration: 1, armorIgnore: 0.30 },
  },
  archery: {
    id: 'volley_shot', name: 'Volley Shot',
    description: 'Fire 3 arrows, each rolls crit independently.',
    chargeRegen: 18, cost: 45,
    effect: { type: 'multi_attack', count: 3 },
  },
  magic: {
    id: 'arcane_surge', name: 'Arcane Surge',
    description: 'Next spell free, 200% effect.',
    chargeRegen: 10, cost: 70,
    effect: { type: 'empower_next_spell', costMult: 0, effectMult: 2.0 },
  },
};

// Named weapon special overrides
var NAMED_WEAPON_SPECIALS = {
  scythe_of_last_breath: {
    id: 'harvest_soul', name: 'Harvest Soul',
    description: '300% damage. Kill heals 20% max HP.',
    chargeRegen: 8, cost: 80,
    effect: { type: 'high_damage', damageMult: 3.0, onKillHeal: 0.20 },
  },
  dagger_of_coincidences: {
    id: 'twist_the_knife', name: 'Twist the Knife',
    description: 'Apply all available debuffs, 120% damage.',
    chargeRegen: 20, cost: 40,
    effect: { type: 'apply_all_debuffs', damageMult: 1.20 },
  },
  mithril_crossbow: {
    id: 'armor_piercer', name: 'Armor Piercer',
    description: 'Ignores all armor. 130% damage.',
    chargeRegen: 10, cost: 65,
    effect: { type: 'true_damage', damageMult: 1.30 },
  },
  bow_of_the_stars: {
    id: 'starfall_barrage', name: 'Starfall Barrage',
    description: '5 arrows raining on area, 60% each.',
    chargeRegen: 12, cost: 75,
    effect: { type: 'aoe_multi', count: 5, damageMult: 0.60, radius: 2 },
  },
  mace_of_judgement: {
    id: 'final_verdict', name: 'Final Verdict',
    description: 'Consume all stacks for massive single hit.',
    chargeRegen: 15, cost: 50,
    effect: { type: 'consume_stacks', dmgPerStack: 0.20 },
  },
};

// Dual-wield combo specials (cost 100 charge, both weapons must be equipped)
var DUAL_WIELD_SPECIALS = {
  'melee_blade+melee_blade': {
    name: 'Whirlwind', cost: 100,
    description: 'Hit all adjacent enemies twice, second hit 60%.',
    effect: { type: 'aoe_double_hit', secondHitMult: 0.60 },
  },
  'melee_blade+magic': {
    name: 'Spellblade Cleave', cost: 100,
    description: 'Weapon damage + 80% wand magic damage.',
    effect: { type: 'infused_attack', magicPct: 0.80 },
  },
  'melee_blunt+melee_blunt': {
    name: 'Earthquake Slam', cost: 100,
    description: 'AoE 2 radius, stun all 1 turn.',
    effect: { type: 'aoe_stun', radius: 2, stunDuration: 1 },
  },
  'melee_blade+melee_blunt': {
    name: 'Crippling Combo', cost: 100,
    description: 'Slash then crush: bleed + armor shred.',
    effect: { type: 'combo_debuff', bleedDuration: 3, armorShred: 0.20 },
  },
  'archery+melee_blade': {
    name: 'Quick Draw Slash', cost: 100,
    description: 'Ranged shot then instant melee follow-up.',
    effect: { type: 'ranged_then_melee', rangedMult: 1.0, meleeMult: 0.80 },
  },
  'magic+magic': {
    name: 'Arcane Convergence', cost: 100,
    description: 'Both wands fire simultaneously, +50% combined magic damage.',
    effect: { type: 'dual_cast', magicBonus: 0.50 },
  },
};

// ---------------------------------------------------------------------------
// Section 10: EQUIPMENT GACHA RATES
// ---------------------------------------------------------------------------

var EQUIPMENT_GACHA_RATES = {
  common:     0.50,
  uncommon:   0.30,
  rare:       0.15,
  epic:       0.04,
  legendary:  0.009,
  relic:      0.001,
};

var EQUIPMENT_PITY = {
  softPityStart: 50,
  hardPity: 100,
  relicPity: 300,
  softPityRateIncrease: 0.03,
};

// ===========================================================================
// GENERATION FUNCTIONS
// ===========================================================================

function generateItemId() {
  return crypto.randomBytes(6).toString('hex');
}

// Roll a quality tier. source='craft' gives minimum 'fine'.
function rollQuality(rarity, source) {
  var minQuality = MIN_QUALITY_BY_RARITY[rarity] || 'normal';
  if (source === 'craft' && QUALITY_TIERS[minQuality] && QUALITY_TIERS.fine) {
    // Crafting floor is 'fine'
    if (getQualityOrder(minQuality) < getQualityOrder('fine')) {
      minQuality = 'fine';
    }
  }

  var roll = Math.random();
  var tier;
  if      (roll < 0.45) tier = 'normal';
  else if (roll < 0.75) tier = 'fine';
  else if (roll < 0.90) tier = 'superior';
  else if (roll < 0.98) tier = 'masterwork';
  else                   tier = 'pristine';

  // Enforce minimum
  if (getQualityOrder(tier) < getQualityOrder(minQuality)) {
    tier = minQuality;
  }

  var q = QUALITY_TIERS[tier];
  var qualityMult = q.minMult + Math.random() * (q.maxMult - q.minMult);
  return { tier: tier, mult: Math.round(qualityMult * 1000) / 1000, color: q.color };
}

var QUALITY_ORDER = { normal: 0, fine: 1, superior: 2, masterwork: 3, pristine: 4 };
function getQualityOrder(q) { return QUALITY_ORDER[q] || 0; }

// Roll an affix from the appropriate pool
function rollAffix(type, pool, category, slot, rarity) {
  // type = 'prefix' or 'suffix'
  // pool = WEAPON_AFFIXES, ARMOR_AFFIXES, or JEWELRY_AFFIXES
  var affixPool = pool[type === 'prefix' ? 'prefixes' : 'suffixes'];
  if (!affixPool) return null;

  var candidates = [];
  var totalWeight = 0;
  for (var id in affixPool) {
    var affix = affixPool[id];
    // Check rarity minimum
    if ((RARITY_ORDER[rarity] || 0) < (RARITY_ORDER[affix.minRarity] || 0)) continue;
    // Check category or slot filter
    if (affix.category && category && affix.category.indexOf(category) === -1) continue;
    if (affix.slot && slot && affix.slot.indexOf(slot) === -1) continue;
    candidates.push({ id: id, affix: affix });
    totalWeight += affix.weight;
  }

  if (candidates.length === 0 || totalWeight === 0) return null;

  var roll = Math.random() * totalWeight;
  var cumulative = 0;
  for (var i = 0; i < candidates.length; i++) {
    cumulative += candidates[i].affix.weight;
    if (roll <= cumulative) {
      return { id: candidates[i].id, name: candidates[i].affix.name, stats: candidates[i].affix.stats };
    }
  }
  return null;
}

// Roll socket count for an item
function rollSockets(rarity, slot) {
  // Jewelry never gets sockets
  if (slot === 'ring1' || slot === 'ring2' || slot === 'ring3' || slot === 'ring4' || slot === 'ring5' || slot === 'ring6' || slot === 'necklace') return 0;

  var chances = SOCKET_CHANCES[rarity] || SOCKET_CHANCES.common;
  if (chances.min === chances.max) return chances.min;

  // For items with a range
  var sockets = chances.min;
  if (chances.chanceOf1 !== undefined && Math.random() < chances.chanceOf1) sockets = Math.max(sockets, 1);
  if (chances.chanceOf2 !== undefined && Math.random() < chances.chanceOf2) sockets = Math.max(sockets, 2);
  if (chances.chanceOf3 !== undefined && Math.random() < chances.chanceOf3) sockets = Math.max(sockets, 3);
  if (chances.chanceOf4 !== undefined && Math.random() < chances.chanceOf4) sockets = Math.max(sockets, 4);

  // Slot cap: head/arms/hands/feet/undershirt max 1 socket at lower rarities
  var smallSlots = { head: 1, arms: 1, hands: 1, feet: 1, undershirt: 1 };
  if (smallSlots[slot] && (RARITY_ORDER[rarity] || 0) < (RARITY_ORDER['ultra_rare'] || 3)) {
    sockets = Math.min(sockets, 1);
  }

  return sockets;
}

// Determine material from item type string
function getMaterialFromType(itemType) {
  if (!itemType) return null;
  // Check each material key against the item type prefix
  var materials = ['voidmetal', 'soulforged', 'deepsilver', 'stormsteel', 'mithril', 'enchanted', 'reinforced_leather', 'reinforced', 'chainmail', 'silk', 'gold', 'silver', 'steel', 'iron', 'bronze', 'copper', 'leather', 'padded', 'cloth', 'wooden'];
  for (var i = 0; i < materials.length; i++) {
    if (itemType.indexOf(materials[i]) === 0) {
      return MATERIAL_TIERS[materials[i]] || null;
    }
  }
  return null;
}

// Apply quality multiplier to base stats
function applyQuality(baseValue, qualityMult) {
  if (typeof baseValue !== 'number') return baseValue;
  var min = Math.floor(baseValue * 0.85);
  var max = Math.ceil(baseValue * 1.15);
  return Math.round((min + (max - min) * qualityMult) * 100) / 100;
}

// Build display name from components
function composeName(baseName, prefix, suffix, uniqueName, setName, quality) {
  if (uniqueName) return uniqueName;
  var parts = [];
  if (quality && quality.tier !== 'normal') {
    // Don't include quality in name, it's shown separately
  }
  if (prefix) parts.push(prefix.name);
  if (setName) parts.push(setName);
  parts.push(baseName);
  if (suffix) parts.push(suffix.name);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// MAIN: generateItem()
// ---------------------------------------------------------------------------
// options: { source, depth, forcedRarity, forcedQuality, craftSkillLevel, setId, setPieceId, uniqueId }

function generateItem(baseType, baseDef, options) {
  options = options || {};
  var source = options.source || 'drop';
  var luckBonus = options.luckBonus || 0;
  var depth = options.depth || 1;
  var rarity = options.forcedRarity || baseDef.rarity || 'common';

  // Quality roll
  var quality = options.forcedQuality ? { tier: options.forcedQuality, mult: QUALITY_TIERS[options.forcedQuality].minMult, color: QUALITY_TIERS[options.forcedQuality].color } : rollQuality(rarity, source);

  // Determine category and slot for affix filtering
  var category = baseDef.category || null;
  var slot = baseDef.slot || null;
  var isWeapon = (slot === 'weapon' || slot === 'shield');
  var isArmor = ['head', 'chest', 'undershirt', 'arms', 'hands', 'legs', 'feet'].indexOf(slot) !== -1;
  var isJewelry = (slot === 'ring1' || slot === 'necklace');

  // Choose affix pool
  var affixPool = isWeapon ? WEAPON_AFFIXES : isArmor ? ARMOR_AFFIXES : isJewelry ? JEWELRY_AFFIXES : null;

  // Check if this is a unique item
  var uniqueItem = options.uniqueId ? UNIQUE_ITEMS[options.uniqueId] : null;

  // Check if this is a set piece
  var setId = options.setId || ITEM_SET_LOOKUP[options.setPieceId] || null;
  var setPieceId = options.setPieceId || null;
  var setDef = setId ? ITEM_SETS[setId] : null;

  // Affix rolls (uniques don't get affixes)
  var prefix = null;
  var suffix = null;
  if (!uniqueItem && affixPool) {
    var chances = AFFIX_CHANCES[rarity] || AFFIX_CHANCES.common;
    if (Math.random() < chances.prefix) {
      prefix = rollAffix('prefix', affixPool, category, slot, rarity);
    }
    if (Math.random() < chances.suffix) {
      suffix = rollAffix('suffix', affixPool, category, slot, rarity);
    }
  }

  // Socket roll
  var sockets = rollSockets(rarity, slot);

  // Has augment slot (rare+)
  var hasAugmentSlot = (RARITY_ORDER[rarity] || 0) >= (RARITY_ORDER['rare'] || 2);

  // Generate procedural stats from base definition
  var stats = {};
  var statKeys = ['damage', 'speed', 'critBonus', 'magicDamage', 'defense', 'blockChance', 'range', 'magicResist', 'speedBonus', 'speedPenalty', 'hpRegen'];
  for (var si = 0; si < statKeys.length; si++) {
    var key = statKeys[si];
    if (baseDef[key] !== undefined) {
      stats[key] = applyQuality(baseDef[key], quality.mult);
    }
  }

  // Apply unique item stat overrides
  if (uniqueItem && uniqueItem.baseStats) {
    for (var uk in uniqueItem.baseStats) {
      stats[uk] = uniqueItem.baseStats[uk];
    }
  }

  // Apply prefix stats additively
  if (prefix && prefix.stats) {
    for (var pk in prefix.stats) {
      if (pk === 'element' || pk === 'burnChance' || pk === 'chillChance' || pk === 'shockChance' || pk === 'poisonChance' || pk === 'manaDrainChance' || pk === 'bleedChance') {
        // Special properties stored directly
        stats[pk] = prefix.stats[pk];
      } else if (pk === 'damagePct' || pk === 'magicDamagePct') {
        // Percentage bonuses applied after base
        var baseKey = pk === 'damagePct' ? 'damage' : 'magicDamage';
        if (stats[baseKey]) stats[baseKey] = Math.round(stats[baseKey] * (1 + prefix.stats[pk]) * 100) / 100;
      } else {
        stats[pk] = (stats[pk] || 0) + prefix.stats[pk];
      }
    }
  }

  // Apply suffix stats additively
  if (suffix && suffix.stats) {
    for (var sk in suffix.stats) {
      if (sk === 'damagePct' || sk === 'magicDamagePct') {
        var baseKey2 = sk === 'damagePct' ? 'damage' : 'magicDamage';
        if (stats[baseKey2]) stats[baseKey2] = Math.round(stats[baseKey2] * (1 + suffix.stats[sk]) * 100) / 100;
      } else {
        stats[sk] = (stats[sk] || 0) + suffix.stats[sk];
      }
    }
  }

  // Material properties
  var mat = getMaterialFromType(baseType);
  if (mat) {
    if (mat.inherentElement && !stats.element) stats.element = mat.inherentElement;
    if (mat.magicResonance) stats.magicResonance = mat.magicResonance;
    if (mat.lifeLink) stats.lifeLink = mat.lifeLink;
  }

  // Wand properties
  var wandProps = WAND_PROPS[baseType] || null;

  // Build display name
  var displayName = composeName(
    baseDef.name,
    prefix, suffix,
    uniqueItem ? uniqueItem.name : null,
    setDef ? setDef.name : null,
    quality
  );

  // Build the item
  var item = {
    id: generateItemId(),
    type: baseType,
    name: displayName,
    baseName: baseDef.name,
    rarity: rarity,
    quality: quality.tier,
    qualityMult: quality.mult,
    qualityColor: quality.color,
    stats: stats,
    prefix: prefix ? prefix.id : null,
    prefixName: prefix ? prefix.name : null,
    prefixStats: prefix ? prefix.stats : null,
    suffix: suffix ? suffix.id : null,
    suffixName: suffix ? suffix.name : null,
    suffixStats: suffix ? suffix.stats : null,
    sockets: sockets,
    socketedGems: [],
    hasAugmentSlot: hasAugmentSlot,
    augment: null,
    setId: setId || null,
    setPieceId: setPieceId || null,
    uniqueId: uniqueItem ? options.uniqueId : null,
    uniqueEffect: uniqueItem ? uniqueItem.uniqueEffect : null,
    flavor: uniqueItem ? uniqueItem.flavor : null,
    wandProps: wandProps,
    source: source,
    generatedAt: Date.now(),
    slot: baseDef.slot,
    category: category,
    handedness: baseDef.handedness || null,
    icon: baseDef.icon || null,
    armorType: baseDef.armorType || null,
    imbued: false,
    // Effects from base def (stat boosts on jewelry etc)
    effects: baseDef.effects || null,
  };

  // Apply craft skill stat bonus: higher craftSkillLevel improves base stats
  var craftSkillLevel = options.craftSkillLevel || 0;
  if (craftSkillLevel > 0) {
    var craftBonus = 1 + Math.min(craftSkillLevel * 0.003, 0.20); // up to +20% at skill 67
    var craftStatKeys = ['damage', 'magicDamage', 'defense', 'magicResist', 'hpRegen', 'manaRegen'];
    for (var csk = 0; csk < craftStatKeys.length; csk++) {
      if (typeof item.stats[craftStatKeys[csk]] === 'number') {
        item.stats[craftStatKeys[csk]] = Math.round(item.stats[craftStatKeys[csk]] * craftBonus * 100) / 100;
      }
    }
  }

  // Procedural mutation roll:
  // - Drops: 5% base (boss: 8%)
  // - Crafts: 8% base + scales with craftSkillLevel (up to 18% at skill 50)
  var _mutSlotHint = null;
  if (isWeapon) _mutSlotHint = 'weapon';
  else if (isArmor) _mutSlotHint = 'armor';
  else if (isJewelry) _mutSlotHint = 'jewelry';
  var _mutBase;
  if (source === 'craft') {
    _mutBase = Math.min(0.08 + craftSkillLevel * 0.002, 0.18);
  } else {
    _mutBase = source === 'boss' ? 0.08 : 0.05;
  }
  var _itemMut = rollItemMutation(_mutBase, luckBonus, _mutSlotHint);
  if (_itemMut) applyItemMutation(item, _itemMut);

  // Curse roll: drops in dangerous biomes have higher curse chance, crafts have low base chance
  var _curseBase = (source === 'craft') ? BIOME_CURSE_CHANCE.crafted : BIOME_CURSE_CHANCE.default;
  if (options.biome && BIOME_CURSE_CHANCE[options.biome]) _curseBase = BIOME_CURSE_CHANCE[options.biome];
  // Boss drops bump curse chance slightly (boss enemies carry corruption)
  if (source === 'boss') _curseBase = Math.max(_curseBase, 0.08);
  var _itemCurse = rollItemCurse(_curseBase, luckBonus, _mutSlotHint);
  if (_itemCurse) applyItemCurse(item, _itemCurse);

  // Stamp physical weight for encumbrance system
  item.weight = accountWeight.getItemWeight(item);

  // Stamp grid dimensions for Tarkov-style inventory
  var _gSize = _gridSizes.getGridSize(item);
  item.gridW = _gSize.w;
  item.gridH = _gSize.h;

  return item;
}

// ---------------------------------------------------------------------------
// CONTAINER ITEM GENERATION (backpacks & rigs)
// ---------------------------------------------------------------------------

// Tier-sorted container pools for loot drops
var CONTAINER_POOL = [
  { type: 'leather_satchel', tier: 1, slot: 'backpack', rarity: 'common' },
  { type: 'belt_pouch',      tier: 1, slot: 'rig',      rarity: 'common' },
  { type: 'adventurer_pack', tier: 2, slot: 'backpack', rarity: 'uncommon' },
  { type: 'utility_vest',    tier: 2, slot: 'rig',      rarity: 'uncommon' },
  { type: 'explorer_backpack', tier: 3, slot: 'backpack', rarity: 'rare' },
  { type: 'tactical_rig',    tier: 3, slot: 'rig',      rarity: 'rare' },
  { type: 'mithril_frame',   tier: 4, slot: 'backpack', rarity: 'ultra_rare' },
];

function generateContainerItem(options) {
  options = options || {};
  var depth = options.depth || 1;
  var source = options.source || 'drop';
  var forcedType = options.forcedType || null;

  var entry;
  if (forcedType) {
    for (var fi = 0; fi < CONTAINER_POOL.length; fi++) {
      if (CONTAINER_POOL[fi].type === forcedType) { entry = CONTAINER_POOL[fi]; break; }
    }
    if (!entry) return null;
  } else {
    // Pick tier based on depth — deeper floors = higher tier containers
    var maxTier = 1;
    if (depth >= 40) maxTier = 4;
    else if (depth >= 25) maxTier = 3;
    else if (depth >= 10) maxTier = 2;

    var candidates = [];
    for (var ci = 0; ci < CONTAINER_POOL.length; ci++) {
      if (CONTAINER_POOL[ci].tier <= maxTier) candidates.push(CONTAINER_POOL[ci]);
    }
    // Weight higher tiers less — inverse tier weighting
    var weights = [];
    var totalW = 0;
    for (var wi = 0; wi < candidates.length; wi++) {
      var w = 1.0 / candidates[wi].tier;
      weights.push(w);
      totalW += w;
    }
    var roll = Math.random() * totalW;
    var cum = 0;
    entry = candidates[0];
    for (var ri = 0; ri < candidates.length; ri++) {
      cum += weights[ri];
      if (roll <= cum) { entry = candidates[ri]; break; }
    }
  }

  var baseDef = _equipData.WEAPON_TYPES[entry.type];
  if (!baseDef) return null;

  var gSize = _gridSizes.getGridSize({ slot: entry.slot });
  var containerSize = _gridSizes.getContainerGridSize({ type: entry.type });

  var item = {
    id: generateItemId(),
    type: entry.type,
    name: baseDef.name,
    baseName: baseDef.name,
    rarity: entry.rarity,
    slot: entry.slot,
    stats: {},
    source: source,
    generatedAt: Date.now(),
    gridW: gSize.w,
    gridH: gSize.h,
    containerGridW: containerSize ? containerSize.w : 0,
    containerGridH: containerSize ? containerSize.h : 0,
    weight: accountWeight.getItemWeight({ type: entry.type, slot: entry.slot }),
  };

  return item;
}

// ---------------------------------------------------------------------------
// HELPER: Get active set bonuses for a player's equipment
// ---------------------------------------------------------------------------

function getActiveSetBonuses(equippedItems) {
  // equippedItems: array of item objects currently equipped
  var setCounts = {};
  for (var i = 0; i < equippedItems.length; i++) {
    var item = equippedItems[i];
    if (item && item.setId) {
      setCounts[item.setId] = (setCounts[item.setId] || 0) + 1;
    }
  }

  var activeBonuses = [];
  for (var sid in setCounts) {
    var count = setCounts[sid];
    var set = ITEM_SETS[sid];
    if (!set) continue;
    for (var threshold in set.bonuses) {
      if (count >= parseInt(threshold)) {
        activeBonuses.push({
          setId: sid,
          setName: set.name,
          threshold: parseInt(threshold),
          count: count,
          totalPieces: Object.keys(set.pieces).length,
          description: set.bonuses[threshold].description,
          effects: set.bonuses[threshold].effects,
        });
      }
    }
  }
  return activeBonuses;
}

// ---------------------------------------------------------------------------
// HELPER: Calculate total gem bonuses for an item
// ---------------------------------------------------------------------------

function getGemBonuses(item) {
  if (!item || !item.socketedGems || item.socketedGems.length === 0) return {};
  var bonuses = {};
  for (var i = 0; i < item.socketedGems.length; i++) {
    var gemId = item.socketedGems[i];
    var gem = GEM_TYPES[gemId];
    if (!gem) continue;
    for (var key in gem.effects) {
      bonuses[key] = (bonuses[key] || 0) + gem.effects[key];
    }
  }
  return bonuses;
}

// ---------------------------------------------------------------------------
// HELPER: Calculate augment bonuses for an item
// ---------------------------------------------------------------------------

function getAugmentBonuses(item) {
  if (!item || !item.augment) return {};
  var aug = AUGMENT_TYPES[item.augment];
  if (!aug) return {};
  return aug.effects || {};
}

// ---------------------------------------------------------------------------
// HELPER: Socket a gem into an item
// ---------------------------------------------------------------------------

function socketGem(item, gemId) {
  if (!item) return { error: 'No item' };
  if (!GEM_TYPES[gemId]) return { error: 'Invalid gem type' };
  if (!item.sockets || item.sockets <= 0) return { error: 'Item has no sockets' };
  if (item.socketedGems.length >= item.sockets) return { error: 'All sockets full' };

  var gem = GEM_TYPES[gemId];
  // Validate gem type vs slot
  var isWeaponSlot = (item.slot === 'weapon' || item.slot === 'shield');
  var isArmorSlot = ['head', 'chest', 'undershirt', 'arms', 'hands', 'legs', 'feet'].indexOf(item.slot) !== -1;

  if (gem.gemType === 'weapon' && !isWeaponSlot) return { error: 'Weapon gem requires weapon socket' };
  if (gem.gemType === 'armor' && !isArmorSlot) return { error: 'Armor gem requires armor socket' };
  // Utility gems go anywhere

  item.socketedGems.push(gemId);
  return { success: true, item: item };
}

// ---------------------------------------------------------------------------
// HELPER: Apply augment to an item
// ---------------------------------------------------------------------------

function applyAugment(item, augmentId) {
  if (!item) return { error: 'No item' };
  if (!item.hasAugmentSlot) return { error: 'Item has no augment slot' };
  var aug = AUGMENT_TYPES[augmentId];
  if (!aug) return { error: 'Invalid augment' };

  // Check category requirement
  if (aug.categoryReq && item.category !== aug.categoryReq) return { error: 'Wrong weapon category for this augment' };

  // Check slot type
  if (aug.slot === 'weapon' && item.slot !== 'weapon' && item.slot !== 'shield') return { error: 'Weapon augment on non-weapon' };
  if (aug.slot === 'armor' && ['head', 'chest', 'undershirt', 'arms', 'hands', 'legs', 'feet'].indexOf(item.slot) === -1) return { error: 'Armor augment on non-armor' };

  item.augment = augmentId;
  return { success: true, item: item };
}

// ---------------------------------------------------------------------------
// HELPER: Imbue a ring
// ---------------------------------------------------------------------------

function imbueRing(item) {
  if (!item) return { error: 'No item' };
  if (item.imbued) return { error: 'Already imbued' };
  if (!item.slot || item.slot.indexOf('ring') !== 0) return { error: 'Not a ring' };

  var cost = RING_IMBUE_COSTS[item.rarity];
  if (!cost) return { error: 'Ring rarity cannot be imbued' };

  // Double numeric effects
  if (item.stats) {
    for (var key in item.stats) {
      if (typeof item.stats[key] === 'number') {
        item.stats[key] = Math.round(item.stats[key] * 2 * 100) / 100;
      }
    }
  }
  if (item.effects) {
    for (var i = 0; i < item.effects.length; i++) {
      var eff = item.effects[i];
      if (eff.value && typeof eff.value === 'number') {
        eff.value = Math.round(eff.value * 2 * 100) / 100;
      }
    }
  }

  item.imbued = true;
  item.name = 'Imbued ' + item.name;
  return { success: true, item: item, cost: cost };
}

// ---------------------------------------------------------------------------
// HELPER: Get inscription data with upgrades applied
// ---------------------------------------------------------------------------

function getInscriptionData(scrollType, upgradeLevel) {
  var def = INSCRIPTION_DEFS[scrollType];
  if (!def) return null;

  var result = {
    name: def.name,
    scrollType: scrollType,
    cooldown: def.cooldown,
    description: def.description,
    effect: JSON.parse(JSON.stringify(def.effect)),
    upgradeLevel: upgradeLevel || 0,
    maxUpgrades: def.maxUpgrades,
  };

  // Apply upgrades
  if (upgradeLevel > 0 && def.upgrades) {
    var upIdx = Math.min(upgradeLevel, def.upgrades.length) - 1;
    var upgrade = def.upgrades[upIdx];
    for (var key in upgrade) {
      if (key === 'cooldown') {
        result.cooldown = upgrade.cooldown;
      } else {
        result.effect[key] = upgrade[key];
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// HELPER: Get weapon special for a weapon type/category
// ---------------------------------------------------------------------------

function getWeaponSpecial(itemType, category, uniqueId) {
  // Check named special first
  if (uniqueId && NAMED_WEAPON_SPECIALS[uniqueId]) {
    return NAMED_WEAPON_SPECIALS[uniqueId];
  }
  if (NAMED_WEAPON_SPECIALS[itemType]) {
    return NAMED_WEAPON_SPECIALS[itemType];
  }
  // Fall back to category special
  return WEAPON_SPECIALS[category] || null;
}

// ---------------------------------------------------------------------------
// HELPER: Roll item rarity based on dungeon depth
// ---------------------------------------------------------------------------

function rollItemRarity(depth) {
  // Higher depth = better chances
  var depthBonus = Math.min(depth * 0.005, 0.20); // max 20% shift
  var roll = Math.random();

  if (roll < 0.001 + depthBonus * 0.005)  return 'relic';
  if (roll < 0.009 + depthBonus * 0.02)   return 'legendary';
  if (roll < 0.04 + depthBonus * 0.05)    return 'ultra_rare';
  if (roll < 0.15 + depthBonus * 0.10)    return 'rare';
  if (roll < 0.45 + depthBonus * 0.10)    return 'uncommon';
  return 'common';
}

// ---------------------------------------------------------------------------
// HELPER: Generate loot drop table for dungeon floor
// ---------------------------------------------------------------------------

function rollDungeonLoot(depth, isBoss, isChest) {
  var items = [];
  var count = 1;
  if (isBoss) count = 2 + Math.floor(Math.random() * 2); // 2-3 items
  if (isChest) count = 1 + (Math.random() < 0.30 ? 1 : 0); // 1-2 items

  for (var i = 0; i < count; i++) {
    var rarity = rollItemRarity(depth);
    if (isBoss && (RARITY_ORDER[rarity] || 0) < (RARITY_ORDER['uncommon'] || 1)) {
      rarity = 'uncommon'; // Boss drops minimum uncommon
    }
    items.push({ rarity: rarity, depth: depth, source: isBoss ? 'boss' : isChest ? 'chest' : 'drop' });
  }

  // Container drop chance — bosses and chests can yield backpacks/rigs
  var containerChance = isBoss ? 0.06 : isChest ? 0.04 : 0;
  if (containerChance > 0 && Math.random() < containerChance) {
    items.push({ container: true, depth: depth, source: isBoss ? 'boss' : 'chest' });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Section 11: CONSUMABLE GENERATION (potions, scrolls, enchantments, brews)
// ---------------------------------------------------------------------------

var CONSUMABLE_QUALITY_TIERS = {
  dilute:     { mult: 0.70, color: '#999999', weight: 15 },
  standard:   { mult: 1.00, color: '#cccccc', weight: 40 },
  potent:     { mult: 1.25, color: '#22cc22', weight: 25 },
  concentrated: { mult: 1.50, color: '#3388ff', weight: 12 },
  masterwork: { mult: 1.80, color: '#aa44ff', weight: 6 },
  pristine:   { mult: 2.00, color: '#ffaa00', weight: 2 },
};

// Affixes that can appear on consumable items
var CONSUMABLE_AFFIXES = {
  potions: {
    prefixes: {
      soothing:    { name: 'Soothing',   effects: { healOverTime: 0.20 }, weight: 15, description: '+20% heal-over-time effect' },
      volatile:    { name: 'Volatile',    effects: { instantPct: 0.30, totalReduction: 0.10 }, weight: 10, description: '30% heals instantly, but 10% less total' },
      enriched:    { name: 'Enriched',    effects: { durationMult: 1.40 }, weight: 12, description: '+40% buff duration' },
      quicksilver: { name: 'Quicksilver', effects: { effectDelay: 0 }, weight: 8, description: 'Effect activates instantly' },
      lingering:   { name: 'Lingering',   effects: { durationMult: 2.0, potencyMult: 0.60 }, weight: 7, description: 'Lasts twice as long at 60% strength' },
      twin_brew:   { name: 'Twin-Brew',   effects: { secondaryEffect: true }, weight: 5, description: 'Also restores a small amount of the other pool (HP<->Mana)' },
    },
    suffixes: {
      of_purity:   { name: 'of Purity',    effects: { cleanse: 1 }, weight: 14, description: 'Removes 1 debuff on use' },
      of_vigor:    { name: 'of Vigor',      effects: { tempHpBonus: 10 }, weight: 10, description: '+10 temporary HP for 3 turns' },
      of_clarity:  { name: 'of Clarity',    effects: { tempManaRegen: 3 }, weight: 10, description: '+3 mana regen for 3 turns' },
      of_haste:    { name: 'of Haste',      effects: { speedBuff: 0.10, buffDuration: 2 }, weight: 8, description: '+10% speed for 2 turns' },
      of_fortitude:{ name: 'of Fortitude',  effects: { tempDefense: 5, buffDuration: 3 }, weight: 9, description: '+5 defense for 3 turns' },
      of_giants:   { name: 'of Giants',     effects: { tempDamage: 4, buffDuration: 2 }, weight: 6, description: '+4 damage for 2 turns' },
    },
  },
  scrolls: {
    prefixes: {
      amplified:   { name: 'Amplified',   effects: { effectMult: 1.30 }, weight: 12, description: '+30% effect strength' },
      quickened:   { name: 'Quickened',    effects: { cooldownReduction: 0.20 }, weight: 10, description: '-20% cooldown' },
      empowered:   { name: 'Empowered',   effects: { effectMult: 1.20, radiusBonus: 1 }, weight: 8, description: '+20% effect, +1 radius' },
      sustained:   { name: 'Sustained',   effects: { durationBonus: 1 }, weight: 12, description: '+1 turn duration' },
      arcane:      { name: 'Arcane',       effects: { effectMult: 1.15, manaCostReduction: 0.10 }, weight: 7, description: '+15% effect, -10% mana cost' },
    },
    suffixes: {
      of_echoing:  { name: 'of Echoing',    effects: { echoChance: 0.20 }, weight: 8, description: '20% chance to not consume a charge' },
      of_reach:    { name: 'of Reach',       effects: { radiusBonus: 1 }, weight: 10, description: '+1 radius on AoE effects' },
      of_mastery:  { name: 'of Mastery',     effects: { upgradeBoost: 1 }, weight: 5, description: 'Counts as 1 upgrade level higher' },
      of_precision:{ name: 'of Precision',   effects: { targetBonus: true }, weight: 9, description: 'Can target specific enemies' },
    },
  },
  brews: {
    prefixes: {
      aged:        { name: 'Aged',         effects: { potencyMult: 1.25 }, weight: 12, description: '+25% buff potency' },
      spiced:      { name: 'Spiced',       effects: { hpRegenBuff: 2 }, weight: 14, description: '+2 HP regen while active' },
      fortified:   { name: 'Fortified',    effects: { defenseBuff: 3 }, weight: 10, description: '+3 defense while active' },
      spirited:    { name: 'Spirited',     effects: { damageBuff: 2 }, weight: 10, description: '+2 damage while active' },
      enchanted:   { name: 'Enchanted',    effects: { manaRegenBuff: 2 }, weight: 8, description: '+2 mana regen while active' },
    },
    suffixes: {
      of_warmth:   { name: 'of Warmth',   effects: { coldResist: 0.20 }, weight: 12, description: '+20% cold resistance' },
      of_courage:  { name: 'of Courage',   effects: { fearImmune: true }, weight: 8, description: 'Immune to fear effects' },
      of_revelry:  { name: 'of Revelry',   effects: { xpBonusPct: 0.05, durationMult: 1.50 }, weight: 6, description: '+5% XP, +50% duration' },
    },
  },
  food: {
    prefixes: {
      hearty:       { name: 'Hearty',       effects: { hpRestoreMult: 1.30 }, weight: 15, description: '+30% HP restore' },
      savory:       { name: 'Savory',        effects: { buffDurationMult: 1.30 }, weight: 14, description: '+30% buff duration' },
      spiced:       { name: 'Spiced',        effects: { statBuff: 1 }, weight: 12, description: '+1 to buff stat value' },
      nourishing:   { name: 'Nourishing',    effects: { hpRegen: 2, regenDuration: 5 }, weight: 10, description: '+2 HP regen for 5 turns' },
      fortifying:   { name: 'Fortifying',    effects: { defBuff: 3, buffDuration: 3 }, weight: 8, description: '+3 defense for 3 turns' },
      invigorating: { name: 'Invigorating',  effects: { speedBuff: 0.08, buffDuration: 3 }, weight: 7, description: '+8% speed for 3 turns' },
    },
    suffixes: {
      of_warmth:    { name: 'of Warmth',     effects: { coldResist: 0.15 }, weight: 12, description: '+15% cold resistance' },
      of_endurance: { name: 'of Endurance',   effects: { staminaRegen: 3 }, weight: 10, description: '+3 stamina regen' },
      of_sharpness: { name: 'of Sharpness',   effects: { critChance: 0.04 }, weight: 9, description: '+4% crit chance' },
      of_the_farmer:{ name: 'of the Farmer',  effects: { farmingXpBonus: 0.10 }, weight: 8, description: '+10% farming XP' },
      of_satiety:   { name: 'of Satiety',     effects: { foodCooldownReduction: 0.20 }, weight: 7, description: '-20% food cooldown' },
      of_clarity:   { name: 'of Clarity',     effects: { manaRegen: 2 }, weight: 6, description: '+2 mana regen' },
    },
  },
};

// Determine consumable type category
function getConsumableCategory(resourceType) {
  if (!resourceType) return null;
  if (resourceType.indexOf('potion_') === 0 || resourceType.indexOf('elixir_') === 0 ||
      resourceType === 'antidote' || resourceType.indexOf('flask_') === 0) return 'potions';
  if (resourceType.indexOf('scroll_') === 0 || resourceType.indexOf('rune_stone_') === 0) return 'scrolls';
  if (resourceType === 'ale' || resourceType === 'mead' || resourceType === 'wine' ||
      resourceType === 'spirits' || resourceType === 'fortified_ale' || resourceType === 'battle_brew') return 'brews';
  var foodTypes = ['cooked_fish', 'bread', 'stew', 'herb_tea', 'grilled_meat', 'berry_jam',
    'pumpkin_pie', 'corn_bread', 'honey_cake', 'cheese_wheel', 'ancient_fruit_wine'];
  if (foodTypes.indexOf(resourceType) !== -1) return 'food';
  return null;
}

// Roll consumable quality — crafting skill makes higher quality more likely
function rollConsumableQuality(craftSkillLevel) {
  var skillBonus = Math.min((craftSkillLevel || 1) * 0.01, 0.30); // max +30% shift
  var tiers = Object.keys(CONSUMABLE_QUALITY_TIERS);
  var totalWeight = 0;
  var entries = [];
  for (var i = 0; i < tiers.length; i++) {
    var tier = CONSUMABLE_QUALITY_TIERS[tiers[i]];
    var w = tier.weight;
    // Skill bonus: reduce low-tier weight, increase high-tier weight
    if (tiers[i] === 'dilute') w = Math.max(1, w * (1 - skillBonus * 2));
    if (tiers[i] === 'standard') w = Math.max(5, w * (1 - skillBonus));
    if (tiers[i] === 'concentrated' || tiers[i] === 'masterwork' || tiers[i] === 'pristine') {
      w = w * (1 + skillBonus * 3);
    }
    totalWeight += w;
    entries.push({ id: tiers[i], weight: w, tier: tier });
  }
  var roll = Math.random() * totalWeight;
  var cum = 0;
  for (var j = 0; j < entries.length; j++) {
    cum += entries[j].weight;
    if (roll <= cum) return { id: entries[j].id, mult: entries[j].tier.mult, color: entries[j].tier.color };
  }
  return { id: 'standard', mult: 1.0, color: '#cccccc' };
}

// Roll a consumable affix
function rollConsumableAffix(type, category) {
  var pool = CONSUMABLE_AFFIXES[category];
  if (!pool) return null;
  var affixPool = pool[type === 'prefix' ? 'prefixes' : 'suffixes'];
  if (!affixPool) return null;
  var candidates = [];
  var totalWeight = 0;
  for (var id in affixPool) {
    totalWeight += affixPool[id].weight;
    candidates.push({ id: id, affix: affixPool[id] });
  }
  if (candidates.length === 0) return null;
  var roll = Math.random() * totalWeight;
  var cum = 0;
  for (var i = 0; i < candidates.length; i++) {
    cum += candidates[i].affix.weight;
    if (roll <= cum) {
      return { id: candidates[i].id, name: candidates[i].affix.name, effects: candidates[i].affix.effects, description: candidates[i].affix.description };
    }
  }
  return null;
}

/**
 * Generate a procedural consumable item (potion, scroll, brew).
 * Returns an item object stored in inventory items array (not resource pool).
 * @param {string} resourceType - e.g. 'potion_health', 'scroll_of_protection', 'battle_brew'
 * @param {string} displayName - base display name
 * @param {object} options - { craftSkillLevel, source }
 */
function generateConsumable(resourceType, displayName, options) {
  options = options || {};
  var category = getConsumableCategory(resourceType);
  if (!category) return null; // Not a consumable type

  var luckBonus = options.luckBonus || 0;
  var craftSkill = options.craftSkillLevel || 1;
  var quality = rollConsumableQuality(craftSkill);

  // Affix chances: higher skill = more affixes
  var prefixChance = Math.min(0.15 + craftSkill * 0.01, 0.60);
  var suffixChance = Math.min(0.10 + craftSkill * 0.008, 0.45);

  var prefix = null;
  var suffix = null;
  if (Math.random() < prefixChance) {
    prefix = rollConsumableAffix('prefix', category);
  }
  if (Math.random() < suffixChance) {
    suffix = rollConsumableAffix('suffix', category);
  }

  // Build display name
  var nameParts = [];
  if (quality.id !== 'standard' && quality.id !== 'dilute') {
    nameParts.push(quality.id.charAt(0).toUpperCase() + quality.id.slice(1));
  }
  if (prefix) nameParts.push(prefix.name);
  nameParts.push(displayName);
  if (suffix) nameParts.push(suffix.name);

  var item = {
    id: generateItemId(),
    type: resourceType,
    name: nameParts.join(' '),
    baseName: displayName,
    isConsumable: true,
    consumableCategory: category,
    quality: quality.id,
    qualityMult: quality.mult,
    qualityColor: quality.color,
    prefix: prefix ? prefix.id : null,
    prefixName: prefix ? prefix.name : null,
    prefixEffects: prefix ? prefix.effects : null,
    suffix: suffix ? suffix.id : null,
    suffixName: suffix ? suffix.name : null,
    suffixEffects: suffix ? suffix.effects : null,
    source: options.source || 'craft',
    generatedAt: Date.now(),
    stackable: false, // procedural consumables don't stack
  };

  // Procedural mutation roll on consumables (4% base, skill + luck scaled)
  var _cMutHint = (category === 'scrolls') ? 'scroll' : 'consumable';
  var _cMutBase = Math.min(0.04 + craftSkill * 0.002, 0.15);
  var _cMut = rollItemMutation(_cMutBase, luckBonus, _cMutHint);
  if (_cMut) applyItemMutation(item, _cMut);

  // Curse roll on consumables (dangerous ingredients or bad batch)
  var _cCurseBase = BIOME_CURSE_CHANCE.crafted;
  if (options.biome && BIOME_CURSE_CHANCE[options.biome]) _cCurseBase = BIOME_CURSE_CHANCE[options.biome];
  var _cCurse = rollItemCurse(_cCurseBase, luckBonus, _cMutHint);
  if (_cCurse) applyItemCurse(item, _cCurse);

  // Stamp physical weight for encumbrance system
  item.weight = accountWeight.getItemWeight(item);

  // Stamp grid dimensions for Tarkov-style inventory
  var _gSize = _gridSizes.getGridSize(item);
  item.gridW = _gSize.w;
  item.gridH = _gSize.h;

  return item;
}

// ---------------------------------------------------------------------------
// Section 12: ITEM MUTATION SYSTEM
// ---------------------------------------------------------------------------
// Procedural mutations add unexpected stat/effect flavor to weapons, armor,
// scrolls, and consumables. Similar to card mutations but adapted for
// equipment. Triggered at item generation or on craft with luck scaling.
// ---------------------------------------------------------------------------

// canViral: true means this mutation can spread to adjacent equipped items on equip (luck-scaled)
var ITEM_MUTATION_POOL = [
  // ── Tier 1: Minor mutations ──
  // Weapons
  { id: 'razor_edge',      name: 'Razor Edge',      tier: 1, weight: 18, slot: ['weapon'],
    apply: function(s) { s.bleedChance = (s.bleedChance || 0) + 0.07; } },
  { id: 'weighted_heft',   name: 'Weighted Heft',   tier: 1, weight: 16, slot: ['weapon'],
    apply: function(s) { s.damage = (s.damage || 0) + 2; } },
  { id: 'lucky_strike',    name: 'Lucky Strike',    tier: 1, weight: 14, slot: ['weapon'],
    apply: function(s) { s.critBonus = (s.critBonus || 0) + 0.04; } },
  { id: 'tempered_mind',   name: 'Tempered Mind',   tier: 1, weight: 15, slot: ['weapon'],
    apply: function(s) { s.magicDamage = (s.magicDamage || 0) + 2; } },
  // Armor
  { id: 'light_step',      name: 'Light Step',      tier: 1, weight: 12, slot: ['armor'],
    apply: function(s) { s.speedBonus = (s.speedBonus || 0) + 0.03; } },
  { id: 'iron_skin',       name: 'Iron Skin',       tier: 1, weight: 16, slot: ['armor'],
    apply: function(s) { s.defense = (s.defense || 0) + 2; } },
  { id: 'ward_mind',       name: 'Ward Mind',       tier: 1, weight: 14, slot: ['armor'],
    apply: function(s) { s.magicResist = (s.magicResist || 0) + 3; } },
  // Jewelry / rings
  { id: 'fortune_charm',   name: 'Fortune Charm',   tier: 1, weight: 15, slot: ['jewelry'], canViral: true,
    apply: function(s) { s.luck = (s.luck || 0) + 0.04; s.dropQualityBonus = (s.dropQualityBonus || 0) + 0.03; } },
  { id: 'swift_thought',   name: 'Swift Thought',   tier: 1, weight: 13, slot: ['jewelry'],
    apply: function(s) { s.xpGainBonus = (s.xpGainBonus || 0) + 0.05; } },
  { id: 'merchants_eye',   name: "Merchant's Eye",  tier: 1, weight: 12, slot: ['jewelry'],
    apply: function(s) { s.presence = (s.presence || 0) + 1; s.tradeBonus = (s.tradeBonus || 0) + 0.03; } },
  { id: 'steady_resolve',  name: 'Steady Resolve',  tier: 1, weight: 11, slot: ['jewelry'],
    apply: function(s) { s.resolve = (s.resolve || 0) + 1; s.debuffResist = (s.debuffResist || 0) + 0.05; } },
  // Consumables / scrolls
  { id: 'potent_brew',     name: 'Potent Brew',     tier: 1, weight: 15, slot: ['consumable'],
    apply: function(s) { s.potencyMult = (s.potencyMult || 1.0) + 0.15; } },
  { id: 'quick_sip',       name: 'Quick Sip',       tier: 1, weight: 12, slot: ['consumable'],
    apply: function(s) { s.castTime = 0; } },
  { id: 'scroll_echo',     name: 'Scroll Echo',     tier: 1, weight: 10, slot: ['scroll'],
    apply: function(s) { s.echoChance = (s.echoChance || 0) + 0.15; } },

  // ── Tier 2: Moderate mutations ──
  // Weapons
  { id: 'spark_on_hit',    name: 'Sparking',        tier: 2, weight: 10, slot: ['weapon'], canViral: true,
    apply: function(s) { s.element = s.element || 'lightning'; s.shockOnHitChance = (s.shockOnHitChance || 0) + 0.12; } },
  { id: 'drain_strike',    name: 'Draining',        tier: 2, weight: 9,  slot: ['weapon'],
    apply: function(s) { s.lifeSteal = (s.lifeSteal || 0) + 0.05; s.manaDrain = (s.manaDrain || 0) + 2; } },
  { id: 'chill_touch',     name: 'Chilling',        tier: 2, weight: 8,  slot: ['weapon'],
    apply: function(s) { s.element = s.element || 'ice'; s.chillOnHitChance = (s.chillOnHitChance || 0) + 0.18; } },
  { id: 'poison_coat',     name: 'Venom-Coated',    tier: 2, weight: 9,  slot: ['weapon'],
    apply: function(s) { s.poisonOnHitChance = (s.poisonOnHitChance || 0) + 0.15; s.poisonDamage = (s.poisonDamage || 0) + 3; } },
  // Armor
  { id: 'vital_armor',     name: 'Vital',           tier: 2, weight: 9,  slot: ['armor'], canViral: true,
    apply: function(s) { s.hpRegen = (s.hpRegen || 0) + 2; } },
  { id: 'deflect_aura',    name: 'Deflecting',      tier: 2, weight: 7,  slot: ['armor'],
    apply: function(s) { s.deflectChance = (s.deflectChance || 0) + 0.08; s.thornsDamage = (s.thornsDamage || 0) + 3; } },
  // Jewelry / rings
  { id: 'mana_coil',       name: 'Mana Coil',       tier: 2, weight: 9,  slot: ['jewelry'], canViral: true,
    apply: function(s) { s.manaRegen = (s.manaRegen || 0) + 2; s.spellCostReduction = (s.spellCostReduction || 0) + 0.06; } },
  { id: 'soul_catch',      name: 'Soul Catch',      tier: 2, weight: 8,  slot: ['jewelry'],
    apply: function(s) { s.hpOnKill = (s.hpOnKill || 0) + 4; } },
  { id: 'lucky_ward',      name: 'Lucky Ward',      tier: 2, weight: 7,  slot: ['jewelry'], canViral: true,
    apply: function(s) { s.luck = (s.luck || 0) + 0.08; s.negateDebuffChance = (s.negateDebuffChance || 0) + 0.10; } },
  { id: 'kinetic_band',    name: 'Kinetic Band',    tier: 2, weight: 6,  slot: ['jewelry'],
    apply: function(s) { s.speedBonus = (s.speedBonus || 0) + 0.06; s.staminaRegen = (s.staminaRegen || 0) + 2; } },
  // Scrolls / consumables
  { id: 'binding_scroll',  name: 'Binding',         tier: 2, weight: 8,  slot: ['scroll'],
    apply: function(s) { s.durationBonus = (s.durationBonus || 0) + 2; } },
  { id: 'twin_cast',       name: 'Twin-Cast',       tier: 2, weight: 6,  slot: ['scroll'],
    apply: function(s) { s.twinCastChance = (s.twinCastChance || 0) + 0.20; } },
  { id: 'fortifying_brew', name: 'Fortifying',      tier: 2, weight: 8,  slot: ['consumable'],
    apply: function(s) { s.tempDefense = (s.tempDefense || 0) + 6; s.buffDuration = (s.buffDuration || 2) + 1; } },

  // ── Tier 3: Major mutations (rare, powerful unique effects) ──
  // Weapons
  { id: 'soulbane',        name: 'Soulbane',        tier: 3, weight: 4,  slot: ['weapon'], canViral: true,
    apply: function(s) { s.soulbane = true; s.bonusVsUndead = (s.bonusVsUndead || 0) + 0.30; s.damage = (s.damage || 0) + 5; } },
  { id: 'stormcaller',     name: 'Stormcaller',     tier: 3, weight: 3,  slot: ['weapon'],
    apply: function(s) { s.element = 'lightning'; s.aoeOnCritChance = (s.aoeOnCritChance || 0) + 0.25; s.elementDamage = (s.elementDamage || 0) + 8; } },
  { id: 'voidheart',       name: 'Voidheart',       tier: 3, weight: 3,  slot: ['weapon', 'armor', 'jewelry'], canViral: true,
    apply: function(s) { s.element = s.element || 'shadow'; s.voidShredChance = (s.voidShredChance || 0) + 0.15; s.damageBonus = (s.damageBonus || 0) + 0.12; } },
  // Armor
  { id: 'lifebound',       name: 'Lifebound',       tier: 3, weight: 4,  slot: ['armor'], canViral: true,
    apply: function(s) { s.hpRegen = (s.hpRegen || 0) + 4; s.lifeStealAura = (s.lifeStealAura || 0) + 0.04; } },
  { id: 'arcane_vessel',   name: 'Arcane Vessel',   tier: 3, weight: 3,  slot: ['armor'],
    apply: function(s) { s.manaRegen = (s.manaRegen || 0) + 3; s.spellCostReduction = (s.spellCostReduction || 0) + 0.12; } },
  // Jewelry / rings — most powerful jewelry mutations
  { id: 'fortune_ward',    name: 'Fortune Ward',    tier: 3, weight: 4,  slot: ['jewelry'], canViral: true,
    apply: function(s) { s.luck = (s.luck || 0) + 0.15; s.deathNegate = true; s.deathNegateRecharge = 86400; } },
  { id: 'soul_bond',       name: 'Soul Bond',       tier: 3, weight: 3,  slot: ['jewelry'],
    apply: function(s) { s.allStats = (s.allStats || 0) + 1; s.xpGainBonus = (s.xpGainBonus || 0) + 0.10; s.soulBound = true; } },
  { id: 'aurora_ring',     name: 'Aurora Ring',     tier: 3, weight: 3,  slot: ['jewelry'], canViral: true,
    apply: function(s) { s.randomElementProc = true; s.elementDamage = (s.elementDamage || 0) + 5; s.luck = (s.luck || 0) + 0.10; } },
  { id: 'void_sigil',      name: 'Void Sigil',      tier: 3, weight: 2,  slot: ['jewelry'],
    apply: function(s) { s.element = 'shadow'; s.damageBonus = (s.damageBonus || 0) + 0.15; s.voidSigilActive = true; } },
  // Scrolls / consumables
  { id: 'miracle_brew',    name: 'Miraculous',      tier: 3, weight: 3,  slot: ['consumable'],
    apply: function(s) { s.potencyMult = (s.potencyMult || 1.0) + 0.50; s.noConsume = true; } },
  { id: 'grand_inscription',name: 'Grand',          tier: 3, weight: 3,  slot: ['scroll'],
    apply: function(s) { s.effectMult = (s.effectMult || 1.0) + 0.40; s.noConsume = true; } },

  // ── Wild mutations: true outliers. weight:1, wild:true (~1% of triggered pool) ──
  { id: 'wild_sentient',    name: 'Sentient',        tier: 3, weight: 1, wild: true, slot: ['weapon'],
    description: 'The weapon has opinions. +1 detection range. 10% chance to auto-parry first attack per encounter.',
    apply: function(s) { s.sentient = true; s.preEmptiveParry = 0.10; s.detectionRange = (s.detectionRange || 0) + 1; } },
  { id: 'wild_temporal',    name: 'Temporal Memory', tier: 3, weight: 1, wild: true, slot: ['weapon'],
    description: 'Remembers its last kill type. +20% damage vs that specific enemy type. Resets on each different kill.',
    apply: function(s) { s.temporalMemory = true; s.killTypeBonus = 0.20; } },
  { id: 'wild_gravitational', name: 'Gravitational', tier: 3, weight: 1, wild: true, slot: ['weapon', 'armor', 'jewelry'],
    description: 'After kills, pulls loose items and coins within 4 tiles toward player automatically.',
    apply: function(s) { s.gravitationalPull = true; s.pullRange = 4; } },
  { id: 'wild_spectral_bypass', name: 'Spectral Bypass', tier: 3, weight: 1, wild: true, slot: ['weapon'],
    description: 'Hits stealthed/invisible enemies as if fully visible. 20% chance to pierce through thin walls.',
    apply: function(s) { s.hitsStealthed = true; s.wallPierceChance = 0.20; } },
  { id: 'wild_hollow_core', name: 'Hollow Core',    tier: 3, weight: 1, wild: true, slot: ['armor', 'jewelry'],
    description: 'Supernaturally weightless. No carry penalty, no speed reduction. Something used to live inside it.',
    apply: function(s) { s.weightless = true; s.noSpeedPenalty = true; s.speedBonus = (s.speedBonus || 0) + 0.04; } },
  { id: 'wild_singing',     name: 'Singing Steel',  tier: 3, weight: 1, wild: true, slot: ['weapon', 'armor'],
    description: 'Emits tones near traps and hidden doors. Passive trap detection within 3 tiles. Hidden door sense.',
    apply: function(s) { s.trapDetection = true; s.trapDetectionRange = 3; s.hiddenDoorSense = true; } },
  { id: 'wild_blood_covenant', name: 'Blood Covenant', tier: 3, weight: 1, wild: true, slot: ['weapon'],
    description: 'Soul-binds to first wielder. Grows with kills: +0.3% primary stat per 10 kills. Death resets all growth.',
    apply: function(s) { s.soulBound = true; s.killGrowthPrimary = 0.003; s.deathResetGrowth = true; } },
  { id: 'wild_chromatic',   name: 'Chromatic Cycle', tier: 3, weight: 1, wild: true, slot: ['weapon'],
    description: 'Rotates through all 6 elements every 8 kills. Item glows its current element color.',
    apply: function(s) { s.chromaticCycle = true; s.cycleKills = 8; s.elementDamage = (s.elementDamage || 0) + 4; } },
  { id: 'wild_history',     name: 'History Carved',  tier: 3, weight: 1, wild: true, slot: ['weapon', 'armor'],
    description: 'Each unique enemy type killed adds an inscription. After 50 types: +1% damage per 5 unique types thereafter.',
    apply: function(s) { s.historyCarved = true; s.killDiversityBonus = true; s.bonusPerFiveTypes = 0.01; } },
  { id: 'wild_starfall',    name: 'Starfall Binding', tier: 3, weight: 1, wild: true, slot: ['jewelry'],
    description: 'Cannot be stolen, pickpocketed, or forcibly removed. If somehow lost, returns after 30 minutes.',
    apply: function(s) { s.stealImmune = true; s.pickpocketImmune = true; s.returnAfterLoss = 1800; s.destroyCurseImmune = true; } },
];

/**
 * Roll for an item mutation based on chance + luck scaling.
 * luckBonus: 0-based float (0.10 = 10% extra luck)
 * Returns a mutation object or null.
 * Tier access: luck >= 0.10 unlocks tier 2, luck >= 0.30 unlocks tier 3.
 */
function rollItemMutation(baseChance, luckBonus, itemSlotHint) {
  luckBonus = luckBonus || 0;
  var finalChance = Math.min(baseChance * (1 + luckBonus * 3), 0.50);
  if (Math.random() >= finalChance) return null;

  // Determine max tier accessible
  var maxTier = 1;
  if (luckBonus >= 0.30) maxTier = 3;
  else if (luckBonus >= 0.10) maxTier = 2;

  // Filter pool by max tier and slot hint
  var candidates = [];
  var totalWeight = 0;
  for (var i = 0; i < ITEM_MUTATION_POOL.length; i++) {
    var m = ITEM_MUTATION_POOL[i];
    if (m.tier > maxTier) continue;
    // Slot matching: if itemSlotHint provided, filter to matching slot types
    if (itemSlotHint && m.slot && m.slot.indexOf(itemSlotHint) === -1) continue;
    candidates.push(m);
    totalWeight += m.weight;
  }
  if (candidates.length === 0) return null;

  var roll = Math.random() * totalWeight;
  var cum = 0;
  for (var j = 0; j < candidates.length; j++) {
    cum += candidates[j].weight;
    if (roll <= cum) return candidates[j];
  }
  return candidates[candidates.length - 1];
}

/**
 * Apply an item mutation to an item's stats object.
 * Tracks mutation in item.mutations array for display/reference.
 */
function applyItemMutation(item, mutation) {
  if (!item || !mutation) return;
  if (!item.stats) item.stats = {};
  if (!item.mutations) item.mutations = [];
  mutation.apply(item.stats);
  item.mutations.push({ id: mutation.id, name: mutation.name, tier: mutation.tier });
  // Prepend mutation name to item name for flavor
  item.name = '[' + mutation.name + '] ' + item.name;
}

/**
 * Attempt viral spread of a mutated item's mutation to adjacent equipped items.
 * Called when a mutated item is equipped (from gear equip handler).
 * sourceItem: the newly equipped item with mutations[]
 * otherEquippedItems: array of other currently equipped item objects
 * luckBonus: player's total luck bonus float
 * Returns array of { item, mutation } spread results.
 */
function spreadItemViralMutation(sourceItem, otherEquippedItems, luckBonus) {
  if (!sourceItem || !sourceItem.mutations || sourceItem.mutations.length === 0) return [];
  if (!otherEquippedItems || otherEquippedItems.length === 0) return [];

  // Only viral-capable mutations can spread
  var viralSource = null;
  for (var mi = 0; mi < sourceItem.mutations.length; mi++) {
    var mut = sourceItem.mutations[mi];
    // Find full mutation definition to check canViral
    for (var pi = 0; pi < ITEM_MUTATION_POOL.length; pi++) {
      if (ITEM_MUTATION_POOL[pi].id === mut.id && ITEM_MUTATION_POOL[pi].canViral) {
        viralSource = ITEM_MUTATION_POOL[pi];
        break;
      }
    }
    if (viralSource) break;
  }
  if (!viralSource) return [];

  // Spread chance: 15% base + luck-scaled, capped at 40%
  var luckB = luckBonus || 0;
  var spreadChance = Math.min(0.15 * (1 + luckB * 3), 0.40);

  var spreadResults = [];
  for (var ei = 0; ei < otherEquippedItems.length; ei++) {
    var target = otherEquippedItems[ei];
    if (!target || !target.stats) continue;
    if (Math.random() >= spreadChance) continue;

    // Spread a tier-1 mutation appropriate to the target's slot type
    var tSlot = null;
    if (target.slot === 'weapon' || target.slot === 'shield') tSlot = 'weapon';
    else if (['head','chest','undershirt','arms','hands','legs','feet'].indexOf(target.slot) !== -1) tSlot = 'armor';
    else if (['ring1','ring2','necklace'].indexOf(target.slot) !== -1) tSlot = 'jewelry';
    var spreadMut = rollItemMutation(1.0, 0, tSlot); // always rolls if we reach here
    if (!spreadMut || spreadMut.tier > 2) continue; // viral spreads max tier 2
    var spreadMutCopy = JSON.parse(JSON.stringify({ id: spreadMut.id, name: spreadMut.name, tier: spreadMut.tier }));
    spreadMutCopy.viral = true;
    if (!target.mutations) target.mutations = [];
    spreadMut.apply(target.stats);
    target.mutations.push(spreadMutCopy);
    target.name = '[' + spreadMut.name + '] ' + target.name;
    spreadResults.push({ item: target, mutation: spreadMutCopy });
  }
  return spreadResults;
}

// ---------------------------------------------------------------------------
// Section 13: CURSE SYSTEM
// ---------------------------------------------------------------------------
// Curses are negative procedural effects on items, equipment, scrolls, and
// consumables. Similar structure to mutations but always bad. They can be
// cleansed with purification scrolls or alchemy. Curse chance is biome/source
// dependent and inversely luck-scaled (more luck = fewer curses).
// ---------------------------------------------------------------------------

var ITEM_CURSE_POOL = [
  // ── Tier 1: Minor curses (annoying but manageable) ──
  { id: 'brittle',         name: 'Brittle',         tier: 1, weight: 18, slot: ['weapon', 'armor'],
    apply: function(s) { s.durabilityPenalty = (s.durabilityPenalty || 0) + 0.20; } },
  { id: 'sluggish',        name: 'Sluggish',         tier: 1, weight: 16, slot: ['armor', 'jewelry'],
    apply: function(s) { s.speedBonus = (s.speedBonus || 0) - 0.05; } },
  { id: 'mana_drain',      name: 'Mana Drain',       tier: 1, weight: 14, slot: ['weapon', 'jewelry'],
    apply: function(s) { s.manaRegen = (s.manaRegen || 0) - 1; } },
  { id: 'clumsy',          name: 'Clumsy',           tier: 1, weight: 15, slot: ['weapon', 'armor'],
    apply: function(s) { s.critBonus = (s.critBonus || 0) - 0.04; } },
  { id: 'tarnished',       name: 'Tarnished',        tier: 1, weight: 14, slot: ['jewelry'],
    apply: function(s) { s.presence = (s.presence || 0) - 1; s.luck = (s.luck || 0) - 0.03; } },
  { id: 'unstable_brew',   name: 'Unstable',         tier: 1, weight: 15, slot: ['consumable'],
    apply: function(s) { s.potencyMult = (s.potencyMult || 1.0) - 0.15; s.selfDamageChance = (s.selfDamageChance || 0) + 0.05; } },
  { id: 'fading_ink',      name: 'Fading',           tier: 1, weight: 13, slot: ['scroll'],
    apply: function(s) { s.effectMult = (s.effectMult || 1.0) - 0.15; } },

  // ── Tier 2: Moderate curses (impactful, worth cleansing) ──
  { id: 'bleeding_edge',   name: 'Self-Bleed',       tier: 2, weight: 10, slot: ['weapon'],
    apply: function(s) { s.selfBleedChance = (s.selfBleedChance || 0) + 0.10; s.damage = (s.damage || 0) - 1; } },
  { id: 'weight_of_sin',   name: 'Weight of Sin',    tier: 2, weight: 9,  slot: ['armor'],
    apply: function(s) { s.speedBonus = (s.speedBonus || 0) - 0.10; s.staminaDrain = (s.staminaDrain || 0) + 2; } },
  { id: 'hexed',           name: 'Hexed',            tier: 2, weight: 8,  slot: ['jewelry', 'armor'],
    apply: function(s) { s.debuffResist = (s.debuffResist || 0) - 0.15; s.negativeStatusChance = (s.negativeStatusChance || 0) + 0.08; } },
  { id: 'enervating',      name: 'Enervating',       tier: 2, weight: 7,  slot: ['jewelry'],
    apply: function(s) { s.xpGainBonus = (s.xpGainBonus || 0) - 0.10; } },
  { id: 'corrupted_brew',  name: 'Corrupted',        tier: 2, weight: 7,  slot: ['consumable'],
    apply: function(s) { s.potencyMult = (s.potencyMult || 1.0) - 0.25; s.poisonOnUseChance = (s.poisonOnUseChance || 0) + 0.20; } },

  // ── Tier 3: Major curses (severe, biome-flavored, must cleanse) ──
  { id: 'rift_taint',      name: 'Rift-Tainted',     tier: 3, weight: 4,  slot: ['weapon', 'armor', 'jewelry'],
    apply: function(s) { s.riftTainted = true; s.defense = (s.defense || 0) - 4; s.magicResist = (s.magicResist || 0) - 5; s.riftEntitiesAggroBonus = 0.25; } },
  { id: 'soul_siphon',     name: 'Soul Siphon',      tier: 3, weight: 3,  slot: ['weapon', 'jewelry'],
    apply: function(s) { s.soulSiphon = true; s.hpOnAttackDrain = (s.hpOnAttackDrain || 0) + 3; s.damage = (s.damage || 0) + 3; } },
  { id: 'death_brand',     name: 'Death Brand',      tier: 3, weight: 2,  slot: ['armor', 'jewelry'],
    apply: function(s) { s.deathBrand = true; s.deathPenaltyMult = (s.deathPenaltyMult || 1.0) + 0.50; } },
  { id: 'hollowing',       name: 'Hollowing',        tier: 3, weight: 3,  slot: ['weapon', 'armor', 'jewelry'],
    apply: function(s) { s.hollowing = true; s.allStats = (s.allStats || 0) - 1; s.evoXpPenalty = 0.25; } },

  // ── Wild curses: true outliers. weight:1, wild:true (~1% of triggered pool) ──
  { id: 'wild_curse_contrarian', name: 'Contrarian Spirit', tier: 3, weight: 1, wild: true, slot: ['weapon'],
    description: '6% chance per attack to silently do zero damage. The item simply refuses. It has opinions.',
    apply: function(s) { s.contrarian = true; s.selfNullChance = 0.06; } },
  { id: 'wild_curse_magnetic', name: 'Magnetic Jinx',     tier: 3, weight: 1, wild: true, slot: ['weapon', 'armor', 'jewelry'],
    description: 'All traps within 5 tiles permanently trigger toward the player. +15% ambush spawn rate.',
    apply: function(s) { s.trapAttractionRange = 5; s.ambushSpawnBonus = 0.15; } },
  { id: 'wild_curse_debt',    name: 'The Debt Collector', tier: 3, weight: 1, wild: true, slot: ['weapon', 'armor'],
    description: 'Every 10 kills, 7 coins vanish from the wallet silently. Going broke halves the item\'s stats.',
    apply: function(s) { s.killDebtInterval = 10; s.killDebtAmount = 7; s.bankruptPenalty = 0.50; } },
  { id: 'wild_curse_hollow',  name: 'Hollow Victory',     tier: 3, weight: 1, wild: true, slot: ['weapon'],
    description: 'On killing blows, 40% of kill XP is stolen and given to the nearest living enemy. Kills feel hollow.',
    apply: function(s) { s.hollowVictory = true; s.killXpSiphon = 0.40; } },
  { id: 'wild_curse_inverse', name: 'Inverse Ward',       tier: 3, weight: 1, wild: true, slot: ['armor', 'jewelry'],
    description: 'Magic resistance applies equally to your own outgoing spells. Your defenses don\'t know friend from foe.',
    apply: function(s) { s.inverseWard = true; s.selfMagicResistPenalty = true; } },
  { id: 'wild_curse_phase',   name: 'Phase Sickness',     tier: 3, weight: 1, wild: true, slot: ['armor', 'jewelry'],
    description: 'After any teleport (portal, descent, fast travel), item loses all stats for exactly 13 seconds.',
    apply: function(s) { s.phaseSickness = true; s.teleportDebuffSeconds = 13; } },
  { id: 'wild_curse_jealous', name: 'Jealous Craft',      tier: 3, weight: 1, wild: true, slot: ['weapon', 'armor'],
    description: 'Slowly degrades if any other item in its slot category is also equipped. -1 durability/hour with a rival equipped.',
    apply: function(s) { s.jealousCraft = true; s.rivalDurabilityDrain = 1; } },
  { id: 'wild_curse_truename', name: 'The True Name',     tier: 3, weight: 1, wild: true, slot: ['weapon', 'armor', 'jewelry'],
    description: 'Brands the wielder with a unique death name. On every death, the name is announced to nearby players.',
    apply: function(s) { s.trueName = true; s.deathAnnounce = true; } },
  { id: 'wild_curse_wrong_hand', name: 'Wrong-Handed',    tier: 3, weight: 1, wild: true, slot: ['weapon'],
    description: 'All combat bonuses take a 20% penalty in the dominant hand. Must wield off-hand for full stats.',
    apply: function(s) { s.wrongHanded = true; s.dominantHandPenalty = 0.20; } },
  { id: 'wild_curse_parasite', name: 'Symbiotic Parasite', tier: 3, weight: 1, wild: true, slot: ['weapon', 'armor'],
    description: 'Drains -1 to all stats from the equipped ring per hour to power itself. Gains +0.01% primary stat per point drained.',
    apply: function(s) { s.symbioticParasite = true; s.jewelryDrainPerHour = 1; s.growthPerDrainPoint = 0.0001; } },
];

// Biome curse chance modifiers — dangerous biomes have higher base curse chance
var BIOME_CURSE_CHANCE = {
  rift:            0.25,  // highest — Rift is corrupted space
  deep_cave:       0.18,
  undead_crypt:    0.20,
  shadow_realm:    0.22,
  cursed_swamp:    0.16,
  corrupted_forest:0.14,
  default:         0.04,  // normal biome / crafted without dangerous materials
  crafted:         0.03,  // craft base chance (low)
};

/**
 * Roll for an item curse. Higher luck = lower curse chance.
 * baseChance: override (or use BIOME_CURSE_CHANCE defaults)
 * luckBonus: subtracts from curse chance (luck protects against curses)
 */
function rollItemCurse(baseChance, luckBonus, itemSlotHint) {
  luckBonus = luckBonus || 0;
  // Luck reduces curse chance: each 0.10 luck reduces chance by 20%
  var curseMult = Math.max(0.1, 1 - luckBonus * 2);
  var finalChance = Math.min(baseChance * curseMult, 0.45);
  if (Math.random() >= finalChance) return null;

  // Higher luck also limits curse tier (luck >= 0.15 prevents tier 3 curses)
  var maxTier = 3;
  if (luckBonus >= 0.15) maxTier = 2;
  if (luckBonus >= 0.30) maxTier = 1;

  var candidates = [];
  var totalWeight = 0;
  for (var i = 0; i < ITEM_CURSE_POOL.length; i++) {
    var c = ITEM_CURSE_POOL[i];
    if (c.tier > maxTier) continue;
    if (itemSlotHint && c.slot && c.slot.indexOf(itemSlotHint) === -1) continue;
    candidates.push(c);
    totalWeight += c.weight;
  }
  if (candidates.length === 0) return null;

  var roll = Math.random() * totalWeight;
  var cum = 0;
  for (var j = 0; j < candidates.length; j++) {
    cum += candidates[j].weight;
    if (roll <= cum) return candidates[j];
  }
  return candidates[candidates.length - 1];
}

/**
 * Apply a curse to an item's stats. Tracks in item.curses[].
 * Curses can be removed by cleansing (set curse.cleansable = true by default).
 */
function applyItemCurse(item, curse) {
  if (!item || !curse) return;
  if (!item.stats) item.stats = {};
  if (!item.curses) item.curses = [];
  curse.apply(item.stats);
  item.curses.push({ id: curse.id, name: curse.name, tier: curse.tier, cleansable: true });
  // Append curse flavor to name
  item.name = item.name + ' [Cursed: ' + curse.name + ']';
  item.isCursed = true;
}

/**
 * Cleanse a specific curse from an item (requires purification scroll or alchemy).
 * Returns true if curse was found and removed.
 */
function cleanseItemCurse(item, curseId) {
  if (!item || !item.curses) return false;
  var idx = -1;
  for (var i = 0; i < item.curses.length; i++) {
    if (item.curses[i].id === curseId && item.curses[i].cleansable) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return false;
  item.curses.splice(idx, 1);
  if (item.curses.length === 0) {
    item.isCursed = false;
    // Strip curse flavor from name (simple prefix strip)
    item.name = item.name.replace(/ \[Cursed: [^\]]+\]/g, '');
  }
  return true;
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------

module.exports = {
  // Data tables
  WEAPON_AFFIXES: WEAPON_AFFIXES,
  ARMOR_AFFIXES: ARMOR_AFFIXES,
  JEWELRY_AFFIXES: JEWELRY_AFFIXES,
  MATERIAL_TIERS: MATERIAL_TIERS,
  NEW_RESOURCE_TYPES: NEW_RESOURCE_TYPES,
  QUALITY_TIERS: QUALITY_TIERS,
  RARITY_ORDER: RARITY_ORDER,
  AFFIX_CHANCES: AFFIX_CHANCES,
  SOCKET_CHANCES: SOCKET_CHANCES,
  MIN_QUALITY_BY_RARITY: MIN_QUALITY_BY_RARITY,
  ITEM_SETS: ITEM_SETS,
  ITEM_SET_LOOKUP: ITEM_SET_LOOKUP,
  UNIQUE_ITEMS: UNIQUE_ITEMS,
  GEM_TYPES: GEM_TYPES,
  AUGMENT_TYPES: AUGMENT_TYPES,
  INSCRIPTION_DEFS: INSCRIPTION_DEFS,
  WAND_PROPS: WAND_PROPS,
  WAND_SPELL_INTERACTIONS: WAND_SPELL_INTERACTIONS,
  RING_DESIGNS: RING_DESIGNS,
  RING_IMBUE_COSTS: RING_IMBUE_COSTS,
  WEAPON_SPECIALS: WEAPON_SPECIALS,
  NAMED_WEAPON_SPECIALS: NAMED_WEAPON_SPECIALS,
  DUAL_WIELD_SPECIALS: DUAL_WIELD_SPECIALS,
  EQUIPMENT_GACHA_RATES: EQUIPMENT_GACHA_RATES,
  EQUIPMENT_PITY: EQUIPMENT_PITY,

  // Functions
  generateItem: generateItem,
  generateItemId: generateItemId,
  rollQuality: rollQuality,
  rollAffix: rollAffix,
  rollSockets: rollSockets,
  rollItemRarity: rollItemRarity,
  rollDungeonLoot: rollDungeonLoot,
  getMaterialFromType: getMaterialFromType,
  getActiveSetBonuses: getActiveSetBonuses,
  getGemBonuses: getGemBonuses,
  getAugmentBonuses: getAugmentBonuses,
  socketGem: socketGem,
  applyAugment: applyAugment,
  imbueRing: imbueRing,
  getInscriptionData: getInscriptionData,
  getWeaponSpecial: getWeaponSpecial,
  composeName: composeName,
  // Consumable generation
  CONSUMABLE_QUALITY_TIERS: CONSUMABLE_QUALITY_TIERS,
  CONSUMABLE_AFFIXES: CONSUMABLE_AFFIXES,
  generateConsumable: generateConsumable,
  getConsumableCategory: getConsumableCategory,
  // Item mutation system
  ITEM_MUTATION_POOL: ITEM_MUTATION_POOL,
  rollItemMutation: rollItemMutation,
  applyItemMutation: applyItemMutation,
  spreadItemViralMutation: spreadItemViralMutation,
  // Curse system
  ITEM_CURSE_POOL: ITEM_CURSE_POOL,
  BIOME_CURSE_CHANCE: BIOME_CURSE_CHANCE,
  rollItemCurse: rollItemCurse,
  applyItemCurse: applyItemCurse,
  cleanseItemCurse: cleanseItemCurse,
  // Container generation
  CONTAINER_POOL: CONTAINER_POOL,
  generateContainerItem: generateContainerItem,
};
