-- scenes/game.lua
-- Main game scene: zone rendering, player movement, chat, resources, skills

local net = require("lib.net")
local combatUI = require("scenes.combat-ui")
local combatAnim = require("scenes.combat-anim")
local gridInv = require("scenes.grid-inventory")
local lighting = require("lib.lighting")
local dungeonParticles = require("lib.particles")
local keystore = require("lib.keystore")

local game = {}

-- Stash audio/assets on game table to avoid adding upvalues to setupListeners
-- (Lua 5.1 limit: 60 upvalues per function)
game._audio = require("lib.audio")
game._assets = require("lib.assets")

local handlerModules = {
    -- Phase B: pure (client, game) only
    require("scenes.game-handlers.karma-factions"),
    require("scenes.game-handlers.companions"),
    require("scenes.game-handlers.pets"),
    require("scenes.game-handlers.ascension"),
    require("scenes.game-handlers.guild"),
    require("scenes.game-handlers.minigame"),
    require("scenes.game-handlers.npc-dialogue"),
    require("scenes.game-handlers.environment"),
    require("scenes.game-handlers.director"),
    -- Phase C1: simple ctx
    require("scenes.game-handlers.admin"),
    require("scenes.game-handlers.portal"),
    require("scenes.game-handlers.jail"),
    require("scenes.game-handlers.quest"),
    require("scenes.game-handlers.doom"),
    require("scenes.game-handlers.patrol"),
    require("scenes.game-handlers.base-raid"),
    -- Phase C2: mmoInventory/account ctx
    require("scenes.game-handlers.bank"),
    require("scenes.game-handlers.npc-shop"),
    require("scenes.game-handlers.auction"),
    require("scenes.game-handlers.trade"),
    require("scenes.game-handlers.cure"),
    require("scenes.game-handlers.npc-action"),
    require("scenes.game-handlers.crafting-advanced"),
    -- Phase C3: complex ctx
    require("scenes.game-handlers.cards"),
    require("scenes.game-handlers.equipment"),
    require("scenes.game-handlers.knowledge"),
    require("scenes.game-handlers.mastery"),
    require("scenes.game-handlers.farming"),
    require("scenes.game-handlers.monster"),
    require("scenes.game-handlers.vip"),
}

local cardsDrawModule     = require("scenes.game-draw.cards")
local panelsDrawModule    = require("scenes.game-draw.panels")
local dungeonDrawModule   = require("scenes.game-draw.dungeon")
local socialDrawModule    = require("scenes.game-draw.social")
local inventoryDrawModule = require("scenes.game-draw.inventory")
local worldDrawModule     = require("scenes.game-draw.world")
local gameInputModule     = require("scenes.game-input")

-- Single source of truth for all client:on() event names registered by this scene.
-- Both setupListeners() and unload() reference this list to prevent cleanup drift.
local INLINE_EVENTS = {
    "zone_state", "player_entered_zone", "player_left_zone", "player_moved",
    "zone_move_corrected", "zone_message", "zone_positions", "world_time",
    "server_stats", "account_created", "chips_updated", "harvest_result",
    "harvest_error", "resource_depleted", "resource_destroyed", "inventory_updated",
    "craft_result", "craft_error", "recipes_list", "object_placed",
    "object_removed", "place_result", "chunk_data", "plot_claimed",
    "plot_unclaimed", "claim_plot_result", "unclaim_plot_result", "disconnect",
    "rpg_stats", "stat_updated", "stat_error", "dungeon_floor_state",
    "dungeon_player_moved", "dungeon_chest_result", "dungeon_trap_triggered", "dungeon_npc_result",
    "dungeon_corpse_examined", "dungeon_corpse_result", "dungeon_camp_placed", "dungeon_camp_result",
    "dungeon_camp_ambush", "dungeon_guild_result", "dungeon_quest_list_result", "dungeon_quest_complete_result",
    "dungeon_quest_completed", "dungeon_leaderboard_result", "dungeon_enemy_updated", "dungeon_player_died",
    "dungeon_combat_state", "dungeon_error", "cave_is_dungeon", "dungeon_enemies_update",
    "dungeon_enemy_attack", "dungeon_enemy_attack_visual", "dungeon_enemy_heal", "dungeon_boss_phase",
    "dungeon_notification", "dungeon_ambush", "dungeon_mana_update", "dungeon_heal",
    "dungeon_form_interact_result", "dungeon_animal_interact_result", "dungeon_warning", "dungeon_combat_use_card_result",
    "dungeon_visibility_update", "dungeon_torch_active", "dungeon_lantern_active", "dungeon_torch_placed",
    "dungeon_chat_message", "dungeon_vision_changed", "dungeon_harvest_result", "dungeon_trap_detected",
    "dungeon_wall_shift", "dungeon_shortcut_found", "loot_dropped", "player_downed", "player_downed_notification",
    "player_revived", "permadeath_triggered", "hall_of_heroes_result", "tc_combat_start",
    "tc_combat_turn", "tc_combat_end", "tc_combat_initiative", "tc_combat_reaction",
    "tc_combat_reaction_result", "tc_combat_error", "tc_combat_join_offer", "connection_added",
    "connection_removed", "zone_kicked", "zone_error", "raid_state_update",
    "raid_boss_ready", "raid_boss_hp", "raid_boss_wipe", "raid_boss_mechanic",
    "party_created", "party_updated", "party_disbanded", "party_invite_received",
    "party_message", "party_error", "party_left", "party_invite_sent",
    "party_kicked", "leviathan_positions", "leviathan_warning", "leviathan_aggro",
    "leviathan_combat_start", "leviathan_part_destroyed", "leviathan_phase_change", "leviathan_enrage",
    "leviathan_flee_success", "leviathan_flee_failed", "leviathan_info_result", "biome_weather",
    "town_rumors", "town_rep_update", "cave_enter_error", "zone_animal_interact_result",
    "bonus_drop", "item_broken", "durability_warning", "batch_move",
    "corruption_update", "corruption_damage", "town_under_attack", "raid_gathering_update",
    "raid_joined", "raid_activated", "raid_cancelled", "raid_warning",
    "raid_boss_phase", "raid_boss_engage", "raid_complete", "corruption_cleanse_result",
    "corruption_card_cleanse_result", "tc_boss_phase_change", "tc_units_spawned", "tc_corruption_zones",
    "tc_boss_soul_harvest", "tc_boss_attack", "unclaim_plot_confirm", "rift_spawned",
    "rift_destroyed", "rift_sealed_rewards", "dungeon_quest_update", "season_visual_update",
    "grid_state", "grid_update", "grid_reject", "grid_item_added",
    "affliction_status", "npc_interact_result", "wild_encounter_result", "placed_objects",
    "portal_crafted", "portal_destroyed", "pin_setup_required",
    "account_snapshot", "sync_import_result",
    "dungeon_mode_update", "dungeon_turn_start", "dungeon_turn_result", "dungeon_turn_update",
    "interact_result", "door_toggled",
    "rate_warning", "rate_cooldown",
}

-- Build SCENE_EVENTS dynamically from inline + handler modules
local SCENE_EVENTS = {}
for _, evt in ipairs(INLINE_EVENTS) do
    SCENE_EVENTS[#SCENE_EVENTS + 1] = evt
end
for _, mod in ipairs(handlerModules) do
    if mod.EVENTS then
        for _, evt in ipairs(mod.EVENTS) do
            SCENE_EVENTS[#SCENE_EVENTS + 1] = evt
        end
    end
end

-- Wipe a table in-place so existing references stay valid
local function wipeTable(t)
    for k in pairs(t) do t[k] = nil end
end

-- Debug logger: writes to file so we can diagnose issues in fused exe (no console)
local _debugLines = {}
function game.debugLog(msg)
    local line = os.date("%H:%M:%S") .. " " .. tostring(msg)
    print("[dbg] " .. line)
    table.insert(_debugLines, line)
    if #_debugLines > 100 then table.remove(_debugLines, 1) end
    -- Append to log file via love.filesystem (works in fused exe)
    pcall(function()
        love.filesystem.append("debug.log", line .. "\n")
    end)
end
local debugLog = game.debugLog

local fonts = {}
local fadeIn = 0
local client = nil
local identity = nil

-- Camera
local camera = { x = 0, y = 0 }

-- Current zone
local zone = nil         -- full zone state from server
local players = {}       -- id -> { name, color, x, y, facing, tag, avatar }
local myId = nil

-- Player movement
local MOVE_SPEED = 200       -- pixels per second (default for towns/buildings)
local OVERWORLD_SPEED = 200  -- overworld walk speed (from server) — 4x bump
local LOCAL_SPEED = 200      -- town/building walk speed
local TILE_SIZE = 32
local moveTimer = 0
local MOVE_SEND_RATE = 1/8  -- send position 8 times per second (reduced for scalability)

-- Sprint & Stamina
-- These are static constants pending stamina-v2 server integration.
-- When stamina becomes server-authoritative, these will be replaced by
-- values pushed from the server (cooking skill, cards/perks, race traits,
-- equipment, Vigor/Finesse stat scaling).
-- Sprint & Stamina state (grouped to reduce upvalues)
local sprint = {
    MULTIPLIER = 2.0,
    EXHAUSTED_MULT = 0.25,
    MAX = 100,
    DRAIN = 12,
    REST_REGEN = 3,
    WALK_REGEN = 0.5,
    FOOD_RESTORE = 40,
    stamina = 100,
    isSprinting = false,
    isExhausted = false,
    restTimer = 0,
}

-- Terrain border thickness
local TERRAIN_BORDER = 48

-- Chat
-- Chat state (grouped to reduce upvalues)
local chat = {
    messages = {},
    input = "",
    active = false,
    scrollY = 0,
    maxDisplay = 12,
}

-- Helper: insert a system chat message with RGB color table {r,g,b} (0-1 range)
function game.addChatMessage(text, rgbColor)
    local hex = "#CCCCCC"
    if rgbColor then
        hex = string.format("#%02X%02X%02X",
            math.floor((rgbColor[1] or 0.8) * 255 + 0.5),
            math.floor((rgbColor[2] or 0.8) * 255 + 0.5),
            math.floor((rgbColor[3] or 0.8) * 255 + 0.5))
    end
    table.insert(chat.messages, {
        authorName = "System",
        authorColor = hex,
        content = text or "",
        isSystem = true,
        _localTime = love.timer.getTime(),
    })
    while #chat.messages > 50 do table.remove(chat.messages, 1) end
end
local addChatMessage = game.addChatMessage

-- Resources
local resources = {}     -- list from server zone state
local hoverResource = nil

-- Zone connections
local connections = {}

-- UI state (grouped to reduce upvalues)
local ui = {
    showZoneList = false,
    showInventory = false,
    showCharSheet = false,
    showCardCollection = false,
    showWorldMap = false,
    showDungeonQuests = false,
    showLeaderboard = false,
    showPartyPanel = false,
    inventoryTab = "resources",   -- "resources", "items", "crafting"
    craftingFilter = "basic",     -- "basic", "forge", "anvil"
    cardScrollY = 0,
    cardFilter = "all",           -- "all", "equipped", "stat_boost", "passive", "active_ability"
    cardSort = "rarity",          -- "rarity", "name", "type"
    selectedCard = nil,           -- card instance for detail view
    cardTab = "collection",       -- "collection", "vendor", "loadouts"
    placementMode = false,
    placementType = nil,
    placementItemId = nil,
    -- Knowledge panel state
    showKnowledge = false,
    -- Equipment panel state (B1)
    showEquipment = false,
    -- Farming panel state
    showFarming = false,
    farmingTab = "crops",  -- "crops", "animals", "build"
    farmCrops = {},        -- crops from server
    farmAnimals = {},      -- animals from server
    farmingPlotId = nil,   -- selected crop plot for planting
    farmingScroll = 0,
    -- Base game._raid state
    baseRaidAlert = nil,   -- { plotZoneId, message, alertDuration, receivedAt }
    baseRaidWaves = {},    -- game._raid wave data
    baseRaidEnded = nil,   -- { result, message, rewards }
    equipmentScroll = 0,
    -- Items tab filter (B2)
    inventoryItemFilter = "all",   -- "all", "equipment", "consumable", "material"
    -- Right-click context menu state
    contextMenu = nil,            -- nil when hidden; table { x, y, targetId, targetName, items, hoverIndex }
    -- Mastery tree panel
    showMastery = false,
    showGridInventory = false,
    -- New panels
    showCompanions = false,
    showPets = false,
    showGuild = false,
    showAscension = false,
    showJail = false,
    showAudioSettings = false,
    showVip = false,
    showRumors = false,
    showEnvironment = false,
}

-- Knowledge panel state (cached data from server)
local knowledge = {
    tab = "glossary",      -- "glossary", "lore", "books", "codex"
    scrollY = 0,
    glossaryTerms = nil,
    glossaryUnlocked = {},
    glossaryFilter = "all",
    glossarySearch = "",
    loreData = nil,
    loreSubTab = "timeline",  -- "timeline", "races", "factions", "geography"
    books = nil,
    bookContent = nil,       -- currently reading book content
    bookFilter = "all",
    codex = nil,
    notifications = {},      -- recent book/term discoveries
    notificationTimer = 0,
}

-- Mastery tree panel state (cached data from server)
local mastery = {
    skillName = nil,    -- currently viewed skill
    tree = nil,         -- array of node objects from server
    invested = {},      -- { nodeId = rank }
    points = 0,         -- unspent points for this skill
    skillLevel = 1,
    hoverNode = nil,    -- node currently hovered
    message = nil,      -- feedback message
    messageTimer = 0,
}

-- Karma / faction HUD state (on game table to reduce upvalues)
game._karma = {
    karma = 0,
    activeBounty = nil,
    isGuardHostile = false,
    factions = {},           -- {factionId = {name, points, level, levelName, discount}}
    factionList = {},        -- [{id, name, homeZone, raceBonus}]
    bounties = {},           -- [{username, amount, reason}]
    showFactions = false,
    showBounties = false,
    message = nil,
    messageTimer = 0,
}

-- Companion panel state (on game table to reduce upvalues)
game._companions = {
    companions = {},         -- [{id, class, name, level, hp, maxHp, dailyWage, baseDmg}]
    selectedId = nil,
    scroll = 0,
    message = nil,
    messageTimer = 0,
    hireClass = nil,         -- class being hired
}

-- Pet panel state (on game table to reduce upvalues)
game._pets = {
    pets = {},               -- [{id, type, name, level, stage, hunger, happiness, speed}]
    selectedId = nil,
    activePetId = nil,
    scroll = 0,
    message = nil,
    messageTimer = 0,
}

-- Jail panel state (on game table to reduce upvalues)
game._jail = {
    inJail = false,
    crime = nil,
    crimeLabel = nil,
    remainingMs = 0,
    bail = 0,
    jailZoneId = nil,
    lastUpdate = 0,
    message = nil,
    messageTimer = 0,
}

-- Ascension panel state (on game table to reduce upvalues)
game._ascension = {
    canAscend = false,
    ascensionCount = 0,
    ascensionPoints = 0,
    ascensionTree = {},      -- {nodeId = rank}
    tree = nil,              -- ASCENSION_TREE from server
    hoverNode = nil,
    message = nil,
    messageTimer = 0,
}

-- VIP & Sovereign Shop state
game._vip = {
    tier = "free",
    expiresAt = 0,
    sovereignBalance = 0,
    tokenInventory = 0,
    permanentPurchases = {},
    perks = {},
    shopItems = {},
    tab = "status",
    shopCategoryFilter = "all",
    shopScroll = 0,
    _shopBuyBtns = {},
    message = nil,
    messageTimer = 0,
}

-- Rumors log (persists within session; populated from town_rumors server events)
game._rumors = {
    list   = {},   -- [{text, zone, time}]
    scroll = 0,
}

-- Guild panel state (on game table to reduce upvalues)
game._guild = {
    guildId = nil,
    guildName = nil,
    members = {},            -- [{name, role}]
    guildList = {},          -- [{id, name, leaderName, memberCount, maxMembers, description}]
    messages = {},           -- [{authorName, content, timestamp}]
    vault = nil,             -- {cards, resources}
    tab = "info",            -- "info", "members", "chat", "vault", "browse"
    scroll = 0,
    chatScroll = 0,
    chatInput = "",
    chatActive = false,
    createName = "",
    createDesc = "",
    createActive = false,
    message = nil,
    messageTimer = 0,
}

-- Crafting minigame state (on game table to reduce upvalues)
game._minigame = {
    active = false,
    recipeId = nil,
    duration = 0,
    windowStart = 0,         -- sweet spot range (0-1000)
    windowEnd = 0,
    expiresAt = 0,
    barPos = 0,              -- moving bar position (0-1000)
    barDir = 1,              -- 1 = right, -1 = left
    startedAt = 0,
    result = nil,            -- nil, "perfect", "good", "miss"
    resultTimer = 0,
}

-- Notification/warning state
game._notifications = {}     -- [{text, color, timer, maxTimer}]
game.NOTIFICATION_DURATION = 4.0
local NOTIFICATION_DURATION = game.NOTIFICATION_DURATION

-- Patrol units visible on overworld
game._patrolUnits = {}       -- {id -> {x, y, name, members}}

-- Combat ability bar state
game._abilityBar = {
    abilities = {},          -- [{name, manaCost, cooldown, maxCooldown, cardId, index}]
    hoverIndex = nil,
}

-- Context menu item definitions (label + action key)
local CONTEXT_MENU_ITEMS_BASE = {
    { label = "Add Friend",      action = "friend" },
    { label = "Invite to Party", action = "party" },
    { label = "Trade",           action = "game._trade" },
    { label = "Duel (PvP)",      action = "duel" },
    { label = "View Profile",    action = "profile" },
    { label = "Whisper",         action = "whisper" },
}

local CONTEXT_MENU_ITEM_HEIGHT = 28
local CONTEXT_MENU_WIDTH = 160
local CONTEXT_MENU_HEADER_HEIGHT = 26
local CONTEXT_MENU_PADDING = 4

local zoneList = {}
local hoverConnection = nil

-- World
local world = { timeOfDay = "day", weather = "clear", seasonVisual = nil }

-- Account info
local account = nil

-- Skills (from account)
local skills = {}

-- Floating text feedback
local floatingTexts = {}  -- { text, x, y, color, timer }
local MAX_FLOATING_TEXTS = 50

function game.addFloatingText(entry)
    if #floatingTexts >= MAX_FLOATING_TEXTS then
        table.remove(floatingTexts, 1)
    end
    table.insert(floatingTexts, entry)
end
local addFloatingText = game.addFloatingText

-- MMO Inventory
local mmoInventory = { wood = 0, stone = 0, iron_ore = 0, iron_bar = 0, items = {} }
local equipment = { axe = nil, pickaxe = nil }

local recipes = {}

-- Equipment/durability state for equipment panel (B1)
local durabilityData = {}         -- slot -> { current, max }
-- equipSlotButtons, inventoryItemButtons, craftingButtons live in inventory_draw module

local placedObjects = {}  -- from server
local miniRifts = {}      -- riftId -> rift data from server (mini-rifts on overworld)
local riftDestroyVfx = {} -- { worldX, worldY, timer, maxTimer } for destruction implosion
local riftRewardPopup = nil -- { rewards, timer, maxTimer } for sealed-rift reward overlay

-- Procedural item UI state (stored on game table to avoid upvalue overflow)
game._itemUI = {
    hoveredItem = nil,
    hoveredItemX = 0,
    hoveredItemY = 0,
    lootNotifications = {},
    maxLootNotifs = 5,
    weaponSpecialCharge = 0,
    weaponSpecialMax = 100,
    weaponSpecialName = nil,
    inscriptionSlots = {},
    RARITY_COLORS = {
        common = {0.53, 0.53, 0.53},
        uncommon = {0.13, 0.8, 0.13},
        rare = {0.2, 0.53, 1},
        ultra_rare = {0.67, 0.27, 1},
        mythic_rare = {1, 0.67, 0},
        legendary = {1, 0.4, 0},
        godly = {1, 0, 0},
        relic = {1, 1, 1},
    },
    QUALITY_COLORS = {
        crude = {0.5, 0.4, 0.3},
        common = {0.6, 0.6, 0.6},
        fine = {0.3, 0.7, 0.3},
        superior = {0.3, 0.5, 0.9},
        exquisite = {0.7, 0.3, 0.9},
        masterwork = {1, 0.75, 0.2},
        legendary = {1, 0.5, 0.1},
    },
}

-- Overworld / chunk state (grouped to reduce upvalues)
local overworld = {
    chunks = {},            -- cached chunk data: chunks["cx,cy"] = chunk
    currentBiome = nil,     -- current biome name string
    chunkBased = false,     -- true if zone uses chunk system
    chunkSize = 512,        -- pixels per chunk (from server)
    biomeColors = {},       -- biome id -> {r, g, b}
    biomeNames = {},        -- biome id -> name string
    biomeSpeeds = {},       -- biome id -> speed multiplier (0-1)
    lastChunkX = nil,       -- last chunk X we were in
    lastChunkY = nil,       -- last chunk Y we were in
    plots = {},             -- plot data from chunks/events
    myPlotId = nil,         -- this player's plot ID (from identity)
    featureColors = {},     -- feature type -> {r, g, b}
    featureSpeeds = {},     -- feature type -> speed multiplier (-1 = biome speed)
    hoverCave = nil,        -- cave entrance we're near
    hoverRift = nil,        -- mini-rift we're near (for E interaction)
    rivers = {},            -- river definitions for world map rendering
    riverAnimTimer = 0,     -- animation timer for river flow
    isHollowEarth = false,  -- true when in Hollow Earth zone
    chunkCanvases = {},     -- cached Canvas per chunk key for ground rendering
}

-- Dungeon state (grouped to reduce upvalues)
local dungeon = {
    inDungeon = false,
    id = nil,               -- 'rift' or 'cave_X_Y'
    floor = nil,            -- floor state from server
    floorNum = 0,
    grid = nil,             -- 2D array [y][x] of tile types
    fog = {},               -- legacy fog (kept for compat)
    fogState = {},          -- three-state fog: fogState[idx] = 0(UNSEEN), 1(REMEMBERED), 2(VISIBLE)
    fogWidth = 0,           -- grid width for index computation
    enemies = {},           -- enemies on current floor (server-filtered by visibility)
    chests = {},            -- chests on current floor
    traps = {},             -- traps on current floor
    npcs = {},              -- NPCs on current floor
    camps = {},             -- camps on current floor
    theme = nil,            -- current floor theme string
    themeColor = nil,       -- {wall={r,g,b}, floor={r,g,b}, accent={r,g,b}}
    players = {},           -- other players on this floor
    thermalEntities = {},   -- thermal vision heat blips (through walls)
    tremorIndicators = {},  -- tremor sense ripples
    magicAuras = {},        -- magic sense/true seeing aura data
    isPitchBlack = false,   -- pitch black floor flag
    visionType = "normal",  -- player's vision type
    availableVisions = {"normal"}, -- available vision types for toggle
    visionRadius = 5,       -- current effective vision radius
    lightLevel = 0.4,       -- ambient light level at player position
    ambientLight = 0.4,     -- floor ambient light
    hasTorch = false,       -- player holding torch
    torchExpiry = 0,        -- torch expiry timestamp
    hasLantern = false,     -- player holding lantern
    lanternExpiry = 0,      -- lantern expiry timestamp
    placedTorches = {},     -- placed torches on floor
    lightSources = {},      -- compact light source list from server [{x,y,r,b,t}]
    progress = nil,         -- guild/quest/stats from account
    hoverEntrance = false,  -- near rift entrance
    moveTimer = 0,          -- cooldown between grid moves
    moveRate = 0.15,        -- seconds between tile moves
    playerTileX = 0,        -- player's grid position (tiles)
    playerTileY = 0,
    hitFlashTimer = 0,      -- red flash when taking damage
    bossPhaseFlash = 0,     -- purple flash on boss phase change
    -- BG3-style turn-based overworld mode
    turnBasedMode = false,
    turnModeMyTurn = false,
    turnModeMovesRemaining = 0,
    turnModeInitiative = {},
    turnModeDashed = false,
}

-- Permadeath: downed/bleedout state
local permadeath = {
    isDowned = false,       -- player is in bleedout state
    bleedoutTimer = 0,      -- seconds remaining
    causeOfDeath = nil,     -- death cause string
    downedPlayers = {},     -- other downed players on floor: { [id] = { name, x, y } }
    showDeathScreen = false, -- full permadeath death screen
    deathHero = nil,        -- hero snapshot from server
    hasCharsLeft = true,    -- whether account has remaining characters
    showHallOfHeroes = false, -- in-game hall of heroes panel
    hallOfHeroesList = {},  -- cached hero list
}

-- Lich Corruption state
local corruption = {
    chunks = {},             -- 'cx,cy' -> level (0-100) for corrupted overworld chunks
    animTimer = 0,           -- animation timer for pulsing effect
    damageFlash = 0,         -- screen flash when taking corruption damage
    lastDamageMsg = nil,     -- last corruption damage message
    globalInfo = nil,        -- { totalChunks, hordes } from server_stats
}

-- Doom ascension state
local doom = {
    active = false,
    remainingMs = 0,
    pushbackCount = 0,
    doomAscensionCount = 0,
    capitalCorrupted = false,
    lastUpdate = 0,          -- love.timer.getTime() of last server update
    showEvent = false,        -- true when doom ascension cinematic is playing
    eventTimer = 0,           -- seconds remaining for cinematic
    eventMessage = nil,
    flashTimer = 0,           -- for capital corruption warning flash
}

-- Active NPC patrols (ACO-driven faction armies visible on overworld)
local activePatrols = {}  -- id -> { factionId, cx, cy, strength, description, hostile, color }

-- Disease state
game._disease = {
    playerDiseases = {},      -- { diseaseId = { state, name } }
    chunkDiseases = {},       -- diseases at current chunk
    contractedFlash = 0,      -- flash timer when contracting disease
    contractedName = nil,
    symptomMsg = nil,
    symptomTimer = 0,
}

-- Weather propagation state
game._weather = {
    weather = "clear",
    intensity = 0.5,
    wind = "east",
}

-- Faction influence state
game._influence = {
    controlling = nil,
    area = {},
}

-- Ecology state
game._ecology = {
    state = -1,
    name = "unknown",
    resourceBonus = 1.0,
}

-- Turn-based combat state (grouped to reduce upvalue count)
local tcState = {
    inCombat = false,
    combatId = nil,
    combatMyTurn = false,
    combatMyUnitId = nil,
    overworldCombat = false,
    overworldCombat_savedPos = nil,
}

-- AI Event Director UI state
game._directorEvents = {}       -- world event banners (gold banner, fade)
game._zoneTicker = {}           -- zone director updates (bottom-right)
game._raid = {
    state = nil,                  -- current game._raid floor state
    bossHp = nil,                 -- game._raid boss health bar data
    gathering = nil,              -- lich game._raid gathering phase
    myParty = nil,                -- partyId assigned in lich game._raid
    phase = nil,                  -- { phase, phaseName, message }
    corruptionZones = {},         -- { x, y, radius, damage, timer }
    phylacteries = {},            -- { id, hp, maxHp, name }
    purificationVfx = nil,        -- { x, y, timer, maxTimer, radius }
    partyData = nil,              -- { partyId, leader, members[] }
    partyInvitePending = nil,     -- { fromId, fromName, partyId }
    partyInviteInput = "",        -- text input for inviting by username
    partyInviteActive = false,    -- true when invite input is focused
}

game._hoverNpc = nil            -- NPC we're near in town (guild master etc)

-- NPC Dialogue state
game._npcDialogue = { show = false, npcName = "", text = "", choices = {}, npcId = "" }

-- Quest log state
game._questLog = { active = {}, completed = {} }

-- NPC Shop state
game._npcShop = {
    show = false,
    tab = "buy",            -- "buy" or "sell"
    scroll = 0,
    selected = nil,         -- selected item index
    amount = 1,
    shopId = "general",     -- current shop id
    shopName = "General Store",
    shopDesc = "",
    prices = nil,           -- array of { resource, name, buyPrice, sellPrice, basePrice, trend, multiplier }
    shopList = nil,          -- array of { id, name, description, itemCount }
    message = nil,          -- { text, color, timer } feedback message
    transactionLock = false, -- prevent double-click spam
}

-- Bank vault state
game._bank = {
    show = false,
    tab = "gold",              -- "gold", "resources", "items"
    scroll = 0,
    selected = nil,
    amount = 1,
    data = nil,                -- server bank data { gold, resources, items, maxSlots, expansionsPurchased, nextExpansionCost }
    message = nil,             -- { text, color, timer }
    transactionLock = false,
}

-- Auction House state
game._auction = {
    show = false,
    tab = "browse",        -- "browse", "sell", "my_listings"
    listings = {},
    myListings = {},
    page = 1,
    totalPages = 1,
    totalResults = 0,
    filters = { search = "", listingType = nil, rarity = nil },
    scroll = 0,
    selected = nil,
    sellPrice = "",        -- price input string
    sellCard = nil,        -- selected card to list
    searchActive = false,  -- is search bar focused
    priceActive = false,   -- is price input focused
}

-- Card vendor state
game._cardVendor = {
    show = false,
    tab = "buy",           -- "buy", "sell"
    catalog = {},          -- buyable card templates with prices
    scroll = 0,
    selected = nil,
    filterArch = "all",    -- archetype filter: "all" or archetype name
    filterType = "all",    -- type filter: "all", "active", "passive", "stat"
}

-- Card loadout state
game._cardLoadouts = {
    loadouts = { nil, nil, nil, nil, nil },
    renaming = nil,        -- index being renamed
    renameInput = "",
}

-- Fusion mode state
game._fusionMode = {
    active = false,
    card1 = nil,           -- first card selected for fusion
}

-- P2P Trade panel state
game._trade = {
    show = false,
    tradeId = nil,
    partnerId = nil,
    partnerName = "???",
    myOffer = { items = {}, chips = 0 },
    theirOffer = { items = {}, chips = 0 },
    myConfirmed = false,
    theirConfirmed = false,
    coinInput = "",
    coinInputActive = false,
    pendingRequest = nil,  -- incoming request { tradeId, fromName, fromId }
    message = nil,         -- { text, color, timer }
    myScroll = 0,          -- scroll offset for "my inventory" list
    offerScroll = 0,       -- scroll offset for "my offered items" list
}

-- Helper: reset trade state to defaults
function game.resetTradeState()
    game._trade.show = false
    game._trade.tradeId = nil
    game._trade.partnerId = nil
    game._trade.partnerName = "???"
    game._trade.myOffer = { items = {}, chips = 0 }
    game._trade.theirOffer = { items = {}, chips = 0 }
    game._trade.myConfirmed = false
    game._trade.theirConfirmed = false
    game._trade.coinInput = ""
    game._trade.coinInputActive = false
    game._trade.pendingRequest = nil
    game._trade.message = nil
    game._trade.myScroll = 0
    game._trade.offerScroll = 0
end
local resetTradeState = game.resetTradeState

-- Portal travel panel state
game._portal = {
    show = false,
    destinations = {},  -- array from server: { id, name, type, zoneId }
    scroll = 0,
    message = nil,      -- { text, color, timer } feedback message
    cooldownEnd = 0,    -- love.timer.getTime() timestamp when cooldown expires
}

-- Flavor text: which race controls each anchor town (keyed by zoneId)
local PORTAL_TOWN_RACE = {
    starter_town = "Human (Starter)",
    solara = "Human (Capital)",
    sylvaris = "Elf",
    ironhold = "Dwarf",
    kragmor = "Orc",
    bonetrap = "Goblin",
    murkmire = "Lizard Folk",
    mechspire = "Gnome",
    clockwork_harbor_town = "Gnome (Port)",
    fortunes_rest = "Cat Folk",
}

-- Admin panel state (F10 for server hosts)
game._admin = {
    showPanel = false,
    xpRate = 1.0,
    dropRate = 1.0,
    resultMsg = nil,              -- { text, color, timer }
    shutdownWarning = nil,        -- countdown timer
}

-- Sync panel state (F11 — cross-server character sync)
game._sync = {
    show = false,
    confirm = false,
    status = nil,      -- nil, "saving", "saved", "loading", "error"
    error = nil,
    statusTimer = 0,
}

-- Dungeon tile type constants (must match server dungeon-data.js)
local DTILE = {
    WALL = 0, FLOOR = 1, CORRIDOR = 2, DOOR = 3,
    STAIRS_UP = 4, STAIRS_DOWN = 5, ENTRANCE = 6, EXIT = 7,
    CHEST = 8, TRAP = 9, CAMP_SPOT = 10, SHRINE = 11,
    BOSS_DOOR = 12, SHORTCUT = 13, CORPSE = 14,
}

-- Walkable dungeon tiles
local WALKABLE_TILES = {
    [1] = true, [2] = true, [3] = true, [4] = true, [5] = true,
    [6] = true, [7] = true, [8] = true, [9] = true, [10] = true,
    [11] = true, [12] = true, [13] = true, [14] = true,
}

-- RPG Character Data (grouped to reduce upvalues)
local rpg = {
    stats = nil,             -- { vigor, might, finesse, acumen, resolve, presence, ingenuity, freePoints }
    computedStats = nil,     -- derived stats from server
    race = nil,              -- selected race string
    level = 1,
    xp = 0,
    xpNeeded = 250,
    pendingPacks = 0,
    cardSlots = 4,
    cards = {},              -- full card collection
    equippedCards = {},      -- 8 slots
    rarityInfo = {},         -- rarity tier data from server
    skillDefinitions = {},   -- skill definitions from server (cached from identity)
    statNames = {},          -- stat display names from server (cached from identity)
    cardEffects = {},        -- active equipped card effects
    mount = nil,             -- current mount type
    equipment = {},          -- { axe, pickaxe, weapon, shield, head, body, accessory }
}

-- Compute sprint bonuses from race, stats, and equipped cards
local function computeSprintBonuses()
    local maxMult = 1.0
    local drainMult = 1.0
    local regenMult = 1.0

    -- Race bonuses
    local race = rpg.race or ""
    if race == "orc" then maxMult = maxMult + 0.25
    elseif race == "cat_folk" then drainMult = drainMult - 0.20; regenMult = regenMult + 0.30
    elseif race == "goblin" then regenMult = regenMult + 0.50
    elseif race == "dwarf" then maxMult = maxMult + 0.10; drainMult = drainMult + 0.15; regenMult = regenMult - 0.10
    elseif race == "elf" then maxMult = maxMult - 0.10; drainMult = drainMult - 0.15
    elseif race == "gnome" then maxMult = maxMult - 0.15; regenMult = regenMult + 0.20
    end

    -- Stat scaling: Vigor +2% max per point above 5, Finesse -1.5% drain per point above 5
    local vigor = (rpg.stats and rpg.stats.vigor) or 5
    local finesse = (rpg.stats and rpg.stats.finesse) or 5
    maxMult = maxMult + math.max(0, (vigor - 5) * 0.02)
    drainMult = drainMult - math.max(0, (finesse - 5) * 0.015)

    -- Card effects
    if rpg.equippedCards and rpg.cards then
        local cardLookup = {}
        for _, c in ipairs(rpg.cards) do
            if c and c.instanceId then cardLookup[c.instanceId] = c end
        end
        for _, eqId in ipairs(rpg.equippedCards) do
            local card = eqId and cardLookup[eqId]
            if card and card.effects then
                for _, eff in ipairs(card.effects) do
                    if eff.type == "sprint_max_bonus" then maxMult = maxMult + (eff.value or 0)
                    elseif eff.type == "sprint_regen_bonus" then regenMult = regenMult + (eff.value or 0)
                    elseif eff.type == "sprint_drain_reduction" then drainMult = drainMult - (eff.value or 0)
                    end
                end
            end
        end
    end

    return {
        max = math.floor(sprint.MAX * math.max(0.5, maxMult)),
        drain = sprint.DRAIN * math.max(0.2, drainMult),
        restRegen = sprint.REST_REGEN * math.max(0.5, regenMult),
        walkRegen = sprint.WALK_REGEN * math.max(0.5, regenMult),
    }
end

-- Compass / World Map
local townPosition = nil    -- { x, y } center of starter town in overworld coords
local mapZoom = 1            -- world map zoom level (1 = fit whole world)

-- Interaction with placed objects
local hoverObject = nil

-- Hold-to-harvest
local harvestHoldTimer = 0
local HARVEST_HOLD_RATE = 1.5  -- seconds between auto-harvests (matches server cooldown)

-- Colors for time of day
local TIME_COLORS = {
    dawn  = { 0.85, 0.65, 0.45, 0.15 },
    day   = { 0, 0, 0, 0 },
    dusk  = { 0.6, 0.3, 0.5, 0.2 },
    night = { 0.05, 0.05, 0.2, 0.4 },
}

-- ================================================================
-- Feature: Overworld Monster Client Rendering
-- ================================================================
local zoneMonsters = {}           -- array of { id, type, name, x, y, hp, maxHp, level }
local monsterAttackCooldown = 0   -- prevent spam-clicking attack

-- ================================================================
-- Feature: Lootable Corpses & World Containers
-- ================================================================
local zoneCorpses = {}            -- array of { id, name, x, y, level, hasItems, hasGold }
local zoneWorldContainers = {}    -- array of { id, type, name, x, y, hasItems }
local corpseLootPanel = nil       -- { corpseId, name, gold, resources, items } when open
local containerLootPanel = nil    -- { containerId, name, gold, resources, items } when open

-- ================================================================
-- Feature: Level-Up Celebration
-- ================================================================
local levelUpEffect = nil         -- { timer, level, alpha, ringRadius }

-- ================================================================
-- Feature: Card Pack Opening Animation
-- ================================================================
local packReveal = nil            -- { cards = {}, currentIndex = 1, timer = 0, phase = "reveal" }

-- ================================================================
-- Feature: New Player Onboarding
-- ================================================================
local onboarding = {
    tips = {},                    -- keyed by tip id: tips[id] = true if shown
    currentTip = nil,             -- { text, timer }
    dismissed = false,
}

-- UI scale factor (1.0 at 1024px width, scales proportionally for larger/smaller displays)
local uiScale = 1

-- Extracted so game.load() stays under LuaJIT's 60-upvalue limit.
-- All module init calls live here; they capture their own upvalue set (58 vars, < 60).
local function _initModules()
    -- Wire up card draw module
    cardsDrawModule.init(game, {
        fonts = fonts,
        rpg = rpg,
        ui = ui,
        mastery = mastery,
        getAccount = function() return account end,
        getSkills = function() return skills end,
    })
    -- Wire up panels draw module (portal, shop, bank, trade, admin)
    panelsDrawModule.init(game, {
        fonts = fonts,
        ui = ui,
        rpg = rpg,
        getAccount = function() return account end,
        getMmoInventory = function() return mmoInventory end,
        getClient = function() return client end,
    })
    -- Wire up dungeon draw module (floor, entities, HUD, party, context menu)
    dungeonDrawModule.init(game, {
        dungeon  = dungeon,
        camera   = camera,
        fonts    = fonts,
        ui       = ui,
        tcState  = tcState,
        getFadeIn = function() return fadeIn end,
        getMyId   = function() return myId end,
        getSkills = function() return skills end,
    })
    -- Wire up social draw module (farming, knowledge, death, karma, factions, etc.)
    socialDrawModule.init(game, {
        fonts     = fonts,
        ui        = ui,
        knowledge = knowledge,
        getClient = function() return client end,
        getZone   = function() return zone end,
    })
    -- Wire up inventory draw module (inventory, equipment, crafting, compass, map)
    inventoryDrawModule.init(game, {
        fonts    = fonts,
        ui       = ui,
        rpg      = rpg,
        players  = players,
        camera   = camera,
        zoneList = zoneList,
        getMmoInventory = function() return mmoInventory end,
        getEquipment    = function() return equipment end,
        getMyId         = function() return myId end,
        getZone         = function() return zone end,
        getFadeIn       = function() return fadeIn end,
        getMapZoom      = function() return mapZoom end,
    })
    -- Wire up world draw module (terrain, monsters, resources, HUD, chat, etc.)
    worldDrawModule.init(game, {
        dungeon       = dungeon,
        camera        = camera,
        fonts         = fonts,
        ui            = ui,
        rpg           = rpg,
        players       = players,
        resources     = resources,
        floatingTexts = floatingTexts,
        world         = world,
        chat          = chat,
        overworld     = overworld,
        tcState       = tcState,
        corruption    = corruption,
        doom          = doom,
        sprint        = sprint,
        getEntityState = function()
            return {
                zoneMonsters          = zoneMonsters,
                zoneCorpses           = zoneCorpses,
                zoneWorldContainers   = zoneWorldContainers,
                connections           = connections,
                corpseLootPanel       = corpseLootPanel,
                containerLootPanel    = containerLootPanel,
                hoverObject           = hoverObject,
                hoverResource         = hoverResource,
                identity              = identity,
                levelUpEffect         = levelUpEffect,
                miniRifts             = miniRifts,
                onboarding            = onboarding,
                packReveal            = packReveal,
                placedObjects         = placedObjects,
                riftDestroyVfx        = riftDestroyVfx,
            }
        end,
        getZone    = function() return zone end,
        getMyId    = function() return myId end,
        getFadeIn  = function() return fadeIn end,
        getSkills  = function() return skills end,
        getAccount = function() return account end,
        getClient  = function() return client end,
    })
    -- Wire up input module (keypressed, textinput, mousepressed, mousemoved, wheelmoved)
    gameInputModule.init(game, {
        dungeon                = dungeon,
        camera                 = camera,
        rpg                    = rpg,
        players                = players,
        chat                   = chat,
        overworld              = overworld,
        tcState                = tcState,
        ui                     = ui,
        knowledge              = knowledge,
        combatUI               = combatUI,
        combatAnim             = combatAnim,
        gridInv                = gridInv,
        permadeath             = permadeath,
        DTILE                  = DTILE,
        CONTEXT_MENU_ITEMS_BASE = CONTEXT_MENU_ITEMS_BASE,
        getClient              = function() return client end,
        getZone                = function() return zone end,
        getMyId                = function() return myId end,
        getSkills              = function() return skills end,
        getHoverResource       = function() return hoverResource end,
        getHoverObject         = function() return hoverObject end,
        getHoverConnection     = function() return hoverConnection end,
        getCorpseLootPanel     = function() return corpseLootPanel end,
        getContainerLootPanel  = function() return containerLootPanel end,
        getPackReveal          = function() return packReveal end,
        getZoneMonsters        = function() return zoneMonsters end,
        getZoneCorpses         = function() return zoneCorpses end,
        getZoneWorldContainers = function() return zoneWorldContainers end,
        getMapZoom             = function() return mapZoom end,
        getMonsterAttackCooldown = function() return monsterAttackCooldown end,
        getEquipSlotButtons    = function() return inventoryDrawModule.getEquipSlotButtons() end,
        getInventoryItemButtons = function() return inventoryDrawModule.getInventoryItemButtons() end,
        getCraftingButtons     = function() return inventoryDrawModule.getCraftingButtons() end,
        setCorpseLootPanel     = function(v) corpseLootPanel = v end,
        setContainerLootPanel  = function(v) containerLootPanel = v end,
        setPackReveal          = function(v) packReveal = v end,
        setMapZoom             = function(v) mapZoom = v end,
        setMonsterAttackCooldown = function(v) monsterAttackCooldown = v end,
    })
end

function game.load()
    uiScale = math.max(0.75, love.graphics.getWidth() / 1024)
    local function sf(size) return math.floor(size * uiScale) end

    fonts.main = _G.getFont(sf(14))
    fonts.name = _G.getFont(sf(12))
    fonts.chat = _G.getFont(sf(13))
    fonts.chatInput = _G.getFont(sf(14))
    fonts.ui = _G.getFont(sf(16))
    fonts.title = _G.getFont(sf(20))
    fonts.npc = _G.getFont(sf(11))
    fonts.hud = _G.getFont(sf(13))
    fonts.small = _G.getFont(sf(10))
    fonts.zone = _G.getFont(sf(15))
    fonts.levelUp = _G.getFont(sf(28))

    _initModules()

    game._audio.init()
    game._assets.init()
    lighting.init()
    game._audioSliderDrag = nil

    fadeIn = 0
    chat.messages = {}
    chat.input = ""
    chat.active = false
    players = {}
    zone = nil
    resources = {}
    hoverResource = nil
    ui.showZoneList = false
    floatingTexts = {}
    mmoInventory = { wood = 0, stone = 0, iron_ore = 0, iron_bar = 0, items = {} }
    equipment = { axe = nil, pickaxe = nil }
    ui.showInventory = false
    ui.placementMode = false
    ui.contextMenu = nil
    placedObjects = {}
    hoverObject = nil
    miniRifts = {}
    riftDestroyVfx = {}
    riftRewardPopup = nil
    overworld.hoverRift = nil
    overworld.chunks = {}
    overworld.chunkBased = false
    overworld.currentBiome = nil
    overworld.lastChunkX = nil
    overworld.lastChunkY = nil
    overworld.plots = {}
    overworld.myPlotId = nil
    townPosition = nil
    ui.showWorldMap = false
    mapZoom = 1
    overworld.featureColors = {}
    overworld.featureSpeeds = {}
    overworld.hoverCave = nil
    overworld.rivers = {}
    overworld.riverAnimTimer = 0
    overworld.isHollowEarth = false

    -- Leviathan state
    overworld.leviathans = {}
    overworld.leviathanWarning = nil
    overworld.leviathanWarningTimer = 0
    overworld.leviathanAggro = nil
    overworld.leviathanAggroTimer = 0
    overworld.leviathanParts = nil
    overworld.leviathanCombatName = nil
    overworld.leviathanPhaseText = nil
    overworld.leviathanPhaseTimer = 0
    overworld.leviathanEnraged = false

    -- Reset combat state
    tcState.inCombat = false
    tcState.combatId = nil
    tcState.combatMyTurn = false
    tcState.combatMyUnitId = nil
    tcState.overworldCombat = false
    tcState.overworldCombat_savedPos = nil

    dungeon.inDungeon = false
    dungeon.id = nil
    dungeon.combatJoinOffer = nil
    dungeon.floor = nil
    dungeon.floorNum = 0
    dungeon.grid = nil
    dungeon.fog = {}
    dungeon.enemies = {}
    dungeon.chests = {}
    dungeon.traps = {}
    dungeon.npcs = {}
    dungeon.corpses = {}
    dungeon.camps = {}
    dungeon.theme = nil
    dungeon.themeColor = nil
    dungeon.players = {}
    dungeon.progress = (account and account.dungeonProgress) or nil
    dungeon.turnBasedMode = false
    dungeon.turnModeMyTurn = false
    dungeon.turnModeMovesRemaining = 0
    dungeon.turnModeInitiative = {}
    dungeon.turnModeDashed = false
    -- Clear permadeath downed state
    permadeath.isDowned = false
    permadeath.bleedoutTimer = 0
    permadeath.causeOfDeath = nil
    permadeath.downedPlayers = {}
    ui.showDungeonQuests = false
    ui.showLeaderboard = false
    ui.showPartyPanel = false
    game._raid.partyData = nil
    game._raid.partyInvitePending = nil
    game._raid.partyInviteInput = ""
    game._raid.partyInviteActive = false
    game._hoverNpc = nil
    game._portal.show = false
    game._portal.destinations = {}
    game._portal.scroll = 0
    game._portal.message = nil
    game._portal.cooldownEnd = 0
    game._npcShop.show = false
    game._npcShop.tab = "buy"
    game._npcShop.scroll = 0
    game._npcShop.selected = nil
    game._npcShop.amount = 1
    game._npcShop.prices = nil
    game._npcShop.shopList = nil
    game._npcShop.message = nil
    game._npcShop.transactionLock = false
    resetTradeState()
    dungeon.hoverEntrance = false
    dungeon.moveTimer = 0
    dungeon.playerTileX = 0
    dungeon.playerTileY = 0
    ui.showCharSheet = false
    ui.showCardCollection = false
    ui.cardScrollY = 0
    ui.selectedCard = nil
    rpg.cards = {}
    rpg.equippedCards = {}
    rpg.rarityInfo = {}
    rpg.skillDefinitions = {}
    rpg.statNames = {}
    rpg.cardEffects = {}
    rpg.mount = nil
    MOVE_SPEED = LOCAL_SPEED  -- reset to town speed until zone_state tells us otherwise

    -- Reset new feature state
    zoneMonsters = {}
    monsterAttackCooldown = 0
    zoneCorpses = {}
    zoneWorldContainers = {}
    corpseLootPanel = nil
    containerLootPanel = nil
    levelUpEffect = nil
    packReveal = nil
    onboarding = { tips = {}, currentTip = nil, dismissed = false }

    client = _G.gameClient
    identity = _G.identity
    myId = identity and identity.id
    account = identity and identity.account
    skills = (account and account.skills) or {}
    world = (identity and identity.world) or { timeOfDay = "day", weather = "clear" }
    zoneList = (identity and identity.zones) or {}

    -- Load inventory from identity
    if account then
        mmoInventory = account.mmoInventory or mmoInventory
        equipment = account.equipment or equipment
        overworld.myPlotId = account.plotId or nil
        rpg.race = account.race or nil
        rpg.stats = account.rpgStats or nil
        rpg.cardSlots = account.cardSlots or 4
        rpg.pendingPacks = account.pendingPacks or 0
        rpg.mount = account.mount or nil
        rpg.level = account.level or 1
        rpg.xp = account.xp or 0
        rpg.equipment = account.equipment or {}
        rpg.ascensionMark = account.ascensionMark or false
    end

    -- Cache static gameData from identity (sent once on connect, no longer in zone_state)
    if identity and identity.gameData then
        rpg.rarityInfo = identity.gameData.rarityInfo or rpg.rarityInfo
        rpg.skillDefinitions = identity.gameData.skillDefinitions or {}
        rpg.statNames = identity.gameData.statNames or {}
    end

    -- Guard: if client is nil, we cannot set up listeners or enter a zone.
    -- This can happen if _G.gameClient was never set (e.g. disconnected before
    -- reaching this scene) or if game.load() was called by love.resize fallback.
    if not client then
        game._loadError = "No connection to server"
        game._loadErrorTimer = 0
        return
    end

    if not client.connected then
        game._loadError = "Disconnected from server"
        game._loadErrorTimer = 0
        return
    end

    -- Initialize debug tracking FIRST (before anything that might error)
    game._zoneDebug = { events = {}, zoneStateReceived = false, retries = 0 }
    game._zoneLoadTimeout = 8
    game._zoneRetryTimer = 3

    -- Set up event listeners (wrap in pcall to catch errors)
    debugLog("setupListeners starting, client.connected=" .. tostring(client.connected))
    local slOk, slErr = pcall(game.setupListeners)
    if not slOk then
        debugLog("setupListeners CRASHED: " .. tostring(slErr))
        game._loadError = "Scene setup error: " .. tostring(slErr)
        return
    end
    debugLog("setupListeners done")
    table.insert(game._zoneDebug.events, "listeners ok")

    -- Enter starting zone (use saved position if returning player)
    if identity and identity.startZone then
        local enterData = { zoneId = identity.startZone }
        if identity.startPosition then
            enterData.x = identity.startPosition.x
            enterData.y = identity.startPosition.y
        end
        debugLog("emitting zone_enter for " .. tostring(identity.startZone))
        local sent = client:emit("zone_enter", enterData)
        debugLog("zone_enter emit result: " .. tostring(sent))
        if not sent then
            game._loadError = "Failed to request zone"
            game._loadErrorTimer = 0
        else
            table.insert(game._zoneDebug.events, "zone_enter sent")
        end
    else
        game._loadError = "No starting zone"
        game._loadErrorTimer = 0
    end
end

-- Close all UI panels (mutual exclusion)
function game.closeAllPanels()
    ui.showInventory = false
    ui.showGridInventory = false
    ui.showCharSheet = false
    ui.showCardCollection = false
    ui.showWorldMap = false
    ui.showZoneList = false
    ui.showDungeonQuests = false
    ui.showLeaderboard = false
    ui.showPartyPanel = false
    ui.showKnowledge = false
    ui.showEquipment = false
    ui.showFarming = false
    ui.farmingPlotId = nil
    ui.equipmentScroll = 0
    ui.selectedCard = nil
    game._raid.partyInviteActive = false
    game._raid.partyInviteInput = ""
    game._portal.show = false
    game._portal.scroll = 0
    game._portal.message = nil
    game._npcShop.show = false
    game._npcShop.selected = nil
    game._npcShop.amount = 1
    game._npcShop.scroll = 0
    game._bank.show = false
    game._bank.selected = nil
    game._bank.amount = 1
    game._bank.scroll = 0
    game._auction.show = false
    game._auction.selected = nil
    game._auction.scroll = 0
    game._auction.searchActive = false
    game._auction.priceActive = false
    game._cardVendor.show = false
    game._cardVendor.selected = nil
    game._cardVendor.scroll = 0
    game._fusionMode.active = false
    game._fusionMode.card1 = nil
    ui.showMastery = false
    ui.showCompanions = false
    ui.showPets = false
    ui.showGuild = false
    ui.showAscension = false
    ui.showJail = false
    ui.showAudioSettings = false
    game._sync.show = false
    game._sync.confirm = false
    game._sync.status = nil
    game._karma.showFactions = false
    game._karma.showBounties = false
    ui.showVip = false
    ui.showRumors = false
    ui.showEnvironment = false
    resetTradeState()
end

function game.enterPlacementMode(itemType, itemId)
    ui.placementMode = true
    ui.placementType = itemType
    ui.placementItemId = itemId
    ui.showGridInventory = false
end

function game.setupListeners()
    if not client then return end

    -- Clear stale listeners from previous scene loads to prevent accumulation
    for _, evt in ipairs(SCENE_EVENTS) do
        client:off(evt)
    end

    -- Initialize grid inventory module
    gridInv.init(client, fonts, game)
    -- Request grid state on connect
    client:emit("grid_sync", {})

    -- Build shared context for handler modules that need file-scope locals
    local ctx = {
        -- Tables shared by reference — MUST be wiped in-place, never reassigned
        players = players, ui = ui, rpg = rpg, chat = chat,
        dungeon = dungeon, overworld = overworld, sprint = sprint,
        knowledge = knowledge, mastery = mastery, doom = doom,
        activePatrols = activePatrols, corruption = corruption,
        permadeath = permadeath, identity = identity,
        zoneMonsters = zoneMonsters, zoneCorpses = zoneCorpses,
        zoneWorldContainers = zoneWorldContainers,
        -- Reassignable locals (need getter/setter)
        getAccount = function() return account end,
        getMmoInventory = function() return mmoInventory end,
        setMmoInventory = function(inv) mmoInventory = inv end,
        getMyId = function() return myId end,
        getCorpseLootPanel = function() return corpseLootPanel end,
        setCorpseLootPanel = function(p) corpseLootPanel = p end,
        getContainerLootPanel = function() return containerLootPanel end,
        setContainerLootPanel = function(p) containerLootPanel = p end,
        setPackReveal = function(pr) packReveal = pr end,
        setDurabilityData = function(d) durabilityData = d end,
    }

    -- Register all handler modules
    for _, mod in ipairs(handlerModules) do
        mod.register(client, game, ctx)
    end

    -- Save portable account snapshot for cross-server import
    client:on("account_snapshot", function(data)
        if type(data) == "string" and #data > 2 then
            love.filesystem.write("account_snapshot.dat", data)
            -- If sync panel is waiting for a save, mark it done
            if game._sync.status == "saving" then
                game._sync.status = "saved"
                game._sync.statusTimer = 2
            end
        end
    end)

    -- Sync import result: server confirms or rejects a character load
    client:on("sync_import_result", function(data)
        if data and data.success then
            game._sync.show = false
            game._sync.confirm = false
            game._sync.status = nil
            _G.switchScene("character_select")
        else
            game._sync.status = "error"
            game._sync.error = (data and data.error) or "Sync failed"
            game._sync.statusTimer = 3
        end
    end)

    -- BG3-style turn-based overworld mode events
    client:on("dungeon_mode_update", function(data)
        dungeon.turnBasedMode = data and data.turnBased or false
        dungeon.turnModeMyTurn = false
        dungeon.turnModeDashed = false
        if not dungeon.turnBasedMode then
            combatUI.clearOverworldRanges()
        end
    end)

    client:on("dungeon_turn_start", function(data)
        dungeon.turnModeMyTurn = true
        dungeon.turnModeDashed = false
        dungeon.turnModeMovesRemaining = data and data.movementPoints or 3
        dungeon.turnModeInitiative = data and data.initiative or {}
    end)

    client:on("dungeon_turn_result", function(data)
        -- Enemy moved during their turn — set up lerp animation
        if data and data.enemyIdx ~= nil then
            for _, e in ipairs(dungeon.enemies) do
                if e.index == data.enemyIdx then
                    e.lerpFromX = data.fromX
                    e.lerpFromY = data.fromY
                    e.lerpTimer = 0.25
                    break
                end
            end
        end
    end)

    client:on("dungeon_turn_update", function(data)
        if data and data.movesRemaining ~= nil then
            dungeon.turnModeMovesRemaining = data.movesRemaining
        end
        if data and data.dashed then
            dungeon.turnModeDashed = true
        end
        if data and data.turnEnded then
            dungeon.turnModeMyTurn = false
        end
        if data and data.initiative then
            dungeon.turnModeInitiative = data.initiative
        end
    end)

    -- Handle zone errors (e.g. expired dungeon floor) — fallback to starter_town
    client:on("zone_error", function(data)
        if not zone then
            -- Still on "Loading zone..." — request starter_town as fallback
            client:emit("zone_enter", { zoneId = "starter_town" })
        end
    end)

    client:on("zone_state", function(data)
        debugLog("zone_state received! data type: " .. type(data))
        if game._zoneDebug then
            game._zoneDebug.zoneStateReceived = true
            table.insert(game._zoneDebug.events, "zone_state received (type=" .. type(data) .. ")")
        end

        if not data then
            debugLog("zone_state data is nil!")
            game._loadError = "Server sent empty zone data"
            return
        end
        debugLog("zone_state id=" .. tostring(data.id) .. " name=" .. tostring(data.name) .. " type=" .. tostring(data.type))

        -- Clear reconnection state on successful zone load
        game._reconnecting = false
        game._reconnectOverlay = false
        game._reconnectAttempt = 0

        -- Wipe shared tables in-place so handler module refs stay valid
        wipeTable(players)
        wipeTable(resources)
        wipeTable(overworld.chunks)
        if overworld.chunkCanvases then
            for _, canvas in pairs(overworld.chunkCanvases) do canvas:release() end
        end
        wipeTable(overworld.chunkCanvases)
        wipeTable(corruption.chunks)

        -- Clear dungeon state when entering a non-dungeon zone
        if data.type ~= "dungeon" then
            dungeon.inDungeon = false
            dungeon.floor = nil
            dungeon.grid = nil
            dungeon.fog = {}
            dungeon.lightSources = {}
            dungeonParticles.cleanup()
            -- Clear combat state
            if tcState.inCombat then
                tcState.inCombat = false
                tcState.combatId = nil
                tcState.combatMyTurn = false
                tcState.combatMyUnitId = nil
                combatUI.cleanup()
                combatAnim.clear()
            end
            tcState.overworldCombat = false
            tcState.overworldCombat_savedPos = nil
        end

        zone = data
        debugLog("zone SET to data (id=" .. tostring(data.id) .. "), clearing timeout/error")
        game._zoneLoadTimeout = nil  -- Zone loaded successfully, cancel timeout
        game._loadError = nil        -- Clear any error state
        wipeTable(players)
        connections = data.connections or {}
        wipeTable(resources)
        for k, v in pairs(data.resources or {}) do resources[k] = v end
        placedObjects = data.placedObjects or {}

        -- Clear overworld monsters and request fresh list for this zone
        wipeTable(zoneMonsters)
        wipeTable(zoneCorpses)
        wipeTable(zoneWorldContainers)
        corpseLootPanel = nil
        containerLootPanel = nil
        if client then
            client:emit("zone_monsters_request", {})
        end

        -- Extract town position from connections (for compass)
        townPosition = nil
        for _, conn in ipairs(connections) do
            if conn.targetZone == "starter_town" then
                townPosition = { x = conn.x, y = conn.y }
                break
            end
        end

        -- Chunk-based zone setup (overworld)
        overworld.chunkBased = data.chunkBased or false
        if overworld.chunkBased then
            overworld.chunkSize = data.chunkSize or 512
            overworld.biomeColors = data.biomeColors or {}
            overworld.biomeNames = data.biomeNames or {}
            overworld.biomeSpeeds = data.biomeSpeeds or {}
            overworld.featureColors = data.featureColors or {}
            overworld.featureSpeeds = data.featureSpeeds or {}
            overworld.rivers = data.rivers or {}
            overworld.isHollowEarth = data.isHollowEarth or false
            overworld.chunks = {}
            overworld.lastChunkX = nil
            overworld.lastChunkY = nil
            -- Use overworld walk speed (much slower for world scale)
            OVERWORLD_SPEED = data.overworldWalkSpeed or 17
            MOVE_SPEED = OVERWORLD_SPEED
        else
            -- Town/building zones use fast local speed
            MOVE_SPEED = LOCAL_SPEED
        end

        -- Populate players
        if data.players then
            for _, p in ipairs(data.players) do
                players[p.id] = {
                    name = p.name,
                    username = p.username,
                    color = p.color,
                    x = p.x or 0,
                    y = p.y or 0,
                    facing = p.facing or "down",
                    tag = p.tag or "",
                    avatar = p.avatar,
                    targetX = p.x or 0,
                    targetY = p.y or 0,
                }
            end
        end

        -- Populate chat
        chat.messages = {}
        if data.chatMessages then
            for _, m in ipairs(data.chatMessages) do
                table.insert(chat.messages, {
                    authorName = m.authorName,
                    authorColor = m.authorColor,
                    content = m.content,
                    timestamp = m.timestamp,
                    chatType = m.chatType or "local",
                    _localTime = love.timer.getTime(),
                })
            end
        end

        -- Set our position if we're in the player list
        if myId and players[myId] then
            camera.x = players[myId].x - love.graphics.getWidth() / 2
            camera.y = players[myId].y - love.graphics.getHeight() / 2
        end
        debugLog("zone_state handler COMPLETE, zone=" .. tostring(zone and zone.id))

        -- Transition ambient audio for this zone
        if not dungeon.inDungeon then
            game._audio.setAmbientForZone(data.type)
            game._audio.setWeather(world.weather)
            -- Start biome/zone-aware music
            if data.type == "town" or data.type == "building" then
                game._audio.playTownMusic()
            elseif overworld.chunkBased then
                game._audio.playOverworldMusic(overworld.currentBiome)
            end
        end

        -- Request karma/jail status on zone load
        if client then
            client:emit("karma_status", {})
            client:emit("jail_status", {})
        end
    end)

    client:on("player_entered_zone", function(data)
        if data and data.id then
            players[data.id] = {
                name = data.name or "?",
                username = data.username,
                color = data.color or "#FFFFFF",
                x = data.x or 0,
                y = data.y or 0,
                facing = data.facing or "down",
                tag = data.tag or "",
                avatar = data.avatar,
                targetX = data.x or 0,
                targetY = data.y or 0,
                race = data.race,
                ascensionMark = data.ascensionMark or false,
            }
        end
    end)

    client:on("player_left_zone", function(data)
        if data and data.playerId then
            players[data.playerId] = nil
            game._audio.removeOtherPlayer(data.playerId)
        end
    end)

    client:on("player_moved", function(data)
        if data and data.id and players[data.id] then
            players[data.id].targetX = data.x
            players[data.id].targetY = data.y
            -- Delta compression: facing sent as 'f' (integer) only when changed
            if data.f then
                local INT_TO_FACING_LUT = { [0] = "down", [1] = "up", [2] = "left", [3] = "right" }
                players[data.id].facing = INT_TO_FACING_LUT[data.f] or data.f
            elseif data.facing then
                players[data.id].facing = data.facing
            end
            -- Track for spatial footstep audio
            if data.id ~= myId then
                game._audio.trackOtherPlayer(data.id, data.x, data.y)
            end
        end
    end)

    client:on("zone_move_corrected", function(data)
        if data and data.x and data.y then
            if myId and players[myId] then
                players[myId].x = data.x
                players[myId].y = data.y
            end
        end
    end)

    client:on("zone_message", function(data)
        if data then
            table.insert(chat.messages, {
                authorName = data.authorName,
                authorColor = data.authorColor,
                content = data.content,
                timestamp = data.timestamp,
                chatType = data.chatType or "local",
                _localTime = love.timer.getTime(),
            })
            -- Keep last 50
            while #chat.messages > 50 do
                table.remove(chat.messages, 1)
            end
        end
    end)

    client:on("zone_positions", function(data)
        -- Bulk position update from server tick
        if data and data.players then
            for _, p in ipairs(data.players) do
                if players[p.id] and p.id ~= myId then
                    players[p.id].targetX = p.x
                    players[p.id].targetY = p.y
                    if p.f then
                        players[p.id].facing = p.f
                    elseif p.facing then
                        players[p.id].facing = p.facing
                    end
                    game._audio.trackOtherPlayer(p.id, p.x, p.y)
                end
            end
        end
    end)

    -- Batched move updates from server (chunk-based zones)
    local INT_TO_FACING = { [0] = "down", [1] = "up", [2] = "left", [3] = "right" }
    client:on("batch_move", function(data)
        if not data or not data.moves then return end
        for _, m in ipairs(data.moves) do
            if m.id and players[m.id] and m.id ~= myId then
                players[m.id].targetX = m.x
                players[m.id].targetY = m.y
                if m.f then
                    players[m.id].facing = INT_TO_FACING[m.f] or m.f
                end
                game._audio.trackOtherPlayer(m.id, m.x, m.y)
            end
        end
    end)

    client:on("world_time", function(data)
        if data then
            world.timeOfDay = data.timeOfDay or world.timeOfDay
            world.weather = data.weather or world.weather
            game._audio.setWeather(world.weather)
        end
    end)

    client:on("season_visual_update", function(data)
        if data then
            world.seasonVisual = data
        end
    end)

    client:on("server_stats", function(data)
        if data then
            _G.serverStats = data
            -- Track global corruption info
            if data.corruption then
                corruption.globalInfo = data.corruption
            else
                corruption.globalInfo = nil
            end
        end
    end)

    -- Lich Corruption: receive corrupted chunk levels
    client:on("corruption_update", function(data)
        if data and data.chunks then
            for key, level in pairs(data.chunks) do
                if level > 0 then
                    corruption.chunks[key] = level
                else
                    corruption.chunks[key] = nil
                end
            end
        end
    end)

    -- Lich Corruption: take shadow damage in corrupted areas
    client:on("corruption_damage", function(data)
        if data then
            corruption.damageFlash = 0.6
            corruption.lastDamageMsg = data.message or "The corruption burns..."
            addFloatingText({
                text = "-" .. (data.damage or 5) .. " (Corruption)",
                x = players[myId] and players[myId].x or 0,
                y = players[myId] and (players[myId].y - 30) or 0,
                color = {0.5, 0.1, 0.6, 1},
                timer = 2.0,
            })
        end
    end)

    -- Lich Corruption: town under attack notification
    client:on("town_under_attack", function(data)
        if data then
            table.insert(game._directorEvents, {
                title = "Town Under Attack!",
                description = data.message or "Undead forces are attacking!",
                type = "lich_attack",
                timer = 15,
            })
        end
    end)

    client:on("account_created", function(data)
        if data and data.key then
            keystore.setKey(data.key)
            account = account or {}
            account.key = data.key
            account.coins = data.chips or data.coins or 0
            account.temp = false
        end
    end)

    client:on("chips_updated", function(data)
        if data and account then
            account.coins = data.chips or data.coins
        end
    end)

    -- Harvest result: floating text feedback + skill update
    client:on("harvest_result", function(data)
        if not data then return end
        game._audio.playItemPickup()

        -- Find the resource position for floating text
        local rx, ry = 0, 0
        -- Check flat resources first
        for _, r in ipairs(resources) do
            if r.id == data.resourceId then
                rx = r.x
                ry = r.y
                break
            end
        end
        -- If not found, check loaded chunks
        if rx == 0 and ry == 0 and overworld.chunkBased then
            for _, chunk in pairs(overworld.chunks) do
                if chunk.resources then
                    for _, r in ipairs(chunk.resources) do
                        if r.id == data.resourceId then
                            rx = r.x
                            ry = r.y
                            break
                        end
                    end
                end
                if rx ~= 0 then break end
            end
        end

        -- Floating text: resource gained
        local itemName = data.item or data.type or "Resource"
        addFloatingText({
            text = "+1 " .. itemName,
            x = rx, y = ry - 20,
            color = { 0.4, 1, 0.4 },
            timer = 2.0,
        })

        -- Floating text: XP gained
        local skillLabel = data.skill or ""
        if skillLabel == "woodcutting" then skillLabel = "Woodcutting"
        elseif skillLabel == "mining" then skillLabel = "Mining" end
        addFloatingText({
            text = "+" .. (data.xp or 0) .. " " .. skillLabel .. " XP",
            x = rx, y = ry - 36,
            color = { 0.5, 0.8, 1 },
            timer = 2.0,
        })

        -- Level up notification
        if data.leveledUp then
            addFloatingText({
                text = skillLabel .. " Level " .. data.skillLevel .. "!",
                x = rx, y = ry - 52,
                color = { 1, 1, 0.3 },
                timer = 3.0,
            })
        end

        -- Update local skill cache
        if data.skill and skills then
            skills[data.skill] = skills[data.skill] or {}
            skills[data.skill].level = data.skillLevel or 1
            skills[data.skill].xp = data.skillXp or 0
            skills[data.skill].xpNeeded = data.xpNeeded or 100
        end

        -- Update resource HP locally (or remove if destroyed)
        if data.resourceId then
            if data.destroyed then
                -- Remove destroyed resource from flat resources
                for i = #resources, 1, -1 do
                    if resources[i].id == data.resourceId then
                        table.remove(resources, i)
                        break
                    end
                end
                -- Remove from chunk resources
                for _, chunk in pairs(overworld.chunks) do
                    if chunk.resources then
                        for i = #chunk.resources, 1, -1 do
                            if chunk.resources[i].id == data.resourceId then
                                table.remove(chunk.resources, i)
                                break
                            end
                        end
                    end
                end
                -- Clear hover if it was this resource
                if hoverResource and hoverResource.id == data.resourceId then
                    hoverResource = nil
                end
            elseif data.hp then
                -- Update in flat resources
                for _, r in ipairs(resources) do
                    if r.id == data.resourceId then
                        r.hp = data.hp
                        r.maxHp = data.maxHp
                        break
                    end
                end
                -- Update in chunk resources
                if overworld.chunkBased then
                    for _, chunk in pairs(overworld.chunks) do
                        if chunk.resources then
                            for _, r in ipairs(chunk.resources) do
                                if r.id == data.resourceId then
                                    r.hp = data.hp
                                    r.maxHp = data.maxHp
                                    break
                                end
                            end
                        end
                    end
                end
            end
        end

        -- Update MMO inventory
        if data.inventory then
            mmoInventory = data.inventory
        end
    end)

    -- Harvest error feedback (suppress "too fast" when holding E)
    client:on("harvest_error", function(data)
        if data and data.message and myId and players[myId] then
            if data.message == "Harvesting too fast" then return end
            addFloatingText({
                text = data.message,
                x = players[myId].x, y = players[myId].y - 30,
                color = { 1, 0.3, 0.3 },
                timer = 2.0,
            })
        end
    end)

    -- Resource depleted: update local state
    client:on("resource_depleted", function(data)
        if not data then return end
        -- Update flat resources
        for _, r in ipairs(resources) do
            if r.id == data.resourceId then
                r.depleted = true
                r.depletedUntil = data.depletedUntil
                r.hp = 0
                break
            end
        end
        -- Update chunk resources
        if overworld.chunkBased then
            for _, chunk in pairs(overworld.chunks) do
                if chunk.resources then
                    for _, r in ipairs(chunk.resources) do
                        if r.id == data.resourceId then
                            r.depleted = true
                            r.depletedUntil = data.depletedUntil
                            r.hp = 0
                            return
                        end
                    end
                end
            end
        end
    end)

    -- Resource destroyed (permanently removed from plot land)
    client:on("resource_destroyed", function(data)
        if not data or not data.resourceId then return end
        -- Remove from flat resources
        for i = #resources, 1, -1 do
            if resources[i].id == data.resourceId then
                table.remove(resources, i)
                break
            end
        end
        -- Remove from chunk resources
        for _, chunk in pairs(overworld.chunks) do
            if chunk.resources then
                for i = #chunk.resources, 1, -1 do
                    if chunk.resources[i].id == data.resourceId then
                        table.remove(chunk.resources, i)
                        break
                    end
                end
            end
        end
        -- Clear hover if it was this resource
        if hoverResource and hoverResource.id == data.resourceId then
            hoverResource = nil
        end
    end)

    -- Inventory updated
    client:on("inventory_updated", function(data)
        if data and data.inventory then
            mmoInventory = data.inventory
        end
        if data and data.equipment then
            equipment = data.equipment
        end
    end)

    -- Craft result (also handles minigame output which includes item + quality)
    client:on("craft_result", function(data)
        if data and data.inventory then
            mmoInventory = data.inventory
        end
        if data and data.success then
            local label = "Crafted!"
            -- Minigame crafts return a specific item with a quality tier
            if data.item and data.quality then
                local itemName = (data.item.name or data.item.type or "item")
                label = itemName .. " (" .. data.quality .. ")"
            end
            if myId and players[myId] then
                addFloatingText({
                    text = label,
                    x = players[myId].x, y = players[myId].y - 40,
                    color = { 0.4, 1, 0.6 },
                    timer = 2.5,
                })
            end
        end
    end)

    client:on("craft_error", function(data)
        if data and data.message and myId and players[myId] then
            addFloatingText({
                text = data.message,
                x = players[myId].x, y = players[myId].y - 40,
                color = { 1, 0.3, 0.3 },
                timer = 2.0,
            })
        end
    end)

    -- Recipes list
    client:on("recipes_list", function(data)
        if data and data.recipes then
            recipes = data.recipes
        end
    end)

    -- Placed objects
    client:on("object_placed", function(data)
        if data then
            table.insert(placedObjects, data)
        end
    end)

    client:on("object_removed", function(data)
        if data and data.objectId then
            for i = #placedObjects, 1, -1 do
                if placedObjects[i].id == data.objectId then
                    table.remove(placedObjects, i)
                    break
                end
            end
        end
    end)

    client:on("place_result", function(data)
        if data and data.inventory then
            mmoInventory = data.inventory
        end
        ui.placementMode = false
        ui.placementType = nil
        ui.placementItemId = nil
        -- Resync grid inventory (item was placed)
        client:emit("grid_sync", {})
    end)

    -- Chunk data from server (overworld lazy loading)
    client:on("chunk_data", function(data)
        if not data or not data.chunks then return end
        for _, chunk in ipairs(data.chunks) do
            if chunk.cx and chunk.cy then
                local key = chunk.cx .. "," .. chunk.cy
                -- Convert features from 0-indexed JSON array to Lua 1-indexed table
                if chunk.features and type(chunk.features) == "table" then
                    local feat = {}
                    for i, v in ipairs(chunk.features) do
                        feat[i] = v
                    end
                    chunk.features = feat
                end
                overworld.chunks[key] = chunk
                -- Invalidate canvas cache for this chunk
                if overworld.chunkCanvases then
                    if overworld.chunkCanvases[key] then overworld.chunkCanvases[key]:release() end
                    overworld.chunkCanvases[key] = nil
                end
                -- Extract plots from chunk data
                if chunk.plots then
                    for _, plot in ipairs(chunk.plots) do
                        overworld.plots[plot.id] = plot
                    end
                end
            end
        end
        -- Extract mini-rifts from chunk data
        if data.rifts then
            for _, r in ipairs(data.rifts) do
                miniRifts[r.riftId] = r
            end
        end
        -- LRU chunk eviction: if too many chunks cached, evict distant ones
        local MAX_CHUNKS = 200
        local EVICT_RADIUS_SQ = (8 * (overworld.chunkSize or 512)) ^ 2
        local chunkCount = 0
        for _ in pairs(overworld.chunks) do chunkCount = chunkCount + 1 end
        if chunkCount > MAX_CHUNKS then
            local me = players[myId]
            if me then
                local toRemove = {}
                for ck, c in pairs(overworld.chunks) do
                    local cx = (c.cx or 0) * (overworld.chunkSize or 512) + 256
                    local cy = (c.cy or 0) * (overworld.chunkSize or 512) + 256
                    local dx = cx - me.x
                    local dy = cy - me.y
                    if dx * dx + dy * dy > EVICT_RADIUS_SQ then
                        table.insert(toRemove, ck)
                    end
                end
                for _, ck in ipairs(toRemove) do
                    overworld.chunks[ck] = nil
                    if overworld.chunkCanvases then
                        if overworld.chunkCanvases[ck] then overworld.chunkCanvases[ck]:release() end
                        overworld.chunkCanvases[ck] = nil
                    end
                end
            end
        end
    end)

    -- Plot events
    client:on("plot_claimed", function(data)
        if data and data.id then
            overworld.plots[data.id] = data
        end
    end)

    client:on("plot_unclaimed", function(data)
        if data and data.plotId then
            overworld.plots[data.plotId] = nil
            -- Clean from cached chunk data so it doesn't get re-added
            for _, chunk in pairs(overworld.chunks) do
                if chunk.plots then
                    for i = #chunk.plots, 1, -1 do
                        if chunk.plots[i].id == data.plotId then
                            table.remove(chunk.plots, i)
                        end
                    end
                end
            end
        end
    end)

    client:on("claim_plot_result", function(data)
        if not data then return end
        if data.success and data.plot then
            overworld.myPlotId = data.plot.id
            overworld.plots[data.plot.id] = data.plot
            if myId and players[myId] then
                addFloatingText({
                    text = "Plot Claimed!",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = { 0.4, 1, 0.4 },
                    timer = 3.0,
                })
            end
        else
            if myId and players[myId] then
                addFloatingText({
                    text = data.message or "Cannot claim plot",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = { 1, 0.3, 0.3 },
                    timer = 2.5,
                })
            end
        end
    end)

    client:on("unclaim_plot_result", function(data)
        if not data then return end
        if data.success then
            if overworld.myPlotId then
                overworld.plots[overworld.myPlotId] = nil
            end
            overworld.myPlotId = nil
            if data.inventory then
                mmoInventory = data.inventory
            end
            if myId and players[myId] then
                addFloatingText({
                    text = "Plot Unclaimed",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = { 1, 0.8, 0.3 },
                    timer = 2.5,
                })
            end
        else
            if myId and players[myId] then
                addFloatingText({
                    text = data.message or "Cannot unclaim",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = { 1, 0.3, 0.3 },
                    timer = 2.0,
                })
            end
        end
    end)

    client:on("unclaim_plot_confirm", function(data)
        if not data then return end
        overworld.plotUnclaimPending = true
        local me = players[myId]
        if me then
            addFloatingText({
                text = "Press [P] again to confirm plot unclaim",
                x = me.x, y = me.y - 40,
                color = {1, 0.6, 0.2},
                timer = 5,
            })
        end
    end)

    -- Mini-Rift events
    client:on("rift_spawned", function(data)
        if data and data.riftId then
            miniRifts[data.riftId] = data
        end
    end)

    client:on("rift_destroyed", function(data)
        if data and data.riftId then
            local rift = miniRifts[data.riftId]
            if rift then
                -- Trigger destruction implosion VFX at the rift position
                table.insert(riftDestroyVfx, {
                    worldX = rift.worldX,
                    worldY = rift.worldY,
                    timer = 1.5,
                    maxTimer = 1.5,
                })
            end
            miniRifts[data.riftId] = nil
        end
    end)

    client:on("rift_sealed_rewards", function(data)
        if data then
            riftRewardPopup = {
                rewards = data,
                timer = 5.0,
                maxTimer = 5.0,
            }
            -- Also add floating text at player position
            local me = players[myId]
            if me then
                addFloatingText({
                    text = "Rift Sealed!",
                    x = me.x, y = me.y - 60,
                    color = {0.8, 0.5, 1},
                    timer = 3,
                })
            end
        end
    end)

    -- Plot zone connection events
    client:on("connection_added", function(data)
        if data and connections then
            table.insert(connections, data)
        end
    end)

    client:on("connection_removed", function(data)
        if data and data.plotId and connections then
            for i = #connections, 1, -1 do
                if connections[i].plotId == data.plotId then
                    table.remove(connections, i)
                    break
                end
            end
        end
    end)

    client:on("zone_kicked", function(data)
        if data and data.returnZone and client then
            client:emit("zone_enter", {
                zoneId = data.returnZone,
                x = data.returnX,
                y = data.returnY,
            })
            if myId and players[myId] then
                addFloatingText({
                    text = data.reason or "You were removed from the zone",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = { 1, 0.8, 0.3 },
                    timer = 3.0,
                })
            end
        end
    end)

    client:on("disconnect", function(reason)
        -- Attempt reconnection before dumping to shards
        if not game._reconnecting then
            game._reconnecting = true
            game._reconnectAttempt = 0
            game._reconnectOverlay = true
            game._reconnectTimers = { 2, 5, 10 }
            game._reconnectTimer = game._reconnectTimers[1]
        end
        -- If already reconnecting, ignore subsequent disconnect events — the
        -- update loop timer manages attempt counting and retry scheduling.
    end)

    -- RPG stat events
    client:on("rpg_stats", function(data)
        if data then
            -- Detect level-up for celebration effect
            local oldLevel = rpg.level or 1
            local newLevel = data.level or 1
            if newLevel > oldLevel and oldLevel >= 1 then
                levelUpEffect = { timer = 3.0, level = newLevel, alpha = 1.0, ringRadius = 0 }
                game._audio.playLevelUp()
            end

            rpg.race = data.race
            rpg.stats = data.rpgStats
            rpg.computedStats = data.computedStats
            rpg.level = data.level or 1
            rpg.xp = data.xp or 0
            rpg.xpNeeded = data.xpNeeded or 250
            rpg.cardSlots = data.cardSlots or 4
            rpg.pendingPacks = data.pendingPacks or 0
            rpg.ascensionMark = data.ascensionMark or false
            if data.skills then skills = data.skills end
        end
    end)

    client:on("stat_updated", function(data)
        if data then
            rpg.stats = data.rpgStats
            rpg.computedStats = data.computedStats
        end
    end)

    client:on("stat_error", function(data)
        if data and data.message and myId and players[myId] then
            addFloatingText({
                text = data.message,
                x = players[myId].x, y = players[myId].y - 40,
                color = { 1, 0.3, 0.3 }, timer = 2.5,
            })
        end
    end)

    -- Dungeon: floor state (entering a floor)
    client:on("dungeon_floor_state", function(data)
        if not data then return end
        dungeon.inDungeon = true
        dungeon.id = data.dungeonId
        dungeon.floorNum = data.floorNum or 1
        dungeon.floor = data
        dungeon.grid = data.grid
        dungeon.enemies = data.enemies or {}
        -- Initialize client-side animation fields
        for _, e in ipairs(dungeon.enemies) do
            e.moveTimer = 0
            e.attackFlashTimer = 0
            e.prevX = e.x
            e.prevY = e.y
        end
        dungeon.chests = data.chests or {}
        dungeon.traps = data.traps or {}
        dungeon.npcs = data.npcs or {}
        dungeon.corpses = data.corpses or {}
        dungeon.camps = data.camps or {}
        dungeon.theme = data.theme
        dungeon.themeColor = data.themeColor
        dungeon.players = data.players or {}

        -- Set player tile position to entrance
        dungeon.playerTileX = data.entranceX or 0
        dungeon.playerTileY = data.entranceY or 0

        -- Initialize three-state fog from server data
        dungeon.fogWidth = data.width or 20
        local fogHeight = data.height or 16
        dungeon.fogState = {}
        dungeon.fog = {} -- also update legacy fog for backward compat
        for i = 0, dungeon.fogWidth * fogHeight - 1 do
            dungeon.fogState[i] = 0 -- UNSEEN
        end
        -- Apply server-sent fog state
        if data.fogVisible then
            for _, idx in ipairs(data.fogVisible) do
                dungeon.fogState[idx] = 2 -- VISIBLE
                local fx = idx % dungeon.fogWidth
                local fy = math.floor(idx / dungeon.fogWidth)
                dungeon.fog[fx .. "," .. fy] = true
            end
        end
        if data.fogRemembered then
            for _, idx in ipairs(data.fogRemembered) do
                if dungeon.fogState[idx] ~= 2 then
                    dungeon.fogState[idx] = 1 -- REMEMBERED
                    local fx = idx % dungeon.fogWidth
                    local fy = math.floor(idx / dungeon.fogWidth)
                    dungeon.fog[fx .. "," .. fy] = true
                end
            end
        end

        -- Reset minimap cache for new floor
        dungeon._minimapCanvas = nil
        dungeon._minimapDirty = true

        -- Vision metadata
        dungeon.visionType = data.visionType or "normal"
        dungeon.availableVisions = data.availableVisions or {"normal"}
        dungeon.visionRadius = data.visionRadius or 5
        dungeon.lightLevel = data.lightLevel or 0.4
        dungeon.ambientLight = data.ambientLight or 0.4
        dungeon.thermalEntities = data.thermalEntities or {}
        dungeon.tremorIndicators = data.tremorIndicators or {}
        dungeon.magicAuras = data.magicAuras or {}
        dungeon.isPitchBlack = data.isPitchBlack or false
        dungeon.placedTorches = {}
        dungeon.lightSources = data.lightSources or {}

        -- Transition dungeon ambient audio by theme
        game._audio.setAmbientForDungeon(data.theme)
        game._audio.setDarkFloor(data.isPitchBlack or (data.lightLevel and data.lightLevel < 0.2))
        game._audio.playDungeonMusic(data.theme)

        -- Initialize combat state from server
        dungeon.playerHp = data.playerHp or 100
        dungeon.playerMaxHp = data.playerMaxHp or 100
        dungeon.playerMana = data.playerMana or 50
        dungeon.playerMaxMana = data.playerMaxMana or 50
        dungeon.playerStamina = data.playerStamina or 100
        dungeon.playerMaxStamina = data.playerMaxStamina or 100

        -- Override zone for rendering
        zone = {
            id = data.dungeonId .. "_floor_" .. data.floorNum,
            name = (data.theme or "Dungeon") .. " - Floor " .. data.floorNum,
            type = "dungeon",
            width = (data.width or 20) * 32,
            height = (data.height or 16) * 32,
        }
        overworld.chunkBased = false
        MOVE_SPEED = 0  -- disable free movement in dungeon (grid-based)

        -- Position player in pixel space for camera
        local me = players[myId]
        if me then
            me.x = dungeon.playerTileX * 32 + 16
            me.y = dungeon.playerTileY * 32 + 16
        end
    end)

    -- Dungeon: server shifted walls (dynamic floor hazard)
    client:on("dungeon_wall_shift", function(data)
        if not data or not data.tiles or not dungeon.grid then return end
        for _, t in ipairs(data.tiles) do
            local gy = t.y + 1
            local gx = t.x + 1
            if dungeon.grid[gy] then
                dungeon.grid[gy][gx] = t.tile
            end
        end
    end)

    -- Dungeon: player moved (other players)
    client:on("dungeon_player_moved", function(data)
        if not data or not data.id then return end
        if data.id == myId then return end
        if dungeon.players then
            for i, p in ipairs(dungeon.players) do
                if p.id == data.id then
                    p.x = data.x
                    p.y = data.y
                    return
                end
            end
        end
    end)

    -- Dungeon: server-driven visibility update (per-player FOV delta)
    client:on("dungeon_visibility_update", function(data)
        if not data or not dungeon.inDungeon then return end

        -- Update fog state: newly remembered tiles
        if data.nowRemembered then
            for _, key in ipairs(data.nowRemembered) do
                -- key is "x,y" string
                local sx, sy = key:match("^(%d+),(%d+)$")
                if sx and sy then
                    local fx = tonumber(sx)
                    local fy = tonumber(sy)
                    local idx = fy * dungeon.fogWidth + fx
                    dungeon.fogState[idx] = 1 -- REMEMBERED
                    dungeon.fog[fx .. "," .. fy] = true
                end
            end
        end

        -- Update fog state: newly visible tiles
        if data.nowVisible then
            for _, key in ipairs(data.nowVisible) do
                local sx, sy = key:match("^(%d+),(%d+)$")
                if sx and sy then
                    local fx = tonumber(sx)
                    local fy = tonumber(sy)
                    local idx = fy * dungeon.fogWidth + fx
                    dungeon.fogState[idx] = 2 -- VISIBLE
                    dungeon.fog[fx .. "," .. fy] = true
                end
            end
        end

        -- Replace visible enemies with server-filtered set
        if data.visibleEnemies then
            -- Build a lookup of existing enemies by id for animation state preservation
            local existingByIndex = {}
            for _, e in ipairs(dungeon.enemies) do
                if e.index then existingByIndex[e.index] = e end
            end
            dungeon.enemies = {}
            for _, e in ipairs(data.visibleEnemies) do
                local existing = existingByIndex[e.index]
                if existing then
                    -- Preserve animation state, update data
                    existing.x = e.x
                    existing.y = e.y
                    existing.hp = e.hp
                    existing.maxHp = e.maxHp
                    existing.aiState = e.aiState
                    existing.facing = e.facing
                    existing.isAttacking = e.isAttacking
                    existing.windUpTimer = e.windUpTimer
                    table.insert(dungeon.enemies, existing)
                else
                    e.moveTimer = 0
                    e.attackFlashTimer = 0
                    e.prevX = e.x
                    e.prevY = e.y
                    table.insert(dungeon.enemies, e)
                end
            end
        end

        -- Update thermal and tremor data
        if data.thermalEntities then dungeon.thermalEntities = data.thermalEntities end
        if data.tremorIndicators then dungeon.tremorIndicators = data.tremorIndicators end
        if data.magicAuras then dungeon.magicAuras = data.magicAuras end

        -- Update vision metadata
        if data.visionRadius then dungeon.visionRadius = data.visionRadius end
        if data.lightLevel then dungeon.lightLevel = data.lightLevel end
        if data.isPitchBlack ~= nil then dungeon.isPitchBlack = data.isPitchBlack end
        if data.lightSources then dungeon.lightSources = data.lightSources end

        -- Invalidate minimap cache so it redraws with new visibility
        dungeon._minimapDirty = true
    end)

    -- Dungeon: torch activated/expired
    client:on("dungeon_torch_active", function(data)
        if not data then return end
        dungeon.hasTorch = data.active or false
        if data.expiresAt then dungeon.torchExpiry = data.expiresAt end
    end)

    -- Dungeon: lantern activated/expired
    client:on("dungeon_lantern_active", function(data)
        if not data then return end
        dungeon.hasLantern = data.active or false
        if data.expiresAt then dungeon.lanternExpiry = data.expiresAt end
    end)

    -- Dungeon: vision type changed (from toggle or mana depletion)
    client:on("dungeon_vision_changed", function(data)
        if not data then return end
        dungeon.visionType = data.visionType or "normal"
        if data.availableVisions then
            dungeon.availableVisions = data.availableVisions
        end
    end)

    -- Dungeon: torch placed on floor
    client:on("dungeon_torch_placed", function(data)
        if not data then return end
        table.insert(dungeon.placedTorches, {
            x = data.x, y = data.y, placedBy = data.placedBy,
            timer = data.duration or 300,
        })
    end)

    -- Dungeon: proximity chat message
    client:on("dungeon_chat_message", function(data)
        if not data then return end
        local prefix = data.isShout and "[SHOUT] " or "[Nearby] "
        addFloatingText({
            text = prefix .. (data.senderName or "?") .. ": " .. (data.message or ""),
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 60) or 0,
            color = data.isShout and {1, 0.8, 0.2} or {0.8, 0.8, 1},
            timer = 4,
        })
    end)

    -- Dungeon: combat result
    -- Dungeon: chest opened
    client:on("dungeon_chest_result", function(data)
        if not data then return end
        local cx = (data.x or 0) * 32 + 16
        local cy = (data.y or 0) * 32
        if data.gold then
            addFloatingText({
                text = "+" .. data.gold .. " gold",
                x = cx, y = cy - 10,
                color = {1, 0.85, 0.2},
                timer = 2,
            })
        end
        if data.resources then
            local yoff = -26
            for _, r in ipairs(data.resources) do
                addFloatingText({
                    text = "+1 " .. r,
                    x = cx, y = cy + yoff,
                    color = {0.4, 1, 0.4},
                    timer = 2,
                })
                yoff = yoff - 16
            end
        end
        -- Mark chest opened locally
        for _, c in ipairs(dungeon.chests) do
            if c.x == data.x and c.y == data.y then
                c.opened = true
                break
            end
        end
        if data.inventory then mmoInventory = data.inventory end
    end)

    -- Dungeon: corpse examined broadcast (by any player)
    client:on("dungeon_corpse_examined", function(data)
        if not data then return end
        for _, cr in ipairs(dungeon.corpses) do
            if cr.x == data.x and cr.y == data.y then
                cr.examined = true
                break
            end
        end
    end)

    -- Dungeon: corpse examine result (loot for this player)
    client:on("dungeon_corpse_result", function(data)
        if not data then return end
        local cx = (data.x or 0) * 32 + 16
        local cy = (data.y or 0) * 32
        -- Show name/description
        if data.name then
            addFloatingText({
                text = data.name,
                x = cx, y = cy - 30,
                color = {0.7, 0.65, 0.55},
                timer = 3,
            })
        end
        if data.gold and data.gold > 0 then
            addFloatingText({
                text = "+" .. data.gold .. " gold",
                x = cx, y = cy - 10,
                color = {1, 0.85, 0.2},
                timer = 2,
            })
        end
        if data.resource and data.resourceAmount and data.resourceAmount > 0 then
            addFloatingText({
                text = "+" .. data.resourceAmount .. " " .. data.resource,
                x = cx, y = cy - 26,
                color = {0.4, 1, 0.4},
                timer = 2,
            })
        end
        if data.hasCard then
            addFloatingText({
                text = "Card pack found!",
                x = cx, y = cy - 42,
                color = {0.9, 0.5, 1},
                timer = 2.5,
            })
        end
        if data.bookFound then
            addFloatingText({
                text = "Book discovered!",
                x = cx, y = cy - 58,
                color = {1, 0.9, 0.6},
                timer = 3,
            })
        end
        if data.xp and data.xp > 0 then
            addFloatingText({
                text = "+" .. data.xp .. " delving XP",
                x = cx, y = cy + 6,
                color = {0.5, 0.8, 1},
                timer = 2,
            })
        end
        -- Mark corpse examined locally
        for _, cr in ipairs(dungeon.corpses) do
            if cr.x == data.x and cr.y == data.y then
                cr.examined = true
                break
            end
        end
    end)

    -- Dungeon: trap triggered
    client:on("dungeon_trap_triggered", function(data)
        if not data then return end
        game._audio.playTrap()
        -- Update server-side HP
        if data.playerHp ~= nil then dungeon.playerHp = data.playerHp end
        if data.playerMaxHp ~= nil then dungeon.playerMaxHp = data.playerMaxHp end

        local me = players[myId]
        if me then
            addFloatingText({
                text = "-" .. (data.damage or 0) .. " (trap!)",
                x = me.x, y = me.y - 30,
                color = {1, 0.5, 0},
                timer = 2,
            })
        end
        -- Mark trap triggered locally
        for _, t in ipairs(dungeon.traps) do
            if t.x == data.x and t.y == data.y then
                t.triggered = true
                break
            end
        end
    end)

    -- Dungeon: NPC interaction
    client:on("dungeon_npc_result", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.dialogue or "...",
                x = me.x, y = me.y - 50,
                color = {0.8, 0.8, 1},
                timer = 3,
            })
            if data.reward == "gold" then
                addFloatingText({
                    text = "+" .. (data.amount or 0) .. " gold",
                    x = me.x, y = me.y - 66,
                    color = {1, 0.85, 0.2},
                    timer = 2,
                })
            elseif data.reward == "xp" then
                addFloatingText({
                    text = "+" .. (data.amount or 0) .. " XP",
                    x = me.x, y = me.y - 66,
                    color = {0.5, 0.8, 1},
                    timer = 2,
                })
            end
        end
        if data.npcIndex and dungeon.npcs[data.npcIndex + 1] then
            dungeon.npcs[data.npcIndex + 1].claimed = true
        end
        if data.inventory then mmoInventory = data.inventory end
    end)

    -- Dungeon: camp placed
    client:on("dungeon_camp_placed", function(data)
        if not data then return end
        if not dungeon.camps then dungeon.camps = {} end
        table.insert(dungeon.camps, data)
    end)

    -- Dungeon: camp ambush
    client:on("dungeon_camp_ambush", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = "AMBUSH! Enemies attack your camp!",
                x = me.x, y = me.y - 60,
                color = {1, 0.2, 0.2},
                timer = 3,
            })
        end
        if data.enemies then
            for _, e in ipairs(data.enemies) do
                table.insert(dungeon.enemies, e)
            end
        end
    end)

    -- Dungeon: guild signup result
    client:on("dungeon_guild_result", function(data)
        if not data then return end
        if data.success then
            if dungeon.progress then
                dungeon.progress.guildMember = true
            end
            local me = players[myId]
            if me then
                addFloatingText({
                    text = "Joined the Adventure Guild!",
                    x = me.x, y = me.y - 40,
                    color = {1, 0.85, 0.2},
                    timer = 3,
                })
            end
        end
    end)

    -- Dungeon: quest list
    client:on("dungeon_quest_list_result", function(data)
        if not data then return end
        dungeon.progress = dungeon.progress or {}
        dungeon.progress.dailyQuests = data.quests or {}
        ui.showDungeonQuests = true
    end)

    -- Dungeon: live quest progress update (push after each floor action)
    client:on("dungeon_quest_update", function(data)
        if not data then return end
        dungeon.progress = dungeon.progress or {}
        dungeon.progress.dailyQuests = data.quests or {}
    end)

    -- Dungeon: individual quest completed notification
    client:on("dungeon_quest_completed", function(data)
        if not data then return end
        local me = players[myId]
        if not me then return end
        addFloatingText({
            text = "Quest Complete: " .. (data.questName or data.questId or "Quest"),
            x = me.x, y = me.y - 56,
            color = {0.4, 1, 0.4},
            timer = 3,
        })
        local parts = {}
        if data.xpReward and data.xpReward > 0 then table.insert(parts, "+" .. data.xpReward .. " XP") end
        if data.goldReward and data.goldReward > 0 then table.insert(parts, "+" .. data.goldReward .. " Gold") end
        if #parts > 0 then
            addFloatingText({
                text = table.concat(parts, "  "),
                x = me.x, y = me.y - 72,
                color = {1, 0.85, 0.2},
                timer = 3,
            })
        end
    end)

    -- Dungeon: leaderboard
    client:on("dungeon_leaderboard_result", function(data)
        if not data then return end
        dungeon.progress = dungeon.progress or {}
        dungeon.progress.leaderboard = data
        ui.showLeaderboard = true
    end)

    -- Dungeon: enemy state update (broadcast from server, single enemy)
    client:on("dungeon_enemy_updated", function(data)
        if not data then return end
        if not dungeon.enemies then return end
        local rawIdx = data.enemyIndex or data.index
        if rawIdx == nil then return end
        local idx = rawIdx + 1
        if dungeon.enemies[idx] then
            if data.x ~= nil then
                dungeon.enemies[idx].prevX = dungeon.enemies[idx].x
                dungeon.enemies[idx].prevY = dungeon.enemies[idx].y
                dungeon.enemies[idx].x = data.x
                dungeon.enemies[idx].y = data.y or dungeon.enemies[idx].y
                dungeon.enemies[idx].moveTimer = 0.15
            end
            if data.alive ~= nil then dungeon.enemies[idx].alive = data.alive end
            if data.hp ~= nil then dungeon.enemies[idx].hp = data.hp end
            if data.maxHp ~= nil then dungeon.enemies[idx].maxHp = data.maxHp end
            if data.aiState then dungeon.enemies[idx].aiState = data.aiState end
            if data.facing then dungeon.enemies[idx].facing = data.facing end
            if data.isAttacking then dungeon.enemies[idx].isAttacking = data.isAttacking end
        end
    end)

    -- Dungeon: batch AI enemy updates (delta broadcast from tick)
    client:on("dungeon_enemies_update", function(data)
        if not data or not data.enemies then return end
        if not dungeon.enemies then return end
        for _, upd in ipairs(data.enemies) do
            local idx = (upd.index or 0) + 1
            local e = dungeon.enemies[idx]
            if e then
                if upd.x ~= nil then
                    e.prevX = e.x
                    e.prevY = e.y
                    e.x = upd.x
                    e.y = upd.y or e.y
                    e.moveTimer = 0.15
                end
                if upd.hp ~= nil then e.hp = upd.hp end
                if upd.maxHp ~= nil then e.maxHp = upd.maxHp end
                if upd.aiState then e.aiState = upd.aiState end
                if upd.facing then e.facing = upd.facing end
                if upd.isAttacking ~= nil then e.isAttacking = upd.isAttacking end
                if upd.windUpTimer then e.windUpTimer = upd.windUpTimer end
                if upd.archetype then e.archetype = upd.archetype end
            end
        end
    end)

    -- Dungeon: enemy attacks player (damage already applied server-side)
    client:on("dungeon_enemy_attack", function(data)
        if not data then return end
        local me = players[myId]
        if not me then return end

        -- Update HP from server
        if data.playerHp ~= nil then dungeon.playerHp = data.playerHp end
        if data.playerMaxHp ~= nil then dungeon.playerMaxHp = data.playerMaxHp end

        -- Hit/dodge/block sounds
        if data.dodged then game._audio.playMiss()
        elseif data.blocked then game._audio.playBlock()
        elseif data.damage and data.damage > 0 then game._audio.playHit()
        end

        -- Floating text
        if data.dodged then
            addFloatingText({
                text = "DODGE!",
                x = me.x, y = me.y - 30,
                color = {0.4, 0.9, 1},
                timer = 1.2,
            })
        elseif data.blocked then
            addFloatingText({
                text = "BLOCKED! -" .. (data.damage or 0),
                x = me.x, y = me.y - 30,
                color = {0.6, 0.8, 1},
                timer = 1.2,
            })
        elseif data.damage and data.damage > 0 then
            local atkName = data.abilityName or "Attack"
            addFloatingText({
                text = "-" .. data.damage .. " (" .. atkName .. ")",
                x = me.x, y = me.y - 30,
                color = data.isBoss and {1, 0.3, 0} or {1, 0.2, 0.2},
                timer = 1.5,
            })
        end

        -- Status effect applied
        if data.effect then
            addFloatingText({
                text = data.effect:upper() .. "!",
                x = me.x, y = me.y - 46,
                color = {0.8, 0.4, 1},
                timer = 1.5,
            })
        end

        -- Screen flash on hit
        if data.damage and data.damage > 0 and not data.dodged then
            dungeon.hitFlashTimer = 0.2
        end
    end)

    -- Dungeon: enemy attack visual (broadcast to all on floor)
    client:on("dungeon_enemy_attack_visual", function(data)
        if not data then return end
        -- Show attack line/effect from attacker to target
        if data.attackerId and data.targetId then
            for _, e in ipairs(dungeon.enemies) do
                if e.id == data.attackerId and e.alive ~= false then
                    e.attackFlashTimer = 0.3
                    break
                end
            end
        end
    end)

    -- Dungeon: enemy heal visual
    client:on("dungeon_enemy_heal", function(data)
        if not data then return end
        addFloatingText({
            text = data.attackerName .. " heals allies +" .. (data.healAmount or 0),
            x = (dungeon.playerTileX or 0) * 32,
            y = (dungeon.playerTileY or 0) * 32 - 60,
            color = {0.3, 1, 0.3},
            timer = 1.5,
        })
    end)

    -- Dungeon: boss phase change
    client:on("dungeon_boss_phase", function(data)
        if not data then return end
        addFloatingText({
            text = "BOSS PHASE " .. (data.phase or "?") .. ": " .. (data.phaseName or ""),
            x = (dungeon.playerTileX or 0) * 32,
            y = (dungeon.playerTileY or 0) * 32 - 80,
            color = {1, 0.2, 0.8},
            timer = 3,
        })
        dungeon.bossPhaseFlash = 0.5
    end)

    -- Dungeon: player died
    client:on("dungeon_player_died", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = "You have fallen! Returning to town...",
                x = me.x, y = me.y - 40,
                color = {1, 0, 0},
                timer = 3,
            })
        end
        -- Server will send zone_state for town shortly
        dungeon.inDungeon = false
        dungeon.floor = nil
        dungeon.grid = nil
        dungeon.lightSources = {}
        dungeonParticles.cleanup()
        -- Clear combat state on death
        if tcState.inCombat then
            tcState.inCombat = false
            tcState.combatId = nil
            tcState.combatMyTurn = false
            tcState.combatMyUnitId = nil
            combatUI.cleanup()
            combatAnim.clear()
        end
        tcState.overworldCombat = false
        tcState.overworldCombat_savedPos = nil
    end)

    -- Permadeath: player downed (bleedout state)
    client:on("player_downed", function(data)
        if not data then return end
        game._audio.playDeath()
        permadeath.isDowned = true
        permadeath.bleedoutTimer = data.timeRemaining or 120
        permadeath.causeOfDeath = data.causeOfDeath or "Unknown"
        -- Clear combat state
        if tcState.inCombat then
            tcState.inCombat = false
            tcState.combatId = nil
            tcState.combatMyTurn = false
            tcState.combatMyUnitId = nil
            combatUI.cleanup()
            combatAnim.clear()
        end
    end)

    -- Permadeath: another player downed on our floor
    client:on("player_downed_notification", function(data)
        if not data then return end
        permadeath.downedPlayers[data.playerId] = {
            name = data.playerName or "Unknown",
            x = data.x or 0,
            y = data.y or 0,
        }
        addFloatingText({
            text = (data.playerName or "A player") .. " has been downed!",
            x = (data.x or 0) * 32 + 16, y = (data.y or 0) * 32 - 20,
            color = {1, 0.3, 0.3},
            timer = 5,
        })
    end)

    -- Permadeath: player revived
    client:on("player_revived", function(data)
        if not data then return end
        if data.playerId == myId then
            -- We were revived
            permadeath.isDowned = false
            permadeath.bleedoutTimer = 0
            permadeath.causeOfDeath = nil
            addFloatingText({
                text = "Revived by " .. (data.reviverName or "someone") .. "!",
                x = players[myId] and players[myId].x or 400,
                y = players[myId] and (players[myId].y - 40) or 300,
                color = {0.3, 1, 0.3},
                timer = 3,
            })
        else
            -- Someone else was revived, remove from downed list
            permadeath.downedPlayers[data.playerId] = nil
            addFloatingText({
                text = (data.playerName or "A player") .. " was revived!",
                x = 400, y = 300,
                color = {0.3, 1, 0.3},
                timer = 3,
            })
        end
    end)

    -- Permadeath: final death — show epitaph
    client:on("permadeath_triggered", function(data)
        if not data then return end
        permadeath.isDowned = false
        permadeath.bleedoutTimer = 0
        permadeath.showDeathScreen = true
        permadeath.deathHero = data.hero
        permadeath.hasCharsLeft = data.hasCharactersLeft ~= false
        -- Clear dungeon state
        dungeon.inDungeon = false
        dungeon.floor = nil
        dungeon.grid = nil
        dungeon.lightSources = {}
        dungeonParticles.cleanup()
        if tcState.inCombat then
            tcState.inCombat = false
            tcState.combatId = nil
            tcState.combatMyTurn = false
            tcState.combatMyUnitId = nil
            combatUI.cleanup()
            combatAnim.clear()
        end
    end)

    -- Hall of Heroes result
    client:on("hall_of_heroes_result", function(data)
        if not data then return end
        permadeath.hallOfHeroesList = data.heroes or {}
        permadeath.showHallOfHeroes = true
    end)

    -- Dungeon: combat state update (HP/mana/stamina + weapon special + inscriptions)
    client:on("dungeon_combat_state", function(data)
        if not data then return end
        if data.hp ~= nil then dungeon.playerHp = data.hp end
        if data.maxHp ~= nil then dungeon.playerMaxHp = data.maxHp end
        if data.mana ~= nil then dungeon.playerMana = data.mana end
        if data.maxMana ~= nil then dungeon.playerMaxMana = data.maxMana end
        if data.stamina ~= nil then dungeon.playerStamina = data.stamina end
        if data.maxStamina ~= nil then dungeon.playerMaxStamina = data.maxStamina end
        -- Weapon special charge
        if data.weaponSpecialCharge ~= nil then game._itemUI.weaponSpecialCharge = data.weaponSpecialCharge end
        if data.weaponSpecialMax ~= nil then game._itemUI.weaponSpecialMax = data.weaponSpecialMax end
        if data.weaponSpecialName ~= nil then game._itemUI.weaponSpecialName = data.weaponSpecialName end
        -- Inscription slot cooldowns
        if data.inscriptionSlots then game._itemUI.inscriptionSlots = data.inscriptionSlots end
    end)

    -- Loot drop notification (procedural items from dungeons)
    client:on("loot_dropped", function(data)
        if not data or not data.item then return end
        game._audio.playItemPickup()
        local item = data.item
        local rc = game.getItemRarityColor(item)
        local name = game.getItemDisplayName(item)
        local notif = {
            text = name,
            color = rc,
            source = data.source or "loot",
            timer = 4.0,
            alpha = 1.0,
        }
        table.insert(game._itemUI.lootNotifications, 1, notif)
        -- Cap game._notifications
        while #game._itemUI.lootNotifications > (game._itemUI.maxLootNotifs or 5) do
            table.remove(game._itemUI.lootNotifications)
        end
    end)

    -- ================================================================
    -- Tactical Combat socket listeners
    -- ================================================================

    -- Combat start: enter turn-based combat mode
    client:on("tc_combat_start", function(data)
        if not data then return end
        -- Guard against duplicate combat start
        if tcState.inCombat and tcState.combatId == data.combatId then return end
        tcState.inCombat = true
        tcState.combatId = data.combatId
        tcState.combatMyUnitId = data.myUnitId
        tcState.combatMyTurn = false

        -- Detect overworld combat: server sends arenaGrid when not in dungeon
        if data.arenaGrid and not dungeon.inDungeon then
            tcState.overworldCombat = true
            -- Save overworld state for camera restoration
            tcState.overworldCombat_savedPos = { x = players[myId] and players[myId].x, y = players[myId] and players[myId].y }
            -- Set up dungeon rendering for the arena
            dungeon.grid = data.arenaGrid
            dungeon.themeColor = data.arenaTheme
            dungeon.fog = {}
            dungeon.enemies = {}
            dungeon.chests = {}
            dungeon.corpses = {}
            dungeon.traps = {}
            -- Reveal all tiles (no fog of war in overworld combat)
            dungeon.fogWidth = #(data.arenaGrid[1] or {})
            dungeon.fogState = {}
            for y = 1, #data.arenaGrid do
                for x = 1, #(data.arenaGrid[y] or {}) do
                    local idx = (y - 1) * dungeon.fogWidth + (x - 1)
                    dungeon.fogState[idx] = 2  -- VISIBLE
                    dungeon.fog[(x-1) .. "," .. (y-1)] = true
                end
            end
            -- Center camera on arena
            local arenaW = #(data.arenaGrid[1] or {}) * 32
            local arenaH = #data.arenaGrid * 32
            camera.x = arenaW / 2 - love.graphics.getWidth() / 2
            camera.y = arenaH / 2 - love.graphics.getHeight() / 2
        end

        -- Combat start audio: SFX + music
        game._audio.playCombatStart()
        game._audio.playRandomCombatMusic()

        -- Initialize combat UI and animation systems
        combatUI.init(data)
        combatAnim.init()

        -- Store group scaling info for HUD display
        _G.groupScaling = data.groupScaling

        -- Play combat start transition (surprise round banner if applicable)
        local startText = "COMBAT START"
        if data.surpriseRound and data.surpriseRound.message then
            startText = data.surpriseRound.message
        end
        combatAnim.queue({ type = "transition_in", text = startText, elapsed = 0 })
    end)

    -- Player turn started
    client:on("tc_combat_turn", function(data)
        if not data then return end
        tcState.combatMyTurn = true
        combatUI.setMyTurn(true, data)
        combatUI.showTurnBanner("YOUR TURN")
    end)

    -- Action result from server (damage, movement, etc)
    -- Updated initiative order
    client:on("tc_combat_initiative", function(data)
        if not data then return end
        combatUI.updateState(data)
    end)

    -- Reaction prompt (Phase 4)
    client:on("tc_combat_reaction", function(data)
        if not data then return end
        combatUI.setReactionPrompt(data)
    end)

    -- Reaction result
    client:on("tc_combat_reaction_result", function(data)
        if not data then return end
        combatUI.clearReactionPrompt()
        if data.reactionType and data.reactionType ~= "pass" then
            combatAnim.queue({
                type = "reaction",
                unitId = data.defenderId,
                reactionType = data.reactionType,
                success = data.success,
                elapsed = 0,
            })
        end
    end)

    -- Combat ended: exit combat mode
    client:on("tc_combat_end", function(data)
        if not data then return end

        -- Combat end audio
        if data.result == "victory" then game._audio.playVictory() else game._audio.playDefeat() end
        game._audio.stopMusic(2)

        -- Play end transition
        local endText = data.result == "victory" and "VICTORY" or "DEFEAT"
        combatAnim.queue({ type = "transition_out", text = endText, elapsed = 0 })

        -- Show rewards
        if data.result == "victory" and data.rewards then
            local rewardText = ""
            if data.rewards.xp then rewardText = rewardText .. "+" .. data.rewards.xp .. " XP " end
            if data.rewards.gold then rewardText = rewardText .. "+" .. data.rewards.gold .. " Gold " end
            if rewardText ~= "" then
                addFloatingText({
                    text = rewardText,
                    x = (dungeon.playerTileX or 0) * 32,
                    y = (dungeon.playerTileY or 0) * 32 - 60,
                    color = {1, 1, 0.3},
                    timer = 3,
                })
            end
        end

        -- Clear group scaling info
        _G.groupScaling = nil

        -- Clean up overworld combat state (only if not in a real dungeon)
        if tcState.overworldCombat and not dungeon.inDungeon then
            tcState.overworldCombat = false
            dungeon.grid = nil
            dungeon.themeColor = nil
            dungeon.fog = {}
            dungeon.enemies = {}
            dungeon.chests = {}
            dungeon.corpses = {}
            dungeon.traps = {}
            -- Camera will snap back to player on next frame via normal follow logic
            tcState.overworldCombat_savedPos = nil
        end

        -- Delay cleanup to let transition play
        -- (combatAnim.isPlaying() will gate input until done)
        tcState.inCombat = false
        tcState.combatId = nil
        tcState.combatMyTurn = false
        tcState.combatMyUnitId = nil
        combatUI.cleanup()
        -- Don't clear combatAnim yet — let transition finish
    end)

    -- Late-join offer: nearby active combat
    client:on("tc_combat_join_offer", function(data)
        if not data or tcState.inCombat then return end
        -- Store the offer so the player can accept with a keypress
        dungeon.combatJoinOffer = {
            combatId = data.combatId,
            enemyCount = data.enemyCount or 0,
            allyCount = data.allyCount or 0,
            timer = 10, -- 10 second window to accept
        }
    end)

    -- Combat error
    client:on("tc_combat_error", function(data)
        if not data then return end
        addFloatingText({
            text = data.message or "Combat error",
            x = (dungeon.playerTileX or 0) * 32,
            y = (dungeon.playerTileY or 0) * 32 - 40,
            color = {1, 0.3, 0.3},
            timer = 2,
        })
    end)

    -- ================================================================
    -- End tactical combat listeners
    -- ================================================================

    -- -----------------------------------------------------------------------
    -- Combat ability listeners (overworld weapon/card abilities)
    -- -----------------------------------------------------------------------

    -- Dungeon: error message
    client:on("dungeon_error", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.message or "Error",
                x = me.x, y = me.y - 40,
                color = {1, 0.3, 0.3},
                timer = 2.5,
            })
        end
    end)

    -- Cave routing: server tells us a cave is a dungeon
    client:on("cave_is_dungeon", function(data)
        if not data then return end
        -- Enter the dungeon
        client:emit("dungeon_enter", {
            dungeonId = data.dungeonId,
        })
    end)

    -- Raid: state update (waiting/active/completed)
    client:on("raid_state_update", function(data)
        if not data then return end
        game._raid.state = {
            state = data.state or "waiting",
            playerCount = data.playerCount or 0,
            minPlayers = data.minPlayers or 8,
            bossName = data.bossName or "Raid Boss",
            barrierActive = data.barrierActive,
        }
    end)

    -- Raid: barrier drops, boss ready
    client:on("raid_boss_ready", function(data)
        if not data then return end
        if game._raid.state then
            game._raid.state.state = "active"
            game._raid.state.barrierActive = false
        end
        local me = players[myId]
        if me then
            addFloatingText({
                text = "THE BARRIER HAS FALLEN!",
                x = me.x, y = me.y - 60,
                color = {1, 0.85, 0.2},
                timer = 4,
            })
        end
    end)

    -- Raid: boss HP update for health bar
    client:on("raid_boss_hp", function(data)
        if not data then return end
        game._raid.bossHp = {
            hp = data.hp or 0,
            maxHp = data.maxHp or 1,
            name = data.name or "Raid Boss",
            phase = data.phase or 1,
        }
    end)

    -- Raid: wipe notification
    client:on("raid_boss_wipe", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = "RAID WIPE #" .. (data.wipeCount or 1) .. " - Boss at " .. math.floor((data.bossHpPercent or 100)) .. "%",
                x = me.x, y = me.y - 60,
                color = {1, 0.3, 0.3},
                timer = 4,
            })
        end
    end)

    -- Raid: mechanic announcement
    client:on("raid_boss_mechanic", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = (data.name or "Mechanic") .. ": " .. (data.description or ""),
                x = me.x, y = me.y - 50,
                color = {1, 0.7, 0.2},
                timer = 3.5,
            })
        end
    end)

    -- ================================================================
    -- Lich Raid event listeners
    -- ================================================================

    client:on("raid_gathering_update", function(data)
        if not data then return end
        game._raid.gathering = {
            totalPlayers = data.totalPlayers or 0,
            minRequired = data.minRequired or 16,
            maxAllowed = data.maxAllowed or 32,
            parties = data.parties or {},
            countdownStarted = data.countdownStarted or false,
            countdownEndsAt = data.countdownEndsAt or 0,
            phase = data.phase or "gathering",
        }
    end)

    client:on("raid_joined", function(data)
        if not data then return end
        game._raid.myParty = data.partyId
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.message or "Joined the Lich Raid!",
                x = me.x, y = me.y - 60,
                color = {0.8, 0.6, 1},
                timer = 4,
            })
        end
    end)

    client:on("raid_activated", function(data)
        if not data then return end
        game._raid.gathering = nil
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.message or "RAID ACTIVATED!",
                x = me.x, y = me.y - 60,
                color = {1, 0.85, 0.2},
                timer = 5,
            })
        end
        -- Auto-enter game._raid floor
        if client then client:emit("raid_enter_floor", {}) end
    end)

    client:on("raid_cancelled", function(data)
        game._raid.gathering = nil
        game._raid.myParty = nil
        local me = players[myId]
        if me then
            addFloatingText({
                text = data and data.message or "Raid cancelled.",
                x = me.x, y = me.y - 60,
                color = {1, 0.3, 0.3},
                timer = 4,
            })
        end
    end)

    client:on("raid_warning", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.message or "Raid warning",
                x = me.x, y = me.y - 70,
                color = {1, 0.7, 0.2},
                timer = 5,
            })
        end
    end)

    client:on("raid_boss_phase", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.message or "Boss phase change!",
                x = me.x, y = me.y - 70,
                color = {1, 0.5, 0.8},
                timer = 5,
            })
        end
    end)

    client:on("raid_boss_engage", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.message or "THE BATTLE BEGINS!",
                x = me.x, y = me.y - 80,
                color = {1, 0, 0},
                timer = 5,
            })
        end
    end)

    client:on("raid_complete", function(data)
        game._raid.gathering = nil
        game._raid.myParty = nil
        game._raid.phase = nil
        game._raid.corruptionZones = {}
        game._raid.phylacteries = {}
        local me = players[myId]
        if me then
            addFloatingText({
                text = data and data.message or "RAID COMPLETE!",
                x = me.x, y = me.y - 80,
                color = {1, 0.85, 0.2},
                timer = 6,
            })
        end
    end)

    client:on("corruption_cleanse_result", function(data)
        if not data then return end
        if data.success then
            -- Start purification VFX
            local me = players[myId]
            if me then
                game._raid.purificationVfx = { x = me.x, y = me.y, timer = 2.0, maxTimer = 2.0, radius = 0 }
                addFloatingText({
                    text = "Corruption cleansed! (" .. (data.cleansed or 0) .. " chunks)",
                    x = me.x, y = me.y - 50,
                    color = {0.9, 0.9, 1},
                    timer = 3,
                })
            end
            -- Update local corruption data
            if data.chunks then
                for key, level in pairs(data.chunks) do
                    if level > 0 then
                        corruption.chunks[key] = level
                    else
                        corruption.chunks[key] = nil
                    end
                end
            end
        else
            local me = players[myId]
            if me then
                addFloatingText({
                    text = data.reason or "Cannot cleanse here.",
                    x = me.x, y = me.y - 40,
                    color = {1, 0.5, 0.5},
                    timer = 2,
                })
            end
        end
    end)

    client:on("corruption_card_cleanse_result", function(data)
        if not data then return end
        if data.success then
            local me = players[myId]
            if me then
                -- Dramatic purification VFX (bigger than crystal cleanse)
                game._raid.purificationVfx = { x = me.x, y = me.y, timer = 3.0, maxTimer = 3.0, radius = 0 }
                addFloatingText({
                    text = (data.cardName or "Holy Power") .. "! " .. (data.cleansed or 0) .. " chunks cleansed!",
                    x = me.x, y = me.y - 60,
                    color = {1, 0.9, 0.5},
                    timer = 3,
                })
                -- Show HP/mana cost warning
                addFloatingText({
                    text = "-" .. (data.hpCost or 0) .. " HP  -" .. (data.manaCost or 0) .. " Mana",
                    x = me.x, y = me.y - 35,
                    color = {1, 0.3, 0.3},
                    timer = 2.5,
                })
                if data.debuff then
                    addFloatingText({
                        text = "Spiritually Drained...",
                        x = me.x, y = me.y - 15,
                        color = {0.7, 0.4, 0.8},
                        timer = 3,
                    })
                end
            end
            -- Update local corruption data
            if data.chunks then
                for key, level in pairs(data.chunks) do
                    if level > 0 then
                        corruption.chunks[key] = level
                    else
                        corruption.chunks[key] = nil
                    end
                end
            end
        else
            local me = players[myId]
            if me then
                addFloatingText({
                    text = data.reason or "Cannot channel here.",
                    x = me.x, y = me.y - 40,
                    color = {1, 0.5, 0.5},
                    timer = 2,
                })
            end
        end
    end)

    client:on("tc_boss_phase_change", function(data)
        if not data then return end
        game._raid.phase = {
            phase = data.phase or 1,
            phaseName = data.phaseName or "",
            message = data.message or "",
        }
        local me = players[myId]
        if me then
            addFloatingText({
                text = "PHASE " .. (data.phase or "?") .. ": " .. (data.phaseName or ""),
                x = me.x, y = me.y - 90,
                color = {1, 0.7, 0.2},
                timer = 5,
            })
        end
    end)

    client:on("tc_units_spawned", function(data)
        if not data or not data.units then return end
        for _, unit in ipairs(data.units) do
            if unit.isPhylactery then
                table.insert(game._raid.phylacteries, {
                    id = unit.id,
                    hp = unit.hp or 100,
                    maxHp = unit.maxHp or 100,
                    name = unit.name or "Phylactery",
                })
            end
        end
        local me = players[myId]
        if me and #data.units > 0 then
            addFloatingText({
                text = data.units[1].name .. " appears!",
                x = me.x, y = me.y - 60,
                color = {0.8, 0.3, 1},
                timer = 3,
            })
        end
    end)

    client:on("tc_corruption_zones", function(data)
        if not data or not data.zones then return end
        game._raid.corruptionZones = {}
        for _, zone in ipairs(data.zones) do
            table.insert(game._raid.corruptionZones, {
                x = zone.x or 0, y = zone.y or 0,
                radius = zone.radius or 1,
                damage = zone.damage or 20,
                timer = 2.0,  -- active for 2 turns displayed
            })
        end
    end)

    client:on("tc_boss_soul_harvest", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = "SOUL HARVEST! -" .. (data.damage or 0),
                x = me.x, y = me.y - 70,
                color = {0.6, 0.1, 0.8},
                timer = 3,
            })
        end
    end)

    client:on("tc_boss_attack", function(data)
        if not data then return end
        local me = players[myId]
        if me and data.ability then
            addFloatingText({
                text = (data.ability.name or "Attack") .. " [" .. (data.targetMode or "") .. "]",
                x = me.x, y = me.y - 50,
                color = {1, 0.4, 0.4},
                timer = 2.5,
            })
        end
    end)

    -- ================================================================
    -- Party event listeners
    -- ================================================================

    client:on("party_created", function(data)
        if not data then return end
        game._raid.partyData = {
            partyId = data.partyId,
            leader = data.leader,
            members = data.members or {},
        }
        local me = players[myId]
        if me then
            addFloatingText({
                text = "Party created!",
                x = me.x, y = me.y - 40,
                color = {0.4, 0.7, 1},
                timer = 2.5,
            })
        end
    end)

    client:on("party_updated", function(data)
        if not data then return end
        game._raid.partyData = game._raid.partyData or {}
        game._raid.partyData.partyId = data.partyId or (game._raid.partyData and game._raid.partyData.partyId)
        game._raid.partyData.leader = data.leader
        game._raid.partyData.members = data.members or {}
        -- Show event message if provided
        if data.event then
            local me = players[myId]
            if me then
                addFloatingText({
                    text = data.event,
                    x = me.x, y = me.y - 40,
                    color = {0.4, 0.7, 1},
                    timer = 2.5,
                })
            end
        end
    end)

    client:on("party_disbanded", function(data)
        game._raid.partyData = nil
        local me = players[myId]
        if me then
            addFloatingText({
                text = "Party disbanded",
                x = me.x, y = me.y - 40,
                color = {1, 0.8, 0.3},
                timer = 2.5,
            })
        end
    end)

    client:on("party_left", function(data)
        game._raid.partyData = nil
        local me = players[myId]
        if me then
            addFloatingText({
                text = "You left the party",
                x = me.x, y = me.y - 40,
                color = {0.7, 0.7, 0.8},
                timer = 2,
            })
        end
    end)

    client:on("party_kicked", function(data)
        game._raid.partyData = nil
        local me = players[myId]
        if me then
            addFloatingText({
                text = "You were kicked from the party",
                x = me.x, y = me.y - 40,
                color = {1, 0.5, 0.3},
                timer = 3,
            })
        end
    end)

    client:on("party_invite_received", function(data)
        if not data then return end
        game._raid.partyInvitePending = {
            fromId = data.fromId,
            fromName = data.fromName or "Someone",
            partyId = data.partyId,
        }
        local me = players[myId]
        if me then
            addFloatingText({
                text = (data.fromName or "Someone") .. " invited you to a party!",
                x = me.x, y = me.y - 40,
                color = {0.4, 0.7, 1},
                timer = 4,
            })
        end
    end)

    client:on("party_invite_sent", function(data)
        -- Confirmation already shown from context menu action
    end)

    client:on("party_message", function(data)
        if not data then return end
        table.insert(chat.messages, {
            authorName = "[Party] " .. (data.authorName or "?"),
            authorColor = data.authorColor or "#66AAFF",
            content = data.content or "",
            timestamp = data.timestamp,
            chatType = "party",
            _localTime = love.timer.getTime(),
        })
        while #chat.messages > 50 do
            table.remove(chat.messages, 1)
        end
    end)

    client:on("party_error", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.message or "Party error",
                x = me.x, y = me.y - 40,
                color = {1, 0.3, 0.3},
                timer = 2.5,
            })
        end
    end)

    -- ================================================================
    -- Leviathan event handlers
    -- ================================================================

    client:on("leviathan_positions", function(data)
        if not data or not data.leviathans then return end
        overworld.leviathans = data.leviathans
    end)

    client:on("leviathan_warning", function(data)
        if not data then return end
        overworld.leviathanWarning = data
        overworld.leviathanWarningTimer = 5
    end)

    client:on("leviathan_aggro", function(data)
        if not data then return end
        overworld.leviathanAggro = data
        overworld.leviathanAggroTimer = (data.fleeWindowMs or 5000) / 1000
    end)

    client:on("leviathan_combat_start", function(data)
        if not data then return end
        overworld.leviathanCombatName = data.leviathanName
        overworld.leviathanParts = {}
        if data.parts then
            for _, p in ipairs(data.parts) do
                overworld.leviathanParts[p.id] = {
                    id = p.id,
                    name = p.name,
                    hp = p.hp,
                    maxHp = p.maxHp or p.hp,
                    alive = true,
                }
            end
        end
        overworld.leviathanAggro = nil
        overworld.leviathanAggroTimer = 0
        overworld.leviathanWarning = nil
        overworld.leviathanWarningTimer = 0
    end)

    client:on("leviathan_part_destroyed", function(data)
        if not data then return end
        if overworld.leviathanParts and data.partId then
            local part = overworld.leviathanParts[data.partId]
            if part then
                part.alive = false
                part.hp = 0
            end
        end
        local me = players[myId]
        if me then
            addFloatingText({
                text = (data.partName or "Part") .. " DESTROYED! " .. (data.effect or ""),
                x = me.x, y = me.y - 60,
                color = {1, 0.8, 0.2},
                timer = 3.0,
            })
        end
    end)

    client:on("leviathan_phase_change", function(data)
        if not data then return end
        overworld.leviathanPhaseText = data.description or ("Phase: " .. (data.phase or "???"))
        overworld.leviathanPhaseTimer = 4
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.description or ("PHASE: " .. (data.phase or "")),
                x = me.x, y = me.y - 80,
                color = {1, 0.5, 0},
                timer = 3.5,
            })
        end
    end)

    client:on("leviathan_enrage", function(data)
        if not data then return end
        overworld.leviathanEnraged = true
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.message or "BERSERK RAGE!",
                x = me.x, y = me.y - 80,
                color = {1, 0, 0},
                timer = 4.0,
            })
        end
    end)

    client:on("leviathan_flee_success", function(data)
        if not data then return end
        overworld.leviathanAggro = nil
        overworld.leviathanAggroTimer = 0
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.message or "Escaped!",
                x = me.x, y = me.y - 40,
                color = {0.3, 1, 0.3},
                timer = 2.5,
            })
        end
    end)

    client:on("leviathan_flee_failed", function(data)
        if not data then return end
        overworld.leviathanAggro = nil
        overworld.leviathanAggroTimer = 0
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.message or "Flee failed!",
                x = me.x, y = me.y - 40,
                color = {1, 0.3, 0.3},
                timer = 2.5,
            })
        end
    end)

    client:on("leviathan_info_result", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            local info = data.name .. " [" .. (data.tier or "?") .. "] HP:" .. (data.totalHp or "?")
            addFloatingText({
                text = info,
                x = me.x, y = me.y - 40,
                color = {0.6, 0.8, 1},
                timer = 4.0,
            })
        end
    end)

    -- ================================================================
    -- Missing dungeon event handlers
    -- ================================================================

    -- Dungeon: camp cooking/rest/shrine result
    client:on("dungeon_camp_result", function(data)
        if not data then return end
        local me = players[myId]
        if not me then return end

        if data.success then
            -- Show result message
            if data.action == "cook" and data.output then
                local itemName = (data.output or ""):gsub("_", " ")
                itemName = itemName:gsub("(%a)([%w_']*)", function(a, b) return a:upper()..b end)
                addFloatingText({
                    text = "Cooked " .. itemName .. "! +" .. (data.healAmount or 0) .. " HP",
                    x = me.x, y = me.y - 40,
                    color = {0.4, 1, 0.4},
                    timer = 2.5,
                })
            elseif data.action == "rest" then
                addFloatingText({
                    text = "Rested: +" .. (data.healAmount or 0) .. " HP",
                    x = me.x, y = me.y - 40,
                    color = {0.4, 1, 0.4},
                    timer = 2.5,
                })
            elseif data.action == "use_shrine" and data.buff then
                addFloatingText({
                    text = (data.buff.name or "Buff") .. " (" .. (data.buff.duration or 0) .. "s)",
                    x = me.x, y = me.y - 40,
                    color = {1, 1, 0.3},
                    timer = 3,
                })
            elseif data.action == "light_campfire" then
                addFloatingText({
                    text = "Campfire lit!",
                    x = me.x, y = me.y - 40,
                    color = {1, 0.7, 0.2},
                    timer = 2,
                })
            else
                addFloatingText({
                    text = data.message or "Done",
                    x = me.x, y = me.y - 40,
                    color = {0.4, 1, 0.4},
                    timer = 2,
                })
            end

            -- Ambush warning
            if data.ambushed then
                addFloatingText({
                    text = "Ambushed while resting!",
                    x = me.x, y = me.y - 56,
                    color = {1, 0.2, 0.2},
                    timer = 3,
                })
            end
        else
            addFloatingText({
                text = data.message or "Failed!",
                x = me.x, y = me.y - 40,
                color = {1, 0.3, 0.3},
                timer = 2,
            })
        end

        -- Update HP if server sent updated values
        if data.playerHp ~= nil then dungeon.playerHp = data.playerHp end
        if data.playerMaxHp ~= nil then dungeon.playerMaxHp = data.playerMaxHp end
    end)

    -- Dungeon: harvest result (resource gathering inside dungeon)
    client:on("dungeon_harvest_result", function(data)
        if not data then return end
        local me = players[myId]
        if not me then return end

        addFloatingText({
            text = "+1 Resource",
            x = me.x, y = me.y - 40,
            color = {0.4, 1, 0.4},
            timer = 2,
        })

        if data.xp and data.xp > 0 then
            addFloatingText({
                text = "+" .. data.xp .. " Dungeon Dwelling XP",
                x = me.x, y = me.y - 56,
                color = {0.5, 0.8, 1},
                timer = 2,
            })
        end

        -- Update skill if provided
        if data.skillResult and skills then
            skills.dungeon_dwelling = skills.dungeon_dwelling or {}
            if data.skillResult.level then
                skills.dungeon_dwelling.level = data.skillResult.level
            end
            if data.skillResult.xp then
                skills.dungeon_dwelling.xp = data.skillResult.xp
            end
        end
    end)

    -- Dungeon: quest completion result
    client:on("dungeon_quest_complete_result", function(data)
        if not data then return end
        local me = players[myId]
        if not me then return end

        -- Reward summary
        local rewardParts = {}
        if data.xpRewarded and data.xpRewarded > 0 then
            table.insert(rewardParts, "+" .. data.xpRewarded .. " XP")
        end
        if data.goldRewarded and data.goldRewarded > 0 then
            table.insert(rewardParts, "+" .. data.goldRewarded .. " Gold")
        end
        if data.guildXpGain and data.guildXpGain > 0 then
            table.insert(rewardParts, "+" .. data.guildXpGain .. " Guild XP")
        end

        addFloatingText({
            text = "Quest Complete!",
            x = me.x, y = me.y - 40,
            color = {0.4, 1, 0.4},
            timer = 3,
        })

        if #rewardParts > 0 then
            addFloatingText({
                text = table.concat(rewardParts, "  "),
                x = me.x, y = me.y - 56,
                color = {1, 0.85, 0.2},
                timer = 3,
            })
        end

        -- Rank promotion
        if data.promoted then
            addFloatingText({
                text = "RANK UP! " .. (data.guildRank or ""):upper(),
                x = me.x, y = me.y - 72,
                color = {1, 1, 0.3},
                timer = 4,
            })
        end

        -- Update local dungeon progress
        if dungeon.progress then
            if data.guildXp then dungeon.progress.guildXp = data.guildXp end
            if data.guildRank then dungeon.progress.guildRank = data.guildRank end
        end
    end)

    -- Dungeon: trap detected (warning before triggering)
    client:on("dungeon_trap_detected", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.message or "Trap detected!",
                x = me.x, y = me.y - 40,
                color = {1, 1, 0.3},
                timer = 2.5,
            })
        end
        -- Flash the trap tile on the dungeon grid
        if data.x and data.y then
            for _, t in ipairs(dungeon.traps) do
                if t.x == data.x and t.y == data.y then
                    t.detected = true
                    break
                end
            end
        end
    end)

    -- Dungeon: shortcut found (floor skip notification)
    client:on("dungeon_shortcut_found", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = "Shortcut discovered!",
                x = me.x, y = me.y - 40,
                color = {0.3, 1, 0.7},
                timer = 3,
            })
            if data.floorsSkipped and data.floorsSkipped > 0 then
                addFloatingText({
                    text = "Skipping " .. data.floorsSkipped .. " floor" .. (data.floorsSkipped > 1 and "s" or "") .. "!",
                    x = me.x, y = me.y - 56,
                    color = {0.3, 0.9, 0.7},
                    timer = 3,
                })
            end
        end
    end)

    -- Dungeon: notification (special events, shrines, merchants)
    client:on("dungeon_notification", function(data)
        if not data then return end
        if data.title then
            addChatMessage("[Dungeon] " .. data.title .. (data.message and (": " .. data.message) or ""), {1, 0.85, 0.3})
        elseif data.message then
            addChatMessage(data.message, {1, 0.85, 0.3})
        end
    end)

    -- Dungeon: ambush (hidden enemy revealed)
    client:on("dungeon_ambush", function(data)
        if not data then return end
        addChatMessage(data.message or "Ambush!", {1, 0.3, 0.3})
        dungeon.hitFlashTimer = 0.3
    end)

    -- Dungeon: mana update (after spending mana on abilities)
    client:on("dungeon_mana_update", function(data)
        if not data then return end
        if data.mana ~= nil then dungeon.playerMana = data.mana end
        if data.maxMana ~= nil then dungeon.playerMaxMana = data.maxMana end
    end)

    -- Dungeon: heal (out-of-combat passive heal between floors)
    client:on("dungeon_heal", function(data)
        if not data then return end
        if data.hp ~= nil then dungeon.playerHp = data.hp end
        if data.maxHp ~= nil then dungeon.playerMaxHp = data.maxHp end
        if data.message then
            addChatMessage(data.message, {0.3, 1, 0.5})
        end
    end)

    -- Dungeon: form interact result (shapeshift puzzle interactions)
    client:on("dungeon_form_interact_result", function(data)
        if not data then return end
        if data.message then
            local color = data.success and {0.3, 1, 0.5} or {1, 0.5, 0.2}
            addChatMessage(data.message, color)
        end
    end)

    -- Dungeon: animal interact result (animal communication in dungeon)
    client:on("dungeon_animal_interact_result", function(data)
        if not data then return end
        if data.message then
            local color = data.success and {0.5, 0.9, 0.7} or {1, 0.7, 0.3}
            addChatMessage(data.message, color)
        end
    end)

    -- Dungeon: warning (level too low, dangerous area)
    client:on("dungeon_warning", function(data)
        if not data then return end
        addChatMessage(data.message or "Warning!", {1, 0.8, 0.3})
    end)

    -- Dungeon: combat use card result (card ability feedback in dungeon combat)
    client:on("dungeon_combat_use_card_result", function(data)
        if not data then return end
        if not data.ok then
            addChatMessage(data.error or "Card ability failed", {1, 0.3, 0.3})
        end
    end)

    -- ================================================================
    -- Admin panel event listeners (for server hosts)

    -- ========================================================================
    -- NPC Dialogue event listeners

    -- ========================================================================
    -- Affliction cure events (lycanthropy, vampire exposure)

    -- ========================================================================
    -- Quest event listeners

    -- ========================================================================
    -- Monster capture/evolve event listeners

    -- ========================================================================
    -- P2P Trade event listeners
    -- ========================================================================

    -- ================================================================
    -- Overworld Monster event listeners

    -- Biome weather update (pushed when biome weather changes)
    client:on("biome_weather", function(data)
        if not data then return end
        game._weather.weather = data.weather or game._weather.weather
        if data.effects then
            game._weather.effects = data.effects
        end
        if data.biome then
            game._weather.biome = data.biome
        end
    end)

    -- Town rumors (NPC rumor list for current town)
    client:on("town_rumors", function(data)
        if not data then return end
        if data.rumors then
            addChatMessage("You hear " .. #data.rumors .. " rumor" .. (#data.rumors ~= 1 and "s" or "") .. " around town.", {0.8, 0.7, 0.4})
            local zoneName = zone and zone.name or "Unknown"
            local timeStr  = os.date("%H:%M")
            for _, rumor in ipairs(data.rumors) do
                local text
                if type(rumor) == "string" then
                    text = rumor
                elseif rumor.text then
                    text = rumor.text
                end
                if text then
                    addChatMessage("  - " .. text, {0.7, 0.65, 0.4})
                    table.insert(game._rumors.list, { text = text, zone = zoneName, time = timeStr })
                    if #game._rumors.list > 100 then
                        table.remove(game._rumors.list, 1)
                    end
                end
            end
        end
    end)

    -- Town reputation update (after actions that affect town rep)
    client:on("town_rep_update", function(data)
        if not data then return end
        local label = data.label or "Neutral"
        addChatMessage("Town reputation: " .. label, {0.5, 0.8, 1})
    end)

    -- Cave enter error (too far from entrance, etc.)
    client:on("cave_enter_error", function(data)
        if not data then return end
        addChatMessage(data.message or "Cannot enter cave", {1, 0.3, 0.3})
    end)

    -- Zone animal interact result (overworld animal communication)
    client:on("zone_animal_interact_result", function(data)
        if not data then return end
        if data.message then
            local color = data.success and {0.5, 0.9, 0.7} or {1, 0.7, 0.3}
            addChatMessage(data.message, color)
        end
    end)

    -- Bonus drop (rare resource/seed found during harvesting)
    client:on("bonus_drop", function(data)
        if not data then return end
        local msg = data.message or "Bonus drop!"
        if data.resource then
            msg = msg .. " (" .. data.resource .. ")"
        end
        addChatMessage(msg, {1, 0.85, 0.2})
    end)

    -- Item broken (equipment destroyed from durability loss)
    client:on("item_broken", function(data)
        if not data then return end
        game._audio.playItemBreak()
        local msg = (data.itemName or data.slot or "Item") .. " has broken!"
        table.insert(game._notifications, { text = msg, color = {1, 0.2, 0.2}, timer = NOTIFICATION_DURATION, maxTimer = NOTIFICATION_DURATION })
    end)

    -- Durability warning (equipment close to breaking)
    client:on("durability_warning", function(data)
        if not data then return end
        local msg = (data.itemName or data.slot or "Item") .. " durability low"
        if data.durability and data.maxDurability then
            msg = msg .. " (" .. data.durability .. "/" .. data.maxDurability .. ")"
        end
        table.insert(game._notifications, { text = msg, color = {1, 0.7, 0.2}, timer = NOTIFICATION_DURATION, maxTimer = NOTIFICATION_DURATION })
    end)

    -- -----------------------------------------------------------------------
    -- Portal travel listeners
    -- -----------------------------------------------------------------------

    -- -----------------------------------------------------------------------
    -- Knowledge system listeners

    -- -----------------------------------------------------------------------
    -- Farming system listeners

    -- -----------------------------------------------------------------------
    -- Base game._raid listeners

    -- -----------------------------------------------------------------------
    -- Crafting: advanced result listeners (gem socketing, augments, imbue, inscribe)

    -- -----------------------------------------------------------------------
    -- Miscellaneous event listeners
    -- -----------------------------------------------------------------------

    -- Affliction status (lycanthropy, vampire exposure)
    client:on("affliction_status", function(data)
        if not data then return end
        if data.lycanthropy then
            addChatMessage("Affliction: Lycanthropy detected", {0.6, 0.3, 0.6})
        end
        if data.vampireExposed then
            addChatMessage("Affliction: Vampire exposure detected", {0.5, 0.1, 0.1})
        end
    end)

    -- NPC interact result (overworld NPC interaction feedback)
    client:on("npc_interact_result", function(data)
        if not data then return end
        -- State update only — NPC dialogues handled separately by npc_dialogue
    end)

    -- Wild encounter result (random monster encounter in overworld)
    client:on("wild_encounter_result", function(data)
        if not data then return end
        if data.encountered and data.name then
            addChatMessage("Wild " .. data.name .. " appeared!", {1, 0.6, 0.2})
        end
    end)

    -- Placed objects (furniture/bridges in claimed plots)
    client:on("placed_objects", function(data)
        if not data then return end
        placedObjects = data.objects or {}
    end)

    -- Portal crafted (personal game._portal created)
    client:on("portal_crafted", function(data)
        if not data then return end
        if data.success then
            addChatMessage("Personal portal crafted!", {0.5, 0.6, 1})
            if data.inventory then mmoInventory = data.inventory end
        end
    end)

    -- Portal destroyed (personal game._portal removed)
    client:on("portal_destroyed", function(data)
        if not data then return end
        addChatMessage(data.message or "Portal destroyed", {0.8, 0.5, 0.3})
    end)

    -- PIN setup required (account security prompt)
    client:on("pin_setup_required", function(data)
        if not data then return end
        addChatMessage(data.message or "Please set a PIN to secure your account", {1, 0.85, 0.3})
    end)

    -- Placed-object interaction results (chest open/close, lock/unlock, deposit/withdraw)
    client:on("interact_result", function(data)
        if not data then return end
        if not data.success then
            addChatMessage(data.message or "Interaction failed.", {1, 0.4, 0.4})
            return
        end
        local d = data.data
        if data.action == "open_chest" then
            ui.chestPanel = d  -- { objectId, contents, maxSlots, locked, isOwner }
        elseif data.action == "lock" then
            addChatMessage("Object locked.", {0.6, 0.9, 0.6})
            if d and d.objectId then
                for _, obj in ipairs(placedObjects) do
                    if obj.id == d.objectId then obj.locked = true; break end
                end
            end
        elseif data.action == "unlock" then
            addChatMessage("Object unlocked.", {0.6, 0.9, 0.6})
            if d and d.objectId then
                for _, obj in ipairs(placedObjects) do
                    if obj.id == d.objectId then obj.locked = false; break end
                end
            end
        elseif data.action == "deposit_chest" or data.action == "withdraw_chest" then
            if d and d.inventory then mmoInventory = d.inventory end
            if d and d.contents and ui.chestPanel then
                ui.chestPanel.contents = d.contents
            end
        end
    end)

    -- Door state broadcast (sent to whole zone when someone toggles a door)
    client:on("door_toggled", function(data)
        if not data or not data.objectId then return end
        for _, obj in ipairs(placedObjects) do
            if obj.id == data.objectId then obj.open = data.open; break end
        end
    end)

    -- Rate-limit feedback
    client:on("rate_warning", function(data)
        if not data then return end
        addChatMessage(data.message or "Slow down!", {1, 0.8, 0.3})
    end)

    client:on("rate_cooldown", function(data)
        if not data then return end
        addChatMessage(data.message or "Action on cooldown.", {1, 0.4, 0.2})
    end)
end

-- Helper: get feature type at world pixel coords
function game.getFeatureAtWorld(wx, wy)
    local tcx = math.floor(wx / overworld.chunkSize)
    local tcy = math.floor(wy / overworld.chunkSize)
    local tck = tcx .. "," .. tcy
    local tc = overworld.chunks[tck]
    if tc and tc.features then
        local lx = math.floor((wx - tcx * overworld.chunkSize) / TILE_SIZE)
        local ly = math.floor((wy - tcy * overworld.chunkSize) / TILE_SIZE)
        lx = math.max(0, math.min(15, lx))
        ly = math.max(0, math.min(15, ly))
        return tc.features[ly * 16 + lx + 1] or 0
    end
    return 0
end

-- Water mount types that bypass water blocking
local WATER_MOUNT_TYPES = { raft = true, boat = true, ship = true, sea_mount = true, airship = true, flying_mount = true }
-- Speed multipliers for water mounts on water tiles
local WATER_MOUNT_SPEED = { raft = 0.5, boat = 0.8, ship = 1.5, sea_mount = 1.0, airship = 1.0, flying_mount = 1.0 }
-- Land mount speed multipliers (applied to base walk speed on land tiles)
local LAND_MOUNT_SPEED = { horse = 2.0, caravan = 0.7 }

-- Helper: check if position is near a placed bridge or raft object
function game.isNearPlacedBridge(wx, wy)
    if not placedObjects then return false end
    for _, obj in ipairs(placedObjects) do
        if obj.type == "bridge" then
            local ddx = wx - obj.x
            local ddy = wy - obj.y
            if ddx * ddx + ddy * ddy < 40 * 40 then
                return true
            end
        end
    end
    return false
end

-- Helper: check if a feature tile is water
function game.isWaterFeature(feat)
    return feat == 1 or feat == 2  -- FEATURE_RIVER or FEATURE_LAKE
end

function game.update(dt)
    fadeIn = math.min(1, fadeIn + dt * 3)

    -- Audio system tick (fades, music loops, weather layers)
    game._audio.update(dt)
    game._audio.setCamera(camera.x, camera.y)
    game._audio.tickOtherFootsteps(dt)

    -- Update grid inventory (resets hover state each frame)
    if ui.showGridInventory then
        gridInv.update(dt)
    end

    -- Auto-retry zone_enter if no zone_state received after 3s
    if not zone and game._zoneRetryTimer and not game._loadError then
        game._zoneRetryTimer = game._zoneRetryTimer - dt
        if game._zoneRetryTimer <= 0 then
            game._zoneRetryTimer = nil  -- only retry once
            if client and client.connected and identity and identity.startZone then
                local enterData = { zoneId = identity.startZone }
                if identity.startPosition then
                    enterData.x = identity.startPosition.x
                    enterData.y = identity.startPosition.y
                end
                client:emit("zone_enter", enterData)
                if game._zoneDebug then
                    game._zoneDebug.retries = (game._zoneDebug.retries or 0) + 1
                    table.insert(game._zoneDebug.events, "retry zone_enter #" .. game._zoneDebug.retries)
                end
            end
        end
    end

    -- Zone load timeout: if zone_state hasn't arrived within the timeout, show error
    if not zone and game._zoneLoadTimeout and not game._loadError then
        game._zoneLoadTimeout = game._zoneLoadTimeout - dt
        if game._zoneLoadTimeout <= 0 then
            game._loadError = "Zone loading timed out - server may be unreachable"
            game._zoneLoadTimeout = nil
        end
    end

    -- If in error state, only handle Escape key to go back
    if game._loadError then
        return
    end

    -- Permadeath bleedout countdown (client-side visual only, server controls actual timer)
    if permadeath.isDowned then
        permadeath.bleedoutTimer = math.max(0, permadeath.bleedoutTimer - dt)
    end

    overworld.riverAnimTimer = overworld.riverAnimTimer + dt

    -- Mastery message fade
    if mastery.messageTimer > 0 then
        mastery.messageTimer = mastery.messageTimer - dt
    end

    -- Loot notification fade timers
    for i = #game._itemUI.lootNotifications, 1, -1 do
        local n = game._itemUI.lootNotifications[i]
        n.timer = n.timer - dt
        if n.timer <= 0.5 then
            n.alpha = math.max(0, n.timer / 0.5)
        end
        if n.timer <= 0 then
            table.remove(game._itemUI.lootNotifications, i)
        end
    end

    -- Lich Corruption animation + damage flash decay
    corruption.animTimer = corruption.animTimer + dt
    if corruption.damageFlash > 0 then
        corruption.damageFlash = math.max(0, corruption.damageFlash - dt * 1.5)
    end

    -- Doom countdown timer (client-side interpolation between server updates)
    if doom.active and doom.remainingMs > 0 then
        doom.remainingMs = math.max(0, doom.remainingMs - dt * 1000)
    end
    if doom.flashTimer > 0 then
        doom.flashTimer = math.max(0, doom.flashTimer - dt)
    end
    -- Disease flash timers
    if game._disease.contractedFlash > 0 then
        game._disease.contractedFlash = math.max(0, game._disease.contractedFlash - dt)
    end
    if game._disease.symptomTimer > 0 then
        game._disease.symptomTimer = math.max(0, game._disease.symptomTimer - dt)
    end
    if doom.showEvent then
        doom.eventTimer = doom.eventTimer - dt
        if doom.eventTimer <= 0 then
            doom.showEvent = false
            -- Return to shard select after doom cinematic
            _G.switchScene("shards")
        end
    end

    -- Purification VFX update
    if game._raid.purificationVfx then
        game._raid.purificationVfx.timer = game._raid.purificationVfx.timer - dt
        local progress = 1 - (game._raid.purificationVfx.timer / game._raid.purificationVfx.maxTimer)
        game._raid.purificationVfx.radius = progress * 300  -- expand to 300px radius
        if game._raid.purificationVfx.timer <= 0 then
            game._raid.purificationVfx = nil
        end
    end

    -- Rift destruction VFX update
    for i = #riftDestroyVfx, 1, -1 do
        riftDestroyVfx[i].timer = riftDestroyVfx[i].timer - dt
        if riftDestroyVfx[i].timer <= 0 then
            table.remove(riftDestroyVfx, i)
        end
    end

    -- Rift reward popup update
    if riftRewardPopup then
        riftRewardPopup.timer = riftRewardPopup.timer - dt
        if riftRewardPopup.timer <= 0 then
            riftRewardPopup = nil
        end
    end

    -- Lich game._raid corruption zone timers
    for i = #game._raid.corruptionZones, 1, -1 do
        game._raid.corruptionZones[i].timer = game._raid.corruptionZones[i].timer - dt
        if game._raid.corruptionZones[i].timer <= 0 then
            table.remove(game._raid.corruptionZones, i)
        end
    end

    -- Leviathan timer decay
    if (overworld.leviathanWarningTimer or 0) > 0 then
        overworld.leviathanWarningTimer = overworld.leviathanWarningTimer - dt
        if overworld.leviathanWarningTimer <= 0 then
            overworld.leviathanWarning = nil
        end
    end
    if (overworld.leviathanAggroTimer or 0) > 0 then
        overworld.leviathanAggroTimer = overworld.leviathanAggroTimer - dt
        if overworld.leviathanAggroTimer <= 0 then
            overworld.leviathanAggro = nil
        end
    end
    if (overworld.leviathanPhaseTimer or 0) > 0 then
        overworld.leviathanPhaseTimer = overworld.leviathanPhaseTimer - dt
        if overworld.leviathanPhaseTimer <= 0 then
            overworld.leviathanPhaseText = nil
        end
    end

    -- Reconnection logic
    if game._reconnecting and game._reconnectTimer then
        game._reconnectTimer = game._reconnectTimer - dt
        if game._reconnectTimer <= 0 then
            game._reconnectAttempt = (game._reconnectAttempt or 0) + 1
            local timers = game._reconnectTimers or { 2, 5, 10 }
            if game._reconnectAttempt > #timers then
                -- All retries exhausted, go to shards
                game._reconnecting = false
                game._reconnectOverlay = false
                _G.switchScene("shards")
                return
            end
            -- Attempt reconnect
            if client and client.connect and _G.selectedShard then
                pcall(function()
                    client:connect(_G.selectedShard.host, _G.selectedShard.port, _G.serverAuth)
                end)
            end
            -- Set next retry timer
            game._reconnectTimer = timers[math.min(game._reconnectAttempt + 1, #timers)]
        end
    end

    -- Update floating texts
    for i = #floatingTexts, 1, -1 do
        local ft = floatingTexts[i]
        ft.timer = ft.timer - dt
        ft.y = ft.y - 30 * dt  -- float upward
        if ft.timer <= 0 then
            table.remove(floatingTexts, i)
        end
    end

    -- Update game._portal message timer
    if game._portal.message and game._portal.message.timer then
        game._portal.message.timer = game._portal.message.timer - dt
        if game._portal.message.timer <= 0 then
            game._portal.message = nil
        end
    end

    -- Update knowledge game._notifications
    for i = #knowledge.notifications, 1, -1 do
        knowledge.notifications[i].timer = knowledge.notifications[i].timer - dt
        if knowledge.notifications[i].timer <= 0 then
            table.remove(knowledge.notifications, i)
        end
    end

    -- Update NPC shop message timer
    if game._npcShop.message and game._npcShop.message.timer then
        game._npcShop.message.timer = game._npcShop.message.timer - dt
        if game._npcShop.message.timer <= 0 then
            game._npcShop.message = nil
        end
    end

    -- Update game._bank message timer
    if game._bank.message and game._bank.message.timer then
        game._bank.message.timer = game._bank.message.timer - dt
        if game._bank.message.timer <= 0 then
            game._bank.message = nil
        end
    end

    -- Update game._trade message timer and pending request timer
    if game._trade.message and game._trade.message.timer then
        game._trade.message.timer = game._trade.message.timer - dt
        if game._trade.message.timer <= 0 then
            game._trade.message = nil
        end
    end
    if game._trade._pendingTimer then
        game._trade._pendingTimer = game._trade._pendingTimer - dt
        if game._trade._pendingTimer <= 0 then
            game._trade.pendingRequest = nil
            game._trade._pendingTimer = nil
        end
    end

    -- Update game._admin panel timers
    if game._admin.resultMsg then
        game._admin.resultMsg.timer = game._admin.resultMsg.timer - dt
        if game._admin.resultMsg.timer <= 0 then
            game._admin.resultMsg = nil
        end
    end
    if game._admin.shutdownWarning then
        game._admin.shutdownWarning = game._admin.shutdownWarning - dt
        if game._admin.shutdownWarning <= 0 then
            game._admin.shutdownWarning = nil
        end
    end

    -- Update sync panel status timer
    if game._sync.statusTimer and game._sync.statusTimer > 0 then
        game._sync.statusTimer = game._sync.statusTimer - dt
        if game._sync.statusTimer <= 0 then
            game._sync.status = nil
            game._sync.error = nil
            game._sync.statusTimer = 0
        end
    end

    -- Update monster attack cooldown
    if monsterAttackCooldown > 0 then
        monsterAttackCooldown = monsterAttackCooldown - dt
    end

    -- Interpolate monster positions for smooth patrol movement
    local interpSpeed = 5  -- lerp speed (higher = snappier)
    for _, m in ipairs(zoneMonsters) do
        if m.targetX and m.targetY then
            local dx = m.targetX - m.x
            local dy = m.targetY - m.y
            local distSq = dx * dx + dy * dy
            if distSq < 1 then
                m.x = m.targetX
                m.y = m.targetY
                m.targetX = nil
                m.targetY = nil
                m.moving = false
            else
                local t = math.min(1, interpSpeed * dt)
                m.x = m.x + dx * t
                m.y = m.y + dy * t
                m.moving = true
            end
        else
            m.moving = false
        end
    end

    -- Update level-up celebration effect
    if levelUpEffect then
        levelUpEffect.timer = levelUpEffect.timer - dt
        levelUpEffect.ringRadius = (levelUpEffect.ringRadius or 0) + 120 * dt
        -- Fade out during last 1 second
        if levelUpEffect.timer <= 1.0 then
            levelUpEffect.alpha = math.max(0, levelUpEffect.timer)
        end
        if levelUpEffect.timer <= 0 then
            levelUpEffect = nil
        end
    end

    -- Update pack reveal animation
    if packReveal and not packReveal.done then
        packReveal.timer = packReveal.timer + dt
        if packReveal.phase == "flip" then
            packReveal.flipProgress = math.min(1, packReveal.timer / 0.5)
            if packReveal.flipProgress >= 1 then
                packReveal.phase = "show"
                packReveal.timer = 0
            end
        elseif packReveal.phase == "show" then
            -- Auto-advance after 1 second
            if packReveal.timer >= 1.0 then
                game.packRevealAdvance()
            end
        end
    end

    -- Update dungeon hit flash timer for overworld monster hit reuse
    if not dungeon.inDungeon and dungeon.hitFlashTimer and dungeon.hitFlashTimer > 0 then
        dungeon.hitFlashTimer = dungeon.hitFlashTimer - dt
    end

    -- Update onboarding tips
    if onboarding.currentTip then
        onboarding.currentTip.timer = onboarding.currentTip.timer - dt
        if onboarding.currentTip.timer <= 0 then
            onboarding.currentTip = nil
        end
    end

    -- Check onboarding conditions (only for new players: level <= 3)
    if not onboarding.dismissed and rpg.level and rpg.level <= 3 and zone and myId and players[myId] then
        game.checkOnboardingTips()
    end

    -- Update director event banners (fade in/out + expire)
    for i = #game._directorEvents, 1, -1 do
        local ev = game._directorEvents[i]
        ev.fadeIn = math.min(1, (ev.fadeIn or 0) + dt * 3)
        ev.timer = ev.timer - dt
        if ev.timer <= 0 then
            table.remove(game._directorEvents, i)
        end
    end

    -- Update zone ticker entries
    for i = #game._zoneTicker, 1, -1 do
        game._zoneTicker[i].timer = game._zoneTicker[i].timer - dt
        if game._zoneTicker[i].timer <= 0 then
            table.remove(game._zoneTicker, i)
        end
    end

    -- Check resource respawns (client-side prediction using server timestamps)
    local now = os.time() * 1000
    for _, r in ipairs(resources) do
        if r.depleted and r.depletedUntil and r.depletedUntil > 0 and now >= r.depletedUntil then
            r.depleted = false
            r.hp = r.maxHp or 5
        end
    end
    if overworld.chunkBased then
        for _, chunk in pairs(overworld.chunks) do
            if chunk.resources then
                for _, r in ipairs(chunk.resources) do
                    if r.depleted and r.depletedUntil and r.depletedUntil > 0 and now >= r.depletedUntil then
                        r.depleted = false
                        r.hp = r.maxHp or 5
                    end
                end
            end
        end
    end

    if not zone or not myId then return end

    -- Update combat systems if in combat
    if tcState.inCombat then
        combatAnim.update(dt)
        combatUI.update(dt)
    end

    -- Tick down combat join offer timer
    if dungeon.combatJoinOffer then
        dungeon.combatJoinOffer.timer = dungeon.combatJoinOffer.timer - dt
        if dungeon.combatJoinOffer.timer <= 0 then
            dungeon.combatJoinOffer = nil
        end
    end

    -- Update dungeon particle systems (flames, embers on light sources + magic auras)
    if dungeon.inDungeon and dungeon.lightSources then
        local pSources = dungeon.lightSources
        -- Add magic aura particles when magic_sense vision is active
        if dungeon.visionType == "magic_sense" and dungeon.magicAuras and #dungeon.magicAuras > 0 then
            pSources = {}
            for i = 1, #dungeon.lightSources do pSources[#pSources + 1] = dungeon.lightSources[i] end
            for i = 1, #dungeon.magicAuras do
                local a = dungeon.magicAuras[i]
                pSources[#pSources + 1] = { x = a.x, y = a.y, r = 1.5, b = a.intensity or 0.5, t = "magic_aura" }
            end
        end
        dungeonParticles.update(dt, pSources, -math.floor(camera.x), -math.floor(camera.y), 32)
    end

    -- BG3-style turn-based mode: compute move/attack ranges for grid overlay
    if dungeon.inDungeon and dungeon.turnBasedMode and dungeon.turnModeMyTurn and not tcState.inCombat then
        combatUI.setOverworldRanges(dungeon.playerTileX, dungeon.playerTileY, dungeon.turnModeMovesRemaining, dungeon.grid, dungeon.enemies, nil)
    elseif dungeon.turnBasedMode and not dungeon.turnModeMyTurn and not tcState.inCombat then
        combatUI.clearOverworldRanges()
    end

    -- Dungeon grid movement (tile-by-tile, WASD) — disabled during combat or downed
    if dungeon.inDungeon and dungeon.grid and not tcState.inCombat and not permadeath.isDowned then
        dungeon.moveTimer = math.max(0, dungeon.moveTimer - dt)
        if not chat.active and dungeon.moveTimer <= 0 then
            local dx, dy = 0, 0
            if love.keyboard.isDown("w", "up") then dy = -1
            elseif love.keyboard.isDown("s", "down") then dy = 1
            elseif love.keyboard.isDown("a", "left") then dx = -1
            elseif love.keyboard.isDown("d", "right") then dx = 1
            end

            if dx ~= 0 or dy ~= 0 then
                -- Turn-based mode: block movement if not your turn or out of points
                if dungeon.turnBasedMode then
                    if not dungeon.turnModeMyTurn then dx, dy = 0, 0 end
                    if dungeon.turnModeMovesRemaining <= 0 then dx, dy = 0, 0 end
                end
                if dx == 0 and dy == 0 then -- blocked by turn mode
                else
                local newX = dungeon.playerTileX + dx
                local newY = dungeon.playerTileY + dy

                -- Check bounds and walkability
                if dungeon.grid[newY + 1] and dungeon.grid[newY + 1][newX + 1] then
                    local tile = dungeon.grid[newY + 1][newX + 1]
                    if WALKABLE_TILES[tile] then
                        -- Decrement client-side move points (server validates too)
                        if dungeon.turnBasedMode then
                            dungeon.turnModeMovesRemaining = dungeon.turnModeMovesRemaining - 1
                        end
                        dungeon.playerTileX = newX
                        dungeon.playerTileY = newY
                        dungeon.moveTimer = dungeon.moveRate
                        game._audio.playDungeonStep()
                        game._audio.tryStinger()

                        -- Update pixel position for camera/rendering
                        local me = players[myId]
                        if me then
                            me.x = newX * 32 + 16
                            me.y = newY * 32 + 16
                        end

                        -- Reveal fog
                        game.revealFog(newX, newY)

                        -- Send move to server
                        client:emit("dungeon_move", { x = newX, y = newY })

                        -- Auto-interact with stairs
                        if tile == DTILE.STAIRS_DOWN or tile == DTILE.EXIT then
                            -- Show prompt instead of auto-descend
                        elseif tile == DTILE.STAIRS_UP or tile == DTILE.ENTRANCE then
                            -- Show prompt instead of auto-ascend
                        end
                    end
                end
                end -- close turn-mode else
            end
        end
        -- Tick enemy animation timers
        for _, e in ipairs(dungeon.enemies) do
            if e.moveTimer and e.moveTimer > 0 then
                e.moveTimer = e.moveTimer - dt
            end
            if e.attackFlashTimer and e.attackFlashTimer > 0 then
                e.attackFlashTimer = e.attackFlashTimer - dt
            end
            -- Turn-based mode: smooth lerp animation for enemy movement
            if e.lerpTimer and e.lerpTimer > 0 then
                e.lerpTimer = e.lerpTimer - dt
                if e.lerpTimer <= 0 then
                    e.lerpFromX = nil
                    e.lerpFromY = nil
                    e.lerpTimer = nil
                end
            end
        end

        -- Tick placed torch timers
        for i = #dungeon.placedTorches, 1, -1 do
            dungeon.placedTorches[i].timer = dungeon.placedTorches[i].timer - dt
            if dungeon.placedTorches[i].timer <= 0 then
                table.remove(dungeon.placedTorches, i)
            end
        end

        -- Hit flash overlay timer
        if dungeon.hitFlashTimer and dungeon.hitFlashTimer > 0 then
            dungeon.hitFlashTimer = dungeon.hitFlashTimer - dt
        end

        -- Boss phase flash timer
        if dungeon.bossPhaseFlash and dungeon.bossPhaseFlash > 0 then
            dungeon.bossPhaseFlash = dungeon.bossPhaseFlash - dt
        end

        -- Don't process free movement below
        -- But still update camera (centered on player, clamped to dungeon bounds)
        local me = players[myId]
        if me then
            local W = love.graphics.getWidth()
            local H = love.graphics.getHeight()
            local targetCamX = me.x - W / 2
            local targetCamY = me.y - H / 2
            if zone then
                if zone.width <= W then
                    targetCamX = (zone.width - W) / 2
                else
                    targetCamX = math.max(0, math.min(zone.width - W, targetCamX))
                end
                if zone.height <= H then
                    targetCamY = (zone.height - H) / 2
                else
                    targetCamY = math.max(0, math.min(zone.height - H, targetCamY))
                end
            end
            camera.x = targetCamX
            camera.y = targetCamY
        end
        return  -- skip regular movement
    end

    -- Compute walkable bounds based on terrain (non-overworld only)
    local minX = 16
    local maxX = zone.width - 16
    local minY = 16
    local maxY = zone.height - 16
    if not overworld.chunkBased then
        local terrain = zone.terrain
        if terrain then
            if terrain.water then
                for _, side in ipairs(terrain.water) do
                    if side == "west" then minX = TERRAIN_BORDER + 8 end
                    if side == "east" then maxX = zone.width - TERRAIN_BORDER - 8 end
                    if side == "south" then maxY = zone.height - TERRAIN_BORDER - 8 end
                    if side == "north" then minY = TERRAIN_BORDER + 8 end
                end
            end
            if terrain.mountain then
                for _, side in ipairs(terrain.mountain) do
                    if side == "north" then minY = TERRAIN_BORDER + 8 end
                    if side == "south" then maxY = zone.height - TERRAIN_BORDER - 8 end
                    if side == "east" then maxX = zone.width - TERRAIN_BORDER - 8 end
                    if side == "west" then minX = TERRAIN_BORDER + 8 end
                end
            end
        end
    end

    -- Block free movement during overworld combat (arena uses dungeon grid renderer
    -- but dungeon.inDungeon is false, so grid-movement block above doesn't catch it)
    if tcState.overworldCombat or (tcState.inCombat and not dungeon.inDungeon) then
        -- do nothing; combat movement is handled via tc_combat_action socket events
    elseif not chat.active then
        local dx, dy = 0, 0
        local facing = nil

        if love.keyboard.isDown("w", "up") then dy = -1; facing = "up" end
        if love.keyboard.isDown("s", "down") then dy = 1; facing = "down" end
        if love.keyboard.isDown("a", "left") then dx = -1; facing = "left" end
        if love.keyboard.isDown("d", "right") then dx = 1; facing = "right" end

        if dx ~= 0 and dy ~= 0 then
            local len = math.sqrt(dx * dx + dy * dy)
            dx = dx / len
            dy = dy / len
        end

        if dx ~= 0 or dy ~= 0 then
            sprint.restTimer = 0  -- reset rest timer when moving
            ui.contextMenu = nil  -- dismiss context menu on movement
            local me = players[myId]
            if me then
                -- Apply biome speed multiplier for overworld
                local speed = MOVE_SPEED
                if overworld.chunkBased then
                    local cx = math.floor(me.x / overworld.chunkSize)
                    local cy = math.floor(me.y / overworld.chunkSize)
                    local ckey = cx .. "," .. cy
                    local chunk = overworld.chunks[ckey]
                    if chunk then
                        local spd = chunk.speedMultiplier or 1
                        if spd <= 0 then
                            -- Lizard Folk can swim through water
                            if rpg.race == "lizardfolk" then
                                spd = 0.5
                            elseif rpg.mount and WATER_MOUNT_TYPES[rpg.mount] then
                                spd = WATER_MOUNT_SPEED[rpg.mount] or 0.5
                            else
                                spd = 0
                            end
                        end
                        speed = MOVE_SPEED * spd

                        -- Check feature tile speed override
                        if chunk.features then
                            local localX = me.x - cx * overworld.chunkSize
                            local localY = me.y - cy * overworld.chunkSize
                            local ftx = math.floor(localX / TILE_SIZE)
                            local fty = math.floor(localY / TILE_SIZE)
                            ftx = math.max(0, math.min(15, ftx))
                            fty = math.max(0, math.min(15, fty))
                            local fidx = fty * 16 + ftx + 1
                            local feat = chunk.features[fidx]
                            if feat and feat ~= 0 then
                                local fspd = overworld.featureSpeeds[tostring(feat)]
                                -- Water feature speed override: Lizard Folk swim, water mounts
                                if game.isWaterFeature(feat) then
                                    if rpg.race == "lizardfolk" then
                                        fspd = 0.5
                                    elseif rpg.mount and WATER_MOUNT_TYPES[rpg.mount] then
                                        fspd = WATER_MOUNT_SPEED[rpg.mount] or 0.5
                                    end
                                end
                                if fspd and fspd >= 0 then
                                    speed = MOVE_SPEED * fspd
                                end
                            end
                        end

                        -- Update current biome display
                        overworld.currentBiome = chunk.biomeName
                    end
                end

                -- Apply land mount speed multiplier on overworld
                if overworld.chunkBased and rpg.mount and LAND_MOUNT_SPEED[rpg.mount] then
                    speed = speed * LAND_MOUNT_SPEED[rpg.mount]
                end

                -- Sprint / exhaustion speed modifier (towns/buildings only, not overworld)
                local sprintBonus = computeSprintBonuses()
                sprint.isSprinting = false
                if not overworld.chunkBased then
                    if sprint.isExhausted then
                        speed = speed * sprint.EXHAUSTED_MULT
                    elseif love.keyboard.isDown("lshift", "rshift") and sprint.stamina > 0 and not chat.active then
                        sprint.isSprinting = true
                        speed = speed * sprint.MULTIPLIER
                        sprint.stamina = math.max(0, sprint.stamina - sprintBonus.drain * dt)
                        if sprint.stamina <= 0 then
                            sprint.isExhausted = true
                        end
                    else
                        -- Slow regen while walking (not sprinting)
                        sprint.stamina = math.min(sprintBonus.max, sprint.stamina + sprintBonus.walkRegen * dt)
                    end
                end

                -- Weather movement speed modifier
                local weatherSpeed = 1.0
                if world.weather == "storm" then weatherSpeed = 0.85
                elseif world.weather == "snow" then weatherSpeed = 0.80
                elseif world.weather == "fog" then weatherSpeed = 0.95
                elseif world.weather == "rain" then weatherSpeed = 0.95
                end
                speed = speed * weatherSpeed

                local newX = me.x + dx * speed * dt
                local newY = me.y + dy * speed * dt

                -- Clamp to walkable bounds (respects terrain)
                newX = math.max(minX, math.min(maxX, newX))
                newY = math.max(minY, math.min(maxY, newY))

                -- Block movement into river/lake tiles (feature speed 0) with axis-sliding
                -- Bypass: Lizard Folk swim, water mounts, or near placed bridge
                if overworld.chunkBased and rpg.race ~= "lizardfolk" then
                    local hasWaterMount = rpg.mount and WATER_MOUNT_TYPES[rpg.mount]
                    local destFeat = game.getFeatureAtWorld(newX, newY)
                    if destFeat == 1 or destFeat == 2 then
                        -- Allow passage if water mount equipped or near a placed bridge
                        if not hasWaterMount and not game.isNearPlacedBridge(newX, newY) then
                            -- Try X-only slide
                            local slideX = game.getFeatureAtWorld(newX, me.y)
                            local slideY = game.getFeatureAtWorld(me.x, newY)
                            if slideX ~= 1 and slideX ~= 2 then
                                newY = me.y
                            elseif slideY ~= 1 and slideY ~= 2 then
                                newX = me.x
                            else
                                newX = me.x
                                newY = me.y
                            end
                        end
                    end
                end

                me.x = newX
                me.y = newY
                me.targetX = newX
                me.targetY = newY
                if facing then me.facing = facing end

                -- Self footstep audio (cadence varies with speed)
                local surface = game._audio.getSurface(zone and zone.type, overworld.currentBiome)
                game._audio.tickSelfFootstep(dt, true, speed, surface)

                -- Send position to server (throttled)
                moveTimer = moveTimer + dt
                if moveTimer >= MOVE_SEND_RATE then
                    moveTimer = 0
                    client:emit("zone_move", {
                        x = math.floor(me.x),
                        y = math.floor(me.y),
                        facing = me.facing,
                    })
                end
            end
        else
            -- Standing still: rest recovery
            sprint.restTimer = sprint.restTimer + dt
            if sprint.restTimer >= 1.0 then
                local sb = computeSprintBonuses()
                sprint.stamina = math.min(sb.max, sprint.stamina + sb.restRegen * dt)
            end
        end
    else
        -- Standing still: rest recovery
        sprint.restTimer = sprint.restTimer + dt
        if sprint.restTimer >= 1.0 then
            local sb = computeSprintBonuses()
            sprint.stamina = math.min(sb.max, sprint.stamina + sb.restRegen * dt)
        end
    end

    -- Exit exhaustion when stamina recovers above 25%
    do
        local sb = computeSprintBonuses()
        if sprint.isExhausted and sprint.stamina >= sb.max * 0.25 then
            sprint.isExhausted = false
        end
    end

    -- Hold E to continuously harvest (blocked during combat)
    if not chat.active and not tcState.overworldCombat and not tcState.inCombat and love.keyboard.isDown("e") and hoverResource and not hoverResource.depleted then
        harvestHoldTimer = harvestHoldTimer + dt
        if harvestHoldTimer >= HARVEST_HOLD_RATE then
            harvestHoldTimer = 0
            local myLevel = 1
            local reqSkill = hoverResource.skill or "mining"
            if skills and skills[reqSkill] then
                myLevel = skills[reqSkill].level or 1
            end
            if myLevel >= (hoverResource.minLevel or 1) then
                client:emit("resource_harvest", { resourceId = hoverResource.id })
            end
        end
    else
        harvestHoldTimer = 0
    end

    -- Interpolate other players with buffered snapshots (render 150ms behind real-time)
    local INTERP_DELAY = 0.15  -- 150ms interpolation buffer
    local now = love.timer.getTime()
    local renderTime = now - INTERP_DELAY
    for id, p in pairs(players) do
        if id ~= myId then
            -- Maintain snapshot buffer
            if not p.snapshots then p.snapshots = {} end
            -- Add new snapshot when target changes
            if p._lastSnapshotX ~= p.targetX or p._lastSnapshotY ~= p.targetY then
                table.insert(p.snapshots, { t = now, x = p.targetX, y = p.targetY })
                p._lastSnapshotX = p.targetX
                p._lastSnapshotY = p.targetY
                -- Keep only last 20 snapshots
                while #p.snapshots > 20 do table.remove(p.snapshots, 1) end
            end

            if #p.snapshots >= 2 then
                -- Find the two snapshots bracketing renderTime
                local s0, s1
                for i = #p.snapshots, 1, -1 do
                    if p.snapshots[i].t <= renderTime then
                        s0 = p.snapshots[i]
                        s1 = p.snapshots[i + 1] or s0
                        break
                    end
                end
                if s0 and s1 and s1.t > s0.t then
                    local alpha = math.min(1, (renderTime - s0.t) / (s1.t - s0.t))
                    p.x = s0.x + (s1.x - s0.x) * alpha
                    p.y = s0.y + (s1.y - s0.y) * alpha
                elseif s0 then
                    p.x = s0.x
                    p.y = s0.y
                end
            else
                -- Fallback: direct lerp when not enough snapshots
                local dx = p.targetX - p.x
                local dy = p.targetY - p.y
                local distSq = dx * dx + dy * dy
                if distSq < 1 then
                    p.x = p.targetX
                    p.y = p.targetY
                elseif distSq > 640000 then
                    p.x = p.targetX
                    p.y = p.targetY
                else
                    local lerpSpeed = math.min(1, 12 * dt)
                    p.x = p.x + dx * lerpSpeed
                    p.y = p.y + dy * lerpSpeed
                end
            end
        end
    end

    -- Camera follows player
    local me = players[myId]
    if me then
        local W = love.graphics.getWidth()
        local H = love.graphics.getHeight()
        local targetCamX = me.x - W / 2
        local targetCamY = me.y - H / 2

        if zone then
            -- Center camera when zone is smaller than screen
            if zone.width <= W then
                targetCamX = (zone.width - W) / 2
            else
                targetCamX = math.max(0, math.min(zone.width - W, targetCamX))
            end
            if zone.height <= H then
                targetCamY = (zone.height - H) / 2
            else
                targetCamY = math.max(0, math.min(zone.height - H, targetCamY))
            end
        end

        local camLerp = 1 - math.exp(-8 * dt)
        camera.x = camera.x + (targetCamX - camera.x) * camLerp
        camera.y = camera.y + (targetCamY - camera.y) * camLerp

        -- Track chunk position for overworld (request new chunks on boundary cross)
        if overworld.chunkBased then
            local cx = math.floor(me.x / overworld.chunkSize)
            local cy = math.floor(me.y / overworld.chunkSize)
            if cx ~= overworld.lastChunkX or cy ~= overworld.lastChunkY then
                overworld.lastChunkX = cx
                overworld.lastChunkY = cy
                -- Explicitly request chunks for new position
                client:emit("request_chunks", { cx = cx, cy = cy })
            end
        end
    end

    -- Check zone connection proximity
    hoverConnection = nil
    if me and connections then
        for _, conn in ipairs(connections) do
            local dist = math.sqrt((me.x - conn.x)^2 + (me.y - conn.y)^2)
            if dist < 50 then
                hoverConnection = conn
                break
            end
        end
    end

    -- Check resource proximity (flat resources + chunk resources)
    hoverResource = nil
    if me and not hoverConnection then
        local closestDist = 60
        -- Check flat resources
        if resources then
            for _, r in ipairs(resources) do
                local dist = math.sqrt((me.x - r.x)^2 + (me.y - r.y)^2)
                if dist < closestDist then
                    closestDist = dist
                    hoverResource = r
                end
            end
        end
        -- Check chunk resources (only nearby chunks)
        if overworld.chunkBased then
            local mcx = math.floor(me.x / overworld.chunkSize)
            local mcy = math.floor(me.y / overworld.chunkSize)
            for dy = -1, 1 do
                for dx = -1, 1 do
                    local key = (mcx + dx) .. "," .. (mcy + dy)
                    local chunk = overworld.chunks[key]
                    if chunk and chunk.resources then
                        for _, r in ipairs(chunk.resources) do
                            local dist = math.sqrt((me.x - r.x)^2 + (me.y - r.y)^2)
                            if dist < closestDist then
                                closestDist = dist
                                hoverResource = r
                            end
                        end
                    end
                end
            end
        end
    end

    -- Check cave entrance proximity
    overworld.hoverCave = nil
    if me and overworld.chunkBased and not hoverConnection then
        local mcx = math.floor(me.x / overworld.chunkSize)
        local mcy = math.floor(me.y / overworld.chunkSize)
        local closestCaveDist = 60
        for cdy = -1, 1 do
            for cdx = -1, 1 do
                local key = (mcx + cdx) .. "," .. (mcy + cdy)
                local chunk = overworld.chunks[key]
                if chunk and chunk.featureMeta then
                    for _, meta in ipairs(chunk.featureMeta) do
                        if meta.type == "cave" then
                            local dist = math.sqrt((me.x - meta.worldX)^2 + (me.y - meta.worldY)^2)
                            if dist < closestCaveDist then
                                closestCaveDist = dist
                                overworld.hoverCave = meta
                            end
                        end
                    end
                end
            end
        end
    end

    -- Check mini-rift proximity
    overworld.hoverRift = nil
    if overworld.chunkBased and me then
        for _, rift in pairs(miniRifts) do
            if not rift.cleared then
                local rdx = me.x - rift.worldX
                local rdy = me.y - rift.worldY
                local rdist = math.sqrt(rdx * rdx + rdy * rdy)
                if rdist < 200 then
                    overworld.hoverRift = rift
                    break
                end
            end
        end
    end

    -- Check placed object proximity
    hoverObject = nil
    if me and placedObjects and not hoverConnection and not hoverResource then
        local closestDist = 100
        for _, obj in ipairs(placedObjects) do
            local dist = math.sqrt((me.x - obj.x)^2 + (me.y - obj.y)^2)
            if dist < closestDist then
                closestDist = dist
                hoverObject = obj
            end
        end
    end

    -- NPC proximity detection (for guild master, quest board, etc.)
    game._hoverNpc = nil
    dungeon.hoverEntrance = false
    if zone and zone.npcs and not overworld.chunkBased then
        for _, npc in ipairs(zone.npcs) do
            local ndx = me.x - npc.x
            local ndy = me.y - npc.y
            if math.sqrt(ndx * ndx + ndy * ndy) < 60 then
                game._hoverNpc = npc
                if npc.type == "dungeon_entrance" then
                    dungeon.hoverEntrance = true
                end
                break
            end
        end
    end

    -- Update notification timers
    for i = #game._notifications, 1, -1 do
        game._notifications[i].timer = game._notifications[i].timer - dt
        if game._notifications[i].timer <= 0 then table.remove(game._notifications, i) end
    end

    -- Update message timers for panels
    if game._companions.messageTimer > 0 then game._companions.messageTimer = game._companions.messageTimer - dt end
    if game._pets.messageTimer > 0 then game._pets.messageTimer = game._pets.messageTimer - dt end
    if game._jail.messageTimer > 0 then game._jail.messageTimer = game._jail.messageTimer - dt end
    if game._ascension.messageTimer > 0 then game._ascension.messageTimer = game._ascension.messageTimer - dt end
    if game._guild.messageTimer > 0 then game._guild.messageTimer = game._guild.messageTimer - dt end
    if game._karma.messageTimer > 0 then game._karma.messageTimer = game._karma.messageTimer - dt end
    if game._vip.messageTimer > 0 then game._vip.messageTimer = game._vip.messageTimer - dt end

    -- Update crafting minigame bar
    if game._minigame.active then
        if game._minigame.result then
            game._minigame.resultTimer = game._minigame.resultTimer - dt
            if game._minigame.resultTimer <= 0 then
                game._minigame.active = false
                game._minigame.result = nil
            end
        else
            local elapsed = love.timer.getTime() - game._minigame.startedAt
            local speed = 800  -- pixels per second on 0-1000 bar
            game._minigame.barPos = game._minigame.barPos + game._minigame.barDir * speed * dt
            if game._minigame.barPos >= 1000 then
                game._minigame.barPos = 1000
                game._minigame.barDir = -1
            elseif game._minigame.barPos <= 0 then
                game._minigame.barPos = 0
                game._minigame.barDir = 1
            end
            -- Auto-fail if expired
            if love.timer.getTime() >= game._minigame.expiresAt then
                game._minigame.result = "miss"
                game._minigame.resultTimer = 1.5
                if client then client:emit("craft_minigame_result", { clickPos = -1 }) end
            end
        end
    end
end

function game.draw()
    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()

    -- Background based on zone type
    if zone then
        local bgColor = game.getZoneBgColor(zone.type)
        love.graphics.setColor(bgColor[1], bgColor[2], bgColor[3], fadeIn)
    else
        love.graphics.setColor(0.08, 0.1, 0.08, fadeIn)
    end
    love.graphics.rectangle("fill", 0, 0, W, H)

    if not zone then
        love.graphics.setFont(fonts.ui or _G.getFont(16))
        if game._loadError then
            -- Show error state with details
            love.graphics.setColor(1, 0.4, 0.4, fadeIn)
            love.graphics.printf(game._loadError, 0, H / 2 - 30, W, "center")
            love.graphics.setFont(fonts.chat or fonts.ui or _G.getFont(13))
            love.graphics.setColor(0.6, 0.6, 0.6, fadeIn)
            love.graphics.printf("Press Escape to return to server select", 0, H / 2 + 10, W, "center")
        else
            -- Normal loading state with timeout indicator
            love.graphics.setColor(0.7, 0.7, 0.7, fadeIn)
            local dots = string.rep(".", math.floor((love.timer.getTime() * 2) % 4))
            love.graphics.printf("Loading zone" .. dots, 0, H / 2 - 10, W, "center")
            -- Show timeout countdown and escape hint
            love.graphics.setFont(fonts.chat or fonts.ui or _G.getFont(13))
            love.graphics.setColor(0.5, 0.5, 0.5, fadeIn * 0.6)
            local timeLeft = game._zoneLoadTimeout and math.ceil(game._zoneLoadTimeout) or 0
            love.graphics.printf("Timeout in " .. timeLeft .. "s  |  Press Escape to cancel", 0, H / 2 + 20, W, "center")
            -- Debug: show connection status and event log
            local cl = _G.gameClient
            local status = cl and (cl.connected and "connected" or "disconnected") or "no client"
            local startZone = (_G.identity and _G.identity.startZone) or "nil"
            love.graphics.printf("Server: " .. status .. "  |  Zone: " .. startZone, 0, H / 2 + 40, W, "center")
            -- Show zone_state debug info
            if game._zoneDebug then
                local dbg = game._zoneDebug
                local received = dbg.zoneStateReceived and "YES" or "no"
                local evtLog = table.concat(dbg.events, " > ")
                love.graphics.setColor(1, 1, 0, fadeIn)
                love.graphics.printf("zone_state: " .. received .. "  |  retries: " .. (dbg.retries or 0), 0, H / 2 + 60, W, "center")
                love.graphics.setColor(0.8, 0.8, 0.3, fadeIn)
                love.graphics.printf(evtLog, 20, H / 2 + 80, W - 40, "center")
            end
            -- Show last few debug log lines
            if #_debugLines > 0 then
                love.graphics.setFont(fonts.small or _G.getFont(10))
                love.graphics.setColor(1, 0.6, 0.2, fadeIn * 0.8)
                local startIdx = math.max(1, #_debugLines - 5)
                for i = startIdx, #_debugLines do
                    love.graphics.printf(_debugLines[i], 10, H / 2 + 110 + (i - startIdx) * 14, W - 20, "left")
                end
            end
        end
        return
    end

    -- World space (camera transform)
    love.graphics.push()
    love.graphics.translate(-math.floor(camera.x), -math.floor(camera.y))

    -- Dungeon floor rendering (replaces normal terrain/ground when in dungeon or overworld combat)
    if (dungeon.inDungeon or tcState.overworldCombat) and dungeon.grid then
        game.drawDungeonFloor()
        game.drawDungeonEntities()

        -- Draw players on dungeon floor
        for id, p in pairs(players) do
            if id ~= myId then
                game.drawPlayer(p, false)
            end
        end
        if myId and players[myId] then
            game.drawPlayer(players[myId], true)
        end

        -- Combat tile overlays and animations (drawn in world space, before pop)
        if tcState.inCombat or dungeon.turnBasedMode then
            combatUI.drawTileOverlays(camera.x, camera.y)
            combatUI.drawTileEffects(camera.x, camera.y)
            if tcState.inCombat then
                combatUI.drawUnitOverlays(camera.x, camera.y)
                combatAnim.draw()
            end
        end

        game.drawFloatingTexts()
        love.graphics.pop()

        -- Lighting overlay (screen space, multiply blend darkens scene)
        if dungeon.inDungeon then
            lighting.render(
                dungeon.lightSources, dungeon.ambientLight,
                -math.floor(camera.x), -math.floor(camera.y),
                dungeon.visionType, 32, dungeon.thermalEntities
            )
            lighting.apply(dungeon.visionType)

            -- Particle effects (world space, additive, on top of darkened scene)
            love.graphics.push()
            love.graphics.translate(-math.floor(camera.x), -math.floor(camera.y))
            dungeonParticles.draw()
            love.graphics.pop()
        end

        -- Dungeon HUD (on top of everything)
        local W = love.graphics.getWidth()
        local H = love.graphics.getHeight()

        if tcState.inCombat then
            -- Combat HUD replaces normal dungeon HUD
            combatUI.drawInitiativeBar(W, H)
            combatUI.drawActionBar(W, H)
            combatUI.drawCombatHUD(W, H)
            combatUI.drawTurnBanner(W, H)
            combatUI.drawTurnTimer(W, H)
            combatUI.drawReactionPrompt(W, H)
            combatAnim.drawDamageNumbers()

            -- Difficulty tier indicator
            if _G.groupScaling then
                local gs = _G.groupScaling
                local tierText, tierColor
                if gs.tier == "solo" then
                    tierText = "Solo Mode - Enemies weakened"
                    tierColor = {0.3, 1, 0.3}
                elseif gs.tier == "duo" then
                    tierText = "Duo - Enemies slightly weakened"
                    tierColor = {0.3, 0.9, 1}
                elseif gs.tier == "trio" then
                    tierText = "Trio - Near standard difficulty"
                    tierColor = {1, 1, 1}
                elseif gs.tier == "party" then
                    tierText = "Full Party - Standard difficulty"
                    tierColor = {1, 1, 1}
                elseif gs.tier == "rally" then
                    tierText = "Rally Mode - Enemies empowered!"
                    tierColor = {1, 0.3, 0.3}
                else
                    tierText = gs.tier or "Unknown"
                    tierColor = {0.7, 0.7, 0.7}
                end
                if gs.offlineMode then
                    tierText = tierText .. " [Offline Bonus]"
                end
                love.graphics.setFont(fonts.npc or fonts.chat)
                -- Draw with shadow for readability
                love.graphics.setColor(0, 0, 0, 0.6)
                love.graphics.printf(tierText, 1, H - 41, W, "center")
                if gs.offlineMode then
                    -- Draw main text without suffix first
                    local baseText = tierText:gsub(" %[Offline Bonus%]$", "")
                    local suffixText = " [Offline Bonus]"
                    local font = fonts.npc or fonts.chat
                    local baseW = font:getWidth(baseText)
                    local totalW = font:getWidth(tierText)
                    local startX = (W - totalW) / 2
                    love.graphics.setColor(tierColor[1], tierColor[2], tierColor[3], 0.9)
                    love.graphics.print(baseText, startX, H - 42)
                    love.graphics.setColor(1, 1, 0.3, 0.9)
                    love.graphics.print(suffixText, startX + baseW, H - 42)
                else
                    love.graphics.setColor(tierColor[1], tierColor[2], tierColor[3], 0.9)
                    love.graphics.printf(tierText, 0, H - 42, W, "center")
                end
            end
        else
            if dungeon.inDungeon then
                game.drawDungeonHUD(W, H)
            end
        end

        -- Time of day overlay (dimmer in dungeon)
        local tod = TIME_COLORS[world.timeOfDay] or TIME_COLORS.day
        if tod[4] > 0 then
            love.graphics.setColor(tod[1], tod[2], tod[3], tod[4] * 0.5 * fadeIn)
            love.graphics.rectangle("fill", 0, 0, W, H)
        end

        -- Chat still works in dungeon
        game.drawChat(W, H)

        -- Dungeon quest tracker
        if ui.showDungeonQuests then
            game.drawDungeonQuests(W, H)
        end

        -- Leaderboard
        if ui.showLeaderboard then
            game.drawLeaderboard(W, H)
        end

        -- Interaction prompts for stairs/chests/NPCs
        game.drawDungeonPrompts(W, H)

        -- Director UI: world event banners + zone ticker
        game.drawDirectorUI(W, H)

        -- Raid UI: waiting room counter + boss health bar
        game.drawRaidUI(W, H)

        -- Party panel overlay (dungeon)
        if ui.showPartyPanel then
            game.drawPartyPanel(W, H)
        end

        -- Party HUD (dungeon, always visible when in party)
        if game._raid.partyData and game._raid.partyData.members and #game._raid.partyData.members > 0 and not ui.showPartyPanel then
            game.drawPartyHUD(W, H)
        end

        -- Party invite prompt (dungeon)
        if game._raid.partyInvitePending and not ui.showPartyPanel then
            game.drawPartyInvitePrompt(W, H)
        end

        -- Right-click context menu (drawn on top of everything in dungeon too)
        game.drawContextMenu()

        -- Admin panel overlay (server hosts, F10)
        game.drawAdminPanel(W, H)

        -- Level-up celebration (dungeon path)
        game.drawLevelUpEffect(W, H)

        -- Onboarding tip (dungeon path)
        game.drawOnboardingTip(W, H)

        -- Pack reveal animation overlay (dungeon path)
        if packReveal then
            game.drawPackReveal(W, H)
        end

        return  -- don't draw normal terrain/resources/etc
    end

    -- Draw terrain borders (behind everything)
    game.drawTerrain()

    -- Draw ground grid
    game.drawGround()

    -- Draw plots (before connections/resources so they render behind)
    game.drawPlots()

    -- Draw zone connections (portals)
    game.drawConnections()

    -- Draw resources
    game.drawResources()

    -- Draw placed objects
    game.drawPlacedObjects()

    -- Draw mini-rifts on overworld (world space)
    if overworld.chunkBased then
        game.drawMiniRifts()
    end

    -- Draw placement ghost (if in placement mode)
    if ui.placementMode and ui.placementType then
        local mx, my = love.mouse.getPosition()
        local wx = mx + math.floor(camera.x)
        local wy = my + math.floor(camera.y)

        -- Check if placement position is valid (inside own plot or in plot zone)
        local canPlace = false
        local isBridgePlacement = (ui.placementType == "bridge")
        if isBridgePlacement and overworld.chunkBased then
            -- Bridge: must target a water tile
            local targetFeat = game.getFeatureAtWorld(wx, wy)
            if targetFeat == 1 or targetFeat == 2 or targetFeat == 3 then
                canPlace = true
            end
        elseif zone and zone.type == "plot" then
            -- Inside a plot zone: always allowed (server checks ownership)
            canPlace = true
        elseif overworld.myPlotId then
            for _, plot in pairs(overworld.plots) do
                if plot.id == overworld.myPlotId then
                    if wx >= plot.x and wx < plot.x + plot.width and
                       wy >= plot.y and wy < plot.y + plot.height then
                        canPlace = true
                    end
                    break
                end
            end
        end

        local alpha = 0.5 + math.sin(love.timer.getTime() * 4) * 0.15
        if canPlace then
            love.graphics.setColor(0.3, 1, 0.3, alpha)
        else
            love.graphics.setColor(1, 0.3, 0.3, alpha)
        end

        -- Draw ghost shape based on type
        if ui.placementType == "forge" then
            love.graphics.rectangle("fill", wx - 16, wy - 12, 32, 24, 3, 3)
            love.graphics.setColor(0.8, 0.4, 0.1, alpha * 0.6)
            love.graphics.rectangle("fill", wx - 8, wy - 8, 16, 12, 2, 2)
        elseif ui.placementType == "iron_anvil" then
            love.graphics.rectangle("fill", wx - 14, wy - 6, 28, 12, 2, 2)
            love.graphics.rectangle("fill", wx - 6, wy - 14, 12, 8, 2, 2)
        elseif ui.placementType == "storage_chest" then
            love.graphics.rectangle("fill", wx - 12, wy - 8, 24, 16, 3, 3)
        elseif ui.placementType == "wall" then
            love.graphics.rectangle("fill", wx - 16, wy - 16, 32, 32, 2, 2)
        elseif ui.placementType == "door" then
            love.graphics.rectangle("fill", wx - 10, wy - 16, 20, 32, 2, 2)
        elseif ui.placementType == "raft" then
            love.graphics.rectangle("fill", wx - 20, wy - 12, 40, 24, 4, 4)
        elseif ui.placementType == "bridge" then
            love.graphics.rectangle("fill", wx - 28, wy - 16, 56, 32, 3, 3)
            love.graphics.setColor(0.45, 0.30, 0.15, alpha * 0.5)
            for bx = -24, 24, 7 do
                love.graphics.line(wx + bx, wy - 16, wx + bx, wy + 16)
            end
        else
            love.graphics.circle("fill", wx, wy, 16)
        end

        -- Range circle
        love.graphics.setColor(1, 1, 1, 0.15)
        love.graphics.setLineWidth(1)
        love.graphics.circle("line", wx, wy, 20)

        -- Label
        love.graphics.setFont(fonts.npc)
        if canPlace then
            love.graphics.setColor(0.3, 1, 0.3, 0.9)
        else
            love.graphics.setColor(1, 0.3, 0.3, 0.9)
        end
        local typeLabel = ui.placementType:gsub("_", " "):gsub("(%a)([%w_']*)", function(a, b) return a:upper()..b end)
        love.graphics.printf(typeLabel, wx - 60, wy + 22, 120, "center")
        if not canPlace then
            love.graphics.setColor(1, 0.4, 0.4, 0.8)
            if isBridgePlacement then
                love.graphics.printf("Must place on water", wx - 80, wy + 36, 160, "center")
            else
                love.graphics.printf("Must place in your plot", wx - 80, wy + 36, 160, "center")
            end
        end
    end

    -- Draw NPCs (town/building zones)
    if zone and zone.npcs and not overworld.chunkBased then
        for _, npc in ipairs(zone.npcs) do
            -- Shadow
            love.graphics.setColor(0, 0, 0, 0.2)
            love.graphics.ellipse("fill", npc.x, npc.y + 14, 12, 5)

            -- NPC type-specific drawing
            if npc.type == "dungeon_entrance" then
                -- Draw as a swirling game._portal
                local t = love.timer.getTime()
                love.graphics.setColor(0.5, 0.2, 0.8, 0.6 + math.sin(t * 2) * 0.2)
                love.graphics.circle("fill", npc.x, npc.y, 20)
                love.graphics.setColor(0.7, 0.4, 1, 0.4 + math.sin(t * 3) * 0.2)
                love.graphics.circle("fill", npc.x, npc.y, 14)
                love.graphics.setColor(0.9, 0.7, 1, 0.3)
                love.graphics.circle("fill", npc.x, npc.y, 7)
                love.graphics.setColor(0.8, 0.5, 1, 0.8)
                love.graphics.setLineWidth(2)
                love.graphics.circle("line", npc.x, npc.y, 20)
            elseif npc.type == "dungeon_quest_board" then
                -- Draw as a wooden board
                love.graphics.setColor(0.5, 0.35, 0.2, 0.9)
                love.graphics.rectangle("fill", npc.x - 10, npc.y - 16, 20, 28, 2, 2)
                love.graphics.setColor(0.8, 0.7, 0.3, 0.9)
                love.graphics.rectangle("fill", npc.x - 7, npc.y - 12, 14, 6)
                love.graphics.rectangle("fill", npc.x - 7, npc.y - 3, 14, 6)
                love.graphics.rectangle("fill", npc.x - 7, npc.y + 6, 14, 6)
            else
                -- Default NPC body (humanoid)
                if npc.type == "adventure_guild" then
                    love.graphics.setColor(0.2, 0.7, 1, 0.9)
                elseif npc.type == "dungeon_leaderboard" then
                    love.graphics.setColor(1, 0.85, 0.2, 0.9)
                elseif npc.type == "portal_nexus" then
                    love.graphics.setColor(0.3, 0.9, 0.7, 0.9)
                elseif npc.type == "npc_shop" or npc.type == "shopkeeper" then
                    love.graphics.setColor(0.2, 0.8, 0.3, 0.9)
                else
                    love.graphics.setColor(0.6, 0.6, 0.6, 0.9)
                end
                love.graphics.rectangle("fill", npc.x - 8, npc.y - 12, 16, 24, 3, 3)
                -- Head
                local r2, g2, b2 = love.graphics.getColor()
                love.graphics.setColor(r2 + 0.1, g2 + 0.1, b2 + 0.1)
                love.graphics.circle("fill", npc.x, npc.y - 16, 7)
            end

            -- NPC name tag
            love.graphics.setFont(fonts.name)
            love.graphics.setColor(0.9, 0.85, 0.6, 0.9)
            love.graphics.printf(npc.name, npc.x - 60, npc.y - 34, 120, "center")
        end
    end

    -- Draw players (other players first, then self on top)
    -- Spatial culling: skip offscreen entities
    local cullMargin = 64
    local camLeft = camera.x - cullMargin
    local camRight = camera.x + love.graphics.getWidth() + cullMargin
    local camTop = camera.y - cullMargin
    local camBottom = camera.y + love.graphics.getHeight() + cullMargin

    for id, p in pairs(players) do
        if id ~= myId then
            if p.x >= camLeft and p.x <= camRight and p.y >= camTop and p.y <= camBottom then
                game.drawPlayer(p, false)
            end
        end
    end
    if myId and players[myId] then
        game.drawPlayer(players[myId], true)
    end

    -- Draw overworld monsters (world space, after players)
    if not dungeon.inDungeon and not tcState.overworldCombat then
        game.drawZoneMonsters()
        game.drawCorpsesAndContainers()
        game.drawPatrolUnits()
    end

    -- Draw leviathans on overworld (world space)
    if overworld.chunkBased and overworld.leviathans then
        game.drawLeviathans()
    end

    -- Draw floating texts (world space)
    game.drawFloatingTexts()

    love.graphics.pop()

    -- Time of day overlay
    local tod = TIME_COLORS[world.timeOfDay] or TIME_COLORS.day
    if tod[4] > 0 then
        love.graphics.setColor(tod[1], tod[2], tod[3], tod[4] * fadeIn)
        love.graphics.rectangle("fill", 0, 0, W, H)
    end

    -- Weather overlay
    game.drawWeather(W, H)

    -- Seasonal visual overlay (color shift + particles)
    game.drawSeasonVisual(W, H)

    -- NPC Dialogue panel
    game.drawDialoguePanel(W, H)

    -- Lich Corruption damage flash (purple vignette)
    if corruption.damageFlash > 0 then
        local cf = corruption.damageFlash
        love.graphics.setColor(0.3, 0.0, 0.4, cf * 0.4)
        love.graphics.rectangle("fill", 0, 0, W, H)
        -- Edge vignette
        love.graphics.setColor(0.5, 0.1, 0.6, cf * 0.3)
        love.graphics.rectangle("fill", 0, 0, W, 4)
        love.graphics.rectangle("fill", 0, H - 4, W, 4)
        love.graphics.rectangle("fill", 0, 0, 4, H)
        love.graphics.rectangle("fill", W - 4, 0, 4, H)
    end

    -- Purification VFX: expanding white ring
    if game._raid.purificationVfx then
        local pfx = game._raid.purificationVfx
        local progress = 1 - (pfx.timer / pfx.maxTimer)
        local alpha = (1 - progress) * 0.8
        love.graphics.setColor(0.9, 0.85, 1, alpha)
        love.graphics.setLineWidth(3)
        love.graphics.circle("line", pfx.x - (camera and camera.x or 0), pfx.y - (camera and camera.y or 0), pfx.radius)
        -- Inner glow
        love.graphics.setColor(1, 1, 1, alpha * 0.3)
        love.graphics.circle("fill", pfx.x - (camera and camera.x or 0), pfx.y - (camera and camera.y or 0), pfx.radius * 0.5)
    end

    -- Lich Corruption zone warning (when standing in corrupted area)
    if overworld.chunkBased and players[myId] then
        local pcx = math.floor(players[myId].x / overworld.chunkSize)
        local pcy = math.floor(players[myId].y / overworld.chunkSize)
        local pkey = pcx .. "," .. pcy
        local pLevel = corruption.chunks[pkey]
        if pLevel and pLevel > 0 then
            love.graphics.setFont(fonts.small)
            local warnAlpha = 0.6 + math.sin(corruption.animTimer * 3) * 0.2
            love.graphics.setColor(0.6, 0.1, 0.7, warnAlpha)
            local warnText = "CORRUPTED AREA (Lv." .. pLevel .. ")"
            love.graphics.printf(warnText, 0, H - 50, W, "center")
        end
    end

    -- Rift sealed reward popup (screen space, center overlay)
    if riftRewardPopup then
        local rp = riftRewardPopup
        local rewards = rp.rewards or {}
        local fadeProgress = math.min(1, (rp.maxTimer - rp.timer) / 0.3)  -- fade in over 0.3s
        local fadeOut = math.min(1, rp.timer / 0.5)  -- fade out over last 0.5s
        local alpha = math.min(fadeProgress, fadeOut)

        local panelW = 320
        local panelH = 180
        local px = (W - panelW) / 2
        local py = (H - panelH) / 2 - 40

        -- Background panel
        love.graphics.setColor(0.05, 0.02, 0.1, 0.88 * alpha)
        love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
        love.graphics.setColor(0.6, 0.25, 0.9, 0.7 * alpha)
        love.graphics.setLineWidth(2)
        love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
        love.graphics.setLineWidth(1)

        -- Title
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.8, 0.5, 1, alpha)
        love.graphics.printf("Rift Sealed!", px, py + 10, panelW, "center")

        -- Reward lines
        love.graphics.setFont(fonts.npc)
        local ly = py + 38
        local lineH = 18

        if rewards.gold and rewards.gold > 0 then
            love.graphics.setColor(1, 0.85, 0.2, alpha)
            love.graphics.printf("+" .. rewards.gold .. " Gold", px + 10, ly, panelW - 20, "center")
            ly = ly + lineH
        end
        if rewards.xp and rewards.xp > 0 then
            love.graphics.setColor(0.3, 0.9, 1, alpha)
            love.graphics.printf("+" .. rewards.xp .. " XP", px + 10, ly, panelW - 20, "center")
            ly = ly + lineH
        end
        if rewards.crystals and rewards.crystals > 0 then
            love.graphics.setColor(0.7, 0.4, 1, alpha)
            love.graphics.printf("+" .. rewards.crystals .. " Mana Crystals", px + 10, ly, panelW - 20, "center")
            ly = ly + lineH
        end
        if rewards.cardPacks and rewards.cardPacks > 0 then
            love.graphics.setColor(1, 0.7, 0.3, alpha)
            love.graphics.printf("+" .. rewards.cardPacks .. " Card Pack(s)", px + 10, ly, panelW - 20, "center")
            ly = ly + lineH
        end
        -- Generic items list
        if rewards.items then
            for _, item in ipairs(rewards.items) do
                love.graphics.setColor(0.8, 0.8, 0.8, alpha)
                local iName = item.name or item.type or "Item"
                local iQty = item.quantity or 1
                love.graphics.printf("+" .. iQty .. " " .. iName, px + 10, ly, panelW - 20, "center")
                ly = ly + lineH
            end
        end
    end

    -- HUD
    game.drawHUD(W, H)

    -- World systems HUD (disease, faction, ecology, wind)
    game.drawWorldSystemsHUD(W, H)

    -- Doom countdown HUD (above other overlays)
    game.drawDoomHUD(W, H)

    -- Level-up celebration (after HUD, before panels)
    game.drawLevelUpEffect(W, H)

    -- Loot panel (corpse/container)
    game.drawLootPanel(W, H)

    -- Onboarding tip banner (top-center, before panels)
    game.drawOnboardingTip(W, H)

    -- Monster hit flash vignette (overworld, reuses dungeon flash timer)
    game.drawMonsterHitFlash(W, H)

    -- Character sheet overlay
    if ui.showCharSheet then
        game.drawCharSheet(W, H)
    end

    -- Mastery tree overlay
    if ui.showMastery then
        game.drawMasteryPanel(W, H)
    end

    -- Card collection overlay
    if ui.showCardCollection then
        game.drawCardCollection(W, H)
    end

    -- Auction house overlay
    if game._auction.show then
        game.drawAuctionHouse(W, H)
    end

    -- Knowledge panel overlay
    if ui.showKnowledge then
        game.drawKnowledgePanel(W, H)
    end

    -- Farming panel overlay
    if ui.showFarming then
        game.drawFarmingPanel(W, H)
    end

    -- Companion panel overlay
    if ui.showCompanions then
        game.drawCompanionPanel(W, H)
    end

    -- Pet panel overlay
    if ui.showPets then
        game.drawPetPanel(W, H)
    end

    -- Guild panel overlay
    if ui.showGuild then
        game.drawGuildPanel(W, H)
    end

    -- Ascension panel overlay
    if ui.showAscension then
        game.drawAscensionPanel(W, H)
    end

    -- Jail overlay (forced when jailed)
    if ui.showJail and game._jail.inJail then
        game.drawJailPanel(W, H)
    end

    -- Audio settings panel overlay
    if ui.showAudioSettings then
        game.drawAudioSettingsPanel(W, H)
    end

    -- Sync panel overlay (F11)
    if game._sync.show then
        game.drawSyncPanel(W, H)
    end

    -- Crafting minigame overlay
    if game._minigame.active then
        game.drawCraftingMinigame(W, H)
    end

    -- Karma HUD (always visible, small indicator)
    game.drawKarmaHUD(W, H)

    -- Faction rep panel (toggle)
    if game._karma.showFactions then
        game.drawFactionPanel(W, H)
    end

    -- Bounties panel (F5)
    if game._karma.showBounties then
        game.drawBountiesPanel(W, H)
    end

    -- VIP & Sovereign panel (F4)
    if ui.showVip then
        game.drawVipPanel(W, H)
    end

    -- Rumors log panel (F6)
    if ui.showRumors then
        game.drawRumorsPanel(W, H)
    end

    -- Environment panel (F7: weather + ecology)
    if ui.showEnvironment then
        game.drawEnvironmentPanel(W, H)
    end

    -- Notifications (guard warnings, durability, etc.)
    game.drawNotifications(W, H)

    -- Knowledge game._notifications (book/term discovery popups)
    game.drawKnowledgeNotifications(W, H)

    -- Chat
    game.drawChat(W, H)

    -- Reset hovered item each frame (panels will set it if mouse is over an item)
    game._itemUI.hoveredItem = nil

    -- Inventory UI
    game.drawInventory(W, H)

    -- Grid inventory UI (Tarkov-style)
    if ui.showGridInventory and gridInv.hasGrid() then
        gridInv.setResources(mmoInventory)
        gridInv.draw(W, H)
    end

    -- Equipment panel (B1)
    game.drawEquipmentPanel(W, H)

    -- Item tooltip (drawn on top of inventory/equipment panels)
    game.drawItemTooltip(W, H)

    -- Loot drop game._notifications (bottom-right corner)
    game.drawLootNotifications(W, H)

    -- Party panel overlay
    if ui.showPartyPanel then
        game.drawPartyPanel(W, H)
    end

    -- Party HUD (always visible when in party, not covered by panel)
    if game._raid.partyData and game._raid.partyData.members and #game._raid.partyData.members > 0 and not ui.showPartyPanel then
        game.drawPartyHUD(W, H)
    end

    -- Party invite prompt (always visible when pending, on top of everything)
    if game._raid.partyInvitePending and not ui.showPartyPanel then
        game.drawPartyInvitePrompt(W, H)
    end

    -- Compass (overworld only)
    if overworld.chunkBased and not ui.showInventory and not ui.showWorldMap then
        game.drawCompass(W, H)
    end

    -- Leviathan HUD: warning/aggro banners + multi-part HP bars
    game.drawLeviathanHUD(W, H)

    -- World Map overlay
    if ui.showWorldMap then
        game.drawWorldMap(W, H)
    end

    -- Interaction prompts
    if hoverConnection then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(1, 1, 0.5, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
        if hoverConnection.isPlotEntrance then
            love.graphics.printf("Press E to enter " .. (hoverConnection.ownerName or "Player") .. "'s home", 0, H / 2 - 80, W, "center")
        elseif hoverConnection.targetZone == "rift_antechamber" then
            love.graphics.printf("Press E to enter The Rift", 0, H / 2 - 80, W, "center")
        else
            love.graphics.printf("Press E to enter " .. (hoverConnection.targetZone or "?"), 0, H / 2 - 80, W, "center")
        end
    elseif hoverResource then
        love.graphics.setFont(fonts.ui)
        if hoverResource.depleted then
            love.graphics.setColor(0.5, 0.5, 0.5, fadeIn * 0.7)
            love.graphics.printf("Respawning...", 0, H / 2 - 80, W, "center")
        else
            -- Check skill level requirement
            local myLevel = 1
            local reqSkill = hoverResource.skill or "mining"
            if skills and skills[reqSkill] then
                myLevel = skills[reqSkill].level or 1
            end
            local minLevel = hoverResource.minLevel or 1
            if myLevel < minLevel then
                local label = reqSkill:sub(1,1):upper() .. reqSkill:sub(2)
                love.graphics.setColor(1, 0.3, 0.3, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
                love.graphics.printf("Requires " .. label .. " Lv." .. minLevel, 0, H / 2 - 80, W, "center")
            else
                love.graphics.setColor(1, 1, 0.5, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
                love.graphics.printf("Press E to harvest " .. (hoverResource.name or "Resource"), 0, H / 2 - 80, W, "center")

                -- Health bar
                if hoverResource.hp and hoverResource.maxHp and hoverResource.maxHp > 0 then
                    local barW = 80
                    local barH = 8
                    local barX = W / 2 - barW / 2
                    local barY = H / 2 - 62
                    local ratio = hoverResource.hp / hoverResource.maxHp

                    -- Background
                    love.graphics.setColor(0, 0, 0, 0.6)
                    love.graphics.rectangle("fill", barX - 1, barY - 1, barW + 2, barH + 2, 3, 3)
                    -- Fill
                    local gr = 1 - ratio
                    local gg = ratio
                    love.graphics.setColor(gr, gg, 0.1, 0.9)
                    love.graphics.rectangle("fill", barX, barY, barW * ratio, barH, 2, 2)
                    -- Label
                    love.graphics.setFont(fonts.npc)
                    love.graphics.setColor(1, 1, 1, 0.8)
                    love.graphics.printf(hoverResource.hp .. "/" .. hoverResource.maxHp, barX, barY - 1, barW, "center")
                end
            end
        end
    end

    if hoverObject and not ui.showInventory and not ui.placementMode then
        love.graphics.setFont(fonts.ui)
        local label = hoverObject.type:gsub("_", " ")
        love.graphics.setColor(0.5, 1, 0.5, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
        love.graphics.printf("Press E to use " .. label, 0, H / 2 - 80, W, "center")
    end

    -- Mini-rift interaction prompt
    if overworld.hoverRift and not hoverConnection and not hoverResource and not hoverObject and not ui.showInventory then
        local rift = overworld.hoverRift
        local riftName = rift.name or "Rift"
        local tierNum = rift.tier or 1
        local floors = rift.totalFloors or "?"
        local prompt = "Press E to enter " .. riftName .. " (Tier " .. tierNum .. ", " .. floors .. " floors)"

        -- Pulsing purple text
        local promptAlpha = 0.7 + math.sin(love.timer.getTime() * 4) * 0.3
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.7, 0.3, 1, fadeIn * promptAlpha)
        love.graphics.printf(prompt, 0, H / 2 - 80, W, "center")

        -- Difficulty subtitle
        local diffKey = rift.difficulty or "medium"
        local DIFF_LABELS = { easy = "Easy", medium = "Medium", hard = "Hard", extreme = "Extreme" }
        local DIFF_COLORS_HUD = {
            easy    = {0.2, 0.9, 0.3},
            medium  = {1.0, 0.9, 0.2},
            hard    = {1.0, 0.55, 0.1},
            extreme = {1.0, 0.15, 0.15},
        }
        local dc = DIFF_COLORS_HUD[diffKey] or DIFF_COLORS_HUD.medium
        local subtitle = "Difficulty: " .. (DIFF_LABELS[diffKey] or "Unknown")
        if rift.minPlayerLevel and rift.minPlayerLevel > 1 then
            subtitle = subtitle .. "  |  Min Level: " .. rift.minPlayerLevel
        end
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(dc[1], dc[2], dc[3], fadeIn * 0.8)
        love.graphics.printf(subtitle, 0, H / 2 - 58, W, "center")
    end

    -- Cave interaction prompt
    if overworld.hoverCave and not hoverConnection and not hoverResource and not hoverObject and not ui.showInventory then
        love.graphics.setFont(fonts.ui)
        local caveName = overworld.hoverCave.name or "Cave"
        local prompt
        local subtitle
        if overworld.hoverCave.surfaceExit then
            prompt = "Press E to ascend through " .. caveName
            subtitle = "(Return to the Surface)"
        elseif overworld.hoverCave.hollowEarth then
            prompt = "Press E to descend into " .. caveName
            subtitle = "(Enter the Hollow Earth)"
        else
            prompt = "Press E to explore " .. caveName
            subtitle = "(Enter Dungeon)"
        end
        love.graphics.setColor(0.8, 0.6, 1, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
        love.graphics.printf(prompt, 0, H / 2 - 80, W, "center")
        if subtitle then
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.6, 0.4, 0.9, fadeIn * 0.7)
            love.graphics.printf(subtitle, 0, H / 2 - 58, W, "center")
        end
    end

    -- NPC interaction prompt
    if game._hoverNpc and not dungeon.inDungeon and not hoverConnection and not hoverResource and not ui.showInventory then
        love.graphics.setFont(fonts.ui)
        if game._hoverNpc.type == "adventure_guild" then
            love.graphics.setColor(1, 0.85, 0.2, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
            if dungeon.progress and dungeon.progress.guildMember then
                love.graphics.printf("Guild Rank: " .. (dungeon.progress.guildRank or "Stone"), 0, H / 2 - 80, W, "center")
            else
                love.graphics.printf("Press E to join the Adventure Guild", 0, H / 2 - 80, W, "center")
            end
        elseif game._hoverNpc.type == "dungeon_quest_board" then
            love.graphics.setColor(0.8, 0.7, 1, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
            love.graphics.printf("Press E to view Dungeon Quests", 0, H / 2 - 80, W, "center")
        elseif game._hoverNpc.type == "dungeon_leaderboard" then
            love.graphics.setColor(1, 0.85, 0.2, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
            love.graphics.printf("Press E to view Hall of Heroes", 0, H / 2 - 80, W, "center")
        elseif game._hoverNpc.type == "dungeon_entrance" then
            love.graphics.setColor(0.8, 0.4, 1, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
            love.graphics.printf("Press E to enter The Rift", 0, H / 2 - 80, W, "center")
        elseif game._hoverNpc.type == "npc_shop" or game._hoverNpc.type == "shopkeeper" then
            love.graphics.setColor(0.2, 0.9, 0.4, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
            love.graphics.printf("Press E to browse " .. (game._hoverNpc.name or "Shop"), 0, H / 2 - 80, W, "center")
        elseif game._hoverNpc.type == "portal_nexus" then
            love.graphics.setColor(0.5, 0.4, 1, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
            love.graphics.printf("Press E to open Portal Nexus", 0, H / 2 - 80, W, "center")
        elseif game._hoverNpc.type == "banker" then
            love.graphics.setColor(1, 0.85, 0.3, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
            love.graphics.printf("Press E to open Bank Vault", 0, H / 2 - 80, W, "center")
        end
    end

    -- Corruption cleanse prompt: show when player is in corrupted chunk
    if not dungeon.inDungeon and not ui.showInventory and me then
        local mcx = math.floor(me.x / overworld.chunkSize)
        local mcy = math.floor(me.y / overworld.chunkSize)
        local cKey = mcx .. "," .. mcy
        local cLevel = corruption.chunks[cKey]
        if cLevel and cLevel > 0 then
            -- Check if player has purification crystal (client-side hint; server validates)
            local hasCrystal = false
            if mmoInventory then
                hasCrystal = (mmoInventory.purification_crystal or 0) > 0
            end
            -- Check if player has an active overworld cleansing card equipped
            local hasCleanseCard = false
            local cleanseCardName = nil
            local cleanseCardId = nil
            if rpg.equippedCards and rpg.cards then
                -- Build instanceId -> card lookup
                local cardLookup = {}
                for _, c in ipairs(rpg.cards) do
                    if c and c.instanceId then cardLookup[c.instanceId] = c end
                end
                for _, eqId in ipairs(rpg.equippedCards) do
                    local card = eqId and cardLookup[eqId]
                    if card and card.effects then
                        for _, eff in ipairs(card.effects) do
                            if eff.type == "overworld_cleanse" then
                                hasCleanseCard = true
                                cleanseCardName = card.name or card.cardId
                                cleanseCardId = card.cardId
                                break
                            end
                        end
                    end
                    if hasCleanseCard then break end
                end
            end
            love.graphics.setFont(fonts.ui)
            local cPulse = 0.7 + math.sin(love.timer.getTime() * 4) * 0.3
            if hasCrystal then
                love.graphics.setColor(0.9, 0.8, 1, fadeIn * cPulse)
                love.graphics.printf("[F] Cleanse Corruption (level " .. cLevel .. ")", 0, H / 2 - 100, W, "center")
            end
            if hasCleanseCard then
                love.graphics.setColor(1, 0.85, 0.5, fadeIn * cPulse)
                local cardPromptY = hasCrystal and (H / 2 - 75) or (H / 2 - 100)
                love.graphics.printf("[R] Channel " .. (cleanseCardName or "Holy Power") .. " (drains HP & mana)", 0, cardPromptY, W, "center")
            end
        end
    end

    -- Lich Raid gathering UI overlay
    if game._raid.gathering and game._raid.gathering.phase == "gathering" then
        love.graphics.setFont(fonts.ui)
        local panelW, panelH = 400, 300
        local px = (W - panelW) / 2
        local py = (H - panelH) / 2

        -- Background
        love.graphics.setColor(0.05, 0.02, 0.1, 0.9)
        love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
        love.graphics.setColor(0.6, 0.2, 0.8, 0.8)
        love.graphics.setLineWidth(2)
        love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)

        -- Title
        love.graphics.setColor(0.9, 0.7, 1)
        love.graphics.printf("Sanctum of Veranthos - Raid", px, py + 10, panelW, "center")

        -- Player count
        local countColor = game._raid.gathering.totalPlayers >= game._raid.gathering.minRequired and {0.3, 1, 0.3} or {1, 0.8, 0.3}
        love.graphics.setColor(countColor[1], countColor[2], countColor[3])
        love.graphics.printf("Players: " .. game._raid.gathering.totalPlayers .. " / " .. game._raid.gathering.minRequired .. " (recommended)  [max " .. game._raid.gathering.maxAllowed .. "]", px, py + 35, panelW, "center")

        -- Party list
        love.graphics.setColor(0.8, 0.8, 0.9)
        local partyY = py + 60
        if game._raid.gathering.parties then
            for _, party in ipairs(game._raid.gathering.parties) do
                local isMyParty = (party.partyId == game._raid.myParty)
                if isMyParty then
                    love.graphics.setColor(0.5, 0.9, 1)
                else
                    love.graphics.setColor(0.7, 0.7, 0.8)
                end
                local memberStr = table.concat(party.members or {}, ", ")
                love.graphics.printf(party.partyId .. " (" .. party.memberCount .. "/4): " .. memberStr, px + 10, partyY, panelW - 20, "left")
                partyY = partyY + 18
                if partyY > py + panelH - 80 then break end
            end
        end

        -- Countdown
        if game._raid.gathering.countdownStarted and game._raid.gathering.countdownEndsAt > 0 then
            local remaining = math.max(0, math.ceil((game._raid.gathering.countdownEndsAt - os.time() * 1000) / 1000))
            love.graphics.setColor(1, 0.85, 0.2)
            love.graphics.printf("Raid starts in: " .. remaining .. "s", px, py + panelH - 70, panelW, "center")
        end

        -- Force start button hint
        love.graphics.setColor(0.7, 0.5, 1, 0.7 + math.sin(love.timer.getTime() * 3) * 0.3)
        love.graphics.printf("[Enter] Force Start (difficulty scales to group size)", px, py + panelH - 45, panelW, "center")

        -- Cancel hint
        love.graphics.setColor(0.6, 0.4, 0.4)
        love.graphics.printf("[Esc] Leave Raid", px, py + panelH - 25, panelW, "center")
    end

    -- Placement mode prompt
    if ui.placementMode then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.4, 0.9, 1, fadeIn * (0.7 + math.sin(love.timer.getTime() * 3) * 0.2))
        local typeLabel = (ui.placementType or ""):gsub("_", " "):gsub("(%a)([%w_']*)", function(a, b) return a:upper()..b end)
        love.graphics.printf("Click to place " .. typeLabel .. "  |  Right-click / Esc to cancel", 0, H - 40, W, "center")
    end

    -- Zone list overlay
    if ui.showZoneList then
        game.drawZoneList(W, H)
    end

    -- Dungeon quest/leaderboard panels (accessible from town NPCs too)
    if ui.showDungeonQuests then
        game.drawDungeonQuests(W, H)
    end
    if ui.showLeaderboard then
        game.drawLeaderboard(W, H)
    end

    -- Portal travel panel
    if game._portal.show then
        game.drawPortalPanel(W, H)
    end

    -- NPC Shop panel
    if game._npcShop.show then
        game.drawNpcShop(W, H)
    end

    -- Bank vault panel
    if game._bank.show then
        game.drawBank(W, H)
    end

    -- P2P Trade panel
    if game._trade.show then
        game.drawTradePanel(W, H)
    end

    -- P2P Trade incoming request popup (always drawn even when game._trade panel is not open)
    if game._trade.pendingRequest then
        game.drawTradeRequestPopup(W, H)
    end

    -- Director UI: world event banners + zone ticker (overworld)
    game.drawDirectorUI(W, H)

    -- Right-click context menu (drawn on top of everything)
    game.drawContextMenu()

    -- Admin panel overlay (server hosts, F10)
    game.drawAdminPanel(W, H)

    -- Pack reveal animation overlay (drawn on top of everything except reconnect)
    if packReveal then
        game.drawPackReveal(W, H)
    end

    -- Permadeath: bleedout overlay
    if permadeath.isDowned then
        game.drawBleedoutOverlay(W, H)
    end

    -- Permadeath: death epitaph screen
    if permadeath.showDeathScreen then
        game.drawPermaDeathScreen(W, H)
    end

    -- Permadeath: Hall of Heroes
    if permadeath.showHallOfHeroes then
        game.drawHallOfHeroes(W, H)
    end

    -- Reconnection overlay (drawn on very top)
    if game._reconnectOverlay then
        love.graphics.setColor(0, 0, 0, 0.7)
        love.graphics.rectangle("fill", 0, 0, W, H)
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(1, 0.8, 0.3, 1)
        love.graphics.printf("Connection Lost", 0, H / 2 - 30, W, "center")
        love.graphics.setFont(fonts.chat)
        love.graphics.setColor(0.8, 0.8, 0.8, 0.9)
        local attempt = (game._reconnectAttempt or 0) + 1
        local maxAttempts = game._reconnectTimers and #game._reconnectTimers or 3
        love.graphics.printf("Reconnecting... (attempt " .. attempt .. "/" .. maxAttempts .. ")", 0, H / 2 + 5, W, "center")
    elseif client and not client.connected then
        -- Persistent connection status indicator (small bar, not full overlay)
        local barH = 24
        love.graphics.setColor(0.8, 0.2, 0.1, 0.85)
        love.graphics.rectangle("fill", 0, 0, W, barH)
        love.graphics.setFont(fonts.chat)
        love.graphics.setColor(1, 1, 1, 0.95)
        love.graphics.printf("Disconnected from server", 0, 4, W, "center")
    end
end

function game.getZoneBgColor(zoneType)
    if zoneType == "town" then return { 0.15, 0.2, 0.12 }
    elseif zoneType == "hollow_earth" then return { 0.04, 0.03, 0.06 }
    elseif zoneType == "overworld" then return { 0.1, 0.18, 0.08 }
    elseif zoneType == "building" then return { 0.15, 0.13, 0.12 }
    elseif zoneType == "dungeon" then return { 0.08, 0.06, 0.1 }
    elseif zoneType == "plot" then return { 0.18, 0.15, 0.12 }
    else return { 0.1, 0.1, 0.1 }
    end
end

-- ================================================================
-- Pack reveal advance helper
-- ================================================================
function game.packRevealAdvance()
    if not packReveal or packReveal.done then return end
    if packReveal.currentIndex < #packReveal.cards then
        packReveal.currentIndex = packReveal.currentIndex + 1
        packReveal.timer = 0
        packReveal.phase = "flip"
        packReveal.flipProgress = 0
    else
        packReveal.done = true
    end
end

-- ================================================================
-- Onboarding tip check helper
-- ================================================================
function game.checkOnboardingTips()
    -- Don't show a new tip if one is already displayed
    if onboarding.currentTip then return end

    local me = players[myId]
    if not me then return end

    local function showTip(id, text)
        if onboarding.tips[id] then return false end
        onboarding.tips[id] = true
        onboarding.currentTip = { text = text, timer = 8.0 }
        return true
    end

    -- Tip: first zone entry (always show first)
    if not onboarding.tips["welcome"] then
        showTip("welcome", "Welcome! Use WASD to move, E to interact with NPCs")
        return
    end

    -- Tip: near a resource node
    if hoverResource and not onboarding.tips["harvest"] then
        showTip("harvest", "Press and hold E near resources to harvest")
        return
    end

    -- Tip: first time opening inventory
    if ui.showInventory and not onboarding.tips["panels"] then
        showTip("panels", "Press I for Inventory, C for Character Sheet, K for Cards")
        return
    end

    -- Tip: near Portal Nexus NPC
    if game._hoverNpc and game._hoverNpc.type == "portal_nexus" and not onboarding.tips["game._portal"] then
        showTip("game._portal", "Press E to fast-travel between towns")
        return
    end

    -- Tip: free stat points available
    if rpg.stats and rpg.stats.freePoints and rpg.stats.freePoints > 0 and not onboarding.tips["stat_points"] then
        showTip("stat_points", "You have stat points! Press C to open Character Sheet")
        return
    end

    -- Tip: pending card packs
    if rpg.pendingPacks and rpg.pendingPacks > 0 and not onboarding.tips["packs"] then
        showTip("packs", "Card packs available! Press K to open Card Collection")
        return
    end
end
function game.unload()
    game._audio.cleanup()
    game._audioSliderDrag = nil
    lighting.cleanup()
    dungeonParticles.cleanup()
    -- Release GPU canvases to avoid VRAM accumulation on scene re-entry
    if overworld.chunkCanvases then
        for _, canvas in pairs(overworld.chunkCanvases) do canvas:release() end
        overworld.chunkCanvases = {}
    end
    if dungeon._minimapCanvas then dungeon._minimapCanvas:release() end
    dungeon._minimapCanvas = nil
    if not client then return end
    -- Remove all event listeners registered by this scene
    for _, evt in ipairs(SCENE_EVENTS) do
        client:off(evt)
    end

    -- Clear corruption state
    corruption.chunks = {}
    corruption.damageFlash = 0
    corruption.globalInfo = nil

    -- Clear doom state
    doom.active = false
    doom.remainingMs = 0
    doom.showEvent = false
    doom.flashTimer = 0

    -- Clear world systems state
    game._disease.playerDiseases = {}
    game._disease.chunkDiseases = {}
    game._disease.contractedFlash = 0
    game._disease.symptomTimer = 0
    game._influence.controlling = nil
    game._influence.area = {}
    game._ecology.state = -1
    game._ecology.name = "unknown"

    -- Clear game._portal state
    game._portal.show = false
    game._portal.destinations = {}
    game._portal.scroll = 0
    game._portal.message = nil
    game._portal.cooldownEnd = 0

    -- Clear NPC shop state
    game._npcShop.show = false
    game._npcShop.prices = nil
    game._npcShop.shopList = nil
    game._npcShop.message = nil
    game._npcShop.transactionLock = false

    -- Clear game._trade state
    if game._trade.show and game._trade.tradeId and client then
        client:emit("trade_cancel", { tradeId = game._trade.tradeId })
    end
    resetTradeState()

    -- Clear sync panel state
    game._sync.show = false
    game._sync.confirm = false
    game._sync.status = nil
    game._sync.error = nil
    game._sync.statusTimer = 0

    -- Clear game._admin state
    game._admin.showPanel = false
    game._admin.resultMsg = nil
    game._admin.shutdownWarning = nil

    -- Clear director state
    game._directorEvents = {}
    game._zoneTicker = {}
    game._raid.state = nil
    game._raid.bossHp = nil

    -- Clear leviathan state
    overworld.leviathans = {}
    overworld.leviathanWarning = nil
    overworld.leviathanWarningTimer = 0
    overworld.leviathanAggro = nil
    overworld.leviathanAggroTimer = 0
    overworld.leviathanParts = nil
    overworld.leviathanCombatName = nil
    overworld.leviathanPhaseText = nil
    overworld.leviathanPhaseTimer = 0
    overworld.leviathanEnraged = false

    -- Clear party state
    game._raid.partyData = nil
    game._raid.partyInvitePending = nil
    game._raid.partyInviteInput = ""
    game._raid.partyInviteActive = false

    -- Clear mastery state
    mastery.skillName = nil
    mastery.tree = nil
    mastery.invested = {}
    mastery.points = 0
    mastery.hoverNode = nil
    mastery.message = nil
    mastery.messageTimer = 0
    dungeon.combatJoinOffer = nil
end

-- Resize: recreate fonts at new scale without resetting game state.
-- Without this function, main.lua's love.resize fallback calls game.load(),
-- which resets zone=nil and re-sends zone_enter, causing the game to hang
-- on "Loading zone..." or crash silently.
function game.resize(w, h)
    uiScale = math.max(0.75, w / 1024)
    local function sf(size) return math.floor(size * uiScale) end

    fonts.main = _G.getFont(sf(14))
    fonts.name = _G.getFont(sf(12))
    fonts.chat = _G.getFont(sf(13))
    fonts.chatInput = _G.getFont(sf(14))
    fonts.ui = _G.getFont(sf(16))
    fonts.title = _G.getFont(sf(20))
    fonts.npc = _G.getFont(sf(11))
    fonts.hud = _G.getFont(sf(13))
    fonts.small = _G.getFont(sf(10))
    fonts.zone = _G.getFont(sf(15))
    fonts.levelUp = _G.getFont(sf(28))
    lighting.resize(w, h)
end

-- Farming/knowledge/death/social panel draw+input extracted to scenes/game-draw/social.lua
function game.mousereleased(x, y, button)
    game._audioSliderDrag = nil
    if ui.showGridInventory then
        if gridInv.mousereleased(x, y, button) then return end
    end
end

return game
