// dungeon-layouts.js
// Grid-based dungeon layout generators: BSP rooms, maze, lake, open cavern,
// temple halls, arena, island, organic cave, raid arena, ocean arena.
// Initialised with TILE enum via init() to avoid circular require.

var TILE;

function init(deps) {
  TILE = deps.TILE;
}

// ---------------------------------------------------------------------------
// Shared corridor carving utilities (used by multiple layout generators)
// ---------------------------------------------------------------------------

function carveCorridorH(grid, width, height, y, x1, x2) {
  var startX = Math.min(x1, x2);
  var endX = Math.max(x1, x2);
  for (var cx = startX; cx <= endX; cx++) {
    if (y >= 0 && y < height && cx >= 0 && cx < width) {
      if (grid[y][cx] === TILE.WALL) {
        grid[y][cx] = TILE.CORRIDOR;
      }
    }
  }
}

function carveCorridorV(grid, width, height, x, y1, y2) {
  var startY = Math.min(y1, y2);
  var endY = Math.max(y1, y2);
  for (var cy = startY; cy <= endY; cy++) {
    if (cy >= 0 && cy < height && x >= 0 && x < width) {
      if (grid[cy][x] === TILE.WALL) {
        grid[cy][x] = TILE.CORRIDOR;
      }
    }
  }
}

function connectRoomsOnGrid(grid, width, height, roomA, roomB, rng) {
  if (rng() < 0.5) {
    carveCorridorH(grid, width, height, roomA.centerY, roomA.centerX, roomB.centerX);
    carveCorridorV(grid, width, height, roomB.centerX, roomA.centerY, roomB.centerY);
  } else {
    carveCorridorV(grid, width, height, roomA.centerX, roomA.centerY, roomB.centerY);
    carveCorridorH(grid, width, height, roomB.centerY, roomA.centerX, roomB.centerX);
  }
}

function initGrid(width, height) {
  var grid = [];
  for (var y = 0; y < height; y++) {
    grid[y] = [];
    for (var x = 0; x < width; x++) {
      grid[y][x] = TILE.WALL;
    }
  }
  return grid;
}

function ensureMinRooms(grid, width, height, rooms) {
  if (rooms.length < 2) {
    var fallbackRooms = [
      { x: 3, y: 3, w: 6, h: 5 },
      { x: width - 11, y: height - 9, w: 6, h: 5 },
    ];
    for (var fi = rooms.length; fi < 2; fi++) {
      var fb = fallbackRooms[fi];
      for (var fy = fb.y; fy < fb.y + fb.h; fy++) {
        for (var fx = fb.x; fx < fb.x + fb.w; fx++) {
          if (fy >= 0 && fy < height && fx >= 0 && fx < width) {
            grid[fy][fx] = TILE.FLOOR;
          }
        }
      }
      rooms.push({
        x: fb.x, y: fb.y, w: fb.w, h: fb.h,
        centerX: Math.floor(fb.x + fb.w / 2),
        centerY: Math.floor(fb.y + fb.h / 2),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Layout generator: BSP Rooms (original algorithm)
// ---------------------------------------------------------------------------

function generateBSPLayout(width, height, rng, minRooms, maxRooms) {
  var grid = initGrid(width, height);

  var targetRooms = minRooms + Math.floor(rng() * (maxRooms - minRooms + 1));
  var rooms = [];
  var maxAttempts = targetRooms * 30;

  for (var attempt = 0; attempt < maxAttempts && rooms.length < targetRooms; attempt++) {
    var rw = 4 + Math.floor(rng() * 5); // 4-8
    var rh = 4 + Math.floor(rng() * 3); // 4-6
    var rx = 2 + Math.floor(rng() * (width - rw - 4));
    var ry = 2 + Math.floor(rng() * (height - rh - 4));

    var overlap = false;
    for (var ri = 0; ri < rooms.length; ri++) {
      var other = rooms[ri];
      if (rx - 2 < other.x + other.w && rx + rw + 2 > other.x &&
          ry - 2 < other.y + other.h && ry + rh + 2 > other.y) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;

    for (var cy = ry; cy < ry + rh; cy++) {
      for (var cx = rx; cx < rx + rw; cx++) {
        grid[cy][cx] = TILE.FLOOR;
      }
    }

    rooms.push({
      x: rx, y: ry, w: rw, h: rh,
      centerX: Math.floor(rx + rw / 2),
      centerY: Math.floor(ry + rh / 2),
    });
  }

  ensureMinRooms(grid, width, height, rooms);

  for (var ci = 0; ci < rooms.length - 1; ci++) {
    connectRoomsOnGrid(grid, width, height, rooms[ci], rooms[ci + 1], rng);
  }

  if (rooms.length > 3) {
    var extraCount = 1 + Math.floor(rng() * 2);
    for (var ei = 0; ei < extraCount; ei++) {
      var a = Math.floor(rng() * rooms.length);
      var b = Math.floor(rng() * rooms.length);
      if (a !== b) {
        connectRoomsOnGrid(grid, width, height, rooms[a], rooms[b], rng);
      }
    }
  }

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout generator: Maze (recursive backtracker)
// ---------------------------------------------------------------------------

function generateMazeLayout(width, height, rng, minRooms, maxRooms) {
  var grid = initGrid(width, height);

  // Maze cells: each cell is 3x3 tiles (1 floor center + wall border)
  var cellsX = Math.floor((width - 2) / 3);
  var cellsY = Math.floor((height - 2) / 3);
  if (cellsX < 3) cellsX = 3;
  if (cellsY < 3) cellsY = 3;

  var visited = [];
  for (var my = 0; my < cellsY; my++) {
    visited[my] = [];
    for (var mx = 0; mx < cellsX; mx++) {
      visited[my][mx] = false;
    }
  }

  function cellToTile(cx, cy) {
    return { x: 1 + cx * 3 + 1, y: 1 + cy * 3 + 1 };
  }

  function carveCell(cx, cy) {
    var t = cellToTile(cx, cy);
    if (t.y >= 0 && t.y < height && t.x >= 0 && t.x < width) {
      grid[t.y][t.x] = TILE.CORRIDOR;
    }
  }

  function carvePassage(cx1, cy1, cx2, cy2) {
    var t1 = cellToTile(cx1, cy1);
    var t2 = cellToTile(cx2, cy2);
    var px = (t1.x + t2.x) >> 1;
    var py = (t1.y + t2.y) >> 1;
    if (py >= 0 && py < height && px >= 0 && px < width) {
      grid[py][px] = TILE.CORRIDOR;
    }
  }

  // Iterative backtracker (avoids stack overflow on large grids)
  var stack = [];
  var startCX = Math.floor(rng() * cellsX);
  var startCY = Math.floor(rng() * cellsY);
  visited[startCY][startCX] = true;
  carveCell(startCX, startCY);
  stack.push({ x: startCX, y: startCY });

  var dirs = [
    { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
  ];

  while (stack.length > 0) {
    var cur = stack[stack.length - 1];
    var neighbors = [];
    for (var di = 0; di < dirs.length; di++) {
      var nx = cur.x + dirs[di].dx;
      var ny = cur.y + dirs[di].dy;
      if (nx >= 0 && nx < cellsX && ny >= 0 && ny < cellsY && !visited[ny][nx]) {
        neighbors.push({ x: nx, y: ny });
      }
    }

    if (neighbors.length === 0) {
      stack.pop();
    } else {
      var chosen = neighbors[Math.floor(rng() * neighbors.length)];
      visited[chosen.y][chosen.x] = true;
      carvePassage(cur.x, cur.y, chosen.x, chosen.y);
      carveCell(chosen.x, chosen.y);
      stack.push(chosen);
    }
  }

  // Create rooms: expand every 4th cell into a larger room (5x3)
  var rooms = [];
  var targetRoomCount = minRooms + Math.floor(rng() * (maxRooms - minRooms + 1));
  var candidates = [];
  for (var rcy = 0; rcy < cellsY; rcy++) {
    for (var rcx = 0; rcx < cellsX; rcx++) {
      if ((rcy * cellsX + rcx) % 4 === 0) {
        candidates.push({ cx: rcx, cy: rcy });
      }
    }
  }

  // Shuffle candidates (Fisher-Yates)
  for (var si = candidates.length - 1; si > 0; si--) {
    var sj = Math.floor(rng() * (si + 1));
    var tmp = candidates[si];
    candidates[si] = candidates[sj];
    candidates[sj] = tmp;
  }

  var roomCount = Math.min(targetRoomCount, candidates.length);
  for (var ri = 0; ri < roomCount; ri++) {
    var cand = candidates[ri];
    var t = cellToTile(cand.cx, cand.cy);
    var rmx = t.x - 2;
    var rmy = t.y - 1;
    var rmw = 5;
    var rmh = 3;
    if (rmx < 1) rmx = 1;
    if (rmy < 1) rmy = 1;
    if (rmx + rmw >= width - 1) rmw = width - 2 - rmx;
    if (rmy + rmh >= height - 1) rmh = height - 2 - rmy;
    if (rmw < 3) rmw = 3;
    if (rmh < 3) rmh = 3;

    for (var fy = rmy; fy < rmy + rmh && fy < height - 1; fy++) {
      for (var fx = rmx; fx < rmx + rmw && fx < width - 1; fx++) {
        grid[fy][fx] = TILE.FLOOR;
      }
    }

    rooms.push({
      x: rmx, y: rmy, w: rmw, h: rmh,
      centerX: Math.floor(rmx + rmw / 2),
      centerY: Math.floor(rmy + rmh / 2),
    });
  }

  ensureMinRooms(grid, width, height, rooms);

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout generator: Lake (water-filled with walkway bridges)
// ---------------------------------------------------------------------------

function generateLakeLayout(width, height, rng, minRooms, maxRooms) {
  var grid = initGrid(width, height);
  var rooms = [];

  // Main walkway path from left side to right side
  var pathY = Math.floor(height / 2) + Math.floor(rng() * 6) - 3;
  var pathWidth = 1 + Math.floor(rng() * 2); // 1-2 tiles wide
  var curX = 2;
  var curY = pathY;

  while (curX < width - 3) {
    for (var pw = 0; pw < pathWidth; pw++) {
      var py = curY + pw;
      if (py >= 1 && py < height - 1 && curX >= 1 && curX < width - 1) {
        grid[py][curX] = TILE.CORRIDOR;
      }
    }

    var moveRoll = rng();
    if (moveRoll < 0.55) {
      curX++;
    } else if (moveRoll < 0.75) {
      curX++;
      curY = Math.max(2, Math.min(height - 3 - pathWidth, curY - 1));
    } else if (moveRoll < 0.95) {
      curX++;
      curY = Math.max(2, Math.min(height - 3 - pathWidth, curY + 1));
    } else {
      if (rng() < 0.5) {
        curY = Math.max(2, curY - 1);
      } else {
        curY = Math.min(height - 3 - pathWidth, curY + 1);
      }
    }
  }

  // Branch paths (2-4 branches off the main path)
  var branchCount = 2 + Math.floor(rng() * 3);
  var walkTiles = [];
  for (var sy = 0; sy < height; sy++) {
    for (var sx = 0; sx < width; sx++) {
      if (grid[sy][sx] === TILE.CORRIDOR) {
        walkTiles.push({ x: sx, y: sy });
      }
    }
  }

  for (var bi = 0; bi < branchCount && walkTiles.length > 0; bi++) {
    var branchStart = walkTiles[Math.floor(rng() * walkTiles.length)];
    var bx = branchStart.x;
    var by = branchStart.y;
    var bDir = rng() < 0.5 ? -1 : 1;
    var bLen = 5 + Math.floor(rng() * 10);

    for (var bs = 0; bs < bLen; bs++) {
      if (by >= 1 && by < height - 1 && bx >= 1 && bx < width - 1) {
        grid[by][bx] = TILE.CORRIDOR;
      }
      by += bDir;
      if (rng() < 0.3) bx += (rng() < 0.5 ? -1 : 1);
      bx = Math.max(1, Math.min(width - 2, bx));
      by = Math.max(1, Math.min(height - 2, by));
    }
  }

  // Create 3-6 small island rooms connected to walkways
  var islandCount = 3 + Math.floor(rng() * 4);
  walkTiles = [];
  for (var sy2 = 0; sy2 < height; sy2++) {
    for (var sx2 = 0; sx2 < width; sx2++) {
      if (grid[sy2][sx2] === TILE.CORRIDOR) {
        walkTiles.push({ x: sx2, y: sy2 });
      }
    }
  }

  for (var ii = 0; ii < islandCount && walkTiles.length > 0; ii++) {
    var anchor = walkTiles[Math.floor(rng() * walkTiles.length)];
    var offX = (rng() < 0.5 ? -1 : 1) * (2 + Math.floor(rng() * 3));
    var offY = (rng() < 0.5 ? -1 : 1) * (2 + Math.floor(rng() * 3));
    var iw = 3 + Math.floor(rng() * 3); // 3-5
    var ih = 3 + Math.floor(rng() * 2); // 3-4
    var ix = Math.max(1, Math.min(width - iw - 1, anchor.x + offX));
    var iy = Math.max(1, Math.min(height - ih - 1, anchor.y + offY));

    for (var iry = iy; iry < iy + ih; iry++) {
      for (var irx = ix; irx < ix + iw; irx++) {
        grid[iry][irx] = TILE.FLOOR;
      }
    }

    var room = {
      x: ix, y: iy, w: iw, h: ih,
      centerX: Math.floor(ix + iw / 2),
      centerY: Math.floor(iy + ih / 2),
    };
    rooms.push(room);

    connectRoomsOnGrid(grid, width, height, room, { centerX: anchor.x, centerY: anchor.y }, rng);
  }

  // Place some single-tile bridges across water gaps
  var bridgeCount = 2 + Math.floor(rng() * 4);
  for (var bri = 0; bri < bridgeCount; bri++) {
    var bridgeX = 3 + Math.floor(rng() * (width - 6));
    var bridgeY = 3 + Math.floor(rng() * (height - 6));
    if (grid[bridgeY][bridgeX] === TILE.WALL) {
      var hasNearby = false;
      for (var ndy = -2; ndy <= 2 && !hasNearby; ndy++) {
        for (var ndx = -2; ndx <= 2 && !hasNearby; ndx++) {
          var checkY = bridgeY + ndy;
          var checkX = bridgeX + ndx;
          if (checkY >= 0 && checkY < height && checkX >= 0 && checkX < width) {
            if (grid[checkY][checkX] === TILE.CORRIDOR || grid[checkY][checkX] === TILE.FLOOR) {
              hasNearby = true;
            }
          }
        }
      }
      if (hasNearby) {
        grid[bridgeY][bridgeX] = TILE.FLOOR;
      }
    }
  }

  ensureMinRooms(grid, width, height, rooms);

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout generator: Open Cavern (1-2 huge rooms with pillars)
// ---------------------------------------------------------------------------

function generateOpenCavernLayout(width, height, rng, minRooms, maxRooms) {
  var grid = initGrid(width, height);
  var rooms = [];

  var bigRoomCount = 1 + (rng() < 0.5 ? 1 : 0); // 1 or 2

  if (bigRoomCount === 1) {
    var margin = 3;
    var rw = Math.floor(width * (0.6 + rng() * 0.2));
    var rh = Math.floor(height * (0.6 + rng() * 0.2));
    var rx = Math.floor((width - rw) / 2);
    var ry = Math.floor((height - rh) / 2);
    if (rx < margin) rx = margin;
    if (ry < margin) ry = margin;
    if (rx + rw > width - margin) rw = width - margin - rx;
    if (ry + rh > height - margin) rh = height - margin - ry;

    for (var cy = ry; cy < ry + rh; cy++) {
      for (var cx = rx; cx < rx + rw; cx++) {
        grid[cy][cx] = TILE.FLOOR;
      }
    }

    rooms.push({
      x: rx, y: ry, w: rw, h: rh,
      centerX: Math.floor(rx + rw / 2),
      centerY: Math.floor(ry + rh / 2),
    });
  } else {
    var margin2 = 3;
    var halfW = Math.floor((width - margin2 * 3) / 2);
    var roomH = Math.floor(height * (0.55 + rng() * 0.15));
    var roomY = Math.floor((height - roomH) / 2);
    if (roomY < margin2) roomY = margin2;
    if (roomY + roomH > height - margin2) roomH = height - margin2 - roomY;

    var r1x = margin2;
    var r1w = halfW;
    for (var c1y = roomY; c1y < roomY + roomH; c1y++) {
      for (var c1x = r1x; c1x < r1x + r1w; c1x++) {
        grid[c1y][c1x] = TILE.FLOOR;
      }
    }
    rooms.push({
      x: r1x, y: roomY, w: r1w, h: roomH,
      centerX: Math.floor(r1x + r1w / 2),
      centerY: Math.floor(roomY + roomH / 2),
    });

    var r2x = margin2 + halfW + margin2;
    var r2w = halfW;
    if (r2x + r2w > width - margin2) r2w = width - margin2 - r2x;
    for (var c2y = roomY; c2y < roomY + roomH; c2y++) {
      for (var c2x = r2x; c2x < r2x + r2w; c2x++) {
        grid[c2y][c2x] = TILE.FLOOR;
      }
    }
    rooms.push({
      x: r2x, y: roomY, w: r2w, h: roomH,
      centerX: Math.floor(r2x + r2w / 2),
      centerY: Math.floor(roomY + roomH / 2),
    });

    // Connect rooms with wide corridor (3 tiles)
    var connY = Math.floor(roomY + roomH / 2);
    for (var cw = -1; cw <= 1; cw++) {
      var corridorY = connY + cw;
      if (corridorY >= 0 && corridorY < height) {
        carveCorridorH(grid, width, height, corridorY, r1x + r1w, r2x);
      }
    }
  }

  // Scatter pillar clusters (2x2 WALL blocks) inside rooms for cover
  for (var pi = 0; pi < rooms.length; pi++) {
    var rm = rooms[pi];
    var pillarCount = 3 + Math.floor(rng() * 5);
    for (var pj = 0; pj < pillarCount; pj++) {
      var ppx = rm.x + 2 + Math.floor(rng() * Math.max(1, rm.w - 4));
      var ppy = rm.y + 2 + Math.floor(rng() * Math.max(1, rm.h - 4));
      if (Math.abs(ppx - rm.centerX) < 2 && Math.abs(ppy - rm.centerY) < 2) continue;
      for (var pdy = 0; pdy < 2; pdy++) {
        for (var pdx = 0; pdx < 2; pdx++) {
          var tpx = ppx + pdx;
          var tpy = ppy + pdy;
          if (tpy >= rm.y + 1 && tpy < rm.y + rm.h - 1 && tpx >= rm.x + 1 && tpx < rm.x + rm.w - 1) {
            grid[tpy][tpx] = TILE.WALL;
          }
        }
      }
    }
  }

  // Add small alcoves (3x3 rooms) along the walls
  var alcoveCount = 3 + Math.floor(rng() * 4);
  for (var ai = 0; ai < alcoveCount; ai++) {
    var parentRoom = rooms[Math.floor(rng() * rooms.length)];
    var side = Math.floor(rng() * 4);
    var ax, ay;
    if (side === 0) {
      ax = parentRoom.x + 1 + Math.floor(rng() * Math.max(1, parentRoom.w - 4));
      ay = parentRoom.y - 3;
    } else if (side === 1) {
      ax = parentRoom.x + 1 + Math.floor(rng() * Math.max(1, parentRoom.w - 4));
      ay = parentRoom.y + parentRoom.h;
    } else if (side === 2) {
      ax = parentRoom.x - 3;
      ay = parentRoom.y + 1 + Math.floor(rng() * Math.max(1, parentRoom.h - 4));
    } else {
      ax = parentRoom.x + parentRoom.w;
      ay = parentRoom.y + 1 + Math.floor(rng() * Math.max(1, parentRoom.h - 4));
    }

    ax = Math.max(1, Math.min(width - 4, ax));
    ay = Math.max(1, Math.min(height - 4, ay));

    for (var acy = ay; acy < ay + 3 && acy < height - 1; acy++) {
      for (var acx = ax; acx < ax + 3 && acx < width - 1; acx++) {
        grid[acy][acx] = TILE.FLOOR;
      }
    }

    var alcove = {
      x: ax, y: ay, w: 3, h: 3,
      centerX: ax + 1, centerY: ay + 1,
    };
    rooms.push(alcove);

    connectRoomsOnGrid(grid, width, height, alcove, parentRoom, rng);
  }

  ensureMinRooms(grid, width, height, rooms);

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout generator: Temple Halls (long parallel halls with cross-connections)
// ---------------------------------------------------------------------------

function generateTempleHallsLayout(width, height, rng, minRooms, maxRooms) {
  var grid = initGrid(width, height);
  var rooms = [];

  var hallCount = 3 + Math.floor(rng() * 3); // 3-5
  var hallSpacing = Math.floor((height - 4) / (hallCount + 1));
  var hallWidth = 3;
  var hallMarginX = 3;

  var halls = [];
  for (var hi = 0; hi < hallCount; hi++) {
    var hallY = hallSpacing * (hi + 1) - Math.floor(hallWidth / 2);
    hallY = Math.max(2, Math.min(height - hallWidth - 2, hallY));
    var hallStartX = hallMarginX;
    var hallEndX = width - hallMarginX;
    var hallW = hallEndX - hallStartX;

    for (var hy = hallY; hy < hallY + hallWidth; hy++) {
      for (var hx = hallStartX; hx < hallEndX; hx++) {
        if (hy >= 0 && hy < height && hx >= 0 && hx < width) {
          grid[hy][hx] = TILE.FLOOR;
        }
      }
    }

    var hall = {
      x: hallStartX, y: hallY, w: hallW, h: hallWidth,
      centerX: Math.floor(hallStartX + hallW / 2),
      centerY: Math.floor(hallY + hallWidth / 2),
    };
    halls.push(hall);
    rooms.push(hall);
  }

  // 2-4 vertical cross-connections
  var crossCount = 2 + Math.floor(rng() * 3);
  for (var ci = 0; ci < crossCount; ci++) {
    var crossX = hallMarginX + 3 + Math.floor(rng() * Math.max(1, width - hallMarginX * 2 - 6));
    var crossWidth = 2 + Math.floor(rng() * 2); // 2-3 tiles

    var topHall = halls[0];
    var botHall = halls[halls.length - 1];
    var startY = topHall.y;
    var endY = botHall.y + botHall.h;

    for (var ccy = startY; ccy < endY; ccy++) {
      for (var ccx = crossX; ccx < crossX + crossWidth; ccx++) {
        if (ccy >= 0 && ccy < height && ccx >= 0 && ccx < width) {
          if (grid[ccy][ccx] === TILE.WALL) {
            grid[ccy][ccx] = TILE.CORRIDOR;
          }
        }
      }
    }
  }

  // Place small rooms (4x4) at intersection points
  var intersectionRoomCount = 0;
  var maxIntersectionRooms = Math.min(maxRooms - rooms.length, hallCount * crossCount);
  for (var ihi = 0; ihi < halls.length && intersectionRoomCount < maxIntersectionRooms; ihi++) {
    var iHall = halls[ihi];
    for (var isx = iHall.x; isx < iHall.x + iHall.w - 3; isx++) {
      var aboveIsCorridor = (iHall.y - 1 >= 0 && grid[iHall.y - 1][isx] === TILE.CORRIDOR);
      var belowIsCorridor = (iHall.y + iHall.h < height && grid[iHall.y + iHall.h][isx] === TILE.CORRIDOR);
      if ((aboveIsCorridor || belowIsCorridor) && rng() < 0.4 && intersectionRoomCount < maxIntersectionRooms) {
        var irx = Math.max(1, Math.min(width - 5, isx - 1));
        var iry = Math.max(1, Math.min(height - 5, iHall.y - 1));
        for (var iry2 = iry; iry2 < iry + 4 && iry2 < height - 1; iry2++) {
          for (var irx2 = irx; irx2 < irx + 4 && irx2 < width - 1; irx2++) {
            grid[iry2][irx2] = TILE.FLOOR;
          }
        }
        rooms.push({
          x: irx, y: iry, w: 4, h: 4,
          centerX: irx + 2, centerY: iry + 2,
        });
        intersectionRoomCount++;
        isx += 6;
      }
    }
  }

  // Add alcoves along halls
  var alcoveCount = 2 + Math.floor(rng() * 3);
  for (var ali = 0; ali < alcoveCount; ali++) {
    var alcoveHall = halls[Math.floor(rng() * halls.length)];
    var alcoveX = alcoveHall.x + 2 + Math.floor(rng() * Math.max(1, alcoveHall.w - 6));
    var above = rng() < 0.5;
    var alcoveY = above ? alcoveHall.y - 3 : alcoveHall.y + alcoveHall.h;
    alcoveY = Math.max(1, Math.min(height - 4, alcoveY));
    alcoveX = Math.max(1, Math.min(width - 4, alcoveX));

    for (var aly = alcoveY; aly < alcoveY + 3 && aly < height - 1; aly++) {
      for (var alx = alcoveX; alx < alcoveX + 3 && alx < width - 1; alx++) {
        grid[aly][alx] = TILE.FLOOR;
      }
    }

    var alRoom = {
      x: alcoveX, y: alcoveY, w: 3, h: 3,
      centerX: alcoveX + 1, centerY: alcoveY + 1,
    };
    rooms.push(alRoom);
    connectRoomsOnGrid(grid, width, height, alRoom, alcoveHall, rng);
  }

  ensureMinRooms(grid, width, height, rooms);

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout generator: Arena (large central room + surrounding chambers)
// ---------------------------------------------------------------------------

function generateArenaLayout(width, height, rng, minRooms, maxRooms) {
  var grid = initGrid(width, height);
  var rooms = [];

  // Central room: 40-50% of floor space
  var centerFrac = 0.4 + rng() * 0.1;
  var crw = Math.floor(width * Math.sqrt(centerFrac));
  var crh = Math.floor(height * Math.sqrt(centerFrac));
  if (crw < 8) crw = 8;
  if (crh < 6) crh = 6;
  var crx = Math.floor((width - crw) / 2);
  var cry = Math.floor((height - crh) / 2);
  crx = Math.max(2, crx);
  cry = Math.max(2, cry);
  if (crx + crw > width - 2) crw = width - 2 - crx;
  if (cry + crh > height - 2) crh = height - 2 - cry;

  for (var cy = cry; cy < cry + crh; cy++) {
    for (var cx = crx; cx < crx + crw; cx++) {
      grid[cy][cx] = TILE.FLOOR;
    }
  }

  var centralRoom = {
    x: crx, y: cry, w: crw, h: crh,
    centerX: Math.floor(crx + crw / 2),
    centerY: Math.floor(cry + crh / 2),
  };
  rooms.push(centralRoom);

  // Scatter pillar obstacles in central room
  var pillarCount = 2 + Math.floor(rng() * 4);
  for (var pi = 0; pi < pillarCount; pi++) {
    var ppx = crx + 3 + Math.floor(rng() * Math.max(1, crw - 6));
    var ppy = cry + 3 + Math.floor(rng() * Math.max(1, crh - 6));
    if (Math.abs(ppx - centralRoom.centerX) < 2 && Math.abs(ppy - centralRoom.centerY) < 2) continue;
    for (var pdy = 0; pdy < 2; pdy++) {
      for (var pdx = 0; pdx < 2; pdx++) {
        var tpx = ppx + pdx;
        var tpy = ppy + pdy;
        if (tpy >= cry + 1 && tpy < cry + crh - 1 && tpx >= crx + 1 && tpx < crx + crw - 1) {
          grid[tpy][tpx] = TILE.WALL;
        }
      }
    }
  }

  // 4-8 smaller rooms arranged around the perimeter
  var perimRoomCount = 4 + Math.floor(rng() * 5);
  var positions = [];
  positions.push({ x: crx + Math.floor(crw / 2) - 3, y: cry - 7 });
  positions.push({ x: crx + Math.floor(crw / 2) - 3, y: cry + crh + 2 });
  positions.push({ x: crx - 8, y: cry + Math.floor(crh / 2) - 2 });
  positions.push({ x: crx + crw + 2, y: cry + Math.floor(crh / 2) - 2 });
  positions.push({ x: crx - 7, y: cry - 6 });
  positions.push({ x: crx + crw + 1, y: cry - 6 });
  positions.push({ x: crx - 7, y: cry + crh + 1 });
  positions.push({ x: crx + crw + 1, y: cry + crh + 1 });

  // Shuffle positions
  for (var si = positions.length - 1; si > 0; si--) {
    var sj = Math.floor(rng() * (si + 1));
    var tmp = positions[si];
    positions[si] = positions[sj];
    positions[sj] = tmp;
  }

  for (var pri = 0; pri < perimRoomCount && pri < positions.length; pri++) {
    var pos = positions[pri];
    var prw = 4 + Math.floor(rng() * 3); // 4-6
    var prh = 4 + Math.floor(rng() * 3); // 4-6
    var prx = Math.max(1, Math.min(width - prw - 1, pos.x));
    var pry = Math.max(1, Math.min(height - prh - 1, pos.y));

    for (var pcy = pry; pcy < pry + prh; pcy++) {
      for (var pcx = prx; pcx < prx + prw; pcx++) {
        if (pcy >= 0 && pcy < height && pcx >= 0 && pcx < width) {
          grid[pcy][pcx] = TILE.FLOOR;
        }
      }
    }

    var perimRoom = {
      x: prx, y: pry, w: prw, h: prh,
      centerX: Math.floor(prx + prw / 2),
      centerY: Math.floor(pry + prh / 2),
    };
    rooms.push(perimRoom);

    connectRoomsOnGrid(grid, width, height, perimRoom, centralRoom, rng);
  }

  ensureMinRooms(grid, width, height, rooms);

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout generator: Island (scattered platforms connected by narrow bridges)
// ---------------------------------------------------------------------------

function generateIslandLayout(width, height, rng, minRooms, maxRooms) {
  var grid = initGrid(width, height);
  var rooms = [];

  var islandCount = 5 + Math.floor(rng() * 6); // 5-10
  islandCount = Math.max(islandCount, minRooms);
  if (islandCount > maxRooms) islandCount = maxRooms;
  var maxAttempts = islandCount * 40;
  var attempts = 0;

  while (rooms.length < islandCount && attempts < maxAttempts) {
    attempts++;
    var iw = 3 + Math.floor(rng() * 3); // 3-5
    var ih = 3 + Math.floor(rng() * 3); // 3-5
    var ix = 2 + Math.floor(rng() * (width - iw - 4));
    var iy = 2 + Math.floor(rng() * (height - ih - 4));

    var overlap = false;
    for (var ri = 0; ri < rooms.length; ri++) {
      var other = rooms[ri];
      if (ix - 3 < other.x + other.w && ix + iw + 3 > other.x &&
          iy - 3 < other.y + other.h && iy + ih + 3 > other.y) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;

    for (var icy = iy; icy < iy + ih; icy++) {
      for (var icx = ix; icx < ix + iw; icx++) {
        grid[icy][icx] = TILE.FLOOR;
      }
    }

    rooms.push({
      x: ix, y: iy, w: iw, h: ih,
      centerX: Math.floor(ix + iw / 2),
      centerY: Math.floor(iy + ih / 2),
    });
  }

  ensureMinRooms(grid, width, height, rooms);

  // Connect rooms with single-tile-wide bridges
  for (var ci = 0; ci < rooms.length - 1; ci++) {
    var roomA = rooms[ci];
    var roomB = rooms[ci + 1];

    if (rng() < 0.4) {
      if (Math.abs(roomA.centerY - roomB.centerY) <= 2) {
        carveCorridorH(grid, width, height, roomA.centerY, roomA.centerX, roomB.centerX);
      } else if (Math.abs(roomA.centerX - roomB.centerX) <= 2) {
        carveCorridorV(grid, width, height, roomA.centerX, roomA.centerY, roomB.centerY);
      } else {
        connectRoomsOnGrid(grid, width, height, roomA, roomB, rng);
      }
    } else {
      connectRoomsOnGrid(grid, width, height, roomA, roomB, rng);
    }
  }

  // 1-2 extra cross-connections
  if (rooms.length > 3) {
    var extraConns = 1 + Math.floor(rng() * 2);
    for (var ei = 0; ei < extraConns; ei++) {
      var a = Math.floor(rng() * rooms.length);
      var b = Math.floor(rng() * rooms.length);
      if (a !== b) {
        connectRoomsOnGrid(grid, width, height, rooms[a], rooms[b], rng);
      }
    }
  }

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout generator: Organic (cellular automata cave generation)
// ---------------------------------------------------------------------------

function generateOrganicLayout(width, height, rng, minRooms, maxRooms) {
  // Step 1: Fill grid randomly (45% FLOOR, 55% WALL)
  var grid = [];
  for (var y = 0; y < height; y++) {
    grid[y] = [];
    for (var x = 0; x < width; x++) {
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        grid[y][x] = TILE.WALL;
      } else {
        grid[y][x] = (rng() < 0.45) ? TILE.FLOOR : TILE.WALL;
      }
    }
  }

  // Step 2: Run 5 iterations of cellular automata
  for (var iter = 0; iter < 5; iter++) {
    var newGrid = [];
    for (var ny = 0; ny < height; ny++) {
      newGrid[ny] = [];
      for (var nx = 0; nx < width; nx++) {
        if (ny === 0 || ny === height - 1 || nx === 0 || nx === width - 1) {
          newGrid[ny][nx] = TILE.WALL;
          continue;
        }
        var wallCount = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (dy === 0 && dx === 0) continue;
            var ny2 = ny + dy;
            var nx2 = nx + dx;
            if (ny2 < 0 || ny2 >= height || nx2 < 0 || nx2 >= width) {
              wallCount++;
            } else if (grid[ny2][nx2] === TILE.WALL) {
              wallCount++;
            }
          }
        }

        if (grid[ny][nx] === TILE.WALL) {
          newGrid[ny][nx] = (wallCount >= 4) ? TILE.WALL : TILE.FLOOR;
        } else {
          newGrid[ny][nx] = (wallCount >= 5) ? TILE.WALL : TILE.FLOOR;
        }
      }
    }
    grid = newGrid;
  }

  // Step 3: Flood-fill to find the largest connected region
  var regionMap = [];
  for (var ry = 0; ry < height; ry++) {
    regionMap[ry] = [];
    for (var rx = 0; rx < width; rx++) {
      regionMap[ry][rx] = -1;
    }
  }

  var regions = [];
  var regionId = 0;

  for (var fy = 1; fy < height - 1; fy++) {
    for (var fx = 1; fx < width - 1; fx++) {
      if (grid[fy][fx] === TILE.FLOOR && regionMap[fy][fx] === -1) {
        var regionTiles = [];
        var queue = [{ x: fx, y: fy }];
        regionMap[fy][fx] = regionId;

        while (queue.length > 0) {
          var cur = queue.shift();
          regionTiles.push(cur);
          var floodDirs = [
            { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
            { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
          ];
          for (var fdi = 0; fdi < floodDirs.length; fdi++) {
            var fnx = cur.x + floodDirs[fdi].dx;
            var fny = cur.y + floodDirs[fdi].dy;
            if (fnx >= 0 && fnx < width && fny >= 0 && fny < height &&
                grid[fny][fnx] === TILE.FLOOR && regionMap[fny][fnx] === -1) {
              regionMap[fny][fnx] = regionId;
              queue.push({ x: fnx, y: fny });
            }
          }
        }

        regions.push(regionTiles);
        regionId++;
      }
    }
  }

  // Step 4: Find largest region, fill all others with WALL
  var largestIdx = 0;
  var largestSize = 0;
  for (var li = 0; li < regions.length; li++) {
    if (regions[li].length > largestSize) {
      largestSize = regions[li].length;
      largestIdx = li;
    }
  }

  for (var ri2 = 0; ri2 < regions.length; ri2++) {
    if (ri2 !== largestIdx) {
      var tiles = regions[ri2];
      for (var ti = 0; ti < tiles.length; ti++) {
        grid[tiles[ti].y][tiles[ti].x] = TILE.WALL;
      }
    }
  }

  // Defensive: if too few floor tiles, force open space
  if (largestSize < 20) {
    var forcedX = Math.floor(width / 4);
    var forcedY = Math.floor(height / 4);
    var forcedW = Math.floor(width / 2);
    var forcedH = Math.floor(height / 2);
    for (var fry = forcedY; fry < forcedY + forcedH; fry++) {
      for (var frx = forcedX; frx < forcedX + forcedW; frx++) {
        if (fry > 0 && fry < height - 1 && frx > 0 && frx < width - 1) {
          grid[fry][frx] = TILE.FLOOR;
        }
      }
    }
  }

  // Step 5: Identify rooms as rectangular sub-regions within the organic shape
  var rooms = [];
  var usedCells = [];
  for (var uy = 0; uy < height; uy++) {
    usedCells[uy] = [];
    for (var ux = 0; ux < width; ux++) {
      usedCells[uy][ux] = false;
    }
  }

  var targetRoomCount = minRooms + Math.floor(rng() * (maxRooms - minRooms + 1));
  var roomAttempts = 0;
  var maxRoomAttempts = targetRoomCount * 50;

  while (rooms.length < targetRoomCount && roomAttempts < maxRoomAttempts) {
    roomAttempts++;
    var osx = 2 + Math.floor(rng() * (width - 4));
    var osy = 2 + Math.floor(rng() * (height - 4));
    if (grid[osy][osx] !== TILE.FLOOR || usedCells[osy][osx]) continue;

    // Try to expand a rectangle from this point
    var orw = 1;
    var orh = 1;
    while (orw < 6 && osx + orw < width - 1 && grid[osy][osx + orw] === TILE.FLOOR && !usedCells[osy][osx + orw]) orw++;
    var canExpand = true;
    while (orh < 5 && osy + orh < height - 1 && canExpand) {
      for (var chk = osx; chk < osx + orw; chk++) {
        if (grid[osy + orh][chk] !== TILE.FLOOR || usedCells[osy + orh][chk]) {
          canExpand = false;
          break;
        }
      }
      if (canExpand) orh++;
    }

    if (orw >= 3 && orh >= 3) {
      for (var ucy = osy; ucy < osy + orh; ucy++) {
        for (var ucx = osx; ucx < osx + orw; ucx++) {
          usedCells[ucy][ucx] = true;
        }
      }
      rooms.push({
        x: osx, y: osy, w: orw, h: orh,
        centerX: Math.floor(osx + orw / 2),
        centerY: Math.floor(osy + orh / 2),
      });
    }
  }

  ensureMinRooms(grid, width, height, rooms);

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout: RAID_ARENA -- large central arena + waiting room + barrier + 4 alcoves
// ---------------------------------------------------------------------------

function generateRaidArenaLayout(width, height, rng) {
  var grid = [];
  for (var y = 0; y < height; y++) {
    grid[y] = [];
    for (var x = 0; x < width; x++) {
      grid[y][x] = TILE.WALL;
    }
  }

  var rooms = [];

  // Room 1: Waiting room (south side, smaller)
  var waitW = 30, waitH = 20;
  var waitX = Math.floor((width - waitW) / 2);
  var waitY = height - waitH - 2;
  for (var wy = waitY; wy < waitY + waitH; wy++) {
    for (var wx = waitX; wx < waitX + waitW; wx++) {
      grid[wy][wx] = TILE.FLOOR;
    }
  }
  rooms.push({
    x: waitX, y: waitY, w: waitW, h: waitH,
    centerX: waitX + Math.floor(waitW / 2),
    centerY: waitY + Math.floor(waitH / 2),
  });

  // Barrier row (BOSS_DOOR tiles separating waiting room from arena)
  var barrierY = waitY - 1;
  for (var bx = waitX + 4; bx < waitX + waitW - 4; bx++) {
    grid[barrierY][bx] = TILE.BOSS_DOOR;
  }

  // Room 2: Main arena (large central area)
  var arenaW = Math.floor(width * 0.7);
  var arenaH = Math.floor(height * 0.5);
  var arenaX = Math.floor((width - arenaW) / 2);
  var arenaY = Math.floor((barrierY - arenaH) / 2) + 2;
  for (var ay = arenaY; ay < arenaY + arenaH; ay++) {
    for (var ax = arenaX; ax < arenaX + arenaW; ax++) {
      grid[ay][ax] = TILE.FLOOR;
    }
  }
  // Add pillar cover (scattered walls within arena for tactical positioning)
  var pillarCount = 8 + Math.floor(rng() * 6);
  for (var pi = 0; pi < pillarCount; pi++) {
    var px = arenaX + 3 + Math.floor(rng() * (arenaW - 6));
    var py = arenaY + 3 + Math.floor(rng() * (arenaH - 6));
    // 2x2 pillar
    if (py + 1 < arenaY + arenaH && px + 1 < arenaX + arenaW) {
      grid[py][px] = TILE.WALL;
      grid[py][px + 1] = TILE.WALL;
      grid[py + 1][px] = TILE.WALL;
      grid[py + 1][px + 1] = TILE.WALL;
    }
  }
  rooms.push({
    x: arenaX, y: arenaY, w: arenaW, h: arenaH,
    centerX: arenaX + Math.floor(arenaW / 2),
    centerY: arenaY + Math.floor(arenaH / 2),
  });

  // Connect barrier to arena with corridor
  for (var cy = arenaY + arenaH; cy <= barrierY; cy++) {
    for (var cx = waitX + 8; cx < waitX + waitW - 8; cx++) {
      if (grid[cy][cx] === TILE.WALL) grid[cy][cx] = TILE.CORRIDOR;
    }
  }

  // Room 3-6: 4 alcoves at corners of arena (for raid mechanics)
  var alcoveSize = 8;
  var alcovePositions = [
    { x: arenaX - alcoveSize - 1, y: arenaY },                              // top-left
    { x: arenaX + arenaW + 1,     y: arenaY },                              // top-right
    { x: arenaX - alcoveSize - 1, y: arenaY + arenaH - alcoveSize },        // bottom-left
    { x: arenaX + arenaW + 1,     y: arenaY + arenaH - alcoveSize },        // bottom-right
  ];
  for (var ai = 0; ai < alcovePositions.length; ai++) {
    var aPos = alcovePositions[ai];
    if (aPos.x < 1 || aPos.x + alcoveSize >= width - 1) continue;
    if (aPos.y < 1 || aPos.y + alcoveSize >= height - 1) continue;

    for (var aly = aPos.y; aly < aPos.y + alcoveSize; aly++) {
      for (var alx = aPos.x; alx < aPos.x + alcoveSize; alx++) {
        grid[aly][alx] = TILE.FLOOR;
      }
    }
    // Connect alcove to arena with corridor
    var connY = aPos.y + Math.floor(alcoveSize / 2);
    var connStartX = (aPos.x < arenaX) ? aPos.x + alcoveSize : arenaX + arenaW;
    var connEndX = (aPos.x < arenaX) ? arenaX : aPos.x;
    for (var ccx = Math.min(connStartX, connEndX); ccx <= Math.max(connStartX, connEndX); ccx++) {
      if (grid[connY][ccx] === TILE.WALL) grid[connY][ccx] = TILE.CORRIDOR;
    }

    rooms.push({
      x: aPos.x, y: aPos.y, w: alcoveSize, h: alcoveSize,
      centerX: aPos.x + Math.floor(alcoveSize / 2),
      centerY: aPos.y + Math.floor(alcoveSize / 2),
    });
  }

  return { grid: grid, rooms: rooms };
}

// ---------------------------------------------------------------------------
// Layout: OCEAN_ARENA -- open water arena for leviathan encounters
// Spawn platform (bottom), large open arena (center/top), debris + pillars.
// ---------------------------------------------------------------------------

function generateOceanArenaLayout(width, height, rng) {
  var grid = [];
  for (var y = 0; y < height; y++) {
    grid[y] = [];
    for (var x = 0; x < width; x++) {
      grid[y][x] = TILE.WALL;
    }
  }

  var rooms = [];

  // Player spawn platform (bottom section)
  var spawnW = Math.min(30, Math.floor(width * 0.4));
  var spawnH = Math.min(15, Math.floor(height * 0.18));
  var spawnX = Math.floor((width - spawnW) / 2);
  var spawnY = height - spawnH - 2;
  for (var sy = spawnY; sy < spawnY + spawnH; sy++) {
    for (var sx = spawnX; sx < spawnX + spawnW; sx++) {
      grid[sy][sx] = TILE.FLOOR;
    }
  }
  rooms.push({
    x: spawnX, y: spawnY, w: spawnW, h: spawnH,
    centerX: spawnX + Math.floor(spawnW / 2),
    centerY: spawnY + Math.floor(spawnH / 2),
  });

  // Main arena (center/top -- large open water area)
  var arenaW = Math.floor(width * 0.75);
  var arenaH = Math.floor(height * 0.55);
  var arenaX = Math.floor((width - arenaW) / 2);
  var arenaY = 3;
  for (var ay = arenaY; ay < arenaY + arenaH; ay++) {
    for (var ax = arenaX; ax < arenaX + arenaW; ax++) {
      grid[ay][ax] = TILE.FLOOR;
    }
  }
  rooms.push({
    x: arenaX, y: arenaY, w: arenaW, h: arenaH,
    centerX: arenaX + Math.floor(arenaW / 2),
    centerY: arenaY + Math.floor(arenaH / 2),
  });

  // Connecting corridor (spawn platform to arena)
  var corrX = Math.floor(width / 2) - 3;
  var corrTopY = arenaY + arenaH;
  var corrBotY = spawnY;
  for (var cy = corrTopY; cy < corrBotY; cy++) {
    for (var cx = corrX; cx < corrX + 6; cx++) {
      if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
        grid[cy][cx] = TILE.FLOOR;
      }
    }
  }

  // Floating debris: 1x1 WALL obstacles scattered in arena
  var debrisCount = 6 + Math.floor(rng() * 8);
  for (var di = 0; di < debrisCount; di++) {
    var dx = arenaX + 2 + Math.floor(rng() * (arenaW - 4));
    var dy = arenaY + 2 + Math.floor(rng() * (arenaH - 4));
    grid[dy][dx] = TILE.WALL;
  }

  // Coral pillars: 3x3 WALL clusters
  var pillarCount = 3 + Math.floor(rng() * 4);
  for (var pi = 0; pi < pillarCount; pi++) {
    var px = arenaX + 4 + Math.floor(rng() * (arenaW - 8));
    var py = arenaY + 4 + Math.floor(rng() * (arenaH - 8));
    for (var ppy = py; ppy < py + 3 && ppy < arenaY + arenaH - 1; ppy++) {
      for (var ppx = px; ppx < px + 3 && ppx < arenaX + arenaW - 1; ppx++) {
        grid[ppy][ppx] = TILE.WALL;
      }
    }
  }

  // 2x2 debris clusters
  var clusterCount = 2 + Math.floor(rng() * 3);
  for (var ci = 0; ci < clusterCount; ci++) {
    var cxx = arenaX + 3 + Math.floor(rng() * (arenaW - 6));
    var cyy = arenaY + 3 + Math.floor(rng() * (arenaH - 6));
    if (cyy + 1 < arenaY + arenaH && cxx + 1 < arenaX + arenaW) {
      grid[cyy][cxx] = TILE.WALL;
      grid[cyy][cxx + 1] = TILE.WALL;
      grid[cyy + 1][cxx] = TILE.WALL;
      grid[cyy + 1][cxx + 1] = TILE.WALL;
    }
  }

  return { grid: grid, rooms: rooms, spawnRoom: rooms[0], arenaRoom: rooms[1] };
}

// ---------------------------------------------------------------------------
// Layout dispatcher: selects and runs the appropriate generator
// ---------------------------------------------------------------------------

function generateLayoutForFloor(layout, width, height, rng, minRooms, maxRooms) {
  switch (layout) {
    case 'maze':          return generateMazeLayout(width, height, rng, minRooms, maxRooms);
    case 'lake':          return generateLakeLayout(width, height, rng, minRooms, maxRooms);
    case 'open_cavern':   return generateOpenCavernLayout(width, height, rng, minRooms, maxRooms);
    case 'temple_halls':  return generateTempleHallsLayout(width, height, rng, minRooms, maxRooms);
    case 'arena':         return generateArenaLayout(width, height, rng, minRooms, maxRooms);
    case 'island':        return generateIslandLayout(width, height, rng, minRooms, maxRooms);
    case 'organic':       return generateOrganicLayout(width, height, rng, minRooms, maxRooms);
    case 'raid_arena':    return generateRaidArenaLayout(width, height, rng);
    case 'ocean_arena':   return generateOceanArenaLayout(width, height, rng);
    case 'bsp_rooms':     // fall through
    default:              return generateBSPLayout(width, height, rng, minRooms, maxRooms);
  }
}

module.exports = {
  init: init,
  generateBSPLayout: generateBSPLayout,
  generateMazeLayout: generateMazeLayout,
  generateLakeLayout: generateLakeLayout,
  generateOpenCavernLayout: generateOpenCavernLayout,
  generateTempleHallsLayout: generateTempleHallsLayout,
  generateArenaLayout: generateArenaLayout,
  generateIslandLayout: generateIslandLayout,
  generateOrganicLayout: generateOrganicLayout,
  generateRaidArenaLayout: generateRaidArenaLayout,
  generateOceanArenaLayout: generateOceanArenaLayout,
  generateLayoutForFloor: generateLayoutForFloor,
};
