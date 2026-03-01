// handlers/mmo-auction.js
// MMO Auction House: player marketplace for RPG cards and resources.
// Events: mmo_auction_browse, mmo_auction_list_card, mmo_auction_list_resource,
//         mmo_auction_buy, mmo_auction_cancel, mmo_auction_my_listings

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var rpgData = require('../rpg-data');
var challengesHandler = require('./challenges');

// In-memory auction storage
var listings = new Map();
var nextId = 1;

var MAX_LISTINGS_PER_PLAYER = 20;
var MAX_TOTAL_LISTINGS = 500;
var LISTING_FEE_PERCENT = 5;
var LISTING_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
var DEFAULT_PAGE_SIZE = 50;
var MAX_PAGE_SIZE = 100;

// Locks
var purchaseLocks = new Set();
var listingLocks = new Set();
var _sellerLocks = new Set();

// Secondary index: sellerKey -> Set<listingId> for O(1) seller lookups
var sellerIndex = new Map();

// Scoped auction update broadcast — only notify sockets currently viewing the auction
var _auctionViewers = new Set(); // socket IDs currently viewing auction
var _auctionUpdateTimer = null;
var _auctionIo = null;
function debouncedAuctionUpdate(io) {
  _auctionIo = io;
  if (!_auctionUpdateTimer) {
    _auctionUpdateTimer = setTimeout(function() {
      _auctionUpdateTimer = null;
      if (_auctionIo) {
        _auctionViewers.forEach(function(sid) {
          var s = _auctionIo.sockets.sockets.get(sid);
          if (s) s.emit('mmo_auction_update');
        });
      }
    }, 2000);
  }
}

// ---------------------------------------------------------------------------
// Auction Persistence
// ---------------------------------------------------------------------------

var AUCTION_DIR = path.join(__dirname, '..', 'data', 'auction');
var AUCTION_FILE = path.join(AUCTION_DIR, 'listings.json');
var _pendingAuctionSave = null;
var AUCTION_SAVE_DEBOUNCE_MS = 2000;

try { fs.mkdirSync(AUCTION_DIR, { recursive: true }); } catch (e) { /* ignore */ }

function saveAuctionListings() {
  if (_pendingAuctionSave) clearTimeout(_pendingAuctionSave);
  _pendingAuctionSave = setTimeout(function() {
    _pendingAuctionSave = null;
    var arr = [];
    for (var entry of listings) {
      arr.push(entry[1]);
    }
    var data = JSON.stringify({ nextId: nextId, listings: arr });
    fs.writeFile(AUCTION_FILE, data, function(err) {
      if (err) console.error('[mmo-auction] Save failed:', err.message);
    });
  }, AUCTION_SAVE_DEBOUNCE_MS);
}

function loadAuctionListings() {
  try {
    if (fs.existsSync(AUCTION_FILE)) {
      var raw = JSON.parse(fs.readFileSync(AUCTION_FILE, 'utf8'));
      if (raw.nextId) nextId = raw.nextId;
      if (raw.listings && Array.isArray(raw.listings)) {
        for (var i = 0; i < raw.listings.length; i++) {
          var listing = raw.listings[i];
          if (listing && listing.id) {
            addListingNoSave(listing);
          }
        }
        console.log('[mmo-auction] Loaded ' + listings.size + ' listings from disk');
      }
    }
  } catch (err) {
    console.error('[mmo-auction] Load failed:', err.message);
  }
}

// Index-aware add without triggering save (used during load)
function addListingNoSave(listing) {
  listings.set(listing.id, listing);
  if (!sellerIndex.has(listing.sellerKey)) sellerIndex.set(listing.sellerKey, new Set());
  sellerIndex.get(listing.sellerKey).add(listing.id);
}

// Index-aware add/remove helpers
function addListing(listing) {
  addListingNoSave(listing);
  saveAuctionListings();
}

function removeListing(listingId) {
  var listing = listings.get(listingId);
  if (!listing) return null;
  listings.delete(listingId);
  var sellerSet = sellerIndex.get(listing.sellerKey);
  if (sellerSet) {
    sellerSet.delete(listingId);
    if (sellerSet.size === 0) sellerIndex.delete(listing.sellerKey);
  }
  saveAuctionListings();
  return listing;
}

// ---------------------------------------------------------------------------
// Dynamic pricing — EMA-based supply/demand tracking
// ---------------------------------------------------------------------------

var EMA_ALPHA = 0.15;  // smoothing factor for exponential moving average
var PRICE_HISTORY_MAX = 100; // max sale records per item type

// saleHistory[itemKey] = { sales: [{price, amount, timestamp}], demandEMA, supplyEMA, avgPrice }
var saleHistory = {};

function _getItemKey(listing) {
  if (listing.listingType === 'card') return 'card:' + (listing.cardType || listing.rarity || 'unknown');
  if (listing.listingType === 'resource') return 'resource:' + listing.resourceType;
  return 'other:' + listing.name;
}

function _recordSale(listing) {
  var key = _getItemKey(listing);
  if (!saleHistory[key]) {
    saleHistory[key] = { sales: [], demandEMA: 0, supplyEMA: 0, avgPrice: listing.price };
  }
  var hist = saleHistory[key];
  hist.sales.push({ price: listing.price, amount: listing.amount || 1, timestamp: Date.now() });
  if (hist.sales.length > PRICE_HISTORY_MAX) hist.sales.shift();

  // Update EMA
  hist.demandEMA = hist.demandEMA * (1 - EMA_ALPHA) + 1 * EMA_ALPHA; // demand = sale event
  hist.avgPrice = hist.avgPrice * (1 - EMA_ALPHA) + listing.price * EMA_ALPHA;
}

function _recordListing(listing) {
  var key = _getItemKey(listing);
  if (!saleHistory[key]) {
    saleHistory[key] = { sales: [], demandEMA: 0, supplyEMA: 0, avgPrice: listing.price };
  }
  var hist = saleHistory[key];
  hist.supplyEMA = hist.supplyEMA * (1 - EMA_ALPHA) + 1 * EMA_ALPHA; // supply = listing event
}

function getMarketPrice(itemKey) {
  var hist = saleHistory[itemKey];
  if (!hist || hist.sales.length === 0) return null;
  return {
    avgPrice: Math.round(hist.avgPrice),
    demandEMA: Math.round(hist.demandEMA * 100) / 100,
    supplyEMA: Math.round(hist.supplyEMA * 100) / 100,
    recentSales: hist.sales.length,
    trend: hist.demandEMA > hist.supplyEMA ? 'rising' : (hist.demandEMA < hist.supplyEMA ? 'falling' : 'stable'),
  };
}

function getSuggestedPrice(listing) {
  var key = _getItemKey(listing);
  var hist = saleHistory[key];
  if (!hist || hist.sales.length < 3) return null;

  // price = avgPrice * (1 + k * (demandEMA - supplyEMA))
  var k = 0.15;
  var demandSupplyDiff = hist.demandEMA - hist.supplyEMA;
  var suggested = Math.round(hist.avgPrice * (1 + k * demandSupplyDiff));
  return Math.max(1, suggested);
}

// ---------------------------------------------------------------------------
// Anti-monopoly detection — Gini coefficient + dynamic fee scaling
// ---------------------------------------------------------------------------

var MONOPOLY_GINI_THRESHOLD = 0.65;    // Gini > 0.65 = monopolistic market
var MONOPOLY_SHARE_THRESHOLD = 0.40;   // One seller > 40% of a category = monopolist
var MONOPOLY_FEE_MAX = 25;             // Max listing fee % for monopolists (vs 5% base)
var MONOPOLY_CHECK_INTERVAL = 5 * 60 * 1000; // Recalculate every 5 minutes
var _lastMonopolyCheck = 0;

// marketConcentration[itemCategory] = { gini, topSeller, topShare, dynamicFee, sellers }
var marketConcentration = {};

// Compute Gini coefficient from an array of values
function _computeGini(values) {
  if (values.length <= 1) return 0;
  values.sort(function(a, b) { return a - b; });
  var n = values.length;
  var sumOfDifferences = 0;
  var total = 0;
  for (var i = 0; i < n; i++) {
    total += values[i];
    for (var j = 0; j < n; j++) {
      sumOfDifferences += Math.abs(values[i] - values[j]);
    }
  }
  if (total === 0) return 0;
  return sumOfDifferences / (2 * n * total);
}

// Get item category for concentration analysis (broader than _getItemKey)
function _getItemCategory(listing) {
  if (listing.listingType === 'card') return 'cards';
  if (listing.listingType === 'resource') return 'resource:' + listing.resourceType;
  return 'other';
}

// Recalculate market concentration across all categories
function _recalculateConcentration() {
  var now = Date.now();
  if (now - _lastMonopolyCheck < MONOPOLY_CHECK_INTERVAL) return;
  _lastMonopolyCheck = now;

  // Group listings by category -> seller -> count
  var categoryData = {}; // category -> { sellerKey: listingCount }

  for (var entry of listings) {
    var listing = entry[1];
    var cat = _getItemCategory(listing);
    if (!categoryData[cat]) categoryData[cat] = {};
    if (!categoryData[cat][listing.sellerKey]) categoryData[cat][listing.sellerKey] = 0;
    categoryData[cat][listing.sellerKey]++;
  }

  marketConcentration = {};

  for (var cat in categoryData) {
    var sellers = categoryData[cat];
    var sellerKeys = Object.keys(sellers);
    var counts = sellerKeys.map(function(k) { return sellers[k]; });
    var totalListings = 0;
    for (var i = 0; i < counts.length; i++) totalListings += counts[i];

    // Find top seller
    var topSeller = null;
    var topCount = 0;
    for (var j = 0; j < sellerKeys.length; j++) {
      if (counts[j] > topCount) {
        topCount = counts[j];
        topSeller = sellerKeys[j];
      }
    }

    var topShare = totalListings > 0 ? topCount / totalListings : 0;
    var gini = _computeGini(counts);

    // Dynamic fee: scales from base (5%) to max (25%) based on market share
    var dynamicFee = LISTING_FEE_PERCENT;
    if (topShare > MONOPOLY_SHARE_THRESHOLD || gini > MONOPOLY_GINI_THRESHOLD) {
      // Linear interpolation from base fee to max fee based on share
      var shareFactor = Math.min(1, (topShare - MONOPOLY_SHARE_THRESHOLD) / (1 - MONOPOLY_SHARE_THRESHOLD));
      dynamicFee = LISTING_FEE_PERCENT + (MONOPOLY_FEE_MAX - LISTING_FEE_PERCENT) * shareFactor;
    }

    marketConcentration[cat] = {
      gini: Math.round(gini * 100) / 100,
      topSeller: topSeller,
      topShare: Math.round(topShare * 100) / 100,
      dynamicFee: Math.round(dynamicFee * 10) / 10,
      sellerCount: sellerKeys.length,
      totalListings: totalListings,
    };
  }
}

// Get dynamic listing fee for a specific seller in a category
function getDynamicFee(sellerKey, listing) {
  _recalculateConcentration();

  var cat = _getItemCategory(listing);
  var conc = marketConcentration[cat];
  if (!conc) return LISTING_FEE_PERCENT;

  // Only the dominant seller pays higher fees
  if (conc.topSeller === sellerKey && conc.topShare > MONOPOLY_SHARE_THRESHOLD) {
    return conc.dynamicFee;
  }

  return LISTING_FEE_PERCENT;
}

// Get market health summary for a category
function getMarketHealth(category) {
  _recalculateConcentration();
  var conc = marketConcentration[category];
  if (!conc) return { healthy: true, gini: 0, monopolist: null };
  return {
    healthy: conc.gini < MONOPOLY_GINI_THRESHOLD && conc.topShare < MONOPOLY_SHARE_THRESHOLD,
    gini: conc.gini,
    topShare: conc.topShare,
    monopolist: conc.topShare > MONOPOLY_SHARE_THRESHOLD ? conc.topSeller : null,
    dynamicFee: conc.dynamicFee,
    sellerCount: conc.sellerCount,
  };
}

// Price deviation detection — flag listings significantly above market average
function _checkPriceDeviation(listing) {
  var key = _getItemKey(listing);
  var hist = saleHistory[key];
  if (!hist || hist.sales.length < 5) return null; // not enough data

  var deviation = listing.price / hist.avgPrice;
  if (deviation > 3.0) {
    return {
      flag: 'price_gouging',
      listingPrice: listing.price,
      marketAvg: Math.round(hist.avgPrice),
      deviation: Math.round(deviation * 100) / 100,
    };
  }
  return null;
}

// Accounts reference, set on first handler init
var _accounts = null;

function cleanExpired() {
  var now = Date.now();
  var expiredIds = [];
  for (var entry of listings) {
    if (now > entry[1].expiresAt) expiredIds.push(entry[0]);
  }
  for (var i = 0; i < expiredIds.length; i++) {
    var expired = removeListing(expiredIds[i]);
    if (expired && _accounts) {
      // Return items to seller so they aren't permanently lost
      if (expired.listingType === 'card' && expired.cardData) {
        var acc = _accounts.loadAccount(expired.sellerKey);
        if (acc) {
          if (!acc.rpgCards) acc.rpgCards = [];
          expired.cardData.source = 'auction_expired';
          acc.rpgCards.push(expired.cardData);
          _accounts.saveAccount(acc);
        }
      } else if (expired.listingType === 'resource' && expired.resourceType && expired.amount) {
        _accounts.addResource(expired.sellerKey, expired.resourceType, expired.amount);
      }
    }
  }
}

function countSellerListings(sellerKey) {
  var set = sellerIndex.get(sellerKey);
  return set ? set.size : 0;
}

module.exports = {
  loadAuctionListings: loadAuctionListings,
  getMarketPrice: getMarketPrice,
  getSuggestedPrice: getSuggestedPrice,
  getMarketHealth: getMarketHealth,
  getDynamicFee: getDynamicFee,

  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, applyRateGrace } = deps;
    if (!_accounts) _accounts = accounts; // capture accounts ref for cleanExpired

    // Track auction viewers for scoped update broadcasts
    // When the client sends mmo_auction_browse, it means the auction UI is open.
    // The client also sends auction_close when closing the panel (if supported).
    // Clean up on disconnect to prevent stale entries.
    socket.on('auction_close', function() { _auctionViewers.delete(socket.id); });
    socket.on('disconnect', function() {
      _auctionViewers.delete(socket.id);
      var key = socketAccountMap.get(socket.id);
      if (key) {
        purchaseLocks.delete(key);
        _sellerLocks.delete(key);
      }
    });

    // --- mmo_auction_browse: get marketplace listings (paginated) ---
    socket.on('mmo_auction_browse', function(data) {
      if (!applyRateGrace(socket, 'mmo_auction', 60, 10000)) return;
      _auctionViewers.add(socket.id);

      cleanExpired();

      var filters = data || {};
      if (filters.search && (typeof filters.search !== 'string' || filters.search.length > 64)) {
        filters.search = null;
      }
      if (filters.listingType && (typeof filters.listingType !== 'string' || filters.listingType.length > 32)) {
        filters.listingType = null;
      }
      if (filters.rarity && (typeof filters.rarity !== 'string' || filters.rarity.length > 32)) {
        filters.rarity = null;
      }
      var key = socketAccountMap.get(socket.id);

      // Pagination params
      var page = Math.max(1, Math.floor(filters.page) || 1);
      var limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(filters.limit) || DEFAULT_PAGE_SIZE));

      var results = [];

      for (var entry of listings) {
        var listing = entry[1];

        // Apply filters
        if (filters.listingType && listing.listingType !== filters.listingType) continue;
        if (filters.rarity && listing.rarity !== filters.rarity) continue;
        if (filters.search) {
          var s = filters.search.toLowerCase();
          if (listing.name.toLowerCase().indexOf(s) === -1) continue;
        }

        results.push({
          id: listing.id,
          sellerName: listing.sellerName,
          listingType: listing.listingType,
          name: listing.name,
          rarity: listing.rarity || null,
          cardType: listing.cardType || null,
          style: listing.style || null,
          resourceType: listing.resourceType || null,
          amount: listing.amount || null,
          price: listing.price,
          listedAt: listing.listedAt,
          expiresAt: listing.expiresAt,
          isOwn: key === listing.sellerKey,
        });
      }

      // Sort by most recent
      results.sort(function(a, b) { return b.listedAt - a.listedAt; });

      // Paginate
      var totalResults = results.length;
      var totalPages = Math.max(1, Math.ceil(totalResults / limit));
      var startIdx = (page - 1) * limit;
      var pageResults = results.slice(startIdx, startIdx + limit);

      socket.emit('mmo_auction_listings', {
        listings: pageResults,
        page: page,
        totalPages: totalPages,
        totalResults: totalResults,
      });
    });

    // --- mmo_auction_list_card: list an RPG card for sale ---
    socket.on('mmo_auction_list_card', function(data) {
      if (!applyRateGrace(socket, 'mmo_auction', 60, 10000)) return;
      if (!data || typeof data.cardInstanceId !== 'string' || typeof data.price !== 'number') {
        socket.emit('mmo_auction_error', { message: 'Invalid request' });
        return;
      }

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      if (_sellerLocks.has(key)) {
        socket.emit('mmo_auction_error', { message: 'Listing in progress' });
        return;
      }
      _sellerLocks.add(key);

      try {
        var price = Math.floor(data.price);
        if (!isFinite(price) || price < 1 || price > 1000000) {
          socket.emit('mmo_auction_error', { message: 'Price must be 1-1,000,000 coins' });
          return;
        }

        if (listings.size >= MAX_TOTAL_LISTINGS) {
          socket.emit('mmo_auction_error', { message: 'Marketplace is full' });
          return;
        }
        if (countSellerListings(key) >= MAX_LISTINGS_PER_PLAYER) {
          socket.emit('mmo_auction_error', { message: 'Too many active listings (max ' + MAX_LISTINGS_PER_PLAYER + ')' });
          return;
        }

        var acc = accounts.loadAccount(key);
        if (!acc || !acc.rpgCards) return;

        // Find card
        var cardIdx = -1;
        for (var i = 0; i < acc.rpgCards.length; i++) {
          if (acc.rpgCards[i].instanceId === data.cardInstanceId) { cardIdx = i; break; }
        }
        if (cardIdx === -1) {
          socket.emit('mmo_auction_error', { message: 'Card not found' });
          return;
        }

        // Cannot list equipped cards
        if (acc.equippedCards) {
          for (var j = 0; j < acc.equippedCards.length; j++) {
            if (acc.equippedCards[j] === data.cardInstanceId) {
              socket.emit('mmo_auction_error', { message: 'Unequip card before listing' });
              return;
            }
          }
        }

        // Remove card from inventory
        var card = acc.rpgCards.splice(cardIdx, 1)[0];
        accounts.saveAccount(acc);

        // Create listing
        var listingId = 'MAH' + (nextId++);
        var listing = {
          id: listingId,
          sellerKey: key,
          sellerName: user.name,
          listingType: 'card',
          name: card.name,
          rarity: card.rarity,
          cardType: card.type,
          style: card.style || 'normal',
          cardData: card, // full card data for transfer
          price: price,
          listedAt: Date.now(),
          expiresAt: Date.now() + LISTING_EXPIRY_MS,
        };

        addListing(listing);
        _recordListing(listing);

        var listResult = { listingId: listingId, name: card.name, price: price };
        var priceWarning = _checkPriceDeviation(listing);
        if (priceWarning) listResult.priceWarning = priceWarning;

        socket.emit('mmo_auction_listed', listResult);
        debouncedAuctionUpdate(io);

        // --- Track daily challenge progress for auction listing ---
        challengesHandler.trackChallengeProgress(accounts, key, 'auction_list', 1);
      } finally {
        _sellerLocks.delete(key);
      }
    });

    // --- mmo_auction_list_resource: list resources for sale ---
    socket.on('mmo_auction_list_resource', function(data) {
      if (!applyRateGrace(socket, 'mmo_auction', 60, 10000)) return;
      if (!data || typeof data.resource !== 'string' || typeof data.amount !== 'number' || typeof data.price !== 'number') {
        socket.emit('mmo_auction_error', { message: 'Invalid request' });
        return;
      }

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      if (_sellerLocks.has(key)) {
        socket.emit('mmo_auction_error', { message: 'Listing in progress' });
        return;
      }
      _sellerLocks.add(key);

      try {
        var amount = Math.floor(data.amount);
        var price = Math.floor(data.price);
        if (amount < 1 || amount > 9999) {
          socket.emit('mmo_auction_error', { message: 'Amount must be 1-9999' });
          return;
        }
        if (!isFinite(price) || price < 1 || price > 1000000) {
          socket.emit('mmo_auction_error', { message: 'Price must be 1-1,000,000 coins' });
          return;
        }

        if (listings.size >= MAX_TOTAL_LISTINGS) {
          socket.emit('mmo_auction_error', { message: 'Marketplace is full' });
          return;
        }
        if (countSellerListings(key) >= MAX_LISTINGS_PER_PLAYER) {
          socket.emit('mmo_auction_error', { message: 'Too many active listings' });
          return;
        }

        // Remove resources from seller
        var removed = accounts.removeResource(key, data.resource, amount);
        if (removed === null) {
          socket.emit('mmo_auction_error', { message: 'Not enough ' + data.resource.replace(/_/g, ' ') });
          return;
        }

        var displayName = data.resource.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });

        var listingId = 'MAH' + (nextId++);
        var listing = {
          id: listingId,
          sellerKey: key,
          sellerName: user.name,
          listingType: 'resource',
          name: displayName + ' x' + amount,
          resourceType: data.resource,
          amount: amount,
          price: price,
          listedAt: Date.now(),
          expiresAt: Date.now() + LISTING_EXPIRY_MS,
        };

        addListing(listing);
        _recordListing(listing);

        var resListResult = { listingId: listingId, name: listing.name, price: price };
        var resPriceWarning = _checkPriceDeviation(listing);
        if (resPriceWarning) resListResult.priceWarning = resPriceWarning;

        socket.emit('mmo_auction_listed', resListResult);
        debouncedAuctionUpdate(io);

        // --- Track daily challenge progress for auction listing ---
        challengesHandler.trackChallengeProgress(accounts, key, 'auction_list', 1);
      } finally {
        _sellerLocks.delete(key);
      }
    });

    // --- mmo_auction_buy: purchase a listing ---
    socket.on('mmo_auction_buy', function(data) {
      if (!applyRateGrace(socket, 'mmo_auction', 60, 10000)) return;
      if (!data || typeof data.listingId !== 'string') return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      if (purchaseLocks.has(key)) {
        socket.emit('mmo_auction_error', { message: 'Transaction in progress' });
        return;
      }
      if (listingLocks.has(data.listingId)) {
        socket.emit('mmo_auction_error', { message: 'Being purchased by another player' });
        return;
      }

      purchaseLocks.add(key);
      listingLocks.add(data.listingId);

      // Seller lock will be added once we know the seller key
      var sellerLocked = false;
      var sellerKeyToUnlock = null;

      try {
        var listing = listings.get(data.listingId);
        if (!listing) {
          socket.emit('mmo_auction_error', { message: 'Listing not found' });
          return;
        }
        if (listing.sellerKey === key) {
          socket.emit('mmo_auction_error', { message: 'Cannot buy your own listing' });
          return;
        }

        // Lock seller to prevent concurrent resource manipulation
        if (purchaseLocks.has(listing.sellerKey)) {
          socket.emit('mmo_auction_error', { message: 'Seller is in another transaction' });
          return;
        }
        purchaseLocks.add(listing.sellerKey);
        sellerKeyToUnlock = listing.sellerKey;
        sellerLocked = true;
        if (Date.now() > listing.expiresAt) {
          removeListing(data.listingId);
          socket.emit('mmo_auction_error', { message: 'Listing expired' });
          return;
        }

        var acc = accounts.loadAccount(key);
        if (!acc || (acc.chips || 0) < listing.price) {
          socket.emit('mmo_auction_error', { message: 'Not enough coins (need ' + listing.price + ')' });
          return;
        }

        // Pre-validate capacity BEFORE any money operations
        if (listing.listingType === 'card' && listing.cardData) {
          if (!acc.rpgCards) acc.rpgCards = [];
          if (acc.rpgCards.length >= rpgData.MAX_CARD_COLLECTION) {
            socket.emit('mmo_auction_error', { message: 'Card collection full (' + rpgData.MAX_CARD_COLLECTION + ' max)' });
            return;
          }
        }

        var effectiveFee = getDynamicFee(listing.sellerKey, listing);
        var fee = Math.ceil(listing.price * effectiveFee / 100);
        var sellerProceeds = listing.price - fee;

        // Re-verify balance before committing
        var freshAcc = accounts.loadAccount(key);
        if (!freshAcc || (freshAcc.chips || 0) < listing.price) {
          socket.emit('mmo_auction_error', { message: 'Not enough coins (balance changed)' });
          return;
        }

        // Re-check card capacity with fresh account
        if (listing.listingType === 'card' && listing.cardData) {
          if (!freshAcc.rpgCards) freshAcc.rpgCards = [];
          if (freshAcc.rpgCards.length >= rpgData.MAX_CARD_COLLECTION) {
            socket.emit('mmo_auction_error', { message: 'Card collection full (' + rpgData.MAX_CARD_COLLECTION + ' max)' });
            return;
          }
        }

        // All checks passed — commit: remove listing, record sale, transfer
        removeListing(data.listingId);
        _recordSale(listing);

        accounts.updateChips(key, -listing.price);
        accounts.updateChips(listing.sellerKey, sellerProceeds);

        // Transfer item to buyer
        if (listing.listingType === 'card' && listing.cardData) {
          var buyerAcc = accounts.loadAccount(key);
          if (buyerAcc) {
            if (!buyerAcc.rpgCards) buyerAcc.rpgCards = [];
            listing.cardData.obtainedAt = Date.now();
            listing.cardData.source = 'auction_buy';
            buyerAcc.rpgCards.push(listing.cardData);
            accounts.saveAccount(buyerAcc);
          }
        } else if (listing.listingType === 'resource') {
          var resourceResult = accounts.addResource(key, listing.resourceType, listing.amount);
          if (resourceResult && resourceResult.error) {
            // Refund buyer and seller
            accounts.updateChips(key, listing.price);
            accounts.updateChips(listing.sellerKey, -sellerProceeds);
            addListing(listing);
            socket.emit('mmo_auction_error', { message: resourceResult.error });
            return;
          }
        }

        socket.emit('mmo_auction_bought', {
          listingId: data.listingId,
          name: listing.name,
          price: listing.price,
          coins: (accounts.loadAccount(key) || {}).chips || 0,
        });

        // Notify seller if online
        for (var entry of socketAccountMap) {
          if (entry[1] === listing.sellerKey) {
            io.to(entry[0]).emit('mmo_auction_sold', {
              listingId: data.listingId,
              name: listing.name,
              buyerName: user.name,
              proceeds: sellerProceeds,
            });
            break;
          }
        }

        debouncedAuctionUpdate(io);
      } finally {
        purchaseLocks.delete(key);
        listingLocks.delete(data.listingId);
        if (sellerLocked && sellerKeyToUnlock) purchaseLocks.delete(sellerKeyToUnlock);
      }
    });

    // --- mmo_auction_cancel: cancel your own listing ---
    socket.on('mmo_auction_cancel', function(data) {
      if (!applyRateGrace(socket, 'mmo_auction', 60, 10000)) return;
      if (!data || typeof data.listingId !== 'string') return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      if (_sellerLocks.has(key)) {
        socket.emit('mmo_auction_error', { message: 'Operation in progress' });
        return;
      }
      _sellerLocks.add(key);

      try {
        var listing = listings.get(data.listingId);
        if (!listing) {
          socket.emit('mmo_auction_error', { message: 'Listing not found' });
          return;
        }
        if (listing.sellerKey !== key) {
          socket.emit('mmo_auction_error', { message: 'Not your listing' });
          return;
        }

        var removed = removeListing(data.listingId);
        if (!removed) {
          socket.emit('mmo_auction_error', { message: 'Listing already removed' });
          return;
        }

        // Return items to seller
        if (removed.listingType === 'card' && removed.cardData) {
          var acc = accounts.loadAccount(key);
          if (acc) {
            if (!acc.rpgCards) acc.rpgCards = [];
            acc.rpgCards.push(removed.cardData);
            accounts.saveAccount(acc);
          }
        } else if (removed.listingType === 'resource') {
          accounts.addResource(key, removed.resourceType, removed.amount);
        }

        socket.emit('mmo_auction_cancelled', { listingId: data.listingId });
        debouncedAuctionUpdate(io);
      } finally {
        _sellerLocks.delete(key);
      }
    });

    // --- mmo_auction_market_price: get dynamic pricing info ---
    socket.on('mmo_auction_market_price', function(data) {
      if (!data || typeof data.itemKey !== 'string') return;
      var price = getMarketPrice(data.itemKey);
      socket.emit('mmo_auction_market_price', {
        itemKey: data.itemKey,
        market: price,
      });
    });

    // --- mmo_auction_market_health: get anti-monopoly market health ---
    socket.on('mmo_auction_market_health', function(data) {
      if (!data || typeof data.category !== 'string') return;
      var health = getMarketHealth(data.category);
      socket.emit('mmo_auction_market_health', {
        category: data.category,
        health: health,
      });
    });

    // --- mmo_auction_my_listings: get your own listings (uses seller index) ---
    socket.on('mmo_auction_my_listings', function() {
      if (!applyRateGrace(socket, 'mmo_auction', 60, 10000)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      cleanExpired();

      var results = [];
      var sellerSet = sellerIndex.get(key);
      if (sellerSet) {
        for (var listingId of sellerSet) {
          var listing = listings.get(listingId);
          if (listing) {
            results.push({
              id: listing.id,
              listingType: listing.listingType,
              name: listing.name,
              rarity: listing.rarity || null,
              price: listing.price,
              listedAt: listing.listedAt,
              expiresAt: listing.expiresAt,
            });
          }
        }
      }

      socket.emit('mmo_auction_my_results', { listings: results });
    });
  }
};
