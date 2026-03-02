// combat-damage.js
// Pure damage calculation for the tactical combat engine.
// Extracted from dungeon-combat.js — handles dodge, block, crit, darkness,
// passives, weapon specials, gem procs, augment effects, set bonuses,
// and defender damage reduction. No side effects on module-level Maps.

'use strict';

var rpgData = require('./rpg-data');
var combatPassives = require('./combat-passive-helpers');

var getUnitCombatPassive = combatPassives.getUnitCombatPassive;
var getCardEffectTotal   = combatPassives.getCardEffectTotal;

// Diagonal adjacency threshold (must match dungeon-combat.js MELEE_RANGE)
var MELEE_RANGE = 1.5;

// ---------------------------------------------------------------------------
// Damage calculation
// ---------------------------------------------------------------------------

/**
 * Calculate damage from attacker to target.
 * Players use the RPG formula: baseAtk = (might*2) + (level*1.5) + weaponDamage;
 *                               damage = max(1, floor(baseAtk * meleeDmgMult - targetDef))
 * Enemies use simplified: damage = max(1, floor(enemy.atk - playerArmor))
 *
 * @param {object} attacker - The attacking unit
 * @param {object} target   - The defending unit
 * @param {object} [combat] - The combat instance (for floor-level flags like _isWaterFloor)
 * Returns { baseDamage, isCrit, finalDamage, dodged, blocked }
 */
function calculateDamage(attacker, target, combat) {
  // Invincible targets take no damage (raid boss barrier mechanic)
  if (target.invincible) {
    return { baseDamage: 0, isCrit: false, finalDamage: 0, dodged: false, blocked: false, invincible: true };
  }

  var damage = 0;
  var isCrit = false;
  var dodged = false;
  var blocked = false;
  var offHandStrike = false;
  var offHandDamageDealt = 0;

  // --- Dodge/Evasion check (target avoids the attack entirely) ---
  // dodgeChance from base stats + dodge_bonus from equipped cards
  var targetDodge = (target.combat && target.combat.dodgeChance) ? target.combat.dodgeChance : 0;
  targetDodge += getCardEffectTotal(target, 'dodge_bonus');
  // Animal form dodge bonus (rat, bat, serpent, etc.)
  if (target.statusEffects) {
    for (var afdi = 0; afdi < target.statusEffects.length; afdi++) {
      if (target.statusEffects[afdi].animalForm && target.statusEffects[afdi].dodgeBonus) {
        targetDodge += target.statusEffects[afdi].dodgeBonus;
      }
    }
  }
  // Eagle form: immune to melee attacks (range < 2)
  if (target.activeAnimalForm === 'eagle') {
    var atkRange = 1;
    if (attacker.type === 'player' && attacker.combat && attacker.combat.weaponRange) {
      atkRange = attacker.combat.weaponRange;
    } else if (attacker.type === 'enemy' && attacker.combat && attacker.combat.range) {
      atkRange = attacker.combat.range;
    }
    if (atkRange < 2) {
      return { baseDamage: 0, isCrit: false, finalDamage: 0, dodged: true, blocked: false, meleeImmune: true };
    }
  }
  // Turtle form: shell damage reduction
  if (target.activeAnimalForm === 'turtle' && target.statusEffects) {
    for (var tsdi = 0; tsdi < target.statusEffects.length; tsdi++) {
      if (target.statusEffects[tsdi].animalForm === 'turtle' && target.statusEffects[tsdi].shellDR) {
        targetDodge = 0; // Turtle relies on DR, not dodge
        break;
      }
    }
  }
  // --- Night Hunter Passive: shadow_sight — true sight reduces target stealth dodge bonus ---
  var shadowSightAttacker = getUnitCombatPassive(attacker, 'shadow_sight');
  if (shadowSightAttacker) {
    // True sight: negate stealth-based dodge bonuses from target
    if (target.statusEffects) {
      for (var ssNI = 0; ssNI < target.statusEffects.length; ssNI++) {
        var ssNSE = target.statusEffects[ssNI];
        if ((ssNSE.name === 'stealthed' || ssNSE.name === 'invisible' || ssNSE.name === 'prowl_stealth') && ssNSE.dodgeBonus) {
          targetDodge -= ssNSE.dodgeBonus;
        }
        if (ssNSE.stealthBonus) {
          targetDodge -= ssNSE.stealthBonus * 0.5; // Stealth provides partial dodge; true sight negates it
        }
      }
    }
    // Accuracy bonus reduces target dodge chance
    targetDodge -= (shadowSightAttacker.accuracyBonus || 0.10);
  }

  // Cap dodge at 60% to prevent invincibility
  targetDodge = Math.min(0.60, Math.max(0, targetDodge));
  if (targetDodge > 0 && Math.random() < targetDodge) {
    dodged = true;
    // --- Riposte Passive: after dodging, grant +25% damage on next attack ---
    var riposteOnDodge = getUnitCombatPassive(target, 'riposte_passive');
    if (riposteOnDodge) {
      if (!target.statusEffects) target.statusEffects = [];
      target.statusEffects.push({
        name: 'riposte',
        type: 'buff',
        duration: 2,
        damageBoost: Math.ceil((riposteOnDodge.value || 0.25) * 100),
        sourceId: target.id,
      });
    }
    return { baseDamage: 0, isCrit: false, finalDamage: 0, dodged: true, blocked: false };
  }

  // --- Passive: parry_chance — 15% chance to negate incoming melee attack entirely ---
  var parryPassive = getUnitCombatPassive(target, 'parry_chance');
  if (parryPassive) {
    // Only parry melee attacks (range <= 1.5)
    var parryAtkRange = 1;
    if (attacker.type === 'player' && attacker.combat && attacker.combat.weaponRange) {
      parryAtkRange = attacker.combat.weaponRange;
    } else if (attacker.type === 'enemy' && attacker.combat && attacker.combat.range) {
      parryAtkRange = attacker.combat.range;
    }
    if (parryAtkRange <= MELEE_RANGE && Math.random() < (parryPassive.value || 0.15)) {
      return { baseDamage: 0, isCrit: false, finalDamage: 0, dodged: false, blocked: false, parried: true };
    }
  }

  // --- Block check (target halves the damage) ---
  var targetBlock = (target.combat && target.combat.blockChance) ? target.combat.blockChance : 0;
  // Cap block at 50%
  targetBlock = Math.min(0.50, targetBlock);

  // --- Darkness combat penalties ---
  // A player fighting in darkness without vision or light source suffers:
  //   - 30% chance to miss attacks entirely (can't see target properly)
  //   - 20% damage reduction on hits (can't aim for weak points)
  // An enemy attacking a blind player in darkness gains +15% damage bonus.
  // Players with any active non-normal vision type or torch/lantern are exempt.
  // _isDarkFloor and _ambientLight are injected from dungeon.js via initCombat.
  var darknessMissChance = 0;
  var darknessDamageMult = 1;
  var darknessEnemyDmgBonus = 1;

  if (attacker.type === 'player' && attacker._isDarkFloor) {
    var atkVision = attacker.visionType || 'normal';
    var atkHasLight = attacker._hasTorch || attacker._hasLantern;
    // shadow_sight passive: immune to blind/darkness penalties
    var atkShadowSight = getUnitCombatPassive(attacker, 'shadow_sight');
    if (atkVision === 'normal' && !atkHasLight && !atkShadowSight) {
      darknessMissChance = 0.30;
      darknessDamageMult = 0.80;
    }
  }
  if (attacker.type === 'enemy' && target.type === 'player' && target._isDarkFloor) {
    var tgtVision = target.visionType || 'normal';
    var tgtHasLight = target._hasTorch || target._hasLantern;
    if (tgtVision === 'normal' && !tgtHasLight) {
      darknessEnemyDmgBonus = 1.15; // +15% damage against blind players
    }
  }

  // Darkness miss roll: attacker in darkness fumbles the attack entirely
  if (darknessMissChance > 0 && Math.random() < darknessMissChance) {
    return { baseDamage: 0, isCrit: false, finalDamage: 0, dodged: false, blocked: false, darknessMiss: true };
  }

  if (attacker.type === 'player') {
    // Player attacking enemy (PvE only)
    var stats = attacker.combat || {};
    var might = stats.might || 5;
    var level = attacker.level || 1;
    var weaponDmg = stats.weaponDamage || 0;
    var meleeMult = stats.meleeDmgMult || 1;
    var targetDef = (target.combat && target.combat.def !== undefined) ? target.combat.def : 0;

    // --- Aquatic Passive: aquatic_adaptation — +30% all stats on water floors (basic attacks) ---
    var aqAdaptBasic = getUnitCombatPassive(attacker, 'aquatic_adaptation');
    if (aqAdaptBasic && combat && combat._isWaterFloor) {
      var aqBonusBasic = aqAdaptBasic.waterTileStatBonus || 0.30;
      might = Math.floor(might * (1 + aqBonusBasic));
      meleeMult = meleeMult * (1 + aqBonusBasic);
    }

    var baseAtk = (might * 2) + (level * 1.5) + weaponDmg;

    // Stealth attack bonus: bonus damage multiplier from stealth_attack_bonus card effects
    // Applies as a flat damage multiplier for rogues/stealth builds
    var stealthAtkBonus = getCardEffectTotal(attacker, 'stealth_attack_bonus');
    if (stealthAtkBonus > 0) {
      baseAtk = baseAtk * (1 + stealthAtkBonus);
    }

    var atkArmorReduction = targetDef / (targetDef + 50);
    damage = Math.max(1, Math.floor(baseAtk * meleeMult * (1 - atkArmorReduction)));

    // --- Weapon Special activation (if charged and player opts to use it) ---
    if (stats.weaponSpecial && stats.weaponSpecialCharge >= (stats.weaponSpecial.cost || 50) && attacker._useWeaponSpecial) {
      stats.weaponSpecialCharge -= stats.weaponSpecial.cost;
      attacker._useWeaponSpecial = false;
      var wsEff = stats.weaponSpecial.effect;
      if (wsEff) {
        if (wsEff.type === 'guaranteed_crit') {
          isCrit = true;
          damage = Math.floor(damage * (wsEff.damageMult || 1.5));
        } else if (wsEff.type === 'stun_attack') {
          damage = Math.floor(damage * (1 / (1 - (wsEff.armorIgnore || 0.30))));
          if (!target.statusEffects) target.statusEffects = [];
          target.statusEffects.push({ name: 'stunned', type: 'debuff', duration: wsEff.stunDuration || 1, skipTurn: true, sourceId: attacker.id });
        } else if (wsEff.type === 'multi_attack') {
          var extraHits = (wsEff.count || 3) - 1;
          for (var mhi = 0; mhi < extraHits; mhi++) {
            damage += Math.max(1, Math.floor(damage * 0.60));
          }
        } else if (wsEff.type === 'empower_next_spell') {
          if (!attacker.statusEffects) attacker.statusEffects = [];
          attacker.statusEffects.push({ name: 'arcane_surge', type: 'buff', duration: 2, spellCostMult: wsEff.costMult || 0, spellEffectMult: wsEff.effectMult || 2.0, sourceId: attacker.id });
        }
      }
    }

    // Weapon damage type vs armor type modifier (Fix 3)
    var weaponCat = stats.weaponCategory || 'sword';
    var dmgType = rpgData.WEAPON_DAMAGE_TYPES[weaponCat];
    var targetArmorType = (target.combat && target.combat.armorType) ? target.combat.armorType : 'none';
    if (dmgType && rpgData.ARMOR_PHYS_RESIST[targetArmorType]) {
      var physResist = rpgData.ARMOR_PHYS_RESIST[targetArmorType][dmgType] || 0;
      // physResist is already how effective the armor is vs this damage type (0-1)
      // Higher value = armor is better vs this type, so reduce damage more
      damage = Math.max(1, Math.floor(damage * (1 - physResist * 0.3)));
    }

    // --- Night Hunter Passive: hunters_instinct — +15% damage vs debuffed, +10% crit vs marked ---
    var huntersInstinctPassive = getUnitCombatPassive(attacker, 'hunters_instinct');
    if (huntersInstinctPassive && target.statusEffects && target.statusEffects.length > 0) {
      var hasAnyDebuff = false;
      var hasMarked = false;
      for (var hiCI = 0; hiCI < target.statusEffects.length; hiCI++) {
        if (target.statusEffects[hiCI].type === 'debuff') hasAnyDebuff = true;
        if (target.statusEffects[hiCI].name === 'predators_mark') hasMarked = true;
      }
      if (hasAnyDebuff) {
        damage = Math.floor(damage * (1 + (huntersInstinctPassive.damageVsDebuffed || 0.15)));
      }
      if (hasMarked) {
        stats._huntersInstinctCritBonus = (huntersInstinctPassive.critVsMarked || 0.10);
      }
    }

    // Off-hand strike: 40% chance per attack to also strike with off-hand weapon
    if (stats.offHandDamage > 0 && Math.random() < 0.40) {
      var offDmg = Math.max(1, Math.floor(stats.offHandDamage * meleeMult * (1 - atkArmorReduction)));
      damage += offDmg;
      offHandStrike = true;
      offHandDamageDealt = offDmg;
    }

    // --- Weapon Special: charge accumulation ---
    if (stats.weaponSpecial && stats.weaponSpecialCharge !== undefined) {
      stats.weaponSpecialCharge = Math.min(100, (stats.weaponSpecialCharge || 0) + (stats.weaponSpecial.chargeRegen || 10));
    }

    // --- Gem proc effects ---
    if (stats.gemBonuses) {
      var gb = stats.gemBonuses;
      // Lightning on crit: extra lightning damage
      if (isCrit && gb.lightningOnCrit) {
        damage += gb.lightningOnCrit;
      }
      // Poison chance from emerald gems
      if (gb.poisonChance && Math.random() < gb.poisonChance) {
        if (!target.statusEffects) target.statusEffects = [];
        target.statusEffects.push({
          name: 'gem_poison',
          type: 'debuff',
          duration: 3,
          tickDamage: gb.poisonDamage || 3,
          sourceId: attacker.id,
        });
      }
      // Mana drain on hit from amethyst
      if (gb.manaDrainOnHit && stats.mana !== undefined) {
        stats.mana = Math.min(stats.maxMana || 999, stats.mana + gb.manaDrainOnHit);
      }
    }

    // --- Augment effects ---
    if (stats.augmentBonuses) {
      var ab = stats.augmentBonuses;
      // Spell echo chance (weapon augment)
      if (ab.spellEcho && Math.random() < ab.spellEcho) {
        damage = Math.floor(damage * 1.5); // Echo hit for 50% more
      }
    }

    // --- Unique item effects ---
    if (stats.uniqueEffect) {
      var ue = stats.uniqueEffect;
      // Execute threshold: instant kill below X% HP
      if (ue.type === 'execute_threshold' && target.hp !== undefined && target.maxHp) {
        var hpPct = target.hp / target.maxHp;
        if (hpPct <= (ue.threshold || 0.15)) {
          damage = target.hp + 1; // Kill
        }
      }
      // Guaranteed crit vs debuffed enemies
      if (ue.type === 'guaranteed_crit_vs_debuffed' && target.statusEffects) {
        var hasDebuff = false;
        for (var udi = 0; udi < target.statusEffects.length; udi++) {
          if (target.statusEffects[udi].type === 'debuff') { hasDebuff = true; break; }
        }
        if (hasDebuff && !isCrit) {
          isCrit = true;
          damage = Math.floor(damage * 1.5);
        }
      }
      // Stacking damage (consecutive hits on same target)
      if (ue.type === 'stacking_damage') {
        if (!stats._stackTarget) stats._stackTarget = null;
        if (!stats._stackCount) stats._stackCount = 0;
        if (stats._stackTarget === target.id) {
          stats._stackCount = Math.min((ue.maxStacks || 10), stats._stackCount + (ue.stacksPerHit || 1));
        } else {
          stats._stackTarget = target.id;
          stats._stackCount = 1;
        }
        damage = Math.floor(damage * (1 + stats._stackCount * (ue.dmgPerStack || 0.05)));
      }
      // Splash on hit (bow)
      if (ue.type === 'splash_on_hit') {
        // Store splash data for the combat handler to process AoE
        if (!attacker._pendingSplash) attacker._pendingSplash = [];
        attacker._pendingSplash.push({
          radius: ue.radius || 1,
          splashPct: ue.splashPct || 0.30,
          damage: damage,
          targetId: target.id,
        });
      }
    }

    // --- Set bonus proc effects ---
    if (stats.activeSetBonuses) {
      for (var sbi = 0; sbi < stats.activeSetBonuses.length; sbi++) {
        var sb = stats.activeSetBonuses[sbi];
        if (!sb || !sb.effects) continue;
        // Thornwarden: root on hit
        if (sb.effects.rootOnMeleeHit && Math.random() < sb.effects.rootOnMeleeHit) {
          if (!target.statusEffects) target.statusEffects = [];
          target.statusEffects.push({
            name: 'rooted',
            type: 'debuff',
            duration: sb.effects.rootDuration || 1,
            immobilize: true,
            sourceId: attacker.id,
          });
        }
        // Ashveil: fire tile persistence
        if (sb.effects.fireTilePersist && isCrit) {
          if (!attacker._pendingFireTiles) attacker._pendingFireTiles = [];
          attacker._pendingFireTiles.push({ x: target.x, y: target.y, duration: sb.effects.fireTileDuration || 3, damage: sb.effects.fireTileDamage || 8 });
        }
        // Bloodfang: berserker threshold
        if (sb.effects.berserkerThreshold && stats.hp !== undefined && stats.maxHp) {
          var hpRatio = stats.hp / stats.maxHp;
          if (hpRatio <= sb.effects.berserkerThreshold) {
            damage = Math.floor(damage * (1 + (sb.effects.berserkerDmgBonus || 0.30)));
          }
        }
      }
    }

    // Dungeon damage bonus
    if (stats.dungeonDmgBonus && stats.dungeonDmgBonus > 0) {
      damage = Math.floor(damage * (1 + stats.dungeonDmgBonus));
    }

    // Boss damage bonus
    if (target.isBoss && stats.bossDmgBonus && stats.bossDmgBonus > 0) {
      damage = Math.floor(damage * (1 + stats.bossDmgBonus));
    }

    // Vision combat bonuses: night vision grants accuracy/crit in dark areas
    if (attacker.visionType && attacker.visionType !== 'normal') {
      var visionBonuses = rpgData.getVisionCombatBonuses(attacker.visionType, attacker._ambientLight || 0.4);
      if (visionBonuses) {
        if (visionBonuses.crit > 0) {
          // Add crit bonus from vision (applied before cap below)
          // Store to add after base crit calc
          stats._visionCritBonus = visionBonuses.crit;
        }
      }
    }

    // Crit check: base critChance + crit_bonus from equipped cards
    var critChance = stats.critChance || 0;
    critChance += getCardEffectTotal(attacker, 'crit_bonus');
    // Vision crit bonus (night vision in dark areas)
    if (stats._visionCritBonus) {
      critChance += stats._visionCritBonus;
      delete stats._visionCritBonus;
    }
    if (stats._huntersInstinctCritBonus) {
      critChance += stats._huntersInstinctCritBonus;
      delete stats._huntersInstinctCritBonus;
    }
    // Animal form crit bonus (cat form +30%)
    if (attacker.statusEffects) {
      for (var afci = 0; afci < attacker.statusEffects.length; afci++) {
        if (attacker.statusEffects[afci].animalForm && attacker.statusEffects[afci].critBonus) {
          critChance += attacker.statusEffects[afci].critBonus;
        }
      }
    }
    // Cap crit at 75%
    critChance = Math.min(0.75, critChance);
    if (Math.random() < critChance) {
      isCrit = true;
      var critMult = 1.5;
      // --- Shatter Passive: +30% crit damage vs frozen/stunned targets ---
      var shatterPassive = getUnitCombatPassive(attacker, 'shatter');
      if (shatterPassive && target.statusEffects) {
        for (var shI = 0; shI < target.statusEffects.length; shI++) {
          var shSe = target.statusEffects[shI];
          if (shSe.name === 'frozen' || shSe.name === 'stunned' || shSe.name === 'knockdown') {
            critMult += (shatterPassive.value || 0.30);
            break;
          }
        }
      }
      // --- Passive: crit_damage_bonus — additional crit multiplier (e.g., Brutal Strikes +0.50) ---
      var critDmgBonusPassive = getUnitCombatPassive(attacker, 'crit_damage_bonus');
      if (critDmgBonusPassive) {
        critMult += (critDmgBonusPassive.value || 0.50);
      }
      damage = Math.floor(damage * critMult);
    }

    // Surprise round bonus: player deals +50% damage on first attack when they have surprise
    if (attacker._surpriseBonus) {
      damage = Math.floor(damage * 1.5);
      attacker._surpriseBonus = false;
    }
  } else {
    // Enemy attacking player
    var enemyAtk = (attacker.combat && attacker.combat.atk !== undefined) ? attacker.combat.atk : 0;
    // A4: Magic enemies (controller/support archetypes or elemental) use magicResist
    var isMagicEnemy = (attacker.combat && attacker.combat.element) ||
      (attacker.archetype === 'controller' || attacker.archetype === 'support');
    var playerDef;
    if (isMagicEnemy && target.combat && target.combat.magicResist) {
      playerDef = target.combat.magicResist;
    } else {
      playerDef = (target.combat && target.combat.baseArmor) ? target.combat.baseArmor : 0;
    }
    var defArmorReduction = playerDef / (playerDef + 50);
    damage = Math.max(1, Math.floor(enemyAtk * (1 - defArmorReduction)));

    // Enemies can crit too (5% base)
    if (Math.random() < 0.05) {
      isCrit = true;
      damage = Math.floor(damage * 1.5);
    }

    // Surprise round bonus: invisible enemies deal +50% damage on their first attack
    if (attacker._surpriseBonus) {
      damage = Math.floor(damage * 1.5);
      attacker._surpriseBonus = false; // Only applies to the first attack
    }
  }

  // --- Apply darkness damage modifiers ---
  // Player attacking in darkness: reduced damage (can't aim properly)
  if (darknessDamageMult < 1) {
    damage = Math.max(1, Math.floor(damage * darknessDamageMult));
  }
  // Enemy attacking blind player in darkness: bonus damage
  if (darknessEnemyDmgBonus > 1) {
    damage = Math.max(1, Math.floor(damage * darknessEnemyDmgBonus));
  }

  // Apply buff/debuff modifiers from status effects
  var damageBoostTotal = 0;
  var armorBoostTotal = 0;
  if (attacker.statusEffects) {
    for (var bsi = 0; bsi < attacker.statusEffects.length; bsi++) {
      var bse = attacker.statusEffects[bsi];
      if (bse.damageBoost) damageBoostTotal += bse.damageBoost;
    }
  }
  if (target.statusEffects) {
    for (var dsi = 0; dsi < target.statusEffects.length; dsi++) {
      var dse = target.statusEffects[dsi];
      if (dse.armorBoost) armorBoostTotal += dse.armorBoost;
      if (dse.armorReduction) armorBoostTotal -= dse.armorReduction;
      if (dse.damageReduction) {
        // damageReduction is a flat reduction
        damage = Math.max(1, damage - dse.damageReduction);
      }
    }
  }
  damage += damageBoostTotal;
  damage = Math.max(1, damage - Math.max(0, armorBoostTotal));

  // Block: if the target blocks, halve the final damage
  if (targetBlock > 0 && Math.random() < targetBlock) {
    blocked = true;
    var blockReduction = 0.5; // Default: blocks halve damage
    // --- Passive: block_damage_reduction — additional block effectiveness (Shield Wall Mastery +30%) ---
    var blockDrPassive = getUnitCombatPassive(target, 'block_damage_reduction');
    if (blockDrPassive) {
      blockReduction = Math.max(0.10, blockReduction - (blockDrPassive.value || 0.30));
    }
    damage = Math.max(1, Math.floor(damage * blockReduction));
    // --- Riposte Passive: after blocking, grant +25% damage on next attack ---
    var riposteOnBlock = getUnitCombatPassive(target, 'riposte_passive');
    if (riposteOnBlock) {
      if (!target.statusEffects) target.statusEffects = [];
      target.statusEffects.push({
        name: 'riposte',
        type: 'buff',
        duration: 2,
        damageBoost: Math.ceil((riposteOnBlock.value || 0.25) * 100),
        sourceId: target.id,
      });
    }
  }

  // --- Card passive effects applied to the defender (player only) ---
  if (target.type === 'player' && target.combat) {
    // Card: elemental_resist_all — flat percentage reduction vs all elemental damage
    if (target.combat.elementalResistAll > 0 && attacker.combat && attacker.combat.element) {
      damage = Math.max(1, Math.floor(damage * (1 - target.combat.elementalResistAll)));
    }

    // Card: low_hp_damage_reduction — damage reduction when below 30% HP
    if (target.combat.lowHpDmgReduction > 0) {
      var hpPercent = target.hp / (target.maxHp || 1);
      if (hpPercent < 0.30) {
        damage = Math.max(1, Math.floor(damage * (1 - target.combat.lowHpDmgReduction)));
      }
    }
  }

  // --- Passive: flat_damage_reduction — flat damage subtracted (Stone Skin, Magic Ward) ---
  var flatDrPassive = getUnitCombatPassive(target, 'flat_damage_reduction');
  if (flatDrPassive && damage > 0) {
    var flatDrElement = flatDrPassive.element || 'physical';
    var atkElement = (attacker.combat && attacker.combat.element) || 'physical';
    // 'physical' passive reduces physical damage, 'magic' reduces magic damage
    if (flatDrElement === atkElement || flatDrElement === 'all') {
      damage = Math.max(1, damage - (flatDrPassive.value || 3));
    }
  }

  // --- Passive: adaptive_resist — 20% resist to last element that hit you ---
  var adaptResistPassive = getUnitCombatPassive(target, 'adaptive_resist');
  if (adaptResistPassive && damage > 0) {
    var arAtkElement = (attacker.combat && attacker.combat.element) || 'physical';
    // Apply resist if the current element matches the last element that hit this target
    if (target._lastHitElement && target._lastHitElement === arAtkElement) {
      damage = Math.max(1, Math.floor(damage * (1 - (adaptResistPassive.value || 0.20))));
    }
    // Track the current element for next hit
    target._lastHitElement = arAtkElement;
  }

  // --- Passive: damage_sponge — scaling DR based on missing HP (-1% per 10% HP missing) ---
  var damageSpongePassive = getUnitCombatPassive(target, 'damage_sponge');
  if (damageSpongePassive && damage > 0) {
    var dsHpRatio = target.hp / (target.maxHp || 1);
    var dsMissingTens = Math.floor((1 - dsHpRatio) * 10); // 0-10 representing 0%-100% missing
    var dsDrPercent = dsMissingTens * (damageSpongePassive.lowHpDamageReduction || 0.01);
    if (dsDrPercent > 0) {
      damage = Math.max(1, Math.floor(damage * (1 - dsDrPercent)));
    }
  }

  // Card: counter_chance_bonus — chance for defender to deal counter damage
  var counterDamage = 0;
  if (target.type === 'player' && target.combat && target.combat.counterChanceBonus > 0) {
    if (Math.random() < target.combat.counterChanceBonus) {
      // Counter deals 50% of the player's basic attack damage back to attacker
      var counterAtk = (target.combat.might || 5) * 2 + (target.combat.weaponDamage || 0);
      counterDamage = Math.max(1, Math.floor(counterAtk * 0.5));
    }
  }

  var darknessPenalized = darknessDamageMult < 1 || darknessEnemyDmgBonus > 1;
  return { baseDamage: damage, isCrit: isCrit, finalDamage: damage, dodged: false, blocked: blocked, counterDamage: counterDamage, darknessPenalized: darknessPenalized, parried: false, offHandStrike: offHandStrike, offHandDamage: offHandDamageDealt };
}

module.exports = {
  calculateDamage: calculateDamage,
};
