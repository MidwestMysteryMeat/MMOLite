// mastery/mastery-trees-combat.js — Flavor maps for combat skills.
// Melee/Ranged branches: Power, Precision, Defense, Technique
// Magic branches: Power, Control, Resilience, Channeling
// Skills: melee, melee_blade, melee_blunt, melee_martial, archery,
//         magic, magic_elemental, magic_arcane, magic_divine, magic_shadow,
//         necromancy, life_magic, ritual_magic, ritual_water, ritual_blood,
//         animal_handling, psychology, weather_magic, animal_taming

var buildTree = require('./mastery-topology').buildTree;

// --- Melee/Ranged template ---
function _physicalFlavor(skillName, opts) {
  return {
    root:  { name: opts.rootName,       desc: '+3% ' + skillName + ' XP per rank',    effect: { type: 'skill_xp_pct', value: 0.03 } },
    fa:    { name: opts.faName,         desc: '+2% damage per rank',                   effect: { type: 'damage_pct', value: 0.02 } },
    fb:    { name: opts.fbName,         desc: '+2% crit chance per rank',              effect: { type: 'crit_chance_pct', value: 0.02 } },
    fc:    { name: opts.fcName,         desc: '+2% block chance per rank',             effect: { type: 'block_pct', value: 0.02 } },
    // Branch 0: Power
    b1e:   { name: opts.b1eName,        desc: '+3% damage per rank',                   effect: { type: 'damage_pct', value: 0.03 } },
    b1m1:  { name: opts.b1m1Name,       desc: '+2% armor penetration per rank',        effect: { type: 'penetration_pct', value: 0.02 } },
    b1m2:  { name: opts.b1m2Name,       desc: '+3% attack speed per rank',             effect: { type: 'attack_speed_pct', value: 0.03 } },
    b1m3:  { name: opts.b1m3Name,       desc: '+4% damage per rank',                   effect: { type: 'damage_pct', value: 0.04 } },
    b1cap: { name: opts.b1capName,      desc: '+8% damage',                            effect: { type: 'damage_pct', value: 0.08 } },
    // Branch 1: Precision
    b2e:   { name: opts.b2eName,        desc: '+3% crit chance per rank',              effect: { type: 'crit_chance_pct', value: 0.03 } },
    b2m1:  { name: opts.b2m1Name,       desc: '+4% crit damage per rank',              effect: { type: 'crit_damage_pct', value: 0.04 } },
    b2m2:  { name: opts.b2m2Name,       desc: '+3% accuracy per rank',                 effect: { type: 'accuracy_pct', value: 0.03 } },
    b2m3:  { name: opts.b2m3Name,       desc: '+4% crit chance per rank',              effect: { type: 'crit_chance_pct', value: 0.04 } },
    b2cap: { name: opts.b2capName,      desc: '+6% crit damage',                       effect: { type: 'crit_damage_pct', value: 0.06 } },
    // Branch 2: Defense
    b3e:   { name: opts.b3eName,        desc: '+3% block chance per rank',             effect: { type: 'block_pct', value: 0.03 } },
    b3m1:  { name: opts.b3m1Name,       desc: '+3% parry chance per rank',             effect: { type: 'parry_pct', value: 0.03 } },
    b3m2:  { name: opts.b3m2Name,       desc: '+2% HP regen per rank',                 effect: { type: 'hp_regen_pct', value: 0.02 } },
    b3m3:  { name: opts.b3m3Name,       desc: '+3% damage reduction per rank',         effect: { type: 'damage_reduction_pct', value: 0.03 } },
    b3cap: { name: opts.b3capName,      desc: '+5% damage reduction',                  effect: { type: 'damage_reduction_pct', value: 0.05 } },
    // Branch 3: Technique
    b4e:   { name: opts.b4eName,        desc: '+3% AoE damage per rank',               effect: { type: 'aoe_damage_pct', value: 0.03 } },
    b4m1:  { name: opts.b4m1Name,       desc: '+3% cooldown reduction per rank',       effect: { type: 'cooldown_reduction_pct', value: 0.03 } },
    b4m2:  { name: opts.b4m2Name,       desc: '+2% execute threshold per rank',        effect: { type: 'execute_pct', value: 0.02 } },
    b4m3:  { name: opts.b4m3Name,       desc: '+4% AoE damage per rank',               effect: { type: 'aoe_damage_pct', value: 0.04 } },
    b4cap: { name: opts.b4capName,      desc: '+5% execute threshold',                 effect: { type: 'execute_pct', value: 0.05 } },
  };
}

// --- Magic template ---
function _magicFlavor(skillName, opts) {
  return {
    root:  { name: opts.rootName,       desc: '+3% ' + skillName + ' XP per rank',    effect: { type: 'skill_xp_pct', value: 0.03 } },
    fa:    { name: opts.faName,         desc: '+2% spell damage per rank',             effect: { type: 'spell_damage_pct', value: 0.02 } },
    fb:    { name: opts.fbName,         desc: '+2% debuff duration per rank',          effect: { type: 'debuff_duration_pct', value: 0.02 } },
    fc:    { name: opts.fcName,         desc: '+2% magic resistance per rank',         effect: { type: 'magic_resist_pct', value: 0.02 } },
    // Branch 0: Power
    b1e:   { name: opts.b1eName,        desc: '+3% spell damage per rank',             effect: { type: 'spell_damage_pct', value: 0.03 } },
    b1m1:  { name: opts.b1m1Name,       desc: '+3% DoT damage per rank',               effect: { type: 'dot_damage_pct', value: 0.03 } },
    b1m2:  { name: opts.b1m2Name,       desc: '+3% elemental damage per rank',         effect: { type: 'elemental_pct', value: 0.03 } },
    b1m3:  { name: opts.b1m3Name,       desc: '+4% spell damage per rank',             effect: { type: 'spell_damage_pct', value: 0.04 } },
    b1cap: { name: opts.b1capName,      desc: '+8% spell damage',                      effect: { type: 'spell_damage_pct', value: 0.08 } },
    // Branch 1: Control
    b2e:   { name: opts.b2eName,        desc: '+3% debuff duration per rank',          effect: { type: 'debuff_duration_pct', value: 0.03 } },
    b2m1:  { name: opts.b2m1Name,       desc: '+3% AoE radius per rank',               effect: { type: 'aoe_radius_pct', value: 0.03 } },
    b2m2:  { name: opts.b2m2Name,       desc: '+4% debuff duration per rank',          effect: { type: 'debuff_duration_pct', value: 0.04 } },
    b2m3:  { name: opts.b2m3Name,       desc: '+2% skill XP per rank',                 effect: { type: 'skill_xp_pct', value: 0.02 } },
    b2cap: { name: opts.b2capName,      desc: '+5% AoE radius',                        effect: { type: 'aoe_radius_pct', value: 0.05 } },
    // Branch 2: Resilience
    b3e:   { name: opts.b3eName,        desc: '+3% magic resistance per rank',         effect: { type: 'magic_resist_pct', value: 0.03 } },
    b3m1:  { name: opts.b3m1Name,       desc: '+3% shield strength per rank',          effect: { type: 'shield_pct', value: 0.03 } },
    b3m2:  { name: opts.b3m2Name,       desc: '+3% healing bonus per rank',            effect: { type: 'heal_bonus_pct', value: 0.03 } },
    b3m3:  { name: opts.b3m3Name,       desc: '+4% magic resistance per rank',         effect: { type: 'magic_resist_pct', value: 0.04 } },
    b3cap: { name: opts.b3capName,      desc: '+5% healing bonus',                     effect: { type: 'heal_bonus_pct', value: 0.05 } },
    // Branch 3: Channeling
    b4e:   { name: opts.b4eName,        desc: '+3% cooldown reduction per rank',       effect: { type: 'cooldown_reduction_pct', value: 0.03 } },
    b4m1:  { name: opts.b4m1Name,       desc: '+3% mana efficiency per rank',          effect: { type: 'mana_efficiency_pct', value: 0.03 } },
    b4m2:  { name: opts.b4m2Name,       desc: '+4% cooldown reduction per rank',       effect: { type: 'cooldown_reduction_pct', value: 0.04 } },
    b4m3:  { name: opts.b4m3Name,       desc: '+4% mana efficiency per rank',          effect: { type: 'mana_efficiency_pct', value: 0.04 } },
    b4cap: { name: opts.b4capName,      desc: '+6% mana efficiency',                   effect: { type: 'mana_efficiency_pct', value: 0.06 } },
  };
}

var COMBAT_TREES = {};

// ── Physical combat skills ──
COMBAT_TREES.melee = buildTree('melee', _physicalFlavor('melee', {
  rootName: "Warrior's Resolve",
  faName: 'Raw Power', fbName: 'Combat Instinct', fcName: 'Iron Guard',
  b1eName: 'Heavy Blows', b1m1Name: 'Armor Rend', b1m2Name: 'Relentless', b1m3Name: 'Devastating Force', b1capName: 'Titan Strike',
  b2eName: 'Sharp Eyes', b2m1Name: 'Deep Wounds', b2m2Name: 'True Aim', b2m3Name: 'Lethal Focus', b2capName: 'Deathblow',
  b3eName: 'Shield Wall', b3m1Name: 'Riposte', b3m2Name: 'Battle Recovery', b3m3Name: 'Unbreakable', b3capName: 'Fortress',
  b4eName: 'Wide Sweep', b4m1Name: 'Combat Flow', b4m2Name: 'Finishing Blow', b4m3Name: 'Whirlwind', b4capName: 'Executioner',
}));

COMBAT_TREES.melee_blade = buildTree('melee_blade', _physicalFlavor('blade', {
  rootName: "Blade Dancer",
  faName: 'Keen Edge', fbName: 'Sword Eye', fcName: 'Defensive Stance',
  b1eName: 'Deep Cut', b1m1Name: 'Rend Armor', b1m2Name: 'Flurry', b1m3Name: 'Lethal Edge', b1capName: 'Thousand Cuts',
  b2eName: 'Precision Thrust', b2m1Name: 'Bleeding Strike', b2m2Name: 'Duelist Focus', b2m3Name: 'Razor Instinct', b2capName: 'Heart Seeker',
  b3eName: 'Blade Parry', b3m1Name: 'Counter Slash', b3m2Name: 'Second Wind', b3m3Name: 'Steel Skin', b3capName: 'Mirror Guard',
  b4eName: 'Cleaving Arc', b4m1Name: 'Quick Draw', b4m2Name: 'Coup de Grace', b4m3Name: 'Storm of Steel', b4capName: 'Blade Master',
}));

COMBAT_TREES.melee_blunt = buildTree('melee_blunt', _physicalFlavor('blunt', {
  rootName: "Crushing Force",
  faName: 'Heavy Impact', fbName: 'Weak Point', fcName: 'Brace',
  b1eName: 'Bone Breaker', b1m1Name: 'Shatter Armor', b1m2Name: 'Relentless Smash', b1m3Name: 'Devastating Slam', b1capName: 'Earthquake',
  b2eName: 'Concussive Hit', b2m1Name: 'Internal Bleeding', b2m2Name: 'Staggering Blow', b2m3Name: 'Precision Smash', b2capName: 'Skull Crack',
  b3eName: 'Stone Stance', b3m1Name: 'Counter Bash', b3m2Name: 'Tough Skin', b3m3Name: 'Immovable', b3capName: 'Mountain',
  b4eName: 'Ground Slam', b4m1Name: 'Momentum', b4m2Name: 'Crushing Finale', b4m3Name: 'Avalanche', b4capName: 'Colossus',
}));

COMBAT_TREES.melee_martial = buildTree('melee_martial', _physicalFlavor('martial arts', {
  rootName: "Inner Focus",
  faName: 'Chi Strike', fbName: 'Pressure Points', fcName: 'Iron Palm',
  b1eName: 'Tiger Claw', b1m1Name: 'Qi Burst', b1m2Name: 'Rapid Fists', b1m3Name: 'Dragon Force', b1capName: 'One Inch Punch',
  b2eName: 'Nerve Strike', b2m1Name: 'Vital Hit', b2m2Name: 'Eagle Eye', b2m3Name: 'Flow State', b2capName: 'Dim Mak',
  b3eName: 'Crane Guard', b3m1Name: 'Redirect', b3m2Name: 'Meditation', b3m3Name: 'Diamond Body', b3capName: 'Empty Mind',
  b4eName: 'Sweeping Kick', b4m1Name: 'Chain Strike', b4m2Name: 'Pressure Release', b4m3Name: 'Hurricane Kick', b4capName: 'Thousand Palms',
}));

COMBAT_TREES.archery = buildTree('archery', _physicalFlavor('archery', {
  rootName: "Marksman's Eye",
  faName: 'Draw Strength', fbName: 'Steady Aim', fcName: 'Evasive Shot',
  b1eName: 'Power Shot', b1m1Name: 'Pierce Armor', b1m2Name: 'Rapid Fire', b1m3Name: 'Heavy Draw', b1capName: 'Siege Arrow',
  b2eName: 'Sniper Focus', b2m1Name: 'Barbed Tips', b2m2Name: 'Wind Read', b2m3Name: 'Dead Shot', b2capName: 'Bullseye',
  b3eName: 'Nimble Dodge', b3m1Name: 'Deflect', b3m2Name: 'Survival Instinct', b3m3Name: 'Tough Hide', b3capName: 'Ghost Step',
  b4eName: 'Volley', b4m1Name: 'Quick Nock', b4m2Name: 'Kill Shot', b4m3Name: 'Rain of Arrows', b4capName: 'Artemis Shot',
}));

// ── Magic combat skills ──
COMBAT_TREES.magic = buildTree('magic', _magicFlavor('magic', {
  rootName: "Arcane Attunement",
  faName: 'Spell Force', fbName: 'Mind Warp', fcName: 'Mana Shield',
  b1eName: 'Raw Power', b1m1Name: 'Lingering Curse', b1m2Name: 'Elemental Surge', b1m3Name: 'Overwhelming Force', b1capName: 'Arcane Nova',
  b2eName: 'Hex Mastery', b2m1Name: 'Wide Area', b2m2Name: 'Deep Affliction', b2m3Name: 'Spell Lore', b2capName: 'Mass Enchant',
  b3eName: 'Spell Ward', b3m1Name: 'Barrier', b3m2Name: 'Healing Touch', b3m3Name: 'Arcane Armor', b3capName: 'Impervious',
  b4eName: 'Quick Cast', b4m1Name: 'Mana Flow', b4m2Name: 'Rapid Recovery', b4m3Name: 'Efficient Casting', b4capName: 'Infinite Mana',
}));

COMBAT_TREES.magic_elemental = buildTree('magic_elemental', _magicFlavor('elemental magic', {
  rootName: "Elemental Mastery",
  faName: 'Storm Bolt', fbName: 'Elemental Bind', fcName: 'Elemental Skin',
  b1eName: 'Inferno', b1m1Name: 'Burning Ground', b1m2Name: 'Lightning Chain', b1m3Name: 'Primal Fury', b1capName: 'Cataclysm',
  b2eName: 'Frost Lock', b2m1Name: 'Shockwave', b2m2Name: 'Permafrost', b2m3Name: 'Elemental Lore', b2capName: 'Absolute Zero',
  b3eName: 'Stone Skin', b3m1Name: 'Ice Barrier', b3m2Name: 'Nature Mend', b3m3Name: 'Elemental Ward', b3capName: 'Primordial Shield',
  b4eName: 'Quick Element', b4m1Name: 'Mana Current', b4m2Name: 'Rapid Shift', b4m3Name: 'Flow Mastery', b4capName: 'Avatar of Elements',
}));

COMBAT_TREES.magic_arcane = buildTree('magic_arcane', _magicFlavor('arcane magic', {
  rootName: "Arcane Brilliance",
  faName: 'Arcane Missile', fbName: 'Dispel', fcName: 'Spell Shield',
  b1eName: 'Force Blast', b1m1Name: 'Arcane Burn', b1m2Name: 'Mana Overload', b1m3Name: 'Eldritch Power', b1capName: 'Arcane Annihilation',
  b2eName: 'Silence', b2m1Name: 'Gravity Well', b2m2Name: 'Mana Drain', b2m3Name: 'Arcane Insight', b2capName: 'Dimensional Rift',
  b3eName: 'Arcane Bulwark', b3m1Name: 'Phase Shift', b3m2Name: 'Arcane Mend', b3m3Name: 'Nullification', b3capName: 'Invulnerability',
  b4eName: 'Blink Cast', b4m1Name: 'Arcane Flux', b4m2Name: 'Time Warp', b4m3Name: 'Efficient Weave', b4capName: 'Mastery of Time',
}));

COMBAT_TREES.magic_divine = buildTree('magic_divine', _magicFlavor('divine magic', {
  rootName: "Divine Calling",
  faName: 'Holy Smite', fbName: 'Sacred Chains', fcName: 'Blessed Aura',
  b1eName: 'Wrath of Light', b1m1Name: 'Searing Light', b1m2Name: 'Radiant Burst', b1m3Name: 'Divine Fury', b1capName: "Heaven's Wrath",
  b2eName: 'Holy Binding', b2m1Name: 'Consecration', b2m2Name: 'Banishment', b2m3Name: 'Divine Lore', b2capName: 'Mass Judgment',
  b3eName: 'Sacred Shield', b3m1Name: 'Divine Barrier', b3m2Name: 'Greater Heal', b3m3Name: 'Sanctified', b3capName: 'Aegis of Faith',
  b4eName: 'Swift Prayer', b4m1Name: 'Grace', b4m2Name: 'Rapid Blessing', b4m3Name: 'Holy Efficiency', b4capName: 'Endless Devotion',
}));

COMBAT_TREES.magic_shadow = buildTree('magic_shadow', _magicFlavor('shadow magic', {
  rootName: "Shadow Weaver",
  faName: 'Dark Bolt', fbName: 'Shadow Bind', fcName: 'Umbral Cloak',
  b1eName: 'Void Strike', b1m1Name: 'Shadow Rot', b1m2Name: 'Dark Surge', b1m3Name: 'Abyssal Power', b1capName: 'Void Eruption',
  b2eName: 'Mind Flay', b2m1Name: 'Shadow Snare', b2m2Name: 'Dread Aura', b2m3Name: 'Shadow Lore', b2capName: 'Mass Terror',
  b3eName: 'Dark Ward', b3m1Name: 'Shadow Step', b3m2Name: 'Life Drain', b3m3Name: 'Void Armor', b3capName: 'Embrace Darkness',
  b4eName: 'Quick Shadow', b4m1Name: 'Darkness Flow', b4m2Name: 'Rapid Decay', b4m3Name: 'Shadow Mastery', b4capName: 'Void Walker',
}));

COMBAT_TREES.necromancy = buildTree('necromancy', _magicFlavor('necromancy', {
  rootName: "Death's Apprentice",
  faName: 'Death Bolt', fbName: 'Corpse Grasp', fcName: 'Bone Armor',
  b1eName: 'Soul Blast', b1m1Name: 'Plague', b1m2Name: 'Death Coil', b1m3Name: 'Necrotic Power', b1capName: 'Army of the Dead',
  b2eName: 'Soul Chain', b2m1Name: 'Corpse Explosion', b2m2Name: 'Wither', b2m3Name: 'Death Lore', b2capName: 'Mass Reanimate',
  b3eName: 'Death Ward', b3m1Name: 'Bone Shield', b3m2Name: 'Life Siphon', b3m3Name: 'Undeath Resilience', b3capName: 'Lichdom',
  b4eName: 'Quick Raise', b4m1Name: 'Soul Flow', b4m2Name: 'Rapid Decay', b4m3Name: 'Necrotic Efficiency', b4capName: 'Death Mastery',
}));

COMBAT_TREES.life_magic = buildTree('life_magic', _magicFlavor('life magic', {
  rootName: "Life Warden",
  faName: 'Life Bolt', fbName: 'Entangle', fcName: 'Natural Armor',
  b1eName: 'Rejuvenation', b1m1Name: 'Bloom', b1m2Name: 'Life Surge', b1m3Name: 'Vital Force', b1capName: 'Tree of Life',
  b2eName: 'Root Bind', b2m1Name: 'Thorn Garden', b2m2Name: 'Nature Hold', b2m3Name: 'Life Lore', b2capName: 'Mass Restoration',
  b3eName: 'Bark Skin', b3m1Name: 'Regeneration', b3m2Name: 'Greater Restoration', b3m3Name: 'Life Ward', b3capName: 'Immortal Spring',
  b4eName: 'Quick Mend', b4m1Name: 'Life Flow', b4m2Name: 'Rapid Growth', b4m3Name: 'Nature Efficiency', b4capName: 'Eternal Bloom',
}));

COMBAT_TREES.ritual_magic = buildTree('ritual_magic', _magicFlavor('ritual magic', {
  rootName: "Ritual Keeper",
  faName: 'Ritual Bolt', fbName: 'Spirit Bind', fcName: 'Ancestral Ward',
  b1eName: 'Spirit Flame', b1m1Name: 'Ancestral Curse', b1m2Name: 'Ritual Surge', b1m3Name: 'Spirit Power', b1capName: 'Grand Ritual',
  b2eName: 'Spirit Snare', b2m1Name: 'Totem Pulse', b2m2Name: 'Deep Ritual', b2m3Name: 'Ritual Lore', b2capName: 'Mass Invocation',
  b3eName: 'Spirit Guard', b3m1Name: 'Totem Shield', b3m2Name: 'Ritual Heal', b3m3Name: 'Ancestral Armor', b3capName: 'Spirit Fortress',
  b4eName: 'Quick Ritual', b4m1Name: 'Spirit Flow', b4m2Name: 'Rapid Invocation', b4m3Name: 'Ritual Efficiency', b4capName: 'Eternal Rite',
}));

COMBAT_TREES.ritual_water = buildTree('ritual_water', _magicFlavor('water rituals', {
  rootName: "Tide Caller",
  faName: 'Water Bolt', fbName: 'Tidal Grasp', fcName: 'Ocean Ward',
  b1eName: 'Torrent', b1m1Name: 'Riptide', b1m2Name: 'Tidal Surge', b1m3Name: 'Abyssal Power', b1capName: 'Tsunami',
  b2eName: 'Whirlpool', b2m1Name: 'Maelstrom', b2m2Name: 'Deep Current', b2m3Name: 'Ocean Lore', b2capName: 'Leviathan Call',
  b3eName: 'Water Shield', b3m1Name: 'Coral Armor', b3m2Name: 'Healing Waters', b3m3Name: 'Deep Ward', b3capName: 'Ocean Embrace',
  b4eName: 'Quick Tide', b4m1Name: 'Water Flow', b4m2Name: 'Rapid Current', b4m3Name: 'Tidal Efficiency', b4capName: 'Eternal Tide',
}));

COMBAT_TREES.ritual_blood = buildTree('ritual_blood', _magicFlavor('blood rituals', {
  rootName: "Blood Shaman",
  faName: 'Blood Bolt', fbName: 'Blood Chains', fcName: 'Blood Ward',
  b1eName: 'Hemorrhage', b1m1Name: 'Blood Boil', b1m2Name: 'Crimson Surge', b1m3Name: 'Sanguine Power', b1capName: 'Blood Nova',
  b2eName: 'Blood Bind', b2m1Name: 'Crimson Snare', b2m2Name: 'Exsanguinate', b2m3Name: 'Blood Lore', b2capName: 'Mass Hemorrhage',
  b3eName: 'Blood Shield', b3m1Name: 'Coagulate', b3m2Name: 'Blood Mend', b3m3Name: 'Crimson Armor', b3capName: 'Sanguine Fortress',
  b4eName: 'Quick Bleed', b4m1Name: 'Blood Flow', b4m2Name: 'Rapid Ritual', b4m3Name: 'Blood Efficiency', b4capName: 'Eternal Crimson',
}));

// ── Hybrid combat skills (use magic template for consistency) ──
COMBAT_TREES.animal_handling = buildTree('animal_handling', _magicFlavor('animal handling', {
  rootName: "Beast Whisperer",
  faName: 'Command Beast', fbName: 'Pack Tactics', fcName: 'Thick Hide',
  b1eName: 'Feral Strike', b1m1Name: 'Venomous Bite', b1m2Name: 'Beast Surge', b1m3Name: 'Alpha Command', b1capName: 'Stampede',
  b2eName: 'Intimidate', b2m1Name: 'Pack Hunt', b2m2Name: 'Wild Dominion', b2m3Name: 'Beast Lore', b2capName: 'Alpha Howl',
  b3eName: 'Beast Bond', b3m1Name: 'Companion Shield', b3m2Name: 'Nature Mend', b3m3Name: 'Wild Resilience', b3capName: 'Unbreakable Bond',
  b4eName: 'Quick Command', b4m1Name: 'Beast Synergy', b4m2Name: 'Rapid Train', b4m3Name: 'Handler Efficiency', b4capName: 'Perfect Bond',
}));

COMBAT_TREES.psychology = buildTree('psychology', _magicFlavor('psychology', {
  rootName: "Silver Tongue",
  faName: 'Inspire', fbName: 'Demoralize', fcName: 'Calm Mind',
  b1eName: 'Battle Cry', b1m1Name: 'War Song', b1m2Name: 'Rallying Shout', b1m3Name: 'Overwhelming Presence', b1capName: 'Legendary Anthem',
  b2eName: 'Taunt', b2m1Name: 'Mass Confusion', b2m2Name: 'Despair', b2m3Name: 'Mind Lore', b2capName: 'Mass Hysteria',
  b3eName: 'Mental Shield', b3m1Name: 'Iron Will', b3m2Name: 'Soothing Words', b3m3Name: 'Psychic Armor', b3capName: 'Unshakeable',
  b4eName: 'Quick Speech', b4m1Name: 'Eloquence', b4m2Name: 'Rapid Inspire', b4m3Name: 'Bardic Efficiency', b4capName: 'Eternal Song',
}));

COMBAT_TREES.weather_magic = buildTree('weather_magic', _magicFlavor('weather magic', {
  rootName: "Storm Caller",
  faName: 'Lightning Strike', fbName: 'Gale Force', fcName: 'Eye of the Storm',
  b1eName: 'Thunder Bolt', b1m1Name: 'Storm Surge', b1m2Name: 'Chain Lightning', b1m3Name: 'Tempest Power', b1capName: 'Perfect Storm',
  b2eName: 'Wind Shear', b2m1Name: 'Tornado', b2m2Name: 'Freezing Rain', b2m3Name: 'Weather Lore', b2capName: 'Category Five',
  b3eName: 'Wind Barrier', b3m1Name: 'Storm Shield', b3m2Name: 'Refreshing Rain', b3m3Name: 'Storm Armor', b3capName: 'Storm Fortress',
  b4eName: 'Quick Cast', b4m1Name: 'Storm Flow', b4m2Name: 'Rapid Shift', b4m3Name: 'Weather Mastery', b4capName: 'Eternal Storm',
}));

COMBAT_TREES.animal_taming = buildTree('animal_taming', _magicFlavor('animal taming', {
  rootName: "Tamer's Bond",
  faName: 'Tame Beast', fbName: 'Calm Animal', fcName: 'Wild Defense',
  b1eName: 'Beast Attack', b1m1Name: 'Companion Frenzy', b1m2Name: 'Pack Power', b1m3Name: 'Primal Command', b1capName: 'Beast Lord',
  b2eName: 'Lure', b2m1Name: 'Distraction', b2m2Name: 'Deep Bond', b2m3Name: 'Taming Lore', b2capName: 'Mass Tame',
  b3eName: 'Pet Shield', b3m1Name: 'Companion Heal', b3m2Name: 'Wild Recovery', b3m3Name: 'Beast Armor', b3capName: 'Eternal Companion',
  b4eName: 'Quick Tame', b4m1Name: 'Bond Flow', b4m2Name: 'Rapid Train', b4m3Name: 'Tamer Efficiency', b4capName: 'Perfect Harmony',
}));

module.exports = { COMBAT_TREES: COMBAT_TREES };
