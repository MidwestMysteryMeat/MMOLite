'use strict';

var dungeonThemes = require('./dungeon-themes');
var THEME_BONUS_LOOT = dungeonThemes.THEME_BONUS_LOOT;

var CHEST_LOOT = {
  common: {
    goldMin: 5,    goldMax: 15,
    resources: ['wood', 'stone', 'iron_ore', 'herbs'],
    cardChance: 0.05,
  },
  uncommon: {
    goldMin: 15,   goldMax: 40,
    resources: ['iron_bar', 'bronze_ore', 'glass_sand', 'mushroom', 'gem_rough', 'copper_ore'],
    cardChance: 0.12,
  },
  rare: {
    goldMin: 40,   goldMax: 100,
    resources: ['bronze_bar', 'glass', 'mana_crystal', 'gem_cut', 'cogs', 'silver_ore', 'copper_bar'],
    cardChance: 0.25,
  },
  legendary: {
    goldMin: 100,  goldMax: 300,
    resources: ['mana_crystal', 'gem_cut', 'clockwork_core', 'glass_lens', 'gold_ore', 'silver_bar', 'mithril_ore'],
    cardChance: 0.50,
  },
};

var ENEMY_LOOT = {
  shallow: {
    dropChance: 0.30,
    resources: ['wood', 'stone', 'iron_ore', 'herbs'],
    amountMin: 1, amountMax: 1,
    multiDropChance: 0.0,
    essenceChance: 0.15,
    essenceMin: 1, essenceMax: 1,
  },
  mid: {
    dropChance: 0.45,
    resources: ['iron_bar', 'bronze_ore', 'mushroom', 'gem_rough', 'copper_ore'],
    amountMin: 1, amountMax: 2,
    multiDropChance: 0.15,
    essenceChance: 0.25,
    essenceMin: 1, essenceMax: 2,
  },
  deep: {
    dropChance: 0.60,
    resources: ['bronze_bar', 'mana_crystal', 'gem_cut', 'silver_ore', 'dark_crystal'],
    amountMin: 1, amountMax: 3,
    multiDropChance: 0.25,
    essenceChance: 0.35,
    essenceMin: 1, essenceMax: 3,
  },
  boss: {
    dropChance: 1.0,
    resources: ['mana_crystal', 'gem_cut', 'dark_crystal', 'mithril_ore', 'gold_ore'],
    amountMin: 2, amountMax: 5,
    multiDropChance: 0.80,
    essenceChance: 1.0,
    essenceMin: 3, essenceMax: 8,
    alwaysBossTrophy: true,
  },
};

function rollEnemyLoot(enemy, floorNum, theme) {
  var tier;
  if (enemy.isBoss) tier = 'boss';
  else if (floorNum >= 15) tier = 'deep';
  else if (floorNum >= 6) tier = 'mid';
  else tier = 'shallow';

  var lootDef = ENEMY_LOOT[tier];
  var drops = [];

  if (Math.random() < lootDef.dropChance) {
    var pool = lootDef.resources.slice();
    var themeBonus = THEME_BONUS_LOOT[theme];
    if (themeBonus) {
      for (var i = 0; i < themeBonus.length; i++) {
        if (pool.indexOf(themeBonus[i]) === -1) pool.push(themeBonus[i]);
      }
    }

    var resource = pool[Math.floor(Math.random() * pool.length)];
    var amount = lootDef.amountMin + Math.floor(Math.random() * (lootDef.amountMax - lootDef.amountMin + 1));
    drops.push({ resource: resource, amount: amount });

    if (Math.random() < lootDef.multiDropChance) {
      var resource2 = pool[Math.floor(Math.random() * pool.length)];
      drops.push({ resource: resource2, amount: 1 });
    }
  }

  if (Math.random() < lootDef.essenceChance) {
    var essenceAmt = lootDef.essenceMin + Math.floor(Math.random() * (lootDef.essenceMax - lootDef.essenceMin + 1));
    essenceAmt += Math.floor(floorNum / 10);
    drops.push({ resource: 'dungeon_essence', amount: essenceAmt });
  }

  if (lootDef.alwaysBossTrophy) {
    drops.push({ resource: 'boss_trophy', amount: 1 });
  }

  return drops;
}

function getTrapDamage(floorNum) {
  return 10 + floorNum * 5;
}

module.exports = {
  CHEST_LOOT: CHEST_LOOT,
  ENEMY_LOOT: ENEMY_LOOT,
  rollEnemyLoot: rollEnemyLoot,
  getTrapDamage: getTrapDamage,
};
