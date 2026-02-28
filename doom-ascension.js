// doom-ascension.js
// Doom Ascension System — world reset when corruption consumes Solara.
//
// When the lich's corruption reaches Solara (where Helios is sealed beneath
// the Cathedral District), a 48-hour real-time countdown begins. If the
// countdown expires, the world doom-ascends: all material goods are wiped
// (gear, inventory, gold, resources, guild vaults, chest storage) while
// progression is preserved (levels, skills, cards, mastery, knowledge).
//
// The countdown is stoppable — push corruption out of Solara and the clock
// pauses. But each pushback increases scaling pressure. Eventually doom
// becomes inevitable unless the lich raid boss is killed.

'use strict';

var _io = null;
var _state = null;
var _accounts = null;
var _directors = null;  // { lich, vampire, werewolf, raids, rifts, structures }

function init(io, state, accounts, directors) {
  _io = io;
  _state = state;
  _accounts = accounts;
  _directors = directors;
}

// ---------------------------------------------------------------------------
// Account wipe — strips material goods, preserves progression
// ---------------------------------------------------------------------------

function doomWipeAccount(account) {
  if (!account) return;

  // Preserve hidden pocket before wipe (persists across doom-ascension)
  var savedPocketLegacy = account.hiddenPocketLegacy || null;

  // Wipe material goods
  account.equipment = { axe: null, pickaxe: null };
  account.mmoInventory = { wood: 0, stone: 0, iron_ore: 0, iron_bar: 0, items: [] };
  account.chips = 0;
  account.mount = null;
  account.pendingCrafts = [];
  account.grid = null;
  account.pocket = null;

  // Restore hidden pocket legacy (survives doom wipe)
  account.hiddenPocketLegacy = savedPocketLegacy;

  // Reset active quests (completed history preserved)
  if (account.questProgress && account.questProgress.active) {
    account.questProgress.active = [];
  }

  // Preserved:
  //   level, xp, skills, rpgStats, rpgCards, equippedCards, cardSlots,
  //   activeCardSlots, passiveCardSlots, pendingPacks, pityPullsSinceLegendary,
  //   knowledge, plotId, craftingRecipes, skillMasteryPoints, skillMasteryNodes,
  //   ascensionCount, ascensionPoints, ascensionTree, ascensionMark,
  //   dungeonProgress, karma, factionRep, townReputation, npcRelationships,
  //   race, awakenings, permadeath, petData, activePet, companions,
  //   bankVault (fully preserved — strategic doom banking),
  //   hiddenPocketLegacy (pocket items survive doom wipe for next character)
}

// ---------------------------------------------------------------------------
// Guild vault wipe
// ---------------------------------------------------------------------------

function wipeAllGuildVaults(state, saveGuildFn) {
  if (!state || !state.guilds) return 0;
  var wiped = 0;
  state.guilds.forEach(function(guild) {
    if (!guild.vault) return;
    guild.vault.cards = [];
    guild.vault.resources = {};
    wiped++;
    if (saveGuildFn) saveGuildFn(guild);
  });
  if (wiped > 0) console.log('[doom] Wiped ' + wiped + ' guild vaults');
  return wiped;
}

// ---------------------------------------------------------------------------
// Chest storage wipe — clear all storage_chest contents in placed objects
// ---------------------------------------------------------------------------

function wipeAllChestContents(state) {
  if (!state || !state.zones) return 0;
  var wiped = 0;
  state.zones.forEach(function(zone) {
    if (!zone.placedObjects) return;
    for (var i = 0; i < zone.placedObjects.length; i++) {
      var obj = zone.placedObjects[i];
      if (obj.type === 'storage_chest' && obj.contents && obj.contents.length > 0) {
        obj.contents = [];
        wiped++;
      }
    }
  });
  if (wiped > 0) console.log('[doom] Wiped contents of ' + wiped + ' storage chests');
  return wiped;
}

// ---------------------------------------------------------------------------
// World state reset
// ---------------------------------------------------------------------------

function resetWorldState(state) {
  // Calendar: advance year, reset to month 1 day 1
  state.world.calendar.year += 1;
  state.world.calendar.month = 1;
  state.world.calendar.day = 1;
  var CALENDAR_MONTHS = state.CALENDAR_MONTHS;
  if (CALENDAR_MONTHS && CALENDAR_MONTHS[0]) {
    state.world.calendar.monthName = CALENDAR_MONTHS[0].name;
    state.world.calendar.season = CALENDAR_MONTHS[0].season;
  }
  state.world.calendar.lastAdvancedAt = Date.now();

  // Doom counter
  state.world.doomAscensionCount = (state.world.doomAscensionCount || 0) + 1;

  // Seasonal world regeneration — new doom cycle produces new definitions
  try {
    var seasonal = require('./seasonal');
    var worldgen = require('./worldgen');
    state.world.seasonSeed = worldgen.chunkSeed(state.world.doomAscensionCount, 0, 'mmolite_season');
    seasonal.generate(state.world.seasonSeed, state.world.calendar.season);
    seasonal.apply();
    console.log('[doom] Seasonal world regenerated for doom cycle #' + state.world.doomAscensionCount);
  } catch (err) {
    console.error('[doom] Seasonal regeneration failed:', err.message);
  }

  // Director macro state
  if (state.world.directorState) {
    state.world.directorState.globalTensionScore = 0;
    state.world.directorState.activeWorldEvents = [];
  }

  // Wipe ephemeral (sessions, instances, parties)
  state.wipeEphemeral();
}

// ---------------------------------------------------------------------------
// Execute doom ascension — the full sequence
// ---------------------------------------------------------------------------

var _executing = false;

function execute(callback) {
  if (_executing) return;
  _executing = true;

  var doomCount = (_state.world.doomAscensionCount || 0) + 1;
  console.log('[doom] === DOOM ASCENSION #' + doomCount + ' EXECUTING ===');

  // 1. Broadcast warning
  if (_io) {
    _io.emit('doom_ascension_event', {
      doomAscensionCount: doomCount,
      message: 'The corruption has consumed Helios. The divine seal shatters. The world... resets.',
    });
  }

  // 2. Delay for dramatic effect, then execute wipe
  setTimeout(function() {
    try {
      _executeWipe(doomCount);
    } catch (err) {
      console.error('[doom] Execution error:', err.message);
    }
    _executing = false;
    if (callback) callback();
  }, 10000);
}

function _executeWipe(doomCount) {
  // 1. Flush all pending account writes
  _accounts.flushAll();

  // 2. Kick all players
  if (_io) {
    _io.disconnectSockets(true);
  }

  // 3. Wipe all accounts via encrypted pipeline (handles AES-256-GCM on production)
  var wiped = _accounts.iterateAllAccounts(doomWipeAccount);
  console.log('[doom] Wiped ' + wiped + ' accounts through encrypted pipeline');

  // 4. Wipe guild vaults
  wipeAllGuildVaults(_state);

  // 5. Wipe chest contents
  wipeAllChestContents(_state);

  // 6. Reset world state + all directors
  resetWorldState(_state);

  if (_directors) {
    if (_directors.lich && _directors.lich.reset) _directors.lich.reset();
    if (_directors.vampire && _directors.vampire.reset) _directors.vampire.reset();
    if (_directors.werewolf && _directors.werewolf.reset) _directors.werewolf.reset();
    if (_directors.raids && _directors.raids.reset) _directors.raids.reset();
    if (_directors.rifts && _directors.rifts.reset) _directors.rifts.reset();
    if (_directors.structures && _directors.structures.reset) _directors.structures.reset();
    if (_directors.disease && _directors.disease.reset) _directors.disease.reset();
    if (_directors.weather && _directors.weather.reset) _directors.weather.reset();
    if (_directors.influence && _directors.influence.reset) _directors.influence.reset();
    if (_directors.ecology && _directors.ecology.revertAll) _directors.ecology.revertAll();
    if (_directors.patrol && _directors.patrol.reset) _directors.patrol.reset();
  }

  // 7. Save director state
  if (_directors && _directors.saveState) _directors.saveState();

  console.log('[doom] === DOOM ASCENSION #' + doomCount + ' COMPLETE ===');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  init: init,
  execute: execute,
  doomWipeAccount: doomWipeAccount,
  wipeAllGuildVaults: wipeAllGuildVaults,
  wipeAllChestContents: wipeAllChestContents,
  resetWorldState: resetWorldState,
};
