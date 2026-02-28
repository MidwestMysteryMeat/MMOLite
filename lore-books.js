var { BOOKS, CODEX_FRAGMENTS, CODEX_ASSEMBLED } = require('./lore-books-data');

// ---------------------------------------------------------------------------
// BOOK INDEX (for fast lookup)
// ---------------------------------------------------------------------------
var _bookIndex = {};
for (var bi = 0; bi < BOOKS.length; bi++) {
  _bookIndex[BOOKS[bi].id] = BOOKS[bi];
}

// ---------------------------------------------------------------------------
// QUERY FUNCTIONS
// ---------------------------------------------------------------------------

function getBookById(id) {
  return _bookIndex[id] || null;
}

function getBooksByCategory(cat) {
  if (!cat) return [];
  return BOOKS.filter(function(b) { return b.category === cat; });
}

function getAllBooks() {
  return BOOKS;
}

function getCodexProgress(discoveredBookIds) {
  if (!discoveredBookIds) discoveredBookIds = [];
  var found = CODEX_FRAGMENTS.filter(function(id) {
    return discoveredBookIds.indexOf(id) >= 0;
  });
  return {
    fragmentsFound: found.length,
    fragmentsTotal: CODEX_FRAGMENTS.length,
    fragments: CODEX_FRAGMENTS.map(function(id) {
      return { id: id, found: discoveredBookIds.indexOf(id) >= 0 };
    }),
    isComplete: found.length >= CODEX_FRAGMENTS.length,
    assembledCodex: found.length >= CODEX_FRAGMENTS.length ? CODEX_ASSEMBLED : null,
  };
}

// ---------------------------------------------------------------------------
// DROP TABLE
// ---------------------------------------------------------------------------

// Base drop chances by chest tier
var CHEST_DROP_CHANCES = {
  common: 0.03,
  uncommon: 0.06,
  rare: 0.12,
  legendary: 0.20,
};

// Rarity weights for book selection (higher weight = more likely)
var RARITY_WEIGHTS = {
  common: 50,
  uncommon: 30,
  rare: 15,
  ultra_rare: 8,
  mythic_rare: 4,
  legendary: 2,
  godly: 0.5,
};

/**
 * Roll for a book drop from a chest or boss kill.
 * @param {string} chestTier - 'common', 'uncommon', 'rare', 'legendary'
 * @param {number} floorNum - Current dungeon floor number
 * @param {string|null} floorTheme - Current floor theme (e.g. 'castle', 'void')
 * @param {boolean} isBossKill - Whether this is a boss kill drop
 * @returns {string|null} Book ID if a book drops, null otherwise
 */
function rollBookDrop(chestTier, floorNum, floorTheme, isBossKill) {
  // Determine base drop chance
  var baseChance = isBossKill ? 0.35 : (CHEST_DROP_CHANCES[chestTier] || 0.03);

  // Roll for drop
  if (Math.random() > baseChance) return null;

  // Filter eligible books
  var eligible = [];
  for (var i = 0; i < BOOKS.length; i++) {
    var book = BOOKS[i];

    // Check min floor
    if (floorNum < book.minFloor) continue;

    // Check theme restriction
    if (book.themeRestriction && book.themeRestriction.length > 0) {
      if (!floorTheme || book.themeRestriction.indexOf(floorTheme) < 0) continue;
    }

    // Determine weight
    var weight = RARITY_WEIGHTS[book.rarity] || 1;

    // Boss kills slightly favor rarer books
    if (isBossKill && (book.rarity === 'rare' || book.rarity === 'ultra_rare' || book.rarity === 'mythic_rare' || book.rarity === 'legendary')) {
      weight *= 1.5;
    }

    // Deep floors slightly favor rarer books
    if (floorNum >= 20) {
      if (book.rarity === 'rare' || book.rarity === 'ultra_rare' || book.rarity === 'mythic_rare' || book.rarity === 'legendary') {
        weight *= 1.3;
      }
    }

    eligible.push({ book: book, weight: weight });
  }

  if (eligible.length === 0) return null;

  // Weighted random selection
  var totalWeight = 0;
  for (var w = 0; w < eligible.length; w++) {
    totalWeight += eligible[w].weight;
  }

  var roll = Math.random() * totalWeight;
  var cumulative = 0;
  for (var s = 0; s < eligible.length; s++) {
    cumulative += eligible[s].weight;
    if (roll <= cumulative) {
      return eligible[s].book.id;
    }
  }

  // Fallback (shouldn't reach here)
  return eligible[eligible.length - 1].book.id;
}

// ---------------------------------------------------------------------------
// MODULE EXPORT
// ---------------------------------------------------------------------------
module.exports = {
  BOOKS: BOOKS,
  CODEX_FRAGMENTS: CODEX_FRAGMENTS,
  CODEX_ASSEMBLED: CODEX_ASSEMBLED,
  getBookById: getBookById,
  getBooksByCategory: getBooksByCategory,
  getAllBooks: getAllBooks,
  getCodexProgress: getCodexProgress,
  rollBookDrop: rollBookDrop,
};