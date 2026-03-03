-- lib/sprite-sheet.lua
-- Sprite sheet loader and animation player for 2D sprites rendered from 3D assets.
--
-- Usage:
--   local SpriteSheet = require("lib.sprite-sheet")
--   local goblin = SpriteSheet.load("assets/sprites/goblin")
--
--   -- In update():
--   SpriteSheet.update(goblin, "walk", "south", dt)
--
--   -- In draw():
--   SpriteSheet.draw(goblin, x, y, scale)   -- draws current animation frame

local SpriteSheet = {}

-- Pixels per in-game unit — used to scale sprites to match the primitive-drawn world.
-- 1 game unit = 1 pixel in the primitive renderer, so set this to match your sprite sizes.
-- e.g. if sprites were rendered at 128px for a character that's "64 units tall", scale = 0.5
SpriteSheet.DEFAULT_SCALE = 1.0
SpriteSheet.DEFAULT_FPS   = 8

-- ── Internal helpers ───────────────────────────────────────────────────────

local function parse_manifest(json_path)
    local raw = love.filesystem.read(json_path)
    if not raw then
        error("sprite-sheet: cannot read " .. json_path)
    end
    -- Minimal JSON parser using json.lua or fallback to our bundled one.
    -- If you have a json library already (dkjson, rxi/json, etc.) swap it in here.
    local ok, data = pcall(require("lib.json").decode, raw)
    if not ok then
        error("sprite-sheet: JSON parse error in " .. json_path .. ": " .. tostring(data))
    end
    return data
end

local function build_quad_cache(manifest, images)
    -- Returns { frame_key → { sheet_idx, quad, offset_x, offset_y, src_w, src_h } }
    local quads = {}
    for key, fd in pairs(manifest.frames or {}) do
        local img    = images[fd.sheet + 1]   -- manifest is 0-indexed, Lua is 1-indexed
        if img then
            local iw, ih = img:getDimensions()
            local f  = fd.frame
            local q  = love.graphics.newQuad(f.x, f.y, f.w, f.h, iw, ih)
            quads[key] = {
                sheet   = fd.sheet + 1,
                quad    = q,
                -- Trim offsets (how far the sprite was from the top-left of its source rect)
                off_x   = fd.offset and fd.offset.x or 0,
                off_y   = fd.offset and fd.offset.y or 0,
                src_w   = fd.source and fd.source.w or f.w,
                src_h   = fd.source and fd.source.h or f.h,
                frame_w = f.w,
                frame_h = f.h,
            }
        end
    end
    return quads
end

-- ── Public API ─────────────────────────────────────────────────────────────

---Load a sprite sheet from the given asset directory.
---The directory must contain `<name>.json` and `<name>_00.png` etc.
---@param asset_path string  e.g. "assets/sprites/goblin"
---@return table  sprite object to pass into other SpriteSheet functions
function SpriteSheet.load(asset_path)
    -- Normalise path
    local dir  = asset_path:gsub("\\", "/"):gsub("/$", "")
    local name = dir:match("([^/]+)$")

    local manifest = parse_manifest(dir .. "/" .. name .. ".json")

    -- Load all sheet images
    local images = {}
    for i, sheet_file in ipairs(manifest.sheets or {}) do
        local img_path = dir .. "/" .. sheet_file
        local ok, img  = pcall(love.graphics.newImage, img_path)
        if not ok then
            error("sprite-sheet: cannot load image " .. img_path)
        end
        img:setFilter("nearest", "nearest")   -- pixel-crisp
        images[i] = img
    end

    local quads = build_quad_cache(manifest, images)

    -- Build animation tables: { anim_key → { frames=[{quad_data},...], fps } }
    local animations = {}
    for anim_key, frame_keys in pairs(manifest.animations or {}) do
        local anim_frames = {}
        for _, fk in ipairs(frame_keys) do
            if quads[fk] then
                anim_frames[#anim_frames + 1] = quads[fk]
            end
        end
        if #anim_frames > 0 then
            -- Infer FPS from key suffix (e.g. "goblin_walk_south" → "walk")
            local fps = SpriteSheet.DEFAULT_FPS
            for _, speed_kw in ipairs({"idle", "walk", "run", "attack", "cast", "death", "hurt"}) do
                if anim_key:lower():find(speed_kw) then
                    fps = SpriteSheet._anim_fps[speed_kw] or fps
                    break
                end
            end
            animations[anim_key] = { frames = anim_frames, fps = fps }
        end
    end

    -- Also expose static frames directly (one-frame "animations")
    for key, qd in pairs(quads) do
        if not manifest.animations or not manifest.animations[key] then
            animations[key] = { frames = { qd }, fps = 1 }
        end
    end

    return {
        name       = name,
        images     = images,
        quads      = quads,
        animations = animations,
        manifest   = manifest,

        -- Playback state (mutable)
        _anim      = nil,      -- current animation key
        _frame     = 1,        -- current frame index
        _timer     = 0,        -- time accumulator
        _loop      = true,
        _done      = false,
    }
end

-- Default FPS by animation name keyword
SpriteSheet._anim_fps = {
    idle   = 6,
    walk   = 8,
    run    = 10,
    attack = 10,
    cast   = 8,
    death  = 6,
    hurt   = 10,
}

---Choose a direction-aware animation key.
---Looks for `<base>_<direction>` first, then falls back to `<base>`.
---@param sprite  table
---@param base    string  e.g. "goblin_walk"
---@param dir     string  e.g. "south" | "north" | "east" | "west"
---@return string  resolved animation key
function SpriteSheet.resolve(sprite, base, dir)
    local full = base .. "_" .. (dir or "south")
    if sprite.animations[full] then return full end
    if sprite.animations[base] then return base end
    -- Try partial match
    for key in pairs(sprite.animations) do
        if key:find(base, 1, true) then return key end
    end
    return nil
end

---Set the current animation (does not reset frame if same animation).
---@param sprite  table
---@param anim    string  animation key (e.g. "goblin_walk_south")
---@param loop    boolean  default true
function SpriteSheet.play(sprite, anim, loop)
    if anim == sprite._anim then return end
    sprite._anim  = anim
    sprite._frame = 1
    sprite._timer = 0
    sprite._loop  = loop ~= false
    sprite._done  = false
end

---Convenience: play by base + facing direction.
---Converts LÖVE facing ("up","down","left","right") → sprite direction ("north","south","west","east").
local FACING_TO_DIR = { up="north", down="south", left="west", right="east" }
function SpriteSheet.playFacing(sprite, base, facing, loop)
    local dir  = FACING_TO_DIR[facing] or facing or "south"
    local key  = SpriteSheet.resolve(sprite, base, dir)
    if key then SpriteSheet.play(sprite, key, loop) end
end

---Advance animation timer.
---@param sprite table
---@param dt     number  delta time in seconds
function SpriteSheet.update(sprite, dt)
    if not sprite._anim then return end
    local anim = sprite.animations[sprite._anim]
    if not anim or #anim.frames == 0 then return end

    sprite._timer = sprite._timer + dt
    local frame_dur = 1.0 / (anim.fps or SpriteSheet.DEFAULT_FPS)

    while sprite._timer >= frame_dur do
        sprite._timer = sprite._timer - frame_dur
        sprite._frame = sprite._frame + 1
        if sprite._frame > #anim.frames then
            if sprite._loop then
                sprite._frame = 1
            else
                sprite._frame = #anim.frames
                sprite._done  = true
                break
            end
        end
    end
end

---Draw the current frame.
---@param sprite  table
---@param x       number  world x (center-bottom of sprite, matching primitive renderer)
---@param y       number  world y
---@param scale   number  optional scale override
---@param ox      number  optional x origin override (default = center)
---@param oy      number  optional y origin override (default = bottom)
function SpriteSheet.draw(sprite, x, y, scale, ox, oy)
    if not sprite._anim then return end
    local anim = sprite.animations[sprite._anim]
    if not anim or #anim.frames == 0 then return end

    local fd  = anim.frames[sprite._frame]
    local img = sprite.images[fd.sheet]
    if not img then return end

    scale = scale or SpriteSheet.DEFAULT_SCALE

    -- Restore trimmed position: draw at (x - off_x*scale, y - off_y*scale)
    -- Origin anchored to bottom-center of the source rect (matches in-game position)
    local draw_ox = ox or (fd.src_w / 2 - fd.off_x)
    local draw_oy = oy or (fd.src_h   - fd.off_y)

    love.graphics.draw(img, fd.quad, x, y, 0, scale, scale, draw_ox, draw_oy)
end

---Draw a named static frame (not animation-based).
---@param sprite table
---@param key    string  frame key from manifest
---@param x      number
---@param y      number
---@param scale  number
function SpriteSheet.drawFrame(sprite, key, x, y, scale)
    local fd  = sprite.quads[key]
    if not fd then return end
    local img = sprite.images[fd.sheet]
    if not img then return end
    scale = scale or SpriteSheet.DEFAULT_SCALE
    local draw_ox = fd.src_w / 2 - fd.off_x
    local draw_oy = fd.src_h     - fd.off_y
    love.graphics.draw(img, fd.quad, x, y, 0, scale, scale, draw_ox, draw_oy)
end

---Free GPU resources when no longer needed.
function SpriteSheet.release(sprite)
    for _, img in ipairs(sprite.images or {}) do
        img:release()
    end
    sprite.images = {}
    sprite.quads  = {}
end

-- ── Sprite registry (optional — cache loaded sprites globally) ─────────────

local _registry = {}

---Load-or-return-cached sprite sheet.
---@param path string  asset path (e.g. "assets/sprites/goblin")
---@return table
function SpriteSheet.get(path)
    if not _registry[path] then
        _registry[path] = SpriteSheet.load(path)
    end
    return _registry[path]
end

---Preload a list of sprite paths (call from load screen).
---@param paths string[]
function SpriteSheet.preload(paths)
    for _, p in ipairs(paths) do
        if not _registry[p] then
            local ok, err = pcall(function() _registry[p] = SpriteSheet.load(p) end)
            if not ok then
                -- Non-fatal: fall back to primitive rendering
                print("[sprite-sheet] preload failed for " .. p .. ": " .. tostring(err))
            end
        end
    end
end

---Release all cached sprites.
function SpriteSheet.releaseAll()
    for path, sprite in pairs(_registry) do
        SpriteSheet.release(sprite)
        _registry[path] = nil
    end
end

return SpriteSheet
