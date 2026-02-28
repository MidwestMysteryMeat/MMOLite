// mastery/mastery-effects.js — Effect type catalog for skill mastery trees.
// Each entry defines a unique bonus type, its display template, and default per-rank value.

var MASTERY_EFFECT_TYPES = {
  // Gathering
  skill_xp_pct:       { label: 'Skill XP',           desc: '+{v}% skill XP per rank',           format: 'pct' },
  yield_pct:          { label: 'Yield',               desc: '+{v}% resource yield per rank',     format: 'pct' },
  yield_flat:         { label: 'Bonus Yield',         desc: '+{v} bonus resource per rank',      format: 'flat' },
  double_drop_pct:    { label: 'Double Drop',         desc: '+{v}% double drop chance per rank', format: 'pct' },
  rare_find_pct:      { label: 'Rare Find',           desc: '+{v}% rare find chance per rank',   format: 'pct' },
  gather_speed_pct:   { label: 'Gather Speed',        desc: '+{v}% gathering speed per rank',    format: 'pct' },
  tool_durability_pct:{ label: 'Tool Durability',     desc: '+{v}% tool durability per rank',    format: 'pct' },
  quality_tier_pct:   { label: 'Quality Tier',        desc: '+{v}% quality upgrade chance per rank', format: 'pct' },
  masterwork_pct:     { label: 'Masterwork',          desc: '+{v}% masterwork chance per rank',  format: 'pct' },
  gem_chance_pct:     { label: 'Gem Chance',          desc: '+{v}% gem find chance per rank',    format: 'pct' },
  jackpot_pct:        { label: 'Jackpot',             desc: '+{v}% jackpot chance per rank',     format: 'pct' },

  // Crafting
  craft_quality_pct:  { label: 'Craft Quality',       desc: '+{v}% crafting quality per rank',   format: 'pct' },
  ingredient_save_pct:{ label: 'Ingredient Save',     desc: '+{v}% ingredient save chance per rank', format: 'pct' },
  double_craft_pct:   { label: 'Double Craft',        desc: '+{v}% double craft chance per rank', format: 'pct' },
  recipe_unlock_pct:  { label: 'Recipe Discovery',    desc: '+{v}% recipe discovery chance per rank', format: 'pct' },
  mutation_chance_pct: { label: 'Mutation Chance',     desc: '+{v}% craft mutation chance per rank', format: 'pct' },
  craft_speed_pct:    { label: 'Craft Speed',         desc: '+{v}% crafting speed per rank',     format: 'pct' },
  craft_crit_pct:     { label: 'Craft Crit',          desc: '+{v}% craft critical chance per rank', format: 'pct' },
  stat_bonus_pct:     { label: 'Stat Bonus',          desc: '+{v}% bonus stats on crafted items per rank', format: 'pct' },

  // Combat — melee/ranged
  damage_pct:         { label: 'Damage',              desc: '+{v}% damage per rank',             format: 'pct' },
  penetration_pct:    { label: 'Penetration',         desc: '+{v}% armor penetration per rank',  format: 'pct' },
  attack_speed_pct:   { label: 'Attack Speed',        desc: '+{v}% attack speed per rank',       format: 'pct' },
  crit_chance_pct:    { label: 'Critical Chance',     desc: '+{v}% crit chance per rank',        format: 'pct' },
  crit_damage_pct:    { label: 'Critical Damage',     desc: '+{v}% crit damage per rank',        format: 'pct' },
  accuracy_pct:       { label: 'Accuracy',            desc: '+{v}% accuracy per rank',           format: 'pct' },
  block_pct:          { label: 'Block',               desc: '+{v}% block chance per rank',       format: 'pct' },
  parry_pct:          { label: 'Parry',               desc: '+{v}% parry chance per rank',       format: 'pct' },
  hp_regen_pct:       { label: 'HP Regen',            desc: '+{v}% HP regen per rank',           format: 'pct' },
  damage_reduction_pct:{ label: 'Damage Reduction',   desc: '+{v}% damage reduction per rank',   format: 'pct' },
  aoe_damage_pct:     { label: 'AoE Damage',          desc: '+{v}% AoE damage per rank',         format: 'pct' },
  cooldown_reduction_pct:{ label: 'Cooldown Reduction',desc: '+{v}% cooldown reduction per rank', format: 'pct' },
  execute_pct:        { label: 'Execute',             desc: '+{v}% execute threshold per rank',   format: 'pct' },

  // Combat — magic
  spell_damage_pct:   { label: 'Spell Damage',        desc: '+{v}% spell damage per rank',       format: 'pct' },
  dot_damage_pct:     { label: 'DoT Damage',          desc: '+{v}% DoT damage per rank',         format: 'pct' },
  elemental_pct:      { label: 'Elemental Power',     desc: '+{v}% elemental damage per rank',   format: 'pct' },
  debuff_duration_pct:{ label: 'Debuff Duration',     desc: '+{v}% debuff duration per rank',    format: 'pct' },
  aoe_radius_pct:     { label: 'AoE Radius',          desc: '+{v}% AoE radius per rank',         format: 'pct' },
  magic_resist_pct:   { label: 'Magic Resist',        desc: '+{v}% magic resistance per rank',   format: 'pct' },
  shield_pct:         { label: 'Shield Strength',     desc: '+{v}% shield strength per rank',    format: 'pct' },
  heal_bonus_pct:     { label: 'Heal Bonus',          desc: '+{v}% healing bonus per rank',      format: 'pct' },
  mana_efficiency_pct:{ label: 'Mana Efficiency',     desc: '+{v}% mana efficiency per rank',    format: 'pct' },

  // Exploration/Rogue/Social
  success_chance_pct: { label: 'Success Chance',      desc: '+{v}% success chance per rank',     format: 'pct' },
  action_speed_pct:   { label: 'Action Speed',        desc: '+{v}% action speed per rank',       format: 'pct' },
  detection_pct:      { label: 'Detection',           desc: '+{v}% detection range per rank',    format: 'pct' },
  trap_disarm_pct:    { label: 'Trap Disarm',         desc: '+{v}% trap disarm chance per rank', format: 'pct' },
  npc_favor_pct:      { label: 'NPC Favor',           desc: '+{v}% NPC favor per rank',          format: 'pct' },
  reward_bonus_pct:   { label: 'Reward Bonus',        desc: '+{v}% reward bonus per rank',       format: 'pct' },
  loot_quality_pct:   { label: 'Loot Quality',        desc: '+{v}% loot quality per rank',       format: 'pct' },
  exploration_xp_pct: { label: 'Exploration XP',      desc: '+{v}% exploration XP per rank',     format: 'pct' },
  stealth_pct:        { label: 'Stealth',             desc: '+{v}% stealth effectiveness per rank', format: 'pct' },
  evasion_pct:        { label: 'Evasion',             desc: '+{v}% evasion chance per rank',     format: 'pct' },
};

function formatEffectDesc(effectType, value) {
  var info = MASTERY_EFFECT_TYPES[effectType];
  if (!info) return '+' + value + ' ' + effectType;
  var v = info.format === 'pct' ? Math.round(value * 100) : value;
  return info.desc.replace('{v}', v);
}

module.exports = { MASTERY_EFFECT_TYPES: MASTERY_EFFECT_TYPES, formatEffectDesc: formatEffectDesc };
