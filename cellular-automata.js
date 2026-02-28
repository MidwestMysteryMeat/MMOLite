// cellular-automata.js
// Shared cellular automata engine for chunk-based grid systems.
// Provides double-buffered tick, multi-state cells, rule tables, and flood fill.
// Used by: corruption spread, weather fronts, plague system, biome succession, faction influence.

'use strict';

// ---------------------------------------------------------------------------
// Cell state enums (shared across systems)
// ---------------------------------------------------------------------------

var CORRUPTION_STATE = {
  CLEAN: 0,
  TAINTED: 1,
  CORRUPTED: 2,
  BLIGHTED: 3,
  CONSUMED: 4,
};

var WEATHER_STATE = {
  CLEAR: 0,
  CLOUDY: 1,
  RAIN: 2,
  STORM: 3,
  FOG: 4,
  SNOW: 5,
};

var ECOLOGY_STATE = {
  BARREN: 0,
  GRASSLAND: 1,
  SCRUBLAND: 2,
  FOREST: 3,
  OLD_GROWTH: 4,
};

var DISEASE_STATE = {
  HEALTHY: 0,
  EXPOSED: 1,
  INFECTED: 2,
  QUARANTINED: 3,
  RECOVERED: 4,
};

// ---------------------------------------------------------------------------
// Neighbor helpers
// ---------------------------------------------------------------------------

// Get 4-directional neighbor keys (cardinal)
function getNeighbors4(cx, cy) {
  return [
    (cx - 1) + ',' + cy,
    (cx + 1) + ',' + cy,
    cx + ',' + (cy - 1),
    cx + ',' + (cy + 1),
  ];
}

// Get 8-directional neighbor keys (Moore neighborhood)
function getNeighbors8(cx, cy) {
  var result = [];
  for (var dx = -1; dx <= 1; dx++) {
    for (var dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      result.push((cx + dx) + ',' + (cy + dy));
    }
  }
  return result;
}

// Parse 'cx,cy' key to [cx, cy]
function parseKey(key) {
  var i = key.indexOf(',');
  return [parseInt(key.substring(0, i), 10), parseInt(key.substring(i + 1), 10)];
}

// ---------------------------------------------------------------------------
// Double-buffered CA tick
// ---------------------------------------------------------------------------

// Runs one CA tick with double-buffering.
// grid: object keyed by 'cx,cy' -> cell object (must have .state field)
// ruleTable: function(cell, neighborCells, cx, cy) -> newState (or null to keep current)
// neighborMode: 4 or 8 (default 8)
// Returns: { grid: newGrid, changes: number }
function tick(grid, ruleTable, neighborMode) {
  var getNeighbors = (neighborMode === 4) ? getNeighbors4 : getNeighbors8;
  var nextGrid = {};
  var changes = 0;
  var keys = Object.keys(grid);

  // Pass 1: compute next state for existing cells
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var cell = grid[key];
    var coords = parseKey(key);
    var nkeys = getNeighbors(coords[0], coords[1]);
    var neighborCells = [];
    for (var n = 0; n < nkeys.length; n++) {
      if (grid[nkeys[n]]) neighborCells.push(grid[nkeys[n]]);
    }

    var newState = ruleTable(cell, neighborCells, coords[0], coords[1]);
    if (newState !== null && newState !== undefined) {
      if (newState !== cell.state) changes++;
      var newCell = {};
      for (var prop in cell) {
        if (cell.hasOwnProperty(prop)) newCell[prop] = cell[prop];
      }
      newCell.state = newState;
      nextGrid[key] = newCell;
    } else {
      nextGrid[key] = cell;
    }
  }

  return { grid: nextGrid, changes: changes };
}

// Like tick() but also evaluates empty cells adjacent to existing cells
// for "spread" rules (e.g. corruption spreading to clean chunks).
// emptyRuleTable: function(neighborCells, cx, cy) -> newCell or null
function tickWithSpread(grid, ruleTable, emptyRuleTable, neighborMode) {
  var getNeighbors = (neighborMode === 4) ? getNeighbors4 : getNeighbors8;
  var nextGrid = {};
  var changes = 0;
  var keys = Object.keys(grid);
  var checked = {};

  // Pass 1: update existing cells
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var cell = grid[key];
    var coords = parseKey(key);
    var nkeys = getNeighbors(coords[0], coords[1]);
    var neighborCells = [];
    for (var n = 0; n < nkeys.length; n++) {
      if (grid[nkeys[n]]) neighborCells.push(grid[nkeys[n]]);
      // Mark empty neighbors for pass 2
      if (!grid[nkeys[n]] && !checked[nkeys[n]]) {
        checked[nkeys[n]] = true;
      }
    }

    var newState = ruleTable(cell, neighborCells, coords[0], coords[1]);
    if (newState !== null && newState !== undefined) {
      if (newState !== cell.state) changes++;
      var newCell = {};
      for (var prop in cell) {
        if (cell.hasOwnProperty(prop)) newCell[prop] = cell[prop];
      }
      newCell.state = newState;
      nextGrid[key] = newCell;
    } else {
      nextGrid[key] = cell;
    }
  }

  // Pass 2: check empty cells adjacent to existing cells
  var emptyKeys = Object.keys(checked);
  for (var e = 0; e < emptyKeys.length; e++) {
    var ekey = emptyKeys[e];
    if (nextGrid[ekey]) continue; // already handled
    var ecoords = parseKey(ekey);
    var enkeys = getNeighbors(ecoords[0], ecoords[1]);
    var eneighborCells = [];
    for (var en = 0; en < enkeys.length; en++) {
      if (grid[enkeys[en]]) eneighborCells.push(grid[enkeys[en]]);
    }
    if (eneighborCells.length === 0) continue;

    var newCell = emptyRuleTable(eneighborCells, ecoords[0], ecoords[1]);
    if (newCell) {
      nextGrid[ekey] = newCell;
      changes++;
    }
  }

  return { grid: nextGrid, changes: changes };
}

// ---------------------------------------------------------------------------
// Flood fill / connected components
// ---------------------------------------------------------------------------

// BFS flood fill from a starting key. Returns set of connected keys
// that pass the predicate function.
// predicate: function(cell) -> boolean
function floodFill(grid, startKey, predicate) {
  if (!grid[startKey] || !predicate(grid[startKey])) return new Set();

  var visited = new Set();
  var queue = [startKey];
  visited.add(startKey);

  while (queue.length > 0) {
    var key = queue.shift();
    var coords = parseKey(key);
    var neighbors = getNeighbors4(coords[0], coords[1]);
    for (var i = 0; i < neighbors.length; i++) {
      var nkey = neighbors[i];
      if (visited.has(nkey)) continue;
      if (!grid[nkey] || !predicate(grid[nkey])) continue;
      visited.add(nkey);
      queue.push(nkey);
    }
  }

  return visited;
}

// Find all connected components in grid matching predicate.
// Returns array of Sets (each set is a connected region of keys).
function findConnectedComponents(grid, predicate) {
  var components = [];
  var globalVisited = new Set();
  var keys = Object.keys(grid);

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (globalVisited.has(key)) continue;
    if (!predicate(grid[key])) continue;

    var component = floodFill(grid, key, predicate);
    component.forEach(function(k) { globalVisited.add(k); });
    components.push(component);
  }

  return components;
}

// Multi-source BFS: compute distance from multiple source positions.
// sources: array of 'cx,cy' keys
// isPassable: function(cx, cy) -> boolean
// maxDist: maximum distance to explore
// Returns: object keyed by 'cx,cy' -> distance
function multiSourceBFS(sources, isPassable, maxDist) {
  var dist = {};
  var queue = [];

  for (var i = 0; i < sources.length; i++) {
    dist[sources[i]] = 0;
    queue.push(sources[i]);
  }

  var head = 0;
  while (head < queue.length) {
    var key = queue[head++];
    var d = dist[key];
    if (d >= maxDist) continue;

    var coords = parseKey(key);
    var neighbors = getNeighbors4(coords[0], coords[1]);
    for (var n = 0; n < neighbors.length; n++) {
      var nkey = neighbors[n];
      if (dist[nkey] !== undefined) continue;
      var nc = parseKey(nkey);
      if (!isPassable(nc[0], nc[1])) continue;
      dist[nkey] = d + 1;
      queue.push(nkey);
    }
  }

  return dist;
}

// Flood fill on a tile grid (2D array).
// Returns set of 'x,y' keys that are reachable from (startX, startY)
// and pass the predicate. Used for enclosed zone detection.
function floodFillTileGrid(grid, width, height, startX, startY, isPassable) {
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return new Set();
  if (!isPassable(startX, startY)) return new Set();

  var visited = new Set();
  var startKey = startX + ',' + startY;
  visited.add(startKey);
  var queue = [{ x: startX, y: startY }];
  var head = 0;

  while (head < queue.length) {
    var curr = queue[head++];
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var d = 0; d < 4; d++) {
      var nx = curr.x + dirs[d][0];
      var ny = curr.y + dirs[d][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      var nkey = nx + ',' + ny;
      if (visited.has(nkey)) continue;
      if (!isPassable(nx, ny)) continue;
      visited.add(nkey);
      queue.push({ x: nx, y: ny });
    }
  }

  return visited;
}

// ---------------------------------------------------------------------------
// Count neighbors in a given state
// ---------------------------------------------------------------------------

function countNeighborsInState(neighborCells, targetState) {
  var count = 0;
  for (var i = 0; i < neighborCells.length; i++) {
    if (neighborCells[i].state === targetState) count++;
  }
  return count;
}

function countNeighborsAboveState(neighborCells, minState) {
  var count = 0;
  for (var i = 0; i < neighborCells.length; i++) {
    if (neighborCells[i].state >= minState) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // State enums
  CORRUPTION_STATE: CORRUPTION_STATE,
  WEATHER_STATE: WEATHER_STATE,
  ECOLOGY_STATE: ECOLOGY_STATE,
  DISEASE_STATE: DISEASE_STATE,

  // Neighbor helpers
  getNeighbors4: getNeighbors4,
  getNeighbors8: getNeighbors8,
  parseKey: parseKey,

  // CA tick
  tick: tick,
  tickWithSpread: tickWithSpread,

  // Flood fill / BFS
  floodFill: floodFill,
  findConnectedComponents: findConnectedComponents,
  multiSourceBFS: multiSourceBFS,
  floodFillTileGrid: floodFillTileGrid,

  // Counting helpers
  countNeighborsInState: countNeighborsInState,
  countNeighborsAboveState: countNeighborsAboveState,
};
