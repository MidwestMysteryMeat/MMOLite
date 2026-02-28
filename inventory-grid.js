// inventory-grid.js — Pure 2D grid logic engine for Tarkov-style inventory.
// No I/O, no account access, no persistence. Operates on grid structs.
//
// Grid struct:
//   { cells: {"x,y": itemId}, width: N, height: N, rev: 0,
//     placements: {[itemId]: {x, y, rotated}} }

'use strict';

// -------------------------------------------------------------------------
// Create a fresh empty grid
// -------------------------------------------------------------------------
function createGrid(width, height) {
  return {
    cells: {},
    width: width,
    height: height,
    rev: 0,
    placements: {},
  };
}

// -------------------------------------------------------------------------
// Get effective item dimensions accounting for rotation
// -------------------------------------------------------------------------
function _dims(item, rotated) {
  var w = item.gridW || 1;
  var h = item.gridH || 1;
  if (rotated) return { w: h, h: w };
  return { w: w, h: h };
}

// -------------------------------------------------------------------------
// canPlace — check if an item fits at (x,y) without collision
// -------------------------------------------------------------------------
function canPlace(grid, item, x, y, rotated) {
  var d = _dims(item, rotated);
  // Bounds check
  if (x < 0 || y < 0 || x + d.w > grid.width || y + d.h > grid.height) return false;
  // Collision check
  for (var cy = y; cy < y + d.h; cy++) {
    for (var cx = x; cx < x + d.w; cx++) {
      var key = cx + ',' + cy;
      if (grid.cells[key]) return false;
    }
  }
  return true;
}

// -------------------------------------------------------------------------
// place — write an item into the grid at (x,y). MUST call canPlace first.
// Returns the grid (mutated in-place).
// -------------------------------------------------------------------------
function place(grid, item, x, y, rotated) {
  var d = _dims(item, rotated);
  var itemId = item.id;
  for (var cy = y; cy < y + d.h; cy++) {
    for (var cx = x; cx < x + d.w; cx++) {
      grid.cells[cx + ',' + cy] = itemId;
    }
  }
  grid.placements[itemId] = { x: x, y: y, rotated: !!rotated };
  return grid;
}

// -------------------------------------------------------------------------
// remove — clear all cells occupied by an item. Returns the grid.
// -------------------------------------------------------------------------
function remove(grid, itemId) {
  var pl = grid.placements[itemId];
  if (!pl) return grid;

  // Clear cells that reference this item
  var keys = Object.keys(grid.cells);
  for (var i = 0; i < keys.length; i++) {
    if (grid.cells[keys[i]] === itemId) {
      delete grid.cells[keys[i]];
    }
  }
  delete grid.placements[itemId];
  return grid;
}

// -------------------------------------------------------------------------
// findFit — auto-find first open position (top-left scan, try both rotations)
// Returns {x, y, rotated} or null if no fit.
// -------------------------------------------------------------------------
function findFit(grid, item) {
  // Try normal orientation first, then rotated
  for (var rot = 0; rot <= 1; rot++) {
    var rotated = rot === 1;
    var d = _dims(item, rotated);
    // Skip rotation if square (same result)
    if (rotated && item.gridW === item.gridH) continue;
    for (var y = 0; y <= grid.height - d.h; y++) {
      for (var x = 0; x <= grid.width - d.w; x++) {
        if (canPlace(grid, item, x, y, rotated)) {
          return { x: x, y: y, rotated: rotated };
        }
      }
    }
  }
  return null;
}

// -------------------------------------------------------------------------
// getItemAt — lookup which itemId occupies cell (x,y)
// -------------------------------------------------------------------------
function getItemAt(grid, x, y) {
  return grid.cells[x + ',' + y] || null;
}

// -------------------------------------------------------------------------
// getOccupiedCells — returns array of {x,y} for a placed item
// -------------------------------------------------------------------------
function getOccupiedCells(grid, itemId) {
  var cells = [];
  var keys = Object.keys(grid.cells);
  for (var i = 0; i < keys.length; i++) {
    if (grid.cells[keys[i]] === itemId) {
      var parts = keys[i].split(',');
      cells.push({ x: parseInt(parts[0]), y: parseInt(parts[1]) });
    }
  }
  return cells;
}

// -------------------------------------------------------------------------
// compact — re-sort all items into top-left positions (for "sort" button).
// Sorts items by size (largest first) then auto-places each.
// Returns the grid (mutated). items = lookup map {itemId: itemObj}.
// -------------------------------------------------------------------------
function compact(grid, items) {
  // Gather current placements
  var placed = [];
  var ids = Object.keys(grid.placements);
  for (var i = 0; i < ids.length; i++) {
    var itemObj = items[ids[i]];
    if (itemObj) placed.push(itemObj);
  }

  // Sort by area descending, then height descending
  placed.sort(function(a, b) {
    var areaA = (a.gridW || 1) * (a.gridH || 1);
    var areaB = (b.gridW || 1) * (b.gridH || 1);
    if (areaB !== areaA) return areaB - areaA;
    return (b.gridH || 1) - (a.gridH || 1);
  });

  // Clear grid
  grid.cells = {};
  grid.placements = {};

  // Re-place each item
  var overflow = [];
  for (var j = 0; j < placed.length; j++) {
    var fit = findFit(grid, placed[j]);
    if (fit) {
      place(grid, placed[j], fit.x, fit.y, fit.rotated);
    } else {
      overflow.push(placed[j].id);
    }
  }
  return { grid: grid, overflow: overflow };
}

// -------------------------------------------------------------------------
// serialize — return a clean snapshot for client sync
// -------------------------------------------------------------------------
function serialize(grid) {
  return {
    cells: grid.cells,
    width: grid.width,
    height: grid.height,
    rev: grid.rev,
    placements: grid.placements,
  };
}

// -------------------------------------------------------------------------
// getCapacity — returns {used, total, free} cell counts
// -------------------------------------------------------------------------
function getCapacity(grid) {
  var total = grid.width * grid.height;
  var used = Object.keys(grid.cells).length;
  return { used: used, total: total, free: total - used };
}

// -------------------------------------------------------------------------
// getPlacement — get placement info for an item
// -------------------------------------------------------------------------
function getPlacement(grid, itemId) {
  return grid.placements[itemId] || null;
}

module.exports = {
  createGrid: createGrid,
  canPlace: canPlace,
  place: place,
  remove: remove,
  findFit: findFit,
  getItemAt: getItemAt,
  getOccupiedCells: getOccupiedCells,
  compact: compact,
  serialize: serialize,
  getCapacity: getCapacity,
  getPlacement: getPlacement,
};
