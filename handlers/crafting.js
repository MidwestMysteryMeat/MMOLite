// handlers/crafting.js
// Recipe-based crafting system with station proximity checks.
// Handles: get_recipes, craft_item

var crypto = require('crypto');
var rpgData = require('../rpg-data');
var challengesHandler = require('./challenges');
var knowledgeHandler = require('./knowledge');
var lootGen = require('../loot-generator');

// Per-account craft lock: prevents concurrent craft_item double-spend
var craftLocks = new Set();

// ---------------------------------------------------------------------------
// Quality System (Crafting Minigame)
// ---------------------------------------------------------------------------

var QUALITY_TIERS = {
  poor:       { name: 'Poor',       multiplier: 0.75 },
  normal:     { name: 'Normal',     multiplier: 1.00 },
  good:       { name: 'Good',       multiplier: 1.25 },
  excellent:  { name: 'Excellent',  multiplier: 1.50 },
  masterwork: { name: 'Masterwork', multiplier: 2.00 },
};

var QUALITY_CRAFT_SKILL_THRESHOLD = 10; // only recipes where max skillReq >= 10 get minigame
var pendingMinigames = new Map(); // socketId -> { recipeId, windowStart, windowEnd, expiresAt, account_key }

// ---------------------------------------------------------------------------
// Recipe definitions
// ---------------------------------------------------------------------------

var RECIPES = {
  // Starter wooden weapons (no station, no skill requirement)
  wooden_sword: {
    station: 'none',
    cost: { wood: 8 },
    output: { type: 'wooden_sword', name: 'Wooden Sword' },
  },
  wooden_dagger: {
    station: 'none',
    cost: { wood: 4 },
    output: { type: 'wooden_dagger', name: 'Wooden Dagger' },
  },
  wooden_mace: {
    station: 'none',
    cost: { wood: 8 },
    output: { type: 'wooden_mace', name: 'Wooden Mace' },
  },
  wooden_spear: {
    station: 'none',
    cost: { wood: 10 },
    output: { type: 'wooden_spear', name: 'Wooden Spear' },
  },

  // Basic crafting (no station required)
  forge: {
    station: 'none',
    cost: { wood: 20, stone: 15 },
    output: { type: 'forge', name: 'Forge' },
    placeable: true,
  },
  storage_chest: {
    station: 'none',
    cost: { wood: 10 },
    output: { type: 'storage_chest', name: 'Storage Chest' },
    placeable: true,
  },
  wall: {
    station: 'none',
    cost: { wood: 5 },
    output: { type: 'wall', name: 'Wooden Wall' },
    placeable: true,
  },
  door: {
    station: 'none',
    cost: { wood: 8, iron_bar: 2 },
    output: { type: 'door', name: 'Wooden Door' },
    placeable: true,
  },
  raft: {
    station: 'none',
    cost: { wood: 30 },
    output: { type: 'raft', name: 'Raft' },
    placeable: true,
    skillReq: { crafting: 3 },
  },
  bridge: {
    station: 'none',
    cost: { wood: 40, iron_bar: 3 },
    output: { type: 'bridge', name: 'Wooden Bridge' },
    placeable: true,
    skillReq: { crafting: 5 },
  },
  boat: {
    station: 'none',
    cost: { wood: 50, iron_bar: 5 },
    output: { type: 'boat', name: 'Boat' },
    skillReq: { crafting: 8 },
  },
  plot_stake: {
    station: 'none',
    cost: { wood: 50, stone: 30, iron_bar: 5 },
    output: { type: 'plot_stake', name: 'Plot Stake' },
  },

  // Forge recipes (must be near a placed forge)
  iron_bar: {
    station: 'forge',
    cost: { iron_ore: 2 },
    output: { type: 'iron_bar', name: 'Iron Bar' },
    resource: 'iron_bar',
    skillReq: { crafting: 1 },
  },

  // Anvil recipes (must be near a placed anvil)
  iron_anvil: {
    station: 'forge',
    cost: { iron_bar: 15 },
    output: { type: 'iron_anvil', name: 'Iron Anvil' },
    placeable: true,
  },
  iron_axe: {
    station: 'anvil',
    cost: { iron_bar: 5, wood: 3 },
    output: { type: 'iron_axe', name: 'Iron Axe' },
  },
  iron_pickaxe: {
    station: 'anvil',
    cost: { iron_bar: 5, wood: 3 },
    output: { type: 'iron_pickaxe', name: 'Iron Pickaxe' },
  },
  // --- Higher-tier gathering tools ---
  copper_axe: {
    station: 'anvil',
    cost: { copper_bar: 4, wood: 2 },
    output: { type: 'copper_axe', name: 'Copper Axe' },
    skillReq: { crafting: 2 },
  },
  copper_pickaxe: {
    station: 'anvil',
    cost: { copper_bar: 4, wood: 2 },
    output: { type: 'copper_pickaxe', name: 'Copper Pickaxe' },
    skillReq: { crafting: 2 },
  },
  bronze_axe: {
    station: 'anvil',
    cost: { bronze_bar: 5, wood: 2 },
    output: { type: 'bronze_axe', name: 'Bronze Axe' },
    skillReq: { crafting: 4 },
  },
  bronze_pickaxe: {
    station: 'anvil',
    cost: { bronze_bar: 5, wood: 2 },
    output: { type: 'bronze_pickaxe', name: 'Bronze Pickaxe' },
    skillReq: { crafting: 4 },
  },
  steel_axe: {
    station: 'anvil',
    cost: { steel_bar: 6, wood: 2 },
    output: { type: 'steel_axe', name: 'Steel Axe' },
    skillReq: { crafting: 10 },
  },
  steel_pickaxe: {
    station: 'anvil',
    cost: { steel_bar: 6, wood: 2 },
    output: { type: 'steel_pickaxe', name: 'Steel Pickaxe' },
    skillReq: { crafting: 10 },
  },
  mithril_axe: {
    station: 'anvil',
    cost: { mithril_bar: 8, wood: 2 },
    output: { type: 'mithril_axe', name: 'Mithril Axe' },
    skillReq: { crafting: 22 },
  },
  mithril_pickaxe: {
    station: 'anvil',
    cost: { mithril_bar: 8, wood: 2 },
    output: { type: 'mithril_pickaxe', name: 'Mithril Pickaxe' },
    skillReq: { crafting: 22 },
  },

  iron_lock: {
    station: 'anvil',
    cost: { iron_bar: 3 },
    output: { type: 'iron_lock', name: 'Iron Lock' },
  },
  key_copy: {
    station: 'anvil',
    cost: { iron_bar: 1 },
    output: { type: 'key', name: 'Key Copy' },
    requiresLockId: true,
  },

  // --- Combat weapons (anvil required) ---
  iron_sword: {
    station: 'anvil',
    cost: { iron_bar: 8, wood: 2 },
    output: { type: 'iron_sword', name: 'Iron Sword' },
    skillReq: { crafting: 5 },
  },
  iron_axe_weapon: {
    station: 'anvil',
    cost: { iron_bar: 10, wood: 3 },
    output: { type: 'iron_axe_weapon', name: 'Iron Battle Axe' },
    skillReq: { crafting: 7 },
  },
  iron_mace: {
    station: 'anvil',
    cost: { iron_bar: 9, wood: 2 },
    output: { type: 'iron_mace', name: 'Iron Mace' },
    skillReq: { crafting: 6 },
  },
  iron_dagger: {
    station: 'anvil',
    cost: { iron_bar: 4, wood: 1 },
    output: { type: 'iron_dagger', name: 'Iron Dagger' },
    skillReq: { crafting: 3 },
  },
  wooden_staff: {
    station: 'none',
    cost: { wood: 12 },
    output: { type: 'wooden_staff', name: 'Wooden Staff' },
  },
  wooden_wand: {
    station: 'none',
    cost: { wood: 6 },
    output: { type: 'wooden_wand', name: 'Wooden Wand' },
  },
  wooden_bow: {
    station: 'none',
    cost: { wood: 10 },
    output: { type: 'wooden_bow', name: 'Wooden Bow' },
  },

  // --- Shields ---
  wooden_shield: {
    station: 'none',
    cost: { wood: 10 },
    output: { type: 'wooden_shield', name: 'Wooden Shield' },
  },
  iron_shield: {
    station: 'anvil',
    cost: { iron_bar: 12, wood: 3 },
    output: { type: 'iron_shield', name: 'Iron Shield' },
    skillReq: { crafting: 8 },
  },

  // --- Armor ---
  leather_cap: {
    station: 'none',
    cost: { wood: 5 },
    output: { type: 'leather_cap', name: 'Leather Cap' },
    skillReq: { crafting: 2 },
  },
  iron_helm: {
    station: 'anvil',
    cost: { iron_bar: 6 },
    output: { type: 'iron_helm', name: 'Iron Helm' },
    skillReq: { crafting: 6 },
  },
  leather_armor: {
    station: 'none',
    cost: { wood: 8 },
    output: { type: 'leather_armor', name: 'Leather Armor' },
    skillReq: { crafting: 3 },
  },
  iron_armor: {
    station: 'anvil',
    cost: { iron_bar: 15, wood: 5 },
    output: { type: 'iron_armor', name: 'Iron Armor' },
    skillReq: { crafting: 10 },
  },

  // ===== COPPER TIER (crafting 1-3, copper_bar) =====
  copper_sword: {
    station: 'anvil',
    cost: { copper_bar: 5, wood: 2 },
    output: { type: 'copper_sword', name: 'Copper Sword' },
    skillReq: { crafting: 2 },
  },
  copper_axe_weapon: {
    station: 'anvil',
    cost: { copper_bar: 6, wood: 3 },
    output: { type: 'copper_axe_weapon', name: 'Copper Battle Axe' },
    skillReq: { crafting: 3 },
  },
  copper_mace: {
    station: 'anvil',
    cost: { copper_bar: 5, wood: 2 },
    output: { type: 'copper_mace', name: 'Copper Mace' },
    skillReq: { crafting: 2 },
  },
  copper_dagger: {
    station: 'anvil',
    cost: { copper_bar: 3, wood: 1 },
    output: { type: 'copper_dagger', name: 'Copper Dagger' },
    skillReq: { crafting: 1 },
  },
  copper_spear: {
    station: 'anvil',
    cost: { copper_bar: 4, wood: 4 },
    output: { type: 'copper_spear', name: 'Copper Spear' },
    skillReq: { crafting: 2 },
  },
  copper_bow: {
    station: 'none',
    cost: { wood: 15, copper_bar: 2 },
    output: { type: 'copper_bow', name: 'Copper Bow' },
    skillReq: { crafting: 3 },
  },
  copper_staff: {
    station: 'none',
    cost: { wood: 12, copper_bar: 3, mana_crystal: 1 },
    output: { type: 'copper_staff', name: 'Copper Staff' },
    skillReq: { crafting: 3, magic: 2 },
  },
  copper_wand: {
    station: 'none',
    cost: { wood: 6, copper_bar: 2, mana_crystal: 1 },
    output: { type: 'copper_wand', name: 'Copper Wand' },
    skillReq: { crafting: 1, magic: 1 },
  },
  copper_shield: {
    station: 'anvil',
    cost: { copper_bar: 6, wood: 4 },
    output: { type: 'copper_shield', name: 'Copper Shield' },
    skillReq: { crafting: 2 },
  },
  copper_helm: {
    station: 'anvil',
    cost: { copper_bar: 4 },
    output: { type: 'copper_helm', name: 'Copper Helm' },
    skillReq: { crafting: 2 },
  },
  copper_armor: {
    station: 'anvil',
    cost: { copper_bar: 8, wood: 3 },
    output: { type: 'copper_armor', name: 'Copper Armor' },
    skillReq: { crafting: 3 },
  },

  // ===== BRONZE TIER (crafting 4-6, bronze_bar) =====
  bronze_sword: {
    station: 'anvil',
    cost: { bronze_bar: 6, wood: 2 },
    output: { type: 'bronze_sword', name: 'Bronze Sword' },
    skillReq: { crafting: 4 },
  },
  bronze_axe_weapon: {
    station: 'anvil',
    cost: { bronze_bar: 8, wood: 3 },
    output: { type: 'bronze_axe_weapon', name: 'Bronze Battle Axe' },
    skillReq: { crafting: 5 },
  },
  bronze_mace: {
    station: 'anvil',
    cost: { bronze_bar: 6, wood: 2 },
    output: { type: 'bronze_mace', name: 'Bronze Mace' },
    skillReq: { crafting: 4 },
  },
  bronze_dagger: {
    station: 'anvil',
    cost: { bronze_bar: 4, wood: 1 },
    output: { type: 'bronze_dagger', name: 'Bronze Dagger' },
    skillReq: { crafting: 3 },
  },
  bronze_spear: {
    station: 'anvil',
    cost: { bronze_bar: 5, wood: 5 },
    output: { type: 'bronze_spear', name: 'Bronze Spear' },
    skillReq: { crafting: 4 },
  },
  bronze_bow: {
    station: 'none',
    cost: { wood: 18, bronze_bar: 3 },
    output: { type: 'bronze_bow', name: 'Bronze Bow' },
    skillReq: { crafting: 5 },
  },
  bronze_staff: {
    station: 'none',
    cost: { wood: 14, bronze_bar: 4, mana_crystal: 1 },
    output: { type: 'bronze_staff', name: 'Bronze Staff' },
    skillReq: { crafting: 5, magic: 4 },
  },
  bronze_shield: {
    station: 'anvil',
    cost: { bronze_bar: 8, wood: 4 },
    output: { type: 'bronze_shield', name: 'Bronze Shield' },
    skillReq: { crafting: 4 },
  },
  bronze_helm: {
    station: 'anvil',
    cost: { bronze_bar: 5 },
    output: { type: 'bronze_helm', name: 'Bronze Helm' },
    skillReq: { crafting: 4 },
  },
  bronze_armor: {
    station: 'anvil',
    cost: { bronze_bar: 10, wood: 4 },
    output: { type: 'bronze_armor', name: 'Bronze Armor' },
    skillReq: { crafting: 6 },
  },

  // ===== STEEL TIER (crafting 10-14, steel_bar) =====
  steel_sword: {
    station: 'anvil',
    cost: { steel_bar: 8, wood: 2 },
    output: { type: 'steel_sword', name: 'Steel Sword' },
    skillReq: { crafting: 10 },
  },
  steel_axe_weapon: {
    station: 'anvil',
    cost: { steel_bar: 10, wood: 3 },
    output: { type: 'steel_axe_weapon', name: 'Steel Battle Axe' },
    skillReq: { crafting: 12 },
  },
  steel_mace: {
    station: 'anvil',
    cost: { steel_bar: 9, wood: 2 },
    output: { type: 'steel_mace', name: 'Steel Mace' },
    skillReq: { crafting: 11 },
  },
  steel_dagger: {
    station: 'anvil',
    cost: { steel_bar: 5, wood: 1 },
    output: { type: 'steel_dagger', name: 'Steel Dagger' },
    skillReq: { crafting: 10 },
  },
  steel_spear: {
    station: 'anvil',
    cost: { steel_bar: 7, wood: 5 },
    output: { type: 'steel_spear', name: 'Steel Spear' },
    skillReq: { crafting: 11 },
  },
  steel_bow: {
    station: 'anvil',
    cost: { wood: 20, steel_bar: 4 },
    output: { type: 'steel_bow', name: 'Steel Bow' },
    skillReq: { crafting: 12 },
  },
  steel_crossbow: {
    station: 'anvil',
    cost: { steel_bar: 12, wood: 6 },
    output: { type: 'steel_crossbow', name: 'Steel Crossbow' },
    skillReq: { crafting: 14 },
  },
  steel_scythe: {
    station: 'anvil',
    cost: { steel_bar: 10, wood: 4 },
    output: { type: 'steel_scythe', name: 'Steel Scythe' },
    skillReq: { crafting: 13 },
  },
  steel_shield: {
    station: 'anvil',
    cost: { steel_bar: 10, wood: 4 },
    output: { type: 'steel_shield', name: 'Steel Shield' },
    skillReq: { crafting: 11 },
  },
  steel_helm: {
    station: 'anvil',
    cost: { steel_bar: 6 },
    output: { type: 'steel_helm', name: 'Steel Helm' },
    skillReq: { crafting: 10 },
  },
  steel_armor: {
    station: 'anvil',
    cost: { steel_bar: 16, wood: 5 },
    output: { type: 'steel_armor', name: 'Steel Armor' },
    skillReq: { crafting: 14 },
  },

  // ===== SILVER TIER (crafting 14-18, silver_bar) =====
  silver_sword: {
    station: 'anvil',
    cost: { silver_bar: 8, wood: 2 },
    output: { type: 'silver_sword', name: 'Silver Sword' },
    skillReq: { crafting: 14 },
  },
  silver_axe_weapon: {
    station: 'anvil',
    cost: { silver_bar: 10, wood: 3 },
    output: { type: 'silver_axe_weapon', name: 'Silver Battle Axe' },
    skillReq: { crafting: 16 },
  },
  silver_mace: {
    station: 'anvil',
    cost: { silver_bar: 9, wood: 2 },
    output: { type: 'silver_mace', name: 'Silver Mace' },
    skillReq: { crafting: 15 },
  },
  silver_dagger: {
    station: 'anvil',
    cost: { silver_bar: 5, wood: 1 },
    output: { type: 'silver_dagger', name: 'Silver Dagger' },
    skillReq: { crafting: 14 },
  },
  silver_spear: {
    station: 'anvil',
    cost: { silver_bar: 7, wood: 5 },
    output: { type: 'silver_spear', name: 'Silver Spear' },
    skillReq: { crafting: 15 },
  },
  silver_bow: {
    station: 'anvil',
    cost: { wood: 20, silver_bar: 5 },
    output: { type: 'silver_bow', name: 'Silver Bow' },
    skillReq: { crafting: 16 },
  },
  silver_staff: {
    station: 'anvil',
    cost: { wood: 10, silver_bar: 6, mana_crystal: 2 },
    output: { type: 'silver_staff', name: 'Silver Staff' },
    skillReq: { crafting: 15, magic: 8 },
  },
  silver_wand: {
    station: 'anvil',
    cost: { wood: 6, silver_bar: 3, mana_crystal: 2 },
    output: { type: 'silver_wand', name: 'Silver Wand' },
    skillReq: { crafting: 14, magic: 7 },
  },
  silver_shield: {
    station: 'anvil',
    cost: { silver_bar: 12, wood: 4 },
    output: { type: 'silver_shield', name: 'Silver Shield' },
    skillReq: { crafting: 15 },
  },
  silver_helm: {
    station: 'anvil',
    cost: { silver_bar: 7 },
    output: { type: 'silver_helm', name: 'Silver Helm' },
    skillReq: { crafting: 14 },
  },
  silver_armor: {
    station: 'anvil',
    cost: { silver_bar: 18, wood: 5 },
    output: { type: 'silver_armor', name: 'Silver Armor' },
    skillReq: { crafting: 18 },
  },

  // ===== GOLD TIER (crafting 18-22, gold_bar) =====
  gold_sword: {
    station: 'anvil',
    cost: { gold_bar: 10, wood: 2 },
    output: { type: 'gold_sword', name: 'Gold Sword' },
    skillReq: { crafting: 18 },
  },
  gold_axe_weapon: {
    station: 'anvil',
    cost: { gold_bar: 12, wood: 3 },
    output: { type: 'gold_axe_weapon', name: 'Gold Battle Axe' },
    skillReq: { crafting: 20 },
  },
  gold_mace: {
    station: 'anvil',
    cost: { gold_bar: 10, wood: 2 },
    output: { type: 'gold_mace', name: 'Gold Mace' },
    skillReq: { crafting: 19 },
  },
  gold_dagger: {
    station: 'anvil',
    cost: { gold_bar: 6, wood: 1 },
    output: { type: 'gold_dagger', name: 'Gold Dagger' },
    skillReq: { crafting: 18 },
  },
  gold_spear: {
    station: 'anvil',
    cost: { gold_bar: 8, wood: 5 },
    output: { type: 'gold_spear', name: 'Gold Spear' },
    skillReq: { crafting: 19 },
  },
  gold_bow: {
    station: 'anvil',
    cost: { wood: 20, gold_bar: 6 },
    output: { type: 'gold_bow', name: 'Gold Bow' },
    skillReq: { crafting: 20 },
  },
  gold_staff: {
    station: 'anvil',
    cost: { wood: 10, gold_bar: 8, mana_crystal: 3 },
    output: { type: 'gold_staff', name: 'Gold Staff' },
    skillReq: { crafting: 19, magic: 12 },
  },
  gold_wand: {
    station: 'anvil',
    cost: { wood: 6, gold_bar: 4, mana_crystal: 2 },
    output: { type: 'gold_wand', name: 'Gold Wand' },
    skillReq: { crafting: 18, magic: 10 },
  },
  gold_shield: {
    station: 'anvil',
    cost: { gold_bar: 14, wood: 4 },
    output: { type: 'gold_shield', name: 'Gold Shield' },
    skillReq: { crafting: 19 },
  },
  gold_helm: {
    station: 'anvil',
    cost: { gold_bar: 8 },
    output: { type: 'gold_helm', name: 'Gold Helm' },
    skillReq: { crafting: 18 },
  },
  gold_armor: {
    station: 'anvil',
    cost: { gold_bar: 20, wood: 5 },
    output: { type: 'gold_armor', name: 'Gold Armor' },
    skillReq: { crafting: 22 },
  },

  // ===== MITHRIL TIER (crafting 22-28, mithril_bar) =====
  mithril_sword: {
    station: 'anvil',
    cost: { mithril_bar: 10, wood: 2 },
    output: { type: 'mithril_sword', name: 'Mithril Sword' },
    skillReq: { crafting: 22 },
  },
  mithril_axe_weapon: {
    station: 'anvil',
    cost: { mithril_bar: 14, wood: 3 },
    output: { type: 'mithril_axe_weapon', name: 'Mithril Battle Axe' },
    skillReq: { crafting: 25 },
  },
  mithril_mace: {
    station: 'anvil',
    cost: { mithril_bar: 12, wood: 2 },
    output: { type: 'mithril_mace', name: 'Mithril Mace' },
    skillReq: { crafting: 23 },
  },
  mithril_dagger: {
    station: 'anvil',
    cost: { mithril_bar: 6, wood: 1 },
    output: { type: 'mithril_dagger', name: 'Mithril Dagger' },
    skillReq: { crafting: 22 },
  },
  mithril_spear: {
    station: 'anvil',
    cost: { mithril_bar: 10, wood: 5 },
    output: { type: 'mithril_spear', name: 'Mithril Spear' },
    skillReq: { crafting: 24 },
  },
  mithril_bow: {
    station: 'anvil',
    cost: { wood: 20, mithril_bar: 8 },
    output: { type: 'mithril_bow', name: 'Mithril Bow' },
    skillReq: { crafting: 25 },
  },
  mithril_crossbow: {
    station: 'anvil',
    cost: { mithril_bar: 16, wood: 6 },
    output: { type: 'mithril_crossbow', name: 'Mithril Crossbow' },
    skillReq: { crafting: 28 },
  },
  mithril_scythe: {
    station: 'anvil',
    cost: { mithril_bar: 14, wood: 4 },
    output: { type: 'mithril_scythe', name: 'Mithril Scythe' },
    skillReq: { crafting: 26 },
  },
  mithril_staff: {
    station: 'anvil',
    cost: { wood: 10, mithril_bar: 10, mana_crystal: 5 },
    output: { type: 'mithril_staff', name: 'Mithril Staff' },
    skillReq: { crafting: 24, magic: 15 },
  },
  mithril_wand: {
    station: 'anvil',
    cost: { wood: 6, mithril_bar: 6, mana_crystal: 3 },
    output: { type: 'mithril_wand', name: 'Mithril Wand' },
    skillReq: { crafting: 22, magic: 13 },
  },
  mithril_shield: {
    station: 'anvil',
    cost: { mithril_bar: 16, wood: 4 },
    output: { type: 'mithril_shield', name: 'Mithril Shield' },
    skillReq: { crafting: 24 },
  },
  mithril_helm: {
    station: 'anvil',
    cost: { mithril_bar: 10 },
    output: { type: 'mithril_helm', name: 'Mithril Helm' },
    skillReq: { crafting: 22 },
  },
  mithril_armor: {
    station: 'anvil',
    cost: { mithril_bar: 24, wood: 5 },
    output: { type: 'mithril_armor', name: 'Mithril Armor' },
    skillReq: { crafting: 28 },
  },

  // ===== IRON SCYTHE + CROSSBOW (fill iron tier gaps) =====
  iron_scythe: {
    station: 'anvil',
    cost: { iron_bar: 8, wood: 4 },
    output: { type: 'iron_scythe', name: 'Iron Scythe' },
    skillReq: { crafting: 7 },
  },
  iron_crossbow: {
    station: 'anvil',
    cost: { iron_bar: 10, wood: 6 },
    output: { type: 'iron_crossbow', name: 'Iron Crossbow' },
    skillReq: { crafting: 8 },
  },
  iron_spear: {
    station: 'anvil',
    cost: { iron_bar: 6, wood: 5 },
    output: { type: 'iron_spear', name: 'Iron Spear' },
    skillReq: { crafting: 5 },
  },
  iron_bow: {
    station: 'anvil',
    cost: { wood: 15, iron_bar: 4 },
    output: { type: 'iron_bow', name: 'Iron Bow' },
    skillReq: { crafting: 6 },
  },
  iron_staff: {
    station: 'anvil',
    cost: { wood: 12, iron_bar: 5, mana_crystal: 1 },
    output: { type: 'iron_staff', name: 'Iron Staff' },
    skillReq: { crafting: 6, magic: 5 },
  },
  iron_wand: {
    station: 'anvil',
    cost: { wood: 8, iron_bar: 3, mana_crystal: 1 },
    output: { type: 'iron_wand', name: 'Iron Wand' },
    skillReq: { crafting: 5, magic: 4 },
  },

  // ===== ACCESSORIES =====
  amulet_vigor: {
    station: 'anvil',
    cost: { silver_bar: 3, gem_cut: 1 },
    output: { type: 'amulet_vigor', name: 'Amulet of Vigor' },
    skillReq: { crafting: 12 },
  },
  amulet_might: {
    station: 'anvil',
    cost: { silver_bar: 3, gem_cut: 1 },
    output: { type: 'amulet_might', name: 'Amulet of Might' },
    skillReq: { crafting: 12 },
  },
  ring_finesse: {
    station: 'anvil',
    cost: { silver_bar: 2, gem_cut: 1 },
    output: { type: 'ring_finesse', name: 'Ring of Finesse' },
    skillReq: { crafting: 12 },
  },
  ring_acumen: {
    station: 'anvil',
    cost: { silver_bar: 2, gem_cut: 1 },
    output: { type: 'ring_acumen', name: 'Ring of Acumen' },
    skillReq: { crafting: 12 },
  },
  ring_resolve: {
    station: 'anvil',
    cost: { bronze_bar: 4, gem_rough: 1 },
    output: { type: 'ring_resolve', name: 'Ring of Resolve' },
    skillReq: { crafting: 8 },
  },
  ring_ingenuity: {
    station: 'anvil',
    cost: { bronze_bar: 4, gem_rough: 1 },
    output: { type: 'ring_ingenuity', name: 'Ring of Ingenuity' },
    skillReq: { crafting: 8 },
  },
  pearl_amulet: {
    station: 'anvil',
    cost: { gold_bar: 5, gem_cut: 3 },
    output: { type: 'pearl_amulet', name: 'Pearl Amulet' },
    skillReq: { crafting: 18 },
  },
  gold_ring: {
    station: 'anvil',
    cost: { gold_bar: 4, gem_cut: 2 },
    output: { type: 'gold_ring', name: 'Gold Ring of Power' },
    skillReq: { crafting: 20 },
  },

  // ===== FURNITURE & STATIONS =====
  bed: {
    station: 'none',
    cost: { wood: 15 },
    output: { type: 'bed', name: 'Wooden Bed' },
    placeable: true,
  },
  bookshelf: {
    station: 'none',
    cost: { wood: 12 },
    output: { type: 'bookshelf', name: 'Bookshelf' },
    placeable: true,
  },
  cauldron: {
    station: 'forge',
    cost: { iron_bar: 8 },
    output: { type: 'cauldron', name: 'Iron Cauldron' },
    placeable: true,
  },
  table: {
    station: 'none',
    cost: { wood: 8 },
    output: { type: 'table', name: 'Wooden Table' },
    placeable: true,
  },
  chair: {
    station: 'none',
    cost: { wood: 5 },
    output: { type: 'chair', name: 'Wooden Chair' },
    placeable: true,
  },
  barrel: {
    station: 'none',
    cost: { wood: 8 },
    output: { type: 'barrel', name: 'Barrel' },
    placeable: true,
  },
  crate: {
    station: 'none',
    cost: { wood: 6 },
    output: { type: 'crate', name: 'Wooden Crate' },
    placeable: true,
  },
  banner: {
    station: 'none',
    cost: { wood: 5, iron_bar: 1 },
    output: { type: 'banner', name: 'Banner' },
    placeable: true,
    skillReq: { crafting: 2 },
  },
  crafting_table: {
    station: 'none',
    cost: { wood: 20, stone: 10 },
    output: { type: 'crafting_table', name: 'Crafting Table' },
    placeable: true,
    skillReq: { crafting: 3 },
  },
  upgrade_station: {
    station: 'anvil',
    cost: { iron_bar: 20, mana_crystal: 5 },
    output: { type: 'upgrade_station', name: 'Upgrade Station' },
    placeable: true,
    skillReq: { crafting: 10 },
  },
  trading_booth: {
    station: 'none',
    cost: { wood: 25, iron_bar: 5 },
    output: { type: 'trading_booth', name: 'Trading Booth' },
    placeable: true,
    skillReq: { crafting: 5 },
  },
  crop_plot: {
    station: 'none',
    cost: { wood: 5, stone: 3 },
    output: { type: 'crop_plot', name: 'Crop Plot' },
    placeable: true,
  },
  water_trough: {
    station: 'none',
    cost: { wood: 8, stone: 5 },
    output: { type: 'water_trough', name: 'Water Trough' },
    placeable: true,
  },

  // ===== LOOM STATION (sewing) =====
  loom: {
    station: 'none',
    cost: { wood: 20, thread: 5 },
    output: { type: 'loom', name: 'Loom' },
    placeable: true,
    skillReq: { sewing: 2 },
  },

  // ===== CLOTH TIER (sewing 1-4, cloth) =====
  cloth_hood: { station: 'loom', cost: { cloth: 3 }, output: { type: 'cloth_hood', name: 'Cloth Hood' }, skillReq: { sewing: 1 } },
  cloth_robe: { station: 'loom', cost: { cloth: 6 }, output: { type: 'cloth_robe', name: 'Cloth Robe' }, skillReq: { sewing: 2 } },
  cloth_pants: { station: 'loom', cost: { cloth: 4 }, output: { type: 'cloth_pants', name: 'Cloth Pants' }, skillReq: { sewing: 2 } },
  cloth_gloves: { station: 'loom', cost: { cloth: 2 }, output: { type: 'cloth_gloves', name: 'Cloth Gloves' }, skillReq: { sewing: 1 } },
  cloth_boots: { station: 'loom', cost: { cloth: 3 }, output: { type: 'cloth_boots', name: 'Cloth Boots' }, skillReq: { sewing: 1 } },

  // ===== LEATHER TIER (sewing 5-8, leather) =====
  leather_hood: { station: 'loom', cost: { leather: 4 }, output: { type: 'leather_hood', name: 'Leather Hood' }, skillReq: { sewing: 5 } },
  leather_vest: { station: 'loom', cost: { leather: 8 }, output: { type: 'leather_vest', name: 'Leather Vest' }, skillReq: { sewing: 6 } },
  leather_pants: { station: 'loom', cost: { leather: 5 }, output: { type: 'leather_pants', name: 'Leather Pants' }, skillReq: { sewing: 5 } },
  leather_gloves: { station: 'loom', cost: { leather: 3 }, output: { type: 'leather_gloves', name: 'Leather Gloves' }, skillReq: { sewing: 5 } },
  leather_boots: { station: 'loom', cost: { leather: 4 }, output: { type: 'leather_boots', name: 'Leather Boots' }, skillReq: { sewing: 5 } },

  // ===== REINFORCED LEATHER (sewing 10-14, leather + iron) =====
  reinforced_leather_helm: { station: 'loom', cost: { leather: 6, iron_bar: 2 }, output: { type: 'reinforced_leather_helm', name: 'Reinforced Leather Helm' }, skillReq: { sewing: 10 } },
  reinforced_leather_vest: { station: 'loom', cost: { leather: 12, iron_bar: 4 }, output: { type: 'reinforced_leather_vest', name: 'Reinforced Leather Vest' }, skillReq: { sewing: 12 } },
  reinforced_leather_pants: { station: 'loom', cost: { leather: 8, iron_bar: 2 }, output: { type: 'reinforced_leather_pants', name: 'Reinforced Leather Pants' }, skillReq: { sewing: 10 } },
  reinforced_leather_gloves: { station: 'loom', cost: { leather: 5, iron_bar: 1 }, output: { type: 'reinforced_leather_gloves', name: 'Reinforced Leather Gloves' }, skillReq: { sewing: 10 } },
  reinforced_leather_boots: { station: 'loom', cost: { leather: 6, iron_bar: 2 }, output: { type: 'reinforced_leather_boots', name: 'Reinforced Leather Boots' }, skillReq: { sewing: 11 } },

  // ===== SILK TIER (sewing 14-18, mage-focused) =====
  silk_hood: { station: 'loom', cost: { silk_cloth: 4, mana_crystal: 1 }, output: { type: 'silk_hood', name: 'Silk Hood' }, skillReq: { sewing: 14 } },
  silk_robe: { station: 'loom', cost: { silk_cloth: 8, mana_crystal: 2 }, output: { type: 'silk_robe', name: 'Silk Robe' }, skillReq: { sewing: 16 } },
  silk_pants: { station: 'loom', cost: { silk_cloth: 5, mana_crystal: 1 }, output: { type: 'silk_pants', name: 'Silk Pants' }, skillReq: { sewing: 14 } },
  silk_gloves: { station: 'loom', cost: { silk_cloth: 3, mana_crystal: 1 }, output: { type: 'silk_gloves', name: 'Silk Gloves' }, skillReq: { sewing: 14 } },
  silk_boots: { station: 'loom', cost: { silk_cloth: 4, mana_crystal: 1 }, output: { type: 'silk_boots', name: 'Silk Boots' }, skillReq: { sewing: 15 } },

  // ===== ENCHANTED CLOTH (sewing 20+, endgame mage) =====
  enchanted_hood: { station: 'loom', cost: { silk_cloth: 6, mana_crystal: 3, gem_cut: 1 }, output: { type: 'enchanted_hood', name: 'Enchanted Hood' }, skillReq: { sewing: 20, magic: 10 } },
  enchanted_robe: { station: 'loom', cost: { silk_cloth: 12, mana_crystal: 5, gem_cut: 2 }, output: { type: 'enchanted_robe', name: 'Enchanted Robe' }, skillReq: { sewing: 22, magic: 12 } },
  enchanted_pants: { station: 'loom', cost: { silk_cloth: 7, mana_crystal: 3, gem_cut: 1 }, output: { type: 'enchanted_pants', name: 'Enchanted Pants' }, skillReq: { sewing: 20, magic: 10 } },
  enchanted_gloves: { station: 'loom', cost: { silk_cloth: 4, mana_crystal: 2, gem_cut: 1 }, output: { type: 'enchanted_gloves', name: 'Enchanted Gloves' }, skillReq: { sewing: 20, magic: 10 } },
  enchanted_boots: { station: 'loom', cost: { silk_cloth: 5, mana_crystal: 2, gem_cut: 1 }, output: { type: 'enchanted_boots', name: 'Enchanted Boots' }, skillReq: { sewing: 21, magic: 10 } },

  // ===== COPPER GAUNTLETS/GREAVES/BOOTS =====
  copper_gauntlets: { station: 'anvil', cost: { copper_bar: 3 }, output: { type: 'copper_gauntlets', name: 'Copper Gauntlets' }, skillReq: { crafting: 2 } },
  copper_greaves: { station: 'anvil', cost: { copper_bar: 5 }, output: { type: 'copper_greaves', name: 'Copper Greaves' }, skillReq: { crafting: 3 } },
  copper_boots: { station: 'anvil', cost: { copper_bar: 3 }, output: { type: 'copper_boots', name: 'Copper Boots' }, skillReq: { crafting: 2 } },

  // ===== BRONZE GAUNTLETS/GREAVES/BOOTS =====
  bronze_gauntlets: { station: 'anvil', cost: { bronze_bar: 4 }, output: { type: 'bronze_gauntlets', name: 'Bronze Gauntlets' }, skillReq: { crafting: 4 } },
  bronze_greaves: { station: 'anvil', cost: { bronze_bar: 6 }, output: { type: 'bronze_greaves', name: 'Bronze Greaves' }, skillReq: { crafting: 5 } },
  bronze_boots: { station: 'anvil', cost: { bronze_bar: 4 }, output: { type: 'bronze_boots', name: 'Bronze Boots' }, skillReq: { crafting: 4 } },

  // ===== IRON GAUNTLETS/GREAVES/BOOTS =====
  iron_gauntlets: { station: 'anvil', cost: { iron_bar: 4 }, output: { type: 'iron_gauntlets', name: 'Iron Gauntlets' }, skillReq: { crafting: 6 } },
  iron_greaves: { station: 'anvil', cost: { iron_bar: 8 }, output: { type: 'iron_greaves', name: 'Iron Greaves' }, skillReq: { crafting: 7 } },
  iron_boots: { station: 'anvil', cost: { iron_bar: 5 }, output: { type: 'iron_boots', name: 'Iron Boots' }, skillReq: { crafting: 6 } },

  // ===== STEEL GAUNTLETS/GREAVES/BOOTS =====
  steel_gauntlets: { station: 'anvil', cost: { steel_bar: 5 }, output: { type: 'steel_gauntlets', name: 'Steel Gauntlets' }, skillReq: { crafting: 11 } },
  steel_greaves: { station: 'anvil', cost: { steel_bar: 10 }, output: { type: 'steel_greaves', name: 'Steel Greaves' }, skillReq: { crafting: 12 } },
  steel_boots: { station: 'anvil', cost: { steel_bar: 6 }, output: { type: 'steel_boots', name: 'Steel Boots' }, skillReq: { crafting: 11 } },

  // ===== SILVER GAUNTLETS/GREAVES/BOOTS =====
  silver_gauntlets: { station: 'anvil', cost: { silver_bar: 5 }, output: { type: 'silver_gauntlets', name: 'Silver Gauntlets' }, skillReq: { crafting: 15 } },
  silver_greaves: { station: 'anvil', cost: { silver_bar: 10 }, output: { type: 'silver_greaves', name: 'Silver Greaves' }, skillReq: { crafting: 16 } },
  silver_boots: { station: 'anvil', cost: { silver_bar: 7 }, output: { type: 'silver_boots', name: 'Silver Boots' }, skillReq: { crafting: 15 } },

  // ===== GOLD GAUNTLETS/GREAVES/BOOTS =====
  gold_gauntlets: { station: 'anvil', cost: { gold_bar: 6 }, output: { type: 'gold_gauntlets', name: 'Gold Gauntlets' }, skillReq: { crafting: 19 } },
  gold_greaves: { station: 'anvil', cost: { gold_bar: 12 }, output: { type: 'gold_greaves', name: 'Gold Greaves' }, skillReq: { crafting: 20 } },
  gold_boots: { station: 'anvil', cost: { gold_bar: 7 }, output: { type: 'gold_boots', name: 'Gold Boots' }, skillReq: { crafting: 19 } },

  // ===== MITHRIL GAUNTLETS/GREAVES/BOOTS =====
  mithril_gauntlets: { station: 'anvil', cost: { mithril_bar: 8 }, output: { type: 'mithril_gauntlets', name: 'Mithril Gauntlets' }, skillReq: { crafting: 24 } },
  mithril_greaves: { station: 'anvil', cost: { mithril_bar: 14 }, output: { type: 'mithril_greaves', name: 'Mithril Greaves' }, skillReq: { crafting: 25 } },
  mithril_boots: { station: 'anvil', cost: { mithril_bar: 9 }, output: { type: 'mithril_boots', name: 'Mithril Boots' }, skillReq: { crafting: 23 } },

  // ===== UNDERSHIRTS (sewing) =====
  cloth_undershirt: { station: 'loom', cost: { cloth: 3 }, output: { type: 'cloth_undershirt', name: 'Cloth Undershirt' }, skillReq: { sewing: 1 } },
  leather_undershirt: { station: 'loom', cost: { leather: 4 }, output: { type: 'leather_undershirt', name: 'Leather Undershirt' }, skillReq: { sewing: 4 } },
  padded_undershirt: { station: 'loom', cost: { cloth: 4, leather: 2 }, output: { type: 'padded_undershirt', name: 'Padded Undershirt' }, skillReq: { sewing: 8 } },
  silk_undershirt: { station: 'loom', cost: { silk_cloth: 5, mana_crystal: 1 }, output: { type: 'silk_undershirt', name: 'Silk Undershirt' }, skillReq: { sewing: 15 } },
  enchanted_undershirt: { station: 'loom', cost: { silk_cloth: 8, mana_crystal: 3, gem_cut: 1 }, output: { type: 'enchanted_undershirt', name: 'Enchanted Undershirt' }, skillReq: { sewing: 22, magic: 10 } },
  chainmail_undershirt: { station: 'anvil', cost: { iron_bar: 10 }, output: { type: 'chainmail_undershirt', name: 'Chainmail Undershirt' }, skillReq: { crafting: 8 } },
  mithril_chainmail: { station: 'anvil', cost: { mithril_bar: 12 }, output: { type: 'mithril_chainmail', name: 'Mithril Chainmail' }, skillReq: { crafting: 24 } },

  // ===== ARM GUARDS / BRACERS =====
  cloth_armwraps: { station: 'loom', cost: { cloth: 2 }, output: { type: 'cloth_armwraps', name: 'Cloth Armwraps' }, skillReq: { sewing: 1 } },
  leather_bracers: { station: 'loom', cost: { leather: 3 }, output: { type: 'leather_bracers', name: 'Leather Bracers' }, skillReq: { sewing: 5 } },
  reinforced_leather_bracers: { station: 'loom', cost: { leather: 5, iron_bar: 1 }, output: { type: 'reinforced_leather_bracers', name: 'Reinforced Leather Bracers' }, skillReq: { sewing: 10 } },
  silk_armwraps: { station: 'loom', cost: { silk_cloth: 3, mana_crystal: 1 }, output: { type: 'silk_armwraps', name: 'Silk Armwraps' }, skillReq: { sewing: 14 } },
  enchanted_armwraps: { station: 'loom', cost: { silk_cloth: 5, mana_crystal: 2, gem_cut: 1 }, output: { type: 'enchanted_armwraps', name: 'Enchanted Armwraps' }, skillReq: { sewing: 20, magic: 10 } },
  iron_bracers: { station: 'anvil', cost: { iron_bar: 4 }, output: { type: 'iron_bracers', name: 'Iron Bracers' }, skillReq: { crafting: 6 } },
  steel_bracers: { station: 'anvil', cost: { steel_bar: 5 }, output: { type: 'steel_bracers', name: 'Steel Bracers' }, skillReq: { crafting: 11 } },
  silver_bracers: { station: 'anvil', cost: { silver_bar: 5 }, output: { type: 'silver_bracers', name: 'Silver Bracers' }, skillReq: { crafting: 15 } },
  gold_bracers: { station: 'anvil', cost: { gold_bar: 6 }, output: { type: 'gold_bracers', name: 'Gold Bracers' }, skillReq: { crafting: 19 } },
  mithril_bracers: { station: 'anvil', cost: { mithril_bar: 8 }, output: { type: 'mithril_bracers', name: 'Mithril Bracers' }, skillReq: { crafting: 24 } },

  // ===== NEW CRAFTING STATIONS =====
  alchemy_table: {
    station: 'none',
    cost: { wood: 15, glass_vial: 5, herbs: 10 },
    output: { type: 'alchemy_table', name: 'Alchemy Table' },
    placeable: true,
    skillReq: { alchemy: 1 },
  },
  enchanting_table: {
    station: 'none',
    cost: { wood: 15, mana_crystal: 10, gem_cut: 3 },
    output: { type: 'enchanting_table', name: 'Enchanting Table' },
    placeable: true,
    skillReq: { enchanting: 1 },
  },
  tanning_rack: {
    station: 'none',
    cost: { wood: 15, iron_bar: 3 },
    output: { type: 'tanning_rack', name: 'Tanning Rack' },
    placeable: true,
    skillReq: { leatherworking: 1 },
  },
  brewery: {
    station: 'none',
    cost: { wood: 20, copper_bar: 5, glass_vial: 3 },
    output: { type: 'brewery', name: 'Brewery' },
    placeable: true,
    skillReq: { brewing: 1 },
  },
  jewelers_bench: {
    station: 'none',
    cost: { wood: 10, silver_bar: 5, gem_cut: 2 },
    output: { type: 'jewelers_bench', name: "Jeweler's Bench" },
    placeable: true,
    skillReq: { jewelcrafting: 1 },
  },

  // ===== ALCHEMY RECIPES (alchemy_table station) =====
  potion_strength: { station: 'alchemy_table', cost: { herbs: 3, mushroom: 1, glass_vial: 1 }, output: { type: 'potion_strength', name: 'Strength Potion' }, resource: 'potion_strength', skillReq: { alchemy: 2 } },
  potion_agility: { station: 'alchemy_table', cost: { herbs: 3, vegetables: 1, glass_vial: 1 }, output: { type: 'potion_agility', name: 'Agility Potion' }, resource: 'potion_agility', skillReq: { alchemy: 2 } },
  potion_intellect: { station: 'alchemy_table', cost: { herbs: 3, mana_crystal: 1, glass_vial: 1 }, output: { type: 'potion_intellect', name: 'Intellect Potion' }, resource: 'potion_intellect', skillReq: { alchemy: 3 } },
  potion_resistance: { station: 'alchemy_table', cost: { herbs: 4, mushroom: 2, glass_vial: 1 }, output: { type: 'potion_resistance', name: 'Resistance Potion' }, resource: 'potion_resistance', skillReq: { alchemy: 5 } },
  potion_speed: { station: 'alchemy_table', cost: { herbs: 2, wheat: 2, glass_vial: 1 }, output: { type: 'potion_speed', name: 'Speed Potion' }, resource: 'potion_speed', skillReq: { alchemy: 4 } },
  elixir_vigor: { station: 'alchemy_table', cost: { herbs: 5, mushroom: 3, mana_crystal: 1, glass_vial: 1 }, output: { type: 'elixir_vigor', name: 'Elixir of Vigor' }, resource: 'elixir_vigor', skillReq: { alchemy: 8 } },
  elixir_fortitude: { station: 'alchemy_table', cost: { herbs: 5, vegetables: 3, iron_bar: 1, glass_vial: 1 }, output: { type: 'elixir_fortitude', name: 'Elixir of Fortitude' }, resource: 'elixir_fortitude', skillReq: { alchemy: 10 } },
  poison_vial: { station: 'alchemy_table', cost: { herbs: 4, mushroom: 3, glass_vial: 1 }, output: { type: 'poison_vial', name: 'Poison Vial' }, resource: 'poison_vial', skillReq: { alchemy: 6 } },
  antidote: { station: 'alchemy_table', cost: { herbs: 5, glass_vial: 1 }, output: { type: 'antidote', name: 'Antidote' }, resource: 'antidote', skillReq: { alchemy: 3 } },
  flask_of_fire: { station: 'alchemy_table', cost: { herbs: 3, glass_sand: 2, glass_vial: 1 }, output: { type: 'flask_of_fire', name: 'Flask of Fire' }, resource: 'flask_of_fire', skillReq: { alchemy: 7 } },
  flask_of_frost: { station: 'alchemy_table', cost: { herbs: 3, fish: 2, glass_vial: 1 }, output: { type: 'flask_of_frost', name: 'Flask of Frost' }, resource: 'flask_of_frost', skillReq: { alchemy: 7 } },
  transmutation_dust: { station: 'alchemy_table', cost: { mana_crystal: 2, gem_rough: 1 }, output: { type: 'transmutation_dust', name: 'Transmutation Dust' }, resource: 'transmutation_dust', skillReq: { alchemy: 12, transmutation: 5 } },
  philosophers_stone_shard: { station: 'alchemy_table', cost: { mana_crystal: 5, gem_cut: 3, gold_bar: 2 }, output: { type: 'philosophers_stone_shard', name: "Philosopher's Stone Shard" }, resource: 'philosophers_stone_shard', skillReq: { alchemy: 20, transmutation: 15 } },

  // ===== ENCHANTING RECIPES (enchanting_table station) =====
  scroll_of_protection: { station: 'enchanting_table', cost: { mana_crystal: 2, herbs: 2 }, output: { type: 'scroll_of_protection', name: 'Scroll of Protection' }, resource: 'scroll_of_protection', skillReq: { enchanting: 2 } },
  scroll_of_strength: { station: 'enchanting_table', cost: { mana_crystal: 2, mushroom: 2 }, output: { type: 'scroll_of_strength', name: 'Scroll of Strength' }, resource: 'scroll_of_strength', skillReq: { enchanting: 2 } },
  scroll_of_haste: { station: 'enchanting_table', cost: { mana_crystal: 3, herbs: 3 }, output: { type: 'scroll_of_haste', name: 'Scroll of Haste' }, resource: 'scroll_of_haste', skillReq: { enchanting: 5 } },
  rune_stone_fire: { station: 'enchanting_table', cost: { mana_crystal: 3, stone: 5 }, output: { type: 'rune_stone_fire', name: 'Fire Rune Stone' }, resource: 'rune_stone_fire', skillReq: { enchanting: 4, sigil_scripting: 2 } },
  rune_stone_ice: { station: 'enchanting_table', cost: { mana_crystal: 3, stone: 5 }, output: { type: 'rune_stone_ice', name: 'Ice Rune Stone' }, resource: 'rune_stone_ice', skillReq: { enchanting: 4, sigil_scripting: 2 } },
  rune_stone_lightning: { station: 'enchanting_table', cost: { mana_crystal: 3, stone: 5 }, output: { type: 'rune_stone_lightning', name: 'Lightning Rune Stone' }, resource: 'rune_stone_lightning', skillReq: { enchanting: 4, sigil_scripting: 2 } },
  enchantment_shard: { station: 'enchanting_table', cost: { mana_crystal: 5, gem_cut: 2 }, output: { type: 'enchantment_shard', name: 'Enchantment Shard' }, resource: 'enchantment_shard', skillReq: { enchanting: 8 } },
  arcane_essence: { station: 'enchanting_table', cost: { mana_crystal: 8, dark_crystal: 2, gem_cut: 1 }, output: { type: 'arcane_essence', name: 'Arcane Essence' }, resource: 'arcane_essence', skillReq: { enchanting: 12 } },
  sigil_ink: { station: 'enchanting_table', cost: { herbs: 5, mana_crystal: 2, dark_crystal: 1 }, output: { type: 'sigil_ink', name: 'Sigil Ink' }, resource: 'sigil_ink', skillReq: { sigil_scripting: 3 } },

  // ===== BREWING RECIPES (brewery station) =====
  ale: { station: 'brewery', cost: { wheat: 4 }, output: { type: 'ale', name: 'Ale' }, resource: 'ale', skillReq: { brewing: 1 } },
  mead: { station: 'brewery', cost: { wheat: 3, herbs: 2 }, output: { type: 'mead', name: 'Mead' }, resource: 'mead', skillReq: { brewing: 3 } },
  wine: { station: 'brewery', cost: { vegetables: 5, herbs: 1 }, output: { type: 'wine', name: 'Wine' }, resource: 'wine', skillReq: { brewing: 5 } },
  spirits: { station: 'brewery', cost: { wheat: 6, herbs: 2 }, output: { type: 'spirits', name: 'Spirits' }, resource: 'spirits', skillReq: { brewing: 8 } },
  fortified_ale: { station: 'brewery', cost: { wheat: 5, herbs: 3, mushroom: 1 }, output: { type: 'fortified_ale', name: 'Fortified Ale' }, resource: 'fortified_ale', skillReq: { brewing: 10 } },
  battle_brew: { station: 'brewery', cost: { wheat: 6, herbs: 4, mana_crystal: 1 }, output: { type: 'battle_brew', name: 'Battle Brew' }, resource: 'battle_brew', skillReq: { brewing: 15 } },

  // ===== JEWELCRAFTING RECIPES (jewelers_bench station) =====
  silver_ring: { station: 'jewelers_bench', cost: { silver_bar: 2, gem_cut: 1 }, output: { type: 'silver_ring', name: 'Silver Ring' }, skillReq: { jewelcrafting: 3 } },
  gold_ring_craft: { station: 'jewelers_bench', cost: { gold_bar: 2, gem_cut: 1 }, output: { type: 'gold_ring_craft', name: 'Gold Ring' }, skillReq: { jewelcrafting: 8 } },
  mithril_ring: { station: 'jewelers_bench', cost: { mithril_bar: 2, gem_cut: 2 }, output: { type: 'mithril_ring', name: 'Mithril Ring' }, skillReq: { jewelcrafting: 15 } },
  silver_necklace: { station: 'jewelers_bench', cost: { silver_bar: 3, gem_cut: 1 }, output: { type: 'silver_necklace', name: 'Silver Necklace' }, skillReq: { jewelcrafting: 5 } },
  gold_necklace: { station: 'jewelers_bench', cost: { gold_bar: 3, gem_cut: 2 }, output: { type: 'gold_necklace', name: 'Gold Necklace' }, skillReq: { jewelcrafting: 10 } },
  mithril_necklace: { station: 'jewelers_bench', cost: { mithril_bar: 3, gem_cut: 3, mana_crystal: 2 }, output: { type: 'mithril_necklace', name: 'Mithril Necklace' }, skillReq: { jewelcrafting: 18 } },
  ruby_pendant: { station: 'jewelers_bench', cost: { gold_bar: 2, gem_cut: 3 }, output: { type: 'ruby_pendant', name: 'Ruby Pendant' }, skillReq: { jewelcrafting: 12 } },
  enchanted_ring: { station: 'jewelers_bench', cost: { gold_bar: 3, gem_cut: 2, mana_crystal: 2 }, output: { type: 'enchanted_ring', name: 'Enchanted Ring' }, skillReq: { jewelcrafting: 14, enchanting: 5 } },

  // ===== STRUCTURAL RECIPES (base building) =====
  stone_wall: { station: 'none', cost: { stone: 8 }, output: { type: 'stone_wall', name: 'Stone Wall' }, placeable: true, skillReq: { crafting: 3 } },
  fence: { station: 'none', cost: { wood: 3 }, output: { type: 'fence', name: 'Wooden Fence' }, placeable: true },
  stone_fence: { station: 'none', cost: { stone: 4 }, output: { type: 'stone_fence', name: 'Stone Fence' }, placeable: true, skillReq: { crafting: 2 } },
  iron_fence: { station: 'iron_anvil', cost: { iron_bar: 4 }, output: { type: 'iron_fence', name: 'Iron Fence' }, placeable: true, skillReq: { crafting: 5 } },
  window: { station: 'none', cost: { wood: 4, glass: 2 }, output: { type: 'window', name: 'Window' }, placeable: true, skillReq: { crafting: 3, glassworking: 2 } },
  floor_tile: { station: 'none', cost: { wood: 2 }, output: { type: 'floor_tile', name: 'Wood Floor Tile' }, placeable: true },
  stone_floor: { station: 'none', cost: { stone: 3 }, output: { type: 'stone_floor', name: 'Stone Floor' }, placeable: true, skillReq: { crafting: 2 } },
  carpet: { station: 'loom', cost: { wool: 4, thread: 2 }, output: { type: 'carpet', name: 'Carpet' }, placeable: true, skillReq: { sewing: 3 } },
  stairs: { station: 'none', cost: { wood: 6, stone: 4 }, output: { type: 'stairs', name: 'Stairs' }, placeable: true, skillReq: { crafting: 5 } },
  roof_tile: { station: 'none', cost: { wood: 3, stone: 2 }, output: { type: 'roof_tile', name: 'Roof Tile' }, placeable: true, skillReq: { crafting: 2 } },

  // ===== DECORATIVE RECIPES =====
  lantern: { station: 'none', cost: { iron_bar: 2, glass: 1, oil: 1 }, output: { type: 'lantern', name: 'Lantern' }, placeable: true, skillReq: { crafting: 3 } },
  torch_sconce: { station: 'none', cost: { iron_bar: 1, wood: 2 }, output: { type: 'torch_sconce', name: 'Torch Sconce' }, placeable: true },
  signpost: { station: 'none', cost: { wood: 5 }, output: { type: 'signpost', name: 'Signpost' }, placeable: true },
  flower_pot: { station: 'none', cost: { stone: 3 }, output: { type: 'flower_pot', name: 'Flower Pot' }, placeable: true },
  painting: { station: 'none', cost: { wood: 3, cloth: 2, sigil_ink: 1 }, output: { type: 'painting', name: 'Painting' }, placeable: true, skillReq: { crafting: 5 } },
  rug: { station: 'loom', cost: { wool: 3, thread: 2 }, output: { type: 'rug', name: 'Rug' }, placeable: true, skillReq: { sewing: 2 } },
  clock: { station: 'none', cost: { cogs: 4, gears: 2, wood: 3 }, output: { type: 'clock', name: 'Clock' }, placeable: true, skillReq: { cogworking: 5 } },
  trophy_mount: { station: 'none', cost: { wood: 5, iron_bar: 2 }, output: { type: 'trophy_mount', name: 'Trophy Mount' }, placeable: true, skillReq: { crafting: 4 } },
  statue: { station: 'none', cost: { stone: 15, mana_crystal: 1 }, output: { type: 'statue', name: 'Statue' }, placeable: true, skillReq: { crafting: 10 } },

  // ===== FUNCTIONAL RECIPES (farming) =====
  scarecrow: { station: 'none', cost: { wood: 10, wheat: 5 }, output: { type: 'scarecrow', name: 'Scarecrow' }, placeable: true, skillReq: { farming: 5 } },
  sprinkler: { station: 'iron_anvil', cost: { iron_bar: 8, cogs: 3, gears: 2, springs: 1 }, output: { type: 'sprinkler', name: 'Sprinkler' }, placeable: true, skillReq: { crafting: 12, cogworking: 8 } },
  well: { station: 'none', cost: { stone: 25, iron_bar: 5 }, output: { type: 'well', name: 'Well' }, placeable: true, skillReq: { crafting: 10 } },
  animal_pen: { station: 'none', cost: { wood: 15, iron_bar: 4 }, output: { type: 'animal_pen', name: 'Animal Pen' }, placeable: true, skillReq: { crafting: 5, farming: 3 } },
  garden_bed: { station: 'none', cost: { wood: 6, stone: 2 }, output: { type: 'garden_bed', name: 'Garden Bed' }, placeable: true, skillReq: { farming: 1 } },

  // ===== UPGRADED STATION RECIPES =====
  advanced_forge: { station: 'forge', cost: { iron_bar: 20, stone: 15, mana_crystal: 2 }, output: { type: 'advanced_forge', name: 'Advanced Forge' }, placeable: true, skillReq: { crafting: 15 } },
  master_forge: { station: 'advanced_forge', cost: { steel_bar: 25, mithril_bar: 5, mana_crystal: 5 }, output: { type: 'master_forge', name: 'Master Forge' }, placeable: true, skillReq: { crafting: 30 } },
  advanced_alchemy_table: { station: 'alchemy_table', cost: { iron_bar: 10, mana_crystal: 5, glass_vial: 10 }, output: { type: 'advanced_alchemy_table', name: 'Advanced Alchemy Table' }, placeable: true, skillReq: { alchemy: 15, crafting: 10 } },
  master_alchemy_table: { station: 'advanced_alchemy_table', cost: { mithril_bar: 5, mana_crystal: 10, glass_lens: 5 }, output: { type: 'master_alchemy_table', name: 'Master Alchemy Table' }, placeable: true, skillReq: { alchemy: 25, crafting: 20 } },
  advanced_loom: { station: 'loom', cost: { wood: 15, iron_bar: 10, silk: 5 }, output: { type: 'advanced_loom', name: 'Advanced Loom' }, placeable: true, skillReq: { sewing: 15, crafting: 10 } },
  master_loom: { station: 'advanced_loom', cost: { mithril_bar: 5, silk_cloth: 10, mana_crystal: 3 }, output: { type: 'master_loom', name: 'Master Loom' }, placeable: true, skillReq: { sewing: 25, crafting: 20 } },
  advanced_brewery: { station: 'brewery', cost: { wood: 15, iron_bar: 10, cogs: 5 }, output: { type: 'advanced_brewery', name: 'Advanced Brewery' }, placeable: true, skillReq: { brewing: 15, crafting: 10 } },
  master_brewery: { station: 'advanced_brewery', cost: { mithril_bar: 3, mana_crystal: 5, clockwork_core: 1 }, output: { type: 'master_brewery', name: 'Master Brewery' }, placeable: true, skillReq: { brewing: 25, crafting: 20 } },
  advanced_enchanting_table: { station: 'enchanting_table', cost: { mana_crystal: 10, arcane_essence: 5, mithril_bar: 3 }, output: { type: 'advanced_enchanting_table', name: 'Advanced Enchanting Table' }, placeable: true, skillReq: { enchanting: 15, crafting: 10 } },

  // ===== PROCEDURAL FOOD RECIPES (produce quality items) =====
  herb_tea: { station: 'cauldron', cost: { herbs: 2, wheat: 1 }, output: { type: 'herb_tea', name: 'Herb Tea' }, procedural: true, skillReq: { cooking: 3 } },
  grilled_meat: { station: 'cauldron', cost: { raw_meat: 1, herbs: 1 }, output: { type: 'grilled_meat', name: 'Grilled Meat' }, procedural: true, skillReq: { cooking: 5 } },
  berry_jam: { station: 'cauldron', cost: { berries: 4, wheat: 1 }, output: { type: 'berry_jam', name: 'Berry Jam' }, procedural: true, skillReq: { cooking: 4 } },
  cheese_wheel: { station: 'cauldron', cost: { milk: 3, herbs: 1 }, output: { type: 'cheese_wheel', name: 'Cheese Wheel' }, procedural: true, skillReq: { cooking: 6 } },
  corn_bread: { station: 'cauldron', cost: { corn: 2, wheat: 1, egg: 1 }, output: { type: 'corn_bread', name: 'Corn Bread' }, procedural: true, skillReq: { cooking: 8 } },
  honey_cake: { station: 'cauldron', cost: { honey: 2, wheat: 2, egg: 1 }, output: { type: 'honey_cake', name: 'Honey Cake' }, procedural: true, skillReq: { cooking: 10 } },
  pumpkin_pie: { station: 'cauldron', cost: { pumpkin: 1, wheat: 2, egg: 1, milk: 1 }, output: { type: 'pumpkin_pie', name: 'Pumpkin Pie' }, procedural: true, skillReq: { cooking: 12 } },
  ancient_fruit_wine: { station: 'brewery', cost: { ancient_fruit: 3 }, output: { type: 'ancient_fruit_wine', name: 'Ancient Fruit Wine' }, procedural: true, skillReq: { brewing: 20 } },

  // ===== ANIMAL FEED =====
  animal_feed: { station: 'none', cost: { wheat: 3, vegetables: 1 }, output: { type: 'animal_feed', name: 'Animal Feed' }, resource: 'animal_feed' },

  // ===== DAIRY RECIPES =====
  cheese: { station: 'cauldron', cost: { milk: 2, herbs: 1 }, output: { type: 'cheese', name: 'Cheese' }, resource: 'cheese', skillReq: { cooking: 4 } },
  butter: { station: 'cauldron', cost: { milk: 3 }, output: { type: 'butter', name: 'Butter' }, resource: 'butter', skillReq: { cooking: 2 } },

  // ===== PROCESSING BUILDINGS (placeable) =====
  brewery_station: {
    station: 'none',
    cost: { wood: 30, iron_bar: 10, glass_vial: 5 },
    output: { type: 'brewery', name: 'Brewery' },
    placeable: true,
    skillReq: { crafting: 8 },
  },
  preserving_station: {
    station: 'none',
    cost: { wood: 20, iron_bar: 8, glass_vial: 3 },
    output: { type: 'preserving_station', name: 'Preserving Station' },
    placeable: true,
    skillReq: { crafting: 6 },
  },
  jam_maker: {
    station: 'none',
    cost: { wood: 15, iron_bar: 5, glass_vial: 4 },
    output: { type: 'jam_maker', name: 'Jam Maker' },
    placeable: true,
    skillReq: { crafting: 4 },
  },

  // ===== PROCESSING RECIPES (require station proximity) =====
  ale_batch: {
    station: 'brewery',
    cost: { wheat: 5 },
    output: { type: 'ale', name: 'Ale (Batch)', quantity: 2 },
    resource: 'ale',
    skillReq: { cooking: 5 },
    processingTime: 30000,
  },
  wine_batch: {
    station: 'brewery',
    cost: { vegetables: 8 },
    output: { type: 'wine', name: 'Wine (Batch)', quantity: 2 },
    resource: 'wine',
    skillReq: { cooking: 8 },
    processingTime: 60000,
  },
  pickled_vegetables: {
    station: 'preserving_station',
    cost: { vegetables: 10, glass_vial: 1 },
    output: { type: 'pickled_vegetables', name: 'Pickled Vegetables', quantity: 3 },
    resource: 'pickled_vegetables',
    skillReq: { cooking: 3 },
    processingTime: 20000,
  },
  herb_preserves: {
    station: 'preserving_station',
    cost: { herbs: 8, glass_vial: 1 },
    output: { type: 'herb_preserves', name: 'Herb Preserves', quantity: 2 },
    resource: 'herb_preserves',
    skillReq: { cooking: 6 },
    processingTime: 30000,
  },
  berry_jam_batch: {
    station: 'jam_maker',
    cost: { vegetables: 6 },
    output: { type: 'berry_jam', name: 'Berry Jam (Batch)', quantity: 3 },
    resource: 'berry_jam',
    skillReq: { cooking: 2 },
    processingTime: 15000,
  },
  fruit_jam: {
    station: 'jam_maker',
    cost: { herbs: 5, wheat: 2 },
    output: { type: 'fruit_jam', name: 'Fruit Jam', quantity: 2 },
    resource: 'fruit_jam',
    skillReq: { cooking: 4 },
    processingTime: 20000,
  },

  // ===== ENCUMBRANCE ITEMS =====
  cart: {
    station: 'none',
    cost: { wood: 30, iron_bar: 5 },
    output: { type: 'cart', name: 'Cart' },
    skillReq: { crafting: 5 },
  },
  pack_mule_tack: {
    station: 'none',
    cost: { wood: 10, iron_bar: 3 },
    output: { type: 'pack_mule_tack', name: 'Pack Mule Tack' },
    skillReq: { crafting: 3 },
  },
};

// Merge RPG recipes from rpg-data.js
var rpgRecipes = rpgData.NEW_RECIPES;
for (var recipeId in rpgRecipes) {
  if (!RECIPES[recipeId]) {
    RECIPES[recipeId] = rpgRecipes[recipeId];
  }
}

// ---------------------------------------------------------------------------
// Advanced material smelting recipes
// ---------------------------------------------------------------------------
var ADVANCED_SMELTING = {
  stormsteel_bar: { station: 'forge', cost: { iron_bar: 3, mana_crystal: 1, lightning_essence: 1 }, output: { type: 'stormsteel_bar', name: 'Stormsteel Bar' }, resource: 'stormsteel_bar', skillReq: { crafting: 50 } },
  deepsilver_bar: { station: 'forge', cost: { silver_bar: 2, mana_crystal: 2, ancient_coral: 1 }, output: { type: 'deepsilver_bar', name: 'Deepsilver Bar' }, resource: 'deepsilver_bar', skillReq: { crafting: 65 } },
  soulforged_bar: { station: 'forge', cost: { mithril_bar: 2, dungeon_essence: 3, dark_crystal: 1 }, output: { type: 'soulforged_bar', name: 'Soulforged Bar' }, resource: 'soulforged_bar', skillReq: { crafting: 80 } },
  voidmetal_bar:  { station: 'forge', cost: { soulforged_bar: 1, dark_crystal: 3, boss_trophy: 1 }, output: { type: 'voidmetal_bar', name: 'Voidmetal Bar' }, resource: 'voidmetal_bar', skillReq: { crafting: 95 } },
};
for (var smeltId in ADVANCED_SMELTING) { if (!RECIPES[smeltId]) RECIPES[smeltId] = ADVANCED_SMELTING[smeltId]; }

// ---------------------------------------------------------------------------
// Gem cutting recipes (jewelers_bench)
// ---------------------------------------------------------------------------
var GEM_RECIPES = {};
for (var gemId in lootGen.GEM_TYPES) {
  var gem = lootGen.GEM_TYPES[gemId];
  GEM_RECIPES['cut_' + gemId] = {
    station: 'jewelers_bench',
    cost: gem.craftFrom,
    output: { type: gemId, name: gem.name },
    resource: gemId,
    skillReq: gem.craftSkill,
  };
}
for (var grId in GEM_RECIPES) { if (!RECIPES[grId]) RECIPES[grId] = GEM_RECIPES[grId]; }

// ---------------------------------------------------------------------------
// Specialized ring recipes (jewelers_bench)
// ---------------------------------------------------------------------------
var RING_RECIPES = {};
for (var ringId in lootGen.RING_DESIGNS) {
  var ring = lootGen.RING_DESIGNS[ringId];
  if (ring.craftFrom) {
    RING_RECIPES[ringId] = {
      station: 'jewelers_bench',
      cost: ring.craftFrom,
      output: { type: ringId, name: ring.name },
      skillReq: ring.craftSkill || { jewelcrafting: 10 },
    };
  }
}
for (var rrId in RING_RECIPES) { if (!RECIPES[rrId]) RECIPES[rrId] = RING_RECIPES[rrId]; }

// ---------------------------------------------------------------------------
// Augment crafting recipes (various stations)
// ---------------------------------------------------------------------------
var AUGMENT_RECIPES = {};
for (var augId in lootGen.AUGMENT_TYPES) {
  var aug = lootGen.AUGMENT_TYPES[augId];
  var station = 'anvil';
  if (aug.requiredSkill && aug.requiredSkill.enchanting) station = 'enchanting_table';
  if (aug.requiredSkill && aug.requiredSkill.alchemy) station = 'alchemy_table';
  AUGMENT_RECIPES['craft_augment_' + augId] = {
    station: station,
    cost: aug.craftFrom,
    output: { type: augId, name: aug.name },
    resource: augId,
    skillReq: aug.requiredSkill,
  };
}
for (var arId in AUGMENT_RECIPES) { if (!RECIPES[arId]) RECIPES[arId] = AUGMENT_RECIPES[arId]; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

var STATION_PROXIMITY_PX = 100;

/**
 * Generate a 12-character hex ID for crafted items.
 */
function generateItemId() {
  return crypto.randomBytes(6).toString('hex');
}

/**
 * Build a serializable recipe list for the client.
 * Returns an array of { id, name, station, cost, output, placeable, requiresLockId }.
 */
function buildRecipeList() {
  var list = [];
  var ids = Object.keys(RECIPES);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var r = RECIPES[id];
    list.push({
      id: id,
      name: r.output.name,
      station: r.station,
      cost: r.cost,
      outputType: r.output.type,
      placeable: !!r.placeable,
      resource: r.resource || null,
      requiresLockId: !!r.requiresLockId,
      skillReq: r.skillReq || null,
    });
  }
  return list;
}

// Pre-build the list once since RECIPES is static
var cachedRecipeList = buildRecipeList();

// Rebuild after merging RPG recipes
cachedRecipeList = buildRecipeList();

// Append portal recipe as informational entry (crafted via portal_craft event on your plot)
(function() {
  var portalHandler = require('./portal');
  cachedRecipeList.push({
    id: 'personal_portal',
    name: 'Personal Portal',
    station: 'overworld_plot',
    cost: portalHandler.PORTAL_CRAFT_COST,
    outputType: 'personal_portal',
    placeable: true,
    resource: null,
    requiresLockId: false,
    skillReq: { crafting: 20 },
    portalCraft: true,
  });
})();

/**
 * Check whether the player is within STATION_PROXIMITY_PX of a placed object
 * matching the required station type.
 *
 * @param {object} state - The shared state module
 * @param {string} socketId - The player's socket ID
 * @param {string} stationType - 'forge' or 'anvil'
 * @returns {object|null} The found station object, or null if not near one
 */
function isNearStation(state, socketId, stationType) {
  var pos = state.playerPositions.get(socketId);
  if (!pos) return null;

  var zoneId = state.playerZones.get(socketId);
  if (!zoneId) return null;

  var zone = state.zones.get(zoneId);
  if (!zone) return null;

  var placedObjects = zone.placedObjects;
  if (!placedObjects || !Array.isArray(placedObjects)) return null;

  var px = pos.x;
  var py = pos.y;
  var maxDist = STATION_PROXIMITY_PX;

  for (var i = 0; i < placedObjects.length; i++) {
    var obj = placedObjects[i];
    if (!obj || obj.type !== stationType) continue;

    var dx = (obj.x || 0) - px;
    var dy = (obj.y || 0) - py;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < maxDist) return obj;
  }

  return null;
}

/**
 * Check whether the player owns a lock item with the given lockId in their
 * mmoInventory items array.
 *
 * @param {object} mmoInventory - The player's mmoInventory object
 * @param {string} lockId - The lock ID to search for
 * @returns {boolean}
 */
function playerOwnsLock(mmoInventory, lockId) {
  if (!mmoInventory || !mmoInventory.items || !Array.isArray(mmoInventory.items)) return false;

  for (var i = 0; i < mmoInventory.items.length; i++) {
    var item = mmoInventory.items[i];
    if (item && item.type === 'iron_lock' && item.id === lockId) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = {
  RECIPES: RECIPES,

  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, state, checkEventRate } = deps;

    // ------------------------------------------------------------------
    // get_recipes: client requests the full recipe catalogue
    // ------------------------------------------------------------------
    socket.on('get_recipes', function() {
      try {

        socket.emit('recipes_list', { recipes: cachedRecipeList });
      } catch (err) {
        console.error('[get_recipes] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // craft_item: attempt to craft a recipe
    // ------------------------------------------------------------------
    socket.on('craft_item', function(data) {
      try {

        // --- Input validation ---
        if (!data || typeof data.recipeId !== 'string') {
          socket.emit('craft_error', { message: 'Invalid request' });
          return;
        }

        var recipeId = data.recipeId;
        if (recipeId.length > 64) {
          socket.emit('craft_error', { message: 'Invalid recipe ID' });
          return;
        }

        var key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('craft_error', { message: 'No account found' });
          return;
        }

        // --- Recipe lookup ---
        var recipe = RECIPES[recipeId];
        if (!recipe) {
          socket.emit('craft_error', { message: 'Recipe not found' });
          return;
        }

        // --- Station proximity check ---
        var nearStation = null;
        if (recipe.station !== 'none') {
          nearStation = isNearStation(state, socket.id, recipe.station);
          if (!nearStation) {
            socket.emit('craft_error', {
              message: 'You must be near a ' + recipe.station + ' to craft this',
            });
            return;
          }
          // Ownership gating: cannot use another player's station on their plot
          if (nearStation.ownerKey) {
            var craftZone = state.zones.get(state.playerZones.get(socket.id));
            if (craftZone && craftZone.type === 'plot' && craftZone.ownerKey !== key && nearStation.ownerKey !== key) {
              socket.emit('craft_error', { message: 'You cannot use another player\'s crafting station' });
              return;
            }
          }
        }

        // --- Skill requirement check (RPG recipes) ---
        if (recipe.skillReq) {
          var accKey2 = socketAccountMap.get(socket.id);
          var skillNames = Object.keys(recipe.skillReq);
          for (var si = 0; si < skillNames.length; si++) {
            var sName = skillNames[si];
            var reqLevel = recipe.skillReq[sName];
            var playerSkill = accounts.getSkill(accKey2, sName);
            if (!playerSkill || playerSkill.level < reqLevel) {
              socket.emit('craft_error', {
                message: 'Requires ' + sName.charAt(0).toUpperCase() + sName.slice(1) + ' Lv.' + reqLevel,
              });
              return;
            }
          }
        }

        // --- Lock ID validation for key_copy ---
        var lockId = null;
        if (recipe.requiresLockId) {
          if (!data.lockId || typeof data.lockId !== 'string') {
            socket.emit('craft_error', { message: 'A lock ID is required to copy a key' });
            return;
          }
          lockId = data.lockId;
          if (lockId.length > 64) {
            socket.emit('craft_error', { message: 'Invalid lock ID' });
            return;
          }

          // Verify the player owns a lock with this ID
          var inv = accounts.getMMOInventory(key);
          if (!inv) {
            socket.emit('craft_error', { message: 'Inventory not found' });
            return;
          }
          if (!playerOwnsLock(inv, lockId)) {
            socket.emit('craft_error', { message: 'You do not own a lock with that ID' });
            return;
          }
        }

        // --- Quality Minigame Check (for advanced recipes) ---
        var maxSkillReqVal = 0;
        if (recipe.skillReq) {
          var _reqKeys = Object.keys(recipe.skillReq);
          for (var _ri = 0; _ri < _reqKeys.length; _ri++) {
            if (recipe.skillReq[_reqKeys[_ri]] > maxSkillReqVal) maxSkillReqVal = recipe.skillReq[_reqKeys[_ri]];
          }
        }
        if (maxSkillReqVal >= QUALITY_CRAFT_SKILL_THRESHOLD && !data.skipMinigame) {
          // Check resources first before starting minigame
          var _preInv = accounts.getMMOInventory(key);
          if (_preInv) {
            var _canAfford = true;
            var _costKeys = Object.keys(recipe.cost);
            for (var _ci = 0; _ci < _costKeys.length; _ci++) {
              if ((_preInv[_costKeys[_ci]] || 0) < recipe.cost[_costKeys[_ci]]) { _canAfford = false; break; }
            }
            if (_canAfford) {
              // Deduct resources before minigame (consumed regardless of quality)
              for (var _di = 0; _di < _costKeys.length; _di++) {
                accounts.removeResource(key, _costKeys[_di], recipe.cost[_costKeys[_di]]);
              }
              // Generate timing window
              var _duration = recipe.station === 'none' ? 5000 : 8000;
              var _baseWindow = 800;
              var _craftAccount = accounts.loadAccount(key);
              var _ingenuity = (_craftAccount && _craftAccount.rpgStats && _craftAccount.rpgStats.ingenuity) || 5;
              var _ingBonus = _ingenuity * 20;
              var _raceBonus = (_craftAccount && _craftAccount.race === 'Gnome') ? 0.30 : 0;
              var _ascBonus = ((_craftAccount && _craftAccount.ascensionTree && _craftAccount.ascensionTree['artisan_legacy']) || 0) * 0.10;
              var _windowMs = Math.floor(_baseWindow + _ingBonus + (_baseWindow * (_raceBonus + _ascBonus)));
              var _targetPos = Math.floor(Math.random() * 600) + 200;
              var _windowHalf = Math.floor(_windowMs / 2);
              var _windowStart = Math.max(0, _targetPos - _windowHalf);
              var _windowEnd = Math.min(1000, _targetPos + _windowHalf);
              var _expiresAt = Date.now() + _duration;
              pendingMinigames.set(socket.id, {
                recipeId: recipeId,
                windowStart: _windowStart,
                windowEnd: _windowEnd,
                expiresAt: _expiresAt,
                account_key: key,
              });
              socket.emit('craft_minigame', {
                recipeId: recipeId,
                duration: _duration,
                windowStart: _windowStart,
                windowEnd: _windowEnd,
                expiresAt: _expiresAt,
              });
              return; // Don't complete craft yet -- wait for minigame result
            }
          }
        }

        // --- Acquire per-account craft lock to prevent double-spend ---
        if (craftLocks.has(key)) {
          socket.emit('craft_error', { message: 'Crafting in progress' });
          return;
        }
        craftLocks.add(key);

        try {
          // --- Resource sufficiency check ---
          var mmoInv = accounts.getMMOInventory(key);
          if (!mmoInv) {
            socket.emit('craft_error', { message: 'Inventory not found' });
            return;
          }

          var costTypes = Object.keys(recipe.cost);
          for (var i = 0; i < costTypes.length; i++) {
            var resType = costTypes[i];
            var needed = recipe.cost[resType];
            var have = mmoInv[resType] || 0;
            if (have < needed) {
              socket.emit('craft_error', {
                message: 'Not enough ' + resType.replace(/_/g, ' ') +
                         ' (need ' + needed + ', have ' + have + ')',
              });
              return;
            }
          }

          // --- Load account and compute crafting skill bonuses ---
          var craftAccount = accounts.loadAccount(key);
          var craftBonuses = craftAccount ? rpgData.getCraftingSkillBonuses(craftAccount) : null;

          // --- Load equipped card effects for crafting bonuses ---
          var cardEffects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(key) : [];
          var cardIngredientSave = 0;
          var cardCraftBonus = 0;          // % chance for double output
          var cardCraftQualityBonus = 0;   // bonus stats on crafted equipment
          var cardWeaponDmgBonus = 0;      // % increase to crafted weapon damage
          var cardArmorDefBonus = 0;       // flat defense added to crafted armor
          var cardSewingArmorBonus = 0;    // flat defense for sewing items
          var cardSewingMagicResist = 0;   // flat magicResist for sewing items
          var cardEnchantPowerBonus = 0;   // % increase to enchanting effect value
          var cardDoublePotionChance = 0;  // chance for double potion output
          var cardDoubleEnchantChance = 0; // chance for double enchant output
          var cardBrewPotencyBonus = 0;    // % increase to brewery effect value
          var cardGemYieldBonus = 0;       // chance for bonus gem output
          for (var ce = 0; ce < cardEffects.length; ce++) {
            var cEff = cardEffects[ce];
            if (cEff.type === 'ingredientSaveChance') cardIngredientSave += (cEff.value || 0);
            if (cEff.type === 'craft_bonus') cardCraftBonus += (cEff.value || 0);
            if (cEff.type === 'craft_quality_bonus') cardCraftQualityBonus += (cEff.value || 0);
            if (cEff.type === 'crafted_weapon_damage_bonus') cardWeaponDmgBonus += (cEff.value || 0);
            if (cEff.type === 'crafted_armor_bonus') cardArmorDefBonus += (cEff.value || 0);
            if (cEff.type === 'sewing_armor_bonus') cardSewingArmorBonus += (cEff.value || 0);
            if (cEff.type === 'sewing_magic_resist_bonus') cardSewingMagicResist += (cEff.value || 0);
            if (cEff.type === 'enchant_power_bonus') cardEnchantPowerBonus += (cEff.value || 0);
            if (cEff.type === 'doublePotionChance') cardDoublePotionChance += (cEff.value || 0);
            if (cEff.type === 'doubleEnchantChance') cardDoubleEnchantChance += (cEff.value || 0);
            if (cEff.type === 'brew_potency_bonus') cardBrewPotencyBonus += (cEff.value || 0);
            if (cEff.type === 'gem_yield_bonus') cardGemYieldBonus += (cEff.value || 0);
          }

          // --- Preflight: verify all ingredients are available before deducting any ---
          var totalIngredientSave = (craftBonuses ? (craftBonuses.ingredientSaveChance || 0) : 0) + cardIngredientSave;
          // Pre-roll the ingredient saves so we use consistent values in both preflight and deduct
          var _prerolledAmounts = {};
          for (var pf = 0; pf < costTypes.length; pf++) {
            var pfRt = costTypes[pf];
            var pfAmt = recipe.cost[pfRt];
            if (totalIngredientSave > 0 && pfAmt > 1 && Math.random() < totalIngredientSave) {
              pfAmt = pfAmt - 1;
            }
            _prerolledAmounts[pfRt] = pfAmt;
          }
          var _inv = accounts.getMMOInventory(key);
          for (var pfc = 0; pfc < costTypes.length; pfc++) {
            var pfcRt = costTypes[pfc];
            var pfcHave = (_inv && _inv[pfcRt]) ? _inv[pfcRt] : 0;
            if (pfcHave < _prerolledAmounts[pfcRt]) {
              socket.emit('craft_error', {
                message: 'Not enough ' + pfcRt.replace(/_/g, ' ') + ' (' + pfcHave + '/' + _prerolledAmounts[pfcRt] + ')',
              });
              return;
            }
          }

          // --- Deduct resources (amounts already rolled above) ---
          for (var j = 0; j < costTypes.length; j++) {
            var rt = costTypes[j];
            var amt = _prerolledAmounts[rt];
            var result = accounts.removeResource(key, rt, amt);
            if (result === null) {
              socket.emit('craft_error', {
                message: 'Failed to deduct ' + rt.replace(/_/g, ' ') + ' -- not enough resources',
              });
              return;
            }
          }

          // --- Determine crafting context for card bonuses ---
          var isSewingRecipe = (recipe.station === 'loom');
          var isAlchemyRecipe = (recipe.station === 'alchemy_table');
          var isEnchantRecipe = (recipe.station === 'enchanting_table');
          var isBreweryRecipe = (recipe.station === 'brewery');
          var isJewelRecipe = (recipe.station === 'jewelers_bench');

          // --- Produce output ---

          // Procedural food: generates quality items with affixes
          if (recipe.procedural) {
            var cookingSkillLevel = 1;
            if (craftAccount && craftAccount.skills && craftAccount.skills.cooking) {
              cookingSkillLevel = craftAccount.skills.cooking.level || 1;
            }
            if (craftAccount && craftAccount.skills && craftAccount.skills.brewing && recipe.station === 'brewery') {
              cookingSkillLevel = Math.max(cookingSkillLevel, craftAccount.skills.brewing.level || 1);
            }
            // Station tier bonus
            var stationTierBonus = 0;
            if (nearStation && rpgData.STATION_UPGRADE_TIERS[nearStation.type]) {
              stationTierBonus = rpgData.STATION_UPGRADE_TIERS[nearStation.type].qualityBonus || 0;
            }
            var _craftLuck = accounts.getPlayerLuck(key);
            var foodItem = lootGen.generateConsumable(recipe.output.type, recipe.output.name, {
              craftSkillLevel: cookingSkillLevel + Math.floor(stationTierBonus * 10),
              source: 'craft',
              luckBonus: _craftLuck,
            });
            if (foodItem) {
              foodItem.isFoodItem = true;
              if (craftAccount && craftAccount.username) foodItem.craftedBy = craftAccount.username;
              accounts.addMMOItem(key, foodItem);
            } else {
              // Fallback: add as plain resource
              accounts.addResource(key, recipe.output.type, 1);
            }
          }

          // If the recipe outputs a resource (e.g. iron_bar smelting), add it
          // to the resource pool rather than as an item.
          var resourceOutputAmount = 1;
          if (!recipe.procedural && recipe.resource) {
            // Check if this is a consumable type that should get procedural generation
            var consumableCategory = lootGen.getConsumableCategory(recipe.resource);
            var isAdvancedConsumable = consumableCategory && (
              (isAlchemyRecipe && (recipe.skillReq && recipe.skillReq.alchemy >= 4)) ||
              (isEnchantRecipe && (recipe.skillReq && recipe.skillReq.enchanting >= 4)) ||
              (isBreweryRecipe && (recipe.skillReq && recipe.skillReq.brewing >= 5))
            );

            if (isAdvancedConsumable) {
              // --- PROCEDURAL CONSUMABLE GENERATION ---
              // Advanced potions/scrolls/brews become individual items with quality + affixes
              var relevantSkill = 'crafting';
              var skillLevel = 1;
              if (craftAccount && craftAccount.skills) {
                if (isAlchemyRecipe && craftAccount.skills.alchemy) {
                  relevantSkill = 'alchemy';
                  skillLevel = craftAccount.skills.alchemy.level || 1;
                } else if (isEnchantRecipe && craftAccount.skills.enchanting) {
                  relevantSkill = 'enchanting';
                  skillLevel = craftAccount.skills.enchanting.level || 1;
                } else if (isBreweryRecipe && craftAccount.skills.brewing) {
                  relevantSkill = 'brewing';
                  skillLevel = craftAccount.skills.brewing.level || 1;
                }
              }
              var _advCraftLuck = accounts.getPlayerLuck(key);
              var consumableItem = lootGen.generateConsumable(recipe.resource, recipe.output.name, {
                craftSkillLevel: skillLevel,
                source: 'craft',
                luckBonus: _advCraftLuck,
              });
              if (consumableItem) {
                // Apply card-based bonuses
                if (isBreweryRecipe && cardBrewPotencyBonus > 0) {
                  consumableItem.brewPotencyBonus = cardBrewPotencyBonus;
                }
                if (isEnchantRecipe && cardEnchantPowerBonus > 0) {
                  consumableItem.enchantPowerBonus = cardEnchantPowerBonus;
                }
                if (craftAccount && craftAccount.username) consumableItem.craftedBy = craftAccount.username;
                accounts.addMMOItem(key, consumableItem);
                // Double output chance
                var doubleChance = 0;
                if (isAlchemyRecipe) doubleChance = cardDoublePotionChance;
                else if (isEnchantRecipe) doubleChance = cardDoubleEnchantChance;
                else if (isBreweryRecipe) doubleChance = cardDoublePotionChance;
                if (doubleChance > 0 && Math.random() < doubleChance) {
                  var bonusConsumable = lootGen.generateConsumable(recipe.resource, recipe.output.name, {
                    craftSkillLevel: skillLevel,
                    source: 'craft',
                    luckBonus: _advCraftLuck,
                  });
                  if (bonusConsumable) {
                    if (craftAccount && craftAccount.username) bonusConsumable.craftedBy = craftAccount.username;
                    accounts.addMMOItem(key, bonusConsumable);
                  }
                }
              } else {
                // Fallback: add as plain resource
                accounts.addResource(key, recipe.resource, 1);
              }
            } else {
              // Standard resource output (basic smelting, low-level potions, raw materials)
              // Double output chance from cards: potions, enchants, brews, gems
              if (isAlchemyRecipe && cardDoublePotionChance > 0 && Math.random() < cardDoublePotionChance) {
                resourceOutputAmount = 2;
              } else if (isEnchantRecipe && cardDoubleEnchantChance > 0 && Math.random() < cardDoubleEnchantChance) {
                resourceOutputAmount = 2;
              } else if (isBreweryRecipe && cardDoublePotionChance > 0 && Math.random() < cardDoublePotionChance) {
                resourceOutputAmount = 2; // brewery double uses same potion chance
              } else if (isJewelRecipe && cardGemYieldBonus > 0 && Math.random() < cardGemYieldBonus) {
                resourceOutputAmount = 2;
              } else if (cardCraftBonus > 0 && Math.random() < (cardCraftBonus / 100)) {
                resourceOutputAmount = 2;
              }
              accounts.addResource(key, recipe.resource, resourceOutputAmount);
            }
          }

          // If the recipe produces a placeable or equipment item, add it to
          // the items array.
          if (recipe.placeable || !recipe.resource) {
            var newItem;
            var isEquipment = accounts.WEAPON_TYPES && accounts.WEAPON_TYPES[recipe.output.type];

            if (isEquipment) {
              // --- PROCEDURAL EQUIPMENT GENERATION via loot-generator ---
              var baseDef = accounts.WEAPON_TYPES[recipe.output.type];
              var _eqSkillLevel = 1;
              if (craftAccount && craftAccount.skills) {
                var _eqSkillCandidates = ['crafting', 'leatherworking', 'sewing', 'blacksmithing', 'cogworking'];
                for (var _eqSi = 0; _eqSi < _eqSkillCandidates.length; _eqSi++) {
                  var _eqSk = craftAccount.skills[_eqSkillCandidates[_eqSi]];
                  if (_eqSk && (_eqSk.level || 0) > _eqSkillLevel) _eqSkillLevel = _eqSk.level;
                }
              }
              var _eqLuck = accounts.getPlayerLuck(key);
              var genItem = lootGen.generateItem(recipe.output.type, baseDef, {
                source: 'craft',
                depth: 1,
                forcedRarity: baseDef.rarity || 'common',
                craftSkillLevel: _eqSkillLevel,
                luckBonus: _eqLuck,
              });

              // Apply card-based crafting bonuses on top of procedural stats
              if (genItem.stats) {
                if (baseDef.slot === 'weapon' && genItem.stats.damage && cardWeaponDmgBonus > 0) {
                  genItem.stats.damage = Math.round(genItem.stats.damage * (1 + cardWeaponDmgBonus) * 100) / 100;
                }
                if (baseDef.defense && cardArmorDefBonus > 0) {
                  genItem.stats.defense = (genItem.stats.defense || 0) + Math.max(1, Math.round(baseDef.defense * cardArmorDefBonus));
                }
                if (isSewingRecipe && cardSewingArmorBonus > 0) {
                  genItem.stats.defense = (genItem.stats.defense || 0) + cardSewingArmorBonus;
                }
                if (isSewingRecipe && cardSewingMagicResist > 0) {
                  genItem.stats.magicResist = (genItem.stats.magicResist || 0) + cardSewingMagicResist;
                }
                if (isEnchantRecipe && cardEnchantPowerBonus > 0) {
                  var enchBase = genItem.stats.magicDamage || genItem.stats.damage || 5;
                  genItem.stats.magicDamage = (genItem.stats.magicDamage || 0) + Math.max(1, Math.round(enchBase * cardEnchantPowerBonus));
                }
                if (isBreweryRecipe && cardBrewPotencyBonus > 0) {
                  genItem.brewPotencyBonus = cardBrewPotencyBonus;
                }
                if (cardCraftQualityBonus > 0) {
                  if (baseDef.slot === 'weapon' && genItem.stats.damage) {
                    genItem.stats.damage = Math.round(genItem.stats.damage * (1 + cardCraftQualityBonus) * 100) / 100;
                  } else if (genItem.stats.defense) {
                    genItem.stats.defense = Math.round(genItem.stats.defense * (1 + cardCraftQualityBonus) * 100) / 100;
                  }
                }
              }

              // Perk: enhancedItemChance — bonus damage on lucky rolls
              if (craftBonuses && craftBonuses.enhancedItemChance > 0 && Math.random() < craftBonuses.enhancedItemChance) {
                genItem.stats.damage = (genItem.stats.damage || 0) + (craftBonuses.flatItemStatBonus || 0) + 1;
              }

              // Initialize durability
              var baseDur = accounts.getMaxDurability(recipe.output.type);
              var durBonus = 0;
              for (var dc = 0; dc < cardEffects.length; dc++) {
                if (cardEffects[dc].type === 'crafted_durability_bonus') durBonus += cardEffects[dc].value || 0;
              }
              if (genItem.stats && genItem.stats.durabilityBonus) durBonus += genItem.stats.durabilityBonus;
              genItem.maxDurability = Math.round(baseDur * (1 + durBonus));
              genItem.durability = genItem.maxDurability;

              // Tag crafter
              if (craftAccount && craftAccount.username) genItem.craftedBy = craftAccount.username;

              newItem = genItem;
            } else {
              // --- NON-EQUIPMENT items (placeables, locks, keys, etc.) ---
              newItem = {
                id: generateItemId(),
                type: recipe.output.type,
                name: recipe.output.name,
                data: {},
              };
              if (craftAccount && craftAccount.username) newItem.craftedBy = craftAccount.username;
              if (recipe.requiresLockId && lockId) newItem.data.lockId = lockId;
              if (recipe.output.type === 'iron_lock') newItem.data.lockId = generateItemId();
            }

            var addResult = accounts.addMMOItem(key, newItem);
            if (addResult && addResult.error) {
              socket.emit('craft_error', { message: addResult.error });
              return;
            }

            // Card: craft_bonus — % chance for a second output item (double craft)
            if (cardCraftBonus > 0 && Math.random() < (cardCraftBonus / 100)) {
              var bonusItem;
              if (isEquipment) {
                // Generate a second procedural item
                bonusItem = lootGen.generateItem(recipe.output.type, accounts.WEAPON_TYPES[recipe.output.type], { source: 'craft', craftSkillLevel: _eqSkillLevel, luckBonus: _eqLuck });
                if (newItem.maxDurability) { bonusItem.maxDurability = newItem.maxDurability; bonusItem.durability = newItem.maxDurability; }
              } else {
                bonusItem = { id: generateItemId(), type: newItem.type, name: newItem.name, data: {} };
                if (newItem.maxDurability) { bonusItem.maxDurability = newItem.maxDurability; bonusItem.durability = newItem.maxDurability; }
              }
              if (craftAccount && craftAccount.username) bonusItem.craftedBy = craftAccount.username;
              accounts.addMMOItem(key, bonusItem);
            }
          }

          // --- Award crafting skill XP (proportional across all required skills) ---
          var skillReqs = recipe.skillReq || {};
          var skillReqEntries = Object.keys(skillReqs);
          if (skillReqEntries.length === 0) {
            skillReqEntries = ['crafting'];
            skillReqs = { crafting: 0 };
          }
          var totalWeight = 0;
          for (var si = 0; si < skillReqEntries.length; si++) {
            totalWeight += Math.max(1, skillReqs[skillReqEntries[si]] || 0);
          }
          var highestReqLevel = 0;
          for (var sj = 0; sj < skillReqEntries.length; sj++) {
            if ((skillReqs[skillReqEntries[sj]] || 0) > highestReqLevel)
              highestReqLevel = skillReqs[skillReqEntries[sj]];
          }
          var baseXp = 5 + Object.keys(recipe.cost).length * 3 + highestReqLevel * 5;
          for (var sk = 0; sk < skillReqEntries.length; sk++) {
            var skName = skillReqEntries[sk];
            var skWeight = Math.max(1, skillReqs[skName] || 0);
            var skXp = Math.round(baseXp * (skWeight / totalWeight));
            accounts.addSkillXp(key, skName, skXp);
          }
          var craftSkillName = skillReqEntries[0];
          var craftXpAmount = baseXp;

          // --- Phantom Skill XP: Gourmand for cooking recipes ---
          if (skillReqs.cooking && skillReqs.cooking > 0) {
            var gourmandCraftXp = 15 + Math.floor(Math.random() * 16); // 15-30
            accounts.addSkillXp(key, 'gourmand', gourmandCraftXp);
          }

          // Card Evolution XP: crafting category on successful craft
          accounts.gainArchetypeCategoryXp(key, 'crafting', 5);

          // --- Send success response with updated inventory ---
          var updatedInv = accounts.getMMOInventory(key);

          socket.emit('craft_result', {
            success: true,
            recipeId: recipeId,
            inventory: updatedInv,
            skillXp: { skill: craftSkillName, xp: craftXpAmount },
          });

          // Fire glossary trigger for first craft
          try {
            var craftTerms = knowledgeHandler.fireGlossaryTrigger(accounts, key, 'first_craft');
            for (var cti = 0; cti < craftTerms.length; cti++) {
              socket.emit('knowledge_term_unlocked', craftTerms[cti]);
            }
          } catch (e) { /* glossary trigger non-fatal */ }

          // --- Track daily challenge & achievement progress for crafting ---
          challengesHandler.trackChallengeProgress(accounts, key, 'craft', 1);
          challengesHandler.trackAchievementProgress(accounts, key, 'craft', 1, socket);
          // If recipe requires cooking skill, also track as cook
          if (skillReqs.cooking && skillReqs.cooking > 0) {
            challengesHandler.trackChallengeProgress(accounts, key, 'cook', 1);
          }

          // --- Quest progress: craft-type quests ---
          try {
            var qAcc = accounts.loadAccount(key);
            if (qAcc && qAcc.questProgress && qAcc.questProgress.active) {
              var rpgData = require('../rpg-data');
              var qChanged = false;
              for (var qi = 0; qi < qAcc.questProgress.active.length; qi++) {
                var quest = qAcc.questProgress.active[qi];
                var tmpl = rpgData.WORLD_QUEST_TEMPLATES ? rpgData.WORLD_QUEST_TEMPLATES.find(function(t) { return t.questId === quest.questId; }) : null;
                if (tmpl && tmpl.type === 'craft' && tmpl.target.item === recipe.output.type) {
                  quest.progress = Math.min(quest.progress + 1, quest.targetCount);
                  qChanged = true;
                  socket.emit('quest_progress', { questId: quest.questId, progress: quest.progress, targetCount: quest.targetCount, complete: quest.progress >= quest.targetCount });
                }
              }
              if (qChanged) accounts.saveAccount(qAcc);
            }
          } catch (qErr) { /* quest progress error is non-fatal */ }
        } finally {
          craftLocks.delete(key);
        }
      } catch (err) {
        console.error('[craft_item] Error:', err.message);
        socket.emit('craft_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // repair_item: repair an equipped item at an anvil station
    // ------------------------------------------------------------------
    socket.on('repair_item', function(data) {
      try {
        if (!data || typeof data.slot !== 'string') {
          socket.emit('repair_error', { message: 'Invalid request' });
          return;
        }

        var key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('repair_error', { message: 'No account found' });
          return;
        }

        // Require anvil proximity
        var nearStation = isNearStation(state, socket.id, 'anvil');
        if (!nearStation) {
          // Also check for forge (some servers may use forge as general station)
          nearStation = isNearStation(state, socket.id, 'forge');
          if (!nearStation) {
            socket.emit('repair_error', { message: 'You must be near an anvil or forge to repair items' });
            return;
          }
        }

        // Ownership gating: cannot use another player's station on their plot
        if (nearStation.ownerKey) {
          var repairZone = state.zones.get(state.playerZones.get(socket.id));
          if (repairZone && repairZone.type === 'plot' && repairZone.ownerKey !== key && nearStation.ownerKey !== key) {
            socket.emit('repair_error', { message: "You cannot use another player's crafting station" });
            return;
          }
        }

        // Gather card effects for cost reduction
        var cardEffects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(key) : [];

        var result = accounts.repairEquipmentSlot(key, data.slot, cardEffects);
        if (result.error) {
          socket.emit('repair_error', { message: result.error });
          return;
        }

        // Award crafting XP for the repair
        var xpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : undefined;
        var xpResult = accounts.addSkillXp(key, 'crafting', result.xpAwarded, xpRate);

        var updatedInv = accounts.getMMOInventory(key);
        var durabilityInfo = accounts.getEquipmentDurability(key);

        socket.emit('repair_result', {
          success: true,
          slot: result.slot,
          itemName: result.itemName,
          cost: result.cost,
          durabilityRestored: result.durabilityRestored,
          xpAwarded: result.xpAwarded,
          inventory: updatedInv,
          durability: durabilityInfo,
          skillLevel: xpResult ? xpResult.level : 1,
          skillXp: xpResult ? xpResult.xp : 0,
          xpNeeded: xpResult ? xpResult.xpNeeded : 100,
          leveledUp: xpResult ? xpResult.leveledUp : false,
        });

        // --- Track daily challenge progress for repair ---
        challengesHandler.trackChallengeProgress(accounts, key, 'repair', 1);
      } catch (err) {
        console.error('[repair_item] Error:', err.message);
        socket.emit('repair_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // emergency_repair: field repair using Emergency Patch card ability
    // ------------------------------------------------------------------
    socket.on('emergency_repair', function(data) {
      try {
        if (!data || typeof data.slot !== 'string') {
          socket.emit('repair_error', { message: 'Invalid request' });
          return;
        }

        var key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('repair_error', { message: 'No account found' });
          return;
        }

        // Check if player has the Emergency Patch card equipped
        var cardEffects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(key) : [];
        var fieldRepairEffect = null;
        for (var ci = 0; ci < cardEffects.length; ci++) {
          if (cardEffects[ci].type === 'field_repair') {
            fieldRepairEffect = cardEffects[ci];
            break;
          }
        }
        if (!fieldRepairEffect) {
          socket.emit('repair_error', { message: 'You need the Emergency Patch card equipped to use field repair' });
          return;
        }

        // Check cooldown (stored on account)
        var acc = accounts.loadAccount(key);
        if (!acc) {
          socket.emit('repair_error', { message: 'Account not found' });
          return;
        }
        var now = Date.now();
        var cooldownMs = (fieldRepairEffect.cooldown || 600) * 1000;
        if (acc.lastFieldRepair && (now - acc.lastFieldRepair) < cooldownMs) {
          var remainingSec = Math.ceil((cooldownMs - (now - acc.lastFieldRepair)) / 1000);
          socket.emit('repair_error', { message: 'Emergency Patch on cooldown (' + remainingSec + 's remaining)' });
          return;
        }

        // Find the item in the slot
        if (!acc.equipment) {
          socket.emit('repair_error', { message: 'No equipment' });
          return;
        }
        var slot = data.slot;
        if (accounts.EQUIPMENT_SLOTS.indexOf(slot) === -1) {
          socket.emit('repair_error', { message: 'Invalid slot' });
          return;
        }
        var itemId = acc.equipment[slot];
        if (!itemId) {
          socket.emit('repair_error', { message: 'Nothing equipped in that slot' });
          return;
        }
        if (!acc.mmoInventory || !acc.mmoInventory.items) {
          socket.emit('repair_error', { message: 'Inventory error' });
          return;
        }
        var item = null;
        for (var ii = 0; ii < acc.mmoInventory.items.length; ii++) {
          if (acc.mmoInventory.items[ii].id === itemId) { item = acc.mmoInventory.items[ii]; break; }
        }
        if (!item) {
          socket.emit('repair_error', { message: 'Item not found' });
          return;
        }

        accounts.ensureItemDurability(item);
        if (item.durability >= item.maxDurability) {
          socket.emit('repair_error', { message: 'Item is already at full durability' });
          return;
        }

        // Repair 10% of max durability
        var repairAmount = Math.max(1, Math.round(item.maxDurability * (fieldRepairEffect.percent || 0.10)));
        item.durability = Math.min(item.maxDurability, item.durability + repairAmount);
        acc.lastFieldRepair = now;
        accounts.saveAccount(acc);

        var durabilityInfo = accounts.getEquipmentDurability(key);

        socket.emit('repair_result', {
          success: true,
          slot: slot,
          itemName: item.name || item.type,
          durabilityRestored: repairAmount,
          fieldRepair: true,
          durability: durabilityInfo,
        });
      } catch (err) {
        console.error('[emergency_repair] Error:', err.message);
        socket.emit('repair_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // get_durability: request current durability info for all equipment
    // ------------------------------------------------------------------
    socket.on('get_durability', function() {
      try {
        var key = socketAccountMap.get(socket.id);
        if (!key) return;
        var durabilityInfo = accounts.getEquipmentDurability(key);
        socket.emit('durability_info', { durability: durabilityInfo });
      } catch (err) {
        console.error('[get_durability] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // consume_food: player eats food for HP restore and optional buff
    // ------------------------------------------------------------------
    socket.on('consume_food', function(data) {
      try {
        // --- Input validation ---
        if (!data || typeof data.resourceType !== 'string') {
          socket.emit('food_error', { message: 'Invalid request' });
          return;
        }

        var resourceType = data.resourceType;
        var foodEffect = rpgData.FOOD_EFFECTS[resourceType];
        if (!foodEffect) {
          socket.emit('food_error', { message: 'That item cannot be consumed' });
          return;
        }

        var key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('food_error', { message: 'No account found' });
          return;
        }

        // --- Check player has at least 1 of this food ---
        var mmoInv = accounts.getMMOInventory(key);
        if (!mmoInv || (mmoInv[resourceType] || 0) < 1) {
          socket.emit('food_error', { message: 'You do not have any ' + resourceType.replace(/_/g, ' ') });
          return;
        }

        // --- Remove 1 of the resource ---
        var removeResult = accounts.removeResource(key, resourceType, 1);
        if (removeResult === null) {
          socket.emit('food_error', { message: 'Failed to consume ' + resourceType.replace(/_/g, ' ') });
          return;
        }

        // --- Calculate HP restored (apply cooking skill perks + card effects) ---
        var foodAccount = accounts.loadAccount(key);
        var foodBonuses = foodAccount ? rpgData.getCraftingSkillBonuses(foodAccount) : null;
        var hpRestored = foodEffect.hpRestore;
        if (foodBonuses && foodBonuses.foodHealMult > 1.0) {
          hpRestored = Math.round(hpRestored * foodBonuses.foodHealMult);
        }

        // Card effects for food/potion enhancement
        var foodCardEffects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(key) : [];
        var cardFoodHealBonus = 0;
        var cardFoodBuffDuration = 0;
        var cardFoodBuffPotency = 0;
        var cardPotionEffectiveness = 0;
        var cardPotionDurationBonus = 0;
        for (var fci = 0; fci < foodCardEffects.length; fci++) {
          var fce = foodCardEffects[fci];
          if (fce.type === 'food_heal_bonus') cardFoodHealBonus += (fce.value || 0);
          if (fce.type === 'food_buff_duration') cardFoodBuffDuration += (fce.value || 0);
          if (fce.type === 'food_buff_potency') cardFoodBuffPotency += (fce.value || 0);
          if (fce.type === 'potion_effectiveness' || fce.type === 'potion_potency_bonus') cardPotionEffectiveness += (fce.value || 0);
          if (fce.type === 'potion_duration_bonus') cardPotionDurationBonus += (fce.value || 0);
        }

        // Determine if this is a potion (starts with 'potion_' or 'elixir_')
        var isPotion = (resourceType.indexOf('potion_') === 0 || resourceType.indexOf('elixir_') === 0);

        // Apply card heal bonuses
        if (isPotion && cardPotionEffectiveness > 0) {
          hpRestored = Math.round(hpRestored * (1 + cardPotionEffectiveness));
        } else if (!isPotion && cardFoodHealBonus > 0) {
          hpRestored = Math.round(hpRestored * (1 + cardFoodHealBonus));
        }

        // --- Apply buff duration and potency multipliers ---
        var buff = null;
        if (foodEffect.buff) {
          buff = {
            stat: foodEffect.buff.stat,
            value: foodEffect.buff.value,
            duration: foodEffect.buff.duration,
          };
          // Skill perk buff duration
          if (foodBonuses && foodBonuses.foodBuffDurationMult > 1.0) {
            buff.duration = Math.round(buff.duration * foodBonuses.foodBuffDurationMult);
          }
          // Card buff duration (food or potion specific)
          if (isPotion && cardPotionDurationBonus > 0) {
            buff.duration = Math.round(buff.duration * (1 + cardPotionDurationBonus));
          } else if (!isPotion && cardFoodBuffDuration > 0) {
            buff.duration = Math.round(buff.duration * (1 + cardFoodBuffDuration));
          }
          // Card buff potency (food or potion specific)
          if (isPotion && cardPotionEffectiveness > 0) {
            buff.value = Math.round(buff.value * (1 + cardPotionEffectiveness));
          } else if (!isPotion && cardFoodBuffPotency > 0) {
            buff.value = Math.round(buff.value * (1 + cardFoodBuffPotency));
          }
        }

        // --- If player is in dungeon combat, apply healing to combat HP ---
        var dungeonCombat = null;
        try { dungeonCombat = require('../dungeon-combat'); } catch (e) { /* not available */ }
        var dungeonHealed = false;
        if (dungeonCombat && dungeonCombat.getCombatBySocketId) {
          var combat = dungeonCombat.getCombatBySocketId(socket.id);
          if (combat && typeof combat.hp === 'number' && typeof combat.maxHp === 'number') {
            combat.hp = Math.min(combat.maxHp, combat.hp + hpRestored);
            dungeonHealed = true;
          }
        }

        // --- Phantom Skill XP: Gourmand + Survival ---
        var foodXpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : undefined;
        // Gourmand: 15-30 XP per food consumed
        accounts.addSkillXp(key, 'gourmand', 15 + Math.floor(Math.random() * 16), foodXpRate);
        // Survival: 3 XP per food/potion consumption
        accounts.addSkillXp(key, 'survival', 3, foodXpRate);

        // --- Emit result ---
        var updatedInv = accounts.getMMOInventory(key);
        socket.emit('food_consumed', {
          resourceType: resourceType,
          hpRestored: hpRestored,
          buff: buff,
          dungeonHealed: dungeonHealed,
          inventory: updatedInv,
        });
      } catch (err) {
        console.error('[consume_food] Error:', err.message);
        socket.emit('food_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // consume_food_item: consume a procedural food item (by itemId)
    // ------------------------------------------------------------------
    socket.on('consume_food_item', function(data) {
      try {
        if (!data || typeof data.itemId !== 'string') {
          socket.emit('food_error', { message: 'Invalid request' });
          return;
        }

        var key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('food_error', { message: 'No account found' });
          return;
        }

        // Find the item in mmoInventory.items[]
        var mmoInv = accounts.getMMOInventory(key);
        if (!mmoInv || !mmoInv.items || !Array.isArray(mmoInv.items)) {
          socket.emit('food_error', { message: 'No inventory found' });
          return;
        }
        var itemIdx = -1;
        var foodItem = null;
        for (var fi = 0; fi < mmoInv.items.length; fi++) {
          if (mmoInv.items[fi] && mmoInv.items[fi].id === data.itemId) {
            itemIdx = fi;
            foodItem = mmoInv.items[fi];
            break;
          }
        }
        if (!foodItem || !foodItem.isConsumable) {
          socket.emit('food_error', { message: 'Item not found or not consumable' });
          return;
        }

        // Look up base food effect
        var baseFoodType = foodItem.type;
        var foodEffect = rpgData.FOOD_EFFECTS[baseFoodType];
        if (!foodEffect) {
          socket.emit('food_error', { message: 'No food effect for this item' });
          return;
        }

        // Quality multiplier
        var qualityMult = foodItem.qualityMult || 1.0;

        // Calculate HP restored
        var hpRestored = Math.round(foodEffect.hpRestore * qualityMult);

        // Apply prefix effects
        var prefixEffects = foodItem.prefixEffects || {};
        if (prefixEffects.hpRestoreMult) {
          hpRestored = Math.round(hpRestored * prefixEffects.hpRestoreMult);
        }

        // Build buff
        var buff = null;
        if (foodEffect.buff) {
          buff = {
            stat: foodEffect.buff.stat,
            value: Math.round(foodEffect.buff.value * qualityMult),
            duration: Math.round(foodEffect.buff.duration * qualityMult),
          };
          if (prefixEffects.buffDurationMult) {
            buff.duration = Math.round(buff.duration * prefixEffects.buffDurationMult);
          }
          if (prefixEffects.statBuff) {
            buff.value += prefixEffects.statBuff;
          }
        }

        // Extra buffs from prefix
        var extraBuffs = [];
        if (prefixEffects.hpRegen && prefixEffects.regenDuration) {
          extraBuffs.push({ type: 'hpRegen', value: prefixEffects.hpRegen, duration: prefixEffects.regenDuration });
        }
        if (prefixEffects.defBuff && prefixEffects.buffDuration) {
          extraBuffs.push({ type: 'defBuff', value: prefixEffects.defBuff, duration: prefixEffects.buffDuration });
        }
        if (prefixEffects.speedBuff && prefixEffects.buffDuration) {
          extraBuffs.push({ type: 'speedBuff', value: prefixEffects.speedBuff, duration: prefixEffects.buffDuration });
        }

        // Suffix effects
        var suffixEffects = foodItem.suffixEffects || {};

        // Remove item from inventory
        mmoInv.items.splice(itemIdx, 1);
        accounts.saveAccount(accounts.loadAccount(key));

        // Dungeon healing
        var dungeonCombat = null;
        try { dungeonCombat = require('../dungeon-combat'); } catch (e) { /* not available */ }
        var dungeonHealed = false;
        if (dungeonCombat && dungeonCombat.getCombatBySocketId) {
          var combat = dungeonCombat.getCombatBySocketId(socket.id);
          if (combat && typeof combat.hp === 'number' && typeof combat.maxHp === 'number') {
            combat.hp = Math.min(combat.maxHp, combat.hp + hpRestored);
            dungeonHealed = true;
          }
        }

        // Phantom skill XP
        var foodXpRate2 = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : undefined;
        accounts.addSkillXp(key, 'gourmand', 15 + Math.floor(Math.random() * 16), foodXpRate2);
        accounts.addSkillXp(key, 'survival', 3, foodXpRate2);

        socket.emit('food_consumed', {
          itemId: data.itemId,
          resourceType: baseFoodType,
          hpRestored: hpRestored,
          buff: buff,
          extraBuffs: extraBuffs,
          suffixEffects: suffixEffects,
          quality: foodItem.quality,
          qualityMult: qualityMult,
          dungeonHealed: dungeonHealed,
          inventory: accounts.getMMOInventory(key),
        });
      } catch (err) {
        console.error('[consume_food_item] Error:', err.message);
        socket.emit('food_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // gem_socket_item: socket a gem into an equipment item
    // ------------------------------------------------------------------
    socket.on('gem_socket_item', function(data) {
      try {
        if (!data || typeof data.itemId !== 'string' || typeof data.gemType !== 'string') {
          socket.emit('craft_error', { message: 'Invalid request' });
          return;
        }
        var key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('craft_error', { message: 'No account found' }); return; }

        // Require jeweler's bench proximity
        if (!isNearStation(state, socket.id, 'jewelers_bench')) {
          socket.emit('craft_error', { message: 'Must be near a jeweler\'s bench to socket gems' });
          return;
        }

        var acc = accounts.loadAccount(key);
        if (!acc || !acc.mmoInventory || !acc.mmoInventory.items) {
          socket.emit('craft_error', { message: 'Inventory not found' }); return;
        }

        // Find the target item
        var item = null;
        for (var i = 0; i < acc.mmoInventory.items.length; i++) {
          if (acc.mmoInventory.items[i].id === data.itemId) { item = acc.mmoInventory.items[i]; break; }
        }
        if (!item) { socket.emit('craft_error', { message: 'Item not found' }); return; }

        // Check player has the gem resource
        var mmoInv = acc.mmoInventory;
        if (!mmoInv[data.gemType] || mmoInv[data.gemType] < 1) {
          socket.emit('craft_error', { message: 'You don\'t have that gem' }); return;
        }

        // Apply the gem
        var result = lootGen.socketGem(item, data.gemType);
        if (result.error) { socket.emit('craft_error', { message: result.error }); return; }

        // Deduct the gem resource
        accounts.removeResource(key, data.gemType, 1);

        // Save
        accounts.saveAccount(acc);

        // Award jewelcrafting XP
        accounts.addSkillXp(key, 'jewelcrafting', 20);

        var updatedInv = accounts.getMMOInventory(key);
        socket.emit('gem_socket_result', {
          success: true,
          itemId: data.itemId,
          gemType: data.gemType,
          item: item,
          inventory: updatedInv,
        });
      } catch (err) {
        console.error('[gem_socket_item] Error:', err.message);
        socket.emit('craft_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // apply_augment: apply an augment to an equipment item
    // ------------------------------------------------------------------
    socket.on('apply_augment', function(data) {
      try {
        if (!data || typeof data.itemId !== 'string' || typeof data.augmentType !== 'string') {
          socket.emit('craft_error', { message: 'Invalid request' });
          return;
        }
        var key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('craft_error', { message: 'No account found' }); return; }

        // Require anvil or enchanting table proximity
        if (!isNearStation(state, socket.id, 'anvil') && !isNearStation(state, socket.id, 'enchanting_table')) {
          socket.emit('craft_error', { message: 'Must be near an anvil or enchanting table' });
          return;
        }

        var acc = accounts.loadAccount(key);
        if (!acc || !acc.mmoInventory || !acc.mmoInventory.items) {
          socket.emit('craft_error', { message: 'Inventory not found' }); return;
        }

        // Find the target item
        var item = null;
        for (var i = 0; i < acc.mmoInventory.items.length; i++) {
          if (acc.mmoInventory.items[i].id === data.itemId) { item = acc.mmoInventory.items[i]; break; }
        }
        if (!item) { socket.emit('craft_error', { message: 'Item not found' }); return; }

        // Check player has the augment resource
        var mmoInv = acc.mmoInventory;
        if (!mmoInv[data.augmentType] || mmoInv[data.augmentType] < 1) {
          socket.emit('craft_error', { message: 'You don\'t have that augment' }); return;
        }

        // Skill check for augment
        var augDef = lootGen.AUGMENT_TYPES[data.augmentType];
        if (augDef && augDef.requiredSkill) {
          var accSkills = acc.skills || {};
          for (var sk in augDef.requiredSkill) {
            var playerLevel = (accSkills[sk] && accSkills[sk].level) ? accSkills[sk].level : 1;
            if (playerLevel < augDef.requiredSkill[sk]) {
              socket.emit('craft_error', { message: 'Requires ' + sk + ' level ' + augDef.requiredSkill[sk] });
              return;
            }
          }
        }

        // Apply the augment
        var result = lootGen.applyAugment(item, data.augmentType);
        if (result.error) { socket.emit('craft_error', { message: result.error }); return; }

        // Deduct the augment resource
        accounts.removeResource(key, data.augmentType, 1);

        // Save
        accounts.saveAccount(acc);

        // Award XP to the relevant skill
        var xpSkill = 'crafting';
        if (augDef && augDef.requiredSkill) {
          var skills = Object.keys(augDef.requiredSkill);
          if (skills.length > 0) xpSkill = skills[0];
        }
        accounts.addSkillXp(key, xpSkill, 30);

        var updatedInv = accounts.getMMOInventory(key);
        socket.emit('augment_result', {
          success: true,
          itemId: data.itemId,
          augmentType: data.augmentType,
          item: item,
          inventory: updatedInv,
        });
      } catch (err) {
        console.error('[apply_augment] Error:', err.message);
        socket.emit('craft_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // imbue_ring: double a ring's stats at resource cost
    // ------------------------------------------------------------------
    socket.on('imbue_ring', function(data) {
      try {
        if (!data || typeof data.itemId !== 'string') {
          socket.emit('craft_error', { message: 'Invalid request' });
          return;
        }
        var key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('craft_error', { message: 'No account found' }); return; }

        // Require jeweler's bench
        if (!isNearStation(state, socket.id, 'jewelers_bench')) {
          socket.emit('craft_error', { message: 'Must be near a jeweler\'s bench to imbue rings' });
          return;
        }

        var acc = accounts.loadAccount(key);
        if (!acc || !acc.mmoInventory || !acc.mmoInventory.items) {
          socket.emit('craft_error', { message: 'Inventory not found' }); return;
        }

        // Find the ring item
        var item = null;
        for (var i = 0; i < acc.mmoInventory.items.length; i++) {
          if (acc.mmoInventory.items[i].id === data.itemId) { item = acc.mmoInventory.items[i]; break; }
        }
        if (!item) { socket.emit('craft_error', { message: 'Item not found' }); return; }

        // Check imbue cost
        var imbueCost = lootGen.RING_IMBUE_COSTS[item.rarity];
        if (!imbueCost) { socket.emit('craft_error', { message: 'This ring cannot be imbued' }); return; }

        // Check resources
        var mmoInv = acc.mmoInventory;
        if (!mmoInv[imbueCost.resource] || mmoInv[imbueCost.resource] < imbueCost.amount) {
          socket.emit('craft_error', {
            message: 'Need ' + imbueCost.amount + ' ' + imbueCost.resource.replace(/_/g, ' '),
          });
          return;
        }

        // Apply imbue
        var result = lootGen.imbueRing(item);
        if (result.error) { socket.emit('craft_error', { message: result.error }); return; }

        // Deduct resources
        accounts.removeResource(key, imbueCost.resource, imbueCost.amount);

        // Save
        accounts.saveAccount(acc);

        // Award XP
        accounts.addSkillXp(key, 'jewelcrafting', 40);

        var updatedInv = accounts.getMMOInventory(key);
        socket.emit('imbue_result', {
          success: true,
          itemId: data.itemId,
          item: item,
          inventory: updatedInv,
        });
      } catch (err) {
        console.error('[imbue_ring] Error:', err.message);
        socket.emit('craft_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // inscribe_scroll: convert scroll resource into reusable inscription
    // ------------------------------------------------------------------
    socket.on('inscribe_scroll', function(data) {
      try {
        if (!data || typeof data.scrollType !== 'string') {
          socket.emit('craft_error', { message: 'Invalid request' });
          return;
        }
        var key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('craft_error', { message: 'No account found' }); return; }

        // Require enchanting table
        if (!isNearStation(state, socket.id, 'enchanting_table')) {
          socket.emit('craft_error', { message: 'Must be near an enchanting table' });
          return;
        }

        var acc = accounts.loadAccount(key);
        if (!acc) { socket.emit('craft_error', { message: 'Account not found' }); return; }

        // Check player has the scroll
        var mmoInv = acc.mmoInventory;
        if (!mmoInv || !mmoInv[data.scrollType] || mmoInv[data.scrollType] < 1) {
          socket.emit('craft_error', { message: 'You don\'t have that scroll' }); return;
        }

        // Get inscription data
        var inscriptionDef = lootGen.getInscriptionData(data.scrollType, 0);
        if (!inscriptionDef) { socket.emit('craft_error', { message: 'Invalid scroll type' }); return; }

        // Check if player already has this inscription
        if (!acc.inscriptions) acc.inscriptions = {};
        if (acc.inscriptions[data.scrollType]) {
          // Upgrade existing inscription
          var current = acc.inscriptions[data.scrollType];
          if (current.upgradeLevel >= (inscriptionDef.maxUpgrades || 3)) {
            socket.emit('craft_error', { message: 'Inscription already at max level' }); return;
          }
          current.upgradeLevel += 1;
          // Consume additional scrolls for upgrade (1 + upgradeLevel)
          var upgradeCost = 1 + current.upgradeLevel;
          if (mmoInv[data.scrollType] < upgradeCost) {
            socket.emit('craft_error', { message: 'Need ' + upgradeCost + ' scrolls to upgrade' }); return;
          }
          accounts.removeResource(key, data.scrollType, upgradeCost);
        } else {
          // New inscription
          acc.inscriptions[data.scrollType] = {
            scrollType: data.scrollType,
            upgradeLevel: 0,
            lastUsed: 0,
          };
          accounts.removeResource(key, data.scrollType, 1);
        }

        accounts.saveAccount(acc);

        // Award enchanting XP
        accounts.addSkillXp(key, 'enchanting', 25);

        var updatedInv = accounts.getMMOInventory(key);
        var updatedInscription = lootGen.getInscriptionData(data.scrollType, acc.inscriptions[data.scrollType].upgradeLevel);
        socket.emit('inscribe_result', {
          success: true,
          scrollType: data.scrollType,
          inscription: updatedInscription,
          inscriptions: acc.inscriptions,
          inventory: updatedInv,
        });
      } catch (err) {
        console.error('[inscribe_scroll] Error:', err.message);
        socket.emit('craft_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // craft_minigame_result: complete a quality crafting minigame
    // ------------------------------------------------------------------
    socket.on('craft_minigame_result', function(data) {
      try {
        var pending = pendingMinigames.get(socket.id);
        if (!pending) {
          socket.emit('craft_error', { message: 'No active minigame.' });
          return;
        }
        pendingMinigames.delete(socket.id);
        if (Date.now() > pending.expiresAt) {
          socket.emit('craft_error', { message: 'Minigame expired.' });
          return;
        }
        var pos = typeof data.clickPos === 'number' ? data.clickPos : 500;
        var quality;
        if (pos >= pending.windowStart && pos <= pending.windowEnd) {
          // Hit the window -- determine quality by how centered
          var center = (pending.windowStart + pending.windowEnd) / 2;
          var dist = Math.abs(pos - center);
          var halfWindow = (pending.windowEnd - pending.windowStart) / 2;
          if (halfWindow > 0 && dist < halfWindow * 0.2) quality = 'masterwork';
          else if (halfWindow > 0 && dist < halfWindow * 0.5) quality = 'excellent';
          else quality = 'good';
        } else {
          quality = 'poor';
        }
        // Complete craft with quality
        var recipe = RECIPES[pending.recipeId];
        if (!recipe) return;
        var qualityTier = QUALITY_TIERS[quality] || QUALITY_TIERS.normal;
        var output = {
          type: recipe.output.type,
          name: qualityTier.name + ' ' + recipe.output.name,
          quality: quality,
          qualityMultiplier: qualityTier.multiplier,
        };
        if (recipe.output.quantity) output.quantity = recipe.output.quantity;
        // Add to inventory
        var key = pending.account_key;
        var account = accounts.loadAccount(key);
        if (!account) return;
        var inv = account.mmoInventory || {};
        if (!inv.items) inv.items = [];
        inv.items.push(output);
        account.mmoInventory = inv;
        accounts.saveAccount(account);
        socket.emit('craft_result', {
          success: true,
          recipeId: pending.recipeId,
          item: output,
          quality: quality,
          inventory: account.mmoInventory,
        });
      } catch (err) {
        console.error('[craft_minigame_result] Error:', err.message);
        socket.emit('craft_error', { message: 'Internal server error' });
      }
    });
  },
};
