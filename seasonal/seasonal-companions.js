// seasonal/seasonal-companions.js
// Procedural companion class generator. Picks 5-8 companion classes per season
// from a master pool, varies stats +/-25%, generates names and personality traits.

var rng = require('./seasonal-rng');

var SYLLABLE_POOL = ['ar','el','or','in','an','al','en','ir','ol','un','eth','ith','oth','ash','esh','ros','val','ren','dor','kel','mar','fen','gal','bor','til'];

var COMPANION_MASTER_POOL = [
  // Original 6
  { key: 'soldier',     name: 'Soldier',     dailyWage: 50,  baseDmg: 15, baseHp: 100, abilityTag: 'melee'   },
  { key: 'archer',      name: 'Archer',      dailyWage: 60,  baseDmg: 12, baseHp: 80,  abilityTag: 'ranged'  },
  { key: 'battle_mage', name: 'Battle Mage', dailyWage: 80,  baseDmg: 20, baseHp: 70,  abilityTag: 'magic'   },
  { key: 'healer',      name: 'Healer',      dailyWage: 90,  baseDmg: 5,  baseHp: 75,  abilityTag: 'heal'    },
  { key: 'thief',       name: 'Thief',       dailyWage: 70,  baseDmg: 18, baseHp: 65,  abilityTag: 'stealth' },
  { key: 'berserker',   name: 'Berserker',   dailyWage: 65,  baseDmg: 25, baseHp: 90,  abilityTag: 'berserk' },
  // Exotic classes
  { key: 'scout',       name: 'Scout',       dailyWage: 55,  baseDmg: 10, baseHp: 70,  abilityTag: 'ranged'  },
  { key: 'shaman',      name: 'Shaman',      dailyWage: 85,  baseDmg: 14, baseHp: 80,  abilityTag: 'magic'   },
  { key: 'engineer',    name: 'Engineer',    dailyWage: 95,  baseDmg: 8,  baseHp: 85,  abilityTag: 'ranged'  },
  { key: 'brawler',     name: 'Brawler',     dailyWage: 60,  baseDmg: 22, baseHp: 95,  abilityTag: 'melee'   },
  { key: 'necromancer', name: 'Necromancer', dailyWage: 100, baseDmg: 18, baseHp: 60,  abilityTag: 'magic'   },
  { key: 'ranger',      name: 'Ranger',      dailyWage: 75,  baseDmg: 16, baseHp: 75,  abilityTag: 'ranged'  },
];

var PERSONALITY_TRAITS = [
  'stoic', 'cheerful', 'grumpy', 'cautious', 'reckless', 'loyal',
  'mysterious', 'talkative', 'quiet', 'devout', 'mercenary', 'scholarly',
  'scarred', 'young', 'veteran', 'displaced', 'ambitious', 'weary',
];

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'companions');

  var count = rng.range(r, 5, 8);
  var selected = rng.pickN(r, COMPANION_MASTER_POOL, count);

  var COMPANION_CLASSES = {};
  for (var i = 0; i < selected.length; i++) {
    var comp = selected[i];
    COMPANION_CLASSES[comp.key] = {
      name: comp.name,
      dailyWage: rng.varyInt(r, comp.dailyWage, 0.25),
      baseDmg: rng.varyInt(r, comp.baseDmg, 0.25),
      baseHp: rng.varyInt(r, comp.baseHp, 0.25),
      abilityTag: comp.abilityTag,
      personality: rng.pick(r, PERSONALITY_TRAITS),
      generatedName: rng.generateName(r, SYLLABLE_POOL, 2, 3),
    };
  }

  return { COMPANION_CLASSES: COMPANION_CLASSES };
}

module.exports = {
  generate: generate,
  COMPANION_MASTER_POOL: COMPANION_MASTER_POOL,
};
