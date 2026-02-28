// seasonal/seasonal-skills.js
// Additive seasonal skill generator. Core skills always present;
// this adds 2-4 seasonal bonus skills from a pool of ~10.

var rng = require('./seasonal-rng');

var SEASONAL_SKILL_POOL = [
  { key: 'frost_foraging',   name: 'Frost Foraging',   icon: 'skills/Herbalism/',    category: 'gathering' },
  { key: 'sun_channeling',   name: 'Sun Channeling',   icon: 'skills/Enchantment/',  category: 'combat' },
  { key: 'storm_weaving',    name: 'Storm Weaving',    icon: 'skills/Enchantment/',  category: 'combat' },
  { key: 'shadow_binding',   name: 'Shadow Binding',   icon: 'skills/Enchantment/',  category: 'combat' },
  { key: 'tide_craft',       name: 'Tide Craft',       icon: 'skills/Cooking_fishing/', category: 'crafting' },
  { key: 'ember_smithing',   name: 'Ember Smithing',   icon: 'skills/Blacksmith/',   category: 'crafting' },
  { key: 'crystal_cutting',  name: 'Crystal Cutting',  icon: 'skills/Blacksmith/',   category: 'crafting' },
  { key: 'beast_lore',       name: 'Beast Lore',       icon: 'skills/Herbalism/',    category: 'exploration' },
  { key: 'void_resistance',  name: 'Void Resistance',  icon: 'skills/Enchantment/',  category: 'combat' },
  { key: 'wind_running',     name: 'Wind Running',     icon: 'skills/Blacksmith/',   category: 'exploration' },
];

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'skills');

  var count = rng.range(r, 2, 4);
  var selected = rng.pickN(r, SEASONAL_SKILL_POOL, count);

  // Build additive skill definitions (merged into existing SKILL_DEFINITIONS)
  var additions = {};
  for (var i = 0; i < selected.length; i++) {
    var skill = selected[i];
    additions[skill.key] = {
      name: skill.name,
      icon: skill.icon,
      category: skill.category,
      seasonal: true,
    };
  }

  return { SEASONAL_SKILLS: additions };
}

module.exports = {
  generate: generate,
  SEASONAL_SKILL_POOL: SEASONAL_SKILL_POOL,
};
