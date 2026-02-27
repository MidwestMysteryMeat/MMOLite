'use strict';

var TRAP_TYPES = {
  spike_pit:        { name: 'Spike Pit',        damageFactor: 1.0, effect: null,     effectDuration: 0, tickDamage: 0, detectDifficulty: 1 },
  arrow_trap:       { name: 'Arrow Trap',       damageFactor: 0.8, effect: null,     effectDuration: 0, tickDamage: 0, detectDifficulty: 2 },
  pressure_plate:   { name: 'Pressure Plate',   damageFactor: 0.5, effect: 'stun',   effectDuration: 2, tickDamage: 0, detectDifficulty: 2 },
  poison_gas:       { name: 'Poison Gas',       damageFactor: 0.3, effect: 'poison', effectDuration: 8, tickDamage: 3, detectDifficulty: 2 },
  collapsing_floor: { name: 'Collapsing Floor', damageFactor: 1.5, effect: 'stun',   effectDuration: 1, tickDamage: 0, detectDifficulty: 1 },
  tripwire:         { name: 'Tripwire',         damageFactor: 0.4, effect: 'slow',   effectDuration: 5, tickDamage: 0, detectDifficulty: 2 },
  dart_trap:        { name: 'Dart Trap',        damageFactor: 0.6, effect: 'poison', effectDuration: 5, tickDamage: 2, detectDifficulty: 2 },
  flame_jet:        { name: 'Flame Jet',        damageFactor: 1.2, effect: 'burn',   effectDuration: 3, tickDamage: 5, detectDifficulty: 1 },
};

var TRAP_TYPE_KEYS = Object.keys(TRAP_TYPES);

var SPECIAL_EVENTS = [
  {
    id: 'treasure_goblin',
    name: 'Treasure Goblin',
    description: 'A treasure goblin dashes through the room! Defeat it before it escapes.',
    duration: 15,
    reward: { goldMultiplier: 3, bonusXp: 50 },
  },
  {
    id: 'ancient_shrine',
    name: 'Ancient Shrine',
    description: 'A glowing shrine offers a temporary blessing to all nearby adventurers.',
    duration: 0,
    reward: { buff: 'shrine_power', buffDuration: 120 },
  },
  {
    id: 'merchant_ghost',
    name: 'Merchant Ghost',
    description: 'The ghost of a long-dead merchant offers rare wares at fair prices.',
    duration: 0,
    reward: { shopDiscount: 0.30, rareItems: true },
  },
  {
    id: 'mini_boss',
    name: 'Mini Boss Ambush',
    description: 'A powerful creature blocks the passage. Defeat it for bonus rewards.',
    duration: 0,
    reward: { bonusXp: 100, bonusGold: 50, cardChance: 0.20 },
  },
  {
    id: 'portal_room',
    name: 'Portal Room',
    description: 'A shimmering portal leads to a hidden treasure chamber.',
    duration: 0,
    reward: { bonusChests: 3, chestTier: 'rare' },
  },
  {
    id: 'memory_crystal',
    name: 'Memory Crystal',
    description: 'A crystal holds memories of past adventurers, granting wisdom.',
    duration: 0,
    reward: { bonusXp: 75, skillXp: 25 },
  },
];

var FLOOR_MODIFIERS = {
  none:           { id: 'none',           name: 'Normal',          weight: 50, description: 'Standard floor, no special conditions.' },
  trap_gauntlet:  { id: 'trap_gauntlet',  name: 'Trap Gauntlet',   weight: 8,  description: 'Triple trap density. Pressure plates and spike pits everywhere. Dungeon Dwelling skill reduces trap damage.',
    trapMultiplier: 3, trapDamageBonus: 0.5 },
  mimic_infestation: { id: 'mimic_infestation', name: 'Mimic Infestation', weight: 6, description: 'Some chests are mimics — hostile creatures disguised as treasure. Attack when opened.',
    mimicChance: 0.40, mimicTemplate: { id: 'mimic', name: 'Mimic', hp: 60, atk: 18, def: 8, xp: 30, gold: 20, isMimic: true } },
  dense_fog:      { id: 'dense_fog',      name: 'Dense Fog',       weight: 7,  description: 'Thick fog reduces visibility to 1 tile (normally 3). Darkvision races see 2 tiles. Enemies harder to spot.',
    fogRadius: 1, darkvisionFogRadius: 2, enemyDetectionReduction: 1 },
  treasure_vault: { id: 'treasure_vault', name: 'Treasure Vault',  weight: 4,  description: 'A floor overflowing with loot. Double chest count, all chests upgraded one tier. Guarded by extra enemies.',
    chestMultiplier: 2, chestTierBonus: 1, enemyMultiplier: 1.5 },
  cursed:         { id: 'cursed',          name: 'Cursed Floor',    weight: 5,  description: 'A dark curse permeates this floor. Enemies deal 20% more damage, but drop 50% more gold and XP.',
    enemyDamageBonus: 0.20, enemyGoldBonus: 0.50, enemyXpBonus: 0.50 },
  hollowed_swarm: { id: 'hollowed_swarm', name: 'Hollowed Swarm',  weight: 5,  description: 'The hollowed have gathered en masse. 50% more enemies, all hollowed/maddened variants.',
    enemyMultiplier: 1.5, forceHollowed: true },
  silent_floor:   { id: 'silent_floor',   name: 'Silent Floor',    weight: 5,  description: 'An eerie silence. No ambient sounds. Enemies do not patrol — they stand perfectly still until you get close.',
    enemiesStationary: true, detectionRadiusBonus: 1 },
  unstable_rift:  { id: 'unstable_rift',  name: 'Unstable Rift',   weight: 4,  description: 'The floor shifts and warps. Corridors may collapse. Walls appear and disappear. Layout partially randomizes every 60 seconds.',
    wallShiftInterval: 60, collapseChance: 0.05 },
  blood_moon:     { id: 'blood_moon',     name: 'Blood Moon',      weight: 3,  description: 'A crimson glow suffuses everything. Enemies regenerate HP slowly. Vampiric enemies heal on hit.',
    enemyRegenPerTick: 1, vampiricHealPercent: 0.10 },
  sanctuary:      { id: 'sanctuary',      name: 'Sanctuary Floor', weight: 3,  description: 'A rare floor of peace. No enemies spawn. Contains a shrine, merchant NPC, and healing spring. A moment to breathe.',
    noEnemies: true, guaranteedShrine: true, guaranteedMerchant: true, healingSpring: true },
};

function selectFloorModifier(rng, floorNum) {
  if (floorNum <= 3) return FLOOR_MODIFIERS.none;

  var totalWeight = 0;
  var modifiers = Object.keys(FLOOR_MODIFIERS);
  modifiers.forEach(function(key) { totalWeight += FLOOR_MODIFIERS[key].weight; });

  var roll = rng() * totalWeight;
  var cumulative = 0;
  for (var i = 0; i < modifiers.length; i++) {
    cumulative += FLOOR_MODIFIERS[modifiers[i]].weight;
    if (roll < cumulative) return FLOOR_MODIFIERS[modifiers[i]];
  }
  return FLOOR_MODIFIERS.none;
}

module.exports = {
  TRAP_TYPES: TRAP_TYPES,
  TRAP_TYPE_KEYS: TRAP_TYPE_KEYS,
  SPECIAL_EVENTS: SPECIAL_EVENTS,
  FLOOR_MODIFIERS: FLOOR_MODIFIERS,
  selectFloorModifier: selectFloorModifier,
};
