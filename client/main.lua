-- ============================================================================
-- MMOLite - Love2D Client
-- Pokemon-style MMO connecting to MMOLite server via Socket.IO
-- ============================================================================

-- Scene manager
local currentScene = nil
local scenes = {}

local sceneLoading = false
local sceneLoadingName = nil

-- Pending scene load (deferred to next frame so loading screen renders)
local _pendingSceneLoad = nil

function _G.switchScene(name)
    if scenes[name] then
        -- Unload previous scene if it has an unload function
        if currentScene and currentScene.unload then
            local ok, err = pcall(currentScene.unload)
            if not ok then print("[main] Scene unload error: " .. tostring(err)) end
        end
        -- Show loading screen immediately, defer actual load to next frame
        sceneLoading = true
        sceneLoadingName = name
        currentScene = nil
        _pendingSceneLoad = name
    else
        print("[main] Unknown scene: " .. tostring(name))
    end
end

-- Custom error handler: log error, show user-friendly screen, allow recovery
local errorState = nil
function love.errorhandler(msg)
    msg = tostring(msg)
    print("[ERROR] " .. msg)
    print(debug.traceback("", 2))

    -- Try to return to login on next frame
    errorState = {
        message = msg,
        trace = debug.traceback("", 2),
        timer = 0,
    }

    -- Minimal error loop
    local errFont = love.graphics.newFont(14)
    local smallFont = love.graphics.newFont(11)
    return function()
        love.event.pump()
        for _, e, a in love.event.poll() do
            if e == "quit" then return 1 end
            if e == "keypressed" then
                if a == "escape" then
                    -- Shut down local server before quitting
                    pcall(function()
                        local sl = require("lib.server_launcher")
                        if sl and sl.running then sl.shutdown() end
                    end)
                    return 1
                end
                if a == "return" or a == "space" then
                    -- Shut down local server before recovery
                    pcall(function()
                        local sl = require("lib.server_launcher")
                        if sl and sl.running then sl.shutdown() end
                    end)
                    -- Disconnect game client
                    pcall(function()
                        if _G.gameClient then _G.gameClient:disconnect() end
                        _G.gameClient = nil
                        _G.pendingClient = nil
                        _G.identity = nil
                        _G.offlineMode = false
                        _G.isServerHost = false
                    end)
                    -- Try to recover: go back to shards
                    errorState = nil
                    pcall(function()
                        _G.switchScene("shards")
                    end)
                    return
                end
            end
        end

        love.graphics.clear(0.12, 0.05, 0.08)
        love.graphics.setColor(1, 0.3, 0.3)
        love.graphics.setFont(errFont)
        love.graphics.printf("An error occurred", 0, 80, love.graphics.getWidth(), "center")
        love.graphics.setColor(0.8, 0.8, 0.8)
        love.graphics.setFont(smallFont)
        love.graphics.printf(msg, 40, 130, love.graphics.getWidth() - 80, "left")
        love.graphics.setColor(0.6, 0.6, 0.6)
        love.graphics.printf("Press ENTER to return to server selection, or ESC to quit", 0, love.graphics.getHeight() - 50, love.graphics.getWidth(), "center")
        love.graphics.present()
        love.timer.sleep(0.05)
    end
end

local debugFont = nil

-- Global font cache: avoids creating duplicate fonts at the same size
local _fontCache = {}
function _G.getFont(size)
    size = math.floor(size)
    if not _fontCache[size] then
        _fontCache[size] = love.graphics.newFont(size)
    end
    return _fontCache[size]
end

-- Global state (shared across scenes)
_G.selectedShard = nil
_G.gameClient = nil
_G.identity = nil
_G.serverAuth = nil
_G.pendingClient = nil
_G.pendingAuth = nil
_G.pendingCreatePin = nil
_G.serverStats = nil
_G.offlineMode = false
_G.isServerHost = false
_G.groupScaling = nil   -- current combat difficulty tier info

function love.load()
    love.graphics.setBackgroundColor(0.08, 0.08, 0.14)

    debugFont = love.graphics.newFont(11)

    -- Clean up any orphaned server from a previous crash
    local serverLauncher = require("lib.server_launcher")
    serverLauncher.cleanupOrphans()

    -- Initialize Steam (graceful fallback if unavailable)
    local steamcloud = require("lib.steamcloud")
    steamcloud.init()

    -- Load scenes
    scenes.shards = require("scenes.shards")
    scenes.login = require("scenes.login")
    scenes.character_select = require("scenes.character_select")
    scenes.race_select = require("scenes.race_select")
    scenes.game = require("scenes.game")

    -- Start at shard selection
    _G.switchScene("shards")
end

function love.update(dt)
    dt = math.min(dt, 1/20) -- cap dt

    -- Deferred scene load: execute after at least one frame of loading screen
    if _pendingSceneLoad then
        local name = _pendingSceneLoad
        _pendingSceneLoad = nil
        currentScene = scenes[name]
        if currentScene and currentScene.load then
            local ok, err = pcall(currentScene.load)
            if not ok then
                print("[main] Scene load error: " .. tostring(err))
            end
        end
        sceneLoading = false
        sceneLoadingName = nil
    end

    -- Process async HTTP responses (must run every frame)
    local net = require("lib.net")
    net.update()

    -- Drive local server health polling
    local serverLauncher = require("lib.server_launcher")
    serverLauncher.update(dt)

    -- Drive LAN discovery listener
    local lanDiscovery = require("lib.lan_discovery")
    lanDiscovery.update(dt)

    -- Pump Steam callbacks (overlay, achievements, etc.)
    local steamcloud = require("lib.steamcloud")
    steamcloud.update(dt)

    -- Drive network clients (pending handshake + active game client)
    if _G.pendingClient then
        _G.pendingClient:update(dt)
    end
    if _G.gameClient and _G.gameClient ~= _G.pendingClient then
        _G.gameClient:update(dt)
    end

    -- Graceful quit: pump network to receive final snapshot before exiting
    if _G._quitState == "waiting" then
        if love.timer.getTime() > _G._quitDeadline then
            _G._quitState = "done"
            love.event.quit()
        end
    end

    if currentScene and currentScene.update then
        currentScene.update(dt)
    end
end

function love.draw()
    if sceneLoading then
        -- Loading screen: dark background with centered text
        love.graphics.clear(0.06, 0.06, 0.1)
        local W = love.graphics.getWidth()
        local H = love.graphics.getHeight()
        love.graphics.setColor(0.8, 0.8, 0.9, 0.9)
        love.graphics.setFont(debugFont)
        local label = "Loading" .. (sceneLoadingName and (" " .. sceneLoadingName .. "...") or "...")
        love.graphics.printf(label, 0, H / 2 - 10, W, "center")
        -- Animated dots
        local dots = math.floor(love.timer.getTime() * 3) % 4
        love.graphics.setColor(0.6, 0.6, 0.7, 0.6)
        love.graphics.printf(string.rep(".", dots), 0, H / 2 + 10, W, "center")
    elseif currentScene and currentScene.draw then
        currentScene.draw()
    end

    -- FPS counter (debug)
    love.graphics.setColor(1, 1, 1, 0.25)
    love.graphics.setFont(debugFont)
    love.graphics.print("FPS: " .. love.timer.getFPS(), 5, love.graphics.getHeight() - 16)
end

function love.mousepressed(x, y, button)
    if currentScene and currentScene.mousepressed then
        currentScene.mousepressed(x, y, button)
    end
end

function love.mousereleased(x, y, button)
    if currentScene and currentScene.mousereleased then
        currentScene.mousereleased(x, y, button)
    end
end

function love.mousemoved(x, y)
    if currentScene and currentScene.mousemoved then
        currentScene.mousemoved(x, y)
    end
end

function love.keypressed(key)
    if currentScene and currentScene.keypressed then
        currentScene.keypressed(key)
    end
end

function love.textinput(text)
    if currentScene and currentScene.textinput then
        currentScene.textinput(text)
    end
end

function love.wheelmoved(x, y)
    if currentScene and currentScene.wheelmoved then
        currentScene.wheelmoved(x, y)
    end
end

function love.resize(w, h)
    -- Use scene-specific resize if available, otherwise fall back to full reload
    if currentScene and currentScene.resize then
        pcall(currentScene.resize, w, h)
    elseif currentScene and currentScene.load then
        pcall(currentScene.load)
    end
end

function love.quit()
    -- Second pass: everything is saved, allow quit
    if _G._quitState == "done" then
        -- Shut down local server if we launched or connected to one
        local ok, serverLauncher = pcall(require, "lib.server_launcher")
        if ok and serverLauncher then
            if serverLauncher.running or serverLauncher.launching then
                serverLauncher.shutdown()
            end
            serverLauncher.cleanupOrphans()
        end

        -- Stop LAN discovery listener
        local ok2, lanDiscovery = pcall(require, "lib.lan_discovery")
        if ok2 and lanDiscovery and lanDiscovery.listening then
            lanDiscovery.stop()
        end

        -- Shut down Steam
        local ok3, steamcloud = pcall(require, "lib.steamcloud")
        if ok3 and steamcloud then
            steamcloud.shutdown()
        end

        -- Disconnect game client
        if _G.gameClient then
            pcall(function() _G.gameClient:disconnect() end)
        end
        return false -- allow quit
    end

    -- First pass: request final snapshot and defer quit for up to 2 seconds
    if not _G._quitState then
        _G._quitState = "waiting"
        _G._quitDeadline = love.timer.getTime() + 2

        -- Request a final snapshot before we disconnect
        if _G.gameClient and _G.gameClient.connected then
            pcall(function() _G.gameClient:emit("snapshot_request") end)
        end
        return true -- abort quit, wait for snapshot or timeout
    end

    return true -- still waiting
end
