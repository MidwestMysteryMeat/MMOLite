// rumor-system.js
// Generates and manages town rumors based on world state

var RUMOR_TEMPLATES = [
  // Rift/dungeon rumors
  { id: 'rift_boss_seen',    text: 'They say a {adjective} beast was spotted on floor {floor} of the Rift.', tags: ['rift'], accuracy: 90 },
  { id: 'rift_collapse',     text: 'Word is the Rift is shifting strangely near floor {floor}. Could be unstable.', tags: ['rift'], accuracy: 75 },
  { id: 'soldier_sighting',  text: 'A wanderer speaks of a nameless soldier walking the Rift floors, neither alive nor dead.', tags: ['rift','lore'], accuracy: 85 },
  { id: 'hollow_spotted',    text: 'Something hollow wearing a {race} shape was seen near {town}. Eyes like empty pits.', tags: ['rift','hollow'], accuracy: 80 },
  // Weather/nature rumors
  { id: 'weather_unusual',   text: 'The weather near {biome} has been strange lately. Locals blame {vague_cause}.', tags: ['weather'], accuracy: 70 },
  { id: 'storm_coming',      text: 'An old {race} sailor says a massive storm is building in the {direction}.', tags: ['weather'], accuracy: 60 },
  // Economy rumors
  { id: 'merchant_robbed',   text: 'A merchant caravan from {town} was reportedly robbed on the road. {resource} prices may rise.', tags: ['economy'], accuracy: 75 },
  { id: 'mine_rich',         text: 'Miners out of {town} struck a rich {resource} vein. Expect prices to fall.', tags: ['economy'], accuracy: 80 },
  { id: 'auction_spike',     text: 'Someone in {town} paid a fortune for a {rarity} card at the auction. The market is buzzing.', tags: ['economy','cards'], accuracy: 85 },
  // Guild/faction rumors
  { id: 'guild_achievement', text: 'The {guild} have reportedly reached floor {floor} of the Rift. Quite an achievement.', tags: ['guild'], accuracy: 90 },
  { id: 'faction_tension',   text: 'Tension between the {faction1} and {faction2} has been rising near {town}.', tags: ['factions'], accuracy: 65 },
  { id: 'dominion_patrol',   text: 'Holy Dominion patrols have been doubled near {town}. Something has them worried.', tags: ['factions','dominion'], accuracy: 80 },
  // Player-driven rumors
  { id: 'bounty_posted',     text: 'A bounty has been posted on someone named {name} out of {town}. Nasty business.', tags: ['crime'], accuracy: 95 },
  { id: 'crime_spree',       text: 'There have been reports of theft near {town}. Watch your belongings.', tags: ['crime'], accuracy: 70 },
  // Lich rumors
  { id: 'lich_stirring',     text: 'Necromancers have been seen near the old battlefields. Something beneath is waking.', tags: ['lich','lore'], accuracy: 65 },
  { id: 'undead_sighting',   text: 'Undead were spotted wandering outside {town} at night. The lich grows bolder.', tags: ['lich'], accuracy: 80 },
  // Leviathan rumors
  { id: 'leviathan_wake',    text: 'Fishing boats near the coast report something massive moving in the deep waters.', tags: ['leviathan'], accuracy: 70 },
  { id: 'sea_monster',       text: 'A captain claims his ship was nearly capsized by a creature of impossible size.', tags: ['leviathan'], accuracy: 60 },
  // Discovery rumors
  { id: 'relic_found',       text: 'Someone pulled a Relic card from the Rift. Everyone at the tavern was talking about it.', tags: ['cards'], accuracy: 90 },
  { id: 'new_cave',          text: 'Explorers found a new cave entrance near {biome} country. Said to go very deep.', tags: ['exploration'], accuracy: 75 },
  // Social rumors
  { id: 'player_wedding',    text: 'Apparently two adventurers in {town} have formed a permanent guild together. Sweet, really.', tags: ['social'], accuracy: 80 },
  { id: 'guild_war',         text: 'Two guilds have been competing fiercely for the same cave. Could get ugly.', tags: ['guild'], accuracy: 70 },
];

// Fill-in values for template variables
var ADJECTIVES = ['terrifying','ancient','enormous','glowing','shadow-wreathed','bone-white','fire-scarred'];
var VAGUE_CAUSES = ['the gods','old magic','the lich','seasonal spirits','a broken seal','proximity to the Rift'];
var DIRECTIONS = ['north','south','deep ocean','eastern reaches','western ranges'];
var RARITIES = ['Legendary','Mythic Rare','Godly','Relic'];
var RESOURCES = ['iron','wood','mana crystals','gem','fish'];
var FACTION_NAMES = ['Holy Dominion','Veiled Hand','Luminary Inquest','Iron Vanguard','Merchant League','Rift Wardens'];
var RACE_NAMES = ['Human','Elf','Dwarf','Orc','Gnome','Goblin','Lizard Folk','Cat Folk'];
var TOWN_DISPLAY_NAMES = ['The Holy Dominion','Solara','Sylvaris','Ironhold','Kragmor','BoneTrap','Murkmire','Mechspire'];
var TOWN_IDS = ['starter_town','solara','sylvaris','ironhold','kragmor','bonetrap','murkmire','mechspire'];
var BIOME_NAMES = ['forest','swamp','mountain','coastal','tundra','desert','plains'];

// Generate rumors per town -- called on server startup and periodically
var townRumors = new Map(); // townId -> [{ text, tags, accuracy, generatedAt }]
var RUMORS_PER_TOWN = 5;

function _fillTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, function(match, key) {
    if (vars[key] !== undefined) return vars[key];
    // Auto-fill with random values from arrays
    switch(key) {
      case 'adjective': return ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
      case 'vague_cause': return VAGUE_CAUSES[Math.floor(Math.random() * VAGUE_CAUSES.length)];
      case 'direction': return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
      case 'rarity': return RARITIES[Math.floor(Math.random() * RARITIES.length)];
      case 'resource': return RESOURCES[Math.floor(Math.random() * RESOURCES.length)];
      case 'faction1': return (vars._faction1 = FACTION_NAMES[Math.floor(Math.random() * FACTION_NAMES.length)]);
      case 'faction2': {
        var _f1 = vars._faction1 || vars.faction1;
        var _pool = FACTION_NAMES.filter(function(f) { return f !== _f1; });
        return _pool.length > 0 ? _pool[Math.floor(Math.random() * _pool.length)] : FACTION_NAMES[0];
      }
      case 'race': return RACE_NAMES[Math.floor(Math.random() * RACE_NAMES.length)];
      case 'town': return TOWN_DISPLAY_NAMES[Math.floor(Math.random() * TOWN_DISPLAY_NAMES.length)];
      case 'biome': return BIOME_NAMES[Math.floor(Math.random() * BIOME_NAMES.length)];
      case 'floor': return String(Math.floor(Math.random() * 20) + 1);
      case 'guild': return 'The ' + ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)] + ' Company';
      case 'name': return 'someone';
      default: return match;
    }
  });
}

function _pickRumors(townId, worldState) {
  var templates = RUMOR_TEMPLATES.slice();
  // Shuffle
  for (var i = templates.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = templates[i]; templates[i] = templates[j]; templates[j] = tmp;
  }
  // Accuracy degrades by 5-20% as rumors "travel" (random)
  var picked = [];
  for (var k = 0; k < Math.min(RUMORS_PER_TOWN, templates.length); k++) {
    var t = templates[k];
    var accuracy = Math.max(20, t.accuracy - Math.floor(Math.random() * 20));
    picked.push({
      text: _fillTemplate(t.text, {}),
      tags: t.tags,
      accuracy: accuracy,
      generatedAt: Date.now(),
    });
  }
  return picked;
}

function generateTownRumors(townId, worldState) {
  var rumors = _pickRumors(townId, worldState || {});
  townRumors.set(townId, rumors);
  return rumors;
}

function getTownRumors(townId) {
  return townRumors.get(townId) || [];
}

function refreshAllTownRumors(worldState) {
  TOWN_IDS.forEach(function(t) { generateTownRumors(t, worldState); });
}

/**
 * Add a dynamic world-event-driven rumor to a specific town's rumor pool.
 * Called by directors (vampire, werewolf, etc.) when events occur.
 * @param {string} zoneId - The zone/town ID
 * @param {Object} rumorObj - { text, type, severity }
 */
function addWorldEventRumor(zoneId, rumorObj) {
  if (!zoneId || !rumorObj || !rumorObj.text) return;

  var pool = townRumors.get(zoneId);
  if (!pool) pool = [];

  var rumor = {
    text: rumorObj.text,
    type: rumorObj.type || 'world_event',
    severity: rumorObj.severity || 'low',
    addedAt: Date.now(),
    isWorldEvent: true,
  };

  // Prepend event rumors (they appear first)
  pool.unshift(rumor);

  // Cap: keep at most RUMORS_PER_TOWN + 3 world event rumors
  var MAX_POOL = RUMORS_PER_TOWN + 3;
  if (pool.length > MAX_POOL) {
    pool = pool.slice(0, MAX_POOL);
  }

  townRumors.set(zoneId, pool);
}

module.exports = { generateTownRumors, getTownRumors, refreshAllTownRumors, addWorldEventRumor, RUMOR_TEMPLATES };
