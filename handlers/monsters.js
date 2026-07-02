// handlers/monsters.js
// Monster collection, roster management, evolution.
// Overworld monster spawning, combat, and despawning.

var worldgen = require('../worldgen');
var dungeonCombat = require('../dungeon-combat');
var dungeonData = require('../dungeon-data');
var rpgData = require('../rpg-data');
var masteryCore = require('../mastery/mastery-core');
var corpseLoot = require('./corpse-loot');
var questAdlib = require('../quest-adlib');
var spawner = require('../overworld-monster-spawner');

var BIOME_ELEMENT_MAP = spawner.BIOME_ELEMENT_MAP;
var OVERWORLD_MONSTERS = spawner.OVERWORLD_MONSTERS;
var ATTACK_RANGE_PX = spawner.ATTACK_RANGE_PX;
var monsterToClient = spawner.monsterToClient;
var getTimeMultipliers = spawner.getTimeMultipliers;

// Patrol system constants (used by patrol/chase logic)
var PATROL_INTERVAL_MS = 2000;
var PATROL_WANDER_RADIUS = 200;
var PATROL_SPEED_PX_S = 40;
var PATROL_IDLE_MIN_MS = 3000;
var PATROL_IDLE_MAX_MS = 8000;
var CHASE_RANGE_PX = 150;
var CHASE_SPEED_PX_S = 60;
var CHASE_LEASH_PX = 350;

// ---------------------------------------------------------------------------
// Module-level references set during first init call
// ---------------------------------------------------------------------------

var _io = null;
var _state = null;
var _accounts = null;
var _socketAccountMap = null;
var _serverRules = null;
var _spawnTimerStarted = false;
var _attackCooldowns = new Map(); // socketId -> timestamp
var _overworldCombatPlayers = new Map(); // socketId -> { monsterId, zoneId, combatId }

// ---------------------------------------------------------------------------
// Spawn ticker — runs globally once, not per-socket
// ---------------------------------------------------------------------------

function startSpawnTicker() {
  if (_spawnTimerStarted) return;
  _spawnTimerStarted = true;

  var spawnIntervalMs = spawner.SPAWN_INTERVAL_MS;

  setInterval(function() {
    try {
      spawner.runSpawnCycle();
      spawner.runDespawnCycle();
    } catch (err) {
      console.error('[monsters] Spawn tick error:', err.message);
    }
  }, spawnIntervalMs).unref();

  // Patrol ticker — monster movement AI
  setInterval(function() {
    try {
      runPatrolCycle();
    } catch (err) {
      console.error('[monsters] Patrol tick error:', err.message);
    }
  }, PATROL_INTERVAL_MS).unref();

  console.log('[monsters] Overworld spawn ticker started (' + spawnIntervalMs + 'ms interval)');
  console.log('[monsters] Patrol ticker started (' + PATROL_INTERVAL_MS + 'ms interval)');
}


// ---------------------------------------------------------------------------
// Auto-engage combat — called by patrol tick when monster catches a player
// Mirrors zone_combat_engage but runs outside a socket handler scope.
// ---------------------------------------------------------------------------

function _engageMonsterCombat(io, monster, playerSocketId, zoneId) {
  // Look up player socket
  var playerSocket = io.sockets.sockets.get(playerSocketId);
  if (!playerSocket) return;

  // Prevent double-engagement
  if (_overworldCombatPlayers.has(playerSocketId)) return;
  if (dungeonCombat.getCombatBySocketId(playerSocketId)) return;
  if (monster.inCombat || !monster.alive) return;

  var zone = _state.zones.get(zoneId);
  if (!zone || !zone.chunkCache) return;

  var pos = _state.playerPositions.get(playerSocketId);
  if (!pos) return;

  var accKey = _socketAccountMap.get(playerSocketId);
  if (!accKey) return;

  var acc = _accounts.loadAccount(accKey);
  if (!acc) return;

  // Biome from monster position
  var biomeId = 6;
  if (worldgen.getBiomeAtPixel) {
    biomeId = worldgen.getBiomeAtPixel(monster.x, monster.y);
    if (biomeId === null || biomeId === undefined) biomeId = 6;
  }

  var arena = dungeonData.generateOverworldArena(biomeId, monster.id);

  // Build player combat state
  var computed = rpgData.computeStats(acc.rpgStats || rpgData.getDefaultStats(), acc.level || 1, acc.race);

  var equippedCardObjects = [];
  if (acc.rpgCards && Array.isArray(acc.rpgCards) && acc.equippedCards && Array.isArray(acc.equippedCards)) {
    var _cardMap = {};
    for (var cm = 0; cm < acc.rpgCards.length; cm++) {
      if (acc.rpgCards[cm] && acc.rpgCards[cm].instanceId) {
        _cardMap[acc.rpgCards[cm].instanceId] = acc.rpgCards[cm];
      }
    }
    for (var ce = 0; ce < acc.equippedCards.length; ce++) {
      var _cid = acc.equippedCards[ce];
      if (_cid && _cardMap[_cid]) equippedCardObjects.push(_cardMap[_cid]);
    }
  }

  var bonusHp = 0, bonusCrit = 0, bonusDodge = 0, bonusMeleeDmg = 0, bonusMagicDmg = 0;
  var bonusDungeonDmg = 0, bonusBossDmg = 0, bonusDungeonDef = 0;
  for (var ci = 0; ci < equippedCardObjects.length; ci++) {
    var card = equippedCardObjects[ci];
    if (!card || !card.effects) continue;
    for (var ei = 0; ei < card.effects.length; ei++) {
      var eff = card.effects[ei];
      if (eff.type === 'hp_bonus') bonusHp += (eff.value || 0);
      if (eff.type === 'crit_bonus') bonusCrit += (eff.value || 0);
      if (eff.type === 'dodge_bonus') bonusDodge += (eff.value || 0);
      if (eff.type === 'melee_damage_bonus') {
        var val = (acc.race && eff.raceValue && acc.race === (card.raceBonus || '')) ? eff.raceValue : (eff.value || 0);
        bonusMeleeDmg += val;
      }
      if (eff.type === 'dungeon_damage_bonus') bonusDungeonDmg += (eff.value || 0);
      if (eff.type === 'boss_damage_bonus') bonusBossDmg += (eff.value || 0);
      if (eff.type === 'dungeon_def_bonus') bonusDungeonDef += (eff.value || 0);
      if (eff.type === 'stat_boost_all') bonusHp += (eff.value || 0) * 10;
    }
  }

  var maxHp = computed.hp + bonusHp;
  var handStats = _accounts.getEquippedHandStats ? _accounts.getEquippedHandStats(accKey) : { mainHand: null, offHand: null };
  var mh = handStats.mainHand;
  var oh = handStats.offHand;
  var weaponDamage = mh ? (mh.damage || 0) : 0;
  var weaponMagicDamage = mh ? (mh.magicDamage || 0) : 0;
  var weaponCategory = mh ? (mh.category || 'melee_blade') : 'melee_blade';
  var weaponRange = mh ? (mh.range || 1.5) : 1.5;
  var weaponSpeed = mh ? (mh.speed || 1.0) : 1.0;
  var blockChance = 0;
  var offHandDefense = 0;
  if (oh) {
    if (oh.slot === 'shield' || oh.defense) {
      blockChance = oh.blockChance || 0;
      offHandDefense = oh.defense || 0;
    }
  }
  var armorStats = _accounts.getEquippedArmorStats ? _accounts.getEquippedArmorStats(accKey) : { totalDefense: 0, totalMagicResist: 0, totalMagicDamage: 0, totalCritBonus: 0, totalSpeedMod: 0 };
  var armorTotal = armorStats.totalDefense + offHandDefense;

  var combatSkillBonuses = rpgData.getCombatSkillBonuses(acc.skills, weaponCategory);
  var combatMastery = masteryCore.getSkillMasteryBonuses(acc, weaponCategory);

  var armorType = 'none';
  if (acc.equipment && acc.equipment.chest && acc.mmoInventory && acc.mmoInventory.items) {
    var bodyItem = acc.mmoInventory.items.find(function(it) { return it.id === acc.equipment.chest; });
    if (bodyItem) {
      var bodyType = bodyItem.type || '';
      if (bodyType.indexOf('leather') >= 0) armorType = 'leather';
      else if (bodyType.indexOf('cloth') >= 0 || bodyType.indexOf('robe') >= 0) armorType = 'cloth';
      else if (bodyType.indexOf('mithril') >= 0 || bodyType.indexOf('plate') >= 0 || bodyType.indexOf('steel') >= 0 || bodyType.indexOf('iron') >= 0 || bodyType.indexOf('gold') >= 0 || bodyType.indexOf('silver') >= 0) armorType = 'plate';
      else if (bodyType.indexOf('bronze') >= 0 || bodyType.indexOf('copper') >= 0 || bodyType.indexOf('chain') >= 0 || bodyType.indexOf('mail') >= 0) armorType = 'chain';
    }
  }

  var combat = {
    hp: maxHp,
    maxHp: maxHp,
    mana: 50 + ((acc.rpgStats || {}).acumen || 5) * 5,
    maxMana: 50 + ((acc.rpgStats || {}).acumen || 5) * 5,
    critChance: computed.critChance + bonusCrit + (combatSkillBonuses.critBonus || 0) + armorStats.totalCritBonus + (combatMastery.crit_chance_pct || 0),
    dodgeChance: computed.dodgeChance + bonusDodge,
    meleeDmgMult: computed.meleeDamageMultiplier + bonusMeleeDmg + (combatSkillBonuses.damageBonus || 0) + (combatMastery.damage_pct || 0),
    magicDmgMult: computed.magicPowerMultiplier + bonusMagicDmg + (combatMastery.spell_damage_pct || 0),
    dungeonDmgBonus: bonusDungeonDmg,
    bossDmgBonus: bonusBossDmg,
    dungeonDefBonus: bonusDungeonDef,
    hpRegen: computed.hpRegen,
    baseArmor: computed.baseArmor + armorTotal,
    magicResist: (computed.magicResist || 0) + armorStats.totalMagicResist,
    armorType: armorType,
    weaponDamage: weaponDamage,
    weaponMagicDamage: weaponMagicDamage + armorStats.totalMagicDamage,
    weaponCategory: weaponCategory,
    weaponRange: weaponRange,
    weaponSpeed: weaponSpeed,
    blockChance: blockChance,
  };

  var players = [{
    socketId: playerSocketId,
    x: arena.entranceX,
    y: arena.entranceY,
    name: acc.username || 'Player',
    race: acc.race,
    rpgStats: acc.rpgStats || rpgData.getDefaultStats(),
    level: acc.level || 1,
    equippedCards: equippedCardObjects,
    combat: combat,
  }];

  var archetype = dungeonData.inferArchetype(monster);
  var enemyDefaults = dungeonData.ENEMY_DEFAULTS[archetype] || dungeonData.ENEMY_DEFAULTS.bruiser;
  var monsterElement = monster.element || (BIOME_ELEMENT_MAP[biomeId] || null);
  var enemies = [{
    id: monster.id,
    name: monster.name,
    hp: monster.hp,
    maxHp: monster.maxHp,
    atk: monster.atk,
    def: monster.def,
    speed: 8 + (monster.level || 1),
    xp: monster.xp,
    gold: monster.goldDrop,
    archetype: archetype,
    abilities: enemyDefaults.abilities || [],
    x: arena.enemyX,
    y: arena.enemyY,
    lootTable: monster.possibleLoot,
    element: monsterElement,
    alive: true,
  }];

  var arenaFloor = {
    grid: arena.grid,
    rooms: arena.rooms,
    width: arena.width,
    height: arena.height,
  };

  // Capture references for callbacks closure
  var capturedZoneId = zoneId;
  var capturedMonsterId = monster.id;
  var capturedMonster = monster;
  var capturedAccKey = accKey;
  var capturedSocketId = playerSocketId;
  var capturedArenaGrid = arena.grid;
  var capturedArenaTheme = arena.themeColors;

  var callbacks = {
    broadcastToFloor: function(event, eventData) {
      if (event === 'tc_combat_start') {
        var playerUnitId = 'player_' + capturedSocketId;
        var enriched = {};
        for (var k in eventData) { enriched[k] = eventData[k]; }
        enriched.myUnitId = playerUnitId;
        enriched.arenaGrid = capturedArenaGrid;
        enriched.arenaTheme = capturedArenaTheme;
        var targetSocket = io.sockets.sockets.get(capturedSocketId);
        if (targetSocket) targetSocket.emit(event, enriched);
      } else if (event === 'tc_combat_end') {
        var result = eventData.result;
        var targetSock = io.sockets.sockets.get(capturedSocketId);

        if (result === 'victory') {
          var victoryAcc = _accounts.loadAccount(capturedAccKey);
          if (!victoryAcc) return;
          var xpRate = (_serverRules && _serverRules.xpRate) ? _serverRules.xpRate : undefined;
          var xpResult = _accounts.addSkillXp(capturedAccKey, 'melee', capturedMonster.xp, xpRate, victoryAcc);

          // Monster XP: award XP to player's active monster
          try {
            if (victoryAcc.monsters && victoryAcc.activeParty && victoryAcc.activeParty.length > 0) {
              var activeMonId = victoryAcc.activeParty[0];
              var activeMon = victoryAcc.monsters.find(function(m) { return m.instanceId === activeMonId; });
              if (activeMon) {
                if (!activeMon.xp) activeMon.xp = 0;
                if (!activeMon.level) activeMon.level = 1;
                activeMon.xp += capturedMonster.xp;
                var monXpNeeded = Math.floor(50 * Math.pow(activeMon.level, 1.5));
                while (activeMon.xp >= monXpNeeded && activeMon.level < 100) {
                  activeMon.xp -= monXpNeeded;
                  activeMon.level++;
                  if (activeMon.baseHp) activeMon.baseHp = Math.round(activeMon.baseHp * 1.03);
                  if (activeMon.baseAtk) activeMon.baseAtk = Math.round(activeMon.baseAtk * 1.03);
                  if (activeMon.baseDef) activeMon.baseDef = Math.round(activeMon.baseDef * 1.03);
                  activeMon.maxHp = activeMon.baseHp;
                  activeMon.hp = activeMon.maxHp;
                  monXpNeeded = Math.floor(50 * Math.pow(activeMon.level, 1.5));
                }
                _accounts.saveAccount(victoryAcc);
              }
            }
          } catch (monXpErr) {
            console.error('[overworld_combat] Monster XP error:', monXpErr.message);
          }

          // Phantom Skill XP: skinning for beast-type, anatomy for all kills
          var _owBeastPattern = /wolf|bear|boar|spider|lizard|bat|crab|scorpion|viper|raptor|toad|beetle|hound|drake|serpent|worm|ape|bird|insect|crawler|goat|imp|hawk/i;
          if (capturedMonster.name && _owBeastPattern.test(capturedMonster.name)) {
            _accounts.addSkillXp(capturedAccKey, 'skinning', 10 + Math.floor(Math.random() * 11), xpRate, victoryAcc);
          }
          _accounts.addSkillXp(capturedAccKey, 'anatomy', 3, xpRate, victoryAcc);

          // Gold
          var goldAmount = capturedMonster.goldDrop;
          if (goldAmount > 0) _accounts.updateChips(capturedAccKey, goldAmount);

          // Loot
          var lootDropped = [];
          if (capturedMonster.possibleLoot && capturedMonster.possibleLoot.length > 0) {
            for (var li = 0; li < capturedMonster.possibleLoot.length; li++) {
              var loot = capturedMonster.possibleLoot[li];
              if (Math.random() < loot.chance) {
                var addResult = _accounts.addResource(capturedAccKey, loot.type, loot.amount);
                if (addResult) {
                  var itemName = loot.type.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
                  lootDropped.push({ type: loot.type, name: itemName, amount: loot.amount });
                }
              }
            }
          }

          // Remove monster from zone
          capturedMonster.alive = false;
          capturedMonster.hp = 0;
          capturedMonster.inCombat = false;
          var mList = _state.zoneMonsters.get(capturedZoneId);
          if (mList) {
            for (var ri = mList.length - 1; ri >= 0; ri--) {
              if (mList[ri].id === capturedMonsterId) { mList.splice(ri, 1); break; }
            }
          }
          io.to('zone:' + capturedZoneId).emit('zone_monster_died', { id: capturedMonsterId });

          if (targetSock) {
            targetSock.emit('zone_monster_killed', {
              id: capturedMonsterId,
              name: capturedMonster.name,
              xp: capturedMonster.xp,
              gold: goldAmount,
              loot: lootDropped,
              skillLevel: xpResult ? xpResult.level : 1,
              skillXp: xpResult ? xpResult.xp : 0,
              xpNeeded: xpResult ? xpResult.xpNeeded : 100,
              leveledUp: xpResult ? xpResult.leveledUp : false,
              overallLevel: xpResult ? xpResult.overallLevel : 1,
              overallLeveledUp: xpResult ? xpResult.overallLeveledUp : false,
              pendingPacks: xpResult ? xpResult.pendingPacks : 0,
            });
          }

          // Quest progress
          try {
            var qAcc = _accounts.loadAccount(capturedAccKey);
            if (qAcc && qAcc.questProgress && qAcc.questProgress.active) {
              var qChanged = false;
              for (var qi = 0; qi < qAcc.questProgress.active.length; qi++) {
                var quest = qAcc.questProgress.active[qi];
                var tmpl = rpgData.WORLD_QUEST_TEMPLATES ? rpgData.WORLD_QUEST_TEMPLATES.find(function(t) { return t.questId === quest.questId; }) : null;
                if (!tmpl) tmpl = questAdlib.getGeneratedQuest(quest.questId);
                if (tmpl && tmpl.type === 'kill' && (tmpl.target.monster === capturedMonster.baseId || tmpl.target.monster === capturedMonster.templateId)) {
                  quest.progress = Math.min(quest.progress + 1, quest.targetCount);
                  qChanged = true;
                  if (targetSock) {
                    targetSock.emit('quest_progress', { questId: quest.questId, progress: quest.progress, targetCount: quest.targetCount, complete: quest.progress >= quest.targetCount });
                  }
                }
              }
              if (qChanged) _accounts.saveAccount(qAcc);
            }
          } catch (qErr) { /* non-fatal */ }

          // Durability
          try {
            var durAcc = _accounts.loadAccount(capturedAccKey);
            if (durAcc && durAcc.equipment) {
              var durCardEffects = _accounts.getEquippedCardEffects ? _accounts.getEquippedCardEffects(capturedAccKey) : [];
              var durWarnings = [];
              var owWepResults = _accounts.reduceWeaponDurability(durAcc, 0.01, durCardEffects);
              if (owWepResults) { for (var owwi = 0; owwi < owWepResults.length; owwi++) durWarnings.push(owWepResults[owwi]); }
              var owArmorResults = _accounts.reduceArmorDurability(durAcc, 0.005, durCardEffects);
              for (var owdi = 0; owdi < owArmorResults.length; owdi++) durWarnings.push(owArmorResults[owdi]);
              _accounts.saveAccount(durAcc);
              if (targetSock) {
                for (var dwi = 0; dwi < durWarnings.length; dwi++) {
                  if (durWarnings[dwi].broken) {
                    targetSock.emit('item_broken', { slot: durWarnings[dwi].slot, itemName: durWarnings[dwi].itemName });
                  } else if (durWarnings[dwi].lowDurability) {
                    targetSock.emit('durability_warning', { slot: durWarnings[dwi].slot, itemName: durWarnings[dwi].itemName, durability: durWarnings[dwi].durability, maxDurability: durWarnings[dwi].maxDurability });
                  }
                }
              }
            }
          } catch (owDurErr) {
            console.error('[overworld_combat] Durability error:', owDurErr.message);
          }
        } else {
          // Defeat: restore monster
          capturedMonster.hp = capturedMonster.maxHp;
          capturedMonster.inCombat = false;
        }

        _overworldCombatPlayers.delete(capturedSocketId);
        if (targetSock) targetSock.emit(event, eventData);
      } else {
        var sock = io.sockets.sockets.get(capturedSocketId);
        if (sock) sock.emit(event, eventData);
      }
    },

    emitToPlayer: function(socketId, event, eventData) {
      var targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) targetSocket.emit(event, eventData);
    },

    awardKillRewards: function() {
      // Handled in broadcastToFloor tc_combat_end
    },

    handleDeath: function() {
      // Handled in broadcastToFloor tc_combat_end defeat path
    },

    getPlayerInfo: function(socketId) {
      var pAccKey = _socketAccountMap.get(socketId);
      if (!pAccKey) return null;
      var pAcc = _accounts.loadAccount(pAccKey);
      if (!pAcc) return null;
      return {
        accKey: pAccKey,
        race: pAcc.race,
        rpgStats: pAcc.rpgStats || rpgData.getDefaultStats(),
        level: pAcc.level || 1,
        equippedCards: pAcc.equippedCards || [],
        name: pAcc.username || 'Player',
      };
    },
  };

  // Mark in-combat
  monster.inCombat = true;
  var overworldDungeonId = 'overworld_' + monster.id + '_' + Date.now();
  _overworldCombatPlayers.set(playerSocketId, {
    monsterId: monster.id,
    zoneId: zoneId,
    dungeonId: overworldDungeonId,
  });

  // Start combat
  dungeonCombat.initCombat(overworldDungeonId, players, enemies, arenaFloor, callbacks);
}

// ---------------------------------------------------------------------------
// Patrol AI — monster wandering, chasing, and leashing
// ---------------------------------------------------------------------------

function runPatrolCycle() {
  var now = Date.now();
  var zones = _state.zones;

  for (var entry of zones) {
    var zoneId = entry[0];
    var zone = entry[1];
    if (!zone.chunkCache) continue;
    if (zone.members.size === 0) continue;

    var monsterList = _state.zoneMonsters.get(zoneId);
    if (!monsterList || monsterList.length === 0) continue;

    // Collect player positions in this zone
    var zonePlayers = [];
    for (var sid of zone.members) {
      var ppos = _state.playerPositions.get(sid);
      if (ppos) zonePlayers.push({ sid: sid, x: ppos.x, y: ppos.y });
    }

    var positionUpdates = [];
    var stepPx = PATROL_SPEED_PX_S * (PATROL_INTERVAL_MS / 1000);
    var chaseStepPx = CHASE_SPEED_PX_S * (PATROL_INTERVAL_MS / 1000);

    for (var mi = 0; mi < monsterList.length; mi++) {
      var m = monsterList[mi];
      if (!m.alive || m.inCombat) continue;

      var moved = false;

      // --- Check for nearby players to chase ---
      if (m.patrolMode !== 'chase') {
        var closestPlayer = null;
        var _aggroMult = getTimeMultipliers().aggroRange;
        var _effectiveChaseRange = CHASE_RANGE_PX * _aggroMult;
        var closestDistSq = _effectiveChaseRange * _effectiveChaseRange;
        for (var pi = 0; pi < zonePlayers.length; pi++) {
          var p = zonePlayers[pi];
          // Don't chase players already in combat
          if (_overworldCombatPlayers.has(p.sid)) continue;
          var cdx = p.x - m.x;
          var cdy = p.y - m.y;
          var cdistSq = cdx * cdx + cdy * cdy;
          if (cdistSq < closestDistSq) {
            closestDistSq = cdistSq;
            closestPlayer = p;
          }
        }
        if (closestPlayer) {
          m.patrolMode = 'chase';
          m.chaseTargetSid = closestPlayer.sid;
          m.patrolTargetX = null;
          m.patrolTargetY = null;
        }
      }

      // --- State machine ---
      if (m.patrolMode === 'idle') {
        if (now >= m.idleUntil) {
          // Pick a random wander target near spawn
          var angle = Math.random() * Math.PI * 2;
          var dist = 30 + Math.random() * (PATROL_WANDER_RADIUS - 30);
          var wx = m.spawnX + Math.cos(angle) * dist;
          var wy = m.spawnY + Math.sin(angle) * dist;

          // Check walkability
          if (worldgen.isWalkable && !worldgen.isWalkable(wx, wy, null)) {
            // Try again next tick
            m.idleUntil = now + 1000;
          } else {
            m.patrolMode = 'wander';
            m.patrolTargetX = wx;
            m.patrolTargetY = wy;
          }
        }
      } else if (m.patrolMode === 'wander') {
        // Move toward wander target
        var wdx = m.patrolTargetX - m.x;
        var wdy = m.patrolTargetY - m.y;
        var wdist = Math.sqrt(wdx * wdx + wdy * wdy);

        if (wdist <= stepPx) {
          // Arrived at target
          m.x = Math.round(m.patrolTargetX);
          m.y = Math.round(m.patrolTargetY);
          m.patrolMode = 'idle';
          m.idleUntil = now + PATROL_IDLE_MIN_MS + Math.random() * (PATROL_IDLE_MAX_MS - PATROL_IDLE_MIN_MS);
          m.patrolTargetX = null;
          m.patrolTargetY = null;
          moved = true;
        } else {
          // Step toward target
          var wnx = wdx / wdist;
          var wny = wdy / wdist;
          var wnewX = Math.round(m.x + wnx * stepPx);
          var wnewY = Math.round(m.y + wny * stepPx);
          if (!worldgen.isWalkable || worldgen.isWalkable(wnewX, wnewY, null)) {
            m.x = wnewX;
            m.y = wnewY;
            moved = true;
          } else {
            // Blocked by terrain, pick new wander target
            m.patrolMode = 'idle';
            m.idleUntil = now + PATROL_IDLE_MIN_MS;
            m.patrolTargetX = null;
            m.patrolTargetY = null;
          }
        }
      } else if (m.patrolMode === 'chase') {
        // Find chase target position
        var targetPos = null;
        if (m.chaseTargetSid) {
          targetPos = _state.playerPositions.get(m.chaseTargetSid);
          // Also verify player is still in this zone
          var targetZone = _state.playerZones.get(m.chaseTargetSid);
          if (targetZone !== zoneId) targetPos = null;
          // Don't chase players already in combat
          if (_overworldCombatPlayers.has(m.chaseTargetSid)) targetPos = null;
        }

        if (!targetPos) {
          // Target lost, return to spawn
          m.patrolMode = 'returning';
          m.chaseTargetSid = null;
          m.patrolTargetX = m.spawnX;
          m.patrolTargetY = m.spawnY;
        } else {
          // Check leash distance from spawn
          var ldx = m.x - m.spawnX;
          var ldy = m.y - m.spawnY;
          if (ldx * ldx + ldy * ldy > CHASE_LEASH_PX * CHASE_LEASH_PX) {
            // Leashed, return to spawn
            m.patrolMode = 'returning';
            m.chaseTargetSid = null;
            m.patrolTargetX = m.spawnX;
            m.patrolTargetY = m.spawnY;
          } else {
            // Move toward player
            var chdx = targetPos.x - m.x;
            var chdy = targetPos.y - m.y;
            var chdist = Math.sqrt(chdx * chdx + chdy * chdy);

            if (chdist > CHASE_RANGE_PX * 2.5) {
              // Player ran far, give up
              m.patrolMode = 'returning';
              m.chaseTargetSid = null;
              m.patrolTargetX = m.spawnX;
              m.patrolTargetY = m.spawnY;
            } else if (chdist <= ATTACK_RANGE_PX && m.chaseTargetSid && !m.inCombat) {
              // Monster caught the player — auto-engage combat
              var engageTarget = m.chaseTargetSid;
              m.patrolMode = 'idle';
              m.chaseTargetSid = null;
              _engageMonsterCombat(_io, m, engageTarget, zoneId);
            } else if (chdist > 5) {
              var cnx = chdx / chdist;
              var cny = chdy / chdist;
              var cnewX = Math.round(m.x + cnx * chaseStepPx);
              var cnewY = Math.round(m.y + cny * chaseStepPx);
              if (!worldgen.isWalkable || worldgen.isWalkable(cnewX, cnewY, null)) {
                m.x = cnewX;
                m.y = cnewY;
                moved = true;
              } else {
                // Blocked by terrain, stop chasing
                m.patrolMode = 'returning';
                m.chaseTargetSid = null;
                m.patrolTargetX = m.spawnX;
                m.patrolTargetY = m.spawnY;
              }
            }
          }
        }
      } else if (m.patrolMode === 'returning') {
        // Move back toward spawn
        var rdx = m.patrolTargetX - m.x;
        var rdy = m.patrolTargetY - m.y;
        var rdist = Math.sqrt(rdx * rdx + rdy * rdy);

        if (rdist <= chaseStepPx) {
          m.x = Math.round(m.spawnX);
          m.y = Math.round(m.spawnY);
          m.patrolMode = 'idle';
          m.idleUntil = now + PATROL_IDLE_MIN_MS;
          m.patrolTargetX = null;
          m.patrolTargetY = null;
          moved = true;
        } else {
          var rnx = rdx / rdist;
          var rny = rdy / rdist;
          var rnewX = Math.round(m.x + rnx * chaseStepPx);
          var rnewY = Math.round(m.y + rny * chaseStepPx);
          if (!worldgen.isWalkable || worldgen.isWalkable(rnewX, rnewY, null)) {
            m.x = rnewX;
            m.y = rnewY;
            moved = true;
          } else {
            // Blocked returning, snap to spawn
            m.x = Math.round(m.spawnX);
            m.y = Math.round(m.spawnY);
            m.patrolMode = 'idle';
            m.idleUntil = now + PATROL_IDLE_MIN_MS;
            moved = true;
          }
        }
      }

      if (moved) {
        positionUpdates.push({ id: m.id, x: m.x, y: m.y, patrolMode: m.patrolMode });
      }
    }

    // Broadcast position updates for this zone
    if (positionUpdates.length > 0) {
      _io.to('zone:' + zoneId).emit('zone_monster_positions', { monsters: positionUpdates });
    }
  }
}

// ---------------------------------------------------------------------------
// Combat calculation helpers
// ---------------------------------------------------------------------------

function calculatePlayerDamage(acc) {
  var might = 5; // default
  if (acc.rpgStats && typeof acc.rpgStats.might === 'number') {
    might = acc.rpgStats.might;
  }
  // baseDamage = 5 + (might * 2)
  var baseDamage = 5 + (might * 2);
  return baseDamage;
}

function calculateMonsterDamage(monster, acc) {
  var playerDef = 0;
  if (acc.rpgStats && typeof acc.rpgStats.vigor === 'number') {
    // Armor-like reduction from vigor: each point gives ~0.5 def
    playerDef = Math.floor(acc.rpgStats.vigor * 0.5);
  }
  var damage = Math.max(1, monster.atk - playerDef);
  return damage;
}

// ---------------------------------------------------------------------------
// Handler module
// ---------------------------------------------------------------------------

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, checkEventRate, applyRateGrace, state } = deps;

    // Store module-level references for the spawn ticker (only set once)
    if (!_io) _io = io;
    if (!_state) _state = state;
    if (!_accounts) _accounts = accounts;
    if (!_socketAccountMap) _socketAccountMap = socketAccountMap;
    if (!_serverRules) _serverRules = (deps.serverRules) ? deps.serverRules : null;

    spawner.init({ io: io, state: state, corpseLoot: corpseLoot });

    // Start the global spawn ticker on first handler init
    startSpawnTicker();

    // --- monster_list: get player's monster roster ---
    socket.on('monster_list', function() {

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      socket.emit('monster_roster', {
        monsters: acc.monsters || [],
        activeParty: acc.activeParty || [],
      });
    });

    // --- monster_set_active: set active party of up to 6 ---
    socket.on('monster_set_active', function(data) {
      if (!data || !Array.isArray(data.monsterIds)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      // Validate all IDs exist in roster and limit to 6
      var monsters = acc.monsters || [];
      var validIds = [];
      for (var i = 0; i < Math.min(data.monsterIds.length, 6); i++) {
        var id = data.monsterIds[i];
        var found = monsters.find(function(m) { return m.instanceId === id; });
        if (found) validIds.push(id);
      }

      if (validIds.length === 0) {
        socket.emit('monster_error', { message: 'No valid monsters selected' });
        return;
      }

      acc.activeParty = validIds;
      accounts.saveAccount(acc);

      socket.emit('monster_party_updated', {
        activeParty: validIds,
      });
    });

    // --- monster_evolve: evolve a monster if conditions met ---
    socket.on('monster_evolve', function(data) {
      if (!data || typeof data.monsterId !== 'string') return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      var monsters = acc.monsters || [];
      var monster = monsters.find(function(m) { return m.instanceId === data.monsterId; });
      if (!monster) {
        socket.emit('monster_error', { message: 'Monster not found' });
        return;
      }

      // Look up base definition for evolution data
      var baseDef = OVERWORLD_MONSTERS.find(function(m) { return m.id === monster.baseId; });
      if (!baseDef || !baseDef.evolvesTo) {
        socket.emit('monster_evolve_result', { monsterId: data.monsterId, success: false, message: 'This monster cannot evolve.' });
        return;
      }

      // Check level requirement
      if ((monster.level || 1) < baseDef.evolveLevel) {
        socket.emit('monster_evolve_result', { monsterId: data.monsterId, success: false,
          message: 'Requires level ' + baseDef.evolveLevel + ' (current: ' + (monster.level || 1) + ')' });
        return;
      }

      // Check item requirement
      if (baseDef.evolveItem) {
        var inv = acc.mmoInventory || {};
        if ((inv[baseDef.evolveItem] || 0) < 1) {
          var itemName = baseDef.evolveItem.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
          socket.emit('monster_evolve_result', { monsterId: data.monsterId, success: false,
            message: 'Requires 1 ' + itemName });
          return;
        }
        // Consume item
        accounts.removeResource(key, baseDef.evolveItem, 1);
      }

      // Look up evolved form
      var evolvedDef = OVERWORLD_MONSTERS.find(function(m) { return m.id === baseDef.evolvesTo; });
      if (!evolvedDef) {
        socket.emit('monster_evolve_result', { monsterId: data.monsterId, success: false, message: 'Evolved form data not found.' });
        return;
      }

      // Transform monster
      var oldName = monster.name;
      monster.baseId = evolvedDef.id;
      monster.name = evolvedDef.name;
      // Scale stats: +20% on top of evolved base
      monster.baseHp = Math.round(evolvedDef.hp * 1.2);
      monster.baseAtk = Math.round(evolvedDef.atk * 1.2);
      monster.baseDef = Math.round(evolvedDef.def * 1.2);
      monster.hp = monster.baseHp;
      monster.maxHp = monster.baseHp;
      monster.evolved = true;

      accounts.saveAccount(acc);

      socket.emit('monster_evolve_result', {
        monsterId: data.monsterId,
        success: true,
        oldName: oldName,
        newName: evolvedDef.name,
        monster: {
          instanceId: monster.instanceId,
          baseId: monster.baseId,
          name: monster.name,
          level: monster.level,
          hp: monster.hp,
          maxHp: monster.maxHp,
          baseAtk: monster.baseAtk,
          baseDef: monster.baseDef,
          evolved: true,
        },
      });
    });

    // --- monster_capture: attempt to capture an overworld monster ---
    socket.on('monster_capture', function(data) {
      if (!data || typeof data.monsterId !== 'string') return;
      if (!applyRateGrace(socket, 'monster_capture', 10, 3000)) return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      // Check player has taming_net
      var inv = acc.mmoInventory || {};
      if ((inv['taming_net'] || 0) < 1) {
        socket.emit('monster_error', { message: 'You need a Taming Net to capture monsters.' });
        return;
      }

      // Find the monster in the player's zone
      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;
      var monsterList = state.zoneMonsters.get(zoneId);
      if (!monsterList) {
        socket.emit('monster_error', { message: 'No monsters nearby.' });
        return;
      }

      var monster = null;
      for (var i = 0; i < monsterList.length; i++) {
        if (monsterList[i].id === data.monsterId && monsterList[i].alive) {
          monster = monsterList[i];
          break;
        }
      }
      if (!monster) {
        socket.emit('monster_error', { message: 'Monster not found.' });
        return;
      }

      // Must be below 25% HP
      var hpRatio = monster.hp / monster.maxHp;
      if (hpRatio > 0.25) {
        socket.emit('monster_capture_result', { success: false, monsterId: data.monsterId,
          message: 'Monster is too healthy to capture. Weaken it below 25% HP first.' });
        return;
      }

      // Consume taming net
      accounts.removeResource(key, 'taming_net', 1);

      // Capture chance: 30% base + level advantage bonus
      var playerLevel = acc.level || 1;
      var monsterLevel = monster.level || 1;
      var levelBonus = Math.max(0, (playerLevel - monsterLevel) * 0.03);
      var captureChance = Math.min(0.30 + levelBonus, 0.80); // cap at 80%

      if (Math.random() > captureChance) {
        socket.emit('monster_capture_result', { success: false, monsterId: data.monsterId,
          message: 'The monster broke free!' });
        return;
      }

      // Success! Add monster to player's roster
      if (!acc.monsters) acc.monsters = [];
      var baseDef = OVERWORLD_MONSTERS.find(function(m) { return m.id === monster.baseId || m.id === monster.templateId; });
      var instanceId = 'mon_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      acc.monsters.push({
        instanceId: instanceId,
        baseId: baseDef ? baseDef.id : (monster.baseId || monster.templateId || 'unknown'),
        name: monster.name,
        level: monster.level || 1,
        xp: 0,
        hp: baseDef ? baseDef.hp : monster.maxHp,
        maxHp: baseDef ? baseDef.hp : monster.maxHp,
        baseHp: baseDef ? baseDef.hp : monster.maxHp,
        baseAtk: baseDef ? baseDef.atk : (monster.atk || 5),
        baseDef: baseDef ? baseDef.def : (monster.def || 3),
        capturedAt: Date.now(),
      });
      accounts.saveAccount(acc);

      // Remove monster from zone
      monster.alive = false;
      monster.hp = 0;
      for (var ri = monsterList.length - 1; ri >= 0; ri--) {
        if (monsterList[ri].id === data.monsterId) {
          monsterList.splice(ri, 1);
          break;
        }
      }
      io.to('zone:' + zoneId).emit('zone_monster_died', { id: data.monsterId });

      socket.emit('monster_capture_result', {
        success: true,
        monsterId: data.monsterId,
        monster: {
          instanceId: instanceId,
          baseId: baseDef ? baseDef.id : 'unknown',
          name: monster.name,
          level: monster.level || 1,
        },
        message: 'Captured ' + monster.name + '!',
      });
    });

    // --- monster_rename: rename a monster ---
    socket.on('monster_rename', function(data) {
      if (!data || typeof data.monsterId !== 'string' || typeof data.name !== 'string') return;

      var key = socketAccountMap.get(socket.id);
      if (!key) return;

      var acc = accounts.loadAccount(key);
      if (!acc) return;

      var monsters = acc.monsters || [];
      var monster = monsters.find(function(m) { return m.instanceId === data.monsterId; });
      if (!monster) {
        socket.emit('monster_error', { message: 'Monster not found' });
        return;
      }

      var newName = data.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 20);
      if (newName.length === 0) {
        socket.emit('monster_error', { message: 'Invalid name' });
        return;
      }

      monster.nickname = newName;
      accounts.saveAccount(acc);

      socket.emit('monster_renamed', {
        monsterId: data.monsterId,
        name: newName,
      });
    });

    // =====================================================================
    // Overworld monster combat — FF-style instanced turn-based combat
    // =====================================================================

    // --- zone_combat_engage: initiate turn-based combat with an overworld monster ---
    socket.on('zone_combat_engage', function(data) {
      if (!data || typeof data.monsterId !== 'string') return;

      // Prevent double-engagement
      if (_overworldCombatPlayers.has(socket.id)) {
        socket.emit('zone_attack_error', { message: 'Already in combat' });
        return;
      }

      // Also check if already in dungeon-combat engine combat
      if (dungeonCombat.getCombatBySocketId(socket.id)) {
        socket.emit('zone_attack_error', { message: 'Already in combat' });
        return;
      }

      // Validate player is in a zone
      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;

      var zone = state.zones.get(zoneId);
      if (!zone || !zone.chunkCache) {
        socket.emit('zone_attack_error', { message: 'Cannot attack here' });
        return;
      }

      // Get player position
      var pos = state.playerPositions.get(socket.id);
      if (!pos) return;

      // Find the monster
      var monsterList = state.zoneMonsters.get(zoneId);
      if (!monsterList) return;

      var monster = null;
      for (var i = 0; i < monsterList.length; i++) {
        if (monsterList[i].id === data.monsterId && monsterList[i].alive && !monsterList[i].inCombat) {
          monster = monsterList[i];
          break;
        }
      }

      if (!monster) {
        socket.emit('zone_attack_error', { message: 'Monster not found or already in combat' });
        return;
      }

      // Range check
      var dx = pos.x - monster.x;
      var dy = pos.y - monster.y;
      var distSq = dx * dx + dy * dy;
      if (distSq > ATTACK_RANGE_PX * ATTACK_RANGE_PX) {
        socket.emit('zone_attack_error', { message: 'Too far away' });
        return;
      }

      // Load player account for stats
      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;

      var acc = accounts.loadAccount(accKey);
      if (!acc) return;

      // Determine biome from monster's world position
      var biomeId = 6; // default: PLAINS
      if (worldgen.getBiomeAtPixel) {
        biomeId = worldgen.getBiomeAtPixel(monster.x, monster.y);
        if (biomeId === null || biomeId === undefined) biomeId = 6;
      }

      // Generate arena
      var arena = dungeonData.generateOverworldArena(biomeId, monster.id);

      // Build player combat state (mirroring dungeon.js initPlayerCombatState)
      var computed = rpgData.computeStats(acc.rpgStats || rpgData.getDefaultStats(), acc.level || 1, acc.race);

      // Resolve equipped card IDs to full card objects
      var equippedCardObjects = [];
      if (acc.rpgCards && Array.isArray(acc.rpgCards) && acc.equippedCards && Array.isArray(acc.equippedCards)) {
        var _cardMap = {};
        for (var cm = 0; cm < acc.rpgCards.length; cm++) {
          if (acc.rpgCards[cm] && acc.rpgCards[cm].instanceId) {
            _cardMap[acc.rpgCards[cm].instanceId] = acc.rpgCards[cm];
          }
        }
        for (var ce = 0; ce < acc.equippedCards.length; ce++) {
          var _cid = acc.equippedCards[ce];
          if (_cid && _cardMap[_cid]) equippedCardObjects.push(_cardMap[_cid]);
        }
      }

      // Collect card bonuses
      var bonusHp = 0, bonusCrit = 0, bonusDodge = 0, bonusMeleeDmg = 0, bonusMagicDmg = 0;
      var bonusDungeonDmg = 0, bonusBossDmg = 0, bonusDungeonDef = 0;
      if (equippedCardObjects.length > 0) {
        for (var ci = 0; ci < equippedCardObjects.length; ci++) {
          var card = equippedCardObjects[ci];
          if (!card || !card.effects) continue;
          for (var ei = 0; ei < card.effects.length; ei++) {
            var eff = card.effects[ei];
            if (eff.type === 'hp_bonus') bonusHp += (eff.value || 0);
            if (eff.type === 'crit_bonus') bonusCrit += (eff.value || 0);
            if (eff.type === 'dodge_bonus') bonusDodge += (eff.value || 0);
            if (eff.type === 'melee_damage_bonus') {
              var val = (acc.race && eff.raceValue && acc.race === (card.raceBonus || '')) ? eff.raceValue : (eff.value || 0);
              bonusMeleeDmg += val;
            }
            if (eff.type === 'dungeon_damage_bonus') bonusDungeonDmg += (eff.value || 0);
            if (eff.type === 'boss_damage_bonus') bonusBossDmg += (eff.value || 0);
            if (eff.type === 'dungeon_def_bonus') bonusDungeonDef += (eff.value || 0);
            if (eff.type === 'stat_boost_all') bonusHp += (eff.value || 0) * 10;
          }
        }
      }

      var maxHp = computed.hp + bonusHp;
      // Use dual-hand stats
      var handStats = accounts.getEquippedHandStats ? accounts.getEquippedHandStats(accKey) : { mainHand: null, offHand: null };
      var mh = handStats.mainHand;
      var oh = handStats.offHand;
      var weaponDamage = mh ? (mh.damage || 0) : 0;
      var weaponMagicDamage = mh ? (mh.magicDamage || 0) : 0;
      var weaponCategory = mh ? (mh.category || 'melee_blade') : 'melee_blade';
      var weaponRange = mh ? (mh.range || 1.5) : 1.5;
      var weaponSpeed = mh ? (mh.speed || 1.0) : 1.0;
      var blockChance = 0;
      var offHandDefense = 0;
      if (oh) {
        if (oh.slot === 'shield' || oh.defense) {
          blockChance = oh.blockChance || 0;
          offHandDefense = oh.defense || 0;
        }
      }
      var armorStats = accounts.getEquippedArmorStats ? accounts.getEquippedArmorStats(accKey) : { totalDefense: 0, totalMagicResist: 0, totalMagicDamage: 0, totalCritBonus: 0, totalSpeedMod: 0 };
      var armorTotal = armorStats.totalDefense + offHandDefense;

      // Compute combat skill bonuses from weapon proficiency (Fix 4)
      var combatSkillBonuses = rpgData.getCombatSkillBonuses(acc.skills, weaponCategory);
      var combatMastery = masteryCore.getSkillMasteryBonuses(acc, weaponCategory);

      // Infer armor type from equipped chest armor (Fix 3)
      var armorType = 'none';
      if (acc.equipment && acc.equipment.chest && acc.mmoInventory && acc.mmoInventory.items) {
        var bodyItem = acc.mmoInventory.items.find(function(it) { return it.id === acc.equipment.chest; });
        if (bodyItem) {
          var bodyType = bodyItem.type || '';
          if (bodyType.indexOf('leather') >= 0) armorType = 'leather';
          else if (bodyType.indexOf('cloth') >= 0 || bodyType.indexOf('robe') >= 0) armorType = 'cloth';
          else if (bodyType.indexOf('mithril') >= 0 || bodyType.indexOf('plate') >= 0 || bodyType.indexOf('steel') >= 0 || bodyType.indexOf('iron') >= 0 || bodyType.indexOf('gold') >= 0 || bodyType.indexOf('silver') >= 0) armorType = 'plate';
          else if (bodyType.indexOf('bronze') >= 0 || bodyType.indexOf('copper') >= 0 || bodyType.indexOf('chain') >= 0 || bodyType.indexOf('mail') >= 0) armorType = 'chain';
        }
      }

      var combat = {
        hp: maxHp,
        maxHp: maxHp,
        mana: 50 + ((acc.rpgStats || {}).acumen || 5) * 5,
        maxMana: 50 + ((acc.rpgStats || {}).acumen || 5) * 5,
        critChance: computed.critChance + bonusCrit + (combatSkillBonuses.critBonus || 0) + armorStats.totalCritBonus + (combatMastery.crit_chance_pct || 0),
        dodgeChance: computed.dodgeChance + bonusDodge,
        meleeDmgMult: computed.meleeDamageMultiplier + bonusMeleeDmg + (combatSkillBonuses.damageBonus || 0) + (combatMastery.damage_pct || 0),
        magicDmgMult: computed.magicPowerMultiplier + bonusMagicDmg + (combatMastery.spell_damage_pct || 0),
        dungeonDmgBonus: bonusDungeonDmg,
        bossDmgBonus: bonusBossDmg,
        dungeonDefBonus: bonusDungeonDef,
        hpRegen: computed.hpRegen,
        baseArmor: computed.baseArmor + armorTotal,
        magicResist: (computed.magicResist || 0) + armorStats.totalMagicResist,
        armorType: armorType,
        weaponDamage: weaponDamage,
        weaponMagicDamage: weaponMagicDamage + armorStats.totalMagicDamage,
        weaponCategory: weaponCategory,
        weaponRange: weaponRange,
        weaponSpeed: weaponSpeed,
        blockChance: blockChance,
      };

      // Build player array for combat engine
      var players = [{
        socketId: socket.id,
        x: arena.entranceX,
        y: arena.entranceY,
        name: user.name || acc.username || 'Player',
        race: acc.race,
        rpgStats: acc.rpgStats || rpgData.getDefaultStats(),
        level: acc.level || 1,
        equippedCards: equippedCardObjects,
        combat: combat,
      }];

      // Convert overworld monster to dungeon-combat enemy format
      var archetype = dungeonData.inferArchetype(monster);
      var enemyDefaults = dungeonData.ENEMY_DEFAULTS[archetype] || dungeonData.ENEMY_DEFAULTS.bruiser;
      // Assign element from biome (Fix 2)
      var monsterElement = monster.element || (BIOME_ELEMENT_MAP[biomeId] || null);
      var enemies = [{
        id: monster.id,
        name: monster.name,
        hp: monster.hp,
        maxHp: monster.maxHp,
        atk: monster.atk,
        def: monster.def,
        speed: 8 + (monster.level || 1),
        xp: monster.xp,
        gold: monster.goldDrop,
        archetype: archetype,
        abilities: enemyDefaults.abilities || [],
        x: arena.enemyX,
        y: arena.enemyY,
        lootTable: monster.possibleLoot,
        element: monsterElement,
        alive: true,
      }];

      // Build arena floor object matching what dungeon-combat expects
      var arenaFloor = {
        grid: arena.grid,
        rooms: arena.rooms,
        width: arena.width,
        height: arena.height,
      };

      // Capture references for callbacks closure
      var capturedZoneId = zoneId;
      var capturedMonsterId = monster.id;
      var capturedMonster = monster;
      var capturedAccKey = accKey;
      var capturedSocketId = socket.id;
      var capturedArenaGrid = arena.grid;
      var capturedArenaTheme = arena.themeColors;

      // Build callbacks — 2-arg broadcastToFloor matching dungeon-combat.js actual call signature
      var callbacks = {
        broadcastToFloor: function(event, eventData) {
          if (event === 'tc_combat_start') {
            // Inject per-player myUnitId and arena data
            var playerUnitId = 'player_' + capturedSocketId;
            var enriched = {};
            for (var k in eventData) { enriched[k] = eventData[k]; }
            enriched.myUnitId = playerUnitId;
            enriched.arenaGrid = capturedArenaGrid;
            enriched.arenaTheme = capturedArenaTheme;
            var targetSocket = io.sockets.sockets.get(capturedSocketId);
            if (targetSocket) targetSocket.emit(event, enriched);
          } else if (event === 'tc_combat_end') {
            // Handle combat end: determine victory/defeat
            var result = eventData.result;
            var targetSock = io.sockets.sockets.get(capturedSocketId);

            if (result === 'victory') {
              // Award XP (melee skill)
              var xpRate = (_serverRules && _serverRules.xpRate) ? _serverRules.xpRate : undefined;
              var xpResult = accounts.addSkillXp(capturedAccKey, 'melee', capturedMonster.xp, xpRate);

              // Monster XP: award XP to player's active monster
              try {
                var monAcc = accounts.loadAccount(capturedAccKey);
                if (monAcc && monAcc.monsters && monAcc.activeParty && monAcc.activeParty.length > 0) {
                  var activeMonId = monAcc.activeParty[0]; // Lead monster gets XP
                  var activeMon = monAcc.monsters.find(function(m) { return m.instanceId === activeMonId; });
                  if (activeMon) {
                    if (!activeMon.xp) activeMon.xp = 0;
                    if (!activeMon.level) activeMon.level = 1;
                    activeMon.xp += capturedMonster.xp;
                    // Level up: xp threshold = 50 * level^1.5
                    var monXpNeeded = Math.floor(50 * Math.pow(activeMon.level, 1.5));
                    while (activeMon.xp >= monXpNeeded && activeMon.level < 100) {
                      activeMon.xp -= monXpNeeded;
                      activeMon.level++;
                      if (activeMon.baseHp) activeMon.baseHp = Math.round(activeMon.baseHp * 1.03);
                      if (activeMon.baseAtk) activeMon.baseAtk = Math.round(activeMon.baseAtk * 1.03);
                      if (activeMon.baseDef) activeMon.baseDef = Math.round(activeMon.baseDef * 1.03);
                      activeMon.maxHp = activeMon.baseHp;
                      activeMon.hp = activeMon.maxHp;
                      monXpNeeded = Math.floor(50 * Math.pow(activeMon.level, 1.5));
                    }
                    accounts.saveAccount(monAcc);
                  }
                }
              } catch (monXpErr) {
                console.error('[overworld_combat] Monster XP error:', monXpErr.message);
              }

              // Phantom Skill XP: Skinning for beast-type overworld kills (10-20 XP)
              var _owBeastPattern = /wolf|bear|boar|spider|lizard|bat|crab|scorpion|viper|raptor|toad|beetle|hound|drake|serpent|worm|ape|bird|insect|crawler|goat|imp|hawk/i;
              if (capturedMonster.name && _owBeastPattern.test(capturedMonster.name)) {
                accounts.addSkillXp(capturedAccKey, 'skinning', 10 + Math.floor(Math.random() * 11), xpRate);
              }
              // Phantom Skill XP: Anatomy on all overworld kills
              accounts.addSkillXp(capturedAccKey, 'anatomy', 3, xpRate);

              // Remove monster from zone and spawn lootable corpse
              capturedMonster.alive = false;
              capturedMonster.hp = 0;
              capturedMonster.inCombat = false;
              var mList = state.zoneMonsters.get(capturedZoneId);
              if (mList) {
                for (var ri = mList.length - 1; ri >= 0; ri--) {
                  if (mList[ri].id === capturedMonsterId) {
                    mList.splice(ri, 1);
                    break;
                  }
                }
              }

              // Broadcast death to zone
              io.to('zone:' + capturedZoneId).emit('zone_monster_died', { id: capturedMonsterId });

              // Spawn lootable corpse with procedural loot at death position
              var _corpse = corpseLoot.spawnCorpse(capturedZoneId, capturedMonster);

              // Send kill rewards to player (XP/skill only — gold/loot in corpse)
              if (targetSock) {
                targetSock.emit('zone_monster_killed', {
                  id: capturedMonsterId,
                  name: capturedMonster.name,
                  xp: capturedMonster.xp,
                  gold: 0,
                  loot: [],
                  corpseId: _corpse ? _corpse.id : null,
                  skillLevel: xpResult ? xpResult.level : 1,
                  skillXp: xpResult ? xpResult.xp : 0,
                  xpNeeded: xpResult ? xpResult.xpNeeded : 100,
                  leveledUp: xpResult ? xpResult.leveledUp : false,
                  overallLevel: xpResult ? xpResult.overallLevel : 1,
                  overallLeveledUp: xpResult ? xpResult.overallLeveledUp : false,
                  pendingPacks: xpResult ? xpResult.pendingPacks : 0,
                });
              }

              // --- Quest progress: kill-type quests ---
              try {
                var qAcc = accounts.loadAccount(capturedAccKey);
                if (qAcc && qAcc.questProgress && qAcc.questProgress.active) {
                  var rpgData = require('../rpg-data');
                  var qChanged = false;
                  for (var qi = 0; qi < qAcc.questProgress.active.length; qi++) {
                    var quest = qAcc.questProgress.active[qi];
                    var tmpl = rpgData.WORLD_QUEST_TEMPLATES ? rpgData.WORLD_QUEST_TEMPLATES.find(function(t) { return t.questId === quest.questId; }) : null;
                    if (!tmpl) tmpl = questAdlib.getGeneratedQuest(quest.questId);
                    if (tmpl && tmpl.type === 'kill' && (tmpl.target.monster === capturedMonster.baseId || tmpl.target.monster === capturedMonster.templateId)) {
                      quest.progress = Math.min(quest.progress + 1, quest.targetCount);
                      qChanged = true;
                      if (targetSock) {
                        targetSock.emit('quest_progress', { questId: quest.questId, progress: quest.progress, targetCount: quest.targetCount, complete: quest.progress >= quest.targetCount });
                      }
                    }
                  }
                  if (qChanged) accounts.saveAccount(qAcc);
                }
              } catch (qErr) { /* quest progress error is non-fatal */ }

              // --- Durability loss: weapon 1% per kill, armor 0.5% per hit taken ---
              try {
                var durAcc = accounts.loadAccount(capturedAccKey);
                if (durAcc && durAcc.equipment) {
                  var durCardEffects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(capturedAccKey) : [];
                  var durWarnings = [];
                  var owWepResults = accounts.reduceWeaponDurability(durAcc, 0.01, durCardEffects);
                  if (owWepResults) { for (var owwi = 0; owwi < owWepResults.length; owwi++) durWarnings.push(owWepResults[owwi]); }
                  var owArmorResults = accounts.reduceArmorDurability(durAcc, 0.005, durCardEffects);
                  for (var owdi = 0; owdi < owArmorResults.length; owdi++) durWarnings.push(owArmorResults[owdi]);
                  accounts.saveAccount(durAcc);
                  if (targetSock) {
                    for (var owwi = 0; owwi < durWarnings.length; owwi++) {
                      if (durWarnings[owwi].broken) {
                        targetSock.emit('item_broken', { slot: durWarnings[owwi].slot, itemName: durWarnings[owwi].itemName });
                      } else if (durWarnings[owwi].lowDurability) {
                        targetSock.emit('durability_warning', { slot: durWarnings[owwi].slot, itemName: durWarnings[owwi].itemName, durability: durWarnings[owwi].durability, maxDurability: durWarnings[owwi].maxDurability });
                      }
                    }
                  }
                }
              } catch (owDurErr) {
                console.error('[overworld_combat] Durability error:', owDurErr.message);
              }
            } else {
              // Defeat: restore monster to full HP
              capturedMonster.hp = capturedMonster.maxHp;
              capturedMonster.inCombat = false;
            }

            // Release player from combat tracking
            _overworldCombatPlayers.delete(capturedSocketId);

            // Forward the combat end event to the player
            if (targetSock) targetSock.emit(event, eventData);
          } else {
            // All other combat events: emit to participant socket
            var sock = io.sockets.sockets.get(capturedSocketId);
            if (sock) sock.emit(event, eventData);
          }
        },

        emitToPlayer: function(socketId, event, eventData) {
          var targetSocket = io.sockets.sockets.get(socketId);
          if (targetSocket) targetSocket.emit(event, eventData);
        },

        awardKillRewards: function(enemyUnit) {
          // Rewards are handled in the broadcastToFloor tc_combat_end callback
          // This is called per-enemy by dungeon-combat.js during victory
        },

        handleDeath: function(socketId) {
          // Player died in combat — full cleanup handled by tc_combat_end defeat path
          // No separate emit needed; tc_combat_end broadcasts defeat result
        },

        getPlayerInfo: function(socketId) {
          var pAccKey = socketAccountMap.get(socketId);
          if (!pAccKey) return null;
          var pAcc = accounts.loadAccount(pAccKey);
          if (!pAcc) return null;
          return {
            accKey: pAccKey,
            race: pAcc.race,
            rpgStats: pAcc.rpgStats || rpgData.getDefaultStats(),
            level: pAcc.level || 1,
            equippedCards: pAcc.equippedCards || [],
            name: pAcc.username || 'Player',
          };
        },
      };

      // Mark monster as in-combat to prevent double-engagement
      monster.inCombat = true;

      // Track combat participant
      var overworldDungeonId = 'overworld_' + monster.id + '_' + Date.now();
      _overworldCombatPlayers.set(socket.id, {
        monsterId: monster.id,
        zoneId: zoneId,
        dungeonId: overworldDungeonId,
      });

      // Start combat via the dungeon combat engine
      dungeonCombat.initCombat(overworldDungeonId, players, enemies, arenaFloor, callbacks);
    });

    // --- Send current zone monsters when player enters a zone ---
    // Listen for zone_enter indirectly: when player joins a zone, they receive zone_state.
    // We hook into the zone_enter flow by watching for playerZones changes.
    // Instead, we send monsters after zone_state is sent. We do this by listening
    // for the socket joining a room and then responding.
    // The cleanest approach: client requests monsters after zone_enter.
    socket.on('zone_monsters_request', function() {

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;

      var zone = state.zones.get(zoneId);
      if (!zone || !zone.chunkCache) {
        // Non-overworld zones have no wild monsters
        socket.emit('zone_monsters', { monsters: [] });
        return;
      }

      var monsterList = state.zoneMonsters.get(zoneId);
      if (!monsterList || monsterList.length === 0) {
        socket.emit('zone_monsters', { monsters: [] });
        return;
      }

      // Filter to alive monsters near the player (within view distance)
      var pos = state.playerPositions.get(socket.id);
      var clientMonsters = [];
      var VIEW_DIST_SQ = 1200 * 1200; // send monsters within ~1200px

      for (var i = 0; i < monsterList.length; i++) {
        var m = monsterList[i];
        if (!m.alive) continue;
        if (pos) {
          var mdx = m.x - pos.x;
          var mdy = m.y - pos.y;
          if (mdx * mdx + mdy * mdy > VIEW_DIST_SQ) continue;
        }
        clientMonsters.push(monsterToClient(m));
      }

      socket.emit('zone_monsters', { monsters: clientMonsters });
    });

    // --- Periodic monster position sync for nearby monsters ---
    // Client can request monsters near their current position
    socket.on('zone_monsters_nearby', function() {

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;

      var zone = state.zones.get(zoneId);
      if (!zone || !zone.chunkCache) return;

      var monsterList = state.zoneMonsters.get(zoneId);
      if (!monsterList) return;

      var pos = state.playerPositions.get(socket.id);
      if (!pos) return;

      var clientMonsters = [];
      var NEARBY_SQ = 800 * 800;

      for (var i = 0; i < monsterList.length; i++) {
        var m = monsterList[i];
        if (!m.alive) continue;
        var mdx = m.x - pos.x;
        var mdy = m.y - pos.y;
        if (mdx * mdx + mdy * mdy <= NEARBY_SQ) {
          clientMonsters.push(monsterToClient(m));
        }
      }

      socket.emit('zone_monsters', { monsters: clientMonsters });
    });

    // --- Clean up attack cooldowns and combat tracking on disconnect ---
    socket.on('disconnect', function() {
      _attackCooldowns.delete(socket.id);

      // Notify combat engine so autoDefend is enabled for faster resolution
      if (_overworldCombatPlayers.has(socket.id)) {
        var owCombat = dungeonCombat.getCombatBySocketId(socket.id);
        if (owCombat) {
          dungeonCombat.handlePlayerDisconnect(owCombat.id, socket.id);
        }
      }
      _overworldCombatPlayers.delete(socket.id);
    });
  },

  // Check if a player is currently in overworld combat
  isInOverworldCombat: function(socketId) {
    return _overworldCombatPlayers.has(socketId);
  },

  // Expose for external use (e.g., from zone.js zone_enter hook)
  getZoneMonsters: function(zoneId) {
    if (!_state) return [];
    var monsterList = _state.zoneMonsters.get(zoneId);
    if (!monsterList) return [];
    var result = [];
    for (var i = 0; i < monsterList.length; i++) {
      if (monsterList[i].alive) result.push(monsterToClient(monsterList[i]));
    }
    return result;
  },

  // Expose monster definitions for other systems
  OVERWORLD_MONSTERS: OVERWORLD_MONSTERS,
};
