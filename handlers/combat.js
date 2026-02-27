// handlers/combat.js
// Ability cooldown combat system — FFXIV/WoW-style weapon abilities on cooldowns.
// Server-authoritative cooldown tracking, damage calculation, card modifier application.
// Supports both weapon-based abilities AND card-based active abilities.
// Works in both overworld and dungeon contexts.

var rpgData = require('../rpg-data');
var accounts = require('../accounts');
var challengesHandler = require('./challenges');

// ---------------------------------------------------------------------------
// Per-player cooldown tracking (in-memory, resets on disconnect/server restart)
// Map<socketId, Map<abilityId, lastUsedTimestamp>>
// Shared between weapon abilities and card abilities to prevent spam.
// ---------------------------------------------------------------------------
var _playerCooldowns = new Map();

// Per-player active buffs/debuffs from abilities
// Map<socketId, Array<{ effect, expiry, ... }>>
var _playerBuffs = new Map();

// Module-level references
var _io = null;
var _state = null;

// ---------------------------------------------------------------------------
// Persistent overworld mana tracking (in-memory, resets on disconnect/restart)
// Map<socketId, { current: number, max: number, accKey: string }>
// ---------------------------------------------------------------------------
var _playerMana = new Map();

// Mana regen interval: regenerates 5% of max mana every 5 seconds
var _manaRegenInterval = setInterval(function() {
  _playerMana.forEach(function(manaState) {
    if (manaState.current < manaState.max) {
      var regen = Math.max(1, Math.floor(manaState.max * 0.05));
      manaState.current = Math.min(manaState.max, manaState.current + regen);
    }
  });
}, 5000);
if (_manaRegenInterval && _manaRegenInterval.unref) _manaRegenInterval.unref();

// ---------------------------------------------------------------------------
// Monster DoT tracking (in-memory)
// Map<monsterId, Array<{ tickDamage, remainingTicks, sourceSocketId, zoneId, name }>>
// ---------------------------------------------------------------------------
var _monsterDoTs = new Map();

// DoT tick interval: applies damage every 1 second
var _dotTickInterval = setInterval(function() {
  if (!_io || !_state) return;
  var toRemove = [];
  _monsterDoTs.forEach(function(dots, monsterId) {
    var activeDots = [];
    for (var i = 0; i < dots.length; i++) {
      var dot = dots[i];
      dot.remainingTicks--;
      // Find the monster in the zone to apply damage
      var monsterList = _state.zoneMonsters ? _state.zoneMonsters.get(dot.zoneId) : null;
      var monster = null;
      if (monsterList) {
        for (var mi = 0; mi < monsterList.length; mi++) {
          if (monsterList[mi].id === monsterId && monsterList[mi].alive) {
            monster = monsterList[mi];
            break;
          }
        }
      }
      if (monster) {
        var tickDmg = Math.max(1, Math.round(dot.tickDamage));
        monster.hp = Math.max(0, monster.hp - tickDmg);
        // Emit dot_tick to the zone
        _io.to('zone:' + dot.zoneId).emit('dot_tick', {
          monsterId: monsterId,
          damage: tickDmg,
          dotName: dot.name || 'DoT',
          remainingTicks: dot.remainingTicks,
          monsterHp: monster.hp,
          monsterMaxHp: monster.maxHp || monster.hp,
          sourceSocketId: dot.sourceSocketId,
        });
        // Check if monster died from DoT
        if (monster.hp <= 0) {
          monster.alive = false;
          _io.to('zone:' + dot.zoneId).emit('zone_monster_died', { id: monsterId });
          // Award XP/gold to the source player
          var sourceSocket = _io.sockets.sockets.get(dot.sourceSocketId);
          if (sourceSocket) {
            var dotAccKey = null;
            // We look up accKey from socketAccountMap stored in _state
            if (_state._socketAccountMap) {
              dotAccKey = _state._socketAccountMap.get(dot.sourceSocketId);
            }
            if (dotAccKey) {
              var xpResult = accounts.addSkillXp(dotAccKey, 'melee', monster.xp || 5);
              var goldAmount = monster.goldDrop || 3;
              if (goldAmount > 0) accounts.updateChips(dotAccKey, goldAmount);
              sourceSocket.emit('zone_monster_killed', {
                id: monsterId, name: monster.name || 'Monster',
                xp: monster.xp || 5, gold: goldAmount, loot: [],
                skillLevel: xpResult ? xpResult.level : 1,
                skillXp: xpResult ? xpResult.xp : 0,
                xpNeeded: xpResult ? xpResult.xpNeeded : 100,
                leveledUp: xpResult ? xpResult.leveledUp : false,
                overallLevel: xpResult ? xpResult.overallLevel : 1,
                overallLeveledUp: xpResult ? xpResult.overallLeveledUp : false,
                pendingPacks: xpResult ? xpResult.pendingPacks : 0,
              });
            }
          }
          // Remove monster from zone list
          if (monsterList) {
            for (var ri = monsterList.length - 1; ri >= 0; ri--) {
              if (monsterList[ri].id === monsterId) { monsterList.splice(ri, 1); break; }
            }
          }
        }
      }
      if (dot.remainingTicks > 0 && monster && monster.alive !== false) {
        activeDots.push(dot);
      }
    }
    if (activeDots.length === 0) {
      toRemove.push(monsterId);
    } else {
      _monsterDoTs.set(monsterId, activeDots);
    }
  });
  for (var r = 0; r < toRemove.length; r++) {
    _monsterDoTs.delete(toRemove[r]);
  }
}, 1000);
if (_dotTickInterval && _dotTickInterval.unref) _dotTickInterval.unref();

// ---------------------------------------------------------------------------
// MMO-inspired per-player tracking Maps (real-time overworld equivalents)
// All keyed by socketId, cleared on disconnect.
// ---------------------------------------------------------------------------

// Hot Streak: consecutive crit count. Map<socketId, number>
var _hotStreakCounts = new Map();

// Combo Chains: last combo used. Map<socketId, { lastCombo: string, usedAt: number }>
var _comboState = new Map();

// Lily of the Field: token count. Map<socketId, { tokens: number, lastTick: number }>
var _lilyTokens = new Map();

// Soul Shards: kill count. Map<socketId, number>
var _soulShards = new Map();

// Stagger DoTs: converted damage. Map<socketId, { remaining: number, tickDamage: number }>
var _staggerDoTs = new Map();

// Divine Invulnerability: active until timestamp. Map<socketId, number>
var _divineInvulnerability = new Map();

// Fade: active until timestamp. Map<socketId, number>
var _fadeActive = new Map();

// Adaptive Resist: last element that hit the player. Map<socketId, string>
var _playerLastHitElement = new Map();

// Resilient Body regen interval: 2% max HP every 5 seconds (doubled below 30% HP)
var _resilientBodyInterval = setInterval(function() {
  if (!_io || !_state) return;
  _playerMana.forEach(function(manaState, socketId) {
    if (!manaState.accKey) return;
    var acc = accounts.loadAccount(manaState.accKey);
    if (!acc) return;
    var rbPassive = getAccCombatPassive(acc, 'resilient_body');
    if (!rbPassive) return;
    var computed = rpgData.computeStats(acc.rpgStats || rpgData.getDefaultStats(), acc.level || 1, acc.race);
    var maxHp = computed.hp || 100;
    var regenPct = rbPassive.hpRegenPercent || 0.02;
    var regenAmt = Math.max(1, Math.floor(maxHp * regenPct));
    var sourceSocket = _io.sockets.sockets.get(socketId);
    if (sourceSocket) {
      sourceSocket.emit('passive_regen', { amount: regenAmt, source: 'resilient_body', maxHp: maxHp });
    }
  });
}, 5000);
if (_resilientBodyInterval && _resilientBodyInterval.unref) _resilientBodyInterval.unref();

// Helper: get combatPassive of a given type from an account's equipped cards
function getAccCombatPassive(acc, passiveType) {
  if (!acc || !acc.rpgCards || !acc.equippedCards) return null;
  var cardMap = {};
  for (var i = 0; i < acc.rpgCards.length; i++) {
    cardMap[acc.rpgCards[i].instanceId] = acc.rpgCards[i];
  }
  for (var j = 0; j < acc.equippedCards.length; j++) {
    var cid = acc.equippedCards[j];
    if (!cid || !cardMap[cid]) continue;
    var tmpl = rpgData.CARD_BY_ID[cardMap[cid].cardId];
    if (tmpl && tmpl.combatPassive && tmpl.combatPassive.type === passiveType) {
      return tmpl.combatPassive;
    }
  }
  return null;
}

// Helper: get sum of combatPassive values of a given type from account's equipped cards
function getAccCombatPassiveTotal(acc, passiveType) {
  if (!acc || !acc.rpgCards || !acc.equippedCards) return 0;
  var total = 0;
  var cardMap = {};
  for (var i = 0; i < acc.rpgCards.length; i++) {
    cardMap[acc.rpgCards[i].instanceId] = acc.rpgCards[i];
  }
  for (var j = 0; j < acc.equippedCards.length; j++) {
    var cid = acc.equippedCards[j];
    if (!cid || !cardMap[cid]) continue;
    var tmpl = rpgData.CARD_BY_ID[cardMap[cid].cardId];
    if (tmpl && tmpl.combatPassive && tmpl.combatPassive.type === passiveType) {
      total += (tmpl.combatPassive.value || 0);
    }
  }
  return total;
}

// Helper: check if a monster has any debuff (stunned, slowed, weakened, poisoned, etc.)
function isMonsterDebuffed(monster) {
  if (!monster) return false;
  var now = Date.now();
  if (monster.stunned && (!monster.stunnedUntil || monster.stunnedUntil > now)) return true;
  if (monster.slowed && (!monster.slowedUntil || monster.slowedUntil > now)) return true;
  if (monster.weakened) return true;
  if (monster.armorBroken) return true;
  if (monster.poisoned) return true;
  if (monster.polymorphed) return true;
  if (monster.taunted) return true;
  if (monster.mortalWoundsUntil && monster.mortalWoundsUntil > now) return true;
  // Check if monster has active DoTs (indicates a debuff state)
  if (_monsterDoTs.has(monster.id)) return true;
  return false;
}

// Helper: check if a monster is "marked" (has predator's mark or similar)
function isMonsterMarked(monster) {
  if (!monster) return false;
  var now = Date.now();
  if (monster.marked && (!monster.markedUntil || monster.markedUntil > now)) return true;
  if (monster.predatorsMarkUntil && monster.predatorsMarkUntil > now) return true;
  return false;
}

// Helper: check if it is currently "night" in the overworld (for nightDamageBonus)
function isNightTime() {
  if (_state && _state.world) {
    var tod = _state.world.timeOfDay;
    return tod === 'night' || tod === 'dusk';
  }
  // Fallback: real UTC hour if state is unavailable
  var utcHour = new Date().getUTCHours();
  return utcHour >= 20 || utcHour < 5;
}

// Helper: check if a monster is undead or shadow type (for bonusVsUndead / bonusVsShadow)
function isMonsterUndead(monster) {
  if (!monster) return false;
  if (monster.type === 'undead' || monster.race === 'undead') return true;
  if (monster.tags && monster.tags.indexOf('undead') >= 0) return true;
  var name = (monster.name || '').toLowerCase();
  return /skeleton|zombie|ghoul|wraith|lich|revenant|specter|wight|vampire|banshee|phantom/.test(name);
}

function isMonsterShadow(monster) {
  if (!monster) return false;
  if (monster.type === 'shadow' || monster.race === 'shadow') return true;
  if (monster.tags && monster.tags.indexOf('shadow') >= 0) return true;
  var name = (monster.name || '').toLowerCase();
  return /shadow|shade|dark|nightmare|void|corrupted/.test(name);
}

// Helper: get total flat damage reduction from equipped cards
function getAccFlatDamageReduction(acc) {
  if (!acc || !acc.rpgCards || !acc.equippedCards) return 0;
  var total = 0;
  var cardMap = {};
  for (var i = 0; i < acc.rpgCards.length; i++) {
    cardMap[acc.rpgCards[i].instanceId] = acc.rpgCards[i];
  }
  for (var j = 0; j < acc.equippedCards.length; j++) {
    var cid = acc.equippedCards[j];
    if (!cid || !cardMap[cid]) continue;
    var tmpl = rpgData.CARD_BY_ID[cardMap[cid].cardId];
    if (tmpl && tmpl.combatPassive && tmpl.combatPassive.type === 'flat_damage_reduction') {
      total += (tmpl.combatPassive.value || 0);
    }
  }
  return total;
}

// Lily tick interval: +1 lily token every 10 seconds for players with the passive
var _lilyTickInterval = setInterval(function() {
  _lilyTokens.forEach(function(lilyState) {
    lilyState.tokens = (lilyState.tokens || 0) + 1;
  });
}, 10000);
if (_lilyTickInterval && _lilyTickInterval.unref) _lilyTickInterval.unref();

// ---------------------------------------------------------------------------
// Passive combat types — these card combatTypes are NOT active abilities
// ---------------------------------------------------------------------------
var PASSIVE_COMBAT_TYPES = { passive: true };

// Active combat types that are valid for use_card_ability
var ACTIVE_COMBAT_TYPES = {
  damage: true,
  healing: true,
  buff: true,
  debuff: true,
  dot: true,
  summon: true,
  utility: true,
  tile_effect: true,
  movement: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPlayerCooldowns(socketId) {
  if (!_playerCooldowns.has(socketId)) {
    _playerCooldowns.set(socketId, new Map());
  }
  return _playerCooldowns.get(socketId);
}

function getPlayerBuffs(socketId) {
  if (!_playerBuffs.has(socketId)) {
    _playerBuffs.set(socketId, []);
  }
  return _playerBuffs.get(socketId);
}

function cleanExpiredBuffs(socketId) {
  var buffs = _playerBuffs.get(socketId);
  if (!buffs) return [];
  var now = Date.now();
  var active = [];
  for (var i = 0; i < buffs.length; i++) {
    if (buffs[i].expiry > now) active.push(buffs[i]);
  }
  _playerBuffs.set(socketId, active);
  return active;
}

// ---------------------------------------------------------------------------
// Apply defensive buffs when the player takes incoming damage.
// Returns { finalDamage, absorbed, dodged, blocked, parried, counterDamage, consumed }
// accKey and attackElement are optional (backwards-compatible) for passive effects.
// ---------------------------------------------------------------------------
function applyDefensiveBuffs(socketId, incomingDamage, attackerIsRanged, accKey, attackElement) {
  var buffs = cleanExpiredBuffs(socketId);
  var result = { finalDamage: incomingDamage, absorbed: 0, dodged: false, blocked: false, parried: false, counterDamage: 0, consumed: [], reflectDamage: 0 };

  // --- Divine Invulnerability: immune to all damage ---
  var divInvExpiry = _divineInvulnerability.get(socketId);
  if (divInvExpiry && Date.now() < divInvExpiry) {
    result.finalDamage = 0;
    result.absorbed = incomingDamage;
    result.consumed.push('divine_invulnerability');
    return result;
  }

  // Load account for passive checks (optional — backwards compatible)
  var defAcc = null;
  if (accKey) {
    defAcc = accounts.loadAccount(accKey);
  }

  // --- Parry Chance: 15% melee attack negation (passive) ---
  if (!attackerIsRanged && defAcc) {
    var parryPassive = getAccCombatPassive(defAcc, 'parry_chance');
    if (parryPassive && Math.random() < (parryPassive.value || 0.15)) {
      result.finalDamage = 0;
      result.absorbed = incomingDamage;
      result.parried = true;
      result.consumed.push('parry');
      return result;
    }
  }

  if ((!buffs || buffs.length === 0) && incomingDamage <= 0) return result;

  var remaining = incomingDamage;

  // --- Stagger: convert 40% of incoming damage to a DoT ---
  var staggerData = _staggerDoTs.get(socketId);
  if (staggerData) {
    var staggerConvert = Math.floor(remaining * 0.40);
    remaining -= staggerConvert;
    // Add to ongoing stagger DoT pool
    staggerData.remaining = (staggerData.remaining || 0) + staggerConvert;
    staggerData.tickDamage = Math.max(1, Math.floor(staggerData.remaining / 5));
    result.absorbed += staggerConvert;
  }

  // --- Ironskin: 15% DR (applied as flat reduction) ---
  for (var isI = 0; isI < (buffs ? buffs.length : 0); isI++) {
    if (buffs[isI].effect === 'ironskin') {
      remaining = Math.max(0, Math.floor(remaining * 0.85));
      break;
    }
  }

  // --- Dragonfire Scale: 20% chance full reflect on ranged attacks ---
  if (attackerIsRanged) {
    for (var drfI = 0; drfI < (buffs ? buffs.length : 0); drfI++) {
      if (buffs[drfI].effect === 'dragonfire_scale') {
        if (Math.random() < (buffs[drfI].reflectChance || 0.20)) {
          result.reflectDamage += remaining;
          remaining = 0;
          result.consumed.push('dragonfire_scale_proc');
        }
        break;
      }
    }
  }

  // --- Thorns Aura: 10% damage reflected back on melee attacks ---
  if (!attackerIsRanged) {
    for (var taI = 0; taI < (buffs ? buffs.length : 0); taI++) {
      if (buffs[taI].effect === 'thorns_aura') {
        result.reflectDamage += Math.floor(incomingDamage * (buffs[taI].reflectValue || 0.10));
        break;
      }
    }
  }

  for (var i = buffs.length - 1; i >= 0; i--) {
    var buff = buffs[i];

    // block_next: negate damage entirely, consume the buff
    if (buff.effect === 'block_next') {
      remaining = 0;
      result.blocked = true;
      result.consumed.push('block_next');
      buffs.splice(i, 1);
      continue;
    }

    // dodge_buff: percentage chance to completely dodge
    if (buff.effect === 'dodge_buff') {
      var dodgeChance = buff.dodgeBonus || 0.20;
      if (Math.random() < dodgeChance) {
        remaining = 0;
        result.dodged = true;
        // Consume dodge on use
        result.consumed.push('dodge_buff');
        buffs.splice(i, 1);
        continue;
      }
    }

    // armor_buff: flat damage reduction
    if (buff.effect === 'armor_buff') {
      var armorReduction = buff.armorBonus || 10;
      remaining = Math.max(0, remaining - armorReduction);
      result.absorbed += armorReduction;
    }

    // mana_shield: absorb percentage of damage from mana pool
    if (buff.effect === 'mana_shield') {
      var absorbPercent = buff.absorbPercent || 0.5;
      var manaAbsorb = Math.floor(remaining * absorbPercent);
      var manaState = _playerMana.get(socketId);
      if (manaState && manaState.current > 0) {
        var actualAbsorb = Math.min(manaAbsorb, manaState.current);
        manaState.current -= actualAbsorb;
        remaining = Math.max(0, remaining - actualAbsorb);
        result.absorbed += actualAbsorb;
      }
    }

    // magic_barrier: flat absorption amount
    if (buff.effect === 'magic_barrier') {
      var flatAbsorb = buff.absorbFlat || 50;
      var barrierAbsorb = Math.min(flatAbsorb, remaining);
      remaining = Math.max(0, remaining - barrierAbsorb);
      result.absorbed += barrierAbsorb;
      buff.absorbFlat -= barrierAbsorb;
      if (buff.absorbFlat <= 0) {
        result.consumed.push('magic_barrier');
        buffs.splice(i, 1);
      }
    }

    // counter: store retaliation damage to apply back to attacker
    if (buff.effect === 'counter') {
      var counterMult = buff.counterMultiplier || 2.0;
      result.counterDamage += Math.round(incomingDamage * counterMult);
    }

    // counterstrike_stance: melee counter at reduced damage (grappler/night hunter cards)
    if (buff.effect === 'counterstrike_stance' && !attackerIsRanged) {
      var csCounterPct = buff.counterAttackPercent || 0.50;
      result.counterDamage += Math.round(incomingDamage * csCounterPct);
      result.consumed.push('counterstrike_proc');
    }

    // challenge_shout_dr: damage reduction from taunt self-buff
    if (buff.effect === 'challenge_shout_dr') {
      var csDr = buff.damageReduction || 0.15;
      var csReduced = Math.floor(remaining * csDr);
      remaining = Math.max(0, remaining - csReduced);
      result.absorbed += csReduced;
    }
  }

  // --- Passive-based flat damage reduction (card combatPassive) ---
  if (defAcc && remaining > 0) {
    var flatDrPassive = getAccCombatPassive(defAcc, 'flat_damage_reduction');
    if (flatDrPassive) {
      var flatDrElement = flatDrPassive.element || 'physical';
      var atkElem = attackElement || 'physical';
      if (flatDrElement === atkElem || flatDrElement === 'all') {
        var flatDrAmt = flatDrPassive.value || 3;
        remaining = Math.max(0, remaining - flatDrAmt);
        result.absorbed += flatDrAmt;
        result.consumed.push('flat_damage_reduction');
      }
    }
  }

  // --- Adaptive Resist: 20% resist if same element as last hit (passive) ---
  if (defAcc && remaining > 0) {
    var adaptResist = getAccCombatPassive(defAcc, 'adaptive_resist');
    if (adaptResist) {
      var atkElem2 = attackElement || 'physical';
      var lastElem = _playerLastHitElement.get(socketId);
      if (lastElem && lastElem === atkElem2) {
        var arReduction = Math.floor(remaining * (adaptResist.value || 0.20));
        remaining = Math.max(0, remaining - arReduction);
        result.absorbed += arReduction;
        result.consumed.push('adaptive_resist');
      }
      _playerLastHitElement.set(socketId, atkElem2);
    }
  }

  // --- Damage Sponge: scaling DR based on missing HP (passive) ---
  if (defAcc && remaining > 0) {
    var dSpongePassive = getAccCombatPassive(defAcc, 'damage_sponge');
    if (dSpongePassive) {
      // In overworld, persistent HP is not tracked server-side, so apply a
      // conservative flat 3% DR (simulates ~30% missing HP scenario).
      var dsBaseDr = dSpongePassive.lowHpDamageReduction || 0.01;
      var dsReduction = Math.floor(remaining * (dsBaseDr * 3));
      if (dsReduction > 0) {
        remaining = Math.max(0, remaining - dsReduction);
        result.absorbed += dsReduction;
      }
    }
  }

  // --- Mana on Magic Hit: restore mana when taking magic damage (passive) ---
  if (defAcc && attackElement && attackElement !== 'physical') {
    var manaOnHitPassive = getAccCombatPassive(defAcc, 'mana_on_magic_hit');
    if (manaOnHitPassive) {
      var momManaState = _playerMana.get(socketId);
      if (momManaState) {
        var manaRestored = Math.max(1, Math.floor(momManaState.max * (manaOnHitPassive.value || 0.15)));
        momManaState.current = Math.min(momManaState.max, momManaState.current + manaRestored);
        result.consumed.push('mana_on_magic_hit');
      }
    }
  }

  _playerBuffs.set(socketId, buffs);
  result.finalDamage = Math.max(0, remaining);
  return result;
}

// Helper: get or initialize overworld mana for a player
function getOrInitPlayerMana(socketId, accKey) {
  if (_playerMana.has(socketId)) return _playerMana.get(socketId);
  var acc = accounts.loadAccount(accKey);
  var acumen = (acc && acc.rpgStats) ? (acc.rpgStats.acumen || 5) : 5;
  var maxMana = 50 + acumen * 5;
  // Card: max_mana_bonus — add flat mana from equipped card effects
  var manaCardEffects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(accKey) : [];
  for (var mi = 0; mi < manaCardEffects.length; mi++) {
    if (manaCardEffects[mi].type === 'max_mana_bonus') maxMana += (manaCardEffects[mi].value || 0);
  }
  var manaState = { current: maxMana, max: maxMana, accKey: accKey };
  _playerMana.set(socketId, manaState);
  return manaState;
}

// Helper: collect combat-relevant card passive effects for a player.
// Returns { spellDmgBonus, poisonDmgBonus, counterChanceBonus, manaEfficiency,
//           magicResistBonus, elementalResistAll, lowHpDmgReduction }
function collectCombatCardEffects(accKey) {
  var effects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(accKey) : [];
  var combatResult = {
    spellDmgBonus: 0,
    poisonDmgBonus: 0,
    counterChanceBonus: 0,
    manaEfficiency: 0,
    magicResistBonus: 0,
    elementalResistAll: 0,
    lowHpDmgReduction: 0,
  };
  for (var i = 0; i < effects.length; i++) {
    var eff = effects[i];
    if (eff.type === 'spell_damage_bonus') combatResult.spellDmgBonus += (eff.value || 0);
    if (eff.type === 'poison_damage_bonus') combatResult.poisonDmgBonus += (eff.value || 0);
    if (eff.type === 'counter_chance_bonus') combatResult.counterChanceBonus += (eff.value || 0);
    if (eff.type === 'mana_efficiency') combatResult.manaEfficiency += (eff.value || 0);
    if (eff.type === 'magic_resist') combatResult.magicResistBonus += (eff.value || 0);
    if (eff.type === 'elemental_resist_all') combatResult.elementalResistAll += (eff.value || 0);
    if (eff.type === 'low_hp_damage_reduction') combatResult.lowHpDmgReduction += (eff.value || 0);
  }
  return combatResult;
}

// Check if a conditional ability can be used on target
function checkCondition(condition, targetHp, targetMaxHp) {
  if (!condition) return true;
  if (!targetMaxHp || targetMaxHp <= 0) return true;
  var hpPercent = targetHp / targetMaxHp;
  if (condition === 'target_below_30hp') return hpPercent < 0.30;
  if (condition === 'target_below_20hp') return hpPercent < 0.20;
  if (condition === 'target_below_50hp') return hpPercent < 0.50;
  return true;
}

// Build cooldown state to send to client (weapon abilities)
function buildCooldownState(socketId, weaponFamily, equippedCards) {
  var cooldowns = getPlayerCooldowns(socketId);
  var cardMods = rpgData.computeAbilityModifiers(equippedCards);
  var abilities = rpgData.getPlayerAbilities(weaponFamily, equippedCards);
  var now = Date.now();
  var state = [];

  for (var i = 0; i < abilities.length; i++) {
    var ab = abilities[i];
    var effectiveCD = rpgData.getEffectiveCooldown(ab, weaponFamily, cardMods);
    var effectiveMana = rpgData.getEffectiveManaCost(ab, cardMods);
    var lastUsed = cooldowns.get(ab.id) || 0;
    var elapsed = (now - lastUsed) / 1000;
    var remaining = Math.max(0, effectiveCD - elapsed);

    state.push({
      id: ab.id,
      name: ab.name,
      cooldown: effectiveCD,
      remaining: Math.round(remaining * 10) / 10,
      ready: remaining <= 0,
      manaCost: effectiveMana,
      damage: ab.damage || 0,
      type: ab.type,
      element: ab.element || null,
      damageType: ab.damageType || null,
      aoe: ab.aoe || false,
      description: ab.description || '',
      effect: ab.effect || null,
      condition: ab.condition || null,
    });
  }

  return state;
}

// Get weapon info for a player's equipped weapon
function getWeaponInfo(accKey) {
  var weaponStats = accounts.getEquippedWeaponStats ? accounts.getEquippedWeaponStats(accKey) : null;
  if (!weaponStats) return { family: 'unarmed', category: null, itemType: null, damage: 0, magicDamage: 0 };

  // We need the item type name to determine weapon family
  var acc = accounts.loadAccount(accKey);
  var itemType = null;
  var handSlot = (acc && acc.equipment) ? (acc.equipment.main_hand || acc.equipment.weapon) : null;
  if (acc && handSlot && acc.mmoInventory && acc.mmoInventory.items) {
    var item = acc.mmoInventory.items.find(function(it) { return it.id === handSlot; });
    if (item) itemType = item.type;
  }

  var family = rpgData.getWeaponFamilyFromCategory(weaponStats.category, itemType);
  return {
    family: family,
    category: weaponStats.category || null,
    itemType: itemType,
    damage: weaponStats.damage || 0,
    magicDamage: weaponStats.magicDamage || 0,
    speed: weaponStats.speed || 1.0,
  };
}

// Calculate ability damage
function calculateAbilityDamage(ability, weaponInfo, computed, cardMods, enhancements) {
  if (!ability || ability.damage <= 0) return 0;

  var baseDamage;
  if (ability.type === 'magic') {
    // Magic abilities: scale from acumen + magic weapon damage
    baseDamage = (weaponInfo.magicDamage || 5) + (computed.magicPowerMultiplier * 5);
  } else {
    // Physical abilities: scale from might + weapon damage
    baseDamage = (weaponInfo.damage || 5) + (computed.meleeDamageMultiplier * 5);
  }

  var totalDamage = baseDamage * ability.damage;

  // Card element damage bonus
  if (ability.element && cardMods && cardMods.elementDamage && cardMods.elementDamage[ability.element]) {
    totalDamage *= (1 + cardMods.elementDamage[ability.element]);
  }

  // Card type damage bonus
  if (cardMods && cardMods.typeDamage && cardMods.typeDamage[ability.type]) {
    totalDamage *= (1 + cardMods.typeDamage[ability.type]);
  }

  // Card enhancement damage bonus
  if (enhancements && enhancements.damageBonus) {
    totalDamage *= (1 + enhancements.damageBonus);
  }

  // Multi-hit abilities
  if (ability.hits && ability.hits > 1) {
    totalDamage *= ability.hits;
  }

  // Active buff: enrage multiplier
  // (checked externally by caller via _playerBuffs)

  return Math.max(1, Math.round(totalDamage));
}

// Calculate card ability damage (stat-scaling based on card template fields)
function calculateCardAbilityDamage(cardTemplate, computed, cardMods) {
  if (!cardTemplate || !cardTemplate.baseDamage) return 0;

  var base = cardTemplate.baseDamage || 0;

  // Scale from the card's scaling stat
  var scalingStat = cardTemplate.scalingStat || 'acumen';
  var scalingFactor = cardTemplate.scalingFactor || 0.5;
  var statValue = 5;
  if (computed && scalingStat) {
    // Map stat names to computed values
    if (scalingStat === 'acumen') statValue = computed.magicPowerMultiplier || 1;
    else if (scalingStat === 'might') statValue = computed.meleeDamageMultiplier || 1;
    else if (scalingStat === 'finesse') statValue = (computed.critChance || 0.05) * 20;
    else if (scalingStat === 'resolve') statValue = (computed.magicResist || 0.15) * 20;
    else if (scalingStat === 'vigor') statValue = (computed.hp || 100) / 20;
    else if (scalingStat === 'ingenuity') statValue = (computed.craftSpeedBonus || 1) * 5;
    else statValue = 5;
  }

  var totalDamage = base + (statValue * scalingFactor * 5);

  // Card element damage bonus from modifiers
  var element = cardTemplate.element || null;
  if (element && cardMods && cardMods.elementDamage && cardMods.elementDamage[element]) {
    totalDamage *= (1 + cardMods.elementDamage[element]);
  }

  return Math.max(1, Math.round(totalDamage));
}

// Calculate card ability heal amount
function calculateCardAbilityHeal(cardTemplate, computed) {
  if (!cardTemplate) return 0;
  var base = cardTemplate.baseHeal || 0;
  if (base <= 0) return 0;

  var scalingStat = cardTemplate.scalingStat || 'resolve';
  var scalingFactor = cardTemplate.scalingFactor || 0.3;
  var statValue = 5;
  if (computed && scalingStat) {
    if (scalingStat === 'resolve') statValue = (computed.magicResist || 0.15) * 20;
    else if (scalingStat === 'acumen') statValue = computed.magicPowerMultiplier || 1;
    else if (scalingStat === 'ingenuity') statValue = (computed.craftSpeedBonus || 1) * 5;
    else statValue = 5;
  }

  return Math.max(1, Math.round(base + (statValue * scalingFactor * 5)));
}

// Check crit (base chance + ability bonus)
function rollCrit(computed, ability) {
  var critChance = computed.critChance || 0.05;
  if (ability && ability.critBonus) critChance += ability.critBonus;
  return Math.random() < critChance;
}

// Resolve equipped card instances from an account.
// Returns array of card instance objects (with full data from rpgCards).
function resolveEquippedCards(account) {
  if (!account || !account.rpgCards || !account.equippedCards) return [];
  var cardMap = {};
  for (var i = 0; i < account.rpgCards.length; i++) {
    cardMap[account.rpgCards[i].instanceId] = account.rpgCards[i];
  }
  var result = [];
  for (var j = 0; j < account.equippedCards.length; j++) {
    var cid = account.equippedCards[j];
    if (!cid || !cardMap[cid]) continue;
    var inst = cardMap[cid];
    var tmpl = rpgData.CARD_BY_ID[inst.cardId] || {};
    // Build a resolved card object: instance data + template-only combat fields
    var card = {
      instanceId: inst.instanceId,
      cardId: inst.cardId,
      name: inst.name,
      type: inst.type,
      rarity: inst.rarity,
      effects: inst.effects || [],
      icon: inst.icon,
      style: inst.style,
      fusionCount: inst.fusionCount || 0,
      raceBonus: tmpl.raceBonus || null,
      tags: tmpl.tags || null,
    };
    // Merge template-only fields for combat system
    if (tmpl.combatPassive) card.combatPassive = tmpl.combatPassive;
    if (tmpl.combatWeapon) card.combatWeapon = tmpl.combatWeapon;
    if (tmpl.combatType) card.combatType = tmpl.combatType;
    if (tmpl.baseDamage !== undefined) card.baseDamage = tmpl.baseDamage;
    if (tmpl.baseHeal !== undefined) card.baseHeal = tmpl.baseHeal;
    if (tmpl.range !== undefined) card.range = tmpl.range;
    if (tmpl.manaCost !== undefined) card.manaCost = tmpl.manaCost;
    if (tmpl.aoeRadius !== undefined) card.aoeRadius = tmpl.aoeRadius;
    if (tmpl.cooldown !== undefined) card.cooldown = tmpl.cooldown;
    if (tmpl.scalingStat) card.scalingStat = tmpl.scalingStat;
    if (tmpl.scalingFactor !== undefined) card.scalingFactor = tmpl.scalingFactor;
    if (tmpl.damageType) card.damageType = tmpl.damageType;
    if (tmpl.element) card.element = tmpl.element;
    if (tmpl.targetType) card.targetType = tmpl.targetType;
    if (tmpl.statusEffect) card.statusEffect = tmpl.statusEffect;
    if (tmpl.statusDuration !== undefined) card.statusDuration = tmpl.statusDuration;
    if (tmpl.lifesteal !== undefined) card.lifesteal = tmpl.lifesteal;
    if (tmpl.onHitTile) card.onHitTile = tmpl.onHitTile;
    // MMO-inspired card fields
    if (tmpl.onHitStatus) card.onHitStatus = tmpl.onHitStatus;
    if (tmpl.pullToSelf) card.pullToSelf = tmpl.pullToSelf;
    if (tmpl.shattersClones) card.shattersClones = tmpl.shattersClones;
    if (tmpl.damagePerClone) card.damagePerClone = tmpl.damagePerClone;
    if (tmpl.hasteMult) card.hasteMult = tmpl.hasteMult;
    if (tmpl.cooldownReduction) card.cooldownReduction = tmpl.cooldownReduction;
    if (tmpl.invulnerable) card.invulnerable = tmpl.invulnerable;
    if (tmpl.cantAttack) card.cantAttack = tmpl.cantAttack;
    if (tmpl.ccImmune) card.ccImmune = tmpl.ccImmune;
    if (tmpl.hpCost) card.hpCost = tmpl.hpCost;
    if (tmpl.cleansesDebuffs) card.cleansesDebuffs = tmpl.cleansesDebuffs;
    if (tmpl.threatDrop) card.threatDrop = tmpl.threatDrop;
    if (tmpl.tauntAoe) card.tauntAoe = tmpl.tauntAoe;
    if (tmpl.selfDamageReduction) card.selfDamageReduction = tmpl.selfDamageReduction;
    if (tmpl.reviveHpPercent) card.reviveHpPercent = tmpl.reviveHpPercent;
    if (tmpl.manaPerTurn) card.manaPerTurn = tmpl.manaPerTurn;
    if (tmpl.redirectDamage) card.redirectDamage = tmpl.redirectDamage;
    if (tmpl.animalForm) card.animalForm = tmpl.animalForm;
    if (tmpl.tileEffect) card.tileEffect = tmpl.tileEffect;
    if (tmpl.summonType) card.summonType = tmpl.summonType;
    if (tmpl.summonCount) card.summonCount = tmpl.summonCount;
    if (tmpl.summonHp) card.summonHp = tmpl.summonHp;
    if (tmpl.summonDamage) card.summonDamage = tmpl.summonDamage;
    if (tmpl.summonDuration) card.summonDuration = tmpl.summonDuration;
    if (tmpl.damageBoost) card.damageBoost = tmpl.damageBoost;
    if (tmpl.armorBoost) card.armorBoost = tmpl.armorBoost;
    if (tmpl.speedMult) card.speedMult = tmpl.speedMult;
    if (tmpl.damageReduction) card.damageReduction = tmpl.damageReduction;
    if (tmpl.damageTakenIncrease) card.damageTakenIncrease = tmpl.damageTakenIncrease;
    if (tmpl.knockbackImmune) card.knockbackImmune = tmpl.knockbackImmune;
    if (tmpl.grantsStealth) card.grantsStealth = tmpl.grantsStealth;
    // Grappler card fields
    if (tmpl.selfImmobilize) card.selfImmobilize = tmpl.selfImmobilize;
    if (tmpl.selfCantAttack) card.selfCantAttack = tmpl.selfCantAttack;
    if (tmpl.hpScaling) card.hpScaling = tmpl.hpScaling;
    if (tmpl.hpScalingPercent !== undefined) card.hpScalingPercent = tmpl.hpScalingPercent;
    if (tmpl.throwDistance) card.throwDistance = tmpl.throwDistance;
    if (tmpl.wallCollision) card.wallCollision = tmpl.wallCollision;
    if (tmpl.primaryTargetBonusDamage !== undefined) card.primaryTargetBonusDamage = tmpl.primaryTargetBonusDamage;
    if (tmpl.counterAttackPercent !== undefined) card.counterAttackPercent = tmpl.counterAttackPercent;
    if (tmpl.counterOnMelee) card.counterOnMelee = tmpl.counterOnMelee;
    // Night hunter card fields
    if (tmpl.nightDamageBonus !== undefined) card.nightDamageBonus = tmpl.nightDamageBonus;
    if (tmpl.antiStealth) card.antiStealth = tmpl.antiStealth;
    if (tmpl.damageAmpFromCaster !== undefined) card.damageAmpFromCaster = tmpl.damageAmpFromCaster;
    if (tmpl.revealPosition) card.revealPosition = tmpl.revealPosition;
    if (tmpl.bonusVsUndead !== undefined) card.bonusVsUndead = tmpl.bonusVsUndead;
    if (tmpl.bonusVsShadow !== undefined) card.bonusVsShadow = tmpl.bonusVsShadow;
    // Aquatic card fields
    if (tmpl.waterTileBonusDamage !== undefined) card.waterTileBonusDamage = tmpl.waterTileBonusDamage;
    if (tmpl.pullDistance !== undefined) card.pullDistance = tmpl.pullDistance;
    if (tmpl.shieldBase !== undefined) card.shieldBase = tmpl.shieldBase;
    if (tmpl.waterTileShieldMultiplier !== undefined) card.waterTileShieldMultiplier = tmpl.waterTileShieldMultiplier;
    // Scout card fields
    if (tmpl.passThroughEnemies) card.passThroughEnemies = tmpl.passThroughEnemies;
    if (tmpl.summonDecoy) card.summonDecoy = tmpl.summonDecoy;
    if (tmpl.decoyHp) card.decoyHp = tmpl.decoyHp;
    if (tmpl.decoyDrawsAggro) card.decoyDrawsAggro = tmpl.decoyDrawsAggro;
    // Defense archetype fields
    if (tmpl.armorBoostPercent !== undefined) card.armorBoostPercent = tmpl.armorBoostPercent;
    if (tmpl.stationaryArmorBoostPercent !== undefined) card.stationaryArmorBoostPercent = tmpl.stationaryArmorBoostPercent;
    if (tmpl.cantMove) card.cantMove = tmpl.cantMove;
    if (tmpl.dashDistance) card.dashDistance = tmpl.dashDistance;
    if (tmpl.teleportDistance) card.teleportDistance = tmpl.teleportDistance;
    result.push(card);
  }
  return result;
}

// Find equipped card instance by its template cardId.
// Returns the card instance object or null.
function findEquippedCardByTemplateId(account, cardId) {
  if (!account || !account.rpgCards || !account.equippedCards) return null;
  var cardMap = {};
  for (var i = 0; i < account.rpgCards.length; i++) {
    cardMap[account.rpgCards[i].instanceId] = account.rpgCards[i];
  }
  for (var j = 0; j < account.equippedCards.length; j++) {
    var cid = account.equippedCards[j];
    if (cid && cardMap[cid] && cardMap[cid].cardId === cardId) {
      return cardMap[cid];
    }
  }
  return null;
}

// Build card ability cooldown state for the client.
// Returns array of card abilities with current cooldown info.
function buildCardAbilityCooldownState(socketId, account) {
  var cooldowns = getPlayerCooldowns(socketId);
  var equippedCards = resolveEquippedCards(account);
  var cardMods = rpgData.computeAbilityModifiers(equippedCards);
  var now = Date.now();
  var state = [];

  for (var i = 0; i < equippedCards.length; i++) {
    var card = equippedCards[i];
    if (!card || !card.cardId) continue;

    // Look up the template to check combatType
    var template = rpgData.CARD_BY_ID[card.cardId];
    if (!template || !template.combatType) continue;
    if (!ACTIVE_COMBAT_TYPES[template.combatType]) continue;

    var cooldownKey = 'card:' + card.cardId;
    var effectiveCD = rpgData.getCardAbilityCooldown(template, cardMods);
    var effectiveMana = rpgData.getCardAbilityManaCost(template, cardMods);
    var lastUsed = cooldowns.get(cooldownKey) || 0;
    var elapsed = (now - lastUsed) / 1000;
    var remaining = Math.max(0, effectiveCD - elapsed);

    state.push({
      cardId: card.cardId,
      instanceId: card.instanceId,
      name: template.name,
      combatType: template.combatType,
      cooldown: effectiveCD,
      remaining: Math.round(remaining * 10) / 10,
      ready: remaining <= 0,
      manaCost: effectiveMana,
      baseDamage: template.baseDamage || 0,
      baseHeal: template.baseHeal || 0,
      element: template.element || null,
      range: template.range || 0,
      aoeRadius: template.aoeRadius || 0,
      targetType: template.targetType || 'enemy',
      rarity: template.rarity,
      icon: template.icon || '',
      description: template.description || '',
    });
  }

  return state;
}

// ---------------------------------------------------------------------------
// Handler module
// ---------------------------------------------------------------------------

module.exports = {
  init: function(io, socket, deps) {
    var socketAccountMap = deps.socketAccountMap;
    var state = deps.state;
    var applyRateGrace = deps.applyRateGrace;

    if (!_io) _io = io;
    if (!_state) _state = state;
    // Store socketAccountMap on state for DoT death reward lookups
    if (!_state._socketAccountMap) _state._socketAccountMap = socketAccountMap;

    // ------------------------------------------------------------------
    // get_abilities — client requests their ability bar for current weapon
    // ------------------------------------------------------------------
    socket.on('get_abilities', function() {
      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;

      var acc = accounts.loadAccount(accKey);
      if (!acc) return;

      var weaponInfo = getWeaponInfo(accKey);
      var cooldownState = buildCooldownState(socket.id, weaponInfo.family, acc.equippedCards || []);

      socket.emit('abilities_list', {
        weaponFamily: weaponInfo.family,
        abilities: cooldownState,
      });
    });

    // ------------------------------------------------------------------
    // use_ability — player uses a weapon ability on a target
    // Context: overworld (zone monsters) or dungeon
    // Data: { abilityId: string, targetId: string, context: 'overworld'|'dungeon' }
    // ------------------------------------------------------------------
    socket.on('use_ability', function(data) {
      try {
        if (!data || typeof data.abilityId !== 'string') return;
        if (!applyRateGrace(socket, 'use_ability', 20, 1000)) return;

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        var acc = accounts.loadAccount(accKey);
        if (!acc) return;

        var abilityId = data.abilityId;
        var targetId = data.targetId || null;
        var context = data.context || 'overworld';

        // 1. Get weapon info and determine weapon family
        var weaponInfo = getWeaponInfo(accKey);
        var weaponFamily = weaponInfo.family;

        // 2. Resolve ability — check it exists and belongs to this weapon
        var abilityLookup = rpgData.ABILITY_BY_ID[abilityId];
        var ability = null;
        var isUnlocked = false;

        if (abilityLookup && abilityLookup.weaponFamily === weaponFamily) {
          ability = abilityLookup.ability;
        } else {
          // Check card-unlocked abilities
          var cardMods = rpgData.computeAbilityModifiers(acc.equippedCards || []);
          if (cardMods.unlockedAbilities && cardMods.unlockedAbilities[weaponFamily]) {
            var unlocked = cardMods.unlockedAbilities[weaponFamily];
            for (var ui = 0; ui < unlocked.length; ui++) {
              if (unlocked[ui].id === abilityId) {
                ability = unlocked[ui];
                isUnlocked = true;
                break;
              }
            }
          }
        }

        if (!ability) {
          socket.emit('ability_error', { message: 'Ability not available for your current weapon' });
          return;
        }

        // 3. Check cooldown (server-authoritative)
        var cardMods2 = rpgData.computeAbilityModifiers(acc.equippedCards || []);
        var effectiveCD = rpgData.getEffectiveCooldown(ability, weaponFamily, cardMods2);
        var cooldowns = getPlayerCooldowns(socket.id);
        var lastUsed = cooldowns.get(abilityId) || 0;
        var now = Date.now();
        var elapsedSec = (now - lastUsed) / 1000;

        if (effectiveCD > 0 && elapsedSec < effectiveCD) {
          var remaining = Math.round((effectiveCD - elapsedSec) * 10) / 10;
          socket.emit('ability_error', { message: 'Ability on cooldown (' + remaining + 's remaining)', cooldownRemaining: remaining });
          return;
        }

        // 3b. Collect combat card passive effects
        var combatCards = collectCombatCardEffects(accKey);

        // 4. Check mana cost (apply mana_efficiency card effect)
        var effectiveMana = rpgData.getEffectiveManaCost(ability, cardMods2);
        if (combatCards.manaEfficiency > 0 && effectiveMana > 0) {
          effectiveMana = Math.max(1, Math.round(effectiveMana * (1 - combatCards.manaEfficiency)));
        }
        var computed = rpgData.computeStats(acc.rpgStats || rpgData.getDefaultStats(), acc.level || 1, acc.race);

        // --- HP Multiplier / Damage Sponge: modify computed.hp ---
        var wHpMult = getAccCombatPassive(acc, 'hp_multiplier');
        var wDmgSponge = getAccCombatPassive(acc, 'damage_sponge');
        if (wHpMult || wDmgSponge) {
          computed = Object.create(computed);
          if (wHpMult) computed.hp = Math.floor((computed.hp || 100) * (1 + (wHpMult.value || 0.15)));
          if (wDmgSponge) computed.hp = Math.floor((computed.hp || 100) * (1 + (wDmgSponge.hpBonusPercent || 0.15)));
        }

        // --- Aquatic Adaptation: +30% all stats in water zones ---
        var wAquaPassive = getAccCombatPassive(acc, 'aquatic_adaptation');
        if (wAquaPassive) {
          var wAquaZone = state.playerZones ? state.playerZones.get(socket.id) : null;
          var wAquaZoneLower = (wAquaZone || '').toLowerCase();
          if (/lake|river|ocean|sea|swamp|marsh|coast|tidal|flooded|aqua|murkmire/.test(wAquaZoneLower)) {
            var wAquaBonus = wAquaPassive.waterTileStatBonus || 0.30;
            computed = Object.create(computed);
            computed.hp = Math.floor((computed.hp || 100) * (1 + wAquaBonus));
            computed.meleeDamageMultiplier = (computed.meleeDamageMultiplier || 1) * (1 + wAquaBonus);
            computed.magicPowerMultiplier = (computed.magicPowerMultiplier || 1) * (1 + wAquaBonus);
            computed.critChance = Math.min(0.75, (computed.critChance || 0.05) * (1 + wAquaBonus));
            computed.magicResist = Math.min(0.75, (computed.magicResist || 0.15) * (1 + wAquaBonus));
          }
        }

        // Use persistent overworld mana tracking or dungeon combat state
        var dungeonCombat = null;
        var manaState = null;
        var playerMana;
        if (context === 'dungeon' && deps.getPlayerCombat) {
          dungeonCombat = deps.getPlayerCombat(socket.id);
          if (dungeonCombat) {
            playerMana = dungeonCombat.mana || 0;
          } else {
            playerMana = 50 + ((acc.rpgStats || {}).acumen || 5) * 5;
          }
        } else {
          // Overworld: use persistent mana pool
          manaState = getOrInitPlayerMana(socket.id, accKey);
          playerMana = manaState.current;
        }

        if (effectiveMana > 0 && playerMana < effectiveMana) {
          socket.emit('ability_error', { message: 'Not enough mana (' + effectiveMana + ' required, have ' + playerMana + ')' });
          return;
        }

        // 5. Find target (if damage ability)
        var targetHp = 0;
        var targetMaxHp = 0;
        var targetDef = 0;
        var targetMonster = null;
        var zoneId = null;

        if (ability.damage > 0 || ability.type === 'heal') {
          if (context === 'overworld') {
            // Find monster in overworld zone
            zoneId = state.playerZones.get(socket.id);
            if (!zoneId) {
              socket.emit('ability_error', { message: 'Not in a zone' });
              return;
            }

            if (ability.type !== 'heal' && targetId) {
              var monsterList = state.zoneMonsters ? state.zoneMonsters.get(zoneId) : null;
              if (monsterList) {
                for (var mi = 0; mi < monsterList.length; mi++) {
                  if (monsterList[mi].id === targetId && monsterList[mi].alive) {
                    targetMonster = monsterList[mi];
                    break;
                  }
                }
              }
              if (!targetMonster) {
                socket.emit('ability_error', { message: 'Target not found' });
                return;
              }
              // Check if target is already in combat with another player
              if (targetMonster.inCombat) {
                socket.emit('ability_result', { success: false, error: 'Target is in combat with another player' });
                return;
              }
              targetHp = targetMonster.hp;
              targetMaxHp = targetMonster.maxHp || targetMonster.hp;
              targetDef = targetMonster.def || 0;

              // Range check for overworld
              var pos = state.playerPositions.get(socket.id);
              if (pos) {
                var dx = pos.x - targetMonster.x;
                var dy = pos.y - targetMonster.y;
                var distSq = dx * dx + dy * dy;
                var maxRange = 96; // ~3 tiles for abilities
                if (distSq > maxRange * maxRange) {
                  socket.emit('ability_error', { message: 'Target is out of range' });
                  return;
                }
              }
            }
          }
          // Dungeon targets are handled through the existing turn-based combat system;
          // for dungeon real-time abilities, we validate target from floor data.
        }

        // 6. Check conditions (Execute, Decapitate, etc.)
        if (ability.condition && targetMonster) {
          if (!checkCondition(ability.condition, targetHp, targetMaxHp)) {
            socket.emit('ability_error', { message: 'Condition not met: target HP too high' });
            return;
          }
        }

        // 7. Record cooldown timestamp
        cooldowns.set(abilityId, now);

        // 8. Deduct mana
        if (effectiveMana > 0) {
          if (dungeonCombat) {
            dungeonCombat.mana = Math.max(0, dungeonCombat.mana - effectiveMana);
          } else if (manaState) {
            manaState.current = Math.max(0, manaState.current - effectiveMana);
          }
        }

        // 9. Calculate effects
        var enhancements = (cardMods2.enhancements && cardMods2.enhancements[abilityId]) ? cardMods2.enhancements[abilityId] : null;
        var result = {
          abilityId: abilityId,
          abilityName: ability.name,
          type: ability.type,
          success: true,
          damage: 0,
          crit: false,
          aoe: ability.aoe || false,
          effects: [],
          targetId: targetId,
          damageType: ability.damageType || null,
        };

        // Apply active enrage buff
        var activeBuffs = cleanExpiredBuffs(socket.id);
        var enrageMult = 1.0;
        for (var bi = 0; bi < activeBuffs.length; bi++) {
          if (activeBuffs[bi].effect === 'enrage') {
            enrageMult *= (activeBuffs[bi].multiplier || 1.4);
          }
        }

        if (ability.damage > 0 && targetMonster) {
          // Calculate raw damage
          var rawDamage = calculateAbilityDamage(ability, weaponInfo, computed, cardMods2, enhancements);
          rawDamage = Math.round(rawDamage * enrageMult);

          // Card: spell_damage_bonus — bonus damage for magic-type abilities
          if (combatCards.spellDmgBonus > 0 && ability.type === 'magic') {
            rawDamage = Math.round(rawDamage * (1 + combatCards.spellDmgBonus));
          }

          // Card: poison_damage_bonus — bonus damage for poison element
          if (combatCards.poisonDmgBonus > 0 && (ability.element === 'poison' || ability.damageType === 'poison')) {
            rawDamage = Math.round(rawDamage * (1 + combatCards.poisonDmgBonus));
          }

          // --- Hunter's Instinct: +15% damage vs debuffed enemies ---
          var wHunterPassive = getAccCombatPassive(acc, 'hunters_instinct');
          if (wHunterPassive && isMonsterDebuffed(targetMonster)) {
            rawDamage = Math.round(rawDamage * (1 + (wHunterPassive.damageVsDebuffed || 0.15)));
            result.effects.push({ type: 'passive_proc', source: 'hunters_instinct', bonus: 'damage_vs_debuffed' });
          }

          // --- Predator's Mark Damage Amp: +15% if monster is marked by this player ---
          if (targetMonster && targetMonster.predatorsMarkSource === socket.id) {
            var wMarkNow = Date.now();
            if (targetMonster.predatorsMarkUntil && targetMonster.predatorsMarkUntil > wMarkNow) {
              var wMarkAmp = targetMonster.predatorsMarkDamageAmp || 0.15;
              rawDamage = Math.round(rawDamage * (1 + wMarkAmp));
              result.effects.push({ type: 'passive_proc', source: 'predators_mark_amp', bonus: wMarkAmp });
            }
          }

          // --- Hot Streak buff: +50% damage from weapon abilities too ---
          for (var whsI = activeBuffs.length - 1; whsI >= 0; whsI--) {
            if (activeBuffs[whsI].effect === 'hot_streak') {
              rawDamage = Math.round(rawDamage * 1.50);
              activeBuffs.splice(whsI, 1);
              break;
            }
          }

          // --- Hunter's Instinct: +10% crit chance vs marked targets ---
          if (wHunterPassive && isMonsterMarked(targetMonster)) {
            var wHunterCritBonus = wHunterPassive.critVsMarked || 0.10;
            computed = Object.create(computed);
            computed.critChance = (computed.critChance || 0.05) + wHunterCritBonus;
          }

          // --- Shadow Sight: +10% accuracy bonus (partial crit bonus in overworld) ---
          var wShadowSight = getAccCombatPassive(acc, 'shadow_sight');
          if (wShadowSight && wShadowSight.accuracyBonus) {
            computed = Object.create(computed);
            computed.critChance = (computed.critChance || 0.05) + (wShadowSight.accuracyBonus * 0.5);
          }

          // Check crit
          var isCrit = rollCrit(computed, ability);
          if (isCrit) {
            var wCritMult = 2.0;
            // Shatter passive: +30% crit damage vs stunned/slowed
            var wShatter = getAccCombatPassive(acc, 'shatter');
            if (wShatter && targetMonster && (targetMonster.stunned || targetMonster.slowed)) {
              wCritMult += (wShatter.value || 0.30);
            }
            // --- Crit Damage Bonus passive: flat crit multiplier increase ---
            var wCritDmgBonus = getAccCombatPassiveTotal(acc, 'crit_damage_bonus');
            if (wCritDmgBonus > 0) {
              wCritMult += wCritDmgBonus;
            }
            rawDamage = Math.round(rawDamage * wCritMult);
          }

          // Hot streak tracking: consecutive crits on weapon abilities
          if (isCrit) {
            var wHsPassive = getAccCombatPassive(acc, 'hot_streak');
            if (wHsPassive) {
              var wHsCount = (_hotStreakCounts.get(socket.id) || 0) + 1;
              if (wHsCount >= 2) {
                var wHsBuffs = getPlayerBuffs(socket.id);
                wHsBuffs.push({
                  effect: 'hot_streak',
                  expiry: now + 15000,
                  freeAbility: true,
                  source: 'hot_streak_passive',
                });
                result.effects.push({ type: 'buff', effect: 'hot_streak', duration: 15 });
                wHsCount = 0;
              }
              _hotStreakCounts.set(socket.id, wHsCount);
            }
          } else {
            _hotStreakCounts.set(socket.id, 0);
          }

          // Apply defense
          var finalDamage = Math.max(1, rawDamage - Math.floor(targetDef * 0.5));

          // Apply damage type multiplier
          var abilityDamageType = ability.damageType || null;
          if (abilityDamageType) {
            var targetResistances = rpgData.getMonsterResistances(targetMonster);
            var dtMultiplier = rpgData.calculateDamageMultiplier(abilityDamageType, targetResistances);
            finalDamage = Math.max(1, Math.round(finalDamage * dtMultiplier));
            result.damageTypeMultiplier = dtMultiplier;
          }

          result.damage = finalDamage;
          result.crit = isCrit;

          // Apply damage to monster
          if (context === 'overworld' && targetMonster) {
            targetMonster.hp = Math.max(0, targetMonster.hp - finalDamage);
            targetMonster.lastAttackedTime = now;
            result.targetHp = targetMonster.hp;
            result.targetMaxHp = targetMonster.maxHp;

            // AoE: damage nearby monsters too
            if (ability.aoe && zoneId) {
              var aoeDamage = Math.round(finalDamage * 0.6);
              var aoeMonsterList = state.zoneMonsters ? state.zoneMonsters.get(zoneId) : null;
              var aoeHits = [];
              if (aoeMonsterList) {
                for (var ai = 0; ai < aoeMonsterList.length; ai++) {
                  var aoeMob = aoeMonsterList[ai];
                  if (!aoeMob.alive || aoeMob.id === targetId) continue;
                  var adx = targetMonster.x - aoeMob.x;
                  var ady = targetMonster.y - aoeMob.y;
                  if (adx * adx + ady * ady < 128 * 128) {
                    var aoeRaw = Math.max(1, aoeDamage - Math.floor((aoeMob.def || 0) * 0.5));
                    // Apply damage type multiplier to AoE targets too
                    if (abilityDamageType) {
                      var aoeMobRes = rpgData.getMonsterResistances(aoeMob);
                      var aoeDtMult = rpgData.calculateDamageMultiplier(abilityDamageType, aoeMobRes);
                      aoeRaw = Math.max(1, Math.round(aoeRaw * aoeDtMult));
                    }
                    aoeMob.hp = Math.max(0, aoeMob.hp - aoeRaw);
                    aoeMob.lastAttackedTime = now;
                    aoeHits.push({ id: aoeMob.id, damage: aoeRaw, hp: aoeMob.hp, maxHp: aoeMob.maxHp || aoeMob.hp });
                    if (aoeMob.hp <= 0) aoeMob.alive = false;
                  }
                }
              }
              result.aoeHits = aoeHits;
            }

            // Check if target died
            if (targetMonster.hp <= 0) {
              targetMonster.alive = false;
              result.targetDied = true;
            }

            // --- Atonement Passive: heal self for 20% of damage dealt ---
            if (finalDamage > 0) {
              var wAtonement = getAccCombatPassive(acc, 'atonement');
              if (wAtonement) {
                var wAtonHeal = Math.max(1, Math.floor(finalDamage * (wAtonement.value || 0.20)));
                result.effects.push({ type: 'heal', amount: wAtonHeal, source: 'atonement' });
                if (dungeonCombat) {
                  dungeonCombat.hp = Math.min(dungeonCombat.maxHp, dungeonCombat.hp + wAtonHeal);
                }
              }
            }

            // --- Siphoning Strikes: weapon attacks restore 3% max HP ---
            var wSiphPassive = getAccCombatPassive(acc, 'siphoning_strikes');
            if (wSiphPassive && finalDamage > 0) {
              var wSiphHeal = Math.max(1, Math.floor((computed.hp || 100) * (wSiphPassive.value || 0.03)));
              result.effects.push({ type: 'heal', amount: wSiphHeal, source: 'siphoning_strikes' });
              if (dungeonCombat) {
                dungeonCombat.hp = Math.min(dungeonCombat.maxHp, dungeonCombat.hp + wSiphHeal);
              }
            }

            // --- Soul Shards: +1 per kill from weapon abilities ---
            if (targetMonster && !targetMonster.alive) {
              var wSsPassive = getAccCombatPassive(acc, 'soul_shards');
              if (wSsPassive) {
                var wCurShards = (_soulShards.get(socket.id) || 0) + 1;
                if (wCurShards >= 5) {
                  var wSsBuffs = getPlayerBuffs(socket.id);
                  wSsBuffs.push({
                    effect: 'soul_shards_empowered',
                    expiry: now + 30000,
                    source: 'soul_shards',
                  });
                  result.effects.push({ type: 'buff', effect: 'soul_shards_empowered', duration: 30 });
                  wCurShards = 0;
                }
                _soulShards.set(socket.id, wCurShards);
              }
            }

            // --- On-Hit Poison passive: 15% chance to apply poison DoT ---
            if (finalDamage > 0 && targetMonster && targetMonster.alive) {
              var wPoisonPassive = getAccCombatPassive(acc, 'on_hit_poison');
              if (wPoisonPassive && Math.random() < (wPoisonPassive.chance || 0.15)) {
                var wPoisonTick = wPoisonPassive.tickDamage || 3;
                var wPoisonDur = wPoisonPassive.duration || 3;
                result.effects.push({ type: 'dot', name: 'poison', tickDamage: wPoisonTick, duration: wPoisonDur, source: 'on_hit_poison' });
                if (zoneId) {
                  if (!_monsterDoTs.has(targetId)) _monsterDoTs.set(targetId, []);
                  _monsterDoTs.get(targetId).push({
                    tickDamage: wPoisonTick, remainingTicks: wPoisonDur,
                    sourceSocketId: socket.id, zoneId: zoneId, name: 'Poison',
                  });
                }
              }

              // --- On-Hit Bleed passive: 10% chance to apply bleed DoT ---
              var wBleedPassive = getAccCombatPassive(acc, 'on_hit_bleed');
              if (wBleedPassive && Math.random() < (wBleedPassive.chance || 0.10)) {
                var wBleedTick = wBleedPassive.tickDamage || 4;
                var wBleedDur = wBleedPassive.duration || 3;
                result.effects.push({ type: 'dot', name: 'bleed', tickDamage: wBleedTick, duration: wBleedDur, source: 'on_hit_bleed' });
                if (zoneId) {
                  if (!_monsterDoTs.has(targetId)) _monsterDoTs.set(targetId, []);
                  _monsterDoTs.get(targetId).push({
                    tickDamage: wBleedTick, remainingTicks: wBleedDur,
                    sourceSocketId: socket.id, zoneId: zoneId, name: 'Bleed',
                  });
                }
              }

              // --- Proc Explosion passive: 15% chance for secondary explosion damage ---
              var wExplosionPassive = getAccCombatPassive(acc, 'proc_explosion');
              if (wExplosionPassive && Math.random() < (wExplosionPassive.chance || 0.15)) {
                var wExpDmg = wExplosionPassive.damage || 10;
                targetMonster.hp = Math.max(0, targetMonster.hp - wExpDmg);
                result.effects.push({ type: 'proc', name: 'explosion', damage: wExpDmg, source: 'proc_explosion' });
                if (targetMonster.hp <= 0) {
                  targetMonster.alive = false;
                  result.targetDied = true;
                }
                result.targetHp = targetMonster.hp;
              }

              // --- Mana on Magic Hit: recover 15% of magic damage dealt as mana ---
              if (ability.type === 'magic') {
                var wManaOnHit = getAccCombatPassive(acc, 'mana_on_magic_hit');
                if (wManaOnHit) {
                  var wManaRestore = Math.max(1, Math.floor(finalDamage * (wManaOnHit.value || 0.15)));
                  if (manaState) {
                    manaState.current = Math.min(manaState.max, manaState.current + wManaRestore);
                  } else if (dungeonCombat) {
                    dungeonCombat.mana = Math.min(dungeonCombat.maxMana || 100, dungeonCombat.mana + wManaRestore);
                  }
                  result.effects.push({ type: 'mana_restore', amount: wManaRestore, source: 'mana_on_magic_hit' });
                }
              }
            }
          }
        } else if (ability.type === 'heal') {
          // Self-heal
          var healBase = (weaponInfo.magicDamage || 5) + (computed.magicPowerMultiplier * 5);
          var healAmount = Math.round(healBase * (ability.healMultiplier || 1.5));
          result.healAmount = healAmount;
          result.effects.push({ type: 'heal', amount: healAmount });

          if (dungeonCombat) {
            dungeonCombat.hp = Math.min(dungeonCombat.maxHp, dungeonCombat.hp + healAmount);
            result.playerHp = dungeonCombat.hp;
            result.playerMaxHp = dungeonCombat.maxHp;
          }
        } else if (ability.type === 'defensive' || ability.type === 'buff') {
          // Apply buff to player
          var buffDuration = (ability.duration || 5) * 1000;
          var buff = {
            effect: ability.effect,
            expiry: now + buffDuration,
            abilityId: abilityId,
          };

          if (ability.effect === 'dodge_buff') buff.dodgeBonus = ability.dodgeBonus || 0.20;
          if (ability.effect === 'armor_buff') buff.armorBonus = ability.armorBonus || 10;
          if (ability.effect === 'block_next') buff.blocksRemaining = 1;
          if (ability.effect === 'mana_shield') buff.absorbPercent = ability.absorbPercent || 0.5;
          if (ability.effect === 'magic_barrier') buff.absorbFlat = ability.absorbFlat || 50;
          if (ability.effect === 'counter') buff.counterMultiplier = ability.counterMultiplier || 2.0;
          if (ability.effect === 'enrage') buff.multiplier = ability.buffMultiplier || 1.4;

          var buffs = getPlayerBuffs(socket.id);
          buffs.push(buff);
          result.effects.push({ type: 'buff', effect: ability.effect, duration: ability.duration });
        }

        // Apply DoT from ability or card enhancement as ticking damage
        var dotToApply = ability.dot || (enhancements ? enhancements.addDot : null);
        if (dotToApply && targetMonster && targetMonster.alive && targetId && zoneId) {
          var dotTickDamage = Math.max(1, Math.round((dotToApply.tickDamage || 0.2) * (weaponInfo.damage || 5)));
          var dotDuration = dotToApply.duration || 3;
          result.effects.push({ type: 'dot', name: dotToApply.name, tickDamage: dotTickDamage, duration: dotDuration });
          result.dotTickDamage = dotTickDamage;
          result.dotDuration = dotDuration;

          // Register the DoT in the ticking system
          if (!_monsterDoTs.has(targetId)) {
            _monsterDoTs.set(targetId, []);
          }
          _monsterDoTs.get(targetId).push({
            tickDamage: dotTickDamage,
            remainingTicks: dotDuration,
            sourceSocketId: socket.id,
            zoneId: zoneId,
            name: dotToApply.name || 'DoT',
          });
        }

        // Apply card-enhanced stun effect
        if (enhancements && enhancements.addEffect === 'stun' && targetMonster) {
          result.effects.push({ type: 'stun', duration: enhancements.addDuration || 1 });
        }

        // Wire overworld status effects on monsters
        if (ability.effect && targetMonster && targetMonster.alive) {
          var statusNow = Date.now();
          if (ability.effect === 'stun') {
            targetMonster.stunned = true;
            targetMonster.stunnedUntil = statusNow + 3000;
            result.effects.push({ type: 'status', name: 'stun', duration: 3 });
          } else if (ability.effect === 'slow') {
            targetMonster.slowed = true;
            targetMonster.slowedUntil = statusNow + 5000;
            result.effects.push({ type: 'status', name: 'slow', duration: 5 });
          } else if (ability.effect === 'weaken') {
            targetMonster.weakened = 0.7; // 30% damage reduction
            result.effects.push({ type: 'status', name: 'weaken', duration: 0, value: 0.7 });
          } else if (ability.effect === 'armor_break') {
            targetMonster.armorBroken = true;
            targetMonster.armorBrokenUntil = statusNow + 8000;
            result.effects.push({ type: 'status', name: 'armor_break', duration: 8 });
          }
          result.statusEffects = result.effects.filter(function(e) { return e.type === 'status'; });
        }

        // Include current mana in result
        var currentMana = manaState ? manaState.current : (dungeonCombat ? dungeonCombat.mana : 0);
        var maxManaVal = manaState ? manaState.max : (dungeonCombat ? (dungeonCombat.maxMana || 100) : 0);
        result.mana = currentMana;
        result.maxMana = maxManaVal;

        // 10. Emit results
        socket.emit('ability_result', result);

        // Track ability use and crit hits for daily challenges
        challengesHandler.trackChallengeProgress(accounts, accKey, 'ability_use', 1);
        if (result.crit) {
          challengesHandler.trackChallengeProgress(accounts, accKey, 'crit_hit', 1);
        }

        // Emit to nearby players for visual feedback
        if (!zoneId) zoneId = state.playerZones ? state.playerZones.get(socket.id) : null;
        if (zoneId) {
          socket.to('zone:' + zoneId).emit('ability_used', {
            playerId: socket.id,
            playerName: deps.user ? deps.user.name : 'Player',
            abilityId: abilityId,
            abilityName: ability.name,
            targetId: targetId,
            damage: result.damage,
            crit: result.crit,
            aoe: result.aoe,
            type: ability.type,
            element: ability.element || null,
            damageType: ability.damageType || null,
          });
        }

        // 11. Send updated cooldown state
        var updatedCooldowns = buildCooldownState(socket.id, weaponFamily, acc.equippedCards || []);
        socket.emit('cooldown_update', {
          weaponFamily: weaponFamily,
          abilities: updatedCooldowns,
          mana: manaState ? manaState.current : (dungeonCombat ? dungeonCombat.mana : 0),
          maxMana: manaState ? manaState.max : (dungeonCombat ? (dungeonCombat.maxMana || 100) : 0),
        });

        // 12. Handle monster death rewards in overworld
        if (context === 'overworld' && targetMonster && !targetMonster.alive) {
          handleMonsterDeath(io, socket, deps, accKey, targetMonster, targetId, zoneId, state);
          // Also handle AoE kills
          if (result.aoeHits) {
            for (var ahi = 0; ahi < result.aoeHits.length; ahi++) {
              var aoeHit = result.aoeHits[ahi];
              if (aoeHit.hp <= 0) {
                handleAoeMonsterDeath(io, socket, deps, accKey, aoeHit.id, zoneId, state);
              }
            }
          }
        }

      } catch (err) {
        console.error('[combat] use_ability error:', err.message);
        socket.emit('ability_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // use_card_ability — player uses an equipped card's active ability
    // Data: { cardId: string, targetId: string, context: 'overworld'|'dungeon' }
    // ------------------------------------------------------------------
    socket.on('use_card_ability', function(data) {
      try {
        if (!data || typeof data.cardId !== 'string') return;
        if (!applyRateGrace(socket, 'use_card_ability', 20, 1000)) return;

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) return;

        var acc = accounts.loadAccount(accKey);
        if (!acc) return;

        // --- Initialize MMO passive tracking on first card ability use ---
        if (!_lilyTokens.has(socket.id) && getAccCombatPassive(acc, 'lily_of_the_field')) {
          _lilyTokens.set(socket.id, { tokens: 0, lastTick: Date.now() });
        }
        if (!_staggerDoTs.has(socket.id) && getAccCombatPassive(acc, 'stagger')) {
          _staggerDoTs.set(socket.id, { remaining: 0, tickDamage: 0 });
        }

        var cardId = data.cardId;
        var targetId = data.targetId || null;
        var context = data.context || 'overworld';

        // 1. Validate the card is equipped on the player
        var equippedCardInstance = findEquippedCardByTemplateId(acc, cardId);
        if (!equippedCardInstance) {
          socket.emit('card_ability_error', { message: 'Card is not equipped' });
          return;
        }

        // 2. Look up the card template and check it has an active combatType
        var cardTemplate = rpgData.CARD_BY_ID[cardId];
        if (!cardTemplate) {
          socket.emit('card_ability_error', { message: 'Unknown card' });
          return;
        }

        if (!cardTemplate.combatType || !ACTIVE_COMBAT_TYPES[cardTemplate.combatType]) {
          socket.emit('card_ability_error', { message: 'This card does not have an active ability' });
          return;
        }

        // 3. Check cooldown (uses shared cooldown map, prefixed with 'card:')
        var equippedCards = resolveEquippedCards(acc);
        var cardMods = rpgData.computeAbilityModifiers(equippedCards);
        var cooldownKey = 'card:' + cardId;
        var effectiveCD = rpgData.getCardAbilityCooldown(cardTemplate, cardMods);
        var cooldowns = getPlayerCooldowns(socket.id);
        var lastUsed = cooldowns.get(cooldownKey) || 0;
        var now = Date.now();
        var elapsedSec = (now - lastUsed) / 1000;

        if (effectiveCD > 0 && elapsedSec < effectiveCD) {
          var remaining = Math.round((effectiveCD - elapsedSec) * 10) / 10;
          socket.emit('card_ability_error', { message: 'Card ability on cooldown (' + remaining + 's remaining)', cooldownRemaining: remaining });
          return;
        }

        // 4. Check mana cost
        var effectiveMana = rpgData.getCardAbilityManaCost(cardTemplate, cardMods);
        var computed = rpgData.computeStats(acc.rpgStats || rpgData.getDefaultStats(), acc.level || 1, acc.race);

        // --- HP Multiplier / Damage Sponge: modify computed.hp ---
        var cHpMult = getAccCombatPassive(acc, 'hp_multiplier');
        var cDmgSponge = getAccCombatPassive(acc, 'damage_sponge');
        if (cHpMult || cDmgSponge) {
          computed = Object.create(computed);
          if (cHpMult) computed.hp = Math.floor((computed.hp || 100) * (1 + (cHpMult.value || 0.15)));
          if (cDmgSponge) computed.hp = Math.floor((computed.hp || 100) * (1 + (cDmgSponge.hpBonusPercent || 0.15)));
        }

        // --- Aquatic Adaptation: +30% all stats in water zones ---
        var cAquaPassive = getAccCombatPassive(acc, 'aquatic_adaptation');
        if (cAquaPassive) {
          var cAquaZone = state.playerZones ? state.playerZones.get(socket.id) : null;
          var cAquaZoneLower = (cAquaZone || '').toLowerCase();
          if (/lake|river|ocean|sea|swamp|marsh|coast|tidal|flooded|aqua|murkmire/.test(cAquaZoneLower)) {
            var cAquaBonus = cAquaPassive.waterTileStatBonus || 0.30;
            computed = Object.create(computed);
            computed.hp = Math.floor((computed.hp || 100) * (1 + cAquaBonus));
            computed.meleeDamageMultiplier = (computed.meleeDamageMultiplier || 1) * (1 + cAquaBonus);
            computed.magicPowerMultiplier = (computed.magicPowerMultiplier || 1) * (1 + cAquaBonus);
            computed.critChance = Math.min(0.75, (computed.critChance || 0.05) * (1 + cAquaBonus));
            computed.magicResist = Math.min(0.75, (computed.magicResist || 0.15) * (1 + cAquaBonus));
          }
        }

        var dungeonCombat = null;
        var cardManaState = null;
        var playerMana;
        if (context === 'dungeon' && deps.getPlayerCombat) {
          dungeonCombat = deps.getPlayerCombat(socket.id);
          if (dungeonCombat) {
            playerMana = dungeonCombat.mana || 0;
          } else {
            playerMana = 50 + ((acc.rpgStats || {}).acumen || 5) * 5;
          }
        } else {
          // Overworld: use persistent mana pool
          cardManaState = getOrInitPlayerMana(socket.id, accKey);
          playerMana = cardManaState.current;
        }

        if (effectiveMana > 0 && playerMana < effectiveMana) {
          socket.emit('card_ability_error', { message: 'Not enough mana (' + effectiveMana + ' required)' });
          return;
        }

        // 5. Find target for damage/debuff abilities
        var targetMonster = null;
        var zoneId = null;

        if (context === 'overworld') {
          zoneId = state.playerZones ? state.playerZones.get(socket.id) : null;
        }

        var needsTarget = (cardTemplate.combatType === 'damage' || cardTemplate.combatType === 'debuff' || cardTemplate.combatType === 'dot');
        if (needsTarget && context === 'overworld' && targetId && zoneId) {
          var monsterList = state.zoneMonsters ? state.zoneMonsters.get(zoneId) : null;
          if (monsterList) {
            for (var mi = 0; mi < monsterList.length; mi++) {
              if (monsterList[mi].id === targetId && monsterList[mi].alive) {
                targetMonster = monsterList[mi];
                break;
              }
            }
          }
          if (!targetMonster) {
            socket.emit('card_ability_error', { message: 'Target not found' });
            return;
          }

          // Range check
          var pos = state.playerPositions ? state.playerPositions.get(socket.id) : null;
          if (pos && targetMonster) {
            var dx = pos.x - targetMonster.x;
            var dy = pos.y - targetMonster.y;
            var distSq = dx * dx + dy * dy;
            var maxRange = (cardTemplate.range || 3) * 32;
            if (maxRange < 64) maxRange = 64;
            if (distSq > maxRange * maxRange) {
              socket.emit('card_ability_error', { message: 'Target is out of range' });
              return;
            }
          }
        }

        // 6. Record cooldown timestamp
        cooldowns.set(cooldownKey, now);

        // 7. Deduct mana
        if (effectiveMana > 0) {
          if (dungeonCombat) {
            dungeonCombat.mana = Math.max(0, dungeonCombat.mana - effectiveMana);
          } else if (cardManaState) {
            cardManaState.current = Math.max(0, cardManaState.current - effectiveMana);
          }
        }

        // 8. Calculate and apply effects based on combatType
        var result = {
          cardId: cardId,
          cardName: cardTemplate.name,
          combatType: cardTemplate.combatType,
          success: true,
          damage: 0,
          crit: false,
          aoe: (cardTemplate.aoeRadius || 0) > 0,
          effects: [],
          targetId: targetId,
          element: cardTemplate.element || null,
        };

        // Apply active enrage buff
        var activeBuffs = cleanExpiredBuffs(socket.id);
        var enrageMult = 1.0;
        for (var bi = 0; bi < activeBuffs.length; bi++) {
          if (activeBuffs[bi].effect === 'enrage') {
            enrageMult *= (activeBuffs[bi].multiplier || 1.4);
          }
        }

        // --- Combo Chain validation (real-time: check last combo state) ---
        var comboCardIdLower = (cardId || '').toLowerCase();
        if (comboCardIdLower === 'combo_savage_blow') {
          var comboSt = _comboState.get(socket.id);
          if (!comboSt || comboSt.lastCombo !== 'combo_rising_edge' || (now - comboSt.usedAt) > 10000) {
            socket.emit('card_ability_error', { message: 'Must use Rising Edge first' });
            return;
          }
        }
        if (comboCardIdLower === 'combo_full_thrust') {
          var comboSt2 = _comboState.get(socket.id);
          if (!comboSt2 || comboSt2.lastCombo !== 'combo_savage_blow' || (now - comboSt2.usedAt) > 10000) {
            socket.emit('card_ability_error', { message: 'Must use Savage Blow first' });
            return;
          }
        }

        // --- Hot Streak: free mana override ---
        var hotStreakActive = false;
        for (var hsCI = 0; hsCI < activeBuffs.length; hsCI++) {
          if (activeBuffs[hsCI].effect === 'hot_streak') {
            hotStreakActive = true;
            break;
          }
        }

        if (cardTemplate.combatType === 'damage') {
          // Damage card ability
          var rawDamage = calculateCardAbilityDamage(cardTemplate, computed, cardMods);
          rawDamage = Math.round(rawDamage * enrageMult);

          // --- Night Damage Bonus: +X% damage during nighttime ---
          if (cardTemplate.nightDamageBonus && isNightTime()) {
            rawDamage = Math.round(rawDamage * (1 + cardTemplate.nightDamageBonus));
            result.effects.push({ type: 'passive_proc', source: 'night_damage', bonus: cardTemplate.nightDamageBonus });
          }

          // --- Bonus vs Undead/Shadow: flat bonus damage against undead/shadow monsters ---
          if (targetMonster) {
            if (cardTemplate.bonusVsUndead && isMonsterUndead(targetMonster)) {
              rawDamage += cardTemplate.bonusVsUndead;
              result.effects.push({ type: 'passive_proc', source: 'bonus_vs_undead', bonus: cardTemplate.bonusVsUndead });
            }
            if (cardTemplate.bonusVsShadow && isMonsterShadow(targetMonster)) {
              rawDamage += cardTemplate.bonusVsShadow;
              result.effects.push({ type: 'passive_proc', source: 'bonus_vs_shadow', bonus: cardTemplate.bonusVsShadow });
            }
          }

          // --- HP Scaling: add % of max HP as bonus damage ---
          if (cardTemplate.hpScaling && cardTemplate.hpScalingPercent) {
            var maxHpForScaling = computed.hp || 100;
            rawDamage += Math.floor(maxHpForScaling * cardTemplate.hpScalingPercent);
          }

          // --- Water Tile Bonus Damage: +X% on water tiles (overworld zone check) ---
          if (cardTemplate.waterTileBonusDamage && zoneId) {
            // In overworld, check if zone name or biome suggests water
            var zoneLower = (zoneId || '').toLowerCase();
            var isWaterZone = /lake|river|ocean|sea|swamp|marsh|coast|tidal|flooded|aqua|murkmire/.test(zoneLower);
            if (isWaterZone) {
              rawDamage = Math.round(rawDamage * (1 + cardTemplate.waterTileBonusDamage));
              result.effects.push({ type: 'passive_proc', source: 'water_tile_bonus', bonus: cardTemplate.waterTileBonusDamage });
            }
          }

          // --- Hunter's Instinct: +15% damage vs debuffed, +10% crit vs marked ---
          var cHunterPassive = getAccCombatPassive(acc, 'hunters_instinct');
          if (cHunterPassive && targetMonster && isMonsterDebuffed(targetMonster)) {
            rawDamage = Math.round(rawDamage * (1 + (cHunterPassive.damageVsDebuffed || 0.15)));
            result.effects.push({ type: 'passive_proc', source: 'hunters_instinct', bonus: 'damage_vs_debuffed' });
          }

          // --- Damage Amp from Predator's Mark: +15% if monster is marked by this player ---
          if (targetMonster && targetMonster.predatorsMarkSource === socket.id) {
            var markNow = Date.now();
            if (targetMonster.predatorsMarkUntil && targetMonster.predatorsMarkUntil > markNow) {
              var markAmp = targetMonster.predatorsMarkDamageAmp || 0.15;
              rawDamage = Math.round(rawDamage * (1 + markAmp));
              result.effects.push({ type: 'passive_proc', source: 'predators_mark_amp', bonus: markAmp });
            }
          }

          // --- Execute Mechanics ---
          if (targetMonster) {
            var tgtHpPct = targetMonster.hp / (targetMonster.maxHp || 1);
            if (comboCardIdLower === 'kill_shot' && tgtHpPct < 0.25) {
              rawDamage = rawDamage * 3;
            }
            if (comboCardIdLower === 'execute_strike' && tgtHpPct < 0.30) {
              rawDamage = rawDamage * 2;
            }
          }

          // --- Hot Streak buff: +50% damage ---
          if (hotStreakActive) {
            rawDamage = Math.round(rawDamage * 1.50);
            // Consume the hot_streak buff
            for (var hsDI = activeBuffs.length - 1; hsDI >= 0; hsDI--) {
              if (activeBuffs[hsDI].effect === 'hot_streak') {
                activeBuffs.splice(hsDI, 1);
                break;
              }
            }
          }

          // --- Soul Shards Empowered: +75% for dark/shadow abilities ---
          var cardElem = cardTemplate.element || null;
          if ((cardElem === 'dark' || cardElem === 'shadow')) {
            for (var sseBI = activeBuffs.length - 1; sseBI >= 0; sseBI--) {
              if (activeBuffs[sseBI].effect === 'soul_shards_empowered') {
                rawDamage = Math.round(rawDamage * 1.75);
                activeBuffs.splice(sseBI, 1);
                break;
              }
            }
          }

          // --- Hunter's Instinct: +10% crit chance vs marked targets ---
          if (cHunterPassive && targetMonster && isMonsterMarked(targetMonster)) {
            var cHunterCritBonus = cHunterPassive.critVsMarked || 0.10;
            computed = Object.create(computed);
            computed.critChance = (computed.critChance || 0.05) + cHunterCritBonus;
          }

          // --- Shadow Sight: +10% accuracy bonus (acts as crit bonus in overworld) ---
          var cShadowSight = getAccCombatPassive(acc, 'shadow_sight');
          if (cShadowSight && cShadowSight.accuracyBonus) {
            computed = Object.create(computed);
            computed.critChance = (computed.critChance || 0.05) + (cShadowSight.accuracyBonus * 0.5);
          }

          // Check crit
          var isCrit = rollCrit(computed, null);
          if (isCrit) {
            var critMult = 2.0;
            // --- Shatter Passive: +30% crit damage vs stunned/slowed monsters ---
            var shatterPassive = getAccCombatPassive(acc, 'shatter');
            if (shatterPassive && targetMonster && (targetMonster.stunned || targetMonster.slowed)) {
              critMult += (shatterPassive.value || 0.30);
            }
            // --- Crit Damage Bonus passive: flat crit multiplier increase ---
            var cCritDmgBonus = getAccCombatPassiveTotal(acc, 'crit_damage_bonus');
            if (cCritDmgBonus > 0) {
              critMult += cCritDmgBonus;
            }
            rawDamage = Math.round(rawDamage * critMult);
          }

          // --- Hot Streak tracking: consecutive crits ---
          if (isCrit) {
            var hsPassive = getAccCombatPassive(acc, 'hot_streak');
            if (hsPassive) {
              var hsCount = (_hotStreakCounts.get(socket.id) || 0) + 1;
              if (hsCount >= 2) {
                // Grant hot_streak buff
                var playerBuffs = getPlayerBuffs(socket.id);
                playerBuffs.push({
                  effect: 'hot_streak',
                  expiry: now + 15000,
                  freeAbility: true,
                  source: 'hot_streak_passive',
                });
                result.effects.push({ type: 'buff', effect: 'hot_streak', duration: 15 });
                hsCount = 0;
              }
              _hotStreakCounts.set(socket.id, hsCount);
            }
          } else {
            _hotStreakCounts.set(socket.id, 0);
          }

          // Apply defense
          var finalDamage = rawDamage;
          if (targetMonster) {
            finalDamage = Math.max(1, rawDamage - Math.floor((targetMonster.def || 0) * 0.5));

            // Apply damage type multiplier from card element
            var cardDamageType = cardTemplate.element || null;
            if (cardDamageType) {
              var targetResistances = rpgData.getMonsterResistances(targetMonster);
              var dtMultiplier = rpgData.calculateDamageMultiplier(cardDamageType, targetResistances);
              finalDamage = Math.max(1, Math.round(finalDamage * dtMultiplier));
              result.damageTypeMultiplier = dtMultiplier;
            }
          }

          result.damage = finalDamage;
          result.crit = isCrit;

          // Apply damage to target
          if (context === 'overworld' && targetMonster) {
            targetMonster.hp = Math.max(0, targetMonster.hp - finalDamage);
            targetMonster.lastAttackedTime = now;
            result.targetHp = targetMonster.hp;
            result.targetMaxHp = targetMonster.maxHp || targetMonster.hp;

            // AoE: damage nearby monsters
            if (cardTemplate.aoeRadius && cardTemplate.aoeRadius > 0 && zoneId) {
              var aoeRange = cardTemplate.aoeRadius * 32;
              if (aoeRange < 64) aoeRange = 64;
              var aoeDamage = Math.round(finalDamage * 0.6);
              var aoeMonsterList = state.zoneMonsters ? state.zoneMonsters.get(zoneId) : null;
              var aoeHits = [];
              if (aoeMonsterList) {
                for (var ai = 0; ai < aoeMonsterList.length; ai++) {
                  var aoeMob = aoeMonsterList[ai];
                  if (!aoeMob.alive || aoeMob.id === targetId) continue;
                  var adx = targetMonster.x - aoeMob.x;
                  var ady = targetMonster.y - aoeMob.y;
                  if (adx * adx + ady * ady < aoeRange * aoeRange) {
                    var aoeActual = Math.max(1, aoeDamage - Math.floor((aoeMob.def || 0) * 0.5));
                    // Apply damage type multiplier to AoE
                    if (cardDamageType) {
                      var aoeMobRes = rpgData.getMonsterResistances(aoeMob);
                      var aoeDtMult = rpgData.calculateDamageMultiplier(cardDamageType, aoeMobRes);
                      aoeActual = Math.max(1, Math.round(aoeActual * aoeDtMult));
                    }
                    aoeMob.hp = Math.max(0, aoeMob.hp - aoeActual);
                    aoeMob.lastAttackedTime = now;
                    aoeHits.push({ id: aoeMob.id, damage: aoeActual, hp: aoeMob.hp, maxHp: aoeMob.maxHp || aoeMob.hp });
                    if (aoeMob.hp <= 0) aoeMob.alive = false;
                  }
                }
              }
              result.aoeHits = aoeHits;
            }

            // Check if target died
            if (targetMonster.hp <= 0) {
              targetMonster.alive = false;
              result.targetDied = true;
            }

            // Lifesteal
            if (cardTemplate.lifesteal && cardTemplate.lifesteal > 0) {
              var lifeStealAmount = Math.round(finalDamage * cardTemplate.lifesteal);
              result.effects.push({ type: 'lifesteal', amount: lifeStealAmount });
              if (dungeonCombat) {
                dungeonCombat.hp = Math.min(dungeonCombat.maxHp, dungeonCombat.hp + lifeStealAmount);
              }
            }

            // On-hit status effect
            if (cardTemplate.onHitStatus) {
              result.effects.push({
                type: 'status',
                name: cardTemplate.onHitStatus.name,
                duration: cardTemplate.onHitStatus.duration || 2,
                statusType: cardTemplate.onHitStatus.type || 'debuff',
              });
              // Apply stun/slow to monster from on-hit status
              if (cardTemplate.onHitStatus.name === 'stunned' && targetMonster && targetMonster.alive) {
                targetMonster.stunned = true;
                targetMonster.stunnedUntil = now + (cardTemplate.onHitStatus.duration || 1) * 3000;
              }
            }

            // --- Mortal Strike: apply mortal_wounds to monster ---
            if (comboCardIdLower === 'mortal_strike' && targetMonster && targetMonster.alive) {
              targetMonster.mortalWoundsUntil = now + 9000; // 3 turns ~= 9 seconds
              result.effects.push({ type: 'status', name: 'mortal_wounds', duration: 9, statusType: 'debuff' });
            }

            // --- Atonement Passive: heal self for 20% of damage dealt ---
            if (finalDamage > 0) {
              var atonementPassive = getAccCombatPassive(acc, 'atonement');
              if (atonementPassive) {
                var atonHealAmt = Math.max(1, Math.floor(finalDamage * (atonementPassive.value || 0.20)));
                result.effects.push({ type: 'heal', amount: atonHealAmt, source: 'atonement' });
                // Apply self-heal in dungeon context
                if (dungeonCombat) {
                  dungeonCombat.hp = Math.min(dungeonCombat.maxHp, dungeonCombat.hp + atonHealAmt);
                }
              }
            }

            // --- Siphoning Strikes: basic attacks restore 3% max HP ---
            var siphPassive = getAccCombatPassive(acc, 'siphoning_strikes');
            if (siphPassive && finalDamage > 0) {
              var siphHealPct = siphPassive.value || 0.03;
              var siphHealAmt = Math.max(1, Math.floor((computed.hp || 100) * siphHealPct));
              result.effects.push({ type: 'heal', amount: siphHealAmt, source: 'siphoning_strikes' });
              if (dungeonCombat) {
                dungeonCombat.hp = Math.min(dungeonCombat.maxHp, dungeonCombat.hp + siphHealAmt);
              }
            }

            // --- Soul Shards: +1 per kill ---
            if (targetMonster && !targetMonster.alive) {
              var ssPassive = getAccCombatPassive(acc, 'soul_shards');
              if (ssPassive) {
                var curShards = (_soulShards.get(socket.id) || 0) + 1;
                if (curShards >= 5) {
                  // Grant soul_shards_empowered buff
                  var ssBuffs = getPlayerBuffs(socket.id);
                  ssBuffs.push({
                    effect: 'soul_shards_empowered',
                    expiry: now + 30000,
                    source: 'soul_shards',
                  });
                  result.effects.push({ type: 'buff', effect: 'soul_shards_empowered', duration: 30 });
                  curShards = 0;
                }
                _soulShards.set(socket.id, curShards);
              }
            }

            // --- On-Hit Poison passive: 15% chance to apply poison DoT ---
            if (finalDamage > 0 && targetMonster && targetMonster.alive) {
              var cPoisonPassive = getAccCombatPassive(acc, 'on_hit_poison');
              if (cPoisonPassive && Math.random() < (cPoisonPassive.chance || 0.15)) {
                var cPoisonTick = cPoisonPassive.tickDamage || 3;
                var cPoisonDur = cPoisonPassive.duration || 3;
                result.effects.push({ type: 'dot', name: 'poison', tickDamage: cPoisonTick, duration: cPoisonDur, source: 'on_hit_poison' });
                if (zoneId) {
                  if (!_monsterDoTs.has(targetId)) _monsterDoTs.set(targetId, []);
                  _monsterDoTs.get(targetId).push({
                    tickDamage: cPoisonTick, remainingTicks: cPoisonDur,
                    sourceSocketId: socket.id, zoneId: zoneId, name: 'Poison',
                  });
                }
              }

              // --- On-Hit Bleed passive: 10% chance to apply bleed DoT ---
              var cBleedPassive = getAccCombatPassive(acc, 'on_hit_bleed');
              if (cBleedPassive && Math.random() < (cBleedPassive.chance || 0.10)) {
                var cBleedTick = cBleedPassive.tickDamage || 4;
                var cBleedDur = cBleedPassive.duration || 3;
                result.effects.push({ type: 'dot', name: 'bleed', tickDamage: cBleedTick, duration: cBleedDur, source: 'on_hit_bleed' });
                if (zoneId) {
                  if (!_monsterDoTs.has(targetId)) _monsterDoTs.set(targetId, []);
                  _monsterDoTs.get(targetId).push({
                    tickDamage: cBleedTick, remainingTicks: cBleedDur,
                    sourceSocketId: socket.id, zoneId: zoneId, name: 'Bleed',
                  });
                }
              }

              // --- Proc Explosion passive: 15% chance for secondary explosion damage ---
              var cExplosionPassive = getAccCombatPassive(acc, 'proc_explosion');
              if (cExplosionPassive && Math.random() < (cExplosionPassive.chance || 0.15)) {
                var cExpDmg = cExplosionPassive.damage || 10;
                targetMonster.hp = Math.max(0, targetMonster.hp - cExpDmg);
                result.effects.push({ type: 'proc', name: 'explosion', damage: cExpDmg, source: 'proc_explosion' });
                if (targetMonster.hp <= 0) {
                  targetMonster.alive = false;
                  result.targetDied = true;
                }
                result.targetHp = targetMonster.hp;
              }

              // --- Mana on Magic Hit: recover 15% of magic damage dealt as mana ---
              if (cardTemplate.element === 'arcane' || cardTemplate.element === 'fire' || cardTemplate.element === 'ice' ||
                  cardTemplate.element === 'lightning' || cardTemplate.element === 'holy' || cardTemplate.element === 'shadow' ||
                  cardTemplate.element === 'dark' || cardTemplate.element === 'water' || cardTemplate.element === 'wind') {
                var cManaOnHit = getAccCombatPassive(acc, 'mana_on_magic_hit');
                if (cManaOnHit) {
                  var cManaRestore = Math.max(1, Math.floor(finalDamage * (cManaOnHit.value || 0.15)));
                  if (cardManaState) {
                    cardManaState.current = Math.min(cardManaState.max, cardManaState.current + cManaRestore);
                  } else if (dungeonCombat) {
                    dungeonCombat.mana = Math.min(dungeonCombat.maxMana || 100, dungeonCombat.mana + cManaRestore);
                  }
                  result.effects.push({ type: 'mana_restore', amount: cManaRestore, source: 'mana_on_magic_hit' });
                }
              }
            }
          }

          // --- Combo Chain: track state ---
          if (comboCardIdLower === 'combo_rising_edge' || comboCardIdLower === 'combo_savage_blow' || comboCardIdLower === 'combo_full_thrust') {
            _comboState.set(socket.id, { lastCombo: comboCardIdLower, usedAt: now });
            if (comboCardIdLower === 'combo_full_thrust') {
              _comboState.delete(socket.id);
            }
          }

        } else if (cardTemplate.combatType === 'healing') {
          // Healing card ability
          var healAmount = calculateCardAbilityHeal(cardTemplate, computed);

          // --- Lily of the Field: at 3 tokens, +50% heal ---
          var lilyPassive = getAccCombatPassive(acc, 'lily_of_the_field');
          if (lilyPassive) {
            // Initialize lily tracking if not present
            if (!_lilyTokens.has(socket.id)) {
              _lilyTokens.set(socket.id, { tokens: 0, lastTick: now });
            }
            var lilyState = _lilyTokens.get(socket.id);
            if (lilyState.tokens >= 3) {
              healAmount = Math.floor(healAmount * 1.50);
              lilyState.tokens = 0;
              result.effects.push({ type: 'lily_consumed', tokensConsumed: 3 });
            }
          }

          result.healAmount = healAmount;
          result.effects.push({ type: 'heal', amount: healAmount });

          if (dungeonCombat) {
            dungeonCombat.hp = Math.min(dungeonCombat.maxHp, dungeonCombat.hp + healAmount);
            result.playerHp = dungeonCombat.hp;
            result.playerMaxHp = dungeonCombat.maxHp;
          }

        } else if (cardTemplate.combatType === 'buff') {
          // Buff card ability
          var statusDuration = (cardTemplate.statusDuration || 3) * 1000;
          var buffCardLower = (cardId || '').toLowerCase();
          var buff = {
            effect: cardTemplate.statusEffect || 'card_buff',
            expiry: now + statusDuration,
            abilityId: cooldownKey,
            source: 'card',
          };
          if (cardTemplate.armorBoost) buff.armorBonus = cardTemplate.armorBoost;
          if (cardTemplate.damageBoost) buff.damageMultiplier = 1 + (cardTemplate.damageBoost / 10);
          if (cardTemplate.speedMult) buff.speedMultiplier = cardTemplate.speedMult;
          if (cardTemplate.statBoost) buff.statBoost = cardTemplate.statBoost;
          if (cardTemplate.damageReduction) buff.damageReduction = cardTemplate.damageReduction;

          // === MMO-Inspired Buff Special Handlers ===

          // --- Berserker Fury: cleanse debuffs on activation ---
          if (buffCardLower === 'berserker_fury_transform' && cardTemplate.cleansesDebuffs) {
            var existingBfs = getPlayerBuffs(socket.id);
            var debuffsCleansed = [];
            for (var bfCI = existingBfs.length - 1; bfCI >= 0; bfCI--) {
              if (existingBfs[bfCI].isDebuff) {
                debuffsCleansed.push(existingBfs[bfCI].effect);
                existingBfs.splice(bfCI, 1);
              }
            }
            if (debuffsCleansed.length > 0) {
              result.effects.push({ type: 'cleanse', removedDebuffs: debuffsCleansed, source: 'berserker_fury' });
            }
            buff.ccImmune = true;
            buff.damageTakenIncrease = cardTemplate.damageTakenIncrease || 0.10;
          }

          // --- Avatar of War: costs 20% current HP ---
          if (buffCardLower === 'avatar_of_war' && cardTemplate.hpCost) {
            if (dungeonCombat) {
              var avatarCost = Math.max(1, Math.floor(dungeonCombat.hp * cardTemplate.hpCost));
              dungeonCombat.hp = Math.max(1, dungeonCombat.hp - avatarCost);
              result.effects.push({ type: 'hp_cost', amount: avatarCost, source: 'avatar_of_war' });
            }
            buff.ccImmune = true;
            buff.knockbackImmune = true;
          }

          // --- Divine Invulnerability: set invulnerability tracking ---
          if (buffCardLower === 'divine_invulnerability') {
            _divineInvulnerability.set(socket.id, now + statusDuration);
            buff.invulnerable = true;
            buff.cantAttack = true;
          }

          // --- Fade: drop aggro (enemies ignore this player) ---
          if (buffCardLower === 'fade') {
            _fadeActive.set(socket.id, now + statusDuration);
            buff.threatDrop = true;
          }

          // --- Power Word Shield: grant momentum shield ---
          if (buffCardLower === 'power_word_shield') {
            var pwsStatVal = (computed.magicResist || 0.15) * 20;
            var pwsShieldAmt = Math.max(1, Math.floor(40 + pwsStatVal * (cardTemplate.scalingFactor || 0.5) * 5));
            result.effects.push({ type: 'shield', amount: pwsShieldAmt, source: 'power_word_shield' });
            if (dungeonCombat) {
              dungeonCombat.momentumShield = (dungeonCombat.momentumShield || 0) + pwsShieldAmt;
            }
          }

          // --- Bloodlust: party-wide haste (self in overworld since no party tracking) ---
          if (cardTemplate.hasteMult) {
            buff.speedMultiplier = cardTemplate.hasteMult || 1.30;
            buff.cooldownReduction = cardTemplate.cooldownReduction || 0.30;
          }

          // --- Metamorphosis: AoE on attacks during buff ---
          if (buffCardLower === 'metamorphosis') {
            buff.aoeOnAttack = true;
          }

          // --- Soulstone: pre-cast self-revive tracking ---
          if (buffCardLower === 'soulstone') {
            buff.reviveHpPercent = cardTemplate.reviveHpPercent || 0.30;
          }

          // --- Innervate: mana regen buff ---
          if (buffCardLower === 'innervate') {
            buff.manaPerTick = cardTemplate.manaPerTurn || 5;
          }

          // --- Intercept: damage redirect ---
          if (buffCardLower === 'intercept') {
            buff.redirectDamage = true;
          }

          // --- Ironskin: DR when not moving ---
          if (buffCardLower === 'ironskin') {
            buff.effect = 'ironskin';
            buff.damageReduction = 0.15;
          }

          // --- Stagger: set up stagger tracking ---
          var staggerPassive = getAccCombatPassive(acc, 'stagger');
          if (staggerPassive && !_staggerDoTs.has(socket.id)) {
            _staggerDoTs.set(socket.id, { remaining: 0, tickDamage: 0 });
          }

          // --- Thorns Aura: add as passive buff ---
          var thornsPassive = getAccCombatPassive(acc, 'melee_damage_reflect');
          if (thornsPassive) {
            // Check if thorns buff already exists
            var hasThorns = false;
            var existingBfs2 = getPlayerBuffs(socket.id);
            for (var thI = 0; thI < existingBfs2.length; thI++) {
              if (existingBfs2[thI].effect === 'thorns_aura') { hasThorns = true; break; }
            }
            if (!hasThorns) {
              existingBfs2.push({
                effect: 'thorns_aura',
                expiry: now + 600000, // 10 min persistent
                reflectValue: thornsPassive.value || 0.10,
                source: 'passive',
              });
            }
          }

          // --- Dragonfire Scale: add as passive buff ---
          var dragonPassive = getAccCombatPassive(acc, 'projectile_reflect');
          if (dragonPassive) {
            var hasDragon = false;
            var existingBfs3 = getPlayerBuffs(socket.id);
            for (var drI = 0; drI < existingBfs3.length; drI++) {
              if (existingBfs3[drI].effect === 'dragonfire_scale') { hasDragon = true; break; }
            }
            if (!hasDragon) {
              existingBfs3.push({
                effect: 'dragonfire_scale',
                expiry: now + 600000,
                reflectChance: dragonPassive.chance || 0.20,
                source: 'passive',
              });
            }
          }

          // --- Animal Form buff: track form state and apply form-specific bonuses ---
          if (cardTemplate.animalForm) {
            buff.animalForm = cardTemplate.animalForm;
            buff.dodgeBonus = cardTemplate.dodgeBonus || 0;
            buff.critBonus = cardTemplate.critBonus || 0;
            buff.maxHpPercent = cardTemplate.maxHpPercent || 0;
            buff.shellDR = cardTemplate.shellDR || 0;

            // Remove any existing animal form buff (only one at a time)
            var existingBuffs = getPlayerBuffs(socket.id);
            for (var afi = existingBuffs.length - 1; afi >= 0; afi--) {
              if (existingBuffs[afi].animalForm) {
                existingBuffs.splice(afi, 1);
                break;
              }
            }
          }

          // --- Counterstrike Stance: counter melee attacks for 50% damage ---
          if (cardTemplate.counterAttackPercent) {
            buff.effect = 'counterstrike_stance';
            buff.counterAttackPercent = cardTemplate.counterAttackPercent;
            buff.counterOnMelee = cardTemplate.counterOnMelee || true;
          }

          // --- Tidal Shield: grant momentum shield (doubled on water zones) ---
          if (cardTemplate.shieldBase && cardTemplate.shieldBase > 0) {
            var tsBaseShield = cardTemplate.shieldBase;
            // Scale with resolve stat
            var tsResolve = (acc.rpgStats && acc.rpgStats.resolve) ? acc.rpgStats.resolve : 5;
            tsBaseShield += Math.floor(tsResolve * 0.4);
            // Double on water zones
            if (cardTemplate.waterTileShieldMultiplier && zoneId) {
              var tsZoneLower = (zoneId || '').toLowerCase();
              var tsIsWaterZone = /lake|river|ocean|sea|swamp|marsh|coast|tidal|flooded|aqua|murkmire/.test(tsZoneLower);
              if (tsIsWaterZone) {
                tsBaseShield = Math.floor(tsBaseShield * cardTemplate.waterTileShieldMultiplier);
                result.effects.push({ type: 'passive_proc', source: 'water_shield_bonus', multiplier: cardTemplate.waterTileShieldMultiplier });
              }
            }
            result.effects.push({ type: 'shield', amount: tsBaseShield, source: 'tidal_shield' });
            if (dungeonCombat) {
              dungeonCombat.momentumShield = (dungeonCombat.momentumShield || 0) + tsBaseShield;
            }
          }

          // --- Fortify / Stationary Armor Boost: enhance armor when not moving ---
          if (cardTemplate.armorBoostPercent) {
            buff.armorBoostPercent = cardTemplate.armorBoostPercent;
            if (cardTemplate.stationaryArmorBoostPercent) {
              buff.stationaryArmorBoostPercent = cardTemplate.stationaryArmorBoostPercent;
            }
          }

          // --- Cant Move: self-immobilize buff ---
          if (cardTemplate.cantMove) {
            buff.cantMove = true;
          }

          // --- CC Immunity passive: register persistent buff for cc immune checks ---
          var ccImmPassive = getAccCombatPassive(acc, 'cc_immunity');
          if (ccImmPassive) {
            var existingBfs4 = getPlayerBuffs(socket.id);
            var hasCcImmBuff = false;
            for (var ccI = 0; ccI < existingBfs4.length; ccI++) {
              if (existingBfs4[ccI].effect === 'cc_immunity_passive') { hasCcImmBuff = true; break; }
            }
            if (!hasCcImmBuff) {
              existingBfs4.push({
                effect: 'cc_immunity_passive',
                expiry: now + 600000,
                ccType: ccImmPassive.ccType || 'stun',
                source: 'passive',
              });
            }
          }

          var playerBuffs = getPlayerBuffs(socket.id);
          playerBuffs.push(buff);
          result.effects.push({
            type: 'buff',
            effect: cardTemplate.statusEffect || 'card_buff',
            duration: cardTemplate.statusDuration || 3,
            armorBoost: cardTemplate.armorBoost || 0,
            damageBoost: cardTemplate.damageBoost || 0,
            animalForm: cardTemplate.animalForm || null,
          });

        } else if (cardTemplate.combatType === 'debuff') {
          // Debuff card ability (applied to target)
          if (targetMonster) {
            // --- Challenge Shout: AoE taunt + self DR ---
            if (cardTemplate.tauntAoe) {
              // Apply self DR
              if (cardTemplate.selfDamageReduction) {
                var csBuffs = getPlayerBuffs(socket.id);
                csBuffs.push({
                  effect: 'challenge_shout_dr',
                  expiry: now + (cardTemplate.statusDuration || 2) * 1000,
                  damageReduction: cardTemplate.selfDamageReduction,
                  source: 'challenge_shout',
                });
                result.effects.push({ type: 'buff', effect: 'challenge_shout_dr', duration: cardTemplate.statusDuration || 2 });
              }
              // Taunt: force monster to target this player
              targetMonster.taunted = true;
              targetMonster.tauntTarget = socket.id;
              targetMonster.tauntedUntil = now + (cardTemplate.statusDuration || 2) * 3000;
            }
            // --- Polymorph: stun + can't act ---
            if (cardTemplate.statusEffect === 'polymorphed') {
              targetMonster.stunned = true;
              targetMonster.stunnedUntil = now + (cardTemplate.statusDuration || 2) * 3000;
              targetMonster.polymorphed = true;
              targetMonster.polymorphedUntil = targetMonster.stunnedUntil;
            }

            // --- Predator's Mark: apply mark, antiStealth, damageAmp tracking ---
            if (cardTemplate.statusEffect === 'predators_mark') {
              var markDurMs = (cardTemplate.statusDuration || 5) * 3000;
              targetMonster.marked = true;
              targetMonster.predatorsMarkUntil = now + markDurMs;
              targetMonster.predatorsMarkSource = socket.id;
              if (cardTemplate.damageAmpFromCaster) {
                targetMonster.predatorsMarkDamageAmp = cardTemplate.damageAmpFromCaster;
              }
              if (cardTemplate.antiStealth) {
                targetMonster.antiStealth = true;
                targetMonster.antiStealthUntil = now + markDurMs;
              }
              if (cardTemplate.revealPosition) {
                targetMonster.revealed = true;
                targetMonster.revealedUntil = now + markDurMs;
              }
            }

            // --- Exposed debuff: apply armor reduction from onHitStatus ---
            if (cardTemplate.onHitStatus && cardTemplate.onHitStatus.name === 'exposed' && targetMonster.alive) {
              var expArmorReduce = cardTemplate.onHitStatus.armorReduction || 6;
              targetMonster.armorBroken = true;
              targetMonster.armorBrokenUntil = now + (cardTemplate.onHitStatus.duration || 3) * 3000;
              targetMonster.armorReduction = expArmorReduce;
              result.effects.push({ type: 'status', name: 'exposed', duration: cardTemplate.onHitStatus.duration || 3, armorReduction: expArmorReduce });
            }

            // --- Slowed debuff: apply slow from onHitStatus ---
            if (cardTemplate.onHitStatus && cardTemplate.onHitStatus.name === 'slowed' && targetMonster.alive) {
              targetMonster.slowed = true;
              targetMonster.slowedUntil = now + (cardTemplate.onHitStatus.duration || 2) * 3000;
            }

            result.effects.push({
              type: 'debuff',
              name: cardTemplate.statusEffect || 'card_debuff',
              duration: cardTemplate.statusDuration || 2,
            });
          }

        } else if (cardTemplate.combatType === 'tile_effect') {
          // Tile effect (placed at location)
          result.effects.push({
            type: 'tile_effect',
            tileEffect: cardTemplate.tileEffect || 'GENERIC',
            aoeRadius: cardTemplate.aoeRadius || 1,
          });

        } else if (cardTemplate.combatType === 'summon') {
          // Summon ability
          result.effects.push({
            type: 'summon',
            summonType: cardTemplate.summonType || 'generic',
            summonHp: cardTemplate.summonHp || 30,
            summonDamage: cardTemplate.summonDamage || 5,
            summonDuration: cardTemplate.summonDuration || 3,
          });

        } else if (cardTemplate.combatType === 'movement') {
          // Movement ability (blink, shadow step, dash, etc.)
          var moveEffect = {
            type: 'movement',
            range: cardTemplate.range || 3,
          };
          if (cardTemplate.dashDistance) moveEffect.dashDistance = cardTemplate.dashDistance;
          if (cardTemplate.teleportDistance) moveEffect.teleportDistance = cardTemplate.teleportDistance;
          if (cardTemplate.passThroughEnemies) moveEffect.passThroughEnemies = true;
          result.effects.push(moveEffect);

          // Grant stealth after movement
          if (cardTemplate.grantsStealth) {
            result.effects.push({ type: 'stealth', duration: cardTemplate.grantsStealth });
            _fadeActive.set(socket.id, now + (cardTemplate.grantsStealth * 3000));
          }

          // Apply onUseStatus (e.g., stealth from scout cards)
          if (cardTemplate.onUseStatus) {
            var ousName = cardTemplate.onUseStatus.name || 'stealthed';
            var ousDur = cardTemplate.onUseStatus.duration || 2;
            if (ousName === 'stealthed') {
              _fadeActive.set(socket.id, now + (ousDur * 3000));
              result.effects.push({ type: 'stealth', duration: ousDur, source: 'on_use_status' });
            } else {
              result.effects.push({ type: 'status', name: ousName, duration: ousDur, source: 'on_use_status' });
            }
          }

          // Summon decoy at original position
          if (cardTemplate.summonDecoy) {
            var decoyHp = cardTemplate.decoyHp || 20;
            result.effects.push({
              type: 'summon',
              summonType: 'decoy',
              summonHp: decoyHp,
              summonDamage: 0,
              summonDuration: cardTemplate.statusDuration || 3,
              drawsAggro: cardTemplate.decoyDrawsAggro || false,
            });
          }

        } else if (cardTemplate.combatType === 'utility') {
          // Generic utility (tame, etc.)
          result.effects.push({
            type: 'utility',
            utilityType: cardTemplate.combatType,
          });
        }

        // 9. Emit results
        socket.emit('card_ability_result', result);

        // Track card ability use for daily challenges
        challengesHandler.trackChallengeProgress(accounts, accKey, 'ability_use', 1);
        if (result.crit) {
          challengesHandler.trackChallengeProgress(accounts, accKey, 'crit_hit', 1);
        }

        // Emit to nearby players for visual feedback
        if (!zoneId) zoneId = state.playerZones ? state.playerZones.get(socket.id) : null;
        if (zoneId) {
          socket.to('zone:' + zoneId).emit('card_ability_used', {
            playerId: socket.id,
            playerName: deps.user ? deps.user.name : 'Player',
            cardId: cardId,
            cardName: cardTemplate.name,
            combatType: cardTemplate.combatType,
            targetId: targetId,
            damage: result.damage,
            crit: result.crit,
            aoe: result.aoe,
            element: cardTemplate.element || null,
          });
        }

        // 10. Send updated card ability cooldown state
        var updatedCardCooldowns = buildCardAbilityCooldownState(socket.id, acc);
        socket.emit('card_cooldown_update', {
          cardAbilities: updatedCardCooldowns,
          mana: cardManaState ? cardManaState.current : (dungeonCombat ? dungeonCombat.mana : 0),
          maxMana: cardManaState ? cardManaState.max : (dungeonCombat ? (dungeonCombat.maxMana || 100) : 0),
        });

        // --- Phantom Skill XP: award based on card ability type/element ---
        var phantomXpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : undefined;

        // Necromancy: shadow/dark element damage abilities or summon abilities
        if ((cardTemplate.combatType === 'damage' && (cardTemplate.element === 'dark' || cardTemplate.element === 'shadow'))
            || cardTemplate.combatType === 'summon') {
          accounts.addSkillXp(accKey, 'necromancy', 15 + Math.floor(Math.random() * 16), phantomXpRate);
        }

        // Life Magic: healing abilities
        if (cardTemplate.combatType === 'healing') {
          accounts.addSkillXp(accKey, 'life_magic', 20 + Math.floor(Math.random() * 21), phantomXpRate);
        }

        // Psychology & Bardic: buff/debuff abilities
        if (cardTemplate.combatType === 'buff' || cardTemplate.combatType === 'debuff') {
          accounts.addSkillXp(accKey, 'psychology', 15 + Math.floor(Math.random() * 11), phantomXpRate);
        }

        // Weather Magic: elemental damage abilities (fire, ice, lightning, wind, water, earth)
        if (cardTemplate.combatType === 'damage' && cardTemplate.element) {
          var _weatherElem = { fire: true, ice: true, lightning: true, wind: true, water: true, earth: true };
          if (_weatherElem[cardTemplate.element]) {
            accounts.addSkillXp(accKey, 'weather_magic', 10 + Math.floor(Math.random() * 11), phantomXpRate);
          }
        }

        // Anatomy: critical hits award 5 XP
        if (result.crit) {
          accounts.addSkillXp(accKey, 'anatomy', 5, phantomXpRate);
        }

        // Anatomy: execute-type abilities (condition-based)
        if (cardTemplate.condition === 'target_below_30hp' || cardTemplate.condition === 'target_below_20hp') {
          accounts.addSkillXp(accKey, 'anatomy', 8, phantomXpRate);
        }

        // Animal Handling: tame-type utility abilities
        if (cardTemplate.combatType === 'utility' && cardTemplate.effects) {
          for (var _tei = 0; _tei < cardTemplate.effects.length; _tei++) {
            if (cardTemplate.effects[_tei].type === 'tame') {
              accounts.addSkillXp(accKey, 'animal_handling', 15 + Math.floor(Math.random() * 16), phantomXpRate);
              break;
            }
          }
        }

        // 11. Handle monster death rewards in overworld
        if (context === 'overworld' && targetMonster && !targetMonster.alive) {
          handleMonsterDeath(io, socket, deps, accKey, targetMonster, targetId, zoneId, state);
          // Also handle AoE kills
          if (result.aoeHits) {
            for (var ahi = 0; ahi < result.aoeHits.length; ahi++) {
              var aoeHit = result.aoeHits[ahi];
              if (aoeHit.hp <= 0) {
                handleAoeMonsterDeath(io, socket, deps, accKey, aoeHit.id, zoneId, state);
              }
            }
          }
        }

      } catch (err) {
        console.error('[combat] use_card_ability error:', err.message);
        socket.emit('card_ability_error', { message: 'Internal server error' });
      }
    });

    // ------------------------------------------------------------------
    // get_card_abilities — client requests equipped card abilities + cooldowns
    // ------------------------------------------------------------------
    socket.on('get_card_abilities', function() {
      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;

      var acc = accounts.loadAccount(accKey);
      if (!acc) return;

      var cardAbilities = buildCardAbilityCooldownState(socket.id, acc);

      socket.emit('card_abilities_list', {
        cardAbilities: cardAbilities,
      });
    });

    // ------------------------------------------------------------------
    // get_cooldowns — client requests current cooldown state
    // ------------------------------------------------------------------
    socket.on('get_cooldowns', function() {
      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;

      var acc = accounts.loadAccount(accKey);
      if (!acc) return;

      var weaponInfo = getWeaponInfo(accKey);
      var cooldownState = buildCooldownState(socket.id, weaponInfo.family, acc.equippedCards || []);
      var cardAbilities = buildCardAbilityCooldownState(socket.id, acc);

      socket.emit('cooldown_update', {
        weaponFamily: weaponInfo.family,
        abilities: cooldownState,
        cardAbilities: cardAbilities,
      });
    });

    // ------------------------------------------------------------------
    // Clean up on disconnect
    // ------------------------------------------------------------------
    socket.on('disconnect', function() {
      _playerCooldowns.delete(socket.id);
      _playerBuffs.delete(socket.id);
      _playerMana.delete(socket.id);
      // MMO-inspired tracking cleanup
      _hotStreakCounts.delete(socket.id);
      _comboState.delete(socket.id);
      _lilyTokens.delete(socket.id);
      _soulShards.delete(socket.id);
      _staggerDoTs.delete(socket.id);
      _divineInvulnerability.delete(socket.id);
      _fadeActive.delete(socket.id);
      _playerLastHitElement.delete(socket.id);
    });
  },

  // Expose for external use
  getPlayerCooldowns: getPlayerCooldowns,
  getPlayerBuffs: getPlayerBuffs,
  cleanExpiredBuffs: cleanExpiredBuffs,
  getWeaponInfo: getWeaponInfo,
  buildCooldownState: buildCooldownState,
  buildCardAbilityCooldownState: buildCardAbilityCooldownState,
  applyDefensiveBuffs: applyDefensiveBuffs,
  getOrInitPlayerMana: getOrInitPlayerMana,
};

// ---------------------------------------------------------------------------
// Shared helper: handle overworld monster death (XP, gold, loot, cleanup)
// ---------------------------------------------------------------------------
// Pattern to detect beast/animal monster names for skinning XP
var _BEAST_NAME_PATTERN = /wolf|bear|boar|spider|lizard|hawk|bat|crab|scorpion|viper|raptor|toad|beetle|hound|drake|serpent|worm|ape|bird|insect|crawler|goat|imp/i;

function handleMonsterDeath(io, socket, deps, accKey, targetMonster, targetId, zoneId, state) {
  var xpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : undefined;
  var xpResult = accounts.addSkillXp(accKey, 'melee', targetMonster.xp || 10, xpRate);
  var goldAmount = targetMonster.goldDrop || 5;
  if (goldAmount > 0) accounts.updateChips(accKey, goldAmount);

  // Skinning XP: beast-type monster kills (10-20 XP)
  if (targetMonster.name && _BEAST_NAME_PATTERN.test(targetMonster.name)) {
    accounts.addSkillXp(accKey, 'skinning', 10 + Math.floor(Math.random() * 11), xpRate);
  }

  // Anatomy XP: overworld monster kills (understanding monster physiology)
  accounts.addSkillXp(accKey, 'anatomy', 3, xpRate);

  // Roll loot
  var lootDropped = [];
  if (targetMonster.possibleLoot && targetMonster.possibleLoot.length > 0) {
    for (var li = 0; li < targetMonster.possibleLoot.length; li++) {
      var loot = targetMonster.possibleLoot[li];
      if (Math.random() < loot.chance) {
        var addResult = accounts.addResource(accKey, loot.type, loot.amount);
        if (addResult) {
          var itemName = loot.type.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
          lootDropped.push({ type: loot.type, name: itemName, amount: loot.amount });
        }
      }
    }
  }

  // Remove from zone monster list
  if (zoneId) {
    var mList = state.zoneMonsters ? state.zoneMonsters.get(zoneId) : null;
    if (mList) {
      for (var ri = mList.length - 1; ri >= 0; ri--) {
        if (mList[ri].id === targetId) {
          mList.splice(ri, 1);
          break;
        }
      }
    }
    io.to('zone:' + zoneId).emit('zone_monster_died', { id: targetId });
  }

  // Durability loss on ability kill
  try {
    var durAcc = accounts.loadAccount(accKey);
    if (durAcc && durAcc.equipment) {
      var cardEffects = accounts.getEquippedCardEffects ? accounts.getEquippedCardEffects(accKey) : [];
      var durWarnings = [];
      var wepResults = accounts.reduceWeaponDurability(durAcc, 1, cardEffects);
      if (wepResults) { for (var wri = 0; wri < wepResults.length; wri++) durWarnings.push(wepResults[wri]); }
      var armorResults = accounts.reduceArmorDurability(durAcc, 0.5, cardEffects);
      for (var dwi = 0; dwi < armorResults.length; dwi++) durWarnings.push(armorResults[dwi]);
      accounts.saveAccount(durAcc);
      for (var dwj = 0; dwj < durWarnings.length; dwj++) {
        if (durWarnings[dwj].broken) {
          socket.emit('item_broken', { slot: durWarnings[dwj].slot, itemName: durWarnings[dwj].itemName });
        } else if (durWarnings[dwj].lowDurability) {
          socket.emit('durability_warning', { slot: durWarnings[dwj].slot, itemName: durWarnings[dwj].itemName, durability: durWarnings[dwj].durability, maxDurability: durWarnings[dwj].maxDurability });
        }
      }
    }
  } catch (e) {
    // Non-fatal — don't break kill rewards
  }

  socket.emit('zone_monster_killed', {
    id: targetId,
    name: targetMonster.name,
    xp: targetMonster.xp || 10,
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

  // --- Track daily challenge & achievement progress for monster kills ---
  challengesHandler.trackChallengeProgress(accounts, accKey, 'monster_kill', 1);
  var monsterUnlocks = challengesHandler.trackAchievementProgress(accounts, accKey, 'monster_kill', 1, socket);
  challengesHandler.emitAchievementUnlocks(socket, accounts, monsterUnlocks);
  if (targetMonster.isBoss) {
    challengesHandler.trackChallengeProgress(accounts, accKey, 'boss_kill', 1);
    var bossUnlocks = challengesHandler.trackAchievementProgress(accounts, accKey, 'boss_kill', 1, socket);
    challengesHandler.emitAchievementUnlocks(socket, accounts, bossUnlocks);
  }
  // Track coins earned for economy achievements
  if (goldAmount > 0) {
    challengesHandler.trackAchievementProgress(accounts, accKey, 'coins_earned', goldAmount, socket);
  }
}

// Handle AoE monster death in overworld
function handleAoeMonsterDeath(io, socket, deps, accKey, aoeTargetId, zoneId, state) {
  var xpRate = (deps.serverRules && deps.serverRules.xpRate) ? deps.serverRules.xpRate : undefined;
  var aoeMonster = null;
  var aoeList = state.zoneMonsters ? state.zoneMonsters.get(zoneId) : null;
  // Note: skinning + anatomy XP are awarded after aoeMonster is found below
  if (aoeList) {
    for (var ami = aoeList.length - 1; ami >= 0; ami--) {
      if (aoeList[ami].id === aoeTargetId) {
        aoeMonster = aoeList[ami];
        aoeList.splice(ami, 1);
        break;
      }
    }
  }
  if (aoeMonster) {
    var aoeXpResult = accounts.addSkillXp(accKey, 'melee', aoeMonster.xp || 5, xpRate);
    var aoeGold = aoeMonster.goldDrop || 3;
    if (aoeGold > 0) accounts.updateChips(accKey, aoeGold);

    // Skinning XP: beast-type AoE monster kills (10-20 XP)
    if (aoeMonster.name && _BEAST_NAME_PATTERN.test(aoeMonster.name)) {
      accounts.addSkillXp(accKey, 'skinning', 10 + Math.floor(Math.random() * 11), xpRate);
    }
    // Anatomy XP: overworld AoE monster kills
    accounts.addSkillXp(accKey, 'anatomy', 3, xpRate);

    // Roll loot for AoE-killed monster (same logic as handleMonsterDeath)
    var aoeLootDropped = [];
    if (aoeMonster.possibleLoot && aoeMonster.possibleLoot.length > 0) {
      for (var ali = 0; ali < aoeMonster.possibleLoot.length; ali++) {
        var aoeLoot = aoeMonster.possibleLoot[ali];
        if (Math.random() < aoeLoot.chance) {
          var aoeAddResult = accounts.addResource(accKey, aoeLoot.type, aoeLoot.amount);
          if (aoeAddResult) {
            var aoeLootName = aoeLoot.type.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
            aoeLootDropped.push({ type: aoeLoot.type, name: aoeLootName, amount: aoeLoot.amount });
          }
        }
      }
    }

    io.to('zone:' + zoneId).emit('zone_monster_died', { id: aoeTargetId });
    socket.emit('zone_monster_killed', {
      id: aoeTargetId, name: aoeMonster.name,
      xp: aoeMonster.xp || 5, gold: aoeGold, loot: aoeLootDropped,
      skillLevel: aoeXpResult ? aoeXpResult.level : 1,
      skillXp: aoeXpResult ? aoeXpResult.xp : 0,
      xpNeeded: aoeXpResult ? aoeXpResult.xpNeeded : 100,
      leveledUp: aoeXpResult ? aoeXpResult.leveledUp : false,
      overallLevel: aoeXpResult ? aoeXpResult.overallLevel : 1,
      overallLeveledUp: aoeXpResult ? aoeXpResult.overallLeveledUp : false,
      pendingPacks: aoeXpResult ? aoeXpResult.pendingPacks : 0,
    });

    // --- Track daily challenge & achievement progress for AoE monster kills ---
    challengesHandler.trackChallengeProgress(accounts, accKey, 'monster_kill', 1);
    challengesHandler.trackAchievementProgress(accounts, accKey, 'monster_kill', 1, socket);
    if (aoeMonster.isBoss) {
      challengesHandler.trackChallengeProgress(accounts, accKey, 'boss_kill', 1);
      challengesHandler.trackAchievementProgress(accounts, accKey, 'boss_kill', 1, socket);
    }
  }
}
