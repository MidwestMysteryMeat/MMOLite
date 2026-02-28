// seasonal/seasonal-rng.js
// Shared seeded RNG helpers for all seasonal generators.
// Wraps worldgen.seededRandom + worldgen.chunkSeed to produce
// isolated, deterministic RNG streams per subsystem.

var worldgen = require('../worldgen');

// Derive a sub-seed for a specific namespace from the season seed.
// seasonSeed: number, namespace: string -> number
function subSeed(seasonSeed, namespace) {
  return worldgen.chunkSeed(seasonSeed, 0, 'seasonal:' + namespace);
}

// Create a seeded RNG closure for a subsystem.
// Returns () -> float in [0,1)
function makeRng(seasonSeed, namespace) {
  return worldgen.seededRandom(subSeed(seasonSeed, namespace));
}

// Pick a random element from arr using rng
function pick(rng, arr) {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(rng() * arr.length)];
}

// Random integer in [min, max] inclusive
function range(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// Random float in [min, max)
function rangeFloat(rng, min, max) {
  return min + rng() * (max - min);
}

// Fisher-Yates shuffle (returns new array, does not mutate input)
function shuffle(rng, arr) {
  var copy = arr.slice();
  for (var i = copy.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

// Procedural name generator from syllable pool
// Returns a string of minSyl..maxSyl syllables concatenated, first letter capitalized
function generateName(rng, syllablePool, minSyl, maxSyl) {
  var count = range(rng, minSyl, maxSyl);
  var name = '';
  for (var i = 0; i < count; i++) {
    name += pick(rng, syllablePool);
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Pick N unique elements from arr (without replacement)
function pickN(rng, arr, n) {
  var shuffled = shuffle(rng, arr);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

// Vary a numeric value by +/- pct (e.g. pct=0.20 means +/-20%)
function vary(rng, base, pct) {
  var mult = 1 + rangeFloat(rng, -pct, pct);
  return base * mult;
}

// Vary and round to integer
function varyInt(rng, base, pct) {
  return Math.round(vary(rng, base, pct));
}

// Vary and round to 2 decimal places
function varyRound(rng, base, pct) {
  return Math.round(vary(rng, base, pct) * 100) / 100;
}

module.exports = {
  subSeed: subSeed,
  makeRng: makeRng,
  pick: pick,
  range: range,
  rangeFloat: rangeFloat,
  shuffle: shuffle,
  generateName: generateName,
  pickN: pickN,
  vary: vary,
  varyInt: varyInt,
  varyRound: varyRound,
};
