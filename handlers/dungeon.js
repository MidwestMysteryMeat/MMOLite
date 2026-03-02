// handlers/dungeon.js
// Dungeon socket handler — rift dungeons, biome caves, combat, camps, guild quests.
// Handles: dungeon_enter, dungeon_exit, dungeon_move, dungeon_descend, dungeon_ascend,
//          dungeon_attack, dungeon_open_chest, dungeon_harvest, dungeon_interact_npc,
//          dungeon_camp_place, dungeon_camp_action, dungeon_guild_signup,
//          dungeon_quest_list, dungeon_quest_complete, dungeon_leaderboard

var fs = require('fs');
var path = require('path');
var dungeonData = require('../dungeon-data');
var rpgData = require('../rpg-data');
var dungeonAI = require('../dungeon-ai');
var dungeonCombat = require('../dungeon-combat');
var dungeonVision = require('../dungeon-vision');
var worldgen = require('../worldgen');
var overworldStructures = require('../overworld-structures');
var overworldRifts = require('../overworld-rifts');
var challengesHandler = require('./challenges');
var knowledgeHandler = require('./knowledge');
var loreBooks = require('../lore-books');
var masteryCore = require('../mastery/mastery-core');
var lootGen = require('../loot-generator');
var karma = require('./karma');
var prison = require('./prison');
var companions = require('./companions');
var petsHandler = require('./pets');
var factions = require('./factions');

var TILE = dungeonData.TILE;
var CAMP_CONFIG = dungeonData.CAMP_CONFIG;
var CHEST_LOOT = dungeonData.CHEST_LOOT;
var GUILD_RANKS = dungeonData.GUILD_RANKS;
var FLOOR_MODIFIERS = dungeonData.FLOOR_MODIFIERS;
var getDungeonSkillBonuses = dungeonData.getDungeonSkillBonuses;
var rollEnemyLoot = dungeonData.rollEnemyLoot;
var THEME_ELEMENT_MAP = dungeonData.THEME_ELEMENT_MAP;
var FORM_INTERACTABLES = dungeonData.FORM_INTERACTABLES;
var ANIMAL_SPEAK_CATEGORIES = dungeonData.ANIMAL_SPEAK_CATEGORIES;

// Chest tier order for treasure_vault chestTierBonus upgrade and delving perk
var CHEST_TIER_ORDER = ['common', 'uncommon', 'rare', 'legendary'];

// Lich tower dungeon ID (used by lich raid and corruption cleanse)
var LICH_TOWER_DUNGEON_ID = 'lich_tower';

function upgradeChestTier(baseTier, steps) {
  if (steps <= 0) return baseTier;
  var idx = CHEST_TIER_ORDER.indexOf(baseTier);
  if (idx < 0) return baseTier;
  var newIdx = Math.min(idx + steps, CHEST_TIER_ORDER.length - 1);
  return CHEST_TIER_ORDER[newIdx];
}

// Races that have darkvision (for dense_fog modifier)
var DARKVISION_RACES = { dwarf: true, goblin: true, catfolk: true };

// Set of tile types the player may walk on
var WALKABLE_TILES = {};
WALKABLE_TILES[TILE.FLOOR]       = true;
WALKABLE_TILES[TILE.CORRIDOR]    = true;
WALKABLE_TILES[TILE.DOOR]        = true;
WALKABLE_TILES[TILE.STAIRS_UP]   = true;
WALKABLE_TILES[TILE.STAIRS_DOWN] = true;
WALKABLE_TILES[TILE.ENTRANCE]    = true;
WALKABLE_TILES[TILE.EXIT]        = true;
WALKABLE_TILES[TILE.CHEST]       = true;
WALKABLE_TILES[TILE.TRAP]        = true;
WALKABLE_TILES[TILE.CAMP_SPOT]   = true;
WALKABLE_TILES[TILE.SHRINE]      = true;
WALKABLE_TILES[TILE.BOSS_DOOR]   = true;
WALKABLE_TILES[TILE.SHORTCUT]    = true;
WALKABLE_TILES[TILE.CORPSE]      = true;

// Share walkable tiles with AI engine and vision module
dungeonAI.setWalkableTiles(WALKABLE_TILES);
dungeonVision.setWalkableTiles(WALKABLE_TILES);

// ---------------------------------------------------------------------------
// Shared floor caches (module-level, shared across all sockets)
// ---------------------------------------------------------------------------

// Floor caches are safe without locking: generateFloor() is synchronous and
// dungeon_enter is a plain (non-async) handler, so Node's single-threaded event
// loop guarantees no interleaving between has() and set() calls.
var riftFloors = new Map();       // floorNum -> floor object
var riftSeed = null;
var riftDate = null;

var caveFloors = new Map();       // 'caveKey_floor_N' -> floor object
var caveDate = null;              // daily rotation tracking

var worldDungeonFloors = new Map(); // 'dungeonId_floor_N' -> floor object
var worldDungeonDate = null;       // daily rotation tracking

var campFloors = new Map();         // 'structureId_floor_N' -> floor object

// Per-visit spawn entropy: tracks how many times each floor key has been generated
// so enemy/entity placement varies on each regeneration. Resets on daily rotation.
var _floorVisitCounts = new Map(); // floorKey -> count

var playerDungeons = new Map();   // socketId -> { dungeonId, floorNum }

var _LEADERBOARD_FILE = path.join(__dirname, '..', 'data', 'leaderboard.json');
var leaderboard = (function() {
  try {
    if (fs.existsSync(_LEADERBOARD_FILE)) {
      var raw = JSON.parse(fs.readFileSync(_LEADERBOARD_FILE, 'utf8'));
      return { deepestFloor: raw.deepestFloor || [], mostKills: raw.mostKills || [], fastestBoss: raw.fastestBoss || [] };
    }
  } catch (e) { /* fallthrough to default */ }
  return { deepestFloor: [], mostKills: [], fastestBoss: [] };
})();

var _leaderboardSaveTimer = null;
function _saveLeaderboard() {
  if (_leaderboardSaveTimer) return;
  _leaderboardSaveTimer = setTimeout(function() {
    _leaderboardSaveTimer = null;
    try {
      var dir = path.dirname(_LEADERBOARD_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.promises.writeFile(_LEADERBOARD_FILE, JSON.stringify(leaderboard), 'utf8').catch(function(writeErr) { console.error('[dungeon] leaderboard save error:', writeErr.message); });
    } catch (e) { console.error('[dungeon] leaderboard save error:', e.message); }
  }, 2000);
  if (_leaderboardSaveTimer.unref) _leaderboardSaveTimer.unref();
}

// LRU tracking for empty-floor eviction (Map preserves insertion order for O(1) LRU)
var floorAccessOrder = new Map();  // zoneId -> { map, mapKey }
var MAX_EMPTY_FLOORS = 50;
var MAX_FLOOR_PLAYERS = 16;  // Max players per dungeon floor (4 parties of 4)

// ---------------------------------------------------------------------------
// AI tick management
// ---------------------------------------------------------------------------

var _io = null;                     // stored io reference for AI broadcasts
var _accounts = null;               // stored accounts reference
var _socketAccountMap = null;       // stored socket->account map
var _state = null;                  // stored state reference
var _ambushFlushStarted = false;    // singleton flag for ambush flush interval

// Director system references (injected via deps from socket.js)
var _directorMetrics = null;       // director/director-metrics
var _directorMicro = null;         // director/director-micro
var _directorRaid = null;          // director/director-raid
var _directorLich = null;          // director/director-lich

var floorTickIntervals = new Map(); // zoneId -> intervalId
var floorPlayers = new Map();       // zoneId -> Map(socketId -> { id, x, y, inCombat, visionType, tremorRange, hasTorch, torchExpiry, hasLantern, fogMemory, lastVisibleSet, fogRevealBonus })
var floorPlayerStealth = new Map(); // zoneId -> { socketId: stealthLevel }
var floorRefs = new Map();          // zoneId -> floor object reference
var wallShiftIntervals = new Map(); // zoneId -> intervalId (unstable_rift modifier)
var playerTransitioning = new Set(); // socketId set — prevents double-descend/ascend

// ---------------------------------------------------------------------------
// BG3-style turn-based overworld mode
// ---------------------------------------------------------------------------
var turnModeState = new Map(); // zoneId -> { active, units: Map<unitId, {ct,speed,type,alive,socketId?,enemyIdx?}>, currentUnitId, turnTimer, movesRemaining, paused }
var TURN_MODE_CT = 100;
var TURN_MODE_MOVE_POINTS = 3;
var TURN_MODE_TIMER_MS = 30000;

// ---------------------------------------------------------------------------
// Lich Raid State (Sanctum of Veranthos — multi-party 16-32 player raid)
// ---------------------------------------------------------------------------
var lichRaidState = null;
// { phase: 'gathering'|'active'|'boss'|'complete',
//   players: Map<socketId, { accKey, partyId, floor }>,
//   parties: Map<partyId, { members: [socketIds], floor: number }>,
//   startedAt, gatherTimeout, countdownTimer,
//   lastCompletedAt: timestamp (24h cooldown),
//   raidSeed: string }
var LICH_RAID_RECOMMENDED_PLAYERS = 16;     // recommended, not required
var LICH_RAID_MIN_PLAYERS = 1;             // allow solo entry (harder scaling)
var LICH_RAID_MAX_PLAYERS = 32;
var LICH_RAID_MAX_PARTY_SIZE = 4;
var LICH_RAID_MAX_PARTIES = 8;
var LICH_RAID_GATHER_TIMEOUT_MS = 300000;  // 5 minutes max gathering
var LICH_RAID_COUNTDOWN_MS = 60000;        // 60s countdown after recommended reached
var LICH_RAID_FORCE_START_MS = 30000;      // 30s force start for small groups
var LICH_RAID_BOSS_GRACE_MS = 120000;      // 120s grace for late parties on floor 7
var LICH_RAID_COOLDOWN_MS = 86400000;      // 24h cooldown
var LICH_RAID_NPC_FILL_ENABLED = true;     // allow NPC party member fill for solo/small groups
var floorLightSources = new Map();  // zoneId -> array of { x, y, radius, brightness, type, expiry? }
var floorLightMaps = new Map();     // zoneId -> Float32Array (cached light map)

// ---------------------------------------------------------------------------
// Permadeath: downed/bleedout state tracking
// ---------------------------------------------------------------------------
var downedPlayers = new Map(); // socketId -> { accKey, zoneId, x, y, timer, dungeonId, floorNum, causeOfDeath, intervalId }
// Tracks permadeath grace timers for players who disconnected while downed
// Map<accKey, { timer, dcInfo, causeOfDeath }>
var downedDisconnectTimers = new Map();
var BLEEDOUT_DURATION = 120; // seconds
var REVIVE_DISTANCE = 2; // Manhattan distance tiles

// Torch duration in seconds
var TORCH_DURATION = 300;
var LANTERN_DURATION = 600;

function getFloorPlayersArray(zoneId) {
  var map = floorPlayers.get(zoneId);
  if (!map) return [];
  var arr = [];
  map.forEach(function(p) { arr.push(p); });
  return arr;
}

function getFloorCombatStates(zoneId) {
  var map = floorPlayers.get(zoneId);
  if (!map) return {};
  var states = {};
  map.forEach(function(p, sid) {
    var combat = getPlayerCombat(sid);
    if (combat) states[sid] = combat;
  });
  return states;
}

function getFloorStealthLevels(zoneId) {
  return floorPlayerStealth.get(zoneId) || {};
}

// Pack x,y into a single number for fast Set lookups (avoids string allocation)
function _packCoord(x, y) { return x * 10000 + y; }

function _buildPackedVisibleSet(stringSet) {
  if (!stringSet) return null;
  var packed = new Set();
  stringSet.forEach(function(key) {
    var sep = key.indexOf(',');
    packed.add(parseInt(key.substring(0, sep), 10) * 10000 + parseInt(key.substring(sep + 1), 10));
  });
  return packed;
}

// ---------------------------------------------------------------------------
// Enemy-by-ID index: O(1) lookup Map built lazily on first access per floor.
// Callers that add enemies to floor.enemies must also call indexNewEnemy().
// ---------------------------------------------------------------------------
function ensureEnemyIndex(floor) {
  if (!floor.enemyById) {
    floor.enemyById = new Map();
    for (var i = 0; i < floor.enemies.length; i++) {
      floor.enemyById.set(floor.enemies[i].id, floor.enemies[i]);
    }
  }
  return floor.enemyById;
}

function indexNewEnemy(floor, enemy) {
  if (floor.enemyById) {
    floor.enemyById.set(enemy.id, enemy);
  }
}

function removeEnemyFromIndex(floor, enemyId) {
  if (floor.enemyById) {
    floor.enemyById.delete(enemyId);
  }
}

function processAIResults(zoneId, results) {
  if (!_io) return;

  var pMap = floorPlayers.get(zoneId);

  // Per-player filtered enemy updates (only send enemies visible to each player)
  if (results.updates.length > 0) {
    if (pMap) {
      pMap.forEach(function(pd, sid) {
        if (!pd.lastVisibleSet) {
          // Fallback: send all updates if no visibility computed yet
          _io.to(sid).emit('dungeon_enemies_update', { enemies: results.updates });
          return;
        }
        // Use cached packed set for O(1) numeric lookups instead of string concat
        if (!pd._packedVisibleSet) pd._packedVisibleSet = _buildPackedVisibleSet(pd.lastVisibleSet);
        var packedSet = pd._packedVisibleSet;
        var visibleUpdates = [];
        for (var ui = 0; ui < results.updates.length; ui++) {
          var upd = results.updates[ui];
          if (packedSet.has(_packCoord(upd.x, upd.y))) {
            visibleUpdates.push(upd);
          }
        }
        if (visibleUpdates.length > 0) {
          _io.to(sid).emit('dungeon_enemies_update', { enemies: visibleUpdates });
        }
      });
    } else {
      // Fallback: broadcast to zone
      _io.to('zone:' + zoneId).emit('dungeon_enemies_update', { enemies: results.updates });
    }
  }

  // Process enemy attacks on players
  for (var ai = 0; ai < results.attacks.length; ai++) {
    var attack = results.attacks[ai];
    if (!attack) continue;

    if (attack.isHeal) {
      // Heal: only emit to players who can see the healer
      if (pMap) {
        pMap.forEach(function(pd, sid) {
          if (!pd.lastVisibleSet) {
            _io.to(sid).emit('dungeon_enemy_heal', {
              attackerName: attack.attackerName, healAmount: attack.healAmount, abilityName: attack.abilityName,
            });
            return;
          }
          // Check if the healer enemy position is visible (O(1) Map lookup)
          var floor = floorRefs.get(zoneId);
          if (floor) {
            var healIdx = ensureEnemyIndex(floor);
            var eh = healIdx.get(attack.attackerId);
            if (eh) {
              if (!pd._packedVisibleSet) pd._packedVisibleSet = _buildPackedVisibleSet(pd.lastVisibleSet);
              if (pd._packedVisibleSet.has(_packCoord(eh.x, eh.y))) {
                _io.to(sid).emit('dungeon_enemy_heal', {
                  attackerName: attack.attackerName, healAmount: attack.healAmount, abilityName: attack.abilityName,
                });
              }
            }
          }
        });
      } else {
        _io.to('zone:' + zoneId).emit('dungeon_enemy_heal', {
          attackerName: attack.attackerName, healAmount: attack.healAmount, abilityName: attack.abilityName,
        });
      }
      continue;
    }

    // Emit attack to the targeted player (always — they're being hit)
    if (attack.targetId) {
      _io.to(attack.targetId).emit('dungeon_enemy_attack', {
        attackerName: attack.attackerName,
        damage: attack.damage,
        dodged: attack.dodged,
        blocked: attack.blocked,
        playerHp: attack.playerHp,
        playerMaxHp: attack.playerMaxHp,
        abilityName: attack.abilityName,
        effect: attack.effect,
        isBoss: attack.isBoss,
        windUp: attack.windUp,
      });

      // Inject combat noise event (O(1) Map lookup)
      var attackFloor = floorRefs.get(zoneId);
      if (attackFloor) {
        var attackerEnemy = ensureEnemyIndex(attackFloor).get(attack.attackerId) || null;
        if (attackerEnemy) {
          addNoiseEvent(attackFloor, 'combat', attackerEnemy.x, attackerEnemy.y, 0);
        }
      }

      // Director: record damage and HP for stress tracking
      if (_directorMetrics && attack.damage > 0 && !attack.dodged && !attack.blocked) {
        _directorMetrics.recordDamageTaken(attack.targetId, attack.damage);
        _directorMetrics.updateHpPercent(attack.targetId, attack.playerHp, attack.playerMaxHp);
      }

      // Blood moon vampiric healing: attacker heals for % of damage dealt
      if (attack.damage > 0 && !attack.dodged && !attack.blocked && attack.attackerId) {
        var vampFloor = floorRefs.get(zoneId);
        if (vampFloor) {
          var vampE = ensureEnemyIndex(vampFloor).get(attack.attackerId) || null;
          if (vampE && vampE.alive !== false && vampE.vampiricHealPercent > 0) {
            var vampHeal = Math.max(1, Math.floor(attack.damage * vampE.vampiricHealPercent));
            vampE.hp = Math.min(vampE.maxHp || vampE.hp, vampE.hp + vampHeal);
          }
        }
      }

      // Handle player death
      if (attack.playerDied) {
        // Director: record death for stress tracking
        if (_directorMetrics) _directorMetrics.recordDeath(attack.targetId);

        var accKey = _socketAccountMap ? _socketAccountMap.get(attack.targetId) : null;
        var info = playerDungeons.get(attack.targetId);
        var targetSocket = _io.sockets.sockets.get(attack.targetId);
        if (targetSocket && info) {
          handlePlayerDeath(targetSocket, _io, _state, _accounts, accKey, info, 'Slain by ' + (attack.attackerName || 'a monster'));
          // Remove from floor tracking
          var deathPMap = floorPlayers.get(zoneId);
          if (deathPMap) deathPMap.delete(attack.targetId);
        }
      }
    }

    // Attack visuals: only send to players who can see the attacker
    if (pMap) {
      var atkVisualData = {
        attackerId: attack.attackerId,
        targetId: attack.targetId,
        abilityName: attack.abilityName,
        damage: attack.damage,
        dodged: attack.dodged,
        blocked: attack.blocked,
        isBoss: attack.isBoss,
      };
      pMap.forEach(function(pd, sid) {
        // Target always sees the attack on them
        if (sid === attack.targetId) {
          _io.to(sid).emit('dungeon_enemy_attack_visual', atkVisualData);
          return;
        }
        if (!pd.lastVisibleSet) {
          _io.to(sid).emit('dungeon_enemy_attack_visual', atkVisualData);
          return;
        }
        // Check if attacker enemy position is visible to this player (O(1) Map lookup)
        var atkFloor = floorRefs.get(zoneId);
        if (atkFloor) {
          var ave = ensureEnemyIndex(atkFloor).get(attack.attackerId);
          if (ave) {
            if (!pd._packedVisibleSet) pd._packedVisibleSet = _buildPackedVisibleSet(pd.lastVisibleSet);
            if (pd._packedVisibleSet.has(_packCoord(ave.x, ave.y))) {
              _io.to(sid).emit('dungeon_enemy_attack_visual', atkVisualData);
            }
          }
        }
      });
    } else {
      _io.to('zone:' + zoneId).emit('dungeon_enemy_attack_visual', {
        attackerId: attack.attackerId,
        targetId: attack.targetId,
        abilityName: attack.abilityName,
        damage: attack.damage,
        dodged: attack.dodged,
        blocked: attack.blocked,
        isBoss: attack.isBoss,
      });
    }
  }

  // Process enemy deaths from status effects — per-player filtered
  for (var di = 0; di < results.deaths.length; di++) {
    var death = results.deaths[di];
    // Remove dead enemy from the fast-lookup index
    if (death.enemy && death.enemy.id) {
      var deathFloor = floorRefs.get(zoneId);
      if (deathFloor) removeEnemyFromIndex(deathFloor, death.enemy.id);
    }
    var deathData = { enemyIndex: death.enemyIndex, enemyId: death.enemy ? death.enemy.id : null, enemyX: death.enemy ? death.enemy.x : null, enemyY: death.enemy ? death.enemy.y : null, alive: false, hp: 0 };
    if (pMap) {
      var deadEnemy = death.enemy;
      pMap.forEach(function(pd, sid) {
        if (!pd.lastVisibleSet) {
          _io.to(sid).emit('dungeon_enemy_updated', deathData);
          return;
        }
        if (!pd._packedVisibleSet) pd._packedVisibleSet = _buildPackedVisibleSet(pd.lastVisibleSet);
        if (pd._packedVisibleSet.has(_packCoord(deadEnemy.x, deadEnemy.y))) {
          _io.to(sid).emit('dungeon_enemy_updated', deathData);
        }
      });
    } else {
      _io.to('zone:' + zoneId).emit('dungeon_enemy_updated', deathData);
    }
  }

  // Boss phase changes (broadcast to all — important game event)
  for (var pi = 0; pi < results.phaseChanges.length; pi++) {
    _io.to('zone:' + zoneId).emit('dungeon_boss_phase', results.phaseChanges[pi]);
  }
}

function startFloorAI(zoneId, floor) {
  // Already running — check if tick rate needs adjustment
  if (floorTickIntervals.has(zoneId)) return;

  var playerArr = getFloorPlayersArray(zoneId);
  var tickRate = dungeonAI.getFloorTickRate(floor, playerArr);
  if (tickRate <= 0) return; // no players, no ticking

  // Apply floor modifier effects to enemies (guarded: only once per floor)
  if (!floor._aiModifiersApplied) {
    floor._aiModifiersApplied = true;
    var mod = floor.floorModifier || {};
    if (mod.id === 'silent_floor') {
      // Enemies can't hear, detection based on sight only
      for (var i = 0; i < floor.enemies.length; i++) {
        if (floor.enemies[i].alive !== false) {
          floor.enemies[i].detectionRadius = Math.max(2, (floor.enemies[i].detectionRadius || 4) - 2);
        }
      }
    } else if (mod.id === 'dense_fog') {
      for (var j = 0; j < floor.enemies.length; j++) {
        if (floor.enemies[j].alive !== false) {
          floor.enemies[j].detectionRadius = Math.max(2, Math.floor((floor.enemies[j].detectionRadius || 4) * 0.6));
        }
      }
    } else if (mod.id === 'blood_moon') {
      for (var k = 0; k < floor.enemies.length; k++) {
        if (floor.enemies[k].alive !== false) {
          floor.enemies[k].detectionRadius = (floor.enemies[k].detectionRadius || 4) + 2;
          floor.enemies[k].atk = Math.floor((floor.enemies[k].atk || 10) * 1.2);
        }
      }
    }
  }

  var intervalId = setInterval(function() {
    var players = getFloorPlayersArray(zoneId);
    if (players.length === 0) {
      stopFloorAI(zoneId);
      return;
    }

    // Filter out players in turn-based combat or turn-based overworld mode from real-time AI
    var rtPlayers = [];
    for (var fpi = 0; fpi < players.length; fpi++) {
      if (!players[fpi].inTurnCombat && !players[fpi].turnBasedMode) rtPlayers.push(players[fpi]);
    }
    if (rtPlayers.length === 0) return; // All players in turn combat or turn mode, skip AI tick

    var combatStates = getFloorCombatStates(zoneId);
    var stealthLevels = getFloorStealthLevels(zoneId);

    var results = dungeonAI.tickFloorAI(floor, rtPlayers, combatStates, stealthLevels);

    // Track floor tick count for tremor sense _lastMoveTurn detection
    if (!floor._currentTurn) floor._currentTurn = 0;
    floor._currentTurn++;

    // Mark enemies that moved this tick with _lastMoveTurn for tremor sense
    for (var mti = 0; mti < results.updates.length; mti++) {
      var upd = results.updates[mti];
      var updEnemy = floor.enemies[upd.index];
      if (updEnemy && updEnemy.alive !== false) {
        // Check if enemy actually moved (position changed from what it had before)
        // The AI sets enemy.changed = true for both position and state changes,
        // but we track position via _prevX/_prevY
        if (updEnemy._prevX !== undefined && updEnemy._prevY !== undefined) {
          if (updEnemy.x !== updEnemy._prevX || updEnemy.y !== updEnemy._prevY) {
            updEnemy._lastMoveTurn = floor._currentTurn;
          }
        } else {
          // First tick: if enemy is in an active movement state, mark as moved
          var mtState = updEnemy.aiState || 'idle';
          if (mtState === 'chase' || mtState === 'position' || mtState === 'reposition' ||
              mtState === 'alert' || mtState === 'fallback' || mtState === 'reset') {
            updEnemy._lastMoveTurn = floor._currentTurn;
          }
        }
        // Store current position for next tick comparison
        updEnemy._prevX = updEnemy.x;
        updEnemy._prevY = updEnemy.y;
      }
    }

    // Increment echolocation pulse turn for echolocation-vision players
    var echoFpMap = floorPlayers.get(zoneId);
    if (echoFpMap) {
      echoFpMap.forEach(function(pd, sid) {
        if (pd.visionType === 'echolocation') {
          if (pd._echolocationCurrentTurn === undefined) pd._echolocationCurrentTurn = 0;
          pd._echolocationCurrentTurn++;
          // Set pulse turn if this is a pulse tick
          if (pd._echolocationCurrentTurn % dungeonVision.ECHOLOCATION_PULSE_INTERVAL === 0) {
            pd._echolocationPulseTurn = pd._echolocationCurrentTurn;
          }
        }
      });
    }

    processAIResults(zoneId, results);

    // Process tactical combat engagements from enemy AI
    for (var ei = 0; ei < results.engagements.length; ei++) {
      var engagement = results.engagements[ei];
      if (!engagement || !engagement.targetId || !engagement.enemy) continue;

      var targetSid = engagement.targetId;

      // Guard: player already in tactical combat
      var engPMap = floorPlayers.get(zoneId);
      var engFp = engPMap ? engPMap.get(targetSid) : null;
      if (!engFp || engFp.inTurnCombat) continue;

      // Guard: enemy already in tactical combat
      if (engagement.enemy.inTurnCombat) continue;

      var engSocket = _io.sockets.sockets.get(targetSid);
      if (!engSocket) continue;
      var engUser = _state.users.get(targetSid);
      if (!engUser) continue;
      var engInfo = playerDungeons.get(targetSid);
      if (!engInfo) continue;

      // Find enemy index in floor.enemies
      var engEnemyIdx = -1;
      for (var eii = 0; eii < floor.enemies.length; eii++) {
        if (floor.enemies[eii] === engagement.enemy) { engEnemyIdx = eii; break; }
      }
      if (engEnemyIdx === -1) continue;

      initiateTurnCombat(engSocket, _io, _state, _accounts, _socketAccountMap, engUser, floor, engInfo, engagement.enemy, engEnemyIdx, 'enemy');
    }

    // Micro director tick — adjusts pacing based on party stress
    // Disabled on boss floors and raid floors (hand-authored pacing)
    if (_directorMicro && !floor.isBossFloor && !floor.isRaidBossFloor) {
      try {
        _directorMicro.tick(zoneId, floor, rtPlayers, combatStates);
      } catch (microErr) {
        // Non-fatal — don't crash the AI tick
      }
    }

    // Blood moon: enemy HP regen each tick
    var floorMod = floor.floorModifier || {};
    if (floorMod.id === 'blood_moon') {
      for (var bri = 0; bri < floor.enemies.length; bri++) {
        var brE = floor.enemies[bri];
        if (brE.alive !== false && brE.regenPerTick && brE.hp < (brE.maxHp || brE.hp)) {
          brE.hp = Math.min(brE.maxHp || brE.hp, brE.hp + brE.regenPerTick);
        }
      }
    }

    // Check torch/lantern expiry for all players on this floor
    var now = Date.now();
    var fpMapForExpiry = floorPlayers.get(zoneId);
    if (fpMapForExpiry) {
      fpMapForExpiry.forEach(function(pd, sid) {
        var lightChanged = false;
        if (pd.hasTorch && pd.torchExpiry > 0 && now >= pd.torchExpiry) {
          pd.hasTorch = false;
          pd.torchExpiry = 0;
          lightChanged = true;
          if (_io) _io.to(sid).emit('dungeon_torch_active', { active: false });
        }
        if (pd.hasLantern && pd.lanternExpiry > 0 && now >= pd.lanternExpiry) {
          pd.hasLantern = false;
          pd.lanternExpiry = 0;
          lightChanged = true;
          if (_io) _io.to(sid).emit('dungeon_lantern_active', { active: false });
        }
        if (lightChanged) {
          var visResult = recomputePlayerVisibility(zoneId, sid, floor);
          if (visResult && visResult.delta && _io) {
            _io.to(sid).emit('dungeon_visibility_update', visResult.delta);
          }
        }
      });
    }

    // Check placed torch expiry (static light sources)
    var floorSources = floorLightSources.get(zoneId);
    if (floorSources) {
      var expiredCount = 0;
      for (var lsi = floorSources.length - 1; lsi >= 0; lsi--) {
        if (floorSources[lsi].expiry && now >= floorSources[lsi].expiry) {
          floorSources.splice(lsi, 1);
          expiredCount++;
        }
      }
      if (expiredCount > 0) {
        invalidateLightMap(zoneId);
        // Recompute visibility for all players since light changed
        var fpForLight = floorPlayers.get(zoneId);
        if (fpForLight) {
          fpForLight.forEach(function(pd, sid) {
            var visResult = recomputePlayerVisibility(zoneId, sid, floor);
            if (visResult && visResult.delta && _io) {
              _io.to(sid).emit('dungeon_visibility_update', visResult.delta);
            }
          });
        }
      }
    }

    // Adaptive tick rate: check if we should switch between fast and slow
    var newRate = dungeonAI.getFloorTickRate(floor, players);
    if (newRate !== tickRate && newRate > 0) {
      tickRate = newRate;
      // Restart interval with new rate
      clearInterval(intervalId);
      floorTickIntervals.delete(zoneId);
      startFloorAI(zoneId, floor);
    }
  }, tickRate);

  if (intervalId && intervalId.unref) intervalId.unref();
  floorTickIntervals.set(zoneId, intervalId);
  floorRefs.set(zoneId, floor);

  // Unstable rift: periodic wall shifting
  var riftMod = floor.floorModifier || {};
  if (riftMod.id === 'unstable_rift' && !wallShiftIntervals.has(zoneId)) {
    // Pre-compute mutable tiles (WALL or FLOOR, interior only — skip border)
    if (!floor.mutableTiles) {
      floor.mutableTiles = [];
      for (var mty = 1; mty < floor.height - 1; mty++) {
        for (var mtx = 1; mtx < floor.width - 1; mtx++) {
          var mtt = floor.grid[mty][mtx];
          if (mtt === TILE.WALL || mtt === TILE.FLOOR) {
            floor.mutableTiles.push({ x: mtx, y: mty });
          }
        }
      }
    }
    var shiftMs = (riftMod.wallShiftInterval || 60) * 1000;
    var collapseChance = riftMod.collapseChance || 0.05;
    var wsIntervalId = setInterval(function() {
      if (!_io) return;
      var pArr = getFloorPlayersArray(zoneId);
      if (pArr.length === 0) return;

      // Sample from pre-computed mutable tiles instead of scanning full grid
      var mutableTiles = floor.mutableTiles;
      var numToCheck = Math.max(1, Math.floor(mutableTiles.length * collapseChance));
      var changedTiles = [];

      // Fisher-Yates partial shuffle: pick numToCheck random tiles
      for (var wsi = mutableTiles.length - 1; wsi > 0 && numToCheck > 0; wsi--) {
        var swj = Math.floor(Math.random() * (wsi + 1));
        var tmp = mutableTiles[wsi];
        mutableTiles[wsi] = mutableTiles[swj];
        mutableTiles[swj] = tmp;

        var mt = mutableTiles[wsi];
        var wt = floor.grid[mt.y][mt.x];
        numToCheck--;

        // Only toggle WALL <-> FLOOR
        if (wt === TILE.WALL) {
          // Check player is not standing here
          var playerOnTile = false;
          for (var wpi = 0; wpi < pArr.length; wpi++) {
            if (pArr[wpi].x === mt.x && pArr[wpi].y === mt.y) { playerOnTile = true; break; }
          }
          if (!playerOnTile) {
            floor.grid[mt.y][mt.x] = TILE.FLOOR;
            changedTiles.push({ x: mt.x, y: mt.y, tile: TILE.FLOOR });
          }
        } else if (wt === TILE.FLOOR) {
          var pOnFloor = false;
          for (var wpi2 = 0; wpi2 < pArr.length; wpi2++) {
            if (pArr[wpi2].x === mt.x && pArr[wpi2].y === mt.y) { pOnFloor = true; break; }
          }
          var enemyOnFloor = false;
          for (var wei = 0; wei < floor.enemies.length; wei++) {
            if (floor.enemies[wei].alive !== false && floor.enemies[wei].x === mt.x && floor.enemies[wei].y === mt.y) {
              enemyOnFloor = true; break;
            }
          }
          if (!pOnFloor && !enemyOnFloor) {
            floor.grid[mt.y][mt.x] = TILE.WALL;
            changedTiles.push({ x: mt.x, y: mt.y, tile: TILE.WALL });
          }
        }
      }

      if (changedTiles.length > 0) {
        _io.to('zone:' + zoneId).emit('dungeon_wall_shift', {
          tiles: changedTiles,
        });
      }
    }, shiftMs);
    if (wsIntervalId && wsIntervalId.unref) wsIntervalId.unref();
    wallShiftIntervals.set(zoneId, wsIntervalId);
  }
}

function stopFloorAI(zoneId) {
  var intervalId = floorTickIntervals.get(zoneId);
  if (intervalId) {
    clearInterval(intervalId);
    floorTickIntervals.delete(zoneId);
  }
  // Stop wall shift interval if active
  var wsId = wallShiftIntervals.get(zoneId);
  if (wsId) {
    clearInterval(wsId);
    wallShiftIntervals.delete(zoneId);
  }
  floorRefs.delete(zoneId);
}

function addPlayerToFloor(zoneId, socketId, x, y, visionOpts, floorRef) {
  if (!floorPlayers.has(zoneId)) {
    floorPlayers.set(zoneId, new Map());
  }
  var opts = visionOpts || {};
  var floor = floorRef || floorRefs.get(zoneId);
  var fogSize = (floor ? floor.width * floor.height : 96 * 72);
  floorPlayers.get(zoneId).set(socketId, {
    id: socketId,
    x: Math.floor(x / 32),
    y: Math.floor(y / 32),
    inCombat: false,
    visionType: opts.visionType || 'normal',
    tremorRange: opts.tremorRange || null,
    hasTorch: false,
    torchExpiry: 0,
    hasLantern: false,
    lanternExpiry: 0,
    fogMemory: new Uint8Array(fogSize),
    lastVisibleSet: null,
    fogRevealBonus: opts.fogRevealBonus || 0,
    stealthFootprint: opts.stealthFootprint || 0,
    // Echolocation pulse tracking
    _echolocationPulseTurn: 0,
    _echolocationCurrentTurn: 0,
  });
}

function removePlayerFromFloor(socketId) {
  // Find and remove from whichever floor they're on
  floorPlayers.forEach(function(pMap, zoneId) {
    if (pMap.has(socketId)) {
      pMap.delete(socketId);
      // Clean up per-player stealth entry
      var stealthMap = floorPlayerStealth.get(zoneId);
      if (stealthMap) {
        delete stealthMap[socketId];
      }
      // Director: notify raid system of player leaving
      if (_directorRaid) _directorRaid.playerLeftRaidFloor(zoneId, socketId, _io);
      // Director: clean up micro director state if floor empty
      if (_directorMicro && pMap.size === 0) _directorMicro.cleanupFloor(zoneId);
      // Stop AI if floor is now empty
      if (pMap.size === 0) {
        stopFloorAI(zoneId);
        floorPlayers.delete(zoneId);
        floorPlayerStealth.delete(zoneId);
        floorLightSources.delete(zoneId);
        floorLightMaps.delete(zoneId);
      }
    }
  });
}

function updateFloorPlayerPosition(zoneId, socketId, tileX, tileY) {
  var pMap = floorPlayers.get(zoneId);
  if (!pMap) return;
  var p = pMap.get(socketId);
  if (p) {
    p.x = tileX;
    p.y = tileY;
  }
}

// ---------------------------------------------------------------------------
// BG3-style turn-based overworld mode functions
// ---------------------------------------------------------------------------

// Add a single player to an existing (or new) turn mode state
function addPlayerToTurnMode(socketId, zoneId) {
  var floor = floorRefs.get(zoneId);
  if (!floor) return;

  var pMap = floorPlayers.get(zoneId);
  var fp = pMap ? pMap.get(socketId) : null;
  if (!fp) return;

  fp.turnBasedMode = true;

  var tms = turnModeState.get(zoneId);
  if (!tms) {
    tms = { active: true, units: new Map(), currentUnitId: null, turnTimer: null, movesRemaining: 0, paused: false, hasDashed: false };
    turnModeState.set(zoneId, tms);
  }
  tms.active = true;

  // Add player unit (skip if already present)
  var playerId = 'player_' + socketId;
  if (!tms.units.has(playerId)) {
    var accKey = _socketAccountMap.get(socketId);
    var acc = accKey ? _accounts.loadAccount(accKey) : null;
    var playerInfo = playerDungeons.get(socketId);
    var resolvedCards = (playerInfo && playerInfo.resolvedCards) ? playerInfo.resolvedCards : (acc ? resolveEquippedCards(acc) : []);
    var pSpeed = rpgData.computeCombatSpeed(acc ? acc.race : 'human', acc ? (acc.rpgStats || {}).finesse || 5 : 5, resolvedCards);
    tms.units.set(playerId, {
      ct: 0, speed: pSpeed, type: 'player', alive: true, socketId: socketId, name: (acc ? acc.username : 'Player'),
    });
  }

  // Add alive enemies on floor (only if not yet tracked)
  for (var ei = 0; ei < floor.enemies.length; ei++) {
    var enemy = floor.enemies[ei];
    if (enemy.alive === false) continue;
    if (enemy.inTurnCombat) continue;
    var eid = 'enemy_' + ei;
    if (!tms.units.has(eid)) {
      tms.units.set(eid, {
        ct: 0, speed: enemy.speed || 8, type: 'enemy', alive: true, enemyIdx: ei, name: enemy.name || 'Enemy',
      });
    }
  }
}

// Enable turn mode for entire floor — all players join
function enableFloorTurnMode(zoneId) {
  var pMap = floorPlayers.get(zoneId);
  if (!pMap) return;

  // Add all players on this floor
  pMap.forEach(function(fp, sid) {
    if (fp.inTurnCombat) return; // skip players already in tactical combat
    addPlayerToTurnMode(sid, zoneId);
    var psock = _io.sockets.sockets.get(sid);
    if (psock) psock.emit('dungeon_mode_update', { turnBased: true });
  });

  // Start CT advancement
  advanceTurnMode(zoneId);
}

// Disable turn mode for entire floor — all players leave
function disableFloorTurnMode(zoneId) {
  var tms = turnModeState.get(zoneId);
  if (tms) {
    if (tms.turnTimer) { clearTimeout(tms.turnTimer); tms.turnTimer = null; }
    tms.active = false;
    turnModeState.delete(zoneId);
  }

  var pMap = floorPlayers.get(zoneId);
  if (pMap) {
    pMap.forEach(function(fp, sid) {
      fp.turnBasedMode = false;
      var psock = _io.sockets.sockets.get(sid);
      if (psock) psock.emit('dungeon_mode_update', { turnBased: false });
    });
  }
}

function buildTurnModeInitiative(tms) {
  var order = [];
  tms.units.forEach(function(u, uid) {
    if (!u.alive) return;
    order.push({ id: uid, name: u.name || uid, ct: u.ct, speed: u.speed, type: u.type });
  });
  order.sort(function(a, b) { return b.ct - a.ct; });
  return order;
}

function advanceTurnMode(zoneId) {
  var tms = turnModeState.get(zoneId);
  if (!tms || !tms.active || tms.paused) return;

  // Remove dead units
  tms.units.forEach(function(u, uid) {
    if (u.type === 'enemy') {
      var floor = floorRefs.get(zoneId);
      if (floor && floor.enemies[u.enemyIdx] && floor.enemies[u.enemyIdx].alive === false) {
        u.alive = false;
      }
    }
  });

  // Tick CT until someone is ready
  var maxTicks = 200;
  var readyUnit = null;
  for (var t = 0; t < maxTicks && !readyUnit; t++) {
    var foundThisTick = false;
    tms.units.forEach(function(u, uid) {
      if (!u.alive || foundThisTick) return;
      u.ct += u.speed;
      if (u.ct >= TURN_MODE_CT) {
        readyUnit = { id: uid, unit: u };
        foundThisTick = true;
      }
    });
  }

  if (!readyUnit) return;
  readyUnit.unit.ct -= TURN_MODE_CT;
  tms.currentUnitId = readyUnit.id;

  if (readyUnit.unit.type === 'player') {
    tms.movesRemaining = TURN_MODE_MOVE_POINTS;
    tms.hasDashed = false;
    var initiativeOrder = buildTurnModeInitiative(tms);
    // Mark the acting unit
    for (var ini = 0; ini < initiativeOrder.length; ini++) {
      initiativeOrder[ini].isActive = (initiativeOrder[ini].id === readyUnit.id);
    }
    var psock = _io.sockets.sockets.get(readyUnit.unit.socketId);
    if (psock) {
      psock.emit('dungeon_turn_start', {
        movementPoints: TURN_MODE_MOVE_POINTS,
        initiative: initiativeOrder,
      });
    }
    // Broadcast initiative to all other players on floor
    var turnPMap = floorPlayers.get(zoneId);
    if (turnPMap) {
      turnPMap.forEach(function(pd, sid) {
        if (sid === readyUnit.unit.socketId) return;
        var otherSock = _io.sockets.sockets.get(sid);
        if (otherSock) {
          otherSock.emit('dungeon_turn_update', { initiative: initiativeOrder, activeUnit: readyUnit.id });
        }
      });
    }
    // 30s turn timer
    if (tms.turnTimer) clearTimeout(tms.turnTimer);
    var _zoneId = zoneId;
    var _socketId = readyUnit.unit.socketId;
    tms.turnTimer = setTimeout(function() { endPlayerTurnMode(_socketId, _zoneId); }, TURN_MODE_TIMER_MS);
    if (tms.turnTimer.unref) tms.turnTimer.unref();
  } else {
    // Enemy turn
    processEnemyTurnModeTick(zoneId, readyUnit.id, readyUnit.unit);
  }
}

function processEnemyTurnModeTick(zoneId, unitId, unit) {
  var floor = floorRefs.get(zoneId);
  if (!floor) { advanceTurnMode(zoneId); return; }

  var enemy = floor.enemies[unit.enemyIdx];
  if (!enemy || enemy.alive === false) {
    unit.alive = false;
    advanceTurnMode(zoneId);
    return;
  }

  // Build player list for AI tick
  var pMap = floorPlayers.get(zoneId);
  var playerList = [];
  if (pMap) {
    pMap.forEach(function(pd, sid) {
      if (pd.turnBasedMode) {
        playerList.push({ id: sid, x: pd.x, y: pd.y, inCombat: false });
      }
    });
  }
  if (playerList.length === 0) { advanceTurnMode(zoneId); return; }

  var combatStates = getFloorCombatStates(zoneId);
  var stealthLevels = getFloorStealthLevels(zoneId);

  // Capture old position for lerp animation
  var oldX = enemy.x;
  var oldY = enemy.y;

  // Single enemy tick
  var result = dungeonAI.tickEnemy(enemy, floor, playerList, combatStates, stealthLevels, floor.enemies, []);

  // Broadcast enemy position update if changed
  if (enemy.changed) {
    var updateData = {
      enemies: [{
        index: unit.enemyIdx, x: enemy.x, y: enemy.y, aiState: enemy.aiState,
        hp: enemy.hp, maxHp: enemy.maxHp, facing: enemy.facing,
        isAttacking: enemy.isAttacking, archetype: enemy.archetype,
      }],
    };
    if (pMap) {
      pMap.forEach(function(pd, sid) {
        _io.to(sid).emit('dungeon_enemies_update', updateData);
      });
    }
    // Emit turn result with old position for smooth lerp animation
    if (pMap) {
      pMap.forEach(function(pd, sid) {
        _io.to(sid).emit('dungeon_turn_result', {
          unitId: unitId, enemyIdx: unit.enemyIdx,
          fromX: oldX, fromY: oldY, x: enemy.x, y: enemy.y, name: enemy.name,
        });
      });
    }
  }

  // Check for tactical combat engagement
  if (result && result.type === 'engage_tactical') {
    var targetSid = result.targetId;
    var engSocket = _io.sockets.sockets.get(targetSid);
    if (engSocket) {
      var engUser = _state.users.get(targetSid);
      var engInfo = playerDungeons.get(targetSid);
      if (engUser && engInfo) {
        // Pause turn mode during tactical combat
        var tms = turnModeState.get(zoneId);
        if (tms) {
          tms.paused = true;
          if (tms.turnTimer) { clearTimeout(tms.turnTimer); tms.turnTimer = null; }
        }
        initiateTurnCombat(engSocket, _io, _state, _accounts, _socketAccountMap, engUser, floor, engInfo, enemy, unit.enemyIdx, 'enemy');
        return; // Don't advance — combat will resume turn mode on end
      }
    }
  }

  // Clear noise events accumulated during turn mode to prevent backlog
  if (floor._noiseEvents) floor._noiseEvents = [];

  // Short delay before next unit acts (so client can see enemy movement)
  setTimeout(function() { advanceTurnMode(zoneId); }, 250);
}

function endPlayerTurnMode(socketId, zoneId) {
  var tms = turnModeState.get(zoneId);
  if (!tms || !tms.active) return;
  if (tms.turnTimer) { clearTimeout(tms.turnTimer); tms.turnTimer = null; }
  tms.currentUnitId = null;
  tms.movesRemaining = 0;

  var psock = _io.sockets.sockets.get(socketId);
  if (psock) {
    psock.emit('dungeon_turn_update', { movesRemaining: 0, turnEnded: true });
  }

  // Advance to next unit
  advanceTurnMode(zoneId);
}

function cleanupTurnMode(socketId, zoneId) {
  var tms = turnModeState.get(zoneId);
  if (!tms) return;

  // If it was this player's turn, clear the timer
  var wasCurrentUnit = (tms.currentUnitId === 'player_' + socketId);
  if (wasCurrentUnit) {
    if (tms.turnTimer) { clearTimeout(tms.turnTimer); tms.turnTimer = null; }
    tms.currentUnitId = null;
  }

  // Remove this player's unit
  tms.units.delete('player_' + socketId);

  // Reset the floorPlayer flag
  var pMap = floorPlayers.get(zoneId);
  var fp = pMap ? pMap.get(socketId) : null;
  if (fp) fp.turnBasedMode = false;

  // If no player units remain, tear down entire floor's turn mode
  var hasPlayers = false;
  tms.units.forEach(function(u) { if (u.type === 'player' && u.alive) hasPlayers = true; });
  if (!hasPlayers) {
    disableFloorTurnMode(zoneId);
  } else if (wasCurrentUnit) {
    // Only advance if we just removed the active unit (avoids double-advance during enemy turns)
    advanceTurnMode(zoneId);
  }
}

// ---------------------------------------------------------------------------
// Light map and visibility helpers
// ---------------------------------------------------------------------------

function getOrComputeLightMap(zoneId, floor) {
  if (floorLightMaps.has(zoneId)) return floorLightMaps.get(zoneId);
  // Snapshot live sources so campfire entries are not permanently pushed to shared array
  var sources = (floorLightSources.get(zoneId) || []).slice();
  // Add campfire lights from camps
  var camps = floor.camps || [];
  for (var ci = 0; ci < camps.length; ci++) {
    if (camps[ci].campfire) {
      sources.push(dungeonVision.createCampfireLight(camps[ci].x, camps[ci].y));
    }
  }
  var lightMap = dungeonVision.computeLightMap(floor, sources);
  floorLightMaps.set(zoneId, lightMap);
  return lightMap;
}

function invalidateLightMap(zoneId) {
  floorLightMaps.delete(zoneId);
}

function recomputePlayerVisibility(zoneId, socketId, floor) {
  var pMap = floorPlayers.get(zoneId);
  if (!pMap) return null;
  var pd = pMap.get(socketId);
  if (!pd) return null;

  var lightMap = getOrComputeLightMap(zoneId, floor);

  // Build nearby players list for thermal vision AND check torch/lantern sharing (single pass)
  var nearbyPlayers = [];
  var nearbyTorchLight = false;
  var nearbyLanternLight = false;
  pMap.forEach(function(other) {
    if (other.id === socketId) return;
    nearbyPlayers.push(other);
    // Check if nearby torch/lantern bearers extend this player's light
    if (!nearbyTorchLight || !nearbyLanternLight) {
      if (other.hasTorch || other.hasLantern) {
        var tdx = Math.abs(other.x - pd.x);
        var tdy = Math.abs(other.y - pd.y);
        var tDist = Math.sqrt(tdx * tdx + tdy * tdy);
        if (!nearbyTorchLight && other.hasTorch && tDist <= dungeonVision.TORCH_LIGHT_RADIUS) {
          nearbyTorchLight = true;
        }
        if (!nearbyLanternLight && other.hasLantern && tDist <= dungeonVision.LANTERN_LIGHT_RADIUS) {
          nearbyLanternLight = true;
        }
      }
    }
  });

  // Determine if this floor is pitch black (rift floors above 5 can be pitch black)
  var floorIsPitchBlack = false;
  if (floor._isPitchBlack !== undefined) {
    floorIsPitchBlack = floor._isPitchBlack;
  } else {
    // Check natural pitch black (ambient = 0)
    floorIsPitchBlack = dungeonVision.isPitchBlackFloor(floor.theme, floor.floorNum, false);
  }

  // Get VISION_TYPES definition for numeric ranges
  var visionTypeDef = rpgData.VISION_TYPES[pd.visionType] || rpgData.VISION_TYPES.normal;

  var playerData = {
    id: socketId,
    x: pd.x,
    y: pd.y,
    visionType: pd.visionType,
    tremorRange: pd.tremorRange,
    hasTorch: pd.hasTorch || nearbyTorchLight,
    hasLantern: pd.hasLantern || nearbyLanternLight,
    fogRevealBonus: pd.fogRevealBonus,
    nearbyPlayers: nearbyPlayers,
    // Echolocation pulse tracking
    _echolocationPulseTurn: pd._echolocationPulseTurn || 0,
    _echolocationCurrentTurn: pd._echolocationCurrentTurn || 0,
    // Pitch black and vision type definition for new range system
    _isPitchBlack: floorIsPitchBlack,
    _visionTypeDef: visionTypeDef,
  };

  var visibility = dungeonVision.computePlayerVisibility(playerData, floor, lightMap);

  // Detect and reveal invisible enemies: if this player's vision can detect an invisible
  // enemy on a visible tile, temporarily reveal it for ALL players via the reveal duration system.
  // This enables party callout: a Lizard Folk with thermal vision reveals a natural-invis enemy
  // so their party members (who might have normal vision) can also see and target it.
  var visionTypeForDetect = pd.visionType || 'normal';
  var detectCurrentTurn = (floor._currentTurn || 0);
  if (visionTypeForDetect !== 'normal') {
    var floorEnemies = floor.enemies;
    for (var dri = 0; dri < floorEnemies.length; dri++) {
      var drEnemy = floorEnemies[dri];
      if (drEnemy.alive === false) continue;
      if (!drEnemy.invisibility || drEnemy._invisBroken) continue;
      if (!visibility.visibleTiles.has(drEnemy.x + ',' + drEnemy.y)) continue;
      // Check if this player's vision can detect this invisible enemy
      if (dungeonVision.canPlayerSeeEnemy(drEnemy, visionTypeForDetect, detectCurrentTurn)) {
        // Reveal the enemy for all players for a short duration (party callout)
        dungeonVision.revealEnemy(drEnemy, detectCurrentTurn, dungeonVision.REVEAL_DURATION_DEFAULT);
      }
    }
  }

  // Update fog memory
  dungeonVision.updateFogMemory(pd.fogMemory, visibility.visibleTiles, floor.width, floor.height);

  // Build player vision data for invisible enemy filtering
  var playerVisionDataForFilter = { visionType: visionTypeForDetect };

  // Compute delta from last visible set (includes invisible enemy filtering)
  var delta = dungeonVision.computeVisibilityDelta(pd.lastVisibleSet, visibility, pd.fogMemory, floor, floor.width, playerVisionDataForFilter);

  // Store current visible set for next delta
  pd.lastVisibleSet = visibility.visibleTiles;
  pd._packedVisibleSet = null; // invalidate packed cache

  // Attach compact light source positions for client rendering
  var pMap = floorPlayers.get(zoneId);
  delta.lightSources = dungeonVision.collectLightSourcesForClient(floor, floorLightSources.get(zoneId) || [], pMap);

  return {
    visibility: visibility,
    delta: delta,
    fogMemory: pd.fogMemory,
  };
}

function addNoiseEvent(floor, type, x, y, stealthBonus) {
  if (!floor._noiseEvents) floor._noiseEvents = [];
  floor._noiseEvents.push({ type: type, x: x, y: y, stealthBonus: stealthBonus || 0 });
}

function initFloorEnemyAI(floor) {
  for (var i = 0; i < floor.enemies.length; i++) {
    var enemy = floor.enemies[i];
    if (enemy.alive === false) continue;
    if (!enemy.aiState) {
      dungeonAI.initEnemyAI(enemy, enemy.archetype || null);
    }
  }
}

// ---------------------------------------------------------------------------
// Safe account save wrapper — logs errors instead of crashing
// ---------------------------------------------------------------------------

function safeSaveAccount(accounts, acc, context) {
  try {
    accounts.saveAccount(acc);
  } catch (err) {
    console.error('[dungeon] saveAccount failed (' + (context || 'unknown') + '):', err.message);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTodayString() {
  return new Date().toISOString().slice(0, 10);
}

function floorHasPlayers(floorZoneId, state) {
  var zone = state.zones.get(floorZoneId);
  return zone && zone.members && zone.members.size > 0;
}

function touchLRU(zoneId, map, mapKey) {
  floorAccessOrder.delete(zoneId);   // remove if exists (no-op if absent)
  floorAccessOrder.set(zoneId, { map: map, mapKey: mapKey }); // re-insert at end
}

function evictEmptyFloors(state) {
  if (floorAccessOrder.size <= MAX_EMPTY_FLOORS) return;

  var emptyCount = 0;
  floorAccessOrder.forEach(function(data, zoneId) {
    if (!floorHasPlayers(zoneId, state)) emptyCount++;
  });
  if (emptyCount <= MAX_EMPTY_FLOORS) return;

  // Iterate in insertion order (oldest first); delete empties until under limit
  var iter = floorAccessOrder.entries();
  var entry = iter.next();
  while (!entry.done && emptyCount > MAX_EMPTY_FLOORS) {
    var zoneId = entry.value[0];
    var data = entry.value[1];
    entry = iter.next(); // advance before potential delete
    if (!floorHasPlayers(zoneId, state)) {
      data.map.delete(data.mapKey);
      floorAccessOrder.delete(zoneId);
      emptyCount--;
    }
  }
}

function getRiftFloor(floorNum) {
  var today = getTodayString();
  if (riftDate !== today) {
    riftFloors.clear();
    floorAccessOrder.clear(); // Clear LRU on daily wipe (BUG-4)
    _floorVisitCounts.clear();
    riftSeed = 'rift_' + today;
    riftDate = today;
  }
  var riftZoneId = 'rift_floor_' + floorNum;
  if (!riftFloors.has(floorNum)) {
    var _vc = (_floorVisitCounts.get(riftZoneId) || 0);
    _floorVisitCounts.set(riftZoneId, _vc + 1);
    var floor = dungeonData.generateFloor(floorNum, riftSeed, { type: 'rift', isRift: true, visitCount: _vc });
    floor.camps = [];
    // Tag pitch black rift floors (15% of floors above 5, deterministic)
    floor._isPitchBlack = dungeonVision.isPitchBlackRiftFloor(floorNum);
    riftFloors.set(floorNum, floor);
    touchLRU(riftZoneId, riftFloors, floorNum);
    if (_state) evictEmptyFloors(_state);
  } else {
    touchLRU(riftZoneId, riftFloors, floorNum);
  }
  return riftFloors.get(floorNum);
}

function getCaveFloor(caveKey, floorNum, biome) {
  // Daily rotation: clear cache on new day
  var today = getTodayString();
  if (caveDate !== today) {
    caveFloors.clear();
    caveDate = today;
  }

  var key = caveKey + '_floor_' + floorNum;
  var caveZoneId = 'cave_' + key;
  if (!caveFloors.has(key)) {
    var totalFloors = dungeonData.getCaveDepth(biome, caveKey);
    var _cvc = (_floorVisitCounts.get(caveZoneId) || 0);
    _floorVisitCounts.set(caveZoneId, _cvc + 1);
    // Main seed rotates daily; themeSeed is permanent so biome theme stays stable
    var floor = dungeonData.generateFloor(floorNum, 'cave_' + caveKey + '_' + today, {
      type: 'cave',
      isRift: false,
      biome: biome,
      totalFloors: totalFloors,
      themeSeed: 'cave_' + caveKey,
      visitCount: _cvc,
    });
    floor.camps = [];
    caveFloors.set(key, floor);
    touchLRU(caveZoneId, caveFloors, key);
    if (_state) evictEmptyFloors(_state);
  } else {
    touchLRU(caveZoneId, caveFloors, key);
  }
  return caveFloors.get(key);
}

// ---------------------------------------------------------------------------
// World dungeon lookup by ID — cached index built once
// ---------------------------------------------------------------------------
var _worldDungeonIndex = {};
(function() {
  var dungeons = worldgen.WORLD_DUNGEONS;
  if (!dungeons) return;
  for (var i = 0; i < dungeons.length; i++) {
    _worldDungeonIndex[dungeons[i].id] = dungeons[i];
  }
})();

function getWorldDungeonDef(dungeonId) {
  return _worldDungeonIndex[dungeonId] || null;
}

function getWorldDungeonFloor(dungeonId, floorNum) {
  var def = getWorldDungeonDef(dungeonId);
  if (!def) return null;

  // Daily rotation: clear cache on new day
  var today = getTodayString();
  if (worldDungeonDate !== today) {
    worldDungeonFloors.clear();
    worldDungeonDate = today;
  }

  var key = dungeonId + '_floor_' + floorNum;
  var zoneId = 'world_' + key;
  if (!worldDungeonFloors.has(key)) {
    var _wvc = (_floorVisitCounts.get(zoneId) || 0);
    _floorVisitCounts.set(zoneId, _wvc + 1);
    // Main seed rotates daily; themeSeed is permanent (redundant here since
    // world dungeons force opts.theme, but keeps the pattern consistent)
    var floor = dungeonData.generateFloor(floorNum, 'world_' + dungeonId + '_' + today, {
      type: 'cave',          // Uses cave floor sizing (finite dungeon)
      isRift: false,
      biome: def.biome,
      totalFloors: def.floors,
      theme: def.theme,       // Force specific theme
      enemyPool: def.enemyPool, // Force specific enemy pool
      themeSeed: 'world_' + dungeonId,
      visitCount: _wvc,
    });
    floor.camps = [];
    worldDungeonFloors.set(key, floor);
    touchLRU(zoneId, worldDungeonFloors, key);
    if (_state) evictEmptyFloors(_state);
  } else {
    touchLRU(zoneId, worldDungeonFloors, key);
  }
  return worldDungeonFloors.get(key);
}

function getCampFloor(structureId, floorNum) {
  var key = structureId + '_floor_' + floorNum;
  var zoneId = 'camp_' + key;
  if (!campFloors.has(key)) {
    var floor = overworldStructures.getStructureFloor(structureId, floorNum);
    if (!floor) return null;
    floor.camps = [];
    campFloors.set(key, floor);
    touchLRU(zoneId, campFloors, key);
    if (_state) evictEmptyFloors(_state);
  } else {
    touchLRU(zoneId, campFloors, key);
  }
  return campFloors.get(key);
}

function buildFloorState(floor, dungeonId, state, zoneId, socketId) {
  var players = state.getPlayersInZone(zoneId);

  // Base floor state (structural — no per-player filtered entities)
  var baseState = {
    dungeonId: dungeonId,
    floorNum: floor.floorNum,
    theme: floor.theme,
    themeColor: floor.themeColors,
    width: floor.width,
    height: floor.height,
    grid: floor.grid,
    rooms: floor.rooms,
    entranceX: floor.stairsUp.x,
    entranceY: floor.stairsUp.y,
    exitX: floor.stairsDown.x,
    exitY: floor.stairsDown.y,
    isBossFloor: floor.isBossFloor,
    isRaidBossFloor: floor.isRaidBossFloor || false,
    raidState: (floor.isRaidBossFloor && _directorRaid) ? (function() {
      var rs = _directorRaid.getRaidState(zoneId);
      return rs ? { state: rs.state, playerCount: rs.playerCount, minPlayers: rs.minPlayers, bossName: rs.bossName, barrierActive: rs.barrierActive } : null;
    })() : null,
    specialEvent: floor.specialEvent,
    floorModifier: floor.floorModifier || { id: 'none', name: 'Normal' },
    players: players,
    // Per-player filtered entities (defaults for backward compat)
    enemies: [],
    chests: [],
    traps: [],
    npcs: [],
    corpses: [],
    camps: [],
    // Form-gated interactables (animal morphing exploration)
    formInteractables: (floor.formInteractables || []).filter(function(fi) { return !fi.explored; }).map(function(fi) {
      return { id: fi.id, type: fi.type, name: fi.name, description: fi.description, x: fi.x, y: fi.y, icon: fi.icon, requiredAbility: fi.requiredAbility, alternateAbility: fi.alternateAbility };
    }),
    // Animal NPCs (ambient, speakable in animal form)
    animalNpcs: (floor.animalNpcs || []).filter(function(an) { return !an.interacted; }).map(function(an) {
      return { id: an.id, animalType: an.animalType, name: an.name, x: an.x, y: an.y };
    }),
    // Vision metadata
    ambientLight: dungeonVision.getAmbientLight(floor.theme, floor.floorNum),
    // Darkness metadata
    isDark: dungeonVision.isDarkFloor(floor.theme, floor.floorNum),
    darknessLevel: dungeonVision.getDarknessLevel(floor.theme, floor.floorNum),
    // Pitch black metadata (rift floors above 5 can be pitch black)
    isPitchBlack: floor._isPitchBlack || dungeonVision.isPitchBlackFloor(floor.theme, floor.floorNum, false),
  };

  // If socketId provided, compute per-player visibility and filter entities
  if (socketId) {
    var visResult = recomputePlayerVisibility(zoneId, socketId, floor);
    if (visResult) {
      // Build player vision data for invisible enemy filtering
      var bfsPMap = floorPlayers.get(zoneId);
      var bfsPd = bfsPMap ? bfsPMap.get(socketId) : null;
      var bfsPlayerVision = { visionType: (bfsPd && bfsPd.visionType) ? bfsPd.visionType : 'normal' };
      var filtered = dungeonVision.filterFloorStateForPlayer(floor, visResult.visibility, visResult.fogMemory, floor.width, bfsPlayerVision);
      baseState.enemies = filtered.enemies;
      baseState.chests = filtered.chests;
      baseState.traps = filtered.traps;
      baseState.npcs = filtered.npcs;
      baseState.corpses = filtered.corpses || [];
      baseState.camps = filtered.camps;
      baseState.thermalEntities = filtered.thermalEntities;
      baseState.tremorIndicators = filtered.tremorIndicators;
      baseState.echolocationData = filtered.echolocationData;
      baseState.magicAuras = filtered.magicAuras || [];
      // Send fog state
      var fogTiles = dungeonVision.fogMemoryToTileList(visResult.fogMemory);
      baseState.fogVisible = fogTiles.visible;
      baseState.fogRemembered = fogTiles.remembered;
      baseState.visionRadius = visResult.visibility.visionRadius;
      baseState.lightLevel = visResult.visibility.lightLevel;
      baseState.playerLightRadius = visResult.visibility.visionRadius;
      // Compact light source positions for client-side rendering
      var pMap = floorPlayers.get(zoneId);
      baseState.lightSources = dungeonVision.collectLightSourcesForClient(floor, floorLightSources.get(zoneId) || [], pMap);
    }
  } else {
    // Fallback: send all entities (for compatibility)
    baseState.enemies = floor.enemies.filter(function(e) { return e.alive !== false; }).map(function(e) {
      return {
        id: e.id, name: e.name, x: e.x, y: e.y,
        hp: e.hp, maxHp: e.maxHp || e.hp, atk: e.atk, def: e.def,
        xp: e.xp, gold: e.gold, isBoss: e.isBoss,
        archetype: e.archetype || 'bruiser',
        aiState: e.aiState || 'idle',
        facing: e.facing || 'down',
        detectionRadius: e.detectionRadius || 4,
        isHollowed: e.isHollowed || false,
        isMimic: e.isMimic || false,
        regenPerTick: e.regenPerTick || 0,
      };
    });
    baseState.chests = floor.chests.map(function(c) {
      return { x: c.x, y: c.y, tier: c.tier, opened: c.opened };
    });
    baseState.traps = floor.traps.filter(function(t) { return t.triggered; });
    baseState.npcs = floor.npcs.filter(function(n) { return !n.interacted; });
    baseState.corpses = (floor.corpses || []).map(function(cr) {
      return { x: cr.x, y: cr.y, id: cr.id, name: cr.name, description: cr.description, examined: cr.examined };
    });
    baseState.camps = floor.camps || [];
  }

  return baseState;
}

// Get pool of possible equipment base types for a given dungeon floor depth
function getFloorLootPool(floorNum) {
  var pool = [];
  var weaponTypes = accounts.WEAPON_TYPES;
  if (!weaponTypes) return ['iron_sword'];
  // Build tier-appropriate pool from WEAPON_TYPES
  var rarityForFloor = 'common';
  if (floorNum >= 40) rarityForFloor = 'ultra_rare';
  else if (floorNum >= 25) rarityForFloor = 'rare';
  else if (floorNum >= 10) rarityForFloor = 'uncommon';
  var rarityOrder = { common: 0, uncommon: 1, rare: 2, ultra_rare: 3, mythic_rare: 4, legendary: 5 };
  var maxRarityVal = rarityOrder[rarityForFloor] || 0;
  for (var wt in weaponTypes) {
    var def = weaponTypes[wt];
    if (!def.slot) continue; // skip non-equippable
    if (def.slot === 'backpack' || def.slot === 'rig') continue; // containers drop via separate roll
    var defRarityVal = rarityOrder[def.rarity] || 0;
    // Include items at or below the floor's max appropriate rarity
    if (defRarityVal <= maxRarityVal + 1) {
      pool.push(wt);
    }
  }
  if (pool.length === 0) pool.push('iron_sword');
  return pool;
}

function getFloorForPlayer(socketId) {
  var info = playerDungeons.get(socketId);
  if (!info) return null;
  if (info.dungeonId === 'rift') {
    return getRiftFloor(info.floorNum);
  }
  if (info.dungeonId.indexOf('cave_') === 0) {
    var caveKey = info.dungeonId.slice(5);
    return getCaveFloor(caveKey, info.floorNum, info.biome || 6);
  }
  if (info.dungeonId.indexOf('world_') === 0) {
    var worldId = info.dungeonId.slice(6);
    return getWorldDungeonFloor(worldId, info.floorNum);
  }
  if (info.dungeonId.indexOf('camp_') === 0) {
    var campStructId = info.structureId || info.dungeonId.slice(5);
    return getCampFloor(campStructId, info.floorNum);
  }
  if (info.dungeonId.indexOf('minirift_') === 0) {
    var mrRiftId = info.riftId || info.dungeonId.slice(9);
    return overworldRifts.getRiftFloor(mrRiftId, info.floorNum);
  }
  return null;
}

function getZoneIdForDungeon(dungeonId, floorNum) {
  return dungeonId + '_floor_' + floorNum;
}

// ---------------------------------------------------------------------------
// Lich Raid Helper Functions
// ---------------------------------------------------------------------------

function lichRaidCanStart() {
  if (lichRaidState && lichRaidState.phase !== 'complete') return false;
  if (lichRaidState && lichRaidState.lastCompletedAt) {
    if (Date.now() - lichRaidState.lastCompletedAt < LICH_RAID_COOLDOWN_MS) return false;
  }
  return true;
}

function lichRaidCreateGathering() {
  lichRaidState = {
    phase: 'gathering',
    players: new Map(),
    parties: new Map(),
    startedAt: Date.now(),
    gatherTimeout: null,
    countdownTimer: null,
    countdownStarted: false,
    countdownEndsAt: 0,
    lastCompletedAt: lichRaidState ? lichRaidState.lastCompletedAt : 0,
    raidSeed: 'lich_raid_' + getTodayString(),
  };

  // Gathering timeout — auto-cancel after 5 min if not enough players
  lichRaidState.gatherTimeout = setTimeout(function() {
    if (lichRaidState && lichRaidState.phase === 'gathering' && !lichRaidState.countdownStarted) {
      lichRaidCancelGathering('Not enough players joined in time.');
    }
  }, LICH_RAID_GATHER_TIMEOUT_MS);
  if (lichRaidState.gatherTimeout && lichRaidState.gatherTimeout.unref) lichRaidState.gatherTimeout.unref();
}

function lichRaidAddPlayer(socketId, accKey) {
  if (!lichRaidState || lichRaidState.phase !== 'gathering') return false;
  if (lichRaidState.players.size >= LICH_RAID_MAX_PLAYERS) return false;
  if (lichRaidState.players.has(socketId)) return true; // already in

  // Assign to a party — check if player's existing party is in the raid
  var existingParty = _state ? _state.getPlayerParty(socketId) : null;
  var assignedPartyId = null;

  if (existingParty) {
    // Check if this party already exists in raid
    var partyMembers = Array.from(existingParty.members);
    for (var pi = 0; pi < partyMembers.length; pi++) {
      var pEntry = lichRaidState.players.get(partyMembers[pi]);
      if (pEntry) {
        assignedPartyId = pEntry.partyId;
        break;
      }
    }
  }

  if (!assignedPartyId) {
    // Find a party with space or create new one
    var partyIter = lichRaidState.parties.entries();
    var partyEntry = partyIter.next();
    while (!partyEntry.done) {
      if (partyEntry.value[1].members.length < LICH_RAID_MAX_PARTY_SIZE) {
        assignedPartyId = partyEntry.value[0];
        break;
      }
      partyEntry = partyIter.next();
    }

    if (!assignedPartyId && lichRaidState.parties.size < LICH_RAID_MAX_PARTIES) {
      assignedPartyId = 'raid_party_' + (lichRaidState.parties.size + 1);
      lichRaidState.parties.set(assignedPartyId, { members: [], floor: 0 });
    }
  }

  if (!assignedPartyId) return false; // all parties full

  lichRaidState.players.set(socketId, { accKey: accKey, partyId: assignedPartyId, floor: 0 });
  var raidParty = lichRaidState.parties.get(assignedPartyId);
  if (raidParty.members.indexOf(socketId) === -1) {
    raidParty.members.push(socketId);
  }

  // Check if we hit recommended and should start countdown
  if (lichRaidState.players.size >= LICH_RAID_RECOMMENDED_PLAYERS && !lichRaidState.countdownStarted) {
    lichRaidStartCountdown();
  }

  return true;
}

function lichRaidStartCountdown() {
  if (!lichRaidState || lichRaidState.countdownStarted) return;
  lichRaidState.countdownStarted = true;
  lichRaidState.countdownEndsAt = Date.now() + LICH_RAID_COUNTDOWN_MS;

  // Clear gathering timeout
  if (lichRaidState.gatherTimeout) {
    clearTimeout(lichRaidState.gatherTimeout);
    lichRaidState.gatherTimeout = null;
  }

  lichRaidState.countdownTimer = setTimeout(function() {
    lichRaidActivate();
  }, LICH_RAID_COUNTDOWN_MS);
  if (lichRaidState.countdownTimer && lichRaidState.countdownTimer.unref) lichRaidState.countdownTimer.unref();
}

function lichRaidActivate() {
  if (!lichRaidState || lichRaidState.phase !== 'gathering') return;
  lichRaidState.phase = 'active';

  // Clear timers
  if (lichRaidState.gatherTimeout) clearTimeout(lichRaidState.gatherTimeout);
  if (lichRaidState.countdownTimer) clearTimeout(lichRaidState.countdownTimer);
  lichRaidState.gatherTimeout = null;
  lichRaidState.countdownTimer = null;

  // Place each party on floor 1
  var partyIter = lichRaidState.parties.entries();
  var partyEntry = partyIter.next();
  while (!partyEntry.done) {
    partyEntry.value[1].floor = 1;
    partyEntry = partyIter.next();
  }

  // Broadcast raid start to all participants
  lichRaidBroadcast('raid_activated', {
    message: 'The Sanctum of Veranthos raid has begun!',
    parties: lichRaidGetPartyInfo(),
  });
}

function lichRaidForceStart() {
  if (!lichRaidState || lichRaidState.phase !== 'gathering') return;
  if (lichRaidState.players.size < 1) return;

  // Fill parties with NPCs if under recommended count
  if (LICH_RAID_NPC_FILL_ENABLED && lichRaidState.players.size < LICH_RAID_RECOMMENDED_PLAYERS) {
    lichRaidFillNPCs();
  }

  lichRaidActivate();
}

function lichRaidFillNPCs() {
  if (!lichRaidState) return;
  // Fill each existing party to 4 members with NPC combatants
  // NPCs will be added as AI-controlled units during combat init
  var npcId = 0;
  var partyIter = lichRaidState.parties.entries();
  var pEntry = partyIter.next();
  while (!pEntry.done) {
    var party = pEntry.value[1];
    while (party.members.length < LICH_RAID_MAX_PARTY_SIZE) {
      npcId++;
      var npcSocketId = 'npc_raid_' + npcId;
      party.members.push(npcSocketId);
      lichRaidState.players.set(npcSocketId, {
        accKey: null,
        partyId: pEntry.value[0],
        floor: 0,
        isNPC: true,
        npcType: getNPCTypeForSlot(npcId),
        npcName: getRaidNPCName(npcId),
      });
    }
    pEntry = partyIter.next();
  }

  // If fewer than 4 parties, create NPC-only parties up to 4 total
  var minParties = Math.max(2, Math.ceil(lichRaidState.parties.size * 1.5));
  if (minParties > LICH_RAID_MAX_PARTIES) minParties = LICH_RAID_MAX_PARTIES;
  while (lichRaidState.parties.size < minParties) {
    var newPartyId = 'raid_party_' + (lichRaidState.parties.size + 1);
    var newParty = { members: [], floor: 0 };
    for (var ni = 0; ni < LICH_RAID_MAX_PARTY_SIZE; ni++) {
      npcId++;
      var npcSid = 'npc_raid_' + npcId;
      newParty.members.push(npcSid);
      lichRaidState.players.set(npcSid, {
        accKey: null,
        partyId: newPartyId,
        floor: 0,
        isNPC: true,
        npcType: getNPCTypeForSlot(npcId),
        npcName: getRaidNPCName(npcId),
      });
    }
    lichRaidState.parties.set(newPartyId, newParty);
  }
}

// NPC role distribution: tank, healer, dps, dps pattern per party
function getNPCTypeForSlot(slotIndex) {
  var roles = ['tank', 'healer', 'dps', 'dps'];
  return roles[(slotIndex - 1) % 4];
}

var RAID_NPC_NAMES = [
  'Sir Aldren', 'Priestess Lyria', 'Vex the Shadow', 'Korra Flameblade',
  'Brother Marden', 'Sera Lightweaver', 'Grimjaw', 'Whisper',
  'Captain Thorne', 'Sister Elara', 'Rook', 'Ashara the Swift',
  'Warden Dain', 'Oracle Nym', 'Ironclaw', 'Zephyr Nightwind',
  'Paladin Oras', 'Druid Fenn', 'Skarlet', 'Bolt Stormhand',
  'Shield-Warden Hux', 'Cleric Vael', 'Dagger Maeve', 'Pyra the Ember',
  'Sentinel Grun', 'Healer Solvi', 'Shade', 'Lance Brightforge',
  'Bulwark Renn', 'Acolyte Dara', 'Fang', 'Tempest Kael',
];

function getRaidNPCName(npcIndex) {
  return RAID_NPC_NAMES[(npcIndex - 1) % RAID_NPC_NAMES.length];
}

// Calculate boss scaling factor based on real player count (not NPCs)
function lichRaidGetScalingFactor() {
  if (!lichRaidState) return 1;
  var realPlayers = 0;
  var playerIter = lichRaidState.players.values();
  var pEntry = playerIter.next();
  while (!pEntry.done) {
    if (!pEntry.value.isNPC) realPlayers++;
    pEntry = playerIter.next();
  }
  // Scale boss HP/ATK: solo=0.15x, duo=0.25x, 4-man=0.4x, 8-man=0.65x, 16+=1.0x
  if (realPlayers <= 1) return 0.15;
  if (realPlayers <= 2) return 0.25;
  if (realPlayers <= 4) return 0.4;
  if (realPlayers <= 8) return 0.65;
  if (realPlayers <= 12) return 0.8;
  return 1.0;
}

function lichRaidRemovePlayer(socketId) {
  if (!lichRaidState) return;
  var pEntry = lichRaidState.players.get(socketId);
  if (!pEntry) return;

  // Remove from party
  var party = lichRaidState.parties.get(pEntry.partyId);
  if (party) {
    var idx = party.members.indexOf(socketId);
    if (idx !== -1) party.members.splice(idx, 1);
    // Clean up empty parties
    if (party.members.length === 0) {
      lichRaidState.parties.delete(pEntry.partyId);
    }
  }
  lichRaidState.players.delete(socketId);
}

function lichRaidCancelGathering(reason) {
  if (!lichRaidState) return;
  if (lichRaidState.gatherTimeout) clearTimeout(lichRaidState.gatherTimeout);
  if (lichRaidState.countdownTimer) clearTimeout(lichRaidState.countdownTimer);

  lichRaidBroadcast('raid_cancelled', { message: reason || 'Raid cancelled.' });

  // Teleport all players out
  var playerIter = lichRaidState.players.keys();
  var pEntry = playerIter.next();
  while (!pEntry.done) {
    var sid = pEntry.value;
    pEntry = playerIter.next();
    lichRaidTeleportOut(sid);
  }
  lichRaidState = null;
}

function lichRaidTeleportOut(socketId) {
  var info = playerDungeons.get(socketId);
  if (!info) return;

  var currentZone = _state ? _state.playerZones.get(socketId) : null;
  if (currentZone && _io) {
    var sock = _io.sockets.sockets.get(socketId);
    if (sock) {
      sock.leave('zone:' + currentZone);
      _io.to('zone:' + currentZone).emit('player_left_zone', {
        playerId: socketId,
        playerName: '',
        zoneId: currentZone,
      });
    }
    if (_state) _state.leaveZone(socketId);
  }

  removePlayerFromFloor(socketId);
  playerDungeons.delete(socketId);

  // Return to overworld at lich tower entrance
  var worldDef = getWorldDungeonDef('lich_tower');
  if (_state && worldDef) {
    var CHUNK_SIZE = 512;
    var retX = (1000 + worldDef.refX) * CHUNK_SIZE + CHUNK_SIZE / 2;
    var retY = (1250 + worldDef.refY) * CHUNK_SIZE + CHUNK_SIZE / 2;
    _state.joinZone(socketId, 'overworld');
    _state.updatePlayerPosition(socketId, retX, retY);
    var sock = _io ? _io.sockets.sockets.get(socketId) : null;
    if (sock) {
      sock.join('zone:overworld');
      sock.emit('dungeon_exit_complete', {
        returnZone: 'overworld',
        returnX: retX,
        returnY: retY,
      });
    }
  }
}

// --- Lich Raid: start boss combat on floor 7 ---
// Called after grace period; gathers all raid players on floor 7, builds combat data, initiates raid boss fight
function lichRaidStartBossCombat() {
  if (!lichRaidState || lichRaidState.phase !== 'boss') return;
  if (lichRaidState._bossCombatStarted) return; // prevent double-init
  lichRaidState._bossCombatStarted = true;

  // Get the Archlich boss data from dungeon-data
  var lichPool = dungeonData.ENEMY_POOLS.lich_sanctum;
  var bossTemplate = (lichPool && lichPool.boss) ? lichPool.boss[0] : null;
  if (!bossTemplate) {
    console.error('[lich-raid] No Archlich boss data found in ENEMY_POOLS.lich_sanctum');
    return;
  }

  // Get the boss floor (floor 7)
  var bossFloor = null;
  var firstPartyId = null;
  var partyIter = lichRaidState.parties.keys();
  var pk = partyIter.next();
  while (!pk.done) {
    firstPartyId = pk.value;
    break;
  }
  if (firstPartyId) {
    bossFloor = lichRaidGetFloor(firstPartyId, 7);
  }
  if (!bossFloor) {
    console.error('[lich-raid] Could not generate boss floor');
    return;
  }

  // Build party data: { partyId: [playerData, ...] }
  var parties = {};
  var partyIter2 = lichRaidState.parties.entries();
  var pe = partyIter2.next();
  while (!pe.done) {
    var partyId = pe.value[0];
    var partyObj = pe.value[1];
    parties[partyId] = [];

    for (var mi = 0; mi < partyObj.members.length; mi++) {
      var memberId = partyObj.members[mi];
      var memberEntry = lichRaidState.players.get(memberId);
      if (!memberEntry) continue;

      if (memberEntry.isNPC) {
        // Generate NPC combat data based on role
        var npcData = buildNPCCombatData(memberEntry, memberId);
        parties[partyId].push(npcData);
      } else {
        // Real player — build from account data
        var accKey = memberEntry.accKey;
        if (!accKey) continue;
        var acc = _accounts ? _accounts.loadAccount(accKey) : null;
        if (!acc) continue;
        var resolvedCards = resolveEquippedCards(acc);
        var combat = getPlayerCombat(memberId);
        if (!combat) {
          combat = initPlayerCombatState(memberId, _accounts, accKey);
        }
        parties[partyId].push({
          socketId: memberId,
          x: Math.floor(bossFloor.width / 2) + (mi % 4),
          y: bossFloor.height - 3 + Math.floor(mi / 4),
          name: acc.username || 'Player',
          race: acc.race || 'human',
          rpgStats: acc.rpgStats || rpgData.getDefaultStats(),
          level: acc.level || 1,
          equippedCards: resolvedCards,
          combat: combat || {},
        });
      }
    }
    pe = partyIter2.next();
  }

  // Build callbacks for raid combat
  var bossZoneId = 'lich_raid_boss_floor_7';
  var callbacks = buildCombatCallbacks(_io, _state, _accounts, _socketAccountMap);
  // Wrap broadcastToFloor to target the boss zone directly (2-arg form used by combat engine)
  var origBroadcast = callbacks.broadcastToFloor;
  callbacks.broadcastToFloor = function(event, data) {
    if (_io) _io.to('zone:' + bossZoneId).emit(event, data);
  };
  callbacks.scaleFactor = lichRaidGetScalingFactor();
  callbacks.isRaid = true;
  // On raid boss death, complete the raid
  callbacks.onCombatEnd = function(result) {
    if (result === 'victory') {
      lichRaidComplete();
    } else if (result === 'defeat') {
      lichRaidCancelGathering('All parties have been defeated by the Archlich.');
    }
  };

  var combatObj = dungeonCombat.initRaidBossCombat(
    'lich_raid_boss', parties, bossTemplate, bossFloor, callbacks
  );

  if (combatObj) {
    lichRaidState._bossCombatId = combatObj.id;
    lichRaidBroadcast('raid_boss_engage', {
      message: 'The Archlich Veranthos awakens! The battle begins!',
    });
  } else {
    console.error('[lich-raid] Failed to initialize boss combat');
  }
}

// Build combat-ready data for an NPC raid companion based on their role
function buildNPCCombatData(npcEntry, npcSocketId) {
  var role = npcEntry.npcType || 'dps';
  var name = npcEntry.npcName || 'NPC Companion';
  var level = 20; // NPCs are mid-level

  // Role-based stat templates
  var baseStats = { vigor: 5, might: 5, finesse: 5, acumen: 5, resolve: 5, presence: 5, ingenuity: 5 };
  var combat = {};

  if (role === 'tank') {
    baseStats.vigor = 14; baseStats.might = 10; baseStats.resolve = 10;
    combat.maxHp = 350; combat.hp = 350;
    combat.baseArmor = 15; combat.magicResist = 8;
    combat.weaponDamage = 12; combat.weaponRange = 1.5;
    combat.weaponCategory = 'melee_blade'; combat.armorType = 'heavy';
    combat.meleeDmgMult = 1.1; combat.critChance = 0.05;
    combat.blockChance = 0.2; combat.dodgeChance = 0;
    combat.armorSpeedMod = -0.1; combat.weaponSpeed = 0.8;
  } else if (role === 'healer') {
    baseStats.acumen = 14; baseStats.resolve = 10; baseStats.vigor = 8;
    combat.maxHp = 200; combat.hp = 200;
    combat.baseArmor = 4; combat.magicResist = 12;
    combat.weaponDamage = 6; combat.weaponRange = 3;
    combat.weaponCategory = 'magic'; combat.armorType = 'light';
    combat.meleeDmgMult = 0.8; combat.magicDmgMult = 1.3;
    combat.critChance = 0.08; combat.dodgeChance = 0.05;
    combat.mana = 80; combat.maxMana = 80;
    combat.armorSpeedMod = 0; combat.weaponSpeed = 1.0;
  } else {
    // DPS
    baseStats.might = 12; baseStats.finesse = 12; baseStats.acumen = 8;
    combat.maxHp = 220; combat.hp = 220;
    combat.baseArmor = 6; combat.magicResist = 4;
    combat.weaponDamage = 18; combat.weaponRange = 1.5;
    combat.weaponCategory = 'melee_blade'; combat.armorType = 'medium';
    combat.meleeDmgMult = 1.3; combat.critChance = 0.15;
    combat.dodgeChance = 0.1; combat.blockChance = 0;
    combat.armorSpeedMod = -0.05; combat.weaponSpeed = 1.1;
  }

  return {
    socketId: npcSocketId,
    x: 0, // positioned during combat init
    y: 0,
    name: name,
    race: 'human',
    rpgStats: baseStats,
    level: level,
    equippedCards: [],
    combat: combat,
    isNPC: true,
    npcRole: role,
  };
}

function lichRaidComplete() {
  if (!lichRaidState) return;
  lichRaidState.phase = 'complete';
  lichRaidState.lastCompletedAt = Date.now();

  lichRaidBroadcast('raid_complete', {
    message: 'The Archlich Veranthos has been destroyed! The corruption weakens!',
  });

  // Massive corruption cleanse — if directorLich available, cleanse 50% of all corruption
  if (_directorLich) {
    _directorLich.cleanseCorruption(LICH_TOWER_DUNGEON_ID);
    // Mark lich as defeated this calendar month — corruption sources go dormant until next month
    var calMonth = _state && _state.world && _state.world.calendar ? _state.world.calendar.month : null;
    if (calMonth !== null) {
      _directorLich.setLichDefeated(calMonth);
    }
  }

  // Teleport all players out after a short delay
  var _lichTeleportTimer = setTimeout(function() {
    if (!lichRaidState) return;
    var playerIter = lichRaidState.players.keys();
    var pEntry = playerIter.next();
    while (!pEntry.done) {
      var sid = pEntry.value;
      pEntry = playerIter.next();
      lichRaidTeleportOut(sid);
    }
  }, 5000);
  if (_lichTeleportTimer && _lichTeleportTimer.unref) _lichTeleportTimer.unref();
}

function lichRaidBroadcast(event, data) {
  if (!lichRaidState || !_io) return;
  var playerIter = lichRaidState.players.keys();
  var pEntry = playerIter.next();
  while (!pEntry.done) {
    _io.to(pEntry.value).emit(event, data);
    pEntry = playerIter.next();
  }
}

function lichRaidGetPartyInfo() {
  if (!lichRaidState) return [];
  var result = [];
  var partyIter = lichRaidState.parties.entries();
  var pEntry = partyIter.next();
  while (!pEntry.done) {
    var pid = pEntry.value[0];
    var pData = pEntry.value[1];
    var memberNames = [];
    for (var mi = 0; mi < pData.members.length; mi++) {
      var pInfo = lichRaidState.players.get(pData.members[mi]);
      if (pInfo && pInfo.accKey && _accounts) {
        var mAcc = _accounts.loadAccount(pInfo.accKey);
        memberNames.push(mAcc ? mAcc.username : 'Unknown');
      }
    }
    result.push({ partyId: pid, members: memberNames, memberCount: pData.members.length, floor: pData.floor });
    pEntry = partyIter.next();
  }
  return result;
}

function lichRaidGetPartyZoneId(partyId, floorNum) {
  if (floorNum === 7) {
    // All parties converge on a single shared floor 7
    return 'lich_raid_boss_floor_7';
  }
  return 'lich_raid_' + partyId + '_floor_' + floorNum;
}

function lichRaidGetFloor(partyId, floorNum) {
  if (!lichRaidState) return null;

  var zoneId = lichRaidGetPartyZoneId(partyId, floorNum);
  var today = getTodayString();
  var key = zoneId;

  if (!worldDungeonFloors.has(key)) {
    var def = getWorldDungeonDef('lich_tower');
    if (!def) return null;

    var seed = lichRaidState.raidSeed + '_' + (floorNum === 7 ? 'boss' : partyId) + '_f' + floorNum;
    var floor = dungeonData.generateFloor(floorNum, seed, {
      type: 'cave',
      isRift: false,
      biome: def.biome,
      totalFloors: 7,
      theme: def.theme,
      enemyPool: def.enemyPool,
      themeSeed: 'lich_raid_' + today,
    });
    floor.camps = [];

    // Floor 7 is always a boss arena with higher player cap
    if (floorNum === 7) {
      floor.isRaidBossFloor = true;
      floor.isBossFloor = true;
    }

    worldDungeonFloors.set(key, floor);
  }
  return worldDungeonFloors.get(key);
}

function getGuildRank(guildXp) {
  var rank = GUILD_RANKS[0];
  for (var i = GUILD_RANKS.length - 1; i >= 0; i--) {
    if (guildXp >= GUILD_RANKS[i].xpThreshold) {
      rank = GUILD_RANKS[i];
      break;
    }
  }
  return rank;
}

function ensureDungeonProgress(acc) {
  if (!acc.dungeonProgress) {
    acc.dungeonProgress = {
      guildMember: false,
      guildXp: 0,
      guildRank: 'stone',
      deepestFloor: 0,
      totalKills: 0,
      totalDeaths: 0,
      bossesKilled: 0,
      dailyQuests: {},
      lastQuestDate: null,
      clearedCaves: {},
      activeCave: null,
      activeCaveFloor: 0,
    };
  }
  return acc.dungeonProgress;
}

// Mark all enemies with alive field on floor load (if not already set)
function ensureEnemyAliveFlags(floor) {
  for (var i = 0; i < floor.enemies.length; i++) {
    if (floor.enemies[i].alive === undefined) {
      floor.enemies[i].alive = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Floor Modifier Post-Generation Effects
// Applied once when a floor is first accessed. Prevents re-application via flag.
// ---------------------------------------------------------------------------
function applyFloorModifierPostGeneration(floor) {
  if (floor._modifierApplied) return;
  floor._modifierApplied = true;
  var mod = floor.floorModifier;
  if (!mod || mod.id === 'none') return;

  if (mod.id === 'trap_gauntlet') {
    var tgMult = mod.trapMultiplier || 3;
    var tgDmg = mod.trapDamageBonus || 0.5;
    for (var tgi = 0; tgi < floor.traps.length; tgi++) {
      floor.traps[tgi].damage = Math.floor((floor.traps[tgi].damage || 10) * (1 + tgDmg));
    }
    var tgOrig = floor.traps.slice();
    for (var tgm = 1; tgm < tgMult; tgm++) {
      for (var tgo = 0; tgo < tgOrig.length; tgo++) {
        var tgSrc = tgOrig[tgo];
        var tgDone = false;
        var tgOff = [{dx:-1,dy:0},{dx:1,dy:0},{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:-1},{dx:1,dy:-1},{dx:-1,dy:1},{dx:1,dy:1}];
        for (var tgoi = 0; tgoi < tgOff.length && !tgDone; tgoi++) {
          var tgx = tgSrc.x + tgOff[tgoi].dx;
          var tgy = tgSrc.y + tgOff[tgoi].dy;
          if (tgy >= 0 && tgy < floor.height && tgx >= 0 && tgx < floor.width && floor.grid[tgy][tgx] === TILE.FLOOR) {
            var tgOcc = false;
            for (var tgc = 0; tgc < floor.traps.length; tgc++) {
              if (floor.traps[tgc].x === tgx && floor.traps[tgc].y === tgy) { tgOcc = true; break; }
            }
            if (!tgOcc) {
              floor.grid[tgy][tgx] = TILE.TRAP;
              floor.traps.push({ x: tgx, y: tgy, damage: tgSrc.damage, roomIndex: tgSrc.roomIndex, triggered: false });
              tgDone = true;
            }
          }
        }
      }
    }
  }

  if (mod.id === 'treasure_vault') {
    var tvCM = mod.chestMultiplier || 2;
    var tvTB = mod.chestTierBonus || 1;
    var tvEM = mod.enemyMultiplier || 1.5;
    for (var tvci = 0; tvci < floor.chests.length; tvci++) {
      var tvC = floor.chests[tvci];
      var tvNT = upgradeChestTier(tvC.tier, tvTB);
      if (tvNT !== tvC.tier) {
        var tvLoot = CHEST_LOOT[tvNT];
        if (tvLoot) { tvC.tier = tvNT; tvC.gold = Math.floor((tvLoot.goldMin + tvLoot.goldMax) / 2); }
      }
    }
    var tvOC = floor.chests.slice();
    for (var tvcm = 1; tvcm < tvCM; tvcm++) {
      for (var tvoc = 0; tvoc < tvOC.length; tvoc++) {
        var tvSC = tvOC[tvoc];
        var tvPl = false;
        var tvCO = [{dx:-1,dy:0},{dx:1,dy:0},{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:-1},{dx:1,dy:-1},{dx:-1,dy:1},{dx:1,dy:1}];
        for (var tvco = 0; tvco < tvCO.length && !tvPl; tvco++) {
          var tvx = tvSC.x + tvCO[tvco].dx;
          var tvy = tvSC.y + tvCO[tvco].dy;
          if (tvy >= 0 && tvy < floor.height && tvx >= 0 && tvx < floor.width && floor.grid[tvy][tvx] === TILE.FLOOR) {
            floor.grid[tvy][tvx] = TILE.CHEST;
            floor.chests.push({ x: tvx, y: tvy, tier: tvSC.tier, gold: tvSC.gold, resource: tvSC.resource, resourceAmount: tvSC.resourceAmount, hasCard: tvSC.hasCard, roomIndex: tvSC.roomIndex, opened: false });
            tvPl = true;
          }
        }
      }
    }
    var tvEC = Math.floor(floor.enemies.length * (tvEM - 1));
    var tvSE = floor.enemies.slice();
    for (var tvem = 0; tvem < tvEC && tvem < tvSE.length; tvem++) {
      var tvSrc = tvSE[tvem];
      if (tvSrc.isBoss) continue;
      var tvNE = {};
      var tvEK = Object.keys(tvSrc);
      for (var tvek = 0; tvek < tvEK.length; tvek++) tvNE[tvEK[tvek]] = tvSrc[tvEK[tvek]];
      tvNE.id = tvSrc.id + '_vault_' + tvem;
      tvNE.x = tvSrc.x + (tvem % 2 === 0 ? 1 : -1);
      tvNE.y = tvSrc.y + (tvem % 2 === 0 ? -1 : 1);
      if (tvNE.y >= 0 && tvNE.y < floor.height && tvNE.x >= 0 && tvNE.x < floor.width) {
        tvNE.alive = true; tvNE.aiState = undefined;
        floor.enemies.push(tvNE);
        indexNewEnemy(floor, tvNE);
      }
    }
  }

  if (mod.id === 'hollowed_swarm') {
    var hsEM = mod.enemyMultiplier || 1.5;
    for (var hsi = 0; hsi < floor.enemies.length; hsi++) {
      if (floor.enemies[hsi].alive !== false) {
        floor.enemies[hsi].isHollowed = true;
        floor.enemies[hsi].name = 'Hollowed ' + floor.enemies[hsi].name;
        floor.enemies[hsi].hp = Math.floor((floor.enemies[hsi].hp || 20) * 1.3);
        floor.enemies[hsi].maxHp = floor.enemies[hsi].hp;
        floor.enemies[hsi].gold = Math.floor((floor.enemies[hsi].gold || 5) * 0.6);
      }
    }
    var hsEC = Math.floor(floor.enemies.length * (hsEM - 1));
    var hsSE = floor.enemies.slice();
    for (var hse = 0; hse < hsEC && hse < hsSE.length; hse++) {
      var hsSrc = hsSE[hse];
      if (hsSrc.isBoss) continue;
      var hsNE = {};
      var hsK = Object.keys(hsSrc);
      for (var hsk = 0; hsk < hsK.length; hsk++) hsNE[hsK[hsk]] = hsSrc[hsK[hsk]];
      hsNE.id = hsSrc.id + '_swarm_' + hse;
      hsNE.x = hsSrc.x + (hse % 2 === 0 ? 1 : -1);
      hsNE.y = hsSrc.y + (hse % 2 === 0 ? -1 : 1);
      if (hsNE.y >= 0 && hsNE.y < floor.height && hsNE.x >= 0 && hsNE.x < floor.width) {
        hsNE.alive = true; hsNE.aiState = undefined;
        floor.enemies.push(hsNE);
        indexNewEnemy(floor, hsNE);
      }
    }
  }

  if (mod.id === 'sanctuary') {
    if (mod.noEnemies) {
      for (var sni = 0; sni < floor.enemies.length; sni++) {
        floor.enemies[sni].alive = false; floor.enemies[sni].hp = 0;
      }
    }
    if (mod.healingSpring && floor.rooms.length > 1) {
      var snR = floor.rooms[Math.floor(floor.rooms.length / 2)];
      var snY = snR.centerY + 1 < snR.y + snR.h ? snR.centerY + 1 : snR.centerY;
      floor.npcs.push({ id: 'healing_spring', name: 'Healing Spring', dialogue: 'A shimmering pool of restorative water. You feel your wounds mend.', reward: { healFull: true }, x: snR.centerX, y: snY, roomIndex: Math.floor(floor.rooms.length / 2), interacted: false });
    }
    if (mod.guaranteedMerchant && floor.rooms.length > 2) {
      var snMR = floor.rooms[Math.min(2, floor.rooms.length - 1)];
      floor.npcs.push({ id: 'sanctuary_merchant', name: 'Wandering Merchant', dialogue: 'Welcome, traveler. Rest easy here. I have wares if you have coin.', reward: { gold: 25 + floor.floorNum * 5 }, x: snMR.centerX, y: snMR.centerY, roomIndex: Math.min(2, floor.rooms.length - 1), interacted: false });
    }
  }

  if (mod.id === 'cursed') {
    var cuDM = 1 + (mod.enemyDamageBonus || 0.20);
    var cuGM = 1 + (mod.enemyGoldBonus || 0.50);
    var cuXM = 1 + (mod.enemyXpBonus || 0.50);
    for (var cui = 0; cui < floor.enemies.length; cui++) {
      var cuE = floor.enemies[cui];
      if (cuE.alive !== false) {
        cuE.atk = Math.floor((cuE.atk || 10) * cuDM);
        cuE.gold = Math.floor((cuE.gold || 5) * cuGM);
        cuE.xp = Math.floor((cuE.xp || 10) * cuXM);
      }
    }
  }

  if (mod.id === 'blood_moon') {
    for (var bmi = 0; bmi < floor.enemies.length; bmi++) {
      var bmE = floor.enemies[bmi];
      if (bmE.alive !== false) {
        bmE.regenPerTick = mod.enemyRegenPerTick || 1;
        bmE.vampiricHealPercent = mod.vampiricHealPercent || 0.10;
      }
    }
  }

  if (mod.id === 'mimic_infestation') {
    floor._mimicChance = mod.mimicChance || 0.40;
    floor._mimicTemplate = mod.mimicTemplate || { id: 'mimic', name: 'Mimic', hp: 60, atk: 18, def: 8, xp: 30, gold: 20, isMimic: true };
  }
}

// ---------------------------------------------------------------------------
// Quest Progress Tracking
// Updates daily quest progress based on in-dungeon events.
// eventType: 'kill', 'boss_kill', 'chest_open', 'floor_reached',
//            'npc_rescue', 'no_damage_floor', 'speed_clear', 'floor_cleared'
// eventData: { floorNum, count, floor (floor object for enemy checks), time, ... }
// Returns: { completedQuests: [] | null, changed: boolean }
// ---------------------------------------------------------------------------

function updateQuestProgress(accounts, accKey, eventType, eventData) {
  var acc = accounts.loadAccount(accKey);
  if (!acc) return { completedQuests: null, changed: false };

  var dp = ensureDungeonProgress(acc);
  var today = getTodayString();

  // Ensure daily quests are initialized
  if (dp.lastQuestDate !== today || !dp.dailyQuests) {
    return { completedQuests: null, changed: false }; // quests haven't been fetched yet today
  }

  var questIds = Object.keys(dp.dailyQuests);
  var changed = false;
  var completedQuests = [];

  for (var i = 0; i < questIds.length; i++) {
    var quest = dp.dailyQuests[questIds[i]];
    if (quest.completed || quest.turnedIn) continue;

    var shouldComplete = false;

    switch (quest.templateId) {
      case 'clear_floor':
        // Complete when all enemies are dead on the quest's target floor.
        // On each kill, increment progress. Also check if the floor data was
        // passed in eventData.floor so we can verify all enemies are dead.
        if (eventType === 'kill' || eventType === 'floor_cleared') {
          if (eventType === 'kill') {
            quest.progress = (quest.progress || 0) + 1;
            changed = true;
          }
          // Check if player is on the target floor and all enemies are dead
          if (quest.targetFloor && eventData && eventData.floorNum === quest.targetFloor && eventData.floor) {
            var floorObj = eventData.floor;
            var allDead = true;
            if (floorObj.enemies && floorObj.enemies.length > 0) {
              for (var ei = 0; ei < floorObj.enemies.length; ei++) {
                if (floorObj.enemies[ei].alive !== false) {
                  allDead = false;
                  break;
                }
              }
            } else {
              // No enemies on floor counts as cleared
              allDead = true;
            }
            if (allDead) {
              shouldComplete = true;
              changed = true;
            }
          }
        }
        break;

      case 'boss_kill':
        // Complete when a boss is killed on the quest's target floor.
        if (eventType === 'boss_kill' && eventData && eventData.floorNum) {
          if (quest.targetFloor && eventData.floorNum === quest.targetFloor) {
            quest.progress = 1;
            shouldComplete = true;
            changed = true;
          }
        }
        break;

      case 'collect_chests':
        if (eventType === 'chest_open') {
          quest.progress = (quest.progress || 0) + 1;
          if (quest.targetCount && quest.progress >= quest.targetCount) {
            shouldComplete = true;
          }
          changed = true;
        }
        break;

      case 'reach_depth':
        if (eventType === 'floor_reached' && eventData && eventData.floorNum) {
          if (quest.targetFloor && eventData.floorNum >= quest.targetFloor) {
            quest.progress = quest.targetFloor;
            shouldComplete = true;
          } else if (eventData.floorNum > (quest.progress || 0)) {
            quest.progress = eventData.floorNum;
          }
          changed = true;
        }
        break;

      case 'no_damage_floor':
        // Tracked per-floor; set to 1 if player completes a floor without
        // taking damage (checked at descend time via combat state).
        if (eventType === 'no_damage_floor') {
          quest.progress = 1;
          shouldComplete = true;
          changed = true;
        }
        break;

      case 'rescue_npc':
        if (eventType === 'npc_rescue') {
          quest.progress = 1;
          shouldComplete = true;
          changed = true;
        }
        break;

      case 'speed_clear':
        // Complete if player clears (descends from) a floor within the target time.
        if (eventType === 'speed_clear' && eventData && eventData.time != null) {
          if (quest.targetTime && eventData.time <= quest.targetTime) {
            quest.progress = 1;
            shouldComplete = true;
            changed = true;
          }
        }
        break;
    }

    if (shouldComplete && !quest.completed) {
      quest.completed = true;
      completedQuests.push(quest);
    }
  }

  if (changed) {
    safeSaveAccount(accounts, acc, 'quest_progress');
  }

  return {
    completedQuests: completedQuests.length > 0 ? completedQuests : null,
    changed: changed,
  };
}

// ---------------------------------------------------------------------------
// emitQuestUpdate — sends current quest state to a socket after progress changes.
// Also sends individual completion notifications for newly completed quests.
// ---------------------------------------------------------------------------
function emitQuestUpdate(socket, accounts, accKey, result) {
  if (!socket || !result || !result.changed) return;

  var acc = accounts.loadAccount(accKey);
  if (!acc) return;
  var dp = ensureDungeonProgress(acc);
  if (!dp.dailyQuests) return;

  // Build compact quest state for the client
  var questIds = Object.keys(dp.dailyQuests);
  var questList = [];
  for (var i = 0; i < questIds.length; i++) {
    var q = dp.dailyQuests[questIds[i]];
    questList.push({
      id: q.id,
      name: q.name,
      description: q.description,
      type: q.type,
      xpReward: q.xpReward,
      goldReward: q.goldReward,
      progress: q.progress || 0,
      targetCount: q.targetCount || null,
      targetFloor: q.targetFloor || null,
      targetTime: q.targetTime || null,
      completed: q.completed || false,
      turnedIn: q.turnedIn || false,
    });
  }

  socket.emit('dungeon_quest_update', { quests: questList });

  // Send individual completion notifications for each newly completed quest
  if (result.completedQuests) {
    for (var ci = 0; ci < result.completedQuests.length; ci++) {
      var cq = result.completedQuests[ci];
      socket.emit('dungeon_quest_completed', {
        questId: cq.id,
        questName: cq.name,
        xpReward: cq.xpReward,
        goldReward: cq.goldReward,
      });
    }
  }
}

// Helper: look up card type from account's rpgCards collection
function _getCardTypeFromCollection(acc, instanceId) {
  if (!acc || !acc.rpgCards) return 'passive_perk';
  for (var i = 0; i < acc.rpgCards.length; i++) {
    if (acc.rpgCards[i].instanceId === instanceId) {
      var tmpl = rpgData.CARD_BY_ID[acc.rpgCards[i].cardId] || {};
      return tmpl.type || acc.rpgCards[i].type || 'passive_perk';
    }
  }
  return 'passive_perk';
}

// ---------------------------------------------------------------------------
// Resolve equipped card IDs to full card objects (with template enrichment)
// ---------------------------------------------------------------------------
// account.equippedCards is an array of instanceId strings.
// Card instances in rpgCards lack combatPassive/combatWeapon/combatType fields.
// We resolve IDs to card objects and merge template-only fields so the combat
// system can read combatPassive, combatWeapon, etc.

function resolveEquippedCards(acc) {
  if (!acc || !acc.rpgCards || !acc.equippedCards) return [];
  var cardMap = {};
  for (var i = 0; i < acc.rpgCards.length; i++) {
    cardMap[acc.rpgCards[i].instanceId] = acc.rpgCards[i];
  }
  var resolved = [];
  for (var j = 0; j < acc.equippedCards.length; j++) {
    var cid = acc.equippedCards[j];
    if (!cid || !cardMap[cid]) continue;
    var inst = cardMap[cid];
    var tmpl = rpgData.CARD_BY_ID[inst.cardId] || {};
    // Build a resolved card object: instance data + template-only combat fields
    var card = {
      instanceId: inst.instanceId,
      cardId: inst.cardId,
      name: inst.name,
      type: inst.type,
      rarity: inst.rarity,
      effects: inst.effects || [],
      icon: inst.icon,
      style: inst.style,
      fusionCount: inst.fusionCount || 0,
      raceBonus: tmpl.raceBonus || null,
      tags: tmpl.tags || null,
    };
    // Merge template-only fields for combat system
    if (tmpl.combatPassive) card.combatPassive = tmpl.combatPassive;
    if (tmpl.combatWeapon) card.combatWeapon = tmpl.combatWeapon;
    if (tmpl.combatType) card.combatType = tmpl.combatType;
    if (tmpl.baseDamage !== undefined) card.baseDamage = tmpl.baseDamage;
    if (tmpl.baseHeal !== undefined) card.baseHeal = tmpl.baseHeal;
    if (tmpl.range !== undefined) card.range = tmpl.range;
    if (tmpl.manaCost !== undefined) card.manaCost = tmpl.manaCost;
    if (tmpl.aoeRadius !== undefined) card.aoeRadius = tmpl.aoeRadius;
    if (tmpl.cooldown !== undefined) card.cooldown = tmpl.cooldown;
    if (tmpl.scalingStat) card.scalingStat = tmpl.scalingStat;
    if (tmpl.scalingFactor !== undefined) card.scalingFactor = tmpl.scalingFactor;
    if (tmpl.element) card.element = tmpl.element;
    if (tmpl.targetType) card.targetType = tmpl.targetType;
    if (tmpl.statusEffect) card.statusEffect = tmpl.statusEffect;
    if (tmpl.statusDuration !== undefined) card.statusDuration = tmpl.statusDuration;
    if (tmpl.lifesteal !== undefined) card.lifesteal = tmpl.lifesteal;
    if (tmpl.onHitTile) card.onHitTile = tmpl.onHitTile;
    if (tmpl.animalForm) card.animalForm = tmpl.animalForm;
    if (tmpl.explorationAbilities) card.explorationAbilities = tmpl.explorationAbilities;
    resolved.push(card);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Get active animal form exploration abilities for a player
// ---------------------------------------------------------------------------
// Checks:
// 1. Combat state activeAnimalForm (if in turn-based combat with active morph)
// 2. Equipped animal form cards (exploration works when card is equipped, even out of combat)
// Returns: { formName: string|null, abilities: object, canSpeakTo: string[] }

function getPlayerExplorationAbilities(socketId, accounts, socketAccountMap) {
  var result = { formName: null, abilities: {}, canSpeakTo: [] };

  // Check combat state for active animal form first (takes priority)
  var combat = getPlayerCombat(socketId);
  if (combat && combat.activeAnimalForm) {
    var activeForm = combat.activeAnimalForm;
    var tmpl = rpgData.CARD_BY_ID[activeForm + '_form'];
    if (tmpl && tmpl.explorationAbilities) {
      result.formName = activeForm;
      result.abilities = tmpl.explorationAbilities;
      if (tmpl.explorationAbilities.canAnimalSpeak) {
        result.canSpeakTo = tmpl.explorationAbilities.canAnimalSpeak;
      }
      return result;
    }
  }

  // Check equipped cards for animal form cards (out of combat exploration)
  var accKey = socketAccountMap.get(socketId);
  if (!accKey) return result;
  var acc = accounts.loadAccount(accKey);
  if (!acc) return result;

  var resolved = resolveEquippedCards(acc);
  for (var i = 0; i < resolved.length; i++) {
    var card = resolved[i];
    if (card.animalForm && card.explorationAbilities) {
      // Use the first equipped animal form card found
      result.formName = card.animalForm;
      result.abilities = card.explorationAbilities;
      if (card.explorationAbilities.canAnimalSpeak) {
        result.canSpeakTo = card.explorationAbilities.canAnimalSpeak;
      }
      return result;
    }
  }

  return result;
}

// Check if a player has a specific exploration ability
function playerHasAbility(socketId, abilityName, accounts, socketAccountMap) {
  var ea = getPlayerExplorationAbilities(socketId, accounts, socketAccountMap);
  return !!(ea.abilities && ea.abilities[abilityName]);
}

// ---------------------------------------------------------------------------
// Infer armor type from equipped chest armor for weapon-type vs armor-type modifier
// ---------------------------------------------------------------------------

function getArmorTypeFromEquipment(acc, accounts) {
  if (!acc || !acc.equipment || !acc.equipment.chest) return 'none';
  if (!acc.mmoInventory || !acc.mmoInventory.items) return 'none';
  var bodyId = acc.equipment.chest;
  var bodyItem = acc.mmoInventory.items.find(function(it) { return it.id === bodyId; });
  if (!bodyItem) return 'none';
  var itemType = bodyItem.type || '';
  // Infer from item type name
  if (itemType.indexOf('leather') >= 0) return 'leather';
  if (itemType.indexOf('cloth') >= 0 || itemType.indexOf('robe') >= 0) return 'cloth';
  if (itemType.indexOf('mithril') >= 0 || itemType.indexOf('plate') >= 0 || itemType.indexOf('steel') >= 0 || itemType.indexOf('iron') >= 0 || itemType.indexOf('gold') >= 0 || itemType.indexOf('silver') >= 0) return 'plate';
  if (itemType.indexOf('bronze') >= 0 || itemType.indexOf('copper') >= 0 || itemType.indexOf('chain') >= 0 || itemType.indexOf('mail') >= 0) return 'chain';
  return 'none';
}

// ---------------------------------------------------------------------------
// Player combat state (server-side HP/mana/stamina per dungeon session)
// ---------------------------------------------------------------------------

function initPlayerCombatState(socketId, accounts, accKey) {
  var info = playerDungeons.get(socketId);
  if (!info) return null;

  var acc = accounts.loadAccount(accKey);
  if (!acc) return null;

  // Resolve equipped cards to full objects for both local effect processing and combat system
  var resolvedCards = resolveEquippedCards(acc);

  // Build stat copy so card stat_boost effects feed into computeStats
  var statsCopy = {};
  var baseStats = acc.rpgStats || rpgData.getDefaultStats();
  var statKeys = rpgData.STAT_KEYS || ['vigor', 'might', 'finesse', 'acumen', 'resolve', 'presence', 'ingenuity'];
  for (var si = 0; si < statKeys.length; si++) {
    statsCopy[statKeys[si]] = baseStats[statKeys[si]] || 5;
  }

  // Collect bonus stats from equipped cards BEFORE computeStats
  var bonusHp = 0;
  var bonusCrit = 0;
  var bonusDodge = 0;
  var bonusMeleeDmg = 0;
  var bonusMagicDmg = 0;
  var bonusDungeonDmg = 0;
  var bonusBossDmg = 0;
  var bonusDungeonDef = 0;
  var hpRegenBonus = 0;
  var weaponDmgBonus = 0;
  var spellDmgBonus = 0;
  var poisonDmgBonus = 0;
  var counterChanceBonus = 0;
  var maxManaBonus = 0;
  var manaEfficiency = 0;
  var bonusMagicResist = 0;
  var elementalResistAll = 0;
  var lowHpDmgReduction = 0;
  var dungeonXpBonus = 0;
  var bossLootBonus = 0;
  var outOfCombatHeal = 0;
  var stealthBonus = 0;
  var lockpickingBonus = 0;
  var thieveryBonus = 0;
  var stealChance = 0;
  var hiddenDetection = 0;

  for (var ci = 0; ci < resolvedCards.length; ci++) {
    var card = resolvedCards[ci];
    if (!card || !card.effects) continue;
    for (var ei = 0; ei < card.effects.length; ei++) {
      var eff = card.effects[ei];
      if (eff.type === 'hp_bonus') bonusHp += (eff.value || 0);
      if (eff.type === 'crit_bonus') bonusCrit += (eff.value || 0);
      if (eff.type === 'dodge_bonus') bonusDodge += (eff.value || 0);
      if (eff.type === 'melee_damage_bonus') {
        var val = (acc.race && eff.raceValue && acc.race === (card.raceBonus || '')) ? eff.raceValue : (eff.value || 0);
        bonusMeleeDmg += val;
      }
      if (eff.type === 'dungeon_damage_bonus') bonusDungeonDmg += (eff.value || 0);
      if (eff.type === 'boss_damage_bonus') bonusBossDmg += (eff.value || 0);
      if (eff.type === 'dungeon_def_bonus') bonusDungeonDef += (eff.value || 0);
      if (eff.type === 'stat_boost_all') {
        // All stats boosted — affects computed HP indirectly; add direct HP bonus
        bonusHp += (eff.value || 0) * 10; // vigor portion: +10 HP per vigor point
        // Also boost the stat copy for computeStats
        for (var ski = 0; ski < statKeys.length; ski++) {
          statsCopy[statKeys[ski]] += (eff.value || 0);
        }
      }
      // Fix 2: Handle per-stat stat_boost (vigor_I, might_I, etc.)
      if (eff.type === 'stat_boost' && eff.stat) {
        statsCopy[eff.stat] = (statsCopy[eff.stat] || 5) + (eff.value || 0);
      }
      // Fix 4: hp_regen from cards
      if (eff.type === 'hp_regen') {
        hpRegenBonus += (eff.value || 0);
      }
      // Fix 5: weapon_element bonus damage from cards
      if (eff.type === 'weapon_element' && eff.bonusDamage) {
        weaponDmgBonus += eff.bonusDamage;
      }
      // Combat card passives
      if (eff.type === 'spell_damage_bonus') spellDmgBonus += (eff.value || 0);
      if (eff.type === 'poison_damage_bonus') poisonDmgBonus += (eff.value || 0);
      if (eff.type === 'counter_chance_bonus') counterChanceBonus += (eff.value || 0);
      if (eff.type === 'max_mana_bonus') maxManaBonus += (eff.value || 0);
      if (eff.type === 'mana_efficiency') manaEfficiency += (eff.value || 0);
      if (eff.type === 'magic_resist') bonusMagicResist += (eff.value || 0);
      if (eff.type === 'elemental_resist_all') elementalResistAll += (eff.value || 0);
      if (eff.type === 'low_hp_damage_reduction') lowHpDmgReduction += (eff.value || 0);
      // Dungeon-specific card passives
      if (eff.type === 'dungeon_xp_bonus') dungeonXpBonus += (eff.value || 0);
      if (eff.type === 'boss_loot_bonus') bossLootBonus += (eff.value || 0);
      if (eff.type === 'out_of_combat_heal') outOfCombatHeal += (eff.value || 0);
      // Rogue card passives
      if (eff.type === 'stealth_bonus') stealthBonus += (eff.value || 0);
      if (eff.type === 'lockpicking_bonus') lockpickingBonus += (eff.value || 0);
      if (eff.type === 'thievery_bonus') thieveryBonus += (eff.value || 0);
      if (eff.type === 'steal_chance') stealChance += (eff.value || 0);
      if (eff.type === 'hidden_detection') hiddenDetection += (eff.value || 0);
    }
  }

  // Ascension: Iron Resolve — +5% vigor per rank
  var ascTree = acc.ascensionTree || {};
  var ironResolveRank = ascTree['iron_resolve'] || 0;
  if (ironResolveRank > 0) {
    statsCopy['vigor'] = Math.round(statsCopy['vigor'] * (1 + ironResolveRank * 0.05));
  }

  // Now compute stats using the boosted stat copy
  var computed = rpgData.computeStats(statsCopy, acc.level || 1, acc.race);

  var maxHp = computed.hp + bonusHp;

  // Get dual hand stats
  var handStats = accounts.getEquippedHandStats ? accounts.getEquippedHandStats(accKey) : { mainHand: null, offHand: null };
  var mh = handStats.mainHand;
  var oh = handStats.offHand;

  // Main hand weapon stats
  var weaponDamage = (mh ? (mh.damage || 0) : 0) + weaponDmgBonus;
  var weaponMagicDamage = mh ? (mh.magicDamage || 0) : 0;
  var weaponCritBonus = mh ? (mh.critBonus || 0) : 0;
  var weaponCategory = mh ? (mh.category || 'melee_blade') : 'melee_blade';
  var weaponRange = mh ? (mh.range || 1.5) : 1.5;
  var weaponSpeed = mh ? (mh.speed || 1.0) : 1.0;

  // Off hand contribution
  var offHandDamage = 0;
  var offHandMagicDamage = 0;
  var blockChance = 0;
  var offHandDefense = 0;

  if (oh) {
    if (oh.slot === 'shield' || oh.defense) {
      // Shield in off-hand
      blockChance = oh.blockChance || 0;
      offHandDefense = oh.defense || 0;
    } else {
      // Weapon in off-hand: adds 50% of its damage (base penalty)
      var offPenalty = 0.50;
      offHandDamage = Math.floor((oh.damage || 0) * offPenalty);
      offHandMagicDamage = Math.floor((oh.magicDamage || 0) * offPenalty);
      weaponCritBonus += (oh.critBonus || 0) * 0.5;
    }
  }

  // Apply dual-wield combo bonuses
  var dualCombo = accounts.getDualWieldCombo ? accounts.getDualWieldCombo(accKey) : null;
  if (dualCombo && dualCombo.bonuses) {
    var b = dualCombo.bonuses;
    if (b.attackSpeed) weaponSpeed *= (1 + b.attackSpeed);
    if (b.meleeDmgBonus) weaponDamage = Math.floor(weaponDamage * (1 + b.meleeDmgBonus));
    if (b.magicDmgBonus) weaponMagicDamage = Math.floor(weaponMagicDamage * (1 + b.magicDmgBonus));
    if (b.critBonus) weaponCritBonus += b.critBonus;
    if (b.blockChance) blockChance += b.blockChance;
    if (b.defense) offHandDefense += b.defense;
    if (b.dodgeBonus) bonusDodge += b.dodgeBonus;
    if (b.maxManaBonus) maxManaBonus += b.maxManaBonus;
    if (b.magicResist) bonusMagicResist += b.magicResist;
  }

  // Titan Grip off-hand penalty
  if (dualCombo && dualCombo.penalties && dualCombo.penalties.offHandDmgPenalty) {
    offHandDamage = Math.floor(offHandDamage * (1 - dualCombo.penalties.offHandDmgPenalty));
  }

  // Get armor stats from equipped gear (defense, magic resist, magic damage, crit, speed)
  var armorStats = accounts.getEquippedArmorStats ? accounts.getEquippedArmorStats(accKey) : { totalDefense: 0, totalMagicResist: 0, totalMagicDamage: 0, totalCritBonus: 0, totalSpeedMod: 0 };
  var armorTotal = armorStats.totalDefense + offHandDefense;

  // Compute dungeon skill bonuses
  var skillBonuses = getDungeonSkillBonuses(acc);

  // Compute combat skill bonuses from weapon proficiency (Fix 4)
  var combatSkillBonuses = rpgData.getCombatSkillBonuses(acc.skills, weaponCategory);

  // Mastery tree bonuses for weapon skill
  var combatMastery = masteryCore.getSkillMasteryBonuses(acc, weaponCategory);

  // Infer armor type from equipped body armor (Fix 3)
  var armorType = getArmorTypeFromEquipment(acc, accounts);

  var baseMana = 50 + (statsCopy.acumen || 5) * 5 + maxManaBonus;

  info.combat = {
    hp: maxHp,
    maxHp: maxHp,
    mana: baseMana,
    maxMana: baseMana,
    stamina: 100,
    maxStamina: 100,
    critChance: computed.critChance + bonusCrit + weaponCritBonus + (combatSkillBonuses.critBonus || 0) + armorStats.totalCritBonus + (combatMastery.crit_chance_pct || 0),
    dodgeChance: computed.dodgeChance + bonusDodge,
    meleeDmgMult: computed.meleeDamageMultiplier + bonusMeleeDmg + (combatSkillBonuses.damageBonus || 0) + (companions.getTotalCompanionDamage(acc) * 0.01) + (combatMastery.damage_pct || 0),
    magicDmgMult: computed.magicPowerMultiplier + bonusMagicDmg + (combatMastery.spell_damage_pct || 0),
    dungeonDmgBonus: bonusDungeonDmg,
    bossDmgBonus: bonusBossDmg,
    dungeonDefBonus: bonusDungeonDef,
    hpRegen: computed.hpRegen + skillBonuses.dungeonHpRegen + hpRegenBonus,
    baseArmor: computed.baseArmor + armorTotal,
    magicResist: (computed.magicResist || 0) + armorStats.totalMagicResist + bonusMagicResist,
    armorType: armorType,
    weaponDamage: weaponDamage,
    weaponMagicDamage: weaponMagicDamage + armorStats.totalMagicDamage,
    weaponCategory: weaponCategory,
    weaponRange: weaponRange,
    weaponSpeed: weaponSpeed,
    armorSpeedMod: armorStats.totalSpeedMod || 0,
    blockChance: blockChance,
    // Per-floor damage tracking for no_damage_floor quest
    damageTakenThisFloor: 0,
    // Dungeon skill bonuses (stored on combat state so handlers can access)
    skillBonuses: skillBonuses,
    // Card combat passives (stored for use in combat resolution)
    spellDmgBonus: spellDmgBonus + (combatMastery.spell_damage_pct || 0),
    poisonDmgBonus: poisonDmgBonus,
    counterChanceBonus: counterChanceBonus,
    manaEfficiency: manaEfficiency + (combatMastery.cooldown_reduction_pct || 0),
    elementalResistAll: elementalResistAll,
    lowHpDmgReduction: lowHpDmgReduction,
    dungeonXpBonus: dungeonXpBonus,
    bossLootBonus: bossLootBonus,
    outOfCombatHeal: outOfCombatHeal,
    // Rogue card passives
    stealthBonus: stealthBonus,
    lockpickingBonus: lockpickingBonus,
    thieveryBonus: thieveryBonus,
    stealChance: stealChance,
    hiddenDetection: hiddenDetection,
    // Dual-wield combo data
    dualWieldCombo: dualCombo ? dualCombo.name : null,
    dualWieldSkills: dualCombo ? dualCombo.skills : [],
    offHandDamage: offHandDamage,
    offHandMagicDamage: offHandMagicDamage,
  };

  // ----------- LOOT SYSTEM INTEGRATION -----------
  // Gather all equipped items for gem/augment/set/unique bonus calculation
  var allEquippedItems = [];
  var eq = acc.equipment || {};
  var inv = (acc.mmoInventory && acc.mmoInventory.items) || [];
  var allSlots = accounts.EQUIPMENT_SLOTS || [];
  for (var eqi = 0; eqi < allSlots.length; eqi++) {
    var eqItemId = eq[allSlots[eqi]];
    if (!eqItemId) continue;
    var eqItem = null;
    for (var eqj = 0; eqj < inv.length; eqj++) {
      if (inv[eqj].id === eqItemId) { eqItem = inv[eqj]; break; }
    }
    if (eqItem) allEquippedItems.push(eqItem);
  }

  // --- Aggregate gem bonuses across all equipped items ---
  var totalGemBonuses = {};
  for (var gi = 0; gi < allEquippedItems.length; gi++) {
    var gemBonuses = lootGen.getGemBonuses(allEquippedItems[gi]);
    for (var gk in gemBonuses) {
      totalGemBonuses[gk] = (totalGemBonuses[gk] || 0) + gemBonuses[gk];
    }
  }
  info.combat.gemBonuses = totalGemBonuses;

  // Apply flat gem stat bonuses to combat
  if (totalGemBonuses.damage) info.combat.weaponDamage += totalGemBonuses.damage;
  if (totalGemBonuses.magicDamage) info.combat.weaponMagicDamage += totalGemBonuses.magicDamage;
  if (totalGemBonuses.defense) info.combat.baseArmor += totalGemBonuses.defense;
  if (totalGemBonuses.magicResist) info.combat.magicResist += totalGemBonuses.magicResist;
  if (totalGemBonuses.hpRegen) info.combat.hpRegen += totalGemBonuses.hpRegen;
  if (totalGemBonuses.lifeSteal) info.combat.lifeSteal = (info.combat.lifeSteal || 0) + totalGemBonuses.lifeSteal;
  if (totalGemBonuses.xpBonus) info.combat.xpBonus = (info.combat.xpBonus || 0) + totalGemBonuses.xpBonus;

  // --- Aggregate augment bonuses across all equipped items ---
  var totalAugBonuses = {};
  for (var ai = 0; ai < allEquippedItems.length; ai++) {
    var augBonuses = lootGen.getAugmentBonuses(allEquippedItems[ai]);
    for (var ak in augBonuses) {
      totalAugBonuses[ak] = (totalAugBonuses[ak] || 0) + augBonuses[ak];
    }
  }
  info.combat.augmentBonuses = totalAugBonuses;

  // Apply flat augment stat bonuses to combat
  if (totalAugBonuses.speed) info.combat.weaponSpeed += totalAugBonuses.speed;
  if (totalAugBonuses.critBonus) info.combat.critChance += totalAugBonuses.critBonus;
  if (totalAugBonuses.range) info.combat.weaponRange += totalAugBonuses.range;
  if (totalAugBonuses.hpRegen) info.combat.hpRegen += totalAugBonuses.hpRegen;
  if (totalAugBonuses.manaRegen) info.combat.manaRegen = (info.combat.manaRegen || 0) + totalAugBonuses.manaRegen;
  if (totalAugBonuses.manaCostReduction) info.combat.manaEfficiency += totalAugBonuses.manaCostReduction;
  if (totalAugBonuses.thornsDamage) info.combat.thornsDamage = (info.combat.thornsDamage || 0) + totalAugBonuses.thornsDamage;

  // --- Set bonus calculation ---
  var activeSetBonuses = lootGen.getActiveSetBonuses(allEquippedItems);
  info.combat.activeSetBonuses = activeSetBonuses;

  // Apply flat set bonus stats
  for (var sbi = 0; sbi < activeSetBonuses.length; sbi++) {
    var sbEff = activeSetBonuses[sbi].effects;
    if (!sbEff) continue;
    if (sbEff.hpRegen) info.combat.hpRegen += sbEff.hpRegen;
    if (sbEff.defense) info.combat.baseArmor += sbEff.defense;
    if (sbEff.magicResist) info.combat.magicResist += sbEff.magicResist;
    if (sbEff.blockChance) info.combat.blockChance += sbEff.blockChance;
    if (sbEff.manaRegen) info.combat.manaRegen = (info.combat.manaRegen || 0) + sbEff.manaRegen;
    if (sbEff.critBonus) info.combat.critChance += sbEff.critBonus;
    if (sbEff.bleedOnCrit) info.combat.bleedOnCrit = (info.combat.bleedOnCrit || 0) + sbEff.bleedOnCrit;
    if (sbEff.fireDmgBonus) info.combat.fireDmgBonus = (info.combat.fireDmgBonus || 0) + sbEff.fireDmgBonus;
    if (sbEff.lowHpDamageReduction) info.combat.lowHpDmgReduction += sbEff.lowHpDamageReduction;
  }

  // --- Weapon special (charge-based active ability) ---
  var mhItem = null;
  for (var wsi = 0; wsi < inv.length; wsi++) {
    if (inv[wsi].id === (eq.main_hand || eq.weapon)) { mhItem = inv[wsi]; break; }
  }
  if (mhItem) {
    var weaponSpecial = lootGen.getWeaponSpecial(mhItem.type, weaponCategory, mhItem.uniqueId || null);
    if (weaponSpecial) {
      info.combat.weaponSpecial = weaponSpecial;
      info.combat.weaponSpecialCharge = 0;
    }
  }

  // --- Unique item effect (from main hand) ---
  if (mhItem && mhItem.uniqueEffect) {
    info.combat.uniqueEffect = mhItem.uniqueEffect;
  }

  // --- Inscriptions (reusable scroll abilities) ---
  if (acc.inscriptions) {
    var combatInscriptions = {};
    for (var insKey in acc.inscriptions) {
      var insData = acc.inscriptions[insKey];
      var fullInscription = lootGen.getInscriptionData(insKey, insData.upgradeLevel || 0);
      if (fullInscription) {
        combatInscriptions[insKey] = {
          name: fullInscription.name,
          cooldown: fullInscription.cooldown,
          effect: fullInscription.effect,
          currentCooldown: 0,
          upgradeLevel: insData.upgradeLevel || 0,
        };
      }
    }
    info.combat.inscriptions = combatInscriptions;
  }

  // --- Wand properties (spell slot system for magic weapons) ---
  if (mhItem && mhItem.wandProps) {
    info.combat.wandProps = mhItem.wandProps;
  } else if (mh && mh.wandProps) {
    info.combat.wandProps = mh.wandProps;
  }

  // --- Ring special effects (from equipped ring items) ---
  var ringEffects = {};
  var ringSlots = ['ring1', 'ring2', 'ring3', 'ring4', 'ring5', 'ring6'];
  for (var ri = 0; ri < ringSlots.length; ri++) {
    var ringItemId = eq[ringSlots[ri]];
    if (!ringItemId) continue;
    var ringItem = null;
    for (var rj = 0; rj < inv.length; rj++) {
      if (inv[rj].id === ringItemId) { ringItem = inv[rj]; break; }
    }
    if (!ringItem) continue;
    // Check loot-generator ring designs for special effects
    var ringDesign = lootGen.RING_DESIGNS[ringItem.type];
    if (ringDesign && ringDesign.effects) {
      for (var rk in ringDesign.effects) {
        if (typeof ringDesign.effects[rk] === 'number') {
          ringEffects[rk] = (ringEffects[rk] || 0) + ringDesign.effects[rk] * (ringItem.imbued ? 2 : 1);
        } else {
          ringEffects[rk] = ringDesign.effects[rk];
        }
      }
    }
    // Also check procedural ring stats
    if (ringItem.stats) {
      for (var rsk in ringItem.stats) {
        if (typeof ringItem.stats[rsk] === 'number') {
          ringEffects[rsk] = (ringEffects[rsk] || 0) + ringItem.stats[rsk];
        }
      }
    }
  }
  info.combat.ringEffects = ringEffects;

  // Apply ring combat stats
  if (ringEffects.critBonus) info.combat.critChance += ringEffects.critBonus;
  if (ringEffects.damage) info.combat.weaponDamage += ringEffects.damage;
  if (ringEffects.magicDamagePct) info.combat.magicDmgMult += ringEffects.magicDamagePct;
  if (ringEffects.rangedDamagePct) info.combat.rangedDmgBonus = (info.combat.rangedDmgBonus || 0) + ringEffects.rangedDamagePct;
  if (ringEffects.armorPenetration) info.combat.armorPen = (info.combat.armorPen || 0) + ringEffects.armorPenetration;
  if (ringEffects.vigor) info.combat.maxHp += ringEffects.vigor * 10;
  if (ringEffects.finesse) info.combat.critChance += ringEffects.finesse * 0.01;
  if (ringEffects.hpRegen) info.combat.hpRegen += ringEffects.hpRegen;
  if (ringEffects.magicResist) info.combat.magicResist += ringEffects.magicResist;
  if (ringEffects.manaMax) info.combat.maxMana += ringEffects.manaMax;
  if (ringEffects.manaRegen) info.combat.manaRegen = (info.combat.manaRegen || 0) + ringEffects.manaRegen;
  if (ringEffects.staminaMax) info.combat.maxStamina += ringEffects.staminaMax;
  if (ringEffects.staminaRegen) info.combat.staminaRegen = (info.combat.staminaRegen || 0) + ringEffects.staminaRegen;
  if (ringEffects.speedBonus) info.combat.armorSpeedMod += ringEffects.speedBonus;
  if (ringEffects.dodgeBonus) info.combat.dodgeChance += ringEffects.dodgeBonus;
  if (ringEffects.lootBonus) info.combat.bossLootBonus += ringEffects.lootBonus;
  if (ringEffects.fogRadius) info.combat.fogRadiusBonus = (info.combat.fogRadiusBonus || 0) + ringEffects.fogRadius;
  if (ringEffects.reviveOnce) info.combat.reviveOnce = true;
  if (ringEffects.reviveHpPct) info.combat.reviveHpPct = ringEffects.reviveHpPct;

  // Set HP/mana to their new max values (accounting for all bonuses)
  info.combat.hp = info.combat.maxHp;
  info.combat.mana = info.combat.maxMana;
  info.combat.stamina = info.combat.maxStamina;

  // Store resolved cards on player info so they can be passed to combat system
  info.resolvedCards = resolvedCards;

  playerDungeons.set(socketId, info);
  return info.combat;
}

function getPlayerCombat(socketId) {
  var info = playerDungeons.get(socketId);
  return (info && info.combat) ? info.combat : null;
}

// --- Shrine buff helpers ---

// Apply (or remove) a shrine buff's stat effect on a combat state.
// When isRemoval is true the effect is subtracted instead of added.
function applyShrineBuff(combat, effect, isRemoval) {
  if (!combat || !effect) return;
  var sign = isRemoval ? -1 : 1;
  if (effect.atkBoost) {
    combat.weaponDamage = (combat.weaponDamage || 0) + effect.atkBoost * sign;
  }
  if (effect.defBoost) {
    combat.baseArmor = (combat.baseArmor || 0) + effect.defBoost * sign;
  }
  if (effect.hpBoost) {
    combat.maxHp = (combat.maxHp || 0) + effect.hpBoost * sign;
    combat.hp = (combat.hp || 0) + effect.hpBoost * sign;
    if (combat.hp < 1) combat.hp = 1;
    if (combat.hp > combat.maxHp) combat.hp = combat.maxHp;
  }
  if (effect.luckBoost) {
    combat.critChance = (combat.critChance || 0) + effect.luckBoost * 0.01 * sign;
    if (combat.critChance < 0) combat.critChance = 0;
  }
}

// Walk the activeBuffs array, remove any whose expiresAt has passed,
// and reverse their stat effects on the combat state.
function purgeExpiredBuffs(combat) {
  if (!combat || !combat.activeBuffs || combat.activeBuffs.length === 0) return;
  var now = Date.now();
  var kept = [];
  for (var i = 0; i < combat.activeBuffs.length; i++) {
    var b = combat.activeBuffs[i];
    if (b.expiresAt <= now) {
      // Buff expired — reverse its effect
      applyShrineBuff(combat, b.effect, true);
    } else {
      kept.push(b);
    }
  }
  combat.activeBuffs = kept;
}

// --- Extracted damage formula (shared with dungeon-combat.js via callback) ---
function calculateDamage(rpgStats, level, combat, enemy) {
  // Purge expired shrine buffs before computing damage
  purgeExpiredBuffs(combat);
  var baseAtk = (rpgStats.might * 2) + (level * 1.5) + combat.weaponDamage;
  var damage = Math.max(1, Math.floor(baseAtk * combat.meleeDmgMult - enemy.def));

  if (combat.dungeonDmgBonus > 0) {
    damage = Math.floor(damage * (1 + combat.dungeonDmgBonus));
  }
  if (enemy.isBoss && combat.bossDmgBonus > 0) {
    damage = Math.floor(damage * (1 + combat.bossDmgBonus));
  }
  var skillBonuses = combat.skillBonuses;
  if (skillBonuses && skillBonuses.dungeonDamageMult > 1) {
    damage = Math.floor(damage * skillBonuses.dungeonDamageMult);
  }
  if (enemy.isBoss && skillBonuses && skillBonuses.bossDamageMult > 1) {
    damage = Math.floor(damage * skillBonuses.bossDamageMult);
  }

  var isCrit = false;
  if (Math.random() < combat.critChance) {
    isCrit = true;
    damage = Math.floor(damage * 1.5);
  }

  return { damage: damage, isCrit: isCrit };
}

// --- Turn-based combat trigger helpers ---

// Find nearby enemies within a radius of a tile position
function findNearbyEnemies(floor, cx, cy, radius) {
  var nearby = [];
  for (var i = 0; i < floor.enemies.length; i++) {
    var e = floor.enemies[i];
    if (e.alive === false) continue;
    if (e.inTurnCombat) continue;
    var dist = Math.abs(e.x - cx) + Math.abs(e.y - cy);
    if (dist <= radius) nearby.push(e);
  }
  return nearby;
}

// Find nearby players on the same floor within a radius
function findNearbyPlayers(zoneId, cx, cy, radius) {
  var pMap = floorPlayers.get(zoneId);
  if (!pMap) return [];
  var nearby = [];
  pMap.forEach(function(p, sid) {
    if (p.inTurnCombat) return; // skip players already in turn-based combat
    var px = p.x;
    var py = p.y;
    var dist = Math.abs(px - cx) + Math.abs(py - cy);
    if (dist <= radius) nearby.push({ socketId: sid, x: px, y: py, name: p.name || 'Player' });
  });
  return nearby;
}

// Build the callbacks object that dungeon-combat.js needs
function buildCombatCallbacks(io, state, accounts, socketAccountMap, dungeonId, floorNum) {
  return {
    getPlayerInfo: function(socketId) {
      var accKey = socketAccountMap.get(socketId);
      if (!accKey) return null;
      var acc = accounts.loadAccount(accKey);
      if (!acc) return null;
      var pInfo = playerDungeons.get(socketId);
      var pResolved = (pInfo && pInfo.resolvedCards) ? pInfo.resolvedCards : resolveEquippedCards(acc);
      return {
        accKey: accKey,
        race: acc.race,
        rpgStats: acc.rpgStats || rpgData.getDefaultStats(),
        level: acc.level || 1,
        equippedCards: pResolved,
        name: acc.username || 'Player',
      };
    },
    swapCard: function(socketId, unequipInstanceId, equipInstanceId) {
      var accKey = socketAccountMap.get(socketId);
      if (!accKey) return { error: 'No account' };
      var acc = accounts.loadAccount(accKey);
      if (!acc) return { error: 'Account not found' };

      // Migrate old null-padded arrays
      if (!acc.equippedCards) acc.equippedCards = [];
      var hasNulls = false;
      for (var ni = 0; ni < acc.equippedCards.length; ni++) {
        if (acc.equippedCards[ni] === null || acc.equippedCards[ni] === undefined) { hasNulls = true; break; }
      }
      if (hasNulls) {
        var clean = [];
        for (var ci = 0; ci < acc.equippedCards.length; ci++) {
          if (acc.equippedCards[ci]) clean.push(acc.equippedCards[ci]);
        }
        acc.equippedCards = clean;
      }

      if (!acc.rpgCards) return { error: 'No cards' };

      var activeSlots = acc.activeCardSlots || rpgData.getActiveCardSlotCount(acc.level || 1);
      var passiveSlots = acc.passiveCardSlots || rpgData.getPassiveCardSlotCount(acc.level || 1);

      // Count currently equipped active vs passive
      var activeCount = 0, passiveCount = 0;
      for (var eci = 0; eci < acc.equippedCards.length; eci++) {
        var eqType = _getCardTypeFromCollection(acc, acc.equippedCards[eci]);
        if (rpgData.isActiveCardType(eqType)) activeCount++;
        else passiveCount++;
      }

      // Validate the card to equip exists in collection
      var equipCard = null;
      var equipCardType = null;
      if (equipInstanceId) {
        for (var ei = 0; ei < acc.rpgCards.length; ei++) {
          if (acc.rpgCards[ei].instanceId === equipInstanceId) { equipCard = acc.rpgCards[ei]; break; }
        }
        if (!equipCard) return { error: 'Card not found in collection' };
        if (acc.equippedCards.indexOf(equipInstanceId) !== -1) return { error: 'Card already equipped' };
        var tmpl = rpgData.CARD_BY_ID[equipCard.cardId] || {};
        equipCardType = tmpl.type || equipCard.type || 'passive_perk';
      }

      // Unequip the old card
      if (unequipInstanceId) {
        var idx = acc.equippedCards.indexOf(unequipInstanceId);
        if (idx === -1) return { error: 'Card not equipped' };
        acc.equippedCards.splice(idx, 1);
        var unType = _getCardTypeFromCollection(acc, unequipInstanceId);
        if (rpgData.isActiveCardType(unType)) activeCount--;
        else passiveCount--;
      }

      // Equip the new card with type-specific slot validation
      if (equipInstanceId) {
        var isActive = rpgData.isActiveCardType(equipCardType);
        if (isActive && activeCount >= activeSlots) return { error: 'No active card slots available (' + activeCount + '/' + activeSlots + ')' };
        if (!isActive && passiveCount >= passiveSlots) return { error: 'No passive card slots available (' + passiveCount + '/' + passiveSlots + ')' };
        acc.equippedCards.push(equipInstanceId);
      }

      accounts.saveAccount(acc);

      // Rebuild resolved cards and combat state for this player
      var resolvedCards = resolveEquippedCards(acc);
      var pInfo = playerDungeons.get(socketId);
      if (pInfo) pInfo.resolvedCards = resolvedCards;
      initPlayerCombatState(socketId, accounts, accKey);

      return { success: true, equippedCards: acc.equippedCards, resolvedCards: resolvedCards, activeCardSlots: activeSlots, passiveCardSlots: passiveSlots };
    },
    handleDeath: function(socketId, killerName) {
      var accKey = socketAccountMap.get(socketId);
      var info = playerDungeons.get(socketId);
      var targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket && info) {
        handlePlayerDeath(targetSocket, io, state, accounts, accKey, info, 'Slain by ' + (killerName || 'a monster'));
        var zoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        var pMap = floorPlayers.get(zoneId);
        if (pMap) pMap.delete(socketId);
      }
    },
    awardKillRewards: function(socketId, enemy, floorNum, floorTheme) {
      var accKey = socketAccountMap.get(socketId);
      if (!accKey) return {};

      var combat = getPlayerCombat(socketId);
      var killSkillBonuses = combat ? combat.skillBonuses : {};
      var killXpMult = (killSkillBonuses && killSkillBonuses.dungeonXpMult) ? killSkillBonuses.dungeonXpMult : 1;
      var killGoldMult = (killSkillBonuses && killSkillBonuses.killGoldMult) ? killSkillBonuses.killGoldMult : 1;
      var allGoldMult = (killSkillBonuses && killSkillBonuses.allGoldMult) ? killSkillBonuses.allGoldMult : 1;

      // Apply server rules xpRate/dropRate if configured
      var serverXpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : 1;
      var serverDropRate = (deps.serverRules && deps.serverRules.dropRate) ? deps.serverRules.dropRate : 1;

      var baseXp = enemy.xp || 10;
      // Card: dungeon_xp_bonus — percentage boost to dungeon kill XP
      var cardDungeonXpBonus = (combat && combat.dungeonXpBonus) ? combat.dungeonXpBonus : 0;
      // Ascension: Deep Knowledge — +5% XP per rank
      var killAcc = accounts.loadAccount(accKey);
      var deepKnowledgeBonus = (killAcc && killAcc.ascensionTree && killAcc.ascensionTree['deep_knowledge']) ? killAcc.ascensionTree['deep_knowledge'] * 0.05 : 0;
      var finalXp = Math.floor(baseXp * killXpMult * serverXpRate * (1 + cardDungeonXpBonus + deepKnowledgeBonus));
      var xpResult = accounts.addSkillXp(accKey, 'dungeon_delving', finalXp);

      var goldGained = enemy.gold || 0;
      if (goldGained > 0) {
        goldGained = Math.floor(goldGained * killGoldMult * allGoldMult);
        accounts.updateChips(accKey, goldGained);
      }

      // Card: steal_chance — chance to steal extra gold from killed enemies
      var cardStealChance = (combat && combat.stealChance) ? combat.stealChance : 0;
      if (cardStealChance > 0 && Math.random() < cardStealChance) {
        var stolenGold = Math.floor((enemy.gold || 10) * 0.5) + Math.floor(Math.random() * 6);
        if (stolenGold > 0) {
          accounts.updateChips(accKey, stolenGold);
          goldGained += stolenGold;
        }
      }

      // Party sharing (members is a Set, use Array.from for iteration)
      var killParty = state.getPlayerParty(socketId);
      var info = playerDungeons.get(socketId);
      var zoneId = info ? getZoneIdForDungeon(info.dungeonId, info.floorNum) : null;
      if (killParty && killParty.members && zoneId) {
        var killFloorPlayers = floorPlayers.get(zoneId);
        var partyMemberArr = Array.from(killParty.members);
        for (var mi = 0; mi < partyMemberArr.length; mi++) {
          var partyMemberId = partyMemberArr[mi];
          if (partyMemberId === socketId) continue;
          if (!killFloorPlayers || !killFloorPlayers.has(partyMemberId)) continue;
          var partyMemberAccKey = socketAccountMap.get(partyMemberId);
          if (!partyMemberAccKey) continue;
          var partyXp = Math.floor(finalXp * 0.75);
          if (partyXp > 0) accounts.addSkillXp(partyMemberAccKey, 'dungeon_delving', partyXp); // xpRate already applied to finalXp
          if (goldGained > 0) accounts.updateChips(partyMemberAccKey, goldGained);
        }
      }

      // --- Phantom Skill XP: Anatomy on dungeon kills ---
      // Anatomy: 3 XP per regular kill, 50 XP bonus per boss kill
      accounts.addSkillXp(accKey, 'anatomy', 3);
      if (enemy.isBoss) {
        accounts.addSkillXp(accKey, 'anatomy', 50);
      }

      // --- Card Evolution XP: combat category on kills ---
      var _killEvoXp = enemy.isBoss ? 10 : 5;
      accounts.gainArchetypeCategoryXp(accKey, 'combat', _killEvoXp);
      // Magic-tagged enemies also feed the 'magic' category
      if (enemy.tags && enemy.tags.indexOf('magic') >= 0) {
        accounts.gainArchetypeCategoryXp(accKey, 'magic', _killEvoXp);
      }

      // --- Pet evolution XP on kills ---
      if (killAcc && killAcc.activePet) {
        var petEvoXp = enemy.isBoss ? 50 : 10;
        var petEvoResult = petsHandler.awardPetEvoXp(killAcc, petEvoXp);
        if (petEvoResult && petEvoResult.evolved) {
          var killSocket = io.sockets.sockets.get(socketId);
          if (killSocket) {
            killSocket.emit('pet_evolved', { petId: killAcc.activePet, newLevel: petEvoResult.newLevel, newName: petEvoResult.newName });
          }
        }
      }

      // --- Procedural loot drop on regular enemy kills (15% base chance, scales with depth) ---
      if (!enemy.isBoss) {
        var dropChance = 0.15 + Math.min(floorNum * 0.003, 0.15); // 15%-30%
        var lootBonusFromCombat = (combat && combat.bossLootBonus) ? combat.bossLootBonus : 0;
        dropChance += lootBonusFromCombat;
        if (Math.random() < dropChance) {
          try {
            var mobLootSpecs = lootGen.rollDungeonLoot(floorNum, false, false);
            if (mobLootSpecs && mobLootSpecs.length > 0) {
              var mobLootPool = getFloorLootPool(floorNum);
              var mlSpec = mobLootSpecs[0]; // Regular mobs drop 1 item
              var mlBaseType = mobLootPool[Math.floor(Math.random() * mobLootPool.length)];
              var mlBaseDef = accounts.WEAPON_TYPES[mlBaseType];
              if (mlBaseDef) {
                var mlItem = lootGen.generateItem(mlBaseType, mlBaseDef, {
                  source: 'drop',
                  depth: floorNum,
                  forcedRarity: mlSpec.rarity,
                  luckBonus: accounts.getPlayerLuck(accKey),
                });
                if (mlItem) {
                  mlItem.maxDurability = accounts.getMaxDurability(mlBaseType);
                  mlItem.durability = mlItem.maxDurability;
                  var mlAddResult = accounts.addMMOItem(accKey, mlItem);
                  var mobLootSock = io.sockets.sockets.get(socketId);
                  if (mobLootSock) {
                    if (mlAddResult && mlAddResult.error) {
                      mobLootSock.emit('loot_dropped', { item: mlItem, source: 'mob', floorNum: floorNum, lost: true, reason: mlAddResult.error });
                    } else {
                      mobLootSock.emit('loot_dropped', { item: mlItem, source: 'mob', floorNum: floorNum });
                      mobLootSock.emit('grid_item_added', { item: mlItem, rev: (mlAddResult && mlAddResult._gridRev) || 0 });
                    }
                  }
                }
              }
            }
          } catch (mobLootErr) {
            console.error('[dungeon_mob_loot] Error:', mobLootErr.message);
          }
        }
      }

      // Skinning: dungeon beast-type kills (check enemy name for beast patterns)
      var _dungeonBeastPattern = /wolf|bear|boar|spider|lizard|bat|crab|scorpion|viper|raptor|toad|beetle|hound|drake|serpent|worm|ape|bird|insect|crawler|shark|fish|eel|jelly|wasp|vulture|rat|troll|pup/i;
      if (enemy.name && _dungeonBeastPattern.test(enemy.name)) {
        accounts.addSkillXp(accKey, 'skinning', 10 + Math.floor(Math.random() * 11));
      }

      // Kill stats
      if (killAcc) {
        var killDp = ensureDungeonProgress(killAcc);
        killDp.totalKills = (killDp.totalKills || 0) + 1;
        if (enemy.isBoss) {
          killDp.bossesKilled = (killDp.bossesKilled || 0) + 1;
          accounts.addPendingPack(accKey, 1);
          if (killSkillBonuses && killSkillBonuses.bossExtraResource > 0) {
            accounts.addResource(accKey, 'boss_trophy', killSkillBonuses.bossExtraResource);
          }
          // Mark cave/world dungeon as cleared for today (date-aware)
          var killInfo = playerDungeons.get(socketId);
          if (killInfo && killInfo.dungeonId !== 'rift') {
            if (!killDp.clearedCaves) killDp.clearedCaves = {};
            killDp.clearedCaves[killInfo.dungeonId] = getTodayString();
          }
          // Mark overworld structure as cleared on boss kill
          if (killInfo && killInfo.dungeonId.indexOf('camp_') === 0) {
            var bossKillStructId = killInfo.structureId || killInfo.dungeonId.slice(5);
            overworldStructures.markCleared(bossKillStructId);
            var bossKillStruct = overworldStructures.getStructure(bossKillStructId);
            if (bossKillStruct) {
              io.emit('structure_cleared', {
                structureId: bossKillStructId,
                name: bossKillStruct.name,
                clearedBy: (killAcc ? killAcc.username : 'Unknown'),
                worldX: bossKillStruct.worldX,
                worldY: bossKillStruct.worldY,
              });
            }
          }
          // Lich corruption cleanse on lich dungeon boss kill
          if (killInfo && deps.directorLich) {
            var cleanseResult = deps.directorLich.cleanseCorruption(killInfo.dungeonId);
            if (cleanseResult && cleanseResult.cleansed > 0) {
              io.emit('world_event', {
                title: 'Corruption Recedes!',
                description: 'The defeat of the lich boss weakens the corruption near ' + (cleanseResult.sourceName || 'the sanctum') + '!',
                type: 'lich_cleanse',
              });
            }
          }
          // Mini-rift boss kill: destroy rift + award rewards + cleanse corruption
          if (killInfo && killInfo.dungeonId.indexOf('minirift_') === 0) {
            var mrKillRiftId = killInfo.riftId || killInfo.dungeonId.slice(9);
            var mrKillRift = overworldRifts.getRift(mrKillRiftId);
            if (mrKillRift && killInfo.floorNum === mrKillRift.totalFloors) {
              // This is the final floor boss — seal the rift
              overworldRifts.destroyRift(mrKillRiftId, (killAcc ? killAcc.username : 'Unknown'));

              var mrRewards = dungeonData.getMiniRiftBossRewards(mrKillRift.tier);

              // Award rewards
              accounts.updateChips(accKey, mrRewards.gold);
              accounts.addResource(accKey, 'dark_crystal', mrRewards.darkCrystal);
              accounts.addResource(accKey, 'purification_crystal', mrRewards.purificationCrystal);
              accounts.addPendingPack(accKey, mrRewards.cardPacks);
              accounts.addSkillXp(accKey, 'dungeon_delving', mrRewards.xpBonus);

              // Broadcast world event
              io.emit('world_event', {
                title: 'A Rift Sealed!',
                description: (killAcc ? killAcc.username : 'Unknown') + ' has sealed ' + mrKillRift.name + '! The Soldier\'s desperate reach weakens as reality knits itself together. Corruption recedes from the land.',
                type: 'rift_sealed',
              });

              // Cleanse corruption around rift location
              if (deps.directorLich && typeof deps.directorLich.cleanseRiftCorruption === 'function') {
                deps.directorLich.cleanseRiftCorruption(mrKillRift.chunkX, mrKillRift.chunkY, mrKillRift.corruptionRadius);
              }

              // Notify clearing player of rewards
              var sealSocket = io.sockets.sockets.get(socketId);
              if (sealSocket) sealSocket.emit('rift_sealed_rewards', {
                riftId: mrKillRiftId,
                name: mrKillRift.name,
                tier: mrKillRift.tier,
                gold: mrRewards.gold,
                darkCrystal: mrRewards.darkCrystal,
                purificationCrystal: mrRewards.purificationCrystal,
                cardPacks: mrRewards.cardPacks,
                xpBonus: mrRewards.xpBonus,
              });

              // Broadcast destruction to all clients
              io.emit('rift_destroyed', {
                riftId: mrKillRiftId,
                name: mrKillRift.name,
                worldX: mrKillRift.worldX,
                worldY: mrKillRift.worldY,
                clearedBy: (killAcc ? killAcc.username : 'Unknown'),
                reason: 'sealed',
              });

            }
          }
          // --- PROCEDURAL LOOT DROPS on boss kill ---
          try {
            var bossLootSpecs = lootGen.rollDungeonLoot(floorNum, true, false);
            if (bossLootSpecs && bossLootSpecs.length > 0) {
              // Determine possible base types for this floor
              var bossLootTypes = getFloorLootPool(floorNum);
              for (var bli = 0; bli < bossLootSpecs.length; bli++) {
                var blSpec = bossLootSpecs[bli];

                // Container drop
                if (blSpec.container) {
                  var containerItem = lootGen.generateContainerItem({ depth: floorNum, source: 'boss' });
                  if (containerItem) {
                    var cAddRes = accounts.addMMOItem(accKey, containerItem);
                    var cSock = io.sockets.sockets.get(socketId);
                    if (cSock) {
                      var cLost = !!(cAddRes && cAddRes.error);
                      cSock.emit('loot_dropped', { item: containerItem, source: 'boss', floorNum: floorNum, lost: cLost });
                      if (!cLost) cSock.emit('grid_item_added', { item: containerItem, rev: (cAddRes && cAddRes._gridRev) || 0 });
                    }
                  }
                  continue;
                }

                var blBaseType = bossLootTypes[Math.floor(Math.random() * bossLootTypes.length)];
                var blBaseDef = accounts.WEAPON_TYPES[blBaseType];
                if (!blBaseDef) continue;
                var blItem = lootGen.generateItem(blBaseType, blBaseDef, {
                  source: 'boss',
                  depth: floorNum,
                  forcedRarity: blSpec.rarity,
                  luckBonus: accounts.getPlayerLuck(accKey),
                });
                if (blItem) {
                  blItem.maxDurability = accounts.getMaxDurability(blBaseType);
                  blItem.durability = blItem.maxDurability;
                  var blAddRes = accounts.addMMOItem(accKey, blItem);
                  var bossLootSock = io.sockets.sockets.get(socketId);
                  if (bossLootSock) {
                    var blLost = !!(blAddRes && blAddRes.error);
                    bossLootSock.emit('loot_dropped', { item: blItem, source: 'boss', floorNum: floorNum, lost: blLost });
                    if (!blLost) bossLootSock.emit('grid_item_added', { item: blItem, rev: (blAddRes && blAddRes._gridRev) || 0 });
                  }
                }
              }
            }
          } catch (bossLootErr) {
            console.error('[dungeon_boss_loot] Error:', bossLootErr.message);
          }

          // Book drop roll on boss kill (35% chance, theme-filtered)
          try {
            var bossBookId = loreBooks.rollBookDrop('legendary', floorNum, floorTheme, true);
            if (bossBookId) {
              var bossBookResult = knowledgeHandler.discoverBook(accounts, accKey, bossBookId);
              if (bossBookResult) {
                var bossBookSocket = io.sockets.sockets.get(socketId);
                if (bossBookSocket) {
                  bossBookSocket.emit('knowledge_book_discovered', {
                    bookId: bossBookResult.book.id, title: bossBookResult.book.title,
                    rarity: bossBookResult.book.rarity, source: 'boss_kill',
                  });
                  for (var bti = 0; bti < bossBookResult.unlockedTerms.length; bti++) {
                    bossBookSocket.emit('knowledge_term_unlocked', bossBookResult.unlockedTerms[bti]);
                  }
                }
              }
            }
          } catch (bookErr) {
            console.error('[dungeon_boss_kill] Book drop error:', bookErr.message);
          }

          // Award rift_wardens faction rep for boss kills
          factions.addRep(killAcc, 'rift_wardens', 150);
        }
      }

      // Quest progress: track kills and boss kills, include floor object for clear_floor check
      var killFloor = getFloorForPlayer(socketId);
      var killQuestResult = updateQuestProgress(accounts, accKey, 'kill', { floorNum: floorNum, floor: killFloor });
      if (enemy.isBoss) {
        var bossQuestResult = updateQuestProgress(accounts, accKey, 'boss_kill', { floorNum: floorNum });
        // Merge: if boss_kill produced changes, fold into killQuestResult
        if (bossQuestResult.changed) {
          killQuestResult.changed = true;
          if (bossQuestResult.completedQuests) {
            killQuestResult.completedQuests = (killQuestResult.completedQuests || []).concat(bossQuestResult.completedQuests);
          }
        }
      }
      // Emit quest update to the player who got the kill
      var killSocket = io.sockets.sockets.get(socketId);
      if (killSocket) {
        emitQuestUpdate(killSocket, accounts, accKey, killQuestResult);
      }

      // --- World quest: bossKill and caveComplete tracking ---
      if (enemy.isBoss && accKey) {
        try {
          var wqBossAcc = accounts.loadAccount(accKey);
          if (wqBossAcc && wqBossAcc.questProgress && wqBossAcc.questProgress.active) {
            var _wqBossRpg = require('../rpg-data');
            var wqBossChanged = false;
            var bossKillInfo = playerDungeons.get(socketId);
            var isCaveDungeon = bossKillInfo && bossKillInfo.dungeonId !== 'rift' && !bossKillInfo.isLichRaid;
            for (var wqbi = 0; wqbi < wqBossAcc.questProgress.active.length; wqbi++) {
              var wqb = wqBossAcc.questProgress.active[wqbi];
              var wqbTmpl = _wqBossRpg.WORLD_QUEST_TEMPLATES && _wqBossRpg.WORLD_QUEST_TEMPLATES.find(function(t) { return t.questId === wqb.questId; });
              if (!wqbTmpl || wqbTmpl.type !== 'dungeon') continue;
              if (wqbTmpl.target.bossKill && wqb.progress < wqb.targetCount) {
                wqb.progress = Math.min(wqb.progress + 1, wqb.targetCount);
                wqBossChanged = true;
                if (killSocket) killSocket.emit('quest_progress', { questId: wqb.questId, progress: wqb.progress, targetCount: wqb.targetCount, complete: wqb.progress >= wqb.targetCount });
              }
              if (wqbTmpl.target.caveComplete && isCaveDungeon && wqb.progress < wqb.targetCount) {
                wqb.progress = Math.min(wqb.progress + 1, wqb.targetCount);
                wqBossChanged = true;
                if (killSocket) killSocket.emit('quest_progress', { questId: wqb.questId, progress: wqb.progress, targetCount: wqb.targetCount, complete: wqb.progress >= wqb.targetCount });
              }
            }
            if (wqBossChanged) accounts.saveAccount(wqBossAcc);
          }
        } catch (wqBossErr) { /* non-fatal */ }
      }

      // --- Track daily challenge & achievement progress for dungeon kills ---
      challengesHandler.trackChallengeProgress(accounts, accKey, 'monster_kill', 1);
      challengesHandler.trackAchievementProgress(accounts, accKey, 'monster_kill', 1, killSocket);
      if (enemy.isBoss) {
        challengesHandler.trackChallengeProgress(accounts, accKey, 'boss_kill', 1);
        challengesHandler.trackAchievementProgress(accounts, accKey, 'boss_kill', 1, killSocket);
      }

      // Loot drops (apply server dropRate as extra rolls)
      var lootDrops = rollEnemyLoot(enemy, floorNum, floorTheme);
      // Server drop rate: duplicate drops proportionally (e.g., 2x = double loot amounts)
      if (serverDropRate > 1 && lootDrops.length > 0) {
        for (var dri = 0; dri < lootDrops.length; dri++) {
          lootDrops[dri].amount = Math.ceil((lootDrops[dri].amount || 1) * serverDropRate);
        }
      }
      if (killSkillBonuses && killSkillBonuses.lootBonusChance > 0 && lootDrops.length > 0) {
        if (Math.random() < killSkillBonuses.lootBonusChance) {
          var bonusIdx = Math.floor(Math.random() * lootDrops.length);
          var bonusDrop = lootDrops[bonusIdx];
          if (bonusDrop && bonusDrop.resource) {
            lootDrops.push({ resource: bonusDrop.resource, amount: 1 });
          }
        }
      }
      // Card: boss_loot_bonus — extra loot rolls on boss kills
      var cardBossLootBonus = (combat && combat.bossLootBonus) ? combat.bossLootBonus : 0;
      if (enemy.isBoss && cardBossLootBonus > 0 && lootDrops.length > 0) {
        // Each boss_loot_bonus point is a % chance for an extra copy of a random drop
        // e.g. 0.25 = 25% chance per roll; multiple rolls for higher values
        var bossLootRolls = Math.floor(cardBossLootBonus);
        var bossLootFrac = cardBossLootBonus - bossLootRolls;
        if (bossLootFrac > 0 && Math.random() < bossLootFrac) bossLootRolls++;
        // Minimum 1 roll if we have any bonus
        if (bossLootRolls < 1 && cardBossLootBonus > 0) bossLootRolls = Math.random() < cardBossLootBonus ? 1 : 0;
        for (var blri = 0; blri < bossLootRolls; blri++) {
          var blIdx = Math.floor(Math.random() * lootDrops.length);
          var blDrop = lootDrops[blIdx];
          if (blDrop && blDrop.resource) {
            lootDrops.push({ resource: blDrop.resource, amount: 1 });
          }
        }
      }
      if (lootDrops.length > 0) {
        for (var li = 0; li < lootDrops.length; li++) {
          accounts.addResource(accKey, lootDrops[li].resource, lootDrops[li].amount);
        }
      }

      // --- Durability loss: weapon 0.5% per kill, armor 1% per kill ---
      if (killAcc && killAcc.equipment) {
        try {
          var durCardEffects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(accKey) : [];
          var durWarnings = [];
          var wepDurResults = accounts.reduceWeaponDurability(killAcc, 0.005, durCardEffects);
          if (wepDurResults) { for (var wdi = 0; wdi < wepDurResults.length; wdi++) durWarnings.push(wepDurResults[wdi]); }
          var armorDurResults = accounts.reduceArmorDurability(killAcc, 0.01, durCardEffects);
          for (var adi = 0; adi < armorDurResults.length; adi++) durWarnings.push(armorDurResults[adi]);
          var durSocket = io.sockets.sockets.get(socketId);
          if (durSocket) {
            for (var dwi = 0; dwi < durWarnings.length; dwi++) {
              if (durWarnings[dwi].broken) {
                durSocket.emit('item_broken', { slot: durWarnings[dwi].slot, itemName: durWarnings[dwi].itemName });
              } else if (durWarnings[dwi].lowDurability) {
                durSocket.emit('durability_warning', { slot: durWarnings[dwi].slot, itemName: durWarnings[dwi].itemName, durability: durWarnings[dwi].durability, maxDurability: durWarnings[dwi].maxDurability });
              }
            }
          }
        } catch (durCombatErr) {
          console.error('[dungeon_combat] Durability error:', durCombatErr.message);
        }
      }

      if (killAcc) safeSaveAccount(accounts, killAcc, 'awardKillRewards');
      return { xp: finalXp, gold: goldGained, loot: lootDrops, xpResult: xpResult };
    },
    broadcastToFloor: function(event, data) {
      var zoneId = getZoneIdForDungeon(dungeonId, floorNum);
      io.to('zone:' + zoneId).emit(event, data);
    },
    emitToPlayer: function(socketId, event, data) {
      var targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) targetSocket.emit(event, data);
    },
    // A5: In-combat consumable use — validate, deduct item, return effect data
    consumeItem: function(socketId, resourceType) {
      var accKey = socketAccountMap.get(socketId);
      if (!accKey) return { error: 'No account' };
      var foodEffect = rpgData.FOOD_EFFECTS[resourceType];
      if (!foodEffect) return { error: 'That item cannot be consumed' };
      var mmoInv = accounts.getMMOInventory(accKey);
      if (!mmoInv || (mmoInv[resourceType] || 0) < 1) {
        return { error: 'You do not have any ' + resourceType.replace(/_/g, ' ') };
      }
      var removeResult = accounts.removeResource(accKey, resourceType, 1);
      if (removeResult === null) return { error: 'Failed to consume item' };
      // Calculate HP restored (apply cooking perks + card effects)
      var foodAccount = accounts.loadAccount(accKey);
      var foodBonuses = foodAccount ? rpgData.getCraftingSkillBonuses(foodAccount) : null;
      var hpRestored = foodEffect.hpRestore || 0;
      if (foodBonuses && foodBonuses.foodHealMult > 1.0) {
        hpRestored = Math.round(hpRestored * foodBonuses.foodHealMult);
      }
      var buff = null;
      if (foodEffect.buff) {
        buff = { stat: foodEffect.buff.stat, value: foodEffect.buff.value, duration: foodEffect.buff.duration };
        if (foodBonuses && foodBonuses.buffDurationMult > 1.0) {
          buff.duration = Math.round(buff.duration * foodBonuses.buffDurationMult);
        }
      }
      return { success: true, hpRestored: hpRestored, buff: buff, resourceType: resourceType };
    },
    addSkillXp: function(socketId, skillName, amount) {
      var accKey = socketAccountMap.get(socketId);
      if (!accKey || !amount) return;
      accounts.addSkillXp(accKey, skillName, amount);
    },
  };
}

// Initiate turn-based combat from a player attacking an enemy
function initiateTurnCombat(socket, io, state, accounts, socketAccountMap, user, floor, info, enemy, enemyIndex, surpriseFor) {
  var accKey = socketAccountMap.get(socket.id);
  if (!accKey) return;
  var acc = accounts.loadAccount(accKey);
  if (!acc) return;

  var pos = state.playerPositions.get(socket.id);
  if (!pos) return;
  var ptx = Math.floor(pos.x / 32);
  var pty = Math.floor(pos.y / 32);

  var zoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
  var pMap = floorPlayers.get(zoneId);

  // Find nearby enemies (8-tile radius)
  var nearbyEnemies = findNearbyEnemies(floor, ptx, pty, 8);
  // Make sure the targeted enemy is included
  var hasTargetEnemy = false;
  for (var i = 0; i < nearbyEnemies.length; i++) {
    if (nearbyEnemies[i] === enemy) { hasTargetEnemy = true; break; }
  }
  if (!hasTargetEnemy) nearbyEnemies.push(enemy);

  // Apply theme element to enemies that don't already have one (Fix 2)
  var floorTheme = floor ? floor.theme : null;
  var themeElement = (floorTheme && THEME_ELEMENT_MAP) ? (THEME_ELEMENT_MAP[floorTheme] || null) : null;
  if (themeElement) {
    for (var tei = 0; tei < nearbyEnemies.length; tei++) {
      if (!nearbyEnemies[tei].element) {
        nearbyEnemies[tei].element = themeElement;
      }
    }
  }

  // Build player list (this player + nearby party/players within 10 tiles)
  var nearbyPlayerInfos = findNearbyPlayers(zoneId, ptx, pty, 10);
  var combat = getPlayerCombat(socket.id);
  if (!combat) {
    combat = initPlayerCombatState(socket.id, accounts, accKey);
  }
  // Purge expired shrine buffs before combat starts
  purgeExpiredBuffs(combat);

  // Use resolved cards (built during initPlayerCombatState) for the combat system
  var playerInfo = playerDungeons.get(socket.id);
  var myResolvedCards = (playerInfo && playerInfo.resolvedCards) ? playerInfo.resolvedCards : resolveEquippedCards(acc);

  // Compute darkness/vision state for combat penalty injection
  var floorAmbientLight = dungeonVision.getAmbientLight(floor.theme, floor.floorNum);
  var floorIsDark = dungeonVision.isDarkFloor(floor.theme, floor.floorNum);

  // Look up this player's vision type from floor tracking
  var myFpEntry = pMap ? pMap.get(socket.id) : null;
  var myVisionType = (myFpEntry && myFpEntry.visionType) ? myFpEntry.visionType : 'normal';
  var myHasTorch = myFpEntry ? myFpEntry.hasTorch : false;
  var myHasLantern = myFpEntry ? myFpEntry.hasLantern : false;

  var players = [{
    socketId: socket.id,
    x: ptx,
    y: pty,
    name: user.name || acc.username || 'Player',
    race: acc.race,
    rpgStats: acc.rpgStats || rpgData.getDefaultStats(),
    level: acc.level || 1,
    equippedCards: myResolvedCards,
    combat: combat,
    // Darkness/vision data for combat penalty system
    visionType: myVisionType,
    _ambientLight: floorAmbientLight,
    _isDarkFloor: floorIsDark,
    _hasTorch: myHasTorch,
    _hasLantern: myHasLantern,
  }];

  // Add other nearby players
  for (var pi = 0; pi < nearbyPlayerInfos.length; pi++) {
    var np = nearbyPlayerInfos[pi];
    if (np.socketId === socket.id) continue;
    var npAccKey = socketAccountMap.get(np.socketId);
    if (!npAccKey) continue;
    var npAcc = accounts.loadAccount(npAccKey);
    if (!npAcc) continue;
    var npCombat = getPlayerCombat(np.socketId);
    if (!npCombat) {
      npCombat = initPlayerCombatState(np.socketId, accounts, npAccKey);
    }
    var npInfo = playerDungeons.get(np.socketId);
    var npResolvedCards = (npInfo && npInfo.resolvedCards) ? npInfo.resolvedCards : resolveEquippedCards(npAcc);
    // Look up vision/torch for this nearby player
    var npFpEntry = pMap ? pMap.get(np.socketId) : null;
    var npVisionType = (npFpEntry && npFpEntry.visionType) ? npFpEntry.visionType : 'normal';
    var npHasTorch = npFpEntry ? npFpEntry.hasTorch : false;
    var npHasLantern = npFpEntry ? npFpEntry.hasLantern : false;
    players.push({
      socketId: np.socketId,
      x: np.x,
      y: np.y,
      name: np.name,
      race: npAcc.race,
      rpgStats: npAcc.rpgStats || rpgData.getDefaultStats(),
      level: npAcc.level || 1,
      equippedCards: npResolvedCards,
      combat: npCombat,
      // Darkness/vision data for combat penalty system
      visionType: npVisionType,
      _ambientLight: floorAmbientLight,
      _isDarkFloor: floorIsDark,
      _hasTorch: npHasTorch,
      _hasLantern: npHasLantern,
    });
  }

  var callbacks = buildCombatCallbacks(io, state, accounts, socketAccountMap, info.dungeonId, info.floorNum);

  // Determine surprise round: explicit surpriseFor param, or invisible enemy fallback
  var surprisePayload = null;
  if (surpriseFor === 'enemy') {
    surprisePayload = { isSurprise: true, side: 'enemy' };
  } else if (surpriseFor === 'player') {
    surprisePayload = { isSurprise: true, side: 'player' };
  }
  // Invisible enemy surprise as additional trigger
  if (!surprisePayload && enemy.invisibility && !enemy._invisBroken) {
    var currentTurn = (floor._currentTurn || 0);
    var canSee = dungeonVision.canPlayerSeeEnemy(enemy, myVisionType, currentTurn);
    if (!canSee) {
      surprisePayload = { isSurprise: true, side: 'enemy' };
    }
  }

  // After combat starts, break invisibility on all combatant enemies (they reveal themselves)
  for (var invI = 0; invI < nearbyEnemies.length; invI++) {
    if (nearbyEnemies[invI].invisibility) {
      dungeonVision.breakEnemyInvisibility(nearbyEnemies[invI]);
    }
  }

  if (surprisePayload) {
    callbacks.surpriseData = surprisePayload;
  }

  // Mark all participating players as inTurnCombat
  for (var pi2 = 0; pi2 < players.length; pi2++) {
    if (pMap) {
      var fp = pMap.get(players[pi2].socketId);
      if (fp) fp.inTurnCombat = true;
    }
  }

  // Mark all participating enemies as inTurnCombat
  for (var nei = 0; nei < nearbyEnemies.length; nei++) {
    nearbyEnemies[nei].inTurnCombat = true;
  }

  // Clear inTurnCombat on combat end for all participants (players + enemies)
  var _combatPlayerSockets = players.map(function(p) { return p.socketId; });
  var _combatEnemies = nearbyEnemies;
  var _combatZoneId = zoneId;
  var origOnCombatEnd = callbacks.onCombatEnd;
  callbacks.onCombatEnd = function(combatOrResult, resultOrUndef) {
    var fpMap = floorPlayers.get(_combatZoneId);
    if (fpMap) {
      for (var ci = 0; ci < _combatPlayerSockets.length; ci++) {
        var cfp = fpMap.get(_combatPlayerSockets[ci]);
        if (cfp) cfp.inTurnCombat = false;
      }
    }
    for (var cei = 0; cei < _combatEnemies.length; cei++) {
      _combatEnemies[cei].inTurnCombat = false;
    }
    if (origOnCombatEnd) origOnCombatEnd(combatOrResult, resultOrUndef);

    // Resume BG3-style turn mode if any participant was in turn-based mode
    var resumeTms = turnModeState.get(_combatZoneId);
    if (resumeTms && resumeTms.paused) {
      resumeTms.paused = false;
      // Remove dead enemies from turn mode tracking
      resumeTms.units.forEach(function(u, uid) {
        if (u.type === 'enemy') {
          var floor = floorRefs.get(_combatZoneId);
          if (floor && floor.enemies[u.enemyIdx] && floor.enemies[u.enemyIdx].alive === false) {
            u.alive = false;
          }
        }
      });
      advanceTurnMode(_combatZoneId);
    }
  };

  // Start combat
  var combatId = dungeonCombat.initCombat(
    info.dungeonId, players, nearbyEnemies, floor, callbacks
  );

  return combatId;
}

function handlePlayerDeath(socket, io, state, accounts, accKey, info, causeOfDeath) {
  // Check for permadeath — enter downed state instead of instant death
  if (accKey) {
    var pdAcc = accounts.loadAccount(accKey);
    if (pdAcc && pdAcc.permadeath) {
      enterDownedState(socket, io, state, accounts, accKey, info, causeOfDeath || 'Slain in combat');
      return;
    }
  }

  // Normal (non-permadeath) death flow
  handleNormalDeath(socket, io, state, accounts, accKey, info);
}

function handleNormalDeath(socket, io, state, accounts, accKey, info) {
  // Clean up turn-based mode before removing from floor
  var deathZoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
  cleanupTurnMode(socket.id, deathZoneId);

  // Remove from AI floor tracking
  removePlayerFromFloor(socket.id);
  // Clear dungeon tracking immediately to prevent stale combat state queries
  playerDungeons.delete(socket.id);

  var currentZone = state.playerZones.get(socket.id);

  // Leave dungeon zone
  if (currentZone) {
    socket.leave('zone:' + currentZone);
    io.to('zone:' + currentZone).emit('player_left_zone', {
      playerId: socket.id,
      playerName: state.users.get(socket.id) ? state.users.get(socket.id).name : 'Unknown',
      zoneId: currentZone,
    });
    state.leaveZone(socket.id);
  }

  // Update death stats
  if (accKey) {
    var acc = accounts.loadAccount(accKey);
    if (acc) {
      var dp = ensureDungeonProgress(acc);
      dp.totalDeaths = (dp.totalDeaths || 0) + 1;
      // Clear active cave on death
      dp.activeCave = null;
      dp.activeCaveFloor = 0;
      safeSaveAccount(accounts, acc, 'dungeon_enter_clear_cave');
    }
  }

  // Return to starter town
  var destZone = 'starter_town';
  var destX = 800;
  var destY = 400;

  var destZoneObj = state.zones.get(destZone);
  if (destZoneObj) {
    state.joinZone(socket.id, destZone, destX, destY);
    socket.join('zone:' + destZone);

    if (accKey) {
      accounts.setLastLocation(accKey, destZone, destX, destY);
    }

    socket.emit('dungeon_player_died', {
      message: 'You have fallen in the dungeon!',
      returnZone: destZone,
    });
    socket.emit('zone_state', state.getZoneState(destZone));
  }
}

// ---------------------------------------------------------------------------
// Permadeath: downed state + bleedout timer
// ---------------------------------------------------------------------------

function enterDownedState(socket, io, state, accounts, accKey, info, causeOfDeath) {
  var socketId = socket.id;
  var zoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);

  // Clean up turn-based mode when player is downed
  cleanupTurnMode(socketId, zoneId);
  var pMap = floorPlayers.get(zoneId);
  var playerData = pMap ? pMap.get(socketId) : null;
  var playerX = playerData ? playerData.x : 0;
  var playerY = playerData ? playerData.y : 0;
  var playerName = state.users.get(socketId) ? state.users.get(socketId).name : 'Unknown';

  // Mark player as downed (they stay on the floor but can't act)
  if (playerData) {
    playerData.isDowned = true;
    playerData.inCombat = false;
    playerData.inTurnCombat = false;
  }

  var downedInfo = {
    accKey: accKey,
    zoneId: zoneId,
    x: playerX,
    y: playerY,
    timer: BLEEDOUT_DURATION,
    dungeonId: info.dungeonId,
    floorNum: info.floorNum,
    causeOfDeath: causeOfDeath,
    intervalId: null,
  };

  // Start bleedout countdown (1s tick)
  downedInfo.intervalId = setInterval(function() {
    var entry = downedPlayers.get(socketId);
    if (!entry) return;
    entry.timer--;

    if (entry.timer <= 0) {
      // Time's up — trigger actual permadeath
      clearInterval(entry.intervalId);
      downedPlayers.delete(socketId);
      triggerPermadeath(socketId, io, state, accounts, accKey, info, causeOfDeath);
    }
  }, 1000);
  if (downedInfo.intervalId && downedInfo.intervalId.unref) downedInfo.intervalId.unref();

  downedPlayers.set(socketId, downedInfo);

  // Notify the downed player
  socket.emit('player_downed', {
    timeRemaining: BLEEDOUT_DURATION,
    causeOfDeath: causeOfDeath,
  });

  // Notify all other players on the same floor
  io.to('zone:' + zoneId).emit('player_downed_notification', {
    playerId: socketId,
    playerName: playerName,
    x: playerX,
    y: playerY,
  });
}

function reviveDownedPlayer(reviverSocket, targetSocketId, io, state, accounts) {
  var downedInfo = downedPlayers.get(targetSocketId);
  if (!downedInfo) return { error: 'Player is not downed' };

  var reviverZoneId = null;
  // Find reviver's floor
  var reviverInfo = playerDungeons.get(reviverSocket.id);
  if (reviverInfo) {
    reviverZoneId = getZoneIdForDungeon(reviverInfo.dungeonId, reviverInfo.floorNum);
  }

  // Validate: same floor
  if (reviverZoneId !== downedInfo.zoneId) {
    return { error: 'Not on the same floor' };
  }

  // Validate: reviver is not in combat
  var pMap = floorPlayers.get(downedInfo.zoneId);
  var reviverData = pMap ? pMap.get(reviverSocket.id) : null;
  if (reviverData && (reviverData.inCombat || reviverData.inTurnCombat)) {
    return { error: 'Cannot revive while in combat' };
  }

  // Validate: adjacent (within REVIVE_DISTANCE Manhattan distance)
  if (reviverData) {
    var dist = Math.abs(reviverData.x - downedInfo.x) + Math.abs(reviverData.y - downedInfo.y);
    if (dist > REVIVE_DISTANCE) {
      return { error: 'Too far away to revive' };
    }
  }

  // Validate: target exists on floor
  var targetData = pMap ? pMap.get(targetSocketId) : null;
  if (!targetData || !targetData.isDowned) {
    return { error: 'Target is not downed' };
  }

  // Revive: cancel timer, restore HP to 25%
  clearInterval(downedInfo.intervalId);
  downedPlayers.delete(targetSocketId);

  targetData.isDowned = false;

  // Restore combat HP to 25%
  var combat = getPlayerCombat(targetSocketId);
  if (combat) {
    combat.hp = Math.max(1, Math.floor(combat.maxHp * 0.25));
  }

  var reviverName = state.users.get(reviverSocket.id) ? state.users.get(reviverSocket.id).name : 'Unknown';
  var targetName = state.users.get(targetSocketId) ? state.users.get(targetSocketId).name : 'Unknown';

  // Notify everyone on the floor
  io.to('zone:' + downedInfo.zoneId).emit('player_revived', {
    playerId: targetSocketId,
    playerName: targetName,
    reviverName: reviverName,
    playerHp: combat ? combat.hp : null,
    playerMaxHp: combat ? combat.maxHp : null,
  });

  return { success: true };
}

function triggerPermadeath(socketId, io, state, accounts, accKey, info, causeOfDeath) {
  var acc = accounts.loadAccount(accKey);
  if (!acc) return;

  // Non-permadeath characters never get permanently deleted — just revive at town
  if (!acc.permadeath) {
    accounts.setLastLocation(accKey, 'starter_town', 800, 400);
    if (acc.rpgStats) {
      acc.rpgStats.hp = Math.max(1, Math.floor((acc.rpgStats.maxHp || 100) * 0.25));
      accounts.saveAccount(acc);
    }
    var reviveSocket = io.sockets.sockets.get(socketId);
    if (reviveSocket) {
      reviveSocket.emit('death_respawn', {
        message: (causeOfDeath || 'You have been defeated.') + ' You wake up in town.',
        zoneId: 'starter_town',
      });
    }
    return;
  }

  var playerName = state.users.get(socketId) ? state.users.get(socketId).name : 'Unknown';

  // Build hero snapshot before deletion
  var dp = ensureDungeonProgress(acc);
  var heroSnapshot = {
    name: acc._characterName || playerName,
    race: acc.race || null,
    level: acc.level || 1,
    rpgStats: acc.rpgStats || null,
    equipment: acc.equipment || null,
    skills: acc.skills || null,
    rpgCards: (acc.rpgCards || []).slice(0, 20),
    equippedCards: acc.equippedCards || [],
    dungeonProgress: {
      deepestFloor: dp.deepestFloor || 0,
      totalKills: dp.totalKills || 0,
      bossesKilled: dp.bossesKilled || 0,
      guildRank: dp.guildRank || 'stone',
    },
    causeOfDeath: causeOfDeath,
    dungeonId: info.dungeonId,
    floorNum: info.floorNum,
    diedAt: Date.now(),
    createdAt: acc._characterCreatedAt || acc.createdAt,
    playtimeSeconds: 0, // placeholder — would need separate tracking
    chips: acc.chips || 0,
  };

  // Preserve pocket contents before character deletion
  accounts.preservePocketOnPermadeath(acc);
  accounts.saveAccount(acc);

  // Archive to Hall of Heroes
  accounts.archiveToHallOfHeroes(accKey, heroSnapshot);

  // Remove from AI floor tracking and dungeon state
  removePlayerFromFloor(socketId);
  playerDungeons.delete(socketId);

  var currentZone = state.playerZones.get(socketId);
  var targetSocket = io.sockets.sockets.get(socketId);

  // Leave dungeon zone
  if (currentZone && targetSocket) {
    targetSocket.leave('zone:' + currentZone);
    io.to('zone:' + currentZone).emit('player_left_zone', {
      playerId: socketId,
      playerName: playerName,
      zoneId: currentZone,
    });
    state.leaveZone(socketId);
  }

  // Delete the active character
  var deleteResult = accounts.deleteActiveCharacterForPermadeath(accKey);

  // Notify the dead player
  if (targetSocket) {
    targetSocket.emit('permadeath_triggered', {
      hero: heroSnapshot,
      hasCharactersLeft: deleteResult.hasCharactersLeft || false,
    });
  }
}

// ---------------------------------------------------------------------------
// Camp ambush interval (runs every 60s)
// ---------------------------------------------------------------------------

var ambushInterval = setInterval(function() {
  riftFloors.forEach(function(floor, floorNum) {
    if (!floor.camps || floor.camps.length === 0) return;
    var zoneId = getZoneIdForDungeon('rift', floorNum);
    // We cannot easily check zone occupancy without state reference here,
    // but we roll anyway — the event is only emitted if there's a zone with
    // members (checked at emit time by the io reference).
    for (var ci = 0; ci < floor.camps.length; ci++) {
      if (Math.random() < CAMP_CONFIG.ambushChance) {
        var camp = floor.camps[ci];
        var ambushCount = 1 + Math.floor(Math.random() * 3);
        var ambushEnemies = [];
        for (var ae = 0; ae < ambushCount; ae++) {
          ambushEnemies.push({
            id: 'ambush_' + Date.now() + '_' + ae,
            name: 'Camp Raider',
            hp: Math.floor(30 * (1 + floorNum * 0.12)),
            atk: Math.floor(8 * (1 + floorNum * 0.08)),
            def: Math.floor(4 * (1 + floorNum * 0.05)),
            xp: Math.floor(12 * (1 + floorNum * 0.20)),
            gold: Math.floor(5 * (1 + floorNum * 0.15)),
            x: camp.x + (ae % 2 === 0 ? 1 : -1),
            y: camp.y + (ae < 2 ? 1 : -1),
            alive: true,
          });
        }
        // Add ambush enemies to floor with AI state
        for (var j = 0; j < ambushEnemies.length; j++) {
          dungeonAI.initEnemyAI(ambushEnemies[j], 'skirmisher');
          ambushEnemies[j].aiState = 'alert'; // ambush enemies start alert
          floor.enemies.push(ambushEnemies[j]);
          indexNewEnemy(floor, ambushEnemies[j]);
        }
        // Store zone id + data for external emit (done by the io ref in init)
        if (!floor._pendingAmbushes) floor._pendingAmbushes = [];
        floor._pendingAmbushes.push({
          zoneId: zoneId,
          campX: camp.x,
          campY: camp.y,
          enemies: ambushEnemies,
        });
      }
    }
  });
}, 60000);

// Prevent the interval from keeping the process alive if the server shuts down
if (ambushInterval && ambushInterval.unref) ambushInterval.unref();

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// Called from disconnect handler to clean up dungeon state for a disconnected socket
function cleanupDisconnectedPlayer(socketId) {
  var info = playerDungeons.get(socketId);
  if (!info) return;

  // Clean up turn-based combat
  var combat = dungeonCombat.getCombatBySocketId(socketId);
  if (combat) {
    dungeonCombat.handlePlayerDisconnect(combat.id, socketId);
  }

  // Remove from floor tracking (stops AI tick if floor empty)
  removePlayerFromFloor(socketId);
  playerDungeons.delete(socketId);
}

module.exports = {
  getPlayerCombat: getPlayerCombat,
  cleanupDisconnectedPlayer: cleanupDisconnectedPlayer,
  init(io, socket, deps) {
    var { user, state, socketAccountMap, accounts, checkEventRate, applyRateGrace } = deps;

    // Store references for AI tick system (module-level, set once)
    if (!_io) _io = io;
    if (!_accounts) _accounts = accounts;
    if (!_socketAccountMap) _socketAccountMap = socketAccountMap;
    if (!_state) _state = state;

    // Director system references (set from deps injected by socket.js)
    if (!_directorMetrics && deps.directorMetrics) _directorMetrics = deps.directorMetrics;
    if (!_directorMicro && deps.directorMicro) _directorMicro = deps.directorMicro;
    if (!_directorRaid && deps.directorRaid) _directorRaid = deps.directorRaid;
    if (!_directorLich && deps.directorLich) _directorLich = deps.directorLich;

    // Start singleton ambush flush interval on first init (not per-socket)
    if (!_ambushFlushStarted && _io) {
      _ambushFlushStarted = true;
      var ambushFlushTimer = setInterval(function() {
        riftFloors.forEach(function(floor) {
          if (!floor._pendingAmbushes || floor._pendingAmbushes.length === 0) return;
          var pending = floor._pendingAmbushes;
          floor._pendingAmbushes = [];
          for (var i = 0; i < pending.length; i++) {
            var amb = pending[i];
            _io.to('zone:' + amb.zoneId).emit('dungeon_camp_ambush', {
              campX: amb.campX,
              campY: amb.campY,
              enemies: amb.enemies,
            });
          }
        });
      }, 5000);
      if (ambushFlushTimer && ambushFlushTimer.unref) ambushFlushTimer.unref();

      // Periodic stale state cleanup (every 5 minutes)
      var staleCleanupTimer = setInterval(function() {
        // Evict empty floor caches
        if (_state) evictEmptyFloors(_state);
        // Clean orphaned floorPlayers entries (floors with no active AI)
        floorPlayers.forEach(function(pMap, zoneId) {
          if (pMap.size === 0) {
            floorPlayers.delete(zoneId);
            floorPlayerStealth.delete(zoneId);
          }
        });
      }, 300000); // 5 minutes
      if (staleCleanupTimer && staleCleanupTimer.unref) staleCleanupTimer.unref();
    }

    // ------------------------------------------------------------------
    // Helpers that need closure over io/state/accounts
    // ------------------------------------------------------------------

    // Handle special events on floor entry (called once per floor per player)
    function handleSpecialEvent(floor, accKey, dungeonId, floorNum) {
      if (!floor || !floor.specialEvent) return;
      if (floor._specialEventHandled) return;
      floor._specialEventHandled = true;

      var evt = floor.specialEvent;
      var reward = evt.reward || {};
      var zoneId = getZoneIdForDungeon(dungeonId, floorNum);
      var serverXpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : 1;

      if (evt.id === 'treasure_goblin') {
        // Award bonus gold and XP
        var tgGold = Math.floor((reward.goldMultiplier || 3) * 50);
        var tgXp = Math.floor((reward.bonusXp || 50) * serverXpRate);
        if (accKey) {
          accounts.updateChips(accKey, tgGold);
          accounts.addSkillXp(accKey, 'dungeon_delving', tgXp);
        }
        socket.emit('dungeon_notification', {
          type: 'special_event',
          event: evt.id,
          title: evt.name,
          message: evt.description,
          goldAwarded: tgGold,
          xpAwarded: tgXp,
        });

      } else if (evt.id === 'ancient_shrine') {
        // Apply shrine_power buff to combat state
        var shrineCombat = getPlayerCombat(socket.id);
        if (shrineCombat) {
          var shrineEffect = { atkBoost: 5 };
          var shrineDuration = (reward.buffDuration || 120) * 1000;
          applyShrineBuff(shrineCombat, shrineEffect, false);
          if (!shrineCombat.activeBuffs) shrineCombat.activeBuffs = [];
          shrineCombat.activeBuffs.push({
            id: reward.buff || 'shrine_power',
            name: 'Ancient Shrine Blessing',
            effect: shrineEffect,
            expiresAt: Date.now() + shrineDuration,
          });
        }
        socket.emit('dungeon_notification', {
          type: 'special_event',
          event: evt.id,
          title: evt.name,
          message: evt.description,
          buff: reward.buff || 'shrine_power',
        });

      } else if (evt.id === 'merchant_ghost') {
        // Activate ghost merchant on this floor
        floor._ghostMerchantActive = true;
        socket.emit('dungeon_notification', {
          type: 'special_event',
          event: evt.id,
          title: evt.name,
          message: evt.description,
          shopDiscount: reward.shopDiscount || 0.30,
          rareItems: reward.rareItems || false,
        });

      } else if (evt.id === 'mini_boss') {
        // Award bonus XP and gold, roll for card pack drop
        var mbXp = Math.floor((reward.bonusXp || 100) * serverXpRate);
        var mbGold = reward.bonusGold || 50;
        if (accKey) {
          accounts.addSkillXp(accKey, 'dungeon_delving', mbXp);
          accounts.updateChips(accKey, mbGold);
          // Card pack chance
          if (reward.cardChance && Math.random() < reward.cardChance) {
            accounts.addPendingPack(accKey, 1);
            socket.emit('dungeon_notification', {
              type: 'special_event',
              event: evt.id,
              title: evt.name,
              message: evt.description + ' A card pack drops!',
              xpAwarded: mbXp,
              goldAwarded: mbGold,
              cardPackAwarded: true,
            });
            return;
          }
        }
        socket.emit('dungeon_notification', {
          type: 'special_event',
          event: evt.id,
          title: evt.name,
          message: evt.description,
          xpAwarded: mbXp,
          goldAwarded: mbGold,
        });

      } else if (evt.id === 'portal_room') {
        // Add bonus chests to the floor
        var bonusChestCount = reward.bonusChests || 3;
        var bonusChestTier = reward.chestTier || 'rare';
        if (floor.rooms && floor.rooms.length > 0) {
          for (var bci = 0; bci < bonusChestCount; bci++) {
            var roomIdx = Math.floor(Math.random() * floor.rooms.length);
            var rm = floor.rooms[roomIdx];
            var cx = rm.x + 1 + Math.floor(Math.random() * Math.max(1, rm.w - 2));
            var cy = rm.y + 1 + Math.floor(Math.random() * Math.max(1, rm.h - 2));
            floor.chests.push({
              x: cx,
              y: cy,
              tier: bonusChestTier,
              roomIndex: roomIdx,
              opened: false,
            });
          }
        }
        socket.emit('dungeon_notification', {
          type: 'special_event',
          event: evt.id,
          title: evt.name,
          message: evt.description,
          bonusChests: bonusChestCount,
        });

      } else if (evt.id === 'memory_crystal') {
        // Award XP and skill XP immediately
        var mcXp = Math.floor((reward.bonusXp || 75) * serverXpRate);
        var mcSkillXp = Math.floor((reward.skillXp || 25) * serverXpRate);
        if (accKey) {
          accounts.addSkillXp(accKey, 'dungeon_delving', mcXp);
          accounts.addSkillXp(accKey, 'dungeon_dwelling', mcSkillXp);
        }
        socket.emit('dungeon_notification', {
          type: 'special_event',
          event: evt.id,
          title: evt.name,
          message: evt.description,
          xpAwarded: mcXp,
          skillXpAwarded: mcSkillXp,
        });

      } else {
        // Unknown event — just notify client
        socket.emit('dungeon_notification', {
          type: 'special_event',
          event: evt.id,
          title: evt.name || 'Special Event',
          message: evt.description || 'Something unusual happens on this floor.',
        });
      }
    }

    function doZoneTransition(dungeonId, floorNum, floor, accKey) {
      var currentZone = state.playerZones.get(socket.id);
      var zoneId = getZoneIdForDungeon(dungeonId, floorNum);
      var displayName;
      if (dungeonId === 'rift') {
        displayName = 'Rift Floor ' + floorNum;
      } else if (dungeonId.indexOf('world_') === 0) {
        var transWdId = dungeonId.slice(6);
        var transWdDef = getWorldDungeonDef(transWdId);
        displayName = (transWdDef ? transWdDef.name : transWdId) + ' F' + floorNum;
      } else if (dungeonId.indexOf('camp_') === 0) {
        var transCampId = dungeonId.slice(5);
        var transCampStruct = overworldStructures.getStructure(transCampId);
        displayName = (transCampStruct ? transCampStruct.name : 'Structure') + ' F' + floorNum;
      } else if (dungeonId.indexOf('minirift_') === 0) {
        var transRiftId = dungeonId.slice(9);
        var transRift = overworldRifts.getRift(transRiftId);
        displayName = (transRift ? transRift.name : 'Rift') + ' F' + floorNum;
      } else {
        displayName = dungeonId.replace('cave_', 'Cave ') + ' F' + floorNum;
      }

      // Check floor player cap
      var existingPlayers = floorPlayers.get(zoneId);
      if (existingPlayers && existingPlayers.size >= MAX_FLOOR_PLAYERS) {
        socket.emit('dungeon_error', { message: 'Floor is full (' + MAX_FLOOR_PLAYERS + ' players max). Try another floor.' });
        return;
      }

      // 1. Leave current zone
      if (currentZone) {
        socket.leave('zone:' + currentZone);
        io.to('zone:' + currentZone).emit('player_left_zone', {
          playerId: socket.id,
          playerName: user.name,
          zoneId: currentZone,
        });
        state.leaveZone(socket.id);
      }

      // 2. Ensure dungeon zone exists
      state.getOrCreateDungeonZone(zoneId, displayName);

      // 3. Join zone at entrance
      var spawnX = floor.stairsUp.x * 32;
      var spawnY = floor.stairsUp.y * 32;
      state.joinZone(socket.id, zoneId, spawnX, spawnY);

      // 4. Join socket room
      socket.join('zone:' + zoneId);

      // 5. Save last location
      if (accKey) {
        accounts.setLastLocation(accKey, zoneId, spawnX, spawnY);
      }

      // 6. Track in playerDungeons
      var info = playerDungeons.get(socket.id) || {};
      info.dungeonId = dungeonId;
      info.floorNum = floorNum;
      info.floorEnteredAt = Date.now();
      playerDungeons.set(socket.id, info);

      // 7. Initialize combat state (HP/mana/stamina) on first floor entry
      if (!info.combat && accKey) {
        initPlayerCombatState(socket.id, accounts, accKey);
        // Director: init metrics with account data
        if (_directorMetrics) {
          var metricAcc = accounts.loadAccount(accKey);
          _directorMetrics.initPlayer(socket.id, metricAcc);
        }
      }
      // Director: update floor tracking
      if (_directorMetrics) _directorMetrics.setFloor(socket.id, floorNum);

      // 8. Ensure alive flags, apply floor modifier effects, initialize AI
      ensureEnemyAliveFlags(floor);
      applyFloorModifierPostGeneration(floor);
      initFloorEnemyAI(floor);

      // 9. Load race vision data for per-player visibility
      var visionOpts = { visionType: 'normal', tremorRange: null, fogRevealBonus: 0, stealthFootprint: 0, availableVisions: ['normal'] };
      if (accKey) {
        var visionAcc = accounts.loadAccount(accKey);
        if (visionAcc) {
          var raceData = rpgData.RACES[visionAcc.race];
          if (raceData) {
            visionOpts.visionType = raceData.vision || 'normal';
            // Check racial feat for tremor sense
            if (raceData.racialFeat && raceData.racialFeat.effects) {
              for (var tsi = 0; tsi < raceData.racialFeat.effects.length; tsi++) {
                var fx = raceData.racialFeat.effects[tsi];
                if (fx.type === 'tremor_sense') {
                  visionOpts.tremorRange = fx.range || 'short';
                }
              }
            }
            // Stealth races reduce footstep noise radius
            if (visionAcc.race === 'goblin') visionOpts.stealthFootprint = 2;
            else if (visionAcc.race === 'catfolk') visionOpts.stealthFootprint = 1;
          }
          // Compute available vision types from race + equipped cards
          var cardEffects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(accKey) : [];
          visionOpts.availableVisions = rpgData.getAvailableVisionTypes(visionAcc.race, cardEffects);
        }
      }

      // Remove player from old floor AI tracking, add to new with vision data
      removePlayerFromFloor(socket.id);
      floorRefs.set(zoneId, floor);
      addPlayerToFloor(zoneId, socket.id, spawnX, spawnY, visionOpts, floor);

      // 9a. Raid floor init and player tracking
      if (_directorRaid && floor.isRaidBossFloor) {
        _directorRaid.initRaidState(zoneId, floorNum);
        _directorRaid.playerJoinedRaidFloor(zoneId, socket.id, io);
      }

      // 10. Compute stealth level for this player (skill + race + card bonus)
      if (accKey) {
        var stealthAcc = accounts.loadAccount(accKey);
        if (stealthAcc && stealthAcc.skills) {
          var stealthSkill = stealthAcc.skills.thievery || stealthAcc.skills.lockpicking;
          var sLevel = stealthSkill ? Math.floor((stealthSkill.level || 0) / 10) : 0;
          if (stealthAcc.race === 'goblin') sLevel += 2;
          else if (stealthAcc.race === 'catfolk') sLevel += 1;
          // Card: stealth_bonus — adds to stealth level (each 0.1 = +1 level)
          var stealthCombat = getPlayerCombat(socket.id);
          if (stealthCombat && stealthCombat.stealthBonus > 0) {
            sLevel += Math.floor(stealthCombat.stealthBonus * 10);
          }
          if (sLevel > 0) {
            if (!floorPlayerStealth.has(zoneId)) floorPlayerStealth.set(zoneId, {});
            floorPlayerStealth.get(zoneId)[socket.id] = sLevel;
          }
        }
      }

      // 10a. Apply fog reveal bonus from dwelling skill
      var combat = getPlayerCombat(socket.id);
      if (combat && combat.skillBonuses && combat.skillBonuses.fogRevealBonus > 0) {
        var fp = floorPlayers.get(zoneId);
        if (fp) {
          var fpEntry = fp.get(socket.id);
          if (fpEntry) fpEntry.fogRevealBonus = combat.skillBonuses.fogRevealBonus;
        }
      }

      // 10b. Floor-wide turn mode: auto-join if active on this floor
      var existingTms = turnModeState.get(zoneId);
      if (existingTms && existingTms.active) {
        addPlayerToTurnMode(socket.id, zoneId);
        socket.emit('dungeon_mode_update', { turnBased: true });
      }

      // 11. Start AI tick for this floor
      startFloorAI(zoneId, floor);

      // 12. Emit per-player floor state with combat info and visibility
      var floorState = buildFloorState(floor, dungeonId, state, zoneId, socket.id);
      if (combat) {
        floorState.playerHp = combat.hp;
        floorState.playerMaxHp = combat.maxHp;
        floorState.playerMana = combat.mana;
        floorState.playerMaxMana = combat.maxMana;
        floorState.playerStamina = combat.stamina;
        floorState.playerMaxStamina = combat.maxStamina;
      }

      // Floor modifier flags
      var fMod = floor.floorModifier || {};
      if (fMod.id === 'unstable_rift') {
        floorState.wallShiftInterval = fMod.wallShiftInterval || 60;
      }
      if (fMod.id === 'silent_floor') {
        floorState.enemiesStationary = true;
      }

      // Include skill bonus info for client-side rendering (trap indicators, etc.)
      if (combat && combat.skillBonuses) {
        floorState.skillBonuses = {
          trapDetect: combat.skillBonuses.trapDetect,
          fogRevealBonus: combat.skillBonuses.fogRevealBonus,
          dwellingLevel: combat.skillBonuses.dwellingLevel,
          delvingLevel: combat.skillBonuses.delvingLevel,
        };
      }

      // Include player's vision type and available types for client rendering
      floorState.visionType = visionOpts.visionType;
      floorState.availableVisions = visionOpts.availableVisions;

      socket.emit('dungeon_floor_state', floorState);

      // 13. Broadcast arrival
      socket.to('zone:' + zoneId).emit('player_entered_zone', {
        id: socket.id,
        name: user.name,
        color: user.color,
        tag: user.tag,
        avatar: user.avatar || null,
        x: spawnX,
        y: spawnY,
        facing: 'down',
        zoneId: zoneId,
      });

      // LRU tracking
      var cacheMap, cacheKey;
      if (dungeonId === 'rift') {
        cacheMap = riftFloors;
        cacheKey = floorNum;
      } else if (dungeonId.indexOf('world_') === 0) {
        cacheMap = worldDungeonFloors;
        cacheKey = dungeonId.slice(6) + '_floor_' + floorNum;
      } else if (dungeonId.indexOf('camp_') === 0) {
        cacheMap = campFloors;
        cacheKey = (info.structureId || dungeonId.slice(5)) + '_floor_' + floorNum;
      } else {
        cacheMap = caveFloors;
        cacheKey = (info.caveKey || dungeonId.slice(5)) + '_floor_' + floorNum;
      }
      touchLRU(zoneId, cacheMap, cacheKey);
      evictEmptyFloors(state);

      // 14. Handle special event (once per floor, guarded by _specialEventHandled flag)
      handleSpecialEvent(floor, accKey, dungeonId, floorNum);
    }

    // ------------------------------------------------------------------
    // dungeon_enter
    // ------------------------------------------------------------------
    socket.on('dungeon_enter', function(data) {
      try {
        if (!data || typeof data.dungeonId !== 'string') return;
        if (!applyRateGrace(socket, 'dungeon_enter', 12, 10000)) return;

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) {
          socket.emit('dungeon_error', { message: 'No account linked' });
          return;
        }

        var acc = accounts.loadAccount(accKey);
        if (!acc) {
          socket.emit('dungeon_error', { message: 'Account not found' });
          return;
        }

        // Cancel any pending disconnect-while-downed grace timer on reconnect
        if (downedDisconnectTimers.has(accKey)) {
          clearTimeout(downedDisconnectTimers.get(accKey).timer);
          downedDisconnectTimers.delete(accKey);
        }

        // Prison check: jailed players cannot enter dungeons
        if (prison.isJailed(acc)) {
          var remaining = prison.getRemainingTime(acc);
          socket.emit('dungeon_error', { message: 'You are in jail. Time remaining: ' + Math.ceil(remaining / 1000) + 's. Pay bail or serve your time.' });
          return;
        }

        var dp = ensureDungeonProgress(acc);
        var currentZone = state.playerZones.get(socket.id);

        if (data.dungeonId === 'rift') {
          // Rift dungeon: must be in starter_town or rift_antechamber, and a guild member
          if (currentZone !== 'starter_town' && currentZone !== 'rift_antechamber') {
            socket.emit('dungeon_error', { message: 'You must be at The Rift to enter' });
            return;
          }
          if (!dp.guildMember) {
            socket.emit('dungeon_error', { message: 'You must be a guild member to enter the Rift' });
            return;
          }

          var floorNum = 1;
          // Ascension: Rift Veteran — start at a higher floor (+5 per rank)
          var riftVeteranRank = (acc.ascensionTree && acc.ascensionTree['rift_veteran']) || 0;
          if (riftVeteranRank > 0) {
            floorNum = Math.max(1, 1 + riftVeteranRank * 5);
          }
          if (typeof data.floorNum === 'number' && data.floorNum >= 1 && data.floorNum <= dp.deepestFloor) {
            floorNum = Math.max(floorNum, Math.floor(data.floorNum));
          }

          var floor = getRiftFloor(floorNum);
          doZoneTransition('rift', floorNum, floor, accKey);

        } else if (data.dungeonId.indexOf('cave_') === 0) {
          // Cave dungeon: parse cave key, no guild requirement
          var caveKey = data.dungeonId.slice(5);
          if (!caveKey || caveKey.length === 0) {
            socket.emit('dungeon_error', { message: 'Invalid cave identifier' });
            return;
          }

          // Check if cave was already cleared today (date-aware)
          if (dp.clearedCaves && dp.clearedCaves[data.dungeonId] === getTodayString()) {
            socket.emit('dungeon_error', { message: 'You have already cleared this cave today. It will reset tomorrow.' });
            return;
          }

          // Determine biome from worldgen chunk at cave position
          var biome = 6; // default to plains
          var parts = caveKey.split('_');
          if (parts.length >= 2) {
            var caveWorldX = parseInt(parts[0], 10);
            var caveWorldY = parseInt(parts[1], 10);
            if (!isNaN(caveWorldX) && !isNaN(caveWorldY)) {
              var chunkSize = (state.worldgen && state.worldgen.CHUNK_SIZE) ? state.worldgen.CHUNK_SIZE : 512;
              var cx = Math.floor(caveWorldX / chunkSize);
              var cy = Math.floor(caveWorldY / chunkSize);
              var chunk = state.getOrGenerateChunk('overworld', cx, cy);
              if (chunk && typeof chunk.biome === 'number') {
                biome = chunk.biome;
              }
            }
          }

          var caveFloorNum = 1;
          var caveFloor = getCaveFloor(caveKey, caveFloorNum, biome);

          // Store biome on the player dungeon info for later floor transitions
          var pdInfo = { dungeonId: data.dungeonId, floorNum: caveFloorNum, biome: biome, caveKey: caveKey };
          playerDungeons.set(socket.id, pdInfo);

          // Save active cave
          dp.activeCave = data.dungeonId;
          dp.activeCaveFloor = caveFloorNum;
          safeSaveAccount(accounts, acc, 'cave_enter');

          doZoneTransition(data.dungeonId, caveFloorNum, caveFloor, accKey);

        } else if (data.dungeonId.indexOf('world_') === 0) {
          // World dungeon: fixed geographical POI dungeon
          var worldDungeonId = data.dungeonId.slice(6);
          var worldDef = getWorldDungeonDef(worldDungeonId);
          if (!worldDef) {
            socket.emit('dungeon_error', { message: 'Unknown world dungeon' });
            return;
          }

          // Lich Raid intercept: route to raid gathering system
          if (worldDef.isRaid && worldDungeonId === 'lich_tower') {
            // Check 24h cooldown
            if (!lichRaidCanStart() && (!lichRaidState || lichRaidState.phase === 'complete')) {
              var remaining = lichRaidState ? Math.ceil((LICH_RAID_COOLDOWN_MS - (Date.now() - lichRaidState.lastCompletedAt)) / 60000) : 0;
              socket.emit('dungeon_error', { message: 'The Sanctum of Veranthos was recently cleansed. It will reform in ~' + remaining + ' minutes.' });
              return;
            }

            // Level check
            if (acc.level && acc.level < worldDef.minLevel) {
              socket.emit('dungeon_warning', {
                message: 'Warning: ' + worldDef.name + ' is a level ' + worldDef.minLevel + '+ raid. You are level ' + acc.level + '.',
              });
            }

            // Create gathering if needed
            if (!lichRaidState || lichRaidState.phase === 'complete') {
              lichRaidCreateGathering();
            }

            // Check if raid is already active (in progress)
            if (lichRaidState.phase === 'active' || lichRaidState.phase === 'boss') {
              socket.emit('dungeon_error', { message: 'A raid is already in progress. Wait for the current raid to end.' });
              return;
            }

            // Add player to gathering
            var added = lichRaidAddPlayer(socket.id, accKey);
            if (!added) {
              socket.emit('dungeon_error', { message: 'The raid is full (' + LICH_RAID_MAX_PLAYERS + ' players max).' });
              return;
            }

            // Store dungeon info (player is in raid staging)
            var raidPdInfo = {
              dungeonId: data.dungeonId,
              floorNum: 0,
              biome: worldDef.biome,
              worldDungeonId: worldDungeonId,
              totalFloors: worldDef.floors,
              isLichRaid: true,
            };
            playerDungeons.set(socket.id, raidPdInfo);

            // Emit gathering update to all raid participants
            lichRaidBroadcast('raid_gathering_update', {
              totalPlayers: lichRaidState.players.size,
              minRequired: LICH_RAID_MIN_PLAYERS,
              maxAllowed: LICH_RAID_MAX_PLAYERS,
              parties: lichRaidGetPartyInfo(),
              countdownStarted: lichRaidState.countdownStarted,
              countdownEndsAt: lichRaidState.countdownEndsAt,
              phase: lichRaidState.phase,
            });

            socket.emit('raid_joined', {
              message: 'You have joined the raid on The Sanctum of Veranthos. Waiting for players... (' + lichRaidState.players.size + '/' + LICH_RAID_MIN_PLAYERS + ')',
              partyId: lichRaidState.players.get(socket.id).partyId,
            });

            return; // Don't continue with normal world dungeon flow
          }

          // Check if world dungeon was already cleared today (date-aware)
          if (dp.clearedCaves && dp.clearedCaves[data.dungeonId] === getTodayString()) {
            socket.emit('dungeon_error', { message: 'You have already cleared this dungeon today. It will reset tomorrow.' });
            return;
          }

          // Ocean dungeon access check: Lizard Folk or water_breathing effect
          if (worldDef.type === 'ocean_dungeon') {
            var canEnterOcean = false;
            if (acc.race === 'lizardfolk') {
              canEnterOcean = true;
            } else {
              // Check for water_breathing from equipped cards
              // equippedCards contains string instance IDs, not card objects;
              // resolve each to its instance then check the template for effects.
              if (acc.equippedCards && acc.rpgCards) {
                for (var wbi = 0; wbi < acc.equippedCards.length; wbi++) {
                  var cardInstanceId = acc.equippedCards[wbi];
                  if (!cardInstanceId) continue;
                  // Find the card instance in rpgCards
                  var cardInstance = null;
                  for (var wbj = 0; wbj < acc.rpgCards.length; wbj++) {
                    if (acc.rpgCards[wbj].instanceId === cardInstanceId) {
                      cardInstance = acc.rpgCards[wbj];
                      break;
                    }
                  }
                  if (!cardInstance) continue;
                  // Check instance-level effects first
                  if (cardInstance.effects && Array.isArray(cardInstance.effects)) {
                    for (var wbe = 0; wbe < cardInstance.effects.length; wbe++) {
                      if (cardInstance.effects[wbe].type === 'water_breathing') {
                        canEnterOcean = true;
                        break;
                      }
                    }
                  }
                  if (canEnterOcean) break;
                  // Check template for water_breathing
                  var wbTemplate = rpgData.CARD_BY_ID[cardInstance.cardId];
                  if (wbTemplate && wbTemplate.effects) {
                    for (var wbk = 0; wbk < wbTemplate.effects.length; wbk++) {
                      if (wbTemplate.effects[wbk].type === 'water_breathing') {
                        canEnterOcean = true;
                        break;
                      }
                    }
                  }
                  if (canEnterOcean) break;
                }
              }
            }
            if (!canEnterOcean) {
              socket.emit('dungeon_error', { message: 'This dungeon is submerged. Only Lizard Folk or those with water breathing can enter.' });
              return;
            }
          }

          // Level warning (non-blocking)
          if (acc.level && acc.level < worldDef.minLevel) {
            socket.emit('dungeon_warning', {
              message: 'Warning: ' + worldDef.name + ' is designed for level ' + worldDef.minLevel + '+. You are level ' + acc.level + '. Proceed with caution.',
            });
          }

          var worldFloorNum = 1;
          var worldFloor = getWorldDungeonFloor(worldDungeonId, worldFloorNum);
          if (!worldFloor) {
            socket.emit('dungeon_error', { message: 'Failed to generate dungeon floor' });
            return;
          }

          // Store dungeon info
          var worldPdInfo = {
            dungeonId: data.dungeonId,
            floorNum: worldFloorNum,
            biome: worldDef.biome,
            worldDungeonId: worldDungeonId,
            totalFloors: worldDef.floors,
          };
          playerDungeons.set(socket.id, worldPdInfo);

          // Save active dungeon progress
          dp.activeCave = data.dungeonId;
          dp.activeCaveFloor = worldFloorNum;
          safeSaveAccount(accounts, acc, 'world_dungeon_enter');

          doZoneTransition(data.dungeonId, worldFloorNum, worldFloor, accKey);

        } else if (data.dungeonId.indexOf('camp_') === 0) {
          // Overworld structure dungeon: procedural enemy camp / stronghold
          var campStructId = data.dungeonId.slice(5);
          var campStruct = overworldStructures.getStructure(campStructId);
          if (!campStruct) {
            socket.emit('dungeon_error', { message: 'This structure no longer exists' });
            return;
          }

          if (campStruct.cleared) {
            socket.emit('dungeon_error', { message: 'This structure has already been cleared' });
            return;
          }

          // Level warning (non-blocking)
          if (acc.level && campStruct.minLevel && acc.level < campStruct.minLevel) {
            socket.emit('dungeon_warning', {
              message: 'Warning: ' + campStruct.name + ' is designed for level ' + campStruct.minLevel + '+. You are level ' + acc.level + '. Proceed with caution.',
            });
          }

          var campFloorNum = 1;
          var campFloor = getCampFloor(campStructId, campFloorNum);
          if (!campFloor) {
            socket.emit('dungeon_error', { message: 'Failed to generate structure floor' });
            return;
          }

          // Store dungeon info
          var campPdInfo = {
            dungeonId: data.dungeonId,
            floorNum: campFloorNum,
            biome: campStruct.biome || 6,
            structureId: campStructId,
            totalFloors: campStruct.totalFloors,
          };
          playerDungeons.set(socket.id, campPdInfo);

          // Track player in structure
          overworldStructures.addPlayer(campStructId, socket.id);

          // Save active dungeon progress
          dp.activeCave = data.dungeonId;
          dp.activeCaveFloor = campFloorNum;
          safeSaveAccount(accounts, acc, 'camp_enter');

          doZoneTransition(data.dungeonId, campFloorNum, campFloor, accKey);

        } else if (data.dungeonId.indexOf('minirift_') === 0) {
          // Mini-rift dungeon: secondary spatial tear
          var mrEnterId = data.dungeonId.slice(9);
          var mrRift = overworldRifts.getRift(mrEnterId);
          if (!mrRift) {
            socket.emit('dungeon_error', { message: 'This rift no longer exists' });
            return;
          }

          if (mrRift.cleared || mrRift.destroyed) {
            socket.emit('dungeon_error', { message: 'This rift has already been sealed' });
            return;
          }

          // Level warning (non-blocking)
          if (acc.level && mrRift.minPlayerLevel && acc.level < mrRift.minPlayerLevel) {
            socket.emit('dungeon_warning', {
              message: 'Warning: ' + mrRift.name + ' (Tier ' + mrRift.tier + ') is designed for level ' + mrRift.minPlayerLevel + '+. You are level ' + acc.level + '. Proceed with caution.',
            });
          }

          var mrFloorNum = 1;
          var mrFloor = overworldRifts.getRiftFloor(mrEnterId, mrFloorNum);
          if (!mrFloor) {
            socket.emit('dungeon_error', { message: 'Failed to generate rift floor' });
            return;
          }

          var mrPdInfo = {
            dungeonId: data.dungeonId,
            floorNum: mrFloorNum,
            biome: mrRift.biome || 12,
            riftId: mrEnterId,
            totalFloors: mrRift.totalFloors,
          };
          playerDungeons.set(socket.id, mrPdInfo);

          overworldRifts.addPlayer(mrEnterId, socket.id);

          dp.activeCave = data.dungeonId;
          dp.activeCaveFloor = mrFloorNum;
          safeSaveAccount(accounts, acc, 'minirift_enter');

          doZoneTransition(data.dungeonId, mrFloorNum, mrFloor, accKey);

        } else {
          socket.emit('dungeon_error', { message: 'Unknown dungeon type' });
          return;
        }

        // --- Fire glossary trigger for dungeon entry ---
        try {
          var dungeonTerms = knowledgeHandler.fireGlossaryTrigger(accounts, accKey, 'dungeon_enter');
          for (var dti = 0; dti < dungeonTerms.length; dti++) {
            socket.emit('knowledge_term_unlocked', dungeonTerms[dti]);
          }
        } catch (e) { /* glossary trigger non-fatal */ }

        // --- Track dungeon entry achievement ---
        var dungeonEnterUnlocks = challengesHandler.trackAchievementProgress(accounts, accKey, 'dungeon_enter', 1, socket);
        challengesHandler.emitAchievementUnlocks(socket, accounts, dungeonEnterUnlocks);
      } catch (err) {
        console.error('[dungeon_enter] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // Lich Raid: force start (solo/small group)
    // ------------------------------------------------------------------
    socket.on('raid_force_start', function() {
      if (!lichRaidState || lichRaidState.phase !== 'gathering') {
        socket.emit('dungeon_error', { message: 'No raid gathering in progress.' });
        return;
      }
      if (!lichRaidState.players.has(socket.id)) {
        socket.emit('dungeon_error', { message: 'You are not in the raid.' });
        return;
      }
      if (lichRaidState.players.size < LICH_RAID_RECOMMENDED_PLAYERS) {
        var scaleFactor = lichRaidGetScalingFactor();
        lichRaidBroadcast('raid_warning', {
          message: 'Starting raid with ' + lichRaidState.players.size + ' player(s). Boss scaled to ' + Math.round(scaleFactor * 100) + '% power. NPC allies will fill empty party slots.',
        });
      }
      lichRaidForceStart();
    });

    // ------------------------------------------------------------------
    // Lich Raid: enter floor (after raid activated)
    // ------------------------------------------------------------------
    socket.on('raid_enter_floor', function() {
      if (!lichRaidState || lichRaidState.phase !== 'active') {
        socket.emit('dungeon_error', { message: 'Raid is not active.' });
        return;
      }
      var pEntry = lichRaidState.players.get(socket.id);
      if (!pEntry) {
        socket.emit('dungeon_error', { message: 'You are not in this raid.' });
        return;
      }

      var partyData = lichRaidState.parties.get(pEntry.partyId);
      var targetFloor = partyData ? partyData.floor : 1;
      if (targetFloor < 1) targetFloor = 1;

      var accKey = socketAccountMap.get(socket.id);
      var floor = lichRaidGetFloor(pEntry.partyId, targetFloor);
      if (!floor) {
        socket.emit('dungeon_error', { message: 'Failed to generate raid floor.' });
        return;
      }

      // Update player info
      pEntry.floor = targetFloor;
      var info = playerDungeons.get(socket.id);
      if (info) {
        info.floorNum = targetFloor;
        info.isLichRaid = true;
        info.raidPartyId = pEntry.partyId;
      }

      // Override zone ID for raid floors (party-keyed)
      var raidZoneId = lichRaidGetPartyZoneId(pEntry.partyId, targetFloor);

      // Check floor player cap (4 per party instance, 32 for boss floor)
      var maxCap = targetFloor === 7 ? LICH_RAID_MAX_PLAYERS : LICH_RAID_MAX_PARTY_SIZE;
      var existingPlayers = floorPlayers.get(raidZoneId);
      if (existingPlayers && existingPlayers.size >= maxCap) {
        socket.emit('dungeon_error', { message: 'Floor is full.' });
        return;
      }

      doZoneTransition(raidZoneId, targetFloor, floor, accKey);
    });

    // ------------------------------------------------------------------
    // dungeon_exit
    // ------------------------------------------------------------------
    socket.on('dungeon_exit', function() {
      try {

        var info = playerDungeons.get(socket.id);
        if (!info) {
          socket.emit('dungeon_error', { message: 'You are not in a dungeon' });
          return;
        }

        // Clean up turn-based overworld mode
        var exitZoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        cleanupTurnMode(socket.id, exitZoneId);

        // Clean up active turn-based combat before exiting
        var exitCombat = dungeonCombat.getCombatBySocketId(socket.id);
        if (exitCombat) {
          dungeonCombat.handlePlayerDisconnect(exitCombat.id, socket.id);
        }

        var accKey = socketAccountMap.get(socket.id);
        var currentZone = state.playerZones.get(socket.id);

        // Lich raid: remove from raid state on exit
        if (info.isLichRaid && lichRaidState) {
          lichRaidRemovePlayer(socket.id);
          lichRaidBroadcast('raid_gathering_update', {
            totalPlayers: lichRaidState.players.size,
            minRequired: LICH_RAID_RECOMMENDED_PLAYERS,
            maxAllowed: LICH_RAID_MAX_PLAYERS,
            parties: lichRaidGetPartyInfo(),
            countdownStarted: lichRaidState.countdownStarted || false,
            countdownEndsAt: lichRaidState.countdownEndsAt || 0,
            phase: lichRaidState.phase,
          });
        }

        // Leave dungeon zone
        if (currentZone) {
          socket.leave('zone:' + currentZone);
          io.to('zone:' + currentZone).emit('player_left_zone', {
            playerId: socket.id,
            playerName: user.name,
            zoneId: currentZone,
          });
          state.leaveZone(socket.id);
        }

        // Determine return destination
        var destZone, destX, destY;
        if (info.dungeonId === 'rift') {
          destZone = 'starter_town';
          destX = 800;
          destY = 400;
        } else if (info.dungeonId.indexOf('world_') === 0) {
          // World dungeon: return to overworld at dungeon entrance location
          destZone = 'overworld';
          var exitWdId = info.worldDungeonId || info.dungeonId.slice(6);
          var exitWdDef = getWorldDungeonDef(exitWdId);
          if (exitWdDef) {
            var exitCX = worldgen.WORLD_SCALE.originCX + exitWdDef.refX;
            var exitCY = worldgen.WORLD_SCALE.originCY + exitWdDef.refY;
            destX = exitCX * worldgen.CHUNK_SIZE + 8 * worldgen.TILE_SIZE + worldgen.TILE_SIZE / 2;
            destY = exitCY * worldgen.CHUNK_SIZE + 8 * worldgen.TILE_SIZE + worldgen.TILE_SIZE / 2;
          } else {
            // Fallback to spawn
            destX = 0;
            destY = 0;
          }
        } else if (info.dungeonId.indexOf('camp_') === 0) {
          // Structure dungeon: return to overworld at structure position
          destZone = 'overworld';
          var exitCampId = info.structureId || info.dungeonId.slice(5);
          var exitCampStruct = overworldStructures.getStructure(exitCampId);
          if (exitCampStruct) {
            destX = exitCampStruct.worldX;
            destY = exitCampStruct.worldY;
          } else {
            destX = 0;
            destY = 0;
          }
          // Remove player from structure tracking
          overworldStructures.removePlayer(exitCampId, socket.id);
        } else if (info.dungeonId.indexOf('minirift_') === 0) {
          // Mini-rift: return to overworld at rift position
          destZone = 'overworld';
          var exitRiftId = info.riftId || info.dungeonId.slice(9);
          var exitRift = overworldRifts.getRift(exitRiftId);
          if (exitRift) {
            destX = exitRift.worldX;
            destY = exitRift.worldY;
          } else {
            destX = 0;
            destY = 0;
          }
          overworldRifts.removePlayer(exitRiftId, socket.id);
        } else {
          // Cave: return to overworld at original cave position
          destZone = 'overworld';
          destX = 0;
          destY = 0;
          if (info.caveKey) {
            var parts = info.caveKey.split('_');
            if (parts.length >= 2) {
              destX = parseInt(parts[0], 10) || 0;
              destY = parseInt(parts[1], 10) || 0;
            }
          }
        }

        // Join surface zone
        var destZoneObj = state.zones.get(destZone);
        if (destZoneObj) {
          state.joinZone(socket.id, destZone, destX, destY);
          socket.join('zone:' + destZone);

          if (accKey) {
            accounts.setLastLocation(accKey, destZone, destX, destY);

            // Clear active cave progress
            var acc = accounts.loadAccount(accKey);
            if (acc) {
              var dp = ensureDungeonProgress(acc);
              dp.activeCave = null;
              dp.activeCaveFloor = 0;
              safeSaveAccount(accounts, acc, 'dungeon_exit_clear_cave');
            }
          }

          socket.emit('zone_state', state.getZoneState(destZone));

          socket.to('zone:' + destZone).emit('player_entered_zone', {
            id: socket.id,
            name: user.name,
            color: user.color,
            tag: user.tag,
            avatar: user.avatar || null,
            x: destX,
            y: destY,
            facing: 'down',
            zoneId: destZone,
          });
        }

        removePlayerFromFloor(socket.id);
        playerDungeons.delete(socket.id);
      } catch (err) {
        console.error('[dungeon_exit] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_move
    // ------------------------------------------------------------------
    socket.on('dungeon_move', function(data) {
      try {
        if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return;
        if (!isFinite(data.x) || !isFinite(data.y)) return;
        if (!applyRateGrace(socket, 'dungeon_move', 120, 1000)) return;

        var info = playerDungeons.get(socket.id);
        if (!info) return;

        // Prevent movement during turn-based combat
        var moveZoneCheck = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        var movePMapCheck = floorPlayers.get(moveZoneCheck);
        var moveFPCheck = movePMapCheck ? movePMapCheck.get(socket.id) : null;
        if (moveFPCheck && moveFPCheck.inTurnCombat) {
          socket.emit('dungeon_error', { message: 'Cannot move during tactical combat' });
          return;
        }

        // Turn-based overworld mode: enforce turn order and movement points
        var _turnMoveDeduct = false;
        if (moveFPCheck && moveFPCheck.turnBasedMode) {
          var moveTms = turnModeState.get(moveZoneCheck);
          if (!moveTms || moveTms.currentUnitId !== 'player_' + socket.id) {
            socket.emit('dungeon_error', { message: 'Not your turn' });
            return;
          }
          if (!moveTms.movesRemaining || moveTms.movesRemaining <= 0) {
            socket.emit('dungeon_error', { message: 'No movement points remaining' });
            return;
          }
          _turnMoveDeduct = true;
          // Decrement after validation passes (below)
        }

        var floor = getFloorForPlayer(socket.id);
        if (!floor) return;

        var x = Math.floor(data.x);
        var y = Math.floor(data.y);

        // Bounds check
        if (x < 0 || x >= floor.width || y < 0 || y >= floor.height) return;

        // Walkability check
        var tile = floor.grid[y][x];
        if (!WALKABLE_TILES[tile]) return;

        // Adjacency check (1-tile step)
        var pos = state.playerPositions.get(socket.id);
        if (pos) {
          var prevTileX = Math.floor(pos.x / 32);
          var prevTileY = Math.floor(pos.y / 32);
          var dx = Math.abs(x - prevTileX);
          var dy = Math.abs(y - prevTileY);
          if (dx + dy > 1 && !(dx === 1 && dy === 1)) return; // allow diagonal
        }

        // Determine facing
        var facing = 'down';
        if (pos) {
          var ptx = Math.floor(pos.x / 32);
          var pty = Math.floor(pos.y / 32);
          if (x > ptx) facing = 'right';
          else if (x < ptx) facing = 'left';
          else if (y < pty) facing = 'up';
          else if (y > pty) facing = 'down';
        }

        // Update position
        state.updatePlayerPosition(socket.id, x * 32, y * 32, facing);

        // Deduct move point now that all validation passed
        if (_turnMoveDeduct) {
          var deductTms = turnModeState.get(moveZoneCheck);
          if (deductTms) deductTms.movesRemaining--;
        }

        var zoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        socket.to('zone:' + zoneId).emit('dungeon_player_moved', {
          id: socket.id,
          x: x,
          y: y,
          facing: facing,
        });

        // Trap check — dungeon_dwelling skill can detect + reduce damage
        if (tile === TILE.TRAP) {
          for (var ti = 0; ti < floor.traps.length; ti++) {
            var trap = floor.traps[ti];
            if (trap.x === x && trap.y === y && !trap.triggered) {
              var trapCombat = getPlayerCombat(socket.id);
              var trapBonuses = (trapCombat && trapCombat.skillBonuses) ? trapCombat.skillBonuses : null;

              // Fix 6: Also check card effects for trap_detect_bonus
              var trapPlayerInfo = playerDungeons.get(socket.id);
              var trapCardEffects = (trapPlayerInfo && trapPlayerInfo.resolvedCards) ? trapPlayerInfo.resolvedCards : [];
              var trapDetectBonus = 0;
              for (var tdi = 0; tdi < trapCardEffects.length; tdi++) {
                var tdCard = trapCardEffects[tdi];
                if (tdCard && tdCard.effects) {
                  for (var tdei = 0; tdei < tdCard.effects.length; tdei++) {
                    if (tdCard.effects[tdei].type === 'trap_detect_bonus') {
                      trapDetectBonus += (tdCard.effects[tdei].value || 0);
                    }
                  }
                }
              }

              // Card: hidden_detection — adds to trap detection chance
              var cardHiddenDetect = (trapCombat && trapCombat.hiddenDetection) ? trapCombat.hiddenDetection : 0;
              var totalTrapDetect = trapDetectBonus + cardHiddenDetect;

              // Trap detection: if dwelling Lv5+ and trap not yet triggered,
              // or if card effects grant trap_detect_bonus / hidden_detection,
              // warn the player instead of triggering immediately on first step
              var canDetectTrap = (trapBonuses && trapBonuses.trapDetect) || (totalTrapDetect > 0 && Math.random() < totalTrapDetect);
              if (canDetectTrap && !trap._warned) {
                trap._warned = true;
                socket.emit('dungeon_trap_detected', {
                  x: x,
                  y: y,
                  message: 'Your dungeon instincts warn you of a trap here!',
                });
                // Still trigger the trap but apply damage reduction
              }

              trap.triggered = true;
              addNoiseEvent(floor, 'trap_trigger', x, y, 0);
              var trapDmg = trap.damage || 10;
              var trapDied = false;

              // Apply dwelling skill trap damage reduction
              if (trapBonuses && trapBonuses.trapDamageReduction > 0) {
                trapDmg = Math.floor(trapDmg * (1 - trapBonuses.trapDamageReduction));
                if (trapDmg < 0) trapDmg = 0;
              }

              // Apply card trap_detect_bonus as additional damage reduction (proportional)
              if (trapDetectBonus > 0) {
                trapDmg = Math.floor(trapDmg * (1 - Math.min(trapDetectBonus, 0.50)));
                if (trapDmg < 0) trapDmg = 0;
              }

              if (trapCombat) {
                trapCombat.hp = Math.max(0, trapCombat.hp - trapDmg);
                trapCombat.damageTakenThisFloor = (trapCombat.damageTakenThisFloor || 0) + trapDmg;
                trapDied = trapCombat.hp <= 0;
              }
              socket.emit('dungeon_trap_triggered', {
                x: x,
                y: y,
                damage: trapDmg,
                reduced: (trapBonuses && trapBonuses.trapDamageReduction > 0) || (trapDetectBonus > 0),
                playerHp: trapCombat ? trapCombat.hp : null,
                playerMaxHp: trapCombat ? trapCombat.maxHp : null,
                playerDied: trapDied,
              });
              if (trapDied) {
                var trapAccKey = socketAccountMap.get(socket.id);
                handlePlayerDeath(socket, io, state, accounts, trapAccKey, info, 'Killed by a dungeon trap');
              }
              break;
            }
          }
        }

        // Check for walking into an invisible enemy's tile (surprise ambush)
        // Only triggers if the player is not already in combat
        var moveZoneIdCheck = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        var movePMapCheck2 = floorPlayers.get(moveZoneIdCheck);
        var moveFPCheck2 = movePMapCheck2 ? movePMapCheck2.get(socket.id) : null;
        if (moveFPCheck2 && !moveFPCheck2.inTurnCombat) {
          for (var invEi = 0; invEi < floor.enemies.length; invEi++) {
            var invEnemy = floor.enemies[invEi];
            if (invEnemy.alive === false) continue;
            if (!invEnemy.invisibility || invEnemy._invisBroken) continue;
            if (invEnemy.x !== x || invEnemy.y !== y) continue;
            // Player walked onto the same tile as an invisible enemy
            // Check if the player can see this enemy
            var invVisionType = (moveFPCheck2 && moveFPCheck2.visionType) ? moveFPCheck2.visionType : 'normal';
            var invCurrentTurn = (floor._currentTurn || 0);
            var canSeeInvEnemy = dungeonVision.canPlayerSeeEnemy(invEnemy, invVisionType, invCurrentTurn);
            // Trigger surprise combat (the enemy ambushes the player)
            var invUser = state.users.get(socket.id);
            if (invUser) {
              socket.emit('dungeon_ambush', {
                enemyName: invEnemy.name,
                invisibilityType: invEnemy.invisibility,
                surprise: !canSeeInvEnemy,
                message: canSeeInvEnemy
                  ? 'You detected a hidden ' + invEnemy.name + ' and engaged it!'
                  : 'A hidden ' + invEnemy.name + ' ambushes you!',
              });
              // Initiate combat with this invisible enemy
              initiateTurnCombat(socket, io, state, accounts, socketAccountMap, invUser, floor, info, invEnemy, invEi, null);
            }
            break; // Only one ambush per move
          }
        }

        // Update player position for AI tick system
        var moveZoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        updateFloorPlayerPosition(moveZoneId, socket.id, x, y);

        // Inject footstep noise event for AI sound detection
        var moveStealth = (floorPlayerStealth.get(moveZoneId) || {})[socket.id] || 0;
        var moveFpEntry = (floorPlayers.get(moveZoneId) || new Map()).get(socket.id);
        var stealthFootprint = moveFpEntry ? (moveFpEntry.stealthFootprint || 0) : 0;
        addNoiseEvent(floor, 'footstep', x, y, moveStealth + stealthFootprint);

        // Vision mana drain: deduct mana per move for non-normal vision types
        var visionFpEntry = (floorPlayers.get(moveZoneId) || new Map()).get(socket.id);
        if (visionFpEntry && visionFpEntry.visionType && visionFpEntry.visionType !== 'normal') {
          var visionDef = rpgData.VISION_TYPES[visionFpEntry.visionType];
          if (visionDef && visionDef.manaCostPerTurn > 0) {
            var vCombat = getPlayerCombat(socket.id);
            if (vCombat) {
              vCombat.mana = Math.max(0, vCombat.mana - visionDef.manaCostPerTurn);
              // If mana runs out, auto-revert to normal vision
              if (vCombat.mana <= 0) {
                visionFpEntry.visionType = 'normal';
                // Restore racial tremor if any
                var vAccKey = socketAccountMap.get(socket.id);
                if (vAccKey) {
                  var vAcc = accounts.loadAccount(vAccKey);
                  if (vAcc) {
                    var vRaceData = rpgData.RACES[vAcc.race];
                    visionFpEntry.tremorRange = null;
                    if (vRaceData && vRaceData.racialFeat && vRaceData.racialFeat.effects) {
                      for (var vri = 0; vri < vRaceData.racialFeat.effects.length; vri++) {
                        if (vRaceData.racialFeat.effects[vri].type === 'tremor_sense') {
                          visionFpEntry.tremorRange = vRaceData.racialFeat.effects[vri].range || 'short';
                        }
                      }
                    }
                  }
                }
                socket.emit('dungeon_vision_changed', {
                  visionType: 'normal',
                  manaCostPerTurn: 0,
                  reason: 'mana_depleted',
                });
              }
              // Send mana update
              socket.emit('dungeon_mana_update', {
                mana: vCombat.mana,
                maxMana: vCombat.maxMana,
              });
            }
          }
        }

        // Increment echolocation pulse counter on player move (echolocation is pulse-per-move)
        var moveEchoFp = (floorPlayers.get(moveZoneId) || new Map()).get(socket.id);
        if (moveEchoFp && moveEchoFp.visionType === 'echolocation') {
          if (moveEchoFp._echolocationCurrentTurn === undefined) moveEchoFp._echolocationCurrentTurn = 0;
          moveEchoFp._echolocationCurrentTurn++;
          if (moveEchoFp._echolocationCurrentTurn % dungeonVision.ECHOLOCATION_PULSE_INTERVAL === 0) {
            moveEchoFp._echolocationPulseTurn = moveEchoFp._echolocationCurrentTurn;
          }
        }

        // Turn-based mode: send updated move points after move
        var tbMoveFp = (floorPlayers.get(moveZoneId) || new Map()).get(socket.id);
        if (tbMoveFp && tbMoveFp.turnBasedMode) {
          var tbTms = turnModeState.get(moveZoneId);
          if (tbTms) {
            socket.emit('dungeon_turn_update', { movesRemaining: tbTms.movesRemaining });
          }
        }

        // Recompute per-player visibility and emit delta
        var visResult = recomputePlayerVisibility(moveZoneId, socket.id, floor);
        if (visResult && visResult.delta) {
          socket.emit('dungeon_visibility_update', visResult.delta);
        }

        // Late-join: check if player walked near an active turn-based combat
        var movePMap = floorPlayers.get(moveZoneId);
        var moveFP = movePMap ? movePMap.get(socket.id) : null;
        if (moveFP && !moveFP.inTurnCombat) {
          var activeCombats = dungeonCombat.getActiveCombats();
          activeCombats.forEach(function(combat) {
            if (combat.dungeonId !== info.dungeonId) return;
            // Check if any combat unit is within 10 tiles
            var nearCombat = false;
            combat.units.forEach(function(unit) {
              if (!unit.alive) return;
              var dist = Math.abs(unit.x - x) + Math.abs(unit.y - y);
              if (dist <= 10) nearCombat = true;
            });
            if (nearCombat) {
              // Send join offer to the player
              socket.emit('tc_combat_join_offer', {
                combatId: combat.id,
                turnNumber: combat.turnNumber,
                enemyCount: (function() {
                  var count = 0;
                  combat.units.forEach(function(u) { if (u.type === 'enemy' && u.alive) count++; });
                  return count;
                })(),
                allyCount: (function() {
                  var count = 0;
                  combat.units.forEach(function(u) { if (u.type === 'player' && u.alive) count++; });
                  return count;
                })(),
              });
            }
          });
        }
      } catch (err) {
        console.error('[dungeon_move] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // dungeon_toggle_turn_mode — BG3-style real-time / turn-based toggle
    // ------------------------------------------------------------------
    socket.on('dungeon_toggle_turn_mode', function() {
      try {
        var info = playerDungeons.get(socket.id);
        if (!info) return;
        var zoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        var pMap = floorPlayers.get(zoneId);
        var fp = pMap ? pMap.get(socket.id) : null;
        if (!fp) return;

        // Cannot toggle during tactical combat
        if (fp.inTurnCombat) {
          socket.emit('dungeon_error', { message: 'Cannot toggle mode during tactical combat' });
          return;
        }

        // Floor-wide: check if turn mode already active on this floor
        var tms = turnModeState.get(zoneId);
        var wasActive = !!(tms && tms.active);

        if (wasActive) {
          // Cannot toggle off while paused (someone is in tactical combat)
          if (tms.paused) {
            socket.emit('dungeon_error', { message: 'Cannot toggle mode while tactical combat is active' });
            return;
          }
          // Toggling OFF: end turn mode for entire floor
          disableFloorTurnMode(zoneId);
        } else {
          // Toggling ON: enable for entire floor
          enableFloorTurnMode(zoneId);
        }
      } catch (err) {
        console.error('[dungeon_toggle_turn_mode] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // dungeon_end_turn — player explicitly ends their overworld turn
    // ------------------------------------------------------------------
    socket.on('dungeon_end_turn', function() {
      try {
        var info = playerDungeons.get(socket.id);
        if (!info) return;
        var zoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        var tms = turnModeState.get(zoneId);
        if (!tms || tms.currentUnitId !== 'player_' + socket.id) return;
        endPlayerTurnMode(socket.id, zoneId);
      } catch (err) {
        console.error('[dungeon_end_turn] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // dungeon_dash — spend action to gain extra movement (BG3 Dash)
    // ------------------------------------------------------------------
    socket.on('dungeon_dash', function() {
      try {
        var info = playerDungeons.get(socket.id);
        if (!info) return;
        var zoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        var tms = turnModeState.get(zoneId);
        if (!tms || !tms.active) return;
        if (tms.currentUnitId !== 'player_' + socket.id) {
          socket.emit('dungeon_error', { message: 'Not your turn' });
          return;
        }
        if (tms.hasDashed) {
          socket.emit('dungeon_error', { message: 'Already dashed this turn' });
          return;
        }
        tms.hasDashed = true;
        tms.movesRemaining += TURN_MODE_MOVE_POINTS;
        socket.emit('dungeon_turn_update', { movesRemaining: tms.movesRemaining, dashed: true });
      } catch (err) {
        console.error('[dungeon_dash] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // dungeon_descend
    // ------------------------------------------------------------------
    socket.on('dungeon_descend', function() {
      try {
        if (playerTransitioning.has(socket.id)) return; // prevent double-descend

        var info = playerDungeons.get(socket.id);
        if (!info) {
          socket.emit('dungeon_error', { message: 'You are not in a dungeon' });
          return;
        }

        // Prevent descending during turn-based combat
        var descZoneCheck = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        var descPMapCheck = floorPlayers.get(descZoneCheck);
        var descFPCheck = descPMapCheck ? descPMapCheck.get(socket.id) : null;
        if (descFPCheck && descFPCheck.inTurnCombat) {
          socket.emit('dungeon_error', { message: 'Cannot descend during tactical combat' });
          return;
        }

        // Clean up turn-based overworld mode before changing floors
        cleanupTurnMode(socket.id, descZoneCheck);

        var floor = getFloorForPlayer(socket.id);
        if (!floor) {
          socket.emit('dungeon_error', { message: 'Floor data not found' });
          return;
        }

        // Verify player is on stairs down tile
        var pos = state.playerPositions.get(socket.id);
        if (!pos) return;
        var tileX = Math.floor(pos.x / 32);
        var tileY = Math.floor(pos.y / 32);
        if (tileX < 0 || tileX >= floor.width || tileY < 0 || tileY >= floor.height) return;
        var tile = floor.grid[tileY][tileX];
        if (tile !== TILE.STAIRS_DOWN && tile !== TILE.EXIT) {
          socket.emit('dungeon_error', { message: 'You must be on stairs to descend' });
          return;
        }

        var accKey = socketAccountMap.get(socket.id);
        var descendCombat = getPlayerCombat(socket.id);
        var descendBonuses = (descendCombat && descendCombat.skillBonuses) ? descendCombat.skillBonuses : null;

        // --- Quest: no_damage_floor --- check before leaving current floor
        if (accKey && descendCombat && (descendCombat.damageTakenThisFloor || 0) === 0) {
          var noDmgResult = updateQuestProgress(accounts, accKey, 'no_damage_floor', { floorNum: info.floorNum });
          emitQuestUpdate(socket, accounts, accKey, noDmgResult);
        }

        // --- Quest: speed_clear --- check elapsed time on this floor
        if (accKey && info.floorEnteredAt) {
          var floorElapsed = Math.floor((Date.now() - info.floorEnteredAt) / 1000);
          var speedResult = updateQuestProgress(accounts, accKey, 'speed_clear', { floorNum: info.floorNum, time: floorElapsed });
          emitQuestUpdate(socket, accounts, accKey, speedResult);
        }

        // Reset per-floor damage tracker for the next floor
        if (descendCombat) {
          descendCombat.damageTakenThisFloor = 0;
        }

        // Card: out_of_combat_heal — heal a percentage of max HP between floors
        if (descendCombat && descendCombat.outOfCombatHeal > 0) {
          var oocHealAmount = Math.floor(descendCombat.maxHp * descendCombat.outOfCombatHeal);
          if (oocHealAmount > 0 && descendCombat.hp < descendCombat.maxHp) {
            descendCombat.hp = Math.min(descendCombat.maxHp, descendCombat.hp + oocHealAmount);
            socket.emit('dungeon_heal', {
              amount: oocHealAmount,
              source: 'card_passive',
              hp: descendCombat.hp,
              maxHp: descendCombat.maxHp,
              message: 'Your card passives restore ' + oocHealAmount + ' HP between floors.',
            });
          }
        }

        // --- Durability loss on floor descent: 1.5% armor, 1% weapon per floor ---
        if (accKey) {
          try {
            var descendAcc = accounts.loadAccount(accKey);
            if (descendAcc && descendAcc.equipment) {
              var descendCardEffects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(accKey) : [];
              var durResults = accounts.reduceArmorDurability(descendAcc, 1.5, descendCardEffects); // 1.5% per floor
              var wepResults = accounts.reduceWeaponDurability(descendAcc, 1, descendCardEffects);   // 1% per floor
              if (wepResults) { for (var wri = 0; wri < wepResults.length; wri++) durResults.push(wepResults[wri]); }
              accounts.saveAccount(descendAcc);
              // Emit warnings/breakages to player
              for (var dri = 0; dri < durResults.length; dri++) {
                if (durResults[dri].broken) {
                  socket.emit('item_broken', { slot: durResults[dri].slot, itemName: durResults[dri].itemName });
                } else if (durResults[dri].lowDurability) {
                  socket.emit('durability_warning', { slot: durResults[dri].slot, itemName: durResults[dri].itemName, durability: durResults[dri].durability, maxDurability: durResults[dri].maxDurability });
                }
              }
            }
          } catch (durErr) {
            console.error('[dungeon_descend] Durability error:', durErr.message);
          }
        }

        var nextFloorNum = info.floorNum + 1;

        // --- Delving Lv10: shortcut chance --- may skip 1-2 extra floors
        var shortcutSkipped = 0;
        if (descendBonuses && descendBonuses.shortcutChance > 0 && Math.random() < descendBonuses.shortcutChance) {
          shortcutSkipped = 1 + (Math.random() < 0.5 ? 1 : 0); // skip 1 or 2 floors
          nextFloorNum += shortcutSkipped;
        }

        // Cave / world dungeon depth check (after shortcut to ensure we don't exceed)
        if (info.dungeonId.indexOf('cave_') === 0) {
          var caveKey = info.caveKey || info.dungeonId.slice(5);
          var biome = info.biome || 6;
          var totalFloors = dungeonData.getCaveDepth(biome, caveKey);
          if (nextFloorNum > totalFloors) {
            if (shortcutSkipped > 0) {
              nextFloorNum = totalFloors;
              shortcutSkipped = nextFloorNum - info.floorNum - 1;
            }
            if (nextFloorNum > totalFloors) {
              socket.emit('dungeon_error', { message: 'You have reached the deepest floor of this cave' });
              return;
            }
          }
        } else if (info.dungeonId.indexOf('world_') === 0) {
          var wdTotalFloors = info.totalFloors || 5;
          if (nextFloorNum > wdTotalFloors) {
            if (shortcutSkipped > 0) {
              nextFloorNum = wdTotalFloors;
              shortcutSkipped = nextFloorNum - info.floorNum - 1;
            }
            if (nextFloorNum > wdTotalFloors) {
              socket.emit('dungeon_error', { message: 'You have reached the deepest floor of this dungeon' });
              return;
            }
          }
        } else if (info.dungeonId.indexOf('camp_') === 0) {
          var campTotalFloors = info.totalFloors || 3;
          if (nextFloorNum > campTotalFloors) {
            if (shortcutSkipped > 0) {
              nextFloorNum = campTotalFloors;
              shortcutSkipped = nextFloorNum - info.floorNum - 1;
            }
            if (nextFloorNum > campTotalFloors) {
              socket.emit('dungeon_error', { message: 'You have reached the deepest floor of this structure' });
              return;
            }
          }
        } else if (info.dungeonId.indexOf('minirift_') === 0) {
          var mrTotalFloors = info.totalFloors || 10;
          if (nextFloorNum > mrTotalFloors) {
            if (shortcutSkipped > 0) {
              nextFloorNum = mrTotalFloors;
              shortcutSkipped = nextFloorNum - info.floorNum - 1;
            }
            if (nextFloorNum > mrTotalFloors) {
              socket.emit('dungeon_error', { message: 'You have reached the deepest floor of this rift' });
              return;
            }
          }
        }

        // Notify client about shortcut discovery
        if (shortcutSkipped > 0) {
          socket.emit('dungeon_shortcut_found', {
            message: 'Your dungeon instincts revealed a hidden shortcut! Skipping ' + shortcutSkipped + ' floor' + (shortcutSkipped > 1 ? 's' : '') + '.',
            floorsSkipped: shortcutSkipped,
            targetFloor: nextFloorNum,
          });
        }

        // Get or generate next floor
        var nextFloor;
        if (info.dungeonId === 'rift') {
          nextFloor = getRiftFloor(nextFloorNum);

          // Update deepest floor record
          if (accKey) {
            var acc = accounts.loadAccount(accKey);
            if (acc) {
              var dp = ensureDungeonProgress(acc);
              if (nextFloorNum > dp.deepestFloor) {
                dp.deepestFloor = nextFloorNum;
                safeSaveAccount(accounts, acc, 'descend_deepest');
                // Update leaderboard
                updateLeaderboardEntry(accKey, user.name, dp);
              }
            }
          }
        } else if (info.isLichRaid && lichRaidState) {
          // Lich Raid: use raid floor system
          var raidPartyId = info.raidPartyId;
          if (!raidPartyId) {
            var raidPEntry = lichRaidState.players.get(socket.id);
            raidPartyId = raidPEntry ? raidPEntry.partyId : null;
          }
          if (!raidPartyId) {
            socket.emit('dungeon_error', { message: 'Raid party not found.' });
            return;
          }
          if (nextFloorNum > 7) {
            socket.emit('dungeon_error', { message: 'You have reached the deepest floor of the Sanctum.' });
            return;
          }

          nextFloor = lichRaidGetFloor(raidPartyId, nextFloorNum);

          // Update party floor tracking
          var raidParty = lichRaidState.parties.get(raidPartyId);
          if (raidParty) raidParty.floor = nextFloorNum;
          var playerRaidEntry = lichRaidState.players.get(socket.id);
          if (playerRaidEntry) playerRaidEntry.floor = nextFloorNum;
          info.floorNum = nextFloorNum;
          info.raidPartyId = raidPartyId;

          // Boss convergence: transition to boss phase when first party reaches floor 7
          if (nextFloorNum === 7 && lichRaidState.phase === 'active') {
            lichRaidState.phase = 'boss';
            lichRaidBroadcast('raid_boss_phase', {
              message: 'A party has reached the Sanctum\'s inner chamber! All parties converge on the Archlich!',
            });

            // Start grace period for other parties, then initiate boss combat
            var _lichBossGraceTimer = setTimeout(function() {
              if (lichRaidState && lichRaidState.phase === 'boss') {
                lichRaidStartBossCombat();
              }
            }, LICH_RAID_BOSS_GRACE_MS);
            if (_lichBossGraceTimer && _lichBossGraceTimer.unref) _lichBossGraceTimer.unref();
          }

          // Override zone transition to use raid zone ID
          var raidZoneId = lichRaidGetPartyZoneId(raidPartyId, nextFloorNum);
          playerTransitioning.add(socket.id);
          try {
            doZoneTransition(raidZoneId, nextFloorNum, nextFloor, accKey);
          } finally {
            playerTransitioning.delete(socket.id);
          }
          return; // Skip normal doZoneTransition below

        } else if (info.dungeonId.indexOf('world_') === 0) {
          var wdId = info.worldDungeonId || info.dungeonId.slice(6);
          nextFloor = getWorldDungeonFloor(wdId, nextFloorNum);

          // Update active dungeon floor
          if (accKey) {
            var worldAcc = accounts.loadAccount(accKey);
            if (worldAcc) {
              var worldDp = ensureDungeonProgress(worldAcc);
              worldDp.activeCaveFloor = nextFloorNum;
              safeSaveAccount(accounts, worldAcc, 'descend_world_dungeon');
            }
          }
        } else if (info.dungeonId.indexOf('camp_') === 0) {
          var campDescId = info.structureId || info.dungeonId.slice(5);
          nextFloor = getCampFloor(campDescId, nextFloorNum);

          // Update active dungeon floor
          if (accKey) {
            var campAcc = accounts.loadAccount(accKey);
            if (campAcc) {
              var campDp = ensureDungeonProgress(campAcc);
              campDp.activeCaveFloor = nextFloorNum;
              safeSaveAccount(accounts, campAcc, 'descend_camp');
            }
          }
        } else if (info.dungeonId.indexOf('minirift_') === 0) {
          var mrDescId = info.riftId || info.dungeonId.slice(9);
          nextFloor = overworldRifts.getRiftFloor(mrDescId, nextFloorNum);

          if (accKey) {
            var mrAcc = accounts.loadAccount(accKey);
            if (mrAcc) {
              var mrDp = ensureDungeonProgress(mrAcc);
              mrDp.activeCaveFloor = nextFloorNum;
              safeSaveAccount(accounts, mrAcc, 'descend_minirift');
            }
          }
        } else {
          var ck = info.caveKey || info.dungeonId.slice(5);
          var bi = info.biome || 6;
          nextFloor = getCaveFloor(ck, nextFloorNum, bi);

          // Update active cave floor
          if (accKey) {
            var caveAcc = accounts.loadAccount(accKey);
            if (caveAcc) {
              var caveDp = ensureDungeonProgress(caveAcc);
              caveDp.activeCaveFloor = nextFloorNum;
              safeSaveAccount(accounts, caveAcc, 'descend_cave');
            }
          }
        }

        // --- Quest: floor_reached --- track depth progress
        if (accKey) {
          var floorReachedResult = updateQuestProgress(accounts, accKey, 'floor_reached', { floorNum: nextFloorNum });
          emitQuestUpdate(socket, accounts, accKey, floorReachedResult);
        }

        // --- World quest: dungeon minFloor tracking ---
        if (accKey) {
          try {
            var wqFloorAcc = accounts.loadAccount(accKey);
            if (wqFloorAcc && wqFloorAcc.questProgress && wqFloorAcc.questProgress.active) {
              var _wqRpg = require('../rpg-data');
              var wqFloorChanged = false;
              for (var wqfi = 0; wqfi < wqFloorAcc.questProgress.active.length; wqfi++) {
                var wqf = wqFloorAcc.questProgress.active[wqfi];
                var wqfTmpl = _wqRpg.WORLD_QUEST_TEMPLATES && _wqRpg.WORLD_QUEST_TEMPLATES.find(function(t) { return t.questId === wqf.questId; });
                if (wqfTmpl && wqfTmpl.type === 'dungeon' && wqfTmpl.target.minFloor && nextFloorNum >= wqfTmpl.target.minFloor) {
                  if (wqf.progress < wqf.targetCount) {
                    wqf.progress = wqf.targetCount;
                    wqFloorChanged = true;
                    socket.emit('quest_progress', { questId: wqf.questId, progress: wqf.progress, targetCount: wqf.targetCount, complete: true });
                  }
                }
              }
              if (wqFloorChanged) accounts.saveAccount(wqFloorAcc);
            }
          } catch (wqFloorErr) { /* non-fatal */ }
        }

        // --- Phantom Skill XP: Dungeon Delving/Dwelling on floor descent ---
        if (accKey) {
          var descendServerXpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : 1;
          // Card: dungeon_xp_bonus applied to descent XP too
          var descCardXpBonus = (descendCombat && descendCombat.dungeonXpBonus) ? descendCombat.dungeonXpBonus : 0;
          var descXpMult = descendServerXpRate * (1 + descCardXpBonus);
          // Dungeon Delving: 30-50 XP per floor cleared
          var delvingDescXp = Math.floor((30 + Math.floor(Math.random() * 21)) * descXpMult);
          accounts.addSkillXp(accKey, 'dungeon_delving', delvingDescXp);
          // Dungeon Dwelling: 30-50 XP per floor cleared
          var dwellingDescXp = Math.floor((30 + Math.floor(Math.random() * 21)) * descXpMult);
          accounts.addSkillXp(accKey, 'dungeon_dwelling', dwellingDescXp);
          // Survival: 5 XP for exploring new dungeon floor
          accounts.addSkillXp(accKey, 'survival', 5);
        }

        // --- Track daily challenge & achievement progress for dungeon floors ---
        if (accKey) {
          challengesHandler.trackChallengeProgress(accounts, accKey, 'dungeon_floor', 1);
          // Track rift floor depth for rift-specific challenges and achievements
          if (info.dungeonId === 'rift') {
            challengesHandler.trackChallengeProgress(accounts, accKey, 'rift_floor', 1);
            var riftUnlocks = challengesHandler.checkAchievementAbsolute(accounts, accKey, 'rift_floor', nextFloorNum, socket);
            challengesHandler.emitAchievementUnlocks(socket, accounts, riftUnlocks);
          }
        }

        playerTransitioning.add(socket.id);
        try {
          doZoneTransition(info.dungeonId, nextFloorNum, nextFloor, accKey);
        } finally {
          playerTransitioning.delete(socket.id);
        }
      } catch (err) {
        playerTransitioning.delete(socket.id);
        console.error('[dungeon_descend] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_ascend
    // ------------------------------------------------------------------
    socket.on('dungeon_ascend', function() {
      try {
        if (playerTransitioning.has(socket.id)) return; // prevent double-ascend

        var info = playerDungeons.get(socket.id);
        if (!info) {
          socket.emit('dungeon_error', { message: 'You are not in a dungeon' });
          return;
        }

        if (info.floorNum <= 1) {
          socket.emit('dungeon_error', { message: 'You are already on the first floor. Use dungeon_exit to leave.' });
          return;
        }

        // Clean up turn-based overworld mode before changing floors
        var ascZoneCheck = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        cleanupTurnMode(socket.id, ascZoneCheck);

        var floor = getFloorForPlayer(socket.id);
        if (!floor) return;

        // Verify player is on stairs up tile
        var pos = state.playerPositions.get(socket.id);
        if (!pos) return;
        var tileX = Math.floor(pos.x / 32);
        var tileY = Math.floor(pos.y / 32);
        if (tileX < 0 || tileX >= floor.width || tileY < 0 || tileY >= floor.height) return;
        var tile = floor.grid[tileY][tileX];
        if (tile !== TILE.STAIRS_UP && tile !== TILE.ENTRANCE) {
          socket.emit('dungeon_error', { message: 'You must be on stairs to ascend' });
          return;
        }

        var prevFloorNum = info.floorNum - 1;
        var prevFloor;
        var accKey = socketAccountMap.get(socket.id);

        if (info.dungeonId === 'rift') {
          prevFloor = getRiftFloor(prevFloorNum);
        } else if (info.dungeonId.indexOf('world_') === 0) {
          var wdAscId = info.worldDungeonId || info.dungeonId.slice(6);
          prevFloor = getWorldDungeonFloor(wdAscId, prevFloorNum);
        } else {
          var ck = info.caveKey || info.dungeonId.slice(5);
          var bi = info.biome || 6;
          prevFloor = getCaveFloor(ck, prevFloorNum, bi);
        }

        playerTransitioning.add(socket.id);
        try {
          doZoneTransition(info.dungeonId, prevFloorNum, prevFloor, accKey);
        } finally {
          playerTransitioning.delete(socket.id);
        }
      } catch (err) {
        playerTransitioning.delete(socket.id);
        console.error('[dungeon_ascend] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_attack — triggers turn-based tactical combat
    // ------------------------------------------------------------------
    socket.on('dungeon_attack', function(data) {
      try {
        if (!data || typeof data.enemyIndex !== 'number') return;
        if (!isFinite(data.enemyIndex)) return;
        if (!applyRateGrace(socket, 'dungeon_attack', 40, 1000)) return;

        var info = playerDungeons.get(socket.id);
        if (!info) return;

        var floor = getFloorForPlayer(socket.id);
        if (!floor) return;

        var enemyIndex = Math.floor(data.enemyIndex);
        if (!floor.enemies || enemyIndex < 0 || enemyIndex >= floor.enemies.length) return;

        var enemy = floor.enemies[enemyIndex];
        if (enemy.alive === false) {
          socket.emit('dungeon_error', { message: 'Enemy is already dead' });
          return;
        }

        // Invisible enemy check: prevent attacking invisible enemies the player can't see
        if (enemy.invisibility && !enemy._invisBroken) {
          var atkZoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
          var atkPMap = floorPlayers.get(atkZoneId);
          var atkFp = atkPMap ? atkPMap.get(socket.id) : null;
          var atkVisionType = (atkFp && atkFp.visionType) ? atkFp.visionType : 'normal';
          var atkCurrentTurn = (floor._currentTurn || 0);
          if (!dungeonVision.canPlayerSeeEnemy(enemy, atkVisionType, atkCurrentTurn)) {
            socket.emit('dungeon_error', { message: 'You cannot see that enemy' });
            return;
          }
        }

        // Range check (uses weapon range if available)
        var pos = state.playerPositions.get(socket.id);
        if (!pos) return;
        var ptx = Math.floor(pos.x / 32);
        var pty = Math.floor(pos.y / 32);
        var edx = Math.abs(ptx - enemy.x);
        var edy = Math.abs(pty - enemy.y);
        var existingCombat = getPlayerCombat(socket.id);
        var attackRange = (existingCombat && existingCombat.weaponRange) ? existingCombat.weaponRange : 1.5;
        if (edx > attackRange || edy > attackRange) {
          socket.emit('dungeon_error', { message: 'Enemy is too far away' });
          return;
        }

        // Check if player is already in turn-based combat
        var zoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        var pMap = floorPlayers.get(zoneId);
        if (pMap) {
          var fp = pMap.get(socket.id);
          if (fp && fp.inTurnCombat) {
            socket.emit('dungeon_error', { message: 'Already in tactical combat' });
            return;
          }
        }

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        var combat = getPlayerCombat(socket.id);
        if (!combat) {
          combat = initPlayerCombatState(socket.id, accounts, accKey);
        }
        if (!combat || combat.hp <= 0) {
          socket.emit('dungeon_error', { message: 'You are dead' });
          return;
        }

        // Inject attack noise event
        addNoiseEvent(floor, 'attack', ptx, pty, 0);

        // Ranged weapon = player surprise (caught off guard)
        var surpriseFor = (attackRange > 1.5) ? 'player' : null;

        // Pause turn mode during tactical combat
        var atkZoneId2 = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        var atkTms = turnModeState.get(atkZoneId2);
        if (atkTms && atkTms.active) {
          atkTms.paused = true;
          if (atkTms.turnTimer) { clearTimeout(atkTms.turnTimer); atkTms.turnTimer = null; }
        }

        // Initiate turn-based tactical combat
        initiateTurnCombat(socket, io, state, accounts, socketAccountMap, user, floor, info, enemy, enemyIndex, surpriseFor);
      } catch (err) {
        console.error('[dungeon_attack] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_open_chest
    // ------------------------------------------------------------------
    socket.on('dungeon_open_chest', function(data) {
      try {
        if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return;
        if (!isFinite(data.x) || !isFinite(data.y)) return;
        if (!applyRateGrace(socket, 'dungeon_open_chest', 20, 2000)) return;

        var info = playerDungeons.get(socket.id);
        if (!info) return;

        var floor = getFloorForPlayer(socket.id);
        if (!floor) return;

        var x = Math.floor(data.x);
        var y = Math.floor(data.y);

        // Find chest at x,y
        if (!floor.chests) {
          socket.emit('dungeon_error', { message: 'No chests on this floor' });
          return;
        }
        var chest = null;
        var chestIdx = -1;
        for (var i = 0; i < floor.chests.length; i++) {
          if (floor.chests[i].x === x && floor.chests[i].y === y) {
            chest = floor.chests[i];
            chestIdx = i;
            break;
          }
        }

        if (!chest) {
          socket.emit('dungeon_error', { message: 'No chest at that position' });
          return;
        }
        if (chest.opened) {
          socket.emit('dungeon_error', { message: 'This chest has already been opened' });
          return;
        }

        // Proximity check
        var pos = state.playerPositions.get(socket.id);
        if (!pos) return;
        var ptx = Math.floor(pos.x / 32);
        var pty = Math.floor(pos.y / 32);
        if (Math.abs(ptx - x) > 1 || Math.abs(pty - y) > 1) {
          socket.emit('dungeon_error', { message: 'Too far from chest' });
          return;
        }

        // Mark opened and broadcast to all players on floor
        chest.opened = true;
        var chestZoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        io.to('zone:' + chestZoneId).emit('dungeon_chest_opened', {
          x: x, y: y, openedBy: user.name,
        });

        // Inject chest open noise event
        addNoiseEvent(floor, 'chest_open', x, y, 0);

        // --- Mimic Infestation modifier: chest may be a mimic ---
        if (floor._mimicChance && Math.random() < floor._mimicChance) {
          var mTpl = floor._mimicTemplate || { id: 'mimic', name: 'Mimic', hp: 60, atk: 18, def: 8, xp: 30, gold: 20, isMimic: true };
          var mHpS = 1 + info.floorNum * 0.12;
          var mAtkS = 1 + info.floorNum * 0.08;
          var mEnemy = {
            id: 'mimic_' + x + '_' + y + '_' + Date.now(),
            name: mTpl.name, hp: Math.floor((mTpl.hp || 60) * mHpS),
            maxHp: Math.floor((mTpl.hp || 60) * mHpS),
            atk: Math.floor((mTpl.atk || 18) * mAtkS), def: mTpl.def || 8,
            xp: Math.floor((mTpl.xp || 30) * mHpS),
            gold: Math.floor((mTpl.gold || 20) * mHpS),
            x: x, y: y, alive: true, isBoss: false, isMimic: true, archetype: 'bruiser',
          };
          floor.enemies.push(mEnemy);
          indexNewEnemy(floor, mEnemy);
          dungeonAI.initEnemyAI(mEnemy, 'bruiser');
          mEnemy.aiState = 'alert';
          var mIdx = floor.enemies.length - 1;
          var mCombat = getPlayerCombat(socket.id);
          var mDmg = Math.floor(mEnemy.atk * 0.7);
          var mDied = false;
          if (mCombat) {
            mCombat.hp = Math.max(0, mCombat.hp - mDmg);
            mDied = mCombat.hp <= 0;
          }
          var mZoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
          io.to('zone:' + mZoneId).emit('dungeon_enemies_update', {
            enemies: [{ index: mIdx, id: mEnemy.id, name: mEnemy.name, x: mEnemy.x, y: mEnemy.y, hp: mEnemy.hp, maxHp: mEnemy.maxHp, atk: mEnemy.atk, def: mEnemy.def, alive: true, isMimic: true, aiState: 'alert' }],
          });
          socket.emit('dungeon_chest_result', {
            x: x, y: y, tier: chest.tier, isMimic: true,
            mimicName: mEnemy.name, mimicDamage: mDmg, mimicEnemyIndex: mIdx,
            playerHp: mCombat ? mCombat.hp : null, playerMaxHp: mCombat ? mCombat.maxHp : null,
            playerDied: mDied,
          });
          if (mDied) {
            var mAccKey = socketAccountMap.get(socket.id);
            handlePlayerDeath(socket, io, state, accounts, mAccKey, info, 'Killed by a Mimic');
          }
          return;
        }

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        // Get dungeon skill bonuses for chest loot
        var chestCombat = getPlayerCombat(socket.id);
        var chestSkillBonuses = (chestCombat && chestCombat.skillBonuses) ? chestCombat.skillBonuses : null;

        // Apply delving skill chest tier bonus (Lv5: +1 tier step)
        var effectiveTier = chest.tier;
        if (chestSkillBonuses && chestSkillBonuses.chestTierBonus > 0) {
          effectiveTier = upgradeChestTier(chest.tier, chestSkillBonuses.chestTierBonus);
        }
        // Card: lockpicking_bonus — chance to upgrade chest tier by 1 additional step
        var cardLockpickBonus = (chestCombat && chestCombat.lockpickingBonus) ? chestCombat.lockpickingBonus : 0;
        if (cardLockpickBonus > 0 && Math.random() < cardLockpickBonus) {
          effectiveTier = upgradeChestTier(effectiveTier, 1);
        }

        // Recalculate loot if tier was upgraded
        var chestGold = chest.gold;
        var chestResource = chest.resource;
        var chestResourceAmt = chest.resourceAmount;
        var chestHasCard = chest.hasCard;

        if (effectiveTier !== chest.tier) {
          var upgradedLoot = CHEST_LOOT[effectiveTier];
          if (upgradedLoot) {
            chestGold = upgradedLoot.goldMin + Math.floor(Math.random() * (upgradedLoot.goldMax - upgradedLoot.goldMin + 1));
            chestResource = upgradedLoot.resources[Math.floor(Math.random() * upgradedLoot.resources.length)];
            chestHasCard = Math.random() < upgradedLoot.cardChance;
          }
        }

        // Apply chest gold multiplier from delving skill (Lv5: +15%)
        var chestGoldMult = (chestSkillBonuses && chestSkillBonuses.chestGoldMult) ? chestSkillBonuses.chestGoldMult : 1;
        var chestAllGoldMult = (chestSkillBonuses && chestSkillBonuses.allGoldMult) ? chestSkillBonuses.allGoldMult : 1;
        // Card: thievery_bonus — extra gold from chests (percentage boost)
        var cardThieveryBonus = (chestCombat && chestCombat.thieveryBonus) ? chestCombat.thieveryBonus : 0;
        chestGold = Math.floor(chestGold * chestGoldMult * chestAllGoldMult * (1 + cardThieveryBonus));

        // Apply chest card chance multiplier from delving skill (Lv40: 2x)
        if (!chestHasCard && chestSkillBonuses && chestSkillBonuses.chestCardChanceMult > 1) {
          var baseCardChance = CHEST_LOOT[effectiveTier] ? CHEST_LOOT[effectiveTier].cardChance : 0.05;
          var boostedChance = baseCardChance * chestSkillBonuses.chestCardChanceMult;
          chestHasCard = Math.random() < boostedChance;
        }

        // Award gold
        if (chestGold > 0) {
          accounts.updateChips(accKey, chestGold);
        }

        // Award resource
        if (chestResource && chestResourceAmt > 0) {
          accounts.addResource(accKey, chestResource, chestResourceAmt);
        }

        // Award card pack if applicable
        if (chestHasCard) {
          accounts.addPendingPack(accKey, 1);
        }

        // Book drop roll on chest open (3-20% chance based on tier, theme-filtered)
        var chestBookId = null;
        try {
          var chestFloorTheme = floor._theme || null;
          chestBookId = loreBooks.rollBookDrop(effectiveTier, info.floorNum, chestFloorTheme, false);
          if (chestBookId) {
            var chestBookResult = knowledgeHandler.discoverBook(accounts, accKey, chestBookId);
            if (chestBookResult) {
              socket.emit('knowledge_book_discovered', {
                bookId: chestBookResult.book.id, title: chestBookResult.book.title,
                rarity: chestBookResult.book.rarity, source: 'chest',
              });
              for (var cbti = 0; cbti < chestBookResult.unlockedTerms.length; cbti++) {
                socket.emit('knowledge_term_unlocked', chestBookResult.unlockedTerms[cbti]);
              }
            }
          }
        } catch (chestBookErr) {
          console.error('[dungeon_open_chest] Book drop error:', chestBookErr.message);
        }

        // Award dungeon_delving xp (modified by skill XP multiplier + server xpRate + card bonus)
        var chestBaseXp = 10 + info.floorNum * 2;
        var chestXpMult = (chestSkillBonuses && chestSkillBonuses.dungeonXpMult) ? chestSkillBonuses.dungeonXpMult : 1;
        var chestServerXpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : 1;
        var chestCardXpBonus = (chestCombat && chestCombat.dungeonXpBonus) ? chestCombat.dungeonXpBonus : 0;
        var xpAmount = Math.floor(chestBaseXp * chestXpMult * chestServerXpRate * (1 + chestCardXpBonus));
        var xpResult = accounts.addSkillXp(accKey, 'dungeon_delving', xpAmount);

        // Quest progress: track chest opens
        var chestQuestResult = updateQuestProgress(accounts, accKey, 'chest_open', { floorNum: info.floorNum });
        emitQuestUpdate(socket, accounts, accKey, chestQuestResult);

        // --- Procedural equipment loot from chests ---
        var chestLootItems = [];
        try {
          var chestLootSpecs = lootGen.rollDungeonLoot(info.floorNum, false, true);
          if (chestLootSpecs && chestLootSpecs.length > 0) {
            var chestLootPool = getFloorLootPool(info.floorNum);
            for (var cli = 0; cli < chestLootSpecs.length; cli++) {
              var clSpec = chestLootSpecs[cli];

              // Container drop
              if (clSpec.container) {
                var chestContainerItem = lootGen.generateContainerItem({ depth: info.floorNum, source: 'chest' });
                if (chestContainerItem) {
                  var ccAddRes = accounts.addMMOItem(accKey, chestContainerItem);
                  if (!ccAddRes || !ccAddRes.error) {
                    chestLootItems.push(chestContainerItem);
                    socket.emit('grid_item_added', { item: chestContainerItem, rev: (ccAddRes && ccAddRes._gridRev) || 0 });
                  }
                }
                continue;
              }

              // Higher tier chests guarantee better rarity
              if (effectiveTier === 'epic' || effectiveTier === 'legendary') {
                var minRarityOrder = lootGen.RARITY_ORDER[clSpec.rarity] || 0;
                if (minRarityOrder < (lootGen.RARITY_ORDER['rare'] || 2)) clSpec.rarity = 'rare';
              }
              var clBaseType = chestLootPool[Math.floor(Math.random() * chestLootPool.length)];
              var clBaseDef = accounts.WEAPON_TYPES[clBaseType];
              if (!clBaseDef) continue;
              var clItem = lootGen.generateItem(clBaseType, clBaseDef, {
                source: 'chest',
                depth: info.floorNum,
                forcedRarity: clSpec.rarity,
                luckBonus: accounts.getPlayerLuck(accKey),
              });
              if (clItem) {
                clItem.maxDurability = accounts.getMaxDurability(clBaseType);
                clItem.durability = clItem.maxDurability;
                var clAddRes = accounts.addMMOItem(accKey, clItem);
                if (!clAddRes || !clAddRes.error) {
                  chestLootItems.push(clItem);
                  socket.emit('grid_item_added', { item: clItem, rev: (clAddRes && clAddRes._gridRev) || 0 });
                }
              }
            }
          }
        } catch (chestLootErr) {
          console.error('[dungeon_chest_loot] Error:', chestLootErr.message);
        }

        var chestResultPayload = {
          x: x,
          y: y,
          tier: effectiveTier,
          originalTier: chest.tier !== effectiveTier ? chest.tier : undefined,
          gold: chestGold,
          resource: chestResource,
          resourceAmount: chestResourceAmt,
          hasCard: chestHasCard,
          xp: xpAmount,
          skillResult: xpResult,
          lootItems: chestLootItems.length > 0 ? chestLootItems : undefined,
        };
        if (chestQuestResult.completedQuests) {
          chestResultPayload.questsCompleted = chestQuestResult.completedQuests.map(function(q) { return q.name; });
        }
        if (chestBookId) {
          chestResultPayload.bookFound = chestBookId;
        }
        socket.emit('dungeon_chest_result', chestResultPayload);
      } catch (err) {
        console.error('[dungeon_open_chest] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_examine_corpse
    // ------------------------------------------------------------------
    socket.on('dungeon_examine_corpse', function(data) {
      try {
        if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return;
        if (!isFinite(data.x) || !isFinite(data.y)) return;
        if (!applyRateGrace(socket, 'dungeon_examine_corpse', 20, 2000)) return;

        var info = playerDungeons.get(socket.id);
        if (!info) return;

        var floor = getFloorForPlayer(socket.id);
        if (!floor) return;

        var x = Math.floor(data.x);
        var y = Math.floor(data.y);

        // Find corpse at x,y
        if (!floor.corpses || floor.corpses.length === 0) {
          socket.emit('dungeon_error', { message: 'No remains on this floor' });
          return;
        }
        var corpse = null;
        for (var ci = 0; ci < floor.corpses.length; ci++) {
          if (floor.corpses[ci].x === x && floor.corpses[ci].y === y) {
            corpse = floor.corpses[ci];
            break;
          }
        }

        if (!corpse) {
          socket.emit('dungeon_error', { message: 'No remains at that position' });
          return;
        }
        if (corpse.examined) {
          socket.emit('dungeon_error', { message: 'These remains have already been examined' });
          return;
        }

        // Proximity check
        var pos = state.playerPositions.get(socket.id);
        if (!pos) return;
        var ptx = Math.floor(pos.x / 32);
        var pty = Math.floor(pos.y / 32);
        if (Math.abs(ptx - x) > 1 || Math.abs(pty - y) > 1) {
          socket.emit('dungeon_error', { message: 'Too far from remains' });
          return;
        }

        // Mark examined and broadcast
        corpse.examined = true;
        var corpseZoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        io.to('zone:' + corpseZoneId).emit('dungeon_corpse_examined', {
          x: x, y: y, examinedBy: user.name,
        });

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        // Get dungeon skill bonuses
        var corpseCombat = getPlayerCombat(socket.id);
        var corpseSkillBonuses = (corpseCombat && corpseCombat.skillBonuses) ? corpseCombat.skillBonuses : null;

        // Award gold
        var corpseGold = corpse.gold || 0;
        var corpseAllGoldMult = (corpseSkillBonuses && corpseSkillBonuses.allGoldMult) ? corpseSkillBonuses.allGoldMult : 1;
        corpseGold = Math.floor(corpseGold * corpseAllGoldMult);
        if (corpseGold > 0) {
          accounts.updateChips(accKey, corpseGold);
        }

        // Award resource
        if (corpse.resource && corpse.resourceAmount > 0) {
          accounts.addResource(accKey, corpse.resource, corpse.resourceAmount);
        }

        // Card pack (low chance)
        if (corpse.hasCard) {
          accounts.addPendingPack(accKey, 1);
        }

        // Book drop — boosted by bookChanceMult
        var corpseBookId = null;
        try {
          var corpseFloorTheme = floor._theme || floor.theme || null;
          // Determine effective tier based on floor depth
          var corpseBookTier;
          if (info.floorNum >= 20) corpseBookTier = 'rare';
          else if (info.floorNum >= 10) corpseBookTier = 'uncommon';
          else corpseBookTier = 'common';
          // bookChanceMult > 1 upgrades tier for scholars/robed skeletons
          if (corpse.bookChanceMult >= 2.0 && corpseBookTier === 'common') {
            corpseBookTier = 'uncommon';
          }
          corpseBookId = loreBooks.rollBookDrop(corpseBookTier, info.floorNum, corpseFloorTheme, false);
          if (corpseBookId) {
            var corpseBookResult = knowledgeHandler.discoverBook(accounts, accKey, corpseBookId);
            if (corpseBookResult) {
              socket.emit('knowledge_book_discovered', {
                bookId: corpseBookResult.book.id, title: corpseBookResult.book.title,
                rarity: corpseBookResult.book.rarity, source: 'corpse',
              });
              for (var cbti = 0; cbti < corpseBookResult.unlockedTerms.length; cbti++) {
                socket.emit('knowledge_term_unlocked', corpseBookResult.unlockedTerms[cbti]);
              }
            }
          }
        } catch (corpseBookErr) {
          console.error('[dungeon_examine_corpse] Book drop error:', corpseBookErr.message);
        }

        // Award dungeon_delving xp
        var corpseBaseXp = 5 + info.floorNum;
        var corpseXpMult = (corpseSkillBonuses && corpseSkillBonuses.dungeonXpMult) ? corpseSkillBonuses.dungeonXpMult : 1;
        var corpseServerXpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : 1;
        var corpseCardXpBonus = (corpseCombat && corpseCombat.dungeonXpBonus) ? corpseCombat.dungeonXpBonus : 0;
        var corpseXpAmount = Math.floor(corpseBaseXp * corpseXpMult * corpseServerXpRate * (1 + corpseCardXpBonus));
        var corpseXpResult = accounts.addSkillXp(accKey, 'dungeon_delving', corpseXpAmount);

        var corpseResultPayload = {
          x: x,
          y: y,
          name: corpse.name,
          description: corpse.description,
          gold: corpseGold,
          resource: corpse.resource,
          resourceAmount: corpse.resourceAmount,
          hasCard: corpse.hasCard,
          xp: corpseXpAmount,
          skillResult: corpseXpResult,
        };
        if (corpseBookId) {
          corpseResultPayload.bookFound = corpseBookId;
        }
        socket.emit('dungeon_corpse_result', corpseResultPayload);
      } catch (err) {
        console.error('[dungeon_examine_corpse] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_harvest
    // ------------------------------------------------------------------
    socket.on('dungeon_harvest', function(data) {
      try {
        if (!data || typeof data.resourceId !== 'string') return;

        var info = playerDungeons.get(socket.id);
        if (!info) return;

        var floor = getFloorForPlayer(socket.id);
        if (!floor) return;

        // Dungeon floors don't have resource nodes by default, but special events
        // or future content can add them. For now, emit a generic result.
        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        // Award dungeon_dwelling xp for exploration (modified by delving XP mult + server xpRate)
        var harvestCombat = getPlayerCombat(socket.id);
        var harvestBonuses = (harvestCombat && harvestCombat.skillBonuses) ? harvestCombat.skillBonuses : null;
        var harvestXpMult = (harvestBonuses && harvestBonuses.dungeonXpMult) ? harvestBonuses.dungeonXpMult : 1;
        var harvestServerXpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : 1;
        var harvestXp = Math.floor(8 * harvestXpMult * harvestServerXpRate);
        var xpResult = accounts.addSkillXp(accKey, 'dungeon_dwelling', harvestXp);

        socket.emit('dungeon_harvest_result', {
          resourceId: data.resourceId,
          xp: harvestXp,
          skillResult: xpResult,
        });
      } catch (err) {
        console.error('[dungeon_harvest] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_interact_npc
    // ------------------------------------------------------------------
    socket.on('dungeon_interact_npc', function(data) {
      try {
        if (!data || typeof data.npcIndex !== 'number') return;
        if (!isFinite(data.npcIndex)) return;

        var info = playerDungeons.get(socket.id);
        if (!info) return;

        var floor = getFloorForPlayer(socket.id);
        if (!floor) return;

        var npcIndex = Math.floor(data.npcIndex);
        if (npcIndex < 0 || npcIndex >= floor.npcs.length) return;

        var npc = floor.npcs[npcIndex];
        if (npc.interacted) {
          socket.emit('dungeon_error', { message: 'You have already interacted with this NPC' });
          return;
        }

        // Proximity check
        var pos = state.playerPositions.get(socket.id);
        if (!pos) return;
        var ptx = Math.floor(pos.x / 32);
        var pty = Math.floor(pos.y / 32);
        if (Math.abs(ptx - npc.x) > 1 || Math.abs(pty - npc.y) > 1) {
          socket.emit('dungeon_error', { message: 'Too far from NPC' });
          return;
        }

        npc.interacted = true;

        // Broadcast NPC interaction to all players on floor
        var npcZoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        io.to('zone:' + npcZoneId).emit('dungeon_npc_interacted', {
          npcIndex: npcIndex, interactedBy: user.name,
        });

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        // Get dungeon skill bonuses for NPC rewards
        var npcCombat = getPlayerCombat(socket.id);
        var npcSkillBonuses = (npcCombat && npcCombat.skillBonuses) ? npcCombat.skillBonuses : null;
        var npcRewardMult = (npcSkillBonuses && npcSkillBonuses.npcRewardMult) ? npcSkillBonuses.npcRewardMult : 1;
        var npcAllGoldMult = (npcSkillBonuses && npcSkillBonuses.allGoldMult) ? npcSkillBonuses.allGoldMult : 1;

        var reward = npc.reward || {};
        var goldAwarded = 0;
        var xpAwarded = 0;

        // Apply reward (modified by dwelling Lv15 NPC bonus: +50%)
        if (reward.gold) {
          goldAwarded = Math.floor(reward.gold * npcRewardMult * npcAllGoldMult);
          accounts.updateChips(accKey, goldAwarded);
        }
        if (reward.xp) {
          xpAwarded = Math.floor(reward.xp * npcRewardMult);
        }

        // Sanctuary healing spring: heal player to full HP
        if (reward.healFull) {
          var healCombat = getPlayerCombat(socket.id);
          if (healCombat) {
            healCombat.hp = healCombat.maxHp;
            healCombat.mana = healCombat.maxMana;
          }
        }

        // Award dungeon_dwelling xp (modified by delving XP mult + server xpRate)
        var npcXpMult = (npcSkillBonuses && npcSkillBonuses.dungeonXpMult) ? npcSkillBonuses.dungeonXpMult : 1;
        var npcServerXpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : 1;
        var skillXp = Math.floor((15 + (xpAwarded || 0)) * npcXpMult * npcServerXpRate);
        var xpResult = accounts.addSkillXp(accKey, 'dungeon_dwelling', skillXp);

        // Quest progress: track NPC rescue
        var npcQuestResult = updateQuestProgress(accounts, accKey, 'npc_rescue', { npcId: npc.id });
        emitQuestUpdate(socket, accounts, accKey, npcQuestResult);

        var npcResultPayload = {
          npcIndex: npcIndex,
          npcName: npc.name,
          dialogue: npc.dialogue,
          reward: reward,
          goldAwarded: goldAwarded,
          xp: skillXp,
          skillResult: xpResult,
        };
        if (reward.healFull) {
          var healedCombat = getPlayerCombat(socket.id);
          npcResultPayload.healedFull = true;
          npcResultPayload.playerHp = healedCombat ? healedCombat.hp : null;
          npcResultPayload.playerMaxHp = healedCombat ? healedCombat.maxHp : null;
          npcResultPayload.playerMana = healedCombat ? healedCombat.mana : null;
          npcResultPayload.playerMaxMana = healedCombat ? healedCombat.maxMana : null;
        }
        if (npcQuestResult.completedQuests) {
          npcResultPayload.questsCompleted = npcQuestResult.completedQuests.map(function(q) { return q.name; });
        }
        socket.emit('dungeon_npc_result', npcResultPayload);
      } catch (err) {
        console.error('[dungeon_interact_npc] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_form_interact — interact with form-gated interactables
    // ------------------------------------------------------------------
    socket.on('dungeon_form_interact', function(data) {
      try {
        if (!data || typeof data.interactableId !== 'string') return;

        var info = playerDungeons.get(socket.id);
        if (!info) return;

        var floor = getFloorForPlayer(socket.id);
        if (!floor) return;
        if (!floor.formInteractables || floor.formInteractables.length === 0) {
          socket.emit('dungeon_error', { message: 'No interactables on this floor' });
          return;
        }

        // Find the interactable
        var interactable = null;
        var interactableIndex = -1;
        for (var fi = 0; fi < floor.formInteractables.length; fi++) {
          if (floor.formInteractables[fi].id === data.interactableId) {
            interactable = floor.formInteractables[fi];
            interactableIndex = fi;
            break;
          }
        }
        if (!interactable) {
          socket.emit('dungeon_error', { message: 'Interactable not found' });
          return;
        }
        if (interactable.explored) {
          socket.emit('dungeon_error', { message: 'This passage has already been opened' });
          return;
        }

        // Proximity check (must be adjacent, 1 tile)
        var pos = state.playerPositions.get(socket.id);
        if (!pos) return;
        var ptx = Math.floor(pos.x / 32);
        var pty = Math.floor(pos.y / 32);
        if (Math.abs(ptx - interactable.x) > 1 || Math.abs(pty - interactable.y) > 1) {
          socket.emit('dungeon_error', { message: 'Too far from interactable' });
          return;
        }

        // Check player abilities
        var explorationData = getPlayerExplorationAbilities(socket.id, accounts, socketAccountMap);
        var hasRequired = explorationData.abilities[interactable.requiredAbility] || false;
        var hasAlternate = interactable.alternateAbility ? (explorationData.abilities[interactable.alternateAbility] || false) : false;

        if (!hasRequired && !hasAlternate) {
          // Tell the player what they need
          var abilityName = interactable.requiredAbility;
          var hintMsg = 'You lack the ability to interact with this. ';
          if (abilityName === 'canBreakWalls') hintMsg += 'You need to be in bear form to break this wall.';
          else if (abilityName === 'canFitSmallHoles') hintMsg += 'You need a small form like rat, cat, or serpent to fit through.';
          else if (abilityName === 'canCrawlUnderDoors') hintMsg += 'You need a small form like rat or spider to crawl under.';
          else if (abilityName === 'canFly') hintMsg += 'You need a flying form like bat, eagle, or owl.';
          else if (abilityName === 'canSwimDeep') hintMsg += 'You need an aquatic form like fish or turtle.';
          else if (abilityName === 'canAccessVents') hintMsg += 'You need a small form like rat or spider to access vents.';
          else if (abilityName === 'canDig') hintMsg += 'You need a digging form like wolf or hound.';
          else if (abilityName === 'canPushBoulders') hintMsg += 'You need the strength of bear form to push this.';
          else if (abilityName === 'canBurrow') hintMsg += 'You need serpent form to burrow through.';
          else if (abilityName === 'canClimbWalls') hintMsg += 'You need cat or spider form to climb.';
          else hintMsg += 'Equip an animal form card with the right ability.';

          socket.emit('dungeon_form_interact_result', {
            success: false,
            interactableId: interactable.id,
            message: hintMsg,
          });
          return;
        }

        // Success — mark as explored
        interactable.explored = true;

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        var resultPayload = {
          success: true,
          interactableId: interactable.id,
          type: interactable.type,
          result: interactable.result,
          usedAbility: hasRequired ? interactable.requiredAbility : interactable.alternateAbility,
          formUsed: explorationData.formName,
        };

        // Generate rewards based on result type
        if (interactable.result === 'passage' || interactable.result === 'underground_passage') {
          // Open a new walkable tile adjacent to the interactable
          // Find a wall tile adjacent to the interactable and convert it to floor
          var directions = [
            { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
            { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
          ];
          var revealedTiles = [];
          for (var di = 0; di < directions.length; di++) {
            var nx = interactable.x + directions[di].dx;
            var ny = interactable.y + directions[di].dy;
            if (nx >= 0 && nx < floor.width && ny >= 0 && ny < floor.height) {
              if (floor.grid[ny][nx] === TILE.WALL) {
                floor.grid[ny][nx] = TILE.FLOOR;
                revealedTiles.push({ x: nx, y: ny });
                break; // Only open one passage tile
              }
            }
          }
          resultPayload.revealedTiles = revealedTiles;
          resultPayload.message = 'The ' + interactable.name.toLowerCase() + ' gives way, revealing a hidden passage!';
        } else if (interactable.result === 'treasure_room') {
          // Generate bonus treasure: extra gold + resource + chance at card
          var bonusGold = 30 + Math.floor(Math.random() * 50);
          var bonusResources = ['mana_crystal', 'gem_cut', 'gem_rough', 'dark_crystal'];
          var bonusResource = bonusResources[Math.floor(Math.random() * bonusResources.length)];
          var bonusAmount = 1 + Math.floor(Math.random() * 3);
          var bonusCard = Math.random() < 0.25; // 25% chance at card pack

          accounts.updateChips(accKey, bonusGold);
          accounts.addResource(accKey, bonusResource, bonusAmount);

          resultPayload.message = 'You discovered a hidden treasure room!';
          resultPayload.loot = {
            gold: bonusGold,
            resource: bonusResource,
            resourceAmount: bonusAmount,
            hasCard: bonusCard,
          };

          if (bonusCard) {
            // Grant a card pack
            var acc = accounts.loadAccount(accKey);
            if (acc) {
              if (!acc.pendingPacks) acc.pendingPacks = 0;
              acc.pendingPacks += 1;
              accounts.saveAccount(acc);
              resultPayload.loot.cardPackAwarded = true;
            }
          }

          // Also open a passage tile
          var treasureDirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
          var treasureRevealed = [];
          for (var ti = 0; ti < treasureDirs.length; ti++) {
            var tx = interactable.x + treasureDirs[ti].dx;
            var ty = interactable.y + treasureDirs[ti].dy;
            if (tx >= 0 && tx < floor.width && ty >= 0 && ty < floor.height) {
              if (floor.grid[ty][tx] === TILE.WALL) {
                floor.grid[ty][tx] = TILE.FLOOR;
                treasureRevealed.push({ x: tx, y: ty });
                break;
              }
            }
          }
          resultPayload.revealedTiles = treasureRevealed;
        } else if (interactable.result === 'underwater_passage') {
          // Teleport player to a random distant room on the same floor
          var targetRoomIdx = 1 + Math.floor(Math.random() * (floor.rooms.length - 1));
          if (targetRoomIdx >= floor.rooms.length) targetRoomIdx = floor.rooms.length - 1;
          var targetRoom = floor.rooms[targetRoomIdx];
          var teleX = targetRoom.centerX;
          var teleY = targetRoom.centerY;

          state.updatePlayerPosition(socket.id, teleX * 32, teleY * 32, 'down');
          resultPayload.message = 'You dive through an underwater passage and emerge in a distant chamber!';
          resultPayload.teleport = { x: teleX, y: teleY };
        }

        // Award exploration XP
        var expXp = 20 + Math.floor(floor.floorNum * 5);
        var serverXpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : 1;
        var skillXpResult = accounts.addSkillXp(accKey, 'dungeon_dwelling', Math.floor(expXp * serverXpRate));
        resultPayload.xp = Math.floor(expXp * serverXpRate);
        resultPayload.skillResult = skillXpResult;

        socket.emit('dungeon_form_interact_result', resultPayload);

        // Broadcast to other players on the floor
        var formZoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        socket.to('zone:' + formZoneId).emit('dungeon_form_interactable_explored', {
          interactableId: interactable.id,
          exploredBy: user.name,
          revealedTiles: resultPayload.revealedTiles || [],
        });

      } catch (err) {
        console.error('[dungeon_form_interact] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_interact_animal — interact with animal NPCs using animal form
    // ------------------------------------------------------------------
    socket.on('dungeon_interact_animal', function(data) {
      try {
        if (!data || typeof data.animalId !== 'string') return;

        var info = playerDungeons.get(socket.id);
        if (!info) return;

        var floor = getFloorForPlayer(socket.id);
        if (!floor) return;
        if (!floor.animalNpcs || floor.animalNpcs.length === 0) {
          socket.emit('dungeon_error', { message: 'No animals on this floor' });
          return;
        }

        // Find the animal NPC
        var animal = null;
        for (var ai = 0; ai < floor.animalNpcs.length; ai++) {
          if (floor.animalNpcs[ai].id === data.animalId) {
            animal = floor.animalNpcs[ai];
            break;
          }
        }
        if (!animal) {
          socket.emit('dungeon_error', { message: 'Animal not found' });
          return;
        }
        if (animal.interacted) {
          socket.emit('dungeon_error', { message: 'You have already spoken with this animal' });
          return;
        }

        // Proximity check
        var pos = state.playerPositions.get(socket.id);
        if (!pos) return;
        var ptx = Math.floor(pos.x / 32);
        var pty = Math.floor(pos.y / 32);
        if (Math.abs(ptx - animal.x) > 1 || Math.abs(pty - animal.y) > 1) {
          socket.emit('dungeon_error', { message: 'Too far from animal' });
          return;
        }

        // Check if player can speak to this animal
        var explorationData = getPlayerExplorationAbilities(socket.id, accounts, socketAccountMap);
        var speakCategories = animal.speakCategories || [];
        var canSpeak = false;

        if (speakCategories.length === 0) {
          // Animals with no speak categories (rat, monkey, deer, etc.) can be spoken to by any animal form
          canSpeak = !!explorationData.formName;
        } else {
          // Check if any of the player's canAnimalSpeak categories match
          for (var sci = 0; sci < speakCategories.length; sci++) {
            if (explorationData.canSpeakTo.indexOf(speakCategories[sci]) !== -1) {
              canSpeak = true;
              break;
            }
          }
        }

        var resultPayload = {
          animalId: animal.id,
          animalType: animal.animalType,
          animalName: animal.name,
        };

        if (!explorationData.formName) {
          // Not in any animal form — animal flees
          animal.interacted = true;
          resultPayload.success = false;
          resultPayload.reaction = 'flee';
          resultPayload.message = 'The ' + animal.name.toLowerCase() + ' eyes you warily and scurries away. You need to be in an animal form to communicate.';
          socket.emit('dungeon_animal_interact_result', resultPayload);

          var fleeZoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
          io.to('zone:' + fleeZoneId).emit('dungeon_animal_fled', {
            animalId: animal.id,
            fledFrom: user.name,
          });
          return;
        }

        if (!canSpeak) {
          // Wrong animal form — animal is neutral but gives no info
          resultPayload.success = false;
          resultPayload.reaction = 'neutral';
          resultPayload.message = 'The ' + animal.name.toLowerCase() + ' regards you curiously, but you cannot understand each other. Try a different animal form.';
          socket.emit('dungeon_animal_interact_result', resultPayload);
          return;
        }

        // Success — animal shares information
        animal.interacted = true;

        var dialogue = animal.dialogue || { greeting: 'The creature acknowledges you.', hint: '' };

        // Build useful hint based on floor state
        var floorHints = [];
        // Hint about nearby traps
        if (floor.traps) {
          for (var thi = 0; thi < floor.traps.length; thi++) {
            if (!floor.traps[thi].triggered) {
              floorHints.push('trap_nearby');
              break;
            }
          }
        }
        // Hint about unopened chests
        if (floor.chests) {
          for (var chi = 0; chi < floor.chests.length; chi++) {
            if (!floor.chests[chi].opened) {
              floorHints.push('chest_nearby');
              break;
            }
          }
        }
        // Hint about form interactables
        if (floor.formInteractables) {
          for (var fhi = 0; fhi < floor.formInteractables.length; fhi++) {
            if (!floor.formInteractables[fhi].explored) {
              floorHints.push('hidden_passage');
              break;
            }
          }
        }

        resultPayload.success = true;
        resultPayload.reaction = 'friendly';
        resultPayload.greeting = dialogue.greeting;
        resultPayload.hint = dialogue.hint;
        resultPayload.formUsed = explorationData.formName;
        resultPayload.floorHints = floorHints;

        // Small buff: +5% damage for 120 seconds (animal blessing)
        var animalCombat = getPlayerCombat(socket.id);
        if (animalCombat) {
          if (!animalCombat.activeBuffs) animalCombat.activeBuffs = [];
          var buffDuration = 120000; // 2 minutes
          animalCombat.activeBuffs.push({
            name: 'Animal Kinship',
            source: animal.animalType,
            expiresAt: Date.now() + buffDuration,
            effect: { atkBoost: 2 },
          });
          applyShrineBuff(animalCombat, { atkBoost: 2 }, false);
          resultPayload.buffApplied = { name: 'Animal Kinship', duration: buffDuration / 1000, effect: '+2 attack' };
        }

        // Award small XP
        var accKey = socketAccountMap.get(socket.id);
        if (accKey) {
          var animalXp = 10 + Math.floor(floor.floorNum * 2);
          var aServerXpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : 1;
          var animalXpResult = accounts.addSkillXp(accKey, 'dungeon_dwelling', Math.floor(animalXp * aServerXpRate));
          resultPayload.xp = Math.floor(animalXp * aServerXpRate);
          resultPayload.skillResult = animalXpResult;
        }

        socket.emit('dungeon_animal_interact_result', resultPayload);

        // Broadcast
        var animalZoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        io.to('zone:' + animalZoneId).emit('dungeon_animal_interacted', {
          animalId: animal.id,
          interactedBy: user.name,
        });

      } catch (err) {
        console.error('[dungeon_interact_animal] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_camp_place
    // ------------------------------------------------------------------
    socket.on('dungeon_camp_place', function(data) {
      try {
        if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return;
        if (!isFinite(data.x) || !isFinite(data.y)) return;

        var info = playerDungeons.get(socket.id);
        if (!info) {
          socket.emit('dungeon_error', { message: 'You are not in a dungeon' });
          return;
        }

        // Rift only
        if (info.dungeonId !== 'rift') {
          socket.emit('dungeon_error', { message: 'Camps can only be placed in rift dungeons' });
          return;
        }

        var floor = getFloorForPlayer(socket.id);
        if (!floor) return;

        var x = Math.floor(data.x);
        var y = Math.floor(data.y);

        // Bounds check
        if (x < 0 || x >= floor.width || y < 0 || y >= floor.height) return;
        if (!floor.grid || !floor.grid[y]) return;

        // Must be a FLOOR tile
        if (floor.grid[y][x] !== TILE.FLOOR) {
          socket.emit('dungeon_error', { message: 'Camp can only be placed on open floor tiles' });
          return;
        }

        // Check max camps per floor
        if (!floor.camps) floor.camps = [];
        if (floor.camps.length >= CAMP_CONFIG.maxCampsPerFloor) {
          socket.emit('dungeon_error', { message: 'Maximum camps reached on this floor' });
          return;
        }

        // Check not adjacent to enemy
        for (var ei = 0; ei < floor.enemies.length; ei++) {
          var enemy = floor.enemies[ei];
          if (enemy.alive === false) continue;
          if (Math.abs(enemy.x - x) <= 1 && Math.abs(enemy.y - y) <= 1) {
            socket.emit('dungeon_error', { message: 'Cannot place camp near enemies' });
            return;
          }
        }

        var camp = {
          x: x,
          y: y,
          ownerId: socket.id,
          ownerName: user.name,
          campfire: false,
          sharedChest: [],
          notes: '',
          shrine: false,
          createdAt: Date.now(),
        };

        floor.camps.push(camp);

        var zoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        io.to('zone:' + zoneId).emit('dungeon_camp_placed', camp);
      } catch (err) {
        console.error('[dungeon_camp_place] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_camp_action
    // ------------------------------------------------------------------
    socket.on('dungeon_camp_action', function(data) {
      try {
        if (!data || typeof data.action !== 'string') return;

        var info = playerDungeons.get(socket.id);
        if (!info) return;

        var floor = getFloorForPlayer(socket.id);
        if (!floor || !floor.camps || floor.camps.length === 0) {
          socket.emit('dungeon_error', { message: 'No camps on this floor' });
          return;
        }

        // Find nearest camp to player
        var pos = state.playerPositions.get(socket.id);
        if (!pos) return;
        var ptx = Math.floor(pos.x / 32);
        var pty = Math.floor(pos.y / 32);

        var camp = null;
        for (var ci = 0; ci < floor.camps.length; ci++) {
          var c = floor.camps[ci];
          if (Math.abs(c.x - ptx) <= CAMP_CONFIG.campRadius && Math.abs(c.y - pty) <= CAMP_CONFIG.campRadius) {
            camp = c;
            break;
          }
        }

        if (!camp) {
          socket.emit('dungeon_error', { message: 'You are not near a camp' });
          return;
        }

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        var action = data.action;
        var result = { action: action, success: false };

        if (action === 'light_campfire') {
          camp.campfire = true;
          result.success = true;
          result.message = 'Campfire lit. You can now cook.';

          // Add campfire as light source and invalidate light map
          var campZoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
          if (!floorLightSources.has(campZoneId)) floorLightSources.set(campZoneId, []);
          floorLightSources.get(campZoneId).push(dungeonVision.createCampfireLight(camp.x, camp.y));
          invalidateLightMap(campZoneId);

        } else if (action === 'cook') {
          if (!camp.campfire) {
            socket.emit('dungeon_error', { message: 'Light the campfire first' });
            return;
          }
          if (!data.data || typeof data.data.recipe !== 'string') {
            socket.emit('dungeon_error', { message: 'Specify a recipe' });
            return;
          }
          var recipeId = data.data.recipe;
          var recipe = null;
          for (var ri = 0; ri < CAMP_CONFIG.campfireCookRecipes.length; ri++) {
            if (CAMP_CONFIG.campfireCookRecipes[ri].id === recipeId) {
              recipe = CAMP_CONFIG.campfireCookRecipes[ri];
              break;
            }
          }
          if (!recipe) {
            socket.emit('dungeon_error', { message: 'Unknown recipe' });
            return;
          }
          // Check ingredients
          var inv = accounts.getMMOInventory(accKey);
          if (!inv) {
            socket.emit('dungeon_error', { message: 'Inventory not found' });
            return;
          }
          var ingredientCounts = {};
          for (var ii = 0; ii < recipe.input.length; ii++) {
            var ing = recipe.input[ii];
            ingredientCounts[ing] = (ingredientCounts[ing] || 0) + 1;
          }
          var ingredientKeys = Object.keys(ingredientCounts);
          for (var ik = 0; ik < ingredientKeys.length; ik++) {
            var ingKey = ingredientKeys[ik];
            if ((inv[ingKey] || 0) < ingredientCounts[ingKey]) {
              socket.emit('dungeon_error', { message: 'Not enough ' + ingKey.replace(/_/g, ' ') });
              return;
            }
          }
          // Consume ingredients
          for (var dk = 0; dk < ingredientKeys.length; dk++) {
            accounts.removeResource(accKey, ingredientKeys[dk], ingredientCounts[ingredientKeys[dk]]);
          }
          // Apply cooking heal to server-side HP (dwelling skill: campHealMult)
          var cookCombat = getPlayerCombat(socket.id);
          var cookBonuses = (cookCombat && cookCombat.skillBonuses) ? cookCombat.skillBonuses : null;
          var cookHeal = recipe.healAmount || 0;
          // Dwelling Lv10: +25% cooking heal (campHealMult covers rest at 1.5;
          // we use a separate 1.25 factor for cooking to match perk description)
          if (cookBonuses && cookBonuses.campHealMult > 1) {
            var cookFactor = 1 + (cookBonuses.campHealMult - 1) * 0.5; // 1.5 -> 1.25
            cookHeal = Math.floor(cookHeal * cookFactor);
          }
          if (cookCombat && cookHeal > 0) {
            cookCombat.hp = Math.min(cookCombat.maxHp, cookCombat.hp + cookHeal);
            result.playerHp = cookCombat.hp;
            result.playerMaxHp = cookCombat.maxHp;
          }
          // Award cooking XP (apply server xpRate)
          var cookServerXpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : 1;
          var cookXpAmount = Math.floor((8 + (cookHeal > 0 ? Math.floor(cookHeal / 5) : 0)) * cookServerXpRate);
          var cookXpResult = accounts.addSkillXp(accKey, 'cooking', cookXpAmount);
          result.success = true;
          result.output = recipe.output;
          result.healAmount = cookHeal;
          result.message = 'Cooked ' + recipe.output.replace(/_/g, ' ') + '! Heals ' + cookHeal + ' HP.';
          result.skillXp = cookXpResult ? { skill: 'cooking', xp: cookXpAmount, result: cookXpResult } : null;

        } else if (action === 'rest') {
          // Apply healing to server-side HP (dwelling skill bonuses apply)
          var restCombat = getPlayerCombat(socket.id);
          var restBonuses = (restCombat && restCombat.skillBonuses) ? restCombat.skillBonuses : null;
          var baseRestHeal = 15;
          var healAmount = baseRestHeal;

          // Dwelling Lv50: camp rest heals to full HP
          if (restBonuses && restBonuses.campFullHeal && restCombat) {
            healAmount = restCombat.maxHp - restCombat.hp;
          } else {
            // Dwelling Lv10: campHealMult (1.5x rest heal)
            if (restBonuses && restBonuses.campHealMult > 1) {
              healAmount = Math.floor(baseRestHeal * restBonuses.campHealMult);
            }
          }

          if (restCombat) {
            healAmount = Math.min(healAmount, restCombat.maxHp - restCombat.hp);
            restCombat.hp += healAmount;
            result.playerHp = restCombat.hp;
            result.playerMaxHp = restCombat.maxHp;
          }
          result.success = true;
          result.healAmount = healAmount;
          result.message = 'You rest at the campfire and recover ' + healAmount + ' HP.';

          // Check ambush chance on rest (reduced by dwelling Lv10 ambushChanceReduction)
          var ambushChance = CAMP_CONFIG.ambushChance;
          if (restBonuses && restBonuses.ambushChanceReduction > 0) {
            ambushChance = ambushChance * (1 - restBonuses.ambushChanceReduction);
          }
          if (Math.random() < ambushChance) {
            result.ambushed = true;
            result.message += ' But enemies have spotted the light!';
          }

        } else if (action === 'note') {
          if (!data.data || typeof data.data.text !== 'string') {
            socket.emit('dungeon_error', { message: 'Specify note text' });
            return;
          }
          camp.notes = data.data.text.slice(0, 200);
          result.success = true;
          result.message = 'Note left at camp.';

        } else if (action === 'use_shrine') {
          var shrineCombat = getPlayerCombat(socket.id);
          var shrineBonuses = (shrineCombat && shrineCombat.skillBonuses) ? shrineCombat.skillBonuses : null;
          var hasFreeShrine = shrineBonuses && shrineBonuses.campFreeShrine;

          if (camp.shrine && !hasFreeShrine) {
            socket.emit('dungeon_error', { message: 'Shrine already used at this camp' });
            return;
          }
          var buffs = CAMP_CONFIG.shrineBuffs;
          var buff = buffs[Math.floor(Math.random() * buffs.length)];
          // Dwelling Lv50: shrine always available; mark used only for non-perk players
          if (!hasFreeShrine) {
            camp.shrine = true;
          }

          // Apply the shrine buff to combat state
          if (shrineCombat && buff.effect) {
            applyShrineBuff(shrineCombat, buff.effect, false);
            // Initialize activeBuffs array if needed
            if (!shrineCombat.activeBuffs) shrineCombat.activeBuffs = [];
            shrineCombat.activeBuffs.push({
              id: buff.id,
              name: buff.name,
              effect: buff.effect,
              expiresAt: Date.now() + (buff.duration || 120) * 1000,
            });
          }

          result.success = true;
          result.buff = buff;
          result.message = 'Received ' + buff.name + ' for ' + buff.duration + ' seconds.';

        } else {
          socket.emit('dungeon_error', { message: 'Unknown camp action' });
          return;
        }

        socket.emit('dungeon_camp_result', result);
      } catch (err) {
        console.error('[dungeon_camp_action] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_use_torch — consume torch from inventory, set hasTorch=true
    // ------------------------------------------------------------------
    socket.on('dungeon_use_torch', function() {
      try {

        var info = playerDungeons.get(socket.id);
        if (!info) return;

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        var inv = accounts.getMMOInventory(accKey);
        if (!inv || (inv.torch || 0) < 1) {
          socket.emit('dungeon_error', { message: 'No torches in inventory' });
          return;
        }

        accounts.removeResource(accKey, 'torch', 1);

        var zoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        var torchExpiry = Date.now() + TORCH_DURATION * 1000;
        var pMap = floorPlayers.get(zoneId);
        if (pMap) {
          var fp = pMap.get(socket.id);
          if (fp) {
            fp.hasTorch = true;
            fp.torchExpiry = torchExpiry;
          }
        }

        // Recompute visibility with torch light
        var floor = getFloorForPlayer(socket.id);
        if (floor) {
          var visResult = recomputePlayerVisibility(zoneId, socket.id, floor);
          if (visResult && visResult.delta) {
            socket.emit('dungeon_visibility_update', visResult.delta);
          }
        }

        socket.emit('dungeon_torch_active', {
          active: true,
          duration: TORCH_DURATION,
          expiresAt: torchExpiry,
        });
      } catch (err) {
        console.error('[dungeon_use_torch] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_place_torch — place static light source on current tile
    // ------------------------------------------------------------------
    socket.on('dungeon_place_torch', function() {
      try {

        var info = playerDungeons.get(socket.id);
        if (!info) return;

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        var inv = accounts.getMMOInventory(accKey);
        if (!inv || (inv.torch || 0) < 1) {
          socket.emit('dungeon_error', { message: 'No torches in inventory' });
          return;
        }

        accounts.removeResource(accKey, 'torch', 1);

        var pos = state.playerPositions.get(socket.id);
        if (!pos) return;
        var ptx = Math.floor(pos.x / 32);
        var pty = Math.floor(pos.y / 32);

        var zoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        if (!floorLightSources.has(zoneId)) floorLightSources.set(zoneId, []);
        var torchLight = dungeonVision.createTorchLight(ptx, pty);
        torchLight.expiry = Date.now() + TORCH_DURATION * 1000;
        floorLightSources.get(zoneId).push(torchLight);
        invalidateLightMap(zoneId);

        // Broadcast placed torch visual to all on floor
        io.to('zone:' + zoneId).emit('dungeon_torch_placed', {
          x: ptx, y: pty, placedBy: user.name,
          duration: TORCH_DURATION,
        });

        // Recompute visibility for all players on floor since light changed
        var floor = getFloorForPlayer(socket.id);
        if (floor) {
          var pMap = floorPlayers.get(zoneId);
          if (pMap) {
            pMap.forEach(function(pd, sid) {
              var visResult = recomputePlayerVisibility(zoneId, sid, floor);
              if (visResult && visResult.delta) {
                _io.to(sid).emit('dungeon_visibility_update', visResult.delta);
              }
            });
          }
        }
      } catch (err) {
        console.error('[dungeon_place_torch] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_use_lantern — consume lantern from inventory
    // ------------------------------------------------------------------
    socket.on('dungeon_use_lantern', function() {
      try {

        var info = playerDungeons.get(socket.id);
        if (!info) return;

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        var inv = accounts.getMMOInventory(accKey);
        if (!inv || (inv.lantern || 0) < 1) {
          socket.emit('dungeon_error', { message: 'No lantern in inventory' });
          return;
        }

        accounts.removeResource(accKey, 'lantern', 1);

        var zoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        var lanternExpiry = Date.now() + LANTERN_DURATION * 1000;
        var pMap = floorPlayers.get(zoneId);
        if (pMap) {
          var fp = pMap.get(socket.id);
          if (fp) {
            fp.hasLantern = true;
            fp.lanternExpiry = lanternExpiry;
          }
        }

        var floor = getFloorForPlayer(socket.id);
        if (floor) {
          var visResult = recomputePlayerVisibility(zoneId, socket.id, floor);
          if (visResult && visResult.delta) {
            socket.emit('dungeon_visibility_update', visResult.delta);
          }
        }

        socket.emit('dungeon_lantern_active', {
          active: true,
          duration: LANTERN_DURATION,
          expiresAt: lanternExpiry,
        });
      } catch (err) {
        console.error('[dungeon_use_lantern] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_toggle_vision — cycle or set active vision type
    // ------------------------------------------------------------------
    socket.on('dungeon_toggle_vision', function(data) {
      try {
        var info = playerDungeons.get(socket.id);
        if (!info) return;

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        var acc = accounts.loadAccount(accKey);
        if (!acc) return;

        // Collect equipped card effects to determine available vision types
        var cardEffects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(accKey) : [];
        var availableVisions = rpgData.getAvailableVisionTypes(acc.race, cardEffects);

        var requestedVision = (data && typeof data.visionType === 'string') ? data.visionType : null;

        var newVision;
        if (requestedVision) {
          // Specific vision requested — validate access
          if (availableVisions.indexOf(requestedVision) < 0) {
            socket.emit('dungeon_error', { message: 'You do not have access to ' + requestedVision + ' vision.' });
            return;
          }
          newVision = requestedVision;
        } else {
          // Cycle to next available vision type
          var zoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
          var pMap = floorPlayers.get(zoneId);
          var currentVision = 'normal';
          if (pMap) {
            var fp = pMap.get(socket.id);
            if (fp) currentVision = fp.visionType || 'normal';
          }
          var idx = availableVisions.indexOf(currentVision);
          if (idx < 0) idx = 0;
          newVision = availableVisions[(idx + 1) % availableVisions.length];
        }

        // Mana check for non-normal vision types
        var visionDef = rpgData.VISION_TYPES[newVision];
        if (visionDef && visionDef.manaCostPerTurn > 0 && newVision !== 'normal') {
          var combat = getPlayerCombat(socket.id);
          if (combat && combat.mana < visionDef.manaCostPerTurn) {
            socket.emit('dungeon_error', { message: 'Not enough mana to activate ' + (visionDef.name || newVision) + '.' });
            return;
          }
        }

        // Apply vision change to floor player tracking
        var vZoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        var vPMap = floorPlayers.get(vZoneId);
        if (vPMap) {
          var vFp = vPMap.get(socket.id);
          if (vFp) {
            vFp.visionType = newVision;
            // Tremor vision type grants full tremor sense (overrides racial if stronger)
            if (newVision === 'tremor') {
              if (!vFp.tremorRange || vFp.tremorRange === 'short') {
                vFp.tremorRange = 'full';
              }
            } else {
              // Restore racial tremor sense if any
              var raceData = rpgData.RACES[acc.race];
              vFp.tremorRange = null;
              if (raceData && raceData.racialFeat && raceData.racialFeat.effects) {
                for (var tri = 0; tri < raceData.racialFeat.effects.length; tri++) {
                  if (raceData.racialFeat.effects[tri].type === 'tremor_sense') {
                    vFp.tremorRange = raceData.racialFeat.effects[tri].range || 'short';
                  }
                }
              }
            }
          }
        }

        // Recompute visibility with new vision type
        var floor = getFloorForPlayer(socket.id);
        if (floor) {
          var visResult = recomputePlayerVisibility(vZoneId, socket.id, floor);
          if (visResult && visResult.delta) {
            socket.emit('dungeon_visibility_update', visResult.delta);
          }
        }

        // Send vision state update to client
        socket.emit('dungeon_vision_changed', {
          visionType: newVision,
          availableVisions: availableVisions,
          manaCostPerTurn: (visionDef && visionDef.manaCostPerTurn) || 0,
        });

      } catch (err) {
        console.error('[dungeon_toggle_vision] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_use_weapon_special — use equipped weapon's special ability
    // ------------------------------------------------------------------
    socket.on('dungeon_use_weapon_special', function(data) {
      try {
        var info = playerDungeons.get(socket.id);
        if (!info || !info.floor) {
          socket.emit('dungeon_error', { message: 'Not in a dungeon.' });
          return;
        }
        // Weapon specials are handled through the tactical combat system
        // via tc_combat_action with action='ability'. This stub prevents
        // silent failure on the client side.
        socket.emit('dungeon_error', { message: 'Use abilities through combat (equip a weapon card).' });
      } catch (err) {
        console.error('[dungeon_use_weapon_special] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // dungeon_use_inscription — activate an inscription slot
    // ------------------------------------------------------------------
    socket.on('dungeon_use_inscription', function(data) {
      try {
        var info = playerDungeons.get(socket.id);
        if (!info || !info.floor) {
          socket.emit('dungeon_error', { message: 'Not in a dungeon.' });
          return;
        }
        // Inscriptions are a future system — acknowledge but inform
        socket.emit('dungeon_error', { message: 'Inscription system not yet available.' });
      } catch (err) {
        console.error('[dungeon_use_inscription] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // dungeon_chat — proximity dungeon chat with sound propagation
    // ------------------------------------------------------------------
    socket.on('dungeon_chat', function(data) {
      try {
        if (!data || typeof data.message !== 'string') return;
        if (!applyRateGrace(socket, 'dungeon_chat', 40, 5000)) return;

        var info = playerDungeons.get(socket.id);
        if (!info) return;

        var floor = getFloorForPlayer(socket.id);
        if (!floor) return;

        var pos = state.playerPositions.get(socket.id);
        if (!pos) return;
        var ptx = Math.floor(pos.x / 32);
        var pty = Math.floor(pos.y / 32);

        var msg = data.message.slice(0, 200);
        var isShout = data.shout === true;

        // Inject noise event (chat or shout)
        addNoiseEvent(floor, isShout ? 'shout' : 'chat', ptx, pty, 0);

        // BFS-propagated proximity chat: send to players within sound range
        var soundType = isShout ? dungeonAI.SOUND_TYPES.shout : dungeonAI.SOUND_TYPES.chat;
        var reachMap = dungeonAI.propagateSound(floor.grid, ptx, pty, soundType.radius, floor.width, floor.height);

        var zoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        var pMap = floorPlayers.get(zoneId);
        if (pMap) {
          pMap.forEach(function(pd, sid) {
            var pKey = pd.x + ',' + pd.y;
            if (reachMap.has(pKey) || sid === socket.id) {
              _io.to(sid).emit('dungeon_chat_message', {
                senderId: socket.id,
                senderName: user.name,
                message: msg,
                isShout: isShout,
              });
            }
          });
        }
      } catch (err) {
        console.error('[dungeon_chat] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // dungeon_guild_signup
    // ------------------------------------------------------------------
    socket.on('dungeon_guild_signup', function() {
      try {

        var currentZone = state.playerZones.get(socket.id);
        if (currentZone !== 'starter_town' && currentZone !== 'rift_antechamber' && currentZone !== 'adventure_guild') {
          socket.emit('dungeon_error', { message: 'You must be in the Adventure Guild to sign up' });
          return;
        }

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) {
          socket.emit('dungeon_error', { message: 'No account linked' });
          return;
        }

        var acc = accounts.loadAccount(accKey);
        if (!acc) {
          socket.emit('dungeon_error', { message: 'Account not found' });
          return;
        }

        var dp = ensureDungeonProgress(acc);
        if (dp.guildMember) {
          socket.emit('dungeon_guild_result', { success: true, message: 'You are already a guild member', alreadyMember: true });
          return;
        }

        dp.guildMember = true;
        safeSaveAccount(accounts, acc, 'guild_signup');

        socket.emit('dungeon_guild_result', {
          success: true,
          message: 'Welcome to the Dungeon Guild! You may now enter the Rift.',
          guildRank: dp.guildRank,
          guildXp: dp.guildXp,
        });
      } catch (err) {
        console.error('[dungeon_guild_signup] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_quest_list
    // ------------------------------------------------------------------
    socket.on('dungeon_quest_list', function() {
      try {

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        var acc = accounts.loadAccount(accKey);
        if (!acc) return;

        var dp = ensureDungeonProgress(acc);
        var today = getTodayString();

        // Reset quests if date changed
        if (dp.lastQuestDate !== today) {
          dp.dailyQuests = {};
          dp.lastQuestDate = today;
          var quests = dungeonData.generateDailyQuests(today);
          for (var qi = 0; qi < quests.length; qi++) {
            dp.dailyQuests[quests[qi].id] = quests[qi];
          }
          safeSaveAccount(accounts, acc, 'quest_list_init');
        }

        // Build quest list with completion status and target info
        var questList = [];
        var questIds = Object.keys(dp.dailyQuests);
        for (var i = 0; i < questIds.length; i++) {
          var q = dp.dailyQuests[questIds[i]];
          questList.push({
            id: q.id,
            name: q.name,
            description: q.description,
            type: q.type,
            xpReward: q.xpReward,
            goldReward: q.goldReward,
            progress: q.progress || 0,
            targetCount: q.targetCount || null,
            targetFloor: q.targetFloor || null,
            targetTime: q.targetTime || null,
            completed: q.completed || false,
            turnedIn: q.turnedIn || false,
          });
        }

        socket.emit('dungeon_quest_list_result', {
          quests: questList,
          guildRank: dp.guildRank,
          guildXp: dp.guildXp,
        });
      } catch (err) {
        console.error('[dungeon_quest_list] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_quest_complete
    // ------------------------------------------------------------------
    socket.on('dungeon_quest_complete', function(data) {
      try {
        if (!data || typeof data.questId !== 'string') return;

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        var acc = accounts.loadAccount(accKey);
        if (!acc) return;

        var dp = ensureDungeonProgress(acc);
        var quest = dp.dailyQuests[data.questId];
        if (!quest) {
          socket.emit('dungeon_error', { message: 'Quest not found' });
          return;
        }
        if (!quest.completed) {
          socket.emit('dungeon_error', { message: 'Quest is not yet completed' });
          return;
        }
        if (quest.turnedIn) {
          socket.emit('dungeon_error', { message: 'Quest already turned in' });
          return;
        }

        quest.turnedIn = true;

        // Award quest rewards (apply server xpRate)
        if (quest.xpReward) {
          var questServerXpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : 1;
          accounts.addSkillXp(accKey, 'dungeon_delving', Math.floor(quest.xpReward * questServerXpRate));
        }
        if (quest.goldReward) {
          accounts.updateChips(accKey, quest.goldReward);
        }

        // Add guild XP
        var guildXpGain = Math.floor((quest.xpReward || 0) * 0.5);
        dp.guildXp = (dp.guildXp || 0) + guildXpGain;

        // Check guild rank promotion
        var newRank = getGuildRank(dp.guildXp);
        var promoted = newRank.name.toLowerCase() !== dp.guildRank;
        dp.guildRank = newRank.name.toLowerCase();

        // Award karma and faction rep for quest completion
        karma.addKarma(acc, 2, 'quest_complete');
        factions.addRep(acc, 'adventure_guild', 100);

        safeSaveAccount(accounts, acc, 'quest_complete');

        socket.emit('dungeon_quest_complete_result', {
          questId: data.questId,
          xpRewarded: quest.xpReward,
          goldRewarded: quest.goldReward,
          guildXpGain: guildXpGain,
          guildXp: dp.guildXp,
          guildRank: dp.guildRank,
          promoted: promoted,
        });
      } catch (err) {
        console.error('[dungeon_quest_complete] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_leaderboard
    // ------------------------------------------------------------------
    socket.on('dungeon_leaderboard', function() {
      try {

        socket.emit('dungeon_leaderboard_result', {
          deepestFloor: leaderboard.deepestFloor.slice(0, 20),
          mostKills: leaderboard.mostKills.slice(0, 20),
          fastestBoss: leaderboard.fastestBoss.slice(0, 20),
        });
      } catch (err) {
        console.error('[dungeon_leaderboard] Error:', err.message);
        socket.emit('dungeon_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // dungeon_get_combat_state: request current HP/mana/stamina
    // ------------------------------------------------------------------
    socket.on('dungeon_get_combat_state', function() {
      var combat = getPlayerCombat(socket.id);
      if (!combat) {
        socket.emit('dungeon_error', { message: 'Not in a dungeon' });
        return;
      }
      socket.emit('dungeon_combat_state', {
        hp: combat.hp,
        maxHp: combat.maxHp,
        mana: combat.mana,
        maxMana: combat.maxMana,
        stamina: combat.stamina,
        maxStamina: combat.maxStamina,
      });
    });

    // ------------------------------------------------------------------
    // Disconnect cleanup
    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // Revive downed player (permadeath party mechanic)
    // ------------------------------------------------------------------
    socket.on('revive_player', function(data) {
      if (!data || typeof data.targetSocketId !== 'string') return;
      var result = reviveDownedPlayer(socket, data.targetSocketId, io, state, accounts);
      if (result.error) {
        socket.emit('dungeon_error', { message: result.error });
      }
    });

    socket.on('disconnect', function() {
      // Downed while disconnecting: give 30s grace period before triggering permadeath
      var downedInfo = downedPlayers.get(socket.id);
      if (downedInfo) {
        clearInterval(downedInfo.intervalId);
        downedPlayers.delete(socket.id);
        var dcAccKey = socketAccountMap.get(socket.id);
        var dcInfo = playerDungeons.get(socket.id);
        if (dcAccKey && dcInfo) {
          // Cancel any existing grace timer for this account (shouldn't happen, but safe)
          var existingGrace = downedDisconnectTimers.get(dcAccKey);
          if (existingGrace) { clearTimeout(existingGrace.timer); }
          var _dcAccKey = dcAccKey;
          var _dcInfo = dcInfo;
          var _dcCause = downedInfo.causeOfDeath || 'Disconnected while downed';
          var graceTimer = setTimeout(function() {
            downedDisconnectTimers.delete(_dcAccKey);
            triggerPermadeath(null, io, state, accounts, _dcAccKey, _dcInfo, _dcCause);
          }, 30000);
          if (graceTimer && graceTimer.unref) graceTimer.unref();
          downedDisconnectTimers.set(dcAccKey, { timer: graceTimer, dcInfo: _dcInfo, causeOfDeath: _dcCause });
        }
      }

      // Save safe location so player doesn't get stuck on reconnect
      var info = playerDungeons.get(socket.id);
      if (info) {
        var accKey = socketAccountMap.get(socket.id);
        if (accKey) {
          accounts.setLastLocation(accKey, 'starter_town', 800, 400);
        }
      }
      // Clean up overworld structure player tracking
      if (info && info.dungeonId && info.dungeonId.indexOf('camp_') === 0) {
        var dcCampId = info.structureId || info.dungeonId.slice(5);
        overworldStructures.removePlayer(dcCampId, socket.id);
      }
      // Clean up mini-rift player tracking
      if (info && info.dungeonId && info.dungeonId.indexOf('minirift_') === 0) {
        var dcRiftId = info.riftId || info.dungeonId.slice(9);
        overworldRifts.removePlayer(dcRiftId, socket.id);
      }
      // Clean up turn-based overworld mode
      if (info) {
        var dcZoneId = getZoneIdForDungeon(info.dungeonId, info.floorNum);
        cleanupTurnMode(socket.id, dcZoneId);
      }
      removePlayerFromFloor(socket.id);
      playerDungeons.delete(socket.id);
      playerTransitioning.delete(socket.id);
      // Director: clean up metrics
      if (_directorMetrics) _directorMetrics.removePlayer(socket.id);
    });
  },
};

// ---------------------------------------------------------------------------
// Leaderboard update (module-level helper)
// ---------------------------------------------------------------------------

function updateLeaderboardEntry(accKey, playerName, dp) {
  // Update deepest floor
  var found = false;
  for (var i = 0; i < leaderboard.deepestFloor.length; i++) {
    if (leaderboard.deepestFloor[i].accKey === accKey) {
      leaderboard.deepestFloor[i].floor = dp.deepestFloor;
      leaderboard.deepestFloor[i].name = playerName;
      found = true;
      break;
    }
  }
  if (!found) {
    leaderboard.deepestFloor.push({ accKey: accKey, name: playerName, floor: dp.deepestFloor });
  }
  leaderboard.deepestFloor.sort(function(a, b) { return b.floor - a.floor; });
  if (leaderboard.deepestFloor.length > 50) leaderboard.deepestFloor.length = 50;

  // Update most kills
  var foundKills = false;
  for (var k = 0; k < leaderboard.mostKills.length; k++) {
    if (leaderboard.mostKills[k].accKey === accKey) {
      leaderboard.mostKills[k].kills = dp.totalKills;
      leaderboard.mostKills[k].name = playerName;
      foundKills = true;
      break;
    }
  }
  if (!foundKills) {
    leaderboard.mostKills.push({ accKey: accKey, name: playerName, kills: dp.totalKills });
  }
  leaderboard.mostKills.sort(function(a, b) { return b.kills - a.kills; });
  if (leaderboard.mostKills.length > 50) leaderboard.mostKills.length = 50;
  _saveLeaderboard();
}
