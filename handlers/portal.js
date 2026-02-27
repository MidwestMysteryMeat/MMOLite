// handlers/portal.js
// Portal travel system — anchor town teleportation and personal player portals.
// Handles: portal_list, portal_travel, portal_craft, portal_destroy

var rpgData = require('../rpg-data');
var prison = require('./prison');

// ---------------------------------------------------------------------------
// Anchor Town Portal Definitions
// ---------------------------------------------------------------------------
// Each anchor town has a permanent portal. Portal position is the center/spawn
// point of the town zone. Towns that don't have a zone yet will be filtered
// out at runtime so the client never sees an unreachable destination.

var ANCHOR_PORTALS = [
  { id: 'portal_starter_town', name: 'The Holy Dominion', zoneId: 'starter_town', x: 800, y: 600 },
  { id: 'portal_solara', name: 'Solara', zoneId: 'solara', x: 800, y: 600 },
  { id: 'portal_sylvaris', name: 'Sylvaris', zoneId: 'sylvaris', x: 800, y: 600 },
  { id: 'portal_ironhold', name: 'Ironhold', zoneId: 'ironhold', x: 800, y: 600 },
  { id: 'portal_kragmor', name: 'Kragmor', zoneId: 'kragmor', x: 800, y: 600 },
  { id: 'portal_bonetrap', name: 'Bonetrap', zoneId: 'bonetrap', x: 800, y: 600 },
  { id: 'portal_murkmire', name: 'Murkmire', zoneId: 'murkmire', x: 800, y: 600 },
  { id: 'portal_mechspire', name: 'Mechspire', zoneId: 'mechspire', x: 800, y: 600 },
  { id: 'portal_clockwork_harbor_town', name: 'Clockwork Harbor', zoneId: 'clockwork_harbor_town', x: 800, y: 600 },
  { id: 'portal_fortunes_rest', name: "Fortune's Rest", zoneId: 'fortunes_rest', x: 800, y: 600 },
];

// Build a fast lookup: portalId -> portal definition
var PORTAL_BY_ID = {};
for (var i = 0; i < ANCHOR_PORTALS.length; i++) {
  PORTAL_BY_ID[ANCHOR_PORTALS[i].id] = ANCHOR_PORTALS[i];
}

// Build a fast lookup: zoneId -> portal definition
var PORTAL_BY_ZONE = {};
for (var j = 0; j < ANCHOR_PORTALS.length; j++) {
  PORTAL_BY_ZONE[ANCHOR_PORTALS[j].zoneId] = ANCHOR_PORTALS[j];
}

// Set of all anchor town zone IDs for quick "is player in a town?" check
var ANCHOR_ZONE_IDS = {};
for (var k = 0; k < ANCHOR_PORTALS.length; k++) {
  ANCHOR_ZONE_IDS[ANCHOR_PORTALS[k].zoneId] = true;
}

// ---------------------------------------------------------------------------
// Personal Portal Crafting Requirements
// ---------------------------------------------------------------------------

var PORTAL_CRAFT_COST = {
  mana_crystal: 5,
  stone: 10,
  iron_bar: 5,
  gem_cut: 3,
};

var PORTAL_CRAFT_SKILL = { skill: 'crafting', level: 20 };

// Proximity threshold for personal portal usage (pixels)
var PERSONAL_PORTAL_RANGE = 256;

// Teleport cooldown (milliseconds)
var TELEPORT_COOLDOWN_MS = 30000;
var HOME_TELEPORT_COOLDOWN_MS = 120000; // 120s for home teleport

// Per-account teleport cooldown (survives reconnect)
var accountTeleportTimes = new Map();
var homeTelepCooldowns = new Map(); // accKey -> timestamp for home teleport
var _activeRaidAlerts = new Set();  // accKeys with active raid alerts (bypass cooldown)

// Clean up stale teleport cooldown entries every 60 seconds
var _portalCleanupTimer = setInterval(function() {
  var now = Date.now();
  for (var entry of accountTeleportTimes) {
    if (now - entry[1] > 120000) { // 2 minutes (well past any cooldown)
      accountTeleportTimes.delete(entry[0]);
    }
  }
}, 60000);
_portalCleanupTimer.unref();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns only those anchor portals whose zone actually exists in state.zones
 * at the time of the call. This prevents listing unreachable destinations.
 */
function getAvailableAnchorPortals(state) {
  var available = [];
  for (var i = 0; i < ANCHOR_PORTALS.length; i++) {
    var ap = ANCHOR_PORTALS[i];
    if (state.zones.has(ap.zoneId)) {
      available.push({
        id: ap.id,
        name: ap.name,
        type: 'anchor',
        zoneId: ap.zoneId,
      });
    }
  }
  return available;
}

/**
 * Check whether the player is within range of their personal portal.
 * Returns true if within PERSONAL_PORTAL_RANGE pixels.
 */
function isNearPersonalPortal(pos, portal) {
  if (!pos || !portal) return false;
  var dx = pos.x - portal.x;
  var dy = pos.y - portal.y;
  return (dx * dx + dy * dy) <= (PERSONAL_PORTAL_RANGE * PERSONAL_PORTAL_RANGE);
}

/**
 * Check whether the player is in a zone that has an anchor portal
 * (i.e. an anchor town zone).
 */
function isInAnchorTown(zoneId) {
  return !!ANCHOR_ZONE_IDS[zoneId];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = {
  ANCHOR_PORTALS: ANCHOR_PORTALS,
  PORTAL_CRAFT_COST: PORTAL_CRAFT_COST,
  _activeRaidAlerts: _activeRaidAlerts, // exposed for raid system

  init(io, socket, deps) {
    var { user, state, socketAccountMap, accounts, checkEventRate } = deps;

    // ------------------------------------------------------------------
    // portal_list: get available portal destinations
    // ------------------------------------------------------------------
    socket.on('portal_list', function() {
      try {

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) {
          socket.emit('portal_error', { message: 'No account linked' });
          return;
        }

        // Build destination list from anchor portals that have existing zones
        var destinations = getAvailableAnchorPortals(state);

        // If player has a personal portal, include it
        var acc = accounts.loadAccount(accKey);
        if (acc && acc.personalPortal) {
          destinations.push({
            id: 'portal_personal',
            name: 'Personal Portal',
            type: 'personal',
            zoneId: acc.personalPortal.zoneId,
          });
        }

        socket.emit('portal_list', { destinations: destinations });
      } catch (err) {
        console.error('[portal_list] Error:', err.message);
        socket.emit('portal_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // portal_travel: teleport to a destination
    // ------------------------------------------------------------------
    socket.on('portal_travel', function(data) {
      try {

        if (!data || typeof data.destinationId !== 'string') {
          socket.emit('portal_error', { message: 'Invalid request' });
          return;
        }

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) {
          socket.emit('portal_error', { message: 'No account linked' });
          return;
        }

        // Prison check: jailed players cannot use portals
        var portalAcc = accounts.loadAccount(accKey);
        if (portalAcc && prison.isJailed(portalAcc)) {
          socket.emit('portal_error', { message: 'You are in jail. Cannot use portals.' });
          return;
        }

        // Check teleport cooldown (per-account, survives reconnect)
        var now = Date.now();
        var lastTeleportTime = accountTeleportTimes.get(accKey) || 0;
        if (now - lastTeleportTime < TELEPORT_COOLDOWN_MS) {
          var remaining = Math.ceil((TELEPORT_COOLDOWN_MS - (now - lastTeleportTime)) / 1000);
          socket.emit('portal_error', { message: 'Portal on cooldown (' + remaining + 's remaining)' });
          return;
        }

        // Validate the player's current location — must be in an anchor town
        // OR near their personal portal in the overworld
        var currentZoneId = state.playerZones.get(socket.id);
        if (!currentZoneId) {
          socket.emit('portal_error', { message: 'You are not in any zone' });
          return;
        }

        var playerPos = state.playerPositions.get(socket.id);
        if (!playerPos) {
          socket.emit('portal_error', { message: 'Position unknown' });
          return;
        }

        var acc = accounts.loadAccount(accKey);
        if (!acc) {
          socket.emit('portal_error', { message: 'Account not found' });
          return;
        }

        var canUsePortal = false;

        // Check 1: Player is in an anchor town zone
        if (isInAnchorTown(currentZoneId)) {
          canUsePortal = true;
        }

        // Check 2: Player is near their own personal portal
        if (!canUsePortal && acc.personalPortal &&
            currentZoneId === acc.personalPortal.zoneId &&
            isNearPersonalPortal(playerPos, acc.personalPortal)) {
          canUsePortal = true;
        }

        if (!canUsePortal) {
          socket.emit('portal_error', { message: 'You must be in a town or near your personal portal to teleport' });
          return;
        }

        // Resolve destination
        var destId = data.destinationId;
        var destZoneId = null;
        var destX = 0;
        var destY = 0;
        var destName = '';

        if (destId === 'portal_personal') {
          // Traveling to personal portal
          if (!acc.personalPortal) {
            socket.emit('portal_error', { message: 'You do not have a personal portal' });
            return;
          }
          destZoneId = acc.personalPortal.zoneId;
          destX = acc.personalPortal.x;
          destY = acc.personalPortal.y;
          destName = 'Personal Portal';
        } else {
          // Traveling to an anchor town portal
          var anchorPortal = PORTAL_BY_ID[destId];
          if (!anchorPortal) {
            socket.emit('portal_error', { message: 'Unknown destination' });
            return;
          }
          destZoneId = anchorPortal.zoneId;
          destX = anchorPortal.x;
          destY = anchorPortal.y;
          destName = anchorPortal.name;
        }

        // Verify destination zone exists
        if (!state.zones.has(destZoneId)) {
          socket.emit('portal_error', { message: 'Destination zone is not available yet' });
          return;
        }

        // Prevent teleporting to the zone you are already in
        if (destZoneId === currentZoneId) {
          socket.emit('portal_error', { message: 'You are already in this zone' });
          return;
        }

        // --- Execute teleport ---

        // 1. Leave current zone (socket room + state)
        socket.leave('zone:' + currentZoneId);
        state.leaveZone(socket.id);

        // 2. Broadcast departure to old zone
        io.to('zone:' + currentZoneId).emit('player_left_zone', {
          playerId: socket.id,
          playerName: user.name,
          zoneId: currentZoneId,
        });

        // 3. Join destination zone
        var joinResult = state.joinZone(socket.id, destZoneId, destX, destY);
        if (!joinResult) {
          // Zone is full or join failed — put player back in current zone
          // Try to recover by re-joining the old zone at the old position
          state.joinZone(socket.id, currentZoneId, playerPos.x, playerPos.y);
          socket.join('zone:' + currentZoneId);
          socket.emit('portal_error', { message: 'Destination zone is full' });
          return;
        }

        // 4. Join new socket room
        socket.join('zone:' + destZoneId);

        // 5. Save last location to account
        accounts.setLastLocation(accKey, destZoneId, destX, destY);

        // 6. Send full zone state to the player
        socket.emit('zone_state', state.getZoneState(destZoneId));

        // 7. Broadcast arrival to new zone
        var newPos = state.playerPositions.get(socket.id);
        socket.to('zone:' + destZoneId).emit('player_entered_zone', {
          id: socket.id,
          name: user.name,
          color: user.color,
          tag: user.tag,
          avatar: user.avatar || null,
          x: newPos ? newPos.x : destX,
          y: newPos ? newPos.y : destY,
          facing: newPos ? newPos.facing : 'down',
          zoneId: destZoneId,
        });

        // 8. Emit portal_traveled confirmation to player
        socket.emit('portal_traveled', {
          destinationId: destId,
          destinationName: destName,
          zoneId: destZoneId,
          x: destX,
          y: destY,
        });

        // 9. Set cooldown (per-account)
        accountTeleportTimes.set(accKey, Date.now());

        console.log('[portal] ' + user.name + ' teleported from ' + currentZoneId + ' to ' + destZoneId);

      } catch (err) {
        console.error('[portal_travel] Error:', err.message);
        socket.emit('portal_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // home_teleport: teleport to own plot from anywhere
    // ------------------------------------------------------------------
    socket.on('home_teleport', function() {
      try {
        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) {
          socket.emit('portal_error', { message: 'No account linked' });
          return;
        }

        var acc = accounts.loadAccount(accKey);
        if (!acc || !acc.plotId) {
          socket.emit('portal_error', { message: 'You do not own a plot' });
          return;
        }

        // Check cooldown (bypassed during raid alert)
        var now = Date.now();
        var hasRaidAlert = _activeRaidAlerts.has(accKey);
        if (!hasRaidAlert) {
          var lastHomeTP = homeTelepCooldowns.get(accKey) || 0;
          if (now - lastHomeTP < HOME_TELEPORT_COOLDOWN_MS) {
            var remaining = Math.ceil((HOME_TELEPORT_COOLDOWN_MS - (now - lastHomeTP)) / 1000);
            socket.emit('portal_error', { message: 'Home teleport on cooldown (' + remaining + 's remaining)' });
            return;
          }
        }

        // Find the plot zone
        var plotZoneId = 'plot_' + accKey;
        if (!state.zones.has(plotZoneId)) {
          socket.emit('portal_error', { message: 'Your plot zone is not loaded' });
          return;
        }

        var currentZoneId = state.playerZones.get(socket.id);
        if (currentZoneId === plotZoneId) {
          socket.emit('portal_error', { message: 'You are already at your plot' });
          return;
        }

        // Execute teleport
        if (currentZoneId) {
          socket.leave('zone:' + currentZoneId);
          state.leaveZone(socket.id);
          io.to('zone:' + currentZoneId).emit('player_left_zone', {
            playerId: socket.id,
            playerName: user.name,
            zoneId: currentZoneId,
          });
        }

        // Teleport to center of plot
        var destX = 2048;
        var destY = 2048;
        var joinResult = state.joinZone(socket.id, plotZoneId, destX, destY);
        if (!joinResult) {
          if (currentZoneId) {
            state.joinZone(socket.id, currentZoneId, 2048, 2048);
            socket.join('zone:' + currentZoneId);
          }
          socket.emit('portal_error', { message: 'Failed to teleport to plot' });
          return;
        }

        socket.join('zone:' + plotZoneId);
        accounts.setLastLocation(accKey, plotZoneId, destX, destY);
        socket.emit('zone_state', state.getZoneState(plotZoneId));

        var newPos = state.playerPositions.get(socket.id);
        socket.to('zone:' + plotZoneId).emit('player_entered_zone', {
          id: socket.id,
          name: user.name,
          color: user.color,
          tag: user.tag,
          avatar: user.avatar || null,
          x: newPos ? newPos.x : destX,
          y: newPos ? newPos.y : destY,
          facing: newPos ? newPos.facing : 'down',
          zoneId: plotZoneId,
        });

        socket.emit('portal_traveled', {
          destinationId: 'home',
          destinationName: 'Home Plot',
          zoneId: plotZoneId,
          x: destX,
          y: destY,
        });

        homeTelepCooldowns.set(accKey, Date.now());
        if (hasRaidAlert) _activeRaidAlerts.delete(accKey);

        console.log('[portal] ' + user.name + ' home teleported to plot ' + plotZoneId);
      } catch (err) {
        console.error('[home_teleport] Error:', err.message);
        socket.emit('portal_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // portal_craft: craft a personal portal on player's plot
    // ------------------------------------------------------------------
    socket.on('portal_craft', function() {
      try {

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) {
          socket.emit('portal_error', { message: 'No account linked' });
          return;
        }

        // Must be in the overworld
        var currentZoneId = state.playerZones.get(socket.id);
        if (currentZoneId !== 'overworld') {
          socket.emit('portal_error', { message: 'Personal portals can only be crafted in the overworld' });
          return;
        }

        var zone = state.zones.get(currentZoneId);
        if (!zone) {
          socket.emit('portal_error', { message: 'Zone not found' });
          return;
        }

        var playerPos = state.playerPositions.get(socket.id);
        if (!playerPos) {
          socket.emit('portal_error', { message: 'Position unknown' });
          return;
        }

        // Check player is standing on their own plot
        var plotModule = require('./plot');
        var plot = null;
        if (zone.plots) {
          plot = plotModule.findPlotAt(playerPos.x, playerPos.y, zone.plots);
        }

        if (!plot) {
          socket.emit('portal_error', { message: 'You must be standing on a claimed plot to craft a portal' });
          return;
        }

        if (plot.ownerKey !== accKey) {
          socket.emit('portal_error', { message: 'You can only craft a portal on your own plot' });
          return;
        }

        // Check player doesn't already have a personal portal
        var acc = accounts.loadAccount(accKey);
        if (!acc) {
          socket.emit('portal_error', { message: 'Account not found' });
          return;
        }

        if (acc.personalPortal) {
          socket.emit('portal_error', { message: 'You already have a personal portal' });
          return;
        }

        // Check crafting skill level
        var craftingSkill = accounts.getSkill(accKey, PORTAL_CRAFT_SKILL.skill);
        if (!craftingSkill || craftingSkill.level < PORTAL_CRAFT_SKILL.level) {
          socket.emit('portal_error', {
            message: 'Requires Crafting Lv.' + PORTAL_CRAFT_SKILL.level +
                     ' (current: Lv.' + (craftingSkill ? craftingSkill.level : 1) + ')',
          });
          return;
        }

        // Check resource sufficiency
        var mmoInv = accounts.getMMOInventory(accKey);
        if (!mmoInv) {
          socket.emit('portal_error', { message: 'Inventory not found' });
          return;
        }

        var costTypes = Object.keys(PORTAL_CRAFT_COST);
        for (var ci = 0; ci < costTypes.length; ci++) {
          var resType = costTypes[ci];
          var needed = PORTAL_CRAFT_COST[resType];
          var have = mmoInv[resType] || 0;
          if (have < needed) {
            socket.emit('portal_error', {
              message: 'Not enough ' + resType.replace(/_/g, ' ') +
                       ' (need ' + needed + ', have ' + have + ')',
            });
            return;
          }
        }

        // Deduct resources
        for (var di = 0; di < costTypes.length; di++) {
          var rt = costTypes[di];
          var amt = PORTAL_CRAFT_COST[rt];
          var result = accounts.removeResource(accKey, rt, amt);
          if (result === null) {
            socket.emit('portal_error', {
              message: 'Failed to deduct ' + rt.replace(/_/g, ' ') + ' -- not enough resources',
            });
            return;
          }
        }

        // Create the personal portal on the account
        acc.personalPortal = {
          x: Math.floor(playerPos.x),
          y: Math.floor(playerPos.y),
          zoneId: 'overworld',
          createdAt: Date.now(),
        };
        accounts.saveAccount(acc);

        // Send success response with updated inventory
        var updatedInv = accounts.getMMOInventory(accKey);

        socket.emit('portal_crafted', {
          success: true,
          personalPortal: acc.personalPortal,
          inventory: updatedInv,
        });

        console.log('[portal] ' + user.name + ' crafted a personal portal at ' +
                    acc.personalPortal.x + ',' + acc.personalPortal.y);

      } catch (err) {
        console.error('[portal_craft] Error:', err.message);
        socket.emit('portal_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // portal_destroy: destroy personal portal
    // ------------------------------------------------------------------
    socket.on('portal_destroy', function() {
      try {

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) {
          socket.emit('portal_error', { message: 'No account linked' });
          return;
        }

        var acc = accounts.loadAccount(accKey);
        if (!acc) {
          socket.emit('portal_error', { message: 'Account not found' });
          return;
        }

        if (!acc.personalPortal) {
          socket.emit('portal_error', { message: 'You do not have a personal portal' });
          return;
        }

        // Remove personal portal from account
        var oldPortal = acc.personalPortal;
        acc.personalPortal = null;
        accounts.saveAccount(acc);

        socket.emit('portal_destroyed', {
          success: true,
          message: 'Personal portal destroyed',
        });

        console.log('[portal] ' + user.name + ' destroyed their personal portal at ' +
                    oldPortal.x + ',' + oldPortal.y);

      } catch (err) {
        console.error('[portal_destroy] Error:', err.message);
        socket.emit('portal_error', { message: 'Internal server error' });
      }
    });
  },
};
