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

  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, applyRateGrace } = deps;
    if (!_accounts) _accounts = accounts; // capture accounts ref for cleanExpired

    // Track auction viewers for scoped update broadcasts
    // When the client sends mmo_auction_browse, it means the auction UI is open.
    // The client also sends auction_close when closing the panel (if supported).
    // Clean up on disconnect to prevent stale entries.
    socket.on('auction_close', function() { _auctionViewers.delete(socket.id); });
    socket.on('disconnect', function() { _auctionViewers.delete(socket.id); });

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

        socket.emit('mmo_auction_listed', { listingId: listingId, name: card.name, price: price });
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

        socket.emit('mmo_auction_listed', { listingId: listingId, name: listing.name, price: price });
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

        // Execute purchase
        removeListing(data.listingId);

        var fee = Math.ceil(listing.price * LISTING_FEE_PERCENT / 100);
        var sellerProceeds = listing.price - fee;

        // Deduct buyer (re-verify balance atomically to prevent race condition BUG-3)
        var freshAcc = accounts.loadAccount(key);
        if (!freshAcc || (freshAcc.chips || 0) < listing.price) {
          // Balance changed between check and deduction — restore listing
          addListing(listing);
          socket.emit('mmo_auction_error', { message: 'Not enough coins (balance changed)' });
          return;
        }

        // Re-check card capacity with fresh account (may have changed)
        if (listing.listingType === 'card' && listing.cardData) {
          if (!freshAcc.rpgCards) freshAcc.rpgCards = [];
          if (freshAcc.rpgCards.length >= rpgData.MAX_CARD_COLLECTION) {
            addListing(listing);
            socket.emit('mmo_auction_error', { message: 'Card collection full (' + rpgData.MAX_CARD_COLLECTION + ' max)' });
            return;
          }
        }

        accounts.updateChips(key, -listing.price);
        // Pay seller
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
          accounts.addResource(key, listing.resourceType, listing.amount);
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
