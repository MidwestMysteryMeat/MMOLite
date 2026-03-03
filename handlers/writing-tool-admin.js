// handlers/writing-tool-admin.js
// Live content authoring tool — served as a browser app on the game server.
// Provides REST APIs backed by SQLite (better-sqlite3) for NPCs, dialogue,
// quests, story arcs, lore, and fixture sites.  Authored content is pushed
// to connected players in real-time via Socket.IO.
//
// Access: GET /<token>/writing-tool  (token printed at startup)
// The token is stable across restarts — stored in data/writing_tool_token.txt
// or overridden via WRITING_TOOL_TOKEN env var.

'use strict';

var fs     = require('fs');
var path   = require('path');
var crypto = require('crypto');

var _db    = null;
var _token = null;

// ── Token ─────────────────────────────────────────────────────────────────────

function _getToken() {
  if (_token) return _token;
  if (process.env.WRITING_TOOL_TOKEN) { _token = process.env.WRITING_TOOL_TOKEN; return _token; }
  var f = path.join(__dirname, '..', 'data', 'writing_tool_token.txt');
  if (fs.existsSync(f)) { _token = fs.readFileSync(f, 'utf8').trim(); return _token; }
  _token = 'wtool-' + crypto.randomBytes(8).toString('hex');
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, _token); } catch (_) {}
  return _token;
}

// ── Schema ────────────────────────────────────────────────────────────────────

var SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS location_types (
  type_id           TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  dungeon_template  TEXT DEFAULT 'cave',
  asset_id          TEXT DEFAULT 'dungeon_entrance',
  icon              TEXT DEFAULT '📍',
  created_at        INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS quest_arcs (
  arc_id             TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT DEFAULT '',
  sequence           INTEGER DEFAULT 0,
  state              TEXT DEFAULT 'unmet',
  faction            TEXT,
  intro_node_id      TEXT,
  conclusion_node_id TEXT,
  created_at         INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS npcs (
  npc_id        TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  faction       TEXT,
  occupation    TEXT,
  region        TEXT,
  personality   TEXT DEFAULT '[]',
  tier          INTEGER DEFAULT 1,
  home_zone     TEXT,
  fixture_id    TEXT,
  portrait      TEXT,
  race          TEXT,
  description   TEXT,
  voice_tone    TEXT,
  sleep_start   INTEGER DEFAULT 22,
  sleep_end     INTEGER DEFAULT 6,
  knowledge     TEXT DEFAULT '[]',
  inventory     TEXT DEFAULT '[]',
  relationships TEXT DEFAULT '[]',
  created_at    INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS dialogue_nodes (
  node_id          TEXT PRIMARY KEY,
  npc_id           TEXT,
  text             TEXT NOT NULL DEFAULT '',
  state            TEXT DEFAULT 'unmet',
  is_quest_hook    INTEGER DEFAULT 0,
  quest_params     TEXT DEFAULT '{}',
  followup_node_id TEXT,
  tags             TEXT DEFAULT '[]',
  weight           REAL DEFAULT 1.0,
  graph_x          REAL DEFAULT 100,
  graph_y          REAL DEFAULT 100,
  created_at       INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS node_connections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_node_id TEXT NOT NULL,
  to_node_id   TEXT NOT NULL,
  choice_label TEXT DEFAULT 'Continue',
  UNIQUE(from_node_id, to_node_id)
);

CREATE TABLE IF NOT EXISTS quests (
  quest_id             TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  description          TEXT DEFAULT '',
  story_type           TEXT DEFAULT 'side',
  type                 TEXT DEFAULT 'fetch',
  arc_id               TEXT,
  arc_sequence         INTEGER DEFAULT 0,
  giver_npc_id         TEXT,
  target_zone_id       TEXT,
  fixture_id           TEXT,
  spawn_radius         REAL DEFAULT 200,
  location_type        TEXT DEFAULT 'mine',
  reward_tier          INTEGER DEFAULT 1,
  rewards              TEXT DEFAULT '{}',
  completion_condition TEXT DEFAULT '{}',
  dialogue_node_id     TEXT,
  loot_table           TEXT DEFAULT '[]',
  npc_spawns           TEXT DEFAULT '[]',
  map_marker_label     TEXT,
  state                TEXT DEFAULT 'unmet',
  created_at           INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS lore (
  lore_id        TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  content        TEXT NOT NULL DEFAULT '',
  author         TEXT,
  faction        TEXT,
  tags           TEXT DEFAULT '[]',
  npc_ids        TEXT DEFAULT '[]',
  fixture_ids    TEXT DEFAULT '[]',
  is_book        INTEGER DEFAULT 0,
  book_chapters  TEXT DEFAULT '[]',
  unlock_trigger TEXT,
  created_at     INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS fixtures (
  fixture_id            TEXT PRIMARY KEY,
  name                  TEXT,
  zone_id               TEXT NOT NULL,
  x                     REAL DEFAULT 0,
  y                     REAL DEFAULT 0,
  fixture_radius        REAL DEFAULT 50,
  exclusion_radius      REAL DEFAULT 150,
  history               TEXT DEFAULT '[]',
  faction_owner         TEXT,
  reputation_tag        TEXT,
  tier                  INTEGER DEFAULT 1,
  current_quest_id      TEXT,
  available_for_new_quest INTEGER DEFAULT 1,
  location_type         TEXT,
  object_id             TEXT,
  dungeon_zone_id       TEXT,
  created_at            INTEGER DEFAULT (strftime('%s','now'))
);

-- Nemesis system — schema reserved, not yet queried at MMO scale
CREATE TABLE IF NOT EXISTS npc_relationships (
  npc_id          TEXT,
  player_id       TEXT,
  reputation_score REAL DEFAULT 0,
  event_log       TEXT DEFAULT '[]',
  PRIMARY KEY (npc_id, player_id)
);

-- Remote shards for simultaneous cross-shard deploys
CREATE TABLE IF NOT EXISTS shard_sync (
  shard_id   TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  url        TEXT NOT NULL,
  token      TEXT NOT NULL,
  enabled    INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS placed_towns (
  town_id     TEXT PRIMARY KEY,
  zone_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  town_type   TEXT DEFAULT 'settlement',
  wx          REAL NOT NULL,
  wy          REAL NOT NULL,
  width       INTEGER DEFAULT 2000,
  height      INTEGER DEFAULT 1600,
  biome       TEXT DEFAULT 'plains',
  description TEXT DEFAULT '',
  created_at  INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS map_markers (
  marker_id       TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  type            TEXT DEFAULT 'poi',
  wx              REAL NOT NULL,
  wy              REAL NOT NULL,
  color           TEXT DEFAULT '#f5c542',
  notes           TEXT DEFAULT '',
  linked_zone_id  TEXT DEFAULT '',
  linked_npc_id   TEXT DEFAULT '',
  linked_quest_id TEXT DEFAULT '',
  created_at      INTEGER DEFAULT (strftime('%s','now'))
);
`;

var DEFAULT_LOC_TYPES = [
  { type_id: 'mine',         label: 'Mine / Quarry',              dungeon_template: 'cave',    asset_id: 'mine_entrance',    icon: '⛏️'  },
  { type_id: 'bandit_camp',  label: 'Bandit Camp / Stronghold',   dungeon_template: 'dungeon', asset_id: 'fort_entrance',    icon: '🏴'  },
  { type_id: 'ruin',         label: 'Ancient Ruin / Tower',       dungeon_template: 'rift',    asset_id: 'ruin_entrance',    icon: '🏚️' },
  { type_id: 'den',          label: 'Creature Den / Lair',        dungeon_template: 'forest',  asset_id: 'den_entrance',     icon: '🦴'  },
  { type_id: 'rift_site',    label: 'Rift Tear / Void Site',      dungeon_template: 'rift',    asset_id: 'rift_tear',        icon: '🌀'  },
  { type_id: 'cave',         label: 'Cave System',                dungeon_template: 'cave',    asset_id: 'cave_entrance',    icon: '🕳️' },
  { type_id: 'tomb',         label: 'Ancient Tomb / Crypt',       dungeon_template: 'undead',  asset_id: 'tomb_entrance',    icon: '⚰️' },
  { type_id: 'grove',        label: 'Corrupted Grove',            dungeon_template: 'forest',  asset_id: 'grove_entrance',   icon: '🌿'  },
  { type_id: 'watchtower',   label: 'Abandoned Watchtower',       dungeon_template: 'dungeon', asset_id: 'tower_entrance',   icon: '🗼'  },
  { type_id: 'shipwreck',    label: 'Shipwreck / Coastal Ruin',   dungeon_template: 'cave',    asset_id: 'wreck_entrance',   icon: '⚓'  },
  { type_id: 'outpost',      label: 'Ruined Outpost / Camp',      dungeon_template: 'dungeon', asset_id: 'outpost_entrance', icon: '⛺'  },
  { type_id: 'vault',             label: 'Sealed Vault / Treasury',         dungeon_template: 'dungeon', asset_id: 'vault_entrance',      icon: '🔒'  },
  // Settlement ruins — explorable locations themed as fallen settlements
  { type_id: 'abandoned_town',    label: 'Abandoned Town',                  dungeon_template: 'ruins',   asset_id: 'town_ruins',          icon: '🏚️' },
  { type_id: 'burnt_village',     label: 'Burnt Village',                   dungeon_template: 'ruins',   asset_id: 'burned_village',      icon: '🔥'  },
  { type_id: 'necropolis',        label: 'Necropolis / City of the Dead',   dungeon_template: 'undead',  asset_id: 'necropolis',          icon: '💀'  },
  { type_id: 'ghost_town',        label: 'Ghost Town',                      dungeon_template: 'rift',    asset_id: 'ghost_town',          icon: '👻'  },
  { type_id: 'sunken_city',       label: 'Sunken City',                     dungeon_template: 'cave',    asset_id: 'sunken_entrance',     icon: '🌊'  },
  { type_id: 'plague_village',    label: 'Plague Village',                  dungeon_template: 'forest',  asset_id: 'plague_village',      icon: '☠️' },
  { type_id: 'collapsed_fortress',label: 'Collapsed Fortress',              dungeon_template: 'dungeon', asset_id: 'fortress_ruins',      icon: '🏰'  },
  { type_id: 'siege_ruins',       label: 'Siege Ruins / Battle Site',       dungeon_template: 'dungeon', asset_id: 'battle_ruins',        icon: '⚔️' },

  // Temples & Sacred Sites
  { type_id: 'temple_holy',       label: 'Temple of the Holy Dominion',     dungeon_template: 'dungeon', asset_id: 'temple_entrance',     icon: '⛪'  },
  { type_id: 'temple_corrupted',  label: 'Corrupted Temple',                dungeon_template: 'rift',    asset_id: 'temple_corrupted',    icon: '🕍'  },
  { type_id: 'fallen_cathedral',  label: 'Fallen Cathedral',                dungeon_template: 'undead',  asset_id: 'cathedral_ruins',     icon: '🏛️' },
  { type_id: 'elven_shrine',      label: 'Elven Moon Shrine',               dungeon_template: 'forest',  asset_id: 'shrine_elven',        icon: '🌙'  },
  { type_id: 'dwarven_hall',      label: 'Dwarven Ancestor Hall',           dungeon_template: 'cave',    asset_id: 'dwarven_hall',        icon: '🪨'  },
  { type_id: 'dark_elf_sanctum',  label: 'Dark Elf Sanctum',               dungeon_template: 'rift',    asset_id: 'sanctum_entrance',    icon: '🖤'  },
  { type_id: 'rift_altar',        label: 'Rift Altar / Void Shrine',        dungeon_template: 'rift',    asset_id: 'rift_altar',          icon: '🔮'  },
  { type_id: 'barrow_mound',      label: 'Ancient Barrow Mound',            dungeon_template: 'undead',  asset_id: 'barrow_entrance',     icon: '🪦'  },
  { type_id: 'gnomish_mechanarium',label: 'Gnomish Mechanarium / Lab',      dungeon_template: 'cave',    asset_id: 'mech_entrance',       icon: '⚙️' },

  // Faction Hideouts & Criminal Operations
  { type_id: 'thieves_hideout',   label: 'Thieves\' Guild Hideout',         dungeon_template: 'dungeon', asset_id: 'hideout_entrance',    icon: '🗡️' },
  { type_id: 'smuggler_cache',    label: 'Smuggler\'s Cache / Stash',       dungeon_template: 'cave',    asset_id: 'cache_entrance',      icon: '📦'  },
  { type_id: 'rebel_stronghold',  label: 'Rebel Stronghold',                dungeon_template: 'dungeon', asset_id: 'stronghold_entrance', icon: '✊'  },
  { type_id: 'secret_chamber',    label: 'Secret Society Chamber',          dungeon_template: 'dungeon', asset_id: 'chamber_entrance',    icon: '🔑'  },
  { type_id: 'underground_den',   label: 'Underground Criminal Den',        dungeon_template: 'dungeon', asset_id: 'den_entrance',        icon: '🐀'  },
  { type_id: 'black_market',      label: 'Black Market Cellar',             dungeon_template: 'dungeon', asset_id: 'market_entrance',     icon: '💰'  },

  // Race Strongholds & Territories
  { type_id: 'orc_warcamp',       label: 'Orc War Camp / Warband',          dungeon_template: 'dungeon', asset_id: 'orc_camp',            icon: '🪓'  },
  { type_id: 'goblin_warren',     label: 'Goblin Warren / Burrow',          dungeon_template: 'cave',    asset_id: 'goblin_warren',       icon: '🟢'  },
  { type_id: 'lizardfolk_nest',   label: 'Lizardfolk Nesting Ground',       dungeon_template: 'forest',  asset_id: 'lizard_nest',         icon: '🦎'  },
  { type_id: 'catfolk_hunting',   label: 'Catfolk Hunting Lodge',           dungeon_template: 'forest',  asset_id: 'catfolk_lodge',       icon: '🐾'  },
  { type_id: 'dwarven_hold',      label: 'Dwarven Hold / Deep Outpost',     dungeon_template: 'cave',    asset_id: 'dwarven_hold',        icon: '⛏️' },
  { type_id: 'vampire_lair',      label: 'Vampire Crypt Lair',              dungeon_template: 'undead',  asset_id: 'vampire_crypt',       icon: '🧛'  },
  { type_id: 'werewolf_den',      label: 'Werewolf Den / Pack Territory',   dungeon_template: 'forest',  asset_id: 'wolf_den',            icon: '🐺'  },
  { type_id: 'lich_sanctum',      label: 'Lich Sanctum / Phylactery Vault', dungeon_template: 'undead',  asset_id: 'lich_sanctum',        icon: '💀'  },

  // Military & Faction Installations
  { type_id: 'dominion_fort',     label: 'Dominion Fortress Outpost',       dungeon_template: 'dungeon', asset_id: 'fort_entrance',       icon: '🛡️' },
  { type_id: 'rift_warden_post',  label: 'Rift Warden Watch Post',          dungeon_template: 'rift',    asset_id: 'warden_post',         icon: '👁️' },
  { type_id: 'mercenary_camp',    label: 'Mercenary Camp / Sellsword Den',  dungeon_template: 'dungeon', asset_id: 'merc_camp',           icon: '⚔️' },
  { type_id: 'prison_camp',       label: 'Prison Camp / Stockade',          dungeon_template: 'dungeon', asset_id: 'prison_entrance',     icon: '⛓️' },
  { type_id: 'war_camp',          label: 'Active War Camp',                 dungeon_template: 'dungeon', asset_id: 'warcamp_entrance',    icon: '🪖'  },
  { type_id: 'slaver_post',       label: 'Slaver\'s Post / Holding Pen',    dungeon_template: 'dungeon', asset_id: 'slaver_post',         icon: '🔒'  },

  // Natural & Magical Phenomena
  { type_id: 'ley_nexus',         label: 'Ancient Ley Line Nexus',          dungeon_template: 'rift',    asset_id: 'ley_nexus',           icon: '✨'  },
  { type_id: 'cursed_graveyard',  label: 'Cursed Graveyard / Barrowfield',  dungeon_template: 'undead',  asset_id: 'graveyard_entrance',  icon: '🪦'  },
  { type_id: 'dragon_roost',      label: 'Dragon\'s Roost / Aerie',         dungeon_template: 'cave',    asset_id: 'dragon_roost',        icon: '🐉'  },
  { type_id: 'enchanted_clearing',label: 'Enchanted Clearing / Fey Circle', dungeon_template: 'forest',  asset_id: 'fey_clearing',        icon: '🍄'  },
  { type_id: 'hollow_earth_vent', label: 'Hollow Earth Vent / Deep Portal', dungeon_template: 'cave',    asset_id: 'hollow_vent',         icon: '🌋'  },

  // Unique / Special Purpose
  { type_id: 'gladiator_pit',     label: 'Gladiator Pit / Arena',           dungeon_template: 'dungeon', asset_id: 'arena_entrance',      icon: '🏟️' },
  { type_id: 'ancient_library',   label: 'Ancient Library / Scriptorium',   dungeon_template: 'dungeon', asset_id: 'library_entrance',    icon: '📚'  },
  { type_id: 'alchemist_lab',     label: 'Alchemist\'s Laboratory',         dungeon_template: 'cave',    asset_id: 'lab_entrance',        icon: '⚗️' },
  { type_id: 'lost_expedition',   label: 'Lost Expedition Camp',            dungeon_template: 'dungeon', asset_id: 'camp_ruins',          icon: '🗺️' },
  { type_id: 'observatory',       label: 'Ancient Observatory / Astrolabe', dungeon_template: 'dungeon', asset_id: 'observatory',         icon: '🔭'  },
  { type_id: 'plague_station',    label: 'Plague Doctor\'s Station',        dungeon_template: 'forest',  asset_id: 'plague_station',      icon: '🧪'  },
];

// ── DB init ───────────────────────────────────────────────────────────────────

function _initDb() {
  var Database;
  try { Database = require('better-sqlite3'); }
  catch (_) {
    console.error('[writing-tool] ❌  better-sqlite3 not found — run: npm install better-sqlite3');
    return null;
  }
  var dbPath = path.join(__dirname, '..', 'data', 'writing.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  var db = new Database(dbPath);
  db.exec(SCHEMA);
  // Migrations — ALTER TABLE is safe no-op if column already exists
  try { db.exec('ALTER TABLE npcs ADD COLUMN deploy_x       INTEGER DEFAULT 5'); }  catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN deploy_y       INTEGER DEFAULT 5'); }  catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN fears          TEXT DEFAULT \'[]\''); } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN ambitions      TEXT DEFAULT \'[]\''); } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN secrets        TEXT DEFAULT \'[]\''); } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN notable_items  TEXT DEFAULT \'[]\''); } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN background     TEXT DEFAULT \'\'');   } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN job_title      TEXT');                } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN work_object_id TEXT');                } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN home_object_id TEXT');                } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN schedule          TEXT DEFAULT \'[]\''); } catch (_) {}
  // NPC-editor parity columns
  try { db.exec('ALTER TABLE npcs ADD COLUMN age              INTEGER DEFAULT 30');  } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN gender           TEXT');                } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN background_arch  TEXT');                } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN shop_type        TEXT');                } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN faction_rep      INTEGER DEFAULT 0');   } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN town_rep         INTEGER DEFAULT 0');   } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN is_famous        INTEGER DEFAULT 0');   } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN rumor            TEXT');                } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN motivation       TEXT');                } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN work_start       INTEGER DEFAULT 8');   } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN work_end         INTEGER DEFAULT 20');  } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN days_off         TEXT DEFAULT \'[]\''); } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN wander_radius    INTEGER DEFAULT 0');   } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN patrol_route     TEXT DEFAULT \'[]\''); } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN gold             INTEGER DEFAULT 0');   } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN daily_wage       INTEGER DEFAULT 0');   } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN linked_quest_ids TEXT DEFAULT \'[]\''); } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN linked_lore_ids  TEXT DEFAULT \'[]\''); } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN loot_table       TEXT DEFAULT \'[]\''); } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN coin_drop_min    INTEGER DEFAULT 0');   } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN coin_drop_max    INTEGER DEFAULT 0');   } catch (_) {}
  try { db.exec('ALTER TABLE npcs ADD COLUMN loot_tier        INTEGER DEFAULT 1');   } catch (_) {}
  var insLoc = db.prepare('INSERT OR IGNORE INTO location_types (type_id, label, dungeon_template, asset_id, icon) VALUES (?, ?, ?, ?, ?)');
  for (var t of DEFAULT_LOC_TYPES) insLoc.run(t.type_id, t.label, t.dungeon_template, t.asset_id, t.icon);
  return db;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _j(v) {
  if (v === null || v === undefined) return '[]';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function _jo(v) {  // JSON for objects (not arrays)
  if (v === null || v === undefined) return '{}';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function _npcToZone(npc, x, y) {
  return {
    id: npc.npc_id, name: npc.name,
    type:          npc.occupation || 'civilian',
    role:          npc.occupation || 'civilian',
    race:          npc.race       || null,
    x: x || 5, y: y || 5,
    dialogue:      npc.npc_id,
    shopType:      npc.shop_type  || null,
    sleepStart:    npc.sleep_start    != null ? npc.sleep_start : 22,
    sleepEnd:      npc.sleep_end      != null ? npc.sleep_end   : 6,
    workStart:     npc.work_start     != null ? npc.work_start  : 8,
    workEnd:       npc.work_end       != null ? npc.work_end    : 20,
    wanderRadius:  npc.wander_radius  || 0,
    workObjectId:  npc.work_object_id || null,
    homeObjectId:  npc.home_object_id || null,
    schedule:      npc.schedule       || '[]',
    factionId:     npc.faction        || null,
    factionRep:    npc.faction_rep    || 0,
  };
}

function _writeNpcJson(npc) {
  try {
    var dir = path.join(__dirname, '..', 'data', 'npcs');
    fs.mkdirSync(dir, { recursive: true });
    var data = Object.assign({}, npc, {
      id:               npc.npc_id,
      personality:      JSON.parse(npc.personality      || '[]'),
      knowledge:        JSON.parse(npc.knowledge        || '[]'),
      inventory:        JSON.parse(npc.inventory        || '[]'),
      relationships:    JSON.parse(npc.relationships    || '[]'),
      fears:            JSON.parse(npc.fears            || '[]'),
      ambitions:        JSON.parse(npc.ambitions        || '[]'),
      secrets:          JSON.parse(npc.secrets          || '[]'),
      notable_items:    JSON.parse(npc.notable_items    || '[]'),
      schedule:         JSON.parse(npc.schedule         || '[]'),
      days_off:         JSON.parse(npc.days_off         || '[]'),
      patrol_route:     JSON.parse(npc.patrol_route     || '[]'),
      linked_quest_ids: JSON.parse(npc.linked_quest_ids || '[]'),
      linked_lore_ids:  JSON.parse(npc.linked_lore_ids  || '[]'),
      loot_table:       JSON.parse(npc.loot_table       || '[]'),
    });
    fs.writeFileSync(path.join(dir, npc.npc_id + '.json'), JSON.stringify(data, null, 2));
  } catch (_) {}
}

function _upsertNpc(db, id, b) {
  // ON CONFLICT DO UPDATE preserves home_zone/deploy_x/deploy_y (set by deploy endpoint).
  // Editing and re-saving an NPC from the form never clobbers deployment state.
  db.prepare(`
    INSERT INTO npcs
      (npc_id, name, faction, occupation, region, personality, tier,
       fixture_id, portrait, race, description, voice_tone, sleep_start, sleep_end,
       knowledge, inventory, relationships, fears, ambitions, secrets, notable_items,
       background, job_title, work_object_id, home_object_id, schedule,
       age, gender, background_arch, shop_type, faction_rep, town_rep,
       is_famous, rumor, motivation, work_start, work_end, days_off,
       wander_radius, patrol_route, gold, daily_wage,
       linked_quest_ids, linked_lore_ids,
       loot_table, coin_drop_min, coin_drop_max, loot_tier)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(npc_id) DO UPDATE SET
      name=excluded.name, faction=excluded.faction, occupation=excluded.occupation,
      region=excluded.region, personality=excluded.personality, tier=excluded.tier,
      fixture_id=excluded.fixture_id, portrait=excluded.portrait, race=excluded.race,
      description=excluded.description, voice_tone=excluded.voice_tone,
      sleep_start=excluded.sleep_start, sleep_end=excluded.sleep_end,
      knowledge=excluded.knowledge, inventory=excluded.inventory,
      relationships=excluded.relationships, fears=excluded.fears,
      ambitions=excluded.ambitions, secrets=excluded.secrets,
      notable_items=excluded.notable_items, background=excluded.background,
      job_title=excluded.job_title, work_object_id=excluded.work_object_id,
      home_object_id=excluded.home_object_id, schedule=excluded.schedule,
      age=excluded.age, gender=excluded.gender,
      background_arch=excluded.background_arch, shop_type=excluded.shop_type,
      faction_rep=excluded.faction_rep, town_rep=excluded.town_rep,
      is_famous=excluded.is_famous, rumor=excluded.rumor,
      motivation=excluded.motivation, work_start=excluded.work_start,
      work_end=excluded.work_end, days_off=excluded.days_off,
      wander_radius=excluded.wander_radius, patrol_route=excluded.patrol_route,
      gold=excluded.gold, daily_wage=excluded.daily_wage,
      linked_quest_ids=excluded.linked_quest_ids, linked_lore_ids=excluded.linked_lore_ids,
      loot_table=excluded.loot_table, coin_drop_min=excluded.coin_drop_min,
      coin_drop_max=excluded.coin_drop_max, loot_tier=excluded.loot_tier`)
  .run(
    id, b.name || 'Unnamed', b.faction || null, b.occupation || null,
    b.region || null, _j(b.personality), b.tier || 1,
    b.fixture_id || null, b.portrait || null, b.race || null,
    b.description || null, b.voice_tone || null,
    b.sleep_start != null ? b.sleep_start : 22,
    b.sleep_end   != null ? b.sleep_end   : 6,
    _j(b.knowledge), _j(b.inventory), _j(b.relationships),
    _j(b.fears), _j(b.ambitions), _j(b.secrets), _j(b.notable_items),
    b.background || '', b.job_title || null,
    b.work_object_id || null, b.home_object_id || null, _j(b.schedule),
    b.age || 30, b.gender || null, b.background_arch || null, b.shop_type || null,
    b.faction_rep || 0, b.town_rep || 0, b.is_famous ? 1 : 0,
    b.rumor || null, b.motivation || null,
    b.work_start != null ? b.work_start : 8,
    b.work_end   != null ? b.work_end   : 20,
    _j(b.days_off), b.wander_radius || 0, _j(b.patrol_route),
    b.gold || 0, b.daily_wage || 0,
    _j(b.linked_quest_ids), _j(b.linked_lore_ids),
    _j(b.loot_table), b.coin_drop_min || 0, b.coin_drop_max || 0, b.loot_tier || 1);
}

function _upsertNode(db, id, b) {
  db.prepare(`INSERT OR REPLACE INTO dialogue_nodes
    (node_id, npc_id, text, state, is_quest_hook, quest_params,
     followup_node_id, tags, weight, graph_x, graph_y)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run(id, b.npc_id || null, b.text || '', b.state || 'unmet',
    b.is_quest_hook ? 1 : 0, _jo(b.quest_params),
    b.followup_node_id || null, _j(b.tags),
    b.weight || 1.0, b.graph_x || 100, b.graph_y || 100);
}

function _upsertQuest(db, id, b) {
  db.prepare(`INSERT OR REPLACE INTO quests
    (quest_id, name, description, story_type, type, arc_id, arc_sequence,
     giver_npc_id, target_zone_id, fixture_id, spawn_radius, location_type,
     reward_tier, rewards, completion_condition, dialogue_node_id,
     loot_table, npc_spawns, map_marker_label, state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run(id, b.name || 'Unnamed Quest', b.description || '',
    b.story_type || 'side', b.type || 'fetch',
    b.arc_id || null, b.arc_sequence || 0,
    b.giver_npc_id || null, b.target_zone_id || null, b.fixture_id || null,
    b.spawn_radius || 200, b.location_type || 'mine',
    b.reward_tier || 1, _jo(b.rewards), _jo(b.completion_condition),
    b.dialogue_node_id || null, _j(b.loot_table), _j(b.npc_spawns),
    b.map_marker_label || null, b.state || 'unmet');
}

function _upsertLore(db, id, b) {
  db.prepare(`INSERT OR REPLACE INTO lore
    (lore_id, title, content, author, faction, tags, npc_ids, fixture_ids,
     is_book, book_chapters, unlock_trigger)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run(id, b.title || 'Untitled', b.content || '',
    b.author || null, b.faction || null,
    _j(b.tags), _j(b.npc_ids), _j(b.fixture_ids),
    b.is_book ? 1 : 0, _j(b.book_chapters), b.unlock_trigger || null);
}

// ── In-memory authored content cache (for overworld.js runtime lookups) ───────

var _authoredDialogue = new Map();  // npc_id → { nodes, edges }
var _authoredQuests   = new Map();  // quest_id → quest
var _questMarkers     = new Map();  // zone_id → [ { questId, label, x, y } ]

function _rebuildCache(db) {
  _authoredDialogue.clear();
  var allNodes = db.prepare('SELECT * FROM dialogue_nodes').all();
  var allEdges = db.prepare('SELECT * FROM node_connections').all();
  var nodesByNpc = {};
  for (var n of allNodes) {
    if (!nodesByNpc[n.npc_id]) nodesByNpc[n.npc_id] = [];
    nodesByNpc[n.npc_id].push(n);
  }
  for (var npcId in nodesByNpc) {
    var npcEdges = allEdges.filter(function(e) {
      return nodesByNpc[npcId].some(function(n) { return n.node_id === e.from_node_id; });
    });
    _authoredDialogue.set(npcId, { nodes: nodesByNpc[npcId], edges: npcEdges });
  }

  _authoredQuests.clear();
  _questMarkers.clear();
  var allQuests = db.prepare('SELECT * FROM quests WHERE fixture_id IS NOT NULL AND state != ?').all('unmet');
  for (var q of allQuests) {
    _authoredQuests.set(q.quest_id, q);
    if (q.target_zone_id) {
      var fx = db.prepare('SELECT * FROM fixtures WHERE fixture_id=?').get(q.fixture_id);
      if (fx) {
        if (!_questMarkers.has(q.target_zone_id)) _questMarkers.set(q.target_zone_id, []);
        _questMarkers.get(q.target_zone_id).push({
          questId:  q.quest_id,
          label:    q.map_marker_label || q.name,
          x:        fx.x,
          y:        fx.y,
          tier:     q.reward_tier || 1,
          type:     q.type,
          fixtureId: fx.fixture_id,
          dungeonZoneId: fx.dungeon_zone_id,
        });
      }
    }
  }
}

function getAuthoredDialogue(npcId) { return _authoredDialogue.get(npcId) || null; }
function getQuestMarkersForZone(zoneId) { return _questMarkers.get(zoneId) || []; }

// Returns all quests where this NPC is the giver — used by overworld.js at runtime.
function getLinkedQuestsForNpc(npcId) {
  if (!_db) return [];
  try {
    return _db.prepare('SELECT * FROM quests WHERE giver_npc_id = ?').all(npcId);
  } catch (_) { return []; }
}

// Single quest lookup by ID — used by overworld.js for quest_accept / quest_turnin fallback.
function getQuestById(questId) {
  if (!_db) return null;
  try {
    return _db.prepare('SELECT * FROM quests WHERE quest_id = ?').get(questId) || null;
  } catch (_) { return null; }
}

// Update a dialogue node's state — called from overworld.js when quest is completed/failed.
function updateDialogueNodeState(nodeId, newState) {
  if (!_db || !nodeId) return;
  try {
    _db.prepare('UPDATE dialogue_nodes SET state=? WHERE node_id=?').run(newState, nodeId);
    _rebuildCache(_db);
  } catch (_) {}
}

// Append an event entry to a fixture's history JSON array.
function appendFixtureHistory(fixtureId, event) {
  if (!_db || !fixtureId) return;
  try {
    var fx = _db.prepare('SELECT history FROM fixtures WHERE fixture_id=?').get(fixtureId);
    if (!fx) return;
    var hist = [];
    try { hist = JSON.parse(fx.history || '[]'); } catch (_) {}
    if (!Array.isArray(hist)) hist = [];
    hist.push(Object.assign({ ts: Date.now() }, event));
    _db.prepare('UPDATE fixtures SET history=? WHERE fixture_id=?').run(JSON.stringify(hist), fixtureId);
  } catch (_) {}
}

// ── Cross-shard sync ──────────────────────────────────────────────────────────
// Fire-and-forget POST to every enabled remote shard's internal sync endpoint.
// Called after a successful local deploy so both shards reflect the same state.

function _syncToShards(db, syncPath, body) {
  var shards;
  try { shards = db.prepare('SELECT * FROM shard_sync WHERE enabled=1').all(); }
  catch (_) { return; }
  if (!shards.length) return;

  var http  = require('http');
  var https = require('https');
  var bodyStr = JSON.stringify(body);

  shards.forEach(function(shard) {
    try {
      var u      = new URL(shard.url);
      var isHttps = u.protocol === 'https:';
      var fullPath = '/' + shard.token + syncPath;
      var opts = {
        hostname: u.hostname,
        port: parseInt(u.port) || (isHttps ? 443 : 80),
        path: fullPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
        timeout: 5000,
      };
      var req = (isHttps ? https : http).request(opts, function(res) {
        var data = '';
        res.on('data', function(c) { data += c; });
        res.on('end', function() {
          try {
            var r = JSON.parse(data);
            if (r.ok) console.log('[writing-tool] ✓ Synced to shard ' + shard.label);
            else console.error('[writing-tool] Shard sync ' + shard.label + ' failed:', data);
          } catch(_) {}
        });
      });
      req.on('error', function(e) { console.error('[writing-tool] Shard sync error (' + shard.label + '):', e.message); });
      req.on('timeout', function() { req.destroy(); });
      req.write(bodyStr);
      req.end();
    } catch(e) { console.error('[writing-tool] Shard sync error (' + shard.label + '):', e.message); }
  });
}

// ── Startup restore ───────────────────────────────────────────────────────────
// Creates a full town zone in live state from a placed_towns record.
function _createTownZone(state, town) {
  if (!state || !state.zones) return;
  var cx = Math.floor((town.width  || 2000) / 2);
  var cy = Math.floor((town.height || 1600) / 2);
  state.zones.set(town.zone_id, {
    id: town.zone_id, name: town.name, type: 'town',
    biome: town.biome || 'plains',
    width: town.width || 2000, height: town.height || 1600,
    npcs: [], spawns: [], items: [], resources: [], placedObjects: [],
    connections: [
      { targetZone: 'overworld', x: cx, y: 30,                    direction: 'north' },
      { targetZone: 'overworld', x: 30, y: cy,                    direction: 'west'  },
      { targetZone: 'overworld', x: (town.width||2000) - 30, y: cy,direction: 'east' },
      { targetZone: 'overworld', x: cx, y: (town.height||1600)-30, direction: 'south'},
    ],
    chatMessages: [], members: new Set(),
    plots: [], pvpEnabled: false, hidden: false,
    protectedArea: { x: 0, y: 0, width: town.width || 2000, height: town.height || 1600 },
    terrain: { water: [], mountain: [] },
    createdAt: Date.now(),
    authoredTownId: town.town_id,
  });
  // Register in overworld connections so the zone is reachable
  var ow = state.zones.get('overworld');
  if (ow) {
    ow.connections = ow.connections.filter(function(c) { return c.targetZone !== town.zone_id; });
    ow.connections.push({ targetZone: town.zone_id, x: town.wx, y: town.wy, direction: 'enter' });
  }
}

// Re-injects deployed NPCs and fixture placed-objects into live zone state so
// everything survives a server restart without re-deploying from the tool.

function _restoreZoneState(db, state) {
  if (!state || !state.zones) return;

  // Restore NPCs that were previously deployed to a zone
  var deployedNpcs = db.prepare('SELECT * FROM npcs WHERE home_zone IS NOT NULL').all();
  var npcCount = 0;
  for (var npc of deployedNpcs) {
    var zone = state.zones.get(npc.home_zone);
    if (!zone) continue;
    if (!zone.npcs) zone.npcs = [];
    var npcObj = _npcToZone(npc, npc.deploy_x != null ? npc.deploy_x : 5, npc.deploy_y != null ? npc.deploy_y : 5);
    var idx = zone.npcs.findIndex(function(n) { return n.id === npc.npc_id; });
    if (idx >= 0) { zone.npcs[idx] = npcObj; } else { zone.npcs.push(npcObj); }
    npcCount++;
  }
  if (npcCount) console.log('[writing-tool] ✓ Restored ' + npcCount + ' NPC(s) to zones');

  // Restore fixture placed-objects and their dungeon stub zones
  var fixtures = db.prepare(`
    SELECT f.*, q.reward_tier, q.loot_table, q.npc_spawns
    FROM fixtures f
    LEFT JOIN quests q ON f.current_quest_id = q.quest_id
  `).all();
  var fxCount = 0;
  for (var fx of fixtures) {
    var fzone = state.zones.get(fx.zone_id);
    if (!fzone) continue;
    if (!fzone.placedObjects) fzone.placedObjects = [];

    var locType  = db.prepare('SELECT * FROM location_types WHERE type_id=?').get(fx.location_type || 'cave');
    var assetId  = (locType && locType.asset_id) || 'dungeon_entrance';
    var biome    = (locType && locType.dungeon_template) || 'cave';
    var placedObj = {
      id: fx.object_id, type: 'building', assetId: assetId,
      x: fx.x, y: fx.y, w: 2, h: 2,
      enterable: true, targetZoneId: fx.dungeon_zone_id,
      label: fx.name || fx.fixture_id, fixtureId: fx.fixture_id,
    };
    var oidx = fzone.placedObjects.findIndex(function(o) { return o.id === fx.object_id; });
    if (oidx >= 0) { fzone.placedObjects[oidx] = placedObj; } else { fzone.placedObjects.push(placedObj); }

    // Re-create the stub dungeon zone if it was lost
    if (fx.dungeon_zone_id && !state.zones.has(fx.dungeon_zone_id)) {
      state.zones.set(fx.dungeon_zone_id, {
        id: fx.dungeon_zone_id, name: fx.name || fx.fixture_id,
        type: 'dungeon_fixture', biome: biome,
        width: 24, height: 24,
        connections: [{ direction: 'out', targetZoneId: fx.zone_id }],
        placedObjects: [], npcs: [], items: [],
        fixtureId: fx.fixture_id, questId: fx.current_quest_id,
        npcSpawns: JSON.parse(fx.npc_spawns  || '[]'),
        lootTable: JSON.parse(fx.loot_table  || '[]'),
        tier: fx.reward_tier || 1,
      });
    }
    fxCount++;
  }
  if (fxCount) console.log('[writing-tool] ✓ Restored ' + fxCount + ' fixture(s) to zones');

  // Restore authored full towns
  var towns = db.prepare('SELECT * FROM placed_towns').all();
  for (var t of towns) {
    if (!state.zones.has(t.zone_id)) _createTownZone(state, t);
    else {
      // Ensure overworld connection exists (may have been lost on restart)
      var ow = state.zones.get('overworld');
      if (ow && !ow.connections.find(function(c) { return c.targetZone === t.zone_id; })) {
        ow.connections.push({ targetZone: t.zone_id, x: t.wx, y: t.wy, direction: 'enter' });
      }
    }
  }
  if (towns.length) console.log('[writing-tool] ✓ Restored ' + towns.length + ' authored town(s)');
}

// ── Route registration ────────────────────────────────────────────────────────

function registerRoutes(app, io, state) {
  var token = _getToken();
  var db    = _initDb();
  if (!db) return null;
  _db = db;
  _rebuildCache(db);
  _restoreZoneState(db, state);

  var port = process.env.PORT || 3001;
  console.log('[writing-tool] ✏️  Admin URL: http://localhost:' + port + '/' + token + '/writing-tool');
  console.log('[writing-tool]    (replace localhost with your server IP when accessing remotely)');

  var B = '/' + token;
  var HTML = path.join(__dirname, '..', 'tools', 'writing-tool', 'index.html');

  app.get(B + '/writing-tool', function(req, res) { res.sendFile(HTML); });

  // ─── Zones (live state) ─────────────────────────────────────────────────────
  app.get(B + '/api/zones', function(req, res) {
    var zones = [];
    if (state && state.zones) {
      state.zones.forEach(function(z, id) {
        // Skip auto-generated fixture interiors in the zone picker
        if (id.startsWith('dungeon_fixture_')) return;
        zones.push({ id: id, name: z.name || id, type: z.type || 'unknown', biome: z.biome || '' });
      });
    }
    res.json(zones.sort(function(a, b) { return a.name.localeCompare(b.name); }));
  });

  // ─── Zone placed objects (for NPC home/work building selectors) ─────────────
  app.get(B + '/api/zones/:id/objects', function(req, res) {
    var zone = state && state.zones && state.zones.get(req.params.id);
    if (!zone) return res.status(404).json({ error: 'Zone not found' });
    var objects = (zone.placedObjects || []).filter(function(o) { return o.id; });
    res.json(objects.map(function(o) {
      return { id: o.id, label: o.label || o.assetId || o.id, type: o.type || 'building', x: o.x, y: o.y };
    }));
  });

  // ─── Map — zones with world positions ───────────────────────────────────────
  app.get(B + '/api/map/zones', function(req, res) {
    if (!state || !state.zones) return res.json([]);
    // Build position lookup from overworld's connections
    var posMap = {};
    var ow = state.zones.get('overworld');
    if (ow && ow.connections) {
      ow.connections.forEach(function(c) {
        if (c.targetZone && c.x != null && c.y != null) posMap[c.targetZone] = { wx: c.x, wy: c.y };
      });
    }
    var result = [];
    state.zones.forEach(function(z, id) {
      if (id === 'overworld' || id.startsWith('dungeon_fixture_') || id.startsWith('plot_')) return;
      var pos = posMap[id];
      result.push({
        id: id, name: z.name || id, type: z.type || 'unknown',
        wx: pos ? pos.wx : null, wy: pos ? pos.wy : null,
        npcCount: (z.npcs || []).length,
        members: z.members ? z.members.size : 0,
        authoredTownId: z.authoredTownId || null,
      });
    });
    res.json(result);
  });

  // ─── Map — custom POI markers ────────────────────────────────────────────────
  app.get(B + '/api/map/markers', function(req, res) {
    res.json(db.prepare('SELECT * FROM map_markers ORDER BY created_at DESC').all());
  });
  app.post(B + '/api/map/markers', function(req, res) {
    var b = req.body;
    if (!b.label || b.wx == null || b.wy == null) return res.status(400).json({ error: 'label, wx, wy required' });
    var id = 'mk_' + Date.now();
    db.prepare('INSERT INTO map_markers (marker_id, label, type, wx, wy, color, notes, linked_zone_id, linked_npc_id, linked_quest_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, b.label, b.type || 'poi', b.wx, b.wy, b.color || '#f5c542', b.notes || '', b.linked_zone_id || '', b.linked_npc_id || '', b.linked_quest_id || '', Date.now());
    res.json({ ok: true, marker_id: id });
  });
  app.put(B + '/api/map/markers/:id', function(req, res) {
    var b = req.body, id = req.params.id;
    db.prepare('UPDATE map_markers SET label=COALESCE(?,label), type=COALESCE(?,type), wx=COALESCE(?,wx), wy=COALESCE(?,wy), color=COALESCE(?,color), notes=COALESCE(?,notes), linked_zone_id=COALESCE(?,linked_zone_id), linked_npc_id=COALESCE(?,linked_npc_id), linked_quest_id=COALESCE(?,linked_quest_id) WHERE marker_id=?')
      .run(b.label||null, b.type||null, b.wx!=null?b.wx:null, b.wy!=null?b.wy:null, b.color||null, b.notes!=null?b.notes:null, b.linked_zone_id!=null?b.linked_zone_id:null, b.linked_npc_id!=null?b.linked_npc_id:null, b.linked_quest_id!=null?b.linked_quest_id:null, id);
    res.json({ ok: true });
  });
  app.delete(B + '/api/map/markers/:id', function(req, res) {
    db.prepare('DELETE FROM map_markers WHERE marker_id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // ─── Authored towns ──────────────────────────────────────────────────────────
  app.get(B + '/api/towns', function(req, res) {
    res.json(db.prepare('SELECT * FROM placed_towns ORDER BY created_at').all());
  });
  app.post(B + '/api/towns', function(req, res) {
    var b = req.body;
    if (!b.name || b.wx == null || b.wy == null) return res.status(400).json({ error: 'name, wx, wy required' });
    var townId = 'town_' + Date.now();
    var zoneId = 'authored_' + townId;
    var sizes  = { hamlet: [1200, 1000], settlement: [2000, 1600], town: [2000, 1600], city: [2500, 2000], fortress_town: [2200, 1800], trade_outpost: [1400, 1100] };
    var sz = sizes[b.town_type] || [2000, 1600];
    var w  = b.width  || sz[0], h = b.height || sz[1];
    // Overlap detection — minimum 3000 world units between any two placed towns
    var MIN_DIST = 3000;
    var existing = db.prepare('SELECT name, wx, wy FROM placed_towns').all();
    for (var et of existing) {
      if (Math.hypot(et.wx - b.wx, et.wy - b.wy) < MIN_DIST)
        return res.status(409).json({ error: 'Too close to "' + et.name + '" — try a different position (min ' + MIN_DIST + ' world units apart)' });
    }
    // Also check against static anchor towns from overworld connections
    var ow = state && state.zones && state.zones.get('overworld');
    if (ow) {
      for (var oc of (ow.connections || [])) {
        if (oc.direction !== 'enter') continue;
        var oz = state.zones.get(oc.targetZone);
        if (!oz || oz.type !== 'town' || oz.authoredTownId) continue;
        if (Math.hypot(oc.x - b.wx, oc.y - b.wy) < MIN_DIST)
          return res.status(409).json({ error: 'Too close to "' + oz.name + '" (static town) — try a different position' });
      }
    }
    db.prepare('INSERT INTO placed_towns (town_id, zone_id, name, town_type, wx, wy, width, height, biome, description, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(townId, zoneId, b.name, b.town_type || 'settlement', b.wx, b.wy, w, h, b.biome || 'plains', b.description || '', Date.now());
    _createTownZone(state, { town_id: townId, zone_id: zoneId, name: b.name, town_type: b.town_type || 'settlement', wx: b.wx, wy: b.wy, width: w, height: h, biome: b.biome || 'plains' });
    res.json({ ok: true, town_id: townId, zone_id: zoneId });
  });
  app.put(B + '/api/towns/:id', function(req, res) {
    var b = req.body, id = req.params.id;
    db.prepare('UPDATE placed_towns SET name=COALESCE(?,name), description=COALESCE(?,description), biome=COALESCE(?,biome), town_type=COALESCE(?,town_type) WHERE town_id=?')
      .run(b.name || null, b.description != null ? b.description : null, b.biome || null, b.town_type || null, id);
    var town = db.prepare('SELECT * FROM placed_towns WHERE town_id=?').get(id);
    if (town && state.zones.has(town.zone_id)) {
      var z = state.zones.get(town.zone_id);
      if (b.name)  z.name  = b.name;
      if (b.biome) z.biome = b.biome;
    }
    res.json({ ok: true });
  });
  app.delete(B + '/api/towns/:id', function(req, res) {
    var town = db.prepare('SELECT * FROM placed_towns WHERE town_id=?').get(req.params.id);
    if (town) {
      state.zones.delete(town.zone_id);
      var ow = state.zones.get('overworld');
      if (ow) ow.connections = ow.connections.filter(function(c) { return c.targetZone !== town.zone_id; });
      db.prepare('DELETE FROM placed_towns WHERE town_id=?').run(req.params.id);
    }
    res.json({ ok: true });
  });

  // ─── Shards (cross-shard sync targets) ──────────────────────────────────────
  app.get(B + '/api/shards', function(req, res) {
    res.json(db.prepare('SELECT * FROM shard_sync ORDER BY label').all());
  });
  app.post(B + '/api/shards', function(req, res) {
    var b = req.body;
    if (!b.url || !b.token) return res.status(400).json({ error: 'url and token required' });
    var id = b.shard_id || ('shard_' + Date.now());
    db.prepare('INSERT OR REPLACE INTO shard_sync (shard_id, label, url, token, enabled) VALUES (?, ?, ?, ?, ?)')
      .run(id, b.label || id, b.url.replace(/\/$/, ''), b.token, b.enabled !== false ? 1 : 0);
    res.json({ ok: true, shard_id: id });
  });
  app.put(B + '/api/shards/:id', function(req, res) {
    var b = req.body;
    db.prepare('UPDATE shard_sync SET label=?, url=?, token=?, enabled=? WHERE shard_id=?')
      .run(b.label, b.url.replace(/\/$/, ''), b.token, b.enabled ? 1 : 0, req.params.id);
    res.json({ ok: true });
  });
  app.delete(B + '/api/shards/:id', function(req, res) {
    db.prepare('DELETE FROM shard_sync WHERE shard_id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // ─── Internal sync endpoint (called by remote shard, does NOT re-propagate) ──
  app.post(B + '/api/sync/npc', function(req, res) {
    var b = req.body;
    if (!b.npc || !b.npc.npc_id) return res.status(400).json({ error: 'npc with npc_id required' });
    _upsertNpc(db, b.npc.npc_id, b.npc);
    // Reload from DB so JSON includes any generated defaults
    var full = db.prepare('SELECT * FROM npcs WHERE npc_id=?').get(b.npc.npc_id);
    _writeNpcJson(full || b.npc);
    var zone = state && state.zones && state.zones.get(b.zone_id);
    if (!zone) return res.json({ ok: true, skipped: 'zone not found: ' + b.zone_id });
    if (!zone.npcs) zone.npcs = [];
    var dx = b.x || 5, dy = b.y || 5;
    var npcObj = _npcToZone(full || b.npc, dx, dy);
    var idx = zone.npcs.findIndex(function(n) { return n.id === b.npc.npc_id; });
    if (idx >= 0) { zone.npcs[idx] = npcObj; } else { zone.npcs.push(npcObj); }
    db.prepare('UPDATE npcs SET home_zone=?, deploy_x=?, deploy_y=? WHERE npc_id=?').run(b.zone_id, dx, dy, b.npc.npc_id);
    _rebuildCache(db);
    io.to('zone:' + b.zone_id).emit('zone_npc_added', npcObj);
    res.json({ ok: true });
  });

  // Sync: NPC data save (no zone deploy)
  app.post(B + '/api/sync/npc-data', function(req, res) {
    var b = req.body;
    if (!b.npc || !b.npc.npc_id) return res.status(400).json({ error: 'npc.npc_id required' });
    _upsertNpc(db, b.npc.npc_id, b.npc);
    _writeNpcJson(db.prepare('SELECT * FROM npcs WHERE npc_id=?').get(b.npc.npc_id) || b.npc);
    _rebuildCache(db);
    res.json({ ok: true });
  });

  // Sync: Story arc
  app.post(B + '/api/sync/arc', function(req, res) {
    var b = req.body;
    if (!b.arc || !b.arc.arc_id) return res.status(400).json({ error: 'arc.arc_id required' });
    db.prepare('INSERT OR REPLACE INTO quest_arcs (arc_id, name, description, sequence, state, faction, intro_node_id, conclusion_node_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(b.arc.arc_id, b.arc.name || 'Arc', b.arc.description || '', b.arc.sequence || 0,
        b.arc.state || 'unmet', b.arc.faction || null, b.arc.intro_node_id || null, b.arc.conclusion_node_id || null);
    res.json({ ok: true });
  });

  // Sync: Quest data
  app.post(B + '/api/sync/quest', function(req, res) {
    var b = req.body;
    if (!b.quest || !b.quest.quest_id) return res.status(400).json({ error: 'quest.quest_id required' });
    _upsertQuest(db, b.quest.quest_id, b.quest);
    _rebuildCache(db);
    res.json({ ok: true });
  });

  // Sync: Dialogue node
  app.post(B + '/api/sync/dialogue-node', function(req, res) {
    var b = req.body;
    if (!b.node || !b.node.node_id) return res.status(400).json({ error: 'node.node_id required' });
    _upsertNode(db, b.node.node_id, b.node);
    _rebuildCache(db);
    res.json({ ok: true });
  });

  // Sync: Dialogue edge
  app.post(B + '/api/sync/dialogue-edge', function(req, res) {
    var b = req.body;
    if (!b.from_node_id || !b.to_node_id) return res.status(400).json({ error: 'from/to node IDs required' });
    try {
      db.prepare('INSERT OR IGNORE INTO node_connections (from_node_id, to_node_id, choice_label) VALUES (?, ?, ?)')
        .run(b.from_node_id, b.to_node_id, b.choice_label || 'Continue');
    } catch (_) {}
    _rebuildCache(db);
    res.json({ ok: true });
  });

  // Sync: Lore / book
  app.post(B + '/api/sync/lore', function(req, res) {
    var b = req.body;
    if (!b.lore || !b.lore.lore_id) return res.status(400).json({ error: 'lore.lore_id required' });
    _upsertLore(db, b.lore.lore_id, b.lore);
    res.json({ ok: true });
  });

  // Sync: Quest fixture deploy (replicate pre-computed fixture onto remote shard)
  app.post(B + '/api/sync/quest-deploy', function(req, res) {
    var b = req.body;
    if (!b.quest || !b.fixture || !b.zone_id) return res.status(400).json({ error: 'quest, fixture, zone_id required' });
    var zoneId = b.zone_id;
    _upsertQuest(db, b.quest.quest_id, b.quest);
    try {
      db.prepare(`INSERT OR IGNORE INTO fixtures (fixture_id, name, zone_id, x, y, exclusion_radius, tier,
        current_quest_id, available_for_new_quest, location_type, object_id, dungeon_zone_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(b.fixture.fixture_id, b.fixture.name, zoneId, b.fixture.x, b.fixture.y,
        b.fixture.exclusion_radius || 8, b.fixture.tier || 1, b.quest.quest_id, 0,
        b.fixture.location_type, b.fixture.object_id, b.fixture.dungeon_zone_id);
    } catch (_) {}
    var zone = state && state.zones && state.zones.get(zoneId);
    if (zone) {
      if (!zone.placedObjects) zone.placedObjects = [];
      if (!zone.placedObjects.some(function(o) { return o.id === b.fixture.object_id; })) {
        zone.placedObjects.push(b.placed_object);
      }
      if (!state.zones.has(b.fixture.dungeon_zone_id)) {
        var locType = db.prepare('SELECT * FROM location_types WHERE type_id=?').get(b.quest.location_type);
        state.zones.set(b.fixture.dungeon_zone_id, {
          id: b.fixture.dungeon_zone_id, name: b.fixture.name, type: 'dungeon_fixture',
          biome: (locType && locType.dungeon_template) || 'cave',
          width: 24, height: 24,
          connections: [{ direction: 'out', targetZoneId: zoneId }],
          placedObjects: [], npcs: [], items: [],
          fixtureId: b.fixture.fixture_id, questId: b.quest.quest_id,
          npcSpawns: [], lootTable: [], tier: b.fixture.tier || 1,
        });
      }
      if (b.placed_object) io.to('zone:' + zoneId).emit('fixture_spawned', { placedObject: b.placed_object, zoneId: zoneId });
      if (b.marker)       io.to('zone:' + zoneId).emit('quest_marker_added', { marker: b.marker, zoneId: zoneId });
    }
    _rebuildCache(db);
    res.json({ ok: true });
  });

  // ─── Location types ─────────────────────────────────────────────────────────
  app.get(B + '/api/location-types', function(req, res) {
    res.json(db.prepare('SELECT * FROM location_types ORDER BY label').all());
  });
  app.post(B + '/api/location-types', function(req, res) {
    var b = req.body;
    if (!b.type_id || !b.label) return res.status(400).json({ error: 'type_id and label required' });
    db.prepare('INSERT OR REPLACE INTO location_types (type_id, label, dungeon_template, asset_id, icon) VALUES (?, ?, ?, ?, ?)')
      .run(b.type_id, b.label, b.dungeon_template || 'cave', b.asset_id || 'dungeon_entrance', b.icon || '📍');
    res.json({ ok: true });
  });
  app.delete(B + '/api/location-types/:id', function(req, res) {
    db.prepare('DELETE FROM location_types WHERE type_id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // ─── Quest arcs ─────────────────────────────────────────────────────────────
  app.get(B + '/api/arcs', function(req, res) {
    res.json(db.prepare('SELECT * FROM quest_arcs ORDER BY sequence').all());
  });
  app.post(B + '/api/arcs', function(req, res) {
    var b = req.body, id = b.arc_id || ('arc_' + Date.now());
    db.prepare('INSERT OR REPLACE INTO quest_arcs (arc_id, name, description, sequence, state, faction, intro_node_id, conclusion_node_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, b.name || 'New Arc', b.description || '', b.sequence || 0, b.state || 'unmet',
        b.faction || null, b.intro_node_id || null, b.conclusion_node_id || null);
    var full = db.prepare('SELECT * FROM quest_arcs WHERE arc_id=?').get(id);
    _syncToShards(db, '/api/sync/arc', { arc: full || b });
    res.json({ ok: true, arc_id: id });
  });
  app.put(B + '/api/arcs/:id', function(req, res) {
    var b = req.body;
    db.prepare('UPDATE quest_arcs SET name=?, description=?, sequence=?, state=?, faction=?, intro_node_id=?, conclusion_node_id=? WHERE arc_id=?')
      .run(b.name, b.description || '', b.sequence || 0, b.state || 'unmet',
        b.faction || null, b.intro_node_id || null, b.conclusion_node_id || null, req.params.id);
    var full = db.prepare('SELECT * FROM quest_arcs WHERE arc_id=?').get(req.params.id);
    _syncToShards(db, '/api/sync/arc', { arc: full || b });
    res.json({ ok: true });
  });
  app.delete(B + '/api/arcs/:id', function(req, res) {
    db.prepare('DELETE FROM quest_arcs WHERE arc_id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // ─── NPCs ───────────────────────────────────────────────────────────────────
  app.get(B + '/api/npcs', function(req, res) {
    res.json(db.prepare('SELECT * FROM npcs ORDER BY name').all());
  });
  app.post(B + '/api/npcs', function(req, res) {
    var id = req.body.npc_id || ('npc_' + Date.now());
    _upsertNpc(db, id, req.body);
    _rebuildCache(db);
    var full = db.prepare('SELECT * FROM npcs WHERE npc_id=?').get(id);
    _syncToShards(db, '/api/sync/npc-data', { npc: full || req.body });
    res.json({ ok: true, npc_id: id });
  });
  app.put(B + '/api/npcs/:id', function(req, res) {
    _upsertNpc(db, req.params.id, req.body);
    _rebuildCache(db);
    var full = db.prepare('SELECT * FROM npcs WHERE npc_id=?').get(req.params.id);
    _syncToShards(db, '/api/sync/npc-data', { npc: full || req.body });
    res.json({ ok: true });
  });
  app.delete(B + '/api/npcs/:id', function(req, res) {
    db.prepare('DELETE FROM npcs WHERE npc_id=?').run(req.params.id);
    _rebuildCache(db);
    res.json({ ok: true });
  });

  // Deploy NPC to live zone
  app.post(B + '/api/deploy/npc', function(req, res) {
    var { npc_id, zone_id, x, y } = req.body;
    var npc = db.prepare('SELECT * FROM npcs WHERE npc_id=?').get(npc_id);
    if (!npc) return res.status(404).json({ error: 'NPC not found' });
    var zone = state && state.zones && state.zones.get(zone_id);
    if (!zone) return res.status(404).json({ error: 'Zone not found: ' + zone_id });
    if (!zone.npcs) zone.npcs = [];
    var dx = x || 5, dy = y || 5;
    var npcObj = _npcToZone(npc, dx, dy);
    var idx = zone.npcs.findIndex(function(n) { return n.id === npc_id; });
    if (idx >= 0) { zone.npcs[idx] = npcObj; } else { zone.npcs.push(npcObj); }
    // Persist deployment so the NPC survives server restarts
    db.prepare('UPDATE npcs SET home_zone=?, deploy_x=?, deploy_y=? WHERE npc_id=?').run(zone_id, dx, dy, npc_id);
    var fullNpc = db.prepare('SELECT * FROM npcs WHERE npc_id=?').get(npc_id);
    _writeNpcJson(fullNpc || npc);
    io.to('zone:' + zone_id).emit('zone_npc_added', npcObj);
    // Propagate to all enabled remote shards
    _syncToShards(db, '/api/sync/npc', { npc: fullNpc || npc, zone_id: zone_id, x: dx, y: dy });
    res.json({ ok: true, npc: npcObj });
  });

  // ─── Dialogue nodes ─────────────────────────────────────────────────────────
  app.get(B + '/api/dialogue/:npcId', function(req, res) {
    var nodes = db.prepare('SELECT * FROM dialogue_nodes WHERE npc_id=? ORDER BY graph_y, graph_x').all(req.params.npcId);
    var nodeIds = nodes.map(function(n) { return n.node_id; });
    var edges = nodeIds.length
      ? db.prepare('SELECT * FROM node_connections WHERE from_node_id IN (' + nodeIds.map(function() { return '?'; }).join(',') + ')').all(nodeIds)
      : [];
    res.json({ nodes: nodes, edges: edges });
  });
  app.post(B + '/api/dialogue', function(req, res) {
    var id = req.body.node_id || ('node_' + Date.now());
    _upsertNode(db, id, req.body);
    _rebuildCache(db);
    _syncToShards(db, '/api/sync/dialogue-node', { node: db.prepare('SELECT * FROM dialogue_nodes WHERE node_id=?').get(id) || req.body });
    res.json({ ok: true, node_id: id });
  });
  app.put(B + '/api/dialogue/:id', function(req, res) {
    _upsertNode(db, req.params.id, req.body);
    _rebuildCache(db);
    _syncToShards(db, '/api/sync/dialogue-node', { node: db.prepare('SELECT * FROM dialogue_nodes WHERE node_id=?').get(req.params.id) || req.body });
    res.json({ ok: true });
  });
  app.delete(B + '/api/dialogue/:id', function(req, res) {
    db.prepare('DELETE FROM dialogue_nodes WHERE node_id=?').run(req.params.id);
    db.prepare('DELETE FROM node_connections WHERE from_node_id=? OR to_node_id=?').run(req.params.id, req.params.id);
    _rebuildCache(db);
    res.json({ ok: true });
  });
  app.post(B + '/api/dialogue/edge', function(req, res) {
    var { from_node_id, to_node_id, choice_label } = req.body;
    try { db.prepare('INSERT OR IGNORE INTO node_connections (from_node_id, to_node_id, choice_label) VALUES (?, ?, ?)').run(from_node_id, to_node_id, choice_label || 'Continue'); }
    catch (_) {}
    _rebuildCache(db);
    _syncToShards(db, '/api/sync/dialogue-edge', { from_node_id: from_node_id, to_node_id: to_node_id, choice_label: choice_label || 'Continue' });
    res.json({ ok: true });
  });
  app.delete(B + '/api/dialogue/edge', function(req, res) {
    db.prepare('DELETE FROM node_connections WHERE from_node_id=? AND to_node_id=?').run(req.body.from_node_id, req.body.to_node_id);
    _rebuildCache(db);
    res.json({ ok: true });
  });

  // ─── Quests ─────────────────────────────────────────────────────────────────
  app.get(B + '/api/quests', function(req, res) {
    res.json(db.prepare('SELECT * FROM quests ORDER BY story_type, arc_id, arc_sequence, created_at').all());
  });
  app.post(B + '/api/quests', function(req, res) {
    var id = req.body.quest_id || ('quest_' + Date.now());
    _upsertQuest(db, id, req.body);
    _rebuildCache(db);
    _syncToShards(db, '/api/sync/quest', { quest: db.prepare('SELECT * FROM quests WHERE quest_id=?').get(id) || req.body });
    res.json({ ok: true, quest_id: id });
  });
  app.put(B + '/api/quests/:id', function(req, res) {
    _upsertQuest(db, req.params.id, req.body);
    _rebuildCache(db);
    _syncToShards(db, '/api/sync/quest', { quest: db.prepare('SELECT * FROM quests WHERE quest_id=?').get(req.params.id) || req.body });
    res.json({ ok: true });
  });
  app.delete(B + '/api/quests/:id', function(req, res) {
    db.prepare('DELETE FROM quests WHERE quest_id=?').run(req.params.id);
    _rebuildCache(db);
    res.json({ ok: true });
  });

  // Deploy quest → spawn fixture + map marker
  app.post(B + '/api/deploy/quest', function(req, res) {
    var { quest_id, zone_id, x, y } = req.body;
    var quest = db.prepare('SELECT * FROM quests WHERE quest_id=?').get(quest_id);
    if (!quest) return res.status(404).json({ error: 'Quest not found' });
    var zone = state && state.zones && state.zones.get(zone_id);
    if (!zone) return res.status(404).json({ error: 'Zone not found: ' + zone_id });

    // Overlap detection (8-tile exclusion radius)
    var existing = db.prepare('SELECT * FROM fixtures WHERE zone_id=?').all(zone_id);
    var EXCL = 8;
    var px = typeof x === 'number' ? x : Math.floor((zone.width || 30) * (0.15 + Math.random() * 0.7));
    var py = typeof y === 'number' ? y : Math.floor((zone.height || 30) * (0.15 + Math.random() * 0.7));
    for (var fx of existing) {
      if (Math.hypot(fx.x - px, fx.y - py) < EXCL) {
        return res.status(409).json({ error: 'Too close to "' + (fx.name || fx.fixture_id) + '" — try a different position' });
      }
    }

    var locType       = db.prepare('SELECT * FROM location_types WHERE type_id=?').get(quest.location_type);
    var fixtureId     = 'fixture_' + Date.now();
    var objectId      = 'obj_' + fixtureId;
    var dungeonZoneId = 'dungeon_' + fixtureId;
    var label         = quest.map_marker_label || quest.name;
    var biome         = (locType && locType.dungeon_template) || 'cave';
    var assetId       = (locType && locType.asset_id) || 'dungeon_entrance';

    // Save fixture to DB
    db.prepare(`INSERT INTO fixtures (fixture_id, name, zone_id, x, y, exclusion_radius, tier,
      current_quest_id, available_for_new_quest, location_type, object_id, dungeon_zone_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(fixtureId, label, zone_id, px, py, EXCL, quest.reward_tier || 1,
      quest_id, 0, quest.location_type, objectId, dungeonZoneId);

    // Update quest record
    db.prepare('UPDATE quests SET fixture_id=?, target_zone_id=?, state=? WHERE quest_id=?')
      .run(fixtureId, zone_id, 'offered', quest_id);

    // Inject placed object into live zone
    if (!zone.placedObjects) zone.placedObjects = [];
    var placedObj = {
      id: objectId, type: 'building', assetId: assetId,
      x: px, y: py, w: 2, h: 2,
      enterable: true, targetZoneId: dungeonZoneId,
      label: label, fixtureId: fixtureId,
    };
    zone.placedObjects.push(placedObj);

    // Create stub dungeon fixture zone
    state.zones.set(dungeonZoneId, {
      id: dungeonZoneId, name: label, type: 'dungeon_fixture', biome: biome,
      width: 24, height: 24,
      connections: [{ direction: 'out', targetZoneId: zone_id }],
      placedObjects: [], npcs: [], items: [],
      fixtureId: fixtureId, questId: quest_id,
      npcSpawns:  JSON.parse(quest.npc_spawns  || '[]'),
      lootTable:  JSON.parse(quest.loot_table  || '[]'),
      tier: quest.reward_tier || 1,
    });

    _rebuildCache(db);

    // Build map marker
    var marker = {
      questId: quest_id, label: label,
      x: px, y: py, tier: quest.reward_tier || 1,
      type: quest.type, fixtureId: fixtureId, dungeonZoneId: dungeonZoneId,
    };

    // Broadcast: new placed object + quest map marker
    io.to('zone:' + zone_id).emit('fixture_spawned', { placedObject: placedObj, zoneId: zone_id });
    io.to('zone:' + zone_id).emit('quest_marker_added', { marker: marker, zoneId: zone_id });

    // Propagate fixture deploy to all enabled remote shards
    var updatedQuest = db.prepare('SELECT * FROM quests WHERE quest_id=?').get(quest_id);
    _syncToShards(db, '/api/sync/quest-deploy', {
      quest:        updatedQuest || quest,
      fixture:      { fixture_id: fixtureId, name: label, x: px, y: py, exclusion_radius: EXCL,
                      tier: quest.reward_tier || 1, object_id: objectId, dungeon_zone_id: dungeonZoneId,
                      location_type: quest.location_type },
      zone_id:      zone_id,
      placed_object: placedObj,
      marker:        marker,
    });

    res.json({ ok: true, fixture_id: fixtureId, placed_object: placedObj, dungeon_zone_id: dungeonZoneId, marker: marker });
  });

  // ─── Lore ───────────────────────────────────────────────────────────────────
  app.get(B + '/api/lore', function(req, res) {
    res.json(db.prepare('SELECT * FROM lore ORDER BY is_book DESC, created_at DESC').all());
  });
  app.post(B + '/api/lore', function(req, res) {
    var id = req.body.lore_id || ('lore_' + Date.now());
    _upsertLore(db, id, req.body);
    _syncToShards(db, '/api/sync/lore', { lore: db.prepare('SELECT * FROM lore WHERE lore_id=?').get(id) || req.body });
    res.json({ ok: true, lore_id: id });
  });
  app.put(B + '/api/lore/:id', function(req, res) {
    _upsertLore(db, req.params.id, req.body);
    _syncToShards(db, '/api/sync/lore', { lore: db.prepare('SELECT * FROM lore WHERE lore_id=?').get(req.params.id) || req.body });
    res.json({ ok: true });
  });
  app.delete(B + '/api/lore/:id', function(req, res) {
    db.prepare('DELETE FROM lore WHERE lore_id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // ─── Fixtures ───────────────────────────────────────────────────────────────
  app.get(B + '/api/fixtures', function(req, res) {
    res.json(db.prepare('SELECT * FROM fixtures ORDER BY zone_id, created_at DESC').all());
  });
  app.put(B + '/api/fixtures/:id', function(req, res) {
    var b = req.body;
    db.prepare('UPDATE fixtures SET name=?, faction_owner=?, reputation_tag=?, tier=?, available_for_new_quest=?, history=? WHERE fixture_id=?')
      .run(b.name, b.faction_owner || null, b.reputation_tag || null, b.tier || 1,
        b.available_for_new_quest ? 1 : 0, _j(b.history), req.params.id);
    _rebuildCache(db);
    res.json({ ok: true });
  });
  app.delete(B + '/api/fixtures/:id', function(req, res) {
    db.prepare('DELETE FROM fixtures WHERE fixture_id=?').run(req.params.id);
    _rebuildCache(db);
    res.json({ ok: true });
  });

  // ─── Portrait asset list (for NPC portrait picker in writing tool) ──────────
  app.use(B + '/portraits', require('express').static(
    path.join(__dirname, '..', 'client', 'assets', 'icons', 'portraits')
  ));
  app.get(B + '/api/portraits', function(req, res) {
    var dir = path.join(__dirname, '..', 'client', 'assets', 'icons', 'portraits');
    var result = [];
    try {
      var cats = fs.readdirSync(dir);
      for (var cat of cats) {
        var catPath = path.join(dir, cat);
        try {
          var stat = fs.statSync(catPath);
          if (!stat.isDirectory()) continue;
          var files = fs.readdirSync(catPath).filter(function(f) {
            return /\.(png|PNG|jpg|JPG)$/.test(f);
          });
          for (var f of files) {
            result.push({ category: cat, name: f.replace(/\.[^.]+$/, ''), path: cat + '/' + f });
          }
        } catch (_) {}
      }
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    res.json(result);
  });

  // Quest markers for a zone (used by client on zone_enter)
  app.get(B + '/api/quest-markers/:zoneId', function(req, res) {
    res.json(getQuestMarkersForZone(req.params.zoneId));
  });

  return token;
}

module.exports = { registerRoutes, getAuthoredDialogue, getQuestMarkersForZone, getLinkedQuestsForNpc, getQuestById, updateDialogueNodeState, appendFixtureHistory };
