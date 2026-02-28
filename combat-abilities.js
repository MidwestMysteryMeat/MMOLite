// combat-abilities.js
// Ability execution (all combat types) and cooldown ticking.
// Extracted from dungeon-combat.js — re-exported for backward compatibility.

'use strict';

var rpgData = require('./rpg-data');

var combatGrid = require('./combat-grid');
var manhattanDist = combatGrid.manhattanDist;
var isWalkableCombat = combatGrid.isWalkableCombat;

var combatPassives = require('./combat-passive-helpers');
var getUnitCombatPassive = combatPassives.getUnitCombatPassive;
var getUnitCombatPassiveTotal = combatPassives.getUnitCombatPassiveTotal;
var getCardEffectTotal = combatPassives.getCardEffectTotal;
var hasCCImmunity = combatPassives.hasCCImmunity;

var combatTiles = require('./combat-tiles');

var combatQueries = require('./combat-queries');
var getUnitsInRadius = combatQueries.getUnitsInRadius;
var getUnitAtPosition = combatQueries.getUnitAtPosition;

var _maps = require('./combat-state-maps');
var _comboState = _maps.comboState;
var _dancePartners = _maps.dancePartners;
var _divineInvulnerability = _maps.divineInvulnerability;
var _fadeActive = _maps.fadeActive;
var _innervates = _maps.innervates;
var _intercepts = _maps.intercepts;
var _lilyTokens = _maps.lilyTokens;
var _playerClones = _maps.playerClones;
var _soulstones = _maps.soulstones;

var handleUnitDeath;
var FOCUS_CONSECUTIVE_GAIN, FOCUS_BASE_RETAIN;
var BLOODLUST_ON_TAKE_DAMAGE;

function init(deps) {
  handleUnitDeath = deps.handleUnitDeath;
  FOCUS_CONSECUTIVE_GAIN = deps.FOCUS_CONSECUTIVE_GAIN;
  FOCUS_BASE_RETAIN = deps.FOCUS_BASE_RETAIN;
  BLOODLUST_ON_TAKE_DAMAGE = deps.BLOODLUST_ON_TAKE_DAMAGE;
}

function executeAbility(combat, unitId, abilityCardId, targetX, targetY) {
  var unit = combat.units.get(unitId);
  if (!unit || !unit.alive) {
    return { success: false, reason: 'Unit is dead or does not exist' };
  }

  // Find the card in equipped cards
  var card = null;
  var equippedCards = unit.equippedCards || [];
  for (var ci = 0; ci < equippedCards.length; ci++) {
    var c = equippedCards[ci];
    if (c && (c.id === abilityCardId || c.cardId === abilityCardId)) {
      card = c;
      break;
    }
  }

  if (!card) {
    return { success: false, reason: 'Card not found in equipped cards' };
  }

  // Look up template for combat fields (card instances don't carry them)
  var template = rpgData.CARD_BY_ID[card.cardId] || {};
  // Merge template combat fields onto card reference for this execution
  var combatCard = {
    combatType: template.combatType || card.combatType,
    baseDamage: template.baseDamage || card.baseDamage,
    baseHeal: template.baseHeal || card.baseHeal,
    range: template.range || card.range,
    manaCost: template.manaCost || card.manaCost,
    aoeRadius: template.aoeRadius || card.aoeRadius,
    cooldown: template.cooldown || card.cooldown,
    scalingStat: template.scalingStat || card.scalingStat,
    scalingFactor: template.scalingFactor || card.scalingFactor,
    onHitTile: template.onHitTile || card.onHitTile,
    onHitStatus: template.onHitStatus || card.onHitStatus,
    targetType: template.targetType || card.targetType,
    tileEffect: template.tileEffect || card.tileEffect,
    statusEffect: template.statusEffect || card.statusEffect,
    statusDuration: template.statusDuration || card.statusDuration,
    damageBoost: template.damageBoost,
    armorBoost: template.armorBoost,
    armorReduction: template.armorReduction,
    speedMult: template.speedMult,
    statBoost: template.statBoost,
    tickDamage: template.tickDamage,
    damageReduction: template.damageReduction,
    lifesteal: template.lifesteal || card.lifesteal,
    knockback: template.knockback,
    leapToTarget: template.leapToTarget,
    tauntAoe: template.tauntAoe,
    chainBounces: template.chainBounces,
    chainHealFalloff: template.chainHealFalloff,
    manaRestorePercent: template.manaRestorePercent,
    name: template.name || card.name,
    // Animal form fields
    animalForm: template.animalForm,
    maxHpPercent: template.maxHpPercent,
    dodgeBonus: template.dodgeBonus,
    critBonus: template.critBonus,
    shellDR: template.shellDR,
    withdrawDR: template.withdrawDR,
    cantAttack: template.cantAttack,
    cantMove: template.cantMove,
    hpRegenPercent: template.hpRegenPercent,
    revealHidden: template.revealHidden,
    revealRadius: template.revealRadius,
    revealAll: template.revealAll,
    flyOver: template.flyOver,
    meleeImmune: template.meleeImmune,
    nightVision: template.nightVision,
    wallClimb: template.wallClimb,
    shedSkin: template.shedSkin,
    stealthBonus: template.stealthBonus,
    stealthDamageBonus: template.stealthDamageBonus,
    packHunterBonus: template.packHunterBonus,
    packHunterMax: template.packHunterMax,
    pounceStun: template.pounceStun,
    prowlOnKill: template.prowlOnKill,
    guardIntercept: template.guardIntercept,
    allyDamageAura: template.allyDamageAura,
    allyHpRegenAura: template.allyHpRegenAura,
    critDamageReduction: template.critDamageReduction,
    bleedOnHit: template.bleedOnHit,
    constrictDuration: template.constrictDuration,
    constrictDamage: template.constrictDamage,
    diveBombDamage: template.diveBombDamage,
    diveBombStun: template.diveBombStun,
    webTrapRoot: template.webTrapRoot,
    xpBonus: template.xpBonus,
    // MMO-inspired card fields
    pullToSelf: template.pullToSelf,
    shattersClones: template.shattersClones,
    damagePerClone: template.damagePerClone,
    multiTarget: template.multiTarget,
    element: template.element,
    cleansesDebuffs: template.cleansesDebuffs,
    ccImmune: template.ccImmune,
    damageTakenIncrease: template.damageTakenIncrease,
    hpCost: template.hpCost,
    invulnerable: template.invulnerable,
    aoeOnAttack: template.aoeOnAttack,
    threatDrop: template.threatDrop,
    redirectDamage: template.redirectDamage,
    selfDamageReduction: template.selfDamageReduction,
    reviveHpPercent: template.reviveHpPercent,
    manaPerTurn: template.manaPerTurn,
    hasteMult: template.hasteMult,
    cooldownReduction: template.cooldownReduction,
    knockbackImmune: template.knockbackImmune,
    fullHeal: template.fullHeal,
    summonType: template.summonType,
    summonCount: template.summonCount,
    summonHp: template.summonHp,
    summonDamage: template.summonDamage,
    summonDuration: template.summonDuration,
    tileDuration: template.tileDuration,
    tileHealPercent: template.tileHealPercent,
    tileDamage: template.tileDamage,
    wardDamageReduction: template.wardDamageReduction,
    // Grappler archetype fields
    selfImmobilize: template.selfImmobilize,
    selfCantAttack: template.selfCantAttack,
    breaksOnDamageToSelf: template.breaksOnDamageToSelf,
    hpScaling: template.hpScaling,
    hpScalingPercent: template.hpScalingPercent,
    throwDistance: template.throwDistance,
    wallCollisionBonusDamage: template.wallCollisionBonusDamage,
    wallCollisionStatus: template.wallCollisionStatus,
    primaryTargetBonusDamage: template.primaryTargetBonusDamage,
    damageType: template.damageType,
    // Night Hunter archetype fields
    nightDamageBonus: template.nightDamageBonus,
    antiStealth: template.antiStealth,
    damageAmpFromCaster: template.damageAmpFromCaster,
    revealPosition: template.revealPosition,
    bonusVsUndead: template.bonusVsUndead,
    bonusVsShadow: template.bonusVsShadow,
    counterAttackPercent: template.counterAttackPercent,
    counterOnMelee: template.counterOnMelee,
    // Aquatic archetype fields
    waterTileBonusDamage: template.waterTileBonusDamage,
    pullDistance: template.pullDistance,
    waterTileShieldMultiplier: template.waterTileShieldMultiplier,
    // Scout archetype fields
    passThroughEnemies: template.passThroughEnemies,
    onUseStatus: template.onUseStatus,
    summonDecoy: template.summonDecoy,
    decoyHp: template.decoyHp,
    decoyDrawsAggro: template.decoyDrawsAggro,
    // Movement card fields
    dashDistance: template.dashDistance,
    teleportDistance: template.teleportDistance,
    // Buff card fields
    shieldBase: template.shieldBase,
    cantMove: template.cantMove,
    // Pure Defense archetype fields
    armorBoostPercent: template.armorBoostPercent,
    stationaryArmorBoostPercent: template.stationaryArmorBoostPercent,
  };

  // Validate AP
  if (unit.ap <= 0) {
    return { success: false, reason: 'No action points remaining' };
  }

  // Initialize cooldown tracker if missing
  if (!unit.abilityCooldowns) {
    unit.abilityCooldowns = new Map();
  }

  // Validate cooldown
  var currentCooldown = unit.abilityCooldowns.get(abilityCardId);
  if (currentCooldown !== undefined && currentCooldown > 0) {
    return { success: false, reason: 'Ability on cooldown (' + currentCooldown + ' turns remaining)' };
  }

  // Validate range using manhattan distance
  var cardRange = template.range || card.range || 1;
  var dist = manhattanDist(unit.x, unit.y, targetX, targetY);
  if (dist > cardRange) {
    return { success: false, reason: 'Target out of range (distance: ' + dist + ', range: ' + cardRange + ')' };
  }

  // Determine resource type and cost
  var resourceType = template.resourceType || card.resourceType || 'mana';
  var manaCost = (template.manaCost !== undefined ? template.manaCost : (card.manaCost || 0));
  // Apply efficiency reduction (mana efficiency applies to all resource types)
  if (manaCost > 0 && unit.type === 'player' && unit.combat && unit.combat.manaEfficiency > 0) {
    manaCost = Math.max(1, Math.round(manaCost * (1 - unit.combat.manaEfficiency)));
  }
  // --- Hot Streak: free ability when hot_streak buff is active ---
  if (manaCost > 0 && unit.statusEffects) {
    for (var hsFreeI = 0; hsFreeI < unit.statusEffects.length; hsFreeI++) {
      if (unit.statusEffects[hsFreeI].name === 'hot_streak' && unit.statusEffects[hsFreeI].freeAbility) {
        manaCost = 0;
        break;
      }
    }
  }
  // --- Combo Chain validation ---
  var comboCardIdLower = (abilityCardId || '').toLowerCase();
  if (comboCardIdLower === 'combo_savage_blow') {
    var comboSt = _comboState.get(unitId);
    if (!comboSt || comboSt.lastCombo !== 'combo_rising_edge') {
      return { success: false, reason: 'Must use Rising Edge first' };
    }
  }
  if (comboCardIdLower === 'combo_full_thrust') {
    var comboSt2 = _comboState.get(unitId);
    if (!comboSt2 || comboSt2.lastCombo !== 'combo_savage_blow') {
      return { success: false, reason: 'Must use Savage Blow first' };
    }
  }
  // Handle dual-cost abilities (costs from two resource pools)
  var hasDualCost = !!(template.dualCost || card.dualCost);
  if (hasDualCost) {
    var dualCost = template.dualCost || card.dualCost;
    for (var dualRes in dualCost) {
      if (dualCost.hasOwnProperty(dualRes)) {
        var dualAmount = dualCost[dualRes];
        var dualPool = (unit.combat && unit.combat[dualRes] !== undefined) ? unit.combat[dualRes] : 0;
        if (dualPool < dualAmount) {
          var dualName = dualRes.charAt(0).toUpperCase() + dualRes.slice(1);
          return { success: false, reason: 'Not enough ' + dualName + ' (have: ' + dualPool + ', need: ' + dualAmount + ')' };
        }
      }
    }
  }

  // Validate resource pool (supports mana, stamina, bloodlust, focus)
  // Skip standard single-resource check if dual cost handles it
  if (!hasDualCost && manaCost > 0) {
    var poolKey = resourceType; // 'mana', 'stamina', 'bloodlust', or 'focus'
    var unitResource = (unit.combat && unit.combat[poolKey] !== undefined) ? unit.combat[poolKey] : 0;
    if (unitResource < manaCost) {
      var resourceName = poolKey.charAt(0).toUpperCase() + poolKey.slice(1);
      return { success: false, reason: 'Not enough ' + resourceName + ' (have: ' + unitResource + ', need: ' + manaCost + ')' };
    }
  }

  // --- All validation passed, execute the ability ---

  // Deduct dual costs
  if (hasDualCost) {
    var dCost = template.dualCost || card.dualCost;
    for (var dRes in dCost) {
      if (dCost.hasOwnProperty(dRes)) {
        unit.combat[dRes] -= dCost[dRes];
      }
    }
  }

  // Deduct resource from the appropriate pool (skip if dual cost was used)
  if (!hasDualCost && manaCost > 0) {
    unit.combat[resourceType] -= manaCost;
  }

  // Focus: track consecutive targeting
  if (unit.combat && (resourceType === 'focus' || unit.combat.primaryResource === 'focus')) {
    var focusTargetAtPos = getUnitAtPosition(combat, targetX, targetY);
    var focusTargetId = focusTargetAtPos ? focusTargetAtPos.id : null;

    if (focusTargetId && focusTargetId === unit._lastTargetId) {
      // Consecutive action on same target — gain focus
      var focusGain = FOCUS_CONSECUTIVE_GAIN;
      // Check for consecutive bonus passive
      if (unit.equippedCards) {
        for (var fci = 0; fci < unit.equippedCards.length; fci++) {
          var fcCard = unit.equippedCards[fci];
          if (!fcCard || !fcCard.effects) continue;
          for (var fcei = 0; fcei < fcCard.effects.length; fcei++) {
            if (fcCard.effects[fcei].type === 'resource_consecutive_bonus' && fcCard.effects[fcei].resource === 'focus') {
              focusGain += fcCard.effects[fcei].value;
            }
          }
        }
      }
      var maxFocusPool = unit.combat.maxFocus || 50;
      unit.combat.focus = Math.min(maxFocusPool, (unit.combat.focus || 0) + focusGain);
    } else if (focusTargetId) {
      // Switched target — apply base retain + passive bonuses
      var retainPercent = FOCUS_BASE_RETAIN; // Base 25% retain instead of 0%
      if (unit.equippedCards) {
        for (var fri = 0; fri < unit.equippedCards.length; fri++) {
          var frCard = unit.equippedCards[fri];
          if (!frCard || !frCard.effects) continue;
          for (var frei = 0; frei < frCard.effects.length; frei++) {
            if (frCard.effects[frei].type === 'resource_retain_on_switch' && frCard.effects[frei].resource === 'focus') {
              retainPercent += frCard.effects[frei].value || 0;
            }
            if (frCard.effects[frei].type === 'resource_retain_bonus' && frCard.effects[frei].resource === 'focus') {
              retainPercent += frCard.effects[frei].value || 0;
            }
          }
        }
      }
      unit.combat.focus = Math.floor((unit.combat.focus || 0) * retainPercent);
    }
    unit._lastTargetId = focusTargetId;
  }

  // Deduct AP
  unit.ap -= 1;

  // Set cooldown
  var cooldownDuration = template.cooldown || card.cooldown || 2;
  unit.abilityCooldowns.set(abilityCardId, cooldownDuration);

  // Gather rpgStats from the unit's combat data for damage formulas
  var rpgStats = unit.combat || {};
  var magicMult = rpgStats.magicDmgMult || 1;
  var acumen = rpgStats.acumen || 5;

  // --- Aquatic Passive: aquatic_adaptation — +30% all stats on water floors ---
  var aquaticAdaptProc = false;
  var aquaticPassive = getUnitCombatPassive(unit, 'aquatic_adaptation');
  if (aquaticPassive && combat._isWaterFloor) {
    var aquaBonus = aquaticPassive.waterTileStatBonus || 0.30;
    magicMult = magicMult * (1 + aquaBonus);
    acumen = Math.floor(acumen * (1 + aquaBonus));
    // Temporarily boost the rpgStats reference values for this ability execution
    // This affects scalingStat lookups (might, finesse, resolve) in the damage loop
    rpgStats = Object.create(rpgStats);
    rpgStats.might = Math.floor((rpgStats.might || 5) * (1 + aquaBonus));
    rpgStats.finesse = Math.floor((rpgStats.finesse || 5) * (1 + aquaBonus));
    rpgStats.resolve = Math.floor((rpgStats.resolve || 5) * (1 + aquaBonus));
    rpgStats.ingenuity = Math.floor((rpgStats.ingenuity || 5) * (1 + aquaBonus));
    rpgStats.acumen = acumen;
    aquaticAdaptProc = true;
  }

  var effects = [];
  var cardType = combatCard.combatType || 'damage';

  // Emit aquatic_adaptation proc effect if triggered
  if (aquaticAdaptProc) {
    effects.push({
      type: 'passive_proc',
      passive: 'aquatic_adaptation',
      unitId: unitId,
      statBonus: aquaticPassive.waterTileStatBonus || 0.30,
    });
  }
  var aoeRadius = combatCard.aoeRadius || 0;

  // chargeTime is defined on some cards but delayed casting is not yet implemented.
  // All abilities apply immediately regardless of chargeTime.

  switch (cardType) {

    case 'damage': {
      // Collect targets: single target, AoE, or room-wide
      var damageTargets = [];
      if (combatCard.targetType === 'all_enemies') {
        // Room-wide: hit all enemies
        var allIter = combat.units.values();
        var allEntry = allIter.next();
        while (!allEntry.done) {
          var allU = allEntry.value;
          allEntry = allIter.next();
          if (allU.type !== unit.type && allU.alive && allU.id !== unitId) {
            damageTargets.push(allU);
          }
        }
      } else if (aoeRadius > 0) {
        damageTargets = getUnitsInRadius(combat, targetX, targetY, aoeRadius);
        // Exclude the caster and same-type allies from AoE damage
        var filteredTargets = [];
        for (var di = 0; di < damageTargets.length; di++) {
          if (damageTargets[di].id !== unitId && damageTargets[di].type !== unit.type) {
            filteredTargets.push(damageTargets[di]);
          }
        }
        damageTargets = filteredTargets;
      } else {
        var singleTarget = getUnitAtPosition(combat, targetX, targetY);
        if (singleTarget && singleTarget.id !== unitId) {
          damageTargets.push(singleTarget);
        }
      }

      // LeapToTarget: caster jumps to adjacent tile of first target before dealing damage
      if (combatCard.leapToTarget && damageTargets.length > 0) {
        var leapTarget = damageTargets[0];
        var leapFromX = unit.x;
        var leapFromY = unit.y;
        // Find an adjacent walkable tile to the target
        var adjTiles = getAdjacentTiles(leapTarget.x, leapTarget.y, combat.floor.width, combat.floor.height);
        var leaped = false;
        for (var lti = 0; lti < adjTiles.length; lti++) {
          var lt = adjTiles[lti];
          if (isWalkableCombat(combat.floor.grid, lt.x, lt.y, combat.floor.width, combat.floor.height, combat.units) && !getUnitAtPosition(combat, lt.x, lt.y)) {
            unit.x = lt.x;
            unit.y = lt.y;
            leaped = true;
            break;
          }
        }
        if (leaped) {
          effects.push({
            type: 'movement',
            unitId: unitId,
            fromX: leapFromX,
            fromY: leapFromY,
            toX: unit.x,
            toY: unit.y,
            isLeap: true,
          });
        }
      }

      // Corpse Explosion: consume nearby corpses for +15 flat damage each
      var _corpseBonus = 0;
      if (combatCard.cardId === 'corpse_explosion' && combat.corpses && combat.corpses.length > 0) {
        var _consumedCorpses = [];
        var _ceRadius = combatCard.aoeRadius || 2;
        for (var ci = combat.corpses.length - 1; ci >= 0; ci--) {
          var _corp = combat.corpses[ci];
          var _corpDist = Math.abs(_corp.x - targetX) + Math.abs(_corp.y - targetY);
          if (_corpDist <= _ceRadius) {
            _consumedCorpses.push(_corp);
            combat.corpses.splice(ci, 1);
          }
        }
        _corpseBonus = _consumedCorpses.length * 15;
        if (_consumedCorpses.length > 0) {
          effects.push({
            type: 'corpse_consumed',
            corpses: _consumedCorpses.map(function(c) { return c.name; }),
            bonusDamage: _corpseBonus,
          });
        }
      }

      var _abilityHitCount = 0;
      for (var dti = 0; dti < damageTargets.length; dti++) {
        var target = damageTargets[dti];
        // Support card-specific scaling stat
        var scalingStat = combatCard.scalingStat || 'acumen';
        var scalingFactor = combatCard.scalingFactor || 0.5;
        var scalingValue = acumen; // default
        if (scalingStat === 'might') scalingValue = rpgStats.might || 5;
        else if (scalingStat === 'finesse') scalingValue = rpgStats.finesse || 5;
        else if (scalingStat === 'resolve') scalingValue = rpgStats.resolve || 5;
        var baseDmg = (combatCard.baseDamage || 0) + scalingValue * scalingFactor + _corpseBonus;
        // Apply magic damage multiplier for non-physical abilities
        if (scalingStat === 'acumen') {
          baseDmg = baseDmg * magicMult;
        }
        // Card: spell_damage_bonus — bonus damage for magic-scaling abilities
        if (unit.type === 'player' && unit.combat && unit.combat.spellDmgBonus > 0) {
          if (scalingStat === 'acumen' || scalingStat === 'resolve') {
            baseDmg = baseDmg * (1 + unit.combat.spellDmgBonus);
          }
        }
        // Card: poison_damage_bonus — bonus damage for poison element abilities
        var abilityElem = combatCard.element || template.element || null;
        if (unit.type === 'player' && unit.combat && unit.combat.poisonDmgBonus > 0) {
          if (abilityElem === 'poison' || combatCard.damageType === 'poison') {
            baseDmg = baseDmg * (1 + unit.combat.poisonDmgBonus);
          }
        }
        // Level scaling: +2% per caster level
        var casterLevel = unit.level || 1;
        baseDmg = baseDmg * (1 + (casterLevel - 1) * 0.02);

        // --- Grappler: hpScaling — add % of caster max HP to base damage ---
        if (combatCard.hpScaling && combatCard.hpScalingPercent) {
          baseDmg += (unit.maxHp || 100) * combatCard.hpScalingPercent;
        }

        // --- Grappler: primaryTargetBonusDamage — AoE primary target gets bonus damage ---
        if (combatCard.primaryTargetBonusDamage && aoeRadius > 0 && dti === 0) {
          baseDmg = baseDmg * (1 + combatCard.primaryTargetBonusDamage);
        }

        // --- Night Hunter: nightDamageBonus — bonus damage on dark floors ---
        if (combatCard.nightDamageBonus && (unit._isDarkFloor || combat._isDarkFloor)) {
          baseDmg = baseDmg * (1 + combatCard.nightDamageBonus);
        }

        // --- Night Hunter: bonusVsUndead / bonusVsShadow — flat bonus vs specific enemy types ---
        if (target.type === 'enemy') {
          var targetEnemyType = (target.enemyType || target.type_tag || '').toLowerCase();
          var targetElement = (target.combat && target.combat.element) ? target.combat.element.toLowerCase() : '';
          if (combatCard.bonusVsUndead && (targetEnemyType === 'undead' || targetElement === 'undead' || targetElement === 'dark')) {
            baseDmg += combatCard.bonusVsUndead;
          }
          if (combatCard.bonusVsShadow && (targetEnemyType === 'shadow' || targetElement === 'shadow')) {
            baseDmg += combatCard.bonusVsShadow;
          }
        }

        // --- Night Hunter: damageAmpFromCaster — check if target has a debuff from this caster with damageAmp ---
        if (target.statusEffects) {
          for (var dacI = 0; dacI < target.statusEffects.length; dacI++) {
            var dacSE = target.statusEffects[dacI];
            if (dacSE.damageAmpFromCaster && dacSE.damageAmpSourceId === unitId) {
              baseDmg = baseDmg * (1 + dacSE.damageAmpFromCaster);
              break;
            }
          }
        }

        // --- Aquatic: waterTileBonusDamage — bonus damage if target is on a water tile ---
        if (combatCard.waterTileBonusDamage && combat._isWaterFloor) {
          baseDmg = baseDmg * (1 + combatCard.waterTileBonusDamage);
        }

        // --- Night Hunter Passive: hunters_instinct — +15% ability damage vs debuffed ---
        var hiAbilityPassive = getUnitCombatPassive(unit, 'hunters_instinct');
        if (hiAbilityPassive && target.statusEffects && target.statusEffects.length > 0) {
          var hiHasDebuff = false;
          var hiHasMark = false;
          for (var hiAbI = 0; hiAbI < target.statusEffects.length; hiAbI++) {
            if (target.statusEffects[hiAbI].type === 'debuff') hiHasDebuff = true;
            if (target.statusEffects[hiAbI].name === 'predators_mark') hiHasMark = true;
          }
          if (hiHasDebuff) {
            baseDmg = baseDmg * (1 + (hiAbilityPassive.damageVsDebuffed || 0.15));
          }
        }

        // Determine whether to use magic resist or physical armor
        var isMagicAbility = (scalingStat === 'acumen' || scalingStat === 'resolve');
        var targetDef;
        if (isMagicAbility) {
          // Magic ability: use magicResist instead of physical armor
          targetDef = (target.combat && target.combat.magicResist) ? target.combat.magicResist : 0;
          // For player targets, check magicResist on combat state
          if (target.type === 'player' && target.combat && target.combat.magicResist !== undefined) {
            targetDef = target.combat.magicResist;
          }
        } else {
          // Physical ability: use regular armor
          targetDef = (target.combat && target.combat.def !== undefined) ? target.combat.def : 0;
          if (target.type === 'player' && target.combat && target.combat.baseArmor !== undefined) {
            targetDef = target.combat.baseArmor;
          }
        }
        // Armor/resist reduces damage by a percentage: reduction = def / (def + 50)
        var armorReduction = targetDef / (targetDef + 50);
        var damage = Math.max(1, Math.floor(baseDmg * (1 - armorReduction)));

        // --- Execute Mechanics: kill_shot (3x below 25%), execute_strike (2x below 30%) ---
        var cardIdLower = (abilityCardId || '').toLowerCase();
        if (cardIdLower === 'kill_shot') {
          var ksHpPct = target.hp / (target.maxHp || 1);
          if (ksHpPct < 0.25) {
            damage = damage * 3;
          }
        }
        if (cardIdLower === 'execute_strike') {
          var esHpPct = target.hp / (target.maxHp || 1);
          if (esHpPct < 0.30) {
            damage = damage * 2;
          }
        }

        // --- Metamorphosis AoE: during metamorphosis buff, attacks become AoE ---
        // (handled via the AoE targeting above; metamorphosis sets aoeRadius on the buff)

        // --- Hot Streak buff: +50% damage when active ---
        if (unit.statusEffects) {
          for (var hsI = 0; hsI < unit.statusEffects.length; hsI++) {
            if (unit.statusEffects[hsI].name === 'hot_streak' && unit.statusEffects[hsI].freeAbility) {
              damage = Math.floor(damage * 1.50);
              // Consume the hot_streak buff
              unit.statusEffects.splice(hsI, 1);
              break;
            }
          }
        }

        // --- Shatter Passive: +30% crit damage vs frozen/stunned (applied below in crit) ---

        // Apply elemental multiplier (Fix 2)
        var abilityElement = combatCard.element || template.element || null;

        // --- Soul Shards Empowered: +75% damage for dark abilities ---
        if (unit.statusEffects && (abilityElement === 'dark' || abilityElement === 'shadow')) {
          for (var ssBI = 0; ssBI < unit.statusEffects.length; ssBI++) {
            if (unit.statusEffects[ssBI].name === 'soul_shards_empowered' && unit.statusEffects[ssBI].soulShardsBuff) {
              damage = Math.floor(damage * 1.75);
              unit.statusEffects.splice(ssBI, 1);
              break;
            }
          }
        }
        var defenderElement = (target.combat && target.combat.element) ? target.combat.element : null;
        if (abilityElement && defenderElement) {
          var elemMult = rpgData.getElementalMultiplier(abilityElement, defenderElement);
          damage = Math.floor(damage * elemMult);
          if (damage < 1 && elemMult > 0) damage = 1;
        }

        // Card: elemental_resist_all — flat % reduction vs elemental abilities (player target)
        if (target.type === 'player' && target.combat && target.combat.elementalResistAll > 0 && abilityElement) {
          damage = Math.max(1, Math.floor(damage * (1 - target.combat.elementalResistAll)));
        }

        // Card: low_hp_damage_reduction — damage reduction when player is below 30% HP
        if (target.type === 'player' && target.combat && target.combat.lowHpDmgReduction > 0) {
          var abilityHpPct = target.hp / (target.maxHp || 1);
          if (abilityHpPct < 0.30) {
            damage = Math.max(1, Math.floor(damage * (1 - target.combat.lowHpDmgReduction)));
          }
        }

        // --- Vulnerability Exposed debuff — target takes % more damage after CC expires ---
        if (target.statusEffects && target.statusEffects.length > 0) {
          for (var avexi = 0; avexi < target.statusEffects.length; avexi++) {
            if (target.statusEffects[avexi].name === 'vulnerability_exposed' && target.statusEffects[avexi].damageAmplify) {
              damage = Math.floor(damage * (1 + target.statusEffects[avexi].damageAmplify));
              break;
            }
          }
        }

        // Crit check (use caster's crit chance)
        var isCrit = false;
        var critChance = rpgStats.critChance || 0;
        if (Math.random() < critChance) {
          isCrit = true;
          var abilityCritMult = 1.5;
          // --- Shatter Passive: +30% crit damage vs frozen/stunned targets ---
          var abShatterPassive = getUnitCombatPassive(unit, 'shatter');
          if (abShatterPassive && target.statusEffects) {
            for (var abShI = 0; abShI < target.statusEffects.length; abShI++) {
              var abShSe = target.statusEffects[abShI];
              if (abShSe.name === 'frozen' || abShSe.name === 'stunned' || abShSe.name === 'knockdown') {
                abilityCritMult += (abShatterPassive.value || 0.30);
                break;
              }
            }
          }
          damage = Math.floor(damage * abilityCritMult);
        }

        // Momentum shield absorbs damage
        var shieldAbsorbed = 0;
        if (target.momentumShield > 0) {
          shieldAbsorbed = Math.min(target.momentumShield, damage);
          target.momentumShield -= shieldAbsorbed;
          damage -= shieldAbsorbed;
        }

        // Apply damage
        if (damage > 0) {
          target.hp -= damage;
          _abilityHitCount++;
        }

        // Grant bloodlust when taking damage (ability direct hit)
        if (damage > 0 && target.combat && target.combat.bloodlust !== undefined && target.alive && target.hp > 0) {
          var blOnDmgAb = BLOODLUST_ON_TAKE_DAMAGE;
          var maxBLTAb = target.combat.maxBloodlust || 50;
          target.combat.bloodlust = Math.min(maxBLTAb, (target.combat.bloodlust || 0) + blOnDmgAb);
          target._lastActionTurn = combat.turnNumber;
        }

        var targetDied = target.hp <= 0;
        if (targetDied) {
          target.alive = false;
          target.hp = 0;
          // Note: handleUnitDeath is called by the caller (handleAbilityAction / executeAIAction)
        }

        // --- Mortal Strike: apply mortal_wounds debuff (25% healing reduction for 3 turns) ---
        if (cardIdLower === 'mortal_strike' && !targetDied && target.alive) {
          if (!target.statusEffects) target.statusEffects = [];
          target.statusEffects.push({
            name: 'mortal_wounds',
            type: 'debuff',
            duration: 3,
            healingReduction: 0.25,
            sourceId: unitId,
          });
        }

        // --- Atonement Passive on ability damage: heal lowest-HP ally for 20% ---
        if (damage > 0 && unit.alive) {
          var abAtonement = getUnitCombatPassive(unit, 'atonement');
          if (abAtonement) {
            var abAtonHealPct = abAtonement.value || 0.20;
            var abAtonHealAmt = Math.max(1, Math.floor(damage * abAtonHealPct));
            var abLowestAlly = null;
            var abLowestRatio = 1.1;
            var abAtonIter = combat.units.values();
            var abAtonEntry = abAtonIter.next();
            while (!abAtonEntry.done) {
              var abAA = abAtonEntry.value;
              abAtonEntry = abAtonIter.next();
              if (abAA.type === unit.type && abAA.alive && abAA.hp < abAA.maxHp) {
                var abAR = abAA.hp / (abAA.maxHp || 1);
                if (abAR < abLowestRatio) {
                  abLowestRatio = abAR;
                  abLowestAlly = abAA;
                }
              }
            }
            if (abLowestAlly) {
              abLowestAlly.hp = Math.min(abLowestAlly.maxHp, abLowestAlly.hp + abAtonHealAmt);
            }
          }
        }

        // --- Kardia Link Passive: every ability use heals bonded ally for 8 flat HP ---
        if (unit.alive) {
          var kardiaPassive = getUnitCombatPassive(unit, 'kardia_link');
          if (kardiaPassive) {
            var kardiaPartner = _dancePartners.get(unitId);
            var kardiaTarget = kardiaPartner ? combat.units.get(kardiaPartner) : null;
            if (!kardiaTarget) {
              // Default: heal lowest-HP ally
              var kardiaLowest = null;
              var kardiaLowestRatio = 1.1;
              var kardiaIter = combat.units.values();
              var kardiaEntry = kardiaIter.next();
              while (!kardiaEntry.done) {
                var kAlly = kardiaEntry.value;
                kardiaEntry = kardiaIter.next();
                if (kAlly.type === unit.type && kAlly.alive && kAlly.id !== unitId && kAlly.hp < kAlly.maxHp) {
                  var kR = kAlly.hp / (kAlly.maxHp || 1);
                  if (kR < kardiaLowestRatio) { kardiaLowestRatio = kR; kardiaLowest = kAlly; }
                }
              }
              kardiaTarget = kardiaLowest;
            }
            if (kardiaTarget && kardiaTarget.alive) {
              var kardiaHeal = kardiaPassive.value || 8;
              kardiaTarget.hp = Math.min(kardiaTarget.maxHp, kardiaTarget.hp + kardiaHeal);
            }
          }
        }

        // Knockback: push target tiles away from caster (default 1)
        var knockedTo = null;
        if (combatCard.knockback && combatCard.knockback > 0 && !targetDied && !hasCCImmunity(target, 'knockback')) {
          var kbDist = combatCard.knockback;
          // Wrestler's Resilience: reduce knockback distance
          var wrResilienceKb = getUnitCombatPassive(target, 'wrestlers_resilience');
          if (wrResilienceKb) {
            kbDist = Math.max(1, Math.round(kbDist * (1 - (wrResilienceKb.knockbackResist || 0.20))));
          }
          var kbDx = target.x - unit.x;
          var kbDy = target.y - unit.y;
          // Normalize to -1/0/1
          var kbNx = kbDx === 0 ? 0 : (kbDx > 0 ? 1 : -1);
          var kbNy = kbDy === 0 ? 0 : (kbDy > 0 ? 1 : -1);
          var kbFinalX = target.x;
          var kbFinalY = target.y;
          for (var kbStepI = 0; kbStepI < kbDist; kbStepI++) {
            var kbNextX = kbFinalX + kbNx;
            var kbNextY = kbFinalY + kbNy;
            if (isWalkableCombat(combat.floor.grid, kbNextX, kbNextY, combat.floor.width, combat.floor.height, combat.units) && !getUnitAtPosition(combat, kbNextX, kbNextY)) {
              kbFinalX = kbNextX;
              kbFinalY = kbNextY;
            } else {
              break;
            }
          }
          if (kbFinalX !== target.x || kbFinalY !== target.y) {
            target.x = kbFinalX;
            target.y = kbFinalY;
            knockedTo = { x: kbFinalX, y: kbFinalY };
          }
        }

        // --- Grappler: throwDistance — throw target N tiles away from caster ---
        var thrownTo = null;
        if (combatCard.throwDistance && combatCard.throwDistance > 0 && !targetDied && target.alive) {
          // Wrestler's Resilience: reduce throw distance by 30% if target has the passive
          var wrResilienceThrow = getUnitCombatPassive(target, 'wrestlers_resilience');
          var throwDist = combatCard.throwDistance;
          if (wrResilienceThrow) {
            throwDist = Math.max(1, Math.round(throwDist * (1 - (wrResilienceThrow.knockbackResist || 0.20))));
          }
          var throwDx = target.x - unit.x;
          var throwDy = target.y - unit.y;
          var throwNx = throwDx === 0 ? 0 : (throwDx > 0 ? 1 : -1);
          var throwNy = throwDy === 0 ? 0 : (throwDy > 0 ? 1 : -1);
          // If target is on caster (shouldn't happen), default throw direction
          if (throwNx === 0 && throwNy === 0) throwNx = 1;
          var throwFinalX = target.x;
          var throwFinalY = target.y;
          var throwHitWall = false;
          for (var throwI = 0; throwI < throwDist; throwI++) {
            var throwNextX = throwFinalX + throwNx;
            var throwNextY = throwFinalY + throwNy;
            if (isWalkableCombat(combat.floor.grid, throwNextX, throwNextY, combat.floor.width, combat.floor.height, combat.units) && !getUnitAtPosition(combat, throwNextX, throwNextY)) {
              throwFinalX = throwNextX;
              throwFinalY = throwNextY;
            } else {
              throwHitWall = true;
              break;
            }
          }
          if (throwFinalX !== target.x || throwFinalY !== target.y) {
            var throwFromX = target.x;
            var throwFromY = target.y;
            target.x = throwFinalX;
            target.y = throwFinalY;
            thrownTo = { x: throwFinalX, y: throwFinalY, fromX: throwFromX, fromY: throwFromY, hitWall: throwHitWall };
          } else if (throwHitWall) {
            // Target didn't move but hit a wall immediately (already adjacent to wall)
            thrownTo = { x: target.x, y: target.y, fromX: target.x, fromY: target.y, hitWall: true };
          }
          // Wall collision: bonus damage + stun
          if (throwHitWall && combatCard.wallCollisionBonusDamage) {
            var wallBonusDmg = Math.max(1, Math.floor(damage * combatCard.wallCollisionBonusDamage));
            target.hp -= wallBonusDmg;
            if (target.hp <= 0) { target.alive = false; target.hp = 0; targetDied = true; }
            effects.push({
              type: 'wall_collision_damage',
              targetId: target.id,
              damage: wallBonusDmg,
              targetHp: Math.max(0, target.hp),
              targetMaxHp: target.maxHp,
              targetDied: targetDied,
            });
            // Apply wall collision status (stun)
            if (combatCard.wallCollisionStatus && !targetDied && target.alive) {
              if (!target.statusEffects) target.statusEffects = [];
              target.statusEffects.push({
                name: combatCard.wallCollisionStatus.name || 'stunned',
                type: combatCard.wallCollisionStatus.type || 'debuff',
                duration: combatCard.wallCollisionStatus.duration || 1,
                sourceId: unitId,
              });
              effects.push({
                type: 'status',
                targetId: target.id,
                effect: combatCard.wallCollisionStatus.name || 'stunned',
                duration: combatCard.wallCollisionStatus.duration || 1,
                statusType: 'debuff',
                source: 'wall_collision',
              });
            }
          }
        }

        // --- Pull to Self: death_grip_pull / binding_blade pull target adjacent ---
        // Uses pullDistance for multi-tile pull if specified, otherwise pulls to adjacent
        var pulledTo = null;
        if (combatCard.pullToSelf && !targetDied && target.alive) {
          var pullDistVal = combatCard.pullDistance || 1;
          if (pullDistVal <= 1) {
            // Original behavior: pull to adjacent tile of caster
            var pullAdjTiles = getAdjacentTiles(unit.x, unit.y, combat.floor.width, combat.floor.height);
            for (var plI = 0; plI < pullAdjTiles.length; plI++) {
              var plt = pullAdjTiles[plI];
              if (isWalkableCombat(combat.floor.grid, plt.x, plt.y, combat.floor.width, combat.floor.height, combat.units) && !getUnitAtPosition(combat, plt.x, plt.y)) {
                var pullFromX = target.x;
                var pullFromY = target.y;
                target.x = plt.x;
                target.y = plt.y;
                pulledTo = { x: plt.x, y: plt.y, fromX: pullFromX, fromY: pullFromY };
                break;
              }
            }
          } else {
            // Multi-tile pull: move target up to pullDistVal tiles toward caster
            var pullDx = unit.x - target.x;
            var pullDy = unit.y - target.y;
            var pullNx = pullDx === 0 ? 0 : (pullDx > 0 ? 1 : -1);
            var pullNy = pullDy === 0 ? 0 : (pullDy > 0 ? 1 : -1);
            var pullCurX = target.x;
            var pullCurY = target.y;
            var pullFromXM = target.x;
            var pullFromYM = target.y;
            for (var pullStepI = 0; pullStepI < pullDistVal; pullStepI++) {
              var pullNextX = pullCurX + pullNx;
              var pullNextY = pullCurY + pullNy;
              // Stop if we'd land on the caster
              if (pullNextX === unit.x && pullNextY === unit.y) break;
              if (isWalkableCombat(combat.floor.grid, pullNextX, pullNextY, combat.floor.width, combat.floor.height, combat.units) && !getUnitAtPosition(combat, pullNextX, pullNextY)) {
                pullCurX = pullNextX;
                pullCurY = pullNextY;
              } else {
                break;
              }
            }
            if (pullCurX !== pullFromXM || pullCurY !== pullFromYM) {
              target.x = pullCurX;
              target.y = pullCurY;
              pulledTo = { x: pullCurX, y: pullCurY, fromX: pullFromXM, fromY: pullFromYM };
            }
          }
        }

        // --- On-Hit Status: apply status effect from card definition (e.g. stun from death_grip) ---
        if (combatCard.onHitStatus && !targetDied && target.alive) {
          var ohsName = combatCard.onHitStatus.name || 'debuff';
          // --- Passive: cc_immunity — check if target is immune to this CC type ---
          var ohsCCBlocked = hasCCImmunity(target, ohsName);
          if (ohsCCBlocked) {
            effects.push({
              type: 'cc_immune',
              targetId: target.id,
              effect: ohsName,
              passive: 'cc_immunity',
            });
          } else {
            if (!target.statusEffects) target.statusEffects = [];
            var ohsEffect = {
              name: ohsName,
              type: combatCard.onHitStatus.type || 'debuff',
              duration: combatCard.onHitStatus.duration || 1,
              sourceId: unitId,
            };
            if (combatCard.onHitStatus.speedMult !== undefined) ohsEffect.speedMult = combatCard.onHitStatus.speedMult;
            if (combatCard.onHitStatus.cantAct) ohsEffect.cantAct = true;
            if (combatCard.onHitStatus.breaksOnDamage) ohsEffect.breaksOnDamage = true;
            if (combatCard.onHitStatus.tickDamage) ohsEffect.tickDamage = combatCard.onHitStatus.tickDamage;
            if (combatCard.onHitStatus.healReduction) ohsEffect.healingReduction = combatCard.onHitStatus.healReduction;
            if (combatCard.onHitStatus.armorReduction) ohsEffect.armorReduction = combatCard.onHitStatus.armorReduction;
            // --- Passive: escape_artist — cap CC duration to 1 turn for root/grapple/grab ---
            var escArtistOhs = getUnitCombatPassive(target, 'escape_artist');
            if (escArtistOhs && ohsEffect.duration > 1) {
              var escBreakTypes = escArtistOhs.ccBreakTypes || ['root', 'grapple', 'grab'];
              for (var escBI = 0; escBI < escBreakTypes.length; escBI++) {
                if (ohsName.indexOf(escBreakTypes[escBI]) !== -1) {
                  ohsEffect.duration = escArtistOhs.ccBreakMaxDuration || 1;
                  break;
                }
              }
            }
            target.statusEffects.push(ohsEffect);
            effects.push({
              type: 'status',
              targetId: target.id,
              effect: ohsEffect.name,
              duration: ohsEffect.duration,
              statusType: ohsEffect.type,
            });
          }
        }

        effects.push({
          type: 'damage',
          targetId: target.id,
          damage: damage + shieldAbsorbed,
          actualDamage: damage,
          shieldAbsorbed: shieldAbsorbed,
          isCrit: isCrit,
          targetHp: Math.max(0, target.hp),
          targetMaxHp: target.maxHp,
          targetDied: targetDied,
          knockedTo: knockedTo,
          pulledTo: pulledTo,
          thrownTo: thrownTo || null,
        });
      }

      // Necromancy skill XP: award 3 XP per use of a necromancy-tagged ability that hits
      if (unit.type === 'player' && unit.socketId && _abilityHitCount > 0 && combat.callbacks.addSkillXp) {
        var _abTags = combatCard.tags || [];
        if (_abTags.indexOf('necromancy') !== -1) {
          combat.callbacks.addSkillXp(unit.socketId, 'necromancy', 3);
        }
      }

      // --- Shatter Mind: destroy all clones and deal burst damage per clone to target ---
      if (combatCard.shattersClones) {
        var smClones = _playerClones.get(unitId);
        if (smClones && smClones.length > 0) {
          var smDmgPerClone = combatCard.damagePerClone || 20;
          var smBurstDmg = smClones.length * smDmgPerClone;
          // Apply to primary target
          var smTarget = getUnitAtPosition(combat, targetX, targetY);
          if (smTarget && smTarget.alive && smTarget.id !== unitId) {
            smTarget.hp -= smBurstDmg;
            var smDied = smTarget.hp <= 0;
            if (smDied) { smTarget.alive = false; smTarget.hp = 0; }
            effects.push({
              type: 'shatter_mind',
              targetId: smTarget.id,
              damage: smBurstDmg,
              clonesShattered: smClones.length,
              targetHp: Math.max(0, smTarget.hp),
              targetMaxHp: smTarget.maxHp,
              targetDied: smDied,
            });
            if (smDied) {
              handleUnitDeath(combat, smTarget.id, unitId);
            }
          }
          // Destroy all clones (fire distortion passive if applicable)
          var distortionPassive = getUnitCombatPassive(unit, 'on_clone_death_evasion');
          for (var smCI = 0; smCI < smClones.length; smCI++) {
            effects.push({ type: 'clone_destroyed', cloneId: smClones[smCI].cloneId, ownerId: unitId });
            // Remove clone unit from combat if it exists
            combat.units.delete(smClones[smCI].cloneId);
          }
          if (distortionPassive && smClones.length > 0) {
            if (!unit.statusEffects) unit.statusEffects = [];
            unit.statusEffects.push({
              name: 'evasion',
              type: 'buff',
              duration: distortionPassive.dodgeTurns || 1,
              dodgeChance: 1.0,
              sourceId: unitId,
            });
            effects.push({
              type: 'status',
              targetId: unitId,
              effect: 'evasion',
              duration: distortionPassive.dodgeTurns || 1,
              statusType: 'buff',
              passive: 'distortion',
            });
          }
          _playerClones.delete(unitId);
        }
      }
      break;
    }

    case 'healing': {
      var healTargets = [];
      if (combatCard.targetType === 'all_allies') {
        // Room-wide heal: hit all allies
        var allAllyIter = combat.units.values();
        var allAllyEntry = allAllyIter.next();
        while (!allAllyEntry.done) {
          var allAllyU = allAllyEntry.value;
          allAllyEntry = allAllyIter.next();
          if (allAllyU.type === unit.type && allAllyU.alive) {
            healTargets.push(allAllyU);
          }
        }
      } else if (aoeRadius > 0) {
        healTargets = getUnitsInRadius(combat, targetX, targetY, aoeRadius);
      } else {
        var healTarget = getUnitAtPosition(combat, targetX, targetY);
        if (healTarget) {
          healTargets.push(healTarget);
        }
      }

      // --- Support Passive: Critical Healing — chance for 2x heal ---
      var critHealPassive = getUnitCombatPassive(unit, 'critical_healing');
      var healIsCrit = false;
      if (critHealPassive && Math.random() < (critHealPassive.chance || 0.15)) {
        healIsCrit = true;
      }

      for (var hi = 0; hi < healTargets.length; hi++) {
        var ht = healTargets[hi];
        // Skip enemies for healing abilities
        if (ht.type !== unit.type && combatCard.targetType !== 'dead_ally') continue;

        var hScalingStat = combatCard.scalingStat || 'resolve';
        var hScalingFactor = combatCard.scalingFactor || 0.3;
        var hScalingValue = 5;
        if (hScalingStat === 'resolve') hScalingValue = rpgStats.resolve || 5;
        else if (hScalingStat === 'acumen') hScalingValue = acumen;
        else if (hScalingStat === 'ingenuity') hScalingValue = rpgStats.ingenuity || 5;
        else if (hScalingStat === 'finesse') hScalingValue = rpgStats.finesse || 5;
        var healAmount = (combatCard.baseHeal || 0) + hScalingValue * hScalingFactor;
        healAmount = Math.floor(healAmount);

        // --- Mortal Wounds debuff: reduce healing received by 25% ---
        if (ht.statusEffects) {
          for (var mwI = 0; mwI < ht.statusEffects.length; mwI++) {
            if (ht.statusEffects[mwI].name === 'mortal_wounds' && ht.statusEffects[mwI].healingReduction) {
              healAmount = Math.max(1, Math.floor(healAmount * (1 - ht.statusEffects[mwI].healingReduction)));
              break;
            }
          }
        }

        // --- Lily of the Field: at 3 lilies, next heal is +50% ---
        var lilyPassiveHeal = getUnitCombatPassive(unit, 'lily_of_the_field');
        if (lilyPassiveHeal) {
          var currentLiliesHeal = _lilyTokens.get(unitId) || 0;
          if (currentLiliesHeal >= 3) {
            healAmount = Math.floor(healAmount * 1.50);
            _lilyTokens.set(unitId, 0);
          }
        }

        // --- Support Passive: Triage Mastery — +25% healing on targets below 50% HP ---
        var triageMastery = getUnitCombatPassive(unit, 'triage_mastery');
        if (triageMastery && ht.hp / (ht.maxHp || 1) < (triageMastery.hpThreshold || 0.50)) {
          healAmount = Math.floor(healAmount * (1 + (triageMastery.healBonus || 0.25)));
        }

        // --- Support Passive: Critical Healing multiplier ---
        if (healIsCrit) {
          healAmount = Math.floor(healAmount * (critHealPassive.multiplier || 2.0));
        }

        // --- Support Passive: Dissonance — enemies near a dissonance holder have reduced healing ---
        // Check if any opponent of the heal target has dissonance in range
        var dissoCheckNearby = getUnitsInRadius(combat, ht.x, ht.y, 3);
        for (var disHi = 0; disHi < dissoCheckNearby.length; disHi++) {
          var disHUnit = dissoCheckNearby[disHi];
          if (disHUnit.type === ht.type || !disHUnit.alive) continue; // Skip allies of the heal target
          var disHPassive = getUnitCombatPassive(disHUnit, 'dissonance');
          if (disHPassive) {
            var disHRange = disHPassive.range || 3;
            if (manhattanDist(ht.x, ht.y, disHUnit.x, disHUnit.y) <= disHRange) {
              healAmount = Math.max(1, Math.floor(healAmount * (1 - (disHPassive.healReduction || 0.25))));
              break; // Only one dissonance applies
            }
          }
        }

        var oldHp = ht.hp;
        ht.hp = Math.min(ht.maxHp, ht.hp + healAmount);
        var actualHeal = ht.hp - oldHp;
        var overHealAmount = healAmount - actualHeal;

        effects.push({
          type: 'heal',
          targetId: ht.id,
          amount: actualHeal,
          targetHp: ht.hp,
          targetMaxHp: ht.maxHp,
          isCrit: healIsCrit,
        });

        // --- Support Passive: Overhealing Shield — excess healing becomes shield ---
        var overhealShieldPassive = getUnitCombatPassive(unit, 'overhealing_shield');
        if (!overhealShieldPassive) {
          // Also check the older 'overheal_shield' type (existing card on line 2078)
          overhealShieldPassive = getUnitCombatPassive(unit, 'overheal_shield');
        }
        if (overhealShieldPassive && overHealAmount > 0) {
          var maxShield = Math.floor(ht.maxHp * (overhealShieldPassive.maxPercent || 0.20));
          var currentShield = ht.momentumShield || 0;
          var shieldGain = Math.min(overHealAmount, maxShield - currentShield);
          if (shieldGain > 0) {
            ht.momentumShield = (ht.momentumShield || 0) + shieldGain;
            effects.push({
              type: 'shield_gain',
              targetId: ht.id,
              amount: shieldGain,
              totalShield: ht.momentumShield,
              passive: 'overhealing_shield',
            });
          }
        }

        // --- Support Passive: Purifying Touch — heals remove one debuff ---
        var purifyingTouch = getUnitCombatPassive(unit, 'purifying_touch');
        if (purifyingTouch && actualHeal > 0 && ht.statusEffects && ht.statusEffects.length > 0) {
          var removeCount = purifyingTouch.removeDebuffs || 1;
          for (var pti = ht.statusEffects.length - 1; pti >= 0 && removeCount > 0; pti--) {
            if (ht.statusEffects[pti].type === 'debuff') {
              var removedDebuff = ht.statusEffects.splice(pti, 1)[0];
              removeCount--;
              effects.push({
                type: 'debuff_removed',
                targetId: ht.id,
                debuffName: removedDebuff.name || 'unknown',
                passive: 'purifying_touch',
              });
            }
          }
        }

        // --- Support Passive: Healing Resonance — heals apply a HoT ---
        var healResonance = getUnitCombatPassive(unit, 'heal_resonance');
        if (healResonance && actualHeal > 0) {
          if (!ht.statusEffects) ht.statusEffects = [];
          ht.statusEffects.push({
            name: 'healing_resonance',
            type: 'buff',
            duration: healResonance.hotDuration || 5,
            healPerTurn: healResonance.hotValue || 3,
            sourceId: unitId,
          });
          effects.push({
            type: 'status',
            targetId: ht.id,
            effect: 'healing_resonance',
            duration: healResonance.hotDuration || 5,
            statusType: 'buff',
            passive: 'heal_resonance',
          });
        }

        // --- Support Passive: Sympathetic Healing — self-heals share to nearby allies ---
        var sympatheticHeal = getUnitCombatPassive(unit, 'sympathetic_healing');
        if (sympatheticHeal && actualHeal > 0 && ht.id === unitId) {
          var symHealAmt = Math.max(1, Math.floor(actualHeal * (sympatheticHeal.value || 0.30)));
          var symRange = sympatheticHeal.range || 2;
          var symAllies = getUnitsInRadius(combat, unit.x, unit.y, symRange);
          for (var sai = 0; sai < symAllies.length; sai++) {
            var symAlly = symAllies[sai];
            if (symAlly.id === unitId || symAlly.type !== unit.type || !symAlly.alive) continue;
            var symOldHp = symAlly.hp;
            symAlly.hp = Math.min(symAlly.maxHp, symAlly.hp + symHealAmt);
            var symActual = symAlly.hp - symOldHp;
            if (symActual > 0) {
              effects.push({
                type: 'heal',
                targetId: symAlly.id,
                amount: symActual,
                targetHp: symAlly.hp,
                targetMaxHp: symAlly.maxHp,
                passive: 'sympathetic_healing',
              });
            }
          }
        }

        // --- Support Passive: Heal Virus — healing spreads to nearby allies at 50% ---
        var healVirus = getUnitCombatPassive(unit, 'heal_virus');
        if (healVirus && actualHeal > 0 && ht.id !== unitId) {
          var virusHealAmt = Math.max(1, Math.floor(actualHeal * (healVirus.spreadPercent || 0.50)));
          var virusRange = healVirus.range || 2;
          var virusAllies = getUnitsInRadius(combat, ht.x, ht.y, virusRange);
          for (var vai = 0; vai < virusAllies.length; vai++) {
            var virusAlly = virusAllies[vai];
            // Skip the original target, the caster, and enemies
            if (virusAlly.id === ht.id || virusAlly.type !== unit.type || !virusAlly.alive) continue;
            var vOldHp = virusAlly.hp;
            virusAlly.hp = Math.min(virusAlly.maxHp, virusAlly.hp + virusHealAmt);
            var vActual = virusAlly.hp - vOldHp;
            if (vActual > 0) {
              effects.push({
                type: 'heal',
                targetId: virusAlly.id,
                amount: vActual,
                targetHp: virusAlly.hp,
                targetMaxHp: virusAlly.maxHp,
                passive: 'heal_virus',
              });
            }
          }
        }

        // --- Support Passive: Shared Vitality — 10% of healing received shared with party ---
        // Check the heal TARGET (ht) for this passive — it triggers when ht receives healing
        if (actualHeal > 0) {
          var svPassive = getUnitCombatPassive(ht, 'shared_vitality');
          if (svPassive) {
            var svPercent = svPassive.sharePercent || 0.10;
            var svRange = svPassive.range || 3;
            var svHealAmt = Math.max(1, Math.floor(actualHeal * svPercent));
            var svIter = combat.units.values();
            var svEntry = svIter.next();
            while (!svEntry.done) {
              var svAlly = svEntry.value;
              svEntry = svIter.next();
              if (svAlly.id === ht.id || svAlly.type !== ht.type || !svAlly.alive) continue;
              if (manhattanDist(ht.x, ht.y, svAlly.x, svAlly.y) > svRange) continue;
              var svOldHp = svAlly.hp;
              svAlly.hp = Math.min(svAlly.maxHp, svAlly.hp + svHealAmt);
              var svActual = svAlly.hp - svOldHp;
              if (svActual > 0) {
                effects.push({
                  type: 'heal',
                  targetId: svAlly.id,
                  amount: svActual,
                  targetHp: svAlly.hp,
                  targetMaxHp: svAlly.maxHp,
                  passive: 'shared_vitality',
                });
              }
            }
          }
        }
      }

      // --- Chain Heal bounce logic ---
      // If the ability has chainBounces, heal additional nearby allies with diminishing returns
      if (combatCard.chainBounces && combatCard.chainBounces > 0 && healTargets.length > 0) {
        var chainBaseHeal = (combatCard.baseHeal || 0);
        var hChainScalingStat = combatCard.scalingStat || 'resolve';
        var hChainScalingFactor = combatCard.scalingFactor || 0.3;
        var hChainScalingValue = 5;
        if (hChainScalingStat === 'resolve') hChainScalingValue = rpgStats.resolve || 5;
        else if (hChainScalingStat === 'acumen') hChainScalingValue = acumen;
        var chainFullHeal = Math.floor(chainBaseHeal + hChainScalingValue * hChainScalingFactor);
        var chainFalloff = 1 - (combatCard.chainHealFalloff || 0.40); // 0.40 falloff = 60% retained per bounce
        var chainBouncesLeft = combatCard.chainBounces;
        var chainCurrentHeal = chainFullHeal;
        var chainHealedIds = {};
        // Mark primary targets as already healed
        for (var chi = 0; chi < healTargets.length; chi++) {
          chainHealedIds[healTargets[chi].id] = true;
        }
        chainHealedIds[unitId] = true; // Don't bounce to caster

        // Last bounced target position (start from first heal target)
        var chainCenterX = healTargets[0].x;
        var chainCenterY = healTargets[0].y;

        for (var bounce = 0; bounce < chainBouncesLeft; bounce++) {
          chainCurrentHeal = Math.max(1, Math.floor(chainCurrentHeal * chainFalloff));
          // Find nearest unhit ally within range 4
          var chainNearby = getUnitsInRadius(combat, chainCenterX, chainCenterY, 4);
          var bestChainTarget = null;
          var bestChainDist = 999;
          for (var cni = 0; cni < chainNearby.length; cni++) {
            var cnAlly = chainNearby[cni];
            if (chainHealedIds[cnAlly.id]) continue;
            if (cnAlly.type !== unit.type || !cnAlly.alive) continue;
            var cnDist = manhattanDist(chainCenterX, chainCenterY, cnAlly.x, cnAlly.y);
            // Prefer lower HP allies for chain bounces (smart healing)
            var hpRatio = cnAlly.hp / (cnAlly.maxHp || 1);
            var cnPriority = cnDist + hpRatio * 2; // Lower is better
            if (cnPriority < bestChainDist) {
              bestChainDist = cnPriority;
              bestChainTarget = cnAlly;
            }
          }
          if (!bestChainTarget) break; // No valid bounce target

          chainHealedIds[bestChainTarget.id] = true;
          var cnOldHp = bestChainTarget.hp;
          bestChainTarget.hp = Math.min(bestChainTarget.maxHp, bestChainTarget.hp + chainCurrentHeal);
          var cnActualHeal = bestChainTarget.hp - cnOldHp;
          if (cnActualHeal > 0) {
            effects.push({
              type: 'heal',
              targetId: bestChainTarget.id,
              amount: cnActualHeal,
              targetHp: bestChainTarget.hp,
              targetMaxHp: bestChainTarget.maxHp,
              isChainBounce: true,
              bounceNumber: bounce + 1,
            });
          }

          // Move chain center to this target for next bounce
          chainCenterX = bestChainTarget.x;
          chainCenterY = bestChainTarget.y;
        }
      }

      // --- Dissonance aura — reduce healing on enemies (applied at heal-time check) ---
      // Note: Dissonance is checked in HoT ticks and also should reduce direct heals on enemies.
      // For enemy unit heals (e.g. enemy abilities that heal), check dissonance aura nearby.
      // This is handled in the HoT processing above and implicitly via the healing formula
      // for enemy units (enemies rarely have healing abilities in the current data).

      break;
    }

    case 'buff': {
      var buffTargets = [];
      if (combatCard.targetType === 'all_allies') {
        // Room-wide buff: hit all allies
        var allBuffIter = combat.units.values();
        var allBuffEntry = allBuffIter.next();
        while (!allBuffEntry.done) {
          var allBuffU = allBuffEntry.value;
          allBuffEntry = allBuffIter.next();
          if (allBuffU.type === unit.type && allBuffU.alive) {
            buffTargets.push(allBuffU);
          }
        }
      } else if (aoeRadius > 0) {
        buffTargets = getUnitsInRadius(combat, targetX, targetY, aoeRadius);
      } else {
        var buffTarget = getUnitAtPosition(combat, targetX, targetY);
        if (buffTarget) {
          buffTargets.push(buffTarget);
        }
      }

      // --- Mana Tide: restore mana to all allies instead of applying a standard buff ---
      if (combatCard.manaRestorePercent && combatCard.manaRestorePercent > 0) {
        for (var mti = 0; mti < buffTargets.length; mti++) {
          var mtAlly = buffTargets[mti];
          if (mtAlly.type !== unit.type || !mtAlly.alive) continue;
          if (mtAlly.combat && mtAlly.combat.mana !== undefined) {
            var mtMaxMana = mtAlly.combat.maxMana || 50;
            var mtRestoreAmt = Math.max(1, Math.floor(mtMaxMana * combatCard.manaRestorePercent));
            var mtOldMana = mtAlly.combat.mana;
            mtAlly.combat.mana = Math.min(mtMaxMana, mtAlly.combat.mana + mtRestoreAmt);
            var mtActualRestore = mtAlly.combat.mana - mtOldMana;
            if (mtActualRestore > 0) {
              effects.push({
                type: 'mana_restore',
                targetId: mtAlly.id,
                amount: mtActualRestore,
                targetMana: mtAlly.combat.mana,
                targetMaxMana: mtMaxMana,
              });
            }
          }
        }
        // Mana Tide is a pure mana restore, skip standard buff application
        break;
      }

      // --- Cleansing Wave: remove all debuffs from all allies instead of applying a buff ---
      if (combatCard.statusEffect === 'cleanse' && combatCard.targetType === 'all_allies') {
        for (var cwi = 0; cwi < buffTargets.length; cwi++) {
          var cwAlly = buffTargets[cwi];
          if (cwAlly.type !== unit.type || !cwAlly.alive) continue;
          if (cwAlly.statusEffects && cwAlly.statusEffects.length > 0) {
            var cwRemoved = [];
            var cwRemaining = [];
            for (var cwj = 0; cwj < cwAlly.statusEffects.length; cwj++) {
              if (cwAlly.statusEffects[cwj].type === 'debuff') {
                cwRemoved.push(cwAlly.statusEffects[cwj].name || 'unknown');
              } else {
                cwRemaining.push(cwAlly.statusEffects[cwj]);
              }
            }
            cwAlly.statusEffects = cwRemaining;
            if (cwRemoved.length > 0) {
              effects.push({
                type: 'cleanse',
                targetId: cwAlly.id,
                removedDebuffs: cwRemoved,
                removedCount: cwRemoved.length,
              });

              // --- Support Passive: Mass Dispel — when you remove buffs from enemy, remove all buffs nearby ---
              // Note: mass_dispel triggers on removing enemy buffs, not ally debuffs.
              // However, cleansing_wave removes ally debuffs. Mass_dispel is handled separately below.
            }
          }
        }
        // Cleansing wave is a pure cleanse, skip standard buff application
        break;
      }

      // =====================================================================
      // MMO-Inspired Active Ability Special Handlers (buff case)
      // =====================================================================

      var buffCardIdLower = (abilityCardId || '').toLowerCase();

      // --- Berserker Fury Transform: cleanse CC on activation ---
      if (buffCardIdLower === 'berserker_fury_transform' && combatCard.cleansesDebuffs) {
        if (unit.statusEffects && unit.statusEffects.length > 0) {
          var bftCleansed = [];
          var bftRemaining = [];
          for (var bftI = 0; bftI < unit.statusEffects.length; bftI++) {
            if (unit.statusEffects[bftI].type === 'debuff') {
              bftCleansed.push(unit.statusEffects[bftI].name || 'debuff');
            } else {
              bftRemaining.push(unit.statusEffects[bftI]);
            }
          }
          if (bftCleansed.length > 0) {
            unit.statusEffects = bftRemaining;
            effects.push({
              type: 'cleanse',
              targetId: unitId,
              removedDebuffs: bftCleansed,
              removedCount: bftCleansed.length,
              source: 'berserker_fury',
            });
          }
        }
        // berserker_fury also applies a standard buff (handled below in loop)
      }

      // --- Avatar of War: costs 20% of current HP on activation ---
      if (buffCardIdLower === 'avatar_of_war' && combatCard.hpCost) {
        var avatarHpCost = Math.max(1, Math.floor(unit.hp * combatCard.hpCost));
        unit.hp -= avatarHpCost;
        if (unit.hp < 1) unit.hp = 1; // Can't kill yourself
        effects.push({
          type: 'hp_cost',
          targetId: unitId,
          amount: avatarHpCost,
          targetHp: unit.hp,
          targetMaxHp: unit.maxHp,
          source: 'avatar_of_war',
        });
        // avatar_of_war also applies a standard buff (handled below in loop)
      }

      // --- Divine Invulnerability: set invulnerability tracking ---
      if (buffCardIdLower === 'divine_invulnerability') {
        _divineInvulnerability.set(unitId, combatCard.statusDuration || 2);
        // also applies standard buff below
      }

      // --- Fade: set aggro drop tracking ---
      if (buffCardIdLower === 'fade') {
        _fadeActive.set(unitId, combatCard.statusDuration || 2);
        // also applies standard buff below
      }

      // --- Power Word: Shield — grant momentum shield based on resolve ---
      if (buffCardIdLower === 'power_word_shield') {
        var pwsScalingStat = combatCard.scalingStat || 'resolve';
        var pwsScalingFactor = combatCard.scalingFactor || 0.5;
        var pwsStatVal = 5;
        if (pwsScalingStat === 'resolve') pwsStatVal = rpgStats.resolve || 5;
        else if (pwsScalingStat === 'acumen') pwsStatVal = acumen;
        var pwsShieldAmt = Math.max(1, Math.floor(40 + pwsStatVal * pwsScalingFactor));
        for (var pwsI = 0; pwsI < buffTargets.length; pwsI++) {
          var pwsTarget = buffTargets[pwsI];
          if (pwsTarget.type !== unit.type || !pwsTarget.alive) continue;
          pwsTarget.momentumShield = (pwsTarget.momentumShield || 0) + pwsShieldAmt;
          effects.push({
            type: 'shield_gain',
            targetId: pwsTarget.id,
            amount: pwsShieldAmt,
            totalShield: pwsTarget.momentumShield,
            source: 'power_word_shield',
          });
        }
        // also applies standard armorBoost buff below
      }

      // --- Intercept: set up damage redirect to protector ---
      if (buffCardIdLower === 'intercept' && buffTargets.length > 0) {
        for (var icpI = 0; icpI < buffTargets.length; icpI++) {
          var icpTarget = buffTargets[icpI];
          if (icpTarget.id === unitId || icpTarget.type !== unit.type || !icpTarget.alive) continue;
          _intercepts.set(icpTarget.id, {
            protectorId: unitId,
            turnsLeft: combatCard.statusDuration || 2,
            combat: combat,
          });
          effects.push({
            type: 'intercept_set',
            protectorId: unitId,
            protectedId: icpTarget.id,
            duration: combatCard.statusDuration || 2,
          });
          break; // Only intercept one ally
        }
        // Intercept leaps to target (handled by leapToTarget on card data + standard buff)
      }

      // --- Soulstone: pre-cast revive on ally ---
      if (buffCardIdLower === 'soulstone' && buffTargets.length > 0) {
        for (var ssI = 0; ssI < buffTargets.length; ssI++) {
          var ssTarget = buffTargets[ssI];
          if (ssTarget.type !== unit.type || !ssTarget.alive) continue;
          _soulstones.set(ssTarget.id, {
            sourceId: unitId,
            turnsLeft: combatCard.statusDuration || 5,
            reviveHpPercent: combatCard.reviveHpPercent || 0.30,
          });
          effects.push({
            type: 'soulstone_applied',
            targetId: ssTarget.id,
            sourceId: unitId,
            duration: combatCard.statusDuration || 5,
          });
          break; // Only one soulstone active
        }
        // also applies standard buff below
      }

      // --- Innervate: set up mana regen tracking ---
      if (buffCardIdLower === 'innervate' && buffTargets.length > 0) {
        for (var innI = 0; innI < buffTargets.length; innI++) {
          var innTarget = buffTargets[innI];
          if (innTarget.type !== unit.type || !innTarget.alive) continue;
          _innervates.set(innTarget.id, {
            sourceId: unitId,
            turnsLeft: combatCard.statusDuration || 4,
            manaPerTurn: combatCard.manaPerTurn || 5,
          });
          effects.push({
            type: 'innervate_applied',
            targetId: innTarget.id,
            sourceId: unitId,
            manaPerTurn: combatCard.manaPerTurn || 5,
            duration: combatCard.statusDuration || 4,
          });
          break; // Only one target
        }
        // also applies standard buff below
      }

      // --- Bloodlust: apply haste status to buff targets ---
      if (combatCard.hasteMult && combatCard.hasteMult > 0) {
        for (var blI = 0; blI < buffTargets.length; blI++) {
          var blTarget = buffTargets[blI];
          if (blTarget.type !== unit.type || !blTarget.alive) continue;
          if (!blTarget.statusEffects) blTarget.statusEffects = [];
          blTarget.statusEffects.push({
            name: 'bloodlust',
            type: 'buff',
            duration: combatCard.statusDuration || 3,
            speedMult: combatCard.hasteMult || 1.30,
            cooldownReduction: combatCard.cooldownReduction || 0.30,
            sourceId: unitId,
          });
          effects.push({
            type: 'status',
            targetId: blTarget.id,
            effect: 'bloodlust',
            duration: combatCard.statusDuration || 3,
            statusType: 'buff',
          });
        }
        // Bloodlust is fully handled, skip standard buff application
        break;
      }

      // --- Challenge Shout self-DR: if this buff card has selfDamageReduction ---
      if (combatCard.selfDamageReduction && combatCard.selfDamageReduction > 0) {
        if (!unit.statusEffects) unit.statusEffects = [];
        unit.statusEffects.push({
          name: 'self_damage_reduction',
          type: 'buff',
          duration: combatCard.statusDuration || 2,
          damageReduction: combatCard.selfDamageReduction,
          sourceId: unitId,
        });
        effects.push({
          type: 'status',
          targetId: unitId,
          effect: 'self_damage_reduction',
          duration: combatCard.statusDuration || 2,
          statusType: 'buff',
        });
      }

      // =====================================================================
      // End of MMO-Inspired Special Handlers
      // =====================================================================

      // --- Mass Barrier: grant momentum shield to all allies ---
      // mass_barrier has statusEffect: 'mass_barrier' and armorBoost, but also grants shield
      // Check template for shield_all effect type
      var massBarrierCard = (combatCard.statusEffect === 'mass_barrier');
      if (massBarrierCard) {
        var mbShieldPct = 0.20; // 20% of caster's max HP as shield
        // Check card effects for the shield_all entry to get the actual percent
        var templateEffects = (template.effects || []);
        for (var mbei = 0; mbei < templateEffects.length; mbei++) {
          if (templateEffects[mbei].type === 'shield_all' && templateEffects[mbei].hpPercent) {
            mbShieldPct = templateEffects[mbei].hpPercent;
            break;
          }
        }
        var mbShieldAmt = Math.max(1, Math.floor((unit.maxHp || 100) * mbShieldPct));
        for (var mbi = 0; mbi < buffTargets.length; mbi++) {
          var mbAlly = buffTargets[mbi];
          if (mbAlly.type !== unit.type || !mbAlly.alive) continue;
          mbAlly.momentumShield = (mbAlly.momentumShield || 0) + mbShieldAmt;
          effects.push({
            type: 'shield_gain',
            targetId: mbAlly.id,
            amount: mbShieldAmt,
            totalShield: mbAlly.momentumShield,
            source: 'mass_barrier',
          });
        }
        // mass_barrier also grants armorBoost as a standard buff, so continue to buff application below
      }

      // --- Aquatic: Tidal Shield — grant momentum shield, doubled on water tiles ---
      if (combatCard.shieldBase && combatCard.shieldBase > 0) {
        var tsBaseShield = combatCard.shieldBase;
        // Scale shield with resolve stat if caster is a player
        if (unit.type === 'player' && unit.combat) {
          var tsResolve = unit.combat.resolve || (unit.rpgStats && unit.rpgStats.resolve) || 5;
          tsBaseShield += Math.floor(tsResolve * 0.4);
        }
        // Water tile multiplier (tidal_shield: 2x on water)
        if (combatCard.waterTileShieldMultiplier && combat._isWaterFloor) {
          tsBaseShield = Math.floor(tsBaseShield * combatCard.waterTileShieldMultiplier);
        }
        for (var tsI = 0; tsI < buffTargets.length; tsI++) {
          var tsTarget = buffTargets[tsI];
          if (tsTarget.type !== unit.type || !tsTarget.alive) continue;
          tsTarget.momentumShield = (tsTarget.momentumShield || 0) + tsBaseShield;
          effects.push({
            type: 'shield_gain',
            targetId: tsTarget.id,
            amount: tsBaseShield,
            totalShield: tsTarget.momentumShield,
            source: combatCard.statusEffect || 'tidal_shield',
            waterBoosted: !!(combatCard.waterTileShieldMultiplier && combat._isWaterFloor),
          });
        }
        // tidal_shield also grants armorBoost as a standard buff, so continue to buff application below
      }

      // --- Support Passive: Buff Amplifier — +25% buff duration ---
      var buffAmplifier = getUnitCombatPassive(unit, 'buff_amplifier');
      var buffDurationMult = buffAmplifier ? (1 + (buffAmplifier.durationBonus || 0.25)) : 1;

      // --- Support Passive: Empowerment — damage buffs 15% more effective ---
      var empowermentPassive = getUnitCombatPassive(unit, 'empowerment');

      // --- Support Passive: Synergy — when 2+ buffs active, each buff 3% more effective ---
      var synergyPassive = getUnitCombatPassive(unit, 'synergy');

      for (var bi = 0; bi < buffTargets.length; bi++) {
        var bt = buffTargets[bi];
        // Skip enemies for ally-targeted buffs
        if (combatCard.targetType === 'ally' || combatCard.targetType === 'all_allies' || combatCard.targetType === 'self') {
          if (bt.type !== unit.type) continue;
        }

        var buffBaseDuration = combatCard.statusDuration || 3;
        if (buffAmplifier) {
          buffBaseDuration = Math.ceil(buffBaseDuration * buffDurationMult);
        }

        var buffEffect = {
          name: combatCard.statusEffect || combatCard.name || 'buff',
          duration: buffBaseDuration,
          type: 'buff',
          sourceId: unitId,
        };
        // Copy any stat modifiers from the card
        if (combatCard.statBoost) { buffEffect.statBoost = combatCard.statBoost; }
        if (combatCard.speedMult !== undefined) { buffEffect.speedMult = combatCard.speedMult; }
        if (combatCard.damageBoost !== undefined) {
          var dmgBoost = combatCard.damageBoost;
          // Empowerment: damage buffs are 15% more effective
          if (empowermentPassive && dmgBoost > 0) {
            dmgBoost = Math.ceil(dmgBoost * (1 + (empowermentPassive.buffBonus || 0.15)));
          }
          buffEffect.damageBoost = dmgBoost;
        }
        if (combatCard.armorBoost !== undefined) { buffEffect.armorBoost = combatCard.armorBoost; }
        if (combatCard.damageReduction !== undefined) { buffEffect.damageReduction = combatCard.damageReduction; }
        // Percentage-based armor boost (fortify: +30% armor, +50% if stationary)
        if (combatCard.armorBoostPercent) {
          var abpBaseArmor = (bt.combat && bt.combat.baseArmor) || 0;
          var abpBoost = Math.max(1, Math.floor(abpBaseArmor * combatCard.armorBoostPercent));
          buffEffect.armorBoost = (buffEffect.armorBoost || 0) + abpBoost;
          // Store the stationary bonus percentage for per-turn evaluation
          if (combatCard.stationaryArmorBoostPercent) {
            buffEffect.stationaryArmorBoostPercent = combatCard.stationaryArmorBoostPercent;
            buffEffect._baseArmorForPercent = abpBaseArmor;
            buffEffect._normalArmorBoostPercent = combatCard.armorBoostPercent;
          }
        }
        // MMO-specific buff flags
        if (combatCard.aoeOnAttack) { buffEffect.aoeOnAttack = true; }
        if (combatCard.invulnerable) { buffEffect.invulnerable = true; }
        if (combatCard.cantAttack) { buffEffect.cantAttack = true; }
        if (combatCard.cantMove) { buffEffect.cantMove = true; }
        if (combatCard.ccImmune) { buffEffect.ccImmune = combatCard.ccImmune; }
        if (combatCard.knockbackImmune) { buffEffect.knockbackImmune = true; }
        if (combatCard.damageTakenIncrease) { buffEffect.damageTakenIncrease = combatCard.damageTakenIncrease; }
        if (combatCard.threatDrop) { buffEffect.threatDrop = true; }
        if (combatCard.redirectDamage) { buffEffect.redirectDamage = true; }
        // Night Hunter: counterstrike stance fields
        if (combatCard.counterAttackPercent) { buffEffect.counterAttackPercent = combatCard.counterAttackPercent; }
        if (combatCard.counterOnMelee) { buffEffect.counterOnMelee = true; }
        // Aquatic: water tile shield multiplier
        if (combatCard.waterTileShieldMultiplier) { buffEffect.waterTileShieldMultiplier = combatCard.waterTileShieldMultiplier; }

        // --- Animal Form buff: apply form-specific bonuses ---
        if (combatCard.animalForm) {
          buffEffect.animalForm = combatCard.animalForm;

          // Shapeshifter's Mastery: +2 duration, +10% bonuses, handled at mana cost time too
          var shapeshifterMastery = getUnitCombatPassive(bt, 'shapeshifters_mastery');
          if (shapeshifterMastery) {
            buffEffect.duration += (shapeshifterMastery.formDurationBonus || 2);
            var smMult = 1 + (shapeshifterMastery.formBonusMult || 0.10);
            if (buffEffect.damageBoost) buffEffect.damageBoost = Math.ceil(buffEffect.damageBoost * smMult);
            if (buffEffect.armorBoost) buffEffect.armorBoost = Math.ceil(buffEffect.armorBoost * smMult);
          }

          // Remove any existing animal form (only one at a time)
          for (var afri = bt.statusEffects.length - 1; afri >= 0; afri--) {
            if (bt.statusEffects[afri].animalForm) {
              var oldForm = bt.statusEffects[afri];
              if (oldForm.maxHpBoost) {
                bt.maxHp -= oldForm.maxHpBoost;
                if (bt.hp > bt.maxHp) bt.hp = bt.maxHp;
              }
              bt.statusEffects.splice(afri, 1);
              effects.push({ type: 'animal_form_replaced', oldForm: oldForm.animalForm, newForm: combatCard.animalForm, targetId: bt.id });
              break;
            }
          }

          // Apply max HP modifications (bear: +50%, cat: -15%, etc.)
          if (combatCard.maxHpPercent) {
            var hpChange = Math.floor(bt.maxHp * Math.abs(combatCard.maxHpPercent));
            if (combatCard.maxHpPercent > 0) {
              buffEffect.maxHpBoost = hpChange;
              bt.maxHp += hpChange;
              bt.hp += hpChange; // Gain bonus HP immediately
            } else {
              buffEffect.maxHpBoost = -hpChange;
              bt.maxHp -= hpChange;
              if (bt.hp > bt.maxHp) bt.hp = bt.maxHp;
            }
          }

          // Copy form-specific properties to the buff effect
          if (combatCard.dodgeBonus !== undefined) buffEffect.dodgeBonus = combatCard.dodgeBonus;
          if (combatCard.critBonus !== undefined) buffEffect.critBonus = combatCard.critBonus;
          if (combatCard.damageReduction !== undefined) buffEffect.damageReduction = combatCard.damageReduction;
          if (combatCard.shellDR !== undefined) buffEffect.shellDR = combatCard.shellDR;
          if (combatCard.withdrawDR !== undefined) buffEffect.withdrawDR = combatCard.withdrawDR;
          if (combatCard.cantAttack !== undefined) buffEffect.cantAttack = combatCard.cantAttack;
          if (combatCard.cantMove !== undefined) buffEffect.cantMove = combatCard.cantMove;
          if (combatCard.hpRegenPercent !== undefined) buffEffect.hpRegenPercent = combatCard.hpRegenPercent;
          if (combatCard.revealHidden !== undefined) buffEffect.revealHidden = combatCard.revealHidden;
          if (combatCard.flyOver !== undefined) buffEffect.flyOver = combatCard.flyOver;
          if (combatCard.meleeImmune !== undefined) buffEffect.meleeImmune = combatCard.meleeImmune;
          if (combatCard.nightVision !== undefined) buffEffect.nightVision = combatCard.nightVision;
          if (combatCard.wallClimb !== undefined) buffEffect.wallClimb = combatCard.wallClimb;
          if (combatCard.shedSkin !== undefined) buffEffect.shedSkin = combatCard.shedSkin;
          if (combatCard.stealthBonus !== undefined) buffEffect.stealthBonus = combatCard.stealthBonus;
          if (combatCard.stealthDamageBonus !== undefined) buffEffect.stealthDamageBonus = combatCard.stealthDamageBonus;
          if (combatCard.packHunterBonus !== undefined) buffEffect.packHunterBonus = combatCard.packHunterBonus;
          if (combatCard.packHunterMax !== undefined) buffEffect.packHunterMax = combatCard.packHunterMax;
          if (combatCard.pounceStun !== undefined) buffEffect.pounceStun = combatCard.pounceStun;
          if (combatCard.prowlOnKill !== undefined) buffEffect.prowlOnKill = combatCard.prowlOnKill;
          if (combatCard.guardIntercept !== undefined) buffEffect.guardIntercept = combatCard.guardIntercept;
          if (combatCard.allyDamageAura !== undefined) buffEffect.allyDamageAura = combatCard.allyDamageAura;
          if (combatCard.allyHpRegenAura !== undefined) buffEffect.allyHpRegenAura = combatCard.allyHpRegenAura;
          if (combatCard.critDamageReduction !== undefined) buffEffect.critDamageReduction = combatCard.critDamageReduction;
          if (combatCard.bleedOnHit !== undefined) buffEffect.bleedOnHit = combatCard.bleedOnHit;
          if (combatCard.constrictDuration !== undefined) buffEffect.constrictDuration = combatCard.constrictDuration;
          if (combatCard.constrictDamage !== undefined) buffEffect.constrictDamage = combatCard.constrictDamage;
          if (combatCard.diveBombDamage !== undefined) buffEffect.diveBombDamage = combatCard.diveBombDamage;
          if (combatCard.diveBombStun !== undefined) buffEffect.diveBombStun = combatCard.diveBombStun;
          if (combatCard.webTrapRoot !== undefined) buffEffect.webTrapRoot = combatCard.webTrapRoot;
          if (combatCard.xpBonus !== undefined) buffEffect.xpBonus = combatCard.xpBonus;

          // Set form tracking on the unit
          bt.activeAnimalForm = combatCard.animalForm;
          bt._animalFormPounceReady = (combatCard.pounceStun !== undefined);
          bt._animalFormShedSkinUsed = false;

          // Bear form: taunt nearby enemies on transform
          if (combatCard.tauntAoe && combatCard.animalForm === 'bear') {
            var bearTauntRadius = 3;
            var bearNearby = getUnitsInRadius(combat, bt.x, bt.y, bearTauntRadius);
            for (var bti = 0; bti < bearNearby.length; bti++) {
              var btEnemy = bearNearby[bti];
              if (btEnemy.type === bt.type || !btEnemy.alive) continue;
              if (!btEnemy.statusEffects) btEnemy.statusEffects = [];
              btEnemy.statusEffects.push({
                name: 'taunted', duration: 2, type: 'debuff',
                sourceId: unitId, tauntTarget: unitId,
              });
              effects.push({ type: 'status', targetId: btEnemy.id, effect: 'taunted', duration: 2, statusType: 'debuff' });
            }
          }

          // Bat form: reveal hidden enemies/traps
          if (combatCard.revealHidden && (combatCard.animalForm === 'bat' || combatCard.animalForm === 'hound' || combatCard.animalForm === 'owl')) {
            effects.push({ type: 'reveal_hidden', unitId: bt.id, radius: combatCard.revealRadius || 6, form: combatCard.animalForm });
          }

          // Eagle form: reveal entire map
          if (combatCard.revealAll && combatCard.animalForm === 'eagle') {
            effects.push({ type: 'reveal_all', unitId: bt.id, form: 'eagle' });
          }

          // Serpent form: shed skin (will be used later)
          if (combatCard.shedSkin) {
            bt._animalFormShedSkinUsed = false;
          }
        }

        if (!bt.statusEffects) { bt.statusEffects = []; }

        // --- Synergy: count existing buffs and apply bonus if 2+ ---
        if (synergyPassive) {
          var existingBuffCount = 0;
          for (var sbi = 0; sbi < bt.statusEffects.length; sbi++) {
            if (bt.statusEffects[sbi].type === 'buff') existingBuffCount++;
          }
          if (existingBuffCount >= 2) {
            var synergyBonusPer = synergyPassive.bonusPerBuff || 0.03;
            var synergyMult = 1 + (existingBuffCount * synergyBonusPer);
            // Apply synergy multiplier to numeric buff values
            if (buffEffect.damageBoost) buffEffect.damageBoost = Math.ceil(buffEffect.damageBoost * synergyMult);
            if (buffEffect.armorBoost) buffEffect.armorBoost = Math.ceil(buffEffect.armorBoost * synergyMult);
            // Extend duration slightly: +1 turn per 3 existing buffs
            buffEffect.duration += Math.floor(existingBuffCount / 3);
          }
        }

        bt.statusEffects.push(buffEffect);

        effects.push({
          type: 'status',
          targetId: bt.id,
          effect: buffEffect.name,
          duration: buffEffect.duration,
          statusType: 'buff',
        });

        // --- Support Passive: Shield of Faith — buffing an ally grants 5% DR ---
        var shieldOfFaith = getUnitCombatPassive(unit, 'shield_of_faith');
        if (shieldOfFaith && bt.id !== unitId) {
          bt.statusEffects.push({
            name: 'shield_of_faith',
            type: 'buff',
            duration: shieldOfFaith.duration || 3,
            damageReduction: shieldOfFaith.damageReduction || 0.05,
            sourceId: unitId,
          });
          effects.push({
            type: 'status',
            targetId: bt.id,
            effect: 'shield_of_faith',
            duration: shieldOfFaith.duration || 3,
            statusType: 'buff',
            passive: 'shield_of_faith',
          });
        }
      }

      // TauntAoe: apply 'taunted' debuff to all nearby enemies, forcing them to target caster
      if (combatCard.tauntAoe) {
        var tauntRadius = aoeRadius || 3;
        var nearbyEnemies = getUnitsInRadius(combat, unit.x, unit.y, tauntRadius);
        for (var ti = 0; ti < nearbyEnemies.length; ti++) {
          var tEnemy = nearbyEnemies[ti];
          if (tEnemy.type === unit.type || !tEnemy.alive) continue; // Skip allies
          if (!tEnemy.statusEffects) { tEnemy.statusEffects = []; }
          tEnemy.statusEffects.push({
            name: 'taunted',
            duration: combatCard.statusDuration || 2,
            type: 'debuff',
            sourceId: unitId,
            tauntTarget: unitId, // AI reads this to force target selection
          });
          effects.push({
            type: 'status',
            targetId: tEnemy.id,
            effect: 'taunted',
            duration: combatCard.statusDuration || 2,
            statusType: 'debuff',
          });
        }
      }
      break;
    }

    case 'debuff': {
      var debuffTargets = [];
      if (aoeRadius > 0) {
        debuffTargets = getUnitsInRadius(combat, targetX, targetY, aoeRadius);
      } else {
        var debuffTarget = getUnitAtPosition(combat, targetX, targetY);
        if (debuffTarget) {
          debuffTargets.push(debuffTarget);
        }
      }

      for (var dbi = 0; dbi < debuffTargets.length; dbi++) {
        var dbt = debuffTargets[dbi];

        // --- 3B: Iron Will / Debuff Resistance ---
        var debuffResistChance = getUnitCombatPassiveTotal(dbt, 'debuff_resist');
        if (debuffResistChance > 0 && Math.random() < debuffResistChance) {
          effects.push({
            type: 'debuff_resisted',
            targetId: dbt.id,
            effect: combatCard.statusEffect || combatCard.name || 'debuff',
            passive: 'iron_will',
          });
          continue; // Skip this target — they resisted
        }

        var debuffBaseDuration = combatCard.statusDuration || 3;

        // --- Support Passive: Hex Master — +20% debuff duration ---
        var hexMasterPassive = getUnitCombatPassive(unit, 'hex_master');
        if (hexMasterPassive) {
          debuffBaseDuration = Math.ceil(debuffBaseDuration * (1 + (hexMasterPassive.durationBonus || 0.20)));
        }

        // --- Support Passive: Ironclad — CC duration reduction on target ---
        var ironcladTarget = getUnitCombatPassive(dbt, 'ironclad');
        if (ironcladTarget) {
          debuffBaseDuration = Math.max(1, Math.round(debuffBaseDuration * (1 - (ironcladTarget.ccReduction || 0.40))));
        }

        var debuffEffect = {
          name: combatCard.statusEffect || combatCard.name || 'debuff',
          duration: debuffBaseDuration,
          type: 'debuff',
          sourceId: unitId,
        };
        if (combatCard.tickDamage !== undefined) { debuffEffect.tickDamage = combatCard.tickDamage; }
        if (combatCard.speedMult !== undefined) { debuffEffect.speedMult = combatCard.speedMult; }
        if (combatCard.damageReduction !== undefined) { debuffEffect.damageReduction = combatCard.damageReduction; }
        if (combatCard.armorReduction !== undefined) { debuffEffect.armorReduction = combatCard.armorReduction; }
        // Challenge Shout / Polymorph / taunt debuffs: add taunt target and special flags
        if (combatCard.tauntAoe) { debuffEffect.tauntTarget = unitId; }
        if (combatCard.onHitStatus && combatCard.onHitStatus.cantAct) { debuffEffect.cantAct = true; }
        if (combatCard.onHitStatus && combatCard.onHitStatus.breaksOnDamage) { debuffEffect.breaksOnDamage = true; }

        // --- Passive: cc_immunity — full immunity to specific CC types ---
        var ccImmunityPassive = getUnitCombatPassive(dbt, 'cc_immunity');
        if (ccImmunityPassive) {
          var ccImmuneType = ccImmunityPassive.ccType || '';
          var debuffName = debuffEffect.name || '';
          var ccImmune = false;
          // cc_immunity 'stun': immune to stunned, knockdown
          if (ccImmuneType === 'stun' && (debuffName === 'stunned' || debuffName === 'knockdown')) {
            ccImmune = true;
          }
          // cc_immunity 'root_slow': immune to rooted, slowed
          if (ccImmuneType === 'root_slow' && (debuffName === 'rooted' || debuffName === 'slowed')) {
            ccImmune = true;
          }
          // cc_immunity 'knockback': immune to knockback (handled in knockback code already, this is a safety net)
          if (ccImmuneType === 'knockback' && debuffName === 'knockback') {
            ccImmune = true;
          }
          if (ccImmune) {
            effects.push({
              type: 'debuff_resisted',
              targetId: dbt.id,
              effect: debuffName,
              passive: 'cc_immunity',
              immuneType: ccImmuneType,
            });
            continue; // Skip this target — they are immune
          }
        }

        // --- Grappler Passive: wrestlers_resilience — 20% chance to resist stuns ---
        var wrResilienceDebuff = getUnitCombatPassive(dbt, 'wrestlers_resilience');
        if (wrResilienceDebuff && (debuffEffect.name === 'stunned' || debuffEffect.name === 'knockdown')) {
          if (Math.random() < (wrResilienceDebuff.stunResist || 0.20)) {
            effects.push({
              type: 'debuff_resisted',
              targetId: dbt.id,
              effect: debuffEffect.name,
              passive: 'wrestlers_resilience',
            });
            continue; // Skip this target — they resisted the stun
          }
        }

        if (!dbt.statusEffects) { dbt.statusEffects = []; }
        dbt.statusEffects.push(debuffEffect);

        effects.push({
          type: 'status',
          targetId: dbt.id,
          effect: debuffEffect.name,
          duration: debuffEffect.duration,
          statusType: 'debuff',
        });

        // --- Grappler: selfImmobilize — caster also gets immobilized for the debuff duration ---
        if (combatCard.selfImmobilize) {
          if (!unit.statusEffects) unit.statusEffects = [];
          var selfImmoEffect = {
            name: 'self_immobilized',
            type: 'debuff',
            duration: debuffBaseDuration,
            speedMult: 0,
            sourceId: unitId,
            linkedTargetId: dbt.id, // track which target this grapple is linked to
          };
          if (combatCard.selfCantAttack) { selfImmoEffect.cantAct = true; }
          if (combatCard.breaksOnDamageToSelf) { selfImmoEffect.breaksOnDamageToSelf = true; selfImmoEffect.linkedDebuffName = debuffEffect.name; }
          unit.statusEffects.push(selfImmoEffect);
          effects.push({
            type: 'status',
            targetId: unitId,
            effect: 'self_immobilized',
            duration: debuffBaseDuration,
            statusType: 'debuff',
            source: 'grapple_self',
          });
        }

        // --- Night Hunter: antiStealth — remove stealth/invisibility from target, prevent re-stealthing ---
        if (combatCard.antiStealth && dbt.statusEffects) {
          for (var asI = dbt.statusEffects.length - 1; asI >= 0; asI--) {
            var asSE = dbt.statusEffects[asI];
            if (asSE.name === 'stealthed' || asSE.name === 'invisible' || asSE.name === 'prowl_stealth') {
              dbt.statusEffects.splice(asI, 1);
              effects.push({ type: 'status_removed', targetId: dbt.id, effect: asSE.name, source: 'anti_stealth' });
            }
          }
          // Mark the debuff as anti-stealth so stealth can't be applied while it's active
          debuffEffect.antiStealth = true;
        }

        // --- Night Hunter: damageAmpFromCaster — track caster on debuff for damage amplification ---
        if (combatCard.damageAmpFromCaster) {
          debuffEffect.damageAmpFromCaster = combatCard.damageAmpFromCaster;
          debuffEffect.damageAmpSourceId = unitId;
        }

        // --- Night Hunter: revealPosition — mark target as always visible ---
        if (combatCard.revealPosition) {
          debuffEffect.revealPosition = true;
          dbt._revealed = true;
          dbt._revealedBy = unitId;
          effects.push({ type: 'reveal_position', targetId: dbt.id, sourceId: unitId, duration: debuffBaseDuration });
        }

        // --- Support Passive: Contagion — 30% chance debuffs spread to nearby enemy ---
        var contagionPassive = getUnitCombatPassive(unit, 'contagion');
        if (contagionPassive && Math.random() < (contagionPassive.spreadChance || 0.30)) {
          var ctRange = contagionPassive.range || 2;
          var ctNearby = getUnitsInRadius(combat, dbt.x, dbt.y, ctRange);
          for (var cti = 0; cti < ctNearby.length; cti++) {
            var ctEnemy = ctNearby[cti];
            if (ctEnemy.id === dbt.id || ctEnemy.type === unit.type || !ctEnemy.alive) continue;
            // Only spread to one additional target
            if (!ctEnemy.statusEffects) ctEnemy.statusEffects = [];
            var spreadDebuff = {
              name: debuffEffect.name,
              duration: Math.max(1, debuffBaseDuration - 1), // Spread lasts 1 turn less
              type: 'debuff',
              sourceId: unitId,
            };
            if (debuffEffect.tickDamage) spreadDebuff.tickDamage = debuffEffect.tickDamage;
            if (debuffEffect.speedMult !== undefined) spreadDebuff.speedMult = debuffEffect.speedMult;
            if (debuffEffect.damageReduction !== undefined) spreadDebuff.damageReduction = debuffEffect.damageReduction;
            if (debuffEffect.armorReduction !== undefined) spreadDebuff.armorReduction = debuffEffect.armorReduction;
            ctEnemy.statusEffects.push(spreadDebuff);
            effects.push({
              type: 'status',
              targetId: ctEnemy.id,
              effect: spreadDebuff.name,
              duration: spreadDebuff.duration,
              statusType: 'debuff',
              passive: 'contagion',
            });
            break; // Spread to only one additional target
          }
        }

        // --- Support Passive: Mass Dispel — when you apply a debuff to an enemy with buffs,
        // strip one buff from primary target. If mass_dispel passive is present, also strip
        // all buffs from nearby enemies within range. 30-turn cooldown. ---
        var mdPassive = getUnitCombatPassive(unit, 'mass_dispel');
        if (mdPassive && !unit._massDispelCooldown) {
          // Check if target has any buffs to strip
          if (dbt.statusEffects && dbt.statusEffects.length > 0) {
            var mdHadBuff = false;
            var mdStripped = [];
            var mdRemainingEffects = [];
            for (var mdei = 0; mdei < dbt.statusEffects.length; mdei++) {
              if (dbt.statusEffects[mdei].type === 'buff') {
                mdHadBuff = true;
                mdStripped.push(dbt.statusEffects[mdei].name || 'buff');
              } else {
                mdRemainingEffects.push(dbt.statusEffects[mdei]);
              }
            }
            if (mdHadBuff) {
              dbt.statusEffects = mdRemainingEffects;
              effects.push({
                type: 'dispel',
                targetId: dbt.id,
                removedBuffs: mdStripped,
                passive: 'mass_dispel',
              });

              // Spread to nearby enemies
              var mdRange = mdPassive.range || 2;
              var mdNearby = getUnitsInRadius(combat, dbt.x, dbt.y, mdRange);
              for (var mdni = 0; mdni < mdNearby.length; mdni++) {
                var mdEnemy = mdNearby[mdni];
                if (mdEnemy.id === dbt.id || mdEnemy.type === unit.type || !mdEnemy.alive) continue;
                if (!mdEnemy.statusEffects || mdEnemy.statusEffects.length === 0) continue;
                var mdEnemyStripped = [];
                var mdEnemyRemaining = [];
                for (var mdej = 0; mdej < mdEnemy.statusEffects.length; mdej++) {
                  if (mdEnemy.statusEffects[mdej].type === 'buff') {
                    mdEnemyStripped.push(mdEnemy.statusEffects[mdej].name || 'buff');
                  } else {
                    mdEnemyRemaining.push(mdEnemy.statusEffects[mdej]);
                  }
                }
                if (mdEnemyStripped.length > 0) {
                  mdEnemy.statusEffects = mdEnemyRemaining;
                  effects.push({
                    type: 'dispel',
                    targetId: mdEnemy.id,
                    removedBuffs: mdEnemyStripped,
                    passive: 'mass_dispel',
                  });
                }
              }

              // Set cooldown (30 turns)
              unit._massDispelCooldown = mdPassive.cooldown || 30;
            }
          }
        }
      }

      // --- Challenge Shout self-DR (debuff case): caster gains damage reduction ---
      if (combatCard.selfDamageReduction && combatCard.selfDamageReduction > 0) {
        if (!unit.statusEffects) unit.statusEffects = [];
        unit.statusEffects.push({
          name: 'challenge_shout_dr',
          type: 'buff',
          duration: combatCard.statusDuration || 2,
          damageReduction: combatCard.selfDamageReduction,
          sourceId: unitId,
        });
        effects.push({
          type: 'status',
          targetId: unitId,
          effect: 'challenge_shout_dr',
          duration: combatCard.statusDuration || 2,
          statusType: 'buff',
        });
      }
      break;
    }

    case 'tile_effect': {
      var tileType = combatCard.tileEffect;
      if (!tileType) {
        // No tile effect type specified on card, do nothing
        break;
      }

      // --- Ground Zone / Totem Cards: add to combat.groundZones instead of standard tile logic ---
      var isGroundZone = (tileType === 'HEALING_TOTEM' || tileType === 'FIRE_TOTEM' || tileType === 'EARTHEN_TOTEM' || tileType === 'SALTED_EARTH');
      if (isGroundZone && combat.groundZones) {
        var gzDuration = combatCard.tileDuration || 4;
        var gzRadius = aoeRadius || 2;
        var gzDef = {
          type: tileType === 'HEALING_TOTEM' ? 'healing_totem' :
                tileType === 'FIRE_TOTEM' ? 'fire_totem' :
                tileType === 'EARTHEN_TOTEM' ? 'earthen_ward_totem' : 'salted_earth',
          x: targetX,
          y: targetY,
          radius: gzRadius,
          turnsLeft: gzDuration,
          sourceId: unitId,
          ownerType: unit.type,
        };
        if (tileType === 'HEALING_TOTEM') {
          gzDef.healPerTurn = Math.max(1, Math.floor((unit.maxHp || 100) * (combatCard.tileHealPercent || 0.03)));
        } else if (tileType === 'FIRE_TOTEM') {
          gzDef.damagePerTurn = combatCard.tileDamage || 12;
        } else if (tileType === 'EARTHEN_TOTEM') {
          gzDef.drPercent = combatCard.wardDamageReduction || 0.10;
        } else if (tileType === 'SALTED_EARTH') {
          gzDef.damagePerTurn = combatCard.tileDamage || 8;
        }
        combat.groundZones.push(gzDef);
        effects.push({
          type: 'ground_zone_placed',
          zoneType: gzDef.type,
          x: targetX,
          y: targetY,
          radius: gzRadius,
          duration: gzDuration,
        });
        break;
      }

      if (aoeRadius > 0) {
        // Place tile effects in a diamond (manhattan distance) area
        for (var tx = targetX - aoeRadius; tx <= targetX + aoeRadius; tx++) {
          for (var ty = targetY - aoeRadius; ty <= targetY + aoeRadius; ty++) {
            if (manhattanDist(tx, ty, targetX, targetY) <= aoeRadius) {
              var aoeResults = combatTiles.createTileEffect(combat, tx, ty, tileType, unitId);
              var aoeChainReactions = [];
              for (var ari = 0; ari < aoeResults.length; ari++) {
                var ar = aoeResults[ari];
                if (ar.action) {
                  aoeChainReactions.push(ar);
                }
              }
              effects.push({
                type: 'tile_effect',
                x: tx,
                y: ty,
                tileType: tileType,
                chainReactions: aoeChainReactions,
              });
            }
          }
        }
      } else {
        var tileResults = combatTiles.createTileEffect(combat, targetX, targetY, tileType, unitId);

        // --- TURRET bonuses: scale turret from equipped passive cards + gnome racial ---
        if (tileType === 'TURRET' && tileResults.length > 0) {
          var turretEffect = null;
          for (var tfi = 0; tfi < tileResults.length; tfi++) {
            if (tileResults[tfi].type === 'TURRET') { turretEffect = tileResults[tfi]; break; }
          }
          if (turretEffect) {
            // Summon bonuses from equipped passive cards (turret_upgrade, master_engineer, etc.)
            var summonDmgBonus = getUnitCombatPassiveTotal(unit, 'summon_damage_bonus');
            var summonHpBonus  = getUnitCombatPassiveTotal(unit, 'summon_hp_bonus');
            // Also check card effects array for summon_damage_bonus / summon_hp_bonus
            summonDmgBonus += getCardEffectTotal(unit, 'summon_damage_bonus');
            summonHpBonus  += getCardEffectTotal(unit, 'summon_hp_bonus');

            // Gnome racial bonus: Tinker Savant — +50% turret damage, +20% HP, +1 duration
            var isGnomeTurret  = (unit.race === 'gnome');
            var gnomeDmgBonus  = isGnomeTurret ? 0.50 : 0;
            var gnomeHpBonus   = isGnomeTurret ? 0.20 : 0;
            var gnomeDurBonus  = isGnomeTurret ? 1    : 0;

            var baseTurrDmg = combatTiles.TILE_EFFECTS.TURRET.damage || 6;
            var baseTurrHp  = combatTiles.TILE_EFFECTS.TURRET.hp     || 20;
            turretEffect.damage    = Math.max(1, Math.round(baseTurrDmg * (1 + summonDmgBonus + gnomeDmgBonus)));
            turretEffect.currentHp = Math.round(baseTurrHp  * (1 + summonHpBonus  + gnomeHpBonus));
            turretEffect.maxHp     = turretEffect.currentHp;
            turretEffect.range     = combatTiles.TILE_EFFECTS.TURRET.range || 2;
            if (gnomeDurBonus > 0 && turretEffect.duration !== -1 && turretEffect.duration > 0) {
              turretEffect.duration += gnomeDurBonus;
            }
            // Apply turret-specific affixes from the card instance
            if (card.affixes) {
              for (var tafi = 0; tafi < card.affixes.length; tafi++) {
                var taff = card.affixes[tafi];
                if (!taff.effect) continue;
                if (taff.effect.type === 'turret_extra_target') {
                  turretEffect.targets = (turretEffect.targets || 1) + Math.round(taff.effect.value * taff.stacks);
                } else if (taff.effect.type === 'turret_lifedrain') {
                  turretEffect.lifedrain = (turretEffect.lifedrain || 0) + (taff.effect.value * taff.stacks);
                }
              }
            }
            // Cap targets at 3
            if (turretEffect.targets > 3) turretEffect.targets = 3;

            // --- Wire card.effects[] elemental + combat effects into turret instance ---
            // card.effects[] already merges: base effects + affix effects (xstacks) + mutations.
            var _turrElemBonuses = [];
            var _turrCritBonus   = 0;
            var _cardEffects     = card.effects || [];
            for (var _cef = 0; _cef < _cardEffects.length; _cef++) {
              var _ef = _cardEffects[_cef];
              if (!_ef || !_ef.type) continue;
              if (_ef.type === 'add_flat_damage') {
                _turrElemBonuses.push({
                  bonusType:  'flat',
                  element:    _ef.element || 'physical',
                  value:      typeof _ef.value === 'number' ? Math.round(_ef.value) : 0,
                  slowChance: _ef.slow_chance || 0,
                  undeadMult: _ef.undead_mult || 1,
                });
              } else if (_ef.type === 'add_dot') {
                _turrElemBonuses.push({
                  bonusType: 'dot',
                  element:   _ef.element || 'poison',
                  value:     typeof _ef.value === 'number' ? _ef.value : 4,
                  duration:  _ef.duration || 3,
                });
              } else if (_ef.type === 'random_element_convert') {
                var _rndEls = ['fire', 'ice', 'lightning', 'poison', 'holy', 'shadow'];
                var _rndEl  = _rndEls[Math.floor(Math.random() * _rndEls.length)];
                // store as a base element override — processed in combat-tiles
                turretEffect.elementOverride = _rndEl;
              } else if (_ef.type === 'crit_bonus') {
                _turrCritBonus += typeof _ef.value === 'number' ? _ef.value : 0;
              } else if (_ef.type === 'lifesteal') {
                // Stack into existing lifedrain
                turretEffect.lifedrain = (turretEffect.lifedrain || 0) + (typeof _ef.value === 'number' ? _ef.value : 0);
              } else if (_ef.type === 'on_hit_bleed') {
                if (!turretEffect.onHitEffects) turretEffect.onHitEffects = [];
                turretEffect.onHitEffects.push({ type: 'bleed', chance: _ef.chance || 0.25, duration: _ef.duration || 2, tickDamage: _ef.tickDamage || 4 });
              } else if (_ef.type === 'on_hit_burn') {
                if (!turretEffect.onHitEffects) turretEffect.onHitEffects = [];
                turretEffect.onHitEffects.push({ type: 'burn', chance: _ef.chance || 0.25 });
              } else if (_ef.type === 'on_hit_slow') {
                if (!turretEffect.onHitEffects) turretEffect.onHitEffects = [];
                turretEffect.onHitEffects.push({ type: 'slow', chance: _ef.chance || 0.25 });
              } else if (_ef.type === 'on_hit_poison') {
                if (!turretEffect.onHitEffects) turretEffect.onHitEffects = [];
                turretEffect.onHitEffects.push({ type: 'poison', chance: _ef.chance || 0.20 });
              } else if (_ef.type === 'on_hit_stun') {
                if (!turretEffect.onHitEffects) turretEffect.onHitEffects = [];
                turretEffect.onHitEffects.push({ type: 'stun', chance: _ef.chance || 0.15, duration: _ef.duration || 1 });
              } else if (_ef.type === 'knockback_on_hit') {
                if (!turretEffect.onHitEffects) turretEffect.onHitEffects = [];
                turretEffect.onHitEffects.push({ type: 'knockback', tiles: _ef.tiles || 1 });
              } else if (_ef.type === 'push_on_hit') {
                if (!turretEffect.onHitEffects) turretEffect.onHitEffects = [];
                turretEffect.onHitEffects.push({ type: 'push', tiles: _ef.tiles || 2 });
              } else if (_ef.type === 'pull_on_hit') {
                if (!turretEffect.onHitEffects) turretEffect.onHitEffects = [];
                turretEffect.onHitEffects.push({ type: 'pull', tiles: _ef.tiles || 1 });
              } else if (_ef.type === 'mark_on_hit') {
                if (!turretEffect.onHitEffects) turretEffect.onHitEffects = [];
                turretEffect.onHitEffects.push({ type: 'mark', chance: _ef.chance || 0.20, damageTakenBonus: _ef.damageTakenBonus || 0.10 });
              } else if (_ef.type === 'mana_drain_on_hit') {
                if (!turretEffect.onHitEffects) turretEffect.onHitEffects = [];
                turretEffect.onHitEffects.push({ type: 'mana_drain', value: _ef.value || 4 });
              } else if (_ef.type === 'wound_on_hit') {
                if (!turretEffect.onHitEffects) turretEffect.onHitEffects = [];
                turretEffect.onHitEffects.push({ type: 'wound', healing_reduction: _ef.healing_reduction || 0.30 });
              } else if (_ef.type === 'pierce_on_hit') {
                turretEffect.pierceTargets = (turretEffect.pierceTargets || 0) + (_ef.targets || 1);
              } else if (_ef.type === 'chain_on_hit') {
                // Take the higher bounce count if multiple chain affixes
                if ((_ef.bounces || 1) > (turretEffect.chainBounces || 0)) {
                  turretEffect.chainBounces = _ef.bounces || 1;
                  turretEffect.chainFalloff = _ef.damageFalloff || 0.6;
                }
              }
            }
            if (_turrElemBonuses.length > 0) turretEffect.elementBonuses = _turrElemBonuses;
            if (_turrCritBonus > 0)          turretEffect.critChance      = Math.min(_turrCritBonus, 0.75);
          }
        }

        // --- HEAL_TURRET / SHIELD_TURRET bonuses: HP scaling + gnome racial ---
        if ((tileType === 'HEAL_TURRET' || tileType === 'SHIELD_TURRET') && tileResults.length > 0) {
          var structEffect = null;
          for (var sfi = 0; sfi < tileResults.length; sfi++) {
            if (tileResults[sfi].type === tileType) { structEffect = tileResults[sfi]; break; }
          }
          if (structEffect) {
            var sSummonHpBonus = getUnitCombatPassiveTotal(unit, 'summon_hp_bonus') + getCardEffectTotal(unit, 'summon_hp_bonus');
            var sGnomeHpBonus  = (unit.race === 'gnome') ? 0.20 : 0;
            var sGnomeDurBonus = (unit.race === 'gnome') ? 1    : 0;
            var sBaseHp = combatTiles.TILE_EFFECTS[tileType].hp;
            structEffect.currentHp = Math.round(sBaseHp * (1 + sSummonHpBonus + sGnomeHpBonus));
            structEffect.maxHp     = structEffect.currentHp;
            if (sGnomeDurBonus > 0 && structEffect.duration > 0) {
              structEffect.duration += sGnomeDurBonus;
            }
            // Gnome racial: +50% heal or +50% shield pulse
            if (unit.race === 'gnome') {
              if (tileType === 'HEAL_TURRET' && structEffect.heal) {
                structEffect.heal = Math.round(structEffect.heal * 1.5);
              } else if (tileType === 'SHIELD_TURRET' && structEffect.shield) {
                structEffect.shield = Math.round(structEffect.shield * 1.5);
              }
            }
            // automated_triage passive: +50% heal bonus (flat and percent)
            var triageBonus = getCardEffectTotal(unit, 'automated_triage');
            if (triageBonus > 0 && tileType === 'HEAL_TURRET') {
              if (structEffect.heal)        structEffect.heal        = Math.round(structEffect.heal        * (1 + 0.50 * triageBonus));
              if (structEffect.healPercent) structEffect.healPercent = Math.round(structEffect.healPercent * (1 + 0.50 * triageBonus) * 1000) / 1000;
            }
            // turret_fortify_bonus affix (SHIELD_TURRET) + turret_extra_target affix (HEAL_TURRET multi-heal)
            if (card.affixes) {
              for (var safi = 0; safi < card.affixes.length; safi++) {
                var saff = card.affixes[safi];
                if (!saff.effect) continue;
                if (saff.effect.type === 'turret_fortify_bonus' && tileType === 'SHIELD_TURRET' && structEffect.shield) {
                  structEffect.shield = Math.round(structEffect.shield * (1 + saff.effect.value * saff.stacks));
                } else if (saff.effect.type === 'turret_extra_target' && tileType === 'HEAL_TURRET') {
                  // Heal more allies per tick (default 1; each extra_target affix adds 1)
                  structEffect.targets = Math.min((structEffect.targets || 1) + Math.round(saff.effect.value * saff.stacks), 4);
                }
              }
            }
          }
        }

        var chainReactions = [];
        for (var tri = 0; tri < tileResults.length; tri++) {
          var tr = tileResults[tri];
          if (tr.action) {
            chainReactions.push(tr);
          }
        }
        effects.push({
          type: 'tile_effect',
          x: targetX,
          y: targetY,
          tileType: tileType,
          chainReactions: chainReactions,
        });
      }
      break;
    }

    case 'summon': {
      if (combatCard.summonType === 'skeleton') {
        // --- Raise Skeleton: spawn a skeleton ally that fights enemies ---
        var skelHp  = combatCard.summonHp     || 40;
        var skelDmg = combatCard.summonDamage || 10;
        var skelDur = combatCard.summonDuration || 30;

        // 1. Rarity scaling: summonHp/summonDamage are top-level template fields and bypass
        //    generateCardInstance scaling.  Apply it manually based on card.rarity vs template base.
        var _skelRarityTable = { common: 1.0, uncommon: 2.0, rare: 4.0, ultra_rare: 7.0,
                                 mythic_rare: 7.0, legendary: 7.0, godly: 7.0, relic: 7.0 };
        var _skelBaseScale   = _skelRarityTable[template.rarity  || 'uncommon'] || 2.0;
        var _skelRolledScale = _skelRarityTable[card.rarity      || 'uncommon'] || 2.0;
        var _skelRarityMult  = _skelRolledScale / _skelBaseScale;
        if (_skelRarityMult > 1.0) {
          skelHp  = Math.round(skelHp  * _skelRarityMult);
          skelDmg = Math.round(skelDmg * _skelRarityMult);
        }

        // 2. Acumen scaling: same formula as ability damage (base × (1 + stat × factor))
        var _skelAcumen  = (unit.combat && unit.combat.acumen) ? unit.combat.acumen : 5;
        var _skelSclFact = combatCard.scalingFactor || 0.3;
        skelDmg = Math.round(skelDmg * (1 + _skelAcumen * _skelSclFact));

        // 3. Summon bonuses from equipped passive cards (same as turret_upgrade pattern)
        var _skelSummonDmgBonus = getUnitCombatPassiveTotal(unit, 'summon_damage_bonus') +
                                  getCardEffectTotal(unit, 'summon_damage_bonus');
        var _skelSummonHpBonus  = getUnitCombatPassiveTotal(unit, 'summon_hp_bonus') +
                                  getCardEffectTotal(unit, 'summon_hp_bonus');
        if (_skelSummonDmgBonus > 0) skelDmg = Math.round(skelDmg * (1 + _skelSummonDmgBonus));
        if (_skelSummonHpBonus  > 0) skelHp  = Math.round(skelHp  * (1 + _skelSummonHpBonus));

        // 4. Element, range, and archetype from card.effects[] and card.affixes
        //    card.effects[] already merges base + affix + mutation effects at draw time.
        var _skelElement   = null;   // null → physical damage
        var _skelRange     = 1;
        var _skelArchetype = 'bruiser';
        var _skelName      = 'Raised Skeleton';

        // 5. Scan card.effects[] (base + merged affixes/mutations) for element, on-hit, pierce, chain
        //    Mirrors the turret scaling pass exactly.
        var _skelOnHitEffects  = [];
        var _skelPierceTargets = 0;
        var _skelChainBounces  = 0;
        var _skelChainFalloff  = 0.6;

        var _skelCardEffects = card.effects || [];
        for (var _scef = 0; _scef < _skelCardEffects.length; _scef++) {
          var _sef = _skelCardEffects[_scef];
          if (!_sef || !_sef.type) continue;
          switch (_sef.type) {
            case 'add_flat_damage':
              if (_sef.element && !_skelElement) { _skelElement = _sef.element; skelDmg += (typeof _sef.value === 'number') ? Math.round(_sef.value) : 0; }
              break;
            case 'on_hit_bleed':      _skelOnHitEffects.push({ type: 'bleed',      chance: _sef.chance || 0.25, duration: _sef.duration || 2, tickDamage: _sef.tickDamage || 4 }); break;
            case 'on_hit_burn':       _skelOnHitEffects.push({ type: 'burn',       chance: _sef.chance || 0.25 }); break;
            case 'on_hit_slow':       _skelOnHitEffects.push({ type: 'slow',       chance: _sef.chance || 0.25 }); break;
            case 'on_hit_poison':     _skelOnHitEffects.push({ type: 'poison',     chance: _sef.chance || 0.20 }); break;
            case 'on_hit_stun':       _skelOnHitEffects.push({ type: 'stun',       chance: _sef.chance || 0.15, duration: _sef.duration || 1 }); break;
            case 'mark_on_hit':       _skelOnHitEffects.push({ type: 'mark',       chance: _sef.chance || 0.20, damageTakenBonus: _sef.damageTakenBonus || 0.10 }); break;
            case 'mana_drain_on_hit': _skelOnHitEffects.push({ type: 'mana_drain', value:  _sef.value || 4 }); break;
            case 'wound_on_hit':      _skelOnHitEffects.push({ type: 'wound',      healing_reduction: _sef.healing_reduction || 0.30 }); break;
            case 'knockback_on_hit':  _skelOnHitEffects.push({ type: 'knockback',  tiles: _sef.tiles || 1 }); break;
            case 'push_on_hit':       _skelOnHitEffects.push({ type: 'push',       tiles: _sef.tiles || 2 }); break;
            case 'pull_on_hit':       _skelOnHitEffects.push({ type: 'pull',       tiles: _sef.tiles || 1 }); break;
            case 'pierce_on_hit':     _skelPierceTargets += (_sef.targets || 1); break;
            case 'chain_on_hit':
              if ((_sef.bounces || 1) > _skelChainBounces) {
                _skelChainBounces = _sef.bounces || 1;
                _skelChainFalloff = _sef.damageFalloff || 0.6;
              }
              break;
          }
        }

        // card.affixes — individual rolled affixes with .effect payload (not yet merged into effects[])
        var _skelAffixes = card.affixes || [];
        for (var _safi = 0; _safi < _skelAffixes.length; _safi++) {
          var _saff = _skelAffixes[_safi];
          if (!_saff || !_saff.effect) continue;
          var _se = _saff.effect;
          if (_se.type === 'add_flat_damage' && _se.element && !_skelElement) {
            _skelElement = _se.element;
            skelDmg += (typeof _se.value === 'number') ? Math.round(_se.value) : 0;
          } else if (_se.type === 'range_bonus' || _se.type === 'summon_ranged') {
            _skelRange     = 2;
            _skelArchetype = 'ranged';
            _skelName      = 'Raised Archer Skeleton';
          }
        }

        // Necromancy shadow default: shadow tag → physical attacks count as shadow magic
        if (!_skelElement && template.tags && template.tags.indexOf('shadow') !== -1) {
          _skelElement = 'shadow';
        }

        var skelSpeed = 7;
        var adjSkelTiles = getAdjacentTiles(unit.x, unit.y, combat.floor.width, combat.floor.height);
        var skelSpawned = 0;
        for (var ski = 0; ski < adjSkelTiles.length && skelSpawned < 1; ski++) {
          var skelTile = adjSkelTiles[ski];
          if (!isWalkableCombat(combat.floor.grid, skelTile.x, skelTile.y, combat.floor.width, combat.floor.height, combat.units) || getUnitAtPosition(combat, skelTile.x, skelTile.y)) continue;
          var skelId = unitId + '_skeleton_' + Date.now();
          var skelCombat = { atk: skelDmg, def: combatCard.summonArmor || 5, range: _skelRange, magicResist: 0, speed: skelSpeed };
          if (_skelElement) skelCombat.element = _skelElement;
          var skelUnit = {
            id: skelId,
            type: 'enemy',          // Uses enemy AI loop for autonomous action
            enemyType: 'undead',
            isPlayerSummon: true,   // Marks as friendly — not counted as enemy
            ownerId: unitId,
            name: _skelName,
            x: skelTile.x,
            y: skelTile.y,
            hp: skelHp,
            maxHp: skelHp,
            mp: 2,
            ap: PLAYER_BASE_AP,
            rp: 0,
            ct: Math.floor(Math.random() * 20),
            speed: skelSpeed,
            alive: true,
            statusEffects: [],
            equippedCards: [],
            abilities: [],
            archetype: _skelArchetype,
            isBoss: false,
            invincible: false,
            xp: 0,
            gold: 0,
            turnsLeft: skelDur,
            combat: skelCombat,
          };
          if (_skelOnHitEffects.length > 0) skelUnit.onHitEffects = _skelOnHitEffects;
          if (_skelPierceTargets > 0)       skelUnit.pierceTargets = _skelPierceTargets;
          if (_skelChainBounces  > 0)       { skelUnit.chainBounces = _skelChainBounces; skelUnit.chainFalloff = _skelChainFalloff; }
          combat.units.set(skelId, skelUnit);
          skelSpawned++;
          effects.push({
            type: 'summon',
            summonKind: 'skeleton',
            unitId: skelId,
            ownerId: unitId,
            x: skelTile.x,
            y: skelTile.y,
            hp: skelHp,
            name: _skelName,
            archetype: _skelArchetype,
            element: _skelElement,
          });
          // Necromancy XP for successfully summoning
          if (unit.socketId && combat.callbacks.addSkillXp) {
            combat.callbacks.addSkillXp(unit.socketId, 'necromancy', 10);
          }
        }
      } else {
        // --- Mirror Image: create illusion clones ---
        var summonCount = combatCard.summonCount || 2;
        var summonHp = combatCard.summonHp || 1;
        var summonDmg = combatCard.summonDamage || 5;
        var summonDur = combatCard.summonDuration || 4;
        var cloneList = _playerClones.get(unitId) || [];
        var adjSummonTiles = getAdjacentTiles(unit.x, unit.y, combat.floor.width, combat.floor.height);
        var summonedCount = 0;
        for (var smi = 0; smi < adjSummonTiles.length && summonedCount < summonCount; smi++) {
          var smTile = adjSummonTiles[smi];
          if (!isWalkableCombat(combat.floor.grid, smTile.x, smTile.y, combat.floor.width, combat.floor.height, combat.units) || getUnitAtPosition(combat, smTile.x, smTile.y)) continue;
          var cloneId = unitId + '_clone_' + Date.now() + '_' + summonedCount;
          var cloneUnit = {
            id: cloneId,
            type: unit.type,
            x: smTile.x,
            y: smTile.y,
            hp: summonHp,
            maxHp: summonHp,
            atk: summonDmg,
            alive: true,
            isClone: true,
            ownerId: unitId,
            turnsLeft: summonDur,
            name: unit.name + ' Clone',
            statusEffects: [],
            equippedCards: [],
            combat: { def: 0, atkRange: 1 },
            mp: 0,
            ap: 0,
            rp: 0,
            ct: 0,
          };
          combat.units.set(cloneId, cloneUnit);
          cloneList.push({ cloneId: cloneId, hp: summonHp, damage: summonDmg, turnsLeft: summonDur });
          summonedCount++;
          effects.push({
            type: 'summon',
            unitId: cloneId,
            ownerId: unitId,
            x: smTile.x,
            y: smTile.y,
            hp: summonHp,
            name: cloneUnit.name,
          });
        }
        _playerClones.set(unitId, cloneList);
      }
      break;
    }

    case 'movement': {
      // Movement abilities: blink, dash, teleport
      var blinkFromX = unit.x;
      var blinkFromY = unit.y;

      // Determine movement type and maximum distance
      var moveDist = combatCard.dashDistance || combatCard.teleportDistance || combatCard.range || 4;
      var isTeleport = !!(combatCard.teleportDistance);
      var isDash = !!(combatCard.dashDistance || combatCard.passThroughEnemies);

      // For dashes: walk along line from unit to target, allowing pass-through of enemies if flagged
      var moveLandX = targetX;
      var moveLandY = targetY;
      var movementBlocked = false;

      if (isDash && combatCard.passThroughEnemies) {
        // Shadow Dash: line-of-tiles walk, skipping enemy-occupied tiles but stopping at walls
        var dashDx = targetX - blinkFromX;
        var dashDy = targetY - blinkFromY;
        var dashLen = Math.max(Math.abs(dashDx), Math.abs(dashDy));
        if (dashLen > 0) {
          var dashStepX = dashDx / dashLen;
          var dashStepY = dashDy / dashLen;
          moveLandX = blinkFromX;
          moveLandY = blinkFromY;
          for (var dashI = 1; dashI <= Math.min(dashLen, moveDist); dashI++) {
            var dashCheckX = blinkFromX + Math.round(dashStepX * dashI);
            var dashCheckY = blinkFromY + Math.round(dashStepY * dashI);
            if (!isWalkableCombat(combat.floor.grid, dashCheckX, dashCheckY, combat.floor.width, combat.floor.height, combat.units)) {
              break; // Hit a wall; stop at last valid tile
            }
            // passThroughEnemies: enemy-occupied tiles are traversable, but we can't LAND on them
            var dashOccupant = getUnitAtPosition(combat, dashCheckX, dashCheckY);
            if (dashOccupant && dashOccupant.id !== unitId) {
              // Can pass through but not land on; continue to next tile
              continue;
            }
            moveLandX = dashCheckX;
            moveLandY = dashCheckY;
          }
        }
      } else {
        // Standard teleport/blink: land directly at target if valid
        if (!isWalkableCombat(combat.floor.grid, targetX, targetY, combat.floor.width, combat.floor.height, combat.units) || getUnitAtPosition(combat, targetX, targetY)) {
          movementBlocked = true;
        }
      }

      if (movementBlocked || (moveLandX === blinkFromX && moveLandY === blinkFromY)) {
        effects.push({ type: 'movement_failed', reason: 'Target tile blocked' });
      } else {
        unit.x = moveLandX;
        unit.y = moveLandY;
        effects.push({
          type: 'movement',
          unitId: unitId,
          fromX: blinkFromX,
          fromY: blinkFromY,
          toX: moveLandX,
          toY: moveLandY,
          isTeleport: isTeleport,
          isDash: isDash,
          passThroughEnemies: combatCard.passThroughEnemies || false,
        });

        // --- Scout: summonDecoy — leave a decoy at original position ---
        if (combatCard.summonDecoy) {
          var decoyId = unitId + '_decoy_' + Date.now();
          var decoyUnit = {
            id: decoyId,
            type: unit.type,
            x: blinkFromX,
            y: blinkFromY,
            hp: combatCard.decoyHp || 1,
            maxHp: combatCard.decoyHp || 1,
            atk: 0,
            alive: true,
            isClone: true,
            isDecoy: true,
            ownerId: unitId,
            turnsLeft: 3,
            name: unit.name + ' Decoy',
            statusEffects: [],
            equippedCards: [],
            combat: { def: 0, atkRange: 0 },
            mp: 0,
            ap: 0,
            rp: 0,
            ct: 0,
          };
          // If decoy draws aggro, flag it so AI prioritizes attacking it
          if (combatCard.decoyDrawsAggro) {
            decoyUnit._drawsAggro = true;
            decoyUnit._aggroPriority = 10; // High priority target for enemy AI
          }
          combat.units.set(decoyId, decoyUnit);
          // Track in player clones list for cleanup
          var decoyCloneList = _playerClones.get(unitId) || [];
          decoyCloneList.push({ cloneId: decoyId, hp: decoyUnit.hp, damage: 0, turnsLeft: 3 });
          _playerClones.set(unitId, decoyCloneList);
          effects.push({
            type: 'summon',
            unitId: decoyId,
            ownerId: unitId,
            x: blinkFromX,
            y: blinkFromY,
            hp: decoyUnit.hp,
            name: decoyUnit.name,
            isDecoy: true,
            drawsAggro: combatCard.decoyDrawsAggro || false,
          });
        }

        // --- Scout/Movement: onUseStatus — apply status to caster after movement ---
        if (combatCard.onUseStatus) {
          var ousStatus = combatCard.onUseStatus;
          if (!unit.statusEffects) unit.statusEffects = [];
          unit.statusEffects.push({
            name: ousStatus.name || 'buff',
            type: ousStatus.type || 'buff',
            duration: ousStatus.duration || 2,
            sourceId: unitId,
          });
          effects.push({
            type: 'status',
            targetId: unitId,
            effect: ousStatus.name || 'buff',
            duration: ousStatus.duration || 2,
            statusType: ousStatus.type || 'buff',
            source: 'on_use',
          });
        }
      }
      break;
    }

    case 'cleanse': {
      // --- Cleanse: remove debuffs of a specific category ---
      var cleanseCategory = combatCard.cleanseCategory || template.cleanseCategory || 'physical';
      var cleanseTarget = getUnitAtPosition(combat, targetX, targetY);
      if (!cleanseTarget || !cleanseTarget.alive) {
        // Also allow self-target
        if (targetX === unit.x && targetY === unit.y) cleanseTarget = unit;
      }
      if (cleanseTarget && cleanseTarget.type === unit.type) {
        var cleansedEffects = [];
        if (cleanseTarget.statusEffects) {
          var keptEffects = [];
          for (var clI = 0; clI < cleanseTarget.statusEffects.length; clI++) {
            var clEff = cleanseTarget.statusEffects[clI];
            var effCategory = rpgData.getStatusEffectCategory(clEff.name);
            if (clEff.type === 'debuff' && effCategory === cleanseCategory) {
              cleansedEffects.push(clEff.name);
            } else {
              keptEffects.push(clEff);
            }
          }
          cleanseTarget.statusEffects = keptEffects;
        }
        effects.push({
          type: 'cleanse',
          targetId: cleanseTarget.id,
          cleansedEffects: cleansedEffects,
          cleanseCategory: cleanseCategory,
          cleansedCount: cleansedEffects.length,
        });
      }
      break;
    }

    default:
      // Unknown card type, treat as no-op but still consume AP/mana
      break;
  }

  // ---------------------------------------------------------------------------
  // Post-ability processing for MMO-inspired mechanics
  // ---------------------------------------------------------------------------

  // --- Combo Chain: track combo state ---
  var postComboId = (abilityCardId || '').toLowerCase();
  if (postComboId === 'combo_rising_edge' || postComboId === 'combo_savage_blow' || postComboId === 'combo_full_thrust') {
    _comboState.set(unitId, { lastCombo: postComboId, turnUsed: combat.turnNumber || 0 });
    if (postComboId === 'combo_full_thrust') {
      // Full Thrust ends the combo chain
      _comboState.delete(unitId);
    }
  }

  // --- Dance Partner: share 50% of buff applied to self to partner ---
  if (cardType === 'buff' && unit.alive) {
    var dpPartnerId = _dancePartners.get(unitId);
    if (dpPartnerId) {
      var dpPartner = combat.units.get(dpPartnerId);
      if (dpPartner && dpPartner.alive) {
        // Find the buff we just applied (last buff in effects array targeting self)
        for (var dpEffI = 0; dpEffI < effects.length; dpEffI++) {
          var dpEff = effects[dpEffI];
          if (dpEff.type === 'status' && dpEff.statusType === 'buff' && dpEff.targetId === unitId) {
            // Mirror a weaker version to partner
            if (!dpPartner.statusEffects) dpPartner.statusEffects = [];
            var dpMirrorBuff = {
              name: dpEff.effect + '_mirror',
              type: 'buff',
              duration: Math.max(1, Math.floor((dpEff.duration || 2) * 0.5)),
              sourceId: unitId,
              damageBoost: 0,
              armorBoost: 0,
            };
            // Find original buff on caster to copy reduced values
            if (unit.statusEffects) {
              for (var dpSI = unit.statusEffects.length - 1; dpSI >= 0; dpSI--) {
                var dpSrc = unit.statusEffects[dpSI];
                if (dpSrc.name === dpEff.effect && dpSrc.sourceId === unitId) {
                  if (dpSrc.damageBoost) dpMirrorBuff.damageBoost = Math.floor(dpSrc.damageBoost * 0.5);
                  if (dpSrc.armorBoost) dpMirrorBuff.armorBoost = Math.floor(dpSrc.armorBoost * 0.5);
                  if (dpSrc.damageReduction) dpMirrorBuff.damageReduction = dpSrc.damageReduction * 0.5;
                  if (dpSrc.speedMult) dpMirrorBuff.speedMult = 1 + (dpSrc.speedMult - 1) * 0.5;
                  if (dpSrc.healPerTurn) dpMirrorBuff.healPerTurn = Math.floor(dpSrc.healPerTurn * 0.5);
                  break;
                }
              }
            }
            dpPartner.statusEffects.push(dpMirrorBuff);
            effects.push({
              type: 'status',
              targetId: dpPartnerId,
              effect: dpMirrorBuff.name,
              duration: dpMirrorBuff.duration,
              statusType: 'buff',
              passive: 'dance_partner',
            });
            break; // Only mirror one buff per ability
          }
        }
      }
    }
  }

  // --- Kardia Link: heal bonded ally on non-damage ability use ---
  if (cardType !== 'damage' && unit.alive) {
    var kardiaPostPassive = getUnitCombatPassive(unit, 'kardia_link');
    if (kardiaPostPassive) {
      var kardiaPostPartner = _dancePartners.get(unitId);
      var kardiaPostTarget = kardiaPostPartner ? combat.units.get(kardiaPostPartner) : null;
      if (!kardiaPostTarget || !kardiaPostTarget.alive) {
        // Default: heal lowest-HP ally
        var kpLowest = null;
        var kpLowestRatio = 1.1;
        var kpIter = combat.units.values();
        var kpEntry = kpIter.next();
        while (!kpEntry.done) {
          var kpAlly = kpEntry.value;
          kpEntry = kpIter.next();
          if (kpAlly.type === unit.type && kpAlly.alive && kpAlly.id !== unitId && kpAlly.hp < kpAlly.maxHp) {
            var kpR = kpAlly.hp / (kpAlly.maxHp || 1);
            if (kpR < kpLowestRatio) { kpLowestRatio = kpR; kpLowest = kpAlly; }
          }
        }
        kardiaPostTarget = kpLowest;
      }
      if (kardiaPostTarget && kardiaPostTarget.alive) {
        var kpHeal = kardiaPostPassive.value || 8;
        var kpOldHp = kardiaPostTarget.hp;
        kardiaPostTarget.hp = Math.min(kardiaPostTarget.maxHp, kardiaPostTarget.hp + kpHeal);
        var kpActual = kardiaPostTarget.hp - kpOldHp;
        if (kpActual > 0) {
          effects.push({
            type: 'heal',
            targetId: kardiaPostTarget.id,
            amount: kpActual,
            targetHp: kardiaPostTarget.hp,
            targetMaxHp: kardiaPostTarget.maxHp,
            passive: 'kardia_link',
          });
        }
      }
    }
  }

  return {
    success: true,
    abilityName: combatCard.name || 'Unknown Ability',
    abilityId: abilityCardId,
    effects: effects,
    resourceType: resourceType,
    manaCost: manaCost,
    cooldown: cooldownDuration,
    unitMana: unit.combat.mana,
    unitMaxMana: unit.combat.maxMana || unit.combat.mana,
    unitStamina: (unit.combat.stamina !== undefined) ? unit.combat.stamina : 0,
    unitMaxStamina: unit.combat.maxStamina || 50,
    unitBloodlust: (unit.combat.bloodlust !== undefined) ? unit.combat.bloodlust : 0,
    unitMaxBloodlust: unit.combat.maxBloodlust || 50,
    unitFocus: (unit.combat.focus !== undefined) ? unit.combat.focus : 0,
    unitMaxFocus: unit.combat.maxFocus || 50,
    unitAp: unit.ap,
  };
}

/**
 * Tick ability cooldowns for all units in a combat.
 * Call this at the start of each round (or each CT cycle) to decrement cooldowns by 1.
 */
function tickAbilityCooldowns(combat) {
  if (!combat || !combat.units) return;

  var iter = combat.units.values();
  var entry = iter.next();

  while (!entry.done) {
    var unit = entry.value;
    entry = iter.next();

    if (!unit.abilityCooldowns) continue;
    if (!(unit.abilityCooldowns instanceof Map)) continue;

    var toDelete = [];
    var cdIter = unit.abilityCooldowns.entries();
    var cdEntry = cdIter.next();

    while (!cdEntry.done) {
      var cardId = cdEntry.value[0];
      var remaining = cdEntry.value[1];
      cdEntry = cdIter.next();

      var newVal = remaining - 1;
      if (newVal <= 0) {
        toDelete.push(cardId);
      } else {
        unit.abilityCooldowns.set(cardId, newVal);
      }
    }

    for (var i = 0; i < toDelete.length; i++) {
      unit.abilityCooldowns.delete(toDelete[i]);
    }
  }
}

module.exports = {
  init: init,
  executeAbility: executeAbility,
  tickAbilityCooldowns: tickAbilityCooldowns,
};
