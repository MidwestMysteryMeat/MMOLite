// combat-basic-attack.js
// Basic attack execution with passive/affix processing.
// Extracted from dungeon-combat.js — re-exported for backward compatibility.

'use strict';

var combatGrid = require('./combat-grid');
var chebyshevDist = combatGrid.chebyshevDist;
var isWalkableCombat = combatGrid.isWalkableCombat;

var combatDamage = require('./combat-damage');
var calculateDamage = combatDamage.calculateDamage;

var combatPassives = require('./combat-passive-helpers');
var getUnitCombatPassive = combatPassives.getUnitCombatPassive;
var getUnitCombatPassiveTotal = combatPassives.getUnitCombatPassiveTotal;
var hasImmunity = combatPassives.hasImmunity;
var hasCCImmunity = combatPassives.hasCCImmunity;
var getCardEffectTotal = combatPassives.getCardEffectTotal;
var getUnitOnHitAffixes = combatPassives.getUnitOnHitAffixes;

var combatTiles = require('./combat-tiles');

var _maps = require('./combat-state-maps');
var _hotStreakCounts = _maps.hotStreakCounts;
var _divineInvulnerability = _maps.divineInvulnerability;
var _intercepts = _maps.intercepts;

var handleUnitDeath, updateThreat, getUnitsInRadius, getUnitAtPosition;
var BLOODLUST_ON_HIT, BLOODLUST_ON_TAKE_DAMAGE;
var FOCUS_BASIC_ATTACK_GAIN, FOCUS_BASE_RETAIN;

function init(deps) {
  handleUnitDeath = deps.handleUnitDeath;
  updateThreat = deps.updateThreat;
  getUnitsInRadius = deps.getUnitsInRadius;
  getUnitAtPosition = deps.getUnitAtPosition;
  BLOODLUST_ON_HIT = deps.BLOODLUST_ON_HIT;
  BLOODLUST_ON_TAKE_DAMAGE = deps.BLOODLUST_ON_TAKE_DAMAGE;
  FOCUS_BASIC_ATTACK_GAIN = deps.FOCUS_BASIC_ATTACK_GAIN;
  FOCUS_BASE_RETAIN = deps.FOCUS_BASE_RETAIN;
}

function executeBasicAttack(combat, attackerId, targetId) {
  var attacker = combat.units.get(attackerId);
  var target = combat.units.get(targetId);

  if (!attacker || !attacker.alive) {
    return { success: false, reason: 'Attacker is dead or missing' };
  }
  if (!target || !target.alive) {
    return { success: false, reason: 'Target is dead or missing' };
  }
  if (attacker.ap <= 0) {
    return { success: false, reason: 'No action points remaining' };
  }
  if (attacker.id === targetId) {
    return { success: false, reason: 'Cannot attack self' };
  }

  // --- Animal Form: Turtle cannot attack ---
  if (attacker.activeAnimalForm === 'turtle') {
    return { success: false, reason: 'Cannot attack while in Turtle Form (defensive only)' };
  }

  // --- Grappler: selfCantAttack — cannot basic attack while in submission hold ---
  if (attacker.statusEffects) {
    for (var scaI = 0; scaI < attacker.statusEffects.length; scaI++) {
      if (attacker.statusEffects[scaI].name === 'self_immobilized' && attacker.statusEffects[scaI].cantAct) {
        return { success: false, reason: 'Cannot attack while maintaining a hold' };
      }
    }
  }

  // Range check
  var dist = chebyshevDist(attacker.x, attacker.y, target.x, target.y);
  var attackRange = 1; // Default melee (adjacent including diagonals)

  // Check for ranged weapon
  if (attacker.type === 'player' && attacker.combat && attacker.combat.weaponRange) {
    attackRange = Math.max(1, Math.floor(attacker.combat.weaponRange));
  } else if (attacker.type === 'enemy' && attacker.combat && attacker.combat.range) {
    attackRange = attacker.combat.range;
  }

  if (dist > attackRange) {
    return { success: false, reason: 'Target out of range (distance: ' + dist + ', range: ' + attackRange + ')' };
  }

  // --- Hound Form: Guard intercept -- 20% chance to redirect attack to hound ---
  if (attacker.type === 'enemy' && target.type === 'player') {
    var guardAllies = getUnitsInRadius(combat, target.x, target.y, 3);
    for (var gai = 0; gai < guardAllies.length; gai++) {
      var gAlly = guardAllies[gai];
      if (gAlly.id === target.id || gAlly.type !== target.type || !gAlly.alive) continue;
      if (gAlly.activeAnimalForm === 'hound' && gAlly.statusEffects) {
        for (var gsi = 0; gsi < gAlly.statusEffects.length; gsi++) {
          if (gAlly.statusEffects[gsi].animalForm === 'hound' && gAlly.statusEffects[gsi].guardIntercept) {
            if (Math.random() < gAlly.statusEffects[gsi].guardIntercept) {
              // Redirect the attack to the hound
              target = gAlly;
              targetId = gAlly.id;
              dist = chebyshevDist(attacker.x, attacker.y, target.x, target.y);
            }
            break;
          }
        }
      }
      if (target.id !== targetId) break; // Already intercepted
    }
  }

  // Calculate damage (includes dodge, block, crit, stealth attack bonuses)
  var dmgResult = calculateDamage(attacker, target, combat);

  // --- 3H: Dodge/Evasion — attack misses entirely ---
  if (dmgResult.dodged) {
    // Deduct AP even on a dodge (the attack was attempted)
    attacker.ap--;
    return {
      success: true,
      attackerId: attackerId,
      targetId: targetId,
      damage: 0,
      actualDamage: 0,
      isCrit: false,
      dodged: true,
      blocked: false,
      shieldAbsorbed: 0,
      targetDied: false,
      targetHp: target.hp,
      targetMaxHp: target.maxHp,
      attackerAp: attacker.ap,
      weaponEffects: [],
      lifestealHeal: 0,
      reflectDamage: 0,
      manaShieldAbsorbed: 0,
    };
  }

  var damage = dmgResult.finalDamage;
  var isCrit = dmgResult.isCrit;
  var blocked = dmgResult.blocked || false;
  var shieldAbsorbed = 0;
  var manaShieldAbsorbed = 0;

  // Momentum shield absorbs damage
  if (target.momentumShield > 0) {
    shieldAbsorbed = Math.min(target.momentumShield, damage);
    target.momentumShield -= shieldAbsorbed;
    damage -= shieldAbsorbed;
  }

  // --- 3G: Mana Shield — absorb damage from mana before HP ---
  var manaShieldPassive = getUnitCombatPassive(target, 'mana_shield');
  if (!manaShieldPassive) {
    // Also check card effects for mana_shield type
    var manaShieldVal = getCardEffectTotal(target, 'mana_shield');
    if (manaShieldVal > 0) {
      manaShieldPassive = { type: 'mana_shield', ratio: manaShieldVal };
    }
  }
  if (manaShieldPassive && damage > 0 && target.combat && target.combat.mana > 0) {
    // Absorb up to (ratio * damage) from mana. Default ratio: 0.50 (50% of damage to mana)
    var msRatio = manaShieldPassive.ratio || manaShieldPassive.value || 0.50;
    var manaAbsorbDamage = Math.floor(damage * msRatio);
    // Each point of damage absorbed costs 2 mana
    var manaNeeded = manaAbsorbDamage * 2;
    var manaAvailable = target.combat.mana;
    if (manaNeeded > manaAvailable) {
      manaAbsorbDamage = Math.floor(manaAvailable / 2);
      manaNeeded = manaAbsorbDamage * 2;
    }
    if (manaAbsorbDamage > 0) {
      target.combat.mana -= manaNeeded;
      damage -= manaAbsorbDamage;
      manaShieldAbsorbed = manaAbsorbDamage;
    }
  }

  // --- Support Passive: Last Stand — +30% DR below 20% HP ---
  var lastStandPassive = getUnitCombatPassive(target, 'last_stand');
  if (lastStandPassive && target.hp / (target.maxHp || 1) < (lastStandPassive.hpThreshold || 0.20)) {
    damage = Math.max(1, Math.floor(damage * (1 - (lastStandPassive.damageReduction || 0.30))));
  }

  // --- Support Passive: Fortress — +15% armor when stationary ---
  var fortressPassive = getUnitCombatPassive(target, 'fortress');
  if (fortressPassive && !target._movedThisTurn) {
    var fortressReduction = fortressPassive.armorBonus || 0.15;
    damage = Math.max(1, Math.floor(damage * (1 - fortressReduction)));
  }

  // --- Support Passive: Ironclad — CC reduction (applied when status effects land) ---
  // (Handled in status effect application sections)

  // --- Ironskin Passive: +15% DR when stationary (distinct from fortress) ---
  var ironskinPassive = getUnitCombatPassive(target, 'ironskin');
  if (ironskinPassive && !target._movedThisTurn) {
    var ironskinReduction = ironskinPassive.value || 0.15;
    damage = Math.max(1, Math.floor(damage * (1 - ironskinReduction)));
  }

  // --- Divine Invulnerability: damage = 0 while active ---
  var divInvulnTurns = _divineInvulnerability.get(target.id);
  if (divInvulnTurns && divInvulnTurns > 0) {
    damage = 0;
  }

  // --- Intercept: redirect damage to protector ---
  var interceptData = _intercepts.get(target.id);
  if (interceptData && interceptData.turnsLeft > 0 && damage > 0) {
    var protector = null;
    if (interceptData.combat) {
      protector = interceptData.combat.units.get(interceptData.protectorId);
    }
    if (protector && protector.alive) {
      protector.hp -= damage;
      if (protector.hp <= 0) {
        protector.hp = 0;
        protector.alive = false;
        if (handleUnitDeath) {
          handleUnitDeath(interceptData.combat, interceptData.protectorId, attackerId);
        }
      }
      // Zero out damage to original target
      damage = 0;
    }
  }

  // --- Stagger Passive: 40% of incoming damage becomes a 5-turn DoT instead ---
  var staggerPassive = getUnitCombatPassive(target, 'stagger');
  if (staggerPassive && damage > 0) {
    var staggerPercent = staggerPassive.value || 0.40;
    var staggerTurns = staggerPassive.duration || 5;
    var staggeredDamage = Math.floor(damage * staggerPercent);
    if (staggeredDamage > 0) {
      damage -= staggeredDamage;
      damage = Math.max(0, damage);
      var staggerTickDmg = Math.max(1, Math.ceil(staggeredDamage / staggerTurns));
      // Add or refresh the stagger DoT as a status effect
      if (!target.statusEffects) target.statusEffects = [];
      target.statusEffects.push({
        name: 'stagger_dot',
        type: 'debuff',
        duration: staggerTurns,
        tickDamage: staggerTickDmg,
        sourceId: attacker.id,
      });
    }
  }

  // --- Support Passive: Battle Commander — nearby ally damage bonus for attacker ---
  // Check if any ally of the attacker has battle_commander
  if (attacker.type === 'player') {
    var bcBonusTotal = 0;
    var bcIter = combat.units.values();
    var bcEntry = bcIter.next();
    while (!bcEntry.done) {
      var bcUnit = bcEntry.value;
      bcEntry = bcIter.next();
      if (bcUnit.id !== attackerId && bcUnit.type === attacker.type && bcUnit.alive) {
        var bcPassive = getUnitCombatPassive(bcUnit, 'battle_commander');
        if (bcPassive) {
          var bcDist = chebyshevDist(attacker.x, attacker.y, bcUnit.x, bcUnit.y);
          if (bcDist <= (bcPassive.range || 3)) {
            bcBonusTotal += (bcPassive.damageBonus || 0.05);
          }
        }
      }
    }
    if (bcBonusTotal > 0) {
      damage = Math.floor(damage * (1 + bcBonusTotal));
    }
  }

  // --- Support Passive: Weakening Aura — enemies near target deal less damage ---
  // Check if any ally of the target has weakening_aura near the attacker
  if (target.type === 'player') {
    var waReductionTotal = 0;
    var waIter = combat.units.values();
    var waEntry = waIter.next();
    while (!waEntry.done) {
      var waUnit = waEntry.value;
      waEntry = waIter.next();
      if (waUnit.type === target.type && waUnit.alive) {
        var waPassive = getUnitCombatPassive(waUnit, 'weakening_aura');
        if (waPassive) {
          var waDist = chebyshevDist(attacker.x, attacker.y, waUnit.x, waUnit.y);
          if (waDist <= (waPassive.range || 1)) {
            waReductionTotal += (waPassive.damageReduction || 0.05);
          }
        }
      }
    }
    if (waReductionTotal > 0) {
      damage = Math.max(1, Math.floor(damage * (1 - waReductionTotal)));
    }
  }

  // --- Support Passive: Curse Amplifier — enemies with attacker's debuffs take more damage ---
  if (target.statusEffects && target.statusEffects.length > 0) {
    var caPassive = getUnitCombatPassive(attacker, 'curse_amplifier');
    if (caPassive) {
      var hasAttackerDebuff = false;
      for (var cadi = 0; cadi < target.statusEffects.length; cadi++) {
        if (target.statusEffects[cadi].type === 'debuff' && target.statusEffects[cadi].sourceId === attackerId) {
          hasAttackerDebuff = true;
          break;
        }
      }
      if (hasAttackerDebuff) {
        damage = Math.floor(damage * (1 + (caPassive.damageAmplify || 0.10)));
      }
    }

    // --- Vulnerability Exposed debuff — target takes % more damage after CC expires ---
    for (var vedi = 0; vedi < target.statusEffects.length; vedi++) {
      if (target.statusEffects[vedi].name === 'vulnerability_exposed' && target.statusEffects[vedi].damageAmplify) {
        damage = Math.floor(damage * (1 + target.statusEffects[vedi].damageAmplify));
        break; // Only apply once
      }
    }
  }

  // Apply damage
  var damageToHp = damage;

  // --- Support Passive: Spirit Link Party — redirect % of ally damage to self ---
  // Check if any ally of the target has spirit_link_party
  var spiritLinkRedirected = 0;
  if (target.type === 'player' && damageToHp > 0) {
    var slIter = combat.units.values();
    var slEntry = slIter.next();
    while (!slEntry.done) {
      var slUnit = slEntry.value;
      slEntry = slIter.next();
      if (slUnit.id !== target.id && slUnit.type === target.type && slUnit.alive) {
        var slPassive = getUnitCombatPassive(slUnit, 'spirit_link_party');
        if (slPassive) {
          var slDist = chebyshevDist(target.x, target.y, slUnit.x, slUnit.y);
          if (slDist <= (slPassive.range || 2)) {
            var redirectAmt = Math.max(1, Math.floor(damageToHp * (slPassive.redirectPercent || 0.15)));
            // Cap redirect so it does not kill the linker
            redirectAmt = Math.min(redirectAmt, slUnit.hp - 1);
            if (redirectAmt > 0) {
              damageToHp -= redirectAmt;
              spiritLinkRedirected += redirectAmt;
              slUnit.hp -= redirectAmt;
              if (slUnit.hp <= 0) {
                slUnit.hp = 1; // Spirit link cannot kill the linker
              }
              if (combat.callbacks.broadcastToFloor) {
                combat.callbacks.broadcastToFloor('tc_combat_passive_damage', {
                  combatId: combat.id,
                  sourceId: target.id,
                  targetId: slUnit.id,
                  damage: redirectAmt,
                  targetHp: Math.max(0, slUnit.hp),
                  targetMaxHp: slUnit.maxHp,
                  passive: 'spirit_link_party',
                });
              }
            }
          }
        }
      }
    }
  }

  if (damageToHp > 0) {
    target.hp -= damageToHp;

    // Lich raid: update threat table when player damages enemy
    if (combat.isLichRaid && combat.threatTable && attacker.type === 'player') {
      updateThreat(combat, attacker.id, damageToHp, 'damage');
    }
    // Lich raid: phylactery immunity — boss takes no damage in phase 2
    if (combat.isLichRaid && target.isBoss && target._isPhylacteryImmune) {
      target.hp += damageToHp; // undo damage
    }
  }

  // Grant bloodlust on hit
  if (damageToHp > 0 && attacker.combat && attacker.combat.bloodlust !== undefined) {
    var blOnHit = BLOODLUST_ON_HIT;
    // Check for on_hit_bonus passive cards
    if (attacker.equippedCards) {
      for (var bhi = 0; bhi < attacker.equippedCards.length; bhi++) {
        var bhCard = attacker.equippedCards[bhi];
        if (bhCard && bhCard.effects) {
          for (var bhei = 0; bhei < bhCard.effects.length; bhei++) {
            if (bhCard.effects[bhei].type === 'resource_on_hit_bonus' && bhCard.effects[bhei].resource === 'bloodlust') {
              blOnHit += bhCard.effects[bhei].value;
            }
          }
        }
      }
    }
    var maxBL = attacker.combat.maxBloodlust || 50;
    attacker.combat.bloodlust = Math.min(maxBL, (attacker.combat.bloodlust || 0) + blOnHit);
    attacker._lastActionTurn = combat.turnNumber; // Track last action for decay delay
  }

  // Grant bloodlust when taking damage
  if (damageToHp > 0 && target.combat && target.combat.bloodlust !== undefined && target.alive) {
    var blOnDmg = BLOODLUST_ON_TAKE_DAMAGE;
    var maxBLT = target.combat.maxBloodlust || 50;
    target.combat.bloodlust = Math.min(maxBLT, (target.combat.bloodlust || 0) + blOnDmg);
    target._lastActionTurn = combat.turnNumber;
  }

  // Check weapon modifier effects (equipment_modifier cards)
  // --- 3B: Iron Will debuff resistance — check before applying on-hit status effects ---
  var weaponEffects = [];
  if (attacker.equippedCards) {
    for (var wei = 0; wei < attacker.equippedCards.length; wei++) {
      var wCard = attacker.equippedCards[wei];
      if (!wCard || !wCard.combatWeapon) continue;
      var cw = wCard.combatWeapon;

      // Bonus damage already applied via combat stats, but check on-hit effects
      if (cw.onHitStatusChance && cw.onHitStatus && Math.random() < cw.onHitStatusChance) {
        if (target.alive || target.hp > 0) {
          // Iron Will: target has a chance to resist debuffs
          var debuffResisted = false;
          if (cw.onHitStatus.type === 'debuff') {
            var ironWillChance = getUnitCombatPassiveTotal(target, 'debuff_resist');
            if (ironWillChance > 0 && Math.random() < ironWillChance) {
              debuffResisted = true;
              weaponEffects.push({ type: 'debuff_resisted', status: cw.onHitStatus.name || 'unknown', targetId: targetId });
            }
          }
          if (!debuffResisted) {
            // Poison immunity check
            if (cw.onHitStatus.name === 'poisoned' && hasImmunity(target, 'poison')) {
              weaponEffects.push({ type: 'immune', element: 'poison', targetId: targetId });
            } else {
              if (!target.statusEffects) target.statusEffects = [];
              var wStatus = {};
              var wsKeys = Object.keys(cw.onHitStatus);
              for (var wski = 0; wski < wsKeys.length; wski++) {
                wStatus[wsKeys[wski]] = cw.onHitStatus[wsKeys[wski]];
              }
              wStatus.sourceId = attackerId;
              target.statusEffects.push(wStatus);
              weaponEffects.push({ type: 'status_applied', status: wStatus.name, targetId: targetId });
            }
          }
        }
      }
      if (cw.onHitTileChance && cw.onHitTile && Math.random() < cw.onHitTileChance) {
        combatTiles.createTileEffect(combat, target.x, target.y, cw.onHitTile, attackerId);
        weaponEffects.push({ type: 'tile_created', tileType: cw.onHitTile, x: target.x, y: target.y });
      }
    }
  }

  // --- Support Passive: Enfeebling Strike — 10% chance to reduce target damage ---
  var enfeeblingPassive = getUnitCombatPassive(attacker, 'enfeebling_strike');
  if (enfeeblingPassive && damageToHp > 0 && target.hp > 0) {
    if (Math.random() < (enfeeblingPassive.chance || 0.10)) {
      if (!target.statusEffects) target.statusEffects = [];
      // Check iron will before applying
      var efDebuffResisted = false;
      var efResistChance = getUnitCombatPassiveTotal(target, 'debuff_resist');
      if (efResistChance > 0 && Math.random() < efResistChance) {
        efDebuffResisted = true;
        weaponEffects.push({ type: 'debuff_resisted', status: 'enfeebled', targetId: targetId });
      }
      if (!efDebuffResisted) {
        var ironcladPassive = getUnitCombatPassive(target, 'ironclad');
        var efDuration = enfeeblingPassive.duration || 2;
        if (ironcladPassive) {
          efDuration = Math.max(1, Math.round(efDuration * (1 - (ironcladPassive.ccReduction || 0.40))));
        }
        target.statusEffects.push({
          name: 'enfeebled',
          type: 'debuff',
          duration: efDuration,
          damageReduction: enfeeblingPassive.damageReduction || 0.15,
          sourceId: attackerId,
        });
        weaponEffects.push({ type: 'status_applied', status: 'enfeebled', targetId: targetId, passive: 'enfeebling_strike' });
      }
    }
  }

  // --- Support Passive: Aegis — blocking grants +5% damage bonus ---
  if (blocked) {
    var aegisPassive = getUnitCombatPassive(target, 'aegis');
    if (aegisPassive) {
      if (!target.statusEffects) target.statusEffects = [];
      target.statusEffects.push({
        name: 'aegis',
        type: 'buff',
        duration: aegisPassive.duration || 2,
        damageBoost: Math.ceil((aegisPassive.damageBonus || 0.05) * 100), // Store as flat bonus for simplicity
        sourceId: targetId,
      });
      weaponEffects.push({ type: 'status_applied', status: 'aegis', targetId: targetId, passive: 'aegis' });
    }

    // --- Support Passive: Rallying Defense — blocking grants nearby allies +armor ---
    var rallyingDefPassive = getUnitCombatPassive(target, 'rallying_defense');
    if (rallyingDefPassive) {
      var rdRange = rallyingDefPassive.range || 2;
      var rdDuration = rallyingDefPassive.duration || 2;
      var rdArmorVal = rallyingDefPassive.armorValue || 3;
      var rdAllies = getUnitsInRadius(combat, target.x, target.y, rdRange);
      for (var rdi = 0; rdi < rdAllies.length; rdi++) {
        var rdAlly = rdAllies[rdi];
        if (rdAlly.id === targetId || rdAlly.type !== target.type || !rdAlly.alive) continue;
        if (!rdAlly.statusEffects) rdAlly.statusEffects = [];
        rdAlly.statusEffects.push({
          name: 'rallying_defense',
          type: 'buff',
          duration: rdDuration,
          armorBoost: rdArmorVal,
          sourceId: targetId,
        });
      }
      if (combat.callbacks.broadcastToFloor) {
        combat.callbacks.broadcastToFloor('tc_combat_passive_buff', {
          combatId: combat.id,
          sourceId: targetId,
          passive: 'rallying_defense',
          buffName: 'rallying_defense',
          duration: rdDuration,
        });
      }
    }

    // --- Support Passive: Bulwark — shield effectiveness +25% (applied as extra block DR) ---
    var bulwarkPassive = getUnitCombatPassive(target, 'bulwark');
    if (bulwarkPassive) {
      // Bulwark reduces block damage by an additional 25% of the blocked amount
      var bulwarkBonus = Math.floor(damageToHp * (bulwarkPassive.shieldBonus || 0.25));
      if (bulwarkBonus > 0 && damageToHp > 0) {
        damageToHp = Math.max(0, damageToHp - bulwarkBonus);
        // Retroactively adjust target HP
        target.hp += bulwarkBonus;
        if (target.hp > target.maxHp) target.hp = target.maxHp;
      }
    }
  }

  // --- Support Passive: Lifeline — auto-heal allies below 25% HP ---
  // Check if any ally of the target has lifeline and the target dropped below threshold
  if (target.type === 'player' && target.hp > 0 && target.hp / (target.maxHp || 1) < 0.25) {
    var llIter = combat.units.values();
    var llEntry = llIter.next();
    while (!llEntry.done) {
      var llUnit = llEntry.value;
      llEntry = llIter.next();
      if (llUnit.type === target.type && llUnit.alive && llUnit.id !== target.id) {
        var llPassive = getUnitCombatPassive(llUnit, 'lifeline');
        if (llPassive && !llUnit._lifelineCooldown) {
          var llHealAmt = Math.max(1, Math.floor(target.maxHp * (llPassive.healPercent || 0.15)));
          var llOldHp = target.hp;
          target.hp = Math.min(target.maxHp, target.hp + llHealAmt);
          var llActual = target.hp - llOldHp;
          if (llActual > 0) {
            llUnit._lifelineCooldown = true;
            // Set cooldown to clear after a number of turns (approximate 60s as ~20 turns)
            llUnit._lifelineCooldownTurns = 20;
            if (combat.callbacks.broadcastToFloor) {
              combat.callbacks.broadcastToFloor('tc_combat_passive_heal', {
                combatId: combat.id,
                unitId: target.id,
                unitName: target.name,
                healAmount: llActual,
                unitHp: target.hp,
                unitMaxHp: target.maxHp,
                passive: 'lifeline',
                sourceId: llUnit.id,
              });
            }
          }
          break; // Only one lifeline triggers at a time
        }
      }
    }
  }

  // --- Animal Form on-hit effects ---
  if (attacker.activeAnimalForm && attacker.statusEffects && target.alive && target.hp > 0) {
    for (var afhi = 0; afhi < attacker.statusEffects.length; afhi++) {
      var afEffect = attacker.statusEffects[afhi];
      if (!afEffect.animalForm) continue;

      // Wolf/Cat form: bleed DoT on hit
      if (afEffect.bleedOnHit) {
        if (!target.statusEffects) target.statusEffects = [];
        target.statusEffects.push({
          name: afEffect.bleedOnHit.name || 'bleed',
          type: 'debuff',
          duration: afEffect.bleedOnHit.duration || 2,
          tickDamage: afEffect.bleedOnHit.tickDamage || 3,
          sourceId: attackerId,
        });
        weaponEffects.push({ type: 'status_applied', status: afEffect.bleedOnHit.name || 'bleed', targetId: targetId, source: 'animal_form' });
      }

      // Cat form: Pounce -- first attack stuns target
      if (afEffect.pounceStun && attacker._animalFormPounceReady) {
        if (!target.statusEffects) target.statusEffects = [];
        target.statusEffects.push({
          name: 'stunned', type: 'debuff',
          duration: afEffect.pounceStun, sourceId: attackerId,
        });
        attacker._animalFormPounceReady = false;
        weaponEffects.push({ type: 'status_applied', status: 'pounce_stun', targetId: targetId, source: 'animal_form' });
      }

      // Wolf form: Pack Hunter -- +10% damage per nearby ally (max +30%)
      if (afEffect.packHunterBonus) {
        var phAllies = getUnitsInRadius(combat, attacker.x, attacker.y, 3);
        var phCount = 0;
        for (var phi = 0; phi < phAllies.length; phi++) {
          if (phAllies[phi].id !== attackerId && phAllies[phi].type === attacker.type && phAllies[phi].alive) phCount++;
        }
        var phBonus = Math.min(afEffect.packHunterMax || 0.30, phCount * afEffect.packHunterBonus);
        if (phBonus > 0) {
          var phExtraDmg = Math.max(1, Math.floor(damageToHp * phBonus));
          target.hp -= phExtraDmg;
          weaponEffects.push({ type: 'pack_hunter_bonus', damage: phExtraDmg, targetId: targetId, allies: phCount });
        }
      }

      // Serpent form: constrict -- grapple target (immobile + DoT)
      if (afEffect.constrictDuration && !target._constricted) {
        if (!target.statusEffects) target.statusEffects = [];
        target.statusEffects.push({
          name: 'constricted', type: 'debuff',
          duration: afEffect.constrictDuration,
          tickDamage: afEffect.constrictDamage || 6,
          speedMult: 0, sourceId: attackerId,
        });
        target._constricted = true;
        weaponEffects.push({ type: 'status_applied', status: 'constricted', targetId: targetId, source: 'animal_form' });
      }

      break; // Only process first animal form effect
    }
  }

  // --- Animal Form: Bear Thick Hide -- reduce crit damage taken by 30% ---
  if (isCrit && target.activeAnimalForm === 'bear' && target.statusEffects) {
    for (var bhdi = 0; bhdi < target.statusEffects.length; bhdi++) {
      if (target.statusEffects[bhdi].animalForm === 'bear' && target.statusEffects[bhdi].critDamageReduction) {
        var bhReduction = target.statusEffects[bhdi].critDamageReduction;
        var bhReduceAmt = Math.floor(damageToHp * bhReduction);
        if (bhReduceAmt > 0 && target.hp > 0) {
          target.hp += bhReduceAmt;
          if (target.hp > target.maxHp) target.hp = target.maxHp;
          weaponEffects.push({ type: 'thick_hide', reduction: bhReduceAmt, targetId: targetId });
        }
        break;
      }
    }
  }

  // --- Animal Form: Turtle Shell DR ---
  if (target.activeAnimalForm === 'turtle' && target.statusEffects && damageToHp > 0) {
    for (var tsri = 0; tsri < target.statusEffects.length; tsri++) {
      if (target.statusEffects[tsri].animalForm === 'turtle' && target.statusEffects[tsri].shellDR) {
        var tsDR = target.statusEffects[tsri].shellDR;
        var tsReduce = Math.floor(damageToHp * tsDR);
        if (tsReduce > 0 && target.hp > 0) {
          target.hp += tsReduce;
          if (target.hp > target.maxHp) target.hp = target.maxHp;
          weaponEffects.push({ type: 'shell_dr', reduction: tsReduce, targetId: targetId });
        }
        break;
      }
    }
  }

  var targetDied = target.hp <= 0;
  if (targetDied) {
    // --- Support Passive: Undying Will --- survive killing blow once per floor ---
    var undyingWill = getUnitCombatPassive(target, 'undying_will');
    if (undyingWill && !target._undyingWillUsed) {
      target.hp = 1;
      target.alive = true;
      target._undyingWillUsed = true;
      if (combat.callbacks.broadcastToFloor) {
        combat.callbacks.broadcastToFloor('tc_combat_revive', {
          combatId: combat.id,
          unitId: targetId,
          unitName: target.name,
          unitType: target.type,
          revivedHp: 1,
          maxHp: target.maxHp,
          passive: 'undying_will',
        });
      }
      targetDied = false;
    } else {
      target.alive = false;
      target.hp = 0;
    }
  }

  // --- 3F: Lifesteal on basic attacks ---
  var lifestealHeal = 0;
  var lifestealPct = getUnitCombatPassiveTotal(attacker, 'lifesteal');
  if (lifestealPct > 0 && damageToHp > 0 && attacker.alive) {
    lifestealHeal = Math.max(1, Math.floor(damageToHp * lifestealPct));
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + lifestealHeal);
  }

  // --- 3A: Thorns / Damage Reflect ---
  // Thorns triggers whenever the target takes HP damage, regardless of whether they survived
  var reflectDamage = 0;
  if (damageToHp > 0) {
    var reflectPct = getUnitCombatPassiveTotal(target, 'damage_reflect');
    if (reflectPct > 0) {
      reflectDamage = Math.max(1, Math.floor(damageToHp * reflectPct));
      if (attacker.alive) {
        attacker.hp -= reflectDamage;
        if (attacker.hp <= 0) {
          attacker.hp = 0;
          attacker.alive = false;
          handleUnitDeath(combat, attackerId, targetId);
        }
        // Broadcast thorns damage
        if (combat.callbacks.broadcastToFloor) {
          combat.callbacks.broadcastToFloor('tc_combat_passive_damage', {
            combatId: combat.id,
            sourceId: targetId,
            targetId: attackerId,
            damage: reflectDamage,
            targetHp: Math.max(0, attacker.hp),
            targetMaxHp: attacker.maxHp,
            passive: 'damage_reflect',
          });
        }
      }
    }
  }

  // --- Thorns Aura Passive: melee attackers take 10% reflected damage ---
  if (damageToHp > 0 && attacker.alive) {
    var thornsAura = getUnitCombatPassive(target, 'thorns_aura');
    if (thornsAura) {
      // Only trigger on melee attacks (range <= 1)
      var atkRange = 1;
      if (attacker.type === 'player' && attacker.combat && attacker.combat.weaponRange) {
        atkRange = attacker.combat.weaponRange;
      } else if (attacker.type === 'enemy' && attacker.combat && attacker.combat.range) {
        atkRange = attacker.combat.range;
      }
      if (atkRange <= 1.5) {
        var thornsDmg = Math.max(1, Math.floor(damageToHp * (thornsAura.value || 0.10)));
        attacker.hp -= thornsDmg;
        if (attacker.hp <= 0) {
          attacker.hp = 0;
          attacker.alive = false;
          handleUnitDeath(combat, attackerId, targetId);
        }
        if (combat.callbacks.broadcastToFloor) {
          combat.callbacks.broadcastToFloor('tc_combat_passive_damage', {
            combatId: combat.id,
            sourceId: targetId,
            targetId: attackerId,
            damage: thornsDmg,
            targetHp: Math.max(0, attacker.hp),
            targetMaxHp: attacker.maxHp,
            passive: 'thorns_aura',
          });
        }
      }
    }
  }

  // --- Dragonfire Scale Passive: 20% chance to reflect ranged/projectile attacks ---
  if (damageToHp > 0 && attacker.alive) {
    var dragonfirePassive = getUnitCombatPassive(target, 'dragonfire_scale');
    if (dragonfirePassive) {
      var atkRangeDF = 1;
      if (attacker.type === 'player' && attacker.combat && attacker.combat.weaponRange) {
        atkRangeDF = attacker.combat.weaponRange;
      } else if (attacker.type === 'enemy' && attacker.combat && attacker.combat.range) {
        atkRangeDF = attacker.combat.range;
      }
      if (atkRangeDF > 1.5) {
        var reflectChance = dragonfirePassive.chance || 0.20;
        if (Math.random() < reflectChance) {
          var dfReflectDmg = damageToHp;
          attacker.hp -= dfReflectDmg;
          if (attacker.hp <= 0) {
            attacker.hp = 0;
            attacker.alive = false;
            handleUnitDeath(combat, attackerId, targetId);
          }
          if (combat.callbacks.broadcastToFloor) {
            combat.callbacks.broadcastToFloor('tc_combat_passive_damage', {
              combatId: combat.id,
              sourceId: targetId,
              targetId: attackerId,
              damage: dfReflectDmg,
              targetHp: Math.max(0, attacker.hp),
              targetMaxHp: attacker.maxHp,
              passive: 'dragonfire_scale',
            });
          }
        }
      }
    }
  }

  // --- Atonement Passive: when dealing damage, heal lowest-HP ally for 20% of damage dealt ---
  if (damageToHp > 0 && attacker.alive) {
    var atonementPassive = getUnitCombatPassive(attacker, 'atonement');
    if (atonementPassive) {
      var atonementHealPct = atonementPassive.value || 0.20;
      var atonementHealAmt = Math.max(1, Math.floor(damageToHp * atonementHealPct));
      // Find lowest-HP alive ally
      var lowestHpAlly = null;
      var lowestHpRatio = 1.1;
      var atonIter = combat.units.values();
      var atonEntry = atonIter.next();
      while (!atonEntry.done) {
        var atonAlly = atonEntry.value;
        atonEntry = atonIter.next();
        if (atonAlly.type === attacker.type && atonAlly.alive && atonAlly.hp < atonAlly.maxHp) {
          var atonRatio = atonAlly.hp / (atonAlly.maxHp || 1);
          if (atonRatio < lowestHpRatio) {
            lowestHpRatio = atonRatio;
            lowestHpAlly = atonAlly;
          }
        }
      }
      if (lowestHpAlly) {
        var atonOldHp = lowestHpAlly.hp;
        lowestHpAlly.hp = Math.min(lowestHpAlly.maxHp, lowestHpAlly.hp + atonementHealAmt);
        var atonActual = lowestHpAlly.hp - atonOldHp;
        if (atonActual > 0 && combat.callbacks.broadcastToFloor) {
          combat.callbacks.broadcastToFloor('tc_combat_passive_heal', {
            combatId: combat.id,
            unitId: lowestHpAlly.id,
            unitName: lowestHpAlly.name,
            healAmount: atonActual,
            unitHp: lowestHpAlly.hp,
            unitMaxHp: lowestHpAlly.maxHp,
            passive: 'atonement',
            sourceId: attackerId,
          });
        }
      }
    }
  }

  // --- Siphoning Strikes Passive: basic attacks restore 3% max HP ---
  if (damageToHp > 0 && attacker.alive) {
    var siphoningPassive = getUnitCombatPassive(attacker, 'siphoning_strikes');
    if (siphoningPassive) {
      var sipHealPct = siphoningPassive.value || 0.03;
      var sipHealAmt = Math.max(1, Math.floor(attacker.maxHp * sipHealPct));
      var sipOldHp = attacker.hp;
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + sipHealAmt);
      var sipActual = attacker.hp - sipOldHp;
      if (sipActual > 0 && combat.callbacks.broadcastToFloor) {
        combat.callbacks.broadcastToFloor('tc_combat_passive_heal', {
          combatId: combat.id,
          unitId: attackerId,
          unitName: attacker.name,
          healAmount: sipActual,
          unitHp: attacker.hp,
          unitMaxHp: attacker.maxHp,
          passive: 'siphoning_strikes',
        });
      }
    }
  }

  // --- Hot Streak Passive: track consecutive crits, after 2 grant hot_streak buff ---
  if (attacker.type === 'player') {
    var hotStreakPassive = getUnitCombatPassive(attacker, 'hot_streak');
    if (hotStreakPassive) {
      if (isCrit) {
        var hsCount = (_hotStreakCounts.get(attackerId) || 0) + 1;
        _hotStreakCounts.set(attackerId, hsCount);
        if (hsCount >= 2) {
          _hotStreakCounts.set(attackerId, 0);
          // Grant hot_streak buff: next ability free + 50% damage
          if (!attacker.statusEffects) attacker.statusEffects = [];
          attacker.statusEffects.push({
            name: 'hot_streak',
            type: 'buff',
            duration: 2,
            damageBoost: 50,
            freeAbility: true,
            sourceId: attackerId,
          });
          if (combat.callbacks.broadcastToFloor) {
            combat.callbacks.broadcastToFloor('tc_combat_passive_buff', {
              combatId: combat.id,
              sourceId: attackerId,
              passive: 'hot_streak',
              buffName: 'hot_streak',
              duration: 2,
            });
          }
        }
      } else {
        _hotStreakCounts.set(attackerId, 0);
      }
    }
  }

  // --- Polymorph: any damage breaks polymorph on the target ---
  if (damageToHp > 0 && target.statusEffects) {
    for (var polyI = target.statusEffects.length - 1; polyI >= 0; polyI--) {
      if (target.statusEffects[polyI].name === 'polymorphed') {
        target.statusEffects.splice(polyI, 1);
        break;
      }
    }
  }

  // --- Grappler: breaksOnDamageToSelf — if the target has a self_immobilized grapple
  // with breaksOnDamageToSelf, and the target IS the grappler taking damage,
  // break both the self-immobilize and the linked debuff on the grappled enemy ---
  if (damageToHp > 0 && target.statusEffects) {
    for (var bodsI = target.statusEffects.length - 1; bodsI >= 0; bodsI--) {
      var bodsSE = target.statusEffects[bodsI];
      if (bodsSE.name === 'self_immobilized' && bodsSE.breaksOnDamageToSelf) {
        // Remove the self-immobilize from the grappler (target)
        var bodsLinkedTargetId = bodsSE.linkedTargetId;
        var bodsLinkedDebuff = bodsSE.linkedDebuffName;
        target.statusEffects.splice(bodsI, 1);
        weaponEffects.push({ type: 'grapple_broken', unitId: targetId, reason: 'damage_to_self' });
        // Remove the linked debuff from the grappled enemy
        if (bodsLinkedTargetId && bodsLinkedDebuff) {
          var bodsLinkedUnit = combat.units.get(bodsLinkedTargetId);
          if (bodsLinkedUnit && bodsLinkedUnit.statusEffects) {
            for (var bodsLI = bodsLinkedUnit.statusEffects.length - 1; bodsLI >= 0; bodsLI--) {
              if (bodsLinkedUnit.statusEffects[bodsLI].name === bodsLinkedDebuff &&
                  bodsLinkedUnit.statusEffects[bodsLI].sourceId === targetId) {
                bodsLinkedUnit.statusEffects.splice(bodsLI, 1);
                weaponEffects.push({ type: 'grapple_broken', unitId: bodsLinkedTargetId, reason: 'grappler_took_damage' });
                break;
              }
            }
          }
        }
        break; // Only break one grapple per damage event
      }
    }
  }

  // --- Night Hunter: counterstrike_stance — auto-counter melee attacks ---
  if (damageToHp > 0 && target.alive && target.statusEffects && attacker.alive) {
    for (var csStI = 0; csStI < target.statusEffects.length; csStI++) {
      var csStSE = target.statusEffects[csStI];
      if (csStSE.counterAttackPercent && csStSE.counterOnMelee) {
        // Check if the attack was melee (range <= 1.5)
        var csAtkRange = 1;
        if (attacker.type === 'player' && attacker.combat && attacker.combat.weaponRange) {
          csAtkRange = attacker.combat.weaponRange;
        } else if (attacker.type === 'enemy' && attacker.combat && attacker.combat.range) {
          csAtkRange = attacker.combat.range;
        }
        if (csAtkRange <= 1.5) {
          var csCounterAtk = (target.combat && target.combat.might || 5) * 2 + ((target.combat && target.combat.weaponDamage) || 0);
          var csCounterDmg = Math.max(1, Math.floor(csCounterAtk * csStSE.counterAttackPercent));
          attacker.hp -= csCounterDmg;
          if (attacker.hp <= 0) { attacker.hp = 0; attacker.alive = false; handleUnitDeath(combat, attackerId, targetId); }
          if (combat.callbacks.broadcastToFloor) {
            combat.callbacks.broadcastToFloor('tc_combat_passive_damage', {
              combatId: combat.id, sourceId: targetId, targetId: attackerId,
              damage: csCounterDmg, targetHp: Math.max(0, attacker.hp), targetMaxHp: attacker.maxHp,
              passive: 'counterstrike_stance',
            });
          }
          weaponEffects.push({ type: 'counter_strike', damage: csCounterDmg, targetId: attackerId, source: 'counterstrike_stance' });
        }
        break;
      }
    }
  }

  // Card: counter_chance_bonus — counter damage from calculateDamage
  var counterDmg = dmgResult.counterDamage || 0;
  if (counterDmg > 0 && attacker.alive) {
    attacker.hp -= counterDmg;
    if (attacker.hp <= 0) {
      attacker.hp = 0;
      attacker.alive = false;
      handleUnitDeath(combat, attackerId, targetId);
    }
    if (combat.callbacks.broadcastToFloor) {
      combat.callbacks.broadcastToFloor('tc_combat_passive_damage', {
        combatId: combat.id,
        sourceId: targetId,
        targetId: attackerId,
        damage: counterDmg,
        targetHp: Math.max(0, attacker.hp),
        targetMaxHp: attacker.maxHp,
        passive: 'counter_attack',
      });
    }
  }

  // Deduct AP
  attacker.ap--;

  // --- Cat Form: Prowl on kill -- 50% chance to gain stealth after killing ---
  if (targetDied && attacker.activeAnimalForm === 'cat' && attacker.statusEffects) {
    for (var afpk = 0; afpk < attacker.statusEffects.length; afpk++) {
      if (attacker.statusEffects[afpk].animalForm === 'cat' && attacker.statusEffects[afpk].prowlOnKill) {
        if (Math.random() < attacker.statusEffects[afpk].prowlOnKill) {
          attacker.statusEffects.push({
            name: 'prowl_stealth', type: 'buff',
            duration: 2, stealthBonus: 1.0, sourceId: attackerId,
          });
          weaponEffects.push({ type: 'status_applied', status: 'prowl_stealth', targetId: attackerId, source: 'cat_form' });
        }
        break;
      }
    }
  }

  // --- Serpent Form: Shed Skin -- auto-cleanse debuffs once per form ---
  if (attacker.activeAnimalForm === 'serpent' && !attacker._animalFormShedSkinUsed && attacker.statusEffects) {
    var hasDebuffsForShed = false;
    for (var ssdi = 0; ssdi < attacker.statusEffects.length; ssdi++) {
      if (attacker.statusEffects[ssdi].type === 'debuff') { hasDebuffsForShed = true; break; }
    }
    if (hasDebuffsForShed) {
      var shedRemaining = [];
      for (var ssri = 0; ssri < attacker.statusEffects.length; ssri++) {
        if (attacker.statusEffects[ssri].type !== 'debuff') shedRemaining.push(attacker.statusEffects[ssri]);
      }
      attacker.statusEffects = shedRemaining;
      attacker._animalFormShedSkinUsed = true;
      weaponEffects.push({ type: 'shed_skin', unitId: attackerId, source: 'serpent_form' });
    }
  }

  // --- Passive: on_hit_poison — 15% chance to poison target on basic attack ---
  if (damageToHp > 0 && target.alive && target.hp > 0 && attacker.alive) {
    var ohPoisonPassive = getUnitCombatPassive(attacker, 'on_hit_poison');
    if (ohPoisonPassive && Math.random() < (ohPoisonPassive.chance || 0.15)) {
      // Check poison immunity
      if (hasImmunity(target, 'poison')) {
        weaponEffects.push({ type: 'immune', element: 'poison', targetId: targetId, passive: 'on_hit_poison' });
      } else {
        if (!target.statusEffects) target.statusEffects = [];
        target.statusEffects.push({
          name: 'poisoned',
          type: 'debuff',
          duration: ohPoisonPassive.duration || 3,
          tickDamage: ohPoisonPassive.tickDamage || 3,
          sourceId: attackerId,
        });
        weaponEffects.push({ type: 'status_applied', status: 'poisoned', targetId: targetId, passive: 'on_hit_poison' });
      }
    }
  }

  // --- Passive: on_hit_bleed — 10% chance to inflict bleed on basic attack ---
  if (damageToHp > 0 && target.alive && target.hp > 0 && attacker.alive) {
    var ohBleedPassive = getUnitCombatPassive(attacker, 'on_hit_bleed');
    if (ohBleedPassive && Math.random() < (ohBleedPassive.chance || 0.10)) {
      if (!target.statusEffects) target.statusEffects = [];
      target.statusEffects.push({
        name: 'bleeding',
        type: 'debuff',
        duration: ohBleedPassive.duration || 3,
        tickDamage: ohBleedPassive.tickDamage || 4,
        sourceId: attackerId,
      });
      weaponEffects.push({ type: 'status_applied', status: 'bleeding', targetId: targetId, passive: 'on_hit_bleed' });
    }
  }

  // --- Passive: proc_explosion — 15% chance to trigger secondary explosion on hit ---
  if (damageToHp > 0 && target.alive && target.hp > 0 && attacker.alive) {
    var procExplPassive = getUnitCombatPassive(attacker, 'proc_explosion');
    if (procExplPassive && Math.random() < (procExplPassive.chance || 0.15)) {
      var explDmg = procExplPassive.damage || 10;
      target.hp -= explDmg;
      var explTargetDied = target.hp <= 0;
      if (explTargetDied) { target.hp = 0; target.alive = false; handleUnitDeath(combat, targetId, attackerId); targetDied = true; }
      weaponEffects.push({
        type: 'proc_explosion',
        targetId: targetId,
        damage: explDmg,
        element: procExplPassive.element || 'fire',
        targetHp: Math.max(0, target.hp),
        targetDied: explTargetDied,
      });
    }
  }

  // --- AFFIX on_hit effects from equipped cards (card.affixes array, cat === 'on_hit') ---
  // These are separate from combatPassive-based on_hit_poison / on_hit_bleed above.
  // Affixes come from the AFFIX_POOL in rpg-data.js and are rolled onto cards via rollCardAffixes().
  if (damageToHp > 0 && target.alive && target.hp > 0 && attacker.alive) {
    var onHitAffixes = getUnitOnHitAffixes(attacker);
    for (var ohi = 0; ohi < onHitAffixes.length; ohi++) {
      var ohAff = onHitAffixes[ohi];
      if (!ohAff || !ohAff.effect) continue;
      var eff = ohAff.effect;
      var effType = eff.type;

      // --- on_hit_bleed: chance to apply bleeding DoT ---
      if (effType === 'on_hit_bleed' && Math.random() < (eff.chance || 0.25)) {
        if (!target.statusEffects) target.statusEffects = [];
        target.statusEffects.push({
          name: 'bleeding', type: 'debuff', duration: eff.duration || 2,
          tickDamage: eff.tickDamage || 4, sourceId: attackerId,
        });
        weaponEffects.push({ type: 'status_applied', status: 'bleeding', targetId: targetId, source: 'affix', affixId: ohAff.id });
      }
      // --- on_hit_burn: chance to apply burn DoT ---
      else if (effType === 'on_hit_burn' && Math.random() < (eff.chance || 0.25)) {
        if (!target.statusEffects) target.statusEffects = [];
        target.statusEffects.push({
          name: 'burned', type: 'debuff', duration: eff.duration || 2,
          tickDamage: eff.tickDamage || 5, sourceId: attackerId,
        });
        weaponEffects.push({ type: 'status_applied', status: 'burned', targetId: targetId, source: 'affix', affixId: ohAff.id });
      }
      // --- on_hit_slow: chance to apply slow debuff ---
      else if (effType === 'on_hit_slow' && Math.random() < (eff.chance || 0.25)) {
        if (!target.statusEffects) target.statusEffects = [];
        target.statusEffects.push({
          name: 'slowed', type: 'debuff', duration: eff.duration || 2,
          speedReduction: 0.5, sourceId: attackerId,
        });
        weaponEffects.push({ type: 'status_applied', status: 'slowed', targetId: targetId, source: 'affix', affixId: ohAff.id });
      }
      // --- on_hit_poison: chance to apply poison DoT (respects poison immunity) ---
      else if (effType === 'on_hit_poison' && Math.random() < (eff.chance || 0.20)) {
        if (hasImmunity(target, 'poison')) {
          weaponEffects.push({ type: 'immune', element: 'poison', targetId: targetId, source: 'affix', affixId: ohAff.id });
        } else {
          if (!target.statusEffects) target.statusEffects = [];
          target.statusEffects.push({
            name: 'poisoned', type: 'debuff', duration: eff.duration || 3,
            tickDamage: eff.tickDamage || 3, sourceId: attackerId,
          });
          weaponEffects.push({ type: 'status_applied', status: 'poisoned', targetId: targetId, source: 'affix', affixId: ohAff.id });
        }
      }
      // --- on_hit_stun: chance to stun (respects CC immunity) ---
      else if (effType === 'on_hit_stun' && Math.random() < (eff.chance || 0.15)) {
        if (!hasCCImmunity(target, 'stunned')) {
          if (!target.statusEffects) target.statusEffects = [];
          target.statusEffects.push({
            name: 'stunned', type: 'debuff', duration: eff.duration || 1,
            skipTurn: true, sourceId: attackerId,
          });
          weaponEffects.push({ type: 'status_applied', status: 'stunned', targetId: targetId, source: 'affix', affixId: ohAff.id });
        }
      }
      // --- lifesteal: heal attacker for percentage of damage dealt (capped at 8% per affix) ---
      else if (effType === 'lifesteal') {
        var lsVal = Math.min(eff.value || 0.06, 0.08);
        var lsAmt = Math.floor(damageToHp * lsVal);
        if (lsAmt > 0) {
          attacker.hp = Math.min(attacker.maxHp, attacker.hp + lsAmt);
          weaponEffects.push({ type: 'lifesteal', amount: lsAmt, attackerId: attackerId, source: 'affix', affixId: ohAff.id });
        }
      }
      // --- mana_drain_on_hit: steal mana from target and give to attacker ---
      else if (effType === 'mana_drain_on_hit') {
        var drainAmt = eff.value || 4;
        var tMana = (target.combat && target.combat.mana) || 0;
        var drained = Math.min(drainAmt, tMana);
        if (target.combat) target.combat.mana = Math.max(0, tMana - drained);
        if (attacker.combat) attacker.combat.mana = Math.min(attacker.combat.maxMana || 50, (attacker.combat.mana || 0) + drained);
        if (drained > 0) {
          weaponEffects.push({ type: 'mana_drain', amount: drained, targetId: targetId, source: 'affix', affixId: ohAff.id });
        }
      }
      // --- mark_on_hit: chance to mark target (increased damage taken) ---
      else if (effType === 'mark_on_hit' && Math.random() < (eff.chance || 0.20)) {
        if (!target.statusEffects) target.statusEffects = [];
        target.statusEffects.push({
          name: 'marked', type: 'debuff', duration: eff.duration || 2,
          damageTakenBonus: eff.damageTakenBonus || 0.10, sourceId: attackerId,
        });
        weaponEffects.push({ type: 'status_applied', status: 'marked', targetId: targetId, source: 'affix', affixId: ohAff.id });
      }
      // --- wound_on_hit: apply healing reduction debuff ---
      else if (effType === 'wound_on_hit') {
        if (!target.statusEffects) target.statusEffects = [];
        target.statusEffects.push({
          name: 'wounded', type: 'debuff', duration: eff.duration || 3,
          healingReduction: eff.healing_reduction || 0.30, sourceId: attackerId,
        });
        weaponEffects.push({ type: 'status_applied', status: 'wounded', targetId: targetId, source: 'affix', affixId: ohAff.id });
      }
      // --- knockback_on_hit: push target away from attacker by N tiles ---
      else if (effType === 'knockback_on_hit') {
        if (!hasCCImmunity(target, 'knockback')) {
          var kbTiles = eff.tiles || 1;
          var kdx = target.x - attacker.x;
          var kdy = target.y - attacker.y;
          // Normalize direction to -1/0/1
          var knx = kdx === 0 ? 0 : (kdx > 0 ? 1 : -1);
          var kny = kdy === 0 ? 0 : (kdy > 0 ? 1 : -1);
          // If target is on same tile as attacker (shouldn't happen), default push direction
          if (knx === 0 && kny === 0) knx = 1;
          var kbFloor = combat.floor;
          var kbFinalX = target.x;
          var kbFinalY = target.y;
          if (kbFloor && kbFloor.grid) {
            var kbGridW = kbFloor.width || kbFloor.grid[0].length;
            var kbGridH = kbFloor.height || kbFloor.grid.length;
            for (var kbStep = 0; kbStep < kbTiles; kbStep++) {
              var kbNextX = kbFinalX + knx;
              var kbNextY = kbFinalY + kny;
              if (isWalkableCombat(kbFloor.grid, kbNextX, kbNextY, kbGridW, kbGridH, combat.units) && !getUnitAtPosition(combat, kbNextX, kbNextY)) {
                kbFinalX = kbNextX;
                kbFinalY = kbNextY;
              } else {
                break;
              }
            }
          }
          if (kbFinalX !== target.x || kbFinalY !== target.y) {
            target.x = kbFinalX;
            target.y = kbFinalY;
            weaponEffects.push({ type: 'knockback', targetId: targetId, newX: kbFinalX, newY: kbFinalY, source: 'affix', affixId: ohAff.id });
          }
        }
      }
      // --- push_on_hit: push target away (larger displacement variant) ---
      else if (effType === 'push_on_hit') {
        if (!hasCCImmunity(target, 'knockback')) {
          var pushTiles = eff.tiles || 2;
          var pdx = target.x - attacker.x;
          var pdy = target.y - attacker.y;
          var pnx = pdx === 0 ? 0 : (pdx > 0 ? 1 : -1);
          var pny = pdy === 0 ? 0 : (pdy > 0 ? 1 : -1);
          if (pnx === 0 && pny === 0) pnx = 1;
          var pushFloor = combat.floor;
          var pushFinalX = target.x;
          var pushFinalY = target.y;
          if (pushFloor && pushFloor.grid) {
            var pushGridW = pushFloor.width || pushFloor.grid[0].length;
            var pushGridH = pushFloor.height || pushFloor.grid.length;
            for (var pushStep = 0; pushStep < pushTiles; pushStep++) {
              var pushNextX = pushFinalX + pnx;
              var pushNextY = pushFinalY + pny;
              if (isWalkableCombat(pushFloor.grid, pushNextX, pushNextY, pushGridW, pushGridH, combat.units) && !getUnitAtPosition(combat, pushNextX, pushNextY)) {
                pushFinalX = pushNextX;
                pushFinalY = pushNextY;
              } else {
                break;
              }
            }
          }
          if (pushFinalX !== target.x || pushFinalY !== target.y) {
            target.x = pushFinalX;
            target.y = pushFinalY;
            weaponEffects.push({ type: 'knockback', targetId: targetId, newX: pushFinalX, newY: pushFinalY, source: 'affix', affixId: ohAff.id });
          }
        }
      }
    }
  }

  // --- Passive: mana_on_magic_hit — recover 15% of magic damage taken as mana ---
  // This triggers on the TARGET (defender) when they are hit by a magic attack
  if (damageToHp > 0 && target.alive && target.type === 'player') {
    var manaOnHitPassive = getUnitCombatPassive(target, 'mana_on_magic_hit');
    if (manaOnHitPassive) {
      // Check if attacker is using magic (enemy element or player magic weapon)
      var atkElementMOH = (attacker.combat && attacker.combat.element) || 'physical';
      var isMagicAttackMOH = (atkElementMOH !== 'physical' && atkElementMOH !== 'none');
      if (isMagicAttackMOH && target.combat && target.combat.mana !== undefined) {
        var manaRecover = Math.max(1, Math.floor(damageToHp * (manaOnHitPassive.value || 0.15)));
        var maxManaMOH = target.combat.maxMana || 50;
        var oldManaMOH = target.combat.mana;
        target.combat.mana = Math.min(maxManaMOH, target.combat.mana + manaRecover);
        var actualManaGain = target.combat.mana - oldManaMOH;
        if (actualManaGain > 0) {
          weaponEffects.push({
            type: 'mana_restore',
            targetId: targetId,
            amount: actualManaGain,
            targetMana: target.combat.mana,
            passive: 'mana_on_magic_hit',
          });
        }
      }
    }
  }

  // Focus: track basic attack targeting for focus generation
  if (damageToHp > 0 && attacker.combat && (attacker.combat.primaryResource === 'focus' || attacker.combat.focus !== undefined)) {
    if (target && target.id === attacker._lastTargetId) {
      var focusGainBA = FOCUS_BASIC_ATTACK_GAIN;
      var maxFocusBA = attacker.combat.maxFocus || 50;
      attacker.combat.focus = Math.min(maxFocusBA, (attacker.combat.focus || 0) + focusGainBA);
    } else if (target) {
      // Target switch — apply base retain
      var retainBA = FOCUS_BASE_RETAIN;
      // Check for retain bonus passives
      if (attacker.equippedCards) {
        for (var frbi = 0; frbi < attacker.equippedCards.length; frbi++) {
          var frbCard = attacker.equippedCards[frbi];
          if (frbCard && frbCard.effects) {
            for (var frbei = 0; frbei < frbCard.effects.length; frbei++) {
              if (frbCard.effects[frbei].type === 'resource_retain_on_switch' && frbCard.effects[frbei].resource === 'focus') {
                retainBA += frbCard.effects[frbei].value || 0;
              }
              if (frbCard.effects[frbei].type === 'resource_retain_bonus' && frbCard.effects[frbei].resource === 'focus') {
                retainBA += frbCard.effects[frbei].value || 0;
              }
            }
          }
        }
      }
      attacker.combat.focus = Math.floor((attacker.combat.focus || 0) * retainBA);
    }
    if (target) attacker._lastTargetId = target.id;
  }

  return {
    success: true,
    attackerId: attackerId,
    targetId: targetId,
    damage: damageToHp + shieldAbsorbed + manaShieldAbsorbed, // Total damage before absorptions
    actualDamage: damageToHp,           // Damage that hit HP
    isCrit: isCrit,
    dodged: false,
    blocked: blocked,
    shieldAbsorbed: shieldAbsorbed,
    manaShieldAbsorbed: manaShieldAbsorbed,
    targetDied: targetDied,
    targetHp: Math.max(0, target.hp),
    targetMaxHp: target.maxHp,
    attackerAp: attacker.ap,
    attackerHp: attacker.hp,
    weaponEffects: weaponEffects,
    lifestealHeal: lifestealHeal,
    reflectDamage: reflectDamage,
  };
}

module.exports = {
  init: init,
  executeBasicAttack: executeBasicAttack,
};
