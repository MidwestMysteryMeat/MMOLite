// account-rpg-evolution.js — Card evolution, mutation spread, archetype XP
// Needs loadAccount, saveAccount, invalidateCardEffectsCache via init(deps).

var rpgData = require('./rpg-data');

var loadAccount;
var saveAccount;
var invalidateCardEffectsCache;

function init(deps) {
  loadAccount = deps.loadAccount;
  saveAccount = deps.saveAccount;
  invalidateCardEffectsCache = deps.invalidateCardEffectsCache;
}

// ---------------------------------------------------------------------------
// Viral Mutation Spread
// When a mutation fires on any card, there is a luck-scaled chance it "goes
// viral" and spreads a minor mutation to each other equipped card.
// Spread chance per target card = base 15%, scaled by accumulated luck.
// Spread mutations are always tier <= 2 and tagged viral:true.
// ---------------------------------------------------------------------------
function _spreadMutation(account, sourceCard, luckBonus) {
  if (!account || !account.equippedCards || !account.rpgCards) return [];

  // Build card lookup map
  var cardMap = {};
  for (var i = 0; i < account.rpgCards.length; i++) {
    cardMap[account.rpgCards[i].instanceId] = account.rpgCards[i];
  }

  // Racial viral_spread_bonus (catfolk: +10%)
  var spreadBase = 0.15;
  var _spreadRace = account.race && rpgData.RACES && rpgData.RACES[account.race];
  if (_spreadRace && _spreadRace.racialFeat && _spreadRace.racialFeat.effects) {
    for (var _sri = 0; _sri < _spreadRace.racialFeat.effects.length; _sri++) {
      if (_spreadRace.racialFeat.effects[_sri].type === 'viral_spread_bonus') {
        spreadBase += (_spreadRace.racialFeat.effects[_sri].value || 0);
      }
    }
  }
  // Affix: viral_spread_speed — boost viral spread chance from source card
  if (sourceCard.affixes && Array.isArray(sourceCard.affixes)) {
    for (var _vsi = 0; _vsi < sourceCard.affixes.length; _vsi++) {
      if (sourceCard.affixes[_vsi] && sourceCard.affixes[_vsi].effect && sourceCard.affixes[_vsi].effect.type === 'viral_spread_speed') {
        spreadBase += (sourceCard.affixes[_vsi].effect.value || 0);
      }
    }
  }

  var spreadResults = [];
  for (var e = 0; e < account.equippedCards.length; e++) {
    var eId = account.equippedCards[e];
    if (!eId || eId === sourceCard.instanceId) continue;
    var target = cardMap[eId];
    if (!target) continue;

    // Luck-proc spread: spreadBase% base (race-adjusted), luck-scaled
    var viralMut = rpgData.rollMutation(spreadBase, luckBonus);
    if (!viralMut) continue;
    // Viral spreads are capped at tier 2 (no tier 3 via viral)
    if (viralMut.tier > 2) continue;
    viralMut.viral = true;
    rpgData.applyMutation(target, viralMut);
    spreadResults.push({ instanceId: eId, mutation: viralMut });
  }
  return spreadResults;
}

// ---------------------------------------------------------------------------
// Card Evolution System
// ---------------------------------------------------------------------------

// Pick a guaranteed tier-1 mutation from MUTATION_POOL (for post-max level bonuses)
function _forceTier1Mutation(luck) {
  var pool = [];
  var totalWeight = 0;
  var mutPool = rpgData.MUTATION_POOL;
  if (!mutPool) return null;
  for (var mi = 0; mi < mutPool.length; mi++) {
    if (mutPool[mi].tier === 1) {
      pool.push(mutPool[mi]);
      totalWeight += (mutPool[mi].weight || 1);
    }
  }
  if (pool.length === 0) return null;
  var roll = Math.random() * totalWeight;
  var cumulative = 0;
  for (var pi = 0; pi < pool.length; pi++) {
    cumulative += (pool[pi].weight || 1);
    if (roll <= cumulative) return pool[pi];
  }
  return pool[pool.length - 1];
}

// How many XP past the final stage threshold triggers each bonus level
var EVO_POST_MAX_INTERVAL = 500;

// Internal: advance a single card's evolution XP on a pre-loaded account (no save).
// Returns a result object if the card advanced a stage, or null otherwise.
function _applyCardEvoXp(account, card, xpAmount) {
  if (!card || typeof xpAmount !== 'number' || xpAmount <= 0) return null;
  var template = rpgData.CARD_BY_ID[card.cardId];
  if (!template || !template.evolutionThresholds) return null;

  // Init missing fields on legacy cards
  if (typeof card.evolutionStage !== 'number') card.evolutionStage = 0;
  if (typeof card.evolutionXp !== 'number') card.evolutionXp = 0;
  if (card.evolutionPath === undefined) card.evolutionPath = null;
  if (typeof card.evolutionBonusLevel !== 'number') card.evolutionBonusLevel = 0;

  // Affix: evo_xp_bonus — equipped evo_linked affixes boost XP gain
  var evoXpMult = 1.0;
  if (card.affixes && Array.isArray(card.affixes)) {
    for (var _axi = 0; _axi < card.affixes.length; _axi++) {
      if (card.affixes[_axi] && card.affixes[_axi].effect && card.affixes[_axi].effect.type === 'evo_xp_bonus') {
        evoXpMult += (card.affixes[_axi].effect.value || 0);
      }
    }
  }
  card.evolutionXp += Math.floor(xpAmount * evoXpMult);

  var advancementEvents = [];

  // Consume every earned threshold. The old loop returned from its first
  // iteration, leaving cards artificially one stage behind after a large XP
  // grant. A single-stage grant keeps the legacy result shape; multi-advance
  // grants also expose all individual events in `events`.
  while (card.evolutionStage < 3
         && card.evolutionXp >= template.evolutionThresholds[card.evolutionStage]) {
    card.evolutionStage++;

    // Apply the additive stage bonus effect (stages 1 and 2 only)
    // Push to _baseEffects so refreshCardEffects picks it up correctly
    if (card.evolutionStage <= 2 && template.evolutionStageEffects && template.evolutionStageEffects[card.evolutionStage]) {
      var _stageEff = JSON.parse(JSON.stringify(template.evolutionStageEffects[card.evolutionStage]));
      // Affix: evo_stage_value_bonus — boost stage effect values
      var _stageBonusMult = 1.0;
      if (card.affixes && Array.isArray(card.affixes)) {
        for (var _sbi = 0; _sbi < card.affixes.length; _sbi++) {
          if (card.affixes[_sbi] && card.affixes[_sbi].effect && card.affixes[_sbi].effect.type === 'evo_stage_value_bonus') {
            _stageBonusMult += (card.affixes[_sbi].effect.value || 0);
          }
        }
      }
      if (_stageBonusMult > 1.0) {
        if (typeof _stageEff.value === 'number') _stageEff.value = Math.round(_stageEff.value * _stageBonusMult * 100) / 100;
        if (typeof _stageEff.base === 'number') _stageEff.base = Math.round(_stageEff.base * _stageBonusMult);
      }
      if (card._baseEffects) card._baseEffects.push(_stageEff);
      else card.effects.push(_stageEff); // legacy fallback
    }

    // Grant a new procedural affix on stages 1 and 2
    var grantedAffix = null;
    if (card.evolutionStage <= 2 && rpgData.rollEvoAffix && rpgData.addAffixToCard) {
      var _evoAffix = rpgData.rollEvoAffix(card);
      if (_evoAffix) {
        rpgData.addAffixToCard(card, _evoAffix.id);
        grantedAffix = { id: _evoAffix.id, label: _evoAffix.label, tier: _evoAffix.tier };
      }
    } else if (card._baseEffects && rpgData.refreshCardEffects) {
      // Rebuild effects[] after stage bonus was pushed to _baseEffects
      rpgData.refreshCardEffects(card);
    }

    // Stage 3: await player's path choice
    if (card.evolutionStage === 3) {
      card.pendingEvolutionChoice = true;
    }

    // Roll for procedural mutation on stage advance (5% base, scaled by luck)
    var evoLuck = 0;
    for (var efIdx = 0; efIdx < card.effects.length; efIdx++) {
      var ef = card.effects[efIdx];
      if (ef.type === 'luck_bonus' || ef.type === 'card_luck_bonus') evoLuck += (ef.value || 0);
    }
    // Add racial base luck
    var _evoRace = account.race && rpgData.RACES && rpgData.RACES[account.race];
    if (_evoRace && _evoRace.baseLuck) evoLuck += _evoRace.baseLuck;
    // Check for racial mutation_chance_bonus (gnome)
    var _evoMutBonus = 0;
    if (_evoRace && _evoRace.racialFeat && _evoRace.racialFeat.effects) {
      for (var _rmi = 0; _rmi < _evoRace.racialFeat.effects.length; _rmi++) {
        if (_evoRace.racialFeat.effects[_rmi].type === 'mutation_chance_bonus') {
          _evoMutBonus += (_evoRace.racialFeat.effects[_rmi].value || 0);
        }
      }
    }
    var evoMutation = rpgData.rollMutation(0.05 + _evoMutBonus, evoLuck);
    // Affix: next_mutation_min_tier — guarantee minimum mutation tier
    if (evoMutation && card.affixes && Array.isArray(card.affixes)) {
      var _minTier = 1;
      for (var _mti = 0; _mti < card.affixes.length; _mti++) {
        if (card.affixes[_mti] && card.affixes[_mti].effect && card.affixes[_mti].effect.type === 'next_mutation_min_tier') {
          _minTier = Math.max(_minTier, card.affixes[_mti].effect.value || 1);
        }
      }
      if (evoMutation.tier < _minTier) {
        // Re-roll for a higher tier mutation
        var _reroll = rpgData.rollMutation(1.0, evoLuck); // guaranteed roll
        if (_reroll && _reroll.tier >= _minTier) evoMutation = _reroll;
      }
    }
    var viralSpreads = [];
    if (evoMutation) {
      rpgData.applyMutation(card, evoMutation);
      // Viral spread: mutation may spread to other equipped cards
      viralSpreads = _spreadMutation(account, card, evoLuck);
    }

    advancementEvents.push({
      instanceId: card.instanceId,
      newStage: card.evolutionStage,
      pendingChoice: card.evolutionStage === 3,
      mutation: evoMutation || null,
      viralSpreads: viralSpreads,
      grantedAffix: grantedAffix,
    });
  }

  // Post-max leveling: cards never stop improving — every EVO_POST_MAX_INTERVAL XP
  // beyond the final threshold awards a guaranteed tier-1 procedural bonus.
  if (card.evolutionStage >= 3) {
    var maxThreshold = template.evolutionThresholds[template.evolutionThresholds.length - 1];
    while (card.evolutionXp >= maxThreshold + (card.evolutionBonusLevel + 1) * EVO_POST_MAX_INTERVAL) {
      card.evolutionBonusLevel++;
      // Luck from card effects
      var postLuck = 0;
      for (var pei = 0; pei < card.effects.length; pei++) {
        var pe = card.effects[pei];
        if (pe.type === 'luck_bonus' || pe.type === 'card_luck_bonus') postLuck += (pe.value || 0);
      }
      var _postRace = account.race && rpgData.RACES && rpgData.RACES[account.race];
      if (_postRace && _postRace.baseLuck) postLuck += _postRace.baseLuck;
      var bonusMut = _forceTier1Mutation(postLuck);
      var bonusViralSpreads = [];
      if (bonusMut) {
        rpgData.applyMutation(card, bonusMut);
        bonusViralSpreads = _spreadMutation(account, card, postLuck);
      }
      advancementEvents.push({
        instanceId: card.instanceId,
        bonusLevel: card.evolutionBonusLevel,
        mutation: bonusMut || null,
        viralSpreads: bonusViralSpreads,
      });
    }
  }

  if (advancementEvents.length === 0) return null; // XP added but no advancement
  if (advancementEvents.length === 1) return advancementEvents[0];

  // Preserve the legacy top-level fields using the final event while exposing
  // the complete ordered history to callers that can render multiple advances.
  var finalEvent = Object.assign({}, advancementEvents[advancementEvents.length - 1]);
  finalEvent.newStage = card.evolutionStage;
  finalEvent.pendingChoice = card.evolutionStage === 3 && !!card.pendingEvolutionChoice;
  finalEvent.events = advancementEvents;
  return finalEvent;
}

// Apply evo XP to a specific card instance and save.
function gainCardEvolutionXp(key, instanceId, xpAmount) {
  var account = loadAccount(key);
  if (!account || !account.rpgCards) return null;

  var card = null;
  for (var i = 0; i < account.rpgCards.length; i++) {
    if (account.rpgCards[i].instanceId === instanceId) { card = account.rpgCards[i]; break; }
  }
  if (!card) return null;

  var result = _applyCardEvoXp(account, card, xpAmount);
  saveAccount(account);
  return { card: card, advanced: !!result, stageResult: result };
}

// Apply evo XP to all cards of a given evoCategory on this account.
// Equipped cards get full xpAmount; non-equipped get 25%.
// Returns array of any stage-advance results.
function gainArchetypeCategoryXp(key, evoCategory, xpAmount) {
  var account = loadAccount(key);
  if (!account || !account.rpgCards || account.rpgCards.length === 0) return [];

  // Build equipped set for O(1) lookup
  var equippedSet = {};
  var equipped = account.equippedCards || [];
  for (var e = 0; e < equipped.length; e++) {
    if (equipped[e]) equippedSet[equipped[e]] = true;
  }

  var anyChange = false;
  var stageAdvances = [];

  for (var i = 0; i < account.rpgCards.length; i++) {
    var card = account.rpgCards[i];
    var template = rpgData.CARD_BY_ID[card.cardId];
    if (!template || template.evoCategory !== evoCategory) continue;

    var isEquipped = !!equippedSet[card.instanceId];
    var amount = isEquipped ? xpAmount : Math.ceil(xpAmount * 0.25);

    var result = _applyCardEvoXp(account, card, amount);
    if (result) stageAdvances.push(result);
    anyChange = true; // XP was awarded even if no stage advance
  }

  if (anyChange) saveAccount(account);
  return stageAdvances;
}

// Apply a chosen evolution path to a card (called from rpg-cards handler).
function applyEvolutionPath(key, instanceId, path) {
  var account = loadAccount(key);
  if (!account || !account.rpgCards) return { error: 'Account not found' };

  var card = null;
  for (var i = 0; i < account.rpgCards.length; i++) {
    if (account.rpgCards[i].instanceId === instanceId) { card = account.rpgCards[i]; break; }
  }
  if (!card) return { error: 'Card not found' };
  if (!card.pendingEvolutionChoice) return { error: 'Card has no pending evolution choice' };
  if (path !== 'A' && path !== 'B') return { error: 'Path must be A or B' };

  var template = rpgData.CARD_BY_ID[card.cardId];
  if (!template || !template.evolutionPaths || !template.evolutionPaths[path]) {
    return { error: 'Evolution path not available for this card' };
  }

  var pathData = template.evolutionPaths[path];
  card.evolutionPath = path;
  card.pendingEvolutionChoice = false;
  card.name = card.name + ' [' + pathData.name + ']';

  // Add path effects to card's base effects so refreshCardEffects picks them up
  for (var j = 0; j < pathData.effects.length; j++) {
    var _pathEff = JSON.parse(JSON.stringify(pathData.effects[j]));
    if (card._baseEffects) card._baseEffects.push(_pathEff);
    else card.effects.push(_pathEff); // legacy fallback
  }

  // Rebuild effects[] + combos[] with the new path effects included
  if (rpgData.refreshCardEffects) rpgData.refreshCardEffects(card);

  // Invalidate card effects cache
  invalidateCardEffectsCache(key);

  saveAccount(account);
  return { card: card };
}

module.exports = {
  init: init,
  _spreadMutation: _spreadMutation,
  _forceTier1Mutation: _forceTier1Mutation,
  _applyCardEvoXp: _applyCardEvoXp,
  gainCardEvolutionXp: gainCardEvolutionXp,
  gainArchetypeCategoryXp: gainArchetypeCategoryXp,
  applyEvolutionPath: applyEvolutionPath,
};
