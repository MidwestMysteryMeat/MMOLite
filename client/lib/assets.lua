-- lib/assets.lua
-- Lazy-loading image cache with icon resolution for inventory items.
-- Follows the _G.getFont() pattern: load once, cache forever (with LRU eviction).

local assets = {}

-- Image cache: path string → love.graphics.Image
local _cache = {}
local _cacheTick = {} -- path → last-access tick (for LRU eviction)
local _tick = 0
local _cacheSize = 0
local MAX_CACHE = 512

-- Directory index: lowercase filename → actual relative path (built at init)
-- Also indexed by "subdir/filename" for scoped lookups
local _dirIndex = {} -- e.g. "necklacecross.png" → "assets/icons/resources/NecklaceCross.PNG"
local _dirScoped = {} -- e.g. "armor/basichelm.png" → "assets/icons/armor/BasicHelm.PNG"
local _initialized = false

-- Icon base path (relative to client/)
local ICON_ROOT = "assets/icons"

-- Slot → directory mapping for equipment icon lookup
local SLOT_DIR = {
    head = "armor", chest = "armor", undershirt = "armor", legs = "armor",
    feet = "armor", arms = "armor", hands = "armor", back = "armor",
    shoulder = "armor", belt = "armor",
    weapon = "weapons", main_hand = "weapons", off_hand = "weapons",
    shield = "weapons",
    ring1 = "resources", ring2 = "resources", ring3 = "resources",
    ring4 = "resources", ring5 = "resources", ring6 = "resources",
    necklace = "resources",
    axe = "weapons", pickaxe = "weapons",
    backpack = "loot", rig = "loot",
}

-- Item type → directory fallback
local TYPE_DIR = {
    sword = "weapons", axe = "weapons", bow = "weapons", dagger = "weapons",
    staff = "weapons", mace = "weapons", spear = "weapons", hammer = "weapons",
    shield = "weapons", arrow = "weapons", crossbow = "weapons", wand = "weapons",
    helmet = "armor", chest = "armor", pants = "armor", boots = "armor",
    gloves = "armor", cape = "armor", belt = "armor", bracer = "armor",
    ring = "resources", necklace = "resources", amulet = "resources",
    ore = "resources", bar = "resources", crystal = "resources",
    food = "resources", potion = "loot", scroll = "loot",
    gem = "resources", seed = "resources", herb = "resources",
    wood = "resources", stone = "resources", fish = "resources",
}

-- Recursively index a directory
local function indexDir(dir)
    local items = love.filesystem.getDirectoryItems(dir)
    for _, name in ipairs(items) do
        local path = dir .. "/" .. name
        local info = love.filesystem.getInfo(path)
        if info then
            if info.type == "directory" then
                indexDir(path)
            elseif info.type == "file" and (name:lower():match("%.png$") or name:lower():match("%.jpg$")) then
                _dirIndex[name:lower()] = path
                -- Build scoped index: "subdir/filename.lower"
                local sub = path:match("^" .. ICON_ROOT .. "/([^/]+)/")
                if sub then
                    _dirScoped[sub:lower() .. "/" .. name:lower()] = path
                end
            end
        end
    end
end

function assets.init()
    if _initialized then return end
    indexDir(ICON_ROOT)
    _initialized = true
end

-- Evict the least-recently-used entry
local function evictOne()
    local minTick = math.huge
    local minPath = nil
    for path, tick in pairs(_cacheTick) do
        if tick < minTick then
            minTick = tick
            minPath = path
        end
    end
    if minPath then
        _cache[minPath] = nil
        _cacheTick[minPath] = nil
        _cacheSize = _cacheSize - 1
    end
end

-- Load an image, return cached or nil
function assets.getImage(path)
    if not path then return nil end
    _tick = _tick + 1
    if _cache[path] then
        _cacheTick[path] = _tick
        return _cache[path]
    end

    -- Try loading
    local info = love.filesystem.getInfo(path)
    if not info then return nil end

    local ok, img = pcall(love.graphics.newImage, path)
    if not ok or not img then return nil end

    -- Evict if over limit
    while _cacheSize >= MAX_CACHE do
        evictOne()
    end

    _cache[path] = img
    _cacheTick[path] = _tick
    _cacheSize = _cacheSize + 1
    return img
end

-- Resolve an item's icon path using three-tier lookup:
-- 1. Server-provided item.icon field
-- 2. Slot-based directory + filename guess (scoped)
-- 3. Category/type fallback directory scan (scoped)
function assets.resolveItemIcon(item)
    if not item then return nil end

    -- Tier 1: server-provided icon path
    if item.icon and item.icon ~= "" then
        local iconPath = item.icon
        -- Try direct under ICON_ROOT
        local fullPath = ICON_ROOT .. "/" .. iconPath
        if love.filesystem.getInfo(fullPath) then return fullPath end
        -- Try case-insensitive lookup by filename
        local fname = iconPath:match("([^/]+)$")
        if fname and _dirIndex[fname:lower()] then
            return _dirIndex[fname:lower()]
        end
    end

    -- Tier 2: slot-based directory (scoped lookup)
    if item.slot then
        local dir = SLOT_DIR[item.slot]
        if dir then
            local baseName = (item.baseName or item.name or ""):gsub("%s+", "")
            if baseName ~= "" then
                local scopedKey = dir:lower() .. "/" .. baseName:lower() .. ".png"
                local found = _dirScoped[scopedKey]
                if found then return found end
            end
        end
    end

    -- Tier 3: type-based fallback (scoped lookup)
    if item.type then
        local dir = TYPE_DIR[item.type]
        if dir then
            local baseName = (item.baseName or item.name or ""):gsub("%s+", "")
            if baseName ~= "" then
                local scopedKey = dir:lower() .. "/" .. baseName:lower() .. ".png"
                local found = _dirScoped[scopedKey]
                if found then return found end
            end
        end
    end

    return nil
end

-- Get a loaded image for an item, or nil (falls back to colored rectangle)
-- Caches resolved path on the item table to avoid per-frame filesystem lookups
function assets.getItemIcon(item)
    if not item then return nil end
    if item._resolvedIconPath == nil then
        item._resolvedIconPath = assets.resolveItemIcon(item) or false
    end
    if not item._resolvedIconPath then return nil end
    return assets.getImage(item._resolvedIconPath)
end

-- Get an image by known directory and filename
function assets.getIcon(dir, filename)
    if not filename then return nil end
    local path = ICON_ROOT .. "/" .. dir .. "/" .. filename
    local img = assets.getImage(path)
    if img then return img end
    -- Case-insensitive fallback
    local found = _dirIndex[filename:lower()]
    if found then return assets.getImage(found) end
    return nil
end

function assets.getCacheSize()
    return _cacheSize
end

function assets.clearCache()
    _cache = {}
    _cacheTick = {}
    _cacheSize = 0
end

return assets
