// seasonal/seasonal-stations.js
// Station tier variation generator. Keeps the existing 5 station chains but
// varies qualityBonus per tier (+/-15%) and extras chance values (+/-20%).
// Occasionally adds a 6th station chain from an alternative pool.

var rng = require('./seasonal-rng');

// Base station chains (copied from world-data.js shape)
var BASE_CHAINS = [
  [
    { key: 'forge',             tier: 1, qualityBonus: 0,    extras: {} },
    { key: 'advanced_forge',    tier: 2, qualityBonus: 0.10, extras: {},                             upgradedFrom: 'forge' },
    { key: 'master_forge',      tier: 3, qualityBonus: 0.25, extras: { rareMaterialChance: 0.05 },   upgradedFrom: 'advanced_forge' },
  ],
  [
    { key: 'alchemy_table',          tier: 1, qualityBonus: 0,    extras: {} },
    { key: 'advanced_alchemy_table', tier: 2, qualityBonus: 0.15, extras: {},                              upgradedFrom: 'alchemy_table' },
    { key: 'master_alchemy_table',   tier: 3, qualityBonus: 0.30, extras: { doublePotionChance: 0.10 },    upgradedFrom: 'advanced_alchemy_table' },
  ],
  [
    { key: 'loom',          tier: 1, qualityBonus: 0,    extras: {} },
    { key: 'advanced_loom', tier: 2, qualityBonus: 0.10, extras: {},                             upgradedFrom: 'loom' },
    { key: 'master_loom',   tier: 3, qualityBonus: 0.20, extras: { materialSaveChance: 0.10 },   upgradedFrom: 'advanced_loom' },
  ],
  [
    { key: 'brewery',          tier: 1, qualityBonus: 0,    extras: {} },
    { key: 'advanced_brewery', tier: 2, qualityBonus: 0.10, extras: {},                           upgradedFrom: 'brewery' },
    { key: 'master_brewery',   tier: 3, qualityBonus: 0.20, extras: { doubleBrewChance: 0.08 },   upgradedFrom: 'advanced_brewery' },
  ],
  [
    { key: 'enchanting_table',          tier: 1, qualityBonus: 0,    extras: {} },
    { key: 'advanced_enchanting_table', tier: 2, qualityBonus: 0.15, extras: { inscriptionBonus: 0.10 }, upgradedFrom: 'enchanting_table' },
  ],
];

// Alternative 6th chains
var ALT_CHAINS = [
  [
    { key: 'jewelers_bench',          tier: 1, qualityBonus: 0,    extras: {} },
    { key: 'advanced_jewelers_bench', tier: 2, qualityBonus: 0.12, extras: {},                             upgradedFrom: 'jewelers_bench' },
    { key: 'master_jewelers_bench',   tier: 3, qualityBonus: 0.28, extras: { gemCritChance: 0.06 },        upgradedFrom: 'advanced_jewelers_bench' },
  ],
  [
    { key: 'tanning_rack',          tier: 1, qualityBonus: 0,    extras: {} },
    { key: 'advanced_tanning_rack', tier: 2, qualityBonus: 0.10, extras: {},                            upgradedFrom: 'tanning_rack' },
    { key: 'master_tanning_rack',   tier: 3, qualityBonus: 0.22, extras: { leatherSaveChance: 0.08 },   upgradedFrom: 'advanced_tanning_rack' },
  ],
  [
    { key: 'scribes_desk',          tier: 1, qualityBonus: 0,    extras: {} },
    { key: 'advanced_scribes_desk', tier: 2, qualityBonus: 0.12, extras: { scrollCopyChance: 0.05 },   upgradedFrom: 'scribes_desk' },
  ],
];

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'stations');

  var STATION_UPGRADE_TIERS = {};

  // Process all 5 base chains
  for (var c = 0; c < BASE_CHAINS.length; c++) {
    var chain = BASE_CHAINS[c];
    for (var s = 0; s < chain.length; s++) {
      var station = chain[s];
      var entry = {
        tier: station.tier,
        qualityBonus: station.tier === 1 ? 0 : rng.varyRound(r, station.qualityBonus, 0.15),
        extras: _varyExtras(r, station.extras),
      };
      if (station.upgradedFrom) entry.upgradedFrom = station.upgradedFrom;
      STATION_UPGRADE_TIERS[station.key] = entry;
    }
  }

  // 35% chance to add a 6th chain
  if (r() < 0.35) {
    var altChain = rng.pick(r, ALT_CHAINS);
    for (var a = 0; a < altChain.length; a++) {
      var alt = altChain[a];
      var altEntry = {
        tier: alt.tier,
        qualityBonus: alt.tier === 1 ? 0 : rng.varyRound(r, alt.qualityBonus, 0.15),
        extras: _varyExtras(r, alt.extras),
      };
      if (alt.upgradedFrom) altEntry.upgradedFrom = alt.upgradedFrom;
      STATION_UPGRADE_TIERS[alt.key] = altEntry;
    }
  }

  return { STATION_UPGRADE_TIERS: STATION_UPGRADE_TIERS };
}

function _varyExtras(r, extras) {
  var result = {};
  for (var key in extras) {
    result[key] = rng.varyRound(r, extras[key], 0.20);
  }
  return result;
}

module.exports = {
  generate: generate,
};
