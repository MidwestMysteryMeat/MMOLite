// handlers/deeds.js
// Building ownership, deed items, and interior zone entry.
//
// Buildings in state.js placedObjects may carry:
//   ownerId    — NPC id of the permanent occupant/owner
//   leaseKey   — account key of the player who holds the deed
//   interiorId — zone id for the building's interior (auto-derived if absent)
//
// Deed items in player inventory use the key: "deed_{zoneId}_{buildingId}".
// A player holding a deed for a building in a zone is the tenant of that building.
//
// Events received:
//   building_enter        { zoneId, buildingId }
//   building_deed_request { zoneId, buildingId }
//
// Events emitted:
//   building_enter_result { buildingId, interiorZoneId, ownerId, isOwner, ownerName }
//   building_deed_info    { buildingId, zoneId, ownerId, ownerName, leaseKey, hasDeed }

module.exports = {
  init(io, socket, deps) {
    var { state, socketAccountMap, accounts } = deps;

    // Resolve or auto-derive an interior zone id for a building.
    function _interiorId(zoneId, building) {
      if (building.interiorId) return building.interiorId;
      return 'interior_' + zoneId + '_' + building.id;
    }

    // Find a placed building by id within a zone's placedObjects.
    function _findBuilding(zone, buildingId) {
      if (!zone || !zone.placedObjects) return null;
      return zone.placedObjects.find(function(o) { return o.id === buildingId; }) || null;
    }

    function _deedKey(zoneId, buildingId) {
      return 'deed_' + zoneId + '_' + buildingId;
    }

    // --- building_enter: player requests to enter a building ---
    socket.on('building_enter', function(data) {
      if (!data || typeof data.buildingId !== 'string') return;

      var zoneId = data.zoneId || state.playerZones.get(socket.id);
      if (!zoneId) return;

      var zone = state.zones.get(zoneId);
      var building = _findBuilding(zone, data.buildingId);
      if (!building) {
        socket.emit('npc_error', { message: 'Building not found.' });
        return;
      }

      var accKey = socketAccountMap.get(socket.id);
      var account = accKey ? accounts.loadAccount(accKey) : null;

      var interiorZoneId = _interiorId(zoneId, building);
      var hasDeed = !!(account && account.mmoInventory && account.mmoInventory[_deedKey(zoneId, building.id)]);

      // Determine occupant NPC name
      var ownerName = null;
      if (building.ownerId && zone && zone.npcs) {
        var ownerNpc = zone.npcs.find(function(n) { return n.id === building.ownerId; });
        if (ownerNpc) ownerName = ownerNpc.name;
      }

      socket.emit('building_enter_result', {
        buildingId:    building.id,
        interiorZoneId: interiorZoneId,
        ownerId:       building.ownerId || null,
        ownerName:     ownerName,
        leaseKey:      building.leaseKey || null,
        isOwner:       hasDeed || (accKey && building.leaseKey === accKey),
        label:         building.label || building.id,
      });
    });

    // --- building_deed_request: inspect deed/ownership info for a building ---
    socket.on('building_deed_request', function(data) {
      if (!data || typeof data.buildingId !== 'string') return;

      var zoneId = data.zoneId || state.playerZones.get(socket.id);
      if (!zoneId) return;

      var zone = state.zones.get(zoneId);
      var building = _findBuilding(zone, data.buildingId);
      if (!building) {
        socket.emit('npc_error', { message: 'Building not found.' });
        return;
      }

      var accKey = socketAccountMap.get(socket.id);
      var account = accKey ? accounts.loadAccount(accKey) : null;
      var hasDeed = !!(account && account.mmoInventory && account.mmoInventory[_deedKey(zoneId, building.id)]);

      var ownerName = null;
      if (building.ownerId && zone && zone.npcs) {
        var ownerNpc = zone.npcs.find(function(n) { return n.id === building.ownerId; });
        if (ownerNpc) ownerName = ownerNpc.name;
      }

      socket.emit('building_deed_info', {
        buildingId: building.id,
        zoneId:     zoneId,
        label:      building.label || building.id,
        ownerId:    building.ownerId || null,
        ownerName:  ownerName,
        leaseKey:   building.leaseKey || null,
        hasDeed:    hasDeed,
      });
    });
  },
};
