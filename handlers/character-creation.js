// handlers/character-creation.js
// Race selection and stat allocation handler.
// Events: race_select, stat_allocate, get_rpg_stats

var rpgData = require('../rpg-data');
var knowledgeHandler = require('./knowledge');

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, checkEventRate } = deps;

    // --- race_select: one-time race selection ---
    socket.on('race_select', function(data) {
      if (!data || typeof data.raceId !== 'string') {
        socket.emit('race_select_error', { message: 'Invalid request' });
        return;
      }

      var key = socketAccountMap.get(socket.id);
      if (!key) { socket.emit('race_select_error', { message: 'No account' }); return; }

      var result = accounts.setRace(key, data.raceId);
      if (result.error) {
        socket.emit('race_select_error', { message: result.error });
        return;
      }

      var acc = accounts.loadAccount(key);
      if (data.permadeath && acc && !acc.permadeath) {
        acc.permadeath = true;
        accounts.saveAccount(acc);
      }
      socket.emit('race_selected', {
        race: result.race,
        rpgStats: result.rpgStats,
        racialFeat: rpgData.RACES[result.race].racialFeat,
        computedStats: rpgData.computeStats(result.rpgStats, acc ? acc.level : 1, result.race),
      });

      // Fire glossary trigger for race selection
      try {
        var terms = knowledgeHandler.fireGlossaryTrigger(accounts, key, 'race_select');
        for (var i = 0; i < terms.length; i++) {
          socket.emit('knowledge_term_unlocked', terms[i]);
        }
      } catch (e) { /* glossary trigger non-fatal */ }
    });

    // --- stat_allocate: spend a free stat point ---
    socket.on('stat_allocate', function(data) {
      if (!data || typeof data.stat !== 'string') {
        socket.emit('stat_error', { message: 'Invalid stat' });
        return;
      }

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var result = accounts.allocateStatPoint(key, data.stat);
      if (result.error) {
        socket.emit('stat_error', { message: result.error });
        return;
      }

      socket.emit('stat_updated', {
        rpgStats: result.rpgStats,
        computedStats: result.computedStats,
      });
    });

    // --- get_rpg_stats: request full RPG stat info ---
    socket.on('get_rpg_stats', function() {

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      // Include equipment durability info for client display
      var durabilityInfo = accounts.getEquipmentDurability ? accounts.getEquipmentDurability(key) : {};

      socket.emit('rpg_stats', {
        race: acc.race,
        racialFeat: acc.race && rpgData.RACES[acc.race] ? rpgData.RACES[acc.race].racialFeat : null,
        rpgStats: acc.rpgStats || rpgData.getDefaultStats(),
        computedStats: rpgData.computeStats(acc.rpgStats, acc.level, acc.race),
        level: acc.level || 1,
        xp: acc.xp || 0,
        xpNeeded: rpgData.overallXpForLevel(acc.level || 1),
        cardSlots: acc.cardSlots || rpgData.getCardSlotCount(acc.level || 1),
        activeCardSlots: acc.activeCardSlots || rpgData.getActiveCardSlotCount(acc.level || 1),
        passiveCardSlots: acc.passiveCardSlots || rpgData.getPassiveCardSlotCount(acc.level || 1),
        pendingPacks: acc.pendingPacks || 0,
        skills: acc.skills || rpgData.getDefaultSkills(),
        durability: durabilityInfo,
        awakenings: acc.awakenings || [],
        primaryResource: acc.race ? rpgData.RACE_PRIMARY_RESOURCE[acc.race] : null,
        ascensionMark: !!acc.ascensionMark,
      });
    });

    // --- get_race_list: client requests all available races ---
    socket.on('get_race_list', function() {

      var races = [];
      for (var raceId in rpgData.RACES) {
        var r = rpgData.RACES[raceId];
        races.push({
          id: r.id,
          name: r.name,
          lifespan: r.lifespan,
          statBumps: r.statBumps,
          racialFeat: r.racialFeat,
          loreSource: r.loreSource,
          iconPath: r.iconPath,
          primaryResource: rpgData.RACE_PRIMARY_RESOURCE[raceId],
        });
      }
      socket.emit('race_list', {
        races: races,
        statNames: rpgData.STAT_NAMES,
        baseStatValue: rpgData.BASE_STAT_VALUE,
        freePoints: rpgData.FREE_POINTS_AT_CREATION,
      });
    });

    // --- set_mount: change current mount ---
    socket.on('set_mount', function(data) {
      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var mountType = (data && typeof data.mount === 'string') ? data.mount : null;
      // Validate mount type (null = dismount)
      if (mountType && !rpgData.WATER_MOUNTS.has(mountType) && ['horse', 'caravan'].indexOf(mountType) === -1) {
        socket.emit('mount_error', { message: 'Invalid mount type' });
        return;
      }

      // All mounts require the item in inventory (not consumed)
      if (mountType) {
        var inv = accounts.getMMOInventory(key);
        if (!inv || !inv.items) {
          socket.emit('mount_error', { message: 'Inventory not found' });
          return;
        }
        var hasItem = false;
        for (var mi = 0; mi < inv.items.length; mi++) {
          if (inv.items[mi].type === mountType) { hasItem = true; break; }
        }
        if (!hasItem) {
          socket.emit('mount_error', { message: 'You need a ' + mountType + ' in your inventory to use it as a mount' });
          return;
        }
      }

      accounts.setMount(key, mountType);
      socket.emit('mount_changed', { mount: mountType });
    });

    // --- equip_item: equip a weapon/shield/armor/accessory ---
    socket.on('equip_item', function(data) {
      if (!data || typeof data.slot !== 'string' || typeof data.itemId !== 'string') {
        socket.emit('equip_error', { message: 'Invalid request' });
        return;
      }

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var result = accounts.equipMMOItem(key, data.slot, data.itemId);
      if (!result) {
        socket.emit('equip_error', { message: 'Cannot equip item in that slot' });
        return;
      }
      if (result.error) {
        socket.emit('equip_error', { message: result.error });
        return;
      }

      var equipDurability = accounts.getEquipmentDurability ? accounts.getEquipmentDurability(key) : {};
      var combo = accounts.getDualWieldCombo ? accounts.getDualWieldCombo(key) : null;
      socket.emit('equipment_updated', { equipment: result, durability: equipDurability, dualWieldCombo: combo });
    });

    // --- unequip_item: remove a weapon/shield/armor/accessory ---
    socket.on('unequip_item', function(data) {
      if (!data || typeof data.slot !== 'string') {
        socket.emit('equip_error', { message: 'Invalid request' });
        return;
      }

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var result = accounts.unequipMMOItem(key, data.slot);
      if (!result) {
        socket.emit('equip_error', { message: 'Cannot unequip from that slot' });
        return;
      }

      var unequipDurability = accounts.getEquipmentDurability ? accounts.getEquipmentDurability(key) : {};
      var combo = accounts.getDualWieldCombo ? accounts.getDualWieldCombo(key) : null;
      socket.emit('equipment_updated', { equipment: result, durability: unequipDurability, dualWieldCombo: combo });
    });

    // --- get_equipment: request current equipment ---
    socket.on('get_equipment', function() {

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var equipment = accounts.getEquipment(key);
      var getDurability = accounts.getEquipmentDurability ? accounts.getEquipmentDurability(key) : {};
      var combo = accounts.getDualWieldCombo ? accounts.getDualWieldCombo(key) : null;
      socket.emit('equipment_updated', { equipment: equipment, durability: getDurability, dualWieldCombo: combo });
    });

    // --- select_awakening: choose a milestone ability ---
    socket.on('select_awakening', function(data) {
      if (!data || typeof data.awakeningId !== 'string') {
        socket.emit('awakening_error', { message: 'Invalid request' });
        return;
      }

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var result = accounts.selectAwakening(key, data.awakeningId);
      if (result.error) {
        socket.emit('awakening_error', { message: result.error });
        return;
      }

      socket.emit('awakening_selected', result);
    });

    // --- get_available_awakenings: check what's available ---
    socket.on('get_available_awakenings', function() {
      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      var available = rpgData.getAvailableAwakenings(
        acc.level || 1,
        acc.rpgStats || rpgData.getDefaultStats(),
        acc.awakenings || []
      );

      socket.emit('available_awakenings', {
        available: available,
        chosen: acc.awakenings || [],
      });
    });
  }
};
