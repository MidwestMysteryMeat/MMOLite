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

  // ===== CONTAINER EQUIPMENT (backpacks & rigs) =====
  leather_satchel: {
    station: 'none',
    cost: { wood: 5 },
    output: { type: 'leather_satchel', name: 'Leather Satchel' },
    skillReq: { crafting: 2 },
  },
  belt_pouch: {
    station: 'none',
    cost: { wood: 3 },
    output: { type: 'belt_pouch', name: 'Belt Pouch' },
    skillReq: { crafting: 1 },
  },
  adventurer_pack: {
    station: 'anvil',
    cost: { iron_bar: 6, wood: 10 },
    output: { type: 'adventurer_pack', name: "Adventurer's Pack" },
    skillReq: { crafting: 8 },
  },
  utility_vest: {
    station: 'anvil',
    cost: { iron_bar: 4, wood: 6 },
    output: { type: 'utility_vest', name: 'Utility Vest' },
    skillReq: { crafting: 6 },
  },
  explorer_backpack: {
    station: 'anvil',
    cost: { steel_bar: 8, wood: 12 },
    output: { type: 'explorer_backpack', name: 'Explorer Backpack' },
    skillReq: { crafting: 15 },
  },
  tactical_rig: {
    station: 'anvil',
    cost: { steel_bar: 5, iron_bar: 5 },
    output: { type: 'tactical_rig', name: 'Tactical Rig' },
    skillReq: { crafting: 12 },
  },
  mithril_frame: {
    station: 'anvil',
    cost: { mithril_bar: 10, steel_bar: 5, wood: 8 },
    output: { type: 'mithril_frame', name: 'Mithril Frame Pack' },
    skillReq: { crafting: 25 },
  },
};

module.exports = { RECIPES };
