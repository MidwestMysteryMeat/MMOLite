// combat-influence.js
// Multi-layer influence map system for tactical combat AI.
// Generates per-turn cached maps that encode spatial threat, support,
// danger zones, and control for the AI pathfinding and utility scoring.
//
// Each layer is a flat Float32Array indexed by (y * width + x).
// Influence decays linearly from source tiles.

'use strict';

var combatGrid = require('./combat-grid');
var combatTiles = require('./combat-tiles');

var chebyshevDist = combatGrid.chebyshevDist;

// ---------------------------------------------------------------------------
// Influence map cache — one per combat, invalidated each turn
// ---------------------------------------------------------------------------

// WeakMap keyed by combat object → { turnNumber, layers }
var _cache = new WeakMap();

function _getCached(combat) {
  var entry = _cache.get(combat);
  if (entry && entry.turnNumber === combat.turnNumber) return entry.layers;
  return null;
}

function _setCache(combat, layers) {
  _cache.set(combat, { turnNumber: combat.turnNumber, layers: layers });
}

// ---------------------------------------------------------------------------
// Layer generation
// ---------------------------------------------------------------------------

// Spread influence from a source tile outward using BFS.
// value decays linearly: sourceValue * (1 - dist/maxRadius).
function _spreadInfluence(layer, width, height, sx, sy, maxRadius, sourceValue, grid) {
  var queue = [sx, sy, 0]; // flat: x, y, dist triples
  var visited = {};
  visited[sy * width + sx] = true;
  var head = 0;

  while (head < queue.length) {
    var cx = queue[head++];
    var cy = queue[head++];
    var cd = queue[head++];

    var idx = cy * width + cx;
    var val = sourceValue * (1 - cd / (maxRadius + 1));
    if (layer[idx] < val) layer[idx] = val;

    if (cd >= maxRadius) continue;

    // 4-directional spread (matching movement grid)
    var nd = cd + 1;
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var d = 0; d < 4; d++) {
      var nx = cx + dirs[d][0];
      var ny = cy + dirs[d][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      var nIdx = ny * width + nx;
      if (visited[nIdx]) continue;
      // Walls block influence spread
      if (grid && grid[ny][nx] === 1) continue;
      visited[nIdx] = true;
      queue.push(nx, ny, nd);
    }
  }
}

// Generate player threat layer: how much danger players pose to each tile.
// High values = tiles where players can attack effectively.
function _genPlayerThreat(combat, width, height, grid) {
  var layer = new Float32Array(width * height);
  combat.units.forEach(function(unit) {
    if (unit.type !== 'player' || !unit.alive) return;
    var atk = (unit.combat && unit.combat.atk) ? unit.combat.atk : 10;
    var range = (unit.combat && unit.combat.range) ? unit.combat.range : 1;
    // Threat value scales with attack power, normalized to 0-1 range
    var threatVal = Math.min(1.0, atk / 40);
    // Spread threat from player position outward by their attack range + movement
    var mp = unit.mp || 3;
    _spreadInfluence(layer, width, height, unit.x, unit.y, range + mp, threatVal, grid);
  });
  return layer;
}

// Generate enemy support layer: tiles near friendly enemies provide support value.
// Encourages grouping / flanking coordination.
function _genAllySupport(combat, width, height, grid, selfId) {
  var layer = new Float32Array(width * height);
  combat.units.forEach(function(unit) {
    if (unit.type !== 'enemy' || !unit.alive || unit.id === selfId) return;
    if (unit.isPlayerSummon) return;
    // Support value: being near allies is worth ~0.3-0.5
    var supportVal = 0.4;
    _spreadInfluence(layer, width, height, unit.x, unit.y, 3, supportVal, grid);
  });
  return layer;
}

// Generate danger zone layer: tile effects that deal damage or hinder movement.
function _genDangerZones(combat, width, height) {
  var layer = new Float32Array(width * height);
  if (!combat.tileEffects) return layer;

  combat.tileEffects.forEach(function(effect) {
    if (!effect || !effect.type) return;
    var def = combatTiles.TILE_EFFECTS[effect.type];
    if (!def) return;

    var dangerVal = 0;
    if (def.damage) dangerVal = Math.min(1.0, def.damage / 15);
    if (def.moveCost) dangerVal = Math.max(dangerVal, 0.3);
    if (def.speedMod && def.speedMod < 0) dangerVal = Math.max(dangerVal, 0.2);

    if (dangerVal > 0) {
      var idx = effect.y * width + effect.x;
      if (idx >= 0 && idx < layer.length) {
        layer[idx] = Math.max(layer[idx], dangerVal);
      }
    }
  });
  return layer;
}

// Generate player control layer: tiles within player weapon range.
// Tiles where standing means you'll get hit.
function _genPlayerControl(combat, width, height) {
  var layer = new Float32Array(width * height);
  combat.units.forEach(function(unit) {
    if (unit.type !== 'player' || !unit.alive) return;
    var range = (unit.combat && unit.combat.range) ? unit.combat.range : 1;
    // Mark tiles within weapon range
    for (var dy = -range; dy <= range; dy++) {
      for (var dx = -range; dx <= range; dx++) {
        var nx = unit.x + dx;
        var ny = unit.y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (chebyshevDist(unit.x, unit.y, nx, ny) <= range) {
          var idx = ny * width + nx;
          layer[idx] = Math.max(layer[idx], 0.6);
        }
      }
    }
  });
  return layer;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Generate all influence layers for a combat instance.
// Returns { playerThreat, allySupport, dangerZones, playerControl }
// Cached per turn number.
function generateInfluence(combat, selfId) {
  var cached = _getCached(combat);
  if (cached && cached._selfId === selfId) return cached;

  var floor = combat.floor;
  if (!floor) return _emptyLayers(0, 0);

  var width = floor.width;
  var height = floor.height;
  var grid = floor.grid;

  var layers = {
    playerThreat: _genPlayerThreat(combat, width, height, grid),
    allySupport: _genAllySupport(combat, width, height, grid, selfId),
    dangerZones: _genDangerZones(combat, width, height),
    playerControl: _genPlayerControl(combat, width, height),
    width: width,
    height: height,
    _selfId: selfId,
  };

  _setCache(combat, layers);
  return layers;
}

function _emptyLayers(w, h) {
  var empty = new Float32Array(w * h);
  return {
    playerThreat: empty,
    allySupport: empty,
    dangerZones: empty,
    playerControl: empty,
    width: w,
    height: h,
    _selfId: null,
  };
}

// Read a single layer value at (x, y)
function getValue(layer, x, y, width) {
  if (!layer) return 0;
  var idx = y * width + x;
  if (idx < 0 || idx >= layer.length) return 0;
  return layer[idx];
}

// Composite score for a tile: weighted combination of all layers.
// weights: { threat, support, danger, control }
// Returns a float — higher = better for the enemy to stand on.
function scoreTile(layers, x, y, weights) {
  if (!layers || x < 0 || x >= layers.width || y < 0 || y >= layers.height) return -999;

  var idx = y * layers.width + x;
  var w = weights || { threat: -0.4, support: 0.3, danger: -0.5, control: -0.2 };

  var score = 0;
  score += layers.playerThreat[idx] * (w.threat || 0);
  score += layers.allySupport[idx] * (w.support || 0);
  score += layers.dangerZones[idx] * (w.danger || 0);
  score += layers.playerControl[idx] * (w.control || 0);

  return score;
}

// Get the influence cost modifier for A* pathfinding.
// Tiles in danger zones or under heavy player threat cost more to traverse.
function getInfluenceCost(layers, x, y) {
  if (!layers || x < 0 || x >= layers.width || y < 0 || y >= layers.height) return 0;

  var idx = y * layers.width + x;
  var cost = 0;

  // Danger zones add movement cost
  cost += layers.dangerZones[idx] * 2;

  // Heavy player threat adds a smaller cost (AI avoids walking through kill zones)
  if (layers.playerThreat[idx] > 0.6) {
    cost += (layers.playerThreat[idx] - 0.6) * 1.5;
  }

  return cost;
}

module.exports = {
  generateInfluence: generateInfluence,
  getValue: getValue,
  scoreTile: scoreTile,
  getInfluenceCost: getInfluenceCost,
};
