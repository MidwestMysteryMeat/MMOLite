// handlers/knowledge.js
// Knowledge system handler — glossary terms, world lore, books, codex.
// Handles: knowledge_get, knowledge_read_book
// Push events: knowledge_book_discovered, knowledge_term_unlocked

var glossary = require('../lore-glossary');
var world = require('../lore-world');
var books = require('../lore-books');

var _io = null;
var _accounts = null;

// ---------------------------------------------------------------------------
// Utility: lazy-init knowledge field on account
// ---------------------------------------------------------------------------
function ensureKnowledge(acc) {
  if (!acc.knowledge) {
    acc.knowledge = {
      glossaryUnlocked: [],
      booksDiscovered: [],
      glossaryTriggersFired: [],
    };
  }
  // Backfill missing fields for old accounts
  if (!acc.knowledge.glossaryUnlocked) acc.knowledge.glossaryUnlocked = [];
  if (!acc.knowledge.booksDiscovered) acc.knowledge.booksDiscovered = [];
  if (!acc.knowledge.glossaryTriggersFired) acc.knowledge.glossaryTriggersFired = [];
  return acc.knowledge;
}

// ---------------------------------------------------------------------------
// Utility: fire a glossary trigger — unlocks matching terms, returns newly unlocked
// ---------------------------------------------------------------------------
function fireGlossaryTrigger(accounts, accKey, trigger) {
  var acc = accounts.loadAccount(accKey);
  if (!acc) return [];
  var kn = ensureKnowledge(acc);

  // Don't re-fire the same trigger
  if (kn.glossaryTriggersFired.indexOf(trigger) >= 0) return [];
  kn.glossaryTriggersFired.push(trigger);

  var matching = glossary.getTermsForTrigger(trigger);
  var newlyUnlocked = [];
  for (var i = 0; i < matching.length; i++) {
    var term = matching[i];
    if (kn.glossaryUnlocked.indexOf(term.id) < 0) {
      kn.glossaryUnlocked.push(term.id);
      newlyUnlocked.push({ termId: term.id, term: term.term, category: term.category });
    }
  }

  // Also unlock terms that have null trigger (always available)
  var alwaysAvailable = glossary.getTermsForTrigger(null);
  for (var j = 0; j < alwaysAvailable.length; j++) {
    if (kn.glossaryUnlocked.indexOf(alwaysAvailable[j].id) < 0) {
      kn.glossaryUnlocked.push(alwaysAvailable[j].id);
      // Don't push these to newlyUnlocked — they're baseline
    }
  }

  accounts.saveAccount(acc);
  return newlyUnlocked;
}

// ---------------------------------------------------------------------------
// Utility: discover a book — add to account, check codex, fire term unlocks
// ---------------------------------------------------------------------------
function discoverBook(accounts, accKey, bookId) {
  var acc = accounts.loadAccount(accKey);
  if (!acc) return null;
  var kn = ensureKnowledge(acc);

  // Already discovered
  if (kn.booksDiscovered.indexOf(bookId) >= 0) return null;

  var book = books.getBookById(bookId);
  if (!book) return null;

  kn.booksDiscovered.push(bookId);

  // Unlock glossary terms tied to this book
  var unlockedTerms = [];
  if (book.unlocksTerms && book.unlocksTerms.length > 0) {
    for (var i = 0; i < book.unlocksTerms.length; i++) {
      var termId = book.unlocksTerms[i];
      if (kn.glossaryUnlocked.indexOf(termId) < 0) {
        kn.glossaryUnlocked.push(termId);
        var termObj = glossary.getTerm(termId);
        if (termObj) {
          unlockedTerms.push({ termId: termObj.id, term: termObj.term, category: termObj.category });
        }
      }
    }
  }

  // Fire book_discover trigger for glossary
  var triggerTerms = fireGlossaryTrigger(accounts, accKey, 'book_discover:' + bookId);
  for (var t = 0; t < triggerTerms.length; t++) {
    unlockedTerms.push(triggerTerms[t]);
  }

  // Check codex assembly
  var codexProgress = books.getCodexProgress(kn.booksDiscovered);

  accounts.saveAccount(acc);

  return {
    book: { id: book.id, title: book.title, rarity: book.rarity, category: book.category },
    unlockedTerms: unlockedTerms,
    codexComplete: codexProgress.isComplete,
    codexProgress: codexProgress.fragmentsFound,
    codexTotal: codexProgress.fragmentsTotal,
  };
}

// ---------------------------------------------------------------------------
// Handler init
// ---------------------------------------------------------------------------
function init(io, socket, deps) {
  var { socketAccountMap, accounts, applyRateGrace } = deps;

  if (!_io) _io = io;
  if (!_accounts) _accounts = accounts;

  // ------------------------------------------------------------------
  // knowledge_get — client requests a tab's data
  // ------------------------------------------------------------------
  socket.on('knowledge_get', function(data) {
    try {
      if (!applyRateGrace(socket, 'knowledge_get', 10, 3000)) return;
      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;
      var acc = accounts.loadAccount(accKey);
      if (!acc) return;

      var kn = ensureKnowledge(acc);

      // Ensure baseline (null trigger) terms are unlocked
      var alwaysAvailable = glossary.getTermsForTrigger(null);
      var needsSave = false;
      for (var i = 0; i < alwaysAvailable.length; i++) {
        if (kn.glossaryUnlocked.indexOf(alwaysAvailable[i].id) < 0) {
          kn.glossaryUnlocked.push(alwaysAvailable[i].id);
          needsSave = true;
        }
      }
      if (needsSave) accounts.saveAccount(acc);

      var tab = (data && data.tab) ? data.tab : 'glossary';
      var payload = { tab: tab };

      switch (tab) {
        case 'glossary':
          // Send all terms + which ones are unlocked
          payload.glossaryTerms = glossary.GLOSSARY_TERMS;
          payload.glossaryUnlocked = kn.glossaryUnlocked;
          break;

        case 'lore':
          payload.loreData = {
            timeline: world.WORLD_HISTORY.timeline,
            eras: world.WORLD_HISTORY.eras,
            races: world.RACE_LORE,
            factions: world.FACTION_LORE,
            geography: world.GEOGRAPHY,
          };
          break;

        case 'books':
          // Send book metadata (not full content) for discovered books
          var discoveredBooks = [];
          for (var b = 0; b < kn.booksDiscovered.length; b++) {
            var bk = books.getBookById(kn.booksDiscovered[b]);
            if (bk) {
              discoveredBooks.push({
                id: bk.id, title: bk.title, author: bk.author,
                category: bk.category, rarity: bk.rarity, condition: bk.condition,
                dangerous: bk.dangerous, partOfCodex: bk.partOfCodex,
              });
            }
          }
          payload.books = discoveredBooks;
          break;

        case 'codex':
          payload.codex = books.getCodexProgress(kn.booksDiscovered);
          break;

        default:
          payload.glossaryTerms = glossary.GLOSSARY_TERMS;
          payload.glossaryUnlocked = kn.glossaryUnlocked;
          break;
      }

      socket.emit('knowledge_data', payload);
    } catch (err) {
      console.error('[knowledge_get] Error:', err.message);
    }
  });

  // ------------------------------------------------------------------
  // knowledge_read_book — client requests full book content
  // ------------------------------------------------------------------
  socket.on('knowledge_read_book', function(data) {
    try {
      if (!applyRateGrace(socket, 'knowledge_read_book', 10, 3000)) return;
      if (!data || !data.bookId) return;
      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;
      var acc = accounts.loadAccount(accKey);
      if (!acc) return;

      var kn = ensureKnowledge(acc);

      // Must have discovered the book
      if (kn.booksDiscovered.indexOf(data.bookId) < 0) {
        socket.emit('knowledge_book_content', { error: 'Book not discovered' });
        return;
      }

      var book = books.getBookById(data.bookId);
      if (!book) {
        socket.emit('knowledge_book_content', { error: 'Book not found' });
        return;
      }

      socket.emit('knowledge_book_content', {
        bookId: book.id,
        title: book.title,
        author: book.author,
        content: book.content,
        rarity: book.rarity,
        category: book.category,
        dangerous: book.dangerous,
      });
    } catch (err) {
      console.error('[knowledge_read_book] Error:', err.message);
    }
  });
}

module.exports = {
  init: init,
  ensureKnowledge: ensureKnowledge,
  fireGlossaryTrigger: fireGlossaryTrigger,
  discoverBook: discoverBook,
};
