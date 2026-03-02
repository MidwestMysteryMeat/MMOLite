-- lighting.lua — Canvas-based multiply-blend dungeon lighting with bloom
-- Uses half-res (default) light canvas rendered over the scene.

local lighting = {}

-- Canvases
local lightCanvas = nil
local bloomCanvasH = nil
local bloomCanvasV = nil

-- Shader (gaussian blur for bloom)
local blurShader = nil
local shaderSupported = true

-- Quality: "high" (full-res, bloom), "medium" (half-res, bloom), "low" (quarter-res, no bloom)
local quality = "medium"
local resScale = 0.5

-- Cached dimensions
local canvasW, canvasH = 0, 0
local screenW, screenH = 0, 0

-- Light color presets
local LIGHT_COLORS = {
    torch        = { 1.0, 0.72, 0.30 },
    player_torch = { 1.0, 0.72, 0.30 },
    lantern      = { 1.0, 0.92, 0.70 },
    player_lantern = { 1.0, 0.92, 0.70 },
    campfire     = { 1.0, 0.55, 0.15 },
}
local DEFAULT_LIGHT_COLOR = { 1.0, 0.8, 0.5 }

-- Vision type ambient tints { r, g, b } and brightness multiplier
local VISION_AMBIENTS = {
    normal       = { tint = { 0.08, 0.08, 0.12 }, mult = 1.0 },
    thermal      = { tint = { 0.22, 0.08, 0.03 }, mult = 0.85 },
    night        = { tint = { 0.04, 0.12, 0.04 }, mult = 1.8 },
    tremor       = { tint = { 0.12, 0.10, 0.06 }, mult = 1.0 },
    echolocation = { tint = { 0.04, 0.04, 0.14 }, mult = 0.7 },
    magic_sense  = { tint = { 0.10, 0.04, 0.14 }, mult = 1.0 },
    true_seeing  = { tint = { 0.14, 0.12, 0.06 }, mult = 1.3 },
    darkvision   = { tint = { 0.06, 0.08, 0.10 }, mult = 1.5 },
}

-- Vision overlay tints — full-screen additive pass so every mode is visually distinct
local VISION_OVERLAYS = {
    -- { r, g, b, alpha } drawn after the multiply lighting pass
    thermal      = { 0.35, 0.08, 0.0,  0.12 },
    night        = { 0.0,  0.18, 0.0,  0.10 },
    tremor       = { 0.20, 0.15, 0.0,  0.08 },
    echolocation = { 0.0,  0.06, 0.30, 0.12 },
    magic_sense  = { 0.18, 0.0,  0.25, 0.10 },
    true_seeing  = { 0.22, 0.18, 0.0,  0.08 },
    darkvision   = { 0.0,  0.10, 0.05, 0.06 },
}

-- Blur shader source (separable 5-tap gaussian)
local BLUR_GLSL = [[
extern vec2 direction;
extern float blurSize;
vec4 effect(vec4 color, Image tex, vec2 tc, vec2 sc) {
    vec4 sum = vec4(0.0);
    float weights[5] = float[](0.0625, 0.25, 0.375, 0.25, 0.0625);
    for (int i = -2; i <= 2; i++) {
        sum += Texel(tex, tc + direction * float(i) * blurSize) * weights[i + 2];
    }
    return sum * color;
}
]]

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

local function createCanvases(w, h)
    canvasW = math.max(1, math.floor(w * resScale))
    canvasH = math.max(1, math.floor(h * resScale))
    screenW = w
    screenH = h

    lightCanvas = love.graphics.newCanvas(canvasW, canvasH)
    lightCanvas:setFilter("linear", "linear")

    if quality ~= "low" and shaderSupported then
        bloomCanvasH = love.graphics.newCanvas(canvasW, canvasH)
        bloomCanvasH:setFilter("linear", "linear")
        bloomCanvasV = love.graphics.newCanvas(canvasW, canvasH)
        bloomCanvasV:setFilter("linear", "linear")
    else
        bloomCanvasH = nil
        bloomCanvasV = nil
    end
end

local function ensureShader()
    if blurShader or not shaderSupported then return end
    local ok, shader = pcall(love.graphics.newShader, BLUR_GLSL)
    if ok then
        blurShader = shader
    else
        shaderSupported = false
    end
end

-- Draw a smooth radial gradient circle (concentric rings with falloff)
local function drawRadialLight(cx, cy, radius, brightness, r, g, b, flickerPhase, time)
    -- Flicker: subtle sin-wave variation per light
    local flicker = math.sin(time * 3.5 + flickerPhase) * 0.06 + 0.94
    local finalBright = brightness * flicker

    local steps = math.max(6, math.floor(radius / 2))
    for i = steps, 1, -1 do
        local frac = i / steps
        local rad = radius * frac
        -- Quadratic falloff for smoother edges
        local alpha = finalBright * (1 - frac * frac) * 0.9
        if alpha > 0.005 then
            love.graphics.setColor(r * alpha, g * alpha, b * alpha, 1)
            love.graphics.circle("fill", cx, cy, rad)
        end
    end
    -- Hot center core
    local coreAlpha = finalBright * 0.4
    love.graphics.setColor(r * coreAlpha, g * coreAlpha, b * coreAlpha, 1)
    love.graphics.circle("fill", cx, cy, radius * 0.15)
end

-- ---------------------------------------------------------------------------
-- Public API
-- ---------------------------------------------------------------------------

local function loadPrefs()
    local ok, data = pcall(love.filesystem.read, "lighting_prefs.json")
    if ok and data then
        local q = data:match('"quality"%s*:%s*"(%w+)"')
        if q == "high" or q == "medium" or q == "low" then return q end
    end
    return nil
end

local function savePrefs()
    pcall(love.filesystem.write, "lighting_prefs.json", '{"quality":"' .. quality .. '"}')
end

function lighting.init()
    ensureShader()
    local saved = loadPrefs()
    if saved then
        lighting.setQuality(saved, true)
    end
    local w, h = love.graphics.getDimensions()
    createCanvases(w, h)
end

function lighting.resize(w, h)
    createCanvases(w, h)
end

function lighting.setQuality(q, skipSave)
    if q == "high" then
        quality = "high"
        resScale = 1.0
    elseif q == "low" then
        quality = "low"
        resScale = 0.25
    else
        quality = "medium"
        resScale = 0.5
    end
    local w, h = love.graphics.getDimensions()
    createCanvases(w, h)
    if not skipSave then savePrefs() end
end

function lighting.getQuality()
    return quality
end

--- Render the light canvas.
-- @param sources     Array of {x, y, r, b, t} from server (tile coords)
-- @param ambientLight  0-1 ambient light level for the floor
-- @param cameraX     Camera offset X (pixels)
-- @param cameraY     Camera offset Y (pixels)
-- @param visionType  String vision type ("normal", "thermal", etc.)
-- @param tileSize    Tile size in pixels
-- @param thermalEntities  Optional array of thermal blobs for thermal vision
function lighting.render(sources, ambientLight, cameraX, cameraY, visionType, tileSize, thermalEntities)
    if not lightCanvas then return end

    local time = love.timer.getTime()

    -- Resolve vision ambient
    local va = VISION_AMBIENTS[visionType] or VISION_AMBIENTS.normal
    local tint = va.tint
    local ambMult = va.mult

    -- Effective ambient: floor ambient scaled by vision multiplier
    local effAmbient = math.min(1.0, (ambientLight or 0.4) * ambMult)

    -- Ambient darkness color: darker = more tinted
    local darkness = 1 - effAmbient
    local ambR = tint[1] * darkness + effAmbient
    local ambG = tint[2] * darkness + effAmbient
    local ambB = tint[3] * darkness + effAmbient

    -- Scale factor from screen to canvas
    local sx = canvasW / screenW
    local sy = canvasH / screenH

    love.graphics.setCanvas(lightCanvas)
    love.graphics.clear(ambR, ambG, ambB, 1)

    -- Switch to additive blend for light accumulation
    love.graphics.setBlendMode("add")

    -- Draw each light source
    if sources then
        for i = 1, #sources do
            local s = sources[i]
            -- Convert tile coords to screen coords, then to canvas coords
            local px = (s.x * tileSize + tileSize * 0.5 + cameraX) * sx
            local py = (s.y * tileSize + tileSize * 0.5 + cameraY) * sy
            local pr = s.r * tileSize * sx  -- radius in canvas pixels

            local col = LIGHT_COLORS[s.t] or DEFAULT_LIGHT_COLOR
            -- Unique flicker phase per source position
            local phase = (s.x * 7.3 + s.y * 13.7) % 6.28

            drawRadialLight(px, py, pr, s.b or 0.6, col[1], col[2], col[3], phase, time)
        end
    end

    -- Thermal vision: draw heat blobs for thermal entities
    if visionType == "thermal" and thermalEntities and #thermalEntities > 0 then
        for i = 1, #thermalEntities do
            local te = thermalEntities[i]
            local px = (te.x * tileSize + tileSize * 0.5 + cameraX) * sx
            local py = (te.y * tileSize + tileSize * 0.5 + cameraY) * sy
            local intensity = te.intensity or 0.5
            if te.type == "living" or te.type == "player" then
                -- Warm glow for living things
                drawRadialLight(px, py, tileSize * 1.2 * sx, intensity * 0.5, 1.0, 0.4, 0.1, i * 2.1, time)
            else
                -- Cold blue for constructs/undead
                drawRadialLight(px, py, tileSize * 0.8 * sx, intensity * 0.3, 0.2, 0.3, 0.8, i * 3.7, time)
            end
        end
    end

    love.graphics.setBlendMode("alpha")
    love.graphics.setCanvas()
end

--- Apply the light canvas over the scene (multiply blend), then vision overlay, then bloom.
function lighting.apply(visionType)
    if not lightCanvas then return end

    -- Main lighting pass: multiply blend darkens the scene
    love.graphics.setBlendMode("multiply", "premultiplied")
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.draw(lightCanvas, 0, 0, 0, screenW / canvasW, screenH / canvasH)
    love.graphics.setBlendMode("alpha")

    -- Vision color overlay (full-screen tint visible everywhere)
    if visionType and VISION_OVERLAYS[visionType] then
        local ov = VISION_OVERLAYS[visionType]
        love.graphics.setBlendMode("add")
        love.graphics.setColor(ov[1], ov[2], ov[3], ov[4])
        love.graphics.rectangle("fill", 0, 0, screenW, screenH)
        love.graphics.setBlendMode("alpha")
    end

    -- Bloom pass (skip on low quality or no shader support)
    if quality == "low" or not blurShader or not bloomCanvasH or not bloomCanvasV then
        return
    end

    local blurSize = 1.5 / canvasW

    -- Horizontal blur
    love.graphics.setCanvas(bloomCanvasH)
    love.graphics.clear(0, 0, 0, 1)
    love.graphics.setShader(blurShader)
    blurShader:send("direction", { 1.0, 0.0 })
    blurShader:send("blurSize", blurSize)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.draw(lightCanvas, 0, 0)
    love.graphics.setShader()
    love.graphics.setCanvas()

    -- Vertical blur
    love.graphics.setCanvas(bloomCanvasV)
    love.graphics.clear(0, 0, 0, 1)
    love.graphics.setShader(blurShader)
    blurShader:send("direction", { 0.0, 1.0 })
    blurShader:send("blurSize", blurSize)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.draw(bloomCanvasH, 0, 0)
    love.graphics.setShader()
    love.graphics.setCanvas()

    -- Composite bloom at 30% intensity (additive)
    love.graphics.setBlendMode("add")
    love.graphics.setColor(0.3, 0.3, 0.3, 1)
    love.graphics.draw(bloomCanvasV, 0, 0, 0, screenW / canvasW, screenH / canvasH)
    love.graphics.setBlendMode("alpha")
end

function lighting.cleanup()
    if lightCanvas then lightCanvas:release(); lightCanvas = nil end
    if bloomCanvasH then bloomCanvasH:release(); bloomCanvasH = nil end
    if bloomCanvasV then bloomCanvasV:release(); bloomCanvasV = nil end
    if blurShader then blurShader:release(); blurShader = nil end
    canvasW, canvasH = 0, 0
end

return lighting
