'use strict';

// quest-adlib.js
// Procedural quest generation via seeded ad-lib engine.
// Fires during npc_interact when no authored quests exist for an NPC.
// Quests are stable per NPC per UTC day (same NPC offers same quest all day).

// ── Seeded RNG (mulberry32) ──────────────────────────────────────────────────

function hashStr(str) {
  var h = 0x811c9dc5 >>> 0;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function makeRng(seed) {
  var s = (seed >>> 0) || 1;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

// UTC day number — changes at midnight, making quests daily
function utcDay() {
  return Math.floor(Date.now() / 86400000);
}

// ── Word banks ───────────────────────────────────────────────────────────────

var WB = {
  creature_plural: [
    'wolves', 'spiders', 'skeletons', 'bandits', 'cultists', 'shades',
    'goblin raiders', 'orc scouts', 'rift spawn', 'plague rats', 'hollow things',
    'grave-walkers', 'feral dogs', 'bog lurkers', 'corpse beetles',
  ],
  creature_singular: [
    'wolf', 'spider', 'skeleton', 'bandit', 'cultist', 'shade',
    'goblin raider', 'orc scout', 'rift spawn', 'plague rat', 'hollow',
    'grave-walker', 'feral dog', 'bog lurker', 'corpse beetle',
  ],
  region_feature: [
    'crossroads', 'old quarry', 'collapsed bridge', 'abandoned mine', 'river ford',
    'rift scar', 'ruined waystation', 'haunted mill', 'eastern trail', 'the low road',
    'the ridge camp', 'old cemetery', 'market approach', 'grain stores',
  ],
  relic: [
    'carved bone token', 'wax-sealed letter', 'merchant seal', 'iron key',
    'encrypted ledger', 'torn map fragment', 'alchemist vial', 'guild sigil',
    'brass compass', 'old signet ring', 'transit papers', 'crate of supplies',
  ],
  resource: [
    { label: 'brightcap mushrooms',  id: 'brightcap_mushroom' },
    { label: 'rift crystal shards',  id: 'rift_crystal_shard' },
    { label: 'wolf pelts',           id: 'wolf_pelt' },
    { label: 'alchemist root',       id: 'alchemist_root' },
    { label: 'iron ore',             id: 'iron_ore' },
    { label: 'dragonblood sap',      id: 'dragonblood_sap' },
    { label: 'cave moss',            id: 'cave_moss' },
    { label: 'boneflower',           id: 'boneflower' },
    { label: 'saltwater kelp',       id: 'saltwater_kelp' },
    { label: 'ember coal',           id: 'ember_coal' },
  ],
  danger_adj: [
    'infested with', 'overrun by', 'swarming with', 'crawling with', 'plagued by',
  ],
  urgency: [
    'before sundown', 'within the day', 'before the next patrol',
    'while the trail is still warm', 'before word spreads', 'tonight if you can',
  ],
  opener_warn: [
    "Something's wrong out there.",
    "Don't go past the marker stones tonight.",
    "I wouldn't usually ask a stranger, but —",
    "The guards won't move on it. Someone has to.",
  ],
  opener_job: [
    "Got work, if you're up for it.",
    "You look like you can handle yourself.",
    "Name your price — I'm running low on patience and options.",
    "I've been waiting for someone capable to come through.",
  ],
  opener_plea: [
    "I'm not asking for charity.",
    "I'll pay what I have. It's not much.",
    "There's no one else I can ask.",
    "My usual contacts won't touch this. You're my last option.",
  ],
  dungeon_reason: [
    "I need proof of what's down there.",
    "The Rift wardens won't tell us how deep it goes. Find out.",
    "Something came out of those depths. I need to know what sent it.",
    "We lost three men on the lower floors. Bring back what they carried.",
  ],
};

// ── Quest type affinity by NPC occupation ───────────────────────────────────

var TYPE_AFFINITY = {
  guard:              ['kill', 'kill', 'dungeon'],
  soldier:            ['kill', 'dungeon'],
  farmer:             ['gather', 'gather', 'fetch'],
  wandering_merchant: ['fetch', 'fetch', 'kill'],
  merchant:           ['fetch', 'kill'],
  innkeeper:          ['fetch', 'kill'],
  craftsman:          ['gather', 'fetch'],
  healer:             ['gather', 'gather', 'fetch'],
  priest:             ['fetch', 'kill'],
  civilian:           ['fetch', 'kill', 'gather'],
  scout:              ['kill', 'dungeon'],
  hunter:             ['kill', 'gather'],
  alchemist:          ['gather', 'gather'],
};

var DEFAULT_AFFINITY = ['kill', 'fetch', 'gather'];

// NPCs that should generate procedural quests. Excludes shop_keeper, jailer,
// vampire_npc, and other role-specific NPCs with their own interaction logic.
var QUEST_ELIGIBLE = new Set([
  'guard', 'soldier', 'farmer', 'wandering_merchant', 'merchant',
  'innkeeper', 'craftsman', 'healer', 'priest', 'civilian',
  'scout', 'hunter', 'alchemist',
]);

// ── Quest builders ───────────────────────────────────────────────────────────

function buildKillQuest(rng) {
  var idx    = Math.floor(rng() * WB.creature_plural.length);
  var plural = WB.creature_plural[idx];
  var single = WB.creature_singular[idx];
  var count  = 3 + Math.floor(rng() * 5);   // 3–7
  var feat   = pick(rng, WB.region_feature);
  var opener = pick(rng, WB.opener_warn);
  var danger = pick(rng, WB.danger_adj);
  var urg    = pick(rng, WB.urgency);
  return {
    type:        'kill',
    name:        cap(plural) + ' near the ' + cap(feat),
    description: '"' + opener + ' The ' + feat + ' is ' + danger + ' ' + plural + '. '
                 + 'I need someone to clear at least ' + count + ' of them — ' + urg + '."',
    target:      { monster: single.split(' ')[0], count: count },
    coins:       40 + Math.floor(rng() * 80),
    xp:          30 + Math.floor(rng() * 50),
  };
}

function buildFetchQuest(rng) {
  var relic  = pick(rng, WB.relic);
  var opener = pick(rng, WB.opener_job);
  var urg    = pick(rng, WB.urgency);
  return {
    type:        'fetch',
    name:        'Errand: ' + cap(relic),
    description: '"' + opener + ' I need a ' + relic + ' brought to me — '
                 + 'can\'t trust the regular couriers right now. Get it done ' + urg + '."',
    target:      { count: 1 },
    coins:       25 + Math.floor(rng() * 50),
    xp:          15 + Math.floor(rng() * 30),
  };
}

function buildGatherQuest(rng) {
  var res    = pick(rng, WB.resource);
  var count  = 3 + Math.floor(rng() * 8);   // 3–10
  var opener = pick(rng, WB.opener_plea);
  return {
    type:        'gather',
    name:        'Gathering: ' + cap(res.label),
    description: '"' + opener + ' I need ' + count + ' ' + res.label + '. '
                 + 'The usual supplier hasn\'t come through. '
                 + 'Bring them back and I\'ll make it worth your while."',
    target:      { resource: res.id, count: count },
    coins:       30 + Math.floor(rng() * 60),
    xp:          20 + Math.floor(rng() * 40),
  };
}

function buildDungeonQuest(rng) {
  var floor  = 3 + Math.floor(rng() * 8);   // floor 3–10
  var reason = pick(rng, WB.dungeon_reason);
  return {
    type:        'dungeon',
    name:        'Rift Expedition: Floor ' + floor,
    description: '"' + reason + ' Reach floor ' + floor + ' and report back."',
    target:      { minFloor: floor },
    coins:       80 + Math.floor(rng() * 120),
    xp:          60 + Math.floor(rng() * 80),
  };
}

// ── In-memory cache ──────────────────────────────────────────────────────────
// Keyed by questId. Ephemeral — rebuilt as players interact.
// Daily IDs mean yesterday's quests fall out of use naturally.

var _cache = new Map();

// ── Public API ───────────────────────────────────────────────────────────────

function isQuestEligible(npc) {
  var role = ((npc.occupation || npc.role) || '').toLowerCase();
  return QUEST_ELIGIBLE.has(role);
}

function generateQuest(npc) {
  var npcKey = npc.id || npc.name || 'unknown';
  var day    = utcDay();
  var seed   = hashStr(npcKey + ':' + day);
  var rng    = makeRng(seed);

  var role     = ((npc.occupation || npc.role) || '').toLowerCase();
  var affinity = TYPE_AFFINITY[role] || DEFAULT_AFFINITY;
  var qtype    = pick(rng, affinity);

  var q;
  if (qtype === 'kill')    q = buildKillQuest(rng);
  else if (qtype === 'gather') q = buildGatherQuest(rng);
  else if (qtype === 'dungeon') q = buildDungeonQuest(rng);
  else                          q = buildFetchQuest(rng);

  var questId = 'proc_' + npcKey.replace(/\s+/g, '_') + '_' + day;

  var template = {
    questId:         questId,
    name:            q.name,
    description:     q.description,
    type:            q.type,
    target:          q.target,
    rewards:         { coins: q.coins, xp: q.xp },
    npcId:           npc.id || null,
    _procedural:     true,
    repeatableDaily: true,
  };

  _cache.set(questId, template);
  return template;
}

// Used by quest_accept and quest_turnin as a third fallback after
// WORLD_QUEST_TEMPLATES and writing-tool authored quests.
function getGeneratedQuest(questId) {
  return _cache.get(questId) || null;
}

module.exports = { generateQuest, getGeneratedQuest, isQuestEligible };
