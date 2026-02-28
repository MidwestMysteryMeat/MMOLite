// seasonal/seasonal-visual.js
// Client visual season parameters per calendar season.
// Output sent to client via season_visual_update event.

var rng = require('./seasonal-rng');

// Base visual configs per season
var BASE_VISUALS = {
  Frosthollow: {
    colorShift: { r: -10, g: -5, b: 15 },
    ambientLight: { r: 180, g: 200, b: 230 },
    particleEffect: 'snowfall',
    tintMultiplier: 0.92,
  },
  Brightbloom: {
    colorShift: { r: 5, g: 10, b: 0 },
    ambientLight: { r: 220, g: 235, b: 210 },
    particleEffect: 'pollen',
    tintMultiplier: 1.05,
  },
  Sunreign: {
    colorShift: { r: 10, g: 5, b: -5 },
    ambientLight: { r: 240, g: 230, b: 200 },
    particleEffect: 'shimmer',
    tintMultiplier: 1.10,
  },
  Ashwane: {
    colorShift: { r: 15, g: -5, b: -10 },
    ambientLight: { r: 210, g: 190, b: 170 },
    particleEffect: 'leaves',
    tintMultiplier: 0.95,
  },
};

function generate(seasonSeed, calendarSeason) {
  var r = rng.makeRng(seasonSeed, 'visual');
  var base = BASE_VISUALS[calendarSeason] || BASE_VISUALS.Frosthollow;

  // Small per-doom-cycle variation so visuals aren't identical between cycles
  var visual = {
    season: calendarSeason,
    colorShift: {
      r: base.colorShift.r + rng.range(r, -3, 3),
      g: base.colorShift.g + rng.range(r, -3, 3),
      b: base.colorShift.b + rng.range(r, -3, 3),
    },
    ambientLight: {
      r: Math.max(100, Math.min(255, base.ambientLight.r + rng.range(r, -10, 10))),
      g: Math.max(100, Math.min(255, base.ambientLight.g + rng.range(r, -10, 10))),
      b: Math.max(100, Math.min(255, base.ambientLight.b + rng.range(r, -10, 10))),
    },
    particleEffect: base.particleEffect,
    tintMultiplier: rng.varyRound(r, base.tintMultiplier, 0.05),
  };

  return visual;
}

module.exports = {
  generate: generate,
  BASE_VISUALS: BASE_VISUALS,
};
