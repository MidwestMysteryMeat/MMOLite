// handlers/corpse-loot.js
// Lootable corpse system — enemies leave a body with procedural loot on death.
// Also handles lootable world containers (crates, barrels) in overworld zones.
// Events: loot_corpse, take_corpse_item, take_all_corpse, loot_container, take_container_item

var crypto = require('crypto');
var lootGen = require('../loot-generator');
var accountWeight = require('../account-weight');
var _gridSizes = require('../inventory-grid-sizes');

var state;
var accounts;
var io;

// Corpse despawn time: 3 minutes
var CORPSE_DESPAWN_MS = 3 * 60 * 1000;

// World container respawn time: 10 minutes
var CONTAINER_RESPAWN_MS = 10 * 60 * 1000;

// Max corpses per zone
var MAX_CORPSES_PER_ZONE = 40;

// Max world containers per zone
var MAX_CONTAINERS_PER_ZONE = 15;

// ---------------------------------------------------------------------------
// Corpse generation from killed monsters
// ---------------------------------------------------------------------------

// Item chance scales with monster level
var ITEM_DROP_BASE = 0.12;     // 12% base item drop chance
var ITEM_DROP_PER_LEVEL = 0.01; // +1% per monster level

function generateCorpseId() {
  return 'corpse_' + crypto.randomBytes(4).toString('hex');
}

function generateContainerId() {
  return 'wc_' + crypto.randomBytes(4).toString('hex');
}

// Build loot for a monster corpse: gold, resources, and procedural items
function generateCorpseLoot(monster) {
  var loot = {
    gold: monster.goldDrop || 0,
    resources: {},
    items: [],
  };

  // Roll resource drops from monster's possibleLoot
  if (monster.possibleLoot && monster.possibleLoot.length > 0) {
    for (var i = 0; i < monster.possibleLoot.length; i++) {
      var entry = monster.possibleLoot[i];
      if (Math.random() < entry.chance) {
        loot.resources[entry.type] = (loot.resources[entry.type] || 0) + entry.amount;
      }
    }
  }

  // Roll procedural item drops based on level
  var level = monster.level || 1;
  var itemChance = ITEM_DROP_BASE + level * ITEM_DROP_PER_LEVEL;
  if (Math.random() < itemChance) {
    var rarity = lootGen.rollItemRarity(level);
    var pool = _buildLootPoolForLevel(level);
    if (pool.length > 0) {
      var baseType = pool[Math.floor(Math.random() * pool.length)];
      var baseDef = _getWeaponType(baseType);
      if (baseDef) {
        var item = lootGen.generateItem(baseType, baseDef, {
          source: 'drop',
          depth: level,
          forcedRarity: rarity,
        });
        if (item) {
          item.maxDurability = _getMaxDurability(baseType);
          item.durability = item.maxDurability;
          loot.items.push(item);
        }
      }
    }
  }

  // Higher level monsters: second item chance
  if (level >= 8 && Math.random() < itemChance * 0.4) {
    var rarity2 = lootGen.rollItemRarity(level);
    var pool2 = _buildLootPoolForLevel(level);
    if (pool2.length > 0) {
      var baseType2 = pool2[Math.floor(Math.random() * pool2.length)];
      var baseDef2 = _getWeaponType(baseType2);
      if (baseDef2) {
        var item2 = lootGen.generateItem(baseType2, baseDef2, {
          source: 'drop',
          depth: level,
          forcedRarity: rarity2,
        });
        if (item2) {
          item2.maxDurability = _getMaxDurability(baseType2);
          item2.durability = item2.maxDurability;
          loot.items.push(item2);
        }
      }
    }
  }

  return loot;
}

// Build a level-appropriate loot pool (reuses equipment-data WEAPON_TYPES)
function _buildLootPoolForLevel(level) {
  if (!accounts || !accounts.WEAPON_TYPES) return [];
  var pool = [];
  var maxRarity = 'common';
  if (level >= 20) maxRarity = 'ultra_rare';
  else if (level >= 12) maxRarity = 'rare';
  else if (level >= 5) maxRarity = 'uncommon';

  var rarityOrder = { common: 0, uncommon: 1, rare: 2, ultra_rare: 3, mythic_rare: 4, legendary: 5 };
  var maxVal = rarityOrder[maxRarity] || 0;

  for (var wt in accounts.WEAPON_TYPES) {
    var def = accounts.WEAPON_TYPES[wt];
    if (!def.slot) continue;
    if (def.slot === 'backpack' || def.slot === 'rig') continue;
    var defVal = rarityOrder[def.rarity] || 0;
    if (defVal <= maxVal + 1) pool.push(wt);
  }
  if (pool.length === 0) pool.push('iron_sword');
  return pool;
}

function _getWeaponType(type) {
  return accounts && accounts.WEAPON_TYPES ? accounts.WEAPON_TYPES[type] : null;
}

function _getMaxDurability(type) {
  return accounts && accounts.getMaxDurability ? accounts.getMaxDurability(type) : 100;
}

// Create a corpse from a killed monster and add to zone
function spawnCorpse(zoneId, monster) {
  var corpses = state.zoneCorpses.get(zoneId);
  if (!corpses) {
    corpses = [];
    state.zoneCorpses.set(zoneId, corpses);
  }

  // Evict oldest if at cap
  while (corpses.length >= MAX_CORPSES_PER_ZONE) {
    var old = corpses.shift();
    io.to('zone:' + zoneId).emit('zone_corpse_removed', { id: old.id });
  }

  var loot = generateCorpseLoot(monster);
  var now = Date.now();

  var corpse = {
    id: generateCorpseId(),
    name: (monster.name || 'Unknown') + ' Remains',
    x: monster.x,
    y: monster.y,
    level: monster.level || 1,
    loot: loot,
    createdAt: now,
    despawnAt: now + CORPSE_DESPAWN_MS,
  };

  corpses.push(corpse);

  // Broadcast to zone
  io.to('zone:' + zoneId).emit('zone_corpse_spawned', {
    id: corpse.id,
    name: corpse.name,
    x: corpse.x,
    y: corpse.y,
    level: corpse.level,
    hasItems: loot.items.length > 0,
    hasGold: loot.gold > 0,
  });

  return corpse;
}

// ---------------------------------------------------------------------------
// World container generation for overworld zones
// ---------------------------------------------------------------------------

var CONTAINER_TYPES = [
  { type: 'crate',  name: 'Wooden Crate',   goldMin: 2, goldMax: 10, resourceChance: 0.6, itemChance: 0.08, weight: 30 },
  { type: 'barrel', name: 'Supply Barrel',   goldMin: 1, goldMax: 8,  resourceChance: 0.5, itemChance: 0.05, weight: 25 },
  { type: 'chest',  name: 'Abandoned Chest', goldMin: 5, goldMax: 25, resourceChance: 0.8, itemChance: 0.20, weight: 10 },
  { type: 'sack',   name: 'Supply Sack',     goldMin: 0, goldMax: 5,  resourceChance: 0.7, itemChance: 0.03, weight: 20 },
  { type: 'urn',    name: 'Dusty Urn',       goldMin: 3, goldMax: 15, resourceChance: 0.3, itemChance: 0.12, weight: 15 },
];

var CONTAINER_RESOURCES = [
  'wood', 'stone', 'iron_ore', 'herbs', 'wheat', 'mushroom',
  'fish', 'glass_sand', 'cogs', 'springs',
];

function generateContainerLoot(containerDef, zoneLevel) {
  var loot = {
    gold: containerDef.goldMin + Math.floor(Math.random() * (containerDef.goldMax - containerDef.goldMin + 1)),
    resources: {},
    items: [],
  };

  // Scale gold with zone level
  loot.gold = Math.floor(loot.gold * (1 + (zoneLevel || 1) * 0.1));

  // Roll resource
  if (Math.random() < containerDef.resourceChance) {
    var resType = CONTAINER_RESOURCES[Math.floor(Math.random() * CONTAINER_RESOURCES.length)];
    var resAmount = 1 + Math.floor(Math.random() * 3);
    loot.resources[resType] = resAmount;
  }

  // Roll procedural item
  if (Math.random() < containerDef.itemChance) {
    var depth = Math.max(1, zoneLevel || 1);
    var rarity = lootGen.rollItemRarity(depth);
    var pool = _buildLootPoolForLevel(depth);
    if (pool.length > 0) {
      var baseType = pool[Math.floor(Math.random() * pool.length)];
      var baseDef = _getWeaponType(baseType);
      if (baseDef) {
        var item = lootGen.generateItem(baseType, baseDef, {
          source: 'chest',
          depth: depth,
          forcedRarity: rarity,
        });
        if (item) {
          item.maxDurability = _getMaxDurability(baseType);
          item.durability = item.maxDurability;
          loot.items.push(item);
        }
      }
    }
  }

  return loot;
}

// Spawn a single world container at position
function spawnWorldContainer(zoneId, x, y, zoneLevel) {
  var containers = state.zoneWorldContainers.get(zoneId);
  if (!containers) {
    containers = [];
    state.zoneWorldContainers.set(zoneId, containers);
  }
  if (containers.length >= MAX_CONTAINERS_PER_ZONE) return null;

  // Pick container type
  var totalW = 0;
  for (var i = 0; i < CONTAINER_TYPES.length; i++) totalW += CONTAINER_TYPES[i].weight;
  var roll = Math.random() * totalW;
  var cum = 0;
  var def = CONTAINER_TYPES[0];
  for (var j = 0; j < CONTAINER_TYPES.length; j++) {
    cum += CONTAINER_TYPES[j].weight;
    if (roll <= cum) { def = CONTAINER_TYPES[j]; break; }
  }

  var loot = generateContainerLoot(def, zoneLevel);
  var now = Date.now();

  var container = {
    id: generateContainerId(),
    type: def.type,
    name: def.name,
    x: x,
    y: y,
    loot: loot,
    looted: false,
    createdAt: now,
    respawnAt: now + CONTAINER_RESPAWN_MS,
  };

  containers.push(container);

  io.to('zone:' + zoneId).emit('zone_container_spawned', {
    id: container.id,
    type: container.type,
    name: container.name,
    x: container.x,
    y: container.y,
    hasItems: loot.items.length > 0,
  });

  return container;
}

// ---------------------------------------------------------------------------
// Despawn tick — runs periodically from server.js or monsters.js
// ---------------------------------------------------------------------------

function tickCorpsesDespawn() {
  if (!state || !state.zoneCorpses) return;
  var now = Date.now();
  state.zoneCorpses.forEach(function(corpses, zoneId) {
    for (var i = corpses.length - 1; i >= 0; i--) {
      if (now >= corpses[i].despawnAt) {
        var removed = corpses.splice(i, 1)[0];
        io.to('zone:' + zoneId).emit('zone_corpse_removed', { id: removed.id });
      }
    }
    if (corpses.length === 0) state.zoneCorpses.delete(zoneId);
  });
}

// ---------------------------------------------------------------------------
// Socket handler
// ---------------------------------------------------------------------------

var socketAccountMap;

function init(_io, socket, deps) {
  io = _io;
  state = deps.state;
  accounts = deps.accounts;
  socketAccountMap = deps.socketAccountMap;

  // ---- View corpse contents ----
  socket.on('loot_corpse', function(data) {
    if (!data || typeof data.corpseId !== 'string') return;
    var zoneId = state.playerZones.get(socket.id);
    if (!zoneId) return;
    var corpses = state.zoneCorpses.get(zoneId);
    if (!corpses) return;

    var corpse = null;
    for (var i = 0; i < corpses.length; i++) {
      if (corpses[i].id === data.corpseId) { corpse = corpses[i]; break; }
    }
    if (!corpse) {
      socket.emit('loot_corpse_result', { error: 'Corpse not found' });
      return;
    }

    // Proximity check (128px range)
    var pos = state.playerPositions.get(socket.id);
    if (pos) {
      var dx = pos.x - corpse.x;
      var dy = pos.y - corpse.y;
      if (dx * dx + dy * dy > 128 * 128) {
        socket.emit('loot_corpse_result', { error: 'Too far away' });
        return;
      }
    }

    socket.emit('loot_corpse_result', {
      corpseId: corpse.id,
      name: corpse.name,
      level: corpse.level,
      gold: corpse.loot.gold,
      resources: corpse.loot.resources,
      items: corpse.loot.items,
    });
  });

  // ---- Take a specific item from corpse ----
  socket.on('take_corpse_item', function(data) {
    if (!data || typeof data.corpseId !== 'string') return;
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var zoneId = state.playerZones.get(socket.id);
    if (!zoneId) return;
    var corpses = state.zoneCorpses.get(zoneId);
    if (!corpses) return;

    var corpse = null;
    var corpseIdx = -1;
    for (var i = 0; i < corpses.length; i++) {
      if (corpses[i].id === data.corpseId) { corpse = corpses[i]; corpseIdx = i; break; }
    }
    if (!corpse) return;

    // Proximity check — must be within 128px
    var _tcPos = state.playerPositions.get(socket.id);
    if (_tcPos) {
      var _tcDx = _tcPos.x - corpse.x;
      var _tcDy = _tcPos.y - corpse.y;
      if (_tcDx * _tcDx + _tcDy * _tcDy > 128 * 128) {
        socket.emit('loot_corpse_result', { error: 'Too far away' });
        return;
      }
    } else {
      return; // No known position — reject
    }

    // Take gold
    if (data.takeGold && corpse.loot.gold > 0) {
      accounts.updateChips(key, corpse.loot.gold);
      corpse.loot.gold = 0;
    }

    // Take resources
    if (data.takeResources) {
      for (var rt in corpse.loot.resources) {
        accounts.addResource(key, rt, corpse.loot.resources[rt]);
      }
      corpse.loot.resources = {};
    }

    // Take specific item by index
    if (typeof data.itemIndex === 'number') {
      var idx = data.itemIndex;
      if (idx >= 0 && idx < corpse.loot.items.length) {
        var item = corpse.loot.items[idx];
        var addResult = accounts.addMMOItem(key, item);
        if (addResult && !addResult.error) {
          corpse.loot.items.splice(idx, 1);
          socket.emit('grid_item_added', { item: item, rev: (addResult && addResult._gridRev) || 0 });
        } else {
          socket.emit('loot_corpse_result', { error: addResult ? addResult.error : 'Cannot pick up item' });
          return;
        }
      }
    }

    // Check if fully looted — remove corpse
    var isEmpty = corpse.loot.gold <= 0 &&
      Object.keys(corpse.loot.resources).length === 0 &&
      corpse.loot.items.length === 0;

    if (isEmpty) {
      corpses.splice(corpseIdx, 1);
      io.to('zone:' + zoneId).emit('zone_corpse_removed', { id: corpse.id });
    }

    // Send updated corpse state back
    socket.emit('loot_corpse_result', {
      corpseId: corpse.id,
      name: corpse.name,
      level: corpse.level,
      gold: corpse.loot.gold,
      resources: corpse.loot.resources,
      items: corpse.loot.items,
    });
  });

  // ---- Take all from corpse ----
  socket.on('take_all_corpse', function(data) {
    if (!data || typeof data.corpseId !== 'string') return;
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var zoneId = state.playerZones.get(socket.id);
    if (!zoneId) return;
    var corpses = state.zoneCorpses.get(zoneId);
    if (!corpses) return;

    var corpse = null;
    var corpseIdx = -1;
    for (var i = 0; i < corpses.length; i++) {
      if (corpses[i].id === data.corpseId) { corpse = corpses[i]; corpseIdx = i; break; }
    }
    if (!corpse) return;

    // Proximity check — must be within 128px
    var _taPos = state.playerPositions.get(socket.id);
    if (_taPos) {
      var _taDx = _taPos.x - corpse.x;
      var _taDy = _taPos.y - corpse.y;
      if (_taDx * _taDx + _taDy * _taDy > 128 * 128) {
        socket.emit('loot_corpse_result', { error: 'Too far away' });
        return;
      }
    } else {
      return; // No known position — reject
    }

    // Take gold
    if (corpse.loot.gold > 0) {
      accounts.updateChips(key, corpse.loot.gold);
      corpse.loot.gold = 0;
    }

    // Take resources
    for (var rt in corpse.loot.resources) {
      accounts.addResource(key, rt, corpse.loot.resources[rt]);
    }
    corpse.loot.resources = {};

    // Take items (skip ones that fail weight/capacity check)
    var remaining = [];
    for (var ii = 0; ii < corpse.loot.items.length; ii++) {
      var item = corpse.loot.items[ii];
      var addResult = accounts.addMMOItem(key, item);
      if (!addResult || addResult.error) {
        remaining.push(item);
      } else {
        socket.emit('grid_item_added', { item: item, rev: (addResult && addResult._gridRev) || 0 });
      }
    }
    corpse.loot.items = remaining;

    // Check if fully looted
    var isEmpty = corpse.loot.gold <= 0 &&
      Object.keys(corpse.loot.resources).length === 0 &&
      corpse.loot.items.length === 0;

    if (isEmpty) {
      corpses.splice(corpseIdx, 1);
      io.to('zone:' + zoneId).emit('zone_corpse_removed', { id: corpse.id });
    }

    socket.emit('loot_corpse_result', {
      corpseId: corpse.id,
      name: corpse.name,
      level: corpse.level,
      gold: corpse.loot.gold,
      resources: corpse.loot.resources,
      items: corpse.loot.items,
    });
  });

  // ---- View world container contents ----
  socket.on('loot_container', function(data) {
    if (!data || typeof data.containerId !== 'string') return;
    var zoneId = state.playerZones.get(socket.id);
    if (!zoneId) return;
    var containers = state.zoneWorldContainers.get(zoneId);
    if (!containers) return;

    var container = null;
    for (var i = 0; i < containers.length; i++) {
      if (containers[i].id === data.containerId) { container = containers[i]; break; }
    }
    if (!container || container.looted) {
      socket.emit('loot_container_result', { error: 'Container not found or already looted' });
      return;
    }

    // Proximity check (128px)
    var pos = state.playerPositions.get(socket.id);
    if (pos) {
      var dx = pos.x - container.x;
      var dy = pos.y - container.y;
      if (dx * dx + dy * dy > 128 * 128) {
        socket.emit('loot_container_result', { error: 'Too far away' });
        return;
      }
    }

    socket.emit('loot_container_result', {
      containerId: container.id,
      type: container.type,
      name: container.name,
      gold: container.loot.gold,
      resources: container.loot.resources,
      items: container.loot.items,
    });
  });

  // ---- Take item from world container ----
  socket.on('take_container_item', function(data) {
    if (!data || typeof data.containerId !== 'string') return;
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var zoneId = state.playerZones.get(socket.id);
    if (!zoneId) return;
    var containers = state.zoneWorldContainers.get(zoneId);
    if (!containers) return;

    var container = null;
    var containerIdx = -1;
    for (var i = 0; i < containers.length; i++) {
      if (containers[i].id === data.containerId) { container = containers[i]; containerIdx = i; break; }
    }
    if (!container || container.looted) return;

    // Take gold
    if (data.takeGold && container.loot.gold > 0) {
      accounts.updateChips(key, container.loot.gold);
      container.loot.gold = 0;
    }

    // Take resources
    if (data.takeResources) {
      for (var rt in container.loot.resources) {
        accounts.addResource(key, rt, container.loot.resources[rt]);
      }
      container.loot.resources = {};
    }

    // Take specific item
    if (typeof data.itemIndex === 'number') {
      var idx = data.itemIndex;
      if (idx >= 0 && idx < container.loot.items.length) {
        var item = container.loot.items[idx];
        var addResult = accounts.addMMOItem(key, item);
        if (addResult && !addResult.error) {
          container.loot.items.splice(idx, 1);
          socket.emit('grid_item_added', { item: item, rev: (addResult && addResult._gridRev) || 0 });
        } else {
          socket.emit('loot_container_result', { error: addResult ? addResult.error : 'Cannot pick up item' });
          return;
        }
      }
    }

    // Check if fully looted
    var isEmpty = container.loot.gold <= 0 &&
      Object.keys(container.loot.resources).length === 0 &&
      container.loot.items.length === 0;

    if (isEmpty) {
      container.looted = true;
      io.to('zone:' + zoneId).emit('zone_container_looted', { id: container.id });
    }

    socket.emit('loot_container_result', {
      containerId: container.id,
      type: container.type,
      name: container.name,
      gold: container.loot.gold,
      resources: container.loot.resources,
      items: container.loot.items,
    });
  });

  // ---- Take all from world container ----
  socket.on('take_all_container', function(data) {
    if (!data || typeof data.containerId !== 'string') return;
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var zoneId = state.playerZones.get(socket.id);
    if (!zoneId) return;
    var containers = state.zoneWorldContainers.get(zoneId);
    if (!containers) return;

    var container = null;
    for (var i = 0; i < containers.length; i++) {
      if (containers[i].id === data.containerId) { container = containers[i]; break; }
    }
    if (!container || container.looted) return;

    // Take gold
    if (container.loot.gold > 0) {
      accounts.updateChips(key, container.loot.gold);
      container.loot.gold = 0;
    }

    // Take resources
    for (var rt in container.loot.resources) {
      accounts.addResource(key, rt, container.loot.resources[rt]);
    }
    container.loot.resources = {};

    // Take items
    var remaining = [];
    for (var ii = 0; ii < container.loot.items.length; ii++) {
      var cItem = container.loot.items[ii];
      var addResult = accounts.addMMOItem(key, cItem);
      if (!addResult || addResult.error) {
        remaining.push(cItem);
      } else {
        socket.emit('grid_item_added', { item: cItem, rev: (addResult && addResult._gridRev) || 0 });
      }
    }
    container.loot.items = remaining;

    // Mark looted if empty
    var isEmpty = container.loot.gold <= 0 &&
      Object.keys(container.loot.resources).length === 0 &&
      container.loot.items.length === 0;

    if (isEmpty) {
      container.looted = true;
      io.to('zone:' + zoneId).emit('zone_container_looted', { id: container.id });
    }

    socket.emit('loot_container_result', {
      containerId: container.id,
      type: container.type,
      name: container.name,
      gold: container.loot.gold,
      resources: container.loot.resources,
      items: container.loot.items,
    });
  });
}

module.exports = {
  init: init,
  spawnCorpse: spawnCorpse,
  spawnWorldContainer: spawnWorldContainer,
  tickCorpsesDespawn: tickCorpsesDespawn,
  generateCorpseLoot: generateCorpseLoot,
  generateContainerLoot: generateContainerLoot,
  CORPSE_DESPAWN_MS: CORPSE_DESPAWN_MS,
  CONTAINER_RESPAWN_MS: CONTAINER_RESPAWN_MS,
  CONTAINER_TYPES: CONTAINER_TYPES,
};
