-- client/lib/iso-map.lua
-- Isometric city/world renderer for LÖVE 2D.
-- Depth-sorts buildings and entities with a painter's algorithm (sorted by
-- tile x+y) so overlapping objects composite correctly at all zoom levels.
--
-- Coordinate system (Diablo/BG3 orientation):
--   North = up-left,   South = down-right
--   East  = up-right,  West  = down-left
--   screen_x = (tx - ty) * TILE_HALF_W
--   screen_y = (tx + ty) * TILE_HALF_H
--
-- Tile size matches the Blender render config:
--   camera elevation 54.736°, azimuth 45°, orthographic  →  2:1 diamond ratio
--   TW (full diamond width) = 128 px,  TH (full diamond height) = 64 px
--
-- Usage:
--   local IsoMap = require("lib.iso-map")
--   local map = IsoMap.fromCityJson(cityData)
--   IsoMap.addEntity(map, { id=myKey, tx=5, ty=5 })
--   IsoMap.setEntitySheet(map, myKey, spriteSheet, "walk", "south")
--
--   -- in update():
--   IsoMap.update(map, dt)
--
--   -- in draw() (apply camera transform before calling):
--   love.graphics.push()
--   love.graphics.translate(camera.ox, camera.oy)
--   love.graphics.scale(camera.zoom)
--   IsoMap.draw(map)
--   love.graphics.pop()
--
--   -- mouse hit test (world-space coords, i.e. after inverse camera transform):
--   local tx, ty = IsoMap.screenToTile(map, wx, wy)
--   local obj    = IsoMap.hitTest(map, tx, ty)

local SpriteSheet = require("lib.sprite-sheet")

local IsoMap = {}

local DEFAULT_TW = 128   -- tile diamond full width  (tip to tip, horizontal)
local DEFAULT_TH = 64    -- tile diamond full height (tip to tip, vertical)

-- ── Coordinate math ───────────────────────────────────────────────────────────

-- Returns screen position of the CENTER of tile (tx, ty).
local function _tileCenter(tw, th, tx, ty)
    return (tx - ty) * (tw * 0.5),
           (tx + ty) * (th * 0.5)
end

-- Inverse: screen position → nearest tile.
local function _screenToTile(tw, th, sx, sy)
    local hw = tw * 0.5
    local hh = th * 0.5
    local tx = (sx / hw + sy / hh) * 0.5
    local ty = (sy / hh - sx / hw) * 0.5
    return math.floor(tx + 0.5), math.floor(ty + 0.5)
end

-- Depth sort key: smaller → drawn first (further from camera).
-- Tie-break by ty: larger ty is more south → draws in front.
local function _sortKey(tx, ty)
    return (tx + ty) + ty * 0.0001
end

-- ── Palette for fallback ground tiles ─────────────────────────────────────────

local TILE_PALETTE = {
    grass     = {0.30, 0.52, 0.24},
    stone     = {0.48, 0.46, 0.42},
    cobble    = {0.45, 0.43, 0.40},
    water     = {0.20, 0.40, 0.70},
    sand      = {0.72, 0.66, 0.46},
    dirt      = {0.52, 0.38, 0.24},
    snow      = {0.85, 0.88, 0.92},
    lava      = {0.80, 0.30, 0.05},
    wood      = {0.55, 0.38, 0.20},
    rift      = {0.22, 0.10, 0.35},
}
local TILE_DEFAULT_COLOR = {0.28, 0.48, 0.22}

local DIR_FROM_DEGREES = {
    [0]   = "south",
    [90]  = "west",
    [180] = "north",
    [270] = "east",
}

-- ── Construction ──────────────────────────────────────────────────────────────

--- Create a new empty IsoMap.
---@param cfg table  optional: tw, th, width, height, name
function IsoMap.new(cfg)
    cfg = cfg or {}
    return {
        tw       = cfg.tw     or DEFAULT_TW,
        th       = cfg.th     or DEFAULT_TH,
        width    = cfg.width  or 32,
        height   = cfg.height or 32,
        name     = cfg.name   or "unnamed",

        -- Ground tiles: [ty*width + tx + 1] = {type="grass", tint={r,g,b}}
        tiles    = {},

        -- Placed buildings/props (array, sorted by depth key on draw)
        objects  = {},

        -- Dynamic entities: id → {id, tx, ty, sheet?, anim?, facing?, ...}
        entities = {},

        -- Loaded sprite sheets: assetId → SpriteSheet object
        _sheets  = {},

        -- Sorted draw list rebuilt when _dirty = true
        _dirty   = true,
    }
end

--- Build an IsoMap from the map-editor's exported city JSON.
---@param data table  parsed city JSON (meta, objects, npcs, connections)
function IsoMap.fromCityJson(data)
    local meta = data.meta or {}
    local m = IsoMap.new({
        width  = meta.width  or 32,
        height = meta.height or 32,
        name   = meta.name   or "unnamed",
    })

    for _, obj in ipairs(data.objects or {}) do
        IsoMap.addObject(m, {
            id         = obj.id,
            assetId    = obj.assetId or obj.id,
            tx         = obj.x or 0,
            ty         = obj.y or 0,
            footprintW = (obj.collision and obj.collision.w) or 2,
            footprintH = (obj.collision and obj.collision.h) or 2,
            height     = obj.buildingHeight or 1.5,
            direction  = obj.direction or 0,
            scale      = obj.scale or 1.0,
            label      = obj.label,
            enterable  = obj.enterable,
            targetZone = obj.targetZone,
        })
    end

    for _, npc in ipairs(data.npcs or {}) do
        IsoMap.addEntity(m, {
            id    = npc.id,
            tx    = npc.x or 0,
            ty    = npc.y or 0,
            label = npc.label or npc.id,
            color = {0.85, 0.75, 0.30},
        })
    end

    return m
end

-- ── Object management ─────────────────────────────────────────────────────────

--- Add a building or prop to the map.
---@param map  table
---@param obj  table  {id, assetId, tx, ty, footprintW, footprintH, ...}
function IsoMap.addObject(map, obj)
    local fw = obj.footprintW or 1
    local fh = obj.footprintH or 1
    -- Depth key: front-most (south) corner of the footprint.
    obj._sortKey = _sortKey(obj.tx + fw - 1, obj.ty + fh - 1)
    table.insert(map.objects, obj)
    map._dirty = true

    local aid = obj.assetId or obj.id
    if aid and not map._sheets[aid] then
        local sheet = SpriteSheet.get("assets/sprites/buildings/" .. aid)
        if sheet then map._sheets[aid] = sheet end
    end
end

--- Remove an object by id.
function IsoMap.removeObject(map, id)
    for i = #map.objects, 1, -1 do
        if map.objects[i].id == id then
            table.remove(map.objects, i)
            map._dirty = true
            return
        end
    end
end

--- Update a placed object's property and mark for re-sort.
function IsoMap.updateObject(map, id, key, value)
    for _, obj in ipairs(map.objects) do
        if obj.id == id then
            obj[key] = value
            if key == "tx" or key == "ty" or key == "footprintW" or key == "footprintH" then
                local fw = obj.footprintW or 1
                local fh = obj.footprintH or 1
                obj._sortKey = _sortKey(obj.tx + fw - 1, obj.ty + fh - 1)
                map._dirty = true
            end
            return
        end
    end
end

-- ── Entity management ─────────────────────────────────────────────────────────

--- Add or replace a dynamic entity (player, NPC, monster).
---@param map  table
---@param ent  table  {id, tx, ty, sheet?, anim?, facing?, label?, color?}
function IsoMap.addEntity(map, ent)
    ent._sortKey = _sortKey(ent.tx, ent.ty)
    ent._frame   = ent._frame or 1
    ent._timer   = ent._timer or 0
    map.entities[ent.id] = ent
    map._dirty = true
end

function IsoMap.removeEntity(map, id)
    map.entities[id] = nil
end

--- Reposition an entity and flag for depth re-sort.
function IsoMap.moveEntity(map, id, tx, ty)
    local ent = map.entities[id]
    if not ent then return end
    ent.tx, ent.ty = tx, ty
    ent._sortKey   = _sortKey(tx, ty)
    map._dirty     = true
end

--- Assign or change the animation for an entity.
function IsoMap.setEntitySheet(map, id, sheet, anim, facing)
    local ent = map.entities[id]
    if not ent then return end
    ent.sheet  = sheet
    ent.anim   = anim   or "idle"
    ent.facing = facing or "south"
    ent._frame = 1
    ent._timer = 0
end

-- ── Update ────────────────────────────────────────────────────────────────────

-- Resolve the best matching animation key in a sprite sheet.
local function _resolveAnimKey(sheet, anim, dir)
    local full = anim .. "_" .. dir
    if sheet.animations[full] then return full end
    -- Partial match: anim contains the base name
    for k in pairs(sheet.animations) do
        if k:find(anim, 1, true) and k:find(dir, 1, true) then return k end
    end
    for k in pairs(sheet.animations) do
        if k:find(anim, 1, true) then return k end
    end
    return next(sheet.animations)
end

--- Advance animation timers for all entities (call once per frame).
function IsoMap.update(map, dt)
    for _, ent in pairs(map.entities) do
        if ent.sheet and ent.anim then
            local key = _resolveAnimKey(ent.sheet, ent.anim, ent.facing or "south")
            if key then
                local anim   = ent.sheet.animations[key]
                local fps    = anim.fps or 12
                local nf     = #anim.frames
                ent._timer   = ent._timer + dt
                local dur    = 1.0 / math.max(1, fps)
                while ent._timer >= dur do
                    ent._timer = ent._timer - dur
                    ent._frame = ent._frame % nf + 1
                end
            end
        end
    end
end

-- ── Draw internals ────────────────────────────────────────────────────────────

local function _drawTile(map, tx, ty)
    local hw   = map.tw * 0.5
    local hh   = map.th * 0.5
    local sx, sy = _tileCenter(map.tw, map.th, tx, ty)
    local tile = map.tiles[ty * map.width + tx + 1]
    local col  = (tile and tile.tint)
              or (tile and TILE_PALETTE[tile.type])
              or TILE_DEFAULT_COLOR

    love.graphics.setColor(col[1], col[2], col[3], 1)
    love.graphics.polygon("fill",
        sx,      sy - hh,   -- north
        sx + hw, sy,        -- east
        sx,      sy + hh,   -- south
        sx - hw, sy)        -- west
    -- Subtle edge line to define tile boundaries
    love.graphics.setColor(col[1] * 0.70, col[2] * 0.70, col[3] * 0.70, 0.55)
    love.graphics.polygon("line",
        sx,      sy - hh,
        sx + hw, sy,
        sx,      sy + hh,
        sx - hw, sy)
end

-- Draw the four corners of a footprint diamond in screen space.
-- Returns nx,ny, ex,ey, sx,sy, wx,wy (north, east, south, west ground tips).
local function _footprintCorners(map, tx, ty, fw, fh)
    local hw = map.tw * 0.5
    local hh = map.th * 0.5

    local function tip(ttx, tty, dx, dy)
        local cx, cy = _tileCenter(map.tw, map.th, ttx, tty)
        return cx + dx * hw, cy + dy * hh
    end

    local nx, ny = tip(tx,          ty,          0, -1)   -- north
    local ex, ey = tip(tx + fw - 1, ty,          1,  0)   -- east
    local sx, sy = tip(tx + fw - 1, ty + fh - 1, 0,  1)   -- south
    local wx, wy = tip(tx,          ty + fh - 1, -1, 0)   -- west
    return nx, ny, ex, ey, sx, sy, wx, wy
end

local function _drawObjectSprite(sheet, animKey, sx, sy, scale, label)
    local anim = sheet.animations[animKey]
    local fd   = anim.frames[1]
    local img  = sheet.images[fd.sheet]
    if not img then return false end

    local ox = fd.src_w * 0.5 - (fd.off_x or 0)
    local oy = fd.src_h       - (fd.off_y or 0)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.draw(img, fd.quad, sx, sy, 0, scale, scale, ox, oy)
    if label then
        love.graphics.setColor(1, 1, 1, 0.88)
        love.graphics.printf(label, sx - 60, sy - fd.src_h * scale - 14, 120, "center")
    end
    return true
end

local function _drawObjectFallback(map, obj, nx, ny, ex, ey, sx, sy, wx, wy)
    local bh = (obj.height or 1.5) * map.th

    -- Top face (diamond at elevation bh)
    love.graphics.setColor(0.52, 0.48, 0.44, 1)
    love.graphics.polygon("fill", nx, ny-bh, ex, ey-bh, sx, sy-bh, wx, wy-bh)
    -- West (left) wall
    love.graphics.setColor(0.32, 0.28, 0.26, 1)
    love.graphics.polygon("fill", wx, wy-bh, sx, sy-bh, sx, sy, wx, wy)
    -- East (right) wall
    love.graphics.setColor(0.42, 0.38, 0.34, 1)
    love.graphics.polygon("fill", sx, sy-bh, ex, ey-bh, ex, ey, sx, sy)
    -- Edges
    love.graphics.setColor(0.16, 0.14, 0.12, 0.75)
    love.graphics.polygon("line", nx, ny-bh, ex, ey-bh, sx, sy-bh, wx, wy-bh)
    love.graphics.line(wx, wy-bh, wx, wy)
    love.graphics.line(sx, sy-bh, sx, sy)
    love.graphics.line(ex, ey-bh, ex, ey)

    if obj.label then
        local cx = (nx + sx) * 0.5
        local cy = ((ny + sy) * 0.5) - bh - 16
        love.graphics.setColor(1, 1, 1, 0.92)
        love.graphics.printf(obj.label, cx - 60, cy, 120, "center")
    end
end

local function _drawObject(map, obj)
    local fw = obj.footprintW or 1
    local fh = obj.footprintH or 1
    local nx, ny, ex, ey, sx, sy, wx, wy = _footprintCorners(map, obj.tx, obj.ty, fw, fh)

    local sheet = map._sheets[obj.assetId or obj.id]
    if sheet then
        local dir    = DIR_FROM_DEGREES[obj.direction or 0] or "south"
        local animKey = _resolveAnimKey(sheet, "idle", dir)
        if not animKey then animKey = next(sheet.animations) end
        if animKey and _drawObjectSprite(sheet, animKey, sx, sy, obj.scale or 1, obj.label) then
            return
        end
    end

    _drawObjectFallback(map, obj, nx, ny, ex, ey, sx, sy, wx, wy)
end

local function _drawEntity(map, ent)
    -- Entity anchor: center of the tile, shifted down to ground surface
    local cx, cy = _tileCenter(map.tw, map.th, ent.tx, ent.ty)
    local gx = cx                         -- ground x
    local gy = cy + map.th * 0.5          -- south tip = standing point

    -- Shadow ellipse (always drawn)
    love.graphics.setColor(0, 0, 0, 0.22)
    love.graphics.ellipse("fill", gx, gy, map.tw * 0.20, map.th * 0.12)

    local sheet = ent.sheet
    if sheet and ent.anim then
        local key = _resolveAnimKey(sheet, ent.anim, ent.facing or "south")
        if key then
            local anim = sheet.animations[key]
            local fi   = math.min(ent._frame or 1, #anim.frames)
            local fd   = anim.frames[fi]
            local img  = sheet.images[fd.sheet]
            if img then
                local ox = fd.src_w * 0.5 - (fd.off_x or 0)
                local oy = fd.src_h       - (fd.off_y or 0)
                love.graphics.setColor(1, 1, 1, 1)
                love.graphics.draw(img, fd.quad, gx, gy, 0, 1, 1, ox, oy)
                if ent.label then
                    love.graphics.setColor(1, 1, 1, 0.82)
                    love.graphics.printf(ent.label, gx - 40, gy - fd.src_h - 8, 80, "center")
                end
                return
            end
        end
    end

    -- Fallback: colored dot
    local col = ent.color or {0.40, 0.78, 1.0}
    local r   = map.tw * 0.14
    love.graphics.setColor(col[1], col[2], col[3], 1)
    love.graphics.circle("fill", gx, gy - r, r)
    love.graphics.setColor(0, 0, 0, 0.55)
    love.graphics.circle("line", gx, gy - r, r)
    if ent.label then
        love.graphics.setColor(1, 1, 1, 0.85)
        love.graphics.printf(ent.label, gx - 40, gy - r * 2 - 14, 80, "center")
    end
end

-- ── Main draw ─────────────────────────────────────────────────────────────────

--- Draw the complete map. Call inside a camera transform (translate + scale).
function IsoMap.draw(map)
    -- Ground tiles — flat, draw back-to-front diagonal by diagonal
    for d = 0, map.width + map.height - 2 do
        local tx_min = math.max(0, d - map.height + 1)
        local tx_max = math.min(d, map.width - 1)
        for tx = tx_min, tx_max do
            local ty = d - tx
            _drawTile(map, tx, ty)
        end
    end

    -- Refresh entity sort keys if anything moved
    if map._dirty then
        for _, ent in pairs(map.entities) do
            ent._sortKey = _sortKey(ent.tx, ent.ty)
        end
        table.sort(map.objects, function(a, b) return a._sortKey < b._sortKey end)
        map._dirty = false
    end

    -- Merge objects + entities into one sorted draw list
    local list = {}
    local n    = 0
    for _, obj in ipairs(map.objects) do
        n = n + 1; list[n] = { key = obj._sortKey, isObj = true, ref = obj }
    end
    for _, ent in pairs(map.entities) do
        n = n + 1; list[n] = { key = ent._sortKey, isObj = false, ref = ent }
    end
    table.sort(list, function(a, b) return a.key < b.key end)

    for i = 1, n do
        if list[i].isObj then
            _drawObject(map, list[i].ref)
        else
            _drawEntity(map, list[i].ref)
        end
    end

    love.graphics.setColor(1, 1, 1, 1)
end

-- ── Coordinate API ────────────────────────────────────────────────────────────

--- World-space screen position → nearest tile coordinates.
--- Input coordinates must already have camera transform removed
--- (i.e. subtract camera offset, divide by zoom).
---@return number tx, number ty
function IsoMap.screenToTile(map, sx, sy)
    return _screenToTile(map.tw, map.th, sx, sy)
end

--- Tile coordinates → screen position of the tile's south ground tip.
function IsoMap.tileToScreen(map, tx, ty)
    local sx, sy = _tileCenter(map.tw, map.th, tx, ty)
    return sx, sy + map.th * 0.5
end

--- Returns the topmost (frontmost) object whose footprint contains (tx, ty).
---@return table|nil
function IsoMap.hitTest(map, tx, ty)
    -- Iterate in reverse draw order: front → back so topmost wins
    for i = #map.objects, 1, -1 do
        local obj = map.objects[i]
        local fw  = obj.footprintW or 1
        local fh  = obj.footprintH or 1
        if tx >= obj.tx and tx < obj.tx + fw and
           ty >= obj.ty and ty < obj.ty + fh then
            return obj
        end
    end
    return nil
end

--- True if (tx, ty) is inside the map bounds.
function IsoMap.inBounds(map, tx, ty)
    return tx >= 0 and tx < map.width and ty >= 0 and ty < map.height
end

-- ── Tile fill helpers ─────────────────────────────────────────────────────────

--- Fill the entire map with one tile type.
---@param ttype string  e.g. "grass", "stone", "sand", "rift"
---@param tint  table|nil  {r, g, b} override
function IsoMap.fillTiles(map, ttype, tint)
    local col = tint or TILE_PALETTE[ttype] or TILE_DEFAULT_COLOR
    for ty = 0, map.height - 1 do
        for tx = 0, map.width - 1 do
            map.tiles[ty * map.width + tx + 1] = { type = ttype, tint = col }
        end
    end
end

--- Set a single tile.
function IsoMap.setTile(map, tx, ty, ttype, tint)
    if not IsoMap.inBounds(map, tx, ty) then return end
    map.tiles[ty * map.width + tx + 1] = {
        type = ttype,
        tint = tint or TILE_PALETTE[ttype] or TILE_DEFAULT_COLOR,
    }
end

return IsoMap
