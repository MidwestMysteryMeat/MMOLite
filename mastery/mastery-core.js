// mastery/mastery-core.js — Tree registry, point investment, reset, bonus aggregation.
// Follows getDungeonSkillBonuses() pattern from dungeon-progression.js.

var gatheringTrees = require('./mastery-trees-gathering').GATHERING_TREES;
var craftingTrees = require('./mastery-trees-crafting').CRAFTING_TREES;
var combatTrees = require('./mastery-trees-combat').COMBAT_TREES;
var explorationTrees = require('./mastery-trees-exploration').EXPLORATION_TREES;

// Merged registry: skillId -> { nodes, nodeList }
var MASTERY_TREES = {};
var _sources = [gatheringTrees, craftingTrees, combatTrees, explorationTrees];
for (var si = 0; si < _sources.length; si++) {
  var src = _sources[si];
  for (var key in src) {
    MASTERY_TREES[key] = src[key];
  }
}

function getMasteryTree(skillName) {
  return MASTERY_TREES[skillName] || null;
}

// Aggregate all mastery bonuses for a skill into a flat { effectType: totalValue } map.
function getSkillMasteryBonuses(account, skillName) {
  var bonuses = {};
  var invested = (account.skillMasteryNodes || {})[skillName];
  if (!invested) return bonuses;
  var tree = getMasteryTree(skillName);
  if (!tree) return bonuses;
  for (var nodeId in invested) {
    var rank = invested[nodeId];
    var node = tree.nodes[nodeId];
    if (!node || rank <= 0) continue;
    bonuses[node.effect.type] = (bonuses[node.effect.type] || 0) + (node.effect.value * rank);
  }
  return bonuses;
}

// Invest 1 rank in a node. Returns { ok, error?, nodeId?, rank?, pointsLeft? }.
function investPoint(account, skillName, nodeId) {
  var tree = getMasteryTree(skillName);
  if (!tree) return { ok: false, error: 'No mastery tree for skill.' };
  var node = tree.nodes[nodeId];
  if (!node) return { ok: false, error: 'Unknown node.' };

  if (!account.skillMasteryPoints) account.skillMasteryPoints = {};
  if (!account.skillMasteryNodes) account.skillMasteryNodes = {};
  if (!account.skillMasteryNodes[skillName]) account.skillMasteryNodes[skillName] = {};

  var points = account.skillMasteryPoints[skillName] || 0;
  if (points < 1) return { ok: false, error: 'No mastery points available.' };

  var currentRank = account.skillMasteryNodes[skillName][nodeId] || 0;
  if (currentRank >= node.maxRank) return { ok: false, error: 'Max rank reached.' };

  // Check prerequisites: all requires nodes must have rank >= 1
  for (var ri = 0; ri < node.requires.length; ri++) {
    var reqId = node.requires[ri];
    if ((account.skillMasteryNodes[skillName][reqId] || 0) < 1) {
      return { ok: false, error: 'Prerequisites not met.' };
    }
  }

  account.skillMasteryPoints[skillName] = points - 1;
  account.skillMasteryNodes[skillName][nodeId] = currentRank + 1;

  return {
    ok: true,
    nodeId: nodeId,
    rank: account.skillMasteryNodes[skillName][nodeId],
    pointsLeft: account.skillMasteryPoints[skillName],
  };
}

// Reset all invested nodes for a skill. Returns { ok, refundedPoints, goldCost }.
function resetTree(account, skillName) {
  var tree = getMasteryTree(skillName);
  if (!tree) return { ok: false, error: 'No mastery tree for skill.' };

  if (!account.skillMasteryNodes) account.skillMasteryNodes = {};
  var invested = account.skillMasteryNodes[skillName];
  if (!invested) return { ok: false, error: 'Nothing invested.' };

  var totalRanks = 0;
  for (var nodeId in invested) {
    totalRanks += invested[nodeId];
  }
  if (totalRanks === 0) return { ok: false, error: 'Nothing invested.' };

  var goldCost = 500 * totalRanks;
  var chips = account.chips || 0;
  if (chips < goldCost) return { ok: false, error: 'Not enough gold. Need ' + goldCost + '.' };

  account.chips = chips - goldCost;
  account.skillMasteryNodes[skillName] = {};
  if (!account.skillMasteryPoints) account.skillMasteryPoints = {};
  account.skillMasteryPoints[skillName] = (account.skillMasteryPoints[skillName] || 0) + totalRanks;

  return { ok: true, refundedPoints: totalRanks, goldCost: goldCost };
}

module.exports = {
  MASTERY_TREES: MASTERY_TREES,
  getMasteryTree: getMasteryTree,
  getSkillMasteryBonuses: getSkillMasteryBonuses,
  investPoint: investPoint,
  resetTree: resetTree,
};
