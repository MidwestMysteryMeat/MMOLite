// account-rpg-cards.js — RPG card collection, equip/unequip, fusion, pack opening
// Needs loadAccount, saveAccount, _spreadMutation via init(deps).

var rpgData = require('./rpg-data');

var loadAccount;
var saveAccount;
var _spreadMutation;

// Equipped card effects cache (avoids re-scanning cards on every XP grant)
var _cardEffectsCache = new Map(); // key -> { effects: [...], ts: Date.now() }
var CARD_EFFECTS_TTL = 15000; // 15 second TTL

function invalidateCardEffectsCache(key) {
  _cardEffectsCache.delete(key);
}

// Per-account pack lock for concurrent pack opens
var _packLocks = new Map();

// Per-account card lock for general card array mutations
var _cardLocks = new Map();

function init(deps) {
  loadAccount = deps.loadAccount;
  saveAccount = deps.saveAccount;
  _spreadMutation = deps._spreadMutation;
}

// ---------------------------------------------------------------------------
// TCG Card collection (badge cards, not RPG cards)
// ---------------------------------------------------------------------------

function addCard(key, cardInstance) {
  var account = loadAccount(key);
  if (!account) return null;
  if (!account.cards) account.cards = [];
  if (account.cards.length >= MAX_CARDS) return { error: 'Card collection full (' + MAX_CARDS + ' max)' };
  account.cards.push({
    id: cardInstance.instanceId,
    cardId: cardInstance.cardId,
    rolledStats: cardInstance.rolledStats || null,
    shiny: cardInstance.shiny || false,
    obtainedAt: cardInstance.obtainedAt || Date.now(),
    source: cardInstance.source || 'unknown',
  });
  saveAccount(account);
  return account.cards;
}

var MAX_CARDS = 500;

function removeCard(key, instanceId) {
  var account = loadAccount(key);
  if (!account || !account.cards) return null;
  var idx = -1;
  for (var i = 0; i < account.cards.length; i++) {
    if (account.cards[i].id === instanceId) { idx = i; break; }
  }
  if (idx === -1) return null;
  var removed = account.cards.splice(idx, 1)[0];
  saveAccount(account);
  return removed;
}

function getCards(key) {
  var account = loadAccount(key);
  if (!account) return [];
  return account.cards || [];
}

// ---------------------------------------------------------------------------
// Lock helpers
// ---------------------------------------------------------------------------

function _acquirePackLock(key) {
  var entry = _packLocks.get(key);
  if (!entry) {
    entry = { depth: 0 };
    _packLocks.set(key, entry);
  }
  entry.depth++;
  return function release() {
    entry.depth--;
    if (entry.depth <= 0) {
      _packLocks.delete(key);
    }
  };
}

function acquireCardLock(key) {
  var entry = _cardLocks.get(key);
  if (!entry) {
    entry = { depth: 0 };
    _cardLocks.set(key, entry);
  }
  entry.depth++;
  return function release() {
    entry.depth--;
    if (entry.depth <= 0) {
      _cardLocks.delete(key);
    }
  };
}

function releaseCardLock(releaseFn) {
  if (typeof releaseFn === 'function') releaseFn();
}

// ---------------------------------------------------------------------------
// RPG: Card pack management
// ---------------------------------------------------------------------------

function addPendingPack(key, count) {
  var account = loadAccount(key);
  if (!account) return null;
  account.pendingPacks = (account.pendingPacks || 0) + (count || 1);
  saveAccount(account);
  return account.pendingPacks;
}

function openPendingPack(key) {
  var release = _acquirePackLock(key);
  try {
    var account = loadAccount(key);
    if (!account) return { error: 'Account not found' };
    if ((account.pendingPacks || 0) <= 0) return { error: 'No packs to open' };
    if (!account.rpgCards) account.rpgCards = [];
    if (account.rpgCards.length >= rpgData.MAX_CARD_COLLECTION) return { error: 'Card collection full' };

    var pity = typeof account.pityPullsSinceLegendary === 'number' ? account.pityPullsSinceLegendary : 0;

    // Sum luck_bonus and card_luck_bonus from equipped cards
    var packLuckBonus = 0;
    var cardEffectsForPack = getEquippedCardEffects(key);
    for (var li = 0; li < cardEffectsForPack.length; li++) {
      if (cardEffectsForPack[li].type === 'luck_bonus') packLuckBonus += (cardEffectsForPack[li].value || 0);
      if (cardEffectsForPack[li].type === 'card_luck_bonus') packLuckBonus += (cardEffectsForPack[li].value || 0);
    }

    var result = rpgData.openCardPack(account.race, pity, packLuckBonus);
    var cards = result.cards;
    account.pityPullsSinceLegendary = result.pityPullsSinceLegendary;

    var addedCards = [];

    for (var i = 0; i < cards.length; i++) {
      if (account.rpgCards.length >= rpgData.MAX_CARD_COLLECTION) break;
      account.rpgCards.push(cards[i]);
      addedCards.push(cards[i]);
    }

    account.pendingPacks--;
    saveAccount(account);
    return { success: true, cards: addedCards, pendingPacks: account.pendingPacks };
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// RPG: Card equip/unequip
// ---------------------------------------------------------------------------

function equipRpgCard(key, cardInstanceId, slotIndex) {
  var account = loadAccount(key);
  if (!account) return { error: 'Account not found' };
  if (!account.rpgCards) account.rpgCards = [];
  if (!account.equippedCards) account.equippedCards = [];
  _migrateEquippedCards(account);

  // Find card in collection
  var card = null;
  for (var i = 0; i < account.rpgCards.length; i++) {
    if (account.rpgCards[i].instanceId === cardInstanceId) { card = account.rpgCards[i]; break; }
  }
  if (!card) return { error: 'Card not found in collection' };

  // Determine card type from template
  var tmpl = rpgData.CARD_BY_ID[card.cardId] || {};
  var cardType = tmpl.type || card.type || 'passive_perk';
  var isActive = rpgData.isActiveCardType(cardType);

  // Count currently equipped active vs passive cards
  var activeCount = 0, passiveCount = 0;
  for (var ci = 0; ci < account.equippedCards.length; ci++) {
    var eqId = account.equippedCards[ci];
    if (!eqId) continue;
    var eqCardType = _getEquippedCardType(account, eqId);
    if (rpgData.isActiveCardType(eqCardType)) activeCount++;
    else passiveCount++;
  }

  // Get slot limits
  var activeSlots = account.activeCardSlots || rpgData.getActiveCardSlotCount(account.level || 1);
  var passiveSlots = account.passiveCardSlots || rpgData.getPassiveCardSlotCount(account.level || 1);

  // Check if already equipped — unequip first
  var wasEquipped = false;
  for (var j = 0; j < account.equippedCards.length; j++) {
    if (account.equippedCards[j] === cardInstanceId) {
      account.equippedCards.splice(j, 1);
      // Adjust counts since we removed it
      if (isActive) activeCount--;
      else passiveCount--;
      wasEquipped = true;
      break;
    }
  }

  // Validate slot availability for this card type
  if (isActive && activeCount >= activeSlots) return { error: 'No active card slots available (have ' + activeCount + '/' + activeSlots + ')' };
  if (!isActive && passiveCount >= passiveSlots) return { error: 'No passive card slots available (have ' + passiveCount + '/' + passiveSlots + ')' };

  account.equippedCards.push(cardInstanceId);
  _cardEffectsCache.delete(key);
  saveAccount(account);
  return { success: true, equippedCards: account.equippedCards, activeCardSlots: activeSlots, passiveCardSlots: passiveSlots };
}

function unequipRpgCard(key, cardInstanceId) {
  var account = loadAccount(key);
  if (!account) return { error: 'Account not found' };
  if (!account.equippedCards) return { error: 'No equipped cards' };
  _migrateEquippedCards(account);

  // Support both old slot-index and new instanceId-based unequip
  if (typeof cardInstanceId === 'number') {
    // Legacy: slot-index based (remove the card at that index)
    if (cardInstanceId < 0 || cardInstanceId >= account.equippedCards.length) return { error: 'Invalid slot' };
    account.equippedCards.splice(cardInstanceId, 1);
  } else {
    // New: instance-ID based
    var idx = account.equippedCards.indexOf(cardInstanceId);
    if (idx === -1) return { error: 'Card not equipped' };
    account.equippedCards.splice(idx, 1);
  }

  _cardEffectsCache.delete(key);
  saveAccount(account);
  return { success: true, equippedCards: account.equippedCards };
}

// Helper: get card type for an equipped instance ID
function _getEquippedCardType(account, instanceId) {
  for (var i = 0; i < account.rpgCards.length; i++) {
    if (account.rpgCards[i].instanceId === instanceId) {
      var tmpl = rpgData.CARD_BY_ID[account.rpgCards[i].cardId] || {};
      return tmpl.type || account.rpgCards[i].type || 'passive_perk';
    }
  }
  return 'passive_perk';
}

// Migration: convert old null-padded slot-indexed arrays to clean ID arrays
function _migrateEquippedCards(account) {
  if (!account.equippedCards || !Array.isArray(account.equippedCards)) {
    account.equippedCards = [];
    return;
  }
  // Remove null entries (from old slot-indexed format)
  var hasNulls = false;
  for (var i = 0; i < account.equippedCards.length; i++) {
    if (account.equippedCards[i] === null || account.equippedCards[i] === undefined) {
      hasNulls = true;
      break;
    }
  }
  if (hasNulls) {
    var clean = [];
    for (var j = 0; j < account.equippedCards.length; j++) {
      if (account.equippedCards[j]) clean.push(account.equippedCards[j]);
    }
    account.equippedCards = clean;
  }
  // Ensure split slot counts exist
  if (typeof account.activeCardSlots !== 'number') {
    account.activeCardSlots = rpgData.getActiveCardSlotCount(account.level || 1);
  }
  if (typeof account.passiveCardSlots !== 'number') {
    account.passiveCardSlots = rpgData.getPassiveCardSlotCount(account.level || 1);
  }
  if (typeof account.cardSlots !== 'number' || account.cardSlots < account.activeCardSlots + account.passiveCardSlots) {
    account.cardSlots = rpgData.getCardSlotCount(account.level || 1);
  }
}

// ---------------------------------------------------------------------------
// RPG: Card fusion
// ---------------------------------------------------------------------------

function fuseRpgCards(key, card1Id, card2Id) {
  if (card1Id === card2Id) return { error: 'Cannot fuse a card with itself' };
  var account = loadAccount(key);
  if (!account) return { error: 'Account not found' };
  if (!account.rpgCards) return { error: 'No cards' };

  var card1 = null, card2 = null, idx1 = -1, idx2 = -1;
  for (var i = 0; i < account.rpgCards.length; i++) {
    if (account.rpgCards[i].instanceId === card1Id) { card1 = account.rpgCards[i]; idx1 = i; }
    if (account.rpgCards[i].instanceId === card2Id) { card2 = account.rpgCards[i]; idx2 = i; }
  }
  if (!card1 || !card2) return { error: 'Card not found' };

  // Cannot fuse equipped cards
  if (account.equippedCards) {
    for (var j = 0; j < account.equippedCards.length; j++) {
      if (account.equippedCards[j] === card1Id || account.equippedCards[j] === card2Id) {
        return { error: 'Unequip cards before fusing' };
      }
    }
  }

  // Compute racial bonuses to pass into fusion
  var _fuseRaceData = account.race && rpgData.RACES && rpgData.RACES[account.race];
  var _racialFuseBonus = null;
  if (_fuseRaceData) {
    var _rLuck = _fuseRaceData.baseLuck || 0;
    var _rMutBonus = 0;
    if (_fuseRaceData.racialFeat && _fuseRaceData.racialFeat.effects) {
      for (var _rfi = 0; _rfi < _fuseRaceData.racialFeat.effects.length; _rfi++) {
        if (_fuseRaceData.racialFeat.effects[_rfi].type === 'mutation_chance_bonus') {
          _rMutBonus += (_fuseRaceData.racialFeat.effects[_rfi].value || 0);
        }
      }
    }
    if (_rLuck > 0 || _rMutBonus > 0) _racialFuseBonus = { luckBonus: _rLuck, mutationChanceBonus: _rMutBonus };
  }

  var result = rpgData.fuseCards(card1, card2, _racialFuseBonus);
  if (result.error) return result;

  // Remove both source cards (remove higher index first to avoid shifting)
  var toRemove = [idx1, idx2].sort(function(a, b) { return b - a; });
  for (var k = 0; k < toRemove.length; k++) {
    account.rpgCards.splice(toRemove[k], 1);
  }
  // Add fused card
  account.rpgCards.push(result.card);

  // Viral spread: if fusion produced a mutation, it may spread to equipped cards
  var fusionViralSpreads = [];
  if (result.mutation) {
    var fusionLuck = 0;
    for (var fi = 0; fi < result.card.effects.length; fi++) {
      var fe = result.card.effects[fi];
      if (fe.type === 'luck_bonus' || fe.type === 'card_luck_bonus') fusionLuck += (fe.value || 0);
    }
    // Add racial base luck
    var _fuseRace = account.race && rpgData.RACES && rpgData.RACES[account.race];
    if (_fuseRace && _fuseRace.baseLuck) fusionLuck += _fuseRace.baseLuck;
    fusionViralSpreads = _spreadMutation(account, result.card, fusionLuck);
  }


  invalidateCardEffectsCache(key);
  saveAccount(account);
  return { success: true, newCard: result.card, mutation: result.mutation || null, viralSpreads: fusionViralSpreads };
}

function getRpgCards(key) {
  var account = loadAccount(key);
  if (!account) return [];
  return account.rpgCards || [];
}

// ---------------------------------------------------------------------------
// RPG: Get equipped card effects (aggregated)
// ---------------------------------------------------------------------------

function getEquippedCardEffects(key, existingAccount) {
  // Check cache first (only when no pre-loaded account provided, since caller may have mutated it)
  if (!existingAccount) {
    var cached = _cardEffectsCache.get(key);
    if (cached && (Date.now() - cached.ts) < CARD_EFFECTS_TTL) {
      return cached.effects;
    }
  }

  var account = existingAccount || loadAccount(key);
  if (!account) return [];
  if (!account.rpgCards || !account.equippedCards) return [];

  var effects = [];
  var cardMap = {};
  for (var i = 0; i < account.rpgCards.length; i++) {
    cardMap[account.rpgCards[i].instanceId] = account.rpgCards[i];
  }
  for (var j = 0; j < account.equippedCards.length; j++) {
    var cid = account.equippedCards[j];
    if (cid && cardMap[cid]) {
      var card = cardMap[cid];
      for (var k = 0; k < card.effects.length; k++) {
        var eff = JSON.parse(JSON.stringify(card.effects[k]));
        // Apply racial bonus for racial_feat cards
        if (card.type === 'racial_feat' && card.raceBonus === account.race && eff.raceValue !== undefined) {
          eff.value = eff.raceValue;
        }
        effects.push(eff);
      }
    }
  }

  // Store in cache
  _cardEffectsCache.set(key, { effects: effects, ts: Date.now() });

  return effects;
}

// ---------------------------------------------------------------------------
// RPG: Get aggregated player luck bonus (race + equipped card effects)
// Returns a float (e.g. 0.15 = 15% luck bonus). Used for mutation rolls.
// ---------------------------------------------------------------------------

function getPlayerLuck(key) {
  var account = loadAccount(key);
  if (!account) return 0;
  var luck = 0;
  // Racial base luck
  var race = account.race && rpgData.RACES && rpgData.RACES[account.race];
  if (race && race.baseLuck) luck += race.baseLuck;
  // Presence stat — each point adds 0.5% luck
  var presence = (account.rpgStats && account.rpgStats.presence) || 0;
  if (presence > 0) luck += presence * 0.005;
  // Equipped card luck effects
  var effects = getEquippedCardEffects(key, account);
  for (var i = 0; i < effects.length; i++) {
    if (effects[i].type === 'luck_bonus' || effects[i].type === 'card_luck_bonus') {
      luck += (effects[i].value || 0);
    }
  }
  // Equipped item luck (from item mutations like fortune_charm, lucky_ward)
  var eq = account.equipment || {};
  var inv = (account.mmoInventory && account.mmoInventory.items) ? account.mmoInventory.items : [];
  var gearSlots = ['head', 'chest', 'undershirt', 'arms', 'hands', 'legs', 'feet',
    'ring1', 'ring2', 'ring3', 'ring4', 'ring5', 'ring6', 'necklace',
    'mainHand', 'offHand'];
  for (var s = 0; s < gearSlots.length; s++) {
    var itemId = eq[gearSlots[s]];
    if (!itemId) continue;
    for (var j = 0; j < inv.length; j++) {
      if (inv[j].id === itemId && inv[j].stats && inv[j].stats.luck) {
        luck += inv[j].stats.luck;
        break;
      }
    }
  }
  // Ascension: Lucky Star node (+1% rarity bump per rank)
  var ascTree = account.ascensionTree || {};
  luck += (ascTree['lucky_star'] || 0) * 0.01;
  return luck;
}

module.exports = {
  init: init,
  MAX_CARDS: MAX_CARDS,
  addCard: addCard,
  removeCard: removeCard,
  getCards: getCards,
  acquireCardLock: acquireCardLock,
  releaseCardLock: releaseCardLock,
  addPendingPack: addPendingPack,
  openPendingPack: openPendingPack,
  equipRpgCard: equipRpgCard,
  unequipRpgCard: unequipRpgCard,
  fuseRpgCards: fuseRpgCards,
  getRpgCards: getRpgCards,
  getEquippedCardEffects: getEquippedCardEffects,
  getPlayerLuck: getPlayerLuck,
  invalidateCardEffectsCache: invalidateCardEffectsCache,
};
