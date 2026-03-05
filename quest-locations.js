'use strict';

// quest-locations.js
// Manages a persistent pool of named world sites that procedural quests are
// assigned to. Sites are created lazily and reused across quests — the "Old
// Quarry" stays on the map and receives a new quest each day rather than
// disappearing when the prior quest is turned in.
//
// Pool:       locationId → site object (permanent until server restart)
// Assignments: questId   → locationId  (unlinked on quest completion)

var MIN_SEP  = 200;  // minimum px between any two sites in a zone
var EDGE_PAD = 160;  // keep away from zone edges

// ── Site name banks by quest type ────────────────────────────────────────────

var SITE_NAMES = {
  kill: [
    'Bandit Hollow', 'Ruined Watchtower', 'Corpse Road', 'Wraith Crossing',
    'The Blighted Glade', 'Hangman\'s Ridge', 'Dusk Camp', 'The Sunken Keep',
    'Gravewarden Post', 'Ashfield Ruins',
  ],
  gather: [
    'Old Quarry', 'Herb Grove', 'Crystal Vein', 'Mossglen', 'The Deep Cut',
    'Ironroot Basin', 'Saltweed Flats', 'Ember Hollow', 'Thornfield', 'The Shale Shelf',
  ],
  dungeon: [
    'Ancient Ruins', 'Rift Scar', 'Sunken Vault', 'The Hollow Descent',
    'Forgotten Crypt', 'Cracked Archway', 'Void Threshold', 'The Sealed Well',
  ],
  fetch: [
    'Abandoned Waystation', 'Collapsed Bridge', 'Overgrown Cache', 'The Dead Post',
    'Drover\'s Rest', 'Forsaken Outpost', 'The Broken Mile', 'Mudflat Crossing',
  ],
};

function pickSiteName(type, seed) {
  var bank = SITE_NAMES[type] || SITE_NAMES.fetch;
  return bank[seed % bank.length];
}

// Asset hint per type (cosmetic, for future sprite rendering)
var ASSET_BY_TYPE = {
  kill:    'ruins',
  gather:  'mine',
  dungeon: 'ruins',
  fetch:   'camp',
};

// ── Persistent pool ──────────────────────────────────────────────────────────

// locationId → { id, zoneId, x, y, dungeonZoneId, type, siteName }
var _pool = new Map();

// questId → locationId
var _assignments = new Map();

// ── Overlap detection ────────────────────────────────────────────────────────

function collectOccupied(zone) {
  var pts = [];
  if (zone.connections) {
    zone.connections.forEach(function(c) { pts.push({ x: c.x, y: c.y }); });
  }
  if (zone.placedObjects) {
    zone.placedObjects.forEach(function(o) { pts.push({ x: o.x, y: o.y }); });
  }
  return pts;
}

function findSpawnPoint(zone) {
  var W = zone.width  || 1600;
  var H = zone.height || 1200;
  var occupied = collectOccupied(zone);

  for (var attempt = 0; attempt < 60; attempt++) {
    var x = EDGE_PAD + Math.floor(Math.random() * (W - EDGE_PAD * 2));
    var y = EDGE_PAD + Math.floor(Math.random() * (H - EDGE_PAD * 2));
    var clear = true;
    for (var i = 0; i < occupied.length; i++) {
      var dx = occupied[i].x - x;
      var dy = occupied[i].y - y;
      if (Math.sqrt(dx * dx + dy * dy) < MIN_SEP) { clear = false; break; }
    }
    if (clear) return { x: x, y: y };
  }
  return null;
}

// ── Find a reusable site ─────────────────────────────────────────────────────

function findExistingSite(type, zoneId) {
  var result = null;
  _pool.forEach(function(site) {
    if (!result && site.zoneId === zoneId && site.type === type) {
      result = site;
    }
  });
  return result;
}

// ── Create a new site ────────────────────────────────────────────────────────

function createSite(type, npcZoneId, state, io) {
  var zone = state.zones.get(npcZoneId);
  if (!zone) return null;

  var pt = findSpawnPoint(zone);
  if (!pt) return null;

  var ts          = Date.now();
  var locationId  = 'site_' + npcZoneId + '_' + ts;
  var dungeonZoneId = 'proc_dz_' + locationId;
  var siteName    = pickSiteName(type, _pool.size + ts % 97);
  var assetId     = ASSET_BY_TYPE[type] || 'ruins';

  // Stub dungeon zone — enterable, bare room
  state.zones.set(dungeonZoneId, {
    id:           dungeonZoneId,
    name:         siteName,
    type:         'dungeon_fixture',
    width:        800,
    height:       600,
    members:      new Set(),
    chatMessages: [],
    npcs:         [],
    items:        [],
    placedObjects:[],
    connections:  [{ targetZone: npcZoneId, x: pt.x, y: pt.y, direction: 'out', label: 'Exit' }],
    _proc:        true,
    assetId:      assetId,
  });

  // Add connection to host zone (persists in zone_state for new arrivals)
  if (!zone.connections) zone.connections = [];
  var conn = {
    targetZone: dungeonZoneId,
    x:          pt.x,
    y:          pt.y,
    direction:  'enter',
    label:      siteName,
    _proc:      true,
  };
  zone.connections.push(conn);

  var site = { id: locationId, zoneId: npcZoneId, x: pt.x, y: pt.y, dungeonZoneId: dungeonZoneId, type: type, siteName: siteName };
  _pool.set(locationId, site);

  // Broadcast to current zone occupants
  io.to('zone:' + npcZoneId).emit('zone_connection_added', { connection: conn, zoneId: npcZoneId });

  return site;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Assign a quest to a site — reuses an existing site of the matching type if
 * one exists in the zone, otherwise creates a new one.
 * Idempotent: safe to call multiple times for the same questId.
 * Returns the site record (with x/y for quest marker) or null if no space.
 */
function spawnQuestLocation(questId, template, npcZoneId, state, io) {
  // Already assigned?
  if (_assignments.has(questId)) {
    return _pool.get(_assignments.get(questId)) || null;
  }

  // Try to reuse an existing site of the same type in this zone
  var site = findExistingSite(template.type, npcZoneId);

  // If none exists, create one
  if (!site) {
    site = createSite(template.type, npcZoneId, state, io);
  }
  if (!site) return null;

  _assignments.set(questId, site.id);

  // Emit quest marker pointing to the site (each quest gets its own marker)
  io.to('zone:' + npcZoneId).emit('quest_marker_added', {
    marker: {
      questId:  questId,
      label:    template.name,
      siteName: site.siteName,
      x:        site.x,
      y:        site.y,
      tier:     1,
      type:     template.type,
    },
    zoneId: npcZoneId,
  });

  return site;
}

/**
 * Unlink a quest from its site when the quest is completed.
 * The site itself stays on the map — it can receive new quests.
 */
function cleanupQuestAssignment(questId, state, io) {
  _assignments.delete(questId);
  // Site remains in _pool and in zone.connections for future quests.
}

function getLocationForQuest(questId) {
  var locId = _assignments.get(questId);
  return locId ? (_pool.get(locId) || null) : null;
}

/**
 * Returns all sites currently in the pool (for debug / admin tooling).
 */
function getSitePool() {
  var out = [];
  _pool.forEach(function(s) { out.push(s); });
  return out;
}

module.exports = { spawnQuestLocation, cleanupQuestAssignment, getLocationForQuest, getSitePool };
