// card-pools.js
// Card pool system: rarity tiers, card templates, gacha mechanics,
// mutations, curses, affixes, combos, rift scars, and fusion logic.

var crypto = require('crypto');

const RARITY_TIERS = [
  { id: 'common',      name: 'Common',      weight: 4500, color: '#888888', order: 0 },
  { id: 'uncommon',    name: 'Uncommon',     weight: 2500, color: '#22cc22', order: 1 },
  { id: 'rare',        name: 'Rare',         weight: 1500, color: '#3388ff', order: 2 },
  { id: 'ultra_rare',  name: 'Ultra Rare',   weight: 800,  color: '#aa44ff', order: 3 },
  { id: 'mythic_rare', name: 'Mythic Rare',  weight: 400,  color: '#ffaa00', order: 4 },
  { id: 'legendary',   name: 'Legendary',    weight: 200,  color: '#ff6600', order: 5 },
  { id: 'godly',       name: 'Godly',        weight: 80,   color: '#ff0000', order: 6 },
  { id: 'relic',       name: 'Relic',        weight: 20,   color: '#ffffff', order: 7 },
];

const RARITY_BY_ID = {};
for (var ri = 0; ri < RARITY_TIERS.length; ri++) {
  RARITY_BY_ID[RARITY_TIERS[ri].id] = RARITY_TIERS[ri];
}

var TOTAL_RARITY_WEIGHT = 0;
for (var rw = 0; rw < RARITY_TIERS.length; rw++) {
  TOTAL_RARITY_WEIGHT += RARITY_TIERS[rw].weight;
}

// ---------------------------------------------------------------------------
// Rarity Scale Multipliers
// ---------------------------------------------------------------------------
// For cards marked rarityScalable: true, numeric effect values are multiplied
// by RARITY_SCALE[rolledRarity] / RARITY_SCALE[templateRarity] at generation.
// This replaces the old pattern of having separate _I/_II/_III card entries.
// The card's template rarity is its MINIMUM drop tier; higher rolls scale it up.
var RARITY_SCALE = {
  common:     1.0,
  uncommon:   2.0,
  rare:       4.0,
  ultra_rare: 7.0,
  mythic_rare: 7.0,  // scalable cards normally cap at ultra_rare
  legendary:  7.0,
  godly:      7.0,
  relic:      7.0,
};

// Pity counter constants
var SOFT_PITY_START = 80;   // Start increasing Legendary+ rates at 80 pulls
var HARD_PITY = 120;        // Guaranteed Legendary at 120 pulls
var SOFT_PITY_RATE = 0.02;  // +2% Legendary chance per pull beyond soft pity

function rollRarity(isCatFolk, pity) {
  pity.pullsSinceLegendary++;

  // Hard pity: guaranteed Legendary at 120 pulls
  if (pity.pullsSinceLegendary >= HARD_PITY) {
    pity.pullsSinceLegendary = 0;
    return RARITY_TIERS[5]; // legendary
  }

  var roll = Math.random() * TOTAL_RARITY_WEIGHT;
  var cumulative = 0;
  var result = RARITY_TIERS[0];

  // Soft pity: boost Legendary+ chance after 80 pulls
  var pityBoost = 0;
  if (pity.pullsSinceLegendary > SOFT_PITY_START) {
    pityBoost = (pity.pullsSinceLegendary - SOFT_PITY_START) * SOFT_PITY_RATE;
  }

  for (var i = 0; i < RARITY_TIERS.length; i++) {
    cumulative += RARITY_TIERS[i].weight;
    if (roll < cumulative) {
      result = RARITY_TIERS[i];
      break;
    }
  }

  // Apply soft pity: chance to bump to Legendary
  if (pityBoost > 0 && result.order < 5) {
    if (Math.random() < pityBoost) {
      result = RARITY_TIERS[5]; // legendary
    }
  }

  // Cat Folk bonus: 12% chance to bump rarity up one tier (reduced from 20%)
  if (isCatFolk && result.order < RARITY_TIERS.length - 1) {
    if (Math.random() < 0.12) {
      result = RARITY_TIERS[result.order + 1];
    }
  }

  // Reset pity on Legendary or higher
  if (result.order >= 5) {
    pity.pullsSinceLegendary = 0;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Card Types
// ---------------------------------------------------------------------------

const CARD_TYPES = {
  stat_boost: 'stat_boost',
  skill_boost: 'skill_boost',
  passive_perk: 'passive_perk',
  active_ability: 'active_ability',
  racial_feat: 'racial_feat',
  gathering_boost: 'gathering_boost',
  equipment_modifier: 'equipment_modifier',
  reactive: 'reactive',
};

// ---------------------------------------------------------------------------
// Card Template Database (~50 initial cards)
// ---------------------------------------------------------------------------

const CARD_TEMPLATES = [
  // ── Stat Boost Cards (Common-Rare) ──
  { cardId: 'vigor', name: '+1 Vigor', type: 'stat_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'stat_boost', stat: 'vigor', value: 1 }], icon: 'skills/Enchantment/' },
  { cardId: 'might', name: '+1 Might', type: 'stat_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'stat_boost', stat: 'might', value: 1 }], icon: 'skills/Enchantment/' },
  { cardId: 'finesse', name: '+1 Finesse', type: 'stat_boost', rarity: 'common', archetype: 'tactician', tags: ['stealth'], effects: [{ type: 'stat_boost', stat: 'finesse', value: 1 }], icon: 'skills/Enchantment/' },
  { cardId: 'acumen', name: '+1 Acumen', type: 'stat_boost', rarity: 'common', archetype: 'tactician', tags: ['magic'], effects: [{ type: 'stat_boost', stat: 'acumen', value: 1 }], icon: 'skills/Enchantment/' },
  { cardId: 'resolve', name: '+1 Resolve', type: 'stat_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'stat_boost', stat: 'resolve', value: 1 }], icon: 'skills/Enchantment/' },
  { cardId: 'presence', name: '+1 Presence', type: 'stat_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'stat_boost', stat: 'presence', value: 1 }], icon: 'skills/Enchantment/' },
  { cardId: 'ingenuity', name: '+1 Ingenuity', type: 'stat_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'stat_boost', stat: 'ingenuity', value: 1 }], icon: 'skills/Enchantment/' },

  // ── Skill Boost Cards ──
  { cardId: 'mining_xp', name: '+10% Mining XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'mining', value: 0.10 }], icon: 'skills/Blacksmith/' },
  { cardId: 'woodcutting_xp', name: '+10% Woodcutting XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'woodcutting', value: 0.10 }], icon: 'skills/Blacksmith/' },
  { cardId: 'farming_xp', name: '+10% Farming XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'farming', value: 0.10 }], icon: 'skills/Herbalism/' },
  { cardId: 'fishing_xp', name: '+10% Fishing XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'fishing', value: 0.10 }], icon: 'skills/Cooking_fishing/' },
  { cardId: 'magic_xp', name: '+10% Magic XP', type: 'skill_boost', rarity: 'uncommon', archetype: 'tactician', tags: ['magic'], effects: [{ type: 'xp_bonus_skill', skill: 'magic', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'melee_xp', name: '+10% Melee XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'melee', value: 0.10 }], icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'cooking_xp', name: '+10% Cooking XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'cooking', value: 0.10 }], icon: 'skills/Cooking_fishing/' },
  { cardId: 'cogworking_xp', name: '+10% Cogworking XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'cogworking', value: 0.10 }], icon: 'skills/Engineering/' },

  // ── Passive Perk Cards ──
  { cardId: 'hp_regen', name: 'HP Regen +1/s', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior', effects: [{ type: 'hp_regen', value: 3 }], icon: 'skills/Enchantment/', combatPassive: { type: 'hp_regen', value: 3 } },
  { cardId: 'poison_immune', name: 'Poison Immunity', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior', effects: [{ type: 'immunity', element: 'poison' }], icon: 'skills/Enchantment/', combatPassive: { type: 'immunity', element: 'poison' } },
  { cardId: 'speed_boost', name: '+5% Movement Speed', type: 'passive_perk', rarity: 'common', archetype: 'rogue', tags: ['stealth'], effects: [{ type: 'speed_bonus', value: 0.05 }], icon: 'skills/Enchantment/' },
  { cardId: 'crit_boost', name: '+3% Crit Chance', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior', tags: ['stealth', 'luck'], effects: [{ type: 'crit_bonus', value: 0.03 }], icon: 'skills/Enchantment/' },
  { cardId: 'dodge_boost', name: '+3% Dodge', type: 'passive_perk', rarity: 'uncommon', archetype: 'rogue', tags: ['stealth', 'luck'], effects: [{ type: 'dodge_bonus', value: 0.03 }], icon: 'skills/Enchantment/' },
  { cardId: 'magic_resist', name: '+5% Magic Resist', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior', rarityScalable: true, tags: ['magic'], effects: [{ type: 'magic_resist', value: 0.05 }], icon: 'skills/Enchantment/' },
  { cardId: 'carry_weight', name: '+20 Carry Weight', type: 'passive_perk', rarity: 'common', archetype: 'tactician', rarityScalable: true, effects: [{ type: 'carry_weight', value: 20 }], icon: 'skills/Blacksmith/' },

  // ── Active Ability Cards ──
  { cardId: 'fireball_I', name: 'Fireball I', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['tactician'], tags: ['magic'], effects: [{ type: 'damage', element: 'fire', base: 25, scaling: 'acumen', factor: 0.5, cooldown: 30 }], icon: 'skills/Skill_Explosion.PNG', combatType: 'damage', element: 'fire', baseDamage: 25, range: 5, manaCost: 15, aoeRadius: 1, cooldown: 3, scalingStat: 'acumen', scalingFactor: 0.5, onHitTile: 'BURNING', targetType: 'enemy' },
  { cardId: 'fireball_II', name: 'Fireball II', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['tactician'], tags: ['magic'], effects: [{ type: 'damage', element: 'fire', base: 50, scaling: 'acumen', factor: 0.7, cooldown: 25 }], icon: 'skills/Skill_Explosion.PNG', combatType: 'damage', element: 'fire', baseDamage: 50, range: 5, manaCost: 25, aoeRadius: 2, cooldown: 4, scalingStat: 'acumen', scalingFactor: 0.7, onHitTile: 'BURNING', targetType: 'enemy' },
  { cardId: 'heal_self_I', name: 'Heal Self I', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'heal', base: 20, scaling: 'resolve', factor: 0.3, cooldown: 20 }], icon: 'skills/Enchantment/', combatType: 'healing', baseHeal: 20, range: 0, manaCost: 10, aoeRadius: 0, cooldown: 3, scalingStat: 'resolve', scalingFactor: 0.3, targetType: 'self' },
  { cardId: 'heal_self_II', name: 'Heal Self II', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'heal', base: 40, scaling: 'resolve', factor: 0.5, cooldown: 18 }], icon: 'skills/Enchantment/', combatType: 'healing', baseHeal: 40, range: 0, manaCost: 14, aoeRadius: 0, cooldown: 3, scalingStat: 'resolve', scalingFactor: 0.5, targetType: 'self' },
  { cardId: 'lightning_bolt', name: 'Lightning Bolt', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'damage', element: 'lightning', base: 35, scaling: 'acumen', factor: 0.6, cooldown: 25 }], icon: 'skills/Skill_Explosion.PNG', combatType: 'damage', element: 'lightning', baseDamage: 35, range: 6, manaCost: 20, aoeRadius: 0, cooldown: 3, scalingStat: 'acumen', scalingFactor: 0.6, onHitTile: 'ELECTRIFIED', targetType: 'enemy' },
  { cardId: 'ice_shard', name: 'Ice Shard', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'damage', element: 'ice', base: 15, scaling: 'acumen', factor: 0.4, cooldown: 15 }], icon: 'skills/Skill_Explosion.PNG', combatType: 'damage', element: 'ice', baseDamage: 15, range: 4, manaCost: 8, aoeRadius: 0, cooldown: 2, scalingStat: 'acumen', scalingFactor: 0.4, onHitTile: 'FROZEN', targetType: 'enemy' },
  { cardId: 'shadow_strike', name: 'Shadow Strike', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'rogue', archetypeSecondary: ['mystic'], tags: ['magic'], effects: [{ type: 'damage', element: 'shadow', base: 30, scaling: 'finesse', factor: 0.5, cooldown: 20 }], icon: 'skills/Enchantment/', combatType: 'damage', element: 'dark', baseDamage: 30, range: 1, manaCost: 12, aoeRadius: 0, cooldown: 2, scalingStat: 'finesse', scalingFactor: 0.5, targetType: 'enemy' },

  // ── Racial Feat Cards (any race can use, bonus if matching) ──
  { cardId: 'elven_grace', name: 'Elven Grace', type: 'racial_feat', rarity: 'ultra_rare', archetype: 'mystic', raceBonus: 'elf', tags: ['magic'], effects: [{ type: 'xp_bonus_skill', skill: 'magic', value: 0.20, raceValue: 0.30 }], icon: 'skills/Enchantment/' },
  { cardId: 'orcish_fury', name: 'Orcish Fury', type: 'racial_feat', rarity: 'ultra_rare', archetype: 'warrior', raceBonus: 'orc', effects: [{ type: 'melee_damage_bonus', value: 0.15, raceValue: 0.25 }], icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'dwarven_endurance', name: 'Dwarven Endurance', type: 'racial_feat', rarity: 'ultra_rare', archetype: 'warrior', raceBonus: 'dwarf', effects: [{ type: 'hp_bonus', value: 30, raceValue: 50 }], icon: 'skills/Blacksmith/' },

  // ── Gathering Boost Cards ──
  { cardId: 'double_ore', name: 'Double Ore', type: 'gathering_boost', rarity: 'rare', archetype: 'tactician', tags: ['luck'], effects: [{ type: 'double_gather', skill: 'mining', chance: 0.05 }], icon: 'skills/Blacksmith/' },
  { cardId: 'double_wood', name: 'Double Wood', type: 'gathering_boost', rarity: 'rare', archetype: 'tactician', tags: ['luck'], effects: [{ type: 'double_gather', skill: 'woodcutting', chance: 0.05 }], icon: 'skills/Blacksmith/' },
  { cardId: 'bountiful_harvest', name: 'Bountiful Harvest', type: 'gathering_boost', rarity: 'uncommon', archetype: 'tactician', tags: ['luck'], effects: [{ type: 'gather_bonus', value: 0.10 }], icon: 'skills/Herbalism/' },

  // ── Equipment Modifier Cards ──

  // ── Stealth / Rogue Cards ──
  { cardId: 'backstab_I', name: 'Backstab I', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'rogue', archetypeSecondary: ['warrior'], tags: ['stealth'], effects: [{ type: 'damage', element: 'physical', base: 20, scaling: 'finesse', factor: 0.6, cooldown: 15, requiresStealth: true }], icon: 'skills/Enchantment/', combatType: 'damage', baseDamage: 20, range: 1, manaCost: 5, aoeRadius: 0, cooldown: 2, scalingStat: 'finesse', scalingFactor: 0.6, targetType: 'enemy' },
  { cardId: 'smoke_bomb', name: 'Smoke Bomb', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'rogue', archetypeSecondary: ['rogue'], tags: ['stealth'], effects: [{ type: 'stealth_enter', duration: 8, cooldown: 30 }], icon: 'skills/Enchantment/', combatType: 'tile_effect', tileEffect: 'SMOKE', range: 4, manaCost: 15, aoeRadius: 1, cooldown: 4, targetType: 'any' },
  { cardId: 'poison_blade', name: 'Poison Blade', type: 'equipment_modifier', rarity: 'rare', archetype: 'rogue', archetypeSecondary: ['tactician'], tags: ['stealth'], effects: [{ type: 'weapon_element', element: 'poison', bonusDamage: 5, dotDamage: 4, dotDuration: 5 }], icon: 'skills/Enchantment/', combatWeapon: { bonusDamage: 5, element: 'poison', onHitStatusChance: 0.20, onHitStatus: { name: 'poisoned', duration: 3, tickDamage: 4, type: 'debuff' } } },
  { cardId: 'lockmaster', name: 'Lockmaster', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', rarityScalable: true, tags: ['stealth'], effects: [{ type: 'lockpicking_bonus', value: 0.15 }], icon: 'skills/Enchantment/' },
  { cardId: 'pickpocket', name: 'Pickpocket', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['stealth'], effects: [{ type: 'thievery_bonus', value: 0.15 }, { type: 'steal_chance', value: 0.05 }], icon: 'skills/Enchantment/' },
  { cardId: 'evasion_master', name: 'Evasion Master', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'rogue', archetypeSecondary: ['rogue'], tags: ['stealth'], effects: [{ type: 'dodge_bonus', value: 0.08 }, { type: 'speed_bonus', value: 0.05 }], icon: 'skills/Enchantment/' },

  // === CRIME / UNDERWORLD ACTIVE ABILITIES ===
  { cardId: 'pickpocket_strike', name: 'Pickpocket Strike', type: 'active_ability', rarity: 'uncommon', archetype: 'rogue',
    tags: ['stealth', 'crime'],
    description: 'A deft strike that steals coins from the target while dealing light damage',
    resourceType: 'focus',
    combatType: 'damage', baseDamage: 10, range: 1, manaCost: 8, aoeRadius: 0, cooldown: 2,
    scalingStat: 'finesse', scalingFactor: 0.3, stealGold: true, stealGoldPercent: 0.15, targetType: 'enemy',
    effects: [{ type: 'gold_steal_chance', value: 0.15, description: '+15% gold steal on hit' }],
    icon: 'skills/Enchantment/' },
  { cardId: 'dirty_tricks', name: 'Dirty Tricks', type: 'active_ability', rarity: 'uncommon', archetype: 'rogue',
    tags: ['stealth', 'crime'],
    description: 'Throw sand, flash powder, or caltrops — blinding and slowing the target',
    resourceType: 'focus',
    combatType: 'debuff', range: 3, manaCost: 10, aoeRadius: 0, cooldown: 3,
    statusEffect: 'blinded', statusDuration: 2, secondaryStatus: { name: 'slowed', duration: 2, speedMult: 0.5 }, targetType: 'enemy',
    effects: [{ type: 'debuff_duration_bonus', value: 0.1, description: '+10% debuff duration' }],
    icon: 'skills/Enchantment/' },
  { cardId: 'garrote', name: 'Garrote', type: 'active_ability', rarity: 'rare', archetype: 'rogue',
    tags: ['stealth', 'crime'],
    description: 'Silently choke the target from behind, dealing heavy damage and silencing them. Requires stealth.',
    resourceType: 'focus',
    combatType: 'damage', baseDamage: 35, range: 1, manaCost: 14, aoeRadius: 0, cooldown: 4,
    scalingStat: 'finesse', scalingFactor: 0.6, requiresStealth: true, bonusFromStealth: 1.5,
    onHitStatus: { name: 'silenced', duration: 2, type: 'debuff' }, targetType: 'enemy',
    effects: [{ type: 'stealth_damage_bonus', value: 0.15, description: '+15% damage from stealth' }],
    icon: 'skills/Enchantment/' },
  { cardId: 'shakedown', name: 'Shakedown', type: 'active_ability', rarity: 'rare', archetype: 'rogue',
    tags: ['stealth', 'crime'],
    description: 'Intimidate a weakened enemy into dropping extra loot. Deals moderate damage and increases gold drop.',
    resourceType: 'focus',
    combatType: 'damage', baseDamage: 20, range: 1, manaCost: 12, aoeRadius: 0, cooldown: 3,
    scalingStat: 'presence', scalingFactor: 0.5, bonusGoldOnKill: 0.50, targetType: 'enemy',
    effects: [{ type: 'gold_drop_bonus', value: 0.10, description: '+10% gold drops' }],
    icon: 'skills/Enchantment/' },
  { cardId: 'marked_for_death', name: 'Marked for Death', type: 'active_ability', rarity: 'ultra_rare', archetype: 'rogue',
    tags: ['stealth', 'crime'],
    description: 'Place a death mark on the target. All damage against the marked target is increased by 25% for 3 turns.',
    resourceType: 'focus',
    combatType: 'debuff', range: 5, manaCost: 18, aoeRadius: 0, cooldown: 5,
    statusEffect: 'marked_for_death', statusDuration: 3, damageAmplify: 0.25, targetType: 'enemy',
    effects: [{ type: 'damage_amplify', value: 0.05, description: '+5% damage vs debuffed enemies' }],
    icon: 'skills/Enchantment/' },
  { cardId: 'escape_route', name: 'Escape Route', type: 'active_ability', rarity: 'rare', archetype: 'rogue',
    tags: ['stealth', 'crime'],
    description: 'Break free from all movement-impairing effects and dash 3 tiles away, gaining brief stealth',
    resourceType: 'focus',
    combatType: 'movement', range: 0, manaCost: 12, aoeRadius: 0, cooldown: 4,
    cleansesRoots: true, dashDistance: 3, grantsStealthDuration: 1, targetType: 'self',
    effects: [{ type: 'movement_speed_bonus', value: 0.05, description: '+5% movement speed' }],
    icon: 'skills/Enchantment/' },
  { cardId: 'knife_fan', name: 'Knife Fan', type: 'active_ability', rarity: 'rare', archetype: 'rogue',
    tags: ['stealth', 'crime'],
    description: 'Fling a spread of throwing knives in a cone, dealing physical damage to all enemies hit',
    resourceType: 'focus',
    combatType: 'damage', element: 'physical', baseDamage: 18, range: 3, manaCost: 14, aoeRadius: 0, cooldown: 3,
    scalingStat: 'finesse', scalingFactor: 0.5, coneAttack: true, coneWidth: 3, targetType: 'enemy',
    effects: [{ type: 'aoe_damage_bonus', value: 0.08, description: '+8% AoE damage' }],
    icon: 'skills/Enchantment/' },
  { cardId: 'blackmail', name: 'Blackmail', type: 'active_ability', rarity: 'ultra_rare', archetype: 'rogue',
    tags: ['crime'],
    description: 'Use leverage to turn an enemy against their allies for 2 turns. The target attacks its nearest ally instead.',
    resourceType: 'focus',
    combatType: 'debuff', range: 4, manaCost: 22, aoeRadius: 0, cooldown: 6,
    statusEffect: 'charmed', statusDuration: 2, targetType: 'enemy',
    effects: [{ type: 'charm_duration_bonus', value: 0.15, description: '+15% charm/control duration' }],
    icon: 'skills/Enchantment/' },

  // === CRIME / UNDERWORLD PASSIVE PERKS ===
  { cardId: 'underworld_connections', name: 'Underworld Connections', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['crime'],
    description: '+20% gold from all dungeon sources. Stolen goods sell for 15% more at NPC shops.',
    effects: [{ type: 'dungeon_gold_bonus', value: 0.20 }, { type: 'stolen_goods_bonus', value: 0.15 }],
    icon: 'skills/Enchantment/' },
  { cardId: 'sleight_of_hand', name: 'Sleight of Hand', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician',
    tags: ['crime', 'stealth'],
    description: '+10% steal chance on hit and +15% lockpicking bonus',
    effects: [{ type: 'steal_chance', value: 0.10 }, { type: 'lockpicking_bonus', value: 0.15 }],
    icon: 'skills/Enchantment/' },
  { cardId: 'cat_burglar', name: 'Cat Burglar', type: 'passive_perk', rarity: 'rare', archetype: 'rogue',
    tags: ['crime', 'stealth'],
    description: 'Chests you open have a 20% chance to upgrade one tier. Traps deal 50% less damage to you.',
    effects: [{ type: 'chest_upgrade_chance', value: 0.20 }, { type: 'trap_damage_reduction', value: 0.50 }],
    icon: 'skills/Enchantment/' },
  { cardId: 'fence_network', name: 'Fence Network', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician',
    tags: ['crime'],
    description: '+30% sell price for all items. Card vendor buyback rate increased by 15%.',
    effects: [{ type: 'sell_price_bonus', value: 0.30 }, { type: 'card_buyback_bonus', value: 0.15 }],
    icon: 'skills/Enchantment/' },
  { cardId: 'criminal_mastermind', name: 'Criminal Mastermind', type: 'passive_perk', rarity: 'legendary', archetype: 'tactician',
    tags: ['crime', 'stealth'],
    description: '+15% to all rogue skills. Crime cards cost 20% less focus. Gold stolen is doubled.',
    effects: [{ type: 'lockpicking_bonus', value: 0.15 }, { type: 'thievery_bonus', value: 0.15 }, { type: 'stealth_bonus', value: 0.15 }, { type: 'crime_resource_reduction', value: 0.20 }, { type: 'steal_gold_multiplier', value: 2.0 }],
    icon: 'skills/Enchantment/' },

  // ── Luck / Fortune Cards ──
  { cardId: 'fortune', name: 'Fortune', type: 'passive_perk', rarity: 'common', archetype: 'tactician', tags: ['luck'], effects: [{ type: 'luck_bonus', value: 0.05 }], icon: 'skills/Enchantment/' },
  { cardId: 'cats_grace', name: "Cat's Grace", type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['luck'], effects: [{ type: 'dodge_bonus', value: 0.05 }, { type: 'crit_bonus', value: 0.04 }, { type: 'luck_bonus', value: 0.08 }], icon: 'skills/Enchantment/' },
  { cardId: 'loaded_dice', name: 'Loaded Dice', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', tags: ['luck'], effects: [{ type: 'luck_bonus', value: 0.20 }, { type: 'card_luck_bonus', value: 0.05 }, { type: 'double_gather_all', chance: 0.08 }], icon: 'skills/Enchantment/' },
  { cardId: 'miracle_worker', name: 'Miracle Worker', type: 'passive_perk', rarity: 'legendary', archetype: 'tactician', tags: ['luck'], effects: [{ type: 'luck_bonus', value: 0.25 }, { type: 'crit_bonus', value: 0.08 }, { type: 'loot_bonus', value: 0.20 }, { type: 'card_luck_bonus', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'nine_lives', name: 'Nine Lives', type: 'passive_perk', rarity: 'mythic_rare', archetype: 'tactician', archetypeSecondary: ['warrior'], tags: ['luck'], effects: [{ type: 'revive_on_death', cooldown: 300 }, { type: 'dodge_bonus', value: 0.10 }, { type: 'luck_bonus', value: 0.15 }], icon: 'skills/Enchantment/', combatPassive: { type: 'revive_on_death', hpPercent: 0.25 } },
  { cardId: 'treasure_sense', name: 'Treasure Sense', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', tags: ['luck'], effects: [{ type: 'loot_bonus', value: 0.10 }, { type: 'rare_resource_chance', value: 0.05 }], icon: 'skills/Enchantment/' },

  // ── Lizard Folk Ritual Magic (race-locked: lizardfolk only) ──
  { cardId: 'tidal_invocation', name: 'Tidal Invocation', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'aquatic', archetypeSecondary: ['tactician'], tags: ['magic', 'ritual'], raceLocked: 'lizardfolk', effects: [{ type: 'damage', element: 'water', base: 30, scaling: 'acumen', factor: 0.6, cooldown: 20 }, { type: 'slow', value: 0.30, duration: 4 }], icon: 'skills/Enchantment/', combatType: 'damage', baseDamage: 30, range: 5, manaCost: 18, aoeRadius: 1, cooldown: 3, scalingStat: 'acumen', scalingFactor: 0.6, onHitTile: 'WATER', onHitStatus: { name: 'slow', duration: 2, speedMult: 0.7, type: 'debuff' }, targetType: 'enemy' },
  { cardId: 'serpent_ward', name: 'Serpent Ward', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'aquatic', archetypeSecondary: ['mystic'], tags: ['magic', 'ritual'], raceLocked: 'lizardfolk', effects: [{ type: 'summon_ward', hp: 50, duration: 30, damageReflect: 0.15, cooldown: 60 }], icon: 'skills/Enchantment/', combatType: 'buff', range: 1, manaCost: 25, aoeRadius: 0, cooldown: 5, statusEffect: 'serpent_ward', statusDuration: 5, targetType: 'ally' },
  { cardId: 'deep_communion', name: 'Deep Communion', type: 'passive_perk', rarity: 'rare', archetype: 'aquatic', tags: ['magic', 'ritual'], raceLocked: 'lizardfolk', effects: [{ type: 'xp_bonus_skill', skill: 'magic', value: 0.20 }, { type: 'water_magic_bonus', value: 0.30 }], icon: 'skills/Enchantment/' },
  { cardId: 'primordial_sight', name: 'Primordial Sight', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'aquatic', tags: ['magic', 'ritual'], raceLocked: 'lizardfolk', effects: [{ type: 'tremor_sense_enhanced', range: 'extreme' }, { type: 'hidden_detection', value: true }], icon: 'skills/Enchantment/' },
  { cardId: 'leviathan_pact', name: 'Leviathan Pact', type: 'active_ability', rarity: 'legendary', resourceType: 'mana', archetype: 'aquatic', archetypeSecondary: ['warrior'], tags: ['magic', 'ritual'], raceLocked: 'lizardfolk', effects: [{ type: 'transform', form: 'leviathan', duration: 30, hpBonus: 100, waterSpeedBonus: 1.0, cooldown: 300 }], icon: 'skills/Enchantment/', combatType: 'buff', range: 0, manaCost: 40, aoeRadius: 0, cooldown: 6, statusEffect: 'leviathan_form', statusDuration: 5, statBoost: { vigor: 10, might: 5 }, targetType: 'self' },
  { cardId: 'blood_tide_ritual', name: 'Blood Tide Ritual', type: 'active_ability', rarity: 'mythic_rare', resourceType: 'mana', archetype: 'aquatic', archetypeSecondary: ['mystic'], tags: ['magic', 'ritual'], raceLocked: 'lizardfolk', effects: [{ type: 'aoe_damage', element: 'water', base: 60, radius: 256, scaling: 'acumen', factor: 0.8, cooldown: 90 }, { type: 'heal', base: 30, scaling: 'resolve', factor: 0.3 }], icon: 'skills/Enchantment/', combatType: 'damage', baseDamage: 60, range: 4, manaCost: 40, aoeRadius: 2, cooldown: 5, scalingStat: 'acumen', scalingFactor: 0.8, onHitTile: 'WATER', targetType: 'enemy' },

  // ── Dungeon Cards (boss pack rewards) ──
  { cardId: 'dungeon_fortitude', name: 'Dungeon Fortitude', type: 'passive_perk', rarity: 'rare', archetype: 'warrior', archetypeSecondary: ['utility'], tags: ['dungeon'], effects: [{ type: 'hp_bonus', value: 20 }, { type: 'dungeon_def_bonus', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'delvers_instinct', name: "Delver's Instinct", type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['dungeon'], effects: [{ type: 'trap_detect_bonus', value: 0.15 }, { type: 'loot_bonus', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'rift_walker', name: 'Rift Walker', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior', archetypeSecondary: ['utility'], tags: ['dungeon'], effects: [{ type: 'dungeon_damage_bonus', value: 0.15 }, { type: 'dungeon_xp_bonus', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'boss_slayer', name: 'Boss Slayer', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior', archetypeSecondary: ['utility'], tags: ['dungeon'], effects: [{ type: 'boss_damage_bonus', value: 0.25 }, { type: 'boss_loot_bonus', value: 0.15 }], icon: 'skills/Enchantment/' },
  { cardId: 'abyssal_strike', name: 'Abyssal Strike', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'warrior', tags: ['dungeon'], effects: [{ type: 'damage', element: 'shadow', base: 35, scaling: 'might', factor: 0.6, cooldown: 20 }], icon: 'skills/Skill_Explosion.PNG', combatType: 'damage', element: 'dark', baseDamage: 35, range: 2, manaCost: 15, aoeRadius: 0, cooldown: 3, scalingStat: 'might', scalingFactor: 0.6, targetType: 'enemy' },
  { cardId: 'depths_ward', name: 'Depths Ward', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'warrior', tags: ['dungeon', 'magic'], effects: [{ type: 'shield', base: 40, scaling: 'resolve', factor: 0.4, duration: 15, cooldown: 30 }], icon: 'skills/Enchantment/', combatType: 'buff', range: 1, manaCost: 20, aoeRadius: 0, cooldown: 4, statusEffect: 'depths_ward', statusDuration: 3, armorBoost: 10, targetType: 'ally' },
  { cardId: 'dungeon_master', name: 'Dungeon Master', type: 'passive_perk', rarity: 'legendary', archetype: 'tactician', tags: ['dungeon'], effects: [{ type: 'dungeon_damage_bonus', value: 0.20 }, { type: 'dungeon_xp_bonus', value: 0.20 }, { type: 'trap_detect_bonus', value: 0.25 }], icon: 'skills/Enchantment/' },
  { cardId: 'rift_sovereign', name: 'Rift Sovereign', type: 'passive_perk', rarity: 'mythic_rare', archetype: 'warrior', archetypeSecondary: ['warrior'], tags: ['dungeon'], effects: [{ type: 'dungeon_damage_bonus', value: 0.30 }, { type: 'boss_damage_bonus', value: 0.20 }, { type: 'dungeon_def_bonus', value: 0.15 }, { type: 'loot_bonus', value: 0.20 }], icon: 'skills/Enchantment/' },

  // ── Vision Equipment Cards ──
  { cardId: 'thermal_goggles', name: 'Thermal Goggles', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['dungeon', 'vision'], effects: [{ type: 'grants_vision', value: 'thermal' }], icon: 'skills/Enchantment/', description: 'Enchanted lenses that reveal heat signatures. Grants Thermal Vision toggle.' },
  { cardId: 'tremor_boots', name: 'Tremor Boots', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['dungeon', 'vision'], effects: [{ type: 'grants_vision', value: 'tremor' }], icon: 'skills/Enchantment/', description: 'Stone-infused boots that sense vibrations through the ground. Grants Tremor Sense toggle.' },
  { cardId: 'night_eye_elixir', name: 'Night Eye Elixir', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', tags: ['dungeon', 'vision'], effects: [{ type: 'grants_vision', value: 'night' }], icon: 'skills/Enchantment/', description: 'A permanent alchemical enhancement to the eyes. Grants Night Vision toggle.' },
  { cardId: 'all_seeing_eye', name: 'All-Seeing Eye', type: 'passive_perk', rarity: 'legendary', archetype: 'tactician', tags: ['dungeon', 'vision', 'magic'], effects: [{ type: 'grants_vision', value: 'all' }, { type: 'hidden_detection', value: true }], icon: 'skills/Enchantment/', description: 'An ancient artifact that pierces all forms of concealment. Grants ALL vision types.' },
  { cardId: 'hunters_visor', name: "Hunter's Visor", type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', tags: ['dungeon', 'vision', 'stealth'], effects: [{ type: 'grants_vision', value: ['thermal', 'night'] }, { type: 'stealth_attack_bonus', value: 0.10 }], icon: 'skills/Enchantment/', description: 'A predator\'s helmet that combines heat-sight with night-adapted lenses. Grants Thermal + Night Vision.' },

  // ── Mythic+ Cards ──

  { cardId: 'xp_master', name: 'XP Master', type: 'skill_boost', rarity: 'mythic_rare', archetype: 'tactician', effects: [{ type: 'xp_bonus_all', value: 0.15 }], icon: 'skills/Enchantment/' },
  { cardId: 'phoenix_rebirth', name: 'Phoenix Rebirth', type: 'passive_perk', rarity: 'legendary', archetype: 'warrior', effects: [{ type: 'revive_on_death', cooldown: 600 }], icon: 'skills/Enchantment/', combatPassive: { type: 'revive_on_death', hpPercent: 0.30 } },
  { cardId: 'time_warp', name: 'Time Warp', type: 'active_ability', rarity: 'legendary', resourceType: 'mana', archetype: 'mystic', effects: [{ type: 'cooldown_reset', cooldown: 300 }], icon: 'skills/Enchantment/', combatType: 'buff', range: 0, manaCost: 30, aoeRadius: 0, cooldown: 6, statusEffect: 'time_warp', statusDuration: 1, targetType: 'self' },
  { cardId: 'divine_blessing', name: 'Divine Blessing', type: 'passive_perk', rarity: 'godly', archetype: 'tactician', tags: ['magic'], effects: [{ type: 'stat_boost_all', value: 8 }, { type: 'xp_bonus_all', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'world_shaper', name: 'World Shaper', type: 'passive_perk', rarity: 'godly', archetype: 'tactician', effects: [{ type: 'gather_bonus', value: 0.25 }, { type: 'craft_bonus', value: 0.25 }], icon: 'skills/Enchantment/' },
  { cardId: 'relic_of_creation', name: 'Relic of Creation', type: 'passive_perk', rarity: 'relic', archetype: 'tactician', effects: [{ type: 'stat_boost_all', value: 10 }, { type: 'xp_bonus_all', value: 0.20 }, { type: 'hp_bonus', value: 100 }], icon: 'skills/Enchantment/' },
  { cardId: 'relic_of_time', name: 'Relic of Time', type: 'active_ability', rarity: 'relic', resourceType: 'mana', archetype: 'tactician', effects: [{ type: 'all_cooldown_reduction', value: 0.30 }, { type: 'speed_bonus', value: 0.15 }], icon: 'skills/Enchantment/' },

  // ── Reactive Cards (combat reactions, cost RP) ──
  { cardId: 'evasion_card', name: 'Evasion Mastery', type: 'reactive', rarity: 'rare', archetype: 'rogue', tags: ['stealth'], combatReaction: 'dodge_roll', effects: [{ type: 'dodge_bonus', value: 0.05 }], icon: 'skills/Enchantment/' },
  { cardId: 'magic_resist_card', name: 'Arcane Barrier', type: 'reactive', rarity: 'rare', archetype: 'warrior', tags: ['magic'], combatReaction: 'magic_shield', effects: [{ type: 'magic_resist', value: 0.05 }], icon: 'skills/Enchantment/' },
  { cardId: 'riposte_card', name: 'Riposte', type: 'reactive', rarity: 'uncommon', archetype: 'rogue', archetypeSecondary: ['warrior'], combatReaction: 'counter_strike', effects: [{ type: 'counter_chance_bonus', value: 0.15 }], icon: 'skills/Skill_SwordAttack.PNG' },

  // ── Defensive Active Abilities ──
  { cardId: 'stone_skin', name: 'Stone Skin', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'warrior', tags: ['magic'], effects: [{ type: 'shield', base: 30, scaling: 'resolve', factor: 0.4, cooldown: 20 }], icon: 'skills/Enchantment/', combatType: 'buff', range: 0, manaCost: 15, aoeRadius: 0, cooldown: 3, statusEffect: 'stone_skin', statusDuration: 3, armorBoost: 8, targetType: 'self' },
  { cardId: 'war_cry', name: 'War Cry', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'mystic', archetypeSecondary: ['warrior'], effects: [{ type: 'buff', duration: 10, cooldown: 25 }], icon: 'skills/Skill_SwordAttack.PNG', combatType: 'buff', range: 0, manaCost: 20, aoeRadius: 3, cooldown: 4, statusEffect: 'war_cry', statusDuration: 3, armorBoost: 5, damageBoost: 3, targetType: 'all_allies' },
  { cardId: 'taunt', name: 'Taunt', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina', archetype: 'warrior', archetypeSecondary: ['tactician'], effects: [{ type: 'aggro', cooldown: 15 }], icon: 'skills/Skill_SwordAttack.PNG', combatType: 'debuff', range: 3, manaCost: 0, aoeRadius: 0, cooldown: 3, statusEffect: 'taunted', statusDuration: 2, targetType: 'enemy' },

  // ── Support Active Abilities ──
  { cardId: 'heal_ally', name: 'Heal Ally', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'heal', base: 35, scaling: 'resolve', factor: 0.5, cooldown: 18 }], icon: 'skills/Skill_Heal.PNG', combatType: 'healing', baseHeal: 35, range: 5, manaCost: 15, aoeRadius: 0, cooldown: 3, scalingStat: 'resolve', scalingFactor: 0.5, targetType: 'ally' },
  { cardId: 'circle_of_healing', name: 'Circle of Healing', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'heal_aoe', base: 30, scaling: 'resolve', factor: 0.4, cooldown: 25 }], icon: 'skills/Skill_Heal.PNG', combatType: 'healing', baseHeal: 30, range: 4, manaCost: 22, aoeRadius: 2, cooldown: 4, scalingStat: 'resolve', scalingFactor: 0.4, targetType: 'ally' },
  { cardId: 'mass_haste', name: 'Mass Haste', type: 'active_ability', rarity: 'legendary', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'buff_all', cooldown: 45 }], icon: 'skills/Enchantment/', combatType: 'buff', range: 0, manaCost: 35, aoeRadius: 0, cooldown: 5, statusEffect: 'haste', statusDuration: 3, speedMult: 1.5, targetType: 'all_allies' },
  { cardId: 'cleanse', name: 'Cleanse', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'cleanse', cooldown: 15 }], icon: 'skills/Enchantment/', combatType: 'buff', range: 4, manaCost: 10, aoeRadius: 0, cooldown: 2, statusEffect: 'cleanse', statusDuration: 0, targetType: 'ally' },

  // ── Offensive Active Abilities (AoE/Room-wide) ──
  { cardId: 'chain_lightning', name: 'Chain Lightning', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['tactician'], tags: ['magic'], effects: [{ type: 'damage', element: 'lightning', base: 35, scaling: 'acumen', factor: 0.5, cooldown: 25 }], icon: 'skills/Skill_Explosion.PNG', combatType: 'damage', element: 'lightning', baseDamage: 35, range: 6, manaCost: 22, aoeRadius: 2, cooldown: 4, scalingStat: 'acumen', scalingFactor: 0.5, onHitTile: 'ELECTRIFIED', targetType: 'enemy' },
  { cardId: 'meteor', name: 'Meteor', type: 'active_ability', rarity: 'mythic_rare', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'damage', element: 'fire', base: 80, scaling: 'acumen', factor: 1.0, cooldown: 60 }], icon: 'skills/Skill_Explosion.PNG', combatType: 'damage', element: 'fire', baseDamage: 80, range: 6, manaCost: 45, aoeRadius: 3, cooldown: 6, scalingStat: 'acumen', scalingFactor: 1.0, onHitTile: 'BURNING', targetType: 'all_enemies' },
  { cardId: 'poison_cloud', name: 'Poison Cloud', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'tactician', archetypeSecondary: ['mystic'], tags: ['magic'], effects: [{ type: 'damage', element: 'poison', base: 10, scaling: 'acumen', factor: 0.3, cooldown: 20 }], icon: 'skills/Enchantment/', combatType: 'tile_effect', tileEffect: 'POISONED', range: 5, manaCost: 12, aoeRadius: 2, cooldown: 3, targetType: 'any' },
  { cardId: 'oil_slick', name: 'Oil Slick', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'tactician', effects: [{ type: 'tile', element: 'oil', cooldown: 15 }], icon: 'skills/Enchantment/', combatType: 'tile_effect', tileEffect: 'OIL', range: 4, manaCost: 8, aoeRadius: 1, cooldown: 2, targetType: 'any' },
  { cardId: 'ice_wall', name: 'Ice Wall', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'tactician', archetypeSecondary: ['warrior'], tags: ['magic'], effects: [{ type: 'tile', element: 'ice', cooldown: 20 }], icon: 'skills/Enchantment/', combatType: 'tile_effect', tileEffect: 'FROZEN', range: 5, manaCost: 15, aoeRadius: 1, cooldown: 3, targetType: 'any' },
  { cardId: 'whirlwind', name: 'Whirlwind', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'warrior', archetypeSecondary: ['tactician'], effects: [{ type: 'damage', element: 'physical', base: 20, scaling: 'might', factor: 0.6, cooldown: 15 }], icon: 'skills/Skill_SwordAttack.PNG', combatType: 'damage', baseDamage: 20, range: 1, manaCost: 6, aoeRadius: 1, cooldown: 3, scalingStat: 'might', scalingFactor: 0.6, targetType: 'enemy' },
  { cardId: 'life_drain', name: 'Life Drain', type: 'active_ability', rarity: 'rare', resourceType: 'bloodlust', archetype: 'mystic', archetypeSecondary: ['mystic'], tags: ['magic'], effects: [{ type: 'damage', element: 'shadow', base: 28, scaling: 'acumen', factor: 0.4, cooldown: 20 }], icon: 'skills/Enchantment/', combatType: 'damage', element: 'dark', baseDamage: 28, range: 3, manaCost: 15, aoeRadius: 0, cooldown: 3, scalingStat: 'acumen', scalingFactor: 0.4, targetType: 'enemy', lifesteal: 0.60 },

  // ── Passive Combat Cards (new) ──
  { cardId: 'life_steal_passive', name: 'Vampiric Touch', type: 'passive_perk', rarity: 'rare', archetype: 'warrior', effects: [{ type: 'lifesteal', value: 0.20 }], icon: 'skills/Enchantment/', combatPassive: { type: 'lifesteal', value: 0.20 } },
  // [REMOVED: thorns - superseded by thorns_I/II/III tiered cards below]
  { cardId: 'iron_will', name: 'Iron Will', type: 'passive_perk', rarity: 'rare', archetype: 'warrior', effects: [{ type: 'debuff_resist', value: 0.30 }], icon: 'skills/Enchantment/', combatPassive: { type: 'debuff_resist', value: 0.30 } },
  { cardId: 'second_wind', name: 'Second Wind', type: 'passive_perk', rarity: 'rare', archetype: 'warrior', effects: [{ type: 'heal_on_kill', value: 15 }], icon: 'skills/Enchantment/', combatPassive: { type: 'heal_on_kill', value: 15 } },

  // ── Mana Economy Cards ──
  { cardId: 'arcane_font', name: 'Arcane Font', type: 'passive_perk', rarity: 'rare', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'mana_regen', value: 2 }], icon: 'skills/Enchantment/', combatPassive: { type: 'mana_regen', value: 2 } },

  // ── Additional Passive Combat Cards ──
  { cardId: 'poison_aura', name: 'Toxic Presence', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['stealth'], effects: [{ type: 'poison_aura', value: 3 }], icon: 'skills/Enchantment/', combatPassive: { type: 'poison_aura', value: 3 } },
  { cardId: 'mana_shield', name: 'Mana Shield', type: 'passive_perk', rarity: 'rare', archetype: 'warrior', tags: ['magic'], effects: [{ type: 'mana_shield', value: 0.50 }], icon: 'skills/Enchantment/', combatPassive: { type: 'mana_shield', value: 0.50 } },

  // ── Tank / Positioning Cards ──
  { cardId: 'guardian_stance', name: 'Guardian Stance', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'stamina', archetype: 'warrior', archetypeSecondary: ['tactician'], effects: [{ type: 'taunt_aoe', cooldown: 25 }], icon: 'skills/Skill_Defence.PNG', combatType: 'buff', range: 0, manaCost: 10, aoeRadius: 2, cooldown: 4, statusEffect: 'guardian_stance', statusDuration: 2, armorBoost: 8, tauntAoe: true, targetType: 'self' },
  { cardId: 'blink', name: 'Blink', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'rogue', tags: ['magic'], effects: [{ type: 'teleport', range: 4, cooldown: 20 }], icon: 'skills/Enchantment/', combatType: 'movement', range: 4, manaCost: 12, aoeRadius: 0, cooldown: 3, targetType: 'any' },
  { cardId: 'shield_bash', name: 'Shield Bash', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina', archetype: 'warrior', archetypeSecondary: ['tactician'], effects: [{ type: 'damage', element: 'physical', base: 12, scaling: 'vigor', factor: 0.4, cooldown: 12 }], icon: 'skills/Skill_SwordAttack.PNG', combatType: 'damage', baseDamage: 12, range: 1, manaCost: 0, aoeRadius: 0, cooldown: 2, scalingStat: 'vigor', scalingFactor: 0.4, targetType: 'enemy', knockback: 1, onHitStatus: { name: 'stunned', duration: 1, type: 'debuff' } },

  // ── Additional Weapon Modifiers ──
  { cardId: 'lightning_weapon', name: 'Lightning Weapon', type: 'equipment_modifier', rarity: 'rare', archetype: 'warrior', effects: [{ type: 'weapon_element', element: 'lightning', bonusDamage: 4 }], icon: 'skills/Skill_Explosion.PNG', combatWeapon: { bonusDamage: 4, element: 'lightning', onHitTileChance: 0.08, onHitTile: 'ELECTRIFIED', onHitStatusChance: 0.12, onHitStatus: { name: 'shocked', duration: 1, speedMult: 0.6, type: 'debuff' } } },
  { cardId: 'shadow_weapon', name: 'Shadow Weapon', type: 'equipment_modifier', rarity: 'rare', archetype: 'warrior', tags: ['stealth'], effects: [{ type: 'weapon_element', element: 'shadow', bonusDamage: 3 }], icon: 'skills/Enchantment/', combatWeapon: { bonusDamage: 3, element: 'shadow', onHitStatusChance: 0.18, onHitStatus: { name: 'weakened', duration: 2, damageReduction: 0.20, type: 'debuff' } } },
  { cardId: 'holy_weapon', name: 'Holy Weapon', type: 'equipment_modifier', rarity: 'rare', archetype: 'warrior', tags: ['magic'], effects: [{ type: 'weapon_element', element: 'holy', bonusDamage: 4 }], icon: 'skills/Enchantment/', combatWeapon: { bonusDamage: 4, element: 'holy', onHitStatusChance: 0.12, onHitStatus: { name: 'smited', duration: 2, tickDamage: 4, type: 'debuff' }, bonusVsUndead: 8 } },

  // ── Racial Combat Cards (filling gaps) ──
  { cardId: 'rallying_cry', name: 'Rallying Cry', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'mystic', archetypeSecondary: ['warrior'], raceBonus: 'human', effects: [{ type: 'buff_all', duration: 10, cooldown: 25 }], icon: 'skills/Skill_SwordAttack.PNG', combatType: 'buff', range: 0, manaCost: 15, aoeRadius: 0, cooldown: 4, statusEffect: 'rallying_cry', statusDuration: 3, damageBoost: 4, armorBoost: 3, targetType: 'all_allies' },
  { cardId: 'arcane_surge', name: 'Arcane Surge', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['mystic'], raceBonus: 'elf', tags: ['magic'], effects: [{ type: 'damage', element: 'arcane', base: 30, scaling: 'acumen', factor: 0.7, cooldown: 18 }], icon: 'skills/Enchantment/', combatType: 'damage', element: 'arcane', baseDamage: 30, range: 6, manaCost: 14, aoeRadius: 0, cooldown: 2, scalingStat: 'acumen', scalingFactor: 0.7, targetType: 'enemy' },
  { cardId: 'berserker_rage', name: 'Berserker Rage', type: 'active_ability', rarity: 'rare', resourceType: 'bloodlust', archetype: 'warrior', archetypeSecondary: ['warrior'], raceBonus: 'orc', effects: [{ type: 'buff', duration: 8, cooldown: 20 }], icon: 'skills/Skill_SwordAttack.PNG', combatType: 'buff', range: 0, manaCost: 0, aoeRadius: 0, cooldown: 4, statusEffect: 'berserker_rage', statusDuration: 3, damageBoost: 6, armorReduction: 3, targetType: 'self' },
  { cardId: 'weakening_shriek', name: 'Weakening Shriek', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'tactician', archetypeSecondary: ['mystic'],
    tags: ['cc', 'debuff'],
    description: 'Unleash a soul-draining cry that reduces all enemies in range by 30% damage output for 3 turns',
    effects: [{ type: 'debuff_aoe', stat: 'damage', value: -0.30, duration: 3, description: '-30% enemy damage for 3 turns' }],
    icon: 'skills/Enchantment/',
    combatType: 'debuff', element: 'arcane',
    range: 0, manaCost: 18, aoeRadius: 3, cooldown: 5,
    statusEffect: 'weakened', statusDuration: 3,
    targetType: 'all_enemies',
    onHitStatus: { name: 'weakened', duration: 3, damageReduction: 0.30, type: 'debuff' } },
  { cardId: 'turret_deploy', name: 'Turret Deploy', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'tactician', gnomeBonus: { damageMult: 1.5, extraDuration: 1 }, effects: [{ type: 'summon', cooldown: 30 }], icon: 'skills/Engineering/', combatType: 'tile_effect', tileEffect: 'TURRET', range: 5, manaCost: 18, aoeRadius: 0, cooldown: 5, targetType: 'any' },
  { cardId: 'pounce', name: 'Pounce', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'rogue', archetypeSecondary: ['rogue'], raceBonus: 'catfolk', tags: ['stealth'], effects: [{ type: 'damage', element: 'physical', base: 22, scaling: 'finesse', factor: 0.6, cooldown: 15 }], icon: 'skills/Enchantment/', combatType: 'damage', baseDamage: 22, range: 3, manaCost: 5, aoeRadius: 0, cooldown: 2, scalingStat: 'finesse', scalingFactor: 0.6, targetType: 'enemy', leapToTarget: true },

  // --- Alchemy & Potion Crafting ---
  { cardId: 'alchemy_xp', name: '+10% Alchemy XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'alchemy', value: 0.10 }], icon: 'skills/Herbalism/' },
  { cardId: 'potion_potency', name: 'Potion Potency', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'potion_effectiveness', value: 0.25 }], icon: 'skills/Herbalism/' },
  { cardId: 'transmutation', name: 'Transmutation', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', rarityScalable: true, effects: [{ type: 'transmute_chance', value: 0.10 }], icon: 'skills/Herbalism/' },
  { cardId: 'ingredient_finder', name: 'Ingredient Finder', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', effects: [{ type: 'rare_resource_chance', value: 0.08 }, { type: 'gather_bonus', value: 0.05 }], icon: 'skills/Herbalism/' },
  { cardId: 'acid_flask', name: 'Acid Flask', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'tactician', archetypeSecondary: ['mystic'], effects: [{ type: 'damage', element: 'poison', base: 15, scaling: 'ingenuity', factor: 0.4 }], icon: 'skills/Herbalism/', combatType: 'damage', element: 'poison', baseDamage: 15, range: 3, manaCost: 8, aoeRadius: 0, cooldown: 2, scalingStat: 'ingenuity', scalingFactor: 0.4, onHitStatus: { name: 'corroded', duration: 3, armorReduction: 5, type: 'debuff' }, targetType: 'enemy' },

  // --- Blacksmithing & Crafting Quality ---
  { cardId: 'crafting_xp', name: '+10% Crafting XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'crafting', value: 0.10 }], icon: 'skills/Blacksmith/' },
  { cardId: 'master_smith', name: 'Master Smith', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'craft_quality_bonus', value: 0.15 }, { type: 'craft_bonus', value: 0.10 }], icon: 'skills/Blacksmith/' },
  { cardId: 'forge_mastery', name: 'Forge Mastery', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', effects: [{ type: 'craft_quality_bonus', value: 0.25 }, { type: 'craft_bonus', value: 0.20 }, { type: 'ingredientSaveChance', value: 0.10 }], icon: 'skills/Blacksmith/' },
  { cardId: 'efficient_smelter', name: 'Efficient Smelter', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', effects: [{ type: 'ingredientSaveChance', value: 0.15 }], icon: 'skills/Blacksmith/' },
  { cardId: 'alloy_expert', name: 'Alloy Expert', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'craft_bonus', value: 0.15 }, { type: 'xp_bonus_skill', skill: 'crafting', value: 0.10 }], icon: 'skills/Blacksmith/' },
  { cardId: 'weapon_sharpener', name: 'Weapon Sharpener', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', effects: [{ type: 'crafted_weapon_damage_bonus', value: 2 }], icon: 'skills/Blacksmith/' },
  { cardId: 'armor_hardener', name: 'Armor Hardener', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', effects: [{ type: 'crafted_armor_bonus', value: 2 }], icon: 'skills/Blacksmith/' },
  { cardId: 'legendary_smith', name: 'Legendary Artisan', type: 'passive_perk', rarity: 'legendary', archetype: 'tactician', effects: [{ type: 'craft_quality_bonus', value: 0.35 }, { type: 'craft_bonus', value: 0.30 }, { type: 'ingredientSaveChance', value: 0.20 }, { type: 'crafted_weapon_damage_bonus', value: 4 }], icon: 'skills/Blacksmith/' },

  // --- Cooking Enhancement ---
  { cardId: 'hearty_chef', name: 'Hearty Chef', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', effects: [{ type: 'food_heal_bonus', value: 0.20 }], icon: 'skills/Cooking_fishing/' },
  { cardId: 'gourmet', name: 'Gourmet', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'food_heal_bonus', value: 0.35 }, { type: 'food_buff_duration', value: 0.25 }], icon: 'skills/Cooking_fishing/' },
  { cardId: 'master_chef', name: 'Master Chef', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', effects: [{ type: 'food_heal_bonus', value: 0.50 }, { type: 'food_buff_duration', value: 0.50 }, { type: 'feast_chance', value: 0.10 }], icon: 'skills/Cooking_fishing/' },
  { cardId: 'recipe_intuition', name: 'Recipe Intuition', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'recipe_discovery_bonus', value: 0.20 }, { type: 'xp_bonus_skill', skill: 'cooking', value: 0.15 }], icon: 'skills/Cooking_fishing/' },
  { cardId: 'spice_master', name: 'Spice Master', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', effects: [{ type: 'food_buff_potency', value: 0.15 }], icon: 'skills/Cooking_fishing/' },

  // --- Spell Crafting & Enchanting ---
  { cardId: 'enchanting_xp', name: '+10% Enchanting XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', tags: ['magic'], effects: [{ type: 'xp_bonus_skill', skill: 'enchanting', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'arcane_infusion', name: 'Arcane Infusion', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['magic'], effects: [{ type: 'enchant_power_bonus', value: 0.20 }, { type: 'mana_efficiency', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'spell_weaver', name: 'Spell Weaver', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic', archetypeSecondary: ['utility'], tags: ['magic'], effects: [{ type: 'spell_damage_bonus', value: 0.15 }, { type: 'mana_efficiency', value: 0.20 }, { type: 'cooldown_reduction', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'rune_scribe', name: 'Rune Scribe', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['magic'], effects: [{ type: 'enchant_power_bonus', value: 0.15 }, { type: 'xp_bonus_skill', skill: 'magic', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'mana_well', name: 'Mana Well', type: 'passive_perk', rarity: 'rare', archetype: 'mystic', archetypeSecondary: ['mystic'], tags: ['magic'], effects: [{ type: 'max_mana_bonus', value: 30 }, { type: 'mana_regen', value: 1 }], icon: 'skills/Enchantment/', combatPassive: { type: 'mana_regen', value: 1 } },
  { cardId: 'elemental_mastery', name: 'Elemental Mastery', type: 'passive_perk', rarity: 'legendary', archetype: 'mystic', archetypeSecondary: ['utility'], tags: ['magic'], effects: [{ type: 'spell_damage_bonus', value: 0.25 }, { type: 'elemental_resist_all', value: 0.10 }, { type: 'mana_efficiency', value: 0.15 }], icon: 'skills/Enchantment/' },
  { cardId: 'scroll_of_power', name: 'Scroll of Power', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['mystic'], tags: ['magic'], effects: [{ type: 'buff', duration: 15 }], icon: 'skills/Enchantment/', combatType: 'buff', range: 0, manaCost: 20, aoeRadius: 0, cooldown: 5, statusEffect: 'empowered', statusDuration: 4, damageBoost: 5, statBoost: { acumen: 3 }, targetType: 'self' },

  // --- Support & Healing Expansion ---
  { cardId: 'damage_ward', name: 'Damage Ward', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'shield', base: 35, scaling: 'resolve', factor: 0.4 }], icon: 'skills/Skill_Heal.PNG', combatType: 'buff', range: 4, manaCost: 15, aoeRadius: 0, cooldown: 3, statusEffect: 'damage_ward', statusDuration: 3, armorBoost: 8, targetType: 'ally' },
  { cardId: 'resurrection', name: 'Resurrection', type: 'active_ability', rarity: 'legendary', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'revive_ally', hpPercent: 0.50, cooldown: 120 }], icon: 'skills/Skill_Heal.PNG', combatType: 'healing', baseHeal: 0, range: 3, manaCost: 40, aoeRadius: 0, cooldown: 8, scalingStat: 'resolve', scalingFactor: 0, targetType: 'dead_ally', reviveHpPercent: 0.50 },
  { cardId: 'sanctuary', name: 'Sanctuary', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'shield_all', base: 30, scaling: 'resolve', factor: 0.3 }], icon: 'skills/Skill_Heal.PNG', combatType: 'buff', range: 0, manaCost: 30, aoeRadius: 0, cooldown: 5, statusEffect: 'sanctuary', statusDuration: 3, armorBoost: 10, healPerTurn: 5, targetType: 'all_allies' },
  { cardId: 'inspiration', name: 'Inspiration', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'mystic', effects: [{ type: 'buff_all', duration: 10 }], icon: 'skills/Skill_Heal.PNG', combatType: 'buff', range: 0, manaCost: 12, aoeRadius: 0, cooldown: 4, statusEffect: 'inspired', statusDuration: 3, statBoost: { might: 2, acumen: 2, finesse: 2 }, targetType: 'all_allies' },

  // --- Field Medic / Out-of-Combat ---
  { cardId: 'field_medic', name: 'Field Medic', type: 'passive_perk', rarity: 'rare', archetype: 'mystic', effects: [{ type: 'out_of_combat_heal', value: 5 }, { type: 'food_heal_bonus', value: 0.15 }], icon: 'skills/Skill_Heal.PNG' },
  { cardId: 'combat_medic', name: 'Combat Medic', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic', archetypeSecondary: ['utility'], effects: [{ type: 'heal_on_kill', value: 10 }, { type: 'out_of_combat_heal', value: 8 }, { type: 'food_heal_bonus', value: 0.25 }], icon: 'skills/Skill_Heal.PNG', combatPassive: { type: 'heal_on_kill', value: 10 } },
  { cardId: 'survivors_instinct', name: "Survivor's Instinct", type: 'passive_perk', rarity: 'rare', archetype: 'warrior', effects: [{ type: 'low_hp_damage_reduction', value: 0.25, threshold: 0.30 }, { type: 'hp_regen', value: 2 }], icon: 'skills/Skill_Heal.PNG', combatPassive: { type: 'hp_regen', value: 2 } },

  // --- Farming Enhancement ---
  { cardId: 'green_thumb', name: 'Green Thumb', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', effects: [{ type: 'crop_growth_speed', value: 0.20 }, { type: 'crop_yield_bonus', value: 0.10 }], icon: 'skills/Herbalism/' },
  { cardId: 'master_farmer', name: 'Master Farmer', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'crop_growth_speed', value: 0.35 }, { type: 'crop_yield_bonus', value: 0.25 }, { type: 'rare_seed_chance', value: 0.10 }], icon: 'skills/Herbalism/' },
  { cardId: 'natures_blessing', name: "Nature's Blessing", type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', effects: [{ type: 'crop_growth_speed', value: 0.50 }, { type: 'crop_yield_bonus', value: 0.40 }, { type: 'gather_bonus', value: 0.15 }], icon: 'skills/Herbalism/' },

  // --- Missing Skill XP Cards ---
  { cardId: 'archery_xp', name: '+10% Archery XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'archery', value: 0.10 }], icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'glassworking_xp', name: '+10% Glassworking XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'glassworking', value: 0.10 }], icon: 'skills/Engineering/' },

  // --- Missing Element Abilities ---
  { cardId: 'earth_spike', name: 'Earth Spike', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'damage', element: 'earth', base: 18, scaling: 'acumen', factor: 0.4 }], icon: 'skills/Skill_Explosion.PNG', combatType: 'damage', element: 'earth', baseDamage: 18, range: 4, manaCost: 10, aoeRadius: 0, cooldown: 2, scalingStat: 'acumen', scalingFactor: 0.4, targetType: 'enemy' },
  { cardId: 'earthquake', name: 'Earthquake', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['tactician'], tags: ['magic'], effects: [{ type: 'damage', element: 'earth', base: 40, scaling: 'acumen', factor: 0.6 }], icon: 'skills/Skill_Explosion.PNG', combatType: 'damage', element: 'earth', baseDamage: 40, range: 4, manaCost: 25, aoeRadius: 2, cooldown: 4, scalingStat: 'acumen', scalingFactor: 0.6, targetType: 'all_enemies', onHitStatus: { name: 'stunned', duration: 1, type: 'debuff' } },
  { cardId: 'gust', name: 'Gust', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'damage', element: 'wind', base: 12, scaling: 'acumen', factor: 0.3 }], icon: 'skills/Skill_Explosion.PNG', combatType: 'damage', element: 'wind', baseDamage: 12, range: 5, manaCost: 6, aoeRadius: 0, cooldown: 2, scalingStat: 'acumen', scalingFactor: 0.3, targetType: 'enemy', knockback: 2 },
  { cardId: 'tornado', name: 'Tornado', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'damage', element: 'wind', base: 30, scaling: 'acumen', factor: 0.5 }], icon: 'skills/Skill_Explosion.PNG', combatType: 'damage', element: 'wind', baseDamage: 30, range: 5, manaCost: 20, aoeRadius: 1, cooldown: 4, scalingStat: 'acumen', scalingFactor: 0.5, targetType: 'enemy', knockback: 1 },
  { cardId: 'holy_smite', name: 'Holy Smite', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'damage', element: 'holy', base: 30, scaling: 'resolve', factor: 0.5 }], icon: 'skills/Enchantment/', combatType: 'damage', element: 'holy', baseDamage: 30, range: 4, manaCost: 15, aoeRadius: 0, cooldown: 3, scalingStat: 'resolve', scalingFactor: 0.5, targetType: 'enemy', bonusVsUndead: 15 },
  { cardId: 'divine_wrath', name: 'Divine Wrath', type: 'active_ability', rarity: 'legendary', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['tactician'], tags: ['magic'], effects: [{ type: 'damage', element: 'holy', base: 60, scaling: 'resolve', factor: 0.8 }], icon: 'skills/Enchantment/', combatType: 'damage', element: 'holy', baseDamage: 60, range: 5, manaCost: 35, aoeRadius: 2, cooldown: 5, scalingStat: 'resolve', scalingFactor: 0.8, targetType: 'all_enemies', bonusVsUndead: 25 },

  // --- Stealth Expansion ---
  { cardId: 'ambush', name: 'Ambush', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'rogue', archetypeSecondary: ['warrior'], tags: ['stealth'], effects: [{ type: 'damage', element: 'physical', base: 35, scaling: 'finesse', factor: 0.7 }], icon: 'skills/Enchantment/', combatType: 'damage', baseDamage: 35, range: 1, manaCost: 10, aoeRadius: 0, cooldown: 3, scalingStat: 'finesse', scalingFactor: 0.7, targetType: 'enemy', bonusFromStealth: 1.5 },
  { cardId: 'shadow_step', name: 'Shadow Step', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'rogue', archetypeSecondary: ['rogue'], tags: ['stealth'], effects: [{ type: 'teleport', range: 3 }], icon: 'skills/Enchantment/', combatType: 'movement', range: 3, manaCost: 8, aoeRadius: 0, cooldown: 3, targetType: 'any', grantsStealth: 1 },
  { cardId: 'assassinate', name: 'Assassinate', type: 'active_ability', rarity: 'legendary', resourceType: 'focus', archetype: 'rogue', tags: ['stealth'], effects: [{ type: 'damage', element: 'physical', base: 60, scaling: 'finesse', factor: 1.0, requiresStealth: true }], icon: 'skills/Enchantment/', combatType: 'damage', baseDamage: 60, range: 1, manaCost: 20, aoeRadius: 0, cooldown: 5, scalingStat: 'finesse', scalingFactor: 1.0, targetType: 'enemy', bonusFromStealth: 2.0 },
  { cardId: 'crippling_strike', name: 'Crippling Strike', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'rogue', archetypeSecondary: ['tactician'], tags: ['stealth'], effects: [{ type: 'damage', element: 'physical', base: 15, scaling: 'finesse', factor: 0.4 }], icon: 'skills/Enchantment/', combatType: 'damage', baseDamage: 15, range: 1, manaCost: 5, aoeRadius: 0, cooldown: 2, scalingStat: 'finesse', scalingFactor: 0.4, targetType: 'enemy', onHitStatus: { name: 'crippled', duration: 3, speedMult: 0.5, type: 'debuff' } },

  // --- Archery Abilities ---
  { cardId: 'power_shot', name: 'Power Shot', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'warrior', effects: [{ type: 'damage', element: 'physical', base: 25, scaling: 'finesse', factor: 0.5 }], icon: 'skills/Skill_SwordAttack.PNG', combatType: 'damage', baseDamage: 25, range: 7, manaCost: 5, aoeRadius: 0, cooldown: 2, scalingStat: 'finesse', scalingFactor: 0.5, targetType: 'enemy' },
  { cardId: 'multi_shot', name: 'Multi Shot', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'warrior', effects: [{ type: 'damage', element: 'physical', base: 15, scaling: 'finesse', factor: 0.3 }], icon: 'skills/Skill_SwordAttack.PNG', combatType: 'damage', baseDamage: 15, range: 6, manaCost: 12, aoeRadius: 2, cooldown: 3, scalingStat: 'finesse', scalingFactor: 0.3, targetType: 'all_enemies' },
  { cardId: 'sniper_shot', name: 'Sniper Shot', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'focus', archetype: 'warrior', effects: [{ type: 'damage', element: 'physical', base: 50, scaling: 'finesse', factor: 0.8, requiresRange: 5 }], icon: 'skills/Skill_SwordAttack.PNG', combatType: 'damage', baseDamage: 50, range: 8, manaCost: 15, aoeRadius: 0, cooldown: 4, scalingStat: 'finesse', scalingFactor: 0.8, targetType: 'enemy' },
  { cardId: 'rain_of_arrows', name: 'Rain of Arrows', type: 'active_ability', rarity: 'legendary', resourceType: 'focus', archetype: 'warrior', effects: [{ type: 'damage', element: 'physical', base: 30, scaling: 'finesse', factor: 0.5 }], icon: 'skills/Skill_SwordAttack.PNG', combatType: 'damage', baseDamage: 30, range: 7, manaCost: 25, aoeRadius: 3, cooldown: 5, scalingStat: 'finesse', scalingFactor: 0.5, targetType: 'all_enemies' },

  // --- Ritual Magic & Runes ---
  { cardId: 'rune_of_power', name: 'Rune of Power', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', tags: ['magic', 'ritual'], effects: [{ type: 'buff', duration: 15 }], icon: 'skills/Enchantment/', combatType: 'buff', range: 0, manaCost: 20, aoeRadius: 0, cooldown: 4, statusEffect: 'runic_power', statusDuration: 4, damageBoost: 6, targetType: 'self' },
  { cardId: 'rune_of_warding', name: 'Rune of Warding', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'warrior', tags: ['magic', 'ritual'], effects: [{ type: 'tile', element: 'holy' }], icon: 'skills/Enchantment/', combatType: 'tile_effect', tileEffect: 'WARD', range: 3, manaCost: 15, aoeRadius: 1, cooldown: 4, targetType: 'any' },
  { cardId: 'runic_inscription', name: 'Runic Inscription', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['magic', 'ritual'], effects: [{ type: 'enchant_power_bonus', value: 0.20 }, { type: 'rune_duration_bonus', value: 0.30 }], icon: 'skills/Enchantment/' },
  { cardId: 'ritual_mastery', name: 'Ritual Mastery', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic', tags: ['magic', 'ritual'], effects: [{ type: 'spell_damage_bonus', value: 0.15 }, { type: 'mana_efficiency', value: 0.20 }, { type: 'rune_duration_bonus', value: 0.50 }], icon: 'skills/Enchantment/' },
  { cardId: 'blood_ritual', name: 'Blood Ritual', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'bloodlust', archetype: 'mystic', tags: ['magic', 'ritual'], effects: [{ type: 'damage', element: 'dark', base: 45, scaling: 'resolve', factor: 0.6 }], icon: 'skills/Enchantment/', combatType: 'damage', element: 'dark', baseDamage: 45, range: 3, manaCost: 0, aoeRadius: 1, cooldown: 4, scalingStat: 'resolve', scalingFactor: 0.6, targetType: 'enemy', hpCost: 25 },
  { cardId: 'rune_trap', name: 'Rune Trap', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'tactician', tags: ['magic', 'ritual'], effects: [{ type: 'tile', element: 'arcane' }], icon: 'skills/Enchantment/', combatType: 'tile_effect', tileEffect: 'RUNE_TRAP', range: 4, manaCost: 10, aoeRadius: 0, cooldown: 3, targetType: 'any' },
  { cardId: 'runic_weapon', name: 'Runic Weapon', type: 'equipment_modifier', rarity: 'ultra_rare', archetype: 'warrior', tags: ['magic', 'ritual'], effects: [{ type: 'weapon_element', element: 'arcane', bonusDamage: 6 }], icon: 'skills/Enchantment/', combatWeapon: { bonusDamage: 6, element: 'arcane', onHitStatusChance: 0.10, onHitStatus: { name: 'runic_mark', duration: 2, damageAmplify: 0.15, type: 'debuff' } } },
  { cardId: 'ancient_glyph', name: 'Ancient Glyph', type: 'passive_perk', rarity: 'legendary', archetype: 'mystic', tags: ['magic', 'ritual'], effects: [{ type: 'spell_damage_bonus', value: 0.20 }, { type: 'enchant_power_bonus', value: 0.30 }, { type: 'mana_regen', value: 2 }], icon: 'skills/Enchantment/', combatPassive: { type: 'mana_regen', value: 2 } },

  // --- Enchanting Expansion ---
  { cardId: 'disenchant', name: 'Disenchant', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', rarityScalable: true, tags: ['magic'], effects: [{ type: 'disenchant_yield', value: 0.15 }], icon: 'skills/Enchantment/' },
  { cardId: 'enchant_transfer', name: 'Enchant Transfer', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', rarityScalable: true, tags: ['magic'], effects: [{ type: 'enchant_transfer_chance', value: 0.20 }], icon: 'skills/Enchantment/' },
  { cardId: 'glyph_crafter', name: 'Glyph Crafter', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['magic'], effects: [{ type: 'glyph_power', value: 0.20 }, { type: 'enchant_power_bonus', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'double_enchant', name: 'Double Enchant', type: 'passive_perk', rarity: 'legendary', archetype: 'tactician', tags: ['magic'], effects: [{ type: 'double_enchant_chance', value: 0.10 }, { type: 'enchant_power_bonus', value: 0.25 }], icon: 'skills/Enchantment/' },
  { cardId: 'mana_forge', name: 'Mana Forge', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', tags: ['magic'], effects: [{ type: 'enchant_power_bonus', value: 0.30 }, { type: 'ingredientSaveChance', value: 0.15 }, { type: 'xp_bonus_skill', skill: 'magic', value: 0.10 }], icon: 'skills/Enchantment/' },

  // --- Gardening (distinct from Farming) ---
  { cardId: 'gardening_xp', name: '+10% Gardening XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'farming', value: 0.10 }], icon: 'skills/Herbalism/' },
  { cardId: 'herb_garden', name: 'Herb Garden', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', effects: [{ type: 'herb_yield_bonus', value: 0.25 }, { type: 'crop_growth_speed', value: 0.15 }], icon: 'skills/Herbalism/' },
  { cardId: 'botanical_knowledge', name: 'Botanical Knowledge', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'rare_seed_chance', value: 0.15 }, { type: 'herb_yield_bonus', value: 0.20 }, { type: 'xp_bonus_skill', skill: 'farming', value: 0.15 }], icon: 'skills/Herbalism/' },
  { cardId: 'companion_planting', name: 'Companion Planting', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'crop_yield_bonus', value: 0.30 }, { type: 'crop_growth_speed', value: 0.20 }], icon: 'skills/Herbalism/' },
  { cardId: 'master_gardener', name: 'Master Gardener', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', effects: [{ type: 'crop_yield_bonus', value: 0.50 }, { type: 'crop_growth_speed', value: 0.40 }, { type: 'herb_yield_bonus', value: 0.40 }, { type: 'rare_seed_chance', value: 0.20 }], icon: 'skills/Herbalism/' },
  { cardId: 'natures_harmony', name: "Nature's Harmony", type: 'passive_perk', rarity: 'legendary', archetype: 'tactician', effects: [{ type: 'crop_yield_bonus', value: 0.60 }, { type: 'herb_yield_bonus', value: 0.50 }, { type: 'food_heal_bonus', value: 0.20 }, { type: 'potion_effectiveness', value: 0.15 }], icon: 'skills/Herbalism/' },

  // --- Cross-System Synergy Cards ---
  { cardId: 'garden_chef', name: 'Garden Chef', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'food_heal_bonus', value: 0.25 }, { type: 'crop_yield_bonus', value: 0.15 }, { type: 'food_buff_duration', value: 0.20 }], icon: 'skills/Cooking_fishing/' },
  { cardId: 'herbalist_alchemist', name: 'Herbalist Alchemist', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'potion_effectiveness', value: 0.20 }, { type: 'herb_yield_bonus', value: 0.20 }, { type: 'rare_resource_chance', value: 0.08 }], icon: 'skills/Herbalism/' },
  { cardId: 'enchanted_forge', name: 'Enchanted Forge', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', effects: [{ type: 'craft_quality_bonus', value: 0.20 }, { type: 'enchant_power_bonus', value: 0.15 }, { type: 'crafted_weapon_damage_bonus', value: 3 }], icon: 'skills/Blacksmith/' },
  { cardId: 'feast_healer', name: 'Feast Healer', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', archetypeSecondary: ['mystic'], effects: [{ type: 'food_heal_bonus', value: 0.30 }, { type: 'healing_power_bonus', value: 0.15 }, { type: 'feast_chance', value: 0.08 }], icon: 'skills/Cooking_fishing/' },
  { cardId: 'crop_transmuter', name: 'Crop Transmuter', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'transmute_chance', value: 0.12 }, { type: 'crop_yield_bonus', value: 0.20 }], icon: 'skills/Herbalism/' },
  { cardId: 'poison_brewer', name: 'Poison Brewer', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', archetypeSecondary: ['tactician'], tags: ['stealth'], effects: [{ type: 'potion_effectiveness', value: 0.15 }, { type: 'poison_damage_bonus', value: 0.20 }, { type: 'herb_yield_bonus', value: 0.10 }], icon: 'skills/Herbalism/' },
  { cardId: 'self_sufficient', name: 'Self-Sufficient', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', effects: [{ type: 'gather_bonus', value: 0.10 }, { type: 'food_heal_bonus', value: 0.15 }, { type: 'craft_bonus', value: 0.10 }, { type: 'crop_yield_bonus', value: 0.15 }], icon: 'skills/Herbalism/' },
  { cardId: 'battle_cook', name: 'Battle Cook', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'food_buff_potency', value: 0.25 }, { type: 'food_buff_duration', value: 0.30 }, { type: 'out_of_combat_heal', value: 3 }], icon: 'skills/Cooking_fishing/' },
  { cardId: 'runic_smith', name: 'Runic Smith', type: 'passive_perk', rarity: 'legendary', archetype: 'tactician', tags: ['magic'], effects: [{ type: 'craft_quality_bonus', value: 0.25 }, { type: 'enchant_power_bonus', value: 0.25 }, { type: 'rune_duration_bonus', value: 0.30 }, { type: 'crafted_weapon_damage_bonus', value: 5 }], icon: 'skills/Blacksmith/' },
  { cardId: 'naturalist', name: 'Naturalist', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', effects: [{ type: 'crop_growth_speed', value: 0.30 }, { type: 'gather_bonus', value: 0.15 }, { type: 'potion_effectiveness', value: 0.15 }, { type: 'food_heal_bonus', value: 0.20 }], icon: 'skills/Herbalism/' },

  // --- Per-Skill XP Cards (all skills that grant XP) ---
  { cardId: 'lockpicking_xp', name: '+10% Lockpicking XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', tags: ['stealth'], effects: [{ type: 'xp_bonus_skill', skill: 'lockpicking', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'thievery_xp', name: '+10% Thievery XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', tags: ['stealth'], effects: [{ type: 'xp_bonus_skill', skill: 'thievery', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'dungeon_exploration_xp', name: '+10% Dungeon Exploration XP', type: 'skill_boost', rarity: 'uncommon', archetype: 'tactician', tags: ['dungeon'], effects: [{ type: 'xp_bonus_skill', skill: 'dungeon_exploration', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'harvesting_xp', name: '+10% Harvesting XP', type: 'skill_boost', rarity: 'common', archetype: 'tactician', effects: [{ type: 'xp_bonus_all_gathering', value: 0.10 }], icon: 'skills/Herbalism/' },
  { cardId: 'combat_xp', name: '+10% All Combat XP', type: 'skill_boost', rarity: 'uncommon', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'melee', value: 0.10 }, { type: 'xp_bonus_skill', skill: 'archery', value: 0.10 }, { type: 'xp_bonus_skill', skill: 'magic', value: 0.10 }], icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'crafting_xp_all', name: '+10% All Crafting XP', type: 'skill_boost', rarity: 'uncommon', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'crafting', value: 0.10 }, { type: 'xp_bonus_skill', skill: 'cooking', value: 0.10 }, { type: 'xp_bonus_skill', skill: 'glassworking', value: 0.10 }, { type: 'xp_bonus_skill', skill: 'cogworking', value: 0.10 }], icon: 'skills/Blacksmith/' },

  // --- Cogworking & Automatons ---
  { cardId: 'automaton_deploy', name: 'Automaton Deploy', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'tactician', raceBonus: 'gnome', effects: [{ type: 'summon', duration: 30 }], icon: 'skills/Engineering/', combatType: 'summon', range: 2, manaCost: 20, aoeRadius: 0, cooldown: 5, summonType: 'automaton', summonHp: 40, summonDamage: 8, summonDuration: 4, targetType: 'any' },
  { cardId: 'clockwork_sentinel', name: 'Clockwork Sentinel', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'focus', archetype: 'tactician', raceBonus: 'gnome', effects: [{ type: 'summon', duration: 45 }], icon: 'skills/Engineering/', combatType: 'summon', range: 2, manaCost: 25, aoeRadius: 0, cooldown: 6, summonType: 'sentinel', summonHp: 70, summonDamage: 12, summonDuration: 5, summonArmor: 10, targetType: 'any' },
  { cardId: 'explosive_charge', name: 'Explosive Charge', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'mystic', archetypeSecondary: ['tactician'], effects: [{ type: 'damage', element: 'fire', base: 35, scaling: 'ingenuity', factor: 0.6 }], icon: 'skills/Engineering/', combatType: 'damage', element: 'fire', baseDamage: 35, range: 3, manaCost: 15, aoeRadius: 2, cooldown: 4, scalingStat: 'ingenuity', scalingFactor: 0.6, onHitTile: 'BURNING', targetType: 'enemy' },
  { cardId: 'repair_bot', name: 'Repair Bot', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'mystic', raceBonus: 'gnome', effects: [{ type: 'heal', base: 20, scaling: 'ingenuity', factor: 0.4 }], icon: 'skills/Engineering/', combatType: 'healing', baseHeal: 20, range: 3, manaCost: 10, aoeRadius: 0, cooldown: 3, scalingStat: 'ingenuity', scalingFactor: 0.4, targetType: 'ally' },
  { cardId: 'gear_grinder', name: 'Gear Grinder', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', effects: [{ type: 'craft_bonus', value: 0.15 }, { type: 'xp_bonus_skill', skill: 'cogworking', value: 0.15 }], icon: 'skills/Engineering/' },
  { cardId: 'tinker_mastery', name: 'Tinker Mastery', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'craft_bonus', value: 0.25 }, { type: 'ingredientSaveChance', value: 0.15 }, { type: 'xp_bonus_skill', skill: 'cogworking', value: 0.20 }], icon: 'skills/Engineering/' },
  { cardId: 'master_engineer', name: 'Master Engineer', type: 'passive_perk', rarity: 'legendary', archetype: 'tactician', effects: [{ type: 'craft_bonus', value: 0.35 }, { type: 'craft_quality_bonus', value: 0.25 }, { type: 'summon_damage_bonus', value: 0.30 }, { type: 'summon_hp_bonus', value: 0.30 }], icon: 'skills/Engineering/' },
  { cardId: 'smoke_screen', name: 'Smoke Screen', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'rogue', effects: [{ type: 'tile', element: 'smoke' }], icon: 'skills/Engineering/', combatType: 'tile_effect', tileEffect: 'SMOKE', range: 3, manaCost: 6, aoeRadius: 2, cooldown: 3, targetType: 'any' },
  { cardId: 'turret_upgrade', name: 'Turret Upgrade', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', raceBonus: 'gnome', effects: [{ type: 'summon_damage_bonus', value: 0.25 }, { type: 'summon_hp_bonus', value: 0.20 }], icon: 'skills/Engineering/' },
  { cardId: 'heal_turret_deploy', name: 'Heal Turret', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'tactician', gnomeBonus: { healMult: 1.5, extraDuration: 1 }, effects: [{ type: 'summon', cooldown: 30 }], icon: 'skills/Engineering/', combatType: 'tile_effect', tileEffect: 'HEAL_TURRET', range: 5, manaCost: 20, aoeRadius: 0, cooldown: 5, targetType: 'any', description: 'Deploy a healing turret that restores HP to the lowest-HP ally within range each turn.' },
  { cardId: 'shield_turret_deploy', name: 'Shield Turret', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'tactician', gnomeBonus: { shieldMult: 1.5, extraDuration: 1 }, effects: [{ type: 'summon', cooldown: 30 }], icon: 'skills/Engineering/', combatType: 'tile_effect', tileEffect: 'SHIELD_TURRET', range: 5, manaCost: 22, aoeRadius: 0, cooldown: 5, targetType: 'any', description: 'Deploy a shield turret that pulses a protective barrier to nearby allies each turn.' },
  { cardId: 'turret_network', name: 'Turret Network', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', effects: [{ type: 'turret_network', sharePercent: 0.15, range: 3 }], icon: 'skills/Engineering/', description: 'Turrets within 3 tiles share 15% of their fire, causing nearby turrets to also shoot for reduced damage.' },
  { cardId: 'automated_triage', name: 'Automated Triage', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic', effects: [{ type: 'automated_triage', hpRegen: 5, healBonus: 0.50 }], icon: 'skills/Engineering/', description: '+5 HP regen/turn for all your deployed turrets. Heal turrets restore 50% more HP.' },

  // --- Sewing / Tailoring Cards ---
  { cardId: 'master_tailor', name: 'Master Tailor', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', effects: [{ type: 'craft_quality_bonus', value: 0.20 }, { type: 'sewing_armor_bonus', value: 3 }], icon: 'skills/Blacksmith/' },
  { cardId: 'silk_weaver', name: 'Silk Weaver', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'sewing_magic_resist_bonus', value: 3 }, { type: 'ingredientSaveChance', value: 0.10 }], icon: 'skills/Blacksmith/' },
  { cardId: 'battle_seamstress', name: 'Battle Seamstress', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['crafting'], effects: [{ type: 'crafted_armor_bonus', value: 3 }, { type: 'craft_quality_bonus', value: 0.10 }], icon: 'skills/Blacksmith/' },
  { cardId: 'enchanted_thread', name: 'Enchanted Thread', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['magic', 'crafting'], effects: [{ type: 'sewing_magic_resist_bonus', value: 5 }, { type: 'sewing_armor_bonus', value: 2 }], icon: 'skills/Enchantment/' },
  { cardId: 'weavers_blessing', name: "Weaver's Blessing", type: 'passive_perk', rarity: 'legendary', archetype: 'tactician', effects: [{ type: 'craft_quality_bonus', value: 0.25 }, { type: 'sewing_armor_bonus', value: 5 }, { type: 'sewing_magic_resist_bonus', value: 5 }, { type: 'ingredientSaveChance', value: 0.15 }], icon: 'skills/Blacksmith/' },

  // === NECROMANCY CARDS ===
  { cardId: 'raise_skeleton', name: 'Raise Skeleton', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['tactician'], tags: ['necromancy', 'shadow', 'magic'], effects: [{ type: 'summon', summonType: 'skeleton', count: 1, duration: 30 }], icon: 'skills/Enchantment/', combatType: 'summon', range: 3, manaCost: 20, aoeRadius: 0, cooldown: 5, scalingStat: 'acumen', scalingFactor: 0.3, summonType: 'skeleton', summonHp: 40, summonDamage: 10, summonDuration: 30, targetType: 'empty' },
  { cardId: 'soul_drain', name: 'Soul Drain', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['mystic'], tags: ['necromancy', 'shadow', 'magic'], description: 'Rip the soul from an enemy, dealing shadow damage and restoring your health', effects: [{ type: 'damage', element: 'shadow', base: 14, scaling: 'acumen', factor: 0.4, description: 'Shadow damage with lifesteal' }], icon: 'skills/Enchantment/', combatType: 'damage', element: 'shadow', damageType: 'shadow', baseDamage: 14, range: 4, manaCost: 12, aoeRadius: 0, cooldown: 2, scalingStat: 'acumen', scalingFactor: 0.4, lifesteal: 0.40, targetType: 'enemy' },
  { cardId: 'corpse_explosion', name: 'Corpse Explosion', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', tags: ['necromancy', 'shadow', 'magic'], effects: [{ type: 'damage', element: 'dark', base: 35, scaling: 'acumen', factor: 0.6 }], icon: 'skills/Enchantment/', combatType: 'damage', element: 'dark', baseDamage: 35, range: 4, manaCost: 25, aoeRadius: 2, cooldown: 4, scalingStat: 'acumen', scalingFactor: 0.6, targetType: 'enemy' },
  { cardId: 'death_grip', name: 'Death Grip', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'tactician', archetypeSecondary: ['warrior'], tags: ['necromancy', 'shadow', 'magic'], description: 'Grip an enemy with necrotic tendrils, rooting them and dealing shadow damage over time', effects: [{ type: 'damage', element: 'shadow', base: 12, scaling: 'acumen', factor: 0.3, description: 'Shadow damage + root' }, { type: 'crowd_control', ccType: 'root', duration: 2, description: 'Roots target in place' }], icon: 'skills/Enchantment/', combatType: 'debuff', element: 'shadow', damageType: 'shadow', baseDamage: 12, range: 4, manaCost: 18, aoeRadius: 0, cooldown: 4, scalingStat: 'acumen', scalingFactor: 0.3, statusEffect: 'death_grip', statusDuration: 2, targetType: 'enemy', onHitStatus: { name: 'rooted', duration: 2, speedMult: 0, tickDamage: 6, tickElement: 'shadow', type: 'debuff' } },
  { cardId: 'bone_armor', name: 'Bone Armor', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'warrior', archetypeSecondary: ['warrior'], tags: ['necromancy', 'shadow', 'magic'], description: 'Encase yourself in bones of the fallen, gaining shadow-element armor', effects: [{ type: 'shield', base: 40, scaling: 'acumen', factor: 0.4, description: 'Shadow defense shield' }], icon: 'skills/Enchantment/', combatType: 'buff', range: 0, manaCost: 14, aoeRadius: 0, cooldown: 4, statusEffect: 'bone_armor', statusDuration: 3, armorBoost: 10, targetType: 'self' },
  { cardId: 'death_aura', name: 'Death Aura', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', archetypeSecondary: ['mystic'], tags: ['necromancy', 'shadow', 'magic'], description: 'Enemies near you take shadow damage each turn', effects: [{ type: 'shadow_aura', value: 8, description: 'Shadow damage to nearby enemies per turn' }], icon: 'skills/Enchantment/', combatPassive: { type: 'poison_aura', damage: 8, element: 'shadow', range: 1, value: 8 } },
  { cardId: 'death_pact', name: 'Death Pact', type: 'passive_perk', rarity: 'legendary', archetype: 'mystic', tags: ['necromancy', 'shadow', 'magic'], effects: [{ type: 'on_kill_heal', value: 0.15 }, { type: 'xp_bonus_skill', skill: 'necromancy', value: 0.30 }], icon: 'skills/Enchantment/', combatPassive: { type: 'heal_on_kill', value: 20 } },
  { cardId: 'necromancy_xp', name: 'Dark Apprentice', type: 'passive_perk', rarity: 'common', archetype: 'mystic', tags: ['necromancy', 'shadow', 'magic'], effects: [{ type: 'xp_bonus_skill', skill: 'necromancy', value: 0.15 }], icon: 'skills/Enchantment/' },

  // === SKILL XP CARDS (expanded skill list) ===
  { cardId: 'animal_handling_xp', name: 'Beast Friend', type: 'passive_perk', rarity: 'common', archetype: 'tactician', tags: ['exploration'], effects: [{ type: 'xp_bonus_skill', skill: 'animal_handling', value: 0.15 }], icon: 'skills/Herbalism/' },
  { cardId: 'psychology_xp', name: 'Mind Reader', type: 'passive_perk', rarity: 'common', archetype: 'mystic', tags: ['social'], effects: [{ type: 'xp_bonus_skill', skill: 'psychology', value: 0.15 }], icon: 'skills/Enchantment/' },
  { cardId: 'weather_magic_xp', name: 'Storm Caller', type: 'passive_perk', rarity: 'common', archetype: 'mystic', tags: ['magic'], effects: [{ type: 'xp_bonus_skill', skill: 'weather_magic', value: 0.15 }], icon: 'skills/Enchantment/' },
  { cardId: 'survival_xp', name: 'Survivalist', type: 'passive_perk', rarity: 'common', archetype: 'tactician', tags: ['exploration'], effects: [{ type: 'xp_bonus_skill', skill: 'survival', value: 0.15 }], icon: 'skills/Blacksmith/' },
  { cardId: 'anatomy_xp', name: 'Anatomist', type: 'passive_perk', rarity: 'common', archetype: 'mystic', tags: ['exploration'], effects: [{ type: 'xp_bonus_skill', skill: 'anatomy', value: 0.15 }], icon: 'skills/Herbalism/' },

  // === LIFE MAGIC CARDS ===
  { cardId: 'life_magic_xp', name: 'Healer Initiate', type: 'passive_perk', rarity: 'common', archetype: 'tactician', effects: [{ type: 'xp_bonus_skill', skill: 'life_magic', value: 0.15 }], icon: 'skills/Skill_Heal.PNG' },
  { cardId: 'healing_light', name: 'Healing Light', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'mystic', tags: ['life_magic', 'holy', 'magic'], description: 'Channel holy light to mend wounds of a single target', effects: [{ type: 'heal', base: 22, scaling: 'acumen', factor: 0.4, description: 'Single target heal' }], icon: 'skills/Skill_Heal.PNG', combatType: 'healing', element: 'holy', baseHeal: 22, range: 5, manaCost: 10, aoeRadius: 0, cooldown: 2, scalingStat: 'acumen', scalingFactor: 0.4, targetType: 'ally' },
  { cardId: 'mass_heal', name: 'Mass Heal', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['warrior'], tags: ['life_magic', 'holy', 'magic'], description: 'Unleash a wave of healing light that restores health to all allies', effects: [{ type: 'heal_all', base: 25, scaling: 'resolve', factor: 0.4 }], icon: 'skills/Skill_Heal.PNG', combatType: 'healing', element: 'holy', baseHeal: 25, range: 0, manaCost: 35, aoeRadius: 0, cooldown: 5, scalingStat: 'resolve', scalingFactor: 0.4, targetType: 'all_allies' },
  // [REMOVED: life_resurrection - duplicate of resurrection card at line 831]
  { cardId: 'divine_grace', name: 'Divine Grace', type: 'passive_perk', rarity: 'legendary', archetype: 'mystic', tags: ['life_magic', 'holy', 'magic'], effects: [{ type: 'heal_power_bonus', value: 0.25 }, { type: 'xp_bonus_skill', skill: 'life_magic', value: 0.20 }], icon: 'skills/Skill_Heal.PNG', combatPassive: { type: 'hp_regen', value: 4 } },

  // === CLERIC / PURIFIER CARDS (support archetype — corruption cleansing role) ===
  { cardId: 'purifying_light', name: 'Purifying Light', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', tags: ['holy', 'magic', 'cleanse'], description: 'A burst of holy light that cleanses corruption from allies and damages undead.',
    effects: [{ type: 'cleanse_debuff', targets: 'all_allies' }, { type: 'damage', element: 'holy', base: 20, scaling: 'resolve', factor: 0.4 }],
    icon: 'skills/Skill_Heal.PNG', combatType: 'healing', element: 'holy', baseHeal: 0, baseDamage: 20, range: 3, manaCost: 18, aoeRadius: 2, cooldown: 4, scalingStat: 'resolve', scalingFactor: 0.4, targetType: 'all_allies',
    statusCleanse: ['corruption', 'slow', 'bleed', 'doom'] },
  { cardId: 'sanctified_ward', name: 'Sanctified Ward', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['warrior'], tags: ['holy', 'magic', 'cleanse'], description: 'Places a holy ward that reduces corruption damage by 50% and heals allies within.',
    effects: [{ type: 'ground_zone', zoneType: 'sanctified_ward', radius: 2, duration: 4, healPerTurn: 15, corruptionResist: 0.5 }],
    icon: 'skills/Skill_Heal.PNG', combatType: 'buff', range: 3, manaCost: 25, aoeRadius: 2, cooldown: 6, scalingStat: 'resolve', scalingFactor: 0.3, targetType: 'ground' },
  { cardId: 'corruption_resistance', name: 'Corruption Resistance', type: 'passive_perk', rarity: 'uncommon', archetype: 'mystic', tags: ['holy', 'cleanse'], description: 'Reduces corruption damage taken by 30%.',
    effects: [{ type: 'corruption_resist', value: 0.30 }], icon: 'skills/Skill_Heal.PNG', combatPassive: { type: 'corruption_resist', value: 0.30 } },
  { cardId: 'holy_bulwark', name: 'Holy Bulwark', type: 'passive_perk', rarity: 'rare', archetype: 'mystic', archetypeSecondary: ['warrior'], tags: ['holy', 'magic', 'cleanse'], description: 'Grants +15% healing power and immunity to corruption slow effects.',
    effects: [{ type: 'heal_power_bonus', value: 0.15 }, { type: 'corruption_slow_immunity', value: true }],
    icon: 'skills/Skill_Heal.PNG', combatPassive: { type: 'hp_regen', value: 2 } },
  { cardId: 'beacon_of_hope', name: 'Beacon of Hope', type: 'active_ability', rarity: 'legendary', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['warrior'], tags: ['holy', 'magic', 'cleanse', 'life_magic'], description: 'Massive AoE heal that cleanses all debuffs, grants corruption immunity for 3 turns, and damages all undead enemies.',
    effects: [{ type: 'heal_all', base: 40, scaling: 'resolve', factor: 0.6 }, { type: 'cleanse_all_debuffs', targets: 'all_allies' }, { type: 'corruption_immunity', duration: 3 }, { type: 'damage_undead', base: 50, scaling: 'resolve', factor: 0.5 }],
    icon: 'skills/Skill_Heal.PNG', combatType: 'healing', element: 'holy', baseHeal: 40, baseDamage: 50, range: 0, manaCost: 40, aoeRadius: 0, cooldown: 8, scalingStat: 'resolve', scalingFactor: 0.6, targetType: 'all_allies',
    statusCleanse: ['all'] },
  { cardId: 'clerics_devotion', name: "Cleric's Devotion", type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic', tags: ['holy', 'magic', 'cleanse'], description: 'Healing spells also cleanse 1 random debuff. +20% healing power in corrupted areas.',
    effects: [{ type: 'heal_cleanse_random', value: 1 }, { type: 'corruption_area_heal_bonus', value: 0.20 }],
    icon: 'skills/Skill_Heal.PNG', combatPassive: { type: 'hp_regen', value: 3 } },
  { cardId: 'purifiers_oath', name: "Purifier's Oath", type: 'passive_perk', rarity: 'legendary', archetype: 'mystic', archetypeSecondary: ['warrior'], tags: ['holy', 'magic', 'cleanse'], description: 'Grants +25% damage to undead, +50% corruption resistance, and purification crystals are 50% more effective.',
    effects: [{ type: 'damage_bonus_undead', value: 0.25 }, { type: 'corruption_resist', value: 0.50 }, { type: 'purification_crystal_bonus', value: 0.50 }],
    icon: 'skills/Skill_Heal.PNG', combatPassive: { type: 'hp_regen', value: 2 } },

  // === ACTIVE OVERWORLD CORRUPTION CLEANSING CARDS ===
  // These cards let players push back corruption without purification crystals,
  // but drain HP and mana — leaving the player vulnerable afterward.
  { cardId: 'minor_purification', name: 'Minor Purification', type: 'active_overworld', rarity: 'rare', archetype: 'mystic', tags: ['holy', 'cleanse', 'overworld'],
    description: 'Channel holy energy to cleanse a small area of corruption. Drains 15% of your life force and 20 mana.',
    effects: [{ type: 'overworld_cleanse', radius: 1, cleanseAmount: 30, hpCostPct: 0.15, manaCost: 20, cooldown: 30 }],
    icon: 'skills/Skill_Heal.PNG' },
  { cardId: 'rite_of_cleansing', name: 'Rite of Cleansing', type: 'active_overworld', rarity: 'ultra_rare', archetype: 'mystic', tags: ['holy', 'cleanse', 'overworld'],
    description: 'Perform a purification rite that cleanses corruption in a moderate radius. Drains 25% of your life force and 40 mana.',
    effects: [{ type: 'overworld_cleanse', radius: 2, cleanseAmount: 45, hpCostPct: 0.25, manaCost: 40, cooldown: 60 }],
    icon: 'skills/Skill_Heal.PNG' },
  { cardId: 'divine_exorcism', name: 'Divine Exorcism', type: 'active_overworld', rarity: 'legendary', archetype: 'mystic', tags: ['holy', 'cleanse', 'overworld'],
    description: 'Unleash a devastating wave of divine power that purges corruption across a wide area. Costs 40% life force and 60 mana.',
    effects: [{ type: 'overworld_cleanse', radius: 4, cleanseAmount: 60, hpCostPct: 0.40, manaCost: 60, cooldown: 120 }],
    icon: 'skills/Skill_Heal.PNG' },
  { cardId: 'martyrs_sacrifice', name: "Martyr's Sacrifice", type: 'active_overworld', rarity: 'mythic_rare', archetype: 'mystic', archetypeSecondary: ['warrior'], tags: ['holy', 'cleanse', 'overworld', 'life_magic'],
    description: 'Sacrifice nearly all life force to unleash a massive holy purge. Cleanses a huge radius but leaves you near death and spiritually drained for 60 seconds.',
    effects: [{ type: 'overworld_cleanse', radius: 6, cleanseAmount: 80, hpCostPct: 0.70, manaCost: 999, cooldown: 300, debuff: 'spiritually_drained', debuffDuration: 60 }],
    icon: 'skills/Skill_Heal.PNG' },

  // === PROFESSION BASE CARDS (evolvable, replace tier duplicates) ===
  { cardId: 'alchemy_arts', name: 'Alchemy Arts', type: 'skill_boost', rarity: 'uncommon', archetype: 'tactician', tags: ['crafting'],
    description: 'Covers alchemy, brewing, and transmutation. Evolves into specialised mastery.',
    effects: [{ type: 'xp_bonus_skill', skill: 'alchemy', value: 0.10 }, { type: 'xp_bonus_skill', skill: 'brewing', value: 0.10 }, { type: 'xp_bonus_skill', skill: 'transmutation', value: 0.10 }, { type: 'potion_effectiveness', value: 0.05 }], icon: 'skills/Alchemy/' },
  { cardId: 'engineers_eye', name: "Engineer's Eye", type: 'skill_boost', rarity: 'uncommon', archetype: 'tactician', tags: ['crafting'],
    description: 'Covers cogworking and glassworking. Evolves into mechanical mastery.',
    effects: [{ type: 'xp_bonus_skill', skill: 'cogworking', value: 0.10 }, { type: 'xp_bonus_skill', skill: 'glassworking', value: 0.10 }, { type: 'craft_bonus', value: 0.05 }], icon: 'skills/Engineering/' },
  { cardId: 'artisan_craft', name: 'Artisan Craft', type: 'skill_boost', rarity: 'uncommon', archetype: 'tactician', tags: ['crafting'],
    description: 'Covers crafting, leatherworking, sewing, and carpentry. Evolves into master artisan.',
    effects: [{ type: 'xp_bonus_skill', skill: 'crafting', value: 0.10 }, { type: 'xp_bonus_skill', skill: 'leatherworking', value: 0.10 }, { type: 'xp_bonus_skill', skill: 'sewing', value: 0.10 }, { type: 'xp_bonus_skill', skill: 'carpentry', value: 0.10 }, { type: 'craft_quality_bonus', value: 0.05 }], icon: 'skills/Blacksmith/' },
  { cardId: 'jewelers_touch', name: "Jeweler's Touch", type: 'skill_boost', rarity: 'uncommon', archetype: 'tactician', tags: ['crafting'],
    description: 'Covers jewelcrafting. Evolves into legendary gem mastery.',
    effects: [{ type: 'xp_bonus_skill', skill: 'jewelcrafting', value: 0.15 }, { type: 'gem_yield_bonus', value: 0.10 }], icon: 'skills/Blacksmith/' },
  { cardId: 'enchanters_mark', name: "Enchanter's Mark", type: 'skill_boost', rarity: 'uncommon', archetype: 'tactician', tags: ['crafting', 'magic'],
    description: 'Covers enchanting and sigil scripting. Evolves into arcane inscription mastery.',
    effects: [{ type: 'xp_bonus_skill', skill: 'enchanting', value: 0.10 }, { type: 'xp_bonus_skill', skill: 'sigil_scripting', value: 0.10 }, { type: 'enchant_power_bonus', value: 0.05 }], icon: 'skills/Enchantment/' },

  // === ALCHEMY CARDS ===
  { cardId: 'potion_mastery', name: 'Potion Mastery', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'potion_potency_bonus', value: 0.15 }, { type: 'ingredientSaveChance', value: 0.10 }], icon: 'skills/Alchemy/' },
  { cardId: 'transmutation_adept', name: 'Transmutation Adept', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', effects: [{ type: 'transmutation_bonus', value: 0.20 }, { type: 'xp_bonus_skill', skill: 'transmutation', value: 0.20 }], icon: 'skills/Alchemy/' },
  { cardId: 'philosophers_wisdom', name: "Philosopher's Wisdom", type: 'passive_perk', rarity: 'legendary', archetype: 'tactician', effects: [{ type: 'potion_potency_bonus', value: 0.25 }, { type: 'ingredientSaveChance', value: 0.15 }, { type: 'doublePotionChance', value: 0.12 }], icon: 'skills/Alchemy/' },

  // === ENCHANTING CARDS ===
  { cardId: 'arcane_infusion_craft', name: 'Arcane Infusion', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'enchant_power_bonus', value: 0.15 }, { type: 'ingredientSaveChance', value: 0.08 }], icon: 'skills/Enchantment/' },
  { cardId: 'master_enchanter_card', name: 'Master Enchanter', type: 'passive_perk', rarity: 'legendary', archetype: 'tactician', effects: [{ type: 'enchant_power_bonus', value: 0.30 }, { type: 'doubleEnchantChance', value: 0.10 }], icon: 'skills/Enchantment/' },

  // === ANIMAL HANDLING CARDS ===
  { cardId: 'tame_beast', name: 'Tame Beast', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'tactician', effects: [{ type: 'tame', successChance: 0.30 }], icon: 'skills/Herbalism/', combatType: 'utility', range: 3, manaCost: 15, aoeRadius: 0, cooldown: 10, targetType: 'enemy' },
  { cardId: 'pack_leader', name: 'Pack Leader', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'pet_damage_bonus', value: 0.20 }, { type: 'pet_health_bonus', value: 0.15 }], icon: 'skills/Herbalism/' },
  { cardId: 'beast_master', name: 'Beast Master', type: 'passive_perk', rarity: 'legendary', archetype: 'tactician', effects: [{ type: 'pet_damage_bonus', value: 0.35 }, { type: 'pet_health_bonus', value: 0.25 }, { type: 'extra_pet_slot', value: 1 }], icon: 'skills/Herbalism/' },

  // === PSYCHOLOGY & BARDIC CARDS (merged skill: debuffs, crowd control, buffs, performance) ===
  { cardId: 'terrifying_shout', name: 'Terrifying Shout', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'tactician', archetypeSecondary: ['mystic'], tags: ['psychology', 'bardic'], description: 'Unleash a terrifying shout that causes enemies to deal less damage and may flee', effects: [{ type: 'debuff_aoe', stat: 'damage', value: -0.30, duration: 8, description: 'Enemies deal -30% damage, chance to flee' }, { type: 'crowd_control', ccType: 'fear', chance: 0.30, duration: 1 }], icon: 'skills/Enchantment/', combatType: 'debuff', range: 0, manaCost: 20, aoeRadius: 3, cooldown: 4, statusEffect: 'terrified_shout', statusDuration: 3, targetType: 'all_enemies', onHitStatus: { name: 'terrified', duration: 2, damageReduction: 0.30, fleeChance: 0.30, type: 'debuff' } },
  { cardId: 'demoralize', name: 'Demoralize', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'tactician', tags: ['psychology'], effects: [{ type: 'debuff', stat: 'damage', value: -0.15, duration: 10 }], icon: 'skills/Enchantment/', combatType: 'debuff', range: 4, manaCost: 10, aoeRadius: 0, cooldown: 3, statusEffect: 'demoralized', statusDuration: 3, targetType: 'enemy' },
  { cardId: 'terrify', name: 'Terrify', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'tactician', tags: ['psychology'], effects: [{ type: 'crowd_control', ccType: 'fear', duration: 2 }], icon: 'skills/Enchantment/', combatType: 'debuff', range: 3, manaCost: 18, aoeRadius: 0, cooldown: 4, statusEffect: 'terrified', statusDuration: 2, targetType: 'enemy' },
  { cardId: 'mind_break', name: 'Mind Break', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'tactician', tags: ['psychology', 'arcane', 'magic'], description: 'Assault an enemy mind with psychic force, dealing arcane damage with a chance to stun', effects: [{ type: 'damage', element: 'arcane', base: 28, scaling: 'acumen', factor: 0.5, description: 'Arcane psychic damage' }, { type: 'crowd_control', ccType: 'stun', chance: 0.35, duration: 1, description: '35% chance to stun' }], icon: 'skills/Enchantment/', combatType: 'damage', element: 'arcane', damageType: 'arcane', baseDamage: 28, range: 4, manaCost: 18, aoeRadius: 0, cooldown: 3, scalingStat: 'acumen', scalingFactor: 0.5, targetType: 'enemy', onHitStatus: { name: 'stunned', duration: 1, chance: 0.35, type: 'debuff' } },
  { cardId: 'bardic_melody', name: 'Bardic Melody', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'mystic', archetypeSecondary: ['mystic'], tags: ['psychology', 'bardic', 'magic'], description: 'Play an enchanting melody that regenerates HP and mana for all allies', effects: [{ type: 'heal_over_time', base: 6, ticks: 4, description: 'HP regen to all allies' }, { type: 'mana_regen_buff', value: 3, duration: 12, description: 'Mana regen to all allies' }], icon: 'skills/Enchantment/', combatType: 'buff', range: 0, manaCost: 22, aoeRadius: 0, cooldown: 5, statusEffect: 'bardic_melody', statusDuration: 4, healPerTurn: 6, manaPerTurn: 3, targetType: 'all_allies' },
  { cardId: 'battle_hymn', name: 'Battle Hymn', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'focus', archetype: 'mystic', archetypeSecondary: ['warrior'], tags: ['psychology', 'bardic'], effects: [{ type: 'buff_all', stat: 'all', value: 0.10, duration: 20 }], icon: 'skills/Enchantment/', combatType: 'buff', range: 0, manaCost: 25, aoeRadius: 0, cooldown: 6, statusEffect: 'battle_hymn', statusDuration: 4, damageBoost: 4, armorBoost: 4, targetType: 'all_allies' },

  // === WEATHER MAGIC CARDS ===
  { cardId: 'call_lightning', name: 'Call Lightning', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', tags: ['weather_magic', 'magic'], effects: [{ type: 'damage', element: 'lightning', base: 30, scaling: 'acumen', factor: 0.6 }], icon: 'skills/Skill_Explosion.PNG', combatType: 'damage', element: 'lightning', baseDamage: 30, range: 5, manaCost: 22, aoeRadius: 1, cooldown: 4, scalingStat: 'acumen', scalingFactor: 0.6, targetType: 'enemy' },
  { cardId: 'blizzard', name: 'Blizzard', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['tactician'], tags: ['weather_magic', 'magic'], description: 'Summon a howling blizzard that freezes the ground and deals ice damage to all in the area', effects: [{ type: 'damage', element: 'ice', base: 30, scaling: 'acumen', factor: 0.5, description: 'AoE ice damage' }, { type: 'slow', value: 0.40, duration: 3, description: 'Slows enemies by 40%' }], icon: 'skills/Skill_Explosion.PNG', combatType: 'tile_effect', tileEffect: 'FROZEN', element: 'ice', damageType: 'ice', baseDamage: 30, range: 5, manaCost: 28, aoeRadius: 2, cooldown: 5, scalingStat: 'acumen', scalingFactor: 0.5, targetType: 'any', onHitStatus: { name: 'chilled', duration: 3, speedMult: 0.6, tickDamage: 5, type: 'debuff' } },
  { cardId: 'fog_bank', name: 'Fog Bank', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['rogue'], tags: ['weather_magic', 'magic'], description: 'Create a thick fog bank that grants allies increased dodge chance', effects: [{ type: 'buff_all', stat: 'dodge', value: 0.30, duration: 12, description: '+30% dodge for allies in fog' }], icon: 'skills/Enchantment/', combatType: 'buff', element: 'wind', range: 0, manaCost: 14, aoeRadius: 2, cooldown: 4, statusEffect: 'fog_bank', statusDuration: 3, dodgeBoost: 0.30, targetType: 'all_allies' },
  { cardId: 'tempest', name: 'Tempest', type: 'active_ability', rarity: 'legendary', resourceType: 'mana', archetype: 'mystic', tags: ['weather_magic', 'magic'], effects: [{ type: 'damage', element: 'lightning', base: 50, scaling: 'acumen', factor: 0.8 }], icon: 'skills/Skill_Explosion.PNG', combatType: 'damage', element: 'lightning', baseDamage: 50, range: 5, manaCost: 40, aoeRadius: 3, cooldown: 6, scalingStat: 'acumen', scalingFactor: 0.8, targetType: 'enemy' },

  // === JEWELCRAFTING CARDS ===
  { cardId: 'master_jeweler_card', name: 'Master Jeweler', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', effects: [{ type: 'craft_quality_bonus', value: 0.15 }, { type: 'gem_yield_bonus', value: 0.20 }], icon: 'skills/Blacksmith/' },

  // === HARVESTING / MISC CARDS ===
  // === ANATOMY CARDS ===
  { cardId: 'crippling_blow', name: 'Crippling Blow', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'tactician', tags: ['anatomy', 'melee'], description: 'Target a joint or tendon, dealing damage and reducing enemy speed and attack power', effects: [{ type: 'damage', element: 'physical', base: 22, scaling: 'finesse', factor: 0.5, description: 'Physical damage + cripple' }, { type: 'debuff', stat: 'speed', value: -0.30, duration: 8, description: 'Reduce speed and damage' }], icon: 'skills/Skill_SwordAttack.PNG', combatType: 'damage', baseDamage: 22, range: 1, manaCost: 14, aoeRadius: 0, cooldown: 3, scalingStat: 'finesse', scalingFactor: 0.5, targetType: 'enemy', onHitStatus: { name: 'crippled', duration: 3, speedMult: 0.5, damageReduction: 0.20, type: 'debuff' } },
  { cardId: 'vital_strike', name: 'Vital Strike', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'bloodlust', archetype: 'rogue', archetypeSecondary: ['warrior'], tags: ['anatomy', 'melee'], description: 'Target a vital organ for massive damage against wounded enemies below 30% HP', effects: [{ type: 'damage', element: 'physical', base: 45, scaling: 'finesse', factor: 0.7, description: 'Execute: massive damage to targets below 30% HP' }], icon: 'skills/Skill_SwordAttack.PNG', combatType: 'damage', baseDamage: 45, range: 1, manaCost: 20, aoeRadius: 0, cooldown: 4, scalingStat: 'finesse', scalingFactor: 0.7, targetType: 'enemy', executeThreshold: 0.30, executeBonusDamage: 1.0 },
  { cardId: 'pressure_points', name: 'Pressure Points', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'tactician', archetypeSecondary: ['warrior'], tags: ['anatomy', 'melee'], description: 'Strike precise nerve clusters to stun the target for 2 turns', effects: [{ type: 'crowd_control', ccType: 'stun', duration: 2, description: 'Stun target for 2 turns' }], icon: 'skills/Skill_SwordAttack.PNG', combatType: 'debuff', baseDamage: 8, range: 1, manaCost: 16, aoeRadius: 0, cooldown: 4, scalingStat: 'finesse', scalingFactor: 0.3, statusEffect: 'stunned', statusDuration: 2, targetType: 'enemy', onHitStatus: { name: 'stunned', duration: 2, type: 'debuff' } },
  { cardId: 'field_surgery', name: 'Field Surgery', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'mystic', archetypeSecondary: ['utility'], tags: ['anatomy', 'healing'], description: 'Use anatomical knowledge to heal an ally and remove one debuff', effects: [{ type: 'heal', base: 30, scaling: 'finesse', factor: 0.4, description: 'Heal ally' }, { type: 'cleanse', removeDebuffs: 1, description: 'Remove one debuff' }], icon: 'skills/Skill_Heal.PNG', combatType: 'healing', baseHeal: 30, range: 1, manaCost: 14, aoeRadius: 0, cooldown: 3, scalingStat: 'finesse', scalingFactor: 0.4, targetType: 'ally' },
  { cardId: 'gourmand', name: 'Gourmand', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', effects: [{ type: 'food_duration_bonus', value: 0.20 }, { type: 'xp_bonus_skill', skill: 'gourmand', value: 0.15 }], icon: 'skills/Cooking_fishing/' },

  // === DURABILITY & REPAIR CARDS (Blacksmithing) ===
  { cardId: 'master_mender', name: 'Master Mender', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', rarityScalable: true, effects: [{ type: 'repair_cost_reduction', value: 0.25 }], icon: 'skills/Blacksmith/', description: '-25% repair resource cost' },
  { cardId: 'durable_craft', name: 'Durable Craft', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', rarityScalable: true, effects: [{ type: 'crafted_durability_bonus', value: 0.15 }], icon: 'skills/Blacksmith/', description: '+15% max durability on crafted items' },
  { cardId: 'emergency_patch', name: 'Emergency Patch', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'tactician', effects: [{ type: 'field_repair', percent: 0.10, cooldown: 600 }], icon: 'skills/Blacksmith/', description: 'Repair 10% durability without station (10 min cooldown)' },
  { cardId: 'indestructible', name: 'Indestructible', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician', rarityScalable: true, effects: [{ type: 'indestructible_chance', value: 0.05 }], icon: 'skills/Blacksmith/', description: '5% chance to not lose durability' },
  { cardId: 'salvage_expert', name: 'Salvage Expert', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', rarityScalable: true, effects: [{ type: 'salvage_return', value: 0.50 }], icon: 'skills/Blacksmith/', description: 'Broken items can be salvaged for 50% materials' },
  { cardId: 'whetstone', name: 'Whetstone', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', rarityScalable: true, effects: [{ type: 'weapon_durability_bonus', value: 0.10 }], icon: 'skills/Blacksmith/', description: '+10% weapon durability (reduces loss rate)' },
  { cardId: 'armorsmith', name: 'Armorsmith', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', rarityScalable: true, effects: [{ type: 'armor_durability_bonus', value: 0.10 }], icon: 'skills/Blacksmith/', description: '+10% armor durability (reduces loss rate)' },
  { cardId: 'quick_fix', name: 'Quick Fix', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', effects: [{ type: 'repair_speed_bonus', value: 0.50 }, { type: 'repair_cost_reduction', value: 0.10 }], icon: 'skills/Blacksmith/', description: '50% faster repair, 10% cheaper repairs' },

  // ========================================================================
  // BATCH 2: Crafting/Gathering/Utility Active Abilities & Impactful Passives
  // ========================================================================

  // === ALCHEMY ACTIVE ABILITIES ===

  { cardId: 'healing_elixir', name: 'Healing Elixir', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'mystic',
    tags: ['alchemy', 'crafting'],
    description: 'Quickly administer a potent healing elixir brewed from rare reagents',
    effects: [{ type: 'heal', base: 30, scaling: 'ingenuity', factor: 0.4 }],
    icon: 'skills/Alchemy/',
    combatType: 'healing', baseHeal: 30,
    range: 1, manaCost: 10, aoeRadius: 0, cooldown: 3,
    scalingStat: 'ingenuity', scalingFactor: 0.4,
    targetType: 'ally' },


  { cardId: 'transmute_shield', name: 'Transmute Shield', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'warrior',
    tags: ['alchemy', 'crafting'],
    description: 'Transmute ambient matter into a shimmering alchemical barrier that absorbs incoming damage',
    effects: [{ type: 'shield', base: 30, scaling: 'ingenuity', factor: 0.4 }],
    icon: 'skills/Alchemy/',
    combatType: 'buff',
    range: 0, manaCost: 12, aoeRadius: 0, cooldown: 3,
    statusEffect: 'transmute_shield', statusDuration: 3, armorBoost: 6,
    targetType: 'self' },

  { cardId: 'acid_splash', name: 'Acid Splash', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'tactician', archetypeSecondary: ['mystic'],
    tags: ['alchemy', 'poison', 'crafting'],
    description: 'Splash concentrated acid that eats through armor and leaves a lingering poison burn',
    effects: [{ type: 'damage', element: 'poison', base: 14, scaling: 'ingenuity', factor: 0.35 }],
    icon: 'skills/Alchemy/',
    combatType: 'damage', element: 'poison', baseDamage: 14,
    range: 3, manaCost: 8, aoeRadius: 0, cooldown: 2,
    scalingStat: 'ingenuity', scalingFactor: 0.35,
    onHitStatus: { name: 'acid_burn', duration: 3, armorReduction: 6, tickDamage: 3, type: 'debuff' },
    targetType: 'enemy' },

  { cardId: 'philosophers_boost', name: "Philosopher's Boost", type: 'active_ability', rarity: 'ultra_rare', resourceType: 'focus', archetype: 'mystic',
    tags: ['alchemy', 'crafting'],
    description: 'Consume a dose of the legendary philosopher\'s elixir, temporarily amplifying all attributes',
    effects: [{ type: 'buff', stat: 'all', value: 0.30, duration: 20 }],
    icon: 'skills/Alchemy/',
    combatType: 'buff',
    range: 0, manaCost: 30, aoeRadius: 0, cooldown: 6,
    statusEffect: 'philosophers_boost', statusDuration: 5,
    statBoost: { vigor: 4, might: 4, finesse: 4, acumen: 4, resolve: 4, ingenuity: 4 },
    targetType: 'self' },

  // === ENCHANTING ACTIVE ABILITIES ===
  { cardId: 'mana_surge', name: 'Mana Surge', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic',
    tags: ['enchanting', 'magic'],
    description: 'Channel enchanting expertise to violently restore mana from ambient arcane energy',
    effects: [{ type: 'mana_restore', percent: 0.30 }],
    icon: 'skills/Enchantment/',
    combatType: 'buff',
    range: 0, manaCost: 0, aoeRadius: 0, cooldown: 5,
    statusEffect: 'mana_surge', statusDuration: 1,
    manaRestore: 0.30,
    targetType: 'self' },

  { cardId: 'arcane_disruption', name: 'Arcane Disruption', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic',
    tags: ['enchanting', 'magic'],
    description: 'Unleash a pulse of raw arcane energy that damages and strips away enemy magical protections',
    effects: [{ type: 'damage', element: 'arcane', base: 22, scaling: 'acumen', factor: 0.5 }, { type: 'dispel', removeBuffs: 2 }],
    icon: 'skills/Enchantment/',
    combatType: 'damage', element: 'arcane', baseDamage: 22,
    range: 4, manaCost: 18, aoeRadius: 0, cooldown: 3,
    scalingStat: 'acumen', scalingFactor: 0.5,
    dispelBuffs: 2,
    targetType: 'enemy' },

  { cardId: 'enchant_weapon', name: 'Enchant Weapon', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'mystic',
    tags: ['enchanting', 'magic'],
    description: 'Temporarily infuse an ally\'s weapon with crackling arcane energy, adding bonus elemental damage',
    effects: [{ type: 'buff', duration: 15 }],
    icon: 'skills/Enchantment/',
    combatType: 'buff',
    range: 3, manaCost: 14, aoeRadius: 0, cooldown: 4,
    statusEffect: 'enchanted_weapon', statusDuration: 4,
    damageBoost: 5, bonusElement: 'arcane',
    targetType: 'ally' },

  { cardId: 'spell_reflection', name: 'Spell Reflection', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'warrior',
    tags: ['enchanting', 'magic'],
    description: 'Weave a reflective enchantment that bounces the next hostile spell back at its caster',
    effects: [{ type: 'reflect_magic', charges: 1, duration: 10 }],
    icon: 'skills/Enchantment/',
    combatType: 'buff',
    range: 0, manaCost: 22, aoeRadius: 0, cooldown: 5,
    statusEffect: 'spell_reflection', statusDuration: 3,
    reflectMagic: true, reflectCharges: 1,
    targetType: 'self' },

  { cardId: 'nullify_magic', name: 'Nullify Magic', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'tactician',
    tags: ['enchanting', 'magic'],
    description: 'Sever an enemy\'s connection to the arcane, silencing their ability to cast spells',
    effects: [{ type: 'crowd_control', ccType: 'silence', duration: 6 }],
    icon: 'skills/Enchantment/',
    combatType: 'debuff',
    range: 4, manaCost: 16, aoeRadius: 0, cooldown: 4,
    statusEffect: 'silenced', statusDuration: 2,
    targetType: 'enemy' },

  // === BREWING ACTIVE ABILITIES ===




  // === ANIMAL HANDLING ACTIVE ABILITIES ===
  { cardId: 'call_beast', name: 'Call Beast', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'tactician',
    tags: ['animal_handling'],
    description: 'Whistle sharply to summon a wild beast ally from the surrounding terrain to fight at your side',
    effects: [{ type: 'summon', summonType: 'beast', duration: 30 }],
    icon: 'skills/Herbalism/',
    combatType: 'summon',
    range: 2, manaCost: 18, aoeRadius: 0, cooldown: 5,
    summonType: 'wild_beast', summonHp: 45, summonDamage: 10, summonDuration: 4,
    targetType: 'any' },

  { cardId: 'sic_em', name: "Sic 'Em", type: 'active_ability', rarity: 'uncommon', resourceType: 'bloodlust', archetype: 'warrior',
    tags: ['animal_handling'],
    description: 'Command your beast companion to lunge and attack with savage ferocity',
    effects: [{ type: 'damage', element: 'physical', base: 20, scaling: 'presence', factor: 0.4 }],
    icon: 'skills/Herbalism/',
    combatType: 'damage', baseDamage: 20,
    range: 3, manaCost: 6, aoeRadius: 0, cooldown: 2,
    scalingStat: 'presence', scalingFactor: 0.4,
    requiresPet: true,
    targetType: 'enemy' },

  { cardId: 'pack_tactics', name: 'Pack Tactics', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'mystic', archetypeSecondary: ['warrior'],
    tags: ['animal_handling'],
    description: 'Coordinate with nearby beast companions, granting a damage bonus to all allies in range',
    effects: [{ type: 'buff_all', duration: 15 }],
    icon: 'skills/Herbalism/',
    combatType: 'buff',
    range: 0, manaCost: 14, aoeRadius: 3, cooldown: 4,
    statusEffect: 'pack_tactics', statusDuration: 3,
    damageBoost: 4,
    requiresPet: true,
    targetType: 'all_allies' },

  { cardId: 'beast_form', name: 'Beast Form', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'bloodlust', archetype: 'warrior', archetypeSecondary: ['warrior'],
    tags: ['animal_handling'],
    description: 'Channel primal energy to transform into a ferocious beast, gaining devastating melee power but losing spellcasting',
    effects: [{ type: 'transform', form: 'beast', duration: 20 }],
    icon: 'skills/Herbalism/',
    combatType: 'buff',
    range: 0, manaCost: 25, aoeRadius: 0, cooldown: 6,
    statusEffect: 'beast_form', statusDuration: 4,
    statBoost: { might: 6, finesse: 3 }, damageBoost: 8,
    silencesSelf: true,
    targetType: 'self' },


  // === HERBALISM ACTIVE ABILITIES ===

  { cardId: 'poison_resistance_herb', name: 'Poison Resistance', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'mystic',
    tags: ['herbalism', 'crafting'],
    description: 'Administer a potent herbal antidote that grants temporary immunity to all poison effects',
    effects: [{ type: 'buff', duration: 30 }],
    icon: 'skills/Herbalism/',
    combatType: 'buff',
    range: 1, manaCost: 10, aoeRadius: 0, cooldown: 5,
    statusEffect: 'poison_immune', statusDuration: 5,
    immunities: ['poison'],
    targetType: 'ally' },

  { cardId: 'entangle', name: 'Entangle', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'tactician', archetypeSecondary: ['warrior'],
    tags: ['herbalism', 'crafting'],
    description: 'Scatter enchanted seeds that erupt into grasping vines, rooting enemies in the area',
    effects: [{ type: 'tile', element: 'nature' }],
    icon: 'skills/Herbalism/',
    combatType: 'tile_effect', tileEffect: 'BRAMBLE',
    range: 4, manaCost: 14, aoeRadius: 2, cooldown: 4,
    onHitStatus: { name: 'rooted', duration: 2, speedMult: 0, type: 'debuff' },
    targetType: 'any' },

  { cardId: 'herbal_stimulant', name: 'Herbal Stimulant', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'mystic',
    tags: ['herbalism', 'crafting'],
    description: 'Chew a handful of stimulating herbs that sharpen reflexes and restore mental clarity',
    effects: [{ type: 'buff', duration: 15 }],
    icon: 'skills/Herbalism/',
    combatType: 'buff',
    range: 0, manaCost: 6, aoeRadius: 0, cooldown: 3,
    statusEffect: 'herbal_stimulant', statusDuration: 4,
    speedMult: 1.2, manaRegenBoost: 2,
    targetType: 'self' },

  // === SURVIVAL ACTIVE ABILITIES ===


  { cardId: 'second_wind_active', name: 'Second Wind', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'warrior', archetypeSecondary: ['warrior'],
    tags: ['survival'],
    description: 'Dig deep and rally your body in a moment of crisis, rapidly healing when near death',
    effects: [{ type: 'heal', base: 40, scaling: 'vigor', factor: 0.5, requiresLowHp: true }],
    icon: 'skills/Blacksmith/',
    combatType: 'healing', baseHeal: 40,
    range: 0, manaCost: 0, aoeRadius: 0, cooldown: 6,
    scalingStat: 'vigor', scalingFactor: 0.5,
    requiresLowHp: 0.25,
    targetType: 'self' },

  { cardId: 'endure', name: 'Endure', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina', archetype: 'warrior',
    tags: ['survival'],
    description: 'Steel yourself against the onslaught, drastically reducing all incoming damage for a short time',
    effects: [{ type: 'buff', duration: 6 }],
    icon: 'skills/Blacksmith/',
    combatType: 'buff',
    range: 0, manaCost: 5, aoeRadius: 0, cooldown: 4,
    statusEffect: 'endure', statusDuration: 2,
    damageReduction: 0.50,
    targetType: 'self' },

  // === SKINNING ACTIVE ABILITIES ===
  { cardId: 'flaying_strike', name: 'Flaying Strike', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina', archetype: 'warrior',
    tags: ['skinning'],
    description: 'A precise slashing technique honed from skinning, dealing devastating bonus damage against beasts',
    effects: [{ type: 'damage', element: 'physical', base: 18, scaling: 'finesse', factor: 0.4 }],
    icon: 'skills/Blacksmith/',
    combatType: 'damage', baseDamage: 18,
    range: 1, manaCost: 5, aoeRadius: 0, cooldown: 2,
    scalingStat: 'finesse', scalingFactor: 0.4,
    bonusVsBeast: 0.50,
    targetType: 'enemy' },

  { cardId: 'thick_hide', name: 'Thick Hide', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'warrior',
    tags: ['skinning', 'crafting'],
    description: 'Don a hastily prepared layer of thick beast hide, boosting physical damage resistance',
    effects: [{ type: 'buff', duration: 15 }],
    icon: 'skills/Blacksmith/',
    combatType: 'buff',
    range: 0, manaCost: 8, aoeRadius: 0, cooldown: 4,
    statusEffect: 'thick_hide', statusDuration: 4,
    armorBoost: 8, physicalResist: 0.25,
    targetType: 'self' },

  { cardId: 'predators_mark', name: "Predator's Mark", type: 'active_ability', rarity: 'rare', resourceType: 'bloodlust', archetype: 'tactician', archetypeSecondary: ['warrior'],
    tags: ['skinning'],
    description: 'Mark a target as prey, causing all subsequent attacks against it to deal increased damage',
    effects: [{ type: 'debuff', duration: 15 }],
    icon: 'skills/Blacksmith/',
    combatType: 'debuff',
    range: 5, manaCost: 10, aoeRadius: 0, cooldown: 4,
    statusEffect: 'predators_mark', statusDuration: 4,
    damageAmplify: 0.20,
    targetType: 'enemy' },

  // === FORAGING ACTIVE ABILITIES ===
  { cardId: 'mushroom_cloud', name: 'Mushroom Cloud', type: 'active_ability', rarity: 'rare', resourceType: 'bloodlust', archetype: 'tactician', archetypeSecondary: ['mystic'],
    tags: ['foraging', 'poison'],
    description: 'Throw a cluster of toxic spore-laden mushrooms that burst into a disorienting, poisonous cloud',
    effects: [{ type: 'tile', element: 'poison' }, { type: 'debuff', ccType: 'confusion', duration: 6 }],
    icon: 'skills/Herbalism/',
    combatType: 'tile_effect', tileEffect: 'POISONED',
    range: 4, manaCost: 14, aoeRadius: 2, cooldown: 4,
    onHitStatus: { name: 'confused', duration: 2, type: 'debuff' },
    targetType: 'any' },

  { cardId: 'berry_burst', name: 'Berry Burst', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina', archetype: 'mystic',
    tags: ['foraging'],
    description: 'Quickly consume a handful of healing berries gathered from the wild for an immediate small heal',
    effects: [{ type: 'heal', base: 18, scaling: 'vigor', factor: 0.2 }],
    icon: 'skills/Herbalism/',
    combatType: 'healing', baseHeal: 18,
    range: 0, manaCost: 0, aoeRadius: 0, cooldown: 2,
    scalingStat: 'vigor', scalingFactor: 0.2,
    targetType: 'self' },

  { cardId: 'natures_camouflage', name: "Nature's Camouflage", type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'rogue', archetypeSecondary: ['rogue'],
    tags: ['foraging', 'stealth'],
    description: 'Blend into the surrounding foliage using gathered natural materials, gaining stealth and dodge',
    effects: [{ type: 'stealth_enter', duration: 10 }, { type: 'dodge_bonus', value: 0.10 }],
    icon: 'skills/Herbalism/',
    combatType: 'buff',
    range: 0, manaCost: 10, aoeRadius: 0, cooldown: 5,
    statusEffect: 'natures_camouflage', statusDuration: 3,
    grantsStealth: true, dodgeBoost: 0.10,
    biomeBonus: ['forest', 'swamp'],
    targetType: 'self' },

  // === SIGIL SCRIPTING ACTIVE ABILITIES ===
  { cardId: 'explosive_sigil', name: 'Explosive Sigil', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic',
    tags: ['sigil_scripting', 'magic'],
    description: 'Inscribe a volatile sigil on the ground that detonates with arcane force when enemies approach',
    effects: [{ type: 'damage', element: 'arcane', base: 30, scaling: 'acumen', factor: 0.5 }],
    icon: 'skills/Enchantment/',
    combatType: 'tile_effect', tileEffect: 'RUNE_TRAP', element: 'arcane',
    range: 4, manaCost: 16, aoeRadius: 1, cooldown: 3,
    scalingStat: 'acumen', scalingFactor: 0.5,
    trapDamage: 30,
    targetType: 'any' },

  { cardId: 'ward_of_protection', name: 'Ward of Protection', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'warrior',
    tags: ['sigil_scripting', 'magic'],
    description: 'Trace a protective sigil that creates a warded area, reducing damage taken by allies within',
    effects: [{ type: 'tile', element: 'holy' }],
    icon: 'skills/Enchantment/',
    combatType: 'tile_effect', tileEffect: 'WARD',
    range: 3, manaCost: 12, aoeRadius: 2, cooldown: 4,
    wardDamageReduction: 0.20,
    targetType: 'any' },


  { cardId: 'power_sigil', name: 'Power Sigil', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'mystic',
    tags: ['sigil_scripting', 'magic'],
    description: 'Inscribe a sigil of empowerment that radiates energy, boosting ally damage in its radius',
    effects: [{ type: 'buff_all', duration: 15 }],
    icon: 'skills/Enchantment/',
    combatType: 'tile_effect', tileEffect: 'POWER_SIGIL',
    range: 3, manaCost: 22, aoeRadius: 2, cooldown: 5,
    sigilDamageBoost: 0.20, tileDuration: 4,
    targetType: 'any' },

  // === CATEGORY-SPECIFIC CLEANSE ABILITIES ===
  { cardId: 'purify_sigil', name: 'Purify Sigil', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic',
    tags: ['sigil_scripting', 'magic'],
    description: 'Channel purifying light to remove all magical debuffs from target (curses, hexes, mana burn, etc.)',
    effects: [{ type: 'cleanse', category: 'magical', cooldown: 4 }],
    combatType: 'cleanse', cleanseCategory: 'magical', range: 2, manaCost: 15, aoeRadius: 0, cooldown: 4, targetType: 'ally',
    icon: 'skills/Enchantment/' },

  // === EXPANDED SIGIL ACTIVE ABILITIES ===
  { cardId: 'healing_sigil', name: 'Healing Sigil', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic',
    tags: ['sigil_scripting', 'magic'],
    description: 'Inscribe a restorative sigil that pulses healing energy to allies standing within its radius',
    effects: [{ type: 'tile_effect', tileEffect: 'HEALING_SIGIL', baseHeal: 15, duration: 3 }],
    combatType: 'tile_effect', tileEffect: 'HEALING_SIGIL', range: 4, manaCost: 18, aoeRadius: 1, cooldown: 4,
    scalingStat: 'resolve', scalingFactor: 0.4, baseHeal: 15, tileDuration: 3, targetType: 'ground',
    icon: 'skills/Enchantment/' },
  { cardId: 'teleport_sigil', name: 'Teleport Sigil', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'tactician',
    tags: ['sigil_scripting', 'magic'],
    description: 'Etch a dimensional sigil that instantly teleports you to its location when activated',
    effects: [{ type: 'teleport', range: 6 }],
    combatType: 'teleport', range: 6, manaCost: 20, aoeRadius: 0, cooldown: 5, targetType: 'ground',
    icon: 'skills/Enchantment/' },
  { cardId: 'siphon_sigil', name: 'Siphon Sigil', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'tactician',
    tags: ['sigil_scripting', 'magic'],
    description: 'Place a parasitic sigil that drains life from enemies and transfers it to nearby allies',
    effects: [{ type: 'tile_effect', tileEffect: 'SIPHON_SIGIL', baseDamage: 8, baseHeal: 6, duration: 3 }],
    combatType: 'tile_effect', tileEffect: 'SIPHON_SIGIL', range: 4, manaCost: 16, aoeRadius: 1, cooldown: 4,
    scalingStat: 'acumen', scalingFactor: 0.3, baseDamage: 8, baseHeal: 6, tileDuration: 3, targetType: 'ground',
    icon: 'skills/Enchantment/' },
  { cardId: 'detonation_sigil', name: 'Detonation Sigil', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'mystic',
    tags: ['sigil_scripting', 'magic'],
    description: 'Inscribe a volatile sigil with a delayed detonation — explodes after 2 turns for massive damage',
    effects: [{ type: 'tile_effect', tileEffect: 'DETONATION_SIGIL', baseDamage: 60, duration: 2, detonateOnExpire: true }],
    combatType: 'tile_effect', tileEffect: 'DETONATION_SIGIL', range: 5, manaCost: 25, aoeRadius: 2, cooldown: 5,
    scalingStat: 'acumen', scalingFactor: 0.8, baseDamage: 60, tileDuration: 2, detonateOnExpire: true, targetType: 'ground',
    icon: 'skills/Skill_Explosion.PNG' },

  // === TRANSMUTATION ACTIVE ABILITIES ===
  { cardId: 'matter_conversion', name: 'Matter Conversion', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['tactician'],
    tags: ['transmutation', 'magic'],
    description: 'Transmute an enemy\'s armor into raw energy that damages them from within',
    effects: [{ type: 'damage', element: 'arcane', base: 20, scaling: 'ingenuity', factor: 0.5 }, { type: 'debuff', armorShred: true }],
    icon: 'skills/Alchemy/',
    combatType: 'damage', element: 'arcane', baseDamage: 20,
    range: 4, manaCost: 16, aoeRadius: 0, cooldown: 3,
    scalingStat: 'ingenuity', scalingFactor: 0.5,
    onHitStatus: { name: 'armor_shredded', duration: 3, armorReduction: 8, type: 'debuff' },
    targetType: 'enemy' },

  { cardId: 'elemental_shift', name: 'Elemental Shift', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'mystic',
    tags: ['transmutation', 'magic'],
    description: 'Transmute the elemental nature of your attacks to exploit an enemy\'s elemental weakness',
    effects: [{ type: 'buff', duration: 15 }],
    icon: 'skills/Alchemy/',
    combatType: 'buff',
    range: 0, manaCost: 10, aoeRadius: 0, cooldown: 3,
    statusEffect: 'elemental_shift', statusDuration: 4,
    adaptiveElement: true,
    targetType: 'self' },

  { cardId: 'dissolution', name: 'Dissolution', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'focus', archetype: 'mystic',
    tags: ['transmutation', 'magic'],
    description: 'Disassemble an enemy\'s very substance at the molecular level, ignoring all defensive protections',
    effects: [{ type: 'damage', element: 'arcane', base: 55, scaling: 'ingenuity', factor: 0.8 }],
    icon: 'skills/Alchemy/',
    combatType: 'damage', element: 'arcane', baseDamage: 55,
    range: 3, manaCost: 30, aoeRadius: 0, cooldown: 5,
    scalingStat: 'ingenuity', scalingFactor: 0.8,
    ignoresArmor: true,
    targetType: 'enemy' },

  // === LEATHERWORKING ACTIVE ABILITIES ===

  { cardId: 'leather_lash', name: 'Leather Lash', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina', archetype: 'tactician', archetypeSecondary: ['warrior'],
    tags: ['leatherworking', 'crafting'],
    description: 'Snap a hardened leather whip at the enemy, dealing damage with a chance to knock their weapon loose',
    effects: [{ type: 'damage', element: 'physical', base: 14, scaling: 'finesse', factor: 0.35 }],
    icon: 'skills/Blacksmith/',
    combatType: 'damage', baseDamage: 14,
    range: 2, manaCost: 5, aoeRadius: 0, cooldown: 2,
    scalingStat: 'finesse', scalingFactor: 0.35,
    onHitStatus: { name: 'disarmed', duration: 1, type: 'debuff' },
    disarmChance: 0.25,
    targetType: 'enemy' },

  // === CARPENTRY ACTIVE ABILITIES ===
  { cardId: 'wooden_barricade', name: 'Wooden Barricade', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'warrior',
    tags: ['carpentry', 'crafting'],
    description: 'Rapidly construct a sturdy wooden barricade that blocks enemy movement through the area',
    effects: [{ type: 'tile', element: 'physical' }],
    icon: 'skills/Blacksmith/',
    combatType: 'tile_effect', tileEffect: 'BARRICADE',
    range: 3, manaCost: 10, aoeRadius: 0, cooldown: 4,
    blocksMovement: true, barricadeHp: 50, tileDuration: 5,
    targetType: 'any' },

  { cardId: 'splinter_shot', name: 'Splinter Shot', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'warrior',
    tags: ['carpentry', 'crafting'],
    description: 'Launch a sharpened wooden spike that pierces the target and causes lingering bleeding',
    effects: [{ type: 'damage', element: 'physical', base: 16, scaling: 'finesse', factor: 0.35 }],
    icon: 'skills/Blacksmith/',
    combatType: 'damage', baseDamage: 16,
    range: 5, manaCost: 5, aoeRadius: 0, cooldown: 2,
    scalingStat: 'finesse', scalingFactor: 0.35,
    onHitStatus: { name: 'bleeding', duration: 3, tickDamage: 3, type: 'debuff' },
    targetType: 'enemy' },

  // === JEWELCRAFTING ACTIVE ABILITIES ===
  { cardId: 'gem_shatter', name: 'Gem Shatter', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'mystic',
    tags: ['jewelcrafting', 'crafting'],
    description: 'Shatter a charged gemstone to release a burst of arcane shrapnel that damages all nearby enemies',
    effects: [{ type: 'damage', element: 'arcane', base: 28, scaling: 'ingenuity', factor: 0.5 }],
    icon: 'skills/Blacksmith/',
    combatType: 'damage', element: 'arcane', baseDamage: 28,
    range: 4, manaCost: 16, aoeRadius: 2, cooldown: 3,
    scalingStat: 'ingenuity', scalingFactor: 0.5,
    targetType: 'enemy' },

  { cardId: 'crystal_focus', name: 'Crystal Focus', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'mystic',
    tags: ['jewelcrafting', 'magic', 'crafting'],
    description: 'Channel energy through a perfectly cut crystal to amplify your magical damage output',
    effects: [{ type: 'buff', duration: 15 }],
    icon: 'skills/Blacksmith/',
    combatType: 'buff',
    range: 0, manaCost: 10, aoeRadius: 0, cooldown: 4,
    statusEffect: 'crystal_focus', statusDuration: 4,
    spellDamageBoost: 0.25,
    targetType: 'self' },

  { cardId: 'prismatic_shield', name: 'Prismatic Shield', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'focus', archetype: 'warrior',
    tags: ['jewelcrafting', 'magic', 'crafting'],
    description: 'Conjure a dazzling prismatic barrier from gem dust that resists all elemental damage types',
    effects: [{ type: 'buff', duration: 15 }],
    icon: 'skills/Blacksmith/',
    combatType: 'buff',
    range: 0, manaCost: 22, aoeRadius: 0, cooldown: 5,
    statusEffect: 'prismatic_shield', statusDuration: 4,
    elementalResistAll: 0.30,
    targetType: 'self' },

  // === SEWING ACTIVE ABILITIES ===

  { cardId: 'patchwork_golem', name: 'Patchwork Golem', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'tactician', archetypeSecondary: ['warrior'],
    tags: ['sewing', 'magic', 'crafting'],
    description: 'Animate scraps of enchanted cloth into a shambling golem that absorbs damage and fights for you',
    effects: [{ type: 'summon', summonType: 'golem', duration: 25 }],
    icon: 'skills/Blacksmith/',
    combatType: 'summon',
    range: 2, manaCost: 20, aoeRadius: 0, cooldown: 5,
    summonType: 'patchwork_golem', summonHp: 55, summonDamage: 6, summonDuration: 4, summonArmor: 8,
    targetType: 'any' },

  // === BATCH 2: IMPACTFUL PASSIVE CARDS FOR CRAFTING/UTILITY SKILLS ===

  // -- Alchemy impactful passives --
  { cardId: 'volatile_reagents', name: 'Volatile Reagents', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['alchemy', 'crafting'],
    description: 'Your alchemical attacks have a chance to trigger a secondary explosion',
    effects: [{ type: 'proc_explosion_chance', value: 0.15, element: 'fire', baseDamage: 10 }],
    icon: 'skills/Alchemy/',
    combatPassive: { type: 'proc_explosion', chance: 0.15, damage: 10, element: 'fire' } },

  { cardId: 'alchemical_resistance', name: 'Alchemical Resistance', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior',
    tags: ['alchemy', 'crafting'],
    description: 'Prolonged exposure to chemicals has hardened your body against poison and fire',
    effects: [{ type: 'poison_resistance', value: 0.20 }, { type: 'fire_resistance', value: 0.15 }],
    icon: 'skills/Alchemy/',
    combatPassive: { type: 'elemental_resist', elements: ['poison', 'fire'], value: 0.15 } },

  // -- Enchanting impactful passives --
  { cardId: 'arcane_feedback', name: 'Arcane Feedback', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['enchanting', 'magic'],
    description: 'When you take magic damage, recover a portion of the damage as mana',
    effects: [{ type: 'mana_on_magic_hit', value: 0.15 }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'mana_on_magic_hit', value: 0.15 } },

  { cardId: 'runic_fortification', name: 'Runic Fortification', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior',
    tags: ['enchanting', 'magic'],
    description: 'Permanently inscribed protective runes reduce all magic damage taken',
    effects: [{ type: 'magic_resist', value: 0.12 }, { type: 'enchant_power_bonus', value: 0.10 }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'magic_resist', value: 0.12 } },

  // -- Brewing impactful passives --
  { cardId: 'brewed_resilience', name: 'Brewed Resilience', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior',
    tags: ['brewing', 'crafting'],
    description: 'Regular consumption of your own tonics has permanently increased your constitution',
    effects: [{ type: 'hp_bonus', value: 20 }, { type: 'debuff_resist', value: 0.10 }],
    icon: 'skills/Cooking_fishing/',
    combatPassive: { type: 'debuff_resist', value: 0.10 } },

  { cardId: 'brewmasters_endurance', name: "Brewmaster's Endurance", type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['brewing', 'crafting'],
    description: 'Your brews last longer and buff effects on you have extended duration',
    effects: [{ type: 'buff_duration_bonus', value: 0.25 }, { type: 'brew_potency_bonus', value: 0.15 }],
    icon: 'skills/Cooking_fishing/' },

  // -- Animal Handling impactful passives --
  { cardId: 'beast_bond', name: 'Beast Bond', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['animal_handling'],
    description: 'Your deep connection with beasts allows your pet to share a portion of healing you receive',
    effects: [{ type: 'pet_heal_share', value: 0.30 }, { type: 'pet_damage_bonus', value: 0.10 }],
    icon: 'skills/Herbalism/',
    combatPassive: { type: 'pet_heal_share', value: 0.30 } },

  { cardId: 'primal_instinct', name: 'Primal Instinct', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician',
    tags: ['animal_handling'],
    description: 'Heightened animal instincts grant you dodge and critical hit bonuses when near your beast',
    effects: [{ type: 'dodge_bonus', value: 0.06 }, { type: 'crit_bonus', value: 0.05 }, { type: 'pet_damage_bonus', value: 0.15 }],
    icon: 'skills/Herbalism/',
    combatPassive: { type: 'dodge_bonus', value: 0.06, requiresPet: true } },

  // -- Herbalism impactful passives --
  { cardId: 'natural_remedy', name: 'Natural Remedy', type: 'passive_perk', rarity: 'uncommon', archetype: 'mystic',
    tags: ['herbalism', 'crafting'],
    description: 'Your healing-over-time effects are more potent and tick for additional health',
    effects: [{ type: 'hot_potency_bonus', value: 0.25 }, { type: 'herb_yield_bonus', value: 0.10 }],
    icon: 'skills/Herbalism/',
    combatPassive: { type: 'hot_potency_bonus', value: 0.25 } },

  { cardId: 'toxicologist', name: 'Toxicologist', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['herbalism', 'poison'],
    description: 'Your knowledge of plants makes your poison effects last longer and deal more damage',
    effects: [{ type: 'poison_damage_bonus', value: 0.25 }, { type: 'poison_duration_bonus', value: 0.30 }],
    icon: 'skills/Herbalism/',
    combatPassive: { type: 'poison_damage_bonus', value: 0.25 } },

  // -- Survival impactful passives --
  { cardId: 'wilderness_hardened', name: 'Wilderness Hardened', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['survival'],
    description: 'Years of harsh living have toughened your body, reducing all damage when below half health',
    effects: [{ type: 'low_hp_damage_reduction', value: 0.20, threshold: 0.50 }, { type: 'hp_regen', value: 1 }],
    icon: 'skills/Blacksmith/',
    combatPassive: { type: 'low_hp_damage_reduction', value: 0.20, threshold: 0.50 } },

  { cardId: 'resourceful_survivor', name: 'Resourceful Survivor', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician',
    tags: ['survival'],
    description: 'Consumables and food items are more effective and have a chance to not be consumed on use',
    effects: [{ type: 'food_heal_bonus', value: 0.20 }, { type: 'consumable_save_chance', value: 0.10 }],
    icon: 'skills/Blacksmith/' },

  // -- Skinning impactful passives --
  { cardId: 'anatomical_knowledge', name: 'Anatomical Knowledge', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior',
    tags: ['skinning'],
    description: 'Understanding creature anatomy lets you find weak points, boosting critical damage vs beasts',
    effects: [{ type: 'crit_damage_bonus_beast', value: 0.30 }, { type: 'skinning_yield_bonus', value: 0.15 }],
    icon: 'skills/Blacksmith/',
    combatPassive: { type: 'crit_damage_bonus', value: 0.15, vsBeast: true } },

  // -- Foraging impactful passives --
  { cardId: 'keen_eye_forager', name: 'Keen Eye', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician',
    tags: ['foraging'],
    description: 'Your trained eye spots hidden resources and dangers, boosting gathering yield and trap detection',
    effects: [{ type: 'gather_bonus', value: 0.15 }, { type: 'trap_detect_bonus', value: 0.10 }],
    icon: 'skills/Herbalism/' },

  // -- Sigil Scripting impactful passives --
  { cardId: 'persistent_sigils', name: 'Persistent Sigils', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['sigil_scripting', 'magic'],
    description: 'Your inscribed sigils and tile effects last significantly longer before fading',
    effects: [{ type: 'tile_duration_bonus', value: 0.40 }, { type: 'rune_duration_bonus', value: 0.30 }],
    icon: 'skills/Enchantment/' },

  { cardId: 'sigil_mastery', name: 'Sigil Mastery', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic',
    tags: ['sigil_scripting', 'magic'],
    description: 'Master the art of sigil inscription. Reduces Saturation buildup by 50% and sigil cooldowns by 1 turn',
    effects: [{ type: 'sigil_saturation_reduction', value: 0.50 }, { type: 'sigil_cooldown_reduction', value: 1 }],
    icon: 'skills/Enchantment/' },

  // -- Transmutation impactful passives --
  { cardId: 'molecular_insight', name: 'Molecular Insight', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['transmutation', 'magic'],
    description: 'Your understanding of matter lets you ignore a portion of enemy armor with every attack',
    effects: [{ type: 'armor_penetration', value: 0.15 }, { type: 'transmutation_bonus', value: 0.10 }],
    icon: 'skills/Alchemy/',
    combatPassive: { type: 'armor_penetration', value: 0.15 } },

  // -- Leatherworking impactful passives --
  { cardId: 'master_leatherworker', name: 'Master Leatherworker', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['leatherworking', 'crafting'],
    description: 'Your crafted leather armor provides superior protection and lasts longer',
    effects: [{ type: 'crafted_armor_bonus', value: 4 }, { type: 'crafted_durability_bonus', value: 0.20 }, { type: 'ingredientSaveChance', value: 0.10 }],
    icon: 'skills/Blacksmith/' },

  // -- Carpentry impactful passives --
  { cardId: 'master_carpenter', name: 'Master Carpenter', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['carpentry', 'crafting'],
    description: 'Your wooden constructions are sturdier and your crafting produces higher quality items',
    effects: [{ type: 'structure_hp_bonus', value: 0.30 }, { type: 'craft_quality_bonus', value: 0.15 }, { type: 'woodcutting_yield_bonus', value: 0.15 }],
    icon: 'skills/Blacksmith/' },

  // -- Jewelcrafting impactful passives --
  { cardId: 'gem_attunement', name: 'Gem Attunement', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['jewelcrafting', 'crafting'],
    description: 'Your deep connection to gemstones amplifies both your crafting quality and magic resistance',
    effects: [{ type: 'craft_quality_bonus', value: 0.15 }, { type: 'magic_resist', value: 0.08 }, { type: 'gem_yield_bonus', value: 0.20 }],
    icon: 'skills/Blacksmith/',
    combatPassive: { type: 'magic_resist', value: 0.08 } },

  // -- Sewing impactful passives --
  { cardId: 'enchanted_stitching', name: 'Enchanted Stitching', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['sewing', 'crafting'],
    description: 'Your needlework carries subtle enchantments, boosting the magic resistance of crafted cloth gear',
    effects: [{ type: 'sewing_magic_resist_bonus', value: 4 }, { type: 'sewing_armor_bonus', value: 3 }, { type: 'craft_quality_bonus', value: 0.10 }],
    icon: 'skills/Blacksmith/' },

  // ========================================================================
  // BATCH 3: Combat Passive Cards (Defensive, Offensive, Healing, Utility)
  // ========================================================================

  // --- Defensive Combat Passives ---
  { cardId: 'stone_skin_passive', name: 'Stone Skin (Passive)', type: 'passive_perk', rarity: 'common', archetype: 'warrior',
    rarityScalable: true,
    tags: ['defense', 'melee', 'passive'],
    description: 'Your skin hardens like rock, reducing all physical damage taken by a flat 3',
    effects: [{ type: 'flat_damage_reduction', value: 3, element: 'physical', description: '-3 physical damage taken' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'flat_damage_reduction', value: 3, element: 'physical' } },

  { cardId: 'magic_ward', name: 'Magic Ward', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior',
    rarityScalable: true,
    tags: ['defense', 'magic', 'passive'],
    description: 'A latent magical ward reduces all magic damage taken',
    effects: [{ type: 'flat_damage_reduction', value: 5, element: 'magic', description: '-5 magic damage taken' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'flat_damage_reduction', value: 5, element: 'magic' } },

  { cardId: 'elemental_attunement', name: 'Elemental Attunement', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['defense', 'magic', 'passive'],
    description: 'After being hit by an element, gain 20% resistance to that element until hit by a different one',
    effects: [{ type: 'adaptive_resist', value: 0.20, description: '20% resist to last element that hit you' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'adaptive_resist', value: 0.20 } },

  { cardId: 'adamantine_will', name: 'Adamantine Will', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['defense', 'passive'],
    description: 'Your willpower is unbreakable, granting full immunity to stun effects',
    effects: [{ type: 'cc_immunity', ccType: 'stun', description: 'Immune to stun' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'cc_immunity', ccType: 'stun' } },

  { cardId: 'slippery', name: 'Slippery', type: 'passive_perk', rarity: 'rare', archetype: 'rogue',
    tags: ['defense', 'stealth', 'passive'],
    description: 'You cannot be rooted or slowed by any effect',
    effects: [{ type: 'cc_immunity', ccType: 'root', description: 'Immune to root and slow' }, { type: 'cc_immunity', ccType: 'slow' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'cc_immunity', ccType: 'root_slow' } },

  { cardId: 'fortified_body', name: 'Fortified', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior',
    tags: ['defense', 'passive'],
    description: 'Trade mobility for durability: +15% max HP but -10% movement speed',
    effects: [{ type: 'hp_multiplier', value: 0.15, description: '+15% max HP' }, { type: 'speed_bonus', value: -0.10, description: '-10% speed' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'hp_multiplier', value: 0.15, speedPenalty: 0.10 } },

  { cardId: 'evasive_fighter', name: 'Evasive Fighter', type: 'passive_perk', rarity: 'uncommon', archetype: 'rogue',
    rarityScalable: true,
    tags: ['defense', 'stealth', 'passive'],
    description: 'Your fluid combat stance grants dodge chance against all attacks',
    effects: [{ type: 'dodge_bonus', value: 0.05, description: '+5% dodge chance' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'dodge_bonus', value: 0.05 } },


  { cardId: 'parry_master', name: 'Parry Master', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['defense', 'melee', 'passive'],
    description: '15% chance to completely negate incoming melee attacks with a perfect parry',
    effects: [{ type: 'parry_chance', value: 0.15, description: '15% melee attack negation' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'parry_chance', value: 0.15 } },

  { cardId: 'shield_wall_passive', name: 'Shield Wall Mastery', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['defense', 'passive'],
    description: 'When actively blocking, incoming damage is reduced by an additional 30%',
    effects: [{ type: 'block_damage_reduction', value: 0.30, description: '+30% block effectiveness' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'block_damage_reduction', value: 0.30 } },

  { cardId: 'last_stand', name: 'Last Stand', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior',
    tags: ['defense', 'passive'],
    description: 'When below 20% HP, gain +50% defense as survival instincts kick in',
    effects: [{ type: 'low_hp_defense_bonus', value: 0.50, threshold: 0.20, description: '+50% defense below 20% HP' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'low_hp_damage_reduction', value: 0.50, threshold: 0.20 } },

  { cardId: 'bulwark', name: 'Bulwark', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['defense', 'passive'],
    description: 'Take 40% reduced damage from all area-of-effect attacks',
    effects: [{ type: 'aoe_damage_reduction', value: 0.40, description: '-40% AoE damage taken' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'aoe_damage_reduction', value: 0.40 } },

  { cardId: 'spell_absorption', name: 'Spell Absorption', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior',
    tags: ['defense', 'magic', 'passive'],
    description: '10% chance to absorb an enemy spell, restoring mana equal to the damage it would have dealt',
    effects: [{ type: 'spell_absorb_chance', value: 0.10, description: '10% spell absorption for mana' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'spell_absorb', chance: 0.10 } },

  { cardId: 'unstoppable', name: 'Unstoppable', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['defense', 'melee', 'passive'],
    description: 'Your mass and resolve make you immune to all knockback effects',
    effects: [{ type: 'cc_immunity', ccType: 'knockback', description: 'Immune to knockback' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'cc_immunity', ccType: 'knockback' } },

  { cardId: 'adaptive_armor', name: 'Adaptive Armor', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior',
    tags: ['defense', 'passive'],
    description: 'After being hit by the same element 3 times, gain 50% resistance to it for the rest of combat',
    effects: [{ type: 'adaptive_armor', stacksRequired: 3, resistValue: 0.50, description: '50% resist after 3 hits of same element' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'adaptive_armor', stacksRequired: 3, resistValue: 0.50 } },

  { cardId: 'thorns', name: 'Thorns', type: 'passive_perk', rarity: 'common', archetype: 'warrior',
    rarityScalable: true,
    tags: ['defense', 'passive'],
    description: 'Reflect a portion of all damage taken back to the attacker. Scales with rarity.',
    effects: [{ type: 'damage_reflect', value: 0.05, description: '5% damage reflection' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'damage_reflect', value: 0.05 } },

  // --- Offensive Combat Passives ---

  { cardId: 'critical_mastery', name: 'Critical Mastery', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior',
    rarityScalable: true,
    tags: ['offense', 'passive'],
    description: 'Honed precision grants critical hit chance on all attacks. Scales with rarity.',
    effects: [{ type: 'crit_bonus', value: 0.05, description: '+5% crit chance' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'crit_bonus', value: 0.05 } },

  { cardId: 'brutal_strikes', name: 'Brutal Strikes', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['offense', 'melee', 'passive'],
    description: 'Critical hits deal 50% more bonus damage, raising the crit multiplier from 1.5x to 2.0x',
    effects: [{ type: 'crit_damage_bonus', value: 0.50, description: '+50% crit damage multiplier' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'crit_damage_bonus', value: 0.50 } },

  { cardId: 'executioner', name: 'Executioner', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior',
    tags: ['offense', 'passive'],
    description: 'Deal +100% damage to targets below 25% HP, finishing off wounded enemies with lethal efficiency',
    effects: [{ type: 'execute_bonus', threshold: 0.25, value: 1.00, description: '+100% damage to targets below 25% HP' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'execute_bonus', threshold: 0.25, value: 1.00 } },

  { cardId: 'chain_strike', name: 'Chain Strike', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['offense', 'passive'],
    description: '20% chance that your attack cleaves to a second nearby enemy for full damage',
    effects: [{ type: 'chain_attack_chance', value: 0.20, description: '20% chance to hit a second enemy' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'chain_attack', chance: 0.20, targets: 1 } },

  { cardId: 'overwhelm', name: 'Overwhelm', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior',
    tags: ['offense', 'passive'],
    description: 'Deal +15% damage to enemies affected by stun, root, or other crowd control effects',
    effects: [{ type: 'damage_vs_cc', value: 0.15, description: '+15% damage to CC-affected enemies' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'damage_vs_cc', value: 0.15 } },

  { cardId: 'piercing_strikes', name: 'Piercing Strikes', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['offense', 'passive'],
    description: 'Your attacks ignore 20% of the target armor, punching through defenses',
    effects: [{ type: 'armor_penetration', value: 0.20, description: '20% armor penetration' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'armor_penetration', value: 0.20 } },

  { cardId: 'elemental_infusion', name: 'Elemental Infusion', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['offense', 'magic', 'passive'],
    description: 'Basic attacks deal bonus damage matching your equipped weapon element',
    effects: [{ type: 'elemental_infusion', value: true, description: 'Basic attacks gain weapon element bonus damage' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'elemental_infusion', value: true } },

  { cardId: 'relentless', name: 'Relentless', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['offense', 'passive'],
    description: 'On kill, your next ability cooldown is halved, allowing rapid follow-up',
    effects: [{ type: 'on_kill_cooldown_reduction', value: 0.50, description: 'Next ability cooldown halved on kill' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'on_kill_cooldown_reduction', value: 0.50 } },


  { cardId: 'predator', name: 'Predator', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior',
    tags: ['offense', 'passive'],
    description: 'Deal +20% damage to targets with less than half their maximum HP',
    effects: [{ type: 'execute_bonus', threshold: 0.50, value: 0.20, description: '+20% damage to targets below 50% HP' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'execute_bonus', threshold: 0.50, value: 0.20 } },

  { cardId: 'overkill', name: 'Overkill', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior',
    tags: ['offense', 'passive'],
    description: 'When a killing blow deals excess damage, 30% of it splashes to the nearest enemy',
    effects: [{ type: 'overkill_splash', value: 0.30, description: '30% excess kill damage splashes' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'overkill_splash', value: 0.30 } },

  { cardId: 'double_strike', name: 'Double Strike', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['offense', 'melee', 'passive'],
    description: '10% chance on each attack to immediately strike again for full damage',
    effects: [{ type: 'double_attack_chance', value: 0.10, description: '10% chance to attack twice' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'double_attack', chance: 0.10 } },

  { cardId: 'venomous', name: 'Venomous', type: 'passive_perk', rarity: 'uncommon', archetype: 'rogue',
    tags: ['offense', 'stealth', 'passive'],
    description: 'All physical attacks have 15% chance to poison the target for 3 damage per tick over 3 turns',
    effects: [{ type: 'on_hit_poison', chance: 0.15, tickDamage: 3, duration: 3, description: '15% chance to poison on hit' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'on_hit_poison', chance: 0.15, tickDamage: 3, duration: 3 } },

  { cardId: 'arcane_amplification', name: 'Arcane Amplification', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['offense', 'magic', 'passive'],
    description: 'Spell damage scales with 10% of your maximum mana pool as bonus damage',
    effects: [{ type: 'mana_scaling_damage', value: 0.10, description: 'Spell damage +10% of max mana' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'mana_scaling_damage', value: 0.10 } },

  { cardId: 'savage_blows', name: 'Savage Blows', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior',
    tags: ['offense', 'melee', 'passive'],
    description: 'Melee attacks have a 10% chance to inflict bleed, dealing 4 damage per turn for 3 turns',
    effects: [{ type: 'on_hit_bleed', chance: 0.10, tickDamage: 4, duration: 3, description: '10% bleed on melee hit' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'on_hit_bleed', chance: 0.10, tickDamage: 4, duration: 3 } },

  { cardId: 'berserkers_fury', name: "Berserker's Fury", type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior',
    tags: ['offense', 'melee', 'passive'],
    description: 'Gain +3% damage for each 10% of HP missing, up to +30% at 0% HP',
    effects: [{ type: 'missing_hp_damage', perTenPercent: 0.03, description: '+3% damage per 10% HP missing' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'missing_hp_damage', perTenPercent: 0.03 } },

  { cardId: 'precision_aim', name: 'Precision Aim', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior',
    tags: ['offense', 'passive'],
    description: '+10% accuracy on all attacks, reducing enemy dodge effectiveness',
    effects: [{ type: 'accuracy_bonus', value: 0.10, description: '+10% accuracy' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'accuracy_bonus', value: 0.10 } },

  { cardId: 'headhunter', name: 'Headhunter', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['offense', 'passive'],
    description: 'Killing an enemy grants +10% damage for 2 turns, stacking up to 3 times',
    effects: [{ type: 'on_kill_damage_buff', value: 0.10, duration: 2, maxStacks: 3, description: '+10% damage on kill, stacks 3x' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'on_kill_damage_buff', value: 0.10, duration: 2, maxStacks: 3 } },

  // --- Healing / Support Combat Passives ---

  { cardId: 'overheal', name: 'Overheal', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['healing', 'passive'],
    description: 'Excess healing becomes a temporary damage shield up to 20% of max HP',
    effects: [{ type: 'overheal_shield', maxPercent: 0.20, description: 'Overheal becomes shield (max 20% HP)' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'overheal_shield', maxPercent: 0.20 } },

  { cardId: 'empathic_bond', name: 'Empathic Bond', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic',
    tags: ['healing', 'passive'],
    description: 'When an ally within range takes damage, automatically heal them for 5% of your max HP',
    effects: [{ type: 'empathic_heal', value: 0.05, range: 2, description: 'Auto-heal nearby allies for 5% of your max HP' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'empathic_heal', value: 0.05, range: 2 } },

  { cardId: 'mana_font', name: 'Mana Font', type: 'passive_perk', rarity: 'uncommon', archetype: 'mystic',
    rarityScalable: true,
    tags: ['magic', 'passive'],
    description: 'Regenerate additional mana per turn from ambient arcane energy. Scales with rarity.',
    effects: [{ type: 'mana_regen', value: 3, description: '+3 mana regen per turn' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'mana_regen', value: 3 } },

  { cardId: 'spirit_link', name: 'Spirit Link', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['healing', 'passive'],
    description: 'Share 20% of damage you take with your summoned pet or companion',
    effects: [{ type: 'damage_share_pet', value: 0.20, description: '20% damage shared with pet' }],
    icon: 'skills/Herbalism/',
    combatPassive: { type: 'damage_share_pet', value: 0.20 } },

  { cardId: 'martyr', name: 'Martyr', type: 'passive_perk', rarity: 'legendary', archetype: 'mystic', archetypeSecondary: ['warrior'],
    tags: ['healing', 'passive'],
    description: 'Once per combat, intercept a killing blow aimed at an ally in range, taking the damage yourself',
    effects: [{ type: 'martyr_intercept', uses: 1, description: 'Intercept one killing blow for an ally' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'martyr_intercept', uses: 1 } },

  { cardId: 'cleansing_aura', name: 'Cleansing Aura', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['healing', 'passive'],
    description: 'Allies within range 2 have a 25% chance to resist debuffs when they are applied',
    effects: [{ type: 'aura_debuff_resist', value: 0.25, range: 2, description: '25% debuff resistance aura' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'aura_debuff_resist', value: 0.25, range: 2 } },

  { cardId: 'energizer', name: 'Energizer', type: 'passive_perk', rarity: 'uncommon', archetype: 'mystic',
    tags: ['healing', 'passive'],
    description: 'Buffs you apply to allies last 2 additional turns',
    effects: [{ type: 'buff_duration_extend', value: 2, description: '+2 turns buff duration on allies' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'buff_duration_extend', value: 2 } },

  { cardId: 'peaceful_presence', name: 'Peaceful Presence', type: 'passive_perk', rarity: 'uncommon', archetype: 'mystic',
    tags: ['healing', 'passive'],
    description: 'Out of combat, allies within range 2 regenerate 3 HP per turn from your calming aura',
    effects: [{ type: 'out_of_combat_aura_heal', value: 3, range: 2, description: 'Out of combat: allies regen 3 HP/turn' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'out_of_combat_aura_heal', value: 3, range: 2 } },

  { cardId: 'bloodpact', name: 'Bloodpact', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['healing', 'passive'],
    description: 'Healing received is increased by 30%, but you take 10% more damage from all sources',
    effects: [{ type: 'healing_received_bonus', value: 0.30, description: '+30% healing received' }, { type: 'damage_taken_increase', value: 0.10, description: '+10% damage taken' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'bloodpact', healBonus: 0.30, damageIncrease: 0.10 } },

  { cardId: 'sacred_ground', name: 'Sacred Ground', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic',
    tags: ['healing', 'magic', 'passive'],
    description: 'Standing still for 1 turn consecrates the ground beneath you, healing 5 HP/turn to all allies in range 1',
    effects: [{ type: 'sacred_ground_heal', value: 5, range: 1, description: 'Consecrate ground: 5 HP/turn to nearby allies' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'sacred_ground_heal', value: 5, range: 1 } },

  // --- Utility / CC Combat Passives ---
  { cardId: 'quickfoot', name: 'Quickfoot', type: 'passive_perk', rarity: 'uncommon', archetype: 'rogue',
    tags: ['utility', 'passive'],
    description: 'Gain +1 movement range per turn, allowing you to reposition more freely in combat',
    effects: [{ type: 'movement_bonus', value: 1, description: '+1 movement range per turn' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'movement_bonus', value: 1 } },


  { cardId: 'taunt_aura', name: 'Taunt Aura', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['defense', 'utility', 'passive'],
    description: 'Enemies in melee range prefer to attack you, drawing aggro away from allies',
    effects: [{ type: 'passive_taunt', range: 1, description: 'Melee-range passive taunt' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'passive_taunt', range: 1 } },

  { cardId: 'shadow_step_passive', name: 'Shadow Stalker', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'rogue',
    tags: ['stealth', 'utility', 'passive'],
    description: 'After killing an enemy, teleport to another enemy within range 3',
    effects: [{ type: 'on_kill_teleport', range: 3, description: 'Teleport to nearby enemy on kill' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'on_kill_teleport', range: 3 } },

  { cardId: 'ambush_passive', name: 'Ambush Instinct', type: 'passive_perk', rarity: 'rare', archetype: 'rogue',
    tags: ['stealth', 'offense', 'passive'],
    description: 'First attack from stealth deals +75% bonus damage',
    effects: [{ type: 'stealth_damage_bonus', value: 0.75, description: '+75% damage from stealth' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'stealth_damage_bonus', value: 0.75 } },

  { cardId: 'vengeful_spirit', name: 'Vengeful Spirit', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic',
    tags: ['offense', 'passive'],
    description: 'On death, explode for 50% of your max HP as shadow damage to all enemies within range 2',
    effects: [{ type: 'death_explosion', hpPercent: 0.50, element: 'shadow', range: 2, description: 'Explode on death for 50% max HP shadow damage' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'death_explosion', hpPercent: 0.50, element: 'shadow', range: 2 } },

  { cardId: 'phoenix_feather', name: 'Phoenix Feather', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['utility', 'passive'],
    description: 'Once per dungeon, revive at 25% HP when you would otherwise die',
    effects: [{ type: 'revive_on_death', hpPercent: 0.25, uses: 1, description: 'Revive once per dungeon at 25% HP' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'revive_on_death', hpPercent: 0.25, usesPerDungeon: 1 } },

  { cardId: 'momentum', name: 'Momentum', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior',
    tags: ['offense', 'utility', 'passive'],
    description: 'After moving 3 or more tiles in a turn, your next attack deals +20% damage',
    effects: [{ type: 'momentum_damage', movementThreshold: 3, value: 0.20, description: '+20% damage after moving 3+ tiles' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'momentum_damage', movementThreshold: 3, value: 0.20 } },

  { cardId: 'aura_of_weakness', name: 'Aura of Weakness', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['defense', 'utility', 'passive'],
    description: 'Enemies within melee range deal 10% less damage, weakened by your oppressive presence',
    effects: [{ type: 'damage_reduction_aura', value: 0.10, range: 1, description: 'Enemies in range 1 deal -10% damage' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'damage_reduction_aura', value: 0.10, range: 1 } },

  { cardId: 'opportunist', name: 'Opportunist', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['offense', 'utility', 'passive'],
    description: 'Attacks against enemies who are moving or have moved this turn deal +15% damage',
    effects: [{ type: 'damage_vs_moving', value: 0.15, description: '+15% damage to moving enemies' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'damage_vs_moving', value: 0.15 } },

  { cardId: 'steadfast', name: 'Steadfast', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior',
    tags: ['defense', 'passive'],
    description: 'If you did not move this turn, gain +5 armor until your next turn',
    effects: [{ type: 'stationary_armor', value: 5, description: '+5 armor when standing still' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'stationary_armor', value: 5 } },

  { cardId: 'battle_hardened', name: 'Battle Hardened', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['defense', 'passive'],
    description: 'Each time you are hit in combat, gain +1 armor permanently for this encounter, up to +10',
    effects: [{ type: 'stacking_armor', perHit: 1, maxStacks: 10, description: '+1 armor per hit taken, max +10' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'stacking_armor', perHit: 1, maxStacks: 10 } },

  { cardId: 'vitality_surge', name: 'Vitality Surge', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior',
    tags: ['defense', 'passive'],
    description: 'At the start of each combat encounter, gain a shield equal to 10% of your max HP',
    effects: [{ type: 'combat_start_shield', value: 0.10, description: '10% max HP shield at combat start' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'combat_start_shield', hpPercent: 0.10 } },

  { cardId: 'adrenaline_rush', name: 'Adrenaline Rush', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['offense', 'passive'],
    description: 'When you drop below 30% HP, gain +25% attack speed and +15% damage for 3 turns',
    effects: [{ type: 'low_hp_damage_bonus', threshold: 0.30, damageBonus: 0.15, speedBonus: 0.25, duration: 3, description: 'Adrenaline at low HP: +25% speed, +15% damage' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'low_hp_offense_boost', threshold: 0.30, damageBonus: 0.15, speedBonus: 0.25, duration: 3 } },

  { cardId: 'spell_echo', name: 'Spell Echo', type: 'passive_perk', rarity: 'legendary', archetype: 'mystic',
    tags: ['magic', 'offense', 'passive'],
    description: '15% chance to cast the same spell again immediately at no additional mana cost',
    effects: [{ type: 'spell_echo_chance', value: 0.15, description: '15% chance to double-cast spells' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'spell_echo', chance: 0.15 } },

  { cardId: 'soul_siphon', name: 'Soul Siphon', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['offense', 'magic', 'passive'],
    description: 'Killing an enemy restores 10% of your maximum mana',
    effects: [{ type: 'on_kill_mana_restore', value: 0.10, description: 'Restore 10% max mana on kill' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'on_kill_mana_restore', value: 0.10 } },

  { cardId: 'shield_breaker', name: 'Shield Breaker', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['offense', 'melee', 'passive'],
    description: 'Your attacks deal double damage to enemy shields and damage absorption barriers',
    effects: [{ type: 'shield_damage_bonus', value: 1.00, description: '2x damage to shields' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'shield_damage_bonus', value: 1.00 } },

  { cardId: 'tactical_retreat', name: 'Tactical Retreat', type: 'passive_perk', rarity: 'uncommon', archetype: 'rogue',
    tags: ['utility', 'passive'],
    description: 'When you drop below 25% HP, gain +2 movement for 1 turn to escape',
    effects: [{ type: 'low_hp_movement', threshold: 0.25, value: 2, duration: 1, description: '+2 movement when low HP' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'low_hp_movement', threshold: 0.25, value: 2, duration: 1 } },

  // ========================================================================
  // BATCH 3: Crowd Control & Movement Active Cards (CC, Knockback, Chain, AoE)
  // ========================================================================

  // --- Knockback / Push / Pull ---

  { cardId: 'gravity_well', name: 'Gravity Well', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'tactician', archetypeSecondary: ['warrior'],
    tags: ['magic', 'cc'],
    description: 'Create a singularity of arcane force that pulls all enemies within range 3 toward the center',
    effects: [{ type: 'damage', element: 'arcane', base: 20, scaling: 'acumen', factor: 0.4, description: 'Arcane AoE + pull' }],
    icon: 'skills/Enchantment/',
    combatType: 'damage', element: 'arcane', baseDamage: 20,
    range: 5, manaCost: 25, aoeRadius: 3, cooldown: 5,
    scalingStat: 'acumen', scalingFactor: 0.4,
    pullToCenter: true,
    targetType: 'all_enemies' },

  { cardId: 'repulsion_wave', name: 'Repulsion Wave', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'tactician',
    tags: ['cc'],
    description: 'Emit a concussive wave centered on yourself, dealing 15 damage and knocking back all enemies 2 tiles',
    effects: [{ type: 'damage', element: 'physical', base: 15, scaling: 'vigor', factor: 0.3, description: 'AoE knockback 2 + damage' }],
    icon: 'skills/Skill_Explosion.PNG',
    combatType: 'damage', baseDamage: 15,
    range: 0, manaCost: 12, aoeRadius: 2, cooldown: 3,
    scalingStat: 'vigor', scalingFactor: 0.3,
    knockback: 2,
    targetType: 'all_enemies' },


  { cardId: 'tidal_wave', name: 'Tidal Wave', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'aquatic', archetypeSecondary: ['tactician'],
    tags: ['magic', 'cc'],
    description: 'Summon a crashing wave of water that damages enemies and pushes them 2 tiles in the wave direction',
    effects: [{ type: 'damage', element: 'water', base: 25, scaling: 'acumen', factor: 0.5, description: 'Water AoE + push 2' }],
    icon: 'skills/Skill_Explosion.PNG',
    combatType: 'damage', element: 'water', baseDamage: 25,
    range: 5, manaCost: 20, aoeRadius: 2, cooldown: 4,
    scalingStat: 'acumen', scalingFactor: 0.5,
    knockback: 2, directionalPush: true,
    onHitTile: 'WATER',
    targetType: 'enemy' },

  { cardId: 'seismic_slam', name: 'Seismic Slam', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'tactician', archetypeSecondary: ['warrior'],
    tags: ['melee', 'cc'],
    description: 'Slam the ground with tremendous force, dealing earth damage with knockback and a stun chance',
    effects: [{ type: 'damage', element: 'earth', base: 22, scaling: 'might', factor: 0.5, description: 'Earth melee + knockback 1 + stun chance' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'damage', element: 'earth', baseDamage: 22,
    range: 1, manaCost: 10, aoeRadius: 1, cooldown: 3,
    scalingStat: 'might', scalingFactor: 0.5,
    knockback: 1,
    onHitStatus: { name: 'stunned', duration: 1, chance: 0.35, type: 'debuff' },
    targetType: 'enemy' },

  // --- Chain / Bounce Effects ---

  { cardId: 'ricochet_shot', name: 'Ricochet Shot', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'warrior',
    tags: ['cc'],
    description: 'Fire a projectile that ricochets between 3 enemies, dealing full physical damage to each',
    effects: [{ type: 'damage', element: 'physical', base: 20, scaling: 'finesse', factor: 0.4, description: 'Bouncing shot: 3 targets' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'damage', baseDamage: 20,
    range: 6, manaCost: 12, aoeRadius: 0, cooldown: 3,
    scalingStat: 'finesse', scalingFactor: 0.4,
    chainBounces: 2, chainDamageFalloff: 0.0,
    targetType: 'enemy' },


  { cardId: 'arcane_missiles', name: 'Arcane Missiles', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic',
    tags: ['magic', 'cc'],
    description: 'Launch 5 small arcane projectiles that automatically target the nearest enemies',
    effects: [{ type: 'damage', element: 'arcane', base: 8, scaling: 'acumen', factor: 0.2, description: '5 auto-targeting missiles (8 damage each)' }],
    icon: 'skills/Enchantment/',
    combatType: 'damage', element: 'arcane', baseDamage: 8,
    range: 5, manaCost: 14, aoeRadius: 0, cooldown: 3,
    scalingStat: 'acumen', scalingFactor: 0.2,
    projectileCount: 5, autoTarget: true,
    targetType: 'enemy' },

  // --- AoE Status Effects ---
  { cardId: 'howling_blizzard', name: 'Howling Blizzard', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['tactician'],
    tags: ['magic', 'cc'],
    description: 'Summon a massive blizzard that deals ice damage and freezes all enemies for 1 turn',
    effects: [{ type: 'damage', element: 'ice', base: 35, scaling: 'acumen', factor: 0.5, description: 'Large AoE ice + freeze 1 turn' }],
    icon: 'skills/Skill_Explosion.PNG',
    combatType: 'damage', element: 'ice', baseDamage: 35,
    range: 5, manaCost: 30, aoeRadius: 3, cooldown: 5,
    scalingStat: 'acumen', scalingFactor: 0.5,
    onHitTile: 'FROZEN',
    onHitStatus: { name: 'frozen', duration: 1, speedMult: 0, type: 'debuff' },
    targetType: 'all_enemies' },







  { cardId: 'war_horn', name: 'War Horn', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'mystic',
    tags: ['cc'],
    description: 'Sound a thunderous war horn: all allies gain +5 damage and +10% speed for 3 turns',
    effects: [{ type: 'buff_all', description: 'AoE buff: +5 damage, +10% speed for 3 turns' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'buff',
    range: 0, manaCost: 15, aoeRadius: 0, cooldown: 4,
    statusEffect: 'war_horn', statusDuration: 3,
    damageBoost: 5, speedMult: 1.10,
    targetType: 'all_allies' },

  // --- Stun / Disable ---

  { cardId: 'petrify', name: 'Petrify', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'tactician',
    tags: ['magic', 'cc'],
    description: 'Turn an enemy to stone: cannot act but takes 50% less damage for 3 turns',
    effects: [{ type: 'crowd_control', ccType: 'petrify', duration: 3, description: 'Petrify: no actions, 50% damage reduction' }],
    icon: 'skills/Enchantment/',
    combatType: 'debuff', element: 'earth',
    range: 4, manaCost: 25, aoeRadius: 0, cooldown: 5,
    statusEffect: 'petrified', statusDuration: 3,
    targetType: 'enemy',
    onHitStatus: { name: 'petrified', duration: 3, speedMult: 0, damageReduction: 0.50, type: 'debuff' } },

  { cardId: 'sleep_cc', name: 'Sleep', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'tactician',
    tags: ['magic', 'cc'],
    description: 'Lull an enemy into magical slumber for 3 turns; any damage wakes them',
    effects: [{ type: 'crowd_control', ccType: 'sleep', duration: 3, description: 'Sleep for 3 turns (breaks on damage)' }],
    icon: 'skills/Enchantment/',
    combatType: 'debuff', element: 'arcane',
    range: 5, manaCost: 18, aoeRadius: 0, cooldown: 4,
    statusEffect: 'asleep', statusDuration: 3,
    targetType: 'enemy',
    onHitStatus: { name: 'asleep', duration: 3, breaksOnDamage: true, type: 'debuff' } },

  { cardId: 'blind_cc', name: 'Blinding Light', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'tactician',
    tags: ['magic', 'cc'],
    description: 'Flash a searing burst of light, reducing target accuracy by 75% for 2 turns',
    effects: [{ type: 'crowd_control', ccType: 'blind', duration: 2, description: '-75% accuracy for 2 turns' }],
    icon: 'skills/Enchantment/',
    combatType: 'debuff', element: 'holy',
    range: 4, manaCost: 10, aoeRadius: 0, cooldown: 3,
    statusEffect: 'blinded', statusDuration: 2,
    targetType: 'enemy',
    onHitStatus: { name: 'blinded', duration: 2, accuracyMult: 0.25, type: 'debuff' } },

  { cardId: 'disarm_cc', name: 'Disarm', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina', archetype: 'tactician',
    tags: ['melee', 'cc'],
    description: 'Knock the weapon from an enemy grip, disabling weapon abilities for 2 turns',
    effects: [{ type: 'crowd_control', ccType: 'disarm', duration: 2, description: 'Disarm: no weapon abilities for 2 turns' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'debuff',
    range: 1, manaCost: 8, aoeRadius: 0, cooldown: 3,
    statusEffect: 'disarmed', statusDuration: 2,
    targetType: 'enemy',
    onHitStatus: { name: 'disarmed', duration: 2, type: 'debuff' } },

  // --- Defensive CC ---
  { cardId: 'counter_stance', name: 'Counter Stance', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'rogue', archetypeSecondary: ['warrior'],
    tags: ['melee', 'defense', 'cc'],
    description: 'Enter a counter stance for 2 turns: automatically counter the next melee attack for 150% damage',
    effects: [{ type: 'counter', duration: 2, damageMultiplier: 1.50, description: 'Counter next melee attack at 150% damage' }],
    icon: 'skills/Skill_Defence.PNG',
    combatType: 'buff',
    range: 0, manaCost: 10, aoeRadius: 0, cooldown: 4,
    statusEffect: 'counter_stance', statusDuration: 2,
    counterDamage: 1.50,
    targetType: 'self' },



  // --- Additional CC Actives ---
  { cardId: 'thunderclap', name: 'Thunderclap', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'tactician', archetypeSecondary: ['warrior'],
    tags: ['melee', 'cc'],
    description: 'Clap your hands with supernatural force, dealing lightning damage and stunning nearby enemies',
    effects: [{ type: 'damage', element: 'lightning', base: 18, scaling: 'might', factor: 0.4, description: 'AoE lightning + stun' }],
    icon: 'skills/Skill_Explosion.PNG',
    combatType: 'damage', element: 'lightning', baseDamage: 18,
    range: 0, manaCost: 14, aoeRadius: 1, cooldown: 3,
    scalingStat: 'might', scalingFactor: 0.4,
    onHitTile: 'ELECTRIFIED',
    onHitStatus: { name: 'stunned', duration: 1, type: 'debuff' },
    targetType: 'all_enemies' },


  { cardId: 'frost_nova', name: 'Frost Nova', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'tactician',
    tags: ['magic', 'cc'],
    description: 'Explode with frost energy, freezing all enemies in melee range for 1 turn and dealing ice damage',
    effects: [{ type: 'damage', element: 'ice', base: 20, scaling: 'acumen', factor: 0.4, description: 'AoE ice damage + freeze 1 turn' }],
    icon: 'skills/Skill_Explosion.PNG',
    combatType: 'damage', element: 'ice', baseDamage: 20,
    range: 0, manaCost: 15, aoeRadius: 1, cooldown: 3,
    scalingStat: 'acumen', scalingFactor: 0.4,
    onHitTile: 'FROZEN',
    onHitStatus: { name: 'frozen', duration: 1, speedMult: 0, type: 'debuff' },
    targetType: 'all_enemies' },

  { cardId: 'hamstring', name: 'Hamstring', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina', archetype: 'tactician', archetypeSecondary: ['warrior'],
    tags: ['melee', 'cc'],
    description: 'Slash at an enemy leg, dealing damage and reducing movement speed by 60% for 3 turns',
    effects: [{ type: 'damage', element: 'physical', base: 14, scaling: 'finesse', factor: 0.4, description: 'Physical + 60% slow for 3 turns' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'damage', baseDamage: 14,
    range: 1, manaCost: 5, aoeRadius: 0, cooldown: 2,
    scalingStat: 'finesse', scalingFactor: 0.4,
    onHitStatus: { name: 'hamstrung', duration: 3, speedMult: 0.40, type: 'debuff' },
    targetType: 'enemy' },

  { cardId: 'shockwave', name: 'Shockwave', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'tactician', archetypeSecondary: ['warrior'],
    tags: ['melee', 'cc'],
    description: 'Strike the ground to send a shockwave forward, dealing damage and knocking enemies back 2 tiles',
    effects: [{ type: 'damage', element: 'physical', base: 20, scaling: 'might', factor: 0.5, description: 'Line AoE + knockback 2' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'damage', baseDamage: 20,
    range: 4, manaCost: 10, aoeRadius: 1, cooldown: 3,
    scalingStat: 'might', scalingFactor: 0.5,
    knockback: 2, lineAoe: true,
    targetType: 'enemy' },



  { cardId: 'leg_sweep', name: 'Leg Sweep', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina', archetype: 'tactician',
    tags: ['melee', 'cc'],
    description: 'Sweep the legs of a nearby enemy, knocking them down for 1 turn',
    effects: [{ type: 'damage', element: 'physical', base: 10, scaling: 'finesse', factor: 0.3, description: 'Melee + knockdown 1 turn' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'damage', baseDamage: 10,
    range: 1, manaCost: 4, aoeRadius: 0, cooldown: 2,
    scalingStat: 'finesse', scalingFactor: 0.3,
    onHitStatus: { name: 'knocked_down', duration: 1, speedMult: 0, type: 'debuff' },
    targetType: 'enemy' },

  // ========================================================================
  // BATCH 4: Support / Healer / Tank / CC-Controller Class Archetype Cards
  // Designed for class-fluid mix-and-match: players build archetypes by
  // combining these cards freely — no locked classes.
  // ========================================================================

  // --- Healing Passives ---

  { cardId: 'heal_virus', name: 'Heal Virus', type: 'passive_perk', rarity: 'legendary', archetype: 'mystic',
    tags: ['healing', 'life_magic', 'mystic', 'passive'],
    description: 'When you heal an ally, the healing spreads like a virus to nearby allies at 50% effectiveness',
    effects: [{ type: 'heal_virus', spreadPercent: 0.50, range: 2, description: 'Healing spreads to nearby allies at 50%' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'heal_virus', spreadPercent: 0.50, range: 2 } },

  { cardId: 'overhealing_shield', name: 'Overhealing Shield', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['healing', 'mystic', 'passive'],
    description: 'Excess healing you apply becomes a temporary shield on the target, up to 20% of their max HP',
    effects: [{ type: 'overhealing_shield', maxPercent: 0.20, description: 'Overheal converts to shield (max 20% HP)' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'overhealing_shield', maxPercent: 0.20 } },

  { cardId: 'sympathetic_healing', name: 'Sympathetic Healing', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['healing', 'mystic', 'passive'],
    description: 'When you heal yourself, nearby allies within range 2 are healed for 30% of the amount',
    effects: [{ type: 'sympathetic_healing', value: 0.30, range: 2, description: 'Self-heals share 30% to nearby allies' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'sympathetic_healing', value: 0.30, range: 2 } },

  { cardId: 'critical_healing', name: 'Critical Healing', type: 'passive_perk', rarity: 'uncommon', archetype: 'mystic',
    tags: ['healing', 'mystic', 'passive'],
    description: '15% chance for your healing abilities to critically heal for double effectiveness',
    effects: [{ type: 'critical_healing', chance: 0.15, multiplier: 2.0, description: '15% chance for 2x healing' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'critical_healing', chance: 0.15, multiplier: 2.0 } },

  { cardId: 'lifeline', name: 'Lifeline', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic',
    tags: ['healing', 'mystic', 'passive'],
    description: 'When an ally drops below 25% HP, automatically heal them for 15% of their max HP (60s cooldown)',
    effects: [{ type: 'lifeline', hpThreshold: 0.25, healPercent: 0.15, cooldown: 60, description: 'Auto-heal allies below 25% HP for 15% max HP' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'lifeline', hpThreshold: 0.25, healPercent: 0.15, cooldown: 60 } },

  { cardId: 'healing_aura', name: 'Healing Aura', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['healing', 'mystic', 'passive'],
    description: 'Emit a passive regeneration aura — nearby allies within range 2 regen 1% max HP per turn',
    effects: [{ type: 'healing_aura', hpPercent: 0.01, range: 2, description: 'Allies in range regen 1% max HP/turn' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'healing_aura', hpPercent: 0.01, range: 2 } },

  { cardId: 'purifying_touch', name: 'Purifying Touch', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['healing', 'life_magic', 'mystic', 'passive'],
    description: 'Your healing abilities also remove one debuff from the target',
    effects: [{ type: 'purifying_touch', removeDebuffs: 1, description: 'Heals remove one debuff' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'purifying_touch', removeDebuffs: 1 } },

  { cardId: 'shared_vitality', name: 'Shared Vitality', type: 'passive_perk', rarity: 'uncommon', archetype: 'mystic',
    tags: ['healing', 'mystic', 'passive'],
    description: '10% of healing you receive is shared with all party members within range 3',
    effects: [{ type: 'shared_vitality', sharePercent: 0.10, range: 3, description: 'Share 10% of received healing with party' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'shared_vitality', sharePercent: 0.10, range: 3 } },

  // --- Support / Buff Passives ---

  { cardId: 'battle_commander', name: 'Battle Commander', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic',
    tags: ['mystic', 'psychology', 'passive'],
    description: 'While you are alive, all party members within range 3 gain a 5% damage bonus',
    effects: [{ type: 'battle_commander', damageBonus: 0.05, range: 3, description: '+5% party damage while alive' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'battle_commander', damageBonus: 0.05, range: 3 } },

  { cardId: 'inspiring_presence', name: 'Inspiring Presence', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['mystic', 'psychology', 'passive'],
    description: 'Party members within range 3 regenerate mana 10% faster from your encouraging aura',
    effects: [{ type: 'inspiring_presence', manaRegenBonus: 0.10, range: 3, description: '+10% mana regen for nearby allies' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'inspiring_presence', manaRegenBonus: 0.10, range: 3 } },

  { cardId: 'shield_of_faith', name: 'Shield of Faith', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['mystic', 'life_magic', 'passive'],
    description: 'When you apply a buff to an ally, they gain 5% damage reduction for 3 turns',
    effects: [{ type: 'shield_of_faith', damageReduction: 0.05, duration: 3, description: 'Buffs grant +5% DR for 3 turns' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'shield_of_faith', damageReduction: 0.05, duration: 3 } },

  { cardId: 'buff_amplifier', name: 'Buff Amplifier', type: 'passive_perk', rarity: 'uncommon', archetype: 'mystic',
    tags: ['mystic', 'passive'],
    description: 'Buffs you apply to allies last 25% longer',
    effects: [{ type: 'buff_amplifier', durationBonus: 0.25, description: '+25% buff duration on applied buffs' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'buff_amplifier', durationBonus: 0.25 } },

  { cardId: 'synergy', name: 'Synergy', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic',
    tags: ['mystic', 'passive'],
    description: 'When an ally has 2 or more active buffs, each buff is 3% more effective',
    effects: [{ type: 'synergy', bonusPerBuff: 0.03, minBuffs: 2, description: '+3% buff potency when 2+ buffs active' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'synergy', bonusPerBuff: 0.03, minBuffs: 2 } },

  { cardId: 'war_drums', name: 'War Drums', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['mystic', 'psychology', 'passive'],
    description: 'After killing an enemy, your party gains 10% attack speed for 2 turns',
    effects: [{ type: 'war_drums', speedBonus: 0.10, duration: 2, range: 3, description: '+10% party attack speed on kill' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'war_drums', speedBonus: 0.10, duration: 2, range: 3 } },

  { cardId: 'empowerment', name: 'Empowerment', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['mystic', 'passive'],
    description: 'Damage buffs you apply on allies are 15% more effective',
    effects: [{ type: 'empowerment', buffBonus: 0.15, description: '+15% potency on damage buffs applied to allies' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'empowerment', buffBonus: 0.15 } },

  { cardId: 'spirit_link_party', name: 'Spirit Link', type: 'passive_perk', rarity: 'legendary', archetype: 'mystic', archetypeSecondary: ['warrior'],
    tags: ['mystic', 'healing', 'passive'],
    description: '15% of damage taken by nearby allies is redirected to you instead',
    effects: [{ type: 'spirit_link_party', redirectPercent: 0.15, range: 2, description: 'Redirect 15% of ally damage to yourself' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'spirit_link_party', redirectPercent: 0.15, range: 2 } },

  { cardId: 'guardian_angel', name: 'Guardian Angel', type: 'passive_perk', rarity: 'mythic_rare', archetype: 'mystic',
    tags: ['mystic', 'healing', 'passive'],
    description: 'Revive allies 30% faster and revived allies return with 20% more HP',
    effects: [{ type: 'guardian_angel', reviveSpeedBonus: 0.30, reviveHpBonus: 0.20, description: '+30% revive speed, +20% revive HP' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'guardian_angel', reviveSpeedBonus: 0.30, reviveHpBonus: 0.20, range: 4 } },

  // --- Debuff / Control Support Passives ---

  { cardId: 'contagion', name: 'Contagion', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', archetypeSecondary: ['mystic'],
    tags: ['cc', 'mystic', 'passive'],
    description: 'Debuffs you apply have a 30% chance to spread to a nearby enemy within range 2',
    effects: [{ type: 'contagion', spreadChance: 0.30, range: 2, description: '30% chance debuffs spread to nearby enemies' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'contagion', spreadChance: 0.30, range: 2 } },

  { cardId: 'weakening_aura', name: 'Weakening Aura', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['cc', 'mystic', 'passive'],
    description: 'Enemies within range 1 deal 5% less damage, sapped by your oppressive presence',
    effects: [{ type: 'weakening_aura', damageReduction: 0.05, range: 1, description: 'Nearby enemies deal -5% damage' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'weakening_aura', damageReduction: 0.05, range: 1 } },

  { cardId: 'curse_amplifier', name: 'Curse Amplifier', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician',
    tags: ['cc', 'mystic', 'passive'],
    description: 'Enemies afflicted by your debuffs take 10% more damage from all sources',
    effects: [{ type: 'curse_amplifier', damageAmplify: 0.10, description: '+10% damage to enemies with your debuffs' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'curse_amplifier', damageAmplify: 0.10 } },

  { cardId: 'hex_master', name: 'Hex Master', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician',
    tags: ['cc', 'mystic', 'passive'],
    description: 'Debuff durations you apply are increased by 20%',
    effects: [{ type: 'hex_master', durationBonus: 0.20, description: '+20% debuff duration' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'hex_master', durationBonus: 0.20 } },

  { cardId: 'mass_dispel', name: 'Mass Dispel', type: 'passive_perk', rarity: 'legendary', archetype: 'tactician',
    tags: ['cc', 'magic', 'mystic', 'passive'],
    description: 'When you remove a buff from an enemy, all enemies within range 2 also lose their buffs (30s CD)',
    effects: [{ type: 'mass_dispel', range: 2, cooldown: 30, description: 'Dispel spreads to nearby enemies' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'mass_dispel', range: 2, cooldown: 30 } },

  { cardId: 'enfeebling_strike', name: 'Enfeebling Strike', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician',
    tags: ['cc', 'mystic', 'passive'],
    description: 'Your attacks have a 10% chance to reduce the target\'s damage by 15% for 2 turns',
    effects: [{ type: 'enfeebling_strike', chance: 0.10, damageReduction: 0.15, duration: 2, description: '10% chance to weaken enemy damage by 15%' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'enfeebling_strike', chance: 0.10, damageReduction: 0.15, duration: 2 } },

  { cardId: 'vulnerability', name: 'Vulnerability', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['cc', 'mystic', 'passive'],
    description: 'Enemies you CC take 15% more damage for 2 turns after the CC ends',
    effects: [{ type: 'vulnerability', damageAmplify: 0.15, duration: 2, description: '+15% damage to recently CC\'d enemies' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'vulnerability', damageAmplify: 0.15, duration: 2 } },

  { cardId: 'dissonance', name: 'Dissonance', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician',
    tags: ['cc', 'mystic', 'passive'],
    description: 'Enemies within range 1 have 10% reduced healing effectiveness',
    effects: [{ type: 'dissonance', healReduction: 0.10, range: 1, description: 'Nearby enemies receive -10% healing' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'dissonance', healReduction: 0.10, range: 1 } },

  // --- Tank / Protector Passives ---

  { cardId: 'last_stand_tank', name: 'Last Stand (Tank)', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior',
    tags: ['defense', 'warrior', 'passive'],
    description: 'Below 20% HP, you gain 30% damage reduction from all sources',
    effects: [{ type: 'last_stand', damageReduction: 0.30, hpThreshold: 0.20, description: '+30% DR below 20% HP' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'last_stand', damageReduction: 0.30, hpThreshold: 0.20 } },

  { cardId: 'fortress', name: 'Fortress', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['defense', 'warrior', 'passive'],
    description: 'While standing still (no movement this turn), gain 15% armor bonus',
    effects: [{ type: 'fortress', armorBonus: 0.15, description: '+15% armor when stationary' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'fortress', armorBonus: 0.15 } },

  { cardId: 'taunt_aura_tank', name: 'Taunt Aura', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior',
    tags: ['defense', 'warrior', 'passive'],
    description: 'Enemies within range 2 are compelled to attack you over your allies',
    effects: [{ type: 'taunt_aura_tank', range: 2, description: 'Enemies prioritize attacking you' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'passive_taunt', range: 2 } },

  { cardId: 'aegis', name: 'Aegis', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['defense', 'warrior', 'passive'],
    description: 'When you block an attack, gain a 5% damage bonus for 2 turns',
    effects: [{ type: 'aegis', damageBonus: 0.05, duration: 2, description: '+5% damage on block for 2 turns' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'aegis', damageBonus: 0.05, duration: 2 } },

  { cardId: 'ironclad', name: 'Ironclad', type: 'passive_perk', rarity: 'rare', archetype: 'warrior', archetypeSecondary: ['warrior'],
    tags: ['defense', 'warrior', 'passive'],
    description: 'Stun, knockback, and knockdown durations on you are reduced by 40%',
    effects: [{ type: 'ironclad', ccReduction: 0.40, description: '-40% CC duration' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'ironclad', ccReduction: 0.40 } },

  { cardId: 'rallying_defense', name: 'Rallying Defense', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior',
    tags: ['defense', 'warrior', 'mystic', 'passive'],
    description: 'When you block an attack, nearby allies within range 2 gain +3 armor for 2 turns',
    effects: [{ type: 'rallying_defense', armorValue: 3, duration: 2, range: 2, description: 'Block grants +3 armor to nearby allies' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'rallying_defense', armorValue: 3, duration: 2, range: 2 } },

  { cardId: 'bulwark_tank', name: 'Bulwark (Tank)', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['defense', 'warrior', 'passive'],
    description: 'Shield effectiveness (block damage reduction and shield abilities) increased by 25%',
    effects: [{ type: 'bulwark', shieldBonus: 0.25, description: '+25% shield effectiveness' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'bulwark', shieldBonus: 0.25 } },

  { cardId: 'undying_will', name: 'Undying Will', type: 'passive_perk', rarity: 'legendary', archetype: 'warrior',
    tags: ['defense', 'warrior', 'passive'],
    description: 'Once per dungeon floor, survive a killing blow with 1 HP instead of dying',
    effects: [{ type: 'undying_will', uses: 1, description: 'Survive killing blow once per floor' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'undying_will', usesPerFloor: 1 } },

  // --- Class-Fluid Support Active Abilities ---

  { cardId: 'chain_heal', name: 'Chain Heal', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'mystic',
    tags: ['healing', 'life_magic', 'mystic', 'magic'],
    description: 'Heal a target, then the healing bounces to 2 nearby allies at 60% effectiveness each bounce',
    effects: [{ type: 'heal', base: 30, scaling: 'resolve', factor: 0.5, description: 'Bouncing heal: 2 additional targets at 60%' }],
    icon: 'skills/Skill_Heal.PNG',
    combatType: 'healing', element: 'holy', baseHeal: 30,
    range: 5, manaCost: 22, aoeRadius: 0, cooldown: 3,
    scalingStat: 'resolve', scalingFactor: 0.5,
    targetType: 'ally',
    chainBounces: 2, chainHealFalloff: 0.40 },


  { cardId: 'cleansing_wave', name: 'Cleansing Wave', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic',
    tags: ['healing', 'mystic', 'life_magic', 'magic'],
    description: 'Unleash a wave of purifying energy that removes all debuffs from all party members',
    effects: [{ type: 'cleanse_all', removeDebuffs: 'all', description: 'Remove all debuffs from entire party' }],
    icon: 'skills/Skill_Heal.PNG',
    combatType: 'buff', element: 'holy',
    range: 0, manaCost: 25, aoeRadius: 0, cooldown: 5,
    statusEffect: 'cleanse', statusDuration: 0,
    targetType: 'all_allies' },


  { cardId: 'mana_tide', name: 'Mana Tide', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'focus', archetype: 'mystic',
    tags: ['mystic', 'magic'],
    description: 'Channel tidal mana energy to restore 20% of max mana to all nearby allies',
    effects: [{ type: 'mana_restore_all', percent: 0.20, description: 'Restore 20% max mana to all allies' }],
    icon: 'skills/Enchantment/',
    combatType: 'buff',
    range: 0, manaCost: 10, aoeRadius: 0, cooldown: 8,
    statusEffect: 'mana_tide', statusDuration: 1,
    manaRestorePercent: 0.20,
    targetType: 'all_allies' },

  { cardId: 'sanctuary_zone', name: 'Sanctuary', type: 'active_ability', rarity: 'legendary', resourceType: 'mana', archetype: 'mystic',
    tags: ['healing', 'mystic', 'life_magic', 'magic'],
    description: 'Create a holy sanctuary zone on your tile — allies standing in it regen 5% HP per turn for 4 turns',
    effects: [{ type: 'tile', element: 'holy', description: 'Healing zone: allies regen 5% HP/turn for 4 turns' }],
    icon: 'skills/Skill_Heal.PNG',
    combatType: 'tile_effect', tileEffect: 'SANCTUARY',
    element: 'holy',
    range: 0, manaCost: 35, aoeRadius: 2, cooldown: 8,
    tileDuration: 4, tileHealPercent: 0.05,
    targetType: 'any' },

  // ========================================================================
  // BATCH 5: MMO-Inspired Archetype Cards
  // Iconic mechanics from WoW, FFXIV, ESO, GW2, Lost Ark class systems.
  // Each card creates a UNIQUE gameplay pattern, not a stat stick.
  // ========================================================================

  // --- A. Atonement / Heal-Through-Aggression (WoW Disc Priest / FFXIV Sage) ---

  { cardId: 'atonement', name: 'Atonement', type: 'passive_perk', rarity: 'legendary', archetype: 'mystic', archetypeSecondary: ['mystic'],
    tags: ['healing', 'offense', 'life_magic', 'passive'],
    description: 'When you deal damage, the lowest-HP ally within range 3 is healed for 20% of the damage dealt. Turns every attack into triage.',
    effects: [{ type: 'damage_to_heal', healPercent: 0.20, targetLowestHp: true, range: 3, description: '20% of damage dealt heals lowest-HP ally' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'damage_to_heal', healPercent: 0.20, targetLowestHp: true, range: 3 } },

  { cardId: 'kardia_link', name: 'Kardia Link', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic',
    tags: ['healing', 'mystic', 'passive'],
    description: 'Designate one ally at combat start as your Kardia partner. Every ability you use heals them for 8 flat HP. A constant stream of passive healing.',
    effects: [{ type: 'kardia_link', flatHeal: 8, description: 'Every ability use heals bonded ally for 8 HP' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'kardia_link', flatHeal: 8 } },

  { cardId: 'siphoning_strikes', name: 'Siphoning Strikes', type: 'passive_perk', rarity: 'uncommon', archetype: 'warrior', archetypeSecondary: ['mystic'],
    tags: ['offense', 'healing', 'passive'],
    description: 'Basic attacks restore 3% of your max HP. Sustain through aggression.',
    effects: [{ type: 'attack_self_heal', hpPercent: 0.03, description: 'Basic attacks restore 3% max HP' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'attack_self_heal', hpPercent: 0.03 } },

  // --- B. Stagger / Damage Conversion (WoW Brewmaster) ---

  { cardId: 'stagger', name: 'Stagger', type: 'passive_perk', rarity: 'legendary', archetype: 'warrior', archetypeSecondary: ['warrior'],
    tags: ['defense', 'warrior', 'passive'],
    description: '40% of damage taken is converted into a damage-over-time on yourself over 5 turns instead of hitting instantly. Smooths spike damage into manageable ticks.',
    effects: [{ type: 'stagger', convertPercent: 0.40, dotTurns: 5, description: '40% of damage taken becomes a 5-turn self-DoT' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'stagger', convertPercent: 0.40, dotTurns: 5 } },

  { cardId: 'ironskin', name: 'Ironskin', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior',
    tags: ['defense', 'warrior', 'passive'],
    description: 'While you did not move this turn, gain 15% damage reduction from all sources. Rewards holding the line.',
    effects: [{ type: 'stationary_damage_reduction', value: 0.15, description: '+15% DR when stationary' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'stationary_damage_reduction', value: 0.15 } },

  // --- C. Hot Streak / Crit Chains (WoW Fire Mage) ---

  { cardId: 'hot_streak', name: 'Hot Streak', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic', archetypeSecondary: ['warrior'],
    tags: ['offense', 'magic', 'passive'],
    description: 'Two consecutive critical hits grant your next ability +50% damage and zero cooldown. Rewards crit-stacking builds.',
    effects: [{ type: 'hot_streak', requiredCrits: 2, damageBonus: 0.50, freeCast: true, description: '2 consecutive crits = free +50% damage ability' }],
    icon: 'skills/Skill_Explosion.PNG',
    combatPassive: { type: 'hot_streak', requiredCrits: 2, damageBonus: 0.50, freeCast: true } },

  { cardId: 'shatter', name: 'Shatter', type: 'passive_perk', rarity: 'rare', archetype: 'mystic', archetypeSecondary: ['tactician'],
    tags: ['offense', 'magic', 'cc', 'passive'],
    description: 'Frozen or stunned enemies take 30% more critical damage from your attacks. Punishes crowd-controlled targets.',
    effects: [{ type: 'crit_damage_vs_cc', value: 0.30, ccTypes: ['frozen', 'stunned'], description: '+30% crit damage vs frozen/stunned enemies' }],
    icon: 'skills/Skill_Explosion.PNG',
    combatPassive: { type: 'crit_damage_vs_cc', value: 0.30, ccTypes: ['frozen', 'stunned'] } },

  // --- D. Transformation / Stance Cards (WoW DH, Lost Ark Berserker) ---

  { cardId: 'metamorphosis', name: 'Metamorphosis', type: 'active_ability', rarity: 'legendary', resourceType: 'stamina', archetype: 'warrior', archetypeSecondary: ['mystic'],
    tags: ['offense', 'magic'],
    description: 'Transform into a demonic form for 3 turns: +25% damage, +15% speed, all attacks deal AoE splash. Long cooldown.',
    effects: [{ type: 'transform', form: 'demon', duration: 3, damageBonus: 0.25, speedBonus: 0.15, aoeOnAttack: true }],
    icon: 'skills/Enchantment/',
    combatType: 'buff',
    range: 0, manaCost: 35, aoeRadius: 0, cooldown: 8,
    statusEffect: 'metamorphosis', statusDuration: 3,
    damageBoost: 8, speedMult: 1.15, aoeOnAttack: true,
    targetType: 'self' },


  { cardId: 'death_shroud', name: 'Death Shroud', type: 'passive_perk', rarity: 'legendary', archetype: 'warrior', archetypeSecondary: ['warrior'],
    tags: ['defense', 'necromancy', 'passive'],
    description: 'You have a second HP pool equal to 30% of max HP. When main HP depletes, enter Shroud mode using the second pool. When Shroud depletes, you die.',
    effects: [{ type: 'death_shroud', secondPoolPercent: 0.30, description: '30% max HP second life bar (Shroud mode)' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'death_shroud', secondPoolPercent: 0.30 } },

  // --- E. Execute Mechanics (WoW Warrior / Hunter) ---


  { cardId: 'mortal_strike', name: 'Mortal Strike', type: 'active_ability', rarity: 'rare', resourceType: 'bloodlust', archetype: 'warrior', archetypeSecondary: ['tactician'],
    tags: ['offense', 'melee'],
    description: 'A vicious melee strike that applies 25% healing reduction to the target for 3 turns. Shuts down enemy healing.',
    effects: [{ type: 'damage', element: 'physical', base: 25, scaling: 'might', factor: 0.5, description: 'Physical damage + healing reduction' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'damage', baseDamage: 25,
    range: 1, manaCost: 8, aoeRadius: 0, cooldown: 3,
    scalingStat: 'might', scalingFactor: 0.5,
    onHitStatus: { name: 'mortal_wound', duration: 3, healReduction: 0.25, type: 'debuff' },
    targetType: 'enemy' },

  { cardId: 'execute_strike', name: 'Execute', type: 'active_ability', rarity: 'uncommon', resourceType: 'bloodlust', archetype: 'warrior',
    tags: ['offense', 'melee'],
    description: 'A brutal finishing blow that deals double damage to targets below 30% HP.',
    effects: [{ type: 'damage', element: 'physical', base: 18, scaling: 'might', factor: 0.4, description: 'Double damage to targets below 30% HP' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'damage', baseDamage: 18,
    range: 1, manaCost: 5, aoeRadius: 0, cooldown: 2,
    scalingStat: 'might', scalingFactor: 0.4,
    executeThreshold: 0.30, executeBonusDamage: 1.0,
    targetType: 'enemy' },

  // --- F. Combo Chains (FFXIV melee combos) ---

  { cardId: 'combo_rising_edge', name: 'Combo: Rising Edge', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina', archetype: 'warrior',
    tags: ['melee', 'combo'],
    description: 'A rising slash that opens a combo chain. If it hits, unlocks Savage Blow for your next turn.',
    effects: [{ type: 'damage', element: 'physical', base: 14, scaling: 'might', factor: 0.4, description: 'Opener: unlocks Savage Blow on hit' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'damage', baseDamage: 14,
    range: 1, manaCost: 3, aoeRadius: 0, cooldown: 1,
    scalingStat: 'might', scalingFactor: 0.4,
    comboUnlocks: 'combo_savage_blow', comboWindowTurns: 2,
    targetType: 'enemy' },

  { cardId: 'combo_savage_blow', name: 'Combo: Savage Blow', type: 'active_ability', rarity: 'rare', resourceType: 'bloodlust', archetype: 'warrior',
    tags: ['melee', 'combo'],
    description: 'A savage follow-up strike. Can only be used after Rising Edge. Unlocks Full Thrust on hit.',
    effects: [{ type: 'damage', element: 'physical', base: 25, scaling: 'might', factor: 0.5, description: 'Combo 2: unlocks Full Thrust on hit' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'damage', baseDamage: 25,
    range: 1, manaCost: 5, aoeRadius: 0, cooldown: 1,
    scalingStat: 'might', scalingFactor: 0.5,
    comboRequires: 'combo_rising_edge', comboUnlocks: 'combo_full_thrust', comboWindowTurns: 2,
    targetType: 'enemy' },

  { cardId: 'combo_full_thrust', name: 'Combo: Full Thrust', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'bloodlust', archetype: 'warrior',
    tags: ['melee', 'combo'],
    description: 'A devastating finisher. Can only be used after Savage Blow. Deals 3x damage as the combo payoff.',
    effects: [{ type: 'damage', element: 'physical', base: 45, scaling: 'might', factor: 0.7, description: 'Combo finisher: 3x damage' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'damage', baseDamage: 45,
    range: 1, manaCost: 8, aoeRadius: 0, cooldown: 1,
    scalingStat: 'might', scalingFactor: 0.7,
    comboRequires: 'combo_savage_blow', comboFinisher: true,
    targetType: 'enemy' },

  // --- G. Clone / Illusion System (GW2 Mesmer) ---

  { cardId: 'mirror_image', name: 'Mirror Image', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['rogue'],
    tags: ['magic', 'illusion'],
    description: 'Create 2 illusion clones that each absorb one hit and deal minor damage per turn. Clones last 4 turns or until destroyed.',
    effects: [{ type: 'summon', summonType: 'illusion_clone', count: 2, duration: 4, description: 'Summon 2 mirror clones (1 HP each, deal minor damage)' }],
    icon: 'skills/Enchantment/',
    combatType: 'summon',
    range: 1, manaCost: 15, aoeRadius: 0, cooldown: 4,
    summonType: 'illusion_clone', summonCount: 2, summonHp: 1, summonDamage: 5, summonDuration: 4,
    targetType: 'any' },

  { cardId: 'shatter_mind', name: 'Shatter Mind', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'mystic',
    tags: ['magic', 'illusion'],
    description: 'Destroy all active clones. Each destroyed clone deals 20 burst damage to the target. More clones = more damage.',
    effects: [{ type: 'shatter', damagePerClone: 20, scaling: 'acumen', factor: 0.3, description: 'Destroy clones: 20 damage per clone to target' }],
    icon: 'skills/Enchantment/',
    combatType: 'damage', element: 'arcane', baseDamage: 0,
    range: 5, manaCost: 12, aoeRadius: 0, cooldown: 3,
    scalingStat: 'acumen', scalingFactor: 0.3,
    shattersClones: true, damagePerClone: 20,
    targetType: 'enemy' },

  { cardId: 'distortion', name: 'Distortion', type: 'passive_perk', rarity: 'rare', archetype: 'rogue', archetypeSecondary: ['warrior'],
    tags: ['magic', 'illusion', 'defense', 'passive'],
    description: 'When an illusion or clone is destroyed, you gain evasion for 1 turn (100% dodge). Rewards clone-based play.',
    effects: [{ type: 'on_clone_death_evasion', dodgeTurns: 1, description: 'Clone death grants 1 turn evasion' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'on_clone_death_evasion', dodgeTurns: 1 } },

  // --- H. Ground Zone / Totem Cards (WoW Shaman, FFXIV) ---

  { cardId: 'healing_totem', name: 'Healing Totem', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'mystic',
    tags: ['mystic', 'healing'],
    description: 'Place a healing totem that restores 3% max HP per turn to all allies within range 2 for 4 turns.',
    effects: [{ type: 'tile', element: 'holy', description: 'Healing totem: 3% HP/turn to nearby allies for 4 turns' }],
    icon: 'skills/Skill_Heal.PNG',
    combatType: 'tile_effect', tileEffect: 'HEALING_TOTEM',
    element: 'holy',
    range: 3, manaCost: 18, aoeRadius: 2, cooldown: 5,
    tileDuration: 4, tileHealPercent: 0.03,
    targetType: 'any' },

  { cardId: 'fire_totem', name: 'Fire Totem', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'mystic',
    tags: ['offense', 'magic'],
    description: 'Place a fire totem that deals 12 fire damage per turn to all enemies within range 2 for 4 turns.',
    effects: [{ type: 'tile', element: 'fire', description: 'Fire totem: 12 fire damage/turn to nearby enemies for 4 turns' }],
    icon: 'skills/Skill_Explosion.PNG',
    combatType: 'tile_effect', tileEffect: 'FIRE_TOTEM',
    element: 'fire',
    range: 3, manaCost: 16, aoeRadius: 2, cooldown: 5,
    tileDuration: 4, tileDamage: 12,
    targetType: 'any' },

  { cardId: 'earthen_ward_totem', name: 'Earthen Ward Totem', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'focus', archetype: 'warrior',
    tags: ['mystic', 'defense'],
    description: 'Place a warding totem that grants 10% damage reduction to all allies within range 2 for 4 turns.',
    effects: [{ type: 'tile', element: 'earth', description: 'Ward totem: 10% DR to allies in range for 4 turns' }],
    icon: 'skills/Skill_Defence.PNG',
    combatType: 'tile_effect', tileEffect: 'EARTHEN_TOTEM',
    element: 'earth',
    range: 3, manaCost: 20, aoeRadius: 2, cooldown: 5,
    tileDuration: 4, wardDamageReduction: 0.10,
    targetType: 'any' },

  { cardId: 'salted_earth', name: 'Salted Earth', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'tactician', archetypeSecondary: ['mystic'],
    tags: ['offense', 'magic', 'necromancy'],
    description: 'Desecrate the ground with dark energy. Enemies standing in the zone take 8 shadow damage per turn for 4 turns.',
    effects: [{ type: 'tile', element: 'shadow', description: 'Shadow zone: 8 shadow DoT to enemies standing in it' }],
    icon: 'skills/Enchantment/',
    combatType: 'tile_effect', tileEffect: 'SALTED_EARTH',
    element: 'shadow',
    range: 4, manaCost: 14, aoeRadius: 2, cooldown: 4,
    tileDuration: 4, tileDamage: 8,
    onHitStatus: { name: 'shadow_burn', duration: 2, tickDamage: 4, type: 'debuff' },
    targetType: 'any' },

  // --- I. Resource Accumulation (FFXIV WHM Lilies, Sage Addersgall) ---

  { cardId: 'lily_of_the_field', name: 'Lily of the Field', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic',
    tags: ['healing', 'life_magic', 'passive'],
    description: 'Gain 1 Lily token at the start of each turn. At 3 Lilies, your next heal is instant and +50% effective. Tokens consumed on use.',
    effects: [{ type: 'lily_accumulation', tokensPerTurn: 1, tokensRequired: 3, healBonus: 0.50, description: 'Accumulate Lilies: 3 = next heal +50% and instant' }],
    icon: 'skills/Skill_Heal.PNG',
    combatPassive: { type: 'lily_accumulation', tokensPerTurn: 1, tokensRequired: 3, healBonus: 0.50 } },

  { cardId: 'soul_shards', name: 'Soul Shards', type: 'passive_perk', rarity: 'rare', archetype: 'mystic',
    tags: ['offense', 'necromancy', 'passive'],
    description: 'Enemy kills generate 1 Soul Shard. At 5 shards, your next dark/shadow ability deals +75% damage. Shards consumed on use.',
    effects: [{ type: 'soul_shards', shardsPerKill: 1, shardsRequired: 5, damageBonus: 0.75, elements: ['dark', 'shadow'], description: 'Kill enemies for Shards: 5 = next dark ability +75% damage' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'soul_shards', shardsPerKill: 1, shardsRequired: 5, damageBonus: 0.75, elements: ['dark', 'shadow'] } },

  // --- J. Unique Utility/CC from MMOs ---

  { cardId: 'death_grip_pull', name: 'Death Grip', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'warrior', archetypeSecondary: ['tactician'],
    tags: ['cc', 'melee', 'necromancy'],
    description: 'Yank a distant enemy to melee range with necrotic chains, stunning them for 1 turn on arrival.',
    effects: [{ type: 'damage', element: 'shadow', base: 10, scaling: 'might', factor: 0.3, description: 'Pull enemy to you + stun 1 turn' }],
    icon: 'skills/Enchantment/',
    combatType: 'damage', element: 'shadow', baseDamage: 10,
    range: 5, manaCost: 12, aoeRadius: 0, cooldown: 4,
    scalingStat: 'might', scalingFactor: 0.3,
    pullToSelf: true,
    onHitStatus: { name: 'stunned', duration: 1, type: 'debuff' },
    targetType: 'enemy' },

  { cardId: 'polymorph', name: 'Polymorph', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'tactician', archetypeSecondary: ['mystic'],
    tags: ['magic', 'cc'],
    description: 'Transform the target into a harmless creature for 2 turns. Any damage breaks the effect. A powerful but fragile CC.',
    effects: [{ type: 'crowd_control', ccType: 'polymorph', duration: 2, breaksOnDamage: true, description: 'Polymorph: no actions for 2 turns, breaks on damage' }],
    icon: 'skills/Enchantment/',
    combatType: 'debuff', element: 'arcane',
    range: 5, manaCost: 20, aoeRadius: 0, cooldown: 5,
    statusEffect: 'polymorphed', statusDuration: 2,
    targetType: 'enemy',
    onHitStatus: { name: 'polymorphed', duration: 2, speedMult: 0.3, cantAct: true, breaksOnDamage: true, type: 'debuff' } },

  { cardId: 'bloodlust', name: 'Bloodlust', type: 'active_ability', rarity: 'legendary', resourceType: 'bloodlust', archetype: 'mystic', archetypeSecondary: ['warrior'],
    tags: ['mystic', 'psychology'],
    description: 'All party members gain 30% haste (attack speed and cooldown reduction) for 3 turns. Extremely long cooldown.',
    effects: [{ type: 'buff_all', stat: 'haste', value: 0.30, duration: 3, description: 'Party-wide 30% haste for 3 turns' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'buff',
    range: 0, manaCost: 40, aoeRadius: 0, cooldown: 10,
    statusEffect: 'bloodlust', statusDuration: 3,
    hasteMult: 1.30, cooldownReduction: 0.30,
    targetType: 'all_allies' },


  { cardId: 'binding_blade', name: 'Binding Blade', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'warrior', archetypeSecondary: ['tactician'],
    tags: ['melee', 'cc'],
    description: 'Throw spectral blades at up to 3 enemies, then pull them all to your position. Groups enemies for AoE follow-up.',
    effects: [{ type: 'damage', element: 'physical', base: 12, scaling: 'might', factor: 0.3, description: 'Hit 3 enemies then pull all to you' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'damage', baseDamage: 12,
    range: 4, manaCost: 15, aoeRadius: 0, cooldown: 4,
    scalingStat: 'might', scalingFactor: 0.3,
    multiTarget: 3, pullToSelf: true,
    targetType: 'enemy' },

  // --- K. Partner / Bond System (FFXIV Dancer) ---

  { cardId: 'dance_partner', name: 'Dance Partner', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'mystic',
    tags: ['mystic', 'passive'],
    description: 'Bond with one ally per encounter. All buff cards you apply also affect your dance partner at 50% effectiveness.',
    effects: [{ type: 'dance_partner', buffShare: 0.50, description: 'Buffs also apply to bonded partner at 50%' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'dance_partner', buffShare: 0.50 } },

  { cardId: 'ebon_might', name: 'Ebon Might', type: 'passive_perk', rarity: 'legendary', archetype: 'mystic',
    tags: ['mystic', 'passive'],
    description: '10% of your highest primary stat is added to up to 3 nearby allies. The ultimate force multiplier for organized parties.',
    effects: [{ type: 'ebon_might', statSharePercent: 0.10, maxTargets: 3, range: 3, description: '10% of your highest stat shared with 3 allies' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'ebon_might', statSharePercent: 0.10, maxTargets: 3, range: 3 } },

  // --- L. Reflect / Counter Mechanics ---

  { cardId: 'dragonfire_scale', name: 'Dragonfire Scale', type: 'passive_perk', rarity: 'rare', archetype: 'warrior', archetypeSecondary: ['rogue'],
    tags: ['defense', 'passive'],
    description: '20% chance to reflect projectile and ranged attacks back at the attacker for full damage.',
    effects: [{ type: 'projectile_reflect', chance: 0.20, description: '20% chance to reflect ranged attacks' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'projectile_reflect', chance: 0.20 } },

  { cardId: 'riposte_passive', name: 'Riposte', type: 'passive_perk', rarity: 'uncommon', archetype: 'rogue', archetypeSecondary: ['warrior'],
    tags: ['defense', 'offense', 'melee', 'passive'],
    description: 'After blocking or dodging an attack, your next attack deals +25% damage. Rewards defensive play with offensive payoff.',
    effects: [{ type: 'riposte', damageBonus: 0.25, description: '+25% damage on next attack after block/dodge' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'riposte', damageBonus: 0.25 } },

  { cardId: 'thorns_aura', name: 'Thorns Aura', type: 'passive_perk', rarity: 'rare', archetype: 'warrior',
    tags: ['defense', 'passive'],
    description: 'Melee attackers take 10% of the damage they deal to you as reflected physical damage. Punishes sustained melee assault.',
    effects: [{ type: 'melee_damage_reflect', value: 0.10, description: 'Melee attackers take 10% of dealt damage' }],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'melee_damage_reflect', value: 0.10 } },

  // --- M. Additional Iconic MMO Mechanics ---

  { cardId: 'mark_of_the_wild', name: 'Mark of the Wild', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'mystic', archetypeSecondary: ['warrior'],
    tags: ['mystic', 'magic'],
    description: 'Bless all party members with nature energy: +3 to all stats and +5% damage reduction for 5 turns.',
    effects: [{ type: 'buff_all', stat: 'all', value: 3, duration: 5 }],
    icon: 'skills/Herbalism/',
    combatType: 'buff',
    range: 0, manaCost: 20, aoeRadius: 0, cooldown: 6,
    statusEffect: 'mark_of_wild', statusDuration: 5,
    statBoost: { vigor: 3, might: 3, finesse: 3, acumen: 3, resolve: 3, ingenuity: 3 },
    damageReduction: 0.05,
    targetType: 'all_allies' },


  { cardId: 'lay_on_hands', name: 'Lay on Hands', type: 'active_ability', rarity: 'legendary', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['warrior'],
    tags: ['healing', 'life_magic', 'magic'],
    description: 'Fully restore one ally to 100% HP. Extremely long cooldown. The ultimate emergency heal.',
    effects: [{ type: 'heal_full', description: 'Heal target to 100% HP' }],
    icon: 'skills/Skill_Heal.PNG',
    combatType: 'healing', element: 'holy', baseHeal: 9999,
    range: 1, manaCost: 50, aoeRadius: 0, cooldown: 10,
    scalingStat: 'resolve', scalingFactor: 0,
    fullHeal: true,
    targetType: 'ally' },

  { cardId: 'intercept', name: 'Intercept', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'warrior', archetypeSecondary: ['mystic'],
    tags: ['defense', 'warrior', 'melee'],
    description: 'Charge to an ally within range 4. For 2 turns, redirect all damage they would take to you instead.',
    effects: [{ type: 'intercept', duration: 2, description: 'Charge to ally and absorb their damage for 2 turns' }],
    icon: 'skills/Skill_Defence.PNG',
    combatType: 'buff',
    range: 4, manaCost: 10, aoeRadius: 0, cooldown: 5,
    statusEffect: 'intercepting', statusDuration: 2,
    redirectDamage: true, leapToTarget: true,
    targetType: 'ally' },

  { cardId: 'intervene', name: 'Intervene', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior', archetypeSecondary: ['warrior'],
    tags: ['defense', 'warrior', 'passive'],
    description: 'When a nearby ally within range 2 would take a hit exceeding 30% of their max HP, you automatically step in and take 50% of that damage instead.',
    effects: [{ type: 'intervene', damageShare: 0.50, hpThreshold: 0.30, range: 2, description: 'Auto-intercept big hits on nearby allies' }],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'intervene', damageShare: 0.50, hpThreshold: 0.30, range: 2 } },


  { cardId: 'avatar_of_war', name: 'Avatar of War', type: 'active_ability', rarity: 'mythic_rare', resourceType: 'bloodlust', archetype: 'warrior', archetypeSecondary: ['warrior'],
    tags: ['offense', 'melee'],
    description: 'Become an unstoppable avatar for 4 turns: +30% damage, +20% size (can not be knocked back), immune to CC. Costs 20% of current HP to activate.',
    effects: [{ type: 'transform', form: 'avatar', duration: 4, damageBonus: 0.30, ccImmune: true, knockbackImmune: true }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'buff',
    range: 0, manaCost: 20, aoeRadius: 0, cooldown: 8,
    statusEffect: 'avatar_of_war', statusDuration: 4,
    damageBoost: 10, ccImmune: true, knockbackImmune: true,
    hpCost: 0.20,
    targetType: 'self' },

  { cardId: 'fade', name: 'Fade', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'mystic',
    tags: ['healing', 'mystic'],
    description: 'Instantly drop all threat/aggro, causing enemies to temporarily ignore you for 2 turns. Emergency healer survival tool.',
    effects: [{ type: 'threat_drop', duration: 2, description: 'Drop all aggro for 2 turns' }],
    icon: 'skills/Enchantment/',
    combatType: 'buff',
    range: 0, manaCost: 8, aoeRadius: 0, cooldown: 4,
    statusEffect: 'faded', statusDuration: 2,
    threatDrop: true,
    targetType: 'self' },

  { cardId: 'soulstone', name: 'Soulstone', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana', archetype: 'mystic', archetypeSecondary: ['warrior'],
    tags: ['necromancy', 'mystic', 'magic'],
    description: 'Pre-cast on an ally. If they die within 5 turns, they auto-revive at 30% HP. Can only be active on one target.',
    effects: [{ type: 'pre_revive', hpPercent: 0.30, duration: 5, description: 'Target auto-revives at 30% HP if killed within 5 turns' }],
    icon: 'skills/Enchantment/',
    combatType: 'buff', element: 'shadow',
    range: 4, manaCost: 25, aoeRadius: 0, cooldown: 8,
    statusEffect: 'soulstoned', statusDuration: 5,
    reviveHpPercent: 0.30,
    targetType: 'ally' },

  { cardId: 'innervate', name: 'Innervate', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'mystic',
    tags: ['mystic', 'magic'],
    description: 'Grant an ally 5 mana regeneration per turn for 4 turns. Keeps casters in the fight.',
    effects: [{ type: 'mana_regen_buff', value: 5, duration: 4, description: '+5 mana/turn to target for 4 turns' }],
    icon: 'skills/Enchantment/',
    combatType: 'buff',
    range: 4, manaCost: 5, aoeRadius: 0, cooldown: 5,
    statusEffect: 'innervate', statusDuration: 4,
    manaPerTurn: 5,
    targetType: 'ally' },

  // === ANIMAL MORPHING CARDS (Druid-style shapeshifting) ===

  { cardId: 'rat_form', name: 'Rat Form', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'rogue',
    tags: ['animal_handling'],
    description: 'Transform into a rat for 4 turns. +50% movement speed, +30% evasion, can access small passages. -60% damage dealt, -40% HP. Ideal for scouting and escape.',
    effects: [{ type: 'transform', form: 'rat', duration: 4, animalForm: true, speedBonus: 0.50, dodgeBonus: 0.30, damageDealt: -0.60, hpMult: -0.40 }],
    icon: 'skills/Herbalism/',
    combatType: 'buff',
    range: 0, manaCost: 8, aoeRadius: 0, cooldown: 4,
    statusEffect: 'animal_form_rat', statusDuration: 4,
    animalForm: 'rat',
    speedMult: 1.50,
    damageBoost: -6,
    maxHpPercent: -0.40,
    dodgeBonus: 0.30,
    stealthBonus: 0.30,
    damageType: 'nature',
    targetType: 'self',
    explorationAbilities: {
      canFitSmallHoles: true,
      canCrawlUnderDoors: true,
      canAccessVents: true,
      canScavenge: true,
    } },



  { cardId: 'bear_form', name: 'Bear Form', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'stamina', archetype: 'warrior', archetypeSecondary: ['warrior'],
    tags: ['animal_handling'],
    description: 'Transform into a bear for 5 turns. +50% max HP, +30% armor, -20% speed. Maul: powerful AoE swipe. Thick Hide: -30% crit damage taken. Taunts nearby enemies on transform.',
    effects: [{ type: 'transform', form: 'bear', duration: 5, animalForm: true, hpBonus: 0.50, armorBonus: 0.30, speedPenalty: -0.20, maulAoe: true, thickHide: true, tauntOnTransform: true }],
    icon: 'skills/Herbalism/',
    combatType: 'buff',
    range: 0, manaCost: 20, aoeRadius: 0, cooldown: 7,
    statusEffect: 'animal_form_bear', statusDuration: 5,
    animalForm: 'bear',
    maxHpPercent: 0.50,
    armorBoost: 8,
    speedMult: 0.80,
    critDamageReduction: 0.30,
    tauntAoe: true,
    damageType: 'nature',
    targetType: 'self',
    explorationAbilities: {
      canBreakWalls: true,
      canForceOpenDoors: true,
      canPushBoulders: true,
      canSwim: true,
      canAnimalSpeak: ['bear'],
    } },

  { cardId: 'cat_form', name: 'Cat Form', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'rogue', archetypeSecondary: ['warrior'],
    tags: ['animal_handling'],
    description: 'Transform into a cat for 4 turns. +30% crit chance, +20% speed, -15% max HP. Pounce: first attack stuns 1 turn. Attacks apply Rake bleed. Prowl: 50% stealth on kill.',
    effects: [{ type: 'transform', form: 'cat', duration: 4, animalForm: true, critBonus: 0.30, speedBonus: 0.20, hpPenalty: -0.15, pounce: true, rakeBleed: true, prowlOnKill: true }],
    icon: 'skills/Herbalism/',
    combatType: 'buff',
    range: 0, manaCost: 14, aoeRadius: 0, cooldown: 5,
    statusEffect: 'animal_form_cat', statusDuration: 4,
    animalForm: 'cat',
    critBonus: 0.30,
    speedMult: 1.20,
    maxHpPercent: -0.15,
    pounceStun: 1,
    bleedOnHit: { tickDamage: 4, duration: 3, name: 'rake_bleed' },
    prowlOnKill: 0.50,
    damageType: 'nature',
    targetType: 'self',
    explorationAbilities: {
      canFitSmallHoles: true,
      canClimbWalls: true,
      canLandSafely: true,
      canSneakPast: true,
      canAnimalSpeak: ['cat', 'lion', 'panther'],
    } },

  { cardId: 'hound_form', name: 'Hound Form', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'mystic', archetypeSecondary: ['warrior'],
    tags: ['animal_handling'],
    description: 'Transform into a loyal hound for 4 turns. Loyal Companion: nearby allies gain +5% damage and +10% HP regen. Track Prey: reveal hidden enemies. Guard: 20% chance to intercept attacks on allies.',
    effects: [{ type: 'transform', form: 'hound', duration: 4, animalForm: true, loyalCompanion: true, trackPrey: true, guardAlly: true }],
    icon: 'skills/Herbalism/',
    combatType: 'buff',
    range: 0, manaCost: 10, aoeRadius: 0, cooldown: 4,
    statusEffect: 'animal_form_hound', statusDuration: 4,
    animalForm: 'hound',
    allyDamageAura: 0.05,
    allyHpRegenAura: 0.10,
    revealHidden: true,
    guardIntercept: 0.20,
    damageType: 'nature',
    targetType: 'self',
    explorationAbilities: {
      canTrackScent: true,
      canDig: true,
      canFetchItems: true,
      canAnimalSpeak: ['dog', 'wolf', 'hound'],
    } },

  { cardId: 'fish_form', name: 'Fish Form', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'aquatic', archetypeSecondary: ['rogue'],
    tags: ['animal_handling'],
    description: 'Transform into a fish for 3 turns. Move through water tiles freely, +80% water speed. Slippery: +40% dodge in water, -50% damage on land. Water Breathing: immune to drowning.',
    effects: [{ type: 'transform', form: 'fish', duration: 3, animalForm: true, waterSpeed: 0.80, waterDodge: 0.40, landPenalty: -0.50, waterBreathing: true }],
    icon: 'skills/Herbalism/',
    combatType: 'buff',
    range: 0, manaCost: 8, aoeRadius: 0, cooldown: 4,
    statusEffect: 'animal_form_fish', statusDuration: 3,
    animalForm: 'fish',
    speedMult: 1.80,
    dodgeBonus: 0.40,
    waterBreathing: true,
    landDamagePenalty: -0.50,
    damageType: 'nature',
    targetType: 'self',
    explorationAbilities: {
      canSwimDeep: true,
      canBreathUnderwater: true,
      canAccessUnderwaterPaths: true,
      canAnimalSpeak: ['fish', 'aquatic'],
    } },

  { cardId: 'eagle_form', name: 'Eagle Form', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'focus', archetype: 'rogue', archetypeSecondary: ['mystic'],
    tags: ['animal_handling'],
    description: 'Transform into an eagle for 3 turns. Skyview: reveal entire map. Dive Bomb: +50% damage single-target with 1 turn stun. +30% speed, immune to ground hazards. Cannot be hit by melee (range <2).',
    effects: [{ type: 'transform', form: 'eagle', duration: 3, animalForm: true, skyview: true, diveBomb: true, speedBonus: 0.30, meleeImmune: true }],
    icon: 'skills/Herbalism/',
    combatType: 'buff',
    range: 0, manaCost: 22, aoeRadius: 0, cooldown: 7,
    statusEffect: 'animal_form_eagle', statusDuration: 3,
    animalForm: 'eagle',
    speedMult: 1.30,
    flyOver: true,
    revealAll: true,
    diveBombDamage: 0.50, diveBombStun: 1,
    meleeImmune: true,
    damageType: 'nature',
    targetType: 'self',
    explorationAbilities: {
      canFly: true,
      canFlyOverWater: true,
      canAccessHighLedges: true,
      canScoutAhead: true,
      canAnimalSpeak: ['bird', 'eagle', 'hawk'],
    } },




  { cardId: 'turtle_form', name: 'Turtle Form', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina', archetype: 'warrior', archetypeSecondary: ['warrior'],
    tags: ['animal_handling'],
    description: 'Transform into a turtle for 5 turns. Shell: +60% damage reduction but CANNOT attack or move. Withdraw: become nearly invulnerable (90% DR) for 1 turn. +5% HP regen per turn.',
    effects: [{ type: 'transform', form: 'turtle', duration: 5, animalForm: true, shellDR: 0.60, withdrawDR: 0.90, cantAttack: true, cantMove: true, hpRegenPercent: 0.05 }],
    icon: 'skills/Herbalism/',
    combatType: 'buff',
    range: 0, manaCost: 10, aoeRadius: 0, cooldown: 6,
    statusEffect: 'animal_form_turtle', statusDuration: 5,
    animalForm: 'turtle',
    damageReduction: 12,
    shellDR: 0.60,
    withdrawDR: 0.90,
    cantAttack: true, cantMove: true,
    hpRegenPercent: 0.05,
    damageType: 'nature',
    targetType: 'self',
    explorationAbilities: {
      canSwimDeep: true,
      canBreathUnderwater: true,
      canBlockPassage: true,
      canShellProtect: true,
      canAnimalSpeak: ['turtle', 'tortoise', 'reptile'],
    } },

  // === ANIMAL MORPHING PASSIVE CARDS ===

  { cardId: 'shapeshifters_mastery', name: "Shapeshifter's Mastery", type: 'passive_perk', rarity: 'legendary', archetype: 'tactician',
    tags: ['animal_handling'],
    description: 'All animal form transformations last 2 extra turns. +10% to all form bonuses. Switching forms costs 50% less mana.',
    effects: [
      { type: 'animal_form_duration_bonus', value: 2, description: '+2 turns to all animal forms' },
      { type: 'animal_form_bonus_multiplier', value: 0.10, description: '+10% to all form stat bonuses' },
      { type: 'animal_form_mana_reduction', value: 0.50, description: '50% less mana to switch forms' },
    ],
    icon: 'skills/Herbalism/',
    combatPassive: { type: 'shapeshifters_mastery', formDurationBonus: 2, formBonusMult: 0.10, formManaReduction: 0.50 } },

  { cardId: 'primal_surge', name: 'Primal Surge', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician',
    tags: ['animal_handling'],
    description: 'When exiting any animal form, gain Primal Surge: +15% all stats for 2 turns. Reduces animal form cooldowns by 20%.',
    effects: [
      { type: 'on_form_expire_buff', statBonus: 0.15, duration: 2, description: '+15% all stats for 2 turns on form expiry' },
      { type: 'animal_form_cooldown_reduction', value: 0.20, description: '-20% cooldown on animal forms' },
    ],
    icon: 'skills/Herbalism/',
    combatPassive: { type: 'primal_surge', onFormExpireBuff: 0.15, onFormExpireDuration: 2, formCooldownReduction: 0.20 } },

  { cardId: 'natural_attunement', name: 'Natural Attunement', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['animal_handling'],
    description: 'While in any animal form, regenerate 2% HP per turn. Animal form abilities cost 15% less mana.',
    effects: [
      { type: 'animal_form_hp_regen', value: 0.02, description: '+2% HP regen/turn in animal form' },
      { type: 'animal_form_mana_reduction', value: 0.15, description: '-15% mana cost for animal forms' },
    ],
    icon: 'skills/Herbalism/',
    combatPassive: { type: 'natural_attunement', formHpRegen: 0.02, formManaReduction: 0.15 } },

  // ========================================================================
  // GRAPPLER ARCHETYPE (Wrestling / Martial Arts Grappling)
  // ========================================================================

  { cardId: 'grappler_iron_grip', name: 'Iron Grip', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina',
    tags: ['melee', 'cc', 'warrior'],
    archetype: 'warrior', skill: 'melee',
    description: 'Grab an enemy, preventing them from moving or attacking for 2 turns. You also cannot move during the hold. Melee range only.',
    effects: [{ type: 'crowd_control', ccType: 'grapple', duration: 2, selfImmobilize: true, description: 'Grapple: target and self immobilized for 2 turns' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'debuff',
    range: 1, manaCost: 6, aoeRadius: 0, cooldown: 4,
    scalingStat: 'might', scalingFactor: 0.0,
    statusEffect: 'grappled', statusDuration: 2,
    selfImmobilize: true, selfCantAttack: false,
    targetType: 'enemy' },

  { cardId: 'suplex', name: 'Suplex', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'tactician',
    tags: ['melee', 'cc', 'warrior'],
    archetype: 'warrior', skill: 'melee',
    description: 'Grab and slam an adjacent enemy into the ground, dealing heavy physical damage and stunning them for 1 turn. Requires adjacent target.',
    effects: [{ type: 'damage', element: 'physical', base: 35, scaling: 'might', factor: 0.7, description: 'Slam for heavy damage + 1 turn stun' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'damage', baseDamage: 35,
    range: 1, manaCost: 10, aoeRadius: 0, cooldown: 4,
    scalingStat: 'might', scalingFactor: 0.7,
    onHitStatus: { name: 'stunned', duration: 1, type: 'debuff' },
    damageType: 'physical',
    targetType: 'enemy' },

  { cardId: 'submission_hold', name: 'Submission Hold', type: 'active_ability', rarity: 'rare', resourceType: 'stamina', archetype: 'tactician',
    tags: ['melee', 'cc', 'warrior'],
    archetype: 'warrior', skill: 'melee',
    description: 'Lock an enemy in a crushing hold for 3 turns, dealing damage each turn. Neither you nor the enemy can act. Breaks if you take external damage.',
    effects: [{ type: 'crowd_control', ccType: 'submission', duration: 3, tickDamage: 12, selfImmobilize: true, breaksOnDamageToSelf: true, description: 'Submission: 12 damage/turn for 3 turns, both immobilized, breaks if you take damage' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'debuff',
    range: 1, manaCost: 12, aoeRadius: 0, cooldown: 5,
    scalingStat: 'might', scalingFactor: 0.4,
    statusEffect: 'submission_hold', statusDuration: 3,
    tickDamage: 12, selfImmobilize: true, selfCantAttack: true,
    breaksOnDamageToSelf: true,
    damageType: 'physical',
    targetType: 'enemy' },


  { cardId: 'hip_toss', name: 'Hip Toss', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina', archetype: 'tactician',
    tags: ['melee', 'cc', 'warrior'],
    archetype: 'warrior', skill: 'melee',
    description: 'Throw an adjacent enemy 3 tiles away, dealing damage on landing. If they collide with a wall, deal bonus damage and stun for 1 turn.',
    effects: [{ type: 'damage', element: 'physical', base: 18, scaling: 'might', factor: 0.5, description: 'Throw 3 tiles; wall collision: +50% damage + stun' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'damage', baseDamage: 18,
    range: 1, manaCost: 6, aoeRadius: 0, cooldown: 3,
    scalingStat: 'might', scalingFactor: 0.5,
    throwDistance: 3, wallCollisionBonusDamage: 0.50,
    wallCollisionStatus: { name: 'stunned', duration: 1, type: 'debuff' },
    damageType: 'physical',
    targetType: 'enemy' },



  { cardId: 'pile_driver', name: 'Pile Driver', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'stamina', archetype: 'tactician',
    tags: ['melee', 'warrior'],
    archetype: 'warrior', skill: 'melee',
    description: 'Grab an enemy, leap into the air, and slam them headfirst into the ground. Highest grappler damage. AoE shockwave on landing damages nearby enemies.',
    effects: [{ type: 'damage', element: 'physical', base: 65, scaling: 'might', factor: 1.0, description: 'Massive slam + AoE shockwave to nearby enemies' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'damage', baseDamage: 65,
    range: 1, manaCost: 22, aoeRadius: 1, cooldown: 7,
    scalingStat: 'might', scalingFactor: 1.0,
    primaryTargetBonusDamage: 0.50,
    damageType: 'physical',
    targetType: 'enemy' },

  { cardId: 'bear_hug', name: 'Bear Hug', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician',
    tags: ['melee', 'warrior', 'warrior'],
    archetype: 'warrior', skill: 'melee',
    description: 'When you grapple an enemy, deal 5% of your max HP as bonus physical damage each turn the grapple is held.',
    effects: [
      { type: 'grapple_tick_damage_hp_percent', value: 0.05, description: '+5% max HP as damage per turn while grappling' },
    ],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'bear_hug', grappleTickDamageHpPercent: 0.05 } },

  { cardId: 'wrestlers_resilience', name: "Wrestler's Resilience", type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['melee', 'warrior', 'defense'],
    archetype: 'warrior', skill: 'melee',
    description: '+20% resistance to stuns and knockbacks. When grappled yourself, break free 30% faster.',
    effects: [
      { type: 'stun_resist', value: 0.20, description: '+20% stun resistance' },
      { type: 'knockback_resist', value: 0.20, description: '+20% knockback resistance' },
      { type: 'grapple_break_speed', value: 0.30, description: 'Break free from grapples 30% faster' },
    ],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'wrestlers_resilience', stunResist: 0.20, knockbackResist: 0.20, grappleBreakSpeed: 0.30 } },

  // ========================================================================
  // NIGHT HUNTER ARCHETYPE (Dark / Stealth Detection / Counter-Attack / Nocturnal Predator)
  // ========================================================================

  { cardId: 'night_hunter_mark', name: "Predator's Mark", type: 'active_ability', rarity: 'rare', resourceType: 'focus',
    tags: ['stealth', 'rogue', 'debuff'],
    archetype: 'rogue', skill: 'none',
    description: 'Mark a target for 5 turns. Marked targets cannot stealth, take 15% more damage from you, and you always know their position.',
    effects: [{ type: 'mark', duration: 5, antiStealth: true, damageAmp: 0.15, reveal: true, description: 'Mark: no stealth, +15% damage from you, position revealed for 5 turns' }],
    icon: 'skills/Enchantment/',
    combatType: 'debuff',
    range: 6, manaCost: 10, aoeRadius: 0, cooldown: 4,
    statusEffect: 'predators_mark', statusDuration: 5,
    antiStealth: true, damageAmpFromCaster: 0.15, revealPosition: true,
    targetType: 'enemy' },

  { cardId: 'nocturnal_strike', name: 'Nocturnal Strike', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'tactician',
    tags: ['melee', 'rogue'],
    archetype: 'rogue', skill: 'melee',
    description: 'A vicious attack that deals +40% bonus damage in darkness or at night. Applies the "exposed" debuff, reducing target armor.',
    effects: [{ type: 'damage', element: 'physical', base: 28, scaling: 'finesse', factor: 0.6, description: '+40% damage in darkness/night; applies exposed' }],
    icon: 'skills/Enchantment/',
    combatType: 'damage', baseDamage: 28,
    range: 1, manaCost: 8, aoeRadius: 0, cooldown: 3,
    scalingStat: 'finesse', scalingFactor: 0.6,
    nightDamageBonus: 0.40,
    onHitStatus: { name: 'exposed', duration: 3, armorReduction: 6, type: 'debuff' },
    damageType: 'physical',
    targetType: 'enemy' },

  { cardId: 'hunters_instinct', name: "Hunter's Instinct", type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician',
    tags: ['rogue', 'offense'],
    archetype: 'rogue', skill: 'none',
    description: '+15% damage against enemies that are debuffed. +10% crit chance against marked targets.',
    effects: [
      { type: 'damage_vs_debuffed', value: 0.15, description: '+15% damage vs debuffed enemies' },
      { type: 'crit_vs_marked', value: 0.10, description: '+10% crit vs marked targets' },
    ],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'hunters_instinct', damageVsDebuffed: 0.15, critVsMarked: 0.10 } },

  { cardId: 'moonlight_slash', name: 'Moonlight Slash', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'tactician',
    tags: ['melee', 'rogue', 'holy'],
    archetype: 'rogue', skill: 'melee',
    description: 'A silver-element melee strike. Deals bonus damage against undead, werewolves, and shadow creatures. Reveals hidden enemies on hit.',
    effects: [{ type: 'damage', element: 'silver', base: 30, scaling: 'might', factor: 0.6, description: 'Silver strike; bonus vs undead/shadow; reveals hidden' }],
    icon: 'skills/Enchantment/',
    combatType: 'damage', element: 'silver', baseDamage: 30,
    range: 1, manaCost: 12, aoeRadius: 0, cooldown: 3,
    scalingStat: 'might', scalingFactor: 0.6,
    bonusVsUndead: 15, bonusVsShadow: 15,
    revealHidden: true,
    damageType: 'physical',
    targetType: 'enemy' },

  { cardId: 'trap_layer', name: 'Trap Layer', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'tactician',
    tags: ['rogue', 'cc', 'utility'],
    archetype: 'rogue', skill: 'none',
    description: 'Place an invisible trap on a tile. When an enemy walks over it: root for 2 turns and reveal hidden/stealthed status.',
    effects: [{ type: 'tile', description: 'Invisible trap: root 2 turns + reveal on trigger' }],
    icon: 'skills/Enchantment/',
    combatType: 'tile_effect', tileEffect: 'HIDDEN_TRAP',
    range: 3, manaCost: 8, aoeRadius: 0, cooldown: 3,
    trapTriggerStatus: { name: 'rooted', duration: 2, type: 'debuff' },
    trapRevealsHidden: true, trapInvisible: true,
    targetType: 'any' },

  { cardId: 'shadow_sight', name: 'Shadow Sight', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['rogue', 'utility'],
    archetype: 'rogue', skill: 'none',
    description: 'See all hidden, invisible, and stealthed enemies at all times. Immune to blindness effects. +10% accuracy.',
    effects: [
      { type: 'true_sight', value: true, description: 'See all hidden/invisible/stealthed enemies' },
      { type: 'immunity', element: 'blindness', description: 'Immune to blindness' },
      { type: 'accuracy_bonus', value: 0.10, description: '+10% accuracy' },
    ],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'shadow_sight', trueSight: true, blindImmune: true, accuracyBonus: 0.10 } },

  { cardId: 'counterstrike_stance', name: 'Counterstrike Stance', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'stamina', archetype: 'tactician',
    tags: ['rogue', 'melee', 'defense'],
    archetype: 'rogue', skill: 'melee',
    description: 'Enter a counter stance for 3 turns. When attacked in melee, automatically counter-attack for 50% of your normal damage.',
    effects: [{ type: 'buff', duration: 3, description: 'Counter stance: auto-counter melee attacks for 50% damage for 3 turns' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatType: 'buff',
    range: 0, manaCost: 14, aoeRadius: 0, cooldown: 5,
    statusEffect: 'counterstrike_stance', statusDuration: 3,
    counterAttackPercent: 0.50, counterOnMelee: true,
    targetType: 'self' },

  { cardId: 'relentless_pursuit', name: 'Relentless Pursuit', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician',
    tags: ['rogue', 'offense'],
    archetype: 'rogue', skill: 'none',
    description: 'When an enemy tries to flee or disengage from you, gain a free attack of opportunity. +15% movement speed when chasing marked targets.',
    effects: [
      { type: 'attack_of_opportunity', onFlee: true, description: 'Free attack when enemy disengages' },
      { type: 'speed_bonus_vs_marked', value: 0.15, description: '+15% speed chasing marked targets' },
    ],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'relentless_pursuit', attackOnFlee: true, chaseSpeedVsMarked: 0.15 } },

  // ========================================================================
  // AQUATIC ARCHETYPE EXPANSION (Water / Ocean / Tidal Combat)
  // ========================================================================

  { cardId: 'depth_charge', name: 'Depth Charge', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic',
    tags: ['aquatic', 'magic'],
    archetype: 'aquatic', skill: 'none',
    description: 'Explosive water blast that deals AoE damage. Deals +100% bonus damage if the target is standing in water.',
    effects: [{ type: 'damage', element: 'water', base: 25, scaling: 'acumen', factor: 0.5, description: 'Water blast AoE; +100% damage vs targets in water' }],
    icon: 'skills/Skill_Explosion.PNG',
    combatType: 'damage', element: 'water', baseDamage: 25,
    range: 5, manaCost: 15, aoeRadius: 1, cooldown: 3,
    scalingStat: 'acumen', scalingFactor: 0.5,
    waterTileBonusDamage: 1.00,
    damageType: 'water',
    targetType: 'enemy' },


  { cardId: 'aquatic_adaptation', name: 'Aquatic Adaptation', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['aquatic', 'utility'],
    archetype: 'aquatic', skill: 'none',
    description: '+30% to all stats while standing on water tiles. Can breathe underwater. +20% swim speed.',
    effects: [
      { type: 'water_tile_stat_bonus', value: 0.30, description: '+30% all stats on water tiles' },
      { type: 'water_breathing', value: true, description: 'Can breathe underwater' },
      { type: 'swim_speed_bonus', value: 0.20, description: '+20% swim speed' },
    ],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'aquatic_adaptation', waterTileStatBonus: 0.30, waterBreathing: true, swimSpeedBonus: 0.20 } },

  { cardId: 'kraken_tentacle', name: 'Kraken Tentacle', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'mana',
    tags: ['aquatic', 'cc', 'warrior'],
    archetype: 'aquatic', skill: 'none',
    description: 'Summon a massive tentacle that grabs an enemy from range, pulling them adjacent to you and dealing damage. Functions as a ranged grapple.',
    effects: [{ type: 'damage', element: 'water', base: 30, scaling: 'acumen', factor: 0.6, description: 'Ranged grab: pull to melee + damage' }],
    icon: 'skills/Enchantment/',
    combatType: 'damage', element: 'water', baseDamage: 30,
    range: 5, manaCost: 18, aoeRadius: 0, cooldown: 5,
    scalingStat: 'acumen', scalingFactor: 0.6,
    pullToSelf: true,
    onHitStatus: { name: 'grappled', duration: 1, type: 'debuff' },
    damageType: 'water',
    targetType: 'enemy' },

  { cardId: 'tidal_shield', name: 'Tidal Shield', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina', archetype: 'warrior',
    tags: ['aquatic', 'defense'],
    archetype: 'aquatic', skill: 'none',
    description: 'Conjure a swirling water barrier that absorbs damage. If you are standing in water, the shield absorbs twice as much.',
    effects: [{ type: 'shield', base: 30, scaling: 'resolve', factor: 0.4, description: 'Water shield; 2x absorption on water tiles' }],
    icon: 'skills/Skill_Defence.PNG',
    combatType: 'buff',
    range: 0, manaCost: 10, aoeRadius: 0, cooldown: 3,
    statusEffect: 'tidal_shield', statusDuration: 3,
    armorBoost: 6, shieldBase: 30,
    waterTileShieldMultiplier: 2.0,
    targetType: 'self' },

  // ========================================================================
  // PURE DEFENSE ARCHETYPE EXPANSION (Tank / Damage Mitigation / Sustain)
  // ========================================================================

  { cardId: 'absolute_guard', name: 'Absolute Guard', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'stamina',
    tags: ['defense', 'warrior'],
    archetype: 'warrior', skill: 'none',
    description: 'Block ALL incoming damage for 1 turn, but you cannot move or attack during it. Shorter cooldown than divine shield.',
    effects: [{ type: 'invulnerability', duration: 1, description: 'Block all damage for 1 turn; cannot move or attack' }],
    icon: 'skills/Skill_Defence.PNG',
    combatType: 'buff',
    range: 0, manaCost: 15, aoeRadius: 0, cooldown: 5,
    statusEffect: 'absolute_guard', statusDuration: 1,
    invulnerable: true, cantAttack: true, cantMove: true,
    targetType: 'self' },

  { cardId: 'fortify', name: 'Fortify', type: 'active_ability', rarity: 'uncommon', resourceType: 'stamina', archetype: 'tactician',
    tags: ['defense', 'warrior'],
    archetype: 'warrior', skill: 'none',
    description: '+30% armor for 4 turns. If you do not move during the buff, the bonus increases to +50% instead.',
    effects: [{ type: 'buff', duration: 4, description: '+30% armor (50% if stationary) for 4 turns' }],
    icon: 'skills/Skill_Defence.PNG',
    combatType: 'buff',
    range: 0, manaCost: 8, aoeRadius: 0, cooldown: 4,
    statusEffect: 'fortified', statusDuration: 4,
    armorBoostPercent: 0.30, stationaryArmorBoostPercent: 0.50,
    targetType: 'self' },

  { cardId: 'damage_sponge', name: 'Damage Sponge', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    tags: ['defense', 'warrior', 'warrior'],
    archetype: 'warrior', skill: 'none',
    description: '+15% max HP. Damage you take is reduced by 1% for each 10% of max HP you are missing.',
    effects: [
      { type: 'hp_bonus_percent', value: 0.15, description: '+15% max HP' },
      { type: 'low_hp_damage_reduction', perTenPercent: 0.01, description: '-1% damage taken per 10% HP missing' },
    ],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'damage_sponge', hpBonusPercent: 0.15, lowHpDamageReduction: 0.01 } },

  { cardId: 'resilient_body', name: 'Resilient Body', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician',
    tags: ['defense', 'warrior'],
    archetype: 'warrior', skill: 'none',
    description: 'Regenerate 2% of max HP per turn. Regeneration is doubled when below 30% HP.',
    effects: [
      { type: 'hp_regen_percent', value: 0.02, description: '+2% max HP regen per turn' },
      { type: 'low_hp_regen_multiplier', threshold: 0.30, multiplier: 2.0, description: '2x regen below 30% HP' },
    ],
    icon: 'skills/Skill_Defence.PNG',
    combatPassive: { type: 'resilient_body', hpRegenPercent: 0.02, lowHpThreshold: 0.30, lowHpRegenMult: 2.0 } },

  // ========================================================================
  // SCOUT ARCHETYPE EXPANSION (Mobility / Escape / Stealth)
  // ========================================================================

  { cardId: 'shadow_dash', name: 'Shadow Dash', type: 'active_ability', rarity: 'uncommon', resourceType: 'focus', archetype: 'rogue',
    tags: ['stealth', 'rogue', 'movement'],
    archetype: 'rogue', skill: 'none',
    description: 'Dash 4 tiles in any direction, passing through enemies. Become stealthed for 1 turn after the dash.',
    effects: [{ type: 'movement', distance: 4, passThroughEnemies: true, description: 'Dash 4 tiles through enemies + 1 turn stealth' }],
    icon: 'skills/Enchantment/',
    combatType: 'movement',
    range: 4, manaCost: 6, aoeRadius: 0, cooldown: 3,
    dashDistance: 4, passThroughEnemies: true,
    onUseStatus: { name: 'stealthed', duration: 1, type: 'buff' },
    targetType: 'any' },

  { cardId: 'escape_artist', name: 'Escape Artist', type: 'passive_perk', rarity: 'rare', archetype: 'rogue',
    tags: ['stealth', 'rogue', 'defense'],
    archetype: 'rogue', skill: 'none',
    description: 'Automatically break free from roots, grabs, and grapples after 1 turn instead of full duration. +20% dodge while fleeing.',
    effects: [
      { type: 'cc_break_early', ccTypes: ['root', 'grapple', 'grab'], maxDuration: 1, description: 'Break roots/grabs/grapples after 1 turn' },
      { type: 'dodge_bonus_fleeing', value: 0.20, description: '+20% dodge while fleeing' },
    ],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'escape_artist', ccBreakMaxDuration: 1, ccBreakTypes: ['root', 'grapple', 'grab'], dodgeBonusFleeing: 0.20 } },


  // ── Vision Cards (unique only — thermal_goggles, tremor_boots, night_eye_elixir, all_seeing_eye, hunters_visor defined at line ~1027) ──
  { cardId: 'echolocation_charm', name: 'Echolocation Charm', type: 'passive_perk', rarity: 'rare', archetype: 'rogue', skill: 'none',
    description: 'A charm pulsing with sonic energy. Emit sonar waves that reveal everything — living, dead, and hidden.',
    effects: [{ type: 'grants_vision', value: 'echolocation' }],
    tags: ['vision', 'equipment'],
    icon: 'skills/Enchantment/' },

  { cardId: 'sonar_pulse', name: 'Sonar Pulse', type: 'active_ability', rarity: 'rare', resourceType: 'focus', archetype: 'rogue',
    description: 'Emit a powerful sonar blast. Reveals all hidden entities in a large radius and briefly stuns detected invisible enemies.',
    effects: [{ type: 'reveal_all', value: 8 }, { type: 'stun_invisible', value: 1 }],
    tags: ['vision', 'active', 'sonic'],
    icon: 'skills/Enchantment/',
    combatType: 'buff', targetType: 'self', manaCost: 15, cooldown: 20, damageType: 'sonic' },

  { cardId: 'echolocation_passive', name: 'Echolocation Mastery', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'rogue',
    description: 'Your senses are permanently attuned to sound waves. Automatically detect all entities within 3 tiles, even through walls.',
    effects: [{ type: 'grants_vision', value: 'echolocation' }, { type: 'passive_tremor_range', value: 3 }],
    tags: ['vision', 'passive'],
    icon: 'skills/Enchantment/',
    combatPassive: { type: 'echolocation_mastery', tremorRange: 3, grantsVision: 'echolocation' } },

  // ── Magic Sight Cards ──
  { cardId: 'arcane_monocle', name: 'Arcane Monocle', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', skill: 'enchanting',
    description: 'An enchanted lens that reveals magical auras, curses, and hidden enchantments.',
    effects: [{ type: 'grants_vision', value: 'magic_sense' }],
    tags: ['vision', 'magic', 'equipment'],
    icon: 'skills/Enchantment/' },

  { cardId: 'true_seeing_eye', name: 'True Seeing Eye', type: 'passive_perk', rarity: 'legendary', archetype: 'tactician', skill: 'enchanting',
    description: 'The Third Eye of Verithas. Pierces all illusions and reveals the true nature of all things.',
    effects: [{ type: 'grants_vision', value: 'true_seeing' }],
    tags: ['vision', 'magic', 'artifact'],
    icon: 'skills/Enchantment/' },

  { cardId: 'detect_magic', name: 'Detect Magic', type: 'active_ability', rarity: 'uncommon', resourceType: 'mana', archetype: 'tactician', skill: 'enchanting',
    description: 'Channel arcane energy to sense nearby magical objects and auras for a short duration.',
    effects: [{ type: 'grants_vision', value: 'magic_sense' }, { type: 'buff_duration', value: 5 }],
    tags: ['vision', 'magic', 'active'],
    icon: 'skills/Enchantment/',
    combatType: 'buff', targetType: 'self', manaCost: 10, cooldown: 15 },

  { cardId: 'dispel_sight', name: 'Dispel Sight', type: 'active_ability', rarity: 'rare', resourceType: 'mana', archetype: 'mystic', skill: 'enchanting',
    description: 'A focused magical perception that not only reveals but disrupts magical concealment.',
    effects: [{ type: 'reveal_magic', value: true }, { type: 'remove_buffs', value: 2 }],
    tags: ['vision', 'magic', 'active'],
    icon: 'skills/Enchantment/',
    combatType: 'debuff_aoe', targetType: 'all_enemies', manaCost: 20, cooldown: 25 },

  // ── Resource Attunement Cards (rare drops, expand secondary resource pools) ──
  { cardId: 'mana_attunement', name: 'Mana Attunement', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['magic'],
    description: 'Attune to arcane energies. +25% mana pool, +1 mana regen, -10% mana ability costs',
    effects: [{ type: 'resource_attunement', resource: 'mana', value: 0.25 }, { type: 'resource_regen_bonus', resource: 'mana', value: 1 }, { type: 'resource_cost_reduction', resource: 'mana', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'stamina_attunement', name: 'Stamina Attunement', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    description: 'Condition your body for greater endurance. +25% stamina pool, +1 stamina regen, -10% stamina ability costs',
    effects: [{ type: 'resource_attunement', resource: 'stamina', value: 0.25 }, { type: 'resource_regen_bonus', resource: 'stamina', value: 1 }, { type: 'resource_cost_reduction', resource: 'stamina', value: 0.10 }], icon: 'skills/Enchantment/' },
  { cardId: 'bloodlust_attunement', name: 'Bloodlust Attunement', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['stealth'],
    description: 'Embrace predatory instincts. +25% bloodlust pool, +1 bloodlust on hit, halved decay',
    effects: [{ type: 'resource_attunement', resource: 'bloodlust', value: 0.25 }, { type: 'resource_on_hit_bonus', resource: 'bloodlust', value: 1 }, { type: 'resource_decay_reduction', resource: 'bloodlust', value: 0.50 }], icon: 'skills/Enchantment/' },
  { cardId: 'focus_attunement', name: 'Focus Attunement', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    description: 'Sharpen your concentration. +25% focus pool, +3 focus per consecutive action, retain 15% more on switch',
    effects: [{ type: 'resource_attunement', resource: 'focus', value: 0.25 }, { type: 'resource_consecutive_bonus', resource: 'focus', value: 3 }, { type: 'resource_retain_bonus', resource: 'focus', value: 0.15 }], icon: 'skills/Enchantment/' },

  // ── Resource Pool Enhancement Passives ──
  // Mana pool passives
  { cardId: 'arcane_reservoir', name: 'Arcane Reservoir', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', tags: ['magic'],
    description: '+10 max mana and +1 mana regen per turn',
    effects: [{ type: 'resource_max_bonus', resource: 'mana', value: 10 }, { type: 'resource_regen_bonus', resource: 'mana', value: 1 }],
    icon: 'skills/Enchantment/' },
  { cardId: 'deep_mana_well', name: 'Deep Mana Well', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['magic'],
    description: '+20 max mana. Start combat with full mana',
    effects: [{ type: 'resource_max_bonus', resource: 'mana', value: 20 }, { type: 'resource_start_full', resource: 'mana', value: true }],
    icon: 'skills/Enchantment/' },

  // Stamina pool passives
  { cardId: 'iron_lungs', name: 'Iron Lungs', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician',
    description: '+10 max stamina and +1 stamina regen per turn',
    effects: [{ type: 'resource_max_bonus', resource: 'stamina', value: 10 }, { type: 'resource_regen_bonus', resource: 'stamina', value: 1 }],
    icon: 'skills/Blacksmith/' },
  { cardId: 'tireless', name: 'Tireless', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    description: '+20 max stamina. Stamina regen doubled when below 25%',
    effects: [{ type: 'resource_max_bonus', resource: 'stamina', value: 20 }, { type: 'resource_low_regen_mult', resource: 'stamina', threshold: 0.25, value: 2.0 }],
    icon: 'skills/Blacksmith/' },

  // Bloodlust pool passives
  { cardId: 'blood_frenzy', name: 'Blood Frenzy', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician', tags: ['stealth'],
    description: '+10 max bloodlust and +5 bloodlust on kill (stacks with base)',
    effects: [{ type: 'resource_max_bonus', resource: 'bloodlust', value: 10 }, { type: 'resource_on_kill_bonus', resource: 'bloodlust', value: 5 }],
    icon: 'skills/Enchantment/' },
  { cardId: 'predatory_surge', name: 'Predatory Surge', type: 'passive_perk', rarity: 'rare', archetype: 'tactician', tags: ['stealth'],
    description: '+20 max bloodlust. Bloodlust decay reduced by 50%',
    effects: [{ type: 'resource_max_bonus', resource: 'bloodlust', value: 20 }, { type: 'resource_decay_reduction', resource: 'bloodlust', value: 0.50 }],
    icon: 'skills/Enchantment/' },

  // Focus pool passives
  { cardId: 'deep_concentration', name: 'Deep Concentration', type: 'passive_perk', rarity: 'uncommon', archetype: 'tactician',
    description: '+10 max focus and +3 focus per consecutive action (stacks with base)',
    effects: [{ type: 'resource_max_bonus', resource: 'focus', value: 10 }, { type: 'resource_consecutive_bonus', resource: 'focus', value: 3 }],
    icon: 'skills/Enchantment/' },
  { cardId: 'unwavering_mind', name: 'Unwavering Mind', type: 'passive_perk', rarity: 'rare', archetype: 'tactician',
    description: '+20 max focus. Focus does not reset when switching targets (retains 50%)',
    effects: [{ type: 'resource_max_bonus', resource: 'focus', value: 20 }, { type: 'resource_retain_on_switch', resource: 'focus', value: 0.50 }],
    icon: 'skills/Enchantment/' },

  // Cross-resource passive
  { cardId: 'resource_harmony', name: 'Resource Harmony', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'tactician',
    description: '+10 max to ALL resource pools. When any resource is depleted, gain +2 regen to lowest resource for 3 turns',
    effects: [{ type: 'resource_max_bonus_all', value: 10 }, { type: 'resource_harmony_regen', value: 2, duration: 3 }],
    icon: 'skills/Enchantment/' },

  // ═══════════════════════════════════════════════════════════════════════════
  // ARCHETYPE GAP FILL — Common through Relic for all 12 archetypes
  // ═══════════════════════════════════════════════════════════════════════════

  // ──────────────────────────────────────────────────────────────────────────
  // SUPPORT — was missing all commons
  // ──────────────────────────────────────────────────────────────────────────
  { cardId: 'bandage_wrap', name: 'Bandage Wrap', type: 'passive_perk', rarity: 'common', archetype: 'mystic', tags: ['magic'],
    description: '+5% healing done to allies',
    effects: [{ type: 'heal_power_bonus', value: 0.05 }], icon: 'skills/Skill_Heal.PNG' },
  { cardId: 'encouraging_word', name: 'Encouraging Word', type: 'passive_perk', rarity: 'common', archetype: 'mystic',
    description: '+3% buff duration you apply to allies',
    effects: [{ type: 'buff_duration_bonus', value: 0.03 }], icon: 'skills/Skill_Heal.PNG' },
  { cardId: 'herbal_poultice', name: 'Herbal Poultice', type: 'passive_perk', rarity: 'common', archetype: 'mystic', tags: ['magic'],
    description: '+2 HP regen to nearby allies in combat',
    effects: [{ type: 'aura_hp_regen', value: 2, range: 2 }], icon: 'skills/Skill_Heal.PNG' },
  // support godly
  { cardId: 'avatar_of_mercy', name: 'Avatar of Mercy', type: 'passive_perk', rarity: 'godly', archetype: 'mystic', archetypeSecondary: ['warrior'], tags: ['magic'],
    description: 'Healing spells are 40% stronger. When an ally would die, automatically heal them for 25% max HP once per floor',
    effects: [{ type: 'heal_power_bonus', value: 0.40 }, { type: 'death_save_ally', hpPercent: 0.25, cooldownFloor: 1 }], icon: 'skills/Skill_Heal.PNG' },
  // support relic
  { cardId: 'tear_of_the_goddess', name: 'Tear of the Goddess', type: 'passive_perk', rarity: 'relic', archetype: 'mystic', tags: ['magic'],
    description: 'All healing is doubled. Overhealing becomes a shield (up to 30% max HP). Revive allies at 75% HP instead of 50%',
    effects: [{ type: 'heal_power_bonus', value: 1.00 }, { type: 'overheal_shield', maxPercent: 0.30 }, { type: 'revive_hp_bonus', value: 0.75 }], icon: 'skills/Skill_Heal.PNG' },

  // ──────────────────────────────────────────────────────────────────────────
  // TANK — was missing commons, mythic_rare, godly, relic
  // ──────────────────────────────────────────────────────────────────────────
  { cardId: 'iron_skin', name: 'Iron Skin', type: 'passive_perk', rarity: 'common', archetype: 'warrior',
    description: '+3 armor',
    effects: [{ type: 'armor_bonus', value: 3 }], icon: 'skills/Blacksmith/' },
  { cardId: 'sturdy_constitution', name: 'Sturdy Constitution', type: 'passive_perk', rarity: 'common', archetype: 'warrior',
    description: '+15 max HP',
    effects: [{ type: 'hp_bonus', value: 15 }], icon: 'skills/Blacksmith/' },
  { cardId: 'shield_bearers_stance', name: "Shield Bearer's Stance", type: 'passive_perk', rarity: 'common', archetype: 'warrior',
    description: '+5% block chance',
    effects: [{ type: 'block_chance', value: 0.05 }], icon: 'skills/Blacksmith/' },
  { cardId: 'defenders_resolve', name: "Defender's Resolve", type: 'passive_perk', rarity: 'common', archetype: 'warrior',
    description: '+3% damage reduction',
    effects: [{ type: 'damage_reduction', value: 0.03 }], icon: 'skills/Blacksmith/' },
  // tank mythic_rare
  { cardId: 'fortress_incarnate', name: 'Fortress Incarnate', type: 'passive_perk', rarity: 'mythic_rare', archetype: 'warrior', archetypeSecondary: ['warrior'], tags: ['combat'],
    description: '+50 armor. +30% max HP. Taunt all enemies within 3 tiles at combat start. Block chance +15%',
    effects: [{ type: 'armor_bonus', value: 50 }, { type: 'hp_bonus_percent', value: 0.30 }, { type: 'auto_taunt', range: 3 }, { type: 'block_chance', value: 0.15 }], icon: 'skills/Blacksmith/' },
  // tank godly
  { cardId: 'wall_of_the_ancients', name: 'Wall of the Ancients', type: 'passive_perk', rarity: 'godly', archetype: 'warrior', tags: ['combat'],
    description: 'Absorb 25% of all damage dealt to allies within 3 tiles. +60 armor. Immune to stun and knockback',
    effects: [{ type: 'redirect_ally_damage', percent: 0.25, range: 3 }, { type: 'armor_bonus', value: 60 }, { type: 'immunity', conditions: ['stun', 'knockback'] }], icon: 'skills/Blacksmith/' },
  // tank relic
  { cardId: 'aegis_of_eternity', name: 'Aegis of Eternity', type: 'passive_perk', rarity: 'relic', archetype: 'warrior', tags: ['combat'],
    description: 'Cannot be reduced below 1 HP more than once per 30s. Reflect 20% of blocked damage. +100 armor. All allies in range gain +10 armor',
    effects: [{ type: 'undying', cooldown: 30 }, { type: 'block_reflect', value: 0.20 }, { type: 'armor_bonus', value: 100 }, { type: 'aura_armor', value: 10, range: 3 }], icon: 'skills/Blacksmith/' },

  // ──────────────────────────────────────────────────────────────────────────
  // MELEE_DPS — was missing commons, godly, relic
  // ──────────────────────────────────────────────────────────────────────────
  { cardId: 'sharp_edge', name: 'Sharp Edge', type: 'passive_perk', rarity: 'common', archetype: 'warrior', tags: ['combat'],
    description: '+3% melee damage',
    effects: [{ type: 'melee_damage_bonus', value: 0.03 }], icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'quick_reflexes', name: 'Quick Reflexes', type: 'passive_perk', rarity: 'common', archetype: 'warrior', tags: ['combat'],
    description: '+2% attack speed',
    effects: [{ type: 'attack_speed_bonus', value: 0.02 }], icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'warriors_grit', name: "Warrior's Grit", type: 'passive_perk', rarity: 'common', archetype: 'warrior', tags: ['combat'],
    description: '+2% crit chance',
    effects: [{ type: 'crit_chance_bonus', value: 0.02 }], icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'combat_training', name: 'Combat Training', type: 'passive_perk', rarity: 'common', archetype: 'warrior',
    description: '+10% Melee XP',
    effects: [{ type: 'xp_bonus_skill', skill: 'melee', value: 0.10 }], icon: 'skills/Skill_SwordAttack.PNG' },
  // melee_dps godly
  { cardId: 'warbringer', name: 'Warbringer', type: 'passive_perk', rarity: 'godly', archetype: 'warrior', archetypeSecondary: ['warrior'], tags: ['combat'],
    description: '+35% melee damage. +20% attack speed. Kills extend all buffs by 1 turn. +15% lifesteal on critical hits',
    effects: [{ type: 'melee_damage_bonus', value: 0.35 }, { type: 'attack_speed_bonus', value: 0.20 }, { type: 'kill_extends_buffs', value: 1 }, { type: 'crit_lifesteal', value: 0.15 }], icon: 'skills/Skill_SwordAttack.PNG' },
  // melee_dps relic
  { cardId: 'blade_of_the_conqueror', name: 'Blade of the Conqueror', type: 'passive_perk', rarity: 'relic', archetype: 'warrior', tags: ['combat'],
    description: '+50% melee damage. +25% crit chance. Critical hits deal triple damage instead of double. +10% of damage dealt heals you',
    effects: [{ type: 'melee_damage_bonus', value: 0.50 }, { type: 'crit_chance_bonus', value: 0.25 }, { type: 'crit_multiplier_bonus', value: 1.0 }, { type: 'lifesteal', value: 0.10 }], icon: 'skills/Skill_SwordAttack.PNG' },

  // ──────────────────────────────────────────────────────────────────────────
  // GLASS_CANNON — was missing mythic+ (only had meteor), missing godly/relic
  // ──────────────────────────────────────────────────────────────────────────
  // glass_cannon additional commons (had only 1)
  { cardId: 'spark_of_power', name: 'Spark of Power', type: 'passive_perk', rarity: 'common', archetype: 'mystic', tags: ['magic'],
    description: '+3% spell damage',
    effects: [{ type: 'spell_damage_bonus', value: 0.03 }], icon: 'skills/Enchantment/' },
  { cardId: 'volatile_mana', name: 'Volatile Mana', type: 'passive_perk', rarity: 'common', archetype: 'mystic', tags: ['magic'],
    rarityScalable: true,
    description: '+5 max mana',
    effects: [{ type: 'resource_max_bonus', resource: 'mana', value: 5 }], icon: 'skills/Enchantment/' },
  // glass_cannon godly
  { cardId: 'archmages_ascension', name: "Archmage's Ascension", type: 'passive_perk', rarity: 'godly', archetype: 'mystic', tags: ['magic'],
    description: '+45% spell damage. Spells have 15% chance to cost no mana. +20% crit chance on spells. Spell kills restore 10% max mana',
    effects: [{ type: 'spell_damage_bonus', value: 0.45 }, { type: 'free_cast_chance', value: 0.15 }, { type: 'spell_crit_bonus', value: 0.20 }, { type: 'kill_mana_restore', value: 0.10 }], icon: 'skills/Enchantment/' },
  // glass_cannon relic
  { cardId: 'staff_of_annihilation', name: 'Staff of Annihilation', type: 'passive_perk', rarity: 'relic', archetype: 'mystic', tags: ['magic', 'combat'],
    description: '+60% spell damage. All spells pierce magic resistance by 50%. AoE spells hit +1 radius. 10% chance spells cast twice',
    effects: [{ type: 'spell_damage_bonus', value: 0.60 }, { type: 'magic_pen', value: 0.50 }, { type: 'aoe_radius_bonus', value: 1 }, { type: 'spell_echo_chance', value: 0.10 }], icon: 'skills/Enchantment/' },

  // ──────────────────────────────────────────────────────────────────────────
  // CC_DOT — was missing commons, had only 1 legendary, nothing above
  // ──────────────────────────────────────────────────────────────────────────
  { cardId: 'stinging_touch', name: 'Stinging Touch', type: 'passive_perk', rarity: 'common', archetype: 'tactician', tags: ['magic'],
    description: '+3% DoT damage',
    effects: [{ type: 'dot_damage_bonus', value: 0.03 }], icon: 'skills/Enchantment/' },
  { cardId: 'numbing_agent', name: 'Numbing Agent', type: 'passive_perk', rarity: 'common', archetype: 'tactician', tags: ['magic'],
    description: '+5% slow potency on crowd control effects',
    effects: [{ type: 'cc_potency_bonus', value: 0.05 }], icon: 'skills/Enchantment/' },
  { cardId: 'lingering_pain', name: 'Lingering Pain', type: 'passive_perk', rarity: 'common', archetype: 'tactician',
    description: 'DoT effects last 1 extra tick',
    effects: [{ type: 'dot_duration_bonus', value: 1 }], icon: 'skills/Enchantment/' },
  { cardId: 'weakening_strikes', name: 'Weakening Strikes', type: 'passive_perk', rarity: 'common', archetype: 'tactician', tags: ['combat'],
    description: 'Attacks have 5% chance to apply a minor slow',
    effects: [{ type: 'on_hit_slow_chance', value: 0.05, duration: 2 }], icon: 'skills/Enchantment/' },
  // cc_dot legendary (supplement the lone mass_dispel)
  { cardId: 'plague_bearer', name: 'Plague Bearer', type: 'passive_perk', rarity: 'legendary', archetype: 'tactician', tags: ['magic', 'combat'],
    description: 'DoT effects spread to nearby enemies on tick (25% damage). +30% DoT damage. Enemies that die to DoT explode for 15% max HP AoE',
    effects: [{ type: 'dot_spread', spreadDamage: 0.25, range: 2 }, { type: 'dot_damage_bonus', value: 0.30 }, { type: 'dot_kill_explode', value: 0.15 }], icon: 'skills/Enchantment/' },
  { cardId: 'temporal_chains', name: 'Temporal Chains', type: 'active_ability', rarity: 'legendary', resourceType: 'mana', archetype: 'tactician', tags: ['magic', 'combat'],
    description: 'Bind enemies in temporal energy. All enemies in AoE are slowed 50% and take 15 arcane damage per turn for 4 turns',
    effects: [{ type: 'damage', element: 'arcane', base: 15, dot: true, duration: 4 }, { type: 'slow', value: 0.50, duration: 4 }],
    combatType: 'damage', targetType: 'all_enemies', manaCost: 30, cooldown: 6, aoeRadius: 2, scalingStat: 'acumen', scalingFactor: 0.6, icon: 'skills/Enchantment/' },
  // cc_dot mythic_rare
  { cardId: 'entropy_weaver', name: 'Entropy Weaver', type: 'passive_perk', rarity: 'mythic_rare', archetype: 'tactician', archetypeSecondary: ['mystic'], tags: ['magic', 'combat'],
    description: '+40% DoT damage. CC effects last 50% longer. Enemies under 3+ debuffs take 20% more damage from all sources',
    effects: [{ type: 'dot_damage_bonus', value: 0.40 }, { type: 'cc_duration_bonus', value: 0.50 }, { type: 'debuff_vulnerability', threshold: 3, bonus: 0.20 }], icon: 'skills/Enchantment/' },
  // cc_dot godly
  { cardId: 'hand_of_decay', name: 'Hand of Decay', type: 'passive_perk', rarity: 'godly', archetype: 'tactician', tags: ['magic', 'combat'],
    description: 'All damage you deal applies a stacking decay (2% max HP/turn, stacks 10x). CC-ed enemies cannot heal. +50% DoT damage',
    effects: [{ type: 'on_hit_decay', damagePercent: 0.02, maxStacks: 10 }, { type: 'cc_anti_heal', value: true }, { type: 'dot_damage_bonus', value: 0.50 }], icon: 'skills/Enchantment/' },
  // cc_dot relic
  { cardId: 'pandoras_blight', name: "Pandora's Blight", type: 'passive_perk', rarity: 'relic', archetype: 'tactician', tags: ['magic', 'combat'],
    description: 'All DoTs deal 75% more damage. Enemies that die to your effects cannot be revived. On kill, all your DoTs refresh duration. Immune to your own DoT effects',
    effects: [{ type: 'dot_damage_bonus', value: 0.75 }, { type: 'kill_prevents_revive', value: true }, { type: 'kill_refreshes_dots', value: true }, { type: 'self_dot_immunity', value: true }], icon: 'skills/Enchantment/' },

  // ──────────────────────────────────────────────────────────────────────────
  // PURE_DEFENSE — was missing commons (had 2), mythic_rare, godly, relic
  // ──────────────────────────────────────────────────────────────────────────
  // pure_defense additional commons
  { cardId: 'resilient_spirit', name: 'Resilient Spirit', type: 'passive_perk', rarity: 'common', archetype: 'warrior', tags: ['magic'],
    description: '+3% magic resistance',
    effects: [{ type: 'magic_resist_bonus', value: 0.03 }], icon: 'skills/Enchantment/' },
  // pure_defense mythic_rare
  { cardId: 'unbreakable', name: 'Unbreakable', type: 'passive_perk', rarity: 'mythic_rare', archetype: 'warrior', archetypeSecondary: ['warrior'], tags: ['combat'],
    description: 'Damage reduction capped at 75% instead of 50%. +40 armor. Cannot be one-shot (damage capped at 80% current HP)',
    effects: [{ type: 'damage_reduction_cap', value: 0.75 }, { type: 'armor_bonus', value: 40 }, { type: 'one_shot_protection', maxPercent: 0.80 }], icon: 'skills/Blacksmith/' },
  // pure_defense godly
  { cardId: 'divine_bulwark', name: 'Divine Bulwark', type: 'passive_perk', rarity: 'godly', archetype: 'warrior', archetypeSecondary: ['mystic'], tags: ['combat'],
    description: '30% of damage taken is converted to healing over 5s. +50 armor. Allies within 2 tiles gain 15% of your armor. Immune to armor-shred effects',
    effects: [{ type: 'damage_to_heal', value: 0.30, duration: 5 }, { type: 'armor_bonus', value: 50 }, { type: 'aura_armor_percent', value: 0.15, range: 2 }, { type: 'immunity', conditions: ['armor_shred'] }], icon: 'skills/Blacksmith/' },
  // pure_defense relic
  { cardId: 'mantle_of_the_mountain', name: 'Mantle of the Mountain', type: 'passive_perk', rarity: 'relic', archetype: 'warrior', tags: ['combat'],
    description: '+100 armor. +50% max HP. Every 10th hit against you is fully absorbed. When shielded, reflect 30% of damage back to attacker',
    effects: [{ type: 'armor_bonus', value: 100 }, { type: 'hp_bonus_percent', value: 0.50 }, { type: 'nth_hit_absorb', n: 10 }, { type: 'shield_reflect', value: 0.30 }], icon: 'skills/Blacksmith/' },

  // ──────────────────────────────────────────────────────────────────────────
  // ASSASSIN — was missing commons, mythic_rare, godly, relic
  // ──────────────────────────────────────────────────────────────────────────
  { cardId: 'subtle_blade', name: 'Subtle Blade', type: 'passive_perk', rarity: 'common', archetype: 'rogue', tags: ['stealth', 'combat'],
    description: '+3% stealth attack damage',
    effects: [{ type: 'stealth_attack_bonus', value: 0.03 }], icon: 'skills/Enchantment/' },
  { cardId: 'shadow_step_training', name: 'Shadow Step Training', type: 'passive_perk', rarity: 'common', archetype: 'rogue', tags: ['stealth'],
    description: '+5% stealth movement speed',
    effects: [{ type: 'stealth_speed_bonus', value: 0.05 }], icon: 'skills/Enchantment/' },
  { cardId: 'poisoned_tip', name: 'Poisoned Tip', type: 'passive_perk', rarity: 'common', archetype: 'rogue', tags: ['stealth', 'combat'],
    description: 'Attacks have 5% chance to apply minor poison (3 dmg/tick, 3 ticks)',
    effects: [{ type: 'on_hit_poison_chance', value: 0.05, damage: 3, ticks: 3 }], icon: 'skills/Enchantment/' },
  { cardId: 'cutpurse', name: 'Cutpurse', type: 'passive_perk', rarity: 'common', archetype: 'rogue', tags: ['stealth'],
    description: '+10% Thievery XP',
    effects: [{ type: 'xp_bonus_skill', skill: 'thievery', value: 0.10 }], icon: 'skills/Enchantment/' },
  // assassin legendary (supplement existing 2)
  { cardId: 'death_mark', name: 'Death Mark', type: 'active_ability', rarity: 'legendary', resourceType: 'focus', archetype: 'rogue', tags: ['stealth', 'combat'],
    description: 'Mark a target for death. After 3 turns, if below 30% HP, instant kill. Otherwise deal 80 true damage. Only usable from stealth',
    effects: [{ type: 'mark_for_death', executeThreshold: 0.30, trueDamage: 80, delay: 3 }],
    combatType: 'damage', targetType: 'single_enemy', focusCost: 25, cooldown: 8, requiresStealth: true, icon: 'skills/Enchantment/' },
  // assassin mythic_rare
  { cardId: 'phantom_assassin', name: 'Phantom Assassin', type: 'passive_perk', rarity: 'mythic_rare', archetype: 'rogue', tags: ['stealth', 'combat'],
    description: 'Stealth attacks deal 60% more damage. After killing from stealth, automatically re-enter stealth. +25% crit chance from stealth',
    effects: [{ type: 'stealth_attack_bonus', value: 0.60 }, { type: 'kill_restealth', value: true }, { type: 'stealth_crit_bonus', value: 0.25 }], icon: 'skills/Enchantment/' },
  // assassin godly
  { cardId: 'veil_of_shadows', name: 'Veil of Shadows', type: 'passive_perk', rarity: 'godly', archetype: 'rogue', tags: ['stealth', 'combat'],
    description: 'Stealth attacks deal double damage. 20% chance to dodge any attack. Kills from stealth reduce all cooldowns by 2 turns. Cannot be revealed by magic',
    effects: [{ type: 'stealth_attack_bonus', value: 1.00 }, { type: 'dodge_chance_bonus', value: 0.20 }, { type: 'stealth_kill_cdr', value: 2 }, { type: 'immunity', conditions: ['reveal'] }], icon: 'skills/Enchantment/' },
  // assassin relic
  { cardId: 'deaths_whisper', name: "Death's Whisper", type: 'passive_perk', rarity: 'relic', archetype: 'rogue', tags: ['stealth', 'combat'],
    description: 'First attack from stealth is always a critical hit dealing 3x damage. Execute enemies below 25% HP instantly. Permanent 15% dodge. Poison damage tripled',
    effects: [{ type: 'stealth_guaranteed_crit', multiplier: 3.0 }, { type: 'execute_threshold', value: 0.25 }, { type: 'dodge_chance_bonus', value: 0.15 }, { type: 'poison_damage_multiplier', value: 3.0 }], icon: 'skills/Enchantment/' },

  // ──────────────────────────────────────────────────────────────────────────
  // SCOUT — was missing legendary through relic entirely
  // ──────────────────────────────────────────────────────────────────────────
  // scout additional commons
  { cardId: 'keen_eyes', name: 'Keen Eyes', type: 'passive_perk', rarity: 'common', archetype: 'rogue',
    description: '+5% trap detection range',
    effects: [{ type: 'trap_detection_bonus', value: 0.05 }], icon: 'skills/Enchantment/' },
  { cardId: 'light_step', name: 'Light Step', type: 'passive_perk', rarity: 'common', archetype: 'rogue', tags: ['stealth'],
    description: '+3% dodge chance',
    effects: [{ type: 'dodge_chance_bonus', value: 0.03 }], icon: 'skills/Enchantment/' },
  // scout legendary
  { cardId: 'eagle_eye', name: 'Eagle Eye', type: 'passive_perk', rarity: 'legendary', archetype: 'rogue', archetypeSecondary: ['warrior'], tags: ['combat'],
    description: '+30% ranged damage. +40% vision range. First attack on unaware enemy deals double damage. Reveal hidden enemies within 5 tiles',
    effects: [{ type: 'ranged_damage_bonus', value: 0.30 }, { type: 'vision_range_bonus', value: 0.40 }, { type: 'ambush_damage_bonus', value: 1.00 }, { type: 'reveal_hidden', range: 5 }], icon: 'skills/Enchantment/' },
  { cardId: 'pathfinder_supreme', name: 'Pathfinder Supreme', type: 'passive_perk', rarity: 'legendary', archetype: 'rogue', tags: ['stealth'],
    description: '+25% movement speed. Immune to all terrain penalties. Reveal all traps on the floor. +20% loot from dungeon chests',
    effects: [{ type: 'speed_bonus', value: 0.25 }, { type: 'terrain_immunity', value: true }, { type: 'reveal_all_traps', value: true }, { type: 'chest_loot_bonus', value: 0.20 }], icon: 'skills/Enchantment/' },
  // scout mythic_rare
  { cardId: 'horizon_walker', name: 'Horizon Walker', type: 'passive_perk', rarity: 'mythic_rare', archetype: 'rogue', archetypeSecondary: ['rogue'], tags: ['stealth', 'combat'],
    description: '+35% movement speed. +30% ranged damage. Track enemies through walls (tremor vision). After not attacking for 2 turns, next attack deals 80% bonus damage',
    effects: [{ type: 'speed_bonus', value: 0.35 }, { type: 'ranged_damage_bonus', value: 0.30 }, { type: 'grants_vision', value: 'tremor' }, { type: 'patience_damage_bonus', chargeTime: 2, bonus: 0.80 }], icon: 'skills/Enchantment/' },
  // scout godly
  { cardId: 'omniscient_scout', name: 'Omniscient Scout', type: 'passive_perk', rarity: 'godly', archetype: 'rogue', tags: ['stealth', 'combat'],
    description: 'Permanent map awareness (all enemies visible). +40% ranged damage. +30% dodge. Gain stealth after standing still for 1 turn',
    effects: [{ type: 'full_map_vision', value: true }, { type: 'ranged_damage_bonus', value: 0.40 }, { type: 'dodge_chance_bonus', value: 0.30 }, { type: 'idle_stealth', turns: 1 }], icon: 'skills/Enchantment/' },
  // scout relic
  { cardId: 'eye_of_the_hawk', name: 'Eye of the Hawk', type: 'passive_perk', rarity: 'relic', archetype: 'rogue', tags: ['stealth', 'combat'],
    description: 'See everything on the floor. +50% ranged damage. Arrows pierce through enemies. First hit from outside vision range is an auto-crit for 3x damage',
    effects: [{ type: 'full_map_vision', value: true }, { type: 'ranged_damage_bonus', value: 0.50 }, { type: 'projectile_pierce', value: true }, { type: 'snipe_crit', multiplier: 3.0 }], icon: 'skills/Enchantment/' },

  // ──────────────────────────────────────────────────────────────────────────
  // NIGHT_HUNTER — was missing commons, legendary through relic
  // ──────────────────────────────────────────────────────────────────────────
  { cardId: 'dark_adapted', name: 'Dark Adapted', type: 'passive_perk', rarity: 'common', archetype: 'rogue', tags: ['stealth'],
    description: '+5% damage in dark/underground areas',
    effects: [{ type: 'dark_damage_bonus', value: 0.05 }], icon: 'skills/Enchantment/' },
  { cardId: 'predator_instinct', name: 'Predator Instinct', type: 'passive_perk', rarity: 'common', archetype: 'rogue', tags: ['stealth', 'combat'],
    description: '+3% damage to enemies below 50% HP',
    effects: [{ type: 'low_hp_damage_bonus', threshold: 0.50, value: 0.03 }], icon: 'skills/Enchantment/' },
  { cardId: 'night_stalker', name: 'Night Stalker', type: 'passive_perk', rarity: 'common', archetype: 'rogue', tags: ['stealth'],
    rarityScalable: true,
    description: '+5% stealth effectiveness',
    effects: [{ type: 'stealth_bonus', value: 0.05 }], icon: 'skills/Enchantment/' },
  // night_hunter legendary
  { cardId: 'nightfall', name: 'Nightfall', type: 'active_ability', rarity: 'legendary', resourceType: 'focus', archetype: 'rogue', archetypeSecondary: ['tactician'], tags: ['stealth', 'combat'],
    description: 'Plunge the area into magical darkness for 4 turns. You gain thermal vision and +40% damage. Enemies are blinded (-50% accuracy)',
    effects: [{ type: 'darkness_zone', duration: 4 }, { type: 'self_buff_in_dark', damage: 0.40, vision: 'thermal' }, { type: 'enemy_blind', accuracy_reduction: 0.50 }],
    combatType: 'debuff_aoe', targetType: 'all_enemies', focusCost: 25, cooldown: 7, icon: 'skills/Enchantment/' },
  { cardId: 'apex_predator', name: 'Apex Predator', type: 'passive_perk', rarity: 'legendary', archetype: 'rogue', archetypeSecondary: ['rogue'], tags: ['stealth', 'combat'],
    description: '+30% damage to enemies below 40% HP. Killing blows restore 10% max HP. Gain thermal vision permanently. +20% crit damage',
    effects: [{ type: 'low_hp_damage_bonus', threshold: 0.40, value: 0.30 }, { type: 'kill_heal', value: 0.10 }, { type: 'grants_vision', value: 'thermal' }, { type: 'crit_damage_bonus', value: 0.20 }], icon: 'skills/Enchantment/' },
  // night_hunter mythic_rare
  { cardId: 'terror_of_the_deep', name: 'Terror of the Deep', type: 'passive_perk', rarity: 'mythic_rare', archetype: 'rogue', archetypeSecondary: ['rogue'], tags: ['stealth', 'combat'],
    description: '+50% damage in darkness/underground. Enemies you damage have 15% miss chance for 2 turns. +30% crit chance against blinded enemies',
    effects: [{ type: 'dark_damage_bonus', value: 0.50 }, { type: 'on_hit_blind', missChance: 0.15, duration: 2 }, { type: 'blind_crit_bonus', value: 0.30 }], icon: 'skills/Enchantment/' },
  // night_hunter godly
  { cardId: 'lord_of_night', name: 'Lord of Night', type: 'passive_perk', rarity: 'godly', archetype: 'rogue', tags: ['stealth', 'combat'],
    description: 'All vision types active permanently. +60% damage in dark areas. Enemies cannot see you until you attack. First strike from darkness stuns for 1 turn',
    effects: [{ type: 'grants_vision', value: 'all' }, { type: 'dark_damage_bonus', value: 0.60 }, { type: 'dark_invisibility', value: true }, { type: 'dark_strike_stun', duration: 1 }], icon: 'skills/Enchantment/' },
  // night_hunter relic
  { cardId: 'crown_of_eternal_night', name: 'Crown of Eternal Night', type: 'passive_perk', rarity: 'relic', archetype: 'rogue', tags: ['stealth', 'combat'],
    description: 'You are always considered in darkness. +80% damage from stealth. Kills generate a darkness zone around the corpse (3 tiles, 3 turns). All vision types. Immune to blind',
    effects: [{ type: 'permanent_darkness', value: true }, { type: 'stealth_attack_bonus', value: 0.80 }, { type: 'kill_darkness_zone', radius: 3, duration: 3 }, { type: 'grants_vision', value: 'all' }, { type: 'immunity', conditions: ['blind'] }], icon: 'skills/Enchantment/' },

  // ──────────────────────────────────────────────────────────────────────────
  // GRAPPLER — was missing commons, legendary through relic
  // ──────────────────────────────────────────────────────────────────────────
  { cardId: 'vice_grip', name: 'Vice Grip', type: 'passive_perk', rarity: 'common', archetype: 'warrior', tags: ['combat'],
    description: '+3% grapple damage',
    effects: [{ type: 'grapple_damage_bonus', value: 0.03 }], icon: 'skills/Blacksmith/' },
  { cardId: 'wrestlers_stance', name: "Wrestler's Stance", type: 'passive_perk', rarity: 'common', archetype: 'warrior', tags: ['combat'], rarityScalable: true,
    description: '+5% knockback resistance',
    effects: [{ type: 'knockback_resist', value: 0.05 }], icon: 'skills/Blacksmith/' },
  { cardId: 'chokehold_basics', name: 'Chokehold Basics', type: 'passive_perk', rarity: 'common', archetype: 'warrior', tags: ['combat'],
    description: '+1 turn stun duration on grapple abilities',
    effects: [{ type: 'grapple_stun_bonus', value: 1 }], icon: 'skills/Blacksmith/' },
  // grappler legendary
  { cardId: 'iron_maiden_hold', name: 'Iron Maiden Hold', type: 'passive_perk', rarity: 'legendary', archetype: 'warrior', archetypeSecondary: ['warrior'], tags: ['combat'],
    description: 'While grappling an enemy, take 30% less damage. +25% grapple damage. Grappled enemies cannot cast spells',
    effects: [{ type: 'grapple_damage_reduction', value: 0.30 }, { type: 'grapple_damage_bonus', value: 0.25 }, { type: 'grapple_silence', value: true }], icon: 'skills/Blacksmith/' },
  // grappler mythic_rare
  { cardId: 'titan_wrestler', name: 'Titan Wrestler', type: 'passive_perk', rarity: 'mythic_rare', archetype: 'warrior', archetypeSecondary: ['warrior'], tags: ['combat'],
    description: 'Can grapple enemies up to 3x your size. +50% grapple damage. Throwing grappled enemies damages nearby foes. Immune to grapple/knockback',
    effects: [{ type: 'grapple_size_bonus', multiplier: 3 }, { type: 'grapple_damage_bonus', value: 0.50 }, { type: 'throw_aoe_damage', value: true }, { type: 'immunity', conditions: ['grapple', 'knockback'] }], icon: 'skills/Blacksmith/' },
  // grappler godly
  { cardId: 'master_of_holds', name: 'Master of Holds', type: 'passive_perk', rarity: 'godly', archetype: 'warrior', tags: ['combat'],
    description: 'Grapple deals 75% more damage. Successful grapples steal 10% of enemy max HP. Cannot be grappled. +30 armor while grappling',
    effects: [{ type: 'grapple_damage_bonus', value: 0.75 }, { type: 'grapple_hp_steal', value: 0.10 }, { type: 'immunity', conditions: ['grapple'] }, { type: 'grapple_armor_bonus', value: 30 }], icon: 'skills/Blacksmith/' },
  // grappler relic
  { cardId: 'worldbreaker_grip', name: 'Worldbreaker Grip', type: 'passive_perk', rarity: 'relic', archetype: 'warrior', tags: ['combat'],
    description: 'Grapple deals double damage. Instantly break any enemy shield/barrier on grab. Throwing enemies creates a shockwave (AoE stun 1 turn). +100% grapple range',
    effects: [{ type: 'grapple_damage_bonus', value: 1.00 }, { type: 'grapple_break_shields', value: true }, { type: 'throw_shockwave_stun', duration: 1 }, { type: 'grapple_range_bonus', value: 1.00 }], icon: 'skills/Blacksmith/' },

  // ──────────────────────────────────────────────────────────────────────────
  // AQUATIC — was missing commons, godly, relic
  // ──────────────────────────────────────────────────────────────────────────
  { cardId: 'water_affinity', name: 'Water Affinity', type: 'passive_perk', rarity: 'common', archetype: 'aquatic', tags: ['ritual'],
    description: '+5% water damage',
    effects: [{ type: 'elemental_damage_bonus', element: 'water', value: 0.05 }], icon: 'skills/Enchantment/' },
  { cardId: 'gill_breathing', name: 'Gill Breathing', type: 'passive_perk', rarity: 'common', archetype: 'aquatic', tags: ['ritual'],
    description: '+10% swim speed. Breathe underwater',
    effects: [{ type: 'swim_speed_bonus', value: 0.10 }, { type: 'water_breathing', value: true }], icon: 'skills/Enchantment/' },
  // aquatic legendary (supplement existing)
  { cardId: 'tsunamis_embrace', name: "Tsunami's Embrace", type: 'active_ability', rarity: 'legendary', resourceType: 'mana', archetype: 'aquatic', archetypeSecondary: ['tactician'], tags: ['ritual', 'combat'],
    description: 'Summon a massive wave dealing 55 water damage to all enemies. Knocks back 2 tiles and applies soaked (25% more lightning damage for 3 turns)',
    effects: [{ type: 'damage', element: 'water', base: 55 }, { type: 'knockback', distance: 2 }, { type: 'debuff', status: 'soaked', duration: 3, lightningVuln: 0.25 }],
    combatType: 'damage', targetType: 'all_enemies', manaCost: 30, cooldown: 6, scalingStat: 'acumen', scalingFactor: 0.7, icon: 'skills/Enchantment/' },
  // aquatic godly
  { cardId: 'avatar_of_the_deep', name: 'Avatar of the Deep', type: 'passive_perk', rarity: 'godly', archetype: 'aquatic', archetypeSecondary: ['warrior'], tags: ['ritual', 'combat'],
    description: '+50% water damage. Immune to drowning/water hazards. +40 armor in water. Regenerate 5% HP per turn in water. Water spells cost 30% less mana',
    effects: [{ type: 'elemental_damage_bonus', element: 'water', value: 0.50 }, { type: 'water_immunity', value: true }, { type: 'water_armor_bonus', value: 40 }, { type: 'water_hp_regen', value: 0.05 }, { type: 'water_spell_cost_reduction', value: 0.30 }], icon: 'skills/Enchantment/' },
  // aquatic relic
  { cardId: 'trident_of_the_abyss', name: 'Trident of the Abyss', type: 'passive_perk', rarity: 'relic', archetype: 'aquatic', tags: ['ritual', 'combat'],
    description: '+80% water damage. All attacks apply soaked. Summon water elementals on kill (max 2). Water terrain heals you 10% max HP/turn. Command sea creatures in overworld',
    effects: [{ type: 'elemental_damage_bonus', element: 'water', value: 0.80 }, { type: 'on_hit_soak', value: true }, { type: 'kill_summon', unit: 'water_elemental', max: 2 }, { type: 'water_terrain_heal', value: 0.10 }, { type: 'sea_creature_command', value: true }], icon: 'skills/Enchantment/' },

  // ═══════════════════════════════════════════════════════════════════════════
  // BLOODLUST RESOURCE POOL — New cards for berserker/rage/aggressive DPS
  // Resource earned through kills, spent on burst abilities
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Bloodlust Commons ──
  { cardId: 'taste_of_blood', name: 'Taste of Blood', type: 'passive_perk', rarity: 'common', archetype: 'warrior', tags: ['combat'],
    description: 'Gain 1 bloodlust on melee kill',
    effects: [{ type: 'bloodlust_on_kill', value: 1 }], icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'savage_instinct', name: 'Savage Instinct', type: 'passive_perk', rarity: 'common', archetype: 'warrior', tags: ['combat'],
    description: '+3% damage when bloodlust is above 50%',
    effects: [{ type: 'bloodlust_threshold_damage', threshold: 0.50, value: 0.03 }], icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'feral_swipe', name: 'Feral Swipe', type: 'active_ability', rarity: 'common', resourceType: 'bloodlust', archetype: 'warrior', tags: ['combat'],
    description: 'A vicious swipe that deals 12 physical damage. Low cost, fast cooldown',
    effects: [{ type: 'damage', element: 'physical', base: 12 }],
    combatType: 'damage', targetType: 'single_enemy', bloodlustCost: 5, cooldown: 2, range: 1, icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'bloodthirst', name: 'Bloodthirst', type: 'passive_perk', rarity: 'common', archetype: 'rogue', rarityScalable: true, tags: ['combat', 'stealth'],
    description: 'Drain a portion of attack damage dealt as health. Scales with rarity.',
    effects: [{ type: 'lifesteal', value: 0.02 }], icon: 'skills/Enchantment/',
    combatPassive: { type: 'lifesteal', value: 0.02 } },

  // ── Bloodlust Uncommons ──
  { cardId: 'berserker_frenzy', name: 'Berserker Frenzy', type: 'active_ability', rarity: 'uncommon', resourceType: 'bloodlust', archetype: 'warrior', tags: ['combat'],
    description: 'Enter a frenzy for 3 turns. +20% attack speed, +10% damage, but -10% defense',
    effects: [{ type: 'self_buff', attackSpeed: 0.20, damage: 0.10, defense: -0.10, duration: 3 }],
    combatType: 'buff', targetType: 'self', bloodlustCost: 15, cooldown: 5, icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'rending_strike', name: 'Rending Strike', type: 'active_ability', rarity: 'uncommon', resourceType: 'bloodlust', archetype: 'warrior', tags: ['combat'],
    description: 'Tear into the enemy for 18 physical damage + 6 bleed damage per turn for 3 turns',
    effects: [{ type: 'damage', element: 'physical', base: 18 }, { type: 'bleed', damage: 6, duration: 3 }],
    combatType: 'damage', targetType: 'single_enemy', bloodlustCost: 12, cooldown: 3, range: 1, icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'savage_leap', name: 'Savage Leap', type: 'active_ability', rarity: 'uncommon', resourceType: 'bloodlust', archetype: 'warrior', tags: ['combat'],
    description: 'Leap to an enemy up to 3 tiles away, dealing 15 damage and stunning for 1 turn on landing',
    effects: [{ type: 'damage', element: 'physical', base: 15 }, { type: 'stun', duration: 1 }, { type: 'dash', range: 3 }],
    combatType: 'damage', targetType: 'single_enemy', bloodlustCost: 10, cooldown: 4, range: 3, icon: 'skills/Blacksmith/' },

  // ── Bloodlust Rares ──
  { cardId: 'crimson_frenzy', name: 'Crimson Frenzy', type: 'active_ability', rarity: 'rare', resourceType: 'bloodlust', archetype: 'warrior', tags: ['combat'],
    description: 'Sacrifice 15% HP to gain +30% damage and +20% attack speed for 4 turns. Kills heal 5% max HP',
    effects: [{ type: 'hp_sacrifice', percent: 0.15 }, { type: 'self_buff', damage: 0.30, attackSpeed: 0.20, duration: 4 }, { type: 'kill_heal', value: 0.05 }],
    combatType: 'buff', targetType: 'self', bloodlustCost: 18, cooldown: 6, icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'feeding_frenzy', name: 'Feeding Frenzy', type: 'passive_perk', rarity: 'rare', archetype: 'rogue', tags: ['combat', 'stealth'],
    description: 'Each kill in combat grants +5% damage (stacks up to 5x). At max stacks, gain 10% lifesteal',
    effects: [{ type: 'kill_stack_damage', perStack: 0.05, maxStacks: 5 }, { type: 'max_stack_lifesteal', value: 0.10 }], icon: 'skills/Enchantment/' },

  // ── Bloodlust Ultra Rares ──
  { cardId: 'carnage', name: 'Carnage', type: 'active_ability', rarity: 'ultra_rare', resourceType: 'bloodlust', archetype: 'warrior', archetypeSecondary: ['mystic'], tags: ['combat'],
    description: 'Devastating strike dealing 50 physical damage. If this kills the target, immediately gain a free attack on the nearest enemy',
    effects: [{ type: 'damage', element: 'physical', base: 50 }, { type: 'kill_chain_attack', value: true }],
    combatType: 'damage', targetType: 'single_enemy', bloodlustCost: 25, cooldown: 5, range: 1, icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'bloodbath', name: 'Bloodbath', type: 'passive_perk', rarity: 'ultra_rare', archetype: 'warrior', tags: ['combat'],
    description: 'All bloodlust abilities cost 20% less. Gain 2 extra bloodlust per kill. +10% damage while bloodlust is above 75%',
    effects: [{ type: 'bloodlust_cost_reduction', value: 0.20 }, { type: 'bloodlust_on_kill_bonus', value: 2 }, { type: 'bloodlust_threshold_damage', threshold: 0.75, value: 0.10 }], icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'killing_tempo', name: 'Killing Tempo', type: 'passive_perk', rarity: 'rare', archetype: 'warrior', tags: ['combat'],
    description: 'When your bloodlust bar is full, your next attack deals +50% bonus damage and generates a burst of momentum. Resets on use.',
    effects: [{ type: 'bloodlust_full_burst', bonusDamage: 0.50, description: '+50% damage burst when bloodlust is full' }],
    icon: 'skills/Skill_SwordAttack.PNG',
    combatPassive: { type: 'bloodlust_full_burst', bonusDamage: 0.50 } },

  // ── Bloodlust Legendaries ──
  { cardId: 'warlords_fury', name: "Warlord's Fury", type: 'active_ability', rarity: 'legendary', resourceType: 'bloodlust', archetype: 'warrior', archetypeSecondary: ['warrior'], tags: ['combat'],
    description: 'Consume all bloodlust. Deal physical damage equal to 2x bloodlust consumed to all enemies in 2 tiles. Heal 50% of damage dealt',
    effects: [{ type: 'consume_all_resource', resource: 'bloodlust' }, { type: 'damage_from_consumed', multiplier: 2.0, aoe: true }, { type: 'damage_heal', percent: 0.50 }],
    combatType: 'damage', targetType: 'all_enemies', bloodlustCost: 0, consumeAll: true, cooldown: 8, aoeRadius: 2, icon: 'skills/Skill_SwordAttack.PNG' },

  // ── Bloodlust Mythic Rare ──

  // ── Resource Conversion ──
  { cardId: 'resource_channel', name: 'Resource Channel', type: 'active_ability', rarity: 'rare', archetype: 'tactician',
    description: 'Convert 15 of your primary resource into 10 of a chosen secondary resource',
    resourceType: 'primary',
    combatType: 'utility', range: 0, manaCost: 15, aoeRadius: 0, cooldown: 3, targetType: 'self',
    convertResource: true, convertRatio: 0.67,
    icon: 'skills/Enchantment/' },

  // ── Hybrid Archetype Cards (reward multi-resource builds) ──
  { cardId: 'elemental_rage', name: 'Elemental Rage', type: 'active_ability', rarity: 'ultra_rare', archetype: 'mystic',
    tags: ['magic'],
    description: 'Channel bloodlust into arcane fury. Costs 10 bloodlust + 10 mana. Deals fire damage scaling with both resources.',
    resourceType: 'dual', dualCost: { bloodlust: 10, mana: 10 },
    combatType: 'damage', element: 'fire', baseDamage: 30, range: 4, manaCost: 0, aoeRadius: 1, cooldown: 4,
    scalingStat: 'acumen', scalingFactor: 1.0, bonusDamageFromResource: { resource: 'bloodlust', factor: 0.5 },
    targetType: 'enemy', icon: 'skills/Skill_Explosion.PNG' },
  { cardId: 'focused_fury', name: 'Focused Fury', type: 'active_ability', rarity: 'ultra_rare', archetype: 'warrior',
    description: 'Channel deep focus into a devastating physical strike. Costs 10 focus + 10 stamina. Damage increases with focus level.',
    resourceType: 'dual', dualCost: { focus: 10, stamina: 10 },
    combatType: 'damage', element: 'physical', baseDamage: 35, range: 1, manaCost: 0, aoeRadius: 0, cooldown: 4,
    scalingStat: 'finesse', scalingFactor: 0.8, bonusDamageFromResource: { resource: 'focus', factor: 0.6 },
    targetType: 'enemy', icon: 'skills/Skill_SwordAttack.PNG' },
  { cardId: 'battle_meditation', name: 'Battle Meditation', type: 'active_ability', rarity: 'ultra_rare', archetype: 'mystic',
    tags: ['magic'],
    description: 'Enter a meditative combat trance. Costs 15 focus + 15 mana. Heals all allies in radius and grants +2 regen to all resources for 3 turns.',
    resourceType: 'dual', dualCost: { focus: 15, mana: 15 },
    combatType: 'healing', baseHeal: 25, range: 0, manaCost: 0, aoeRadius: 2, cooldown: 5,
    scalingStat: 'resolve', scalingFactor: 0.5, grantsBuff: { name: 'meditative_trance', duration: 3, allResourceRegen: 2 },
    targetType: 'ally', icon: 'skills/Enchantment/' },

  // ── Sprint System Cards ──
  { cardId: 'sprint_stamina', name: "Runner's Endurance", type: 'passive_perk', rarity: 'common', archetype: 'rogue', rarityScalable: true, tags: ['utility'], effects: [{ type: 'sprint_max_bonus', value: 0.15 }], icon: 'skills/Enchantment/', description: 'Increases max sprint stamina. Scales with rarity.' },
  { cardId: 'sprint_regen', name: 'Second Wind', type: 'passive_perk', rarity: 'common', archetype: 'rogue', rarityScalable: true, tags: ['utility'], effects: [{ type: 'sprint_regen_bonus', value: 0.20 }], icon: 'skills/Enchantment/', description: 'Increases sprint stamina regen rate. Scales with rarity.' },
  { cardId: 'sprint_efficiency', name: 'Light Feet', type: 'passive_perk', rarity: 'uncommon', archetype: 'rogue', rarityScalable: true, tags: ['utility'], effects: [{ type: 'sprint_drain_reduction', value: 0.10 }], icon: 'skills/Enchantment/', description: 'Reduces sprint stamina drain. Scales with rarity.' },
];

// ---------------------------------------------------------------------------
// Rift Scars — Random modifiers applied to card drops from Rift dungeons
// Lore: The Rift warps everything it touches, leaving "scars" on items.
// Prefix Scars: offensive/elemental. Suffix Scars: defensive/utility.
// Rarity controls number of scars: Common=0, Uncommon=0, Rare=1, Ultra Rare=1, Mythic+=2
// ---------------------------------------------------------------------------

const RIFT_SCAR_PREFIXES = [
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

const RIFT_SCAR_SUFFIXES = [
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

const RIFT_SCAR_TOTAL_PREFIX_WEIGHT = RIFT_SCAR_PREFIXES.reduce(function(sum, s) { return sum + s.weight; }, 0);
const RIFT_SCAR_TOTAL_SUFFIX_WEIGHT = RIFT_SCAR_SUFFIXES.reduce(function(sum, s) { return sum + s.weight; }, 0);

/**
 * Determine how many Rift Scars a card should receive based on its rarity.
 * @param {string} rarity - Card rarity id
 * @returns {number} Number of scars (0, 1, or 2)
 */
function getRiftScarCount(rarity) {
  if (rarity === 'mythic_rare' || rarity === 'legendary' || rarity === 'godly' || rarity === 'relic') return 2;
  if (rarity === 'rare' || rarity === 'ultra_rare') return 1;
  return 0;
}

/**
 * Roll a random Rift Scar prefix based on weights.
 * @returns {object} A scar prefix object
 */
function rollRiftScarPrefix() {
  var roll = Math.random() * RIFT_SCAR_TOTAL_PREFIX_WEIGHT;
  var cumulative = 0;
  for (var i = 0; i < RIFT_SCAR_PREFIXES.length; i++) {
    cumulative += RIFT_SCAR_PREFIXES[i].weight;
    if (roll < cumulative) return RIFT_SCAR_PREFIXES[i];
  }
  return RIFT_SCAR_PREFIXES[RIFT_SCAR_PREFIXES.length - 1];
}

/**
 * Roll a random Rift Scar suffix based on weights.
 * @returns {object} A scar suffix object
 */
function rollRiftScarSuffix() {
  var roll = Math.random() * RIFT_SCAR_TOTAL_SUFFIX_WEIGHT;
  var cumulative = 0;
  for (var i = 0; i < RIFT_SCAR_SUFFIXES.length; i++) {
    cumulative += RIFT_SCAR_SUFFIXES[i].weight;
    if (roll < cumulative) return RIFT_SCAR_SUFFIXES[i];
  }
  return RIFT_SCAR_SUFFIXES[RIFT_SCAR_SUFFIXES.length - 1];
}

/**
 * Apply Rift Scars to a card instance. Modifies the card in-place.
 * @param {object} card - A card instance (from generateCardInstance)
 * @param {number} dungeonDepth - Current dungeon floor (higher = slightly better scars)
 * @returns {object} The modified card
 */
function applyRiftScars(card, dungeonDepth) {
  var scarCount = getRiftScarCount(card.rarity);
  if (scarCount <= 0) return card;

  card.riftScars = [];

  // First scar is always a prefix
  if (scarCount >= 1) {
    var prefix = rollRiftScarPrefix();
    card.riftScars.push({ type: 'prefix', id: prefix.id, name: prefix.name, effects: prefix.effects, description: prefix.description });
    // Modify card name: "Scorching Fireball I"
    card.name = prefix.name + ' ' + card.name;
  }

  // Second scar is always a suffix
  if (scarCount >= 2) {
    var suffix = rollRiftScarSuffix();
    card.riftScars.push({ type: 'suffix', id: suffix.id, name: suffix.name, effects: suffix.effects, description: suffix.description });
    // Modify card name: "Scorching Fireball I of the Bulwark"
    card.name = card.name + ' ' + suffix.name;
  }

  // Depth bonus: +1% to all numeric scar effect values per 10 floors (subtle scaling)
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

// Index card templates by rarity for efficient pack rolling.
// All cards are rarity-scalable: every card is added to all higher-tier pools up to
// ultra_rare — the gacha passes the rolled rarity to generateCardInstance which scales values.
const CARDS_BY_RARITY = {};
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

// Index card templates by cardId
const CARD_BY_ID = {};
for (var cii = 0; cii < CARD_TEMPLATES.length; cii++) {
  CARD_BY_ID[CARD_TEMPLATES[cii].cardId] = CARD_TEMPLATES[cii];
}

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

const CARDS_PER_PACK_MIN = 6;
const CARDS_PER_PACK_MAX = 6;
const MAX_ACTIVE_CARD_SLOTS = 4;
const MAX_PASSIVE_CARD_SLOTS = 3;
const MAX_EQUIPPED_CARDS = MAX_ACTIVE_CARD_SLOTS + MAX_PASSIVE_CARD_SLOTS; // 7
const MAX_CARD_COLLECTION = 1000;
const MAX_FUSION_COUNT = 2;

// Card visual styles (holographic, special editions)
const CARD_STYLES = {
  normal: { id: 'normal', name: 'Normal', chance: 0.80, borderEffect: null },
  holographic: { id: 'holographic', name: 'Holographic', chance: 0.12, borderEffect: 'rainbow_shimmer' },
  golden: { id: 'golden', name: 'Golden', chance: 0.05, borderEffect: 'gold_glow' },
  prismatic: { id: 'prismatic', name: 'Prismatic', chance: 0.025, borderEffect: 'prismatic_shift' },
  void: { id: 'void', name: 'Void Edition', chance: 0.005, borderEffect: 'void_particles' },
};

// Special serial numbers for first-pulled and milestone cards
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

// Biome XP bonus multiplier: skills work everywhere but listed biomes give bonus
const SKILL_BIOME_BONUS = {
  farming: { preferred: ['PLAINS', 'HOLY_DOMINION', 'ELVEN_SOUTH'], bonus: 0.25 },
  fishing: { preferred: ['BEACH', 'SWAMP'], bonus: 0.25, nearWater: true },
  glassworking: { preferred: ['SCORCHED_SANDS', 'WASTES'], bonus: 0.25 },
  cogworking: { preferred: ['CLOCKWORK_HARBOR', 'GNOMISH_ISLES', 'MECHSPIRE'], bonus: 0.25 },
  magic: { preferred: ['ELVEN_SOUTH', 'HOLY_DOMINION', 'SWAMP'], bonus: 0.20 },
  mining: { preferred: ['MOUNTAIN', 'WASTES'], bonus: 0.15 },
  woodcutting: { preferred: ['FOREST', 'ELVEN_SOUTH'], bonus: 0.15 },
};

// Mount types that can traverse water
const WATER_MOUNTS = new Set(['raft', 'boat', 'ship', 'sea_mount', 'airship', 'flying_mount']);

// Apply rarity scaling to a single numeric field
function _scaleNumeric(val, factor) {
  return Math.round(val * factor * 1000) / 1000;
}

function generateCardInstance(template, source, rolledRarity) {
  var style = rollCardStyle();
  // All cards use the rolled rarity for affix count and display (universal rarity scaling)
  var effectiveRarity = rolledRarity || template.rarity;
  var baseEffects = JSON.parse(JSON.stringify(template.effects));
  var combatPassive = template.combatPassive ? JSON.parse(JSON.stringify(template.combatPassive)) : undefined;

  // Apply rarity scaling when drawn at a higher tier than the template base
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

  // Void edition: +10% to base effects only (affixes are unaffected — rolled separately)
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

  // Roll affixes (each returned as {id, label, tier, cat, stacks: 1})
  var rolledAffixes = rollCardAffixes(template, effectiveRarity);

  // Passive rider for active ability cards at rare+
  var passiveRider = null;
  var riderChance = PASSIVE_RIDER_CHANCE[effectiveRarity] || 0;
  if (template.type === 'active_ability' && riderChance > 0 && Math.random() < riderChance) {
    var rider = rollPassiveRider(effectiveRarity);
    if (rider) {
      passiveRider = { id: rider.id, label: rider.label, tier: rider.tier };
    }
  }

  // Build flavor name from affixes
  var _pfx = getAffixNamePrefix(rolledAffixes);
  var _sfx = passiveRider ? passiveRider.label : getAffixNameSuffix(rolledAffixes);
  if (_pfx) displayName = _pfx + ' ' + displayName;
  if (_sfx) displayName = displayName + ' ' + _sfx;

  var card = {
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
    // Evolution fields
    evolutionStage: 0,
    evolutionXp: 0,
    evolutionPath: null,
    evolutionBonusLevel: 0,
  };
  if (combatPassive) card.combatPassive = combatPassive;

  // Build effects[] and combos[] from _baseEffects + affixes×stacks + rider
  refreshCardEffects(card);
  return card;
}

function openCardPack(raceId, pityPullsSinceLegendary, luckBonus) {
  var isCatFolk = (raceId === 'catfolk');
  var totalLuck = (typeof luckBonus === 'number' && luckBonus > 0) ? luckBonus : 0;
  var pity = { pullsSinceLegendary: (typeof pityPullsSinceLegendary === 'number' ? pityPullsSinceLegendary : 0) };
  var cardCount = CARDS_PER_PACK_MIN + Math.floor(Math.random() * (CARDS_PER_PACK_MAX - CARDS_PER_PACK_MIN + 1));
  var cards = [];
  for (var i = 0; i < cardCount; i++) {
    var rarity = rollRarity(isCatFolk, pity);

    // Apply luck bonus: chance to bump rarity up one tier
    if (totalLuck > 0 && rarity.order < RARITY_TIERS.length - 1) {
      if (Math.random() < totalLuck) {
        rarity = RARITY_TIERS[rarity.order + 1];
      }
    }

    var pool = CARDS_BY_RARITY[rarity.id];
    if (!pool || pool.length === 0) pool = CARDS_BY_RARITY['common'];

    // Filter out race-locked cards that don't match player's race
    var filteredPool = [];
    for (var j = 0; j < pool.length; j++) {
      if (!pool[j].raceLocked || pool[j].raceLocked === raceId) {
        filteredPool.push(pool[j]);
      }
    }
    if (filteredPool.length === 0) filteredPool = pool;

    // Race-based tag weighting
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
// Gacha Rate Disclosure: compute effective rates for a given player state
// ---------------------------------------------------------------------------

// Race-based pool biases (mirrors the logic in openCardPack)
var RACE_POOL_BIAS = {
  elf:        { pool: 'magic',   chance: 0.40 },
  goblin:     { pool: 'stealth', chance: 0.35 },
  catfolk:    { pool: 'luck',    chance: 0.40 },
  lizardfolk: { pool: 'ritual',  chance: 0.25 },
};

var CATFOLK_RARITY_BUMP = 0.12; // 12% chance to bump up one tier

/**
 * Compute the effective gacha rarity rates for a specific player.
 *
 * Takes into account:
 *   - Base rarity weights from RARITY_TIERS
 *   - Soft pity (pullsSinceLegendary > 80 = +2% per pull toward Legendary)
 *   - Hard pity (pullsSinceLegendary >= 120 = guaranteed Legendary)
 *   - Cat Folk rarity bump (12% chance to advance one tier)
 *   - Equipped card luck bonus (chance to advance one tier)
 *
 * Returns an object with:
 *   baseRates      - unmodified rates { common: 0.45, ... }
 *   effectiveRates - rates after all modifiers { common: 0.42, ... }
 *   raceModifiers  - { poolBias: {pool, chance} | null, rarityBump: number }
 *   cardModifiers  - array of { cardName, effect } for equipped cards affecting rates
 *   pityInfo       - { pullsSinceLegendary, softPityStart, hardPity, softPityActive, currentBoost }
 *   packInfo       - { cardsPerPack, guarantees }
 */
function computeEffectiveGachaRates(raceId, pullsSinceLegendary, luckBonus) {
  var isCatFolk = (raceId === 'catfolk');
  var totalLuck = (typeof luckBonus === 'number' && luckBonus > 0) ? luckBonus : 0;
  var pity = typeof pullsSinceLegendary === 'number' ? pullsSinceLegendary : 0;

  var tierCount = RARITY_TIERS.length;

  // Step 0: Build base probability distribution from weights
  var baseProbs = [];
  for (var i = 0; i < tierCount; i++) {
    baseProbs[i] = RARITY_TIERS[i].weight / TOTAL_RARITY_WEIGHT;
  }

  // Copy base for the "base rates" output (before any modifiers)
  var baseRatesOut = {};
  for (var b = 0; b < tierCount; b++) {
    baseRatesOut[RARITY_TIERS[b].id] = baseProbs[b];
  }

  // Working copy of probabilities that we mutate through each modifier stage
  var probs = [];
  for (var c = 0; c < tierCount; c++) {
    probs[c] = baseProbs[c];
  }

  // Step 1: Hard pity check — if at or beyond 120, next pull is guaranteed Legendary
  var hardPityActive = (pity >= HARD_PITY);
  if (hardPityActive) {
    for (var h = 0; h < tierCount; h++) {
      probs[h] = 0;
    }
    probs[5] = 1.0; // Legendary (order 5)
  }

  // Step 2: Soft pity — chance to override to Legendary for sub-Legendary rolls
  // Only applies if we haven't hit hard pity
  var softPityBoost = 0;
  if (!hardPityActive && pity > SOFT_PITY_START) {
    // The next pull will be at pullsSinceLegendary + 1 (since rollRarity increments first)
    softPityBoost = (pity + 1 - SOFT_PITY_START) * SOFT_PITY_RATE;
    if (softPityBoost > 1) softPityBoost = 1;

    // For tiers 0-4 (below Legendary), a fraction softPityBoost gets redirected to Legendary
    var massRedirected = 0;
    for (var s = 0; s < 5; s++) {
      var redirected = probs[s] * softPityBoost;
      probs[s] -= redirected;
      massRedirected += redirected;
    }
    probs[5] += massRedirected;
  }

  // Step 3: Cat Folk rarity bump — 12% chance per card to bump up one tier
  // For each tier i (except the highest), 12% of its probability migrates to tier i+1
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
        afterCatfolk[t] += probs[t]; // Highest tier stays
      }
    }
    probs = afterCatfolk;
  }

  // Step 4: Luck bonus — additional chance to bump rarity up one tier
  // Applied independently per card in openCardPack after rarity roll
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

  // Build effective rates output
  var effectiveRates = {};
  for (var e = 0; e < tierCount; e++) {
    // Round to 6 decimal places to avoid floating point noise
    effectiveRates[RARITY_TIERS[e].id] = Math.round(probs[e] * 1000000) / 1000000;
  }

  // Race modifiers output
  var raceModifiers = {
    poolBias: RACE_POOL_BIAS[raceId] || null,
    rarityBump: isCatFolk ? CATFOLK_RARITY_BUMP : 0,
  };

  // Pity info output
  var pityInfo = {
    pullsSinceLegendary: pity,
    softPityStart: SOFT_PITY_START,
    hardPity: HARD_PITY,
    softPityRate: SOFT_PITY_RATE,
    softPityActive: pity > SOFT_PITY_START,
    hardPityActive: hardPityActive,
    currentBoost: softPityBoost,
  };

  // Pack info
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

// ---------------------------------------------------------------------------
// Procedural Card Mutation System
// Mutations are random bonus effects applied on:
//   - Fusion (hybrid fusions have +10% mutation chance)
//   - Evolution stage advance
//   - Pack opening (very low base chance, scales with luck)
// Luck stat increases both mutation chance and the magnitude tier.
// ---------------------------------------------------------------------------

// MUTATION_POOL: categorized by archetype/type to keep mutations thematic.
// Each entry: { type, ..., weight, tier (1=minor, 2=moderate, 3=major) }
var MUTATION_POOL = [
  // ── Stat mutations ──
  { id: 'mut_vigor_1',    tier: 1, weight: 20, effect: { type: 'stat_boost', stat: 'vigor', value: 1 },          label: 'Vitality Surge' },
  { id: 'mut_might_1',    tier: 1, weight: 20, effect: { type: 'stat_boost', stat: 'might', value: 1 },          label: 'Surge of Strength' },
  { id: 'mut_finesse_1',  tier: 1, weight: 20, effect: { type: 'stat_boost', stat: 'finesse', value: 1 },        label: 'Nimble Grace' },
  { id: 'mut_acumen_1',   tier: 1, weight: 18, effect: { type: 'stat_boost', stat: 'acumen', value: 1 },         label: 'Arcane Insight' },
  { id: 'mut_resolve_1',  tier: 1, weight: 18, effect: { type: 'stat_boost', stat: 'resolve', value: 1 },        label: 'Iron Resolve' },
  { id: 'mut_ing_1',      tier: 1, weight: 15, effect: { type: 'stat_boost', stat: 'ingenuity', value: 1 },      label: 'Tinkerer\'s Touch' },
  // ── Minor passive mutations ──
  { id: 'mut_crit_sm',    tier: 1, weight: 18, effect: { type: 'crit_bonus', value: 0.01 },                      label: 'Keen Edge' },
  { id: 'mut_dodge_sm',   tier: 1, weight: 18, effect: { type: 'dodge_bonus', value: 0.01 },                     label: 'Slippery' },
  { id: 'mut_hpregen_sm', tier: 1, weight: 15, effect: { type: 'hp_regen', value: 1 },                           label: 'Trickle Heal' },
  { id: 'mut_speed_sm',   tier: 1, weight: 15, effect: { type: 'speed_bonus', value: 0.02 },                     label: 'Fleet-Footed' },
  { id: 'mut_luck_sm',    tier: 1, weight: 15, effect: { type: 'luck_bonus', value: 0.03 },                      label: 'Lucky Break' },
  { id: 'mut_loot_sm',    tier: 1, weight: 12, effect: { type: 'loot_bonus', value: 0.05 },                      label: 'Greedy Touch' },
  { id: 'mut_mresist_sm', tier: 1, weight: 12, effect: { type: 'magic_resist', value: 0.02 },                    label: 'Arcane Veil' },
  // ── Moderate mutations ──
  { id: 'mut_vigor_2',    tier: 2, weight: 10, effect: { type: 'stat_boost', stat: 'vigor', value: 2 },          label: 'Wellspring of Life' },
  { id: 'mut_might_2',    tier: 2, weight: 10, effect: { type: 'stat_boost', stat: 'might', value: 2 },          label: 'Brute Awakening' },
  { id: 'mut_crit_md',    tier: 2, weight: 10, effect: { type: 'crit_bonus', value: 0.03 },                      label: 'Sharpened Focus' },
  { id: 'mut_lifesteal',  tier: 2, weight: 8,  effect: { type: 'lifesteal', value: 0.05 },                       label: 'Sanguine Leech' },
  { id: 'mut_xpbonus',    tier: 2, weight: 8,  effect: { type: 'xp_bonus_all', value: 0.05 },                    label: 'Thirst for Knowledge' },
  { id: 'mut_gather',     tier: 2, weight: 8,  effect: { type: 'gather_bonus', value: 0.08 },                    label: 'Abundant Harvest' },
  { id: 'mut_craft_q',    tier: 2, weight: 8,  effect: { type: 'craft_quality_bonus', value: 0.08 },             label: 'Masterwork Potential' },
  { id: 'mut_mana_regen', tier: 2, weight: 8,  effect: { type: 'mana_regen', value: 2 },                         label: 'Wellspring of Mana' },
  // ── Major mutations (rare, require high luck) ──
  { id: 'mut_revive',     tier: 3, weight: 3,  effect: { type: 'second_chance', cooldown: 600 },                 label: 'Second Chance' },
  { id: 'mut_double_all', tier: 3, weight: 4,  effect: { type: 'double_gather_all', chance: 0.05 },              label: 'Double Fortune' },
  { id: 'mut_dodge_lg',   tier: 3, weight: 4,  effect: { type: 'dodge_bonus', value: 0.05 },                     label: 'Ghost Step' },
  { id: 'mut_all_stats',  tier: 3, weight: 3,  effect: { type: 'stat_boost_all', value: 1 },                     label: 'Awakened Potential' },
  { id: 'mut_xp_major',   tier: 3, weight: 3,  effect: { type: 'xp_bonus_all', value: 0.10 },                    label: 'Enlightened Mind' },
  // ── Wild mutations: outliers (~1% of triggered results). weight:1, wild:true ──
  // These require luckBonus >= 0.30 to access and are collectively ~3% of the tier-3 pool.
  { id: 'mut_wild_heartfire',    tier: 3, weight: 1, wild: true,
    label: 'Heartfire Pulse',
    effect: { type: 'low_hp_card_amplifier', threshold: 0.20, multiplier: 2.0, duration: 8 },
    description: 'Below 20% HP, ALL equipped card effects double for 8 seconds.' },
  { id: 'mut_wild_borrowed_time', tier: 3, weight: 1, wild: true,
    label: 'Borrowed Time',
    effect: { type: 'death_save_once_per_run', recovery_seconds: 60 },
    description: 'Survive one killing blow per dungeon run with 1 HP. Card goes silent for 60s after.' },
  { id: 'mut_wild_chromatic_soul', tier: 3, weight: 1, wild: true,
    label: 'Chromatic Soul',
    effect: { type: 'mood_cycle', interval: 180, moods: ['aggressive', 'spectral', 'verdant', 'null'] },
    description: 'Card cycles through 4 moods every 3 minutes: Aggressive, Spectral, Verdant, Null.' },
  { id: 'mut_wild_echo_resonance', tier: 3, weight: 1, wild: true,
    label: 'Echo Resonance',
    effect: { type: 'proc_echo', chance: 0.15 },
    description: 'When any other equipped card procs, 15% chance this card re-fires its own last proc.' },
  { id: 'mut_wild_symbiotic',    tier: 3, weight: 1, wild: true,
    label: 'Symbiotic Leech',
    effect: { type: 'universal_evo_xp_rate', value: 0.10 },
    description: 'Gains evo XP from every player action (any category) at 10% rate. True generalist.' },
  { id: 'mut_wild_wanderer',     tier: 3, weight: 1, wild: true,
    label: "Wanderer's Ink",
    effect: { type: 'biome_explore_stack', value: 0.5, max_stacks: 14, reset_on_logout: true },
    description: '+0.5 to primary stat per unique biome entered this session. Stacks up to 14. Resets on logout.' },
  { id: 'mut_wild_mirror_ghost', tier: 3, weight: 1, wild: true,
    label: 'Mirror Ghost',
    effect: { type: 'last_damage_source_resist', threshold: 50, resist_value: 0.25 },
    description: 'Remembers the last enemy that dealt 50+ damage. +25% resist vs that type while equipped.' },
  { id: 'mut_wild_dreaming',     tier: 3, weight: 1, wild: true,
    label: 'The Dreaming Card',
    effect: { type: 'scheduled_spontaneous_mutation', interval_seconds: 3600, max_spontaneous: 3 },
    description: 'Once per real-world hour while equipped, spontaneously grows a random tier-1 mutation. Max 3.' },
  { id: 'mut_wild_hollow_envy',  tier: 3, weight: 1, wild: true,
    label: "Hollow King's Envy",
    effect: { type: 'higher_level_enemy_modifier', damage_reduction: 0.20, loot_bonus: 0.30 },
    description: 'Enemies higher-level than you deal 20% less damage but drop 30% more loot. The Hollow are jealous.' },
  { id: 'mut_wild_prob_debt',    tier: 3, weight: 1, wild: true,
    label: 'Probability Debt',
    effect: { type: 'crit_cycle', active_hours: 24, rest_hours: 24 },
    description: 'For 24h after equipping, every hit crits. Then all crits are disabled for 24h as the debt is repaid.' },
];

// MUTATION_RARITY_LABELS: what shows in the UI for the mutation result
var MUTATION_TIER_NAMES = { 1: 'Minor', 2: 'Moderate', 3: 'Major' };

// rollMutation(luckBonus): returns a mutation result or null if no mutation triggers.
// luckBonus: combined luck from card effects (0.0 to ~1.0 range typical)
// Base chance: 8% (fusion) / 5% (evo stage) / 2% (pack open)
// luckBonus scales: final chance = baseChance * (1 + luckBonus * 3), capped at 60%
// Tier access: tier 2 requires luckBonus >= 0.10; tier 3 requires luckBonus >= 0.30
function rollMutation(baseChance, luckBonus) {
  var luck = (typeof luckBonus === 'number' && luckBonus > 0) ? luckBonus : 0;
  var finalChance = Math.min(baseChance * (1 + luck * 3), 0.60);
  if (Math.random() >= finalChance) return null;

  // Determine tier access based on luck
  var maxTier = 1;
  if (luck >= 0.30) maxTier = 3;
  else if (luck >= 0.10) maxTier = 2;

  // Build weighted pool
  var pool = [];
  var totalWeight = 0;
  for (var mi = 0; mi < MUTATION_POOL.length; mi++) {
    if (MUTATION_POOL[mi].tier <= maxTier) {
      pool.push(MUTATION_POOL[mi]);
      totalWeight += MUTATION_POOL[mi].weight;
    }
  }
  if (pool.length === 0) return null;

  var roll = Math.random() * totalWeight;
  var cumulative = 0;
  for (var pi = 0; pi < pool.length; pi++) {
    cumulative += pool[pi].weight;
    if (roll < cumulative) {
      return {
        mutationId: pool[pi].id,
        label: pool[pi].label,
        tier: pool[pi].tier,
        tierName: MUTATION_TIER_NAMES[pool[pi].tier],
        effect: JSON.parse(JSON.stringify(pool[pi].effect)),
      };
    }
  }
  return null;
}

// Apply a mutation to a card instance (adds effect + marks it as mutated)
function applyMutation(card, mutation) {
  if (!card || !mutation) return;
  card.effects.push(mutation.effect);
  if (!card.mutations) card.mutations = [];
  card.mutations.push({ id: mutation.mutationId, label: mutation.label, tier: mutation.tier });
}

// ---------------------------------------------------------------------------
// Card Curse System
// ---------------------------------------------------------------------------
// Curses are negative effects that can appear on cards from dangerous biomes,
// corrupted dungeon chests, or very rare pack openings.
// Curses can be cleansed via purification scrolls or alchemy.
// ---------------------------------------------------------------------------

var CARD_CURSE_POOL = [
  // ── Tier 1: Minor curses ──
  { mutationId: 'curse_drain_xp',   label: 'XP Drain',       tier: 1, weight: 18,
    effect: { type: 'xp_penalty', value: -0.10 } },
  { mutationId: 'curse_fumble',      label: 'Fumble',          tier: 1, weight: 16,
    effect: { type: 'crit_penalty', value: -0.05 } },
  { mutationId: 'curse_mana_leak',   label: 'Mana Leak',       tier: 1, weight: 14,
    effect: { type: 'mana_drain', value: 1 } },
  { mutationId: 'curse_sluggish',    label: 'Sluggish',        tier: 1, weight: 15,
    effect: { type: 'speed_penalty', value: -0.05 } },
  { mutationId: 'curse_frail',       label: 'Frail',           tier: 1, weight: 13,
    effect: { type: 'hp_penalty', value: -5 } },
  // ── Tier 2: Moderate curses ──
  { mutationId: 'curse_ill_fortune', label: 'Ill Fortune',     tier: 2, weight: 9,
    effect: { type: 'luck_penalty', value: -0.10 } },
  { mutationId: 'curse_enervation',  label: 'Enervation',      tier: 2, weight: 8,
    effect: { type: 'stat_penalty', stat: 'vigor', value: -2 } },
  { mutationId: 'curse_weakened',    label: 'Weakened',        tier: 2, weight: 7,
    effect: { type: 'damage_penalty', value: -0.10 } },
  { mutationId: 'curse_volatile',    label: 'Volatile',        tier: 2, weight: 6,
    effect: { type: 'self_damage_on_crit', value: 3 } },
  // ── Tier 3: Major curses ──
  { mutationId: 'curse_rift_echo',   label: 'Rift Echo',       tier: 3, weight: 4,
    effect: { type: 'rift_aggro_bonus', value: 0.20 } },
  { mutationId: 'curse_hollowing',   label: 'Hollowing',       tier: 3, weight: 3,
    effect: { type: 'evo_xp_penalty', value: -0.25 } },
  { mutationId: 'curse_soul_burn',   label: 'Soul Burn',       tier: 3, weight: 2,
    effect: { type: 'hp_on_skill_drain', value: 2 } },
  // ── Wild curses: outliers (~1% of triggered curses). weight:1, wild:true ──
  { mutationId: 'curse_wild_gossip',   label: 'Gossip Curse',      tier: 3, weight: 1, wild: true,
    effect: { type: 'gossip_evo_debuff', interval_seconds: 3600, penalty: -0.30 },
    description: 'Each hour, whispers to a random other equipped card: -30% evo XP for that card for 1 hour.' },
  { mutationId: 'curse_wild_hungry',   label: 'The Hungry Card',   tier: 3, weight: 1, wild: true,
    effect: { type: 'coin_drain_passive', rate_per_minute: 1, power_growth_per_100_coins: 0.001 },
    description: 'Drains 1 coin/minute while equipped. Each 100 coins consumed: +0.1% to card effects.' },
  { mutationId: 'curse_wild_backwards', label: 'Backwards Bloom',  tier: 3, weight: 1, wild: true,
    effect: { type: 'stage_regression_on_advance', removes_previous_stage_bonus: true },
    description: 'Reaching a new evo stage removes the previous stage\'s bonus. Only stage 3 path effects survive.' },
  { mutationId: 'curse_wild_mirror',   label: 'The Mirror Price',  tier: 3, weight: 1, wild: true,
    effect: { type: 'weekly_bonus_inversion', duration_floors: 1 },
    description: 'Once per week, all this card\'s bonuses transfer to a random enemy type for one dungeon floor.' },
  { mutationId: 'curse_wild_sunder',   label: 'Sunder Bond',       tier: 3, weight: 1, wild: true,
    effect: { type: 'self_destruct_on_max_evo', reward_evo_xp: 50, reward_rarity: 'rare' },
    description: 'If this card reaches evo stage 3, it destroys itself. On death: all equipped cards gain +50 evo XP and a rare item drops.' },
  { mutationId: 'curse_wild_attention', label: 'Attention Curse',  tier: 3, weight: 1, wild: true,
    effect: { type: 'universal_enemy_aggro', aggro_bonus: 0.15, aggro_radius_bonus: 5 },
    description: 'All dungeon enemies aggro the player first. +5 tile aggro radius. +15% aggro priority.' },
  { mutationId: 'curse_wild_fools',    label: "The Fool's Price",  tier: 3, weight: 1, wild: true,
    effect: { type: 'poverty_gate', max_coins: 100 },
    description: 'All card effects suppressed above 100 coins. Only works when broke. Forces poverty playstyle.' },
  { mutationId: 'curse_wild_forgetting', label: 'Forgetting',      tier: 3, weight: 1, wild: true,
    effect: { type: 'daily_mutation_forgetting', fallback_xp_loss: 10 },
    description: 'Each day, loses one random acquired mutation. If none exist, loses 10 evo XP instead.' },
  { mutationId: 'curse_wild_echo_void', label: 'Echo Void',        tier: 3, weight: 1, wild: true,
    effect: { type: 'viral_self_redirect', value: true },
    description: 'When this card would viral-spread a mutation outward, it redirects inward — compounding onto itself.' },
  { mutationId: 'curse_wild_namesake',  label: 'Namesake Burden',  tier: 3, weight: 1, wild: true,
    effect: { type: 'namesake_adjustment', trade_penalty: -0.05, penalty_days: 7, fuse_lockout_hours: 48 },
    description: 'Bonded to its first fuser\'s name. If traded: new owner suffers -5% all stats for 7 days. Fuse locked 48h post-trade.' },
];

/**
 * Roll for a card curse based on biome/source chance and luck.
 * Higher luck reduces both chance and tier of curse received.
 * baseCurseChance: float (0-1)
 */
function rollCardCurse(baseCurseChance, luckBonus) {
  var luck = (typeof luckBonus === 'number' && luckBonus > 0) ? luckBonus : 0;
  // Luck reduces curse chance: each 0.10 luck cuts by 20%
  var curseMult = Math.max(0.05, 1 - luck * 2);
  var finalChance = Math.min(baseCurseChance * curseMult, 0.40);
  if (Math.random() >= finalChance) return null;

  // Luck limits curse tier
  var maxTier = 3;
  if (luck >= 0.15) maxTier = 2;
  if (luck >= 0.30) maxTier = 1;

  var pool = [];
  var totalWeight = 0;
  for (var ci = 0; ci < CARD_CURSE_POOL.length; ci++) {
    if (CARD_CURSE_POOL[ci].tier <= maxTier) {
      pool.push(CARD_CURSE_POOL[ci]);
      totalWeight += CARD_CURSE_POOL[ci].weight;
    }
  }
  if (pool.length === 0) return null;

  var roll = Math.random() * totalWeight;
  var cum = 0;
  for (var j = 0; j < pool.length; j++) {
    cum += pool[j].weight;
    if (roll <= cum) return pool[j];
  }
  return pool[pool.length - 1];
}

/**
 * Apply a curse to a card instance (adds negative effect + marks as cursed).
 * Curses can be cleansed via purification.
 */
function applyCurse(card, curse) {
  if (!card || !curse) return;
  card.effects.push(curse.effect);
  if (!card.curses) card.curses = [];
  card.curses.push({ id: curse.mutationId, label: curse.label, tier: curse.tier, cleansable: true });
  card.isCursed = true;
}

/**
 * Cleanse a specific curse from a card by curse ID.
 * Returns true if curse was found and removed.
 */
function cleanseCardCurse(card, curseId) {
  if (!card || !card.curses) return false;
  var idx = -1;
  for (var i = 0; i < card.curses.length; i++) {
    if (card.curses[i].id === curseId && card.curses[i].cleansable) { idx = i; break; }
  }
  if (idx === -1) return false;
  // Remove the associated effect
  var curse = card.curses.splice(idx, 1)[0];
  // Remove the matching negative effect
  for (var ei = 0; ei < card.effects.length; ei++) {
    var ef = card.effects[ei];
    var curseEntry = null;
    for (var cp = 0; cp < CARD_CURSE_POOL.length; cp++) {
      if (CARD_CURSE_POOL[cp].mutationId === curse.id) { curseEntry = CARD_CURSE_POOL[cp]; break; }
    }
    if (curseEntry && ef.type === curseEntry.effect.type && ef.value === curseEntry.effect.value) {
      card.effects.splice(ei, 1);
      break;
    }
  }
  if (card.curses.length === 0) card.isCursed = false;
  return true;
}

// ---------------------------------------------------------------------------
// AFFIX_POOL: Procedural affix system (~90 affixes across 6 categories)
// Each affix: { id, tier (1-3), category, label, effect, weight }
// Rolled at draw time and appended to card.effects[]. No new art needed.
// ---------------------------------------------------------------------------

var AFFIX_POOL = [
  // ── OFFENSIVE (15) ──
  { id: 'aff_spell_dmg_1',     tier: 1, cat: 'offensive', weight: 14, label: 'Scorching',     effect: { type: 'spell_damage_bonus', value: 0.05 } },
  { id: 'aff_spell_dmg_2',     tier: 2, cat: 'offensive', weight: 8,  label: 'Blazing',       effect: { type: 'spell_damage_bonus', value: 0.12 } },
  { id: 'aff_spell_dmg_3',     tier: 3, cat: 'offensive', weight: 4,  label: 'Annihilating',  effect: { type: 'spell_damage_bonus', value: 0.22 } },
  { id: 'aff_melee_dmg_1',     tier: 1, cat: 'offensive', weight: 14, label: 'Sharp',         effect: { type: 'melee_damage_bonus', value: 0.05 } },
  { id: 'aff_melee_dmg_2',     tier: 2, cat: 'offensive', weight: 8,  label: 'Brutal',        effect: { type: 'melee_damage_bonus', value: 0.12 } },
  { id: 'aff_aoe_1',           tier: 2, cat: 'offensive', weight: 7,  label: 'Spreading',     effect: { type: 'aoe_radius_bonus', value: 1 } },
  { id: 'aff_range_1',         tier: 1, cat: 'offensive', weight: 12, label: 'Far-reaching',  effect: { type: 'range_bonus', value: 1 } },
  { id: 'aff_chain_1',         tier: 2, cat: 'offensive', weight: 7,  label: 'Echoing',       effect: { type: 'chain_targets', value: 1 } },
  { id: 'aff_chain_2',         tier: 3, cat: 'offensive', weight: 4,  label: 'Resonating',    effect: { type: 'chain_targets', value: 2 } },
  { id: 'aff_crit_active_1',   tier: 1, cat: 'offensive', weight: 12, label: 'Keen',          effect: { type: 'crit_bonus', value: 0.03 } },
  { id: 'aff_execute_1',       tier: 2, cat: 'offensive', weight: 7,  label: 'Finishing',     effect: { type: 'execute_bonus', threshold: 0.30, value: 0.15 } },
  { id: 'aff_armor_pen_1',     tier: 2, cat: 'offensive', weight: 7,  label: 'Piercing',      effect: { type: 'armor_penetration', value: 0.15 } },
  { id: 'aff_double_cast',     tier: 3, cat: 'offensive', weight: 4,  label: 'Mirrored',      effect: { type: 'double_cast_chance', value: 0.12 } },
  { id: 'aff_projectile_split',tier: 2, cat: 'offensive', weight: 6,  label: 'Fractured',     effect: { type: 'projectile_split', count: 2, damageMult: 0.65 } },
  { id: 'aff_overpower_1',     tier: 3, cat: 'offensive', weight: 4,  label: 'Overwhelming',  effect: { type: 'armor_shred_on_hit', value: 2, duration: 3 } },

  // ── ON-HIT (12) ──
  { id: 'aff_bleed_1',         tier: 1, cat: 'on_hit', weight: 14, label: 'Serrated',     effect: { type: 'on_hit_bleed', chance: 0.25, duration: 2 } },
  { id: 'aff_bleed_2',         tier: 2, cat: 'on_hit', weight: 8,  label: 'Hemorrhaging', effect: { type: 'on_hit_bleed', chance: 0.45, duration: 3 } },
  { id: 'aff_burn_1',          tier: 1, cat: 'on_hit', weight: 12, label: 'Smoldering',   effect: { type: 'on_hit_burn', chance: 0.25 } },
  { id: 'aff_chill_1',         tier: 1, cat: 'on_hit', weight: 12, label: 'Frosty',       effect: { type: 'on_hit_slow', chance: 0.25 } },
  { id: 'aff_poison_1',        tier: 1, cat: 'on_hit', weight: 12, label: 'Tainted',      effect: { type: 'on_hit_poison', chance: 0.20 } },
  { id: 'aff_stun_1',          tier: 2, cat: 'on_hit', weight: 7,  label: 'Stunning',     effect: { type: 'on_hit_stun', chance: 0.15, duration: 1 } },
  { id: 'aff_lifesteal_1',     tier: 2, cat: 'on_hit', weight: 8,  label: 'Leeching',     effect: { type: 'lifesteal', value: 0.06 } },
  { id: 'aff_lifesteal_2',     tier: 3, cat: 'on_hit', weight: 4,  label: 'Vampiric',     effect: { type: 'lifesteal', value: 0.12 } },
  { id: 'aff_mana_drain_1',    tier: 2, cat: 'on_hit', weight: 6,  label: 'Disrupting',   effect: { type: 'mana_drain_on_hit', value: 4 } },
  { id: 'aff_mark_1',          tier: 2, cat: 'on_hit', weight: 7,  label: 'Marked',       effect: { type: 'mark_on_hit', chance: 0.20, damageTakenBonus: 0.10 } },
  { id: 'aff_knockback_1',     tier: 1, cat: 'on_hit', weight: 10, label: 'Forceful',     effect: { type: 'knockback_on_hit', tiles: 1 } },
  { id: 'aff_push_1',          tier: 2, cat: 'on_hit', weight: 7,  label: 'Repelling',    effect: { type: 'push_on_hit', tiles: 2 } },
  { id: 'aff_pull_1',          tier: 2, cat: 'on_hit', weight: 6,  label: 'Graviton',     effect: { type: 'pull_on_hit', tiles: 1 } },
  { id: 'aff_pierce_1',        tier: 2, cat: 'on_hit', weight: 6,  label: 'Piercing',     effect: { type: 'pierce_on_hit', targets: 1 } },
  { id: 'aff_oh_chain_1',      tier: 2, cat: 'on_hit', weight: 5,  label: 'Chaining',     effect: { type: 'chain_on_hit', bounces: 1, damageFalloff: 0.6 } },
  { id: 'aff_oh_chain_2',      tier: 3, cat: 'on_hit', weight: 3,  label: 'Arc',          effect: { type: 'chain_on_hit', bounces: 2, damageFalloff: 0.5 } },
  { id: 'aff_wound_1',         tier: 3, cat: 'on_hit', weight: 4,  label: 'Grievous',     effect: { type: 'wound_on_hit', healing_reduction: 0.30 } },

  // ── RESOURCE (10) ──
  { id: 'aff_cd_1',            tier: 1, cat: 'resource', weight: 14, label: 'Swift',             effect: { type: 'cooldown_reduction', value: 1 } },
  { id: 'aff_cd_2',            tier: 2, cat: 'resource', weight: 8,  label: 'Rapid',             effect: { type: 'cooldown_reduction', value: 2 } },
  { id: 'aff_mana_cost_1',     tier: 1, cat: 'resource', weight: 12, label: 'Efficient',         effect: { type: 'resource_cost_reduction', value: 0.15 } },
  { id: 'aff_mana_cost_2',     tier: 2, cat: 'resource', weight: 8,  label: 'Frugal',            effect: { type: 'resource_cost_reduction', value: 0.30 } },
  { id: 'aff_free_cast_1',     tier: 2, cat: 'resource', weight: 7,  label: 'Lucky',             effect: { type: 'free_cast_chance', value: 0.08 } },
  { id: 'aff_free_cast_2',     tier: 3, cat: 'resource', weight: 4,  label: 'Blessed',           effect: { type: 'free_cast_chance', value: 0.15 } },
  { id: 'aff_bonus_charge',    tier: 3, cat: 'resource', weight: 4,  label: 'Prepared',          effect: { type: 'bonus_charge', value: 1 } },
  { id: 'aff_refund_kill_1',   tier: 2, cat: 'resource', weight: 7,  label: 'Bloodthirsty',      effect: { type: 'resource_refund_on_kill', value: 0.60 } },
  { id: 'aff_refund_crit_1',   tier: 2, cat: 'resource', weight: 7,  label: 'Critical Channel',  effect: { type: 'resource_refund_on_crit', value: 0.30 } },
  { id: 'aff_low_cost_low_hp', tier: 3, cat: 'resource', weight: 4,  label: 'Desperate',         effect: { type: 'low_hp_cost_reduction', threshold: 0.25, value: 0.50 } },

  // ── ELEMENTAL (8) ──
  { id: 'aff_add_fire_1',      tier: 1, cat: 'elemental', weight: 12, label: 'Fiery',       effect: { type: 'add_flat_damage', element: 'fire', value: 8 } },
  { id: 'aff_add_ice_1',       tier: 1, cat: 'elemental', weight: 12, label: 'Icy',         effect: { type: 'add_flat_damage', element: 'ice', value: 8, slow_chance: 0.10 } },
  { id: 'aff_add_lightning_1', tier: 1, cat: 'elemental', weight: 12, label: 'Crackling',   effect: { type: 'add_flat_damage', element: 'lightning', value: 8 } },
  { id: 'aff_add_poison_1',    tier: 1, cat: 'elemental', weight: 10, label: 'Venomous',    effect: { type: 'add_dot', element: 'poison', value: 4, duration: 3 } },
  { id: 'aff_add_holy_1',      tier: 2, cat: 'elemental', weight: 7,  label: 'Sacred',      effect: { type: 'add_flat_damage', element: 'holy', value: 10, undead_mult: 2.0 } },
  { id: 'aff_add_shadow_1',    tier: 2, cat: 'elemental', weight: 7,  label: 'Dark',        effect: { type: 'add_flat_damage', element: 'shadow', value: 10 } },
  { id: 'aff_element_convert', tier: 3, cat: 'elemental', weight: 3,  label: 'Elemental',   effect: { type: 'random_element_convert' } },
  { id: 'aff_multi_element',   tier: 3, cat: 'elemental', weight: 3,  label: 'Prismatic',   effect: { type: 'split_element_damage', elements: 2 } },

  // ── UTILITY (10) ──
  { id: 'aff_heal_on_use_1',   tier: 1, cat: 'utility', weight: 12, label: 'Mending',       effect: { type: 'self_heal_on_cast', value: 15 } },
  { id: 'aff_heal_on_use_2',   tier: 2, cat: 'utility', weight: 7,  label: 'Restorative',   effect: { type: 'self_heal_on_cast', value: 30 } },
  { id: 'aff_shield_on_use_1', tier: 1, cat: 'utility', weight: 10, label: 'Warding',       effect: { type: 'shield_on_cast', value: 20 } },
  { id: 'aff_summon_1',        tier: 3, cat: 'utility', weight: 3,  label: 'Conjuring',     effect: { type: 'summon_minor_ally_on_cast', chance: 0.15 } },
  { id: 'aff_turret_multishot', tier: 2, cat: 'utility', weight: 4,  label: 'Multi-Barrel',  effect: { type: 'turret_extra_target', value: 1 } },
  { id: 'aff_turret_lifedrain', tier: 2, cat: 'on_hit',  weight: 3,  label: 'Lifedrain',     effect: { type: 'turret_lifedrain',    value: 0.10 } },
  { id: 'aff_turret_fortify',   tier: 2, cat: 'utility', weight: 3,  label: 'Fortifying',    effect: { type: 'turret_fortify_bonus', value: 0.20 } },
  { id: 'aff_tile_effect_1',   tier: 2, cat: 'utility', weight: 6,  label: 'Environmental', effect: { type: 'leave_ground_effect_on_cast' } },
  { id: 'aff_spread_shot',     tier: 2, cat: 'utility', weight: 6,  label: 'Scattering',    effect: { type: 'spread_shot', count: 3, damageMult: 0.50 } },
  { id: 'aff_echo_1',          tier: 3, cat: 'utility', weight: 4,  label: 'Resonant',      effect: { type: 'free_recast_chance', value: 0.15 } },
  { id: 'aff_apply_regen_1',   tier: 2, cat: 'utility', weight: 7,  label: 'Nurturing',     effect: { type: 'apply_regen_on_cast', value: 2, duration: 3 } },
  { id: 'aff_threat_reduce',   tier: 1, cat: 'utility', weight: 10, label: 'Subtle',        effect: { type: 'threat_reduction', value: 0.20 } },
  { id: 'aff_reveal_1',        tier: 1, cat: 'utility', weight: 8,  label: 'Revealing',     effect: { type: 'reveal_hidden_on_cast', radius: 3 } },
  { id: 'aff_luck_1',          tier: 1, cat: 'utility', weight: 8,  label: 'Lucky',         effect: { type: 'luck_bonus', value: 0.03 } },
  { id: 'aff_luck_2',          tier: 2, cat: 'utility', weight: 5,  label: 'Fortunate',     effect: { type: 'luck_bonus', value: 0.06 } },

  // ── EVO-LINKED (5) ── rare+ only
  { id: 'aff_evo_xp_1',        tier: 2, cat: 'evo_linked', weight: 8,  label: 'Awakening',       effect: { type: 'evo_xp_bonus', value: 0.25 } },
  { id: 'aff_fusion_bonus_1',  tier: 2, cat: 'evo_linked', weight: 6,  label: 'Forged',          effect: { type: 'fusion_value_bonus', value: 0.10 } },
  { id: 'aff_mutation_affinity',tier: 3, cat: 'evo_linked', weight: 3,  label: 'Destined',        effect: { type: 'next_mutation_min_tier', value: 2 } },
  { id: 'aff_viral_1',         tier: 3, cat: 'evo_linked', weight: 3,  label: 'Spreading',       effect: { type: 'viral_spread_speed', value: 0.15 } },
  { id: 'aff_stage_bonus_1',   tier: 2, cat: 'evo_linked', weight: 5,  label: 'Blooming',        effect: { type: 'evo_stage_value_bonus', value: 0.05 } },

  // ── MULTI-TARGET / AOE (9) ── scales heals/skills exponentially with stacks
  { id: 'aff_extra_target_1',  tier: 1, cat: 'aoe', weight: 12, label: 'Seeking',     effect: { type: 'extra_targets', value: 1 },  itemSlots: ['weapon', 'ring', 'scroll'] },
  { id: 'aff_extra_target_2',  tier: 2, cat: 'aoe', weight: 7,  label: 'Multiseeking',effect: { type: 'extra_targets', value: 2 },  itemSlots: ['weapon', 'ring', 'scroll'] },
  { id: 'aff_extra_target_3',  tier: 3, cat: 'aoe', weight: 4,  label: 'Omniseeking', effect: { type: 'extra_targets', value: 4 },  itemSlots: ['weapon', 'ring', 'scroll'] },
  { id: 'aff_aoe_2',           tier: 2, cat: 'aoe', weight: 7,  label: 'Erupting',    effect: { type: 'aoe_radius_bonus', value: 2 }, itemSlots: ['scroll'] },
  { id: 'aff_aoe_cleave',      tier: 3, cat: 'aoe', weight: 4,  label: 'Cleaving',    effect: { type: 'aoe_cleave', count: 3, damageMult: 0.60 } },
  { id: 'aff_heal_bounce_1',   tier: 1, cat: 'aoe', weight: 12, label: 'Bouncing',    effect: { type: 'heal_bounce', bounces: 1, falloff: 0.75 }, itemSlots: ['ring', 'scroll'] },
  { id: 'aff_heal_bounce_2',   tier: 2, cat: 'aoe', weight: 7,  label: 'Cascading',   effect: { type: 'heal_bounce', bounces: 3, falloff: 0.70 }, itemSlots: ['ring', 'scroll'] },
  { id: 'aff_heal_nova',       tier: 3, cat: 'aoe', weight: 4,  label: 'Radiant',     effect: { type: 'heal_nova', radius: 2, healMult: 0.50 }, itemSlots: ['ring', 'scroll'] },
  { id: 'aff_mass_effect',     tier: 3, cat: 'aoe', weight: 4,  label: 'Massive',     effect: { type: 'mass_effect', targetAll: true, damageMult: 0.40 } },

  // ── PUSH / PULL (8) ──
  { id: 'aff_knockback_2',     tier: 2, cat: 'push_pull', weight: 7,  label: 'Repelling',  effect: { type: 'knockback_on_hit', tiles: 2 }, itemSlots: ['weapon'] },
  { id: 'aff_push_wave',       tier: 3, cat: 'push_pull', weight: 4,  label: 'Detonating', effect: { type: 'push_wave_on_cast', tiles: 2, radius: 2 } },
  { id: 'aff_pp_pull_1',       tier: 1, cat: 'push_pull', weight: 10, label: 'Magnetic',   effect: { type: 'pull_on_hit', tiles: 1 }, itemSlots: ['weapon', 'ring'] },
  { id: 'aff_pull_2',          tier: 2, cat: 'push_pull', weight: 7,  label: 'Gravitating',effect: { type: 'pull_on_hit', tiles: 2 }, itemSlots: ['weapon', 'ring'] },
  { id: 'aff_gravity_well',    tier: 3, cat: 'push_pull', weight: 4,  label: 'Collapsing', effect: { type: 'gravity_well_on_cast', radius: 3, tiles: 2 } },
  { id: 'aff_displace',        tier: 2, cat: 'push_pull', weight: 6,  label: 'Displacing', effect: { type: 'displace_on_hit', range: 3 } },
  { id: 'aff_pin',             tier: 2, cat: 'push_pull', weight: 7,  label: 'Pinning',    effect: { type: 'pin_on_hit', duration: 2 } },
  { id: 'aff_launch',          tier: 3, cat: 'push_pull', weight: 4,  label: 'Launching',  effect: { type: 'launch_on_hit', tiles: 3, landDamage: 15 } },

  // ── PROJECTILE / CHAIN (8) ── chain shot, pierce, bounce, fork
  { id: 'aff_proj_pierce_1',   tier: 1, cat: 'projectile', weight: 12, label: 'Piercing',   effect: { type: 'projectile_pierce', count: 1 }, itemSlots: ['weapon', 'scroll'] },
  { id: 'aff_pierce_2',        tier: 2, cat: 'projectile', weight: 7,  label: 'Lancing',    effect: { type: 'projectile_pierce', count: 3 }, itemSlots: ['weapon', 'scroll'] },
  { id: 'aff_bounce_1',        tier: 1, cat: 'projectile', weight: 12, label: 'Ricocheting', effect: { type: 'projectile_bounce', bounces: 1, damageMult: 0.85 }, itemSlots: ['weapon'] },
  { id: 'aff_bounce_2',        tier: 2, cat: 'projectile', weight: 7,  label: 'Rebounding',  effect: { type: 'projectile_bounce', bounces: 3, damageMult: 0.75 }, itemSlots: ['weapon'] },
  { id: 'aff_fork_1',          tier: 2, cat: 'projectile', weight: 7,  label: 'Forking',    effect: { type: 'projectile_fork', count: 2, damageMult: 0.70 }, itemSlots: ['weapon', 'scroll'] },
  { id: 'aff_fork_2',          tier: 3, cat: 'projectile', weight: 4,  label: 'Splitting',  effect: { type: 'projectile_fork', count: 3, damageMult: 0.60 }, itemSlots: ['weapon', 'scroll'] },
  { id: 'aff_seeking_proj',    tier: 2, cat: 'projectile', weight: 7,  label: 'Homing',     effect: { type: 'projectile_homing', lockRange: 6 }, itemSlots: ['weapon'] },
  { id: 'aff_chain_shot',      tier: 2, cat: 'projectile', weight: 7,  label: 'Chain-shot', effect: { type: 'chain_shot', bounces: 2, damageMult: 0.80 }, itemSlots: ['weapon', 'scroll'] },

  // ── PASSIVE RIDERS (20) ── active cards only, drawn from rollPassiveRider()
  { id: 'aff_ride_hp_regen_1',     tier: 1, cat: 'passive_rider', weight: 18, label: 'of Vitality',     effect: { type: 'hp_regen', value: 1 } },
  { id: 'aff_ride_hp_regen_2',     tier: 2, cat: 'passive_rider', weight: 10, label: 'of Regeneration', effect: { type: 'hp_regen', value: 3 } },
  { id: 'aff_ride_mana_regen_1',   tier: 1, cat: 'passive_rider', weight: 16, label: 'of Focus',        effect: { type: 'mana_regen', value: 1 } },
  { id: 'aff_ride_mana_regen_2',   tier: 2, cat: 'passive_rider', weight: 10, label: 'of Clarity',      effect: { type: 'mana_regen', value: 2 } },
  { id: 'aff_ride_crit_1',         tier: 1, cat: 'passive_rider', weight: 16, label: 'of the Hawk',     effect: { type: 'crit_bonus', value: 0.02 } },
  { id: 'aff_ride_crit_2',         tier: 2, cat: 'passive_rider', weight: 9,  label: 'of the Eagle',    effect: { type: 'crit_bonus', value: 0.04 } },
  { id: 'aff_ride_dodge_1',        tier: 1, cat: 'passive_rider', weight: 14, label: 'of the Wind',     effect: { type: 'dodge_bonus', value: 0.03 } },
  { id: 'aff_ride_armor_1',        tier: 1, cat: 'passive_rider', weight: 14, label: 'of Stone',        effect: { type: 'armor_bonus', value: 3 } },
  { id: 'aff_ride_magic_resist_1', tier: 1, cat: 'passive_rider', weight: 14, label: 'of the Ward',     effect: { type: 'magic_resist', value: 0.04 } },
  { id: 'aff_ride_speed_1',        tier: 1, cat: 'passive_rider', weight: 14, label: 'of Swiftness',    effect: { type: 'speed_bonus', value: 0.05 } },
  { id: 'aff_ride_xp_1',           tier: 1, cat: 'passive_rider', weight: 12, label: 'of Learning',     effect: { type: 'xp_bonus_all', value: 0.05 } },
  { id: 'aff_ride_resource_max_1', tier: 1, cat: 'passive_rider', weight: 12, label: 'of the Deep',     effect: { type: 'resource_pool_bonus', value: 10 } },
  { id: 'aff_ride_loot_1',         tier: 2, cat: 'passive_rider', weight: 8,  label: 'of Fortune',      effect: { type: 'loot_bonus', value: 0.08 } },
  { id: 'aff_ride_stamina_regen_1',tier: 1, cat: 'passive_rider', weight: 14, label: 'of Endurance',    effect: { type: 'stamina_regen', value: 1 } },
  { id: 'aff_ride_crit_dmg_1',     tier: 2, cat: 'passive_rider', weight: 8,  label: 'of the Predator', effect: { type: 'crit_damage_bonus', value: 0.10 } },
  { id: 'aff_ride_stealth_1',      tier: 2, cat: 'passive_rider', weight: 8,  label: 'of Shadows',      effect: { type: 'stealth_bonus', value: 0.06 } },
  { id: 'aff_ride_healing_power_1',tier: 2, cat: 'passive_rider', weight: 8,  label: 'of the Mender',   effect: { type: 'healing_power_bonus', value: 0.10 } },
  { id: 'aff_ride_craft_speed_1',  tier: 1, cat: 'passive_rider', weight: 10, label: 'of the Artisan',  effect: { type: 'craft_speed_bonus', value: 0.10 } },
  { id: 'aff_ride_gather_1',       tier: 1, cat: 'passive_rider', weight: 10, label: 'of the Harvest',  effect: { type: 'gather_bonus', value: 0.08 } },
  { id: 'aff_ride_resist_all_1',   tier: 3, cat: 'passive_rider', weight: 4,  label: 'of the Bulwark',  effect: { type: 'all_resistance_bonus', value: 5 } },
];

// Affix counts per rarity (non-rider affixes)
var AFFIX_COUNT_BY_RARITY = {
  common:      0,
  uncommon:    1,
  rare:        2,
  ultra_rare:  3,
  mythic_rare: 3,
  legendary:   2,
  godly:       3,
  relic:       3,
};

// Minimum affix tier per rarity (0 = no constraint)
var AFFIX_MIN_TIER_BY_RARITY = {
  mythic_rare: 2,
  relic:       3,
};

// Passive rider chance per rarity (active cards only)
var PASSIVE_RIDER_CHANCE = {
  rare:        0.30,
  ultra_rare:  0.60,
  mythic_rare: 1.0,
  legendary:   1.0,
  godly:       1.0,
  relic:       1.0,
};

// Passive rider min tier for relic
var PASSIVE_RIDER_MIN_TIER = { relic: 2 };

// ---------------------------------------------------------------------------
// COMBO_POOL: triggered when a card has matching affix combinations.
// Combos are stored in card.combos[] and their effects pushed into card.effects[].
// Two trigger types:
//   requires: [[group1_ids], [group2_ids], ...] — card must have 1+ from EACH group
//   requiresStacks: [{id, minStacks}] — card must have id with stacks >= minStacks
// ---------------------------------------------------------------------------
var COMBO_POOL = [
  // ── Elemental Synergies ──
  { id: 'combo_stormfire',      label: 'Stormfire',       tier: 2,
    requires: [['aff_add_fire_1','aff_burn_1'],['aff_add_lightning_1']],
    effect: { type: 'combo_stormfire', bonus_dmg_to_burning: 0.30, burn_chain_spreads: true },
    description: '+30% dmg vs burning. Burn spreads to chained/bounced targets.' },
  { id: 'combo_glacial_venom',  label: 'Glacial Venom',   tier: 2,
    requires: [['aff_add_ice_1','aff_chill_1'],['aff_add_poison_1','aff_poison_1']],
    effect: { type: 'combo_glacial_venom', slow_dot_mult: 1.50, ice_vs_poisoned_bonus: 0.50 },
    description: '+50% poison DoT on slowed targets. +50% ice dmg vs poisoned targets.' },
  { id: 'combo_toxic_inferno',  label: 'Toxic Inferno',   tier: 2,
    requires: [['aff_add_fire_1','aff_burn_1'],['aff_add_poison_1','aff_poison_1']],
    effect: { type: 'combo_toxic_inferno', burn_amplifies_poison: 0.50, poison_death_ignites: true },
    description: 'Burn amplifies poison DoT 50%. Poisoned-death ignites nearby enemies.' },
  { id: 'combo_voltox',         label: 'Voltox',          tier: 2,
    requires: [['aff_add_lightning_1'],['aff_add_poison_1','aff_poison_1']],
    effect: { type: 'combo_voltox', stun_poisons: true, poison_conducts_lightning_pct: 0.25 },
    description: 'Stunned targets are poisoned. Poisoned targets conduct 25% lightning to nearby.' },
  { id: 'combo_steam_burst',    label: 'Steam Burst',     tier: 3,
    requires: [['aff_add_fire_1','aff_burn_1'],['aff_add_ice_1','aff_chill_1']],
    effect: { type: 'combo_steam_burst', explosion_base: 25, explosion_radius: 1 },
    description: 'Fire+Ice cancel on impact → Steam Burst: 25 AoE dmg radius 1.' },
  { id: 'combo_void_faith',     label: 'Void Faith',      tier: 3,
    requires: [['aff_add_holy_1'],['aff_add_shadow_1']],
    effect: { type: 'combo_void_faith', resist_bypass: 0.50, all_dmg_bonus: 0.20 },
    description: 'Bypass 50% resistances. +20% all damage types.' },
  { id: 'combo_frostbolt',      label: 'Frostbolt',       tier: 2,
    requires: [['aff_add_ice_1','aff_chill_1'],['aff_add_lightning_1']],
    effect: { type: 'combo_frostbolt', frozen_lightning_bonus: 0.50 },
    description: 'Slowed/frozen targets take +50% lightning damage.' },
  { id: 'combo_apocalypse',     label: 'Apocalypse',      tier: 3,
    requires: [['aff_add_fire_1','aff_burn_1'],['aff_add_lightning_1'],['aff_add_poison_1','aff_add_shadow_1']],
    effect: { type: 'combo_apocalypse', all_elements_on_hit: true, per_element_bonus: 0.20 },
    description: '3 elements fire simultaneously. +20% per extra element hit.' },

  // ── Lifesteal Synergies ──
  { id: 'combo_hemorrhagic_feed', label: 'Hemorrhagic Feed', tier: 2,
    requires: [['aff_lifesteal_1','aff_lifesteal_2'],['aff_bleed_1','aff_bleed_2']],
    effect: { type: 'combo_hemorrhagic_feed', lifesteal_vs_bleeding_mult: 2.0 },
    description: 'Lifesteal doubled against bleeding targets.' },
  { id: 'combo_sanguine_flame', label: 'Sanguine Flame',   tier: 2,
    requires: [['aff_lifesteal_1','aff_lifesteal_2'],['aff_burn_1','aff_add_fire_1']],
    effect: { type: 'combo_sanguine_flame', heal_per_burn_tick_pct: 0.50 },
    description: 'Heal for 50% of each burn tick dealt.' },
  { id: 'combo_vampire_grip',   label: "Vampire's Grip",   tier: 2,
    requires: [['aff_lifesteal_1','aff_lifesteal_2'],['aff_stun_1']],
    effect: { type: 'combo_vampire_grip', stun_chance_bonus: 0.10, lifesteal_on_stun: 0.30 },
    description: '+10% stun chance. On stun: heal 30% of max lifesteal.' },

  // ── Stack Combos (same affix × 2+) ──
  { id: 'combo_hemorrhage',     label: 'Hemorrhage',      tier: 2,
    requiresStacks: [{ id: 'aff_bleed_1', minStacks: 2 }],
    effect: { type: 'combo_hemorrhage', bleed_duration_bonus: 2, bleed_spreads_on_death: true },
    description: 'Bleed +2 turns. Bleeding enemies spread bleed on death.' },
  { id: 'combo_conflagration',  label: 'Conflagration',   tier: 2,
    requiresStacks: [{ id: 'aff_burn_1', minStacks: 2 }],
    effect: { type: 'combo_conflagration', burn_spreads_to_adjacent: true, burn_dmg_bonus: 0.50 },
    description: 'Burn spreads to adjacent enemies. Burn DoT +50%.' },
  { id: 'combo_virulent_plague',label: 'Virulent Plague',  tier: 3,
    requiresStacks: [{ id: 'aff_poison_1', minStacks: 2 }],
    effect: { type: 'combo_virulent_plague', poison_dmg_mult: 2.0, spreads_on_death: true },
    description: 'Poison DoT ×2. Poisoned enemies spread plague on death.' },
  { id: 'combo_annihilation',   label: 'Annihilation',    tier: 3,
    requiresStacks: [{ id: 'aff_spell_dmg_1', minStacks: 2 }],
    effect: { type: 'combo_annihilation', spell_crit_dmg_bonus: 0.50 },
    description: 'Spell crits deal +50% damage.' },
  { id: 'combo_gravity_collapse',label: 'Gravity Collapse', tier: 3,
    requiresStacks: [{ id: 'aff_pull_1', minStacks: 2 }],
    effect: { type: 'combo_gravity_collapse', pull_radius: 3, collide_damage: 20 },
    description: 'Pull AoE radius 3. Enemies colliding with walls/each other take 20 dmg.' },

  // ── Positional / Movement ──
  { id: 'combo_pinball',        label: 'Pinball',         tier: 2,
    requires: [['aff_knockback_1','aff_knockback_2'],['aff_chain_1','aff_chain_2','aff_chain_shot']],
    effect: { type: 'combo_pinball', knockback_triggers_chain: true },
    description: 'Each knockback triggers a free chain to a new target.' },
  { id: 'combo_wrecking_ball',  label: 'Wrecking Ball',   tier: 2,
    requires: [['aff_knockback_1','aff_knockback_2'],['aff_aoe_1','aff_aoe_2']],
    effect: { type: 'combo_wrecking_ball', launched_aoe_on_land: 15 },
    description: 'Knocked-back enemies deal 15 AoE dmg at their landing spot.' },
  { id: 'combo_vortex_pull',    label: 'Vortex Pull',     tier: 3,
    requires: [['aff_pull_1','aff_pull_2','aff_gravity_well'],['aff_aoe_1','aff_aoe_2']],
    effect: { type: 'combo_vortex_pull', grouped_bonus_dmg: 0.30, pull_fires_first: true },
    description: 'Pull then AoE. Grouped enemies take +30% AoE damage.' },

  // ── Multi-target Scaling ──
  { id: 'combo_plague_spread',  label: 'Plague Spread',   tier: 2,
    requires: [['aff_extra_target_1','aff_extra_target_2'],['aff_add_poison_1','aff_poison_1']],
    effect: { type: 'combo_plague_spread', poison_double_on_extra_target: true },
    description: 'Each extra target hit receives double poison stacks.' },
  { id: 'combo_mass_heal',      label: 'Mass Heal',       tier: 2,
    requires: [['aff_extra_target_1','aff_extra_target_2'],['aff_heal_bounce_1','aff_heal_bounce_2']],
    effect: { type: 'combo_mass_heal', heal_no_falloff: true },
    description: 'Heal bounces + extra targets — no falloff. All receive full heal value.' },
  { id: 'combo_lightning_storm',label: 'Lightning Storm',  tier: 3,
    requires: [['aff_add_lightning_1'],['aff_chain_1','aff_chain_2','aff_chain_shot'],['aff_extra_target_1','aff_extra_target_2']],
    effect: { type: 'combo_lightning_storm', arc_count_bonus: 3, arc_dmg_escalates: 0.15 },
    description: '+3 arcs. Each consecutive arc deals +15% more damage.' },
  { id: 'combo_projectile_storm',label: 'Projectile Storm', tier: 3,
    requires: [['aff_bounce_1','aff_bounce_2'],['aff_fork_1','aff_fork_2']],
    effect: { type: 'combo_projectile_storm', fork_also_bounces: true, chain_bonus_dmg: 0.10 },
    description: 'Forked projectiles also bounce. Each bounce/fork deals +10% more damage.' },

  // ── Resource + Damage ──
  { id: 'combo_echo_storm',     label: 'Echo Storm',      tier: 3,
    requires: [['aff_double_cast'],['aff_chain_1','aff_chain_2']],
    effect: { type: 'combo_echo_storm', double_cast_also_chains: true },
    description: 'When double cast procs, the echo also chains.' },
  { id: 'combo_death_mark',     label: 'Death Mark',      tier: 3,
    requires: [['aff_execute_1'],['aff_bleed_1','aff_bleed_2']],
    effect: { type: 'combo_death_mark', execute_bleed_chance: 1.0, execute_dmg_mult: 2.0 },
    description: 'Below execute threshold: 100% bleed, execute dmg ×2.' },
  { id: 'combo_torrent',        label: 'Torrent',         tier: 3,
    requires: [['aff_free_cast_1','aff_free_cast_2'],['aff_cd_1','aff_cd_2']],
    effect: { type: 'combo_torrent', after_free_cast_next_free_pct: 0.50 },
    description: 'After a free cast, next cast has 50% free cast chance.' },
];

// ---------------------------------------------------------------------------
// Affix helper functions
// ---------------------------------------------------------------------------

// rollCardAffixes(template, rarity): returns array of affix meta objects, each with stacks:1.
// Filters out passive_rider category. Respects tier constraints.
function rollCardAffixes(template, rarity) {
  var count = AFFIX_COUNT_BY_RARITY[rarity] || 0;
  if (count === 0) return [];
  var minTier = AFFIX_MIN_TIER_BY_RARITY[rarity] || 1;

  // Build eligible pool (exclude passive_rider + item-only tagging doesn't restrict here)
  var eligible = [];
  for (var i = 0; i < AFFIX_POOL.length; i++) {
    var a = AFFIX_POOL[i];
    if (a.cat === 'passive_rider') continue;
    if (a.tier < minTier) continue;
    eligible.push(a);
  }

  var result = [];
  var usedIds = {};
  for (var s = 0; s < count; s++) {
    var pool = [];
    var totalWeight = 0;
    for (var j = 0; j < eligible.length; j++) {
      if (!usedIds[eligible[j].id]) {
        pool.push(eligible[j]);
        totalWeight += eligible[j].weight;
      }
    }
    if (pool.length === 0) break;
    var roll = Math.random() * totalWeight;
    var cumulative = 0;
    for (var k = 0; k < pool.length; k++) {
      cumulative += pool[k].weight;
      if (roll < cumulative) {
        result.push(pool[k]);
        usedIds[pool[k].id] = true;
        break;
      }
    }
  }
  // Return as meta with stacks:1 for fresh card
  return result.map(function(a) { return { id: a.id, label: a.label, tier: a.tier, cat: a.cat, stacks: 1 }; });
}

// rollPassiveRider(rarity): returns one passive rider affix or null.
function rollPassiveRider(rarity) {
  var minTier = PASSIVE_RIDER_MIN_TIER[rarity] || 1;
  var pool = [];
  var totalWeight = 0;
  for (var i = 0; i < AFFIX_POOL.length; i++) {
    var a = AFFIX_POOL[i];
    if (a.cat !== 'passive_rider') continue;
    if (a.tier < minTier) continue;
    pool.push(a);
    totalWeight += a.weight;
  }
  if (pool.length === 0) return null;
  var roll = Math.random() * totalWeight;
  var cumulative = 0;
  for (var j = 0; j < pool.length; j++) {
    cumulative += pool[j].weight;
    if (roll < cumulative) return pool[j];
  }
  return pool[pool.length - 1];
}

// rollItemAffixes(itemType, rarity): returns affix meta array for an item.
// itemType: 'weapon' | 'armor' | 'ring' | 'scroll'
function rollItemAffixes(itemType, rarity) {
  var count = AFFIX_COUNT_BY_RARITY[rarity] || 0;
  if (count === 0) return [];
  var minTier = AFFIX_MIN_TIER_BY_RARITY[rarity] || 1;

  var eligible = [];
  for (var i = 0; i < AFFIX_POOL.length; i++) {
    var a = AFFIX_POOL[i];
    if (a.cat === 'passive_rider' || a.cat === 'evo_linked') continue;
    if (a.tier < minTier) continue;
    // Respect itemSlots filter: if present, item type must be listed
    if (a.itemSlots && a.itemSlots.indexOf(itemType) < 0) continue;
    eligible.push(a);
  }

  var result = [];
  var usedIds = {};
  for (var s = 0; s < count; s++) {
    var pool = [];
    var totalWeight = 0;
    for (var j = 0; j < eligible.length; j++) {
      if (!usedIds[eligible[j].id]) {
        pool.push(eligible[j]);
        totalWeight += eligible[j].weight;
      }
    }
    if (pool.length === 0) break;
    var roll = Math.random() * totalWeight;
    var cumulative = 0;
    for (var k = 0; k < pool.length; k++) {
      cumulative += pool[k].weight;
      if (roll < cumulative) {
        result.push(pool[k]);
        usedIds[pool[k].id] = true;
        break;
      }
    }
  }
  return result.map(function(a) { return { id: a.id, label: a.label, tier: a.tier, cat: a.cat, stacks: 1 }; });
}

// computeCardCombos(affixes, passiveRider): returns active combo list based on card's affixes.
// Each result: { id, label, tier, effect, description }
function computeCardCombos(affixes, passiveRider) {
  if (!affixes || affixes.length === 0) return [];

  // Build stacks map: affixId → total stacks
  var stacks = {};
  for (var i = 0; i < affixes.length; i++) {
    var aff = affixes[i];
    stacks[aff.id] = (stacks[aff.id] || 0) + (aff.stacks || 1);
  }
  // Include passive rider id in stacks for rider-based combos
  if (passiveRider) stacks[passiveRider.id] = (stacks[passiveRider.id] || 0) + 1;

  var active = [];
  for (var ci = 0; ci < COMBO_POOL.length; ci++) {
    var combo = COMBO_POOL[ci];
    var triggered = false;

    // requiresStacks check
    if (combo.requiresStacks) {
      triggered = true;
      for (var rs = 0; rs < combo.requiresStacks.length; rs++) {
        var req = combo.requiresStacks[rs];
        if ((stacks[req.id] || 0) < req.minStacks) { triggered = false; break; }
      }
    }

    // requires groups check (each group: need at least one affix id present)
    if (!triggered && combo.requires) {
      triggered = true;
      for (var rg = 0; rg < combo.requires.length; rg++) {
        var group = combo.requires[rg];
        var hasAny = false;
        for (var gi = 0; gi < group.length; gi++) {
          if (stacks[group[gi]]) { hasAny = true; break; }
        }
        if (!hasAny) { triggered = false; break; }
      }
    }

    if (triggered) {
      active.push({
        id: combo.id, label: combo.label, tier: combo.tier,
        effect: JSON.parse(JSON.stringify(combo.effect)),
        description: combo.description,
      });
    }
  }
  return active;
}

// refreshCardEffects(card): rebuilds card.effects[] from _baseEffects + affixes (×stacks) +
// passiveRider + combos. Also recomputes card.combos[].
// Call after any affix/rider/combo change: fusion, evo stage, addAffixToCard.
function refreshCardEffects(card) {
  if (!card) return;

  // Get base effects — prefer stored _baseEffects over template lookup
  var baseEffects;
  if (card._baseEffects) {
    baseEffects = JSON.parse(JSON.stringify(card._baseEffects));
  } else {
    var tmpl = CARD_BY_ID[card.cardId];
    if (!tmpl) return;
    baseEffects = JSON.parse(JSON.stringify(tmpl.effects));
    // Apply rarity scaling for scalable cards
    if (tmpl.rarityScalable && card.rarity !== tmpl.rarity) {
      var bf = RARITY_SCALE[tmpl.rarity] || 1.0;
      var tf = RARITY_SCALE[card.rarity] || 1.0;
      var sf = tf / bf;
      if (sf > 1.0) {
        for (var si = 0; si < baseEffects.length; si++) {
          if (typeof baseEffects[si].value === 'number') baseEffects[si].value = _scaleNumeric(baseEffects[si].value, sf);
          if (typeof baseEffects[si].base === 'number') baseEffects[si].base = _scaleNumeric(baseEffects[si].base, sf);
        }
      }
    }
    if (card.style === 'void') {
      for (var vi = 0; vi < baseEffects.length; vi++) {
        if (typeof baseEffects[vi].value === 'number') baseEffects[vi].value = Math.round(baseEffects[vi].value * 1.10 * 100) / 100;
        if (typeof baseEffects[vi].base === 'number') baseEffects[vi].base = Math.round(baseEffects[vi].base * 1.10);
      }
    }
  }

  var effects = baseEffects;

  // Push affix effects — each stack pushes one copy (additive stacking)
  var affixes = card.affixes || [];
  for (var aj = 0; aj < affixes.length; aj++) {
    var aff = affixes[aj];
    var affStacks = aff.stacks || 1;
    var affEntry = null;
    for (var ak = 0; ak < AFFIX_POOL.length; ak++) {
      if (AFFIX_POOL[ak].id === aff.id) { affEntry = AFFIX_POOL[ak]; break; }
    }
    if (!affEntry) continue;
    for (var s = 0; s < affStacks; s++) {
      effects.push(JSON.parse(JSON.stringify(affEntry.effect)));
    }
  }

  // Push passive rider
  if (card.passiveRider) {
    for (var ri = 0; ri < AFFIX_POOL.length; ri++) {
      if (AFFIX_POOL[ri].id === card.passiveRider.id) {
        effects.push(JSON.parse(JSON.stringify(AFFIX_POOL[ri].effect)));
        break;
      }
    }
  }

  // Compute combos and push their effects
  var combos = computeCardCombos(affixes, card.passiveRider);
  card.combos = combos;
  for (var ci = 0; ci < combos.length; ci++) {
    effects.push(JSON.parse(JSON.stringify(combos[ci].effect)));
  }

  // Re-apply mutation effects from card.mutations metadata (pool lookup)
  if (card.mutations && card.mutations.length > 0) {
    for (var mi = 0; mi < card.mutations.length; mi++) {
      var mutId = card.mutations[mi].id;
      for (var mp = 0; mp < MUTATION_POOL.length; mp++) {
        if (MUTATION_POOL[mp].id === mutId) {
          effects.push(JSON.parse(JSON.stringify(MUTATION_POOL[mp].effect)));
          break;
        }
      }
    }
  }

  // Re-apply curse effects from card.curses metadata (pool lookup)
  if (card.curses && card.curses.length > 0) {
    for (var ki = 0; ki < card.curses.length; ki++) {
      var curseId = card.curses[ki].id;
      for (var cp = 0; cp < CARD_CURSE_POOL.length; cp++) {
        if (CARD_CURSE_POOL[cp].mutationId === curseId) {
          effects.push(JSON.parse(JSON.stringify(CARD_CURSE_POOL[cp].effect)));
          break;
        }
      }
    }
  }

  card.effects = effects;
}

// addAffixToCard(card, affixId): adds an affix by id, incrementing stacks if already present.
// Calls refreshCardEffects automatically. Returns true on success.
function addAffixToCard(card, affixId) {
  var affEntry = null;
  for (var i = 0; i < AFFIX_POOL.length; i++) {
    if (AFFIX_POOL[i].id === affixId) { affEntry = AFFIX_POOL[i]; break; }
  }
  if (!affEntry || affEntry.cat === 'passive_rider') return false;

  if (!card.affixes) card.affixes = [];
  var existing = null;
  for (var j = 0; j < card.affixes.length; j++) {
    if (card.affixes[j].id === affixId) { existing = card.affixes[j]; break; }
  }
  if (existing) {
    existing.stacks = (existing.stacks || 1) + 1;
  } else {
    card.affixes.push({ id: affEntry.id, label: affEntry.label, tier: affEntry.tier, cat: affEntry.cat, stacks: 1 });
  }
  refreshCardEffects(card);
  return true;
}

// rollEvoAffix(card): rolls one affix appropriate for evolution stage grants.
// Slightly biased toward higher tiers than a normal draw.
function rollEvoAffix(card) {
  var pool = [];
  var totalWeight = 0;
  for (var i = 0; i < AFFIX_POOL.length; i++) {
    var a = AFFIX_POOL[i];
    if (a.cat === 'passive_rider') continue;
    if (a.cat === 'evo_linked') continue; // evo-linked via mutations not evo grants
    var w = a.weight;
    // Tier bias for evo grants: boost tier 2+ weight slightly
    if (a.tier === 2) w = Math.round(w * 1.3);
    if (a.tier === 3) w = Math.round(w * 1.6);
    pool.push({ entry: a, weight: w });
    totalWeight += w;
  }
  if (pool.length === 0) return null;
  var roll = Math.random() * totalWeight;
  var cumulative = 0;
  for (var j = 0; j < pool.length; j++) {
    cumulative += pool[j].weight;
    if (roll < cumulative) return pool[j].entry;
  }
  return pool[pool.length - 1].entry;
}

// getAffixNamePrefix: returns a prefix label from the first offensive/elemental/on_hit/push_pull/projectile affix.
function getAffixNamePrefix(affixes) {
  if (!affixes || affixes.length === 0) return '';
  var prefixCats = { offensive: true, elemental: true, on_hit: true, push_pull: true, projectile: true };
  for (var i = 0; i < affixes.length; i++) {
    if (prefixCats[affixes[i].cat]) return affixes[i].label;
  }
  return '';
}

// getAffixNameSuffix: returns a suffix label from resource/utility/evo_linked/aoe affixes.
function getAffixNameSuffix(affixes) {
  if (!affixes || affixes.length === 0) return '';
  var suffixCats = { resource: true, utility: true, evo_linked: true, aoe: true };
  for (var i = 0; i < affixes.length; i++) {
    if (suffixCats[affixes[i].cat]) return affixes[i].label;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Card Fusion Logic
// ---------------------------------------------------------------------------

function canFuseCards(card1, card2) {
  if (!card1 || !card2) return { ok: false, error: 'Invalid cards' };
  if (card1.instanceId === card2.instanceId) return { ok: false, error: 'Cannot fuse a card with itself' };
  if (card1.rarity !== card2.rarity) return { ok: false, error: 'Cards must be the same rarity' };
  if (card1.rarity === 'relic') return { ok: false, error: 'Relic cards cannot be fused' };
  if (card1.fusionCount >= MAX_FUSION_COUNT) return { ok: false, error: 'Card 1 has reached max fusion count' };
  if (card2.fusionCount >= MAX_FUSION_COUNT) return { ok: false, error: 'Card 2 has reached max fusion count' };
  return { ok: true };
}

function fuseCards(card1, card2, racialBonus) {
  // racialBonus: optional { luckBonus, mutationChanceBonus } from caller's race data
  var check = canFuseCards(card1, card2);
  if (!check.ok) return { error: check.error };

  var currentRarity = RARITY_BY_ID[card1.rarity];
  if (!currentRarity || currentRarity.order >= RARITY_TIERS.length - 1) {
    return { error: 'Cannot fuse to higher rarity' };
  }
  var nextRarity = RARITY_TIERS[currentRarity.order + 1];
  var newFusionCount = Math.max(card1.fusionCount, card2.fusionCount) + 1;

  // Merge base effects only (not full effects[] which include affix contributions)
  var base1 = card1._baseEffects ? JSON.parse(JSON.stringify(card1._baseEffects)) : JSON.parse(JSON.stringify(card1.effects));
  var base2 = card2._baseEffects ? JSON.parse(JSON.stringify(card2._baseEffects)) : JSON.parse(JSON.stringify(card2.effects));
  var mergedBase;
  if (card1.type === card2.type && card1.cardId === card2.cardId) {
    // Same card: take max of each effect + 5% same-card bonus
    mergedBase = base1;
    for (var i = 0; i < mergedBase.length; i++) {
      if (typeof mergedBase[i].value === 'number') {
        var b2Val = (base2[i] && typeof base2[i].value === 'number') ? base2[i].value : 0;
        mergedBase[i].value = Math.round(Math.max(mergedBase[i].value, b2Val) * 1.05 * 100) / 100;
      }
      if (typeof mergedBase[i].base === 'number') {
        var b2Base = (base2[i] && typeof base2[i].base === 'number') ? base2[i].base : 0;
        mergedBase[i].base = Math.round(Math.max(mergedBase[i].base, b2Base) * 1.05);
      }
    }
  } else {
    // Different cards: true hybrid — merge both base effect sets
    mergedBase = base1;
    for (var j = 0; j < base2.length; j++) {
      var e2 = base2[j];
      var matchIdx = -1;
      for (var m = 0; m < mergedBase.length; m++) {
        var e1 = mergedBase[m];
        if (e1.type === e2.type &&
            (e1.stat || null) === (e2.stat || null) &&
            (e1.skill || null) === (e2.skill || null) &&
            (e1.element || null) === (e2.element || null)) {
          matchIdx = m;
          break;
        }
      }
      if (matchIdx >= 0) {
        if (typeof e2.value === 'number') mergedBase[matchIdx].value = Math.round(((mergedBase[matchIdx].value || 0) + e2.value) * 100) / 100;
        if (typeof e2.base === 'number') mergedBase[matchIdx].base = Math.round((mergedBase[matchIdx].base || 0) + e2.base);
      } else {
        mergedBase.push(e2);
      }
    }
  }

  // Apply fusion level bonus (+5% per fusion level) to base effects
  // Affix: fusion_value_bonus — boost fusion stat bonus from input cards
  var affixFusionBonus = 0;
  var _bothCards = [card1, card2];
  for (var _fbi = 0; _fbi < _bothCards.length; _fbi++) {
    var _fbc = _bothCards[_fbi];
    if (_fbc.affixes && Array.isArray(_fbc.affixes)) {
      for (var _fbj = 0; _fbj < _fbc.affixes.length; _fbj++) {
        if (_fbc.affixes[_fbj] && _fbc.affixes[_fbj].effect && _fbc.affixes[_fbj].effect.type === 'fusion_value_bonus') {
          affixFusionBonus += (_fbc.affixes[_fbj].effect.value || 0);
        }
      }
    }
  }
  var fusionBonus = 1 + (newFusionCount * 0.05) + affixFusionBonus;
  for (var k = 0; k < mergedBase.length; k++) {
    if (typeof mergedBase[k].value === 'number') mergedBase[k].value = Math.round(mergedBase[k].value * fusionBonus * 100) / 100;
    if (typeof mergedBase[k].base === 'number') mergedBase[k].base = Math.round(mergedBase[k].base * fusionBonus);
  }

  // Inherit best style from either card
  var STYLE_ORDER = ['normal', 'holographic', 'golden', 'prismatic', 'void'];
  var styleIdx1 = STYLE_ORDER.indexOf(card1.style || 'normal');
  var styleIdx2 = STYLE_ORDER.indexOf(card2.style || 'normal');
  var fusedStyle = STYLE_ORDER[Math.max(styleIdx1, styleIdx2)];
  var fusedBorderEffect = CARD_STYLES[fusedStyle] ? CARD_STYLES[fusedStyle].borderEffect : null;

  // Stack affixes: same id increments stacks, new ids are appended
  var mergedAffixes = JSON.parse(JSON.stringify(card1.affixes || []));
  var card2Affixes = card2.affixes || [];
  for (var _axi = 0; _axi < card2Affixes.length; _axi++) {
    var _ax2 = card2Affixes[_axi];
    var _axFound = false;
    for (var _axj = 0; _axj < mergedAffixes.length; _axj++) {
      if (mergedAffixes[_axj].id === _ax2.id) {
        mergedAffixes[_axj].stacks = (mergedAffixes[_axj].stacks || 1) + (_ax2.stacks || 1);
        _axFound = true;
        break;
      }
    }
    if (!_axFound) mergedAffixes.push(JSON.parse(JSON.stringify(_ax2)));
  }
  // Merge passive riders (keep card1's rider if present, otherwise card2's)
  var mergedRider = card1.passiveRider || card2.passiveRider || undefined;

  var isHybrid = card1.cardId !== card2.cardId;
  var fusedCard = {
    instanceId: crypto.randomBytes(8).toString('hex'),
    cardId: card1.cardId,
    name: isHybrid ? (card1.name + ' / ' + card2.name + ' +' + newFusionCount) : (card1.name + ' +' + newFusionCount),
    type: card1.type,
    isHybrid: isHybrid,
    hybridCardId: isHybrid ? card2.cardId : undefined,
    rarity: nextRarity.id,
    _baseEffects: mergedBase,
    effects: [],
    affixes: mergedAffixes,
    passiveRider: mergedRider,
    combos: [],
    icon: card1.icon,
    fusionCount: newFusionCount,
    fusionLineage: [card1.instanceId, card2.instanceId],
    obtainedAt: Date.now(),
    source: 'fusion',
    style: fusedStyle,
    borderEffect: fusedBorderEffect,
    serial: generateSerial(),
    // Evolution fields preserved from card1 (or reset for fresh fused cards)
    evolutionStage: card1.evolutionStage || 0,
    evolutionXp: 0,
    evolutionPath: null,
    evolutionBonusLevel: 0,
  };

  // Build effects[] and combos[] from _baseEffects + stacked affixes + rider
  refreshCardEffects(fusedCard);

  // Procedural mutation roll on fusion
  // Hybrid fusions get 12% base chance; same-type fusions get 8%
  var fusionMutationBase = isHybrid ? 0.12 : 0.08;
  // Apply racial mutation_chance_bonus (gnome: +5%)
  if (racialBonus && racialBonus.mutationChanceBonus) fusionMutationBase += racialBonus.mutationChanceBonus;
  // Accumulate luck from both input cards' effects + racial baseLuck
  var fusionLuck = 0;
  var allInputEffects = (card1.effects || []).concat(card2.effects || []);
  for (var fi = 0; fi < allInputEffects.length; fi++) {
    if (allInputEffects[fi].type === 'luck_bonus' || allInputEffects[fi].type === 'card_luck_bonus') {
      fusionLuck += (allInputEffects[fi].value || 0);
    }
  }
  if (racialBonus && racialBonus.luckBonus) fusionLuck += racialBonus.luckBonus;
  var fusionMutation = rollMutation(fusionMutationBase, fusionLuck);
  if (fusionMutation) {
    applyMutation(fusedCard, fusionMutation);
  }

  return { card: fusedCard, mutation: fusionMutation || null };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Rarity system
  RARITY_TIERS,
  RARITY_BY_ID,
  TOTAL_RARITY_WEIGHT,
  RARITY_SCALE,
  SOFT_PITY_START,
  HARD_PITY,
  SOFT_PITY_RATE,
  rollRarity,

  // Card types & templates
  CARD_TYPES,
  CARD_TEMPLATES,
  CARDS_BY_RARITY,
  CARD_BY_ID,

  // Card styles & serial
  CARD_STYLES,
  generateSerial,
  rollCardStyle,

  // Biome & mount helpers
  SKILL_BIOME_BONUS,
  WATER_MOUNTS,

  // Gacha rate disclosure
  RACE_POOL_BIAS,
  CATFOLK_RARITY_BUMP,
  computeEffectiveGachaRates,

  // Rift scars
  RIFT_SCAR_PREFIXES,
  RIFT_SCAR_SUFFIXES,
  getRiftScarCount,
  rollRiftScarPrefix,
  rollRiftScarSuffix,
  applyRiftScars,

  // Evolution config
  EVOLUTION_CONFIG,

  // Card pack constants
  CARDS_PER_PACK_MIN,
  CARDS_PER_PACK_MAX,
  MAX_ACTIVE_CARD_SLOTS,
  MAX_PASSIVE_CARD_SLOTS,
  MAX_EQUIPPED_CARDS,
  MAX_CARD_COLLECTION,
  MAX_FUSION_COUNT,

  // Card generation
  generateCardInstance,
  openCardPack,

  // Mutation system
  MUTATION_POOL,
  MUTATION_TIER_NAMES,
  rollMutation,
  applyMutation,

  // Curse system
  CARD_CURSE_POOL,
  rollCardCurse,
  applyCurse,
  cleanseCardCurse,

  // Affix system
  AFFIX_POOL,
  AFFIX_COUNT_BY_RARITY,
  PASSIVE_RIDER_CHANCE,
  rollCardAffixes,
  rollPassiveRider,
  getAffixNamePrefix,
  getAffixNameSuffix,

  // Combo system
  COMBO_POOL,
  computeCardCombos,
  refreshCardEffects,
  addAffixToCard,
  rollItemAffixes,
  rollEvoAffix,

  // Fusion
  canFuseCards,
  fuseCards,
};
