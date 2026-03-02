// account-skills.js — Skill XP, leveling, and overall level spillover
// Needs loadAccount, saveAccount, getEquippedCardEffects, rpgData via init(deps).

var masteryCore = require('./mastery/mastery-core');

var loadAccount;
var saveAccount;
var getEquippedCardEffects;
var rpgData;
var _vipPerks = require('./vip-perks');
var _getCachedVipStatus = null;

var SKILL_MAX_LEVEL = Infinity;

function init(deps) {
  loadAccount = deps.loadAccount;
  saveAccount = deps.saveAccount;
  getEquippedCardEffects = deps.getEquippedCardEffects;
  rpgData = deps.rpgData;
}

// Late-bind VIP status lookup (avoids circular require with handlers/vip.js)
function setVipStatusFn(fn) {
  _getCachedVipStatus = fn;
}

function xpForLevel(n) { return Math.floor(80 * Math.pow(n, 1.7)); }

function getSkill(key, skillName) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!account.skills) account.skills = {};
  return account.skills[skillName] || { level: 1, xp: 0 };
}

function addSkillXp(key, skillName, amount, xpRate, existingAccount) {
  var account = existingAccount || loadAccount(key);
  if (!account) return null;
  if (!account.skills) account.skills = rpgData.getDefaultSkills();
  if (!account.skills[skillName]) account.skills[skillName] = { level: 1, xp: 0 };

  // Apply server rules xpRate multiplier (custom shard setting)
  if (typeof xpRate === 'number' && xpRate > 0) {
    amount = Math.round(amount * xpRate);
  }

  // Apply racial XP bonuses
  var xpMultiplier = 1.0;
  if (account.race) {
    var race = rpgData.RACES[account.race];
    if (race && race.racialFeat && race.racialFeat.effects) {
      for (var ei = 0; ei < race.racialFeat.effects.length; ei++) {
        var eff = race.racialFeat.effects[ei];
        if (eff.type === 'xp_bonus_all') xpMultiplier += eff.value;
        if (eff.type === 'xp_bonus_skill' && eff.skill === skillName) xpMultiplier += eff.value;
      }
    }
  }
  // Apply stat-based XP bonus (acumen)
  if (account.rpgStats) {
    xpMultiplier += (account.rpgStats.acumen || 5) * 0.01;
  }
  // Apply equipped card XP bonuses (pass account to avoid redundant loadAccount)
  var cardEffects = getEquippedCardEffects(key, account);
  for (var ci = 0; ci < cardEffects.length; ci++) {
    var cardEff = cardEffects[ci];
    if (cardEff.type === 'xp_bonus_all' && cardEff.value) {
      xpMultiplier += cardEff.value;
    }
    if (cardEff.type === 'xp_bonus_skill' && cardEff.skill === skillName && cardEff.value) {
      xpMultiplier += cardEff.value;
    }
  }

  // Apply mastery tree XP bonus
  var masteryXpBonus = masteryCore.getSkillMasteryBonuses(account, skillName).skill_xp_pct || 0;
  xpMultiplier += masteryXpBonus;

  // Apply VIP XP multiplier
  if (_vipPerks && _getCachedVipStatus) {
    var _vipSt = _getCachedVipStatus(key);
    xpMultiplier *= _vipPerks.getXpMultiplier(_vipSt);
  }

  var adjustedAmount = Math.round(amount * xpMultiplier);
  var skill = account.skills[skillName];
  skill.xp += adjustedAmount;
  var leveledUp = false;

  while (skill.level < SKILL_MAX_LEVEL && skill.xp >= xpForLevel(skill.level)) {
    skill.xp -= xpForLevel(skill.level);
    skill.level++;
    leveledUp = true;
    // Grant 1 mastery point per skill level-up
    if (!account.skillMasteryPoints) account.skillMasteryPoints = {};
    account.skillMasteryPoints[skillName] = (account.skillMasteryPoints[skillName] || 0) + 1;
  }

  // 10% XP spillover to overall level
  var overallLeveledUp = false;
  var spillXp = Math.round(adjustedAmount * rpgData.XP_SPILLOVER_RATE);
  if (spillXp > 0 && account.level < rpgData.MAX_OVERALL_LEVEL) {
    if (typeof account.xp !== 'number') account.xp = 0;
    account.xp += spillXp;
    while (account.level < rpgData.MAX_OVERALL_LEVEL && account.xp >= rpgData.overallXpForLevel(account.level)) {
      account.xp -= rpgData.overallXpForLevel(account.level);
      account.level++;
      overallLeveledUp = true;
      // Award card pack on level up
      account.pendingPacks = (account.pendingPacks || 0) + 1;
      // Update card slots (total + split)
      account.cardSlots = rpgData.getCardSlotCount(account.level);
      account.activeCardSlots = rpgData.getActiveCardSlotCount(account.level);
      account.passiveCardSlots = rpgData.getPassiveCardSlotCount(account.level);
      // Award stat point every 3 levels
      if (account.level % rpgData.STAT_POINTS_PER_LEVELS === 0) {
        if (!account.rpgStats) account.rpgStats = rpgData.getDefaultStats();
        account.rpgStats.freePoints = (account.rpgStats.freePoints || 0) + 1;
      }
    }
  }

  // --- Skill milestone world quest check ---
  if (leveledUp && account.questProgress && account.questProgress.active) {
    var _smRpg = require('./rpg-data');
    for (var _smi = 0; _smi < account.questProgress.active.length; _smi++) {
      var _smq = account.questProgress.active[_smi];
      var _smTmpl = _smRpg.WORLD_QUEST_TEMPLATES && _smRpg.WORLD_QUEST_TEMPLATES.find(function(t) { return t.questId === _smq.questId; });
      if (_smTmpl && _smTmpl.type === 'skill_milestone' && _smTmpl.target.skill === skillName) {
        if (skill.level >= _smTmpl.target.level && _smq.progress < _smq.targetCount) {
          _smq.progress = _smq.targetCount; // mark complete on next save
        }
      }
    }
  }

  saveAccount(account);
  return {
    level: skill.level, xp: skill.xp, xpNeeded: xpForLevel(skill.level), leveledUp: leveledUp,
    overallLevel: account.level, overallXp: account.xp, overallLeveledUp: overallLeveledUp,
    pendingPacks: account.pendingPacks || 0,
    freeStatPoints: account.rpgStats ? account.rpgStats.freePoints : 0,
    masteryPoints: (account.skillMasteryPoints || {})[skillName] || 0,
  };
}

module.exports = {
  init,
  setVipStatusFn,
  xpForLevel,
  getSkill,
  addSkillXp,
};
