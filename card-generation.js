// card-generation.js
// Index builds, rift scars, card styles, generation, pack opening, gacha rates.

var crypto = require('crypto');

var cardTemplates = require('./card-templates');
var CARD_TYPES = cardTemplates.CARD_TYPES;
var CARD_TEMPLATES = cardTemplates.CARD_TEMPLATES;

var cardRarity = require('./card-rarity');
var RARITY_TIERS = cardRarity.RARITY_TIERS;
var RARITY_BY_ID = cardRarity.RARITY_BY_ID;
var TOTAL_RARITY_WEIGHT = cardRarity.TOTAL_RARITY_WEIGHT;
var RARITY_SCALE = cardRarity.RARITY_SCALE;
var SOFT_PITY_START = cardRarity.SOFT_PITY_START;
var HARD_PITY = cardRarity.HARD_PITY;
var SOFT_PITY_RATE = cardRarity.SOFT_PITY_RATE;
var rollRarity = cardRarity.rollRarity;

var cardAffixes = require('./card-affixes');
var rollCardAffixes = cardAffixes.rollCardAffixes;
var rollPassiveRider = cardAffixes.rollPassiveRider;
var PASSIVE_RIDER_CHANCE = cardAffixes.PASSIVE_RIDER_CHANCE;
var getAffixNamePrefix = cardAffixes.getAffixNamePrefix;
var getAffixNameSuffix = cardAffixes.getAffixNameSuffix;
var refreshCardEffects = cardAffixes.refreshCardEffects;

// ---------------------------------------------------------------------------
// Rift Scars
// ---------------------------------------------------------------------------

var RIFT_SCAR_PREFIXES = [
  { id: 'scorching', name: 'Scorching', weight: 10, effects: [{ type: 'bonus_damage', element: 'fire', value: 5 }], description: '+5 fire damage' },
  { id: 'freezing', name: 'Freezing', weight: 10, effects: [{ type: 'bonus_damage', element: 'ice', value: 5 }], description: '+5 ice damage' },
  { id: 'venomous', name: 'Venomous', weight: 10, effects: [{ type: 'bonus_damage', element: 'poison', value: 4 }, { type: 'dot_chance', element: 'poison', value: 0.15 }], description: '+4 poison damage, 15% poison DoT' },
  { id: 'thundering', name: 'Thundering', weight: 8, effects: [{ type: 'bonus_damage', element: 'lightning', value: 6 }], description: '+6 lightning damage' },
  { id: 'brutal', name: 'Brutal', weight: 12, effects: [{ type: 'crit_bonus', value: 0.05 }], description: '+5% crit chance' },
  { id: 'precise', name: 'Precise', weight: 12, effects: [{ type: 'accuracy_bonus', value: 0.10 }], description: '+10% accuracy' },
  { id: 'furious', name: 'Furious', weight: 8, effects: [{ type: 'damage_mult', value: 0.10 }], description: '+10% damage' },
  { id: 'corrupted', name: 'Corrupted', weight: 6, effects: [{ type: 'bonus_damage', element: 'dark', value: 7 }], description: '+7 dark damage' },
  { id: 'radiant', name: 'Radiant', weight: 6, effects: [{ type: 'bonus_damage', element: 'holy', value: 7 }], description: '+7 holy damage' },
  { id: 'siphoning', name: 'Siphoning', weight: 5, effects: [{ type: 'lifesteal', value: 0.08 }], description: '8% lifesteal on hit' },
];

var RIFT_SCAR_SUFFIXES = [
  { id: 'of_the_bulwark', name: 'of the Bulwark', weight: 10, effects: [{ type: 'armor_bonus', value: 5 }], description: '+5 armor' },
  { id: 'of_haste', name: 'of Haste', weight: 10, effects: [{ type: 'speed_bonus', value: 0.08 }], description: '+8% speed' },
  { id: 'of_draining', name: 'of Draining', weight: 8, effects: [{ type: 'mana_on_hit', value: 3 }], description: '+3 mana on hit' },
  { id: 'of_endurance', name: 'of Endurance', weight: 10, effects: [{ type: 'hp_bonus', value: 15 }], description: '+15 max HP' },
  { id: 'of_resilience', name: 'of Resilience', weight: 8, effects: [{ type: 'magic_resist_bonus', value: 0.05 }], description: '+5% magic resist' },
  { id: 'of_evasion', name: 'of Evasion', weight: 8, effects: [{ type: 'dodge_bonus', value: 0.04 }], description: '+4% dodge' },
  { id: 'of_fortitude', name: 'of Fortitude', weight: 6, effects: [{ type: 'cc_resist', value: 0.10 }], description: '+10% CC resist' },
  { id: 'of_regeneration', name: 'of Regeneration', weight: 6, effects: [{ type: 'hp_regen', value: 2 }], description: '+2 HP regen/turn' },
  { id: 'of_thorns', name: 'of Thorns', weight: 5, effects: [{ type: 'damage_reflect', value: 0.05 }], description: '5% damage reflect' },
  { id: 'of_the_void', name: 'of the Void', weight: 4, effects: [{ type: 'cooldown_reduction', value: 0.10 }], description: '-10% ability cooldowns' },
];

var RIFT_SCAR_TOTAL_PREFIX_WEIGHT = RIFT_SCAR_PREFIXES.reduce(function(sum, s) { return sum + s.weight; }, 0);
var RIFT_SCAR_TOTAL_SUFFIX_WEIGHT = RIFT_SCAR_SUFFIXES.reduce(function(sum, s) { return sum + s.weight; }, 0);

function getRiftScarCount(rarity) {
  if (rarity === 'mythic_rare' || rarity === 'legendary' || rarity === 'godly' || rarity === 'relic') return 2;
  if (rarity === 'rare' || rarity === 'ultra_rare') return 1;
  return 0;
}

function rollRiftScarPrefix() {
  var roll = Math.random() * RIFT_SCAR_TOTAL_PREFIX_WEIGHT;
  var cumulative = 0;
  for (var i = 0; i < RIFT_SCAR_PREFIXES.length; i++) {
    cumulative += RIFT_SCAR_PREFIXES[i].weight;
    if (roll < cumulative) return RIFT_SCAR_PREFIXES[i];
  }
  return RIFT_SCAR_PREFIXES[RIFT_SCAR_PREFIXES.length - 1];
}

function rollRiftScarSuffix() {
  var roll = Math.random() * RIFT_SCAR_TOTAL_SUFFIX_WEIGHT;
  var cumulative = 0;
  for (var i = 0; i < RIFT_SCAR_SUFFIXES.length; i++) {
    cumulative += RIFT_SCAR_SUFFIXES[i].weight;
    if (roll < cumulative) return RIFT_SCAR_SUFFIXES[i];
  }
  return RIFT_SCAR_SUFFIXES[RIFT_SCAR_SUFFIXES.length - 1];
}

function applyRiftScars(card, dungeonDepth) {
  var scarCount = getRiftScarCount(card.rarity);
  if (scarCount <= 0) return card;

  card.riftScars = [];

  if (scarCount >= 1) {
    var prefix = rollRiftScarPrefix();
    card.riftScars.push({ type: 'prefix', id: prefix.id, name: prefix.name, effects: prefix.effects, description: prefix.description });
    card.name = prefix.name + ' ' + card.name;
  }

  if (scarCount >= 2) {
    var suffix = rollRiftScarSuffix();
    card.riftScars.push({ type: 'suffix', id: suffix.id, name: suffix.name, effects: suffix.effects, description: suffix.description });
    card.name = card.name + ' ' + suffix.name;
  }

  if (dungeonDepth && dungeonDepth > 10) {
    var depthBonus = 1 + (Math.floor(dungeonDepth / 10) * 0.01);
    for (var si = 0; si < card.riftScars.length; si++) {
      var scar = card.riftScars[si];
      for (var ei = 0; ei < scar.effects.length; ei++) {
        if (typeof scar.effects[ei].value === 'number') {
          scar.effects[ei].value = parseFloat((scar.effects[ei].value * depthBonus).toFixed(4));
        }
      }
    }
  }

  return card;
}

// ---------------------------------------------------------------------------
// Index builds
// ---------------------------------------------------------------------------

var CARDS_BY_RARITY = {};
var _scalableRarityOrder = ['common', 'uncommon', 'rare', 'ultra_rare'];
for (var ci = 0; ci < CARD_TEMPLATES.length; ci++) {
  var card = CARD_TEMPLATES[ci];
  if (!CARDS_BY_RARITY[card.rarity]) CARDS_BY_RARITY[card.rarity] = [];
  CARDS_BY_RARITY[card.rarity].push(card);
  var _baseRarityIdx = _scalableRarityOrder.indexOf(card.rarity);
  for (var _sri = _baseRarityIdx + 1; _sri < _scalableRarityOrder.length; _sri++) {
    var _scaledRarity = _scalableRarityOrder[_sri];
    if (!CARDS_BY_RARITY[_scaledRarity]) CARDS_BY_RARITY[_scaledRarity] = [];
    CARDS_BY_RARITY[_scaledRarity].push(card);
  }
}

var CARD_BY_ID = {};
for (var cii = 0; cii < CARD_TEMPLATES.length; cii++) {
  CARD_BY_ID[CARD_TEMPLATES[cii].cardId] = CARD_TEMPLATES[cii];
}

// ---------------------------------------------------------------------------
// Evolution config
// ---------------------------------------------------------------------------

var EVOLUTION_CONFIG = {
  // ── Stat boost cards ──
  vigor:     { evoCategory: 'combat',   thresholds: [100, 300, 700], stageEffects: [null, { type: 'stat_boost', stat: 'vigor', value: 1 }, { type: 'stat_boost', stat: 'vigor', value: 1 }, null], paths: { A: { name: 'Fortified',  effects: [{ type: 'stat_boost', stat: 'vigor', value: 2 }, { type: 'hp_regen', value: 1 }] }, B: { name: 'Vigorous',  effects: [{ type: 'stat_boost', stat: 'vigor', value: 3 }] } } },
  might:     { evoCategory: 'combat',   thresholds: [100, 300, 700], stageEffects: [null, { type: 'stat_boost', stat: 'might', value: 1 }, { type: 'stat_boost', stat: 'might', value: 1 }, null], paths: { A: { name: 'Brutal',     effects: [{ type: 'stat_boost', stat: 'might', value: 2 }, { type: 'melee_damage_bonus', value: 0.05 }] }, B: { name: 'Powerful',  effects: [{ type: 'stat_boost', stat: 'might', value: 3 }] } } },
  finesse:   { evoCategory: 'rogue',    thresholds: [100, 300, 700], stageEffects: [null, { type: 'stat_boost', stat: 'finesse', value: 1 }, { type: 'stat_boost', stat: 'finesse', value: 1 }, null], paths: { A: { name: 'Dancer',     effects: [{ type: 'stat_boost', stat: 'finesse', value: 2 }, { type: 'dodge_bonus', value: 0.03 }] }, B: { name: 'Precise',   effects: [{ type: 'stat_boost', stat: 'finesse', value: 2 }, { type: 'crit_bonus', value: 0.03 }] } } },
  acumen:    { evoCategory: 'magic',    thresholds: [100, 300, 700], stageEffects: [null, { type: 'stat_boost', stat: 'acumen', value: 1 }, { type: 'stat_boost', stat: 'acumen', value: 1 }, null], paths: { A: { name: 'Scholar',    effects: [{ type: 'stat_boost', stat: 'acumen', value: 2 }, { type: 'xp_bonus_skill', skill: 'magic', value: 0.10 }] }, B: { name: 'Sage',      effects: [{ type: 'stat_boost', stat: 'acumen', value: 3 }] } } },
  resolve:   { evoCategory: 'utility',  thresholds: [100, 300, 700], stageEffects: [null, { type: 'stat_boost', stat: 'resolve', value: 1 }, { type: 'stat_boost', stat: 'resolve', value: 1 }, null], paths: { A: { name: 'Stalwart',   effects: [{ type: 'stat_boost', stat: 'resolve', value: 2 }, { type: 'magic_resist', value: 0.05 }] }, B: { name: 'Steadfast', effects: [{ type: 'stat_boost', stat: 'resolve', value: 3 }] } } },
  presence:  { evoCategory: 'social',   thresholds: [100, 300, 700], stageEffects: [null, { type: 'stat_boost', stat: 'presence', value: 1 }, { type: 'stat_boost', stat: 'presence', value: 1 }, null], paths: { A: { name: 'Charismatic', effects: [{ type: 'stat_boost', stat: 'presence', value: 2 }, { type: 'sell_price_bonus', value: 0.05 }] }, B: { name: 'Influential', effects: [{ type: 'stat_boost', stat: 'presence', value: 3 }] } } },
  ingenuity: { evoCategory: 'crafting', thresholds: [100, 300, 700], stageEffects: [null, { type: 'stat_boost', stat: 'ingenuity', value: 1 }, { type: 'stat_boost', stat: 'ingenuity', value: 1 }, null], paths: { A: { name: 'Clever',     effects: [{ type: 'stat_boost', stat: 'ingenuity', value: 2 }, { type: 'craft_bonus', value: 0.10 }] }, B: { name: 'Inventive', effects: [{ type: 'stat_boost', stat: 'ingenuity', value: 3 }] } } },
  // ── Skill boost cards ──
  mining_xp:      { evoCategory: 'gathering', thresholds: [100, 300, 700], stageEffects: [null, { type: 'xp_bonus_skill', skill: 'mining', value: 0.05 }, { type: 'xp_bonus_skill', skill: 'mining', value: 0.05 }, null], paths: { A: { name: 'Vein Finder',   effects: [{ type: 'xp_bonus_skill', skill: 'mining', value: 0.10 }, { type: 'double_gather', skill: 'mining', chance: 0.05 }] }, B: { name: 'Ore Master',    effects: [{ type: 'xp_bonus_skill', skill: 'mining', value: 0.15 }] } } },
  woodcutting_xp: { evoCategory: 'gathering', thresholds: [100, 300, 700], stageEffects: [null, { type: 'xp_bonus_skill', skill: 'woodcutting', value: 0.05 }, { type: 'xp_bonus_skill', skill: 'woodcutting', value: 0.05 }, null], paths: { A: { name: 'Forester',      effects: [{ type: 'xp_bonus_skill', skill: 'woodcutting', value: 0.10 }, { type: 'gather_bonus', value: 0.05 }] }, B: { name: 'Lumberjack',   effects: [{ type: 'xp_bonus_skill', skill: 'woodcutting', value: 0.15 }] } } },
  farming_xp:     { evoCategory: 'gathering', thresholds: [100, 300, 700], stageEffects: [null, { type: 'xp_bonus_skill', skill: 'farming', value: 0.05 }, { type: 'xp_bonus_skill', skill: 'farming', value: 0.05 }, null], paths: { A: { name: 'Green Thumb',  effects: [{ type: 'xp_bonus_skill', skill: 'farming', value: 0.10 }, { type: 'rare_resource_chance', value: 0.05 }] }, B: { name: 'Harvester',    effects: [{ type: 'xp_bonus_skill', skill: 'farming', value: 0.15 }] } } },
  fishing_xp:     { evoCategory: 'gathering', thresholds: [100, 300, 700], stageEffects: [null, { type: 'xp_bonus_skill', skill: 'fishing', value: 0.05 }, { type: 'xp_bonus_skill', skill: 'fishing', value: 0.05 }, null], paths: { A: { name: 'Angler',        effects: [{ type: 'xp_bonus_skill', skill: 'fishing', value: 0.10 }, { type: 'rare_resource_chance', value: 0.05 }] }, B: { name: 'Deep Fisher',  effects: [{ type: 'xp_bonus_skill', skill: 'fishing', value: 0.15 }] } } },
  magic_xp:       { evoCategory: 'magic',     thresholds: [100, 300, 700], stageEffects: [null, { type: 'xp_bonus_skill', skill: 'magic', value: 0.05 }, { type: 'xp_bonus_skill', skill: 'magic', value: 0.05 }, null], paths: { A: { name: 'Arcane Student', effects: [{ type: 'xp_bonus_skill', skill: 'magic', value: 0.10 }, { type: 'mana_regen', value: 1 }] }, B: { name: 'Spell Weaver', effects: [{ type: 'xp_bonus_skill', skill: 'magic', value: 0.15 }] } } },
  melee_xp:       { evoCategory: 'combat',    thresholds: [100, 300, 700], stageEffects: [null, { type: 'xp_bonus_skill', skill: 'melee', value: 0.05 }, { type: 'xp_bonus_skill', skill: 'melee', value: 0.05 }, null], paths: { A: { name: 'Duelist',       effects: [{ type: 'xp_bonus_skill', skill: 'melee', value: 0.10 }, { type: 'crit_bonus', value: 0.02 }] }, B: { name: 'Warrior',      effects: [{ type: 'xp_bonus_skill', skill: 'melee', value: 0.15 }] } } },
  cooking_xp:     { evoCategory: 'crafting',  thresholds: [100, 300, 700], stageEffects: [null, { type: 'xp_bonus_skill', skill: 'cooking', value: 0.05 }, { type: 'xp_bonus_skill', skill: 'cooking', value: 0.05 }, null], paths: { A: { name: 'Chef',          effects: [{ type: 'xp_bonus_skill', skill: 'cooking', value: 0.10 }, { type: 'potion_effectiveness', value: 0.10 }] }, B: { name: 'Master Cook',  effects: [{ type: 'xp_bonus_skill', skill: 'cooking', value: 0.15 }] } } },
  cogworking_xp:  { evoCategory: 'crafting',  thresholds: [100, 300, 700], stageEffects: [null, { type: 'xp_bonus_skill', skill: 'cogworking', value: 0.05 }, { type: 'xp_bonus_skill', skill: 'cogworking', value: 0.05 }, null], paths: { A: { name: 'Tinkerer',      effects: [{ type: 'xp_bonus_skill', skill: 'cogworking', value: 0.10 }, { type: 'craft_bonus', value: 0.05 }] }, B: { name: 'Cogmaster',    effects: [{ type: 'xp_bonus_skill', skill: 'cogworking', value: 0.15 }] } } },
  alchemy_xp:     { evoCategory: 'crafting',  thresholds: [100, 300, 700], stageEffects: [null, { type: 'xp_bonus_skill', skill: 'alchemy', value: 0.05 }, { type: 'xp_bonus_skill', skill: 'alchemy', value: 0.05 }, null], paths: { A: { name: 'Alchemist',     effects: [{ type: 'xp_bonus_skill', skill: 'alchemy', value: 0.10 }, { type: 'potion_effectiveness', value: 0.15 }] }, B: { name: 'Grand Alchemist', effects: [{ type: 'xp_bonus_skill', skill: 'alchemy', value: 0.15 }] } } },
  crafting_xp:    { evoCategory: 'crafting',  thresholds: [100, 300, 700], stageEffects: [null, { type: 'xp_bonus_skill', skill: 'crafting', value: 0.05 }, { type: 'xp_bonus_skill', skill: 'crafting', value: 0.05 }, null], paths: { A: { name: 'Artisan',       effects: [{ type: 'xp_bonus_skill', skill: 'crafting', value: 0.10 }, { type: 'craft_quality_bonus', value: 0.10 }] }, B: { name: 'Master Crafter', effects: [{ type: 'xp_bonus_skill', skill: 'crafting', value: 0.15 }] } } },
  // ── Passive perk cards ──
  hp_regen:     { evoCategory: 'combat',   thresholds: [100, 300, 700], stageEffects: [null, { type: 'hp_regen', value: 1 }, { type: 'hp_regen', value: 1 }, null], paths: { A: { name: 'Regenerative', effects: [{ type: 'hp_regen', value: 2 }, { type: 'hp_bonus', value: 10 }] }, B: { name: 'Vital Surge',    effects: [{ type: 'hp_regen', value: 3 }] } } },
  speed_boost:  { evoCategory: 'rogue',    thresholds: [100, 300, 700], stageEffects: [null, { type: 'speed_bonus', value: 0.03 }, { type: 'speed_bonus', value: 0.02 }, null], paths: { A: { name: 'Swift',         effects: [{ type: 'speed_bonus', value: 0.05 }, { type: 'dodge_bonus', value: 0.03 }] }, B: { name: 'Blinding Speed', effects: [{ type: 'speed_bonus', value: 0.08 }] } } },
  crit_boost:   { evoCategory: 'combat',   thresholds: [100, 300, 700], stageEffects: [null, { type: 'crit_bonus', value: 0.02 }, { type: 'crit_bonus', value: 0.02 }, null], paths: { A: { name: 'Keen Eye',      effects: [{ type: 'crit_bonus', value: 0.03 }, { type: 'melee_damage_bonus', value: 0.05 }] }, B: { name: 'Lethal Strikes', effects: [{ type: 'crit_bonus', value: 0.05 }] } } },
  dodge_boost:  { evoCategory: 'rogue',    thresholds: [100, 300, 700], stageEffects: [null, { type: 'dodge_bonus', value: 0.02 }, { type: 'dodge_bonus', value: 0.02 }, null], paths: { A: { name: 'Elusive',       effects: [{ type: 'dodge_bonus', value: 0.03 }, { type: 'speed_bonus', value: 0.03 }] }, B: { name: 'Phantom',        effects: [{ type: 'dodge_bonus', value: 0.05 }] } } },
  magic_resist: { evoCategory: 'magic',    thresholds: [100, 300, 700], stageEffects: [null, { type: 'magic_resist', value: 0.03 }, { type: 'magic_resist', value: 0.02 }, null], paths: { A: { name: 'Arcane Shell',  effects: [{ type: 'magic_resist', value: 0.05 }, { type: 'stat_boost', stat: 'resolve', value: 1 }] }, B: { name: 'Null Ward',      effects: [{ type: 'magic_resist', value: 0.08 }] } } },
  carry_weight: { evoCategory: 'utility',  thresholds: [100, 300, 700], stageEffects: [null, { type: 'carry_weight', value: 10 }, { type: 'carry_weight', value: 10 }, null], paths: { A: { name: 'Pack Mule',     effects: [{ type: 'carry_weight', value: 20 }, { type: 'gather_bonus', value: 0.05 }] }, B: { name: 'Heavy Lifter',   effects: [{ type: 'carry_weight', value: 30 }] } } },
  fortune:      { evoCategory: 'utility',  thresholds: [100, 300, 700], stageEffects: [null, { type: 'luck_bonus', value: 0.05 }, { type: 'luck_bonus', value: 0.05 }, null], paths: { A: { name: "Fate's Chosen", effects: [{ type: 'luck_bonus', value: 0.10 }, { type: 'crit_bonus', value: 0.03 }, { type: 'loot_bonus', value: 0.05 }] }, B: { name: 'Lucky Star',     effects: [{ type: 'luck_bonus', value: 0.15 }, { type: 'card_luck_bonus', value: 0.05 }] } } },
  mana_shield:  { evoCategory: 'magic',    thresholds: [100, 300, 700], stageEffects: [null, { type: 'mana_shield', value: 0.08 }, { type: 'mana_shield', value: 0.07 }, null], paths: { A: { name: 'Arcane Bulwark', effects: [{ type: 'mana_shield', value: 0.10 }, { type: 'mana_regen', value: 1 }] }, B: { name: 'Fortress Mind',  effects: [{ type: 'mana_shield', value: 0.15 }] } } },
  poison_aura:  { evoCategory: 'combat',   thresholds: [100, 300, 700], stageEffects: [null, { type: 'poison_aura', value: 1 }, { type: 'poison_aura', value: 1 }, null], paths: { A: { name: 'Noxious',       effects: [{ type: 'poison_aura', value: 2 }, { type: 'steal_chance', value: 0.03 }] }, B: { name: 'Plague Bearer',  effects: [{ type: 'poison_aura', value: 3 }] } } },
  potion_potency: { evoCategory: 'crafting', thresholds: [100, 300, 700], stageEffects: [null, { type: 'potion_effectiveness', value: 0.10 }, { type: 'potion_effectiveness', value: 0.10 }, null], paths: { A: { name: 'Master Brewer',   effects: [{ type: 'potion_effectiveness', value: 0.20 }, { type: 'potion_duration_bonus', value: 0.20 }] }, B: { name: 'Grand Alchemist', effects: [{ type: 'potion_effectiveness', value: 0.30 }] } } },
  // ── Merged skill XP cards ──
  dungeon_exploration_xp: { evoCategory: 'dungeon', thresholds: [100, 300, 700], stageEffects: [null, { type: 'xp_bonus_skill', skill: 'dungeon_exploration', value: 0.05 }, { type: 'xp_bonus_skill', skill: 'dungeon_exploration', value: 0.05 }, null], paths: { A: { name: 'Explorer',  effects: [{ type: 'xp_bonus_skill', skill: 'dungeon_exploration', value: 0.10 }, { type: 'dungeon_reveal_bonus', value: 0.20 }] }, B: { name: 'Delver',    effects: [{ type: 'xp_bonus_skill', skill: 'dungeon_exploration', value: 0.10 }, { type: 'loot_bonus', value: 0.05 }] } } },
  // ── Profession base cards ──
  alchemy_arts:    { evoCategory: 'crafting', thresholds: [100, 300, 700], stageEffects: [null, { type: 'potion_effectiveness', value: 0.05 }, { type: 'potion_effectiveness', value: 0.05 }, null], paths: { A: { name: 'Grand Alchemist', effects: [{ type: 'potion_effectiveness', value: 0.20 }, { type: 'potion_duration_bonus', value: 0.20 }] }, B: { name: 'Transmuter',       effects: [{ type: 'xp_bonus_skill', skill: 'transmutation', value: 0.20 }, { type: 'ingredientSaveChance', value: 0.15 }] } } },
  engineers_eye:   { evoCategory: 'crafting', thresholds: [100, 300, 700], stageEffects: [null, { type: 'craft_bonus', value: 0.05 }, { type: 'craft_bonus', value: 0.05 }, null], paths: { A: { name: 'Master Engineer',  effects: [{ type: 'craft_bonus', value: 0.15 }, { type: 'summon_damage_bonus', value: 0.20 }, { type: 'summon_hp_bonus', value: 0.20 }] }, B: { name: 'Glasswright',       effects: [{ type: 'xp_bonus_skill', skill: 'glassworking', value: 0.20 }, { type: 'craft_quality_bonus', value: 0.15 }] } } },
  artisan_craft:   { evoCategory: 'crafting', thresholds: [100, 300, 700], stageEffects: [null, { type: 'craft_quality_bonus', value: 0.05 }, { type: 'craft_quality_bonus', value: 0.05 }, null], paths: { A: { name: 'Master Artisan',   effects: [{ type: 'craft_quality_bonus', value: 0.20 }, { type: 'ingredientSaveChance', value: 0.15 }] }, B: { name: 'Versatile Crafter', effects: [{ type: 'xp_bonus_skill', skill: 'crafting', value: 0.15 }, { type: 'xp_bonus_skill', skill: 'leatherworking', value: 0.10 }, { type: 'xp_bonus_skill', skill: 'carpentry', value: 0.10 }] } } },
  jewelers_touch:  { evoCategory: 'crafting', thresholds: [100, 300, 700], stageEffects: [null, { type: 'gem_yield_bonus', value: 0.05 }, { type: 'gem_yield_bonus', value: 0.05 }, null], paths: { A: { name: 'Gem Master',       effects: [{ type: 'gem_yield_bonus', value: 0.20 }, { type: 'craft_quality_bonus', value: 0.15 }] }, B: { name: 'Legendary Jeweler', effects: [{ type: 'gem_yield_bonus', value: 0.30 }, { type: 'xp_bonus_skill', skill: 'jewelcrafting', value: 0.15 }] } } },
  enchanters_mark: { evoCategory: 'magic',    thresholds: [100, 300, 700], stageEffects: [null, { type: 'enchant_power_bonus', value: 0.05 }, { type: 'enchant_power_bonus', value: 0.05 }, null], paths: { A: { name: 'Arcane Inscriber', effects: [{ type: 'enchant_power_bonus', value: 0.20 }, { type: 'mana_regen', value: 2 }] }, B: { name: 'Sigil Master',      effects: [{ type: 'enchant_power_bonus', value: 0.15 }, { type: 'xp_bonus_skill', skill: 'sigil_scripting', value: 0.20 }] } } },
};

// Apply evolution config to matching card templates
for (var _evoKey in EVOLUTION_CONFIG) {
  if (CARD_BY_ID[_evoKey]) {
    var _evoCfg = EVOLUTION_CONFIG[_evoKey];
    CARD_BY_ID[_evoKey].evoCategory = _evoCfg.evoCategory;
    CARD_BY_ID[_evoKey].evolutionThresholds = _evoCfg.thresholds;
    CARD_BY_ID[_evoKey].evolutionStageEffects = _evoCfg.stageEffects;
    CARD_BY_ID[_evoKey].evolutionPaths = _evoCfg.paths;
  }
}

// Wire card-affixes with refs it needs from this module
cardAffixes.init({ CARD_BY_ID: CARD_BY_ID, RARITY_SCALE: RARITY_SCALE, _scaleNumeric: _scaleNumeric });

// ---------------------------------------------------------------------------
// Pack constants & styles
// ---------------------------------------------------------------------------

var CARDS_PER_PACK_MIN = 6;
var CARDS_PER_PACK_MAX = 6;
var MAX_ACTIVE_CARD_SLOTS = 4;
var MAX_PASSIVE_CARD_SLOTS = 3;
var MAX_EQUIPPED_CARDS = MAX_ACTIVE_CARD_SLOTS + MAX_PASSIVE_CARD_SLOTS;
var MAX_CARD_COLLECTION = 1000;
var MAX_FUSION_COUNT = 2;

var CARD_STYLES = {
  normal: { id: 'normal', name: 'Normal', chance: 0.80, borderEffect: null },
  holographic: { id: 'holographic', name: 'Holographic', chance: 0.12, borderEffect: 'rainbow_shimmer' },
  golden: { id: 'golden', name: 'Golden', chance: 0.05, borderEffect: 'gold_glow' },
  prismatic: { id: 'prismatic', name: 'Prismatic', chance: 0.025, borderEffect: 'prismatic_shift' },
  void: { id: 'void', name: 'Void Edition', chance: 0.005, borderEffect: 'void_particles' },
};

var _globalSerialCounter = 0;
function generateSerial() {
  _globalSerialCounter++;
  return 'SN-' + String(_globalSerialCounter).padStart(6, '0');
}

function rollCardStyle() {
  var roll = Math.random();
  var cumulative = 0;
  var styles = Object.values(CARD_STYLES);
  for (var i = 0; i < styles.length; i++) {
    cumulative += styles[i].chance;
    if (roll < cumulative) return styles[i];
  }
  return CARD_STYLES.normal;
}

var SKILL_BIOME_BONUS = {
  farming: { preferred: ['PLAINS', 'HOLY_DOMINION', 'ELVEN_SOUTH'], bonus: 0.25 },
  fishing: { preferred: ['BEACH', 'SWAMP'], bonus: 0.25, nearWater: true },
  glassworking: { preferred: ['SCORCHED_SANDS', 'WASTES'], bonus: 0.25 },
  cogworking: { preferred: ['CLOCKWORK_HARBOR', 'GNOMISH_ISLES', 'MECHSPIRE'], bonus: 0.25 },
  magic: { preferred: ['ELVEN_SOUTH', 'HOLY_DOMINION', 'SWAMP'], bonus: 0.20 },
  mining: { preferred: ['MOUNTAIN', 'WASTES'], bonus: 0.15 },
  woodcutting: { preferred: ['FOREST', 'ELVEN_SOUTH'], bonus: 0.15 },
};

var WATER_MOUNTS = new Set(['raft', 'boat', 'ship', 'sea_mount', 'airship', 'flying_mount']);

// ---------------------------------------------------------------------------
// Card generation
// ---------------------------------------------------------------------------

function _scaleNumeric(val, factor) {
  return Math.round(val * factor * 1000) / 1000;
}

function generateCardInstance(template, source, rolledRarity) {
  var style = rollCardStyle();
  var effectiveRarity = rolledRarity || template.rarity;
  var baseEffects = JSON.parse(JSON.stringify(template.effects));
  var combatPassive = template.combatPassive ? JSON.parse(JSON.stringify(template.combatPassive)) : undefined;

  if (rolledRarity && rolledRarity !== template.rarity) {
    var _baseFactor = RARITY_SCALE[template.rarity] || 1.0;
    var _targetFactor = RARITY_SCALE[rolledRarity] || 1.0;
    var _sf = _targetFactor / _baseFactor;
    if (_sf > 1.0) {
      for (var _ei = 0; _ei < baseEffects.length; _ei++) {
        if (typeof baseEffects[_ei].value === 'number') baseEffects[_ei].value = _scaleNumeric(baseEffects[_ei].value, _sf);
        if (typeof baseEffects[_ei].base === 'number') baseEffects[_ei].base = _scaleNumeric(baseEffects[_ei].base, _sf);
      }
      if (combatPassive && typeof combatPassive.value === 'number') combatPassive.value = _scaleNumeric(combatPassive.value, _sf);
    }
  }

  if (style.id === 'void') {
    for (var _vi = 0; _vi < baseEffects.length; _vi++) {
      if (typeof baseEffects[_vi].value === 'number') baseEffects[_vi].value = Math.round(baseEffects[_vi].value * 1.10 * 100) / 100;
      if (typeof baseEffects[_vi].base === 'number') baseEffects[_vi].base = Math.round(baseEffects[_vi].base * 1.10);
    }
    if (combatPassive && typeof combatPassive.value === 'number') combatPassive.value = Math.round(combatPassive.value * 1.10 * 100) / 100;
  }

  var _rarityLabel = { uncommon: 'II', rare: 'III', ultra_rare: 'IV' };
  var displayName = (rolledRarity && rolledRarity !== template.rarity && _rarityLabel[rolledRarity])
    ? template.name + ' ' + _rarityLabel[rolledRarity]
    : template.name;

  var rolledAffixes = rollCardAffixes(template, effectiveRarity);

  var passiveRider = null;
  var riderChance = PASSIVE_RIDER_CHANCE[effectiveRarity] || 0;
  if (template.type === 'active_ability' && riderChance > 0 && Math.random() < riderChance) {
    var rider = rollPassiveRider(effectiveRarity);
    if (rider) {
      passiveRider = { id: rider.id, label: rider.label, tier: rider.tier };
    }
  }

  var _pfx = getAffixNamePrefix(rolledAffixes);
  var _sfx = passiveRider ? passiveRider.label : getAffixNameSuffix(rolledAffixes);
  if (_pfx) displayName = _pfx + ' ' + displayName;
  if (_sfx) displayName = displayName + ' ' + _sfx;

  var newCard = {
    instanceId: crypto.randomBytes(8).toString('hex'),
    cardId: template.cardId,
    name: displayName,
    type: template.type,
    rarity: effectiveRarity,
    _baseEffects: JSON.parse(JSON.stringify(baseEffects)),
    effects: [],
    affixes: rolledAffixes,
    passiveRider: passiveRider || undefined,
    combos: [],
    icon: template.icon,
    fusionCount: 0,
    fusionLineage: [],
    obtainedAt: Date.now(),
    source: source || 'level_pack',
    style: style.id,
    borderEffect: style.borderEffect,
    serial: generateSerial(),
    evolutionStage: 0,
    evolutionXp: 0,
    evolutionPath: null,
    evolutionBonusLevel: 0,
  };
  if (combatPassive) newCard.combatPassive = combatPassive;

  refreshCardEffects(newCard);
  return newCard;
}

function openCardPack(raceId, pityPullsSinceLegendary, luckBonus) {
  var isCatFolk = (raceId === 'catfolk');
  var totalLuck = (typeof luckBonus === 'number' && luckBonus > 0) ? luckBonus : 0;
  var pity = { pullsSinceLegendary: (typeof pityPullsSinceLegendary === 'number' ? pityPullsSinceLegendary : 0) };
  var cardCount = CARDS_PER_PACK_MIN + Math.floor(Math.random() * (CARDS_PER_PACK_MAX - CARDS_PER_PACK_MIN + 1));
  var cards = [];
  for (var i = 0; i < cardCount; i++) {
    var rarity = rollRarity(isCatFolk, pity);

    if (totalLuck > 0 && rarity.order < RARITY_TIERS.length - 1) {
      if (Math.random() < totalLuck) {
        rarity = RARITY_TIERS[rarity.order + 1];
      }
    }

    var pool = CARDS_BY_RARITY[rarity.id];
    if (!pool || pool.length === 0) pool = CARDS_BY_RARITY['common'];

    var filteredPool = [];
    for (var j = 0; j < pool.length; j++) {
      if (!pool[j].raceLocked || pool[j].raceLocked === raceId) {
        filteredPool.push(pool[j]);
      }
    }
    if (filteredPool.length === 0) filteredPool = pool;

    var selectedPool = filteredPool;
    if (raceId === 'elf' && Math.random() < 0.40) {
      var magicPool = filteredPool.filter(function(c) { return c.tags && c.tags.indexOf('magic') >= 0; });
      if (magicPool.length > 0) selectedPool = magicPool;
    } else if (raceId === 'goblin' && Math.random() < 0.35) {
      var stealthPool = filteredPool.filter(function(c) { return c.tags && c.tags.indexOf('stealth') >= 0; });
      if (stealthPool.length > 0) selectedPool = stealthPool;
    } else if (raceId === 'catfolk' && Math.random() < 0.40) {
      var luckPool = filteredPool.filter(function(c) { return c.tags && c.tags.indexOf('luck') >= 0; });
      if (luckPool.length > 0) selectedPool = luckPool;
    } else if (raceId === 'lizardfolk' && Math.random() < 0.25) {
      var ritualPool = filteredPool.filter(function(c) { return c.tags && c.tags.indexOf('ritual') >= 0; });
      if (ritualPool.length > 0) selectedPool = ritualPool;
    }

    var template = selectedPool[Math.floor(Math.random() * selectedPool.length)];
    cards.push(generateCardInstance(template, 'level_pack', rarity.id));
  }
  return { cards: cards, pityPullsSinceLegendary: pity.pullsSinceLegendary };
}

// ---------------------------------------------------------------------------
// Gacha rate disclosure
// ---------------------------------------------------------------------------

var RACE_POOL_BIAS = {
  elf:        { pool: 'magic',   chance: 0.40 },
  goblin:     { pool: 'stealth', chance: 0.35 },
  catfolk:    { pool: 'luck',    chance: 0.40 },
  lizardfolk: { pool: 'ritual',  chance: 0.25 },
};

var CATFOLK_RARITY_BUMP = 0.12;

function computeEffectiveGachaRates(raceId, pullsSinceLegendary, luckBonus) {
  var isCatFolk = (raceId === 'catfolk');
  var totalLuck = (typeof luckBonus === 'number' && luckBonus > 0) ? luckBonus : 0;
  var pity = typeof pullsSinceLegendary === 'number' ? pullsSinceLegendary : 0;

  var tierCount = RARITY_TIERS.length;

  var baseProbs = [];
  for (var i = 0; i < tierCount; i++) {
    baseProbs[i] = RARITY_TIERS[i].weight / TOTAL_RARITY_WEIGHT;
  }

  var baseRatesOut = {};
  for (var b = 0; b < tierCount; b++) {
    baseRatesOut[RARITY_TIERS[b].id] = baseProbs[b];
  }

  var probs = [];
  for (var c = 0; c < tierCount; c++) {
    probs[c] = baseProbs[c];
  }

  var hardPityActive = (pity >= HARD_PITY);
  if (hardPityActive) {
    for (var h = 0; h < tierCount; h++) {
      probs[h] = 0;
    }
    probs[5] = 1.0;
  }

  var softPityBoost = 0;
  if (!hardPityActive && pity > SOFT_PITY_START) {
    softPityBoost = (pity + 1 - SOFT_PITY_START) * SOFT_PITY_RATE;
    if (softPityBoost > 1) softPityBoost = 1;

    var massRedirected = 0;
    for (var s = 0; s < 5; s++) {
      var redirected = probs[s] * softPityBoost;
      probs[s] -= redirected;
      massRedirected += redirected;
    }
    probs[5] += massRedirected;
  }

  if (isCatFolk && !hardPityActive) {
    var afterCatfolk = [];
    for (var cf = 0; cf < tierCount; cf++) {
      afterCatfolk[cf] = 0;
    }
    for (var t = 0; t < tierCount; t++) {
      if (t < tierCount - 1) {
        afterCatfolk[t] += probs[t] * (1 - CATFOLK_RARITY_BUMP);
        afterCatfolk[t + 1] += probs[t] * CATFOLK_RARITY_BUMP;
      } else {
        afterCatfolk[t] += probs[t];
      }
    }
    probs = afterCatfolk;
  }

  if (totalLuck > 0 && !hardPityActive) {
    var cappedLuck = totalLuck > 1 ? 1 : totalLuck;
    var afterLuck = [];
    for (var al = 0; al < tierCount; al++) {
      afterLuck[al] = 0;
    }
    for (var l = 0; l < tierCount; l++) {
      if (l < tierCount - 1) {
        afterLuck[l] += probs[l] * (1 - cappedLuck);
        afterLuck[l + 1] += probs[l] * cappedLuck;
      } else {
        afterLuck[l] += probs[l];
      }
    }
    probs = afterLuck;
  }

  var effectiveRates = {};
  for (var e = 0; e < tierCount; e++) {
    effectiveRates[RARITY_TIERS[e].id] = Math.round(probs[e] * 1000000) / 1000000;
  }

  var raceModifiers = {
    poolBias: RACE_POOL_BIAS[raceId] || null,
    rarityBump: isCatFolk ? CATFOLK_RARITY_BUMP : 0,
  };

  var pityInfo = {
    pullsSinceLegendary: pity,
    softPityStart: SOFT_PITY_START,
    hardPity: HARD_PITY,
    softPityRate: SOFT_PITY_RATE,
    softPityActive: pity > SOFT_PITY_START,
    hardPityActive: hardPityActive,
    currentBoost: softPityBoost,
  };

  var packInfo = {
    cardsPerPack: CARDS_PER_PACK_MIN === CARDS_PER_PACK_MAX
      ? String(CARDS_PER_PACK_MIN)
      : (CARDS_PER_PACK_MIN + '-' + CARDS_PER_PACK_MAX),
    guarantees: 'Guaranteed Legendary at ' + HARD_PITY + ' pulls without one',
  };

  return {
    baseRates: baseRatesOut,
    effectiveRates: effectiveRates,
    raceModifiers: raceModifiers,
    pityInfo: pityInfo,
    packInfo: packInfo,
  };
}

module.exports = {
  CARD_TYPES: CARD_TYPES,
  CARD_TEMPLATES: CARD_TEMPLATES,
  CARDS_BY_RARITY: CARDS_BY_RARITY,
  CARD_BY_ID: CARD_BY_ID,
  EVOLUTION_CONFIG: EVOLUTION_CONFIG,
  RIFT_SCAR_PREFIXES: RIFT_SCAR_PREFIXES,
  RIFT_SCAR_SUFFIXES: RIFT_SCAR_SUFFIXES,
  getRiftScarCount: getRiftScarCount,
  rollRiftScarPrefix: rollRiftScarPrefix,
  rollRiftScarSuffix: rollRiftScarSuffix,
  applyRiftScars: applyRiftScars,
  CARDS_PER_PACK_MIN: CARDS_PER_PACK_MIN,
  CARDS_PER_PACK_MAX: CARDS_PER_PACK_MAX,
  MAX_ACTIVE_CARD_SLOTS: MAX_ACTIVE_CARD_SLOTS,
  MAX_PASSIVE_CARD_SLOTS: MAX_PASSIVE_CARD_SLOTS,
  MAX_EQUIPPED_CARDS: MAX_EQUIPPED_CARDS,
  MAX_CARD_COLLECTION: MAX_CARD_COLLECTION,
  MAX_FUSION_COUNT: MAX_FUSION_COUNT,
  CARD_STYLES: CARD_STYLES,
  generateSerial: generateSerial,
  rollCardStyle: rollCardStyle,
  SKILL_BIOME_BONUS: SKILL_BIOME_BONUS,
  WATER_MOUNTS: WATER_MOUNTS,
  _scaleNumeric: _scaleNumeric,
  generateCardInstance: generateCardInstance,
  openCardPack: openCardPack,
  RACE_POOL_BIAS: RACE_POOL_BIAS,
  CATFOLK_RARITY_BUMP: CATFOLK_RARITY_BUMP,
  computeEffectiveGachaRates: computeEffectiveGachaRates,
};
