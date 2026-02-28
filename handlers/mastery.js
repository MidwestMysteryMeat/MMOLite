// handlers/mastery.js — Socket handler for skill mastery tree system.
// Events: mastery_tree_status, mastery_invest_point, mastery_reset_tree

var masteryCore = require('../mastery/mastery-core');

function init(io, socket, deps) {
  var accounts = deps.accounts;
  var socketAccountMap = deps.socketAccountMap;

  socket.on('mastery_tree_status', function(data) {
    if (!data || typeof data.skillName !== 'string') return;
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;

    var skillName = data.skillName;
    var tree = masteryCore.getMasteryTree(skillName);
    if (!tree) {
      socket.emit('mastery_tree_status', { error: 'No mastery tree for this skill.' });
      return;
    }

    var skill = (account.skills || {})[skillName];
    socket.emit('mastery_tree_status', {
      skillName: skillName,
      tree: tree.nodeList,
      invested: (account.skillMasteryNodes || {})[skillName] || {},
      points: (account.skillMasteryPoints || {})[skillName] || 0,
      skillLevel: skill ? skill.level : 1,
    });
  });

  socket.on('mastery_invest_point', function(data) {
    if (!data || typeof data.skillName !== 'string' || typeof data.nodeId !== 'string') return;
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;

    var result = masteryCore.investPoint(account, data.skillName, data.nodeId);
    if (result.ok) {
      accounts.saveAccount(account);
    }
    socket.emit('mastery_invest_result', result);
  });

  socket.on('mastery_reset_tree', function(data) {
    if (!data || typeof data.skillName !== 'string') return;
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;

    var result = masteryCore.resetTree(account, data.skillName);
    if (result.ok) {
      accounts.saveAccount(account);
    }
    socket.emit('mastery_reset_result', result);
  });
}

module.exports = { init: init };
