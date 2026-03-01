// Equipment static data — weapon types, durability tables, dual-wield combos.
// Extracted from accounts.js to reduce file size.  No dependencies on accounts.js.

// Valid equipment slots: tools (axe, pickaxe) + combat gear (main_hand, off_hand, head, chest, undershirt, arms, hands, legs, feet, ring1-6, necklace)
var EQUIPMENT_SLOTS = ['axe', 'pickaxe', 'main_hand', 'off_hand', 'head', 'chest', 'undershirt', 'arms', 'hands', 'legs', 'feet', 'ring1', 'ring2', 'ring3', 'ring4', 'ring5', 'ring6', 'necklace', 'backpack', 'rig'];

// Valid tool types for axe/pickaxe equipment slots (all tiers)
var VALID_AXES = { iron_axe:1, copper_axe:1, bronze_axe:1, steel_axe:1, mithril_axe:1 };
var VALID_PICKAXES = { iron_pickaxe:1, copper_pickaxe:1, bronze_pickaxe:1, steel_pickaxe:1, mithril_pickaxe:1 };

// Combat skill required for each weapon category
var COMBAT_SKILL_FOR_CATEGORY = {
  melee_blade: 'melee',
  melee_blunt: 'melee',
  archery:     'archery',
  magic:       'magic',
};

// Combat skill level required by rarity tier (higher tier = higher skill needed)
var RARITY_COMBAT_LEVEL = {
  common:     0,   // wooden/copper — anyone can equip
  uncommon:   3,   // bronze/iron
  rare:       8,   // silver/gold
  ultra_rare: 14,  // mithril
};

// Weapon types and which slot they go in
var WEAPON_TYPES = {
  // ===== STARTER WOODEN WEAPONS (no skill requirement) =====
  wooden_sword:  { slot: 'weapon', category: 'melee_blade', damage: 2, speed: 1.0, handedness: '1h', name: 'Wooden Sword',  rarity: 'common', icon: 'weapons/Sword_0.PNG' },
  wooden_dagger: { slot: 'weapon', category: 'melee_blade', damage: 1, speed: 1.4, critBonus: 0.02, handedness: '1h', name: 'Wooden Dagger', rarity: 'common', icon: 'weapons/Dagger_02.PNG' },
  wooden_mace:   { slot: 'weapon', category: 'melee_blunt', damage: 2, speed: 0.9, handedness: '1h', name: 'Wooden Mace',   rarity: 'common', icon: 'weapons/Hammer_02.PNG' },
  wooden_spear:  { slot: 'weapon', category: 'melee_blade', damage: 3, speed: 1.0, range: 2, handedness: '2h', name: 'Wooden Spear', rarity: 'common', icon: 'weapons/Spear_02.PNG' },

  // ===== SWORDS (melee_blade, balanced damage/speed) =====
  copper_sword:   { slot: 'weapon', category: 'melee_blade', damage: 4,  speed: 1.0, handedness: '1h', name: 'Copper Sword',   rarity: 'common',    icon: 'weapons/Sword_01.PNG' },
  bronze_sword:   { slot: 'weapon', category: 'melee_blade', damage: 6,  speed: 1.0, handedness: '1h', name: 'Bronze Sword',   rarity: 'common',    icon: 'weapons/Sword_10.PNG' },
  iron_sword:     { slot: 'weapon', category: 'melee_blade', damage: 8,  speed: 1.0, handedness: '1h', name: 'Iron Sword',     rarity: 'uncommon',  icon: 'weapons/Sword_05.PNG' },
  steel_sword:    { slot: 'weapon', category: 'melee_blade', damage: 12, speed: 1.0, handedness: '1h', name: 'Steel Sword',    rarity: 'uncommon',  icon: 'weapons/Sword_15.PNG' },
  silver_sword:   { slot: 'weapon', category: 'melee_blade', damage: 14, speed: 1.05, handedness: '1h', name: 'Silver Sword',  rarity: 'rare',      icon: 'weapons/Sword_30.PNG' },
  gold_sword:     { slot: 'weapon', category: 'melee_blade', damage: 16, speed: 1.0, handedness: '1h', name: 'Gold Sword',     rarity: 'rare',      icon: 'weapons/Sword_40.PNG' },
  mithril_sword:  { slot: 'weapon', category: 'melee_blade', damage: 22, speed: 1.1, handedness: '1h', name: 'Mithril Sword',  rarity: 'ultra_rare', icon: 'weapons/Sword_25.PNG' },

  // ===== BATTLE AXES (melee_blade, high damage, slow) =====
  copper_axe_weapon:  { slot: 'weapon', category: 'melee_blade', damage: 5,  speed: 0.8, handedness: '2h', name: 'Copper Battle Axe',  rarity: 'common',    icon: 'weapons/Axe_01.PNG' },
  bronze_axe_weapon:  { slot: 'weapon', category: 'melee_blade', damage: 8,  speed: 0.8, handedness: '2h', name: 'Bronze Battle Axe',  rarity: 'common',    icon: 'weapons/Axe_05.PNG' },
  iron_axe_weapon:    { slot: 'weapon', category: 'melee_blade', damage: 10, speed: 0.8, handedness: '2h', name: 'Iron Battle Axe',    rarity: 'uncommon',  icon: 'weapons/Axe_10.PNG' },
  steel_axe_weapon:   { slot: 'weapon', category: 'melee_blade', damage: 14, speed: 0.8, handedness: '2h', name: 'Steel Battle Axe',   rarity: 'uncommon',  icon: 'weapons/Axe_15.PNG' },
  silver_axe_weapon:  { slot: 'weapon', category: 'melee_blade', damage: 17, speed: 0.85, handedness: '2h', name: 'Silver Battle Axe', rarity: 'rare',      icon: 'weapons/Axe_20.PNG' },
  gold_axe_weapon:    { slot: 'weapon', category: 'melee_blade', damage: 20, speed: 0.8, handedness: '2h', name: 'Gold Battle Axe',    rarity: 'rare',      icon: 'weapons/Axe_30.PNG' },
  mithril_axe_weapon: { slot: 'weapon', category: 'melee_blade', damage: 28, speed: 0.9, handedness: '2h', name: 'Mithril Battle Axe', rarity: 'ultra_rare', icon: 'weapons/Axe_40.PNG' },

  // ===== MACES/HAMMERS (melee_blunt, good vs armor) =====
  copper_mace:   { slot: 'weapon', category: 'melee_blunt', damage: 4,  speed: 0.9, handedness: '1h', name: 'Copper Mace',   rarity: 'common',    icon: 'weapons/Hammer_01.PNG' },
  bronze_mace:   { slot: 'weapon', category: 'melee_blunt', damage: 7,  speed: 0.9, handedness: '1h', name: 'Bronze Mace',   rarity: 'common',    icon: 'weapons/Hammer_05.PNG' },
  iron_mace:     { slot: 'weapon', category: 'melee_blunt', damage: 9,  speed: 0.9, handedness: '1h', name: 'Iron Mace',     rarity: 'uncommon',  icon: 'weapons/Hammer_10.PNG' },
  steel_mace:    { slot: 'weapon', category: 'melee_blunt', damage: 13, speed: 0.9, handedness: '1h', name: 'Steel Mace',    rarity: 'uncommon',  icon: 'weapons/Hammer_15.PNG' },
  silver_mace:   { slot: 'weapon', category: 'melee_blunt', damage: 15, speed: 0.9, handedness: '1h', name: 'Silver Mace',   rarity: 'rare',      icon: 'weapons/Hammer_20.PNG' },
  gold_mace:     { slot: 'weapon', category: 'melee_blunt', damage: 18, speed: 0.9, handedness: '1h', name: 'Gold Mace',     rarity: 'rare',      icon: 'weapons/Hammer_30.PNG' },
  mithril_mace:  { slot: 'weapon', category: 'melee_blunt', damage: 24, speed: 0.95, handedness: '1h', name: 'Mithril Mace', rarity: 'ultra_rare', icon: 'weapons/Hammer_45.PNG' },

  // ===== DAGGERS (melee_blade, fast, crit bonus) =====
  copper_dagger:  { slot: 'weapon', category: 'melee_blade', damage: 2,  speed: 1.4, critBonus: 0.03, handedness: '1h', name: 'Copper Dagger',  rarity: 'common',    icon: 'weapons/Dagger_01.PNG' },
  bronze_dagger:  { slot: 'weapon', category: 'melee_blade', damage: 3,  speed: 1.4, critBonus: 0.04, handedness: '1h', name: 'Bronze Dagger',  rarity: 'common',    icon: 'weapons/Dagger_05.PNG' },
  iron_dagger:    { slot: 'weapon', category: 'melee_blade', damage: 5,  speed: 1.4, critBonus: 0.05, handedness: '1h', name: 'Iron Dagger',    rarity: 'uncommon',  icon: 'weapons/Dagger_10.PNG' },
  steel_dagger:   { slot: 'weapon', category: 'melee_blade', damage: 7,  speed: 1.4, critBonus: 0.06, handedness: '1h', name: 'Steel Dagger',   rarity: 'uncommon',  icon: 'weapons/Dagger_15.PNG' },
  silver_dagger:  { slot: 'weapon', category: 'melee_blade', damage: 9,  speed: 1.5, critBonus: 0.08, handedness: '1h', name: 'Silver Dagger',  rarity: 'rare',      icon: 'weapons/Dagger_30.PNG' },
  gold_dagger:    { slot: 'weapon', category: 'melee_blade', damage: 11, speed: 1.4, critBonus: 0.08, handedness: '1h', name: 'Gold Dagger',    rarity: 'rare',      icon: 'weapons/Dagger_40.PNG' },
  mithril_dagger: { slot: 'weapon', category: 'melee_blade', damage: 15, speed: 1.5, critBonus: 0.10, handedness: '1h', name: 'Mithril Dagger', rarity: 'ultra_rare', icon: 'weapons/Dagger_45.PNG' },

  // ===== SPEARS (melee_blade, range 2, moderate damage) =====
  copper_spear:  { slot: 'weapon', category: 'melee_blade', damage: 5,  speed: 1.0, range: 2, handedness: '2h', name: 'Copper Spear',  rarity: 'common',    icon: 'weapons/Spear_01.PNG' },
  bronze_spear:  { slot: 'weapon', category: 'melee_blade', damage: 7,  speed: 1.0, range: 2, handedness: '2h', name: 'Bronze Spear',  rarity: 'common',    icon: 'weapons/Spear_05.PNG' },
  iron_spear:    { slot: 'weapon', category: 'melee_blade', damage: 9,  speed: 1.0, range: 2, handedness: '2h', name: 'Iron Spear',    rarity: 'uncommon',  icon: 'weapons/Spear_10.PNG' },
  steel_spear:   { slot: 'weapon', category: 'melee_blade', damage: 13, speed: 1.0, range: 2, handedness: '2h', name: 'Steel Spear',   rarity: 'uncommon',  icon: 'weapons/Spear_15.PNG' },
  silver_spear:  { slot: 'weapon', category: 'melee_blade', damage: 15, speed: 1.05, range: 2, handedness: '2h', name: 'Silver Spear', rarity: 'rare',      icon: 'weapons/Spear_20.PNG' },
  gold_spear:    { slot: 'weapon', category: 'melee_blade', damage: 18, speed: 1.0, range: 2, handedness: '2h', name: 'Gold Spear',    rarity: 'rare',      icon: 'weapons/Spear_30.PNG' },
  mithril_spear: { slot: 'weapon', category: 'melee_blade', damage: 24, speed: 1.1, range: 2, handedness: '2h', name: 'Mithril Spear', rarity: 'ultra_rare', icon: 'weapons/Spear_35.PNG' },

  // ===== BOWS (archery, ranged) =====
  wooden_bow:    { slot: 'weapon', category: 'archery', damage: 7,  speed: 1.1, range: 4, handedness: '2h', name: 'Wooden Bow',    rarity: 'common',    icon: 'weapons/Bow_01.PNG' },
  copper_bow:    { slot: 'weapon', category: 'archery', damage: 9,  speed: 1.1, range: 4, handedness: '2h', name: 'Copper Bow',    rarity: 'common',    icon: 'weapons/Bow_05.PNG' },
  bronze_bow:    { slot: 'weapon', category: 'archery', damage: 11, speed: 1.1, range: 4, handedness: '2h', name: 'Bronze Bow',    rarity: 'uncommon',  icon: 'weapons/Bow_10.PNG' },
  iron_bow:      { slot: 'weapon', category: 'archery', damage: 13, speed: 1.1, range: 4, handedness: '2h', name: 'Iron Bow',      rarity: 'uncommon',  icon: 'weapons/Bow_15.PNG' },
  steel_bow:     { slot: 'weapon', category: 'archery', damage: 16, speed: 1.1, range: 5, handedness: '2h', name: 'Steel Bow',     rarity: 'rare',      icon: 'weapons/Bow_20.PNG' },
  silver_bow:    { slot: 'weapon', category: 'archery', damage: 18, speed: 1.15, range: 5, handedness: '2h', name: 'Silver Bow',   rarity: 'rare',      icon: 'weapons/Bow_25.PNG' },
  gold_bow:      { slot: 'weapon', category: 'archery', damage: 20, speed: 1.1, range: 5, handedness: '2h', name: 'Gold Bow',      rarity: 'rare',      icon: 'weapons/Bow_30.PNG' },
  mithril_bow:   { slot: 'weapon', category: 'archery', damage: 26, speed: 1.2, range: 6, handedness: '2h', name: 'Mithril Bow',   rarity: 'ultra_rare', icon: 'weapons/Bow_35.PNG' },

  // ===== CROSSBOWS (archery, slow but high damage) =====
  iron_crossbow:    { slot: 'weapon', category: 'archery', damage: 16, speed: 0.7, range: 5, handedness: '2h', name: 'Iron Crossbow',    rarity: 'uncommon',  icon: 'weapons/Crossbow_01.PNG' },
  steel_crossbow:   { slot: 'weapon', category: 'archery', damage: 22, speed: 0.7, range: 5, handedness: '2h', name: 'Steel Crossbow',   rarity: 'rare',      icon: 'weapons/Crossbow_05.PNG' },
  mithril_crossbow: { slot: 'weapon', category: 'archery', damage: 30, speed: 0.75, range: 6, handedness: '2h', name: 'Mithril Crossbow', rarity: 'ultra_rare', icon: 'weapons/Crossbow_10.PNG' },

  // ===== STAFFS (magic, magicDamage focus) =====
  wooden_staff:   { slot: 'weapon', category: 'magic', damage: 4,  speed: 1.0, magicDamage: 12, handedness: '2h', name: 'Wooden Staff',   rarity: 'common',    icon: 'weapons/staff_1.PNG' },
  copper_staff:   { slot: 'weapon', category: 'magic', damage: 5,  speed: 1.0, magicDamage: 16, handedness: '2h', name: 'Copper Staff',   rarity: 'common',    icon: 'weapons/staff_5.PNG' },
  bronze_staff:   { slot: 'weapon', category: 'magic', damage: 6,  speed: 1.0, magicDamage: 20, handedness: '2h', name: 'Bronze Staff',   rarity: 'uncommon',  icon: 'weapons/Staff_10.PNG' },
  iron_staff:     { slot: 'weapon', category: 'magic', damage: 7,  speed: 1.0, magicDamage: 24, handedness: '2h', name: 'Iron Staff',     rarity: 'uncommon',  icon: 'weapons/Staff_15.PNG' },
  silver_staff:   { slot: 'weapon', category: 'magic', damage: 8,  speed: 1.05, magicDamage: 30, handedness: '2h', name: 'Silver Staff',  rarity: 'rare',      icon: 'weapons/Staff_25.PNG' },
  gold_staff:     { slot: 'weapon', category: 'magic', damage: 10, speed: 1.0, magicDamage: 36, handedness: '2h', name: 'Gold Staff',     rarity: 'rare',      icon: 'weapons/Staff_30.PNG' },
  mithril_staff:  { slot: 'weapon', category: 'magic', damage: 12, speed: 1.1, magicDamage: 48, handedness: '2h', name: 'Mithril Staff',  rarity: 'ultra_rare', icon: 'weapons/Staff_45.PNG' },

  // ===== WANDS (magic, fast cast, moderate power) =====
  wooden_wand:    { slot: 'weapon', category: 'magic', damage: 2,  speed: 1.2, magicDamage: 8,  handedness: '1h', name: 'Wooden Wand',    rarity: 'common',    icon: 'weapons/Wand.PNG' },
  copper_wand:    { slot: 'weapon', category: 'magic', damage: 3,  speed: 1.2, magicDamage: 11, handedness: '1h', name: 'Copper Wand',    rarity: 'common',    icon: 'weapons/staff_2.PNG' },
  iron_wand:      { slot: 'weapon', category: 'magic', damage: 4,  speed: 1.2, magicDamage: 16, handedness: '1h', name: 'Iron Wand',      rarity: 'uncommon',  icon: 'weapons/staff_8.PNG' },
  silver_wand:    { slot: 'weapon', category: 'magic', damage: 5,  speed: 1.25, magicDamage: 22, handedness: '1h', name: 'Silver Wand',   rarity: 'rare',      icon: 'weapons/Staff_20.PNG' },
  gold_wand:      { slot: 'weapon', category: 'magic', damage: 6,  speed: 1.2, magicDamage: 28, handedness: '1h', name: 'Gold Wand',      rarity: 'rare',      icon: 'weapons/Staff_35.PNG' },
  mithril_wand:   { slot: 'weapon', category: 'magic', damage: 8,  speed: 1.3, magicDamage: 36, handedness: '1h', name: 'Mithril Wand',   rarity: 'ultra_rare', icon: 'weapons/Staff_40.PNG' },

  // ===== SCYTHES (melee_blade, high damage, slow, crit) =====
  iron_scythe:    { slot: 'weapon', category: 'melee_blade', damage: 12, speed: 0.7, critBonus: 0.05, handedness: '2h', name: 'Iron Scythe',    rarity: 'uncommon',  icon: 'weapons/Scythe_01.PNG' },
  steel_scythe:   { slot: 'weapon', category: 'melee_blade', damage: 18, speed: 0.7, critBonus: 0.06, handedness: '2h', name: 'Steel Scythe',   rarity: 'rare',      icon: 'weapons/Scythe_03.PNG' },
  mithril_scythe: { slot: 'weapon', category: 'melee_blade', damage: 26, speed: 0.75, critBonus: 0.08, handedness: '2h', name: 'Mithril Scythe', rarity: 'ultra_rare', icon: 'weapons/Scythe_07.PNG' },

  // ===== SHIELDS =====
  wooden_shield:   { slot: 'shield', defense: 5,  blockChance: 0.15, name: 'Wooden Shield',   rarity: 'common',    icon: 'weapons/shield_01.PNG' },
  copper_shield:   { slot: 'shield', defense: 7,  blockChance: 0.17, name: 'Copper Shield',   rarity: 'common',    icon: 'weapons/shield_05.PNG' },
  bronze_shield:   { slot: 'shield', defense: 9,  blockChance: 0.18, name: 'Bronze Shield',   rarity: 'common',    icon: 'weapons/shield_10.PNG' },
  iron_shield:     { slot: 'shield', defense: 10, blockChance: 0.20, name: 'Iron Shield',     rarity: 'uncommon',  icon: 'weapons/shield_15.PNG' },
  steel_shield:    { slot: 'shield', defense: 14, blockChance: 0.22, name: 'Steel Shield',    rarity: 'uncommon',  icon: 'weapons/shield_20.PNG' },
  silver_shield:   { slot: 'shield', defense: 16, blockChance: 0.24, name: 'Silver Shield',   rarity: 'rare',      icon: 'weapons/shield_25.PNG' },
  gold_shield:     { slot: 'shield', defense: 18, blockChance: 0.25, name: 'Gold Shield',     rarity: 'rare',      icon: 'weapons/shield_30.PNG' },
  mithril_shield:  { slot: 'shield', defense: 24, blockChance: 0.28, name: 'Mithril Shield',  rarity: 'ultra_rare', icon: 'weapons/shield_40.PNG' },

  // ===== HELMETS =====
  leather_cap:     { slot: 'head', defense: 2,  armorType: 'leather', name: 'Leather Cap',     rarity: 'common',    icon: 'armor/LeatherHelmet.PNG' },
  copper_helm:     { slot: 'head', defense: 3,  armorType: 'chain', name: 'Copper Helm',     rarity: 'common',    icon: 'armor/BasicHelm.PNG' },
  bronze_helm:     { slot: 'head', defense: 4,  armorType: 'chain', name: 'Bronze Helm',     rarity: 'common',    icon: 'armor/BasicMailHelm.PNG' },
  iron_helm:       { slot: 'head', defense: 5,  armorType: 'plate', name: 'Iron Helm',       rarity: 'uncommon',  icon: 'armor/Helm_01_guard.PNG' },
  steel_helm:      { slot: 'head', defense: 7,  armorType: 'plate', name: 'Steel Helm',      rarity: 'uncommon',  icon: 'armor/Helm_07_footman.PNG' },
  silver_helm:     { slot: 'head', defense: 9,  armorType: 'plate', name: 'Silver Helm',     rarity: 'rare',      icon: 'armor/Helm_14_gold.PNG' },
  gold_helm:       { slot: 'head', defense: 11, armorType: 'plate', name: 'Gold Helm',       rarity: 'rare',      icon: 'armor/Helm_31_gold.PNG' },
  mithril_helm:    { slot: 'head', defense: 15, armorType: 'plate', name: 'Mithril Helm',    rarity: 'ultra_rare', icon: 'armor/KnightHelm3.PNG' },

  // ===== CHEST ARMOR =====
  leather_armor:   { slot: 'chest', defense: 4,  armorType: 'leather', name: 'Leather Armor',   rarity: 'common',    icon: 'armor/LeatherChest0.PNG' },
  copper_armor:    { slot: 'chest', defense: 6,  armorType: 'chain', name: 'Copper Armor',    rarity: 'common',    icon: 'armor/Chest_07.PNG' },
  bronze_armor:    { slot: 'chest', defense: 8,  armorType: 'chain', name: 'Bronze Armor',    rarity: 'common',    icon: 'armor/Brigandine.PNG' },
  iron_armor:      { slot: 'chest', defense: 10, armorType: 'plate', speedPenalty: 0.05, name: 'Iron Armor',      rarity: 'uncommon',  icon: 'armor/Chest_14_milita.PNG' },
  steel_armor:     { slot: 'chest', defense: 14, armorType: 'plate', speedPenalty: 0.05, name: 'Steel Armor',     rarity: 'uncommon',  icon: 'armor/MailChest.PNG' },
  silver_armor:    { slot: 'chest', defense: 17, armorType: 'plate', speedPenalty: 0.03, name: 'Silver Armor',    rarity: 'rare',      icon: 'armor/PlateMailChest.PNG' },
  gold_armor:      { slot: 'chest', defense: 20, armorType: 'plate', speedPenalty: 0.05, name: 'Gold Armor',      rarity: 'rare',      icon: 'armor/KingsArmor.PNG' },
  mithril_armor:   { slot: 'chest', defense: 28, armorType: 'plate', speedPenalty: 0.02, name: 'Mithril Armor',   rarity: 'ultra_rare', icon: 'armor/KnightChest3.PNG' },

  // ===== NECKLACES =====
  amulet_vigor:     { slot: 'necklace', effects: [{ type: 'stat_boost', stat: 'vigor', value: 2 }], name: 'Amulet of Vigor',      rarity: 'uncommon', icon: 'resources/NecklaceCross.PNG' },
  amulet_might:     { slot: 'necklace', effects: [{ type: 'stat_boost', stat: 'might', value: 2 }], name: 'Amulet of Might',      rarity: 'uncommon', icon: 'resources/NecklaceGold.PNG' },
  pearl_amulet:     { slot: 'necklace', effects: [{ type: 'stat_boost', stat: 'presence', value: 3 }], name: 'Pearl Amulet',      rarity: 'rare',     icon: 'resources/Pearl.PNG' },

  // ===== RINGS =====
  ring_finesse:     { slot: 'ring1', effects: [{ type: 'stat_boost', stat: 'finesse', value: 2 }], name: 'Ring of Finesse',    rarity: 'uncommon', icon: 'resources/RingSilver.PNG' },
  ring_acumen:      { slot: 'ring1', effects: [{ type: 'stat_boost', stat: 'acumen', value: 2 }], name: 'Ring of Acumen',      rarity: 'uncommon', icon: 'resources/RingGold.PNG' },
  ring_resolve:     { slot: 'ring1', effects: [{ type: 'stat_boost', stat: 'resolve', value: 2 }], name: 'Ring of Resolve',    rarity: 'uncommon', icon: 'resources/RingBronze.PNG' },
  ring_ingenuity:   { slot: 'ring1', effects: [{ type: 'stat_boost', stat: 'ingenuity', value: 2 }], name: 'Ring of Ingenuity', rarity: 'uncommon', icon: 'resources/RingViking.PNG' },
  gold_ring:        { slot: 'ring1', effects: [{ type: 'stat_boost', stat: 'might', value: 3 }, { type: 'stat_boost', stat: 'vigor', value: 3 }], name: 'Gold Ring of Power', rarity: 'rare', icon: 'resources/RingGold2.PNG' },

  // ===== CLOTH ARMOR (sewing, mage-friendly, low defense, magic resist) =====
  cloth_hood:     { slot: 'head',  defense: 1, magicResist: 2, armorType: 'cloth', name: 'Cloth Hood',    rarity: 'common',    icon: 'armor/LeatherHelmet.PNG' },
  cloth_robe:     { slot: 'chest',  defense: 2, magicResist: 3, armorType: 'cloth', name: 'Cloth Robe',    rarity: 'common',    icon: 'armor/LeatherChest0.PNG' },
  cloth_pants:    { slot: 'legs',  defense: 1, magicResist: 1, armorType: 'cloth', name: 'Cloth Pants',   rarity: 'common',    icon: 'armor/LeatherChest0.PNG' },
  cloth_gloves:   { slot: 'hands', defense: 1, magicResist: 1, armorType: 'cloth', name: 'Cloth Gloves',  rarity: 'common',    icon: 'armor/LeatherChest0.PNG' },
  cloth_boots:    { slot: 'feet',  defense: 1, speedBonus: 0.02, armorType: 'cloth', name: 'Cloth Boots',  rarity: 'common',    icon: 'armor/LeatherChest0.PNG' },

  // ===== LEATHER ARMOR (sewing, balanced defense) =====
  leather_hood:    { slot: 'head',  defense: 3, armorType: 'leather', name: 'Leather Hood',    rarity: 'common',    icon: 'armor/LeatherHelmet.PNG' },
  leather_vest:    { slot: 'chest',  defense: 5, armorType: 'leather', name: 'Leather Vest',    rarity: 'common',    icon: 'armor/LeatherChest0.PNG' },
  leather_pants:   { slot: 'legs',  defense: 3, armorType: 'leather', name: 'Leather Pants',   rarity: 'common',    icon: 'armor/LeatherChest0.PNG' },
  leather_gloves:  { slot: 'hands', defense: 2, critBonus: 0.01, armorType: 'leather', name: 'Leather Gloves',  rarity: 'common',    icon: 'armor/LeatherChest0.PNG' },
  leather_boots:   { slot: 'feet',  defense: 2, speedBonus: 0.03, armorType: 'leather', name: 'Leather Boots',   rarity: 'common',    icon: 'armor/LeatherChest0.PNG' },

  // ===== REINFORCED LEATHER =====
  reinforced_leather_helm:    { slot: 'head',  defense: 6,  armorType: 'leather', name: 'Reinforced Leather Helm',    rarity: 'uncommon', icon: 'armor/LeatherHelmet.PNG' },
  reinforced_leather_vest:    { slot: 'chest',  defense: 10, armorType: 'leather', name: 'Reinforced Leather Vest',    rarity: 'uncommon', icon: 'armor/LeatherChest0.PNG' },
  reinforced_leather_pants:   { slot: 'legs',  defense: 6,  armorType: 'leather', name: 'Reinforced Leather Pants',   rarity: 'uncommon', icon: 'armor/LeatherChest0.PNG' },
  reinforced_leather_gloves:  { slot: 'hands', defense: 4,  critBonus: 0.02, armorType: 'leather', name: 'Reinforced Leather Gloves',  rarity: 'uncommon', icon: 'armor/LeatherChest0.PNG' },
  reinforced_leather_boots:   { slot: 'feet',  defense: 4,  speedBonus: 0.03, armorType: 'leather', name: 'Reinforced Leather Boots',   rarity: 'uncommon', icon: 'armor/LeatherChest0.PNG' },

  // ===== SILK ARMOR (mage-focused, magic resist + magic damage) =====
  silk_hood:    { slot: 'head',  defense: 3,  magicResist: 5,  magicDamage: 4, armorType: 'cloth', name: 'Silk Hood',    rarity: 'rare', icon: 'armor/LeatherHelmet.PNG' },
  silk_robe:    { slot: 'chest',  defense: 5,  magicResist: 8,  magicDamage: 8, armorType: 'cloth', name: 'Silk Robe',    rarity: 'rare', icon: 'armor/LeatherChest0.PNG' },
  silk_pants:   { slot: 'legs',  defense: 3,  magicResist: 3,  magicDamage: 2, armorType: 'cloth', name: 'Silk Pants',   rarity: 'rare', icon: 'armor/LeatherChest0.PNG' },
  silk_gloves:  { slot: 'hands', defense: 2,  magicResist: 4,  magicDamage: 5, armorType: 'cloth', name: 'Silk Gloves',  rarity: 'rare', icon: 'armor/LeatherChest0.PNG' },
  silk_boots:   { slot: 'feet',  defense: 2,  magicResist: 3,  speedBonus: 0.03, armorType: 'cloth', name: 'Silk Boots',   rarity: 'rare', icon: 'armor/LeatherChest0.PNG' },

  // ===== ENCHANTED CLOTH (endgame mage armor) =====
  enchanted_hood:    { slot: 'head',  defense: 5,  magicResist: 8,  magicDamage: 8,  armorType: 'cloth', name: 'Enchanted Hood',    rarity: 'ultra_rare', icon: 'armor/LeatherHelmet.PNG' },
  enchanted_robe:    { slot: 'chest',  defense: 8,  magicResist: 12, magicDamage: 15, armorType: 'cloth', name: 'Enchanted Robe',    rarity: 'ultra_rare', icon: 'armor/LeatherChest0.PNG' },
  enchanted_pants:   { slot: 'legs',  defense: 5,  magicResist: 6,  magicDamage: 5,  armorType: 'cloth', name: 'Enchanted Pants',   rarity: 'ultra_rare', icon: 'armor/LeatherChest0.PNG' },
  enchanted_gloves:  { slot: 'hands', defense: 3,  magicResist: 6,  magicDamage: 8,  armorType: 'cloth', name: 'Enchanted Gloves',  rarity: 'ultra_rare', icon: 'armor/LeatherChest0.PNG' },
  enchanted_boots:   { slot: 'feet',  defense: 3,  magicResist: 5,  magicDamage: 4,  speedBonus: 0.04, armorType: 'cloth', name: 'Enchanted Boots',   rarity: 'ultra_rare', icon: 'armor/LeatherChest0.PNG' },

  // ===== METAL GAUNTLETS =====
  copper_gauntlets:  { slot: 'hands', defense: 2,  armorType: 'chain', name: 'Copper Gauntlets',  rarity: 'common',     icon: 'armor/BasicHelm.PNG' },
  bronze_gauntlets:  { slot: 'hands', defense: 3,  armorType: 'chain', name: 'Bronze Gauntlets',  rarity: 'common',     icon: 'armor/BasicMailHelm.PNG' },
  iron_gauntlets:    { slot: 'hands', defense: 4,  armorType: 'plate', name: 'Iron Gauntlets',    rarity: 'uncommon',   icon: 'armor/Helm_01_guard.PNG' },
  steel_gauntlets:   { slot: 'hands', defense: 6,  armorType: 'plate', name: 'Steel Gauntlets',   rarity: 'uncommon',   icon: 'armor/Helm_07_footman.PNG' },
  silver_gauntlets:  { slot: 'hands', defense: 8,  armorType: 'plate', name: 'Silver Gauntlets',  rarity: 'rare',       icon: 'armor/Helm_14_gold.PNG' },
  gold_gauntlets:    { slot: 'hands', defense: 10, armorType: 'plate', name: 'Gold Gauntlets',    rarity: 'rare',       icon: 'armor/Helm_31_gold.PNG' },
  mithril_gauntlets: { slot: 'hands', defense: 14, armorType: 'plate', speedPenalty: 0.01, name: 'Mithril Gauntlets', rarity: 'ultra_rare', icon: 'armor/KnightHelm3.PNG' },

  // ===== METAL GREAVES =====
  copper_greaves:  { slot: 'legs', defense: 4,  armorType: 'chain', name: 'Copper Greaves',  rarity: 'common',     icon: 'armor/BasicHelm.PNG' },
  bronze_greaves:  { slot: 'legs', defense: 6,  armorType: 'chain', name: 'Bronze Greaves',  rarity: 'common',     icon: 'armor/BasicMailHelm.PNG' },
  iron_greaves:    { slot: 'legs', defense: 7,  armorType: 'plate', speedPenalty: 0.03, name: 'Iron Greaves',    rarity: 'uncommon',   icon: 'armor/Chest_14_milita.PNG' },
  steel_greaves:   { slot: 'legs', defense: 10, armorType: 'plate', speedPenalty: 0.03, name: 'Steel Greaves',   rarity: 'uncommon',   icon: 'armor/MailChest.PNG' },
  silver_greaves:  { slot: 'legs', defense: 12, armorType: 'plate', speedPenalty: 0.02, name: 'Silver Greaves',  rarity: 'rare',       icon: 'armor/PlateMailChest.PNG' },
  gold_greaves:    { slot: 'legs', defense: 15, armorType: 'plate', speedPenalty: 0.03, name: 'Gold Greaves',    rarity: 'rare',       icon: 'armor/KingsArmor.PNG' },
  mithril_greaves: { slot: 'legs', defense: 20, armorType: 'plate', speedPenalty: 0.01, name: 'Mithril Greaves', rarity: 'ultra_rare', icon: 'armor/KnightChest3.PNG' },

  // ===== METAL BOOTS =====
  copper_boots:  { slot: 'feet', defense: 3,  armorType: 'chain', name: 'Copper Boots',  rarity: 'common',     icon: 'armor/BasicHelm.PNG' },
  bronze_boots:  { slot: 'feet', defense: 4,  armorType: 'chain', name: 'Bronze Boots',  rarity: 'common',     icon: 'armor/BasicMailHelm.PNG' },
  iron_boots:    { slot: 'feet', defense: 5,  armorType: 'plate', speedPenalty: 0.02, name: 'Iron Boots',    rarity: 'uncommon',   icon: 'armor/Helm_01_guard.PNG' },
  steel_boots:   { slot: 'feet', defense: 7,  armorType: 'plate', speedPenalty: 0.02, name: 'Steel Boots',   rarity: 'uncommon',   icon: 'armor/Helm_07_footman.PNG' },
  silver_boots:  { slot: 'feet', defense: 9,  armorType: 'plate', speedPenalty: 0.01, name: 'Silver Boots',  rarity: 'rare',       icon: 'armor/Helm_14_gold.PNG' },
  gold_boots:    { slot: 'feet', defense: 11, armorType: 'plate', speedPenalty: 0.02, name: 'Gold Boots',    rarity: 'rare',       icon: 'armor/Helm_31_gold.PNG' },
  mithril_boots: { slot: 'feet', defense: 14, armorType: 'plate', speedPenalty: 0.01, name: 'Mithril Boots', rarity: 'ultra_rare', icon: 'armor/KnightChest3.PNG' },

  // ===== UNDERSHIRTS (light layer, small defense + utility) =====
  cloth_undershirt:    { slot: 'undershirt', defense: 1, magicResist: 1, armorType: 'cloth', name: 'Cloth Undershirt',    rarity: 'common',    icon: 'armor/LeatherChest0.PNG' },
  leather_undershirt:  { slot: 'undershirt', defense: 2, armorType: 'leather', name: 'Leather Undershirt',  rarity: 'common',    icon: 'armor/LeatherChest0.PNG' },
  padded_undershirt:   { slot: 'undershirt', defense: 3, armorType: 'chain', name: 'Padded Undershirt',   rarity: 'uncommon',  icon: 'armor/Chest_07.PNG' },
  silk_undershirt:     { slot: 'undershirt', defense: 2, magicResist: 4, magicDamage: 3, armorType: 'cloth', name: 'Silk Undershirt',     rarity: 'rare',      icon: 'armor/LeatherChest0.PNG' },
  enchanted_undershirt: { slot: 'undershirt', defense: 3, magicResist: 6, magicDamage: 6, armorType: 'cloth', name: 'Enchanted Undershirt', rarity: 'ultra_rare', icon: 'armor/LeatherChest0.PNG' },
  chainmail_undershirt: { slot: 'undershirt', defense: 5, speedPenalty: 0.02, armorType: 'chain', name: 'Chainmail Undershirt', rarity: 'uncommon', icon: 'armor/MailChest.PNG' },
  mithril_chainmail:   { slot: 'undershirt', defense: 8, armorType: 'chain', name: 'Mithril Chainmail',   rarity: 'ultra_rare', icon: 'armor/KnightChest3.PNG' },

  // ===== ARM GUARDS / BRACERS =====
  cloth_armwraps:      { slot: 'arms', defense: 1, armorType: 'cloth', name: 'Cloth Armwraps',      rarity: 'common',    icon: 'armor/LeatherChest0.PNG' },
  leather_bracers:     { slot: 'arms', defense: 2, armorType: 'leather', name: 'Leather Bracers',     rarity: 'common',    icon: 'armor/LeatherChest0.PNG' },
  iron_bracers:        { slot: 'arms', defense: 4, armorType: 'plate', name: 'Iron Bracers',        rarity: 'uncommon',  icon: 'armor/Helm_01_guard.PNG' },
  steel_bracers:       { slot: 'arms', defense: 6, armorType: 'plate', name: 'Steel Bracers',       rarity: 'uncommon',  icon: 'armor/Helm_07_footman.PNG' },
  silver_bracers:      { slot: 'arms', defense: 8, armorType: 'plate', name: 'Silver Bracers',      rarity: 'rare',      icon: 'armor/Helm_14_gold.PNG' },
  gold_bracers:        { slot: 'arms', defense: 10, armorType: 'plate', name: 'Gold Bracers',        rarity: 'rare',      icon: 'armor/Helm_31_gold.PNG' },
  mithril_bracers:     { slot: 'arms', defense: 14, armorType: 'plate', name: 'Mithril Bracers',     rarity: 'ultra_rare', icon: 'armor/KnightHelm3.PNG' },
  silk_armwraps:       { slot: 'arms', defense: 2, magicResist: 3, magicDamage: 3, armorType: 'cloth', name: 'Silk Armwraps',       rarity: 'rare',      icon: 'armor/LeatherChest0.PNG' },
  enchanted_armwraps:  { slot: 'arms', defense: 3, magicResist: 5, magicDamage: 5, armorType: 'cloth', name: 'Enchanted Armwraps',  rarity: 'ultra_rare', icon: 'armor/LeatherChest0.PNG' },
  reinforced_leather_bracers: { slot: 'arms', defense: 5, armorType: 'leather', name: 'Reinforced Leather Bracers', rarity: 'uncommon', icon: 'armor/LeatherChest0.PNG' },

  // ===== JEWELCRAFTED RINGS =====
  silver_ring:     { slot: 'ring1', effects: [{ type: 'stat_boost', stat: 'finesse', value: 2 }], name: 'Silver Ring',     rarity: 'uncommon', icon: 'resources/RingSilver.PNG' },
  gold_ring_craft: { slot: 'ring1', effects: [{ type: 'stat_boost', stat: 'might', value: 3 }], name: 'Gold Ring',        rarity: 'rare',     icon: 'resources/RingGold.PNG' },
  mithril_ring:    { slot: 'ring1', effects: [{ type: 'stat_boost', stat: 'acumen', value: 4 }, { type: 'stat_boost', stat: 'resolve', value: 2 }], name: 'Mithril Ring', rarity: 'ultra_rare', icon: 'resources/RingViking.PNG' },
  enchanted_ring:  { slot: 'ring1', effects: [{ type: 'stat_boost', stat: 'acumen', value: 3 }, { type: 'stat_boost', stat: 'ingenuity', value: 3 }], magicDamage: 5, name: 'Enchanted Ring', rarity: 'rare', icon: 'resources/RingGold2.PNG' },

  // ===== JEWELCRAFTED NECKLACES =====
  silver_necklace:  { slot: 'necklace', effects: [{ type: 'stat_boost', stat: 'resolve', value: 2 }], name: 'Silver Necklace',  rarity: 'uncommon', icon: 'resources/NecklaceCross.PNG' },
  gold_necklace:    { slot: 'necklace', effects: [{ type: 'stat_boost', stat: 'presence', value: 3 }, { type: 'stat_boost', stat: 'vigor', value: 2 }], name: 'Gold Necklace', rarity: 'rare', icon: 'resources/NecklaceGold.PNG' },
  mithril_necklace: { slot: 'necklace', effects: [{ type: 'stat_boost', stat: 'vigor', value: 4 }, { type: 'stat_boost', stat: 'resolve', value: 3 }], magicResist: 5, name: 'Mithril Necklace', rarity: 'ultra_rare', icon: 'resources/NecklaceGold.PNG' },
  ruby_pendant:     { slot: 'necklace', effects: [{ type: 'stat_boost', stat: 'might', value: 3 }, { type: 'stat_boost', stat: 'finesse', value: 2 }], name: 'Ruby Pendant', rarity: 'rare', icon: 'resources/Pearl.PNG' },

  // ===== SPECIALIZED RINGS (from loot-generator RING_DESIGNS) =====
  ring_of_the_blade:     { slot: 'ring1', effects: [{ type: 'stat_boost', stat: 'finesse', value: 2 }], name: 'Ring of the Blade',     rarity: 'rare',      icon: 'resources/RingSilver.PNG' },
  ring_of_arcane_focus:  { slot: 'ring1', effects: [{ type: 'stat_boost', stat: 'acumen', value: 3 }],  name: 'Ring of Arcane Focus',  rarity: 'rare',      icon: 'resources/RingGold.PNG' },
  ring_of_the_hunt:      { slot: 'ring1', effects: [{ type: 'stat_boost', stat: 'finesse', value: 3 }], name: 'Ring of the Hunt',      rarity: 'rare',      icon: 'resources/RingSilver.PNG' },
  ring_of_brutality:     { slot: 'ring1', effects: [{ type: 'stat_boost', stat: 'might', value: 3 }],   name: 'Ring of Brutality',     rarity: 'rare',      icon: 'resources/RingSilver.PNG' },
  ring_of_iron_will:     { slot: 'ring2', effects: [{ type: 'stat_boost', stat: 'vigor', value: 4 }],   name: 'Ring of Iron Will',     rarity: 'rare',      icon: 'resources/RingSilver.PNG' },
  ring_of_warding:       { slot: 'ring2', magicResist: 8, effects: [{ type: 'stat_boost', stat: 'resolve', value: 2 }], name: 'Ring of Warding', rarity: 'rare', icon: 'resources/RingGold.PNG' },
  ring_of_regeneration:  { slot: 'ring2', effects: [{ type: 'stat_boost', stat: 'vigor', value: 2 }],   name: 'Ring of Regeneration',  rarity: 'rare',      icon: 'resources/RingGold.PNG' },
  ring_of_the_well:      { slot: 'ring3', effects: [{ type: 'stat_boost', stat: 'acumen', value: 2 }],  name: 'Ring of the Well',      rarity: 'rare',      icon: 'resources/RingGold.PNG' },
  ring_of_fury:          { slot: 'ring3', effects: [{ type: 'stat_boost', stat: 'might', value: 2 }],   name: 'Ring of Fury',          rarity: 'rare',      icon: 'resources/RingSilver.PNG' },
  ring_of_concentration: { slot: 'ring3', effects: [{ type: 'stat_boost', stat: 'finesse', value: 2 }], name: 'Ring of Concentration', rarity: 'rare',      icon: 'resources/RingSilver.PNG' },
  ring_of_endurance:     { slot: 'ring3', effects: [{ type: 'stat_boost', stat: 'vigor', value: 2 }],   name: 'Ring of Endurance',     rarity: 'rare',      icon: 'resources/RingSilver.PNG' },
  ring_of_the_guide:     { slot: 'ring4', effects: [{ type: 'stat_boost', stat: 'acumen', value: 1 }],  name: 'Ring of the Guide',     rarity: 'uncommon',  icon: 'resources/RingSilver.PNG' },
  ring_of_fortune:       { slot: 'ring4', effects: [{ type: 'stat_boost', stat: 'presence', value: 2 }], name: 'Ring of Fortune',      rarity: 'rare',      icon: 'resources/RingGold.PNG' },
  ring_of_swiftness:     { slot: 'ring4', speedBonus: 0.08, effects: [{ type: 'stat_boost', stat: 'finesse', value: 1 }], name: 'Ring of Swiftness', rarity: 'uncommon', icon: 'resources/RingSilver.PNG' },
  ring_of_the_smith:     { slot: 'ring5', effects: [{ type: 'stat_boost', stat: 'ingenuity', value: 2 }], name: 'Ring of the Smith',   rarity: 'uncommon',  icon: 'resources/RingSilver.PNG' },
  ring_of_the_miner:     { slot: 'ring5', effects: [{ type: 'stat_boost', stat: 'vigor', value: 1 }],   name: 'Ring of the Miner',     rarity: 'uncommon',  icon: 'resources/RingSilver.PNG' },
  ring_of_the_alchemist: { slot: 'ring5', effects: [{ type: 'stat_boost', stat: 'acumen', value: 2 }],  name: 'Ring of the Alchemist', rarity: 'rare',      icon: 'resources/RingGold.PNG' },
  ring_of_the_enchanter: { slot: 'ring5', effects: [{ type: 'stat_boost', stat: 'acumen', value: 2 }],  name: 'Ring of the Enchanter', rarity: 'rare',      icon: 'resources/RingGold.PNG' },
  ring_of_the_void_walker: { slot: 'ring6', effects: [{ type: 'stat_boost', stat: 'finesse', value: 3 }], name: 'Ring of the Void Walker', rarity: 'legendary', icon: 'resources/RingViking.PNG' },
  ring_of_the_phoenix:   { slot: 'ring6', effects: [{ type: 'stat_boost', stat: 'vigor', value: 3 }],   name: 'Ring of the Phoenix',   rarity: 'legendary', icon: 'resources/RingViking.PNG' },
  ring_of_the_leviathan: { slot: 'ring6', effects: [{ type: 'stat_boost', stat: 'vigor', value: 3 }, { type: 'stat_boost', stat: 'acumen', value: 3 }], name: 'Ring of the Leviathan', rarity: 'legendary', icon: 'resources/RingViking.PNG' },

  // ===== CONTAINER EQUIPMENT (backpacks & rigs) =====
  leather_satchel:   { slot: 'backpack', name: 'Leather Satchel',     rarity: 'common',    containerGridW: 2, containerGridH: 2 },
  adventurer_pack:   { slot: 'backpack', name: "Adventurer's Pack",    rarity: 'uncommon',  containerGridW: 3, containerGridH: 2 },
  explorer_backpack: { slot: 'backpack', name: 'Explorer Backpack',    rarity: 'rare',      containerGridW: 3, containerGridH: 3 },
  mithril_frame:     { slot: 'backpack', name: 'Mithril Frame Pack',   rarity: 'ultra_rare', containerGridW: 4, containerGridH: 3 },
  belt_pouch:        { slot: 'rig',      name: 'Belt Pouch',           rarity: 'common',    containerGridW: 2, containerGridH: 1 },
  utility_vest:      { slot: 'rig',      name: 'Utility Vest',         rarity: 'uncommon',  containerGridW: 2, containerGridH: 2 },
  tactical_rig:      { slot: 'rig',      name: 'Tactical Rig',         rarity: 'rare',      containerGridW: 3, containerGridH: 2 },
};

// ---------------------------------------------------------------------------
// Item Durability System
// ---------------------------------------------------------------------------

// Max durability by material/armor type (derived from item type name prefix or armorType)
var DURABILITY_BY_MATERIAL = {
  cloth:     50,
  leather:   50,
  wooden:    50,
  copper:    75,
  bronze:    100,
  iron:      150,
  steel:     200,
  silver:    175,
  gold:      175,
  mithril:   300,
  enchanted: 250,
  silk:      75,
  reinforced: 125,
  padded:    75,
  chainmail: 175,
  stormsteel: 250,
  deepsilver: 225,
  soulforged: 350,
  voidmetal:  400,
};

// Slots that count as "armor" for durability loss on taking damage (shield now in hand slots)
var ARMOR_SLOTS = ['head', 'chest', 'undershirt', 'arms', 'hands', 'legs', 'feet'];

// Slots that count as "weapon" for durability loss on attacking (both hands lose durability)
var WEAPON_SLOTS = ['main_hand', 'off_hand'];

// Slots that count as "tools" for durability loss on harvesting
var TOOL_SLOTS = ['axe', 'pickaxe'];

// Slots that never lose durability (jewelry)
var JEWELRY_SLOTS = ['ring1', 'ring2', 'ring3', 'ring4', 'ring5', 'ring6', 'necklace'];

// Repair cost: maps material prefix to resource type needed
var REPAIR_MATERIAL_COST = {
  cloth:     { resource: 'thread',      multiplier: 1 },
  leather:   { resource: 'leather',     multiplier: 1 },
  wooden:    { resource: 'wood',        multiplier: 1 },
  copper:    { resource: 'copper_ore',  multiplier: 1 },
  bronze:    { resource: 'bronze_bar',  multiplier: 1 },
  iron:      { resource: 'iron_bar',    multiplier: 1 },
  steel:     { resource: 'iron_bar',    multiplier: 2 },
  silver:    { resource: 'silver_bar',  multiplier: 1 },
  gold:      { resource: 'gold_bar',    multiplier: 1 },
  mithril:   { resource: 'mithril_ore', multiplier: 1 },
  enchanted: { resource: 'mana_crystal', multiplier: 1 },
  silk:      { resource: 'silk',        multiplier: 1 },
  reinforced: { resource: 'leather',    multiplier: 2 },
  padded:    { resource: 'cloth',       multiplier: 1 },
  chainmail: { resource: 'iron_bar',    multiplier: 1 },
  stormsteel: { resource: 'stormsteel_bar', multiplier: 2 },
  deepsilver: { resource: 'deepsilver_bar', multiplier: 2 },
  soulforged: { resource: 'soulforged_bar', multiplier: 3 },
  voidmetal:  { resource: 'voidmetal_bar',  multiplier: 3 },
};

// Determine material prefix from an item type string
function getItemMaterial(itemType) {
  if (!itemType || typeof itemType !== 'string') return 'iron';
  var prefixes = ['voidmetal', 'soulforged', 'deepsilver', 'stormsteel', 'enchanted', 'reinforced', 'chainmail', 'padded', 'mithril', 'leather', 'wooden', 'copper', 'bronze', 'silver', 'steel', 'cloth', 'silk', 'iron', 'gold'];
  for (var i = 0; i < prefixes.length; i++) {
    if (itemType.indexOf(prefixes[i]) === 0) return prefixes[i];
  }
  return 'iron'; // default fallback
}

// Get max durability for an item type
function getMaxDurability(itemType) {
  var material = getItemMaterial(itemType);
  return DURABILITY_BY_MATERIAL[material] || 100;
}

// Ensure an equipped item has durability fields.  Called when equipping and
// when any durability operation touches the item.  Items in inventory keep
// whatever durability they had; this only sets defaults if they are missing.
function ensureItemDurability(item) {
  if (!item) return;
  if (typeof item.maxDurability !== 'number' || item.maxDurability <= 0) {
    item.maxDurability = getMaxDurability(item.type);
  }
  if (typeof item.durability !== 'number' || item.durability < 0) {
    item.durability = item.maxDurability;
  }
}

// ---------------------------------------------------------------------------
// Dual-Wield Combo System
// ---------------------------------------------------------------------------

var DUAL_WIELD_COMBOS = {
  // === DUAL BLADES ===
  'dagger_dagger': {
    name: 'Twin Fangs',
    bonuses: { attackSpeed: 0.25, critBonus: 0.08, dodgeBonus: 0.05 },
    skills: ['flurry_of_blades', 'twin_backstab'],
    description: 'Lightning-fast strikes. +25% attack speed, +8% crit, +5% dodge.',
  },
  'sword_sword': {
    name: 'Blade Storm',
    bonuses: { attackSpeed: 0.10, meleeDmgBonus: 0.12, parryChance: 0.08 },
    skills: ['whirlwind_slash', 'riposte'],
    description: 'Balanced dual offense. +10% speed, +12% melee damage, 8% parry.',
  },
  'sword_dagger': {
    name: 'Swordbreaker',
    bonuses: { attackSpeed: 0.15, critBonus: 0.05, parryChance: 0.06 },
    skills: ['feint_strike', 'disarm'],
    description: 'Main blade + quick off-hand. +15% speed, +5% crit, 6% parry.',
  },
  'axe_axe': {
    name: 'Berserker Fury',
    bonuses: { meleeDmgBonus: 0.20, attackSpeed: -0.10, lifesteal: 0.05 },
    skills: ['cleave', 'raging_blow'],
    description: 'Raw power, slower. +20% damage, -10% speed, 5% lifesteal.',
  },
  'mace_mace': {
    name: 'Skull Crusher',
    bonuses: { meleeDmgBonus: 0.18, stunChance: 0.10, armorPen: 0.08 },
    skills: ['ground_pound', 'concussive_blow'],
    description: 'Armor-breaking devastation. +18% damage, 10% stun, 8% armor pen.',
  },

  // === WEAPON + SHIELD ===
  'weapon_shield': {
    name: 'Sword & Board',
    bonuses: { blockChance: 0.05, defense: 5, counterChance: 0.06 },
    skills: ['shield_bash', 'defensive_stance'],
    description: 'Classic defense. +5% block, +5 defense, 6% counter chance.',
  },

  // === DUAL SHIELDS ===
  'shield_shield': {
    name: 'Iron Fortress',
    bonuses: { blockChance: 0.15, defense: 10, damageReduction: 0.15, attackSpeed: -0.30, meleeDmgBonus: -0.30 },
    skills: ['shield_wall', 'reflecting_guard', 'taunt'],
    description: 'Unstoppable defense. +15% block, +10 def, 15% DR. -30% damage/speed.',
  },

  // === DUAL MAGIC ===
  'wand_wand': {
    name: 'Arcane Conduit',
    bonuses: { magicDmgBonus: 0.20, castSpeed: 0.15, maxManaBonus: 20 },
    skills: ['arcane_barrage', 'mana_shield'],
    description: 'Doubled magical output. +20% magic damage, +15% cast speed, +20 mana.',
  },
  'staff_staff': {
    name: 'Grand Magister',
    bonuses: { magicDmgBonus: 0.30, magicResist: 10, castSpeed: -0.10, maxManaBonus: 40 },
    skills: ['meteor_strike', 'arcane_ward'],
    description: 'Supreme magic power. +30% magic damage, +10 MR, +40 mana. -10% cast speed.',
  },
  'wand_staff': {
    name: 'Battlemage',
    bonuses: { magicDmgBonus: 0.15, castSpeed: 0.10, magicResist: 5, maxManaBonus: 15 },
    skills: ['spell_weave', 'counterspell'],
    description: 'Balanced spellcasting. +15% magic, +10% cast, +5 MR, +15 mana.',
  },

  // === MELEE + MAGIC (hybrid) ===
  'sword_wand': {
    name: 'Spellblade',
    bonuses: { meleeDmgBonus: 0.08, magicDmgBonus: 0.08, weaponElement: 'arcane' },
    skills: ['enchanted_strike', 'spell_parry'],
    description: 'Melee-magic hybrid. +8% melee/magic, arcane-infused attacks.',
  },
  'mace_wand': {
    name: 'Battle Priest',
    bonuses: { meleeDmgBonus: 0.05, healBonus: 0.15, magicResist: 5 },
    skills: ['smite', 'healing_light'],
    description: 'Holy warrior. +5% melee, +15% healing, +5 magic resist.',
  },

  // === DUAL TWO-HANDED (Titan Grip) ===
  '2h_2h': {
    name: 'Titan Grip',
    bonuses: { meleeDmgBonus: 0.35, attackSpeed: -0.25, critBonus: 0.05 },
    penalties: { offHandDmgPenalty: 0.40 },
    skills: ['titan_slam', 'earthquake'],
    description: 'Dual two-handers! +35% damage, -25% speed. Off-hand at 60% power.',
    requiresStr: 15,
  },

  // === BOW/CROSSBOW + OFF-HAND ===
  'ranged_shield': {
    name: 'Shieldbearer Archer',
    bonuses: { blockChance: 0.10, defense: 3, attackSpeed: -0.15 },
    skills: ['shield_cover', 'aimed_shot'],
    description: 'Defensive archer. +10% block, +3 def. -15% attack speed.',
  },
  'ranged_dagger': {
    name: 'Scout',
    bonuses: { dodgeBonus: 0.08, critBonus: 0.05, moveSpeed: 0.10 },
    skills: ['quick_draw', 'knife_throw'],
    description: 'Mobile skirmisher. +8% dodge, +5% crit, +10% move speed.',
  },
};

// Categorize a weapon/shield definition into a combo category
function categorizeHandItem(weaponDef) {
  if (!weaponDef) return null;
  if (weaponDef.slot === 'shield') return 'shield';
  var name = (weaponDef.name || '').toLowerCase();
  var cat = weaponDef.category || '';
  // Check by name patterns
  if (name.indexOf('dagger') !== -1) return 'dagger';
  if (name.indexOf('sword') !== -1) return 'sword';
  if (name.indexOf('battle axe') !== -1) return 'axe';
  if (name.indexOf('mace') !== -1 || name.indexOf('hammer') !== -1) return 'mace';
  if (name.indexOf('spear') !== -1) return 'spear';
  if (name.indexOf('scythe') !== -1) return 'scythe';
  if (name.indexOf('staff') !== -1) return 'staff';
  if (name.indexOf('wand') !== -1) return 'wand';
  if (name.indexOf('crossbow') !== -1) return 'crossbow';
  if (name.indexOf('bow') !== -1) return 'bow';
  // Fallback by category
  if (cat === 'archery') return 'bow';
  if (cat === 'magic') return 'wand';
  if (cat === 'melee_blade') return 'sword';
  if (cat === 'melee_blunt') return 'mace';
  return null;
}

// Container equipment — backpacks and rigs provide extra grid inventory space
var BACKPACKS = {
  leather_satchel:   { tier: 1, def: 0, gridW: 2, gridH: 2, name: 'Leather Satchel',     slot: 'backpack', rarity: 'common' },
  adventurer_pack:   { tier: 2, def: 0, gridW: 3, gridH: 2, name: "Adventurer's Pack",    slot: 'backpack', rarity: 'uncommon' },
  explorer_backpack: { tier: 3, def: 0, gridW: 3, gridH: 3, name: 'Explorer Backpack',    slot: 'backpack', rarity: 'rare' },
  mithril_frame:     { tier: 4, def: 0, gridW: 4, gridH: 3, name: 'Mithril Frame Pack',   slot: 'backpack', rarity: 'ultra_rare' },
};

var RIGS = {
  belt_pouch:        { tier: 1, def: 0, gridW: 2, gridH: 1, name: 'Belt Pouch',           slot: 'rig', rarity: 'common' },
  utility_vest:      { tier: 2, def: 0, gridW: 2, gridH: 2, name: 'Utility Vest',         slot: 'rig', rarity: 'uncommon' },
  tactical_rig:      { tier: 3, def: 0, gridW: 3, gridH: 2, name: 'Tactical Rig',         slot: 'rig', rarity: 'rare' },
};

module.exports = {
  EQUIPMENT_SLOTS,
  VALID_AXES,
  VALID_PICKAXES,
  COMBAT_SKILL_FOR_CATEGORY,
  RARITY_COMBAT_LEVEL,
  WEAPON_TYPES,
  DURABILITY_BY_MATERIAL,
  ARMOR_SLOTS,
  WEAPON_SLOTS,
  TOOL_SLOTS,
  JEWELRY_SLOTS,
  REPAIR_MATERIAL_COST,
  getItemMaterial,
  getMaxDurability,
  ensureItemDurability,
  DUAL_WIELD_COMBOS,
  categorizeHandItem,
  BACKPACKS,
  RIGS,
};
