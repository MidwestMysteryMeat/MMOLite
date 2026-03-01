-- particles.lua — Particle system manager for dungeon light source effects
-- Uses love.graphics.newParticleSystem with a procedural circle image (no assets).

local particles = {}

-- Procedural 8x8 white circle image
local circleImage = nil

-- Active particle systems keyed by identity string "type_x_y"
local systems = {}

-- Max concurrent systems (viewport-culled, so this is a hard cap)
local MAX_SYSTEMS = 20

-- ---------------------------------------------------------------------------
-- Particle presets
-- ---------------------------------------------------------------------------

local PRESETS = {
    torch = {
        emission = 12,
        lifetime = { 0.3, 0.8 },
        speed = { 15, 40 },
        spread = math.rad(30),
        direction = -math.pi / 2, -- upward
        sizes = { 0.6, 0.3, 0.1 },
        colors = {
            1.0, 0.95, 0.3, 0.9,   -- bright yellow
            1.0, 0.55, 0.1, 0.7,   -- orange
            0.6, 0.15, 0.05, 0.0,  -- dark red fade
        },
        areaSpread = { "uniform", 3, 1 },
        linearDamping = 1,
    },
    torch_embers = {
        emission = 2,
        lifetime = { 0.5, 1.5 },
        speed = { 8, 25 },
        spread = math.rad(60),
        direction = -math.pi / 2,
        sizes = { 0.35, 0.2, 0.05 },
        colors = {
            1.0, 0.6, 0.1, 0.8,   -- orange
            0.9, 0.2, 0.05, 0.5,  -- red
            0.4, 0.1, 0.02, 0.0,  -- fade
        },
        areaSpread = { "uniform", 6, 2 },
        linearDamping = 0.5,
    },
    lantern = {
        emission = 5,
        lifetime = { 0.5, 1.2 },
        speed = { 8, 20 },
        spread = math.rad(20),
        direction = -math.pi / 2,
        sizes = { 0.5, 0.3, 0.1 },
        colors = {
            1.0, 0.95, 0.80, 0.6, -- warm white
            1.0, 0.85, 0.45, 0.4, -- gold
            0.8, 0.6, 0.2, 0.0,   -- fade
        },
        areaSpread = { "uniform", 2, 1 },
        linearDamping = 1.5,
    },
    campfire = {
        emission = 20,
        lifetime = { 0.4, 1.2 },
        speed = { 20, 55 },
        spread = math.rad(40),
        direction = -math.pi / 2,
        sizes = { 0.8, 0.5, 0.2, 0.05 },
        colors = {
            1.0, 1.0, 0.4, 1.0,   -- bright yellow
            1.0, 0.55, 0.1, 0.8,  -- orange
            0.6, 0.15, 0.05, 0.4, -- dark red
            0.1, 0.05, 0.02, 0.0, -- near-black fade
        },
        areaSpread = { "uniform", 5, 2 },
        linearDamping = 0.8,
    },
    magic_swirl = {
        emission = 6,
        lifetime = { 0.6, 1.4 },
        speed = { 10, 30 },
        spread = math.rad(360),
        direction = 0,
        sizes = { 0.4, 0.5, 0.2 },
        colors = {
            0.7, 0.3, 1.0, 0.7,   -- purple
            0.4, 0.2, 0.9, 0.5,   -- deep purple
            0.2, 0.1, 0.6, 0.0,   -- fade
        },
        areaSpread = { "uniform", 4, 4 },
        linearDamping = 2,
        spin = { -3, 3 },
    },
}

-- Map light source types to particle preset keys
local TYPE_TO_PRESET = {
    torch = { "torch", "torch_embers" },
    player_torch = { "torch", "torch_embers" },
    lantern = { "lantern" },
    player_lantern = { "lantern" },
    campfire = { "campfire" },
    magic_aura = { "magic_swirl" },
}

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

local function createCircleImage()
    local size = 8
    local data = love.image.newImageData(size, size)
    local cx, cy = size / 2 - 0.5, size / 2 - 0.5
    local maxR = size / 2
    for y = 0, size - 1 do
        for x = 0, size - 1 do
            local dx, dy = x - cx, y - cy
            local dist = math.sqrt(dx * dx + dy * dy)
            local alpha = math.max(0, 1 - dist / maxR)
            data:setPixel(x, y, 1, 1, 1, alpha)
        end
    end
    circleImage = love.graphics.newImage(data)
    circleImage:setFilter("linear", "linear")
end

local function createSystem(preset)
    if not circleImage then createCircleImage() end
    local p = PRESETS[preset]
    if not p then return nil end

    local ps = love.graphics.newParticleSystem(circleImage, 64)
    ps:setParticleLifetime(p.lifetime[1], p.lifetime[2])
    ps:setEmissionRate(p.emission)
    ps:setSpeed(p.speed[1], p.speed[2])
    ps:setSpread(p.spread)
    ps:setDirection(p.direction)
    ps:setSizes(unpack(p.sizes))
    ps:setColors(unpack(p.colors))
    ps:setLinearDamping(p.linearDamping or 0)
    if p.areaSpread then
        ps:setEmissionArea(p.areaSpread[1], p.areaSpread[2], p.areaSpread[3])
    end
    if p.spin then
        ps:setSpin(p.spin[1], p.spin[2])
    end
    return ps
end

-- ---------------------------------------------------------------------------
-- Public API
-- ---------------------------------------------------------------------------

--- Update particle systems to match current light sources.
-- Creates new systems, removes stale ones, updates dt.
-- @param dt           Delta time
-- @param lightSources Array of {x, y, r, b, t} from server
-- @param cameraX      Camera offset X (pixels)
-- @param cameraY      Camera offset Y (pixels)
-- @param tileSize     Tile size in pixels
function particles.update(dt, lightSources, cameraX, cameraY, tileSize)
    local sw, sh = love.graphics.getDimensions()
    local margin = tileSize * 3

    -- Track which keys are still active this frame
    local activeKeys = {}

    if lightSources then
        for i = 1, #lightSources do
            local s = lightSources[i]
            local screenX = s.x * tileSize + tileSize * 0.5 + cameraX
            local screenY = s.y * tileSize + tileSize * 0.5 + cameraY

            -- Viewport culling
            if screenX > -margin and screenX < sw + margin and screenY > -margin and screenY < sh + margin then
                local presetList = TYPE_TO_PRESET[s.t]
                if presetList then
                    for pi = 1, #presetList do
                        local presetName = presetList[pi]
                        local key = presetName .. "_" .. s.x .. "_" .. s.y

                        activeKeys[key] = true

                        if not systems[key] then
                            -- Check system cap
                            local count = 0
                            for _ in pairs(systems) do count = count + 1 end
                            if count < MAX_SYSTEMS then
                                systems[key] = {
                                    ps = createSystem(presetName),
                                    x = screenX,
                                    y = screenY,
                                }
                            end
                        else
                            -- Update position (player-held lights move)
                            systems[key].x = screenX
                            systems[key].y = screenY
                        end
                    end
                end
            end
        end
    end

    -- Remove systems no longer in the source list
    for key, sys in pairs(systems) do
        if not activeKeys[key] then
            if sys.ps then sys.ps:release() end
            systems[key] = nil
        else
            sys.ps:update(dt)
        end
    end
end

--- Draw all active particle systems (additive blend, world space).
-- Call between love.graphics.push/pop with camera transform applied.
function particles.draw()
    love.graphics.setBlendMode("add")
    for _, sys in pairs(systems) do
        love.graphics.draw(sys.ps, sys.x, sys.y)
    end
    love.graphics.setBlendMode("alpha")
end

--- Release all systems and the circle image.
function particles.cleanup()
    for key, sys in pairs(systems) do
        if sys.ps then sys.ps:release() end
        systems[key] = nil
    end
    if circleImage then circleImage:release(); circleImage = nil end
end

return particles
