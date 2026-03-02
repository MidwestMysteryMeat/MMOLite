// combat-turn-start.js
// Player turn start logic: resource reset, passive ticks, turn timer.
// Extracted from dungeon-combat.js — re-exported for backward compatibility.

'use strict';

var combatPassives = require('./combat-passive-helpers');
var getUnitCombatPassive = combatPassives.getUnitCombatPassive;
var getUnitCombatPassiveTotal = combatPassives.getUnitCombatPassiveTotal;
var hasImmunity = combatPassives.hasImmunity;

var combatGrid = require('./combat-grid');
var get8Neighbors = combatGrid.get8Neighbors;
var manhattanDist = combatGrid.manhattanDist;
var calculateMoveRange = combatGrid.calculateMoveRange;

var combatQueries = require('./combat-queries');
var buildInitiativeOrder = combatQueries.buildInitiativeOrder;
var getUnitsInRadius = combatQueries.getUnitsInRadius;
var getUnitAtPosition = combatQueries.getUnitAtPosition;
var getValidAttackTargets = combatQueries.getValidAttackTargets;
var serializeUnits = combatQueries.serializeUnits;

var _maps = require('./combat-state-maps');
var _dancePartners = _maps.dancePartners;
var _divineInvulnerability = _maps.divineInvulnerability;
var _fadeActive = _maps.fadeActive;
var _innervates = _maps.innervates;
var _intercepts = _maps.intercepts;
var _lilyTokens = _maps.lilyTokens;
var _soulstones = _maps.soulstones;

var activeCombats;
var PLAYER_BASE_MP, PLAYER_BASE_AP;
var MANA_REGEN_PER_TURN, STAMINA_REGEN_PER_TURN;
var BLOODLUST_DECAY_PER_TURN, BLOODLUST_DECAY_DELAY;
var checkCombatEnd, endCombat, checkExhaustion;
var endUnitTurn, getDynamicTurnTimer, handleUnitDeath;
var processNPCActions;
var EXHAUSTION_START, EXHAUSTION_START_BOSS;
var handleTurnTimeout;

function init(deps) {
  activeCombats = deps.activeCombats;
  PLAYER_BASE_MP = deps.PLAYER_BASE_MP;
  PLAYER_BASE_AP = deps.PLAYER_BASE_AP;
  MANA_REGEN_PER_TURN = deps.MANA_REGEN_PER_TURN;
  STAMINA_REGEN_PER_TURN = deps.STAMINA_REGEN_PER_TURN;
  BLOODLUST_DECAY_PER_TURN = deps.BLOODLUST_DECAY_PER_TURN;
  BLOODLUST_DECAY_DELAY = deps.BLOODLUST_DECAY_DELAY;
  checkCombatEnd = deps.checkCombatEnd;
  endCombat = deps.endCombat;
  checkExhaustion = deps.checkExhaustion;
  endUnitTurn = deps.endUnitTurn;
  getDynamicTurnTimer = deps.getDynamicTurnTimer;
  handleUnitDeath = deps.handleUnitDeath;
  processNPCActions = deps.processNPCActions;
  EXHAUSTION_START = deps.EXHAUSTION_START;
  EXHAUSTION_START_BOSS = deps.EXHAUSTION_START_BOSS;
  handleTurnTimeout = deps.handleTurnTimeout;
}

function startPlayerTurn(combat, unitIds) {
  if (!activeCombats.has(combat.id)) return;

  combat.state = 'player_turn';
  combat.turnNumber++;
  combat.turnGroup = unitIds.slice();
  combat.pendingActions = new Map();

  // Check exhaustion
  checkExhaustion(combat);

  // Re-check victory after exhaustion
  var checkResult = checkCombatEnd(combat);
  if (checkResult) {
    endCombat(combat, checkResult);
    return;
  }

  // Build initiative for display
  var initiative = buildInitiativeOrder(combat);

  // Compute dynamic turn timer based on player count
  var turnTimerMs = getDynamicTurnTimer(combat);
  var turnTimerSec = Math.floor(turnTimerMs / 1000);

  // For each player in the turn group
  for (var i = 0; i < unitIds.length; i++) {
    var unitId = unitIds[i];
    var unit = combat.units.get(unitId);
    if (!unit || !unit.alive) continue;

    // Reset turn resources
    unit.mp = PLAYER_BASE_MP;
    unit.ap = PLAYER_BASE_AP;
    unit.momentumShield = 0;

    // A3: Heavy armor MP penalty — full plate (~-0.13) loses 1 MP
    if (unit.combat && unit.combat.armorSpeedMod && unit.combat.armorSpeedMod <= -0.10) {
      unit.mp = Math.max(1, unit.mp - 1);
    }

    // --- Aquatic Passive: aquatic_adaptation — +1 MP on water floors (swim speed bonus) ---
    var aqAdaptTurn = getUnitCombatPassive(unit, 'aquatic_adaptation');
    if (aqAdaptTurn && combat._isWaterFloor) {
      unit.mp += 1;
    }

    // Base mana regeneration
    if (unit.combat && unit.combat.mana !== undefined) {
      var maxMana = (unit.combat && unit.combat.maxMana) ? unit.combat.maxMana : 50;
      unit.combat.mana = Math.min(maxMana, unit.combat.mana + MANA_REGEN_PER_TURN);
    }

    // Stamina regeneration (passive, steady)
    if (unit.combat && unit.combat.stamina !== undefined) {
      var maxStamina = unit.combat.maxStamina || 50;
      var staminaRegen = STAMINA_REGEN_PER_TURN;
      // Check for resource_regen_bonus passive cards
      if (unit.equippedCards) {
        for (var sri = 0; sri < unit.equippedCards.length; sri++) {
          var srCard = unit.equippedCards[sri];
          if (!srCard || !srCard.effects) continue;
          for (var srei = 0; srei < srCard.effects.length; srei++) {
            var srEff = srCard.effects[srei];
            if (srEff.type === 'resource_regen_bonus' && srEff.resource === 'stamina') {
              staminaRegen += srEff.value;
            }
            // Low stamina regen multiplier
            if (srEff.type === 'resource_low_regen_mult' && srEff.resource === 'stamina') {
              if (unit.combat.stamina < maxStamina * (srEff.threshold || 0.25)) {
                staminaRegen = Math.floor(staminaRegen * (srEff.value || 2.0));
              }
            }
          }
        }
      }
      unit.combat.stamina = Math.min(maxStamina, unit.combat.stamina + staminaRegen);
    }

    // Bloodlust decay (with delay — only decays after BLOODLUST_DECAY_DELAY turns of no action)
    if (unit.combat && unit.combat.bloodlust !== undefined && unit.combat.bloodlust > 0) {
      var turnsSinceAction = combat.turnNumber - (unit._lastActionTurn || 0);
      if (!unit._killThisTurn && turnsSinceAction >= BLOODLUST_DECAY_DELAY) {
        var blDecay = BLOODLUST_DECAY_PER_TURN;
        // Check for decay reduction passive
        if (unit.equippedCards) {
          for (var bdi = 0; bdi < unit.equippedCards.length; bdi++) {
            var bdCard = unit.equippedCards[bdi];
            if (!bdCard || !bdCard.effects) continue;
            for (var bdei = 0; bdei < bdCard.effects.length; bdei++) {
              if (bdCard.effects[bdei].type === 'resource_decay_reduction' && bdCard.effects[bdei].resource === 'bloodlust') {
                blDecay = Math.floor(blDecay * (1 - (bdCard.effects[bdei].value || 0)));
              }
            }
          }
        }
        unit.combat.bloodlust = Math.max(0, unit.combat.bloodlust - blDecay);
      }
      unit._killThisTurn = false; // Reset for next turn
    }

    // Focus: no passive regen (built through consecutive actions in executeAbility)

    // Apply passive combat effects (HP regen, mana regen, poison aura)
    if (unit.equippedCards) {
      for (var pci = 0; pci < unit.equippedCards.length; pci++) {
        var pCard = unit.equippedCards[pci];
        if (!pCard || !pCard.combatPassive) continue;
        if (pCard.combatPassive.type === 'hp_regen' && pCard.combatPassive.value) {
          unit.hp = Math.min(unit.maxHp, unit.hp + pCard.combatPassive.value);
        }
        if (pCard.combatPassive.type === 'mana_regen' && pCard.combatPassive.value) {
          var pMaxMana = (unit.combat && unit.combat.maxMana) ? unit.combat.maxMana : 50;
          unit.combat.mana = Math.min(pMaxMana, (unit.combat.mana || 0) + pCard.combatPassive.value);
        }
      }
    }

    // --- 3G: Poison Aura — deal small damage to adjacent enemies each tick ---
    var poisonAuraValue = getUnitCombatPassiveTotal(unit, 'poison_aura');
    if (poisonAuraValue > 0) {
      var paNeighbors = get8Neighbors(unit.x, unit.y, combat.floor.width, combat.floor.height);
      for (var pni = 0; pni < paNeighbors.length; pni++) {
        var pan = paNeighbors[pni];
        var paTarget = getUnitAtPosition(combat, pan.x, pan.y);
        if (paTarget && paTarget.alive && paTarget.type !== unit.type) {
          // Check poison immunity on the target
          if (!hasImmunity(paTarget, 'poison')) {
            paTarget.hp -= poisonAuraValue;
            var paKilled = paTarget.hp <= 0;
            if (paKilled) {
              paTarget.hp = 0;
              paTarget.alive = false;
            }
            if (combat.callbacks.broadcastToFloor) {
              combat.callbacks.broadcastToFloor('tc_combat_passive_damage', {
                combatId: combat.id,
                sourceId: unit.id,
                targetId: paTarget.id,
                damage: poisonAuraValue,
                targetHp: paKilled ? 0 : paTarget.hp,
                targetMaxHp: paTarget.maxHp,
                passive: 'poison_aura',
              });
            }
            if (paKilled) {
              handleUnitDeath(combat, paTarget.id, unit.id);
              if (paTarget.alive && combat.callbacks.broadcastToFloor) {
                combat.callbacks.broadcastToFloor('tc_combat_revive', {
                  combatId: combat.id, unitId: paTarget.id, unitName: paTarget.name,
                  unitType: paTarget.type, revivedHp: paTarget.hp, maxHp: paTarget.maxHp,
                  passive: 'poison_aura',
                });
              }
            }
          }
        }
      }
    }

    // --- Support Passive: Healing Aura — allies in range regen 1% max HP per turn ---
    var healingAuraPassive = getUnitCombatPassive(unit, 'healing_aura');
    if (healingAuraPassive) {
      var haRange = healingAuraPassive.range || 2;
      var haHpPct = healingAuraPassive.hpPercent || 0.01;
      var haAllies = getUnitsInRadius(combat, unit.x, unit.y, haRange);
      for (var hai = 0; hai < haAllies.length; hai++) {
        var haAlly = haAllies[hai];
        if (haAlly.type !== unit.type || !haAlly.alive || haAlly.id === unit.id) continue;
        var haHealAmt = Math.max(1, Math.floor(haAlly.maxHp * haHpPct));
        if (haAlly.hp < haAlly.maxHp) {
          var haOldHp = haAlly.hp;
          haAlly.hp = Math.min(haAlly.maxHp, haAlly.hp + haHealAmt);
          var haActual = haAlly.hp - haOldHp;
          if (haActual > 0 && combat.callbacks.broadcastToFloor) {
            combat.callbacks.broadcastToFloor('tc_combat_passive_heal', {
              combatId: combat.id,
              unitId: haAlly.id,
              unitName: haAlly.name,
              healAmount: haActual,
              unitHp: haAlly.hp,
              unitMaxHp: haAlly.maxHp,
              passive: 'healing_aura',
              sourceId: unit.id,
            });
          }
        }
      }
    }

    // --- Support Passive: Inspiring Presence — allies in range regen mana 10% faster ---
    var inspiringPresencePassive = getUnitCombatPassive(unit, 'inspiring_presence');
    if (inspiringPresencePassive) {
      var ipRange = inspiringPresencePassive.range || 3;
      var ipBonus = inspiringPresencePassive.manaRegenBonus || 0.10;
      var ipAllies = getUnitsInRadius(combat, unit.x, unit.y, ipRange);
      for (var ipi = 0; ipi < ipAllies.length; ipi++) {
        var ipAlly = ipAllies[ipi];
        if (ipAlly.type !== unit.type || !ipAlly.alive || ipAlly.id === unit.id) continue;
        if (ipAlly.combat && ipAlly.combat.mana !== undefined) {
          var ipMaxMana = (ipAlly.combat.maxMana) ? ipAlly.combat.maxMana : 50;
          var ipBonusMana = Math.max(1, Math.floor(MANA_REGEN_PER_TURN * ipBonus));
          ipAlly.combat.mana = Math.min(ipMaxMana, ipAlly.combat.mana + ipBonusMana);
        }
      }
    }

    // --- Support Passive: Dissonance — enemies within range have reduced healing ---
    // (Applied when enemies attempt to heal — tracked via aura presence in range check)
    // The actual reduction is applied in the healing execution by checking for nearby dissonance auras.

    // --- Support Passive: Lifeline cooldown tick ---
    if (unit._lifelineCooldown && unit._lifelineCooldownTurns !== undefined) {
      unit._lifelineCooldownTurns--;
      if (unit._lifelineCooldownTurns <= 0) {
        unit._lifelineCooldown = false;
        delete unit._lifelineCooldownTurns;
      }
    }

    // --- Support Passive: Mass Dispel cooldown tick ---
    if (unit._massDispelCooldown && unit._massDispelCooldown > 0) {
      unit._massDispelCooldown--;
    }

    // Track movement for fortress passive
    // Save whether unit moved last turn for fortify stationary check, then reset
    unit._didMoveLastTurn = unit._movedThisTurn || false;
    unit._movedThisTurn = false;

    // --- Pure Defense: Fortify stationaryArmorBoostPercent — recalculate armor bonus based on movement ---
    if (unit.statusEffects) {
      for (var frtI = 0; frtI < unit.statusEffects.length; frtI++) {
        var frtBuff = unit.statusEffects[frtI];
        if (frtBuff.stationaryArmorBoostPercent && frtBuff._baseArmorForPercent !== undefined) {
          // If unit didn't move last turn, upgrade to stationary bonus; otherwise revert to normal
          var frtPct = unit._didMoveLastTurn ? frtBuff._normalArmorBoostPercent : frtBuff.stationaryArmorBoostPercent;
          frtBuff.armorBoost = Math.max(1, Math.floor(frtBuff._baseArmorForPercent * frtPct));
        }
      }
    }

    // --- Grappler Passive: bear_hug — deal 5% max HP damage to grappled targets each turn ---
    var bearHugPassive = getUnitCombatPassive(unit, 'bear_hug');
    if (bearHugPassive && unit.statusEffects) {
      // Find any self_immobilized effects (indicates active grapple)
      for (var bhI = 0; bhI < unit.statusEffects.length; bhI++) {
        var bhSE = unit.statusEffects[bhI];
        if (bhSE.name === 'self_immobilized' && bhSE.linkedTargetId) {
          var bhTarget = combat.units.get(bhSE.linkedTargetId);
          if (bhTarget && bhTarget.alive) {
            var bhDmg = Math.max(1, Math.floor((unit.maxHp || 100) * (bearHugPassive.grappleTickDamageHpPercent || 0.05)));
            bhTarget.hp -= bhDmg;
            if (bhTarget.hp <= 0) {
              bhTarget.alive = false;
              bhTarget.hp = 0;
              handleUnitDeath(combat, bhTarget.id, unitId);
              if (bhTarget.alive && combat.callbacks.broadcastToFloor) {
                combat.callbacks.broadcastToFloor('tc_combat_revive', {
                  combatId: combat.id, unitId: bhTarget.id, unitName: bhTarget.name,
                  unitType: bhTarget.type, revivedHp: bhTarget.hp, maxHp: bhTarget.maxHp,
                  passive: 'bear_hug',
                });
              }
            }
            if (combat.callbacks.broadcastToFloor) {
              combat.callbacks.broadcastToFloor('tc_combat_passive_damage', {
                combatId: combat.id, sourceId: unitId, targetId: bhTarget.id,
                damage: bhDmg, targetHp: Math.max(0, bhTarget.hp), targetMaxHp: bhTarget.maxHp,
                passive: 'bear_hug',
              });
            }
          }
        }
      }
    }

    // NOTE: aquatic_adaptation stat bonuses (+30% all stats on water) are applied inline
    // in calculateDamage() and executeAbility() to avoid double-dipping with status buffs.
    // The +1 MP swim speed bonus is handled above in the MP reset section.

    // --- Passive: resilient_body — 2% max HP regen per turn, doubled below 30% HP ---
    var resilBodyPassive = getUnitCombatPassive(unit, 'resilient_body');
    if (resilBodyPassive && unit.hp < unit.maxHp) {
      var rbRegenPct = resilBodyPassive.hpRegenPercent || 0.02;
      var rbHpRatio = unit.hp / (unit.maxHp || 1);
      if (rbHpRatio < (resilBodyPassive.lowHpThreshold || 0.30)) {
        rbRegenPct *= (resilBodyPassive.lowHpRegenMult || 2.0);
      }
      var rbHeal = Math.max(1, Math.floor(unit.maxHp * rbRegenPct));
      var rbOldHp = unit.hp;
      unit.hp = Math.min(unit.maxHp, unit.hp + rbHeal);
      var rbActual = unit.hp - rbOldHp;
      if (rbActual > 0 && combat.callbacks.broadcastToFloor) {
        combat.callbacks.broadcastToFloor('tc_combat_passive_heal', {
          combatId: combat.id, unitId: unitId,
          heal: rbActual, targetHp: unit.hp, targetMaxHp: unit.maxHp,
          passive: 'resilient_body',
        });
      }
    }

    // --- Passive: escape_artist — break roots/grabs/grapples after 1 turn instead of full duration ---
    var escArtistPassive = getUnitCombatPassive(unit, 'escape_artist');
    if (escArtistPassive && unit.statusEffects) {
      var eaCcTypes = escArtistPassive.ccBreakTypes || ['root', 'grapple', 'grab'];
      var eaMaxDur = escArtistPassive.ccBreakMaxDuration || 1;
      for (var eaI = unit.statusEffects.length - 1; eaI >= 0; eaI--) {
        var eaSe = unit.statusEffects[eaI];
        if (eaSe.type !== 'debuff') continue;
        var eaName = eaSe.name || '';
        var eaMatches = false;
        for (var eaJ = 0; eaJ < eaCcTypes.length; eaJ++) {
          if (eaName.indexOf(eaCcTypes[eaJ]) !== -1) { eaMatches = true; break; }
        }
        // Also match 'rooted', 'slowed' (partial match on 'root')
        if (!eaMatches && (eaName === 'rooted' || eaName === 'grappled' || eaName === 'submission_hold')) {
          eaMatches = true;
        }
        if (eaMatches && eaSe.duration > eaMaxDur) {
          eaSe.duration = eaMaxDur; // Reduce remaining duration to 1 turn
          if (combat.callbacks.broadcastToFloor) {
            combat.callbacks.broadcastToFloor('tc_combat_passive_cc_break', {
              combatId: combat.id, unitId: unitId,
              effect: eaName, newDuration: eaMaxDur,
              passive: 'escape_artist',
            });
          }
        }
      }
    }

    // --- Lily of the Field Passive: +1 lily token per turn. At 3, next heal +50% ---
    var lilyPassive = getUnitCombatPassive(unit, 'lily_of_the_field');
    if (lilyPassive) {
      var currentLilies = (_lilyTokens.get(unitId) || 0) + 1;
      _lilyTokens.set(unitId, currentLilies);
    }

    // --- Dance Partner: auto-bond with nearest ally if not already bonded ---
    var dpPassive = getUnitCombatPassive(unit, 'dance_partner');
    if (dpPassive && !_dancePartners.has(unitId)) {
      var dpBestAlly = null;
      var dpBestDist = 999;
      var dpAutoIter = combat.units.values();
      var dpAutoEntry = dpAutoIter.next();
      while (!dpAutoEntry.done) {
        var dpAutoAlly = dpAutoEntry.value;
        dpAutoEntry = dpAutoIter.next();
        if (dpAutoAlly.id === unitId || dpAutoAlly.type !== unit.type || !dpAutoAlly.alive) continue;
        var dpDist = manhattanDist(unit.x, unit.y, dpAutoAlly.x, dpAutoAlly.y);
        if (dpDist < dpBestDist) {
          dpBestDist = dpDist;
          dpBestAlly = dpAutoAlly;
        }
      }
      if (dpBestAlly) {
        _dancePartners.set(unitId, dpBestAlly.id);
      }
    }

    // --- Innervate: grant mana per turn to target ---
    var innervateData = _innervates.get(unitId);
    if (innervateData && innervateData.turnsLeft > 0) {
      if (unit.combat && unit.combat.mana !== undefined) {
        var innMaxMana = unit.combat.maxMana || 50;
        unit.combat.mana = Math.min(innMaxMana, unit.combat.mana + (innervateData.manaPerTurn || 5));
      }
      innervateData.turnsLeft--;
      if (innervateData.turnsLeft <= 0) {
        _innervates.delete(unitId);
      }
    }

    // --- Soulstone: decrement turns left ---
    var ssData = _soulstones.get(unitId);
    if (ssData) {
      ssData.turnsLeft--;
      if (ssData.turnsLeft <= 0) {
        _soulstones.delete(unitId);
      }
    }

    // --- Divine Invulnerability: decrement turns ---
    var divInvTurns = _divineInvulnerability.get(unitId);
    if (divInvTurns && divInvTurns > 0) {
      _divineInvulnerability.set(unitId, divInvTurns - 1);
      if (divInvTurns - 1 <= 0) {
        _divineInvulnerability.delete(unitId);
      }
    }

    // --- Fade: decrement turns ---
    var fadeTurns = _fadeActive.get(unitId);
    if (fadeTurns && fadeTurns > 0) {
      _fadeActive.set(unitId, fadeTurns - 1);
      if (fadeTurns - 1 <= 0) {
        _fadeActive.delete(unitId);
      }
    }

    // --- Intercept: decrement turns ---
    var intData = _intercepts.get(unitId);
    if (intData && intData.turnsLeft > 0) {
      intData.turnsLeft--;
      if (intData.turnsLeft <= 0) {
        _intercepts.delete(unitId);
      }
    }

    // --- Ebon Might Passive: 10% of your highest stat added to 3 nearby allies ---
    var ebonMightPassive = getUnitCombatPassive(unit, 'ebon_might');
    if (ebonMightPassive && unit.combat) {
      var ebStats = unit.combat;
      var highestStat = Math.max(ebStats.might || 5, ebStats.finesse || 5, ebStats.acumen || 5, (ebStats.resolve || 5));
      var ebBonus = Math.max(1, Math.floor(highestStat * (ebonMightPassive.value || 0.10)));
      var ebRange = ebonMightPassive.range || 3;
      var ebAllies = getUnitsInRadius(combat, unit.x, unit.y, ebRange);
      var ebCount = 0;
      for (var ebi = 0; ebi < ebAllies.length && ebCount < 3; ebi++) {
        var ebAlly = ebAllies[ebi];
        if (ebAlly.id === unitId || ebAlly.type !== unit.type || !ebAlly.alive) continue;
        if (!ebAlly.statusEffects) ebAlly.statusEffects = [];
        // Remove old ebon might buff before applying new one (prevent stacking)
        for (var ebRm = ebAlly.statusEffects.length - 1; ebRm >= 0; ebRm--) {
          if (ebAlly.statusEffects[ebRm].name === 'ebon_might' && ebAlly.statusEffects[ebRm].sourceId === unitId) {
            ebAlly.statusEffects.splice(ebRm, 1);
          }
        }
        ebAlly.statusEffects.push({
          name: 'ebon_might',
          type: 'buff',
          duration: 2,
          damageBoost: ebBonus,
          armorBoost: ebBonus,
          sourceId: unitId,
        });
        ebCount++;
      }
    }

    // --- Intervene Passive: auto-intercept hits on nearby allies below 30% HP ---
    var intervenePassive = getUnitCombatPassive(unit, 'intervene');
    if (intervenePassive) {
      var ivRange = intervenePassive.range || 2;
      var ivAllies = getUnitsInRadius(combat, unit.x, unit.y, ivRange);
      for (var ivI = 0; ivI < ivAllies.length; ivI++) {
        var ivAlly = ivAllies[ivI];
        if (ivAlly.id === unitId || ivAlly.type !== unit.type || !ivAlly.alive) continue;
        if (ivAlly.hp / (ivAlly.maxHp || 1) < 0.30 && !_intercepts.has(ivAlly.id)) {
          _intercepts.set(ivAlly.id, {
            protectorId: unitId,
            turnsLeft: 1,
            combat: combat,
          });
          break; // Only auto-intercept one ally per turn
        }
      }
    }

    // --- Ground Zones / Totems: tick persistent ground effects ---
    if (combat.groundZones) {
      for (var gzI = combat.groundZones.length - 1; gzI >= 0; gzI--) {
        var gz = combat.groundZones[gzI];
        gz.turnsLeft--;
        if (gz.turnsLeft <= 0) {
          combat.groundZones.splice(gzI, 1);
          continue;
        }
        // Apply zone effect to units on the tile
        var gzUnitsInZone = getUnitsInRadius(combat, gz.x, gz.y, gz.radius || 1);
        for (var gzU = 0; gzU < gzUnitsInZone.length; gzU++) {
          var gzUnit = gzUnitsInZone[gzU];
          if (!gzUnit.alive) continue;
          if (gz.type === 'healing_totem' && gzUnit.type === gz.ownerType) {
            var gzHealAmt = gz.healPerTurn || 5;
            gzUnit.hp = Math.min(gzUnit.maxHp, gzUnit.hp + gzHealAmt);
          } else if (gz.type === 'fire_totem' && gzUnit.type !== gz.ownerType) {
            var gzFireDmg = gz.damagePerTurn || 8;
            gzUnit.hp -= gzFireDmg;
            if (gzUnit.hp <= 0) {
              gzUnit.hp = 0;
              gzUnit.alive = false;
              handleUnitDeath(combat, gzUnit.id, gz.sourceId);
              if (gzUnit.alive && combat.callbacks.broadcastToFloor) {
                combat.callbacks.broadcastToFloor('tc_combat_revive', {
                  combatId: combat.id, unitId: gzUnit.id, unitName: gzUnit.name,
                  unitType: gzUnit.type, revivedHp: gzUnit.hp, maxHp: gzUnit.maxHp,
                  passive: 'fire_totem',
                });
              }
            }
          } else if (gz.type === 'earthen_ward_totem' && gzUnit.type === gz.ownerType) {
            if (!gzUnit.statusEffects) gzUnit.statusEffects = [];
            // Only apply if not already present
            var hasEW = false;
            for (var ewI = 0; ewI < gzUnit.statusEffects.length; ewI++) {
              if (gzUnit.statusEffects[ewI].name === 'earthen_ward') { hasEW = true; break; }
            }
            if (!hasEW) {
              gzUnit.statusEffects.push({ name: 'earthen_ward', type: 'buff', duration: 2, damageReduction: gz.drPercent || 5, sourceId: gz.sourceId });
            }
          } else if (gz.type === 'salted_earth' && gzUnit.type !== gz.ownerType) {
            var gzShadowDmg = gz.damagePerTurn || 6;
            gzUnit.hp -= gzShadowDmg;
            if (gzUnit.hp <= 0) {
              gzUnit.hp = 0;
              gzUnit.alive = false;
              handleUnitDeath(combat, gzUnit.id, gz.sourceId);
              if (gzUnit.alive && combat.callbacks.broadcastToFloor) {
                combat.callbacks.broadcastToFloor('tc_combat_revive', {
                  combatId: combat.id, unitId: gzUnit.id, unitName: gzUnit.name,
                  unitType: gzUnit.type, revivedHp: gzUnit.hp, maxHp: gzUnit.maxHp,
                  passive: 'salted_earth',
                });
              }
            }
          }
        }
      }
    }

    // Mark as pending
    combat.pendingActions.set(unitId, false);

    // Auto-defend for disconnected players
    if (unit.autoDefend) {
      combat.pendingActions.set(unitId, true);
      endUnitTurn(combat, unitId, 'waited');
      continue;
    }

    // Calculate valid move range
    var moveRange = calculateMoveRange(combat, unitId);

    // Calculate valid attack targets
    var attackTargets = getValidAttackTargets(combat, unitId);

    // Emit turn data to the player
    if (combat.callbacks.emitToPlayer && unit.socketId) {
      combat.callbacks.emitToPlayer(unit.socketId, 'tc_combat_turn', {
        combatId: combat.id,
        unitId: unitId,
        turnNumber: combat.turnNumber,
        timer: turnTimerSec,
        moveRange: moveRange,
        attackTargets: attackTargets,
        mp: unit.mp,
        ap: unit.ap,
        rp: unit.rp,
        hp: unit.hp,
        maxHp: unit.maxHp,
        momentumShield: unit.momentumShield,
        mana: (unit.combat && unit.combat.mana) || 0,
        maxMana: (unit.combat && unit.combat.maxMana) || 50,
        stamina: (unit.combat && unit.combat.stamina) || 0,
        maxStamina: (unit.combat && unit.combat.maxStamina) || 50,
        bloodlust: (unit.combat && unit.combat.bloodlust) || 0,
        maxBloodlust: (unit.combat && unit.combat.maxBloodlust) || 50,
        focus: (unit.combat && unit.combat.focus) || 0,
        maxFocus: (unit.combat && unit.combat.maxFocus) || 50,
        primaryResource: (unit.combat && unit.combat.primaryResource) || 'mana',
        initiative: initiative,
        exhaustionWarning: combat.turnNumber >= ((combat._isLeviathanCombat || combat._hasBoss) ? EXHAUSTION_START_BOSS : EXHAUSTION_START) - 2,
        exhaustionDamage: combat.exhaustionDamage,
      });
    }
  }

  // Start turn timer
  if (combat.turnTimer) {
    clearTimeout(combat.turnTimer);
    combat.turnTimer = null;
  }

  combat.turnTimer = setTimeout(function() {
    handleTurnTimeout(combat);
  }, turnTimerMs);

  // Auto-submit actions for NPC units (raid companions)
  if (combat.isLichRaid) {
    processNPCActions(combat);
  }
}

module.exports = {
  init: init,
  startPlayerTurn: startPlayerTurn,
};
