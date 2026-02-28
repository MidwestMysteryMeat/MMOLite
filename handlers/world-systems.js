// handlers/world-systems.js
// Socket handler for world simulation systems:
// disease status, weather queries, faction influence, ecology state.

'use strict';

function init(io, socket, deps) {
  var state = deps.state;
  var socketAccountMap = deps.socketAccountMap;
  var director = deps.director;

  // --- Disease status ---
  socket.on('disease_status', function() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return;

    var diseaseSys = director ? director.getDiseaseSystem() : null;
    if (!diseaseSys) {
      socket.emit('disease_status', { diseases: {}, chunkDiseases: [] });
      return;
    }

    var playerDiseases = diseaseSys.getPlayerDiseases(key);

    // Get diseases at player's current chunk
    var pos = state.playerPositions ? state.playerPositions.get(socket.id) : null;
    var chunkDiseases = [];
    if (pos) {
      var cx = Math.floor(pos.x / 512);
      var cy = Math.floor(pos.y / 512);
      chunkDiseases = diseaseSys.getDiseasesAtChunk(cx, cy);
    }

    socket.emit('disease_status', {
      diseases: playerDiseases,
      chunkDiseases: chunkDiseases,
    });
  });

  // --- Cure disease ---
  socket.on('cure_disease', function(data) {
    if (!data || typeof data.diseaseId !== 'string') return;
    var key = socketAccountMap.get(socket.id);
    if (!key) return;

    var diseaseSys = director ? director.getDiseaseSystem() : null;
    if (!diseaseSys) return;

    var disease = diseaseSys.DISEASES[data.diseaseId];
    if (!disease) return;

    // Check if player has the cure item
    var accounts = deps.accounts;
    var acc = accounts.loadAccount(key);
    if (!acc) return;

    var cureItem = disease.cureItem;
    var hasCure = false;
    if (acc.mmoInventory && acc.mmoInventory.items) {
      for (var i = 0; i < acc.mmoInventory.items.length; i++) {
        if (acc.mmoInventory.items[i] && acc.mmoInventory.items[i].id === cureItem) {
          acc.mmoInventory.items.splice(i, 1);
          hasCure = true;
          break;
        }
      }
    }

    if (!hasCure) {
      socket.emit('cure_error', { message: 'You need ' + cureItem.replace(/_/g, ' ') + ' to cure ' + disease.name });
      return;
    }

    diseaseSys.curePlayer(key, data.diseaseId);
    accounts.saveAccount(acc);
    socket.emit('cure_success', { diseaseId: data.diseaseId, message: 'Cured ' + disease.name });
  });

  // --- Weather at position ---
  socket.on('weather_query', function() {
    var weatherProp = director ? director.getWeatherPropagation() : null;
    if (!weatherProp) {
      socket.emit('weather_info', { weather: 'clear', wind: { name: 'east' } });
      return;
    }

    var pos = state.playerPositions ? state.playerPositions.get(socket.id) : null;
    if (!pos) {
      socket.emit('weather_info', { weather: 'clear', wind: weatherProp.getWindDirection() });
      return;
    }

    var cx = Math.floor(pos.x / 512);
    var cy = Math.floor(pos.y / 512);
    var weather = weatherProp.getWeatherAtChunk(cx, cy);

    socket.emit('weather_info', {
      weather: weather.weather,
      intensity: weather.intensity,
      wind: weatherProp.getWindDirection(),
    });
  });

  // --- Faction influence at position ---
  socket.on('influence_query', function() {
    var infMaps = director ? director.getInfluenceMaps() : null;
    if (!infMaps) {
      socket.emit('influence_info', { controlling: null, influence: {} });
      return;
    }

    var pos = state.playerPositions ? state.playerPositions.get(socket.id) : null;
    if (!pos) {
      socket.emit('influence_info', { controlling: null, influence: {} });
      return;
    }

    var cx = Math.floor(pos.x / 512);
    var cy = Math.floor(pos.y / 512);
    var controlling = infMaps.getControllingFaction(cx, cy);
    var area = infMaps.getInfluenceForArea(cx, cy, 5);

    socket.emit('influence_info', {
      controlling: controlling,
      area: area,
    });
  });

  // --- Ecology state at position ---
  socket.on('ecology_query', function() {
    var ecology = director ? director.getBiomeSuccession() : null;
    if (!ecology) {
      socket.emit('ecology_info', { state: -1, name: 'unknown' });
      return;
    }

    var pos = state.playerPositions ? state.playerPositions.get(socket.id) : null;
    if (!pos) {
      socket.emit('ecology_info', { state: -1, name: 'unknown' });
      return;
    }

    var cx = Math.floor(pos.x / 512);
    var cy = Math.floor(pos.y / 512);
    var ecoState = ecology.getEcologyState(cx, cy);

    socket.emit('ecology_info', {
      state: ecoState,
      name: ecology.getEcologyName(ecoState),
      resourceBonus: ecology.getResourceBonus(cx, cy),
    });
  });
}

module.exports = { init: init };
