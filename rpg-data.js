// rpg-data.js
// All RPG constants: races, stats, card templates, rarity tables, skill definitions, resource types.
// This is the data foundation for the comprehensive RPG system.

// World data — resource types, farming, animals, furniture, stations, biome
// resources, recipes, economy, icons, food, crafting perks, quests, weather
var worldData = require('./world-data');
var ALL_RESOURCE_TYPES = worldData.ALL_RESOURCE_TYPES;
var CROP_DEFINITIONS = worldData.CROP_DEFINITIONS;
var CROP_STAGES = worldData.CROP_STAGES;
var CROP_WITHER_MULTIPLIER = worldData.CROP_WITHER_MULTIPLIER;
var ANIMAL_DEFINITIONS = worldData.ANIMAL_DEFINITIONS;
var ANIMAL_HAPPINESS_MAX = worldData.ANIMAL_HAPPINESS_MAX;
var ANIMAL_HAPPINESS_MISS_PENALTY = worldData.ANIMAL_HAPPINESS_MISS_PENALTY;
var ANIMAL_HAPPINESS_HALF_THRESHOLD = worldData.ANIMAL_HAPPINESS_HALF_THRESHOLD;
var ANIMAL_HAPPINESS_STOP_THRESHOLD = worldData.ANIMAL_HAPPINESS_STOP_THRESHOLD;
var ANIMAL_MAX_PENDING_PRODUCTS = worldData.ANIMAL_MAX_PENDING_PRODUCTS;
var FURNITURE_EFFECTS = worldData.FURNITURE_EFFECTS;
var STATION_UPGRADE_TIERS = worldData.STATION_UPGRADE_TIERS;
var NEW_BIOME_RESOURCES = worldData.NEW_BIOME_RESOURCES;
var NEW_RECIPES = worldData.NEW_RECIPES;
var CARD_VENDOR_PRICES = worldData.CARD_VENDOR_PRICES;
var CARD_BUYBACK_RATE = worldData.CARD_BUYBACK_RATE;
var RARITY_BASE_VALUE = worldData.RARITY_BASE_VALUE;
var AUCTION_DURATION_MS = worldData.AUCTION_DURATION_MS;
var AUCTION_MIN_PRICE = worldData.AUCTION_MIN_PRICE;
var AUCTION_MAX_LISTINGS_PER_PLAYER = worldData.AUCTION_MAX_LISTINGS_PER_PLAYER;
var ICON_REGISTRY = worldData.ICON_REGISTRY;
var FOOD_EFFECTS = worldData.FOOD_EFFECTS;
var CRAFTING_SKILL_PERKS = worldData.CRAFTING_SKILL_PERKS;
var getCraftingSkillBonuses = worldData.getCraftingSkillBonuses;
var WORLD_QUEST_TEMPLATES = worldData.WORLD_QUEST_TEMPLATES;
var BIOME_WEATHER = worldData.BIOME_WEATHER;
var BIOME_WEATHER_EFFECTS = worldData.BIOME_WEATHER_EFFECTS;
var getWeatherForBiome = worldData.getWeatherForBiome;
var getBiomeWeatherEffect = worldData.getBiomeWeatherEffect;

// Race definitions, vision types, combat resources — extracted to races.js
var raceData = require('./races');
var RACES = raceData.RACES;
var RACIAL_INNATE_TRAITS = raceData.RACIAL_INNATE_TRAITS;
var RACIAL_VISION_TYPES = raceData.RACIAL_VISION_TYPES;
var COMBAT_RESOURCES = raceData.COMBAT_RESOURCES;
var RACE_PRIMARY_RESOURCE = raceData.RACE_PRIMARY_RESOURCE;
var PRIMARY_RESOURCE_BONUS = raceData.PRIMARY_RESOURCE_BONUS;
var SECONDARY_RESOURCE_SCALE = raceData.SECONDARY_RESOURCE_SCALE;
var VISION_TYPES = raceData.VISION_TYPES;
var getAvailableVisionTypes = raceData.getAvailableVisionTypes;
var visionPreventsAmbush = raceData.visionPreventsAmbush;
var getVisionCombatBonuses = raceData.getVisionCombatBonuses;
var canTradeCardToRace = raceData.canTradeCardToRace;
var ALL_LANGUAGES = raceData.ALL_LANGUAGES;
var RACE_LANGUAGES = raceData.RACE_LANGUAGES;
var RACE_IDS = raceData.RACE_IDS;

// Status effects, stat system, computeStats — extracted to combat-data.js
var combatData = require('./combat-data');
var STATUS_EFFECT_CATEGORIES = combatData.STATUS_EFFECT_CATEGORIES;
var getStatusEffectCategory = combatData.getStatusEffectCategory;
var STAT_NAMES = combatData.STAT_NAMES;
var STAT_KEYS = combatData.STAT_KEYS;
var BASE_STAT_VALUE = combatData.BASE_STAT_VALUE;
var FREE_POINTS_AT_CREATION = combatData.FREE_POINTS_AT_CREATION;
var STAT_POINTS_PER_LEVELS = combatData.STAT_POINTS_PER_LEVELS;
var getDefaultStats = combatData.getDefaultStats;
var applyRaceBumps = combatData.applyRaceBumps;
var computeStats = combatData.computeStats;

// ---------------------------------------------------------------------------
// Skills (extends existing mining, woodcutting)
// ---------------------------------------------------------------------------

const SKILL_DEFINITIONS = {
  mining: { name: 'Mining', icon: 'skills/Blacksmith/', category: 'gathering' },
  woodcutting: { name: 'Woodcutting', icon: 'skills/Blacksmith/', category: 'gathering' },
  farming: { name: 'Farming', icon: 'skills/Herbalism/', category: 'gathering' },
  fishing: { name: 'Fishing', icon: 'skills/Cooking_fishing/', category: 'gathering' },
  cooking: { name: 'Cooking', icon: 'skills/Cooking_fishing/', category: 'crafting' },
  glassworking: { name: 'Glassworking', icon: 'skills/Alchemy/', category: 'crafting' },
  crafting: { name: 'Crafting', icon: 'skills/Blacksmith/', category: 'crafting' },
  sewing: { name: 'Sewing', icon: 'skills/Blacksmith/', category: 'crafting' },
  cogworking: { name: 'Cogworking', icon: 'skills/Engineering/', category: 'crafting' },
  magic: { name: 'Magic', icon: 'skills/Enchantment/', category: 'combat' },
  magic_elemental: { name: 'Elemental Magic', icon: 'skills/Enchantment/', category: 'combat' },
  magic_arcane: { name: 'Arcane Magic', icon: 'skills/Enchantment/', category: 'combat' },
  magic_divine: { name: 'Divine Magic', icon: 'skills/Enchantment/', category: 'combat' },
  magic_shadow: { name: 'Shadow Magic', icon: 'skills/Enchantment/', category: 'combat' },
  melee: { name: 'Melee', icon: 'skills/Skill_SwordAttack.PNG', category: 'combat' },
  melee_blade: { name: 'Blade', icon: 'skills/Skill_SwordAttack.PNG', category: 'combat' },
  melee_blunt: { name: 'Blunt', icon: 'skills/Skill_SwordAttack.PNG', category: 'combat' },
  melee_martial: { name: 'Martial Arts', icon: 'skills/Skill_SwordAttack.PNG', category: 'combat' },
  archery: { name: 'Archery', icon: 'skills/Skill_SwordAttack.PNG', category: 'combat' },
  lockpicking: { name: 'Lockpicking', icon: 'skills/Enchantment/', category: 'rogue' },
  thievery: { name: 'Thievery', icon: 'skills/Enchantment/', category: 'rogue' },
  coercion: { name: 'Coercion', icon: 'skills/Enchantment/', category: 'social' },
  deception: { name: 'Deception', icon: 'skills/Enchantment/', category: 'social' },
  // Dungeon exploration skill (merged dwelling + delving)
  dungeon_exploration: { name: 'Dungeon Exploration', icon: 'skills/Enchantment/', category: 'exploration' },
  ritual_magic: { name: 'Ritual Magic', icon: 'skills/Enchantment/', category: 'combat', raceLocked: 'lizardfolk' },
  ritual_water: { name: 'Water Rituals', icon: 'skills/Enchantment/', category: 'combat', raceLocked: 'lizardfolk' },
  ritual_blood: { name: 'Blood Rituals', icon: 'skills/Enchantment/', category: 'combat', raceLocked: 'lizardfolk' },
  // Death/Life magic tree
  necromancy: { name: 'Necromancy', icon: 'skills/Enchantment/', category: 'combat' },
  life_magic: { name: 'Life Magic', icon: 'skills/Skill_Heal.PNG', category: 'combat' },
  // Crafting expansions
  alchemy: { name: 'Alchemy', icon: 'skills/Alchemy/', category: 'crafting' },
  enchanting: { name: 'Enchanting', icon: 'skills/Enchantment/', category: 'crafting' },
  leatherworking: { name: 'Leatherworking', icon: 'skills/Blacksmith/', category: 'crafting' },
  brewing: { name: 'Brewing', icon: 'skills/Cooking_fishing/', category: 'crafting' },
  carpentry: { name: 'Carpentry', icon: 'skills/Blacksmith/', category: 'crafting' },
  jewelcrafting: { name: 'Jewelcrafting', icon: 'skills/Blacksmith/', category: 'crafting' },
  // Gathering expansions (skinning + foraging + herbalism merged)
  harvesting: { name: 'Harvesting', icon: 'skills/Herbalism/', category: 'gathering' },
  // Unique/interesting PG-inspired
  animal_handling: { name: 'Animal Handling', icon: 'skills/Herbalism/', category: 'combat' },
  psychology: { name: 'Psychology & Bardic', icon: 'skills/Enchantment/', category: 'combat' },
  weather_magic: { name: 'Weather Magic', icon: 'skills/Enchantment/', category: 'combat' },
  transmutation: { name: 'Transmutation', icon: 'skills/Alchemy/', category: 'crafting' },
  sigil_scripting: { name: 'Sigil Scripting', icon: 'skills/Enchantment/', category: 'crafting' },
  survival: { name: 'Survival', icon: 'skills/Blacksmith/', category: 'exploration' },
  gourmand: { name: 'Gourmand', icon: 'skills/Cooking_fishing/', category: 'social' },
  anatomy: { name: 'Anatomy', icon: 'skills/Herbalism/', category: 'exploration' },
  animal_taming: { name: 'Animal Taming', icon: 'skills/Herbalism/', category: 'exploration' },
};

function getDefaultSkills() {
  var skills = {};
  for (var key in SKILL_DEFINITIONS) {
    if (!SKILL_DEFINITIONS[key].raceLocked) {
      skills[key] = { level: 1, xp: 0 };
    }
  }
  return skills;
}

function getSkillsForRace(raceId) {
  var skills = getDefaultSkills();
  for (var key in SKILL_DEFINITIONS) {
    if (SKILL_DEFINITIONS[key].raceLocked === raceId) {
      skills[key] = { level: 1, xp: 0 };
    }
  }
  return skills;
}

// Card pools — rarity, templates, gacha, mutations, curses, affixes, combos,
// rift scars, evolution config, and fusion logic — extracted to card-pools.js
var cardPools = require('./card-pools');
var RARITY_TIERS = cardPools.RARITY_TIERS;
var RARITY_BY_ID = cardPools.RARITY_BY_ID;
var TOTAL_RARITY_WEIGHT = cardPools.TOTAL_RARITY_WEIGHT;
var RARITY_SCALE = cardPools.RARITY_SCALE;
var SOFT_PITY_START = cardPools.SOFT_PITY_START;
var HARD_PITY = cardPools.HARD_PITY;
var SOFT_PITY_RATE = cardPools.SOFT_PITY_RATE;
var rollRarity = cardPools.rollRarity;
var CARD_TYPES = cardPools.CARD_TYPES;
var CARD_TEMPLATES = cardPools.CARD_TEMPLATES;
var CARDS_BY_RARITY = cardPools.CARDS_BY_RARITY;
var CARD_BY_ID = cardPools.CARD_BY_ID;
var CARD_STYLES = cardPools.CARD_STYLES;
var generateSerial = cardPools.generateSerial;
var rollCardStyle = cardPools.rollCardStyle;
var SKILL_BIOME_BONUS = cardPools.SKILL_BIOME_BONUS;
var WATER_MOUNTS = cardPools.WATER_MOUNTS;
var RACE_POOL_BIAS = cardPools.RACE_POOL_BIAS;
var CATFOLK_RARITY_BUMP = cardPools.CATFOLK_RARITY_BUMP;
var computeEffectiveGachaRates = cardPools.computeEffectiveGachaRates;
var RIFT_SCAR_PREFIXES = cardPools.RIFT_SCAR_PREFIXES;
var RIFT_SCAR_SUFFIXES = cardPools.RIFT_SCAR_SUFFIXES;
var getRiftScarCount = cardPools.getRiftScarCount;
var rollRiftScarPrefix = cardPools.rollRiftScarPrefix;
var rollRiftScarSuffix = cardPools.rollRiftScarSuffix;
var applyRiftScars = cardPools.applyRiftScars;
var EVOLUTION_CONFIG = cardPools.EVOLUTION_CONFIG;
var CARDS_PER_PACK_MIN = cardPools.CARDS_PER_PACK_MIN;
var CARDS_PER_PACK_MAX = cardPools.CARDS_PER_PACK_MAX;
var MAX_ACTIVE_CARD_SLOTS = cardPools.MAX_ACTIVE_CARD_SLOTS;
var MAX_PASSIVE_CARD_SLOTS = cardPools.MAX_PASSIVE_CARD_SLOTS;
var MAX_EQUIPPED_CARDS = cardPools.MAX_EQUIPPED_CARDS;
var MAX_CARD_COLLECTION = cardPools.MAX_CARD_COLLECTION;
var MAX_FUSION_COUNT = cardPools.MAX_FUSION_COUNT;
var generateCardInstance = cardPools.generateCardInstance;
var openCardPack = cardPools.openCardPack;
var MUTATION_POOL = cardPools.MUTATION_POOL;
var MUTATION_TIER_NAMES = cardPools.MUTATION_TIER_NAMES;
var rollMutation = cardPools.rollMutation;
var applyMutation = cardPools.applyMutation;
var CARD_CURSE_POOL = cardPools.CARD_CURSE_POOL;
var rollCardCurse = cardPools.rollCardCurse;
var applyCurse = cardPools.applyCurse;
var cleanseCardCurse = cardPools.cleanseCardCurse;
var AFFIX_POOL = cardPools.AFFIX_POOL;
var AFFIX_COUNT_BY_RARITY = cardPools.AFFIX_COUNT_BY_RARITY;
var PASSIVE_RIDER_CHANCE = cardPools.PASSIVE_RIDER_CHANCE;
var rollCardAffixes = cardPools.rollCardAffixes;
var rollPassiveRider = cardPools.rollPassiveRider;
var getAffixNamePrefix = cardPools.getAffixNamePrefix;
var getAffixNameSuffix = cardPools.getAffixNameSuffix;
var COMBO_POOL = cardPools.COMBO_POOL;
var computeCardCombos = cardPools.computeCardCombos;
var refreshCardEffects = cardPools.refreshCardEffects;
var addAffixToCard = cardPools.addAffixToCard;
var rollItemAffixes = cardPools.rollItemAffixes;
var rollEvoAffix = cardPools.rollEvoAffix;
var canFuseCards = cardPools.canFuseCards;
var fuseCards = cardPools.fuseCards;

// ---------------------------------------------------------------------------
// Awakenings — Transformative milestone abilities at level 25 and 50
// Lore: Prolonged exposure to Rift energy awakens latent potential.
// Requires 40+ in a specific stat to qualify. Choices are mutually exclusive per tier.
// ---------------------------------------------------------------------------

const AWAKENINGS = {
  tier1: {
    level: 25,
    statThreshold: 40,
    choices: [
      {
        id: 'rift_surge',
        name: 'Rift Surge',
        requiredStat: 'acumen',
        description: 'Channel raw Rift energy through your spells. Spell damage +30%, but mana costs increase by 15%.',
        effects: [
          { type: 'spell_damage_mult', value: 0.30 },
          { type: 'mana_cost_mult', value: 0.15 },
        ],
        icon: 'skills/Enchantment/',
        lore: 'The Rift whispers through your incantations, each spell crackling with unstable power.',
      },
      {
        id: 'iron_constitution',
        name: 'Iron Constitution',
        requiredStat: 'vigor',
        description: 'Your body hardens from countless battles. Max HP +25%, regenerate 2% HP per turn.',
        effects: [
          { type: 'hp_mult', value: 0.25 },
          { type: 'hp_regen_percent', value: 0.02 },
        ],
        icon: 'skills/Blacksmith/',
        lore: 'Scar tissue layered upon scar tissue — you have become nearly indestructible.',
      },
      {
        id: 'killers_instinct',
        name: "Killer's Instinct",
        requiredStat: 'finesse',
        description: 'Your strikes find vital points with preternatural accuracy. Crit chance +15%, crit damage +50%.',
        effects: [
          { type: 'crit_chance_bonus', value: 0.15 },
          { type: 'crit_damage_mult', value: 0.50 },
        ],
        icon: 'skills/Enchantment/',
        lore: 'Every movement leaves an opening. You see them all now.',
      },
    ],
  },
  tier2: {
    level: 50,
    statThreshold: 40,
    choices: [
      {
        id: 'rift_conduit',
        name: 'Rift Conduit',
        requiredStat: 'acumen',
        description: 'Become a living conduit for Rift energy. All ability cooldowns -25%, resource costs -20%.',
        effects: [
          { type: 'cooldown_reduction', value: 0.25 },
          { type: 'resource_cost_reduction', value: 0.20 },
        ],
        icon: 'skills/Enchantment/',
        lore: 'The boundary between you and the Rift has dissolved. Energy flows through you like a river.',
      },
      {
        id: 'undying_bastion',
        name: 'Undying Bastion',
        requiredStat: 'vigor',
        description: 'Once per combat, survive a killing blow with 1 HP and gain 50% damage reduction for 3 turns.',
        effects: [
          { type: 'cheat_death', uses: 1 },
          { type: 'on_cheat_death_dr', value: 0.50, duration: 3 },
        ],
        icon: 'skills/Blacksmith/',
        lore: 'Death reached for you, but you simply refused.',
      },
      {
        id: 'shadow_sovereign',
        name: 'Shadow Sovereign',
        requiredStat: 'finesse',
        description: 'Gain permanent stealth in dim light. First attack from stealth deals 100% bonus damage.',
        effects: [
          { type: 'dim_light_stealth', value: true },
          { type: 'stealth_break_damage_mult', value: 1.00 },
        ],
        icon: 'skills/Enchantment/',
        lore: 'You do not walk in shadow — shadow walks with you.',
      },
    ],
  },
};

/**
 * Get available Awakening choices for a player at their current level and stats.
 * @param {number} level - Player level
 * @param {object} rpgStats - Player RPG stats object (vigor, might, finesse, acumen, etc.)
 * @param {Array} existingAwakenings - Array of already-chosen awakening IDs
 * @returns {Array} Array of available awakening choices (empty if none qualify)
 */
function getAvailableAwakenings(level, rpgStats, existingAwakenings) {
  var available = [];
  var chosen = existingAwakenings || [];

  var tiers = [AWAKENINGS.tier1, AWAKENINGS.tier2];
  for (var ti = 0; ti < tiers.length; ti++) {
    var tier = tiers[ti];
    if (level < tier.level) continue;

    // Check if player already chose from this tier
    var alreadyChosen = false;
    for (var ci = 0; ci < tier.choices.length; ci++) {
      if (chosen.indexOf(tier.choices[ci].id) !== -1) {
        alreadyChosen = true;
        break;
      }
    }
    if (alreadyChosen) continue;

    // Filter choices by stat threshold
    for (var cj = 0; cj < tier.choices.length; cj++) {
      var choice = tier.choices[cj];
      var statValue = (rpgStats && rpgStats[choice.requiredStat]) ? rpgStats[choice.requiredStat] : 0;
      if (statValue >= tier.statThreshold) {
        available.push({
          tier: ti + 1,
          id: choice.id,
          name: choice.name,
          requiredStat: choice.requiredStat,
          requiredValue: tier.statThreshold,
          currentValue: statValue,
          description: choice.description,
          lore: choice.lore,
          icon: choice.icon,
        });
      }
    }
  }

  return available;
}
// ---------------------------------------------------------------------------
// Overall Level XP
// ---------------------------------------------------------------------------

const MAX_OVERALL_LEVEL = Infinity;
const XP_SPILLOVER_RATE = 0.10; // 10% of skill XP spills to overall

function overallXpForLevel(n) {
  return Math.floor(200 * Math.pow(n, 1.6));
}

// Active card slot unlocks: levels 1, 10, 20, 30
function getActiveCardSlotCount(level) {
  if (level >= 30) return 4;
  if (level >= 20) return 3;
  if (level >= 10) return 2;
  return 1;
}

// Passive card slot unlocks: levels 5, 15, 25
function getPassiveCardSlotCount(level) {
  if (level >= 25) return 3;
  if (level >= 15) return 2;
  if (level >= 5) return 1;
  return 0;
}

// Total card slots (backward compat)
function getCardSlotCount(level) {
  return getActiveCardSlotCount(level) + getPassiveCardSlotCount(level);
}

// Check if a card type belongs in an active slot
function isActiveCardType(type) {
  return type === 'active_ability';
}

// Stat points: 1 every 3 levels (starting at level 3)
function getStatPointsForLevel(level) {
  return Math.floor(level / STAT_POINTS_PER_LEVELS);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// Compute combat speed for turn-based initiative (CT system)
// Base from race, modified by finesse stat and equipped card effects
function computeCombatSpeed(raceId, finesse, equippedCards) {
  var race = raceId ? RACES[raceId] : null;
  var base = (race && race.baseSpeed) ? race.baseSpeed : 10;
  // Finesse adds 0.5 speed per point above base (5)
  var finesseBonus = Math.max(0, ((finesse || 5) - 5) * 0.5);
  var cardBonus = 0;
  if (equippedCards && Array.isArray(equippedCards)) {
    for (var i = 0; i < equippedCards.length; i++) {
      var card = equippedCards[i];
      if (!card || !card.effects) continue;
      for (var j = 0; j < card.effects.length; j++) {
        var eff = card.effects[j];
        if (eff.type === 'speed_bonus') cardBonus += (eff.value || 0);
      }
    }
  }
  return Math.max(1, Math.floor((base + finesseBonus + cardBonus) * 10) / 10);
}

// ---------------------------------------------------------------------------
// Elemental Weakness/Resistance Table (Fix 2)
// ---------------------------------------------------------------------------

var ELEMENTAL_TABLE = {
  fire:      { weak: ['ice', 'wind'],       resist: ['fire'],                absorb: [] },
  ice:       { weak: ['fire', 'lightning'],  resist: ['ice'],                absorb: [] },
  lightning: { weak: ['earth'],              resist: ['lightning', 'wind'],   absorb: [] },
  earth:     { weak: ['wind', 'ice'],        resist: ['earth', 'lightning'], absorb: [] },
  holy:      { weak: ['dark'],               resist: ['holy'],               absorb: [] },
  dark:      { weak: ['holy'],               resist: ['dark'],               absorb: [] },
  poison:    { weak: ['holy', 'fire'],       resist: ['poison', 'dark'],     absorb: [] },
  wind:      { weak: ['lightning', 'earth'], resist: ['wind'],               absorb: [] },
  arcane:    { weak: [],                     resist: [],                      absorb: [] },
};

function getElementalMultiplier(attackElement, defenderElement) {
  if (!attackElement || !defenderElement) return 1.0;
  // Look up defender's elemental properties
  var defEntry = ELEMENTAL_TABLE[defenderElement];
  if (!defEntry) return 1.0;
  // Defender absorbs this element: negative damage (heals)
  if (defEntry.absorb.indexOf(attackElement) >= 0) return -0.5;
  // Defender is weak to this element: super effective
  if (defEntry.weak.indexOf(attackElement) >= 0) return 1.5;
  // Defender resists this element: reduced damage
  if (defEntry.resist.indexOf(attackElement) >= 0) return 0.7;
  return 1.0;
}

// ---------------------------------------------------------------------------
// Weapon Damage Types & Armor Physical Resistance (Fix 3)
// ---------------------------------------------------------------------------

var WEAPON_DAMAGE_TYPES = {
  // Category-based keys (matching accounts.js WEAPON_TYPES categories)
  melee_blade: 'slash', melee_blunt: 'blunt', archery: 'pierce', magic: 'blunt',
  // Individual weapon name keys (fallback for fine-grained lookup)
  sword: 'slash', dagger: 'pierce', axe: 'slash', mace: 'blunt',
  spear: 'pierce', staff: 'blunt', bow: 'pierce', crossbow: 'pierce',
  hammer: 'blunt', fist: 'blunt', whip: 'slash', thrown: 'pierce',
};

var ARMOR_PHYS_RESIST = {
  plate:   { slash: 0.8, pierce: 0.6, blunt: 0.4 },
  chain:   { slash: 0.7, pierce: 0.5, blunt: 0.6 },
  leather: { slash: 0.5, pierce: 0.4, blunt: 0.7 },
  cloth:   { slash: 0.3, pierce: 0.3, blunt: 0.3 },
  none:    { slash: 0, pierce: 0, blunt: 0 },
};

// ---------------------------------------------------------------------------
// Full Damage Type System (Task 2 — larger than OSRS combat triangle)
// ---------------------------------------------------------------------------

var DAMAGE_TYPES = {
  // Physical subtypes
  slashing:  { id: 'slashing',  name: 'Slashing',  category: 'physical' },
  piercing:  { id: 'piercing',  name: 'Piercing',  category: 'physical' },
  blunt:     { id: 'blunt',     name: 'Blunt',     category: 'physical' },
  ranged:    { id: 'ranged',    name: 'Ranged',    category: 'physical' },
  // Elemental
  fire:      { id: 'fire',      name: 'Fire',      category: 'elemental' },
  ice:       { id: 'ice',       name: 'Ice',       category: 'elemental' },
  lightning: { id: 'lightning', name: 'Lightning', category: 'elemental' },
  earth:     { id: 'earth',     name: 'Earth',     category: 'elemental' },
  wind:      { id: 'wind',      name: 'Wind',      category: 'elemental' },
  water:     { id: 'water',     name: 'Water',     category: 'elemental' },
  // Magical
  arcane:    { id: 'arcane',    name: 'Arcane',    category: 'magical' },
  holy:      { id: 'holy',      name: 'Holy',      category: 'magical' },
  shadow:    { id: 'shadow',    name: 'Shadow',    category: 'magical' },
  nature:    { id: 'nature',    name: 'Nature',    category: 'magical' },
  poison:    { id: 'poison',    name: 'Poison',    category: 'magical' },
  // Special
  true:      { id: 'true',      name: 'True',      category: 'special' },
};

// Effectiveness multiplier matrix.
// Key = attacking damage type, value = { targetType: multiplier }.
// Only non-1.0 entries are stored. 1.0 (neutral) is the default.
// 1.5 = strong against, 0.5 = weak against.
var DAMAGE_TYPE_EFFECTIVENESS = {
  // Physical interactions
  slashing:  { nature: 1.5, lightning: 0.5, chain: 1.5 },
  piercing:  { wind: 1.5, earth: 0.5, plate: 1.5 },
  blunt:     { earth: 1.5, fire: 0.5, ice: 1.5 },
  ranged:    { fire: 1.5, wind: 0.5, lightning: 1.5 },

  // Elemental cycle: fire > ice > wind > earth > lightning > water > fire
  fire:      { ice: 1.5, water: 0.5, nature: 1.5 },
  ice:       { wind: 1.5, fire: 0.5, water: 1.5 },
  wind:      { earth: 1.5, ice: 0.5, ranged: 1.5 },
  earth:     { lightning: 1.5, wind: 0.5, blunt: 1.5 },
  lightning: { water: 1.5, earth: 0.5, piercing: 1.5 },
  water:     { fire: 1.5, lightning: 0.5, earth: 1.5 },

  // Holy <> Shadow mutual weakness
  holy:      { shadow: 1.5, holy: 0.5 },
  shadow:    { holy: 1.5, shadow: 0.5 },

  // Arcane is neutral to everything (no entries = all 1.0)
  arcane:    {},

  // Nature and Poison
  nature:    { water: 1.5, fire: 0.5, earth: 1.5 },
  poison:    { nature: 1.5, holy: 0.5, earth: 0.5 },

  // True damage ignores all — handled specially in calculateDamageMultiplier
  true:      {},
};

// Armor material resistance types.
// Each material has resistances (>1.0 = takes more damage) and strengths (<1.0 = takes less).
// Values represent the damage multiplier applied when this armor type is hit by the given damage type.
var ARMOR_RESISTANCE_TYPES = {
  cloth:      { resist: { arcane: 0.7 },     weak: { slashing: 1.5 } },
  leather:    { resist: { nature: 0.7 },      weak: { fire: 1.5 } },
  chain:      { resist: { slashing: 0.7 },    weak: { blunt: 1.5 } },
  plate:      { resist: { piercing: 0.7 },     weak: { lightning: 1.5 } },
  enchanted:  { resist: { shadow: 0.7 },       weak: { holy: 1.5 } },
  mithril:    { resist: { slashing: 0.9, piercing: 0.9, blunt: 0.9, ranged: 0.9 }, weak: { arcane: 1.5 } },
  none:       { resist: {}, weak: {} },
};

// Map weapon ability damage types by weapon family.
// Each family has a default and per-ability overrides.
var WEAPON_ABILITY_DAMAGE_TYPES = {
  sword:   { default: 'slashing',  overrides: { execute: 'slashing' } },
  axe:     { default: 'slashing',  overrides: { decapitate: 'slashing' } },
  bow:     { default: 'ranged',    overrides: { quick_shot: 'piercing', power_shot: 'piercing', snipe: 'piercing', rain_of_arrows: 'ranged', evasive_roll: null } },
  staff:   { default: 'arcane',    overrides: { magic_bolt: 'arcane', fireball_ab: 'fire', ice_wall_ab: 'ice', meteor_ab: 'fire', mana_shield_ab: null } },
  wand:    { default: 'arcane',    overrides: { spark: 'lightning', chain_lightning_ab: 'lightning', hex: 'shadow', arcane_barrage: 'arcane', barrier: null } },
  dagger:  { default: 'piercing',  overrides: { poison_blade_ab: 'poison', smoke_bomb_ab: null } },
  mace:    { default: 'blunt',     overrides: { smite: 'holy', holy_light_ab: 'holy', judgement: 'holy' } },
  spear:   { default: 'piercing',  overrides: { javelin_throw: 'piercing', phalanx: null } },
  hammer:  { default: 'blunt',     overrides: { ground_pound: 'earth', earthquake: 'earth', shatter: 'blunt' } },
  unarmed: { default: 'blunt',     overrides: { dragon_fist: 'blunt' } },
};

// Get the damage type for a specific weapon ability.
// Returns a string from DAMAGE_TYPES, or null for non-damaging abilities.
function getAbilityDamageType(abilityId, weaponFamily) {
  var familyEntry = WEAPON_ABILITY_DAMAGE_TYPES[weaponFamily];
  if (!familyEntry) return 'blunt'; // fallback for unknown weapons
  if (familyEntry.overrides && familyEntry.overrides.hasOwnProperty(abilityId)) {
    return familyEntry.overrides[abilityId]; // may be null for defensive/utility
  }
  return familyEntry.default;
}

// Calculate the damage multiplier given an attacking damage type and the target's resistances.
// targetResistances: { damageType: string|null (from DAMAGE_TYPE_EFFECTIVENESS lookup),
//                      armorType: string|null (from ARMOR_RESISTANCE_TYPES lookup),
//                      elementalType: string|null (creature element for ELEMENTAL_TABLE),
//                      resistances: { element: mult } | null (per-element damage reduction),
//                      weaknesses:  { element: mult } | null (per-element damage increase) }
// Returns a multiplier >= 0.25 (floor to prevent near-zero damage).
function calculateDamageMultiplier(damageType, targetResistances) {
  if (!damageType) return 1.0;

  // True damage ignores all resistances
  if (damageType === 'true') return 1.0;

  var multiplier = 1.0;
  var res = targetResistances || {};

  // 1. Check DAMAGE_TYPE_EFFECTIVENESS matrix
  var effEntry = DAMAGE_TYPE_EFFECTIVENESS[damageType];
  if (effEntry) {
    // Check against target's elemental type (e.g., a fire monster)
    if (res.elementalType && effEntry[res.elementalType]) {
      multiplier *= effEntry[res.elementalType];
    }
    // Check against target's damage type alignment (e.g., creature with slashing attacks = slashing alignment)
    if (res.damageAlignment && effEntry[res.damageAlignment]) {
      multiplier *= effEntry[res.damageAlignment];
    }
  }

  // 2. Check armor material resistance
  if (res.armorType) {
    var armorEntry = ARMOR_RESISTANCE_TYPES[res.armorType];
    if (armorEntry) {
      // Armor resists (reduces damage)
      if (armorEntry.resist && armorEntry.resist[damageType]) {
        multiplier *= armorEntry.resist[damageType];
      }
      // Armor weaknesses (increases damage)
      if (armorEntry.weak && armorEntry.weak[damageType]) {
        multiplier *= armorEntry.weak[damageType];
      }
    }
  }

  // 3. Check per-element resistances map (from dungeon enemy templates)
  // resistances: { fire: 0.5 } means takes 50% fire damage (multiplier applied directly)
  if (res.resistances && res.resistances[damageType] != null) {
    multiplier *= res.resistances[damageType];
  }

  // 4. Check per-element weaknesses map (from dungeon enemy templates)
  // weaknesses: { ice: 1.5 } means takes 150% ice damage (multiplier applied directly)
  if (res.weaknesses && res.weaknesses[damageType] != null) {
    multiplier *= res.weaknesses[damageType];
  }

  // Floor at 0.25 to prevent near-zero damage, cap at 3.0 to prevent one-shots
  return Math.max(0.25, Math.min(3.0, multiplier));
}

// Convenience: build target resistance object from a monster definition.
// Returns the standard resistance object used by calculateDamageMultiplier,
// plus optional per-element resistances/weaknesses maps from dungeon-data.
function getMonsterResistances(monster) {
  if (!monster) return { elementalType: null, armorType: 'none', damageAlignment: null, resistances: null, weaknesses: null, damageType: null };
  return {
    elementalType:   monster.element        || null,
    armorType:       monster.armorType      || 'none',
    damageAlignment: monster.damageAlignment || null,
    resistances:     monster.resistances    || null,
    weaknesses:      monster.weaknesses     || null,
    damageType:      monster.damageType     || null,
  };
}

// Card active ability cooldowns by rarity (default cooldowns in seconds)
var CARD_ABILITY_COOLDOWNS = {
  common: 5,
  uncommon: 8,
  rare: 12,
  ultra_rare: 15,
  mythic_rare: 20,
  legendary: 25,
  godly: 30,
  relic: 30,
};

// Get effective cooldown for a card ability, applying card modifier reductions
function getCardAbilityCooldown(cardTemplate, cardMods) {
  if (!cardTemplate) return 0;
  // Use card-specific cooldown if defined, else use rarity-based default
  var baseCd = cardTemplate.cooldown || CARD_ABILITY_COOLDOWNS[cardTemplate.rarity] || 12;
  // Apply global cooldown reduction from ability modifier cards
  var reduction = cardMods ? (cardMods.globalCooldownReduction || 0) : 0;
  reduction = Math.min(reduction, 0.50);
  return Math.max(1, Math.round(baseCd * (1 - reduction)));
}

// Get effective mana cost for a card ability, applying card modifier reductions
function getCardAbilityManaCost(cardTemplate, cardMods) {
  if (!cardTemplate) return 0;
  var cost = cardTemplate.manaCost || 0;
  if (cost <= 0) return 0;
  var reduction = cardMods ? (cardMods.manaReduction || 0) : 0;
  reduction = Math.min(reduction, 0.50);
  return Math.max(1, Math.round(cost * (1 - reduction)));
}

// ---------------------------------------------------------------------------
// Skill Level Combat Bonuses (Fix 4)
// ---------------------------------------------------------------------------

function getCombatSkillBonuses(skills, weaponCategory) {
  skills = skills || {};
  var cat = weaponCategory || '';
  var primary = 'melee';
  // Match actual weapon categories from accounts.js WEAPON_TYPES
  if (cat === 'archery' || cat === 'bow' || cat === 'crossbow' || cat === 'thrown') primary = 'archery';
  else if (cat === 'magic' || cat === 'staff' || cat === 'wand') primary = 'magic';
  // melee_blade, melee_blunt, and anything else defaults to 'melee'
  var level = (skills[primary] && skills[primary].level) || 1;
  return {
    damageBonus: level * 0.01,                       // +1% per level
    critBonus: Math.floor(level / 5) * 0.003,        // +0.3% per 5 levels
    accuracyBonus: level * 0.005,                     // +0.5% per level
  };
}

// ---------------------------------------------------------------------------
// Weapon Abilities -- FFXIV/WoW-style cooldown abilities per weapon family
// ---------------------------------------------------------------------------

function getWeaponFamily(itemType) {
  if (!itemType || typeof itemType !== 'string') return 'unarmed';
  var t = itemType.toLowerCase();
  if (t.indexOf('crossbow') >= 0) return 'bow';
  if (t.indexOf('scythe') >= 0) return 'axe';
  if (t.indexOf('sword') >= 0) return 'sword';
  if (t.indexOf('axe_weapon') >= 0 || t.indexOf('battle_axe') >= 0 || t.indexOf('battleaxe') >= 0) return 'axe';
  if (t.indexOf('bow') >= 0) return 'bow';
  if (t.indexOf('dagger') >= 0) return 'dagger';
  if (t.indexOf('hammer') >= 0) return 'hammer';
  if (t.indexOf('mace') >= 0) return 'mace';
  if (t.indexOf('spear') >= 0) return 'spear';
  if (t.indexOf('staff') >= 0) return 'staff';
  if (t.indexOf('wand') >= 0) return 'wand';
  if (t.indexOf('axe') >= 0) return 'axe';
  return 'unarmed';
}

function getWeaponFamilyFromCategory(category, itemType) {
  if (itemType) return getWeaponFamily(itemType);
  if (!category) return 'unarmed';
  if (category === 'archery') return 'bow';
  if (category === 'magic') return 'staff';
  if (category === 'melee_blunt') return 'mace';
  if (category === 'melee_blade') return 'sword';
  return 'unarmed';
}

var WEAPON_ABILITIES = {
  sword: [
    { id: 'slash', name: 'Slash', cooldown: 0, damage: 1.0, type: 'physical', damageType: 'slashing', description: 'Basic sword attack', manaCost: 0 },
    { id: 'power_strike', name: 'Power Strike', cooldown: 8, damage: 2.5, type: 'physical', damageType: 'slashing', description: 'A powerful overhead strike', manaCost: 5 },
    { id: 'whirlwind_ab', name: 'Whirlwind', cooldown: 15, damage: 1.5, type: 'physical', damageType: 'slashing', aoe: true, description: 'Spin attack hitting all nearby enemies', manaCost: 10 },
    { id: 'parry', name: 'Parry', cooldown: 12, damage: 0, type: 'defensive', effect: 'block_next', duration: 3, description: 'Block the next incoming attack', manaCost: 5 },
    { id: 'execute', name: 'Execute', cooldown: 20, damage: 4.0, type: 'physical', damageType: 'slashing', condition: 'target_below_30hp', description: 'Massive damage to low HP targets', manaCost: 15 },
  ],
  axe: [
    { id: 'chop', name: 'Chop', cooldown: 0, damage: 1.1, type: 'physical', damageType: 'slashing', description: 'Basic axe chop', manaCost: 0 },
    { id: 'cleave', name: 'Cleave', cooldown: 8, damage: 1.8, type: 'physical', damageType: 'slashing', aoe: true, description: 'Wide cleaving strike hitting multiple foes', manaCost: 5 },
    { id: 'rend', name: 'Rend', cooldown: 10, damage: 1.2, type: 'physical', damageType: 'slashing', dot: { tickDamage: 0.3, duration: 4, name: 'bleeding' }, description: 'Inflict a bleeding wound over time', manaCost: 8 },
    { id: 'enrage', name: 'Enrage', cooldown: 20, damage: 0, type: 'buff', effect: 'enrage', duration: 8, buffMultiplier: 1.4, description: 'Enter a rage, boosting damage by 40%', manaCost: 10 },
    { id: 'decapitate', name: 'Decapitate', cooldown: 25, damage: 5.0, type: 'physical', damageType: 'slashing', condition: 'target_below_20hp', description: 'Devastating finishing blow to weakened foes', manaCost: 20 },
  ],
  bow: [
    { id: 'quick_shot', name: 'Quick Shot', cooldown: 0, damage: 0.9, type: 'physical', damageType: 'piercing', description: 'Rapid arrow shot', manaCost: 0 },
    { id: 'power_shot', name: 'Power Shot', cooldown: 8, damage: 2.2, type: 'physical', damageType: 'piercing', description: 'Fully drawn powerful shot', manaCost: 5 },
    { id: 'rain_of_arrows', name: 'Rain of Arrows', cooldown: 18, damage: 1.3, type: 'physical', damageType: 'ranged', aoe: true, description: 'Rain arrows on an area hitting all enemies', manaCost: 15 },
    { id: 'evasive_roll', name: 'Evasive Roll', cooldown: 12, damage: 0, type: 'defensive', effect: 'dodge_buff', duration: 3, dodgeBonus: 0.30, description: 'Roll away greatly increasing dodge for 3s', manaCost: 5 },
    { id: 'snipe', name: 'Snipe', cooldown: 22, damage: 4.5, type: 'physical', damageType: 'piercing', critBonus: 0.25, description: 'Carefully aimed shot with high crit chance', manaCost: 15 },
  ],
  staff: [
    { id: 'magic_bolt', name: 'Magic Bolt', cooldown: 0, damage: 1.0, type: 'magic', element: 'arcane', damageType: 'arcane', description: 'Basic magical bolt', manaCost: 3 },
    { id: 'fireball_ab', name: 'Fireball', cooldown: 10, damage: 2.5, type: 'magic', element: 'fire', damageType: 'fire', aoe: true, description: 'Hurl a ball of fire at enemies', manaCost: 15 },
    { id: 'ice_wall_ab', name: 'Ice Wall', cooldown: 15, damage: 0.8, type: 'magic', element: 'ice', damageType: 'ice', effect: 'slow', slowAmount: 0.5, duration: 4, description: 'Create an ice barrier that slows enemies', manaCost: 12 },
    { id: 'mana_shield_ab', name: 'Mana Shield', cooldown: 20, damage: 0, type: 'defensive', effect: 'mana_shield', duration: 6, absorbPercent: 0.5, description: 'Convert mana into a protective barrier', manaCost: 20 },
    { id: 'meteor_ab', name: 'Meteor', cooldown: 30, damage: 5.0, type: 'magic', element: 'fire', damageType: 'fire', aoe: true, description: 'Call down a devastating meteor', manaCost: 35 },
  ],
  wand: [
    { id: 'spark', name: 'Spark', cooldown: 0, damage: 0.9, type: 'magic', element: 'lightning', damageType: 'lightning', description: 'Quick spark of lightning', manaCost: 2 },
    { id: 'chain_lightning_ab', name: 'Chain Lightning', cooldown: 10, damage: 1.8, type: 'magic', element: 'lightning', damageType: 'lightning', aoe: true, bounces: 3, description: 'Lightning bounces between enemies', manaCost: 12 },
    { id: 'hex', name: 'Hex', cooldown: 14, damage: 0.5, type: 'magic', element: 'dark', damageType: 'shadow', effect: 'weaken', weakenAmount: 0.25, duration: 5, description: 'Curse an enemy weakening their attacks', manaCost: 10 },
    { id: 'barrier', name: 'Barrier', cooldown: 18, damage: 0, type: 'defensive', effect: 'magic_barrier', duration: 5, absorbFlat: 50, description: 'Erect an arcane barrier absorbing damage', manaCost: 15 },
    { id: 'arcane_barrage', name: 'Arcane Barrage', cooldown: 25, damage: 3.5, type: 'magic', element: 'arcane', damageType: 'arcane', aoe: true, description: 'Unleash a barrage of arcane missiles', manaCost: 25 },
  ],
  dagger: [
    { id: 'stab', name: 'Stab', cooldown: 0, damage: 0.8, type: 'physical', damageType: 'piercing', description: 'Quick dagger stab', manaCost: 0 },
    { id: 'backstab_ab', name: 'Backstab', cooldown: 8, damage: 3.0, type: 'physical', damageType: 'piercing', critBonus: 0.15, description: 'Strike from behind for critical damage', manaCost: 5 },
    { id: 'poison_blade_ab', name: 'Poison Blade', cooldown: 12, damage: 1.0, type: 'physical', damageType: 'poison', dot: { tickDamage: 0.4, duration: 5, name: 'poisoned' }, description: 'Coat blade in poison dealing damage over time', manaCost: 8 },
    { id: 'smoke_bomb_ab', name: 'Smoke Bomb', cooldown: 18, damage: 0, type: 'defensive', effect: 'dodge_buff', duration: 4, dodgeBonus: 0.40, description: 'Vanish in smoke greatly increasing evasion', manaCost: 10 },
    { id: 'assassinate', name: 'Assassination', cooldown: 25, damage: 5.5, type: 'physical', damageType: 'piercing', condition: 'target_below_30hp', critBonus: 0.20, description: 'Execute a lethal assassination on weakened foes', manaCost: 20 },
  ],
  mace: [
    { id: 'bash_ab', name: 'Bash', cooldown: 0, damage: 1.0, type: 'physical', damageType: 'blunt', description: 'Basic mace bash', manaCost: 0 },
    { id: 'smite', name: 'Smite', cooldown: 8, damage: 2.0, type: 'magic', element: 'holy', damageType: 'holy', description: 'Channel holy power into a smiting blow', manaCost: 8 },
    { id: 'stun_strike', name: 'Stun Strike', cooldown: 14, damage: 1.5, type: 'physical', damageType: 'blunt', effect: 'stun', duration: 2, description: 'Heavy blow that stuns the target', manaCost: 10 },
    { id: 'holy_light_ab', name: 'Holy Light', cooldown: 16, damage: 0, type: 'heal', healMultiplier: 2.0, description: 'Heal yourself with divine light', manaCost: 15 },
    { id: 'judgement', name: 'Judgement', cooldown: 22, damage: 3.5, type: 'magic', element: 'holy', damageType: 'holy', aoe: true, description: 'Pass divine judgement on all nearby foes', manaCost: 20 },
  ],
  spear: [
    { id: 'thrust', name: 'Thrust', cooldown: 0, damage: 1.0, type: 'physical', damageType: 'piercing', description: 'Basic spear thrust', manaCost: 0 },
    { id: 'impale', name: 'Impale', cooldown: 8, damage: 2.5, type: 'physical', damageType: 'piercing', dot: { tickDamage: 0.2, duration: 3, name: 'impaled' }, description: 'Drive the spear deep causing bleeding', manaCost: 5 },
    { id: 'sweep_ab', name: 'Sweep', cooldown: 12, damage: 1.4, type: 'physical', damageType: 'piercing', aoe: true, description: 'Sweep the spear in a wide arc', manaCost: 8 },
    { id: 'javelin_throw', name: 'Javelin Throw', cooldown: 15, damage: 2.8, type: 'physical', damageType: 'piercing', description: 'Hurl the spear as a javelin at range', manaCost: 10 },
    { id: 'phalanx', name: 'Phalanx', cooldown: 22, damage: 0, type: 'defensive', effect: 'armor_buff', duration: 6, armorBonus: 15, description: 'Brace into defensive stance boosting armor', manaCost: 12 },
  ],
  hammer: [
    { id: 'slam', name: 'Slam', cooldown: 0, damage: 1.1, type: 'physical', damageType: 'blunt', description: 'Heavy hammer slam', manaCost: 0 },
    { id: 'ground_pound', name: 'Ground Pound', cooldown: 10, damage: 1.8, type: 'physical', damageType: 'earth', aoe: true, description: 'Smash the ground damaging nearby foes', manaCost: 8 },
    { id: 'shatter', name: 'Shatter', cooldown: 14, damage: 2.2, type: 'physical', damageType: 'blunt', effect: 'armor_break', armorReduction: 10, duration: 5, description: 'Shatter enemy armor reducing their defense', manaCost: 10 },
    { id: 'fortify_ab', name: 'Fortify', cooldown: 18, damage: 0, type: 'defensive', effect: 'armor_buff', duration: 8, armorBonus: 20, description: 'Fortify your defenses greatly boosting armor', manaCost: 12 },
    { id: 'earthquake', name: 'Earthquake', cooldown: 28, damage: 3.5, type: 'physical', damageType: 'earth', aoe: true, effect: 'stun', duration: 1, description: 'Cause an earthquake stunning and damaging all enemies', manaCost: 25 },
  ],
  unarmed: [
    { id: 'punch', name: 'Punch', cooldown: 0, damage: 0.8, type: 'physical', damageType: 'blunt', description: 'Quick punch', manaCost: 0 },
    { id: 'kick', name: 'Kick', cooldown: 6, damage: 1.8, type: 'physical', damageType: 'blunt', description: 'Powerful kick', manaCost: 3 },
    { id: 'palm_strike', name: 'Palm Strike', cooldown: 10, damage: 2.0, type: 'physical', damageType: 'blunt', effect: 'stun', duration: 1, description: 'Focused palm strike that stuns briefly', manaCost: 8 },
    { id: 'counter_ab', name: 'Counter', cooldown: 14, damage: 0, type: 'defensive', effect: 'counter', duration: 3, counterMultiplier: 2.0, description: 'Enter counter stance retaliating against next attack', manaCost: 5 },
    { id: 'dragon_fist', name: 'Dragon Fist', cooldown: 22, damage: 4.0, type: 'physical', damageType: 'blunt', aoe: true, description: 'Unleash a devastating chi-powered fist', manaCost: 18 },
  ],
};

// Build flat lookup: abilityId -> { ability, weaponFamily }
var ABILITY_BY_ID = {};
var _weaponFamilies = Object.keys(WEAPON_ABILITIES);
for (var _wfi = 0; _wfi < _weaponFamilies.length; _wfi++) {
  var _family = _weaponFamilies[_wfi];
  var _abilities = WEAPON_ABILITIES[_family];
  for (var _abi = 0; _abi < _abilities.length; _abi++) {
    ABILITY_BY_ID[_abilities[_abi].id] = { ability: _abilities[_abi], weaponFamily: _family };
  }
}

// ---------------------------------------------------------------------------
// Card-Based Ability Modifier Cards
// ---------------------------------------------------------------------------

var ABILITY_MODIFIER_CARDS = [
  { cardId: 'swift_strikes', name: 'Swift Strikes', type: 'ability_modifier', rarity: 'rare', archetype: 'warrior', tags: ['combat'], effects: [{ type: 'ability_cooldown_reduction', weaponFamily: 'sword', value: 0.20 }], icon: 'skills/Skill_SwordAttack.PNG', description: '-20% cooldown on sword abilities' },
  { cardId: 'rapid_fire', name: 'Rapid Fire', type: 'ability_modifier', rarity: 'rare', archetype: 'warrior', tags: ['combat'], effects: [{ type: 'ability_cooldown_reduction', weaponFamily: 'bow', value: 0.20 }], icon: 'skills/Skill_SwordAttack.PNG', description: '-20% cooldown on bow abilities' },
  { cardId: 'arcane_haste', name: 'Arcane Haste', type: 'ability_modifier', rarity: 'rare', archetype: 'mystic', archetypeSecondary: ['mystic'], tags: ['magic', 'combat'], effects: [{ type: 'ability_cooldown_reduction', weaponFamily: 'staff', value: 0.15 }, { type: 'ability_cooldown_reduction', weaponFamily: 'wand', value: 0.15 }], icon: 'skills/Enchantment/', description: '-15% cooldown on staff and wand abilities' },
  { cardId: 'pyromaniac', name: 'Pyromaniac', type: 'ability_modifier', rarity: 'ultra_rare', archetype: 'mystic', tags: ['magic', 'combat'], effects: [{ type: 'ability_element_damage', element: 'fire', value: 0.30 }], icon: 'skills/Skill_Explosion.PNG', description: '+30% fire ability damage' },
  { cardId: 'frost_mastery', name: 'Frost Mastery', type: 'ability_modifier', rarity: 'ultra_rare', archetype: 'mystic', tags: ['magic', 'combat'], effects: [{ type: 'ability_element_damage', element: 'ice', value: 0.30 }], icon: 'skills/Enchantment/', description: '+30% ice ability damage' },
  { cardId: 'storm_caller', name: 'Storm Caller', type: 'ability_modifier', rarity: 'ultra_rare', archetype: 'mystic', tags: ['magic', 'combat'], effects: [{ type: 'ability_element_damage', element: 'lightning', value: 0.25 }], icon: 'skills/Skill_Explosion.PNG', description: '+25% lightning ability damage' },
  { cardId: 'brutal_force', name: 'Brutal Force', type: 'ability_modifier', rarity: 'rare', archetype: 'warrior', tags: ['combat'], effects: [{ type: 'ability_type_damage', abilityType: 'physical', value: 0.15 }], icon: 'skills/Skill_SwordAttack.PNG', description: '+15% physical ability damage' },
  { cardId: 'venomous_edge', name: 'Venomous Edge', type: 'ability_modifier', rarity: 'ultra_rare', archetype: 'rogue', archetypeSecondary: ['tactician'], tags: ['stealth', 'combat'], effects: [{ type: 'ability_enhance', abilityId: 'backstab_ab', addDot: { tickDamage: 0.3, duration: 4, name: 'venomous_wound' } }], icon: 'skills/Enchantment/', description: 'Backstab now applies a poison DoT' },
  { cardId: 'stunning_bash', name: 'Stunning Bash', type: 'ability_modifier', rarity: 'rare', archetype: 'tactician', archetypeSecondary: ['warrior'], tags: ['combat'], effects: [{ type: 'ability_enhance', abilityId: 'bash_ab', addEffect: 'stun', addDuration: 1 }], icon: 'skills/Skill_SwordAttack.PNG', description: 'Bash now has a chance to stun for 1s' },
  { cardId: 'empowered_execute', name: 'Empowered Execute', type: 'ability_modifier', rarity: 'ultra_rare', archetype: 'warrior', tags: ['combat'], effects: [{ type: 'ability_enhance', abilityId: 'execute', damageBonus: 0.50 }], icon: 'skills/Skill_SwordAttack.PNG', description: 'Execute deals 50% more damage' },
  { cardId: 'bladedancer', name: 'Bladedancer', type: 'ability_modifier', rarity: 'legendary', archetype: 'warrior', archetypeSecondary: ['tactician'], tags: ['combat'], effects: [{ type: 'ability_unlock', weaponFamily: 'sword', ability: { id: 'blade_dance', name: 'Blade Dance', cooldown: 18, damage: 2.0, type: 'physical', aoe: true, hits: 3, description: 'Rapid multi-hit blade dance striking 3 times', manaCost: 15 } }], icon: 'skills/Skill_SwordAttack.PNG', description: 'Unlocks Blade Dance for swords' },
  { cardId: 'shadow_step_card', name: 'Shadow Step', type: 'ability_modifier', rarity: 'legendary', archetype: 'rogue', tags: ['stealth', 'combat'], effects: [{ type: 'ability_unlock', weaponFamily: 'dagger', ability: { id: 'shadow_step_ab', name: 'Shadow Step', cooldown: 16, damage: 2.5, type: 'physical', effect: 'stealth', duration: 2, description: 'Teleport behind target and strike from stealth', manaCost: 12 } }], icon: 'skills/Enchantment/', description: 'Unlocks Shadow Step for daggers' },
  { cardId: 'meteor_shower_card', name: 'Meteor Shower', type: 'ability_modifier', rarity: 'legendary', archetype: 'mystic', tags: ['magic', 'combat'], effects: [{ type: 'ability_unlock', weaponFamily: 'staff', ability: { id: 'meteor_shower_ab', name: 'Meteor Shower', cooldown: 40, damage: 3.0, type: 'magic', element: 'fire', aoe: true, hits: 5, description: 'Call down a devastating rain of meteors', manaCost: 50 } }], icon: 'skills/Skill_Explosion.PNG', description: 'Unlocks Meteor Shower for staffs' },
  { cardId: 'combat_focus', name: 'Combat Focus', type: 'ability_modifier', rarity: 'rare', archetype: 'warrior', tags: ['combat'], effects: [{ type: 'ability_cooldown_reduction_all', value: 0.10 }], icon: 'skills/Skill_SwordAttack.PNG', description: '-10% cooldown on all abilities' },
  { cardId: 'mana_efficiency_card', name: 'Mana Efficiency', type: 'ability_modifier', rarity: 'rare', archetype: 'mystic', archetypeSecondary: ['mystic'], tags: ['magic', 'combat'], effects: [{ type: 'ability_mana_reduction', value: 0.20 }], icon: 'skills/Enchantment/', description: '-20% mana cost on all abilities' },
];

// Append ability modifier cards to CARD_TEMPLATES and indexes
for (var _amci = 0; _amci < ABILITY_MODIFIER_CARDS.length; _amci++) {
  CARD_TEMPLATES.push(ABILITY_MODIFIER_CARDS[_amci]);
  var _amc = ABILITY_MODIFIER_CARDS[_amci];
  if (!CARDS_BY_RARITY[_amc.rarity]) CARDS_BY_RARITY[_amc.rarity] = [];
  CARDS_BY_RARITY[_amc.rarity].push(_amc);
  CARD_BY_ID[_amc.cardId] = _amc;
}

// ---------------------------------------------------------------------------
// Ability modifier computation from equipped cards
// ---------------------------------------------------------------------------

function computeAbilityModifiers(equippedCards) {
  var mods = { cooldownReductions: {}, elementDamage: {}, typeDamage: {}, enhancements: {}, unlockedAbilities: {}, globalCooldownReduction: 0, manaReduction: 0 };
  if (!equippedCards || !Array.isArray(equippedCards)) return mods;
  for (var i = 0; i < equippedCards.length; i++) {
    var card = equippedCards[i];
    if (!card || !card.effects) continue;
    for (var j = 0; j < card.effects.length; j++) {
      var eff = card.effects[j];
      if (eff.type === 'ability_cooldown_reduction' && eff.weaponFamily) mods.cooldownReductions[eff.weaponFamily] = (mods.cooldownReductions[eff.weaponFamily] || 0) + (eff.value || 0);
      if (eff.type === 'ability_cooldown_reduction_all') mods.globalCooldownReduction += (eff.value || 0);
      if (eff.type === 'ability_element_damage' && eff.element) mods.elementDamage[eff.element] = (mods.elementDamage[eff.element] || 0) + (eff.value || 0);
      if (eff.type === 'ability_type_damage' && eff.abilityType) mods.typeDamage[eff.abilityType] = (mods.typeDamage[eff.abilityType] || 0) + (eff.value || 0);
      if (eff.type === 'ability_enhance' && eff.abilityId) {
        if (!mods.enhancements[eff.abilityId]) mods.enhancements[eff.abilityId] = {};
        var enh = mods.enhancements[eff.abilityId];
        if (eff.addDot) enh.addDot = eff.addDot;
        if (eff.addEffect) enh.addEffect = eff.addEffect;
        if (eff.addDuration) enh.addDuration = (enh.addDuration || 0) + eff.addDuration;
        if (eff.damageBonus) enh.damageBonus = (enh.damageBonus || 0) + eff.damageBonus;
      }
      if (eff.type === 'ability_unlock' && eff.weaponFamily && eff.ability) {
        if (!mods.unlockedAbilities[eff.weaponFamily]) mods.unlockedAbilities[eff.weaponFamily] = [];
        mods.unlockedAbilities[eff.weaponFamily].push(eff.ability);
      }
      if (eff.type === 'ability_mana_reduction') mods.manaReduction += (eff.value || 0);
    }
  }
  return mods;
}

function getEffectiveCooldown(ability, weaponFamily, cardMods) {
  if (!ability || ability.cooldown <= 0) return 0;
  var cd = ability.cooldown;
  var reduction = 0;
  if (cardMods) {
    reduction += (cardMods.globalCooldownReduction || 0);
    if (cardMods.cooldownReductions && cardMods.cooldownReductions[weaponFamily]) reduction += cardMods.cooldownReductions[weaponFamily];
  }
  reduction = Math.min(reduction, 0.50);
  return Math.max(1, Math.round(cd * (1 - reduction)));
}

function getEffectiveManaCost(ability, cardMods) {
  if (!ability) return 0;
  var cost = ability.manaCost || 0;
  if (cost <= 0) return 0;
  var reduction = cardMods ? (cardMods.manaReduction || 0) : 0;
  reduction = Math.min(reduction, 0.50);
  return Math.max(1, Math.round(cost * (1 - reduction)));
}

function getPlayerAbilities(weaponFamily, equippedCards) {
  var family = weaponFamily || 'unarmed';
  var baseAbilities = WEAPON_ABILITIES[family] || WEAPON_ABILITIES.unarmed;
  var abilities = [];
  for (var i = 0; i < baseAbilities.length; i++) abilities.push(baseAbilities[i]);
  var cardMods = computeAbilityModifiers(equippedCards);
  if (cardMods.unlockedAbilities && cardMods.unlockedAbilities[family]) {
    var unlocked = cardMods.unlockedAbilities[family];
    for (var j = 0; j < unlocked.length; j++) abilities.push(unlocked[j]);
  }
  return abilities;
}

/**
 * Compute the max resource pool for a given resource type and race.
 * Primary resource gets 100% base + 20% racial bonus.
 * Secondary resources get 50% base capacity.
 * Resource Attunement cards increase secondary resource max by +25% each (stackable to 100%).
 */
function computeResourceMax(resourceId, race, attunementStacks) {
  var resource = COMBAT_RESOURCES[resourceId];
  if (!resource) return 0;
  var base = resource.baseMax;
  var primaryRes = RACE_PRIMARY_RESOURCE[race] || 'mana';
  if (resourceId === primaryRes) {
    return Math.floor(base * (1 + PRIMARY_RESOURCE_BONUS));
  }
  // Secondary: 50% base, +25% per attunement stack (max 2 stacks = 100%)
  var attunement = Math.min(attunementStacks || 0, 2);
  var scale = SECONDARY_RESOURCE_SCALE + (attunement * 0.25);
  scale = Math.min(scale, 1.0); // cap at 100%
  return Math.floor(base * scale);
}

// ---------------------------------------------------------------------------
// Dual-Wield Skills — unlocked by specific hand combinations
// ---------------------------------------------------------------------------

var DUAL_WIELD_SKILLS = {
  // Twin Fangs (dagger+dagger)
  flurry_of_blades: { name: 'Flurry of Blades', type: 'active', cost: { stamina: 20 }, cooldown: 3,
    effect: { type: 'multi_hit', hits: 4, damagePercent: 0.40, canCrit: true },
    description: 'Unleash 4 rapid strikes at 40% damage each.' },
  twin_backstab: { name: 'Twin Backstab', type: 'active', cost: { stamina: 25 }, cooldown: 5,
    effect: { type: 'stealth_attack', damagePercent: 2.0, appliesDebuff: 'bleed' },
    description: 'Strike from stealth with both daggers. 200% damage + bleed.' },

  // Blade Storm (sword+sword)
  whirlwind_slash: { name: 'Whirlwind Slash', type: 'active', cost: { stamina: 30 }, cooldown: 4,
    effect: { type: 'aoe_melee', radius: 1, damagePercent: 0.80 },
    description: 'Spin attack hitting all adjacent enemies at 80% damage.' },
  riposte: { name: 'Riposte', type: 'passive',
    effect: { type: 'counter_attack', triggerChance: 0.15, damagePercent: 1.2 },
    description: '15% chance to counter-attack after blocking for 120% damage.' },

  // Swordbreaker (sword+dagger)
  feint_strike: { name: 'Feint Strike', type: 'active', cost: { stamina: 15 }, cooldown: 2,
    effect: { type: 'guaranteed_crit', damagePercent: 1.5 },
    description: 'Feint with main hand, strike with dagger. Guaranteed crit at 150% damage.' },
  disarm: { name: 'Disarm', type: 'active', cost: { stamina: 20 }, cooldown: 6,
    effect: { type: 'debuff', debuffName: 'disarmed', duration: 2, enemyDmgReduction: 0.40 },
    description: 'Disarm target, reducing their damage by 40% for 2 turns.' },

  // Berserker Fury (axe+axe)
  cleave: { name: 'Cleave', type: 'active', cost: { stamina: 25 }, cooldown: 3,
    effect: { type: 'aoe_cone', damagePercent: 1.0, tilesForward: 2 },
    description: 'Cleave forward hitting up to 3 enemies for full damage.' },
  raging_blow: { name: 'Raging Blow', type: 'active', cost: { stamina: 35, hp: 10 }, cooldown: 4,
    effect: { type: 'single_hit', damagePercent: 2.5, selfDamage: 10 },
    description: 'Devastating blow at 250% damage. Costs 10 HP.' },

  // Skull Crusher (mace+mace)
  ground_pound: { name: 'Ground Pound', type: 'active', cost: { stamina: 30 }, cooldown: 5,
    effect: { type: 'aoe_melee', radius: 1, damagePercent: 0.60, appliesDebuff: 'stun', stunDuration: 1 },
    description: 'Slam ground stunning adjacent enemies for 1 turn.' },
  concussive_blow: { name: 'Concussive Blow', type: 'active', cost: { stamina: 20 }, cooldown: 3,
    effect: { type: 'single_hit', damagePercent: 1.3, armorPen: 0.20 },
    description: 'Crushing strike ignoring 20% armor. 130% damage.' },

  // Sword & Board (weapon+shield)
  shield_bash: { name: 'Shield Bash', type: 'active', cost: { stamina: 15 }, cooldown: 2,
    effect: { type: 'single_hit', damagePercent: 0.5, appliesDebuff: 'stun', stunDuration: 1, usesDefense: true },
    description: 'Bash with shield for 50% damage + stun. Scales with shield defense.' },
  defensive_stance: { name: 'Defensive Stance', type: 'active', cost: { stamina: 10 }, cooldown: 6,
    effect: { type: 'self_buff', buffName: 'fortified', duration: 3, blockBonus: 0.20, defenseBonus: 10 },
    description: '+20% block and +10 defense for 3 turns.' },

  // Iron Fortress (shield+shield)
  shield_wall: { name: 'Shield Wall', type: 'active', cost: { stamina: 25 }, cooldown: 5,
    effect: { type: 'self_buff', buffName: 'shield_wall', duration: 3, damageReduction: 0.50, immobilize: true },
    description: 'Brace shields: 50% damage reduction for 3 turns. Cannot move.' },
  reflecting_guard: { name: 'Reflecting Guard', type: 'active', cost: { stamina: 20 }, cooldown: 4,
    effect: { type: 'reflect', reflectPercent: 0.30, duration: 2 },
    description: 'Reflect 30% of incoming damage back to attackers for 2 turns.' },
  taunt: { name: 'Taunt', type: 'active', cost: { stamina: 10 }, cooldown: 3,
    effect: { type: 'taunt', duration: 2, radius: 3 },
    description: 'Force nearby enemies to attack you for 2 turns.' },

  // Arcane Conduit (wand+wand)
  arcane_barrage: { name: 'Arcane Barrage', type: 'active', cost: { mana: 30 }, cooldown: 3,
    effect: { type: 'multi_hit', hits: 3, damagePercent: 0.60, usesMagic: true },
    description: 'Fire 3 arcane bolts at 60% magic damage each.' },
  mana_shield: { name: 'Mana Shield', type: 'active', cost: { mana: 20 }, cooldown: 8,
    effect: { type: 'self_buff', buffName: 'mana_shield', duration: 4, absorbDamage: true, manaPerDamage: 2 },
    description: 'Absorb damage using mana (2 mana per damage) for 4 turns.' },

  // Grand Magister (staff+staff)
  meteor_strike: { name: 'Meteor Strike', type: 'active', cost: { mana: 50 }, cooldown: 8,
    effect: { type: 'aoe_ranged', radius: 2, damagePercent: 2.0, usesMagic: true },
    description: 'Call down a meteor. 200% magic damage in a 2-tile radius.' },
  arcane_ward: { name: 'Arcane Ward', type: 'active', cost: { mana: 25 }, cooldown: 6,
    effect: { type: 'self_buff', buffName: 'arcane_ward', duration: 3, magicResistBonus: 15, reflectMagic: 0.15 },
    description: '+15 magic resist, reflect 15% magic damage for 3 turns.' },

  // Battlemage (wand+staff)
  spell_weave: { name: 'Spell Weave', type: 'active', cost: { mana: 20 }, cooldown: 3,
    effect: { type: 'single_hit', damagePercent: 1.5, usesMagic: true, appliesDebuff: 'spell_vulnerability', duration: 2 },
    description: '150% magic damage. Target takes 15% more magic damage for 2 turns.' },
  counterspell: { name: 'Counterspell', type: 'active', cost: { mana: 15 }, cooldown: 4,
    effect: { type: 'interrupt', silenceDuration: 2 },
    description: 'Interrupt enemy cast and silence for 2 turns.' },

  // Spellblade (sword+wand)
  enchanted_strike: { name: 'Enchanted Strike', type: 'active', cost: { mana: 15, stamina: 10 }, cooldown: 2,
    effect: { type: 'single_hit', damagePercent: 1.2, bonusMagicDamagePercent: 0.80 },
    description: 'Strike with enchanted blade: 120% melee + 80% magic damage.' },
  spell_parry: { name: 'Spell Parry', type: 'active', cost: { mana: 10 }, cooldown: 3,
    effect: { type: 'counter_magic', absorbNextSpell: true, counterDamagePercent: 0.50 },
    description: 'Absorb next magic attack and counter for 50% damage.' },

  // Battle Priest (mace+wand)
  smite: { name: 'Smite', type: 'active', cost: { mana: 20, stamina: 10 }, cooldown: 3,
    effect: { type: 'single_hit', damagePercent: 1.5, bonusVsUndead: 1.0, usesMagic: true },
    description: 'Holy strike: 150% damage, double vs undead.' },
  healing_light: { name: 'Healing Light', type: 'active', cost: { mana: 25 }, cooldown: 4,
    effect: { type: 'heal', healPercent: 0.25 },
    description: 'Heal for 25% of max HP.' },

  // Titan Grip (2h+2h)
  titan_slam: { name: 'Titan Slam', type: 'active', cost: { stamina: 40 }, cooldown: 5,
    effect: { type: 'aoe_melee', radius: 1, damagePercent: 1.5, knockback: 2 },
    description: 'Massive slam: 150% damage to all adjacent, knockback 2 tiles.' },
  earthquake: { name: 'Earthquake', type: 'active', cost: { stamina: 50 }, cooldown: 8,
    effect: { type: 'aoe_melee', radius: 2, damagePercent: 1.0, appliesDebuff: 'stun', stunDuration: 1, selfStun: 1 },
    description: 'Ground-shaking blow: AoE 2 radius, stun everything including self.' },

  // Shieldbearer Archer (bow+shield)
  shield_cover: { name: 'Shield Cover', type: 'active', cost: { stamina: 15 }, cooldown: 3,
    effect: { type: 'self_buff', buffName: 'shield_cover', duration: 2, rangedDmgReduction: 0.40 },
    description: 'Hunker behind shield: -40% ranged damage taken for 2 turns.' },
  aimed_shot: { name: 'Aimed Shot', type: 'active', cost: { stamina: 20 }, cooldown: 3,
    effect: { type: 'single_hit', damagePercent: 2.0, range: 6 },
    description: 'Carefully aimed shot for 200% damage.' },

  // Scout (bow+dagger)
  quick_draw: { name: 'Quick Draw', type: 'active', cost: { stamina: 10 }, cooldown: 2,
    effect: { type: 'single_hit', damagePercent: 0.80, instantCast: true },
    description: 'Snap shot that doesn\'t consume your turn.' },
  knife_throw: { name: 'Knife Throw', type: 'active', cost: { stamina: 15 }, cooldown: 2,
    effect: { type: 'single_hit', damagePercent: 1.0, range: 3, appliesDebuff: 'bleed' },
    description: 'Throw off-hand dagger: 100% damage at range 3 + bleed.' },
};

// NPC Dialogue Trees — extracted to npc-dialogues.js
var { NPC_DIALOGUES } = require('./npc-dialogues');

module.exports = {
  // Status Effect Categories
  STATUS_EFFECT_CATEGORIES,
  getStatusEffectCategory,

  // Races
  RACES,
  RACE_IDS,
  RACE_LANGUAGES,
  ALL_LANGUAGES,
  RACIAL_INNATE_TRAITS,
  RACIAL_VISION_TYPES,
  canTradeCardToRace,

  // Vision Types
  VISION_TYPES,
  getAvailableVisionTypes,
  visionPreventsAmbush,
  getVisionCombatBonuses,

  // Stats
  STAT_NAMES,
  STAT_KEYS,
  BASE_STAT_VALUE,
  FREE_POINTS_AT_CREATION,
  STAT_POINTS_PER_LEVELS,
  getDefaultStats,
  applyRaceBumps,
  computeStats,
  computeCombatSpeed,

  // Combat Resources (4-pool system)
  COMBAT_RESOURCES,
  RACE_PRIMARY_RESOURCE,
  PRIMARY_RESOURCE_BONUS,
  SECONDARY_RESOURCE_SCALE,
  computeResourceMax,

  // Skills
  SKILL_DEFINITIONS,
  getDefaultSkills,
  getSkillsForRace,

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

  // Cards - Rarity
  RARITY_TIERS,
  RARITY_BY_ID,
  TOTAL_RARITY_WEIGHT,
  rollRarity,

  // Pity system constants
  SOFT_PITY_START,
  HARD_PITY,
  SOFT_PITY_RATE,

  // Rate disclosure
  RACE_POOL_BIAS,
  CATFOLK_RARITY_BUMP,
  computeEffectiveGachaRates,

  // Cards - Types & Templates
  CARD_TYPES,
  CARD_TEMPLATES,
  CARDS_BY_RARITY,
  CARD_BY_ID,
  EVOLUTION_CONFIG,
  CARDS_PER_PACK_MIN,
  CARDS_PER_PACK_MAX,
  MAX_ACTIVE_CARD_SLOTS,
  MAX_PASSIVE_CARD_SLOTS,
  MAX_EQUIPPED_CARDS,
  MAX_CARD_COLLECTION,
  MAX_FUSION_COUNT,

  // Card Operations
  generateCardInstance,
  openCardPack,
  canFuseCards,
  fuseCards,
  rollCardStyle,
  generateSerial,
  // Affix system
  AFFIX_POOL,
  AFFIX_COUNT_BY_RARITY,
  PASSIVE_RIDER_CHANCE,
  rollCardAffixes,
  rollPassiveRider,
  getAffixNamePrefix,
  getAffixNameSuffix,
  // Combo + stacking system
  COMBO_POOL,
  computeCardCombos,
  refreshCardEffects,
  addAffixToCard,
  rollItemAffixes,
  rollEvoAffix,
  // Mutation system
  MUTATION_POOL,
  rollMutation,
  applyMutation,
  // Curse system (cards)
  CARD_CURSE_POOL,
  rollCardCurse,
  applyCurse,
  cleanseCardCurse,

  // Card Styles
  CARD_STYLES,

  // Biome Skill Bonuses
  SKILL_BIOME_BONUS,

  // Water traversal
  WATER_MOUNTS,

  // Leveling
  MAX_OVERALL_LEVEL,
  XP_SPILLOVER_RATE,
  overallXpForLevel,
  getActiveCardSlotCount,
  getPassiveCardSlotCount,
  getCardSlotCount,
  isActiveCardType,
  getStatPointsForLevel,

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

  // Elemental system (Fix 2)
  ELEMENTAL_TABLE,
  getElementalMultiplier,

  // Weapon damage types (Fix 3)
  WEAPON_DAMAGE_TYPES,
  ARMOR_PHYS_RESIST,

  // Skill combat bonuses (Fix 4)
  getCombatSkillBonuses,

  // Food effects
  FOOD_EFFECTS,

  // Crafting skill perks
  CRAFTING_SKILL_PERKS,
  getCraftingSkillBonuses,

  // Weapon abilities (cooldown combat system)
  WEAPON_ABILITIES,
  ABILITY_BY_ID,
  ABILITY_MODIFIER_CARDS,
  getWeaponFamily,
  getWeaponFamilyFromCategory,
  computeAbilityModifiers,
  getEffectiveCooldown,
  getEffectiveManaCost,
  getPlayerAbilities,

  // Full damage type system
  DAMAGE_TYPES,
  DAMAGE_TYPE_EFFECTIVENESS,
  ARMOR_RESISTANCE_TYPES,
  WEAPON_ABILITY_DAMAGE_TYPES,
  getAbilityDamageType,
  calculateDamageMultiplier,
  getMonsterResistances,

  // Card ability cooldowns
  CARD_ABILITY_COOLDOWNS,
  getCardAbilityCooldown,
  getCardAbilityManaCost,

  // Rift Scars
  RIFT_SCAR_PREFIXES,
  RIFT_SCAR_SUFFIXES,
  getRiftScarCount,
  rollRiftScarPrefix,
  rollRiftScarSuffix,
  applyRiftScars,

  // Awakenings
  AWAKENINGS,
  getAvailableAwakenings,

  // Dual-Wield Skills
  DUAL_WIELD_SKILLS,

  // NPC Dialogues
  NPC_DIALOGUES,

  // World Quests
  WORLD_QUEST_TEMPLATES,

  // Per-biome Weather
  BIOME_WEATHER,
  BIOME_WEATHER_EFFECTS,
  getWeatherForBiome,
  getBiomeWeatherEffect,

  // Seasonal override hook
  applySeasonalOverrides: function(overrides) {
    for (var key in overrides) {
      if (module.exports.hasOwnProperty(key)) {
        module.exports[key] = overrides[key];
      }
    }
  },
};
