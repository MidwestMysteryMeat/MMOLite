// card-pools.js
// Barrel re-export for the card pool subsystem.
// Sub-modules: card-rarity, card-templates, card-modifiers, card-affixes,
//              card-generation, card-fusion.

var cardRarity = require('./card-rarity');
var cardTemplates = require('./card-templates');
var cardModifiers = require('./card-modifiers');
var cardGeneration = require('./card-generation');
var cardAffixes = require('./card-affixes');
var cardFusion = require('./card-fusion');

module.exports = {
  // Rarity system (card-rarity.js)
  RARITY_TIERS: cardRarity.RARITY_TIERS,
  RARITY_BY_ID: cardRarity.RARITY_BY_ID,
  TOTAL_RARITY_WEIGHT: cardRarity.TOTAL_RARITY_WEIGHT,
  RARITY_SCALE: cardRarity.RARITY_SCALE,
  SOFT_PITY_START: cardRarity.SOFT_PITY_START,
  HARD_PITY: cardRarity.HARD_PITY,
  SOFT_PITY_RATE: cardRarity.SOFT_PITY_RATE,
  rollRarity: cardRarity.rollRarity,

  // Card types & templates (card-templates.js via card-generation.js)
  CARD_TYPES: cardGeneration.CARD_TYPES,
  CARD_TEMPLATES: cardGeneration.CARD_TEMPLATES,
  CARDS_BY_RARITY: cardGeneration.CARDS_BY_RARITY,
  CARD_BY_ID: cardGeneration.CARD_BY_ID,

  // Card styles & serial (card-generation.js)
  CARD_STYLES: cardGeneration.CARD_STYLES,
  generateSerial: cardGeneration.generateSerial,
  rollCardStyle: cardGeneration.rollCardStyle,

  // Biome & mount helpers (card-generation.js)
  SKILL_BIOME_BONUS: cardGeneration.SKILL_BIOME_BONUS,
  WATER_MOUNTS: cardGeneration.WATER_MOUNTS,

  // Gacha rate disclosure (card-generation.js)
  RACE_POOL_BIAS: cardGeneration.RACE_POOL_BIAS,
  CATFOLK_RARITY_BUMP: cardGeneration.CATFOLK_RARITY_BUMP,
  computeEffectiveGachaRates: cardGeneration.computeEffectiveGachaRates,

  // Rift scars (card-generation.js)
  RIFT_SCAR_PREFIXES: cardGeneration.RIFT_SCAR_PREFIXES,
  RIFT_SCAR_SUFFIXES: cardGeneration.RIFT_SCAR_SUFFIXES,
  getRiftScarCount: cardGeneration.getRiftScarCount,
  rollRiftScarPrefix: cardGeneration.rollRiftScarPrefix,
  rollRiftScarSuffix: cardGeneration.rollRiftScarSuffix,
  applyRiftScars: cardGeneration.applyRiftScars,

  // Evolution config (card-generation.js)
  EVOLUTION_CONFIG: cardGeneration.EVOLUTION_CONFIG,

  // Card pack constants (card-generation.js)
  CARDS_PER_PACK_MIN: cardGeneration.CARDS_PER_PACK_MIN,
  CARDS_PER_PACK_MAX: cardGeneration.CARDS_PER_PACK_MAX,
  MAX_ACTIVE_CARD_SLOTS: cardGeneration.MAX_ACTIVE_CARD_SLOTS,
  MAX_PASSIVE_CARD_SLOTS: cardGeneration.MAX_PASSIVE_CARD_SLOTS,
  MAX_EQUIPPED_CARDS: cardGeneration.MAX_EQUIPPED_CARDS,
  MAX_CARD_COLLECTION: cardGeneration.MAX_CARD_COLLECTION,
  MAX_FUSION_COUNT: cardGeneration.MAX_FUSION_COUNT,

  // Card generation (card-generation.js)
  generateCardInstance: cardGeneration.generateCardInstance,
  openCardPack: cardGeneration.openCardPack,

  // Mutation system (card-modifiers.js)
  MUTATION_POOL: cardModifiers.MUTATION_POOL,
  MUTATION_TIER_NAMES: cardModifiers.MUTATION_TIER_NAMES,
  rollMutation: cardModifiers.rollMutation,
  applyMutation: cardModifiers.applyMutation,

  // Curse system (card-modifiers.js)
  CARD_CURSE_POOL: cardModifiers.CARD_CURSE_POOL,
  rollCardCurse: cardModifiers.rollCardCurse,
  applyCurse: cardModifiers.applyCurse,
  cleanseCardCurse: cardModifiers.cleanseCardCurse,

  // Affix system (card-affixes.js)
  AFFIX_POOL: cardAffixes.AFFIX_POOL,
  AFFIX_COUNT_BY_RARITY: cardAffixes.AFFIX_COUNT_BY_RARITY,
  PASSIVE_RIDER_CHANCE: cardAffixes.PASSIVE_RIDER_CHANCE,
  rollCardAffixes: cardAffixes.rollCardAffixes,
  rollPassiveRider: cardAffixes.rollPassiveRider,
  getAffixNamePrefix: cardAffixes.getAffixNamePrefix,
  getAffixNameSuffix: cardAffixes.getAffixNameSuffix,

  // Combo system (card-affixes.js)
  COMBO_POOL: cardAffixes.COMBO_POOL,
  computeCardCombos: cardAffixes.computeCardCombos,
  refreshCardEffects: cardAffixes.refreshCardEffects,
  addAffixToCard: cardAffixes.addAffixToCard,
  rollItemAffixes: cardAffixes.rollItemAffixes,
  rollEvoAffix: cardAffixes.rollEvoAffix,

  // Fusion (card-fusion.js)
  canFuseCards: cardFusion.canFuseCards,
  fuseCards: cardFusion.fuseCards,
};
