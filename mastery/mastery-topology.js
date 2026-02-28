// mastery/mastery-topology.js — Universal 24-node tree shape for skill mastery.
// All skills share this topology; only effects + names differ (via flavorMap).
//
// Layout (5 columns x 7 rows):
//   Tier 0: root (col 2)
//   Tier 1: 3 foundation nodes (cols 1,2,3)
//   Tier 2: 4 branch entry nodes (cols 0,1,3,4)
//   Tier 3: 12 branch mid nodes (3 per branch, cols 0,1,3,4 across 3 rows)
//   Tier 4: 4 capstones (cols 0,1,3,4)

// Node template — positions and prereqs are fixed, flavor fills in the rest.
var TOPOLOGY = [
  // Tier 0: root
  { slot: 'root', tier: 0, branch: -1, maxRank: 5, x: 2, y: 0, requires: [] },

  // Tier 1: foundation (3 nodes connecting root to branches)
  { slot: 'fa', tier: 1, branch: -1, maxRank: 5, x: 1, y: 1, requires: ['root'] },
  { slot: 'fb', tier: 1, branch: -1, maxRank: 5, x: 2, y: 1, requires: ['root'] },
  { slot: 'fc', tier: 1, branch: -1, maxRank: 5, x: 3, y: 1, requires: ['root'] },

  // Tier 2: branch entries (4 branches)
  { slot: 'b1e', tier: 2, branch: 0, maxRank: 3, x: 0, y: 2, requires: ['fa'] },
  { slot: 'b2e', tier: 2, branch: 1, maxRank: 3, x: 1, y: 2, requires: ['fb'] },
  { slot: 'b3e', tier: 2, branch: 2, maxRank: 3, x: 3, y: 2, requires: ['fb'] },
  { slot: 'b4e', tier: 2, branch: 3, maxRank: 3, x: 4, y: 2, requires: ['fc'] },

  // Tier 3: branch mid (3 per branch, stacked vertically)
  { slot: 'b1m1', tier: 3, branch: 0, maxRank: 3, x: 0, y: 3, requires: ['b1e'] },
  { slot: 'b1m2', tier: 3, branch: 0, maxRank: 3, x: 0, y: 4, requires: ['b1m1'] },
  { slot: 'b1m3', tier: 3, branch: 0, maxRank: 3, x: 0, y: 5, requires: ['b1m2'] },

  { slot: 'b2m1', tier: 3, branch: 1, maxRank: 3, x: 1, y: 3, requires: ['b2e'] },
  { slot: 'b2m2', tier: 3, branch: 1, maxRank: 3, x: 1, y: 4, requires: ['b2m1'] },
  { slot: 'b2m3', tier: 3, branch: 1, maxRank: 3, x: 1, y: 5, requires: ['b2m2'] },

  { slot: 'b3m1', tier: 3, branch: 2, maxRank: 3, x: 3, y: 3, requires: ['b3e'] },
  { slot: 'b3m2', tier: 3, branch: 2, maxRank: 3, x: 3, y: 4, requires: ['b3m1'] },
  { slot: 'b3m3', tier: 3, branch: 2, maxRank: 3, x: 3, y: 5, requires: ['b3m2'] },

  { slot: 'b4m1', tier: 3, branch: 3, maxRank: 3, x: 4, y: 3, requires: ['b4e'] },
  { slot: 'b4m2', tier: 3, branch: 3, maxRank: 3, x: 4, y: 4, requires: ['b4m1'] },
  { slot: 'b4m3', tier: 3, branch: 3, maxRank: 3, x: 4, y: 5, requires: ['b4m2'] },

  // Tier 4: capstones
  { slot: 'b1cap', tier: 4, branch: 0, maxRank: 1, x: 0, y: 6, requires: ['b1m3'] },
  { slot: 'b2cap', tier: 4, branch: 1, maxRank: 1, x: 1, y: 6, requires: ['b2m3'] },
  { slot: 'b3cap', tier: 4, branch: 2, maxRank: 1, x: 3, y: 6, requires: ['b3m3'] },
  { slot: 'b4cap', tier: 4, branch: 3, maxRank: 1, x: 4, y: 6, requires: ['b4m3'] },
];

// Build a concrete mastery tree for a specific skill.
// flavorMap: { slotName: { name, desc, effect: { type, value } } }
// Returns { nodes: { nodeId: nodeObj, ... }, nodeList: [...] }
function buildTree(skillId, flavorMap) {
  var nodes = {};
  var nodeList = [];
  for (var i = 0; i < TOPOLOGY.length; i++) {
    var t = TOPOLOGY[i];
    var flavor = flavorMap[t.slot];
    if (!flavor) continue;
    var nodeId = skillId + '_' + t.slot;
    var requires = [];
    for (var ri = 0; ri < t.requires.length; ri++) {
      requires.push(skillId + '_' + t.requires[ri]);
    }
    var node = {
      id: nodeId,
      name: flavor.name,
      desc: flavor.desc,
      tier: t.tier,
      branch: t.branch,
      maxRank: t.maxRank,
      pointCost: 1,
      requires: requires,
      effect: { type: flavor.effect.type, value: flavor.effect.value },
      x: t.x,
      y: t.y,
    };
    nodes[nodeId] = node;
    nodeList.push(node);
  }
  return { nodes: nodes, nodeList: nodeList };
}

module.exports = { TOPOLOGY: TOPOLOGY, buildTree: buildTree };
