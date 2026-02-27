// combat-movement.js
// Movement execution, opportunity attacks, and momentum shield.
// Extracted from dungeon-combat.js — re-exported for backward compatibility.

'use strict';

var combatGrid = require('./combat-grid');
var combatSync = require('./combat-sync');
var combatTiles = require('./combat-tiles');
var combatPassives = require('./combat-passive-helpers');

var isWalkableExcluding = combatGrid.isWalkableExcluding;
var isAdjacent = combatGrid.isAdjacent;
var chebyshevDist = combatGrid.chebyshevDist;
var getUnitCombatPassive = combatPassives.getUnitCombatPassive;

var handleUnitDeath;

function init(deps) {
  handleUnitDeath = deps.handleUnitDeath;
}

function executeMove(combat, unitId, path) {
  var unit = combat.units.get(unitId);
  if (!unit || !unit.alive) return { success: false, reason: 'Unit unavailable' };

  if (unit.activeAnimalForm === 'turtle') {
    return { success: false, reason: 'Cannot move while in Turtle Form (defensive only)', tilesMoved: 0, events: [] };
  }

  if (unit.statusEffects) {
    for (var cmvI = 0; cmvI < unit.statusEffects.length; cmvI++) {
      if (unit.statusEffects[cmvI].cantMove && unit.statusEffects[cmvI].type === 'buff') {
        return { success: false, reason: 'Cannot move while ' + (unit.statusEffects[cmvI].name || 'ability') + ' is active', tilesMoved: 0, events: [] };
      }
      if (unit.statusEffects[cmvI].name === 'rooted' && unit.statusEffects[cmvI].type === 'debuff') {
        return { success: false, reason: 'You are rooted in place!', tilesMoved: 0, events: [] };
      }
    }
  }

  var floor = combat.floor;
  var events = [];
  var tilesMoved = 0;

  var moveResult = { success: true, tilesMoved: 0, events: events, died: false };
  for (var step = 1; step < path.length; step++) {
    var tile = path[step];

    if (!isWalkableExcluding(floor.grid, tile.x, tile.y, floor.width, floor.height, combat.units, unitId)) {
      events.push({ type: 'move_blocked', x: tile.x, y: tile.y, step: step });
      break;
    }

    var oldX = unit.x;
    var oldY = unit.y;
    var newX = tile.x;
    var newY = tile.y;
    var oppResults = combatSync.checkOpportunityAttack(combat, unit.id, oldX, oldY, newX, newY);
    for (var oi = 0; oi < oppResults.length; oi++) {
      var oppHit = oppResults[oi];
      unit.hp -= oppHit.damage;
      if (unit.hp <= 0) {
        unit.alive = false;
        unit.hp = 0;
      }
      if (!moveResult.events) moveResult.events = [];
      moveResult.events.push({ type: 'opportunity_attack', attackerId: oppHit.unitId, damage: oppHit.damage, isCrit: oppHit.isCrit });
    }
    if (!unit.alive) {
      moveResult.tilesMoved = tilesMoved;
      moveResult.died = true;
      break;
    }

    unit.x = tile.x;
    unit.y = tile.y;
    tilesMoved++;
    unit.mp--;

    var tileEffect = combatTiles.getTileEffectAt(combat, unit.x, unit.y);
    if (tileEffect) {
      var tileEffects = Array.isArray(tileEffect) ? tileEffect : [tileEffect];
      for (var tei = 0; tei < tileEffects.length; tei++) {
        var te = tileEffects[tei];
        var teDef = combatTiles.TILE_EFFECTS[te.type];
        if (teDef && teDef.damage && teDef.damage > 0) {
          unit.hp -= teDef.damage;
          if (unit.hp <= 0) {
            unit.alive = false;
            unit.hp = 0;
          }
          if (!moveResult.events) moveResult.events = [];
          moveResult.events.push({ type: 'step_damage', tileType: te.type, damage: teDef.damage, unitHp: Math.max(0, unit.hp) });
        }
      }
    }
    if (!unit.alive) {
      moveResult.tilesMoved = tilesMoved;
      moveResult.died = true;
      break;
    }

    if (unit.mp <= 0) break;
  }

  if (tilesMoved > 0 && unit.type === 'enemy' && unit.alive) {
    var rpStartX = path[0] ? path[0].x : unit.x;
    var rpStartY = path[0] ? path[0].y : unit.y;
    var rpIter = combat.units.values();
    var rpEntry = rpIter.next();
    while (!rpEntry.done) {
      var rpUnit = rpEntry.value;
      rpEntry = rpIter.next();
      if (rpUnit.type === 'player' && rpUnit.alive && rpUnit.id !== unitId) {
        var rpPassive = getUnitCombatPassive(rpUnit, 'relentless_pursuit');
        if (rpPassive && rpPassive.attackOnFlee) {
          var rpDistBefore = chebyshevDist(rpStartX, rpStartY, rpUnit.x, rpUnit.y);
          var rpDistAfter = chebyshevDist(unit.x, unit.y, rpUnit.x, rpUnit.y);
          if (rpDistBefore <= 1.5 && rpDistAfter > 1.5) {
            var rpAtkDmg = ((rpUnit.combat && rpUnit.combat.might) || 5) * 2 +
                           ((rpUnit.combat && rpUnit.combat.weaponDamage) || 0);
            rpAtkDmg = Math.max(1, Math.floor(rpAtkDmg * 0.75));
            unit.hp -= rpAtkDmg;
            if (unit.hp <= 0) { unit.alive = false; unit.hp = 0; }
            if (!moveResult.events) moveResult.events = [];
            moveResult.events.push({
              type: 'opportunity_attack', attackerId: rpUnit.id, damage: rpAtkDmg,
              passive: 'relentless_pursuit',
            });
            if (!unit.alive) {
              handleUnitDeath(combat, unitId, rpUnit.id);
              moveResult.died = true;
            }
          }
        }
      }
    }
  }

  if (tilesMoved > 0) {
    applyMomentumShield(unit, tilesMoved);
    unit._movedThisTurn = true;
  }

  moveResult.tilesMoved = tilesMoved;
  return moveResult;
}

function checkOpportunityAttacks(combat, movingUnit, tileX, tileY) {
  var events = [];
  var iter = combat.units.values();
  var entry = iter.next();

  while (!entry.done) {
    var other = entry.value;
    entry = iter.next();

    if (other.type === movingUnit.type) continue;
    if (!other.alive) continue;
    if (other.rp <= 0) continue;

    if (!isAdjacent(other.x, other.y, tileX, tileY)) continue;
    if (!isAdjacent(other.x, other.y, movingUnit.x, movingUnit.y)) continue;

    var oppDmg = calculateOpportunityDamage(combat, other, movingUnit);
    var absorbed = 0;

    if (movingUnit.momentumShield > 0) {
      absorbed = Math.min(movingUnit.momentumShield, oppDmg);
      movingUnit.momentumShield -= absorbed;
      oppDmg -= absorbed;
    }

    if (oppDmg > 0) {
      movingUnit.hp -= oppDmg;
    }

    other.rp--;

    var died = movingUnit.hp <= 0;
    if (died) {
      movingUnit.alive = false;
      movingUnit.hp = 0;
    }

    events.push({
      type: 'opportunity_attack',
      attackerId: other.id,
      attackerName: other.name,
      targetId: movingUnit.id,
      damage: oppDmg + absorbed,
      shieldAbsorbed: absorbed,
      actualDamage: oppDmg,
      targetHp: Math.max(0, movingUnit.hp),
      targetDied: died,
    });

    if (died) break;
  }

  return events;
}

function calculateOpportunityDamage(combat, attacker, target) {
  if (attacker.type === 'enemy') {
    var armor = (target.combat && target.combat.baseArmor) ? target.combat.baseArmor : 0;
    var armorReduction = armor / (armor + 50);
    var oaDmg = Math.max(1, Math.floor((attacker.combat.atk || 0) * 0.5 * (1 - armorReduction)));
    if (target.type === 'player' && target.combat && target.combat.elementalResistAll > 0 && attacker.combat && attacker.combat.element) {
      oaDmg = Math.max(1, Math.floor(oaDmg * (1 - target.combat.elementalResistAll)));
    }
    if (target.type === 'player' && target.combat && target.combat.lowHpDmgReduction > 0) {
      var oaHpPct = target.hp / (target.maxHp || 1);
      if (oaHpPct < 0.30) {
        oaDmg = Math.max(1, Math.floor(oaDmg * (1 - target.combat.lowHpDmgReduction)));
      }
    }
    return oaDmg;
  } else {
    var stats = attacker.combat || {};
    var baseAtk = ((stats.might || 5) * 2) + ((attacker.level || 1) * 1.5) + (stats.weaponDamage || 0);
    var targetDef = (target.combat && target.combat.def) || 0;
    var defReduction = targetDef / (targetDef + 50);
    return Math.max(1, Math.floor(baseAtk * (stats.meleeDmgMult || 1) * 0.5 * (1 - defReduction)));
  }
}

function applyMomentumShield(unit, tilesMoved) {
  unit.momentumShield = tilesMoved;
}

module.exports = {
  init: init,
  executeMove: executeMove,
  checkOpportunityAttacks: checkOpportunityAttacks,
  calculateOpportunityDamage: calculateOpportunityDamage,
  applyMomentumShield: applyMomentumShield,
};
