// seasonal/seasonal-npcs.js
// NPC name/personality generator. Generic villager NPCs get new procedural
// names from race-appropriate syllable pools. Named quest NPCs keep identity.

var rng = require('./seasonal-rng');

// Race-specific syllable pools for name generation
var RACE_SYLLABLES = {
  Human:       ['al', 'ric', 'den', 'wil', 'mar', 'gar', 'eth', 'ton', 'ber', 'fred', 'col', 'vin', 'sten', 'hart'],
  Elf:         ['ae', 'li', 'tha', 'ren', 'si', 'el', 'na', 'ri', 'wyn', 'lor', 'fin', 'del', 'ala', 'myr'],
  Dwarf:       ['thor', 'grim', 'brok', 'dun', 'hel', 'mag', 'bor', 'arn', 'drak', 'gund', 'rok', 'hal'],
  Orc:         ['gra', 'thok', 'mak', 'gor', 'raz', 'urg', 'bul', 'krag', 'zul', 'drek', 'nash', 'rok'],
  Goblin:      ['snig', 'grix', 'nib', 'zix', 'pok', 'fiz', 'tok', 'rik', 'bip', 'gak', 'wik', 'naz'],
  Gnome:       ['tin', 'wick', 'giz', 'pip', 'cog', 'fid', 'bel', 'zep', 'rin', 'mox', 'nib', 'tik'],
  'Lizard Folk': ['ssi', 'zar', 'keth', 'rix', 'sha', 'ver', 'ssk', 'nax', 'thi', 'rak', 'zur', 'iss'],
  'Cat Folk':  ['mia', 'pur', 'kal', 'sha', 'rin', 'taw', 'vel', 'nir', 'fae', 'ash', 'sol', 'kit'],
};

// Default syllable pool (no race context)
var DEFAULT_SYLLABLES = ['ar', 'el', 'or', 'in', 'an', 'al', 'en', 'ir', 'ol', 'un', 'eth', 'ith', 'ros', 'val', 'ren', 'dor', 'kel'];

// NPC types that get procedural names (generic villagers)
var GENERIC_NPC_TYPES = ['wandering_merchant', 'farmer', 'civilian'];

// Map zones to dominant race for name generation
var ZONE_RACE = {
  starter_town: 'Human',
  solara: 'Human',
  sylvaris: 'Elf',
  ironhold: 'Dwarf',
  kragmor: 'Orc',
  bonetrap: 'Goblin',
  murkmire: 'Lizard Folk',
  mechspire: 'Gnome',
  clockwork_harbor_town: 'Gnome',
  fortunes_rest: 'Cat Folk',
};

// Title prefixes per NPC type
var TYPE_TITLES = {
  wandering_merchant: ['Peddler', 'Trader', 'Hawker', 'Merchant', 'Tinker'],
  farmer: ['Farmer', 'Grower', 'Tiller', 'Rancher', 'Harvester'],
  civilian: ['', '', '', 'Goodman', 'Goodwife'],
};

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'npcs');

  // Build NPC override map
  // Keys are NPC IDs (e.g. 'wandering_merchant_starter_town')
  var NPC_OVERRIDES = {};

  var zones = Object.keys(ZONE_RACE);
  for (var z = 0; z < zones.length; z++) {
    var zoneId = zones[z];
    var race = ZONE_RACE[zoneId];
    var syllables = RACE_SYLLABLES[race] || DEFAULT_SYLLABLES;

    for (var t = 0; t < GENERIC_NPC_TYPES.length; t++) {
      var npcType = GENERIC_NPC_TYPES[t];
      var npcId = npcType + '_' + zoneId;

      var firstName = rng.generateName(r, syllables, 2, 3);
      var titles = TYPE_TITLES[npcType] || [''];
      var title = rng.pick(r, titles);

      var name = title ? (title + ' ' + firstName) : firstName;

      NPC_OVERRIDES[npcId] = { name: name };
    }
  }

  return { NPC_OVERRIDES: NPC_OVERRIDES };
}

module.exports = {
  generate: generate,
  ZONE_RACE: ZONE_RACE,
  RACE_SYLLABLES: RACE_SYLLABLES,
};
