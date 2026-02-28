// seasonal/seasonal-ascension.js
// Procedural ascension node generator. Picks 8-10 nodes per season from
// a master pool, varies AP costs +/-1, maxRank, and effect values.

var rng = require('./seasonal-rng');

var ASCENSION_MASTER_POOL = [
  // Original 8
  { key: 'iron_resolve',      name: 'Iron Resolve',      desc: '+5% max HP per rank',                  apCost: 1, maxRank: 5, effect: { type: 'stat_pct', stat: 'vigor', value: 0.05 } },
  { key: 'deep_knowledge',    name: 'Deep Knowledge',    desc: '+5% XP gain per rank',                 apCost: 1, maxRank: 5, effect: { type: 'xp_pct', value: 0.05 } },
  { key: 'seasoned_traveler', name: 'Seasoned Traveler', desc: '+3% move speed per rank',               apCost: 1, maxRank: 5, effect: { type: 'speed_pct', value: 0.03 } },
  { key: 'hoarders_instinct', name: "Hoarder's Instinct",desc: '+20 carry capacity per rank',           apCost: 1, maxRank: 3, effect: { type: 'carry_flat', value: 20 } },
  { key: 'artisan_legacy',    name: 'Artisan Legacy',    desc: '+10% crafting quality window per rank', apCost: 2, maxRank: 3, effect: { type: 'crafting_window_pct', value: 0.10 } },
  { key: 'lucky_star',        name: 'Lucky Star',        desc: '+1% card rarity bump per rank',         apCost: 2, maxRank: 3, effect: { type: 'card_luck_pct', value: 0.01 } },
  { key: 'rift_veteran',      name: 'Rift Veteran',      desc: '+5 floor starting bonus in Rift',       apCost: 3, maxRank: 2, effect: { type: 'rift_start_floor', value: 5 } },
  { key: 'eternal_mark',      name: 'Eternal Mark',      desc: 'Cosmetic: Ascension glow on portrait', apCost: 1, maxRank: 1, effect: { type: 'cosmetic', id: 'ascension_glow' } },
  // New nodes
  { key: 'battle_hardened',   name: 'Battle Hardened',   desc: '+4% physical damage per rank',          apCost: 1, maxRank: 5, effect: { type: 'phys_damage_pct', value: 0.04 } },
  { key: 'merchants_eye',     name: "Merchant's Eye",    desc: '+5% shop discount per rank',            apCost: 1, maxRank: 3, effect: { type: 'shop_discount_pct', value: 0.05 } },
  { key: 'naturalist',        name: 'Naturalist',        desc: '+8% gathering yield per rank',          apCost: 1, maxRank: 4, effect: { type: 'gather_yield_pct', value: 0.08 } },
  { key: 'dark_resilience',   name: 'Dark Resilience',   desc: '+5% corruption resistance per rank',    apCost: 2, maxRank: 3, effect: { type: 'corruption_resist_pct', value: 0.05 } },
  { key: 'arcane_memory',     name: 'Arcane Memory',     desc: '+3% spell damage per rank',             apCost: 2, maxRank: 4, effect: { type: 'spell_damage_pct', value: 0.03 } },
  { key: 'fleet_foot',        name: 'Fleet Foot',        desc: '-5% stamina cost per rank',             apCost: 1, maxRank: 3, effect: { type: 'stamina_cost_pct', value: -0.05 } },
  { key: 'soul_collector',    name: 'Soul Collector',    desc: '+10% soul shard gain per rank',         apCost: 2, maxRank: 3, effect: { type: 'soul_shard_pct', value: 0.10 } },
];

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'ascension');

  var count = rng.range(r, 8, 10);
  var selected = rng.pickN(r, ASCENSION_MASTER_POOL, count);

  var ASCENSION_TREE = {};
  for (var i = 0; i < selected.length; i++) {
    var node = selected[i];
    var apCost = Math.max(1, node.apCost + rng.range(r, -1, 1));
    var maxRank = Math.max(1, node.maxRank + rng.range(r, -1, 1));

    // Deep copy effect
    var effect = {};
    for (var k in node.effect) effect[k] = node.effect[k];
    // Vary numeric effect value
    if (typeof effect.value === 'number') {
      effect.value = rng.varyRound(r, effect.value, 0.15);
    }

    ASCENSION_TREE[node.key] = {
      name: node.name,
      desc: node.desc,
      apCost: apCost,
      maxRank: maxRank,
      effect: effect,
    };
  }

  return { ASCENSION_TREE: ASCENSION_TREE };
}

module.exports = {
  generate: generate,
  ASCENSION_MASTER_POOL: ASCENSION_MASTER_POOL,
};
