// card-affixes.js
// Affix pool, combo pool, and all affix/combo helper functions.
// Uses init(deps) to receive CARD_BY_ID, RARITY_SCALE, and _scaleNumeric
// from card-generation (avoids circular require).

var cardModifiers = require('./card-modifiers');
var MUTATION_POOL = cardModifiers.MUTATION_POOL;
var CARD_CURSE_POOL = cardModifiers.CARD_CURSE_POOL;

// Populated by init(deps)
var CARD_BY_ID = null;
var RARITY_SCALE = null;
var _scaleNumeric = null;

function init(deps) {
  CARD_BY_ID = deps.CARD_BY_ID;
  RARITY_SCALE = deps.RARITY_SCALE;
  _scaleNumeric = deps._scaleNumeric;
}

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

  // ── MULTI-TARGET / AOE (9) ──
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

  // ── PROJECTILE / CHAIN (8) ──
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

var AFFIX_MIN_TIER_BY_RARITY = {
  mythic_rare: 2,
  relic:       3,
};

var PASSIVE_RIDER_CHANCE = {
  rare:        0.30,
  ultra_rare:  0.60,
  mythic_rare: 1.0,
  legendary:   1.0,
  godly:       1.0,
  relic:       1.0,
};

var PASSIVE_RIDER_MIN_TIER = { relic: 2 };

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

  // ── Stack Combos (same affix x 2+) ──
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
    description: 'Poison DoT x2. Poisoned enemies spread plague on death.' },
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
    description: 'Below execute threshold: 100% bleed, execute dmg x2.' },
  { id: 'combo_torrent',        label: 'Torrent',         tier: 3,
    requires: [['aff_free_cast_1','aff_free_cast_2'],['aff_cd_1','aff_cd_2']],
    effect: { type: 'combo_torrent', after_free_cast_next_free_pct: 0.50 },
    description: 'After a free cast, next cast has 50% free cast chance.' },
];

function rollCardAffixes(template, rarity) {
  var count = AFFIX_COUNT_BY_RARITY[rarity] || 0;
  if (count === 0) return [];
  var minTier = AFFIX_MIN_TIER_BY_RARITY[rarity] || 1;

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
  return result.map(function(a) { return { id: a.id, label: a.label, tier: a.tier, cat: a.cat, stacks: 1 }; });
}

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

function rollItemAffixes(itemType, rarity) {
  var count = AFFIX_COUNT_BY_RARITY[rarity] || 0;
  if (count === 0) return [];
  var minTier = AFFIX_MIN_TIER_BY_RARITY[rarity] || 1;

  var eligible = [];
  for (var i = 0; i < AFFIX_POOL.length; i++) {
    var a = AFFIX_POOL[i];
    if (a.cat === 'passive_rider' || a.cat === 'evo_linked') continue;
    if (a.tier < minTier) continue;
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

function computeCardCombos(affixes, passiveRider) {
  if (!affixes || affixes.length === 0) return [];

  var stacks = {};
  for (var i = 0; i < affixes.length; i++) {
    var aff = affixes[i];
    stacks[aff.id] = (stacks[aff.id] || 0) + (aff.stacks || 1);
  }
  if (passiveRider) stacks[passiveRider.id] = (stacks[passiveRider.id] || 0) + 1;

  var active = [];
  for (var ci = 0; ci < COMBO_POOL.length; ci++) {
    var combo = COMBO_POOL[ci];
    var triggered = false;

    if (combo.requiresStacks) {
      triggered = true;
      for (var rs = 0; rs < combo.requiresStacks.length; rs++) {
        var req = combo.requiresStacks[rs];
        if ((stacks[req.id] || 0) < req.minStacks) { triggered = false; break; }
      }
    }

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

function refreshCardEffects(card) {
  if (!card) return;

  var baseEffects;
  if (card._baseEffects) {
    baseEffects = JSON.parse(JSON.stringify(card._baseEffects));
  } else {
    var tmpl = CARD_BY_ID[card.cardId];
    if (!tmpl) {
      console.error('[card] refreshCardEffects: unknown cardId "' + card.cardId + '" — card has no template, effects cleared');
      card.effects = [];
      return;
    }
    baseEffects = JSON.parse(JSON.stringify(tmpl.effects));
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

  if (card.passiveRider) {
    for (var ri = 0; ri < AFFIX_POOL.length; ri++) {
      if (AFFIX_POOL[ri].id === card.passiveRider.id) {
        effects.push(JSON.parse(JSON.stringify(AFFIX_POOL[ri].effect)));
        break;
      }
    }
  }

  var combos = computeCardCombos(affixes, card.passiveRider);
  card.combos = combos;
  for (var cj = 0; cj < combos.length; cj++) {
    effects.push(JSON.parse(JSON.stringify(combos[cj].effect)));
  }

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

function rollEvoAffix(card) {
  var pool = [];
  var totalWeight = 0;
  for (var i = 0; i < AFFIX_POOL.length; i++) {
    var a = AFFIX_POOL[i];
    if (a.cat === 'passive_rider') continue;
    if (a.cat === 'evo_linked') continue;
    var w = a.weight;
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

function getAffixNamePrefix(affixes) {
  if (!affixes || affixes.length === 0) return '';
  var prefixCats = { offensive: true, elemental: true, on_hit: true, push_pull: true, projectile: true };
  for (var i = 0; i < affixes.length; i++) {
    if (prefixCats[affixes[i].cat]) return affixes[i].label;
  }
  return '';
}

function getAffixNameSuffix(affixes) {
  if (!affixes || affixes.length === 0) return '';
  var suffixCats = { resource: true, utility: true, evo_linked: true, aoe: true };
  for (var i = 0; i < affixes.length; i++) {
    if (suffixCats[affixes[i].cat]) return affixes[i].label;
  }
  return '';
}

module.exports = {
  init: init,
  AFFIX_POOL: AFFIX_POOL,
  AFFIX_COUNT_BY_RARITY: AFFIX_COUNT_BY_RARITY,
  PASSIVE_RIDER_CHANCE: PASSIVE_RIDER_CHANCE,
  COMBO_POOL: COMBO_POOL,
  rollCardAffixes: rollCardAffixes,
  rollPassiveRider: rollPassiveRider,
  rollItemAffixes: rollItemAffixes,
  computeCardCombos: computeCardCombos,
  refreshCardEffects: refreshCardEffects,
  addAffixToCard: addAffixToCard,
  rollEvoAffix: rollEvoAffix,
  getAffixNamePrefix: getAffixNamePrefix,
  getAffixNameSuffix: getAffixNameSuffix,
};
