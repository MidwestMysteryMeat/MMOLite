// combat-player-actions.js
// Player action routing and individual action handlers.
// Extracted from dungeon-combat.js — re-exported for backward compatibility.

'use strict';

var rpgData = require('./rpg-data');
var combatSync = require('./combat-sync');
var combatTiles = require('./combat-tiles');
var combatPassives = require('./combat-passive-helpers');
var combatGrid = require('./combat-grid');

var getUnitCombatPassiveTotal = combatPassives.getUnitCombatPassiveTotal;
var hasImmunity = combatPassives.hasImmunity;
var manhattanDist = combatGrid.manhattanDist;
var validateMove = combatGrid.validateMove;
var calculateMoveRange = combatGrid.calculateMoveRange;

var activeCombats, executeMove, executeBasicAttack, executeAbility;
var endUnitTurn, handleUnitDeath, checkCombatEnd, endCombat;
var getValidAttackTargets, updateThreat;

function init(deps) {
  activeCombats = deps.activeCombats;
  executeMove = deps.executeMove;
  executeBasicAttack = deps.executeBasicAttack;
  executeAbility = deps.executeAbility;
  endUnitTurn = deps.endUnitTurn;
  handleUnitDeath = deps.handleUnitDeath;
  checkCombatEnd = deps.checkCombatEnd;
  endCombat = deps.endCombat;
  getValidAttackTargets = deps.getValidAttackTargets;
  updateThreat = deps.updateThreat;
}

function sanitizeResult(result) {
  var clean = {};
  var keys = Object.keys(result);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var val = result[key];
    if (typeof val === 'function') continue;
    clean[key] = val;
  }
  return clean;
}

function handlePlayerAction(combatId, socketId, action) {
  var combat = activeCombats.get(combatId);
  if (!combat) {
    return { success: false, error: 'Combat not found' };
  }

  if (combat.state !== 'player_turn') {
    return { success: false, error: 'Not player turn' };
  }

  var unitId = 'player_' + socketId;
  var unit = combat.units.get(unitId);
  if (!unit) {
    return { success: false, error: 'Player not in this combat' };
  }
  if (!unit.alive) {
    return { success: false, error: 'Player is dead' };
  }

  if (combat.turnGroup.indexOf(unitId) === -1) {
    return { success: false, error: 'Not your turn' };
  }

  if (combat.pendingActions.get(unitId) === true) {
    return { success: false, error: 'Already submitted action this turn' };
  }

  if (!action || !action.type) {
    return { success: false, error: 'Invalid action format' };
  }

  var result = null;

  switch (action.type) {
    case 'move':
      result = handleMoveAction(combat, unit, action.data);
      break;

    case 'attack':
      result = handleAttackAction(combat, unit, action.data);
      break;

    case 'ability':
      result = handleAbilityAction(combat, unit, action.data);
      break;

    case 'end_turn':
      result = handleEndTurnAction(combat, unit);
      break;

    case 'swap_card':
      result = handleSwapCardAction(combat, unit, action.data);
      break;

    case 'wait':
      result = handleWaitAction(combat, unit);
      break;

    case 'use_item':
      result = handleUseItemAction(combat, unit, action.data);
      break;

    case 'npc_heal':
      result = handleNPCHealAction(combat, unit, action.data);
      break;

    default:
      return { success: false, error: 'Unknown action type: ' + action.type };
  }

  if (!result) {
    return { success: false, error: 'Action processing failed' };
  }

  if (result.success && unit.ap <= 0 && unit.mp <= 0) {
    var actionCategory = (action.type === 'attack' || action.type === 'ability') ? 'attacked' : (action.type === 'move' ? 'moved' : 'waited');
    combat.pendingActions.set(unitId, true);
    endUnitTurn(combat, unitId, actionCategory);
    result.turnEnded = true;
  } else if (result.success && (action.type === 'wait' || action.type === 'end_turn')) {
    combat.pendingActions.set(unitId, true);
    endUnitTurn(combat, unitId, 'waited');
    result.turnEnded = true;
  }

  if (result.success && combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_combat_player_action', {
      combatId: combat.id,
      unitId: unitId,
      playerName: unit.name,
      action: action.type,
      result: sanitizeResult(result),
      unitX: unit.x,
      unitY: unit.y,
      unitHp: unit.hp,
      unitMaxHp: unit.maxHp,
      unitMp: unit.mp,
      unitAp: unit.ap,
      momentumShield: unit.momentumShield,
    });
  }

  if (result.success && !result.turnEnded && combat.callbacks.emitToPlayer && unit.socketId) {
    var updatedMoveRange = calculateMoveRange(combat, unitId);
    var updatedTargets = getValidAttackTargets(combat, unitId);
    combat.callbacks.emitToPlayer(unit.socketId, 'tc_combat_turn_update', {
      combatId: combat.id,
      unitId: unitId,
      moveRange: updatedMoveRange,
      attackTargets: updatedTargets,
      mp: unit.mp,
      ap: unit.ap,
      hp: unit.hp,
      maxHp: unit.maxHp,
      momentumShield: unit.momentumShield,
    });
  }

  return result;
}

function handleMoveAction(combat, unit, data) {
  if (!data || data.x === undefined || data.y === undefined) {
    return { success: false, error: 'Move requires x and y coordinates' };
  }

  var targetX = Math.floor(data.x);
  var targetY = Math.floor(data.y);

  var validation = validateMove(combat, unit.id, targetX, targetY);
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }

  var moveResult = executeMove(combat, unit.id, validation.path);

  return {
    success: true,
    type: 'move',
    path: validation.path,
    cost: validation.cost,
    tilesMoved: moveResult.tilesMoved,
    momentumShield: unit.momentumShield,
    events: moveResult.events || [],
    died: moveResult.died || false,
  };
}

function handleAttackAction(combat, unit, data) {
  if (!data || !data.targetId) {
    return { success: false, error: 'Attack requires targetId' };
  }

  var atkResult = executeBasicAttack(combat, unit.id, data.targetId);

  if (!atkResult.success) {
    return { success: false, error: atkResult.reason };
  }

  var syncResults = combatSync.checkSyncAttacks(combat, unit.id, data.targetId);
  if (syncResults.length > 0) {
    var syncTarget = combat.units.get(data.targetId);
    for (var si = 0; si < syncResults.length; si++) {
      var syncHit = syncResults[si];
      if (syncTarget && syncTarget.alive) {
        var syncShieldAbsorbed = 0;
        var syncDmg = syncHit.damage;
        if (syncTarget.momentumShield > 0) {
          syncShieldAbsorbed = Math.min(syncTarget.momentumShield, syncDmg);
          syncTarget.momentumShield -= syncShieldAbsorbed;
          syncDmg -= syncShieldAbsorbed;
        }
        if (syncDmg > 0) syncTarget.hp -= syncDmg;
        if (syncTarget.hp <= 0) {
          syncTarget.alive = false;
          syncTarget.hp = 0;
          atkResult.targetDied = true;
        }
      }
    }
    atkResult.syncAttacks = syncResults;
  }

  if (atkResult.targetDied) {
    handleUnitDeath(combat, data.targetId, unit.id);

    var finalTarget = combat.units.get(data.targetId);
    if (finalTarget && finalTarget.alive) {
      atkResult.targetDied = false;
      atkResult.targetHp = finalTarget.hp;
    }

    var endCheck = checkCombatEnd(combat);
    if (endCheck) {
      var combatRef = combat;
      var endResult = endCheck;
      setTimeout(function() {
        endCombat(combatRef, endResult);
      }, 200);
    }
  }

  if (!unit.alive) {
    var thornEndCheck = checkCombatEnd(combat);
    if (thornEndCheck) {
      var thornCombatRef = combat;
      var thornEndResult = thornEndCheck;
      setTimeout(function() {
        endCombat(thornCombatRef, thornEndResult);
      }, 200);
    }
  }

  return {
    success: true,
    type: 'attack',
    targetId: data.targetId,
    damage: atkResult.damage,
    actualDamage: atkResult.actualDamage,
    isCrit: atkResult.isCrit,
    dodged: atkResult.dodged || false,
    blocked: atkResult.blocked || false,
    shieldAbsorbed: atkResult.shieldAbsorbed,
    manaShieldAbsorbed: atkResult.manaShieldAbsorbed || 0,
    targetDied: atkResult.targetDied,
    targetHp: atkResult.targetHp,
    targetMaxHp: atkResult.targetMaxHp,
    attackerAp: atkResult.attackerAp,
    attackerHp: atkResult.attackerHp,
    lifestealHeal: atkResult.lifestealHeal || 0,
    reflectDamage: atkResult.reflectDamage || 0,
    syncAttacks: atkResult.syncAttacks || [],
  };
}

function handleWaitAction(combat, unit) {
  return {
    success: true,
    type: 'wait',
    unitId: unit.id,
  };
}

function handleNPCHealAction(combat, unit, data) {
  if (!data || !data.targetId) {
    return { success: false, error: 'Heal requires targetId' };
  }
  var target = combat.units.get(data.targetId);
  if (!target || !target.alive || target.type !== 'player') {
    return { success: false, error: 'Invalid heal target' };
  }
  if (unit.combat && unit.combat.mana !== undefined && unit.combat.mana >= 10) {
    unit.combat.mana -= 10;
  }
  var healAmount = Math.floor(target.maxHp * (0.15 + Math.random() * 0.10));
  target.hp = Math.min(target.maxHp, target.hp + healAmount);
  unit.ap = Math.max(0, unit.ap - 1);

  if (combat.isLichRaid && combat.threatTable) {
    updateThreat(combat, unit.id, healAmount, 'healing');
  }

  if (combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_combat_npc_heal', {
      combatId: combat.id,
      healerId: unit.id,
      healerName: unit.name,
      targetId: target.id,
      targetName: target.name,
      healAmount: healAmount,
      targetHp: target.hp,
      targetMaxHp: target.maxHp,
    });
  }

  return {
    success: true,
    type: 'npc_heal',
    unitId: unit.id,
    targetId: target.id,
    healAmount: healAmount,
  };
}

function handleAbilityAction(combat, unit, data) {
  if (!data) {
    return { success: false, error: 'Ability requires cardId or abilityIndex' };
  }

  var resolvedCardId = data.cardId;
  if (!resolvedCardId && data.abilityIndex !== undefined) {
    var eqCards = unit.equippedCards || [];
    var idx = Math.floor(data.abilityIndex) - 1;
    if (idx >= 0 && idx < eqCards.length && eqCards[idx]) {
      resolvedCardId = eqCards[idx].cardId || eqCards[idx].id;
    }
  }
  if (!resolvedCardId) {
    return { success: false, error: 'Ability requires cardId or valid abilityIndex' };
  }

  var targetX = (data.targetX !== undefined) ? Math.floor(data.targetX) :
                (data.x !== undefined) ? Math.floor(data.x) : unit.x;
  var targetY = (data.targetY !== undefined) ? Math.floor(data.targetY) :
                (data.y !== undefined) ? Math.floor(data.y) : unit.y;

  var abilityResult = executeAbility(combat, unit.id, resolvedCardId, targetX, targetY);
  if (!abilityResult.success) {
    return { success: false, error: abilityResult.reason };
  }

  var card = null;
  var equippedCards = unit.equippedCards || [];
  for (var ci = 0; ci < equippedCards.length; ci++) {
    if (equippedCards[ci] && (equippedCards[ci].id === resolvedCardId || equippedCards[ci].cardId === resolvedCardId)) {
      card = equippedCards[ci];
      break;
    }
  }
  var abilityTemplate = rpgData.CARD_BY_ID[(card && card.cardId) || ''] || {};
  if (card && (abilityTemplate.onHitTile || card.onHitTile) && abilityResult.effects) {
    var aoeR = (abilityTemplate.aoeRadius || card.aoeRadius || 0);
    if (aoeR > 0) {
      for (var tx = targetX - aoeR; tx <= targetX + aoeR; tx++) {
        for (var ty = targetY - aoeR; ty <= targetY + aoeR; ty++) {
          if (manhattanDist(tx, ty, targetX, targetY) <= aoeR) {
            combatTiles.createTileEffect(combat, tx, ty, (abilityTemplate.onHitTile || card.onHitTile), unit.id);
          }
        }
      }
    } else {
      combatTiles.createTileEffect(combat, targetX, targetY, (abilityTemplate.onHitTile || card.onHitTile), unit.id);
    }
  }

  if (card && (abilityTemplate.onHitStatus || card.onHitStatus) && abilityResult.effects) {
    var onHitStatusObj = (abilityTemplate.onHitStatus || card.onHitStatus);
    for (var esi = 0; esi < abilityResult.effects.length; esi++) {
      var eff = abilityResult.effects[esi];
      if (eff.type === 'damage' && eff.targetId) {
        var statusTarget = combat.units.get(eff.targetId);
        if (statusTarget && statusTarget.alive) {
          var onHitResisted = false;
          if (onHitStatusObj.type === 'debuff') {
            var onHitIronWill = getUnitCombatPassiveTotal(statusTarget, 'debuff_resist');
            if (onHitIronWill > 0 && Math.random() < onHitIronWill) {
              onHitResisted = true;
            }
          }
          if (!onHitResisted && onHitStatusObj.name === 'poisoned' && hasImmunity(statusTarget, 'poison')) {
            onHitResisted = true;
          }
          if (!onHitResisted) {
            if (!statusTarget.statusEffects) statusTarget.statusEffects = [];
            var statusCopy = {};
            var sKeys = Object.keys(onHitStatusObj);
            for (var ski = 0; ski < sKeys.length; ski++) {
              statusCopy[sKeys[ski]] = onHitStatusObj[sKeys[ski]];
            }
            statusCopy.sourceId = unit.id;
            statusTarget.statusEffects.push(statusCopy);
          }
        }
      }
    }
  }

  if (card && (abilityTemplate.lifesteal || card.lifesteal) && abilityResult.effects) {
    var lifestealPct = (abilityTemplate.lifesteal || card.lifesteal);
    var totalDamageDealt = 0;
    for (var lsi = 0; lsi < abilityResult.effects.length; lsi++) {
      if (abilityResult.effects[lsi].type === 'damage') {
        totalDamageDealt += abilityResult.effects[lsi].actualDamage || 0;
      }
    }
    if (totalDamageDealt > 0) {
      var healAmt = Math.floor(totalDamageDealt * lifestealPct);
      if (healAmt > 0) {
        unit.hp = Math.min(unit.maxHp, unit.hp + healAmt);
        abilityResult.lifestealHeal = healAmt;
      }
    }
  }

  if (abilityResult.effects) {
    for (var dei = 0; dei < abilityResult.effects.length; dei++) {
      if (abilityResult.effects[dei].targetDied) {
        var deadId = abilityResult.effects[dei].targetId;
        handleUnitDeath(combat, deadId, unit.id);
      }
    }
    var endCheck = checkCombatEnd(combat);
    if (endCheck) {
      var combatRef = combat;
      var endResult = endCheck;
      setTimeout(function() { endCombat(combatRef, endResult); }, 200);
    }
  }

  return {
    success: true,
    type: 'ability',
    abilityName: abilityResult.abilityName,
    abilityId: abilityResult.abilityId,
    effects: abilityResult.effects,
    manaCost: abilityResult.manaCost,
    cooldown: abilityResult.cooldown,
    unitMana: abilityResult.unitMana,
    unitAp: unit.ap,
    lifestealHeal: abilityResult.lifestealHeal || 0,
  };
}

function handleSwapCardAction(combat, unit, data) {
  if (!data) return { success: false, reason: 'No swap data' };
  if (unit.ap <= 0) return { success: false, reason: 'No action points remaining' };
  if (!combat.callbacks || !combat.callbacks.swapCard) {
    return { success: false, reason: 'Card swap not available' };
  }

  var result = combat.callbacks.swapCard(unit.socketId, data.unequipInstanceId || null, data.equipInstanceId || null);
  if (result.error) return { success: false, reason: result.error };

  unit.ap -= 1;

  if (result.resolvedCards) {
    unit.equippedCards = result.resolvedCards;
  }

  var newCombat = unit.combat || {};
  newCombat.spellDmgBonus = 0;
  newCombat.poisonDmgBonus = 0;
  newCombat.counterChanceBonus = 0;
  newCombat.manaEfficiency = 0;
  newCombat.elementalResistAll = 0;
  newCombat.lowHpDmgReduction = 0;
  newCombat.dungeonDmgBonus = 0;
  newCombat.bossDmgBonus = 0;
  newCombat.dungeonDefBonus = 0;
  newCombat.hpRegen = 0;

  for (var ci = 0; ci < unit.equippedCards.length; ci++) {
    var card = unit.equippedCards[ci];
    if (!card || !card.combatPassive) continue;
    var passive = card.combatPassive;
    if (passive.type === 'spell_damage_bonus') newCombat.spellDmgBonus += (passive.value || 0);
    if (passive.type === 'poison_damage_bonus') newCombat.poisonDmgBonus += (passive.value || 0);
    if (passive.type === 'counter_chance_bonus') newCombat.counterChanceBonus += (passive.value || 0);
    if (passive.type === 'mana_efficiency') newCombat.manaEfficiency += (passive.value || 0);
    if (passive.type === 'elemental_resist_all') newCombat.elementalResistAll += (passive.value || 0);
    if (passive.type === 'low_hp_damage_reduction') newCombat.lowHpDmgReduction += (passive.value || 0);
    if (passive.type === 'dungeon_damage_bonus') newCombat.dungeonDmgBonus += (passive.value || 0);
    if (passive.type === 'boss_damage_bonus') newCombat.bossDmgBonus += (passive.value || 0);
    if (passive.type === 'dungeon_defense_bonus') newCombat.dungeonDefBonus += (passive.value || 0);
    if (passive.type === 'hp_regen') newCombat.hpRegen += (passive.value || 0);
  }

  if (result.weaponSpeed !== undefined && result.weaponSpeed !== newCombat.weaponSpeed) {
    newCombat.weaponSpeed = result.weaponSpeed;
    var newBaseSpeed = rpgData.computeCombatSpeed(
      unit.race || null,
      (unit.combat && unit.combat.finesse) ? unit.combat.finesse : 5,
      unit.equippedCards || []
    );
    var wsMult = Math.max(0.5, Math.min(1.5, newCombat.weaponSpeed || 1.0));
    var asMod = newCombat.armorSpeedMod || 0;
    unit.speed = Math.max(1, Math.round(newBaseSpeed * wsMult * (1 + asMod)));
  }

  return {
    success: true,
    type: 'swap_card',
    unitId: unit.id,
    unitAp: unit.ap,
    equippedCards: unit.equippedCards,
  };
}

function handleUseItemAction(combat, unit, data) {
  if (!data || !data.resourceType) return { success: false, reason: 'No item specified' };
  if (unit.ap <= 0) return { success: false, reason: 'No action points remaining' };
  if (!combat.callbacks || !combat.callbacks.consumeItem) {
    return { success: false, reason: 'Item use not available in this combat' };
  }

  var result = combat.callbacks.consumeItem(unit.socketId, data.resourceType);
  if (result.error) return { success: false, reason: result.error };

  unit.ap -= 1;

  var hpRestored = 0;
  if (result.hpRestored && result.hpRestored > 0) {
    var oldHp = unit.hp;
    unit.hp = Math.min(unit.maxHp, unit.hp + result.hpRestored);
    hpRestored = unit.hp - oldHp;
  }

  var buffApplied = null;
  if (result.buff && result.buff.stat && result.buff.value) {
    var buffTurns = Math.max(1, Math.ceil(result.buff.duration / 15));
    var statBoosts = {};
    switch (result.buff.stat) {
      case 'vigor':   statBoosts.maxHpBoost = result.buff.value * 10; break;
      case 'might':   statBoosts.damageBoost = result.buff.value * 2; break;
      case 'finesse': statBoosts.speedMult = 1 + (result.buff.value * 0.05); break;
      case 'acumen':  statBoosts.magicDmgBoost = result.buff.value * 2; break;
      case 'resolve': statBoosts.damageReduction = result.buff.value; break;
      case 'focus':   statBoosts.manaRegen = result.buff.value; break;
      case 'presence': break;
    }

    var existingIdx = -1;
    for (var si = 0; si < unit.statusEffects.length; si++) {
      if (unit.statusEffects[si].name === 'food_buff_' + result.buff.stat) {
        existingIdx = si;
        break;
      }
    }

    var buffEffect = {
      name: 'food_buff_' + result.buff.stat,
      type: 'buff',
      duration: buffTurns,
      source: data.resourceType,
    };
    var boostKeys = Object.keys(statBoosts);
    for (var bk = 0; bk < boostKeys.length; bk++) {
      buffEffect[boostKeys[bk]] = statBoosts[boostKeys[bk]];
    }

    if (existingIdx >= 0) {
      var oldEffect = unit.statusEffects[existingIdx];
      if (oldEffect.maxHpBoost) {
        unit.maxHp -= oldEffect.maxHpBoost;
        unit.hp = Math.min(unit.hp, unit.maxHp);
      }
      unit.statusEffects[existingIdx] = buffEffect;
    } else {
      unit.statusEffects.push(buffEffect);
    }

    if (statBoosts.maxHpBoost) {
      unit.maxHp += statBoosts.maxHpBoost;
    }

    buffApplied = { stat: result.buff.stat, value: result.buff.value, turns: buffTurns };
  }

  return {
    success: true,
    type: 'use_item',
    unitId: unit.id,
    unitAp: unit.ap,
    unitHp: unit.hp,
    unitMaxHp: unit.maxHp,
    hpRestored: hpRestored,
    resourceType: data.resourceType,
    buff: buffApplied,
  };
}

function handleEndTurnAction(combat, unit) {
  return {
    success: true,
    type: 'end_turn',
    unitId: unit.id,
  };
}

module.exports = {
  init: init,
  handlePlayerAction: handlePlayerAction,
  handleMoveAction: handleMoveAction,
  handleAttackAction: handleAttackAction,
  handleWaitAction: handleWaitAction,
  handleNPCHealAction: handleNPCHealAction,
  handleAbilityAction: handleAbilityAction,
  handleSwapCardAction: handleSwapCardAction,
  handleUseItemAction: handleUseItemAction,
  handleEndTurnAction: handleEndTurnAction,
};
