// seasonal/index.js
// Coordinator: generates all seasonal data from a seed, caches it,
// and applies overrides to consumer modules (rpg-data, companions, etc.).
//
// On first implementation this is a passthrough — returns current static data
// unchanged. Generators are wired in one at a time in later phases.

var rng = require('./seasonal-rng');

// Phase 2: Farm & Environment generators
var seasonalCrops = require('./seasonal-crops');
var seasonalAnimals = require('./seasonal-animals');
var seasonalFurniture = require('./seasonal-furniture');
var seasonalStations = require('./seasonal-stations');
var seasonalWeather = require('./seasonal-weather');

// Phase 3: Character progression generators
var seasonalCompanions = require('./seasonal-companions');
var seasonalPets = require('./seasonal-pets');
var seasonalAwakenings = require('./seasonal-awakenings');
var seasonalAscension = require('./seasonal-ascension');
var seasonalSkills = require('./seasonal-skills');

// Phase 4: World & social generators
var seasonalFactions = require('./seasonal-factions');
var seasonalNpcs = require('./seasonal-npcs');
var seasonalDialogue = require('./seasonal-dialogue');
var seasonalShops = require('./seasonal-shops');

// Phase 6: Client visual
var seasonalVisual = require('./seasonal-visual');

// Cached generated data for current season
var _cache = null;
var _currentSeed = null;
var _currentSeason = null;

// Baseline snapshots taken before any seasonal overrides are applied
var _baselineSkills = null;
var _baselineDialogues = null;

// Generator modules
var generators = {
  crops: seasonalCrops,
  animals: seasonalAnimals,
  furniture: seasonalFurniture,
  stations: seasonalStations,
  weather: seasonalWeather,
  companions: seasonalCompanions,
  pets: seasonalPets,
  awakenings: seasonalAwakenings,
  ascension: seasonalAscension,
  skills: seasonalSkills,
  factions: seasonalFactions,
  npcs: seasonalNpcs,
  dialogue: seasonalDialogue,
  shops: seasonalShops,
  visual: seasonalVisual,
};

// Register a generator: name -> { generate(seasonSeed, calendarSeason) -> overrides }
function registerGenerator(name, genModule) {
  generators[name] = genModule;
}

// Generate all seasonal data from seed + calendar season
function generate(seasonSeed, calendarSeason) {
  _currentSeed = seasonSeed;
  _currentSeason = calendarSeason;
  _cache = {};

  var names = Object.keys(generators);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    try {
      _cache[name] = generators[name].generate(seasonSeed, calendarSeason);
    } catch (err) {
      console.error('[seasonal] Generator "' + name + '" failed:', err.message);
      _cache[name] = {};
    }
  }

  console.log('[seasonal] Generated ' + names.length + ' subsystems for seed ' + seasonSeed + ' (' + calendarSeason + ')');
  return _cache;
}

// Apply all generated overrides to their consumer modules
function apply() {
  if (!_cache) return;

  // rpg-data overrides (crops, animals, furniture, stations, weather, awakenings)
  var rpgOverrides = {};
  var rpgKeys = ['crops', 'animals', 'furniture', 'stations', 'weather', 'awakenings'];
  for (var i = 0; i < rpgKeys.length; i++) {
    var genData = _cache[rpgKeys[i]];
    if (genData) {
      for (var key in genData) {
        rpgOverrides[key] = genData[key];
      }
    }
  }

  var rpgData = require('../rpg-data');

  // Snapshot baselines on first apply so subsequent season changes don't accumulate
  if (!_baselineSkills && rpgData.SKILL_DEFINITIONS) {
    _baselineSkills = {};
    for (var bsk in rpgData.SKILL_DEFINITIONS) _baselineSkills[bsk] = rpgData.SKILL_DEFINITIONS[bsk];
  }
  if (!_baselineDialogues && rpgData.NPC_DIALOGUES) {
    _baselineDialogues = {};
    for (var bdk in rpgData.NPC_DIALOGUES) _baselineDialogues[bdk] = rpgData.NPC_DIALOGUES[bdk];
  }

  // Seasonal skills are additive — merge into baseline (not mutated rpgData)
  if (_cache.skills && _cache.skills.SEASONAL_SKILLS) {
    var merged = {};
    var baseSkills = _baselineSkills || rpgData.SKILL_DEFINITIONS;
    for (var sk in baseSkills) merged[sk] = baseSkills[sk];
    var seasonal = _cache.skills.SEASONAL_SKILLS;
    for (var sk in seasonal) merged[sk] = seasonal[sk];
    rpgOverrides.SKILL_DEFINITIONS = merged;
  }

  // Seasonal dialogues are additive — merge into baseline (not mutated rpgData)
  if (_cache.dialogue && _cache.dialogue.NPC_DIALOGUES) {
    var mergedDialogues = {};
    var baseDlg = _baselineDialogues || rpgData.NPC_DIALOGUES;
    for (var dk in baseDlg) mergedDialogues[dk] = baseDlg[dk];
    var seasonalDialogues = _cache.dialogue.NPC_DIALOGUES;
    for (var dk in seasonalDialogues) mergedDialogues[dk] = seasonalDialogues[dk];
    rpgOverrides.NPC_DIALOGUES = mergedDialogues;
  }

  if (Object.keys(rpgOverrides).length > 0) {
    if (rpgData.applySeasonalOverrides) {
      rpgData.applySeasonalOverrides(rpgOverrides);
    }
  }

  // Handler-specific overrides
  _applyHandlerOverrides('companions', '../handlers/companions');
  _applyHandlerOverrides('pets', '../handlers/pets');
  _applyHandlerOverrides('factions', '../handlers/factions');
  _applyHandlerOverrides('ascension', '../handlers/ascension');
  _applyHandlerOverrides('shops', '../handlers/npc-shop');

  console.log('[seasonal] Applied overrides to all consumer modules');
}

function _applyHandlerOverrides(genName, modulePath) {
  var genData = _cache[genName];
  if (!genData || Object.keys(genData).length === 0) return;
  try {
    var mod = require(modulePath);
    if (mod.applySeasonalOverrides) {
      mod.applySeasonalOverrides(genData);
    }
  } catch (err) {
    console.error('[seasonal] Failed to apply overrides for ' + genName + ':', err.message);
  }
}

// Called when calendar season changes (within same doom cycle)
function onSeasonChange(seasonSeed, newSeason) {
  generate(seasonSeed, newSeason);
  apply();
}

// Get current visual config for client
function getVisual() {
  if (_cache && _cache.visual) return _cache.visual;
  return _getDefaultVisual(_currentSeason);
}

function _getDefaultVisual(season) {
  var defaults = {
    Frosthollow: { colorShift: { r: -10, g: -5, b: 15 }, ambientLight: { r: 180, g: 200, b: 230 }, particleEffect: 'snowfall', tintMultiplier: 0.92 },
    Brightbloom: { colorShift: { r: 5, g: 10, b: 0 },    ambientLight: { r: 220, g: 235, b: 210 }, particleEffect: 'pollen',   tintMultiplier: 1.05 },
    Sunreign:    { colorShift: { r: 10, g: 5, b: -5 },    ambientLight: { r: 240, g: 230, b: 200 }, particleEffect: 'shimmer',  tintMultiplier: 1.10 },
    Ashwane:     { colorShift: { r: 15, g: -5, b: -10 },  ambientLight: { r: 210, g: 190, b: 170 }, particleEffect: 'leaves',   tintMultiplier: 0.95 },
  };
  return defaults[season] || defaults.Frosthollow;
}

// Get full generated cache (for NPC overrides, etc.)
function get() {
  return _cache || {};
}

// Get current seed/season
function getSeed() { return _currentSeed; }
function getSeason() { return _currentSeason; }

module.exports = {
  generate: generate,
  apply: apply,
  onSeasonChange: onSeasonChange,
  getVisual: getVisual,
  get: get,
  getSeed: getSeed,
  getSeason: getSeason,
  registerGenerator: registerGenerator,
};
