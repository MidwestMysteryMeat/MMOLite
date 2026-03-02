// handlers/placement.js
// Player-built structure placement, removal, and interaction handler.
// Handles placing objects in zones, removing owned objects, and interacting
// with chests, doors, and locks.

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var dataDir = require('../data-dir');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var plotModule = require('./plot');
var worldgen = require('../worldgen');
var PLACEABLE_TYPES = [
  'forge', 'iron_anvil', 'storage_chest', 'wall', 'door', 'raft', 'bridge',
  'crop_plot', 'water_trough', 'crafting_table', 'upgrade_station', 'trading_booth',
  'bed', 'bookshelf', 'cauldron', 'table', 'chair', 'barrel', 'crate', 'banner',
  'loom', 'alchemy_table', 'enchanting_table', 'tanning_rack', 'brewery', 'jewelers_bench',
  // Structural
  'stone_wall', 'fence', 'stone_fence', 'iron_fence', 'window', 'floor_tile', 'stone_floor', 'carpet', 'stairs', 'roof_tile',
  // Decorative
  'lantern', 'torch_sconce', 'signpost', 'flower_pot', 'painting', 'rug', 'clock', 'trophy_mount', 'statue',
  // Functional
  'well', 'animal_pen', 'scarecrow', 'sprinkler', 'garden_bed',
  // Upgraded stations
  'advanced_forge', 'master_forge', 'advanced_alchemy_table', 'master_alchemy_table',
  'advanced_loom', 'master_loom', 'advanced_brewery', 'master_brewery', 'advanced_enchanting_table',
];
var WATER_PLACEABLE_TYPES = ['bridge'];  // types that must be placed on water
var PLACEMENT_DISTANCES = {
  wall: 0, door: 0, bridge: 0,
  storage_chest: 20, raft: 30,
  forge: 60, iron_anvil: 60,
  crop_plot: 20, water_trough: 30,
  crafting_table: 40, upgrade_station: 60, trading_booth: 80,
  bed: 15, table: 10, chair: 10, bookshelf: 10,
  barrel: 10, crate: 10, banner: 10, cauldron: 40,
  loom: 60,
  alchemy_table: 60,
  enchanting_table: 60,
  tanning_rack: 60,
  brewery: 60,
  jewelers_bench: 60,
  // Structural (0px)
  stone_wall: 0, fence: 0, stone_fence: 0, iron_fence: 0, window: 0,
  floor_tile: 0, stone_floor: 0, carpet: 0, stairs: 0, roof_tile: 0,
  // Decorative
  lantern: 10, torch_sconce: 10, signpost: 20, flower_pot: 10, painting: 10,
  rug: 10, clock: 20, trophy_mount: 15, statue: 30,
  // Functional
  well: 60, animal_pen: 80, scarecrow: 40, sprinkler: 40, garden_bed: 20,
  // Upgraded stations
  advanced_forge: 60, master_forge: 60,
  advanced_alchemy_table: 60, master_alchemy_table: 60,
  advanced_loom: 60, master_loom: 60,
  advanced_brewery: 60, master_brewery: 60,
  advanced_enchanting_table: 60,
};
var DEFAULT_PLACEMENT_DISTANCE = 40;
var BRIDGE_PLACEMENT_RANGE = 80;   // extended range for bridge placement (reaching from shore)
var INTERACT_RANGE = 100;          // max px for interaction / removal
var MAX_CHEST_SLOTS = 20;          // max items per chest


// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

var PLACEMENTS_DIR = dataDir.subdir('placements');
var _pendingSaves = new Map();  // zoneId -> timeout handle
var SAVE_DEBOUNCE_MS = 1000;    // debounce writes by 1 second

function savePlacements(zoneId, placedObjects) {
  // Debounce: schedule async write, coalescing rapid saves for same zone
  if (_pendingSaves.has(zoneId)) {
    clearTimeout(_pendingSaves.get(zoneId));
  }
  _pendingSaves.set(zoneId, setTimeout(function() {
    _pendingSaves.delete(zoneId);
    var fp = path.join(PLACEMENTS_DIR, zoneId + '.json');
    var data = JSON.stringify(placedObjects);
    fs.writeFile(fp, data, function(err) {
      if (err) console.error('[placement] Save error:', err.message);
    });
  }, SAVE_DEBOUNCE_MS));
}

function loadPlacements(zoneId) {
  try {
    var fp = path.join(PLACEMENTS_DIR, zoneId + '.json');
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, 'utf8'));
    }
  } catch (e) {
    console.error('[placement] Load error:', e.message);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateObjectId() {
  return crypto.randomBytes(8).toString('hex');
}

function distanceSq(x1, y1, x2, y2) {
  var dx = x1 - x2;
  var dy = y1 - y2;
  return dx * dx + dy * dy;
}

function isProtected(zone, x, y) {
  if (!zone.protectedArea) return false;
  var pa = zone.protectedArea;
  return x >= pa.x && x < pa.x + pa.width && y >= pa.y && y < pa.y + pa.height;
}

function ensurePlacedObjects(zone) {
  if (!zone.placedObjects) {
    zone.placedObjects = loadPlacements(zone.id);
  }
  return zone.placedObjects;
}

function findPlacedObject(zone, objectId) {
  var objects = ensurePlacedObjects(zone);
  for (var i = 0; i < objects.length; i++) {
    if (objects[i].id === objectId) return objects[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler init
// ---------------------------------------------------------------------------

function init(io, socket, deps) {
  var state = deps.state;
  var socketAccountMap = deps.socketAccountMap;
  var accounts = deps.accounts;
  var checkEventRate = deps.checkEventRate;

  // -----------------------------------------------------------------------
  // place_object
  // -----------------------------------------------------------------------
  socket.on('place_object', function(data) {
    try {
      if (!data || typeof data.itemId !== 'string' || typeof data.x !== 'number' || typeof data.y !== 'number') return;

      var key = socketAccountMap.get(socket.id);
      if (!key) {
        socket.emit('place_result', { success: false, message: 'No account linked' });
        return;
      }

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) {
        socket.emit('place_result', { success: false, message: 'Not in a zone' });
        return;
      }

      var zone = state.zones.get(zoneId);
      if (!zone) {
        socket.emit('place_result', { success: false, message: 'Zone not found' });
        return;
      }

      // Validate coordinates are finite and within zone bounds
      if (!isFinite(data.x) || !isFinite(data.y)) return;
      var px = Math.floor(data.x);
      var py = Math.floor(data.y);
      if (px < 0 || px > (zone.width || 1600) || py < 0 || py > (zone.height || 1200)) {
        socket.emit('place_result', { success: false, message: 'Position out of bounds' });
        return;
      }

      // Check protected area
      if (isProtected(zone, px, py)) {
        socket.emit('place_result', { success: false, message: 'Cannot build in the starting town' });
        return;
      }

      // Peek at item type for water-placeable bypass (bridge)
      var peekInv = accounts.getMMOInventory(key);
      var peekItem = null;
      if (peekInv && peekInv.items) {
        for (var pi = 0; pi < peekInv.items.length; pi++) {
          if (peekInv.items[pi].id === data.itemId) { peekItem = peekInv.items[pi]; break; }
        }
      }
      var isWaterPlaceable = peekItem && WATER_PLACEABLE_TYPES.indexOf(peekItem.type) !== -1;

      // Water-placeable items (bridges): must target water tile, exempt from plot checks
      if (isWaterPlaceable && zone.chunkCache) {
        // Validate target tile is a water feature
        var tcx = Math.floor(px / worldgen.CHUNK_SIZE);
        var tcy = Math.floor(py / worldgen.CHUNK_SIZE);
        var chunkKey = tcx + ',' + tcy;
        var chunk = zone.chunkCache.get ? zone.chunkCache.get(chunkKey) : zone.chunkCache[chunkKey];
        if (chunk && chunk.features) {
          var localTX = Math.floor((px - tcx * worldgen.CHUNK_SIZE) / worldgen.TILE_SIZE);
          var localTY = Math.floor((py - tcy * worldgen.CHUNK_SIZE) / worldgen.TILE_SIZE);
          localTX = Math.max(0, Math.min(worldgen.TILES_PER_CHUNK - 1, localTX));
          localTY = Math.max(0, Math.min(worldgen.TILES_PER_CHUNK - 1, localTY));
          var feat = chunk.features[localTY * worldgen.TILES_PER_CHUNK + localTX];
          if (feat !== worldgen.FEATURE_RIVER && feat !== worldgen.FEATURE_LAKE && feat !== worldgen.FEATURE_SHALLOW_WATER) {
            socket.emit('place_result', { success: false, message: 'Bridges must be placed on water' });
            return;
          }
        }
        // Check player is on land (not standing in water)
        var playerPos = state.playerPositions.get(socket.id);
        if (playerPos) {
          var pcx = Math.floor(playerPos.x / worldgen.CHUNK_SIZE);
          var pcy = Math.floor(playerPos.y / worldgen.CHUNK_SIZE);
          var pChunk = zone.chunkCache.get ? zone.chunkCache.get(pcx + ',' + pcy) : zone.chunkCache[pcx + ',' + pcy];
          if (pChunk && pChunk.features) {
            var pltx = Math.floor((playerPos.x - pcx * worldgen.CHUNK_SIZE) / worldgen.TILE_SIZE);
            var plty = Math.floor((playerPos.y - pcy * worldgen.CHUNK_SIZE) / worldgen.TILE_SIZE);
            pltx = Math.max(0, Math.min(worldgen.TILES_PER_CHUNK - 1, pltx));
            plty = Math.max(0, Math.min(worldgen.TILES_PER_CHUNK - 1, plty));
            var pfeat = pChunk.features[plty * worldgen.TILES_PER_CHUNK + pltx];
            if (pfeat === worldgen.FEATURE_RIVER || pfeat === worldgen.FEATURE_LAKE) {
              socket.emit('place_result', { success: false, message: 'You must be on land to place a bridge' });
              return;
            }
          }
        }
        // Extended placement range check for bridges
        if (playerPos) {
          var bridgeDistSq = distanceSq(playerPos.x, playerPos.y, px, py);
          if (bridgeDistSq > BRIDGE_PLACEMENT_RANGE * BRIDGE_PLACEMENT_RANGE) {
            socket.emit('place_result', { success: false, message: 'Too far away to place bridge' });
            return;
          }
        }
        // Skip plot requirement — water is never inside plots
      } else if (zone.type === 'plot') {
        // Plot interior zone: only owner can build, skip plot-in-overworld checks
        if (zone.ownerKey !== key) {
          socket.emit('place_result', { success: false, message: 'Only the plot owner can build here' });
          return;
        }
        // Plot zone is the building area — no further plot checks needed
      } else if (zone.plots && zone.plots.length > 0) {
        // Check plot permissions (overworld: must place inside own plot)
        var plot = plotModule.findPlotAt(px, py, zone.plots);
        if (plot) {
          if (plot.ownerKey !== key) {
            socket.emit('place_result', { success: false, message: 'This area belongs to ' + (plot.ownerName || 'another player') });
            return;
          }
        } else if (zone.chunkCache) {
          // In overworld, must place inside a plot
          socket.emit('place_result', { success: false, message: 'Claim a plot first (press P)' });
          return;
        }
      } else if (zone.chunkCache) {
        socket.emit('place_result', { success: false, message: 'Claim a plot first (press P)' });
        return;
      }

      // Find the item in player's mmoInventory
      var inventory = accounts.getMMOInventory(key);
      if (!inventory || !inventory.items) {
        socket.emit('place_result', { success: false, message: 'Inventory not found' });
        return;
      }

      var item = null;
      for (var i = 0; i < inventory.items.length; i++) {
        if (inventory.items[i].id === data.itemId) {
          item = inventory.items[i];
          break;
        }
      }
      if (!item) {
        socket.emit('place_result', { success: false, message: 'Item not found in inventory' });
        return;
      }

      // Check item type is placeable
      if (PLACEABLE_TYPES.indexOf(item.type) === -1) {
        socket.emit('place_result', { success: false, message: 'This item cannot be placed' });
        return;
      }

      // Check collision with existing placed objects (per-type distances)
      var objects = ensurePlacedObjects(zone);
      var myDist = PLACEMENT_DISTANCES[item.type] !== undefined ? PLACEMENT_DISTANCES[item.type] : DEFAULT_PLACEMENT_DISTANCE;
      for (var j = 0; j < objects.length; j++) {
        var existDist = PLACEMENT_DISTANCES[objects[j].type] !== undefined ? PLACEMENT_DISTANCES[objects[j].type] : DEFAULT_PLACEMENT_DISTANCE;
        var minDist = Math.max(myDist, existDist);
        if (minDist > 0) {
          var ddx = px - objects[j].x, ddy = py - objects[j].y;
          if (ddx * ddx + ddy * ddy < minDist * minDist) {
            socket.emit('place_result', { success: false, message: 'Too close to another object' });
            return;
          }
        }
      }

      // Remove item from inventory
      var removed = accounts.removeMMOItem(key, data.itemId);
      if (!removed) {
        socket.emit('place_result', { success: false, message: 'Failed to remove item from inventory' });
        return;
      }

      // Parse rotation from request
      var rotation = 0;
      if (data.rotation !== undefined) {
        rotation = parseInt(data.rotation) || 0;
        if ([0, 90, 180, 270].indexOf(rotation) === -1) rotation = 0;
      }

      // Create placed object
      var objectId = generateObjectId();
      var placedObj = {
        id: objectId,
        type: item.type,
        x: px,
        y: py,
        ownerKey: key,
        lockId: null,
        contents: [],
        rotation: rotation,
        createdAt: Date.now(),
      };
      if (item.type === 'door') {
        placedObj.open = false;
      }

      objects.push(placedObj);
      savePlacements(zoneId, objects);

      // Broadcast to zone (strip sensitive fields)
      var broadcastData = {
        id: placedObj.id,
        type: placedObj.type,
        x: placedObj.x,
        y: placedObj.y,
        rotation: placedObj.rotation,
      };
      if (item.type === 'door') {
        broadcastData.open = placedObj.open;
      }
      io.to('zone:' + zoneId).emit('object_placed', broadcastData);

      // Respond to placer with updated inventory
      var updatedInventory = accounts.getMMOInventory(key);
      socket.emit('place_result', {
        success: true,
        objectId: objectId,
        inventory: updatedInventory,
      });
    } catch (err) {
      console.error('[place_object] Error:', err.message);
      socket.emit('place_result', { success: false, message: 'Internal error' });
    }
  });

  // -----------------------------------------------------------------------
  // remove_object
  // -----------------------------------------------------------------------
  socket.on('remove_object', function(data) {
    try {
      if (!data || typeof data.objectId !== 'string') return;

      var key = socketAccountMap.get(socket.id);
      if (!key) {
        socket.emit('remove_result', { success: false, message: 'No account linked' });
        return;
      }

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) {
        socket.emit('remove_result', { success: false, message: 'Not in a zone' });
        return;
      }

      var zone = state.zones.get(zoneId);
      if (!zone) {
        socket.emit('remove_result', { success: false, message: 'Zone not found' });
        return;
      }

      var objects = ensurePlacedObjects(zone);

      // Find the object
      var objIndex = -1;
      var obj = null;
      for (var i = 0; i < objects.length; i++) {
        if (objects[i].id === data.objectId) {
          objIndex = i;
          obj = objects[i];
          break;
        }
      }
      if (!obj) {
        socket.emit('remove_result', { success: false, message: 'Object not found' });
        return;
      }

      // Check ownership
      if (obj.ownerKey !== key) {
        // Allow plot owner to remove any object within their plot
        var plotCheck = zone.plots ? plotModule.findPlotAt(obj.x, obj.y, zone.plots) : null;
        if (!plotCheck || plotCheck.ownerKey !== key) {
          socket.emit('remove_result', { success: false, message: 'You do not own this object' });
          return;
        }
      }

      // Check proximity
      var pos = state.playerPositions.get(socket.id);
      if (!pos) {
        socket.emit('remove_result', { success: false, message: 'Position unknown' });
        return;
      }
      var rangeSq = INTERACT_RANGE * INTERACT_RANGE;
      if (distanceSq(pos.x, pos.y, obj.x, obj.y) > rangeSq) {
        socket.emit('remove_result', { success: false, message: 'Too far away' });
        return;
      }

      // Remove from zone
      objects.splice(objIndex, 1);
      savePlacements(zoneId, objects);

      // Add base item back to player inventory
      var returnItem = {
        id: generateObjectId(),
        type: obj.type,
        name: obj.type,
        createdAt: Date.now(),
        source: 'removed_placement',
      };
      var addResult = accounts.addMMOItem(key, returnItem);
      if (addResult && addResult.error) {
        // Inventory full -- re-add the object to the zone so nothing is lost
        objects.push(obj);
        savePlacements(zoneId, objects);
        socket.emit('remove_result', { success: false, message: addResult.error });
        return;
      }

      // If chest had contents, return them to player
      if (obj.contents && obj.contents.length > 0) {
        for (var c = 0; c < obj.contents.length; c++) {
          var chestItem = obj.contents[c];
          var cResult = accounts.addMMOItem(key, chestItem);
          if (cResult && cResult.error) {
            // Inventory full mid-transfer: drop remaining items on the ground
            // (they stay in-memory only; the chest is already removed)
            console.error('[placement] Inventory full returning chest item, ' + (obj.contents.length - c) + ' items lost');
            break;
          }
        }
      }

      // Broadcast removal to zone
      io.to('zone:' + zoneId).emit('object_removed', {
        objectId: data.objectId,
        removedBy: socket.id,
      });

      // Respond with updated inventory
      var updatedInventory = accounts.getMMOInventory(key);
      socket.emit('remove_result', {
        success: true,
        inventory: updatedInventory,
      });
    } catch (err) {
      console.error('[remove_object] Error:', err.message);
      socket.emit('remove_result', { success: false, message: 'Internal error' });
    }
  });

  // -----------------------------------------------------------------------
  // interact_object
  // -----------------------------------------------------------------------
  socket.on('interact_object', function(data) {
    try {
      if (!data || typeof data.objectId !== 'string' || typeof data.action !== 'string') return;

      var key = socketAccountMap.get(socket.id);
      if (!key) {
        socket.emit('interact_result', { success: false, action: data.action, message: 'No account linked' });
        return;
      }

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) {
        socket.emit('interact_result', { success: false, action: data.action, message: 'Not in a zone' });
        return;
      }

      var zone = state.zones.get(zoneId);
      if (!zone) {
        socket.emit('interact_result', { success: false, action: data.action, message: 'Zone not found' });
        return;
      }

      var objects = ensurePlacedObjects(zone);

      // Find the object
      var obj = null;
      for (var i = 0; i < objects.length; i++) {
        if (objects[i].id === data.objectId) {
          obj = objects[i];
          break;
        }
      }
      if (!obj) {
        socket.emit('interact_result', { success: false, action: data.action, message: 'Object not found' });
        return;
      }

      // Check proximity
      var pos = state.playerPositions.get(socket.id);
      if (!pos) {
        socket.emit('interact_result', { success: false, action: data.action, message: 'Position unknown' });
        return;
      }
      var rangeSq = INTERACT_RANGE * INTERACT_RANGE;
      if (distanceSq(pos.x, pos.y, obj.x, obj.y) > rangeSq) {
        socket.emit('interact_result', { success: false, action: data.action, message: 'Too far away' });
        return;
      }

      var isOwner = (obj.ownerKey === key);

      switch (data.action) {
        // -------------------------------------------------------------------
        // lock: Apply a lock item to a door or chest
        // -------------------------------------------------------------------
        case 'lock': {
          if (obj.type !== 'door' && obj.type !== 'storage_chest') {
            socket.emit('interact_result', { success: false, action: 'lock', message: 'This object cannot be locked' });
            return;
          }
          if (!isOwner) {
            socket.emit('interact_result', { success: false, action: 'lock', message: 'Only the owner can lock this' });
            return;
          }
          if (obj.lockId) {
            socket.emit('interact_result', { success: false, action: 'lock', message: 'Already locked' });
            return;
          }
          if (!data.data || typeof data.data.lockItemId !== 'string') {
            socket.emit('interact_result', { success: false, action: 'lock', message: 'No lock item specified' });
            return;
          }

          // Find lock item in inventory
          var inventory = accounts.getMMOInventory(key);
          if (!inventory || !inventory.items) {
            socket.emit('interact_result', { success: false, action: 'lock', message: 'Inventory not found' });
            return;
          }
          var lockItem = null;
          for (var li = 0; li < inventory.items.length; li++) {
            if (inventory.items[li].id === data.data.lockItemId) {
              lockItem = inventory.items[li];
              break;
            }
          }
          if (!lockItem) {
            socket.emit('interact_result', { success: false, action: 'lock', message: 'Lock item not found in inventory' });
            return;
          }

          // Remove lock item from inventory
          var lockRemoved = accounts.removeMMOItem(key, data.data.lockItemId);
          if (!lockRemoved) {
            socket.emit('interact_result', { success: false, action: 'lock', message: 'Failed to consume lock item' });
            return;
          }

          obj.lockId = data.data.lockItemId;
          savePlacements(zoneId, objects);

          socket.emit('interact_result', {
            success: true,
            action: 'lock',
            data: { objectId: obj.id, locked: true },
          });
          break;
        }

        // -------------------------------------------------------------------
        // unlock: Unlock a door or chest (owner always can; others need key)
        // -------------------------------------------------------------------
        case 'unlock': {
          if (!obj.lockId) {
            socket.emit('interact_result', { success: false, action: 'unlock', message: 'Not locked' });
            return;
          }
          if (obj.type !== 'door' && obj.type !== 'storage_chest') {
            socket.emit('interact_result', { success: false, action: 'unlock', message: 'This object cannot be unlocked' });
            return;
          }

          // Owner can always unlock
          if (isOwner) {
            obj.lockId = null;
            savePlacements(zoneId, objects);
            socket.emit('interact_result', {
              success: true,
              action: 'unlock',
              data: { objectId: obj.id, locked: false },
            });
            return;
          }

          // Non-owners need a matching key item in inventory
          var unlockInv = accounts.getMMOInventory(key);
          if (!unlockInv || !unlockInv.items) {
            socket.emit('interact_result', { success: false, action: 'unlock', message: 'No key found' });
            return;
          }
          var hasKey = false;
          for (var uk = 0; uk < unlockInv.items.length; uk++) {
            if (unlockInv.items[uk].type === 'key' && unlockInv.items[uk].lockRef === obj.lockId) {
              hasKey = true;
              break;
            }
          }
          if (!hasKey) {
            socket.emit('interact_result', { success: false, action: 'unlock', message: 'You do not have the right key' });
            return;
          }

          obj.lockId = null;
          savePlacements(zoneId, objects);
          socket.emit('interact_result', {
            success: true,
            action: 'unlock',
            data: { objectId: obj.id, locked: false },
          });
          break;
        }

        // -------------------------------------------------------------------
        // open_chest: View chest contents
        // -------------------------------------------------------------------
        case 'open_chest': {
          if (obj.type !== 'storage_chest') {
            socket.emit('interact_result', { success: false, action: 'open_chest', message: 'Not a chest' });
            return;
          }

          // Check lock
          if (obj.lockId && !isOwner) {
            // Non-owner needs matching key
            var openInv = accounts.getMMOInventory(key);
            var openHasKey = false;
            if (openInv && openInv.items) {
              for (var ok = 0; ok < openInv.items.length; ok++) {
                if (openInv.items[ok].type === 'key' && openInv.items[ok].lockRef === obj.lockId) {
                  openHasKey = true;
                  break;
                }
              }
            }
            if (!openHasKey) {
              socket.emit('interact_result', { success: false, action: 'open_chest', message: 'Chest is locked' });
              return;
            }
          }

          if (!obj.contents) obj.contents = [];

          socket.emit('interact_result', {
            success: true,
            action: 'open_chest',
            data: {
              objectId: obj.id,
              contents: obj.contents,
              maxSlots: MAX_CHEST_SLOTS,
              locked: !!obj.lockId,
              isOwner: isOwner,
            },
          });
          break;
        }

        // -------------------------------------------------------------------
        // deposit_chest: Add an item from player inventory to chest
        // -------------------------------------------------------------------
        case 'deposit_chest': {
          if (obj.type !== 'storage_chest') {
            socket.emit('interact_result', { success: false, action: 'deposit_chest', message: 'Not a chest' });
            return;
          }

          // Check lock for non-owners
          if (obj.lockId && !isOwner) {
            var depInv = accounts.getMMOInventory(key);
            var depHasKey = false;
            if (depInv && depInv.items) {
              for (var dk = 0; dk < depInv.items.length; dk++) {
                if (depInv.items[dk].type === 'key' && depInv.items[dk].lockRef === obj.lockId) {
                  depHasKey = true;
                  break;
                }
              }
            }
            if (!depHasKey) {
              socket.emit('interact_result', { success: false, action: 'deposit_chest', message: 'Chest is locked' });
              return;
            }
          }

          if (!data.data || typeof data.data.itemId !== 'string') {
            socket.emit('interact_result', { success: false, action: 'deposit_chest', message: 'No item specified' });
            return;
          }

          if (!obj.contents) obj.contents = [];
          if (obj.contents.length >= MAX_CHEST_SLOTS) {
            socket.emit('interact_result', { success: false, action: 'deposit_chest', message: 'Chest is full' });
            return;
          }

          // Remove item from player inventory
          var depRemoved = accounts.removeMMOItem(key, data.data.itemId);
          if (!depRemoved) {
            socket.emit('interact_result', { success: false, action: 'deposit_chest', message: 'Item not found in inventory' });
            return;
          }

          obj.contents.push(depRemoved);
          savePlacements(zoneId, objects);

          var depUpdatedInv = accounts.getMMOInventory(key);
          socket.emit('interact_result', {
            success: true,
            action: 'deposit_chest',
            data: {
              objectId: obj.id,
              contents: obj.contents,
              inventory: depUpdatedInv,
            },
          });
          break;
        }

        // -------------------------------------------------------------------
        // withdraw_chest: Remove an item from chest to player inventory
        // -------------------------------------------------------------------
        case 'withdraw_chest': {
          if (obj.type !== 'storage_chest') {
            socket.emit('interact_result', { success: false, action: 'withdraw_chest', message: 'Not a chest' });
            return;
          }

          // Check lock for non-owners
          if (obj.lockId && !isOwner) {
            var wdInv = accounts.getMMOInventory(key);
            var wdHasKey = false;
            if (wdInv && wdInv.items) {
              for (var wk = 0; wk < wdInv.items.length; wk++) {
                if (wdInv.items[wk].type === 'key' && wdInv.items[wk].lockRef === obj.lockId) {
                  wdHasKey = true;
                  break;
                }
              }
            }
            if (!wdHasKey) {
              socket.emit('interact_result', { success: false, action: 'withdraw_chest', message: 'Chest is locked' });
              return;
            }
          }

          if (!data.data || typeof data.data.itemIndex !== 'number') {
            socket.emit('interact_result', { success: false, action: 'withdraw_chest', message: 'No item index specified' });
            return;
          }

          if (!obj.contents) obj.contents = [];
          var wIdx = data.data.itemIndex;
          if (wIdx < 0 || wIdx >= obj.contents.length) {
            socket.emit('interact_result', { success: false, action: 'withdraw_chest', message: 'Invalid item index' });
            return;
          }

          var withdrawnItem = obj.contents[wIdx];

          // Add item to player inventory first (so we can roll back if full)
          var wdAddResult = accounts.addMMOItem(key, withdrawnItem);
          if (wdAddResult && wdAddResult.error) {
            socket.emit('interact_result', { success: false, action: 'withdraw_chest', message: wdAddResult.error });
            return;
          }

          // Remove from chest only after successful add
          obj.contents.splice(wIdx, 1);
          savePlacements(zoneId, objects);

          var wdUpdatedInv = accounts.getMMOInventory(key);
          socket.emit('interact_result', {
            success: true,
            action: 'withdraw_chest',
            data: {
              objectId: obj.id,
              contents: obj.contents,
              inventory: wdUpdatedInv,
            },
          });
          break;
        }

        // -------------------------------------------------------------------
        // toggle_door: Open or close a door
        // -------------------------------------------------------------------
        case 'toggle_door': {
          if (obj.type !== 'door') {
            socket.emit('interact_result', { success: false, action: 'toggle_door', message: 'Not a door' });
            return;
          }
          // Check ownership: owner of the object, or owner of the plot zone
          var canToggle = isOwner;
          if (!canToggle && zone.type === 'plot' && zone.ownerKey === key) {
            canToggle = true;
          }
          if (!canToggle && zone.plots) {
            var doorPlot = plotModule.findPlotAt(obj.x, obj.y, zone.plots);
            if (doorPlot && doorPlot.ownerKey === key) canToggle = true;
          }
          if (!canToggle) {
            socket.emit('interact_result', { success: false, action: 'toggle_door', message: 'You do not have permission' });
            return;
          }
          obj.open = !obj.open;
          savePlacements(zoneId, objects);
          io.to('zone:' + zoneId).emit('door_toggled', { objectId: obj.id, open: obj.open });
          socket.emit('interact_result', {
            success: true,
            action: 'toggle_door',
            data: { objectId: obj.id, open: obj.open },
          });
          break;
        }

        default:
          socket.emit('interact_result', { success: false, action: data.action, message: 'Unknown action' });
          break;
      }
    } catch (err) {
      console.error('[interact_object] Error:', err.message);
      socket.emit('interact_result', { success: false, action: (data && data.action) || 'unknown', message: 'Internal error' });
    }
  });

  // -----------------------------------------------------------------------
  // get_placed_objects: Return all placed objects in current zone
  // -----------------------------------------------------------------------
  socket.on('get_placed_objects', function() {
    try {

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) {
        socket.emit('placed_objects', { objects: [] });
        return;
      }

      var zone = state.zones.get(zoneId);
      if (!zone) {
        socket.emit('placed_objects', { objects: [] });
        return;
      }

      var objects = ensurePlacedObjects(zone);

      socket.emit('placed_objects', {
        zoneId: zoneId,
        objects: objects,
      });
    } catch (err) {
      console.error('[get_placed_objects] Error:', err.message);
      socket.emit('placed_objects', { objects: [] });
    }
  });
}

function getWallColliders(zone) {
  if (!zone || !zone.placedObjects) return [];
  var colliders = [];
  for (var i = 0; i < zone.placedObjects.length; i++) {
    var obj = zone.placedObjects[i];
    var isWall = obj.type === 'wall' || obj.type === 'stone_wall';
    var isFence = obj.type === 'fence' || obj.type === 'stone_fence' || obj.type === 'iron_fence';
    var isDoor = obj.type === 'door' && !obj.open;
    if (isWall || isDoor) {
      var rot = obj.rotation || 0;
      if (rot === 0 || rot === 180) {
        colliders.push({ x: obj.x - 16, y: obj.y - 4, w: 32, h: 8 });
      } else {
        colliders.push({ x: obj.x - 4, y: obj.y - 16, w: 8, h: 32 });
      }
    } else if (isFence) {
      var frot = obj.rotation || 0;
      if (frot === 0 || frot === 180) {
        colliders.push({ x: obj.x - 16, y: obj.y - 2, w: 32, h: 4 });
      } else {
        colliders.push({ x: obj.x - 2, y: obj.y - 16, w: 4, h: 32 });
      }
    }
  }
  return colliders;
}

// ---------------------------------------------------------------------------
// Enclosed zone detection via flood fill
// ---------------------------------------------------------------------------

var ca = require('../cellular-automata');

// Detect enclosed areas within a plot zone.
// Flood fills from zone edges; tiles NOT reached are "enclosed."
// Returns: { enclosedTiles: Set<'x,y'>, enclosedCount, totalTiles }
function detectEnclosedAreas(zone) {
  if (!zone || !zone.placedObjects) return { enclosedTiles: new Set(), enclosedCount: 0, totalTiles: 0 };

  var ZONE_PX = 4096;
  var TILE = 32;
  var gridW = Math.floor(ZONE_PX / TILE);
  var gridH = Math.floor(ZONE_PX / TILE);
  var totalTiles = gridW * gridH;

  // Build blocked set from walls/fences/doors
  var blocked = new Set();
  for (var i = 0; i < zone.placedObjects.length; i++) {
    var obj = zone.placedObjects[i];
    if (!obj) continue;
    var isBarrier = obj.type === 'wall' || obj.type === 'stone_wall' ||
                    obj.type === 'fence' || obj.type === 'stone_fence' ||
                    obj.type === 'iron_fence' || (obj.type === 'door' && !obj.open);
    if (isBarrier) {
      var tx = Math.floor(obj.x / TILE);
      var ty = Math.floor(obj.y / TILE);
      blocked.add(tx + ',' + ty);
    }
  }

  // Flood fill from all edge tiles
  var reachable = ca.floodFillTileGrid(
    null, gridW, gridH, 0, 0,
    function(x, y) { return !blocked.has(x + ',' + y); }
  );

  // Also flood from other edges in case top-left is blocked
  var edgeStarts = [[gridW - 1, 0], [0, gridH - 1], [gridW - 1, gridH - 1]];
  for (var ei = 0; ei < edgeStarts.length; ei++) {
    var es = edgeStarts[ei];
    if (!reachable.has(es[0] + ',' + es[1])) {
      var extra = ca.floodFillTileGrid(
        null, gridW, gridH, es[0], es[1],
        function(x, y) { return !blocked.has(x + ',' + y); }
      );
      extra.forEach(function(k) { reachable.add(k); });
    }
  }

  // Enclosed = all non-blocked tiles not reached by flood fill
  var enclosedTiles = new Set();
  for (var tx = 0; tx < gridW; tx++) {
    for (var ty = 0; ty < gridH; ty++) {
      var key = tx + ',' + ty;
      if (!blocked.has(key) && !reachable.has(key)) {
        enclosedTiles.add(key);
      }
    }
  }

  return {
    enclosedTiles: enclosedTiles,
    enclosedCount: enclosedTiles.size,
    totalTiles: totalTiles,
  };
}

// Get bonuses for enclosed areas (raid protection, crop growth, animal pen)
function getEnclosedBonuses(zone) {
  var result = detectEnclosedAreas(zone);
  var ratio = result.enclosedCount / Math.max(1, result.totalTiles);
  return {
    enclosedRatio: ratio,
    raidDamageReduction: Math.min(0.50, ratio * 2),   // up to 50% raid damage reduction
    cropGrowthBonus: Math.min(0.30, ratio * 1.5),      // up to 30% faster crop growth
    animalHappinessBonus: Math.min(0.20, ratio),        // up to 20% animal happiness
    enclosedCount: result.enclosedCount,
  };
}

module.exports = {
  init: init,
  savePlacements: savePlacements,
  loadPlacements: loadPlacements,
  getWallColliders: getWallColliders,
  detectEnclosedAreas: detectEnclosedAreas,
  getEnclosedBonuses: getEnclosedBonuses,
};
