// handlers/zone.js
// Zone entry, movement, zone chat — the core MMO navigation handler.

var rpgData = require('../rpg-data');
var dungeonCombat = require('../dungeon-combat');
var placementModule = require('./placement');
var challengesHandler = require('./challenges');
var knowledgeHandler = require('./knowledge');
var overworldStructures = require('../overworld-structures');
var overworldRifts = require('../overworld-rifts');
var petsHandler = require('./pets');
var moderation = require('./mmo-moderation');
var masteryCore = require('../mastery/mastery-core');

// Module-level move batching — shared across all socket connections
var _moveBatch = new Map();
var _moveBatchStarted = false;
var _moveBatchIO = null;
var _moveBatchState = null;

// Module-level spatial grid — shared across all sockets for cross-player proximity lookups
var _spatialGrids = new Map();    // zoneId -> Map<'cx,cy', Set<socketId>>
var _playerChunkMap = new Map();  // socketId -> 'cx,cy' key (for cleanup)
var _playerZoneMap = new Map();   // socketId -> zoneId (for cleanup)
var _GRID_CELL_SIZE = 512;       // one cell per chunk (set from CHUNK_SIZE in init)
var _SPATIAL_BROADCAST_RADIUS = 3; // broadcast moves to players within 3 chunks

// Module-level spatial lookup (used by batch ticker outside init closure)
function _gridGetNearby(zoneId, x, y, radiusChunks) {
  var grid = _spatialGrids.get(zoneId);
  if (!grid) return [];
  var cx = Math.floor(x / _GRID_CELL_SIZE);
  var cy = Math.floor(y / _GRID_CELL_SIZE);
  var result = [];
  for (var dy = -radiusChunks; dy <= radiusChunks; dy++) {
    for (var dx = -radiusChunks; dx <= radiusChunks; dx++) {
      var cell = grid.get((cx + dx) + ',' + (cy + dy));
      if (cell) {
        for (var sid of cell) result.push(sid);
      }
    }
  }
  return result;
}

function _startMoveBatchTicker(io, state) {
  if (_moveBatchStarted) return;
  _moveBatchStarted = true;
  _moveBatchIO = io;
  _moveBatchState = state;
  setInterval(function() {
    if (_moveBatch.size === 0) return;
    // Group moves by zone
    var zoneGroups = new Map();
    for (var entry of _moveBatch) {
      var sid = entry[0], move = entry[1];
      var zid = _moveBatchState.playerZones.get(sid);
      if (!zid) continue;
      if (!zoneGroups.has(zid)) zoneGroups.set(zid, []);
      zoneGroups.get(zid).push(move);
    }
    _moveBatch.clear();
    for (var zEntry of zoneGroups) {
      var zoneId = zEntry[0];
      var moves = zEntry[1];
      var zone = _moveBatchState.zones.get(zoneId);
      if (zone && zone.chunkCache) {
        // Overworld: spatially filtered — each player only gets nearby moves
        var perRecipient = new Map();
        for (var i = 0; i < moves.length; i++) {
          var m = moves[i];
          var nearby = _gridGetNearby(zoneId, m.x, m.y, _SPATIAL_BROADCAST_RADIUS);
          for (var r = 0; r < nearby.length; r++) {
            var rid = nearby[r];
            if (rid === m.id) continue;
            if (!perRecipient.has(rid)) perRecipient.set(rid, []);
            perRecipient.get(rid).push(m);
          }
        }
        for (var rEntry of perRecipient) {
          _moveBatchIO.to(rEntry[0]).emit('batch_move', { moves: rEntry[1] });
        }
      } else {
        // Small zones (towns, buildings): broadcast all moves to zone room
        _moveBatchIO.to('zone:' + zoneId).emit('batch_move', { moves: moves });
      }
    }
  }, 100);
}

module.exports = {
  init(io, socket, deps) {
    var { user, state, socketAccountMap, accounts, checkEventRate, applyRateGrace, filter } = deps;

    // Per-player harvest cooldowns: Map<socketId + ':' + resourceId, timestamp>
    var harvestCooldowns = new Map();
    var HARVEST_COOLDOWN_MS = 1500; // 1.5 seconds between harvests of same resource

    // Chunk tracking for overworld (lazy chunk generation)
    var CHUNK_SIZE = state.worldgen ? state.worldgen.CHUNK_SIZE : 512;
    var CHUNK_VIEW_RADIUS = 2; // Send chunks within 2 chunks of player
    var SPATIAL_BROADCAST_RADIUS = 3; // Only broadcast moves to players within 3 chunks (~15 km)
    var SPATIAL_RADIUS_PX = SPATIAL_BROADCAST_RADIUS * CHUNK_SIZE; // in pixels
    var CHAT_RADIUS_CHUNKS = 8;   // Normal chat visible within 8 chunks (~40 km)
    var CHAT_RADIUS_PX = CHAT_RADIUS_CHUNKS * CHUNK_SIZE;
    var SHOUT_RADIUS_CHUNKS = 20; // /shout visible within 20 chunks (~100 km)
    var SHOUT_RADIUS_PX = SHOUT_RADIUS_CHUNKS * CHUNK_SIZE;
    var playerChunks = new Map(); // socketId -> 'cx,cy'
    var clientChunks = new Map(); // socketId -> Set of 'cx,cy' (chunks already sent)
    var playerLastFacing = new Map(); // socketId -> last broadcast facing
    var playerLastMoveTime = new Map(); // socketId -> timestamp of last accepted move
    var playerSpeedViolations = new Map(); // socketId -> count
    var playerMountCache = new Map(); // socketId -> { mount, race, ts } (cached to avoid loadAccount every move)
    var MOVE_JITTER_SQ = 4; // ignore moves < 2px (reduces noise from floating point)
    var MAX_SPEED_PX_PER_S = 600; // max movement speed in pixels/sec (generous to allow mounts/races)
    var MAX_SPEED_VIOLATIONS = 10; // violations before kicking
    var MIN_MOVE_INTERVAL_MS = 16; // minimum time between move packets

    // Move batching for chunk-based zones — accumulate moves, flush every 100ms
    var FACING_TO_INT = { down: 0, up: 1, left: 2, right: 3 };
    _startMoveBatchTicker(io, state);

    // -----------------------------------------------------------------------
    // Spatial grid: module-level, keyed by zoneId for cross-player lookups
    // -----------------------------------------------------------------------
    _GRID_CELL_SIZE = CHUNK_SIZE;  // sync module-level constant with runtime value

    function _gridKey(x, y) {
      return Math.floor(x / _GRID_CELL_SIZE) + ',' + Math.floor(y / _GRID_CELL_SIZE);
    }

    function gridSet(zoneId, socketId, x, y) {
      if (!_spatialGrids.has(zoneId)) _spatialGrids.set(zoneId, new Map());
      var grid = _spatialGrids.get(zoneId);
      // Remove from old cell if exists
      var oldKey = _playerChunkMap.get(socketId);
      if (oldKey) {
        var oldCell = grid.get(oldKey);
        if (oldCell) {
          oldCell.delete(socketId);
          if (oldCell.size === 0) grid.delete(oldKey);
        }
      }
      var key = _gridKey(x, y);
      if (!grid.has(key)) grid.set(key, new Set());
      grid.get(key).add(socketId);
      _playerChunkMap.set(socketId, key);
      _playerZoneMap.set(socketId, zoneId);
    }

    function gridRemove(socketId) {
      var zoneId = _playerZoneMap.get(socketId);
      var key = _playerChunkMap.get(socketId);
      if (zoneId && key) {
        var grid = _spatialGrids.get(zoneId);
        if (grid) {
          var cell = grid.get(key);
          if (cell) {
            cell.delete(socketId);
            if (cell.size === 0) grid.delete(key);
          }
        }
      }
      _playerChunkMap.delete(socketId);
      _playerZoneMap.delete(socketId);
    }

    function gridMove(zoneId, socketId, oldX, oldY, newX, newY) {
      var oldKey = _gridKey(oldX, oldY);
      var newKey = _gridKey(newX, newY);
      if (oldKey !== newKey) {
        gridSet(zoneId, socketId, newX, newY);
      }
    }

    // Get all socketIds in cells within radiusChunks of (x, y) for a given zone
    function gridGetNearby(zoneId, x, y, radiusChunks) {
      var grid = _spatialGrids.get(zoneId);
      if (!grid) return [];
      var cx = Math.floor(x / _GRID_CELL_SIZE);
      var cy = Math.floor(y / _GRID_CELL_SIZE);
      var result = [];
      for (var dy = -radiusChunks; dy <= radiusChunks; dy++) {
        for (var dx = -radiusChunks; dx <= radiusChunks; dx++) {
          var cell = grid.get((cx + dx) + ',' + (cy + dy));
          if (cell) {
            for (var sid of cell) result.push(sid);
          }
        }
      }
      return result;
    }
    // -----------------------------------------------------------------------

    function getChunkCoords(x, y) {
      return {
        cx: Math.floor(x / CHUNK_SIZE),
        cy: Math.floor(y / CHUNK_SIZE),
      };
    }

    var MAX_KNOWN_CHUNKS = 200;
    var KNOWN_EVICT_RADIUS_SQ = 64; // evict chunks > 8 chunks away (8² = 64)

    function sendNearbyChunks(socket, zoneId, cx, cy) {
      var known = clientChunks.get(socket.id);
      if (!known) {
        known = new Set();
        clientChunks.set(socket.id, known);
      }

      // Evict server-known chunks far from current position (mirrors client LRU eviction)
      if (known.size > MAX_KNOWN_CHUNKS) {
        var toEvict = [];
        for (var kk of known) {
          var _p = kk.split(',');
          var edx = parseInt(_p[0]) - cx, edy = parseInt(_p[1]) - cy;
          if (edx * edx + edy * edy > KNOWN_EVICT_RADIUS_SQ) {
            toEvict.push(kk);
          }
        }
        for (var ei = 0; ei < toEvict.length; ei++) known.delete(toEvict[ei]);
      }

      // Phase 1: Inner ring (radius 1 = 3x3 = 9 chunks) — immediate
      var innerSent = [];
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var ck = (cx + dx) + ',' + (cy + dy);
          if (known.has(ck)) continue;
          var chunk = state.getOrGenerateChunk(zoneId, cx + dx, cy + dy);
          if (chunk) {
            innerSent.push(chunk);
            known.add(ck);
          }
        }
      }
      if (innerSent.length > 0) {
        var payload = { chunks: innerSent };
        // Append nearby overworld structures so client can render markers
        if (zoneId === 'overworld') {
          payload.structures = overworldStructures.getStructuresNearChunk(cx, cy, 5);
          payload.rifts = overworldRifts.getRiftsNearChunk(cx, cy, 8);
        }
        socket.emit('chunk_data', payload);
      }

      // Phase 2: Outer ring (radius 2, excluding already-sent inner) — deferred
      var outerCoords = [];
      for (var dy2 = -CHUNK_VIEW_RADIUS; dy2 <= CHUNK_VIEW_RADIUS; dy2++) {
        for (var dx2 = -CHUNK_VIEW_RADIUS; dx2 <= CHUNK_VIEW_RADIUS; dx2++) {
          if (Math.abs(dy2) <= 1 && Math.abs(dx2) <= 1) continue; // skip inner
          var ck2 = (cx + dx2) + ',' + (cy + dy2);
          if (!known.has(ck2)) outerCoords.push({ dx: dx2, dy: dy2, key: ck2 });
        }
      }

      if (outerCoords.length > 0) {
        // Use setImmediate to yield event loop between batches
        var batchSize = 4; // generate 4 chunks per tick
        var idx = 0;
        function processOuterBatch() {
          var zoneStillValid = state.zones.get(zoneId);
          if (!zoneStillValid) return;
          // Check socket still connected and in this zone
          if (!socket.connected) return;
          if (state.playerZones.get(socket.id) !== zoneId) return;

          var batch = [];
          var end = Math.min(idx + batchSize, outerCoords.length);
          for (var i = idx; i < end; i++) {
            var c = outerCoords[i];
            var freshKnown = clientChunks.get(socket.id);
            if (freshKnown && freshKnown.has(c.key)) continue;
            var chunk = state.getOrGenerateChunk(zoneId, cx + c.dx, cy + c.dy);
            if (chunk) {
              batch.push(chunk);
              if (freshKnown) freshKnown.add(c.key);
            }
          }
          if (batch.length > 0) {
            socket.emit('chunk_data', { chunks: batch });
          }
          idx = end;
          if (idx < outerCoords.length) {
            setImmediate(processOuterBatch);
          }
        }
        setImmediate(processOuterBatch);
      }
    }

    // --- zone_enter: player enters a zone ---
    socket.on('zone_enter', function(data) {
      if (!data || typeof data.zoneId !== 'string') return;

      // Block zone change while in turn-based combat
      if (dungeonCombat.getCombatBySocketId(socket.id)) {
        socket.emit('zone_error', { message: 'Cannot leave while in combat' });
        return;
      }

      // Jail check — jailed players can only enter their assigned jail zone
      var _accKeyJail = socketAccountMap.get(socket.id);
      if (_accKeyJail) {
        try {
          var _prison = require('../handlers/prison');
          var _jailAcc = accounts.loadAccount(_accKeyJail);
          if (_jailAcc && _prison.isJailed(_jailAcc)) {
            var _jailZone = _jailAcc.jailState && _jailAcc.jailState.jailZoneId;
            if (!_jailZone || data.zoneId !== _jailZone) {
              socket.emit('zone_error', { message: 'You are in jail and cannot leave.' });
              return;
            }
          }
        } catch (_pe) { /* prison handler optional */ }
      }

      var zoneId = data.zoneId;
      var zone = state.zones.get(zoneId);
      if (!zone) {
        // If dungeon floor zone no longer exists, redirect to starter_town
        if (zoneId.indexOf('_floor_') !== -1 || zoneId.indexOf('rift') === 0 || zoneId.indexOf('cave_') === 0) {
          zoneId = 'starter_town';
          zone = state.zones.get(zoneId);
          data.x = 800;
          data.y = 400;
          // Update saved location so this doesn't recur
          var accKey_fix = socketAccountMap.get(socket.id);
          if (accKey_fix) accounts.setLastLocation(accKey_fix, zoneId, 800, 400);
        } else if (zoneId.indexOf('plot_') === 0) {
          // If plot zone no longer exists, redirect to overworld
          zoneId = 'starter_town';
          zone = state.zones.get(zoneId);
          data.x = 800;
          data.y = 400;
        }
        if (!zone) {
          socket.emit('zone_error', { message: 'Zone not found' });
          return;
        }
      }

      // Permission gate for plot zones (access mode: public/private/friends)
      if (zone.type === 'plot') {
        var entrantKey = socketAccountMap.get(socket.id);
        var isPlotOwner = (zone.ownerKey === entrantKey);
        var plotAccessMode = zone.accessMode || 'public';
        if (!isPlotOwner && plotAccessMode === 'private') {
          socket.emit('zone_error', { message: 'This property is private' });
          return;
        }
      }

      // Leave previous zone socket room
      var prevZone = state.playerZones.get(socket.id);
      if (prevZone) {
        // Remove from spatial grid before leaving
        gridRemove(socket.id);

        socket.leave('zone:' + prevZone);
        io.to('zone:' + prevZone).emit('player_left_zone', {
          playerId: socket.id,
          playerName: user.name,
          zoneId: prevZone,
        });
      }

      // Determine spawn position (from connection or default)
      var spawnX = 0;
      var spawnY = 0;
      if (typeof data.x === 'number' && typeof data.y === 'number') {
        spawnX = data.x;
        spawnY = data.y;
      } else if (data.fromZone) {
        // Find the connection from the source zone to get entry point
        var conn = zone.connections.find(function(c) { return c.targetZone === data.fromZone; });
        if (conn) {
          spawnX = conn.x;
          spawnY = conn.y;
        }
      }

      // For overworld/chunk-based zones, validate spawn position
      if (zone.chunkCache && state.worldgen) {
        // Race is permanent after character creation — use cached value on user object
        var spawnRace = user.race || null;
        if ((spawnX === 0 && spawnY === 0) || !state.worldgen.isWalkable(spawnX, spawnY, spawnRace)) {
          var sp = state.worldgen.getSpawnPoint();
          spawnX = sp.x;
          spawnY = sp.y;
        }
      }

      var result = state.joinZone(socket.id, zoneId, spawnX, spawnY);
      if (!result) {
        socket.emit('zone_error', { message: 'Zone is full' });
        return;
      }

      // Save last location to account
      var accKey = socketAccountMap.get(socket.id);
      if (accKey) {
        accounts.setLastLocation(accKey, zoneId, spawnX, spawnY);
      }

      // Join socket room for zone broadcasts
      socket.join('zone:' + zoneId);

      // Send full zone state to joining player
      socket.emit('zone_state', state.getZoneState(zoneId));

      // Broadcast to others in zone
      var pos = state.playerPositions.get(socket.id);

      // For overworld zones, send initial nearby chunks + add to spatial grid
      var joinedZone = state.zones.get(zoneId);
      if (joinedZone && joinedZone.chunkCache) {
        var spawnChunk = getChunkCoords(spawnX, spawnY);
        playerChunks.set(socket.id, spawnChunk.cx + ',' + spawnChunk.cy);
        clientChunks.delete(socket.id); // clear chunk cache on zone entry
        sendNearbyChunks(socket, zoneId, spawnChunk.cx, spawnChunk.cy);
        gridSet(zoneId, socket.id, spawnX, spawnY);

        // Send lich corruption data for nearby chunks on zone entry
        if (deps.directorLich) {
          var entryCorruption = deps.directorLich.getCorruptionForArea(spawnChunk.cx, spawnChunk.cy, 5);
          if (Object.keys(entryCorruption).length > 0) {
            socket.emit('corruption_update', { chunks: entryCorruption });
          }
        }

        // Pre-warm radius 3 chunks in background for instant movement (offline mode only)
        if (process.env.OFFLINE_MODE === '1' && joinedZone.chunkCache) {
          setImmediate(function() {
            for (var pdy = -3; pdy <= 3; pdy++) {
              for (var pdx = -3; pdx <= 3; pdx++) {
                if (Math.abs(pdy) <= CHUNK_VIEW_RADIUS && Math.abs(pdx) <= CHUNK_VIEW_RADIUS) continue;
                state.getOrGenerateChunk(zoneId, spawnChunk.cx + pdx, spawnChunk.cy + pdy);
              }
            }
          });
        }
      }
      var _joinAcc = accounts.loadAccount(socketAccountMap.get(socket.id));
      socket.to('zone:' + zoneId).emit('player_entered_zone', {
        id: socket.id,
        name: user.name,
        username: user.username,
        color: user.color,
        tag: user.tag,
        avatar: user.avatar || null,
        x: pos ? pos.x : 0,
        y: pos ? pos.y : 0,
        facing: pos ? pos.facing : 'down',
        zoneId: zoneId,
        race: user.race || (_joinAcc && _joinAcc.race) || null,
        ascensionMark: _joinAcc ? !!_joinAcc.ascensionMark : false,
      });

      // --- Biome weather emit on zone_enter ---
      var _biome = (joinedZone && joinedZone.biome) || 'plains';
      var _biomeW = state.getBiomeWeather(_biome);
      var _wEffect = rpgData.getBiomeWeatherEffect(_biome, _biomeW);
      socket.emit('biome_weather', { biome: _biome, weather: _biomeW, effects: _wEffect });

      // --- Town rumors emit on zone_enter (for town zones) ---
      if (joinedZone && (joinedZone.type === 'town' || joinedZone.isTown)) {
        try {
          var rumorSystem = require('../rumor-system');
          var rumors = rumorSystem.getTownRumors(zoneId);
          if (rumors.length > 0) {
            socket.emit('town_rumors', { rumors: rumors });
          }
        } catch (_e) { /* rumor system not loaded yet */ }
      }

      // --- Town reputation + faction guard hostility on zone_enter ---
      if (accKey) {
        var _zoneAcc = accounts.loadAccount(accKey);
        if (_zoneAcc) {
          // Send town rep
          var _townRep = (_zoneAcc.townReputation && _zoneAcc.townReputation[zoneId]) || 0;
          var _townLabel = 'Neutral';
          if (_townRep >= 80) _townLabel = 'Beloved';
          else if (_townRep >= 50) _townLabel = 'Respected';
          else if (_townRep >= 20) _townLabel = 'Friendly';
          else if (_townRep >= -20) _townLabel = 'Neutral';
          else if (_townRep >= -50) _townLabel = 'Unfriendly';
          else if (_townRep >= -80) _townLabel = 'Hostile';
          else _townLabel = 'Banished';
          socket.emit('town_rep_update', { zoneId: zoneId, score: _townRep, label: _townLabel });

          // Faction guard hostility check
          try {
            var factionsHandler = require('./factions');
            var _factionId = factionsHandler.getFactionForZone(zoneId);
            if (_factionId && factionsHandler.isFactionHostile(_zoneAcc.factionRep, _factionId)) {
              socket.emit('guard_hostile', {
                zoneId: zoneId,
                faction: _factionId,
                message: 'The guards eye you with open hostility. Town services may be denied.',
              });
            }
          } catch (_e2) { /* factions handler not loaded yet */ }

          // Karma guard hostility check
          try {
            var karmaHandler = require('./karma');
            if (karmaHandler.isGuardHostile(_zoneAcc)) {
              socket.emit('guard_hostile', {
                zoneId: zoneId,
                reason: 'karma',
                message: 'Your dark reputation precedes you. The guards refuse to help.',
              });
            }
          } catch (_e3) { /* karma handler not loaded yet */ }
        }
      }
    });

    // --- zone_move: player position update ---
    socket.on('zone_move', function(data) {
      if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return;
      if (!isFinite(data.x) || !isFinite(data.y)) return;
      if (!applyRateGrace(socket, 'zone_move', 120, 1000)) return;

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;

      var facing = (typeof data.facing === 'string') ? data.facing : undefined;

      // Round to integers to reduce JSON size over the wire
      var rx = Math.round(data.x);
      var ry = Math.round(data.y);

      // --- Server-side speed validation ---
      var oldPos = state.playerPositions.get(socket.id);
      if (oldPos) {
        var now = Date.now();
        var lastMove = playerLastMoveTime.get(socket.id) || now;
        var elapsed = Math.max(MIN_MOVE_INTERVAL_MS, now - lastMove);
        var mdx = rx - oldPos.x;
        var mdy = ry - oldPos.y;
        var distSq = mdx * mdx + mdy * mdy;

        // Load account once for mount/pet/encumbrance checks (cached per 5s)
        var mountMult = 1.0;
        var petSpeedMult = 1.0;
        var _mc = playerMountCache.get(socket.id);
        if (!_mc || now - _mc.ts > 5000) {
          var _mcKey = socketAccountMap.get(socket.id);
          var _moveAcc = _mcKey ? accounts.loadAccount(_mcKey) : null;
          _mc = {
            mount: _moveAcc ? _moveAcc.mount : null,
            race: user.race || null,
            ts: now,
            _petChecked: false,
            _petSpeed: 1.0,
            _encLevel: _moveAcc ? accounts.getEncumbranceLevel(_moveAcc) : 'normal'
          };
          // Pet speed bonus
          if (_moveAcc && _moveAcc.activePet && _moveAcc.petData) {
            for (var _pi = 0; _pi < _moveAcc.petData.length; _pi++) {
              if (_moveAcc.petData[_pi].id === _moveAcc.activePet) {
                _mc._petSpeed = petsHandler.calculatePetSpeed(_moveAcc.petData[_pi]);
                break;
              }
            }
          }
          // Ascension speed bonus
          if (_moveAcc && _moveAcc.ascensionTree && _moveAcc.ascensionTree['seasoned_traveler']) {
            _mc._petSpeed *= (1 + _moveAcc.ascensionTree['seasoned_traveler'] * 0.03);
          }
          _mc._petChecked = true;
          playerMountCache.set(socket.id, _mc);
        }
        if (_mc.mount && state.worldgen && state.worldgen.MOUNT_SPEEDS) {
          mountMult = state.worldgen.MOUNT_SPEEDS[_mc.mount] || 1.0;
          // Apply Orc racial mount speed bonus
          if (_mc.race === 'orc' && mountMult > 1.0) {
            mountMult *= 1.10;
          }
        }
        petSpeedMult = _mc._petSpeed || 1.0;

        var maxDist = MAX_SPEED_PX_PER_S * mountMult * petSpeedMult * (elapsed / 1000);
        var maxDistSq = maxDist * maxDist;

        if (distSq > maxDistSq && distSq > 10000) {
          // Suspicious move: too fast. Clamp to max distance in the same direction
          var violations = (playerSpeedViolations.get(socket.id) || 0) + 1;
          playerSpeedViolations.set(socket.id, violations);
          if (violations >= MAX_SPEED_VIOLATIONS) {
            // Too many violations — snap back to last known position
            socket.emit('zone_move_corrected', { x: oldPos.x, y: oldPos.y });
            playerSpeedViolations.set(socket.id, 0);
            return;
          }
          // Clamp position to max travel distance
          var dist = Math.sqrt(distSq);
          var ratio = maxDist / dist;
          rx = Math.round(oldPos.x + mdx * ratio);
          ry = Math.round(oldPos.y + mdy * ratio);
        } else {
          // Valid move — reset violations
          if (playerSpeedViolations.has(socket.id)) playerSpeedViolations.set(socket.id, 0);
        }
        playerLastMoveTime.set(socket.id, now);
      } else {
        playerLastMoveTime.set(socket.id, Date.now());
      }

      // --- Encumbrance check (uses cached value from mount/pet load) ---
      var _mc2 = playerMountCache.get(socket.id);
      if (_mc2 && _mc2._encLevel === 'overloaded') {
        socket.emit('zone_error', { message: 'You are too encumbered to move.' });
        return;
      }

      // Jitter filter: check if position actually changed meaningfully
      var posChanged = true;
      if (oldPos) {
        var ddx = rx - oldPos.x;
        var ddy = ry - oldPos.y;
        if (ddx * ddx + ddy * ddy < MOVE_JITTER_SQ) {
          posChanged = false;
        }
      }

      var lastFacing = playerLastFacing.get(socket.id);
      var facingChanged = facing && facing !== lastFacing;
      if (facingChanged) playerLastFacing.set(socket.id, facing);

      // Skip state update, spatial grid, Redis publish, AND broadcast if nothing changed
      if (!posChanged && !facingChanged) return;

      // Wall collision for plot zones (push player out of wall/closed-door AABBs)
      var moveZoneCollision = state.zones.get(zoneId);
      if (moveZoneCollision && (moveZoneCollision.type === 'plot' || (moveZoneCollision.placedObjects && moveZoneCollision.placedObjects.length > 0))) {
        var colliders = placementModule.getWallColliders(moveZoneCollision);
        var playerRadius = 8;
        for (var ci = 0; ci < colliders.length; ci++) {
          var c = colliders[ci];
          // AABB vs circle collision
          var closestX = Math.max(c.x, Math.min(rx, c.x + c.w));
          var closestY = Math.max(c.y, Math.min(ry, c.y + c.h));
          var cdx = rx - closestX;
          var cdy = ry - closestY;
          if (cdx * cdx + cdy * cdy < playerRadius * playerRadius) {
            // Push player out
            var cdist = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
            rx = Math.round(closestX + (cdx / cdist) * playerRadius);
            ry = Math.round(closestY + (cdy / cdist) * playerRadius);
          }
        }
      }

      // Only update state+Redis when something actually changed
      state.updatePlayerPosition(socket.id, rx, ry, facing);

      // For overworld zones, check if player crossed a chunk boundary
      var moveZone = state.zones.get(zoneId);
      if (moveZone && moveZone.chunkCache) {
        var newChunk = getChunkCoords(rx, ry);
        var newKey = newChunk.cx + ',' + newChunk.cy;
        var oldKey = playerChunks.get(socket.id);
        if (oldKey !== newKey) {
          playerChunks.set(socket.id, newKey);
          sendNearbyChunks(socket, zoneId, newChunk.cx, newChunk.cy);

          // Leviathan proximity check on chunk crossing
          if (deps.directorOcean) {
            var accKey = socketAccountMap.get(socket.id);
            var acc = accKey ? accounts.loadAccount(accKey) : null;
            if (acc) {
              deps.directorOcean.checkProximity(socket, newChunk.cx, newChunk.cy, acc, io);
            }
          }

          // Lich corruption: send nearby corruption levels on chunk crossing
          if (deps.directorLich) {
            var corruptionData = deps.directorLich.getCorruptionForArea(newChunk.cx, newChunk.cy, 5);
            if (Object.keys(corruptionData).length > 0) {
              socket.emit('corruption_update', { chunks: corruptionData });
            }
          }

          // Track chunk exploration for daily challenges & achievements
          var exploreAccKey = socketAccountMap.get(socket.id);
          if (exploreAccKey) {
            challengesHandler.trackChallengeProgress(accounts, exploreAccKey, 'explore_chunk', 1);
            challengesHandler.trackAchievementProgress(accounts, exploreAccKey, 'explore_chunk', 1, socket);
          }
        }
        // Update spatial grid (module-level, keyed by zoneId)
        if (oldPos) {
          gridMove(zoneId, socket.id, oldPos.x, oldPos.y, rx, ry);
        } else {
          gridSet(zoneId, socket.id, rx, ry);
        }
      }

      // Build delta message: encode facing as integer (0-3) when changed
      var moveData = { id: socket.id, x: rx, y: ry };
      if (facingChanged) {
        moveData.f = FACING_TO_INT[facing] !== undefined ? FACING_TO_INT[facing] : facing;
      }

      // Spatial broadcast: use spatial grid for O(neighborhood) instead of O(n)
      var moveZoneRef = moveZone || state.zones.get(zoneId);
      if (moveZoneRef && moveZoneRef.chunkCache) {
        // Batch moves for chunk-based zones (flushed every 100ms)
        _moveBatch.set(socket.id, moveData);
      } else {
        // Small zones (towns, buildings): broadcast to all immediately
        socket.to('zone:' + zoneId).emit('player_moved', moveData);
      }
    });

    // --- zone_chat: proximity-based chat within a zone ---
    socket.on('zone_chat', function(data) {
      if (!applyRateGrace(socket, 'zone_chat', 20, 5000)) return;
      if (!data || typeof data.message !== 'string') return;

      // Server-side mute enforcement — client-side mute UI is not sufficient
      var chatKey = socketAccountMap.get(socket.id);
      if (chatKey && moderation.isMuted(chatKey)) {
        socket.emit('zone_message', { authorName: 'System', authorColor: '#FF4444', message: 'You are muted.' });
        return;
      }

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;

      var content = data.message.trim();
      if (content.length === 0 || content.length > 200) return;

      // Detect /shout prefix
      var chatType = 'local';
      var radiusPx = CHAT_RADIUS_PX;
      if (content.toLowerCase().startsWith('/shout ')) {
        content = content.slice(7).trim();
        if (content.length === 0) return;
        chatType = 'shout';
        radiusPx = SHOUT_RADIUS_PX;
      }

      // Apply profanity filter if available
      if (filter && filter.censor) {
        content = filter.censor(content);
      }

      var msg = state.addZoneChatMessage(zoneId, socket.id, content);
      if (!msg) return;
      msg.chatType = chatType;

      // Overworld zones: proximity-based broadcast via spatial grid
      var chatZone = state.zones.get(zoneId);
      if (chatZone && chatZone.chunkCache) {
        var senderPos = state.playerPositions.get(socket.id);
        if (!senderPos) return;
        var chatRadiusChunks = (chatType === 'shout') ? SHOUT_RADIUS_CHUNKS : CHAT_RADIUS_CHUNKS;
        var nearbyChatPlayers = gridGetNearby(zoneId, senderPos.x, senderPos.y, chatRadiusChunks);
        for (var ci = 0; ci < nearbyChatPlayers.length; ci++) {
          io.to(nearbyChatPlayers[ci]).emit('zone_message', msg);
        }
      } else {
        // Town/building zones: broadcast to everyone (small zone)
        io.to('zone:' + zoneId).emit('zone_message', msg);
      }
    });

    // --- resource_harvest: player harvests a resource node (PERMANENT - never depletes) ---
    socket.on('resource_harvest', function(data) {
      if (!data || typeof data.resourceId !== 'string') return;

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;

      var zone = state.zones.get(zoneId);
      if (!zone) return;

      // Look up resource: use resourceMap for overworld (O(1)), array scan otherwise
      var resource = null;
      if (zone.resourceMap) {
        resource = zone.resourceMap.get(data.resourceId) || null;
      } else {
        if (!zone.resources) return;
        for (var i = 0; i < zone.resources.length; i++) {
          if (zone.resources[i].id === data.resourceId) {
            resource = zone.resources[i];
            break;
          }
        }
      }
      if (!resource) return;

      // Per-player cooldown check
      var cooldownKey = socket.id + ':' + resource.id;
      var now = Date.now();
      var lastHarvest = harvestCooldowns.get(cooldownKey) || 0;
      if (now - lastHarvest < HARVEST_COOLDOWN_MS) {
        socket.emit('harvest_error', { message: 'Harvesting too fast' });
        return;
      }

      // Check proximity (within 60px)
      var pos = state.playerPositions.get(socket.id);
      if (!pos) return;
      var dx = pos.x - resource.x;
      var dy = pos.y - resource.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 60) {
        socket.emit('harvest_error', { message: 'Too far away' });
        return;
      }

      // Load account once here — all harvest sub-operations below reuse this reference
      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;
      var account = accounts.loadAccount(accKey);
      if (!account) return;
      if (!account.skills) account.skills = {};
      var skill = account.skills[resource.skill] || { level: 1, xp: 0 };
      if (skill.level < resource.minLevel) {
        socket.emit('harvest_error', {
          message: 'Requires ' + resource.skill.charAt(0).toUpperCase() + resource.skill.slice(1) + ' Lv.' + resource.minLevel,
        });
        return;
      }

      // Set cooldown
      harvestCooldowns.set(cooldownKey, now);

      // Apply biome XP bonus (SKILL_BIOME_BONUS from rpg-data)
      var harvestXpAmount = resource.xp;
      var biomeBonus = rpgData.SKILL_BIOME_BONUS[resource.skill];
      if (biomeBonus && state.worldgen && state.worldgen.getBiomeAtPixel) {
        var playerBiome = state.worldgen.getBiomeAtPixel(pos.x, pos.y);
        if (playerBiome && biomeBonus.preferred && biomeBonus.preferred.indexOf(playerBiome) !== -1) {
          harvestXpAmount = Math.round(harvestXpAmount * (1 + biomeBonus.bonus));
        }
      }

      // Day/night gathering XP bonuses
      var _timeOfDay = (state.world && state.world.timeOfDay) || 'day';
      var _gatherSkill = resource.skill;
      if (_timeOfDay === 'day') {
        if (_gatherSkill === 'farming' || _gatherSkill === 'woodcutting') harvestXpAmount = Math.round(harvestXpAmount * 1.10);
        if (_gatherSkill === 'fishing') harvestXpAmount = Math.round(harvestXpAmount * 0.90);
      } else if (_timeOfDay === 'night') {
        if (_gatherSkill === 'mining') harvestXpAmount = Math.round(harvestXpAmount * 1.15);
        if (_gatherSkill === 'fishing') harvestXpAmount = Math.round(harvestXpAmount * 1.10);
        if (_gatherSkill === 'farming' || _gatherSkill === 'woodcutting') harvestXpAmount = Math.round(harvestXpAmount * 0.90);
      } else if (_timeOfDay === 'dawn') {
        if (_gatherSkill === 'fishing') harvestXpAmount = Math.round(harvestXpAmount * 1.15);
      } else if (_timeOfDay === 'dusk') {
        if (_gatherSkill === 'fishing') harvestXpAmount = Math.round(harvestXpAmount * 1.20);
      }

      // Weather gathering XP bonuses
      var _weather = (state.world && state.world.weather) || 'clear';
      if (_weather === 'rain') {
        if (_gatherSkill === 'farming') harvestXpAmount = Math.round(harvestXpAmount * 1.15);
        if (_gatherSkill === 'fishing') harvestXpAmount = Math.round(harvestXpAmount * 1.10);
        if (_gatherSkill === 'woodcutting') harvestXpAmount = Math.round(harvestXpAmount * 0.90);
      } else if (_weather === 'storm') {
        harvestXpAmount = Math.round(harvestXpAmount * 0.80); // -20% all gathering
        if (_gatherSkill === 'mining') harvestXpAmount = Math.round(harvestXpAmount * 1.25); // net +0% mining (0.8*1.25=1.0) then +25% on top
      } else if (_weather === 'fog') {
        if (_gatherSkill === 'fishing') harvestXpAmount = Math.round(harvestXpAmount * 1.20);
        if (_gatherSkill === 'woodcutting') harvestXpAmount = Math.round(harvestXpAmount * 0.85);
      } else if (_weather === 'snow') {
        if (_gatherSkill === 'farming') harvestXpAmount = Math.round(harvestXpAmount * 0.85);
        if (_gatherSkill === 'mining') harvestXpAmount = Math.round(harvestXpAmount * 1.10);
        if (_gatherSkill === 'fishing') harvestXpAmount = Math.round(harvestXpAmount * 0.90);
      }

      // Award XP — pass pre-loaded account to avoid redundant loadAccount
      var xpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : undefined;
      var xpResult = accounts.addSkillXp(accKey, resource.skill, harvestXpAmount, xpRate, account);

      // Card Evolution XP: gathering category on harvest
      accounts.gainArchetypeCategoryXp(accKey, 'gathering', 5);

      // --- Phantom Skill XP: Herbalism, Foraging, Survival ---
      var _herbTypes = { herbs: true, mushroom: true, vegetables: true };
      var _forageBiomes = { 5: true, 7: true }; // FOREST=5, SWAMP=7
      var _nonForageSkills = { mining: true, woodcutting: true };

      // Herbalism: award XP when harvesting herb-like resources
      if (_herbTypes[resource.type]) {
        accounts.addSkillXp(accKey, 'herbalism', Math.round(harvestXpAmount * 0.8), xpRate, account);
      }

      // Foraging: award XP when harvesting non-mining/non-woodcutting resources in forest/swamp biomes
      if (!_nonForageSkills[resource.skill]) {
        var _playerBiomeForage = null;
        if (state.worldgen && state.worldgen.getBiomeAtPixel) {
          _playerBiomeForage = state.worldgen.getBiomeAtPixel(pos.x, pos.y);
        }
        if (_playerBiomeForage !== null && _forageBiomes[_playerBiomeForage]) {
          accounts.addSkillXp(accKey, 'foraging', Math.round(harvestXpAmount * 0.6), xpRate, account);
        }
      }

      // Survival: award 5 XP per new unique chunk visited (tracked per player)
      var _chunkX = Math.floor(pos.x / CHUNK_SIZE);
      var _chunkY = Math.floor(pos.y / CHUNK_SIZE);
      var _chunkKey = _chunkX + ',' + _chunkY;
      if (!state._survivalVisitedChunks) state._survivalVisitedChunks = new Map();
      var _playerVisited = state._survivalVisitedChunks.get(accKey);
      if (!_playerVisited) {
        _playerVisited = new Set();
        state._survivalVisitedChunks.set(accKey, _playerVisited);
      }
      if (!_playerVisited.has(_chunkKey)) {
        _playerVisited.add(_chunkKey);
        accounts.addSkillXp(accKey, 'survival', 5, xpRate, account);
      }

      // Determine resource type and add to inventory
      // Map resource node types to inventory resource types
      var resourceType = resource.type;
      if (resourceType === 'tree') resourceType = 'wood';
      else if (resourceType === 'iron') resourceType = 'iron_ore';
      else if (resourceType === 'fish_spot') resourceType = 'fish';
      else if (resourceType === 'shellfish_spot') resourceType = 'shellfish';
      else if (resourceType === 'seaweed_spot') resourceType = 'seaweed';
      else if (resourceType === 'mana_crystal_node') resourceType = 'mana_crystal';
      // All others (stone, herbs, wheat, vegetables, mushroom, glass_sand,
      // gem_rough, cogs, gears, springs) map directly to their type name

      // Check equipment for harvest multiplier (tiered tool bonuses)
      var TOOL_TIER_BONUS = {
        iron_axe:      { yield: 2, xpMult: 1.0 },
        copper_axe:    { yield: 2, xpMult: 1.05 },
        bronze_axe:    { yield: 2, xpMult: 1.10 },
        steel_axe:     { yield: 3, xpMult: 1.15 },
        mithril_axe:   { yield: 4, xpMult: 1.25 },
        iron_pickaxe:      { yield: 2, xpMult: 1.0 },
        copper_pickaxe:    { yield: 2, xpMult: 1.05 },
        bronze_pickaxe:    { yield: 2, xpMult: 1.10 },
        steel_pickaxe:     { yield: 3, xpMult: 1.15 },
        mithril_pickaxe:   { yield: 4, xpMult: 1.25 },
      };
      var harvestAmount = 1;
      // Use pre-loaded account for equipment and inventory
      var equipment = account.equipment || null;
      if (equipment) {
        var inv = account.mmoInventory || null;
        if (inv && inv.items) {
          if (resource.skill === 'woodcutting' && equipment.axe) {
            var axeItem = inv.items.find(function(it) { return it.id === equipment.axe; });
            // Broken tools (0 durability) provide no bonus
            var axeBroken = axeItem && accounts.isItemBroken ? accounts.isItemBroken(axeItem) : false;
            var tier = axeItem && !axeBroken && TOOL_TIER_BONUS[axeItem.type];
            if (tier) {
              harvestAmount = tier.yield;
              harvestXpAmount = Math.round(harvestXpAmount * tier.xpMult);
            }
          }
          if (resource.skill === 'mining' && equipment.pickaxe) {
            var pickItem = inv.items.find(function(it) { return it.id === equipment.pickaxe; });
            // Broken tools (0 durability) provide no bonus
            var pickBroken = pickItem && accounts.isItemBroken ? accounts.isItemBroken(pickItem) : false;
            var pickTier = pickItem && !pickBroken && TOOL_TIER_BONUS[pickItem.type];
            if (pickTier) {
              harvestAmount = pickTier.yield;
              harvestXpAmount = Math.round(harvestXpAmount * pickTier.xpMult);
            }
          }
        }
      }

      // Apply equipped card effects to gathering
      var cardEffects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(accKey, account) : [];
      var gatherBonus = 0;
      var doubleGatherChance = 0;
      var cropYieldBonus = 0;
      var herbYieldBonus = 0;
      var rareResourceChance = 0;
      var rareSeedChance = 0;
      var xpBonusAllGathering = 0;
      for (var cei = 0; cei < cardEffects.length; cei++) {
        var ce = cardEffects[cei];
        if (ce.type === 'gather_bonus') gatherBonus += (ce.value || 0);
        if (ce.type === 'double_gather_all' && ce.chance) doubleGatherChance += ce.chance;
        if (ce.type === 'double_gather' && ce.skill === resource.skill && ce.chance) doubleGatherChance += ce.chance;
        if (ce.type === 'loot_bonus') harvestXpAmount = Math.round(harvestXpAmount * (1 + (ce.value || 0)));
        if (ce.type === 'crop_yield_bonus') cropYieldBonus += (ce.value || 0);
        if (ce.type === 'herb_yield_bonus') herbYieldBonus += (ce.value || 0);
        if (ce.type === 'rare_resource_chance') rareResourceChance += (ce.value || 0);
        if (ce.type === 'rare_seed_chance') rareSeedChance += (ce.value || 0);
        if (ce.type === 'xp_bonus_all_gathering') xpBonusAllGathering += (ce.value || 0);
      }
      // Apply mastery tree bonuses for this gathering skill
      var masteryBonuses = masteryCore.getSkillMasteryBonuses(account, resource.skill);
      gatherBonus += (masteryBonuses.yield_pct || 0);
      doubleGatherChance += (masteryBonuses.double_drop_pct || 0);
      rareResourceChance += (masteryBonuses.rare_find_pct || 0);

      if (gatherBonus > 0) harvestAmount = Math.round(harvestAmount * (1 + gatherBonus));
      if (masteryBonuses.yield_flat) harvestAmount += Math.round(masteryBonuses.yield_flat);

      // Card: crop_yield_bonus — bonus yield for farming nodes
      if (cropYieldBonus > 0 && resource.skill === 'farming') {
        harvestAmount = Math.round(harvestAmount * (1 + cropYieldBonus));
      }

      // Card: herb_yield_bonus — bonus yield for herb/herbalism nodes
      if (herbYieldBonus > 0 && (resource.skill === 'herbalism' || resourceType === 'herbs')) {
        harvestAmount = Math.round(harvestAmount * (1 + herbYieldBonus));
      }

      if (doubleGatherChance > 0 && Math.random() < doubleGatherChance) harvestAmount *= 2;

      // Card: xp_bonus_all_gathering — add XP bonus for all gathering skills
      if (xpBonusAllGathering > 0) {
        var gatherSkills = { mining: true, woodcutting: true, farming: true, fishing: true, herbalism: true, foraging: true, skinning: true };
        if (gatherSkills[resource.skill]) {
          harvestXpAmount = Math.round(harvestXpAmount * (1 + xpBonusAllGathering));
        }
      }

      // Initialize HP if missing (resources generated before HP system)
      if (typeof resource.hp !== 'number') {
        var defaultHp = 8;
        if (resource.type === 'tree') defaultHp = 5;
        else if (resource.type === 'iron') defaultHp = 10;
        else if (resource.type === 'mana_crystal_node') defaultHp = 12;
        else if (resource.type === 'gem_rough') defaultHp = 10;
        else if (resource.type === 'fish_spot' || resource.type === 'shellfish_spot' || resource.type === 'seaweed_spot') defaultHp = 3;
        else if (resource.type === 'wheat' || resource.type === 'vegetables' || resource.type === 'herbs' || resource.type === 'mushroom') defaultHp = 2;
        resource.hp = defaultHp;
        resource.maxHp = defaultHp;
      }

      // Check if resource is inside a claimed plot (dynamic check — survives restart)
      var isOnPlot = false;
      if (zone.plots) {
        for (var pi = 0; pi < zone.plots.length; pi++) {
          var plot = zone.plots[pi];
          if (resource.x >= plot.x && resource.x < plot.x + plot.width &&
              resource.y >= plot.y && resource.y < plot.y + plot.height) {
            isOnPlot = true;
            break;
          }
        }
      }

      // Reduce resource HP
      var destroyed = false;
      var depleted = false;

      // Check if resource is currently depleted (respawn timer active)
      if (resource.depleted && resource.depletedUntil) {
        if (Date.now() < resource.depletedUntil) {
          socket.emit('harvest_error', { message: 'This resource is depleted' });
          return;
        }
        // Respawn timer expired — restore
        resource.depleted = false;
        resource.depletedUntil = null;
        resource.hp = resource.maxHp || 5;
      }

      resource.hp = resource.hp - 1;
      if (resource.hp <= 0) {
        if (isOnPlot || resource.noRespawn) {
          // On plot land: permanently remove
          destroyed = true;
          if (zone.resourceMap) {
            zone.resourceMap.delete(resource.id);
          }
          // Broadcast destruction to all players in zone
          io.to('zone:' + zoneId).emit('resource_destroyed', { resourceId: resource.id });
        } else {
          // Overworld: deplete with respawn timer (30 seconds)
          depleted = true;
          resource.depleted = true;
          resource.depletedUntil = Date.now() + 30000;
          resource.hp = 0;
          io.to('zone:' + zoneId).emit('resource_depleted', {
            resourceId: resource.id,
            depletedUntil: resource.depletedUntil,
          });
        }
      }

      // Add to player's resource inventory (weight-checked)
      var updatedInventory = accounts.addResource(accKey, resourceType, harvestAmount);
      if (updatedInventory && updatedInventory.overweight) {
        socket.emit('harvest_error', { message: 'You are too encumbered to carry more.' });
        return;
      }

      // Card: rare_resource_chance — roll for bonus rare resource on any harvest
      if (rareResourceChance > 0 && Math.random() < rareResourceChance) {
        var rareResources = ['gem_rough', 'mana_crystal', 'dark_crystal'];
        var rareRes = rareResources[Math.floor(Math.random() * rareResources.length)];
        accounts.addResource(accKey, rareRes, 1);
        socket.emit('bonus_drop', { resource: rareRes, amount: 1, message: 'Rare find!' });
      }

      // Card: rare_seed_chance — roll for rare seed drops on farming harvests
      if (rareSeedChance > 0 && resource.skill === 'farming' && Math.random() < rareSeedChance) {
        var rareSeeds = ['herbs', 'mushroom', 'mana_crystal'];
        var rareSeed = rareSeeds[Math.floor(Math.random() * rareSeeds.length)];
        accounts.addResource(accKey, rareSeed, 1);
        socket.emit('bonus_drop', { resource: rareSeed, amount: 1, message: 'Rare seed found!' });
      }

      // --- Tool durability loss: 0.2% per harvest for axes/pickaxes ---
      // Uses pre-loaded account and cardEffects from above
      var harvestDurWarnings = [];
      try {
        if (resource.skill === 'woodcutting' || resource.skill === 'mining') {
          var durToolSlot = (resource.skill === 'woodcutting') ? 'axe' : 'pickaxe';
          if (account.equipment && account.equipment[durToolSlot]) {
            var toolDurResult = accounts.reduceDurability(account, durToolSlot, 0.002, cardEffects);
            if (toolDurResult) {
              harvestDurWarnings.push(toolDurResult);
            }
            accounts.saveAccount(account);
          }
        }
      } catch (harvestDurErr) {
        // Durability is non-critical; do not block harvest
      }

      // Human-readable display name
      var itemName = resource.name || resourceType.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });

      // Emit harvest result to player
      socket.emit('harvest_result', {
        resourceId: resource.id,
        type: resource.type,
        item: itemName,
        amount: harvestAmount,
        xp: resource.xp,
        skill: resource.skill,
        skillLevel: xpResult.level,
        skillXp: xpResult.xp,
        xpNeeded: xpResult.xpNeeded,
        leveledUp: xpResult.leveledUp,
        inventory: updatedInventory,
        weight: accounts.getCurrentWeight(account),
        maxWeight: accounts.getCarryCapacity(account),
        encumbrance: accounts.getEncumbranceLevel(account),
        hp: resource.hp,
        maxHp: resource.maxHp,
        destroyed: destroyed,
      });

      // Emit tool durability warnings after harvest result
      for (var hdwi = 0; hdwi < harvestDurWarnings.length; hdwi++) {
        if (harvestDurWarnings[hdwi].broken) {
          socket.emit('item_broken', { slot: harvestDurWarnings[hdwi].slot, itemName: harvestDurWarnings[hdwi].itemName });
        } else if (harvestDurWarnings[hdwi].lowDurability) {
          socket.emit('durability_warning', { slot: harvestDurWarnings[hdwi].slot, itemName: harvestDurWarnings[hdwi].itemName, durability: harvestDurWarnings[hdwi].durability, maxDurability: harvestDurWarnings[hdwi].maxDurability });
        }
      }

      // Fire glossary trigger for first harvest
      try {
        var harvestTerms = knowledgeHandler.fireGlossaryTrigger(accounts, accKey, 'first_harvest');
        for (var hti = 0; hti < harvestTerms.length; hti++) {
          socket.emit('knowledge_term_unlocked', harvestTerms[hti]);
        }
      } catch (e) { /* glossary trigger non-fatal */ }

      // --- Track daily challenge & achievement progress for harvesting ---
      challengesHandler.trackChallengeProgress(accounts, accKey, 'harvest', harvestAmount);
      // Track specific resource types for targeted challenges
      if (resource.skill === 'mining') {
        challengesHandler.trackChallengeProgress(accounts, accKey, 'mine', harvestAmount);
      } else if (resource.skill === 'woodcutting') {
        challengesHandler.trackChallengeProgress(accounts, accKey, 'chop', harvestAmount);
      } else if (resource.skill === 'fishing') {
        challengesHandler.trackChallengeProgress(accounts, accKey, 'fish', harvestAmount);
      }

      // --- Quest progress: gather-type quests ---
      try {
        var qAcc = accounts.loadAccount(accKey);
        if (qAcc && qAcc.questProgress && qAcc.questProgress.active) {
          var qChanged = false;
          for (var qi = 0; qi < qAcc.questProgress.active.length; qi++) {
            var quest = qAcc.questProgress.active[qi];
            var rpgData = require('../rpg-data');
            var tmpl = rpgData.WORLD_QUEST_TEMPLATES ? rpgData.WORLD_QUEST_TEMPLATES.find(function(t) { return t.questId === quest.questId; }) : null;
            if (tmpl && tmpl.type === 'gather' && tmpl.target.resource === resource.type) {
              quest.progress = Math.min(quest.progress + harvestAmount, quest.targetCount);
              qChanged = true;
              if (quest.progress >= quest.targetCount) {
                socket.emit('quest_progress', { questId: quest.questId, progress: quest.progress, targetCount: quest.targetCount, complete: true });
              } else {
                socket.emit('quest_progress', { questId: quest.questId, progress: quest.progress, targetCount: quest.targetCount, complete: false });
              }
            }
          }
          if (qChanged) accounts.saveAccount(qAcc);
        }
      } catch (qErr) { /* quest progress error is non-fatal */ }
    });

    // --- get_inventory: player requests their MMO inventory ---
    socket.on('get_inventory', function() {
      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;
      var inventory = accounts.getMMOInventory(accKey);
      var equipment = accounts.getEquipment ? accounts.getEquipment(accKey) : { axe: null, pickaxe: null };
      // Include grid state for spatial inventory clients
      var gridState = null;
      var gridInv = require('../account-grid-inventory');
      var acc = accounts.loadAccount(accKey);
      if (acc) {
        gridInv.initGrid(acc);
        if (!acc.grid.placements || Object.keys(acc.grid.placements).length === 0) {
          var items = (acc.mmoInventory && acc.mmoInventory.items) || [];
          if (items.length > 0) {
            gridInv.migrateFromFlatInventory(acc);
            accounts.saveAccount(acc);
          }
        }
        gridState = gridInv.getFullInventoryState(acc);
      }
      socket.emit('inventory_updated', { inventory: inventory, equipment: equipment, gridState: gridState });
    });

    // --- request_chunks: client explicitly requests chunk data for given coords ---
    socket.on('request_chunks', function(data) {
      if (!applyRateGrace(socket, 'request_chunks', 40, 5000)) return;
      if (!data || typeof data.cx !== 'number' || typeof data.cy !== 'number') return;

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;

      var zone = state.zones.get(zoneId);
      if (!zone || !zone.chunkCache) return;

      // Proximity validation: only allow chunk requests within reasonable range of player
      var pos = state.playerPositions.get(socket.id);
      if (pos) {
        var playerCx = Math.floor(pos.x / CHUNK_SIZE);
        var playerCy = Math.floor(pos.y / CHUNK_SIZE);
        var reqCx = Math.floor(data.cx);
        var reqCy = Math.floor(data.cy);
        var cdx = reqCx - playerCx, cdy = reqCy - playerCy;
        if (cdx * cdx + cdy * cdy > 25) return; // max 5 chunks away
      }

      sendNearbyChunks(socket, zoneId, Math.floor(data.cx), Math.floor(data.cy));
    });

    // --- cave_enter: player enters a cave (transition between overworld ↔ hollow earth) ---
    socket.on('cave_enter', function(data) {
      if (!data || typeof data.worldX !== 'number' || typeof data.worldY !== 'number') return;

      var currentZoneId = state.playerZones.get(socket.id);
      if (!currentZoneId) return;

      var currentZone = state.zones.get(currentZoneId);
      if (!currentZone || !currentZone.chunkCache) return;

      // Determine destination zone
      var destZoneId;
      if (data.surfaceExit) {
        // Going UP from hollow earth to overworld
        if (currentZoneId !== 'hollow_earth') return;
        destZoneId = 'overworld';
      } else {
        // Going DOWN from overworld
        if (currentZoneId !== 'overworld') return;

        // Check if this cave is a dungeon (non-hollow-earth) cave
        // Look up the cave feature meta from the chunk at this position
        var caveChunkCx = Math.floor(data.worldX / 512);
        var caveChunkCy = Math.floor(data.worldY / 512);
        var caveChunk = state.getOrGenerateChunk(currentZoneId, caveChunkCx, caveChunkCy);
        var isDungeonCave = false;
        if (caveChunk && caveChunk.featureMeta) {
          for (var fi = 0; fi < caveChunk.featureMeta.length; fi++) {
            var fm = caveChunk.featureMeta[fi];
            if (fm.type === 'cave' && !fm.hollowEarth) {
              // Check proximity to this cave entrance
              var fmPixelX = caveChunkCx * 512 + fm.tx * 32;
              var fmPixelY = caveChunkCy * 512 + fm.ty * 32;
              var fdx = data.worldX - fmPixelX;
              var fdy = data.worldY - fmPixelY;
              if (Math.sqrt(fdx * fdx + fdy * fdy) <= 80) {
                isDungeonCave = true;
                // Signal client to enter dungeon instead
                var caveKey = Math.floor(data.worldX) + '_' + Math.floor(data.worldY);
                socket.emit('cave_is_dungeon', {
                  dungeonId: 'cave_' + caveKey,
                  caveName: fm.name || 'Cave',
                  worldX: data.worldX,
                  worldY: data.worldY,
                });
                return;
              }
            }
          }
        }

        destZoneId = 'hollow_earth';
      }

      var destZone = state.zones.get(destZoneId);
      if (!destZone) return;

      // Verify player is near the cave entrance (within 80px)
      var pos = state.playerPositions.get(socket.id);
      if (!pos) return;
      var dx = pos.x - data.worldX;
      var dy = pos.y - data.worldY;
      if (Math.sqrt(dx * dx + dy * dy) > 80) {
        socket.emit('cave_enter_error', { message: 'Too far from cave entrance' });
        return;
      }

      // Use same world coordinates in destination zone
      var destX = data.worldX;
      var destY = data.worldY;

      // Leave current zone + remove from spatial grid
      gridRemove(socket.id);
      socket.leave('zone:' + currentZoneId);
      io.to('zone:' + currentZoneId).emit('player_left_zone', {
        playerId: socket.id,
        playerName: user.name,
        zoneId: currentZoneId,
      });

      // Join destination zone at same world coords
      var result = state.joinZone(socket.id, destZoneId, destX, destY);
      if (!result) {
        socket.emit('cave_enter_error', { message: 'Could not enter cave' });
        return;
      }

      // Save location
      var accKey = socketAccountMap.get(socket.id);
      if (accKey) {
        accounts.setLastLocation(accKey, destZoneId, destX, destY);
      }

      // Join socket room and send zone state
      socket.join('zone:' + destZoneId);
      socket.emit('zone_state', state.getZoneState(destZoneId));

      // Send nearby chunks at destination
      var destChunk = getChunkCoords(destX, destY);
      playerChunks.set(socket.id, destChunk.cx + ',' + destChunk.cy);
      clientChunks.delete(socket.id); // clear chunk cache on zone transition
      sendNearbyChunks(socket, destZoneId, destChunk.cx, destChunk.cy);

      // Broadcast entry to destination zone
      socket.to('zone:' + destZoneId).emit('player_entered_zone', {
        id: socket.id,
        name: user.name,
        username: user.username,
        color: user.color,
        tag: user.tag,
        avatar: user.avatar || null,
        x: destX,
        y: destY,
        facing: pos.facing || 'down',
        zoneId: destZoneId,
      });
    });

    // --- zone_interact_animal: interact with overworld animal NPCs ---
    socket.on('zone_interact_animal', function(data) {
      if (!data || typeof data.animalId !== 'string') return;

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;
      var zone = state.zones.get(zoneId);
      if (!zone || !zone.chunkCache) return; // overworld only

      // Find the animal in the chunk cache
      var pos = state.playerPositions.get(socket.id);
      if (!pos) return;

      var playerChunkCoords = getChunkCoords(pos.x, pos.y);
      var animal = null;
      var animalChunk = null;

      // Search in nearby chunks (player's chunk + adjacent)
      for (var sdy = -1; sdy <= 1 && !animal; sdy++) {
        for (var sdx = -1; sdx <= 1 && !animal; sdx++) {
          var searchCx = playerChunkCoords.cx + sdx;
          var searchCy = playerChunkCoords.cy + sdy;
          var chunkKey = searchCx + ',' + searchCy;
          var chunk = zone.chunkCache.get(chunkKey);
          if (!chunk || !chunk.animals) continue;
          for (var ai = 0; ai < chunk.animals.length; ai++) {
            if (chunk.animals[ai].id === data.animalId) {
              animal = chunk.animals[ai];
              animalChunk = chunk;
              break;
            }
          }
        }
      }

      if (!animal) {
        socket.emit('zone_error', { message: 'Animal not found' });
        return;
      }
      if (animal.interacted) {
        socket.emit('zone_error', { message: 'You have already interacted with this animal' });
        return;
      }

      // Proximity check (within 64px = 2 tiles)
      var adx = pos.x - animal.x;
      var ady = pos.y - animal.y;
      if (adx * adx + ady * ady > 64 * 64) {
        socket.emit('zone_error', { message: 'Too far from animal' });
        return;
      }

      // Check player's animal form from equipped cards
      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;
      var acc = accounts.loadAccount(accKey);
      if (!acc) return;

      var activeForm = null;
      var canSpeakTo = [];

      // Check equipped cards for animal form cards
      if (acc.equippedCards && acc.rpgCards) {
        for (var ei = 0; ei < acc.equippedCards.length; ei++) {
          var cardInstanceId = acc.equippedCards[ei];
          if (!cardInstanceId) continue;
          var cardInstance = null;
          for (var ci = 0; ci < acc.rpgCards.length; ci++) {
            if (acc.rpgCards[ci].instanceId === cardInstanceId) {
              cardInstance = acc.rpgCards[ci];
              break;
            }
          }
          if (!cardInstance) continue;
          var tmpl = rpgData.CARD_BY_ID[cardInstance.cardId];
          if (tmpl && tmpl.animalForm && tmpl.explorationAbilities) {
            activeForm = tmpl.animalForm;
            if (tmpl.explorationAbilities.canAnimalSpeak) {
              canSpeakTo = tmpl.explorationAbilities.canAnimalSpeak;
            }
            break; // Use first equipped animal form
          }
        }
      }

      var resultPayload = {
        animalId: animal.id,
        animalType: animal.animalType,
        animalName: animal.name,
      };

      if (!activeForm) {
        // No animal form — animal flees
        animal.interacted = true;
        resultPayload.success = false;
        resultPayload.reaction = 'flee';
        resultPayload.message = 'The ' + animal.name.toLowerCase() + ' spots you and darts away. You need an animal form to communicate.';
        socket.emit('zone_animal_interact_result', resultPayload);
        return;
      }

      // Check speech compatibility using ANIMAL_SPEAK_CATEGORIES from worldgen
      // We inline the check here to avoid importing dungeon-data into zone handler
      var animalCategories = [];
      // Map animal types to speak categories (same as dungeon-data.js ANIMAL_SPEAK_CATEGORIES)
      var _speakCat = {
        wolf: ['wolf', 'dog', 'hound'], bear: ['bear'], cat: ['cat', 'lion', 'panther'],
        dog: ['dog', 'wolf', 'hound'], hound: ['dog', 'wolf', 'hound'],
        fish: ['fish', 'aquatic'], turtle: ['turtle', 'tortoise', 'reptile'],
        eagle: ['bird', 'eagle', 'hawk'], hawk: ['bird', 'eagle', 'hawk'],
        owl: ['bird', 'owl'], spider: ['spider', 'insect'],
        snake: ['snake', 'serpent', 'reptile'], serpent: ['snake', 'serpent', 'reptile'],
        frog: ['aquatic'], crab: ['aquatic'], eel: ['fish', 'aquatic'],
        lizard: ['snake', 'serpent', 'reptile'], scorpion: ['spider', 'insect'],
        parrot: ['bird'], penguin: ['bird'], heron: ['bird'],
        monkey: [], deer: [], rabbit: [], fox: [], mountain_goat: [],
      };
      animalCategories = _speakCat[animal.animalType] || [];

      var canSpeak = false;
      if (animalCategories.length === 0) {
        // Animals with no categories can be spoken to by any form
        canSpeak = true;
      } else {
        for (var sci = 0; sci < animalCategories.length; sci++) {
          if (canSpeakTo.indexOf(animalCategories[sci]) !== -1) {
            canSpeak = true;
            break;
          }
        }
      }

      if (!canSpeak) {
        resultPayload.success = false;
        resultPayload.reaction = 'neutral';
        resultPayload.message = 'The ' + animal.name.toLowerCase() + ' tilts its head at you, but you cannot understand each other. Try a different form.';
        socket.emit('zone_animal_interact_result', resultPayload);
        return;
      }

      // Success — generate simple dialogue
      animal.interacted = true;
      var overworldGreetings = [
        'The ' + animal.name.toLowerCase() + ' regards you as a kindred spirit.',
        'The ' + animal.name.toLowerCase() + ' approaches without fear, sensing your form.',
        'A calm understanding passes between you and the ' + animal.name.toLowerCase() + '.',
      ];
      var overworldHints = [
        'It gestures toward a nearby area. There may be resources or a cave entrance that way.',
        'It seems relaxed here. This area is safe for now.',
        'It shifts nervously and looks to the horizon. Danger approaches from that direction.',
      ];
      var greetIdx = Math.floor(Math.random() * overworldGreetings.length);
      var hintIdx = Math.floor(Math.random() * overworldHints.length);

      resultPayload.success = true;
      resultPayload.reaction = 'friendly';
      resultPayload.greeting = overworldGreetings[greetIdx];
      resultPayload.hint = overworldHints[hintIdx];
      resultPayload.formUsed = activeForm;

      // Small XP reward
      var animalXp = 5;
      var serverXpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : 1;
      var xpResult = accounts.addSkillXp(accKey, 'animal_handling', Math.floor(animalXp * serverXpRate));
      // Fallback: if animal_handling skill does not exist, award to overall
      if (!xpResult || xpResult.error) {
        xpResult = null; // Skill may not exist yet — that is OK
      }
      resultPayload.xp = Math.floor(animalXp * serverXpRate);
      if (xpResult) resultPayload.skillResult = xpResult;

      socket.emit('zone_animal_interact_result', resultPayload);
    });

    // --- corruption_cleanse: player uses purification crystal to cleanse corruption ---
    socket.on('corruption_cleanse', function() {
      if (!deps.directorLich) return;

      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;

      var pos = state.playerPositions.get(socket.id);
      if (!pos) return;

      var cx = Math.floor(pos.x / CHUNK_SIZE);
      var cy = Math.floor(pos.y / CHUNK_SIZE);

      // Check player is in a corrupted chunk
      var corruptionLevel = deps.directorLich.getCorruptionLevel(cx, cy);
      if (!corruptionLevel || corruptionLevel <= 0) {
        socket.emit('corruption_cleanse_result', { success: false, reason: 'No corruption here.' });
        return;
      }

      // Check player has purification crystal
      var inv = accounts.getMMOInventory ? accounts.getMMOInventory(accKey) : null;
      if (!inv) {
        socket.emit('corruption_cleanse_result', { success: false, reason: 'No purification crystal.' });
        return;
      }
      var crystalCount = inv.purification_crystal || 0;
      if (crystalCount <= 0) {
        socket.emit('corruption_cleanse_result', { success: false, reason: 'No purification crystal.' });
        return;
      }

      // Compute card bonuses for cleansing (purifiers_oath, etc.)
      var cleanseBonuses = { radiusBonus: 0, amountBonus: 0 };
      var clAcc = accounts.loadAccount(accKey);
      if (clAcc && clAcc.rpgCards && clAcc.equippedCards) {
        var clCardMap = {};
        for (var cci = 0; cci < clAcc.rpgCards.length; cci++) {
          clCardMap[clAcc.rpgCards[cci].instanceId] = clAcc.rpgCards[cci];
        }
        for (var cei = 0; cei < clAcc.equippedCards.length; cei++) {
          var ceId = clAcc.equippedCards[cei];
          if (!ceId || !clCardMap[ceId]) continue;
          var ceCard = clCardMap[ceId];
          if (ceCard.effects) {
            for (var efi = 0; efi < ceCard.effects.length; efi++) {
              if (ceCard.effects[efi].type === 'purification_crystal_bonus') {
                cleanseBonuses.amountBonus += ceCard.effects[efi].value || 0;
              }
            }
          }
        }
      }

      // Consume 1 crystal
      accounts.addResource(accKey, 'purification_crystal', -1);

      // Cleanse corruption (with card bonuses)
      var result = deps.directorLich.playerCleanse(cx, cy, socket.id, cleanseBonuses);

      // Send updated corruption to nearby players
      var updatedCorruption = deps.directorLich.getCorruptionForArea(cx, cy, 5);
      var cleanseZoneId = state.playerZones.get(socket.id);
      var nearbySockets = cleanseZoneId ? gridGetNearby(cleanseZoneId, pos.x, pos.y, 5) : [];
      for (var ni = 0; ni < nearbySockets.length; ni++) {
        io.to(nearbySockets[ni]).emit('corruption_update', { chunks: updatedCorruption });
      }

      // Send result to cleansing player
      socket.emit('corruption_cleanse_result', {
        success: true,
        cleansed: result.cleansed,
        chunks: result.chunks,
      });

      // Broadcast world event
      var zoneId = state.playerZones.get(socket.id);
      if (zoneId) {
        io.to('zone:' + zoneId).emit('world_event', {
          type: 'corruption_cleanse',
          message: user.name + ' cleanses corruption near (' + cx + ',' + cy + ')!',
          cx: cx,
          cy: cy,
        });
      }
    });

    // --- corruption_card_cleanse: player uses an equipped active cleansing card ---
    // Drains HP and mana instead of consuming a purification crystal
    socket.on('corruption_card_cleanse', function(data) {
      if (!deps.directorLich) return;
      if (!data || !data.cardId) return;

      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;

      var pos = state.playerPositions.get(socket.id);
      if (!pos) return;

      var cx = Math.floor(pos.x / CHUNK_SIZE);
      var cy = Math.floor(pos.y / CHUNK_SIZE);

      // Check player is in a corrupted chunk
      var corruptionLevel = deps.directorLich.getCorruptionLevel(cx, cy);
      if (!corruptionLevel || corruptionLevel <= 0) {
        socket.emit('corruption_card_cleanse_result', { success: false, reason: 'No corruption here.' });
        return;
      }

      // Find the equipped card with overworld_cleanse effect
      var acc = accounts.loadAccount(accKey);
      if (!acc || !acc.rpgCards || !acc.equippedCards) {
        socket.emit('corruption_card_cleanse_result', { success: false, reason: 'No cards equipped.' });
        return;
      }

      var cardMap = {};
      for (var ci = 0; ci < acc.rpgCards.length; ci++) {
        cardMap[acc.rpgCards[ci].instanceId] = acc.rpgCards[ci];
      }

      // Find the specific card and its overworld_cleanse effect
      var cleanseEffect = null;
      var foundCard = null;
      for (var ei = 0; ei < acc.equippedCards.length; ei++) {
        var eqId = acc.equippedCards[ei];
        if (!eqId || !cardMap[eqId]) continue;
        var card = cardMap[eqId];
        if (card.cardId !== data.cardId) continue;
        // Find the overworld_cleanse effect
        if (card.effects) {
          for (var efi = 0; efi < card.effects.length; efi++) {
            if (card.effects[efi].type === 'overworld_cleanse') {
              cleanseEffect = card.effects[efi];
              foundCard = card;
              break;
            }
          }
        }
        // Also check template effects (in case instance doesn't have them)
        if (!cleanseEffect && rpgData.CARD_BY_ID && rpgData.CARD_BY_ID[card.cardId]) {
          var tmpl = rpgData.CARD_BY_ID[card.cardId];
          if (tmpl.effects) {
            for (var tfi = 0; tfi < tmpl.effects.length; tfi++) {
              if (tmpl.effects[tfi].type === 'overworld_cleanse') {
                cleanseEffect = tmpl.effects[tfi];
                foundCard = card;
                break;
              }
            }
          }
        }
        if (cleanseEffect) break;
      }

      if (!cleanseEffect || !foundCard) {
        socket.emit('corruption_card_cleanse_result', { success: false, reason: 'No cleansing card equipped.' });
        return;
      }

      // Check cooldown
      if (!acc._cardCooldowns) acc._cardCooldowns = {};
      var now = Date.now();
      var cdKey = 'overworld_cleanse_' + foundCard.cardId;
      var cdExpiry = acc._cardCooldowns[cdKey] || 0;
      if (now < cdExpiry) {
        var remaining = Math.ceil((cdExpiry - now) / 1000);
        socket.emit('corruption_card_cleanse_result', { success: false, reason: 'Card on cooldown (' + remaining + 's remaining).' });
        return;
      }

      // Compute HP and mana costs using rpgData.computeStats
      var rpgStats = acc.rpgStats || rpgData.getDefaultStats();
      var computed = rpgData.computeStats(rpgStats, acc.level || 1, acc.race || null);
      var maxHp = computed.hp || 100;
      var maxMana = 50; // base mana pool
      var hpCost = Math.ceil(maxHp * (cleanseEffect.hpCostPct || 0.15));
      var manaCost = Math.min(cleanseEffect.manaCost || 20, maxMana);

      // Check player has enough HP (can't kill themselves)
      var currentHp = acc._currentHp || maxHp;
      if (currentHp <= hpCost + 1) {
        socket.emit('corruption_card_cleanse_result', { success: false, reason: 'Not enough life force. You would die.' });
        return;
      }

      // Apply costs
      acc._currentHp = currentHp - hpCost;
      acc._currentMana = Math.max(0, (acc._currentMana || maxMana) - manaCost);

      // Set cooldown
      acc._cardCooldowns[cdKey] = now + (cleanseEffect.cooldown || 30) * 1000;

      // Apply debuff if present (e.g. spiritually_drained from Martyr's Sacrifice)
      if (cleanseEffect.debuff) {
        if (!acc._activeDebuffs) acc._activeDebuffs = {};
        acc._activeDebuffs[cleanseEffect.debuff] = now + (cleanseEffect.debuffDuration || 60) * 1000;
      }

      accounts.saveAccount(acc);

      // Perform cleanse using card's radius and cleanse power
      var cardRadius = cleanseEffect.radius || 1;
      var cardAmount = cleanseEffect.cleanseAmount || 30;
      var effectiveResult = deps.directorLich.playerCleanse(cx, cy, socket.id, {
        radiusBonus: Math.max(0, cardRadius - 3),
        amountBonus: Math.max(0, (cardAmount / 25) - 1),
      });

      // Send updated corruption to nearby players
      var updatedCorruption = deps.directorLich.getCorruptionForArea(cx, cy, Math.max(5, cardRadius + 2));
      var cardCleanseZoneId = state.playerZones.get(socket.id);
      var nearbySockets = cardCleanseZoneId ? gridGetNearby(cardCleanseZoneId, pos.x, pos.y, Math.max(5, cardRadius + 2)) : [];
      for (var ni = 0; ni < nearbySockets.length; ni++) {
        io.to(nearbySockets[ni]).emit('corruption_update', { chunks: updatedCorruption });
      }

      socket.emit('corruption_card_cleanse_result', {
        success: true,
        cleansed: effectiveResult.cleansed,
        chunks: effectiveResult.chunks,
        hpCost: hpCost,
        manaCost: manaCost,
        currentHp: acc._currentHp,
        currentMana: acc._currentMana,
        cardName: foundCard.name || foundCard.cardId,
        cooldownSec: cleanseEffect.cooldown || 30,
        debuff: cleanseEffect.debuff || null,
      });

      // Broadcast world event
      var zoneId = state.playerZones.get(socket.id);
      if (zoneId) {
        io.to('zone:' + zoneId).emit('world_event', {
          type: 'corruption_card_cleanse',
          message: user.name + ' channels holy power to cleanse corruption near (' + cx + ',' + cy + ')!',
          cx: cx,
          cy: cy,
          cardName: foundCard.name || foundCard.cardId,
        });
      }
    });

    // --- zone_leave: explicit leave ---
    socket.on('zone_leave', function() {
      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;

      socket.leave('zone:' + zoneId);
      state.leaveZone(socket.id);

      io.to('zone:' + zoneId).emit('player_left_zone', {
        playerId: socket.id,
        playerName: user.name,
        zoneId: zoneId,
      });
    });

    // Clean up cooldowns and chunk tracking on disconnect
    socket.on('disconnect', function() {
      // Save final position to account
      var accKey = socketAccountMap.get(socket.id);
      var pos = state.playerPositions.get(socket.id);
      var zoneId = state.playerZones.get(socket.id);
      if (accKey && pos && zoneId) {
        accounts.setLastLocation(accKey, zoneId, pos.x, pos.y);
      }

      // Remove all cooldowns for this socket
      for (var key of harvestCooldowns.keys()) {
        if (key.startsWith(socket.id + ':')) {
          harvestCooldowns.delete(key);
        }
      }
      // Remove chunk tracking + spatial grid
      playerChunks.delete(socket.id);
      clientChunks.delete(socket.id);
      playerLastFacing.delete(socket.id);
      playerLastMoveTime.delete(socket.id);
      playerSpeedViolations.delete(socket.id);
      playerMountCache.delete(socket.id);
      // Clean up survival visited chunks to prevent memory leak (BUG-1)
      if (accKey && state._survivalVisitedChunks) {
        state._survivalVisitedChunks.delete(accKey);
      }
      gridRemove(socket.id);
      _moveBatch.delete(socket.id);
    });
  }
};
