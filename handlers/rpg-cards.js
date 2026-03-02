// handlers/rpg-cards.js
// Card pack opening, fusion, equip/unequip, and card economy events.
// Events: card_open_pack, card_fuse, card_equip, card_unequip, get_cards,
//         card_vendor_buy, card_vendor_sell, get_gacha_rates

var rpgData = require('../rpg-data');
var crypto = require('crypto');
var challengesHandler = require('./challenges');
var knowledgeHandler = require('./knowledge');

var _cardVendorLocks = new Set();

// ---------------------------------------------------------------------------
// Helper: build full gacha rate disclosure payload for a given account
// ---------------------------------------------------------------------------
function _buildRateDisclosure(acc, accounts, key, vipLuckBonus) {
  if (!acc) return null;

  var raceId = acc.race || 'human';
  var pity = typeof acc.pityPullsSinceLegendary === 'number' ? acc.pityPullsSinceLegendary : 0;

  // Sum luck_bonus and card_luck_bonus from equipped cards (mirrors openPendingPack logic)
  var packLuckBonus = vipLuckBonus || 0;
  var cardModifiers = [];
  var cardEffects = accounts.getEquippedCardEffects(key);
  for (var i = 0; i < cardEffects.length; i++) {
    if (cardEffects[i].type === 'luck_bonus') {
      packLuckBonus += (cardEffects[i].value || 0);
    }
    if (cardEffects[i].type === 'card_luck_bonus') {
      packLuckBonus += (cardEffects[i].value || 0);
    }
  }

  // Build human-readable card modifier list from equipped cards
  if (acc.rpgCards && acc.equippedCards) {
    var cardMap = {};
    for (var cm = 0; cm < acc.rpgCards.length; cm++) {
      cardMap[acc.rpgCards[cm].instanceId] = acc.rpgCards[cm];
    }
    for (var eq = 0; eq < acc.equippedCards.length; eq++) {
      var cid = acc.equippedCards[eq];
      if (!cid || !cardMap[cid]) continue;
      var card = cardMap[cid];
      for (var ef = 0; ef < card.effects.length; ef++) {
        var eff = card.effects[ef];
        if (eff.type === 'luck_bonus') {
          cardModifiers.push({
            cardName: card.name,
            effect: '+' + Math.round((eff.value || 0) * 100) + '% rarity bump chance (luck)',
          });
        } else if (eff.type === 'card_luck_bonus') {
          cardModifiers.push({
            cardName: card.name,
            effect: '+' + Math.round((eff.value || 0) * 100) + '% rarity bump chance (card luck)',
          });
        }
      }
    }
  }

  // Compute the effective rates through rpg-data's centralized function
  var rateData = rpgData.computeEffectiveGachaRates(raceId, pity, packLuckBonus);

  // Attach card modifiers and pack availability
  rateData.cardModifiers = cardModifiers;
  rateData.packInfo.packsAvailable = acc.pendingPacks || 0;

  return rateData;
}

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, checkEventRate, applyRateGrace, vipPerks, getCachedVipStatus } = deps;

    // --- get_gacha_rates: disclose exact drop rates for this player ---
    socket.on('get_gacha_rates', function() {

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      var _gachaVip = getCachedVipStatus ? getCachedVipStatus(key) : null;
      var _vipLuck = vipPerks ? vipPerks.getCardPullLuckBonus(_gachaVip) : 0;
      var disclosure = _buildRateDisclosure(acc, accounts, key, _vipLuck);
      if (!disclosure) return;

      socket.emit('gacha_rates', disclosure);
    });

    // --- card_open_pack: open a pending card pack ---
    socket.on('card_open_pack', function() {
      if (!applyRateGrace(socket, 'card_open_pack', 12, 2000)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      // Build pre-open rate disclosure from current account state
      var preAcc = accounts.loadAccount(key);
      var _packVip = getCachedVipStatus ? getCachedVipStatus(key) : null;
      var _packVipLuck = vipPerks ? vipPerks.getCardPullLuckBonus(_packVip) : 0;
      var preOpenRates = preAcc ? _buildRateDisclosure(preAcc, accounts, key, _packVipLuck) : null;

      var result = accounts.openPendingPack(key);
      if (result.error) {
        socket.emit('card_error', { message: result.error });
        return;
      }

      // Apply rare curse chance per card (1.5% base, luck-scaled down)
      // Pack source 'rift' would use higher chance — future feature for rift packs
      var packLuck = accounts.getPlayerLuck(key);
      var packCursed = [];
      if (result.cards && result.cards.length > 0) {
        for (var pki = 0; pki < result.cards.length; pki++) {
          var pkCard = result.cards[pki];
          var pkCurse = rpgData.rollCardCurse(0.015, packLuck);
          if (pkCurse) {
            rpgData.applyCurse(pkCard, pkCurse);
            packCursed.push({ instanceId: pkCard.instanceId, curse: pkCurse });
          }
        }
      }

      socket.emit('card_pack_opened', {
        cards: result.cards,
        pendingPacks: result.pendingPacks,
        rates_included: true,
        rateDisclosure: preOpenRates,
        cursed: packCursed.length > 0 ? packCursed : undefined,
      });

      // Fire glossary trigger for card pack opening
      try {
        var terms = knowledgeHandler.fireGlossaryTrigger(accounts, key, 'card_open_pack');
        for (var i = 0; i < terms.length; i++) {
          socket.emit('knowledge_term_unlocked', terms[i]);
        }
      } catch (e) { /* glossary trigger non-fatal */ }

      // --- Track daily challenge & achievement progress for pack opening ---
      challengesHandler.trackChallengeProgress(accounts, key, 'pack_open', 1);
      // Check for legendary card achievement from the opened cards
      if (result.cards && result.cards.length > 0) {
        for (var pci = 0; pci < result.cards.length; pci++) {
          var cardRarity = result.cards[pci].rarity;
          if (cardRarity === 'legendary' || cardRarity === 'godly' || cardRarity === 'relic') {
            challengesHandler.trackAchievementProgress(accounts, key, 'card_rarity', 'legendary', socket);
            break;
          }
        }
      }
    });

    // --- card_fuse: fuse two cards ---
    socket.on('card_fuse', function(data) {
      if (!data || typeof data.card1Id !== 'string' || typeof data.card2Id !== 'string') {
        socket.emit('card_error', { message: 'Invalid request' });
        return;
      }
      if (!applyRateGrace(socket, 'card_fuse', 20, 3000)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var result = accounts.fuseRpgCards(key, data.card1Id, data.card2Id);
      if (result.error) {
        socket.emit('card_fuse_error', { message: result.error });
        return;
      }

      socket.emit('card_fuse_result', {
        success: true,
        newCard: result.newCard,
      });

      // --- Track daily challenge progress for card fusion ---
      challengesHandler.trackChallengeProgress(accounts, key, 'card_fuse', 1);
    });

    // --- card_equip: equip a card to a slot ---
    socket.on('card_equip', function(data) {
      if (!data || typeof data.cardInstanceId !== 'string') {
        socket.emit('card_error', { message: 'Invalid request' });
        return;
      }

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var result = accounts.equipRpgCard(key, data.cardInstanceId);
      if (result.error) {
        socket.emit('card_error', { message: result.error });
        return;
      }

      socket.emit('card_equipped', {
        equippedCards: result.equippedCards,
        activeCardSlots: result.activeCardSlots,
        passiveCardSlots: result.passiveCardSlots,
        effects: accounts.getEquippedCardEffects(key),
      });
    });

    // --- card_unequip: remove a card from equipped ---
    socket.on('card_unequip', function(data) {
      if (!data || (!data.cardInstanceId && typeof data.slotIndex !== 'number')) {
        socket.emit('card_error', { message: 'Invalid request' });
        return;
      }

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      // Support both old slot-index and new instanceId-based unequip
      var result = accounts.unequipRpgCard(key, data.cardInstanceId || data.slotIndex);
      if (result.error) {
        socket.emit('card_error', { message: result.error });
        return;
      }

      socket.emit('card_unequipped', {
        equippedCards: result.equippedCards,
        effects: accounts.getEquippedCardEffects(key),
      });
    });

    // --- get_cards: get full card collection ---
    socket.on('get_cards', function() {

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      var level = acc.level || 1;
      socket.emit('card_collection', {
        cards: acc.rpgCards || [],
        equippedCards: acc.equippedCards || [],
        cardSlots: acc.cardSlots || rpgData.getCardSlotCount(level),
        activeCardSlots: acc.activeCardSlots || rpgData.getActiveCardSlotCount(level),
        passiveCardSlots: acc.passiveCardSlots || rpgData.getPassiveCardSlotCount(level),
        pendingPacks: acc.pendingPacks || 0,
        effects: accounts.getEquippedCardEffects(key),
        rarityInfo: rpgData.RARITY_TIERS,
        cardStyles: rpgData.CARD_STYLES,
      });
    });

    // --- card_vendor_buy: buy a common/uncommon card from NPC ---
    socket.on('card_vendor_buy', function(data) {
      if (!data || typeof data.cardId !== 'string') {
        socket.emit('card_error', { message: 'Invalid request' });
        return;
      }

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var template = rpgData.CARD_BY_ID[data.cardId];
      if (!template) { socket.emit('card_error', { message: 'Card not found' }); return; }

      // Use starter prices for curated shop cards, regular prices otherwise
      var STARTER_PRICES = { common: 20, uncommon: 50 };
      var isStarterCard = CURATED_SHOP_CARDS.indexOf(data.cardId) !== -1;
      var price = isStarterCard ? (STARTER_PRICES[template.rarity] || rpgData.CARD_VENDOR_PRICES[template.rarity]) : rpgData.CARD_VENDOR_PRICES[template.rarity];
      if (!price) { socket.emit('card_error', { message: 'This card cannot be purchased from vendors' }); return; }

      var acc = accounts.loadAccount(key);
      if (!acc) return;
      if ((acc.chips || 0) < price) {
        socket.emit('card_error', { message: 'Not enough coins (need ' + price + ')' });
        return;
      }
      if ((acc.rpgCards || []).length >= rpgData.MAX_CARD_COLLECTION) {
        socket.emit('card_error', { message: 'Card collection full' });
        return;
      }

      // Acquire vendor lock to prevent concurrent buy race conditions
      if (_cardVendorLocks.has(key)) {
        socket.emit('card_error', { message: 'Transaction in progress, try again' });
        return;
      }
      _cardVendorLocks.add(key);
      try {
        accounts.updateChips(key, -price);
        // loadAccount returns the same cached reference — updateChips already mutated acc.chips in-place

        var cardInstance = rpgData.generateCardInstance(template, 'vendor');
        if (!acc.rpgCards) acc.rpgCards = [];
        acc.rpgCards.push(cardInstance);
        accounts.saveAccount(acc);

        socket.emit('card_vendor_bought', {
          card: cardInstance,
          coins: acc.chips,
        });
      } finally {
        _cardVendorLocks.delete(key);
      }
    });

    // --- card_vendor_sell: sell a card to NPC for 25% of base value ---
    socket.on('card_vendor_sell', function(data) {
      if (!data || typeof data.cardInstanceId !== 'string') {
        socket.emit('card_error', { message: 'Invalid request' });
        return;
      }

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc || !acc.rpgCards) return;

      // Find and remove card
      var cardIdx = -1;
      for (var i = 0; i < acc.rpgCards.length; i++) {
        if (acc.rpgCards[i].instanceId === data.cardInstanceId) { cardIdx = i; break; }
      }
      if (cardIdx === -1) { socket.emit('card_error', { message: 'Card not found' }); return; }

      // Cannot sell equipped cards
      if (acc.equippedCards) {
        for (var j = 0; j < acc.equippedCards.length; j++) {
          if (acc.equippedCards[j] === data.cardInstanceId) {
            socket.emit('card_error', { message: 'Unequip card before selling' });
            return;
          }
        }
      }

      var card = acc.rpgCards[cardIdx];
      var baseValue = rpgData.RARITY_BASE_VALUE[card.rarity] || 50;
      // Special styles are worth more
      if (card.style === 'holographic') baseValue = Math.round(baseValue * 1.5);
      else if (card.style === 'golden') baseValue = Math.round(baseValue * 2);
      else if (card.style === 'prismatic') baseValue = Math.round(baseValue * 3);
      else if (card.style === 'void') baseValue = Math.round(baseValue * 5);

      var sellPrice = Math.max(1, Math.round(baseValue * rpgData.CARD_BUYBACK_RATE));

      // Acquire vendor lock to prevent concurrent sell race conditions
      if (_cardVendorLocks.has(key)) {
        socket.emit('card_error', { message: 'Transaction in progress, try again' });
        return;
      }
      _cardVendorLocks.add(key);
      try {
        acc.rpgCards.splice(cardIdx, 1);
        accounts.saveAccount(acc);
        accounts.updateChips(key, sellPrice);

        // Reload account after chip update to get fresh coin count
        var freshAcc = accounts.loadAccount(key);

        socket.emit('card_vendor_sold', {
          soldCardId: data.cardInstanceId,
          coinsReceived: sellPrice,
          coins: (freshAcc ? freshAcc.chips : 0) || 0,
        });
      } finally {
        _cardVendorLocks.delete(key);
      }
    });

    // --- get_card_vendor_catalog: curated starter cards (1-3 per archetype) ---
    // Curated shop: 1 active + 2 passives per archetype + 7 stat boosts
    var CURATED_SHOP_CARDS = [
      // ── General: Stat Boosts (common) ──
      'vigor', 'might', 'finesse', 'acumen', 'resolve', 'presence', 'ingenuity',
      // ── melee_dps: physical damage dealers ──
      'feral_swipe',        // active (common) - basic melee attack
      'sharp_edge',         // passive (common) - melee damage
      'crit_boost',         // passive (uncommon) - crit chance
      // ── tank: damage absorption / aggro ──
      'taunt',              // active (uncommon) - tank aggro pull
      'iron_skin',          // passive (common) - armor bonus
      'sturdy_constitution',// passive (common) - HP bonus
      // ── pure_defense: damage mitigation ──
      'fortify',            // active (uncommon) - temp armor
      'stone_skin_passive', // passive (common) - flat armor
      'thorns',             // passive (common) - damage reflect
      // ── support: healing / buffs ──
      'heal_self_I',        // active (uncommon) - self heal
      'bandage_wrap',       // passive (common) - out-of-combat heal
      'encouraging_word',   // passive (common) - party buff
      // ── glass_cannon: magic burst damage ──
      'ice_shard',          // active (uncommon) - ranged magic damage
      'spark_of_power',     // passive (common) - spell power
      'volatile_mana',      // passive (common) - mana to damage
      // ── assassin: stealth / burst ──
      'backstab_I',         // active (uncommon) - stealth attack
      'subtle_blade',       // passive (common) - stealth damage
      'lockmaster',         // passive (uncommon) - lockpicking bonus
      // ── scout: mobility / evasion ──
      'smoke_screen',       // active (uncommon) - escape/stealth
      'speed_boost',        // passive (common) - movement speed
      'keen_eyes',          // passive (common) - detection
      // ── cc_dot: crowd control / damage over time ──
      'oil_slick',          // active (uncommon) - area slow
      'stinging_touch',     // passive (common) - on-hit DoT
      'numbing_agent',      // passive (common) - on-hit slow
      // ── night_hunter: darkness specialization ──
      'trap_layer',         // active (uncommon) - place traps
      'dark_adapted',       // passive (common) - dark bonus
      'predator_instinct',  // passive (common) - tracking
      // ── grappler: close combat control ──
      'grappler_iron_grip', // active (uncommon) - grapple stun attack
      'vice_grip',          // passive (common) - grapple power
      'wrestlers_stance',   // passive (common) - grapple defense
      // ── aquatic: water specialization ──
      'tidal_shield',       // active (uncommon) - water defense shield
      'water_affinity',     // passive (common) - water bonus
      'aquatic_adaptation', // passive (rare) - water armor/breathing
      // ── utility: crafting / exploration ──
      'detect_magic',       // active (uncommon) - reveal
      'bountiful_harvest',  // passive (uncommon) - gather bonus
      'carry_weight',       // passive (common) - carry capacity
    ];

    socket.on('get_card_vendor_catalog', function() {
      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var catalog = [];
      for (var i = 0; i < CURATED_SHOP_CARDS.length; i++) {
        var t = rpgData.CARD_BY_ID[CURATED_SHOP_CARDS[i]];
        if (!t) continue;
        // Starter shop pricing: cheaper than general vendor
        var STARTER_PRICES = { common: 20, uncommon: 50 };
        var price = STARTER_PRICES[t.rarity] || rpgData.CARD_VENDOR_PRICES[t.rarity];
        if (!price) continue;
        catalog.push({
          cardId: t.cardId,
          name: t.name,
          rarity: t.rarity,
          type: t.type,
          archetype: t.archetype || 'utility',
          description: t.description || '',
          price: price,
          // Combat/tooltip data
          resourceType: t.resourceType || null,
          combatType: t.combatType || null,
          baseDamage: t.baseDamage || null,
          baseHeal: t.baseHeal || null,
          range: typeof t.range === 'number' ? t.range : null,
          manaCost: t.manaCost || null,
          bloodlustCost: t.bloodlustCost || null,
          focusCost: t.focusCost || null,
          staminaCost: t.staminaCost || null,
          cooldown: t.cooldown || null,
          aoeRadius: t.aoeRadius || null,
          scalingStat: t.scalingStat || null,
          scalingFactor: t.scalingFactor || null,
          targetType: t.targetType || null,
          element: t.element || null,
          statusEffect: t.statusEffect || null,
          statusDuration: t.statusDuration || null,
          onHitTile: t.onHitTile || null,
          tileEffect: t.tileEffect || null,
          effects: t.effects || [],
          combatPassive: t.combatPassive || null,
          tags: t.tags || [],
        });
      }
      socket.emit('card_vendor_catalog', { cards: catalog });
    });

    // --- card_save_loadout: save current equipped cards as a loadout ---
    socket.on('card_save_loadout', function(data) {
      if (!data || typeof data.slotIndex !== 'number' || data.slotIndex < 0 || data.slotIndex > 4) {
        socket.emit('card_error', { message: 'Invalid loadout slot' });
        return;
      }
      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      if (!acc.cardLoadouts) acc.cardLoadouts = [null, null, null, null, null];
      acc.cardLoadouts[data.slotIndex] = {
        name: (data.name && typeof data.name === 'string') ? data.name.substring(0, 20) : ('Loadout ' + (data.slotIndex + 1)),
        cards: (acc.equippedCards || []).slice(),
      };
      accounts.saveAccount(acc);
      socket.emit('card_loadout_saved', { slotIndex: data.slotIndex, loadouts: acc.cardLoadouts });
    });

    // --- card_load_loadout: restore a saved loadout ---
    socket.on('card_load_loadout', function(data) {
      if (!data || typeof data.slotIndex !== 'number' || data.slotIndex < 0 || data.slotIndex > 4) {
        socket.emit('card_error', { message: 'Invalid loadout slot' });
        return;
      }
      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      var loadout = (acc.cardLoadouts || [])[data.slotIndex];
      if (!loadout) {
        socket.emit('card_error', { message: 'No loadout saved in this slot' });
        return;
      }

      // Validate cards still exist in collection, build lookup for type resolution
      var cardMap = {};
      for (var i = 0; i < (acc.rpgCards || []).length; i++) {
        cardMap[acc.rpgCards[i].instanceId] = acc.rpgCards[i];
      }

      // Restore loadout, enforcing active/passive slot limits (mirrors equipRpgCard validation)
      var activeSlots = acc.activeCardSlots || rpgData.getActiveCardSlotCount(acc.level || 1);
      var passiveSlots = acc.passiveCardSlots || rpgData.getPassiveCardSlotCount(acc.level || 1);
      var activeCount = 0, passiveCount = 0;
      var newEquipped = [];
      for (var s = 0; s < loadout.cards.length; s++) {
        var instanceId = loadout.cards[s];
        if (!instanceId || !cardMap[instanceId]) continue;
        var savedCard = cardMap[instanceId];
        var tmpl = rpgData.CARD_BY_ID[savedCard.cardId] || {};
        var cardType = tmpl.type || savedCard.type || 'passive_perk';
        var isActive = rpgData.isActiveCardType(cardType);
        if (isActive && activeCount >= activeSlots) continue;
        if (!isActive && passiveCount >= passiveSlots) continue;
        newEquipped.push(instanceId);
        if (isActive) activeCount++;
        else passiveCount++;
      }
      acc.equippedCards = newEquipped;
      accounts.saveAccount(acc);

      socket.emit('card_equipped', {
        equippedCards: acc.equippedCards,
        effects: accounts.getEquippedCardEffects(key),
      });
    });

    // --- get_card_loadouts: return all saved loadout slots ---
    socket.on('get_card_loadouts', function() {
      var key = socketAccountMap.get(socket.id);
      if (!key) return;
      var acc = accounts.loadAccount(key);
      if (!acc) return;
      socket.emit('card_loadouts', { loadouts: acc.cardLoadouts || [null, null, null, null, null] });
    });

    // --- card_choose_evolution_path: player picks A or B at evolution stage 3 ---
    socket.on('card_choose_evolution_path', function(data) {
      if (!data || !data.instanceId || !data.path) {
        socket.emit('card_error', { message: 'Missing instanceId or path' });
        return;
      }
      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var result = accounts.applyEvolutionPath(key, data.instanceId, data.path);
      if (result.error) {
        socket.emit('card_error', { message: result.error });
        return;
      }

      socket.emit('card_evolution_complete', { card: result.card, path: data.path });
    });

    // --- get_card_evolution_info: return evolution thresholds + path options for a cardId ---
    socket.on('get_card_evolution_info', function(data) {
      if (!data || !data.cardId) return;
      var template = rpgData.CARD_BY_ID[data.cardId];
      if (!template || !template.evolutionThresholds) {
        socket.emit('card_evolution_info', { cardId: data.cardId, evolvable: false });
        return;
      }
      socket.emit('card_evolution_info', {
        cardId: data.cardId,
        evolvable: true,
        evoCategory: template.evoCategory,
        thresholds: template.evolutionThresholds,
        stageEffects: template.evolutionStageEffects,
        paths: template.evolutionPaths,
      });
    });

    // --- cleanse_card_curse: remove a curse from a card ---
    socket.on('cleanse_card_curse', function(data) {
      if (!data || !data.instanceId || !data.curseId) return;
      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var account = accounts.loadAccount(key);
      if (!account || !account.rpgCards) {
        socket.emit('card_error', { message: 'Account not found' });
        return;
      }

      // Find the card
      var targetCard = null;
      for (var ci = 0; ci < account.rpgCards.length; ci++) {
        if (account.rpgCards[ci].instanceId === data.instanceId) {
          targetCard = account.rpgCards[ci];
          break;
        }
      }
      if (!targetCard) {
        socket.emit('card_error', { message: 'Card not found' });
        return;
      }

      // Check if player has a purification scroll in inventory
      // (purification_crystal is the cleansing resource)
      if (!account.mmoInventory) {
        socket.emit('card_error', { message: 'No purification crystal' });
        return;
      }
      var crystalCount = account.mmoInventory['purification_crystal'] || 0;
      if (crystalCount < 1) {
        socket.emit('card_error', { message: 'Requires 1 Purification Crystal' });
        return;
      }

      var cleansed = rpgData.cleanseCardCurse(targetCard, data.curseId);
      if (!cleansed) {
        socket.emit('card_error', { message: 'Curse not found or not cleansable' });
        return;
      }

      // Consume the crystal
      account.mmoInventory['purification_crystal'] = crystalCount - 1;
      accounts.saveAccount(account);
      accounts.invalidateCardEffectsCache(key);
      socket.emit('card_curse_cleansed', { card: targetCard, curseId: data.curseId });
    });
  }
};
