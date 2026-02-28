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

var combatBasicAttack = require('./combat-basic-attack');
var executeBasicAttack = combatBasicAttack.executeBasicAttack;

var combatAbilities = require('./combat-abilities');
var executeAbility        = combatAbilities.executeAbility;
var tickAbilityCooldowns  = combatAbilities.tickAbilityCooldowns;

var combatTurnStart = require('./combat-turn-start');
var startPlayerTurn = combatTurnStart.startPlayerTurn;

var combatDeath = require('./combat-death');
var handleUnitDeath = combatDeath.handleUnitDeath;

// ---------------------------------------------------------------------------
// Deferred init: inject dependencies after all requires are resolved.
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

combatBasicAttack.init({
  handleUnitDeath:        handleUnitDeath,
  updateThreat:           updateThreat,
  getUnitsInRadius:       getUnitsInRadius,
  getUnitAtPosition:      getUnitAtPosition,
  BLOODLUST_ON_HIT:       BLOODLUST_ON_HIT,
  BLOODLUST_ON_TAKE_DAMAGE: BLOODLUST_ON_TAKE_DAMAGE,
  FOCUS_BASIC_ATTACK_GAIN: FOCUS_BASIC_ATTACK_GAIN,
  FOCUS_BASE_RETAIN:      FOCUS_BASE_RETAIN,
});

combatAbilities.init({
  handleUnitDeath:          handleUnitDeath,
  FOCUS_CONSECUTIVE_GAIN:   FOCUS_CONSECUTIVE_GAIN,
  FOCUS_BASE_RETAIN:        FOCUS_BASE_RETAIN,
  BLOODLUST_ON_TAKE_DAMAGE: BLOODLUST_ON_TAKE_DAMAGE,
});

combatTurnStart.init({
  activeCombats:          activeCombats,
  PLAYER_BASE_MP:         PLAYER_BASE_MP,
  PLAYER_BASE_AP:         PLAYER_BASE_AP,
  MANA_REGEN_PER_TURN:    MANA_REGEN_PER_TURN,
  STAMINA_REGEN_PER_TURN: STAMINA_REGEN_PER_TURN,
  BLOODLUST_DECAY_PER_TURN: BLOODLUST_DECAY_PER_TURN,
  BLOODLUST_DECAY_DELAY:  BLOODLUST_DECAY_DELAY,
  checkCombatEnd:         checkCombatEnd,
  endCombat:              endCombat,
  checkExhaustion:        checkExhaustion,
  endUnitTurn:            endUnitTurn,
  getDynamicTurnTimer:    getDynamicTurnTimer,
  handleUnitDeath:        handleUnitDeath,
  processNPCActions:      processNPCActions,
  EXHAUSTION_START:        EXHAUSTION_START,
  EXHAUSTION_START_BOSS:   EXHAUSTION_START_BOSS,
  handleTurnTimeout:       handleTurnTimeout,
});

combatDeath.init({
  BLOODLUST_ON_KILL: BLOODLUST_ON_KILL,
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
      units: serializeUnits(combat),
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

  // Trigger onCombatEnd callback (clears inTurnCombat flags, handles raid/leviathan cleanup)
  if (combat.callbacks.onCombatEnd) {
    if (combat._isLeviathanCombat) {
      combat.callbacks.onCombatEnd(combat, result);
    } else {
      combat.callbacks.onCombatEnd(result);
    }
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
