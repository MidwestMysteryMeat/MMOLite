// card-modifiers.js
// Mutation and curse pools, rolling, application, and cleansing.

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

var MUTATION_TIER_NAMES = { 1: 'Minor', 2: 'Moderate', 3: 'Major' };

function rollMutation(baseChance, luckBonus) {
  var luck = (typeof luckBonus === 'number' && luckBonus > 0) ? luckBonus : 0;
  var finalChance = Math.min(baseChance * (1 + luck * 3), 0.60);
  if (Math.random() >= finalChance) return null;

  var maxTier = 1;
  if (luck >= 0.30) maxTier = 3;
  else if (luck >= 0.10) maxTier = 2;

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

function applyMutation(card, mutation) {
  if (!card || !mutation) return;
  card.effects.push(mutation.effect);
  if (!card.mutations) card.mutations = [];
  card.mutations.push({ id: mutation.mutationId, label: mutation.label, tier: mutation.tier });
}

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

function rollCardCurse(baseCurseChance, luckBonus) {
  var luck = (typeof luckBonus === 'number' && luckBonus > 0) ? luckBonus : 0;
  var curseMult = Math.max(0.05, 1 - luck * 2);
  var finalChance = Math.min(baseCurseChance * curseMult, 0.40);
  if (Math.random() >= finalChance) return null;

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

function applyCurse(card, curse) {
  if (!card || !curse) return;
  card.effects.push(curse.effect);
  if (!card.curses) card.curses = [];
  card.curses.push({ id: curse.mutationId, label: curse.label, tier: curse.tier, cleansable: true });
  card.isCursed = true;
}

function cleanseCardCurse(card, curseId) {
  if (!card || !card.curses) return false;
  var idx = -1;
  for (var i = 0; i < card.curses.length; i++) {
    if (card.curses[i].id === curseId && card.curses[i].cleansable) { idx = i; break; }
  }
  if (idx === -1) return false;
  var curse = card.curses.splice(idx, 1)[0];
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

module.exports = {
  MUTATION_POOL: MUTATION_POOL,
  MUTATION_TIER_NAMES: MUTATION_TIER_NAMES,
  rollMutation: rollMutation,
  applyMutation: applyMutation,
  CARD_CURSE_POOL: CARD_CURSE_POOL,
  rollCardCurse: rollCardCurse,
  applyCurse: applyCurse,
  cleanseCardCurse: cleanseCardCurse,
};
