// handlers/plot.js
// Plot claiming system — players can claim 512x512 (1 chunk) areas in the overworld, with 4096x4096 interiors.
// Handles: claim_plot, unclaim_plot, get_nearby_plots

var crypto = require('crypto');
var path = require('path');
var fs = require('fs');
var dataDir = require('../data-dir');
var knowledgeHandler = require('./knowledge');

var PLOT_SIZE = 512;    // 1 chunk * 512px
var PLOT_GRID = 512;    // snap to 1-chunk grid
var PLOTS_DIR = dataDir.subdir('plots');

// Track pending unclaim confirmations: socketId -> { plotId, expiresAt }
var pendingUnclaims = new Map();

var UNCLAIM_CONFIRM_TIMEOUT = 30000; // 30 seconds

// Periodic cleanup of stale pendingUnclaims (every 5 minutes)
setInterval(function() {
  var now = Date.now();
  for (var entry of pendingUnclaims) {
    if (now > entry[1].expiresAt) pendingUnclaims.delete(entry[0]);
  }
}, 300000).unref();

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

var _pendingPlotSaves = new Map();  // zoneId -> timeout handle
var PLOT_SAVE_DEBOUNCE_MS = 1000;

// Directory ensured by data-dir.js subdir()

function savePlots(zoneId, plots) {
  // Debounce: schedule async write, coalescing rapid saves
  if (_pendingPlotSaves.has(zoneId)) {
    clearTimeout(_pendingPlotSaves.get(zoneId));
  }
  _pendingPlotSaves.set(zoneId, setTimeout(function() {
    _pendingPlotSaves.delete(zoneId);
    var fp = path.join(PLOTS_DIR, zoneId + '.json');
    var data = JSON.stringify(plots);
    fs.writeFile(fp, data, function(err) {
      if (err) console.error('[plot] Save failed:', err.message);
    });
  }, PLOT_SAVE_DEBOUNCE_MS));
}

function loadPlots(zoneId) {
  try {
    var fp = path.join(PLOTS_DIR, zoneId + '.json');
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, 'utf8'));
    }
  } catch (err) {
    console.error('[plot] Load failed:', err.message);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generatePlotId() {
  return 'p_' + crypto.randomBytes(8).toString('hex');
}

function snapToGrid(val) {
  return Math.floor(val / PLOT_GRID) * PLOT_GRID;
}

function isInPlot(px, py, plot) {
  return px >= plot.x && px < plot.x + plot.width &&
         py >= plot.y && py < plot.y + plot.height;
}

function findPlotAt(px, py, plots) {
  if (!plots) return null;
  for (var i = 0; i < plots.length; i++) {
    if (isInPlot(px, py, plots[i])) return plots[i];
  }
  return null;
}

function playerOwnsPlot(accountKey, plots) {
  if (!plots) return null;
  for (var i = 0; i < plots.length; i++) {
    if (plots[i].ownerKey === accountKey) return plots[i];
  }
  return null;
}

function plotExistsAt(x, y, plots) {
  if (!plots) return false;
  for (var i = 0; i < plots.length; i++) {
    if (plots[i].x === x && plots[i].y === y) return true;
  }
  return false;
}

// Find an unowned (abandoned) plot at a given grid position
function findUnownedPlotAt(x, y, plots) {
  if (!plots) return null;
  for (var i = 0; i < plots.length; i++) {
    if (plots[i].x === x && plots[i].y === y && plots[i].ownerKey === null) {
      return plots[i];
    }
  }
  return null;
}

// Find an owned plot at a given grid position
function findOwnedPlotAt(x, y, plots) {
  if (!plots) return null;
  for (var i = 0; i < plots.length; i++) {
    if (plots[i].x === x && plots[i].y === y && plots[i].ownerKey !== null) {
      return plots[i];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = {
  PLOT_SIZE: PLOT_SIZE,
  loadPlots: loadPlots,
  savePlots: savePlots,
  findPlotAt: findPlotAt,
  isInPlot: isInPlot,
  playerOwnsPlot: playerOwnsPlot,

  init(io, socket, deps) {
    var { user, state, socketAccountMap, accounts, checkEventRate } = deps;

    // Clean up pending unclaim on disconnect
    socket.on('disconnect', function() {
      pendingUnclaims.delete(socket.id);
    });

    // --- claim_plot: player claims a plot at their current position ---
    socket.on('claim_plot', function() {
      try {

        var zoneId = state.playerZones.get(socket.id);
        if (zoneId !== 'overworld') {
          socket.emit('claim_plot_result', { success: false, message: 'Plots can only be claimed in the overworld' });
          return;
        }

        var zone = state.zones.get(zoneId);
        if (!zone) return;

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        // Check if player already owns a plot
        if (!zone.plots) zone.plots = [];
        var existing = playerOwnsPlot(accKey, zone.plots);
        if (existing) {
          socket.emit('claim_plot_result', { success: false, message: 'You already own a plot' });
          return;
        }

        // Get player position
        var pos = state.playerPositions.get(socket.id);
        if (!pos) return;

        // Snap to grid
        var plotX = snapToGrid(pos.x);
        var plotY = snapToGrid(pos.y);

        // Check biome (no water)
        var worldgen = state.worldgen;
        if (worldgen) {
          var biome = worldgen.getBiomeAtPixel(plotX + PLOT_SIZE / 2, plotY + PLOT_SIZE / 2);
          var speed = worldgen.BIOME_SPEED[biome] || 0;
          if (speed <= 0) {
            socket.emit('claim_plot_result', { success: false, message: 'Cannot claim in water' });
            return;
          }
        }

        // Check protected area (any corner of the plot overlapping)
        if (worldgen) {
          var pArea = worldgen.getProtectedArea();
          var plotRight = plotX + PLOT_SIZE;
          var plotBottom = plotY + PLOT_SIZE;
          var overlaps = plotX < pArea.x + pArea.width && plotRight > pArea.x &&
                         plotY < pArea.y + pArea.height && plotBottom > pArea.y;
          if (overlaps) {
            socket.emit('claim_plot_result', { success: false, message: 'Cannot claim in protected area' });
            return;
          }
        }

        // Check for existing plot at this position
        var unownedPlot = findUnownedPlotAt(plotX, plotY, zone.plots);
        var ownedPlot = findOwnedPlotAt(plotX, plotY, zone.plots);

        if (ownedPlot) {
          // Another player owns a plot here
          socket.emit('claim_plot_result', { success: false, message: 'This area is already claimed' });
          return;
        }

        if (unownedPlot) {
          // Re-claim an abandoned plot
          unownedPlot.ownerKey = accKey;
          unownedPlot.ownerName = user.name;
          unownedPlot.claimedAt = Date.now();
          delete unownedPlot.unclaimedAt;

          savePlots(zoneId, zone.plots);

          // Update account
          accounts.setPlotId(accKey, unownedPlot.id);

          // Create plot interior zone
          state.getOrCreatePlotZone(unownedPlot.id, accKey, user.name);

          // Add overworld connection to the plot entrance
          var reclaimConn = {
            targetZone: 'plot_' + unownedPlot.id,
            x: unownedPlot.x + 256,
            y: unownedPlot.y + 256,
            direction: 'enter',
            isPlotEntrance: true,
            plotId: unownedPlot.id,
            ownerName: user.name,
          };
          zone.connections.push(reclaimConn);

          // Broadcast to zone
          io.to('zone:' + zoneId).emit('plot_claimed', unownedPlot);
          io.to('zone:' + zoneId).emit('connection_added', reclaimConn);

          // Confirm to player
          socket.emit('claim_plot_result', { success: true, plot: unownedPlot });

          // Fire glossary trigger for plot claim (re-claim path)
          try {
            var reclaimTerms = knowledgeHandler.fireGlossaryTrigger(accounts, accKey, 'plot_claim');
            for (var rti = 0; rti < reclaimTerms.length; rti++) {
              socket.emit('knowledge_term_unlocked', reclaimTerms[rti]);
            }
          } catch (e) { /* glossary trigger non-fatal */ }

          console.log('[plot] ' + user.name + ' re-claimed abandoned plot ' + unownedPlot.id + ' at ' + plotX + ',' + plotY);
          return;
        }

        // No plot exists here at all — create a new one

        // Mark resource nodes inside the plot area as non-respawning
        if (zone.resourceMap) {
          // Ensure chunks covering this area are generated
          var chunkSize = worldgen ? worldgen.CHUNK_SIZE : 512;
          var cx1 = Math.floor(plotX / chunkSize);
          var cy1 = Math.floor(plotY / chunkSize);
          var cx2 = Math.floor((plotX + PLOT_SIZE - 1) / chunkSize);
          var cy2 = Math.floor((plotY + PLOT_SIZE - 1) / chunkSize);
          for (var cy = cy1; cy <= cy2; cy++) {
            for (var cx = cx1; cx <= cx2; cx++) {
              state.getOrGenerateChunk(zoneId, cx, cy);
            }
          }

          for (var entry of zone.resourceMap) {
            var r = entry[1];
            if (r.x >= plotX && r.x < plotX + PLOT_SIZE &&
                r.y >= plotY && r.y < plotY + PLOT_SIZE) {
              r.noRespawn = true;
              r.plotOwned = true;
            }
          }
        }

        // Create plot
        var plot = {
          id: generatePlotId(),
          ownerKey: accKey,
          ownerName: user.name,
          x: plotX,
          y: plotY,
          width: PLOT_SIZE,
          height: PLOT_SIZE,
          accessMode: 'public',
          claimedAt: Date.now(),
        };

        zone.plots.push(plot);
        savePlots(zoneId, zone.plots);

        // Update account
        accounts.setPlotId(accKey, plot.id);

        // Create plot interior zone
        state.getOrCreatePlotZone(plot.id, accKey, user.name);

        // Add overworld connection to the plot entrance
        var plotConn = {
          targetZone: 'plot_' + plot.id,
          x: plot.x + 256,
          y: plot.y + 256,
          direction: 'enter',
          isPlotEntrance: true,
          plotId: plot.id,
          ownerName: user.name,
        };
        zone.connections.push(plotConn);

        // Broadcast to zone
        io.to('zone:' + zoneId).emit('plot_claimed', plot);
        io.to('zone:' + zoneId).emit('connection_added', plotConn);

        // Confirm to player
        socket.emit('claim_plot_result', { success: true, plot: plot });

        // Fire glossary trigger for plot claim
        try {
          var plotTerms = knowledgeHandler.fireGlossaryTrigger(accounts, accKey, 'plot_claim');
          for (var pti = 0; pti < plotTerms.length; pti++) {
            socket.emit('knowledge_term_unlocked', plotTerms[pti]);
          }
        } catch (e) { /* glossary trigger non-fatal */ }

        console.log('[plot] ' + user.name + ' claimed plot at ' + plotX + ',' + plotY);

      } catch (err) {
        console.error('[claim_plot] Error:', err.message);
        socket.emit('claim_plot_result', { success: false, message: 'Internal error' });
      }
    });

    // --- unclaim_plot: player abandons their plot (two-step confirmation) ---
    socket.on('unclaim_plot', function(data) {
      try {

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        // Always look up plots in the overworld zone (plots live there)
        var zone = state.zones.get('overworld');
        if (!zone || !zone.plots) return;
        var zoneId = 'overworld';

        var plot = playerOwnsPlot(accKey, zone.plots);
        if (!plot) {
          socket.emit('unclaim_plot_result', { success: false, message: 'You do not own a plot' });
          return;
        }

        var confirmed = data && data.confirmed === true;

        if (!confirmed) {
          // Step 1: Store pending confirmation and ask the player to confirm
          pendingUnclaims.set(socket.id, {
            plotId: plot.id,
            expiresAt: Date.now() + UNCLAIM_CONFIRM_TIMEOUT,
          });
          socket.emit('unclaim_plot_confirm', {
            message: 'Are you sure you want to unclaim your plot? All placed objects will be returned to your inventory. The plot will remain claimable by other players.',
            plotId: plot.id,
          });
          return;
        }

        // Step 2: Player confirmed — validate the pending confirmation
        var pending = pendingUnclaims.get(socket.id);
        if (!pending) {
          socket.emit('unclaim_plot_result', { success: false, message: 'Confirmation expired, try again' });
          return;
        }

        if (Date.now() > pending.expiresAt) {
          pendingUnclaims.delete(socket.id);
          socket.emit('unclaim_plot_result', { success: false, message: 'Confirmation expired, try again' });
          return;
        }

        if (pending.plotId !== plot.id) {
          // Plot changed between confirmation steps — shouldn't normally happen, but be safe
          pendingUnclaims.delete(socket.id);
          socket.emit('unclaim_plot_result', { success: false, message: 'Confirmation expired, try again' });
          return;
        }

        // Clean up pending confirmation
        pendingUnclaims.delete(socket.id);

        // Return any placed objects inside the plot to player inventory (overworld)
        var itemsDropped = 0;
        if (zone.placedObjects) {
          var toRemove = [];
          for (var i = 0; i < zone.placedObjects.length; i++) {
            var obj = zone.placedObjects[i];
            if (isInPlot(obj.x, obj.y, plot)) {
              toRemove.push(i);
              // Return item to player inventory (check for full)
              var returnItem = {
                id: obj.id,
                type: obj.type,
                name: obj.type.replace(/_/g, ' ').replace(/\b\w/g, function(l) { return l.toUpperCase(); }),
                source: 'unclaimed_plot',
              };
              var addResult = accounts.addMMOItem(accKey, returnItem);
              if (addResult && addResult.error) {
                // Inventory full — refund as base resources instead
                accounts.addResource(accKey, 'wood', 5);
                itemsDropped++;
              }
            }
          }
          // Remove in reverse order to preserve indices
          for (var j = toRemove.length - 1; j >= 0; j--) {
            zone.placedObjects.splice(toRemove[j], 1);
          }
        }

        // Clean up plot interior zone
        var plotZoneId = 'plot_' + plot.id;
        var plotZone = state.zones.get(plotZoneId);
        if (plotZone) {
          // Return placed objects from plot interior to owner inventory
          if (plotZone.placedObjects) {
            for (var pi = 0; pi < plotZone.placedObjects.length; pi++) {
              var pObj = plotZone.placedObjects[pi];
              var pReturnItem = {
                id: pObj.id,
                type: pObj.type,
                name: pObj.type.replace(/_/g, ' ').replace(/\b\w/g, function(l) { return l.toUpperCase(); }),
                source: 'unclaimed_plot',
              };
              var pAddResult = accounts.addMMOItem(accKey, pReturnItem);
              if (pAddResult && pAddResult.error) {
                accounts.addResource(accKey, 'wood', 5);
                itemsDropped++;
              }
            }
          }

          // Boot all players from plot zone back to overworld
          var memberIds = Array.from(plotZone.members);
          for (var mi = 0; mi < memberIds.length; mi++) {
            var memberId = memberIds[mi];
            state.leaveZone(memberId);
            var memberSocket = io.sockets.sockets.get(memberId);
            if (memberSocket) {
              memberSocket.leave('zone:' + plotZoneId);
              memberSocket.emit('zone_kicked', {
                reason: 'Plot has been unclaimed',
                returnZone: 'overworld',
                returnX: plot.x + 256,
                returnY: plot.y + 256,
              });
            }
          }

          // Delete the plot zone
          state.zones.delete(plotZoneId);

          // Delete plot interior placement file
          var placementPath = path.join(__dirname, '..', 'data', 'placements', plotZoneId + '.json');
          try { fs.unlinkSync(placementPath); } catch (e) { /* ignore */ }
        }

        // Remove overworld connection for this plot
        for (var ci = zone.connections.length - 1; ci >= 0; ci--) {
          if (zone.connections[ci].plotId === plot.id) {
            zone.connections.splice(ci, 1);
            break;
          }
        }

        // Keep the plot in the world but remove ownership
        var plotId = plot.id;
        plot.ownerKey = null;
        plot.ownerName = null;
        plot.unclaimedAt = Date.now();

        savePlots(zoneId, zone.plots);

        // Update account
        accounts.setPlotId(accKey, null);

        // Broadcast to zone — include available flag so clients know the plot is claimable
        io.to('zone:' + zoneId).emit('plot_unclaimed', { plotId: plotId, available: true });
        io.to('zone:' + zoneId).emit('connection_removed', { plotId: plotId });

        // Confirm to player
        var updatedInv = accounts.getMMOInventory(accKey);
        var unclaimMsg = { success: true, inventory: updatedInv };
        if (itemsDropped > 0) {
          unclaimMsg.warning = itemsDropped + ' item(s) could not fit in inventory and were converted to resources';
        }
        socket.emit('unclaim_plot_result', unclaimMsg);

        console.log('[plot] ' + user.name + ' unclaimed plot ' + plotId);

      } catch (err) {
        console.error('[unclaim_plot] Error:', err.message);
        socket.emit('unclaim_plot_result', { success: false, message: 'Internal error' });
      }
    });

    // --- set_plot_access: change plot access mode (public/private/friends) ---
    socket.on('set_plot_access', function(data) {
      if (!data || !data.mode) return;
      if (['public', 'private', 'friends'].indexOf(data.mode) === -1) return;
      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      // Find the player's plot
      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;
      var zone = state.zones.get(zoneId);
      if (!zone || !zone.plots) return;
      var playerPlot = null;
      for (var i = 0; i < zone.plots.length; i++) {
        if (zone.plots[i].ownerKey === key) { playerPlot = zone.plots[i]; break; }
      }
      if (!playerPlot) return;
      playerPlot.accessMode = data.mode;
      // Also update the plot zone if it exists
      var plotZone = state.zones.get('plot_' + playerPlot.id);
      if (plotZone) plotZone.accessMode = data.mode;
      // Save
      savePlots(zoneId, zone.plots);
      socket.emit('plot_access_updated', { mode: data.mode });
    });
  },
};
