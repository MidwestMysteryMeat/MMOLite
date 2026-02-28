// state.js
// In-memory ephemeral state manager for MMOLite.
// ALL runtime data lives here. Accounts persist via accounts.js.

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const worldgen = require('./worldgen');
const rpgData = require('./rpg-data');
const stateSync = require('./state-sync');

// ---------------------------------------------------------------------------
// Chunk cache LRU settings
// ---------------------------------------------------------------------------
var CHUNK_CACHE_MAX = 1200;       // max chunks in memory per zone
var CHUNK_CACHE_EVICT_TO = 1000;  // evict down to this count

// ---------------------------------------------------------------------------
// Primary data stores
// ---------------------------------------------------------------------------

/** @type {Map<string, {id: string, name: string, color: string, tag: string, avatar: string|null, joinedAt: number}>} */
const users = new Map();

/** @type {Map<string, object>} zoneId -> zone definition */
const zones = new Map();

/** @type {Map<string, object>} instanceId -> dungeon/arena instance */
const instances = new Map();

/** @type {Map<string, string>} socketId -> zoneId */
const playerZones = new Map();

/** @type {Map<string, {x: number, y: number, facing: string}>} socketId -> position */
const playerPositions = new Map();

/** @type {Map<string, object>} partyId -> party data */
const parties = new Map();

/** @type {Map<string, string>} socketId -> partyId (reverse index for O(1) lookups) */
const playerPartyMap = new Map();

/** @type {Map<string, object>} guildId -> guild data */
const guilds = new Map();

/** @type {Map<string, Array>} zoneId -> array of overworld monster objects */
const zoneMonsters = new Map();

/** @type {Map<string, object>} battleId -> battle object (legacy PvP stubs) */
const activeBattles = new Map();

function endBattle(battleId) {
  activeBattles.delete(battleId);
}

/** @type {Map<string, {weather: string, updatedAt: number}>} biomeId -> weather state */
const biomeWeather = new Map();

function getBiomeWeather(biomeId) {
  var entry = biomeWeather.get(biomeId);
  return entry ? entry.weather : 'clear';
}

function setBiomeWeather(biomeId, weather) {
  biomeWeather.set(biomeId, { weather: weather, updatedAt: Date.now() });
}

// World state
const world = {
  timeOfDay: 'day',          // day, dusk, night, dawn
  weather: 'clear',          // clear, rain, storm, fog, snow
  dayStartedAt: Date.now(),
  dayLengthMs: 80 * 60 * 1000, // 80 real minutes = 1 game day
  activeEvents: [],
  // AI Event Director state
  directorState: {
    globalTensionScore: 0,
    narrativeDay: 0,
    activeWorldEvents: [],
  },
  // Doom ascension tracking
  doomAscensionCount: 0,
  doomCountdown: null,  // persisted by director-lich via getState/loadState
  // Seasonal calendar
  calendar: {
    year: 500,
    month: 1,        // 1-12
    day: 1,          // 1-28
    season: 'Frosthollow',
    monthName: 'Deepmere',
    lastAdvancedAt: Date.now(),
    advanceIntervalMs: 24 * 60 * 60 * 1000,  // advance 1 day every real 24h
  },
};

// ---------------------------------------------------------------------------
// Calendar month definitions
// ---------------------------------------------------------------------------
var CALENDAR_MONTHS = [
  { name: 'Deepmere',    season: 'Frosthollow' },
  { name: 'Ironveil',    season: 'Frosthollow' },
  { name: 'Thawmist',    season: 'Frosthollow' },
  { name: 'Greenward',   season: 'Brightbloom' },
  { name: 'Starbloom',   season: 'Brightbloom' },
  { name: 'Solaren',     season: 'Brightbloom' },
  { name: 'Highsun',     season: 'Sunreign'    },
  { name: 'Forgefire',   season: 'Sunreign'    },
  { name: 'Harvestmere', season: 'Sunreign'    },
  { name: 'Glassfall',   season: 'Ashwane'     },
  { name: 'Shadowmere',  season: 'Ashwane'     },
  { name: 'Voidwatch',   season: 'Ashwane'     },
];

function advanceCalendar() {
  var cal = world.calendar;
  var now = Date.now();
  if (now - cal.lastAdvancedAt < cal.advanceIntervalMs) return false;
  cal.lastAdvancedAt = now;
  cal.day++;
  if (cal.day > 28) {
    cal.day = 1;
    cal.month++;
    if (cal.month > 12) {
      cal.month = 1;
      cal.year++;
    }
    var monthDef = CALENDAR_MONTHS[cal.month - 1];
    cal.monthName = monthDef.name;
    cal.season = monthDef.season;
  }
  return true;
}

function getCalendar() {
  return {
    year: world.calendar.year,
    month: world.calendar.month,
    day: world.calendar.day,
    season: world.calendar.season,
    monthName: world.calendar.monthName,
  };
}

function isNpcAsleep(npc, currentPhase) {
  if (!npc || !npc.sleepPhases || npc.sleepPhases.length === 0) return false;
  return npc.sleepPhases.indexOf(currentPhase) !== -1;
}

function getTimeOfDay() {
  return world.timeOfDay;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ZONE_CHAT_MESSAGES = 50;
const MAX_PLAYERS_PER_ZONE = 200;
const ZONE_ID_LENGTH = 6;

// Character names for random anonymous names
const CHARACTER_NAMES = [
  'Knight', 'Warrior', 'Viking', 'Jarl', 'Samurai', 'Ronin', 'Archer',
  'Barbarian', 'Templar', 'Alchemist', 'Rogue', 'Priest', 'Lord',
  'Captain', 'Scout', 'Shinobi', 'Sage', 'Pharaoh', 'Chief',
  'Princess', 'Queen', 'Amazon', 'Witch', 'Shaman', 'Maiden',
  'Elf Ranger', 'Elf Lord', 'Elf Scout', 'Elf Sage', 'Elf Mage',
  'Elf Hunter', 'Elf Guardian', 'Gnome Tinkerer', 'Gnome Sage',
  'Phoenix', 'Dragon', 'Griffin', 'Werewolf', 'Specter',
  'Golem', 'Spirit', 'Wraith', 'Stalker', 'Lurker'
];

const COLOR_PREFIXES = [
  'Red', 'Blue', 'Green', 'Gold', 'Silver', 'Shadow', 'Crimson',
  'Azure', 'Emerald', 'Violet', 'Ivory', 'Obsidian', 'Amber',
  'Scarlet', 'Cobalt', 'Jade', 'Frost', 'Iron', 'Ashen', 'Coral'
];

const BRIGHT_COLORS = [
  '#E74C3C', '#E91E63', '#9B59B6', '#8E44AD', '#3498DB',
  '#2196F3', '#1ABC9C', '#00BCD4', '#2ECC71', '#4CAF50',
  '#8BC34A', '#CDDC39', '#F1C40F', '#FFC107', '#FF9800',
  '#FF5722', '#E67E22', '#FD79A8', '#6C5CE7', '#00CEC9',
];

const ALPHANUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const WEATHER_TYPES = ['clear', 'rain', 'storm', 'fog', 'snow'];
const TIME_PHASES = ['dawn', 'day', 'dusk', 'night'];

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  var cleaned = str.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  cleaned = cleaned.replace(/[^a-zA-Z0-9 _\-!?,.'":;\n@#&()\/<>+=$/\\]/g, '');
  return cleaned.trim();
}

function sanitizeName(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
}

// ---------------------------------------------------------------------------
// Helper generators
// ---------------------------------------------------------------------------

function randomAlphanum(length) {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += ALPHANUM[bytes[i] % ALPHANUM.length];
  }
  return result;
}

function generateAnonName() {
  var color = COLOR_PREFIXES[Math.floor(Math.random() * COLOR_PREFIXES.length)];
  var character = CHARACTER_NAMES[Math.floor(Math.random() * CHARACTER_NAMES.length)];
  var number = Math.floor(Math.random() * 99) + 1;
  var name = color + ' ' + character + ' ' + number;
  return name.slice(0, 20);
}

function generateId() {
  return uuidv4();
}

function getRandomColor() {
  return BRIGHT_COLORS[Math.floor(Math.random() * BRIGHT_COLORS.length)];
}

function generateTag(source) {
  if (!source || typeof source !== 'string') return '0000';
  var hmac = crypto.createHmac('sha256', process.env.TAG_HMAC_SECRET || 'mmolite-tag-v1').update(source).digest();
  var tag = '';
  for (var i = 0; i < 4; i++) {
    tag += ALPHANUM[hmac[i] % ALPHANUM.length];
  }
  return tag;
}

// ---------------------------------------------------------------------------
// User operations (connected players)
// ---------------------------------------------------------------------------

function createUser(socketId, customName, username) {
  const name = (typeof customName === 'string' && sanitizeName(customName).length > 0)
    ? sanitizeName(customName).slice(0, 20)
    : generateAnonName();

  const user = {
    id: socketId,
    name: name,
    username: username || name,
    color: getRandomColor(),
    tag: generateTag(socketId),
    avatar: null,
    joinedAt: Date.now(),
  };
  users.set(socketId, user);
  stateSync.publishUserAdd(socketId, user);
  return user;
}

function removeUser(socketId) {
  const user = users.get(socketId);
  if (!user) return null;

  // Leave current zone
  leaveZone(socketId);

  // Clean up position
  playerPositions.delete(socketId);

  // Remove from any party (O(1) via reverse index)
  var partyId = playerPartyMap.get(socketId);
  if (partyId) {
    var party = parties.get(partyId);
    if (party) {
      party.members.delete(socketId);
      if (party.leader === socketId) {
        if (party.members.size > 0) {
          party.leader = party.members.values().next().value;
        } else {
          parties.delete(partyId);
        }
      }
    }
    playerPartyMap.delete(socketId);
  }

  users.delete(socketId);
  stateSync.publishUserRemove(socketId);
  return user;
}

// ---------------------------------------------------------------------------
// Zone operations
// ---------------------------------------------------------------------------

function createZone(zoneId, config) {
  // Initialize resources with runtime depletedUntil field
  const resources = (config.resources || []).map(function(r) {
    return Object.assign({}, r, { depletedUntil: 0 });
  });

  const zone = {
    id: zoneId,
    name: config.name || zoneId,
    type: config.type || 'overworld',   // town, overworld, building, dungeon
    width: config.width || 1600,
    height: config.height || 1200,
    npcs: config.npcs || [],
    spawns: config.spawns || [],        // wild monster spawn table
    connections: config.connections || [], // { targetZone, x, y, direction }
    gamecorner: !!config.gamecorner,    // if true, mini-games accessible here
    pvpEnabled: !!config.pvpEnabled,
    hidden: !!config.hidden,
    chatMessages: [],                   // zone-local chat (ephemeral)
    members: new Set(),                 // socketIds currently in zone
    items: config.items || [],          // overworld pickups
    resources: resources,               // harvestable resource nodes
    placedObjects: config.placedObjects || [],
    plots: config.plots || [],
    protectedArea: config.protectedArea || null,
    terrain: config.terrain || null,    // { water: ['west','east','south'], mountain: ['north'] }
    ownerKey: config.ownerKey || null,  // for plot zones
    plotId: config.plotId || null,      // for plot zones
    createdAt: Date.now(),
  };
  zones.set(zoneId, zone);
  return zone;
}

function joinZone(socketId, zoneId, x, y) {
  const zone = zones.get(zoneId);
  if (!zone) return null;
  if (zone.members.size >= MAX_PLAYERS_PER_ZONE) return null;

  // Leave previous zone first
  leaveZone(socketId);

  zone.members.add(socketId);
  playerZones.set(socketId, zoneId);
  playerPositions.set(socketId, {
    x: x || 0,
    y: y || 0,
    facing: 'down',
  });

  stateSync.publishZoneJoin(socketId, zoneId, x || 0, y || 0);
  return zone;
}

function leaveZone(socketId) {
  const currentZoneId = playerZones.get(socketId);
  if (!currentZoneId) return false;

  const zone = zones.get(currentZoneId);
  if (zone) {
    zone.members.delete(socketId);
  }

  playerZones.delete(socketId);
  playerPositions.delete(socketId);
  stateSync.publishZoneLeave(socketId, currentZoneId);
  return true;
}

function updatePlayerPosition(socketId, x, y, facing) {
  const pos = playerPositions.get(socketId);
  if (!pos) return false;

  const zoneId = playerZones.get(socketId);
  if (!zoneId) return false;

  const zone = zones.get(zoneId);
  if (!zone) return false;

  // Clamp to zone bounds
  pos.x = Math.max(0, Math.min(zone.width, x));
  pos.y = Math.max(0, Math.min(zone.height, y));
  if (facing && ['up', 'down', 'left', 'right'].includes(facing)) {
    pos.facing = facing;
  }
  stateSync.publishPosition(socketId, pos.x, pos.y, pos.facing);
  return true;
}

function getPlayersInZone(zoneId) {
  const zone = zones.get(zoneId);
  if (!zone) return [];

  const result = [];
  for (const socketId of zone.members) {
    const user = users.get(socketId);
    const pos = playerPositions.get(socketId);
    if (user && pos) {
      result.push({
        id: user.id,
        name: user.name,
        username: user.username,
        color: user.color,
        tag: user.tag,
        avatar: user.avatar,
        x: pos.x,
        y: pos.y,
        facing: pos.facing,
      });
    }
  }
  return result;
}

function addZoneChatMessage(zoneId, socketId, content) {
  const zone = zones.get(zoneId);
  if (!zone) return null;

  const user = users.get(socketId);
  if (!user) return null;

  const message = {
    id: generateId(),
    authorId: socketId,
    authorName: user.name,
    authorColor: user.color,
    authorTag: user.tag,
    content: sanitizeText(content).slice(0, 200),
    timestamp: Date.now(),
  };

  zone.chatMessages.push(message);
  if (zone.chatMessages.length > MAX_ZONE_CHAT_MESSAGES) {
    zone.chatMessages.shift();
  }

  return message;
}

function getOrCreateDungeonZone(zoneId, displayName) {
  if (!zones.has(zoneId)) {
    createZone(zoneId, {
      name: displayName || zoneId,
      type: 'dungeon',
      width: 2048,
      height: 2048,
      hidden: true,
      pvpEnabled: false,
    });
  }
  return zones.get(zoneId);
}

/**
 * Get or create a plot interior zone. Works like towns — players can enter
 * via an overworld connection. Only the owner can build inside.
 */
function getOrCreatePlotZone(plotId, ownerKey, ownerName) {
  var zoneId = 'plot_' + plotId;
  if (!zones.has(zoneId)) {
    // Load persisted placements for this plot interior
    var placementModule = require('./handlers/placement');
    var placedObjects = placementModule.loadPlacements(zoneId);

    createZone(zoneId, {
      name: (ownerName || 'Unknown') + "'s Home",
      type: 'plot',
      width: 4096,
      height: 4096,
      hidden: true,
      pvpEnabled: false,
      placedObjects: placedObjects,
      ownerKey: ownerKey,
      plotId: plotId,
      connections: [
        { targetZone: 'overworld', x: 2048, y: 4060, direction: 'south' },
      ],
    });
  }
  return zones.get(zoneId);
}

function getZoneState(zoneId) {
  const zone = zones.get(zoneId);
  if (!zone) return null;

  // For overworld, don't send all resources (they're loaded per-chunk)
  var resources = [];
  if (!zone.chunkCache) {
    // Non-overworld zones: send all resources
    const now = Date.now();
    resources = (zone.resources || []).map(function(r) {
      return {
        id: r.id, type: r.type, name: r.name,
        x: r.x, y: r.y,
        skill: r.skill, minLevel: r.minLevel,
        depleted: r.depletedUntil > now,
        depletedUntil: r.depletedUntil,
      };
    });
  }

  var result = {
    id: zone.id,
    name: zone.name,
    type: zone.type,
    width: zone.width,
    height: zone.height,
    npcs: zone.npcs,
    connections: zone.connections,
    gamecorner: zone.gamecorner,
    pvpEnabled: zone.pvpEnabled,
    items: zone.items,
    resources: resources,
    placedObjects: (zone.placedObjects || []).map(function(obj) {
      var safe = { id: obj.id, type: obj.type, x: obj.x, y: obj.y, rotation: obj.rotation || 0 };
      if (obj.type === 'door') safe.open = !!obj.open;
      if (obj.lockId) safe.lockId = true; // boolean only, not the actual lock ID
      return safe;
    }),
    protectedArea: zone.protectedArea || null,
    terrain: zone.terrain || null,
    players: getPlayersInZone(zoneId),
    chatMessages: zone.chatMessages.slice(-20),
    playerCount: zone.members.size,
    // RPG data moved to identity payload (sent once on connect, not per zone_state)
  };

  // For chunk-based zones (overworld or hollow earth)
  if (zone.chunkCache) {
    result.chunkBased = true;
    result.chunkSize = worldgen.CHUNK_SIZE;
    result.worldScale = worldgen.WORLD_SCALE;
    result.gameDaySeconds = worldgen.GAME_DAY_SECONDS;
    result.overworldWalkSpeed = worldgen.OVERWORLD_WALK_SPEED;
    result.mountSpeeds = worldgen.MOUNT_SPEEDS;
    result.featureColors = worldgen.FEATURE_COLORS;
    result.featureSpeeds = worldgen.FEATURE_SPEED;

    if (zone.isHollowEarth) {
      result.isHollowEarth = true;
      result.biomeColors = worldgen.HE_BIOME_COLORS;
      result.biomeNames = worldgen.HE_BIOME_NAMES;
      result.biomeSpeeds = worldgen.HE_BIOME_SPEED;
    } else {
      result.biomeColors = worldgen.BIOME_COLORS;
      result.biomeNames = worldgen.BIOME_NAMES;
      result.biomeSpeeds = worldgen.BIOME_SPEED;
      result.rivers = worldgen.RIVERS;
      result.hasPlots = !!(zone.plots && zone.plots.length > 0);
    }
  }

  return result;
}

/**
 * Get or generate a chunk for chunk-based zones (overworld or hollow earth).
 * Lazy generates and caches chunk data.
 */
function getOrGenerateChunk(zoneId, cx, cy) {
  var zone = zones.get(zoneId);
  if (!zone || !zone.chunkCache) return null;

  var key = cx + ',' + cy;
  if (zone.chunkCache.has(key)) {
    // LRU touch: delete and re-insert to move to end of Map iteration order
    var cached = zone.chunkCache.get(key);
    zone.chunkCache.delete(key);
    zone.chunkCache.set(key, cached);
    return cached;
  }

  // Generate chunk — use correct generator based on zone type
  var seed = zone.worldSeed || 'mmolite_world_v1';
  var chunk;
  if (zone.isHollowEarth) {
    chunk = worldgen.generateHollowEarthChunk(cx, cy, seed);
  } else {
    chunk = worldgen.generateChunk(cx, cy, seed);
  }
  zone.chunkCache.set(key, chunk);

  // LRU eviction: if cache exceeds max, remove oldest entries
  if (zone.chunkCache.size > CHUNK_CACHE_MAX) {
    var iter = zone.chunkCache.keys();
    while (zone.chunkCache.size > CHUNK_CACHE_EVICT_TO) {
      var oldest = iter.next().value;
      if (oldest) {
        // Also remove associated resources from resourceMap
        var oldChunk = zone.chunkCache.get(oldest);
        if (oldChunk && oldChunk.resources) {
          for (var ri = 0; ri < oldChunk.resources.length; ri++) {
            zone.resourceMap.delete(oldChunk.resources[ri].id);
          }
        }
        zone.chunkCache.delete(oldest);
      } else break;
    }
  }

  // Add resources to zone's resource map for fast harvest lookup
  for (var i = 0; i < chunk.resources.length; i++) {
    var r = chunk.resources[i];
    r.depletedUntil = 0;  // runtime field
    zone.resourceMap.set(r.id, r);
  }

  // Attach any plots that overlap this chunk and mark resources inside plots
  if (zone.plots && zone.plots.length > 0) {
    var chunkPx = cx * worldgen.CHUNK_SIZE;
    var chunkPy = cy * worldgen.CHUNK_SIZE;
    var cPlots = [];
    for (var pi = 0; pi < zone.plots.length; pi++) {
      var plot = zone.plots[pi];
      if (plot.x < chunkPx + worldgen.CHUNK_SIZE && plot.x + plot.width > chunkPx &&
          plot.y < chunkPy + worldgen.CHUNK_SIZE && plot.y + plot.height > chunkPy) {
        cPlots.push(plot);
        // Mark resources inside this plot as non-respawning
        for (var ri = 0; ri < chunk.resources.length; ri++) {
          var res = chunk.resources[ri];
          if (res.x >= plot.x && res.x < plot.x + plot.width &&
              res.y >= plot.y && res.y < plot.y + plot.height) {
            res.noRespawn = true;
            res.plotOwned = true;
          }
        }
      }
    }
    if (cPlots.length > 0) chunk.plots = cPlots;
  }

  return chunk;
}

function getZoneList() {
  const result = [];
  for (const [, zone] of zones) {
    if (zone.hidden) continue;
    result.push({
      id: zone.id,
      name: zone.name,
      type: zone.type,
      playerCount: zone.members.size,
      gamecorner: zone.gamecorner,
      pvpEnabled: zone.pvpEnabled,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Instance operations (dungeons, battle arenas)
// ---------------------------------------------------------------------------

function createInstance(type, config) {
  const id = generateId();
  const instance = {
    id: id,
    type: type,         // 'dungeon', 'arena', 'raid'
    name: config.name || type,
    members: new Set(),
    state: config.initialState || {},
    createdAt: Date.now(),
    maxPlayers: config.maxPlayers || 4,
  };
  instances.set(id, instance);
  return instance;
}

function deleteInstance(instanceId) {
  instances.delete(instanceId);
}

// ---------------------------------------------------------------------------
// Party operations
// ---------------------------------------------------------------------------

function createParty(leaderSocketId) {
  const id = generateId();
  const party = {
    id: id,
    leader: leaderSocketId,
    members: new Set([leaderSocketId]),
    maxMembers: 4,
    createdAt: Date.now(),
  };
  parties.set(id, party);
  playerPartyMap.set(leaderSocketId, id);
  return party;
}

function getPlayerParty(socketId) {
  var partyId = playerPartyMap.get(socketId);
  if (partyId) {
    var party = parties.get(partyId);
    if (party && party.members.has(socketId)) return party;
    // Stale entry — clean up
    playerPartyMap.delete(socketId);
  }
  return null;
}

function removeParty(partyId) {
  var party = parties.get(partyId);
  if (!party) return;
  for (var memberId of party.members) {
    playerPartyMap.delete(memberId);
  }
  parties.delete(partyId);
}

// ---------------------------------------------------------------------------
// World time
// ---------------------------------------------------------------------------

function advanceWorldTime() {
  const elapsed = Date.now() - world.dayStartedAt;
  const cycleProgress = (elapsed % world.dayLengthMs) / world.dayLengthMs;

  if (cycleProgress < 0.05) {
    world.timeOfDay = 'dawn';
  } else if (cycleProgress < 0.45) {
    world.timeOfDay = 'day';
  } else if (cycleProgress < 0.55) {
    world.timeOfDay = 'dusk';
  } else {
    world.timeOfDay = 'night';
  }

  // Duration-based weather system
  if (typeof world.weatherDuration !== 'number') {
    world.weatherDuration = 3 + Math.floor(Math.random() * 6); // 3-8 periods
  }
  world.weatherDuration--;
  if (world.weatherDuration <= 0) {
    // Roll new weather with weighted probabilities
    var roll = Math.random();
    if (roll < 0.40)      world.weather = 'clear';
    else if (roll < 0.65) world.weather = 'rain';
    else if (roll < 0.80) world.weather = 'fog';
    else if (roll < 0.90) world.weather = 'storm';
    else                   world.weather = 'snow';
    world.weatherDuration = 3 + Math.floor(Math.random() * 6); // 3-8 periods
  }
}

// ---------------------------------------------------------------------------
// Default zones — created on startup
// ---------------------------------------------------------------------------

function initDefaultZones() {
  // Starter Town (The Holy Dominion) — safe town, protected from building
  createZone('starter_town', {
    name: 'The Holy Dominion',
    type: 'town',
    width: 1600,
    height: 1200,
    npcs: [
      { id: 'npc_card_merchant', name: 'Elara Brightscroll', x: 500, y: 350, type: 'card_shop', sleepPhases: ['night'], dialogue: 'Welcome, adventurer! I carry a fine selection of skill cards to help you on your journey.' },
      { id: 'npc_holy_dominion_innkeeper', name: 'Innkeeper Mira', x: 250, y: 900, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'wandering_merchant_starter_town', type: 'wandering_merchant', name: 'Peddler Vance', x: 700, y: 450, sleepPhases: ['night'], dialogue: 'wandering_merchant', stock: ['herbs', 'potions', 'misc'] },
      { id: 'farmer_starter_town', type: 'farmer', name: 'Farmer Aldric', x: 350, y: 550, sleepPhases: ['night'], dialogue: 'farmer' },
      { id: 'civilian_starter_town', type: 'civilian', name: 'Marta the Weaver', x: 600, y: 800, sleepPhases: ['night'], dialogue: 'civilian' },
    ],
    connections: [
      { targetZone: 'overworld', x: 800, y: 50, direction: 'north' },
      { targetZone: 'overworld', x: 50, y: 600, direction: 'west' },
      { targetZone: 'overworld', x: 1550, y: 600, direction: 'east' },
      { targetZone: 'overworld', x: 800, y: 1150, direction: 'south' },
      { targetZone: 'adventure_guild', x: 850, y: 400, direction: 'enter', label: 'Adventure Guild' },
      { targetZone: 'rift_antechamber', x: 1100, y: 350, direction: 'enter', label: 'The Rift' },
      { targetZone: 'tavern_holy_dominion', x: 250, y: 950, direction: 'enter', label: 'The Last Crown Tavern' },
      { targetZone: 'faction_hall_dominion', x: 1350, y: 950, direction: 'enter', label: 'Dominion Hall' },
    ],
    terrain: { water: [], mountain: [] },
    protectedArea: { x: 0, y: 0, width: 1600, height: 1200 },
    resources: [
      { id: 'tree1', type: 'tree', name: 'Tree', x: 650, y: 500, respawnMs: 0, skill: 'woodcutting', xp: 10, minLevel: 1 },
      { id: 'tree2', type: 'tree', name: 'Tree', x: 550, y: 650, respawnMs: 0, skill: 'woodcutting', xp: 10, minLevel: 1 },
      { id: 'tree3', type: 'tree', name: 'Tree', x: 400, y: 400, respawnMs: 0, skill: 'woodcutting', xp: 10, minLevel: 1 },
      { id: 'tree4', type: 'tree', name: 'Tree', x: 1100, y: 500, respawnMs: 0, skill: 'woodcutting', xp: 10, minLevel: 1 },
      { id: 'stone1', type: 'stone', name: 'Stone', x: 800, y: 600, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'stone2', type: 'stone', name: 'Stone', x: 900, y: 700, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'stone3', type: 'stone', name: 'Stone', x: 1200, y: 650, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'iron1', type: 'iron', name: 'Iron Ore', x: 1000, y: 550, respawnMs: 0, skill: 'mining', xp: 25, minLevel: 3 },
      { id: 'iron2', type: 'iron', name: 'Iron Ore', x: 350, y: 750, respawnMs: 0, skill: 'mining', xp: 25, minLevel: 3 },
    ],
  });
  console.log('[state] Created zone: The Holy Dominion (Starter Town)');

  // -------------------------------------------------------------------------
  // Anchor Towns — 9 racial/regional capitals spread across the world
  // Coordinate system: ref (X,Y) -> chunk (1000+X, 1250+Y) -> pixel (chunk*512)
  // -------------------------------------------------------------------------

  // 1. Solara — Holy Dominion Capital
  // Ref (40,38) -> chunk (1040,1288) -> pixel (532480, 659456)
  createZone('solara', {
    name: 'Solara',
    type: 'town',
    width: 2000,
    height: 1600,
    npcs: [
      { id: 'npc_solara_priest', name: 'High Priest Alarion', x: 1000, y: 400, type: 'questgiver', sleepPhases: ['night'] },
      { id: 'npc_solara_quartermaster', name: 'Imperial Quartermaster', x: 600, y: 700, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'npc_solara_inquisitor', name: 'Luminary Inquisitor', x: 1400, y: 700, type: 'guard', sleepPhases: [] },
      { id: 'portal_nexus_solara', name: 'Portal Nexus', x: 1000, y: 800, type: 'portal', sleepPhases: [] },
      { id: 'npc_solara_innkeeper', name: 'Innkeeper Balthus', x: 350, y: 1200, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'wandering_merchant_solara', type: 'wandering_merchant', name: 'Silk Road Trader', x: 800, y: 500, sleepPhases: ['night'], dialogue: 'wandering_merchant', stock: ['herbs', 'potions', 'misc'] },
      { id: 'farmer_solara', type: 'farmer', name: 'Grove Tender Ilya', x: 500, y: 1000, sleepPhases: ['night'], dialogue: 'farmer' },
      { id: 'civilian_solara', type: 'civilian', name: 'Scholar Orin', x: 1200, y: 1100, sleepPhases: ['night'], dialogue: 'civilian' },
    ],
    connections: [
      { targetZone: 'overworld', x: 1000, y: 50, direction: 'north' },
      { targetZone: 'overworld', x: 50, y: 800, direction: 'west' },
      { targetZone: 'overworld', x: 1950, y: 800, direction: 'east' },
      { targetZone: 'overworld', x: 1000, y: 1550, direction: 'south' },
      { targetZone: 'tavern_solara', x: 350, y: 1250, direction: 'enter', label: 'The Imperial Cup' },
    ],
    terrain: { water: [], mountain: [] },
    protectedArea: { x: 0, y: 0, width: 2000, height: 1600 },
    resources: [
      { id: 'solara_stone1', type: 'stone', name: 'Stone', x: 300, y: 500, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'solara_stone2', type: 'stone', name: 'Stone', x: 1700, y: 500, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'solara_stone3', type: 'stone', name: 'Stone', x: 500, y: 1100, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'solara_herbs1', type: 'herbs', name: 'Holy Garden Herbs', x: 800, y: 300, respawnMs: 0, skill: 'farming', xp: 20, minLevel: 1 },
      { id: 'solara_herbs2', type: 'herbs', name: 'Holy Garden Herbs', x: 1200, y: 300, respawnMs: 0, skill: 'farming', xp: 20, minLevel: 1 },
      { id: 'solara_herbs3', type: 'herbs', name: 'Holy Garden Herbs', x: 1000, y: 1200, respawnMs: 0, skill: 'farming', xp: 20, minLevel: 1 },
    ],
  });
  console.log('[state] Created zone: Solara (Holy Capital)');

  // 2. Sylvaris — Elven Administrative City
  // Ref (45,55) -> chunk (1045,1305) -> pixel (535040, 668160)
  createZone('sylvaris', {
    name: 'Sylvaris',
    type: 'town',
    width: 1800,
    height: 1400,
    npcs: [
      { id: 'npc_sylvaris_archivist', name: 'Archivist Elenwe', x: 900, y: 350, type: 'questgiver', sleepPhases: ['night'] },
      { id: 'npc_sylvaris_sealkeeper', name: 'Seal Keeper Thandril', x: 500, y: 700, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'npc_sylvaris_herbalist', name: 'Herbalist Mithwen', x: 1300, y: 700, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'portal_nexus_sylvaris', name: 'Portal Nexus', x: 900, y: 700, type: 'portal', sleepPhases: [] },
      { id: 'npc_sylvaris_innkeeper', name: 'Innkeeper Liriel', x: 300, y: 1050, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'wandering_merchant_sylvaris', type: 'wandering_merchant', name: 'Moon Market Vendor', x: 700, y: 500, sleepPhases: ['night'], dialogue: 'wandering_merchant', stock: ['herbs', 'potions', 'misc'] },
      { id: 'farmer_sylvaris', type: 'farmer', name: 'Treefarm Elder', x: 1100, y: 900, sleepPhases: ['night'], dialogue: 'farmer' },
      { id: 'civilian_sylvaris', type: 'civilian', name: 'Leaf-Keeper Aria', x: 500, y: 1000, sleepPhases: ['night'], dialogue: 'civilian' },
    ],
    connections: [
      { targetZone: 'overworld', x: 900, y: 50, direction: 'north' },
      { targetZone: 'overworld', x: 50, y: 700, direction: 'west' },
      { targetZone: 'overworld', x: 1750, y: 700, direction: 'east' },
      { targetZone: 'overworld', x: 900, y: 1350, direction: 'south' },
      { targetZone: 'tavern_sylvaris', x: 300, y: 1100, direction: 'enter', label: 'The Ancient Root' },
      { targetZone: 'faction_hall_rift_wardens', x: 1550, y: 400, direction: 'enter', label: 'Rift Wardens Lodge' },
    ],
    terrain: { water: [], mountain: [] },
    protectedArea: { x: 0, y: 0, width: 1800, height: 1400 },
    resources: [
      { id: 'sylvaris_herbs1', type: 'herbs', name: 'Elven Herbs', x: 400, y: 400, respawnMs: 0, skill: 'farming', xp: 20, minLevel: 1 },
      { id: 'sylvaris_herbs2', type: 'herbs', name: 'Elven Herbs', x: 1400, y: 400, respawnMs: 0, skill: 'farming', xp: 20, minLevel: 1 },
      { id: 'sylvaris_herbs3', type: 'herbs', name: 'Elven Herbs', x: 900, y: 1100, respawnMs: 0, skill: 'farming', xp: 20, minLevel: 1 },
      { id: 'sylvaris_mana1', type: 'mana_crystal', name: 'Mana Crystal Node', x: 700, y: 500, respawnMs: 0, skill: 'mining', xp: 30, minLevel: 5 },
      { id: 'sylvaris_mana2', type: 'mana_crystal', name: 'Mana Crystal Node', x: 1100, y: 500, respawnMs: 0, skill: 'mining', xp: 30, minLevel: 5 },
      { id: 'sylvaris_tree1', type: 'tree', name: 'Ancient Elm', x: 300, y: 600, respawnMs: 0, skill: 'woodcutting', xp: 15, minLevel: 1 },
      { id: 'sylvaris_tree2', type: 'tree', name: 'Ancient Elm', x: 1500, y: 600, respawnMs: 0, skill: 'woodcutting', xp: 15, minLevel: 1 },
      { id: 'sylvaris_tree3', type: 'tree', name: 'Ancient Elm', x: 900, y: 900, respawnMs: 0, skill: 'woodcutting', xp: 15, minLevel: 1 },
    ],
  });
  console.log('[state] Created zone: Sylvaris (Elven City)');

  // 3. Ironhold — Dwarven Mountain Stronghold
  // Ref (32,8) -> chunk (1032,1258) -> pixel (528384, 644096)
  createZone('ironhold', {
    name: 'Ironhold',
    type: 'town',
    width: 1600,
    height: 1400,
    npcs: [
      { id: 'npc_ironhold_forgemaster', name: 'Forgemaster Grundin', x: 800, y: 400, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'npc_ironhold_stonespeaker', name: 'Stone Speaker Thora', x: 400, y: 700, type: 'questgiver', sleepPhases: ['night'] },
      { id: 'npc_ironhold_tradewarden', name: 'Trade Warden Borik', x: 1200, y: 700, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'portal_nexus_ironhold', name: 'Portal Nexus', x: 800, y: 700, type: 'portal', sleepPhases: [] },
      { id: 'npc_ironhold_innkeeper', name: 'Innkeeper Burra', x: 250, y: 1050, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'wandering_merchant_ironhold', type: 'wandering_merchant', name: 'Deep Trader Brund', x: 600, y: 500, sleepPhases: ['night'], dialogue: 'wandering_merchant', stock: ['herbs', 'potions', 'misc'] },
      { id: 'farmer_ironhold', type: 'farmer', name: 'Mushroom Farmer Gert', x: 1000, y: 900, sleepPhases: ['night'], dialogue: 'farmer' },
      { id: 'civilian_ironhold', type: 'civilian', name: 'Stonewife Hilda', x: 500, y: 1000, sleepPhases: ['night'], dialogue: 'civilian' },
    ],
    connections: [
      { targetZone: 'overworld', x: 800, y: 50, direction: 'north' },
      { targetZone: 'overworld', x: 50, y: 700, direction: 'west' },
      { targetZone: 'overworld', x: 1550, y: 700, direction: 'east' },
      { targetZone: 'overworld', x: 800, y: 1350, direction: 'south' },
      { targetZone: 'tavern_ironhold', x: 250, y: 1100, direction: 'enter', label: 'The Stone and Flame' },
      { targetZone: 'faction_hall_iron_vanguard', x: 1350, y: 400, direction: 'enter', label: 'Iron Vanguard Barracks' },
    ],
    terrain: { water: [], mountain: ['north', 'east'] },
    protectedArea: { x: 0, y: 0, width: 1600, height: 1400 },
    resources: [
      { id: 'ironhold_stone1', type: 'stone', name: 'Granite Block', x: 300, y: 400, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'ironhold_stone2', type: 'stone', name: 'Granite Block', x: 1300, y: 400, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'ironhold_stone3', type: 'stone', name: 'Granite Block', x: 800, y: 1000, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'ironhold_iron1', type: 'iron', name: 'Iron Vein', x: 500, y: 500, respawnMs: 0, skill: 'mining', xp: 25, minLevel: 3 },
      { id: 'ironhold_iron2', type: 'iron', name: 'Iron Vein', x: 1100, y: 500, respawnMs: 0, skill: 'mining', xp: 25, minLevel: 3 },
      { id: 'ironhold_bronze1', type: 'bronze_ore', name: 'Bronze Deposit', x: 600, y: 800, respawnMs: 0, skill: 'mining', xp: 20, minLevel: 2 },
      { id: 'ironhold_bronze2', type: 'bronze_ore', name: 'Bronze Deposit', x: 1000, y: 800, respawnMs: 0, skill: 'mining', xp: 20, minLevel: 2 },
      { id: 'ironhold_gem1', type: 'gem_rough', name: 'Rough Gemstone', x: 800, y: 600, respawnMs: 0, skill: 'mining', xp: 35, minLevel: 8 },
    ],
  });
  console.log('[state] Created zone: Ironhold (Dwarven Stronghold)');

  // 4. Kragmor — Orcish Steppe Fortress
  // Ref (18,25) -> chunk (1018,1275) -> pixel (521216, 652800)
  createZone('kragmor', {
    name: 'Kragmor',
    type: 'town',
    width: 1600,
    height: 1200,
    npcs: [
      { id: 'npc_kragmor_warchief', name: 'Warchief Gorruk', x: 800, y: 350, type: 'questgiver', sleepPhases: ['night'] },
      { id: 'npc_kragmor_beastmaster', name: 'Beastmaster Yalka', x: 400, y: 600, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'npc_kragmor_lorekeeper', name: 'Lorekeeper Narsk', x: 1200, y: 600, type: 'questgiver', sleepPhases: ['night'] },
      { id: 'portal_nexus_kragmor', name: 'Portal Nexus', x: 800, y: 600, type: 'portal', sleepPhases: [] },
      { id: 'npc_kragmor_innkeeper', name: 'Mead-Keeper Bruka', x: 250, y: 900, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'wandering_merchant_kragmor', type: 'wandering_merchant', name: 'Warbazaar Vendor', x: 600, y: 450, sleepPhases: ['night'], dialogue: 'wandering_merchant', stock: ['herbs', 'potions', 'misc'] },
      { id: 'farmer_kragmor', type: 'farmer', name: 'Steppe Herder Grak', x: 1000, y: 800, sleepPhases: ['night'], dialogue: 'farmer' },
      { id: 'civilian_kragmor', type: 'civilian', name: 'Orcish Lookout Uth', x: 500, y: 750, sleepPhases: ['night'], dialogue: 'civilian' },
    ],
    connections: [
      { targetZone: 'overworld', x: 800, y: 50, direction: 'north' },
      { targetZone: 'overworld', x: 50, y: 600, direction: 'west' },
      { targetZone: 'overworld', x: 1550, y: 600, direction: 'east' },
      { targetZone: 'overworld', x: 800, y: 1150, direction: 'south' },
      { targetZone: 'tavern_kragmor', x: 250, y: 950, direction: 'enter', label: 'The Mead Hall' },
    ],
    terrain: { water: [], mountain: [] },
    protectedArea: { x: 0, y: 0, width: 1600, height: 1200 },
    resources: [
      { id: 'kragmor_tree1', type: 'tree', name: 'Steppe Oak', x: 350, y: 400, respawnMs: 0, skill: 'woodcutting', xp: 10, minLevel: 1 },
      { id: 'kragmor_tree2', type: 'tree', name: 'Steppe Oak', x: 1250, y: 400, respawnMs: 0, skill: 'woodcutting', xp: 10, minLevel: 1 },
      { id: 'kragmor_tree3', type: 'tree', name: 'Steppe Oak', x: 800, y: 900, respawnMs: 0, skill: 'woodcutting', xp: 10, minLevel: 1 },
      { id: 'kragmor_stone1', type: 'stone', name: 'Steppe Stone', x: 500, y: 500, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'kragmor_stone2', type: 'stone', name: 'Steppe Stone', x: 1100, y: 500, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'kragmor_herbs1', type: 'herbs', name: 'Steppe Herbs', x: 650, y: 700, respawnMs: 0, skill: 'farming', xp: 15, minLevel: 1 },
      { id: 'kragmor_herbs2', type: 'herbs', name: 'Steppe Herbs', x: 950, y: 700, respawnMs: 0, skill: 'farming', xp: 15, minLevel: 1 },
    ],
  });
  console.log('[state] Created zone: Kragmor (Orcish Fortress)');

  // 5. BoneTrap — Goblin Tribal Warren
  // Ref (10,38) -> chunk (1010,1288) -> pixel (517120, 659456)
  createZone('bonetrap', {
    name: 'BoneTrap',
    type: 'town',
    width: 1200,
    height: 1000,
    npcs: [
      { id: 'npc_bonetrap_boss', name: 'Boss Skrag', x: 600, y: 300, type: 'questgiver', sleepPhases: ['night'] },
      { id: 'npc_bonetrap_tinkerer', name: 'Tinkerer Grix', x: 300, y: 500, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'npc_bonetrap_shaman', name: 'Shaman Zeek', x: 900, y: 500, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'portal_nexus_bonetrap', name: 'Portal Nexus', x: 600, y: 500, type: 'portal', sleepPhases: [] },
      { id: 'npc_bonetrap_innkeeper', name: 'Innkeeper Skiv', x: 150, y: 750, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'wandering_merchant_bonetrap', type: 'wandering_merchant', name: 'Shadow Peddler', x: 450, y: 400, sleepPhases: ['night'], dialogue: 'wandering_merchant', stock: ['herbs', 'potions', 'misc'] },
      { id: 'farmer_bonetrap', type: 'farmer', name: 'Bog Farmer Skrix', x: 750, y: 700, sleepPhases: ['night'], dialogue: 'farmer' },
      { id: 'civilian_bonetrap', type: 'civilian', name: 'Sly Watcher Niv', x: 400, y: 850, sleepPhases: ['night'], dialogue: 'civilian' },
    ],
    connections: [
      { targetZone: 'overworld', x: 600, y: 50, direction: 'north' },
      { targetZone: 'overworld', x: 50, y: 500, direction: 'west' },
      { targetZone: 'overworld', x: 1150, y: 500, direction: 'east' },
      { targetZone: 'overworld', x: 600, y: 950, direction: 'south' },
      { targetZone: 'tavern_bonetrap', x: 150, y: 800, direction: 'enter', label: 'The Gnawed Bone' },
      { targetZone: 'faction_hall_veiled_hand', x: 1050, y: 800, direction: 'enter', label: 'The Veiled Hand Den' },
    ],
    terrain: { water: [], mountain: ['north'] },
    protectedArea: { x: 0, y: 0, width: 1200, height: 1000 },
    resources: [
      { id: 'bonetrap_cogs1', type: 'cogs', name: 'Scavenged Cogs', x: 300, y: 350, respawnMs: 0, skill: 'cogworking', xp: 15, minLevel: 1 },
      { id: 'bonetrap_cogs2', type: 'cogs', name: 'Scavenged Cogs', x: 900, y: 350, respawnMs: 0, skill: 'cogworking', xp: 15, minLevel: 1 },
      { id: 'bonetrap_springs1', type: 'springs', name: 'Scavenged Springs', x: 450, y: 600, respawnMs: 0, skill: 'cogworking', xp: 20, minLevel: 2 },
      { id: 'bonetrap_springs2', type: 'springs', name: 'Scavenged Springs', x: 750, y: 600, respawnMs: 0, skill: 'cogworking', xp: 20, minLevel: 2 },
      { id: 'bonetrap_mushroom1', type: 'mushroom', name: 'Cave Mushroom', x: 500, y: 800, respawnMs: 0, skill: 'farming', xp: 10, minLevel: 1 },
      { id: 'bonetrap_mushroom2', type: 'mushroom', name: 'Cave Mushroom', x: 700, y: 800, respawnMs: 0, skill: 'farming', xp: 10, minLevel: 1 },
    ],
  });
  console.log('[state] Created zone: BoneTrap (Goblin Warren)');

  // 6. Murkmire — Lizardfolk Swamp Citadel
  // Ref (15,52) -> chunk (1015,1302) -> pixel (519680, 666624)
  createZone('murkmire', {
    name: 'Murkmire',
    type: 'town',
    width: 1400,
    height: 1200,
    npcs: [
      { id: 'npc_murkmire_elder', name: 'Sect Elder Ssethik', x: 700, y: 350, type: 'questgiver', sleepPhases: ['night'] },
      { id: 'npc_murkmire_sage', name: 'River Sage Kaaliss', x: 400, y: 600, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'npc_murkmire_watcher', name: 'Silent Watcher', x: 1000, y: 600, type: 'guard', sleepPhases: [] },
      { id: 'portal_nexus_murkmire', name: 'Portal Nexus', x: 700, y: 600, type: 'portal', sleepPhases: [] },
      { id: 'npc_murkmire_innkeeper', name: 'Innkeeper Sssali', x: 250, y: 900, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'wandering_merchant_murkmire', type: 'wandering_merchant', name: 'Tidemarket Trader', x: 550, y: 450, sleepPhases: ['night'], dialogue: 'wandering_merchant', stock: ['herbs', 'potions', 'misc'] },
      { id: 'farmer_murkmire', type: 'farmer', name: 'Swamp Fisher Sseth', x: 850, y: 800, sleepPhases: ['night'], dialogue: 'farmer' },
      { id: 'civilian_murkmire', type: 'civilian', name: 'River-Watcher Kessa', x: 500, y: 1000, sleepPhases: ['night'], dialogue: 'civilian' },
    ],
    connections: [
      { targetZone: 'overworld', x: 700, y: 50, direction: 'north' },
      { targetZone: 'overworld', x: 50, y: 600, direction: 'west' },
      { targetZone: 'overworld', x: 1350, y: 600, direction: 'east' },
      { targetZone: 'overworld', x: 700, y: 1150, direction: 'south' },
      { targetZone: 'tavern_murkmire', x: 250, y: 950, direction: 'enter', label: 'The Sunken Log' },
    ],
    terrain: { water: ['west', 'south'], mountain: [] },
    protectedArea: { x: 0, y: 0, width: 1400, height: 1200 },
    resources: [
      { id: 'murkmire_fish1', type: 'fish', name: 'Swamp Fish Spot', x: 300, y: 400, respawnMs: 0, skill: 'fishing', xp: 15, minLevel: 1 },
      { id: 'murkmire_fish2', type: 'fish', name: 'Swamp Fish Spot', x: 1100, y: 400, respawnMs: 0, skill: 'fishing', xp: 15, minLevel: 1 },
      { id: 'murkmire_seaweed1', type: 'seaweed', name: 'Swamp Seaweed', x: 250, y: 700, respawnMs: 0, skill: 'fishing', xp: 10, minLevel: 1 },
      { id: 'murkmire_seaweed2', type: 'seaweed', name: 'Swamp Seaweed', x: 1050, y: 700, respawnMs: 0, skill: 'fishing', xp: 10, minLevel: 1 },
      { id: 'murkmire_herbs1', type: 'herbs', name: 'Marsh Herbs', x: 500, y: 500, respawnMs: 0, skill: 'farming', xp: 20, minLevel: 1 },
      { id: 'murkmire_herbs2', type: 'herbs', name: 'Marsh Herbs', x: 900, y: 500, respawnMs: 0, skill: 'farming', xp: 20, minLevel: 1 },
      { id: 'murkmire_mushroom1', type: 'mushroom', name: 'Bog Mushroom', x: 700, y: 900, respawnMs: 0, skill: 'farming', xp: 10, minLevel: 1 },
      { id: 'murkmire_mushroom2', type: 'mushroom', name: 'Bog Mushroom', x: 500, y: 900, respawnMs: 0, skill: 'farming', xp: 10, minLevel: 1 },
    ],
  });
  console.log('[state] Created zone: Murkmire (Lizardfolk Citadel)');

  // 7. Mechspire — Gnomish Industrial Capital
  // Ref (95,38) -> chunk (1095,1288) -> pixel (560640, 659456)
  createZone('mechspire', {
    name: 'Mechspire',
    type: 'town',
    width: 2000,
    height: 1600,
    npcs: [
      { id: 'npc_mechspire_engineer', name: 'Chief Engineer Sparkwhistle', x: 1000, y: 400, type: 'questgiver', sleepPhases: ['night'] },
      { id: 'npc_mechspire_automaton', name: 'Automaton Coordinator', x: 600, y: 700, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'npc_mechspire_dockmaster', name: 'Dock Master Fizzbolt', x: 1400, y: 700, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'portal_nexus_mechspire', name: 'Portal Nexus', x: 1000, y: 800, type: 'portal', sleepPhases: [] },
      { id: 'npc_mechspire_innkeeper', name: 'Innkeeper Cogsworth', x: 400, y: 1300, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'wandering_merchant_mechspire', type: 'wandering_merchant', name: 'Cog Merchant Wren', x: 800, y: 500, sleepPhases: ['night'], dialogue: 'wandering_merchant', stock: ['herbs', 'potions', 'misc'] },
      { id: 'farmer_mechspire', type: 'farmer', name: 'Gear Farm Operator', x: 1200, y: 1000, sleepPhases: ['night'], dialogue: 'farmer' },
      { id: 'civilian_mechspire', type: 'civilian', name: 'Apprentice Tinker', x: 600, y: 1100, sleepPhases: ['night'], dialogue: 'civilian' },
    ],
    connections: [
      { targetZone: 'overworld', x: 1000, y: 50, direction: 'north' },
      { targetZone: 'overworld', x: 50, y: 800, direction: 'west' },
      { targetZone: 'overworld', x: 1950, y: 800, direction: 'east' },
      { targetZone: 'overworld', x: 1000, y: 1550, direction: 'south' },
      { targetZone: 'tavern_mechspire', x: 400, y: 1350, direction: 'enter', label: 'The Gear and Spanner' },
    ],
    terrain: { water: [], mountain: [] },
    protectedArea: { x: 0, y: 0, width: 2000, height: 1600 },
    resources: [
      { id: 'mechspire_cogs1', type: 'cogs', name: 'Precision Cogs', x: 400, y: 500, respawnMs: 0, skill: 'cogworking', xp: 20, minLevel: 1 },
      { id: 'mechspire_cogs2', type: 'cogs', name: 'Precision Cogs', x: 1600, y: 500, respawnMs: 0, skill: 'cogworking', xp: 20, minLevel: 1 },
      { id: 'mechspire_gears1', type: 'gears', name: 'Brass Gears', x: 600, y: 600, respawnMs: 0, skill: 'cogworking', xp: 25, minLevel: 3 },
      { id: 'mechspire_gears2', type: 'gears', name: 'Brass Gears', x: 1400, y: 600, respawnMs: 0, skill: 'cogworking', xp: 25, minLevel: 3 },
      { id: 'mechspire_springs1', type: 'springs', name: 'Coiled Springs', x: 800, y: 700, respawnMs: 0, skill: 'cogworking', xp: 20, minLevel: 2 },
      { id: 'mechspire_springs2', type: 'springs', name: 'Coiled Springs', x: 1200, y: 700, respawnMs: 0, skill: 'cogworking', xp: 20, minLevel: 2 },
      { id: 'mechspire_glass_sand1', type: 'glass_sand', name: 'Silica Sand', x: 1000, y: 1200, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'mechspire_glass_sand2', type: 'glass_sand', name: 'Silica Sand', x: 800, y: 1200, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
    ],
  });
  console.log('[state] Created zone: Mechspire (Gnomish Capital)');

  // 8. Clockwork Harbor — Gnomish Port
  // Ref (92,50) -> chunk (1092,1300) -> pixel (559104, 665600)
  createZone('clockwork_harbor_town', {
    name: 'Clockwork Harbor',
    type: 'town',
    width: 1400,
    height: 1200,
    npcs: [
      { id: 'npc_clockharbor_master', name: 'Harbormaster Coppercoil', x: 700, y: 350, type: 'questgiver', sleepPhases: ['night'] },
      { id: 'npc_clockharbor_customs', name: 'Customs Officer', x: 400, y: 600, type: 'guard', sleepPhases: [] },
      { id: 'npc_clockharbor_mechanic', name: 'Ship Mechanic', x: 1000, y: 600, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'portal_nexus_clockwork_harbor', name: 'Portal Nexus', x: 700, y: 600, type: 'portal', sleepPhases: [] },
      { id: 'npc_clockharbor_innkeeper', name: 'Innkeeper Saltwick', x: 250, y: 900, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'wandering_merchant_clockwork_harbor_town', type: 'wandering_merchant', name: 'Harbor Trader', x: 550, y: 450, sleepPhases: ['night'], dialogue: 'wandering_merchant', stock: ['herbs', 'potions', 'misc'] },
      { id: 'farmer_clockwork_harbor_town', type: 'farmer', name: 'Dockside Fishwife', x: 850, y: 800, sleepPhases: ['night'], dialogue: 'farmer' },
      { id: 'civilian_clockwork_harbor_town', type: 'civilian', name: 'Sailor Fen', x: 500, y: 750, sleepPhases: ['night'], dialogue: 'civilian' },
    ],
    connections: [
      { targetZone: 'overworld', x: 700, y: 50, direction: 'north' },
      { targetZone: 'overworld', x: 50, y: 600, direction: 'west' },
      { targetZone: 'overworld', x: 1350, y: 600, direction: 'east' },
      { targetZone: 'overworld', x: 700, y: 1150, direction: 'south' },
      { targetZone: 'tavern_clockwork_harbor', x: 250, y: 950, direction: 'enter', label: 'The Salt Keel' },
      { targetZone: 'faction_hall_merchant_league', x: 1200, y: 400, direction: 'enter', label: 'Merchant League House' },
    ],
    terrain: { water: ['south', 'east'], mountain: [] },
    protectedArea: { x: 0, y: 0, width: 1400, height: 1200 },
    resources: [
      { id: 'clockharbor_cogs1', type: 'cogs', name: 'Harbor Cogs', x: 350, y: 400, respawnMs: 0, skill: 'cogworking', xp: 15, minLevel: 1 },
      { id: 'clockharbor_cogs2', type: 'cogs', name: 'Harbor Cogs', x: 1050, y: 400, respawnMs: 0, skill: 'cogworking', xp: 15, minLevel: 1 },
      { id: 'clockharbor_springs1', type: 'springs', name: 'Dock Springs', x: 500, y: 700, respawnMs: 0, skill: 'cogworking', xp: 20, minLevel: 2 },
      { id: 'clockharbor_springs2', type: 'springs', name: 'Dock Springs', x: 900, y: 700, respawnMs: 0, skill: 'cogworking', xp: 20, minLevel: 2 },
      { id: 'clockharbor_fish1', type: 'fish', name: 'Harbor Fish Spot', x: 700, y: 900, respawnMs: 0, skill: 'fishing', xp: 15, minLevel: 1 },
      { id: 'clockharbor_fish2', type: 'fish', name: 'Harbor Fish Spot', x: 400, y: 900, respawnMs: 0, skill: 'fishing', xp: 15, minLevel: 1 },
    ],
  });
  console.log('[state] Created zone: Clockwork Harbor (Gnomish Port)');

  // 9. Fortune's Rest — Catfolk Desert Oasis
  // Ref (35,-8) -> chunk (1035,1242) -> pixel (529920, 635904)
  createZone('fortunes_rest', {
    name: "Fortune's Rest",
    type: 'town',
    width: 1600,
    height: 1200,
    npcs: [
      { id: 'npc_fortunes_matriarch', name: 'Matriarch Whisperwind', x: 800, y: 350, type: 'questgiver', sleepPhases: ['night'] },
      { id: 'npc_fortunes_casino', name: 'Casino Master Lucky', x: 500, y: 600, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'npc_fortunes_harbor', name: 'Harbormaster Sandclaw', x: 1100, y: 600, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'portal_nexus_fortunes_rest', name: 'Portal Nexus', x: 800, y: 600, type: 'portal', sleepPhases: [] },
      { id: 'npc_fortunes_innkeeper', name: 'Innkeeper Dustpaw', x: 250, y: 900, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'wandering_merchant_fortunes_rest', type: 'wandering_merchant', name: 'Desert Caravan Trader', x: 650, y: 450, sleepPhases: ['night'], dialogue: 'wandering_merchant', stock: ['herbs', 'potions', 'misc'] },
      { id: 'farmer_fortunes_rest', type: 'farmer', name: 'Oasis Gardener', x: 1000, y: 800, sleepPhases: ['night'], dialogue: 'farmer' },
      { id: 'civilian_fortunes_rest', type: 'civilian', name: 'Fortune Seeker', x: 400, y: 750, sleepPhases: ['night'], dialogue: 'civilian' },
    ],
    connections: [
      { targetZone: 'overworld', x: 800, y: 50, direction: 'north' },
      { targetZone: 'overworld', x: 50, y: 600, direction: 'west' },
      { targetZone: 'overworld', x: 1550, y: 600, direction: 'east' },
      { targetZone: 'overworld', x: 800, y: 1150, direction: 'south' },
      { targetZone: 'tavern_fortunes_rest', x: 250, y: 950, direction: 'enter', label: 'The Oasis Den' },
    ],
    terrain: { water: [], mountain: [] },
    protectedArea: { x: 0, y: 0, width: 1600, height: 1200 },
    resources: [
      { id: 'fortunes_glass_sand1', type: 'glass_sand', name: 'Desert Sand', x: 350, y: 400, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'fortunes_glass_sand2', type: 'glass_sand', name: 'Desert Sand', x: 1250, y: 400, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'fortunes_glass_sand3', type: 'glass_sand', name: 'Desert Sand', x: 800, y: 900, respawnMs: 0, skill: 'mining', xp: 15, minLevel: 1 },
      { id: 'fortunes_gem1', type: 'gem_rough', name: 'Rough Oasis Gem', x: 600, y: 500, respawnMs: 0, skill: 'mining', xp: 35, minLevel: 8 },
      { id: 'fortunes_gem2', type: 'gem_rough', name: 'Rough Oasis Gem', x: 1000, y: 500, respawnMs: 0, skill: 'mining', xp: 35, minLevel: 8 },
      { id: 'fortunes_herbs1', type: 'herbs', name: 'Oasis Herbs', x: 700, y: 700, respawnMs: 0, skill: 'farming', xp: 20, minLevel: 1 },
      { id: 'fortunes_herbs2', type: 'herbs', name: 'Oasis Herbs', x: 900, y: 700, respawnMs: 0, skill: 'farming', xp: 20, minLevel: 1 },
    ],
  });
  console.log("[state] Created zone: Fortune's Rest (Catfolk Oasis)");

  // -------------------------------------------------------------------------
  // Rift Antechamber — small zone next to starter town with Rift entrance
  // -------------------------------------------------------------------------
  createZone('rift_antechamber', {
    name: 'The Rift',
    type: 'building',
    width: 800,
    height: 600,
    npcs: [
      { id: 'dungeon_entrance', name: 'The Rift Entrance', x: 400, y: 250, type: 'dungeon_entrance', sleepPhases: ['night'] },
    ],
    connections: [
      { targetZone: 'starter_town', x: 400, y: 580, direction: 'south', label: 'The Holy Dominion' },
    ],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 800, height: 600 },
  });
  console.log('[state] Created zone: Rift Antechamber');

  // -------------------------------------------------------------------------
  // Adventure Guild — building inside starter town with guild NPCs
  // -------------------------------------------------------------------------
  createZone('adventure_guild', {
    name: 'Adventure Guild',
    type: 'building',
    width: 600,
    height: 500,
    npcs: [
      { id: 'guild_master', name: 'Guildmaster Aldric', x: 300, y: 150, type: 'adventure_guild', sleepPhases: ['night'],
        dialogue: 'Welcome, adventurer! The Rift awaits those brave enough to descend. Sign up with the Adventure Guild to begin your journey.' },
      { id: 'quest_board', name: 'Quest Board', x: 450, y: 200, type: 'dungeon_quest_board', sleepPhases: ['night'] },
      { id: 'leaderboard_npc', name: 'Hall of Heroes', x: 150, y: 200, type: 'dungeon_leaderboard', sleepPhases: ['night'] },
    ],
    connections: [
      { targetZone: 'starter_town', x: 300, y: 480, direction: 'south', label: 'The Holy Dominion' },
    ],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 600, height: 500 },
  });
  console.log('[state] Created zone: Adventure Guild');

  // -------------------------------------------------------------------------
  // Town Taverns — one per anchor town, each with innkeeper + bard
  // -------------------------------------------------------------------------

  createZone('tavern_holy_dominion', {
    name: 'The Last Crown Tavern',
    type: 'building',
    width: 600,
    height: 450,
    npcs: [
      { id: 'npc_holy_dominion_tavern_keeper', name: 'Innkeeper Mira', x: 300, y: 150, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'npc_holy_dominion_bard', name: 'Wandering Bard', x: 500, y: 200, type: 'bard', sleepPhases: ['dawn', 'day'] },
      { id: 'npc_holy_dominion_patron', name: 'Old Soldier', x: 150, y: 300, type: 'gossip', sleepPhases: ['dawn'] },
    ],
    connections: [{ targetZone: 'starter_town', x: 300, y: 430, direction: 'south', label: 'The Holy Dominion' }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 600, height: 450 },
  });

  createZone('tavern_solara', {
    name: 'The Imperial Cup',
    type: 'building',
    width: 600,
    height: 450,
    npcs: [
      { id: 'npc_solara_tavern_keeper', name: 'Innkeeper Balthus', x: 300, y: 150, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'npc_solara_bard', name: 'Imperial Bard', x: 500, y: 200, type: 'bard', sleepPhases: ['dawn', 'day'] },
      { id: 'npc_solara_patron', name: 'Off-Duty Inquisitor', x: 150, y: 300, type: 'gossip', sleepPhases: ['dawn'] },
    ],
    connections: [{ targetZone: 'solara', x: 300, y: 430, direction: 'south', label: 'Solara' }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 600, height: 450 },
  });

  createZone('tavern_sylvaris', {
    name: 'The Ancient Root',
    type: 'building',
    width: 600,
    height: 450,
    npcs: [
      { id: 'npc_sylvaris_tavern_keeper', name: 'Innkeeper Liriel', x: 300, y: 150, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'npc_sylvaris_bard', name: 'Elven Songweaver', x: 500, y: 200, type: 'bard', sleepPhases: ['dawn', 'day'] },
      { id: 'npc_sylvaris_patron', name: 'Elven Scholar', x: 150, y: 300, type: 'gossip', sleepPhases: ['dawn'] },
    ],
    connections: [{ targetZone: 'sylvaris', x: 300, y: 430, direction: 'south', label: 'Sylvaris' }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 600, height: 450 },
  });

  createZone('tavern_ironhold', {
    name: 'The Stone and Flame',
    type: 'building',
    width: 600,
    height: 450,
    npcs: [
      { id: 'npc_ironhold_tavern_keeper', name: 'Innkeeper Burra', x: 300, y: 150, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'npc_ironhold_bard', name: 'Dwarven Skald', x: 500, y: 200, type: 'bard', sleepPhases: ['dawn', 'day'] },
      { id: 'npc_ironhold_patron', name: 'Retired Miner', x: 150, y: 300, type: 'gossip', sleepPhases: ['dawn'] },
    ],
    connections: [{ targetZone: 'ironhold', x: 300, y: 430, direction: 'south', label: 'Ironhold' }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 600, height: 450 },
  });

  createZone('tavern_kragmor', {
    name: 'The Mead Hall',
    type: 'building',
    width: 700,
    height: 500,
    npcs: [
      { id: 'npc_kragmor_tavern_keeper', name: 'Mead-Keeper Bruka', x: 350, y: 150, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'npc_kragmor_bard', name: 'Orcish War-Singer', x: 550, y: 200, type: 'bard', sleepPhases: ['dawn', 'day'] },
      { id: 'npc_kragmor_patron', name: 'Grizzled Warrior', x: 150, y: 350, type: 'gossip', sleepPhases: ['dawn'] },
    ],
    connections: [{ targetZone: 'kragmor', x: 350, y: 480, direction: 'south', label: 'Kragmor' }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 700, height: 500 },
  });

  createZone('tavern_bonetrap', {
    name: 'The Gnawed Bone',
    type: 'building',
    width: 500,
    height: 400,
    npcs: [
      { id: 'npc_bonetrap_tavern_keeper', name: 'Innkeeper Skiv', x: 250, y: 130, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'npc_bonetrap_bard', name: 'Goblin Howler', x: 400, y: 170, type: 'bard', sleepPhases: ['dawn', 'day'] },
      { id: 'npc_bonetrap_patron', name: 'Suspicious Goblin', x: 120, y: 280, type: 'gossip', sleepPhases: ['dawn'] },
    ],
    connections: [{ targetZone: 'bonetrap', x: 250, y: 380, direction: 'south', label: 'BoneTrap' }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 500, height: 400 },
  });

  createZone('tavern_murkmire', {
    name: 'The Sunken Log',
    type: 'building',
    width: 600,
    height: 450,
    npcs: [
      { id: 'npc_murkmire_tavern_keeper', name: 'Innkeeper Sssali', x: 300, y: 150, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'npc_murkmire_bard', name: 'Lizardfolk Chanter', x: 500, y: 200, type: 'bard', sleepPhases: ['dawn', 'day'] },
      { id: 'npc_murkmire_patron', name: 'River Scout', x: 150, y: 300, type: 'gossip', sleepPhases: ['dawn'] },
    ],
    connections: [{ targetZone: 'murkmire', x: 300, y: 430, direction: 'south', label: 'Murkmire' }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 600, height: 450 },
  });

  createZone('tavern_mechspire', {
    name: 'The Gear and Spanner',
    type: 'building',
    width: 600,
    height: 450,
    npcs: [
      { id: 'npc_mechspire_tavern_keeper', name: 'Innkeeper Cogsworth', x: 300, y: 150, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'npc_mechspire_bard', name: 'Gnomish Harmonist', x: 500, y: 200, type: 'bard', sleepPhases: ['dawn', 'day'] },
      { id: 'npc_mechspire_patron', name: 'Off-Duty Engineer', x: 150, y: 300, type: 'gossip', sleepPhases: ['dawn'] },
    ],
    connections: [{ targetZone: 'mechspire', x: 300, y: 430, direction: 'south', label: 'Mechspire' }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 600, height: 450 },
  });

  createZone('tavern_clockwork_harbor', {
    name: 'The Salt Keel',
    type: 'building',
    width: 600,
    height: 450,
    npcs: [
      { id: 'npc_clockharbor_tavern_keeper', name: 'Innkeeper Saltwick', x: 300, y: 150, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'npc_clockharbor_bard', name: 'Sea Shanty Singer', x: 500, y: 200, type: 'bard', sleepPhases: ['dawn', 'day'] },
      { id: 'npc_clockharbor_patron', name: 'Dockworker', x: 150, y: 300, type: 'gossip', sleepPhases: ['dawn'] },
    ],
    connections: [{ targetZone: 'clockwork_harbor_town', x: 300, y: 430, direction: 'south', label: 'Clockwork Harbor' }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 600, height: 450 },
  });

  createZone('tavern_fortunes_rest', {
    name: 'The Oasis Den',
    type: 'building',
    width: 600,
    height: 450,
    npcs: [
      { id: 'npc_fortunes_tavern_keeper', name: 'Innkeeper Dustpaw', x: 300, y: 150, type: 'innkeeper', sleepPhases: ['day'] },
      { id: 'npc_fortunes_bard', name: 'Catfolk Storyteller', x: 500, y: 200, type: 'bard', sleepPhases: ['dawn', 'day'] },
      { id: 'npc_fortunes_patron', name: 'Desert Wanderer', x: 150, y: 300, type: 'gossip', sleepPhases: ['dawn'] },
    ],
    connections: [{ targetZone: 'fortunes_rest', x: 300, y: 430, direction: 'south', label: "Fortune's Rest" }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 600, height: 450 },
  });

  // -------------------------------------------------------------------------
  // Faction Halls — 5 key faction buildings in their home towns
  // -------------------------------------------------------------------------

  createZone('faction_hall_dominion', {
    name: 'Dominion Hall',
    type: 'building',
    width: 700,
    height: 550,
    npcs: [
      { id: 'npc_faction_dominion_liaison', name: 'High Commander Aldren', x: 350, y: 150, type: 'faction_liaison_dominion', sleepPhases: ['night'] },
      { id: 'npc_faction_dominion_guard', name: 'Faith Guardian', x: 550, y: 250, type: 'guard', sleepPhases: [] },
      { id: 'npc_faction_dominion_cleric', name: 'War Cleric', x: 150, y: 250, type: 'questgiver', sleepPhases: ['night'] },
    ],
    connections: [{ targetZone: 'starter_town', x: 350, y: 530, direction: 'south', label: 'The Holy Dominion' }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 700, height: 550 },
  });
  console.log('[state] Created zone: Dominion Hall');

  createZone('faction_hall_veiled_hand', {
    name: 'The Veiled Hand Den',
    type: 'building',
    width: 500,
    height: 400,
    npcs: [
      { id: 'npc_faction_veiled_hand_liaison', name: 'Shadow Broker', x: 250, y: 150, type: 'faction_liaison_veiled_hand', sleepPhases: ['night'] },
      { id: 'npc_faction_veiled_fence', name: 'The Fence', x: 400, y: 250, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'npc_faction_veiled_watcher', name: 'Hooded Watcher', x: 100, y: 250, type: 'guard', sleepPhases: [] },
    ],
    connections: [{ targetZone: 'bonetrap', x: 250, y: 380, direction: 'south', label: 'BoneTrap' }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 500, height: 400 },
  });
  console.log('[state] Created zone: Veiled Hand Den');

  createZone('faction_hall_rift_wardens', {
    name: 'Rift Wardens Lodge',
    type: 'building',
    width: 650,
    height: 500,
    npcs: [
      { id: 'npc_faction_rift_wardens_liaison', name: 'Warden Captain Thessaly', x: 325, y: 150, type: 'faction_liaison_rift_wardens', sleepPhases: ['night'] },
      { id: 'npc_faction_rift_wardens_scholar', name: 'Rift Scholar Aewyn', x: 500, y: 250, type: 'questgiver', sleepPhases: ['night'] },
      { id: 'npc_faction_rift_wardens_guard', name: 'Lodge Sentinel', x: 150, y: 250, type: 'guard', sleepPhases: [] },
    ],
    connections: [{ targetZone: 'sylvaris', x: 325, y: 480, direction: 'south', label: 'Sylvaris' }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 650, height: 500 },
  });
  console.log('[state] Created zone: Rift Wardens Lodge');

  createZone('faction_hall_merchant_league', {
    name: 'Merchant League Counting House',
    type: 'building',
    width: 650,
    height: 500,
    npcs: [
      { id: 'npc_faction_merchant_league_liaison', name: 'League Factor Caldris', x: 325, y: 150, type: 'faction_liaison_merchant_league', sleepPhases: ['night'] },
      { id: 'npc_faction_merchant_clerk', name: 'Trade Clerk', x: 500, y: 250, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'npc_faction_merchant_guard', name: 'League Guard', x: 150, y: 250, type: 'guard', sleepPhases: [] },
    ],
    connections: [{ targetZone: 'clockwork_harbor_town', x: 325, y: 480, direction: 'south', label: 'Clockwork Harbor' }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 650, height: 500 },
  });
  console.log('[state] Created zone: Merchant League Counting House');

  createZone('faction_hall_iron_vanguard', {
    name: 'Iron Vanguard Barracks',
    type: 'building',
    width: 700,
    height: 550,
    npcs: [
      { id: 'npc_faction_iron_vanguard_liaison', name: 'Vanguard Commander Thrak', x: 350, y: 150, type: 'faction_liaison_iron_vanguard', sleepPhases: ['night'] },
      { id: 'npc_faction_iron_arms_master', name: 'Arms Master Borin', x: 550, y: 250, type: 'shopkeeper', sleepPhases: ['night'] },
      { id: 'npc_faction_iron_sentry', name: 'Barracks Sentry', x: 150, y: 250, type: 'guard', sleepPhases: [] },
    ],
    connections: [{ targetZone: 'ironhold', x: 350, y: 530, direction: 'south', label: 'Ironhold' }],
    hidden: true,
    protectedArea: { x: 0, y: 0, width: 700, height: 550 },
  });
  console.log('[state] Created zone: Iron Vanguard Barracks');

  // -------------------------------------------------------------------------
  // Abandoned Crypt — populated dynamically by vampire director
  // -------------------------------------------------------------------------
  zones.set('abandoned_crypt_template', {
    id: 'abandoned_crypt_template',
    type: 'dungeon',
    name: 'Abandoned Crypt',
    theme: 'vampire_castle',
    width: 400,
    height: 300,
    hidden: true,
    vampireCrypt: true,
    chatMessages: [],
    members: new Set(),
    items: [],
    resources: [],
    placedObjects: [],
    protectedArea: null,
    terrain: null,
    connections: [],
    players: [],
    npcs: [
      { id: 'vampire_thrall_1', type: 'vampire_npc', name: 'Hollowed Thrall', x: 150, y: 120, sleepPhases: ['day', 'dawn', 'dusk'], dialogue: 'vampire_npc' },
      { id: 'vampire_thrall_2', type: 'vampire_npc', name: 'Night Stalker', x: 250, y: 180, sleepPhases: ['day', 'dawn', 'dusk'], dialogue: 'vampire_npc' },
    ],
    createdAt: Date.now(),
  });
  console.log('[state] Created zone: Abandoned Crypt (template)');

  // -------------------------------------------------------------------------
  // Town Jail — shared structure used per-town by prison system
  // -------------------------------------------------------------------------
  zones.set('town_jail', {
    id: 'town_jail',
    type: 'building',
    name: 'Town Jail',
    isJail: true,
    width: 400,
    height: 300,
    hidden: false,
    chatMessages: [],
    members: new Set(),
    items: [],
    resources: [],
    placedObjects: [],
    protectedArea: { x: 0, y: 0, width: 400, height: 300 },
    terrain: null,
    connections: [],
    players: [],
    npcs: [
      { id: 'jailer_main', type: 'jailer', name: 'The Jailer', x: 150, y: 100, sleepPhases: [], dialogue: 'jailer' },
      { id: 'jail_guard_1', type: 'guard', name: 'Jail Guard', x: 250, y: 100, sleepPhases: [], dialogue: 'guard' },
    ],
    createdAt: Date.now(),
  });
  console.log('[state] Created zone: Town Jail');

  // -------------------------------------------------------------------------
  // Overworld — massive chunk-based open world with lazy generation
  // Resources are generated per-chunk when players enter new areas
  // -------------------------------------------------------------------------
  createZone('overworld', {
    name: 'The Overworld',
    type: 'overworld',
    width: worldgen.WORLD_WIDTH,
    height: worldgen.WORLD_HEIGHT,
    npcs: [],
    connections: [
      { targetZone: 'starter_town', x: worldgen.getSpawnPoint().x, y: worldgen.getSpawnPoint().y, direction: 'south' },
      // Rift entrance on overworld, slightly west of starter town
      { targetZone: 'rift_antechamber', x: worldgen.getSpawnPoint().x - 512, y: worldgen.getSpawnPoint().y, direction: 'enter' },
      // Anchor town connections (overworld pixel positions)
      { targetZone: 'solara', x: 532480, y: 659456, direction: 'enter' },
      { targetZone: 'sylvaris', x: 535040, y: 668160, direction: 'enter' },
      { targetZone: 'ironhold', x: 528384, y: 644096, direction: 'enter' },
      { targetZone: 'kragmor', x: 521216, y: 652800, direction: 'enter' },
      { targetZone: 'bonetrap', x: 517120, y: 659456, direction: 'enter' },
      { targetZone: 'murkmire', x: 519680, y: 666624, direction: 'enter' },
      { targetZone: 'mechspire', x: 560640, y: 659456, direction: 'enter' },
      { targetZone: 'clockwork_harbor_town', x: 559104, y: 665600, direction: 'enter' },
      { targetZone: 'fortunes_rest', x: 529920, y: 635904, direction: 'enter' },
    ],
    terrain: null,
    resources: [],  // resources loaded lazily per chunk
  });

  // Add chunk cache and resource map for lazy generation
  var overworld = zones.get('overworld');
  overworld.chunkCache = new Map();    // 'cx,cy' -> chunk data
  overworld.resourceMap = new Map();   // resourceId -> resource object
  overworld.worldSeed = 'mmolite_world_v1';

  // Load persisted plots
  var plotModule = require('./handlers/plot');
  overworld.plots = plotModule.loadPlots('overworld');

  // Migrate old 2048-wide plots to 512x512 footprint
  var migratedCount = 0;
  for (var mi = 0; mi < overworld.plots.length; mi++) {
    var mPlot = overworld.plots[mi];
    if (mPlot.width === 2048) {
      mPlot.width = 512;
      mPlot.height = 512;
      // Re-snap to 512 grid (2048 is divisible by 512, so coordinates stay valid)
      mPlot.x = Math.floor(mPlot.x / 512) * 512;
      mPlot.y = Math.floor(mPlot.y / 512) * 512;
      migratedCount++;
    }
  }
  if (migratedCount > 0) {
    plotModule.savePlots('overworld', overworld.plots);
    console.log('[state] Migrated ' + migratedCount + ' plots from 2048x2048 to 512x512');
  }

  console.log('[state] Created zone: Overworld (' + worldgen.WORLD_CHUNKS_X + 'x' + worldgen.WORLD_CHUNKS_Y + ' chunks, lazy generation, ' + overworld.plots.length + ' plots)');

  // Create plot interior zones for all owned plots and add overworld connections
  var plotZoneCount = 0;
  for (var pi = 0; pi < overworld.plots.length; pi++) {
    var plot = overworld.plots[pi];
    if (plot.ownerKey) {
      getOrCreatePlotZone(plot.id, plot.ownerKey, plot.ownerName);
      overworld.connections.push({
        targetZone: 'plot_' + plot.id,
        x: plot.x + 256,
        y: plot.y + 256,
        direction: 'enter',
        isPlotEntrance: true,
        plotId: plot.id,
        ownerName: plot.ownerName,
      });
      plotZoneCount++;
    }
  }
  if (plotZoneCount > 0) {
    console.log('[state] Created ' + plotZoneCount + ' plot interior zones');
  }

  // Hollow Earth — underground world (same dimensions as overworld)
  createZone('hollow_earth', {
    name: 'The Hollow Earth',
    type: 'hollow_earth',
    width: worldgen.WORLD_WIDTH,
    height: worldgen.WORLD_HEIGHT,
    npcs: [],
    connections: [],
    terrain: null,
    resources: [],
  });

  var hollowEarth = zones.get('hollow_earth');
  hollowEarth.chunkCache = new Map();
  hollowEarth.resourceMap = new Map();
  hollowEarth.worldSeed = 'mmolite_world_v1';
  hollowEarth.isHollowEarth = true;  // flag for chunk generation
  console.log('[state] Created zone: Hollow Earth (' + worldgen.WORLD_CHUNKS_X + 'x' + worldgen.WORLD_CHUNKS_Y + ' chunks, lazy generation)');

  // Game Corner — hidden
  createZone('game_corner', {
    name: 'Game Corner',
    type: 'building',
    width: 800,
    height: 600,
    gamecorner: true,
    hidden: true,
    npcs: [],
    connections: [
      { targetZone: 'starter_town', x: 400, y: 580, direction: 'south' },
    ],
  });
  console.log('[state] Created zone: Game Corner (hidden)');
}

// ---------------------------------------------------------------------------
// Wipe (daily reset of ephemeral state, accounts persist)
// ---------------------------------------------------------------------------

function wipeEphemeral() {
  users.clear();
  playerZones.clear();
  playerPositions.clear();
  instances.clear();
  parties.clear();
  playerPartyMap.clear();
  zoneMonsters.clear();

  // Clear zone chat and members but keep zone definitions
  for (const [, zone] of zones) {
    zone.chatMessages = [];
    zone.members.clear();
  }

  world.timeOfDay = 'day';
  world.weather = 'clear';
  world.dayStartedAt = Date.now();
  world.activeEvents = [];

  // Director state: reset tension, increment narrative day, clear events
  if (world.directorState) {
    world.directorState.globalTensionScore = 0;
    world.directorState.narrativeDay = (world.directorState.narrativeDay + 1) % 7;
    world.directorState.activeWorldEvents = [];
  }

  // Clear survival visited chunks (BUG-1: grows forever without cleanup)
  if (module.exports._survivalVisitedChunks) module.exports._survivalVisitedChunks.clear();

  // Clear shared Redis state too
  stateSync.wipeSharedState();

  console.log('[state] Ephemeral state wiped');
}

// Initialize cross-process state sync (call after Redis is ready)
function initSync(redisModule) {
  return stateSync.init(redisModule, module.exports);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Data stores
  users,
  zones,
  instances,
  playerZones,
  playerPositions,
  parties,
  playerPartyMap,
  guilds,
  zoneMonsters,
  world,

  // Name lists (for rename UI)
  COLOR_PREFIXES,
  CHARACTER_NAMES,

  // Generators
  generateAnonName,
  generateId,
  getRandomColor,
  generateTag,

  // User ops
  createUser,
  removeUser,

  // Zone ops
  createZone,
  getOrCreateDungeonZone,
  getOrCreatePlotZone,
  joinZone,
  leaveZone,
  updatePlayerPosition,
  getPlayersInZone,
  addZoneChatMessage,
  getZoneState,
  getZoneList,

  // Instance ops
  createInstance,
  deleteInstance,

  // Party ops
  createParty,
  getPlayerParty,
  removeParty,

  // Battle stubs (legacy PvP — keeps disconnect cleanup from throwing)
  activeBattles,
  endBattle,

  // World
  advanceWorldTime,
  worldgen,
  getOrGenerateChunk,

  // Calendar
  advanceCalendar,
  getCalendar,
  isNpcAsleep,
  getTimeOfDay,
  CALENDAR_MONTHS,

  // Lifecycle
  initDefaultZones,
  wipeEphemeral,
  initSync,

  // Per-biome weather
  biomeWeather,
  getBiomeWeather,
  setBiomeWeather,

  // Sanitization
  sanitizeText,
  sanitizeName,
};
