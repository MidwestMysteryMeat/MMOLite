// mastery/mastery-trees-exploration.js — Flavor maps for exploration, rogue, and social skills.
// Branches: Proficiency, Insight, Resourcefulness, Expertise
// Skills: lockpicking, thievery, coercion, deception, dungeon_exploration,
//         survival, gourmand, anatomy

var buildTree = require('./mastery-topology').buildTree;

function _explorationFlavor(skillName, opts) {
  return {
    root:  { name: opts.rootName,       desc: '+3% ' + skillName + ' XP per rank',     effect: { type: 'skill_xp_pct', value: 0.03 } },
    fa:    { name: opts.faName,         desc: '+2% success chance per rank',             effect: { type: 'success_chance_pct', value: 0.02 } },
    fb:    { name: opts.fbName,         desc: '+2% detection range per rank',            effect: { type: 'detection_pct', value: 0.02 } },
    fc:    { name: opts.fcName,         desc: '+2% reward bonus per rank',               effect: { type: 'reward_bonus_pct', value: 0.02 } },
    // Branch 0: Proficiency
    b1e:   { name: opts.b1eName,        desc: '+3% success chance per rank',             effect: { type: 'success_chance_pct', value: 0.03 } },
    b1m1:  { name: opts.b1m1Name,       desc: '+3% action speed per rank',               effect: { type: 'action_speed_pct', value: 0.03 } },
    b1m2:  { name: opts.b1m2Name,       desc: '+4% success chance per rank',             effect: { type: 'success_chance_pct', value: 0.04 } },
    b1m3:  { name: opts.b1m3Name,       desc: '+4% action speed per rank',               effect: { type: 'action_speed_pct', value: 0.04 } },
    b1cap: { name: opts.b1capName,      desc: '+8% success chance',                      effect: { type: 'success_chance_pct', value: 0.08 } },
    // Branch 1: Insight
    b2e:   { name: opts.b2eName,        desc: '+3% detection range per rank',            effect: { type: 'detection_pct', value: 0.03 } },
    b2m1:  { name: opts.b2m1Name,       desc: '+3% trap disarm chance per rank',         effect: { type: 'trap_disarm_pct', value: 0.03 } },
    b2m2:  { name: opts.b2m2Name,       desc: '+3% NPC favor per rank',                  effect: { type: 'npc_favor_pct', value: 0.03 } },
    b2m3:  { name: opts.b2m3Name,       desc: '+2% skill XP per rank',                   effect: { type: 'skill_xp_pct', value: 0.02 } },
    b2cap: { name: opts.b2capName,      desc: '+5% trap disarm chance',                  effect: { type: 'trap_disarm_pct', value: 0.05 } },
    // Branch 2: Resourcefulness
    b3e:   { name: opts.b3eName,        desc: '+3% reward bonus per rank',               effect: { type: 'reward_bonus_pct', value: 0.03 } },
    b3m1:  { name: opts.b3m1Name,       desc: '+3% loot quality per rank',               effect: { type: 'loot_quality_pct', value: 0.03 } },
    b3m2:  { name: opts.b3m2Name,       desc: '+4% reward bonus per rank',               effect: { type: 'reward_bonus_pct', value: 0.04 } },
    b3m3:  { name: opts.b3m3Name,       desc: '+4% loot quality per rank',               effect: { type: 'loot_quality_pct', value: 0.04 } },
    b3cap: { name: opts.b3capName,      desc: '+6% loot quality',                        effect: { type: 'loot_quality_pct', value: 0.06 } },
    // Branch 3: Expertise
    b4e:   { name: opts.b4eName,        desc: '+3% exploration XP per rank',             effect: { type: 'exploration_xp_pct', value: 0.03 } },
    b4m1:  { name: opts.b4m1Name,       desc: '+3% stealth effectiveness per rank',      effect: { type: 'stealth_pct', value: 0.03 } },
    b4m2:  { name: opts.b4m2Name,       desc: '+3% evasion chance per rank',             effect: { type: 'evasion_pct', value: 0.03 } },
    b4m3:  { name: opts.b4m3Name,       desc: '+4% exploration XP per rank',             effect: { type: 'exploration_xp_pct', value: 0.04 } },
    b4cap: { name: opts.b4capName,      desc: '+5% evasion chance',                      effect: { type: 'evasion_pct', value: 0.05 } },
  };
}

var EXPLORATION_TREES = {};

EXPLORATION_TREES.lockpicking = buildTree('lockpicking', _explorationFlavor('lockpicking', {
  rootName: "Locksmith's Touch",
  faName: 'Nimble Fingers', fbName: 'Trap Sense', fcName: 'Hidden Loot',
  b1eName: 'Skeleton Key', b1m1Name: 'Quick Pick', b1m2Name: 'Master Locksmith', b1m3Name: 'Lightning Hands', b1capName: 'Open Sesame',
  b2eName: 'Pin Sight', b2m1Name: 'Wire Cutter', b2m2Name: 'Merchant Friend', b2m3Name: 'Lock Lore', b2capName: 'Unsprung',
  b3eName: 'Better Loot', b3m1Name: 'Treasure Sense', b3m2Name: 'Jackpot Find', b3m3Name: 'Rare Cache', b3capName: 'King\'s Vault',
  b4eName: 'Dungeon Runner', b4m1Name: 'Shadow Step', b4m2Name: 'Dodge Roll', b4m3Name: 'Expert Explorer', b4capName: 'Master Infiltrator',
}));

EXPLORATION_TREES.thievery = buildTree('thievery', _explorationFlavor('thievery', {
  rootName: "Cutpurse Instinct",
  faName: 'Light Fingers', fbName: 'Mark Sense', fcName: 'Fence Contacts',
  b1eName: 'Pickpocket', b1m1Name: 'Quick Hands', b1m2Name: 'Master Thief', b1m3Name: 'Sleight Master', b1capName: 'Grand Heist',
  b2eName: 'Sixth Sense', b2m1Name: 'Escape Route', b2m2Name: 'Underworld Ties', b2m3Name: 'Street Wisdom', b2capName: 'Unseen',
  b3eName: 'Fence Network', b3m1Name: 'Appraisal', b3m2Name: 'Valuable Targets', b3m3Name: 'Black Market', b3capName: 'Crime Lord',
  b4eName: 'Shadow Walker', b4m1Name: 'Cat Burglar', b4m2Name: 'Quick Escape', b4m3Name: 'Expert Thief', b4capName: 'Ghost',
}));

EXPLORATION_TREES.coercion = buildTree('coercion', _explorationFlavor('coercion', {
  rootName: "Commanding Presence",
  faName: 'Intimidate', fbName: 'Read Emotions', fcName: 'Better Deals',
  b1eName: 'Strong Arm', b1m1Name: 'Quick Threats', b1m2Name: 'Dominating Aura', b1m3Name: 'Fear Mastery', b1capName: 'Iron Will',
  b2eName: 'Body Language', b2m1Name: 'Weakness Sense', b2m2Name: 'Reputation', b2m3Name: 'Social Insight', b2capName: 'Lie Detector',
  b3eName: 'Tribute', b3m1Name: 'Extortion', b3m2Name: 'Protection Racket', b3m3Name: 'Power Network', b3capName: 'Warlord',
  b4eName: 'Experienced Brawler', b4m1Name: 'Back Alley', b4m2Name: 'Dodge Blame', b4m3Name: 'Street Cred', b4capName: 'Untouchable',
}));

EXPLORATION_TREES.deception = buildTree('deception', _explorationFlavor('deception', {
  rootName: "Silver Mask",
  faName: 'Convincing Lie', fbName: 'Read Intent', fcName: 'Con Artist',
  b1eName: 'Fast Talk', b1m1Name: 'Quick Alibi', b1m2Name: 'Master Disguise', b1m3Name: 'Smooth Operator', b1capName: 'Perfect Lie',
  b2eName: 'Keen Observer', b2m1Name: 'Misdirection', b2m2Name: 'Double Agent', b2m3Name: 'Deception Lore', b2capName: 'All-Seeing',
  b3eName: 'Swindle', b3m1Name: 'Forgery', b3m2Name: 'Shell Game', b3m3Name: 'Big Score', b3capName: 'Master of Lies',
  b4eName: 'Blend In', b4m1Name: 'Chameleon', b4m2Name: 'Vanish', b4m3Name: 'Shadow Agent', b4capName: 'Invisible',
}));

EXPLORATION_TREES.dungeon_exploration = buildTree('dungeon_exploration', _explorationFlavor('dungeon exploration', {
  rootName: "Delver's Instinct",
  faName: 'Dungeon Sense', fbName: 'Trap Awareness', fcName: 'Scavenger',
  b1eName: 'Path Finder', b1m1Name: 'Quick Navigate', b1m2Name: 'Veteran Delver', b1m3Name: 'Floor Master', b1capName: 'Dungeon Lord',
  b2eName: 'Danger Sense', b2m1Name: 'Trap Expert', b2m2Name: 'Dungeon Guide', b2m3Name: 'Deep Lore', b2capName: 'Sixth Sense',
  b3eName: 'Chest Hunter', b3m1Name: 'Secret Rooms', b3m2Name: 'Treasure Hoard', b3m3Name: 'Relic Finder', b3capName: 'Dragon Hoard',
  b4eName: 'Cartographer', b4m1Name: 'Dark Vision', b4m2Name: 'Quick Dodge', b4m3Name: 'Dungeon Expert', b4capName: 'Underdark Walker',
}));

EXPLORATION_TREES.survival = buildTree('survival', _explorationFlavor('survival', {
  rootName: "Survivor's Grit",
  faName: 'Resourceful', fbName: 'Keen Senses', fcName: 'Scrounge',
  b1eName: 'Wilderness Expert', b1m1Name: 'Quick Camp', b1m2Name: 'Self-Sufficient', b1m3Name: 'Iron Endurance', b1capName: 'One With Nature',
  b2eName: 'Weather Reader', b2m1Name: 'Snare Master', b2m2Name: 'Friend of Beasts', b2m3Name: 'Wild Wisdom', b2capName: 'Primal Awareness',
  b3eName: 'Forager', b3m1Name: 'Salvage Expert', b3m2Name: 'Lucky Finds', b3m3Name: 'Rare Materials', b3capName: 'Survival Instinct',
  b4eName: 'Trail Blazer', b4m1Name: 'Camouflage', b4m2Name: 'Nimble Step', b4m3Name: 'Endurance Runner', b4capName: 'Phantom',
}));

EXPLORATION_TREES.gourmand = buildTree('gourmand', _explorationFlavor('gourmand', {
  rootName: "Refined Palette",
  faName: 'Food Critic', fbName: 'Taste Sense', fcName: 'Dining Network',
  b1eName: 'Connoisseur', b1m1Name: 'Quick Taste', b1m2Name: 'Flavor Expert', b1m3Name: 'Epicurean', b1capName: 'Divine Palette',
  b2eName: 'Ingredient Eye', b2m1Name: 'Recipe Insight', b2m2Name: "Chef's Friend", b2m3Name: 'Food Lore', b2capName: 'Culinary Sage',
  b3eName: 'Fine Dining', b3m1Name: 'Rare Ingredients', b3m2Name: 'Feast Finder', b3m3Name: 'Exotic Cuisine', b3capName: 'Legendary Feast',
  b4eName: 'Social Dining', b4m1Name: 'Wine Knowledge', b4m2Name: 'Graceful Exit', b4m3Name: 'Gourmet Expert', b4capName: 'Master Sommelier',
}));

EXPLORATION_TREES.anatomy = buildTree('anatomy', _explorationFlavor('anatomy', {
  rootName: "Anatomist's Eye",
  faName: 'Vital Points', fbName: 'Diagnosis', fcName: 'Salvage Organs',
  b1eName: 'Surgical Precision', b1m1Name: 'Quick Study', b1m2Name: 'Expert Dissection', b1m3Name: 'Master Surgeon', b1capName: 'Perfect Knowledge',
  b2eName: 'Wound Reader', b2m1Name: 'Disease Sense', b2m2Name: 'Healer Bond', b2m3Name: 'Body Lore', b2capName: 'All-Seeing Eye',
  b3eName: 'Harvest Mastery', b3m1Name: 'Rare Extracts', b3m2Name: 'Organ Preservation', b3m3Name: 'Alchemist Supply', b3capName: 'Ultimate Harvest',
  b4eName: 'Field Medic', b4m1Name: 'Triage', b4m2Name: 'Quick Recovery', b4m3Name: 'Anatomy Expert', b4capName: 'Master Physician',
}));

module.exports = { EXPLORATION_TREES: EXPLORATION_TREES };
