// combat-player-mgmt.js
// Player join, disconnect, and reconnect handling for combat.
// Extracted from dungeon-combat.js — re-exported for backward compatibility.

'use strict';

var rpgData = require('./rpg-data');

var activeCombats, socketToCombat;
var endUnitTurn, applyGroupScaling, checkReinforcements;
var serializeUnits, buildInitiativeOrder;
var PLAYER_BASE_MP, PLAYER_BASE_AP, PLAYER_BASE_RP, FOCUS_STARTING_VALUE;

function init(deps) {
  activeCombats = deps.activeCombats;
  socketToCombat = deps.socketToCombat;
  endUnitTurn = deps.endUnitTurn;
  applyGroupScaling = deps.applyGroupScaling;
  checkReinforcements = deps.checkReinforcements;
  serializeUnits = deps.serializeUnits;
  buildInitiativeOrder = deps.buildInitiativeOrder;
  PLAYER_BASE_MP = deps.PLAYER_BASE_MP;
  PLAYER_BASE_AP = deps.PLAYER_BASE_AP;
  PLAYER_BASE_RP = deps.PLAYER_BASE_RP;
  FOCUS_STARTING_VALUE = deps.FOCUS_STARTING_VALUE;
}

function addPlayerToCombat(combatId, playerData) {
  var combat = activeCombats.get(combatId);
  if (!combat) return false;

  var p = playerData;
  var pUnitId = 'player_' + p.socketId;

  if (combat.units.has(pUnitId)) return false;
  if (socketToCombat.has(p.socketId)) return false;

  var pSpeed = rpgData.computeCombatSpeed(
    p.race || 'human',
    (p.rpgStats && p.rpgStats.finesse) ? p.rpgStats.finesse : 5,
    p.equippedCards || []
  );
  var pCombat = p.combat || {};

  var playerUnit = {
    id: pUnitId,
    type: 'player',
    socketId: p.socketId,
    name: p.name || 'Unknown',
    x: p.x,
    y: p.y,
    ct: 0,
    speed: pSpeed,
    hp: pCombat.hp || pCombat.maxHp || 100,
    maxHp: pCombat.maxHp || 100,
    mp: PLAYER_BASE_MP,
    ap: PLAYER_BASE_AP,
    rp: PLAYER_BASE_RP,
    momentumShield: 0,
    statusEffects: [],
    abilityCooldowns: new Map(),
    combat: {
      might: (p.rpgStats && p.rpgStats.might) ? p.rpgStats.might : 5,
      finesse: (p.rpgStats && p.rpgStats.finesse) ? p.rpgStats.finesse : 5,
      acumen: (p.rpgStats && p.rpgStats.acumen) ? p.rpgStats.acumen : 5,
      mana: pCombat.mana || 50,
      maxMana: pCombat.maxMana || 50,
      stamina: pCombat.stamina || rpgData.computeResourceMax('stamina', p.race, 0),
      maxStamina: pCombat.maxStamina || rpgData.computeResourceMax('stamina', p.race, 0),
      bloodlust: pCombat.bloodlust || 0,
      maxBloodlust: pCombat.maxBloodlust || rpgData.computeResourceMax('bloodlust', p.race, 0),
      focus: pCombat.focus || FOCUS_STARTING_VALUE,
      maxFocus: pCombat.maxFocus || rpgData.computeResourceMax('focus', p.race, 0),
      primaryResource: rpgData.RACE_PRIMARY_RESOURCE[p.race] || 'mana',
      meleeDmgMult: pCombat.meleeDmgMult || 1,
      magicDmgMult: pCombat.magicDmgMult || 1,
      critChance: pCombat.critChance || 0.05,
      dodgeChance: pCombat.dodgeChance || 0,
      baseArmor: pCombat.baseArmor || 0,
      weaponDamage: pCombat.weaponDamage || 0,
      weaponRange: pCombat.weaponRange || 1.5,
      weaponCategory: pCombat.weaponCategory || 'melee_blade',
      blockChance: pCombat.blockChance || 0,
      dungeonDmgBonus: pCombat.dungeonDmgBonus || 0,
      bossDmgBonus: pCombat.bossDmgBonus || 0,
      dungeonDefBonus: pCombat.dungeonDefBonus || 0,
      hpRegen: pCombat.hpRegen || 0,
    },
    level: p.level || 1,
    race: p.race || 'human',
    equippedCards: p.equippedCards || [],
    archetype: null,
    alive: true,
    autoDefend: false,
    _lastTargetId: null,
    _killThisTurn: false,
    _lastActionTurn: 0,
  };

  combat.units.set(pUnitId, playerUnit);
  socketToCombat.set(p.socketId, combatId);

  if (combat.callbacks.emitToPlayer) {
    combat.callbacks.emitToPlayer(p.socketId, 'tc_combat_start', {
      combatId: combat.id,
      myUnitId: pUnitId,
      units: serializeUnits(combat),
      initiative: buildInitiativeOrder(combat),
      turnNumber: combat.turnNumber,
      state: combat.state,
      tileEffects: combat.tileEffects,
      lateJoin: true,
    });
  }

  if (combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_combat_initiative', {
      combatId: combat.id,
      units: serializeUnits(combat),
      initiative: buildInitiativeOrder(combat),
      joinedUnit: { id: pUnitId, name: playerUnit.name, x: playerUnit.x, y: playerUnit.y },
    });
  }

  applyGroupScaling(combat);
  checkReinforcements(combat);

  return true;
}

function handlePlayerDisconnect(combatId, socketId) {
  var combat = null;

  if (combatId) {
    combat = activeCombats.get(combatId);
  } else {
    combatId = socketToCombat.get(socketId);
    if (combatId) {
      combat = activeCombats.get(combatId);
    }
  }

  if (!combat) return;

  var unitId = 'player_' + socketId;
  var unit = combat.units.get(unitId);
  if (!unit) return;

  unit.autoDefend = true;

  if (combat.pendingReaction && combat.pendingReaction.defenderId === unitId) {
    if (combat.reactionTimer) {
      clearTimeout(combat.reactionTimer);
      combat.reactionTimer = null;
    }
    combat.pendingReaction = null;
    if (combat.pendingReactionCallback) {
      var cb = combat.pendingReactionCallback;
      combat.pendingReactionCallback = null;
      cb({ success: false, modifiedDamage: 0, counterDamage: 0 });
    }
  }

  if (combat.state === 'player_turn' && combat.pendingActions.has(unitId) && !combat.pendingActions.get(unitId)) {
    combat.pendingActions.set(unitId, true);
    endUnitTurn(combat, unitId, 'waited');
  }

  if (combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_combat_player_disconnect', {
      combatId: combat.id,
      unitId: unitId,
      playerName: unit.name,
    });
  }
}

function handlePlayerReconnect(combatId, socketId) {
  var combat = activeCombats.get(combatId);
  if (!combat) return;

  var unitId = 'player_' + socketId;
  var unit = combat.units.get(unitId);
  if (!unit) return;

  unit.autoDefend = false;
  unit.socketId = socketId;
  socketToCombat.set(socketId, combatId);

  if (combat.callbacks.emitToPlayer) {
    combat.callbacks.emitToPlayer(socketId, 'tc_combat_state', {
      combatId: combat.id,
      state: combat.state,
      turnNumber: combat.turnNumber,
      units: serializeUnits(combat),
      initiative: buildInitiativeOrder(combat),
      exhaustionDamage: combat.exhaustionDamage,
    });
  }
}

module.exports = {
  init: init,
  addPlayerToCombat: addPlayerToCombat,
  handlePlayerDisconnect: handlePlayerDisconnect,
  handlePlayerReconnect: handlePlayerReconnect,
};
