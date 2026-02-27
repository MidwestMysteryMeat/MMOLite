// combat-queries.js
// Read-only combat query and serialization functions.
// Extracted from dungeon-combat.js — re-exported for backward compatibility.

'use strict';

var combatGrid = require('./combat-grid');
var manhattanDist = combatGrid.manhattanDist;
var chebyshevDist = combatGrid.chebyshevDist;

var activeCombats, socketToCombat;

function init(deps) {
  activeCombats = deps.activeCombats;
  socketToCombat = deps.socketToCombat;
}

function getCombatState(combatId) {
  var combat = activeCombats.get(combatId);
  if (!combat) return null;

  return {
    id: combat.id,
    dungeonId: combat.dungeonId,
    state: combat.state,
    turnNumber: combat.turnNumber,
    units: serializeUnits(combat),
    initiative: buildInitiativeOrder(combat),
    exhaustionDamage: combat.exhaustionDamage,
    turnGroup: combat.turnGroup,
    tileEffects: combat.tileEffects,
  };
}

function getCombatBySocketId(socketId) {
  var combatId = socketToCombat.get(socketId);
  if (!combatId) return null;
  return activeCombats.get(combatId) || null;
}

function getActiveCombats() {
  return activeCombats;
}

function buildInitiativeOrder(combat) {
  var order = [];
  var iter = combat.units.values();
  var entry = iter.next();

  while (!entry.done) {
    var unit = entry.value;
    entry = iter.next();
    if (!unit.alive) continue;

    order.push({
      unitId: unit.id,
      name: unit.name,
      type: unit.type,
      ct: unit.ct,
      speed: unit.speed,
      hp: unit.hp,
      maxHp: unit.maxHp,
    });
  }

  order.sort(function(a, b) { return b.ct - a.ct; });
  return order;
}

function serializeUnits(combat) {
  var result = [];
  var iter = combat.units.values();
  var entry = iter.next();

  while (!entry.done) {
    var u = entry.value;
    entry = iter.next();

    result.push({
      id: u.id,
      type: u.type,
      name: u.name,
      x: u.x,
      y: u.y,
      hp: u.hp,
      maxHp: u.maxHp,
      mp: u.mp,
      ap: u.ap,
      rp: u.rp,
      ct: u.ct,
      speed: u.speed,
      alive: u.alive,
      momentumShield: u.momentumShield,
      mana: (u.combat && u.combat.mana) || 0,
      maxMana: (u.combat && u.combat.maxMana) || 50,
      stamina: (u.combat && u.combat.stamina) || 0,
      maxStamina: (u.combat && u.combat.maxStamina) || 50,
      bloodlust: (u.combat && u.combat.bloodlust) || 0,
      maxBloodlust: (u.combat && u.combat.maxBloodlust) || 50,
      focus: (u.combat && u.combat.focus) || 0,
      maxFocus: (u.combat && u.combat.maxFocus) || 50,
      primaryResource: (u.combat && u.combat.primaryResource) || 'mana',
      statusEffects: u.statusEffects.map(function(se) {
        return { name: se.name, duration: se.duration };
      }),
      archetype: u.archetype,
      isBoss: u.isBoss || false,
      equippedCards: (u.equippedCards || []).map(function(c) {
        if (!c) return null;
        return {
          cardId: c.cardId || c.id,
          name: c.name,
          range: c.range || 1,
          combatType: c.combatType || 'melee',
          manaCost: c.manaCost || 0,
          cooldown: c.cooldown || 0,
          targetType: c.targetType || 'enemy',
          aoeRadius: c.aoeRadius || 0,
          type: c.type,
        };
      }).filter(Boolean),
    });
  }

  return result;
}

function getPlayerSocketIds(combat) {
  var ids = [];
  var iter = combat.units.values();
  var entry = iter.next();

  while (!entry.done) {
    var unit = entry.value;
    entry = iter.next();
    if (unit.type === 'player' && unit.socketId) {
      ids.push(unit.socketId);
    }
  }

  return ids;
}

function getEnemyList(combat) {
  var enemies = [];
  var iter = combat.units.values();
  var entry = iter.next();

  while (!entry.done) {
    var u = entry.value;
    entry = iter.next();
    if (u.type !== 'enemy') continue;

    enemies.push({
      id: u.id,
      name: u.name,
      x: u.x,
      y: u.y,
      hp: u.hp,
      maxHp: u.maxHp,
      archetype: u.archetype,
      isBoss: u.isBoss || false,
    });
  }

  return enemies;
}

function getPlayerList(combat) {
  var players = [];
  var iter = combat.units.values();
  var entry = iter.next();

  while (!entry.done) {
    var u = entry.value;
    entry = iter.next();
    if (u.type !== 'player') continue;

    players.push({
      id: u.id,
      name: u.name,
      x: u.x,
      y: u.y,
      hp: u.hp,
      maxHp: u.maxHp,
      race: u.race,
      level: u.level,
    });
  }

  return players;
}

function getUnitAtPosition(combat, x, y) {
  var iter = combat.units.values();
  var entry = iter.next();
  while (!entry.done) {
    var u = entry.value;
    if (u.alive && u.x === x && u.y === y) return u;
    entry = iter.next();
  }
  return null;
}

function getUnitsInRadius(combat, cx, cy, radius) {
  var results = [];
  var iter = combat.units.values();
  var entry = iter.next();
  while (!entry.done) {
    var u = entry.value;
    if (u.alive && manhattanDist(u.x, u.y, cx, cy) <= radius) {
      results.push(u);
    }
    entry = iter.next();
  }
  return results;
}

function getValidAttackTargets(combat, unitId) {
  var unit = combat.units.get(unitId);
  if (!unit || !unit.alive) return [];

  var targets = [];
  var attackRange = 1;

  if (unit.type === 'player' && unit.combat && unit.combat.weaponRange) {
    attackRange = Math.max(1, Math.floor(unit.combat.weaponRange));
  } else if (unit.type === 'enemy' && unit.combat && unit.combat.range) {
    attackRange = unit.combat.range;
  }

  var iter = combat.units.values();
  var entry = iter.next();

  while (!entry.done) {
    var other = entry.value;
    entry = iter.next();

    if (other.type === unit.type) continue;
    if (!other.alive) continue;

    var dist = chebyshevDist(unit.x, unit.y, other.x, other.y);
    if (dist <= attackRange) {
      targets.push({
        unitId: other.id,
        name: other.name,
        x: other.x,
        y: other.y,
        hp: other.hp,
        maxHp: other.maxHp,
      });
    }
  }

  return targets;
}

module.exports = {
  init: init,
  getCombatState: getCombatState,
  getCombatBySocketId: getCombatBySocketId,
  getActiveCombats: getActiveCombats,
  buildInitiativeOrder: buildInitiativeOrder,
  serializeUnits: serializeUnits,
  getPlayerSocketIds: getPlayerSocketIds,
  getEnemyList: getEnemyList,
  getPlayerList: getPlayerList,
  getUnitAtPosition: getUnitAtPosition,
  getUnitsInRadius: getUnitsInRadius,
  getValidAttackTargets: getValidAttackTargets,
};
