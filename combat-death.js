// combat-death.js
// Unit death handling: death shroud, soulstone revive, soul shards, clone cleanup.
// Extracted from dungeon-combat.js — re-exported for backward compatibility.

'use strict';

var combatPassives = require('./combat-passive-helpers');
var getUnitCombatPassive = combatPassives.getUnitCombatPassive;
var getUnitCombatPassiveTotal = combatPassives.getUnitCombatPassiveTotal;

var combatGrid = require('./combat-grid');
var manhattanDist = combatGrid.manhattanDist;

var combatQueries = require('./combat-queries');
var getUnitsInRadius = combatQueries.getUnitsInRadius;

var combatRaidBoss = require('./combat-raid-boss');
var checkPhylacteries = combatRaidBoss.checkPhylacteries;

var _maps = require('./combat-state-maps');
var _deathShrouds = _maps.deathShrouds;
var _playerClones = _maps.playerClones;
var _soulShards = _maps.soulShards;
var _soulstones = _maps.soulstones;

var BLOODLUST_ON_KILL;

function init(deps) {
  BLOODLUST_ON_KILL = deps.BLOODLUST_ON_KILL;
}

function handleUnitDeath(combat, unitId, killerId) {
  var unit = combat.units.get(unitId);
  if (!unit) return;

  // --- Death Shroud Passive: second HP pool at 30% max HP ---
  // When main HP reaches 0, enter shroud state instead of dying
  if (!unit._deathShroudUsed) {
    var deathShroudPassive = getUnitCombatPassive(unit, 'death_shroud');
    if (deathShroudPassive) {
      var shroudHp = Math.max(1, Math.floor(unit.maxHp * (deathShroudPassive.value || 0.30)));
      unit.hp = shroudHp;
      unit.alive = true;
      unit._deathShroudUsed = true;
      _deathShrouds.set(unitId, shroudHp);
      if (!unit.statusEffects) unit.statusEffects = [];
      unit.statusEffects.push({
        name: 'death_shroud',
        type: 'buff',
        duration: 99, // Permanent until HP pool is exhausted
        sourceId: unitId,
      });
      if (combat.callbacks.broadcastToFloor) {
        combat.callbacks.broadcastToFloor('tc_combat_revive', {
          combatId: combat.id,
          unitId: unitId,
          unitName: unit.name,
          unitType: unit.type,
          revivedHp: shroudHp,
          maxHp: unit.maxHp,
          passive: 'death_shroud',
        });
      }
      return; // Unit survived via death shroud
    }
  }

  // --- Soulstone: pre-cast revive buff, auto-revive at 30% HP ---
  var soulstoneData = _soulstones.get(unitId);
  if (soulstoneData && soulstoneData.turnsLeft > 0) {
    var ssReviveHp = Math.max(1, Math.floor(unit.maxHp * 0.30));
    unit.hp = ssReviveHp;
    unit.alive = true;
    _soulstones.delete(unitId);
    if (combat.callbacks.broadcastToFloor) {
      combat.callbacks.broadcastToFloor('tc_combat_revive', {
        combatId: combat.id,
        unitId: unitId,
        unitName: unit.name,
        unitType: unit.type,
        revivedHp: ssReviveHp,
        maxHp: unit.maxHp,
        passive: 'soulstone',
        sourceId: soulstoneData.sourceId,
      });
    }
    return; // Unit survived via soulstone
  }

  // --- Support Passive: Guardian Angel — a nearby ally's passive can revive this unit ---
  // If a nearby ally has guardian_angel and it hasn't been used this combat,
  // revive this unit with enhanced HP (base 20% + guardian_angel's hpBonus)
  if (unit.type === 'player' && !unit._guardianAngelUsed) {
    var gaIter = combat.units.values();
    var gaEntry = gaIter.next();
    while (!gaEntry.done) {
      var gaAlly = gaEntry.value;
      gaEntry = gaIter.next();
      if (gaAlly.id === unitId || gaAlly.type !== unit.type || !gaAlly.alive) continue;
      var gaPassive = getUnitCombatPassive(gaAlly, 'guardian_angel');
      if (gaPassive && !gaAlly._guardianAngelChargeUsed) {
        var gaDist = manhattanDist(unit.x, unit.y, gaAlly.x, gaAlly.y);
        if (gaDist <= (gaPassive.range || 4)) {
          var gaHpPct = 0.20 + (gaPassive.reviveHpBonus || 0.20); // 20% base + 20% bonus = 40% HP
          var gaReviveHp = Math.max(1, Math.floor(unit.maxHp * gaHpPct));
          unit.hp = gaReviveHp;
          unit.alive = true;
          unit._guardianAngelUsed = true; // This unit can only be saved once per combat
          gaAlly._guardianAngelChargeUsed = true; // The guardian can only use this once per combat

          if (combat.callbacks.broadcastToFloor) {
            combat.callbacks.broadcastToFloor('tc_combat_revive', {
              combatId: combat.id,
              unitId: unitId,
              unitName: unit.name,
              unitType: unit.type,
              revivedHp: gaReviveHp,
              maxHp: unit.maxHp,
              passive: 'guardian_angel',
              guardianId: gaAlly.id,
              guardianName: gaAlly.name,
            });
          }
          return; // Unit survived via guardian angel
        }
      }
    }
  }

  // --- 3E: Revive on Death (Nine Lives) ---
  // Check BEFORE confirming death: if unit has revive_on_death passive and hasn't used it yet
  var revivePassive = getUnitCombatPassive(unit, 'revive_on_death');
  if (revivePassive && !unit._reviveUsed) {
    var reviveHpPct = revivePassive.hpPercent || 0.25;

    // Guardian Angel also enhances self-revive: if a nearby ally has guardian_angel,
    // add the hpBonus to the revive percent
    var gaEnhanceIter = combat.units.values();
    var gaEnhanceEntry = gaEnhanceIter.next();
    while (!gaEnhanceEntry.done) {
      var gaEnhAlly = gaEnhanceEntry.value;
      gaEnhanceEntry = gaEnhanceIter.next();
      if (gaEnhAlly.id === unitId || gaEnhAlly.type !== unit.type || !gaEnhAlly.alive) continue;
      var gaEnhPassive = getUnitCombatPassive(gaEnhAlly, 'guardian_angel');
      if (gaEnhPassive) {
        var gaEnhDist = manhattanDist(unit.x, unit.y, gaEnhAlly.x, gaEnhAlly.y);
        if (gaEnhDist <= (gaEnhPassive.range || 4)) {
          reviveHpPct += (gaEnhPassive.reviveHpBonus || 0.20);
          break; // Only one guardian angel bonus
        }
      }
    }

    var reviveHp = Math.max(1, Math.floor(unit.maxHp * reviveHpPct));
    unit.hp = reviveHp;
    unit.alive = true;
    unit._reviveUsed = true; // One-time use per combat

    // Broadcast revive event
    if (combat.callbacks.broadcastToFloor) {
      combat.callbacks.broadcastToFloor('tc_combat_revive', {
        combatId: combat.id,
        unitId: unitId,
        unitName: unit.name,
        unitType: unit.type,
        revivedHp: reviveHp,
        maxHp: unit.maxHp,
        passive: 'revive_on_death',
      });
    }
    return; // Unit survived — do not process death
  }

  // Confirm death
  unit.alive = false;
  unit.hp = 0;

  // --- Grant bloodlust to killer ---
  if (killerId) {
    var blKiller = combat.units.get(killerId);
    if (blKiller && blKiller.alive && blKiller.combat && blKiller.combat.bloodlust !== undefined) {
      var blGain = BLOODLUST_ON_KILL;
      // Check for on_kill_bonus passive
      if (blKiller.equippedCards) {
        for (var bki = 0; bki < blKiller.equippedCards.length; bki++) {
          var bkCard = blKiller.equippedCards[bki];
          if (!bkCard || !bkCard.effects) continue;
          for (var bkei = 0; bkei < bkCard.effects.length; bkei++) {
            if (bkCard.effects[bkei].type === 'resource_on_kill_bonus' && bkCard.effects[bkei].resource === 'bloodlust') {
              blGain += bkCard.effects[bkei].value;
            }
          }
        }
      }
      var maxBL = blKiller.combat.maxBloodlust || 50;
      blKiller.combat.bloodlust = Math.min(maxBL, blKiller.combat.bloodlust + blGain);
      blKiller._killThisTurn = true;
    }
  }

  // --- 3C: Second Wind / Heal on Kill ---
  // If a killer is known, check if the killer has second_wind (heal_on_kill) passive
  if (killerId) {
    var killer = combat.units.get(killerId);
    if (killer && killer.alive) {
      var healOnKillValue = getUnitCombatPassiveTotal(killer, 'heal_on_kill');
      if (healOnKillValue > 0) {
        var oldKillerHp = killer.hp;
        killer.hp = Math.min(killer.maxHp, killer.hp + healOnKillValue);
        var actualHealOnKill = killer.hp - oldKillerHp;

        if (actualHealOnKill > 0 && combat.callbacks.broadcastToFloor) {
          combat.callbacks.broadcastToFloor('tc_combat_passive_heal', {
            combatId: combat.id,
            unitId: killerId,
            unitName: killer.name,
            healAmount: actualHealOnKill,
            unitHp: killer.hp,
            unitMaxHp: killer.maxHp,
            passive: 'heal_on_kill',
          });
        }
      }
    }
  }

  // --- Support Passive: War Drums — after killing enemy, party gains attack speed ---
  if (killerId && unit.type !== 'player') {
    var wdKiller = combat.units.get(killerId);
    if (wdKiller && wdKiller.alive && wdKiller.type === 'player') {
      var wdPassive = getUnitCombatPassive(wdKiller, 'war_drums');
      if (wdPassive) {
        var wdRange = wdPassive.range || 3;
        var wdDuration = wdPassive.duration || 2;
        var wdAllies = getUnitsInRadius(combat, wdKiller.x, wdKiller.y, wdRange);
        for (var wdi = 0; wdi < wdAllies.length; wdi++) {
          var wdAlly = wdAllies[wdi];
          if (wdAlly.type !== wdKiller.type || !wdAlly.alive) continue;
          if (!wdAlly.statusEffects) wdAlly.statusEffects = [];
          wdAlly.statusEffects.push({
            name: 'war_drums',
            type: 'buff',
            duration: wdDuration,
            speedMult: 1 + (wdPassive.speedBonus || 0.10),
            sourceId: killerId,
          });
        }
        if (combat.callbacks.broadcastToFloor) {
          combat.callbacks.broadcastToFloor('tc_combat_passive_buff', {
            combatId: combat.id,
            sourceId: killerId,
            passive: 'war_drums',
            buffName: 'war_drums',
            duration: wdDuration,
          });
        }
      }
    }
  }

  // --- Soul Shards Passive: +1 shard per kill, at 5 shards next dark ability +75% damage ---
  if (killerId && unit.type !== 'player') {
    var ssKiller = combat.units.get(killerId);
    if (ssKiller && ssKiller.alive && ssKiller.type === 'player') {
      var soulShardsPassive = getUnitCombatPassive(ssKiller, 'soul_shards');
      if (soulShardsPassive) {
        var currentShards = (_soulShards.get(killerId) || 0) + 1;
        _soulShards.set(killerId, currentShards);
        if (currentShards >= 5) {
          _soulShards.set(killerId, 0);
          if (!ssKiller.statusEffects) ssKiller.statusEffects = [];
          ssKiller.statusEffects.push({
            name: 'soul_shards_empowered',
            type: 'buff',
            duration: 3,
            damageBoost: 75, // +75% damage for dark abilities
            soulShardsBuff: true,
            sourceId: killerId,
          });
          if (combat.callbacks.broadcastToFloor) {
            combat.callbacks.broadcastToFloor('tc_combat_passive_buff', {
              combatId: combat.id,
              sourceId: killerId,
              passive: 'soul_shards',
              buffName: 'soul_shards_empowered',
              duration: 3,
            });
          }
        }
      }
    }
  }

  // --- Distortion Passive: when a clone dies, grant evasion buff to owner ---
  // Check if dying unit is a clone
  if (unit._isClone && unit._ownerId) {
    var cloneOwner = combat.units.get(unit._ownerId);
    if (cloneOwner && cloneOwner.alive) {
      var distortionPassive = getUnitCombatPassive(cloneOwner, 'distortion');
      if (distortionPassive) {
        if (!cloneOwner.statusEffects) cloneOwner.statusEffects = [];
        cloneOwner.statusEffects.push({
          name: 'distortion_evasion',
          type: 'buff',
          duration: distortionPassive.duration || 2,
          dodgeBonus: distortionPassive.value || 0.20,
          sourceId: unit._ownerId,
        });
      }
    }
    // Remove clone from the tracking map
    var ownerClones = _playerClones.get(unit._ownerId);
    if (ownerClones) {
      for (var clIdx = ownerClones.length - 1; clIdx >= 0; clIdx--) {
        if (ownerClones[clIdx].cloneId === unitId) {
          ownerClones.splice(clIdx, 1);
          break;
        }
      }
    }
  }

  if (unit.type === 'player') {
    // Notify dungeon handler of player death
    if (combat.callbacks.handleDeath && unit.socketId) {
      combat.callbacks.handleDeath(unit.socketId);
    }

    // Broadcast
    if (combat.callbacks.broadcastToFloor) {
      combat.callbacks.broadcastToFloor('tc_combat_unit_died', {
        combatId: combat.id,
        unitId: unitId,
        unitName: unit.name,
        unitType: 'player',
      });
    }
  } else {
    // Enemy died — check if leviathan part
    if (unit.isLeviathanPart && combat.callbacks.handlePartDeath) {
      combat.callbacks.handlePartDeath(combat, unitId, unit);
    }

    // Lich raid: check if phylactery destroyed
    if (combat.isLichRaid && unit.isPhylactery) {
      checkPhylacteries(combat);
    }

    // Corpse tracking: leave a corpse at the enemy's position for corpse_explosion
    if (!unit.isPlayerSummon && !unit.isAdd && combat.corpses) {
      combat.corpses.push({ x: unit.x, y: unit.y, id: unitId, name: unit.name });
    }

    if (combat.callbacks.broadcastToFloor) {
      combat.callbacks.broadcastToFloor('tc_combat_unit_died', {
        combatId: combat.id,
        unitId: unitId,
        unitName: unit.name,
        unitType: unit.isLeviathanPart ? 'leviathan_part' : 'enemy',
      });
    }
  }
}

module.exports = {
  init: init,
  handleUnitDeath: handleUnitDeath,
};
