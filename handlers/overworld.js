// handlers/overworld.js
// NPC interaction with dialogue trees, item pickup, wild encounters, world quests.

var rpgData = require('../rpg-data');
var prison = require('./prison');

module.exports = {
  init(io, socket, deps) {
    var { user, state, socketAccountMap, accounts, loot, checkEventRate } = deps;

    // Per-socket dialogue state
    var npcDialogueState = null; // { npcId, npcName, currentNode, tree }

    // Helper: check if a dialogue choice condition is met
    function checkCondition(cond, account) {
      if (!cond) return true;
      switch (cond.type) {
        case 'race':
          return account && account.race === cond.race;
        case 'skill':
          if (!account || !account.skills) return false;
          var sk = account.skills[cond.skill];
          return sk && sk.level >= cond.minLevel;
        case 'has_item':
          if (!account || !account.mmoInventory) return false;
          return (account.mmoInventory[cond.item] || 0) >= (cond.count || 1);
        case 'no_guild':
          return !account || !account.guildId;
        case 'has_guild':
          return account && account.guildId;
        case 'quest_active':
          if (!account || !account.questProgress) return false;
          var active = account.questProgress.active || [];
          return active.some(function(q) { return q.questId === cond.questId; });
        case 'quest_complete':
          if (!account || !account.questProgress) return false;
          var completed = account.questProgress.completed || [];
          return completed.indexOf(cond.questId) !== -1;
        case 'karma':
          if (!account) return false;
          var karmaVal = typeof account.karma === 'number' ? account.karma : 0;
          if (cond.min !== undefined && karmaVal < cond.min) return false;
          if (cond.max !== undefined && karmaVal > cond.max) return false;
          return true;
        case 'faction_rep':
          if (!account || !account.factionRep) return false;
          var repVal = account.factionRep[cond.faction] || 0;
          if (cond.min !== undefined && repVal < cond.min) return false;
          if (cond.max !== undefined && repVal > cond.max) return false;
          return true;
        case 'town_rep':
          if (!account || !account.townReputation) return false;
          var townRepVal = account.townReputation[cond.town] || 0;
          if (cond.min !== undefined && townRepVal < cond.min) return false;
          if (cond.max !== undefined && townRepVal > cond.max) return false;
          return true;
        case 'ascended':
          return account && (account.ascensionCount || 0) >= (cond.minCount || 1);
        default:
          return true;
      }
    }

    // Helper: send a dialogue node to the client
    function sendDialogueNode(npc, node, tree, account) {
      if (!node) {
        // End dialogue
        npcDialogueState = null;
        socket.emit('npc_dialogue_end', { npcId: npc.id });
        return;
      }

      // Filter choices by conditions
      var filteredChoices = [];
      if (node.choices) {
        for (var i = 0; i < node.choices.length; i++) {
          var choice = node.choices[i];
          if (checkCondition(choice.condition, account)) {
            filteredChoices.push({
              index: i,
              label: choice.label,
            });
          }
        }
      }

      npcDialogueState = { npcId: npc.id, npcName: npc.name, currentNode: node, tree: tree };

      socket.emit('npc_dialogue', {
        npcId: npc.id,
        npcName: npc.name,
        text: node.text,
        choices: filteredChoices,
      });
    }

    // --- npc_interact: talk to an NPC ---
    socket.on('npc_interact', function(data) {
      if (!data || typeof data.npcId !== 'string') return;

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;

      var zone = state.zones.get(zoneId);
      if (!zone) return;

      var npc = null;
      if (zone.npcs) {
        npc = zone.npcs.find(function(n) { return n.id === data.npcId; });
      }
      if (!npc) {
        socket.emit('npc_error', { message: 'NPC not found' });
        return;
      }

      // Load account for condition checks
      var accKey = socketAccountMap.get(socket.id);
      var account = accKey ? accounts.loadAccount(accKey) : null;

      // Guard NPCs enforce karma hostility — refuse entry if karma below threshold
      if (npc.type === 'guard' && account) {
        var karmaVal = typeof account.karma === 'number' ? account.karma : 0;
        // Severe criminal: arrest on sight
        if (karmaVal <= prison.KARMA_ARREST_THRESHOLD) {
          var crimeType = karmaVal <= -80 ? 'murder' : karmaVal <= -60 ? 'assault' : 'trespassing';
          prison.arrestPlayer(account, crimeType);
          accounts.saveAccount(account);
          socket.emit('npc_dialogue', {
            npcId: npc.id,
            npcName: npc.name,
            text: 'Criminal scum! You are under arrest for ' + (prison.CRIME_DEFINITIONS[crimeType] || {}).label + '. Take them away!',
            choices: [{ index: 0, label: '(Submit to arrest)' }],
          });
          socket.emit('jail_status', {
            inJail: true,
            crime: crimeType,
            crimeLabel: (prison.CRIME_DEFINITIONS[crimeType] || {}).label,
            remainingMs: prison.getRemainingTime(account),
            bail: (prison.CRIME_DEFINITIONS[crimeType] || {}).bail,
          });
          return;
        }
        if (karmaVal <= -30) {
          socket.emit('npc_dialogue', {
            npcId: npc.id,
            npcName: npc.name,
            text: 'You are not welcome here. Leave before I summon the watch.',
            choices: [{ index: 0, label: '(Back away)' }],
          });
          return;
        }
      }

      // Check if NPC is sleeping
      var currentPhase = (state && typeof state.getTimeOfDay === 'function') ? state.getTimeOfDay() : 'day';
      if (state.isNpcAsleep && state.isNpcAsleep(npc, currentPhase)) {
        socket.emit('npc_dialogue', {
          npcId: npc.id,
          npcName: npc.name,
          text: (npc.name || 'The NPC') + ' is sleeping. Come back during the day.',
          choices: [{ index: 0, label: '(Leave quietly)' }],
        });
        return;
      }

      // Look up dialogue tree — check direct npcId first, then npc type for generic NPCs
      var dialogueTree = null;
      if (rpgData.NPC_DIALOGUES) {
        dialogueTree = rpgData.NPC_DIALOGUES[npc.id] || rpgData.NPC_DIALOGUES[npc.type] || null;
      }

      if (dialogueTree && dialogueTree.start) {
        // Use dialogue tree system
        sendDialogueNode(npc, dialogueTree.start, dialogueTree, account);
      } else {
        // Fallback: legacy single-line dialog
        socket.emit('npc_dialogue', {
          npcId: npc.id,
          npcName: npc.name,
          type: npc.type || 'talk',
          text: npc.dialog || npc.dialogue || '...',
          choices: [],
        });
      }

      // Increment NPC relationship + town reputation on successful interaction
      if (account) {
        if (!account.npcRelationships) account.npcRelationships = {};
        account.npcRelationships[data.npcId] = Math.min(100, (account.npcRelationships[data.npcId] || 0) + 1);
        if (!account.townReputation) account.townReputation = {};
        account.townReputation[zoneId] = Math.min(100, (account.townReputation[zoneId] || 0) + 0.5);
        accounts.saveAccount(account);
        socket.emit('npc_interact_result', {
          npcId: data.npcId,
          npcRelationship: account.npcRelationships[data.npcId],
          townReputation: account.townReputation[zoneId],
        });
      }
    });

    // --- npc_dialogue_choice: player selects a dialogue option ---
    socket.on('npc_dialogue_choice', function(data) {
      if (!npcDialogueState) return;
      if (!data || typeof data.choiceIndex !== 'number') return;

      var node = npcDialogueState.currentNode;
      var tree = npcDialogueState.tree;
      if (!node || !node.choices) return;

      var choice = node.choices[data.choiceIndex];
      if (!choice) return;

      var accKey = socketAccountMap.get(socket.id);
      var account = accKey ? accounts.loadAccount(accKey) : null;

      // Execute action if any
      if (choice.action) {
        switch (choice.action) {
          case 'open_shop':
          case 'open_card_shop':
          case 'open_ritual_trainer':
          case 'open_portal':
          case 'open_bank':
            socket.emit('npc_action', { action: choice.action, npcId: npcDialogueState.npcId });
            break;
          case 'heal':
            if (account) {
              // Restore full HP (use rpgStats if available)
              if (account.rpgStats) {
                var maxHp = 50 + (account.rpgStats.vigor || 5) * 10;
                account.currentHp = maxHp;
                accounts.saveAccount(account);
              }
              socket.emit('npc_action', { action: 'healed', npcId: npcDialogueState.npcId });
            }
            break;
          case 'give_quest':
            if (choice.questId && account) {
              if (!account.questProgress) account.questProgress = { active: [], completed: [], dailyWorldQuests: [] };
              // Check not already active or completed (non-repeatable)
              var alreadyActive = account.questProgress.active.some(function(q) { return q.questId === choice.questId; });
              var alreadyComplete = account.questProgress.completed.indexOf(choice.questId) !== -1;
              var template = null;
              if (rpgData.WORLD_QUEST_TEMPLATES) {
                template = rpgData.WORLD_QUEST_TEMPLATES.find(function(t) { return t.questId === choice.questId; });
              }
              if (!alreadyActive && (!alreadyComplete || (template && template.repeatableDaily))) {
                account.questProgress.active.push({
                  questId: choice.questId,
                  templateId: choice.questId,
                  progress: 0,
                  targetCount: template ? (template.target.count || template.target.level || template.target.biomes || template.target.minFloor || 1) : 1,
                  startedAt: Date.now(),
                  npcId: npcDialogueState.npcId,
                });
                accounts.saveAccount(account);
                socket.emit('quest_accepted', {
                  questId: choice.questId,
                  name: template ? template.name : choice.questId,
                  description: template ? template.description : '',
                  target: template ? template.target : {},
                  progress: 0,
                });
              }
            }
            break;
          case 'guild_join':
            socket.emit('npc_action', { action: 'guild_join', npcId: npcDialogueState.npcId });
            break;
          case 'show_rank':
            if (account) {
              socket.emit('npc_action', { action: 'show_rank', npcId: npcDialogueState.npcId, guildId: account.guildId || null });
            }
            break;
          case 'give_item':
            if (choice.item && account) {
              accounts.addResource(accKey, choice.item, choice.amount || 1);
              socket.emit('npc_action', { action: 'give_item', item: choice.item, amount: choice.amount || 1 });
            }
            break;
          case 'reveal_rumors': {
            var rumorSystem = require('../rumor-system');
            var rumorZoneId = state.playerZones.get(socket.id);
            var rumors = rumorSystem.getTownRumors(rumorZoneId);
            socket.emit('npc_action', { action: 'reveal_rumors', rumors: rumors });
            break;
          }
          case 'faction_gain_rep':
            if (account && choice.factionId && choice.amount) {
              if (!account.factionRep) account.factionRep = {};
              account.factionRep[choice.factionId] = Math.min(15000,
                (account.factionRep[choice.factionId] || 0) + choice.amount);
              accounts.saveAccount(account);
              socket.emit('npc_action', { action: 'faction_rep_gained', factionId: choice.factionId, amount: choice.amount });
            }
            break;
          case 'karma_gain':
            if (account && choice.amount) {
              if (typeof account.karma !== 'number') account.karma = 0;
              account.karma = Math.max(-100, Math.min(100, account.karma + choice.amount));
              accounts.saveAccount(account);
              socket.emit('npc_action', { action: 'karma_changed', karma: account.karma });
            }
            break;
        }
      }

      // Navigate to next node
      if (choice.nextNode && tree[choice.nextNode]) {
        sendDialogueNode(
          { id: npcDialogueState.npcId, name: npcDialogueState.npcName },
          tree[choice.nextNode],
          tree,
          account
        );
      } else {
        // End dialogue
        var endNpcId = npcDialogueState ? npcDialogueState.npcId : '';
        npcDialogueState = null;
        socket.emit('npc_dialogue_end', { npcId: endNpcId });
      }
    });

    // --- quest_list: get player's active and available quests ---
    socket.on('quest_list', function() {
      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;
      var account = accounts.loadAccount(accKey);
      if (!account) return;

      var questProgress = account.questProgress || { active: [], completed: [], dailyWorldQuests: [] };
      var activeQuests = [];
      for (var i = 0; i < questProgress.active.length; i++) {
        var q = questProgress.active[i];
        var template = null;
        if (rpgData.WORLD_QUEST_TEMPLATES) {
          template = rpgData.WORLD_QUEST_TEMPLATES.find(function(t) { return t.questId === q.questId; });
        }
        activeQuests.push({
          questId: q.questId,
          name: template ? template.name : q.questId,
          description: template ? template.description : '',
          type: template ? template.type : 'unknown',
          progress: q.progress,
          targetCount: q.targetCount,
          target: template ? template.target : {},
          npcId: q.npcId,
        });
      }

      socket.emit('quest_list_result', {
        active: activeQuests,
        completed: questProgress.completed || [],
      });
    });

    // --- quest_accept: accept a quest by ID ---
    socket.on('quest_accept', function(data) {
      if (!data || typeof data.questId !== 'string') return;

      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;
      var account = accounts.loadAccount(accKey);
      if (!account) return;

      if (!account.questProgress) account.questProgress = { active: [], completed: [], dailyWorldQuests: [] };

      var template = null;
      if (rpgData.WORLD_QUEST_TEMPLATES) {
        template = rpgData.WORLD_QUEST_TEMPLATES.find(function(t) { return t.questId === data.questId; });
      }
      if (!template) {
        socket.emit('quest_error', { message: 'Quest not found' });
        return;
      }

      var alreadyActive = account.questProgress.active.some(function(q) { return q.questId === data.questId; });
      if (alreadyActive) {
        socket.emit('quest_error', { message: 'Quest already active' });
        return;
      }

      account.questProgress.active.push({
        questId: data.questId,
        templateId: data.questId,
        progress: 0,
        targetCount: template.target.count || template.target.level || template.target.biomes || template.target.minFloor || 1,
        startedAt: Date.now(),
        npcId: template.npcId || null,
      });
      accounts.saveAccount(account);

      socket.emit('quest_accepted', {
        questId: data.questId,
        name: template.name,
        description: template.description,
        target: template.target,
        progress: 0,
      });
    });

    // --- quest_turnin: turn in a completed quest ---
    socket.on('quest_turnin', function(data) {
      if (!data || typeof data.questId !== 'string') return;

      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;
      var account = accounts.loadAccount(accKey);
      if (!account || !account.questProgress) return;

      var activeIdx = -1;
      for (var i = 0; i < account.questProgress.active.length; i++) {
        if (account.questProgress.active[i].questId === data.questId) {
          activeIdx = i;
          break;
        }
      }
      if (activeIdx === -1) {
        socket.emit('quest_error', { message: 'Quest not active' });
        return;
      }

      var quest = account.questProgress.active[activeIdx];
      if (quest.progress < quest.targetCount) {
        socket.emit('quest_error', { message: 'Quest not complete (' + quest.progress + '/' + quest.targetCount + ')' });
        return;
      }

      var template = null;
      if (rpgData.WORLD_QUEST_TEMPLATES) {
        template = rpgData.WORLD_QUEST_TEMPLATES.find(function(t) { return t.questId === data.questId; });
      }

      // Remove from active
      account.questProgress.active.splice(activeIdx, 1);
      // Add to completed
      if (account.questProgress.completed.indexOf(data.questId) === -1) {
        account.questProgress.completed.push(data.questId);
      }

      // Grant rewards
      var rewards = template ? template.rewards : {};
      if (rewards.coins) {
        accounts.updateChips(accKey, rewards.coins);
      }
      if (rewards.xp) {
        accounts.addOverallXp(accKey, rewards.xp);
      }
      if (rewards.skillXp) {
        for (var sk in rewards.skillXp) {
          accounts.addSkillXp(accKey, sk, rewards.skillXp[sk]);
        }
      }

      accounts.saveAccount(account);

      socket.emit('quest_turnin_result', {
        questId: data.questId,
        success: true,
        rewards: rewards,
      });
    });

    // --- item_pickup: pick up an overworld item ---
    socket.on('item_pickup', function(data) {
      if (!data || typeof data.itemIndex !== 'number') return;

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;

      var zone = state.zones.get(zoneId);
      if (!zone || !zone.items) return;

      var itemIdx = data.itemIndex;
      if (itemIdx < 0 || itemIdx >= zone.items.length) return;

      var item = zone.items[itemIdx];
      if (!item || item.pickedUp) return;

      // Mark as picked up
      item.pickedUp = true;
      item.pickedBy = socket.id;

      // Add to player inventory
      var key = socketAccountMap.get(socket.id);
      if (key) {
        accounts.addInventoryItem(key, {
          itemId: item.itemId,
          source: 'overworld_pickup',
        });
      }

      socket.emit('item_picked', { itemIndex: itemIdx, item: item });

      // Broadcast removal to zone
      io.to('zone:' + zoneId).emit('item_removed', { itemIndex: itemIdx });
    });

    // --- wild_encounter_check: server validates if encounter triggers ---
    socket.on('wild_encounter_check', function(data) {

      var zoneId = state.playerZones.get(socket.id);
      if (!zoneId) return;

      var zone = state.zones.get(zoneId);
      if (!zone || !zone.spawns || zone.spawns.length === 0) return;

      // Roll encounter chance (base 15% per check in grass/wild zones)
      if (Math.random() > 0.15) {
        socket.emit('wild_encounter_result', { encountered: false });
        return;
      }

      // Weighted random monster selection
      var totalWeight = 0;
      for (var i = 0; i < zone.spawns.length; i++) {
        totalWeight += zone.spawns[i].weight;
      }
      var roll = Math.random() * totalWeight;
      var cumulative = 0;
      var selected = zone.spawns[0];
      for (var j = 0; j < zone.spawns.length; j++) {
        cumulative += zone.spawns[j].weight;
        if (roll <= cumulative) {
          selected = zone.spawns[j];
          break;
        }
      }

      // Roll level within range
      var minLvl = selected.level[0] || 1;
      var maxLvl = selected.level[1] || minLvl;
      var level = minLvl + Math.floor(Math.random() * (maxLvl - minLvl + 1));

      var encounter = {
        encountered: true,
        monster: {
          monsterId: selected.monsterId,
          level: level,
        },
      };

      socket.emit('wild_encounter_result', encounter);
    });
  }
};
