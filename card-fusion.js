// card-fusion.js
// Card fusion validation and merging logic.

var crypto = require('crypto');

var cardRarity = require('./card-rarity');
var RARITY_BY_ID = cardRarity.RARITY_BY_ID;
var RARITY_TIERS = cardRarity.RARITY_TIERS;

var cardGeneration = require('./card-generation');
var CARD_STYLES = cardGeneration.CARD_STYLES;
var generateSerial = cardGeneration.generateSerial;
var MAX_FUSION_COUNT = cardGeneration.MAX_FUSION_COUNT;

var cardModifiers = require('./card-modifiers');
var rollMutation = cardModifiers.rollMutation;
var applyMutation = cardModifiers.applyMutation;

var cardAffixes = require('./card-affixes');
var refreshCardEffects = cardAffixes.refreshCardEffects;

// ---------------------------------------------------------------------------
// Fusion Validation
// ---------------------------------------------------------------------------

function canFuseCards(card1, card2) {
  if (!card1 || !card2) return { ok: false, error: 'Invalid cards' };
  if (card1.instanceId === card2.instanceId) return { ok: false, error: 'Cannot fuse a card with itself' };
  if (card1.rarity !== card2.rarity) return { ok: false, error: 'Cards must be the same rarity' };
  if (card1.rarity === 'relic') return { ok: false, error: 'Relic cards cannot be fused' };
  if (card1.fusionCount >= MAX_FUSION_COUNT) return { ok: false, error: 'Card 1 has reached max fusion count' };
  if (card2.fusionCount >= MAX_FUSION_COUNT) return { ok: false, error: 'Card 2 has reached max fusion count' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Fusion Execution
// ---------------------------------------------------------------------------

function fuseCards(card1, card2, racialBonus) {
  // racialBonus: optional { luckBonus, mutationChanceBonus } from caller's race data
  var check = canFuseCards(card1, card2);
  if (!check.ok) return { error: check.error };

  var currentRarity = RARITY_BY_ID[card1.rarity];
  if (!currentRarity || currentRarity.order >= RARITY_TIERS.length - 1) {
    return { error: 'Cannot fuse to higher rarity' };
  }
  var nextRarity = RARITY_TIERS[currentRarity.order + 1];
  var newFusionCount = Math.max(card1.fusionCount, card2.fusionCount) + 1;

  // Merge base effects only (not full effects[] which include affix contributions)
  var base1 = card1._baseEffects ? JSON.parse(JSON.stringify(card1._baseEffects)) : JSON.parse(JSON.stringify(card1.effects));
  var base2 = card2._baseEffects ? JSON.parse(JSON.stringify(card2._baseEffects)) : JSON.parse(JSON.stringify(card2.effects));
  var mergedBase;
  if (card1.type === card2.type && card1.cardId === card2.cardId) {
    // Same card: take max of each effect + 5% same-card bonus
    mergedBase = base1;
    for (var i = 0; i < mergedBase.length; i++) {
      if (typeof mergedBase[i].value === 'number') {
        var b2Val = (base2[i] && typeof base2[i].value === 'number') ? base2[i].value : 0;
        mergedBase[i].value = Math.round(Math.max(mergedBase[i].value, b2Val) * 1.05 * 100) / 100;
      }
      if (typeof mergedBase[i].base === 'number') {
        var b2Base = (base2[i] && typeof base2[i].base === 'number') ? base2[i].base : 0;
        mergedBase[i].base = Math.round(Math.max(mergedBase[i].base, b2Base) * 1.05);
      }
    }
  } else {
    // Different cards: true hybrid — merge both base effect sets
    mergedBase = base1;
    for (var j = 0; j < base2.length; j++) {
      var e2 = base2[j];
      var matchIdx = -1;
      for (var m = 0; m < mergedBase.length; m++) {
        var e1 = mergedBase[m];
        if (e1.type === e2.type &&
            (e1.stat || null) === (e2.stat || null) &&
            (e1.skill || null) === (e2.skill || null) &&
            (e1.element || null) === (e2.element || null)) {
          matchIdx = m;
          break;
        }
      }
      if (matchIdx >= 0) {
        if (typeof e2.value === 'number') mergedBase[matchIdx].value = Math.round(((mergedBase[matchIdx].value || 0) + e2.value) * 100) / 100;
        if (typeof e2.base === 'number') mergedBase[matchIdx].base = Math.round((mergedBase[matchIdx].base || 0) + e2.base);
      } else {
        mergedBase.push(e2);
      }
    }
  }

  // Apply fusion level bonus (+5% per fusion level) to base effects
  // Affix: fusion_value_bonus — boost fusion stat bonus from input cards
  var affixFusionBonus = 0;
  var _bothCards = [card1, card2];
  for (var _fbi = 0; _fbi < _bothCards.length; _fbi++) {
    var _fbc = _bothCards[_fbi];
    if (_fbc.affixes && Array.isArray(_fbc.affixes)) {
      for (var _fbj = 0; _fbj < _fbc.affixes.length; _fbj++) {
        if (_fbc.affixes[_fbj] && _fbc.affixes[_fbj].effect && _fbc.affixes[_fbj].effect.type === 'fusion_value_bonus') {
          affixFusionBonus += (_fbc.affixes[_fbj].effect.value || 0);
        }
      }
    }
  }
  var fusionBonus = 1 + (newFusionCount * 0.05) + affixFusionBonus;
  for (var k = 0; k < mergedBase.length; k++) {
    if (typeof mergedBase[k].value === 'number') mergedBase[k].value = Math.round(mergedBase[k].value * fusionBonus * 100) / 100;
    if (typeof mergedBase[k].base === 'number') mergedBase[k].base = Math.round(mergedBase[k].base * fusionBonus);
  }

  // Inherit best style from either card
  var STYLE_ORDER = ['normal', 'holographic', 'golden', 'prismatic', 'void'];
  var styleIdx1 = STYLE_ORDER.indexOf(card1.style || 'normal');
  var styleIdx2 = STYLE_ORDER.indexOf(card2.style || 'normal');
  var fusedStyle = STYLE_ORDER[Math.max(styleIdx1, styleIdx2)];
  var fusedBorderEffect = CARD_STYLES[fusedStyle] ? CARD_STYLES[fusedStyle].borderEffect : null;

  // Merge affixes: same id keeps highest tier, new ids are appended
  var mergedAffixes = JSON.parse(JSON.stringify(card1.affixes || []));
  var card2Affixes = card2.affixes || [];
  for (var _axi = 0; _axi < card2Affixes.length; _axi++) {
    var _ax2 = card2Affixes[_axi];
    var _axFound = false;
    for (var _axj = 0; _axj < mergedAffixes.length; _axj++) {
      if (mergedAffixes[_axj].id === _ax2.id) {
        if (mergedAffixes[_axj].tier < _ax2.tier) {
          mergedAffixes[_axj] = JSON.parse(JSON.stringify(_ax2));
        }
        _axFound = true;
        break;
      }
    }
    if (!_axFound) mergedAffixes.push(JSON.parse(JSON.stringify(_ax2)));
  }
  // Merge passive riders (keep card1's rider if present, otherwise card2's)
  var mergedRider = card1.passiveRider || card2.passiveRider || undefined;

  var isHybrid = card1.cardId !== card2.cardId;
  var fusedCard = {
    instanceId: crypto.randomBytes(8).toString('hex'),
    cardId: card1.cardId,
    name: isHybrid ? (card1.name + ' / ' + card2.name + ' +' + newFusionCount) : (card1.name + ' +' + newFusionCount),
    type: card1.type,
    isHybrid: isHybrid,
    hybridCardId: isHybrid ? card2.cardId : undefined,
    rarity: nextRarity.id,
    _baseEffects: mergedBase,
    effects: [],
    affixes: mergedAffixes,
    passiveRider: mergedRider,
    combos: [],
    icon: card1.icon,
    fusionCount: newFusionCount,
    fusionLineage: [card1.instanceId, card2.instanceId],
    obtainedAt: Date.now(),
    source: 'fusion',
    style: fusedStyle,
    borderEffect: fusedBorderEffect,
    serial: generateSerial(),
    // Evolution fields preserved from card1 (or reset for fresh fused cards)
    evolutionStage: card1.evolutionStage || 0,
    evolutionXp: 0,
    evolutionPath: null,
    evolutionBonusLevel: 0,
  };

  // Build effects[] and combos[] from _baseEffects + stacked affixes + rider
  refreshCardEffects(fusedCard);

  // Procedural mutation roll on fusion
  // Hybrid fusions get 12% base chance; same-type fusions get 8%
  var fusionMutationBase = isHybrid ? 0.12 : 0.08;
  // Apply racial mutation_chance_bonus (gnome: +5%)
  if (racialBonus && racialBonus.mutationChanceBonus) fusionMutationBase += racialBonus.mutationChanceBonus;
  // Accumulate luck from both input cards' effects + racial baseLuck
  var fusionLuck = 0;
  var allInputEffects = (card1.effects || []).concat(card2.effects || []);
  for (var fi = 0; fi < allInputEffects.length; fi++) {
    if (allInputEffects[fi].type === 'luck_bonus' || allInputEffects[fi].type === 'card_luck_bonus') {
      fusionLuck += (allInputEffects[fi].value || 0);
    }
  }
  if (racialBonus && racialBonus.luckBonus) fusionLuck += racialBonus.luckBonus;
  var fusionMutation = rollMutation(fusionMutationBase, fusionLuck);
  if (fusionMutation) {
    applyMutation(fusedCard, fusionMutation);
  }

  return { card: fusedCard, mutation: fusionMutation || null };
}

module.exports = {
  canFuseCards: canFuseCards,
  fuseCards: fuseCards,
};
