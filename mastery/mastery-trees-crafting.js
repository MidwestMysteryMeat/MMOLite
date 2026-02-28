// mastery/mastery-trees-crafting.js — Flavor maps for crafting skills.
// Branches: Quality, Efficiency, Innovation, Mastery
// Skills: cooking, crafting, sewing, cogworking, glassworking,
//         alchemy, enchanting, leatherworking, brewing, carpentry,
//         jewelcrafting, transmutation, sigil_scripting

var buildTree = require('./mastery-topology').buildTree;

function _craftingFlavor(skillName, opts) {
  return {
    root:  { name: opts.rootName,       desc: '+3% ' + skillName + ' XP per rank',      effect: { type: 'skill_xp_pct', value: 0.03 } },
    fa:    { name: opts.faName,         desc: '+2% crafting quality per rank',            effect: { type: 'craft_quality_pct', value: 0.02 } },
    fb:    { name: opts.fbName,         desc: '+2% ingredient save chance per rank',      effect: { type: 'ingredient_save_pct', value: 0.02 } },
    fc:    { name: opts.fcName,         desc: '+2% crafting speed per rank',              effect: { type: 'craft_speed_pct', value: 0.02 } },
    // Branch 0: Quality
    b1e:   { name: opts.b1eName,        desc: '+3% crafting quality per rank',            effect: { type: 'craft_quality_pct', value: 0.03 } },
    b1m1:  { name: opts.b1m1Name,       desc: '+2% masterwork chance per rank',           effect: { type: 'masterwork_pct', value: 0.02 } },
    b1m2:  { name: opts.b1m2Name,       desc: '+2% bonus stats on crafted items per rank', effect: { type: 'stat_bonus_pct', value: 0.02 } },
    b1m3:  { name: opts.b1m3Name,       desc: '+3% masterwork chance per rank',           effect: { type: 'masterwork_pct', value: 0.03 } },
    b1cap: { name: opts.b1capName,      desc: '+6% masterwork chance',                    effect: { type: 'masterwork_pct', value: 0.06 } },
    // Branch 1: Efficiency
    b2e:   { name: opts.b2eName,        desc: '+3% ingredient save chance per rank',      effect: { type: 'ingredient_save_pct', value: 0.03 } },
    b2m1:  { name: opts.b2m1Name,       desc: '+3% double craft chance per rank',         effect: { type: 'double_craft_pct', value: 0.03 } },
    b2m2:  { name: opts.b2m2Name,       desc: '+4% ingredient save chance per rank',      effect: { type: 'ingredient_save_pct', value: 0.04 } },
    b2m3:  { name: opts.b2m3Name,       desc: '+2% skill XP per rank',                    effect: { type: 'skill_xp_pct', value: 0.02 } },
    b2cap: { name: opts.b2capName,      desc: '+8% double craft chance',                  effect: { type: 'double_craft_pct', value: 0.08 } },
    // Branch 2: Innovation
    b3e:   { name: opts.b3eName,        desc: '+2% recipe discovery chance per rank',     effect: { type: 'recipe_unlock_pct', value: 0.02 } },
    b3m1:  { name: opts.b3m1Name,       desc: '+2% craft mutation chance per rank',       effect: { type: 'mutation_chance_pct', value: 0.02 } },
    b3m2:  { name: opts.b3m2Name,       desc: '+3% recipe discovery chance per rank',     effect: { type: 'recipe_unlock_pct', value: 0.03 } },
    b3m3:  { name: opts.b3m3Name,       desc: '+3% craft mutation chance per rank',       effect: { type: 'mutation_chance_pct', value: 0.03 } },
    b3cap: { name: opts.b3capName,      desc: '+5% craft mutation chance',                effect: { type: 'mutation_chance_pct', value: 0.05 } },
    // Branch 3: Mastery
    b4e:   { name: opts.b4eName,        desc: '+3% crafting speed per rank',              effect: { type: 'craft_speed_pct', value: 0.03 } },
    b4m1:  { name: opts.b4m1Name,       desc: '+3% craft critical chance per rank',       effect: { type: 'craft_crit_pct', value: 0.03 } },
    b4m2:  { name: opts.b4m2Name,       desc: '+4% crafting speed per rank',              effect: { type: 'craft_speed_pct', value: 0.04 } },
    b4m3:  { name: opts.b4m3Name,       desc: '+4% craft critical chance per rank',       effect: { type: 'craft_crit_pct', value: 0.04 } },
    b4cap: { name: opts.b4capName,      desc: '+6% craft critical chance',                effect: { type: 'craft_crit_pct', value: 0.06 } },
  };
}

var CRAFTING_TREES = {};

CRAFTING_TREES.cooking = buildTree('cooking', _craftingFlavor('cooking', {
  rootName: "Chef's Intuition",
  faName: 'Refined Palette', fbName: 'Portion Control', fcName: 'Quick Prep',
  b1eName: 'Gourmet Touch', b1m1Name: 'Perfect Seasoning', b1m2Name: 'Nourishing Meals', b1m3Name: 'Master Chef', b1capName: 'Divine Cuisine',
  b2eName: 'Thrifty Cook', b2m1Name: 'Extra Serving', b2m2Name: 'Waste Nothing', b2m3Name: 'Kitchen Wisdom', b2capName: 'Infinite Pantry',
  b3eName: 'Experimental Recipes', b3m1Name: 'Flavor Fusion', b3m2Name: 'Secret Ingredients', b3m3Name: 'Wild Combinations', b3capName: 'Culinary Genius',
  b4eName: 'Swift Blade', b4m1Name: 'Knife Master', b4m2Name: 'Flash Fry', b4m3Name: 'Speed Service', b4capName: 'One-Pan Wonder',
}));

CRAFTING_TREES.crafting = buildTree('crafting', _craftingFlavor('crafting', {
  rootName: "Smith's Focus",
  faName: 'Tempered Steel', fbName: 'Material Efficiency', fcName: 'Forge Speed',
  b1eName: 'Perfect Fold', b1m1Name: 'Masterwork Steel', b1m2Name: 'Reinforced Craft', b1m3Name: 'Artisan Touch', b1capName: 'Legendary Smith',
  b2eName: 'Scrap Recovery', b2m1Name: 'Double Forge', b2m2Name: 'Ore Stretcher', b2m3Name: 'Forge Wisdom', b2capName: 'Infinite Alloy',
  b3eName: 'Blueprint Study', b3m1Name: 'Alloy Experiment', b3m2Name: 'Lost Techniques', b3m3Name: 'Material Alchemy', b3capName: 'Innovation Engine',
  b4eName: 'Rapid Hammer', b4m1Name: 'Precision Strikes', b4m2Name: 'Assembly Line', b4m3Name: 'Master Forger', b4capName: 'Volcanic Forge',
}));

CRAFTING_TREES.sewing = buildTree('sewing', _craftingFlavor('sewing', {
  rootName: "Tailor's Precision",
  faName: 'Fine Thread', fbName: 'Cloth Saving', fcName: 'Quick Stitch',
  b1eName: 'Reinforced Seams', b1m1Name: 'Exquisite Pattern', b1m2Name: 'Woven Strength', b1m3Name: 'Master Tailor', b1capName: 'Royal Garments',
  b2eName: 'Scrap Reuse', b2m1Name: 'Double Weave', b2m2Name: 'Thread Economy', b2m3Name: 'Loom Wisdom', b2capName: 'Endless Spool',
  b3eName: 'Pattern Study', b3m1Name: 'Dye Experiment', b3m2Name: 'Exotic Fabrics', b3m3Name: 'Design Fusion', b3capName: 'Fashion Visionary',
  b4eName: 'Nimble Needle', b4m1Name: 'Speed Stitch', b4m2Name: 'Rapid Weave', b4m3Name: 'Loom Mastery', b4capName: 'Silken Blur',
}));

CRAFTING_TREES.cogworking = buildTree('cogworking', _craftingFlavor('cogworking', {
  rootName: "Tinkerer's Mind",
  faName: 'Precision Gears', fbName: 'Part Salvage', fcName: 'Quick Assembly',
  b1eName: 'Calibrated Parts', b1m1Name: 'Masterwork Gears', b1m2Name: 'Reinforced Frame', b1m3Name: 'Master Engineer', b1capName: 'Clockwork Perfection',
  b2eName: 'Scrap Recycle', b2m1Name: 'Double Output', b2m2Name: 'Spring Saver', b2m3Name: 'Workshop Wisdom', b2capName: 'Perpetual Engine',
  b3eName: 'Schematic Study', b3m1Name: 'Gear Experiment', b3m2Name: 'Lost Blueprints', b3m3Name: 'Mechanical Fusion', b3capName: 'Innovation Core',
  b4eName: 'Rapid Assembly', b4m1Name: 'Tool Precision', b4m2Name: 'Steam Power', b4m3Name: 'Factory Speed', b4capName: 'Gnomish Overdrive',
}));

CRAFTING_TREES.glassworking = buildTree('glassworking', _craftingFlavor('glassworking', {
  rootName: "Glazier's Eye",
  faName: 'Pure Sand', fbName: 'Flux Economy', fcName: 'Quick Melt',
  b1eName: 'Crystal Clarity', b1m1Name: 'Flawless Lens', b1m2Name: 'Prismatic Shine', b1m3Name: 'Master Glazier', b1capName: 'Starlight Glass',
  b2eName: 'Sand Saver', b2m1Name: 'Double Pane', b2m2Name: 'Efficient Furnace', b2m3Name: 'Kiln Wisdom', b2capName: 'Infinite Crucible',
  b3eName: 'Color Theory', b3m1Name: 'Stain Fusion', b3m2Name: 'Rare Pigments', b3m3Name: 'Spectrum Craft', b3capName: 'Prism Architect',
  b4eName: 'Fast Blow', b4m1Name: 'Steady Hands', b4m2Name: 'Quick Cool', b4m3Name: 'Furnace Rush', b4capName: 'Phoenix Flame',
}));

CRAFTING_TREES.alchemy = buildTree('alchemy', _craftingFlavor('alchemy', {
  rootName: "Alchemist's Insight",
  faName: 'Pure Distillation', fbName: 'Reagent Thrift', fcName: 'Quick Brew',
  b1eName: 'Potent Mixture', b1m1Name: 'Masterwork Elixir', b1m2Name: 'Enhanced Potency', b1m3Name: 'Grand Alchemist', b1capName: "Philosopher's Brew",
  b2eName: 'Catalyst Saver', b2m1Name: 'Double Batch', b2m2Name: 'Reagent Stretch', b2m3Name: 'Lab Wisdom', b2capName: 'Infinite Flask',
  b3eName: 'Formula Research', b3m1Name: 'Volatile Mix', b3m2Name: 'Lost Recipes', b3m3Name: 'Transmutation Spark', b3capName: 'Eureka Moment',
  b4eName: 'Rapid Distill', b4m1Name: 'Quick Reaction', b4m2Name: 'Flash Synthesis', b4m3Name: 'Lab Mastery', b4capName: 'Chain Reaction',
}));

CRAFTING_TREES.enchanting = buildTree('enchanting', _craftingFlavor('enchanting', {
  rootName: "Enchanter's Focus",
  faName: 'Strong Bindings', fbName: 'Dust Economy', fcName: 'Quick Infusion',
  b1eName: 'Arcane Resonance', b1m1Name: 'Perfect Inscription', b1m2Name: 'Power Surge', b1m3Name: 'Grand Enchanter', b1capName: 'Soul Forge',
  b2eName: 'Essence Saver', b2m1Name: 'Double Enchant', b2m2Name: 'Mana Recycling', b2m3Name: 'Runic Wisdom', b2capName: 'Infinite Essence',
  b3eName: 'Rune Study', b3m1Name: 'Glyph Experiment', b3m2Name: 'Ancient Runes', b3m3Name: 'Enchant Mutation', b3capName: 'Rune Architect',
  b4eName: 'Swift Inscription', b4m1Name: 'Flowing Runes', b4m2Name: 'Rapid Binding', b4m3Name: 'Enchant Mastery', b4capName: 'Instant Imbue',
}));

CRAFTING_TREES.leatherworking = buildTree('leatherworking', _craftingFlavor('leatherworking', {
  rootName: "Tanner's Touch",
  faName: 'Supple Leather', fbName: 'Hide Economy', fcName: 'Quick Tan',
  b1eName: 'Reinforced Hide', b1m1Name: 'Masterwork Leather', b1m2Name: 'Hardened Plates', b1m3Name: 'Master Tanner', b1capName: 'Dragonhide Craft',
  b2eName: 'Scrap Recovery', b2m1Name: 'Double Tan', b2m2Name: 'Hide Stretcher', b2m3Name: 'Tanning Wisdom', b2capName: 'Endless Hide',
  b3eName: 'Pattern Discovery', b3m1Name: 'Dye Infusion', b3m2Name: 'Exotic Hides', b3m3Name: 'Leather Alchemy', b3capName: 'Beast Artisan',
  b4eName: 'Swift Cut', b4m1Name: 'Quick Stitch', b4m2Name: 'Rapid Cure', b4m3Name: 'Workshop Speed', b4capName: 'Whirlwind Craft',
}));

CRAFTING_TREES.brewing = buildTree('brewing', _craftingFlavor('brewing', {
  rootName: "Brewer's Nose",
  faName: 'Rich Flavor', fbName: 'Grain Economy', fcName: 'Quick Ferment',
  b1eName: 'Bold Batch', b1m1Name: 'Award Winning', b1m2Name: 'Fortified Brew', b1m3Name: 'Master Brewer', b1capName: 'Nectar of the Gods',
  b2eName: 'Yeast Saver', b2m1Name: 'Double Barrel', b2m2Name: 'Efficient Still', b2m3Name: 'Cellar Wisdom', b2capName: 'Bottomless Keg',
  b3eName: 'Flavor Experiment', b3m1Name: 'Infusion Craft', b3m2Name: 'Rare Hops', b3m3Name: 'Blend Mastery', b3capName: 'Mythic Vintage',
  b4eName: 'Fast Ferment', b4m1Name: 'Quick Aging', b4m2Name: 'Pressure Brew', b4m3Name: 'Barrel Mastery', b4capName: 'Instant Distill',
}));

CRAFTING_TREES.carpentry = buildTree('carpentry', _craftingFlavor('carpentry', {
  rootName: "Carpenter's Measure",
  faName: 'True Joints', fbName: 'Wood Economy', fcName: 'Quick Plane',
  b1eName: 'Dovetail Precision', b1m1Name: 'Masterwork Frame', b1m2Name: 'Reinforced Joinery', b1m3Name: 'Master Carpenter', b1capName: 'Architect Supreme',
  b2eName: 'Plank Saver', b2m1Name: 'Double Build', b2m2Name: 'Lumber Stretch', b2m3Name: 'Workshop Wisdom', b2capName: 'Endless Timber',
  b3eName: 'Design Study', b3m1Name: 'Exotic Inlays', b3m2Name: 'Hidden Compartments', b3m3Name: 'Wood Alchemy', b3capName: 'Living Woodwork',
  b4eName: 'Rapid Saw', b4m1Name: 'Quick Assembly', b4m2Name: 'Power Tools', b4m3Name: 'Build Speed', b4capName: 'Instant Frame',
}));

CRAFTING_TREES.jewelcrafting = buildTree('jewelcrafting', _craftingFlavor('jewelcrafting', {
  rootName: "Jeweler's Loupe",
  faName: 'Perfect Facets', fbName: 'Gem Economy', fcName: 'Quick Set',
  b1eName: 'Brilliant Cut', b1m1Name: 'Masterwork Setting', b1m2Name: 'Enhanced Sparkle', b1m3Name: 'Grand Jeweler', b1capName: 'Crown Jewels',
  b2eName: 'Dust Recovery', b2m1Name: 'Double Setting', b2m2Name: 'Gem Stretcher', b2m3Name: 'Atelier Wisdom', b2capName: 'Infinite Facets',
  b3eName: 'Gem Lore', b3m1Name: 'Infused Gems', b3m2Name: 'Rare Stones', b3m3Name: 'Crystal Alchemy', b3capName: 'Prismatic Mastery',
  b4eName: 'Swift Polish', b4m1Name: 'Rapid Cut', b4m2Name: 'Quick Mount', b4m3Name: 'Gem Mastery', b4capName: 'Diamond Hands',
}));

CRAFTING_TREES.transmutation = buildTree('transmutation', _craftingFlavor('transmutation', {
  rootName: "Transmuter's Will",
  faName: 'Stable Conversion', fbName: 'Matter Economy', fcName: 'Quick Shift',
  b1eName: 'Pure Transmute', b1m1Name: 'Perfect Transform', b1m2Name: 'Enhanced Output', b1m3Name: 'Grand Transmuter', b1capName: 'Equivalent Exchange',
  b2eName: 'Mass Preserve', b2m1Name: 'Double Yield', b2m2Name: 'Energy Recycle', b2m3Name: 'Circle Wisdom', b2capName: 'Infinite Loop',
  b3eName: 'Material Research', b3m1Name: 'Elemental Shift', b3m2Name: 'Rare Conversions', b3m3Name: 'Matter Fusion', b3capName: "Philosopher's Stone",
  b4eName: 'Rapid Convert', b4m1Name: 'Quick Phase', b4m2Name: 'Flash Transmute', b4m3Name: 'Circle Mastery', b4capName: 'Instant Matter',
}));

CRAFTING_TREES.sigil_scripting = buildTree('sigil_scripting', _craftingFlavor('sigil scripting', {
  rootName: "Scribe's Precision",
  faName: 'Clear Lines', fbName: 'Ink Economy', fcName: 'Quick Script',
  b1eName: 'Stable Sigils', b1m1Name: 'Masterwork Glyph', b1m2Name: 'Power Inscription', b1m3Name: 'Grand Scribe', b1capName: 'Living Sigil',
  b2eName: 'Ink Saver', b2m1Name: 'Double Script', b2m2Name: 'Pigment Stretch', b2m3Name: 'Scriptorium Wisdom', b2capName: 'Infinite Ink',
  b3eName: 'Glyph Research', b3m1Name: 'Rune Fusion', b3m2Name: 'Lost Scripts', b3m3Name: 'Symbol Alchemy', b3capName: 'Primordial Rune',
  b4eName: 'Swift Pen', b4m1Name: 'Flowing Script', b4m2Name: 'Rapid Inscription', b4m3Name: 'Quill Mastery', b4capName: 'Thought Scribe',
}));

module.exports = { CRAFTING_TREES: CRAFTING_TREES };
