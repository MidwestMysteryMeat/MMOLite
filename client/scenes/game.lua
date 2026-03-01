-- scenes/game.lua
-- Main game scene: zone rendering, player movement, chat, resources, skills

local net = require("lib.net")
local combatUI = require("scenes.combat-ui")
local combatAnim = require("scenes.combat-anim")
local gridInv = require("scenes.grid-inventory")
local lighting = require("lib.lighting")
local dungeonParticles = require("lib.particles")

local game = {}

-- Stash audio/assets on game table to avoid adding upvalues to setupListeners
-- (Lua 5.1 limit: 60 upvalues per function)
game._audio = require("lib.audio")
game._assets = require("lib.assets")

-- Single source of truth for all client:on() event names registered by this scene.
-- Both setupListeners() and unload() reference this list to prevent cleanup drift.
local SCENE_EVENTS = {
    "zone_state", "player_entered_zone", "player_left_zone", "player_moved",
    "zone_move_corrected",
    "zone_message", "zone_positions", "world_time", "server_stats",
    "account_created", "chips_updated", "harvest_result", "harvest_error",
    "resource_depleted", "resource_destroyed", "inventory_updated",
    "craft_result", "craft_error", "recipes_list", "object_placed",
    "object_removed", "place_result", "chunk_data",
    "plot_claimed", "plot_unclaimed", "claim_plot_result", "unclaim_plot_result",
    "disconnect", "rpg_stats", "stat_updated", "stat_error",
    "card_collection", "card_pack_opened", "card_equipped", "card_unequipped",
    "card_fuse_result", "card_error", "mount_changed",
    "portal_list", "portal_traveled", "portal_error",
    "dungeon_floor_state", "dungeon_player_moved",
    "dungeon_chest_result", "dungeon_trap_triggered", "dungeon_npc_result",
    "dungeon_corpse_examined", "dungeon_corpse_result",
    "dungeon_camp_placed", "dungeon_camp_result", "dungeon_camp_ambush",
    "dungeon_guild_result", "dungeon_quest_list_result", "dungeon_quest_complete_result",
    "dungeon_quest_completed",
    "dungeon_leaderboard_result", "dungeon_enemy_updated", "dungeon_player_died",
    "dungeon_combat_state", "dungeon_error", "cave_is_dungeon",
    "dungeon_enemies_update", "dungeon_enemy_attack", "dungeon_enemy_attack_visual",
    "dungeon_enemy_heal", "dungeon_boss_phase",
    "dungeon_notification", "dungeon_ambush", "dungeon_mana_update",
    "dungeon_heal", "dungeon_form_interact_result", "dungeon_animal_interact_result",
    "dungeon_warning", "dungeon_combat_use_card_result",
    "dungeon_visibility_update", "dungeon_torch_active", "dungeon_lantern_active",
    "dungeon_torch_placed", "dungeon_chat_message", "dungeon_vision_changed",
    "dungeon_harvest_result", "dungeon_trap_detected", "dungeon_shortcut_found",
    "loot_dropped",
    "player_downed", "player_downed_notification", "player_revived",
    "permadeath_triggered", "hall_of_heroes_result",
    "tc_combat_start", "tc_combat_turn",
    "tc_combat_end", "tc_combat_initiative", "tc_combat_reaction",
    "tc_combat_reaction_result", "tc_combat_error", "tc_combat_join_offer",
    "equipment_updated", "equip_error", "durability_info",
    "abilities_list", "ability_error", "ability_result", "cooldown_update",
    "card_ability_result", "card_cooldown_update",
    "food_consumed", "food_error", "repair_result", "repair_error",
    "connection_added", "connection_removed", "zone_kicked",
    "zone_error",
    "world_event", "zone_director_update",
    "raid_state_update", "raid_boss_ready", "raid_boss_hp",
    "raid_boss_wipe", "raid_boss_mechanic",
    "party_created", "party_updated", "party_disbanded",
    "party_invite_received", "party_message", "party_error",
    "party_left", "party_invite_sent", "party_kicked",
    "server_rules_updated", "server_shutdown", "admin_kicked", "admin_result",
    "leviathan_positions", "leviathan_warning", "leviathan_aggro",
    "leviathan_combat_start", "leviathan_part_destroyed",
    "leviathan_phase_change", "leviathan_enrage",
    "leviathan_flee_success", "leviathan_flee_failed",
    "leviathan_info_result",
    "npc_dialogue", "npc_dialogue_end",
    "npc_shop_list", "npc_shop_prices_result", "npc_shop_bought",
    "npc_shop_sold", "npc_shop_error",
    "trade_request_received", "trade_request_sent", "trade_started",
    "trade_offer_updated", "trade_partner_confirmed", "trade_completed",
    "trade_cancelled", "trade_expired", "trade_error",
    "quest_accepted", "quest_progress", "quest_turnin_result", "quest_list_result",
    "quest_error",
    "monster_capture_result", "monster_evolve_result",
    "zone_monsters", "zone_monster_spawned", "zone_monster_died",
    "zone_monster_hit", "zone_monster_attack", "zone_monster_killed", "zone_monster_positions",
    "zone_attack_error",
    "biome_weather", "town_rumors", "town_rep_update", "cave_enter_error",
    "zone_animal_interact_result", "bonus_drop", "item_broken", "durability_warning",
    "batch_move",
    "knowledge_data", "knowledge_book_content",
    "knowledge_book_discovered", "knowledge_term_unlocked",
    "corruption_update", "corruption_damage", "town_under_attack",
    "raid_gathering_update", "raid_joined", "raid_activated", "raid_cancelled",
    "raid_warning", "raid_boss_phase", "raid_boss_engage", "raid_complete",
    "corruption_cleanse_result", "corruption_card_cleanse_result",
    "tc_boss_phase_change", "tc_units_spawned", "tc_corruption_zones",
    "tc_boss_soul_harvest", "tc_boss_attack",
    "seed_planted", "crop_watered", "crop_harvested", "crop_cleared",
    "crop_status", "farm_update", "farm_error",
    "animal_bought", "animal_placed", "animals_fed", "products_collected", "animal_named",
    "furniture_effect",
    "base_raid_alert", "raid_wave", "raid_ended",
    "unclaim_plot_confirm",
    "mmo_auction_listings", "mmo_auction_listed", "mmo_auction_bought",
    "mmo_auction_cancelled", "mmo_auction_my_results", "mmo_auction_error",
    "mmo_auction_update",
    "cure_success", "cure_error",
    "rift_spawned", "rift_destroyed", "rift_sealed_rewards",
    "card_vendor_bought", "card_vendor_sold", "card_vendor_catalog",
    "card_loadout_saved", "card_loadouts",
    "card_evolution_complete", "card_evolution_info", "card_curse_cleansed",
    "dungeon_quest_update",
    "mastery_tree_status", "mastery_invest_result", "mastery_reset_result",
    "doom_status", "doom_countdown_started", "doom_countdown_paused",
    "doom_countdown_resumed", "doom_ascension_event",
    "season_visual_update",
    "disease_status", "disease_contracted", "disease_symptom",
    "weather_info", "influence_info", "ecology_info",
    "patrol_spawned", "patrol_moved", "patrol_despawned", "patrol_arrived",
    "bank_contents", "bank_result", "bank_error", "npc_action",
    "grid_state", "grid_update", "grid_reject", "grid_item_added",
    "zone_corpse_spawned", "zone_corpse_removed",
    "loot_corpse_result",
    "zone_container_spawned", "zone_container_looted",
    "loot_container_result",
    -- Karma / factions
    "karma_status", "bounty_list",
    "faction_status", "faction_list",
    -- Companions
    "companion_hired", "companion_error", "companion_list",
    "companion_dismissed", "companion_status",
    -- Pets
    "pet_tamed", "pet_error", "pet_list", "pet_fed", "pet_active_set",
    -- Jail
    "jail_status", "jail_bail", "jail_serve_time",
    -- Ascension
    "ascension_status", "ascension_result", "ascension_ap_result",
    -- Guild
    "guild_created", "guild_error", "guild_list_result", "guild_updated",
    "guild_left", "guild_message", "guild_vault_contents", "guild_vault_updated",
    -- Crafting minigame
    "craft_minigame",
    -- Crafting: advanced results
    "gem_socket_result", "augment_result", "imbue_result", "inscribe_result",
    -- Guard hostility
    "guard_hostile",
    -- Other
    "affliction_status", "npc_interact_result", "wild_encounter_result",
    "placed_objects", "portal_crafted", "portal_destroyed",
    "pin_setup_required", "monster_roster", "monster_party_updated",
}

-- Debug logger: writes to file so we can diagnose issues in fused exe (no console)
local _debugLines = {}
local function debugLog(msg)
    local line = os.date("%H:%M:%S") .. " " .. tostring(msg)
    print("[dbg] " .. line)
    table.insert(_debugLines, line)
    if #_debugLines > 100 then table.remove(_debugLines, 1) end
    -- Append to log file via love.filesystem (works in fused exe)
    pcall(function()
        love.filesystem.append("debug.log", line .. "\n")
    end)
end

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
local function addChatMessage(text, rgbColor)
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
local NOTIFICATION_DURATION = 4.0

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

-- Build context menu items for a specific target (adds Kick if leader + same party)
local function getContextMenuItems(targetId)
    local items = {}
    for _, item in ipairs(CONTEXT_MENU_ITEMS_BASE) do
        table.insert(items, item)
    end
    -- Add "Kick from Party" if we are party leader and target is in our party
    if game._raid.partyData and game._raid.partyData.leader == myId and targetId then
        local targetInParty = false
        for _, m in ipairs(game._raid.partyData.members) do
            if m.id == targetId then
                targetInParty = true
                break
            end
        end
        if targetInParty then
            table.insert(items, { label = "Kick from Party", action = "party_kick" })
        end
    end
    return items
end
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

local function addFloatingText(entry)
    if #floatingTexts >= MAX_FLOATING_TEXTS then
        table.remove(floatingTexts, 1)
    end
    table.insert(floatingTexts, entry)
end

-- MMO Inventory
local mmoInventory = { wood = 0, stone = 0, iron_ore = 0, iron_bar = 0, items = {} }
local equipment = { axe = nil, pickaxe = nil }

local recipes = {}

-- Equipment/durability state for equipment panel (B1)
local durabilityData = {}         -- slot -> { current, max }
local equipSlotButtons = {}       -- populated each frame in drawEquipmentPanel
local inventoryItemButtons = {}   -- populated each frame in drawItemsTab
local craftingButtons = {}        -- populated each frame in drawCraftingTab

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
local function resetTradeState()
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

-- Stat allocation [+] button hit rects (rebuilt each frame in drawCharSheet)
local statAllocButtons = {}  -- { { key="vigor", x, y, w, h }, ... }

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
    game._karma.showFactions = false
    game._karma.showBounties = false
    -- Close game._trade panel (but don't cancel server-side — let server handle timeout)
    if game._trade.show and game._trade.tradeId and client then
        client:emit("trade_cancel", { tradeId = game._trade.tradeId })
    end
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

        -- Clear stale local state on reconnect (players, resources, chunks)
        players = {}
        resources = {}
        overworld.chunks = {}
        if overworld.chunkCanvases then
            for _, canvas in pairs(overworld.chunkCanvases) do canvas:release() end
        end
        overworld.chunkCanvases = {}
        corruption.chunks = {}  -- Clear corruption data on zone transition

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
        players = {}
        connections = data.connections or {}
        resources = data.resources or {}
        placedObjects = data.placedObjects or {}

        -- Clear overworld monsters and request fresh list for this zone
        zoneMonsters = {}
        zoneCorpses = {}
        zoneWorldContainers = {}
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

    -- Doom ascension events
    client:on("doom_status", function(data)
        if data then
            doom.active = data.active or false
            doom.remainingMs = data.remainingMs or 0
            doom.pushbackCount = data.pushbackCount or 0
            doom.doomAscensionCount = data.doomAscensionCount or 0
            doom.capitalCorrupted = data.capitalCorrupted or false
            doom.lastUpdate = love.timer.getTime()
        end
    end)

    client:on("doom_countdown_started", function(data)
        if data then
            doom.active = true
            doom.remainingMs = 48 * 3600000
            doom.lastUpdate = love.timer.getTime()
            doom.capitalCorrupted = true
            doom.flashTimer = 3.0  -- 3s capital breach warning flash
            table.insert(game._directorEvents, {
                title = "DOOM APPROACHES",
                description = data.message or "The corruption has breached Solara.",
                type = "doom_started",
                timer = 10,
            })
        end
    end)

    client:on("doom_countdown_paused", function(data)
        if data then
            doom.active = false
            doom.remainingMs = data.remainingMs or 0
            doom.pushbackCount = data.pushbackCount or 0
            doom.capitalCorrupted = false
            doom.lastUpdate = love.timer.getTime()
            table.insert(game._directorEvents, {
                title = "Doom Paused",
                description = data.message or "The corruption recedes from Solara.",
                type = "doom_paused",
                timer = 8,
            })
        end
    end)

    client:on("doom_countdown_resumed", function(data)
        if data then
            doom.active = true
            doom.remainingMs = data.remainingMs or 0
            doom.capitalCorrupted = true
            doom.lastUpdate = love.timer.getTime()
            table.insert(game._directorEvents, {
                title = "DOOM RESUMES",
                description = data.message or "The corruption reclaims Solara.",
                type = "doom_resumed",
                timer = 8,
            })
        end
    end)

    client:on("doom_ascension_event", function(data)
        doom.showEvent = true
        doom.eventTimer = 8.0
        doom.eventMessage = data and data.message or "The world resets."
        doom.doomAscensionCount = data and data.doomAscensionCount or 0
    end)

    -- ACO patrol system: visible NPC faction armies on overworld
    client:on("patrol_spawned", function(data)
        if data and data.id then
            activePatrols[data.id] = {
                factionId = data.factionId,
                cx = data.cx, cy = data.cy,
                strength = data.strength or 1,
                description = data.description or "Patrol",
                hostile = data.hostile or false,
                color = data.color or "#ffffff",
            }
        end
    end)

    client:on("patrol_moved", function(data)
        if data and data.id and activePatrols[data.id] then
            activePatrols[data.id].cx = data.cx
            activePatrols[data.id].cy = data.cy
            activePatrols[data.id].strength = data.strength or activePatrols[data.id].strength
        end
    end)

    client:on("patrol_despawned", function(data)
        if data and data.id then
            activePatrols[data.id] = nil
        end
    end)

    client:on("patrol_arrived", function(data)
        if data and data.id then
            activePatrols[data.id] = nil
            if data.hostile then
                table.insert(game._directorEvents, {
                    title = (data.description or "Hostile Force") .. " Arrives!",
                    description = "A hostile force has reached its target.",
                    type = "patrol_arrived",
                    timer = 8,
                })
            end
        end
    end)

    -- Bank vault events
    client:on("bank_contents", function(data)
        if data then
            game._bank.data = data
            game._bank.transactionLock = false
        end
    end)

    client:on("bank_result", function(data)
        if not data then return end
        game._bank.transactionLock = false
        if data.success then
            if data.bank then game._bank.data = data.bank end
            if data.chips ~= nil then
                if identity and identity.account then identity.account.chips = data.chips end
            end
            if data.inventory then
                mmoInventory = data.inventory
                if identity and identity.account then identity.account.mmoInventory = data.inventory end
            end
            if data.message then
                game._bank.message = { text = data.message, color = {1, 0.85, 0.2}, timer = 3 }
            end
        end
    end)

    client:on("bank_error", function(data)
        game._bank.transactionLock = false
        if data and data.message then
            game._bank.message = { text = data.message, color = {1, 0.3, 0.3}, timer = 3 }
        end
    end)

    -- NPC action dispatch (server sends after dialogue choice with an action)
    client:on("npc_action", function(data)
        if not data or not data.action then return end
        if data.action == "open_bank" then
            game.closeAllPanels()
            game._bank.show = true
            game._bank.tab = "gold"
            game._bank.selected = nil
            game._bank.amount = 1
            game._bank.scroll = 0
            game._bank.data = nil
            game._bank.transactionLock = false
            if client then client:emit("bank_open", {}) end
        elseif data.action == "healed" then
            local me = players[myId]
            if me then
                addFloatingText({ text = "Healed!", x = me.x, y = me.y - 40, color = {0.3, 1, 0.5}, timer = 2.5 })
            end
        elseif data.action == "reveal_rumors" then
            if data.rumors then
                for _, rumor in ipairs(data.rumors) do
                    table.insert(chat.messages, { text = "[Rumor] " .. (rumor.text or rumor), color = "#CCAA66" })
                end
            end
        elseif data.action == "faction_rep_gained" then
            table.insert(chat.messages, { text = "[Faction] Reputation gained with " .. (data.factionId or "unknown"), color = "#88CCFF" })
        elseif data.action == "karma_changed" then
            table.insert(chat.messages, { text = "[Karma] Your karma is now " .. tostring(data.karma or 0), color = "#AAFFAA" })
        end
    end)

    -- Disease system events
    client:on("disease_status", function(data)
        if data then
            game._disease.playerDiseases = data.diseases or {}
            game._disease.chunkDiseases = data.chunkDiseases or {}
        end
    end)

    client:on("disease_contracted", function(data)
        if data then
            game._disease.contractedFlash = 3.0
            game._disease.contractedName = data.name or "Unknown Disease"
            table.insert(game._directorEvents, {
                title = "Disease Contracted",
                description = data.message or ("You have contracted " .. (data.name or "a disease")),
                type = "disease",
                timer = 8,
            })
        end
    end)

    client:on("disease_symptom", function(data)
        if data then
            game._disease.symptomMsg = (data.name or "Disease") .. ": " .. (data.damage or 0) .. " damage"
            game._disease.symptomTimer = 2.0
        end
    end)

    -- Weather propagation events
    client:on("weather_info", function(data)
        if data then
            game._weather.weather = data.weather or "clear"
            game._weather.intensity = data.intensity or 0.5
            game._weather.wind = data.wind and data.wind.name or "east"
        end
    end)

    -- Faction influence events
    client:on("influence_info", function(data)
        if data then
            game._influence.controlling = data.controlling
            game._influence.area = data.area or {}
        end
    end)

    -- Ecology events
    client:on("ecology_info", function(data)
        if data then
            game._ecology.state = data.state or -1
            game._ecology.name = data.name or "unknown"
            game._ecology.resourceBonus = data.resourceBonus or 1.0
        end
    end)

    client:on("account_created", function(data)
        if data and data.key and not _G.offlineMode and not _G.isServerHost then
            love.filesystem.write("account.dat", data.key)
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

    -- Card events
    client:on("card_collection", function(data)
        if data then
            rpg.cards = data.cards or {}
            rpg.equippedCards = data.equippedCards or {}
            rpg.cardSlots = data.cardSlots or 4
            rpg.pendingPacks = data.pendingPacks or 0
            rpg.cardEffects = data.effects or {}
            rpg.rarityInfo = data.rarityInfo or {}
        end
    end)

    client:on("card_pack_opened", function(data)
        if data then
            game._audio.playPackOpen()
            rpg.pendingPacks = data.pendingPacks or 0
            if data.cards and #data.cards > 0 then
                -- Start pack reveal animation instead of instant floating texts
                packReveal = {
                    cards = data.cards,
                    currentIndex = 1,
                    timer = 0,
                    phase = "flip",       -- "flip" -> "show" -> "advance"
                    flipProgress = 0,     -- 0..1 for flip animation
                    done = false,
                }
            end
            -- Refresh collection
            if client then client:emit("get_cards", {}) end
        end
    end)

    client:on("card_equipped", function(data)
        if data then
            rpg.equippedCards = data.equippedCards or {}
            rpg.cardEffects = data.effects or {}
        end
    end)

    client:on("card_unequipped", function(data)
        if data then
            rpg.equippedCards = data.equippedCards or {}
            rpg.cardEffects = data.effects or {}
        end
    end)

    client:on("card_fuse_result", function(data)
        if data and data.success and data.newCard and myId and players[myId] then
            addFloatingText({
                text = "Fusion: " .. data.newCard.name .. " [" .. data.newCard.rarity .. "]!",
                x = players[myId].x, y = players[myId].y - 40,
                color = { 1, 0.6, 1 }, timer = 4,
            })
            if client then client:emit("get_cards", {}) end
        end
    end)

    client:on("card_error", function(data)
        if data and data.message and myId and players[myId] then
            addFloatingText({
                text = data.message,
                x = players[myId].x, y = players[myId].y - 40,
                color = { 1, 0.3, 0.3 }, timer = 2.5,
            })
        end
    end)

    -- Card vendor events
    client:on("card_vendor_bought", function(data)
        if data then
            if account then account.coins = data.coins end
            if myId and players[myId] then
                addFloatingText({
                    text = "Purchased card!",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = { 0.3, 1, 0.5 }, timer = 2.5,
                })
            end
            if client then client:emit("get_cards", {}) end
        end
    end)

    client:on("card_vendor_sold", function(data)
        if data then
            if account then account.coins = data.coins end
            if myId and players[myId] then
                addFloatingText({
                    text = "Sold for " .. (data.coinsReceived or 0) .. " coins",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = { 1, 0.85, 0.2 }, timer = 2.5,
                })
            end
            if client then client:emit("get_cards", {}) end
            ui.selectedCard = nil
        end
    end)

    client:on("card_vendor_catalog", function(data)
        if data then
            game._cardVendor.catalog = data.cards or {}
        end
    end)

    -- Card loadout events
    client:on("card_loadout_saved", function(data)
        if data then
            game._cardLoadouts.loadouts = data.loadouts or { nil, nil, nil, nil, nil }
            if myId and players[myId] then
                addFloatingText({
                    text = "Loadout saved!",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = { 0.5, 0.8, 1 }, timer = 2,
                })
            end
        end
    end)

    client:on("card_loadouts", function(data)
        if data then
            game._cardLoadouts.loadouts = data.loadouts or { nil, nil, nil, nil, nil }
        end
    end)

    -- Card evolution complete (path chosen, card evolved)
    client:on("card_evolution_complete", function(data)
        if not data then return end
        local cardName = (data.card and data.card.name) or "Card"
        addChatMessage("Evolution complete: " .. cardName .. " (Path " .. (data.path or "?") .. ")", {0.6, 0.3, 1})
        if client then client:emit("get_cards", {}) end
    end)

    -- Card evolution info (evolution status query result)
    client:on("card_evolution_info", function(data)
        if not data then return end
        if data.evolvable and data.paths then
            addChatMessage("Card is ready to evolve! Paths available: " .. #data.paths, {0.7, 0.5, 1})
        end
    end)

    -- Card curse cleansed
    client:on("card_curse_cleansed", function(data)
        if not data then return end
        local cardName = (data.card and data.card.name) or "Card"
        addChatMessage("Curse cleansed from " .. cardName .. "!", {0.3, 1, 0.3})
        if client then client:emit("get_cards", {}) end
    end)

    -- Auction house events
    client:on("mmo_auction_listings", function(data)
        if data then
            game._auction.listings = data.listings or {}
            game._auction.page = data.page or 1
            game._auction.totalPages = data.totalPages or 1
            game._auction.totalResults = data.totalResults or 0
        end
    end)

    client:on("mmo_auction_listed", function(data)
        if data and myId and players[myId] then
            addFloatingText({
                text = "Listed: " .. (data.name or "item") .. " for " .. (data.price or 0) .. "c",
                x = players[myId].x, y = players[myId].y - 40,
                color = { 0.3, 1, 0.5 }, timer = 3,
            })
            if client then client:emit("get_cards", {}) end
        end
    end)

    client:on("mmo_auction_bought", function(data)
        if data and myId and players[myId] then
            addFloatingText({
                text = "Purchased: " .. (data.name or "item"),
                x = players[myId].x, y = players[myId].y - 40,
                color = { 0.3, 1, 0.5 }, timer = 3,
            })
            if account then account.coins = data.coins end
            if client then client:emit("get_cards", {}) end
        end
    end)

    client:on("mmo_auction_cancelled", function(data)
        if data and myId and players[myId] then
            addFloatingText({
                text = "Listing cancelled",
                x = players[myId].x, y = players[myId].y - 40,
                color = { 0.7, 0.7, 0.8 }, timer = 2,
            })
            if client then client:emit("get_cards", {}) end
        end
    end)

    client:on("mmo_auction_my_results", function(data)
        if data then
            game._auction.myListings = data.listings or {}
        end
    end)

    client:on("mmo_auction_error", function(data)
        if data and data.message and myId and players[myId] then
            addFloatingText({
                text = data.message,
                x = players[myId].x, y = players[myId].y - 40,
                color = { 1, 0.3, 0.3 }, timer = 2.5,
            })
        end
    end)

    client:on("mmo_auction_update", function()
        if game._auction.show and client then
            client:emit("mmo_auction_browse", game._auction.filters or {})
        end
    end)

    client:on("mount_changed", function(data)
        if data then rpg.mount = data.mount end
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

        -- Play combat start transition
        combatAnim.queue({ type = "transition_in", text = "COMBAT START", elapsed = 0 })
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

    -- Equipment updated (also store durability and dual-wield combo if provided)
    client:on("equipment_updated", function(data)
        if not data or not data.equipment then return end
        if rpg then
            rpg.equipment = data.equipment
            rpg.dualWieldCombo = data.dualWieldCombo or nil
        end
        if data.durability then durabilityData = data.durability end
    end)

    -- Equip error
    client:on("equip_error", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.message or "Equip error",
                x = me.x, y = me.y - 40,
                color = {1, 0.3, 0.3},
                timer = 2,
            })
        end
    end)

    -- B4: Durability info response
    client:on("durability_info", function(data)
        if data and data.durability then
            durabilityData = data.durability
            -- Show game._notifications for broken/low durability items
            for slot, info in pairs(data.durability) do
                if info.broken then
                    table.insert(game._notifications, { text = slot .. " item broke!", color = {1, 0.2, 0.2}, timer = NOTIFICATION_DURATION, maxTimer = NOTIFICATION_DURATION })
                elseif info.low then
                    table.insert(game._notifications, { text = slot .. " durability low!", color = {1, 0.7, 0.2}, timer = NOTIFICATION_DURATION, maxTimer = NOTIFICATION_DURATION })
                end
            end
        end
    end)

    -- B4: Food consumed response
    client:on("food_consumed", function(data)
        if not data then return end
        if data.inventory then mmoInventory = data.inventory end
        local me = players[myId]
        if me then
            local msg = "+" .. (data.hpRestored or 0) .. " HP"
            if data.buff then msg = msg .. " | " .. (data.buff.stat or "") .. " +" .. (data.buff.value or 0) end
            addFloatingText({ text = msg, x = me.x, y = me.y - 40, color = {0.3, 1, 0.3}, timer = 2.5 })
        end
        -- Restore sprint stamina from food
        sprint.stamina = math.min(sprint.MAX, sprint.stamina + sprint.FOOD_RESTORE)
        -- Resync grid inventory (item was consumed)
        if ui.showGridInventory then client:emit("grid_sync", {}) end
    end)

    -- B4: Food error response
    client:on("food_error", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({ text = data.message or "Cannot eat that", x = me.x, y = me.y - 40, color = {1, 0.3, 0.3}, timer = 2 })
        end
    end)

    -- B4: Repair result response
    client:on("repair_result", function(data)
        if not data then return end
        if data.inventory then mmoInventory = data.inventory end
        if data.durability then durabilityData = data.durability end
        local me = players[myId]
        if me then
            addFloatingText({ text = data.message or "Item repaired!", x = me.x, y = me.y - 40, color = {0.3, 0.8, 1}, timer = 2 })
        end
    end)

    -- B4: Repair error response
    client:on("repair_error", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({ text = data.message or "Repair failed", x = me.x, y = me.y - 40, color = {1, 0.3, 0.3}, timer = 2 })
        end
    end)

    -- -----------------------------------------------------------------------
    -- Combat ability listeners (overworld weapon/card abilities)
    -- -----------------------------------------------------------------------

    -- Abilities list (response to get_abilities — weapon-family abilities + cooldowns)
    client:on("abilities_list", function(data)
        if not data then return end
        game._abilityBar.abilities = data.abilities or {}
        game._abilityBar.weaponFamily = data.weaponFamily
    end)

    -- Ability error (cooldown, out of mana, out of range, etc.)
    client:on("ability_error", function(data)
        if not data then return end
        addChatMessage(data.message or "Ability failed", {1, 0.3, 0.3})
    end)

    -- Ability result (weapon ability hit/miss/damage feedback)
    client:on("ability_result", function(data)
        if not data then return end
        if data.success == false then
            addChatMessage(data.error or "Ability missed", {1, 0.5, 0.3})
        end
    end)

    -- Cooldown update (after using a weapon ability)
    client:on("cooldown_update", function(data)
        if not data then return end
        if data.abilities then
            game._abilityBar.abilities = data.abilities
        end
        if data.mana ~= nil then dungeon.playerMana = data.mana end
        if data.maxMana ~= nil then dungeon.playerMaxMana = data.maxMana end
        if data.cardAbilities then
            game._abilityBar.cardAbilities = data.cardAbilities
        end
    end)

    -- Card ability result (card-based ability used in overworld combat)
    client:on("card_ability_result", function(data)
        if not data then return end
        if data.success == false then
            addChatMessage(data.error or "Card ability failed", {1, 0.5, 0.3})
        end
    end)

    -- Card cooldown update (after using a card ability)
    client:on("card_cooldown_update", function(data)
        if not data then return end
        if data.cardAbilities then
            game._abilityBar.cardAbilities = data.cardAbilities
        end
        if data.mana ~= nil then dungeon.playerMana = data.mana end
        if data.maxMana ~= nil then dungeon.playerMaxMana = data.maxMana end
    end)

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

    -- Director: world event banner (gold banner, 5s fade)
    client:on("world_event", function(data)
        if not data then return end
        table.insert(game._directorEvents, {
            title = data.title or "World Event",
            description = data.description or "",
            type = data.type or "unknown",
            timer = data.duration or 5,
            fadeIn = 0,
        })
    end)

    -- Director: zone ticker (bottom-right, 5s)
    client:on("zone_director_update", function(data)
        if not data then return end
        table.insert(game._zoneTicker, {
            message = data.message or "",
            eventType = data.eventType or "info",
            timer = 5,
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
    -- ================================================================

    client:on("server_rules_updated", function(data)
        if not data then return end
        if data.xpRate then game._admin.xpRate = data.xpRate end
        if data.dropRate then game._admin.dropRate = data.dropRate end
        game._admin.resultMsg = { text = "Rules updated", color = {0.3, 1, 0.3}, timer = 3 }
    end)

    client:on("server_shutdown", function(data)
        game._admin.shutdownWarning = 10
        addFloatingText({
            text = "SERVER SHUTTING DOWN",
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 60) or 0,
            color = {1, 0.2, 0.2},
            timer = 10,
        })
    end)

    client:on("admin_kicked", function(data)
        addFloatingText({
            text = data and data.message or "You have been kicked by an game._admin",
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 40) or 0,
            color = {1, 0.3, 0.3},
            timer = 5,
        })
        -- Disconnect and return to shards
        if client and client.disconnect then
            client:disconnect()
        end
        _G.switchScene("shards")
    end)

    client:on("admin_result", function(data)
        if not data then return end
        game._admin.resultMsg = {
            text = data.message or "Action completed",
            color = data.success and {0.3, 1, 0.3} or {1, 0.3, 0.3},
            timer = 4,
        }
    end)

    -- NPC Shop: shop list (response to npc_shop_browse)
    client:on("npc_shop_list", function(data)
        if not data or not data.shops then return end
        game._npcShop.shopList = data.shops
        -- Auto-select first shop and fetch prices
        if #data.shops > 0 and not game._npcShop.prices then
            local firstShop = data.shops[1]
            game._npcShop.shopId = firstShop.id
            game._npcShop.shopName = firstShop.name or "Shop"
            game._npcShop.shopDesc = firstShop.description or ""
            client:emit("npc_shop_prices", { shopId = firstShop.id })
        end
    end)

    -- NPC Shop: price data for a specific shop
    client:on("npc_shop_prices_result", function(data)
        if not data or not data.prices then return end
        game._npcShop.prices = data.prices
        if data.shop then
            game._npcShop.shopId = data.shop.id or game._npcShop.shopId
            game._npcShop.shopName = data.shop.name or game._npcShop.shopName
            game._npcShop.shopDesc = data.shop.description or ""
        end
        game._npcShop.selected = nil
        game._npcShop.scroll = 0
        game._npcShop.amount = 1
    end)

    -- NPC Shop: bought item
    client:on("npc_shop_bought", function(data)
        if not data then return end
        game._npcShop.transactionLock = false
        -- Update local coin balance
        if data.coins ~= nil and account then
            account.coins = data.coins
        end
        -- Update local inventory
        if data.inventory then
            for k, v in pairs(data.inventory) do
                mmoInventory[k] = v
            end
        end
        -- Feedback message
        game._npcShop.message = {
            text = data.message or "Purchase complete!",
            color = {0.3, 1, 0.4},
            timer = 3,
        }
        -- Floating text
        if myId and players[myId] then
            addFloatingText({
                text = data.message or "Bought!",
                x = players[myId].x, y = players[myId].y - 40,
                color = {0.3, 1, 0.4},
                timer = 2.5,
            })
        end
        -- Refresh prices (they may have changed due to pressure)
        if client then
            client:emit("npc_shop_prices", { shopId = game._npcShop.shopId })
        end
    end)

    -- NPC Shop: sold item
    client:on("npc_shop_sold", function(data)
        if not data then return end
        game._npcShop.transactionLock = false
        -- Update local coin balance
        if data.coins ~= nil and account then
            account.coins = data.coins
        end
        -- Update local inventory
        if data.inventory then
            for k, v in pairs(data.inventory) do
                mmoInventory[k] = v
            end
        end
        -- Feedback message
        game._npcShop.message = {
            text = data.message or "Sale complete!",
            color = {0.3, 1, 0.4},
            timer = 3,
        }
        -- Floating text
        if myId and players[myId] then
            addFloatingText({
                text = data.message or "Sold!",
                x = players[myId].x, y = players[myId].y - 40,
                color = {1, 0.85, 0.3},
                timer = 2.5,
            })
        end
        -- Refresh prices
        if client then
            client:emit("npc_shop_prices", { shopId = game._npcShop.shopId })
        end
    end)

    -- NPC Shop: error
    client:on("npc_shop_error", function(data)
        if not data then return end
        game._npcShop.transactionLock = false
        game._npcShop.message = {
            text = data.message or "Transaction failed",
            color = {1, 0.3, 0.3},
            timer = 4,
        }
        if myId and players[myId] then
            addFloatingText({
                text = data.message or "Error",
                x = players[myId].x, y = players[myId].y - 40,
                color = {1, 0.3, 0.3},
                timer = 2.5,
            })
        end
    end)

    -- ========================================================================
    -- NPC Dialogue event listeners
    -- ========================================================================

    client:on("npc_dialogue", function(data)
        if not data then return end
        game._npcDialogue.show = true
        game._npcDialogue.npcName = data.npcName or "NPC"
        game._npcDialogue.text = data.text or "..."
        game._npcDialogue.choices = data.choices or {}
        game._npcDialogue.npcId = data.npcId or ""
    end)

    -- ========================================================================
    -- Affliction cure events (lycanthropy, vampire exposure)
    -- ========================================================================

    client:on("cure_success", function(data)
        if not data then return end
        -- Update coin display with the authoritative remaining value from server
        if data.coinsRemaining ~= nil and account then
            account.coins = data.coinsRemaining
        end
        -- Show result in chat as a system message
        table.insert(chat.messages, {
            authorName = "System",
            authorColor = "#44FF88",
            text = data.message or "Affliction cured.",
            isSystem = true,
        })
        -- Floating text on player
        local me = players[myId]
        if me then
            addFloatingText({ text = "Cured!", x = me.x, y = me.y - 40, color = {0.3, 1, 0.5}, timer = 2.5 })
        end
    end)

    client:on("cure_error", function(data)
        if not data then return end
        table.insert(chat.messages, {
            authorName = "System",
            authorColor = "#FF4444",
            text = data.message or "Cure failed.",
            isSystem = true,
        })
    end)

    client:on("npc_dialogue_end", function(data)
        game._npcDialogue.show = false
        game._npcDialogue.text = ""
        game._npcDialogue.choices = {}
    end)

    -- ========================================================================
    -- Quest event listeners
    -- ========================================================================

    client:on("quest_accepted", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({ text = "Quest Accepted: " .. (data.name or data.questId), x = me.x, y = me.y - 60, color = {0.3, 1, 0.6}, timer = 3 })
        end
    end)

    client:on("quest_progress", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            local msg = "Quest: " .. data.questId .. " (" .. data.progress .. "/" .. data.targetCount .. ")"
            if data.complete then msg = msg .. " COMPLETE!" end
            addFloatingText({ text = msg, x = me.x, y = me.y - 60, color = data.complete and {1, 0.85, 0.2} or {0.7, 0.8, 1}, timer = 2.5 })
        end
    end)

    client:on("quest_turnin_result", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            if data.success and data.rewards then
                local msg = "Quest Complete!"
                if data.rewards.coins then msg = msg .. " +" .. data.rewards.coins .. " coins" end
                if data.rewards.xp then msg = msg .. " +" .. data.rewards.xp .. " XP" end
                addFloatingText({ text = msg, x = me.x, y = me.y - 60, color = {1, 0.85, 0.2}, timer = 3 })
            end
        end
    end)

    client:on("quest_list_result", function(data)
        if not data then return end
        game._questLog = { active = data.active or {}, completed = data.completed or {} }
    end)

    client:on("quest_error", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.message or "Quest error",
                x = me.x, y = me.y - 40,
                color = {1, 0.3, 0.3},
                timer = 2.5,
            })
        end
    end)

    -- ========================================================================
    -- Monster capture/evolve event listeners
    -- ========================================================================

    client:on("monster_capture_result", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            if data.success then
                addFloatingText({ text = data.message or "Captured!", x = me.x, y = me.y - 60, color = {0.3, 1, 0.3}, timer = 3 })
            else
                addFloatingText({ text = data.message or "Capture failed!", x = me.x, y = me.y - 60, color = {1, 0.4, 0.4}, timer = 2.5 })
            end
        end
    end)

    client:on("monster_evolve_result", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            if data.success then
                addFloatingText({ text = (data.oldName or "Monster") .. " evolved into " .. (data.newName or "???") .. "!", x = me.x, y = me.y - 60, color = {1, 0.85, 0.2}, timer = 3 })
            else
                addFloatingText({ text = data.message or "Evolution failed!", x = me.x, y = me.y - 60, color = {1, 0.4, 0.4}, timer = 2.5 })
            end
        end
    end)

    -- ========================================================================
    -- P2P Trade event listeners
    -- ========================================================================

    -- Someone wants to game._trade with us
    client:on("trade_request_received", function(data)
        if not data then return end
        game._trade.pendingRequest = {
            tradeId = data.tradeId,
            fromName = data.fromName or "???",
            fromId = data.fromId,
        }
        -- Auto-dismiss after 25 seconds (server expires at 30s)
        game._trade._pendingTimer = 25
    end)

    -- Our game._trade request was sent (acknowledgement)
    client:on("trade_request_sent", function(data)
        -- Already showed floating text from context menu action; nothing extra needed
    end)

    -- Trade accepted — session opened
    client:on("trade_started", function(data)
        if not data or not data.tradeId then return end
        -- Clear pending request if this matches
        if game._trade.pendingRequest and game._trade.pendingRequest.tradeId == data.tradeId then
            -- We accepted: partner is the requester
            game._trade.partnerId = game._trade.pendingRequest.fromId
            game._trade.partnerName = game._trade.pendingRequest.fromName
        else
            -- We initiated: partner is whoever we sent the request to
            -- partnerName/Id will be filled from players table if possible
            -- (trade_request context menu already sent the request with targetId)
        end
        game._trade.pendingRequest = nil
        game._trade._pendingTimer = nil
        game._trade.tradeId = data.tradeId
        game._trade.show = true
        game._trade.myOffer = { items = {}, chips = 0 }
        game._trade.theirOffer = { items = {}, chips = 0 }
        game._trade.myConfirmed = false
        game._trade.theirConfirmed = false
        game._trade.coinInput = ""
        game._trade.coinInputActive = false
        game._trade.myScroll = 0
        game._trade.offerScroll = 0
        game._trade.message = nil

        -- If we don't have a partner name yet (we initiated), try to resolve it
        if (not game._trade.partnerName or game._trade.partnerName == "???") and game._trade.partnerId then
            local p = players[game._trade.partnerId]
            if p then
                game._trade.partnerName = p.name or "???"
            end
        end
    end)

    -- Partner updated their offer
    client:on("trade_offer_updated", function(data)
        if not data or data.tradeId ~= game._trade.tradeId then return end
        if data.offer then
            game._trade.theirOffer = {
                items = data.offer.items or {},
                chips = data.offer.chips or 0,
            }
        end
        -- Offer changed: both confirmations reset (server does this too)
        game._trade.myConfirmed = false
        game._trade.theirConfirmed = false
    end)

    -- Partner confirmed their side
    client:on("trade_partner_confirmed", function(data)
        if not data or data.tradeId ~= game._trade.tradeId then return end
        game._trade.theirConfirmed = true
    end)

    -- Trade completed successfully
    client:on("trade_completed", function(data)
        if not data then return end
        -- Update local inventory and coins from server response
        if data.inventory then
            for k, v in pairs(data.inventory) do
                mmoInventory[k] = v
            end
        end
        if data.coins ~= nil and account then
            account.coins = data.coins
        end
        -- Refresh card collection from server
        if client then
            client:emit("get_cards", {})
        end
        -- Show success feedback
        if myId and players[myId] then
            addFloatingText({
                text = "Trade completed!",
                x = players[myId].x, y = players[myId].y - 40,
                color = {0.3, 1, 0.4},
                timer = 3,
            })
        end
        resetTradeState()
    end)

    -- Trade cancelled (by partner or disconnect)
    client:on("trade_cancelled", function(data)
        if not data then return end
        -- Only handle if this is our active game._trade
        if game._trade.tradeId and data.tradeId == game._trade.tradeId then
            if myId and players[myId] then
                addFloatingText({
                    text = "Trade cancelled",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = {1, 0.7, 0.2},
                    timer = 3,
                })
            end
            resetTradeState()
        end
        -- Also clear pending request if it matches
        if game._trade.pendingRequest and game._trade.pendingRequest.tradeId == data.tradeId then
            game._trade.pendingRequest = nil
            game._trade._pendingTimer = nil
        end
    end)

    -- Trade request expired (30s timeout)
    client:on("trade_expired", function(data)
        if not data then return end
        if game._trade.pendingRequest and game._trade.pendingRequest.tradeId == data.tradeId then
            game._trade.pendingRequest = nil
            game._trade._pendingTimer = nil
        end
        -- If our sent request expired while game._trade panel not yet open
        if game._trade.tradeId == data.tradeId and not game._trade.show then
            resetTradeState()
        end
    end)

    -- Trade error
    client:on("trade_error", function(data)
        if not data then return end
        local msg = data.message or "Trade error"
        if game._trade.show then
            game._trade.message = {
                text = msg,
                color = {1, 0.3, 0.3},
                timer = 4,
            }
        end
        if myId and players[myId] then
            addFloatingText({
                text = msg,
                x = players[myId].x, y = players[myId].y - 40,
                color = {1, 0.3, 0.3},
                timer = 3,
            })
        end
        -- Close panel on fatal errors
        if msg:find("Trade failed") or msg:find("not found") then
            resetTradeState()
        end
    end)

    -- ================================================================
    -- Overworld Monster event listeners
    -- ================================================================

    client:on("zone_monsters", function(data)
        zoneMonsters = (data and data.monsters) or {}
    end)

    client:on("zone_monster_spawned", function(data)
        if not data then return end
        table.insert(zoneMonsters, data)
    end)

    client:on("zone_monster_died", function(data)
        if not data or not data.id then return end
        for i = #zoneMonsters, 1, -1 do
            if zoneMonsters[i].id == data.id then
                table.remove(zoneMonsters, i)
                break
            end
        end
    end)

    -- ---- Corpse & World Container Events ----
    client:on("zone_corpse_spawned", function(data)
        if not data or not data.id then return end
        table.insert(zoneCorpses, data)
    end)

    client:on("zone_corpse_removed", function(data)
        if not data or not data.id then return end
        for i = #zoneCorpses, 1, -1 do
            if zoneCorpses[i].id == data.id then
                table.remove(zoneCorpses, i)
                break
            end
        end
        -- Close loot panel if viewing this corpse
        if corpseLootPanel and corpseLootPanel.corpseId == data.id then
            corpseLootPanel = nil
        end
    end)

    client:on("loot_corpse_result", function(data)
        if not data then return end
        if data.error then
            game._statusMsg = data.error
            game._statusTimer = 3
            return
        end
        corpseLootPanel = data
    end)

    client:on("zone_container_spawned", function(data)
        if not data or not data.id then return end
        table.insert(zoneWorldContainers, data)
    end)

    client:on("zone_container_looted", function(data)
        if not data or not data.id then return end
        for i = #zoneWorldContainers, 1, -1 do
            if zoneWorldContainers[i].id == data.id then
                table.remove(zoneWorldContainers, i)
                break
            end
        end
        if containerLootPanel and containerLootPanel.containerId == data.id then
            containerLootPanel = nil
        end
    end)

    client:on("loot_container_result", function(data)
        if not data then return end
        if data.error then
            game._statusMsg = data.error
            game._statusTimer = 3
            return
        end
        containerLootPanel = data
    end)

    client:on("zone_monster_hit", function(data)
        if not data or not data.id then return end
        for _, m in ipairs(zoneMonsters) do
            if m.id == data.id then
                m.hp = data.remainingHp or m.hp
                break
            end
        end
    end)

    -- Monster position updates (patrol movement)
    client:on("zone_monster_positions", function(data)
        if not data or not data.monsters then return end
        for _, upd in ipairs(data.monsters) do
            for _, m in ipairs(zoneMonsters) do
                if m.id == upd.id then
                    -- Set target position for interpolation
                    m.targetX = upd.x
                    m.targetY = upd.y
                    if upd.patrolMode then
                        m.patrolMode = upd.patrolMode
                    end
                    break
                end
            end
        end
    end)

    client:on("zone_monster_attack", function(data)
        if not data then return end
        -- Flash red vignette (reuse dungeon hit flash)
        dungeon.hitFlashTimer = 0.25
        -- Floating damage text at player
        local me = players[myId]
        if me then
            addFloatingText({
                text = "-" .. (data.damage or 0) .. " (" .. (data.monsterName or "Monster") .. ")",
                x = me.x, y = me.y - 30,
                color = {1, 0.2, 0.2},
                timer = 1.5,
            })
        end
    end)

    client:on("zone_monster_killed", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            if data.xp and data.xp > 0 then
                addFloatingText({
                    text = "+" .. data.xp .. " XP",
                    x = me.x, y = me.y - 50,
                    color = {0.5, 0.8, 1},
                    timer = 2,
                })
            end
            if data.gold and data.gold > 0 then
                addFloatingText({
                    text = "+" .. data.gold .. " gold",
                    x = me.x, y = me.y - 66,
                    color = {1, 0.85, 0.2},
                    timer = 2,
                })
            end
        end
    end)

    client:on("zone_attack_error", function(data)
        if not data then return end
        local me = players[myId]
        if me then
            addFloatingText({
                text = data.message or "Attack failed",
                x = me.x, y = me.y - 30,
                color = {1, 0.3, 0.3},
                timer = 2,
            })
        end
    end)

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
            for _, rumor in ipairs(data.rumors) do
                if type(rumor) == "string" then
                    addChatMessage("  - " .. rumor, {0.7, 0.65, 0.4})
                elseif rumor.text then
                    addChatMessage("  - " .. rumor.text, {0.7, 0.65, 0.4})
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

    -- Server sends back list of available game._portal destinations
    client:on("portal_list", function(data)
        if not data then return end
        game._portal.destinations = data.destinations or {}
        game._portal.show = true
        game._portal.scroll = 0
        -- Preserve any existing error/cooldown message; it will auto-expire via timer
    end)

    -- Portal teleport succeeded — zone_state will follow from server
    client:on("portal_traveled", function(data)
        if not data then return end
        game._audio.playPortal()
        game._portal.show = false
        -- Set cooldown: 30 seconds from now
        game._portal.cooldownEnd = love.timer.getTime() + 30
        -- Show success floating text
        local destName = data.destinationName or "destination"
        if myId and players[myId] then
            addFloatingText({
                text = "Teleported to " .. destName,
                x = players[myId].x, y = players[myId].y - 40,
                color = {0.5, 0.6, 1},
                timer = 3.5,
            })
        end
    end)

    -- Portal error (cooldown, too far, etc.)
    client:on("portal_error", function(data)
        if not data then return end
        local msg = data.message or "Portal error"
        game._portal.message = {
            text = msg,
            color = {1, 0.35, 0.35},
            timer = 5,
        }
        -- If the panel is not open, also show as floating text
        if not game._portal.show and myId and players[myId] then
            addFloatingText({
                text = msg,
                x = players[myId].x, y = players[myId].y - 40,
                color = {1, 0.35, 0.35},
                timer = 3,
            })
        end
        -- Parse cooldown from error message (e.g. "Portal on cooldown (25s remaining)")
        local remaining = msg:match("%((%d+)s remaining%)")
        if remaining then
            game._portal.cooldownEnd = love.timer.getTime() + tonumber(remaining)
        end
    end)

    -- -----------------------------------------------------------------------
    -- Knowledge system listeners
    -- -----------------------------------------------------------------------
    client:on("knowledge_data", function(data)
        if not data then return end
        local tab = data.tab or "glossary"
        if tab == "glossary" then
            knowledge.glossaryTerms = data.glossaryTerms
            knowledge.glossaryUnlocked = data.glossaryUnlocked or {}
        elseif tab == "lore" then
            knowledge.loreData = data.loreData
        elseif tab == "books" then
            knowledge.books = data.books
        elseif tab == "codex" then
            knowledge.codex = data.codex
        end
    end)

    client:on("knowledge_book_content", function(data)
        if not data then return end
        if data.error then
            knowledge.bookContent = nil
            return
        end
        knowledge.bookContent = data
    end)

    client:on("knowledge_book_discovered", function(data)
        if not data then return end
        table.insert(knowledge.notifications, {
            type = "book",
            title = data.title or "Unknown Book",
            rarity = data.rarity or "common",
            source = data.source or "unknown",
            timer = 5,
        })
        -- Refresh books tab if knowledge panel is open
        if ui.showKnowledge and knowledge.tab == "books" and client then
            client:emit("knowledge_get", { tab = "books" })
        end
    end)

    client:on("knowledge_term_unlocked", function(data)
        if not data then return end
        table.insert(knowledge.notifications, {
            type = "term",
            term = data.term or "Unknown",
            category = data.category or "",
            timer = 4,
        })
    end)

    -- -----------------------------------------------------------------------
    -- Farming system listeners
    -- -----------------------------------------------------------------------
    client:on("seed_planted", function(data)
        if not data then return end
        addChatMessage("[Farming] Planted " .. (data.seedType or "seed"):gsub("_", " "), {0.4, 0.8, 0.3})
        if data.inventory then mmoInventory = data.inventory end
    end)

    client:on("crop_watered", function(data)
        if not data then return end
        addChatMessage("[Farming] Crop watered", {0.3, 0.7, 0.9})
    end)

    client:on("crop_harvested", function(data)
        if not data then return end
        local msg = "[Farming] Harvested " .. (data.amount or 1) .. "x " .. (data.output or "crop"):gsub("_", " ")
        if data.seedBack then msg = msg .. " (+1 seed back!)" end
        addChatMessage(msg, {0.4, 0.9, 0.3})
        if data.inventory then mmoInventory = data.inventory end
    end)

    client:on("crop_cleared", function(data)
        if not data then return end
        addChatMessage("[Farming] " .. (data.message or "Crop cleared"), {0.6, 0.6, 0.4})
    end)

    client:on("crop_status", function(data)
        if not data then return end
        ui.farmCrops = data.crops or {}
        ui.farmAnimals = data.animals or {}
    end)

    client:on("farm_update", function(data)
        if not data then return end
        if data.crops then ui.farmCrops = data.crops end
        if data.animals then ui.farmAnimals = data.animals end
    end)

    client:on("farm_error", function(data)
        if not data then return end
        addChatMessage("[Farming] " .. (data.message or "Error"), {0.9, 0.3, 0.3})
    end)

    client:on("animal_bought", function(data)
        if not data then return end
        addChatMessage("[Farming] Bought " .. (data.animal and data.animal.name or "animal"), {0.4, 0.8, 0.3})
    end)

    client:on("animal_placed", function(data)
        if not data then return end
        addChatMessage("[Farming] Animal placed in pen", {0.4, 0.8, 0.3})
    end)

    client:on("animals_fed", function(data)
        if not data then return end
        addChatMessage("[Farming] Animals fed!", {0.4, 0.8, 0.3})
        if data.inventory then mmoInventory = data.inventory end
    end)

    client:on("products_collected", function(data)
        if not data then return end
        local items = {}
        if data.collected then
            for k, v in pairs(data.collected) do
                table.insert(items, v .. "x " .. k:gsub("_", " "))
            end
        end
        addChatMessage("[Farming] Collected: " .. table.concat(items, ", "), {0.4, 0.9, 0.3})
        if data.inventory then mmoInventory = data.inventory end
    end)

    client:on("animal_named", function(data)
        if not data then return end
        addChatMessage("[Farming] Animal renamed to " .. (data.name or ""), {0.5, 0.7, 0.9})
    end)

    client:on("furniture_effect", function(data)
        if not data then return end
        addChatMessage("[Home] " .. (data.message or "Effect applied"), {0.6, 0.8, 1.0})
    end)

    -- -----------------------------------------------------------------------
    -- Base game._raid listeners
    -- -----------------------------------------------------------------------
    client:on("base_raid_alert", function(data)
        if not data then return end
        ui.baseRaidAlert = {
            plotZoneId = data.plotZoneId,
            message = data.message or "Your base is under attack!",
            alertDuration = data.alertDuration or 60000,
            receivedAt = love.timer.getTime(),
        }
        addChatMessage("[RAID ALERT] " .. (data.message or "Your base is under threat!"), {1.0, 0.2, 0.2})
    end)

    client:on("raid_wave", function(data)
        if not data then return end
        ui.baseRaidWaves = data.enemies or {}
        addChatMessage("[RAID] " .. (data.message or "Wave incoming!"), {1.0, 0.4, 0.2})
    end)

    client:on("raid_ended", function(data)
        if not data then return end
        ui.baseRaidEnded = data
        ui.baseRaidAlert = nil
        ui.baseRaidWaves = {}
        if data.result == "victory" then
            addChatMessage("[RAID] Victory! " .. (data.message or ""), {0.3, 1.0, 0.3})
        else
            addChatMessage("[RAID] " .. (data.message or "Defeat"), {1.0, 0.3, 0.3})
        end
    end)

    -- Mastery tree events
    client:on("mastery_tree_status", function(data)
        if not data then return end
        if data.error then
            mastery.message = data.error
            mastery.messageTimer = 3
            return
        end
        mastery.skillName = data.skillName
        mastery.tree = data.tree
        mastery.invested = data.invested or {}
        mastery.points = data.points or 0
        mastery.skillLevel = data.skillLevel or 1
        mastery.hoverNode = nil
    end)

    client:on("mastery_invest_result", function(data)
        if not data then return end
        if data.ok then
            mastery.invested[data.nodeId] = data.rank
            mastery.points = data.pointsLeft
            mastery.message = "Invested!"
        else
            mastery.message = data.error or "Failed"
        end
        mastery.messageTimer = 2
    end)

    client:on("mastery_reset_result", function(data)
        if not data then return end
        if data.ok then
            mastery.message = "Reset! Refunded " .. data.refundedPoints .. " pts (cost: " .. data.goldCost .. "g)"
            mastery.points = mastery.points + data.refundedPoints
            mastery.invested = {}
        else
            mastery.message = data.error or "Failed"
        end
        mastery.messageTimer = 3
    end)

    -- ===== Karma / Factions =====
    client:on("karma_status", function(data)
        if not data then return end
        game._karma.karma = data.karma or 0
        game._karma.activeBounty = data.activeBounty
        game._karma.isGuardHostile = data.isGuardHostile or false
    end)

    client:on("bounty_list", function(data)
        if not data then return end
        game._karma.bounties = data.bounties or {}
    end)

    client:on("faction_status", function(data)
        if not data then return end
        game._karma.factions = data.factions or {}
    end)

    client:on("faction_list", function(data)
        if not data then return end
        game._karma.factionList = data.factions or {}
    end)

    -- ===== Companions =====
    client:on("companion_hired", function(data)
        if not data then return end
        game._companions.message = "Hired " .. (data.companion and data.companion.name or "companion") .. "!"
        game._companions.messageTimer = 3
        if client then client:emit("companion_list", {}) end
    end)

    client:on("companion_error", function(data)
        if not data then return end
        game._companions.message = data.message or "Error"
        game._companions.messageTimer = 3
    end)

    client:on("companion_list", function(data)
        if not data then return end
        game._companions.companions = data.companions or {}
    end)

    client:on("companion_dismissed", function(data)
        if not data then return end
        game._companions.message = "Companion dismissed"
        game._companions.messageTimer = 3
        if client then client:emit("companion_list", {}) end
    end)

    client:on("companion_status", function(data)
        if not data then return end
        for i, c in ipairs(game._companions.companions) do
            if c.id == data.id then
                game._companions.companions[i] = data
                break
            end
        end
    end)

    -- ===== Pets =====
    client:on("pet_tamed", function(data)
        if not data then return end
        game._pets.message = "Tamed " .. (data.pet and data.pet.name or "pet") .. "!"
        game._pets.messageTimer = 3
        if client then client:emit("pet_list", {}) end
    end)

    client:on("pet_error", function(data)
        if not data then return end
        game._pets.message = data.message or "Error"
        game._pets.messageTimer = 3
    end)

    client:on("pet_list", function(data)
        if not data then return end
        game._pets.pets = data.pets or {}
        for _, p in ipairs(game._pets.pets) do
            if p.isActive then game._pets.activePetId = p.id end
        end
    end)

    client:on("pet_fed", function(data)
        if not data then return end
        for _, p in ipairs(game._pets.pets) do
            if p.id == data.petId then
                p.hunger = data.hunger
                p.happiness = data.happiness
                break
            end
        end
        game._pets.message = "Pet fed!"
        game._pets.messageTimer = 2
    end)

    client:on("pet_active_set", function(data)
        if not data then return end
        game._pets.activePetId = data.petId
        game._pets.message = data.petId and "Pet set as active" or "Pet dismissed from active"
        game._pets.messageTimer = 2
    end)

    -- ===== Jail =====
    client:on("jail_status", function(data)
        if not data then return end
        game._jail.inJail = data.inJail or false
        game._jail.crime = data.crime
        game._jail.crimeLabel = data.crimeLabel
        game._jail.remainingMs = data.remainingMs or 0
        game._jail.bail = data.bail or 0
        game._jail.jailZoneId = data.jailZoneId
        game._jail.lastUpdate = love.timer.getTime()
        if data.inJail and not ui.showJail then
            ui.showJail = true
        end
    end)

    client:on("jail_bail", function(data)
        if not data then return end
        if data.ok then
            game._jail.inJail = false
            game._jail.message = data.message or "Bail paid! You are free."
            ui.showJail = false
        else
            game._jail.message = data.error or "Cannot pay bail"
        end
        game._jail.messageTimer = 3
    end)

    client:on("jail_serve_time", function(data)
        if not data then return end
        if data.released then
            game._jail.inJail = false
            game._jail.message = data.message or "Time served. You are free."
            ui.showJail = false
        else
            game._jail.remainingMs = data.remainingMs or 0
            game._jail.lastUpdate = love.timer.getTime()
            game._jail.message = data.message or "Still serving time..."
        end
        game._jail.messageTimer = 3
    end)

    -- ===== Ascension =====
    client:on("ascension_status", function(data)
        if not data then return end
        game._ascension.canAscend = data.canAscend or false
        game._ascension.ascensionCount = data.ascensionCount or 0
        game._ascension.ascensionPoints = data.ascensionPoints or 0
        game._ascension.ascensionTree = data.ascensionTree or {}
        game._ascension.tree = data.tree
    end)

    client:on("ascension_result", function(data)
        if not data then return end
        if data.ok then
            game._ascension.ascensionCount = data.ascensionCount or game._ascension.ascensionCount
            game._ascension.ascensionPoints = data.totalAp or game._ascension.ascensionPoints
            game._ascension.message = "Ascended! +" .. (data.apGained or 0) .. " AP"
            game._ascension.canAscend = false
        else
            game._ascension.message = data.error or "Cannot ascend"
        end
        game._ascension.messageTimer = 3
    end)

    client:on("ascension_ap_result", function(data)
        if not data then return end
        if data.ok then
            game._ascension.ascensionTree[data.nodeId] = data.rank
            game._ascension.ascensionPoints = data.apLeft
            game._ascension.message = "Invested in " .. data.nodeId .. " (rank " .. data.rank .. ")"
        else
            game._ascension.message = data.error or "Cannot invest"
        end
        game._ascension.messageTimer = 3
    end)

    -- ===== Guild =====
    client:on("guild_created", function(data)
        if not data then return end
        game._guild.guildId = data.guildId
        game._guild.guildName = data.name
        game._guild.members = data.members or {}
        game._guild.tab = "info"
        game._guild.message = "Guild created!"
        game._guild.messageTimer = 3
    end)

    client:on("guild_error", function(data)
        if not data then return end
        game._guild.message = data.message or "Guild error"
        game._guild.messageTimer = 3
    end)

    client:on("guild_list_result", function(data)
        if not data then return end
        game._guild.guildList = data.guilds or {}
    end)

    client:on("guild_updated", function(data)
        if not data then return end
        game._guild.guildId = data.guildId
        game._guild.members = data.members or game._guild.members
        game._guild.message = data.event or "Guild updated"
        game._guild.messageTimer = 2
    end)

    client:on("guild_left", function(data)
        game._guild.guildId = nil
        game._guild.guildName = nil
        game._guild.members = {}
        game._guild.vault = nil
        game._guild.messages = {}
        game._guild.tab = "browse"
        game._guild.message = "Left guild"
        game._guild.messageTimer = 3
    end)

    client:on("guild_message", function(data)
        if not data then return end
        table.insert(game._guild.messages, {
            authorName = data.authorName or "???",
            content = data.content or "",
            timestamp = data.timestamp or 0,
        })
        if #game._guild.messages > 100 then table.remove(game._guild.messages, 1) end
    end)

    client:on("guild_vault_contents", function(data)
        if not data then return end
        game._guild.vault = { cards = data.cards or {}, resources = data.resources or {} }
    end)

    client:on("guild_vault_updated", function(data)
        if not data then return end
        if data.resources then game._guild.vault = game._guild.vault or {}; game._guild.vault.resources = data.resources end
        if data.cards then game._guild.vault = game._guild.vault or {}; game._guild.vault.cards = data.cards end
        game._guild.message = data.event or "Vault updated"
        game._guild.messageTimer = 2
    end)

    -- ===== Crafting Minigame =====
    client:on("craft_minigame", function(data)
        if not data then return end
        game._minigame.active = true
        game._minigame.recipeId = data.recipeId
        game._minigame.duration = data.duration or 3000
        game._minigame.windowStart = data.windowStart or 400
        game._minigame.windowEnd = data.windowEnd or 600
        game._minigame.expiresAt = love.timer.getTime() + (data.duration or 3000) / 1000
        game._minigame.barPos = 0
        game._minigame.barDir = 1
        game._minigame.startedAt = love.timer.getTime()
        game._minigame.result = nil
        game._minigame.resultTimer = 0
    end)

    -- -----------------------------------------------------------------------
    -- Crafting: advanced result listeners (gem socketing, augments, imbue, inscribe)
    -- -----------------------------------------------------------------------

    client:on("gem_socket_result", function(data)
        if not data then return end
        if data.success then
            addChatMessage("Gem socketed successfully!", {0.3, 1, 0.3})
            if data.inventory then mmoInventory = data.inventory end
        end
    end)

    client:on("augment_result", function(data)
        if not data then return end
        if data.success then
            addChatMessage("Augment applied!", {0.3, 1, 0.3})
            if data.inventory then mmoInventory = data.inventory end
        end
    end)

    client:on("imbue_result", function(data)
        if not data then return end
        if data.success then
            addChatMessage("Imbue successful!", {0.4, 0.7, 1})
            if data.inventory then mmoInventory = data.inventory end
        end
    end)

    client:on("inscribe_result", function(data)
        if not data then return end
        if data.success then
            addChatMessage("Inscription applied!", {0.8, 0.6, 1})
            if data.inventory then mmoInventory = data.inventory end
            if data.inscriptions then
                game._itemUI.inscriptionSlots = data.inscriptions
            end
        end
    end)

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

    -- Monster roster (tamed monsters list)
    client:on("monster_roster", function(data)
        if not data then return end
        if account then
            account.monsters = data.monsters or {}
            account.activeParty = data.activeParty or {}
        end
    end)

    -- Monster party updated (active party changed)
    client:on("monster_party_updated", function(data)
        if not data then return end
        if account then
            account.activeParty = data.activeParty or {}
        end
    end)

    -- ===== Guard Hostility Warning =====
    client:on("guard_hostile", function(data)
        if not data then return end
        table.insert(game._notifications, { text = data.message or "Guards refuse to serve you!", color = {1, 0.3, 0.3}, timer = NOTIFICATION_DURATION, maxTimer = NOTIFICATION_DURATION })
        game._karma.isGuardHostile = true
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
                local newX = dungeon.playerTileX + dx
                local newY = dungeon.playerTileY + dy

                -- Check bounds and walkability
                if dungeon.grid[newY + 1] and dungeon.grid[newY + 1][newX + 1] then
                    local tile = dungeon.grid[newY + 1][newX + 1]
                    if WALKABLE_TILES[tile] then
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
        if tcState.inCombat then
            combatUI.drawTileOverlays(camera.x, camera.y)
            combatUI.drawTileEffects(camera.x, camera.y)
            combatUI.drawUnitOverlays(camera.x, camera.y)
            combatAnim.draw()
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
            lighting.apply()

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

-- ================================================================
-- Draw: Overworld Monsters (called in world space)
-- ================================================================
function game.drawZoneMonsters()
    if #zoneMonsters == 0 then return end
    local me = players[myId]
    local cullLeft = camera.x - 64
    local cullRight = camera.x + love.graphics.getWidth() + 64
    local cullTop = camera.y - 64
    local cullBottom = camera.y + love.graphics.getHeight() + 64

    local t = love.timer.getTime()
    for _, m in ipairs(zoneMonsters) do
        local mx = m.x or 0
        local my = m.y or 0
        -- Camera culling
        if mx >= cullLeft and mx <= cullRight and my >= cullTop and my <= cullBottom then
            local isChasing = (m.patrolMode == "chase")
            -- Subtle bob animation when moving
            local bob = 0
            if m.moving then
                bob = math.sin(t * 8) * 2
            end

            -- Body: colored circle (red/orange for idle, brighter red for chasing)
            local hpRatio = (m.maxHp and m.maxHp > 0) and (m.hp / m.maxHp) or 1
            local r, g
            if isChasing then
                -- Aggressive red pulsing
                local pulse = 0.5 + 0.5 * math.sin(t * 6)
                r = 0.9 + 0.1 * pulse
                g = 0.1 + 0.1 * pulse
            else
                r = 0.8 + 0.2 * (1 - hpRatio)
                g = 0.25 + 0.2 * hpRatio
            end
            love.graphics.setColor(r, g, 0.1, 0.9)
            love.graphics.circle("fill", mx, my + bob, 12)
            -- Outline (red highlight when chasing)
            if isChasing then
                love.graphics.setColor(0.9, 0.15, 0.1, 0.9)
            else
                love.graphics.setColor(0.4, 0.1, 0.1, 0.7)
            end
            love.graphics.setLineWidth(1.5)
            love.graphics.circle("line", mx, my + bob, 12)

            -- HP bar above
            local barW = 28
            local barH = 4
            local barX = mx - barW / 2
            local barY = my - 20
            love.graphics.setColor(0, 0, 0, 0.6)
            love.graphics.rectangle("fill", barX - 1, barY - 1, barW + 2, barH + 2, 2, 2)
            local gr = 1 - hpRatio
            local gg = hpRatio
            love.graphics.setColor(gr, gg, 0.1, 0.9)
            love.graphics.rectangle("fill", barX, barY, barW * hpRatio, barH, 1, 1)

            -- Monster name below
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(1, 0.7, 0.5, 0.8)
            local label = (m.name or "Monster")
            if m.level then label = "Lv" .. m.level .. " " .. label end
            love.graphics.printf(label, mx - 50, my + 16, 100, "center")

            -- "Space to attack" prompt if player is within 64px
            if me then
                local ddx = me.x - mx
                local ddy = me.y - my
                if ddx * ddx + ddy * ddy < 64 * 64 then
                    love.graphics.setFont(fonts.small)
                    love.graphics.setColor(1, 1, 0.5, 0.7 + 0.3 * math.sin(love.timer.getTime() * 4))
                    love.graphics.printf("Space to attack " .. (m.name or ""), mx - 60, my + 28, 120, "center")
                end
            end
        end
    end
end

-- ================================================================
-- Draw: Corpses & World Containers (world space)
-- ================================================================
function game.drawCorpsesAndContainers()
    local me = players[myId]
    local t = love.timer.getTime()

    -- Draw corpses as bone-white skull shapes
    for _, c in ipairs(zoneCorpses) do
        local cx, cy = c.x or 0, c.y or 0
        -- Bone white body
        love.graphics.setColor(0.85, 0.82, 0.7, 0.8)
        love.graphics.circle("fill", cx, cy, 8)
        -- X eyes
        love.graphics.setColor(0.4, 0.1, 0.1, 0.9)
        love.graphics.setLineWidth(1.5)
        love.graphics.line(cx - 4, cy - 3, cx - 1, cy)
        love.graphics.line(cx - 1, cy - 3, cx - 4, cy)
        love.graphics.line(cx + 1, cy - 3, cx + 4, cy)
        love.graphics.line(cx + 4, cy - 3, cx + 1, cy)
        -- Glow if has loot
        if c.hasItems or c.hasGold then
            local glow = 0.3 + 0.15 * math.sin(t * 3)
            love.graphics.setColor(1, 0.85, 0.3, glow)
            love.graphics.circle("line", cx, cy, 12)
        end
        -- Label
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.9, 0.85, 0.7, 0.7)
        love.graphics.printf(c.name or "Remains", cx - 50, cy + 12, 100, "center")
        -- Interact prompt
        if me then
            local dx = me.x - cx
            local dy = me.y - cy
            if dx * dx + dy * dy < 128 * 128 then
                love.graphics.setColor(1, 0.9, 0.5, 0.6 + 0.3 * math.sin(t * 4))
                love.graphics.printf("E to loot", cx - 40, cy + 24, 80, "center")
            end
        end
    end

    -- Draw world containers as small brown boxes
    for _, wc in ipairs(zoneWorldContainers) do
        local wx, wy = wc.x or 0, wc.y or 0
        -- Box body
        love.graphics.setColor(0.55, 0.35, 0.15, 0.9)
        love.graphics.rectangle("fill", wx - 8, wy - 6, 16, 12, 2, 2)
        -- Lid
        love.graphics.setColor(0.65, 0.42, 0.18, 0.9)
        love.graphics.rectangle("fill", wx - 9, wy - 8, 18, 4, 1, 1)
        -- Latch
        love.graphics.setColor(0.8, 0.7, 0.3, 0.8)
        love.graphics.rectangle("fill", wx - 2, wy - 4, 4, 3)
        -- Glow if has items
        if wc.hasItems then
            local glow = 0.25 + 0.15 * math.sin(t * 2.5)
            love.graphics.setColor(1, 0.9, 0.4, glow)
            love.graphics.circle("line", wx, wy, 14)
        end
        -- Label
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.8, 0.7, 0.5, 0.7)
        love.graphics.printf(wc.name or "Container", wx - 50, wy + 10, 100, "center")
        -- Interact prompt
        if me then
            local dx = me.x - wx
            local dy = me.y - wy
            if dx * dx + dy * dy < 128 * 128 then
                love.graphics.setColor(1, 0.9, 0.5, 0.6 + 0.3 * math.sin(t * 4))
                love.graphics.printf("E to loot", wx - 40, wy + 22, 80, "center")
            end
        end
    end
end

-- ================================================================
-- Draw: Loot Panel (screen-space overlay for corpse/container looting)
-- ================================================================
function game.drawLootPanel(W, H)
    local panel = corpseLootPanel or containerLootPanel
    if not panel then return end

    local panelW = 280
    local panelH = 300
    local px = W / 2 - panelW / 2
    local py = H / 2 - panelH / 2

    -- Background
    love.graphics.setColor(0.08, 0.08, 0.12, 0.92)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 6, 6)
    love.graphics.setColor(0.5, 0.4, 0.25, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 6, 6)

    -- Title
    love.graphics.setFont(fonts.medium or _G.getFont(14))
    love.graphics.setColor(0.95, 0.9, 0.7)
    love.graphics.printf(panel.name or "Loot", px, py + 8, panelW, "center")

    local yOff = py + 32
    love.graphics.setFont(fonts.small or _G.getFont(11))

    -- Gold
    if panel.gold and panel.gold > 0 then
        love.graphics.setColor(1, 0.85, 0.2)
        love.graphics.print("Gold: " .. panel.gold, px + 10, yOff)
        yOff = yOff + 18
    end

    -- Resources
    if panel.resources then
        for resType, amount in pairs(panel.resources) do
            if amount > 0 then
                love.graphics.setColor(0.7, 0.9, 0.7)
                local resName = resType:gsub("_", " ")
                love.graphics.print(resName .. " x" .. amount, px + 10, yOff)
                yOff = yOff + 16
            end
        end
    end

    -- Items
    if panel.items and #panel.items > 0 then
        yOff = yOff + 4
        love.graphics.setColor(0.8, 0.8, 0.9, 0.6)
        love.graphics.line(px + 10, yOff, px + panelW - 10, yOff)
        yOff = yOff + 6

        for idx, item in ipairs(panel.items) do
            local rarity = item.rarity or "common"
            local rc = {0.7, 0.7, 0.7}
            if rarity == "uncommon" then rc = {0.3, 0.8, 0.3}
            elseif rarity == "rare" then rc = {0.3, 0.5, 1}
            elseif rarity == "ultra_rare" then rc = {0.7, 0.3, 0.9}
            elseif rarity == "legendary" then rc = {1, 0.7, 0.2}
            elseif rarity == "relic" then rc = {1, 0.3, 0.3} end

            love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
            love.graphics.print((item.name or "Item") .. " [" .. idx .. "]", px + 10, yOff)
            yOff = yOff + 16
            if yOff > py + panelH - 50 then break end
        end
    end

    -- Buttons
    local btnY = py + panelH - 36
    -- Take All
    love.graphics.setColor(0.2, 0.5, 0.2, 0.85)
    love.graphics.rectangle("fill", px + 10, btnY, 100, 26, 4, 4)
    love.graphics.setColor(0.9, 0.95, 0.9)
    love.graphics.printf("Take All", px + 10, btnY + 5, 100, "center")
    -- Close
    love.graphics.setColor(0.5, 0.2, 0.2, 0.85)
    love.graphics.rectangle("fill", px + panelW - 110, btnY, 100, 26, 4, 4)
    love.graphics.setColor(0.95, 0.85, 0.85)
    love.graphics.printf("Close", px + panelW - 110, btnY + 5, 100, "center")

    -- Store layout for click detection
    game._lootPanelRect = { x = px, y = py, w = panelW, h = panelH, btnY = btnY }
end

-- ================================================================
-- Draw: Level-Up Celebration (screen-space overlay)
-- ================================================================
function game.drawLevelUpEffect(W, H)
    if not levelUpEffect or levelUpEffect.timer <= 0 then return end
    local a = levelUpEffect.alpha or 1

    -- Expanding golden ring
    local ringR = levelUpEffect.ringRadius or 0
    if ringR > 0 then
        local ringAlpha = math.max(0, a * (1 - ringR / 400))
        love.graphics.setColor(1, 0.85, 0.2, ringAlpha * 0.5)
        love.graphics.setLineWidth(3)
        love.graphics.circle("line", W / 2, H / 2, ringR)
        love.graphics.setLineWidth(1)
    end

    -- Pulsing golden glow behind text
    local pulse = 0.7 + 0.3 * math.sin(love.timer.getTime() * 6)
    love.graphics.setColor(1, 0.85, 0.2, a * pulse * 0.3)
    love.graphics.rectangle("fill", W / 2 - 160, H / 2 - 55, 320, 70, 10, 10)

    -- "LEVEL UP!" text
    love.graphics.setFont(fonts.levelUp)
    -- Shadow
    love.graphics.setColor(0, 0, 0, a * 0.7)
    love.graphics.printf("LEVEL UP!", 2, H / 2 - 48, W, "center")
    -- Golden text
    love.graphics.setColor(1, 0.85, 0.2, a)
    love.graphics.printf("LEVEL UP!", 0, H / 2 - 50, W, "center")

    -- "Level N" below
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(1, 1, 0.7, a * 0.9)
    love.graphics.printf("Level " .. (levelUpEffect.level or "?"), 0, H / 2 + 0, W, "center")
end

-- ================================================================
-- Draw: Card Pack Opening Animation (screen-space overlay)
-- ================================================================
function game.drawPackReveal(W, H)
    if not packReveal then return end

    -- Rarity color lookup
    local RARITY_COLORS = {
        common = {0.53, 0.53, 0.53},
        uncommon = {0.13, 0.8, 0.13},
        rare = {0.2, 0.53, 1},
        ultra_rare = {0.67, 0.27, 1},
        mythic_rare = {1, 0.67, 0},
        legendary = {1, 0.4, 0},
        godly = {1, 0, 0},
        relic = {1, 1, 1},
    }

    -- Dark overlay
    love.graphics.setColor(0, 0, 0, 0.8)
    love.graphics.rectangle("fill", 0, 0, W, H)

    local card = packReveal.cards[packReveal.currentIndex]
    if not card then
        -- All done or no card
        packReveal.done = true
        return
    end

    local cardW = 180
    local cardH = 250
    local cx = W / 2
    local cy = H / 2 - 20

    if packReveal.done then
        -- "Pack Complete!" message
        love.graphics.setFont(fonts.title)
        love.graphics.setColor(1, 0.85, 0.2, 1)
        love.graphics.printf("Pack Complete!", 0, H / 2 - 30, W, "center")
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.7, 0.7, 0.8, 0.8)
        love.graphics.printf("Click to close", 0, H / 2 + 10, W, "center")
        return
    end

    -- Card counter
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.7, 0.7, 0.8, 0.9)
    love.graphics.printf("Card " .. packReveal.currentIndex .. " / " .. #packReveal.cards, 0, cy - cardH / 2 - 40, W, "center")

    if packReveal.phase == "flip" then
        -- Flip animation: scale X from 1 to 0 to 1
        local prog = packReveal.flipProgress or 0
        local scaleX
        if prog < 0.5 then
            -- Shrinking (face-down side)
            scaleX = 1 - prog * 2
        else
            -- Growing (face-up side)
            scaleX = (prog - 0.5) * 2
        end
        scaleX = math.max(0.01, scaleX)

        local drawW = cardW * scaleX
        local drawX = cx - drawW / 2

        if prog < 0.5 then
            -- Face-down: dark rectangle
            love.graphics.setColor(0.15, 0.12, 0.2, 1)
            love.graphics.rectangle("fill", drawX, cy - cardH / 2, drawW, cardH, 6, 6)
            love.graphics.setColor(0.4, 0.3, 0.5, 0.8)
            love.graphics.setLineWidth(2)
            love.graphics.rectangle("line", drawX, cy - cardH / 2, drawW, cardH, 6, 6)
            -- "?" in center
            if drawW > 20 then
                love.graphics.setFont(fonts.title)
                love.graphics.setColor(0.6, 0.5, 0.7, 0.7)
                love.graphics.printf("?", drawX, cy - 12, drawW, "center")
            end
        else
            -- Face-up: show card with rarity border
            local rc = RARITY_COLORS[card.rarity] or {0.5, 0.5, 0.5}
            -- Card bg
            love.graphics.setColor(0.1, 0.1, 0.15, 1)
            love.graphics.rectangle("fill", drawX, cy - cardH / 2, drawW, cardH, 6, 6)
            -- Rarity glow border
            love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
            love.graphics.setLineWidth(3)
            love.graphics.rectangle("line", drawX, cy - cardH / 2, drawW, cardH, 6, 6)

            if drawW > 40 then
                -- Card name
                love.graphics.setFont(fonts.ui)
                love.graphics.setColor(1, 1, 1, 1)
                love.graphics.printf(card.name or "?", drawX + 8, cy - cardH / 2 + 20, drawW - 16, "center")
                -- Rarity
                love.graphics.setFont(fonts.chat)
                love.graphics.setColor(rc[1], rc[2], rc[3], 1)
                local rarityLabel = (card.rarity or "?"):gsub("_", " ")
                rarityLabel = rarityLabel:gsub("(%a)([%w_']*)", function(a2, b) return a2:upper()..b end)
                love.graphics.printf(rarityLabel, drawX + 8, cy - cardH / 2 + 50, drawW - 16, "center")
                -- Type
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
                local typeLabel = (card.type or "?"):gsub("_", " ")
                love.graphics.printf(typeLabel, drawX + 8, cy - cardH / 2 + 75, drawW - 16, "center")
                -- Style
                if card.style and card.style ~= "normal" then
                    love.graphics.setColor(1, 0.85, 0.2, 0.9)
                    love.graphics.printf(card.style, drawX + 8, cy - cardH / 2 + 95, drawW - 16, "center")
                end
            end
        end
    elseif packReveal.phase == "show" then
        -- Fully revealed card
        local rc = RARITY_COLORS[card.rarity] or {0.5, 0.5, 0.5}
        local drawX = cx - cardW / 2
        -- Card bg
        love.graphics.setColor(0.1, 0.1, 0.15, 1)
        love.graphics.rectangle("fill", drawX, cy - cardH / 2, cardW, cardH, 6, 6)
        -- Rarity glow border
        local glowPulse = 0.7 + 0.3 * math.sin(love.timer.getTime() * 4)
        love.graphics.setColor(rc[1], rc[2], rc[3], glowPulse)
        love.graphics.setLineWidth(3)
        love.graphics.rectangle("line", drawX, cy - cardH / 2, cardW, cardH, 6, 6)
        -- Outer glow
        love.graphics.setColor(rc[1], rc[2], rc[3], glowPulse * 0.2)
        love.graphics.setLineWidth(6)
        love.graphics.rectangle("line", drawX - 2, cy - cardH / 2 - 2, cardW + 4, cardH + 4, 8, 8)
        love.graphics.setLineWidth(1)

        -- Card name
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.printf(card.name or "?", drawX + 8, cy - cardH / 2 + 20, cardW - 16, "center")
        -- Rarity
        love.graphics.setFont(fonts.chat)
        love.graphics.setColor(rc[1], rc[2], rc[3], 1)
        local rarityLabel = (card.rarity or "?"):gsub("_", " ")
        rarityLabel = rarityLabel:gsub("(%a)([%w_']*)", function(a2, b) return a2:upper()..b end)
        love.graphics.printf(rarityLabel, drawX + 8, cy - cardH / 2 + 50, cardW - 16, "center")
        -- Type
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
        local typeLabel = (card.type or "?"):gsub("_", " ")
        love.graphics.printf(typeLabel, drawX + 8, cy - cardH / 2 + 75, cardW - 16, "center")
        -- Style
        if card.style and card.style ~= "normal" then
            love.graphics.setColor(1, 0.85, 0.2, 0.9)
            love.graphics.printf(card.style, drawX + 8, cy - cardH / 2 + 95, cardW - 16, "center")
        end

        -- Click hint
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.6, 0.6, 0.7, 0.6)
        love.graphics.printf("Click to continue", 0, cy + cardH / 2 + 15, W, "center")
    end
end

-- ================================================================
-- Draw: Onboarding Tip Banner (screen-space overlay)
-- ================================================================
function game.drawOnboardingTip(W, H)
    if not onboarding.currentTip then return end
    local tip = onboarding.currentTip
    local text = tip.text or ""
    local a = 1
    -- Fade out during last 2 seconds
    if tip.timer < 2.0 then
        a = math.max(0, tip.timer / 2.0)
    end

    -- Semi-transparent dark banner at top center
    love.graphics.setFont(fonts.ui)
    local textW = fonts.ui:getWidth(text) + 40
    local bannerW = math.min(W - 40, math.max(300, textW))
    local bannerH = 36
    local bx = (W - bannerW) / 2
    local by = 50

    love.graphics.setColor(0, 0, 0, 0.7 * a)
    love.graphics.rectangle("fill", bx, by, bannerW, bannerH, 6, 6)
    love.graphics.setColor(0.5, 0.7, 1, 0.5 * a)
    love.graphics.setLineWidth(1)
    love.graphics.rectangle("line", bx, by, bannerW, bannerH, 6, 6)

    love.graphics.setColor(1, 1, 1, 0.95 * a)
    love.graphics.printf(text, bx, by + 8, bannerW, "center")
end

-- ================================================================
-- Draw: Overworld Monster Hit Vignette (screen-space, non-dungeon)
-- ================================================================
function game.drawMonsterHitFlash(W, H)
    if dungeon.inDungeon then return end  -- dungeon handles its own flash
    if not dungeon.hitFlashTimer or dungeon.hitFlashTimer <= 0 then return end
    local a = math.min(1, dungeon.hitFlashTimer / 0.15) * 0.35
    love.graphics.setColor(1, 0, 0, a)
    love.graphics.rectangle("fill", 0, 0, W, H)
end

function game.drawTerrain()
    if not zone or not zone.terrain then return end
    local t = love.timer.getTime()
    local terrain = zone.terrain

    -- Water borders
    if terrain.water then
        for _, side in ipairs(terrain.water) do
            -- Base water color
            love.graphics.setColor(0.15, 0.3, 0.55, 0.85)
            if side == "west" then
                love.graphics.rectangle("fill", 0, 0, TERRAIN_BORDER, zone.height)
                -- Wave edge
                love.graphics.setColor(0.25, 0.45, 0.7, 0.6)
                for wy = 0, zone.height, 8 do
                    local wx = TERRAIN_BORDER + math.sin(t * 2 + wy * 0.05) * 4
                    love.graphics.rectangle("fill", wx - 2, wy, 4, 8)
                end
                -- Foam line
                love.graphics.setColor(0.6, 0.75, 0.9, 0.4)
                for wy = 0, zone.height, 12 do
                    local wx = TERRAIN_BORDER + math.sin(t * 1.5 + wy * 0.07) * 3
                    love.graphics.rectangle("fill", wx - 1, wy, 2, 6)
                end
            elseif side == "east" then
                love.graphics.setColor(0.15, 0.3, 0.55, 0.85)
                love.graphics.rectangle("fill", zone.width - TERRAIN_BORDER, 0, TERRAIN_BORDER, zone.height)
                love.graphics.setColor(0.25, 0.45, 0.7, 0.6)
                for wy = 0, zone.height, 8 do
                    local wx = zone.width - TERRAIN_BORDER + math.sin(t * 2 + wy * 0.05) * 4
                    love.graphics.rectangle("fill", wx - 2, wy, 4, 8)
                end
                love.graphics.setColor(0.6, 0.75, 0.9, 0.4)
                for wy = 0, zone.height, 12 do
                    local wx = zone.width - TERRAIN_BORDER + math.sin(t * 1.5 + wy * 0.07) * 3
                    love.graphics.rectangle("fill", wx - 1, wy, 2, 6)
                end
            elseif side == "south" then
                love.graphics.setColor(0.15, 0.3, 0.55, 0.85)
                love.graphics.rectangle("fill", 0, zone.height - TERRAIN_BORDER, zone.width, TERRAIN_BORDER)
                love.graphics.setColor(0.25, 0.45, 0.7, 0.6)
                for wx = 0, zone.width, 8 do
                    local wy = zone.height - TERRAIN_BORDER + math.sin(t * 2 + wx * 0.05) * 4
                    love.graphics.rectangle("fill", wx, wy - 2, 8, 4)
                end
                love.graphics.setColor(0.6, 0.75, 0.9, 0.4)
                for wx = 0, zone.width, 12 do
                    local wy = zone.height - TERRAIN_BORDER + math.sin(t * 1.5 + wx * 0.07) * 3
                    love.graphics.rectangle("fill", wx, wy - 1, 6, 2)
                end
            end
        end
    end

    -- Mountain border
    if terrain.mountain then
        for _, side in ipairs(terrain.mountain) do
            if side == "north" then
                -- Mountain base
                love.graphics.setColor(0.35, 0.3, 0.25, 0.9)
                love.graphics.rectangle("fill", 0, 0, zone.width, TERRAIN_BORDER)
                -- Peaks
                love.graphics.setColor(0.45, 0.4, 0.35, 0.95)
                for px = 0, zone.width, 40 do
                    local peakH = 20 + math.sin(px * 0.1) * 10
                    love.graphics.polygon("fill",
                        px, TERRAIN_BORDER,
                        px + 20, TERRAIN_BORDER - peakH,
                        px + 40, TERRAIN_BORDER
                    )
                end
                -- Snow caps
                love.graphics.setColor(0.85, 0.85, 0.9, 0.7)
                for px = 0, zone.width, 40 do
                    local peakH = 20 + math.sin(px * 0.1) * 10
                    love.graphics.polygon("fill",
                        px + 12, TERRAIN_BORDER - peakH + 6,
                        px + 20, TERRAIN_BORDER - peakH,
                        px + 28, TERRAIN_BORDER - peakH + 6
                    )
                end
            end
        end
    end
end

-- Helper: render a chunk's static features to a Canvas (called once per chunk)
local function _renderChunkToCanvas(chunk, chunkSize)
    local canvas = love.graphics.newCanvas(chunkSize, chunkSize)
    love.graphics.setCanvas(canvas)
    love.graphics.clear(0, 0, 0, 0)
    love.graphics.origin()

    -- Biome background
    local bc = chunk.biomeColor
    if bc then
        love.graphics.setColor(bc.r / 255, bc.g / 255, bc.b / 255, 0.85)
    else
        love.graphics.setColor(0.1, 0.15, 0.08, 0.85)
    end
    love.graphics.rectangle("fill", 0, 0, chunkSize, chunkSize)

    -- Subtle grid lines
    love.graphics.setColor(1, 1, 1, 0.03)
    for gx = 0, chunkSize - 1, 32 do
        love.graphics.line(gx, 0, gx, chunkSize)
    end
    for gy = 0, chunkSize - 1, 32 do
        love.graphics.line(0, gy, chunkSize, gy)
    end

    -- Draw static features (non-animated: trees, caves, rocks, etc.)
    if chunk.features then
        for ty = 0, 15 do
            for tx = 0, 15 do
                local idx = ty * 16 + tx + 1
                local feat = chunk.features[idx]
                if feat and feat ~= 0 and feat ~= 1 and feat ~= 7 then -- skip animated features (1=river/lava, 7=ocean)
                    local ftx = tx * 32
                    local fty = ty * 32
                    if feat == 4 then
                        -- Dense forest / mushroom
                        if chunk._isHE then
                            love.graphics.setColor(0.25, 0.12, 0.30, 0.85)
                            love.graphics.circle("fill", ftx + 16, fty + 16, 18)
                            love.graphics.setColor(0.15, 0.25, 0.20, 0.7)
                            love.graphics.circle("fill", ftx + 10, fty + 12, 14)
                            love.graphics.circle("fill", ftx + 22, fty + 14, 13)
                            love.graphics.setColor(0.30, 0.15, 0.35, 0.5)
                            love.graphics.circle("fill", ftx + 16, fty + 8, 11)
                        else
                            love.graphics.setColor(0.08, 0.22, 0.08, 0.85)
                            love.graphics.circle("fill", ftx + 16, fty + 16, 18)
                            love.graphics.setColor(0.06, 0.18, 0.06, 0.7)
                            love.graphics.circle("fill", ftx + 10, fty + 12, 14)
                            love.graphics.circle("fill", ftx + 22, fty + 14, 13)
                            love.graphics.setColor(0.1, 0.25, 0.1, 0.5)
                            love.graphics.circle("fill", ftx + 16, fty + 8, 11)
                        end
                    elseif feat == 5 then
                        -- Cave entrance
                        love.graphics.setColor(0.35, 0.3, 0.25, 0.9)
                        love.graphics.rectangle("fill", ftx + 2, fty + 2, 28, 28, 6, 6)
                        love.graphics.setColor(0.05, 0.03, 0.02, 0.95)
                        love.graphics.rectangle("fill", ftx + 6, fty + 8, 20, 20, 4, 4)
                        love.graphics.setColor(0.45, 0.38, 0.3, 0.7)
                        love.graphics.arc("line", "open", ftx + 16, fty + 8, 10, math.pi, 2 * math.pi)
                    elseif feat == 2 then
                        -- Mountain/rock
                        love.graphics.setColor(0.4, 0.35, 0.3, 0.9)
                        love.graphics.polygon("fill", ftx + 16, fty + 2, ftx + 2, fty + 30, ftx + 30, fty + 30)
                        love.graphics.setColor(0.5, 0.45, 0.4, 0.5)
                        love.graphics.polygon("fill", ftx + 16, fty + 2, ftx + 20, fty + 12, ftx + 10, fty + 12)
                    elseif feat == 3 then
                        -- Sand/desert
                        love.graphics.setColor(0.7, 0.65, 0.45, 0.85)
                        love.graphics.rectangle("fill", ftx, fty, 32, 32)
                    elseif feat == 6 then
                        -- Swamp
                        love.graphics.setColor(0.2, 0.3, 0.15, 0.85)
                        love.graphics.rectangle("fill", ftx, fty, 32, 32)
                    end
                end
            end
        end
    end

    love.graphics.setCanvas()
    return canvas
end

function game.drawGround()
    if not zone then return end

    if overworld.chunkBased then
        -- Overworld: draw biome-colored chunks with canvas caching
        local W = love.graphics.getWidth()
        local H = love.graphics.getHeight()
        local camX = camera.x
        local camY = camera.y

        -- Determine visible chunk range
        local startCX = math.floor(camX / overworld.chunkSize) - 1
        local startCY = math.floor(camY / overworld.chunkSize) - 1
        local endCX = math.floor((camX + W) / overworld.chunkSize) + 1
        local endCY = math.floor((camY + H) / overworld.chunkSize) + 1

        for cy = startCY, endCY do
            for cx = startCX, endCX do
                local key = cx .. "," .. cy
                local chunk = overworld.chunks[key]
                local wx = cx * overworld.chunkSize
                local wy = cy * overworld.chunkSize
                if chunk then
                    -- Get or create cached canvas for this chunk
                    local cachedCanvas = overworld.chunkCanvases[key]
                    if not cachedCanvas then
                        chunk._isHE = overworld.isHollowEarth
                        cachedCanvas = _renderChunkToCanvas(chunk, overworld.chunkSize)
                        overworld.chunkCanvases[key] = cachedCanvas
                    end
                    -- Draw cached canvas
                    love.graphics.setColor(1, 1, 1, 1)
                    love.graphics.draw(cachedCanvas, wx, wy)

                    -- Draw animated features on top of cached canvas (rivers, lava, ocean)
                    if chunk.features then
                        for ty = 0, 15 do
                            for tx = 0, 15 do
                                local idx = ty * 16 + tx + 1
                                local feat = chunk.features[idx]
                                if feat == 1 then
                                    local ftx = wx + tx * TILE_SIZE
                                    local fty = wy + ty * TILE_SIZE
                                    if overworld.isHollowEarth then
                                        love.graphics.setColor(0.65, 0.20, 0.05, 0.9)
                                        love.graphics.rectangle("fill", ftx, fty, TILE_SIZE, TILE_SIZE)
                                        love.graphics.setColor(0.85, 0.40, 0.10, 0.3 + math.sin(overworld.riverAnimTimer * 2 + ftx * 0.1) * 0.15)
                                        love.graphics.rectangle("fill", ftx + 4, fty + 4, TILE_SIZE - 8, TILE_SIZE - 8)
                                    else
                                        love.graphics.setColor(0.16, 0.31, 0.63, 0.9)
                                        love.graphics.rectangle("fill", ftx, fty, TILE_SIZE, TILE_SIZE)
                                        love.graphics.setColor(0.25, 0.45, 0.75, 0.3)
                                        local flowOff = (overworld.riverAnimTimer * 40) % TILE_SIZE
                                        love.graphics.line(ftx + 8, fty + flowOff - TILE_SIZE, ftx + 8, fty + flowOff)
                                        love.graphics.line(ftx + 24, fty + flowOff - TILE_SIZE + 16, ftx + 24, fty + flowOff + 16)
                                    end
                                elseif feat == 7 then
                                    local ftx = wx + tx * TILE_SIZE
                                    local fty = wy + ty * TILE_SIZE
                                    love.graphics.setColor(0.55, 0.39, 0.22, 0.95)
                                    love.graphics.rectangle("fill", ftx, fty, TILE_SIZE, TILE_SIZE)
                                    love.graphics.setColor(0.45, 0.30, 0.15, 0.4)
                                    for px = 0, TILE_SIZE - 1, 6 do
                                        love.graphics.line(ftx + px, fty, ftx + px, fty + TILE_SIZE)
                                    end
                                    love.graphics.setColor(0.65, 0.50, 0.30, 0.3)
                                    love.graphics.line(ftx, fty, ftx + TILE_SIZE, fty)
                                    love.graphics.line(ftx, fty + TILE_SIZE - 1, ftx + TILE_SIZE, fty + TILE_SIZE - 1)
                                end
                            end
                        end
                    end

                    -- Chunk border (very subtle)
                    love.graphics.setColor(0, 0, 0, 0.08)
                    love.graphics.rectangle("line", wx, wy, overworld.chunkSize, overworld.chunkSize)

                    -- Lich Corruption overlay: purple tint on corrupted chunks
                    local cLevel = corruption.chunks[key]
                    if cLevel and cLevel > 0 then
                        local cAlpha = (cLevel / 100) * 0.35
                        local cPulse = math.sin(corruption.animTimer * 1.5 + cx * 0.3 + cy * 0.7) * 0.05
                        love.graphics.setColor(0.3, 0.05, 0.4, cAlpha + cPulse)
                        love.graphics.rectangle("fill", wx, wy, overworld.chunkSize, overworld.chunkSize)
                        -- Veiny tendrils at high corruption
                        if cLevel >= 50 then
                            love.graphics.setColor(0.5, 0.1, 0.6, (cLevel / 100) * 0.2)
                            local cs = overworld.chunkSize
                            for ti = 0, 3 do
                                local tx1 = wx + math.sin(corruption.animTimer * 0.5 + ti * 2.1) * cs * 0.3 + cs * 0.5
                                local ty1 = wy + math.cos(corruption.animTimer * 0.7 + ti * 1.7) * cs * 0.3 + cs * 0.5
                                local tx2 = wx + math.sin(corruption.animTimer * 0.3 + ti * 3.2) * cs * 0.4 + cs * 0.5
                                local ty2 = wy + math.cos(corruption.animTimer * 0.4 + ti * 2.3) * cs * 0.4 + cs * 0.5
                                love.graphics.setLineWidth(2)
                                love.graphics.line(tx1, ty1, tx2, ty2)
                                love.graphics.setLineWidth(1)
                            end
                        end
                    end
                else
                    -- Unloaded chunk: use nearby chunk's biome color or zone bg
                    local nearColor = nil
                    -- Try to sample color from an adjacent loaded chunk
                    for _, offset in ipairs({{1,0},{-1,0},{0,1},{0,-1}}) do
                        local nk = (cx + offset[1]) .. "," .. (cy + offset[2])
                        local nc = overworld.chunks[nk]
                        if nc and nc.biomeColor then
                            nearColor = nc.biomeColor
                            break
                        end
                    end
                    if nearColor then
                        love.graphics.setColor(nearColor.r / 255, nearColor.g / 255, nearColor.b / 255, 0.85)
                    else
                        love.graphics.setColor(0.28, 0.35, 0.22, 0.85)
                    end
                    love.graphics.rectangle("fill", wx, wy, overworld.chunkSize, overworld.chunkSize)
                end
            end
        end
    else
        -- Non-overworld: simple grid
        love.graphics.setColor(1, 1, 1, 0.04)
        for gx = 0, zone.width, TILE_SIZE do
            love.graphics.line(gx, 0, gx, zone.height)
        end
        for gy = 0, zone.height, TILE_SIZE do
            love.graphics.line(0, gy, zone.width, gy)
        end

        -- Zone border
        love.graphics.setColor(0.4, 0.4, 0.5, 0.3)
        love.graphics.setLineWidth(2)
        love.graphics.rectangle("line", 0, 0, zone.width, zone.height)
        love.graphics.setLineWidth(1)

        -- Zone name at top
        love.graphics.setFont(fonts.title)
        love.graphics.setColor(1, 1, 1, 0.15)
        love.graphics.printf(zone.name, 0, TERRAIN_BORDER + 10, zone.width, "center")
    end
end

function game.drawPlots()
    if not overworld.chunkBased then return end
    local t = love.timer.getTime()
    local accKey = account and account.key or nil

    for _, plot in pairs(overworld.plots) do
        local isOwn = (overworld.myPlotId and plot.id == overworld.myPlotId)
        local px, py = plot.x, plot.y
        local pw, ph = plot.width or 512, plot.height or 512

        -- Fill
        if isOwn then
            love.graphics.setColor(0.2, 0.6, 0.2, 0.08 + math.sin(t * 2) * 0.02)
        else
            love.graphics.setColor(0.2, 0.3, 0.6, 0.06)
        end
        love.graphics.rectangle("fill", px, py, pw, ph)

        -- Border
        love.graphics.setLineWidth(2)
        if isOwn then
            love.graphics.setColor(0.3, 0.9, 0.3, 0.5 + math.sin(t * 3) * 0.15)
        else
            love.graphics.setColor(0.3, 0.5, 0.9, 0.35)
        end
        love.graphics.rectangle("line", px, py, pw, ph)
        love.graphics.setLineWidth(1)

        -- Corner markers
        local cornerSize = 12
        if isOwn then
            love.graphics.setColor(0.3, 0.9, 0.3, 0.7)
        else
            love.graphics.setColor(0.3, 0.5, 0.9, 0.5)
        end
        -- Top-left
        love.graphics.line(px, py, px + cornerSize, py)
        love.graphics.line(px, py, px, py + cornerSize)
        -- Top-right
        love.graphics.line(px + pw, py, px + pw - cornerSize, py)
        love.graphics.line(px + pw, py, px + pw, py + cornerSize)
        -- Bottom-left
        love.graphics.line(px, py + ph, px + cornerSize, py + ph)
        love.graphics.line(px, py + ph, px, py + ph - cornerSize)
        -- Bottom-right
        love.graphics.line(px + pw, py + ph, px + pw - cornerSize, py + ph)
        love.graphics.line(px + pw, py + ph, px + pw, py + ph - cornerSize)

        -- Owner name label at top center
        love.graphics.setFont(fonts.npc)
        if isOwn then
            love.graphics.setColor(0.3, 0.9, 0.3, 0.8)
        else
            love.graphics.setColor(0.5, 0.7, 1, 0.6)
        end
        love.graphics.printf(plot.ownerName or "???", px, py + 4, pw, "center")
    end
end

function game.drawResources()
    local t = love.timer.getTime()

    -- Build resource list: from zone resources + loaded chunk resources
    local allResources = {}
    if resources then
        for _, r in ipairs(resources) do
            table.insert(allResources, r)
        end
    end
    if overworld.chunkBased then
        -- Add resources from visible chunks
        local W = love.graphics.getWidth()
        local H = love.graphics.getHeight()
        local camX = camera.x
        local camY = camera.y
        local startCX = math.floor(camX / overworld.chunkSize) - 1
        local startCY = math.floor(camY / overworld.chunkSize) - 1
        local endCX = math.floor((camX + W) / overworld.chunkSize) + 1
        local endCY = math.floor((camY + H) / overworld.chunkSize) + 1
        for cy = startCY, endCY do
            for cx = startCX, endCX do
                local key = cx .. "," .. cy
                local chunk = overworld.chunks[key]
                if chunk and chunk.resources then
                    for _, r in ipairs(chunk.resources) do
                        table.insert(allResources, r)
                    end
                end
            end
        end
    end

    -- Spatial culling bounds
    local cullM = 64
    local cLeft = camera.x - cullM
    local cRight = camera.x + love.graphics.getWidth() + cullM
    local cTop = camera.y - cullM
    local cBottom = camera.y + love.graphics.getHeight() + cullM

    for _, r in ipairs(allResources) do
        -- Skip offscreen resources
        if r.x < cLeft or r.x > cRight or r.y < cTop or r.y > cBottom then
            goto continue_resource
        end
        local alpha = 1.0
        if r.depleted then alpha = 0.2 end

        if r.type == "tree" then
            -- Trunk
            love.graphics.setColor(0.45, 0.3, 0.15, alpha)
            love.graphics.rectangle("fill", r.x - 4, r.y - 5, 8, 20, 2, 2)
            -- Leaves (green circle)
            love.graphics.setColor(0.2, 0.6, 0.2, alpha)
            love.graphics.circle("fill", r.x, r.y - 15, 16)
            -- Leaf highlight
            love.graphics.setColor(0.3, 0.7, 0.3, alpha * 0.6)
            love.graphics.circle("fill", r.x - 4, r.y - 18, 8)
            -- Gentle sway
            local sway = math.sin(t * 1.5 + r.x * 0.1) * 2
            love.graphics.setColor(0.25, 0.65, 0.25, alpha * 0.5)
            love.graphics.circle("fill", r.x + sway, r.y - 20, 6)

        elseif r.type == "stone" then
            -- Main rock body
            love.graphics.setColor(0.5, 0.5, 0.48, alpha)
            love.graphics.circle("fill", r.x, r.y, 14)
            -- Darker cracks
            love.graphics.setColor(0.35, 0.35, 0.33, alpha * 0.7)
            love.graphics.line(r.x - 6, r.y - 3, r.x + 2, r.y + 5)
            love.graphics.line(r.x + 3, r.y - 7, r.x - 1, r.y + 2)
            -- Highlight
            love.graphics.setColor(0.6, 0.6, 0.58, alpha * 0.5)
            love.graphics.circle("fill", r.x - 3, r.y - 5, 5)

        elseif r.type == "iron" then
            -- Rock body (darker)
            love.graphics.setColor(0.4, 0.38, 0.35, alpha)
            love.graphics.circle("fill", r.x, r.y, 14)
            -- Orange-rust ore flecks
            love.graphics.setColor(0.7, 0.45, 0.2, alpha * 0.8)
            love.graphics.circle("fill", r.x - 5, r.y - 3, 3)
            love.graphics.circle("fill", r.x + 4, r.y + 2, 2.5)
            love.graphics.circle("fill", r.x + 1, r.y - 6, 2)
            -- Metallic glint
            love.graphics.setColor(0.8, 0.55, 0.3, alpha * (0.3 + math.sin(t * 3 + r.x) * 0.2))
            love.graphics.circle("fill", r.x - 2, r.y - 4, 2)
        end

        -- Label
        love.graphics.setFont(fonts.npc)
        if r.depleted then
            love.graphics.setColor(0.5, 0.5, 0.5, 0.4)
            love.graphics.printf("(respawning)", r.x - 40, r.y + 18, 80, "center")
        else
            love.graphics.setColor(0.9, 0.9, 0.8, 0.6)
            love.graphics.printf(r.name, r.x - 40, r.y + 18, 80, "center")
        end

        -- Hover highlight
        if hoverResource and hoverResource.id == r.id and not r.depleted then
            love.graphics.setColor(1, 1, 0.5, 0.2 + math.sin(t * 4) * 0.1)
            love.graphics.setLineWidth(2)
            love.graphics.circle("line", r.x, r.y, 22)
            love.graphics.setLineWidth(1)
        end
        ::continue_resource::
    end
end

function game.drawPlacedObjects()
    if not placedObjects then return end
    for _, obj in ipairs(placedObjects) do
        if obj.type == "forge" then
            -- Forge: dark red/orange brick shape
            love.graphics.setColor(0.5, 0.2, 0.1, 0.9)
            love.graphics.rectangle("fill", obj.x - 16, obj.y - 12, 32, 24, 3, 3)
            love.graphics.setColor(0.8, 0.4, 0.1, 0.8)
            love.graphics.rectangle("fill", obj.x - 8, obj.y - 8, 16, 12, 2, 2)
            -- Fire glow
            local t = love.timer.getTime()
            love.graphics.setColor(1, 0.5, 0.1, 0.4 + math.sin(t * 5) * 0.2)
            love.graphics.circle("fill", obj.x, obj.y - 4, 6)
        elseif obj.type == "iron_anvil" then
            -- Anvil: dark gray T-shape
            love.graphics.setColor(0.35, 0.35, 0.4, 0.9)
            love.graphics.rectangle("fill", obj.x - 14, obj.y - 6, 28, 12, 2, 2)
            love.graphics.rectangle("fill", obj.x - 6, obj.y - 14, 12, 8, 2, 2)
        elseif obj.type == "storage_chest" then
            -- Chest: brown box
            love.graphics.setColor(0.45, 0.3, 0.15, 0.9)
            love.graphics.rectangle("fill", obj.x - 12, obj.y - 8, 24, 16, 3, 3)
            love.graphics.setColor(0.6, 0.4, 0.2, 0.7)
            love.graphics.rectangle("fill", obj.x - 10, obj.y - 6, 20, 4, 2, 2)
            -- Lock indicator
            if obj.lockId then
                love.graphics.setColor(0.8, 0.7, 0.2, 0.9)
                love.graphics.circle("fill", obj.x, obj.y + 2, 3)
            end
        elseif obj.type == "wall" then
            love.graphics.setColor(0.45, 0.35, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 16, obj.y - 16, 32, 32, 2, 2)
            love.graphics.setColor(0.35, 0.25, 0.15, 0.7)
            love.graphics.line(obj.x - 16, obj.y, obj.x + 16, obj.y)
            love.graphics.line(obj.x, obj.y - 16, obj.x, obj.y + 16)
        elseif obj.type == "door" then
            love.graphics.setColor(0.5, 0.35, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 10, obj.y - 16, 20, 32, 2, 2)
            love.graphics.setColor(0.7, 0.5, 0.2, 0.8)
            love.graphics.circle("fill", obj.x + 5, obj.y, 2)
        elseif obj.type == "raft" then
            love.graphics.setColor(0.5, 0.35, 0.2, 0.85)
            love.graphics.rectangle("fill", obj.x - 20, obj.y - 12, 40, 24, 4, 4)
            love.graphics.setColor(0.4, 0.25, 0.15, 0.6)
            for lx = -16, 16, 8 do
                love.graphics.line(obj.x + lx, obj.y - 12, obj.x + lx, obj.y + 12)
            end
        elseif obj.type == "bridge" then
            -- Wider wooden platform with plank lines and rail edges
            love.graphics.setColor(0.55, 0.39, 0.22, 0.9)
            love.graphics.rectangle("fill", obj.x - 28, obj.y - 16, 56, 32, 3, 3)
            -- Plank lines
            love.graphics.setColor(0.45, 0.30, 0.15, 0.5)
            for lx = -24, 24, 7 do
                love.graphics.line(obj.x + lx, obj.y - 16, obj.x + lx, obj.y + 16)
            end
            -- Rail edges
            love.graphics.setColor(0.65, 0.50, 0.30, 0.7)
            love.graphics.rectangle("fill", obj.x - 28, obj.y - 16, 56, 3, 1, 1)
            love.graphics.rectangle("fill", obj.x - 28, obj.y + 13, 56, 3, 1, 1)
        elseif obj.type == "stone_wall" then
            love.graphics.setColor(0.5, 0.5, 0.5, 0.9)
            love.graphics.rectangle("fill", obj.x - 16, obj.y - 16, 32, 32, 2, 2)
            love.graphics.setColor(0.4, 0.4, 0.4, 0.6)
            love.graphics.line(obj.x - 16, obj.y - 5, obj.x + 16, obj.y - 5)
            love.graphics.line(obj.x - 16, obj.y + 5, obj.x + 16, obj.y + 5)
        elseif obj.type == "fence" or obj.type == "stone_fence" or obj.type == "iron_fence" then
            local c = obj.type == "fence" and {0.5, 0.35, 0.2} or obj.type == "stone_fence" and {0.5, 0.5, 0.5} or {0.4, 0.4, 0.5}
            love.graphics.setColor(c[1], c[2], c[3], 0.9)
            love.graphics.rectangle("fill", obj.x - 16, obj.y - 2, 32, 4, 1, 1)
            love.graphics.rectangle("fill", obj.x - 12, obj.y - 10, 3, 12)
            love.graphics.rectangle("fill", obj.x + 9, obj.y - 10, 3, 12)
        elseif obj.type == "crop_plot" or obj.type == "garden_bed" then
            -- Brown soil
            love.graphics.setColor(0.35, 0.25, 0.1, 0.9)
            love.graphics.rectangle("fill", obj.x - 20, obj.y - 20, 40, 40, 2, 2)
            -- Furrows
            love.graphics.setColor(0.3, 0.2, 0.08, 0.7)
            for fy = -16, 16, 8 do
                love.graphics.line(obj.x - 18, obj.y + fy, obj.x + 18, obj.y + fy)
            end
            -- Crop growth stages
            if obj.crop and obj.crop.stage then
                local stage = obj.crop.stage
                if stage == 0 then -- seed
                    love.graphics.setColor(0.5, 0.4, 0.2, 0.6)
                    love.graphics.circle("fill", obj.x, obj.y, 3)
                elseif stage == 1 then -- sprout
                    love.graphics.setColor(0.3, 0.7, 0.2, 0.8)
                    love.graphics.rectangle("fill", obj.x - 1, obj.y - 6, 2, 6)
                    love.graphics.circle("fill", obj.x, obj.y - 7, 3)
                elseif stage == 2 then -- growing
                    love.graphics.setColor(0.2, 0.7, 0.2, 0.9)
                    love.graphics.rectangle("fill", obj.x - 2, obj.y - 10, 4, 10)
                    love.graphics.circle("fill", obj.x, obj.y - 11, 5)
                    love.graphics.circle("fill", obj.x - 4, obj.y - 8, 3)
                    love.graphics.circle("fill", obj.x + 4, obj.y - 8, 3)
                elseif stage == 3 then -- mature
                    love.graphics.setColor(0.8, 0.7, 0.1, 0.9)
                    love.graphics.rectangle("fill", obj.x - 2, obj.y - 14, 4, 14)
                    love.graphics.circle("fill", obj.x, obj.y - 15, 6)
                    love.graphics.setColor(0.2, 0.6, 0.2, 0.8)
                    love.graphics.circle("fill", obj.x - 5, obj.y - 10, 4)
                    love.graphics.circle("fill", obj.x + 5, obj.y - 10, 4)
                elseif stage == 4 then -- withered
                    love.graphics.setColor(0.4, 0.3, 0.15, 0.6)
                    love.graphics.rectangle("fill", obj.x - 1, obj.y - 8, 2, 8)
                    love.graphics.setColor(0.5, 0.4, 0.2, 0.4)
                    love.graphics.circle("fill", obj.x, obj.y - 9, 4)
                end
            end
        elseif obj.type == "animal_pen" then
            love.graphics.setColor(0.5, 0.35, 0.2, 0.8)
            love.graphics.rectangle("line", obj.x - 24, obj.y - 24, 48, 48, 3, 3)
            love.graphics.rectangle("line", obj.x - 22, obj.y - 22, 44, 44, 2, 2)
            -- Gate
            love.graphics.setColor(0.6, 0.4, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 6, obj.y + 22, 12, 4)
        elseif obj.type == "well" then
            love.graphics.setColor(0.5, 0.5, 0.55, 0.9)
            love.graphics.circle("fill", obj.x, obj.y, 14)
            love.graphics.setColor(0.2, 0.4, 0.8, 0.7)
            love.graphics.circle("fill", obj.x, obj.y, 8)
        elseif obj.type == "scarecrow" then
            love.graphics.setColor(0.5, 0.35, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 1, obj.y - 16, 2, 24)
            love.graphics.rectangle("fill", obj.x - 10, obj.y - 10, 20, 2)
            love.graphics.setColor(0.7, 0.6, 0.3, 0.8)
            love.graphics.circle("fill", obj.x, obj.y - 18, 5)
        elseif obj.type == "sprinkler" then
            love.graphics.setColor(0.4, 0.4, 0.5, 0.9)
            love.graphics.circle("fill", obj.x, obj.y, 6)
            local t = love.timer.getTime()
            love.graphics.setColor(0.3, 0.6, 0.9, 0.3 + math.sin(t * 3) * 0.2)
            love.graphics.circle("line", obj.x, obj.y, 10 + math.sin(t * 2) * 3)
        elseif obj.type == "lantern" then
            love.graphics.setColor(0.6, 0.5, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 4, obj.y - 8, 8, 12, 2, 2)
            local t = love.timer.getTime()
            love.graphics.setColor(1, 0.8, 0.3, 0.4 + math.sin(t * 4) * 0.2)
            love.graphics.circle("fill", obj.x, obj.y - 4, 4)
        elseif obj.type == "clock" then
            love.graphics.setColor(0.5, 0.35, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 8, obj.y - 10, 16, 20, 3, 3)
            love.graphics.setColor(0.9, 0.85, 0.7, 0.8)
            love.graphics.circle("fill", obj.x, obj.y - 3, 5)
        elseif obj.type == "trophy_mount" then
            love.graphics.setColor(0.5, 0.35, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 10, obj.y - 6, 20, 12, 2, 2)
            love.graphics.setColor(0.7, 0.6, 0.4, 0.8)
            love.graphics.polygon("fill", obj.x, obj.y - 10, obj.x - 6, obj.y - 2, obj.x + 6, obj.y - 2)
        elseif obj.type == "bed" then
            love.graphics.setColor(0.5, 0.35, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 10, obj.y - 14, 20, 28, 3, 3)
            love.graphics.setColor(0.7, 0.5, 0.5, 0.8)
            love.graphics.rectangle("fill", obj.x - 8, obj.y - 12, 16, 10, 2, 2)
        elseif obj.type == "bookshelf" then
            love.graphics.setColor(0.45, 0.3, 0.15, 0.9)
            love.graphics.rectangle("fill", obj.x - 12, obj.y - 10, 24, 20, 2, 2)
            love.graphics.setColor(0.6, 0.2, 0.1, 0.7)
            love.graphics.rectangle("fill", obj.x - 10, obj.y - 8, 5, 6)
            love.graphics.setColor(0.2, 0.4, 0.6, 0.7)
            love.graphics.rectangle("fill", obj.x - 4, obj.y - 8, 5, 6)
            love.graphics.setColor(0.5, 0.5, 0.2, 0.7)
            love.graphics.rectangle("fill", obj.x + 2, obj.y - 8, 5, 6)
        else
            -- Generic fallback for unrecognized types
            love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
            love.graphics.rectangle("fill", obj.x - 12, obj.y - 12, 24, 24, 3, 3)
            love.graphics.setColor(0.7, 0.7, 0.7, 0.5)
            love.graphics.rectangle("line", obj.x - 12, obj.y - 12, 24, 24, 3, 3)
        end

        -- Label
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(0.8, 0.8, 0.7, 0.5)
        local label = obj.type:gsub("_", " ")
        love.graphics.printf(label, obj.x - 40, obj.y + 18, 80, "center")

        -- Hover highlight
        if hoverObject and hoverObject.id == obj.id then
            love.graphics.setColor(0.5, 1, 0.5, 0.2 + math.sin(love.timer.getTime() * 4) * 0.1)
            love.graphics.setLineWidth(2)
            love.graphics.circle("line", obj.x, obj.y, 24)
            love.graphics.setLineWidth(1)
        end
    end
end

function game.drawFloatingTexts()
    love.graphics.setFont(fonts.ui)
    for _, ft in ipairs(floatingTexts) do
        local a = math.min(1, ft.timer / 0.5)  -- fade out in last 0.5s
        love.graphics.setColor(ft.color[1], ft.color[2], ft.color[3], a * fadeIn)
        love.graphics.printf(ft.text, ft.x - 80, ft.y, 160, "center")
    end
end

-- ---------------------------------------------------------------------------
-- Mini-Rift overworld rendering: animated void portals
-- ---------------------------------------------------------------------------
function game.drawMiniRifts()
    if not overworld.chunkBased then return end
    local t = love.timer.getTime()
    local math_sin = math.sin
    local math_cos = math.cos
    local math_pi = math.pi

    -- Spatial culling bounds
    local cullM = 120
    local cLeft = camera.x - cullM
    local cRight = camera.x + love.graphics.getWidth() + cullM
    local cTop = camera.y - cullM
    local cBottom = camera.y + love.graphics.getHeight() + cullM

    -- Difficulty color lookup
    local DIFF_COLORS = {
        easy    = {0.2, 0.9, 0.3},
        medium  = {1.0, 0.9, 0.2},
        hard    = {1.0, 0.55, 0.1},
        extreme = {1.0, 0.15, 0.15},
    }

    for _, rift in pairs(miniRifts) do
        local wx = rift.worldX or 0
        local wy = rift.worldY or 0

        -- Skip offscreen rifts
        if wx < cLeft or wx > cRight or wy < cTop or wy > cBottom then
            goto continue_rift
        end

        local cleared = rift.cleared
        local baseAlpha = cleared and 0.3 or 1.0

        -- Base radius scales with tier
        local tier = rift.tier or 1
        local baseR = 18 + tier * 6  -- tier 1=24, tier 2=30, tier 3=36, tier 4=42, tier 5=48

        -- Pulsing animation (outer glow)
        local pulse = math_sin(t * 2.5 + wx * 0.013 + wy * 0.017) * 0.15
        local glowR = baseR * (1.4 + pulse)

        -- Outer purple glow (pulsing)
        love.graphics.setColor(0.45, 0.1, 0.7, (0.25 + pulse * 0.5) * baseAlpha * fadeIn)
        love.graphics.circle("fill", wx, wy, glowR)

        -- Secondary glow ring
        love.graphics.setColor(0.6, 0.2, 0.9, (0.15 + pulse * 0.3) * baseAlpha * fadeIn)
        love.graphics.setLineWidth(2)
        love.graphics.circle("line", wx, wy, glowR)
        love.graphics.setLineWidth(1)

        -- Swirling inner void (dark purple/black rotating)
        local innerR = baseR * 0.95
        local swirl1 = t * 1.8 + wx * 0.007
        local swirl2 = t * 1.8 + wx * 0.007 + math_pi
        -- Two swirling arcs
        love.graphics.setColor(0.2, 0.02, 0.35, 0.8 * baseAlpha * fadeIn)
        love.graphics.arc("fill", "pie", wx, wy, innerR, swirl1, swirl1 + math_pi * 0.7)
        love.graphics.setColor(0.1, 0.0, 0.2, 0.9 * baseAlpha * fadeIn)
        love.graphics.arc("fill", "pie", wx, wy, innerR, swirl2, swirl2 + math_pi * 0.7)

        -- Main void body
        love.graphics.setColor(0.08, 0.0, 0.12, 0.9 * baseAlpha * fadeIn)
        love.graphics.circle("fill", wx, wy, innerR * 0.85)

        -- Dark core
        love.graphics.setColor(0.02, 0.0, 0.04, 0.95 * baseAlpha * fadeIn)
        love.graphics.circle("fill", wx, wy, innerR * 0.55)

        -- Sickly green center pulse (Atlas radiation)
        local greenPulse = 0.4 + math_sin(t * 4.5 + wy * 0.02) * 0.35
        love.graphics.setColor(0.3, 0.9, 0.2, greenPulse * 0.6 * baseAlpha * fadeIn)
        love.graphics.circle("fill", wx, wy, innerR * 0.25)
        love.graphics.setColor(0.5, 1, 0.3, greenPulse * 0.3 * baseAlpha * fadeIn)
        love.graphics.circle("fill", wx, wy, innerR * 0.15)

        -- Orbiting void particles (6 particles)
        for pi = 0, 5 do
            local angle = t * (1.2 + pi * 0.15) + pi * (math_pi * 2 / 6)
            local orbitR = baseR * (1.1 + math_sin(t * 2 + pi) * 0.15)
            local px = wx + math_cos(angle) * orbitR
            local py = wy + math_sin(angle) * orbitR
            local pAlpha = 0.5 + math_sin(t * 3 + pi * 1.5) * 0.3
            love.graphics.setColor(0.5, 0.15, 0.8, pAlpha * baseAlpha * fadeIn)
            love.graphics.circle("fill", px, py, 2 + math_sin(t * 4 + pi) * 0.8)
        end

        -- Outer edge shimmer ring
        love.graphics.setColor(0.7, 0.3, 1, (0.3 + pulse * 0.4) * baseAlpha * fadeIn)
        love.graphics.setLineWidth(1.5)
        love.graphics.circle("line", wx, wy, baseR)
        love.graphics.setLineWidth(1)

        -- Corruption radius indicator (subtle ground stain)
        local cRadius = rift.corruptionRadius or 0
        if cRadius > 0 and not cleared then
            local cPulse = math_sin(t * 0.8 + wx * 0.005) * 0.03
            love.graphics.setColor(0.25, 0.05, 0.35, (0.06 + cPulse) * fadeIn)
            love.graphics.circle("fill", wx, wy, cRadius)
            love.graphics.setColor(0.35, 0.08, 0.5, (0.08 + cPulse) * fadeIn)
            love.graphics.setLineWidth(1)
            love.graphics.circle("line", wx, wy, cRadius)
        end

        -- Name label above rift
        if not cleared then
            love.graphics.setFont(fonts.npc)
            local diffKey = rift.difficulty or "medium"
            local dc = DIFF_COLORS[diffKey] or DIFF_COLORS.medium
            love.graphics.setColor(dc[1], dc[2], dc[3], 0.9 * fadeIn)
            local name = rift.name or "Rift"
            local nameW = (fonts.npc):getWidth(name)
            love.graphics.print(name, wx - nameW / 2, wy - baseR - 22)

            -- Tier + floor count below name
            local info = "Tier " .. tier .. " [" .. (rift.totalFloors or "?") .. " floors]"
            local infoW = (fonts.npc):getWidth(info)
            love.graphics.setColor(dc[1], dc[2], dc[3], 0.65 * fadeIn)
            love.graphics.print(info, wx - infoW / 2, wy - baseR - 10)

            -- Player count indicator (if anyone is inside)
            local pc = rift.playerCount or 0
            if pc > 0 then
                local pcText = pc .. " inside"
                local pcW = (fonts.npc):getWidth(pcText)
                love.graphics.setColor(0.8, 0.8, 1, 0.6 * fadeIn)
                love.graphics.print(pcText, wx - pcW / 2, wy + baseR + 4)
            end
        else
            -- Cleared rift: dim label
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.5, 0.5, 0.5, 0.5 * fadeIn)
            local sealedText = (rift.name or "Rift") .. " (Sealed)"
            local sw = (fonts.npc):getWidth(sealedText)
            love.graphics.print(sealedText, wx - sw / 2, wy - baseR - 16)
        end

        ::continue_rift::
    end

    -- Rift destruction VFX: white flash implosion
    for _, vfx in ipairs(riftDestroyVfx) do
        local progress = 1 - (vfx.timer / vfx.maxTimer)
        local wx = vfx.worldX
        local wy = vfx.worldY

        if progress < 0.3 then
            -- Phase 1: expanding bright flash
            local p = progress / 0.3
            local flashR = 60 * p
            love.graphics.setColor(1, 1, 1, (1 - p * 0.5) * fadeIn)
            love.graphics.circle("fill", wx, wy, flashR)
            love.graphics.setColor(0.7, 0.4, 1, (0.8 - p * 0.3) * fadeIn)
            love.graphics.circle("fill", wx, wy, flashR * 0.6)
        elseif progress < 0.7 then
            -- Phase 2: implosion (shrinking ring)
            local p = (progress - 0.3) / 0.4
            local ringR = 60 * (1 - p)
            love.graphics.setColor(0.9, 0.8, 1, (1 - p) * 0.7 * fadeIn)
            love.graphics.setLineWidth(3 - p * 2)
            love.graphics.circle("line", wx, wy, ringR)
            love.graphics.setLineWidth(1)
            love.graphics.setColor(0.5, 0.2, 0.8, (1 - p) * 0.5 * fadeIn)
            love.graphics.circle("fill", wx, wy, ringR * 0.3)
        else
            -- Phase 3: fading spark
            local p = (progress - 0.7) / 0.3
            love.graphics.setColor(0.8, 0.6, 1, (1 - p) * 0.4 * fadeIn)
            love.graphics.circle("fill", wx, wy, 4 * (1 - p))
        end
    end
end

-- ---------------------------------------------------------------------------
-- Leviathan overworld rendering: large pulsing circles at positions
-- ---------------------------------------------------------------------------
function game.drawLeviathans()
    if not overworld.leviathans then return end
    local t = love.timer.getTime()

    for _, lev in ipairs(overworld.leviathans) do
        local wx = lev.worldX or 0
        local wy = lev.worldY or 0

        -- Size based on tier
        local baseSize = 256
        if lev.tier == "massive" then baseSize = 512
        elseif lev.tier == "colossal" then baseSize = 768 end

        -- Pulsing animation
        local pulse = 1 + math.sin(t * 2 + wx * 0.01) * 0.08
        local size = baseSize * pulse

        -- Dark silhouette core
        love.graphics.setColor(0.05, 0.08, 0.15, 0.6 * fadeIn)
        love.graphics.circle("fill", wx, wy, size * 0.5)

        -- Danger pulse ring
        local ringPulse = 0.3 + math.sin(t * 3 + wy * 0.01) * 0.2
        love.graphics.setColor(0.8, 0.1, 0.1, ringPulse * fadeIn)
        love.graphics.setLineWidth(3)
        love.graphics.circle("line", wx, wy, size * 0.55)
        love.graphics.setLineWidth(1)

        -- Outer haze
        love.graphics.setColor(0.1, 0.15, 0.3, 0.15 * fadeIn)
        love.graphics.circle("fill", wx, wy, size * 0.7)

        -- Name label
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(1, 0.2, 0.2, 0.9 * fadeIn)
        local name = lev.name or "Leviathan"
        local tw = fonts.ui:getWidth(name)
        love.graphics.print(name, wx - tw / 2, wy - size * 0.55 - 20)
    end
end

-- ---------------------------------------------------------------------------
-- Leviathan HUD: warning/aggro banners + multi-part HP bars
-- ---------------------------------------------------------------------------
function game.drawLeviathanHUD(W, H)
    -- Warning banner (amber, center-top)
    if overworld.leviathanWarning and overworld.leviathanWarningTimer > 0 then
        local warn = overworld.leviathanWarning
        local alpha = math.min(1, overworld.leviathanWarningTimer / 0.5)
        local bannerW = 500
        local bannerH = 50
        local bx = (W - bannerW) / 2
        local by = 60

        -- Background
        love.graphics.setColor(0.15, 0.1, 0, 0.85 * alpha * fadeIn)
        love.graphics.rectangle("fill", bx, by, bannerW, bannerH, 8, 8)
        love.graphics.setColor(1, 0.7, 0, 0.9 * alpha * fadeIn)
        love.graphics.setLineWidth(2)
        love.graphics.rectangle("line", bx, by, bannerW, bannerH, 8, 8)
        love.graphics.setLineWidth(1)

        -- Text
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(1, 0.85, 0.3, alpha * fadeIn)
        love.graphics.printf(warn.message or "Leviathan nearby!", bx + 10, by + 8, bannerW - 20, "center")

        -- Tier label
        love.graphics.setColor(1, 0.6, 0.2, 0.8 * alpha * fadeIn)
        love.graphics.printf("[" .. (warn.tier or "?") .. "]", bx + 10, by + 28, bannerW - 20, "center")
    end

    -- Aggro banner (red, center-top, with countdown + flee prompt)
    if overworld.leviathanAggro and overworld.leviathanAggroTimer > 0 then
        local aggro = overworld.leviathanAggro
        local alpha = math.min(1, overworld.leviathanAggroTimer)
        local bannerW = 500
        local bannerH = 65
        local bx = (W - bannerW) / 2
        local by = 60

        -- Red flash background
        local flash = 0.5 + math.sin(love.timer.getTime() * 8) * 0.3
        love.graphics.setColor(0.3 * flash, 0, 0, 0.9 * alpha * fadeIn)
        love.graphics.rectangle("fill", bx, by, bannerW, bannerH, 8, 8)
        love.graphics.setColor(1, 0.1, 0.1, 0.9 * alpha * fadeIn)
        love.graphics.setLineWidth(2)
        love.graphics.rectangle("line", bx, by, bannerW, bannerH, 8, 8)
        love.graphics.setLineWidth(1)

        -- Name + danger
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(1, 0.3, 0.3, alpha * fadeIn)
        love.graphics.printf((aggro.name or "Leviathan") .. " ATTACKS!", bx + 10, by + 6, bannerW - 20, "center")

        -- Countdown
        love.graphics.setColor(1, 1, 0.3, alpha * fadeIn)
        local countdown = string.format("%.1fs", math.max(0, overworld.leviathanAggroTimer))
        love.graphics.printf(countdown .. " - Press F to FLEE", bx + 10, by + 26, bannerW - 20, "center")

        -- Tier
        love.graphics.setColor(1, 0.5, 0.2, 0.8 * alpha * fadeIn)
        love.graphics.printf("[" .. (aggro.tier or "?") .. "]", bx + 10, by + 46, bannerW - 20, "center")
    end

    -- Multi-part HP bars (right side, during leviathan combat)
    if overworld.leviathanParts and overworld.leviathanCombatName then
        game.drawLeviathanPartBars(W, H)
    end
end

-- ---------------------------------------------------------------------------
-- Multi-part HP bars for leviathan combat (right side of screen)
-- ---------------------------------------------------------------------------
function game.drawLeviathanPartBars(W, H)
    local barW = 180
    local barH = 18
    local gap = 6
    local rightPad = 20
    local topPad = 120

    local bx = W - barW - rightPad
    local by = topPad

    -- Title
    love.graphics.setFont(fonts.ui)
    local titleColor = overworld.leviathanEnraged and {1, 0.2, 0.2} or {0.8, 0.9, 1}
    love.graphics.setColor(titleColor[1], titleColor[2], titleColor[3], 0.95 * fadeIn)
    love.graphics.printf(overworld.leviathanCombatName or "Leviathan", bx, by - 24, barW, "center")

    -- Phase text
    if overworld.leviathanPhaseText and overworld.leviathanPhaseTimer > 0 then
        local pa = math.min(1, overworld.leviathanPhaseTimer / 0.5)
        love.graphics.setColor(1, 0.7, 0.2, pa * fadeIn)
        love.graphics.printf(overworld.leviathanPhaseText, bx - 50, by - 8, barW + 100, "center")
        by = by + 16
    end

    -- Sort parts by alive status (alive first)
    local sortedParts = {}
    for _, part in pairs(overworld.leviathanParts) do
        table.insert(sortedParts, part)
    end
    table.sort(sortedParts, function(a, b)
        if a.alive ~= b.alive then return a.alive end
        return (a.name or "") < (b.name or "")
    end)

    for _, part in ipairs(sortedParts) do
        -- Background
        love.graphics.setColor(0.1, 0.1, 0.15, 0.8 * fadeIn)
        love.graphics.rectangle("fill", bx, by, barW, barH, 3, 3)

        if part.alive then
            -- HP bar fill
            local pct = (part.maxHp and part.maxHp > 0) and (part.hp / part.maxHp) or 0
            pct = math.max(0, math.min(1, pct))

            -- Color gradient: green -> yellow -> red
            local r, g, b = 0.2, 0.8, 0.2
            if pct < 0.5 then
                r = 0.8 + (1 - pct * 2) * 0.2
                g = pct * 2 * 0.8
                b = 0.1
            elseif pct < 0.75 then
                r = 0.8
                g = 0.8
                b = 0.1
            end

            love.graphics.setColor(r, g, b, 0.85 * fadeIn)
            love.graphics.rectangle("fill", bx + 1, by + 1, (barW - 2) * pct, barH - 2, 2, 2)
        else
            -- Strike-through for destroyed parts
            love.graphics.setColor(0.5, 0.1, 0.1, 0.4 * fadeIn)
            love.graphics.rectangle("fill", bx + 1, by + 1, barW - 2, barH - 2, 2, 2)
            love.graphics.setColor(1, 0.2, 0.2, 0.7 * fadeIn)
            love.graphics.setLineWidth(2)
            love.graphics.line(bx + 4, by + barH / 2, bx + barW - 4, by + barH / 2)
            love.graphics.setLineWidth(1)
        end

        -- Border
        love.graphics.setColor(0.4, 0.5, 0.6, 0.7 * fadeIn)
        love.graphics.rectangle("line", bx, by, barW, barH, 3, 3)

        -- Part name
        love.graphics.setColor(1, 1, 1, (part.alive and 0.95 or 0.4) * fadeIn)
        love.graphics.printf(part.name or "?", bx + 4, by + 2, barW - 8, "left")

        -- HP text (if alive)
        if part.alive and part.maxHp and part.maxHp > 0 then
            love.graphics.setColor(1, 1, 1, 0.7 * fadeIn)
            love.graphics.printf(part.hp .. "/" .. part.maxHp, bx + 4, by + 2, barW - 8, "right")
        end

        by = by + barH + gap
    end
end

function game.drawConnections()
    if not connections then return end

    local t = love.timer.getTime()
    for _, conn in ipairs(connections) do
        local pulse = 0.5 + math.sin(t * 3) * 0.3

        if conn.isPlotEntrance then
            -- Plot entrance: green house icon
            love.graphics.setColor(0.2, 0.6, 0.2, pulse * 0.5)
            love.graphics.rectangle("fill", conn.x - 18, conn.y - 12, 36, 28, 3, 3)
            -- Roof
            love.graphics.setColor(0.4, 0.25, 0.1, pulse * 0.7)
            love.graphics.polygon("fill", conn.x - 22, conn.y - 12, conn.x + 22, conn.y - 12, conn.x, conn.y - 28)
            -- Door
            love.graphics.setColor(0.3, 0.2, 0.1, pulse * 0.8)
            love.graphics.rectangle("fill", conn.x - 5, conn.y + 2, 10, 14, 2, 2)
            -- Outline
            love.graphics.setColor(0.3, 0.7, 0.3, pulse * 0.8)
            love.graphics.setLineWidth(2)
            love.graphics.rectangle("line", conn.x - 18, conn.y - 12, 36, 28, 3, 3)
            love.graphics.setLineWidth(1)
            -- Owner name label
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.4, 0.8, 0.4, 0.7)
            local label = (conn.ownerName or "Home")
            love.graphics.printf(label, conn.x - 60, conn.y - 44, 120, "center")
        elseif conn.targetZone == "rift_antechamber" then
            -- Rift entrance: dark purple swirling game._portal
            local riftPulse = 0.6 + math.sin(t * 4) * 0.4
            -- Outer glow
            love.graphics.setColor(0.3, 0.0, 0.4, riftPulse * 0.3)
            love.graphics.circle("fill", conn.x, conn.y, 42)
            -- Inner dark void
            love.graphics.setColor(0.1, 0.0, 0.15, riftPulse * 0.7)
            love.graphics.circle("fill", conn.x, conn.y, 32)
            -- Purple ring
            love.graphics.setColor(0.6, 0.1, 0.8, riftPulse * 0.9)
            love.graphics.setLineWidth(3)
            love.graphics.circle("line", conn.x, conn.y, 32)
            -- Inner swirl ring
            love.graphics.setColor(0.8, 0.2, 1.0, riftPulse * 0.6)
            love.graphics.setLineWidth(2)
            love.graphics.arc("line", "open", conn.x, conn.y, 20, t * 2, t * 2 + math.pi * 1.2)
            love.graphics.arc("line", "open", conn.x, conn.y, 20, t * 2 + math.pi, t * 2 + math.pi * 2.2)
            love.graphics.setLineWidth(1)
            -- Label
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.8, 0.3, 1.0, 0.9)
            love.graphics.printf("The Rift", conn.x - 60, conn.y - 52, 120, "center")
        else
            -- Portal circle (default)
            love.graphics.setColor(0.3, 0.5, 1.0, pulse * 0.4)
            love.graphics.circle("fill", conn.x, conn.y, 30)
            love.graphics.setColor(0.4, 0.6, 1.0, pulse * 0.8)
            love.graphics.setLineWidth(2)
            love.graphics.circle("line", conn.x, conn.y, 30)
            love.graphics.setLineWidth(1)

            -- Arrow/direction indicator
            love.graphics.setColor(0.5, 0.7, 1.0, 0.6)
            love.graphics.setFont(fonts.npc)
            love.graphics.printf(conn.targetZone or "?", conn.x - 50, conn.y - 45, 100, "center")

            -- Direction arrow
            local arrowChar = ">"
            if conn.direction == "north" then arrowChar = "^"
            elseif conn.direction == "south" then arrowChar = "v"
            elseif conn.direction == "west" then arrowChar = "<"
            end
            love.graphics.setFont(fonts.ui)
            love.graphics.printf(arrowChar, conn.x - 10, conn.y - 8, 20, "center")
        end
    end
end

-- Find the other-player (not self) whose sprite bounding box contains
-- the given screen-space coordinates (sx, sy). Returns the player table
-- and its id, or nil if nothing is under the cursor.
local function getOtherPlayerAtScreen(sx, sy)
    local wx = sx + math.floor(camera.x)
    local wy = sy + math.floor(camera.y)
    -- Player sprite bounding box: body from (x-8, y-32) to (x+8, y+12)
    -- Head radius 7 adds up top; name tag above. We use a generous click
    -- box of 20x48 centered on the player's (x, y-8) so it covers head+body.
    local HALF_W = 12
    local TOP = 34   -- above p.y
    local BOTTOM = 16 -- below p.y
    for id, p in pairs(players) do
        if id ~= myId then
            if wx >= p.x - HALF_W and wx <= p.x + HALF_W and
               wy >= p.y - TOP and wy <= p.y + BOTTOM then
                return p, id
            end
        end
    end
    return nil, nil
end

-- Execute a context menu action for the given target
local function executeContextMenuAction(action, targetId, targetName)
    if not client then return end
    if action == "friend" then
        client:emit("friend_request_by_id", { targetId = targetId })
        addFloatingText({
            text = "Friend request sent to " .. targetName,
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 40) or 0,
            color = { 0.4, 0.9, 0.4 },
            timer = 2.5,
        })
    elseif action == "party" then
        client:emit("party_invite", { targetId = targetId })
        addFloatingText({
            text = "Party invite sent to " .. targetName,
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 40) or 0,
            color = { 0.4, 0.7, 1 },
            timer = 2.5,
        })
    elseif action == "game._trade" then
        client:emit("trade_request", { targetId = targetId })
        -- Store target info so trade_started can resolve the partner name
        game._trade.partnerId = targetId
        game._trade.partnerName = targetName or "???"
        addFloatingText({
            text = "Trade request sent to " .. targetName,
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 40) or 0,
            color = { 1, 0.85, 0.2 },
            timer = 2.5,
        })
    elseif action == "duel" then
        addFloatingText({
            text = "Dueling not yet available",
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 40) or 0,
            color = { 0.6, 0.6, 0.6 },
            timer = 2.0,
        })
    elseif action == "profile" then
        client:emit("profile_request", { targetId = targetId })
    elseif action == "whisper" then
        -- Activate chat with /whisper <name> prefilled
        chat.active = true
        chat.input = "/whisper " .. targetName .. " "
    elseif action == "party_kick" then
        client:emit("party_kick", { targetId = targetId })
        addFloatingText({
            text = "Kicking " .. targetName .. " from party",
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 40) or 0,
            color = { 1, 0.5, 0.3 },
            timer = 2.5,
        })
    end
end

function game.drawPlayer(p, isMe)
    -- Parse hex color
    local r, g, b = game.hexToRGB(p.color)

    -- Water mount visual: draw raft/boat beneath player when on water
    if isMe and rpg.mount and WATER_MOUNT_TYPES[rpg.mount] and overworld.chunkBased then
        local feat = game.getFeatureAtWorld(p.x, p.y)
        if game.isWaterFeature(feat) then
            if rpg.mount == "raft" then
                love.graphics.setColor(0.5, 0.35, 0.2, 0.8)
                love.graphics.rectangle("fill", p.x - 16, p.y - 6, 32, 20, 3, 3)
                love.graphics.setColor(0.4, 0.25, 0.15, 0.5)
                for lx = -12, 12, 6 do
                    love.graphics.line(p.x + lx, p.y - 6, p.x + lx, p.y + 14)
                end
            elseif rpg.mount == "boat" then
                love.graphics.setColor(0.45, 0.30, 0.18, 0.85)
                love.graphics.rectangle("fill", p.x - 18, p.y - 4, 36, 22, 5, 5)
                love.graphics.setColor(0.55, 0.40, 0.25, 0.6)
                love.graphics.rectangle("line", p.x - 18, p.y - 4, 36, 22, 5, 5)
                -- Mast
                love.graphics.setColor(0.5, 0.35, 0.2, 0.7)
                love.graphics.line(p.x, p.y - 4, p.x, p.y - 20)
            end
        end
    end

    -- Land mount visual: draw horse/caravan beneath player on overworld
    if isMe and rpg.mount and LAND_MOUNT_SPEED[rpg.mount] and overworld.chunkBased then
        if rpg.mount == "horse" then
            -- Horse body (brown ellipse beneath player)
            love.graphics.setColor(0.55, 0.35, 0.15, 0.85)
            love.graphics.ellipse("fill", p.x, p.y + 6, 18, 10)
            -- Horse head
            love.graphics.setColor(0.5, 0.3, 0.12, 0.9)
            love.graphics.ellipse("fill", p.x + 12, p.y - 2, 6, 5)
            -- Legs
            love.graphics.setColor(0.4, 0.25, 0.1, 0.7)
            love.graphics.rectangle("fill", p.x - 10, p.y + 12, 3, 8)
            love.graphics.rectangle("fill", p.x - 3, p.y + 12, 3, 8)
            love.graphics.rectangle("fill", p.x + 4, p.y + 12, 3, 8)
            love.graphics.rectangle("fill", p.x + 11, p.y + 12, 3, 8)
        elseif rpg.mount == "caravan" then
            -- Caravan wagon body
            love.graphics.setColor(0.45, 0.3, 0.15, 0.85)
            love.graphics.rectangle("fill", p.x - 20, p.y - 2, 40, 20, 3, 3)
            -- Canvas top
            love.graphics.setColor(0.7, 0.65, 0.5, 0.7)
            love.graphics.arc("fill", p.x, p.y - 2, 20, math.pi, 0)
            -- Wheels
            love.graphics.setColor(0.3, 0.2, 0.1, 0.9)
            love.graphics.circle("fill", p.x - 14, p.y + 18, 5)
            love.graphics.circle("fill", p.x + 14, p.y + 18, 5)
            love.graphics.setColor(0.5, 0.4, 0.25, 0.6)
            love.graphics.circle("line", p.x - 14, p.y + 18, 5)
            love.graphics.circle("line", p.x + 14, p.y + 18, 5)
        end
    end

    -- Ascension glow (eternal_mark)
    local hasAscGlow = (isMe and rpg.ascensionMark) or (not isMe and p.ascensionMark)
    if hasAscGlow then
        local t = love.timer.getTime()
        local pulse = 0.55 + 0.15 * math.sin(t * 2.0)
        local outerPulse = 22 + 3 * math.sin(t * 1.5)
        -- Outer golden halo
        love.graphics.setColor(1.0, 0.85, 0.3, pulse * 0.25)
        love.graphics.circle("fill", p.x, p.y - 2, outerPulse)
        -- Inner radiant glow
        love.graphics.setColor(1.0, 0.9, 0.5, pulse * 0.4)
        love.graphics.circle("fill", p.x, p.y - 2, 14)
    end

    -- Shadow
    love.graphics.setColor(0, 0, 0, 0.2)
    love.graphics.ellipse("fill", p.x, p.y + 14, 10, 4)

    -- Body
    love.graphics.setColor(r, g, b, 0.9)
    love.graphics.rectangle("fill", p.x - 8, p.y - 12, 16, 24, 3, 3)

    -- Head
    love.graphics.setColor(r + 0.1, g + 0.1, b + 0.1)
    love.graphics.circle("fill", p.x, p.y - 16, 7)

    -- Eyes (based on facing)
    love.graphics.setColor(0, 0, 0, 0.8)
    if p.facing == "down" or p.facing == nil then
        love.graphics.circle("fill", p.x - 2.5, p.y - 16, 1.5)
        love.graphics.circle("fill", p.x + 2.5, p.y - 16, 1.5)
    elseif p.facing == "up" then
        -- No eyes visible from behind
    elseif p.facing == "left" then
        love.graphics.circle("fill", p.x - 3, p.y - 16, 1.5)
    elseif p.facing == "right" then
        love.graphics.circle("fill", p.x + 3, p.y - 16, 1.5)
    end

    -- Name tag (CharacterName | Username)
    love.graphics.setFont(fonts.name)
    if isMe then
        love.graphics.setColor(1, 1, 1, 0.95)
    else
        love.graphics.setColor(0.8, 0.8, 0.8, 0.8)
    end
    local displayName = p.name
    if p.username and p.username ~= p.name then
        displayName = p.name .. " | " .. p.username
    end
    love.graphics.printf(displayName, p.x - 75, p.y - 32, 150, "center")

    -- Selection indicator for self
    if isMe then
        love.graphics.setColor(1, 1, 1, 0.3 + math.sin(love.timer.getTime() * 4) * 0.15)
        love.graphics.setLineWidth(1)
        love.graphics.circle("line", p.x, p.y, 18)
    end
end

-- NPC Dialogue Panel
function game.drawDialoguePanel(W, H)
    if not game._npcDialogue.show then return end

    local panelW = math.min(600, W - 40)
    local panelH = 200
    local panelX = (W - panelW) / 2
    local panelY = H - panelH - 20

    -- Background
    love.graphics.setColor(0.05, 0.05, 0.12, 0.92)
    love.graphics.rectangle("fill", panelX, panelY, panelW, panelH, 8, 8)
    love.graphics.setColor(0.4, 0.5, 0.8, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", panelX, panelY, panelW, panelH, 8, 8)

    -- NPC Name
    love.graphics.setColor(1, 0.85, 0.3, 1)
    love.graphics.setFont(fonts.bold or love.graphics.getFont())
    love.graphics.print(game._npcDialogue.npcName, panelX + 16, panelY + 10)

    -- Text
    love.graphics.setColor(0.9, 0.9, 0.95, 1)
    love.graphics.setFont(fonts.main or love.graphics.getFont())
    love.graphics.printf(game._npcDialogue.text, panelX + 16, panelY + 35, panelW - 32, "left")

    -- Choices
    local choiceY = panelY + 100
    for i, choice in ipairs(game._npcDialogue.choices) do
        local label = "[" .. i .. "] " .. (choice.label or "...")
        local mx, my = love.mouse.getPosition()
        local choiceX = panelX + 24
        local choiceW = panelW - 48
        local choiceH = 22
        local hover = mx >= choiceX and mx <= choiceX + choiceW and my >= choiceY and my <= choiceY + choiceH

        if hover then
            love.graphics.setColor(0.3, 0.4, 0.7, 0.5)
            love.graphics.rectangle("fill", choiceX - 4, choiceY - 2, choiceW + 8, choiceH + 4, 4, 4)
            love.graphics.setColor(0.6, 0.8, 1, 1)
        else
            love.graphics.setColor(0.7, 0.75, 0.85, 1)
        end
        love.graphics.print(label, choiceX, choiceY)
        choiceY = choiceY + 24
    end
end

-- Dedicated RNG for weather particles (avoids reseeding global math.random)
local weatherRng = love.math.newRandomGenerator()

function game.drawWeather(W, H)
    if world.weather == "rain" or world.weather == "storm" then
        love.graphics.setColor(0.5, 0.6, 0.8, 0.08)
        love.graphics.rectangle("fill", 0, 0, W, H)

        -- Rain drops (using dedicated RNG, seeded by time frame)
        weatherRng:setSeed(math.floor(love.timer.getTime() * 10))
        local alpha = world.weather == "storm" and 0.4 or 0.2
        love.graphics.setColor(0.6, 0.7, 0.9, alpha)
        for i = 1, (world.weather == "storm" and 80 or 30) do
            local rx = weatherRng:random(0, W)
            local ry = weatherRng:random(0, H)
            love.graphics.line(rx, ry, rx - 2, ry + 8)
        end

    elseif world.weather == "fog" then
        love.graphics.setColor(0.7, 0.7, 0.7, 0.15)
        love.graphics.rectangle("fill", 0, 0, W, H)

    elseif world.weather == "snow" then
        weatherRng:setSeed(math.floor(love.timer.getTime() * 5))
        love.graphics.setColor(1, 1, 1, 0.5)
        for i = 1, 40 do
            local sx = weatherRng:random(0, W)
            local sy = weatherRng:random(0, H)
            love.graphics.circle("fill", sx, sy, 2)
        end
    end
end

function game.drawSeasonVisual(W, H)
    local sv = world.seasonVisual
    if not sv then return end

    -- Color shift overlay (subtle screen tint)
    local cs = sv.colorShift
    if cs then
        local r = cs.r and (cs.r / 255) or 0
        local g = cs.g and (cs.g / 255) or 0
        local b = cs.b and (cs.b / 255) or 0
        -- Positive shift: add color, negative: subtract via blend
        if r > 0 or g > 0 or b > 0 then
            love.graphics.setColor(math.max(0, r), math.max(0, g), math.max(0, b), 0.06)
            love.graphics.rectangle("fill", 0, 0, W, H)
        end
        if r < 0 or g < 0 or b < 0 then
            love.graphics.setColor(math.abs(r), math.abs(g), math.abs(b), 0.04)
            love.graphics.rectangle("fill", 0, 0, W, H)
        end
    end

    -- Seasonal particles
    local effect = sv.particleEffect
    if not effect then return end

    weatherRng:setSeed(math.floor(love.timer.getTime() * 3))
    local t = love.timer.getTime()

    if effect == "snowfall" then
        -- Gentle persistent snowfall (lighter than weather snow)
        love.graphics.setColor(0.95, 0.95, 1, 0.35)
        for i = 1, 25 do
            local sx = weatherRng:random(0, W)
            local sy = (weatherRng:random(0, H) + t * 20 * (1 + i % 3)) % H
            local sz = 1 + (i % 3)
            love.graphics.circle("fill", sx, sy, sz)
        end

    elseif effect == "leaves" then
        -- Falling autumn leaves
        for i = 1, 15 do
            local lx = weatherRng:random(0, W)
            local ly = (weatherRng:random(0, H) + t * 15 * (1 + i % 2)) % H
            -- Warm autumn colors
            local leafColors = {
                {0.85, 0.45, 0.15},
                {0.80, 0.30, 0.10},
                {0.90, 0.60, 0.10},
                {0.70, 0.25, 0.05},
            }
            local lc = leafColors[(i % #leafColors) + 1]
            love.graphics.setColor(lc[1], lc[2], lc[3], 0.5)
            -- Small diamond shape for leaf
            local angle = t * 2 + i
            local dx = math.cos(angle) * 3
            local dy = math.sin(angle) * 2
            love.graphics.polygon("fill", lx + dx, ly - 3, lx + 3, ly + dy, lx - dx, ly + 3, lx - 3, ly - dy)
        end

    elseif effect == "pollen" then
        -- Floating pollen/petals
        love.graphics.setColor(1, 1, 0.7, 0.25)
        for i = 1, 20 do
            local px = (weatherRng:random(0, W) + math.sin(t + i) * 30) % W
            local py = (weatherRng:random(0, H) + math.cos(t * 0.7 + i) * 20) % H
            love.graphics.circle("fill", px, py, 1.5)
        end

    elseif effect == "shimmer" then
        -- Heat shimmer / distortion dots
        love.graphics.setColor(1, 0.95, 0.8, 0.15)
        for i = 1, 12 do
            local hx = weatherRng:random(0, W)
            local hy = H - weatherRng:random(0, math.floor(H * 0.4))
            local pulse = math.sin(t * 3 + i) * 0.5 + 0.5
            love.graphics.setColor(1, 0.95, 0.8, 0.08 + pulse * 0.08)
            love.graphics.circle("fill", hx, hy, 4 + pulse * 3)
        end
    end
end

function game.drawHUD(W, H)
    -- Top bar
    love.graphics.setColor(0, 0, 0, 0.5)
    love.graphics.rectangle("fill", 0, 0, W, 32)

    love.graphics.setFont(fonts.hud)

    -- Zone name + dynamic HUD layout
    local hudX = 10
    if zone then
        love.graphics.setColor(0.9, 0.8, 0.3, fadeIn)
        love.graphics.print(zone.name, hudX, 7)
        hudX = hudX + fonts.hud:getWidth(zone.name) + 20

        -- Player count
        local pCount = 0
        for _ in pairs(players) do pCount = pCount + 1 end
        local pText = "Players: " .. pCount
        love.graphics.setColor(0.6, 0.7, 0.8, fadeIn * 0.7)
        love.graphics.print(pText, hudX, 7)
        hudX = hudX + fonts.hud:getWidth(pText) + 20

        -- Region name (for overworld/hollow earth chunks)
        if overworld.chunkBased and overworld.currentBiome then
            if overworld.isHollowEarth then
                love.graphics.setColor(0.6, 0.4, 0.9, fadeIn * 0.9)
                local heLabel = "[Hollow Earth] " .. overworld.currentBiome
                love.graphics.print(heLabel, hudX, 7)
                hudX = hudX + fonts.hud:getWidth(heLabel) + 20
            else
                love.graphics.setColor(0.8, 0.75, 0.4, fadeIn * 0.8)
                love.graphics.print(overworld.currentBiome, hudX, 7)
                hudX = hudX + fonts.hud:getWidth(overworld.currentBiome) + 20
            end
        end

        -- Corruption indicator (overworld only, when corruption is active)
        if corruption.globalInfo and corruption.globalInfo.totalChunks > 0 then
            local cText = "Corruption: " .. corruption.globalInfo.totalChunks
            if corruption.globalInfo.hordes > 0 then
                cText = cText .. " [" .. corruption.globalInfo.hordes .. " hordes]"
            end
            local cPulse = 0.7 + math.sin(corruption.animTimer * 2) * 0.15
            love.graphics.setColor(0.6, 0.15, 0.8, fadeIn * cPulse)
            love.graphics.print(cText, hudX, 7)
            hudX = hudX + fonts.hud:getWidth(cText) + 20
        end
    end

    -- Race + Level display
    if rpg.race then
        love.graphics.setColor(0.8, 0.7, 0.5, fadeIn * 0.9)
        local raceText = rpg.race:sub(1,1):upper() .. rpg.race:sub(2) .. " Lv." .. rpg.level
        love.graphics.print(raceText, hudX, 7)
        hudX = hudX + fonts.hud:getWidth(raceText) + 15
    end

    -- Top skills (just show 3 highest)
    if skills then
        local skillList = {}
        for sName, sData in pairs(skills) do
            if sData.level and sData.level > 1 then
                table.insert(skillList, { name = sName, level = sData.level })
            end
        end
        table.sort(skillList, function(a, b) return a.level > b.level end)
        local shown = 0
        for _, s in ipairs(skillList) do
            if shown >= 3 then break end
            local abbr = s.name:sub(1,1):upper() .. s.name:sub(2,3)
            local txt = abbr .. ":" .. s.level
            love.graphics.setColor(0.6, 0.7, 0.9, fadeIn * 0.8)
            love.graphics.print(txt, hudX, 7)
            hudX = hudX + fonts.hud:getWidth(txt) + 10
            shown = shown + 1
        end
    end

    -- Pending packs indicator
    if rpg.pendingPacks and rpg.pendingPacks > 0 then
        love.graphics.setColor(1, 0.85, 0.2, fadeIn * (0.7 + 0.3 * math.sin(love.timer.getTime() * 3)))
        local packText = "Packs: " .. rpg.pendingPacks
        love.graphics.print(packText, hudX, 7)
        hudX = hudX + fonts.hud:getWidth(packText) + 15
    end

    -- Plot indicator
    if overworld.chunkBased then
        if overworld.myPlotId then
            love.graphics.setColor(0.3, 0.9, 0.3, fadeIn * 0.9)
            love.graphics.print("Plot Claimed", hudX, 7)
            hudX = hudX + fonts.hud:getWidth("Plot Claimed") + 15
        else
            love.graphics.setColor(0.6, 0.5, 0.3, fadeIn * 0.6)
            love.graphics.print("[P] Claim Plot", hudX, 7)
            hudX = hudX + fonts.hud:getWidth("[P] Claim Plot") + 15
        end
    end

    -- Account info (coins)
    if account then
        love.graphics.setColor(1, 0.85, 0.2, fadeIn)
        love.graphics.printf("Coins: " .. (account.coins or 0), 0, 7, W - 10, "right")
    end

    -- World info
    love.graphics.setColor(0.6, 0.6, 0.7, fadeIn * 0.6)
    local worldText = world.timeOfDay
    if world.weather ~= "clear" then
        worldText = worldText .. " | " .. world.weather
    end
    love.graphics.printf(worldText, 0, 7, W - 150, "right")

    -- Identity
    if identity then
        love.graphics.setColor(0.5, 0.6, 0.7, fadeIn * 0.5)
        love.graphics.setFont(fonts.npc)
        love.graphics.print(identity.name .. "#" .. (identity.tag or "????"), 10, H - 18)
    end

    -- Stamina bar (only visible when not full or sprinting)
    local sprintBarMax = computeSprintBonuses().max
    if sprint.stamina < sprintBarMax or sprint.isSprinting then
        local barW = 120
        local barH = 6
        local barX = W / 2 - barW / 2
        local barY = 38
        local pct = sprint.stamina / sprintBarMax

        -- Background
        love.graphics.setColor(0, 0, 0, 0.5 * fadeIn)
        love.graphics.rectangle("fill", barX - 1, barY - 1, barW + 2, barH + 2, 2, 2)

        -- Fill color: green -> yellow -> red, flashing red when exhausted
        local r, g, b = 0.2, 0.8, 0.3
        if sprint.isExhausted then
            local flash = 0.6 + 0.4 * math.sin(love.timer.getTime() * 6)
            r, g, b = 0.9, 0.2, 0.2
            r = r * flash
        elseif pct < 0.25 then
            r, g, b = 0.9, 0.3, 0.2
        elseif pct < 0.5 then
            r, g, b = 0.9, 0.7, 0.2
        end
        love.graphics.setColor(r, g, b, 0.85 * fadeIn)
        love.graphics.rectangle("fill", barX, barY, barW * pct, barH, 2, 2)

        -- Label
        love.graphics.setFont(fonts.npc)
        if sprint.isExhausted then
            love.graphics.setColor(1, 0.3, 0.3, 0.9 * fadeIn)
            love.graphics.printf("EXHAUSTED", barX, barY + barH + 2, barW, "center")
        elseif sprint.isSprinting then
            love.graphics.setColor(0.8, 0.8, 0.3, 0.7 * fadeIn)
            love.graphics.printf("SPRINTING", barX, barY + barH + 2, barW, "center")
        end
    end

    -- Base game._raid alert banner
    if ui.baseRaidAlert then
        local alertAge = love.timer.getTime() - (ui.baseRaidAlert.receivedAt or 0)
        local alertDur = (ui.baseRaidAlert.alertDuration or 60000) / 1000
        if alertAge < alertDur + 5 then
            local flash = 0.7 + 0.3 * math.sin(love.timer.getTime() * 6)
            love.graphics.setColor(0.8, 0.1, 0.1, flash * fadeIn * 0.9)
            love.graphics.rectangle("fill", W/2 - 200, 60, 400, 36, 6, 6)
            love.graphics.setColor(1, 1, 1, fadeIn)
            love.graphics.setFont(fonts.ui)
            love.graphics.printf("BASE UNDER ATTACK! Press H for Home Teleport", W/2 - 195, 68, 390, "center")
            local remaining = math.max(0, math.ceil(alertDur - alertAge))
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(1, 0.8, 0.3, fadeIn)
            love.graphics.printf(remaining .. "s until enemies arrive", W/2 - 195, 88, 390, "center")
        end
    end

    -- Controls hint
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.5, 0.5, 0.6, fadeIn * 0.4)
    local sprintHint = overworld.chunkBased and "" or " | Shift:Sprint"
    love.graphics.printf("WASD:Move" .. sprintHint .. " | Enter:Chat | E:Interact | I:Inv | C:Char | K:Cards | M:Map | F:Farm | H:Home", 0, H - 18, W - 10, "right")
end

function game.drawWorldSystemsHUD(W, H)
    -- Disease indicators (top-right area, below minimap)
    local diseaseY = 120
    local diseaseCount = 0
    for diseaseId, info in pairs(game._disease.playerDiseases) do
        diseaseCount = diseaseCount + 1
        local stateLabel = "?"
        if info.state == 1 then stateLabel = "Exposed"
        elseif info.state == 2 then stateLabel = "Infected"
        elseif info.state == 3 then stateLabel = "Quarantined"
        elseif info.state == 4 then stateLabel = "Recovering" end

        love.graphics.setColor(0.8, 0.2, 0.2, 0.9)
        love.graphics.printf(diseaseId:gsub("_", " ") .. " [" .. stateLabel .. "]",
            W - 220, diseaseY, 210, "right")
        diseaseY = diseaseY + 16
    end

    -- Disease contraction flash
    if game._disease.contractedFlash > 0 then
        local alpha = math.min(1, game._disease.contractedFlash)
        love.graphics.setColor(0.6, 0.0, 0.0, alpha * 0.3)
        love.graphics.rectangle("fill", 0, 0, W, H)
        love.graphics.setColor(1, 0.2, 0.2, alpha)
        love.graphics.printf(game._disease.contractedName or "Disease Contracted",
            0, H * 0.3, W, "center")
    end

    -- Disease symptom flash
    if game._disease.symptomTimer > 0 and game._disease.symptomMsg then
        local alpha = math.min(1, game._disease.symptomTimer)
        love.graphics.setColor(0.7, 0.1, 0.1, alpha)
        love.graphics.printf(game._disease.symptomMsg, 0, H * 0.4, W, "center")
    end

    -- Faction territory indicator (top-left, below HUD)
    if game._influence.controlling then
        love.graphics.setColor(0.7, 0.7, 0.3, 0.8)
        love.graphics.printf("Territory: " .. game._influence.controlling:gsub("_", " "),
            10, 90, 250, "left")
    end

    -- Ecology indicator
    if game._ecology.name ~= "unknown" then
        love.graphics.setColor(0.3, 0.7, 0.3, 0.6)
        local bonusStr = ""
        if game._ecology.resourceBonus ~= 1.0 then
            bonusStr = " (x" .. string.format("%.1f", game._ecology.resourceBonus) .. ")"
        end
        love.graphics.printf("Ecology: " .. game._ecology.name .. bonusStr,
            10, 106, 250, "left")
    end

    -- Wind direction (subtle)
    if game._weather.wind then
        love.graphics.setColor(0.6, 0.6, 0.8, 0.4)
        love.graphics.printf("Wind: " .. game._weather.wind, W - 120, H - 34, 110, "right")
    end

    love.graphics.setColor(1, 1, 1, 1)
end

function game.drawDoomHUD(W, H)
    -- Doom ascension cinematic overlay (full screen, highest priority)
    if doom.showEvent then
        local progress = 1 - (doom.eventTimer / 8.0)
        if progress < 0.3 then
            -- Fade to white
            local a = progress / 0.3
            love.graphics.setColor(1, 1, 1, a)
            love.graphics.rectangle("fill", 0, 0, W, H)
        elseif progress < 0.5 then
            -- White to black
            local a = (progress - 0.3) / 0.2
            love.graphics.setColor(1 - a, 1 - a, 1 - a, 1)
            love.graphics.rectangle("fill", 0, 0, W, H)
        else
            -- Black with narrative text
            love.graphics.setColor(0, 0, 0, 1)
            love.graphics.rectangle("fill", 0, 0, W, H)
            local textAlpha = math.min(1, (progress - 0.5) * 4)
            love.graphics.setColor(0.8, 0.2, 0.2, textAlpha)
            love.graphics.setFont(fonts.header or _G.getFont(22))
            love.graphics.printf(doom.eventMessage or "The world resets.", 40, H / 2 - 30, W - 80, "center")
            love.graphics.setColor(0.5, 0.5, 0.5, textAlpha * 0.6)
            love.graphics.setFont(fonts.ui or _G.getFont(14))
            love.graphics.printf("Doom Ascension #" .. (doom.doomAscensionCount or 1), 40, H / 2 + 20, W - 80, "center")
        end
        return
    end

    -- Capital corruption warning flash
    if doom.flashTimer > 0 then
        local fa = doom.flashTimer / 3.0
        love.graphics.setColor(0.8, 0.1, 0.05, fa * 0.3)
        love.graphics.rectangle("fill", 0, 0, W, H)
        love.graphics.setColor(1, 0.3, 0.2, fa)
        love.graphics.setFont(fonts.header or _G.getFont(22))
        love.graphics.printf("The corruption has breached Solara.", 40, H / 2 - 40, W - 80, "center")
        love.graphics.setColor(0.7, 0.2, 0.15, fa * 0.8)
        love.graphics.setFont(fonts.ui or _G.getFont(14))
        love.graphics.printf("Beneath the Cathedral, Helios stirs in agony.", 40, H / 2, W - 80, "center")
    end

    -- Doom countdown timer (top-center, red pulsing)
    if doom.active and doom.remainingMs > 0 then
        local totalSec = math.floor(doom.remainingMs / 1000)
        local hours = math.floor(totalSec / 3600)
        local minutes = math.floor((totalSec % 3600) / 60)
        local seconds = totalSec % 60
        local timerStr = string.format("DOOM: %02d:%02d:%02d", hours, minutes, seconds)

        -- Pulse speed increases as time decreases (faster when < 1 hour)
        local pulseSpeed = doom.remainingMs < 3600000 and 6.0 or 2.0
        local pulse = 0.7 + 0.3 * math.abs(math.sin(love.timer.getTime() * pulseSpeed))

        -- Color: bright red when < 1 hour, normal red otherwise
        local r, g, b
        if doom.remainingMs < 3600000 then
            r, g, b = 1.0, 0.1, 0.05
        else
            r, g, b = 0.85, 0.15, 0.1
        end

        -- Background bar
        local tw = 260
        local th = 44
        local tx = (W - tw) / 2
        local ty = 8
        love.graphics.setColor(0, 0, 0, 0.7)
        love.graphics.rectangle("fill", tx, ty, tw, th, 6, 6)
        love.graphics.setColor(r * 0.3, 0, 0, 0.5 * pulse)
        love.graphics.rectangle("fill", tx, ty, tw, th, 6, 6)
        love.graphics.setColor(r, g, b, pulse)
        love.graphics.rectangle("line", tx, ty, tw, th, 6, 6)

        -- Timer text
        love.graphics.setFont(fonts.header or _G.getFont(20))
        love.graphics.setColor(r, g, b, pulse)
        love.graphics.printf(timerStr, tx, ty + 3, tw, "center")

        -- Subtitle
        love.graphics.setFont(fonts.npc or _G.getFont(10))
        love.graphics.setColor(0.6, 0.15, 0.1, pulse * 0.8)
        love.graphics.printf("Helios trembles.", tx, ty + 26, tw, "center")

        -- Red vignette when < 1 hour
        if doom.remainingMs < 3600000 then
            local vigAlpha = 0.08 * pulse
            love.graphics.setColor(0.6, 0, 0, vigAlpha)
            love.graphics.rectangle("fill", 0, 0, W, 40)
            love.graphics.rectangle("fill", 0, H - 40, W, 40)
            love.graphics.rectangle("fill", 0, 0, 40, H)
            love.graphics.rectangle("fill", W - 40, 0, 40, H)
        end
    end
end

function game.drawChat(W, H)
    -- No chat in offline/solo mode
    if _G.offlineMode then return end

    local chatW = math.min(400, W * 0.45)
    local chatX = 5

    -- When chat is not active, show only a minimal hint + recent messages fade
    if not chat.active then
        -- Show last few messages briefly after they arrive (fade out)
        local now = love.timer.getTime()
        local recentCount = 0
        for i = #chat.messages, math.max(1, #chat.messages - 3), -1 do
            local msg = chat.messages[i]
            local age = now - (msg._localTime or 0)
            if age < 8 then recentCount = recentCount + 1 end
        end

        if recentCount > 0 then
            local lineH = 18
            local recentH = recentCount * lineH + 8
            local recentY = H - recentH - 30
            love.graphics.setColor(0, 0, 0, 0.25)
            love.graphics.rectangle("fill", chatX, recentY, chatW, recentH, 4, 4)
            love.graphics.setFont(fonts.chat)
            local drawn = 0
            for i = math.max(1, #chat.messages - 3), #chat.messages do
                local msg = chat.messages[i]
                local age = now - (msg._localTime or 0)
                if age < 8 then
                    local alpha = age < 6 and 1.0 or (1.0 - (age - 6) / 2)
                    local ly = recentY + 4 + drawn * lineH
                    local prefixW = 0
                    if msg.chatType == "shout" then
                        love.graphics.setColor(1, 0.8, 0.2, fadeIn * alpha * 0.9)
                        love.graphics.print("[SHOUT] ", chatX + 6, ly)
                        prefixW = fonts.chat:getWidth("[SHOUT] ")
                    end
                    local nr, ng, nb = game.hexToRGB(msg.authorColor or "#CCCCCC")
                    love.graphics.setColor(nr, ng, nb, fadeIn * alpha * 0.9)
                    local nameText = (msg.authorName or "?") .. ": "
                    love.graphics.print(nameText, chatX + 6 + prefixW, ly)
                    local nameW = fonts.chat:getWidth(nameText)
                    love.graphics.setColor(0.9, 0.9, 0.9, fadeIn * alpha * 0.85)
                    love.graphics.print(msg.content or "", chatX + 6 + prefixW + nameW, ly)
                    drawn = drawn + 1
                end
            end
        end

        -- Small hint at bottom-left
        love.graphics.setFont(fonts.small or _G.getFont(10))
        love.graphics.setColor(0.5, 0.5, 0.6, fadeIn * 0.35)
        love.graphics.print("[Enter] Chat", chatX + 4, H - 28)
        return
    end

    -- Full chat UI when active
    local chatH = 200
    local chatY = H - chatH - 25

    -- Chat background
    love.graphics.setColor(0, 0, 0, 0.5)
    love.graphics.rectangle("fill", chatX, chatY, chatW, chatH, 6, 6)
    love.graphics.setColor(0.3, 0.5, 0.8, 0.4)
    love.graphics.rectangle("line", chatX, chatY, chatW, chatH, 6, 6)

    -- Messages
    love.graphics.setFont(fonts.chat)
    local lineH = 18
    local visibleLines = math.floor(chatH / lineH) - 1
    local startIdx = math.max(1, #chat.messages - visibleLines + 1)

    for i = startIdx, #chat.messages do
        local msg = chat.messages[i]
        local lineIdx = i - startIdx
        local ly = chatY + 5 + lineIdx * lineH

        if ly + lineH > chatY + chatH - 25 then break end

        -- Shout prefix
        local prefixW = 0
        if msg.chatType == "shout" then
            love.graphics.setColor(1, 0.8, 0.2, fadeIn * 0.9)
            love.graphics.print("[SHOUT] ", chatX + 8, ly)
            prefixW = fonts.chat:getWidth("[SHOUT] ")
        end

        -- Author name
        local nr, ng, nb = game.hexToRGB(msg.authorColor or "#CCCCCC")
        love.graphics.setColor(nr, ng, nb, fadeIn * 0.9)
        local nameText = (msg.authorName or "?") .. ": "
        love.graphics.print(nameText, chatX + 8 + prefixW, ly)

        -- Message content
        local nameW = fonts.chat:getWidth(nameText)
        local contentAlpha = msg.chatType == "shout" and 1.0 or 0.85
        love.graphics.setColor(0.9, 0.9, 0.9, fadeIn * contentAlpha)
        love.graphics.print(msg.content or "", chatX + 8 + prefixW + nameW, ly)
    end

    -- Chat input bar
    local inputY = chatY + chatH - 24
    love.graphics.setColor(0.1, 0.1, 0.18, 0.9)
    love.graphics.rectangle("fill", chatX, inputY, chatW, 22, 4, 4)
    love.graphics.setColor(0.3, 0.5, 0.8, 0.6)
    love.graphics.rectangle("line", chatX, inputY, chatW, 22, 4, 4)

    -- "CHAT" indicator badge
    love.graphics.setFont(fonts.small)
    local badgeText = "CHAT"
    local badgeW = fonts.small:getWidth(badgeText) + 8
    love.graphics.setColor(0.2, 0.4, 0.7, 0.8)
    love.graphics.rectangle("fill", chatX + chatW - badgeW - 4, inputY - 16, badgeW, 14, 3, 3)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.print(badgeText, chatX + chatW - badgeW, inputY - 15)

    love.graphics.setFont(fonts.chatInput)
    love.graphics.setColor(1, 1, 1, fadeIn)
    love.graphics.print(chat.input .. (math.floor(love.timer.getTime() * 2) % 2 == 0 and "|" or ""), chatX + 6, inputY + 3)
end

function game.drawInventory(W, H)
    if not ui.showInventory then return end

    local panelW = math.min(700, W - 40)
    local panelH = math.min(560, H - 60)
    local panelX = (W - panelW) / 2
    local panelY = (H - panelH) / 2

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.05, 0.05, 0.1, 0.92)
    love.graphics.rectangle("fill", panelX, panelY, panelW, panelH, 8, 8)
    love.graphics.setColor(0.3, 0.3, 0.4, 0.6)
    love.graphics.rectangle("line", panelX, panelY, panelW, panelH, 8, 8)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.9, 0.85, 0.4, 1)
    love.graphics.printf("Inventory", panelX, panelY + 8, panelW, "center")

    -- Tabs
    local tabs = { "resources", "items", "crafting" }
    local tabW = panelW / 3
    love.graphics.setFont(fonts.hud)
    for i, tab in ipairs(tabs) do
        local tx = panelX + (i - 1) * tabW
        local ty = panelY + 35
        if ui.inventoryTab == tab then
            love.graphics.setColor(0.2, 0.25, 0.35, 0.9)
        else
            love.graphics.setColor(0.1, 0.12, 0.18, 0.7)
        end
        love.graphics.rectangle("fill", tx + 2, ty, tabW - 4, 24, 4, 4)
        love.graphics.setColor(0.8, 0.8, 0.9, ui.inventoryTab == tab and 1 or 0.5)
        love.graphics.printf(tab:sub(1,1):upper() .. tab:sub(2), tx + 2, ty + 4, tabW - 4, "center")
    end

    local contentY = panelY + 68
    local contentH = panelH - 78

    if ui.inventoryTab == "resources" then
        game.drawResourcesTab(panelX, contentY, panelW, contentH)
    elseif ui.inventoryTab == "items" then
        game.drawItemsTab(panelX, contentY, panelW, contentH)
    elseif ui.inventoryTab == "crafting" then
        game.drawCraftingTab(panelX, contentY, panelW, contentH)
    end
end

function game.drawResourcesTab(px, py, pw, ph)
    love.graphics.setFont(fonts.zone)
    local items = {
        { name = "Wood", key = "wood", color = {0.45, 0.3, 0.15} },
        { name = "Stone", key = "stone", color = {0.5, 0.5, 0.48} },
        { name = "Iron Ore", key = "iron_ore", color = {0.7, 0.45, 0.2} },
        { name = "Iron Bar", key = "iron_bar", color = {0.6, 0.6, 0.65} },
    }
    for i, item in ipairs(items) do
        local iy = py + (i - 1) * 40 + 5
        -- Icon
        love.graphics.setColor(item.color[1], item.color[2], item.color[3], 0.9)
        love.graphics.circle("fill", px + 25, iy + 12, 10)
        -- Name and count
        love.graphics.setColor(0.9, 0.9, 0.85, 0.9)
        love.graphics.print(item.name, px + 45, iy + 3)
        love.graphics.setColor(1, 1, 0.7, 1)
        local count = mmoInventory[item.key] or 0
        love.graphics.printf(tostring(count), px, iy + 3, pw - 15, "right")
    end

    -- Equipment section
    local eqY = py + #items * 40 + 20
    love.graphics.setColor(0.6, 0.6, 0.7, 0.6)
    love.graphics.line(px + 10, eqY, px + pw - 10, eqY)
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(0.7, 0.7, 0.8, 0.8)
    love.graphics.print("Equipment", px + 15, eqY + 8)

    local axeName = equipment.axe and "Iron Axe" or "(none)"
    local pickName = equipment.pickaxe and "Iron Pickaxe" or "(none)"
    love.graphics.setFont(fonts.chat)
    love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
    love.graphics.print("Axe: " .. axeName, px + 20, eqY + 30)
    love.graphics.print("Pickaxe: " .. pickName, px + 20, eqY + 50)
end

-- B2 helper: auto-detect equipment slot from item type
function game.getEquipSlotForItem(item)
    local t = item.type or ""
    -- Weapon types → main_hand (default), off_hand if main hand full
    if t:find("sword") or t:find("axe_weapon") or t:find("mace") or t:find("dagger")
       or t:find("staff") or t:find("wand") or t:find("bow") or t:find("crossbow")
       or t:find("spear") or t:find("scythe") then
        local eq = (rpg and rpg.equipment) or {}
        if eq.main_hand and not eq.off_hand then
            return "off_hand"
        end
        return "main_hand"
    end
    -- Shield → off_hand (default), main_hand if off_hand full
    if t:find("shield") then
        local eq = (rpg and rpg.equipment) or {}
        if eq.off_hand and not eq.main_hand then
            return "main_hand"
        end
        return "off_hand"
    end
    -- Armor slots
    if t:find("helm") or t:find("cap") or t:find("coif") or t:find("hood") then return "head" end
    if t:find("vest") or t:find("mail") or t:find("plate") and not t:find("leg") and not t:find("boot") and not t:find("gauntlet") then
        return "chest"
    end
    if t:find("pants") or t:find("legs") or t:find("greaves") then return "legs" end
    if t:find("boots") then return "feet" end
    if t:find("gloves") or t:find("gauntlets") then return "hands" end
    if t:find("undershirt") or t:find("chainmail") then return "undershirt" end
    if t:find("bracer") or t:find("armwrap") then return "arms" end
    -- Accessories — rings auto-find first empty slot
    if t:find("ring") then
        local eq = (rpg and rpg.equipment) or {}
        for i = 1, 6 do
            if not eq["ring" .. i] then return "ring" .. i end
        end
        return "ring1"
    end
    if t:find("amulet") or t:find("necklace") or t:find("pendant") then return "necklace" end
    if t:find("robe") then return "chest" end
    return "main_hand"  -- default fallback
end

-- Item display helpers (on game table to avoid upvalue overflow)
function game.getItemRarityColor(item)
    if not item then return {0.85, 0.85, 0.8} end
    local r = item.rarity or "common"
    return game._itemUI.RARITY_COLORS[r] or {0.85, 0.85, 0.8}
end

function game.getItemQualityColor(item)
    if not item or not item.quality then return nil end
    return game._itemUI.QUALITY_COLORS[item.quality] or nil
end

function game.getItemDisplayName(item)
    if not item then return "?" end
    if item.displayName then return item.displayName end
    return item.name or item.type or "?"
end

function game.isEquipmentItem(item)
    if not item or not item.type then return false end
    local t = item.type
    if item.stats or item.rarity or item.quality or item.sockets then return true end
    if t:find("sword") or t:find("axe_weapon") or t:find("mace") or t:find("dagger")
       or t:find("staff") or t:find("wand") or t:find("bow") or t:find("crossbow")
       or t:find("spear") or t:find("scythe") or t:find("shield") then return true end
    if t:find("helm") or t:find("cap") or t:find("coif") or t:find("hood")
       or t:find("vest") or t:find("mail") or t:find("plate") or t:find("robe")
       or t:find("pants") or t:find("legs") or t:find("greaves")
       or t:find("boots") or t:find("gloves") or t:find("gauntlets")
       or t:find("bracer") or t:find("armwrap") or t:find("undershirt") then return true end
    if t:find("ring") or t:find("amulet") or t:find("necklace") or t:find("pendant") then return true end
    return false
end

-- Item tooltip: draws a floating tooltip panel showing all procedural item stats
function game.drawItemTooltip(W, H)
    if not game._itemUI.hoveredItem then return end
    local item = game._itemUI.hoveredItem
    local mx, my = game._itemUI.hoveredItemX, game._itemUI.hoveredItemY

    -- Build tooltip lines: { text, color, indent }
    local lines = {}
    local function addLine(text, color, indent)
        table.insert(lines, { text = text, color = color or {0.8, 0.8, 0.8}, indent = indent or 0 })
    end

    -- Item name (colored by rarity)
    local nameColor = game.getItemRarityColor(item)
    addLine(game.getItemDisplayName(item), nameColor)

    -- Quality badge
    if item.quality then
        local qc = game.getItemQualityColor(item) or {0.6, 0.6, 0.6}
        addLine(item.quality:sub(1,1):upper() .. item.quality:sub(2) .. " Quality", qc)
    end

    -- Rarity
    if item.rarity then
        local rc = game.getItemRarityColor(item)
        local rName = (item.rarity or ""):gsub("_", " ")
        rName = rName:gsub("(%a)([%w]*)", function(a, b) return a:upper() .. b end)
        addLine(rName, {rc[1] * 0.8, rc[2] * 0.8, rc[3] * 0.8})
    end

    -- Type
    if item.type then
        local typeName = item.type:gsub("_", " ")
        typeName = typeName:gsub("(%a)([%w]*)", function(a, b) return a:upper() .. b end)
        addLine(typeName, {0.5, 0.5, 0.6})
    end

    -- Separator
    addLine("---", {0.3, 0.3, 0.4})

    -- Base stats from .stats field
    if item.stats then
        local statLabels = {
            damage = "Damage", magicDamage = "Magic Dmg", defense = "Defense",
            magicResist = "Magic Resist", speed = "Atk Speed", critBonus = "Crit Bonus",
            blockChance = "Block Chance", range = "Range", hpBonus = "HP Bonus",
            manaBonus = "Mana Bonus", staminaBonus = "Stamina Bonus",
            lifeSteal = "Life Steal", hpRegen = "HP Regen", manaRegen = "Mana Regen",
            dodgeBonus = "Dodge", armorPen = "Armor Pen",
        }
        local statOrder = { "damage", "magicDamage", "defense", "magicResist", "speed",
            "critBonus", "blockChance", "range", "hpBonus", "manaBonus", "staminaBonus",
            "lifeSteal", "hpRegen", "manaRegen", "dodgeBonus", "armorPen" }
        for _, key in ipairs(statOrder) do
            local val = item.stats[key]
            if val and val ~= 0 then
                local label = statLabels[key] or key
                local valStr
                if key == "critBonus" or key == "blockChance" or key == "lifeSteal"
                   or key == "dodgeBonus" or key == "armorPen" then
                    valStr = string.format("%+.0f%%", val * 100)
                elseif key == "speed" then
                    valStr = string.format("%.2f", val)
                else
                    valStr = string.format("%+d", val)
                end
                local statColor = val > 0 and {0.4, 0.9, 0.4} or {0.9, 0.4, 0.4}
                addLine("  " .. label .. ": " .. valStr, statColor, 4)
            end
        end
    end

    -- Prefix/Suffix affixes
    if item.prefix then
        addLine("Prefix: " .. item.prefix.name, {0.5, 0.8, 1})
        if item.prefix.bonuses then
            for k, v in pairs(item.prefix.bonuses) do
                local valStr = type(v) == "number" and (v < 1 and string.format("+%.0f%%", v * 100) or string.format("+%d", v)) or tostring(v)
                addLine("  " .. k:gsub("_", " ") .. " " .. valStr, {0.4, 0.7, 0.9}, 8)
            end
        end
    end
    if item.suffix then
        addLine("Suffix: " .. item.suffix.name, {0.5, 0.8, 1})
        if item.suffix.bonuses then
            for k, v in pairs(item.suffix.bonuses) do
                local valStr = type(v) == "number" and (v < 1 and string.format("+%.0f%%", v * 100) or string.format("+%d", v)) or tostring(v)
                addLine("  " .. k:gsub("_", " ") .. " " .. valStr, {0.4, 0.7, 0.9}, 8)
            end
        end
    end

    -- Sockets
    if item.sockets and item.sockets > 0 then
        local gems = item.socketedGems or {}
        local filled = #gems
        addLine("Sockets: " .. filled .. "/" .. item.sockets, {0.9, 0.7, 0.2})
        for _, gem in ipairs(gems) do
            local gemName = type(gem) == "table" and (gem.name or gem.type or "gem") or tostring(gem)
            addLine("  [" .. gemName .. "]", {0.6, 0.9, 0.6}, 8)
        end
        for _ = filled + 1, item.sockets do
            addLine("  [ empty ]", {0.4, 0.4, 0.5}, 8)
        end
    end

    -- Augment
    if item.augment then
        local augName = type(item.augment) == "table" and (item.augment.name or "Augmented") or tostring(item.augment)
        addLine("Augment: " .. augName, {1, 0.6, 0.2})
    end

    -- Set bonus
    if item.setId then
        addLine("Set: " .. (item.setId:gsub("_", " "):gsub("(%a)([%w]*)", function(a, b) return a:upper() .. b end)), {0.2, 1, 0.6})
    end

    -- Unique effect
    if item.uniqueEffect then
        local ueName = type(item.uniqueEffect) == "table" and (item.uniqueEffect.name or item.uniqueEffect.type or "Unique") or tostring(item.uniqueEffect)
        addLine("Unique: " .. ueName, {1, 0.85, 0.3})
    end

    -- Weapon special
    if item.weaponSpecial then
        local wsName = type(item.weaponSpecial) == "table" and (item.weaponSpecial.name or "Special") or tostring(item.weaponSpecial)
        addLine("Special: " .. wsName, {1, 0.5, 0.5})
    end

    -- Wand properties
    if item.wandProps then
        addLine("Wand Spells:", {0.6, 0.4, 1})
        if item.wandProps.spells then
            for _, spell in ipairs(item.wandProps.spells) do
                local spName = type(spell) == "table" and (spell.name or "spell") or tostring(spell)
                addLine("  " .. spName, {0.5, 0.4, 0.9}, 8)
            end
        end
    end

    -- Inscription slots
    if item.inscriptionSlots and item.inscriptionSlots > 0 then
        local inscriptions = item.inscriptions or {}
        addLine("Inscriptions: " .. #inscriptions .. "/" .. item.inscriptionSlots, {0.8, 0.6, 1})
    end

    -- Durability
    if item.durability and item.maxDurability then
        local durRatio = item.maxDurability > 0 and (item.durability / item.maxDurability) or 0
        local durColor = durRatio > 0.5 and {0.3, 0.8, 0.3} or (durRatio > 0.25 and {0.8, 0.8, 0.2} or {0.9, 0.2, 0.2})
        addLine("Durability: " .. item.durability .. "/" .. item.maxDurability, durColor)
    end

    -- Calculate tooltip dimensions
    local lineH = 14
    local tooltipW = 220
    local tooltipH = #lines * lineH + 12

    -- Position tooltip near mouse, keep on screen
    local tx = mx + 16
    local ty = my
    if tx + tooltipW > W - 5 then tx = mx - tooltipW - 8 end
    if ty + tooltipH > H - 5 then ty = H - tooltipH - 5 end
    if ty < 5 then ty = 5 end

    -- Draw tooltip background
    love.graphics.setColor(0.04, 0.04, 0.08, 0.95)
    love.graphics.rectangle("fill", tx, ty, tooltipW, tooltipH, 4, 4)
    -- Rarity-colored border
    local borderColor = game.getItemRarityColor(item)
    love.graphics.setColor(borderColor[1], borderColor[2], borderColor[3], 0.6)
    love.graphics.rectangle("line", tx, ty, tooltipW, tooltipH, 4, 4)

    -- Draw lines
    love.graphics.setFont(fonts.npc)
    local ly = ty + 6
    for _, line in ipairs(lines) do
        if line.text == "---" then
            love.graphics.setColor(line.color[1], line.color[2], line.color[3], 0.4)
            love.graphics.line(tx + 8, ly + 5, tx + tooltipW - 8, ly + 5)
        else
            love.graphics.setColor(line.color[1], line.color[2], line.color[3], 1)
            love.graphics.print(line.text, tx + 6 + (line.indent or 0), ly)
        end
        ly = ly + lineH
    end
end

-- Draw loot notification popups (right side, stacked)
function game.drawLootNotifications(W, H)
    if #game._itemUI.lootNotifications == 0 then return end
    love.graphics.setFont(fonts.chat)
    local notifH = 36
    local notifW = 260
    local baseX = W - notifW - 10
    local baseY = H - 60

    for i = #game._itemUI.lootNotifications, 1, -1 do
        local notif = game._itemUI.lootNotifications[i]
        local ny = baseY - (i - 1) * (notifH + 4)
        local alpha = notif.alpha or 1

        -- Background
        local rc = game._itemUI.RARITY_COLORS[notif.item.rarity or "common"] or {0.5, 0.5, 0.5}
        love.graphics.setColor(0.05, 0.05, 0.1, 0.9 * alpha)
        love.graphics.rectangle("fill", baseX, ny, notifW, notifH, 4, 4)
        love.graphics.setColor(rc[1], rc[2], rc[3], 0.7 * alpha)
        love.graphics.rectangle("line", baseX, ny, notifW, notifH, 4, 4)

        -- Source label
        local srcLabel = notif.source == "boss" and "BOSS DROP" or (notif.source == "chest" and "CHEST" or "LOOT")
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(0.6, 0.6, 0.5, 0.7 * alpha)
        love.graphics.print(srcLabel, baseX + 6, ny + 2)

        -- Item name (colored by rarity)
        love.graphics.setFont(fonts.chat)
        love.graphics.setColor(rc[1], rc[2], rc[3], alpha)
        local displayName = game.getItemDisplayName(notif.item)
        if #displayName > 30 then displayName = displayName:sub(1, 28) .. ".." end
        love.graphics.print(displayName, baseX + 6, ny + 16)

        -- Quality badge if present
        if notif.item.quality then
            local qc = game.getItemQualityColor(notif.item) or {0.5, 0.5, 0.5}
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(qc[1], qc[2], qc[3], 0.8 * alpha)
            love.graphics.printf(notif.item.quality, baseX, ny + 2, notifW - 6, "right")
        end
    end
end

-- B1: Equipment panel — shows all 14 equipment slots with durability
function game.drawEquipmentPanel(W, H)
    if not ui.showEquipment then return end

    local panelW = 340
    local panelX = W - panelW - 10
    local panelY = 40
    local panelH = H - 80

    -- Panel background
    love.graphics.setColor(0.05, 0.05, 0.1, 0.92)
    love.graphics.rectangle("fill", panelX, panelY, panelW, panelH, 8, 8)
    love.graphics.setColor(0.3, 0.3, 0.4, 0.6)
    love.graphics.rectangle("line", panelX, panelY, panelW, panelH, 8, 8)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.9, 0.85, 0.4, 1)
    love.graphics.printf("Equipment", panelX, panelY + 8, panelW, "center")

    -- Equipment slots (18 total, 2 columns of 9)
    local slotNames = {
        "head", "chest", "undershirt", "arms", "hands", "legs", "feet", "main_hand", "off_hand",
        "ring1", "ring2", "ring3", "ring4", "ring5", "ring6", "necklace"
    }
    local slotLabels = {
        head = "Head", chest = "Chest", undershirt = "Undershirt", arms = "Arms",
        hands = "Hands", legs = "Legs", feet = "Feet",
        main_hand = "Main Hand", off_hand = "Off Hand",
        ring1 = "Ring 1", ring2 = "Ring 2", ring3 = "Ring 3",
        ring4 = "Ring 4", ring5 = "Ring 5", ring6 = "Ring 6",
        necklace = "Necklace"
    }

    local eq = (rpg and rpg.equipment) or {}
    local allItems = mmoInventory.items or {}
    local colW = (panelW - 20) / 2
    local startY = panelY + 42 - ui.equipmentScroll
    local slotH = 60
    equipSlotButtons = {}

    -- Check for low durability warning
    local hasLowDurability = false

    local slotsPerCol = math.ceil(#slotNames / 2)
    for idx, slot in ipairs(slotNames) do
        local col = (idx <= slotsPerCol) and 0 or 1
        local row = (idx <= slotsPerCol) and (idx - 1) or (idx - slotsPerCol - 1)
        local sx = panelX + 10 + col * colW
        local sy = startY + row * slotH

        -- Skip if off-screen
        if sy + slotH > panelY + 35 and sy < panelY + panelH then
            -- Slot background
            love.graphics.setColor(0.1, 0.12, 0.18, 0.8)
            love.graphics.rectangle("fill", sx, sy, colW - 6, slotH - 4, 4, 4)

            -- Slot label
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
            love.graphics.print(slotLabels[slot] or slot, sx + 4, sy + 2)

            -- Item name or empty
            local itemId = eq[slot]
            local itemName = "Empty"
            local itemObj = nil
            if itemId then
                for _, it in ipairs(allItems) do
                    if it.id == itemId then itemObj = it; itemName = game.getItemDisplayName(it); break end
                end
                if not itemObj then itemName = "Equipped" end
            end

            love.graphics.setFont(fonts.chat)
            if itemObj then
                -- Color by rarity
                local rc = game.getItemRarityColor(itemObj)
                love.graphics.setColor(rc[1], rc[2], rc[3], 1)
                -- Truncate long names
                if #itemName > 18 then itemName = itemName:sub(1, 16) .. ".." end
            elseif itemId then
                love.graphics.setColor(0.85, 0.85, 0.7, 1)
            else
                love.graphics.setColor(0.4, 0.4, 0.5, 0.5)
            end
            love.graphics.print(itemName, sx + 4, sy + 16)

            -- Socket indicator dots (small colored circles)
            if itemObj and itemObj.sockets and itemObj.sockets > 0 then
                local gems = itemObj.socketedGems or {}
                for si = 1, itemObj.sockets do
                    local dotX = sx + colW - 12 - (itemObj.sockets - si) * 8
                    local dotY = sy + 6
                    if si <= #gems then
                        love.graphics.setColor(0.3, 0.9, 0.3, 0.9) -- filled
                    else
                        love.graphics.setColor(0.3, 0.3, 0.4, 0.6) -- empty
                    end
                    love.graphics.circle("fill", dotX, dotY, 3)
                end
            end

            -- Hover detection for tooltip
            if itemObj then
                local emx, emy = love.mouse.getPosition()
                if emx >= sx and emx <= sx + colW - 6 and emy >= sy and emy <= sy + slotH - 4 then
                    game._itemUI.hoveredItem = itemObj
                    game._itemUI.hoveredItemX = emx
                    game._itemUI.hoveredItemY = emy
                end
            end

            -- Durability bar
            local dur = durabilityData[slot]
            if dur and dur.max and dur.max > 0 then
                local ratio = dur.current / dur.max
                local barW = colW - 12
                local barH = 6
                local barX = sx + 4
                local barY = sy + 32

                -- Background
                love.graphics.setColor(0.15, 0.15, 0.2, 0.8)
                love.graphics.rectangle("fill", barX, barY, barW, barH, 2, 2)

                -- Fill color based on ratio
                if ratio > 0.5 then
                    love.graphics.setColor(0.2, 0.8, 0.2, 0.9)
                elseif ratio > 0.25 then
                    love.graphics.setColor(0.8, 0.8, 0.2, 0.9)
                else
                    love.graphics.setColor(0.9, 0.2, 0.2, 0.9)
                    hasLowDurability = true
                end
                love.graphics.rectangle("fill", barX, barY, barW * ratio, barH, 2, 2)

                -- Durability text
                love.graphics.setFont(fonts.npc)
                love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
                love.graphics.print(dur.current .. "/" .. dur.max, sx + 4, sy + 40)
            end

            -- Buttons for equipped items
            if itemId then
                local btnY = sy + slotH - 18
                -- Remove button
                local rmX = sx + colW - 80
                love.graphics.setColor(0.4, 0.15, 0.15, 0.8)
                love.graphics.rectangle("fill", rmX, btnY, 34, 14, 3, 3)
                love.graphics.setFont(fonts.npc)
                love.graphics.setColor(1, 0.6, 0.6, 0.9)
                love.graphics.printf("Rm", rmX, btnY + 1, 34, "center")
                table.insert(equipSlotButtons, { slot = slot, action = "remove", x = rmX, y = btnY, w = 34, h = 14 })

                -- Repair button (if durability < max)
                if dur and dur.current < dur.max then
                    local rpX = sx + colW - 42
                    love.graphics.setColor(0.15, 0.3, 0.4, 0.8)
                    love.graphics.rectangle("fill", rpX, btnY, 34, 14, 3, 3)
                    love.graphics.setColor(0.6, 0.9, 1, 0.9)
                    love.graphics.printf("Fix", rpX, btnY + 1, 34, "center")
                    table.insert(equipSlotButtons, { slot = slot, action = "repair", x = rpX, y = btnY, w = 34, h = 14 })
                end
            end
        end
    end

    -- Dual-wield combo display
    if rpg and rpg.dualWieldCombo then
        local comboY = panelY + panelH - 80
        love.graphics.setColor(0.08, 0.08, 0.15, 0.9)
        love.graphics.rectangle("fill", panelX + 5, comboY - 4, panelW - 10, 60, 4, 4)
        love.graphics.setColor(0.4, 0.35, 0.2, 0.6)
        love.graphics.rectangle("line", panelX + 5, comboY - 4, panelW - 10, 60, 4, 4)

        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(1, 0.85, 0.3, 1)
        love.graphics.printf(rpg.dualWieldCombo.name or "Combo", panelX, comboY, panelW, "center")
        love.graphics.setColor(0.7, 0.8, 0.7, 0.8)
        love.graphics.printf(rpg.dualWieldCombo.description or "", panelX + 10, comboY + 14, panelW - 20, "center")
        -- Show unlocked skills
        if rpg.dualWieldCombo.skills then
            for i, skill in ipairs(rpg.dualWieldCombo.skills) do
                love.graphics.setColor(0.5, 0.8, 1, 0.9)
                love.graphics.print("  " .. skill, panelX + 20, comboY + 32 + (i-1)*12)
            end
        end
    end

    -- Low durability warning (pulsing red)
    if hasLowDurability then
        local pulse = 0.5 + 0.5 * math.sin(love.timer.getTime() * 4)
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(1, 0.2, 0.2, pulse)
        love.graphics.printf("! Low Durability !", panelX, panelY + panelH - 20, panelW, "center")
    end
end

-- B2: Enhanced items tab with filters and equip/use buttons
function game.drawItemsTab(px, py, pw, ph)
    love.graphics.setFont(fonts.chat)
    local items = mmoInventory.items or {}
    local placeableTypes = { forge = true, iron_anvil = true, storage_chest = true, wall = true, door = true, raft = true, bridge = true }

    -- Equipment item types (weapons + armor)
    local equipmentTypes = {
        iron_sword = true, iron_axe_weapon = true, bronze_sword = true, dagger = true,
        iron_mace = true, staff = true, bow = true, crossbow = true, wand = true,
        iron_shield = true, bronze_shield = true, tower_shield = true,
        leather_cap = true, iron_helm = true, chain_coif = true, plate_helm = true,
        leather_vest = true, chain_mail = true, iron_plate = true, robe = true,
        leather_pants = true, chain_legs = true, plate_legs = true,
        leather_boots = true, iron_boots = true, plate_boots = true,
        leather_gloves = true, iron_gauntlets = true, plate_gauntlets = true,
        ring = true, amulet = true, cape = true, belt = true, earring = true, trinket = true,
    }
    -- Consumable item types (food, potions, scrolls)
    local consumableTypes = {}
    local foodKeys = {
        "cooked_fish", "bread", "stew", "mushroom", "shellfish", "seaweed",
        "herb_tea", "grilled_meat", "berry_jam",
        "potion_health", "potion_mana", "potion_strength", "potion_agility",
        "potion_intellect", "potion_resistance", "potion_speed",
        "elixir_vigor", "elixir_fortitude", "antidote",
        "ale", "mead", "wine", "spirits", "fortified_ale", "battle_brew",
        "scroll_of_protection", "scroll_of_strength", "scroll_of_haste",
    }
    for _, k in ipairs(foodKeys) do consumableTypes[k] = true end

    -- Filter subtabs
    local filters = { "all", "equipment", "consumable", "material" }
    local fW = pw / #filters
    love.graphics.setFont(fonts.npc)
    for i, f in ipairs(filters) do
        local fx = px + (i - 1) * fW
        if ui.inventoryItemFilter == f then
            love.graphics.setColor(0.2, 0.25, 0.35, 0.9)
        else
            love.graphics.setColor(0.1, 0.12, 0.18, 0.7)
        end
        love.graphics.rectangle("fill", fx + 2, py, fW - 4, 20, 3, 3)
        love.graphics.setColor(0.8, 0.8, 0.9, ui.inventoryItemFilter == f and 1 or 0.5)
        love.graphics.printf(f:sub(1,1):upper() .. f:sub(2), fx + 2, py + 3, fW - 4, "center")
    end

    local contentY = py + 26
    love.graphics.setFont(fonts.chat)
    inventoryItemButtons = {}

    -- Filter items
    local filtered = {}
    for _, item in ipairs(items) do
        local t = item.type or ""
        local isEquip = equipmentTypes[t] or game.isEquipmentItem(item)
        local isConsumable = consumableTypes[t] or (item.consumableType ~= nil)
        local show = false
        if ui.inventoryItemFilter == "all" then
            show = true
        elseif ui.inventoryItemFilter == "equipment" then
            show = isEquip
        elseif ui.inventoryItemFilter == "consumable" then
            show = isConsumable
        elseif ui.inventoryItemFilter == "material" then
            show = not isEquip and not isConsumable and not placeableTypes[t]
        end
        if show then table.insert(filtered, item) end
    end

    if #filtered == 0 then
        love.graphics.setColor(0.5, 0.5, 0.6, 0.5)
        love.graphics.printf("No items", px, contentY + 10, pw, "center")
        return
    end

    for i, item in ipairs(filtered) do
        local iy = contentY + (i - 1) * 32
        if iy + 32 > py + ph then break end
        local t = item.type or ""

        local isEquip = equipmentTypes[t] or game.isEquipmentItem(item)
        local isConsumable = consumableTypes[t] or (item.consumableType ~= nil)

        -- Row background (rarity-tinted for equipment)
        if isEquip then
            local rc = game.getItemRarityColor(item)
            love.graphics.setColor(rc[1] * 0.15, rc[2] * 0.15, rc[3] * 0.2 + 0.05, 0.8)
        elseif isConsumable then
            love.graphics.setColor(0.12, 0.18, 0.12, 0.8)
        elseif placeableTypes[t] then
            love.graphics.setColor(0.12, 0.18, 0.12, 0.8)
        else
            love.graphics.setColor(0.15, 0.15, 0.2, 0.7)
        end
        love.graphics.rectangle("fill", px + 8, iy, pw - 16, 30, 4, 4)

        -- Item name (colored by rarity for equipment)
        local displayName = game.getItemDisplayName(item)
        if #displayName > 26 then displayName = displayName:sub(1, 24) .. ".." end
        if isEquip or item.rarity then
            local rc = game.getItemRarityColor(item)
            love.graphics.setColor(rc[1], rc[2], rc[3], 1)
        elseif isConsumable and item.quality then
            local qc = game.getItemQualityColor(item) or {0.7, 0.9, 0.7}
            love.graphics.setColor(qc[1], qc[2], qc[3], 1)
        else
            love.graphics.setColor(0.85, 0.85, 0.8, 0.9)
        end
        love.graphics.print(displayName, px + 14, iy + 3)

        -- Socket dots + quality badge on same row
        if item.sockets and item.sockets > 0 then
            local gems = item.socketedGems or {}
            love.graphics.setFont(fonts.npc)
            for si = 1, math.min(item.sockets, 4) do
                local dotX = px + pw - 72 - (item.sockets - si) * 7
                local dotY = iy + 7
                if si <= #gems then
                    love.graphics.setColor(0.3, 0.9, 0.3, 0.9)
                else
                    love.graphics.setColor(0.3, 0.3, 0.4, 0.6)
                end
                love.graphics.circle("fill", dotX, dotY, 2.5)
            end
            love.graphics.setFont(fonts.chat)
        end

        -- Quantity if > 1
        if item.quantity and item.quantity > 1 then
            love.graphics.setColor(0.6, 0.6, 0.5, 0.7)
            love.graphics.print("x" .. item.quantity, px + 14, iy + 17)
        end

        -- Hover detection for tooltip
        local imx, imy = love.mouse.getPosition()
        if imx >= px + 8 and imx <= px + pw - 16 and imy >= iy and imy <= iy + 30 then
            game._itemUI.hoveredItem = item
            game._itemUI.hoveredItemX = imx
            game._itemUI.hoveredItemY = imy
        end

        -- Action buttons
        local btnX = px + pw - 62
        if isEquip then
            -- Equip button
            love.graphics.setColor(0.2, 0.3, 0.5, 0.8)
            love.graphics.rectangle("fill", btnX, iy + 4, 46, 22, 3, 3)
            love.graphics.setColor(0.6, 0.8, 1, 0.9)
            love.graphics.setFont(fonts.npc)
            love.graphics.printf("Equip", btnX, iy + 8, 46, "center")
            love.graphics.setFont(fonts.chat)
            table.insert(inventoryItemButtons, { item = item, action = "equip", x = btnX, y = iy + 4, w = 46, h = 22 })
        elseif isConsumable then
            -- Use button
            love.graphics.setColor(0.2, 0.4, 0.2, 0.8)
            love.graphics.rectangle("fill", btnX, iy + 4, 46, 22, 3, 3)
            love.graphics.setColor(0.6, 1, 0.6, 0.9)
            love.graphics.setFont(fonts.npc)
            love.graphics.printf("Use", btnX, iy + 8, 46, "center")
            love.graphics.setFont(fonts.chat)
            table.insert(inventoryItemButtons, { item = item, action = "use", x = btnX, y = iy + 4, w = 46, h = 22 })
        elseif placeableTypes[t] then
            -- Place button
            love.graphics.setColor(0.3, 0.7, 0.3, 0.8)
            love.graphics.setFont(fonts.npc)
            love.graphics.printf("Place", btnX, iy + 8, 46, "center")
            love.graphics.setFont(fonts.chat)
            table.insert(inventoryItemButtons, { item = item, action = "place", x = btnX, y = iy + 4, w = 46, h = 22 })
        end
    end
end

-- B3: Enhanced crafting tab — uses server-driven recipes with station filters
function game.drawCraftingTab(px, py, pw, ph)
    -- Info: inventory crafting only shows basic (no-station) recipes
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("Basic Crafting  (forge/anvil/etc require stations)", px + 10, py + 2, pw - 20, "center")

    local ry = py + 22
    love.graphics.setFont(fonts.chat)
    craftingButtons = {}

    -- Use server recipes if available, fall back to hardcoded
    local recipeList = recipes
    if not recipeList or #recipeList == 0 then
        recipeList = {
            { id = "wooden_sword", name = "Wooden Sword", station = "none", materials = { { resource = "wood", amount = 8 } } },
            { id = "wooden_shield", name = "Wooden Shield", station = "none", materials = { { resource = "wood", amount = 6 } } },
            { id = "wooden_wand", name = "Wooden Wand", station = "none", materials = { { resource = "wood", amount = 5 } } },
            { id = "wooden_bow", name = "Wooden Bow", station = "none", materials = { { resource = "wood", amount = 10 } } },
            { id = "forge", name = "Forge", station = "none", materials = { { resource = "wood", amount = 20 }, { resource = "stone", amount = 15 } } },
            { id = "storage_chest", name = "Storage Chest", station = "none", materials = { { resource = "wood", amount = 10 } } },
            { id = "wall", name = "Wall", station = "none", materials = { { resource = "wood", amount = 5 } } },
        }
    end

    local shown = 0
    for _, recipe in ipairs(recipeList) do
        local station = recipe.station or recipe.workstation or "none"
        -- Only show basic (no station required) recipes in inventory crafting
        if station == "none" or station == "basic" then
            local itemY = ry + shown * 48
            if itemY + 48 > py + ph then break end

            -- Recipe card
            love.graphics.setColor(0.1, 0.12, 0.18, 0.8)
            love.graphics.rectangle("fill", px + 8, itemY, pw - 16, 44, 4, 4)

            -- Name
            love.graphics.setColor(0.9, 0.85, 0.6, 1)
            love.graphics.print(recipe.name or recipe.id or "?", px + 14, itemY + 3)

            -- Station badge
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.4, 0.5, 0.6, 0.7)
            love.graphics.print("[" .. station .. "]", px + 14, itemY + 18)

            -- Material costs with have/need coloring
            -- Normalize materials: server sends {wood=8, stone=15}, fallback uses {{resource="wood", amount=8}}
            local rawMats = recipe.materials or recipe.cost or {}
            local matList = {}
            if rawMats[1] then
                -- Array format
                matList = rawMats
            else
                -- Object format from server: {wood=8, stone=15}
                for res, amt in pairs(rawMats) do
                    if type(amt) == "number" then
                        table.insert(matList, { resource = res, amount = amt })
                    end
                end
            end

            local matStr = ""
            for mi, mat in ipairs(matList) do
                local resKey = mat.resource or mat.type or "?"
                local resName = resKey:gsub("_", " ")
                local need = mat.amount or mat.count or 1
                local have = mmoInventory[resKey] or 0
                if mi > 1 then matStr = matStr .. ", " end
                if have >= need then
                    matStr = matStr .. need .. " " .. resName
                else
                    matStr = matStr .. need .. " " .. resName .. " (" .. have .. ")"
                end
            end
            love.graphics.setColor(0.6, 0.6, 0.5, 0.7)
            love.graphics.print(matStr, px + 80, itemY + 18)
            love.graphics.setFont(fonts.chat)

            -- Can afford check
            local canAfford = true
            for _, mat in ipairs(matList) do
                local resKey = mat.resource or mat.type or ""
                local have = mmoInventory[resKey] or 0
                if have < (mat.amount or mat.count or 1) then canAfford = false; break end
            end

            -- Craft button
            local btnX = px + pw - 65
            if canAfford then
                love.graphics.setColor(0.2, 0.4, 0.2, 0.8)
            else
                love.graphics.setColor(0.3, 0.2, 0.2, 0.5)
            end
            love.graphics.rectangle("fill", btnX, itemY + 8, 50, 28, 4, 4)
            if canAfford then
                love.graphics.setColor(0.7, 1, 0.7, 0.9)
            else
                love.graphics.setColor(0.5, 0.4, 0.4, 0.5)
            end
            love.graphics.setFont(fonts.npc)
            love.graphics.printf("Craft", btnX, itemY + 15, 50, "center")
            love.graphics.setFont(fonts.chat)
            table.insert(craftingButtons, { recipe = recipe, x = btnX, y = itemY + 8, w = 50, h = 28, canAfford = canAfford })

            shown = shown + 1
        end
    end

    if shown == 0 then
        love.graphics.setColor(0.5, 0.5, 0.6, 0.5)
        love.graphics.printf("No recipes for this station", px, ry + 10, pw, "center")
    end
end

function game.drawCompass(W, H)
    local me = players[myId]
    if not me then return end

    local cx = W - 70
    local cy = 80
    local radius = 38

    -- Background circle
    love.graphics.setColor(0, 0, 0, 0.55)
    love.graphics.circle("fill", cx, cy, radius + 4)
    love.graphics.setColor(0.3, 0.3, 0.4, 0.5)
    love.graphics.setLineWidth(2)
    love.graphics.circle("line", cx, cy, radius + 4)
    love.graphics.setLineWidth(1)

    -- Cardinal directions
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.5)
    love.graphics.printf("N", cx - 6, cy - radius - 1, 12, "center")
    love.graphics.printf("S", cx - 6, cy + radius - 11, 12, "center")
    love.graphics.printf("W", cx - radius - 2, cy - 6, 12, "center")
    love.graphics.printf("E", cx + radius - 9, cy - 6, 12, "center")

    -- Helper: draw a directional arrow on the compass ring
    local function drawCompassArrow(targetX, targetY, color, label)
        local dx = targetX - me.x
        local dy = targetY - me.y
        local dist = math.sqrt(dx * dx + dy * dy)
        if dist < 1 then return end

        local angle = math.atan2(dy, dx)
        local arrowDist = radius - 6
        local ax = cx + math.cos(angle) * arrowDist
        local ay = cy + math.sin(angle) * arrowDist

        -- Arrow triangle
        local arrowSize = 7
        local tipX = cx + math.cos(angle) * (arrowDist + arrowSize)
        local tipY = cy + math.sin(angle) * (arrowDist + arrowSize)
        local perpAngle = angle + math.pi / 2
        local baseX1 = ax + math.cos(perpAngle) * 4
        local baseY1 = ay + math.sin(perpAngle) * 4
        local baseX2 = ax - math.cos(perpAngle) * 4
        local baseY2 = ay - math.sin(perpAngle) * 4

        love.graphics.setColor(color[1], color[2], color[3], 0.9)
        love.graphics.polygon("fill", tipX, tipY, baseX1, baseY1, baseX2, baseY2)

        -- Distance text
        local distText
        if dist > 10000 then
            distText = string.format("%.1fk", dist / 1000)
        else
            distText = tostring(math.floor(dist))
        end
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(color[1], color[2], color[3], 0.7)
        local labelX = cx + math.cos(angle) * (radius + 16)
        local labelY = cy + math.sin(angle) * (radius + 16)
        love.graphics.printf(label .. "\n" .. distText, labelX - 30, labelY - 10, 60, "center")
    end

    -- Town arrow (blue)
    if townPosition then
        drawCompassArrow(townPosition.x, townPosition.y, { 0.3, 0.6, 1.0 }, "Town")
    end

    -- Plot arrow (green) — only if player has a plot
    if overworld.myPlotId then
        for _, plot in pairs(overworld.plots) do
            if plot.id == overworld.myPlotId then
                local plotCenterX = plot.x + (plot.width or 512) / 2
                local plotCenterY = plot.y + (plot.height or 512) / 2
                drawCompassArrow(plotCenterX, plotCenterY, { 0.3, 0.9, 0.3 }, "Plot")
                break
            end
        end
    end
end

function game.drawWorldMap(W, H)
    -- Full-screen world map overlay
    love.graphics.setColor(0, 0, 0, 0.85)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Title
    love.graphics.setFont(fonts.title)
    if overworld.isHollowEarth then
        love.graphics.setColor(0.6, 0.4, 0.9, fadeIn)
        love.graphics.printf("Hollow Earth Map", 0, 10, W, "center")
    else
        love.graphics.setColor(0.9, 0.8, 0.3, fadeIn)
        love.graphics.printf("World Map", 0, 10, W, "center")
    end

    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.5, 0.5, 0.6, fadeIn * 0.6)
    love.graphics.printf("M/Esc: Close | Scroll/+/-: Zoom (" .. string.format("%.0f", mapZoom) .. "x)", 0, 34, W, "center")

    -- Map viewport
    local mapPad = 20
    local mapTop = 50
    local vpW = W - mapPad * 2
    local vpH = H - mapTop - 30

    -- World dimensions
    local worldW = (zone and zone.width) or 1024000
    local worldH = (zone and zone.height) or 1280000

    -- Base scale (fit whole world)
    local baseScaleX = vpW / worldW
    local baseScaleY = vpH / worldH
    local baseScale = math.min(baseScaleX, baseScaleY)
    local scale = baseScale * mapZoom

    -- Center on player when zoomed
    local me = players[myId]
    local centerWorldX = worldW / 2
    local centerWorldY = worldH / 2
    if me then
        centerWorldX = me.x
        centerWorldY = me.y
    end

    -- Map offset: center the view on player
    local mapCenterX = mapPad + vpW / 2
    local mapCenterY = mapTop + vpH / 2
    local mapX = mapCenterX - centerWorldX * scale
    local mapY = mapCenterY - centerWorldY * scale

    -- Clip to viewport
    love.graphics.setScissor(mapPad, mapTop, vpW, vpH)

    -- Render loaded chunks as colored tiles (no fog for unloaded)
    local chunkPxW = overworld.chunkSize * scale
    local chunkPxH = overworld.chunkSize * scale
    local minPx = math.max(1, chunkPxW)
    for _, chunk in pairs(overworld.chunks) do
        if chunk.biomeColor then
            local bc = chunk.biomeColor
            love.graphics.setColor(bc.r / 255, bc.g / 255, bc.b / 255, 0.9)
            local px = mapX + chunk.cx * overworld.chunkSize * scale
            local py = mapY + chunk.cy * overworld.chunkSize * scale
            -- Only draw if visible in viewport
            if px + minPx > mapPad and px < mapPad + vpW and py + minPx > mapTop and py < mapTop + vpH then
                love.graphics.rectangle("fill", px, py, math.max(minPx, chunkPxW + 0.5), math.max(minPx, chunkPxH + 0.5))
            end
        end
    end

    -- Draw rivers on world map
    if overworld.rivers and #overworld.rivers > 0 then
        love.graphics.setColor(0.16, 0.31, 0.63, 0.85)
        love.graphics.setLineWidth(math.max(1, 2 * mapZoom * 0.1))
        local tileWorldPx = 32  -- TILE_SIZE
        local tilesPerChunk = 16
        for _, river in ipairs(overworld.rivers) do
            local startWorldY = river.startCY * overworld.chunkSize
            local endWorldY = river.endCY * overworld.chunkSize
            local stepPx = math.max(overworld.chunkSize, overworld.chunkSize / (mapZoom * 0.1 + 1))
            local prevPx, prevPy = nil, nil
            for wy = startWorldY, endWorldY, stepPx do
                local worldTileY = wy / tileWorldPx
                local riverTileX = river.baseX * tilesPerChunk + math.sin(worldTileY * river.frequency + river.phase) * river.amplitude * tilesPerChunk
                local rwx = riverTileX * tileWorldPx
                local px = mapX + rwx * scale
                local py = mapY + wy * scale
                if prevPx and prevPy then
                    love.graphics.line(prevPx, prevPy, px, py)
                end
                prevPx = px
                prevPy = py
            end
        end
        love.graphics.setLineWidth(1)
    end

    -- Draw plots
    for _, plot in pairs(overworld.plots) do
        local px = mapX + plot.x * scale
        local py = mapY + plot.y * scale
        local pw = (plot.width or 512) * scale
        local ph = (plot.height or 512) * scale
        local isOwn = (overworld.myPlotId and plot.id == overworld.myPlotId)

        if isOwn then
            love.graphics.setColor(0.2, 0.9, 0.2, 0.6)
        else
            love.graphics.setColor(0.3, 0.5, 0.9, 0.4)
        end
        love.graphics.rectangle("fill", px, py, math.max(3, pw), math.max(3, ph))

        if isOwn then
            love.graphics.setColor(0.3, 1, 0.3, 0.9)
        else
            love.graphics.setColor(0.4, 0.6, 1, 0.7)
        end
        love.graphics.setLineWidth(2)
        love.graphics.rectangle("line", px, py, math.max(3, pw), math.max(3, ph))
        love.graphics.setLineWidth(1)

        -- Plot owner label (only if large enough on screen)
        if pw > 20 then
            love.graphics.setFont(fonts.npc)
            if isOwn then
                love.graphics.setColor(0.3, 1, 0.3, 0.9)
            else
                love.graphics.setColor(0.5, 0.7, 1, 0.7)
            end
            love.graphics.printf(plot.ownerName or "?", px, py + math.max(1, ph / 2 - 5), math.max(20, pw), "center")
        end
    end

    -- Town marker
    if townPosition then
        local tx = mapX + townPosition.x * scale
        local ty = mapY + townPosition.y * scale
        local iconSize = math.max(6, 4 + mapZoom * 0.5)
        love.graphics.setColor(0.9, 0.8, 0.2, 0.9)
        love.graphics.polygon("fill", tx, ty - iconSize, tx + iconSize * 0.75, ty, tx, ty + iconSize, tx - iconSize * 0.75, ty)
        love.graphics.setColor(1, 0.9, 0.3, 1)
        love.graphics.setFont(fonts.npc)
        love.graphics.printf("The Holy Dominion", tx - 50, ty + iconSize + 2, 100, "center")
    end

    -- Player position (pulsing white dot)
    if me then
        local px = mapX + me.x * scale
        local py = mapY + me.y * scale
        local pulse = 0.7 + math.sin(love.timer.getTime() * 4) * 0.3
        local dotSize = math.max(3, 2 + mapZoom * 0.3)
        love.graphics.setColor(1, 1, 1, pulse)
        love.graphics.circle("fill", px, py, dotSize)
        love.graphics.setColor(1, 1, 1, 0.5)
        love.graphics.circle("line", px, py, dotSize + 3)
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(1, 1, 1, 0.8)
        love.graphics.printf("You", px - 20, py + dotSize + 4, 40, "center")
    end

    love.graphics.setScissor()

    -- Viewport border
    love.graphics.setColor(0.3, 0.3, 0.4, 0.6)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", mapPad, mapTop, vpW, vpH)
    love.graphics.setLineWidth(1)

    -- Legend bar at bottom
    local legY = mapTop + vpH + 5
    love.graphics.setFont(fonts.npc)

    love.graphics.setColor(0.9, 0.8, 0.2, 0.8)
    love.graphics.rectangle("fill", mapPad, legY, 8, 8)
    love.graphics.setColor(0.7, 0.7, 0.7, 0.7)
    love.graphics.print("Town", mapPad + 12, legY - 1)

    love.graphics.setColor(0.2, 0.9, 0.2, 0.8)
    love.graphics.rectangle("fill", mapPad + 60, legY, 8, 8)
    love.graphics.setColor(0.7, 0.7, 0.7, 0.7)
    love.graphics.print("Your Plot", mapPad + 72, legY - 1)

    love.graphics.setColor(0.3, 0.5, 0.9, 0.8)
    love.graphics.rectangle("fill", mapPad + 140, legY, 8, 8)
    love.graphics.setColor(0.7, 0.7, 0.7, 0.7)
    love.graphics.print("Other Plots", mapPad + 152, legY - 1)

    love.graphics.setColor(0.16, 0.31, 0.63, 0.8)
    love.graphics.rectangle("fill", mapPad + 224, legY, 8, 8)
    love.graphics.setColor(0.7, 0.7, 0.7, 0.7)
    love.graphics.print("Rivers", mapPad + 236, legY - 1)

    love.graphics.setColor(1, 1, 1, 0.8)
    love.graphics.circle("fill", mapPad + 284, legY + 4, 3)
    love.graphics.setColor(0.7, 0.7, 0.7, 0.7)
    love.graphics.print("You", mapPad + 290, legY - 1)
end

function game.drawZoneList(W, H)
    -- Semi-transparent overlay
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.9, 0.8, 0.3, fadeIn)
    love.graphics.printf("Zone Map", 0, 40, W, "center")

    love.graphics.setFont(fonts.zone)
    local startY = 90
    local listW = 350
    local itemH = 40
    local listX = (W - listW) / 2

    for i, z in ipairs(zoneList) do
        local y = startY + (i - 1) * (itemH + 6)
        local isCurrent = zone and zone.id == z.id

        if isCurrent then
            love.graphics.setColor(0.15, 0.3, 0.15, 0.9)
        else
            love.graphics.setColor(0.1, 0.1, 0.18, 0.85)
        end
        love.graphics.rectangle("fill", listX, y, listW, itemH, 6, 6)

        if isCurrent then
            love.graphics.setColor(0.3, 0.7, 0.3, 0.7)
        else
            love.graphics.setColor(0.3, 0.3, 0.4, 0.5)
        end
        love.graphics.rectangle("line", listX, y, listW, itemH, 6, 6)

        -- Zone name
        love.graphics.setColor(1, 1, 1, fadeIn)
        love.graphics.print(z.name, listX + 12, y + 4)

        -- Type and players
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(0.6, 0.6, 0.7, fadeIn * 0.7)
        love.graphics.print(z.type .. " | " .. (z.playerCount or 0) .. " players", listX + 12, y + 22)

        -- Badges
        if z.pvpEnabled then
            love.graphics.setColor(0.9, 0.3, 0.3, fadeIn * 0.7)
            love.graphics.print("PVP", listX + listW - 35, y + 4)
        end

        love.graphics.setFont(fonts.zone)
    end

    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(0.5, 0.5, 0.6, fadeIn * 0.6)
    love.graphics.printf("Press M or Escape to close", 0, startY + #zoneList * (itemH + 6) + 15, W, "center")
end

function game.hexToRGB(hex)
    if not hex or type(hex) ~= "string" then return 0.8, 0.8, 0.8 end
    hex = hex:gsub("#", "")
    if #hex ~= 6 then return 0.8, 0.8, 0.8 end
    local r = tonumber(hex:sub(1, 2), 16) / 255
    local g = tonumber(hex:sub(3, 4), 16) / 255
    local b = tonumber(hex:sub(5, 6), 16) / 255
    return r or 0.8, g or 0.8, b or 0.8
end

function game.keypressed(key)
    -- NPC Dialogue keyboard: number keys select choices
    if game._npcDialogue.show then
        local num = tonumber(key)
        if num and num >= 1 and num <= #game._npcDialogue.choices then
            client:emit("npc_dialogue_choice", { choiceIndex = game._npcDialogue.choices[num].index })
            return
        end
        if key == "escape" then
            game._npcDialogue.show = false
            return
        end
    end

    -- Escape during zone loading OR error state returns to server select
    if not zone and key == "escape" then
        game._loadError = nil
        game._zoneLoadTimeout = nil
        _G.switchScene("shards")
        return
    end

    -- Permadeath death screen: Continue goes to character select
    if permadeath.showDeathScreen then
        if key == "return" or key == "kpenter" or key == "escape" then
            permadeath.showDeathScreen = false
            permadeath.deathHero = nil
            _G.switchScene("character_select")
        end
        return
    end

    -- Permadeath Hall of Heroes panel
    if permadeath.showHallOfHeroes then
        if key == "escape" or key == "h" then
            permadeath.showHallOfHeroes = false
        end
        return
    end

    -- Permadeath: while downed, only allow revive-related keys (E key is handled below)
    if permadeath.isDowned then
        return -- block all input while downed
    end

    -- Crafting minigame: space to click
    if game._minigame.active and not game._minigame.result then
        if key == "space" then
            local clickPos = math.floor(game._minigame.barPos)
            if clickPos >= game._minigame.windowStart and clickPos <= game._minigame.windowEnd then
                local mid = (game._minigame.windowStart + game._minigame.windowEnd) / 2
                local dist = math.abs(clickPos - mid)
                local range = (game._minigame.windowEnd - game._minigame.windowStart) / 2
                game._minigame.result = dist < range * 0.3 and "perfect" or "good"
            else
                game._minigame.result = "miss"
            end
            game._minigame.resultTimer = 1.5
            if client then client:emit("craft_minigame_result", { clickPos = clickPos }) end
            return
        end
    end

    -- Guild chat/create input handling
    if ui.showGuild then
        if game._guild.chatActive then
            if key == "return" or key == "kpenter" then
                if #game._guild.chatInput > 0 and client then
                    client:emit("guild_chat", { message = game._guild.chatInput })
                    game._guild.chatInput = ""
                end
                return
            elseif key == "backspace" then
                game._guild.chatInput = game._guild.chatInput:sub(1, -2)
                return
            elseif key == "escape" then
                game._guild.chatActive = false
                return
            end
        end
        if game._guild.createActive then
            if key == "return" or key == "kpenter" then
                game._guild.createActive = false
                return
            elseif key == "backspace" then
                game._guild.createName = game._guild.createName:sub(1, -2)
                return
            elseif key == "escape" then
                game._guild.createActive = false
                return
            end
        end
    end

    -- Dismiss context menu on Escape (highest priority)
    if ui.contextMenu and key == "escape" then
        ui.contextMenu = nil
        return
    end

    -- Close loot panel on Escape
    if (corpseLootPanel or containerLootPanel) and key == "escape" then
        corpseLootPanel = nil
        containerLootPanel = nil
        return
    end

    -- Pack reveal: block input (click advances/closes, Escape also closes)
    if packReveal then
        if key == "escape" then
            packReveal = nil
        end
        return
    end

    -- Trade panel: Escape cancels game._trade
    if game._trade.show then
        if key == "escape" then
            if game._trade.tradeId and client then
                client:emit("trade_cancel", { tradeId = game._trade.tradeId })
            end
            resetTradeState()
        elseif key == "backspace" and game._trade.coinInputActive then
            game._trade.coinInput = game._trade.coinInput:sub(1, -2)
        end
        return  -- block all other input while game._trade panel is open
    end

    -- Trade pending request: accept/decline with Y/N keys
    if game._trade.pendingRequest then
        if key == "y" then
            if client then
                client:emit("trade_accept", { tradeId = game._trade.pendingRequest.tradeId })
            end
            -- Don't clear pendingRequest here; trade_started listener will do it
        elseif key == "n" then
            if client then
                client:emit("trade_cancel", { tradeId = game._trade.pendingRequest.tradeId })
            end
            game._trade.pendingRequest = nil
            game._trade._pendingTimer = nil
        end
        -- Don't return — allow other input while request popup is showing
    end

    -- Lich Raid gathering: Enter = force start, Escape = leave
    if game._raid.gathering and game._raid.gathering.phase == "gathering" then
        if (key == "return" or key == "kpenter") and client then
            client:emit("raid_force_start", {})
            return
        elseif key == "escape" and client then
            client:emit("dungeon_exit", {})
            game._raid.gathering = nil
            game._raid.myParty = nil
            return
        end
    end

    -- Portal panel: Escape closes it
    if game._portal.show then
        if key == "escape" then
            game._portal.show = false
            game._portal.scroll = 0
        end
        return  -- block all other input while game._portal panel is open
    end

    -- Auction panel: Escape closes it
    if game._auction.show then
        if key == "escape" then
            game._auction.show = false
            game._auction.selected = nil
            game._auction.scroll = 0
            game._auction.searchActive = false
            game._auction.priceActive = false
        elseif key == "backspace" then
            if game._auction.searchActive then
                game._auction.filters.search = game._auction.filters.search:sub(1, -2)
            elseif game._auction.priceActive then
                game._auction.sellPrice = game._auction.sellPrice:sub(1, -2)
            end
        elseif key == "return" or key == "kpenter" then
            if game._auction.searchActive and client then
                client:emit("mmo_auction_browse", {
                    search = game._auction.filters.search,
                    rarity = game._auction.filters.rarity,
                    page = 1,
                })
                game._auction.searchActive = false
            end
        end
        return
    end

    -- NPC Shop panel: Escape closes it
    if game._npcShop.show then
        if key == "escape" then
            game._npcShop.show = false
            game._npcShop.selected = nil
            game._npcShop.amount = 1
            game._npcShop.scroll = 0
        end
        return  -- block all other input while shop is open
    end

    -- Bank vault panel: Escape closes it
    if game._bank.show then
        if key == "escape" then
            game._bank.show = false
            game._bank.selected = nil
            game._bank.amount = 1
            game._bank.scroll = 0
        end
        return
    end

    if ui.showWorldMap then
        if key == "m" or key == "escape" then
            ui.showWorldMap = false
        elseif key == "=" or key == "+" or key == "kp+" then
            mapZoom = math.min(50, mapZoom * 1.5)
        elseif key == "-" or key == "kp-" then
            mapZoom = math.max(1, mapZoom / 1.5)
        end
        return
    end

    if ui.showZoneList then
        if key == "m" or key == "escape" then
            ui.showZoneList = false
        end
        return
    end

    if ui.showEquipment then
        if key == "g" or key == "escape" then
            ui.showEquipment = false
        end
        return
    end

    if ui.showGridInventory then
        if key == "i" or key == "escape" then
            ui.showGridInventory = false
        elseif gridInv.keypressed(key) then
            -- handled by grid inventory
        end
        return
    end

    if ui.showInventory then
        if key == "i" or key == "escape" then
            ui.showInventory = false
        end
        return
    end

    if ui.showMastery then
        if key == "escape" then
            ui.showMastery = false
        end
        return
    end

    if ui.showCharSheet then
        if key == "c" or key == "escape" then
            ui.showCharSheet = false
        end
        return
    end

    if ui.showCardCollection then
        if key == "escape" then
            if ui.selectedCard then
                ui.selectedCard = nil
            elseif game._fusionMode.active then
                game._fusionMode.active = false
                game._fusionMode.card1 = nil
            else
                ui.showCardCollection = false
                ui.cardTab = "collection"
            end
        elseif key == "k" then
            ui.showCardCollection = false
            ui.selectedCard = nil
            ui.cardTab = "collection"
            game._fusionMode.active = false
            game._fusionMode.card1 = nil
        end
        return
    end

    if ui.showPartyPanel then
        if game._raid.partyInviteActive then
            if key == "escape" then
                game._raid.partyInviteActive = false
                game._raid.partyInviteInput = ""
            elseif key == "return" or key == "kpenter" then
                -- Send invite on Enter
                if client and #game._raid.partyInviteInput > 0 and game._raid.partyData then
                    local targetId = nil
                    for id, p in pairs(players) do
                        if id ~= myId and p.name and p.name:lower() == game._raid.partyInviteInput:lower() then
                            targetId = id
                            break
                        end
                        if id ~= myId and p.username and p.username:lower() == game._raid.partyInviteInput:lower() then
                            targetId = id
                            break
                        end
                    end
                    if targetId then
                        client:emit("party_invite", { targetId = targetId })
                        addFloatingText({
                            text = "Invite sent to " .. game._raid.partyInviteInput,
                            x = players[myId] and players[myId].x or 0,
                            y = players[myId] and (players[myId].y - 40) or 0,
                            color = {0.4, 0.7, 1},
                            timer = 2.5,
                        })
                    else
                        addFloatingText({
                            text = "Player '" .. game._raid.partyInviteInput .. "' not found in zone",
                            x = players[myId] and players[myId].x or 0,
                            y = players[myId] and (players[myId].y - 40) or 0,
                            color = {1, 0.3, 0.3},
                            timer = 2.5,
                        })
                    end
                    game._raid.partyInviteInput = ""
                end
                game._raid.partyInviteActive = false
            elseif key == "backspace" then
                game._raid.partyInviteInput = game._raid.partyInviteInput:sub(1, -2)
            end
            return
        end
        if key == "y" or key == "escape" then
            ui.showPartyPanel = false
            game._raid.partyInviteActive = false
            game._raid.partyInviteInput = ""
        end
        return
    end

    -- Combat input routing (highest priority when in combat, after UI dismissals)
    if tcState.inCombat and not chat.active then
        -- Block input during animations
        if combatAnim.isPlaying() then return end

        local action = combatUI.handleKey(key)
        if action then
            if action.type == "end_turn" or action.type == "wait" then
                if tcState.combatMyTurn and client then
                    client:emit("tc_combat_action", {
                        combatId = tcState.combatId,
                        action = action.type,
                        data = action.data or {},
                    })
                    tcState.combatMyTurn = false
                    combatUI.setMyTurn(false, nil)
                end
            elseif action.type == "cancel" then
                -- Just cancel selection, handled in combatUI
            end
            return
        end
        -- Let escape and enter fall through to chat/UI
        if key ~= "escape" and key ~= "return" then return end
    end

    -- Accept combat join offer with J key
    if not tcState.inCombat and dungeon.combatJoinOffer and key == "j" then
        if client then
            client:emit("tc_combat_join_accept", { combatId = dungeon.combatJoinOffer.combatId })
        end
        dungeon.combatJoinOffer = nil
        return
    end

    if chat.active then
        if key == "escape" then
            chat.active = false
            chat.input = ""
        elseif key == "return" or key == "kpenter" then
            if #chat.input > 0 then
                -- Check for /party or /p prefix for party chat
                local partyMsg = chat.input:match("^/party%s+(.+)") or chat.input:match("^/p%s+(.+)")
                if partyMsg and game._raid.partyData then
                    client:emit("party_chat", { message = partyMsg })
                else
                    client:emit("zone_chat", { message = chat.input })
                end
                chat.input = ""
            end
            chat.active = false
        elseif key == "backspace" then
            chat.input = chat.input:sub(1, -2)
        end
        return
    end

    if (key == "return" or key == "kpenter") and not _G.offlineMode then
        chat.active = true
        chat.input = ""
    elseif key == "space" then
        -- Space bar: primary attack in dungeon (exploration mode only)
        if dungeon.inDungeon and dungeon.enemies and not tcState.inCombat then
            for i, enemy in ipairs(dungeon.enemies) do
                if enemy.alive ~= false then
                    local dx = math.abs(enemy.x - dungeon.playerTileX)
                    local dy = math.abs(enemy.y - dungeon.playerTileY)
                    if dx <= 1 and dy <= 1 then
                        client:emit("dungeon_attack", { enemyIndex = i - 1 })
                        return
                    end
                end
            end
        end
        -- Space bar: attack overworld monster (non-dungeon, non-combat)
        if not dungeon.inDungeon and not tcState.inCombat and monsterAttackCooldown <= 0 then
            local me = players[myId]
            if me and #zoneMonsters > 0 and client then
                -- Find nearest monster within 64px
                local nearestMonster = nil
                local nearestDistSq = 64 * 64
                for _, m in ipairs(zoneMonsters) do
                    local ddx = me.x - (m.x or 0)
                    local ddy = me.y - (m.y or 0)
                    local dSq = ddx * ddx + ddy * ddy
                    if dSq < nearestDistSq then
                        nearestDistSq = dSq
                        nearestMonster = m
                    end
                end
                if nearestMonster then
                    client:emit("zone_combat_engage", { monsterId = nearestMonster.id })
                    monsterAttackCooldown = 0.8
                    return
                end
            end
        end
    elseif key == "f" then
        -- Corruption cleanse (overworld, with purification crystal)
        if not dungeon.inDungeon and client then
            local me = players and players[myId]
            if me then
                local mcx = math.floor(me.x / overworld.chunkSize)
                local mcy = math.floor(me.y / overworld.chunkSize)
                local cKey = mcx .. "," .. mcy
                local cLevel = corruption.chunks[cKey]
                if cLevel and cLevel > 0 then
                    client:emit("corruption_cleanse", {})
                end
            end
        end
    elseif key == "r" and not chat.active then
        -- Card-based corruption cleanse (overworld, drains HP & mana)
        if not dungeon.inDungeon and client then
            local me = players and players[myId]
            if me then
                local mcx = math.floor(me.x / overworld.chunkSize)
                local mcy = math.floor(me.y / overworld.chunkSize)
                local cKey = mcx .. "," .. mcy
                local cLevel = corruption.chunks[cKey]
                if cLevel and cLevel > 0 and rpg.equippedCards and rpg.cards then
                    -- Find the first active overworld cleanse card
                    local cardLookup = {}
                    for _, c in ipairs(rpg.cards) do
                        if c and c.instanceId then cardLookup[c.instanceId] = c end
                    end
                    for _, eqId in ipairs(rpg.equippedCards) do
                        local card = eqId and cardLookup[eqId]
                        if card and card.effects then
                            for _, eff in ipairs(card.effects) do
                                if eff.type == "overworld_cleanse" then
                                    client:emit("corruption_card_cleanse", { cardId = card.cardId })
                                    return
                                end
                            end
                        end
                    end
                end
            end
        end
        -- Leviathan flee (during aggro window)
        if overworld.leviathanAggro and overworld.leviathanAggroTimer > 0 and client then
            client:emit("leviathan_flee", { leviathanId = overworld.leviathanAggro.leviathanId })
        end
    elseif key == "h" and not chat.active then
        if permadeath.showHallOfHeroes then
            -- Toggle hall of heroes off
            permadeath.showHallOfHeroes = false
        elseif love.keyboard.isDown("lshift") or love.keyboard.isDown("rshift") then
            -- Shift+H: Hall of Heroes (permadeath memorial)
            if client then
                client:emit("hall_of_heroes", {})
            end
        else
            -- H: Home teleport
            if client then
                client:emit("home_teleport", {})
            end
        end
    elseif key == "f" and dungeon.inDungeon and not tcState.inCombat and not chat.active then
        -- Activate weapon special
        if game._itemUI.weaponSpecialName and game._itemUI.weaponSpecialCharge >= game._itemUI.weaponSpecialMax and client then
            client:emit("dungeon_use_weapon_special", {})
        end
    elseif (key == "1" or key == "2" or key == "3" or key == "4") and dungeon.inDungeon and not tcState.inCombat and not chat.active then
        -- Activate inscription slot
        local slotIdx = tonumber(key)
        if slotIdx and game._itemUI.inscriptionSlots[slotIdx] and client then
            local ins = game._itemUI.inscriptionSlots[slotIdx]
            if not ins.cooldownLeft or ins.cooldownLeft <= 0 then
                client:emit("dungeon_use_inscription", { slotIndex = slotIdx })
            end
        end
    elseif key == "e" then
        -- Revive downed player (permadeath)
        if dungeon.inDungeon and next(permadeath.downedPlayers) then
            local px, py = dungeon.playerTileX, dungeon.playerTileY
            for sid, dp in pairs(permadeath.downedPlayers) do
                local dist = math.abs(dp.x - px) + math.abs(dp.y - py)
                if dist <= 2 then
                    client:emit("revive_player", { targetSocketId = sid })
                    break
                end
            end
        end
        -- Dungeon interactions
        if dungeon.inDungeon and dungeon.grid then
            local tile = nil
            if dungeon.grid[dungeon.playerTileY + 1] then
                tile = dungeon.grid[dungeon.playerTileY + 1][dungeon.playerTileX + 1]
            end
            -- Stairs/exit
            if tile == DTILE.STAIRS_DOWN or tile == DTILE.EXIT or tile == DTILE.BOSS_DOOR then
                client:emit("dungeon_descend", {})
            elseif tile == DTILE.STAIRS_UP or tile == DTILE.ENTRANCE then
                if dungeon.floorNum <= 1 then
                    client:emit("dungeon_exit", {})
                    dungeon.inDungeon = false
                else
                    client:emit("dungeon_ascend", {})
                end
            end
            -- Adjacent chest
            for _, chest in ipairs(dungeon.chests) do
                if not chest.opened then
                    local dx = math.abs(chest.x - dungeon.playerTileX)
                    local dy = math.abs(chest.y - dungeon.playerTileY)
                    if dx <= 1 and dy <= 1 and (dx + dy) <= 1 then
                        client:emit("dungeon_open_chest", { x = chest.x, y = chest.y })
                        break
                    end
                end
            end
            -- Adjacent NPC
            for i, npc in ipairs(dungeon.npcs) do
                if not npc.claimed then
                    local dx = math.abs(npc.x - dungeon.playerTileX)
                    local dy = math.abs(npc.y - dungeon.playerTileY)
                    if dx <= 1 and dy <= 1 and (dx + dy) <= 1 then
                        client:emit("dungeon_interact_npc", { npcIndex = i - 1 })
                        break
                    end
                end
            end
            -- Adjacent corpse
            for _, cr in ipairs(dungeon.corpses) do
                if not cr.examined then
                    local dx = math.abs(cr.x - dungeon.playerTileX)
                    local dy = math.abs(cr.y - dungeon.playerTileY)
                    if dx <= 1 and dy <= 1 and (dx + dy) <= 1 then
                        client:emit("dungeon_examine_corpse", { x = cr.x, y = cr.y })
                        break
                    end
                end
            end
            return  -- handled dungeon interaction
        end

        -- Interact with lootable corpse or world container (overworld)
        if not dungeon.inDungeon then
            local me = players[myId]
            if me then
                -- Check nearby corpses
                for _, c in ipairs(zoneCorpses) do
                    local dx = me.x - (c.x or 0)
                    local dy = me.y - (c.y or 0)
                    if dx * dx + dy * dy < 128 * 128 then
                        client:emit("loot_corpse", { corpseId = c.id })
                        return
                    end
                end
                -- Check nearby world containers
                for _, wc in ipairs(zoneWorldContainers) do
                    local dx = me.x - (wc.x or 0)
                    local dy = me.y - (wc.y or 0)
                    if dx * dx + dy * dy < 128 * 128 then
                        client:emit("loot_container", { containerId = wc.id })
                        return
                    end
                end
            end
        end

        -- Interact with zone connection or resource
        if hoverConnection then
            client:emit("zone_enter", {
                zoneId = hoverConnection.targetZone,
                fromZone = zone and zone.id,
            })
        elseif hoverResource and not hoverResource.depleted then
            -- Check skill level before sending
            local myLevel = 1
            local reqSkill = hoverResource.skill or "mining"
            if skills and skills[reqSkill] then
                myLevel = skills[reqSkill].level or 1
            end
            if myLevel >= (hoverResource.minLevel or 1) then
                client:emit("resource_harvest", { resourceId = hoverResource.id })
            end
        elseif overworld.hoverRift then
            -- Mini-rift interaction: enter as dungeon
            local rift = overworld.hoverRift
            if client then
                client:emit("dungeon_enter", { dungeonId = "minirift_" .. rift.riftId })
            end
        elseif overworld.hoverCave then
            -- Cave interaction
            if overworld.hoverCave.hollowEarth or overworld.hoverCave.surfaceExit then
                -- Transition between overworld / hollow earth
                if client then
                    client:emit("cave_enter", {
                        worldX = overworld.hoverCave.worldX,
                        worldY = overworld.hoverCave.worldY,
                        surfaceExit = overworld.hoverCave.surfaceExit or false,
                    })
                end
            else
                -- Non-hollow-earth cave: try entering as dungeon
                if client then
                    client:emit("cave_enter", {
                        worldX = overworld.hoverCave.worldX,
                        worldY = overworld.hoverCave.worldY,
                    })
                end
            end
        elseif hoverObject then
            -- Interact with placed object
            if hoverObject.type == "forge" or hoverObject.type == "advanced_forge" or hoverObject.type == "master_forge" then
                ui.showInventory = true
                ui.inventoryTab = "crafting"
                ui.craftingFilter = "forge"
            elseif hoverObject.type == "iron_anvil" then
                ui.showInventory = true
                ui.inventoryTab = "crafting"
                ui.craftingFilter = "anvil"
            elseif hoverObject.type == "alchemy_table" or hoverObject.type == "advanced_alchemy_table" or hoverObject.type == "master_alchemy_table" then
                ui.showInventory = true
                ui.inventoryTab = "crafting"
                ui.craftingFilter = "alchemy_table"
            elseif hoverObject.type == "loom" or hoverObject.type == "advanced_loom" or hoverObject.type == "master_loom" then
                ui.showInventory = true
                ui.inventoryTab = "crafting"
                ui.craftingFilter = "loom"
            elseif hoverObject.type == "brewery" or hoverObject.type == "advanced_brewery" or hoverObject.type == "master_brewery" then
                ui.showInventory = true
                ui.inventoryTab = "crafting"
                ui.craftingFilter = "brewery"
            elseif hoverObject.type == "enchanting_table" or hoverObject.type == "advanced_enchanting_table" then
                ui.showInventory = true
                ui.inventoryTab = "crafting"
                ui.craftingFilter = "enchanting_table"
            elseif hoverObject.type == "cauldron" then
                ui.showInventory = true
                ui.inventoryTab = "crafting"
                ui.craftingFilter = "cauldron"
            elseif hoverObject.type == "storage_chest" then
                client:emit("interact_object", { objectId = hoverObject.id, action = "open_chest" })
            elseif hoverObject.type == "crop_plot" or hoverObject.type == "garden_bed" then
                -- Crop interaction: plant/water/harvest depending on state
                if hoverObject.crop and hoverObject.crop.stage == 3 then
                    client:emit("harvest_crop", { cropPlotId = hoverObject.id })
                elseif hoverObject.crop and hoverObject.crop.stage < 3 then
                    client:emit("water_crop", { cropPlotId = hoverObject.id })
                else
                    -- No crop planted - open farming panel to plant
                    game.closeAllPanels()
                    ui.showFarming = true
                    ui.farmingTab = "crops"
                    ui.farmingPlotId = hoverObject.id
                    if client then client:emit("check_crops", {}) end
                end
            elseif hoverObject.type == "animal_pen" then
                -- Animal pen: feed or collect
                local hasProducts = false
                if hoverObject.animals then
                    for _, ani in ipairs(hoverObject.animals) do
                        if ani.pendingProducts and #ani.pendingProducts > 0 then
                            hasProducts = true
                            break
                        end
                    end
                end
                if hasProducts then
                    client:emit("animal_collect", { animalPenId = hoverObject.id })
                else
                    client:emit("animal_feed", { animalPenId = hoverObject.id })
                end
            elseif hoverObject.type == "bed" then
                client:emit("furniture_interact", { objectId = hoverObject.id, action = "sleep" })
            end
        end
        -- NPC interactions (town)
        if game._hoverNpc then
            if game._hoverNpc.type == "adventure_guild" then
                client:emit("dungeon_guild_signup", {})
            elseif game._hoverNpc.type == "dungeon_quest_board" then
                client:emit("dungeon_quest_list", {})
            elseif game._hoverNpc.type == "dungeon_leaderboard" then
                client:emit("dungeon_leaderboard", {})
            elseif game._hoverNpc.type == "dungeon_entrance" then
                client:emit("dungeon_enter", { dungeonId = "rift" })
            elseif game._hoverNpc.type == "portal_nexus" then
                game.closeAllPanels()
                game._portal.show = false  -- will be opened by portal_list listener
                game._portal.destinations = {}
                game._portal.scroll = 0
                game._portal.message = nil
                if client then
                    client:emit("portal_list")
                end
            elseif game._hoverNpc.type == "npc_shop" or game._hoverNpc.type == "shopkeeper" then
                game.closeAllPanels()
                game._npcShop.show = true
                game._npcShop.tab = "buy"
                game._npcShop.selected = nil
                game._npcShop.amount = 1
                game._npcShop.scroll = 0
                game._npcShop.prices = nil
                game._npcShop.shopList = nil
                game._npcShop.message = nil
                game._npcShop.transactionLock = false
                -- Use shopId from NPC data if available, otherwise fetch shop list
                local npcShopId = game._hoverNpc.shopId
                if npcShopId then
                    game._npcShop.shopId = npcShopId
                    game._npcShop.shopName = game._hoverNpc.name or "Shop"
                    client:emit("npc_shop_prices", { shopId = npcShopId })
                else
                    -- Default to general, but also fetch shop list for switching
                    game._npcShop.shopId = "general"
                    game._npcShop.shopName = game._hoverNpc.name or "General Store"
                    client:emit("npc_shop_browse", {})
                    client:emit("npc_shop_prices", { shopId = "general" })
                end
            elseif game._hoverNpc.type == "banker" then
                game.closeAllPanels()
                game._bank.show = true
                game._bank.tab = "gold"
                game._bank.selected = nil
                game._bank.amount = 1
                game._bank.scroll = 0
                game._bank.data = nil
                game._bank.transactionLock = false
                if client then
                    client:emit("bank_open", {})
                end
            end
        end
    elseif key == "m" then
        local wasOpen = overworld.chunkBased and ui.showWorldMap or ui.showZoneList
        game.closeAllPanels()
        if overworld.chunkBased then
            ui.showWorldMap = not wasOpen
        else
            ui.showZoneList = not wasOpen
        end
    elseif key == "i" then
        if ui.showGridInventory then
            ui.showGridInventory = false
            game._audio.playInventoryClose()
            return
        end
        game.closeAllPanels()
        ui.showGridInventory = true
        game._audio.playInventoryOpen()
        if client then
            client:emit("grid_sync", {})
        end
    elseif key == "g" then
        -- B1: Equipment panel toggle
        local wasOpen = ui.showEquipment
        game.closeAllPanels()
        ui.showEquipment = not wasOpen
        if ui.showEquipment and client then
            client:emit("get_equipment", {})
            client:emit("get_durability", {})
        end
    elseif key == "c" then
        local wasOpen = ui.showCharSheet
        game.closeAllPanels()
        ui.showCharSheet = not wasOpen
        if ui.showCharSheet and client then
            client:emit("get_rpg_stats", {})
        end
    elseif key == "k" then
        local wasOpen = ui.showCardCollection
        game.closeAllPanels()
        ui.showCardCollection = not wasOpen
        ui.cardTab = "collection"
        ui.selectedCard = nil
        game._fusionMode.active = false
        game._fusionMode.card1 = nil
        if ui.showCardCollection and client then
            client:emit("get_cards", {})
            client:emit("get_card_vendor_catalog", {})
            client:emit("get_card_loadouts", {})
        end
    elseif key == "b" then
        -- Knowledge panel toggle
        local wasOpen = ui.showKnowledge
        game.closeAllPanels()
        ui.showKnowledge = not wasOpen
        knowledge.scrollY = 0
        knowledge.bookContent = nil
        if ui.showKnowledge and client then
            client:emit("knowledge_get", { tab = knowledge.tab })
        end
    elseif key == "f" then
        -- Farming panel toggle
        local wasOpen = ui.showFarming
        game.closeAllPanels()
        ui.showFarming = not wasOpen
        if ui.showFarming and client then
            client:emit("check_crops", {})
        end
    elseif key == "p" then
        -- Plot claim/unclaim toggle
        if client and overworld.chunkBased then
            if overworld.myPlotId then
                if overworld.plotUnclaimPending then
                    overworld.plotUnclaimPending = false
                    client:emit("unclaim_plot", {confirmed = true})
                else
                    client:emit("unclaim_plot", {})
                end
            else
                client:emit("claim_plot", {})
            end
        end
    elseif key == "q" then
        -- Quick exit dungeon
        if dungeon.inDungeon then
            client:emit("dungeon_exit", {})
            dungeon.inDungeon = false
        end
    elseif key == "t" then
        -- Use torch in dungeon
        if dungeon.inDungeon and not dungeon.hasTorch and not dungeon.hasLantern then
            client:emit("dungeon_use_torch", {})
        end
    elseif key == "v" then
        -- Toggle vision type in dungeon (cycles through available visions)
        if dungeon.inDungeon and client then
            client:emit("dungeon_toggle_vision", {})
        end
    elseif key == "j" then
        -- Toggle dungeon quests (when in dungeon) OR game._auction house (when in town)
        if dungeon.inDungeon or (zone and zone.id == "starter_town") then
            ui.showDungeonQuests = not ui.showDungeonQuests
            if ui.showDungeonQuests then
                client:emit("dungeon_quest_list", {})
            end
        else
            -- Auction house toggle
            local wasOpen = game._auction.show
            game.closeAllPanels()
            game._auction.show = not wasOpen
            if game._auction.show and client then
                client:emit("mmo_auction_browse", game._auction.filters or {})
            end
        end
    elseif key == "l" then
        -- Toggle leaderboard
        ui.showLeaderboard = not ui.showLeaderboard
        if ui.showLeaderboard then
            client:emit("dungeon_leaderboard", {})
        end
    elseif key == "y" then
        -- Toggle party panel
        local wasOpen = ui.showPartyPanel
        game.closeAllPanels()
        ui.showPartyPanel = not wasOpen
    elseif key == "u" and not chat.active then
        -- Toggle companion panel
        local wasOpen = ui.showCompanions
        game.closeAllPanels()
        ui.showCompanions = not wasOpen
        if ui.showCompanions and client then
            client:emit("companion_list", {})
        end
    elseif key == "o" and not chat.active then
        -- Toggle pet panel
        local wasOpen = ui.showPets
        game.closeAllPanels()
        ui.showPets = not wasOpen
        if ui.showPets and client then
            client:emit("pet_list", {})
        end
    elseif key == "]" and not chat.active then
        -- Toggle guild panel
        local wasOpen = ui.showGuild
        game.closeAllPanels()
        ui.showGuild = not wasOpen
        if ui.showGuild and client then
            if game._guild.guildId then
                client:emit("guild_vault_browse", {})
            else
                client:emit("guild_list", {})
            end
        end
    elseif key == ";" and not chat.active then
        -- Toggle ascension panel
        local wasOpen = ui.showAscension
        game.closeAllPanels()
        ui.showAscension = not wasOpen
        if ui.showAscension and client then
            client:emit("ascension_status", {})
        end
    elseif key == "/" and not chat.active then
        -- Toggle faction rep panel
        game._karma.showFactions = not game._karma.showFactions
        if game._karma.showFactions and client then
            client:emit("faction_status", {})
            client:emit("faction_list", {})
        end
    elseif key == "f9" and not chat.active then
        -- Toggle audio settings panel
        local wasOpen = ui.showAudioSettings
        game.closeAllPanels()
        ui.showAudioSettings = not wasOpen
    elseif key == "f10" then
        -- Toggle game._admin panel (server hosts only)
        if _G.isServerHost then
            game._admin.showPanel = not game._admin.showPanel
        end
    elseif key == "escape" then
        if ui.showKnowledge then
            if knowledge.bookContent then
                knowledge.bookContent = nil
                knowledge.scrollY = 0
            else
                ui.showKnowledge = false
            end
        elseif game._admin.showPanel then
            game._admin.showPanel = false
        elseif ui.showDungeonQuests then
            ui.showDungeonQuests = false
        elseif ui.showLeaderboard then
            ui.showLeaderboard = false
        elseif ui.placementMode then
            ui.placementMode = false
            ui.placementType = nil
            ui.placementItemId = nil
        elseif ui.showCompanions then
            ui.showCompanions = false
        elseif ui.showPets then
            ui.showPets = false
        elseif ui.showGuild then
            ui.showGuild = false
        elseif ui.showAscension then
            ui.showAscension = false
        elseif ui.showJail then
            -- Can't close jail if still jailed
            if not game._jail.inJail then ui.showJail = false end
        elseif game._karma.showFactions then
            game._karma.showFactions = false
        elseif game._minigame.active then
            -- Can't escape minigame — must click or timeout
        else
            -- Go to character select (switch characters) instead of disconnecting
            _G.switchScene("character_select")
        end
    end
end

function game.textinput(text)
    -- Trade coin input takes priority when active
    if game._trade.show and game._trade.coinInputActive then
        -- Only accept digits
        if text:match("^%d$") and #game._trade.coinInput < 10 then
            game._trade.coinInput = game._trade.coinInput .. text
        end
        return
    end
    -- Guild chat/create input
    if ui.showGuild then
        if game._guild.chatActive then
            if #game._guild.chatInput < 200 then
                game._guild.chatInput = game._guild.chatInput .. text
            end
            return
        elseif game._guild.createActive then
            if #game._guild.createName < 30 then
                game._guild.createName = game._guild.createName .. text
            end
            return
        end
    end
    -- Auction inputs
    if game._auction.show then
        if game._auction.searchActive then
            if #game._auction.filters.search < 50 then
                game._auction.filters.search = game._auction.filters.search .. text
            end
            return
        elseif game._auction.priceActive then
            if text:match("^%d$") and #game._auction.sellPrice < 10 then
                game._auction.sellPrice = game._auction.sellPrice .. text
            end
            return
        end
    end
    if chat.active then
        if #chat.input < 200 then
            chat.input = chat.input .. text
        end
    elseif game._raid.partyInviteActive then
        if #game._raid.partyInviteInput < 30 then
            game._raid.partyInviteInput = game._raid.partyInviteInput .. text
        end
    end
end

function game.mousepressed(x, y, button)
    -- Grid inventory intercept
    if ui.showGridInventory then
        if gridInv.mousepressed(x, y, button) then return end
    end

    -- Crafting minigame click
    if game._minigame.active and not game._minigame.result and button == 1 then
        local clickPos = math.floor(game._minigame.barPos)
        if clickPos >= game._minigame.windowStart and clickPos <= game._minigame.windowEnd then
            local mid = (game._minigame.windowStart + game._minigame.windowEnd) / 2
            local dist = math.abs(clickPos - mid)
            local range = (game._minigame.windowEnd - game._minigame.windowStart) / 2
            game._minigame.result = dist < range * 0.3 and "perfect" or "good"
        else
            game._minigame.result = "miss"
        end
        game._minigame.resultTimer = 1.5
        if client then client:emit("craft_minigame_result", { clickPos = clickPos }) end
        return
    end

    -- Companion panel clicks
    if ui.showCompanions and button == 1 then
        local panelW = 400
        local panelH = 420
        local px = (love.graphics.getWidth() - panelW) / 2
        local py = (love.graphics.getHeight() - panelH) / 2

        -- Hire buttons
        local COMP_CLASSES = {"warrior", "ranger", "mage", "healer", "thief", "bard"}
        local cy = py + 54
        for i, cls in ipairs(COMP_CLASSES) do
            local bx = px + 12 + (i - 1) * 62
            if x >= bx and x <= bx + 58 and y >= cy and y <= cy + 20 then
                if client then client:emit("companion_hire", { companionClass = cls }) end
                return
            end
        end
        cy = cy + 34
        -- Dismiss buttons
        for _, c in ipairs(game._companions.companions) do
            local dBx = px + panelW - 70
            if x >= dBx and x <= dBx + 50 and y >= cy + 20 and y <= cy + 38 then
                if client then client:emit("companion_dismiss", { companionId = c.id }) end
                return
            end
            cy = cy + 50
        end
    end

    -- Pet panel clicks
    if ui.showPets and button == 1 then
        local panelW = 400
        local panelH = 420
        local px = (love.graphics.getWidth() - panelW) / 2
        local py = (love.graphics.getHeight() - panelH) / 2
        local cy = py + 36
        for _, p in ipairs(game._pets.pets) do
            local feedX = px + panelW - 120
            if x >= feedX and x <= feedX + 50 and y >= cy + 4 and y <= cy + 22 then
                if client then client:emit("pet_feed", { petId = p.id }) end
                return
            end
            local actX = px + panelW - 60
            if x >= actX and x <= actX + 46 and y >= cy + 4 and y <= cy + 22 then
                local newId = (game._pets.activePetId == p.id) and nil or p.id
                if client then client:emit("pet_set_active", { petId = newId }) end
                return
            end
            cy = cy + 62
        end
    end

    -- Jail panel clicks
    if ui.showJail and game._jail.inJail and button == 1 then
        local panelW = 340
        local panelH = 260
        local px = (love.graphics.getWidth() - panelW) / 2
        local py = (love.graphics.getHeight() - panelH) / 2
        local bailX = px + panelW / 2 - 80
        local bailY = py + 120
        if x >= bailX and x <= bailX + 160 and y >= bailY and y <= bailY + 36 then
            if client then client:emit("jail_bail", {}) end
            return
        end
        local serveY = bailY + 48
        if x >= bailX and x <= bailX + 160 and y >= serveY and y <= serveY + 36 then
            if client then client:emit("jail_serve_time", {}) end
            return
        end
    end

    -- Audio settings panel clicks
    if ui.showAudioSettings and button == 1 then
        local panelW = 360
        local panelH = 400
        local px = (love.graphics.getWidth() - panelW) / 2
        local py = (love.graphics.getHeight() - panelH) / 2
        local categories = {"master", "music", "sfx", "ambient", "ui", "footsteps"}
        local sliderX = px + 130
        local sliderW = panelW - 160
        local cy = py + 52
        for _, cat in ipairs(categories) do
            if y >= cy and y <= cy + 22 then
                local t = (x - sliderX) / sliderW
                if t >= -0.02 and t <= 1.02 then
                    t = math.max(0, math.min(1, t))
                    game._audio.setVolume(cat, t)
                    game._audioSliderDrag = cat
                    return
                end
            end
            cy = cy + 34
        end
        -- Lighting quality buttons
        if game._settingsQualBtns then
            for _, btn in ipairs(game._settingsQualBtns) do
                if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                    lighting.setQuality(btn.quality)
                    return
                end
            end
        end
        -- Close button
        local closeY = py + panelH - 42
        local closeX = px + panelW / 2 - 50
        if x >= closeX and x <= closeX + 100 and y >= closeY and y <= closeY + 30 then
            ui.showAudioSettings = false
            return
        end
    end

    -- Ascension panel clicks
    if ui.showAscension and button == 1 then
        local panelW = 500
        local panelH = 450
        local px = (love.graphics.getWidth() - panelW) / 2
        local py = (love.graphics.getHeight() - panelH) / 2

        -- Ascend button
        if game._ascension.canAscend then
            local bx = px + panelW / 2 - 60
            local by = py + 54
            if x >= bx and x <= bx + 120 and y >= by and y <= by + 28 then
                if client then client:emit("ascension_confirm", {}) end
                return
            end
        end

        -- Tree node clicks
        local cy = py + 90
        if game._ascension.tree then
            for nodeId, nodeData in pairs(game._ascension.tree) do
                if cy + 38 > py + panelH - 30 then break end
                local nx = px + 12
                local nw = panelW - 24
                if x >= nx and x <= nx + nw and y >= cy and y <= cy + 34 then
                    local rank = (game._ascension.ascensionTree and game._ascension.ascensionTree[nodeId]) or 0
                    local maxRank = nodeData.maxRank or 3
                    local cost = nodeData.cost or 1
                    if rank < maxRank and (game._ascension.ascensionPoints or 0) >= cost then
                        if client then client:emit("ascension_spend_ap", { nodeId = nodeId }) end
                    end
                    return
                end
                cy = cy + 38
            end
        end
    end

    -- Guild panel clicks
    if ui.showGuild and button == 1 then
        local panelW = 500
        local panelH = 460
        local px = (love.graphics.getWidth() - panelW) / 2
        local py = (love.graphics.getHeight() - panelH) / 2

        -- Tab clicks
        local tabs
        if game._guild.guildId then
            tabs = {"info", "members", "chat", "vault"}
        else
            tabs = {"browse", "create"}
        end
        local tabW = 70
        local tabStartX = px + 10
        local tabY = py + 34
        for i, tab in ipairs(tabs) do
            local tx = tabStartX + (i - 1) * (tabW + 4)
            if x >= tx and x <= tx + tabW and y >= tabY and y <= tabY + 22 then
                game._guild.tab = tab
                if tab == "vault" and client then client:emit("guild_vault_browse", {}) end
                if tab == "browse" and client then client:emit("guild_list", {}) end
                return
            end
        end

        local contentY = tabY + 28

        -- Browse: join guild
        if game._guild.tab == "browse" then
            local cy = contentY
            for _, g in ipairs(game._guild.guildList) do
                if x >= px + 10 and x <= px + panelW - 10 and y >= cy and y <= cy + 32 then
                    if client then client:emit("guild_join", { guildId = g.id }) end
                    return
                end
                cy = cy + 36
            end
        end

        -- Create: activate name input + create button
        if game._guild.tab == "create" then
            if x >= px + 20 and x <= px + panelW - 20 and y >= contentY + 28 and y <= contentY + 52 then
                game._guild.createActive = true
                game._guild.chatActive = false
                return
            end
            local createBx = px + panelW / 2 - 50
            local createBy = contentY + 70
            if x >= createBx and x <= createBx + 100 and y >= createBy and y <= createBy + 28 then
                if client and #game._guild.createName > 0 then
                    client:emit("guild_create", { name = game._guild.createName })
                end
                return
            end
        end

        -- Chat: activate input
        if game._guild.tab == "chat" then
            local contentH = panelH - (contentY - py) - 24
            local inputY = contentY + contentH - 24
            if x >= px + 14 and x <= px + panelW - 14 and y >= inputY and y <= inputY + 22 then
                game._guild.chatActive = true
                game._guild.createActive = false
                return
            end
        end

        -- Leave button (info/members tab)
        if game._guild.tab == "info" or game._guild.tab == "members" then
            local lx = px + panelW - 80
            local ly = py + panelH - 40
            if x >= lx and x <= lx + 60 and y >= ly and y <= ly + 22 then
                if client then client:emit("guild_leave", {}) end
                return
            end
        end
    end

    -- Loot panel click handling (corpse/container)
    if (corpseLootPanel or containerLootPanel) and button == 1 and game._lootPanelRect then
        local r = game._lootPanelRect
        if x >= r.x and x <= r.x + r.w and y >= r.y and y <= r.y + r.h then
            -- Take All button
            if y >= r.btnY and y <= r.btnY + 26 and x >= r.x + 10 and x <= r.x + 110 then
                if corpseLootPanel then
                    client:emit("take_all_corpse", { corpseId = corpseLootPanel.corpseId })
                elseif containerLootPanel then
                    client:emit("take_all_container", { containerId = containerLootPanel.containerId })
                end
                return
            end
            -- Close button
            if y >= r.btnY and y <= r.btnY + 26 and x >= r.x + r.w - 110 and x <= r.x + r.w - 10 then
                corpseLootPanel = nil
                containerLootPanel = nil
                return
            end
            -- Click on individual item (take it)
            local itemStartY = r.y + 32
            if corpseLootPanel and corpseLootPanel.gold and corpseLootPanel.gold > 0 then
                itemStartY = itemStartY + 18
            end
            local panel = corpseLootPanel or containerLootPanel
            if panel and panel.resources then
                for _ in pairs(panel.resources) do
                    itemStartY = itemStartY + 16
                end
            end
            itemStartY = itemStartY + 10 -- separator
            if panel and panel.items then
                for idx, _ in ipairs(panel.items) do
                    if y >= itemStartY and y <= itemStartY + 16 then
                        if corpseLootPanel then
                            client:emit("take_corpse_item", { corpseId = corpseLootPanel.corpseId, itemIndex = idx - 1 })
                        elseif containerLootPanel then
                            client:emit("take_container_item", { containerId = containerLootPanel.containerId, itemIndex = idx - 1 })
                        end
                        return
                    end
                    itemStartY = itemStartY + 16
                end
            end
            return
        end
    end

    -- NPC Dialogue click handling
    if game._npcDialogue.show and button == 1 then
        local W = love.graphics.getWidth()
        local H = love.graphics.getHeight()
        local panelW = math.min(600, W - 40)
        local panelH = 200
        local panelX = (W - panelW) / 2
        local panelY = H - panelH - 20
        local choiceY = panelY + 100
        for i, choice in ipairs(game._npcDialogue.choices) do
            local choiceX = panelX + 24
            local choiceW = panelW - 48
            local choiceH = 22
            if x >= choiceX and x <= choiceX + choiceW and y >= choiceY and y <= choiceY + choiceH then
                client:emit("npc_dialogue_choice", { choiceIndex = choice.index })
                return
            end
            choiceY = choiceY + 24
        end
        -- Click outside choices closes dialogue
        if x < panelX or x > panelX + panelW or y < panelY or y > panelY + panelH then
            game._npcDialogue.show = false
        end
        return
    end

    -- Pack reveal click handling (highest priority when active)
    if packReveal and button == 1 then
        if packReveal.done then
            -- Close the reveal
            packReveal = nil
        elseif packReveal.phase == "show" then
            -- Advance to next card
            game.packRevealAdvance()
        elseif packReveal.phase == "flip" then
            -- Skip flip animation - jump to show
            packReveal.flipProgress = 1
            packReveal.phase = "show"
            packReveal.timer = 0
        end
        return
    end

    -- Trade panel click handling (highest priority when game._trade is open)
    if game._trade.show and button == 1 then
        if game.handleTradeClick(x, y) then
            return
        end
    end

    -- Trade pending request popup click handling
    if game._trade.pendingRequest and button == 1 then
        if game.handleTradeRequestClick(x, y) then
            return
        end
    end

    -- Portal panel click handling (highest priority when open)
    if game._portal.show and button == 1 then
        if game.handlePortalClick(x, y) then
            return
        end
    end

    -- NPC Shop click handling (highest priority when shop is open)
    if game._npcShop.show and button == 1 then
        if game.handleNpcShopClick(x, y) then
            return
        end
    end

    -- Bank vault click handling
    if game._bank.show and button == 1 then
        if game.handleBankClick(x, y) then
            return
        end
    end

    -- Admin panel click handling (highest priority when open)
    if game._admin.showPanel and button == 1 then
        if game.handleAdminPanelClick(x, y) then
            return
        end
    end

    -- Knowledge panel click handling
    if ui.showKnowledge then
        if game.handleKnowledgeClick(x, y, button) then
            return
        end
    end

    -- Farming panel click handling
    if ui.showFarming and button == 1 then
        if game.handleFarmingClick(x, y) then
            return
        end
    end

    -- Context menu: handle left-click on items or dismiss
    if ui.contextMenu then
        if button == 1 then
            local ctx = ui.contextMenu
            local ctxItems = ctx.items or CONTEXT_MENU_ITEMS_BASE
            if ctx.hoverIndex and ctx.hoverIndex >= 1 and ctx.hoverIndex <= #ctxItems then
                local item = ctxItems[ctx.hoverIndex]
                executeContextMenuAction(item.action, ctx.targetId, ctx.targetName)
            end
            -- Always close the menu on left-click (whether we hit an item or not)
            ui.contextMenu = nil
            return
        elseif button == 2 then
            -- Right-click also closes the menu (and might re-open on a different target below)
            ui.contextMenu = nil
            -- Fall through so the right-click-on-player check below can open a new menu
        end
    end

    -- Character sheet: stat allocation [+] buttons
    if ui.showCharSheet and button == 1 and #statAllocButtons > 0 then
        for _, btn in ipairs(statAllocButtons) do
            if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                if client then
                    client:emit("stat_allocate", { stat = btn.key })
                end
                return
            end
        end
    end

    -- Combat click routing
    if tcState.inCombat and button == 1 then
        if combatAnim.isPlaying() then return end
        local action = combatUI.handleClick(x, y, camera.x, camera.y)
        if action then
            if action.type == "move" or action.type == "attack" or action.type == "ability" then
                if tcState.combatMyTurn and client then
                    client:emit("tc_combat_action", {
                        combatId = tcState.combatId,
                        action = action.type,
                        data = action.data or {},
                    })
                    -- For move/attack, keep turn until server confirms end
                end
            elseif action.type == "wait" or action.type == "end_turn" then
                if tcState.combatMyTurn and client then
                    client:emit("tc_combat_action", {
                        combatId = tcState.combatId,
                        action = action.type,
                        data = {},
                    })
                    tcState.combatMyTurn = false
                    combatUI.setMyTurn(false, nil)
                end
            elseif action.type == "reaction" then
                if client then
                    client:emit("tc_combat_react", {
                        combatId = tcState.combatId,
                        reaction = action.data.choice,
                    })
                    combatUI.clearReactionPrompt()
                end
            end
        end
        return
    end

    -- Left-click attack in dungeon (exploration mode — triggers turn combat)
    if button == 1 and dungeon.inDungeon and dungeon.enemies and not tcState.inCombat then
        for i, enemy in ipairs(dungeon.enemies) do
            if enemy.alive ~= false then
                local dx = math.abs(enemy.x - dungeon.playerTileX)
                local dy = math.abs(enemy.y - dungeon.playerTileY)
                if dx <= 1 and dy <= 1 then
                    client:emit("dungeon_attack", { enemyIndex = i - 1 })
                    return
                end
            end
        end
    end

    -- Right-click on another player: open context menu
    if button == 2 and not ui.placementMode then
        local targetPlayer, targetId = getOtherPlayerAtScreen(x, y)
        if targetPlayer and targetId then
            ui.contextMenu = {
                x = x,
                y = y,
                targetId = targetId,
                targetName = targetPlayer.name or "Unknown",
                hoverIndex = nil,
                items = getContextMenuItems(targetId),
            }
            return
        end
    end

    -- Open card pack (when card collection is visible and packs are available)
    if ui.showCardCollection and button == 1 and rpg.pendingPacks and rpg.pendingPacks > 0 then
        local pw = math.min(750, love.graphics.getWidth() - 40)
        local px = (love.graphics.getWidth() - pw) / 2
        local py = (love.graphics.getHeight() - math.min(560, love.graphics.getHeight() - 60)) / 2
        -- Check if clicking the "Pack Available" area
        if y >= py + 30 and y <= py + 48 then
            if client then client:emit("card_open_pack", {}) end
            return
        end
    end

    -- Card collection click handling
    if ui.showCardCollection and button == 1 then
        -- Card detail view buttons (highest priority when open)
        if ui.selectedCard and ui._cardDetailBtns then
            for _, btn in ipairs(ui._cardDetailBtns) do
                if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                    if btn.id == "close" then
                        ui.selectedCard = nil
                    elseif btn.id == "equip" then
                        local emptySlot = getFirstEmptySlot()
                        if emptySlot and client then
                            client:emit("card_equip", { cardInstanceId = ui.selectedCard.instanceId, slotIndex = emptySlot - 1 })
                            ui.selectedCard = nil
                        end
                    elseif btn.id == "unequip" then
                        local slot = getCardEquipSlot(ui.selectedCard)
                        if slot and client then
                            client:emit("card_unequip", { slotIndex = slot - 1 })
                            ui.selectedCard = nil
                        end
                    elseif btn.id == "fuse" then
                        game._fusionMode.active = true
                        game._fusionMode.card1 = ui.selectedCard
                        ui.selectedCard = nil
                    elseif btn.id == "sell" then
                        if client then
                            client:emit("card_vendor_sell", { cardInstanceId = ui.selectedCard.instanceId })
                            ui.selectedCard = nil
                        end
                    elseif btn.id == "game._auction" then
                        -- Switch to game._auction sell tab with this card pre-selected
                        game._auction.sellCard = ui.selectedCard
                        game._auction.sellPrice = ""
                        game._auction.priceActive = true
                        ui.selectedCard = nil
                        ui.showCardCollection = false
                        game._auction.show = true
                        game._auction.tab = "sell"
                        if client then client:emit("mmo_auction_browse", {}) end
                    end
                    return
                end
            end
            -- Click outside detail view closes it
            ui.selectedCard = nil
            return
        end

        -- Tab buttons (Collection / Vendor / Loadouts)
        if ui._cardTabBtns then
            for _, btn in ipairs(ui._cardTabBtns) do
                if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                    ui.cardTab = btn.tab
                    ui.cardScrollY = 0
                    game._cardVendor.scroll = 0
                    game._cardVendor.filterArch = "all"
                    game._cardVendor.filterType = "all"
                    return
                end
            end
        end

        -- Collection tab specific clicks
        if ui.cardTab == "collection" then
            -- Filter buttons
            if ui._filterBtns then
                for _, btn in ipairs(ui._filterBtns) do
                    if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        ui.cardFilter = btn.filter
                        ui.cardScrollY = 0
                        return
                    end
                end
            end

            -- Sort buttons
            if ui._sortBtns then
                for _, btn in ipairs(ui._sortBtns) do
                    if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        ui.cardSort = btn.sort
                        return
                    end
                end
            end

            -- Card grid clicks
            for i, rect in pairs(cardGridRects) do
                if rect and x >= rect.x and x < rect.x + rect.w and y >= rect.y and y < rect.y + rect.h then
                    local card = cardGridCards[i]
                    if card then
                        if game._fusionMode.active and game._fusionMode.card1 then
                            -- Fusion mode: select second card
                            if card.rarity == game._fusionMode.card1.rarity and
                               card.instanceId ~= game._fusionMode.card1.instanceId and
                               not getCardEquipSlot(card) then
                                if client then
                                    client:emit("card_fuse", {
                                        card1Id = game._fusionMode.card1.instanceId,
                                        card2Id = card.instanceId,
                                    })
                                end
                                game._fusionMode.active = false
                                game._fusionMode.card1 = nil
                            end
                        else
                            -- Normal click: open detail view
                            ui.selectedCard = card
                        end
                        return
                    end
                end
            end
        elseif ui.cardTab == "vendor" then
            -- Vendor sub-tab clicks
            if ui._vendorSubTabs then
                for _, btn in ipairs(ui._vendorSubTabs) do
                    if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        game._cardVendor.tab = btn.tab
                        game._cardVendor.scroll = 0
                        return
                    end
                end
            end

            -- Type filter clicks (All/Active/Passive/Stats)
            if ui._vendorTypeFilters then
                for _, btn in ipairs(ui._vendorTypeFilters) do
                    if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        game._cardVendor.filterType = btn.filter
                        game._cardVendor.scroll = 0
                        return
                    end
                end
            end

            -- Archetype filter clicks
            if ui._vendorArchFilters then
                for _, btn in ipairs(ui._vendorArchFilters) do
                    if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        game._cardVendor.filterArch = btn.filter
                        game._cardVendor.scroll = 0
                        return
                    end
                end
            end

            -- Vendor item buttons (buy/sell)
            if ui._vendorItemBtns then
                for _, btn in pairs(ui._vendorItemBtns) do
                    if btn and x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        if btn.action == "buy" and btn.cardId and client then
                            client:emit("card_vendor_buy", { cardId = btn.cardId })
                        elseif btn.action == "sell" and btn.cardInstanceId and client then
                            client:emit("card_vendor_sell", { cardInstanceId = btn.cardInstanceId })
                        end
                        return
                    end
                end
            end
        elseif ui.cardTab == "loadouts" then
            -- Loadout buttons
            if ui._loadoutBtns then
                for _, btn in ipairs(ui._loadoutBtns) do
                    if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        if btn.action == "save" and client then
                            client:emit("card_save_loadout", { slotIndex = btn.slotIndex, name = "Loadout " .. (btn.slotIndex + 1) })
                        elseif btn.action == "load" and client then
                            client:emit("card_load_loadout", { slotIndex = btn.slotIndex })
                        end
                        return
                    end
                end
            end
        end
        return
    end

    -- Character sheet slot clicks
    if ui.showCharSheet and button == 1 and ui._charSheetSlots then
        for i, slot in pairs(ui._charSheetSlots) do
            if slot and x >= slot.x and x < slot.x + slot.w and y >= slot.y and y < slot.y + slot.h then
                local card = findCardByInstanceId(slot.instanceId)
                if card then
                    ui.selectedCard = card
                    -- Switch to card collection to show the detail view
                    ui.showCharSheet = false
                    ui.showCardCollection = true
                    ui.cardTab = "collection"
                end
                return
            end
        end
    end

    -- Mastery [M] buttons in character sheet
    if ui.showCharSheet and button == 1 and ui._masteryButtons then
        for _, btn in ipairs(ui._masteryButtons) do
            if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                game.closeAllPanels()
                ui.showMastery = true
                mastery.skillName = btn.skill
                mastery.tree = nil
                mastery.invested = {}
                mastery.points = 0
                mastery.hoverNode = nil
                if client then
                    client:emit("mastery_tree_status", { skillName = btn.skill })
                end
                return
            end
        end
    end

    -- Mastery tree panel clicks
    if ui.showMastery and button == 1 then
        -- Reset button
        if ui._masteryResetBtn then
            local btn = ui._masteryResetBtn
            if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                if client and mastery.skillName then
                    client:emit("mastery_reset_tree", { skillName = mastery.skillName })
                end
                return
            end
        end
        -- Node clicks
        if ui._masteryNodeHitboxes then
            for _, hit in ipairs(ui._masteryNodeHitboxes) do
                if (x - hit.x)^2 + (y - hit.y)^2 < hit.r^2 then
                    if client and mastery.skillName then
                        client:emit("mastery_invest_point", { skillName = mastery.skillName, nodeId = hit.node.id })
                    end
                    return
                end
            end
        end
    end

    -- Auction house click handling
    if game._auction.show and button == 1 then
        -- Close button
        if game._auction._closeBtn then
            local btn = game._auction._closeBtn
            if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                game._auction.show = false
                return
            end
        end

        -- Tab buttons
        if game._auction._tabBtns then
            for _, btn in ipairs(game._auction._tabBtns) do
                if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                    game._auction.tab = btn.tab
                    game._auction.scroll = 0
                    if btn.tab == "browse" and client then
                        client:emit("mmo_auction_browse", {
                            search = game._auction.filters.search,
                            rarity = game._auction.filters.rarity,
                        })
                    elseif btn.tab == "my_listings" and client then
                        client:emit("mmo_auction_my_listings", {})
                    end
                    return
                end
            end
        end

        if game._auction.tab == "browse" then
            -- Search bar click
            if game._auction._searchBar then
                local sb = game._auction._searchBar
                game._auction.searchActive = x >= sb.x and x < sb.x + sb.w and y >= sb.y and y < sb.y + sb.h
                game._auction.priceActive = false
            end

            -- Search button
            if game._auction._searchBtn then
                local btn = game._auction._searchBtn
                if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                    if client then
                        client:emit("mmo_auction_browse", {
                            search = game._auction.filters.search,
                            rarity = game._auction.filters.rarity,
                            page = 1,
                        })
                    end
                    return
                end
            end

            -- Rarity filter buttons
            if game._auction._rarityBtns then
                for _, btn in ipairs(game._auction._rarityBtns) do
                    if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        game._auction.filters.rarity = btn.rarity
                        game._auction.page = 1
                        if client then
                            client:emit("mmo_auction_browse", {
                                search = game._auction.filters.search,
                                rarity = game._auction.filters.rarity,
                                page = 1,
                            })
                        end
                        return
                    end
                end
            end

            -- Listing buy buttons
            if game._auction._listingBtns then
                for _, btn in pairs(game._auction._listingBtns) do
                    if btn and x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        if client then
                            client:emit("mmo_auction_buy", { listingId = btn.listingId })
                        end
                        return
                    end
                end
            end

            -- Pagination
            if game._auction._prevPageBtn then
                local btn = game._auction._prevPageBtn
                if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                    game._auction.page = math.max(1, game._auction.page - 1)
                    if client then
                        client:emit("mmo_auction_browse", {
                            search = game._auction.filters.search,
                            rarity = game._auction.filters.rarity,
                            page = game._auction.page,
                        })
                    end
                    return
                end
            end
            if game._auction._nextPageBtn then
                local btn = game._auction._nextPageBtn
                if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                    game._auction.page = game._auction.page + 1
                    if client then
                        client:emit("mmo_auction_browse", {
                            search = game._auction.filters.search,
                            rarity = game._auction.filters.rarity,
                            page = game._auction.page,
                        })
                    end
                    return
                end
            end

        elseif game._auction.tab == "sell" then
            -- Price input click
            if game._auction._priceInput then
                local pi = game._auction._priceInput
                game._auction.priceActive = x >= pi.x and x < pi.x + pi.w and y >= pi.y and y < pi.y + pi.h
                game._auction.searchActive = false
            end

            -- List button
            if game._auction._listBtn and game._auction.sellCard and #game._auction.sellPrice > 0 then
                local btn = game._auction._listBtn
                if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                    local price = tonumber(game._auction.sellPrice)
                    if price and price > 0 and client then
                        client:emit("mmo_auction_list_card", {
                            cardInstanceId = game._auction.sellCard.instanceId,
                            price = price,
                        })
                        game._auction.sellCard = nil
                        game._auction.sellPrice = ""
                    end
                    return
                end
            end

            -- Sell card selection
            if game._auction._sellCardBtns then
                for _, btn in pairs(game._auction._sellCardBtns) do
                    if btn and x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        game._auction.sellCard = btn.card
                        return
                    end
                end
            end

        elseif game._auction.tab == "my_listings" then
            -- Cancel buttons
            if game._auction._cancelBtns then
                for _, btn in pairs(game._auction._cancelBtns) do
                    if btn and x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        if client then
                            client:emit("mmo_auction_cancel", { listingId = btn.listingId })
                        end
                        return
                    end
                end
            end
        end
        return
    end

    -- Right-click or middle-click cancels placement mode
    if ui.placementMode and button == 2 then
        ui.placementMode = false
        ui.placementType = nil
        ui.placementItemId = nil
        return
    end

    -- Left-click in placement mode: place the object at world coords
    if ui.placementMode and button == 1 and not ui.showInventory then
        local wx = x + math.floor(camera.x)
        local wy = y + math.floor(camera.y)

        -- Check if inside own plot or in plot zone
        local canPlace = false
        if zone and zone.type == "plot" then
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

        if canPlace and client and ui.placementItemId then
            client:emit("place_object", {
                itemId = ui.placementItemId,
                x = wx,
                y = wy,
            })
        elseif not canPlace then
            if myId and players[myId] then
                addFloatingText({
                    text = "Must place inside your plot",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = { 1, 0.3, 0.3 },
                    timer = 2.0,
                })
            end
        end
        return
    end

    -- Party panel click handling
    if ui.showPartyPanel and button == 1 then
        -- Create Party button
        if not game._raid.partyData and ui._partyCreateBtn then
            local btn = ui._partyCreateBtn
            if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                if client then client:emit("party_create", {}) end
                return
            end
        end

        -- Accept invite button
        if not game._raid.partyData and game._raid.partyInvitePending and ui._partyAcceptBtn then
            local btn = ui._partyAcceptBtn
            if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                if client then
                    client:emit("party_accept", { partyId = game._raid.partyInvitePending.partyId })
                end
                game._raid.partyInvitePending = nil
                return
            end
        end

        -- Decline invite button
        if not game._raid.partyData and game._raid.partyInvitePending and ui._partyDeclineBtn then
            local btn = ui._partyDeclineBtn
            if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                game._raid.partyInvitePending = nil
                return
            end
        end

        -- Invite input focus
        if game._raid.partyData and ui._raid.partyInviteInput then
            local inp = ui._raid.partyInviteInput
            if x >= inp.x and x <= inp.x + inp.w and y >= inp.y and y <= inp.y + inp.h then
                game._raid.partyInviteActive = true
                return
            else
                game._raid.partyInviteActive = false
            end
        end

        -- Send invite button
        if game._raid.partyData and ui._partyInviteSendBtn then
            local btn = ui._partyInviteSendBtn
            if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                if client and #game._raid.partyInviteInput > 0 then
                    -- Find player by name in current zone
                    local targetId = nil
                    for id, p in pairs(players) do
                        if id ~= myId and p.name and p.name:lower() == game._raid.partyInviteInput:lower() then
                            targetId = id
                            break
                        end
                        if id ~= myId and p.username and p.username:lower() == game._raid.partyInviteInput:lower() then
                            targetId = id
                            break
                        end
                    end
                    if targetId then
                        client:emit("party_invite", { targetId = targetId })
                        addFloatingText({
                            text = "Invite sent to " .. game._raid.partyInviteInput,
                            x = players[myId] and players[myId].x or 0,
                            y = players[myId] and (players[myId].y - 40) or 0,
                            color = {0.4, 0.7, 1},
                            timer = 2.5,
                        })
                    else
                        addFloatingText({
                            text = "Player '" .. game._raid.partyInviteInput .. "' not found in zone",
                            x = players[myId] and players[myId].x or 0,
                            y = players[myId] and (players[myId].y - 40) or 0,
                            color = {1, 0.3, 0.3},
                            timer = 2.5,
                        })
                    end
                    game._raid.partyInviteInput = ""
                    game._raid.partyInviteActive = false
                end
                return
            end
        end

        -- Leave/Disband button
        if game._raid.partyData and ui._partyLeaveBtn then
            local btn = ui._partyLeaveBtn
            if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                if client then
                    client:emit("party_leave", {})
                end
                return
            end
        end
    end

    if ui.showZoneList and button == 1 then
        local W = love.graphics.getWidth()
        local listW = 350
        local itemH = 40
        local listX = (W - listW) / 2
        local startY = 90

        for i, z in ipairs(zoneList) do
            local zy = startY + (i - 1) * (itemH + 6)
            if x >= listX and x <= listX + listW and y >= zy and y <= zy + itemH then
                if zone and zone.id ~= z.id then
                    client:emit("zone_enter", { zoneId = z.id })
                end
                ui.showZoneList = false
                return
            end
        end
    end

    if ui.showInventory and button == 1 then
        local W = love.graphics.getWidth()
        local H = love.graphics.getHeight()
        local panelW = math.min(700, W - 40)
        local panelH = math.min(560, H - 60)
        local panelX = (W - panelW) / 2
        local panelY = (H - panelH) / 2

        -- Tab clicks
        local tabW = panelW / 3
        for i, tab in ipairs({"resources", "items", "crafting"}) do
            local tx = panelX + (i - 1) * tabW
            local ty = panelY + 35
            if x >= tx + 2 and x <= tx + tabW - 2 and y >= ty and y <= ty + 24 then
                ui.inventoryTab = tab
                return
            end
        end

        -- B2: Enhanced items tab clicks (equip/use/place buttons)
        if ui.inventoryTab == "items" then
            local contentY = panelY + 68
            -- Item filter subtab clicks
            local filterList = { "all", "equipment", "consumable", "material" }
            local fW = panelW / #filterList
            for i, f in ipairs(filterList) do
                local fx = panelX + (i - 1) * fW
                if x >= fx + 2 and x <= fx + fW - 2 and y >= contentY and y <= contentY + 20 then
                    ui.inventoryItemFilter = f
                    return
                end
            end
            -- Check item action buttons
            for _, btn in ipairs(inventoryItemButtons) do
                if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                    if btn.action == "equip" and client then
                        -- Auto-detect slot from item type
                        local slot = game.getEquipSlotForItem(btn.item)
                        client:emit("equip_item", { slot = slot, itemId = btn.item.id })
                    elseif btn.action == "use" and client then
                        client:emit("consume_food_item", { itemId = btn.item.id })
                    elseif btn.action == "place" then
                        game.enterPlacementMode(btn.item.type, btn.item.id)
                    end
                    return
                end
            end
        end

        -- B3: Crafting tab clicks (craft buttons only, no station filters)
        if ui.inventoryTab == "crafting" then
            for _, btn in ipairs(craftingButtons) do
                if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                    if btn.canAfford and client then
                        client:emit("craft_item", { recipeId = btn.recipe.id })
                    end
                    return
                end
            end
        end
    end

    -- B1: Equipment panel click handling
    if ui.showEquipment and button == 1 then
        for _, btn in ipairs(equipSlotButtons) do
            if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                if btn.action == "remove" and client then
                    client:emit("unequip_item", { slot = btn.slot })
                elseif btn.action == "repair" and client then
                    client:emit("repair_item", { slot = btn.slot })
                end
                return
            end
        end
    end
end

function game.mousemoved(x, y)
    -- Audio slider drag
    if game._audioSliderDrag then
        local panelW = 360
        local px = (love.graphics.getWidth() - panelW) / 2
        local sliderX = px + 130
        local sliderW = panelW - 160
        local t = math.max(0, math.min(1, (x - sliderX) / sliderW))
        game._audio.setVolume(game._audioSliderDrag, t)
    end
    -- Forward to combat UI for tile hover / path preview
    if tcState.inCombat and combatUI then
        combatUI.handleMouseMove(x, y, camera.x, camera.y)
    end
end

function game.wheelmoved(x, y)
    if ui.showGridInventory then
        if gridInv.wheelmoved(x, y) then return end
    end
    if ui.showEquipment then
        ui.equipmentScroll = math.max(0, ui.equipmentScroll - y * 30)
        return
    end
    if game._portal.show then
        game._portal.scroll = math.max(0, game._portal.scroll - y * 30)
        return
    end
    if game._trade.show then
        -- Scroll the inventory list in the game._trade panel
        game._trade.myScroll = math.max(0, game._trade.myScroll - y * 30)
        return
    end
    if game._npcShop.show then
        game._npcShop.scroll = math.max(0, game._npcShop.scroll - y * 30)
        return
    end
    if game._bank.show then
        game._bank.scroll = math.max(0, game._bank.scroll - y * 30)
        return
    end
    if game._auction.show then
        game._auction.scroll = math.max(0, game._auction.scroll - y * 30)
        return
    end
    if ui.showCardCollection then
        if ui.cardTab == "vendor" then
            game._cardVendor.scroll = math.max(0, game._cardVendor.scroll - y * 30)
        else
            ui.cardScrollY = math.max(0, ui.cardScrollY - y * 30)
        end
        return
    end
    if ui.showKnowledge then
        knowledge.scrollY = math.max(0, knowledge.scrollY - y * 30)
        return
    end
    if ui.showWorldMap then
        if y > 0 then
            mapZoom = math.min(50, mapZoom * 1.3)
        elseif y < 0 then
            mapZoom = math.max(1, mapZoom / 1.3)
        end
    end
end

-- Rarity color lookup (shared across card UI functions)
local RARITY_COLORS = {
    common = {0.53, 0.53, 0.53},
    uncommon = {0.13, 0.8, 0.13},
    rare = {0.2, 0.53, 1},
    ultra_rare = {0.67, 0.27, 1},
    mythic_rare = {1, 0.67, 0},
    legendary = {1, 0.4, 0},
    godly = {1, 0, 0},
    relic = {1, 1, 1},
}

local RARITY_ORDER = { common=1, uncommon=2, rare=3, ultra_rare=4, mythic_rare=5, legendary=6, godly=7, relic=8 }

-- Helper: check if card is equipped, returns slot index or nil
local function getCardEquipSlot(card)
    if not card or not card.instanceId then return nil end
    for i = 1, #rpg.equippedCards do
        if rpg.equippedCards[i] == card.instanceId then return i end
    end
    return nil
end

-- Helper: find first empty equip slot
local function getFirstEmptySlot()
    for i = 1, (rpg.cardSlots or 4) do
        if not rpg.equippedCards[i] then return i end
    end
    return nil
end

-- Helper: find card instance by instanceId
local function findCardByInstanceId(instanceId)
    for _, c in ipairs(rpg.cards) do
        if c.instanceId == instanceId then return c end
    end
    return nil
end

-- Helper: get filtered and sorted card list
local function getFilteredCards()
    local cards = {}
    for _, card in ipairs(rpg.cards) do
        local pass = true
        if ui.cardFilter == "equipped" then
            pass = getCardEquipSlot(card) ~= nil
        elseif ui.cardFilter == "stat_boost" then
            pass = card.type == "stat_boost"
        elseif ui.cardFilter == "passive" then
            pass = card.type == "passive_perk" or card.type == "racial_feat"
        elseif ui.cardFilter == "active_ability" then
            pass = card.type == "active_ability"
        end
        if pass then table.insert(cards, card) end
    end

    -- Sort
    if ui.cardSort == "name" then
        table.sort(cards, function(a, b) return (a.name or "") < (b.name or "") end)
    elseif ui.cardSort == "type" then
        table.sort(cards, function(a, b)
            if a.type == b.type then return (a.name or "") < (b.name or "") end
            return (a.type or "") < (b.type or "")
        end)
    else -- rarity (default)
        table.sort(cards, function(a, b)
            local ra = RARITY_ORDER[a.rarity] or 0
            local rb = RARITY_ORDER[b.rarity] or 0
            if ra == rb then return (a.name or "") < (b.name or "") end
            return ra > rb
        end)
    end
    return cards
end

-- Store card grid rects for click detection
local cardGridRects = {}
local cardGridCards = {}
local cardCollectionRect = {}  -- { px, py, pw, ph }

function game.drawCharSheet(W, H)
    -- Clear mastery button hitboxes (rebuilt each frame)
    ui._masteryButtons = {}

    -- Full character sheet overlay
    local pw = math.min(650, W - 40)
    local ph = math.min(550, H - 60)
    local px = (W - pw) / 2
    local py = (H - ph) / 2

    -- Background
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", 0, 0, W, H)
    love.graphics.setColor(0.08, 0.09, 0.14, 0.95)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    love.graphics.setColor(0.4, 0.35, 0.6, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.9, 0.8, 0.3, 1)
    love.graphics.printf("Character Sheet", px, py + 10, pw, "center")

    -- Race + Level
    love.graphics.setFont(fonts.ui)
    local raceName = rpg.race and (rpg.race:sub(1,1):upper() .. rpg.race:sub(2)) or "Unknown"
    love.graphics.setColor(0.8, 0.75, 0.6, 1)
    love.graphics.printf(raceName .. "  |  Level " .. rpg.level, px, py + 40, pw, "center")

    -- XP bar
    local barW = pw - 40
    local barH = 12
    local barX = px + 20
    local barY = py + 65
    love.graphics.setColor(0.15, 0.15, 0.2, 1)
    love.graphics.rectangle("fill", barX, barY, barW, barH, 3, 3)
    local xpFill = rpg.xpNeeded > 0 and math.min(1, rpg.xp / rpg.xpNeeded) or 0
    love.graphics.setColor(0.3, 0.7, 1, 0.9)
    love.graphics.rectangle("fill", barX, barY, barW * xpFill, barH, 3, 3)
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(1, 1, 1, 0.8)
    love.graphics.printf("XP: " .. rpg.xp .. " / " .. rpg.xpNeeded, barX, barY - 1, barW, "center")

    -- Stats (left column)
    local statY = py + 90
    local statX = px + 20
    local colW = (pw - 40) / 2

    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.7, 0.8, 1, 1)
    love.graphics.print("Primary Stats", statX, statY)
    statY = statY + 25

    local STAT_LABELS = {
        { key = "vigor",     name = "Vigor",     abbr = "VIG", color = {0.9, 0.4, 0.4}, desc = "Increases HP pool, base armor, and HP regeneration" },
        { key = "might",     name = "Might",     abbr = "MGT", color = {0.9, 0.6, 0.3}, desc = "Increases melee and physical damage" },
        { key = "finesse",   name = "Finesse",   abbr = "FIN", color = {0.3, 0.9, 0.5}, desc = "Increases critical hit chance and dodge chance" },
        { key = "acumen",    name = "Acumen",    abbr = "ACU", color = {0.4, 0.6, 1.0}, desc = "Increases magic power and mana pool" },
        { key = "resolve",   name = "Resolve",   abbr = "RES", color = {0.8, 0.5, 0.9}, desc = "Increases magic resistance and HP regeneration" },
        { key = "presence",  name = "Presence",  abbr = "PRE", color = {1.0, 0.85, 0.3}, desc = "Improves trade prices, NPC favor, and luck" },
        { key = "ingenuity", name = "Ingenuity", abbr = "ING", color = {0.5, 0.9, 0.9}, desc = "Improves crafting quality and trap detection" },
    }

    love.graphics.setFont(fonts.main)
    statAllocButtons = {}  -- clear each frame
    local hoveredStatDesc = nil
    if rpg.stats then
        local fp = rpg.stats.freePoints or 0
        local btnSize = 20
        local mx, my = love.mouse.getPosition()

        for _, stat in ipairs(STAT_LABELS) do
            local val = rpg.stats[stat.key] or 5
            local labelW = 110
            local rowH = 18

            -- Hover detection over stat label area
            if mx >= statX and mx < statX + labelW and my >= statY and my < statY + rowH then
                hoveredStatDesc = stat.desc
            end

            love.graphics.setColor(stat.color[1], stat.color[2], stat.color[3], 0.9)
            love.graphics.print(stat.name, statX, statY)
            love.graphics.setColor(1, 1, 1, 1)
            love.graphics.print(tostring(val), statX + 110, statY)

            -- Draw [+] button when free points are available
            if fp > 0 then
                local btnX = statX + 140
                local btnY = statY - 1
                local hovered = mx >= btnX and mx < btnX + btnSize and my >= btnY and my < btnY + btnSize

                -- Button background
                if hovered then
                    love.graphics.setColor(0.3, 0.8, 0.3, 0.9)
                else
                    love.graphics.setColor(0.2, 0.55, 0.2, 0.8)
                end
                love.graphics.rectangle("fill", btnX, btnY, btnSize, btnSize, 3, 3)

                -- Button border
                if hovered then
                    love.graphics.setColor(0.5, 1.0, 0.5, 1)
                else
                    love.graphics.setColor(0.3, 0.7, 0.3, 0.6)
                end
                love.graphics.setLineWidth(1)
                love.graphics.rectangle("line", btnX, btnY, btnSize, btnSize, 3, 3)

                -- "+" text centered in button
                love.graphics.setColor(1, 1, 1, 1)
                love.graphics.printf("+", btnX, btnY + 2, btnSize, "center")

                -- Store hit rect for click handling
                statAllocButtons[#statAllocButtons + 1] = {
                    key = stat.key,
                    x = btnX, y = btnY, w = btnSize, h = btnSize,
                }
            end

            statY = statY + 20
        end

        -- Free points display
        if fp > 0 then
            statY = statY + 5
            love.graphics.setColor(1, 0.85, 0.2, 1)
            love.graphics.print("Free Points: " .. fp, statX, statY)
            statY = statY + 20
        end
    end

    -- Stat tooltip (drawn after all stats so it renders on top)
    if hoveredStatDesc then
        local mx, my = love.mouse.getPosition()
        love.graphics.setFont(fonts.main)
        local ttW = fonts.main:getWidth(hoveredStatDesc) + 16
        local ttH = 24
        local ttX = mx + 12
        local ttY = my - ttH - 4
        -- Keep tooltip on screen
        local sw = love.graphics.getWidth()
        if ttX + ttW > sw then ttX = sw - ttW - 4 end
        if ttY < 0 then ttY = my + 16 end
        love.graphics.setColor(0.08, 0.08, 0.12, 0.92)
        love.graphics.rectangle("fill", ttX, ttY, ttW, ttH, 4, 4)
        love.graphics.setColor(0.5, 0.6, 0.8, 0.7)
        love.graphics.setLineWidth(1)
        love.graphics.rectangle("line", ttX, ttY, ttW, ttH, 4, 4)
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.print(hoveredStatDesc, ttX + 8, ttY + 5)
    end

    -- Computed stats (if available)
    if rpg.computedStats then
        statY = statY + 10
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.7, 0.8, 1, 1)
        love.graphics.print("Derived Stats", statX, statY)
        statY = statY + 25
        love.graphics.setFont(fonts.main)

        local derived = {
            { label = "HP", value = rpg.computedStats.hp },
            { label = "Crit Chance", value = rpg.computedStats.critChance and string.format("%.1f%%", rpg.computedStats.critChance * 100) },
            { label = "Dodge", value = rpg.computedStats.dodgeChance and string.format("%.1f%%", rpg.computedStats.dodgeChance * 100) },
            { label = "Magic Resist", value = rpg.computedStats.magicResist and string.format("%.1f%%", rpg.computedStats.magicResist * 100) },
            { label = "XP Bonus", value = rpg.computedStats.xpBonus and string.format("%.0f%%", (rpg.computedStats.xpBonus - 1) * 100) },
        }
        for _, d in ipairs(derived) do
            if d.value then
                love.graphics.setColor(0.7, 0.7, 0.8, 0.9)
                love.graphics.print(d.label .. ": ", statX, statY)
                love.graphics.setColor(1, 1, 1, 1)
                love.graphics.print(tostring(d.value), statX + 120, statY)
                statY = statY + 18
            end
        end
    end

    -- Skills (right column)
    local skillX = px + 20 + colW
    local skillY = py + 90

    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.7, 0.8, 1, 1)
    love.graphics.print("Skills", skillX, skillY)
    skillY = skillY + 25

    love.graphics.setFont(fonts.main)
    if skills then
        -- Sort skills by level descending
        local skillList = {}
        for sName, sData in pairs(skills) do
            table.insert(skillList, { name = sName, level = sData.level or 1, xp = sData.xp or 0 })
        end
        table.sort(skillList, function(a, b) return a.level > b.level end)

        local SKILL_COLORS = {
            mining = {0.6, 0.7, 0.9}, woodcutting = {0.5, 0.8, 0.5},
            farming = {0.4, 0.8, 0.3}, fishing = {0.3, 0.6, 0.9},
            cooking = {0.9, 0.6, 0.3}, glassworking = {0.6, 0.8, 1.0},
            crafting = {0.8, 0.7, 0.5}, cogworking = {0.7, 0.7, 0.8},
            magic = {0.6, 0.4, 1.0}, melee = {0.9, 0.4, 0.4},
        }

        for _, s in ipairs(skillList) do
            -- Skip sub-skills below level 2 to avoid clutter
            local isSub = s.name:find("_") ~= nil
            if not isSub or s.level > 1 then
                local displayName = s.name:gsub("_", " ")
                displayName = displayName:sub(1,1):upper() .. displayName:sub(2)
                local baseSkill = s.name:match("^([^_]+)")
                local col = SKILL_COLORS[baseSkill] or {0.6, 0.6, 0.7}

                love.graphics.setColor(col[1], col[2], col[3], 0.9)
                love.graphics.print(displayName, skillX, skillY)
                love.graphics.setColor(1, 1, 1, 1)
                love.graphics.print("Lv." .. s.level, skillX + 150, skillY)

                -- Mini XP bar
                local xpNeeded = 100 * s.level
                local fill = xpNeeded > 0 and math.min(1, s.xp / xpNeeded) or 0
                love.graphics.setColor(0.2, 0.2, 0.3, 0.8)
                love.graphics.rectangle("fill", skillX + 200, skillY + 3, 80, 10, 2, 2)
                love.graphics.setColor(col[1], col[2], col[3], 0.7)
                love.graphics.rectangle("fill", skillX + 200, skillY + 3, 80 * fill, 10, 2, 2)

                -- [M] mastery button
                local mbx = skillX + 290
                local mby = skillY
                local mbw, mbh = 20, 16
                local mx, my = love.mouse.getPosition()
                local mHover = mx >= mbx and mx < mbx + mbw and my >= mby and my < mby + mbh
                love.graphics.setColor(0.3, 0.5, 0.7, mHover and 1.0 or 0.6)
                love.graphics.rectangle("fill", mbx, mby, mbw, mbh, 3, 3)
                love.graphics.setColor(1, 1, 1, mHover and 1.0 or 0.8)
                love.graphics.print("M", mbx + 5, mby + 1)

                -- Store button hitbox for click detection
                if not ui._masteryButtons then ui._masteryButtons = {} end
                table.insert(ui._masteryButtons, { x = mbx, y = mby, w = mbw, h = mbh, skill = s.name })

                skillY = skillY + 18
                if skillY > py + ph - 30 then break end
            end
        end
    end

    -- Equipped cards section (bottom)
    local cardY = py + ph - 80
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.7, 0.8, 1, 1)
    love.graphics.print("Equipped Cards (" .. rpg.cardSlots .. " slots)", px + 20, cardY)
    cardY = cardY + 22

    love.graphics.setFont(fonts.small)
    local slotW = 70
    ui._charSheetSlots = {}
    for i = 1, 8 do
        local sx = px + 20 + (i - 1) * (slotW + 5)
        local mx, my = love.mouse.getPosition()
        local hovered = mx >= sx and mx < sx + slotW and my >= cardY and my < cardY + 30
        if i <= rpg.cardSlots then
            love.graphics.setColor(0.15, 0.18, 0.25, hovered and 0.95 or 0.9)
            love.graphics.rectangle("fill", sx, cardY, slotW, 30, 3, 3)
            if rpg.equippedCards[i] then
                -- Find the card to show its name
                local card = findCardByInstanceId(rpg.equippedCards[i])
                local cardName = card and card.name or "Card"
                local rc = card and RARITY_COLORS[card.rarity] or {0.8, 0.7, 0.3}
                -- Truncate name if too long
                if fonts.small:getWidth(cardName) > slotW - 4 then
                    while #cardName > 3 and fonts.small:getWidth(cardName .. "..") > slotW - 4 do
                        cardName = cardName:sub(1, -2)
                    end
                    cardName = cardName .. ".."
                end
                love.graphics.setColor(rc[1], rc[2], rc[3], 1)
                love.graphics.printf(cardName, sx, cardY + 8, slotW, "center")
                ui._charSheetSlots[i] = { x = sx, y = cardY, w = slotW, h = 30, instanceId = rpg.equippedCards[i] }
            else
                love.graphics.setColor(0.4, 0.4, 0.5, 0.6)
                love.graphics.printf("Empty", sx, cardY + 8, slotW, "center")
            end
            love.graphics.setColor(hovered and 0.6 or 0.4, hovered and 0.6 or 0.4, hovered and 0.7 or 0.5, hovered and 0.8 or 0.5)
            love.graphics.rectangle("line", sx, cardY, slotW, 30, 3, 3)
        else
            love.graphics.setColor(0.1, 0.1, 0.12, 0.5)
            love.graphics.rectangle("fill", sx, cardY, slotW, 30, 3, 3)
            love.graphics.setColor(0.2, 0.2, 0.25, 0.4)
            love.graphics.printf("Locked", sx, cardY + 8, slotW, "center")
        end
    end

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("[C] or [ESC] to close", px, py + ph - 18, pw, "center")
end

-- ── Card Tooltip (hover detail for shop + collection) ──
local _hoveredCardData = nil  -- set per frame by vendor/collection draw

function game.drawCardTooltip(card, W, H)
    if not card then return end
    local mx, my = love.mouse.getPosition()

    -- Build tooltip lines
    local lines = {}
    local colors = {}

    local function addLine(text, r, g, b, a)
        table.insert(lines, text)
        table.insert(colors, {r or 0.8, g or 0.8, b or 0.8, a or 1})
    end

    -- Header: name + rarity
    local rc = RARITY_COLORS[card.rarity] or {0.7, 0.7, 0.7}
    addLine(card.name or "?", rc[1], rc[2], rc[3])
    local rarLabel = (card.rarity or "?"):gsub("_", " ")
    local typeLabel = (card.type or "?"):gsub("_", " ")
    addLine(rarLabel .. " | " .. typeLabel, 0.6, 0.6, 0.7)

    -- Archetype
    if card.archetype then
        addLine("Archetype: " .. card.archetype:gsub("_", " "), 0.5, 0.7, 0.5)
    end

    addLine("", 0.3, 0.3, 0.3) -- separator

    -- Active ability stats
    if card.type == "active_ability" then
        -- Resource cost
        local costStr = nil
        if card.manaCost and card.manaCost > 0 then
            costStr = card.manaCost .. " Mana"
        elseif card.bloodlustCost and card.bloodlustCost > 0 then
            costStr = card.bloodlustCost .. " Bloodlust"
        elseif card.focusCost and card.focusCost > 0 then
            costStr = card.focusCost .. " Focus"
        elseif card.staminaCost and card.staminaCost > 0 then
            costStr = card.staminaCost .. " Stamina"
        elseif card.resourceType then
            local resName = card.resourceType:sub(1,1):upper() .. card.resourceType:sub(2)
            local cost = card.manaCost or card.bloodlustCost or card.focusCost or card.staminaCost or 0
            if cost > 0 then
                costStr = cost .. " " .. resName
            else
                costStr = resName
            end
        end
        if costStr then addLine("Cost: " .. costStr, 0.3, 0.7, 1) end

        -- Range
        if card.range then
            local rangeStr = card.range == 0 and "Self" or (card.range == 1 and "Melee (1)" or tostring(card.range) .. " tiles")
            addLine("Range: " .. rangeStr, 0.8, 0.8, 0.5)
        end

        -- Target
        if card.targetType then
            local targetStr = card.targetType:gsub("_", " ")
            targetStr = targetStr:sub(1,1):upper() .. targetStr:sub(2)
            addLine("Target: " .. targetStr, 0.7, 0.7, 0.8)
        end

        -- Cooldown
        if card.cooldown and card.cooldown > 0 then
            addLine("Cooldown: " .. card.cooldown .. " turns", 0.8, 0.6, 0.4)
        end

        -- AOE
        if card.aoeRadius and card.aoeRadius > 0 then
            addLine("AoE Radius: " .. card.aoeRadius, 1, 0.6, 0.3)
        end

        addLine("", 0.3, 0.3, 0.3) -- separator

        -- Damage
        if card.baseDamage and card.baseDamage > 0 then
            local dmgStr = tostring(card.baseDamage)
            if card.element then dmgStr = dmgStr .. " " .. card.element end
            dmgStr = dmgStr .. " damage"
            addLine(dmgStr, 1, 0.4, 0.3)
        end

        -- Healing
        if card.baseHeal and card.baseHeal > 0 then
            addLine(card.baseHeal .. " healing", 0.3, 1, 0.4)
        end

        -- Scaling
        if card.scalingStat and card.scalingFactor then
            local pct = math.floor(card.scalingFactor * 100)
            addLine("+" .. pct .. "% " .. card.scalingStat .. " scaling", 0.6, 0.8, 1)
        end

        -- Status effect
        if card.statusEffect then
            local dur = card.statusDuration and (" (" .. card.statusDuration .. " turns)") or ""
            addLine("Applies: " .. card.statusEffect:gsub("_", " ") .. dur, 1, 0.7, 0.3)
        end

        -- Tile effect
        if card.onHitTile or card.tileEffect then
            local tile = card.onHitTile or card.tileEffect
            addLine("Creates: " .. tile .. " tile", 0.7, 0.5, 1)
        end

    -- Passive perk / stat boost stats
    else
        if card.effects then
            for _, eff in ipairs(card.effects) do
                if type(eff) == "table" then
                    local effType = (eff.type or ""):gsub("_", " ")
                    if eff.value then
                        local valStr
                        if type(eff.value) == "number" and eff.value < 1 and eff.value > 0 then
                            valStr = "+" .. math.floor(eff.value * 100) .. "%"
                        else
                            valStr = "+" .. tostring(eff.value)
                        end
                        local detail = valStr .. " " .. effType
                        if eff.stat then detail = valStr .. " " .. eff.stat end
                        if eff.skill then detail = valStr .. " " .. eff.skill .. " XP" end
                        if eff.element then detail = detail .. " (" .. eff.element .. ")" end
                        addLine(detail, 0.5, 0.9, 0.6)
                    elseif eff.description then
                        addLine(eff.description, 0.5, 0.9, 0.6)
                    else
                        addLine(effType, 0.5, 0.9, 0.6)
                    end
                end
            end
        end

        -- Combat passive
        if card.combatPassive and type(card.combatPassive) == "table" then
            local cp = card.combatPassive
            local cpType = (cp.type or ""):gsub("_", " ")
            if cp.value then
                addLine("Combat: +" .. tostring(cp.value) .. " " .. cpType, 0.6, 0.7, 1)
            else
                addLine("Combat: " .. cpType, 0.6, 0.7, 1)
            end
        end
    end

    -- Description
    if card.description and card.description ~= "" then
        addLine("", 0.3, 0.3, 0.3)
        addLine(card.description, 0.7, 0.7, 0.7)
    end

    -- Tags
    if card.tags and #card.tags > 0 then
        local tagStr = table.concat(card.tags, ", ")
        addLine("Tags: " .. tagStr, 0.4, 0.4, 0.5)
    end

    -- Calculate tooltip size
    love.graphics.setFont(fonts.small)
    local lineH = 15
    local tooltipW = 220
    local tooltipH = #lines * lineH + 12
    local tx = mx + 16
    local ty = my - 10

    -- Keep on screen
    if tx + tooltipW > W - 4 then tx = mx - tooltipW - 8 end
    if ty + tooltipH > H - 4 then ty = H - tooltipH - 4 end
    if ty < 4 then ty = 4 end

    -- Draw background
    love.graphics.setColor(0.06, 0.06, 0.1, 0.95)
    love.graphics.rectangle("fill", tx, ty, tooltipW, tooltipH, 4, 4)
    love.graphics.setColor(0.4, 0.4, 0.5, 0.7)
    love.graphics.setLineWidth(1)
    love.graphics.rectangle("line", tx, ty, tooltipW, tooltipH, 4, 4)

    -- Draw lines
    for i, line in ipairs(lines) do
        local c = colors[i]
        love.graphics.setColor(c[1], c[2], c[3], c[4])
        love.graphics.printf(line, tx + 6, ty + 4 + (i - 1) * lineH, tooltipW - 12, "left")
    end
end

-- Mastery tree panel
function game.drawMasteryPanel(W, H)
    local pw = math.min(520, W - 40)
    local ph = math.min(480, H - 60)
    local px = (W - pw) / 2
    local py = (H - ph) / 2

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.08, 0.08, 0.12, 0.95)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    love.graphics.setColor(0.3, 0.4, 0.6, 0.8)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title
    love.graphics.setFont(fonts.ui)
    local skillLabel = mastery.skillName or "?"
    skillLabel = skillLabel:gsub("_", " ")
    skillLabel = skillLabel:sub(1,1):upper() .. skillLabel:sub(2)
    love.graphics.setColor(0.8, 0.9, 1, 1)
    love.graphics.printf(skillLabel .. " Mastery", px, py + 8, pw, "center")

    -- Points + skill level
    love.graphics.setFont(fonts.main)
    love.graphics.setColor(0.6, 0.8, 1, 0.9)
    love.graphics.print("Skill Lv." .. mastery.skillLevel .. "  |  Points: " .. mastery.points, px + 15, py + 32)

    -- Reset button
    local rbx, rby, rbw, rbh = px + pw - 80, py + 30, 65, 20
    local mx, my = love.mouse.getPosition()
    local rbHover = mx >= rbx and mx < rbx + rbw and my >= rby and my < rby + rbh
    love.graphics.setColor(0.6, 0.2, 0.2, rbHover and 0.9 or 0.5)
    love.graphics.rectangle("fill", rbx, rby, rbw, rbh, 4, 4)
    love.graphics.setColor(1, 1, 1, rbHover and 1 or 0.7)
    love.graphics.print("Reset", rbx + 12, rby + 2)
    ui._masteryResetBtn = { x = rbx, y = rby, w = rbw, h = rbh }

    -- Feedback message
    if mastery.message and mastery.messageTimer > 0 then
        love.graphics.setColor(1, 0.85, 0.2, math.min(1, mastery.messageTimer))
        love.graphics.printf(mastery.message, px + 10, py + ph - 22, pw - 20, "center")
    end

    if not mastery.tree then
        love.graphics.setColor(0.6, 0.6, 0.6, 0.8)
        love.graphics.printf("Loading...", px, py + ph / 2, pw, "center")
        return
    end

    -- Draw node grid (5 cols x 7 rows)
    local gridX = px + 30
    local gridY = py + 60
    local cellW = (pw - 60) / 5
    local cellH = (ph - 110) / 7
    local nodeR = math.min(cellW, cellH) * 0.3

    -- Branch colors
    local BRANCH_COLORS = {
        [-1] = {0.5, 0.6, 0.7},  -- root/foundation: gray
        [0]  = {0.9, 0.3, 0.3},  -- branch 0: red
        [1]  = {0.3, 0.5, 0.9},  -- branch 1: blue
        [2]  = {0.3, 0.8, 0.4},  -- branch 2: green
        [3]  = {1.0, 0.8, 0.2},  -- branch 3: gold
    }

    -- Build lookup for prerequisite lines
    local nodeById = {}
    for _, node in ipairs(mastery.tree) do
        nodeById[node.id] = node
    end

    -- Draw prerequisite lines first
    love.graphics.setLineWidth(2)
    for _, node in ipairs(mastery.tree) do
        local nx = gridX + node.x * cellW + cellW / 2
        local ny = gridY + node.y * cellH + cellH / 2
        if node.requires then
            for _, reqId in ipairs(node.requires) do
                local reqNode = nodeById[reqId]
                if reqNode then
                    local rx = gridX + reqNode.x * cellW + cellW / 2
                    local ry = gridY + reqNode.y * cellH + cellH / 2
                    local invested = (mastery.invested[reqId] or 0) >= 1
                    love.graphics.setColor(0.3, 0.4, 0.5, invested and 0.7 or 0.3)
                    love.graphics.line(rx, ry, nx, ny)
                end
            end
        end
    end
    love.graphics.setLineWidth(1)

    -- Draw nodes
    ui._masteryNodeHitboxes = {}
    mastery.hoverNode = nil
    for _, node in ipairs(mastery.tree) do
        local nx = gridX + node.x * cellW + cellW / 2
        local ny = gridY + node.y * cellH + cellH / 2
        local rank = mastery.invested[node.id] or 0
        local maxed = rank >= node.maxRank
        local available = rank < node.maxRank and mastery.points >= 1
        -- Check prereqs met
        if available and node.requires then
            for _, reqId in ipairs(node.requires) do
                if (mastery.invested[reqId] or 0) < 1 then
                    available = false
                    break
                end
            end
        end

        local col = BRANCH_COLORS[node.branch] or BRANCH_COLORS[-1]
        local hovered = (mx - nx)^2 + (my - ny)^2 < nodeR^2

        if hovered then mastery.hoverNode = node end

        -- Node circle
        if maxed then
            love.graphics.setColor(1, 0.85, 0.2, 0.95)
        elseif rank > 0 then
            love.graphics.setColor(col[1], col[2], col[3], 0.9)
        elseif available then
            love.graphics.setColor(col[1] * 0.6, col[2] * 0.6, col[3] * 0.6, 0.7)
        else
            love.graphics.setColor(0.25, 0.25, 0.3, 0.5)
        end
        love.graphics.circle("fill", nx, ny, nodeR)

        -- Border
        if hovered then
            love.graphics.setColor(1, 1, 1, 0.9)
        elseif maxed then
            love.graphics.setColor(1, 0.85, 0.2, 0.7)
        else
            love.graphics.setColor(0.4, 0.5, 0.6, 0.5)
        end
        love.graphics.circle("line", nx, ny, nodeR)

        -- Rank text inside node
        love.graphics.setFont(fonts.small)
        if rank > 0 or maxed then
            love.graphics.setColor(1, 1, 1, 1)
        else
            love.graphics.setColor(0.6, 0.6, 0.6, 0.6)
        end
        local rankText = rank .. "/" .. node.maxRank
        local tw = fonts.small:getWidth(rankText)
        love.graphics.print(rankText, nx - tw / 2, ny - 5)

        table.insert(ui._masteryNodeHitboxes, { x = nx, y = ny, r = nodeR, node = node })
    end

    -- Tooltip for hovered node
    if mastery.hoverNode then
        local node = mastery.hoverNode
        local rank = mastery.invested[node.id] or 0
        love.graphics.setFont(fonts.main)
        local ttW = 220
        local ttH = 70
        local ttX = math.min(mx + 15, W - ttW - 5)
        local ttY = math.min(my + 15, H - ttH - 5)
        love.graphics.setColor(0.05, 0.05, 0.1, 0.95)
        love.graphics.rectangle("fill", ttX, ttY, ttW, ttH, 4, 4)
        love.graphics.setColor(0.4, 0.5, 0.7, 0.8)
        love.graphics.rectangle("line", ttX, ttY, ttW, ttH, 4, 4)
        love.graphics.setColor(1, 0.9, 0.7, 1)
        love.graphics.print(node.name, ttX + 6, ttY + 4)
        love.graphics.setColor(0.7, 0.8, 0.9, 0.9)
        love.graphics.setFont(fonts.small)
        love.graphics.printf(node.desc, ttX + 6, ttY + 22, ttW - 12, "left")
        love.graphics.setColor(0.5, 0.7, 1, 0.8)
        love.graphics.print("Rank: " .. rank .. "/" .. node.maxRank, ttX + 6, ttY + 50)
    end

    -- ESC hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.print("[ESC] Close  |  Click node to invest", px + 10, py + ph - 18)
end

function game.drawCardCollection(W, H)
    _hoveredCardData = nil  -- reset each frame

    local pw = math.min(750, W - 40)
    local ph = math.min(560, H - 60)
    local px = (W - pw) / 2
    local py = (H - ph) / 2
    cardCollectionRect = { px = px, py = py, pw = pw, ph = ph }

    -- Background
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", 0, 0, W, H)
    love.graphics.setColor(0.08, 0.09, 0.14, 0.95)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    love.graphics.setColor(0.5, 0.4, 0.2, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(1, 0.85, 0.2, 1)
    love.graphics.printf("Card Collection (" .. #rpg.cards .. "/1000)", px, py + 8, pw, "center")

    -- Pending packs
    if rpg.pendingPacks and rpg.pendingPacks > 0 then
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(1, 0.85, 0.2, 0.7 + 0.3 * math.sin(love.timer.getTime() * 3))
        love.graphics.printf(rpg.pendingPacks .. " Pack(s) Available! [Click to Open]", px, py + 32, pw, "center")
    end

    -- Tab bar: Collection | Vendor | Loadouts
    local tabY = py + 46
    local tabNames = { "collection", "vendor", "loadouts" }
    local tabLabels = { "Collection", "Shop", "Loadouts" }
    local tabW = math.floor((pw - 20) / #tabNames)
    ui._cardTabBtns = {}
    love.graphics.setFont(fonts.hud)
    for ti, tname in ipairs(tabNames) do
        local tx = px + 10 + (ti - 1) * tabW
        local active = (ui.cardTab == tname)
        if active then
            love.graphics.setColor(0.2, 0.3, 0.15, 0.95)
        else
            love.graphics.setColor(0.08, 0.1, 0.14, 0.7)
        end
        love.graphics.rectangle("fill", tx, tabY, tabW - 2, 20, 3, 3)
        love.graphics.setColor(active and 0.9 or 0.5, active and 0.9 or 0.5, active and 0.5 or 0.3, 1)
        love.graphics.printf(tabLabels[ti], tx, tabY + 2, tabW - 2, "center")
        ui._cardTabBtns[ti] = { x = tx, y = tabY, w = tabW - 2, h = 20, tab = tname }
    end

    if ui.cardTab == "vendor" then
        game.drawCardVendorTab(px, py + 70, pw, ph - 90)
    elseif ui.cardTab == "loadouts" then
        game.drawCardLoadoutsTab(px, py + 70, pw, ph - 90)
    else
        game.drawCardCollectionTab(px, py + 70, pw, ph - 90)
    end

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("[K] or [ESC] to close", px, py + ph - 16, pw, "center")

    -- Card detail overlay (drawn on top)
    if ui.selectedCard then
        game.drawCardDetailView(W, H)
    end

    -- Hover tooltip (drawn on top of everything)
    if _hoveredCardData and not ui.selectedCard then
        game.drawCardTooltip(_hoveredCardData, W, H)
    end
end

function game.drawCardCollectionTab(px, py, pw, ph)
    local mx, my = love.mouse.getPosition()

    -- Filter buttons
    local filterY = py
    local filters = {
        { id = "all", label = "All" },
        { id = "stat_boost", label = "Stat" },
        { id = "passive", label = "Passive" },
        { id = "active_ability", label = "Active" },
        { id = "equipped", label = "Equipped" },
    }
    local filterBtnW = math.floor((pw - 20) / #filters)
    ui._filterBtns = {}
    love.graphics.setFont(fonts.small)
    for fi, f in ipairs(filters) do
        local fx = px + 10 + (fi - 1) * filterBtnW
        local active = (ui.cardFilter == f.id)
        if active then
            love.graphics.setColor(0.25, 0.2, 0.1, 0.95)
        else
            love.graphics.setColor(0.1, 0.1, 0.14, 0.6)
        end
        love.graphics.rectangle("fill", fx, filterY, filterBtnW - 2, 16, 2, 2)
        love.graphics.setColor(active and 1 or 0.5, active and 0.85 or 0.5, active and 0.2 or 0.3, 1)
        love.graphics.printf(f.label, fx, filterY + 1, filterBtnW - 2, "center")
        ui._filterBtns[fi] = { x = fx, y = filterY, w = filterBtnW - 2, h = 16, filter = f.id }
    end

    -- Sort buttons
    local sortY = filterY + 20
    local sorts = {
        { id = "rarity", label = "Rarity" },
        { id = "name", label = "Name" },
        { id = "type", label = "Type" },
    }
    local sortBtnW = 60
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.7)
    love.graphics.print("Sort:", px + 10, sortY + 1)
    ui._sortBtns = {}
    for si, s in ipairs(sorts) do
        local sx = px + 50 + (si - 1) * (sortBtnW + 2)
        local active = (ui.cardSort == s.id)
        if active then
            love.graphics.setColor(0.15, 0.2, 0.3, 0.9)
        else
            love.graphics.setColor(0.1, 0.1, 0.14, 0.5)
        end
        love.graphics.rectangle("fill", sx, sortY, sortBtnW, 16, 2, 2)
        love.graphics.setColor(active and 0.6 or 0.4, active and 0.8 or 0.5, active and 1 or 0.5, 1)
        love.graphics.printf(s.label, sx, sortY + 1, sortBtnW, "center")
        ui._sortBtns[si] = { x = sx, y = sortY, w = sortBtnW, h = 16, sort = s.id }
    end

    -- Fusion mode indicator
    if game._fusionMode.active and game._fusionMode.card1 then
        love.graphics.setColor(0.9, 0.5, 1, 0.8 + 0.2 * math.sin(love.timer.getTime() * 4))
        love.graphics.printf("FUSION: Select a second card of same rarity (" .. (game._fusionMode.card1.rarity or "?"):gsub("_"," ") .. ") — ESC to cancel", px + 10, sortY, pw - 20, "right")
    end

    -- Card grid
    local startY = sortY + 22
    local cardW = 130
    local cardH = 80
    local gap = 8
    local cols = math.floor((pw - 20) / (cardW + gap))
    local startX = px + (pw - cols * (cardW + gap) + gap) / 2

    local filteredCards = getFilteredCards()

    -- Clip region for scrollable list
    love.graphics.setScissor(px + 4, startY, pw - 8, ph - (startY - py) - 20)

    cardGridRects = {}
    cardGridCards = {}

    love.graphics.setFont(fonts.small)
    for i, card in ipairs(filteredCards) do
        local col = (i - 1) % cols
        local row = math.floor((i - 1) / cols)
        local cx = startX + col * (cardW + gap)
        local cy = startY + row * (cardH + gap) - ui.cardScrollY

        if cy + cardH >= startY and cy <= py + ph - 20 then
            local rc = RARITY_COLORS[card.rarity] or {0.5, 0.5, 0.5}
            local isHovered = mx >= cx and mx < cx + cardW and my >= cy and my < cy + cardH
            local isEquipped = getCardEquipSlot(card) ~= nil
            local isFusionTarget = game._fusionMode.active and game._fusionMode.card1 and
                card.rarity == game._fusionMode.card1.rarity and card.instanceId ~= game._fusionMode.card1.instanceId and
                not getCardEquipSlot(card)

            if isHovered then _hoveredCardData = card end

            -- Card background
            if isFusionTarget then
                love.graphics.setColor(0.3, 0.15, 0.35, 0.95)
            elseif isHovered then
                love.graphics.setColor(0.18, 0.18, 0.25, 0.95)
            else
                love.graphics.setColor(0.12, 0.12, 0.18, 0.9)
            end
            love.graphics.rectangle("fill", cx, cy, cardW, cardH, 4, 4)

            -- Rarity border
            local borderAlpha = isHovered and 1 or 0.8
            love.graphics.setColor(rc[1], rc[2], rc[3], borderAlpha)
            love.graphics.setLineWidth(card.style == "holographic" and 2 or 1)
            love.graphics.rectangle("line", cx, cy, cardW, cardH, 4, 4)

            -- Card name
            love.graphics.setColor(1, 1, 1, 0.95)
            love.graphics.printf(card.name or "?", cx + 4, cy + 4, cardW - 8, "left")

            -- Rarity label
            local rarityLabel = (card.rarity or "?"):gsub("_", " ")
            love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
            love.graphics.printf(rarityLabel, cx + 4, cy + 20, cardW - 8, "left")

            -- Type
            love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
            local typeLabel = (card.type or "?"):gsub("_", " ")
            love.graphics.printf(typeLabel, cx + 4, cy + 36, cardW - 8, "left")

            -- Style indicator
            if card.style and card.style ~= "normal" then
                love.graphics.setColor(1, 0.85, 0.2, 0.8)
                love.graphics.printf(card.style, cx + 4, cy + 52, cardW - 8, "left")
            end

            -- Fusion count
            if card.fusionCount and card.fusionCount > 0 then
                love.graphics.setColor(0.9, 0.5, 1, 0.9)
                love.graphics.printf("+" .. card.fusionCount, cx + 4, cy + cardH - 16, cardW - 8, "right")
            end

            -- Equipped indicator
            if isEquipped then
                love.graphics.setColor(0.3, 1, 0.3, 0.8)
                love.graphics.printf("EQUIPPED", cx + 4, cy + cardH - 16, cardW - 8, "left")
            end

            -- Fusion target highlight
            if isFusionTarget then
                love.graphics.setColor(0.9, 0.5, 1, 0.3 + 0.2 * math.sin(love.timer.getTime() * 5))
                love.graphics.rectangle("fill", cx, cy, cardW, cardH, 4, 4)
            end

            cardGridRects[i] = { x = cx, y = cy, w = cardW, h = cardH }
            cardGridCards[i] = card
        end
    end

    love.graphics.setScissor()

    if #filteredCards == 0 then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
        love.graphics.printf("No cards match this filter.", px, py + ph / 2 - 10, pw, "center")
    end

    -- Drop Rate Disclosure (shown when packs are pending)
    if rpg.pendingPacks and rpg.pendingPacks > 0 then
        local drx = px + pw - 148
        local dry = startY
        local drW = 140
        local drH = 128

        love.graphics.setColor(0.06, 0.06, 0.1, 0.92)
        love.graphics.rectangle("fill", drx, dry, drW, drH, 4, 4)
        love.graphics.setColor(0.4, 0.35, 0.5, 0.6)
        love.graphics.setLineWidth(1)
        love.graphics.rectangle("line", drx, dry, drW, drH, 4, 4)

        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(0.8, 0.8, 0.9, 0.9)
        love.graphics.printf("Drop Rates:", drx + 4, dry + 4, drW - 8, "center")

        local DROP_RATES = {
            { name = "Common",     rate = "45.0%", color = {0.53, 0.53, 0.53} },
            { name = "Uncommon",   rate = "25.0%", color = {0.13, 0.8, 0.13} },
            { name = "Rare",       rate = "15.0%", color = {0.2, 0.53, 1} },
            { name = "Ultra Rare", rate = " 8.0%", color = {0.67, 0.27, 1} },
            { name = "Mythic",     rate = " 4.0%", color = {1, 0.67, 0} },
            { name = "Legendary",  rate = " 2.0%", color = {1, 0.4, 0} },
            { name = "Godly",      rate = " 0.8%", color = {1, 0, 0} },
            { name = "Relic",      rate = " 0.2%", color = {1, 1, 1} },
        }

        love.graphics.setFont(fonts.small)
        for ri, entry in ipairs(DROP_RATES) do
            local ry = dry + 18 + ri * 12
            love.graphics.setColor(entry.color[1], entry.color[2], entry.color[3], 0.9)
            love.graphics.print(entry.name, drx + 8, ry)
            love.graphics.setColor(0.8, 0.8, 0.8, 0.8)
            love.graphics.printf(entry.rate, drx + 4, ry, drW - 12, "right")
        end
    end
end

-- Card Detail View overlay
function game.drawCardDetailView(W, H)
    local card = ui.selectedCard
    if not card then return end

    local dw = math.min(400, W - 60)
    local dh = math.min(450, H - 80)
    local dx = (W - dw) / 2
    local dy = (H - dh) / 2
    local rc = RARITY_COLORS[card.rarity] or {0.5, 0.5, 0.5}
    local equipSlot = getCardEquipSlot(card)

    -- Dim behind
    love.graphics.setColor(0, 0, 0, 0.5)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel
    love.graphics.setColor(0.06, 0.07, 0.12, 0.97)
    love.graphics.rectangle("fill", dx, dy, dw, dh, 8, 8)
    love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", dx, dy, dw, dh, 8, 8)

    local cy = dy + 12

    -- Card name
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf(card.name or "Unknown Card", dx + 10, cy, dw - 20, "center")
    cy = cy + 28

    -- Rarity + Type + Archetype
    love.graphics.setFont(fonts.ui)
    local rarityLabel = (card.rarity or "?"):gsub("_", " "):upper()
    love.graphics.setColor(rc[1], rc[2], rc[3], 1)
    love.graphics.printf(rarityLabel, dx + 10, cy, dw - 20, "center")
    cy = cy + 20

    love.graphics.setFont(fonts.main)
    love.graphics.setColor(0.7, 0.7, 0.8, 0.9)
    local typeStr = (card.type or "?"):gsub("_", " ")
    if card.archetype then typeStr = typeStr .. "  |  " .. card.archetype end
    love.graphics.printf(typeStr, dx + 10, cy, dw - 20, "center")
    cy = cy + 18

    -- Style
    if card.style and card.style ~= "normal" then
        love.graphics.setColor(1, 0.85, 0.2, 0.9)
        love.graphics.printf("Style: " .. card.style, dx + 10, cy, dw - 20, "center")
        cy = cy + 16
    end

    -- Fusion count
    if card.fusionCount and card.fusionCount > 0 then
        love.graphics.setColor(0.9, 0.5, 1, 0.9)
        love.graphics.printf("Fusion Level: +" .. card.fusionCount, dx + 10, cy, dw - 20, "center")
        cy = cy + 16
    end

    cy = cy + 6

    -- Description
    if card.description and card.description ~= "" then
        love.graphics.setColor(0.8, 0.8, 0.7, 0.85)
        love.graphics.setFont(fonts.chat or fonts.main)
        love.graphics.printf(card.description, dx + 15, cy, dw - 30, "left")
        local _, descLines = (fonts.chat or fonts.main):getWrap(card.description, dw - 30)
        cy = cy + math.max(30, #descLines * (fonts.chat or fonts.main):getHeight())
    end

    -- Effects
    if card.effects and #card.effects > 0 then
        cy = cy + 4
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.6, 0.8, 0.6, 0.9)
        love.graphics.print("Effects:", dx + 15, cy)
        cy = cy + 14
        for _, eff in ipairs(card.effects) do
            local effText = eff.description or (eff.type .. ": " .. tostring(eff.value or ""))
            love.graphics.setColor(0.7, 0.9, 0.7, 0.85)
            love.graphics.printf("  " .. effText, dx + 15, cy, dw - 30, "left")
            cy = cy + 13
        end
    end

    -- Combat stats for active abilities
    if card.combatType then
        cy = cy + 4
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.6, 0.6, 0.9, 0.9)
        love.graphics.print("Combat:", dx + 15, cy)
        cy = cy + 14
        local combatLines = {}
        if card.baseDamage then table.insert(combatLines, "Damage: " .. card.baseDamage) end
        if card.manaCost then table.insert(combatLines, "Cost: " .. card.manaCost) end
        if card.range then table.insert(combatLines, "Range: " .. card.range) end
        if card.cooldown then table.insert(combatLines, "CD: " .. card.cooldown .. " turns") end
        love.graphics.setColor(0.7, 0.7, 0.9, 0.85)
        love.graphics.printf("  " .. table.concat(combatLines, "  |  "), dx + 15, cy, dw - 30, "left")
        cy = cy + 13
    end

    -- Action buttons at bottom
    local btnY = dy + dh - 40
    local btnH = 28
    local btnGap = 6
    local mx, my = love.mouse.getPosition()
    ui._cardDetailBtns = {}

    -- Calculate button layout
    local buttons = {}
    if not equipSlot then
        local emptySlot = getFirstEmptySlot()
        if emptySlot then
            table.insert(buttons, { id = "equip", label = "Equip", color = {0.2, 0.5, 0.3} })
        end
    else
        table.insert(buttons, { id = "unequip", label = "Unequip", color = {0.5, 0.3, 0.2} })
    end
    if not equipSlot then
        table.insert(buttons, { id = "fuse", label = "Fuse", color = {0.4, 0.2, 0.5} })
        table.insert(buttons, { id = "sell", label = "Sell", color = {0.5, 0.4, 0.15} })
        table.insert(buttons, { id = "game._auction", label = "Auction", color = {0.3, 0.3, 0.5} })
    end
    table.insert(buttons, { id = "close", label = "Close", color = {0.3, 0.3, 0.35} })

    local totalBtnW = 0
    local btnWidths = {}
    love.graphics.setFont(fonts.hud)
    for _, btn in ipairs(buttons) do
        local bw = math.max(70, fonts.hud:getWidth(btn.label) + 20)
        table.insert(btnWidths, bw)
        totalBtnW = totalBtnW + bw + btnGap
    end
    totalBtnW = totalBtnW - btnGap

    local bx = dx + (dw - totalBtnW) / 2
    for bi, btn in ipairs(buttons) do
        local bw = btnWidths[bi]
        local hovered = mx >= bx and mx < bx + bw and my >= btnY and my < btnY + btnH
        love.graphics.setColor(btn.color[1], btn.color[2], btn.color[3], hovered and 0.95 or 0.7)
        love.graphics.rectangle("fill", bx, btnY, bw, btnH, 4, 4)
        love.graphics.setColor(1, 1, 1, hovered and 1 or 0.8)
        love.graphics.printf(btn.label, bx, btnY + 5, bw, "center")
        ui._cardDetailBtns[bi] = { x = bx, y = btnY, w = bw, h = btnH, id = btn.id }
        bx = bx + bw + btnGap
    end
end

-- Card Vendor tab
function game.drawCardVendorTab(px, py, pw, ph)
    local mx, my = love.mouse.getPosition()

    -- Buy/Sell sub-tabs
    local subTabY = py
    local subTabW = math.floor((pw - 20) / 2)
    ui._vendorSubTabs = {}
    love.graphics.setFont(fonts.hud)

    for ti, tname in ipairs({"buy", "sell"}) do
        local tx = px + 10 + (ti - 1) * subTabW
        local active = (game._cardVendor.tab == tname)
        if active then
            love.graphics.setColor(0.15, 0.3, 0.2, 0.95)
        else
            love.graphics.setColor(0.08, 0.1, 0.14, 0.7)
        end
        love.graphics.rectangle("fill", tx, subTabY, subTabW - 2, 20, 3, 3)
        love.graphics.setColor(active and 0.9 or 0.5, active and 0.9 or 0.5, active and 0.5 or 0.3, 1)
        love.graphics.printf(tname:sub(1,1):upper() .. tname:sub(2), tx, subTabY + 2, subTabW - 2, "center")
        ui._vendorSubTabs[ti] = { x = tx, y = subTabY, w = subTabW - 2, h = 20, tab = tname }
    end

    -- Coins display
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(1, 0.85, 0.2, 0.9)
    love.graphics.printf("Coins: " .. (account and account.coins or 0), px + 10, py + ph - 6, pw - 20, "right")

    local filterH = 0
    if game._cardVendor.tab == "buy" then
        -- ── Filter row: Type filter (All / Active / Passive / Stats) ──
        local typeFilterY = subTabY + 24
        local typeNames = {"all", "active", "passive", "stat"}
        local typeLabels = {all = "All", active = "Active", passive = "Passive", stat = "Stats"}
        local typeBtnW = math.floor((pw - 20) / #typeNames)
        ui._vendorTypeFilters = {}
        for ti, tkey in ipairs(typeNames) do
            local tx = px + 10 + (ti - 1) * typeBtnW
            local active = (game._cardVendor.filterType == tkey)
            if active then
                love.graphics.setColor(0.2, 0.35, 0.5, 0.95)
            else
                love.graphics.setColor(0.1, 0.12, 0.16, 0.7)
            end
            love.graphics.rectangle("fill", tx, typeFilterY, typeBtnW - 2, 18, 3, 3)
            love.graphics.setColor(active and 1 or 0.5, active and 0.9 or 0.5, active and 0.7 or 0.4, 1)
            love.graphics.printf(typeLabels[tkey], tx, typeFilterY + 2, typeBtnW - 2, "center")
            ui._vendorTypeFilters[ti] = { x = tx, y = typeFilterY, w = typeBtnW - 2, h = 18, filter = tkey }
        end

        -- ── Filter row: Archetype filter (scrollable chips) ──
        local archFilterY = typeFilterY + 20
        -- Collect unique archetypes from catalog
        local archSet = {}
        local archOrder = {}
        for _, item in ipairs(game._cardVendor.catalog) do
            local a = item.archetype or "utility"
            if not archSet[a] then
                archSet[a] = true
                table.insert(archOrder, a)
            end
        end
        table.sort(archOrder)

        local archNames = {"all"}
        for _, a in ipairs(archOrder) do table.insert(archNames, a) end
        local archLabels = {
            all = "All", melee_dps = "Melee", tank = "Tank", pure_defense = "Defense",
            support = "Support", glass_cannon = "Mage", assassin = "Assassin",
            scout = "Scout", cc_dot = "CC/DoT", night_hunter = "Hunter",
            grappler = "Grappler", aquatic = "Aquatic", utility = "Utility",
        }

        ui._vendorArchFilters = {}
        local ax = px + 10
        for ai, akey in ipairs(archNames) do
            local label = archLabels[akey] or akey:gsub("_", " ")
            local lblW = fonts.small:getWidth(label) + 12
            local active = (game._cardVendor.filterArch == akey)
            if active then
                love.graphics.setColor(0.25, 0.4, 0.3, 0.95)
            else
                love.graphics.setColor(0.1, 0.12, 0.16, 0.7)
            end
            love.graphics.rectangle("fill", ax, archFilterY, lblW, 18, 3, 3)
            love.graphics.setColor(active and 0.7 or 0.4, active and 1 or 0.55, active and 0.7 or 0.4, 1)
            love.graphics.printf(label, ax, archFilterY + 2, lblW, "center")
            ui._vendorArchFilters[ai] = { x = ax, y = archFilterY, w = lblW, h = 18, filter = akey }
            ax = ax + lblW + 2
        end
        filterH = 44
    end

    local listY = subTabY + 26 + filterH
    local listH = ph - 36 - filterH
    local itemH = 32

    love.graphics.setScissor(px + 4, listY, pw - 8, listH)
    ui._vendorItemBtns = {}

    if game._cardVendor.tab == "buy" then
        -- Filter catalog
        local filtered = {}
        for _, item in ipairs(game._cardVendor.catalog) do
            local passArch = (game._cardVendor.filterArch == "all") or (item.archetype == game._cardVendor.filterArch)
            local passType = true
            if game._cardVendor.filterType == "active" then
                passType = (item.type == "active_ability")
            elseif game._cardVendor.filterType == "passive" then
                passType = (item.type == "passive_perk")
            elseif game._cardVendor.filterType == "stat" then
                passType = (item.type == "stat_boost" or item.type == "skill_boost")
            end
            if passArch and passType then
                table.insert(filtered, item)
            end
        end

        if #game._cardVendor.catalog == 0 then
            love.graphics.setFont(fonts.ui)
            love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
            love.graphics.printf("Loading catalog...", px, listY + 30, pw, "center")
        elseif #filtered == 0 then
            love.graphics.setFont(fonts.ui)
            love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
            love.graphics.printf("No cards match filters.", px, listY + 30, pw, "center")
        else
            love.graphics.setFont(fonts.small)
            for i, item in ipairs(filtered) do
                local iy = listY + (i - 1) * itemH - game._cardVendor.scroll
                if iy + itemH >= listY and iy < listY + listH then
                    local rc = RARITY_COLORS[item.rarity] or {0.5, 0.5, 0.5}
                    local hovered = mx >= px + 10 and mx < px + pw - 10 and my >= iy and my < iy + itemH - 2

                    if hovered then
                        _hoveredCardData = item
                        love.graphics.setColor(0.15, 0.2, 0.25, 0.8)
                    elseif i % 2 == 0 then
                        love.graphics.setColor(0.08, 0.1, 0.12, 0.3)
                    else
                        love.graphics.setColor(0, 0, 0, 0)
                    end
                    love.graphics.rectangle("fill", px + 8, iy, pw - 16, itemH - 2, 3, 3)

                    -- Name
                    love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
                    love.graphics.print(item.name or "?", px + 14, iy + 2)

                    -- Archetype + type label
                    local archLabel = item.archetype or "?"
                    local typeLabel = (item.type or "?"):gsub("_"," ")
                    love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
                    love.graphics.print(archLabel:gsub("_"," ") .. " | " .. typeLabel, px + 14, iy + 15)

                    -- Price + Buy button
                    local buyW = 50
                    local buyX = px + pw - buyW - 14
                    love.graphics.setColor(1, 0.85, 0.2, 0.9)
                    love.graphics.printf(tostring(item.price or 0) .. "c", px + 14, iy + 8, pw - buyW - 40, "right")

                    local buyHovered = mx >= buyX and mx < buyX + buyW and my >= iy + 4 and my < iy + 4 + 22
                    love.graphics.setColor(0.2, 0.45, 0.25, buyHovered and 0.95 or 0.7)
                    love.graphics.rectangle("fill", buyX, iy + 4, buyW, 22, 3, 3)
                    love.graphics.setColor(1, 1, 1, buyHovered and 1 or 0.8)
                    love.graphics.printf("Buy", buyX, iy + 7, buyW, "center")

                    ui._vendorItemBtns[i] = { x = buyX, y = iy + 4, w = buyW, h = 22, cardId = item.cardId, action = "buy" }
                end
            end
        end
    else
        -- Sell tab: show unequipped cards
        local sellCards = {}
        for _, card in ipairs(rpg.cards) do
            if not getCardEquipSlot(card) then
                table.insert(sellCards, card)
            end
        end

        if #sellCards == 0 then
            love.graphics.setFont(fonts.ui)
            love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
            love.graphics.printf("No unequipped cards to sell.", px, listY + 30, pw, "center")
        else
            love.graphics.setFont(fonts.small)
            for i, card in ipairs(sellCards) do
                local iy = listY + (i - 1) * itemH - game._cardVendor.scroll
                if iy + itemH >= listY and iy < listY + listH then
                    local rc = RARITY_COLORS[card.rarity] or {0.5, 0.5, 0.5}
                    local hovered = mx >= px + 10 and mx < px + pw - 10 and my >= iy and my < iy + itemH - 2

                    if hovered then
                        love.graphics.setColor(0.15, 0.2, 0.25, 0.8)
                    elseif i % 2 == 0 then
                        love.graphics.setColor(0.08, 0.1, 0.12, 0.3)
                    else
                        love.graphics.setColor(0, 0, 0, 0)
                    end
                    love.graphics.rectangle("fill", px + 8, iy, pw - 16, itemH - 2, 3, 3)

                    love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
                    love.graphics.print(card.name or "?", px + 14, iy + 2)

                    love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
                    love.graphics.print(((card.rarity or "?"):gsub("_"," ")), px + 14, iy + 15)

                    -- Estimated sell price (25% base value)
                    local baseValues = { common=50, uncommon=200, rare=500, ultra_rare=1500, mythic_rare=5000, legendary=15000, godly=50000, relic=200000 }
                    local baseVal = baseValues[card.rarity] or 50
                    if card.style == "holographic" then baseVal = math.floor(baseVal * 1.5)
                    elseif card.style == "golden" then baseVal = math.floor(baseVal * 2)
                    elseif card.style == "prismatic" then baseVal = math.floor(baseVal * 3)
                    elseif card.style == "void" then baseVal = math.floor(baseVal * 5) end
                    local sellPrice = math.max(1, math.floor(baseVal * 0.25))

                    love.graphics.setColor(1, 0.85, 0.2, 0.9)
                    love.graphics.printf(tostring(sellPrice) .. "c", px + 14, iy + 8, pw - 120, "right")

                    local sellW = 50
                    local sellX = px + pw - sellW - 14
                    local sellHovered = mx >= sellX and mx < sellX + sellW and my >= iy + 4 and my < iy + 4 + 22
                    love.graphics.setColor(0.5, 0.3, 0.15, sellHovered and 0.95 or 0.7)
                    love.graphics.rectangle("fill", sellX, iy + 4, sellW, 22, 3, 3)
                    love.graphics.setColor(1, 1, 1, sellHovered and 1 or 0.8)
                    love.graphics.printf("Sell", sellX, iy + 7, sellW, "center")

                    ui._vendorItemBtns[i] = { x = sellX, y = iy + 4, w = sellW, h = 22, cardInstanceId = card.instanceId, action = "sell" }
                end
            end
        end
    end

    love.graphics.setScissor()
end

-- Card Loadouts tab
function game.drawCardLoadoutsTab(px, py, pw, ph)
    local mx, my = love.mouse.getPosition()
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.7, 0.8, 1, 0.9)
    love.graphics.printf("Card Loadouts", px + 10, py + 4, pw - 20, "center")

    local slotH = 50
    local startY = py + 30
    ui._loadoutBtns = {}

    for i = 1, 5 do
        local ly = startY + (i - 1) * (slotH + 6)
        local loadout = game._cardLoadouts.loadouts[i]

        -- Background
        love.graphics.setColor(0.1, 0.12, 0.16, 0.8)
        love.graphics.rectangle("fill", px + 10, ly, pw - 20, slotH, 4, 4)
        love.graphics.setColor(0.3, 0.3, 0.4, 0.6)
        love.graphics.rectangle("line", px + 10, ly, pw - 20, slotH, 4, 4)

        -- Slot label
        love.graphics.setFont(fonts.hud)
        if loadout then
            love.graphics.setColor(0.9, 0.9, 0.8, 1)
            love.graphics.print(loadout.name or ("Loadout " .. i), px + 18, ly + 6)

            -- Show equipped card count
            local cardCount = 0
            for _, cid in ipairs(loadout.cards or {}) do
                if cid then cardCount = cardCount + 1 end
            end
            love.graphics.setFont(fonts.small)
            love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
            love.graphics.print(cardCount .. " cards saved", px + 18, ly + 24)

            -- Load button
            local loadBtnX = px + pw - 140
            local loadBtnW = 55
            local loadHovered = mx >= loadBtnX and mx < loadBtnX + loadBtnW and my >= ly + 10 and my < ly + 10 + 26
            love.graphics.setColor(0.2, 0.4, 0.3, loadHovered and 0.95 or 0.7)
            love.graphics.rectangle("fill", loadBtnX, ly + 10, loadBtnW, 26, 3, 3)
            love.graphics.setFont(fonts.hud)
            love.graphics.setColor(1, 1, 1, loadHovered and 1 or 0.8)
            love.graphics.printf("Load", loadBtnX, ly + 14, loadBtnW, "center")
            ui._loadoutBtns[#ui._loadoutBtns + 1] = { x = loadBtnX, y = ly + 10, w = loadBtnW, h = 26, action = "load", slotIndex = i - 1 }

            -- Overwrite button
            local saveBtnX = px + pw - 78
            local saveBtnW = 55
            local saveHovered = mx >= saveBtnX and mx < saveBtnX + saveBtnW and my >= ly + 10 and my < ly + 10 + 26
            love.graphics.setColor(0.4, 0.35, 0.15, saveHovered and 0.95 or 0.7)
            love.graphics.rectangle("fill", saveBtnX, ly + 10, saveBtnW, 26, 3, 3)
            love.graphics.setColor(1, 1, 1, saveHovered and 1 or 0.8)
            love.graphics.printf("Save", saveBtnX, ly + 14, saveBtnW, "center")
            ui._loadoutBtns[#ui._loadoutBtns + 1] = { x = saveBtnX, y = ly + 10, w = saveBtnW, h = 26, action = "save", slotIndex = i - 1 }
        else
            love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
            love.graphics.print("Empty Slot " .. i, px + 18, ly + 6)
            love.graphics.setFont(fonts.small)
            love.graphics.setColor(0.4, 0.4, 0.5, 0.5)
            love.graphics.print("Save current build here", px + 18, ly + 24)

            -- Save button
            local saveBtnX = px + pw - 78
            local saveBtnW = 55
            local saveHovered = mx >= saveBtnX and mx < saveBtnX + saveBtnW and my >= ly + 10 and my < ly + 10 + 26
            love.graphics.setColor(0.2, 0.4, 0.3, saveHovered and 0.95 or 0.7)
            love.graphics.rectangle("fill", saveBtnX, ly + 10, saveBtnW, 26, 3, 3)
            love.graphics.setFont(fonts.hud)
            love.graphics.setColor(1, 1, 1, saveHovered and 1 or 0.8)
            love.graphics.printf("Save", saveBtnX, ly + 14, saveBtnW, "center")
            ui._loadoutBtns[#ui._loadoutBtns + 1] = { x = saveBtnX, y = ly + 10, w = saveBtnW, h = 26, action = "save", slotIndex = i - 1 }
        end
    end
end

-- Auction House UI
function game.drawAuctionHouse(W, H)
    local pw = math.min(650, W - 40)
    local ph = math.min(480, H - 60)
    local px = math.floor((W - pw) / 2)
    local py = math.floor((H - ph) / 2)
    local mx, my = love.mouse.getPosition()

    game._auction._panelX = px
    game._auction._panelY = py
    game._auction._panelW = pw
    game._auction._panelH = ph

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel
    love.graphics.setColor(0.06, 0.07, 0.12, 0.96)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    love.graphics.setColor(0.4, 0.35, 0.6, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title
    love.graphics.setColor(0.08, 0.12, 0.2, 0.9)
    love.graphics.rectangle("fill", px, py, pw, 30, 8, 8)
    love.graphics.rectangle("fill", px, py + 20, pw, 10)
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.6, 0.5, 1, 1)
    love.graphics.printf("Auction House", px + 10, py + 4, pw - 50, "left")

    -- Coins display
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(1, 0.85, 0.2, 0.9)
    love.graphics.printf("Coins: " .. (account and account.coins or 0), px + 10, py + 8, pw - 60, "right")

    -- Close button
    local closeX = px + pw - 30
    local closeY = py + 4
    local closeW, closeH = 24, 22
    love.graphics.setColor(0.5, 0.15, 0.15, 0.8)
    love.graphics.rectangle("fill", closeX, closeY, closeW, closeH, 4, 4)
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf("X", closeX, closeY + 2, closeW, "center")
    game._auction._closeBtn = { x = closeX, y = closeY, w = closeW, h = closeH }

    -- Tab bar: Browse | Sell | My Listings
    local tabY = py + 34
    local tabNames = { "browse", "sell", "my_listings" }
    local tabLabels = { "Browse", "Sell", "My Listings" }
    local tabW = math.floor((pw - 20) / #tabNames)
    game._auction._tabBtns = {}
    love.graphics.setFont(fonts.hud)
    for ti, tname in ipairs(tabNames) do
        local tx = px + 10 + (ti - 1) * tabW
        local active = (game._auction.tab == tname)
        if active then
            love.graphics.setColor(0.15, 0.15, 0.3, 0.95)
        else
            love.graphics.setColor(0.08, 0.1, 0.14, 0.7)
        end
        love.graphics.rectangle("fill", tx, tabY, tabW - 2, 22, 3, 3)
        love.graphics.setColor(active and 0.7 or 0.4, active and 0.6 or 0.4, active and 1 or 0.5, 1)
        love.graphics.printf(tabLabels[ti], tx, tabY + 2, tabW - 2, "center")
        game._auction._tabBtns[ti] = { x = tx, y = tabY, w = tabW - 2, h = 22, tab = tname }
    end

    local contentY = tabY + 28
    local contentH = ph - (contentY - py) - 20

    if game._auction.tab == "browse" then
        game.drawAuctionBrowse(px, contentY, pw, contentH)
    elseif game._auction.tab == "sell" then
        game.drawAuctionSell(px, contentY, pw, contentH)
    else
        game.drawAuctionMyListings(px, contentY, pw, contentH)
    end

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("[J] or [ESC] to close", px, py + ph - 16, pw, "center")
end

function game.drawAuctionBrowse(px, py, pw, ph)
    local mx, my = love.mouse.getPosition()

    -- Search bar
    local searchY = py
    local searchW = pw - 120
    love.graphics.setColor(0.1, 0.1, 0.15, 0.9)
    love.graphics.rectangle("fill", px + 10, searchY, searchW, 20, 3, 3)
    love.graphics.setColor(game._auction.searchActive and 0.5 or 0.3, game._auction.searchActive and 0.5 or 0.3, game._auction.searchActive and 0.7 or 0.4, 0.8)
    love.graphics.rectangle("line", px + 10, searchY, searchW, 20, 3, 3)
    love.graphics.setFont(fonts.small)
    if #game._auction.filters.search > 0 then
        love.graphics.setColor(1, 1, 1, 0.9)
        love.graphics.print(game._auction.filters.search, px + 14, searchY + 3)
    else
        love.graphics.setColor(0.4, 0.4, 0.5, 0.5)
        love.graphics.print("Search cards...", px + 14, searchY + 3)
    end
    game._auction._searchBar = { x = px + 10, y = searchY, w = searchW, h = 20 }

    -- Search button
    local searchBtnX = px + 10 + searchW + 4
    local searchBtnW = 60
    local searchHovered = mx >= searchBtnX and mx < searchBtnX + searchBtnW and my >= searchY and my < searchY + 20
    love.graphics.setColor(0.2, 0.25, 0.4, searchHovered and 0.95 or 0.7)
    love.graphics.rectangle("fill", searchBtnX, searchY, searchBtnW, 20, 3, 3)
    love.graphics.setColor(1, 1, 1, searchHovered and 1 or 0.8)
    love.graphics.printf("Search", searchBtnX, searchY + 3, searchBtnW, "center")
    game._auction._searchBtn = { x = searchBtnX, y = searchY, w = searchBtnW, h = 20 }

    -- Rarity filter buttons
    local filterY = searchY + 24
    local rarities = { "all", "common", "uncommon", "rare", "ultra_rare", "mythic_rare", "legendary" }
    local rarityLabels = { "All", "C", "UC", "R", "UR", "MR", "L" }
    local rBtnW = math.floor((pw - 20) / #rarities)
    game._auction._rarityBtns = {}
    love.graphics.setFont(fonts.small)
    for ri, r in ipairs(rarities) do
        local rx = px + 10 + (ri - 1) * rBtnW
        local active = (game._auction.filters.rarity == r) or (r == "all" and not game._auction.filters.rarity)
        local rc = RARITY_COLORS[r] or {0.5, 0.5, 0.6}
        if active then
            love.graphics.setColor(rc[1] * 0.4, rc[2] * 0.4, rc[3] * 0.4, 0.9)
        else
            love.graphics.setColor(0.08, 0.1, 0.14, 0.6)
        end
        love.graphics.rectangle("fill", rx, filterY, rBtnW - 2, 16, 2, 2)
        love.graphics.setColor(active and rc[1] or 0.5, active and rc[2] or 0.5, active and rc[3] or 0.5, active and 1 or 0.6)
        love.graphics.printf(rarityLabels[ri], rx, filterY + 1, rBtnW - 2, "center")
        game._auction._rarityBtns[ri] = { x = rx, y = filterY, w = rBtnW - 2, h = 16, rarity = r == "all" and nil or r }
    end

    -- Listings
    local listY = filterY + 22
    local listH = ph - (listY - py) - 24
    local itemH = 30

    love.graphics.setScissor(px + 4, listY, pw - 8, listH)
    game._auction._listingBtns = {}

    if #game._auction.listings == 0 then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
        love.graphics.printf("No listings found.", px, listY + 30, pw, "center")
    else
        love.graphics.setFont(fonts.small)
        for i, listing in ipairs(game._auction.listings) do
            local iy = listY + (i - 1) * itemH - game._auction.scroll
            if iy + itemH >= listY and iy < listY + listH then
                local rc = RARITY_COLORS[listing.rarity] or {0.5, 0.5, 0.5}
                local hovered = mx >= px + 10 and mx < px + pw - 10 and my >= iy and my < iy + itemH

                if hovered then
                    love.graphics.setColor(0.15, 0.15, 0.25, 0.8)
                elseif i % 2 == 0 then
                    love.graphics.setColor(0.08, 0.1, 0.12, 0.3)
                else
                    love.graphics.setColor(0, 0, 0, 0)
                end
                love.graphics.rectangle("fill", px + 8, iy, pw - 16, itemH - 2, 3, 3)

                -- Name with rarity color
                love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
                love.graphics.print(listing.name or "?", px + 14, iy + 3)

                -- Seller
                love.graphics.setColor(0.5, 0.5, 0.6, 0.7)
                love.graphics.print("by " .. (listing.sellerName or "?"), px + 14, iy + 15)

                -- Price
                love.graphics.setColor(1, 0.85, 0.2, 0.9)
                love.graphics.printf(tostring(listing.price or 0) .. "c", px + 14, iy + 8, pw - 100, "right")

                -- Buy button
                local buyW = 45
                local buyX = px + pw - buyW - 14
                local buyHovered = mx >= buyX and mx < buyX + buyW and my >= iy + 3 and my < iy + 3 + 22
                love.graphics.setColor(0.2, 0.35, 0.5, buyHovered and 0.95 or 0.7)
                love.graphics.rectangle("fill", buyX, iy + 3, buyW, 22, 3, 3)
                love.graphics.setColor(1, 1, 1, buyHovered and 1 or 0.8)
                love.graphics.printf("Buy", buyX, iy + 6, buyW, "center")

                game._auction._listingBtns[i] = { x = buyX, y = iy + 3, w = buyW, h = 22, listingId = listing.id }
            end
        end
    end

    love.graphics.setScissor()

    -- Pagination
    local pageY = listY + listH + 2
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
    love.graphics.printf("Page " .. game._auction.page .. "/" .. math.max(1, game._auction.totalPages) .. " (" .. game._auction.totalResults .. " results)", px + 10, pageY, pw - 20, "center")

    -- Prev/Next page buttons
    if game._auction.page > 1 then
        local prevX = px + 10
        local prevHovered = mx >= prevX and mx < prevX + 30 and my >= pageY and my < pageY + 14
        love.graphics.setColor(0.3, 0.3, 0.5, prevHovered and 1 or 0.7)
        love.graphics.print("< Prev", prevX, pageY)
        game._auction._prevPageBtn = { x = prevX, y = pageY, w = 40, h = 14 }
    else
        game._auction._prevPageBtn = nil
    end
    if game._auction.page < game._auction.totalPages then
        local nextX = px + pw - 50
        local nextHovered = mx >= nextX and mx < nextX + 40 and my >= pageY and my < pageY + 14
        love.graphics.setColor(0.3, 0.3, 0.5, nextHovered and 1 or 0.7)
        love.graphics.printf("Next >", nextX, pageY, 40, "right")
        game._auction._nextPageBtn = { x = nextX, y = pageY, w = 40, h = 14 }
    else
        game._auction._nextPageBtn = nil
    end
end

function game.drawAuctionSell(px, py, pw, ph)
    local mx, my = love.mouse.getPosition()

    -- Show unequipped cards to select for listing
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.7, 0.8, 1, 0.8)
    love.graphics.printf("Select a card to list:", px + 10, py, pw - 20, "left")

    -- Price input
    local priceY = py
    love.graphics.setColor(0.1, 0.1, 0.15, 0.9)
    love.graphics.rectangle("fill", px + pw - 180, priceY, 100, 20, 3, 3)
    love.graphics.setColor(game._auction.priceActive and 0.5 or 0.3, game._auction.priceActive and 0.5 or 0.3, game._auction.priceActive and 0.7 or 0.4, 0.8)
    love.graphics.rectangle("line", px + pw - 180, priceY, 100, 20, 3, 3)
    love.graphics.setFont(fonts.small)
    if #game._auction.sellPrice > 0 then
        love.graphics.setColor(1, 0.85, 0.2, 0.9)
        love.graphics.print(game._auction.sellPrice .. "c", px + pw - 176, priceY + 3)
    else
        love.graphics.setColor(0.4, 0.4, 0.5, 0.5)
        love.graphics.print("Price...", px + pw - 176, priceY + 3)
    end
    game._auction._priceInput = { x = px + pw - 180, y = priceY, w = 100, h = 20 }

    -- List button
    local listBtnX = px + pw - 72
    local listBtnW = 60
    local canList = game._auction.sellCard and #game._auction.sellPrice > 0
    local listHovered = canList and mx >= listBtnX and mx < listBtnX + listBtnW and my >= priceY and my < priceY + 20
    love.graphics.setColor(canList and 0.2 or 0.15, canList and 0.4 or 0.15, canList and 0.3 or 0.2, listHovered and 0.95 or 0.7)
    love.graphics.rectangle("fill", listBtnX, priceY, listBtnW, 20, 3, 3)
    love.graphics.setColor(1, 1, 1, canList and (listHovered and 1 or 0.8) or 0.4)
    love.graphics.printf("List", listBtnX, priceY + 3, listBtnW, "center")
    game._auction._listBtn = { x = listBtnX, y = priceY, w = listBtnW, h = 20 }

    -- Card grid for selling
    local listY = py + 26
    local listH = ph - 36
    local itemH = 30

    love.graphics.setScissor(px + 4, listY, pw - 8, listH)
    game._auction._sellCardBtns = {}

    local sellCards = {}
    for _, card in ipairs(rpg.cards) do
        if not getCardEquipSlot(card) then
            table.insert(sellCards, card)
        end
    end

    if #sellCards == 0 then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
        love.graphics.printf("No unequipped cards to sell.", px, listY + 30, pw, "center")
    else
        love.graphics.setFont(fonts.small)
        for i, card in ipairs(sellCards) do
            local iy = listY + (i - 1) * itemH - game._auction.scroll
            if iy + itemH >= listY and iy < listY + listH then
                local rc = RARITY_COLORS[card.rarity] or {0.5, 0.5, 0.5}
                local isSelected = game._auction.sellCard and game._auction.sellCard.instanceId == card.instanceId
                local hovered = mx >= px + 10 and mx < px + pw - 10 and my >= iy and my < iy + itemH

                if isSelected then
                    love.graphics.setColor(0.2, 0.15, 0.35, 0.9)
                elseif hovered then
                    love.graphics.setColor(0.15, 0.15, 0.25, 0.8)
                elseif i % 2 == 0 then
                    love.graphics.setColor(0.08, 0.1, 0.12, 0.3)
                else
                    love.graphics.setColor(0, 0, 0, 0)
                end
                love.graphics.rectangle("fill", px + 8, iy, pw - 16, itemH - 2, 3, 3)

                if isSelected then
                    love.graphics.setColor(0.5, 0.4, 0.8, 0.6)
                    love.graphics.rectangle("line", px + 8, iy, pw - 16, itemH - 2, 3, 3)
                end

                love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
                love.graphics.print(card.name or "?", px + 14, iy + 3)
                love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
                love.graphics.print(((card.rarity or "?"):gsub("_"," ")) .. " | " .. ((card.type or "?"):gsub("_"," ")), px + 14, iy + 15)

                game._auction._sellCardBtns[i] = { x = px + 8, y = iy, w = pw - 16, h = itemH - 2, card = card }
            end
        end
    end

    love.graphics.setScissor()
end

function game.drawAuctionMyListings(px, py, pw, ph)
    local mx, my = love.mouse.getPosition()
    local itemH = 30

    love.graphics.setScissor(px + 4, py, pw - 8, ph)
    game._auction._cancelBtns = {}

    if #game._auction.myListings == 0 then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
        love.graphics.printf("You have no active listings.", px, py + 30, pw, "center")
    else
        love.graphics.setFont(fonts.small)
        for i, listing in ipairs(game._auction.myListings) do
            local iy = py + (i - 1) * itemH - game._auction.scroll
            if iy + itemH >= py and iy < py + ph then
                local rc = RARITY_COLORS[listing.rarity] or {0.5, 0.5, 0.5}
                local hovered = mx >= px + 10 and mx < px + pw - 10 and my >= iy and my < iy + itemH

                if hovered then
                    love.graphics.setColor(0.15, 0.15, 0.25, 0.8)
                elseif i % 2 == 0 then
                    love.graphics.setColor(0.08, 0.1, 0.12, 0.3)
                else
                    love.graphics.setColor(0, 0, 0, 0)
                end
                love.graphics.rectangle("fill", px + 8, iy, pw - 16, itemH - 2, 3, 3)

                love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
                love.graphics.print(listing.name or "?", px + 14, iy + 3)

                love.graphics.setColor(1, 0.85, 0.2, 0.9)
                love.graphics.printf(tostring(listing.price or 0) .. "c", px + 14, iy + 3, pw - 120, "right")

                -- Cancel button
                local cancelW = 55
                local cancelX = px + pw - cancelW - 14
                local cancelHovered = mx >= cancelX and mx < cancelX + cancelW and my >= iy + 3 and my < iy + 3 + 22
                love.graphics.setColor(0.5, 0.2, 0.15, cancelHovered and 0.95 or 0.7)
                love.graphics.rectangle("fill", cancelX, iy + 3, cancelW, 22, 3, 3)
                love.graphics.setColor(1, 1, 1, cancelHovered and 1 or 0.8)
                love.graphics.printf("Cancel", cancelX, iy + 6, cancelW, "center")

                game._auction._cancelBtns[i] = { x = cancelX, y = iy + 3, w = cancelW, h = 22, listingId = listing.id }
            end
        end
    end

    love.graphics.setScissor()
end

function game.revealFog(tileX, tileY)
    -- Server now drives fog of war via dungeon_visibility_update.
    -- This is kept as a minimal fallback for initial entrance reveal
    -- before the first server visibility update arrives.
    local radius = 2
    if skills and skills.dungeon_dwelling and skills.dungeon_dwelling.level >= 5 then
        radius = 3
    end
    for dy = -radius, radius do
        for dx = -radius, radius do
            local fx = tileX + dx
            local fy = tileY + dy
            if fx >= 0 and fy >= 0 and dungeon.fogWidth > 0 and fx < dungeon.fogWidth and fy < (dungeon.fogHeight or 9999) then
                dungeon.fog[fx .. "," .. fy] = true
                local idx = fy * dungeon.fogWidth + fx
                if dungeon.fogState[idx] ~= nil then
                    dungeon.fogState[idx] = 2 -- VISIBLE
                end
            end
        end
    end
end

function game.drawDungeonFloor()
    if not dungeon.grid then return end
    local ts = 32  -- tile size

    -- Viewport culling: calculate visible tile range from camera
    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()
    local startTileX = math.max(1, math.floor(camera.x / ts))
    local startTileY = math.max(1, math.floor(camera.y / ts))
    local endTileX = math.min(#(dungeon.grid[1] or {}), math.ceil((camera.x + W) / ts) + 1)
    local endTileY = math.min(#dungeon.grid, math.ceil((camera.y + H) / ts) + 1)

    -- Default theme colors
    local wallColor = {0.15, 0.12, 0.18}
    local floorColor = {0.3, 0.28, 0.25}
    local corridorColor = {0.25, 0.22, 0.2}
    local doorColor = {0.5, 0.35, 0.15}
    local stairsUpColor = {0.3, 0.6, 0.3}
    local stairsDownColor = {0.6, 0.3, 0.3}
    local chestColor = {0.8, 0.7, 0.2}
    local trapColor = {0.7, 0.2, 0.2}
    local campColor = {0.6, 0.5, 0.2}
    local shrineColor = {0.4, 0.4, 0.8}
    local bossDoorColor = {0.8, 0.1, 0.1}
    local shortcutColor = {0.3, 0.7, 0.7}

    -- Apply theme color overrides if available (server sends 0-255, LOVE needs 0-1)
    if dungeon.themeColor then
        if dungeon.themeColor.wall then
            wallColor = {(dungeon.themeColor.wall.r or 38) / 255, (dungeon.themeColor.wall.g or 31) / 255, (dungeon.themeColor.wall.b or 46) / 255}
        end
        if dungeon.themeColor.floor then
            floorColor = {(dungeon.themeColor.floor.r or 77) / 255, (dungeon.themeColor.floor.g or 71) / 255, (dungeon.themeColor.floor.b or 64) / 255}
        end
        if dungeon.themeColor.accent then
            corridorColor = {(dungeon.themeColor.accent.r or 64) / 255, (dungeon.themeColor.accent.g or 56) / 255, (dungeon.themeColor.accent.b or 51) / 255}
            doorColor = {(dungeon.themeColor.accent.r or 128) / 255, (dungeon.themeColor.accent.g or 89) / 255, (dungeon.themeColor.accent.b or 38) / 255}
        end
    end

    for y = startTileY, endTileY do
        if not dungeon.grid[y] then break end
        for x = startTileX, endTileX do
            local tile = dungeon.grid[y][x]
            if not tile then break end
            local px = (x - 1) * ts
            local py = (y - 1) * ts
            local fogKey = (x - 1) .. "," .. (y - 1)

            -- Three-state fog check
            local fogIdx = (y - 1) * dungeon.fogWidth + (x - 1)
            local fogVal = dungeon.fogState[fogIdx] or 0
            -- Fallback: if fogState not set, use legacy fog table
            if fogVal == 0 and dungeon.fog[fogKey] then fogVal = 2 end

            if fogVal >= 1 then
                -- Revealed or remembered tile (darkness now handled by lighting canvas)
                if tile == DTILE.WALL then
                    -- Base wall color
                    love.graphics.setColor(wallColor[1], wallColor[2], wallColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    -- Brick/stone pattern for visibility
                    love.graphics.setColor(wallColor[1] * 0.7, wallColor[2] * 0.7, wallColor[3] * 0.7)
                    love.graphics.rectangle("line", px, py, ts, ts)
                    -- Highlight top-left edges (raised look)
                    love.graphics.setColor(wallColor[1] * 1.3, wallColor[2] * 1.3, wallColor[3] * 1.3, 0.4)
                    love.graphics.line(px, py + ts, px, py)
                    love.graphics.line(px, py, px + ts, py)
                    -- Shadow bottom-right edges
                    love.graphics.setColor(0, 0, 0, 0.3)
                    love.graphics.line(px + ts, py, px + ts, py + ts)
                    love.graphics.line(px, py + ts, px + ts, py + ts)
                elseif tile == DTILE.FLOOR then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    -- Subtle floor grid for depth
                    love.graphics.setColor(floorColor[1] * 0.85, floorColor[2] * 0.85, floorColor[3] * 0.85, 0.3)
                    love.graphics.rectangle("line", px, py, ts, ts)
                elseif tile == DTILE.CORRIDOR then
                    love.graphics.setColor(corridorColor[1], corridorColor[2], corridorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    -- Subtle corridor grid
                    love.graphics.setColor(corridorColor[1] * 0.85, corridorColor[2] * 0.85, corridorColor[3] * 0.85, 0.3)
                    love.graphics.rectangle("line", px, py, ts, ts)
                elseif tile == DTILE.DOOR then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(doorColor[1], doorColor[2], doorColor[3])
                    love.graphics.rectangle("fill", px + 4, py + 2, ts - 8, ts - 4, 2, 2)
                elseif tile == DTILE.STAIRS_UP then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(stairsUpColor[1], stairsUpColor[2], stairsUpColor[3])
                    love.graphics.polygon("fill", px + ts/2, py + 4, px + 4, py + ts - 4, px + ts - 4, py + ts - 4)
                elseif tile == DTILE.STAIRS_DOWN then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(stairsDownColor[1], stairsDownColor[2], stairsDownColor[3])
                    love.graphics.polygon("fill", px + 4, py + 4, px + ts - 4, py + 4, px + ts/2, py + ts - 4)
                elseif tile == DTILE.CHEST then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(chestColor[1], chestColor[2], chestColor[3])
                    love.graphics.rectangle("fill", px + 6, py + 8, ts - 12, ts - 14, 2, 2)
                elseif tile == DTILE.TRAP then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    -- Only show trap if triggered or player has trap detection
                    local showTrap = false
                    for _, t in ipairs(dungeon.traps) do
                        if t.x == x - 1 and t.y == y - 1 and t.triggered then showTrap = true; break end
                    end
                    if not showTrap and skills and skills.dungeon_dwelling and skills.dungeon_dwelling.level >= 5 then
                        showTrap = true
                    end
                    if showTrap then
                        love.graphics.setColor(trapColor[1], trapColor[2], trapColor[3], 0.5)
                        love.graphics.rectangle("fill", px + 4, py + 4, ts - 8, ts - 8)
                    end
                elseif tile == DTILE.CAMP_SPOT then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(campColor[1], campColor[2], campColor[3], 0.3)
                    love.graphics.circle("fill", px + ts/2, py + ts/2, 4)
                elseif tile == DTILE.SHRINE then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(shrineColor[1], shrineColor[2], shrineColor[3])
                    love.graphics.circle("fill", px + ts/2, py + ts/2, 6)
                elseif tile == DTILE.BOSS_DOOR then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(bossDoorColor[1], bossDoorColor[2], bossDoorColor[3])
                    love.graphics.rectangle("fill", px + 2, py + 2, ts - 4, ts - 4, 3, 3)
                    love.graphics.setColor(1, 0.8, 0.1)
                    love.graphics.circle("fill", px + ts/2, py + ts/2, 4)
                elseif tile == DTILE.SHORTCUT then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(shortcutColor[1], shortcutColor[2], shortcutColor[3])
                    love.graphics.circle("line", px + ts/2, py + ts/2, 8)
                elseif tile == DTILE.CORPSE then
                    -- Floor base
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    -- Bone-white skull + crossbones shape
                    love.graphics.setColor(0.7, 0.65, 0.55, 0.8)
                    love.graphics.circle("fill", px + ts/2, py + ts/2 - 2, 5)
                    love.graphics.rectangle("fill", px + ts/2 - 6, py + ts/2 + 3, 12, 3)
                else
                    -- Unknown/entrance/exit — render as floor
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                end

                -- Apply remembered dimming overlay (darken remembered tiles)
                if fogVal == 1 then
                    love.graphics.setColor(0, 0, 0, 0.75)
                    love.graphics.rectangle("fill", px, py, ts, ts)
                end
            else
                -- Unrevealed tile (fog of war) — black
                love.graphics.setColor(0.03, 0.03, 0.05)
                love.graphics.rectangle("fill", px, py, ts, ts)
            end
        end
    end
end

function game.drawDungeonEntities()
    local ts = 32

    -- Draw camps
    for _, camp in ipairs(dungeon.camps) do
        local cx = camp.x * ts + ts/2
        local cy = camp.y * ts + ts/2
        local fogKey = camp.x .. "," .. camp.y
        if dungeon.fog[fogKey] then
            -- Campfire
            if camp.campfire then
                love.graphics.setColor(1, 0.6, 0.1, 0.8)
            else
                love.graphics.setColor(0.5, 0.4, 0.2, 0.6)
            end
            love.graphics.circle("fill", cx, cy, 6)
            -- Owner name
            love.graphics.setFont(fonts.small)
            love.graphics.setColor(0.8, 0.7, 0.5, 0.7)
            love.graphics.printf(camp.ownerName or "Camp", cx - 30, cy + 10, 60, "center")
        end
    end

    -- Draw chests
    for _, chest in ipairs(dungeon.chests) do
        local cx = chest.x * ts
        local cy = chest.y * ts
        local fogKey = chest.x .. "," .. chest.y
        if dungeon.fog[fogKey] then
            if chest.opened then
                love.graphics.setColor(0.4, 0.35, 0.15, 0.5)
            else
                love.graphics.setColor(0.9, 0.75, 0.2, 0.9)
            end
            love.graphics.rectangle("fill", cx + 8, cy + 10, 16, 12, 2, 2)
            if not chest.opened then
                love.graphics.setColor(0.7, 0.5, 0.1)
                love.graphics.rectangle("fill", cx + 12, cy + 14, 8, 4, 1, 1)
            end
        end
    end

    -- Draw NPCs
    for i, npc in ipairs(dungeon.npcs) do
        if not npc.claimed then
            local nx = npc.x * ts + ts/2
            local ny = npc.y * ts + ts/2
            local fogKey = npc.x .. "," .. npc.y
            if dungeon.fog[fogKey] then
                love.graphics.setColor(0.3, 0.7, 1, 0.9)
                love.graphics.circle("fill", nx, ny, 8)
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.5, 0.8, 1, 0.8)
                love.graphics.printf(npc.type or "NPC", nx - 30, ny - 18, 60, "center")
            end
        end
    end

    -- Draw corpses
    for _, cr in ipairs(dungeon.corpses) do
        local crx = cr.x * ts
        local cry = cr.y * ts
        local fogKey = cr.x .. "," .. cr.y
        if dungeon.fog[fogKey] then
            if cr.examined then
                -- Dimmed out
                love.graphics.setColor(0.4, 0.35, 0.3, 0.4)
            else
                -- Brighter bone with subtle glow
                love.graphics.setColor(0.8, 0.75, 0.6, 0.9)
            end
            -- Skull shape
            love.graphics.circle("fill", crx + ts/2, cry + ts/2 - 2, 6)
            -- Crossbones
            love.graphics.rectangle("fill", crx + ts/2 - 7, cry + ts/2 + 4, 14, 2)
            if not cr.examined then
                -- Glow effect for unexamined
                love.graphics.setColor(0.9, 0.85, 0.6, 0.2 + math.sin(love.timer.getTime() * 3) * 0.1)
                love.graphics.circle("fill", crx + ts/2, cry + ts/2, 10)
            end
        end
    end

    -- Draw placed torches
    for _, torch in ipairs(dungeon.placedTorches) do
        local tx = torch.x * ts + ts/2
        local ty = torch.y * ts + ts/2
        local tFogIdx = torch.y * dungeon.fogWidth + torch.x
        local tFogVal = dungeon.fogState[tFogIdx] or 0
        if tFogVal >= 1 then
            -- Torch base
            love.graphics.setColor(0.5, 0.35, 0.1, 0.9)
            love.graphics.rectangle("fill", tx - 2, ty - 6, 4, 12)
            -- Flame glow (pulsing)
            local pulse = math.sin(love.timer.getTime() * 6) * 0.15 + 0.85
            love.graphics.setColor(1, 0.7, 0.1, pulse * 0.6)
            love.graphics.circle("fill", tx, ty - 8, 5)
            love.graphics.setColor(1, 0.5, 0.0, pulse * 0.3)
            love.graphics.circle("fill", tx, ty - 8, 10)
        end
    end

    -- Draw thermal vision blips (through-wall heat signatures)
    if dungeon.visionType == "thermal" and dungeon.thermalEntities then
        local time = love.timer.getTime()
        for _, ent in ipairs(dungeon.thermalEntities) do
            local hx = ent.x * ts + ts/2
            local hy = ent.y * ts + ts/2
            local pulse = math.sin(time * 4) * 0.3 + 0.7
            if ent.type == "enemy" then
                love.graphics.setColor(1, 0.3, 0.1, pulse * 0.6)
            else
                love.graphics.setColor(1, 0.6, 0.2, pulse * 0.4)
            end
            love.graphics.circle("fill", hx, hy, 6 + math.sin(time * 3) * 2)
            love.graphics.setColor(1, 0.2, 0.0, pulse * 0.2)
            love.graphics.circle("fill", hx, hy, 10 + math.sin(time * 2) * 3)
        end
    end

    -- Draw tremor sense indicators (expanding ripple waves with type-specific visuals)
    if dungeon.tremorIndicators then
        local time = love.timer.getTime()
        for _, ind in ipairs(dungeon.tremorIndicators) do
            local rx = ind.x * ts + ts/2
            local ry = ind.y * ts + ts/2
            local intensity = ind.intensity or 0.5
            local rippleSpeed = ind.moving and 2.5 or 1.5
            local ripplePhase = (time * rippleSpeed) % 1
            local rippleRadius = ripplePhase * 16 * intensity
            local rippleAlpha = (1 - ripplePhase) * 0.5 * intensity

            if ind.type == "boss" then
                -- Boss: large red pulsing rings
                love.graphics.setColor(1, 0.2, 0.2, rippleAlpha)
                rippleRadius = ripplePhase * 24
            elseif ind.type == "trap" then
                -- Trap: sharp yellow warning pulses
                love.graphics.setColor(1, 1, 0.2, rippleAlpha * 1.2)
            elseif ind.type == "machine" then
                -- Machine/construct: steady orange-copper hum rings
                local mechPulse = math.sin(time * 6) * 0.15 + 0.5
                love.graphics.setColor(0.9, 0.6, 0.2, mechPulse * intensity)
                -- Draw gear-like indicator (diamond shape)
                love.graphics.polygon("line",
                    rx, ry - 8,
                    rx + 8, ry,
                    rx, ry + 8,
                    rx - 8, ry)
            elseif ind.type == "chest" then
                -- Chest/container: faint teal click-click pulses
                love.graphics.setColor(0.3, 0.8, 0.7, rippleAlpha * 0.8)
            elseif ind.type == "shrine" then
                -- Shrine/energy source: soft white glow hum
                local shrPulse = math.sin(time * 3) * 0.2 + 0.4
                love.graphics.setColor(0.9, 0.9, 1.0, shrPulse * intensity)
            elseif ind.type == "door" then
                -- Door: rectangular amber pulse
                love.graphics.setColor(0.8, 0.7, 0.3, rippleAlpha)
                love.graphics.rectangle("line", rx - 6, ry - 8, 12, 16)
            elseif ind.type == "player" then
                -- Other player: blue-green footstep ripples
                love.graphics.setColor(0.3, 0.7, 0.9, rippleAlpha)
            else
                -- Enemy movement: standard gray-blue ripples
                love.graphics.setColor(0.6, 0.6, 0.8, rippleAlpha)
            end

            -- Draw ripple rings (skip for door/machine which use custom shapes)
            if ind.type ~= "door" and ind.type ~= "machine" then
                love.graphics.setLineWidth(2)
                love.graphics.circle("line", rx, ry, rippleRadius)
                if ind.moving then
                    -- Moving entities get a second inner ring
                    love.graphics.circle("line", rx, ry, rippleRadius * 0.5)
                end
                love.graphics.setLineWidth(1)
            elseif ind.type == "machine" then
                -- Machine gets concentric vibration rings
                love.graphics.setLineWidth(1)
                local mRing = (time * 4) % 1
                love.graphics.circle("line", rx, ry, mRing * 12)
            end

            -- Draw label text for non-enemy types when close
            if ind.label and ind.type ~= "enemy" then
                local playerDist = math.sqrt((ind.x - (dungeon.playerX or 0))^2 + (ind.y - (dungeon.playerY or 0))^2)
                if playerDist <= 5 then
                    love.graphics.setColor(0.8, 0.8, 0.6, 0.6 * intensity)
                    local font = love.graphics.getFont()
                    local labelW = font:getWidth(ind.label)
                    love.graphics.print(ind.label, rx - labelW/2, ry + 10)
                end
            end
        end
    end

    -- Draw enemies (server-filtered: only visible enemies sent)
    for i, enemy in ipairs(dungeon.enemies) do
        if enemy.alive ~= false then
            -- Interpolate movement
            local drawX, drawY = enemy.x, enemy.y
            if enemy.moveTimer and enemy.moveTimer > 0 and enemy.prevX then
                local t = enemy.moveTimer / 0.15
                drawX = enemy.x + (enemy.prevX - enemy.x) * t
                drawY = enemy.y + (enemy.prevY - enemy.y) * t
            end
            local ex = drawX * ts + ts/2
            local ey = drawY * ts + ts/2
            -- Enemies are server-filtered so always draw if in the list
            if true then
                local aiState = enemy.aiState or "idle"
                local archetype = enemy.archetype or "bruiser"
                local radius = enemy.isBoss and 12 or 7

                -- Archetype-based body color
                if archetype == "bruiser" then
                    love.graphics.setColor(0.8, 0.25, 0.2, 0.9)
                elseif archetype == "skirmisher" then
                    love.graphics.setColor(0.9, 0.6, 0.1, 0.9)
                elseif archetype == "ranged" then
                    love.graphics.setColor(0.4, 0.7, 0.2, 0.9)
                elseif archetype == "controller" then
                    love.graphics.setColor(0.5, 0.3, 0.9, 0.9)
                elseif archetype == "support" then
                    love.graphics.setColor(0.2, 0.8, 0.7, 0.9)
                elseif archetype == "elite" then
                    love.graphics.setColor(1, 0.85, 0.1, 0.9)
                else
                    love.graphics.setColor(0.6, 0.3, 0.3, 0.9)
                end

                -- Attack flash (red pulse)
                if enemy.attackFlashTimer and enemy.attackFlashTimer > 0 then
                    love.graphics.setColor(1, 0.1, 0.1, 0.95)
                end

                -- Draw body
                love.graphics.circle("fill", ex, ey, radius)

                -- Wind-up telegraph: pulsing ring around enemy when attacking
                if enemy.isAttacking then
                    local pulse = math.sin(love.timer.getTime() * 12) * 0.3 + 0.7
                    love.graphics.setColor(1, 0.2, 0.2, pulse)
                    love.graphics.setLineWidth(2)
                    love.graphics.circle("line", ex, ey, radius + 4 + math.sin(love.timer.getTime() * 8) * 2)
                    love.graphics.setLineWidth(1)
                end

                -- Facing indicator (small triangle)
                local facing = enemy.facing or "down"
                love.graphics.setColor(1, 1, 1, 0.6)
                local fx, fy = 0, 0
                if facing == "right" then fx, fy = radius + 3, 0
                elseif facing == "left" then fx, fy = -(radius + 3), 0
                elseif facing == "up" then fx, fy = 0, -(radius + 3)
                else fx, fy = 0, radius + 3 end
                love.graphics.circle("fill", ex + fx, ey + fy, 2)

                -- AI state indicator (small icon above)
                if aiState == "alert" or aiState == "evaluate" then
                    love.graphics.setColor(1, 1, 0, 0.9)
                    love.graphics.print("!", ex - 3, ey - radius - 22)
                elseif aiState == "position" or aiState == "attack" or aiState == "recover" or aiState == "reposition" then
                    love.graphics.setColor(1, 0.2, 0.2, 0.9)
                    love.graphics.setFont(fonts.small)
                    love.graphics.print("!", ex - 3, ey - radius - 22)
                elseif aiState == "reset" then
                    love.graphics.setColor(1, 0.6, 0, 0.7)
                    love.graphics.print("?", ex - 3, ey - radius - 22)
                end

                -- Name
                love.graphics.setFont(fonts.small)
                local nameColor = enemy.isBoss and {1, 0.85, 0.2, 0.9} or {1, 0.8, 0.8, 0.8}
                love.graphics.setColor(unpack(nameColor))
                love.graphics.printf(enemy.name or "Enemy", ex - 40, ey - radius - 14, 80, "center")

                -- HP bar
                if enemy.hp and enemy.maxHp and enemy.maxHp > 0 then
                    local barW = enemy.isBoss and 36 or 24
                    local barH = enemy.isBoss and 4 or 3
                    local barX = ex - barW/2
                    local barY = ey + radius + 2
                    local ratio = math.max(0, enemy.hp / enemy.maxHp)
                    love.graphics.setColor(0.2, 0, 0, 0.7)
                    love.graphics.rectangle("fill", barX, barY, barW, barH)
                    love.graphics.setColor(1 - ratio, ratio, 0, 0.9)
                    love.graphics.rectangle("fill", barX, barY, barW * ratio, barH)
                end
            end
        end
    end

    -- Echolocation sonar ring (kept as distinct world-space mechanic)
    if dungeon.visionType == "echolocation" then
        local time = love.timer.getTime()
        local pulsePhase = (time * 0.5) % 1
        local px = dungeon.playerTileX or 0
        local py = dungeon.playerTileY or 0
        local ringRadius = pulsePhase * 8 * ts
        local ringAlpha = 1 - pulsePhase
        love.graphics.setColor(0.3, 0.6, 1, ringAlpha * 0.4)
        love.graphics.setLineWidth(2)
        love.graphics.circle("line", px * ts + ts / 2, py * ts + ts / 2, ringRadius)
        love.graphics.setLineWidth(1)
    end

    -- True Seeing golden pulsing outline circles around visible enemies
    if dungeon.visionType == "true_seeing" and dungeon.enemies then
        local time = love.timer.getTime()
        local pulse = math.sin(time * 3) * 0.15 + 0.55
        love.graphics.setColor(1, 0.85, 0.2, pulse)
        love.graphics.setLineWidth(2)
        for _, enemy in ipairs(dungeon.enemies) do
            if enemy.alive ~= false then
                local ex = (enemy.x or 0) * ts + ts / 2
                local ey = (enemy.y or 0) * ts + ts / 2
                love.graphics.circle("line", ex, ey, 14)
            end
        end
        love.graphics.setLineWidth(1)
    end

    -- Draw magic auras (visible when magic_sense or true_seeing is active)
    if dungeon.magicAuras and (dungeon.visionType == "magic_sense" or dungeon.visionType == "true_seeing") then
        local time = love.timer.getTime()
        local auraColors = {
            cursed = {0.8, 0, 0.2},
            enchanted = {0.3, 0.5, 1},
            blessed = {1, 0.9, 0.3},
            corrupted = {0.4, 0, 0.5},
            haunted = {0.6, 0.8, 1},
            invisible = {0.9, 0.9, 0.9},
        }
        for _, aura in ipairs(dungeon.magicAuras) do
            local color = auraColors[aura.type] or {1, 1, 1}
            local pulse = math.sin(time * 2 + (aura.x or 0) * 0.5) * 0.2 + 0.5
            local intensity = aura.intensity or 0.5
            love.graphics.setColor(color[1], color[2], color[3], pulse * intensity)
            love.graphics.circle("fill", ((aura.x or 0) - 0.5) * ts, ((aura.y or 0) - 0.5) * ts, ts * 0.6)
        end
    end

    -- Draw downed player indicators (permadeath)
    if next(permadeath.downedPlayers) then
        local time = love.timer.getTime()
        for sid, dp in pairs(permadeath.downedPlayers) do
            local dx = dp.x * ts + ts/2
            local dy = dp.y * ts + ts/2
            local pulse = 0.5 + 0.5 * math.sin(time * 4)
            -- Red cross marker
            love.graphics.setColor(1, 0.2, 0.2, pulse)
            love.graphics.setLineWidth(3)
            love.graphics.line(dx - 8, dy - 8, dx + 8, dy + 8)
            love.graphics.line(dx - 8, dy + 8, dx + 8, dy - 8)
            love.graphics.setLineWidth(1)
            -- Name label
            love.graphics.setFont(fonts.chat or fonts.main)
            love.graphics.setColor(1, 0.3, 0.3, 0.9)
            love.graphics.printf(dp.name .. " (DOWNED)", dx - 60, dy - 22, 120, "center")
        end
    end
end

function game.drawDungeonHUD(W, H)
    -- Hit flash overlay (red vignette when taking damage)
    if dungeon.hitFlashTimer and dungeon.hitFlashTimer > 0 then
        local a = dungeon.hitFlashTimer / 0.2 * 0.3
        love.graphics.setColor(1, 0, 0, a)
        love.graphics.rectangle("fill", 0, 0, W, H)
    end

    -- Boss phase flash (purple pulse)
    if dungeon.bossPhaseFlash and dungeon.bossPhaseFlash > 0 then
        local a = dungeon.bossPhaseFlash / 0.5 * 0.25
        love.graphics.setColor(0.6, 0, 0.8, a)
        love.graphics.rectangle("fill", 0, 0, W, H)
    end

    -- Top bar: floor info
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", 0, 0, W, 36)

    love.graphics.setFont(fonts.hud)

    -- Dungeon name + floor
    local dungeonName = "The Rift"
    if dungeon.id and dungeon.id ~= "rift" then
        dungeonName = dungeon.id:gsub("cave_", "Cave "):gsub("_", ", ")
    end
    love.graphics.setColor(0.9, 0.8, 1, 0.9)
    love.graphics.print(dungeonName .. "  |  Floor " .. dungeon.floorNum, 10, 8)

    -- Theme
    if dungeon.theme then
        local themeName = dungeon.theme:gsub("_", " "):gsub("(%a)([%w_']*)", function(a, b) return a:upper()..b end)
        love.graphics.setColor(0.6, 0.5, 0.8, 0.7)
        love.graphics.print(themeName, 300, 8)
    end

    -- Boss floor indicator
    if dungeon.floor and dungeon.floor.isBossFloor then
        love.graphics.setColor(1, 0.2, 0.2, 0.9)
        love.graphics.print("BOSS FLOOR", W - 120, 8)
    end

    -- Pitch Black floor warning
    if dungeon.isPitchBlack then
        local pbPulse = math.sin(love.timer.getTime() * 3) * 0.15 + 0.85
        love.graphics.setColor(0.6, 0, 0.8, pbPulse)
        love.graphics.setFont(fonts.small)
        love.graphics.print("PITCH BLACK", W / 2 - 40, 10)
    end

    -- Vision type indicator (color-coded)
    local visionLabel = dungeon.visionType or "normal"
    local visionColors = {
        normal = {1, 1, 1, 0.6},
        darkvision = {0.2, 1, 0.3, 0.8},
        thermal = {1, 0.5, 0.1, 0.8},
        tremor = {0.8, 0.6, 0.2, 0.8},
        night = {0.2, 1, 0.3, 0.8},
        echolocation = {0.3, 0.6, 1, 0.8},
        magic_sense = {0.5, 0.1, 0.8, 0.8},
        true_seeing = {1, 0.85, 0.2, 0.8},
    }
    local vColor = visionColors[visionLabel] or visionColors.normal
    love.graphics.setColor(vColor[1], vColor[2], vColor[3], vColor[4])
    love.graphics.setFont(fonts.small)
    love.graphics.print(visionLabel:upper(), W - 220, 10)

    -- Torch/Lantern timer
    if dungeon.hasTorch or dungeon.hasLantern then
        local lightLabel = dungeon.hasLantern and "Lantern" or "Torch"
        local lightColor = dungeon.hasLantern and {1, 0.9, 0.5, 0.9} or {1, 0.6, 0.1, 0.9}
        love.graphics.setColor(lightColor[1], lightColor[2], lightColor[3], lightColor[4])
        love.graphics.print(lightLabel .. " Active", W - 220, 22)
    end

    -- HP / Mana / Stamina bars (left side, below top bar)
    local barX = 10
    local barY = 42
    local barW = 160
    local barH = 12
    local barSpacing = 16

    -- HP bar (red)
    local hp = dungeon.playerHp or 100
    local maxHp = dungeon.playerMaxHp or 100
    local hpRatio = maxHp > 0 and (hp / maxHp) or 0
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", barX - 1, barY - 1, barW + 2, barH + 2)
    love.graphics.setColor(0.6, 0, 0, 0.8)
    love.graphics.rectangle("fill", barX, barY, barW, barH)
    love.graphics.setColor(0.2 + 0.8 * (1 - hpRatio), 0.8 * hpRatio, 0, 0.9)
    love.graphics.rectangle("fill", barX, barY, barW * hpRatio, barH)
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf(math.floor(hp) .. " / " .. math.floor(maxHp), barX, barY, barW, "center")

    -- Mana bar (blue)
    barY = barY + barSpacing
    local mana = dungeon.playerMana or 50
    local maxMana = dungeon.playerMaxMana or 50
    local manaRatio = maxMana > 0 and (mana / maxMana) or 0
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", barX - 1, barY - 1, barW + 2, barH + 2)
    love.graphics.setColor(0, 0, 0.5, 0.8)
    love.graphics.rectangle("fill", barX, barY, barW, barH)
    love.graphics.setColor(0.2, 0.4, 0.9, 0.9)
    love.graphics.rectangle("fill", barX, barY, barW * manaRatio, barH)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf(math.floor(mana) .. " / " .. math.floor(maxMana), barX, barY, barW, "center")

    -- Stamina bar (green)
    barY = barY + barSpacing
    local stam = dungeon.playerStamina or 100
    local maxStam = dungeon.playerMaxStamina or 100
    local stamRatio = maxStam > 0 and (stam / maxStam) or 0
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", barX - 1, barY - 1, barW + 2, barH + 2)
    love.graphics.setColor(0, 0.3, 0, 0.8)
    love.graphics.rectangle("fill", barX, barY, barW, barH)
    love.graphics.setColor(0.2, 0.8, 0.2, 0.9)
    love.graphics.rectangle("fill", barX, barY, barW * stamRatio, barH)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf(math.floor(stam) .. " / " .. math.floor(maxStam), barX, barY, barW, "center")

    -- Level and XP (below stamina bar)
    barY = barY + barSpacing + 4
    love.graphics.setFont(fonts.small)
    local playerLevel = rpg.level or 1
    local playerXp = rpg.xp or 0
    local xpNeeded = 250 * playerLevel
    love.graphics.setColor(0.9, 0.85, 0.5, 0.9)
    love.graphics.print("Lv." .. playerLevel, barX, barY)
    -- XP bar
    local xpBarY = barY + 14
    local xpRatio = xpNeeded > 0 and (playerXp / xpNeeded) or 0
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", barX - 1, xpBarY - 1, barW + 2, barH + 2)
    love.graphics.setColor(0.3, 0.3, 0.1, 0.8)
    love.graphics.rectangle("fill", barX, xpBarY, barW, barH)
    love.graphics.setColor(0.9, 0.85, 0.3, 0.9)
    love.graphics.rectangle("fill", barX, xpBarY, barW * math.min(xpRatio, 1), barH)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf(playerXp .. " / " .. xpNeeded .. " XP", barX, xpBarY, barW, "center")

    -- Weapon Special charge bar (below stamina, left side)
    if game._itemUI.weaponSpecialName then
        local wsBarX = 10
        local wsBarY = barY + barSpacing + 24
        local wsBarW = 160
        local wsBarH = 10
        local wsRatio = game._itemUI.weaponSpecialMax > 0 and (game._itemUI.weaponSpecialCharge / game._itemUI.weaponSpecialMax) or 0

        love.graphics.setColor(0, 0, 0, 0.6)
        love.graphics.rectangle("fill", wsBarX - 1, wsBarY - 1, wsBarW + 2, wsBarH + 2)
        love.graphics.setColor(0.3, 0.15, 0.05, 0.8)
        love.graphics.rectangle("fill", wsBarX, wsBarY, wsBarW, wsBarH)
        -- Fill: orange to red gradient based on charge
        local r = 0.8 + 0.2 * wsRatio
        local g = 0.4 * (1 - wsRatio * 0.5)
        love.graphics.setColor(r, g, 0.1, 0.9)
        love.graphics.rectangle("fill", wsBarX, wsBarY, wsBarW * math.min(wsRatio, 1), wsBarH)
        -- Label
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(1, 0.8, 0.3, 0.9)
        love.graphics.printf(game._itemUI.weaponSpecialName .. "  " .. math.floor(game._itemUI.weaponSpecialCharge) .. "/" .. game._itemUI.weaponSpecialMax, wsBarX, wsBarY - 1, wsBarW, "center")

        -- Ready indicator (pulsing glow when full)
        if wsRatio >= 1 then
            local pulse = 0.6 + 0.4 * math.sin(love.timer.getTime() * 4)
            love.graphics.setColor(1, 0.6, 0.1, pulse * 0.4)
            love.graphics.rectangle("fill", wsBarX - 2, wsBarY - 2, wsBarW + 4, wsBarH + 4, 2, 2)
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(1, 0.9, 0.3, pulse)
            love.graphics.print("[F] Activate", wsBarX + wsBarW + 6, wsBarY - 1)
        end
    end

    -- Inscription hotbar (bottom-left, above controls hint)
    if #game._itemUI.inscriptionSlots > 0 then
        local insY = H - 52
        local insX = 10
        local insW = 40
        local insH = 30
        local insSpacing = 4

        for i, ins in ipairs(game._itemUI.inscriptionSlots) do
            local ix = insX + (i - 1) * (insW + insSpacing)

            -- Background
            local onCooldown = ins.cooldownLeft and ins.cooldownLeft > 0
            if onCooldown then
                love.graphics.setColor(0.15, 0.1, 0.1, 0.8)
            else
                love.graphics.setColor(0.1, 0.12, 0.2, 0.85)
            end
            love.graphics.rectangle("fill", ix, insY, insW, insH, 3, 3)

            -- Border
            if onCooldown then
                love.graphics.setColor(0.4, 0.2, 0.2, 0.6)
            else
                love.graphics.setColor(0.4, 0.5, 0.8, 0.7)
            end
            love.graphics.rectangle("line", ix, insY, insW, insH, 3, 3)

            -- Keybind number
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.6, 0.6, 0.7, 0.6)
            love.graphics.print(tostring(i), ix + 2, insY + 1)

            -- Inscription name (truncated)
            local insName = ins.name or ("Slot " .. i)
            if #insName > 5 then insName = insName:sub(1, 4) .. "." end
            love.graphics.setFont(fonts.small)
            if onCooldown then
                love.graphics.setColor(0.5, 0.3, 0.3, 0.7)
            else
                love.graphics.setColor(0.8, 0.7, 1, 0.9)
            end
            love.graphics.print(insName, ix + 3, insY + 12)

            -- Cooldown overlay
            if onCooldown then
                local cdMax = ins.cooldownMax or 1
                local cdRatio = ins.cooldownLeft / math.max(cdMax, 1)
                love.graphics.setColor(0, 0, 0, 0.5 * cdRatio)
                love.graphics.rectangle("fill", ix, insY, insW, insH * cdRatio, 3, 3)
                love.graphics.setFont(fonts.npc)
                love.graphics.setColor(1, 0.4, 0.4, 0.9)
                love.graphics.printf(string.format("%.0f", ins.cooldownLeft), ix, insY + 8, insW, "center")
            end
        end
    end

    -- Controls hint (updated)
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    local controlsStr = "[WASD] Move  [Click/Space] Attack  [E] Interact  [J] Quests"
    if #game._itemUI.inscriptionSlots > 0 then controlsStr = controlsStr .. "  [1-4] Inscriptions" end
    if game._itemUI.weaponSpecialName then controlsStr = controlsStr .. "  [F] Special" end
    love.graphics.print(controlsStr, 10, H - 18)

    -- Minimap (top-right corner) — cached to canvas, updated on visibility changes
    if dungeon.grid then
        local mapScale = 2
        local mapW = #dungeon.grid[1] * mapScale
        local mapH = #dungeon.grid * mapScale
        local mapX = W - mapW - 10
        local mapY = 42

        -- Background
        love.graphics.setColor(0, 0, 0, 0.6)
        love.graphics.rectangle("fill", mapX - 2, mapY - 2, mapW + 4, mapH + 4)

        -- Rebuild minimap canvas if dirty (set by dungeon_visibility_update handler)
        if dungeon._minimapDirty or not dungeon._minimapCanvas then
            if dungeon._minimapCanvas then dungeon._minimapCanvas:release() end
            local mmCanvas = love.graphics.newCanvas(mapW, mapH)
            love.graphics.setCanvas(mmCanvas)
            love.graphics.clear(0, 0, 0, 0)
            love.graphics.origin()
            for y = 1, #dungeon.grid do
                for x = 1, #dungeon.grid[y] do
                    local fogKey = (x-1) .. "," .. (y-1)
                    if dungeon.fog[fogKey] then
                        local tile = dungeon.grid[y][x]
                        if tile == DTILE.WALL then
                            love.graphics.setColor(0.3, 0.25, 0.35, 0.8)
                        elseif tile == DTILE.STAIRS_UP then
                            love.graphics.setColor(0.3, 0.8, 0.3, 0.9)
                        elseif tile == DTILE.STAIRS_DOWN or tile == DTILE.EXIT then
                            love.graphics.setColor(0.8, 0.3, 0.3, 0.9)
                        elseif tile == DTILE.BOSS_DOOR then
                            love.graphics.setColor(1, 0.1, 0.1, 0.9)
                        else
                            love.graphics.setColor(0.5, 0.45, 0.4, 0.6)
                        end
                        love.graphics.rectangle("fill", (x-1) * mapScale, (y-1) * mapScale, mapScale, mapScale)
                    end
                end
            end
            love.graphics.setCanvas()
            dungeon._minimapCanvas = mmCanvas
            dungeon._minimapDirty = false
        end

        -- Draw cached minimap
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.draw(dungeon._minimapCanvas, mapX, mapY)

        -- Player dot on minimap (always drawn fresh)
        love.graphics.setColor(0, 1, 0, 1)
        love.graphics.rectangle("fill",
            mapX + dungeon.playerTileX * mapScale,
            mapY + dungeon.playerTileY * mapScale,
            mapScale, mapScale)

        -- Enemy dots on minimap (always drawn fresh)
        for _, e in ipairs(dungeon.enemies) do
            if e.alive ~= false then
                local efKey = e.x .. "," .. e.y
                if dungeon.fog[efKey] then
                    love.graphics.setColor(1, 0.2, 0.2, 0.8)
                    love.graphics.rectangle("fill",
                        mapX + e.x * mapScale,
                        mapY + e.y * mapScale,
                        mapScale, mapScale)
                end
            end
        end
    end
end

function game.drawDirectorUI(W, H)
    -- World event banners (center-top, gold/amber, fade in/out)
    for i, ev in ipairs(game._directorEvents) do
        local alpha = ev.fadeIn or 1
        -- Fade out in last 1 second
        if ev.timer < 1 then
            alpha = alpha * ev.timer
        end
        if alpha > 0 then
            local bannerY = 44 + (i - 1) * 50
            local bannerW = math.min(500, W - 40)
            local bannerX = (W - bannerW) / 2

            -- Lich events use purple theme, others use gold
            local isLich = (ev.type == "lich" or ev.type == "lich_horde" or ev.type == "lich_attack" or ev.type == "lich_cleanse" or ev.type == "lich_counter")
            if isLich then
                -- Purple banner background
                love.graphics.setColor(0.1, 0.02, 0.15, 0.8 * alpha)
                love.graphics.rectangle("fill", bannerX, bannerY, bannerW, 44, 6, 6)
                love.graphics.setColor(0.6, 0.15, 0.8, 0.8 * alpha)
                love.graphics.rectangle("line", bannerX, bannerY, bannerW, 44, 6, 6)
                love.graphics.setFont(fonts.hud)
                love.graphics.setColor(0.8, 0.3, 1, alpha)
                love.graphics.printf(ev.title, bannerX + 8, bannerY + 4, bannerW - 16, "center")
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.75, 0.6, 0.9, 0.9 * alpha)
                love.graphics.printf(ev.description, bannerX + 8, bannerY + 22, bannerW - 16, "center")
            else
                -- Banner background
                love.graphics.setColor(0.15, 0.1, 0, 0.75 * alpha)
                love.graphics.rectangle("fill", bannerX, bannerY, bannerW, 44, 6, 6)
                -- Gold border
                love.graphics.setColor(0.9, 0.75, 0.2, 0.8 * alpha)
                love.graphics.rectangle("line", bannerX, bannerY, bannerW, 44, 6, 6)
                -- Title
                love.graphics.setFont(fonts.hud)
                love.graphics.setColor(1, 0.85, 0.2, alpha)
                love.graphics.printf(ev.title, bannerX + 8, bannerY + 4, bannerW - 16, "center")
                -- Description
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.95, 0.9, 0.7, 0.9 * alpha)
                love.graphics.printf(ev.description, bannerX + 8, bannerY + 22, bannerW - 16, "center")
            end
        end
    end

    -- Zone ticker (bottom-right, small messages)
    local tickerX = W - 260
    local tickerY = H - 30
    for i = #game._zoneTicker, 1, -1 do
        local zt = game._zoneTicker[i]
        local alpha = 1
        if zt.timer < 1 then alpha = zt.timer end

        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.5, 0.7, 0.9, 0.6 * alpha)
        love.graphics.printf(zt.message, tickerX, tickerY, 250, "right")
        tickerY = tickerY - 16
    end
end

function game.drawRaidUI(W, H)
    if not game._raid.state then return end

    if game._raid.state.state == "waiting" and game._raid.state.barrierActive then
        -- Waiting room: player counter + atmospheric text
        local boxW = 320
        local boxH = 80
        local boxX = (W - boxW) / 2
        local boxY = H / 2 - boxH / 2

        -- Dark background
        love.graphics.setColor(0.05, 0.02, 0.1, 0.85)
        love.graphics.rectangle("fill", boxX, boxY, boxW, boxH, 8, 8)
        -- Purple border
        love.graphics.setColor(0.6, 0.2, 0.8, 0.8)
        love.graphics.rectangle("line", boxX, boxY, boxW, boxH, 8, 8)

        -- Player count
        love.graphics.setFont(fonts.hud)
        local countText = game._raid.state.playerCount .. " / " .. game._raid.state.minPlayers .. " Players Ready"
        local countColor = game._raid.state.playerCount >= game._raid.state.minPlayers and {0.2, 1, 0.3} or {1, 0.85, 0.3}
        love.graphics.setColor(countColor[1], countColor[2], countColor[3], 1)
        love.graphics.printf(countText, boxX, boxY + 10, boxW, "center")

        -- Pulsing atmospheric text
        local pulse = 0.5 + 0.5 * math.sin(love.timer.getTime() * 2)
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.6, 0.3, 0.8, 0.5 + 0.3 * pulse)
        love.graphics.printf("A massive presence lurks beyond the barrier...", boxX + 8, boxY + 38, boxW - 16, "center")

        -- Boss name
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.9, 0.5, 0.2, 0.8)
        love.graphics.printf(game._raid.state.bossName, boxX, boxY + 58, boxW, "center")
    end

    -- Raid boss health bar (full-width bar at top)
    if game._raid.bossHp and game._raid.state and game._raid.state.state == "active" then
        local barH = 28
        local barPad = 40
        local barW = W - barPad * 2
        local barY = 42

        -- Background
        love.graphics.setColor(0, 0, 0, 0.8)
        love.graphics.rectangle("fill", barPad - 2, barY - 2, barW + 4, barH + 4, 4, 4)

        -- HP bar (dark red base, bright red fill)
        love.graphics.setColor(0.3, 0, 0, 0.9)
        love.graphics.rectangle("fill", barPad, barY, barW, barH, 3, 3)

        local hpRatio = game._raid.bossHp.maxHp > 0 and (game._raid.bossHp.hp / game._raid.bossHp.maxHp) or 0
        -- Color shifts: purple for lich, red->orange for others
        local r, g, b
        if game._raid.phase then
            r = 0.5 + 0.3 * (1 - hpRatio)
            g = 0.1
            b = 0.6 + 0.2 * hpRatio
        else
            r = 0.8 + 0.2 * (1 - hpRatio)
            g = 0.1 + 0.3 * (1 - hpRatio)
            b = 0
        end
        love.graphics.setColor(r, g, b, 0.95)
        love.graphics.rectangle("fill", barPad, barY, barW * hpRatio, barH, 3, 3)

        -- Phase threshold markers on HP bar
        local phaseThresholds = { 0.7, 0.4, 0.15 }
        for _, threshold in ipairs(phaseThresholds) do
            local markerX = barPad + barW * threshold
            love.graphics.setColor(1, 1, 1, 0.4)
            love.graphics.setLineWidth(1)
            love.graphics.line(markerX, barY, markerX, barY + barH)
        end

        -- Boss name + phase
        love.graphics.setFont(fonts.hud)
        love.graphics.setColor(1, 1, 1, 1)
        local bossLabel = game._raid.bossHp.name
        if game._raid.phase then
            bossLabel = bossLabel .. " - " .. (game._raid.phase.phaseName or "Phase " .. game._raid.phase.phase)
        elseif game._raid.bossHp.phase and game._raid.bossHp.phase > 1 then
            bossLabel = bossLabel .. " (Phase " .. game._raid.bossHp.phase .. ")"
        end
        love.graphics.printf(bossLabel, barPad, barY + 2, barW, "center")

        -- HP numbers
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(1, 1, 1, 0.8)
        local hpText = math.floor(game._raid.bossHp.hp) .. " / " .. math.floor(game._raid.bossHp.maxHp)
        love.graphics.printf(hpText, barPad, barY + 16, barW, "center")

        -- Phylactery HP bars (phase 2)
        if #game._raid.phylacteries > 0 then
            local phylY = barY + barH + 6
            local phylBarW = (barW - 20) / 4
            for pi, phyl in ipairs(game._raid.phylacteries) do
                local phylX = barPad + (pi - 1) * (phylBarW + 5)
                local phylRatio = phyl.maxHp > 0 and (phyl.hp / phyl.maxHp) or 0

                -- Background
                love.graphics.setColor(0.1, 0, 0.1, 0.8)
                love.graphics.rectangle("fill", phylX, phylY, phylBarW, 14, 2, 2)

                -- HP fill (purple)
                love.graphics.setColor(0.6, 0.2, 0.8, 0.9)
                love.graphics.rectangle("fill", phylX, phylY, phylBarW * phylRatio, 14, 2, 2)

                -- Label
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(1, 1, 1, 0.8)
                love.graphics.printf("Phylactery " .. pi, phylX, phylY + 1, phylBarW, "center")
            end
        end
    end

    -- Lich game._raid corruption zones on dungeon floor (pulsing purple squares)
    if dungeon.inDungeon and #game._raid.corruptionZones > 0 then
        for _, zone in ipairs(game._raid.corruptionZones) do
            local zoneAlpha = 0.3 + math.sin(corruption.animTimer * 4) * 0.15
            love.graphics.setColor(0.5, 0.1, 0.6, zoneAlpha)
            local tileSize = 32
            local zx = zone.x * tileSize - (camera and camera.x or 0)
            local zy = zone.y * tileSize - (camera and camera.y or 0)
            local zSize = (zone.radius * 2 + 1) * tileSize
            love.graphics.rectangle("fill", zx - zone.radius * tileSize, zy - zone.radius * tileSize, zSize, zSize)
            -- Warning border
            love.graphics.setColor(0.8, 0.2, 1, zoneAlpha + 0.2)
            love.graphics.setLineWidth(2)
            love.graphics.rectangle("line", zx - zone.radius * tileSize, zy - zone.radius * tileSize, zSize, zSize)
            -- Damage text
            love.graphics.setFont(fonts.small)
            love.graphics.setColor(1, 0.3, 0.6, zoneAlpha + 0.3)
            love.graphics.printf("-" .. zone.damage, zx - 20, zy - 8, 40, "center")
        end
    end
end

function game.drawDungeonPrompts(W, H)
    if not dungeon.inDungeon or not dungeon.grid then return end

    -- Check what's at the player's current tile
    local tile = nil
    if dungeon.grid[dungeon.playerTileY + 1] then
        tile = dungeon.grid[dungeon.playerTileY + 1][dungeon.playerTileX + 1]
    end

    love.graphics.setFont(fonts.ui)

    if tile == DTILE.STAIRS_DOWN or tile == DTILE.EXIT then
        love.graphics.setColor(0.6, 1, 0.6, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
        love.graphics.printf("Press E to descend", 0, H / 2 - 80, W, "center")
    elseif tile == DTILE.STAIRS_UP or tile == DTILE.ENTRANCE then
        if dungeon.floorNum > 1 then
            love.graphics.setColor(0.6, 1, 0.6, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
            love.graphics.printf("Press E to ascend", 0, H / 2 - 80, W, "center")
        else
            love.graphics.setColor(0.6, 1, 0.6, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
            love.graphics.printf("Press E to exit dungeon", 0, H / 2 - 80, W, "center")
        end
    elseif tile == DTILE.BOSS_DOOR then
        love.graphics.setColor(1, 0.3, 0.3, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
        love.graphics.printf("Press E to enter Boss Room", 0, H / 2 - 80, W, "center")
    end

    -- Check for adjacent chest
    for _, chest in ipairs(dungeon.chests) do
        if not chest.opened then
            local dx = math.abs(chest.x - dungeon.playerTileX)
            local dy = math.abs(chest.y - dungeon.playerTileY)
            if dx <= 1 and dy <= 1 and (dx + dy) <= 1 then
                love.graphics.setColor(1, 0.85, 0.2, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
                love.graphics.printf("Press E to open chest", 0, H / 2 - 60, W, "center")
                break
            end
        end
    end

    -- Check for adjacent NPC
    for i, npc in ipairs(dungeon.npcs) do
        if not npc.claimed then
            local dx = math.abs(npc.x - dungeon.playerTileX)
            local dy = math.abs(npc.y - dungeon.playerTileY)
            if dx <= 1 and dy <= 1 and (dx + dy) <= 1 then
                love.graphics.setColor(0.5, 0.8, 1, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
                love.graphics.printf("Press E to talk to " .. (npc.type or "NPC"), 0, H / 2 - 60, W, "center")
                break
            end
        end
    end

    -- Check for adjacent corpse
    for _, cr in ipairs(dungeon.corpses) do
        if not cr.examined then
            local dx = math.abs(cr.x - dungeon.playerTileX)
            local dy = math.abs(cr.y - dungeon.playerTileY)
            if dx <= 1 and dy <= 1 and (dx + dy) <= 1 then
                love.graphics.setColor(0.8, 0.75, 0.6, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
                love.graphics.printf("Press E to examine remains", 0, H / 2 - 60, W, "center")
                break
            end
        end
    end

    -- Check for adjacent enemy (attack prompt)
    for i, enemy in ipairs(dungeon.enemies) do
        if enemy.alive ~= false then
            local dx = math.abs(enemy.x - dungeon.playerTileX)
            local dy = math.abs(enemy.y - dungeon.playerTileY)
            if dx <= 1 and dy <= 1 then
                love.graphics.setColor(1, 0.3, 0.3, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
                love.graphics.printf("Click or Space to attack " .. (enemy.name or "Enemy"), 0, H / 2 - 60, W, "center")
                break
            end
        end
    end

    -- Combat join offer prompt
    if dungeon.combatJoinOffer and not tcState.inCombat then
        local offer = dungeon.combatJoinOffer
        local alpha = fadeIn * (0.7 + math.sin(love.timer.getTime() * 3) * 0.3)
        love.graphics.setColor(1, 0.8, 0.2, alpha)
        local msg = string.format("Nearby combat! %d allies vs %d enemies — Press J to join (%.0fs)",
            offer.allyCount or 0, offer.enemyCount or 0, math.max(0, offer.timer))
        love.graphics.printf(msg, 0, H / 2 - 100, W, "center")
    end
end

function game.drawDungeonQuests(W, H)
    if not dungeon.progress or not dungeon.progress.dailyQuests then return end

    local panelW = 300
    local panelH = 250
    local px = W / 2 - panelW / 2
    local py = H / 2 - panelH / 2

    -- Background
    love.graphics.setColor(0.05, 0.05, 0.1, 0.9)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.4, 0.3, 0.6, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)

    -- Title
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.9, 0.8, 1)
    love.graphics.printf("Daily Dungeon Quests", px, py + 10, panelW, "center")

    -- Quests
    love.graphics.setFont(fonts.chat)
    local qy = py + 40
    local quests = dungeon.progress.dailyQuests
    if type(quests) == "table" then
        for _, q in ipairs(quests) do
            local completed = q.completed
            local questText = q.name or q.description or q.desc or ""
            if completed then
                love.graphics.setColor(0.3, 0.8, 0.3, 0.8)
                love.graphics.print("[DONE] " .. questText, px + 10, qy)
            else
                love.graphics.setColor(0.8, 0.8, 0.9, 0.9)
                love.graphics.print("[ ] " .. questText, px + 10, qy)
            end
            love.graphics.setColor(0.6, 0.5, 0.3, 0.7)
            love.graphics.print("  Reward: " .. (q.xpReward or 0) .. " XP, " .. (q.goldReward or 0) .. " gold", px + 10, qy + 16)
            qy = qy + 38
        end
    end

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("[J] to close", px, py + panelH - 18, panelW, "center")
end

function game.drawLeaderboard(W, H)
    if not dungeon.progress or not dungeon.progress.leaderboard then return end

    local panelW = 350
    local panelH = 300
    local px = W / 2 - panelW / 2
    local py = H / 2 - panelH / 2

    -- Background
    love.graphics.setColor(0.05, 0.05, 0.1, 0.9)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.6, 0.5, 0.2, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)

    -- Title
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(1, 0.85, 0.2)
    love.graphics.printf("Hall of Heroes", px, py + 10, panelW, "center")

    -- Deepest floor leaderboard
    love.graphics.setFont(fonts.chat)
    love.graphics.setColor(0.8, 0.7, 1, 0.9)
    love.graphics.print("Deepest Floor:", px + 10, py + 40)

    local lb = dungeon.progress.leaderboard.deepestFloor or {}
    local ly = py + 60
    for rank, entry in ipairs(lb) do
        if rank > 10 then break end
        love.graphics.setColor(0.7, 0.7, 0.8, 0.8)
        love.graphics.print(rank .. ". " .. (entry.name or "???") .. " — Floor " .. (entry.floor or 0), px + 20, ly)
        ly = ly + 18
    end

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("[L] to close", px, py + panelH - 18, panelW, "center")
end

function game.drawPartyPanel(W, H)
    local panelW = 280
    local panelH = 360
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    -- Background overlay
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.08, 0.09, 0.14, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.3, 0.5, 0.8, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.4, 0.7, 1, 1)
    love.graphics.printf("Party", px, py + 10, panelW, "center")

    local contentY = py + 42

    if not game._raid.partyData then
        -- Not in a party
        love.graphics.setFont(fonts.chat)
        love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
        love.graphics.printf("You are not in a party.", px + 10, contentY, panelW - 20, "center")
        contentY = contentY + 30

        -- Create Party button
        local btnW = 140
        local btnH = 30
        local btnX = px + (panelW - btnW) / 2
        local btnY = contentY + 5
        love.graphics.setColor(0.15, 0.3, 0.5, 0.9)
        love.graphics.rectangle("fill", btnX, btnY, btnW, btnH, 5, 5)
        love.graphics.setColor(0.3, 0.6, 0.9, 0.8)
        love.graphics.rectangle("line", btnX, btnY, btnW, btnH, 5, 5)
        love.graphics.setFont(fonts.hud)
        love.graphics.setColor(0.8, 0.9, 1, 1)
        love.graphics.printf("Create Party", btnX, btnY + 7, btnW, "center")

        -- Store button area for click detection
        ui._partyCreateBtn = { x = btnX, y = btnY, w = btnW, h = btnH }
        contentY = btnY + btnH + 15

        -- Pending invite section
        if game._raid.partyInvitePending then
            love.graphics.setColor(0.3, 0.3, 0.5, 0.6)
            love.graphics.line(px + 15, contentY, px + panelW - 15, contentY)
            contentY = contentY + 8

            love.graphics.setFont(fonts.chat)
            love.graphics.setColor(0.4, 0.7, 1, 1)
            love.graphics.printf("Invite from: " .. (game._raid.partyInvitePending.fromName or "?"), px + 10, contentY, panelW - 20, "center")
            contentY = contentY + 22

            -- Accept / Decline buttons
            local halfW = 80
            local accX = px + panelW / 2 - halfW - 8
            local decX = px + panelW / 2 + 8
            local ibtnH = 26

            -- Accept
            love.graphics.setColor(0.15, 0.35, 0.15, 0.9)
            love.graphics.rectangle("fill", accX, contentY, halfW, ibtnH, 4, 4)
            love.graphics.setColor(0.3, 0.8, 0.3, 0.8)
            love.graphics.rectangle("line", accX, contentY, halfW, ibtnH, 4, 4)
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.5, 1, 0.5, 1)
            love.graphics.printf("Accept", accX, contentY + 6, halfW, "center")

            -- Decline
            love.graphics.setColor(0.35, 0.15, 0.15, 0.9)
            love.graphics.rectangle("fill", decX, contentY, halfW, ibtnH, 4, 4)
            love.graphics.setColor(0.8, 0.3, 0.3, 0.8)
            love.graphics.rectangle("line", decX, contentY, halfW, ibtnH, 4, 4)
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(1, 0.5, 0.5, 1)
            love.graphics.printf("Decline", decX, contentY + 6, halfW, "center")

            ui._partyAcceptBtn = { x = accX, y = contentY, w = halfW, h = ibtnH }
            ui._partyDeclineBtn = { x = decX, y = contentY, w = halfW, h = ibtnH }
        else
            ui._partyAcceptBtn = nil
            ui._partyDeclineBtn = nil
        end
    else
        -- In a party: member list
        love.graphics.setFont(fonts.hud)
        love.graphics.setColor(0.6, 0.7, 0.8, 0.7)
        love.graphics.printf("Members (" .. #game._raid.partyData.members .. ")", px + 10, contentY, panelW - 20, "left")
        contentY = contentY + 22

        for i, member in ipairs(game._raid.partyData.members) do
            local my = contentY + (i - 1) * 38
            if my + 38 > py + panelH - 80 then break end

            -- Member row background
            local isLeader = (member.id == game._raid.partyData.leader)
            local isSelf = (member.id == myId)
            if isSelf then
                love.graphics.setColor(0.12, 0.18, 0.25, 0.8)
            else
                love.graphics.setColor(0.1, 0.1, 0.16, 0.7)
            end
            love.graphics.rectangle("fill", px + 8, my, panelW - 16, 34, 4, 4)

            -- Leader crown indicator
            if isLeader then
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(1, 0.85, 0.2, 0.9)
                love.graphics.print("*", px + 14, my + 4)
            end

            -- Member name
            love.graphics.setFont(fonts.chat)
            local mr, mg, mb = game.hexToRGB(member.color or "#FFFFFF")
            love.graphics.setColor(mr, mg, mb, 0.95)
            local nameX = isLeader and (px + 26) or (px + 16)
            love.graphics.print(member.name or "?", nameX, my + 4)

            -- Level display (from players table if available)
            local memberPlayer = players[member.id]
            if isSelf and rpg.level then
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.7, 0.7, 0.8, 0.7)
                love.graphics.printf("Lv." .. rpg.level, px + 8, my + 4, panelW - 24, "right")
            end

            -- HP bar for self (we only know our own HP in dungeon)
            if isSelf and (dungeon.inDungeon or tcState.inCombat) then
                local hpRatio = dungeon.playerMaxHp > 0 and (dungeon.playerHp / dungeon.playerMaxHp) or 1
                local barX = nameX
                local barY = my + 22
                local barW = panelW - 40
                local barH = 6
                love.graphics.setColor(0.2, 0, 0, 0.6)
                love.graphics.rectangle("fill", barX, barY, barW, barH, 2, 2)
                love.graphics.setColor(0.2 + 0.8 * (1 - hpRatio), 0.8 * hpRatio, 0, 0.8)
                love.graphics.rectangle("fill", barX, barY, barW * hpRatio, barH, 2, 2)
            end
        end

        contentY = contentY + #game._raid.partyData.members * 38 + 8

        -- Separator
        love.graphics.setColor(0.3, 0.3, 0.5, 0.4)
        love.graphics.line(px + 15, contentY, px + panelW - 15, contentY)
        contentY = contentY + 8

        -- Invite button + text input
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(0.6, 0.7, 0.8, 0.8)
        love.graphics.print("Invite player:", px + 14, contentY)
        contentY = contentY + 16

        -- Invite text input
        local inputW = panelW - 80
        local inputH = 22
        local inputX = px + 10
        local inputY = contentY
        if game._raid.partyInviteActive then
            love.graphics.setColor(0.12, 0.12, 0.2, 0.9)
        else
            love.graphics.setColor(0.08, 0.08, 0.12, 0.7)
        end
        love.graphics.rectangle("fill", inputX, inputY, inputW, inputH, 3, 3)
        if game._raid.partyInviteActive then
            love.graphics.setColor(0.3, 0.5, 0.8, 0.7)
        else
            love.graphics.setColor(0.2, 0.3, 0.4, 0.5)
        end
        love.graphics.rectangle("line", inputX, inputY, inputW, inputH, 3, 3)

        love.graphics.setFont(fonts.npc)
        if game._raid.partyInviteActive then
            love.graphics.setColor(1, 1, 1, 0.95)
            love.graphics.print(game._raid.partyInviteInput .. (math.floor(love.timer.getTime() * 2) % 2 == 0 and "|" or ""), inputX + 4, inputY + 4)
        elseif #game._raid.partyInviteInput > 0 then
            love.graphics.setColor(0.8, 0.8, 0.8, 0.8)
            love.graphics.print(game._raid.partyInviteInput, inputX + 4, inputY + 4)
        else
            love.graphics.setColor(0.4, 0.4, 0.5, 0.5)
            love.graphics.print("Username...", inputX + 4, inputY + 4)
        end

        -- Send invite button
        local sendW = 55
        local sendX = px + panelW - sendW - 10
        love.graphics.setColor(0.15, 0.3, 0.5, 0.9)
        love.graphics.rectangle("fill", sendX, inputY, sendW, inputH, 3, 3)
        love.graphics.setColor(0.3, 0.6, 0.9, 0.8)
        love.graphics.rectangle("line", sendX, inputY, sendW, inputH, 3, 3)
        love.graphics.setColor(0.8, 0.9, 1, 1)
        love.graphics.printf("Invite", sendX, inputY + 4, sendW, "center")

        ui._raid.partyInviteInput = { x = inputX, y = inputY, w = inputW, h = inputH }
        ui._partyInviteSendBtn = { x = sendX, y = inputY, w = sendW, h = inputH }

        contentY = inputY + inputH + 12

        -- Leave / Disband button
        local isLeader = (game._raid.partyData.leader == myId)
        local leaveBtnW = 120
        local leaveBtnH = 28
        local leaveBtnX = px + (panelW - leaveBtnW) / 2
        local leaveBtnY = py + panelH - leaveBtnH - 30

        if isLeader then
            love.graphics.setColor(0.35, 0.12, 0.12, 0.9)
            love.graphics.rectangle("fill", leaveBtnX, leaveBtnY, leaveBtnW, leaveBtnH, 5, 5)
            love.graphics.setColor(0.8, 0.3, 0.3, 0.8)
            love.graphics.rectangle("line", leaveBtnX, leaveBtnY, leaveBtnW, leaveBtnH, 5, 5)
            love.graphics.setFont(fonts.hud)
            love.graphics.setColor(1, 0.5, 0.5, 1)
            love.graphics.printf("Disband Party", leaveBtnX, leaveBtnY + 6, leaveBtnW, "center")
        else
            love.graphics.setColor(0.25, 0.15, 0.12, 0.9)
            love.graphics.rectangle("fill", leaveBtnX, leaveBtnY, leaveBtnW, leaveBtnH, 5, 5)
            love.graphics.setColor(0.7, 0.4, 0.3, 0.8)
            love.graphics.rectangle("line", leaveBtnX, leaveBtnY, leaveBtnW, leaveBtnH, 5, 5)
            love.graphics.setFont(fonts.hud)
            love.graphics.setColor(1, 0.7, 0.5, 1)
            love.graphics.printf("Leave Party", leaveBtnX, leaveBtnY + 6, leaveBtnW, "center")
        end

        ui._partyLeaveBtn = { x = leaveBtnX, y = leaveBtnY, w = leaveBtnW, h = leaveBtnH }
    end

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("[Y] or [ESC] to close", px, py + panelH - 18, panelW, "center")
end

function game.drawPartyHUD(W, H)
    if not game._raid.partyData or not game._raid.partyData.members then return end
    if #game._raid.partyData.members <= 1 then return end  -- don't show if solo

    -- Compact member list (top-right, below minimap or compass area)
    local hudX = W - 170
    local hudY = 36
    -- If in dungeon, offset below minimap
    if dungeon.inDungeon and dungeon.grid then
        local mapScale = 2
        local mapH = #dungeon.grid * mapScale
        hudY = 42 + mapH + 10
    end

    -- Background
    local memberCount = #game._raid.partyData.members
    local hudH = 12 + memberCount * 18
    love.graphics.setColor(0, 0, 0, 0.45)
    love.graphics.rectangle("fill", hudX - 4, hudY - 2, 164, hudH, 4, 4)

    -- Header
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.4, 0.7, 1, 0.8)
    love.graphics.print("Party (" .. memberCount .. ")", hudX, hudY)

    -- Members
    for i, member in ipairs(game._raid.partyData.members) do
        local my = hudY + 12 + (i - 1) * 18
        local isSelf = (member.id == myId)
        local isLeader = (member.id == game._raid.partyData.leader)

        -- Leader indicator
        if isLeader then
            love.graphics.setColor(1, 0.85, 0.2, 0.9)
            love.graphics.print("*", hudX, my)
        end

        -- Name
        local mr, mg, mb = game.hexToRGB(member.color or "#FFFFFF")
        if isSelf then
            love.graphics.setColor(mr, mg, mb, 1)
        else
            love.graphics.setColor(mr, mg, mb, 0.8)
        end
        local nameX = isLeader and (hudX + 10) or hudX
        local displayName = member.name or "?"
        if #displayName > 14 then displayName = displayName:sub(1, 13) .. "." end
        love.graphics.print(displayName, nameX, my)

        -- Compact HP bar for self (only in dungeon)
        if isSelf and (dungeon.inDungeon or tcState.inCombat) then
            local hpRatio = dungeon.playerMaxHp > 0 and (dungeon.playerHp / dungeon.playerMaxHp) or 1
            local barX = hudX + 100
            local barY = my + 3
            local barW = 52
            local barH = 5
            love.graphics.setColor(0.2, 0, 0, 0.5)
            love.graphics.rectangle("fill", barX, barY, barW, barH, 1, 1)
            love.graphics.setColor(0.2 + 0.8 * (1 - hpRatio), 0.8 * hpRatio, 0, 0.8)
            love.graphics.rectangle("fill", barX, barY, barW * hpRatio, barH, 1, 1)
        end
    end
end

function game.drawPartyInvitePrompt(W, H)
    if not game._raid.partyInvitePending then return end

    -- Floating prompt at top-center
    local promptW = 300
    local promptH = 50
    local promptX = (W - promptW) / 2
    local promptY = 50

    -- Background
    love.graphics.setColor(0.05, 0.08, 0.15, 0.9)
    love.graphics.rectangle("fill", promptX, promptY, promptW, promptH, 6, 6)
    love.graphics.setColor(0.3, 0.5, 0.8, 0.8)
    love.graphics.rectangle("line", promptX, promptY, promptW, promptH, 6, 6)

    -- Text
    love.graphics.setFont(fonts.chat)
    love.graphics.setColor(0.4, 0.7, 1, 1)
    love.graphics.printf((game._raid.partyInvitePending.fromName or "?") .. " invited you to a party!", promptX + 8, promptY + 6, promptW - 16, "center")

    -- Accept/Decline hints
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.8, 0.5, 0.8)
    love.graphics.printf("Open Party panel [Y] to respond", promptX + 8, promptY + 28, promptW - 16, "center")
end

function game.drawContextMenu()
    local ctx = ui.contextMenu
    if not ctx then return end

    local ctxItems = ctx.items or CONTEXT_MENU_ITEMS_BASE
    local mx, my = love.mouse.getPosition()
    local itemCount = #ctxItems
    local menuH = CONTEXT_MENU_HEADER_HEIGHT + itemCount * CONTEXT_MENU_ITEM_HEIGHT + CONTEXT_MENU_PADDING * 2
    local menuW = CONTEXT_MENU_WIDTH
    local menuX = ctx.x
    local menuY = ctx.y

    -- Clamp menu to screen bounds
    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()
    if menuX + menuW > W then menuX = W - menuW - 2 end
    if menuY + menuH > H then menuY = H - menuH - 2 end
    if menuX < 2 then menuX = 2 end
    if menuY < 2 then menuY = 2 end

    -- Drop shadow
    love.graphics.setColor(0, 0, 0, 0.4)
    love.graphics.rectangle("fill", menuX + 3, menuY + 3, menuW, menuH, 6, 6)

    -- Background
    love.graphics.setColor(0.08, 0.08, 0.14, 0.95)
    love.graphics.rectangle("fill", menuX, menuY, menuW, menuH, 6, 6)

    -- Border
    love.graphics.setColor(0.4, 0.45, 0.6, 0.8)
    love.graphics.setLineWidth(1)
    love.graphics.rectangle("line", menuX, menuY, menuW, menuH, 6, 6)

    -- Header: player name
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(0.9, 0.8, 0.3, 1)
    love.graphics.printf(ctx.targetName or "Player", menuX + 8, menuY + 5, menuW - 16, "left")

    -- Separator line under header
    love.graphics.setColor(0.3, 0.35, 0.5, 0.6)
    love.graphics.line(menuX + 6, menuY + CONTEXT_MENU_HEADER_HEIGHT, menuX + menuW - 6, menuY + CONTEXT_MENU_HEADER_HEIGHT)

    -- Determine which item the mouse is hovering over
    local hoverIdx = nil
    local itemsStartY = menuY + CONTEXT_MENU_HEADER_HEIGHT + CONTEXT_MENU_PADDING
    if mx >= menuX and mx <= menuX + menuW then
        for i = 1, itemCount do
            local iy = itemsStartY + (i - 1) * CONTEXT_MENU_ITEM_HEIGHT
            if my >= iy and my < iy + CONTEXT_MENU_ITEM_HEIGHT then
                hoverIdx = i
                break
            end
        end
    end
    ctx.hoverIndex = hoverIdx

    -- Draw each menu item
    love.graphics.setFont(fonts.chat)
    for i, item in ipairs(ctxItems) do
        local iy = itemsStartY + (i - 1) * CONTEXT_MENU_ITEM_HEIGHT

        -- Hover highlight
        if hoverIdx == i then
            love.graphics.setColor(0.25, 0.3, 0.5, 0.7)
            local hlX = menuX + 3
            local hlW = menuW - 6
            love.graphics.rectangle("fill", hlX, iy, hlW, CONTEXT_MENU_ITEM_HEIGHT, 3, 3)
        end

        -- Item-specific icon color
        if item.action == "friend" then
            love.graphics.setColor(0.4, 0.9, 0.4, 1)
        elseif item.action == "party" then
            love.graphics.setColor(0.4, 0.7, 1, 1)
        elseif item.action == "game._trade" then
            love.graphics.setColor(1, 0.85, 0.2, 1)
        elseif item.action == "duel" then
            love.graphics.setColor(1, 0.35, 0.35, 1)
        elseif item.action == "profile" then
            love.graphics.setColor(0.7, 0.7, 0.85, 1)
        elseif item.action == "whisper" then
            love.graphics.setColor(0.85, 0.6, 1, 1)
        elseif item.action == "party_kick" then
            love.graphics.setColor(1, 0.5, 0.3, 1)
        else
            love.graphics.setColor(0.8, 0.8, 0.8, 1)
        end

        -- Small icon indicator (dot)
        love.graphics.circle("fill", menuX + 14, iy + CONTEXT_MENU_ITEM_HEIGHT / 2, 3)

        -- Label text
        if hoverIdx == i then
            love.graphics.setColor(1, 1, 1, 1)
        else
            love.graphics.setColor(0.78, 0.78, 0.85, 0.95)
        end
        love.graphics.print(item.label, menuX + 24, iy + (CONTEXT_MENU_ITEM_HEIGHT - fonts.chat:getHeight()) / 2)
    end
end

-- ---------------------------------------------------------------------------
-- Portal Travel Panel
-- ---------------------------------------------------------------------------
local PORTAL_W = 420
local PORTAL_H = 420
local PORTAL_ROW_H = 38
local PORTAL_LIST_TOP = 80     -- y offset from panel top where list starts
local PORTAL_LIST_BOT = 50     -- reserved space at bottom for message/close

function game.drawPortalPanel(W, H)
    local pw = math.min(PORTAL_W, W - 40)
    local ph = math.min(PORTAL_H, H - 60)
    local px = math.floor((W - pw) / 2)
    local py = math.floor((H - ph) / 2)

    -- Store panel rect for click handling
    game._portal._panelX = px
    game._portal._panelY = py
    game._portal._panelW = pw
    game._portal._panelH = ph

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background (dark with blue/purple tint)
    love.graphics.setColor(0.05, 0.05, 0.14, 0.96)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    -- Border (blue/purple)
    love.graphics.setColor(0.35, 0.3, 0.7, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)
    love.graphics.setLineWidth(1)

    -- Title bar
    love.graphics.setColor(0.08, 0.06, 0.18, 0.9)
    love.graphics.rectangle("fill", px, py, pw, 30, 8, 8)
    love.graphics.rectangle("fill", px, py + 20, pw, 10)
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.6, 0.55, 1, 1)
    love.graphics.printf("Portal Nexus", px + 10, py + 4, pw - 50, "left")

    -- Close button (X)
    local closeX = px + pw - 30
    local closeY = py + 4
    local closeW = 24
    local closeH = 22
    love.graphics.setColor(0.5, 0.15, 0.15, 0.8)
    love.graphics.rectangle("fill", closeX, closeY, closeW, closeH, 4, 4)
    love.graphics.setColor(1, 0.5, 0.5, 1)
    love.graphics.rectangle("line", closeX, closeY, closeW, closeH, 4, 4)
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf("X", closeX, closeY + 2, closeW, "center")
    game._portal._closeBtn = { x = closeX, y = closeY, w = closeW, h = closeH }

    -- Current zone indicator
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.55, 0.55, 0.7, 0.8)
    local currentZoneName = (zone and zone.name) or "Unknown"
    love.graphics.printf("Current zone: " .. currentZoneName, px + 10, py + 34, pw - 20, "left")

    -- Cooldown timer display
    local now = love.timer.getTime()
    local cooldownRemaining = game._portal.cooldownEnd - now
    local onCooldown = cooldownRemaining > 0
    if onCooldown then
        love.graphics.setFont(fonts.hud)
        love.graphics.setColor(1, 0.6, 0.2, 0.9)
        love.graphics.printf("Cooldown: " .. math.ceil(cooldownRemaining) .. "s", px + 10, py + 50, pw - 20, "left")
    end

    -- Subtitle / instruction
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.65, 0.7)
    local subtitleY = onCooldown and (py + 66) or (py + 50)
    love.graphics.printf("Select a destination to teleport", px + 10, subtitleY, pw - 20, "left")

    -- Destination list
    local listX = px + 8
    local listY = py + PORTAL_LIST_TOP
    local listW = pw - 16
    local listH = ph - PORTAL_LIST_TOP - PORTAL_LIST_BOT
    local rowH = PORTAL_ROW_H

    -- Scissor clip for scrollable list
    love.graphics.setScissor(listX, listY, listW, listH)

    game._portal._rowBtns = {}
    local destinations = game._portal.destinations or {}
    local currentZoneId = zone and zone.id

    if #destinations == 0 then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
        love.graphics.printf("Loading destinations...", listX, listY + 20, listW, "center")
    else
        local mx, my = love.mouse.getPosition()
        for i, dest in ipairs(destinations) do
            local ry = listY + (i - 1) * rowH - game._portal.scroll
            -- Skip offscreen rows for performance
            if ry + rowH > listY and ry < listY + listH then
                local isCurrent = currentZoneId and (dest.zoneId == currentZoneId)
                local isHovered = mx >= listX and mx <= listX + listW and my >= ry and my < ry + rowH and my >= listY and my < listY + listH
                local isDisabled = isCurrent or onCooldown

                -- Row background
                if isCurrent then
                    love.graphics.setColor(0.12, 0.12, 0.18, 0.5)
                elseif isHovered and not isDisabled then
                    love.graphics.setColor(0.15, 0.12, 0.32, 0.9)
                else
                    love.graphics.setColor(0.07, 0.07, 0.14, 0.6)
                end
                love.graphics.rectangle("fill", listX, ry, listW, rowH - 2, 4, 4)

                -- Row border on hover
                if isHovered and not isDisabled then
                    love.graphics.setColor(0.5, 0.4, 0.9, 0.6)
                    love.graphics.rectangle("line", listX, ry, listW, rowH - 2, 4, 4)
                end

                -- Portal type icon (small colored dot)
                local dotX = listX + 12
                local dotY = ry + math.floor(rowH / 2) - 1
                if dest.type == "personal" then
                    love.graphics.setColor(0.2, 0.9, 0.6, isCurrent and 0.4 or 0.9)
                else
                    love.graphics.setColor(0.5, 0.4, 1, isCurrent and 0.4 or 0.9)
                end
                love.graphics.circle("fill", dotX, dotY, 4)

                -- Destination name
                love.graphics.setFont(fonts.hud)
                if isCurrent then
                    love.graphics.setColor(0.4, 0.4, 0.5, 0.5)
                elseif isDisabled then
                    love.graphics.setColor(0.5, 0.5, 0.55, 0.6)
                else
                    love.graphics.setColor(0.85, 0.82, 1, 1)
                end
                local nameText = dest.name or dest.id or "???"
                love.graphics.print(nameText, listX + 24, ry + 4)

                -- Race / type flavor text
                love.graphics.setFont(fonts.small)
                if isCurrent then
                    love.graphics.setColor(0.35, 0.35, 0.45, 0.4)
                else
                    love.graphics.setColor(0.5, 0.48, 0.65, 0.65)
                end
                local flavor = ""
                if dest.type == "personal" then
                    flavor = "Personal Portal"
                else
                    flavor = PORTAL_TOWN_RACE[dest.zoneId] or "Anchor Town"
                end
                if isCurrent then
                    flavor = flavor .. "  (current)"
                end
                love.graphics.print(flavor, listX + 24, ry + 20)

                -- Store row hit rect for click handling
                game._portal._rowBtns[i] = {
                    x = listX, y = ry, w = listW, h = rowH - 2,
                    destId = dest.id,
                    destName = dest.name,
                    zoneId = dest.zoneId,
                    isCurrent = isCurrent,
                    isDisabled = isDisabled,
                    visible = (ry + rowH > listY and ry < listY + listH),
                }
            end
        end
    end

    love.graphics.setScissor()

    -- Scroll indicator (thin bar on the right if content overflows)
    local totalContentH = #destinations * rowH
    if totalContentH > listH then
        local barH = math.max(20, listH * (listH / totalContentH))
        local barY = listY + (game._portal.scroll / (totalContentH - listH)) * (listH - barH)
        love.graphics.setColor(0.4, 0.35, 0.7, 0.4)
        love.graphics.rectangle("fill", px + pw - 10, barY, 4, barH, 2, 2)
    end

    -- Message / error text area
    if game._portal.message then
        love.graphics.setFont(fonts.npc)
        local mc = game._portal.message.color or {1, 0.7, 0.3}
        love.graphics.setColor(mc[1], mc[2], mc[3], 0.9)
        love.graphics.printf(game._portal.message.text or "", px + 10, py + ph - 42, pw - 20, "center")
    end
end

function game.handlePortalClick(mx, my)
    if not game._portal.show then return false end

    local px = game._portal._panelX or 0
    local py = game._portal._panelY or 0
    local pw = game._portal._panelW or PORTAL_W
    local ph = game._portal._panelH or PORTAL_H

    -- Click outside panel: close
    if mx < px or mx > px + pw or my < py or my > py + ph then
        game._portal.show = false
        return true
    end

    -- Close button
    if game._portal._closeBtn then
        local btn = game._portal._closeBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            game._portal.show = false
            return true
        end
    end

    -- Destination row clicks
    if game._portal._rowBtns then
        local listY = py + PORTAL_LIST_TOP
        local listH = ph - PORTAL_LIST_TOP - PORTAL_LIST_BOT
        for _, btn in pairs(game._portal._rowBtns) do
            if btn.visible and not btn.isDisabled
                and mx >= btn.x and mx <= btn.x + btn.w
                and my >= btn.y and my <= btn.y + btn.h
                and my >= listY and my < listY + listH then
                -- Send game._portal travel request
                if client then
                    client:emit("portal_travel", { destinationId = btn.destId })
                end
                -- Show "Teleporting..." message while we wait for server response
                game._portal.message = {
                    text = "Teleporting to " .. (btn.destName or "destination") .. "...",
                    color = {0.6, 0.6, 1},
                    timer = 10,
                }
                return true
            end
        end
    end

    -- Clicked inside panel but not on any interactive element: consume click
    return true
end


-- NPC Shop panel constants
local NPC_SHOP_W = 520
local NPC_SHOP_H = 440
local NPC_SHOP_ITEM_H = 32
local NPC_SHOP_LIST_TOP = 90    -- offset from panel top to first item
local NPC_SHOP_LIST_BOT = 110   -- space reserved at bottom for controls

-- Helper: format resource name (iron_ore -> Iron Ore)
local function formatResourceName(name)
    if not name or name == "" then return "Unknown" end
    return name:gsub("_", " "):gsub("(%a)([%w]*)", function(a, b) return a:upper() .. b end)
end

-- Helper: get items to display in sell tab (player inventory resources with sell prices)
local function getNpcShopSellItems()
    local items = {}
    if not mmoInventory then return items end
    -- Iterate all resources in inventory that have a quantity > 0
    -- We need to match against the current shop's price data if available
    for key, qty in pairs(mmoInventory) do
        if type(qty) == "number" and qty > 0 and key ~= "items" then
            local sellPrice = nil
            local trend = "stable"
            -- Look up sell price from loaded prices
            if game._npcShop.prices then
                for _, p in ipairs(game._npcShop.prices) do
                    if p.resource == key then
                        sellPrice = p.sellPrice
                        trend = p.trend or "stable"
                        break
                    end
                end
            end
            -- If no price found in current shop, item may still be sellable
            -- (server allows selling anything with a base price)
            -- We show it with a "?" price; the server will calculate the actual price
            table.insert(items, {
                resource = key,
                name = formatResourceName(key),
                sellPrice = sellPrice,
                quantity = qty,
                trend = trend,
            })
        end
    end
    -- Sort alphabetically by name
    table.sort(items, function(a, b) return a.name < b.name end)
    return items
end

-- NPC Shop: draw panel
function game.drawNpcShop(W, H)
    local pw = math.min(NPC_SHOP_W, W - 40)
    local ph = math.min(NPC_SHOP_H, H - 60)
    local px = math.floor((W - pw) / 2)
    local py = math.floor((H - ph) / 2)

    -- Store panel rect for click handling
    game._npcShop._panelX = px
    game._npcShop._panelY = py
    game._npcShop._panelW = pw
    game._npcShop._panelH = ph

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.06, 0.07, 0.12, 0.96)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    -- Border
    love.graphics.setColor(0.25, 0.55, 0.35, 0.8)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title bar
    love.graphics.setColor(0.1, 0.18, 0.12, 0.9)
    love.graphics.rectangle("fill", px, py, pw, 30, 8, 8)
    love.graphics.rectangle("fill", px, py + 20, pw, 10)
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.3, 0.95, 0.5, 1)
    love.graphics.printf(game._npcShop.shopName or "Shop", px + 10, py + 4, pw - 50, "left")

    -- Close button (X)
    local closeX = px + pw - 30
    local closeY = py + 4
    local closeW = 24
    local closeH = 22
    love.graphics.setColor(0.5, 0.15, 0.15, 0.8)
    love.graphics.rectangle("fill", closeX, closeY, closeW, closeH, 4, 4)
    love.graphics.setColor(1, 0.5, 0.5, 1)
    love.graphics.rectangle("line", closeX, closeY, closeW, closeH, 4, 4)
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf("X", closeX, closeY + 2, closeW, "center")
    game._npcShop._closeBtn = { x = closeX, y = closeY, w = closeW, h = closeH }

    -- Shop description
    if game._npcShop.shopDesc and game._npcShop.shopDesc ~= "" then
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(0.6, 0.7, 0.6, 0.7)
        love.graphics.printf(game._npcShop.shopDesc, px + 10, py + 32, pw - 20, "left")
    end

    -- Shop selector (dropdown-like row of shop names if shopList is available)
    local shopSelectorY = py + 46
    if game._npcShop.shopList and #game._npcShop.shopList > 1 then
        love.graphics.setFont(fonts.small)
        local shopBtnW = math.floor((pw - 20) / math.min(#game._npcShop.shopList, 7))
        game._npcShop._shopBtns = {}
        for i, shop in ipairs(game._npcShop.shopList) do
            if i > 7 then break end  -- max 7 shop buttons
            local sx = px + 10 + (i - 1) * shopBtnW
            local sy = shopSelectorY
            local active = (shop.id == game._npcShop.shopId)
            if active then
                love.graphics.setColor(0.15, 0.35, 0.2, 0.95)
            else
                love.graphics.setColor(0.1, 0.12, 0.16, 0.7)
            end
            love.graphics.rectangle("fill", sx, sy, shopBtnW - 2, 18, 3, 3)
            love.graphics.setColor(active and 0.4 or 0.25, active and 0.8 or 0.4, active and 0.5 or 0.35, active and 1 or 0.6)
            love.graphics.rectangle("line", sx, sy, shopBtnW - 2, 18, 3, 3)
            -- Truncate name to fit
            local label = shop.name or shop.id
            if fonts.small:getWidth(label) > shopBtnW - 8 then
                while #label > 3 and fonts.small:getWidth(label .. "..") > shopBtnW - 8 do
                    label = label:sub(1, -2)
                end
                label = label .. ".."
            end
            love.graphics.setColor(active and 0.9 or 0.6, active and 1 or 0.7, active and 0.9 or 0.6, active and 1 or 0.7)
            love.graphics.printf(label, sx, sy + 2, shopBtnW - 2, "center")
            game._npcShop._shopBtns[i] = { x = sx, y = sy, w = shopBtnW - 2, h = 18, shopId = shop.id, shopName = shop.name, shopDesc = shop.description or "" }
        end
    else
        game._npcShop._shopBtns = nil
    end

    -- Buy/Sell tabs
    local tabY = py + 68
    local tabW = math.floor((pw - 20) / 2)
    game._npcShop._buyTabBtn = { x = px + 10, y = tabY, w = tabW - 2, h = 22 }
    game._npcShop._sellTabBtn = { x = px + 10 + tabW, y = tabY, w = tabW - 2, h = 22 }

    love.graphics.setFont(fonts.hud)
    -- Buy tab
    if game._npcShop.tab == "buy" then
        love.graphics.setColor(0.15, 0.3, 0.2, 0.95)
    else
        love.graphics.setColor(0.08, 0.1, 0.14, 0.7)
    end
    love.graphics.rectangle("fill", game._npcShop._buyTabBtn.x, tabY, game._npcShop._buyTabBtn.w, 22, 4, 4)
    love.graphics.setColor(game._npcShop.tab == "buy" and 0.4 or 0.25, game._npcShop.tab == "buy" and 0.9 or 0.5, game._npcShop.tab == "buy" and 0.5 or 0.35, 1)
    love.graphics.printf("Buy", game._npcShop._buyTabBtn.x, tabY + 2, game._npcShop._buyTabBtn.w, "center")

    -- Sell tab
    if game._npcShop.tab == "sell" then
        love.graphics.setColor(0.3, 0.2, 0.1, 0.95)
    else
        love.graphics.setColor(0.08, 0.1, 0.14, 0.7)
    end
    love.graphics.rectangle("fill", game._npcShop._sellTabBtn.x, tabY, game._npcShop._sellTabBtn.w, 22, 4, 4)
    love.graphics.setColor(game._npcShop.tab == "sell" and 0.95 or 0.5, game._npcShop.tab == "sell" and 0.75 or 0.45, game._npcShop.tab == "sell" and 0.3 or 0.25, 1)
    love.graphics.printf("Sell", game._npcShop._sellTabBtn.x, tabY + 2, game._npcShop._sellTabBtn.w, "center")

    -- Item list area
    local listX = px + 8
    local listY = py + NPC_SHOP_LIST_TOP + 4
    local listW = pw - 16
    local listH = ph - NPC_SHOP_LIST_TOP - NPC_SHOP_LIST_BOT
    local itemH = NPC_SHOP_ITEM_H

    -- Clip region for scrollable list
    love.graphics.setScissor(listX, listY, listW, listH)

    local items = {}
    local sellItems = nil
    if game._npcShop.tab == "buy" then
        items = game._npcShop.prices or {}
    else
        sellItems = getNpcShopSellItems()
        items = sellItems
    end

    -- Column headers
    local headerY = listY - game._npcShop.scroll
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.5, 0.6, 0.55, 0.8)
    love.graphics.print("Item", listX + 6, headerY)
    if game._npcShop.tab == "buy" then
        love.graphics.printf("Price", listX, headerY, listW - 60, "right")
        love.graphics.printf("Trend", listX, headerY, listW - 6, "right")
    else
        love.graphics.printf("Qty", listX + listW * 0.45, headerY, 40, "center")
        love.graphics.printf("Price", listX, headerY, listW - 60, "right")
        love.graphics.printf("Trend", listX, headerY, listW - 6, "right")
    end

    -- Separator under header
    love.graphics.setColor(0.3, 0.4, 0.35, 0.4)
    love.graphics.line(listX, headerY + 14, listX + listW, headerY + 14)

    -- Item rows
    game._npcShop._itemRects = {}
    local startRow = headerY + 16
    for i, item in ipairs(items) do
        local iy = startRow + (i - 1) * itemH
        -- Skip if fully above or below visible area
        if iy + itemH >= listY and iy < listY + listH then
            local isSelected = (game._npcShop.selected == i)

            -- Row background
            if isSelected then
                love.graphics.setColor(0.15, 0.35, 0.25, 0.7)
            elseif i % 2 == 0 then
                love.graphics.setColor(0.08, 0.1, 0.12, 0.3)
            else
                love.graphics.setColor(0, 0, 0, 0)
            end
            love.graphics.rectangle("fill", listX, iy, listW, itemH - 2, 3, 3)

            if isSelected then
                love.graphics.setColor(0.3, 0.7, 0.45, 0.6)
                love.graphics.rectangle("line", listX, iy, listW, itemH - 2, 3, 3)
            end

            -- Item name
            love.graphics.setFont(fonts.chat)
            love.graphics.setColor(0.9, 0.9, 0.85, 0.95)
            local displayName = item.name or formatResourceName(item.resource)
            love.graphics.print(displayName, listX + 8, iy + (itemH - fonts.chat:getHeight()) / 2 - 1)

            -- Price
            love.graphics.setFont(fonts.hud)
            local price
            if game._npcShop.tab == "buy" then
                price = item.buyPrice
            else
                price = item.sellPrice
            end
            if price then
                love.graphics.setColor(1, 0.85, 0.2, 1)
                love.graphics.printf(tostring(price) .. "c", listX, iy + (itemH - fonts.hud:getHeight()) / 2 - 1, listW - 60, "right")
            else
                love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
                love.graphics.printf("--", listX, iy + (itemH - fonts.hud:getHeight()) / 2 - 1, listW - 60, "right")
            end

            -- Quantity (sell tab)
            if game._npcShop.tab == "sell" and item.quantity then
                love.graphics.setFont(fonts.npc)
                love.graphics.setColor(0.7, 0.8, 0.7, 0.9)
                love.graphics.printf(tostring(item.quantity), listX + listW * 0.45, iy + (itemH - fonts.npc:getHeight()) / 2, 40, "center")
            end

            -- Trend indicator
            love.graphics.setFont(fonts.npc)
            local trend = item.trend or "stable"
            if trend == "up" then
                love.graphics.setColor(0.3, 1, 0.3, 0.9)
                love.graphics.printf("^", listX, iy + (itemH - fonts.npc:getHeight()) / 2, listW - 8, "right")
            elseif trend == "down" then
                love.graphics.setColor(1, 0.3, 0.3, 0.9)
                love.graphics.printf("v", listX, iy + (itemH - fonts.npc:getHeight()) / 2, listW - 8, "right")
            else
                love.graphics.setColor(0.5, 0.5, 0.5, 0.6)
                love.graphics.printf("-", listX, iy + (itemH - fonts.npc:getHeight()) / 2, listW - 8, "right")
            end
        end
        -- Store rect for click detection (absolute screen coords)
        game._npcShop._itemRects[i] = { x = listX, y = iy, w = listW, h = itemH - 2 }
    end

    love.graphics.setScissor()

    -- Bottom controls area
    local ctrlY = py + ph - NPC_SHOP_LIST_BOT + 4
    love.graphics.setColor(0.08, 0.1, 0.14, 0.6)
    love.graphics.rectangle("fill", px + 4, ctrlY - 4, pw - 8, NPC_SHOP_LIST_BOT - 8, 4, 4)

    -- Coins display
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(1, 0.85, 0.2, 1)
    local coinText = "Coins: " .. (account and account.coins or 0)
    love.graphics.print(coinText, px + 14, ctrlY)

    -- Selected item info + amount controls
    if game._npcShop.selected and game._npcShop.selected >= 1 and game._npcShop.selected <= #items then
        local sel = items[game._npcShop.selected]
        local selName = sel.name or formatResourceName(sel.resource)

        -- Selected item name
        love.graphics.setFont(fonts.chat)
        love.graphics.setColor(0.85, 0.9, 0.85, 0.9)
        love.graphics.print(selName, px + 14, ctrlY + 20)

        -- Amount controls: [-] [amount] [+]
        local amtY = ctrlY + 40
        local minusBtnX = px + 14
        local minusBtnW = 30
        local amtLabelX = minusBtnX + minusBtnW + 4
        local amtLabelW = 50
        local plusBtnX = amtLabelX + amtLabelW + 4
        local plusBtnW = 30
        local btnH = 24

        -- Minus button
        love.graphics.setColor(0.2, 0.15, 0.15, 0.9)
        love.graphics.rectangle("fill", minusBtnX, amtY, minusBtnW, btnH, 4, 4)
        love.graphics.setColor(0.6, 0.4, 0.4, 1)
        love.graphics.rectangle("line", minusBtnX, amtY, minusBtnW, btnH, 4, 4)
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.setFont(fonts.ui)
        love.graphics.printf("-", minusBtnX, amtY + 1, minusBtnW, "center")
        game._npcShop._minusBtn = { x = minusBtnX, y = amtY, w = minusBtnW, h = btnH }

        -- Amount label
        love.graphics.setColor(0.1, 0.12, 0.16, 0.9)
        love.graphics.rectangle("fill", amtLabelX, amtY, amtLabelW, btnH, 4, 4)
        love.graphics.setColor(0.3, 0.4, 0.35, 0.8)
        love.graphics.rectangle("line", amtLabelX, amtY, amtLabelW, btnH, 4, 4)
        love.graphics.setFont(fonts.hud)
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.printf(tostring(game._npcShop.amount), amtLabelX, amtY + 3, amtLabelW, "center")

        -- Plus button
        love.graphics.setColor(0.15, 0.2, 0.15, 0.9)
        love.graphics.rectangle("fill", plusBtnX, amtY, plusBtnW, btnH, 4, 4)
        love.graphics.setColor(0.4, 0.6, 0.4, 1)
        love.graphics.rectangle("line", plusBtnX, amtY, plusBtnW, btnH, 4, 4)
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.setFont(fonts.ui)
        love.graphics.printf("+", plusBtnX, amtY + 1, plusBtnW, "center")
        game._npcShop._plusBtn = { x = plusBtnX, y = amtY, w = plusBtnW, h = btnH }

        -- Max button (quick set to max affordable or max owned)
        local maxBtnX = plusBtnX + plusBtnW + 8
        local maxBtnW = 40
        love.graphics.setColor(0.15, 0.18, 0.25, 0.9)
        love.graphics.rectangle("fill", maxBtnX, amtY, maxBtnW, btnH, 4, 4)
        love.graphics.setColor(0.35, 0.45, 0.6, 1)
        love.graphics.rectangle("line", maxBtnX, amtY, maxBtnW, btnH, 4, 4)
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(0.8, 0.85, 1, 1)
        love.graphics.printf("Max", maxBtnX, amtY + 5, maxBtnW, "center")
        game._npcShop._maxBtn = { x = maxBtnX, y = amtY, w = maxBtnW, h = btnH }

        -- Total cost / earnings
        local price = game._npcShop.tab == "buy" and sel.buyPrice or sel.sellPrice
        if price then
            local total = price * game._npcShop.amount
            love.graphics.setFont(fonts.hud)
            love.graphics.setColor(0.6, 0.7, 0.65, 0.8)
            local totalLabel = game._npcShop.tab == "buy" and "Total: " or "Earn: "
            love.graphics.printf(totalLabel, px + pw * 0.5, amtY + 3, pw * 0.2, "right")
            love.graphics.setColor(1, 0.85, 0.2, 1)
            love.graphics.printf(tostring(total) .. "c", px + pw * 0.7, amtY + 3, pw * 0.25, "left")
        end

        -- Confirm button
        local confirmBtnW = 120
        local confirmBtnH = 28
        local confirmBtnX = px + pw - confirmBtnW - 14
        local confirmBtnY = ctrlY + 65
        local canTransact = not game._npcShop.transactionLock
        if game._npcShop.tab == "buy" then
            local bgR, bgG, bgB = 0.12, 0.3, 0.18
            local brR, brG, brB = 0.3, 0.7, 0.4
            if not canTransact then bgR, bgG, bgB = 0.15, 0.15, 0.15; brR, brG, brB = 0.3, 0.3, 0.3 end
            love.graphics.setColor(bgR, bgG, bgB, 0.95)
            love.graphics.rectangle("fill", confirmBtnX, confirmBtnY, confirmBtnW, confirmBtnH, 5, 5)
            love.graphics.setColor(brR, brG, brB, 1)
            love.graphics.rectangle("line", confirmBtnX, confirmBtnY, confirmBtnW, confirmBtnH, 5, 5)
            love.graphics.setFont(fonts.hud)
            love.graphics.setColor(1, 1, 1, canTransact and 1 or 0.4)
            love.graphics.printf("Buy", confirmBtnX, confirmBtnY + 5, confirmBtnW, "center")
        else
            local bgR, bgG, bgB = 0.3, 0.2, 0.08
            local brR, brG, brB = 0.7, 0.5, 0.2
            if not canTransact then bgR, bgG, bgB = 0.15, 0.15, 0.15; brR, brG, brB = 0.3, 0.3, 0.3 end
            love.graphics.setColor(bgR, bgG, bgB, 0.95)
            love.graphics.rectangle("fill", confirmBtnX, confirmBtnY, confirmBtnW, confirmBtnH, 5, 5)
            love.graphics.setColor(brR, brG, brB, 1)
            love.graphics.rectangle("line", confirmBtnX, confirmBtnY, confirmBtnW, confirmBtnH, 5, 5)
            love.graphics.setFont(fonts.hud)
            love.graphics.setColor(1, 1, 1, canTransact and 1 or 0.4)
            love.graphics.printf("Sell", confirmBtnX, confirmBtnY + 5, confirmBtnW, "center")
        end
        game._npcShop._confirmBtn = { x = confirmBtnX, y = confirmBtnY, w = confirmBtnW, h = confirmBtnH }
    else
        game._npcShop._minusBtn = nil
        game._npcShop._plusBtn = nil
        game._npcShop._maxBtn = nil
        game._npcShop._confirmBtn = nil
    end

    -- Feedback message
    if game._npcShop.message and game._npcShop.message.timer and game._npcShop.message.timer > 0 then
        love.graphics.setFont(fonts.chat)
        local alpha = math.min(1, game._npcShop.message.timer)
        love.graphics.setColor(game._npcShop.message.color[1], game._npcShop.message.color[2], game._npcShop.message.color[3], alpha)
        love.graphics.printf(game._npcShop.message.text, px + 14, ctrlY + 68, pw - 28, "left")
    end

    -- Loading state
    if not game._npcShop.prices and game._npcShop.tab == "buy" then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.6, 0.6, 0.7, 0.7 + 0.3 * math.sin(love.timer.getTime() * 3))
        love.graphics.printf("Loading prices...", px, py + ph / 2 - 20, pw, "center")
    end

    -- Escape hint
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.4, 0.45, 0.4, 0.5)
    love.graphics.printf("Esc to close", px, py + ph - 16, pw - 10, "right")
end

-- NPC Shop: handle click, returns true if click was consumed
function game.handleNpcShopClick(mx, my)
    if not game._npcShop.show then return false end

    local px = game._npcShop._panelX or 0
    local py = game._npcShop._panelY or 0
    local pw = game._npcShop._panelW or NPC_SHOP_W
    local ph = game._npcShop._panelH or NPC_SHOP_H

    -- Click outside panel: close shop
    if mx < px or mx > px + pw or my < py or my > py + ph then
        game._npcShop.show = false
        return true
    end

    -- Close button
    if game._npcShop._closeBtn then
        local btn = game._npcShop._closeBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            game._npcShop.show = false
            return true
        end
    end

    -- Shop selector buttons
    if game._npcShop._shopBtns then
        for _, btn in ipairs(game._npcShop._shopBtns) do
            if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
                if btn.shopId ~= game._npcShop.shopId then
                    game._npcShop.shopId = btn.shopId
                    game._npcShop.shopName = btn.shopName or btn.shopId
                    game._npcShop.shopDesc = btn.shopDesc or ""
                    game._npcShop.prices = nil
                    game._npcShop.selected = nil
                    game._npcShop.amount = 1
                    game._npcShop.scroll = 0
                    if client then
                        client:emit("npc_shop_prices", { shopId = btn.shopId })
                    end
                end
                return true
            end
        end
    end

    -- Buy/Sell tab buttons
    if game._npcShop._buyTabBtn then
        local btn = game._npcShop._buyTabBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            game._npcShop.tab = "buy"
            game._npcShop.selected = nil
            game._npcShop.amount = 1
            game._npcShop.scroll = 0
            return true
        end
    end
    if game._npcShop._sellTabBtn then
        local btn = game._npcShop._sellTabBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            game._npcShop.tab = "sell"
            game._npcShop.selected = nil
            game._npcShop.amount = 1
            game._npcShop.scroll = 0
            return true
        end
    end

    -- Item list clicks
    if game._npcShop._itemRects then
        local listY = py + NPC_SHOP_LIST_TOP + 4
        local listH = ph - NPC_SHOP_LIST_TOP - NPC_SHOP_LIST_BOT
        for i, rect in ipairs(game._npcShop._itemRects) do
            if mx >= rect.x and mx <= rect.x + rect.w and my >= rect.y and my <= rect.y + rect.h then
                -- Make sure click is within visible list area
                if my >= listY and my < listY + listH then
                    game._npcShop.selected = i
                    game._npcShop.amount = 1
                    return true
                end
            end
        end
    end

    -- Amount minus button
    if game._npcShop._minusBtn then
        local btn = game._npcShop._minusBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            game._npcShop.amount = math.max(1, game._npcShop.amount - 1)
            return true
        end
    end

    -- Amount plus button
    if game._npcShop._plusBtn then
        local btn = game._npcShop._plusBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            game._npcShop.amount = math.min(100, game._npcShop.amount + 1)
            return true
        end
    end

    -- Max button
    if game._npcShop._maxBtn then
        local btn = game._npcShop._maxBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            local items = {}
            if game._npcShop.tab == "buy" then
                items = game._npcShop.prices or {}
            else
                items = getNpcShopSellItems()
            end
            if game._npcShop.selected and game._npcShop.selected >= 1 and game._npcShop.selected <= #items then
                local sel = items[game._npcShop.selected]
                if game._npcShop.tab == "buy" then
                    -- Max affordable
                    local coins = (account and account.coins) or 0
                    local price = sel.buyPrice or 0
                    if price > 0 then
                        game._npcShop.amount = math.min(100, math.max(1, math.floor(coins / price)))
                    end
                else
                    -- Max owned
                    local qty = sel.quantity or 0
                    game._npcShop.amount = math.min(100, math.max(1, qty))
                end
            end
            return true
        end
    end

    -- Confirm button (Buy / Sell)
    if game._npcShop._confirmBtn then
        local btn = game._npcShop._confirmBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            if not game._npcShop.transactionLock and client then
                local items = {}
                if game._npcShop.tab == "buy" then
                    items = game._npcShop.prices or {}
                else
                    items = getNpcShopSellItems()
                end
                if game._npcShop.selected and game._npcShop.selected >= 1 and game._npcShop.selected <= #items then
                    local sel = items[game._npcShop.selected]
                    game._npcShop.transactionLock = true
                    if game._npcShop.tab == "buy" then
                        client:emit("npc_shop_buy", {
                            shopId = game._npcShop.shopId,
                            resource = sel.resource,
                            amount = game._npcShop.amount,
                        })
                    else
                        client:emit("npc_shop_sell", {
                            resource = sel.resource,
                            amount = game._npcShop.amount,
                        })
                    end
                end
            end
            return true
        end
    end

    -- Consume click inside panel (prevent world interaction)
    return true
end

-- ========================================================================
-- P2P Trade Panel
-- ========================================================================

local TRADE_W = 620
local TRADE_H = 470
local TRADE_ITEM_H = 26
local TRADE_INV_TOP = 70       -- offset from panel top to inventory list start
local TRADE_INV_BOT = 80       -- space reserved at bottom for controls
local TRADE_COL_GAP = 10       -- gap between left/right columns

-- Helper: build a flat list of tradeable inventory items (resources + cards)
local function getTradableInventory()
    local items = {}
    -- Resources
    if mmoInventory then
        for key, qty in pairs(mmoInventory) do
            if type(qty) == "number" and qty > 0 and key ~= "items" then
                -- Subtract any already-offered amount of this resource
                local offeredAmt = 0
                for _, oi in ipairs(game._trade.myOffer.items) do
                    if oi.type == "resource" and oi.resource == key then
                        offeredAmt = offeredAmt + (oi.amount or 0)
                    end
                end
                local available = qty - offeredAmt
                if available > 0 then
                    table.insert(items, {
                        type = "resource",
                        resource = key,
                        name = formatResourceName(key),
                        amount = available,
                    })
                end
            end
        end
    end
    -- Sort resources alphabetically
    table.sort(items, function(a, b) return a.name < b.name end)
    -- Cards
    if rpg.cards then
        for _, card in ipairs(rpg.cards) do
            -- Check card is not already in our offer
            local alreadyOffered = false
            for _, oi in ipairs(game._trade.myOffer.items) do
                if oi.type == "card" and oi.cardInstanceId == card.instanceId then
                    alreadyOffered = true
                    break
                end
            end
            if not alreadyOffered then
                table.insert(items, {
                    type = "card",
                    cardInstanceId = card.instanceId,
                    name = (card.name or "Card") .. " [" .. (card.rarity or "?") .. "]",
                    rarity = card.rarity,
                })
            end
        end
    end
    return items
end

-- Helper: send current offer to server
local function emitTradeOffer()
    if not client or not game._trade.tradeId then return end
    client:emit("trade_offer", {
        tradeId = game._trade.tradeId,
        items = game._trade.myOffer.items,
        chips = game._trade.myOffer.chips,
    })
    -- Reset confirmations locally (server resets them too)
    game._trade.myConfirmed = false
    game._trade.theirConfirmed = false
end

-- Helper: check if our offer has at least one item or coins
local function hasOfferContent()
    return #game._trade.myOffer.items > 0 or game._trade.myOffer.chips > 0
end

-- Rarity color lookup for card items
local RARITY_COLORS = {
    common =      {0.7, 0.7, 0.7},
    uncommon =    {0.3, 0.9, 0.3},
    rare =        {0.3, 0.5, 1.0},
    ultra_rare =  {0.7, 0.3, 1.0},
    mythic_rare = {1.0, 0.4, 0.7},
    legendary =   {1.0, 0.75, 0.2},
    godly =       {1.0, 0.9, 0.4},
    relic =       {1.0, 0.3, 0.3},
}

-- ---------------------------------------------------------------------------
-- Bank Vault UI
-- ---------------------------------------------------------------------------
local BANK_W = 540
local BANK_H = 480
local BANK_ITEM_H = 30

function game.drawBank(W, H)
    if not game._bank.data then
        -- Still loading
        love.graphics.setColor(0, 0, 0, 0.6)
        love.graphics.rectangle("fill", 0, 0, W, H)
        love.graphics.setFont(fonts.title)
        love.graphics.setColor(1, 0.85, 0.3, 1)
        love.graphics.printf("Loading vault...", 0, H / 2 - 20, W, "center")
        return
    end

    local pw = math.min(BANK_W, W - 40)
    local ph = math.min(BANK_H, H - 60)
    local px = math.floor((W - pw) / 2)
    local py = math.floor((H - ph) / 2)

    game._bank._panelX = px
    game._bank._panelY = py
    game._bank._panelW = pw
    game._bank._panelH = ph

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.06, 0.06, 0.1, 0.96)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    love.graphics.setColor(0.7, 0.6, 0.2, 0.8)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title bar
    love.graphics.setColor(0.15, 0.12, 0.05, 0.9)
    love.graphics.rectangle("fill", px, py, pw, 30, 8, 8)
    love.graphics.rectangle("fill", px, py + 20, pw, 10)
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(1, 0.85, 0.3, 1)
    love.graphics.printf("Bank Vault", px + 10, py + 4, pw - 50, "left")

    -- Close button
    local closeX = px + pw - 30
    local closeY = py + 4
    love.graphics.setColor(0.5, 0.15, 0.15, 0.8)
    love.graphics.rectangle("fill", closeX, closeY, 24, 22, 4, 4)
    love.graphics.setColor(1, 0.5, 0.5, 1)
    love.graphics.rectangle("line", closeX, closeY, 24, 22, 4, 4)
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf("X", closeX, closeY + 2, 24, "center")
    game._bank._closeBtn = { x = closeX, y = closeY, w = 24, h = 22 }

    -- Tab row
    local tabs = { "gold", "resources", "items" }
    local tabLabels = { gold = "Gold", resources = "Resources", items = "Items" }
    local tabW = math.floor((pw - 20) / #tabs)
    local tabY = py + 34
    game._bank._tabBtns = {}
    love.graphics.setFont(fonts.hud)
    for i, tabId in ipairs(tabs) do
        local tx = px + 10 + (i - 1) * tabW
        local active = (game._bank.tab == tabId)
        if active then
            love.graphics.setColor(0.2, 0.18, 0.08, 0.95)
        else
            love.graphics.setColor(0.1, 0.1, 0.14, 0.7)
        end
        love.graphics.rectangle("fill", tx, tabY, tabW - 2, 22, 4, 4)
        if active then
            love.graphics.setColor(1, 0.85, 0.3, 1)
        else
            love.graphics.setColor(0.6, 0.55, 0.4, 0.8)
        end
        love.graphics.printf(tabLabels[tabId], tx, tabY + 3, tabW - 2, "center")
        game._bank._tabBtns[i] = { x = tx, y = tabY, w = tabW - 2, h = 22, tab = tabId }
    end

    -- Slot info
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.6, 0.55, 0.4, 0.7)
    local slotText = "Vault: " .. #game._bank.data.items .. "/" .. game._bank.data.maxSlots .. " items"
    love.graphics.printf(slotText, px + 10, tabY + 26, pw - 20, "right")

    -- Wallet display
    local walletGold = 0
    if identity and identity.account then walletGold = identity.account.chips or 0 end
    love.graphics.setColor(1, 0.85, 0.3, 0.8)
    love.graphics.printf("Wallet: " .. walletGold .. "g", px + 10, tabY + 26, pw - 20, "left")

    -- Content area
    local contentY = tabY + 44
    local contentH = ph - (contentY - py) - 40

    -- Feedback message
    if game._bank.message and game._bank.message.timer and game._bank.message.timer > 0 then
        love.graphics.setFont(fonts.chat)
        love.graphics.setColor(game._bank.message.color[1], game._bank.message.color[2], game._bank.message.color[3], math.min(1, game._bank.message.timer))
        love.graphics.printf(game._bank.message.text, px + 10, py + ph - 36, pw - 20, "center")
    end

    if game._bank.tab == "gold" then
        game.drawBankGoldTab(px, py, pw, ph, contentY, contentH)
    elseif game._bank.tab == "resources" then
        game.drawBankResourcesTab(px, py, pw, ph, contentY, contentH)
    elseif game._bank.tab == "items" then
        game.drawBankItemsTab(px, py, pw, ph, contentY, contentH)
    end
end

function game.drawBankGoldTab(px, py, pw, ph, contentY, contentH)
    local midX = px + pw / 2
    local bankGold = game._bank.data.gold or 0
    local walletGold = 0
    if identity and identity.account then walletGold = identity.account.chips or 0 end

    love.graphics.setFont(fonts.title)
    love.graphics.setColor(1, 0.85, 0.3, 1)
    love.graphics.printf("Bank: " .. bankGold .. " gold", px + 10, contentY + 10, pw - 20, "center")

    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(0.8, 0.75, 0.5, 0.8)
    love.graphics.printf("Wallet: " .. walletGold .. " gold", px + 10, contentY + 40, pw - 20, "center")

    -- Amount selector
    local amountY = contentY + 75
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(0.7, 0.65, 0.4, 0.9)
    love.graphics.printf("Amount:", px + 30, amountY + 3, 70, "left")

    -- Minus button
    local minBtnX = px + 110
    love.graphics.setColor(0.2, 0.15, 0.08, 0.9)
    love.graphics.rectangle("fill", minBtnX, amountY, 30, 24, 4, 4)
    love.graphics.setColor(0.8, 0.7, 0.3, 1)
    love.graphics.rectangle("line", minBtnX, amountY, 30, 24, 4, 4)
    love.graphics.printf("-", minBtnX, amountY + 3, 30, "center")
    game._bank._goldMinusBtn = { x = minBtnX, y = amountY, w = 30, h = 24 }

    -- Amount display
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf(tostring(game._bank.amount), minBtnX + 34, amountY + 3, 80, "center")

    -- Plus button
    local plusBtnX = minBtnX + 118
    love.graphics.setColor(0.2, 0.15, 0.08, 0.9)
    love.graphics.rectangle("fill", plusBtnX, amountY, 30, 24, 4, 4)
    love.graphics.setColor(0.8, 0.7, 0.3, 1)
    love.graphics.rectangle("line", plusBtnX, amountY, 30, 24, 4, 4)
    love.graphics.printf("+", plusBtnX, amountY + 3, 30, "center")
    game._bank._goldPlusBtn = { x = plusBtnX, y = amountY, w = 30, h = 24 }

    -- Max button
    local maxBtnX = plusBtnX + 36
    love.graphics.setColor(0.2, 0.15, 0.08, 0.9)
    love.graphics.rectangle("fill", maxBtnX, amountY, 40, 24, 4, 4)
    love.graphics.setColor(0.8, 0.7, 0.3, 1)
    love.graphics.rectangle("line", maxBtnX, amountY, 40, 24, 4, 4)
    love.graphics.printf("Max", maxBtnX, amountY + 3, 40, "center")
    game._bank._goldMaxBtn = { x = maxBtnX, y = amountY, w = 40, h = 24 }

    -- Deposit / Withdraw buttons
    local btnY = amountY + 40
    local btnW = math.floor((pw - 60) / 2)
    local canAct = not game._bank.transactionLock

    -- Deposit
    local depX = px + 20
    if canAct then
        love.graphics.setColor(0.12, 0.25, 0.12, 0.9)
    else
        love.graphics.setColor(0.15, 0.15, 0.15, 0.7)
    end
    love.graphics.rectangle("fill", depX, btnY, btnW, 30, 4, 4)
    love.graphics.setColor(0.3, 0.8, 0.4, canAct and 1 or 0.4)
    love.graphics.rectangle("line", depX, btnY, btnW, 30, 4, 4)
    love.graphics.printf("Deposit", depX, btnY + 6, btnW, "center")
    game._bank._depositGoldBtn = { x = depX, y = btnY, w = btnW, h = 30 }

    -- Withdraw
    local witX = px + 40 + btnW
    if canAct then
        love.graphics.setColor(0.25, 0.12, 0.08, 0.9)
    else
        love.graphics.setColor(0.15, 0.15, 0.15, 0.7)
    end
    love.graphics.rectangle("fill", witX, btnY, btnW, 30, 4, 4)
    love.graphics.setColor(0.8, 0.5, 0.3, canAct and 1 or 0.4)
    love.graphics.rectangle("line", witX, btnY, btnW, 30, 4, 4)
    love.graphics.printf("Withdraw", witX, btnY + 6, btnW, "center")
    game._bank._withdrawGoldBtn = { x = witX, y = btnY, w = btnW, h = 30 }

    -- Expand vault button
    if game._bank.data.nextExpansionCost then
        local expY = btnY + 50
        local expW = pw - 40
        love.graphics.setColor(0.08, 0.08, 0.18, 0.9)
        love.graphics.rectangle("fill", px + 20, expY, expW, 30, 4, 4)
        love.graphics.setColor(0.4, 0.35, 0.7, 0.8)
        love.graphics.rectangle("line", px + 20, expY, expW, 30, 4, 4)
        love.graphics.setFont(fonts.hud)
        love.graphics.setColor(0.7, 0.65, 1, canAct and 1 or 0.4)
        love.graphics.printf("Expand Vault (+10 slots) — " .. game._bank.data.nextExpansionCost .. "g", px + 20, expY + 6, expW, "center")
        game._bank._expandBtn = { x = px + 20, y = expY, w = expW, h = 30 }
    else
        game._bank._expandBtn = nil
    end
end

function game.drawBankResourcesTab(px, py, pw, ph, contentY, contentH)
    -- Build combined resource list: game._bank resources + inventory resources
    local allResources = {}
    local seen = {}

    -- Bank resources
    if game._bank.data.resources then
        for res, qty in pairs(game._bank.data.resources) do
            if qty > 0 then
                allResources[#allResources + 1] = { resource = res, bankQty = qty, invQty = 0 }
                seen[res] = #allResources
            end
        end
    end

    -- Inventory resources
    if mmoInventory then
        for key, qty in pairs(mmoInventory) do
            if type(qty) == "number" and qty > 0 and key ~= "items" then
                if seen[key] then
                    allResources[seen[key]].invQty = qty
                else
                    allResources[#allResources + 1] = { resource = key, bankQty = 0, invQty = qty }
                    seen[key] = #allResources
                end
            end
        end
    end

    table.sort(allResources, function(a, b) return a.resource < b.resource end)

    -- Header
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.6, 0.55, 0.4, 0.7)
    love.graphics.printf("Resource", px + 12, contentY, 140, "left")
    love.graphics.printf("Bank", px + 160, contentY, 60, "center")
    love.graphics.printf("Inv", px + 225, contentY, 60, "center")

    -- Scrollable list
    local listY = contentY + 16
    local listH = contentH - 50
    love.graphics.setScissor(px + 5, listY, pw - 10, listH)
    game._bank._resourceRows = {}

    for i, entry in ipairs(allResources) do
        local rowY = listY + (i - 1) * BANK_ITEM_H - game._bank.scroll
        if rowY + BANK_ITEM_H > listY and rowY < listY + listH then
            local isSelected = (game._bank.selected == i)
            if isSelected then
                love.graphics.setColor(0.2, 0.18, 0.08, 0.8)
            elseif i % 2 == 0 then
                love.graphics.setColor(0.08, 0.08, 0.12, 0.4)
            else
                love.graphics.setColor(0.06, 0.06, 0.1, 0.2)
            end
            love.graphics.rectangle("fill", px + 6, rowY, pw - 12, BANK_ITEM_H - 2, 3, 3)

            love.graphics.setFont(fonts.chat)
            love.graphics.setColor(0.9, 0.85, 0.7, 1)
            love.graphics.printf(formatResourceName(entry.resource), px + 12, rowY + 6, 140, "left")
            love.graphics.setColor(1, 0.85, 0.3, 0.9)
            love.graphics.printf(tostring(entry.bankQty), px + 160, rowY + 6, 60, "center")
            love.graphics.setColor(0.7, 0.8, 0.9, 0.9)
            love.graphics.printf(tostring(entry.invQty), px + 225, rowY + 6, 60, "center")

            -- Deposit button
            if entry.invQty > 0 then
                local depX2 = px + pw - 140
                love.graphics.setColor(0.1, 0.2, 0.1, 0.9)
                love.graphics.rectangle("fill", depX2, rowY + 2, 56, BANK_ITEM_H - 6, 3, 3)
                love.graphics.setColor(0.3, 0.7, 0.4, 1)
                love.graphics.rectangle("line", depX2, rowY + 2, 56, BANK_ITEM_H - 6, 3, 3)
                love.graphics.setFont(fonts.small)
                love.graphics.printf("Dep", depX2, rowY + 6, 56, "center")
            end

            -- Withdraw button
            if entry.bankQty > 0 then
                local witX2 = px + pw - 76
                love.graphics.setColor(0.2, 0.1, 0.05, 0.9)
                love.graphics.rectangle("fill", witX2, rowY + 2, 56, BANK_ITEM_H - 6, 3, 3)
                love.graphics.setColor(0.7, 0.5, 0.3, 1)
                love.graphics.rectangle("line", witX2, rowY + 2, 56, BANK_ITEM_H - 6, 3, 3)
                love.graphics.setFont(fonts.small)
                love.graphics.printf("Wit", witX2, rowY + 6, 56, "center")
            end

            game._bank._resourceRows[i] = {
                y = rowY, resource = entry.resource,
                bankQty = entry.bankQty, invQty = entry.invQty,
                depBtn = entry.invQty > 0 and { x = px + pw - 140, y = rowY + 2, w = 56, h = BANK_ITEM_H - 6 } or nil,
                witBtn = entry.bankQty > 0 and { x = px + pw - 76, y = rowY + 2, w = 56, h = BANK_ITEM_H - 6 } or nil,
            }
        end
    end
    love.graphics.setScissor()

    -- Amount selector at bottom
    local amountY = contentY + contentH - 30
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(0.7, 0.65, 0.4, 0.9)
    love.graphics.printf("Qty: " .. game._bank.amount, px + 10, amountY + 4, 80, "left")

    local minBtnX = px + 95
    love.graphics.setColor(0.2, 0.15, 0.08, 0.9)
    love.graphics.rectangle("fill", minBtnX, amountY, 26, 22, 3, 3)
    love.graphics.setColor(0.8, 0.7, 0.3, 1)
    love.graphics.printf("-", minBtnX, amountY + 2, 26, "center")
    game._bank._resMinusBtn = { x = minBtnX, y = amountY, w = 26, h = 22 }

    local plusBtnX = minBtnX + 30
    love.graphics.setColor(0.2, 0.15, 0.08, 0.9)
    love.graphics.rectangle("fill", plusBtnX, amountY, 26, 22, 3, 3)
    love.graphics.setColor(0.8, 0.7, 0.3, 1)
    love.graphics.printf("+", plusBtnX, amountY + 2, 26, "center")
    game._bank._resPlusBtn = { x = plusBtnX, y = amountY, w = 26, h = 22 }

    local maxBtnX = plusBtnX + 30
    love.graphics.setColor(0.2, 0.15, 0.08, 0.9)
    love.graphics.rectangle("fill", maxBtnX, amountY, 36, 22, 3, 3)
    love.graphics.setColor(0.8, 0.7, 0.3, 1)
    love.graphics.printf("Max", maxBtnX, amountY + 2, 36, "center")
    game._bank._resMaxBtn = { x = maxBtnX, y = amountY, w = 36, h = 22 }
end

function game.drawBankItemsTab(px, py, pw, ph, contentY, contentH)
    local bankItems = game._bank.data.items or {}
    local invItems = (mmoInventory and mmoInventory.items) or {}

    -- Column headers
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.6, 0.55, 0.4, 0.7)
    love.graphics.printf("Bank Items (" .. #bankItems .. "/" .. game._bank.data.maxSlots .. ")", px + 12, contentY, (pw / 2) - 20, "left")
    love.graphics.printf("Inventory (" .. #invItems .. "/100)", px + pw / 2 + 8, contentY, (pw / 2) - 20, "left")

    local listY = contentY + 16
    local listH = contentH - 16
    local colW = math.floor((pw - 20) / 2)

    -- Bank items column
    love.graphics.setScissor(px + 5, listY, colW, listH)
    game._bank._bankItemRows = {}
    for i, item in ipairs(bankItems) do
        local rowY = listY + (i - 1) * BANK_ITEM_H - game._bank.scroll
        if rowY + BANK_ITEM_H > listY and rowY < listY + listH then
            if i % 2 == 0 then
                love.graphics.setColor(0.08, 0.08, 0.12, 0.4)
            else
                love.graphics.setColor(0.06, 0.06, 0.1, 0.2)
            end
            love.graphics.rectangle("fill", px + 6, rowY, colW - 2, BANK_ITEM_H - 2, 2, 2)

            -- Item name
            love.graphics.setFont(fonts.small)
            local itemName = item.name or item.type or "Item"
            love.graphics.setColor(0.9, 0.85, 0.7, 1)
            love.graphics.printf(itemName, px + 10, rowY + 4, colW - 50, "left")

            -- Withdraw arrow
            love.graphics.setColor(0.7, 0.5, 0.3, 1)
            love.graphics.printf(">", px + colW - 20, rowY + 4, 16, "center")

            game._bank._bankItemRows[i] = { y = rowY, item = item, index = i - 1, btn = { x = px + 6, y = rowY, w = colW - 2, h = BANK_ITEM_H - 2 } }
        end
    end
    love.graphics.setScissor()

    -- Divider
    love.graphics.setColor(0.7, 0.6, 0.2, 0.4)
    love.graphics.line(px + colW + 8, listY, px + colW + 8, listY + listH)

    -- Inventory items column
    local invX = px + colW + 12
    love.graphics.setScissor(invX, listY, colW, listH)
    game._bank._invItemRows = {}
    for i, item in ipairs(invItems) do
        local rowY = listY + (i - 1) * BANK_ITEM_H - game._bank.scroll
        if rowY + BANK_ITEM_H > listY and rowY < listY + listH then
            if i % 2 == 0 then
                love.graphics.setColor(0.08, 0.08, 0.12, 0.4)
            else
                love.graphics.setColor(0.06, 0.06, 0.1, 0.2)
            end
            love.graphics.rectangle("fill", invX, rowY, colW - 6, BANK_ITEM_H - 2, 2, 2)

            -- Deposit arrow
            love.graphics.setColor(0.3, 0.7, 0.4, 1)
            love.graphics.printf("<", invX + 4, rowY + 4, 16, "center")

            -- Item name
            love.graphics.setFont(fonts.small)
            local itemName = item.name or item.type or "Item"
            love.graphics.setColor(0.9, 0.85, 0.7, 1)
            love.graphics.printf(itemName, invX + 24, rowY + 4, colW - 34, "left")

            game._bank._invItemRows[i] = { y = rowY, item = item, btn = { x = invX, y = rowY, w = colW - 6, h = BANK_ITEM_H - 2 } }
        end
    end
    love.graphics.setScissor()
end

-- Bank: hit test helper
local function _hitTest(btn, mx, my)
    if not btn then return false end
    return mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h
end

function game.handleBankClick(mx, my)
    if not game._bank.show then return false end
    if not game._bank._panelX then return false end

    -- Click outside panel closes it
    if mx < game._bank._panelX or mx > game._bank._panelX + game._bank._panelW
       or my < game._bank._panelY or my > game._bank._panelY + game._bank._panelH then
        game._bank.show = false
        return true
    end

    -- Close button
    if _hitTest(game._bank._closeBtn, mx, my) then
        game._bank.show = false
        return true
    end

    -- Tabs
    if game._bank._tabBtns then
        for _, btn in ipairs(game._bank._tabBtns) do
            if _hitTest(btn, mx, my) then
                game._bank.tab = btn.tab
                game._bank.selected = nil
                game._bank.scroll = 0
                game._bank.amount = 1
                return true
            end
        end
    end

    if game._bank.transactionLock then return true end

    -- Gold tab controls
    if game._bank.tab == "gold" then
        if _hitTest(game._bank._goldMinusBtn, mx, my) then
            game._bank.amount = math.max(1, game._bank.amount - (love.keyboard.isDown("lshift") and 100 or 10))
            return true
        end
        if _hitTest(game._bank._goldPlusBtn, mx, my) then
            game._bank.amount = game._bank.amount + (love.keyboard.isDown("lshift") and 100 or 10)
            return true
        end
        if _hitTest(game._bank._goldMaxBtn, mx, my) then
            -- Set to max available for the likely action
            local walletGold = identity and identity.account and identity.account.chips or 0
            local bankGold = game._bank.data and game._bank.data.gold or 0
            game._bank.amount = math.max(walletGold, bankGold)
            return true
        end
        if _hitTest(game._bank._depositGoldBtn, mx, my) and client then
            game._bank.transactionLock = true
            client:emit("bank_deposit_gold", { amount = game._bank.amount })
            return true
        end
        if _hitTest(game._bank._withdrawGoldBtn, mx, my) and client then
            game._bank.transactionLock = true
            client:emit("bank_withdraw_gold", { amount = game._bank.amount })
            return true
        end
        if _hitTest(game._bank._expandBtn, mx, my) and client then
            game._bank.transactionLock = true
            client:emit("bank_buy_slots", {})
            return true
        end
        return true
    end

    -- Resources tab controls
    if game._bank.tab == "resources" then
        if _hitTest(game._bank._resMinusBtn, mx, my) then
            game._bank.amount = math.max(1, game._bank.amount - (love.keyboard.isDown("lshift") and 10 or 1))
            return true
        end
        if _hitTest(game._bank._resPlusBtn, mx, my) then
            game._bank.amount = game._bank.amount + (love.keyboard.isDown("lshift") and 10 or 1)
            return true
        end
        if _hitTest(game._bank._resMaxBtn, mx, my) then
            game._bank.amount = 999
            return true
        end
        -- Resource row deposit/withdraw buttons
        if game._bank._resourceRows then
            for _, row in pairs(game._bank._resourceRows) do
                if row.depBtn and _hitTest(row.depBtn, mx, my) and client then
                    game._bank.transactionLock = true
                    client:emit("bank_deposit_resource", { resource = row.resource, amount = math.min(game._bank.amount, row.invQty) })
                    return true
                end
                if row.witBtn and _hitTest(row.witBtn, mx, my) and client then
                    game._bank.transactionLock = true
                    client:emit("bank_withdraw_resource", { resource = row.resource, amount = math.min(game._bank.amount, row.bankQty) })
                    return true
                end
            end
        end
        return true
    end

    -- Items tab controls
    if game._bank.tab == "items" then
        -- Bank item rows (click to withdraw)
        if game._bank._bankItemRows then
            for _, row in pairs(game._bank._bankItemRows) do
                if _hitTest(row.btn, mx, my) and client then
                    game._bank.transactionLock = true
                    client:emit("bank_withdraw_item", { itemIndex = row.index })
                    return true
                end
            end
        end
        -- Inventory item rows (click to deposit)
        if game._bank._invItemRows then
            for _, row in pairs(game._bank._invItemRows) do
                if _hitTest(row.btn, mx, my) and client then
                    game._bank.transactionLock = true
                    client:emit("bank_deposit_item", { itemId = row.item.id })
                    return true
                end
            end
        end
        return true
    end

    return true
end

-- Draw the game._trade panel
function game.drawTradePanel(W, H)
    local pw = math.min(TRADE_W, W - 40)
    local ph = math.min(TRADE_H, H - 60)
    local px = math.floor((W - pw) / 2)
    local py = math.floor((H - ph) / 2)

    -- Store panel rect for click handling
    game._trade._panelX = px
    game._trade._panelY = py
    game._trade._panelW = pw
    game._trade._panelH = ph

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.07, 0.06, 0.1, 0.96)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    -- Amber/gold border to distinguish from shop
    love.graphics.setColor(0.75, 0.6, 0.2, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)
    love.graphics.setLineWidth(1)

    -- Title
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(1, 0.85, 0.3, 1)
    love.graphics.printf("Trade with " .. game._trade.partnerName, px + 10, py + 8, pw - 60, "left")

    -- Close / Cancel button (top right)
    local closeW, closeH = 22, 22
    local closeX = px + pw - closeW - 8
    local closeY = py + 6
    love.graphics.setColor(0.6, 0.2, 0.2, 0.9)
    love.graphics.rectangle("fill", closeX, closeY, closeW, closeH, 4, 4)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.setFont(fonts.name)
    love.graphics.printf("X", closeX, closeY + 3, closeW, "center")
    game._trade._closeBtn = { x = closeX, y = closeY, w = closeW, h = closeH }

    -- Divider line under title
    love.graphics.setColor(0.75, 0.6, 0.2, 0.3)
    love.graphics.line(px + 10, py + 34, px + pw - 10, py + 34)

    -- Status line
    love.graphics.setFont(fonts.npc)
    local statusText, statusColor
    if game._trade.myConfirmed and game._trade.theirConfirmed then
        statusText = "Both confirmed! Completing trade..."
        statusColor = {0.3, 1, 0.4, 1}
    elseif game._trade.myConfirmed then
        statusText = "Waiting for partner to confirm..."
        statusColor = {1, 0.85, 0.3, 1}
    elseif game._trade.theirConfirmed then
        statusText = "Partner confirmed. Review and confirm your offer."
        statusColor = {0.4, 0.8, 1, 1}
    else
        statusText = "Add items to your offer, then confirm."
        statusColor = {0.6, 0.65, 0.7, 1}
    end
    love.graphics.setColor(statusColor)
    love.graphics.printf(statusText, px + 10, py + 38, pw - 20, "center")

    -- Column layout
    local colW = math.floor((pw - TRADE_COL_GAP - 20) / 2)
    local leftX = px + 10
    local rightX = leftX + colW + TRADE_COL_GAP
    local colTop = py + 56
    local colH = ph - 56 - TRADE_INV_BOT

    -- ===================== LEFT COLUMN: Your Offer =====================
    -- Column header
    love.graphics.setFont(fonts.chat)
    love.graphics.setColor(0.9, 0.8, 0.4, 1)
    love.graphics.printf("Your Offer", leftX, colTop, colW, "center")
    if game._trade.myConfirmed then
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.2, 1, 0.3, 1)
        love.graphics.printf("CONFIRMED", leftX, colTop + 1, colW - 4, "right")
    end

    -- Offered items list (top half of column)
    local offeredTop = colTop + 20
    local offeredH = math.floor(colH * 0.38)  -- ~38% for offered items
    love.graphics.setColor(0.04, 0.04, 0.08, 0.6)
    love.graphics.rectangle("fill", leftX, offeredTop, colW, offeredH, 4, 4)
    love.graphics.setColor(0.5, 0.45, 0.2, 0.5)
    love.graphics.rectangle("line", leftX, offeredTop, colW, offeredH, 4, 4)

    love.graphics.setFont(fonts.npc)
    game._trade._offeredRects = {}
    if #game._trade.myOffer.items == 0 and game._trade.myOffer.chips == 0 then
        love.graphics.setColor(0.5, 0.5, 0.55, 0.6)
        love.graphics.printf("(empty)", leftX, offeredTop + offeredH / 2 - 6, colW, "center")
    else
        local oy = offeredTop + 2
        -- Draw offered items
        for i, item in ipairs(game._trade.myOffer.items) do
            if oy + TRADE_ITEM_H > offeredTop + offeredH then break end
            local label
            if item.type == "resource" then
                label = formatResourceName(item.resource) .. " x" .. (item.amount or 1)
                love.graphics.setColor(0.85, 0.85, 0.9, 1)
            else
                -- Card
                label = item.name or ("Card:" .. (item.cardInstanceId or "?"):sub(1, 8))
                local rc = RARITY_COLORS[item.rarity] or {0.7, 0.7, 0.7}
                love.graphics.setColor(rc[1], rc[2], rc[3], 1)
            end
            love.graphics.printf(label, leftX + 4, oy + 4, colW - 30, "left")
            -- Remove [x] button
            love.graphics.setColor(1, 0.35, 0.35, 0.9)
            love.graphics.printf("x", leftX + colW - 20, oy + 4, 16, "center")
            game._trade._offeredRects[i] = { x = leftX + colW - 24, y = oy, w = 22, h = TRADE_ITEM_H }
            oy = oy + TRADE_ITEM_H
        end
        -- Show offered coins line
        if game._trade.myOffer.chips > 0 then
            if oy + TRADE_ITEM_H <= offeredTop + offeredH then
                love.graphics.setColor(1, 0.85, 0.3, 1)
                love.graphics.printf("Coins: " .. game._trade.myOffer.chips, leftX + 4, oy + 4, colW - 8, "left")
            end
        end
    end

    -- Inventory list (bottom portion of column)
    local invLabelY = offeredTop + offeredH + 4
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.7, 0.7, 0.75, 0.8)
    love.graphics.printf("Inventory (click to add)", leftX, invLabelY, colW, "center")

    local invTop = invLabelY + 14
    local invH = colTop + colH - invTop
    love.graphics.setColor(0.04, 0.04, 0.08, 0.6)
    love.graphics.rectangle("fill", leftX, invTop, colW, invH, 4, 4)
    love.graphics.setColor(0.3, 0.35, 0.25, 0.4)
    love.graphics.rectangle("line", leftX, invTop, colW, invH, 4, 4)

    -- Store region for scroll clipping
    game._trade._invRegion = { x = leftX, y = invTop, w = colW, h = invH }

    local invItems = getTradableInventory()
    game._trade._invItems = invItems  -- cache for click handler
    game._trade._invRects = {}

    love.graphics.setScissor(leftX, invTop, colW, invH)
    local iy = invTop + 2 - game._trade.myScroll
    for i, item in ipairs(invItems) do
        if iy + TRADE_ITEM_H > invTop and iy < invTop + invH then
            local label
            if item.type == "resource" then
                label = item.name .. " (" .. item.amount .. ")"
                love.graphics.setColor(0.8, 0.82, 0.85, 1)
            else
                label = item.name
                local rc = RARITY_COLORS[item.rarity] or {0.7, 0.7, 0.7}
                love.graphics.setColor(rc[1], rc[2], rc[3], 1)
            end
            love.graphics.printf(label, leftX + 4, iy + 4, colW - 28, "left")
            -- [+] indicator
            love.graphics.setColor(0.3, 0.9, 0.3, 0.8)
            love.graphics.printf("+", leftX + colW - 20, iy + 4, 16, "center")
        end
        game._trade._invRects[i] = { x = leftX, y = iy, w = colW, h = TRADE_ITEM_H }
        iy = iy + TRADE_ITEM_H
    end
    -- Track max scroll
    local maxScroll = math.max(0, #invItems * TRADE_ITEM_H - invH + 4)
    if game._trade.myScroll > maxScroll then game._trade.myScroll = maxScroll end
    love.graphics.setScissor()

    -- ===================== RIGHT COLUMN: Their Offer =====================
    love.graphics.setFont(fonts.chat)
    love.graphics.setColor(0.6, 0.8, 1, 1)
    love.graphics.printf("Their Offer", rightX, colTop, colW, "center")
    if game._trade.theirConfirmed then
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.2, 1, 0.3, 1)
        love.graphics.printf("CONFIRMED", rightX, colTop + 1, colW - 4, "right")
    end

    local theirTop = colTop + 20
    local theirH = colH  -- full column height for their offer (read-only)
    love.graphics.setColor(0.04, 0.04, 0.08, 0.6)
    love.graphics.rectangle("fill", rightX, theirTop, colW, theirH, 4, 4)
    love.graphics.setColor(0.2, 0.35, 0.5, 0.5)
    love.graphics.rectangle("line", rightX, theirTop, colW, theirH, 4, 4)

    love.graphics.setFont(fonts.npc)
    if #game._trade.theirOffer.items == 0 and game._trade.theirOffer.chips == 0 then
        love.graphics.setColor(0.5, 0.5, 0.55, 0.6)
        love.graphics.printf("(waiting for offer...)", rightX, theirTop + theirH / 2 - 6, colW, "center")
    else
        local ty = theirTop + 2
        for _, item in ipairs(game._trade.theirOffer.items) do
            if ty + TRADE_ITEM_H > theirTop + theirH then break end
            local label
            if item.type == "resource" then
                label = formatResourceName(item.resource or "?") .. " x" .. (item.amount or 1)
                love.graphics.setColor(0.85, 0.85, 0.9, 1)
            elseif item.type == "card" then
                label = "Card: " .. (item.cardInstanceId or "?"):sub(1, 12)
                love.graphics.setColor(0.7, 0.6, 1, 1)
            else
                label = tostring(item.type or "???")
                love.graphics.setColor(0.7, 0.7, 0.7, 1)
            end
            love.graphics.printf(label, rightX + 4, ty + 4, colW - 8, "left")
            ty = ty + TRADE_ITEM_H
        end
        -- Their coins
        if game._trade.theirOffer.chips > 0 then
            if ty + TRADE_ITEM_H <= theirTop + theirH then
                love.graphics.setColor(1, 0.85, 0.3, 1)
                love.graphics.printf("Coins: " .. game._trade.theirOffer.chips, rightX + 4, ty + 4, colW - 8, "left")
            end
        end
    end

    -- ===================== BOTTOM CONTROLS =====================
    local ctrlY = py + ph - TRADE_INV_BOT + 4

    -- Coin input field (left side)
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.7, 0.7, 0.75, 0.8)
    love.graphics.print("Offer Coins:", leftX, ctrlY)

    local inputX = leftX + 78
    local inputW = colW - 78
    local inputH = 20
    -- Input box background
    if game._trade.coinInputActive then
        love.graphics.setColor(0.12, 0.11, 0.18, 1)
    else
        love.graphics.setColor(0.06, 0.06, 0.1, 0.8)
    end
    love.graphics.rectangle("fill", inputX, ctrlY - 2, inputW, inputH, 3, 3)
    love.graphics.setColor(game._trade.coinInputActive and {0.75, 0.6, 0.2, 0.9} or {0.4, 0.35, 0.25, 0.5})
    love.graphics.rectangle("line", inputX, ctrlY - 2, inputW, inputH, 3, 3)
    -- Input text / placeholder
    love.graphics.setColor(1, 0.9, 0.5, 1)
    local displayText = game._trade.coinInput
    if displayText == "" then
        love.graphics.setColor(0.5, 0.5, 0.55, 0.5)
        displayText = "0"
    end
    -- Blinking cursor when active
    if game._trade.coinInputActive then
        local cursorBlink = math.floor(love.timer.getTime() * 2) % 2 == 0
        if cursorBlink then
            displayText = displayText .. "|"
        end
    end
    love.graphics.printf(displayText, inputX + 4, ctrlY, inputW - 8, "left")
    game._trade._coinInputRect = { x = inputX, y = ctrlY - 2, w = inputW, h = inputH }

    -- "Set" button next to coin input to apply coins to offer
    local setBtnW = 36
    local setBtnX = leftX + colW - setBtnW
    local setBtnY = ctrlY + inputH + 4
    love.graphics.setColor(0.5, 0.45, 0.2, 0.9)
    love.graphics.rectangle("fill", setBtnX, setBtnY, setBtnW, 18, 3, 3)
    love.graphics.setColor(1, 0.9, 0.5, 1)
    love.graphics.printf("Set", setBtnX, setBtnY + 1, setBtnW, "center")
    game._trade._coinSetBtn = { x = setBtnX, y = setBtnY, w = setBtnW, h = 18 }

    -- Current coin balance label
    love.graphics.setColor(0.55, 0.55, 0.6, 0.7)
    love.graphics.printf("Balance: " .. (account and account.coins or 0), leftX, setBtnY + 2, colW - setBtnW - 8, "left")

    -- Confirm button (right side bottom)
    local confirmW = colW
    local confirmH = 28
    local confirmX = rightX
    local confirmY = ctrlY + 4
    local canConfirm = hasOfferContent() and not game._trade.myConfirmed
    if game._trade.myConfirmed then
        love.graphics.setColor(0.15, 0.5, 0.2, 0.9)
    elseif canConfirm then
        love.graphics.setColor(0.2, 0.6, 0.3, 0.9)
    else
        love.graphics.setColor(0.25, 0.25, 0.3, 0.6)
    end
    love.graphics.rectangle("fill", confirmX, confirmY, confirmW, confirmH, 4, 4)
    love.graphics.setFont(fonts.chat)
    if game._trade.myConfirmed then
        love.graphics.setColor(0.4, 1, 0.5, 1)
        love.graphics.printf("CONFIRMED", confirmX, confirmY + 5, confirmW, "center")
    elseif canConfirm then
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.printf("Confirm Trade", confirmX, confirmY + 5, confirmW, "center")
    else
        love.graphics.setColor(0.5, 0.5, 0.55, 0.6)
        love.graphics.printf("Confirm Trade", confirmX, confirmY + 5, confirmW, "center")
    end
    game._trade._confirmBtn = { x = confirmX, y = confirmY, w = confirmW, h = confirmH }

    -- Cancel button (below confirm)
    local cancelW = colW
    local cancelH = 22
    local cancelX = rightX
    local cancelY = confirmY + confirmH + 6
    love.graphics.setColor(0.5, 0.2, 0.2, 0.8)
    love.graphics.rectangle("fill", cancelX, cancelY, cancelW, cancelH, 4, 4)
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(1, 0.7, 0.7, 1)
    love.graphics.printf("Cancel Trade", cancelX, cancelY + 3, cancelW, "center")
    game._trade._cancelBtn = { x = cancelX, y = cancelY, w = cancelW, h = cancelH }

    -- Message feedback (bottom center)
    if game._trade.message and game._trade.message.timer and game._trade.message.timer > 0 then
        local alpha = math.min(1, game._trade.message.timer)
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(game._trade.message.color[1], game._trade.message.color[2], game._trade.message.color[3], alpha)
        love.graphics.printf(game._trade.message.text, px + 14, py + ph - 16, pw - 28, "center")
    end

    -- Escape hint
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.4, 0.4, 0.35, 0.5)
    love.graphics.printf("Esc to cancel", px, py + ph - 16, pw - 10, "right")
end

-- Draw the incoming game._trade request popup (small overlay near top of screen)
function game.drawTradeRequestPopup(W, H)
    if not game._trade.pendingRequest then return end

    local popW = 340
    local popH = 60
    local popX = math.floor((W - popW) / 2)
    local popY = 10

    -- Background
    love.graphics.setColor(0.08, 0.07, 0.12, 0.95)
    love.graphics.rectangle("fill", popX, popY, popW, popH, 6, 6)
    -- Gold border
    love.graphics.setColor(0.75, 0.6, 0.2, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", popX, popY, popW, popH, 6, 6)
    love.graphics.setLineWidth(1)

    -- Text
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(1, 0.9, 0.5, 1)
    local msg = (game._trade.pendingRequest.fromName or "???") .. " wants to trade"
    love.graphics.printf(msg, popX + 10, popY + 6, popW - 20, "center")

    -- Timer text
    if game._trade._pendingTimer then
        love.graphics.setColor(0.6, 0.6, 0.65, 0.6)
        love.graphics.printf(math.ceil(game._trade._pendingTimer) .. "s", popX + popW - 40, popY + 6, 30, "right")
    end

    -- Accept button
    local btnW = 80
    local btnH = 22
    local btnY = popY + 30
    local acceptX = popX + popW / 2 - btnW - 10
    love.graphics.setColor(0.2, 0.55, 0.25, 0.9)
    love.graphics.rectangle("fill", acceptX, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Accept (Y)", acceptX, btnY + 3, btnW, "center")
    game._trade._acceptBtn = { x = acceptX, y = btnY, w = btnW, h = btnH }

    -- Decline button
    local declineX = popX + popW / 2 + 10
    love.graphics.setColor(0.55, 0.2, 0.2, 0.9)
    love.graphics.rectangle("fill", declineX, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 0.7, 0.7, 1)
    love.graphics.printf("Decline (N)", declineX, btnY + 3, btnW, "center")
    game._trade._declineBtn = { x = declineX, y = btnY, w = btnW, h = btnH }
end

-- Trade panel: handle click, returns true if click was consumed
function game.handleTradeClick(mx, my)
    if not game._trade.show then return false end

    local px = game._trade._panelX or 0
    local py = game._trade._panelY or 0
    local pw = game._trade._panelW or TRADE_W
    local ph = game._trade._panelH or TRADE_H

    -- Click outside panel: cancel game._trade
    if mx < px or mx > px + pw or my < py or my > py + ph then
        if game._trade.tradeId and client then
            client:emit("trade_cancel", { tradeId = game._trade.tradeId })
        end
        resetTradeState()
        return true
    end

    -- Close button
    if game._trade._closeBtn then
        local btn = game._trade._closeBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            if game._trade.tradeId and client then
                client:emit("trade_cancel", { tradeId = game._trade.tradeId })
            end
            resetTradeState()
            return true
        end
    end

    -- Cancel button
    if game._trade._cancelBtn then
        local btn = game._trade._cancelBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            if game._trade.tradeId and client then
                client:emit("trade_cancel", { tradeId = game._trade.tradeId })
            end
            resetTradeState()
            return true
        end
    end

    -- Confirm button
    if game._trade._confirmBtn then
        local btn = game._trade._confirmBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            if hasOfferContent() and not game._trade.myConfirmed and client and game._trade.tradeId then
                client:emit("trade_confirm", { tradeId = game._trade.tradeId })
                game._trade.myConfirmed = true
            end
            return true
        end
    end

    -- Coin input field click (activate/deactivate)
    if game._trade._coinInputRect then
        local btn = game._trade._coinInputRect
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            game._trade.coinInputActive = true
            return true
        else
            -- Clicking elsewhere deactivates coin input
            game._trade.coinInputActive = false
        end
    end

    -- Coin "Set" button
    if game._trade._coinSetBtn then
        local btn = game._trade._coinSetBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            local amount = tonumber(game._trade.coinInput) or 0
            amount = math.floor(amount)
            local maxCoins = (account and account.coins) or 0
            amount = math.max(0, math.min(amount, maxCoins))
            game._trade.myOffer.chips = amount
            game._trade.coinInput = amount > 0 and tostring(amount) or ""
            emitTradeOffer()
            return true
        end
    end

    -- Remove offered item [x] buttons
    if game._trade._offeredRects then
        for i, rect in pairs(game._trade._offeredRects) do
            if mx >= rect.x and mx <= rect.x + rect.w and my >= rect.y and my <= rect.y + rect.h then
                -- Remove item from offer
                if game._trade.myOffer.items[i] then
                    table.remove(game._trade.myOffer.items, i)
                    emitTradeOffer()
                end
                return true
            end
        end
    end

    -- Inventory item clicks (add to offer)
    if game._trade._invRects and game._trade._invItems then
        local region = game._trade._invRegion
        for i, rect in pairs(game._trade._invRects) do
            if mx >= rect.x and mx <= rect.x + rect.w and my >= rect.y and my <= rect.y + rect.h then
                -- Must be in visible region
                if region and my >= region.y and my < region.y + region.h then
                    local item = game._trade._invItems[i]
                    if item then
                        if item.type == "resource" then
                            -- Check if this resource is already in the offer; if so, increment
                            local found = false
                            for _, oi in ipairs(game._trade.myOffer.items) do
                                if oi.type == "resource" and oi.resource == item.resource then
                                    oi.amount = (oi.amount or 0) + 1
                                    found = true
                                    break
                                end
                            end
                            if not found then
                                -- Max 10 item slots (server limit)
                                if #game._trade.myOffer.items < 10 then
                                    table.insert(game._trade.myOffer.items, {
                                        type = "resource",
                                        resource = item.resource,
                                        amount = 1,
                                    })
                                end
                            end
                        elseif item.type == "card" then
                            -- Add card (one per slot)
                            if #game._trade.myOffer.items < 10 then
                                table.insert(game._trade.myOffer.items, {
                                    type = "card",
                                    cardInstanceId = item.cardInstanceId,
                                    name = item.name,
                                    rarity = item.rarity,
                                })
                            end
                        end
                        emitTradeOffer()
                    end
                end
                return true
            end
        end
    end

    -- Consume click inside panel
    return true
end

-- Trade request popup: handle click, returns true if consumed
function game.handleTradeRequestClick(mx, my)
    if not game._trade.pendingRequest then return false end

    -- Accept button
    if game._trade._acceptBtn then
        local btn = game._trade._acceptBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            if client then
                client:emit("trade_accept", { tradeId = game._trade.pendingRequest.tradeId })
            end
            return true
        end
    end

    -- Decline button
    if game._trade._declineBtn then
        local btn = game._trade._declineBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            if client then
                client:emit("trade_cancel", { tradeId = game._trade.pendingRequest.tradeId })
            end
            game._trade.pendingRequest = nil
            game._trade._pendingTimer = nil
            return true
        end
    end

    return false
end

-- Admin panel overlay (F10 for server hosts)
function game.drawAdminPanel(W, H)
    if not game._admin.showPanel then return end

    local panelW = 300
    local panelX = W - panelW
    local panelY = 0
    local panelH = H
    local font = fonts.ui or love.graphics.getFont()
    local smallFont = fonts.chat or fonts.npc or font
    local lineH = font:getHeight() + 4
    local smallLineH = smallFont:getHeight() + 4

    -- Semi-transparent dark background
    love.graphics.setColor(0, 0, 0, 0.85)
    love.graphics.rectangle("fill", panelX, panelY, panelW, panelH)
    -- Border
    love.graphics.setColor(0.4, 0.4, 0.6, 0.8)
    love.graphics.rectangle("line", panelX, panelY, panelW, panelH)

    local y = panelY + 12
    local padX = panelX + 12
    local contentW = panelW - 24

    -- Title
    love.graphics.setFont(font)
    love.graphics.setColor(1, 0.85, 0.2, 1)
    love.graphics.printf("Server Admin Panel", padX, y, contentW, "center")
    y = y + lineH + 4

    -- Separator
    love.graphics.setColor(0.4, 0.4, 0.6, 0.5)
    love.graphics.line(padX, y, padX + contentW, y)
    y = y + 8

    -- Server name
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.7, 0.7, 0.8, 1)
    local shardName = (_G.selectedShard and _G.selectedShard.name) or "Unknown Server"
    love.graphics.printf("Server: " .. shardName, padX, y, contentW, "left")
    y = y + smallLineH + 2

    -- Connected players header
    love.graphics.setColor(0.6, 0.9, 1, 1)
    love.graphics.printf("Connected Players:", padX, y, contentW, "left")
    y = y + smallLineH + 2

    -- Player list with kick buttons
    local playerCount = 0
    for id, p in pairs(players) do
        playerCount = playerCount + 1
        local isMe = (id == myId)
        local pName = p.name or p.username or ("Player " .. tostring(id):sub(1, 8))

        -- Player name
        if isMe then
            love.graphics.setColor(0.3, 1, 0.3, 1)
            love.graphics.printf("  " .. pName .. " (you)", padX, y, contentW - 60, "left")
        else
            love.graphics.setColor(0.9, 0.9, 0.9, 1)
            love.graphics.printf("  " .. pName, padX, y, contentW - 60, "left")

            -- Kick button
            local btnX = padX + contentW - 50
            local btnY = y - 1
            local btnW = 46
            local btnH = smallLineH - 2
            love.graphics.setColor(0.6, 0.15, 0.15, 0.8)
            love.graphics.rectangle("fill", btnX, btnY, btnW, btnH, 3, 3)
            love.graphics.setColor(1, 0.5, 0.5, 1)
            love.graphics.rectangle("line", btnX, btnY, btnW, btnH, 3, 3)
            love.graphics.setColor(1, 1, 1, 1)
            love.graphics.printf("Kick", btnX, btnY + 1, btnW, "center")
        end
        y = y + smallLineH + 1

        -- Clamp if too many players
        if y > panelH - 200 then
            love.graphics.setColor(0.5, 0.5, 0.5, 1)
            love.graphics.printf("  ... and more", padX, y, contentW, "left")
            y = y + smallLineH
            break
        end
    end

    if playerCount == 0 then
        love.graphics.setColor(0.5, 0.5, 0.5, 1)
        love.graphics.printf("  No players in zone", padX, y, contentW, "left")
        y = y + smallLineH
    end

    -- Separator
    y = y + 8
    love.graphics.setColor(0.4, 0.4, 0.6, 0.5)
    love.graphics.line(padX, y, padX + contentW, y)
    y = y + 10

    -- XP Rate control
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.8, 0.8, 1, 1)
    love.graphics.printf("XP Rate: " .. string.format("%.1fx", game._admin.xpRate), padX, y, contentW - 80, "left")

    -- - button
    local btnMX = padX + contentW - 75
    local btnPX = padX + contentW - 35
    local btnSize = 28

    love.graphics.setColor(0.3, 0.3, 0.5, 0.9)
    love.graphics.rectangle("fill", btnMX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(0.5, 0.5, 0.8, 1)
    love.graphics.rectangle("line", btnMX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("-", btnMX, y, btnSize, "center")

    -- + button
    love.graphics.setColor(0.3, 0.3, 0.5, 0.9)
    love.graphics.rectangle("fill", btnPX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(0.5, 0.5, 0.8, 1)
    love.graphics.rectangle("line", btnPX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("+", btnPX, y, btnSize, "center")

    y = y + btnSize + 8

    -- Drop Rate control
    love.graphics.setColor(0.8, 0.8, 1, 1)
    love.graphics.printf("Drop Rate: " .. string.format("%.1fx", game._admin.dropRate), padX, y, contentW - 80, "left")

    -- - button
    love.graphics.setColor(0.3, 0.3, 0.5, 0.9)
    love.graphics.rectangle("fill", btnMX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(0.5, 0.5, 0.8, 1)
    love.graphics.rectangle("line", btnMX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("-", btnMX, y, btnSize, "center")

    -- + button
    love.graphics.setColor(0.3, 0.3, 0.5, 0.9)
    love.graphics.rectangle("fill", btnPX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(0.5, 0.5, 0.8, 1)
    love.graphics.rectangle("line", btnPX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("+", btnPX, y, btnSize, "center")

    y = y + btnSize + 12

    -- Admin result message
    if game._admin.resultMsg and game._admin.resultMsg.timer > 0 then
        local alpha = math.min(1, game._admin.resultMsg.timer)
        love.graphics.setColor(game._admin.resultMsg.color[1], game._admin.resultMsg.color[2], game._admin.resultMsg.color[3], alpha)
        love.graphics.printf(game._admin.resultMsg.text, padX, y, contentW, "center")
        y = y + smallLineH + 4
    end

    -- Shutdown warning
    if game._admin.shutdownWarning and game._admin.shutdownWarning > 0 then
        love.graphics.setColor(1, 0.2, 0.2, 1)
        love.graphics.printf("SHUTDOWN IN " .. math.ceil(game._admin.shutdownWarning) .. "s", padX, y, contentW, "center")
        y = y + smallLineH + 4
    end

    -- Separator before shutdown button
    y = math.max(y, panelH - 50)
    love.graphics.setColor(0.4, 0.4, 0.6, 0.5)
    love.graphics.line(padX, y - 6, padX + contentW, y - 6)

    -- Shutdown server button
    local shutBtnW = contentW - 20
    local shutBtnH = 30
    local shutBtnX = padX + 10
    local shutBtnY = y
    love.graphics.setColor(0.5, 0.1, 0.1, 0.9)
    love.graphics.rectangle("fill", shutBtnX, shutBtnY, shutBtnW, shutBtnH, 4, 4)
    love.graphics.setColor(1, 0.3, 0.3, 1)
    love.graphics.rectangle("line", shutBtnX, shutBtnY, shutBtnW, shutBtnH, 4, 4)
    love.graphics.setFont(font)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Shutdown Server", shutBtnX, shutBtnY + (shutBtnH - font:getHeight()) / 2, shutBtnW, "center")

    -- Footer hint
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.4, 0.4, 0.5, 0.7)
    love.graphics.printf("F10 or Esc to close", padX, panelH - smallLineH - 4, contentW, "center")
end

-- Handle game._admin panel mouse clicks
function game.handleAdminPanelClick(mx, my)
    if not game._admin.showPanel or not client then return false end

    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()
    local panelW = 300
    local panelX = W - panelW

    -- Not inside the panel
    if mx < panelX or mx > W then return false end

    local smallFont = fonts.chat or fonts.npc or fonts.ui or love.graphics.getFont()
    local font = fonts.ui or love.graphics.getFont()
    local lineH = font:getHeight() + 4
    local smallLineH = smallFont:getHeight() + 4
    local padX = panelX + 12
    local contentW = panelW - 24

    -- Reconstruct Y positions to match draw
    local y = 12 + lineH + 4 + 8 + smallLineH + 2 + smallLineH + 2

    -- Scan player list for kick buttons
    for id, p in pairs(players) do
        local isMe = (id == myId)
        if not isMe then
            local btnX = padX + contentW - 50
            local btnY = y - 1
            local btnW = 46
            local btnH = smallLineH - 2
            if mx >= btnX and mx <= btnX + btnW and my >= btnY and my <= btnY + btnH then
                client:emit("admin_kick_player", { targetId = id })
                game._admin.resultMsg = { text = "Kick sent...", color = {1, 0.8, 0.3}, timer = 3 }
                return true
            end
        end
        y = y + smallLineH + 1
        if y > H - 200 then
            y = y + smallLineH
            break
        end
    end

    -- Move past separator to rate controls
    y = y + 8 + 10

    -- XP Rate buttons
    local btnSize = 28
    local btnMX = padX + contentW - 75
    local btnPX = padX + contentW - 35

    -- XP Rate - button (clamped to server-valid range 0.5-5.0)
    if mx >= btnMX and mx <= btnMX + btnSize and my >= y - 2 and my <= y - 2 + btnSize then
        game._admin.xpRate = math.max(0.5, game._admin.xpRate - 0.5)
        client:emit("admin_update_rules", { xpRate = game._admin.xpRate, dropRate = game._admin.dropRate })
        return true
    end
    -- XP Rate + button
    if mx >= btnPX and mx <= btnPX + btnSize and my >= y - 2 and my <= y - 2 + btnSize then
        game._admin.xpRate = math.min(5.0, game._admin.xpRate + 0.5)
        client:emit("admin_update_rules", { xpRate = game._admin.xpRate, dropRate = game._admin.dropRate })
        return true
    end

    y = y + btnSize + 8

    -- Drop Rate - button (clamped to server-valid range 0.5-5.0)
    if mx >= btnMX and mx <= btnMX + btnSize and my >= y - 2 and my <= y - 2 + btnSize then
        game._admin.dropRate = math.max(0.5, game._admin.dropRate - 0.5)
        client:emit("admin_update_rules", { xpRate = game._admin.xpRate, dropRate = game._admin.dropRate })
        return true
    end
    -- Drop Rate + button
    if mx >= btnPX and mx <= btnPX + btnSize and my >= y - 2 and my <= y - 2 + btnSize then
        game._admin.dropRate = math.min(5.0, game._admin.dropRate + 0.5)
        client:emit("admin_update_rules", { xpRate = game._admin.xpRate, dropRate = game._admin.dropRate })
        return true
    end

    -- Shutdown button (at bottom of panel)
    local shutBtnW = contentW - 20
    local shutBtnH = 30
    local shutBtnX = padX + 10
    local shutBtnY = math.max(y + btnSize + 12 + (game._admin.resultMsg and game._admin.resultMsg.timer and game._admin.resultMsg.timer > 0 and (smallLineH + 4) or 0) + (game._admin.shutdownWarning and game._admin.shutdownWarning > 0 and (smallLineH + 4) or 0), H - 50)
    if mx >= shutBtnX and mx <= shutBtnX + shutBtnW and my >= shutBtnY and my <= shutBtnY + shutBtnH then
        client:emit("admin_shutdown", {})
        game._admin.resultMsg = { text = "Shutdown command sent", color = {1, 0.5, 0.2}, timer = 5 }
        return true
    end

    -- Consume click inside panel even if no button hit (prevents world interaction)
    return true
end

-- Unload: clean up listeners to prevent accumulation on scene re-entry
function game.unload()
    game._audio.cleanup()
    game._audioSliderDrag = nil
    lighting.cleanup()
    dungeonParticles.cleanup()
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

-- ---------------------------------------------------------------------------
-- Farming Panel
-- ---------------------------------------------------------------------------

local FARMING_TABS = {"crops", "animals", "build"}
local FARMING_TAB_LABELS = {crops = "Crops", animals = "Animals", build = "Build"}

local SEED_NAMES = {
    wheat_seed = "Wheat Seed", herb_seed = "Herb Seed", vegetable_seed = "Vegetable Seed",
    mushroom_spore = "Mushroom Spore", berry_seed = "Berry Seed", tea_leaf_seed = "Tea Leaf Seed",
    pumpkin_seed = "Pumpkin Seed", corn_seed = "Corn Seed", rare_flower_seed = "Rare Flower Seed",
    ancient_seed = "Ancient Seed",
}

local CROP_STAGE_NAMES = {"Seed", "Sprout", "Growing", "Mature", "Withered"}
local CROP_STAGE_COLORS = {
    {0.5, 0.4, 0.3}, {0.4, 0.7, 0.3}, {0.3, 0.8, 0.3}, {0.9, 0.8, 0.2}, {0.5, 0.3, 0.2}
}

local ANIMAL_NAMES = {
    chicken = "Chicken", cow = "Cow", sheep = "Sheep", pig = "Pig", bee_hive = "Bee Hive"
}

function game.drawFarmingPanel(W, H)
    local pw = math.min(700, W - 40)
    local ph = math.min(520, H - 60)
    local px = (W - pw) / 2
    local py = (H - ph) / 2

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.06, 0.08, 0.05, 0.95)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    love.graphics.setColor(0.3, 0.55, 0.25, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.4, 0.8, 0.3)
    love.graphics.print("Farm & Ranch", px + 15, py + 10)

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.5)
    love.graphics.printf("[F] Close", px, py + 14, pw - 15, "right")

    -- Tabs
    local tabY = py + 40
    local tabW = math.floor((pw - 30) / #FARMING_TABS)
    love.graphics.setFont(fonts.ui)
    for i, tab in ipairs(FARMING_TABS) do
        local tx = px + 15 + (i - 1) * tabW
        local active = (ui.farmingTab == tab)
        if active then
            love.graphics.setColor(0.25, 0.45, 0.2, 0.9)
        else
            love.graphics.setColor(0.12, 0.15, 0.1, 0.7)
        end
        love.graphics.rectangle("fill", tx, tabY, tabW - 4, 30, 4, 4)
        love.graphics.setColor(active and {0.8, 1, 0.7} or {0.5, 0.6, 0.5})
        love.graphics.printf(FARMING_TAB_LABELS[tab], tx, tabY + 6, tabW - 4, "center")
    end

    local contentY = tabY + 40
    local contentH = ph - (contentY - py) - 10

    if ui.farmingTab == "crops" then
        game._drawCropsTab(px, contentY, pw, contentH)
    elseif ui.farmingTab == "animals" then
        game._drawAnimalsTab(px, contentY, pw, contentH)
    elseif ui.farmingTab == "build" then
        game._drawBuildTab(px, contentY, pw, contentH)
    end
end

function game._drawCropsTab(px, cy, pw, ch)
    love.graphics.setFont(fonts.main)
    local crops = ui.farmCrops
    local y = cy + 5

    if #crops == 0 then
        love.graphics.setColor(0.5, 0.6, 0.5)
        love.graphics.printf("No crops planted. Place a Crop Plot or Garden Bed, then press [E] to plant seeds.", px + 20, y, pw - 40, "center")
        -- Show plantable seeds from inventory
        y = y + 40
        love.graphics.setColor(0.4, 0.8, 0.3)
        love.graphics.print("Available Seeds:", px + 20, y)
        y = y + 20
        local hasSeed = false
        if resources then
            for seedType, seedName in pairs(SEED_NAMES) do
                local amt = resources[seedType] or 0
                if amt > 0 then
                    hasSeed = true
                    love.graphics.setColor(0.7, 0.8, 0.6)
                    love.graphics.print(string.format("  %s x%d", seedName, amt), px + 25, y)
                    y = y + 18
                end
            end
        end
        if not hasSeed then
            love.graphics.setColor(0.4, 0.4, 0.4)
            love.graphics.print("  No seeds. Buy from Seed Merchant or harvest wild plants.", px + 25, y)
        end
        return
    end

    -- Header
    love.graphics.setColor(0.4, 0.8, 0.3)
    love.graphics.print("Plot", px + 20, y)
    love.graphics.print("Crop", px + 100, y)
    love.graphics.print("Stage", px + 250, y)
    love.graphics.print("Progress", px + 370, y)
    love.graphics.print("Watered", px + 500, y)
    y = y + 22
    love.graphics.setColor(0.3, 0.4, 0.25, 0.5)
    love.graphics.rectangle("fill", px + 15, y, pw - 30, 1)
    y = y + 5

    for i, crop in ipairs(crops) do
        if y > cy + ch - 20 then break end
        local stage = (crop.stage or 0) + 1
        local stageCol = CROP_STAGE_COLORS[stage] or {0.6, 0.6, 0.6}

        love.graphics.setColor(0.6, 0.7, 0.6)
        love.graphics.print("#" .. i, px + 20, y)

        love.graphics.setColor(0.8, 0.9, 0.7)
        local seedName = SEED_NAMES[crop.seedType] or crop.seedType or "?"
        love.graphics.print(seedName:gsub("_seed", ""):gsub("_spore", ""), px + 100, y)

        love.graphics.setColor(stageCol)
        love.graphics.print(CROP_STAGE_NAMES[stage] or "?", px + 250, y)

        -- Progress bar
        local prog = crop.growthProgress or 0
        local barX, barW = px + 370, 110
        love.graphics.setColor(0.15, 0.2, 0.1)
        love.graphics.rectangle("fill", barX, y + 2, barW, 12, 3, 3)
        love.graphics.setColor(stageCol[1], stageCol[2], stageCol[3], 0.8)
        love.graphics.rectangle("fill", barX, y + 2, barW * math.min(1, prog), 12, 3, 3)
        love.graphics.setColor(0.9, 0.9, 0.9)
        love.graphics.setFont(fonts.small)
        love.graphics.printf(math.floor(prog * 100) .. "%", barX, y + 1, barW, "center")
        love.graphics.setFont(fonts.main)

        -- Watered indicator
        if crop.wateredToday then
            love.graphics.setColor(0.3, 0.6, 1)
            love.graphics.print("Yes", px + 510, y)
        else
            love.graphics.setColor(0.7, 0.4, 0.3)
            love.graphics.print("No", px + 510, y)
        end

        y = y + 22
    end

    -- Plant seed prompt if a plot is selected
    if ui.farmingPlotId then
        y = math.max(y + 10, cy + ch - 80)
        love.graphics.setColor(0.3, 0.5, 0.25, 0.6)
        love.graphics.rectangle("fill", px + 15, y, pw - 30, 70, 4, 4)
        love.graphics.setColor(0.6, 0.9, 0.5)
        love.graphics.print("Select a seed to plant (click):", px + 25, y + 5)
        local sx = px + 25
        local sy = y + 25
        if resources then
            for seedType, seedName in pairs(SEED_NAMES) do
                local amt = resources[seedType] or 0
                if amt > 0 then
                    love.graphics.setColor(0.7, 0.85, 0.6)
                    love.graphics.print(seedName .. " x" .. amt, sx, sy)
                    sx = sx + 150
                    if sx > px + pw - 160 then
                        sx = px + 25
                        sy = sy + 18
                    end
                end
            end
        end
    end
end

function game._drawAnimalsTab(px, cy, pw, ch)
    love.graphics.setFont(fonts.main)
    local animals = ui.farmAnimals
    local y = cy + 5

    if #animals == 0 then
        love.graphics.setColor(0.5, 0.6, 0.5)
        love.graphics.printf("No animals yet. Place an Animal Pen, then buy animals from the Rancher shop.", px + 20, y, pw - 40, "center")
        return
    end

    -- Header
    love.graphics.setColor(0.4, 0.8, 0.3)
    love.graphics.print("Pen", px + 20, y)
    love.graphics.print("Animal", px + 80, y)
    love.graphics.print("Name", px + 180, y)
    love.graphics.print("Happy", px + 310, y)
    love.graphics.print("Products", px + 400, y)
    y = y + 22
    love.graphics.setColor(0.3, 0.4, 0.25, 0.5)
    love.graphics.rectangle("fill", px + 15, y, pw - 30, 1)
    y = y + 5

    for i, pen in ipairs(animals) do
        if pen.animals then
            for j, ani in ipairs(pen.animals) do
                if y > cy + ch - 20 then break end
                love.graphics.setColor(0.6, 0.7, 0.6)
                love.graphics.print("#" .. i, px + 20, y)

                love.graphics.setColor(0.8, 0.9, 0.7)
                love.graphics.print(ANIMAL_NAMES[ani.animalType] or ani.animalType, px + 80, y)

                love.graphics.setColor(0.7, 0.8, 0.9)
                love.graphics.print(ani.name or "-", px + 180, y)

                -- Happiness bar
                local hap = ani.happiness or 0
                local hapCol = hap >= 50 and {0.3, 0.8, 0.3} or (hap >= 25 and {0.8, 0.7, 0.2} or {0.8, 0.3, 0.2})
                local barX, barW = px + 310, 70
                love.graphics.setColor(0.15, 0.2, 0.1)
                love.graphics.rectangle("fill", barX, y + 2, barW, 12, 3, 3)
                love.graphics.setColor(hapCol)
                love.graphics.rectangle("fill", barX, y + 2, barW * (hap / 100), 12, 3, 3)
                love.graphics.setColor(0.9, 0.9, 0.9)
                love.graphics.setFont(fonts.small)
                love.graphics.printf(hap .. "%", barX, y + 1, barW, "center")
                love.graphics.setFont(fonts.main)

                -- Pending products
                local prodStr = ""
                if ani.pendingProducts and #ani.pendingProducts > 0 then
                    for _, prod in ipairs(ani.pendingProducts) do
                        if prodStr ~= "" then prodStr = prodStr .. ", " end
                        prodStr = prodStr .. (prod.type or "?") .. " x" .. (prod.amount or 1)
                    end
                    love.graphics.setColor(0.9, 0.85, 0.4)
                else
                    prodStr = "-"
                    love.graphics.setColor(0.5, 0.5, 0.5)
                end
                love.graphics.print(prodStr, px + 400, y)

                y = y + 22
            end
        end
    end

    -- Hint
    love.graphics.setColor(0.4, 0.5, 0.4)
    love.graphics.setFont(fonts.small)
    love.graphics.printf("[E] near pen to feed/collect", px + 15, cy + ch - 18, pw - 30, "center")
end

function game._drawBuildTab(px, cy, pw, ch)
    love.graphics.setFont(fonts.main)
    local y = cy + 5

    love.graphics.setColor(0.4, 0.8, 0.3)
    love.graphics.print("Farming Structures", px + 20, y)
    y = y + 22

    local buildItems = {
        {name = "Crop Plot", desc = "Plant crops here (craft from wood + stone)"},
        {name = "Garden Bed", desc = "Enhanced crop plot (craft from wood + fertilizer)"},
        {name = "Animal Pen", desc = "House animals (craft from wood + iron bar)"},
        {name = "Water Trough", desc = "Water source for crops (200px range)"},
        {name = "Well", desc = "Large water source (400px range)"},
        {name = "Scarecrow", desc = "Prevents crop withering (15% per scarecrow)"},
        {name = "Sprinkler", desc = "Auto-waters crops within 150px"},
    }

    for _, item in ipairs(buildItems) do
        if y > cy + ch - 20 then break end
        love.graphics.setColor(0.7, 0.85, 0.6)
        love.graphics.print(item.name, px + 25, y)
        love.graphics.setColor(0.5, 0.6, 0.5)
        love.graphics.print(item.desc, px + 180, y)
        y = y + 20
    end

    y = y + 15
    love.graphics.setColor(0.4, 0.8, 0.3)
    love.graphics.print("Furniture Effects", px + 20, y)
    y = y + 22

    local furnitureItems = {
        {name = "Bed", desc = "Sleep to gain +2 VIG, +10% XP for 10min"},
        {name = "Bookshelf", desc = "+5% all skill XP on plot (stacks 3x)"},
        {name = "Lantern", desc = "-10% night penalty on plot (stacks 6x)"},
        {name = "Clock", desc = "+5% crop growth speed"},
        {name = "Trophy Mount", desc = "+1 Presence per trophy (max 5)"},
    }

    for _, item in ipairs(furnitureItems) do
        if y > cy + ch - 20 then break end
        love.graphics.setColor(0.7, 0.8, 0.9)
        love.graphics.print(item.name, px + 25, y)
        love.graphics.setColor(0.5, 0.55, 0.6)
        love.graphics.print(item.desc, px + 180, y)
        y = y + 20
    end

    love.graphics.setColor(0.4, 0.5, 0.4)
    love.graphics.setFont(fonts.small)
    love.graphics.printf("Open Inventory [I] > Crafting to build structures", px + 15, cy + ch - 18, pw - 30, "center")
end

function game.handleFarmingClick(mx, my)
    local W, H = love.graphics.getDimensions()
    local pw = math.min(700, W - 40)
    local ph = math.min(520, H - 60)
    local px = (W - pw) / 2
    local py = (H - ph) / 2

    -- Outside panel = close
    if mx < px or mx > px + pw or my < py or my > py + ph then
        ui.showFarming = false
        ui.farmingPlotId = nil
        return true
    end

    -- Tab clicks
    local tabY = py + 40
    local tabW = math.floor((pw - 30) / #FARMING_TABS)
    if my >= tabY and my <= tabY + 30 then
        for i, tab in ipairs(FARMING_TABS) do
            local tx = px + 15 + (i - 1) * tabW
            if mx >= tx and mx <= tx + tabW - 4 then
                ui.farmingTab = tab
                return true
            end
        end
    end

    -- Seed selection when a plot is selected (crops tab)
    if ui.farmingTab == "crops" and ui.farmingPlotId and resources then
        local contentY = tabY + 40
        local contentH = ph - (contentY - py) - 10
        local seedY = math.max(contentY + (#ui.farmCrops * 22) + 50, contentY + contentH - 80)
        if my >= seedY + 25 then
            local sx = px + 25
            local sy = seedY + 25
            for seedType, seedName in pairs(SEED_NAMES) do
                local amt = resources[seedType] or 0
                if amt > 0 then
                    local tw = 150
                    if mx >= sx and mx <= sx + tw and my >= sy and my <= sy + 18 then
                        if client then
                            client:emit("plant_seed", { cropPlotId = ui.farmingPlotId, seedType = seedType })
                            ui.farmingPlotId = nil
                        end
                        return true
                    end
                    sx = sx + 150
                    if sx > px + pw - 160 then
                        sx = px + 25
                        sy = sy + 18
                    end
                end
            end
        end
    end

    return true -- consume click within panel
end

-- ---------------------------------------------------------------------------
-- Knowledge Panel
-- ---------------------------------------------------------------------------

-- Rarity colors for books
local RARITY_COLORS = {
    common = {0.6, 0.6, 0.6},
    uncommon = {0.13, 0.8, 0.13},
    rare = {0.2, 0.53, 1},
    ultra_rare = {0.67, 0.27, 1},
    mythic_rare = {1, 0.67, 0},
    legendary = {1, 0.4, 0},
    godly = {1, 0, 0},
    relic = {1, 1, 1},
}

local KNOWLEDGE_TABS = {"glossary", "lore", "books", "codex"}
local KNOWLEDGE_TAB_LABELS = {glossary = "Glossary", lore = "Lore", books = "Books", codex = "Codex"}

function game.drawKnowledgePanel(W, H)
    local pw = math.min(750, W - 40)
    local ph = math.min(580, H - 60)
    local px = (W - pw) / 2
    local py = (H - ph) / 2

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.06, 0.07, 0.12, 0.95)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    love.graphics.setColor(0.35, 0.4, 0.65, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.8, 0.75, 0.4, 1)
    love.graphics.printf("Knowledge", px, py + 10, pw, "center")

    -- Tab buttons
    local tabW = (pw - 40) / #KNOWLEDGE_TABS
    local tabY = py + 42
    love.graphics.setFont(fonts.ui)
    for i, tabId in ipairs(KNOWLEDGE_TABS) do
        local tx = px + 20 + (i - 1) * tabW
        local isActive = knowledge.tab == tabId
        if isActive then
            love.graphics.setColor(0.25, 0.28, 0.45, 1)
        else
            love.graphics.setColor(0.12, 0.13, 0.2, 1)
        end
        love.graphics.rectangle("fill", tx, tabY, tabW - 4, 28, 4, 4)
        if isActive then
            love.graphics.setColor(0.7, 0.8, 1, 1)
        else
            love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
        end
        love.graphics.printf(KNOWLEDGE_TAB_LABELS[tabId] or tabId, tx, tabY + 6, tabW - 4, "center")
    end

    -- Content area
    local contentY = tabY + 36
    local contentH = ph - (contentY - py) - 10

    -- Scissor to clip scrollable content
    love.graphics.setScissor(px + 5, contentY, pw - 10, contentH)

    if knowledge.tab == "glossary" then
        game.drawKnowledgeGlossary(px, contentY, pw, contentH)
    elseif knowledge.tab == "lore" then
        game.drawKnowledgeLore(px, contentY, pw, contentH)
    elseif knowledge.tab == "books" then
        game.drawKnowledgeBooks(px, contentY, pw, contentH)
    elseif knowledge.tab == "codex" then
        game.drawKnowledgeCodex(px, contentY, pw, contentH)
    end

    love.graphics.setScissor()

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.5, 0.6)
    love.graphics.printf("B to close | Scroll to navigate", px, py + ph - 16, pw, "center")
end

function game.drawKnowledgeGlossary(px, cy, pw, ch)
    local terms = knowledge.glossaryTerms
    local unlocked = knowledge.glossaryUnlocked or {}
    if not terms then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.5, 0.8)
        love.graphics.printf("Loading glossary...", px, cy + 20, pw, "center")
        return
    end

    -- Build unlocked set for fast lookup
    local unlockedSet = {}
    for _, id in ipairs(unlocked) do unlockedSet[id] = true end

    local y = cy + 5 - knowledge.scrollY
    love.graphics.setFont(fonts.ui)

    -- Category filter header
    love.graphics.setColor(0.6, 0.65, 0.8, 0.9)
    love.graphics.printf("Filter: " .. (knowledge.glossaryFilter == "all" and "All" or knowledge.glossaryFilter), px + 15, y, pw - 30, "left")
    y = y + 22

    -- Group terms by category
    local categories = {}
    local catOrder = {}
    for _, t in ipairs(terms) do
        if knowledge.glossaryFilter == "all" or t.category == knowledge.glossaryFilter then
            if not categories[t.category] then
                categories[t.category] = {}
                table.insert(catOrder, t.category)
            end
            table.insert(categories[t.category], t)
        end
    end
    table.sort(catOrder)

    for _, cat in ipairs(catOrder) do
        if y + 20 > cy - 20 and y < cy + ch + 20 then
            love.graphics.setFont(fonts.ui)
            love.graphics.setColor(0.6, 0.75, 1, 0.9)
            local catLabel = cat:sub(1, 1):upper() .. cat:sub(2)
            love.graphics.print("-- " .. catLabel .. " --", px + 15, y)
        end
        y = y + 22

        for _, term in ipairs(categories[cat]) do
            local isUnlocked = unlockedSet[term.id]
            if y + 40 > cy - 20 and y < cy + ch + 20 then
                if isUnlocked then
                    love.graphics.setFont(fonts.ui)
                    love.graphics.setColor(0.9, 0.85, 0.5, 1)
                    love.graphics.print(term.term, px + 25, y)
                    love.graphics.setFont(fonts.small)
                    love.graphics.setColor(0.75, 0.75, 0.8, 0.9)
                    love.graphics.printf(term.definition, px + 25, y + 16, pw - 55, "left")
                    -- Calculate wrapped text height
                    local font = fonts.small
                    local _, wraps = font:getWrap(term.definition, pw - 55)
                    y = y + 18 + #wraps * font:getHeight()
                else
                    love.graphics.setFont(fonts.ui)
                    love.graphics.setColor(0.35, 0.35, 0.4, 0.7)
                    love.graphics.print("???", px + 25, y)
                    love.graphics.setFont(fonts.small)
                    love.graphics.setColor(0.3, 0.3, 0.35, 0.6)
                    love.graphics.print("[Undiscovered]", px + 25, y + 16)
                    y = y + 34
                end
            else
                -- Skip rendering but still advance y
                if isUnlocked then
                    local font = fonts.small
                    local _, wraps = font:getWrap(term.definition, pw - 55)
                    y = y + 18 + #wraps * font:getHeight()
                else
                    y = y + 34
                end
            end
            y = y + 4
        end
        y = y + 6
    end
end

function game.drawKnowledgeLore(px, cy, pw, ch)
    local data = knowledge.loreData
    if not data then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.5, 0.8)
        love.graphics.printf("Loading lore...", px, cy + 20, pw, "center")
        return
    end

    -- Sub-tabs: timeline, races, factions, geography
    local subTabs = {"timeline", "races", "factions", "geography"}
    local subLabels = {timeline = "Timeline", races = "Races", factions = "Factions", geography = "Geography"}
    local stW = (pw - 40) / #subTabs
    local stY = cy + 3
    love.graphics.setFont(fonts.small)
    for i, st in ipairs(subTabs) do
        local sx = px + 20 + (i - 1) * stW
        local isActive = knowledge.loreSubTab == st
        if isActive then
            love.graphics.setColor(0.2, 0.22, 0.35, 0.9)
        else
            love.graphics.setColor(0.1, 0.1, 0.15, 0.7)
        end
        love.graphics.rectangle("fill", sx, stY, stW - 3, 22, 3, 3)
        love.graphics.setColor(isActive and {0.8, 0.85, 1, 1} or {0.45, 0.45, 0.5, 0.7})
        love.graphics.printf(subLabels[st], sx, stY + 4, stW - 3, "center")
    end

    local y = stY + 30 - knowledge.scrollY

    if knowledge.loreSubTab == "timeline" and data.timeline then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.8, 0.75, 0.4, 1)
        love.graphics.print("World Timeline", px + 15, y)
        y = y + 24
        love.graphics.setFont(fonts.small)
        for _, entry in ipairs(data.timeline) do
            if y > cy - 40 and y < cy + ch + 40 then
                love.graphics.setColor(0.5, 0.7, 1, 0.9)
                local yearStr = entry.year < 0 and ("Y" .. entry.year) or ("Year " .. entry.year)
                love.graphics.print(yearStr, px + 15, y)
                love.graphics.setColor(0.85, 0.82, 0.7, 1)
                love.graphics.print(entry.title or "", px + 90, y)
                y = y + 16
                love.graphics.setColor(0.6, 0.6, 0.65, 0.8)
                love.graphics.printf(entry.description or "", px + 25, y, pw - 55, "left")
                local font = fonts.small
                local _, wraps = font:getWrap(entry.description or "", pw - 55)
                y = y + #wraps * font:getHeight() + 8
            else
                local font = fonts.small
                local _, wraps = font:getWrap(entry.description or "", pw - 55)
                y = y + 16 + #wraps * font:getHeight() + 8
            end
        end
    elseif knowledge.loreSubTab == "races" and data.races then
        love.graphics.setFont(fonts.ui)
        for raceId, race in pairs(data.races) do
            if y > cy - 60 and y < cy + ch + 60 then
                love.graphics.setColor(0.9, 0.8, 0.3, 1)
                love.graphics.setFont(fonts.ui)
                love.graphics.print((race.name or raceId) .. " — " .. (race.title or ""), px + 15, y)
                y = y + 20
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.7, 0.7, 0.75, 0.9)
                love.graphics.printf(race.summary or "", px + 25, y, pw - 55, "left")
                local font = fonts.small
                local _, wraps = font:getWrap(race.summary or "", pw - 55)
                y = y + #wraps * font:getHeight() + 12
            else
                local font = fonts.small
                local _, wraps = font:getWrap(race.summary or "", pw - 55)
                y = y + 20 + #wraps * font:getHeight() + 12
            end
        end
    elseif knowledge.loreSubTab == "factions" and data.factions then
        love.graphics.setFont(fonts.ui)
        for fId, fac in pairs(data.factions) do
            if y > cy - 60 and y < cy + ch + 60 then
                love.graphics.setColor(0.7, 0.8, 1, 1)
                love.graphics.setFont(fonts.ui)
                love.graphics.print(fac.name or fId, px + 15, y)
                y = y + 20
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.65, 0.65, 0.7, 0.9)
                love.graphics.printf(fac.summary or fac.purpose or "", px + 25, y, pw - 55, "left")
                local font = fonts.small
                local _, wraps = font:getWrap(fac.summary or fac.purpose or "", pw - 55)
                y = y + #wraps * font:getHeight() + 12
            else
                local font = fonts.small
                local _, wraps = font:getWrap(fac.summary or fac.purpose or "", pw - 55)
                y = y + 20 + #wraps * font:getHeight() + 12
            end
        end
    elseif knowledge.loreSubTab == "geography" and data.geography then
        love.graphics.setFont(fonts.ui)
        for _, geo in ipairs(data.geography) do
            if y > cy - 60 and y < cy + ch + 60 then
                love.graphics.setColor(0.5, 0.8, 0.5, 1)
                love.graphics.setFont(fonts.ui)
                love.graphics.print(geo.name or "", px + 15, y)
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.5, 0.55, 0.5, 0.7)
                love.graphics.print(geo.terrain or "", px + 200, y + 2)
                y = y + 20
                love.graphics.setColor(0.65, 0.65, 0.7, 0.9)
                love.graphics.printf(geo.description or "", px + 25, y, pw - 55, "left")
                local font = fonts.small
                local _, wraps = font:getWrap(geo.description or "", pw - 55)
                y = y + #wraps * font:getHeight() + 12
            else
                local font = fonts.small
                local _, wraps = font:getWrap(geo.description or "", pw - 55)
                y = y + 20 + #wraps * font:getHeight() + 12
            end
        end
    end
end

function game.drawKnowledgeBooks(px, cy, pw, ch)
    -- If reading a book, show full content
    if knowledge.bookContent then
        local bc = knowledge.bookContent
        local y = cy + 5 - knowledge.scrollY

        -- Back button hint
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.5, 0.5, 0.6, 0.7)
        love.graphics.print("Right-click or press Escape to go back", px + 15, y)
        y = y + 20

        -- Title
        love.graphics.setFont(fonts.title)
        local rc = RARITY_COLORS[bc.rarity] or {0.6, 0.6, 0.6}
        love.graphics.setColor(rc[1], rc[2], rc[3], 1)
        love.graphics.printf(bc.title or "Untitled", px + 15, y, pw - 30, "center")
        y = y + 30

        -- Author
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
        love.graphics.printf("by " .. (bc.author or "Unknown"), px + 15, y, pw - 30, "center")
        y = y + 24

        if bc.dangerous then
            love.graphics.setColor(1, 0.3, 0.3, 0.9)
            love.graphics.printf("[FORBIDDEN KNOWLEDGE]", px + 15, y, pw - 30, "center")
            y = y + 20
        end

        -- Content
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.8, 0.78, 0.7, 1)
        love.graphics.printf(bc.content or "", px + 20, y, pw - 45, "left")
        return
    end

    local bks = knowledge.books
    if not bks then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.5, 0.8)
        love.graphics.printf("Loading books...", px, cy + 20, pw, "center")
        return
    end

    if #bks == 0 then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.5, 0.8)
        love.graphics.printf("No books discovered yet.\nExplore dungeons to find books in chests and boss loot.", px + 15, cy + 30, pw - 30, "center")
        return
    end

    local y = cy + 5 - knowledge.scrollY
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.7, 0.7, 0.8, 0.9)
    love.graphics.print("Discovered Books (" .. #bks .. ")", px + 15, y)
    y = y + 24

    for idx, bk in ipairs(bks) do
        if y > cy - 30 and y < cy + ch + 30 then
            -- Book entry
            local rc = RARITY_COLORS[bk.rarity] or {0.6, 0.6, 0.6}
            love.graphics.setColor(0.1, 0.11, 0.18, 0.8)
            love.graphics.rectangle("fill", px + 12, y, pw - 24, 36, 4, 4)
            love.graphics.setColor(rc[1], rc[2], rc[3], 0.6)
            love.graphics.rectangle("line", px + 12, y, pw - 24, 36, 4, 4)

            love.graphics.setFont(fonts.ui)
            love.graphics.setColor(rc[1], rc[2], rc[3], 1)
            love.graphics.print(bk.title or "Untitled", px + 20, y + 3)

            love.graphics.setFont(fonts.small)
            love.graphics.setColor(0.55, 0.55, 0.6, 0.7)
            local meta = (bk.category or "") .. " | " .. (bk.rarity or "")
            if bk.dangerous then meta = meta .. " | FORBIDDEN" end
            if bk.partOfCodex then meta = meta .. " | CODEX" end
            love.graphics.print(meta, px + 20, y + 20)
        end
        y = y + 42
    end
end

function game.drawKnowledgeCodex(px, cy, pw, ch)
    local cdx = knowledge.codex
    if not cdx then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.5, 0.8)
        love.graphics.printf("Loading codex...", px, cy + 20, pw, "center")
        return
    end

    local y = cy + 10 - knowledge.scrollY

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.9, 0.7, 0.2, 1)
    love.graphics.printf("The Vel'sharath Covenant", px, y, pw, "center")
    y = y + 32

    -- Progress bar
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.6, 0.6, 0.7, 0.9)
    love.graphics.printf("Fragments: " .. (cdx.fragmentsFound or 0) .. " / " .. (cdx.fragmentsTotal or 7), px, y, pw, "center")
    y = y + 24

    local barW = pw - 80
    local barX = px + 40
    love.graphics.setColor(0.15, 0.15, 0.2, 1)
    love.graphics.rectangle("fill", barX, y, barW, 14, 3, 3)
    local fill = cdx.fragmentsTotal > 0 and (cdx.fragmentsFound / cdx.fragmentsTotal) or 0
    love.graphics.setColor(0.8, 0.6, 0.1, 0.9)
    love.graphics.rectangle("fill", barX, y, barW * fill, 14, 3, 3)
    y = y + 24

    -- Fragment list
    if cdx.fragments then
        love.graphics.setFont(fonts.ui)
        for _, frag in ipairs(cdx.fragments) do
            if frag.found then
                love.graphics.setColor(0.8, 0.75, 0.3, 1)
                love.graphics.print("[Found] " .. (frag.id or ""), px + 30, y)
            else
                love.graphics.setColor(0.35, 0.35, 0.4, 0.6)
                love.graphics.print("[???] Undiscovered fragment", px + 30, y)
            end
            y = y + 22
        end
    end
    y = y + 10

    -- Assembled codex text
    if cdx.isComplete and cdx.assembledCodex then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(1, 0.85, 0.2, 1)
        love.graphics.printf("CODEX ASSEMBLED", px, y, pw, "center")
        y = y + 26
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.85, 0.8, 0.65, 1)
        love.graphics.printf(cdx.assembledCodex.content or "", px + 20, y, pw - 45, "left")
    elseif not cdx.isComplete then
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.4, 0.4, 0.5, 0.7)
        love.graphics.printf("Collect all 7 fragments from deep within the Rift to assemble the covenant...", px + 20, y, pw - 45, "center")
    end
end

-- Knowledge discovery game._notifications (floating popups)
function game.drawKnowledgeNotifications(W, H)
    if #knowledge.notifications == 0 then return end

    local ny = 80
    for _, notif in ipairs(knowledge.notifications) do
        local alpha = math.min(1, notif.timer / 0.5)  -- fade out in last 0.5s
        if notif.type == "book" then
            local rc = RARITY_COLORS[notif.rarity] or {0.6, 0.6, 0.6}
            love.graphics.setColor(0.05, 0.06, 0.1, 0.85 * alpha)
            love.graphics.rectangle("fill", W - 310, ny, 300, 40, 6, 6)
            love.graphics.setColor(rc[1], rc[2], rc[3], 0.7 * alpha)
            love.graphics.rectangle("line", W - 310, ny, 300, 40, 6, 6)
            love.graphics.setFont(fonts.small)
            love.graphics.setColor(rc[1], rc[2], rc[3], alpha)
            love.graphics.print("Book Discovered!", W - 300, ny + 4)
            love.graphics.setFont(fonts.ui)
            love.graphics.setColor(1, 1, 1, alpha)
            love.graphics.printf(notif.title, W - 300, ny + 18, 280, "left")
        elseif notif.type == "term" then
            love.graphics.setColor(0.05, 0.06, 0.1, 0.85 * alpha)
            love.graphics.rectangle("fill", W - 310, ny, 300, 30, 6, 6)
            love.graphics.setColor(0.4, 0.5, 0.8, 0.7 * alpha)
            love.graphics.rectangle("line", W - 310, ny, 300, 30, 6, 6)
            love.graphics.setFont(fonts.small)
            love.graphics.setColor(0.7, 0.8, 1, alpha)
            love.graphics.print("Glossary Unlocked: " .. (notif.term or ""), W - 300, ny + 8)
        end
        ny = ny + 46
    end
end

-- Handle knowledge panel mouse clicks and scrolling
function game.handleKnowledgeClick(mx, my, button)
    if not ui.showKnowledge then return false end

    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()
    local pw = math.min(750, W - 40)
    local ph = math.min(580, H - 60)
    local px = (W - pw) / 2
    local py = (H - ph) / 2

    -- Outside panel = close
    if mx < px or mx > px + pw or my < py or my > py + ph then
        ui.showKnowledge = false
        return true
    end

    -- Right-click while reading a book = go back
    if button == 2 and knowledge.bookContent then
        knowledge.bookContent = nil
        knowledge.scrollY = 0
        return true
    end

    -- Tab buttons
    local tabW = (pw - 40) / #KNOWLEDGE_TABS
    local tabY = py + 42
    for i, tabId in ipairs(KNOWLEDGE_TABS) do
        local tx = px + 20 + (i - 1) * tabW
        if mx >= tx and mx <= tx + tabW - 4 and my >= tabY and my <= tabY + 28 then
            knowledge.tab = tabId
            knowledge.scrollY = 0
            knowledge.bookContent = nil
            if client then
                client:emit("knowledge_get", { tab = tabId })
            end
            return true
        end
    end

    -- Lore sub-tabs
    if knowledge.tab == "lore" then
        local subTabs = {"timeline", "races", "factions", "geography"}
        local stW = (pw - 40) / #subTabs
        local contentY = tabY + 36
        local stY = contentY + 3
        for i, st in ipairs(subTabs) do
            local sx = px + 20 + (i - 1) * stW
            if mx >= sx and mx <= sx + stW - 3 and my >= stY and my <= stY + 22 then
                knowledge.loreSubTab = st
                knowledge.scrollY = 0
                return true
            end
        end
    end

    -- Book click: open book for reading
    if knowledge.tab == "books" and not knowledge.bookContent and knowledge.books and button == 1 then
        local contentY = tabY + 36
        local bkY = contentY + 5 - knowledge.scrollY + 24  -- offset by header
        for _, bk in ipairs(knowledge.books) do
            if my >= bkY and my <= bkY + 36 and mx >= px + 12 and mx <= px + pw - 12 then
                knowledge.scrollY = 0
                if client then
                    client:emit("knowledge_read_book", { bookId = bk.id })
                end
                return true
            end
            bkY = bkY + 42
        end
    end

    -- Glossary category filter click (click on "Filter:" label cycles)
    if knowledge.tab == "glossary" and button == 1 then
        local contentY = tabY + 36
        local filterY = contentY + 5 - knowledge.scrollY
        if my >= filterY and my <= filterY + 20 and mx >= px + 15 and mx <= px + 200 then
            local cats = {"all", "combat", "cards", "skills", "races", "world", "economy", "housing", "dungeons", "crafting", "factions"}
            local cur = knowledge.glossaryFilter
            for ci = 1, #cats do
                if cats[ci] == cur then
                    knowledge.glossaryFilter = cats[(ci % #cats) + 1]
                    knowledge.scrollY = 0
                    break
                end
            end
            return true
        end
    end

    return true  -- consume click (panel is open)
end

-- ---------------------------------------------------------------------------
-- Permadeath UI: Bleedout Overlay
-- ---------------------------------------------------------------------------

function game.drawBleedoutOverlay(W, H)
    -- Red pulsing vignette
    local pulse = 0.3 + 0.15 * math.sin(love.timer.getTime() * 3)
    love.graphics.setColor(0.5, 0, 0, pulse)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Dark center overlay
    love.graphics.setColor(0, 0, 0, 0.5)
    love.graphics.rectangle("fill", W/2 - 200, H/2 - 80, 400, 160, 8, 8)
    love.graphics.setColor(0.8, 0.2, 0.2, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", W/2 - 200, H/2 - 80, 400, 160, 8, 8)
    love.graphics.setLineWidth(1)

    -- "DOWNED" text
    love.graphics.setFont(fonts.ui or fonts.main)
    love.graphics.setColor(1, 0.2, 0.2, 1)
    love.graphics.printf("DOWNED", 0, H/2 - 65, W, "center")

    -- Timer
    local secs = math.ceil(permadeath.bleedoutTimer)
    local mins = math.floor(secs / 60)
    local remSecs = secs % 60
    love.graphics.setFont(fonts.main or fonts.chat)
    love.graphics.setColor(1, 0.8, 0.3, 1)
    love.graphics.printf(string.format("Bleedout: %d:%02d", mins, remSecs), 0, H/2 - 35, W, "center")

    -- Cause of death
    love.graphics.setColor(0.8, 0.6, 0.6, 0.9)
    love.graphics.printf(permadeath.causeOfDeath or "", 0, H/2 - 10, W, "center")

    -- Rescue prompt
    love.graphics.setColor(0.7, 0.9, 0.7, 0.7 + 0.3 * math.sin(love.timer.getTime() * 2))
    love.graphics.printf("Waiting for rescue...", 0, H/2 + 20, W, "center")
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("Another player can revive you by pressing E nearby", 0, H/2 + 45, W, "center")
end

-- ---------------------------------------------------------------------------
-- Permadeath UI: Death Epitaph Screen
-- ---------------------------------------------------------------------------

function game.drawPermaDeathScreen(W, H)
    -- Full black overlay
    love.graphics.setColor(0, 0, 0, 0.9)
    love.graphics.rectangle("fill", 0, 0, W, H)

    local hero = permadeath.deathHero
    if not hero then
        love.graphics.setFont(fonts.ui or fonts.main)
        love.graphics.setColor(0.8, 0.2, 0.2, 1)
        love.graphics.printf("PERMADEATH", 0, H/2 - 40, W, "center")
        love.graphics.setFont(fonts.main or fonts.chat)
        love.graphics.setColor(0.7, 0.7, 0.7, 0.8)
        love.graphics.printf("Press Enter to continue", 0, H/2 + 20, W, "center")
        return
    end

    -- Ornamental border
    love.graphics.setColor(0.4, 0.2, 0.2, 0.6)
    love.graphics.setLineWidth(3)
    love.graphics.rectangle("line", 60, 40, W - 120, H - 80, 10, 10)
    love.graphics.setLineWidth(1)

    -- "REST IN PEACE" header
    love.graphics.setFont(fonts.ui or fonts.main)
    love.graphics.setColor(0.9, 0.7, 0.3, 1)
    love.graphics.printf("REST IN PEACE", 0, 70, W, "center")

    -- Hero name
    love.graphics.setColor(1, 0.9, 0.7, 1)
    love.graphics.printf(hero.name or "Unknown Hero", 0, 110, W, "center")

    -- Race + Level
    love.graphics.setFont(fonts.main or fonts.chat)
    love.graphics.setColor(0.7, 0.7, 0.8, 0.9)
    local raceStr = (hero.race or "Unknown") .. "  |  Level " .. (hero.level or 1)
    love.graphics.printf(raceStr, 0, 145, W, "center")

    -- Cause of death
    love.graphics.setColor(0.9, 0.3, 0.3, 1)
    love.graphics.printf(hero.causeOfDeath or "Fell in the dungeon", 0, 180, W, "center")

    -- Dungeon info
    love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
    local dungeonInfo = ""
    if hero.dungeonId then dungeonInfo = hero.dungeonId end
    if hero.floorNum then dungeonInfo = dungeonInfo .. "  Floor " .. hero.floorNum end
    love.graphics.printf(dungeonInfo, 0, 210, W, "center")

    -- Stats
    local dp = hero.dungeonProgress or {}
    love.graphics.setColor(0.6, 0.7, 0.6, 0.8)
    local statsY = 250
    love.graphics.printf("Enemies Slain: " .. (dp.totalKills or 0), 0, statsY, W, "center")
    love.graphics.printf("Bosses Defeated: " .. (dp.bossesKilled or 0), 0, statsY + 22, W, "center")
    love.graphics.printf("Deepest Floor: " .. (dp.deepestFloor or 0), 0, statsY + 44, W, "center")
    love.graphics.printf("Guild Rank: " .. (dp.guildRank or "Stone"), 0, statsY + 66, W, "center")

    -- Coins
    love.graphics.setColor(0.9, 0.8, 0.3, 0.8)
    love.graphics.printf("Coins Lost: " .. (hero.chips or 0), 0, statsY + 100, W, "center")

    -- Continue button
    local pulse = 0.6 + 0.4 * math.sin(love.timer.getTime() * 2)
    love.graphics.setColor(0.7, 0.7, 0.7, pulse)
    love.graphics.printf("Press Enter to continue", 0, H - 100, W, "center")

    if not permadeath.hasCharsLeft then
        love.graphics.setColor(0.9, 0.6, 0.2, 0.8)
        love.graphics.printf("No characters remaining — you will create a new one", 0, H - 70, W, "center")
    end
end

-- ---------------------------------------------------------------------------
-- Permadeath UI: Hall of Heroes (in-game)
-- ---------------------------------------------------------------------------

function game.drawHallOfHeroes(W, H)
    local dlgW = 500
    local dlgH = 420
    local dlgX = (W - dlgW) / 2
    local dlgY = (H - dlgH) / 2

    -- Dim overlay
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel bg
    love.graphics.setColor(0.08, 0.06, 0.12, 0.95)
    love.graphics.rectangle("fill", dlgX, dlgY, dlgW, dlgH, 8, 8)
    love.graphics.setColor(0.6, 0.3, 0.6, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", dlgX, dlgY, dlgW, dlgH, 8, 8)
    love.graphics.setLineWidth(1)

    -- Title
    love.graphics.setFont(fonts.ui or fonts.main)
    love.graphics.setColor(0.9, 0.7, 0.3, 1)
    love.graphics.printf("Hall of Heroes", dlgX, dlgY + 12, dlgW, "center")

    love.graphics.setFont(fonts.chat or fonts.main)
    love.graphics.setColor(0.6, 0.5, 0.7, 0.8)
    love.graphics.printf("Fallen permadeath characters memorialized here", dlgX, dlgY + 38, dlgW, "center")

    local heroes = permadeath.hallOfHeroesList
    if #heroes == 0 then
        love.graphics.setFont(fonts.main or fonts.chat)
        love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
        love.graphics.printf("No fallen heroes yet.", dlgX, dlgY + 120, dlgW, "center")
    else
        local entryH = 60
        local listY = dlgY + 60
        local maxVisible = math.floor((dlgH - 85) / entryH)
        for i = 1, math.min(#heroes, maxVisible) do
            local hero = heroes[#heroes - i + 1] -- newest first
            local ey = listY + (i - 1) * entryH

            love.graphics.setColor(0.12, 0.1, 0.16, 0.8)
            love.graphics.rectangle("fill", dlgX + 10, ey, dlgW - 20, entryH - 4, 4, 4)

            love.graphics.setFont(fonts.main or fonts.chat)
            love.graphics.setColor(0.9, 0.8, 0.6, 1)
            love.graphics.print((hero.name or "Unknown") .. "  Lv." .. (hero.level or 1), dlgX + 20, ey + 4)

            love.graphics.setFont(fonts.chat or fonts.main)
            love.graphics.setColor(0.7, 0.6, 0.8, 0.9)
            love.graphics.print(hero.race or "Unknown", dlgX + 20, ey + 22)

            love.graphics.setColor(0.8, 0.3, 0.3, 0.9)
            love.graphics.print(hero.causeOfDeath or "Unknown", dlgX + 120, ey + 22)

            love.graphics.setColor(0.5, 0.5, 0.6, 0.7)
            local floorInfo = ""
            if hero.dungeonId then floorInfo = hero.dungeonId end
            if hero.floorNum then floorInfo = floorInfo .. " F" .. hero.floorNum end
            love.graphics.print(floorInfo, dlgX + 20, ey + 38)

            local dp = hero.dungeonProgress or {}
            love.graphics.setColor(0.5, 0.6, 0.5, 0.7)
            love.graphics.print("Kills: " .. (dp.totalKills or 0) .. "  Bosses: " .. (dp.bossesKilled or 0), dlgX + 200, ey + 38)
        end
    end

    -- Close hint
    love.graphics.setFont(fonts.chat or fonts.main)
    love.graphics.setColor(0.5, 0.5, 0.5, 0.6)
    love.graphics.printf("Press ESC or H to close", dlgX, dlgY + dlgH - 20, dlgW, "center")
end

-- =========================================================================
-- Karma HUD (small indicator, always visible)
-- =========================================================================
function game.drawKarmaHUD(W, H)
    if not zone then return end
    local font = fonts.chat or fonts.main or _G.getFont(12)
    love.graphics.setFont(font)

    local x = 10
    local y = H - 40
    local barW = 100
    local barH = 8

    -- Karma label + value
    local kVal = game._karma.karma or 0
    local kColor
    if kVal > 20 then kColor = {0.3, 0.9, 0.4}
    elseif kVal < -20 then kColor = {0.9, 0.3, 0.3}
    else kColor = {0.7, 0.7, 0.7} end

    love.graphics.setColor(kColor[1], kColor[2], kColor[3], 0.9)
    love.graphics.print("Karma: " .. math.floor(kVal), x, y - 14)

    -- Bar background
    love.graphics.setColor(0.15, 0.15, 0.2, 0.7)
    love.graphics.rectangle("fill", x, y, barW, barH, 3, 3)

    -- Bar fill (centered at 50, positive goes right, negative goes left)
    local mid = barW / 2
    local fillW = math.abs(kVal) / 100 * mid
    if kVal > 0 then
        love.graphics.setColor(0.3, 0.8, 0.4, 0.8)
        love.graphics.rectangle("fill", x + mid, y, fillW, barH, 0, 3)
    elseif kVal < 0 then
        love.graphics.setColor(0.8, 0.3, 0.3, 0.8)
        love.graphics.rectangle("fill", x + mid - fillW, y, fillW, barH, 3, 0)
    end

    -- Center mark
    love.graphics.setColor(0.5, 0.5, 0.5, 0.5)
    love.graphics.rectangle("fill", x + mid - 1, y, 2, barH)

    -- Guard hostile warning
    if game._karma.isGuardHostile then
        love.graphics.setColor(1, 0.2, 0.2, 0.7 + math.sin(love.timer.getTime() * 4) * 0.3)
        love.graphics.print("HOSTILE", x + barW + 8, y - 4)
    end

    -- Bounty indicator
    if game._karma.activeBounty then
        love.graphics.setColor(1, 0.6, 0.1, 0.8)
        love.graphics.print("Bounty: " .. (game._karma.activeBounty.amount or 0) .. "g", x + barW + 8, y - 18)
    end
end

-- =========================================================================
-- Faction Rep Panel (/ key toggle)
-- =========================================================================
function game.drawFactionPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local panelW = 360
    local panelH = 400
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    -- Background
    love.graphics.setColor(0.06, 0.06, 0.12, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.35, 0.30, 0.50, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    -- Title
    love.graphics.setFont(font)
    love.graphics.setColor(0.85, 0.80, 0.60, 1)
    love.graphics.printf("Faction Reputation", px, py + 10, panelW, "center")

    -- Faction list
    love.graphics.setFont(smallFont)
    local cy = py + 36
    if game._karma.factions and next(game._karma.factions) then
        for factionId, f in pairs(game._karma.factions) do
            if cy + 40 > py + panelH - 20 then break end
            -- Name + level
            love.graphics.setColor(0.9, 0.85, 0.7, 1)
            love.graphics.print((f.name or factionId), px + 12, cy)
            love.graphics.setColor(0.6, 0.7, 0.9, 0.9)
            love.graphics.print((f.levelName or "Neutral") .. " (Lv" .. (f.level or 0) .. ")", px + 12, cy + 16)

            -- Rep bar
            local barX = px + 200
            local barW = 140
            local barH = 10
            local pts = f.points or 0
            local maxPts = 1000  -- rough max per level
            local ratio = math.min(1, math.max(0, (pts % maxPts) / maxPts))
            love.graphics.setColor(0.15, 0.15, 0.2, 0.7)
            love.graphics.rectangle("fill", barX, cy + 8, barW, barH, 3, 3)
            love.graphics.setColor(0.3, 0.5, 0.9, 0.8)
            love.graphics.rectangle("fill", barX, cy + 8, barW * ratio, barH, 3, 3)
            love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
            love.graphics.rectangle("line", barX, cy + 8, barW, barH, 3, 3)

            -- Discount
            if f.discount and f.discount ~= 0 then
                local discText = string.format("%+d%%", math.floor(f.discount * 100))
                love.graphics.setColor(0.4, 0.9, 0.4, 0.8)
                love.graphics.print(discText, barX + barW + 6, cy + 6)
            end

            cy = cy + 38
        end
    else
        love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
        love.graphics.printf("No faction data yet", px, cy + 20, panelW, "center")
    end

    -- Close hint
    love.graphics.setColor(0.5, 0.5, 0.5, 0.5)
    love.graphics.printf("Press / or ESC to close", px, py + panelH - 18, panelW, "center")
end

-- =========================================================================
-- Companion Panel (U key)
-- =========================================================================
function game.drawCompanionPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local panelW = 400
    local panelH = 420
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.06, 0.06, 0.10, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.30, 0.40, 0.50, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.85, 0.85, 0.70, 1)
    love.graphics.printf("Companions", px, py + 10, panelW, "center")

    love.graphics.setFont(smallFont)
    local cy = py + 36

    -- Available classes to hire
    local COMP_CLASSES = {"warrior", "ranger", "mage", "healer", "thief", "bard"}
    love.graphics.setColor(0.7, 0.7, 0.8, 0.8)
    love.graphics.print("Hire (click class):", px + 12, cy)
    cy = cy + 18
    for i, cls in ipairs(COMP_CLASSES) do
        local bx = px + 12 + (i - 1) * 62
        local mx, my = love.mouse.getPosition()
        local hover = mx >= bx and mx <= bx + 58 and my >= cy and my <= cy + 20
        love.graphics.setColor(hover and {0.3, 0.5, 0.7, 0.9} or {0.18, 0.20, 0.28, 0.8})
        love.graphics.rectangle("fill", bx, cy, 58, 20, 4, 4)
        love.graphics.setColor(0.8, 0.8, 0.9, 1)
        love.graphics.printf(cls:sub(1, 1):upper() .. cls:sub(2), bx, cy + 3, 58, "center")
    end
    cy = cy + 28

    -- Hired companions list
    love.graphics.setColor(0.6, 0.7, 0.8, 0.6)
    love.graphics.line(px + 12, cy, px + panelW - 12, cy)
    cy = cy + 6

    if #game._companions.companions == 0 then
        love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
        love.graphics.printf("No companions hired", px, cy + 10, panelW, "center")
    else
        for _, c in ipairs(game._companions.companions) do
            if cy + 50 > py + panelH - 30 then break end
            love.graphics.setColor(0.12, 0.14, 0.20, 0.8)
            love.graphics.rectangle("fill", px + 10, cy, panelW - 20, 46, 4, 4)

            love.graphics.setColor(0.9, 0.85, 0.7, 1)
            love.graphics.print((c.name or "???") .. "  Lv" .. (c.level or 1), px + 16, cy + 4)
            love.graphics.setColor(0.6, 0.7, 0.8, 0.9)
            love.graphics.print(c.class or "?", px + 16, cy + 20)

            -- HP bar
            local barX = px + 150
            local barW = 80
            local hp = c.hp or 0
            local maxHp = c.maxHp or 1
            love.graphics.setColor(0.15, 0.15, 0.2, 0.7)
            love.graphics.rectangle("fill", barX, cy + 22, barW, 8, 3, 3)
            love.graphics.setColor(0.3, 0.8, 0.3, 0.8)
            love.graphics.rectangle("fill", barX, cy + 22, barW * (hp / maxHp), 8, 3, 3)

            -- Wage + dismiss button
            love.graphics.setColor(0.8, 0.7, 0.4, 0.7)
            love.graphics.print("Wage: " .. (c.dailyWage or 0) .. "g/day", px + 250, cy + 4)

            local dBx = px + panelW - 70
            local mx, my = love.mouse.getPosition()
            local dHover = mx >= dBx and mx <= dBx + 50 and my >= cy + 20 and my <= cy + 38
            love.graphics.setColor(dHover and {0.7, 0.2, 0.2, 0.9} or {0.4, 0.15, 0.15, 0.7})
            love.graphics.rectangle("fill", dBx, cy + 20, 50, 18, 3, 3)
            love.graphics.setColor(0.9, 0.7, 0.7, 1)
            love.graphics.printf("Dismiss", dBx, cy + 22, 50, "center")

            cy = cy + 50
        end
    end

    -- Message
    if game._companions.messageTimer > 0 and game._companions.message then
        love.graphics.setColor(0.9, 0.9, 0.5, math.min(1, game._companions.messageTimer))
        love.graphics.printf(game._companions.message, px, py + panelH - 36, panelW, "center")
    end

    love.graphics.setColor(0.5, 0.5, 0.5, 0.5)
    love.graphics.printf("U to close", px, py + panelH - 18, panelW, "center")
end

-- =========================================================================
-- Pet Panel (O key)
-- =========================================================================
function game.drawPetPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local panelW = 400
    local panelH = 420
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.06, 0.08, 0.06, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.30, 0.50, 0.30, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.70, 0.90, 0.70, 1)
    love.graphics.printf("Pets", px, py + 10, panelW, "center")

    love.graphics.setFont(smallFont)
    local cy = py + 36

    if #game._pets.pets == 0 then
        love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
        love.graphics.printf("No pets tamed. Find creatures in the wild!", px, cy + 20, panelW, "center")
    else
        for _, p in ipairs(game._pets.pets) do
            if cy + 65 > py + panelH - 30 then break end
            local isActive = (game._pets.activePetId == p.id)
            love.graphics.setColor(isActive and {0.15, 0.22, 0.15, 0.9} or {0.12, 0.14, 0.18, 0.8})
            love.graphics.rectangle("fill", px + 10, cy, panelW - 20, 58, 4, 4)
            if isActive then
                love.graphics.setColor(0.4, 0.8, 0.4, 0.5)
                love.graphics.setLineWidth(2)
                love.graphics.rectangle("line", px + 10, cy, panelW - 20, 58, 4, 4)
                love.graphics.setLineWidth(1)
            end

            -- Name + type + stage
            love.graphics.setColor(0.9, 0.9, 0.8, 1)
            love.graphics.print((p.name or p.type or "???") .. "  Lv" .. (p.level or 1), px + 16, cy + 4)
            love.graphics.setColor(0.6, 0.7, 0.8, 0.8)
            love.graphics.print("Stage: " .. (p.stage or 1) .. "  Speed: " .. (p.currentSpeed or p.speed or "?"), px + 16, cy + 20)

            -- Hunger bar
            local hungerPct = (p.hunger or 50) / 100
            love.graphics.setColor(0.5, 0.5, 0.6, 0.5)
            love.graphics.print("Hunger:", px + 16, cy + 36)
            love.graphics.setColor(0.15, 0.15, 0.2, 0.7)
            love.graphics.rectangle("fill", px + 80, cy + 38, 60, 8, 3, 3)
            love.graphics.setColor(0.8, 0.6, 0.2, 0.8)
            love.graphics.rectangle("fill", px + 80, cy + 38, 60 * hungerPct, 8, 3, 3)

            -- Happiness bar
            local happyPct = (p.happiness or 50) / 100
            love.graphics.setColor(0.5, 0.5, 0.6, 0.5)
            love.graphics.print("Happy:", px + 160, cy + 36)
            love.graphics.setColor(0.15, 0.15, 0.2, 0.7)
            love.graphics.rectangle("fill", px + 220, cy + 38, 60, 8, 3, 3)
            love.graphics.setColor(0.9, 0.4, 0.6, 0.8)
            love.graphics.rectangle("fill", px + 220, cy + 38, 60 * happyPct, 8, 3, 3)

            -- Feed + Set Active buttons
            local mx, my = love.mouse.getPosition()
            local feedX = px + panelW - 120
            local feedHover = mx >= feedX and mx <= feedX + 50 and my >= cy + 4 and my <= cy + 22
            love.graphics.setColor(feedHover and {0.3, 0.6, 0.3, 0.9} or {0.18, 0.28, 0.18, 0.7})
            love.graphics.rectangle("fill", feedX, cy + 4, 50, 18, 3, 3)
            love.graphics.setColor(0.8, 0.9, 0.8, 1)
            love.graphics.printf("Feed", feedX, cy + 6, 50, "center")

            local actX = px + panelW - 60
            local actHover = mx >= actX and mx <= actX + 46 and my >= cy + 4 and my <= cy + 22
            love.graphics.setColor(actHover and {0.3, 0.4, 0.7, 0.9} or {0.18, 0.18, 0.30, 0.7})
            love.graphics.rectangle("fill", actX, cy + 4, 46, 18, 3, 3)
            love.graphics.setColor(0.8, 0.8, 0.95, 1)
            love.graphics.printf(isActive and "Rest" or "Set", actX, cy + 6, 46, "center")

            cy = cy + 62
        end
    end

    if game._pets.messageTimer > 0 and game._pets.message then
        love.graphics.setColor(0.9, 0.9, 0.5, math.min(1, game._pets.messageTimer))
        love.graphics.printf(game._pets.message, px, py + panelH - 36, panelW, "center")
    end

    love.graphics.setColor(0.5, 0.5, 0.5, 0.5)
    love.graphics.printf("O to close", px, py + panelH - 18, panelW, "center")
end

-- =========================================================================
-- Jail Panel (auto-opens when jailed)
-- =========================================================================
function game.drawJailPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local panelW = 340
    local panelH = 260
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    -- Dark overlay
    love.graphics.setColor(0, 0, 0, 0.5)
    love.graphics.rectangle("fill", 0, 0, W, H)

    love.graphics.setColor(0.08, 0.04, 0.04, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.50, 0.25, 0.25, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.9, 0.3, 0.3, 1)
    love.graphics.printf("JAILED", px, py + 12, panelW, "center")

    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.8, 0.7, 0.6, 1)
    love.graphics.printf("Crime: " .. (game._jail.crimeLabel or game._jail.crime or "Unknown"), px + 12, py + 44, panelW - 24, "center")

    -- Timer
    local elapsed = love.timer.getTime() - game._jail.lastUpdate
    local remaining = math.max(0, (game._jail.remainingMs or 0) / 1000 - elapsed)
    local mins = math.floor(remaining / 60)
    local secs = math.floor(remaining % 60)
    love.graphics.setColor(0.9, 0.8, 0.6, 1)
    love.graphics.printf("Time remaining: " .. string.format("%d:%02d", mins, secs), px, py + 72, panelW, "center")

    -- Bail button
    local mx, my = love.mouse.getPosition()
    local bailX = px + panelW / 2 - 80
    local bailY = py + 120
    local bailHover = mx >= bailX and mx <= bailX + 160 and my >= bailY and my <= bailY + 36
    love.graphics.setColor(bailHover and {0.5, 0.4, 0.15, 0.9} or {0.3, 0.25, 0.10, 0.8})
    love.graphics.rectangle("fill", bailX, bailY, 160, 36, 6, 6)
    love.graphics.setColor(0.9, 0.8, 0.5, 1)
    love.graphics.printf("Pay Bail: " .. (game._jail.bail or 0) .. "g", bailX, bailY + 8, 160, "center")

    -- Serve time button
    local serveY = bailY + 48
    local serveHover = mx >= bailX and mx <= bailX + 160 and my >= serveY and my <= serveY + 36
    love.graphics.setColor(serveHover and {0.3, 0.3, 0.4, 0.9} or {0.18, 0.18, 0.25, 0.8})
    love.graphics.rectangle("fill", bailX, serveY, 160, 36, 6, 6)
    love.graphics.setColor(0.7, 0.7, 0.8, 1)
    love.graphics.printf("Serve Time", bailX, serveY + 8, 160, "center")

    if game._jail.messageTimer > 0 and game._jail.message then
        love.graphics.setColor(0.9, 0.9, 0.5, math.min(1, game._jail.messageTimer))
        love.graphics.printf(game._jail.message, px, py + panelH - 30, panelW, "center")
    end
end

-- =========================================================================
-- Ascension Panel (; key)
-- =========================================================================
function game.drawAscensionPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local tinyFont = fonts.small or _G.getFont(10)
    local panelW = 500
    local panelH = 450
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.04, 0.04, 0.10, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.40, 0.35, 0.60, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.80, 0.70, 1.00, 1)
    love.graphics.printf("Ascension", px, py + 10, panelW, "center")

    -- Stats bar
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.7, 0.7, 0.8, 0.9)
    love.graphics.printf("Ascensions: " .. (game._ascension.ascensionCount or 0) ..
        "   AP: " .. (game._ascension.ascensionPoints or 0), px, py + 32, panelW, "center")

    -- Ascend button (if eligible)
    if game._ascension.canAscend then
        local mx, my = love.mouse.getPosition()
        local bx = px + panelW / 2 - 60
        local by = py + 54
        local bHover = mx >= bx and mx <= bx + 120 and my >= by and my <= by + 28
        love.graphics.setColor(bHover and {0.6, 0.4, 0.9, 0.9} or {0.35, 0.25, 0.55, 0.8})
        love.graphics.rectangle("fill", bx, by, 120, 28, 6, 6)
        love.graphics.setColor(1, 0.9, 0.5, 1)
        love.graphics.printf("ASCEND", bx, by + 5, 120, "center")
    end

    -- Ascension tree
    local cy = py + 90
    love.graphics.setFont(smallFont)
    if game._ascension.tree then
        local nodeI = 0
        for nodeId, nodeData in pairs(game._ascension.tree) do
            if cy + 38 > py + panelH - 30 then break end
            nodeI = nodeI + 1
            local rank = (game._ascension.ascensionTree and game._ascension.ascensionTree[nodeId]) or 0
            local maxRank = nodeData.maxRank or 3
            local cost = nodeData.cost or 1

            local mx, my = love.mouse.getPosition()
            local nx = px + 12
            local nw = panelW - 24
            local nHover = mx >= nx and mx <= nx + nw and my >= cy and my <= cy + 34

            love.graphics.setColor(nHover and {0.18, 0.18, 0.30, 0.9} or {0.12, 0.12, 0.22, 0.8})
            love.graphics.rectangle("fill", nx, cy, nw, 34, 4, 4)

            -- Node name + rank
            local nameColor = rank >= maxRank and {0.5, 0.9, 0.5} or {0.8, 0.8, 0.9}
            love.graphics.setColor(nameColor[1], nameColor[2], nameColor[3], 1)
            love.graphics.print((nodeData.name or nodeId), nx + 8, cy + 2)

            love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
            love.graphics.print("Rank: " .. rank .. "/" .. maxRank .. "  Cost: " .. cost .. " AP", nx + 8, cy + 18)

            -- Description
            if nodeData.desc then
                love.graphics.setColor(0.5, 0.5, 0.6, 0.7)
                love.graphics.printf(nodeData.desc, nx + 200, cy + 4, nw - 210, "left")
            end

            -- Invest indicator
            if nHover and rank < maxRank and (game._ascension.ascensionPoints or 0) >= cost then
                love.graphics.setColor(0.9, 0.8, 0.3, 0.9)
                love.graphics.printf("Click to invest", nx, cy + 8, nw - 8, "right")
            end

            cy = cy + 38
        end
    else
        love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
        love.graphics.printf("Reach level 100 to unlock ascension", px, cy + 20, panelW, "center")
    end

    if game._ascension.messageTimer > 0 and game._ascension.message then
        love.graphics.setColor(0.9, 0.9, 0.5, math.min(1, game._ascension.messageTimer))
        love.graphics.printf(game._ascension.message, px, py + panelH - 36, panelW, "center")
    end

    love.graphics.setColor(0.5, 0.5, 0.5, 0.5)
    love.graphics.printf("; to close", px, py + panelH - 18, panelW, "center")
end

-- =========================================================================
-- Guild Panel (G key)
-- =========================================================================
function game.drawGuildPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local panelW = 500
    local panelH = 460
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.06, 0.06, 0.08, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.35, 0.35, 0.50, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.80, 0.80, 0.90, 1)
    love.graphics.printf(game._guild.guildName and ("Guild: " .. game._guild.guildName) or "Guilds", px, py + 10, panelW, "center")

    -- Tabs
    love.graphics.setFont(smallFont)
    local tabs
    if game._guild.guildId then
        tabs = {"info", "members", "chat", "vault"}
    else
        tabs = {"browse", "create"}
    end

    local tabW = 70
    local tabStartX = px + 10
    local tabY = py + 34
    local mx, my = love.mouse.getPosition()
    for i, tab in ipairs(tabs) do
        local tx = tabStartX + (i - 1) * (tabW + 4)
        local isActive = (game._guild.tab == tab)
        local tHover = mx >= tx and mx <= tx + tabW and my >= tabY and my <= tabY + 22
        love.graphics.setColor(isActive and {0.25, 0.25, 0.40, 0.9} or tHover and {0.18, 0.18, 0.28, 0.8} or {0.12, 0.12, 0.18, 0.6})
        love.graphics.rectangle("fill", tx, tabY, tabW, 22, 4, 4)
        love.graphics.setColor(isActive and {1, 0.9, 0.6} or {0.7, 0.7, 0.8})
        love.graphics.printf(tab:sub(1,1):upper() .. tab:sub(2), tx, tabY + 3, tabW, "center")
    end

    local contentY = tabY + 28
    local contentH = panelH - (contentY - py) - 24

    if game._guild.tab == "browse" then
        -- Browse available guilds
        local cy = contentY
        if #game._guild.guildList == 0 then
            love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
            love.graphics.printf("No guilds found", px, cy + 20, panelW, "center")
        else
            for _, g in ipairs(game._guild.guildList) do
                if cy + 36 > contentY + contentH then break end
                local gHover = mx >= px + 10 and mx <= px + panelW - 10 and my >= cy and my <= cy + 32
                love.graphics.setColor(gHover and {0.18, 0.20, 0.30, 0.9} or {0.12, 0.14, 0.20, 0.7})
                love.graphics.rectangle("fill", px + 10, cy, panelW - 20, 32, 4, 4)
                love.graphics.setColor(0.9, 0.85, 0.7, 1)
                love.graphics.print(g.name or "???", px + 16, cy + 2)
                love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
                love.graphics.print("Leader: " .. (g.leaderName or "?") .. "  " .. (g.memberCount or 0) .. "/" .. (g.maxMembers or 50), px + 16, cy + 16)
                if gHover then
                    love.graphics.setColor(0.4, 0.8, 0.4, 0.9)
                    love.graphics.printf("Click to join", px + 10, cy + 8, panelW - 26, "right")
                end
                cy = cy + 36
            end
        end

    elseif game._guild.tab == "create" then
        -- Create guild form
        love.graphics.setColor(0.7, 0.7, 0.8, 0.8)
        love.graphics.print("Guild Name:", px + 20, contentY + 10)
        love.graphics.setColor(0.12, 0.12, 0.20, 0.9)
        love.graphics.rectangle("fill", px + 20, contentY + 28, panelW - 40, 24, 4, 4)
        love.graphics.setColor(0.9, 0.9, 0.9, 1)
        love.graphics.print(game._guild.createName .. (game._guild.createActive and "_" or ""), px + 26, contentY + 32)

        local createBx = px + panelW / 2 - 50
        local createBy = contentY + 70
        local createHover = mx >= createBx and mx <= createBx + 100 and my >= createBy and my <= createBy + 28
        love.graphics.setColor(createHover and {0.3, 0.5, 0.3, 0.9} or {0.18, 0.28, 0.18, 0.8})
        love.graphics.rectangle("fill", createBx, createBy, 100, 28, 6, 6)
        love.graphics.setColor(0.9, 0.9, 0.7, 1)
        love.graphics.printf("Create", createBx, createBy + 5, 100, "center")

    elseif game._guild.tab == "members" or game._guild.tab == "info" then
        -- Member list
        local cy = contentY
        for _, m in ipairs(game._guild.members) do
            if cy + 22 > contentY + contentH then break end
            local roleColor = m.role == "leader" and {1, 0.85, 0.3} or m.role == "officer" and {0.5, 0.7, 1} or {0.7, 0.7, 0.7}
            love.graphics.setColor(roleColor[1], roleColor[2], roleColor[3], 1)
            love.graphics.print((m.name or "???") .. " [" .. (m.role or "member") .. "]", px + 20, cy)
            cy = cy + 20
        end
        if #game._guild.members == 0 then
            love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
            love.graphics.printf("No members loaded", px, contentY + 20, panelW, "center")
        end

        -- Leave button
        local lx = px + panelW - 80
        local ly = py + panelH - 40
        local lHover = mx >= lx and mx <= lx + 60 and my >= ly and my <= ly + 22
        love.graphics.setColor(lHover and {0.6, 0.2, 0.2, 0.9} or {0.3, 0.12, 0.12, 0.7})
        love.graphics.rectangle("fill", lx, ly, 60, 22, 4, 4)
        love.graphics.setColor(0.9, 0.6, 0.6, 1)
        love.graphics.printf("Leave", lx, ly + 3, 60, "center")

    elseif game._guild.tab == "chat" then
        -- Chat messages
        local cy = contentY
        for _, msg in ipairs(game._guild.messages) do
            if cy + 16 > contentY + contentH - 30 then break end
            love.graphics.setColor(0.6, 0.8, 1, 0.9)
            love.graphics.print(msg.authorName .. ": ", px + 16, cy)
            love.graphics.setColor(0.8, 0.8, 0.8, 1)
            love.graphics.print(msg.content, px + 16 + smallFont:getWidth(msg.authorName .. ": "), cy)
            cy = cy + 16
        end

        -- Chat input
        local inputY = contentY + contentH - 24
        love.graphics.setColor(0.12, 0.12, 0.18, 0.9)
        love.graphics.rectangle("fill", px + 14, inputY, panelW - 28, 22, 4, 4)
        love.graphics.setColor(0.8, 0.8, 0.8, 1)
        love.graphics.print(game._guild.chatInput .. (game._guild.chatActive and "_" or ""), px + 20, inputY + 3)

    elseif game._guild.tab == "vault" then
        -- Vault contents
        local cy = contentY
        if game._guild.vault then
            love.graphics.setColor(0.8, 0.75, 0.5, 0.9)
            love.graphics.print("Resources:", px + 16, cy)
            cy = cy + 18
            if game._guild.vault.resources then
                for resName, amount in pairs(game._guild.vault.resources) do
                    if cy + 14 > contentY + contentH then break end
                    love.graphics.setColor(0.7, 0.7, 0.7, 0.9)
                    love.graphics.print("  " .. resName .. ": " .. amount, px + 20, cy)
                    cy = cy + 14
                end
            end
            cy = cy + 8
            love.graphics.setColor(0.8, 0.75, 0.5, 0.9)
            love.graphics.print("Cards: " .. (#(game._guild.vault.cards or {})), px + 16, cy)
        else
            love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
            love.graphics.printf("Loading vault...", px, cy + 20, panelW, "center")
        end
    end

    if game._guild.messageTimer > 0 and game._guild.message then
        love.graphics.setColor(0.9, 0.9, 0.5, math.min(1, game._guild.messageTimer))
        love.graphics.printf(game._guild.message, px, py + panelH - 36, panelW, "center")
    end

    love.graphics.setColor(0.5, 0.5, 0.5, 0.5)
    love.graphics.printf("] to close", px, py + panelH - 18, panelW, "center")
end

-- =========================================================================
-- Crafting Minigame (timing bar)
-- =========================================================================
function game.drawCraftingMinigame(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)

    -- Dark overlay
    love.graphics.setColor(0, 0, 0, 0.4)
    love.graphics.rectangle("fill", 0, 0, W, H)

    local barW = 400
    local barH = 30
    local panelW = barW + 40
    local panelH = 120
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.06, 0.06, 0.10, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.45, 0.35, 0.20, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.9, 0.8, 0.5, 1)
    love.graphics.printf("Crafting — Click in the sweet spot!", px, py + 8, panelW, "center")

    -- Bar background
    local bx = px + 20
    local by = py + 40
    love.graphics.setColor(0.15, 0.15, 0.2, 0.9)
    love.graphics.rectangle("fill", bx, by, barW, barH, 4, 4)

    -- Sweet spot zone (green)
    local zoneStart = (game._minigame.windowStart / 1000) * barW
    local zoneEnd = (game._minigame.windowEnd / 1000) * barW
    love.graphics.setColor(0.2, 0.6, 0.2, 0.5)
    love.graphics.rectangle("fill", bx + zoneStart, by, zoneEnd - zoneStart, barH)

    -- Perfect center (bright green line)
    local perfectPos = bx + (zoneStart + zoneEnd) / 2
    love.graphics.setColor(0.4, 1, 0.4, 0.7)
    love.graphics.rectangle("fill", perfectPos - 1, by, 2, barH)

    -- Moving indicator
    if not game._minigame.result then
        local indicatorX = bx + (game._minigame.barPos / 1000) * barW
        love.graphics.setColor(1, 0.9, 0.3, 1)
        love.graphics.rectangle("fill", indicatorX - 2, by - 4, 4, barH + 8, 2, 2)
    end

    -- Result text
    if game._minigame.result then
        local rColor
        if game._minigame.result == "perfect" then rColor = {0.3, 1, 0.3}
        elseif game._minigame.result == "good" then rColor = {0.7, 0.9, 0.3}
        else rColor = {0.9, 0.3, 0.3} end
        love.graphics.setFont(font)
        love.graphics.setColor(rColor[1], rColor[2], rColor[3], 1)
        love.graphics.printf(game._minigame.result:upper() .. "!", px, py + panelH - 34, panelW, "center")
    else
        love.graphics.setFont(smallFont)
        love.graphics.setColor(0.6, 0.6, 0.6, 0.7)
        love.graphics.printf("Click or press Space to strike!", px, py + panelH - 26, panelW, "center")
    end
end

-- =========================================================================
-- Patrol Units (overworld markers)
-- =========================================================================
function game.drawPatrolUnits()
    local smallFont = fonts.small or _G.getFont(10)
    love.graphics.setFont(smallFont)
    for _, patrol in pairs(game._patrolUnits) do
        local px = patrol.x or 0
        local py = patrol.y or 0
        -- Shield icon (triangle + circle)
        love.graphics.setColor(0.3, 0.5, 0.8, 0.8)
        love.graphics.circle("fill", px, py, 8)
        love.graphics.setColor(0.5, 0.7, 1, 0.9)
        love.graphics.circle("line", px, py, 8)
        -- Label
        love.graphics.setColor(0.6, 0.7, 0.9, 0.8)
        love.graphics.printf(patrol.name or "Patrol", px - 30, py - 18, 60, "center")
    end
end

-- =========================================================================
-- Notifications (guard warnings, durability, dungeon events)
-- =========================================================================
function game.drawNotifications(W, H)
    if #game._notifications == 0 then return end
    local font = fonts.chat or fonts.main or _G.getFont(12)
    love.graphics.setFont(font)
    local cy = 60
    for _, n in ipairs(game._notifications) do
        local alpha = math.min(1, n.timer / (n.maxTimer * 0.3))
        love.graphics.setColor(0, 0, 0, 0.6 * alpha)
        local tw = font:getWidth(n.text) + 20
        love.graphics.rectangle("fill", (W - tw) / 2, cy - 2, tw, 20, 4, 4)
        love.graphics.setColor(n.color[1], n.color[2], n.color[3], alpha)
        love.graphics.printf(n.text, 0, cy, W, "center")
        cy = cy + 24
    end
end

function game.drawAudioSettingsPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local panelW = 360
    local panelH = 400
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    -- Background
    love.graphics.setColor(0.06, 0.06, 0.10, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.30, 0.40, 0.50, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    -- Title
    love.graphics.setFont(font)
    love.graphics.setColor(0.85, 0.85, 0.70, 1)
    love.graphics.printf("Settings", px, py + 10, panelW, "center")

    -- Audio section header
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.55, 0.65, 0.75, 0.8)
    love.graphics.print("AUDIO", px + 16, py + 36)
    love.graphics.setColor(0.25, 0.30, 0.40, 0.5)
    love.graphics.line(px + 60, py + 44, px + panelW - 16, py + 44)

    -- Sliders
    local categories = {"master", "music", "sfx", "ambient", "ui", "footsteps"}
    local labels = {master="Master", music="Music", sfx="SFX", ambient="Ambient", ui="UI", footsteps="Footsteps"}
    local sliderX = px + 130
    local sliderW = panelW - 160
    local cy = py + 52
    local vols = game._audio.getVolumes()

    for _, cat in ipairs(categories) do
        local v = vols[cat] or 0
        -- Label
        love.graphics.setColor(0.75, 0.75, 0.85, 1)
        love.graphics.print(labels[cat], px + 16, cy + 2)
        -- Track background
        love.graphics.setColor(0.15, 0.15, 0.22, 0.9)
        love.graphics.rectangle("fill", sliderX, cy + 6, sliderW, 10, 4, 4)
        -- Filled portion
        local fillW = sliderW * v
        if cat == "master" then
            love.graphics.setColor(0.55, 0.75, 0.90, 0.9)
        else
            love.graphics.setColor(0.40, 0.60, 0.75, 0.9)
        end
        love.graphics.rectangle("fill", sliderX, cy + 6, fillW, 10, 4, 4)
        -- Knob
        local knobX = sliderX + fillW
        love.graphics.setColor(0.90, 0.90, 0.95, 1)
        love.graphics.circle("fill", knobX, cy + 11, 7)
        love.graphics.setColor(0.50, 0.60, 0.70, 0.8)
        love.graphics.circle("line", knobX, cy + 11, 7)
        -- Percentage
        love.graphics.setColor(0.60, 0.60, 0.70, 0.9)
        love.graphics.printf(math.floor(v * 100) .. "%", sliderX + sliderW + 6, cy + 2, 40, "left")

        cy = cy + 34
    end

    -- Graphics section header
    cy = cy + 8
    love.graphics.setColor(0.55, 0.65, 0.75, 0.8)
    love.graphics.print("GRAPHICS", px + 16, cy)
    love.graphics.setColor(0.25, 0.30, 0.40, 0.5)
    love.graphics.line(px + 80, cy + 8, px + panelW - 16, cy + 8)
    cy = cy + 18

    -- Lighting quality toggle buttons
    love.graphics.setColor(0.75, 0.75, 0.85, 1)
    love.graphics.print("Lighting", px + 16, cy + 4)

    local currentQ = lighting.getQuality()
    local qualOpts = {"low", "medium", "high"}
    local qualLabels = {low = "Low", medium = "Medium", high = "High"}
    local mx, my = love.mouse.getPosition()
    local btnW = 70
    local btnSpacing = 8
    local btnX = sliderX
    game._settingsQualBtns = {}
    for qi, qk in ipairs(qualOpts) do
        local bx = btnX + (qi - 1) * (btnW + btnSpacing)
        local by = cy
        local bh = 26
        local isActive = (currentQ == qk)
        local isHover = mx >= bx and mx <= bx + btnW and my >= by and my <= by + bh

        if isActive then
            love.graphics.setColor(0.35, 0.55, 0.70, 0.95)
        elseif isHover then
            love.graphics.setColor(0.22, 0.32, 0.42, 0.85)
        else
            love.graphics.setColor(0.14, 0.18, 0.25, 0.8)
        end
        love.graphics.rectangle("fill", bx, by, btnW, bh, 4, 4)

        if isActive then
            love.graphics.setColor(0.50, 0.70, 0.85, 0.8)
        else
            love.graphics.setColor(0.30, 0.38, 0.48, 0.6)
        end
        love.graphics.rectangle("line", bx, by, btnW, bh, 4, 4)

        love.graphics.setColor(isActive and {1, 1, 1, 1} or {0.65, 0.65, 0.75, 0.9})
        love.graphics.printf(qualLabels[qk], bx, by + 5, btnW, "center")

        game._settingsQualBtns[qi] = { x = bx, y = by, w = btnW, h = bh, quality = qk }
    end

    -- Close button
    local closeY = py + panelH - 42
    local closeX = px + panelW / 2 - 50
    local hover = mx >= closeX and mx <= closeX + 100 and my >= closeY and my <= closeY + 30
    love.graphics.setColor(hover and {0.30, 0.45, 0.60, 0.9} or {0.18, 0.22, 0.30, 0.8})
    love.graphics.rectangle("fill", closeX, closeY, 100, 30, 5, 5)
    love.graphics.setColor(0.80, 0.80, 0.90, 1)
    love.graphics.printf("Close", closeX, closeY + 7, 100, "center")

    -- Hint
    love.graphics.setColor(0.45, 0.45, 0.55, 0.6)
    love.graphics.printf("F9 to toggle", px, py + panelH - 16, panelW, "center")
end

function game.mousereleased(x, y, button)
    game._audioSliderDrag = nil
    if ui.showGridInventory then
        if gridInv.mousereleased(x, y, button) then return end
    end
end

return game
