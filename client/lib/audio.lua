-- NOTE: art/audio are NOT in the repo — owner-licensed packs stripped from
-- version control (see client/assets/ASSETS_PLACEHOLDER.md). Loaders must
-- tolerate missing files on fresh clones.
-- lib/audio.lua
-- Audio manager: music, ambient, footsteps, SFX, UI sounds, spatial audio.
-- Pre-decodes footsteps + UI at init. Lazy-loads/streams everything else.

local audio = {}

local BASE = "assets/audio/"

-- ───── Volume categories (all 0-1, multiplicative with master) ─────
local vol = {
    master    = 0.8,
    music     = 0.5,
    sfx       = 0.7,
    ambient   = 0.6,
    ui        = 0.6,
    footsteps = 0.4,
    creature  = 0.6,
}

-- ───── Source pools (reusable sources to cap simultaneous sounds) ─────
local pools = {}
local POOL_SIZES = { sfx = 16, footsteps = 6, ambient = 4, creature = 4, ui = 4 }

-- Pre-decoded audio data cache: path → SoundData
local _decoded = {}

-- Lazy-loaded source cache: path → Source (for one-shot sounds)
local _sourceCache = {}

-- ───── Music state ─────
local music = {
    current   = nil,   -- currently playing Source
    name      = nil,   -- track name (for loop structure)
    phase     = nil,   -- "start" / "loop" / "end" / "full" / "single_loop"
    parts     = nil,   -- { start=path, loop=path, ["end"]=path } or { full=path } or { loop=path }
    volume    = 0,     -- current fade volume (0-1)
    fadeTarget = 0,
    fadeSpeed = 1.0,   -- units per second
    queued    = nil,    -- next music to play after fade-out
}

-- ───── Ambient state ─────
local ambient = {
    current   = nil,   -- Source
    path      = nil,
    volume    = 0,
    fadeTarget = 0,
    fadeSpeed  = 0.8,
    next       = nil,  -- { path, fadeSpeed } queued for crossfade
}

-- Weather ambient layer (rain/storm/wind on top of zone ambient)
local weatherLayer = {
    current = nil,
    path    = nil,
    volume  = 0,
    fadeTarget = 0,
    fadeSpeed  = 1.0,
}

-- ───── Footstep state ─────
local selfFootstep = {
    timer     = 0,
    cadence   = 0.45,  -- seconds between steps (adjusted by speed)
    lastSurface = "concrete",
}

-- Other player footstep tracking (spatial audio)
local otherPlayers = {} -- id → { x, y, lastX, lastY, timer, moving }
local MAX_OTHER_FOOTSTEPS = 3
local FOOTSTEP_CULL_DIST = 400

-- ───── Horror stinger state ─────
local stinger = {
    cooldown = 0,
    COOLDOWN_TIME = 30,
    active = false, -- true if we're in a dark dungeon floor
}

-- ───── Camera reference for spatial audio (set externally) ─────
local camRef = { x = 0, y = 0 }
local screenW = 800

-- ───── File lists (built at init from filesystem) ─────
local files = {
    footstep_concrete = {},
    footstep_wood     = {},
    footstep_metal    = {},
    ui_click          = {},
    ui_submit         = {},
    combat_hit        = {},
    combat_miss       = {},
    combat_heavy      = {},
    combat_slash      = {},
    stinger           = {},
}

-- ───── Dungeon theme → ambience mapping ─────
-- Groups dungeon themes into atmosphere categories, each mapped to ambience tracks
local THEME_AMBIENCE = {
    -- Horror themes
    crypt           = "ambience_d1_loop",
    undead_crypt    = "ambience_d2_loop",
    haunted         = "ambience_d3_loop",
    dark_ritual     = "ambience_d4_loop",
    necropolis      = "ambience_d5_loop",
    shadow          = "ambience_d6_loop",
    void            = "ambience_d7_loop",
    abyssal         = "ambience_d8_loop",
    -- Intense/combat themes
    inferno         = "ambience_d9_loop",
    volcanic        = "ambience_d10_loop",
    fire            = "ambience_d11_loop",
    demon           = "ambience_d12_loop",
    war             = "ambience_d13_loop",
    siege           = "ambience_d14_loop",
    -- Cold themes
    ice             = "ambience_d15_loop",
    frost           = "ambience_d16_loop",
    frozen          = "ambience_d17_loop",
    tundra          = "ambience_d18_loop",
    -- Water themes
    flooded         = "ambience_d19_loop",
    underwater      = "ambience_d20_loop",
    sewer           = "ambience_d21_loop",
    swamp           = "ambience_d22_loop",
    -- Machine/tech themes
    clockwork       = "ambience_d23_loop",
    mechanical      = "ambience_d24_loop",
    factory         = "ambience_d25_loop",
    -- Organic themes
    hive            = "ambience_d26_loop",
    fungal          = "ambience_d26_1_loop",
    organic         = "ambience_d27_loop",
    flesh           = "ambience_d27_1_loop",
    -- Outdoor/default
    cave            = "ambience_d28_outdoors_loop",
    mine            = "ambience_d28_outdoors_loop",
    ruins           = "ambience_d1_loop",
    temple          = "ambience_d3_loop",
    dungeon         = "ambience_d2_loop",
    forest          = "ambience_d28_outdoors_loop",
    -- Rift special
    rift            = "ambience_d7_loop",
    corruption      = "ambience_d8_loop",
}

-- Zone type → ambient track for overworld/towns
local ZONE_AMBIENCE = {
    town     = "ambience_d28_outdoors_loop",
    overworld = "ambience_d28_outdoors_loop",
    building = "ambience_strings_mx_1",
    plot     = "ambience_d28_outdoors_loop",
}

-- Weather → ambient layer file
local WEATHER_AMBIENT = {
    rain  = "ambience_rythm_slow_mx_1",
    storm = "ambience_rythm_fast_mx_1",
    snow  = "ambience_whispers_mx_1",
    fog   = "ambience_the_mystery_mx_1",
}

-- Zone type + biome → surface type for footsteps
local ZONE_SURFACE = {
    town = "concrete",
    building = "wood",
    plot = "wood",
}

-- Biome name → surface type override
local BIOME_SURFACE = {
    forest      = "wood",
    deep_forest = "wood",
    swamp       = "wood",
    desert      = "concrete",
    mountain    = "concrete",
    plains      = "concrete",
    tundra      = "concrete",
    volcanic    = "concrete",
    beach       = "concrete",
    ocean       = "concrete",
    jungle      = "wood",
    savanna     = "concrete",
    taiga       = "wood",
    marsh       = "wood",
    badlands    = "concrete",
    glacier     = "concrete",
    highlands   = "concrete",
}

-- Music tracks with loop structure
-- Format: name → { type = "loop3" | "loop1" | "full", files... }
local MUSIC_TRACKS = {
    beginning   = { type = "loop3", start = "beginning (start)", loop = "beginning (middle_loop)", fin = "beginning (end)" },
    darkness    = { type = "loop3", start = "darkness follows (start part 1)", loop = "darkness follows (middle_loop)", fin = "darkness follows (end)" },
    finale      = { type = "loop3", start = "finale (start)", loop = "finale (middle_loop)", fin = "finale (end)" },
    heat        = { type = "loop3", start = "heat (start)", loop = "heat (middle_loop)", fin = "heat (end)" },
    pitch_black = { type = "loop3", start = "pitch black (start)", loop = "pitch black (middle_loop)", fin = "pitch black (end)" },
    subliminal  = { type = "loop3", start = "subliminal (start)", loop = "subliminal (middle_loop)", fin = "subliminal (end)" },
    undercover  = { type = "loop3", start = "undercover (start)", loop = "undercover (middle_loop)", fin = "undercover (end)" },
    ambient_ost = { type = "loop3", start = "ambient_ost_mx_1_beginning", loop = "ambient_ost_mx_1_middle", fin = "ambient_ost_mx_1_end" },
    fight       = { type = "loop1", loop = "fight (loop)" },
    firefight   = { type = "loop1", loop = "firefight (loop)" },
    death_close = { type = "loop1", loop = "death close by (loop)" },
    pressure    = { type = "loop1", loop = "pressure (loop)" },
    last_chapter = { type = "loop1", loop = "last chapter (loop)" },
    too_late    = { type = "loop1", loop = "too late (loop)" },
    hope        = { type = "full", file = "hope (complete track)" },
    no_way_out  = { type = "full", file = "no way out (complete track)" },
    sinister    = { type = "full", file = "sinister awakens (complete track)" },
    forest_thing = { type = "full", file = "something in the forest (complete track)" },
    swarm       = { type = "full", file = "swarm (complete track)" },
}

-- Combat music choices
local COMBAT_MUSIC = { "fight", "firefight", "heat", "pressure" }

-- Dungeon theme → music mapping (biome-aware)
local DUNGEON_THEME_MUSIC = {
    -- Horror/dark → tense tracks
    crypt = { "darkness", "pitch_black", "death_close" },
    undead_crypt = { "darkness", "pitch_black", "death_close" },
    haunted = { "pitch_black", "subliminal", "sinister" },
    dark_ritual = { "subliminal", "pitch_black", "sinister" },
    necropolis = { "darkness", "death_close", "no_way_out" },
    shadow = { "subliminal", "pitch_black", "undercover" },
    void = { "pitch_black", "no_way_out", "subliminal" },
    abyssal = { "pitch_black", "no_way_out", "darkness" },
    -- Intense/fire → high energy
    inferno = { "heat", "finale", "firefight" },
    volcanic = { "heat", "finale", "fight" },
    fire = { "heat", "fight", "firefight" },
    demon = { "heat", "finale", "darkness" },
    war = { "fight", "firefight", "pressure" },
    siege = { "fight", "firefight", "pressure" },
    -- Cold themes → eerie
    ice = { "subliminal", "undercover", "ambient_ost" },
    frost = { "subliminal", "undercover", "ambient_ost" },
    frozen = { "subliminal", "undercover", "pitch_black" },
    tundra = { "undercover", "ambient_ost", "subliminal" },
    -- Water/organic → mysterious
    flooded = { "undercover", "subliminal", "ambient_ost" },
    underwater = { "undercover", "ambient_ost", "subliminal" },
    sewer = { "darkness", "undercover", "death_close" },
    swamp = { "forest_thing", "darkness", "undercover" },
    -- Machine → rhythmic
    clockwork = { "pressure", "undercover", "last_chapter" },
    mechanical = { "pressure", "undercover", "last_chapter" },
    factory = { "pressure", "last_chapter", "too_late" },
    -- Organic → unsettling
    hive = { "swarm", "darkness", "subliminal" },
    fungal = { "forest_thing", "subliminal", "undercover" },
    organic = { "swarm", "subliminal", "darkness" },
    flesh = { "swarm", "no_way_out", "darkness" },
    -- Rift → cosmic horror
    rift = { "pitch_black", "no_way_out", "subliminal" },
    corruption = { "darkness", "pitch_black", "no_way_out" },
}
local DUNGEON_MUSIC_DEFAULT = { "darkness", "pitch_black", "subliminal", "undercover", "death_close" }

-- Overworld biome → music mapping
local BIOME_MUSIC = {
    forest      = { "beginning", "hope", "forest_thing" },
    deep_forest = { "forest_thing", "beginning", "ambient_ost" },
    jungle      = { "forest_thing", "swarm", "ambient_ost" },
    plains      = { "beginning", "hope", "ambient_ost" },
    savanna     = { "beginning", "hope", "ambient_ost" },
    desert      = { "ambient_ost", "heat", "subliminal" },
    tundra      = { "subliminal", "undercover", "ambient_ost" },
    mountain    = { "ambient_ost", "beginning", "undercover" },
    highlands   = { "ambient_ost", "beginning", "hope" },
    swamp       = { "forest_thing", "undercover", "darkness" },
    marsh       = { "forest_thing", "undercover", "ambient_ost" },
    beach       = { "hope", "beginning", "ambient_ost" },
    volcanic    = { "heat", "ambient_ost", "subliminal" },
    badlands    = { "ambient_ost", "subliminal", "undercover" },
    glacier     = { "subliminal", "ambient_ost", "undercover" },
    taiga       = { "undercover", "ambient_ost", "beginning" },
}
local OVERWORLD_MUSIC_DEFAULT = { "beginning", "ambient_ost", "hope" }

-- Town music
local TOWN_MUSIC = { "hope", "beginning", "ambient_ost" }

-- Preferences file
local PREFS_FILE = "audio_prefs.json"

-- ───── Helpers ─────

local function clamp(x, lo, hi) return math.max(lo, math.min(hi, x)) end

local function randomFrom(t)
    if #t == 0 then return nil end
    return t[math.random(#t)]
end

local function effectiveVol(category)
    return vol.master * (vol[category] or 1)
end

-- Create a source pool
local function createPool(size)
    return { sources = {}, idx = 1, size = size }
end

-- Get next available source from pool, stopping oldest if needed
local function poolPlay(pool, source, volCategory)
    if not source then return end
    -- Find a stopped slot or use round-robin
    local slot = nil
    for i = 1, pool.size do
        local s = pool.sources[i]
        if not s or not s:isPlaying() then
            slot = i
            break
        end
    end
    if not slot then
        slot = pool.idx
        pool.idx = (pool.idx % pool.size) + 1
        if pool.sources[slot] then
            pool.sources[slot]:stop()
        end
    end
    source:setVolume(effectiveVol(volCategory))
    source:stop()
    source:play()
    pool.sources[slot] = source
end

-- Pre-decode a file into SoundData (static, fast playback)
local function predecode(path)
    if _decoded[path] then return _decoded[path] end
    local fullPath = BASE .. path .. ".ogg"
    if not love.filesystem.getInfo(fullPath) then return nil end
    local ok, sd = pcall(love.sound.newSoundData, fullPath)
    if ok and sd then
        _decoded[path] = sd
        return sd
    end
    return nil
end

-- Get a static Source from decoded data (cloned for pool use)
local function staticSource(path)
    local sd = _decoded[path]
    if not sd then
        sd = predecode(path)
        if not sd then return nil end
    end
    return love.audio.newSource(sd)
end

-- Get a streaming Source for long audio
local function streamSource(path)
    local fullPath = BASE .. path .. ".ogg"
    if not love.filesystem.getInfo(fullPath) then return nil end
    local ok, src = pcall(love.audio.newSource, fullPath, "stream")
    if ok then return src end
    return nil
end

-- Spatial audio: compute volume and pan from world position
local function spatialParams(worldX, worldY)
    local dx = worldX - camRef.x - screenW / 2
    local dy = worldY - camRef.y - (love.graphics.getHeight() / 2)
    local dist = math.sqrt(dx * dx + dy * dy)
    if dist >= FOOTSTEP_CULL_DIST then return 0, 0 end
    -- Quadratic falloff
    local t = 1 - (dist / FOOTSTEP_CULL_DIST)
    local volume = t * t
    -- Stereo pan: -1 (left) to 1 (right)
    local pan = clamp(dx / (screenW / 2), -1, 1)
    return volume, pan
end

-- Scan directory for numbered files matching a pattern
local function scanFiles(dir, prefix, maxN)
    local result = {}
    for i = 1, (maxN or 30) do
        local path = dir .. "/" .. prefix .. i
        local fullPath = BASE .. path .. ".ogg"
        if love.filesystem.getInfo(fullPath) then
            result[#result + 1] = path
        end
    end
    return result
end

-- ───── Init ─────

local _audioInitialized = false

function audio.init()
    if _audioInitialized then return end
    _audioInitialized = true
    screenW = love.graphics.getWidth()

    -- Create source pools
    for name, size in pairs(POOL_SIZES) do
        pools[name] = createPool(size)
    end

    -- Scan and pre-decode footstep files
    files.footstep_concrete = scanFiles("footsteps", "footstep_concrete_a_", 15)
    files.footstep_wood     = scanFiles("footsteps", "footstep_wood_a_", 20)
    files.footstep_metal    = scanFiles("footsteps", "footstep_metal_a_", 4)
    for _, list in pairs({ files.footstep_concrete, files.footstep_wood, files.footstep_metal }) do
        for _, path in ipairs(list) do predecode(path) end
    end

    -- Scan and pre-decode UI sounds
    files.ui_click  = scanFiles("ui", "gui_click_", 12)
    files.ui_submit = scanFiles("ui", "gui_submit_", 5)
    for _, list in pairs({ files.ui_click, files.ui_submit }) do
        for _, path in ipairs(list) do predecode(path) end
    end

    -- Scan combat hit/miss files (not pre-decoded, lazy loaded)
    files.combat_hit    = scanFiles("combat", "hit_", 5)
    files.combat_miss   = scanFiles("combat", "universal_swing_miss_light_ufx_", 2)
    files.combat_heavy  = scanFiles("combat", "slash_bloody_heavy_ufx_", 3)
    files.combat_slash  = scanFiles("combat", "sharp_slash_body_ufx_", 1)

    -- Horror stinger files
    files.stinger = scanFiles("horror", "stinger_ph_", 6)

    -- Load saved preferences
    audio.loadPrefs()
end

-- ───── Update (call every frame) ─────

function audio.update(dt)
    -- Music fade
    if music.current then
        if music.volume ~= music.fadeTarget then
            local dir = music.fadeTarget > music.volume and 1 or -1
            music.volume = music.volume + dir * music.fadeSpeed * dt
            if (dir > 0 and music.volume >= music.fadeTarget) or
               (dir < 0 and music.volume <= music.fadeTarget) then
                music.volume = music.fadeTarget
            end
            music.current:setVolume(music.volume * effectiveVol("music"))
            if music.volume <= 0 then
                music.current:stop()
                music.current = nil
                music.name = nil
                music.phase = nil
            end
        else
            music.current:setVolume(music.volume * effectiveVol("music"))
        end

        -- Loop structure: check if current phase ended, advance
        if music.current and not music.current:isPlaying() and music.volume > 0 then
            if music.phase == "start" and music.parts and music.parts.loop then
                -- Transition start → loop
                local src = streamSource("music/" .. music.parts.loop)
                music.current:stop()
                if src then
                    src:setLooping(true)
                    src:setVolume(music.volume * effectiveVol("music"))
                    src:play()
                    music.current = src
                    music.phase = "loop"
                else
                    music.current = nil
                    music.name = nil
                    music.phase = nil
                end
            elseif music.phase == "full" or music.phase == "single_loop" then
                -- Full track ended, stop
                music.current = nil
                music.name = nil
                music.phase = nil
            end
        end
    end

    -- Handle queued music after fade-out completes
    if music.queued and not music.current then
        audio.playMusic(music.queued)
        music.queued = nil
    end

    -- Ambient fade
    if ambient.current then
        if ambient.volume ~= ambient.fadeTarget then
            local dir = ambient.fadeTarget > ambient.volume and 1 or -1
            ambient.volume = ambient.volume + dir * ambient.fadeSpeed * dt
            if (dir > 0 and ambient.volume >= ambient.fadeTarget) or
               (dir < 0 and ambient.volume <= ambient.fadeTarget) then
                ambient.volume = ambient.fadeTarget
            end
            ambient.current:setVolume(ambient.volume * effectiveVol("ambient"))
            if ambient.volume <= 0 then
                ambient.current:stop()
                ambient.current = nil
                ambient.path = nil
            end
        else
            ambient.current:setVolume(ambient.volume * effectiveVol("ambient"))
        end
    end

    -- Crossfade: start next ambient after old one fades
    if ambient.next and not ambient.current then
        local src = streamSource("ambience/" .. ambient.next.path)
        if src then
            src:setLooping(true)
            src:setVolume(0)
            src:play()
            ambient.current = src
            ambient.path = ambient.next.path
            ambient.volume = 0
            ambient.fadeTarget = 1
            ambient.fadeSpeed = ambient.next.fadeSpeed or 0.8
        end
        ambient.next = nil
    end

    -- Weather layer fade
    if weatherLayer.current then
        if weatherLayer.volume ~= weatherLayer.fadeTarget then
            local dir = weatherLayer.fadeTarget > weatherLayer.volume and 1 or -1
            weatherLayer.volume = weatherLayer.volume + dir * weatherLayer.fadeSpeed * dt
            if (dir > 0 and weatherLayer.volume >= weatherLayer.fadeTarget) or
               (dir < 0 and weatherLayer.volume <= weatherLayer.fadeTarget) then
                weatherLayer.volume = weatherLayer.fadeTarget
            end
            weatherLayer.current:setVolume(weatherLayer.volume * effectiveVol("ambient") * 0.5)
            if weatherLayer.volume <= 0 then
                weatherLayer.current:stop()
                weatherLayer.current = nil
                weatherLayer.path = nil
            end
        else
            weatherLayer.current:setVolume(weatherLayer.volume * effectiveVol("ambient") * 0.5)
        end
    end

    -- Horror stinger cooldown
    if stinger.cooldown > 0 then
        stinger.cooldown = stinger.cooldown - dt
    end
end

-- ───── Music ─────

function audio.playMusic(trackName)
    if not trackName then return end
    if music.name == trackName and music.current then return end -- already playing

    local track = MUSIC_TRACKS[trackName]
    if not track then return end

    -- If something is playing, fade out then queue
    if music.current and music.volume > 0 then
        music.fadeTarget = 0
        music.fadeSpeed = 1.5
        music.queued = trackName
        return
    end

    -- Stop anything residual
    if music.current then music.current:stop() end

    music.name = trackName
    if track.type == "loop3" then
        music.parts = { start = track.start, loop = track.loop, fin = track.fin }
        local src = streamSource("music/" .. track.start)
        if src then
            src:setLooping(false)
            src:setVolume(effectiveVol("music"))
            src:play()
            music.current = src
            music.phase = "start"
            music.volume = 1
            music.fadeTarget = 1
        end
    elseif track.type == "loop1" then
        music.parts = { loop = track.loop }
        local src = streamSource("music/" .. track.loop)
        if src then
            src:setLooping(true)
            src:setVolume(effectiveVol("music"))
            src:play()
            music.current = src
            music.phase = "single_loop"
            music.volume = 1
            music.fadeTarget = 1
        end
    elseif track.type == "full" then
        music.parts = { file = track.file }
        local src = streamSource("music/" .. track.file)
        if src then
            src:setLooping(false)
            src:setVolume(effectiveVol("music"))
            src:play()
            music.current = src
            music.phase = "full"
            music.volume = 1
            music.fadeTarget = 1
        end
    end
end

function audio.stopMusic(fadeTime)
    if not music.current then return end
    music.fadeTarget = 0
    music.fadeSpeed = 1 / (fadeTime or 1)
    music.queued = nil
end

function audio.playRandomCombatMusic()
    audio.playMusic(randomFrom(COMBAT_MUSIC))
end

function audio.playDungeonMusic(theme)
    local pool = (theme and DUNGEON_THEME_MUSIC[theme]) or DUNGEON_MUSIC_DEFAULT
    audio.playMusic(randomFrom(pool))
end

function audio.playOverworldMusic(biome)
    local pool = (biome and BIOME_MUSIC[biome]) or OVERWORLD_MUSIC_DEFAULT
    audio.playMusic(randomFrom(pool))
end

function audio.playTownMusic()
    audio.playMusic(randomFrom(TOWN_MUSIC))
end

-- ───── Ambient ─────

function audio.setAmbient(track)
    if not track then return end
    if ambient.path == track then return end -- already playing this

    if ambient.current then
        -- Crossfade: fade out current, queue next
        ambient.fadeTarget = 0
        ambient.fadeSpeed = 0.8
        ambient.next = { path = track, fadeSpeed = 0.8 }
    else
        -- Start fresh
        local src = streamSource("ambience/" .. track)
        if src then
            src:setLooping(true)
            src:setVolume(0)
            src:play()
            ambient.current = src
            ambient.path = track
            ambient.volume = 0
            ambient.fadeTarget = 1
            ambient.fadeSpeed = 0.8
        end
    end
end

function audio.setAmbientForZone(zoneType)
    local track = ZONE_AMBIENCE[zoneType]
    if track then audio.setAmbient(track) end
end

function audio.setAmbientForDungeon(theme)
    if not theme then return end
    local track = THEME_AMBIENCE[theme] or THEME_AMBIENCE.dungeon
    if track then audio.setAmbient(track) end
end

function audio.stopAmbient(fadeTime)
    if not ambient.current then return end
    ambient.fadeTarget = 0
    ambient.fadeSpeed = 1 / (fadeTime or 1)
    ambient.next = nil
end

-- ───── Weather ambient layer ─────

function audio.setWeather(weather)
    local track = WEATHER_AMBIENT[weather]
    if not track then
        -- No weather layer for this weather, fade out
        if weatherLayer.current then
            weatherLayer.fadeTarget = 0
            weatherLayer.fadeSpeed = 1.0
            weatherLayer.path = nil
        end
        return
    end
    if weatherLayer.path == track then return end

    -- Stop old
    if weatherLayer.current then
        weatherLayer.current:stop()
        weatherLayer.current = nil
    end

    local src = streamSource("ambience/" .. track)
    if src then
        src:setLooping(true)
        src:setVolume(0)
        src:play()
        weatherLayer.current = src
        weatherLayer.path = track
        weatherLayer.volume = 0
        weatherLayer.fadeTarget = 1
        weatherLayer.fadeSpeed = 0.8
    end
end

-- ───── Footsteps ─────

local function getFootstepFiles(surface)
    if surface == "wood" then return files.footstep_wood
    elseif surface == "metal" then return files.footstep_metal
    else return files.footstep_concrete
    end
end

function audio.getSurface(zoneType, biome)
    if zoneType and ZONE_SURFACE[zoneType] then
        return ZONE_SURFACE[zoneType]
    end
    if biome and BIOME_SURFACE[biome] then
        return BIOME_SURFACE[biome]
    end
    return "concrete"
end

-- Call every frame while player is moving on overworld
function audio.tickSelfFootstep(dt, moving, speed, surface)
    if not moving then
        selfFootstep.timer = 0
        return
    end

    -- Adjust cadence by speed: faster movement = faster steps
    local baseSpeed = 200 -- LOCAL_SPEED reference
    local speedRatio = clamp((speed or baseSpeed) / baseSpeed, 0.5, 3)
    selfFootstep.cadence = 0.45 / speedRatio

    selfFootstep.timer = selfFootstep.timer + dt
    if selfFootstep.timer >= selfFootstep.cadence then
        selfFootstep.timer = selfFootstep.timer - selfFootstep.cadence
        local sfc = surface or selfFootstep.lastSurface
        selfFootstep.lastSurface = sfc
        local fileList = getFootstepFiles(sfc)
        local path = randomFrom(fileList)
        if path then
            local src = staticSource(path)
            if src then poolPlay(pools.footsteps, src, "footsteps") end
        end
    end
end

-- Play a single dungeon footstep (concrete by default)
function audio.playDungeonStep()
    local path = randomFrom(files.footstep_concrete)
    if path then
        local src = staticSource(path)
        if src then poolPlay(pools.footsteps, src, "footsteps") end
    end
end

-- Track another player's position for spatial footsteps
function audio.trackOtherPlayer(id, x, y)
    local p = otherPlayers[id]
    if not p then
        otherPlayers[id] = { x = x, y = y, lastX = x, lastY = y, timer = 0, moving = false }
        return
    end
    local dx = x - p.x
    local dy = y - p.y
    p.moving = (dx ~= 0 or dy ~= 0)
    p.lastX = p.x
    p.lastY = p.y
    p.x = x
    p.y = y
end

function audio.removeOtherPlayer(id)
    otherPlayers[id] = nil
end

-- Call in update to tick other-player footsteps
function audio.tickOtherFootsteps(dt)
    local count = 0
    for id, p in pairs(otherPlayers) do
        if p.moving then
            local volume, pan = spatialParams(p.x, p.y)
            if volume > 0.01 then
                p.timer = p.timer + dt
                if p.timer >= 0.5 then
                    p.timer = p.timer - 0.5
                    local path = randomFrom(files.footstep_concrete)
                    if path then
                        local src = staticSource(path)
                        if src then
                            src:setVolume(volume * effectiveVol("footsteps"))
                            -- Use position for stereo
                            src:setRelative(false)
                            local ok = pcall(function()
                                src:setPosition(pan * 2, 0, 0)
                            end)
                            if not ok then
                                src:setVolume(volume * effectiveVol("footsteps"))
                            end
                            poolPlay(pools.footsteps, src, "footsteps")
                            src:setVolume(volume * effectiveVol("footsteps"))
                            count = count + 1
                            if count >= MAX_OTHER_FOOTSTEPS then return end
                        end
                    end
                end
            end
        else
            p.timer = 0
        end
    end
end

-- ───── SFX ─────

local function playSfx(path, volCategory)
    if not path then return end
    volCategory = volCategory or "sfx"
    local fullPath = BASE .. path .. ".ogg"
    if not love.filesystem.getInfo(fullPath) then return end
    local ok, src = pcall(love.audio.newSource, fullPath, "static")
    if ok and src then
        poolPlay(pools[volCategory] or pools.sfx, src, volCategory)
    end
end

local function playRandomSfx(fileList, volCategory)
    local path = randomFrom(fileList)
    if path then playSfx(path, volCategory) end
end

-- Public SFX API

function audio.playHit()
    playRandomSfx(files.combat_hit, "sfx")
end

function audio.playHeavyHit()
    playRandomSfx(files.combat_heavy, "sfx")
end

function audio.playMiss()
    playRandomSfx(files.combat_miss, "sfx")
end

function audio.playSlash()
    playRandomSfx(files.combat_slash, "sfx")
end

function audio.playBlock()
    playSfx("combat/sword_clash_ufx_1", "sfx")
end

function audio.playDeath()
    playSfx("combat/bones_breaking_1", "sfx")
end

function audio.playSwordDraw()
    playSfx("combat/sword_draw_ufx_1", "sfx")
end

function audio.playLevelUp()
    playSfx("items/player_level_up_ufx_1", "sfx")
end

function audio.playItemPickup()
    playSfx("items/item_pickup_ufx_1", "sfx")
end

function audio.playEquip()
    playSfx("items/item_equip_ufx_1", "sfx")
end

function audio.playInventoryOpen()
    playSfx("items/inventory_open", "ui")
end

function audio.playInventoryClose()
    playSfx("items/inventory_close", "ui")
end

function audio.playContainerOpen()
    playSfx("items/container_open_small_ufx_1", "sfx")
end

function audio.playItemBreak()
    playSfx("items/glass_break_ufx_1", "sfx")
end

function audio.playUpgrade()
    local n = math.random(1, 3)
    playSfx("items/item_upgrade_ufx_" .. n, "sfx")
end

function audio.playObjective()
    playSfx("items/new_objective_ufx_1", "ui")
end

function audio.playPortal()
    playSfx("portal/portal_1_start", "sfx")
end

function audio.playDoorOpen()
    playSfx("doors/door_1_open", "sfx")
end

function audio.playLever()
    playSfx("doors/lever_1", "sfx")
end

function audio.playTrap()
    playSfx("doors/crack_1_wood", "sfx")
end

function audio.playExplosion()
    local n = math.random(1, 4)
    playSfx("explosions/explosion_close_long_ufx_" .. n, "sfx")
end

-- ───── UI Sounds ─────

function audio.playClick()
    playRandomSfx(files.ui_click, "ui")
end

function audio.playSubmit()
    playRandomSfx(files.ui_submit, "ui")
end

function audio.playWarning()
    playSfx("ui/ui_warning_mx_1", "ui")
end

function audio.playReturn()
    playSfx("ui/ui_return_mx_1", "ui")
end

-- ───── Cinematic / Stingers ─────

function audio.playCombatStart()
    playSfx("cinematic/sfx_impact_mx_1", "sfx")
end

function audio.playVictory()
    playSfx("cinematic/sfx_gong_mx_1", "sfx")
end

function audio.playDefeat()
    playSfx("cinematic/sfx_descent_mx_1", "sfx")
end

function audio.playTurnBanner()
    playSfx("cinematic/sfx_drums_mx_1", "sfx")
end

function audio.playPackOpen()
    playSfx("cinematic/sfx_ritual_mx_1", "sfx")
end

-- Horror stinger (respects cooldown)
function audio.tryStinger()
    if not stinger.active then return end
    if stinger.cooldown > 0 then return end
    stinger.cooldown = stinger.COOLDOWN_TIME
    playRandomSfx(files.stinger, "sfx")
end

function audio.setDarkFloor(isDark)
    stinger.active = isDark
    if not isDark then stinger.cooldown = 0 end
end

-- ───── Creature sounds ─────

function audio.playCreatureRoar()
    local n = math.random(1, 7)
    playSfx("creatures/monster_roar_" .. n, "creature")
end

function audio.playCreatureDistant()
    local n = math.random(1, 4)
    playSfx("creatures/monster_roar_distant_" .. n, "creature")
end

-- ───── Camera reference (call from game.lua each frame) ─────

function audio.setCamera(cx, cy)
    camRef.x = cx
    camRef.y = cy
end

function audio.setScreenWidth(w)
    screenW = w
end

-- ───── Volume controls ─────

function audio.setVolume(category, value)
    if vol[category] ~= nil then
        vol[category] = clamp(value, 0, 1)
        audio.savePrefs()
    end
end

function audio.getVolume(category)
    return vol[category] or 0
end

function audio.getVolumes()
    local result = {}
    for k, v in pairs(vol) do result[k] = v end
    return result
end

-- ───── Preferences persistence ─────

function audio.savePrefs()
    local data = "{"
    local first = true
    for k, v in pairs(vol) do
        if not first then data = data .. "," end
        data = data .. '"' .. k .. '":' .. tostring(v)
        first = false
    end
    data = data .. "}"
    local ok, err = pcall(love.filesystem.write, PREFS_FILE, data)
    if not ok then
        -- Silently fail; preferences are non-critical
    end
end

function audio.loadPrefs()
    if not love.filesystem.getInfo(PREFS_FILE) then return end
    local ok, content = pcall(love.filesystem.read, PREFS_FILE)
    if not ok or not content then return end
    -- Minimal JSON parse for flat {key:number} object
    for k, v in content:gmatch('"(%w+)"%s*:%s*([%d%.]+)') do
        local num = tonumber(v)
        if num and vol[k] ~= nil then
            vol[k] = clamp(num, 0, 1)
        end
    end
end

-- ───── Cleanup ─────

function audio.cleanup()
    -- Stop all sources
    if music.current then music.current:stop(); music.current = nil end
    music.name = nil; music.phase = nil; music.queued = nil; music.volume = 0
    if ambient.current then ambient.current:stop(); ambient.current = nil end
    ambient.path = nil; ambient.volume = 0; ambient.next = nil
    if weatherLayer.current then weatherLayer.current:stop(); weatherLayer.current = nil end
    weatherLayer.path = nil; weatherLayer.volume = 0

    for _, pool in pairs(pools) do
        for i, src in pairs(pool.sources) do
            if src then src:stop() end
            pool.sources[i] = nil
        end
        pool.idx = 1
    end

    otherPlayers = {}
    stinger.active = false
    stinger.cooldown = 0
    selfFootstep.timer = 0
end

-- Stop all audio instantly (scene transition)
function audio.stopAll()
    love.audio.stop()
    if music.current then music.current = nil end
    music.name = nil; music.phase = nil; music.queued = nil; music.volume = 0
    if ambient.current then ambient.current = nil end
    ambient.path = nil; ambient.volume = 0; ambient.next = nil
    if weatherLayer.current then weatherLayer.current = nil end
    weatherLayer.path = nil; weatherLayer.volume = 0

    for _, pool in pairs(pools) do
        for i in pairs(pool.sources) do pool.sources[i] = nil end
        pool.idx = 1
    end
end

return audio
