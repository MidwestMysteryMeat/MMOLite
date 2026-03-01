// handlers/crafting.js
// Recipe-based crafting system with station proximity checks.
// Handles: get_recipes, craft_item

var crypto = require('crypto');
var rpgData = require('../rpg-data');
var challengesHandler = require('./challenges');
var knowledgeHandler = require('./knowledge');
var lootGen = require('../loot-generator');
var masteryCore = require('../mastery/mastery-core');

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

var { RECIPES } = require('../crafting-recipes');

var QUALITY_CRAFT_SKILL_THRESHOLD = 10; // only recipes where max skillReq >= 10 get minigame
var pendingMinigames = new Map(); // socketId -> { recipeId, windowStart, windowEnd, expiresAt, account_key }

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
          // Acquire craft lock BEFORE resource deduction to prevent double-spend
          if (craftLocks.has(key)) {
            socket.emit('craft_error', { message: 'Crafting in progress' });
            return;
          }
          craftLocks.add(key);
          // Check resources first before starting minigame
          var _preInv = accounts.getMMOInventory(key);
          if (_preInv) {
            var _canAfford = true;
            var _costKeys = Object.keys(recipe.cost);
            for (var _ci = 0; _ci < _costKeys.length; _ci++) {
              if ((_preInv[_costKeys[_ci]] || 0) < recipe.cost[_costKeys[_ci]]) { _canAfford = false; craftLocks.delete(key); socket.emit('craft_error', { message: 'Not enough resources' }); return; }
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
          } else {
            craftLocks.delete(key);
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

          // Apply mastery tree bonuses for the primary crafting skill
          var _craftSkillReqs = recipe.skillReq ? Object.keys(recipe.skillReq) : [];
          var _craftMasterySkill = _craftSkillReqs.length > 0 ? _craftSkillReqs[0] : null;
          var _craftMastery = _craftMasterySkill ? masteryCore.getSkillMasteryBonuses(craftAccount, _craftMasterySkill) : {};
          cardCraftQualityBonus += (_craftMastery.craft_quality_pct || 0);
          cardCraftBonus += (_craftMastery.double_craft_pct || 0);
          var masteryIngredientSave = (_craftMastery.ingredient_save_pct || 0);

          // --- Preflight: verify all ingredients are available before deducting any ---
          var totalIngredientSave = (craftBonuses ? (craftBonuses.ingredientSaveChance || 0) : 0) + cardIngredientSave + masteryIngredientSave;
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

          // --- Deduct resources (amounts already rolled above) with rollback on failure ---
          var _deducted = [];
          var _deductFailed = false;
          for (var j = 0; j < costTypes.length; j++) {
            var rt = costTypes[j];
            var amt = _prerolledAmounts[rt];
            var result = accounts.removeResource(key, rt, amt);
            if (result === null) {
              // Rollback previously deducted resources
              for (var rj = 0; rj < _deducted.length; rj++) {
                accounts.addResource(key, _deducted[rj].rt, _deducted[rj].amt);
              }
              socket.emit('craft_error', {
                message: 'Failed to deduct ' + rt.replace(/_/g, ' ') + ' -- not enough resources',
              });
              _deductFailed = true;
              break;
            }
            _deducted.push({ rt: rt, amt: amt });
          }
          if (_deductFailed) { craftLocks.delete(key); return; }

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
            var isContainer = isEquipment && (accounts.WEAPON_TYPES[recipe.output.type].slot === 'backpack' || accounts.WEAPON_TYPES[recipe.output.type].slot === 'rig');

            if (isContainer) {
              // Container items (backpacks, rigs) — use dedicated generator
              var containerItem = lootGen.generateContainerItem({ forcedType: recipe.output.type, source: 'craft' });
              if (containerItem) {
                if (craftAccount && craftAccount.username) containerItem.craftedBy = craftAccount.username;
                newItem = containerItem;
              }
            } else if (isEquipment) {
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
            socket.emit('grid_item_added', { item: newItem, rev: (addResult && addResult._gridRev) || 0 });

            // Card: craft_bonus — % chance for a second output item (double craft)
            if (cardCraftBonus > 0 && Math.random() < (cardCraftBonus / 100)) {
              var bonusItem;
              if (isEquipment) {
                bonusItem = lootGen.generateItem(recipe.output.type, accounts.WEAPON_TYPES[recipe.output.type], { source: 'craft', craftSkillLevel: _eqSkillLevel, luckBonus: _eqLuck });
                if (newItem.maxDurability) { bonusItem.maxDurability = newItem.maxDurability; bonusItem.durability = newItem.maxDurability; }
              } else {
                bonusItem = { id: generateItemId(), type: newItem.type, name: newItem.name, data: {} };
                if (newItem.maxDurability) { bonusItem.maxDurability = newItem.maxDurability; bonusItem.durability = newItem.maxDurability; }
              }
              if (craftAccount && craftAccount.username) bonusItem.craftedBy = craftAccount.username;
              var bonusAddRes = accounts.addMMOItem(key, bonusItem);
              if (bonusAddRes && !bonusAddRes.error) {
                socket.emit('grid_item_added', { item: bonusItem, rev: (bonusAddRes && bonusAddRes._gridRev) || 0 });
              }
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
            var qAcc = craftAccount;
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
        var foodAccount = accounts.loadAccount(key);
        if (!foodAccount) return;

        // --- Check player has at least 1 of this food ---
        var mmoInv = foodAccount.mmoInventory || {};
        if ((mmoInv[resourceType] || 0) < 1) {
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
        var foodBonuses = rpgData.getCraftingSkillBonuses(foodAccount);
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

        // Remove item from inventory (also removes from grid)
        accounts.removeMMOItem(key, data.itemId);

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

        // Deduct the gem resource first (before mutating item)
        var gemRemoved = accounts.removeResource(key, data.gemType, 1);
        if (gemRemoved === null) { socket.emit('craft_error', { message: 'Failed to deduct gem' }); return; }

        // Apply the gem to the item
        acc = accounts.loadAccount(key);
        if (!acc) return;
        var result = lootGen.socketGem(item, data.gemType);
        if (result.error) { socket.emit('craft_error', { message: result.error }); return; }

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
        var _mgKey = pending.account_key;
        if (Date.now() > pending.expiresAt) {
          craftLocks.delete(_mgKey);
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
        if (!recipe) { craftLocks.delete(_mgKey); return; }
        var qualityTier = QUALITY_TIERS[quality] || QUALITY_TIERS.normal;
        var key = pending.account_key;
        var output = {
          id: generateItemId(),
          type: recipe.output.type,
          name: qualityTier.name + ' ' + recipe.output.name,
          quality: quality,
          qualityMultiplier: qualityTier.multiplier,
        };
        if (recipe.output.quantity) output.quantity = recipe.output.quantity;
        // Add to inventory via addMMOItem (weight-checked + grid placement)
        var addResult = accounts.addMMOItem(key, output);
        if (addResult && addResult.error) {
          socket.emit('craft_error', { message: addResult.error });
          craftLocks.delete(key);
          return;
        }
        craftLocks.delete(key);
        socket.emit('craft_result', {
          success: true,
          recipeId: pending.recipeId,
          item: output,
          quality: quality,
          inventory: accounts.getMMOInventory(key),
        });
      } catch (err) {
        if (_mgKey) craftLocks.delete(_mgKey);
        console.error('[craft_minigame_result] Error:', err.message);
        socket.emit('craft_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // Disconnect cleanup: release pending minigame state + craft lock
    // ------------------------------------------------------------------
    socket.on('disconnect', function() {
      var pending = pendingMinigames.get(socket.id);
      if (pending) {
        pendingMinigames.delete(socket.id);
        craftLocks.delete(pending.account_key);
      }
    });
  },
};
