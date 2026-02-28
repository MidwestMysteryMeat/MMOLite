// seasonal/seasonal-awakenings.js
// Procedural awakening choice generator. Picks 3-4 choices per tier from
// a master pool, varies stat thresholds +/-5 and effect values +/-10%.

var rng = require('./seasonal-rng');

var TIER1_POOL = [
  // Original 3
  {
    id: 'rift_surge', name: 'Rift Surge', requiredStat: 'acumen',
    description: 'Channel raw Rift energy through your spells. Spell damage +30%, but mana costs increase by 15%.',
    effects: [{ type: 'spell_damage_mult', value: 0.30 }, { type: 'mana_cost_mult', value: 0.15 }],
    icon: 'skills/Enchantment/', lore: 'The Rift whispers through your incantations, each spell crackling with unstable power.',
  },
  {
    id: 'iron_constitution', name: 'Iron Constitution', requiredStat: 'vigor',
    description: 'Your body hardens from countless battles. Max HP +25%, regenerate 2% HP per turn.',
    effects: [{ type: 'hp_mult', value: 0.25 }, { type: 'hp_regen_percent', value: 0.02 }],
    icon: 'skills/Blacksmith/', lore: 'Scar tissue layered upon scar tissue — you have become nearly indestructible.',
  },
  {
    id: 'killers_instinct', name: "Killer's Instinct", requiredStat: 'finesse',
    description: 'Your strikes find vital points with preternatural accuracy. Crit chance +15%, crit damage +50%.',
    effects: [{ type: 'crit_chance_bonus', value: 0.15 }, { type: 'crit_damage_mult', value: 0.50 }],
    icon: 'skills/Enchantment/', lore: 'Every movement leaves an opening. You see them all now.',
  },
  // New choices
  {
    id: 'tidal_fury', name: 'Tidal Fury', requiredStat: 'might',
    description: 'Your attacks carry the force of crashing waves. Physical damage +20%, knockback chance +10%.',
    effects: [{ type: 'phys_damage_mult', value: 0.20 }, { type: 'knockback_chance', value: 0.10 }],
    icon: 'skills/Blacksmith/', lore: 'The sea remembers. Every strike carries the weight of an ocean.',
  },
  {
    id: 'natures_grasp', name: "Nature's Grasp", requiredStat: 'vigor',
    description: 'Life energy courses through you. Healing received +30%, poison immunity.',
    effects: [{ type: 'heal_received_mult', value: 0.30 }, { type: 'poison_immune', value: true }],
    icon: 'skills/Herbalism/', lore: 'Roots wrap your wounds. The earth itself sustains you.',
  },
  {
    id: 'infernal_will', name: 'Infernal Will', requiredStat: 'acumen',
    description: 'Embrace destructive flame. Fire damage +35%, but take 5% more physical damage.',
    effects: [{ type: 'fire_damage_mult', value: 0.35 }, { type: 'phys_vuln', value: 0.05 }],
    icon: 'skills/Enchantment/', lore: 'You burned the fear out of yourself. What remains does not flinch.',
  },
  {
    id: 'void_walker', name: 'Void Walker', requiredStat: 'finesse',
    description: 'Step between shadows. Dodge chance +12%, stealth detection -20%.',
    effects: [{ type: 'dodge_chance_bonus', value: 0.12 }, { type: 'stealth_detect_reduction', value: 0.20 }],
    icon: 'skills/Enchantment/', lore: 'You exist half-here. Enemies swing through air where you stood.',
  },
  {
    id: 'crystal_mind', name: 'Crystal Mind', requiredStat: 'acumen',
    description: 'Your mind becomes a perfect lattice. Ability cooldowns -15%, mana pool +20%.',
    effects: [{ type: 'cooldown_reduction', value: 0.15 }, { type: 'mana_mult', value: 0.20 }],
    icon: 'skills/Enchantment/', lore: 'Thought flows like light through crystal — fast, clear, without waste.',
  },
];

var TIER2_POOL = [
  // Original 3
  {
    id: 'rift_conduit', name: 'Rift Conduit', requiredStat: 'acumen',
    description: 'Become a living conduit for Rift energy. All ability cooldowns -25%, resource costs -20%.',
    effects: [{ type: 'cooldown_reduction', value: 0.25 }, { type: 'resource_cost_reduction', value: 0.20 }],
    icon: 'skills/Enchantment/', lore: 'The boundary between you and the Rift has dissolved. Energy flows through you like a river.',
  },
  {
    id: 'undying_bastion', name: 'Undying Bastion', requiredStat: 'vigor',
    description: 'Once per combat, survive a killing blow with 1 HP and gain 50% damage reduction for 3 turns.',
    effects: [{ type: 'cheat_death', uses: 1 }, { type: 'on_cheat_death_dr', value: 0.50, duration: 3 }],
    icon: 'skills/Blacksmith/', lore: 'Death reached for you, but you simply refused.',
  },
  {
    id: 'shadow_sovereign', name: 'Shadow Sovereign', requiredStat: 'finesse',
    description: 'Gain permanent stealth in dim light. First attack from stealth deals 100% bonus damage.',
    effects: [{ type: 'dim_light_stealth', value: true }, { type: 'stealth_break_damage_mult', value: 1.00 }],
    icon: 'skills/Enchantment/', lore: 'You do not walk in shadow — shadow walks with you.',
  },
  // New tier2 choices
  {
    id: 'tidal_sovereign', name: 'Tidal Sovereign', requiredStat: 'might',
    description: 'Your presence summons the tide. AoE damage +25%, allies in range gain +10% damage.',
    effects: [{ type: 'aoe_damage_mult', value: 0.25 }, { type: 'party_damage_aura', value: 0.10 }],
    icon: 'skills/Blacksmith/', lore: 'Where you fight, the ground trembles and the air tastes of salt.',
  },
  {
    id: 'lifetree_bond', name: 'Lifetree Bond', requiredStat: 'vigor',
    description: 'Bound to the world tree. Regenerate 5% HP per turn out of combat, +40% healing power.',
    effects: [{ type: 'ooc_hp_regen', value: 0.05 }, { type: 'healing_power_mult', value: 0.40 }],
    icon: 'skills/Herbalism/', lore: 'The great roots reach even here. They will not let you fall.',
  },
  {
    id: 'hellfire_mastery', name: 'Hellfire Mastery', requiredStat: 'acumen',
    description: 'Master of consuming flame. Fire abilities cost no mana, but drain 3% HP per cast.',
    effects: [{ type: 'fire_free_cast', value: true }, { type: 'fire_hp_cost', value: 0.03 }],
    icon: 'skills/Enchantment/', lore: 'Fire asks for fuel. You have always been willing to burn.',
  },
  {
    id: 'phase_shift', name: 'Phase Shift', requiredStat: 'finesse',
    description: 'Shift between planes. 20% chance to avoid all damage, +15% movement speed.',
    effects: [{ type: 'phase_dodge', value: 0.20 }, { type: 'speed_bonus', value: 0.15 }],
    icon: 'skills/Enchantment/', lore: 'You learned to step sideways through reality. Most never come back.',
  },
  {
    id: 'arcane_singularity', name: 'Arcane Singularity', requiredStat: 'acumen',
    description: 'Collapse magic into a single devastating point. Spell crit damage +80%, but -10% crit chance.',
    effects: [{ type: 'spell_crit_damage_mult', value: 0.80 }, { type: 'spell_crit_chance_penalty', value: 0.10 }],
    icon: 'skills/Enchantment/', lore: 'Every spell you cast is a controlled detonation. Emphasis on detonation.',
  },
];

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'awakenings');

  var AWAKENINGS = {
    tier1: _generateTier(r, TIER1_POOL, 25, 40),
    tier2: _generateTier(r, TIER2_POOL, 50, 40),
  };

  return { AWAKENINGS: AWAKENINGS };
}

function _generateTier(r, pool, level, baseThreshold) {
  var count = rng.range(r, 3, 4);
  var selected = rng.pickN(r, pool, count);

  var choices = [];
  for (var i = 0; i < selected.length; i++) {
    var awk = selected[i];
    // Deep-copy effects to avoid mutating the pool
    var effects = [];
    for (var e = 0; e < awk.effects.length; e++) {
      var eff = {};
      for (var k in awk.effects[e]) eff[k] = awk.effects[e][k];
      // Vary numeric values +/-10%
      if (typeof eff.value === 'number') {
        eff.value = rng.varyRound(r, eff.value, 0.10);
      }
      effects.push(eff);
    }

    choices.push({
      id: awk.id,
      name: awk.name,
      requiredStat: awk.requiredStat,
      description: awk.description,
      effects: effects,
      icon: awk.icon,
      lore: awk.lore,
    });
  }

  return {
    level: level,
    statThreshold: baseThreshold + rng.range(r, -5, 5),
    choices: choices,
  };
}

module.exports = {
  generate: generate,
  TIER1_POOL: TIER1_POOL,
  TIER2_POOL: TIER2_POOL,
};
