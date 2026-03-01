// dungeon-vision.js
// Core vision module: shadowcasting FOV, per-player visibility, fog memory,
// light map computation, racial vision config, darkness mechanics,
// enhanced tremor/thermal/echolocation detection.
// Exports: computeShadowcastFOV, computePlayerVisibility, updateFogMemory,
//          filterFloorStateForPlayer, computeLightMap, VISION_CONFIG,
//          TREMOR_SENSE_CONFIG, THEME_LIGHT_LEVELS, FOG_STATE,
//          isDarkFloor, getDarknessLevel, isEnemyLiving,
//          DARK_THRESHOLD, ECHOLOCATION_PULSE_INTERVAL

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var FOG_STATE = {
  UNSEEN: 0,
  REMEMBERED: 1,
  VISIBLE: 2,
};

// Darkness threshold: ambient light at or below this value counts as "dark"
var DARK_THRESHOLD = 0.3;

// Pitch black threshold: ambient light exactly 0.0 (or forced by rift modifier)
var PITCH_BLACK_THRESHOLD = 0.0;

// Echolocation emits a pulse every N turns (moves)
var ECHOLOCATION_PULSE_INTERVAL = 3;

// Tremor fade: enemies stop showing after this many turns of being stationary
var TREMOR_FADE_TURNS = 1;

var VISION_CONFIG = {
  normal:       { baseRadius: 5, darkPenalty: 0.4, needsLight: true },
  darkvision:   { baseRadius: 6, darkPenalty: 0.85, needsLight: false },
  thermal:      { baseRadius: 4, darkPenalty: 0.7, seesHeat: true, heatRange: 3, wallPenetration: 1 },
  night:        { baseRadius: 7, darkPenalty: 0.95, needsLight: false, nightBonus: true },
  tremor:       { baseRadius: 5, darkPenalty: 0.6, needsLight: false, seesMovement: true, tremorSenseRange: 8 },
  magic_sense:  { baseRadius: 5, darkPenalty: 0.5, needsLight: true, seesMagic: true },
  true_seeing:  { baseRadius: 6, darkPenalty: 0.9, needsLight: false, seesMagic: true, seesAll: true },
};

var TREMOR_SENSE_CONFIG = {
  short:   { range: 4, detectsMovement: true, detectsDoors: true, detectsTraps: false, detectsMachines: false, detectsChests: false, detectsShrines: false, detectsBoss: false },
  full:    { range: 8, detectsMovement: true, detectsTraps: true, detectsDoors: true, detectsMachines: true, detectsChests: true, detectsShrines: true, detectsBoss: false },
  extreme: { range: 10, detectsMovement: true, detectsTraps: true, detectsDoors: true, detectsMachines: true, detectsChests: true, detectsShrines: true, detectsBoss: true },
};

// Patterns for mechanical/machine enemies that produce vibrations even when stationary
var MECHANICAL_ENEMY_PATTERNS = /automaton|clockwork|cogwork|construct|golem|sentinel|turret|machine|engine|piston|gear|robot|mech/i;

// Per-theme ambient light levels (0.0 = pitch black, 1.0 = fully lit)
var THEME_LIGHT_LEVELS = {
  // Bright (0.7 - 0.9)
  floating_islands:    0.90,
  lava_rift:           0.80,
  celestial_spire:     0.80,
  mirage_palace:       0.75,
  crystal_cavern:      0.70,
  iron_forge:          0.70,

  // Medium (0.4 - 0.65)
  elven_reliquary:     0.65,
  coral_grotto:        0.60,
  gnomish_workshop:    0.60,
  infernal_pit:        0.60,
  overgrown_temple:    0.55,
  grand_hall:          0.55,
  cogwork_foundry:     0.55,
  dragons_den:         0.55,
  fungal_forest:       0.50,
  clockwork_maze:      0.50,
  dinosaur_jungle:     0.50,
  ruined_village:      0.50,
  frost_citadel:       0.50,
  frozen_depths:       0.45,
  puzzle_labyrinth:    0.45,
  ancient_library:     0.40,
  stone_keep:          0.40,
  ashen_observatory:   0.40,

  // Dark (0.1 - 0.35)
  armory_vault:        0.35,
  tidal_vault:         0.35,
  sunken_cathedral:    0.35,
  flooded_ruins:       0.30,
  bone_yard:           0.30,
  throne_dungeon:      0.30,
  werewolf_den:        0.30,
  haunted_manor:       0.25,
  goblin_warrens:      0.25,
  troll_caves:         0.25,
  sand_tomb:           0.20,
  plague_warren:       0.20,
  orc_barrow:          0.20,
  astral_rift:         0.20,
  catacombs:           0.15,
  vampire_castle:      0.15,
  sunken_depths:       0.15,

  // Very dark (0.0 - 0.1)
  lich_sanctum:        0.10,
  spider_hive:         0.10,
  shadow_realm:        0.05,
  void_debris:         0.00,
  abyssal_dark:        0.00,
};

// Default ambient light for themes not listed above
var DEFAULT_AMBIENT_LIGHT = 0.4;

// Floor depth penalty: -0.02 per floor past floor 5, capped at -0.2
var DEPTH_LIGHT_PENALTY_START = 5;
var DEPTH_LIGHT_PENALTY_PER_FLOOR = 0.02;
var DEPTH_LIGHT_PENALTY_CAP = 0.2;

// Torch/lantern light source defaults
var TORCH_LIGHT_RADIUS = 5;
var TORCH_LIGHT_BRIGHTNESS = 0.6;
var LANTERN_LIGHT_RADIUS = 7;
var LANTERN_LIGHT_BRIGHTNESS = 0.8;
var CAMPFIRE_LIGHT_RADIUS = 6;
var CAMPFIRE_LIGHT_BRIGHTNESS = 0.7;

// WALKABLE_TILES passed in from dungeon.js
var WALKABLE_TILES = null;

function setWalkableTiles(wt) {
  WALKABLE_TILES = wt;
}

// ---------------------------------------------------------------------------
// Enemy Living/Cold Classification (for thermal vision)
// ---------------------------------------------------------------------------

// Patterns that indicate an enemy is NOT living (undead, construct, elemental,
// spectral, mechanical). These emit no body heat and are invisible to thermal.
var COLD_ENEMY_PATTERNS = /skeleton|wraith|ghost|spectr|undead|lich|revenant|zombie|wight|phantom|banshee|bone|golem|construct|automaton|clockwork|cogwork|elemental|wisp|shard|crystal.*titan|obsidian|gem.*bat|rune|radiant.*construct|darkness.*elemental|fire.*elemental|void|shadow|spirit|ghoul|mummy|vampir|gargoyle|effigy|sentinel|abyssal|ethereal|horror/i;

// Check if an enemy is "living" (emits heat for thermal detection)
// Uses enemy name-based heuristics plus an explicit isLiving/isUndead flag if set.
function isEnemyLiving(enemy) {
  // Explicit flags take priority
  if (enemy.isLiving === true) return true;
  if (enemy.isLiving === false) return false;
  if (enemy.isUndead || enemy.isConstruct || enemy.isElemental) return false;

  // Name-based classification
  var name = enemy.name || '';
  if (COLD_ENEMY_PATTERNS.test(name)) return false;

  // Default: most enemies are living creatures
  return true;
}

// ---------------------------------------------------------------------------
// Invisible Enemy Detection — checks if a player's vision can detect
// an enemy with an invisibility type.
// ---------------------------------------------------------------------------

// Reveal duration: tracks how long an invisible enemy stays revealed after
// being detected. Set enemy._revealedUntil = currentTurn + duration.
// While revealed, ALL players can see and target the enemy.
var REVEAL_DURATION_DEFAULT = 5;  // turns an enemy stays revealed after detection

/**
 * Check if a player's vision type can detect an enemy with a given invisibility.
 * @param {Object} enemy - The enemy entity (must have .invisibility field)
 * @param {string} visionType - Player's active vision type (e.g. 'normal', 'thermal')
 * @param {number} currentTurn - The current floor turn counter
 * @returns {boolean} true if the player can see this enemy
 */
function canPlayerSeeEnemy(enemy, visionType, currentTurn) {
  // Normal enemies are always visible
  if (!enemy.invisibility) return true;

  // Revealed enemies are visible to everyone until the reveal expires
  if (enemy._revealedUntil && currentTurn !== undefined && currentTurn <= enemy._revealedUntil) {
    return true;
  }

  // Enemies that have broken invisibility (attacked) are always visible
  if (enemy._invisBroken) return true;

  switch (enemy.invisibility) {
    case 'natural':
      // Natural camouflage/stealth: detected by thermal (if living), echolocation on pulse, true seeing
      // Tremor handled separately via tremor indicators (not direct vision)
      if (visionType === 'thermal' && isEnemyLiving(enemy)) return true;
      if (visionType === 'echolocation') return true;   // pulse reveals everything
      if (visionType === 'true_seeing') return true;
      // NOT detected by: normal, magic_sense, night, darkvision, tremor (tremor gives indicators only)
      return false;

    case 'magical':
      // Magical invisibility: only magic sense, true seeing, echolocation on pulse
      if (visionType === 'magic_sense') return true;
      if (visionType === 'true_seeing') return true;
      if (visionType === 'echolocation') return true;
      // NOT detected by: normal, thermal, night, darkvision, tremor
      return false;

    case 'spectral':
      // Spectral/ethereal: partially phased out, detected by magic sense, true seeing, thermal (cold signature)
      if (visionType === 'magic_sense') return true;
      if (visionType === 'true_seeing') return true;
      if (visionType === 'thermal') return true;        // shows as cold signature
      // NOT detected by: normal, tremor (no physical presence), night, darkvision, echolocation
      return false;

    case 'ambush':
      // Ambush stealth: physical hiding, detected by thermal, night vision, tremor, echolocation, true seeing
      if (visionType === 'thermal') return true;
      if (visionType === 'night') return true;
      if (visionType === 'tremor') return true;
      if (visionType === 'echolocation') return true;
      if (visionType === 'true_seeing') return true;
      if (visionType === 'darkvision') return true;     // can see in the dark = spot hiding creatures
      // NOT detected by: normal, magic_sense (ambush is physical, not magical)
      return false;

    default:
      return true;
  }
}

/**
 * Reveal an invisible enemy for a duration. Sets _revealedUntil on the enemy.
 * While revealed, ALL players can see and target the enemy regardless of vision.
 * @param {Object} enemy - The enemy entity
 * @param {number} currentTurn - The current floor turn counter
 * @param {number} [duration] - Number of turns to reveal for (default REVEAL_DURATION_DEFAULT)
 */
function revealEnemy(enemy, currentTurn, duration) {
  if (!enemy) return;
  var dur = (duration !== undefined) ? duration : REVEAL_DURATION_DEFAULT;
  var newRevealUntil = (currentTurn || 0) + dur;
  // Only extend reveal, never shorten it
  if (!enemy._revealedUntil || newRevealUntil > enemy._revealedUntil) {
    enemy._revealedUntil = newRevealUntil;
  }
}

/**
 * Break an enemy's invisibility permanently (e.g. when it attacks).
 * After breaking, the enemy is always visible to everyone.
 * @param {Object} enemy - The enemy entity
 */
function breakEnemyInvisibility(enemy) {
  if (!enemy) return;
  enemy._invisBroken = true;
}

// ---------------------------------------------------------------------------
// Wall-Between Check (Bresenham line for thermal wall penetration)
// ---------------------------------------------------------------------------

// Checks how many walls are between two points using Bresenham's line.
// Returns the number of wall tiles the line passes through (excluding
// the start and end tiles themselves).
function countWallsBetween(grid, x0, y0, x1, y1, width, height) {
  var walls = 0;
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
    if (e2 < dx) { err += dx; cy += sy; }

    // Don't count the destination tile itself
    if (cx === x1 && cy === y1) break;

    // Bounds check
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) {
      walls++;
      continue;
    }

    if (!isTransparent(grid[cy][cx])) {
      walls++;
    }
  }

  return walls;
}

// ---------------------------------------------------------------------------
// Darkness Helpers
// ---------------------------------------------------------------------------

// Returns true if a floor's effective ambient light is at or below DARK_THRESHOLD
function isDarkFloor(theme, floorNum) {
  var ambient = getAmbientLight(theme, floorNum);
  return ambient <= DARK_THRESHOLD;
}

// Returns true if a floor is pitch black (ambient light = 0.0)
// For rift floors, this can also be forced by isPitchBlackRiftFloor
function isPitchBlackFloor(theme, floorNum, isPitchBlackOverride) {
  if (isPitchBlackOverride) return true;
  var ambient = getAmbientLight(theme, floorNum);
  return ambient <= PITCH_BLACK_THRESHOLD;
}

// Returns darkness level: 0 = well lit, 1 = pitch black
// This is the inverse of ambient light, clamped to [0, 1]
function getDarknessLevel(theme, floorNum) {
  var ambient = getAmbientLight(theme, floorNum);
  return Math.max(0, Math.min(1, 1 - ambient));
}

// Deterministic check: is this rift floor pitch black?
// 15% of rift floors above floor 5 are pitch black
function isPitchBlackRiftFloor(floorNum) {
  if (floorNum <= 5) return false;
  return ((floorNum * 7 + 13) % 100) < 15;
}

// ---------------------------------------------------------------------------
// Effective Vision Range (new numeric range system)
// ---------------------------------------------------------------------------
// Uses VISION_TYPES from rpg-data.js (passed in via playerData.visionTypeDef)
// or falls back to sensible defaults based on vision type string.

function getEffectiveVisionRange(visionType, isDark, hasTorch, hasLantern, isPulseActive, isPitchBlack, visionTypeDef) {
  // Use the definition if provided; otherwise build fallback defaults
  var vt = visionTypeDef || {};
  var baseRange = vt.baseRange || 7;
  var darkRange = vt.darkRange || 1;
  var torchRange = vt.torchRange || 4;
  var lanternRange = vt.lanternRange || 6;

  // Echolocation between pulses: very limited
  if (visionType === 'echolocation' && !isPulseActive) {
    return vt.betweenPulseRange || 2;
  }

  // Pitch black floors: drastically reduce light-based vision
  if (isPitchBlack) {
    if (visionType === 'normal') {
      if (hasLantern) return 3;
      if (hasTorch) return 2;
      return 0;
    }
    if (visionType === 'night') return 5;
    if (visionType === 'magic_sense') {
      if (hasLantern) return 3;
      if (hasTorch) return 2;
      return 1;
    }
    // thermal, tremor, echolocation, true_seeing: unaffected by pitch black
    // (they don't rely on light)
    if (visionType === 'thermal' || visionType === 'tremor' ||
        visionType === 'echolocation' || visionType === 'true_seeing') {
      return baseRange;
    }
    // Unknown types in pitch black: severely limited
    if (hasLantern) return 3;
    if (hasTorch) return 2;
    return 0;
  }

  // Normal darkness
  if (!isDark) return baseRange;

  // Dark floor: pick best available light source
  if (hasLantern) return lanternRange;
  if (hasTorch) return torchRange;
  return darkRange;
}

// ---------------------------------------------------------------------------
// Symmetric Shadowcasting FOV (8 octants)
// ---------------------------------------------------------------------------

// Returns a Set of "x,y" strings for all visible tiles from (originX, originY)
// within the given radius. Walls block vision but are themselves visible.

function computeShadowcastFOV(grid, originX, originY, radius, width, height) {
  var visible = new Set();
  visible.add(originX + ',' + originY);

  for (var octant = 0; octant < 8; octant++) {
    castOctant(grid, originX, originY, radius, width, height, octant, visible);
  }

  return visible;
}

function castOctant(grid, ox, oy, radius, width, height, octant, visible) {
  // Iterative shadow list approach for one octant
  var shadows = [];

  for (var row = 1; row <= radius; row++) {
    for (var col = 0; col <= row; col++) {
      var coords = transformOctant(ox, oy, row, col, octant);
      var tx = coords[0];
      var ty = coords[1];

      if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;

      // Compute the slope range for this cell
      var topSlope = (col - 0.5) / (row + 0.5);
      var bottomSlope = (col + 0.5) / (row - 0.5);

      if (topSlope < 0) topSlope = 0;

      // Check if fully in shadow
      if (isInShadow(shadows, topSlope, bottomSlope)) continue;

      // This tile is visible
      visible.add(tx + ',' + ty);

      // If wall, cast shadow
      var tile = grid[ty][tx];
      if (!isTransparent(tile)) {
        var shadowStart = (col - 0.5) / (row + 0.5);
        var shadowEnd = (col + 0.5) / (row - 0.5);
        if (shadowStart < 0) shadowStart = 0;
        addShadow(shadows, shadowStart, shadowEnd);
      }
    }
  }
}

function isTransparent(tile) {
  // Walls and void are opaque; everything else is transparent
  if (!WALKABLE_TILES) return tile !== 0; // tile 0 = WALL in dungeon-data
  return !!WALKABLE_TILES[tile];
}

function isInShadow(shadows, topSlope, bottomSlope) {
  // A tile is fully in shadow if any shadow segment covers its entire slope range
  for (var i = 0; i < shadows.length; i++) {
    var s = shadows[i];
    if (s[0] <= bottomSlope && s[1] >= topSlope) return true;
  }
  return false;
}

function addShadow(shadows, start, end) {
  // Merge overlapping shadow segments
  var newStart = start;
  var newEnd = end;
  var i = 0;
  while (i < shadows.length) {
    var s = shadows[i];
    if (s[1] < newStart || s[0] > newEnd) {
      i++;
      continue;
    }
    // Overlapping — merge
    newStart = Math.min(newStart, s[0]);
    newEnd = Math.max(newEnd, s[1]);
    shadows.splice(i, 1);
  }
  shadows.push([newStart, newEnd]);
}

function transformOctant(ox, oy, row, col, octant) {
  switch (octant) {
    case 0: return [ox + col, oy - row];
    case 1: return [ox + row, oy - col];
    case 2: return [ox + row, oy + col];
    case 3: return [ox + col, oy + row];
    case 4: return [ox - col, oy + row];
    case 5: return [ox - row, oy + col];
    case 6: return [ox - row, oy - col];
    case 7: return [ox - col, oy - row];
    default: return [ox, oy];
  }
}

// ---------------------------------------------------------------------------
// Light Map Computation
// ---------------------------------------------------------------------------

// Computes per-tile float light level (0.0–1.0) for an entire floor.
// Sources: theme ambient + point lights (torches/campfires) with wall-blocked
// light propagation. Light falloff: brightness * (1 - dist/radius).

function computeLightMap(floor, lightSources) {
  var width = floor.width;
  var height = floor.height;
  var grid = floor.grid;

  // Start with ambient light from theme
  var ambient = getAmbientLight(floor.theme, floor.floorNum);
  var lightMap = new Float32Array(width * height);
  for (var i = 0; i < lightMap.length; i++) {
    lightMap[i] = ambient;
  }

  // Add point light sources
  if (lightSources) {
    for (var li = 0; li < lightSources.length; li++) {
      var src = lightSources[li];
      addPointLight(lightMap, grid, src.x, src.y, src.radius, src.brightness, width, height);
    }
  }

  // Clamp to [0, 1]
  for (var ci = 0; ci < lightMap.length; ci++) {
    if (lightMap[ci] > 1) lightMap[ci] = 1;
    else if (lightMap[ci] < 0) lightMap[ci] = 0;
  }

  return lightMap;
}

function getAmbientLight(theme, floorNum) {
  var base = THEME_LIGHT_LEVELS[theme];
  if (base === undefined) base = DEFAULT_AMBIENT_LIGHT;

  // Floor depth penalty
  if (floorNum > DEPTH_LIGHT_PENALTY_START) {
    var penalty = (floorNum - DEPTH_LIGHT_PENALTY_START) * DEPTH_LIGHT_PENALTY_PER_FLOOR;
    if (penalty > DEPTH_LIGHT_PENALTY_CAP) penalty = DEPTH_LIGHT_PENALTY_CAP;
    base -= penalty;
  }

  return Math.max(0, base);
}

function addPointLight(lightMap, grid, sx, sy, radius, brightness, width, height) {
  // Use shadowcasting to determine which tiles the light reaches
  var litTiles = computeShadowcastFOV(grid, sx, sy, radius, width, height);
  litTiles.forEach(function(key) {
    var parts = key.split(',');
    var tx = parseInt(parts[0], 10);
    var ty = parseInt(parts[1], 10);
    var dist = Math.sqrt((tx - sx) * (tx - sx) + (ty - sy) * (ty - sy));
    var falloff = brightness * (1 - dist / radius);
    if (falloff > 0) {
      lightMap[ty * width + tx] += falloff;
    }
  });
}

// ---------------------------------------------------------------------------
// Per-Player Visibility Computation
// ---------------------------------------------------------------------------

// Computes what a specific player can see based on their vision type,
// position, ambient light, torch status, and racial abilities.
// Returns { visibleTiles: Set, thermalEntities: [], tremorIndicators: [],
//           visionRadius: number, lightLevel: number }

function computePlayerVisibility(playerData, floor, lightMap) {
  var visionType = playerData.visionType || 'normal';
  var config = VISION_CONFIG[visionType] || VISION_CONFIG.normal;
  var px = playerData.x;
  var py = playerData.y;
  var width = floor.width;
  var height = floor.height;

  // Get light level at player position
  var lightLevel = 0;
  if (lightMap && px >= 0 && px < width && py >= 0 && py < height) {
    lightLevel = lightMap[py * width + px];
  }

  // Torch/lantern adds local light
  if (playerData.hasTorch) {
    lightLevel += TORCH_LIGHT_BRIGHTNESS;
  }
  if (playerData.hasLantern) {
    lightLevel += LANTERN_LIGHT_BRIGHTNESS;
  }
  if (lightLevel > 1) lightLevel = 1;

  // Determine darkness state
  var floorAmbient = getAmbientLight(floor.theme, floor.floorNum);
  var isDark = floorAmbient <= DARK_THRESHOLD;
  var isPitchBlack = playerData._isPitchBlack || false;

  // Determine echolocation pulse state
  var isPulseActive = false;
  if (visionType === 'echolocation') {
    var echoPulseTurn = playerData._echolocationPulseTurn || 0;
    var echoCurrentTurn = playerData._echolocationCurrentTurn || 0;
    var turnsSincePulse = echoCurrentTurn - echoPulseTurn;
    isPulseActive = turnsSincePulse % ECHOLOCATION_PULSE_INTERVAL === 0;
  }

  // Use new numeric range system via getEffectiveVisionRange
  var visionTypeDef = playerData._visionTypeDef || null;
  var effectiveRadius = getEffectiveVisionRange(
    visionType, isDark, playerData.hasTorch, playerData.hasLantern,
    isPulseActive, isPitchBlack, visionTypeDef
  );

  // Skill bonus (dwelling)
  if (playerData.fogRevealBonus) {
    effectiveRadius += playerData.fogRevealBonus;
  }

  // Minimum radius: 0 is valid for pitch black with no light, but at least 1 if not pitch black
  if (!isPitchBlack && effectiveRadius < 1) effectiveRadius = 1;

  // Compute FOV via shadowcasting
  var visibleTiles = computeShadowcastFOV(floor.grid, px, py, effectiveRadius, width, height);

  // Thermal vision: detect heat signatures through walls (living only)
  var thermalEntities = [];
  if (config.seesHeat) {
    var heatRange = config.heatRange || 3;
    var wallPen = config.wallPenetration || 1;
    var enemies = floor.enemies;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.alive === false) continue;
      var dx = e.x - px, dy = e.y - py;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= heatRange) {
        var alreadyVisible = visibleTiles.has(e.x + ',' + e.y);
        var living = isEnemyLiving(e);
        // Living enemies: visible through walls (up to wallPenetration walls)
        // Cold enemies: only show if directly visible (with 'cold' marker)
        if (living) {
          var behindWall = !alreadyVisible;
          var wallCount = 0;
          if (behindWall) {
            wallCount = countWallsBetween(floor.grid, px, py, e.x, e.y, width, height);
            if (wallCount > wallPen) continue; // too many walls
          }
          // Intensity fades with distance (1.0 at 0 dist, 0.0 at max range)
          var intensity = Math.max(0.1, 1 - dist / (heatRange + 1));
          thermalEntities.push({
            x: e.x, y: e.y, type: 'living', intensity: intensity,
            behindWall: behindWall, wallCount: wallCount,
          });
        } else if (alreadyVisible) {
          // Cold entities show as 'cold' blip only when directly visible
          thermalEntities.push({
            x: e.x, y: e.y, type: 'cold', intensity: 0.2,
            behindWall: false, wallCount: 0,
          });
        }
      }
    }
    // Also detect players through walls (players are always "living")
    if (playerData.nearbyPlayers) {
      for (var pi = 0; pi < playerData.nearbyPlayers.length; pi++) {
        var np = playerData.nearbyPlayers[pi];
        if (np.id === playerData.id) continue;
        var pdx = np.x - px, pdy = np.y - py;
        var pdist = Math.sqrt(pdx * pdx + pdy * pdy);
        if (pdist <= heatRange) {
          var pAlreadyVisible = visibleTiles.has(np.x + ',' + np.y);
          var pBehindWall = !pAlreadyVisible;
          var pWallCount = 0;
          if (pBehindWall) {
            pWallCount = countWallsBetween(floor.grid, px, py, np.x, np.y, width, height);
            if (pWallCount > wallPen) continue;
          }
          var pIntensity = Math.max(0.1, 1 - pdist / (heatRange + 1));
          thermalEntities.push({
            x: np.x, y: np.y, type: 'player', intensity: pIntensity,
            behindWall: pBehindWall, wallCount: pWallCount,
          });
        }
      }
    }
  }

  // Tremor sense: detect movement through ground
  // Uses _lastMoveTurn tracking: enemies that moved recently are visible,
  // stationary enemies fade after TREMOR_FADE_TURNS turns of not moving.
  // Triggered by racial tremorRange OR by active 'tremor' vision type.
  var tremorIndicators = [];
  var effectiveTremorRange = playerData.tremorRange;
  if (!effectiveTremorRange && config.seesMovement) {
    effectiveTremorRange = 'full'; // tremor vision type grants full tremor sense
  }
  if (effectiveTremorRange) {
    var tConfig = TREMOR_SENSE_CONFIG[effectiveTremorRange] || TREMOR_SENSE_CONFIG.short;
    var tRange = tConfig.range;
    var currentTurn = (floor._currentTurn || 0);
    var enemies2 = floor.enemies;
    for (var ti = 0; ti < enemies2.length; ti++) {
      var te = enemies2[ti];
      if (te.alive === false) continue;
      var tdx = te.x - px, tdy = te.y - py;
      var tDist = Math.sqrt(tdx * tdx + tdy * tdy);
      if (tDist <= tRange && !visibleTiles.has(te.x + ',' + te.y)) {
        if (tConfig.detectsMovement) {
          // Check movement via _lastMoveTurn (set by AI tick in dungeon.js)
          var lastMoved = te._lastMoveTurn || 0;
          var turnsSinceMove = currentTurn - lastMoved;
          // Currently moving (AI state check as fallback for first tick)
          var isMovingState = te.aiState === 'position' || te.aiState === 'evaluate' ||
                              te.aiState === 'reposition' || te.aiState === 'reset' ||
                              te.aiState === 'alert' || te.aiState === 'chase' ||
                              te.aiState === 'attack' || te.aiState === 'fallback' ||
                              te.aiState === 'recover';
          var recentlyMoved = turnsSinceMove <= TREMOR_FADE_TURNS;
          if (isMovingState || recentlyMoved) {
            // Intensity: strong if actively moving, fading if recently stopped
            var tIntensity = isMovingState ? 1.0 : Math.max(0.2, 1 - turnsSinceMove / (TREMOR_FADE_TURNS + 1));
            tremorIndicators.push({
              x: te.x, y: te.y, type: 'enemy', intensity: tIntensity,
              moving: isMovingState,
            });
          }
        }
        if (tConfig.detectsBoss && te.isBoss) {
          tremorIndicators.push({
            x: te.x, y: te.y, type: 'boss', intensity: 1.0,
            moving: true,
          });
        }
      }
    }
    // Detect nearby player movement via tremor
    if (playerData.nearbyPlayers) {
      for (var tpi = 0; tpi < playerData.nearbyPlayers.length; tpi++) {
        var tnp = playerData.nearbyPlayers[tpi];
        if (tnp.id === playerData.id) continue;
        var tnDx = tnp.x - px, tnDy = tnp.y - py;
        var tnDist = Math.sqrt(tnDx * tnDx + tnDy * tnDy);
        if (tnDist <= tRange && !visibleTiles.has(tnp.x + ',' + tnp.y)) {
          // Players are assumed to be moving if they're on the floor
          tremorIndicators.push({
            x: tnp.x, y: tnp.y, type: 'player', intensity: 0.8,
            moving: true,
          });
        }
      }
    }
    // Detect mechanical/construct enemies even when stationary (they hum/vibrate)
    for (var tmi = 0; tmi < enemies2.length; tmi++) {
      var tme = enemies2[tmi];
      if (tme.alive === false) continue;
      var tmKey = tme.x + ',' + tme.y;
      // Skip if already added as a moving enemy
      var alreadyAdded = false;
      for (var tai = 0; tai < tremorIndicators.length; tai++) {
        if (tremorIndicators[tai].x === tme.x && tremorIndicators[tai].y === tme.y) { alreadyAdded = true; break; }
      }
      if (alreadyAdded) continue;
      var tmDx = tme.x - px, tmDy = tme.y - py;
      var tmDist = Math.sqrt(tmDx * tmDx + tmDy * tmDy);
      if (tmDist <= tRange && !visibleTiles.has(tmKey)) {
        var isMechanical = MECHANICAL_ENEMY_PATTERNS.test(tme.name || tme.id || '');
        if (isMechanical) {
          tremorIndicators.push({
            x: tme.x, y: tme.y, type: 'machine', intensity: 0.7, moving: false,
            label: 'mechanical vibration',
          });
        }
      }
    }

    // Detect traps via tremor (pressure plates, tripwires emit faint vibrations)
    if (tConfig.detectsTraps && floor.traps) {
      for (var tri = 0; tri < floor.traps.length; tri++) {
        var trap = floor.traps[tri];
        if (trap.triggered) continue;
        var trDx = trap.x - px, trDy = trap.y - py;
        var trapDist = Math.sqrt(trDx * trDx + trDy * trDy);
        if (trapDist <= tRange && !visibleTiles.has(trap.x + ',' + trap.y)) {
          // Pressure plates and spring traps have stronger vibration signatures
          var trapIntensity = (trap.type === 'pressure_plate' || trap.type === 'spring_trap') ? 0.8 : 0.5;
          tremorIndicators.push({ x: trap.x, y: trap.y, type: 'trap', intensity: trapIntensity, moving: false, label: trap.type || 'trap' });
        }
      }
    }

    // Detect chests/containers via tremor (mechanical locks, magical humming)
    if (tConfig.detectsChests && floor.chests) {
      for (var tci = 0; tci < floor.chests.length; tci++) {
        var tChest = floor.chests[tci];
        if (tChest.opened) continue;
        var tcDx = tChest.x - px, tcDy = tChest.y - py;
        var tcDist = Math.sqrt(tcDx * tcDx + tcDy * tcDy);
        if (tcDist <= tRange && !visibleTiles.has(tChest.x + ',' + tChest.y)) {
          // Locked/trapped chests vibrate more (mechanism tension)
          var chestIntensity = (tChest.locked || tChest.trapped) ? 0.7 : 0.4;
          tremorIndicators.push({ x: tChest.x, y: tChest.y, type: 'chest', intensity: chestIntensity, moving: false, label: tChest.locked ? 'locked mechanism' : 'container' });
        }
      }
    }

    // Detect shrines/NPCs via tremor (magical energy hum, ambient vibration)
    if (tConfig.detectsShrines) {
      var tNpcs = floor.npcs || [];
      for (var tni = 0; tni < tNpcs.length; tni++) {
        var tn = tNpcs[tni];
        var tnDx = tn.x - px, tnDy = tn.y - py;
        var tnDist = Math.sqrt(tnDx * tnDx + tnDy * tnDy);
        if (tnDist <= tRange && !visibleTiles.has(tn.x + ',' + tn.y)) {
          tremorIndicators.push({ x: tn.x, y: tn.y, type: 'shrine', intensity: 0.5, moving: false, label: tn.type || 'energy source' });
        }
      }
    }

    // Detect doors via tremor (hinges, mechanical locks, drafts behind doors)
    if (tConfig.detectsDoors && floor.grid) {
      // Scan grid for door tiles within tremor range
      var doorScanRange = Math.min(tRange, 12);
      var gWidth = floor.width || (floor.grid[0] ? floor.grid[0].length : 0);
      var gHeight = floor.grid.length;
      for (var tdy2 = -doorScanRange; tdy2 <= doorScanRange; tdy2++) {
        for (var tdx2 = -doorScanRange; tdx2 <= doorScanRange; tdx2++) {
          var dgx = px + tdx2, dgy = py + tdy2;
          if (dgx < 0 || dgy < 0 || dgy >= gHeight || dgx >= gWidth) continue;
          var ddist = Math.sqrt(tdx2 * tdx2 + tdy2 * tdy2);
          if (ddist > tRange) continue;
          var dKey = dgx + ',' + dgy;
          if (visibleTiles.has(dKey)) continue;
          var tile = floor.grid[dgy] ? floor.grid[dgy][dgx] : null;
          // Detect door tiles (value 3 = door, or tile objects with .door property)
          var isDoor = (tile === 3) || (tile && tile.type === 'door') || (tile && tile.door);
          if (isDoor) {
            tremorIndicators.push({ x: dgx, y: dgy, type: 'door', intensity: 0.6, moving: false, label: 'door mechanism' });
          }
        }
      }
    }
  }

  // Echolocation: pulse-based reveal of ALL entities
  var echolocationData = null;
  if (visionType === 'echolocation') {
    var echoPulseTurn = playerData._echolocationPulseTurn || 0;
    var echoCurrentTurn = playerData._echolocationCurrentTurn || 0;
    var turnsSincePulse = echoCurrentTurn - echoPulseTurn;
    var pulseActive = turnsSincePulse % ECHOLOCATION_PULSE_INTERVAL === 0;

    if (pulseActive) {
      // On pulse: reveal ALL entities within vision radius (enemies, traps, chests, stealthed)
      // Exception: spectral enemies are not detected by echolocation (no physical presence to echo)
      var echoRange = effectiveRadius + 3; // echolocation gets bonus range on pulse
      var revealedEntities = [];
      var echoEnemies = floor.enemies;
      for (var eci = 0; eci < echoEnemies.length; eci++) {
        var ecE = echoEnemies[eci];
        if (ecE.alive === false) continue;
        // Skip spectral invisible enemies: echolocation cannot detect ethereal beings
        if (ecE.invisibility === 'spectral' && !ecE._invisBroken && !ecE._revealedUntil) continue;
        var ecDx = ecE.x - px, ecDy = ecE.y - py;
        var ecDist = Math.sqrt(ecDx * ecDx + ecDy * ecDy);
        if (ecDist <= echoRange) {
          // Echolocation reveals everything: living, undead, constructs, invisible (except spectral)
          revealedEntities.push({
            x: ecE.x, y: ecE.y, type: isEnemyLiving(ecE) ? 'living' : 'construct',
            name: ecE.name, isBoss: ecE.isBoss || false,
            invisibility: ecE.invisibility || null,
          });
          // Also add to visible tiles so the player actually "sees" them
          visibleTiles.add(ecE.x + ',' + ecE.y);
        }
      }
      // Reveal traps on pulse
      if (floor.traps) {
        for (var ecti = 0; ecti < floor.traps.length; ecti++) {
          var ecTrap = floor.traps[ecti];
          if (ecTrap.triggered) continue;
          var ectDx = ecTrap.x - px, ectDy = ecTrap.y - py;
          var ectDist = Math.sqrt(ectDx * ectDx + ectDy * ectDy);
          if (ectDist <= echoRange) {
            revealedEntities.push({ x: ecTrap.x, y: ecTrap.y, type: 'trap' });
            visibleTiles.add(ecTrap.x + ',' + ecTrap.y);
          }
        }
      }
      // Reveal nearby players
      if (playerData.nearbyPlayers) {
        for (var ecpi = 0; ecpi < playerData.nearbyPlayers.length; ecpi++) {
          var ecNp = playerData.nearbyPlayers[ecpi];
          if (ecNp.id === playerData.id) continue;
          var ecpDx = ecNp.x - px, ecpDy = ecNp.y - py;
          var ecpDist = Math.sqrt(ecpDx * ecpDx + ecpDy * ecpDy);
          if (ecpDist <= echoRange) {
            revealedEntities.push({ x: ecNp.x, y: ecNp.y, type: 'player' });
          }
        }
      }
      echolocationData = { pulseActive: true, revealedEntities: revealedEntities };
    } else {
      // Between pulses: no extra reveals, entities hidden unless in normal vision range
      echolocationData = { pulseActive: false, revealedEntities: [] };
    }
  }

  // Magic Sense / True Seeing: detect magical auras within vision radius
  var magicAuras = [];
  var hasMagicSight = (visionType === 'magic_sense' || visionType === 'true_seeing');
  if (hasMagicSight) {
    var magicRange = effectiveRadius + 2; // magic sight can detect auras slightly beyond visual range

    // Check enemies for magical properties
    var magicEnemies = floor.enemies;
    for (var mi = 0; mi < magicEnemies.length; mi++) {
      var me = magicEnemies[mi];
      if (me.alive === false) continue;
      var mDx = me.x - px, mDy = me.y - py;
      var mDist = Math.sqrt(mDx * mDx + mDy * mDy);
      if (mDist <= magicRange) {
        // Ghost/spirit/spectral enemies have haunted aura
        if (me.isUndead || me.isGhost || (me.name && /ghost|spectr|spirit|wraith|phantom|banshee|ethereal|haunted/i.test(me.name))) {
          magicAuras.push({ x: me.x, y: me.y, type: 'haunted', intensity: 1.0 });
        }
        // Invisible enemies have invisible aura (detected by magic sense)
        // Check both legacy boolean flags and new invisibility type string
        var hasInvisProperty = me.isInvisible || me.isStealth || (me.invisibility && !me._invisBroken);
        if (hasInvisProperty) {
          var invisAuraIntensity = (me.invisibility === 'magical') ? 1.0 : (me.invisibility === 'spectral') ? 0.9 : 0.8;
          magicAuras.push({ x: me.x, y: me.y, type: 'invisible', intensity: invisAuraIntensity, invisibilityType: me.invisibility || 'unknown' });
          // Magic sight / true seeing reveals invisible enemies on the tile map
          if (visionType === 'true_seeing') {
            visibleTiles.add(me.x + ',' + me.y);
          }
        }
        // Enchanted enemies (has element or special abilities)
        if (me.element || me.isBoss) {
          magicAuras.push({ x: me.x, y: me.y, type: 'enchanted', intensity: me.isBoss ? 1.0 : 0.5 });
        }
      }
    }

    // Check chests for curses/enchantments
    var magicChests = floor.chests;
    for (var mci = 0; mci < magicChests.length; mci++) {
      var mc = magicChests[mci];
      if (mc.opened) continue;
      var mcDx = mc.x - px, mcDy = mc.y - py;
      var mcDist = Math.sqrt(mcDx * mcDx + mcDy * mcDy);
      if (mcDist <= magicRange) {
        // Mimics show as cursed aura
        if (mc.isMimic) {
          magicAuras.push({ x: mc.x, y: mc.y, type: 'cursed', intensity: 0.9 });
        } else if (mc.tier === 'legendary' || mc.tier === 'rare') {
          magicAuras.push({ x: mc.x, y: mc.y, type: 'enchanted', intensity: mc.tier === 'legendary' ? 0.8 : 0.4 });
        }
      }
    }

    // Check traps for magical aura (hidden traps glow with cursed aura)
    if (floor.traps) {
      for (var mti = 0; mti < floor.traps.length; mti++) {
        var mt = floor.traps[mti];
        if (mt.triggered) continue;
        var mtDx = mt.x - px, mtDy = mt.y - py;
        var mtDist = Math.sqrt(mtDx * mtDx + mtDy * mtDy);
        if (mtDist <= magicRange) {
          magicAuras.push({ x: mt.x, y: mt.y, type: 'cursed', intensity: 0.6 });
        }
      }
    }

    // Check NPCs for blessed/magical aura (shrines, merchants)
    var magicNpcs = floor.npcs || [];
    for (var mni = 0; mni < magicNpcs.length; mni++) {
      var mn = magicNpcs[mni];
      if (mn.interacted) continue;
      var mnDx = mn.x - px, mnDy = mn.y - py;
      var mnDist = Math.sqrt(mnDx * mnDx + mnDy * mnDy);
      if (mnDist <= magicRange) {
        magicAuras.push({ x: mn.x, y: mn.y, type: 'blessed', intensity: 0.7 });
      }
    }

    // Check shrines (tile type) for blessed aura
    if (floor.grid) {
      var shrineCheckRadius = Math.min(magicRange, 12); // cap grid scan
      for (var scy = Math.max(0, py - shrineCheckRadius); scy <= Math.min(height - 1, py + shrineCheckRadius); scy++) {
        for (var scx = Math.max(0, px - shrineCheckRadius); scx <= Math.min(width - 1, px + shrineCheckRadius); scx++) {
          var scDx = scx - px, scDy = scy - py;
          if (Math.sqrt(scDx * scDx + scDy * scDy) <= magicRange) {
            var tile = floor.grid[scy][scx];
            // TILE.SHRINE = 11 (check via WALKABLE_TILES or known constant)
            if (tile === 11) {
              magicAuras.push({ x: scx, y: scy, type: 'blessed', intensity: 0.5 });
            }
          }
        }
      }
    }

    // Floor-level corruption/haunted tags
    if (floor._magicAuras) {
      for (var fai = 0; fai < floor._magicAuras.length; fai++) {
        var fa = floor._magicAuras[fai];
        var faDx = fa.x - px, faDy = fa.y - py;
        if (Math.sqrt(faDx * faDx + faDy * faDy) <= magicRange) {
          magicAuras.push(fa);
        }
      }
    }
  }

  return {
    visibleTiles: visibleTiles,
    thermalEntities: thermalEntities,
    tremorIndicators: tremorIndicators,
    echolocationData: echolocationData,
    magicAuras: magicAuras,
    visionRadius: effectiveRadius,
    lightLevel: lightLevel,
    visionType: visionType,
    isPitchBlack: isPitchBlack,
  };
}

// ---------------------------------------------------------------------------
// Fog Memory (Three-State)
// ---------------------------------------------------------------------------

// Updates a player's fog memory Uint8Array.
// Tiles in visibleTiles become VISIBLE(2), previously VISIBLE tiles
// become REMEMBERED(1), UNSEEN(0) stays UNSEEN.
// Returns { fogMemory, newlyVisible: [], newlyRemembered: [] } for delta sending.

function updateFogMemory(fogMemory, visibleTiles, width, height) {
  var newlyVisible = [];
  var newlyRemembered = [];

  // First pass: mark all current VISIBLE tiles as REMEMBERED, collect in Set
  var rememberedSet = new Set();
  for (var i = 0; i < fogMemory.length; i++) {
    if (fogMemory[i] === FOG_STATE.VISIBLE) {
      fogMemory[i] = FOG_STATE.REMEMBERED;
      rememberedSet.add(i);
    }
  }

  // Second pass: mark current visible tiles as VISIBLE
  visibleTiles.forEach(function(key) {
    var parts = key.split(',');
    var tx = parseInt(parts[0], 10);
    var ty = parseInt(parts[1], 10);
    if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
      var idx = ty * width + tx;
      var prev = fogMemory[idx];
      fogMemory[idx] = FOG_STATE.VISIBLE;
      if (prev !== FOG_STATE.VISIBLE) {
        newlyVisible.push(idx);
        // Remove from remembered since it's now visible again
        rememberedSet.delete(idx);
      }
    }
  });

  // Convert remembered set to array
  rememberedSet.forEach(function(idx) { newlyRemembered.push(idx); });

  return {
    fogMemory: fogMemory,
    newlyVisible: newlyVisible,
    newlyRemembered: newlyRemembered,
  };
}

// ---------------------------------------------------------------------------
// Floor State Filtering (Per-Player)
// ---------------------------------------------------------------------------

// Filters a floor's entities to only those visible to a specific player.
// Used when building per-player floor state.

function filterFloorStateForPlayer(floor, visibility, fogMemory, width, playerVisionData) {
  var visibleTiles = visibility.visibleTiles;
  var visionType = (playerVisionData && playerVisionData.visionType) ? playerVisionData.visionType : (visibility.visionType || 'normal');
  var currentTurn = (floor._currentTurn || 0);

  // Filter enemies: only include those on visible tiles AND detectable by this player's vision
  var visibleEnemies = [];
  var enemies = floor.enemies;
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    if (e.alive === false) continue;
    if (visibleTiles.has(e.x + ',' + e.y)) {
      // Invisible enemy check: filter out enemies the player's vision can't detect
      if (e.invisibility && !canPlayerSeeEnemy(e, visionType, currentTurn)) {
        continue;
      }
      visibleEnemies.push({
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
        invisibility: e.invisibility || null,
      });
    }
  }

  // Filter chests: show remembered + visible
  var visibleChests = [];
  var chests = floor.chests;
  for (var ci = 0; ci < chests.length; ci++) {
    var c = chests[ci];
    var cIdx = c.y * width + c.x;
    if (fogMemory[cIdx] >= FOG_STATE.REMEMBERED) {
      visibleChests.push({ x: c.x, y: c.y, tier: c.tier, opened: c.opened });
    }
  }

  // Filter NPCs: only on visible tiles (not remembered, since they could move)
  var visibleNpcs = [];
  var npcs = floor.npcs || [];
  for (var ni = 0; ni < npcs.length; ni++) {
    var n = npcs[ni];
    if (n.interacted) continue;
    if (visibleTiles.has(n.x + ',' + n.y)) {
      visibleNpcs.push({ id: n.id, name: n.name, x: n.x, y: n.y, dialogue: n.dialogue, reward: n.reward, roomIndex: n.roomIndex });
    }
  }

  // Traps: show triggered ones in remembered tiles
  var visibleTraps = [];
  var traps = floor.traps || [];
  for (var ti = 0; ti < traps.length; ti++) {
    var t = traps[ti];
    if (!t.triggered) continue;
    var tIdx = t.y * width + t.x;
    if (fogMemory[tIdx] >= FOG_STATE.REMEMBERED) {
      visibleTraps.push(t);
    }
  }

  // Corpses: show on visible or remembered tiles (like chests)
  var visibleCorpses = [];
  var corpses = floor.corpses || [];
  for (var cri = 0; cri < corpses.length; cri++) {
    var cr = corpses[cri];
    var crIdx = cr.y * width + cr.x;
    if (fogMemory[crIdx] >= FOG_STATE.REMEMBERED) {
      visibleCorpses.push({ x: cr.x, y: cr.y, id: cr.id, name: cr.name, description: cr.description, examined: cr.examined });
    }
  }

  // Camps: show on visible or remembered tiles
  var visibleCamps = [];
  var camps = floor.camps || [];
  for (var cai = 0; cai < camps.length; cai++) {
    var ca = camps[cai];
    var caIdx = ca.y * width + ca.x;
    if (fogMemory[caIdx] >= FOG_STATE.REMEMBERED) {
      visibleCamps.push(ca);
    }
  }

  return {
    enemies: visibleEnemies,
    chests: visibleChests,
    npcs: visibleNpcs,
    traps: visibleTraps,
    corpses: visibleCorpses,
    camps: visibleCamps,
    thermalEntities: visibility.thermalEntities,
    tremorIndicators: visibility.tremorIndicators,
    echolocationData: visibility.echolocationData || null,
    magicAuras: visibility.magicAuras || [],
  };
}

// ---------------------------------------------------------------------------
// Utility: build fog state array for initial client send
// ---------------------------------------------------------------------------

function fogMemoryToTileList(fogMemory) {
  // Convert fog memory to arrays of tile indices by state for wire efficiency
  var remembered = [];
  var visible = [];
  for (var i = 0; i < fogMemory.length; i++) {
    if (fogMemory[i] === FOG_STATE.VISIBLE) {
      visible.push(i);
    } else if (fogMemory[i] === FOG_STATE.REMEMBERED) {
      remembered.push(i);
    }
  }
  return { visible: visible, remembered: remembered };
}

// ---------------------------------------------------------------------------
// Utility: compute visibility delta between two visible sets
// ---------------------------------------------------------------------------

function computeVisibilityDelta(oldVisibleSet, newVisibility, fogMemory, floor, width, playerVisionData) {
  var newVisible = newVisibility.visibleTiles;
  var nowVisible = [];
  var nowRemembered = [];
  var visionType = (playerVisionData && playerVisionData.visionType) ? playerVisionData.visionType : (newVisibility.visionType || 'normal');
  var currentTurn = (floor._currentTurn || 0);

  // Tiles that are newly visible (weren't in old set)
  newVisible.forEach(function(key) {
    if (!oldVisibleSet || !oldVisibleSet.has(key)) {
      nowVisible.push(key);
    }
  });

  // Tiles that were visible but no longer are (now remembered)
  if (oldVisibleSet) {
    oldVisibleSet.forEach(function(key) {
      if (!newVisible.has(key)) {
        nowRemembered.push(key);
      }
    });
  }

  // Filter enemies to visible set, respecting invisibility detection
  var visibleEnemies = [];
  var enemies = floor.enemies;
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    if (e.alive === false) continue;
    if (newVisible.has(e.x + ',' + e.y)) {
      // Invisible enemy check: filter out enemies the player's vision can't detect
      if (e.invisibility && !canPlayerSeeEnemy(e, visionType, currentTurn)) {
        continue;
      }
      visibleEnemies.push({
        index: i, id: e.id, name: e.name, x: e.x, y: e.y,
        hp: e.hp, maxHp: e.maxHp || e.hp,
        isBoss: e.isBoss,
        archetype: e.archetype || 'bruiser',
        aiState: e.aiState || 'idle',
        facing: e.facing || 'down',
        isAttacking: e.isAttacking || false,
        windUpTimer: e.windUpTimer || 0,
        isHollowed: e.isHollowed || false,
        isMimic: e.isMimic || false,
        invisibility: e.invisibility || null,
      });
    }
  }

  return {
    nowVisible: nowVisible,
    nowRemembered: nowRemembered,
    visibleEnemies: visibleEnemies,
    thermalEntities: newVisibility.thermalEntities,
    tremorIndicators: newVisibility.tremorIndicators,
    echolocationData: newVisibility.echolocationData || null,
    magicAuras: newVisibility.magicAuras || [],
    visionRadius: newVisibility.visionRadius,
    lightLevel: newVisibility.lightLevel,
    isPitchBlack: newVisibility.isPitchBlack || false,
  };
}

// ---------------------------------------------------------------------------
// Light source helpers
// ---------------------------------------------------------------------------

function createTorchLight(x, y) {
  return { x: x, y: y, radius: TORCH_LIGHT_RADIUS, brightness: TORCH_LIGHT_BRIGHTNESS, type: 'torch' };
}

function createLanternLight(x, y) {
  return { x: x, y: y, radius: LANTERN_LIGHT_RADIUS, brightness: LANTERN_LIGHT_BRIGHTNESS, type: 'lantern' };
}

function createCampfireLight(x, y) {
  return { x: x, y: y, radius: CAMPFIRE_LIGHT_RADIUS, brightness: CAMPFIRE_LIGHT_BRIGHTNESS, type: 'campfire' };
}

// ---------------------------------------------------------------------------
// Client light source collection — compact wire format for rendering
// ---------------------------------------------------------------------------

function collectLightSourcesForClient(floor, staticSources, playerDataMap) {
  var sources = [];
  // Static torches placed on the floor
  if (staticSources) {
    for (var i = 0; i < staticSources.length; i++) {
      var s = staticSources[i];
      sources.push({ x: s.x, y: s.y, r: s.radius, b: s.brightness, t: s.type || 'torch' });
    }
  }
  // Active campfires
  var camps = floor.camps || [];
  for (var ci = 0; ci < camps.length; ci++) {
    if (camps[ci].campfire) {
      sources.push({ x: camps[ci].x, y: camps[ci].y, r: CAMPFIRE_LIGHT_RADIUS, b: CAMPFIRE_LIGHT_BRIGHTNESS, t: 'campfire' });
    }
  }
  // Player-held torches/lanterns
  if (playerDataMap) {
    playerDataMap.forEach(function(pd) {
      if (pd.hasTorch) {
        sources.push({ x: pd.x, y: pd.y, r: TORCH_LIGHT_RADIUS, b: TORCH_LIGHT_BRIGHTNESS, t: 'player_torch' });
      }
      if (pd.hasLantern) {
        sources.push({ x: pd.x, y: pd.y, r: LANTERN_LIGHT_RADIUS, b: LANTERN_LIGHT_BRIGHTNESS, t: 'player_lantern' });
      }
    });
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Constants
  FOG_STATE: FOG_STATE,
  VISION_CONFIG: VISION_CONFIG,
  TREMOR_SENSE_CONFIG: TREMOR_SENSE_CONFIG,
  THEME_LIGHT_LEVELS: THEME_LIGHT_LEVELS,
  TORCH_LIGHT_RADIUS: TORCH_LIGHT_RADIUS,
  TORCH_LIGHT_BRIGHTNESS: TORCH_LIGHT_BRIGHTNESS,
  LANTERN_LIGHT_RADIUS: LANTERN_LIGHT_RADIUS,
  LANTERN_LIGHT_BRIGHTNESS: LANTERN_LIGHT_BRIGHTNESS,
  DARK_THRESHOLD: DARK_THRESHOLD,
  PITCH_BLACK_THRESHOLD: PITCH_BLACK_THRESHOLD,
  ECHOLOCATION_PULSE_INTERVAL: ECHOLOCATION_PULSE_INTERVAL,

  // Core functions
  computeShadowcastFOV: computeShadowcastFOV,
  computePlayerVisibility: computePlayerVisibility,
  updateFogMemory: updateFogMemory,
  filterFloorStateForPlayer: filterFloorStateForPlayer,
  computeLightMap: computeLightMap,
  computeVisibilityDelta: computeVisibilityDelta,
  fogMemoryToTileList: fogMemoryToTileList,
  getAmbientLight: getAmbientLight,
  getEffectiveVisionRange: getEffectiveVisionRange,

  // Darkness helpers
  isDarkFloor: isDarkFloor,
  isPitchBlackFloor: isPitchBlackFloor,
  isPitchBlackRiftFloor: isPitchBlackRiftFloor,
  getDarknessLevel: getDarknessLevel,
  isEnemyLiving: isEnemyLiving,
  countWallsBetween: countWallsBetween,

  // Invisible enemy detection
  canPlayerSeeEnemy: canPlayerSeeEnemy,
  revealEnemy: revealEnemy,
  breakEnemyInvisibility: breakEnemyInvisibility,
  REVEAL_DURATION_DEFAULT: REVEAL_DURATION_DEFAULT,

  // Light source helpers
  createTorchLight: createTorchLight,
  createLanternLight: createLanternLight,
  createCampfireLight: createCampfireLight,
  collectLightSourcesForClient: collectLightSourcesForClient,

  // Init
  setWalkableTiles: setWalkableTiles,
};
