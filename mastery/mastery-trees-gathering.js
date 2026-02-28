// mastery/mastery-trees-gathering.js — Flavor maps for gathering skills.
// Branches: Yield, Speed, Quality, Fortune
// Skills: mining, woodcutting, farming, fishing, harvesting

var buildTree = require('./mastery-topology').buildTree;

// Shared branch structure — each gathering skill overrides names/descs per slot.
// Branch 0 = Yield, Branch 1 = Speed, Branch 2 = Quality, Branch 3 = Fortune

function _gatheringFlavor(skillName, opts) {
  return {
    root:  { name: opts.rootName,       desc: '+3% ' + skillName + ' XP per rank',     effect: { type: 'skill_xp_pct', value: 0.03 } },
    // Foundation
    fa:    { name: opts.faName,         desc: '+2% resource yield per rank',             effect: { type: 'yield_pct', value: 0.02 } },
    fb:    { name: opts.fbName,         desc: '+2% gathering speed per rank',            effect: { type: 'gather_speed_pct', value: 0.02 } },
    fc:    { name: opts.fcName,         desc: '+2% quality tier chance per rank',         effect: { type: 'quality_tier_pct', value: 0.02 } },
    // Branch 0: Yield
    b1e:   { name: opts.b1eName,        desc: '+3% resource yield per rank',             effect: { type: 'yield_pct', value: 0.03 } },
    b1m1:  { name: opts.b1m1Name,       desc: '+1 bonus resource per rank',              effect: { type: 'yield_flat', value: 1 } },
    b1m2:  { name: opts.b1m2Name,       desc: '+4% resource yield per rank',             effect: { type: 'yield_pct', value: 0.04 } },
    b1m3:  { name: opts.b1m3Name,       desc: '+3% double drop chance per rank',         effect: { type: 'double_drop_pct', value: 0.03 } },
    b1cap: { name: opts.b1capName,      desc: '+8% double drop chance',                  effect: { type: 'double_drop_pct', value: 0.08 } },
    // Branch 1: Speed
    b2e:   { name: opts.b2eName,        desc: '+3% gathering speed per rank',            effect: { type: 'gather_speed_pct', value: 0.03 } },
    b2m1:  { name: opts.b2m1Name,       desc: '+3% tool durability per rank',            effect: { type: 'tool_durability_pct', value: 0.03 } },
    b2m2:  { name: opts.b2m2Name,       desc: '+4% gathering speed per rank',            effect: { type: 'gather_speed_pct', value: 0.04 } },
    b2m3:  { name: opts.b2m3Name,       desc: '+2% skill XP per rank',                   effect: { type: 'skill_xp_pct', value: 0.02 } },
    b2cap: { name: opts.b2capName,      desc: '+5% tool durability, +5% speed',          effect: { type: 'gather_speed_pct', value: 0.05 } },
    // Branch 2: Quality
    b3e:   { name: opts.b3eName,        desc: '+3% quality tier chance per rank',        effect: { type: 'quality_tier_pct', value: 0.03 } },
    b3m1:  { name: opts.b3m1Name,       desc: '+2% masterwork chance per rank',          effect: { type: 'masterwork_pct', value: 0.02 } },
    b3m2:  { name: opts.b3m2Name,       desc: '+4% quality tier chance per rank',        effect: { type: 'quality_tier_pct', value: 0.04 } },
    b3m3:  { name: opts.b3m3Name,       desc: '+3% masterwork chance per rank',          effect: { type: 'masterwork_pct', value: 0.03 } },
    b3cap: { name: opts.b3capName,      desc: '+6% masterwork chance',                   effect: { type: 'masterwork_pct', value: 0.06 } },
    // Branch 3: Fortune
    b4e:   { name: opts.b4eName,        desc: '+2% rare find chance per rank',           effect: { type: 'rare_find_pct', value: 0.02 } },
    b4m1:  { name: opts.b4m1Name,       desc: '+2% gem find chance per rank',            effect: { type: 'gem_chance_pct', value: 0.02 } },
    b4m2:  { name: opts.b4m2Name,       desc: '+3% rare find chance per rank',           effect: { type: 'rare_find_pct', value: 0.03 } },
    b4m3:  { name: opts.b4m3Name,       desc: '+2% jackpot chance per rank',             effect: { type: 'jackpot_pct', value: 0.02 } },
    b4cap: { name: opts.b4capName,      desc: '+5% jackpot chance',                      effect: { type: 'jackpot_pct', value: 0.05 } },
  };
}

var MINING_FLAVOR = _gatheringFlavor('mining', {
  rootName: "Miner's Instinct",
  faName: 'Rich Veins', fbName: 'Pickaxe Mastery', fcName: 'Ore Sense',
  b1eName: 'Deep Strike', b1m1Name: 'Motherlode', b1m2Name: 'Vein Splitter', b1m3Name: 'Double Ore', b1capName: 'Strip Mine',
  b2eName: 'Swift Strikes', b2m1Name: 'Tempered Pick', b2m2Name: 'Tunnel Vision', b2m3Name: 'Experienced Miner', b2capName: 'Unstoppable',
  b3eName: 'Keen Eye', b3m1Name: 'Gem Cutter', b3m2Name: 'Precision Mining', b3m3Name: 'Master Refiner', b3capName: 'Flawless Extract',
  b4eName: 'Lucky Strike', b4m1Name: 'Gem Seeker', b4m2Name: 'Rare Deposit', b4m3Name: 'Bonanza', b4capName: 'Midas Touch',
});

var WOODCUTTING_FLAVOR = _gatheringFlavor('woodcutting', {
  rootName: "Lumberjack's Eye",
  faName: 'Timber Yield', fbName: 'Axe Efficiency', fcName: 'Wood Grading',
  b1eName: 'Deep Cuts', b1m1Name: 'Extra Planks', b1m2Name: 'Splitting Blow', b1m3Name: 'Double Log', b1capName: 'Clearcut',
  b2eName: 'Rhythmic Chops', b2m1Name: 'Sharp Edge', b2m2Name: 'Steady Pace', b2m3Name: 'Forest Wisdom', b2capName: 'Blur of Steel',
  b3eName: 'Heartwood Sense', b3m1Name: 'Select Cut', b3m2Name: 'Grain Reader', b3m3Name: 'Master Woodsman', b3capName: 'Ancient Growth',
  b4eName: 'Hollow Finder', b4m1Name: 'Amber Seeker', b4m2Name: 'Rare Timber', b4m3Name: 'Forest Bounty', b4capName: 'World Tree Shard',
});

var FARMING_FLAVOR = _gatheringFlavor('farming', {
  rootName: "Green Thumb",
  faName: 'Abundant Harvest', fbName: 'Quick Growth', fcName: 'Crop Quality',
  b1eName: 'Fertile Soil', b1m1Name: 'Overflowing Bushel', b1m2Name: 'Bumper Crop', b1m3Name: 'Double Harvest', b1capName: 'Cornucopia',
  b2eName: 'Growth Spurt', b2m1Name: 'Sturdy Tools', b2m2Name: 'Swift Hands', b2m3Name: "Farmer's Wisdom", b2capName: 'Season Master',
  b3eName: 'Selective Breeding', b3m1Name: 'Prize Crop', b3m2Name: 'Premium Grade', b3m3Name: 'Seed Perfection', b3capName: 'Golden Harvest',
  b4eName: 'Lucky Seed', b4m1Name: 'Hidden Bulb', b4m2Name: 'Rare Cultivar', b4m3Name: 'Miracle Bloom', b4capName: "Nature's Jackpot",
});

var FISHING_FLAVOR = _gatheringFlavor('fishing', {
  rootName: "Angler's Patience",
  faName: 'Full Net', fbName: 'Quick Cast', fcName: 'Fish Grading',
  b1eName: 'School Finder', b1m1Name: 'Extra Catch', b1m2Name: 'Net Sweep', b1m3Name: 'Double Haul', b1capName: 'Trawler',
  b2eName: 'Nimble Fingers', b2m1Name: 'Strong Line', b2m2Name: 'Fast Reel', b2m3Name: 'Seasoned Fisher', b2capName: 'Lightning Cast',
  b3eName: 'Keen Lure', b3m1Name: 'Trophy Sense', b3m2Name: 'Prime Waters', b3m3Name: 'Master Angler', b3capName: 'Legendary Catch',
  b4eName: 'Lucky Hook', b4m1Name: 'Pearl Diver', b4m2Name: 'Sunken Treasure', b4m3Name: 'Sea Bounty', b4capName: 'Poseidon\'s Favor',
});

var HARVESTING_FLAVOR = _gatheringFlavor('harvesting', {
  rootName: "Forager's Sense",
  faName: 'Bountiful Gather', fbName: 'Quick Hands', fcName: 'Herb Grading',
  b1eName: 'Patch Finder', b1m1Name: 'Extra Bundle', b1m2Name: 'Thorough Search', b1m3Name: 'Double Pick', b1capName: 'Nature Walker',
  b2eName: 'Swift Gather', b2m1Name: 'Careful Harvest', b2m2Name: 'Practiced Hands', b2m3Name: 'Herbalist Lore', b2capName: 'Wind Stride',
  b3eName: 'Quality Eye', b3m1Name: 'Potent Herbs', b3m2Name: 'Prime Specimen', b3m3Name: 'Master Herbalist', b3capName: 'Essence Bloom',
  b4eName: 'Lucky Find', b4m1Name: 'Mushroom Sense', b4m2Name: 'Rare Growth', b4m3Name: 'Hidden Grove', b4capName: 'Verdant Blessing',
});

var GATHERING_TREES = {};
GATHERING_TREES.mining = buildTree('mining', MINING_FLAVOR);
GATHERING_TREES.woodcutting = buildTree('woodcutting', WOODCUTTING_FLAVOR);
GATHERING_TREES.farming = buildTree('farming', FARMING_FLAVOR);
GATHERING_TREES.fishing = buildTree('fishing', FISHING_FLAVOR);
GATHERING_TREES.harvesting = buildTree('harvesting', HARVESTING_FLAVOR);

module.exports = { GATHERING_TREES: GATHERING_TREES };
