// account-characters.js — Multi-character slots, Hall of Heroes, leviathan tracking
// Needs loadAccount, saveAccount, _getDefaultForField, CHARACTER_FIELDS,
// MAX_CHARACTERS_PER_ACCOUNT, sanitizeName via init(deps).

var loadAccount;
var saveAccount;
var _getDefaultForField;
var CHARACTER_FIELDS;
var MAX_CHARACTERS_PER_ACCOUNT;
var sanitizeName;
var _vipPerks = require('./vip-perks');
var _getCachedVipStatus = null;

function init(deps) {
  loadAccount = deps.loadAccount;
  saveAccount = deps.saveAccount;
  _getDefaultForField = deps._getDefaultForField;
  CHARACTER_FIELDS = deps.CHARACTER_FIELDS;
  MAX_CHARACTERS_PER_ACCOUNT = deps.MAX_CHARACTERS_PER_ACCOUNT;
  sanitizeName = deps.sanitizeName;
}

function setVipStatusFn(fn) {
  _getCachedVipStatus = fn;
}

function _getEffectiveMaxCharacters(key) {
  if (_getCachedVipStatus) {
    var vipStatus = _getCachedVipStatus(key);
    if (vipStatus && vipStatus.permanentPurchases) {
      return _vipPerks.getMaxCharacterSlots(vipStatus.permanentPurchases);
    }
  }
  return MAX_CHARACTERS_PER_ACCOUNT;
}

// Extract character-specific fields from account top level into a plain object
function _extractCharacterData(account) {
  var charData = {};
  for (var i = 0; i < CHARACTER_FIELDS.length; i++) {
    var field = CHARACTER_FIELDS[i];
    charData[field] = account[field] !== undefined ? account[field] : _getDefaultForField(field);
  }
  // Preserve character metadata
  charData.name = account._characterName || account.username || 'Character';
  charData.createdAt = account._characterCreatedAt || account.createdAt;
  return charData;
}

// Apply a character object's fields to the account top level (swap-in)
function _applyCharacterData(account, charData) {
  for (var i = 0; i < CHARACTER_FIELDS.length; i++) {
    var field = CHARACTER_FIELDS[i];
    account[field] = charData[field] !== undefined ? charData[field] : _getDefaultForField(field);
  }
  account._characterName = charData.name || account.username || 'Character';
  account._characterCreatedAt = charData.createdAt || Date.now();
}

// Get a summary of a character for the character list
function _getCharacterSummary(charData, index) {
  return {
    index: index,
    name: charData.name || 'Character',
    race: charData.race || null,
    level: charData.level || 1,
    guildId: charData.guildId || null,
    createdAt: charData.createdAt || 0,
    hasPlot: !!charData.plotId,
    permadeath: !!charData.permadeath,
  };
}

// Lazy migration: wrap existing top-level character data into characters[0]
function _migrateToMultiCharacter(account) {
  if (!account.hallOfHeroes) account.hallOfHeroes = [];
  if (account.characters) return; // already migrated
  var charData = {};
  for (var i = 0; i < CHARACTER_FIELDS.length; i++) {
    var field = CHARACTER_FIELDS[i];
    charData[field] = account[field] !== undefined ? account[field] : _getDefaultForField(field);
  }
  charData.name = account.username || 'Character';
  charData.createdAt = account.createdAt || Date.now();
  account.characters = [charData];
  account.activeCharacterIndex = 0;
  account.maxCharacters = MAX_CHARACTERS_PER_ACCOUNT;
  account._characterName = charData.name;
  account._characterCreatedAt = charData.createdAt;
}

function createCharacter(key, characterName, options) {
  var account = loadAccount(key);
  if (!account) return { error: 'Account not found' };
  _migrateToMultiCharacter(account);
  var _effectiveMax = _getEffectiveMaxCharacters(key);
  if (account.characters.length >= _effectiveMax) {
    return { error: 'Max characters reached (' + _effectiveMax + ')' };
  }
  var safeName = sanitizeName(characterName || 'New Character').slice(0, 20) || 'New Character';
  var charData = {};
  for (var i = 0; i < CHARACTER_FIELDS.length; i++) {
    charData[CHARACTER_FIELDS[i]] = _getDefaultForField(CHARACTER_FIELDS[i]);
  }
  charData.name = safeName;
  charData.createdAt = Date.now();
  if (options && options.permadeath) {
    charData.permadeath = true;
  }
  account.characters.push(charData);
  saveAccount(account);
  return { success: true, characterIndex: account.characters.length - 1 };
}

function switchCharacter(key, targetIndex) {
  var account = loadAccount(key);
  if (!account) return { error: 'Account not found' };
  _migrateToMultiCharacter(account);
  if (targetIndex < 0 || targetIndex >= account.characters.length) {
    return { error: 'Invalid character index' };
  }
  if (targetIndex === account.activeCharacterIndex) {
    return { error: 'Already on this character' };
  }
  // Save current character back into array
  var currentIdx = account.activeCharacterIndex;
  var currentChar = account.characters[currentIdx];
  for (var i = 0; i < CHARACTER_FIELDS.length; i++) {
    var field = CHARACTER_FIELDS[i];
    currentChar[field] = account[field] !== undefined ? account[field] : _getDefaultForField(field);
  }
  currentChar.name = account._characterName || currentChar.name;
  currentChar.createdAt = account._characterCreatedAt || currentChar.createdAt;
  // Promote target character to top level
  var targetChar = account.characters[targetIndex];
  _applyCharacterData(account, targetChar);
  account.activeCharacterIndex = targetIndex;
  saveAccount(account);
  return { success: true, activeCharacterIndex: targetIndex };
}

function deleteCharacter(key, targetIndex) {
  var account = loadAccount(key);
  if (!account) return { error: 'Account not found' };
  _migrateToMultiCharacter(account);
  if (account.characters.length <= 1) {
    return { error: 'Cannot delete last character' };
  }
  if (targetIndex < 0 || targetIndex >= account.characters.length) {
    return { error: 'Invalid character index' };
  }
  account.characters.splice(targetIndex, 1);
  // Adjust activeCharacterIndex after splice
  if (account.activeCharacterIndex === targetIndex) {
    // Deleted the active character: promote the replacement to the top-level
    // fields, same as switchCharacter — otherwise the deleted character's
    // data stays live and gets written over the new slot on the next switch.
    var newIdx = targetIndex < account.characters.length ? targetIndex : account.characters.length - 1;
    account.activeCharacterIndex = newIdx;
    _applyCharacterData(account, account.characters[newIdx]);
  } else if (account.activeCharacterIndex > targetIndex) {
    account.activeCharacterIndex--;
  }
  saveAccount(account);
  return { success: true, activeCharacterIndex: account.activeCharacterIndex };
}

function getCharacterList(key) {
  var account = loadAccount(key);
  if (!account) return null;
  _migrateToMultiCharacter(account);
  var list = [];
  for (var i = 0; i < account.characters.length; i++) {
    list.push(_getCharacterSummary(account.characters[i], i));
  }
  return {
    characters: list,
    activeCharacterIndex: account.activeCharacterIndex,
    maxCharacters: _getEffectiveMaxCharacters(key),
  };
}

// ---------------------------------------------------------------------------
// Hall of Heroes — permadeath memorial archive
// ---------------------------------------------------------------------------

var MAX_HALL_OF_HEROES = 50;

function archiveToHallOfHeroes(key, heroSnapshot) {
  var account = loadAccount(key);
  if (!account) return null;
  if (!account.hallOfHeroes) account.hallOfHeroes = [];
  account.hallOfHeroes.push(heroSnapshot);
  // FIFO: keep only the most recent MAX_HALL_OF_HEROES entries
  while (account.hallOfHeroes.length > MAX_HALL_OF_HEROES) {
    account.hallOfHeroes.shift();
  }
  saveAccount(account);
  return account.hallOfHeroes;
}

function getHallOfHeroes(key) {
  var account = loadAccount(key);
  if (!account) return [];
  if (!account.hallOfHeroes) account.hallOfHeroes = [];
  return account.hallOfHeroes;
}

// Delete the active character for permadeath (can delete last/active character)
// Switches to next available character or sets activeCharacterIndex = -1 if none left.
function deleteActiveCharacterForPermadeath(key) {
  var account = loadAccount(key);
  if (!account) return { error: 'Account not found' };
  _migrateToMultiCharacter(account);

  var idx = account.activeCharacterIndex;
  if (idx < 0 || idx >= account.characters.length) {
    return { error: 'No active character' };
  }

  account.characters.splice(idx, 1);

  if (account.characters.length === 0) {
    // No characters left — set sentinel value
    account.activeCharacterIndex = -1;
    // Clear top-level character fields
    for (var i = 0; i < CHARACTER_FIELDS.length; i++) {
      account[CHARACTER_FIELDS[i]] = _getDefaultForField(CHARACTER_FIELDS[i]);
    }
    account._characterName = null;
    account._characterCreatedAt = null;
  } else {
    // Switch to the next valid character (or first if we were at end)
    var newIdx = idx < account.characters.length ? idx : account.characters.length - 1;
    account.activeCharacterIndex = newIdx;
    _applyCharacterData(account, account.characters[newIdx]);
  }

  saveAccount(account);
  return {
    success: true,
    hasCharactersLeft: account.characters.length > 0,
    activeCharacterIndex: account.activeCharacterIndex,
  };
}

function incrementLeviathanKill(key, leviathanId) {
  var account = loadAccount(key);
  if (!account) return null;
  if (!account.leviathanKills) account.leviathanKills = {};
  if (!account.leviathanKills[leviathanId]) account.leviathanKills[leviathanId] = 0;
  account.leviathanKills[leviathanId]++;
  account.leviathanTotalKills = (account.leviathanTotalKills || 0) + 1;
  saveAccount(account);
  return account;
}

module.exports = {
  init: init,
  setVipStatusFn: setVipStatusFn,
  _extractCharacterData: _extractCharacterData,
  _applyCharacterData: _applyCharacterData,
  _getCharacterSummary: _getCharacterSummary,
  _migrateToMultiCharacter: _migrateToMultiCharacter,
  createCharacter: createCharacter,
  switchCharacter: switchCharacter,
  deleteCharacter: deleteCharacter,
  getCharacterList: getCharacterList,
  archiveToHallOfHeroes: archiveToHallOfHeroes,
  getHallOfHeroes: getHallOfHeroes,
  deleteActiveCharacterForPermadeath: deleteActiveCharacterForPermadeath,
  incrementLeviathanKill: incrementLeviathanKill,
};
