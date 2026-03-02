// dungeon-ai.js
// Enemy AI engine for dungeon floors.
// Exports: tickFloorAI, initEnemyAI, ARCHETYPES, STATUS_EFFECTS,
//          TACTICAL_DEFAULTS, scoreTacticalAbility, selectBestAbility

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var AI_TICK_MS = 300;
var IDLE_TICK_MS = 2000;     // Slow tick for floors with no players near enemies
var PATROL_WANDER_CHANCE = 0.3;  // 30% chance to take a step each patrol tick
var ALERT_DURATION = 3;      // ticks before alert -> reset
var SEARCH_DURATION = 5;     // ticks searching last known position
var ATTACK_WINDUP_TICKS = 2; // default wind-up before attack lands
var RECOVER_TICKS = 2;       // default cooldown after attack
var GROUP_ALERT_RANGE = 6;   // tiles: when one enemy chases, nearby allies alert
var MAX_ATTACKERS = 3;       // max enemies attacking same player simultaneously
var HEARING_RADIUS = 8;      // tiles: combat sounds alert nearby enemies
var MEMORY_DURATION = 10;    // ticks: how long enemies remember last known position

// Archetype-specific defaults
var ARCHETYPES = {
  bruiser: {
    preferredRange: 1,     // wants to be adjacent
    speed: 1,              // tiles per move action
    aggroWeight: 1.2,      // more likely to chase
    flankPreference: 0.3,  // low flanking priority (charges straight in)
    retreatThreshold: 0.0, // never retreats
  },
  skirmisher: {
    preferredRange: 1,
    speed: 2,              // moves 2 tiles per action
    aggroWeight: 0.8,
    flankPreference: 0.8,  // strongly prefers flanking
    retreatThreshold: 0.3, // retreats at 30% HP
    hitAndRun: true,       // attacks then repositions
  },
  ranged: {
    preferredRange: 2,     // wants 2 tiles distance (reduced from 4 for fair gameplay)
    speed: 1,
    aggroWeight: 0.6,
    flankPreference: 0.5,
    retreatThreshold: 0.4, // retreats at 40% HP
    keepDistance: true,     // actively moves away if too close
  },
  controller: {
    preferredRange: 3,
    speed: 1,
    aggroWeight: 0.7,
    flankPreference: 0.4,
    retreatThreshold: 0.3,
    preferDebuff: true,    // prioritizes debuff abilities
  },
  support: {
    preferredRange: 3,
    speed: 1,
    aggroWeight: 0.4,      // least aggressive
    flankPreference: 0.2,
    retreatThreshold: 0.5, // retreats at 50% HP
    preferHeal: true,      // prioritizes healing allies
    stayNearAllies: true,
  },
  elite: {
    preferredRange: 2,
    speed: 1,
    aggroWeight: 1.0,
    flankPreference: 0.6,
    retreatThreshold: 0.15,
    phaseShift: true,      // can change behavior at HP thresholds
  },
};

// Status effect definitions
var STATUS_EFFECTS = {
  bleed:  { tickDamage: 2, duration: 5, stackable: true, maxStacks: 3 },
  burn:   { tickDamage: 3, duration: 4, stackable: false },
  poison: { tickDamage: 1, duration: 8, stackable: true, maxStacks: 5 },
  slow:   { speedMult: 0.5, duration: 4, stackable: false },
  stun:   { skipTurn: true, duration: 2, stackable: false },
  fear:   { fleeing: true, duration: 3, stackable: false },
};

// ---------------------------------------------------------------------------
// Tactical Scoring: evaluate each ability against current situation
// Higher score = more likely to be chosen
// ---------------------------------------------------------------------------

var TACTICAL_WEIGHTS = {
  // Situation modifiers
  SELF_LOW_HP: 0.3,         // enemy is below 30% HP
  SELF_MID_HP: 0.6,         // enemy is below 60% HP
  TARGET_LOW_HP: 0.3,       // target is below 30% HP
  TARGET_MID_HP: 0.6,       // target is below 60% HP
  ALLY_LOW_HP: 0.3,         // nearby ally below 30% HP
  TARGET_IN_RANGE: 1.0,     // target is within ability range
  TARGET_OUT_OF_RANGE: 0.0, // target is beyond ability range
  TARGET_ADJACENT: 1.0,     // target is melee range
  MULTIPLE_TARGETS: 1.0,    // multiple enemies/players nearby
  ABILITY_ON_COOLDOWN: -999, // can't use it
};

// Tactical tags on abilities: what situation each ability is good for
// Looked up by ability.id when ability.tactical is not set inline
var TACTICAL_DEFAULTS = {
  // --- Archetype default abilities ---
  heavy_strike:      { ATTACK: 2, FINISH: 1 },
  quick_slash:       { ATTACK: 1.5, ESCAPE: 0.5 },
  ranged_shot:       { ATTACK: 1.5, KITE: 1 },
  power_slam:        { ATTACK: 2, DISABLE: 1.5 },
  boss_roar:         { DISABLE: 2, AOE: 1 },
  enraged_strike:    { ATTACK: 2.5 },
  desperate_flurry:  { ATTACK: 3, FINISH: 2 },
  death_throes:      { ATTACK: 2, AOE: 1.5 },
  debuff_strike:     { DISABLE: 2, ATTACK: 0.5 },
  spectral_arrow:    { ATTACK: 1.5, KITE: 1 },
  crystal_lance:     { ATTACK: 2, KITE: 1 },
  shatter_ward:      { DISABLE: 1.5, DEBUFF: 2 },
  psychic_pulse:     { DISABLE: 2, AOE: 1 },
  flame_bolt:        { ATTACK: 1.5, KITE: 1 },
  frost_bolt:        { ATTACK: 1, DISABLE: 1.5 },
  blizzard:          { AOE: 2, DISABLE: 1.5 },
  frost_wail:        { DISABLE: 2, AOE: 1 },
  wail:              { DISABLE: 2, AOE: 1 },        // alias used by Frost Banshee
  venom_spit:        { ATTACK: 1, DEBUFF: 2 },
  chain_lightning:   { ATTACK: 2, AOE: 1.5 },
  fireball:          { ATTACK: 2, AOE: 1 },
  frenzy:            { ATTACK: 3 },
  shadow_strike:     { ATTACK: 2, DISABLE: 1 },
  shield_bash:       { DISABLE: 2, DEFEND: 1 },
  // --- Heals ---
  ally_heal:         { HEAL: 3 },
  spore_heal:        { HEAL: 2.5 },
  spore_mend:        { HEAL: 2.5 },
  heal_pulse:        { HEAL: 3, AOE_HEAL: 1 },
  rebirth_flame:     { HEAL: 3 },
  tidal_mend:        { HEAL: 2.5 },
  regenerate:        { HEAL: 2.5 },
  raise_dead:        { HEAL: 3 },
  support_strike:    { ATTACK: 0.5 },
  // --- Boss-specific abilities ---
  spore_slam:        { ATTACK: 2, DISABLE: 0.5 },
  toxic_cloud:       { AOE: 2, DEBUFF: 1.5 },
  spore_burst:       { ATTACK: 2, AOE: 1, DEBUFF: 1 },
  root_slam:         { ATTACK: 2, DISABLE: 1.5 },
  death_spore:       { ATTACK: 2.5, AOE: 1.5, DEBUFF: 1 },
  fungal_wrath:      { ATTACK: 2.5 },
  void_cleave:       { ATTACK: 2.5 },
  shadow_nova:       { AOE: 2, DISABLE: 1.5 },
  consume:           { ATTACK: 3, FINISH: 2 },
  rift_tear:         { ATTACK: 2.5 },
  unmake:            { ATTACK: 3.5, FINISH: 2 },
  void_collapse:     { AOE: 2, DISABLE: 1.5 },
  dragon_claw:       { ATTACK: 2.5 },
  fire_breath:       { ATTACK: 2, AOE: 1.5 },
  tail_sweep:        { ATTACK: 1.5, AOE: 1, DISABLE: 0.5 },
  rift_breath:       { ATTACK: 2.5, AOE: 1.5 },
  annihilate:        { ATTACK: 3.5, AOE: 2 },
  rift_stomp:        { ATTACK: 2, DISABLE: 2, AOE: 1 },
  soul_drain:        { ATTACK: 1.5, DEBUFF: 2 },
  death_coil:        { ATTACK: 2.5, KITE: 1 },
  necrotic_burst:    { ATTACK: 2, AOE: 1.5, DEBUFF: 1 },
  death_storm:       { ATTACK: 2.5, AOE: 2 },
  soul_harvest:      { ATTACK: 2, DEBUFF: 1.5 },
  fang_strike:       { ATTACK: 2, DEBUFF: 1.5 },
  web_shot:          { DISABLE: 2.5, KITE: 1 },
  spawn_brood:       { AOE: 1.5 },
  frenzy_bite:       { ATTACK: 2.5, FINISH: 1 },
  web_barrage:       { DISABLE: 2, AOE: 1.5 },
  venom_nova:        { AOE: 2.5, DEBUFF: 2 },
  desperate_fang:    { ATTACK: 3, FINISH: 2 },
  // --- Invisible enemy abilities ---
  shadow_bolt:       { ATTACK: 1.5, KITE: 1 },
  void_snare:        { DISABLE: 2, DEBUFF: 1.5 },
  siren_song:        { DISABLE: 2, AOE: 1 },
  gale_slash:        { ATTACK: 1.5, KITE: 1 },
  arcane_bolt:       { ATTACK: 1.5, KITE: 1 },
  void_grasp:        { ATTACK: 1.5, DISABLE: 1.5 },
  glamour_bolt:      { ATTACK: 1, DISABLE: 2 },
  spectral_gaze:     { ATTACK: 1, DISABLE: 2 },
  echo_wail:         { ATTACK: 1.5, DISABLE: 2 },
  // --- Defaults for unknown abilities ---
  _default:          { ATTACK: 1 },
};

// WALKABLE_TILES passed in from dungeon.js at init time
var WALKABLE_TILES = null;

function setWalkableTiles(wt) {
  WALKABLE_TILES = wt;
}

// ---------------------------------------------------------------------------
// Line of Sight (Bresenham raycast on tile grid)
// ---------------------------------------------------------------------------

function hasLineOfSight(grid, x0, y0, x1, y1, width, height) {
  // Bresenham's line algorithm - checks all tiles along the line
  // Returns false if any non-walkable tile blocks the path
  var dx = Math.abs(x1 - x0);
  var dy = Math.abs(y1 - y0);
  var sx = x0 < x1 ? 1 : -1;
  var sy = y0 < y1 ? 1 : -1;
  var err = dx - dy;
  var cx = x0;
  var cy = y0;

  while (cx !== x1 || cy !== y1) {
    var e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx)  { err += dx; cy += sy; }

    // Skip the start and end tiles
    if (cx === x1 && cy === y1) break;

    // Check bounds
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) return false;

    // Wall check (tile 1 = WALL)
    if (grid[cy][cx] === 1) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Distance helpers
// ---------------------------------------------------------------------------

function manhattanDist(x0, y0, x1, y1) {
  return Math.abs(x1 - x0) + Math.abs(y1 - y0);
}

function euclideanDistSq(x0, y0, x1, y1) {
  var dx = x1 - x0;
  var dy = y1 - y0;
  return dx * dx + dy * dy;
}

// ---------------------------------------------------------------------------
// Init enemy AI state (called when floor is generated or enemy spawns)
// ---------------------------------------------------------------------------

function initEnemyAI(enemy, archetype) {
  enemy.aiState = 'idle';
  enemy.aiTimer = 0;
  enemy.archetype = archetype || inferArchetype(enemy);
  enemy.facing = 'down'; // down, up, left, right
  enemy.spawnX = enemy.x;
  enemy.spawnY = enemy.y;
  enemy.maxHp = enemy.hp;
  enemy.baseDetectionRadius = enemy.detectionRadius || 4; // Save base for director adjustments
  enemy.targetId = null;         // socket ID of targeted player
  enemy.lastKnownX = -1;
  enemy.lastKnownY = -1;
  enemy.memoryTimer = 0;
  enemy.attackCooldown = 0;
  enemy.abilities = enemy.abilities || [];
  enemy.abilityCooldowns = {};
  enemy.statusEffects = [];
  enemy.groupId = null;          // set by spatial grouping
  enemy.isAttacking = false;     // true during wind-up
  enemy.windUpTimer = 0;
  enemy.windUpAbility = null;
  enemy.changed = false;         // dirty flag for delta broadcast
  enemy.saturation = null;       // ability saturation tracking (prevents heal spam etc.)
  enemy.patrolTimer = 0;         // timer-based patrol wandering counter
  enemy.patrolInterval = 3 + Math.floor(Math.random() * 3); // wander every 3-5 ticks (stagger per enemy)
  // Boss phase
  if (enemy.isBoss) {
    enemy.currentPhase = 0;
    enemy.phases = enemy.phases || [];
  }
  return enemy;
}

// Infer archetype from enemy stats if not explicitly set
function inferArchetype(enemy) {
  if (enemy.isBoss) return 'elite';
  // High HP + high def = bruiser
  if (enemy.hp >= 80 && enemy.def >= 12) return 'bruiser';
  // High atk + low def = skirmisher
  if (enemy.atk >= 18 && enemy.def <= 8) return 'skirmisher';
  // Check name hints
  var name = (enemy.name || '').toLowerCase();
  if (name.indexOf('archer') !== -1 || name.indexOf('wisp') !== -1 ||
      name.indexOf('spirit') !== -1 || name.indexOf('banshee') !== -1) return 'ranged';
  if (name.indexOf('shaman') !== -1 || name.indexOf('mancer') !== -1 ||
      name.indexOf('hive') !== -1 || name.indexOf('lich') !== -1) return 'controller';
  if (name.indexOf('rat') !== -1 || name.indexOf('bat') !== -1 ||
      name.indexOf('imp') !== -1 || name.indexOf('wolf') !== -1 ||
      name.indexOf('hound') !== -1 || name.indexOf('wasp') !== -1) return 'skirmisher';
  if (name.indexOf('golem') !== -1 || name.indexOf('titan') !== -1 ||
      name.indexOf('colossus') !== -1 || name.indexOf('bear') !== -1) return 'bruiser';
  // Default: bruiser for anything tanky, skirmisher for others
  if (enemy.hp >= 60) return 'bruiser';
  return 'skirmisher';
}

// ---------------------------------------------------------------------------
// Threat Scoring
// ---------------------------------------------------------------------------

function calculateThreatScore(enemy, player, playerCombat) {
  if (!player || !playerCombat) return 0;
  var score = 0;

  // Distance: closer = higher threat
  var dist = manhattanDist(enemy.x, enemy.y, player.x, player.y);
  score += Math.max(0, 10 - dist) * 5;

  // Player HP%: lower = more attractive target (finish them off)
  if (playerCombat.maxHp > 0) {
    var hpPct = playerCombat.hp / playerCombat.maxHp;
    if (hpPct < 0.3) score += 30;       // Critical HP — high priority
    else if (hpPct < 0.5) score += 15;
  }

  // Armor: low armor = easier target
  var armor = playerCombat.baseArmor || 0;
  if (armor < 5) score += 10;

  // Current target stickiness: slight bonus to stay on same target
  if (enemy.targetId === player.id) score += 8;

  // LOS bonus: can see them right now
  // (LOS check is done before calling this, so if we get here, they're visible)
  score += 10;

  return score;
}

// ---------------------------------------------------------------------------
// Perception: what can this enemy see/hear?
// ---------------------------------------------------------------------------

function getVisiblePlayers(enemy, players, grid, width, height, stealthLevels) {
  var arch = ARCHETYPES[enemy.archetype] || ARCHETYPES.bruiser;
  var detectionRadius = enemy.detectionRadius || 4;

  var visible = [];
  for (var i = 0; i < players.length; i++) {
    var p = players[i];
    var dist = manhattanDist(enemy.x, enemy.y, p.x, p.y);

    // Stealth reduces detection radius
    var stealthLevel = (stealthLevels && stealthLevels[p.id]) || 0;
    var effectiveRadius = Math.max(1, detectionRadius - stealthLevel * 0.5);

    if (dist > effectiveRadius) continue;

    // LOS check
    if (!hasLineOfSight(grid, enemy.x, enemy.y, p.x, p.y, width, height)) continue;

    visible.push(p);
  }
  return visible;
}

function getAudiblePlayers(enemy, players, combatActive) {
  // Players in active combat make noise
  if (!combatActive) return [];
  var audible = [];
  var hearRange = HEARING_RADIUS;
  for (var i = 0; i < players.length; i++) {
    var p = players[i];
    if (!p.inCombat) continue;
    var dist = manhattanDist(enemy.x, enemy.y, p.x, p.y);
    if (dist <= hearRange) audible.push(p);
  }
  return audible;
}

// ---------------------------------------------------------------------------
// Sound Propagation (BFS flood fill through walkable tiles)
// ---------------------------------------------------------------------------

// Sound types with radius and alert level
var SOUND_TYPES = {
  footstep:     { radius: 3,  alertLevel: 'curious' },
  attack:       { radius: 8,  alertLevel: 'alert' },
  combat:       { radius: 10, alertLevel: 'alert' },
  chest_open:   { radius: 4,  alertLevel: 'curious' },
  shout:        { radius: 15, alertLevel: 'alert' },
  chat:         { radius: 6,  alertLevel: 'curious' },
  trap_trigger: { radius: 8,  alertLevel: 'alert' },
  boss_roar:    { radius: 20, alertLevel: 'alert' },
};

// BFS flood fill through walkable tiles. Returns Map("x,y" -> distance).
// Walls block sound. Capped at radius to prevent unbounded exploration.
function propagateSound(grid, sourceX, sourceY, radius, width, height) {
  var reached = new Map();
  var queue = [[sourceX, sourceY, 0]];
  var key0 = sourceX + ',' + sourceY;
  reached.set(key0, 0);

  var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  while (queue.length > 0) {
    var cur = queue.shift();
    var cx = cur[0], cy = cur[1], dist = cur[2];

    if (dist >= radius) continue;

    for (var d = 0; d < 4; d++) {
      var nx = cx + dirs[d][0];
      var ny = cy + dirs[d][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      var nKey = nx + ',' + ny;
      if (reached.has(nKey)) continue;

      // Walls block sound
      if (WALKABLE_TILES && !WALKABLE_TILES[grid[ny][nx]]) continue;

      var nDist = dist + 1;
      reached.set(nKey, nDist);
      queue.push([nx, ny, nDist]);
    }
  }

  return reached;
}

// Process noise events for a single enemy.
// noiseReachMaps is a pre-computed array of { reachMap, soundType, sourceX, sourceY }
// Returns 'alert', 'curious', or null.
function processNoiseForEnemy(enemy, noiseReachMaps) {
  var bestLevel = null; // null < 'curious' < 'alert'
  var bestSourceX = null, bestSourceY = null;

  for (var i = 0; i < noiseReachMaps.length; i++) {
    var noise = noiseReachMaps[i];
    var eKey = enemy.x + ',' + enemy.y;
    if (!noise.reachMap.has(eKey)) continue;

    var level = noise.soundType.alertLevel;
    if (level === 'alert') {
      bestLevel = 'alert';
      bestSourceX = noise.sourceX;
      bestSourceY = noise.sourceY;
      break; // alert is max level, no need to check further
    }
    if (!bestLevel) {
      bestLevel = 'curious';
      bestSourceX = noise.sourceX;
      bestSourceY = noise.sourceY;
    }
  }

  if (bestLevel) {
    return { level: bestLevel, sourceX: bestSourceX, sourceY: bestSourceY };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Movement helpers
// ---------------------------------------------------------------------------

function isWalkable(grid, x, y, width, height, enemies) {
  if (x < 0 || x >= width || y < 0 || y >= height) return false;
  if (!WALKABLE_TILES || !WALKABLE_TILES[grid[y][x]]) return false;
  // Don't stack on other enemies
  if (enemies) {
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.alive !== false && e.x === x && e.y === y) return false;
    }
  }
  return true;
}

function moveToward(enemy, targetX, targetY, grid, width, height, enemies, speed) {
  var steps = speed || 1;
  for (var s = 0; s < steps; s++) {
    var dx = targetX - enemy.x;
    var dy = targetY - enemy.y;
    if (dx === 0 && dy === 0) return; // already there

    // Primary axis: the one with larger distance
    var moved = false;
    if (Math.abs(dx) >= Math.abs(dy)) {
      // Try X first, then Y
      var sx = dx > 0 ? 1 : -1;
      if (isWalkable(grid, enemy.x + sx, enemy.y, width, height, enemies)) {
        enemy.x += sx;
        moved = true;
      } else if (dy !== 0) {
        var sy = dy > 0 ? 1 : -1;
        if (isWalkable(grid, enemy.x, enemy.y + sy, width, height, enemies)) {
          enemy.y += sy;
          moved = true;
        }
      }
    } else {
      // Try Y first, then X
      var sy2 = dy > 0 ? 1 : -1;
      if (isWalkable(grid, enemy.x, enemy.y + sy2, width, height, enemies)) {
        enemy.y += sy2;
        moved = true;
      } else if (dx !== 0) {
        var sx2 = dx > 0 ? 1 : -1;
        if (isWalkable(grid, enemy.x + sx2, enemy.y, width, height, enemies)) {
          enemy.x += sx2;
          moved = true;
        }
      }
    }
    // Update facing
    if (moved) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        enemy.facing = dx > 0 ? 'right' : 'left';
      } else {
        enemy.facing = dy > 0 ? 'down' : 'up';
      }
      enemy.changed = true;
    } else {
      break; // fully blocked, stop trying
    }
  }
}

function moveAwayFrom(enemy, targetX, targetY, grid, width, height, enemies) {
  var dx = enemy.x - targetX;
  var dy = enemy.y - targetY;
  if (dx === 0 && dy === 0) dx = 1; // pick a direction if on top of target

  if (Math.abs(dx) >= Math.abs(dy)) {
    var sx = dx > 0 ? 1 : -1;
    if (isWalkable(grid, enemy.x + sx, enemy.y, width, height, enemies)) {
      enemy.x += sx; enemy.changed = true;
    } else {
      var sy = dy >= 0 ? 1 : -1;
      if (isWalkable(grid, enemy.x, enemy.y + sy, width, height, enemies)) {
        enemy.y += sy; enemy.changed = true;
      }
    }
  } else {
    var sy2 = dy > 0 ? 1 : -1;
    if (isWalkable(grid, enemy.x, enemy.y + sy2, width, height, enemies)) {
      enemy.y += sy2; enemy.changed = true;
    } else {
      var sx2 = dx >= 0 ? 1 : -1;
      if (isWalkable(grid, enemy.x + sx2, enemy.y, width, height, enemies)) {
        enemy.x += sx2; enemy.changed = true;
      }
    }
  }
}

function wanderStep(enemy, grid, width, height, enemies) {
  // Random cardinal direction
  var dirs = [[0,-1],[0,1],[-1,0],[1,0]];
  var d = dirs[Math.floor(Math.random() * 4)];
  var nx = enemy.x + d[0];
  var ny = enemy.y + d[1];
  // Stay within patrol range of spawn (5 tiles)
  if (manhattanDist(nx, ny, enemy.spawnX, enemy.spawnY) > 5) return;
  if (isWalkable(grid, nx, ny, width, height, enemies)) {
    enemy.x = nx;
    enemy.y = ny;
    enemy.changed = true;
    if (d[0] > 0) enemy.facing = 'right';
    else if (d[0] < 0) enemy.facing = 'left';
    else if (d[1] > 0) enemy.facing = 'down';
    else enemy.facing = 'up';
  }
}

// ---------------------------------------------------------------------------
// Positioning: flanking, spacing, arc formation
// ---------------------------------------------------------------------------

function getFlankPosition(enemy, target, allies, grid, width, height) {
  // Find the best position around the target that:
  // 1. Is at preferred range
  // 2. Is not already occupied by an ally
  // 3. Is on a different angle than other attackers
  var arch = ARCHETYPES[enemy.archetype] || ARCHETYPES.bruiser;
  var prefRange = arch.preferredRange || 1;

  var bestX = target.x;
  var bestY = target.y;
  var bestScore = -999;

  // Check 8 positions around target at preferred range
  for (var angle = 0; angle < 8; angle++) {
    var ax = [1,1,0,-1,-1,-1,0,1][angle] * prefRange;
    var ay = [0,1,1,1,0,-1,-1,-1][angle] * prefRange;
    var px = target.x + ax;
    var py = target.y + ay;

    if (!isWalkable(grid, px, py, width, height, null)) continue;

    var score = 0;
    // Distance from enemy to this position (closer is better for moving there)
    var moveDist = manhattanDist(enemy.x, enemy.y, px, py);
    score -= moveDist * 2;

    // Bonus for being away from other allies (spread out)
    var minAllyDist = 999;
    for (var ai = 0; ai < allies.length; ai++) {
      if (allies[ai] === enemy) continue;
      if (allies[ai].alive === false) continue;
      var aDist = manhattanDist(px, py, allies[ai].x, allies[ai].y);
      if (aDist < minAllyDist) minAllyDist = aDist;
    }
    score += Math.min(minAllyDist, 4) * 3; // bonus for spacing

    // Flanking bonus: opposite side from other attackers
    if (arch.flankPreference > 0) {
      var oppCount = 0;
      for (var ai2 = 0; ai2 < allies.length; ai2++) {
        if (allies[ai2] === enemy || allies[ai2].alive === false) continue;
        if (allies[ai2].targetId !== enemy.targetId) continue;
        // Check if on opposite side
        var aDx = allies[ai2].x - target.x;
        var aDy = allies[ai2].y - target.y;
        if ((aDx * ax < 0) || (aDy * ay < 0)) oppCount++;
      }
      score += oppCount * 5 * arch.flankPreference;
    }

    if (score > bestScore) {
      bestScore = score;
      bestX = px;
      bestY = py;
    }
  }

  return { x: bestX, y: bestY };
}

// ---------------------------------------------------------------------------
// Group Intelligence
// ---------------------------------------------------------------------------

function alertNearbyAllies(enemy, enemies) {
  for (var i = 0; i < enemies.length; i++) {
    var ally = enemies[i];
    if (ally === enemy || ally.alive === false) continue;
    if (ally.aiState === 'chase' || ally.aiState === 'attack') continue;

    var dist = manhattanDist(enemy.x, enemy.y, ally.x, ally.y);
    if (dist <= GROUP_ALERT_RANGE) {
      if (ally.aiState === 'idle' || ally.aiState === 'patrol') {
        ally.aiState = 'alert';
        ally.aiTimer = 0;
        ally.lastKnownX = enemy.lastKnownX >= 0 ? enemy.lastKnownX : -1;
        ally.lastKnownY = enemy.lastKnownY >= 0 ? enemy.lastKnownY : -1;
        ally.changed = true;
      }
    }
  }
}

function countAttackersOnTarget(targetId, enemies) {
  var count = 0;
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    if (e.alive !== false && e.targetId === targetId &&
        (e.aiState === 'attack' || e.aiState === 'position')) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Status Effects
// ---------------------------------------------------------------------------

function applyStatusEffect(target, effectId) {
  var def = STATUS_EFFECTS[effectId];
  if (!def) return;

  // Check for existing
  for (var i = 0; i < target.statusEffects.length; i++) {
    if (target.statusEffects[i].id === effectId) {
      if (def.stackable) {
        if (target.statusEffects[i].stacks < (def.maxStacks || 1)) {
          target.statusEffects[i].stacks++;
          target.statusEffects[i].timer = def.duration;
        }
      } else {
        // Refresh duration
        target.statusEffects[i].timer = def.duration;
      }
      return;
    }
  }

  // New effect
  target.statusEffects.push({
    id: effectId,
    timer: def.duration,
    stacks: 1,
  });
}

function tickStatusEffects(target) {
  var totalDamage = 0;
  var isStunned = false;
  var isFleeing = false;
  var speedMult = 1.0;

  for (var i = target.statusEffects.length - 1; i >= 0; i--) {
    var effect = target.statusEffects[i];
    var def = STATUS_EFFECTS[effect.id];
    if (!def) { target.statusEffects.splice(i, 1); continue; }

    // Apply tick effects
    if (def.tickDamage) totalDamage += def.tickDamage * (effect.stacks || 1);
    if (def.skipTurn) isStunned = true;
    if (def.fleeing) isFleeing = true;
    if (def.speedMult) speedMult *= def.speedMult;

    // Decrement timer
    effect.timer--;
    if (effect.timer <= 0) {
      target.statusEffects.splice(i, 1);
    }
  }

  return { damage: totalDamage, stunned: isStunned, fleeing: isFleeing, speedMult: speedMult };
}

// ---------------------------------------------------------------------------
// Tactical Ability Scoring (replaces weight-based selectAbility)
// ---------------------------------------------------------------------------

// Score a single ability against the current tactical situation.
// Returns a numeric score: higher = better choice right now.
function scoreTacticalAbility(enemy, ability, target, allies, grid, width, height) {
  // Can't use ability on cooldown
  if (enemy.abilityCooldowns && enemy.abilityCooldowns[ability.id] > 0) return -999;

  // Check saturation penalty for heal-type abilities
  var saturationPenalty = 0;
  if (ability.heals && enemy.saturation && enemy.saturation.heal && enemy.saturation.heal.ticksRemaining > 0) {
    saturationPenalty = -5;
  }

  var arch = ARCHETYPES[enemy.archetype] || ARCHETYPES.bruiser;
  var tactical = ability.tactical || TACTICAL_DEFAULTS[ability.id] || TACTICAL_DEFAULTS._default;
  var score = 0;

  var dist = target ? manhattanDist(enemy.x, enemy.y, target.x, target.y) : 999;
  var abilityRange = ability.range || 1;
  var inRange = dist <= abilityRange;
  var selfHpPct = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;

  // Check minRange restriction: ability can't be used if target is too close
  if (ability.minRange && dist < ability.minRange) {
    return -999;
  }

  // Base score from tactical ATTACK weight
  if (tactical.ATTACK) {
    score += tactical.ATTACK * (inRange ? 2.0 : 0.3);
  }

  // Finish bonus: target is low HP, attack abilities score higher
  if (tactical.FINISH && target) {
    var targetMaxHp = target.maxHp || target.hp || 1;
    var targetHpPct = targetMaxHp > 0 ? (target.hp || 0) / targetMaxHp : 1;
    if (targetHpPct < 0.3) score += tactical.FINISH * 3;
    else if (targetHpPct < 0.5) score += tactical.FINISH * 1.5;
  }

  // Heal scoring: more valuable when self or allies are hurt
  if (tactical.HEAL) {
    if (ability.heals) {
      // Self heal (range 0 or no range specified = self-targeting heal)
      if (ability.range === 0 || (!ability.range && !ability.healAmount)) {
        if (selfHpPct < 0.3) score += tactical.HEAL * 4;
        else if (selfHpPct < 0.6) score += tactical.HEAL * 2;
        else score += tactical.HEAL * 0.3; // low value at full HP
      } else {
        // Ally heal - check if any ally is hurt and in range
        var hurtAlly = false;
        if (allies) {
          for (var a = 0; a < allies.length; a++) {
            if (allies[a] !== enemy && allies[a].alive !== false) {
              var allyMaxHp = allies[a].maxHp || allies[a].hp || 1;
              var allyHpPct = allyMaxHp > 0 ? allies[a].hp / allyMaxHp : 1;
              var allyDist = manhattanDist(enemy.x, enemy.y, allies[a].x, allies[a].y);
              if (allyHpPct < 0.4 && allyDist <= (ability.range || 3)) {
                score += tactical.HEAL * 3;
                hurtAlly = true;
                break;
              }
            }
          }
        }
        // Also consider self-healing via ally_heal type abilities at range 0
        if (!hurtAlly && selfHpPct < 0.4) {
          score += tactical.HEAL * 2;
        } else if (!hurtAlly) {
          score += tactical.HEAL * 0.2;
        }
      }
    }
  }

  // AOE_HEAL scoring: more valuable when multiple allies are injured
  if (tactical.AOE_HEAL && ability.heals) {
    var hurtAllyCount = 0;
    if (allies) {
      for (var ah = 0; ah < allies.length; ah++) {
        if (allies[ah] !== enemy && allies[ah].alive !== false) {
          var ahMaxHp = allies[ah].maxHp || allies[ah].hp || 1;
          if (ahMaxHp > 0 && allies[ah].hp / ahMaxHp < 0.6) {
            hurtAllyCount++;
          }
        }
      }
    }
    score += tactical.AOE_HEAL * Math.min(hurtAllyCount, 3);
  }

  // Disable scoring: more valuable against dangerous targets and when under pressure
  if (tactical.DISABLE) {
    score += tactical.DISABLE * (inRange ? 1.5 : 0.2);
    // Extra value when enemy is taking lots of damage
    if (selfHpPct < 0.5) score += tactical.DISABLE * 1.0;
  }

  // Debuff scoring
  if (tactical.DEBUFF) {
    score += tactical.DEBUFF * (inRange ? 1.5 : 0.3);
  }

  // AOE scoring: more valuable with multiple nearby targets
  if (tactical.AOE) {
    // Use a fixed bonus since we don't have the full player list here;
    // the base score already captures AOE value from the tactical table
    score += tactical.AOE * 1.0;
  }

  // Kite scoring: ranged enemies value ranged abilities more
  if (tactical.KITE && arch.keepDistance) {
    score += tactical.KITE * 1.5;
  }

  // Escape scoring: value when low HP
  if (tactical.ESCAPE && selfHpPct < 0.3) {
    score += tactical.ESCAPE * 2.0;
  }

  // Defend scoring: value when under pressure
  if (tactical.DEFEND && selfHpPct < 0.5) {
    score += tactical.DEFEND * 1.5;
  }

  // Archetype preferences
  if (arch.preferHeal && ability.heals) score += 2;
  if (arch.preferDebuff && ability.effect) score += 1.5;

  // Wind-up consideration: shorter wind-up is tactically better when under pressure
  if (selfHpPct < 0.3 && ability.windUp > 2) score -= 2;

  // Add base weight as tiebreaker (preserves original tuning as subtle bias)
  score += (ability.weight || 5) * 0.1;

  // Apply saturation penalty
  score += saturationPenalty;

  return score;
}

// Evaluate ALL available abilities and return the best one for the current situation.
// Small random variance prevents perfectly predictable behavior.
function selectBestAbility(enemy, target, allies, grid, width, height) {
  if (!enemy.abilities || enemy.abilities.length === 0) return null;

  var bestAbility = null;
  var bestScore = -999;

  for (var i = 0; i < enemy.abilities.length; i++) {
    var ability = enemy.abilities[i];
    var score = scoreTacticalAbility(enemy, ability, target, allies, grid, width, height);

    // Small random variance to avoid perfectly predictable behavior
    score += (Math.random() - 0.5) * 0.5;

    if (score > bestScore) {
      bestScore = score;
      bestAbility = ability;
    }
  }

  return bestAbility;
}

// Legacy wrapper: maintains the old selectAbility signature for backward compatibility.
// The old function took (enemy, target, dist, allies). The new system computes dist
// internally from enemy.x/y and target.x/y, so the dist parameter is unused.
function selectAbility(enemy, target, dist, allies) {
  return selectBestAbility(enemy, target, allies, null, 0, 0);
}

// ---------------------------------------------------------------------------
// Boss Phase Logic
// ---------------------------------------------------------------------------

function checkBossPhase(enemy) {
  if (!enemy.isBoss || !enemy.phases || enemy.phases.length === 0) return;

  var hpPct = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;

  for (var i = enemy.phases.length - 1; i >= 0; i--) {
    if (hpPct <= enemy.phases[i].threshold && enemy.currentPhase < i + 1) {
      enemy.currentPhase = i + 1;
      // Apply phase changes
      var phase = enemy.phases[i];
      if (phase.abilities) enemy.abilities = phase.abilities;
      if (phase.detectionRadius) enemy.detectionRadius = phase.detectionRadius;
      if (phase.speed) enemy.speed = phase.speed;
      enemy.changed = true;
      return { phaseChanged: true, phase: enemy.currentPhase, phaseName: phase.name || 'Phase ' + (i+1) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main AI Tick: processes one enemy for one tick
// ---------------------------------------------------------------------------

function tickEnemy(enemy, floor, players, playerCombatStates, stealthLevels, enemies, noiseReachMaps) {
  if (enemy.alive === false) return null;
  if (enemy.inTurnCombat) return null;

  enemy.changed = false;
  var grid = floor.grid;
  var width = floor.width;
  var height = floor.height;

  // Tick attack cooldown
  if (enemy.attackCooldown > 0) enemy.attackCooldown--;

  // Tick ability cooldowns
  for (var abId in enemy.abilityCooldowns) {
    if (enemy.abilityCooldowns[abId] > 0) enemy.abilityCooldowns[abId]--;
  }

  // Decay saturation timers
  if (enemy.saturation) {
    var satKeys = Object.keys(enemy.saturation);
    for (var sk = 0; sk < satKeys.length; sk++) {
      if (enemy.saturation[satKeys[sk]].ticksRemaining > 0) {
        enemy.saturation[satKeys[sk]].ticksRemaining--;
      }
    }
  }

  // Tick status effects
  var statusResult = tickStatusEffects(enemy);
  if (statusResult.damage > 0) {
    enemy.hp -= statusResult.damage;
    enemy.changed = true;
    if (enemy.hp <= 0) {
      enemy.alive = false;
      enemy.hp = 0;
      enemy.aiState = 'idle';
      return { type: 'enemy_died', enemy: enemy, cause: 'status_effect' };
    }
  }

  // Stunned: skip turn
  if (statusResult.stunned) {
    enemy.changed = true;
    return null;
  }

  // Fear: flee from target
  if (statusResult.fleeing && enemy.targetId) {
    var fearTarget = null;
    for (var pi = 0; pi < players.length; pi++) {
      if (players[pi].id === enemy.targetId) { fearTarget = players[pi]; break; }
    }
    if (fearTarget) {
      moveAwayFrom(enemy, fearTarget.x, fearTarget.y, grid, width, height, enemies);
    }
    return null;
  }

  var arch = ARCHETYPES[enemy.archetype] || ARCHETYPES.bruiser;
  var prevState = enemy.aiState;

  // ---- Perception ----
  var visible = getVisiblePlayers(enemy, players, grid, width, height, stealthLevels);

  // ---- Sound Perception ----
  // Process noise events when enemy is idle/patrol (not already chasing)
  var heardNoise = null;
  if (noiseReachMaps && noiseReachMaps.length > 0 &&
      (enemy.aiState === 'idle' || enemy.aiState === 'patrol' || enemy.aiState === 'reset')) {
    heardNoise = processNoiseForEnemy(enemy, noiseReachMaps);
    if (heardNoise && visible.length === 0) {
      if (heardNoise.level === 'alert') {
        enemy.aiState = 'alert';
        enemy.aiTimer = 0;
        enemy.lastKnownX = heardNoise.sourceX;
        enemy.lastKnownY = heardNoise.sourceY;
        enemy.memoryTimer = MEMORY_DURATION;
        alertNearbyAllies(enemy, enemies);
        enemy.changed = true;
      } else if (heardNoise.level === 'curious') {
        // Investigate: move toward sound source
        enemy.lastKnownX = heardNoise.sourceX;
        enemy.lastKnownY = heardNoise.sourceY;
        enemy.memoryTimer = Math.floor(MEMORY_DURATION / 2);
        if (enemy.aiState === 'idle' || enemy.aiState === 'patrol') {
          enemy.aiState = 'reset'; // reset state moves toward lastKnown
          enemy.aiTimer = 0;
          enemy.changed = true;
        }
      }
    }
  }

  // ---- Leash check: enemies disengage when too far from spawn ----
  var LEASH_DISTANCE = 12;  // tiles from spawn before forced disengage
  var spawnDist = manhattanDist(enemy.x, enemy.y, enemy.spawnX, enemy.spawnY);
  if (spawnDist > LEASH_DISTANCE && enemy.aiState !== 'idle' && enemy.aiState !== 'patrol' && enemy.aiState !== 'reset' && enemy.aiState !== 'fallback') {
    enemy.aiState = 'reset';
    enemy.aiTimer = 0;
    enemy.memoryTimer = 0;  // immediately forget target
    enemy.targetId = null;
    enemy.changed = true;
  }

  // ---- State Machine ----
  switch (enemy.aiState) {

    case 'idle':
      // Transition to patrol after short delay
      enemy.aiTimer++;
      if (enemy.aiTimer >= 3) {
        enemy.aiState = 'patrol';
        enemy.aiTimer = 0;
      }
      // Check for visible players
      if (visible.length > 0) {
        enemy.aiState = 'alert';
        enemy.aiTimer = 0;
        enemy.lastKnownX = visible[0].x;
        enemy.lastKnownY = visible[0].y;
      }
      break;

    case 'patrol':
      // Timer-based wandering: move every N ticks for consistent patrol behavior
      enemy.patrolTimer++;
      if (enemy.patrolTimer >= (enemy.patrolInterval || 4)) {
        wanderStep(enemy, grid, width, height, enemies);
        enemy.patrolTimer = 0;
      }
      // Check for visible players
      if (visible.length > 0) {
        enemy.aiState = 'alert';
        enemy.aiTimer = 0;
        enemy.lastKnownX = visible[0].x;
        enemy.lastKnownY = visible[0].y;
        alertNearbyAllies(enemy, enemies);
      }
      break;

    case 'alert':
      // Brief pause when spotting player, then evaluate
      enemy.aiTimer++;
      // Continuously update last known position if still visible
      if (visible.length > 0) {
        enemy.lastKnownX = visible[0].x;
        enemy.lastKnownY = visible[0].y;
      }
      if (enemy.aiTimer >= 2) {
        if (visible.length > 0) {
          enemy.aiState = 'evaluate';
        } else {
          enemy.aiState = 'reset';
        }
        enemy.aiTimer = 0;
      }
      break;

    case 'evaluate':
      // Pick best target using threat scoring
      if (visible.length === 0) {
        // Lost sight — search last known position
        enemy.aiState = 'reset';
        enemy.aiTimer = 0;
        enemy.memoryTimer = MEMORY_DURATION;
        break;
      }

      var bestTarget = null;
      var bestThreat = -1;
      for (var vi = 0; vi < visible.length; vi++) {
        var p = visible[vi];
        var pc = playerCombatStates[p.id];
        var threat = calculateThreatScore(enemy, p, pc);
        if (threat > bestThreat) {
          bestThreat = threat;
          bestTarget = p;
        }
      }

      if (bestTarget) {
        enemy.targetId = bestTarget.id;
        enemy.lastKnownX = bestTarget.x;
        enemy.lastKnownY = bestTarget.y;

        var targetDist = manhattanDist(enemy.x, enemy.y, bestTarget.x, bestTarget.y);

        // Check if at attack range
        if (targetDist <= (arch.preferredRange || 1) && enemy.attackCooldown <= 0) {
          // Check max attackers limit
          if (countAttackersOnTarget(enemy.targetId, enemies) < MAX_ATTACKERS) {
            enemy.aiState = 'attack';
          } else {
            enemy.aiState = 'position'; // too many attackers, reposition
          }
        } else {
          enemy.aiState = 'position';
        }
      } else {
        enemy.aiState = 'patrol';
      }
      enemy.aiTimer = 0;
      break;

    case 'position':
      // Move toward optimal position
      if (visible.length === 0 && enemy.memoryTimer <= 0) {
        enemy.aiState = 'reset';
        enemy.aiTimer = 0;
        break;
      }

      var posTarget = null;
      for (var pi2 = 0; pi2 < players.length; pi2++) {
        if (players[pi2].id === enemy.targetId) { posTarget = players[pi2]; break; }
      }

      if (!posTarget) {
        // Target gone, move to last known position
        if (enemy.lastKnownX >= 0) {
          moveToward(enemy, enemy.lastKnownX, enemy.lastKnownY, grid, width, height, enemies, arch.speed);
          if (enemy.x === enemy.lastKnownX && enemy.y === enemy.lastKnownY) {
            enemy.aiState = 'reset';
            enemy.aiTimer = 0;
          }
        } else {
          enemy.aiState = 'reset';
        }
        break;
      }

      // Update last known
      enemy.lastKnownX = posTarget.x;
      enemy.lastKnownY = posTarget.y;

      var dist2 = manhattanDist(enemy.x, enemy.y, posTarget.x, posTarget.y);

      // Ranged/controller: keep distance
      if (arch.keepDistance && dist2 < arch.preferredRange) {
        moveAwayFrom(enemy, posTarget.x, posTarget.y, grid, width, height, enemies);
      }
      // Support: stay near allies
      else if (arch.stayNearAllies) {
        // Find nearest injured ally
        var nearestAlly = null;
        var nearestAllyDist = 999;
        for (var ai = 0; ai < enemies.length; ai++) {
          var a = enemies[ai];
          if (a === enemy || a.alive === false) continue;
          if (a.hp >= a.maxHp * 0.8) continue; // not injured
          var aDist = manhattanDist(enemy.x, enemy.y, a.x, a.y);
          if (aDist < nearestAllyDist) {
            nearestAllyDist = aDist;
            nearestAlly = a;
          }
        }
        if (nearestAlly) {
          moveToward(enemy, nearestAlly.x, nearestAlly.y, grid, width, height, enemies, arch.speed);
        } else {
          // No injured ally, position near target
          var flankPos = getFlankPosition(enemy, posTarget, enemies, grid, width, height);
          moveToward(enemy, flankPos.x, flankPos.y, grid, width, height, enemies, arch.speed);
        }
      } else {
        // Normal positioning: move toward flank position
        var flankPos2 = getFlankPosition(enemy, posTarget, enemies, grid, width, height);
        moveToward(enemy, flankPos2.x, flankPos2.y, grid, width, height, enemies, arch.speed);
      }

      // Check if can attack now
      dist2 = manhattanDist(enemy.x, enemy.y, posTarget.x, posTarget.y);
      if (dist2 <= (arch.preferredRange || 1) && enemy.attackCooldown <= 0) {
        if (countAttackersOnTarget(enemy.targetId, enemies) < MAX_ATTACKERS) {
          enemy.aiState = 'attack';
          enemy.aiTimer = 0;
        }
      }

      // Re-evaluate periodically
      enemy.aiTimer++;
      if (enemy.aiTimer >= 6) {
        enemy.aiState = 'evaluate';
        enemy.aiTimer = 0;
      }
      break;

    case 'attack':
      // Wind-up phase
      if (!enemy.isAttacking) {
        // Select ability using tactical scoring
        var target3 = null;
        for (var pi3 = 0; pi3 < players.length; pi3++) {
          if (players[pi3].id === enemy.targetId) { target3 = players[pi3]; break; }
        }
        if (!target3) {
          enemy.aiState = 'evaluate';
          enemy.aiTimer = 0;
          break;
        }

        // Use tactical scoring to pick the best ability for this situation
        var ability = selectBestAbility(enemy, target3, enemies, grid, width, height);

        // Set heal saturation if a heal ability was selected
        if (ability && ability.heals) {
          if (!enemy.saturation) enemy.saturation = {};
          enemy.saturation.heal = { ticksRemaining: 4 };
        }

        enemy.isAttacking = true;
        enemy.windUpTimer = (ability && ability.windUp) ? ability.windUp : ATTACK_WINDUP_TICKS;
        enemy.windUpAbility = ability;
        enemy.changed = true;
      }

      enemy.windUpTimer--;
      if (enemy.windUpTimer <= 0) {
        enemy.isAttacking = false;
        enemy.attackCooldown = (enemy.windUpAbility && enemy.windUpAbility.cooldown) ?
          enemy.windUpAbility.cooldown : RECOVER_TICKS + ATTACK_WINDUP_TICKS;

        // Set ability cooldown
        if (enemy.windUpAbility && enemy.windUpAbility.id) {
          enemy.abilityCooldowns[enemy.windUpAbility.id] = enemy.windUpAbility.cooldown || 4;
        }

        var firedAbility = enemy.windUpAbility;

        // Heals resolve in real-time — no need to engage the player in tactical combat
        if (firedAbility && firedAbility.heals) {
          enemy.windUpAbility = null;
          enemy.aiState = 'recover';
          enemy.aiTimer = 0;
          enemy.changed = true;
          for (var hi = 0; hi < enemies.length; hi++) {
            var healAlly = enemies[hi];
            if (healAlly === enemy || healAlly.alive === false) continue;
            var healDist = manhattanDist(enemy.x, enemy.y, healAlly.x, healAlly.y);
            if (healDist <= (firedAbility.range || 3)) {
              healAlly.hp = Math.min(healAlly.maxHp, healAlly.hp + (firedAbility.healAmount || 10));
              healAlly.changed = true;
            }
          }
          return { type: 'enemy_attack', attack: {
            attackerId: enemy.id, attackerName: enemy.name,
            isHeal: true, healAmount: firedAbility.healAmount || 10,
            abilityName: firedAbility.name || 'Heal',
          }};
        }

        // Offensive abilities: trigger tactical combat
        var engageTargetId = enemy.targetId;
        enemy.windUpAbility = null;
        enemy.aiState = 'recover';
        enemy.aiTimer = 0;
        enemy.changed = true;
        return { type: 'engage_tactical', enemy: enemy, targetId: engageTargetId };
      }
      break;

    case 'recover':
      // Post-attack cooldown, can't act
      enemy.aiTimer++;
      if (enemy.aiTimer >= RECOVER_TICKS) {
        enemy.aiState = 'evaluate';
        enemy.aiTimer = 0;
      }
      break;

    case 'reposition':
      // Skirmisher: move away after attacking, then re-evaluate
      if (enemy.targetId) {
        var repo = null;
        for (var pi4 = 0; pi4 < players.length; pi4++) {
          if (players[pi4].id === enemy.targetId) { repo = players[pi4]; break; }
        }
        if (repo) {
          moveAwayFrom(enemy, repo.x, repo.y, grid, width, height, enemies);
          moveAwayFrom(enemy, repo.x, repo.y, grid, width, height, enemies); // 2 steps
        }
      }
      enemy.aiState = 'evaluate';
      enemy.aiTimer = 0;
      break;

    case 'fallback':
      // Low HP retreat toward spawn
      var hpPct = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;
      if (hpPct > arch.retreatThreshold + 0.1) {
        // Recovered enough, re-engage
        enemy.aiState = 'evaluate';
        enemy.aiTimer = 0;
        break;
      }
      moveToward(enemy, enemy.spawnX, enemy.spawnY, grid, width, height, enemies, arch.speed);
      if (enemy.x === enemy.spawnX && enemy.y === enemy.spawnY) {
        enemy.aiState = 'idle';
        enemy.aiTimer = 0;
      }
      break;

    case 'reset':
      // Lost target, search briefly then return to patrol
      enemy.memoryTimer--;
      if (enemy.memoryTimer > 0 && enemy.lastKnownX >= 0) {
        // Move toward last known position
        moveToward(enemy, enemy.lastKnownX, enemy.lastKnownY, grid, width, height, enemies, 1);
        if (enemy.x === enemy.lastKnownX && enemy.y === enemy.lastKnownY) {
          enemy.memoryTimer = 0;
        }
        // Check if we can see them again
        if (visible.length > 0) {
          enemy.aiState = 'evaluate';
          enemy.aiTimer = 0;
          break;
        }
      } else {
        // Return to spawn
        enemy.aiTimer++;
        moveToward(enemy, enemy.spawnX, enemy.spawnY, grid, width, height, enemies, 1);
        if (enemy.aiTimer > SEARCH_DURATION ||
            (enemy.x === enemy.spawnX && enemy.y === enemy.spawnY)) {
          enemy.aiState = 'patrol';
          enemy.aiTimer = 0;
          enemy.targetId = null;
          enemy.lastKnownX = -1;
          enemy.lastKnownY = -1;
        }
      }
      break;

    default:
      enemy.aiState = 'idle';
      enemy.aiTimer = 0;
  }

  // Retreat check: any combat state + low HP
  if (arch.retreatThreshold > 0 && enemy.aiState !== 'fallback' && enemy.aiState !== 'idle' && enemy.aiState !== 'patrol') {
    var hpPct2 = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;
    if (hpPct2 <= arch.retreatThreshold) {
      enemy.aiState = 'fallback';
      enemy.aiTimer = 0;
      enemy.changed = true;
    }
  }

  if (enemy.aiState !== prevState) enemy.changed = true;

  return null;
}

// ---------------------------------------------------------------------------
// Execute enemy attack on player
// ---------------------------------------------------------------------------

function executeEnemyAttack(enemy, players, playerCombatStates, enemies) {
  var target = null;
  for (var i = 0; i < players.length; i++) {
    if (players[i].id === enemy.targetId) { target = players[i]; break; }
  }
  if (!target) return null;

  var dist = manhattanDist(enemy.x, enemy.y, target.x, target.y);
  var ability = enemy.windUpAbility;
  var maxRange = ability ? (ability.range || 1) : 1;
  // Cap maximum attack range to prevent infinite-range sniping
  if (maxRange > 3) maxRange = 3;

  // Range check — strict, no +1 grace
  if (dist > maxRange) return null;

  var combat = playerCombatStates[target.id];
  if (!combat || combat.hp <= 0) return null;

  // Calculate damage
  var baseDmg = ability ? (ability.damage || enemy.atk) : enemy.atk;
  var damage = Math.max(1, baseDmg - (combat.baseArmor || 0));

  // Player dodge check
  var dodged = false;
  if (combat.dodgeChance && Math.random() < combat.dodgeChance) {
    dodged = true;
    damage = 0;
  }

  // Player block check
  var blocked = false;
  if (!dodged && combat.blockChance && Math.random() < combat.blockChance) {
    blocked = true;
    damage = Math.floor(damage * 0.5);
  }

  // Defense multiplier from dungeon defense bonus
  if (!dodged && combat.dungeonDefBonus) {
    damage = Math.floor(damage * Math.max(0, 1 - combat.dungeonDefBonus));
  }

  // Dwelling Lv30: dungeonDamageTakenMult (0.85 = 15% damage reduction)
  if (!dodged && combat.skillBonuses && combat.skillBonuses.dungeonDamageTakenMult < 1) {
    damage = Math.floor(damage * combat.skillBonuses.dungeonDamageTakenMult);
  }

  // Apply damage
  if (!dodged) {
    combat.hp = Math.max(0, combat.hp - damage);
    // Track damage taken this floor for no_damage_floor quest
    combat.damageTakenThisFloor = (combat.damageTakenThisFloor || 0) + damage;
  }

  // Apply status effect from ability
  var effectApplied = null;
  if (!dodged && ability && ability.effect && Math.random() < (ability.effectChance || 0.3)) {
    applyStatusEffect({ statusEffects: combat.statusEffects || [] }, ability.effect);
    effectApplied = ability.effect;
    if (!combat.statusEffects) combat.statusEffects = [];
  }

  // Support ability: heal allies instead of damaging players
  if (ability && ability.heals) {
    for (var ai = 0; ai < enemies.length; ai++) {
      var ally = enemies[ai];
      if (ally === enemy || ally.alive === false) continue;
      var allyDist = manhattanDist(enemy.x, enemy.y, ally.x, ally.y);
      if (allyDist <= (ability.range || 3)) {
        ally.hp = Math.min(ally.maxHp, ally.hp + (ability.healAmount || 10));
        ally.changed = true;
      }
    }
    return {
      attackerId: enemy.id,
      attackerName: enemy.name,
      isHeal: true,
      healAmount: ability.healAmount || 10,
      abilityName: ability.name || 'Heal',
    };
  }

  return {
    attackerId: enemy.id,
    attackerName: enemy.name,
    targetId: target.id,
    damage: damage,
    dodged: dodged,
    blocked: blocked,
    playerHp: combat.hp,
    playerMaxHp: combat.maxHp,
    playerDied: combat.hp <= 0,
    abilityName: ability ? ability.name : 'Attack',
    effect: effectApplied,
    isBoss: enemy.isBoss || false,
    windUp: ability ? ability.windUp : ATTACK_WINDUP_TICKS,
  };
}

// ---------------------------------------------------------------------------
// Main floor tick function
// ---------------------------------------------------------------------------

function tickFloorAI(floor, playerList, playerCombatStates, stealthLevels) {
  // playerList: array of { id, x, y, inCombat }
  // playerCombatStates: { socketId: combatState }
  // stealthLevels: { socketId: number }
  // Returns: { updates: [...], attacks: [...], deaths: [...] }

  var results = {
    updates: [],      // enemies that moved/changed state
    attacks: [],      // enemy heals (real-time, no player damage)
    deaths: [],       // enemies that died from status effects
    phaseChanges: [], // boss phase transitions
    engagements: [],  // tactical combat triggers from enemy attacks
  };

  if (!floor || !floor.enemies) return results;

  var enemies = floor.enemies;
  var grid = floor.grid;

  // Pre-compute noise propagation maps for this tick
  var noiseReachMaps = [];
  if (floor._noiseEvents && floor._noiseEvents.length > 0) {
    for (var ni = 0; ni < floor._noiseEvents.length; ni++) {
      var evt = floor._noiseEvents[ni];
      var sType = SOUND_TYPES[evt.type] || SOUND_TYPES.footstep;
      var effectiveRadius = sType.radius;
      // Stealth reduces footstep radius
      if (evt.type === 'footstep' && evt.stealthBonus) {
        effectiveRadius = Math.max(1, effectiveRadius - evt.stealthBonus);
      }
      var reachMap = propagateSound(grid, evt.x, evt.y, effectiveRadius, floor.width, floor.height);
      noiseReachMaps.push({ reachMap: reachMap, soundType: sType, sourceX: evt.x, sourceY: evt.y });
    }
    // Clear noise events after processing
    floor._noiseEvents = [];
  }

  // Room-based culling: find which rooms have players
  var playerRooms = new Set();
  var playerPositions = {};
  for (var pi = 0; pi < playerList.length; pi++) {
    var p = playerList[pi];
    playerPositions[p.id] = p;
    // Find which room this player is in (or near)
    if (floor.rooms) {
      for (var ri = 0; ri < floor.rooms.length; ri++) {
        var rm = floor.rooms[ri];
        // Extended range: player is in or near this room
        if (p.x >= rm.x - 3 && p.x < rm.x + rm.w + 3 &&
            p.y >= rm.y - 3 && p.y < rm.y + rm.h + 3) {
          playerRooms.add(ri);
        }
      }
    }
  }

  // Tick each enemy
  for (var ei = 0; ei < enemies.length; ei++) {
    var enemy = enemies[ei];
    if (enemy.alive === false) continue;
    if (!enemy.aiState) initEnemyAI(enemy);

    // Room-based culling: skip enemies far from any player
    if (floor.rooms && enemy.roomIndex !== undefined && !playerRooms.has(enemy.roomIndex)) {
      // Check if in chase/alert state (should still tick even if room culled)
      if (enemy.aiState === 'idle' || enemy.aiState === 'patrol') continue;
      // Check Manhattan distance to nearest player
      var nearestDist = 999;
      for (var ni2 = 0; ni2 < playerList.length; ni2++) {
        var nd = manhattanDist(enemy.x, enemy.y, playerList[ni2].x, playerList[ni2].y);
        if (nd < nearestDist) nearestDist = nd;
      }
      if (nearestDist > 15) continue; // too far, skip
    }

    var result = tickEnemy(enemy, floor, playerList, playerCombatStates, stealthLevels, enemies, noiseReachMaps);

    if (result) {
      if (result.type === 'engage_tactical') {
        results.engagements.push(result);
      } else if (result.type === 'enemy_attack' && result.attack) {
        results.attacks.push(result.attack);
        if (result.phaseChange) results.phaseChanges.push(result.phaseChange);
      } else if (result.type === 'enemy_died') {
        results.deaths.push({ enemyIndex: ei, enemy: enemy, cause: result.cause });
      }
    }

    if (enemy.changed) {
      results.updates.push({
        index: ei,
        x: enemy.x,
        y: enemy.y,
        aiState: enemy.aiState,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        facing: enemy.facing,
        isAttacking: enemy.isAttacking,
        windUpTimer: enemy.windUpTimer,
        archetype: enemy.archetype,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Determine if floor needs fast or slow ticking
// ---------------------------------------------------------------------------

function getFloorTickRate(floor, playerList) {
  if (!playerList || playerList.length === 0) return 0; // no players, no ticking

  // Check if any enemy is in combat state
  for (var i = 0; i < floor.enemies.length; i++) {
    var e = floor.enemies[i];
    if (e.alive === false) continue;
    var state = e.aiState || 'idle';
    if (state === 'chase' || state === 'attack' || state === 'evaluate' ||
        state === 'position' || state === 'recover' || state === 'reposition' ||
        state === 'alert') {
      return AI_TICK_MS; // fast tick for active combat
    }
  }

  // Check if any player is near any enemy
  for (var ei = 0; ei < floor.enemies.length; ei++) {
    var enemy = floor.enemies[ei];
    if (enemy.alive === false) continue;
    for (var pi = 0; pi < playerList.length; pi++) {
      var dist = manhattanDist(enemy.x, enemy.y, playerList[pi].x, playerList[pi].y);
      if (dist <= (enemy.detectionRadius || 4) + 3) {
        return AI_TICK_MS; // player approaching, fast tick
      }
    }
  }

  return IDLE_TICK_MS; // slow tick
}

// ---------------------------------------------------------------------------
// Turn-based combat AI decision (for dungeon-combat.js)
// ---------------------------------------------------------------------------

// Returns a structured action object for turn-based combat.
// combat: the combat state from dungeon-combat.js
// enemy unit has: id, x, y, hp, maxHp, mp, ap, atk, def, speed, archetype, abilities, abilityCooldowns
// players: array of player units [{id, x, y, hp, maxHp, combat, alive}]
// floor: { grid, width, height }
function decideTurnAction(enemy, combat, players, floor) {
  var grid = floor.grid;
  var width = floor.width;
  var height = floor.height;
  var arch = ARCHETYPES[enemy.archetype] || ARCHETYPES.bruiser;

  // Boss rotation override: if this enemy has a rotation profile, use it
  if (enemy.isBoss) {
    var rotAbility = getBossRotationAbility(enemy, combat);
    if (rotAbility) {
      // Find nearest alive player for targeting
      var alivePlayers = [];
      for (var rpi = 0; rpi < players.length; rpi++) {
        if (players[rpi].alive) alivePlayers.push(players[rpi]);
      }
      if (alivePlayers.length > 0) {
        // Pick highest-threat target
        var rTarget = alivePlayers[0];
        var rBestThreat = -999;
        for (var rti = 0; rti < alivePlayers.length; rti++) {
          var rThreat = calculateThreatScore(enemy, alivePlayers[rti], alivePlayers[rti].combat || {});
          if (rThreat > rBestThreat) { rBestThreat = rThreat; rTarget = alivePlayers[rti]; }
        }

        if (rotAbility.type === 'heal') {
          var healAmt = Math.round(enemy.maxHp * (rotAbility.healPercent || 0.10));
          enemy.hp = Math.min(enemy.maxHp, enemy.hp + healAmt);
          return { type: 'ability', movePath: [], targetId: enemy.id, abilityId: rotAbility.id, bossAbility: rotAbility };
        }
        if (rotAbility.type === 'buff') {
          if (rotAbility.effect) {
            if (!enemy._bossBuffs) enemy._bossBuffs = [];
            enemy._bossBuffs.push({ atkMult: rotAbility.effect.atkMult || 1, duration: rotAbility.effect.duration || 3, appliedAt: combat.turn || 0 });
          }
          return { type: 'ability', movePath: [], targetId: enemy.id, abilityId: rotAbility.id, bossAbility: rotAbility };
        }
        if (rotAbility.type === 'summon') {
          return { type: 'ability', movePath: [], targetId: null, abilityId: rotAbility.id, bossAbility: rotAbility };
        }
        // Attack / AoE / Charge: target the player
        return { type: 'ability', movePath: [], targetId: rTarget.id, abilityId: rotAbility.id, bossAbility: rotAbility };
      }
    }
  }

  // Delegate to utility-based action scoring
  var combatUtility = require('./combat-utility');

  // Check if taunted — forced to target the taunter
  var tauntTarget = null;
  if (enemy.statusEffects) {
    for (var sti = 0; sti < enemy.statusEffects.length; sti++) {
      if (enemy.statusEffects[sti].name === 'taunted' && enemy.statusEffects[sti].tauntTarget) {
        var tauntUnit = combat.units.get(enemy.statusEffects[sti].tauntTarget);
        if (tauntUnit && tauntUnit.alive) {
          tauntTarget = tauntUnit;
        }
        break;
      }
    }
  }

  // If taunted, restrict players list to just the taunter
  var effectivePlayers = tauntTarget ? [tauntTarget] : players;

  // Support: check for urgent heals before utility scoring
  if (arch.preferHeal && enemy.abilities) {
    var allies = [];
    combat.units.forEach(function(unit) {
      if (unit.type === 'enemy' && unit.alive && unit.id !== enemy.id && !unit.isPlayerSummon) {
        allies.push(unit);
      }
    });
    for (var ai = 0; ai < allies.length; ai++) {
      if (allies[ai].hp < (allies[ai].maxHp || allies[ai].hp) * 0.5) {
        var healAbility = selectBestAbility(enemy, allies[ai], allies, grid, width, height);
        if (healAbility && healAbility.heals) {
          if (!enemy.saturation) enemy.saturation = {};
          enemy.saturation.heal = { ticksRemaining: 4 };
          return { type: 'ability', movePath: [], targetId: allies[ai].id, abilityId: healAbility.id };
        }
      }
    }
  }

  // Score all candidate actions using influence maps + utility
  var candidates = combatUtility.scoreActions(enemy, combat, effectivePlayers, floor);
  var action = combatUtility.pickBestAction(candidates);

  // Set heal saturation for ability actions that heal
  if (action.type === 'ability' && action.abilityId && enemy.abilities) {
    for (var ahi = 0; ahi < enemy.abilities.length; ahi++) {
      if (enemy.abilities[ahi].id === action.abilityId && enemy.abilities[ahi].heals) {
        if (!enemy.saturation) enemy.saturation = {};
        enemy.saturation.heal = { ticksRemaining: 4 };
        break;
      }
    }
  }

  return action;
}

// Build a step-by-step move path toward a target, limited by MP.
// Uses simple greedy movement (matching existing moveToward logic).
// Returns array of {x, y} tile positions.
function buildMovePath(startX, startY, targetX, targetY, grid, width, height, combat, maxSteps) {
  var path = [];
  var cx = startX;
  var cy = startY;

  for (var s = 0; s < maxSteps; s++) {
    var dx = targetX - cx;
    var dy = targetY - cy;
    if (dx === 0 && dy === 0) break;

    var nx = cx;
    var ny = cy;
    var moved = false;

    if (Math.abs(dx) >= Math.abs(dy)) {
      var sx = dx > 0 ? 1 : -1;
      if (isTurnWalkable(grid, cx + sx, cy, width, height, combat)) {
        nx = cx + sx;
        moved = true;
      } else if (dy !== 0) {
        var sy = dy > 0 ? 1 : -1;
        if (isTurnWalkable(grid, cx, cy + sy, width, height, combat)) {
          ny = cy + sy;
          moved = true;
        }
      }
    } else {
      var sy2 = dy > 0 ? 1 : -1;
      if (isTurnWalkable(grid, cx, cy + sy2, width, height, combat)) {
        ny = cy + sy2;
        moved = true;
      } else if (dx !== 0) {
        var sx2 = dx > 0 ? 1 : -1;
        if (isTurnWalkable(grid, cx + sx2, cy, width, height, combat)) {
          nx = cx + sx2;
          moved = true;
        }
      }
    }

    if (!moved) break;
    cx = nx;
    cy = ny;
    path.push({ x: cx, y: cy });
  }

  return path;
}

// Walkability check for turn-based combat (uses combat.units Map instead of enemies array)
function isTurnWalkable(grid, x, y, width, height, combat) {
  if (x < 0 || x >= width || y < 0 || y >= height) return false;
  if (grid[y][x] === 1) return false; // wall
  // Check unit occupation
  if (combat && combat.units) {
    var blocked = false;
    combat.units.forEach(function(unit) {
      if (unit.alive && unit.x === x && unit.y === y) blocked = true;
    });
    if (blocked) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Boss Rotation Profiles — phase-based ability sequences
// ---------------------------------------------------------------------------

var BOSS_ROTATIONS = {
  // Generic boss archetypes with rotation sequences
  brute: {
    phases: [
      { threshold: 1.0, name: 'Assault', rotation: ['devastating_slam', 'basic_attack', 'basic_attack', 'enrage_roar'] },
      { threshold: 0.5, name: 'Frenzy', rotation: ['berserk_rush', 'devastating_slam', 'basic_attack', 'enrage_roar', 'devastating_slam'] },
      { threshold: 0.2, name: 'Last Stand', rotation: ['enrage_roar', 'berserk_rush', 'devastating_slam', 'devastating_slam', 'berserk_rush'] },
    ],
  },
  guardian: {
    phases: [
      { threshold: 1.0, name: 'Bulwark', rotation: ['shield_bash', 'basic_attack', 'heal_pulse', 'shield_bash'] },
      { threshold: 0.5, name: 'Retaliation', rotation: ['shield_bash', 'summon_minions', 'basic_attack', 'heal_pulse', 'shield_bash'] },
      { threshold: 0.2, name: 'Desperation', rotation: ['heal_pulse', 'shield_bash', 'summon_minions', 'heal_pulse', 'shield_bash'] },
    ],
  },
  caster: {
    phases: [
      { threshold: 1.0, name: 'Arcane', rotation: ['shadow_nova', 'basic_attack', 'basic_attack', 'shadow_nova'] },
      { threshold: 0.5, name: 'Unleash', rotation: ['shadow_nova', 'summon_minions', 'shadow_nova', 'basic_attack'] },
      { threshold: 0.2, name: 'Cataclysm', rotation: ['shadow_nova', 'shadow_nova', 'shadow_nova', 'summon_minions'] },
    ],
  },
  beast: {
    phases: [
      { threshold: 1.0, name: 'Prowl', rotation: ['basic_attack', 'basic_attack', 'enrage_roar', 'berserk_rush'] },
      { threshold: 0.5, name: 'Rage', rotation: ['berserk_rush', 'basic_attack', 'devastating_slam', 'enrage_roar'] },
      { threshold: 0.2, name: 'Feral', rotation: ['berserk_rush', 'berserk_rush', 'devastating_slam', 'enrage_roar', 'berserk_rush'] },
    ],
  },
};

// Boss-specific ability definitions
var BOSS_ABILITIES = {
  enrage_roar: { id: 'enrage_roar', name: 'Enrage Roar', type: 'buff', range: 0, apCost: 1,
    effect: { atkMult: 1.3, duration: 3 }, description: 'Roar that increases ATK by 30% for 3 turns.' },
  devastating_slam: { id: 'devastating_slam', name: 'Devastating Slam', type: 'aoe', range: 1, radius: 1, apCost: 2,
    damageMult: 2.0, description: 'Massive slam dealing 200% damage to all adjacent.' },
  shield_bash: { id: 'shield_bash', name: 'Shield Bash', type: 'attack', range: 1, apCost: 1,
    damageMult: 1.2, statusEffect: { name: 'stun', duration: 1, chance: 0.4 }, description: 'Bash for 120% damage with 40% stun.' },
  berserk_rush: { id: 'berserk_rush', name: 'Berserk Rush', type: 'charge', range: 3, apCost: 2,
    damageMult: 1.8, description: 'Charge up to 3 tiles and slam for 180% damage.' },
  shadow_nova: { id: 'shadow_nova', name: 'Shadow Nova', type: 'aoe', range: 0, radius: 2, apCost: 2,
    damageMult: 1.5, element: 'dark', description: 'Dark explosion dealing 150% damage in radius 2.' },
  summon_minions: { id: 'summon_minions', name: 'Summon Minions', type: 'summon', range: 0, apCost: 2,
    summonCount: 2, description: 'Summon 2 minions to aid in combat.' },
  heal_pulse: { id: 'heal_pulse', name: 'Heal Pulse', type: 'heal', range: 0, apCost: 2,
    healPercent: 0.10, description: 'Heal self for 10% of max HP.' },
  basic_attack: { id: 'basic_attack', name: 'Attack', type: 'attack', range: 1, apCost: 1,
    damageMult: 1.0, description: 'Basic melee attack.' },
};

// Get boss rotation ability for this turn
function getBossRotationAbility(enemy, combat) {
  if (!enemy || !enemy.isBoss) return null;

  // Determine boss archetype for rotation profile
  var rotProfile = null;
  if (enemy.rotationProfile && BOSS_ROTATIONS[enemy.rotationProfile]) {
    rotProfile = BOSS_ROTATIONS[enemy.rotationProfile];
  } else if (enemy.archetype && BOSS_ROTATIONS[enemy.archetype]) {
    rotProfile = BOSS_ROTATIONS[enemy.archetype];
  }
  if (!rotProfile) return null;

  // Determine current phase based on HP
  var hpPct = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;
  var currentPhase = rotProfile.phases[0];
  for (var pi = 0; pi < rotProfile.phases.length; pi++) {
    if (hpPct <= rotProfile.phases[pi].threshold) {
      currentPhase = rotProfile.phases[pi];
    }
  }

  // Track rotation index per enemy
  if (!enemy._rotationIndex) enemy._rotationIndex = 0;
  if (!enemy._lastPhase) enemy._lastPhase = currentPhase.name;

  // Reset rotation on phase change
  if (enemy._lastPhase !== currentPhase.name) {
    enemy._rotationIndex = 0;
    enemy._lastPhase = currentPhase.name;
  }

  var rotation = currentPhase.rotation;
  if (!rotation || rotation.length === 0) return null;

  var abilityId = rotation[enemy._rotationIndex % rotation.length];
  enemy._rotationIndex++;

  return BOSS_ABILITIES[abilityId] || BOSS_ABILITIES.basic_attack;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Core
  tickFloorAI: tickFloorAI,
  tickEnemy: tickEnemy,
  initEnemyAI: initEnemyAI,
  getFloorTickRate: getFloorTickRate,
  setWalkableTiles: setWalkableTiles,

  // Constants
  AI_TICK_MS: AI_TICK_MS,
  IDLE_TICK_MS: IDLE_TICK_MS,
  ARCHETYPES: ARCHETYPES,
  STATUS_EFFECTS: STATUS_EFFECTS,

  // Tactical scoring system
  TACTICAL_DEFAULTS: TACTICAL_DEFAULTS,
  scoreTacticalAbility: scoreTacticalAbility,
  selectBestAbility: selectBestAbility,

  // Turn-based combat AI
  decideTurnAction: decideTurnAction,

  // Boss rotation system
  BOSS_ROTATIONS: BOSS_ROTATIONS,
  BOSS_ABILITIES: BOSS_ABILITIES,
  getBossRotationAbility: getBossRotationAbility,

  // Sound propagation
  propagateSound: propagateSound,
  processNoiseForEnemy: processNoiseForEnemy,
  SOUND_TYPES: SOUND_TYPES,

  // Helpers (for dungeon.js)
  hasLineOfSight: hasLineOfSight,
  manhattanDist: manhattanDist,
  isWalkable: isWalkable,
  applyStatusEffect: applyStatusEffect,
  checkBossPhase: checkBossPhase,
  calculateThreatScore: calculateThreatScore,
  selectAbility: selectAbility, // legacy wrapper, calls selectBestAbility internally
};
