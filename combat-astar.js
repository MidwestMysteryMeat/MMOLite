// combat-astar.js
// A* pathfinding with influence map cost integration.
// Replaces the broken greedy buildMovePath in dungeon-ai.js.
//
// Uses a binary-heap priority queue for O(n log n) performance on
// grids up to 120x90 (raid floors).
//
// Movement is 4-directional (cardinal), matching the existing BFS movement system.

'use strict';

var combatGrid = require('./combat-grid');
var combatTiles = require('./combat-tiles');
var combatInfluence = require('./combat-influence');

var isWalkableExcluding = combatGrid.isWalkableExcluding;
var getAdjacentTiles = combatGrid.getAdjacentTiles;
var manhattanDist = combatGrid.manhattanDist;
var chebyshevDist = combatGrid.chebyshevDist;

// ---------------------------------------------------------------------------
// Binary min-heap for the open set
// ---------------------------------------------------------------------------

function MinHeap() {
  this.data = [];
}

MinHeap.prototype.push = function(node) {
  this.data.push(node);
  this._bubbleUp(this.data.length - 1);
};

MinHeap.prototype.pop = function() {
  var top = this.data[0];
  var last = this.data.pop();
  if (this.data.length > 0) {
    this.data[0] = last;
    this._sinkDown(0);
  }
  return top;
};

MinHeap.prototype.size = function() {
  return this.data.length;
};

MinHeap.prototype._bubbleUp = function(i) {
  while (i > 0) {
    var parent = (i - 1) >> 1;
    if (this.data[i].f < this.data[parent].f) {
      var tmp = this.data[i];
      this.data[i] = this.data[parent];
      this.data[parent] = tmp;
      i = parent;
    } else {
      break;
    }
  }
};

MinHeap.prototype._sinkDown = function(i) {
  var len = this.data.length;
  while (true) {
    var left = 2 * i + 1;
    var right = 2 * i + 2;
    var smallest = i;
    if (left < len && this.data[left].f < this.data[smallest].f) smallest = left;
    if (right < len && this.data[right].f < this.data[smallest].f) smallest = right;
    if (smallest !== i) {
      var tmp = this.data[i];
      this.data[i] = this.data[smallest];
      this.data[smallest] = tmp;
      i = smallest;
    } else {
      break;
    }
  }
};

// ---------------------------------------------------------------------------
// A* pathfinding
// ---------------------------------------------------------------------------

// Find shortest path from (sx,sy) to (tx,ty) using A* with influence costs.
// maxSteps: maximum path length (movement points).
// influenceLayers: from combat-influence.js generateInfluence().
// influenceWeight: how much influence costs affect pathing (0 = pure distance, 1 = full influence).
//
// Returns path as [{x,y}, ...] from start to destination (inclusive), or null if unreachable.
function astarPath(combat, sx, sy, tx, ty, maxSteps, influenceLayers, influenceWeight) {
  var floor = combat.floor;
  if (!floor) return null;

  var grid = floor.grid;
  var width = floor.width;
  var height = floor.height;
  var units = combat.units;

  // Quick bounds check
  if (sx === tx && sy === ty) return [{ x: sx, y: sy }];
  if (tx < 0 || tx >= width || ty < 0 || ty >= height) return null;

  var iw = influenceWeight || 0.5;

  var open = new MinHeap();
  var gScore = {};  // "x,y" -> g cost
  var cameFrom = {}; // "x,y" -> "px,py"
  var closed = {};

  var startKey = sx + ',' + sy;
  gScore[startKey] = 0;

  open.push({ x: sx, y: sy, f: _heuristic(sx, sy, tx, ty), g: 0 });

  var iterations = 0;
  var maxIterations = width * height * 2; // safety cap

  while (open.size() > 0 && iterations < maxIterations) {
    iterations++;

    var current = open.pop();
    var cx = current.x;
    var cy = current.y;
    var cKey = cx + ',' + cy;

    if (cx === tx && cy === ty) {
      return _reconstructPath(cameFrom, cx, cy, sx, sy);
    }

    if (closed[cKey]) continue;
    closed[cKey] = true;

    // Don't expand past maxSteps
    if (current.g >= maxSteps) continue;

    var neighbors = getAdjacentTiles(cx, cy, width, height);
    for (var i = 0; i < neighbors.length; i++) {
      var n = neighbors[i];
      var nKey = n.x + ',' + n.y;
      if (closed[nKey]) continue;

      // Walkability check (exclude the moving unit's own position)
      // Allow walking through the target tile even if occupied (for "move toward")
      var isTarget = (n.x === tx && n.y === ty);
      if (!isTarget && !isWalkableExcluding(grid, n.x, n.y, width, height, units, null)) continue;
      if (isTarget && !_isBasicallyWalkable(grid, n.x, n.y, width, height)) continue;

      // Base movement cost
      var moveCost = 1 + combatTiles.getMoveCostModifier(combat, n.x, n.y);

      // Influence cost
      if (influenceLayers && iw > 0) {
        moveCost += combatInfluence.getInfluenceCost(influenceLayers, n.x, n.y) * iw;
      }

      var tentativeG = current.g + moveCost;

      if (gScore[nKey] !== undefined && gScore[nKey] <= tentativeG) continue;

      gScore[nKey] = tentativeG;
      cameFrom[nKey] = cKey;

      var f = tentativeG + _heuristic(n.x, n.y, tx, ty);
      open.push({ x: n.x, y: n.y, f: f, g: tentativeG });
    }
  }

  return null; // No path found
}

// Find the best tile to move to within maxSteps that gets closest to the target.
// Used when the target is further than maxSteps away.
// Returns path as [{x,y}, ...] from start (inclusive), or null.
function approachPath(combat, sx, sy, tx, ty, maxSteps, influenceLayers, influenceWeight) {
  // Try direct A* first — if target is reachable, use that
  var direct = astarPath(combat, sx, sy, tx, ty, maxSteps, influenceLayers, influenceWeight);
  if (direct) return direct;

  // Target is unreachable within maxSteps — find the reachable tile closest to target
  var floor = combat.floor;
  if (!floor) return null;

  var costMap = combatGrid.bfsMovementRange(
    combat, floor.grid, sx, sy, maxSteps,
    combat.units, floor.width, floor.height, null
  );

  var bestKey = null;
  var bestDist = Infinity;
  var bestCost = Infinity;

  var keys = Object.keys(costMap);
  for (var i = 0; i < keys.length; i++) {
    var parts = keys[i].split(',');
    var rx = parseInt(parts[0], 10);
    var ry = parseInt(parts[1], 10);
    if (rx === sx && ry === sy) continue;

    var dist = manhattanDist(rx, ry, tx, ty);
    var cost = costMap[keys[i]];

    // Influence penalty on destination
    var influencePenalty = 0;
    if (influenceLayers && influenceWeight) {
      influencePenalty = combatInfluence.getInfluenceCost(influenceLayers, rx, ry) * influenceWeight;
    }
    var totalScore = dist + influencePenalty;

    if (totalScore < bestDist || (totalScore === bestDist && cost < bestCost)) {
      bestDist = totalScore;
      bestCost = cost;
      bestKey = keys[i];
    }
  }

  if (!bestKey) return null;

  var bParts = bestKey.split(',');
  var bx = parseInt(bParts[0], 10);
  var by = parseInt(bParts[1], 10);

  // Get BFS path to best tile
  return combatGrid.bfsPath(
    combat, floor.grid, sx, sy, bx, by, maxSteps,
    combat.units, floor.width, floor.height, null
  );
}

// Find a path that moves AWAY from a threat source.
// Used for retreat/kite behavior.
function fleePath(combat, sx, sy, threatX, threatY, maxSteps, influenceLayers) {
  var floor = combat.floor;
  if (!floor) return null;

  var costMap = combatGrid.bfsMovementRange(
    combat, floor.grid, sx, sy, maxSteps,
    combat.units, floor.width, floor.height, null
  );

  var bestKey = null;
  var bestScore = -Infinity;

  var keys = Object.keys(costMap);
  for (var i = 0; i < keys.length; i++) {
    var parts = keys[i].split(',');
    var rx = parseInt(parts[0], 10);
    var ry = parseInt(parts[1], 10);
    if (rx === sx && ry === sy) continue;

    // Distance from threat — higher is better
    var distFromThreat = manhattanDist(rx, ry, threatX, threatY);

    // Penalize danger zones
    var dangerPenalty = 0;
    if (influenceLayers) {
      dangerPenalty = combatInfluence.getValue(
        influenceLayers.dangerZones, rx, ry, influenceLayers.width
      ) * 3;
      // Also penalize tiles with high player threat
      dangerPenalty += combatInfluence.getValue(
        influenceLayers.playerThreat, rx, ry, influenceLayers.width
      ) * 2;
    }

    var score = distFromThreat - dangerPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestKey = keys[i];
    }
  }

  if (!bestKey) return null;

  var bParts = bestKey.split(',');
  var bx = parseInt(bParts[0], 10);
  var by = parseInt(bParts[1], 10);

  return combatGrid.bfsPath(
    combat, floor.grid, sx, sy, bx, by, maxSteps,
    combat.units, floor.width, floor.height, null
  );
}

// Find a flanking path — approach target but prefer tiles that are:
// 1. Adjacent to the target
// 2. NOT adjacent to other enemies already attacking the target
// 3. Have low player threat
function flankPath(combat, sx, sy, target, maxSteps, influenceLayers) {
  var floor = combat.floor;
  if (!floor) return null;

  var grid = floor.grid;
  var width = floor.width;
  var height = floor.height;

  // Find all tiles adjacent to target
  var adjTiles = combatGrid.get8Neighbors(target.x, target.y, width, height);

  // Count how many enemies are already adjacent to target at each position
  var existingAttackers = {};
  combat.units.forEach(function(unit) {
    if (unit.type !== 'enemy' || !unit.alive || unit.isPlayerSummon) return;
    if (chebyshevDist(unit.x, unit.y, target.x, target.y) <= 1) {
      existingAttackers[unit.y * width + unit.x] = true;
    }
  });

  // Score each adjacent tile
  var bestTile = null;
  var bestScore = -Infinity;

  for (var i = 0; i < adjTiles.length; i++) {
    var t = adjTiles[i];
    if (!isWalkableExcluding(grid, t.x, t.y, width, height, combat.units, null)) continue;

    var score = 10; // base score for being adjacent to target

    // Prefer tiles without existing attackers nearby (flanking bonus)
    var nearbyAttackers = 0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (existingAttackers[(t.y + dy) * width + (t.x + dx)]) nearbyAttackers++;
      }
    }
    score -= nearbyAttackers * 3;

    // Influence: prefer low-threat, low-danger tiles
    if (influenceLayers) {
      score -= combatInfluence.getValue(influenceLayers.playerThreat, t.x, t.y, width) * 4;
      score -= combatInfluence.getValue(influenceLayers.dangerZones, t.x, t.y, width) * 5;
      score += combatInfluence.getValue(influenceLayers.allySupport, t.x, t.y, width) * 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestTile = t;
    }
  }

  if (!bestTile) return null;

  // Path to the best flanking tile
  return combatGrid.bfsPath(
    combat, grid, sx, sy, bestTile.x, bestTile.y, maxSteps,
    combat.units, width, height, null
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _heuristic(x1, y1, x2, y2) {
  // Manhattan distance as admissible heuristic for 4-directional movement
  return Math.abs(x2 - x1) + Math.abs(y2 - y1);
}

function _isBasicallyWalkable(grid, x, y, width, height) {
  if (x < 0 || x >= width || y < 0 || y >= height) return false;
  return combatGrid.WALKABLE_TILES[grid[y][x]] === true;
}

function _reconstructPath(cameFrom, cx, cy, sx, sy) {
  var path = [];
  var key = cx + ',' + cy;
  while (key) {
    var parts = key.split(',');
    path.push({ x: parseInt(parts[0], 10), y: parseInt(parts[1], 10) });
    if (parseInt(parts[0], 10) === sx && parseInt(parts[1], 10) === sy) break;
    key = cameFrom[key];
  }
  path.reverse();
  return path;
}

module.exports = {
  astarPath: astarPath,
  approachPath: approachPath,
  fleePath: fleePath,
  flankPath: flankPath,
};
