-- scenes/shards.lua
-- Shard (server) selection screen
-- Supports: Play Offline, Host Game, Browse Servers, Direct Connect

local net = require("lib.net")
local serverLauncher = require("lib.server_launcher")
local lanDiscovery = require("lib.lan_discovery")
local steamcloud = require("lib.steamcloud")
local audio = require("lib.audio")

local shards = {}

-- Master server configuration
local MASTER_HOST = "<shard1-ip>"
local MASTER_PORT = 3001

-- View modes
local MODE_MAIN = "main"           -- Top-level mode buttons
local MODE_BROWSE = "browse"       -- Server list (online + LAN)
local MODE_DIRECT = "direct"       -- Direct connect by IP
local MODE_HOST_CUSTOM = "custom"  -- Custom server setup wizard
local MODE_LAUNCHING = "launching" -- Server is launching (spinner)
local MODE_HOSTING = "hosting"     -- Server is running, showing info

local currentMode = MODE_MAIN

-- Dynamic shard list fetched from master
local shardList = {}
local selectedIndex = 1
local shardStatus = {}  -- index -> { status, players, ping }
local checkTimer = 0
local fetchingShards = false
local fonts = {}
local fadeIn = 0
local hoverIndex = nil
local errorMsg = nil
local errorTimer = 0
local scrollOffset = 0
local maxVisible = 4

-- Direct connect fields
local directFields = {
    host = { text = "", label = "Host", placeholder = "IP or hostname", active = false },
    port = { text = "3001", label = "Port", placeholder = "3001", active = false },
}
local activeField = nil
local cursorTimer = 0
local cursorVisible = true

-- Custom server fields
local customFields = {
    name     = { text = "My Server",  label = "Server Name",  placeholder = "My Server",    active = false, kind = "text" },
    port     = { text = "3001",       label = "Port",         placeholder = "3001",         active = false, kind = "port" },
    password = { text = "",           label = "Password",     placeholder = "(optional)",   active = false, kind = "text" },
}
local customToggles = {
    maxPlayers = 8,
    xpRate     = 1.0,
    dropRate   = 1.0,
    pvpEnabled = false,
    public     = false,
}

-- Hosting info
local hostInfo = nil -- { name, ip, port, players, maxPlayers }
local launchMsg = "Starting local server..."

-- Pre-generated star positions
local shardStars = nil

-- Load/save master server URL from disk
local function loadMasterConfig()
    local info = love.filesystem.getInfo("master.dat")
    if info then
        local data = love.filesystem.read("master.dat")
        if data then
            local h, p = data:match("^(%S+)%s+(%d+)")
            if h and p then
                MASTER_HOST = h
                MASTER_PORT = tonumber(p)
            end
        end
    end
end

local function saveMasterConfig()
    love.filesystem.write("master.dat", MASTER_HOST .. " " .. MASTER_PORT)
end

local function recreateFonts()
    fonts.title = love.graphics.newFont(36)
    fonts.subtitle = love.graphics.newFont(16)
    fonts.shard = love.graphics.newFont(20)
    fonts.detail = love.graphics.newFont(14)
    fonts.button = love.graphics.newFont(18)
    fonts.small = love.graphics.newFont(12)
end

function shards.resize(w, h)
    recreateFonts()
end

function shards.load()
    audio.init()
    recreateFonts()
    fadeIn = 0
    errorMsg = nil
    scrollOffset = 0
    activeField = nil
    currentMode = MODE_MAIN

    -- Pre-generate star positions once
    local W, H = love.graphics.getDimensions()
    shardStars = {}
    math.randomseed(42)
    for i = 1, 60 do
        shardStars[i] = { x = math.random(0, W), y = math.random(0, H), r = 1 + math.random() * 1.5 }
    end
    math.randomseed(os.time())

    loadMasterConfig()
end

function shards.fetchShardList()
    fetchingShards = true
    local isInitialFetch = (#shardList == 0)
    if isInitialFetch then
        shardList = {}
        shardStatus = {}
        selectedIndex = 1
    end

    net.fetchShardList(MASTER_HOST, MASTER_PORT, function(list, err)
        fetchingShards = false
        if list and #list > 0 then
            shardList = list
            for i = 1, #shardList do
                shardStatus[i] = { status = "online", players = shardList[i].currentPlayers or 0 }
            end
            for i, shard in ipairs(shardList) do
                local startTime = love.timer.getTime()
                net.fetchHealth(shard.host, shard.port, function(health, healthErr)
                    local elapsed = love.timer.getTime() - startTime
                    if health then
                        shardStatus[i] = {
                            status = "online",
                            players = health.players or shard.currentPlayers or 0,
                            zones = health.zones or 0,
                            ping = math.floor(elapsed * 500) .. "ms",
                            version = health.shard and health.shard.version or shard.version or "?",
                        }
                    else
                        shardStatus[i] = {
                            status = "offline", players = "-", zones = "-", ping = "-",
                            version = shard.version or "?",
                        }
                    end
                end)
            end
        else
            if err then
                errorMsg = "Cannot reach master server"
                errorTimer = 5
            end
        end
    end)
end

function shards.update(dt)
    fadeIn = math.min(1, fadeIn + dt * 3)
    cursorTimer = cursorTimer + dt
    if cursorTimer >= 0.5 then
        cursorTimer = 0
        cursorVisible = not cursorVisible
    end

    if errorTimer > 0 then
        errorTimer = errorTimer - dt
        if errorTimer <= 0 then errorMsg = nil end
    end

    -- Auto-refresh in browse mode
    if currentMode == MODE_BROWSE then
        checkTimer = checkTimer + dt
        if checkTimer >= 15 then
            checkTimer = 0
            shards.fetchShardList()
        end
    end

    -- Check if server launch completed
    if currentMode == MODE_LAUNCHING then
        if serverLauncher.running then
            -- Server is up! Transition based on what we were launching
            if _G.offlineMode then
                _G.selectedShard = { name = "Offline - Solo Play", host = "127.0.0.1", port = 3001, offline = true }
                _G.isServerHost = true
                _G.switchScene("login")
            else
                -- LAN or custom hosting
                local ip = serverLauncher.getLocalIP()
                local port = hostInfo and hostInfo.port or 3001
                hostInfo = hostInfo or {}
                hostInfo.ip = ip
                hostInfo.port = port
                currentMode = MODE_HOSTING

                -- Auto-connect the host to their own server
                _G.selectedShard = {
                    name = hostInfo.name or "LAN Server",
                    host = "127.0.0.1",
                    port = port,
                    lan = true,
                }
                _G.isServerHost = true
                _G.switchScene("login")
            end
        elseif serverLauncher.lastError then
            errorMsg = serverLauncher.lastError
            errorTimer = 5
            currentMode = MODE_MAIN
            _G.offlineMode = false
            _G.isServerHost = false
        end
    end
end

-- =========================================================================
-- Drawing
-- =========================================================================

function shards.draw()
    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()

    -- Background
    love.graphics.setColor(0.08, 0.08, 0.14, fadeIn)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Stars
    love.graphics.setColor(1, 1, 1, 0.3 * fadeIn)
    if shardStars then
        for i = 1, #shardStars do
            local s = shardStars[i]
            love.graphics.circle("fill", s.x, s.y, s.r)
        end
    end

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.94, 0.7, 0.2, fadeIn)
    love.graphics.printf("MMOLite", 0, 20, W, "center")

    -- Steam Cloud status indicator (top-right)
    if steamcloud.isAvailable() then
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.3, 0.85, 0.5, fadeIn * 0.7)
        love.graphics.printf("Steam Cloud", 0, 8, W - 12, "right")
    end

    if currentMode == MODE_MAIN then
        shards.drawMainMenu(W, H)
    elseif currentMode == MODE_BROWSE then
        shards.drawBrowse(W, H)
    elseif currentMode == MODE_DIRECT then
        shards.drawDirectConnect(W, H)
    elseif currentMode == MODE_HOST_CUSTOM then
        shards.drawHostCustom(W, H)
    elseif currentMode == MODE_LAUNCHING then
        shards.drawLaunching(W, H)
    elseif currentMode == MODE_HOSTING then
        shards.drawHosting(W, H)
    end

    -- Error message
    if errorMsg then
        love.graphics.setFont(fonts.detail)
        love.graphics.setColor(1, 0.3, 0.3, fadeIn * math.min(1, errorTimer))
        love.graphics.printf(errorMsg, 20, H - 40, W - 40, "center")
    end
end

-- =========================================================================
-- Main Menu: Play Offline / Host Game / Browse Servers / Direct Connect
-- =========================================================================

local function drawBigButton(x, y, w, h, label, sublabel, bgColor, borderColor, textColor)
    love.graphics.setColor(bgColor[1], bgColor[2], bgColor[3], (bgColor[4] or 0.9) * fadeIn)
    love.graphics.rectangle("fill", x, y, w, h, 10, 10)
    love.graphics.setColor(borderColor[1], borderColor[2], borderColor[3], (borderColor[4] or 0.8) * fadeIn)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", x, y, w, h, 10, 10)
    love.graphics.setLineWidth(1)
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(textColor[1], textColor[2], textColor[3], fadeIn)
    love.graphics.printf(label, x, y + (sublabel and 10 or 15), w, "center")
    if sublabel then
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(textColor[1] * 0.7, textColor[2] * 0.7, textColor[3] * 0.7, fadeIn * 0.7)
        love.graphics.printf(sublabel, x, y + 32, w, "center")
    end
end

local mainButtons = {
    { label = "Play Offline",       sub = "Solo play, no setup needed",          bg = {0.12, 0.25, 0.15}, border = {0.3, 0.8, 0.4}, text = {0.8, 1, 0.8} },
    { label = "Host Game",          sub = "Host for LAN or online friends",      bg = {0.15, 0.15, 0.3},  border = {0.4, 0.5, 1},   text = {0.8, 0.85, 1} },
    { label = "Browse Servers",     sub = "Find online and LAN servers",         bg = {0.15, 0.15, 0.22}, border = {0.5, 0.5, 0.7}, text = {0.9, 0.9, 1} },
    { label = "Direct Connect",     sub = "Connect by IP address",              bg = {0.2, 0.15, 0.22},  border = {0.6, 0.4, 0.6}, text = {0.9, 0.8, 0.9} },
}

-- Advanced options toggle for host wizard
local hostAdvancedOpen = false

function shards.drawMainMenu(W, H)
    love.graphics.setFont(fonts.subtitle)
    love.graphics.setColor(0.7, 0.7, 0.8, fadeIn * 0.7)
    love.graphics.printf("Choose How to Play", 0, 62, W, "center")

    local btnW = math.min(400, W - 80)
    local btnH = 52
    local gap = 12
    local startY = 100
    local btnX = (W - btnW) / 2

    for i, btn in ipairs(mainButtons) do
        local y = startY + (i - 1) * (btnH + gap)
        drawBigButton(btnX, y, btnW, btnH, btn.label, btn.sub, btn.bg, btn.border, btn.text)
    end

    -- Footer
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.4, 0.4, 0.5, fadeIn * 0.5)
    love.graphics.printf("Press 1-4 or click a button", 0, H - 20, W, "center")
end

-- =========================================================================
-- Browse Servers (Online + LAN)
-- =========================================================================

function shards.drawBrowse(W, H)
    love.graphics.setFont(fonts.subtitle)
    love.graphics.setColor(0.7, 0.7, 0.8, fadeIn * 0.7)
    love.graphics.printf("Server Browser", 0, 62, W, "center")

    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.4, 0.5, 0.4, fadeIn * 0.5)
    love.graphics.printf("Master: " .. MASTER_HOST .. ":" .. MASTER_PORT, 0, 82, W, "center")

    local cardW = math.min(550, W - 60)
    local cardH = 70
    local cardX = (W - cardW) / 2
    local startY = 100

    -- Combine LAN servers + online servers into one list
    local lanServers = lanDiscovery.getServerList()
    local allServers = {}

    -- LAN servers first
    for _, ls in ipairs(lanServers) do
        allServers[#allServers + 1] = {
            name = ls.name,
            host = ls.host,
            port = ls.port,
            players = ls.players,
            maxPlayers = ls.maxPlayers,
            version = ls.version,
            rules = ls.rules,
            hasPassword = ls.hasPassword,
            isLAN = true,
            status = "online",
            ping = "LAN",
        }
    end

    -- Online servers
    for i, shard in ipairs(shardList) do
        local st = shardStatus[i] or { status = "unknown" }
        allServers[#allServers + 1] = {
            name = shard.name,
            host = shard.host,
            port = shard.port,
            players = st.players or 0,
            maxPlayers = shard.maxPlayers,
            version = st.version or shard.version or "?",
            rules = shard.rules,
            official = shard.official,
            isLAN = false,
            status = st.status or "unknown",
            ping = st.ping or "...",
        }
    end

    if fetchingShards and #allServers == 0 then
        love.graphics.setFont(fonts.subtitle)
        love.graphics.setColor(0.6, 0.7, 0.9, fadeIn * 0.8)
        love.graphics.printf("Fetching servers...", 0, startY + 40, W, "center")
        -- Spinner
        local t = love.timer.getTime()
        for i = 0, 7 do
            local angle = t * 3 + i * math.pi / 4
            local alpha = (1 - i / 8) * fadeIn * 0.8
            love.graphics.setColor(0.4, 0.6, 1.0, alpha)
            love.graphics.circle("fill", W / 2 + math.cos(angle) * 15, startY + 80 + math.sin(angle) * 15, 3)
        end
    elseif #allServers == 0 then
        love.graphics.setFont(fonts.subtitle)
        love.graphics.setColor(0.6, 0.5, 0.5, fadeIn * 0.8)
        love.graphics.printf("No servers found", 0, startY + 40, W, "center")
        love.graphics.setFont(fonts.detail)
        love.graphics.setColor(0.5, 0.5, 0.6, fadeIn * 0.6)
        love.graphics.printf("Try Direct Connect or host your own", 0, startY + 65, W, "center")
    else
        local visibleStart = scrollOffset + 1
        local visibleEnd = math.min(#allServers, scrollOffset + maxVisible)

        for idx = visibleStart, visibleEnd do
            local drawIdx = idx - scrollOffset
            local srv = allServers[idx]
            local y = startY + (drawIdx - 1) * (cardH + 8)
            local isSelected = (idx == selectedIndex)
            local isHovered = (idx == hoverIndex)
            local isOnline = (srv.status == "online")

            -- Card background
            if isSelected then
                love.graphics.setColor(0.15, 0.25, 0.45, 0.95 * fadeIn)
            elseif isHovered then
                love.graphics.setColor(0.12, 0.18, 0.3, 0.9 * fadeIn)
            else
                love.graphics.setColor(0.1, 0.1, 0.18, 0.85 * fadeIn)
            end
            love.graphics.rectangle("fill", cardX, y, cardW, cardH, 8, 8)

            -- Card border
            if isSelected then
                love.graphics.setColor(0.4, 0.65, 1.0, 0.9 * fadeIn)
            else
                love.graphics.setColor(0.3, 0.3, 0.4, 0.5 * fadeIn)
            end
            love.graphics.setLineWidth(isSelected and 2 or 1)
            love.graphics.rectangle("line", cardX, y, cardW, cardH, 8, 8)
            love.graphics.setLineWidth(1)

            -- Status dot
            if isOnline then
                love.graphics.setColor(0.2, 0.9, 0.35, fadeIn)
            else
                love.graphics.setColor(0.9, 0.25, 0.2, fadeIn)
            end
            love.graphics.circle("fill", cardX + 16, y + 18, 5)

            -- Badges
            local badgeX = cardX + 28
            love.graphics.setFont(fonts.small)
            if srv.isLAN then
                love.graphics.setColor(0.3, 0.8, 0.9, fadeIn * 0.9)
                love.graphics.print("LAN", badgeX, y + 4)
                badgeX = badgeX + 30
            end
            if srv.official then
                love.graphics.setColor(0.94, 0.7, 0.2, fadeIn * 0.8)
                love.graphics.print("OFFICIAL", badgeX, y + 4)
                badgeX = badgeX + 55
            end
            if srv.hasPassword then
                love.graphics.setColor(0.8, 0.6, 0.2, fadeIn * 0.7)
                love.graphics.print("[PW]", badgeX, y + 4)
            end

            -- Server name
            love.graphics.setFont(fonts.shard)
            love.graphics.setColor(1, 1, 1, fadeIn)
            love.graphics.print(srv.name, cardX + 28, y + 16)

            -- Rules tags
            love.graphics.setFont(fonts.small)
            local tagX = cardX + 28
            local tagY = y + 42
            if srv.rules then
                if srv.rules.pvpEnabled then
                    love.graphics.setColor(0.8, 0.3, 0.3, fadeIn * 0.7)
                    love.graphics.print("[PvP]", tagX, tagY)
                    tagX = tagX + 35
                end
                if srv.rules.xpRate and srv.rules.xpRate ~= 1.0 then
                    love.graphics.setColor(0.3, 0.7, 0.9, fadeIn * 0.7)
                    love.graphics.print("[" .. srv.rules.xpRate .. "x XP]", tagX, tagY)
                    tagX = tagX + 55
                end
                if srv.rules.dropRate and srv.rules.dropRate ~= 1.0 then
                    love.graphics.setColor(0.9, 0.7, 0.3, fadeIn * 0.7)
                    love.graphics.print("[" .. srv.rules.dropRate .. "x Loot]", tagX, tagY)
                end
            end

            -- Right side: status info
            love.graphics.setFont(fonts.detail)
            local infoX = cardX + cardW - 130

            if isOnline then
                love.graphics.setColor(0.5, 0.85, 0.5, fadeIn)
                love.graphics.print(tostring(srv.players) .. "/" .. tostring(srv.maxPlayers or "?"), infoX, y + 10)
                love.graphics.setColor(0.7, 0.7, 0.5, fadeIn)
                love.graphics.print(tostring(srv.ping), infoX, y + 28)
                love.graphics.setColor(0.5, 0.5, 0.6, fadeIn)
                love.graphics.print("v" .. tostring(srv.version), infoX, y + 46)
            else
                love.graphics.setColor(0.9, 0.3, 0.3, fadeIn)
                love.graphics.print("OFFLINE", infoX, y + 26)
            end
        end

        -- Scroll indicators
        if scrollOffset > 0 then
            love.graphics.setColor(0.7, 0.7, 0.8, fadeIn * 0.6)
            love.graphics.setFont(fonts.detail)
            love.graphics.printf("^ More above", 0, startY - 14, W, "center")
        end
        if scrollOffset + maxVisible < #allServers then
            local bottomY = startY + maxVisible * (cardH + 8)
            love.graphics.setColor(0.7, 0.7, 0.8, fadeIn * 0.6)
            love.graphics.setFont(fonts.detail)
            love.graphics.printf("v More below", 0, bottomY - 4, W, "center")
        end

        -- Store allServers for click handling
        shards._currentAllServers = allServers
    end

    -- Bottom buttons
    local btnY = H - 60
    local btnW = 130
    local btnH = 40
    local totalW = btnW * 4 + 30
    local bx = (W - totalW) / 2

    -- Connect
    local canConnect = shards._currentAllServers and #shards._currentAllServers > 0
        and selectedIndex >= 1 and selectedIndex <= #shards._currentAllServers
        and shards._currentAllServers[selectedIndex] and shards._currentAllServers[selectedIndex].status == "online"
    love.graphics.setColor(canConnect and 0.15 or 0.15, canConnect and 0.5 or 0.15, canConnect and 0.25 or 0.15, (canConnect and 0.95 or 0.5) * fadeIn)
    love.graphics.rectangle("fill", bx, btnY, btnW, btnH, 6, 6)
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(canConnect and 1 or 0.4, canConnect and 1 or 0.4, canConnect and 1 or 0.4, fadeIn)
    love.graphics.printf("Connect", bx, btnY + 9, btnW, "center")

    -- Refresh
    bx = bx + btnW + 10
    love.graphics.setColor(0.15, 0.15, 0.25, 0.8 * fadeIn)
    love.graphics.rectangle("fill", bx, btnY, btnW, btnH, 6, 6)
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(0.7, 0.7, 0.8, fadeIn)
    love.graphics.printf("Refresh", bx, btnY + 9, btnW, "center")

    -- Direct
    bx = bx + btnW + 10
    love.graphics.setColor(0.2, 0.15, 0.25, 0.8 * fadeIn)
    love.graphics.rectangle("fill", bx, btnY, btnW, btnH, 6, 6)
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(0.8, 0.7, 0.9, fadeIn)
    love.graphics.printf("Direct", bx, btnY + 9, btnW, "center")

    -- Back
    bx = bx + btnW + 10
    love.graphics.setColor(0.15, 0.12, 0.12, 0.8 * fadeIn)
    love.graphics.rectangle("fill", bx, btnY, btnW, btnH, 6, 6)
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(0.8, 0.6, 0.6, fadeIn)
    love.graphics.printf("Back", bx, btnY + 9, btnW, "center")
end

-- =========================================================================
-- Direct Connect
-- =========================================================================

function shards.drawDirectConnect(W, H)
    love.graphics.setFont(fonts.subtitle)
    love.graphics.setColor(0.8, 0.7, 0.9, fadeIn * 0.9)
    love.graphics.printf("Direct Connect", 0, 68, W, "center")

    love.graphics.setFont(fonts.detail)
    love.graphics.setColor(0.6, 0.6, 0.7, fadeIn * 0.6)
    love.graphics.printf("Connect to a specific server by IP address", 0, 90, W, "center")

    local fieldW = 300
    local fieldH = 40
    local fieldX = (W - fieldW) / 2

    shards.drawField(directFields.host, fieldX, 125, fieldW, fieldH)
    shards.drawField(directFields.port, fieldX, 190, fieldW, fieldH)

    -- Connect button
    local btnW = 200
    local btnH = 48
    local btnX = (W - btnW) / 2
    local btnY = 260

    local canConnect = #directFields.host.text > 0 and #directFields.port.text > 0
    love.graphics.setColor(canConnect and 0.15 or 0.2, canConnect and 0.5 or 0.2, canConnect and 0.25 or 0.2, (canConnect and 0.95 or 0.6) * fadeIn)
    love.graphics.rectangle("fill", btnX, btnY, btnW, btnH, 8, 8)
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(canConnect and 1 or 0.4, canConnect and 1 or 0.4, canConnect and 1 or 0.4, fadeIn)
    love.graphics.printf("Connect", btnX, btnY + 12, btnW, "center")

    -- Back button
    local backW = 120
    local backX = (W - backW) / 2
    local backY = btnY + btnH + 15
    love.graphics.setColor(0.15, 0.15, 0.25, 0.8 * fadeIn)
    love.graphics.rectangle("fill", backX, backY, backW, 36, 6, 6)
    love.graphics.setFont(fonts.detail)
    love.graphics.setColor(0.7, 0.7, 0.8, fadeIn)
    love.graphics.printf("Back", backX, backY + 9, backW, "center")
end

-- =========================================================================
-- Host Custom Server Wizard
-- =========================================================================

function shards.drawHostCustom(W, H)
    love.graphics.setFont(fonts.subtitle)
    love.graphics.setColor(0.9, 0.7, 0.8, fadeIn * 0.9)
    love.graphics.printf("Host Game", 0, 62, W, "center")

    love.graphics.setFont(fonts.detail)
    love.graphics.setColor(0.6, 0.6, 0.7, fadeIn * 0.6)
    love.graphics.printf("Friends on your network can join automatically", 0, 84, W, "center")

    local fieldW = 280
    local fieldH = 32
    local fieldX = (W - fieldW) / 2
    local y = 108

    -- Server name + password (always visible)
    shards.drawField(customFields.name, fieldX, y, fieldW, fieldH); y = y + 48
    shards.drawField(customFields.password, fieldX, y, fieldW, fieldH); y = y + 44

    -- Quick Start button (prominent, right after essentials)
    local btnW = 220
    local btnH = 44
    local btnX = (W - btnW) / 2
    love.graphics.setColor(0.15, 0.35, 0.2, 0.95 * fadeIn)
    love.graphics.rectangle("fill", btnX, y, btnW, btnH, 8, 8)
    love.graphics.setColor(0.3, 0.8, 0.4, 0.8 * fadeIn)
    love.graphics.rectangle("line", btnX, y, btnW, btnH, 8, 8)
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(0.8, 1, 0.8, fadeIn)
    love.graphics.printf("Start Server", btnX, y + 10, btnW, "center")
    y = y + btnH + 12

    -- Advanced toggle
    local advW = 140
    local advX = (W - advW) / 2
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.65, fadeIn * 0.7)
    local advLabel = hostAdvancedOpen and "v Hide Advanced" or "> Show Advanced"
    love.graphics.printf(advLabel, advX, y, advW, "center")
    y = y + 20

    if hostAdvancedOpen then
        -- Port
        shards.drawField(customFields.port, fieldX, y, fieldW, fieldH); y = y + 44

        -- Compact settings row
        love.graphics.setFont(fonts.small)
        local adjX = fieldX + 160

        love.graphics.setColor(0.7, 0.7, 0.8, fadeIn * 0.8)
        love.graphics.print("Max Players: " .. customToggles.maxPlayers, fieldX, y)
        shards.drawSmallBtn(adjX, y - 2, 24, 20, "-"); shards.drawSmallBtn(adjX + 28, y - 2, 24, 20, "+"); y = y + 26

        love.graphics.setColor(0.7, 0.7, 0.8, fadeIn * 0.8)
        love.graphics.print("XP Rate: " .. string.format("%.1fx", customToggles.xpRate), fieldX, y)
        shards.drawSmallBtn(adjX, y - 2, 24, 20, "-"); shards.drawSmallBtn(adjX + 28, y - 2, 24, 20, "+"); y = y + 26

        love.graphics.setColor(0.7, 0.7, 0.8, fadeIn * 0.8)
        love.graphics.print("Drop Rate: " .. string.format("%.1fx", customToggles.dropRate), fieldX, y)
        shards.drawSmallBtn(adjX, y - 2, 24, 20, "-"); shards.drawSmallBtn(adjX + 28, y - 2, 24, 20, "+"); y = y + 26

        love.graphics.setColor(0.7, 0.7, 0.8, fadeIn * 0.8)
        love.graphics.print("PvP: " .. (customToggles.pvpEnabled and "ON" or "OFF"), fieldX, y)
        shards.drawSmallBtn(adjX, y - 2, 60, 20, customToggles.pvpEnabled and "ON" or "OFF"); y = y + 26

        love.graphics.setColor(0.7, 0.7, 0.8, fadeIn * 0.8)
        love.graphics.print("Public: " .. (customToggles.public and "ON" or "OFF"), fieldX, y)
        shards.drawSmallBtn(adjX, y - 2, 60, 20, customToggles.public and "ON" or "OFF"); y = y + 26
    end

    -- Back button
    local backW = 100
    local backX = (W - backW) / 2
    love.graphics.setColor(0.15, 0.12, 0.12, 0.8 * fadeIn)
    love.graphics.rectangle("fill", backX, y + 4, backW, 32, 6, 6)
    love.graphics.setFont(fonts.detail)
    love.graphics.setColor(0.8, 0.6, 0.6, fadeIn)
    love.graphics.printf("Back", backX, y + 11, backW, "center")
end

function shards.drawSmallBtn(x, y, w, h, label)
    love.graphics.setColor(0.18, 0.18, 0.28, 0.9 * fadeIn)
    love.graphics.rectangle("fill", x, y, w, h, 4, 4)
    love.graphics.setColor(0.4, 0.4, 0.6, 0.7 * fadeIn)
    love.graphics.rectangle("line", x, y, w, h, 4, 4)
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.9, 0.9, 1, fadeIn)
    love.graphics.printf(label, x, y + 3, w, "center")
end

-- =========================================================================
-- Launching / Hosting screens
-- =========================================================================

function shards.drawLaunching(W, H)
    love.graphics.setFont(fonts.subtitle)
    love.graphics.setColor(0.6, 0.7, 0.9, fadeIn * 0.9)
    love.graphics.printf(launchMsg, 0, H / 2 - 40, W, "center")

    -- Spinner
    local t = love.timer.getTime()
    for i = 0, 7 do
        local angle = t * 3 + i * math.pi / 4
        local alpha = (1 - i / 8) * fadeIn * 0.8
        love.graphics.setColor(0.4, 0.6, 1.0, alpha)
        love.graphics.circle("fill", W / 2 + math.cos(angle) * 20, H / 2 + 10 + math.sin(angle) * 20, 4)
    end
end

function shards.drawHosting(W, H)
    love.graphics.setFont(fonts.subtitle)
    love.graphics.setColor(0.5, 0.85, 0.5, fadeIn * 0.9)
    love.graphics.printf("Server Running", 0, H / 2 - 30, W, "center")

    if hostInfo then
        love.graphics.setFont(fonts.detail)
        love.graphics.setColor(0.8, 0.8, 0.9, fadeIn * 0.8)
        love.graphics.printf(
            (hostInfo.name or "Server") .. " - " .. (hostInfo.ip or "?") .. ":" .. (hostInfo.port or 3001),
            0, H / 2, W, "center"
        )
    end
end

-- =========================================================================
-- Shared field drawing
-- =========================================================================

function shards.drawField(field, x, y, w, h)
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.7, 0.7, 0.8, fadeIn * 0.8)
    love.graphics.print(field.label, x, y - 14)

    if field.active then
        love.graphics.setColor(0.12, 0.15, 0.25, 0.95 * fadeIn)
    else
        love.graphics.setColor(0.1, 0.1, 0.16, 0.85 * fadeIn)
    end
    love.graphics.rectangle("fill", x, y, w, h, 6, 6)

    if field.active then
        love.graphics.setColor(0.4, 0.6, 1.0, 0.8 * fadeIn)
    else
        love.graphics.setColor(0.3, 0.3, 0.4, 0.5 * fadeIn)
    end
    love.graphics.rectangle("line", x, y, w, h, 6, 6)

    love.graphics.setFont(fonts.detail)
    if #field.text == 0 then
        love.graphics.setColor(0.4, 0.4, 0.5, fadeIn * 0.5)
        love.graphics.print(field.placeholder, x + 8, y + (h - 14) / 2)
    else
        love.graphics.setColor(1, 1, 1, fadeIn)
        love.graphics.print(field.text, x + 8, y + (h - 14) / 2)
    end

    if field.active and cursorVisible then
        local textW = fonts.detail:getWidth(field.text)
        love.graphics.setColor(1, 1, 1, fadeIn * 0.8)
        love.graphics.rectangle("fill", x + 8 + textW + 1, y + 4, 2, h - 8)
    end
end

-- =========================================================================
-- Input handling
-- =========================================================================

function shards.mousemoved(x, y)
    if currentMode == MODE_BROWSE then
        local W = love.graphics.getWidth()
        local cardW = math.min(550, W - 60)
        local cardH = 70
        local cardX = (W - cardW) / 2
        local startY = 100

        hoverIndex = nil
        local allServers = shards._currentAllServers or {}
        local visibleStart = scrollOffset + 1
        local visibleEnd = math.min(#allServers, scrollOffset + maxVisible)
        for idx = visibleStart, visibleEnd do
            local drawIdx = idx - scrollOffset
            local cy = startY + (drawIdx - 1) * (cardH + 8)
            if x >= cardX and x <= cardX + cardW and y >= cy and y <= cy + cardH then
                hoverIndex = idx
                break
            end
        end
    end
end

function shards.mousepressed(x, y, button)
    if button ~= 1 then return end
    audio.playClick()

    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()

    if currentMode == MODE_MAIN then
        shards.handleMainClick(x, y, W, H)
    elseif currentMode == MODE_BROWSE then
        shards.handleBrowseClick(x, y, W, H)
    elseif currentMode == MODE_DIRECT then
        shards.handleDirectClick(x, y, W, H)
    elseif currentMode == MODE_HOST_CUSTOM then
        shards.handleCustomClick(x, y, W, H)
    end
end

function shards.handleMainClick(x, y, W, H)
    local btnW = math.min(400, W - 80)
    local btnH = 52
    local gap = 12
    local startY = 100
    local btnX = (W - btnW) / 2

    for i, _ in ipairs(mainButtons) do
        local by = startY + (i - 1) * (btnH + gap)
        if x >= btnX and x <= btnX + btnW and y >= by and y <= by + btnH then
            if i == 1 then     shards.startOffline()
            elseif i == 2 then currentMode = MODE_HOST_CUSTOM; activeField = nil; hostAdvancedOpen = false
            elseif i == 3 then shards.enterBrowse()
            elseif i == 4 then currentMode = MODE_DIRECT; directFields.host.text = ""; directFields.port.text = "3001"; shards.setActiveField(directFields.host)
            end
            return
        end
    end
end

function shards.handleBrowseClick(x, y, W, H)
    local cardW = math.min(550, W - 60)
    local cardH = 70
    local cardX = (W - cardW) / 2
    local startY = 100

    -- Server cards
    local allServers = shards._currentAllServers or {}
    local visibleStart = scrollOffset + 1
    local visibleEnd = math.min(#allServers, scrollOffset + maxVisible)
    for idx = visibleStart, visibleEnd do
        local drawIdx = idx - scrollOffset
        local cy = startY + (drawIdx - 1) * (cardH + 8)
        if x >= cardX and x <= cardX + cardW and y >= cy and y <= cy + cardH then
            selectedIndex = idx
            return
        end
    end

    -- Bottom buttons
    local btnY = H - 60
    local btnW = 130
    local btnH = 40
    local totalW = btnW * 4 + 30
    local bx = (W - totalW) / 2

    -- Connect
    if x >= bx and x <= bx + btnW and y >= btnY and y <= btnY + btnH then
        shards.browseConnect()
        return
    end
    bx = bx + btnW + 10
    -- Refresh
    if x >= bx and x <= bx + btnW and y >= btnY and y <= btnY + btnH then
        shards.fetchShardList()
        return
    end
    bx = bx + btnW + 10
    -- Direct
    if x >= bx and x <= bx + btnW and y >= btnY and y <= btnY + btnH then
        currentMode = MODE_DIRECT
        directFields.host.text = ""
        directFields.port.text = "3001"
        shards.setActiveField(directFields.host)
        return
    end
    bx = bx + btnW + 10
    -- Back
    if x >= bx and x <= bx + btnW and y >= btnY and y <= btnY + btnH then
        currentMode = MODE_MAIN
        lanDiscovery.stop()
        return
    end
end

function shards.handleDirectClick(x, y, W, H)
    local fieldW = 300
    local fieldH = 40
    local fieldX = (W - fieldW) / 2

    if x >= fieldX and x <= fieldX + fieldW and y >= 125 and y <= 125 + fieldH then
        shards.setActiveField(directFields.host); return
    end
    if x >= fieldX and x <= fieldX + fieldW and y >= 190 and y <= 190 + fieldH then
        shards.setActiveField(directFields.port); return
    end

    local btnW = 200
    local btnX = (W - btnW) / 2
    if x >= btnX and x <= btnX + btnW and y >= 260 and y <= 308 then
        shards.directConnectGo(); return
    end

    local backW = 120
    local backX = (W - backW) / 2
    if x >= backX and x <= backX + backW and y >= 323 and y <= 359 then
        currentMode = MODE_BROWSE; activeField = nil; return
    end

    shards.setActiveField(nil)
end

function shards.handleCustomClick(x, y, W, H)
    local fieldW = 280
    local fieldH = 32
    local fieldX = (W - fieldW) / 2
    local fy = 108

    -- Name field
    if x >= fieldX and x <= fieldX + fieldW and y >= fy and y <= fy + fieldH then
        shards.setActiveFieldCustom(customFields.name); return
    end; fy = fy + 48
    -- Password field
    if x >= fieldX and x <= fieldX + fieldW and y >= fy and y <= fy + fieldH then
        shards.setActiveFieldCustom(customFields.password); return
    end; fy = fy + 44

    -- Start Server button
    local btnW = 220
    local btnH = 44
    local btnX = (W - btnW) / 2
    if x >= btnX and x <= btnX + btnW and y >= fy and y <= fy + btnH then
        shards.startCustomServer(); return
    end
    fy = fy + btnH + 12

    -- Advanced toggle
    local advW = 140
    local advX = (W - advW) / 2
    if x >= advX and x <= advX + advW and y >= fy and y <= fy + 20 then
        hostAdvancedOpen = not hostAdvancedOpen; return
    end
    fy = fy + 20

    if hostAdvancedOpen then
        -- Port field
        if x >= fieldX and x <= fieldX + fieldW and y >= fy and y <= fy + fieldH then
            shards.setActiveFieldCustom(customFields.port); return
        end; fy = fy + 44

        local adjX = fieldX + 160

        -- Max Players -/+
        if x >= adjX and x <= adjX + 24 and y >= fy - 2 and y <= fy + 18 then
            customToggles.maxPlayers = math.max(2, customToggles.maxPlayers - 2); return
        end
        if x >= adjX + 28 and x <= adjX + 52 and y >= fy - 2 and y <= fy + 18 then
            customToggles.maxPlayers = math.min(32, customToggles.maxPlayers + 2); return
        end; fy = fy + 26

        -- XP Rate -/+
        if x >= adjX and x <= adjX + 24 and y >= fy - 2 and y <= fy + 18 then
            customToggles.xpRate = math.max(0.5, customToggles.xpRate - 0.5); return
        end
        if x >= adjX + 28 and x <= adjX + 52 and y >= fy - 2 and y <= fy + 18 then
            customToggles.xpRate = math.min(5.0, customToggles.xpRate + 0.5); return
        end; fy = fy + 26

        -- Drop Rate -/+
        if x >= adjX and x <= adjX + 24 and y >= fy - 2 and y <= fy + 18 then
            customToggles.dropRate = math.max(0.5, customToggles.dropRate - 0.5); return
        end
        if x >= adjX + 28 and x <= adjX + 52 and y >= fy - 2 and y <= fy + 18 then
            customToggles.dropRate = math.min(5.0, customToggles.dropRate + 0.5); return
        end; fy = fy + 26

        -- PvP toggle
        if x >= adjX and x <= adjX + 60 and y >= fy - 2 and y <= fy + 18 then
            customToggles.pvpEnabled = not customToggles.pvpEnabled; return
        end; fy = fy + 26

        -- Public toggle
        if x >= adjX and x <= adjX + 60 and y >= fy - 2 and y <= fy + 18 then
            customToggles.public = not customToggles.public; return
        end; fy = fy + 26
    end

    -- Back button
    local backW = 100
    local backX = (W - backW) / 2
    if x >= backX and x <= backX + backW and y >= fy + 4 and y <= fy + 36 then
        currentMode = MODE_MAIN; activeField = nil; return
    end

    shards.setActiveFieldCustom(nil)
end

function shards.keypressed(key)
    if currentMode == MODE_DIRECT then
        if key == "escape" then currentMode = MODE_BROWSE; activeField = nil; return end
        if key == "tab" then
            if activeField == directFields.host then shards.setActiveField(directFields.port)
            else shards.setActiveField(directFields.host) end
            return
        end
        if key == "return" or key == "kpenter" then shards.directConnectGo(); return end
        if key == "backspace" and activeField then
            activeField.text = activeField.text:sub(1, -2)
            cursorTimer = 0; cursorVisible = true
            return
        end
        return
    end

    if currentMode == MODE_HOST_CUSTOM then
        if key == "escape" then currentMode = MODE_MAIN; activeField = nil; return end
        if key == "tab" then
            -- Cycle: name → password (→ port if advanced open)
            local fields = { customFields.name, customFields.password }
            if hostAdvancedOpen then
                fields = { customFields.name, customFields.password, customFields.port }
            end
            for i, f in ipairs(fields) do
                if f == activeField then
                    shards.setActiveFieldCustom(fields[(i % #fields) + 1])
                    return
                end
            end
            shards.setActiveFieldCustom(fields[1])
            return
        end
        if key == "return" or key == "kpenter" then
            if activeField then
                if activeField == customFields.name then
                    shards.setActiveFieldCustom(customFields.password)
                else
                    shards.startCustomServer()
                end
            else
                shards.startCustomServer()
            end
            return
        end
        if key == "backspace" and activeField then
            activeField.text = activeField.text:sub(1, -2)
            cursorTimer = 0; cursorVisible = true
            return
        end
        return
    end

    if currentMode == MODE_BROWSE then
        if key == "escape" then currentMode = MODE_MAIN; lanDiscovery.stop(); return end
        local allServers = shards._currentAllServers or {}
        if key == "up" then
            selectedIndex = math.max(1, selectedIndex - 1)
            if selectedIndex <= scrollOffset then scrollOffset = selectedIndex - 1 end
        elseif key == "down" then
            selectedIndex = math.min(#allServers, selectedIndex + 1)
            if selectedIndex > scrollOffset + maxVisible then scrollOffset = selectedIndex - maxVisible end
        elseif key == "return" or key == "kpenter" then
            shards.browseConnect()
        elseif key == "r" then
            shards.fetchShardList()
        elseif key == "d" then
            currentMode = MODE_DIRECT
            directFields.host.text = ""
            directFields.port.text = "3001"
            shards.setActiveField(directFields.host)
        end
        return
    end

    if currentMode == MODE_MAIN then
        if key == "1" then shards.startOffline()
        elseif key == "2" then currentMode = MODE_HOST_CUSTOM; activeField = nil; hostAdvancedOpen = false
        elseif key == "3" then shards.enterBrowse()
        elseif key == "4" then currentMode = MODE_DIRECT; directFields.host.text = ""; directFields.port.text = "3001"; shards.setActiveField(directFields.host)
        end
        return
    end
end

function shards.textinput(text)
    if not activeField then return end

    if currentMode == MODE_DIRECT then
        if activeField == directFields.port then
            if text:match("^%d$") and #activeField.text < 5 then
                activeField.text = activeField.text .. text
                cursorTimer = 0; cursorVisible = true
            end
        else
            if text:match("^[a-zA-Z0-9%.%-_:]$") and #activeField.text < 60 then
                activeField.text = activeField.text .. text
                cursorTimer = 0; cursorVisible = true
            end
        end
    elseif currentMode == MODE_HOST_CUSTOM then
        if activeField == customFields.port then
            if text:match("^%d$") and #activeField.text < 5 then
                activeField.text = activeField.text .. text
                cursorTimer = 0; cursorVisible = true
            end
        else
            if #activeField.text < 40 then
                activeField.text = activeField.text .. text
                cursorTimer = 0; cursorVisible = true
            end
        end
    end
end

function shards.wheelmoved(wx, wy)
    if currentMode ~= MODE_BROWSE then return end
    local allServers = shards._currentAllServers or {}
    if #allServers <= maxVisible then return end

    if wy > 0 then
        scrollOffset = math.max(0, scrollOffset - 1)
    elseif wy < 0 then
        scrollOffset = math.min(#allServers - maxVisible, scrollOffset + 1)
    end
end

-- =========================================================================
-- Field helpers
-- =========================================================================

function shards.setActiveField(field)
    directFields.host.active = false
    directFields.port.active = false
    if field then
        field.active = true
        activeField = field
        cursorTimer = 0; cursorVisible = true
    else
        activeField = nil
    end
end

function shards.setActiveFieldCustom(field)
    customFields.name.active = false
    customFields.port.active = false
    customFields.password.active = false
    if field then
        field.active = true
        activeField = field
        cursorTimer = 0; cursorVisible = true
    else
        activeField = nil
    end
end

-- =========================================================================
-- Actions
-- =========================================================================

function shards.startOffline()
    if serverLauncher.launching then
        errorMsg = "Server is starting, please wait..."; errorTimer = 3; return
    end
    -- If a server is already running, just reconnect (don't restart and lose accounts)
    if serverLauncher.running then
        _G.offlineMode = true
        _G.selectedShard = { name = "Offline - Solo Play", host = "127.0.0.1", port = 3001, offline = true }
        _G.isServerHost = true
        _G.switchScene("login")
        return
    end
    _G.offlineMode = true
    launchMsg = "Starting local server..."
    currentMode = MODE_LAUNCHING

    -- Quick probe (1s timeout): if a server from a previous session is still alive, reuse it
    net.fetchHealth("127.0.0.1", 3001, function(success)
        if success then
            serverLauncher.running = true
            print("[shards] Found existing server on port 3001, skipping launch")
            return
        end
        -- No server found, launch one
        serverLauncher.launch({ offline = true, port = 3001 }, function(ok, err)
            if not ok then
                errorMsg = err or "Failed to start server"
                errorTimer = 5
                currentMode = MODE_MAIN
                _G.offlineMode = false
            end
        end)
    end)
end

function shards.startCustomServer()
    if serverLauncher.launching then
        errorMsg = "Server is starting, please wait..."; errorTimer = 3; return
    end
    -- If a server is already running, reconnect to it (don't restart and lose accounts)
    if serverLauncher.running then
        local port = tonumber(customFields.port.text) or 3001
        _G.offlineMode = false
        _G.selectedShard = {
            name = customFields.name.text ~= "" and customFields.name.text or "My Server",
            host = "127.0.0.1",
            port = port,
            lan = true,
        }
        _G.isServerHost = true
        _G.switchScene("login")
        return
    end

    local port = tonumber(customFields.port.text) or 3001
    if port < 1024 or port > 65535 then
        errorMsg = "Port must be 1024-65535"; errorTimer = 3; return
    end

    _G.offlineMode = false
    launchMsg = "Starting custom server..."
    hostInfo = {
        name = customFields.name.text ~= "" and customFields.name.text or "My Server",
        port = port,
    }
    currentMode = MODE_LAUNCHING

    local opts = {
        custom = true,
        offline = false,
        port = port,
        shardName = hostInfo.name,
        maxPlayers = customToggles.maxPlayers,
        xpRate = customToggles.xpRate,
        dropRate = customToggles.dropRate,
        pvpEnabled = customToggles.pvpEnabled,
        public = customToggles.public,
        password = customFields.password.text,
    }

    -- Save config for reuse
    serverLauncher.saveServerConfig(hostInfo.name, opts)

    serverLauncher.launch(opts, function(success, err)
        if not success then
            errorMsg = err or "Failed to start server"
            errorTimer = 5
            currentMode = MODE_MAIN
        end
    end)
end

function shards.enterBrowse()
    currentMode = MODE_BROWSE
    scrollOffset = 0
    selectedIndex = 1
    shards._currentAllServers = {}

    -- Start LAN discovery
    lanDiscovery.start()

    -- Fetch online servers
    shards.fetchShardList()
end

function shards.browseConnect()
    local allServers = shards._currentAllServers or {}
    if #allServers == 0 or selectedIndex < 1 or selectedIndex > #allServers then
        errorMsg = "No server selected"; errorTimer = 3; return
    end

    local srv = allServers[selectedIndex]
    if srv.status ~= "online" then
        errorMsg = "Server is offline"; errorTimer = 3; return
    end

    _G.offlineMode = false
    _G.selectedShard = {
        name = srv.name,
        host = srv.host,
        port = srv.port,
        lan = srv.isLAN or false,
    }
    lanDiscovery.stop()
    _G.switchScene("login")
end

function shards.directConnectGo()
    local host = directFields.host.text
    local port = tonumber(directFields.port.text)

    if #host == 0 then
        errorMsg = "Enter a host address"; errorTimer = 3; return
    end
    if not port or port < 1 or port > 65535 then
        errorMsg = "Enter a valid port (1-65535)"; errorTimer = 3; return
    end

    currentMode = MODE_BROWSE
    activeField = nil
    _G.offlineMode = false

    _G.selectedShard = {
        name = host .. ":" .. port,
        host = host,
        port = port,
    }
    lanDiscovery.stop()
    _G.switchScene("login")
end

function shards.tryConnect()
    shards.browseConnect()
end

function shards.unload()
    lanDiscovery.stop()
end

return shards
