// loot.js — Loot system for BossCord
// Items, lootboxes, lucky scrolls, rarity tables

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
var dataDir = require('./data-dir');

// ─── Rarity definitions ───
const RARITIES = {
  common:     { name: 'Common',     color: '#9e9e9e', weight: 50, sellValue: 5 },
  uncommon:   { name: 'Uncommon',   color: '#57f287', weight: 24, sellValue: 15 },
  rare:       { name: 'Rare',       color: '#5865f2', weight: 12, sellValue: 50 },
  super_rare: { name: 'Super Rare', color: '#00d4ff', weight: 6,  sellValue: 100 },
  epic:       { name: 'Epic',       color: '#9b59b6', weight: 4,  sellValue: 200 },
  legendary:  { name: 'Legendary',  color: '#f0b232', weight: 2,  sellValue: 500 },
  mythic:     { name: 'Mythic',     color: '#ff4444', weight: 0.5, sellValue: 2000 },
};

// ─── Item Modifiers ───
const MODIFIERS = {
  shiny:     { name: 'Shiny',     color: '#fffacd', multiplier: 1.5, chance: 0.08 },
  ancient:   { name: 'Ancient',   color: '#8B7355', multiplier: 2.0, chance: 0.05 },
  cursed:    { name: 'Cursed',    color: '#6a0dad', multiplier: 0.5, chance: 0.07 },
  blessed:   { name: 'Blessed',   color: '#ffd700', multiplier: 1.8, chance: 0.04 },
  glowing:   { name: 'Glowing',   color: '#39ff14', multiplier: 1.3, chance: 0.10 },
  pristine:  { name: 'Pristine',  color: '#e0ffff', multiplier: 1.4, chance: 0.06 },
  corrupted: { name: 'Corrupted', color: '#4b0082', multiplier: 0.7, chance: 0.06 },
  infernal:  { name: 'Infernal',  color: '#ff4500', multiplier: 2.5, chance: 0.02 },
  celestial: { name: 'Celestial', color: '#87ceeb', multiplier: 3.0, chance: 0.01 },
  void:      { name: 'Void',      color: '#1a0033', multiplier: 2.0, chance: 0.03 },
};

// Crypto-safe random float [0, 1) and integer [0, max)
function _crand() { return crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function _crandInt(max) { return crypto.randomInt(max); }

function rollModifier() {
  var roll = _crand();
  var cumulative = 0;
  for (var key in MODIFIERS) {
    cumulative += MODIFIERS[key].chance;
    if (roll < cumulative) return key;
  }
  return null; // ~48% chance of no modifier
}

function getModifierInfo(modKey) {
  if (!modKey) return null;
  return MODIFIERS[modKey] || null;
}

// ─── Serial Numbers ───
var SERIAL_FILE = path.join(dataDir.DATA_DIR, 'serial_counter.json');

function loadSerialCounter() {
  try {
    if (fs.existsSync(SERIAL_FILE)) {
      return JSON.parse(fs.readFileSync(SERIAL_FILE, 'utf8'));
    }
  } catch (_) {}
  return { counter: 0 };
}

function saveSerialCounter(state) {
  try {
    var dir = path.dirname(SERIAL_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SERIAL_FILE, JSON.stringify(state), 'utf8');
  } catch (err) {
    console.error('[loot] Serial counter save error:', err.message);
  }
}

var _serialState = loadSerialCounter();
var _serialDirty = false;
var _serialFlushTimer = null;

// Write-behind: flush dirty serial counter to disk every 2 seconds
function _scheduleSerialFlush() {
  if (_serialFlushTimer) return;
  _serialFlushTimer = setTimeout(function() {
    _serialFlushTimer = null;
    if (_serialDirty) {
      _serialDirty = false;
      saveSerialCounter(_serialState);
    }
  }, 2000);
}

// Synchronous flush for shutdown
function flushSerialCounter() {
  if (_serialFlushTimer) { clearTimeout(_serialFlushTimer); _serialFlushTimer = null; }
  if (_serialDirty) {
    _serialDirty = false;
    saveSerialCounter(_serialState);
  }
}

function generateSerial() {
  _serialState.counter++;
  if (_serialState.counter > Number.MAX_SAFE_INTEGER) _serialState.counter = 1;
  _serialDirty = true;
  _scheduleSerialFlush();

  var num = _serialState.counter;
  var prefixNum = Math.floor((num - 1) / 9999);
  var seqNum = ((num - 1) % 9999) + 1;

  var prefix = '';
  var p = prefixNum;
  do {
    prefix = String.fromCharCode(65 + (p % 26)) + prefix;
    p = Math.floor(p / 26) - 1;
  } while (p >= 0);

  return '#' + prefix + String(seqNum).padStart(4, '0');
}

// ─── Item catalog ───
const ITEMS = [
  // ═══ BADGES (emoji shown next to name in chat) ═══
  // Common
  { id: 'badge_seedling',  name: 'Seedling',  type: 'badge', rarity: 'common',    icon: '\u{1F331}' },
  { id: 'badge_pebble',    name: 'Pebble',    type: 'badge', rarity: 'common',    icon: '\u{1FAA8}' },
  { id: 'badge_raindrop',  name: 'Raindrop',  type: 'badge', rarity: 'common',    icon: '\u{1F4A7}' },
  { id: 'badge_leaf',      name: 'Leaf',      type: 'badge', rarity: 'common',    icon: '\u{1F343}' },
  { id: 'badge_shell',     name: 'Shell',     type: 'badge', rarity: 'common',    icon: '\u{1F41A}' },
  { id: 'badge_mushroom',  name: 'Mushroom',  type: 'badge', rarity: 'common',    icon: '\u{1F344}' },
  { id: 'badge_acorn',     name: 'Acorn',     type: 'badge', rarity: 'common',    icon: '\u{1F330}' },
  { id: 'badge_feather',   name: 'Feather',   type: 'badge', rarity: 'common',    icon: '\u{1FAB6}' },
  // Uncommon
  { id: 'badge_star',      name: 'Star',      type: 'badge', rarity: 'uncommon',  icon: '\u2B50' },
  { id: 'badge_moon',      name: 'Moon',      type: 'badge', rarity: 'uncommon',  icon: '\u{1F319}' },
  { id: 'badge_flame',     name: 'Flame',     type: 'badge', rarity: 'uncommon',  icon: '\u{1F525}' },
  { id: 'badge_snowflake', name: 'Snowflake', type: 'badge', rarity: 'uncommon',  icon: '\u2744\uFE0F' },
  { id: 'badge_bolt',      name: 'Bolt',      type: 'badge', rarity: 'uncommon',  icon: '\u26A1' },
  { id: 'badge_clover',    name: 'Clover',    type: 'badge', rarity: 'uncommon',  icon: '\u{1F340}' },
  // Rare
  { id: 'badge_crown',     name: 'Crown',     type: 'badge', rarity: 'rare',      icon: '\u{1F451}' },
  { id: 'badge_diamond',   name: 'Diamond',   type: 'badge', rarity: 'rare',      icon: '\u{1F48E}' },
  { id: 'badge_skull',     name: 'Skull',     type: 'badge', rarity: 'rare',      icon: '\u{1F480}' },
  { id: 'badge_fox',       name: 'Fox',       type: 'badge', rarity: 'rare',      icon: '\u{1F98A}' },
  // Epic
  { id: 'badge_dragon',    name: 'Dragon',    type: 'badge', rarity: 'epic',      icon: '\u{1F409}' },
  { id: 'badge_galaxy',    name: 'Galaxy',    type: 'badge', rarity: 'epic',      icon: '\u{1F30C}' },
  { id: 'badge_alien',     name: 'Alien',     type: 'badge', rarity: 'epic',      icon: '\u{1F47D}' },
  // Super Rare
  { id: 'badge_comet',     name: 'Comet',     type: 'badge', rarity: 'super_rare', icon: '\u2604\uFE0F' },
  { id: 'badge_crystal',   name: 'Crystal',   type: 'badge', rarity: 'super_rare', icon: '\u{1FA78}' },
  { id: 'badge_tornado',   name: 'Tornado',   type: 'badge', rarity: 'super_rare', icon: '\u{1F32A}\uFE0F' },
  // Legendary
  { id: 'badge_eye',       name: 'All-Seeing Eye', type: 'badge', rarity: 'legendary', icon: '\u{1F441}\uFE0F' },
  { id: 'badge_void',      name: 'Void',      type: 'badge', rarity: 'legendary', icon: '\u{1F573}\uFE0F' },
  // Mythic
  { id: 'badge_infinity',  name: 'Infinity',  type: 'badge', rarity: 'mythic', icon: '\u267E\uFE0F' },
  { id: 'badge_blackhole', name: 'Black Hole', type: 'badge', rarity: 'mythic', icon: '\u{1F30C}' },

  // ═══ TITLES (text displayed after username) ═══
  // Common
  { id: 'title_newcomer',   name: 'Newcomer',    type: 'title', rarity: 'common',    text: 'Newcomer' },
  { id: 'title_wanderer',   name: 'Wanderer',    type: 'title', rarity: 'common',    text: 'Wanderer' },
  { id: 'title_gambler',    name: 'Gambler',     type: 'title', rarity: 'common',    text: 'Gambler' },
  { id: 'title_lurker',     name: 'Lurker',      type: 'title', rarity: 'common',    text: 'Lurker' },
  { id: 'title_drifter',    name: 'Drifter',     type: 'title', rarity: 'common',    text: 'Drifter' },
  { id: 'title_tourist',    name: 'Tourist',     type: 'title', rarity: 'common',    text: 'Tourist' },
  // Uncommon
  { id: 'title_highroller', name: 'High Roller', type: 'title', rarity: 'uncommon',  text: 'High Roller' },
  { id: 'title_nightowl',   name: 'Night Owl',   type: 'title', rarity: 'uncommon',  text: 'Night Owl' },
  { id: 'title_luckyshot',  name: 'Lucky Shot',  type: 'title', rarity: 'uncommon',  text: 'Lucky Shot' },
  { id: 'title_hustler',    name: 'Hustler',     type: 'title', rarity: 'uncommon',  text: 'Hustler' },
  // Rare
  { id: 'title_cardshark',  name: 'Card Shark',  type: 'title', rarity: 'rare',      text: 'Card Shark' },
  { id: 'title_shadow',     name: 'Shadow',      type: 'title', rarity: 'rare',      text: 'Shadow' },
  { id: 'title_goldentouch',name: 'Golden Touch', type: 'title', rarity: 'rare',     text: 'Golden Touch' },
  // Epic
  { id: 'title_kingpin',    name: 'Kingpin',     type: 'title', rarity: 'epic',      text: 'Kingpin' },
  { id: 'title_phantom',    name: 'Phantom',     type: 'title', rarity: 'epic',      text: 'Phantom' },
  // Super Rare
  { id: 'title_warlord',    name: 'Warlord',     type: 'title', rarity: 'super_rare', text: 'Warlord' },
  { id: 'title_prophet',    name: 'Prophet',     type: 'title', rarity: 'super_rare', text: 'Prophet' },
  // Legendary
  { id: 'title_theboss',    name: 'The Boss',    type: 'title', rarity: 'legendary', text: 'The Boss' },
  // Mythic
  { id: 'title_godslayer',  name: 'Godslayer',   type: 'title', rarity: 'mythic', text: 'Godslayer' },
  { id: 'title_immortal',   name: 'Immortal',    type: 'title', rarity: 'mythic', text: 'Immortal' },

  // ═══ WEAPONS (collectible weapon items) ═══
  // Common
  { id: 'wpn_arrow1',       name: 'Wooden Arrow',     type: 'weapon', rarity: 'common',    icon: '\u{1F3F9}', img: '/icons/weapons/Arrow_01.PNG' },
  { id: 'wpn_arrow5',       name: 'Iron Arrow',       type: 'weapon', rarity: 'common',    icon: '\u{1F3F9}', img: '/icons/weapons/Arrow_05.PNG' },
  { id: 'wpn_dagger1',      name: 'Rusty Dagger',     type: 'weapon', rarity: 'common',    icon: '\u{1F5E1}\uFE0F', img: '/icons/weapons/Dagger_01.PNG' },
  { id: 'wpn_dagger3',      name: 'Bronze Dagger',    type: 'weapon', rarity: 'common',    icon: '\u{1F5E1}\uFE0F', img: '/icons/weapons/Dagger_03.PNG' },
  { id: 'wpn_sword1',       name: 'Short Sword',      type: 'weapon', rarity: 'common',    icon: '\u2694\uFE0F', img: '/icons/weapons/Sword_01.PNG' },
  { id: 'wpn_sword3',       name: 'Iron Sword',       type: 'weapon', rarity: 'common',    icon: '\u2694\uFE0F', img: '/icons/weapons/Sword_03.PNG' },
  { id: 'wpn_bow1',         name: 'Hunting Bow',      type: 'weapon', rarity: 'common',    icon: '\u{1F3F9}', img: '/icons/weapons/Bow_01.PNG' },
  { id: 'wpn_spear1',       name: 'Wooden Spear',     type: 'weapon', rarity: 'common',    icon: '\u{1F531}', img: '/icons/weapons/Spear_01.PNG' },
  // Uncommon
  { id: 'wpn_axe3',         name: 'Battle Axe',       type: 'weapon', rarity: 'uncommon',  icon: '\u{1FA93}', img: '/icons/weapons/Axe_03.PNG' },
  { id: 'wpn_axe7',         name: 'War Axe',          type: 'weapon', rarity: 'uncommon',  icon: '\u{1FA93}', img: '/icons/weapons/Axe_07.PNG' },
  { id: 'wpn_sword8',       name: 'Steel Longsword',  type: 'weapon', rarity: 'uncommon',  icon: '\u2694\uFE0F', img: '/icons/weapons/Sword_08.PNG' },
  { id: 'wpn_shield3',      name: 'Iron Shield',      type: 'weapon', rarity: 'uncommon',  icon: '\u{1F6E1}\uFE0F', img: '/icons/weapons/shield_03.PNG' },
  { id: 'wpn_bow5',         name: 'Composite Bow',    type: 'weapon', rarity: 'uncommon',  icon: '\u{1F3F9}', img: '/icons/weapons/Bow_05.PNG' },
  { id: 'wpn_hammer3',      name: 'War Hammer',       type: 'weapon', rarity: 'uncommon',  icon: '\u{1F528}', img: '/icons/weapons/Hammer_03.PNG' },
  // Rare
  { id: 'wpn_crossbow3',    name: 'Heavy Crossbow',   type: 'weapon', rarity: 'rare',      icon: '\u{1F3F9}', img: '/icons/weapons/Crossbow_03.PNG' },
  { id: 'wpn_staff5',       name: 'Arcane Staff',     type: 'weapon', rarity: 'rare',      icon: '\u{1FA84}', img: '/icons/weapons/staff_5.PNG' },
  { id: 'wpn_sword15',      name: 'Flameblade',       type: 'weapon', rarity: 'rare',      icon: '\u2694\uFE0F', img: '/icons/weapons/Sword_15.PNG' },
  { id: 'wpn_axe12',        name: 'Berserker Axe',    type: 'weapon', rarity: 'rare',      icon: '\u{1FA93}', img: '/icons/weapons/Axe_12.PNG' },
  { id: 'wpn_shield8',      name: 'Tower Shield',     type: 'weapon', rarity: 'rare',      icon: '\u{1F6E1}\uFE0F', img: '/icons/weapons/shield_08.PNG' },
  // Epic
  { id: 'wpn_scythe3',      name: 'Death Scythe',     type: 'weapon', rarity: 'epic',      icon: '\u{1F319}', img: '/icons/weapons/Scythe_03.PNG' },
  { id: 'wpn_sword20',      name: 'Voidblade',        type: 'weapon', rarity: 'epic',      icon: '\u2694\uFE0F', img: '/icons/weapons/Sword_20.PNG' },
  { id: 'wpn_staff10',      name: 'Elder Staff',      type: 'weapon', rarity: 'epic',      icon: '\u{1FA84}', img: '/icons/weapons/staff_10.PNG' },
  // Super Rare
  { id: 'wpn_wand3',         name: 'Mystic Wand',      type: 'weapon', rarity: 'super_rare', icon: '\u{1FA84}', img: '/icons/weapons/Wand.PNG' },
  { id: 'wpn_sword12',       name: 'Runeblade',        type: 'weapon', rarity: 'super_rare', icon: '\u2694\uFE0F', img: '/icons/weapons/Sword_12.PNG' },
  { id: 'wpn_hook3',         name: 'Chain Hook',       type: 'weapon', rarity: 'super_rare', icon: '\u{1FA9D}', img: '/icons/weapons/Hook.PNG' },
  // Legendary
  { id: 'wpn_sword25',      name: 'Excalibur',        type: 'weapon', rarity: 'legendary', icon: '\u2694\uFE0F', img: '/icons/weapons/Sword_25.PNG' },
  { id: 'wpn_scythe5',      name: 'Soul Reaper',      type: 'weapon', rarity: 'legendary', icon: '\u{1F319}', img: '/icons/weapons/Scythe_05.PNG' },
  // Mythic
  { id: 'wpn_sword30',      name: 'Worldender',       type: 'weapon', rarity: 'mythic', icon: '\u2694\uFE0F', img: '/icons/weapons/Sword_30.PNG' },
  { id: 'wpn_staff15',      name: 'Staff of Eternity', type: 'weapon', rarity: 'mythic', icon: '\u{1FA84}', img: '/icons/weapons/staff_15.PNG' },

  // ═══ SPELLBOOKS (BossBrawl spell abilities) ═══
  // Common (5)
  { id: 'spell_haste',       name: 'Tome of Haste',        type: 'spellbook', rarity: 'common',     icon: '\u2B50',              img: '/icons/books/Book_1.PNG', spellId: 'haste' },
  { id: 'spell_cleave',      name: 'Tome of Cleave',       type: 'spellbook', rarity: 'common',     icon: '\u{1F4D6}',           img: '/icons/books/Book_2.PNG', spellId: 'arcane_cleave' },
  { id: 'spell_scatter',     name: 'Tome of Scatter',      type: 'spellbook', rarity: 'common',     icon: '\u{1F3F9}',           img: '/icons/books/Book_3.PNG', spellId: 'scatter_shot' },
  { id: 'spell_tunnel',      name: 'Tome of Tunneling',    type: 'spellbook', rarity: 'common',     icon: '\u{1F30D}',           img: '/icons/books/Book_4.PNG', spellId: 'tunnel' },
  { id: 'spell_boomerang',   name: 'Tome of Boomerang',    type: 'spellbook', rarity: 'common',     icon: '\u{1F32C}\uFE0F',     img: '/icons/books/Book_5.PNG', spellId: 'boomerang' },
  // Uncommon (5)
  { id: 'spell_fireball',    name: 'Tome of Fireball',     type: 'spellbook', rarity: 'uncommon',   icon: '\u{1F525}',           img: '/icons/books/Book_6.PNG', spellId: 'fireball' },
  { id: 'spell_heal',        name: 'Tome of Healing',      type: 'spellbook', rarity: 'uncommon',   icon: '\u{1F49A}',           img: '/icons/books/Book_7.PNG', spellId: 'healing_light' },
  { id: 'spell_toxic',       name: 'Tome of Toxins',       type: 'spellbook', rarity: 'uncommon',   icon: '\u{1F30C}',           img: '/icons/books/Book_8.PNG', spellId: 'toxic_cloud' },
  { id: 'spell_beartrap',    name: 'Tome of Trapping',     type: 'spellbook', rarity: 'uncommon',   icon: '\u{1F30D}',           img: '/icons/books/Book_9.PNG', spellId: 'bear_trap' },
  { id: 'spell_volley',      name: 'Tome of Volleys',      type: 'spellbook', rarity: 'uncommon',   icon: '\u{1F3F9}',           img: '/icons/books/Book_10.PNG', spellId: 'arrow_volley' },
  // Rare (5)
  { id: 'spell_blink',       name: 'Tome of Blink',        type: 'spellbook', rarity: 'rare',       icon: '\u{1F4D6}',           img: '/icons/books/Book_11.PNG', spellId: 'blink' },
  { id: 'spell_lightning',   name: 'Tome of Lightning',    type: 'spellbook', rarity: 'rare',       icon: '\u26A1',              img: '/icons/books/Book_12.PNG', spellId: 'chain_lightning' },
  { id: 'spell_shield',      name: 'Tome of Shielding',    type: 'spellbook', rarity: 'rare',       icon: '\u{1F4D6}',           img: '/icons/books/Book_13.PNG', spellId: 'arcane_shield' },
  { id: 'spell_mines',       name: 'Tome of Mines',        type: 'spellbook', rarity: 'rare',       icon: '\u{1F525}',           img: '/icons/books/Book_14.PNG', spellId: 'mine_layer' },
  { id: 'spell_regen',       name: 'Tome of Regeneration', type: 'spellbook', rarity: 'rare',       icon: '\u{1F49A}',           img: '/icons/books/Book_15.PNG', spellId: 'regeneration' },
  // Epic (4)
  { id: 'spell_icewall',     name: 'Tome of Ice Wall',     type: 'spellbook', rarity: 'epic',       icon: '\u2744\uFE0F',        img: '/icons/books/Book_16.PNG', spellId: 'ice_wall' },
  { id: 'spell_gravity',     name: 'Tome of Gravity',      type: 'spellbook', rarity: 'epic',       icon: '\u{1F30C}',           img: '/icons/books/Book_17.PNG', spellId: 'gravity_well' },
  { id: 'spell_turret',      name: 'Tome of Summoning',    type: 'spellbook', rarity: 'epic',       icon: '\u{1F47B}',           img: '/icons/books/Book_18.PNG', spellId: 'summon_turret' },
  { id: 'spell_battlerage',  name: 'Tome of Battle Rage',  type: 'spellbook', rarity: 'epic',       icon: '\u2B50',              img: '/icons/books/Book_19.PNG', spellId: 'battle_rage' },
  // Super Rare (2)
  { id: 'spell_trueshot',    name: 'Tome of True Shot',    type: 'spellbook', rarity: 'super_rare', icon: '\u{1F3F9}',           img: '/icons/books/Book_20.PNG', spellId: 'true_shot' },
  { id: 'spell_invisibility',name: 'Tome of Invisibility', type: 'spellbook', rarity: 'super_rare', icon: '\u{1F30C}',           img: '/icons/books/Book_21.PNG', spellId: 'invisibility' },
  // Legendary (2)
  { id: 'spell_meteor',      name: 'Tome of Meteor Strike',type: 'spellbook', rarity: 'legendary',  icon: '\u{1F525}',           img: '/icons/books/Book_22.PNG', spellId: 'meteor_strike' },
  { id: 'spell_soulswap',    name: 'Tome of Soul Swap',    type: 'spellbook', rarity: 'legendary',  icon: '\u{1F30C}',           img: '/icons/books/Book_23.PNG', spellId: 'soul_swap' },
  // Mythic (2)
  { id: 'spell_earthquake',  name: 'Tome of Earthquake',   type: 'spellbook', rarity: 'mythic',     icon: '\u{1F30D}',           img: '/icons/books/Book_24.PNG', spellId: 'earthquake' },
  { id: 'spell_annihilation',name: 'Tome of Annihilation', type: 'spellbook', rarity: 'mythic',     icon: '\u{1F525}',           img: '/icons/books/Book_25.PNG', spellId: 'annihilation' },
];

// Index for fast lookup
const ITEM_MAP = new Map();
for (const item of ITEMS) ITEM_MAP.set(item.id, item);

// Items grouped by rarity
const ITEMS_BY_RARITY = {};
for (const r of Object.keys(RARITIES)) {
  ITEMS_BY_RARITY[r] = ITEMS.filter(i => i.rarity === r);
}

// Weapons grouped by rarity (for lootboxes)
const WEAPONS_BY_RARITY = {};
for (const r of Object.keys(RARITIES)) {
  WEAPONS_BY_RARITY[r] = ITEMS.filter(i => i.rarity === r && i.type === 'weapon');
}

// Spellbooks grouped by rarity (for lootboxes and BossBrawl)
const SPELLBOOKS_BY_RARITY = {};
for (const r of Object.keys(RARITIES)) {
  SPELLBOOKS_BY_RARITY[r] = ITEMS.filter(i => i.rarity === r && i.type === 'spellbook');
}

// ─── Random helpers ───

function weightedRandom(options) {
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = _crand() * total;
  for (const o of options) {
    r -= o.weight;
    if (r <= 0) return o.value;
  }
  return options[options.length - 1].value;
}

function rollRarity(boost) {
  boost = boost || 0;
  const options = Object.entries(RARITIES).map(([key, val]) => ({
    value: key,
    weight: key === 'common' ? Math.max(1, val.weight - boost) : val.weight + (boost / 4),
  }));
  return weightedRandom(options);
}

function rollItem(boost) {
  const rarity = rollRarity(boost);
  const pool = ITEMS_BY_RARITY[rarity];
  if (!pool || pool.length === 0) return ITEMS[0];
  return pool[_crandInt(pool.length)];
}

function rollWeapon(boost) {
  const rarity = rollRarity(boost);
  const pool = WEAPONS_BY_RARITY[rarity];
  if (!pool || pool.length === 0) {
    const allWeapons = ITEMS.filter(i => i.type === 'weapon');
    return allWeapons[_crandInt(allWeapons.length)];
  }
  return pool[_crandInt(pool.length)];
}

function rollSpellbook(boost) {
  const rarity = rollRarity(boost);
  const pool = SPELLBOOKS_BY_RARITY[rarity];
  if (!pool || pool.length === 0) {
    const allSpells = ITEMS.filter(i => i.type === 'spellbook');
    return allSpells[_crandInt(allSpells.length)];
  }
  return pool[_crandInt(pool.length)];
}

// ─── Lootbox ───

const LOOTBOX_TIERS = {
  bronze:   { id: 'bronze',   name: 'Bronze Box',   cost: 50,   items: 1, boost: 0,  color: '#cd7f32', img: '/icons/loot/Loot_101_chest.PNG' },
  rustic:   { id: 'rustic',   name: 'Rustic Box',   cost: 75,   items: 1, boost: 5,  color: '#a0522d', img: '/icons/loot/Blacksmith_51_wooden_chest.PNG' },
  silver:   { id: 'silver',   name: 'Silver Box',   cost: 150,  items: 2, boost: 10, color: '#c0c0c0', img: '/icons/loot/Loot_102_chest.PNG' },
  wooden:   { id: 'wooden',   name: 'Wooden Box',   cost: 200,  items: 2, boost: 15, color: '#8B4513', img: '/icons/loot/Blacksmith_52_wooden_chest.PNG' },
  red:      { id: 'red',      name: 'Red Box',      cost: 350,  items: 2, boost: 20, color: '#dc143c', img: '/icons/loot/Blacksmith_53_red_chest.PNG' },
  gold:     { id: 'gold',     name: 'Gold Box',     cost: 500,  items: 3, boost: 25, color: '#f0b232', img: '/icons/loot/Loot_103_chest.PNG' },
  iron:     { id: 'iron',     name: 'Iron Box',     cost: 800,  items: 3, boost: 30, color: '#71797E', img: '/icons/loot/Blacksmith_54_iron_chest.PNG' },
  platinum: { id: 'platinum', name: 'Platinum Box',  cost: 1500, items: 4, boost: 40, color: '#e5e4e2', img: '/icons/loot/Loot_104_chest.PNG' },
  royal:    { id: 'royal',    name: 'Royal Casket',  cost: 2000, items: 4, boost: 50, color: '#9b59b6', img: '/icons/loot/Blacksmith_56_royal_casket.PNG' },
  diamond:  { id: 'diamond',  name: 'Diamond Box',   cost: 3000, items: 5, boost: 55, color: '#b9f2ff', img: '/icons/loot/Loot_106_chest.PNG' },
  arcane:   { id: 'arcane',   name: 'Arcane Chest',  cost: 5000, items: 5, boost: 65, color: '#00bfff', img: '/icons/loot/Blacksmith_60_magic_chest.PNG' },
  mythic:   { id: 'mythic',   name: 'Mythic Box',    cost: 7500, items: 6, boost: 70, color: '#ff4444', img: '/icons/loot/Loot_107_chest.PNG', guaranteedLegendaryLast: true },
};

function openLootbox(tier) {
  const box = LOOTBOX_TIERS[tier];
  if (!box) return null;

  const items = [];
  for (let i = 0; i < box.items; i++) {
    let item;
    // Last item in mythic box: guaranteed legendary or mythic
    if (box.guaranteedLegendaryLast && i === box.items - 1) {
      var legendaryPool = ITEMS.filter(function(it) { return it.rarity === 'legendary' || it.rarity === 'mythic'; });
      if (legendaryPool.length > 0) {
        item = legendaryPool[_crandInt(legendaryPool.length)];
      } else {
        item = rollWeapon(box.boost);
      }
    } else {
      item = rollWeapon(box.boost);
    }

    var modifier = rollModifier();
    var serial = generateSerial();
    var modInfo = getModifierInfo(modifier);

    items.push({
      instanceId: crypto.randomBytes(6).toString('hex'),
      itemId: item.id,
      item: { id: item.id, name: item.name, type: item.type, rarity: item.rarity, icon: item.icon || null, img: item.img || null, text: item.text || null },
      modifier: modifier,
      modifierInfo: modInfo,
      serial: serial,
      obtainedAt: Date.now(),
      source: 'lootbox_' + tier,
    });
  }

  return { tier, box: { name: box.name, cost: box.cost, items: box.items, color: box.color }, items };
}

// ─── Lucky Scrolls ───

const SCRATCH_TIERS = {
  cheap:     { id: 'cheap',     name: 'Lucky Scroll',    cost: 25,   color: '#57f287' },
  standard:  { id: 'standard',  name: 'Gold Scroll',     cost: 100,  color: '#f0b232' },
  premium:   { id: 'premium',   name: 'Diamond Scroll',  cost: 250,  color: '#5865f2' },
  mystic:    { id: 'mystic',    name: 'Mystic Scroll',    cost: 500,  color: '#9b59b6', img: '/icons/items/Scroll_enchant.PNG' },
  fire:      { id: 'fire',      name: 'Fire Scroll',      cost: 750,  color: '#ff4500', img: '/icons/items/Scroll_fire.PNG' },
  shadow:    { id: 'shadow',    name: 'Shadow Scroll',    cost: 1000, color: '#4b0082', img: '/icons/items/Enchantment_38_shadow_scroll.PNG' },
  death:     { id: 'death',     name: 'Death Scroll',     cost: 2000, color: '#1a0033', img: '/icons/items/Enchantment_32_deathscroll.PNG' },
  demon:     { id: 'demon',     name: 'Demon Scroll',     cost: 3500, color: '#ff0000', img: '/icons/items/Enchantment_37_demon_scroll.PNG' },
  celestial: { id: 'celestial', name: 'Celestial Scroll', cost: 5000, color: '#87ceeb', img: '/icons/items/Enchantment_39_mana_scroll.PNG' },
};

const SCRATCH_SYMBOLS = [
  { id: 'cherry',  icon: '\u{1F352}', img: '/icons/items/Alchemy_13_heal_potion.PNG', multiplier: 1.5, weight: 35, tier: 0 },
  { id: 'lemon',   icon: '\u{1F34B}', img: '/icons/items/Alchemy_24_energy_potion.PNG', multiplier: 2,   weight: 30, tier: 0 },
  { id: 'star',    icon: '\u2B50',     img: '/icons/items/Alchemy_12_magic_potion.PNG', multiplier: 5,   weight: 20, tier: 0 },
  { id: 'diamond', icon: '\u{1F48E}', img: '/icons/loot/Loot_01_coins.PNG', multiplier: 10,  weight: 10, tier: 0 },
  { id: 'crown',   icon: '\u{1F451}', img: '/icons/loot/Loot_101_chest.PNG', multiplier: 25,  weight: 5,  tier: 0 },
  { id: 'dragon',  icon: '\u{1F409}', img: '/icons/loot/Claws.PNG', multiplier: 40,  weight: 3,  tier: 1 },
  { id: 'phoenix', icon: '\u{1F525}', img: '/icons/items/Alchemy_06_blood.PNG', multiplier: 75,  weight: 2,  tier: 2 },
  { id: 'boss',    icon: '\u{1F480}', img: '/icons/items/Alchemy_22_deadly_poison.PNG', multiplier: 100, weight: 1,  tier: 3 },
  { id: 'scroll',  icon: '\u{1F4DC}', img: '/icons/items/Enchantment_22_scroll.PNG',       multiplier: 50,  weight: 8,  tier: 1 },
  { id: 'rune',    icon: '\u{1F52E}', img: '/icons/items/Enchantment_33_runescroll.PNG',    multiplier: 75,  weight: 5,  tier: 2 },
  { id: 'shadow',  icon: '\u{1F311}', img: '/icons/items/Enchantment_38_shadow_scroll.PNG', multiplier: 120, weight: 3,  tier: 2 },
  { id: 'demon',   icon: '\u{1F47F}', img: '/icons/items/Enchantment_37_demon_scroll.PNG',  multiplier: 200, weight: 2,  tier: 3 },
  { id: 'summon',  icon: '\u26A1',    img: '/icons/items/Enchantment_34_summoning_scroll.PNG', multiplier: 350, weight: 1, tier: 3 },
];

const BASE_WIN_CHANCE = 0.30;
const BASE_LOOT_CHANCE = 0.10;

function generateScratchCard(tier, upgrades) {
  const cardTier = SCRATCH_TIERS[tier];
  if (!cardTier) return null;
  upgrades = upgrades || {};

  // Apply discount upgrade (max -30%)
  var discountMult = 1 - Math.min(0.30, (upgrades.scratchDiscount || 0) * 0.03);
  var cost = Math.max(1, Math.floor(cardTier.cost * discountMult));

  // Apply win/loot chance upgrades (capped conservatively)
  var winChance = Math.min(0.50, BASE_WIN_CHANCE + (upgrades.scratchWinChance || 0) * 0.02);
  var lootChance = Math.min(0.25, BASE_LOOT_CHANCE + (upgrades.scratchLootChance || 0) * 0.015);

  // Tier-based bonus: higher tiers get better win and loot chances
  var tierBonus = { cheap: 0, standard: 0, premium: 0, mystic: 0.05, fire: 0.08, shadow: 0.10, death: 0.15, demon: 0.18, celestial: 0.20 };
  var bonus = tierBonus[tier] || 0;
  winChance = Math.min(0.70, winChance + bonus);
  lootChance = Math.min(0.50, lootChance + bonus * 0.6);

  var isWin = _crand() < winChance;
  var hasLoot = _crand() < lootChance;

  // Filter symbols by unlock tier
  var symbolTier = upgrades.scratchSymbolTier || 0;
  var availableSymbols = SCRATCH_SYMBOLS.filter(function(s) { return s.tier <= symbolTier; });

  // Apply multiplier boost (+5% per level, not 10%)
  var multiBoost = 1 + (upgrades.scratchMultiBoost || 0) * 0.05;

  var cells = [];
  var winSymbol = null;
  var multiplier = 0;
  var lootItem = null;

  if (isWin) {
    // Pick winning symbol (weighted towards lower multipliers)
    winSymbol = weightedRandom(availableSymbols.map(function(s) {
      return { value: s, weight: s.weight };
    }));
    multiplier = winSymbol.multiplier * multiBoost;

    // Place 3 of the winning symbol in random positions
    var grid = new Array(9).fill(null);
    var winPositions = [];
    while (winPositions.length < 3) {
      var pos = _crandInt(9);
      if (winPositions.indexOf(pos) === -1) winPositions.push(pos);
    }
    for (var i = 0; i < winPositions.length; i++) {
      grid[winPositions[i]] = winSymbol;
    }

    // Fill remaining cells — no other triple
    var otherSymbols = availableSymbols.filter(function(s) { return s.id !== winSymbol.id; });
    var counts = {};
    for (var j = 0; j < 9; j++) {
      if (grid[j]) continue;
      var available = otherSymbols.filter(function(s) { return (counts[s.id] || 0) < 2; });
      if (available.length === 0) available = otherSymbols;
      var pick = available[_crandInt(available.length)];
      grid[j] = pick;
      counts[pick.id] = (counts[pick.id] || 0) + 1;
    }
    cells = grid;
  } else {
    // Loss card: ensure no triple
    var lossCounts = {};
    for (var k = 0; k < 9; k++) {
      var lossAvail = availableSymbols.filter(function(s) { return (lossCounts[s.id] || 0) < 2; });
      if (lossAvail.length === 0) lossAvail = availableSymbols;
      var lossPick = lossAvail[_crandInt(lossAvail.length)];
      cells.push(lossPick);
      lossCounts[lossPick.id] = (lossCounts[lossPick.id] || 0) + 1;
    }
  }

  // Bonus loot item
  if (hasLoot) {
    var lootBoosts = { cheap: 0, standard: 5, premium: 15, mystic: 20, fire: 25, shadow: 35, death: 45, demon: 55, celestial: 70 };
    var boost = lootBoosts[tier] || 0;
    var rolledItem = rollItem(boost);
    var scratchMod = rollModifier();
    lootItem = {
      instanceId: crypto.randomBytes(6).toString('hex'),
      itemId: rolledItem.id,
      item: { id: rolledItem.id, name: rolledItem.name, type: rolledItem.type, rarity: rolledItem.rarity, icon: rolledItem.icon || null, img: rolledItem.img || null, text: rolledItem.text || null },
      modifier: scratchMod,
      modifierInfo: getModifierInfo(scratchMod),
      serial: generateSerial(),
      obtainedAt: Date.now(),
      source: 'scratch_' + tier,
    };
  }

  var winnings = isWin ? Math.floor(cost * multiplier) : 0;
  var autoReveal = !!(upgrades.scratchAutoReveal && upgrades.scratchAutoReveal >= 1 && isWin);

  return {
    tier: tier,
    cost: cost,
    cells: cells.map(function(s) { return { id: s.id, icon: s.icon, img: s.img || null, multiplier: s.multiplier }; }),
    isWin: isWin,
    winSymbol: winSymbol ? { id: winSymbol.id, icon: winSymbol.icon, img: winSymbol.img || null, multiplier: winSymbol.multiplier } : null,
    winnings: winnings,
    profit: winnings - cost,
    lootItem: lootItem,
    autoReveal: autoReveal,
  };
}

// ─── Helpers ───

function getItemInfo(itemId) {
  return ITEM_MAP.get(itemId) || null;
}

function getSellValue(itemId, modifier) {
  var item = ITEM_MAP.get(itemId);
  if (!item) return 0;
  var base = RARITIES[item.rarity].sellValue;
  if (modifier && MODIFIERS[modifier]) {
    base = Math.floor(base * MODIFIERS[modifier].multiplier);
  }
  return base;
}

function getFullCatalog() {
  return ITEMS.map(function(item) {
    return {
      id: item.id, name: item.name, type: item.type, rarity: item.rarity,
      icon: item.icon || null, img: item.img || null, text: item.text || null,
      sellValue: RARITIES[item.rarity].sellValue,
      rarityColor: RARITIES[item.rarity].color,
    };
  });
}

// ─── Key Items (game drop rewards) ───
const KEY_ITEMS = [
  { id: 'wooden_key', name: 'Wooden Key', type: 'key', rarity: 'common', img: '/icons/loot/Loot_54_key.PNG', dropWeight: 100 },
  { id: 'iron_key', name: 'Iron Key', type: 'key', rarity: 'uncommon', img: '/icons/loot/Loot_56_key.PNG', dropWeight: 50 },
  { id: 'gold_key', name: 'Gold Key', type: 'key', rarity: 'rare', img: '/icons/loot/Loot_58_key.PNG', dropWeight: 20 },
  { id: 'crystal_key', name: 'Crystal Key', type: 'key', rarity: 'epic', img: '/icons/loot/Loot_60_key.PNG', dropWeight: 8 },
  { id: 'shadow_key', name: 'Shadow Key', type: 'key', rarity: 'legendary', img: '/icons/loot/Loot_70_key.PNG', dropWeight: 3 },
  { id: 'void_key', name: 'Void Key', type: 'key', rarity: 'mythic', img: '/icons/loot/Loot_72_key.PNG', dropWeight: 1 },
];

const KEY_ITEM_MAP = {};
KEY_ITEMS.forEach(function(k) { KEY_ITEM_MAP[k.id] = k; });
// Add keys to main ITEM_MAP so getItemInfo() finds them for inventory display
for (const k of KEY_ITEMS) ITEM_MAP.set(k.id, k);

// ─── Special Crates (loot boxes requiring keys) ───
const SPECIAL_CRATES = {
  wooden_crate:    { id: 'wooden_crate',    name: 'Wooden Crate',    keyRequired: 'wooden_key', items: 2, boost: 15, color: '#8B4513', img: '/icons/loot/Loot_101_chest.PNG' },
  iron_strongbox:  { id: 'iron_strongbox',  name: 'Iron Strongbox',  keyRequired: 'iron_key',   items: 3, boost: 30, color: '#71797E', img: '/icons/loot/Loot_102_chest.PNG' },
  gold_vault:      { id: 'gold_vault',      name: 'Gold Vault',      keyRequired: 'gold_key',   items: 3, boost: 45, color: '#f0b232', img: '/icons/loot/Loot_103_chest.PNG' },
  crystal_chest:   { id: 'crystal_chest',   name: 'Crystal Chest',   keyRequired: 'crystal_key', items: 4, boost: 60, color: '#00d4ff', img: '/icons/loot/Loot_104_chest.PNG' },
  shadow_coffer:   { id: 'shadow_coffer',   name: 'Shadow Coffer',   keyRequired: 'shadow_key', items: 5, boost: 75, color: '#9b59b6', img: '/icons/loot/Loot_106_chest.PNG' },
  void_reliquary:  { id: 'void_reliquary',  name: 'Void Reliquary',  keyRequired: 'void_key',   items: 6, boost: 90, color: '#ff4444', img: '/icons/loot/Loot_107_chest.PNG', guaranteedLegendaryLast: true },
};

// ─── Special Packs (card packs requiring keys) ───
const SPECIAL_PACKS = {
  wooden_pack:   { id: 'wooden_pack',   name: 'Wooden Pack',   keyRequired: 'wooden_key',  cards: 3, minRarity: 'uncommon', color: '#8B4513', img: '/icons/loot/Loot_143_bag.PNG' },
  iron_pack:     { id: 'iron_pack',     name: 'Iron Pack',     keyRequired: 'iron_key',    cards: 4, minRarity: 'rare', color: '#71797E', img: '/icons/loot/Loot_144_bag.PNG' },
  gold_pack:     { id: 'gold_pack',     name: 'Gold Pack',     keyRequired: 'gold_key',    cards: 5, minRarity: 'rare', color: '#f0b232', img: '/icons/loot/Loot_145_bag.PNG' },
  crystal_pack:  { id: 'crystal_pack',  name: 'Crystal Pack',  keyRequired: 'crystal_key', cards: 5, minRarity: 'epic', color: '#00d4ff', img: '/icons/loot/Loot_143_bag.PNG' },
  shadow_pack:   { id: 'shadow_pack',   name: 'Shadow Pack',   keyRequired: 'shadow_key',  cards: 5, minRarity: 'epic', color: '#9b59b6', img: '/icons/loot/Loot_144_bag.PNG' },
  void_pack:     { id: 'void_pack',     name: 'Void Pack',     keyRequired: 'void_key',    cards: 7, minRarity: 'legendary', color: '#ff4444', img: '/icons/loot/Loot_145_bag.PNG' },
};

// Roll for a key drop — called when player wins a game
// Returns a key item object or null
function rollKeyDrop() {
  // 15% base chance of getting any key
  if (_crandInt(1000) >= 150) return null;

  // Weighted rarity selection
  var totalWeight = 0;
  for (var i = 0; i < KEY_ITEMS.length; i++) totalWeight += KEY_ITEMS[i].dropWeight;
  var roll = _crandInt(totalWeight);
  var cumulative = 0;
  for (var j = 0; j < KEY_ITEMS.length; j++) {
    cumulative += KEY_ITEMS[j].dropWeight;
    if (roll < cumulative) return KEY_ITEMS[j];
  }
  return KEY_ITEMS[0];
}

// Guaranteed key drop — used for challenge/daily rewards
// Always returns a key, weighted by rarity
function rollGuaranteedKey() {
  var totalWeight = 0;
  for (var i = 0; i < KEY_ITEMS.length; i++) totalWeight += KEY_ITEMS[i].dropWeight;
  var roll = _crandInt(totalWeight);
  var cumulative = 0;
  for (var j = 0; j < KEY_ITEMS.length; j++) {
    cumulative += KEY_ITEMS[j].dropWeight;
    if (roll < cumulative) return KEY_ITEMS[j];
  }
  return KEY_ITEMS[0];
}

// Open a special crate — consumes a key, returns loot items
function openSpecialCrate(tier) {
  var crate = SPECIAL_CRATES[tier];
  if (!crate) return null;

  var items = [];
  for (var i = 0; i < crate.items; i++) {
    var item;
    if (crate.guaranteedLegendaryLast && i === crate.items - 1) {
      var legendaryPool = ITEMS.filter(function(it) { return it.rarity === 'legendary' || it.rarity === 'mythic'; });
      if (legendaryPool.length > 0) {
        item = legendaryPool[_crandInt(legendaryPool.length)];
      } else {
        item = rollWeapon(crate.boost);
      }
    } else {
      item = rollWeapon(crate.boost);
    }

    var modifier = rollModifier();
    var serial = generateSerial();
    var modInfo = getModifierInfo(modifier);

    items.push({
      instanceId: crypto.randomBytes(6).toString('hex'),
      itemId: item.id,
      item: { id: item.id, name: item.name, type: item.type, rarity: item.rarity, icon: item.icon || null, img: item.img || null, text: item.text || null },
      modifier: modifier,
      modifierInfo: modInfo,
      serial: serial,
      obtainedAt: Date.now(),
      source: 'special_crate_' + tier,
    });
  }

  return { tier: tier, crate: { name: crate.name, color: crate.color, items: crate.items, img: crate.img }, items: items };
}

// ─── Character portraits for profile pictures ───
const PROFILE_PORTRAITS = [
  // ─── Human Men ───
  { id: 'hm_knight', name: 'Knight', icon: '\u{1F6E1}\uFE0F', img: '/icons/characters/hm_knight.png' },
  { id: 'hm_knight2', name: 'Knight Captain', icon: '\u2694\uFE0F', img: '/icons/characters/hm_knight2.png' },
  { id: 'hm_knight3', name: 'Noble Knight', icon: '\u{1F6E1}\uFE0F', img: '/icons/characters/hm_knight3.png' },
  { id: 'hm_warrior', name: 'Warrior', icon: '\u2694\uFE0F', img: '/icons/characters/hm_warrior.png' },
  { id: 'hm_bold', name: 'Bold Warrior', icon: '\u2694\uFE0F', img: '/icons/characters/hm_bold.png' },
  { id: 'hm_viking', name: 'Viking', icon: '\u{1FA93}', img: '/icons/characters/hm_viking.png' },
  { id: 'hm_jarl', name: 'Jarl', icon: '\u{1F451}', img: '/icons/characters/hm_jarl.png' },
  { id: 'hm_samurai', name: 'Samurai', icon: '\u2694\uFE0F', img: '/icons/characters/hm_samurai.png' },
  { id: 'hm_ronin', name: 'Ronin', icon: '\u2694\uFE0F', img: '/icons/characters/hm_ronin.png' },
  { id: 'hm_archer', name: 'Archer', icon: '\u{1F3F9}', img: '/icons/characters/hm_archer.png' },
  { id: 'hm_barbarian', name: 'Barbarian', icon: '\u{1FA93}', img: '/icons/characters/hm_barbarian.png' },
  { id: 'hm_templar', name: 'Templar', icon: '\u{1F6E1}\uFE0F', img: '/icons/characters/hm_templar.png' },
  { id: 'hm_alchemist', name: 'Alchemist', icon: '\u{1F9D9}', img: '/icons/characters/hm_alchemist.png' },
  { id: 'hm_rogue', name: 'Rogue', icon: '\u{1F977}', img: '/icons/characters/hm_rogue.png' },
  { id: 'hm_priest', name: 'Priest', icon: '\u{1F9DD}', img: '/icons/characters/hm_priest.png' },
  { id: 'hm_lord', name: 'Lord', icon: '\u{1F451}', img: '/icons/characters/hm_lord.png' },
  { id: 'hm_darklord', name: 'Dark Lord', icon: '\u{1F47F}', img: '/icons/characters/hm_darklord.png' },
  { id: 'hm_captain', name: 'Captain', icon: '\u{1F6E1}\uFE0F', img: '/icons/characters/hm_captain.png' },
  { id: 'hm_scout', name: 'Scout', icon: '\u{1F3F9}', img: '/icons/characters/hm_scout.png' },
  { id: 'hm_shinobi', name: 'Shinobi', icon: '\u{1F977}', img: '/icons/characters/hm_shinobi.png' },
  { id: 'hm_sage', name: 'Sage', icon: '\u{1F9D9}', img: '/icons/characters/hm_sage.png' },
  { id: 'hm_pharaoh', name: 'Pharaoh', icon: '\u{1F451}', img: '/icons/characters/hm_pharaoh.png' },
  { id: 'hm_conquistador', name: 'Conquistador', icon: '\u2694\uFE0F', img: '/icons/characters/hm_conquistador.png' },
  { id: 'hm_thug', name: 'Thug', icon: '\u{1F977}', img: '/icons/characters/hm_thug.png' },
  { id: 'hm_chief', name: 'Chief', icon: '\u{1F451}', img: '/icons/characters/hm_chief.png' },
  // ─── Human Women ───
  { id: 'hw_princess', name: 'Princess', icon: '\u{1F451}', img: '/icons/characters/hw_princess.png' },
  { id: 'hw_queen', name: 'Queen', icon: '\u{1F451}', img: '/icons/characters/hw_queen.png' },
  { id: 'hw_amazon', name: 'Amazon Warrior', icon: '\u2694\uFE0F', img: '/icons/characters/hw_amazon.png' },
  { id: 'hw_knight', name: 'Woman Knight', icon: '\u{1F6E1}\uFE0F', img: '/icons/characters/hw_knight.png' },
  { id: 'hw_archer', name: 'Archer', icon: '\u{1F3F9}', img: '/icons/characters/hw_archer.png' },
  { id: 'hw_warrior', name: 'Woman Warrior', icon: '\u2694\uFE0F', img: '/icons/characters/hw_warrior.png' },
  { id: 'hw_witch1', name: 'Witch', icon: '\u{1F9D9}', img: '/icons/characters/hw_witch1.png' },
  { id: 'hw_witch2', name: 'Dark Witch', icon: '\u{1F9D9}', img: '/icons/characters/hw_witch2.png' },
  { id: 'hw_shaman', name: 'Shaman', icon: '\u{1F9D9}', img: '/icons/characters/hw_shaman.png' },
  { id: 'hw_viking', name: 'Viking Woman', icon: '\u{1FA93}', img: '/icons/characters/hw_viking.png' },
  { id: 'hw_noble1', name: 'Noble Lady', icon: '\u{1F451}', img: '/icons/characters/hw_noble1.png' },
  { id: 'hw_noble2', name: 'Noblewoman', icon: '\u{1F451}', img: '/icons/characters/hw_noble2.png' },
  { id: 'hw_maiden', name: 'Maiden', icon: '\u{1F9DD}', img: '/icons/characters/hw_maiden.png' },
  { id: 'hw_queen2', name: 'Golden Queen', icon: '\u{1F451}', img: '/icons/characters/hw_queen2.png' },
  { id: 'hw_girl', name: 'Young Girl', icon: '\u{1F9DD}', img: '/icons/characters/hw_girl.png' },
  // ─── Elves ───
  { id: 'elf_warrior', name: 'Elf Warrior', icon: '\u{1F9DD}', img: '/icons/characters/elf_warrior.png' },
  { id: 'elf_m1', name: 'Elf Ranger', icon: '\u{1F3F9}', img: '/icons/characters/elf_m1.png' },
  { id: 'elf_m2', name: 'Elf Lord', icon: '\u{1F451}', img: '/icons/characters/elf_m2.png' },
  { id: 'elf_m3', name: 'Elf Scout', icon: '\u{1F3F9}', img: '/icons/characters/elf_m3.png' },
  { id: 'elf_m4', name: 'Elf Sage', icon: '\u{1F9D9}', img: '/icons/characters/elf_m4.png' },
  { id: 'elf_m5', name: 'Elf Prince', icon: '\u{1F451}', img: '/icons/characters/elf_m5.png' },
  { id: 'elf_mage', name: 'Elf Mage', icon: '\u{1F9D9}', img: '/icons/characters/elf_mage.png' },
  { id: 'elf_f1', name: 'Elf Maiden', icon: '\u{1F9DD}', img: '/icons/characters/elf_f1.png' },
  { id: 'elf_f2', name: 'Elf Priestess', icon: '\u{1F9DD}', img: '/icons/characters/elf_f2.png' },
  { id: 'elf_f3', name: 'Elf Enchantress', icon: '\u{1F9D9}', img: '/icons/characters/elf_f3.png' },
  { id: 'elf_hunter', name: 'Elf Hunter', icon: '\u{1F3F9}', img: '/icons/characters/elf_hunter.png' },
  { id: 'elf_f5', name: 'Elf Mystic', icon: '\u{1F9D9}', img: '/icons/characters/elf_f5.png' },
  { id: 'elf_f6', name: 'Elf Guardian', icon: '\u{1F6E1}\uFE0F', img: '/icons/characters/elf_f6.png' },
  // ─── Gnomes ───
  { id: 'gnome_f1', name: 'Gnome Tinkerer', icon: '\u{1F9DD}', img: '/icons/characters/gnome_f1.png' },
  { id: 'gnome_f2', name: 'Gnome Alchemist', icon: '\u{1F9D9}', img: '/icons/characters/gnome_f2.png' },
  { id: 'gnome_f3', name: 'Gnome Witch', icon: '\u{1F9D9}', img: '/icons/characters/gnome_f3.png' },
  { id: 'gnome_dark', name: 'Dark Gnome', icon: '\u{1F47F}', img: '/icons/characters/gnome_dark.png' },
  { id: 'gnome_m1', name: 'Gnome Engineer', icon: '\u{1F9DD}', img: '/icons/characters/gnome_m1.png' },
  { id: 'gnome_m2', name: 'Gnome Sage', icon: '\u{1F9D9}', img: '/icons/characters/gnome_m2.png' },
  { id: 'gnome_m3', name: 'Gnome Elder', icon: '\u{1F9D9}', img: '/icons/characters/gnome_m3.png' },
];

module.exports = {
  RARITIES,
  MODIFIERS,
  ITEMS,
  ITEM_MAP,
  ITEMS_BY_RARITY,
  WEAPONS_BY_RARITY,
  SPELLBOOKS_BY_RARITY,
  LOOTBOX_TIERS,
  SCRATCH_TIERS,
  SCRATCH_SYMBOLS,
  KEY_ITEMS,
  KEY_ITEM_MAP,
  SPECIAL_CRATES,
  SPECIAL_PACKS,
  openLootbox,
  generateScratchCard,
  rollItem,
  rollWeapon,
  rollSpellbook,
  rollModifier,
  getModifierInfo,
  generateSerial,
  getItemInfo,
  getSellValue,
  getFullCatalog,
  rollKeyDrop,
  rollGuaranteedKey,
  openSpecialCrate,
  PROFILE_PORTRAITS,
  flushSerialCounter,
};
