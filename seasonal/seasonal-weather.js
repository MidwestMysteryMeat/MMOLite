// seasonal/seasonal-weather.js
// Biome weather probability table generator. Shifts weather probabilities
// based on calendar season so winter is snowier, summer is clearer, etc.

var rng = require('./seasonal-rng');

// Base weather tables (source of truth from world-data.js)
var BASE_WEATHER = {
  ocean:        { clear:40, rain:30, storm:20, fog:10, snow:0  },
  deep_ocean:   { clear:30, rain:25, storm:35, fog:10, snow:0  },
  beach:        { clear:50, rain:20, storm:15, fog:10, snow:5  },
  plains:       { clear:45, rain:25, storm:15, fog:10, snow:5  },
  forest:       { clear:30, rain:30, storm:10, fog:25, snow:5  },
  dense_forest: { clear:20, rain:35, storm:10, fog:30, snow:5  },
  swamp:        { clear:15, rain:35, storm:15, fog:35, snow:0  },
  desert:       { clear:70, rain:5,  storm:10, fog:5,  snow:0  },
  tundra:       { clear:30, rain:5,  storm:20, fog:10, snow:35 },
  frozen:       { clear:20, rain:0,  storm:25, fog:10, snow:45 },
  mountains:    { clear:35, rain:15, storm:25, fog:20, snow:5  },
  highlands:    { clear:40, rain:20, storm:20, fog:15, snow:5  },
  volcanic:     { clear:20, rain:5,  storm:40, fog:30, snow:0  },
  cave:         { clear:80, rain:0,  storm:0,  fog:20, snow:0  },
  underground:  { clear:90, rain:0,  storm:0,  fog:10, snow:0  },
  hollow_earth: { clear:60, rain:10, storm:5,  fog:25, snow:0  },
  coastal:      { clear:45, rain:25, storm:20, fog:10, snow:0  },
};

// Season shifts — additive to base weights
var SEASON_SHIFTS = {
  Frosthollow: { clear: -10, rain: -5,  storm: 5,  fog: 0,   snow: 15 },
  Brightbloom: { clear: 5,   rain: 10,  storm: -5, fog: -5,  snow: -8 },
  Sunreign:    { clear: 15,  rain: -10, storm: -5, fog: -5,  snow: -5 },
  Ashwane:     { clear: -8,  rain: 0,   storm: 5,  fog: 10,  snow: -5 },
};

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'weather');
  var shift = SEASON_SHIFTS[calendarSeason] || SEASON_SHIFTS.Brightbloom;

  var BIOME_WEATHER = {};
  var biomes = Object.keys(BASE_WEATHER);
  for (var i = 0; i < biomes.length; i++) {
    var biome = biomes[i];
    var base = BASE_WEATHER[biome];

    // Indoor biomes don't shift
    if (biome === 'cave' || biome === 'underground' || biome === 'hollow_earth') {
      BIOME_WEATHER[biome] = { clear: base.clear, rain: base.rain, storm: base.storm, fog: base.fog, snow: base.snow };
      continue;
    }

    var entry = {};
    var weatherTypes = ['clear', 'rain', 'storm', 'fog', 'snow'];
    for (var w = 0; w < weatherTypes.length; w++) {
      var wt = weatherTypes[w];
      // Apply shift + small random variation
      var val = (base[wt] || 0) + (shift[wt] || 0) + rng.range(r, -3, 3);
      entry[wt] = Math.max(0, val);
    }
    BIOME_WEATHER[biome] = entry;
  }

  // BIOME_WEATHER_EFFECTS stay unchanged — they're mechanical, not seasonal
  return { BIOME_WEATHER: BIOME_WEATHER };
}

module.exports = {
  generate: generate,
};
