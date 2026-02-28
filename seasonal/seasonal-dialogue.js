// seasonal/seasonal-dialogue.js
// Dialogue flavor + seasonal hooks generator. Generic NPC types get
// recomposed dialogue trees from a template library with seasonal flavor.
// Quest NPCs keep structure but get seasonal flavor injected.

var rng = require('./seasonal-rng');

// Season-specific greeting fragments
var SEASON_GREETINGS = {
  Frosthollow: [
    'Cold winds blow through the passes today.',
    'Stay warm, traveler. The frost bites deep.',
    'Winter grips the land, but trade goes on.',
    'Bundle up — the snows show no mercy this year.',
  ],
  Brightbloom: [
    'The flowers are in bloom — a fine day!',
    'Spring breathes life into the land again.',
    'New growth everywhere. Even the old stumps sprout.',
    'The rains have been kind this season.',
  ],
  Sunreign: [
    'Hot enough to forge steel in the open air!',
    'The sun beats down, but the harvest promises well.',
    'Summer storms brew on the horizon.',
    'Keep water handy — the heat is unforgiving.',
  ],
  Ashwane: [
    'The leaves turn and fall. Change is in the air.',
    'Autumn colors paint the world before the long dark.',
    'Harvest time — reap what you have sown.',
    'The nights grow longer. Best prepare.',
  ],
};

// Generic dialogue templates per NPC type
var DIALOGUE_TEMPLATES = {
  wandering_merchant: {
    root: {
      text: '{greeting} Looking to buy or sell?',
      options: [
        { text: 'Show me what you have.', next: 'shop' },
        { text: 'Any news from the road?', next: 'rumor' },
        { text: 'Farewell.', next: null },
      ],
    },
    shop: {
      text: 'Take a look at my wares. Prices change with the seasons.',
      options: [
        { text: 'Back.', next: 'root' },
      ],
    },
    rumor: {
      text: '{rumor}',
      options: [
        { text: 'Interesting. Let me see your goods.', next: 'shop' },
        { text: 'Thanks for the tip.', next: null },
      ],
    },
  },
  farmer: {
    root: {
      text: '{greeting} The soil here is {soil_quality}.',
      options: [
        { text: 'Any farming advice?', next: 'advice' },
        { text: 'Good luck with the harvest.', next: null },
      ],
    },
    advice: {
      text: '{advice}',
      options: [
        { text: 'Thanks.', next: null },
      ],
    },
  },
  civilian: {
    root: {
      text: '{greeting}',
      options: [
        { text: 'What do you know about this area?', next: 'area_info' },
        { text: 'Take care.', next: null },
      ],
    },
    area_info: {
      text: '{area_info}',
      options: [
        { text: 'Thank you.', next: null },
      ],
    },
  },
};

// Seasonal rumor fragments
var SEASONAL_RUMORS = {
  Frosthollow: [
    'I heard frost wolves have been spotted near the southern passes.',
    'The frozen lakes hold rare crystals beneath the ice.',
    'Some say the lich grows stronger in winter.',
  ],
  Brightbloom: [
    'Strange flowers have been appearing in the plains.',
    'The spring thaw has uncovered old ruins in the mountains.',
    'Traders from distant lands arrive with the warm winds.',
  ],
  Sunreign: [
    'Desert caravans report unusual activity in the scorched sands.',
    'The summer heat drives creatures from the deep forests.',
    'An old temple was uncovered by the receding waters.',
  ],
  Ashwane: [
    'The harvest moon brings restless spirits.',
    'Fog-bound ships have been seen off the coast.',
    'The corruption seems to pulse stronger as winter approaches.',
  ],
};

var SOIL_QUALITY = ['rich and fertile', 'decent, if tended well', 'rocky but workable', 'blessed by the rains'];
var FARMING_ADVICE = [
  'Plant mushrooms at night — they grow faster in the dark.',
  'Scarecrows keep the crows away, and something else too...',
  'The ancient seeds are worth the wait, trust me.',
  'Watch the weather. Storms can ruin an entire crop.',
];
var AREA_INFO = [
  'This region has a long history. Many have passed through.',
  'Watch the roads at night. Not everything that moves is friendly.',
  'The local guild can point you to work if you need coin.',
  'Strange things have been happening lately. Stay alert.',
];

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'dialogue');
  var greetings = SEASON_GREETINGS[calendarSeason] || SEASON_GREETINGS.Brightbloom;
  var rumors = SEASONAL_RUMORS[calendarSeason] || SEASONAL_RUMORS.Brightbloom;

  // Generate dialogue overrides for generic NPC types
  var NPC_DIALOGUES = {};

  var types = Object.keys(DIALOGUE_TEMPLATES);
  for (var t = 0; t < types.length; t++) {
    var npcType = types[t];
    var template = DIALOGUE_TEMPLATES[npcType];
    var dialogue = {};

    for (var nodeId in template) {
      var node = template[nodeId];
      var text = node.text
        .replace('{greeting}', rng.pick(r, greetings))
        .replace('{rumor}', rng.pick(r, rumors))
        .replace('{soil_quality}', rng.pick(r, SOIL_QUALITY))
        .replace('{advice}', rng.pick(r, FARMING_ADVICE))
        .replace('{area_info}', rng.pick(r, AREA_INFO));

      dialogue[nodeId] = {
        text: text,
        options: node.options,
      };
    }

    // Validate: ensure no dangling nextNode references
    for (var nodeId in dialogue) {
      var opts = dialogue[nodeId].options;
      if (!opts) continue;
      for (var o = 0; o < opts.length; o++) {
        if (opts[o].next && !dialogue[opts[o].next]) {
          opts[o].next = null; // fix dangling reference
        }
      }
    }

    NPC_DIALOGUES[npcType] = dialogue;
  }

  return { NPC_DIALOGUES: NPC_DIALOGUES };
}

module.exports = {
  generate: generate,
  SEASON_GREETINGS: SEASON_GREETINGS,
};
