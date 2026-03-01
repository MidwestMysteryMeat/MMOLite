// seasonal/seasonal-factions.js
// Faction power dynamics generator. All 11 factions always exist (IDs stable).
// Varies zone allegiances for neutral zones, rep thresholds, shop discounts,
// and picks a dominant faction per season.

var rng = require('./seasonal-rng');

// Base faction data (IDs and core identity never change)
var BASE_FACTIONS = {
  holy_dominion:    { name: 'Holy Dominion',     homeZone: 'starter_town',    raceBonus: 'Human' },
  luminary_inquest: { name: 'Luminary Inquest',  homeZone: 'sylvaris',        raceBonus: 'Elf'   },
  iron_vanguard:    { name: 'Iron Vanguard',     homeZone: 'ironhold',        raceBonus: 'Dwarf' },
  khanate:          { name: 'The Khanate',       homeZone: 'kragmor',         raceBonus: 'Orc'   },
  veiled_hand:      { name: 'Veiled Hand',       homeZone: 'bonetrap',        raceBonus: 'Goblin'},
  lizard_covenant:  { name: 'Lizard Covenant',   homeZone: 'murkmire',        raceBonus: 'Lizard Folk' },
  tinkers_council:  { name: 'Tinkers Council',   homeZone: 'mechspire',       raceBonus: 'Gnome' },
  fortune_guild:    { name: 'Fortune Guild',     homeZone: 'fortunes_rest',   raceBonus: 'Cat Folk' },
  merchant_league:  { name: 'Merchant League',   homeZone: null,              raceBonus: null    },
  rift_wardens:     { name: 'Rift Wardens',      homeZone: null,              raceBonus: null    },
  adventure_guild:  { name: 'Adventure Guild',   homeZone: null,              raceBonus: null    },
};

// Zones that can't change faction (homeZone ties)
var FIXED_ZONES = {
  starter_town: 'holy_dominion',
  solara: 'holy_dominion',
  sylvaris: 'luminary_inquest',
  ironhold: 'iron_vanguard',
  kragmor: 'khanate',
  bonetrap: 'veiled_hand',
  murkmire: 'lizard_covenant',
  mechspire: 'tinkers_council',
  fortunes_rest: 'fortune_guild',
};

// Neutral zones that can flip allegiance each season
var FLIPPABLE_ZONES = [
  { zoneId: 'clockwork_harbor_town', candidates: ['tinkers_council', 'merchant_league', 'fortune_guild'] },
];

var BASE_REP_THRESHOLDS = [-10000, -3000, -1000, 0, 1000, 3000, 6000, 12000];
var BASE_REP_SHOP_DISCOUNT = [-0.20, -0.10, -0.05, 0, 0.05, 0.10, 0.15, 0.20];

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'factions');

  // Factions: always all 11, unchanged
  var FACTIONS = {};
  for (var fid in BASE_FACTIONS) {
    FACTIONS[fid] = { name: BASE_FACTIONS[fid].name, homeZone: BASE_FACTIONS[fid].homeZone, raceBonus: BASE_FACTIONS[fid].raceBonus };
  }

  // Pick dominant faction for this season
  var factionIds = Object.keys(FACTIONS);
  var dominant = rng.pick(r, factionIds);
  FACTIONS[dominant].dominant = true;

  // Zone faction map
  var ZONE_FACTION_MAP = {};
  for (var zid in FIXED_ZONES) ZONE_FACTION_MAP[zid] = FIXED_ZONES[zid];
  for (var i = 0; i < FLIPPABLE_ZONES.length; i++) {
    var fz = FLIPPABLE_ZONES[i];
    ZONE_FACTION_MAP[fz.zoneId] = rng.pick(r, fz.candidates);
  }

  // Rep thresholds — shift +/-500 per tier (except extremes)
  var REP_THRESHOLDS = BASE_REP_THRESHOLDS.slice();
  for (var t = 1; t < REP_THRESHOLDS.length - 1; t++) {
    REP_THRESHOLDS[t] = REP_THRESHOLDS[t] + rng.range(r, -500, 500);
  }
  // Ensure ascending order
  for (var t = 1; t < REP_THRESHOLDS.length; t++) {
    if (REP_THRESHOLDS[t] <= REP_THRESHOLDS[t-1]) {
      REP_THRESHOLDS[t] = REP_THRESHOLDS[t-1] + 100;
    }
  }

  // Shop discounts — shift +/-3%
  var REP_SHOP_DISCOUNT = BASE_REP_SHOP_DISCOUNT.slice();
  for (var d = 0; d < REP_SHOP_DISCOUNT.length; d++) {
    REP_SHOP_DISCOUNT[d] = REP_SHOP_DISCOUNT[d] === 0 ? 0 : rng.varyRound(r, REP_SHOP_DISCOUNT[d], 0.30);
  }
  // Dominant faction gets +5% universal discount
  // (stored as metadata; factions.js can read FACTIONS[x].dominant)

  return {
    FACTIONS: FACTIONS,
    REP_THRESHOLDS: REP_THRESHOLDS,
    REP_SHOP_DISCOUNT: REP_SHOP_DISCOUNT,
    ZONE_FACTION_MAP: ZONE_FACTION_MAP,
  };
}

module.exports = {
  generate: generate,
};
