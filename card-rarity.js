// card-rarity.js
// Rarity tiers, pity system, and rarity rolling for the card gacha.

var RARITY_TIERS = [
  { id: 'common',      name: 'Common',      weight: 4500, color: '#888888', order: 0 },
  { id: 'uncommon',    name: 'Uncommon',     weight: 2500, color: '#22cc22', order: 1 },
  { id: 'rare',        name: 'Rare',         weight: 1500, color: '#3388ff', order: 2 },
  { id: 'ultra_rare',  name: 'Ultra Rare',   weight: 800,  color: '#aa44ff', order: 3 },
  { id: 'mythic_rare', name: 'Mythic Rare',  weight: 400,  color: '#ffaa00', order: 4 },
  { id: 'legendary',   name: 'Legendary',    weight: 200,  color: '#ff6600', order: 5 },
  { id: 'godly',       name: 'Godly',        weight: 80,   color: '#ff0000', order: 6 },
  { id: 'relic',       name: 'Relic',        weight: 20,   color: '#ffffff', order: 7 },
];

var RARITY_BY_ID = {};
for (var ri = 0; ri < RARITY_TIERS.length; ri++) {
  RARITY_BY_ID[RARITY_TIERS[ri].id] = RARITY_TIERS[ri];
}

var TOTAL_RARITY_WEIGHT = 0;
for (var rw = 0; rw < RARITY_TIERS.length; rw++) {
  TOTAL_RARITY_WEIGHT += RARITY_TIERS[rw].weight;
}

// For cards marked rarityScalable: true, numeric effect values are multiplied
// by RARITY_SCALE[rolledRarity] / RARITY_SCALE[templateRarity] at generation.
var RARITY_SCALE = {
  common:     1.0,
  uncommon:   2.0,
  rare:       4.0,
  ultra_rare: 7.0,
  mythic_rare: 7.0,
  legendary:  7.0,
  godly:      7.0,
  relic:      7.0,
};

var SOFT_PITY_START = 80;
var HARD_PITY = 120;
var SOFT_PITY_RATE = 0.02;

function rollRarity(isCatFolk, pity) {
  pity.pullsSinceLegendary++;

  if (pity.pullsSinceLegendary >= HARD_PITY) {
    pity.pullsSinceLegendary = 0;
    return RARITY_TIERS[5];
  }

  var roll = Math.random() * TOTAL_RARITY_WEIGHT;
  var cumulative = 0;
  var result = RARITY_TIERS[0];

  var pityBoost = 0;
  if (pity.pullsSinceLegendary > SOFT_PITY_START) {
    pityBoost = (pity.pullsSinceLegendary - SOFT_PITY_START) * SOFT_PITY_RATE;
  }

  for (var i = 0; i < RARITY_TIERS.length; i++) {
    cumulative += RARITY_TIERS[i].weight;
    if (roll < cumulative) {
      result = RARITY_TIERS[i];
      break;
    }
  }

  if (pityBoost > 0 && result.order < 5) {
    if (Math.random() < pityBoost) {
      result = RARITY_TIERS[5];
    }
  }

  if (isCatFolk && result.order < RARITY_TIERS.length - 1) {
    if (Math.random() < 0.12) {
      result = RARITY_TIERS[result.order + 1];
    }
  }

  if (result.order >= 5) {
    pity.pullsSinceLegendary = 0;
  }

  return result;
}

module.exports = {
  RARITY_TIERS: RARITY_TIERS,
  RARITY_BY_ID: RARITY_BY_ID,
  TOTAL_RARITY_WEIGHT: TOTAL_RARITY_WEIGHT,
  RARITY_SCALE: RARITY_SCALE,
  SOFT_PITY_START: SOFT_PITY_START,
  HARD_PITY: HARD_PITY,
  SOFT_PITY_RATE: SOFT_PITY_RATE,
  rollRarity: rollRarity,
};
