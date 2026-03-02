-- lib/keystore.lua
-- Unified account key storage.
-- Stores a single account key in account.dat so the same identity
-- works across offline, LAN, and production servers.
--
-- Legacy migration: reads from keys.dat (per-server) or local_account.dat
-- on first use, writes to account.dat, and uses that going forward.

local M = {}

local cachedKey = nil  -- in-memory cache (lazy loaded)

--- Read a key from a legacy file (keys.dat picks best entry, local_account.dat is single-key).
local function readLegacyKeysFile()
    local info = love.filesystem.getInfo("keys.dat")
    if not info then return nil end
    local data = love.filesystem.read("keys.dat")
    if not data then return nil end

    -- keys.dat is tab-separated "host:port\tkey" per line.
    -- Pick the first valid key (any server — they should all be the same now).
    local addr = nil
    local shard = _G.selectedShard
    if shard and shard.host then
        addr = shard.host .. ":" .. tostring(shard.port or 3001)
    end

    -- Prefer current server's key if present
    if addr then
        for line in data:gmatch("[^\n]+") do
            local a, k = line:match("^(%S+)\t(%S+)")
            if a == addr and k and #k >= 12 then return k end
        end
    end

    -- Fall back to any valid key in the file
    for line in data:gmatch("[^\n]+") do
        local _, k = line:match("^(%S+)\t(%S+)")
        if k and #k >= 12 then return k end
    end
    return nil
end

local function readSingleKeyFile(filename)
    local info = love.filesystem.getInfo(filename)
    if not info then return nil end
    local data = love.filesystem.read(filename)
    if not data then return nil end
    local key = data:match("^(%S+)")
    if key and #key >= 12 then return key end
    return nil
end

--- Get the account key (single global key).
-- On first call, migrates from legacy files if needed.
function M.getKey()
    if cachedKey then return cachedKey end

    -- Primary: account.dat (unified key file)
    local key = readSingleKeyFile("account.dat")
    if key then
        cachedKey = key
        return key
    end

    -- Legacy migration: keys.dat (per-server format)
    key = readLegacyKeysFile()
    if key then
        love.filesystem.write("account.dat", key)
        cachedKey = key
        return key
    end

    -- Legacy migration: local_account.dat (old offline key)
    key = readSingleKeyFile("local_account.dat")
    if key then
        love.filesystem.write("account.dat", key)
        cachedKey = key
        return key
    end

    return nil
end

--- Store the account key.
function M.setKey(key)
    if not key or #key < 12 then return end
    cachedKey = key
    love.filesystem.write("account.dat", key)
end

--- Invalidate the in-memory cache (call when returning to shard select).
function M.clearCache()
    cachedKey = nil
end

return M
