-- ============================================================================
-- steamcloud.lua
-- Steam lifecycle management (init/update/shutdown) and save file wrappers.
-- Uses Steam Auto-Cloud for save synchronization (zero game-code sync needed).
-- Gracefully falls back when Steam/luasteam is unavailable.
-- ============================================================================

local M = {}

-- State
M.available = false     -- true if Steam SDK initialized successfully
M.steam = nil           -- luasteam module reference (nil if unavailable)

-- Files managed by Auto-Cloud (read/written via love.filesystem)
local CLOUD_FILES = {
    "account.dat",              -- unified account key
    "keys.dat",                 -- legacy per-server account keys
    "master.dat",               -- server host:port (has default fallback)
    "account_snapshot.dat",     -- portable character snapshot for cross-server import
}

-- ---------------------------------------------------------------------------
-- Initialize Steam SDK
-- Call once in love.load(), before scene loading.
-- Returns true if Steam is available, false otherwise (game continues fine).
-- ---------------------------------------------------------------------------
function M.init()
    local ok, steam = pcall(require, "luasteam")
    if not ok then
        print("[steamcloud] luasteam not found — running without Steam")
        return false
    end

    local initOk = steam.init()
    if not initOk then
        print("[steamcloud] Steam.init() failed — is Steam running?")
        return false
    end

    M.steam = steam
    M.available = true

    local userId = steam.user.getSteamID()
    print("[steamcloud] Steam initialized (user: " .. tostring(userId) .. ")")
    print("[steamcloud] Auto-Cloud active — save files sync automatically")
    return true
end

-- ---------------------------------------------------------------------------
-- Update: pump Steam callbacks (needed for overlay, achievements, etc.)
-- Call every frame from love.update(dt).
-- ---------------------------------------------------------------------------
function M.update(dt)
    if not M.available or not M.steam then return end
    M.steam.runCallbacks()
end

-- ---------------------------------------------------------------------------
-- Shutdown Steam SDK cleanly
-- Call from love.quit().
-- ---------------------------------------------------------------------------
function M.shutdown()
    if not M.available or not M.steam then return end
    print("[steamcloud] Shutting down Steam")
    M.steam.shutdown()
    M.available = false
    M.steam = nil
end

-- ---------------------------------------------------------------------------
-- Status queries
-- ---------------------------------------------------------------------------
function M.isAvailable()
    return M.available
end

function M.getStatus()
    if M.available then
        return "active"
    else
        return "unavailable"
    end
end

-- ---------------------------------------------------------------------------
-- Save file wrappers
-- These use love.filesystem (which writes to the identity folder that
-- Auto-Cloud monitors). They're thin wrappers now, but provide a future
-- extension point if luasteam ever adds ISteamRemoteStorage bindings.
-- ---------------------------------------------------------------------------

--- Read a save file from the identity folder.
-- @param filename string — e.g. "account.dat"
-- @return string|nil — file contents, or nil if not found
function M.readFile(filename)
    local info = love.filesystem.getInfo(filename)
    if not info then return nil end
    return love.filesystem.read(filename)
end

--- Write a save file to the identity folder.
-- Auto-Cloud picks it up on next sync (typically at game exit).
-- @param filename string — e.g. "account.dat"
-- @param data string — contents to write
-- @return boolean — true on success
function M.writeFile(filename, data)
    local ok, err = love.filesystem.write(filename, data)
    if not ok then
        print("[steamcloud] Failed to write " .. filename .. ": " .. tostring(err))
        return false
    end
    return true
end

--- Get list of cloud-managed filenames.
-- @return table — array of filename strings
function M.getCloudFiles()
    return CLOUD_FILES
end

return M
