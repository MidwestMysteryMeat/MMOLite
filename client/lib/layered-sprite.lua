-- lib/layered-sprite.lua
-- Composites multiple sprite sheet layers (body, chest, legs, weapon, etc.)
-- into a single rendered character at runtime.
--
-- All layers share one animation clock so frames stay perfectly in sync.
-- Each layer is a separate transparent PNG sheet rendered from the same camera/pose.
--
-- Usage:
--   local LayeredSprite = require("lib.layered-sprite")
--   local SpriteSheet   = require("lib.sprite-sheet")
--
--   local human = LayeredSprite.new("human_male")
--
--   -- Equip items (can call any time during play)
--   LayeredSprite.equip(human, "chest",    SpriteSheet.get("assets/sprites/equip/plate_chest"))
--   LayeredSprite.equip(human, "weapon_r", SpriteSheet.get("assets/sprites/equip/iron_sword"))
--
--   -- In update():
--   LayeredSprite.update(human, dt)
--
--   -- In draw():
--   LayeredSprite.draw(human, x, y, scale)

local SpriteSheet    = require("lib.sprite-sheet")
local LayeredSprite  = {}

-- ── Draw order (bottom → top) ──────────────────────────────────────────────
-- Mirrors SLOTS_CFG.draw_order from equipment_slots.json
local DRAW_ORDER = {
    "body_base",
    "legs",
    "boots",
    "chest",
    "gloves",
    "shoulders",
    "helmet",
    "cloak",
    "weapon_r",
    "weapon_l",
    "offhand",
}

-- facing → sprite direction name (matches Blender render direction names)
local FACING_TO_DIR = { up="north", down="south", left="west", right="east" }

-- ────────────────────────────────────────────────────────────────────────────

---Create a new layered sprite character.
---@param base_asset_path string  e.g. "assets/sprites/human_male"
---@return table
function LayeredSprite.new(base_asset_path)
    local base   = SpriteSheet.get(base_asset_path)
    local layers = {}   -- { slot → SpriteSheet object }
    layers["body_base"] = base

    return {
        base_path = base_asset_path,
        layers    = layers,

        -- Shared animation clock (all layers tick from this)
        _anim    = nil,        -- e.g. "human_male_walk"
        _dir     = "south",
        _frame   = 1,
        _timer   = 0,
        _fps     = SpriteSheet.DEFAULT_FPS,
        _loop    = true,
        _done    = false,
        _max_frames = 1,
    }
end

---Equip or replace an equipment layer.
---Passing nil removes the slot.
---@param char  table
---@param slot  string  e.g. "chest", "weapon_r", "helmet"
---@param sheet table|nil  SpriteSheet object (from SpriteSheet.get/load)
function LayeredSprite.equip(char, slot, sheet)
    char.layers[slot] = sheet
end

---Unequip a slot.
function LayeredSprite.unequip(char, slot)
    char.layers[slot] = nil
end

-- ── Animation control ───────────────────────────────────────────────────────

---Resolve the animation key for a given layer.
---Convention: frames are named  <asset>_<anim>_<dir>_<nnnn>
---e.g. human_male_walk_south_0001  → group: human_male_walk_south
local function resolve_key(sheet, anim_base, dir)
    -- Try "<anim_base>_<dir>"
    local full = anim_base .. "_" .. dir
    if sheet.animations[full] then return full end
    -- Try just "<anim_base>"
    if sheet.animations[anim_base] then return anim_base end
    -- Partial match: find any anim containing anim_base
    for key in pairs(sheet.animations) do
        if key:find(anim_base, 1, true) then return key end
    end
    -- Last resort: pick the first available animation
    local first = next(sheet.animations)
    return first
end

---Set animation for all layers simultaneously.
---@param char    table
---@param anim    string  animation base name (e.g. "walk", "attack")
---@param facing  string  LÖVE facing: "up"|"down"|"left"|"right"
---@param loop    boolean
function LayeredSprite.play(char, anim, facing, loop)
    local dir      = FACING_TO_DIR[facing] or facing or "south"
    char._dir      = dir
    char._loop     = loop ~= false
    char._done     = false

    -- Compute max frame count across all layers for this anim+dir
    local max_frames = 1
    local fps        = SpriteSheet.DEFAULT_FPS

    for slot in pairs(char.layers) do
        local sheet = char.layers[slot]
        if sheet then
            local key = resolve_key(sheet, anim, dir)
            if key and sheet.animations[key] then
                local n = #sheet.animations[key].frames
                if n > max_frames then max_frames = n end
                fps = sheet.animations[key].fps or fps
            end
        end
    end

    if anim == char._anim and dir == char._dir then return end  -- already playing

    char._anim       = anim
    char._frame      = 1
    char._timer      = 0
    char._fps        = fps
    char._max_frames = max_frames
end

---Advance the shared animation clock (call once per update, NOT per layer).
---@param char table
---@param dt   number
function LayeredSprite.update(char, dt)
    if not char._anim then return end

    char._timer = char._timer + dt
    local dur   = 1.0 / math.max(1, char._fps)

    while char._timer >= dur do
        char._timer = char._timer - dur
        char._frame = char._frame + 1
        if char._frame > char._max_frames then
            if char._loop then
                char._frame = 1
            else
                char._frame = char._max_frames
                char._done  = true
                break
            end
        end
    end
end

-- ── Draw ────────────────────────────────────────────────────────────────────

---Draw all equipped layers at the given world position, bottom-center anchored.
---@param char  table
---@param x     number  world x (matches primitive renderer anchor)
---@param y     number  world y
---@param scale number  optional
function LayeredSprite.draw(char, x, y, scale)
    if not char._anim then return end
    scale = scale or SpriteSheet.DEFAULT_SCALE

    for _, slot in ipairs(DRAW_ORDER) do
        local sheet = char.layers[slot]
        if sheet then
            local anim_key = resolve_key(sheet, char._anim, char._dir)
            if anim_key and sheet.animations[anim_key] then
                local anim = sheet.animations[anim_key]
                -- Clamp frame to this layer's length (shorter anims hold last frame)
                local frame_idx = math.min(char._frame, #anim.frames)
                local fd        = anim.frames[frame_idx]
                local img       = sheet.images[fd.sheet]
                if img then
                    local draw_ox = fd.src_w / 2 - fd.off_x
                    local draw_oy = fd.src_h     - fd.off_y
                    love.graphics.draw(img, fd.quad, x, y, 0, scale, scale, draw_ox, draw_oy)
                end
            end
        end
    end
end

---Draw a single named slot only (useful for UI previews / inspect screen).
function LayeredSprite.drawSlot(char, slot, x, y, scale)
    local sheet = char.layers[slot]
    if not sheet or not char._anim then return end
    scale = scale or SpriteSheet.DEFAULT_SCALE
    local anim_key = resolve_key(sheet, char._anim, char._dir)
    if not anim_key then return end
    local anim = sheet.animations[anim_key]
    if not anim then return end
    local fd  = anim.frames[math.min(char._frame, #anim.frames)]
    local img = sheet.images[fd.sheet]
    if img then
        love.graphics.draw(img, fd.quad, x, y, 0, scale, scale,
            fd.src_w / 2 - fd.off_x, fd.src_h - fd.off_y)
    end
end

-- ── Equipment preview (inventory / paper-doll screen) ─────────────────────

---Draw a static equipment preview (icon-style, single direction = south, frame = 1).
---Use for inventory grid slots, tooltip icons, paper-doll UI.
---@param sheet  table   SpriteSheet of the equipment piece
---@param x      number
---@param y      number
---@param size   number  draw size in pixels
function LayeredSprite.drawEquipIcon(sheet, x, y, size)
    if not sheet then return end
    -- Find a "south" or "default" or first static frame
    local key = nil
    for k in pairs(sheet.animations) do
        if k:find("south", 1, true) or k:find("default", 1, true) then
            key = k
            break
        end
    end
    key = key or next(sheet.animations)
    if not key then return end

    local anim = sheet.animations[key]
    local fd   = anim.frames[1]
    local img  = sheet.images[fd.sheet]
    if not img then return end

    local scale = size / math.max(fd.src_w, fd.src_h)
    local draw_ox = fd.src_w / 2 - fd.off_x
    local draw_oy = fd.src_h / 2 - fd.off_y
    love.graphics.draw(img, fd.quad, x + size / 2, y + size / 2, 0, scale, scale, draw_ox, draw_oy)
end

-- ── Release ─────────────────────────────────────────────────────────────────

---Release GPU resources for all layers except body_base (which may be shared via registry).
function LayeredSprite.releaseEquipment(char)
    for slot, sheet in pairs(char.layers) do
        if slot ~= "body_base" and sheet then
            SpriteSheet.release(sheet)
            char.layers[slot] = nil
        end
    end
end

return LayeredSprite
