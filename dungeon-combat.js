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

// ---------------------------------------------------------------------------
// Walkable tile set (mirrors dungeon.js — kept in sync here for grid queries)
// ---------------------------------------------------------------------------

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
var EXHAUSTION_START        = 12;   // Turn number after which exhaustion begins
var EXHAUSTION_START_BOSS   = 20;   // Extended exhaustion start for boss/leviathan fights
var EXHAUSTION_PER_TURN     = 5;    // Damage multiplier per turn past threshold
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
// Combat passive helpers
// ---------------------------------------------------------------------------

/**
 * Get the first combatPassive of a given type from a unit's equipped cards.
 * Returns the combatPassive object or null.
 */
function getUnitCombatPassive(unit, passiveType) {
  if (!unit || !unit.equippedCards) return null;
  for (var i = 0; i < unit.equippedCards.length; i++) {
    var card = unit.equippedCards[i];
    if (card && card.combatPassive && card.combatPassive.type === passiveType) {
      return card.combatPassive;
    }
  }
  return null;
}

/**
 * Sum the values of ALL combatPassives of a given type from a unit's equipped cards.
 * Use for stackable passives (e.g. multiple lifesteal cards).
 * Returns 0 if none found.
 */
function getUnitCombatPassiveTotal(unit, passiveType) {
  if (!unit || !unit.equippedCards) return 0;
  var total = 0;
  for (var i = 0; i < unit.equippedCards.length; i++) {
    var card = unit.equippedCards[i];
    if (card && card.combatPassive && card.combatPassive.type === passiveType) {
      total += (card.combatPassive.value || 0);
    }
  }
  return total;
}

/**
 * Check if a unit has a specific immunity via combatPassive.
 * Returns true if the unit has an immunity passive matching the given element.
 */
function hasImmunity(unit, element) {
  if (!unit || !unit.equippedCards) return false;
  for (var i = 0; i < unit.equippedCards.length; i++) {
    var card = unit.equippedCards[i];
    if (card && card.combatPassive && card.combatPassive.type === 'immunity' && card.combatPassive.element === element) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a unit has CC immunity for a given CC effect name.
 * Matches against cc_immunity combatPassive ccType field.
 * ccType values: 'stun', 'root_slow', 'knockback'
 * effectName values: 'stunned', 'rooted', 'slowed', 'knockdown', etc.
 * Returns true if the unit is immune to the given CC.
 */
function hasCCImmunity(unit, effectName) {
  if (!unit || !unit.equippedCards) return false;
  for (var i = 0; i < unit.equippedCards.length; i++) {
    var card = unit.equippedCards[i];
    if (!card || !card.combatPassive || card.combatPassive.type !== 'cc_immunity') continue;
    var ccType = card.combatPassive.ccType;
    if (ccType === 'stun' && (effectName === 'stunned' || effectName === 'knockdown')) return true;
    if (ccType === 'root_slow' && (effectName === 'rooted' || effectName === 'slowed' || effectName === 'root' || effectName === 'slow')) return true;
    if (ccType === 'knockback' && (effectName === 'knockdown' || effectName === 'knocked' || effectName === 'knockback')) return true;
  }
  // Also check active buff-granted ccImmune
  if (unit.statusEffects) {
    for (var j = 0; j < unit.statusEffects.length; j++) {
      if (unit.statusEffects[j].ccImmune) return true;
    }
  }
  return false;
}

/**
 * Get the sum of a specific effect type from a unit's card effects (non-combatPassive).
 * Used for dodge_bonus, crit_bonus, counter_chance_bonus, etc. from card effects arrays.
 */
function getCardEffectTotal(unit, effectType) {
  if (!unit || !unit.equippedCards) return 0;
  var total = 0;
  for (var i = 0; i < unit.equippedCards.length; i++) {
    var card = unit.equippedCards[i];
    if (!card || !card.effects || !Array.isArray(card.effects)) continue;
    for (var j = 0; j < card.effects.length; j++) {
      var eff = card.effects[j];
      if (eff.type === effectType) {
        total += (eff.value || 0);
      }
    }
  }
  return total;
}

/**
 * Collect all on_hit affixes from a unit's equipped cards.
 * Returns array of affix effect objects (each has .id, .label, .tier, .cat, .effect).
 */
function getUnitOnHitAffixes(unit) {
  if (!unit || !unit.equippedCards) return [];
  var affixes = [];
  for (var i = 0; i < unit.equippedCards.length; i++) {
    var card = unit.equippedCards[i];
    if (!card || !card.affixes || !Array.isArray(card.affixes)) continue;
    for (var j = 0; j < card.affixes.length; j++) {
      var aff = card.affixes[j];
      if (aff && aff.cat === 'on_hit') {
        affixes.push(aff);
      }
    }
  }
  return affixes;
}

// ---------------------------------------------------------------------------
// Module-level combat storage
// ---------------------------------------------------------------------------

var activeCombats = new Map(); // combatId -> combat object

// Reverse lookup: socketId -> combatId (for fast lookup on player actions)
var socketToCombat = new Map();

// ---------------------------------------------------------------------------
// MMO-inspired card effect tracking (module-level, keyed by combatId or unitId)
// ---------------------------------------------------------------------------

// Hot Streak: track consecutive crit count per unit. Map<unitId, number>
var _hotStreakCounts = new Map();

// Combo Chains: track combo state per unit. Map<unitId, { lastCombo: string, turnUsed: number }>
var _comboState = new Map();

// Clone/Illusion: track active clones per unit. Map<unitId, Array<{ cloneId, hp, damage }>>
var _playerClones = new Map();

// Totem/Ground Zone: tracked per combat in combat.groundZones array (initialized in initCombat)

// Lily of the Field: track lily tokens per unit. Map<unitId, number>
var _lilyTokens = new Map();

// Soul Shards: track shards per unit. Map<unitId, number>
var _soulShards = new Map();

// Dance Partner: track bonded partner per unit. Map<unitId, partnerUnitId>
var _dancePartners = new Map();

// Stagger DoTs: track stagger DoT per unit. Map<unitId, { remaining: number, tickDamage: number }>
var _staggerDoTs = new Map();

// Death Shroud: track shroud HP pool per unit. Map<unitId, number>
var _deathShrouds = new Map();

// Soulstone: track pre-cast revive per unit. Map<unitId, { sourceId: string, turnsLeft: number }>
var _soulstones = new Map();

// Intercept: track damage redirect per unit. Map<unitId, { protectorId: string, turnsLeft: number }>
var _intercepts = new Map();

// Innervate: track mana-per-turn buff per unit. Map<unitId, { sourceId: string, turnsLeft: number, manaPerTurn: number }>
var _innervates = new Map();

// Fade: track aggro drop per unit. Map<unitId, number> (turns remaining)
var _fadeActive = new Map();

// Divine Invulnerability: track invulnerability per unit. Map<unitId, number> (turns remaining)
var _divineInvulnerability = new Map();

// ---------------------------------------------------------------------------
// Combat grid helpers
// ---------------------------------------------------------------------------

/**
 * Check if a tile is walkable for combat movement.
 * Uses the floor grid and the combat units map to block occupied tiles.
 */
function isWalkableCombat(grid, x, y, width, height, units) {
  if (x < 0 || x >= width || y < 0 || y >= height) return false;
  var tile = grid[y][x];
  if (!WALKABLE_TILES[tile]) return false;
  // Check if any alive unit occupies this tile
  if (units) {
    var iter = units.values();
    var entry = iter.next();
    while (!entry.done) {
      var u = entry.value;
      if (u.alive && u.x === x && u.y === y) return false;
      entry = iter.next();
    }
  }
  return true;
}

/**
 * Check if tile is walkable, excluding a specific unit (the one moving).
 */
function isWalkableExcluding(grid, x, y, width, height, units, excludeId) {
  if (x < 0 || x >= width || y < 0 || y >= height) return false;
  var tile = grid[y][x];
  if (!WALKABLE_TILES[tile]) return false;
  if (units) {
    var iter = units.values();
    var entry = iter.next();
    while (!entry.done) {
      var u = entry.value;
      if (u.alive && u.id !== excludeId && u.x === x && u.y === y) return false;
      entry = iter.next();
    }
  }
  return true;
}

/**
 * Get 4-directional adjacent tiles (cardinal only for movement).
 */
function getAdjacentTiles(x, y, width, height) {
  var result = [];
  if (x > 0)            result.push({ x: x - 1, y: y });
  if (x < width - 1)    result.push({ x: x + 1, y: y });
  if (y > 0)            result.push({ x: x, y: y - 1 });
  if (y < height - 1)   result.push({ x: x, y: y + 1 });
  return result;
}

/**
 * Get all 8-directional neighbors (for attack range / adjacency).
 */
function get8Neighbors(x, y, width, height) {
  var result = [];
  for (var dx = -1; dx <= 1; dx++) {
    for (var dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      var nx = x + dx;
      var ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        result.push({ x: nx, y: ny });
      }
    }
  }
  return result;
}

function manhattanDist(x1, y1, x2, y2) {
  return Math.abs(x2 - x1) + Math.abs(y2 - y1);
}

/**
 * Chebyshev distance — for diagonal adjacency (melee range).
 * Two tiles are adjacent if chebyshev distance <= 1.
 */
function chebyshevDist(x1, y1, x2, y2) {
  return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
}

/**
 * Check if two positions are adjacent (including diagonals).
 */
function isAdjacent(x1, y1, x2, y2) {
  return chebyshevDist(x1, y1, x2, y2) === 1;
}

/**
 * Euclidean distance (for ranged weapon range checks).
 */
function euclideanDist(x1, y1, x2, y2) {
  var dx = x2 - x1;
  var dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// BFS movement range calculation
// ---------------------------------------------------------------------------

/**
 * BFS flood fill from a starting position, limited by maxMP movement points.
 * Movement is 4-directional (cardinal). Walls and occupied tiles block movement.
 *
 * @param {Object} combat   - combat instance (for tile effect cost modifiers)
 * @param {Array} grid      - floor.grid[y][x] tile values
 * @param {number} startX   - unit's current X
 * @param {number} startY   - unit's current Y
 * @param {number} maxMP    - maximum movement points
 * @param {Map} units       - combat units map (for occupied tile checks)
 * @param {number} width    - floor width
 * @param {number} height   - floor height
 * @param {string} unitId   - the moving unit's ID (excluded from occupancy checks)
 * @returns {Object} costMap - { "x,y": cost } for all reachable tiles
 */
function bfsMovementRange(combat, grid, startX, startY, maxMP, units, width, height, unitId) {
  var costMap = {};
  var startKey = startX + ',' + startY;
  costMap[startKey] = 0;

  // BFS queue: each entry is { x, y, cost }
  var queue = [{ x: startX, y: startY, cost: 0 }];
  var head = 0;

  while (head < queue.length) {
    var curr = queue[head++];
    if (curr.cost >= maxMP) continue;

    var neighbors = getAdjacentTiles(curr.x, curr.y, width, height);
    for (var i = 0; i < neighbors.length; i++) {
      var n = neighbors[i];
      var nKey = n.x + ',' + n.y;

      // Calculate movement cost including tile effect modifier
      var extraCost = combatTiles.getMoveCostModifier(combat, n.x, n.y);
      var newCost = curr.cost + 1 + extraCost;

      // Skip if already visited with equal or lower cost
      if (costMap[nKey] !== undefined && costMap[nKey] <= newCost) continue;

      // Check walkability (exclude the moving unit from occupancy)
      if (!isWalkableExcluding(grid, n.x, n.y, width, height, units, unitId)) continue;

      costMap[nKey] = newCost;
      queue.push({ x: n.x, y: n.y, cost: newCost });
    }
  }

  return costMap;
}

/**
 * Reconstruct a BFS shortest path from the costMap.
 * Traces back from target to start by following decreasing costs.
 *
 * @returns {Array|null} path as [{x,y}, ...] from start to target (inclusive), or null if unreachable
 */
function bfsPath(combat, grid, startX, startY, targetX, targetY, maxMP, units, width, height, unitId) {
  // Run BFS to get cost map
  var costMap = bfsMovementRange(combat, grid, startX, startY, maxMP, units, width, height, unitId);
  var targetKey = targetX + ',' + targetY;
  if (costMap[targetKey] === undefined) return null;

  // Trace back from target to start
  var path = [];
  var cx = targetX;
  var cy = targetY;
  var currentCost = costMap[targetKey];

  while (cx !== startX || cy !== startY) {
    path.push({ x: cx, y: cy });
    var neighbors = getAdjacentTiles(cx, cy, width, height);
    var foundPrev = false;
    var bestNeighborCost = currentCost;
    var bestNx = cx;
    var bestNy = cy;
    for (var i = 0; i < neighbors.length; i++) {
      var n = neighbors[i];
      var nKey = n.x + ',' + n.y;
      if (costMap[nKey] !== undefined && costMap[nKey] < bestNeighborCost) {
        bestNeighborCost = costMap[nKey];
        bestNx = n.x;
        bestNy = n.y;
        foundPrev = true;
      }
    }
    if (!foundPrev) return null; // Should never happen with valid costMap
    cx = bestNx;
    cy = bestNy;
    currentCost = bestNeighborCost;
  }

  path.push({ x: startX, y: startY });
  path.reverse();
  return path;
}

// ---------------------------------------------------------------------------
// Calculate movement range (public API)
// ---------------------------------------------------------------------------

/**
 * Calculate all tiles a unit can move to.
 * Returns an array of {x, y, cost} entries.
 */
function calculateMoveRange(combat, unitId) {
  var unit = combat.units.get(unitId);
  if (!unit || !unit.alive) return [];

  var floor = combat.floor;
  var costMap = bfsMovementRange(
    combat, floor.grid, unit.x, unit.y, unit.mp,
    combat.units, floor.width, floor.height, unitId
  );

  var result = [];
  var keys = Object.keys(costMap);
  for (var i = 0; i < keys.length; i++) {
    var parts = keys[i].split(',');
    var tx = parseInt(parts[0], 10);
    var ty = parseInt(parts[1], 10);
    // Exclude the unit's current position from the move range
    if (tx === unit.x && ty === unit.y) continue;
    result.push({ x: tx, y: ty, cost: costMap[keys[i]] });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validate and execute movement
// ---------------------------------------------------------------------------

/**
 * Validate a proposed move for a unit.
 * Returns { valid, path, cost } or { valid: false, reason }.
 */
function validateMove(combat, unitId, targetX, targetY) {
  var unit = combat.units.get(unitId);
  if (!unit || !unit.alive) {
    return { valid: false, reason: 'Unit is dead or does not exist' };
  }
  if (unit.mp <= 0) {
    return { valid: false, reason: 'No movement points remaining' };
  }
  if (targetX === unit.x && targetY === unit.y) {
    return { valid: false, reason: 'Already at target position' };
  }

  var floor = combat.floor;

  // Check bounds
  if (targetX < 0 || targetX >= floor.width || targetY < 0 || targetY >= floor.height) {
    return { valid: false, reason: 'Target out of bounds' };
  }

  // Run BFS to find shortest path
  var path = bfsPath(
    combat, floor.grid, unit.x, unit.y, targetX, targetY,
    unit.mp, combat.units, floor.width, floor.height, unitId
  );

  if (!path) {
    return { valid: false, reason: 'No valid path to target' };
  }

  // Path includes start tile; cost is path length minus 1
  var cost = path.length - 1;
  if (cost > unit.mp) {
    return { valid: false, reason: 'Not enough MP to reach target' };
  }

  return { valid: true, path: path, cost: cost };
}

/**
 * Execute movement along a validated path.
 * Handles MP deduction, momentum shield, and opportunity attacks.
 * Returns the movement result with events that occurred.
 */
function executeMove(combat, unitId, path) {
  var unit = combat.units.get(unitId);
  if (!unit || !unit.alive) return { success: false, reason: 'Unit unavailable' };

  // --- Animal Form: Turtle cannot move ---
  if (unit.activeAnimalForm === 'turtle') {
    return { success: false, reason: 'Cannot move while in Turtle Form (defensive only)', tilesMoved: 0, events: [] };
  }

  // --- Buff: cantMove — e.g. Absolute Guard prevents movement ---
  // --- Debuff: rooted — e.g. death_grip root prevents movement ---
  if (unit.statusEffects) {
    for (var cmvI = 0; cmvI < unit.statusEffects.length; cmvI++) {
      if (unit.statusEffects[cmvI].cantMove && unit.statusEffects[cmvI].type === 'buff') {
        return { success: false, reason: 'Cannot move while ' + (unit.statusEffects[cmvI].name || 'ability') + ' is active', tilesMoved: 0, events: [] };
      }
      if (unit.statusEffects[cmvI].name === 'rooted' && unit.statusEffects[cmvI].type === 'debuff') {
        return { success: false, reason: 'You are rooted in place!', tilesMoved: 0, events: [] };
      }
    }
  }

  var floor = combat.floor;
  var events = [];
  var tilesMoved = 0;

  // Walk path tile by tile (skip index 0 which is the starting position)
  var moveResult = { success: true, tilesMoved: 0, events: events, died: false };
  for (var step = 1; step < path.length; step++) {
    var tile = path[step];

    // Double-check tile is still valid (a simultaneous action may have changed things)
    if (!isWalkableExcluding(floor.grid, tile.x, tile.y, floor.width, floor.height, combat.units, unitId)) {
      events.push({ type: 'move_blocked', x: tile.x, y: tile.y, step: step });
      break;
    }

    // Check sync opportunity attacks from the PREVIOUS position
    var oldX = unit.x;
    var oldY = unit.y;
    var newX = tile.x;
    var newY = tile.y;
    var oppResults = combatSync.checkOpportunityAttack(combat, unit.id, oldX, oldY, newX, newY);
    for (var oi = 0; oi < oppResults.length; oi++) {
      var oppHit = oppResults[oi];
      unit.hp -= oppHit.damage;
      if (unit.hp <= 0) {
        unit.alive = false;
        unit.hp = 0;
      }
      if (!moveResult.events) moveResult.events = [];
      moveResult.events.push({ type: 'opportunity_attack', attackerId: oppHit.unitId, damage: oppHit.damage, isCrit: oppHit.isCrit });
    }
    if (!unit.alive) {
      moveResult.tilesMoved = tilesMoved;
      moveResult.died = true;
      break; // Stop moving, unit died
    }

    // Move to this tile
    unit.x = tile.x;
    unit.y = tile.y;
    tilesMoved++;
    unit.mp--;

    // Step damage: entering a hazardous tile deals damage immediately
    var tileEffect = combatTiles.getTileEffectAt(combat, unit.x, unit.y);
    if (tileEffect) {
      var tileEffects = Array.isArray(tileEffect) ? tileEffect : [tileEffect];
      for (var tei = 0; tei < tileEffects.length; tei++) {
        var te = tileEffects[tei];
        var teDef = combatTiles.TILE_EFFECTS[te.type];
        if (teDef && teDef.damage && teDef.damage > 0) {
          unit.hp -= teDef.damage;
          if (unit.hp <= 0) {
            unit.alive = false;
            unit.hp = 0;
          }
          if (!moveResult.events) moveResult.events = [];
          moveResult.events.push({ type: 'step_damage', tileType: te.type, damage: teDef.damage, unitHp: Math.max(0, unit.hp) });
        }
      }
    }
    if (!unit.alive) {
      moveResult.tilesMoved = tilesMoved;
      moveResult.died = true;
      break; // Unit died from tile damage
    }

    if (unit.mp <= 0) break;
  }

  // --- Night Hunter Passive: relentless_pursuit — free attack of opportunity when enemy disengages ---
  if (tilesMoved > 0 && unit.type === 'enemy' && unit.alive) {
    var rpStartX = path[0] ? path[0].x : unit.x;
    var rpStartY = path[0] ? path[0].y : unit.y;
    // Check all player units adjacent to the STARTING position
    var rpIter = combat.units.values();
    var rpEntry = rpIter.next();
    while (!rpEntry.done) {
      var rpUnit = rpEntry.value;
      rpEntry = rpIter.next();
      if (rpUnit.type === 'player' && rpUnit.alive && rpUnit.id !== unitId) {
        var rpPassive = getUnitCombatPassive(rpUnit, 'relentless_pursuit');
        if (rpPassive && rpPassive.attackOnFlee) {
          var rpDistBefore = chebyshevDist(rpStartX, rpStartY, rpUnit.x, rpUnit.y);
          var rpDistAfter = chebyshevDist(unit.x, unit.y, rpUnit.x, rpUnit.y);
          // Trigger if the enemy was adjacent before but moved away
          if (rpDistBefore <= 1.5 && rpDistAfter > 1.5) {
            // Free attack of opportunity from the player
            var rpAtkDmg = ((rpUnit.combat && rpUnit.combat.might) || 5) * 2 +
                           ((rpUnit.combat && rpUnit.combat.weaponDamage) || 0);
            rpAtkDmg = Math.max(1, Math.floor(rpAtkDmg * 0.75)); // 75% of normal damage for opportunity attack
            unit.hp -= rpAtkDmg;
            if (unit.hp <= 0) { unit.alive = false; unit.hp = 0; }
            if (!moveResult.events) moveResult.events = [];
            moveResult.events.push({
              type: 'opportunity_attack', attackerId: rpUnit.id, damage: rpAtkDmg,
              passive: 'relentless_pursuit',
            });
            if (!unit.alive) {
              handleUnitDeath(combat, unitId, rpUnit.id);
              moveResult.died = true;
            }
          }
        }
      }
    }
  }

  // Apply momentum shield: 1 damage absorbed per tile moved
  if (tilesMoved > 0) {
    applyMomentumShield(unit, tilesMoved);
    // Track movement for fortress passive (stationary armor bonus)
    unit._movedThisTurn = true;
  }

  moveResult.tilesMoved = tilesMoved;
  return moveResult;
}

/**
 * Check if any enemy unit gets an opportunity attack as a unit passes through a tile.
 * Opportunity attacks only trigger from enemies of the opposite type.
 */
function checkOpportunityAttacks(combat, movingUnit, tileX, tileY) {
  var events = [];
  var iter = combat.units.values();
  var entry = iter.next();

  while (!entry.done) {
    var other = entry.value;
    entry = iter.next();

    // Only enemies can opportunity attack players, and vice versa
    if (other.type === movingUnit.type) continue;
    if (!other.alive) continue;
    if (other.rp <= 0) continue; // No reaction points left

    // Must be adjacent to the tile the unit is moving through
    if (!isAdjacent(other.x, other.y, tileX, tileY)) continue;

    // Also must have been adjacent to the unit's previous position
    // (opportunity attacks trigger when leaving an enemy's threatened zone)
    if (!isAdjacent(other.x, other.y, movingUnit.x, movingUnit.y)) continue;

    // Execute opportunity attack (simplified: half damage, no crit)
    var oppDmg = calculateOpportunityDamage(combat, other, movingUnit);
    var absorbed = 0;

    // Momentum shield absorbs first
    if (movingUnit.momentumShield > 0) {
      absorbed = Math.min(movingUnit.momentumShield, oppDmg);
      movingUnit.momentumShield -= absorbed;
      oppDmg -= absorbed;
    }

    if (oppDmg > 0) {
      movingUnit.hp -= oppDmg;
    }

    other.rp--;

    var died = movingUnit.hp <= 0;
    if (died) {
      movingUnit.alive = false;
      movingUnit.hp = 0;
    }

    events.push({
      type: 'opportunity_attack',
      attackerId: other.id,
      attackerName: other.name,
      targetId: movingUnit.id,
      damage: oppDmg + absorbed,
      shieldAbsorbed: absorbed,
      actualDamage: oppDmg,
      targetHp: Math.max(0, movingUnit.hp),
      targetDied: died,
    });

    if (died) break;
  }

  return events;
}

/**
 * Calculate opportunity attack damage (simplified: ~50% of normal, no crit).
 */
function calculateOpportunityDamage(combat, attacker, target) {
  if (attacker.type === 'enemy') {
    // Enemy attacking player — 50% of normal, uses percentage armor model
    var armor = (target.combat && target.combat.baseArmor) ? target.combat.baseArmor : 0;
    var armorReduction = armor / (armor + 50);
    var oaDmg = Math.max(1, Math.floor((attacker.combat.atk || 0) * 0.5 * (1 - armorReduction)));
    // Card: elemental_resist_all — reduce elemental opportunity attacks
    if (target.type === 'player' && target.combat && target.combat.elementalResistAll > 0 && attacker.combat && attacker.combat.element) {
      oaDmg = Math.max(1, Math.floor(oaDmg * (1 - target.combat.elementalResistAll)));
    }
    // Card: low_hp_damage_reduction — reduce damage when below 30% HP
    if (target.type === 'player' && target.combat && target.combat.lowHpDmgReduction > 0) {
      var oaHpPct = target.hp / (target.maxHp || 1);
      if (oaHpPct < 0.30) {
        oaDmg = Math.max(1, Math.floor(oaDmg * (1 - target.combat.lowHpDmgReduction)));
      }
    }
    return oaDmg;
  } else {
    // Player attacking enemy — 50% of normal, uses percentage armor model
    var stats = attacker.combat || {};
    var baseAtk = ((stats.might || 5) * 2) + ((attacker.level || 1) * 1.5) + (stats.weaponDamage || 0);
    var targetDef = (target.combat && target.combat.def) || 0;
    var defReduction = targetDef / (targetDef + 50);
    return Math.max(1, Math.floor(baseAtk * (stats.meleeDmgMult || 1) * 0.5 * (1 - defReduction)));
  }
}

// ---------------------------------------------------------------------------
// Momentum shield
// ---------------------------------------------------------------------------

function applyMomentumShield(unit, tilesMoved) {
  unit.momentumShield = tilesMoved;
}

// ---------------------------------------------------------------------------
// Damage calculation
// ---------------------------------------------------------------------------

/**
 * Calculate damage from attacker to target.
 * Players use the RPG formula: baseAtk = (might*2) + (level*1.5) + weaponDamage;
 *                               damage = max(1, floor(baseAtk * meleeDmgMult - targetDef))
 * Enemies use simplified: damage = max(1, floor(enemy.atk - playerArmor))
 *
 * Returns { baseDamage, isCrit, finalDamage, dodged, blocked }
 */
function calculateDamage(attacker, target) {
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
    if (aqAdaptBasic && combat._isWaterFloor) {
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
  var dmgResult = calculateDamage(attacker, target);

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

// ---------------------------------------------------------------------------
// Group scaling — difficulty adjustment for all party sizes
// ---------------------------------------------------------------------------

/**
 * Count alive players in a combat instance.
 */
function countAlivePlayers(combat) {
  var count = 0;
  var iter = combat.units.values();
  var entry = iter.next();
  while (!entry.done) {
    if (entry.value.type === 'player' && entry.value.alive) count++;
    entry = iter.next();
  }
  return count;
}

/**
 * Apply stat scaling to all existing enemies based on player count.
 * Solo/duo/trio get weaker enemies, 4 = baseline, 5+ = rally (stronger enemies + reinforcements).
 * Also applies offline mode bonus if server is in offline mode.
 * Called once at combat start (after all units are added) and when a player joins mid-combat.
 */
function applyGroupScaling(combat) {
  var playerCount = countAlivePlayers(combat);
  var isOffline = process.env.OFFLINE_MODE === '1';

  if (playerCount === 1) {
    combat.groupScaling = { hpMult: SOLO_HP_SCALE, atkMult: SOLO_ATK_SCALE, tier: 'solo' };
  } else if (playerCount === 2) {
    combat.groupScaling = { hpMult: DUO_HP_SCALE, atkMult: DUO_ATK_SCALE, tier: 'duo' };
  } else if (playerCount === 3) {
    combat.groupScaling = { hpMult: TRIO_HP_SCALE, atkMult: TRIO_ATK_SCALE, tier: 'trio' };
  } else if (playerCount === 4) {
    combat.groupScaling = { hpMult: 1.0, atkMult: 1.0, tier: 'party' };
  } else {
    // 5+ players: existing rally scaling
    var extraPlayers = playerCount - 4;
    combat.groupScaling = {
      hpMult: 1 + extraPlayers * RALLY_STAT_SCALE_PER_PLAYER,
      atkMult: 1 + extraPlayers * RALLY_STAT_SCALE_PER_PLAYER,
      tier: 'rally',
    };
    combat.rallyScaling = {
      playerCount: playerCount,
      hpMult: combat.groupScaling.hpMult,
      atkMult: combat.groupScaling.atkMult,
      reinforceRate: Math.ceil(extraPlayers / 4), // 1-3 enemies per wave
      lastReinforceAt: 0,
    };
  }

  // Apply offline bonus (stacks with group scaling)
  if (isOffline) {
    combat.groupScaling.hpMult *= OFFLINE_STAT_SCALE;
    combat.groupScaling.atkMult *= OFFLINE_STAT_SCALE;
    combat.groupScaling.offlineMode = true;
  }

  // Clear rally scaling for sub-5 groups
  if (playerCount < RALLY_PLAYER_THRESHOLD) {
    combat.rallyScaling = null;
  }

  // Apply scaling to all enemies (from base stats to prevent stacking on re-call)
  var eIter = combat.units.values();
  var eEntry = eIter.next();
  while (!eEntry.done) {
    var u = eEntry.value;
    if (u.type === 'enemy' && u.alive) {
      var baseHp = u._baseHp || u.maxHp;
      var baseAtk = (u.combat && u._baseAtk) ? u._baseAtk : ((u.combat && u.combat.atk) || 10);
      var baseWpn = u._baseWeaponDamage || ((u.combat && u.combat.weaponDamage) || 0);
      var scaledMaxHp = Math.ceil(baseHp * combat.groupScaling.hpMult);
      var hpRatio = u.maxHp > 0 ? (u.hp / u.maxHp) : 1;
      u.maxHp = scaledMaxHp;
      u.hp = Math.ceil(scaledMaxHp * hpRatio);
      if (u.combat) {
        u.combat.atk = Math.ceil(baseAtk * combat.groupScaling.atkMult);
        u.combat.weaponDamage = Math.ceil(baseWpn * combat.groupScaling.atkMult);
      }
    }
    eEntry = eIter.next();
  }
}

/**
 * Apply raid scaling for 8+ player raid encounters.
 * Less aggressive than rally scaling since raid bosses are already massive.
 * +8% HP / +5% ATK per player beyond 8.
 */
function applyRaidScaling(combat) {
  var playerCount = 0;
  var iter = combat.units.values();
  var entry = iter.next();
  while (!entry.done) {
    if (entry.value.type === 'player' && entry.value.alive) playerCount++;
    entry = iter.next();
  }

  if (playerCount < 8) return;

  var extraPlayers = playerCount - 8;
  var hpMult = 1 + extraPlayers * 0.08;
  var atkMult = 1 + extraPlayers * 0.05;

  // Apply raid scaling on top of group scaling (from base stats)
  var totalHpMult = (combat.groupScaling ? combat.groupScaling.hpMult : 1) * hpMult;
  var totalAtkMult = (combat.groupScaling ? combat.groupScaling.atkMult : 1) * atkMult;

  var eIter = combat.units.values();
  var eEntry = eIter.next();
  while (!eEntry.done) {
    var u = eEntry.value;
    if (u.type === 'enemy' && u.alive) {
      var baseHp = u._baseHp || u.maxHp;
      var baseAtk = u._baseAtk || ((u.combat && u.combat.atk) || 10);
      var scaledMaxHp = Math.ceil(baseHp * totalHpMult);
      var hpR = u.maxHp > 0 ? (u.hp / u.maxHp) : 1;
      u.maxHp = scaledMaxHp;
      u.hp = Math.ceil(scaledMaxHp * hpR);
      if (u.combat && u.combat.atk) {
        u.combat.atk = Math.ceil(baseAtk * totalAtkMult);
      }
    }
    eEntry = eIter.next();
  }

  combat.raidScaling = { playerCount: playerCount, hpMult: hpMult, atkMult: atkMult };
}

/**
 * Check if reinforcements should spawn. Called at the start of each combat
 * advance cycle and when players join mid-combat.
 */
function checkReinforcements(combat) {
  if (!combat.rallyScaling) return;
  if (combat.turnNumber - combat.rallyScaling.lastReinforceAt < RALLY_INTERVAL_TURNS) return;

  // Count alive enemies
  var aliveEnemies = 0;
  var iter = combat.units.values();
  var entry = iter.next();
  while (!entry.done) {
    if (entry.value.type === 'enemy' && entry.value.alive) aliveEnemies++;
    entry = iter.next();
  }

  if (aliveEnemies >= RALLY_MAX_ENEMIES) return;

  combat.rallyScaling.lastReinforceAt = combat.turnNumber;
  var toSpawn = Math.min(combat.rallyScaling.reinforceRate, RALLY_MAX_ENEMIES - aliveEnemies);
  if (toSpawn <= 0) return;

  var floor = combat.floor;
  if (!floor || !floor.grid) return;

  // Find walkable edge positions (tiles near grid edges that are floor tiles)
  var edgeTiles = [];
  var rW = floor.width || floor.grid[0].length;
  var rH = floor.height || floor.grid.length;
  for (var ey = 0; ey < rH; ey++) {
    for (var ex = 0; ex < rW; ex++) {
      // Only edges (within 2 tiles of grid boundary)
      if (ex > 2 && ex < rW - 3 && ey > 2 && ey < rH - 3) continue;
      if (floor.grid[ey] && floor.grid[ey][ex] !== undefined) {
        var tileVal = floor.grid[ey][ex];
        if (WALKABLE_TILES[tileVal]) {
          // Make sure no unit is already here
          var occupied = false;
          var oIter = combat.units.values();
          var oEntry = oIter.next();
          while (!oEntry.done) {
            if (oEntry.value.alive && oEntry.value.x === ex && oEntry.value.y === ey) {
              occupied = true;
              break;
            }
            oEntry = oIter.next();
          }
          if (!occupied) edgeTiles.push({ x: ex, y: ey });
        }
      }
    }
  }

  if (edgeTiles.length === 0) return;

  // Get base enemy template from stored templates (reuse existing enemy types)
  var baseEnemies = combat.enemyTemplates || [];
  if (baseEnemies.length === 0) return;

  var newEnemies = [];
  var timestamp = Date.now();

  for (var si = 0; si < toSpawn; si++) {
    if (edgeTiles.length === 0) break;

    // Pick random edge tile
    var tileIdx = Math.floor(Math.random() * edgeTiles.length);
    var spawnTile = edgeTiles.splice(tileIdx, 1)[0];

    // Pick random base enemy type
    var baseEnemy = baseEnemies[Math.floor(Math.random() * baseEnemies.length)];

    var rEId = 'rally_' + si + '_' + timestamp;
    var rESpeed = baseEnemy.speed || 8;
    var rEArchetype = baseEnemy.archetype || 'bruiser';
    var rArchData = dungeonAI.ARCHETYPES ? dungeonAI.ARCHETYPES[rEArchetype] : null;
    var rEMP = (rArchData && rArchData.speed) ? rArchData.speed + 1 : 2;

    var rBaseHp = baseEnemy.hp || baseEnemy.maxHp || 50;
    var rScaledHp = Math.ceil(rBaseHp * combat.rallyScaling.hpMult);
    var rBaseAtk = baseEnemy.atk || 10;
    var rScaledAtk = Math.ceil(rBaseAtk * combat.rallyScaling.atkMult);

    var rallyUnit = {
      id: rEId,
      type: 'enemy',
      socketId: null,
      name: baseEnemy.name || 'Reinforcement',
      x: spawnTile.x,
      y: spawnTile.y,
      ct: 0, // Start at 0 CT (delayed entry)
      speed: rESpeed,
      hp: rScaledHp,
      maxHp: rScaledHp,
      mp: rEMP,
      ap: 1,
      rp: 1,
      momentumShield: 0,
      statusEffects: [],
      combat: {
        atk: rScaledAtk,
        def: baseEnemy.def || 0,
        range: baseEnemy.range || 1,
        speed: rESpeed,
        weaponDamage: rScaledAtk,
      },
      level: baseEnemy.level || 1,
      archetype: rEArchetype,
      abilities: [],
      alive: true,
      autoDefend: false,
      isReinforcement: true,
    };

    combat.units.set(rEId, rallyUnit);
    newEnemies.push({
      id: rEId,
      name: rallyUnit.name,
      x: spawnTile.x,
      y: spawnTile.y,
      hp: rScaledHp,
      maxHp: rScaledHp,
      archetype: rEArchetype,
    });
  }

  if (newEnemies.length > 0 && combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_combat_reinforcements', {
      combatId: combat.id,
      turnNumber: combat.turnNumber,
      newEnemies: newEnemies,
      playerCount: combat.rallyScaling.playerCount,
    });
  }
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
 * Auto-submit actions for NPC units in the current turn group.
 * NPCs use role-based AI: tanks/DPS attack, healers heal lowest ally or attack.
 */
function processNPCActions(combat) {
  if (!activeCombats.has(combat.id)) return;
  var npcIds = [];
  for (var i = 0; i < combat.turnGroup.length; i++) {
    var uid = combat.turnGroup[i];
    var unit = combat.units.get(uid);
    if (unit && unit.alive && unit.socketId && unit.socketId.indexOf('npc_') === 0) {
      npcIds.push(uid);
    }
  }
  if (npcIds.length === 0) return;

  // Small delay so NPC actions feel natural (300ms after turn starts)
  setTimeout(function() {
    if (!activeCombats.has(combat.id) || combat.state !== 'player_turn') return;
    for (var ni = 0; ni < npcIds.length; ni++) {
      var npcUnitId = npcIds[ni];
      var npcUnit = combat.units.get(npcUnitId);
      if (!npcUnit || !npcUnit.alive) continue;
      if (combat.pendingActions.get(npcUnitId) === true) continue;

      var npcAction = decideNPCAction(combat, npcUnit);
      handlePlayerAction(combat.id, npcUnit.socketId, npcAction);
    }
  }, 300);
}

/**
 * Decide what action an NPC should take based on their role.
 */
function decideNPCAction(combat, npcUnit) {
  var role = npcUnit._npcRole || 'dps';

  // Find enemy targets
  var enemies = [];
  var allies = [];
  var iter = combat.units.values();
  var e = iter.next();
  while (!e.done) {
    if (e.value.alive) {
      if (e.value.type === 'enemy') enemies.push(e.value);
      else if (e.value.type === 'player' && e.value.id !== npcUnit.id) allies.push(e.value);
    }
    e = iter.next();
  }

  // Healer: heal lowest HP ally if any are below 60% HP
  if (role === 'healer') {
    var lowestAlly = null;
    var lowestPct = 1.0;
    for (var ai = 0; ai < allies.length; ai++) {
      var pct = allies[ai].hp / allies[ai].maxHp;
      if (pct < lowestPct) { lowestPct = pct; lowestAlly = allies[ai]; }
    }
    // Use heal ability if available and ally is hurt
    if (lowestAlly && lowestPct < 0.6 && npcUnit.combat && npcUnit.combat.mana >= 10) {
      return { type: 'npc_heal', data: { targetId: lowestAlly.id } };
    }
  }

  // Tank/DPS: attack nearest enemy in range, or move toward closest
  if (enemies.length > 0) {
    var attackRange = (npcUnit.combat && npcUnit.combat.weaponRange) ? Math.floor(npcUnit.combat.weaponRange) : 1;
    var closestEnemy = null;
    var closestDist = 99999;
    var inRangeEnemy = null;

    // For DPS, prefer lowest HP enemy; for tank, prefer closest
    for (var ei = 0; ei < enemies.length; ei++) {
      var dist = chebyshevDist(npcUnit.x, npcUnit.y, enemies[ei].x, enemies[ei].y);
      if (dist <= attackRange) {
        if (role === 'dps') {
          if (!inRangeEnemy || enemies[ei].hp < inRangeEnemy.hp) inRangeEnemy = enemies[ei];
        } else {
          if (!inRangeEnemy) inRangeEnemy = enemies[ei];
        }
      }
      if (dist < closestDist) { closestDist = dist; closestEnemy = enemies[ei]; }
    }

    if (inRangeEnemy) {
      return { type: 'attack', data: { targetId: inRangeEnemy.id } };
    }

    // Move toward closest enemy
    if (closestEnemy && npcUnit.mp > 0) {
      var dx = closestEnemy.x - npcUnit.x;
      var dy = closestEnemy.y - npcUnit.y;
      var moveX = npcUnit.x + (dx > 0 ? 1 : dx < 0 ? -1 : 0);
      var moveY = npcUnit.y + (dy > 0 ? 1 : dy < 0 ? -1 : 0);
      return { type: 'move', data: { x: moveX, y: moveY } };
    }
  }

  return { type: 'end_turn', data: {} };
}

/**
 * Get valid attack targets for a unit.
 * Returns array of {unitId, name, x, y, hp, maxHp} for enemies in range.
 */
function getValidAttackTargets(combat, unitId) {
  var unit = combat.units.get(unitId);
  if (!unit || !unit.alive) return [];

  var targets = [];
  var attackRange = 1; // Default melee

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

    if (other.type === unit.type) continue; // Same team
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
// Reaction system — pause enemy attack for player reaction
// ---------------------------------------------------------------------------

/**
 * Pause the enemy turn to give a defending player a chance to react.
 * If the defender has RP > 0 and reaction options, emits a prompt and waits
 * up to 3 seconds. Otherwise calls back immediately with null.
 *
 * The handler for 'tc_combat_react' (in dungeon-combat-handler) calls
 * combatSync.executeReaction() and invokes combat.pendingReactionCallback.
 */
function pauseForReaction(combat, defenderId, attackerId, rawDamage, isCrit, callback) {
  var defender = combat.units.get(defenderId);
  if (!defender || defender.type !== 'player' || !defender.alive) {
    callback(null); // No reaction possible
    return;
  }

  // Determine attack type for reaction eligibility
  var attackType = 'melee'; // Basic attacks are melee by default
  var attacker = combat.units.get(attackerId);
  if (attacker && attacker.combat && attacker.combat.range && attacker.combat.range > 1) {
    attackType = 'ranged';
  }

  var available = combatSync.checkReactionAvailable(combat, defenderId, attackerId, attackType);
  if (available.length === 0 || !defender.rp || defender.rp <= 0) {
    callback(null); // No reactions available
    return;
  }

  // Set up pending reaction state
  combat.pendingReaction = {
    defenderId: defenderId,
    attackData: {
      attackerId: attackerId,
      damage: rawDamage,
      isCrit: isCrit,
    },
  };

  combat.pendingReactionCallback = function(reactionResult) {
    // Clear the timer so it doesn't fire after a player response
    if (combat.reactionTimer) {
      clearTimeout(combat.reactionTimer);
      combat.reactionTimer = null;
    }
    combat.pendingReaction = null;
    combat.pendingReactionCallback = null;
    callback(reactionResult);
  };

  // Emit reaction prompt to the defending player
  if (combat.callbacks.emitToPlayer && defender.socketId) {
    combat.callbacks.emitToPlayer(defender.socketId, 'tc_combat_reaction', {
      combatId: combat.id,
      defenderId: defenderId,
      attackerId: attackerId,
      attackerName: attacker ? attacker.name : 'Enemy',
      incomingDamage: rawDamage,
      isCrit: isCrit,
      availableReactions: available,
      timer: 3,
    });
  }

  // 3-second timeout: auto-pass if player doesn't respond
  combat.reactionTimer = setTimeout(function() {
    if (combat.pendingReaction && combat.pendingReaction.defenderId === defenderId) {
      var autoResult = combatSync.executeReaction(
        combat, defenderId, 'pass', combat.pendingReaction.attackData
      );
      if (combat.pendingReactionCallback) {
        combat.pendingReactionCallback(autoResult);
      }
    }
  }, 3000);
}

// ---------------------------------------------------------------------------
// Enemy turn
// ---------------------------------------------------------------------------

/**
 * Find the first enemy_attack event targeting a player in the action events.
 * Returns the event object or null.
 */
function findPlayerAttackEvent(combat, actionEvents) {
  for (var fi = 0; fi < actionEvents.length; fi++) {
    var evt = actionEvents[fi];
    if (evt.type === 'enemy_attack' && evt.targetId) {
      var target = combat.units.get(evt.targetId);
      if (target && target.type === 'player') {
        return evt;
      }
    }
  }
  return null;
}

/**
 * Finalize the enemy turn: broadcast action, end turn, and advance combat.
 * Extracted to avoid duplication between the reaction and non-reaction paths.
 */
function finishEnemyTurn(combat, unitId, unit, aiAction, actionEvents) {
  if (!activeCombats.has(combat.id)) return;

  // Broadcast enemy action to all players
  if (combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_combat_enemy_action', {
      combatId: combat.id,
      unitId: unitId,
      enemyName: unit.name,
      action: aiAction.type,
      events: actionEvents,
      enemyX: unit.x,
      enemyY: unit.y,
      enemyHp: unit.hp,
      enemyMaxHp: unit.maxHp,
      turnNumber: combat.turnNumber,
    });
  }

  // End enemy turn with appropriate CT reset
  var actionType = aiAction.type || 'wait';
  endUnitTurn(combat, unitId, actionType === 'attack' ? 'attacked' : (actionType === 'move' ? 'moved' : 'waited'));

  // Artificial delay for animation, then advance combat
  setTimeout(function() {
    advanceCombat(combat);
  }, ENEMY_ANIM_DELAY_MS);
}

/**
 * Start an enemy's turn. Delegates to dungeon AI for decision making.
 * If the enemy attacks a player, pauses for a reaction opportunity.
 */
function startEnemyTurn(combat, unitId) {
  if (!activeCombats.has(combat.id)) return;

  combat.state = 'enemy_turn';
  combat.turnNumber++;

  var unit = combat.units.get(unitId);
  if (!unit || !unit.alive) {
    // Skip dead enemy, advance
    setTimeout(function() { advanceCombat(combat); }, 50);
    return;
  }

  // Check exhaustion
  checkExhaustion(combat);

  // Re-check end conditions
  var checkResult = checkCombatEnd(combat);
  if (checkResult) {
    endCombat(combat, checkResult);
    return;
  }

  // Reset turn resources for enemy
  unit.mp = unit.mp || 2;
  unit.ap = PLAYER_BASE_AP;
  unit.momentumShield = 0;

  // Skeleton summon expiry: decrement turns and expire when done
  if (unit.isPlayerSummon && unit.turnsLeft !== undefined) {
    unit.turnsLeft--;
    if (unit.turnsLeft <= 0) {
      unit.alive = false;
      unit.hp = 0;
      handleUnitDeath(combat, unitId, null);
      setTimeout(function() { advanceCombat(combat); }, 50);
      return;
    }
  }

  // Gather target info for AI (summons attack enemies; enemies attack players)
  var playerUnits = [];
  var iter = combat.units.values();
  var entry = iter.next();
  while (!entry.done) {
    var entUnit = entry.value;
    if (unit.isPlayerSummon) {
      // Player summon (skeleton): target actual enemies
      if (entUnit.type === 'enemy' && !entUnit.isPlayerSummon && entUnit.alive) {
        playerUnits.push(entUnit);
      }
    } else {
      // Normal enemy: target players
      if (entUnit.type === 'player' && entUnit.alive) {
        playerUnits.push(entUnit);
      }
    }
    entry = iter.next();
  }

  // Check if dungeonAI has decideTurnAction
  var aiAction = null;
  if (typeof dungeonAI.decideTurnAction === 'function') {
    try {
      aiAction = dungeonAI.decideTurnAction(unit, combat, playerUnits, combat.floor);
    } catch (err) {
      console.error('[dungeon-combat] AI error for ' + unit.name + ':', err.message);
      aiAction = null;
    }
  }

  // Fallback AI: simple approach-and-attack behavior
  if (!aiAction) {
    aiAction = fallbackAI(combat, unit, playerUnits);
  }

  // Execute the AI action
  var actionEvents = executeAIAction(combat, unit, aiAction, playerUnits);

  // Check if the enemy attacked a player — offer reaction if so
  var playerAttackEvt = findPlayerAttackEvent(combat, actionEvents);
  if (playerAttackEvt) {
    pauseForReaction(
      combat,
      playerAttackEvt.targetId,
      unitId,
      playerAttackEvt.actualDamage,
      playerAttackEvt.isCrit,
      function(reactionResult) {
        if (reactionResult && reactionResult.reactionType !== 'pass') {
          // Apply retroactive damage modification
          var damageDiff = playerAttackEvt.actualDamage - reactionResult.modifiedDamage;
          if (damageDiff > 0) {
            // Heal back the reduced damage
            var targetUnit = combat.units.get(playerAttackEvt.targetId);
            if (targetUnit && targetUnit.alive) {
              targetUnit.hp = Math.min(targetUnit.maxHp, targetUnit.hp + damageDiff);
            } else if (targetUnit && !targetUnit.alive && damageDiff >= playerAttackEvt.actualDamage) {
              // Target died but reaction would have saved them — revive
              targetUnit.hp = Math.min(targetUnit.maxHp || 1, damageDiff);
              targetUnit.alive = true;
            }
            // Update the event with modified values
            playerAttackEvt.reactionApplied = true;
            playerAttackEvt.originalDamage = playerAttackEvt.actualDamage;
            playerAttackEvt.actualDamage = reactionResult.modifiedDamage;
            playerAttackEvt.targetHp = targetUnit ? Math.max(0, targetUnit.hp) : 0;
            playerAttackEvt.targetDied = targetUnit ? !targetUnit.alive : true;
          }

          // Apply counter damage to the attacker if applicable
          if (reactionResult.counterDamage > 0) {
            var atkUnit = combat.units.get(unitId);
            if (atkUnit && atkUnit.alive) {
              atkUnit.hp -= reactionResult.counterDamage;
              if (atkUnit.hp <= 0) {
                atkUnit.hp = 0;
                atkUnit.alive = false;
                handleUnitDeath(combat, unitId, playerAttackEvt.targetId);
              }
            }
          }

          // Broadcast reaction result to all players
          if (combat.callbacks.broadcastToFloor) {
            combat.callbacks.broadcastToFloor('tc_combat_reaction_result', {
              combatId: combat.id,
              defenderId: playerAttackEvt.targetId,
              attackerId: unitId,
              reactionType: reactionResult.reactionType,
              success: reactionResult.success,
              modifiedDamage: reactionResult.modifiedDamage,
              counterDamage: reactionResult.counterDamage || 0,
              shieldAbsorbed: reactionResult.shieldAbsorbed || 0,
              attackerHp: unit.hp,
              defenderHp: playerAttackEvt.targetHp,
            });
          }
        }

        // Continue with the rest of the enemy turn
        finishEnemyTurn(combat, unitId, unit, aiAction, actionEvents);
      }
    );
    return; // Async — finishEnemyTurn will be called from the callback
  }

  // No player attack — proceed synchronously
  finishEnemyTurn(combat, unitId, unit, aiAction, actionEvents);
}

/**
 * Fallback AI when dungeonAI.decideTurnAction is not available.
 * Simple behavior: move toward nearest player, attack if adjacent.
 */
function fallbackAI(combat, enemy, playerUnits) {
  if (playerUnits.length === 0) {
    return { type: 'wait' };
  }

  // Find nearest alive player
  var nearest = null;
  var nearestDist = Infinity;
  for (var i = 0; i < playerUnits.length; i++) {
    var p = playerUnits[i];
    var d = manhattanDist(enemy.x, enemy.y, p.x, p.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = p;
    }
  }

  if (!nearest) return { type: 'wait' };

  // Check if already adjacent — attack
  var attackRange = (enemy.combat && enemy.combat.range) ? enemy.combat.range : 1;
  if (chebyshevDist(enemy.x, enemy.y, nearest.x, nearest.y) <= attackRange) {
    return { type: 'attack', targetId: nearest.id };
  }

  // Move toward nearest player
  var path = bfsPath(
    combat, combat.floor.grid, enemy.x, enemy.y, nearest.x, nearest.y,
    enemy.mp, combat.units, combat.floor.width, combat.floor.height, enemy.id
  );

  if (path && path.length > 1) {
    // Move as far as possible, leaving room for attack if we'll be adjacent
    return { type: 'move_attack', movePath: path, targetId: nearest.id };
  }

  return { type: 'wait' };
}

/**
 * Apply on-hit effects, pierce, and chain from a player summon's attack.
 * Called after a successful basic attack for units with isPlayerSummon=true.
 */
function _applySummonOnHit(combat, attacker, primaryTarget, atkDmg, events) {
  if (!attacker || !primaryTarget) return;
  var floor = combat.floor;
  var grid  = floor ? floor.grid  : null;
  var gridW = floor ? (floor.width  || (grid && grid[0] && grid[0].length) || 0) : 0;
  var gridH = floor ? (floor.height || (grid && grid.length) || 0) : 0;

  // 1. Status on-hit effects on primary target
  if (attacker.onHitEffects && attacker.onHitEffects.length > 0) {
    if (!primaryTarget.statusEffects) primaryTarget.statusEffects = [];
    for (var _sohi = 0; _sohi < attacker.onHitEffects.length; _sohi++) {
      var _soh = attacker.onHitEffects[_sohi];
      switch (_soh.type) {
        case 'bleed':
          if (Math.random() < (_soh.chance || 0.25)) {
            primaryTarget.statusEffects.push({ name: 'bleeding', type: 'debuff', duration: _soh.duration || 2, tickDamage: _soh.tickDamage || 4, sourceId: attacker.id });
            events.push({ type: 'summon_on_hit', effect: 'bleeding', unitId: primaryTarget.id, attackerId: attacker.id });
          }
          break;
        case 'burn':
          if (Math.random() < (_soh.chance || 0.25)) {
            primaryTarget.statusEffects.push({ name: 'burned', type: 'debuff', duration: 2, tickDamage: Math.max(3, Math.round(atkDmg * 0.15)), sourceId: attacker.id });
            events.push({ type: 'summon_on_hit', effect: 'burned', unitId: primaryTarget.id, attackerId: attacker.id });
          }
          break;
        case 'slow':
          if (Math.random() < (_soh.chance || 0.25)) {
            primaryTarget.statusEffects.push({ name: 'slowed', type: 'debuff', duration: 2, speedReduction: 0.5, sourceId: attacker.id });
            events.push({ type: 'summon_on_hit', effect: 'slowed', unitId: primaryTarget.id, attackerId: attacker.id });
          }
          break;
        case 'poison':
          if (Math.random() < (_soh.chance || 0.20) && !hasImmunity(primaryTarget, 'poison')) {
            primaryTarget.statusEffects.push({ name: 'poisoned', type: 'debuff', duration: 3, tickDamage: Math.max(2, Math.round(atkDmg * 0.10)), sourceId: attacker.id });
            events.push({ type: 'summon_on_hit', effect: 'poisoned', unitId: primaryTarget.id, attackerId: attacker.id });
          }
          break;
        case 'stun':
          if (Math.random() < (_soh.chance || 0.15) && !hasCCImmunity(primaryTarget, 'stunned')) {
            primaryTarget.statusEffects.push({ name: 'stunned', type: 'debuff', duration: _soh.duration || 1, skipTurn: true, sourceId: attacker.id });
            events.push({ type: 'summon_on_hit', effect: 'stunned', unitId: primaryTarget.id, attackerId: attacker.id });
          }
          break;
        case 'mark':
          if (Math.random() < (_soh.chance || 0.20)) {
            primaryTarget.statusEffects.push({ name: 'marked', type: 'debuff', duration: 2, damageTakenBonus: _soh.damageTakenBonus || 0.10, sourceId: attacker.id });
            events.push({ type: 'summon_on_hit', effect: 'marked', unitId: primaryTarget.id, attackerId: attacker.id });
          }
          break;
        case 'mana_drain':
          var _sohManaDrain = Math.min(_soh.value || 4, (primaryTarget.combat && primaryTarget.combat.mana) || 0);
          if (_sohManaDrain > 0 && primaryTarget.combat) {
            primaryTarget.combat.mana = Math.max(0, (primaryTarget.combat.mana || 0) - _sohManaDrain);
            events.push({ type: 'summon_on_hit', effect: 'mana_drain', unitId: primaryTarget.id, attackerId: attacker.id, amount: _sohManaDrain });
          }
          break;
        case 'wound':
          primaryTarget.statusEffects.push({ name: 'wounded', type: 'debuff', duration: 3, healingReduction: _soh.healing_reduction || 0.30, sourceId: attacker.id });
          events.push({ type: 'summon_on_hit', effect: 'wounded', unitId: primaryTarget.id, attackerId: attacker.id });
          break;
        case 'knockback':
          if (grid && !hasCCImmunity(primaryTarget, 'knockback')) {
            var _sohKbDx = primaryTarget.x - attacker.x, _sohKbDy = primaryTarget.y - attacker.y;
            var _sohKbNx = _sohKbDx === 0 ? 0 : (_sohKbDx > 0 ? 1 : -1);
            var _sohKbNy = _sohKbDy === 0 ? 0 : (_sohKbDy > 0 ? 1 : -1);
            if (_sohKbNx === 0 && _sohKbNy === 0) _sohKbNx = 1;
            var _sohKbFX = primaryTarget.x, _sohKbFY = primaryTarget.y;
            for (var _sohKbt = 0; _sohKbt < (_soh.tiles || 1); _sohKbt++) {
              var _sohKbNxT = _sohKbFX + _sohKbNx, _sohKbNyT = _sohKbFY + _sohKbNy;
              if (!isWalkableCombat(grid, _sohKbNxT, _sohKbNyT, gridW, gridH, null) || getUnitAtPosition(combat, _sohKbNxT, _sohKbNyT)) break;
              _sohKbFX = _sohKbNxT; _sohKbFY = _sohKbNyT;
            }
            if (_sohKbFX !== primaryTarget.x || _sohKbFY !== primaryTarget.y) {
              primaryTarget.x = _sohKbFX; primaryTarget.y = _sohKbFY;
              events.push({ type: 'summon_knockback', unitId: primaryTarget.id, attackerId: attacker.id, newX: _sohKbFX, newY: _sohKbFY });
            }
          }
          break;
        case 'push':
          if (grid && !hasCCImmunity(primaryTarget, 'knockback')) {
            var _sohPsDx = primaryTarget.x - attacker.x, _sohPsDy = primaryTarget.y - attacker.y;
            var _sohPsNx = _sohPsDx === 0 ? 0 : (_sohPsDx > 0 ? 1 : -1);
            var _sohPsNy = _sohPsDy === 0 ? 0 : (_sohPsDy > 0 ? 1 : -1);
            if (_sohPsNx === 0 && _sohPsNy === 0) _sohPsNx = 1;
            var _sohPsFX = primaryTarget.x, _sohPsFY = primaryTarget.y;
            for (var _sohPst = 0; _sohPst < (_soh.tiles || 2); _sohPst++) {
              var _sohPsNxT = _sohPsFX + _sohPsNx, _sohPsNyT = _sohPsFY + _sohPsNy;
              if (!isWalkableCombat(grid, _sohPsNxT, _sohPsNyT, gridW, gridH, null) || getUnitAtPosition(combat, _sohPsNxT, _sohPsNyT)) break;
              _sohPsFX = _sohPsNxT; _sohPsFY = _sohPsNyT;
            }
            if (_sohPsFX !== primaryTarget.x || _sohPsFY !== primaryTarget.y) {
              primaryTarget.x = _sohPsFX; primaryTarget.y = _sohPsFY;
              events.push({ type: 'summon_knockback', unitId: primaryTarget.id, attackerId: attacker.id, newX: _sohPsFX, newY: _sohPsFY });
            }
          }
          break;
        case 'pull':
          if (grid && !hasCCImmunity(primaryTarget, 'knockback')) {
            var _sohPlDx = attacker.x - primaryTarget.x, _sohPlDy = attacker.y - primaryTarget.y;
            var _sohPlNx = _sohPlDx === 0 ? 0 : (_sohPlDx > 0 ? 1 : -1);
            var _sohPlNy = _sohPlDy === 0 ? 0 : (_sohPlDy > 0 ? 1 : -1);
            var _sohPlFX = primaryTarget.x, _sohPlFY = primaryTarget.y;
            for (var _sohPlt = 0; _sohPlt < (_soh.tiles || 1); _sohPlt++) {
              var _sohPlNxT = _sohPlFX + _sohPlNx, _sohPlNyT = _sohPlFY + _sohPlNy;
              if (_sohPlNxT === attacker.x && _sohPlNyT === attacker.y) break;
              if (!isWalkableCombat(grid, _sohPlNxT, _sohPlNyT, gridW, gridH, null) || getUnitAtPosition(combat, _sohPlNxT, _sohPlNyT)) break;
              _sohPlFX = _sohPlNxT; _sohPlFY = _sohPlNyT;
            }
            if (_sohPlFX !== primaryTarget.x || _sohPlFY !== primaryTarget.y) {
              primaryTarget.x = _sohPlFX; primaryTarget.y = _sohPlFY;
              events.push({ type: 'summon_pull', unitId: primaryTarget.id, attackerId: attacker.id, newX: _sohPlFX, newY: _sohPlFY });
            }
          }
          break;
      }
    }
  }

  // 2. Pierce: hit enemies along the attacker→target direction vector
  if (attacker.pierceTargets > 0 && grid) {
    var _pierceDx = primaryTarget.x - attacker.x, _pierceDy = primaryTarget.y - attacker.y;
    var _pierceNx = _pierceDx === 0 ? 0 : (_pierceDx > 0 ? 1 : -1);
    var _pierceNy = _pierceDy === 0 ? 0 : (_pierceDy > 0 ? 1 : -1);
    if (_pierceNx === 0 && _pierceNy === 0) _pierceNx = 1;
    var _pierceX = primaryTarget.x + _pierceNx, _pierceY = primaryTarget.y + _pierceNy;
    var _piercedCount = 0;
    for (var _pri = 0; _pri < 8 && _piercedCount < attacker.pierceTargets; _pri++) {
      if (_pierceX < 0 || _pierceX >= gridW || _pierceY < 0 || _pierceY >= gridH) break;
      var _pierceUnit = getUnitAtPosition(combat, _pierceX, _pierceY);
      if (_pierceUnit && _pierceUnit.alive && _pierceUnit.type === 'enemy' && !_pierceUnit.isPlayerSummon) {
        var _pierceRes = executeBasicAttack(combat, attacker.id, _pierceUnit.id);
        if (_pierceRes.success) {
          if (_pierceRes.targetDied) handleUnitDeath(combat, _pierceUnit.id, attacker.id);
          events.push({ type: 'summon_pierce', attackerId: attacker.id, targetId: _pierceUnit.id,
            damage: _pierceRes.damage, actualDamage: _pierceRes.actualDamage,
            targetDied: _pierceRes.targetDied, targetHp: _pierceRes.targetHp });
          _piercedCount++;
        }
      }
      _pierceX += _pierceNx; _pierceY += _pierceNy;
    }
  }

  // 3. Chain: bounce to nearest unhit enemy at falloff damage
  if (attacker.chainBounces > 0) {
    var _chainFalloff = attacker.chainFalloff || 0.6;
    var _chainHit = [primaryTarget.id];
    var _chainFrom = primaryTarget;
    var _chainDmg = (attacker.combat && attacker.combat.atk) ? attacker.combat.atk : atkDmg;
    for (var _cbi = 0; _cbi < attacker.chainBounces; _cbi++) {
      _chainDmg = Math.round(_chainDmg * _chainFalloff);
      if (_chainDmg < 1) break;
      var _chainNearest = null, _chainNearestDist = 99;
      combat.units.forEach(function(u) {
        if (!u.alive || u.type !== 'enemy' || u.isPlayerSummon) return;
        if (_chainHit.indexOf(u.id) !== -1) return;
        var _cd = Math.abs(u.x - _chainFrom.x) + Math.abs(u.y - _chainFrom.y);
        if (_cd <= 6 && _cd < _chainNearestDist) { _chainNearest = u; _chainNearestDist = _cd; }
      });
      if (!_chainNearest) break;
      _chainHit.push(_chainNearest.id);
      var _chainDef = (_chainNearest.combat && _chainNearest.combat.def) ? _chainNearest.combat.def : 0;
      var _chainActual = Math.max(1, _chainDmg - _chainDef);
      _chainNearest.hp = Math.max(0, (_chainNearest.hp || 0) - _chainActual);
      var _chainDied = _chainNearest.hp <= 0;
      if (_chainDied) { _chainNearest.alive = false; handleUnitDeath(combat, _chainNearest.id, attacker.id); }
      events.push({ type: 'summon_chain', attackerId: attacker.id, targetId: _chainNearest.id,
        damage: _chainDmg, actualDamage: _chainActual, targetDied: _chainDied,
        targetHp: _chainNearest.hp, bounce: _cbi + 1 });
      _chainFrom = _chainNearest;
    }
  }
}

/**
 * Execute an AI-decided action for an enemy unit.
 * Returns array of event objects for broadcasting.
 */
function executeAIAction(combat, enemy, action, playerUnits) {
  var events = [];

  if (!action) return events;

  switch (action.type) {
    case 'move':
      if (action.movePath && action.movePath.length > 1) {
        var moveResult = executeMove(combat, enemy.id, action.movePath);
        events.push({
          type: 'enemy_move',
          unitId: enemy.id,
          path: action.movePath,
          tilesMoved: moveResult.tilesMoved,
          finalX: enemy.x,
          finalY: enemy.y,
        });
        if (moveResult.events) {
          events = events.concat(moveResult.events);
        }
      }
      break;

    case 'attack':
      if (action.targetId) {
        var atkResult = executeBasicAttack(combat, enemy.id, action.targetId);
        if (atkResult.success) {
          // Handle player death (revive_on_death may undo this)
          if (atkResult.targetDied) {
            handleUnitDeath(combat, action.targetId, enemy.id);
            // Re-check if target was revived
            var atkDeathTarget = combat.units.get(action.targetId);
            if (atkDeathTarget && atkDeathTarget.alive) {
              atkResult.targetDied = false;
              atkResult.targetHp = atkDeathTarget.hp;
            }
          }

          events.push({
            type: 'enemy_attack',
            attackerId: enemy.id,
            targetId: action.targetId,
            damage: atkResult.damage,
            actualDamage: atkResult.actualDamage,
            isCrit: atkResult.isCrit,
            dodged: atkResult.dodged || false,
            blocked: atkResult.blocked || false,
            shieldAbsorbed: atkResult.shieldAbsorbed,
            manaShieldAbsorbed: atkResult.manaShieldAbsorbed || 0,
            targetDied: atkResult.targetDied,
            targetHp: atkResult.targetHp,
            targetMaxHp: atkResult.targetMaxHp,
            lifestealHeal: atkResult.lifestealHeal || 0,
            reflectDamage: atkResult.reflectDamage || 0,
          });

          // Summon on-hit effects (pierce, chain, status)
          if (enemy.isPlayerSummon && !atkResult.dodged && atkResult.actualDamage > 0) {
            var _atkSohTarget = combat.units.get(action.targetId);
            if (_atkSohTarget) _applySummonOnHit(combat, enemy, _atkSohTarget, atkResult.actualDamage, events);
          }
        }
      }
      break;

    case 'move_attack':
      // Move first, then attack if in range
      if (action.movePath && action.movePath.length > 1) {
        // Trim path so enemy stops 1 tile short of target if possible (stay adjacent)
        var trimmedPath = trimPathForAttack(combat, enemy, action.movePath, action.targetId);
        if (trimmedPath.length > 1) {
          var mResult = executeMove(combat, enemy.id, trimmedPath);
          events.push({
            type: 'enemy_move',
            unitId: enemy.id,
            path: trimmedPath,
            tilesMoved: mResult.tilesMoved,
            finalX: enemy.x,
            finalY: enemy.y,
          });
          if (mResult.events) {
            events = events.concat(mResult.events);
          }
          if (mResult.died) break;
        }
      }

      // Now try to attack if adjacent and have AP
      if (action.targetId && enemy.ap > 0 && enemy.alive) {
        var target = combat.units.get(action.targetId);
        if (target && target.alive) {
          var attackRange2 = (enemy.combat && enemy.combat.range) ? enemy.combat.range : 1;
          if (chebyshevDist(enemy.x, enemy.y, target.x, target.y) <= attackRange2) {
            var aResult = executeBasicAttack(combat, enemy.id, action.targetId);
            if (aResult.success) {
              // Handle death (revive_on_death may undo this)
              if (aResult.targetDied) {
                handleUnitDeath(combat, action.targetId, enemy.id);
                var maDeathTarget = combat.units.get(action.targetId);
                if (maDeathTarget && maDeathTarget.alive) {
                  aResult.targetDied = false;
                  aResult.targetHp = maDeathTarget.hp;
                }
              }

              events.push({
                type: 'enemy_attack',
                attackerId: enemy.id,
                targetId: action.targetId,
                damage: aResult.damage,
                actualDamage: aResult.actualDamage,
                isCrit: aResult.isCrit,
                dodged: aResult.dodged || false,
                blocked: aResult.blocked || false,
                shieldAbsorbed: aResult.shieldAbsorbed,
                manaShieldAbsorbed: aResult.manaShieldAbsorbed || 0,
                targetDied: aResult.targetDied,
                targetHp: aResult.targetHp,
                targetMaxHp: aResult.targetMaxHp,
                lifestealHeal: aResult.lifestealHeal || 0,
                reflectDamage: aResult.reflectDamage || 0,
              });

              // Summon on-hit effects (pierce, chain, status)
              if (enemy.isPlayerSummon && !aResult.dodged && aResult.actualDamage > 0) {
                var _maSohTarget = combat.units.get(action.targetId);
                if (_maSohTarget) _applySummonOnHit(combat, enemy, _maSohTarget, aResult.actualDamage, events);
              }
            }
          }
        }
      }
      break;

    case 'ability':
      if (action.abilityId) {
        var abilityRes = executeAbility(combat, enemy.id, action.abilityId, action.targetX || enemy.x, action.targetY || enemy.y);
        if (abilityRes.success) {
          events.push({
            type: 'enemy_ability',
            unitId: enemy.id,
            abilityName: abilityRes.abilityName,
            abilityId: abilityRes.abilityId,
            effects: abilityRes.effects,
            targetX: action.targetX,
            targetY: action.targetY,
          });
          // Handle deaths from ability
          if (abilityRes.effects) {
            for (var abi = 0; abi < abilityRes.effects.length; abi++) {
              if (abilityRes.effects[abi].targetDied) {
                handleUnitDeath(combat, abilityRes.effects[abi].targetId, enemy.id);
              }
            }
          }
        } else {
          events.push({ type: 'enemy_wait', unitId: enemy.id });
        }
      } else {
        events.push({ type: 'enemy_wait', unitId: enemy.id });
      }
      break;

    case 'wait':
    default:
      events.push({ type: 'enemy_wait', unitId: enemy.id });
      break;
  }

  return events;
}

/**
 * Trim a movement path so the enemy stops adjacent to the target.
 * This allows move + attack in a single turn.
 */
function trimPathForAttack(combat, enemy, path, targetId) {
  var target = combat.units.get(targetId);
  if (!target) return path;

  var attackRange = (enemy.combat && enemy.combat.range) ? enemy.combat.range : 1;

  // Walk the path and stop at the last tile that is within attack range of target
  // but also within MP budget
  var bestStop = 0; // index in path to stop at (0 = no movement)

  for (var i = 1; i < path.length && i <= enemy.mp; i++) {
    var tile = path[i];
    if (chebyshevDist(tile.x, tile.y, target.x, target.y) <= attackRange) {
      bestStop = i;
      break; // Stop at the first tile in range
    }
    bestStop = i; // Keep advancing if not yet in range
  }

  // If we never reach attack range, just move as far as possible
  if (bestStop === 0) return path;

  return path.slice(0, bestStop + 1);
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
// Status effects
// ---------------------------------------------------------------------------

/**
 * Tick status effects for a unit at end of their turn.
 * Applies tick damage and decrements durations.
 */
function tickStatusEffects(combat, unit) {
  if (!unit.statusEffects || unit.statusEffects.length === 0) return;

  var remaining = [];
  for (var i = 0; i < unit.statusEffects.length; i++) {
    var effect = unit.statusEffects[i];

    // Apply tick damage
    if (effect.tickDamage && effect.tickDamage > 0 && unit.alive) {
      // Check poison immunity before applying poison tick damage
      if (effect.name === 'poisoned' && hasImmunity(unit, 'poison')) {
        // Immune to poison — skip tick damage and remove effect
        continue; // Don't add to remaining, effectively removing it
      }
      unit.hp -= effect.tickDamage;
      if (unit.hp <= 0) {
        unit.alive = false;
        unit.hp = 0;
        handleUnitDeath(combat, unit.id, effect.sourceId || null);
      }

      // Broadcast status tick
      if (combat.callbacks.broadcastToFloor) {
        combat.callbacks.broadcastToFloor('tc_combat_status_tick', {
          combatId: combat.id,
          unitId: unit.id,
          effectName: effect.name || 'unknown',
          effectCategory: rpgData.getStatusEffectCategory(effect.name || 'unknown'),
          tickDamage: effect.tickDamage,
          unitHp: Math.max(0, unit.hp),
          unitMaxHp: unit.maxHp,
        });
      }
    }

    // --- Healing Resonance HoT: heal per turn from heal_resonance buff ---
    if (effect.name === 'healing_resonance' && effect.healPerTurn && effect.healPerTurn > 0 && unit.alive) {
      var hotOldHp = unit.hp;
      var hotHealAmt = effect.healPerTurn;

      // --- Support Passive: Dissonance — enemies near the HoT source have reduced healing ---
      // If the unit is an enemy and any player has dissonance aura nearby, reduce HoT
      if (effect.sourceId) {
        var hotSource = combat.units.get(effect.sourceId);
        // Dissonance reduces healing on ENEMIES of the dissonance holder
        // So check if any unit of the OPPOSITE type to this unit has dissonance in range
        if (hotSource) {
          var dissoNearby = getUnitsInRadius(combat, unit.x, unit.y, 3);
          for (var dsi = 0; dsi < dissoNearby.length; dsi++) {
            var dissoUnit = dissoNearby[dsi];
            if (dissoUnit.type === unit.type || !dissoUnit.alive) continue;
            var dissoPassive = getUnitCombatPassive(dissoUnit, 'dissonance');
            if (dissoPassive) {
              var dissoRange = dissoPassive.range || 3;
              if (manhattanDist(unit.x, unit.y, dissoUnit.x, dissoUnit.y) <= dissoRange) {
                hotHealAmt = Math.max(1, Math.floor(hotHealAmt * (1 - (dissoPassive.healReduction || 0.25))));
                break; // Only one dissonance applies
              }
            }
          }
        }
      }

      unit.hp = Math.min(unit.maxHp, unit.hp + hotHealAmt);
      var hotActual = unit.hp - hotOldHp;
      if (hotActual > 0 && combat.callbacks.broadcastToFloor) {
        combat.callbacks.broadcastToFloor('tc_combat_status_tick', {
          combatId: combat.id,
          unitId: unit.id,
          effectName: 'healing_resonance',
          effectCategory: rpgData.getStatusEffectCategory('healing_resonance'),
          healAmount: hotActual,
          unitHp: unit.hp,
          unitMaxHp: unit.maxHp,
        });
      }
    }

    // --- Animal Form per-turn effects ---
    if (effect.animalForm && unit.alive) {
      // HP regen from form (turtle form +5% per turn)
      if (effect.hpRegenPercent && effect.hpRegenPercent > 0) {
        var afRegenAmt = Math.max(1, Math.floor(unit.maxHp * effect.hpRegenPercent));
        var afOldHp = unit.hp;
        unit.hp = Math.min(unit.maxHp, unit.hp + afRegenAmt);
        var afActualRegen = unit.hp - afOldHp;
        if (afActualRegen > 0 && combat.callbacks.broadcastToFloor) {
          combat.callbacks.broadcastToFloor('tc_combat_status_tick', {
            combatId: combat.id, unitId: unit.id,
            effectName: effect.animalForm + '_form_regen',
            effectCategory: rpgData.getStatusEffectCategory(effect.animalForm + '_form_regen'),
            healAmount: afActualRegen, unitHp: unit.hp, unitMaxHp: unit.maxHp,
          });
        }
      }
      // Natural Attunement passive: +2% HP regen while in any animal form
      var natAttune = getUnitCombatPassive(unit, 'natural_attunement');
      if (natAttune && natAttune.formHpRegen) {
        var naRegenAmt = Math.max(1, Math.floor(unit.maxHp * natAttune.formHpRegen));
        var naOldHp = unit.hp;
        unit.hp = Math.min(unit.maxHp, unit.hp + naRegenAmt);
        var naActualRegen = unit.hp - naOldHp;
        if (naActualRegen > 0 && combat.callbacks.broadcastToFloor) {
          combat.callbacks.broadcastToFloor('tc_combat_status_tick', {
            combatId: combat.id, unitId: unit.id,
            effectName: 'natural_attunement_regen',
            effectCategory: rpgData.getStatusEffectCategory('natural_attunement_regen'),
            healAmount: naActualRegen, unitHp: unit.hp, unitMaxHp: unit.maxHp,
          });
        }
      }
      // Hound form: Loyal Companion aura — nearby allies get HP regen per turn
      if (effect.animalForm === 'hound' && effect.allyHpRegenAura) {
        var houndAllies = getUnitsInRadius(combat, unit.x, unit.y, 3);
        for (var hai = 0; hai < houndAllies.length; hai++) {
          var hAlly = houndAllies[hai];
          if (hAlly.id === unit.id || hAlly.type !== unit.type || !hAlly.alive) continue;
          var hRegenAmt = Math.max(1, Math.floor(hAlly.maxHp * effect.allyHpRegenAura));
          var hOldHp = hAlly.hp;
          hAlly.hp = Math.min(hAlly.maxHp, hAlly.hp + hRegenAmt);
          if (hAlly.hp > hOldHp && combat.callbacks.broadcastToFloor) {
            combat.callbacks.broadcastToFloor('tc_combat_status_tick', {
              combatId: combat.id, unitId: hAlly.id,
              effectName: 'loyal_companion_regen',
              effectCategory: rpgData.getStatusEffectCategory('loyal_companion_regen'),
              healAmount: hAlly.hp - hOldHp, unitHp: hAlly.hp, unitMaxHp: hAlly.maxHp,
            });
          }
        }
      }
    }

    // Decrement duration
    effect.duration--;
    if (effect.duration > 0) {
      remaining.push(effect);
    } else {
      // --- Animal Form expiry: revert all form bonuses ---
      if (effect.animalForm) {
        if (effect.maxHpBoost) {
          unit.maxHp -= effect.maxHpBoost;
          if (unit.hp > unit.maxHp) unit.hp = unit.maxHp;
        }
        unit.activeAnimalForm = null;
        unit._animalFormPounceReady = false;
        unit._animalFormShedSkinUsed = false;
        var primalSurge = getUnitCombatPassive(unit, 'primal_surge');
        if (primalSurge && unit.alive) {
          var psDuration = primalSurge.onFormExpireDuration || 2;
          var psDmgBoost = Math.max(1, Math.floor(5 * (primalSurge.onFormExpireBuff || 0.15) / 0.05));
          remaining.push({
            name: 'primal_surge', type: 'buff', duration: psDuration,
            damageBoost: psDmgBoost, armorBoost: Math.floor(psDmgBoost * 0.8),
            speedMult: 1 + (primalSurge.onFormExpireBuff || 0.15), sourceId: unit.id,
          });
          if (combat.callbacks.broadcastToFloor) {
            combat.callbacks.broadcastToFloor('tc_combat_status_tick', {
              combatId: combat.id, unitId: unit.id,
              effectName: 'primal_surge_activated',
              effectCategory: rpgData.getStatusEffectCategory('primal_surge_activated'),
              duration: psDuration,
            });
          }
        }
        if (combat.callbacks.broadcastToFloor) {
          combat.callbacks.broadcastToFloor('tc_combat_status_tick', {
            combatId: combat.id, unitId: unit.id,
            effectName: 'animal_form_expired',
            effectCategory: rpgData.getStatusEffectCategory('animal_form_expired'),
            form: effect.animalForm,
            unitHp: unit.hp, unitMaxHp: unit.maxHp,
          });
        }
      }
      // A5: Revert maxHpBoost when food buff expires (non-animal-form buffs)
      else if (effect.maxHpBoost) {
        unit.maxHp -= effect.maxHpBoost;
        if (unit.hp > unit.maxHp) unit.hp = unit.maxHp;
      }
      // --- Support Passive: Vulnerability — when CC effect expires on target,
      // check if the source unit had 'vulnerability' passive. If so, apply
      // a damage_amplify debuff for 2 turns so the target takes 15% more damage. ---
      var ccEffectNames = ['stunned', 'rooted', 'frozen', 'knockdown', 'silenced', 'taunted', 'grappled', 'submission_hold', 'chokeholded'];
      if (effect.type === 'debuff' && ccEffectNames.indexOf(effect.name) !== -1 && effect.sourceId) {
        var vulnSource = combat.units.get(effect.sourceId);
        if (vulnSource && vulnSource.alive) {
          var vulnPassive = getUnitCombatPassive(vulnSource, 'vulnerability');
          if (vulnPassive) {
            if (!unit.statusEffects) unit.statusEffects = [];
            // Don't stack vulnerability debuffs — check if already present
            var hasVulnDebuff = false;
            for (var vci = 0; vci < remaining.length; vci++) {
              if (remaining[vci].name === 'vulnerability_exposed') {
                hasVulnDebuff = true;
                break;
              }
            }
            if (!hasVulnDebuff) {
              remaining.push({
                name: 'vulnerability_exposed',
                type: 'debuff',
                duration: vulnPassive.duration || 2,
                damageAmplify: vulnPassive.damageAmplify || 0.15,
                sourceId: effect.sourceId,
              });
              if (combat.callbacks.broadcastToFloor) {
                combat.callbacks.broadcastToFloor('tc_combat_passive_debuff', {
                  combatId: combat.id,
                  targetId: unit.id,
                  passive: 'vulnerability',
                  debuffName: 'vulnerability_exposed',
                  duration: vulnPassive.duration || 2,
                });
              }
            }
          }
        }
      }
    }
  }

  unit.statusEffects = remaining;
}

// ---------------------------------------------------------------------------
// Exhaustion mechanic
// ---------------------------------------------------------------------------

/**
 * Check and apply exhaustion damage (Turn 12 normal, Turn 20 boss/leviathan).
 * Deals escalating unblockable damage to ALL units.
 */
function checkExhaustion(combat) {
  var threshold = (combat._isLeviathanCombat || combat._hasBoss) ? EXHAUSTION_START_BOSS : EXHAUSTION_START;
  if (combat.turnNumber < threshold) return;

  var exhaustionDmg = (combat.turnNumber - threshold) * EXHAUSTION_PER_TURN;
  if (exhaustionDmg <= 0) return;

  combat.exhaustionDamage = exhaustionDmg;

  var casualties = [];
  var iter = combat.units.values();
  var entry = iter.next();

  while (!entry.done) {
    var unit = entry.value;
    entry = iter.next();

    if (!unit.alive) continue;

    unit.hp -= exhaustionDmg;
    if (unit.hp <= 0) {
      unit.alive = false;
      unit.hp = 0;
      casualties.push(unit.id);
    }
  }

  // Broadcast exhaustion
  if (combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_combat_exhaustion', {
      combatId: combat.id,
      turnNumber: combat.turnNumber,
      damage: exhaustionDmg,
      casualties: casualties,
    });
  }

  // Process deaths
  for (var i = 0; i < casualties.length; i++) {
    handleUnitDeath(combat, casualties[i]);
  }
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
// Player action handler (main entry point from socket handler)
// ---------------------------------------------------------------------------

/**
 * Handle a player action during combat.
 * This is the main entry point called from the dungeon socket handler.
 *
 * @param {string} combatId   - The combat instance ID
 * @param {string} socketId   - The player's socket ID
 * @param {Object} action     - { type: 'move'|'attack'|'wait', data: {...} }
 * @returns {Object} result
 */
function handlePlayerAction(combatId, socketId, action) {
  var combat = activeCombats.get(combatId);
  if (!combat) {
    return { success: false, error: 'Combat not found' };
  }

  if (combat.state !== 'player_turn') {
    return { success: false, error: 'Not player turn' };
  }

  // Find the player's unit
  var unitId = 'player_' + socketId;
  var unit = combat.units.get(unitId);
  if (!unit) {
    return { success: false, error: 'Player not in this combat' };
  }
  if (!unit.alive) {
    return { success: false, error: 'Player is dead' };
  }

  // Check if it's actually this player's turn (they must be in the turn group)
  if (combat.turnGroup.indexOf(unitId) === -1) {
    return { success: false, error: 'Not your turn' };
  }

  // Check if this player already submitted their action
  if (combat.pendingActions.get(unitId) === true) {
    return { success: false, error: 'Already submitted action this turn' };
  }

  if (!action || !action.type) {
    return { success: false, error: 'Invalid action format' };
  }

  var result = null;

  switch (action.type) {
    case 'move':
      result = handleMoveAction(combat, unit, action.data);
      break;

    case 'attack':
      result = handleAttackAction(combat, unit, action.data);
      break;

    case 'ability':
      result = handleAbilityAction(combat, unit, action.data);
      break;

    case 'end_turn':
      result = handleEndTurnAction(combat, unit);
      break;

    case 'swap_card':
      result = handleSwapCardAction(combat, unit, action.data);
      break;

    case 'wait':
      result = handleWaitAction(combat, unit);
      break;

    case 'use_item':
      result = handleUseItemAction(combat, unit, action.data);
      break;

    case 'npc_heal':
      result = handleNPCHealAction(combat, unit, action.data);
      break;

    default:
      return { success: false, error: 'Unknown action type: ' + action.type };
  }

  if (!result) {
    return { success: false, error: 'Action processing failed' };
  }

  // After action: check if unit should auto-end turn (no AP and no MP)
  if (result.success && unit.ap <= 0 && unit.mp <= 0) {
    // Determine what the player did for CT reset
    var actionCategory = (action.type === 'attack' || action.type === 'ability') ? 'attacked' : (action.type === 'move' ? 'moved' : 'waited');
    combat.pendingActions.set(unitId, true);
    endUnitTurn(combat, unitId, actionCategory);
    result.turnEnded = true;
  } else if (result.success && (action.type === 'wait' || action.type === 'end_turn')) {
    combat.pendingActions.set(unitId, true);
    endUnitTurn(combat, unitId, 'waited');
    result.turnEnded = true;
  }

  // Broadcast action result to all players
  if (result.success && combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_combat_player_action', {
      combatId: combat.id,
      unitId: unitId,
      playerName: unit.name,
      action: action.type,
      result: sanitizeResult(result),
      unitX: unit.x,
      unitY: unit.y,
      unitHp: unit.hp,
      unitMaxHp: unit.maxHp,
      unitMp: unit.mp,
      unitAp: unit.ap,
      momentumShield: unit.momentumShield,
    });
  }

  // After a successful action, send updated valid actions to the player if turn is not over
  if (result.success && !result.turnEnded && combat.callbacks.emitToPlayer && unit.socketId) {
    var updatedMoveRange = calculateMoveRange(combat, unitId);
    var updatedTargets = getValidAttackTargets(combat, unitId);
    combat.callbacks.emitToPlayer(unit.socketId, 'tc_combat_turn_update', {
      combatId: combat.id,
      unitId: unitId,
      moveRange: updatedMoveRange,
      attackTargets: updatedTargets,
      mp: unit.mp,
      ap: unit.ap,
      hp: unit.hp,
      maxHp: unit.maxHp,
      momentumShield: unit.momentumShield,
    });
  }

  return result;
}

/**
 * Handle a move action from a player.
 */
function handleMoveAction(combat, unit, data) {
  if (!data || data.x === undefined || data.y === undefined) {
    return { success: false, error: 'Move requires x and y coordinates' };
  }

  var targetX = Math.floor(data.x);
  var targetY = Math.floor(data.y);

  // Validate the move
  var validation = validateMove(combat, unit.id, targetX, targetY);
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }

  // Execute the move
  var moveResult = executeMove(combat, unit.id, validation.path);

  return {
    success: true,
    type: 'move',
    path: validation.path,
    cost: validation.cost,
    tilesMoved: moveResult.tilesMoved,
    momentumShield: unit.momentumShield,
    events: moveResult.events || [],
    died: moveResult.died || false,
  };
}

/**
 * Handle an attack action from a player.
 */
function handleAttackAction(combat, unit, data) {
  if (!data || !data.targetId) {
    return { success: false, error: 'Attack requires targetId' };
  }

  var atkResult = executeBasicAttack(combat, unit.id, data.targetId);

  if (!atkResult.success) {
    return { success: false, error: atkResult.reason };
  }

  // Check sync attacks from allies
  var syncResults = combatSync.checkSyncAttacks(combat, unit.id, data.targetId);
  if (syncResults.length > 0) {
    var syncTarget = combat.units.get(data.targetId);
    for (var si = 0; si < syncResults.length; si++) {
      var syncHit = syncResults[si];
      if (syncTarget && syncTarget.alive) {
        // Apply sync damage
        var syncShieldAbsorbed = 0;
        var syncDmg = syncHit.damage;
        if (syncTarget.momentumShield > 0) {
          syncShieldAbsorbed = Math.min(syncTarget.momentumShield, syncDmg);
          syncTarget.momentumShield -= syncShieldAbsorbed;
          syncDmg -= syncShieldAbsorbed;
        }
        if (syncDmg > 0) syncTarget.hp -= syncDmg;
        if (syncTarget.hp <= 0) {
          syncTarget.alive = false;
          syncTarget.hp = 0;
          atkResult.targetDied = true;
        }
      }
    }
    atkResult.syncAttacks = syncResults;
  }

  // Handle target death (revive_on_death may undo this in handleUnitDeath)
  if (atkResult.targetDied) {
    handleUnitDeath(combat, data.targetId, unit.id);

    // Re-check if target actually died (revive_on_death may have saved them)
    var finalTarget = combat.units.get(data.targetId);
    if (finalTarget && finalTarget.alive) {
      atkResult.targetDied = false;
      atkResult.targetHp = finalTarget.hp;
    }

    // Check if combat should end after this kill
    var endCheck = checkCombatEnd(combat);
    if (endCheck) {
      // Delay the end slightly so the attack result broadcasts first
      var combatRef = combat;
      var endResult = endCheck;
      setTimeout(function() {
        endCombat(combatRef, endResult);
      }, 200);
    }
  }

  // Also check combat end if attacker died from thorns
  if (!unit.alive) {
    var thornEndCheck = checkCombatEnd(combat);
    if (thornEndCheck) {
      var thornCombatRef = combat;
      var thornEndResult = thornEndCheck;
      setTimeout(function() {
        endCombat(thornCombatRef, thornEndResult);
      }, 200);
    }
  }

  return {
    success: true,
    type: 'attack',
    targetId: data.targetId,
    damage: atkResult.damage,
    actualDamage: atkResult.actualDamage,
    isCrit: atkResult.isCrit,
    dodged: atkResult.dodged || false,
    blocked: atkResult.blocked || false,
    shieldAbsorbed: atkResult.shieldAbsorbed,
    manaShieldAbsorbed: atkResult.manaShieldAbsorbed || 0,
    targetDied: atkResult.targetDied,
    targetHp: atkResult.targetHp,
    targetMaxHp: atkResult.targetMaxHp,
    attackerAp: atkResult.attackerAp,
    attackerHp: atkResult.attackerHp,
    lifestealHeal: atkResult.lifestealHeal || 0,
    reflectDamage: atkResult.reflectDamage || 0,
    syncAttacks: atkResult.syncAttacks || [],
  };
}

/**
 * Handle a wait action from a player (skip turn).
 */
function handleWaitAction(combat, unit) {
  return {
    success: true,
    type: 'wait',
    unitId: unit.id,
  };
}

/**
 * Handle NPC healer heal action (direct heal without card system).
 */
function handleNPCHealAction(combat, unit, data) {
  if (!data || !data.targetId) {
    return { success: false, error: 'Heal requires targetId' };
  }
  var target = combat.units.get(data.targetId);
  if (!target || !target.alive || target.type !== 'player') {
    return { success: false, error: 'Invalid heal target' };
  }
  // NPC heal: restore 15-25% of target's maxHp, costs 10 mana
  if (unit.combat && unit.combat.mana !== undefined && unit.combat.mana >= 10) {
    unit.combat.mana -= 10;
  }
  var healAmount = Math.floor(target.maxHp * (0.15 + Math.random() * 0.10));
  target.hp = Math.min(target.maxHp, target.hp + healAmount);
  unit.ap = Math.max(0, unit.ap - 1);

  // Update threat for healing
  if (combat.isLichRaid && combat.threatTable) {
    updateThreat(combat, unit.id, healAmount, 'healing');
  }

  if (combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_combat_npc_heal', {
      combatId: combat.id,
      healerId: unit.id,
      healerName: unit.name,
      targetId: target.id,
      targetName: target.name,
      healAmount: healAmount,
      targetHp: target.hp,
      targetMaxHp: target.maxHp,
    });
  }

  return {
    success: true,
    type: 'npc_heal',
    unitId: unit.id,
    targetId: target.id,
    healAmount: healAmount,
  };
}

/**
 * Handle an ability action from a player.
 */
function handleAbilityAction(combat, unit, data) {
  if (!data) {
    return { success: false, error: 'Ability requires cardId or abilityIndex' };
  }

  // Support both cardId (direct) and abilityIndex (client sends 1-based index)
  var resolvedCardId = data.cardId;
  if (!resolvedCardId && data.abilityIndex !== undefined) {
    var eqCards = unit.equippedCards || [];
    var idx = Math.floor(data.abilityIndex) - 1; // client sends 1-based
    if (idx >= 0 && idx < eqCards.length && eqCards[idx]) {
      resolvedCardId = eqCards[idx].cardId || eqCards[idx].id;
    }
  }
  if (!resolvedCardId) {
    return { success: false, error: 'Ability requires cardId or valid abilityIndex' };
  }

  // Support both x/y and targetX/targetY coordinate naming
  var targetX = (data.targetX !== undefined) ? Math.floor(data.targetX) :
                (data.x !== undefined) ? Math.floor(data.x) : unit.x;
  var targetY = (data.targetY !== undefined) ? Math.floor(data.targetY) :
                (data.y !== undefined) ? Math.floor(data.y) : unit.y;

  var abilityResult = executeAbility(combat, unit.id, resolvedCardId, targetX, targetY);
  if (!abilityResult.success) {
    return { success: false, error: abilityResult.reason };
  }

  // Handle onHitTile — place tile effect at target position after damage
  var card = null;
  var equippedCards = unit.equippedCards || [];
  for (var ci = 0; ci < equippedCards.length; ci++) {
    if (equippedCards[ci] && (equippedCards[ci].id === resolvedCardId || equippedCards[ci].cardId === resolvedCardId)) {
      card = equippedCards[ci];
      break;
    }
  }
  var abilityTemplate = rpgData.CARD_BY_ID[(card && card.cardId) || ''] || {};
  if (card && (abilityTemplate.onHitTile || card.onHitTile) && abilityResult.effects) {
    // Place tile at target (for damage-type cards that also leave effects)
    var aoeR = (abilityTemplate.aoeRadius || card.aoeRadius || 0);
    if (aoeR > 0) {
      for (var tx = targetX - aoeR; tx <= targetX + aoeR; tx++) {
        for (var ty = targetY - aoeR; ty <= targetY + aoeR; ty++) {
          if (manhattanDist(tx, ty, targetX, targetY) <= aoeR) {
            combatTiles.createTileEffect(combat, tx, ty, (abilityTemplate.onHitTile || card.onHitTile), unit.id);
          }
        }
      }
    } else {
      combatTiles.createTileEffect(combat, targetX, targetY, (abilityTemplate.onHitTile || card.onHitTile), unit.id);
    }
  }

  // Handle onHitStatus — apply status to damaged targets
  // --- 3B: Iron Will debuff resistance check on ability on-hit status effects ---
  if (card && (abilityTemplate.onHitStatus || card.onHitStatus) && abilityResult.effects) {
    var onHitStatusObj = (abilityTemplate.onHitStatus || card.onHitStatus);
    for (var esi = 0; esi < abilityResult.effects.length; esi++) {
      var eff = abilityResult.effects[esi];
      if (eff.type === 'damage' && eff.targetId) {
        var statusTarget = combat.units.get(eff.targetId);
        if (statusTarget && statusTarget.alive) {
          // Check iron_will debuff resistance
          var onHitResisted = false;
          if (onHitStatusObj.type === 'debuff') {
            var onHitIronWill = getUnitCombatPassiveTotal(statusTarget, 'debuff_resist');
            if (onHitIronWill > 0 && Math.random() < onHitIronWill) {
              onHitResisted = true;
            }
          }
          // Check poison immunity
          if (!onHitResisted && onHitStatusObj.name === 'poisoned' && hasImmunity(statusTarget, 'poison')) {
            onHitResisted = true;
          }
          if (!onHitResisted) {
            if (!statusTarget.statusEffects) statusTarget.statusEffects = [];
            var statusCopy = {};
            var sKeys = Object.keys(onHitStatusObj);
            for (var ski = 0; ski < sKeys.length; ski++) {
              statusCopy[sKeys[ski]] = onHitStatusObj[sKeys[ski]];
            }
            statusCopy.sourceId = unit.id;
            statusTarget.statusEffects.push(statusCopy);
          }
        }
      }
    }
  }

  // Handle lifesteal
  if (card && (abilityTemplate.lifesteal || card.lifesteal) && abilityResult.effects) {
    var lifestealPct = (abilityTemplate.lifesteal || card.lifesteal);
    var totalDamageDealt = 0;
    for (var lsi = 0; lsi < abilityResult.effects.length; lsi++) {
      if (abilityResult.effects[lsi].type === 'damage') {
        totalDamageDealt += abilityResult.effects[lsi].actualDamage || 0;
      }
    }
    if (totalDamageDealt > 0) {
      var healAmount = Math.floor(totalDamageDealt * lifestealPct);
      if (healAmount > 0) {
        unit.hp = Math.min(unit.maxHp, unit.hp + healAmount);
        abilityResult.lifestealHeal = healAmount;
      }
    }
  }

  // Check deaths and combat end
  if (abilityResult.effects) {
    for (var dei = 0; dei < abilityResult.effects.length; dei++) {
      if (abilityResult.effects[dei].targetDied) {
        var deadId = abilityResult.effects[dei].targetId;
        handleUnitDeath(combat, deadId, unit.id);
      }
    }
    var endCheck = checkCombatEnd(combat);
    if (endCheck) {
      var combatRef = combat;
      var endResult = endCheck;
      setTimeout(function() { endCombat(combatRef, endResult); }, 200);
    }
  }

  return {
    success: true,
    type: 'ability',
    abilityName: abilityResult.abilityName,
    abilityId: abilityResult.abilityId,
    effects: abilityResult.effects,
    manaCost: abilityResult.manaCost,
    cooldown: abilityResult.cooldown,
    unitMana: abilityResult.unitMana,
    unitAp: unit.ap,
    lifestealHeal: abilityResult.lifestealHeal || 0,
  };
}

/**
 * Handle a swap_card action — swap an equipped card mid-combat (costs 1 AP).
 * data: { unequipInstanceId: string|null, equipInstanceId: string|null }
 */
function handleSwapCardAction(combat, unit, data) {
  if (!data) return { success: false, reason: 'No swap data' };
  if (unit.ap <= 0) return { success: false, reason: 'No action points remaining' };
  if (!combat.callbacks || !combat.callbacks.swapCard) {
    return { success: false, reason: 'Card swap not available' };
  }

  var result = combat.callbacks.swapCard(unit.socketId, data.unequipInstanceId || null, data.equipInstanceId || null);
  if (result.error) return { success: false, reason: result.error };

  // Deduct AP
  unit.ap -= 1;

  // Update the unit's equipped cards with the new resolved set
  if (result.resolvedCards) {
    unit.equippedCards = result.resolvedCards;
  }

  // Rebuild combat stats from the new card set
  var newCombat = unit.combat || {};
  // Reset card-derived bonuses before re-applying
  newCombat.spellDmgBonus = 0;
  newCombat.poisonDmgBonus = 0;
  newCombat.counterChanceBonus = 0;
  newCombat.manaEfficiency = 0;
  newCombat.elementalResistAll = 0;
  newCombat.lowHpDmgReduction = 0;
  newCombat.dungeonDmgBonus = 0;
  newCombat.bossDmgBonus = 0;
  newCombat.dungeonDefBonus = 0;
  newCombat.hpRegen = 0;

  // Re-apply passive effects from new equipped cards
  for (var ci = 0; ci < unit.equippedCards.length; ci++) {
    var card = unit.equippedCards[ci];
    if (!card || !card.combatPassive) continue;
    var passive = card.combatPassive;
    if (passive.type === 'spell_damage_bonus') newCombat.spellDmgBonus += (passive.value || 0);
    if (passive.type === 'poison_damage_bonus') newCombat.poisonDmgBonus += (passive.value || 0);
    if (passive.type === 'counter_chance_bonus') newCombat.counterChanceBonus += (passive.value || 0);
    if (passive.type === 'mana_efficiency') newCombat.manaEfficiency += (passive.value || 0);
    if (passive.type === 'elemental_resist_all') newCombat.elementalResistAll += (passive.value || 0);
    if (passive.type === 'low_hp_damage_reduction') newCombat.lowHpDmgReduction += (passive.value || 0);
    if (passive.type === 'dungeon_damage_bonus') newCombat.dungeonDmgBonus += (passive.value || 0);
    if (passive.type === 'boss_damage_bonus') newCombat.bossDmgBonus += (passive.value || 0);
    if (passive.type === 'dungeon_defense_bonus') newCombat.dungeonDefBonus += (passive.value || 0);
    if (passive.type === 'hp_regen') newCombat.hpRegen += (passive.value || 0);
  }

  // A1: Recalculate speed if weapon changed (weaponSpeed may differ)
  if (result.weaponSpeed !== undefined && result.weaponSpeed !== newCombat.weaponSpeed) {
    newCombat.weaponSpeed = result.weaponSpeed;
    var newBaseSpeed = rpgData.computeCombatSpeed(
      unit.race || null,
      (unit.combat && unit.combat.finesse) ? unit.combat.finesse : 5,
      unit.equippedCards || []
    );
    var wsMult = Math.max(0.5, Math.min(1.5, newCombat.weaponSpeed || 1.0));
    var asMod = newCombat.armorSpeedMod || 0;
    unit.speed = Math.max(1, Math.round(newBaseSpeed * wsMult * (1 + asMod)));
  }

  return {
    success: true,
    type: 'swap_card',
    unitId: unit.id,
    unitAp: unit.ap,
    equippedCards: unit.equippedCards,
  };
}

/**
 * A5: Handle a use_item action — consume food/potion in combat (costs 1 AP).
 * data: { resourceType: string }
 */
function handleUseItemAction(combat, unit, data) {
  if (!data || !data.resourceType) return { success: false, reason: 'No item specified' };
  if (unit.ap <= 0) return { success: false, reason: 'No action points remaining' };
  if (!combat.callbacks || !combat.callbacks.consumeItem) {
    return { success: false, reason: 'Item use not available in this combat' };
  }

  var result = combat.callbacks.consumeItem(unit.socketId, data.resourceType);
  if (result.error) return { success: false, reason: result.error };

  // Deduct AP
  unit.ap -= 1;

  // Apply HP restore
  var hpRestored = 0;
  if (result.hpRestored && result.hpRestored > 0) {
    var oldHp = unit.hp;
    unit.hp = Math.min(unit.maxHp, unit.hp + result.hpRestored);
    hpRestored = unit.hp - oldHp;
  }

  // Apply buff as status effect (convert seconds → combat turns at ~15s/turn)
  var buffApplied = null;
  if (result.buff && result.buff.stat && result.buff.value) {
    var buffTurns = Math.max(1, Math.ceil(result.buff.duration / 15));
    // Stat buff mapping
    var statBoosts = {};
    switch (result.buff.stat) {
      case 'vigor':   statBoosts.maxHpBoost = result.buff.value * 10; break;
      case 'might':   statBoosts.damageBoost = result.buff.value * 2; break;
      case 'finesse': statBoosts.speedMult = 1 + (result.buff.value * 0.05); break;
      case 'acumen':  statBoosts.magicDmgBoost = result.buff.value * 2; break;
      case 'resolve': statBoosts.damageReduction = result.buff.value; break;
      case 'focus':   statBoosts.manaRegen = result.buff.value; break;
      case 'presence': break; // No combat effect
    }

    // Prevent stacking: refresh duration if same buff type active
    var existingIdx = -1;
    for (var si = 0; si < unit.statusEffects.length; si++) {
      if (unit.statusEffects[si].name === 'food_buff_' + result.buff.stat) {
        existingIdx = si;
        break;
      }
    }

    var buffEffect = {
      name: 'food_buff_' + result.buff.stat,
      type: 'buff',
      duration: buffTurns,
      source: data.resourceType,
    };
    // Copy stat boosts onto the effect
    var boostKeys = Object.keys(statBoosts);
    for (var bk = 0; bk < boostKeys.length; bk++) {
      buffEffect[boostKeys[bk]] = statBoosts[boostKeys[bk]];
    }

    if (existingIdx >= 0) {
      // Refresh: revert old maxHpBoost before replacing
      var oldEffect = unit.statusEffects[existingIdx];
      if (oldEffect.maxHpBoost) {
        unit.maxHp -= oldEffect.maxHpBoost;
        unit.hp = Math.min(unit.hp, unit.maxHp);
      }
      unit.statusEffects[existingIdx] = buffEffect;
    } else {
      unit.statusEffects.push(buffEffect);
    }

    // Apply maxHpBoost immediately
    if (statBoosts.maxHpBoost) {
      unit.maxHp += statBoosts.maxHpBoost;
    }

    buffApplied = { stat: result.buff.stat, value: result.buff.value, turns: buffTurns };
  }

  return {
    success: true,
    type: 'use_item',
    unitId: unit.id,
    unitAp: unit.ap,
    unitHp: unit.hp,
    unitMaxHp: unit.maxHp,
    hpRestored: hpRestored,
    resourceType: data.resourceType,
    buff: buffApplied,
  };
}

/**
 * Handle an end_turn action from a player (explicitly end turn).
 */
function handleEndTurnAction(combat, unit) {
  return {
    success: true,
    type: 'end_turn',
    unitId: unit.id,
  };
}

/**
 * Sanitize a result object for network transmission (strip internal fields).
 */
function sanitizeResult(result) {
  var clean = {};
  var keys = Object.keys(result);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var val = result[key];
    // Skip functions and very large arrays
    if (typeof val === 'function') continue;
    clean[key] = val;
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Player disconnect handling
// ---------------------------------------------------------------------------

/**
 * Handle a player disconnecting mid-combat.
 * Sets their unit to auto-defend mode (auto-wait on their turns).
 */
function handlePlayerDisconnect(combatId, socketId) {
  var combat = null;

  // If combatId provided, use it directly; otherwise look up
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

  // If there's a pending reaction for this player, resolve it as a pass
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

  // If it's currently this player's turn and they haven't acted, auto-wait
  if (combat.state === 'player_turn' && combat.pendingActions.has(unitId) && !combat.pendingActions.get(unitId)) {
    combat.pendingActions.set(unitId, true);
    endUnitTurn(combat, unitId, 'waited');
  }

  // Broadcast disconnect notice
  if (combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_combat_player_disconnect', {
      combatId: combat.id,
      unitId: unitId,
      playerName: unit.name,
    });
  }
}

/**
 * Handle a player reconnecting to combat.
 * Clears auto-defend and sends them the current combat state.
 */
function handlePlayerReconnect(combatId, socketId) {
  var combat = activeCombats.get(combatId);
  if (!combat) return;

  var unitId = 'player_' + socketId;
  var unit = combat.units.get(unitId);
  if (!unit) return;

  unit.autoDefend = false;
  unit.socketId = socketId; // Update in case socket ID changed
  socketToCombat.set(socketId, combatId);

  // Send full combat state to reconnected player
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

/**
 * Add a new player to an active combat (late-join).
 * Inserts them into the initiative order at a reasonable CT value.
 * @param {string} combatId
 * @param {Object} playerData - Same shape as players passed to initCombat:
 *   { socketId, x, y, name, race, rpgStats, level, equippedCards, combat }
 * @returns {boolean} true if successfully added
 */
function addPlayerToCombat(combatId, playerData) {
  var combat = activeCombats.get(combatId);
  if (!combat) return false;

  var p = playerData;
  var pUnitId = 'player_' + p.socketId;

  // Already in this combat
  if (combat.units.has(pUnitId)) return false;

  // Already in another combat
  if (socketToCombat.has(p.socketId)) return false;

  var pSpeed = rpgData.computeCombatSpeed(
    p.race || 'human',
    (p.rpgStats && p.rpgStats.finesse) ? p.rpgStats.finesse : 5,
    p.equippedCards || []
  );
  var pCombat = p.combat || {};

  // Start at CT 0 so they don't immediately act — they'll build up naturally
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
    // Resource tracking fields
    _lastTargetId: null,   // For focus consecutive tracking
    _killThisTurn: false,  // For bloodlust decay tracking
    _lastActionTurn: 0,    // For bloodlust decay delay tracking
  };

  combat.units.set(pUnitId, playerUnit);
  socketToCombat.set(p.socketId, combatId);

  // Send full combat state to the joining player
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

  // Notify existing players
  if (combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_combat_initiative', {
      combatId: combat.id,
      units: serializeUnits(combat),
      initiative: buildInitiativeOrder(combat),
      joinedUnit: { id: pUnitId, name: playerUnit.name, x: playerUnit.x, y: playerUnit.y },
    });
  }

  // Re-evaluate group scaling with the new player
  applyGroupScaling(combat);
  checkReinforcements(combat);

  return true;
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

/**
 * Get full combat state for a given combatId.
 */
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

/**
 * Find which combat a socket is in.
 * Returns the combat object or null.
 */
function getCombatBySocketId(socketId) {
  var combatId = socketToCombat.get(socketId);
  if (!combatId) return null;
  return activeCombats.get(combatId) || null;
}

/**
 * Return the activeCombats Map reference.
 */
function getActiveCombats() {
  return activeCombats;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Build initiative order (sorted by CT descending) for display.
 */
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

/**
 * Serialize units Map into a plain array for network transmission.
 */
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

/**
 * Get all player socket IDs in a combat.
 */
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

/**
 * Get enemy list for broadcasting.
 */
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

/**
 * Get player list for broadcasting.
 */
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

// ---------------------------------------------------------------------------
// Ability execution
// ---------------------------------------------------------------------------

/**
 * Find a unit at a specific grid position from the combat units Map.
 * Returns the unit object or null.
 */
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

/**
 * Collect all alive units within manhattan distance `radius` of (cx, cy).
 * Returns an array of unit objects.
 */
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
// Lich Raid Boss Combat System
// ---------------------------------------------------------------------------

// Threat table: tracks cumulative threat per unit across the raid fight
// combat.threatTable = Map<unitId, { damage: 0, healing: 0, total: 0 }>
// combat.partyGroups = [[unitIds], [unitIds], ...]
// combat.lichRaidPhase = 1-4
// combat.phylacteries = [] (phase 2 destructible units)

function updateThreat(combat, unitId, amount, type) {
  if (!combat.threatTable) return;
  var entry = combat.threatTable.get(unitId);
  if (!entry) {
    entry = { damage: 0, healing: 0, total: 0 };
    combat.threatTable.set(unitId, entry);
  }
  var mult = (type === 'healing') ? 0.5 : (type === 'taunt') ? 2.0 : 1.0;
  var threatAmount = Math.abs(amount) * mult;
  if (type === 'damage') entry.damage += Math.abs(amount);
  else if (type === 'healing') entry.healing += Math.abs(amount);
  entry.total += threatAmount;
  combat.threatTable.set(unitId, entry);
}

function getTopThreats(combat, count) {
  if (!combat.threatTable) return [];
  var entries = [];
  var iter = combat.threatTable.entries();
  var e = iter.next();
  while (!e.done) {
    var unit = combat.units.get(e.value[0]);
    if (unit && unit.alive && unit.type === 'player') {
      entries.push({ id: e.value[0], threat: e.value[1].total });
    }
    e = iter.next();
  }
  entries.sort(function(a, b) { return b.threat - a.threat; });
  return entries.slice(0, count).map(function(e) { return e.id; });
}

function getLowestHpPlayer(combat) {
  var lowest = null;
  var lowestHp = Infinity;
  var iter = combat.units.values();
  var e = iter.next();
  while (!e.done) {
    if (e.value.type === 'player' && e.value.alive && e.value.hp < lowestHp) {
      lowest = e.value.id;
      lowestHp = e.value.hp;
    }
    e = iter.next();
  }
  return lowest;
}

function getBestClusterTarget(combat) {
  // Find the player position with most allies within 2 tiles
  var bestId = null;
  var bestCount = 0;
  var playerPositions = [];
  var iter = combat.units.values();
  var e = iter.next();
  while (!e.done) {
    if (e.value.type === 'player' && e.value.alive) {
      playerPositions.push({ id: e.value.id, x: e.value.x, y: e.value.y });
    }
    e = iter.next();
  }
  for (var i = 0; i < playerPositions.length; i++) {
    var count = 0;
    for (var j = 0; j < playerPositions.length; j++) {
      if (i === j) continue;
      var dist = Math.abs(playerPositions[i].x - playerPositions[j].x) +
                 Math.abs(playerPositions[i].y - playerPositions[j].y);
      if (dist <= 2) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestId = playerPositions[i].id;
    }
  }
  return bestId || (playerPositions.length > 0 ? playerPositions[0].id : null);
}

function getRandomPartyTargets(combat) {
  // Pick a random party group and return all alive member unitIds
  if (!combat.partyGroups || combat.partyGroups.length === 0) return [];
  var aliveGroups = [];
  for (var gi = 0; gi < combat.partyGroups.length; gi++) {
    var aliveMembers = [];
    for (var mi = 0; mi < combat.partyGroups[gi].length; mi++) {
      var unit = combat.units.get(combat.partyGroups[gi][mi]);
      if (unit && unit.alive) aliveMembers.push(unit.id);
    }
    if (aliveMembers.length > 0) aliveGroups.push(aliveMembers);
  }
  if (aliveGroups.length === 0) return [];
  return aliveGroups[Math.floor(Math.random() * aliveGroups.length)];
}

function selectBossTarget(combat, actionIndex) {
  var mode = actionIndex % 4;
  switch (mode) {
    case 0: // highest threat
      var topThreats = getTopThreats(combat, 1);
      return topThreats.length > 0 ? { targets: [topThreats[0]], mode: 'highest_threat' } : null;
    case 1: // lowest HP — finish off weak targets
      var lowHp = getLowestHpPlayer(combat);
      return lowHp ? { targets: [lowHp], mode: 'lowest_hp' } : null;
    case 2: // AoE cluster — hit densest player group
      var cluster = getBestClusterTarget(combat);
      return cluster ? { targets: [cluster], mode: 'cluster_aoe', isAoE: true } : null;
    case 3: // random party — attack entire party
      var partyTargets = getRandomPartyTargets(combat);
      return partyTargets.length > 0 ? { targets: partyTargets, mode: 'random_party', isPartyWide: true } : null;
    default:
      return null;
  }
}

var _spawnAddSeq = 0;

function spawnCombatAdd(combat, addTemplate, count) {
  var spawned = [];
  for (var i = 0; i < count; i++) {
    var addId = 'add_' + Date.now() + '_' + (++_spawnAddSeq);
    var add = {
      id: addId,
      type: 'enemy',
      name: addTemplate.name || 'Summoned Undead',
      hp: addTemplate.hp || 50,
      maxHp: addTemplate.hp || 50,
      x: 0,
      y: 0,
      ct: 0,
      speed: addTemplate.speed || 8,
      alive: true,
      statusEffects: [],
      equippedCards: [],
      abilityCooldowns: new Map(),
      combat: {
        atk: addTemplate.atk || 15,
        def: addTemplate.def || 5,
      },
      abilities: addTemplate.abilities || [],
      xp: addTemplate.xp || 10,
      gold: addTemplate.gold || 5,
      isBoss: false,
      isPhylactery: addTemplate.isPhylactery || false,
      isAdd: true,
    };
    // Find a walkable, unoccupied spawn position
    var spawnX = (addTemplate.x != null) ? addTemplate.x : Math.floor(Math.random() * (combat.floor ? combat.floor.width : 20));
    var spawnY = (addTemplate.y != null) ? addTemplate.y : Math.floor(Math.random() * (combat.floor ? combat.floor.height : 20));
    if (combat.floor && combat.floor.grid) {
      if (!isWalkableCombat(combat.floor.grid, spawnX, spawnY, combat.floor.width, combat.floor.height, null) || getUnitAtPosition(combat, spawnX, spawnY)) {
        var _spawnFound = false;
        for (var _sr = 1; _sr <= 5 && !_spawnFound; _sr++) {
          var _adj = getAdjacentTiles(spawnX, spawnY, combat.floor.width, combat.floor.height);
          for (var _ai = 0; _ai < _adj.length; _ai++) {
            if (isWalkableCombat(combat.floor.grid, _adj[_ai].x, _adj[_ai].y, combat.floor.width, combat.floor.height, null) && !getUnitAtPosition(combat, _adj[_ai].x, _adj[_ai].y)) {
              spawnX = _adj[_ai].x; spawnY = _adj[_ai].y; _spawnFound = true; break;
            }
          }
          if (!_spawnFound) { spawnX += _sr; spawnY += _sr; }
        }
      }
    }
    add.x = spawnX;
    add.y = spawnY;
    combat.units.set(addId, add);
    spawned.push(add);
  }

  // Broadcast spawned adds
  if (combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_units_spawned', {
      combatId: combat.id,
      units: spawned.map(function(u) {
        return { id: u.id, name: u.name, hp: u.hp, maxHp: u.maxHp, x: u.x, y: u.y, isPhylactery: u.isPhylactery };
      }),
    });
  }
  return spawned;
}

// Lich raid boss phase configuration
var LICH_RAID_PHASES = [
  { threshold: 1.0, name: 'Awakening', addsPerCycle: 2, addType: 'skeleton' },
  { threshold: 0.7, name: 'Phylactery Shield', phylacteryCount: 4, bossImmune: true },
  { threshold: 0.4, name: 'Necrotic Storm', addsPerParty: 1, hasCorruptionZones: true, deathCoilMult: 2.0 },
  { threshold: 0.15, name: 'Undeath Unbound', enrage: true, atkMult: 1.5, soulHarvestAll: true, deathStormMult: 2.5 },
];

function getLichRaidPhase(combat) {
  if (!combat.isLichRaid) return 0;
  var bossUnit = null;
  var iter = combat.units.values();
  var e = iter.next();
  while (!e.done) {
    if (e.value.isBoss && e.value.alive) { bossUnit = e.value; break; }
    e = iter.next();
  }
  if (!bossUnit) return combat.lichRaidPhase || 1;
  var hpPct = bossUnit.hp / bossUnit.maxHp;
  if (hpPct <= 0.15) return 4;
  if (hpPct <= 0.40) return 3;
  if (hpPct <= 0.70) return 2;
  return 1;
}

function handleLichRaidPhaseTransition(combat, oldPhase, newPhase) {
  if (oldPhase === newPhase) return;
  combat.lichRaidPhase = newPhase;
  var phaseDef = LICH_RAID_PHASES[newPhase - 1];

  // Broadcast phase change
  if (combat.callbacks.broadcastToFloor) {
    combat.callbacks.broadcastToFloor('tc_boss_phase_change', {
      combatId: combat.id,
      phase: newPhase,
      phaseName: phaseDef.name,
      message: 'Phase ' + newPhase + ': ' + phaseDef.name,
    });
  }

  // Phase 2: spawn phylacteries, boss becomes immune
  if (newPhase === 2) {
    var bossUnit = null;
    var iter = combat.units.values();
    var e = iter.next();
    while (!e.done) {
      if (e.value.isBoss && e.value.alive) { bossUnit = e.value; break; }
      e = iter.next();
    }
    if (bossUnit) {
      bossUnit._isPhylacteryImmune = true;
      var phylHp = Math.ceil(bossUnit.maxHp * 0.05);
      combat.phylacteries = [];
      for (var phi = 0; phi < 4; phi++) {
        var phylactery = {
          name: 'Phylactery of Veranthos',
          hp: phylHp,
          atk: 0,
          def: 10,
          speed: 1,
          x: bossUnit.x + (phi % 2 === 0 ? -3 : 3),
          y: bossUnit.y + (phi < 2 ? -3 : 3),
          isPhylactery: true,
          xp: 20,
          gold: 10,
        };
        var spawned = spawnCombatAdd(combat, phylactery, 1);
        combat.phylacteries.push(spawned[0].id);
      }
    }
  }

  // Phase 3: spawn unkillable adds (1 per party)
  if (newPhase === 3) {
    var bossUnit2 = null;
    var iter2 = combat.units.values();
    var e2 = iter2.next();
    while (!e2.done) {
      if (e2.value.isBoss && e2.value.alive) { bossUnit2 = e2.value; break; }
      e2 = iter2.next();
    }
    if (bossUnit2) {
      // Remove phylactery immunity
      bossUnit2._isPhylacteryImmune = false;
      // Burst damage on transition
      var burstDmg = Math.ceil(bossUnit2.maxHp * 0.10);
      bossUnit2.hp = Math.max(1, bossUnit2.hp - burstDmg);
    }
    // Spawn undead adds (1 per party group)
    var addCount = combat.partyGroups ? combat.partyGroups.length : 1;
    spawnCombatAdd(combat, {
      name: 'Necrotic Shade',
      hp: 200,
      atk: 20,
      def: 15,
      speed: 10,
    }, addCount);
  }

  // Phase 4: enrage
  if (newPhase === 4) {
    var bossUnit3 = null;
    var iter3 = combat.units.values();
    var e3 = iter3.next();
    while (!e3.done) {
      if (e3.value.isBoss && e3.value.alive) { bossUnit3 = e3.value; break; }
      e3 = iter3.next();
    }
    if (bossUnit3 && bossUnit3.combat) {
      bossUnit3.combat.atk = Math.ceil((bossUnit3._baseAtk || bossUnit3.combat.atk) * 1.5);
    }
  }
}

function checkPhylacteries(combat) {
  if (!combat.phylacteries || combat.phylacteries.length === 0) return;
  var allDestroyed = true;
  for (var pi = 0; pi < combat.phylacteries.length; pi++) {
    var phyl = combat.units.get(combat.phylacteries[pi]);
    if (phyl && phyl.alive) {
      allDestroyed = false;
      break;
    }
  }
  if (allDestroyed && combat.lichRaidPhase === 2) {
    // Force transition to phase 3
    handleLichRaidPhaseTransition(combat, 2, 3);
  }
}

function initRaidBossCombat(dungeonId, parties, bossData, floor, callbacks) {
  // parties: { partyId: [{ socketId, name, combat, rpgStats, race, equippedCards, x, y }] }
  var allPlayers = [];
  var partyGroups = [];

  var partyKeys = Object.keys(parties);
  for (var pi = 0; pi < partyKeys.length; pi++) {
    var partyMembers = parties[partyKeys[pi]];
    var groupIds = [];
    for (var mi = 0; mi < partyMembers.length; mi++) {
      allPlayers.push(partyMembers[mi]);
      groupIds.push('player_' + partyMembers[mi].socketId);
    }
    partyGroups.push(groupIds);
  }

  // Scale boss based on real player count
  var scaleFactor = callbacks.scaleFactor || 1.0;
  var playerCount = allPlayers.length;
  var scaledBoss = {
    id: bossData.id || 'ls_archlich',
    name: bossData.name || 'Archlich Veranthos',
    hp: Math.ceil(bossData.hp * (2 + playerCount * 0.5) * scaleFactor),
    atk: Math.ceil(bossData.atk * (1.5 + playerCount * 0.05) * scaleFactor),
    def: Math.ceil(bossData.def * 1.5),
    xp: bossData.xp * playerCount,
    gold: bossData.gold * playerCount,
    abilities: bossData.abilities || [],
    isBoss: true,
  };

  var enemies = [scaledBoss];

  // Use standard initCombat then enhance with raid features
  var raidCallbacks = {};
  for (var k in callbacks) {
    if (callbacks.hasOwnProperty(k)) raidCallbacks[k] = callbacks[k];
  }
  raidCallbacks.isRaid = true;

  var combat = initCombat(dungeonId, allPlayers, enemies, floor, raidCallbacks);

  // Enhance with lich raid features
  if (combat && activeCombats.has(combat)) {
    // combat is a combatId string from initCombat broadcast
    // Need to get the actual combat object
  }

  // Find the actual combat by ID (initCombat stores it in activeCombats)
  var combatObj = null;
  var combatIter = activeCombats.values();
  var cEntry = combatIter.next();
  while (!cEntry.done) {
    if (cEntry.value.dungeonId === dungeonId && cEntry.value.state !== 'combat_end') {
      combatObj = cEntry.value;
      break;
    }
    cEntry = combatIter.next();
  }

  if (combatObj) {
    combatObj.isLichRaid = true;
    combatObj.threatTable = new Map();
    combatObj.partyGroups = partyGroups;
    combatObj.lichRaidPhase = 1;
    combatObj.phylacteries = [];
    combatObj.bossActionCount = Math.max(1, Math.ceil(playerCount / 4));
    combatObj._raidScaleFactor = scaleFactor;

    // Initialize threat for all players
    for (var ti = 0; ti < allPlayers.length; ti++) {
      combatObj.threatTable.set('player_' + allPlayers[ti].socketId, { damage: 0, healing: 0, total: 0 });
    }
  }

  return combatObj;
}

// Execute lich raid boss multi-action turn
function executeLichRaidBossTurn(combat) {
  var bossUnit = null;
  var iter = combat.units.values();
  var e = iter.next();
  while (!e.done) {
    if (e.value.isBoss && e.value.alive) { bossUnit = e.value; break; }
    e = iter.next();
  }
  if (!bossUnit) return;

  // Check phase transition
  var oldPhase = combat.lichRaidPhase || 1;
  var newPhase = getLichRaidPhase(combat);
  if (newPhase !== oldPhase) {
    handleLichRaidPhaseTransition(combat, oldPhase, newPhase);
  }

  // Check phylacteries (phase 2 immunity)
  checkPhylacteries(combat);

  // Boss is immune during phase 2 if phylacteries alive
  if (bossUnit._isPhylacteryImmune) {
    // Boss still attacks but can't be damaged
    // This is checked in damage calculation, not here
  }

  // Calculate number of actions
  var alivePlayerCount = 0;
  var pIter = combat.units.values();
  var pE = pIter.next();
  while (!pE.done) {
    if (pE.value.type === 'player' && pE.value.alive) alivePlayerCount++;
    pE = pIter.next();
  }
  var actionCount = Math.max(1, Math.ceil(alivePlayerCount / 4));

  // Phase 1: spawn skeleton adds
  var phaseDef = LICH_RAID_PHASES[(combat.lichRaidPhase || 1) - 1];
  if (phaseDef && phaseDef.addsPerCycle) {
    spawnCombatAdd(combat, {
      name: 'Skeletal Guardian',
      hp: 80,
      atk: 12,
      def: 8,
      speed: 6,
      xp: 5,
      gold: 3,
    }, phaseDef.addsPerCycle);
  }

  // Phase 4: Soul Harvest hits ALL players
  if (combat.lichRaidPhase === 4 && bossUnit.combat) {
    var soulHarvestDmg = Math.ceil(bossUnit.combat.atk * 0.3);
    var allPlayerIter = combat.units.values();
    var apE = allPlayerIter.next();
    var soulHarvestTargets = [];
    while (!apE.done) {
      if (apE.value.type === 'player' && apE.value.alive) {
        apE.value.hp = Math.max(0, apE.value.hp - soulHarvestDmg);
        var shKilled = apE.value.hp <= 0;
        if (shKilled) { apE.value.alive = false; apE.value.hp = 0; }
        soulHarvestTargets.push({ id: apE.value.id, damage: soulHarvestDmg, hp: apE.value.hp });
        if (shKilled) handleUnitDeath(combat, apE.value.id, bossUnit.id);
      }
      apE = allPlayerIter.next();
    }
    if (soulHarvestTargets.length > 0 && combat.callbacks.broadcastToFloor) {
      combat.callbacks.broadcastToFloor('tc_boss_soul_harvest', {
        combatId: combat.id,
        bossId: bossUnit.id,
        targets: soulHarvestTargets,
        damage: soulHarvestDmg,
        message: 'Archlich Veranthos unleashes Soul Harvest on all players!',
      });
    }
  }

  // Execute boss actions with threat-based targeting
  for (var ai = 0; ai < actionCount; ai++) {
    var targetInfo = selectBossTarget(combat, ai);
    if (!targetInfo || !targetInfo.targets || targetInfo.targets.length === 0) continue;

    var abilityIndex = ai % (bossUnit.abilities ? bossUnit.abilities.length : 1);
    var ability = bossUnit.abilities ? bossUnit.abilities[abilityIndex] : null;
    var baseDmg = bossUnit.combat ? bossUnit.combat.atk : 30;
    var dmgMult = ability ? (ability.damage || 1.0) : 1.0;

    // Phase 3: Death Coil gets 2x multiplier
    if (combat.lichRaidPhase === 3 && ability && ability.id === 'death_coil') {
      dmgMult *= 2.0;
    }
    // Phase 4: Death Storm gets 2.5x
    if (combat.lichRaidPhase === 4 && ability && ability.id === 'death_storm') {
      dmgMult *= 2.5;
    }

    var totalDmg = Math.ceil(baseDmg * dmgMult);

    for (var ti = 0; ti < targetInfo.targets.length; ti++) {
      var targetUnit = combat.units.get(targetInfo.targets[ti]);
      if (!targetUnit || !targetUnit.alive) continue;

      // Apply party-wide reduced damage if hitting multiple
      var multiTargetReduction = targetInfo.isPartyWide ? 0.6 : 1.0;
      var finalDmg = Math.ceil(totalDmg * multiTargetReduction);

      // Apply defense
      var targetDef = targetUnit.combat ? (targetUnit.combat.def || 0) : 0;
      finalDmg = Math.max(1, finalDmg - Math.floor(targetDef * 0.3));

      targetUnit.hp = Math.max(0, targetUnit.hp - finalDmg);
      if (targetUnit.hp <= 0) {
        targetUnit.alive = false;
        targetUnit.hp = 0;
        handleUnitDeath(combat, targetUnit.id, bossUnit.id);
      }

      // Update threat (boss attacking increases target's threat slightly)
      if (targetUnit.alive) updateThreat(combat, targetUnit.id, finalDmg * 0.1, 'damage');
    }

    // Broadcast boss attack
    if (combat.callbacks.broadcastToFloor) {
      combat.callbacks.broadcastToFloor('tc_boss_attack', {
        combatId: combat.id,
        bossId: bossUnit.id,
        actionIndex: ai,
        targetMode: targetInfo.mode,
        targets: targetInfo.targets.map(function(tId) {
          var u = combat.units.get(tId);
          return u ? { id: u.id, hp: u.hp, maxHp: u.maxHp, alive: u.alive } : { id: tId };
        }),
        ability: ability ? { id: ability.id, name: ability.name } : null,
        damage: totalDmg,
      });
    }
  }

  // Phase 3: corruption zones — mark 3x3 areas that deal damage
  if (combat.lichRaidPhase === 3) {
    var numZones = Math.min(3, Math.max(1, Math.floor(alivePlayerCount / 4)));
    var corruptionZones = [];
    for (var zi = 0; zi < numZones; zi++) {
      // Pick a random player position for zone placement
      var randomTarget = getBestClusterTarget(combat);
      var zoneUnit = randomTarget ? combat.units.get(randomTarget) : null;
      if (zoneUnit) {
        corruptionZones.push({ x: zoneUnit.x, y: zoneUnit.y, radius: 1, damage: Math.ceil(baseDmg * 0.4) });
      }
    }
    if (corruptionZones.length > 0 && combat.callbacks.broadcastToFloor) {
      combat.callbacks.broadcastToFloor('tc_corruption_zones', {
        combatId: combat.id,
        zones: corruptionZones,
        message: 'Necrotic corruption erupts from the ground!',
      });
    }
  }

  // Check for combat end after boss actions
  var checkResult = checkCombatEnd(combat);
  if (checkResult) {
    endCombat(combat, checkResult);
    return;
  }

  // Continue to next player turn cycle
  advanceCombat(combat);
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
