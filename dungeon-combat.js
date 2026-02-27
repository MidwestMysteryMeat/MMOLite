// dungeon-combat.js
// Core turn-based combat engine for dungeon tactical combat instances.
// Manages combat state, CT (charge time) initiative, simultaneous player turns,
// movement via BFS, basic attacks, momentum shield, exhaustion, and AI delegation.
//
// This module is self-contained. Combat instances live in the module-level
// activeCombats Map and are NOT stored in state.js. The dungeon handler
// creates combats via initCombat() and routes player socket actions through
// handlePlayerAction().

'use strict';

var rpgData = require('./rpg-data');
var dungeonAI = require('./dungeon-ai');
var dungeonData = require('./dungeon-data');
var combatTiles = require('./combat-tiles');
var combatSync = require('./combat-sync');
var lootGen = require('./loot-generator');

var TILE = dungeonData.TILE;
var combatGrid = require('./combat-grid');
var { isWalkableCombat, isWalkableExcluding, getAdjacentTiles, get8Neighbors, manhattanDist, chebyshevDist, isAdjacent, euclideanDist, bfsMovementRange, bfsPath, calculateMoveRange, validateMove, WALKABLE_TILES } = combatGrid;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var PLAYER_BASE_MP       = 3;    // Movement points per turn (players)
var PLAYER_BASE_AP       = 1;    // Action points per turn
var PLAYER_BASE_RP       = 1;    // Reaction points per round
var TURN_TIMER_MS        = 15000; // 15 seconds for player decision
var ENEMY_ANIM_DELAY_MS  = 500;  // Artificial delay for enemy animations
var CT_THRESHOLD         = 100;  // CT needed to act
var CT_SIMULTANEOUS_BAND = 5;    // CT range for grouping simultaneous player turns
// Exhaustion constants — sourced from combat-status-effects.js (see require below)
var CT_RESET_ATTACKED    = 0;    // CT after attacking
var CT_RESET_MOVED_ONLY  = 20;   // CT after only moving (no attack)
var CT_RESET_WAITED      = 40;   // CT after waiting (no action taken)
var INITIAL_CT_RANDOM    = 20;   // Max random CT added at combat start
var MELEE_RANGE          = 1.5;  // Diagonal adjacency threshold (sqrt(2) ~ 1.41)
var MANA_REGEN_PER_TURN  = 3;    // Base mana regeneration per turn

// Resource system constants (4-pool: mana, stamina, bloodlust, focus)
var STAMINA_REGEN_PER_TURN   = 2;    // Base stamina regen per turn
var BLOODLUST_ON_KILL        = 15;   // Bloodlust gained per kill
var BLOODLUST_ON_HIT         = 3;    // Bloodlust gained per attack that deals damage
var BLOODLUST_ON_TAKE_DAMAGE = 2;    // Bloodlust gained when taking damage
var BLOODLUST_DECAY_PER_TURN = 3;    // Bloodlust lost per turn with no action (REDUCED from 5)
var BLOODLUST_DECAY_DELAY    = 2;    // Turns of inactivity before decay begins
var FOCUS_CONSECUTIVE_GAIN   = 10;   // Focus gained per consecutive action on same target
var FOCUS_BASIC_ATTACK_GAIN  = 5;    // Focus gained from basic attacks on same target
var FOCUS_STARTING_VALUE     = 10;   // Starting focus at combat begin
var FOCUS_BASE_RETAIN        = 0.25; // Base % of focus retained on target switch

// Rally system constants (large-group reinforcement scaling)
var RALLY_PLAYER_THRESHOLD    = 5;      // Start rallying at 5+ players
var RALLY_INTERVAL_TURNS      = 2;      // Spawn reinforcements every 2 turns
var RALLY_MAX_ENEMIES         = 20;     // Max enemies in combat at once
var RALLY_STAT_SCALE_PER_PLAYER = 0.10; // +10% HP/ATK per player beyond 4

// Solo/small-party difficulty scaling (inverse of rally)
var SOLO_HP_SCALE    = 0.80;  // Solo:  -20% enemy HP (raised from 0.70)
var SOLO_ATK_SCALE   = 0.75;  // Solo:  -25% enemy ATK (raised from 0.70)
var DUO_HP_SCALE     = 0.90;  // Duo:   -10% enemy HP (raised from 0.85)
var DUO_ATK_SCALE    = 0.88;  // Duo:   -12% enemy ATK (raised from 0.85)
var TRIO_HP_SCALE    = 0.97;  // Trio:  -3% enemy HP (raised from 0.95)
var TRIO_ATK_SCALE   = 0.95;  // Trio:  -5% enemy ATK (unchanged)
// 4 players = 1.0 (baseline)
// 5+ players = existing rally scaling (+10% per player above 4)

// Offline mode bonus
var OFFLINE_STAT_SCALE  = 0.90;  // -10% enemy stats in offline mode
var OFFLINE_XP_BONUS    = 1.10;  // +10% XP in offline (reduced from 20% to not devalue multiplayer)
var OFFLINE_GOLD_BONUS  = 1.00;  // no gold bonus offline (grouping should be more rewarding)

// ---------------------------------------------------------------------------
// Combat passive helpers (extracted to combat-passive-helpers.js)
// ---------------------------------------------------------------------------

var combatPassives = require('./combat-passive-helpers');
var getUnitCombatPassive    = combatPassives.getUnitCombatPassive;
var getUnitCombatPassiveTotal = combatPassives.getUnitCombatPassiveTotal;
var hasImmunity             = combatPassives.hasImmunity;
var hasCCImmunity           = combatPassives.hasCCImmunity;
var getCardEffectTotal      = combatPassives.getCardEffectTotal;
var getUnitOnHitAffixes     = combatPassives.getUnitOnHitAffixes;

var combatDamage = require('./combat-damage');
var calculateDamage = combatDamage.calculateDamage;

// ---------------------------------------------------------------------------
// Module-level combat storage
// ---------------------------------------------------------------------------

var activeCombats = new Map(); // combatId -> combat object

// Reverse lookup: socketId -> combatId (for fast lookup on player actions)
var socketToCombat = new Map();

// ---------------------------------------------------------------------------
// Extracted module requires (Phase 4-5)
// ---------------------------------------------------------------------------
var combatRaidBoss = require('./combat-raid-boss');
var updateThreat              = combatRaidBoss.updateThreat;
var getTopThreats             = combatRaidBoss.getTopThreats;
var selectBossTarget          = combatRaidBoss.selectBossTarget;
var spawnCombatAdd            = combatRaidBoss.spawnCombatAdd;
var getLichRaidPhase           = combatRaidBoss.getLichRaidPhase;
var handleLichRaidPhaseTransition = combatRaidBoss.handleLichRaidPhaseTransition;
var checkPhylacteries         = combatRaidBoss.checkPhylacteries;
var initRaidBossCombat        = combatRaidBoss.initRaidBossCombat;
var executeLichRaidBossTurn   = combatRaidBoss.executeLichRaidBossTurn;
var LICH_RAID_PHASES          = combatRaidBoss.LICH_RAID_PHASES;

var combatStatusEffects = require('./combat-status-effects');
var EXHAUSTION_START      = combatStatusEffects.EXHAUSTION_START;
var EXHAUSTION_START_BOSS = combatStatusEffects.EXHAUSTION_START_BOSS;
var EXHAUSTION_PER_TURN   = combatStatusEffects.EXHAUSTION_PER_TURN;
var tickStatusEffects     = combatStatusEffects.tickStatusEffects;
var checkExhaustion       = combatStatusEffects.checkExhaustion;

var combatAI = require('./combat-ai-enemy');
var processNPCActions     = combatAI.processNPCActions;
var decideNPCAction       = combatAI.decideNPCAction;
var pauseForReaction      = combatAI.pauseForReaction;
var findPlayerAttackEvent = combatAI.findPlayerAttackEvent;
var finishEnemyTurn       = combatAI.finishEnemyTurn;
var startEnemyTurn        = combatAI.startEnemyTurn;
var fallbackAI            = combatAI.fallbackAI;
var executeAIAction       = combatAI.executeAIAction;
var trimPathForAttack     = combatAI.trimPathForAttack;

var combatQueries = require('./combat-queries');
var getCombatState        = combatQueries.getCombatState;
var getCombatBySocketId   = combatQueries.getCombatBySocketId;
var getActiveCombats      = combatQueries.getActiveCombats;
var buildInitiativeOrder  = combatQueries.buildInitiativeOrder;
var serializeUnits        = combatQueries.serializeUnits;
var getPlayerSocketIds    = combatQueries.getPlayerSocketIds;
var getEnemyList          = combatQueries.getEnemyList;
var getPlayerList          = combatQueries.getPlayerList;
var getUnitAtPosition     = combatQueries.getUnitAtPosition;
var getUnitsInRadius      = combatQueries.getUnitsInRadius;
var getValidAttackTargets = combatQueries.getValidAttackTargets;

var combatMovement = require('./combat-movement');
var executeMove                = combatMovement.executeMove;
var checkOpportunityAttacks    = combatMovement.checkOpportunityAttacks;
var calculateOpportunityDamage = combatMovement.calculateOpportunityDamage;
var applyMomentumShield        = combatMovement.applyMomentumShield;

var combatScaling = require('./combat-scaling');
var countAlivePlayers    = combatScaling.countAlivePlayers;
var applyGroupScaling    = combatScaling.applyGroupScaling;
var applyRaidScaling     = combatScaling.applyRaidScaling;
var checkReinforcements  = combatScaling.checkReinforcements;

var combatPlayerActions = require('./combat-player-actions');
var handlePlayerAction     = combatPlayerActions.handlePlayerAction;
var handleMoveAction       = combatPlayerActions.handleMoveAction;
var handleAttackAction     = combatPlayerActions.handleAttackAction;
var handleAbilityAction    = combatPlayerActions.handleAbilityAction;
var handleWaitAction       = combatPlayerActions.handleWaitAction;
var handleNPCHealAction    = combatPlayerActions.handleNPCHealAction;
var handleSwapCardAction   = combatPlayerActions.handleSwapCardAction;
var handleUseItemAction    = combatPlayerActions.handleUseItemAction;
var handleEndTurnAction    = combatPlayerActions.handleEndTurnAction;

var combatPlayerMgmt = require('./combat-player-mgmt');
var addPlayerToCombat      = combatPlayerMgmt.addPlayerToCombat;
var handlePlayerDisconnect = combatPlayerMgmt.handlePlayerDisconnect;
var handlePlayerReconnect  = combatPlayerMgmt.handlePlayerReconnect;

// ---------------------------------------------------------------------------
// Deferred init: inject dependencies after all requires are resolved.
// Function declarations (executeBasicAttack, executeAbility, etc.) are hoisted.
// Var-based imports (from modules above) are set synchronously at require time.
// ---------------------------------------------------------------------------
combatQueries.init({
  activeCombats: activeCombats,
  socketToCombat: socketToCombat,
});

combatMovement.init({
  handleUnitDeath: handleUnitDeath,
});

combatScaling.init({
  SOLO_HP_SCALE: SOLO_HP_SCALE,
  SOLO_ATK_SCALE: SOLO_ATK_SCALE,
  DUO_HP_SCALE: DUO_HP_SCALE,
  DUO_ATK_SCALE: DUO_ATK_SCALE,
  TRIO_HP_SCALE: TRIO_HP_SCALE,
  TRIO_ATK_SCALE: TRIO_ATK_SCALE,
  OFFLINE_STAT_SCALE: OFFLINE_STAT_SCALE,
  RALLY_PLAYER_THRESHOLD: RALLY_PLAYER_THRESHOLD,
  RALLY_INTERVAL_TURNS: RALLY_INTERVAL_TURNS,
  RALLY_MAX_ENEMIES: RALLY_MAX_ENEMIES,
  RALLY_STAT_SCALE_PER_PLAYER: RALLY_STAT_SCALE_PER_PLAYER,
});

combatRaidBoss.init({
  activeCombats:     activeCombats,
  initCombat:        initCombat,
  getUnitAtPosition: getUnitAtPosition,
  handleUnitDeath:   handleUnitDeath,
  checkCombatEnd:    checkCombatEnd,
  endCombat:         endCombat,
  advanceCombat:     advanceCombat,
});

combatStatusEffects.init({
  handleUnitDeath: handleUnitDeath,
  getUnitsInRadius: getUnitsInRadius,
});

combatAI.init({
  activeCombats:      activeCombats,
  handlePlayerAction: handlePlayerAction,
  executeMove:        executeMove,
  executeBasicAttack: executeBasicAttack,
  executeAbility:     executeAbility,
  handleUnitDeath:    handleUnitDeath,
  checkCombatEnd:     checkCombatEnd,
  endCombat:          endCombat,
  advanceCombat:      advanceCombat,
  endUnitTurn:        endUnitTurn,
  getUnitsInRadius:   getUnitsInRadius,
  getUnitAtPosition:  getUnitAtPosition,
  checkExhaustion:    checkExhaustion,
  PLAYER_BASE_AP:     PLAYER_BASE_AP,
  ENEMY_ANIM_DELAY_MS: ENEMY_ANIM_DELAY_MS,
});

combatPlayerActions.init({
  activeCombats:      activeCombats,
  executeMove:        executeMove,
  executeBasicAttack: executeBasicAttack,
  executeAbility:     executeAbility,
  endUnitTurn:        endUnitTurn,
  handleUnitDeath:    handleUnitDeath,
  checkCombatEnd:     checkCombatEnd,
  endCombat:          endCombat,
  getValidAttackTargets: getValidAttackTargets,
  updateThreat:       updateThreat,
});

combatPlayerMgmt.init({
  activeCombats:        activeCombats,
  socketToCombat:       socketToCombat,
  endUnitTurn:          endUnitTurn,
  applyGroupScaling:    applyGroupScaling,
  checkReinforcements:  checkReinforcements,
  serializeUnits:       serializeUnits,
  buildInitiativeOrder: buildInitiativeOrder,
  PLAYER_BASE_MP:       PLAYER_BASE_MP,
  PLAYER_BASE_AP:       PLAYER_BASE_AP,
  PLAYER_BASE_RP:       PLAYER_BASE_RP,
  FOCUS_STARTING_VALUE: FOCUS_STARTING_VALUE,
});

// Shared card-effect tracking Maps (extracted to combat-state-maps.js)
var _maps = require('./combat-state-maps');
var _hotStreakCounts      = _maps.hotStreakCounts;
var _comboState           = _maps.comboState;
var _playerClones         = _maps.playerClones;
var _lilyTokens           = _maps.lilyTokens;
var _soulShards           = _maps.soulShards;
var _dancePartners        = _maps.dancePartners;
var _staggerDoTs          = _maps.staggerDoTs;
var _deathShrouds         = _maps.deathShrouds;
var _soulstones           = _maps.soulstones;
var _intercepts           = _maps.intercepts;
var _innervates           = _maps.innervates;
var _fadeActive           = _maps.fadeActive;
var _divineInvulnerability = _maps.divineInvulnerability;


// ---------------------------------------------------------------------------
// Attack execution
// ---------------------------------------------------------------------------

/**
 * Execute a basic attack from attacker to target.
 * Validates range, calculates damage, applies momentum shield, checks death.
 *
 * Returns result object or error.
 */
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
      // --- lifesteal: heal attacker for percentage of damage dealt ---
      else if (effType === 'lifesteal') {
        var lsAmt = Math.floor(damageToHp * (eff.value || 0.06));
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


/**
 * Compute a dynamic turn timer based on the number of alive players.
 * More players = shorter timer to keep the game moving.
 */
function getDynamicTurnTimer(combat) {
  // Lich raid: fixed 10s per party group action
  if (combat.isLichRaid) return 10000;

  var playerCount = 0;
  var iter = combat.units.values();
  var entry = iter.next();
  while (!entry.done) {
    if (entry.value.type === 'player' && entry.value.alive) playerCount++;
    entry = iter.next();
  }
  if (playerCount >= 12) return 8000;
  if (playerCount >= 8) return 10000;
  if (playerCount >= 5) return 12000;
  return TURN_TIMER_MS; // 15000
}

// ---------------------------------------------------------------------------
// Combat state machine
// ---------------------------------------------------------------------------

/**
 * Initialize a new turn-based combat instance.
 *
 * @param {string} dungeonId     - The dungeon this combat is in
 * @param {Array}  players       - Player data [{socketId, x, y, name, race, rpgStats, level, equippedCards, combat}]
 * @param {Array}  enemies       - Enemy data  [{id, name, x, y, hp, maxHp, atk, def, speed, archetype, abilities, ...}]
 * @param {Object} floor         - Floor object with grid, width, height
 * @param {Object} callbacks     - { broadcastToFloor, emitToPlayer, getPlayerInfo, handleDeath, awardKillRewards }
 * @returns {string} combatId
 */
function initCombat(dungeonId, players, enemies, floor, callbacks) {
  var timestamp = Date.now();
  var combatId = 'combat_' + dungeonId + '_' + timestamp;

  var combat = {
    id: combatId,
    dungeonId: dungeonId,
    floor: floor,
    turnNumber: 0,
    state: 'combat_start',
    units: new Map(),
    tileEffects: [],
    groundZones: [],
    corpses: [],
    turnTimer: null,
    turnGroup: [],
    pendingActions: new Map(),
    exhaustionDamage: 0,
    callbacks: callbacks || {},
  };

  // Convert players to unit entries
  for (var pi = 0; pi < players.length; pi++) {
    var p = players[pi];
    var pCombat = p.combat || {};
    var pSpeed = rpgData.computeCombatSpeed(
      p.race || null,
      (p.rpgStats && p.rpgStats.finesse) ? p.rpgStats.finesse : 5,
      p.equippedCards || []
    );
    // A1: Weapon speed multiplier (daggers ~1.3 = faster CT, 2H swords ~0.7 = slower CT)
    var weaponSpeedMult = pCombat.weaponSpeed || 1.0;
    weaponSpeedMult = Math.max(0.5, Math.min(1.5, weaponSpeedMult));
    pSpeed = Math.max(1, Math.round(pSpeed * weaponSpeedMult));
    // A3: Armor speed penalty (heavy armor has negative totalSpeedMod)
    var armorSpeedMod = pCombat.armorSpeedMod || 0;
    pSpeed = Math.max(1, Math.round(pSpeed * (1 + armorSpeedMod)));
    var pUnitId = 'player_' + p.socketId;

    var playerUnit = {
      id: pUnitId,
      type: 'player',
      socketId: p.socketId,
      name: p.name || 'Unknown',
      x: p.x,
      y: p.y,
      ct: Math.floor(Math.random() * INITIAL_CT_RANDOM) + pSpeed,
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
        bloodlust: pCombat.bloodlust || 0,  // Starts at 0, gained on kill/hit
        maxBloodlust: pCombat.maxBloodlust || rpgData.computeResourceMax('bloodlust', p.race, 0),
        focus: pCombat.focus || FOCUS_STARTING_VALUE,  // Start with 10 focus (cold-start fix)
        maxFocus: pCombat.maxFocus || rpgData.computeResourceMax('focus', p.race, 0),
        primaryResource: rpgData.RACE_PRIMARY_RESOURCE[p.race] || 'mana',
        meleeDmgMult: pCombat.meleeDmgMult || 1,
        magicDmgMult: pCombat.magicDmgMult || 1,
        critChance: pCombat.critChance || 0.05,
        dodgeChance: pCombat.dodgeChance || 0,
        baseArmor: pCombat.baseArmor || 0,
        magicResist: pCombat.magicResist || 0,
        weaponDamage: pCombat.weaponDamage || 0,
        weaponRange: pCombat.weaponRange || 1.5,
        weaponCategory: pCombat.weaponCategory || 'melee_blade',
        armorType: pCombat.armorType || 'none',
        armorSpeedMod: pCombat.armorSpeedMod || 0,
        weaponSpeed: pCombat.weaponSpeed || 1.0,
        blockChance: pCombat.blockChance || 0,
        dungeonDmgBonus: pCombat.dungeonDmgBonus || 0,
        bossDmgBonus: pCombat.bossDmgBonus || 0,
        dungeonDefBonus: pCombat.dungeonDefBonus || 0,
        hpRegen: pCombat.hpRegen || 0,
        element: pCombat.element || null,
        // Card passive effects (from initPlayerCombatState in dungeon.js)
        spellDmgBonus: pCombat.spellDmgBonus || 0,
        poisonDmgBonus: pCombat.poisonDmgBonus || 0,
        counterChanceBonus: pCombat.counterChanceBonus || 0,
        manaEfficiency: pCombat.manaEfficiency || 0,
        elementalResistAll: pCombat.elementalResistAll || 0,
        lowHpDmgReduction: pCombat.lowHpDmgReduction || 0,
      },
      level: p.level || 1,
      race: p.race || 'human',
      equippedCards: p.equippedCards || [],
      archetype: null,
      alive: true,
      autoDefend: false,
      // Darkness/vision data for combat penalty system
      visionType: p.visionType || 'normal',
      _ambientLight: (p._ambientLight !== undefined) ? p._ambientLight : 0.4,
      _isDarkFloor: p._isDarkFloor || false,
      _hasTorch: p._hasTorch || false,
      _hasLantern: p._hasLantern || false,
      // NPC raid companion data
      _isNPC: p.isNPC || false,
      _npcRole: p.npcRole || null,
      // Resource tracking fields
      _lastTargetId: null,   // For focus consecutive tracking
      _killThisTurn: false,  // For bloodlust decay tracking
      _lastActionTurn: 0,    // For bloodlust decay delay tracking
    };

    combat.units.set(pUnitId, playerUnit);
    socketToCombat.set(p.socketId, combatId);

    // --- Passive: hp_multiplier — Fortified Body: +15% max HP at combat start ---
    var hpMultPassive = getUnitCombatPassive(playerUnit, 'hp_multiplier');
    if (hpMultPassive) {
      var hpMultBonus = Math.max(1, Math.floor(playerUnit.maxHp * (hpMultPassive.value || 0.15)));
      playerUnit.maxHp += hpMultBonus;
      playerUnit.hp += hpMultBonus;
      // Apply speed penalty if present
      if (hpMultPassive.speedPenalty) {
        playerUnit.speed = Math.max(1, Math.round(playerUnit.speed * (1 - hpMultPassive.speedPenalty)));
      }
    }
    // --- Passive: damage_sponge — +15% max HP at combat start ---
    var dSpongeCombatPassive = getUnitCombatPassive(playerUnit, 'damage_sponge');
    if (dSpongeCombatPassive && dSpongeCombatPassive.hpBonusPercent) {
      var dsHpBonus = Math.max(1, Math.floor(playerUnit.maxHp * dSpongeCombatPassive.hpBonusPercent));
      playerUnit.maxHp += dsHpBonus;
      playerUnit.hp += dsHpBonus;
    }
  }

  // Convert enemies to unit entries
  for (var ei = 0; ei < enemies.length; ei++) {
    var e = enemies[ei];
    var eId = e.id || ('enemy_' + ei + '_' + timestamp);
    var eSpeed = e.speed || 8;
    var eArchetype = e.archetype || 'bruiser';

    // Determine enemy MP from archetype
    var archData = dungeonAI.ARCHETYPES[eArchetype];
    var eMP = (archData && archData.speed) ? archData.speed + 1 : 2;

    var enemyUnit = {
      id: eId,
      type: 'enemy',
      enemyType: e.type || null,
      socketId: null,
      name: e.name || 'Enemy',
      x: e.x,
      y: e.y,
      ct: Math.floor(Math.random() * INITIAL_CT_RANDOM) + eSpeed,
      speed: eSpeed,
      hp: e.hp || 50,
      maxHp: e.maxHp || e.hp || 50,
      mp: eMP,
      ap: PLAYER_BASE_AP,
      rp: PLAYER_BASE_RP,
      momentumShield: 0,
      statusEffects: [],
      combat: {
        atk: e.atk || 10,
        def: e.def || 5,
        magicResist: e.magicResist || 0,
        range: e.range || 1,
        speed: eSpeed,
        element: e.element || null,
        armorType: e.armorType || 'none',
      },
      equippedCards: [],
      archetype: eArchetype,
      abilities: e.abilities || [],
      isBoss: e.isBoss || false,
      invincible: e.invincible || false,
      xp: e.xp || 10,
      gold: e.gold || 0,
      lootTable: e.lootTable || null,
      alive: true,
      autoDefend: false,
      _baseHp: e.hp || 50,
      _baseAtk: e.atk || 10,
      _baseWeaponDamage: e.weaponDamage || 0,
    };

    combat.units.set(eId, enemyUnit);
  }

  // Flag boss fights for extended exhaustion timer
  combat._hasBoss = false;
  for (var bi = 0; bi < enemies.length; bi++) {
    if (enemies[bi].isBoss) { combat._hasBoss = true; break; }
  }

  // Flag water floors for aquatic archetype bonuses
  // Water-themed floors: flooded_ruins, tidal_vault, sunken_depths, ocean_arena, coral_grotto, sunken_cathedral
  // Also, LAKE layout floors are water-filled regardless of theme
  var waterThemes = { flooded_ruins: true, tidal_vault: true, sunken_depths: true, ocean_arena: true, coral_grotto: true, sunken_cathedral: true };
  var floorTheme = floor ? floor.theme : null;
  var floorLayout = floor ? floor.layout : null;
  combat._isWaterFloor = !!(floorTheme && waterThemes[floorTheme]) || (floorLayout === 'lake');

  // Surprise round: if enemy was invisible and player couldn't see it,
  // enemies get a free first action with +50% damage.
  // surpriseData is passed from dungeon.js initiateTurnCombat.
  var surpriseData = (callbacks && callbacks.surpriseData) ? callbacks.surpriseData : null;
  combat._surpriseRound = false;
  if (surpriseData && surpriseData.isSurprise) {
    combat._surpriseRound = true;
    combat._surpriseType = surpriseData.invisibilityType || 'unknown';
    // Boost enemy CT so they act first in the surprise round
    combat.units.forEach(function(unit) {
      if (unit.type === 'enemy' && unit.alive) {
        unit.ct = CT_THRESHOLD + 10; // Guarantee enemies act first
        unit._surpriseBonus = true;  // +50% damage on first attack this combat
      }
    });
    // Reduce player CT so they act after the surprise
    combat.units.forEach(function(unit) {
      if (unit.type === 'player' && unit.alive) {
        unit.ct = 0; // Players start at 0 CT in a surprise round
      }
    });
  }

  // Store original enemy templates for rally reinforcements
  combat.enemyTemplates = [];
  for (var eti = 0; eti < enemies.length; eti++) {
    combat.enemyTemplates.push({
      name: enemies[eti].name,
      hp: enemies[eti].hp || enemies[eti].maxHp || 50,
      maxHp: enemies[eti].maxHp || enemies[eti].hp || 50,
      atk: enemies[eti].atk || 10,
      def: enemies[eti].def || 5,
      speed: enemies[eti].speed || 8,
      range: enemies[eti].range || 1,
      archetype: enemies[eti].archetype || 'bruiser',
      level: enemies[eti].level || 1,
    });
  }

  // Store combat
  activeCombats.set(combatId, combat);

  // Apply group scaling (solo/duo/trio/party/rally)
  applyGroupScaling(combat);

  // Apply raid scaling for raid combats (8+ players)
  if (callbacks && callbacks.isRaid) {
    combat.isRaidCombat = true;
    applyRaidScaling(combat);
  }

  // Build initiative order for the start broadcast
  var initiative = buildInitiativeOrder(combat);

  // Broadcast combat start to all players
  var playerIds = getPlayerSocketIds(combat);
  var enemyList = getEnemyList(combat);
  var playerList = getPlayerList(combat);

  if (combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_combat_start', {
      combatId: combatId,
      players: playerList,
      enemies: enemyList,
      initiative: initiative,
      turnNumber: 0,
      groupScaling: combat.groupScaling ? {
        tier: combat.groupScaling.tier,
        hpMult: combat.groupScaling.hpMult,
        atkMult: combat.groupScaling.atkMult,
        offlineMode: combat.groupScaling.offlineMode || false,
      } : null,
      surpriseRound: combat._surpriseRound ? {
        type: combat._surpriseType || 'unknown',
        message: 'An invisible enemy ambushes you!',
      } : null,
    });
  }

  // Begin CT advancement after a short delay for the client to set up
  combat.state = 'ct_advance';
  setTimeout(function() {
    advanceCombat(combat);
  }, 300);

  return combatId;
}

// ---------------------------------------------------------------------------
// CT (Charge Time) system
// ---------------------------------------------------------------------------

/**
 * Advance CT for all alive units by their speed value.
 * Returns array of units that reached CT >= 100.
 */
function tickCT(combat) {
  var ready = [];
  var iter = combat.units.values();
  var entry = iter.next();

  while (!entry.done) {
    var unit = entry.value;
    entry = iter.next();

    if (!unit.alive) continue;

    // Check for slow status effect
    var speedMult = 1;
    for (var si = 0; si < unit.statusEffects.length; si++) {
      var se = unit.statusEffects[si];
      if (se.speedMult !== undefined && se.speedMult < speedMult) {
        speedMult = se.speedMult;
      }
    }

    // Check tile effect speed modifier (FROZEN, WATER slow CT gain)
    var tileSpeedMod = combatTiles.getSpeedModifier(combat, unit.x, unit.y);
    if (tileSpeedMod !== 0) {
      speedMult *= (1 + tileSpeedMod / 100); // e.g. -50 means 50% slower
      if (speedMult < 0.1) speedMult = 0.1;
    }

    unit.ct += unit.speed * speedMult;

    if (unit.ct >= CT_THRESHOLD) {
      ready.push(unit);
    }
  }

  return ready;
}

/**
 * Group simultaneous player turns.
 * Players with CT within CT_SIMULTANEOUS_BAND of each other act together.
 * Enemies always act individually.
 */
function groupSimultaneousTurns(combat, readyUnits) {
  var players = [];
  var enemies = [];

  for (var i = 0; i < readyUnits.length; i++) {
    if (readyUnits[i].type === 'player') {
      players.push(readyUnits[i]);
    } else {
      enemies.push(readyUnits[i]);
    }
  }

  // Sort both by CT descending (highest CT goes first)
  players.sort(function(a, b) { return b.ct - a.ct; });
  enemies.sort(function(a, b) { return b.ct - a.ct; });

  // Group players: start with highest CT player, include any within BAND
  var groupedPlayers = [];
  if (players.length > 0) {
    var topCT = players[0].ct;
    for (var pi = 0; pi < players.length; pi++) {
      if (topCT - players[pi].ct <= CT_SIMULTANEOUS_BAND) {
        groupedPlayers.push(players[pi].id);
      }
    }
  }

  var enemyIds = [];
  for (var ei = 0; ei < enemies.length; ei++) {
    enemyIds.push(enemies[ei].id);
  }

  return { players: groupedPlayers, enemies: enemyIds };
}

// ---------------------------------------------------------------------------
// Combat advancement (main loop driver)
// ---------------------------------------------------------------------------

/**
 * Main combat loop driver. Called after each turn ends or at combat start.
 * Ticks CT until someone reaches 100, then starts appropriate turn.
 */
function advanceCombat(combat) {
  // Safety: combat may have been cleaned up
  if (!activeCombats.has(combat.id)) return;
  if (combat.state === 'combat_end') return;

  // Check victory/defeat conditions
  var checkResult = checkCombatEnd(combat);
  if (checkResult) {
    endCombat(combat, checkResult);
    return;
  }

  // Leviathan phase/enrage check after each turn cycle
  if (combat._isLeviathanCombat && combat.callbacks.checkPhase) {
    combat.callbacks.checkPhase(combat);
  }

  // Check for rally reinforcements at the start of each cycle
  checkReinforcements(combat);

  // Set state to CT advance
  combat.state = 'ct_advance';

  // Tick ability cooldowns for all units each CT cycle
  tickAbilityCooldowns(combat);

  // Process tile effects (tick durations, apply damage)
  combatTiles.processTileEffects(combat);

  // Tick CT until at least one unit reaches threshold
  var maxTicks = 200; // Safety limit to prevent infinite loops
  var ready = [];
  var tickCount = 0;

  while (ready.length === 0 && tickCount < maxTicks) {
    ready = tickCT(combat);
    tickCount++;
  }

  if (ready.length === 0) {
    // No units ready after max ticks — all units dead or speed 0
    endCombat(combat, 'defeat');
    return;
  }

  // Group simultaneous turns
  var groups = groupSimultaneousTurns(combat, ready);

  // Priority: highest CT unit acts first
  // If both players and enemies are ready, the one with highest CT goes first
  var topPlayerCT = 0;
  var topEnemyCT = 0;

  if (groups.players.length > 0) {
    var topPlayer = combat.units.get(groups.players[0]);
    if (topPlayer) topPlayerCT = topPlayer.ct;
  }
  if (groups.enemies.length > 0) {
    var topEnemy = combat.units.get(groups.enemies[0]);
    if (topEnemy) topEnemyCT = topEnemy.ct;
  }

  // Lich Raid: override turn cycle with party-group rotation + multi-action boss
  if (combat.isLichRaid && combat.partyGroups) {
    // Party rotation: pick the next party group that has alive members
    if (!combat._lichRaidPartyIndex) combat._lichRaidPartyIndex = 0;
    if (!combat._lichRaidAllPartiesActed) combat._lichRaidAllPartiesActed = 0;

    var partyFound = false;
    var startIdx = combat._lichRaidPartyIndex;
    for (var pi = 0; pi < combat.partyGroups.length; pi++) {
      var idx = (startIdx + pi) % combat.partyGroups.length;
      var partyGroup = combat.partyGroups[idx];
      var aliveIds = [];
      for (var mi = 0; mi < partyGroup.length; mi++) {
        var u = combat.units.get(partyGroup[mi]);
        if (u && u.alive) aliveIds.push(partyGroup[mi]);
      }
      if (aliveIds.length > 0) {
        combat._lichRaidPartyIndex = (idx + 1) % combat.partyGroups.length;
        combat._lichRaidAllPartiesActed++;
        startPlayerTurn(combat, aliveIds);
        partyFound = true;
        break;
      }
    }

    if (!partyFound) {
      // No players alive — defeat
      endCombat(combat, 'defeat');
      return;
    }

    // After all party groups have had a turn, boss gets multi-actions
    if (combat._lichRaidAllPartiesActed >= combat.partyGroups.length) {
      combat._lichRaidAllPartiesActed = 0;
      // Schedule boss multi-action after the current player turn resolves
      combat._lichRaidBossTurnPending = true;
    }
    return;
  }

  if (groups.players.length > 0 && topPlayerCT >= topEnemyCT) {
    startPlayerTurn(combat, groups.players);
  } else if (groups.enemies.length > 0) {
    startEnemyTurn(combat, groups.enemies[0]);
  } else if (groups.players.length > 0) {
    startPlayerTurn(combat, groups.players);
  } else {
    // Should not happen, but just in case
    endCombat(combat, 'defeat');
  }
}

// ---------------------------------------------------------------------------
// Player turn
// ---------------------------------------------------------------------------

/**
 * Start a grouped player turn. Multiple players may act simultaneously.
 */
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
            if (paTarget.hp <= 0) {
              paTarget.alive = false;
              paTarget.hp = 0;
              handleUnitDeath(combat, paTarget.id, unit.id);
            }
            if (combat.callbacks.broadcastToFloor) {
              combat.callbacks.broadcastToFloor('tc_combat_passive_damage', {
                combatId: combat.id,
                sourceId: unit.id,
                targetId: paTarget.id,
                damage: poisonAuraValue,
                targetHp: Math.max(0, paTarget.hp),
                targetMaxHp: paTarget.maxHp,
                passive: 'poison_aura',
              });
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
            if (bhTarget.hp <= 0) { bhTarget.alive = false; bhTarget.hp = 0; handleUnitDeath(combat, bhTarget.id, unitId); }
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
            if (gzUnit.hp <= 0) { gzUnit.alive = false; gzUnit.hp = 0; handleUnitDeath(combat, gzUnit.id, gz.sourceId); }
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
            if (gzUnit.hp <= 0) { gzUnit.alive = false; gzUnit.hp = 0; handleUnitDeath(combat, gzUnit.id, gz.sourceId); }
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


/**
 * Handle turn timeout: auto-wait for any player who hasn't acted.
 */
function handleTurnTimeout(combat) {
  if (!activeCombats.has(combat.id)) return;
  if (combat.state !== 'player_turn') return;

  combat.turnTimer = null;

  // Auto-wait for all pending players
  var pending = [];
  combat.pendingActions.forEach(function(resolved, unitId) {
    if (!resolved) pending.push(unitId);
  });

  for (var i = 0; i < pending.length; i++) {
    combat.pendingActions.set(pending[i], true);

    // Notify player that their turn timed out
    var unit = combat.units.get(pending[i]);
    if (unit && unit.socketId && combat.callbacks.emitToPlayer) {
      combat.callbacks.emitToPlayer(unit.socketId, 'tc_combat_turn_timeout', {
        combatId: combat.id,
        unitId: pending[i],
      });
    }

    endUnitTurn(combat, pending[i], 'waited');
  }
}


// ---------------------------------------------------------------------------
// End of unit turn
// ---------------------------------------------------------------------------

/**
 * End a single unit's turn. Reset CT based on what actions were taken.
 * If all pending actions are resolved, advance combat.
 */
function endUnitTurn(combat, unitId, actionsTaken) {
  var unit = combat.units.get(unitId);
  if (!unit) return;

  // Reset CT based on actions taken
  if (actionsTaken === 'attacked') {
    unit.ct = CT_RESET_ATTACKED;
  } else if (actionsTaken === 'moved') {
    unit.ct = CT_RESET_MOVED_ONLY;
  } else {
    // waited or unknown
    unit.ct = CT_RESET_WAITED;
  }

  // Clear momentum shield (consumed or expires at end of turn)
  unit.momentumShield = 0;

  // Tick status effects
  tickStatusEffects(combat, unit);

  // Mark this unit's action as resolved (for grouped player turns)
  if (combat.pendingActions.has(unitId)) {
    combat.pendingActions.set(unitId, true);
  }

  // Check if all pending actions are resolved
  if (combat.state === 'player_turn') {
    var allResolved = true;
    combat.pendingActions.forEach(function(resolved) {
      if (!resolved) allResolved = false;
    });

    if (allResolved) {
      // Clear turn timer
      if (combat.turnTimer) {
        clearTimeout(combat.turnTimer);
        combat.turnTimer = null;
      }

      // Lich Raid: execute boss multi-action turn after all party groups have acted
      if (combat.isLichRaid && combat._lichRaidBossTurnPending) {
        combat._lichRaidBossTurnPending = false;
        setTimeout(function() {
          executeLichRaidBossTurn(combat);
        }, 300);
        return;
      }

      // Small delay before advancing to next CT cycle
      setTimeout(function() {
        advanceCombat(combat);
      }, 100);
    }
  }
  // Enemy turns advance from startEnemyTurn's setTimeout, not here
}

// ---------------------------------------------------------------------------
// Death handling
// ---------------------------------------------------------------------------

/**
 * Handle a unit dying in combat.
 * @param {Object} combat   - combat instance
 * @param {string} unitId   - the dying unit's ID
 * @param {string} [killerId] - optional: the unit that dealt the killing blow
 */
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

// ---------------------------------------------------------------------------
// Combat end
// ---------------------------------------------------------------------------

/**
 * Check if combat should end (all enemies dead or all players dead).
 * Returns 'victory', 'defeat', or null.
 */
function checkCombatEnd(combat) {
  var playersAlive = 0;
  var enemiesAlive = 0;

  var iter = combat.units.values();
  var entry = iter.next();

  while (!entry.done) {
    var unit = entry.value;
    entry = iter.next();

    if (!unit.alive) continue;
    if (unit.type === 'player') playersAlive++;
    else if (!unit.isPlayerSummon) enemiesAlive++;
  }

  if (enemiesAlive === 0 && playersAlive > 0) return 'victory';
  if (playersAlive === 0) return 'defeat';
  return null;
}

/**
 * End the combat instance. Award rewards on victory, clean up state.
 */
function endCombat(combat, result) {
  if (combat.state === 'combat_end') return; // Prevent double-end
  combat.state = 'combat_end';

  // Clear turn timer
  if (combat.turnTimer) {
    clearTimeout(combat.turnTimer);
    combat.turnTimer = null;
  }

  var xpGained = 0;
  var goldGained = 0;
  var loot = [];
  var killedEnemies = [];

  // On victory: award kill rewards for each dead enemy
  if (result === 'victory') {
    var iter = combat.units.values();
    var entry = iter.next();

    while (!entry.done) {
      var unit = entry.value;
      entry = iter.next();

      if (unit.type === 'enemy' && !unit.alive && !unit.isPlayerSummon) {
        killedEnemies.push({
          id: unit.id,
          name: unit.name,
          xp: unit.xp || 0,
          gold: unit.gold || 0,
          isBoss: unit.isBoss || false,
        });
        xpGained += (unit.xp || 0);
        goldGained += (unit.gold || 0);

        // Delegate reward distribution to dungeon handler via callback
        if (combat.callbacks.awardKillRewards) {
          combat.callbacks.awardKillRewards(unit);
        }

        // Necromancy XP: 5 XP per undead enemy killed, to all alive players
        if (unit.enemyType === 'undead' && combat.callbacks.addSkillXp) {
          var undeadKillIter = combat.units.values();
          var undeadKillEntry = undeadKillIter.next();
          while (!undeadKillEntry.done) {
            var undeadKillUnit = undeadKillEntry.value;
            undeadKillEntry = undeadKillIter.next();
            if (undeadKillUnit.type === 'player' && undeadKillUnit.alive && undeadKillUnit.socketId) {
              combat.callbacks.addSkillXp(undeadKillUnit.socketId, 'necromancy', 5);
            }
          }
        }
      }
    }

    // Apply offline mode XP/gold bonus
    if (combat.groupScaling && combat.groupScaling.offlineMode) {
      xpGained = Math.ceil(xpGained * OFFLINE_XP_BONUS);
      goldGained = Math.ceil(goldGained * OFFLINE_GOLD_BONUS);
    }
  }

  // Raid wipe: on defeat in raid combat, call handleRaidWipe callback
  // instead of normal cleanup (boss resets to current phase HP)
  if (result === 'defeat' && combat.isRaidCombat && combat.callbacks.handleRaidWipe) {
    combat.callbacks.handleRaidWipe();
  }

  // Leviathan combat end — trigger onCombatEnd callback
  if (combat._isLeviathanCombat && combat.callbacks.onCombatEnd) {
    combat.callbacks.onCombatEnd(combat, result);
  }

  // Lich raid combat end — trigger onCombatEnd callback
  if (combat.isLichRaid && combat.callbacks.onCombatEnd) {
    combat.callbacks.onCombatEnd(result);
  }

  // Broadcast combat end
  if (combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_combat_end', {
      combatId: combat.id,
      result: result,
      turnsTaken: combat.turnNumber,
      xpGained: xpGained,
      goldGained: goldGained,
      killedEnemies: killedEnemies,
      loot: loot,
      isRaidCombat: combat.isRaidCombat || false,
    });
  }

  // Clean up socket-to-combat mapping and MMO tracking state
  var playerSockets = getPlayerSocketIds(combat);
  for (var i = 0; i < playerSockets.length; i++) {
    socketToCombat.delete(playerSockets[i]);
  }

  // Clean up all MMO-inspired card effect tracking for units in this combat
  var cleanupIter = combat.units.keys();
  var cleanupEntry = cleanupIter.next();
  while (!cleanupEntry.done) {
    var uid = cleanupEntry.value;
    cleanupEntry = cleanupIter.next();
    _hotStreakCounts.delete(uid);
    _comboState.delete(uid);
    _playerClones.delete(uid);
    _lilyTokens.delete(uid);
    _soulShards.delete(uid);
    _dancePartners.delete(uid);
    _staggerDoTs.delete(uid);
    _deathShrouds.delete(uid);
    _soulstones.delete(uid);
    _intercepts.delete(uid);
    _innervates.delete(uid);
    _fadeActive.delete(uid);
    _divineInvulnerability.delete(uid);
  }

  // Remove from active combats
  activeCombats.delete(combat.id);
}




// ---------------------------------------------------------------------------
// Ability execution
// ---------------------------------------------------------------------------


/**
 * Execute a card ability in combat.
 *
 * @param {Object} combat        - The combat instance
 * @param {string} unitId        - The acting unit's ID
 * @param {string} abilityCardId - The ID of the equipped ability card
 * @param {number} targetX       - Target grid X
 * @param {number} targetY       - Target grid Y
 * @returns {Object} result with success flag and effects array
 */
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
        // Exclude the caster from AoE self-damage
        var filteredTargets = [];
        for (var di = 0; di < damageTargets.length; di++) {
          if (damageTargets[di].id !== unitId) {
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

// ---------------------------------------------------------------------------
// useCardAbility — convenience wrapper for socket handlers
// ---------------------------------------------------------------------------

/**
 * High-level wrapper for using an active card ability during combat.
 * Validates the player is in combat, finds the combat instance, and delegates
 * to executeAbility. Returns a result object suitable for socket emission.
 *
 * @param {string} socketId        - The player's socket ID
 * @param {string} cardInstanceId  - The card's instanceId (from equipped cards)
 * @param {number} targetX         - Target tile X
 * @param {number} targetY         - Target tile Y
 * @returns {Object} { ok, error?, cardId, effects, manaCost, cooldown, ... }
 */
function useCardAbility(socketId, cardInstanceId, targetX, targetY) {
  var combatId = socketToCombat.get(socketId);
  if (!combatId) return { ok: false, error: 'Not in combat' };

  var combat = activeCombats.get(combatId);
  if (!combat) return { ok: false, error: 'Combat not found' };

  var unitId = 'player_' + socketId;
  var unit = combat.units.get(unitId);
  if (!unit || !unit.alive) return { ok: false, error: 'Unit not active' };

  // Resolve the cardId from the instanceId (equipped cards carry instanceId, executeAbility matches by cardId)
  var cardId = null;
  var equippedCards = unit.equippedCards || [];
  for (var ci = 0; ci < equippedCards.length; ci++) {
    var c = equippedCards[ci];
    if (c && c.instanceId === cardInstanceId) {
      cardId = c.cardId || c.id;
      break;
    }
  }
  if (!cardId) return { ok: false, error: 'Card not equipped' };

  // Delegate to executeAbility (which handles all validation: AP, mana, cooldown, range)
  var result = executeAbility(combat, unitId, cardId, targetX, targetY);

  if (!result.success) {
    return { ok: false, error: result.reason || 'Ability failed' };
  }

  return {
    ok:            true,
    combatId:      combat.id,
    cardId:        cardId,
    cardName:      result.abilityName || cardId,
    unitId:        unitId,
    targetX:       targetX,
    targetY:       targetY,
    effects:       result.effects || [],
    cooldown:      result.cooldown || 0,
    remainingAp:   unit.ap,
    remainingMana: unit.combat ? unit.combat.mana : 0,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  initCombat: initCombat,
  handlePlayerAction: handlePlayerAction,
  handlePlayerDisconnect: handlePlayerDisconnect,
  handlePlayerReconnect: handlePlayerReconnect,
  addPlayerToCombat: addPlayerToCombat,
  getCombatState: getCombatState,
  getCombatBySocketId: getCombatBySocketId,
  getActiveCombats: getActiveCombats,
  calculateMoveRange: calculateMoveRange,
  executeBasicAttack: executeBasicAttack,
  executeAbility: executeAbility,
  tickAbilityCooldowns: tickAbilityCooldowns,
  advanceCombat: advanceCombat,
  endCombat: endCombat,
  calculateDamage: calculateDamage,

  // Grid helpers (exported for testing and potential reuse)
  isWalkableCombat: isWalkableCombat,
  getAdjacentTiles: getAdjacentTiles,
  manhattanDist: manhattanDist,
  isAdjacent: isAdjacent,
  bfsMovementRange: bfsMovementRange,
  validateMove: validateMove,

  // Combat passive helpers (exported for testing)
  getUnitCombatPassive: getUnitCombatPassive,
  getUnitCombatPassiveTotal: getUnitCombatPassiveTotal,
  hasImmunity: hasImmunity,
  getCardEffectTotal: getCardEffectTotal,

  // Group scaling constants (exported for dungeon handler)
  SOLO_HP_SCALE: SOLO_HP_SCALE,
  SOLO_ATK_SCALE: SOLO_ATK_SCALE,
  DUO_HP_SCALE: DUO_HP_SCALE,
  DUO_ATK_SCALE: DUO_ATK_SCALE,
  TRIO_HP_SCALE: TRIO_HP_SCALE,
  TRIO_ATK_SCALE: TRIO_ATK_SCALE,
  OFFLINE_STAT_SCALE: OFFLINE_STAT_SCALE,
  OFFLINE_XP_BONUS: OFFLINE_XP_BONUS,
  OFFLINE_GOLD_BONUS: OFFLINE_GOLD_BONUS,

  // Card ability convenience wrapper
  useCardAbility: useCardAbility,

  // Lich Raid Boss Combat
  initRaidBossCombat: initRaidBossCombat,
  executeLichRaidBossTurn: executeLichRaidBossTurn,
  updateThreat: updateThreat,
  getTopThreats: getTopThreats,
  spawnCombatAdd: spawnCombatAdd,
  selectBossTarget: selectBossTarget,
  getLichRaidPhase: getLichRaidPhase,
  checkPhylacteries: checkPhylacteries,
  LICH_RAID_PHASES: LICH_RAID_PHASES,
};
