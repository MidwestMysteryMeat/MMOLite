-- scenes/login.lua
-- Automatic key assignment + PIN setup flow
-- First time: auto-connect → get key → set PIN
-- Returning: enter PIN → connect with saved key

local net = require("lib.net")
local sha256 = require("lib.sha256")
local audio = require("lib.audio")

local login = {}

local MODE_PIN_ENTRY = "pin_entry"       -- (Legacy, unused) Returning player enters PIN
local MODE_SOLVING = "solving"           -- Solving PoW
local MODE_CONNECTING = "connecting"     -- Connecting to server
local MODE_PIN_SETUP = "pin_setup"       -- (Legacy, unused) New player sets PIN
local MODE_PASSWORD = "password"         -- Server password prompt
local MODE_RETRY = "retry"              -- Connection failed, offer retry

local mode = MODE_SOLVING
local fonts = {}
local fadeIn = 0

-- Input fields
local pinField = { text = "", label = "PIN", placeholder = "4-8 character PIN", masked = true, active = false }
local passwordField = { text = "", label = "Server Password", placeholder = "Enter password", masked = true, active = false }
local activeField = nil

-- State
local powChallenge = nil
local powDifficulty = nil
local powNonce = nil
local powSolving = false
local powProgress = 0
local powBatchSize = 5000  -- keep per-frame batch small to avoid blocking rendering
local powCurrentAttempt = 0
local statusMsg = ""
local errorMsg = nil
local errorTimer = 0
local savedKey = nil
local receivedKey = nil  -- key received from server for new accounts

-- Cursor blink
local cursorTimer = 0
local cursorVisible = true

-- Pre-generated star positions (generated once, drawn every frame)
local loginStars = nil

local function recreateFonts()
    fonts.title = love.graphics.newFont(32)
    fonts.subtitle = love.graphics.newFont(16)
    fonts.label = love.graphics.newFont(15)
    fonts.input = love.graphics.newFont(16)
    fonts.button = love.graphics.newFont(18)
    fonts.detail = love.graphics.newFont(13)
    fonts.status = love.graphics.newFont(14)
    fonts.key = love.graphics.newFont(14)
end

function login.resize(w, h)
    recreateFonts()
end

function login.load()
    recreateFonts()

    fadeIn = 0
    errorMsg = nil
    statusMsg = ""
    powSolving = false
    powNonce = nil
    pinField.text = ""
    pinField.active = false
    activeField = nil
    receivedKey = nil

    -- Pre-generate star positions once
    local W, H = love.graphics.getDimensions()
    loginStars = {}
    math.randomseed(42)
    for i = 1, 40 do
        loginStars[i] = { x = math.random(0, W), y = math.random(0, H), r = 1 + math.random() * 1 }
    end
    math.randomseed(os.time())

    -- Load saved key
    login.loadSavedKey()

    if savedKey then
        -- Returning player: skip PIN, connect directly
        mode = MODE_SOLVING
        login.startConnect(savedKey, nil)
    else
        -- New player: start connecting immediately
        mode = MODE_SOLVING
        login.startConnect(nil, nil)
    end
end

function login.loadSavedKey()
    savedKey = nil
    local info = love.filesystem.getInfo("account.dat")
    if info then
        local data = love.filesystem.read("account.dat")
        if data and #data > 0 then
            local key = data:match("^(%S+)")
            if key and #key >= 12 then
                savedKey = key
            end
        end
    end
end

function login.saveKey(key)
    if key and #key >= 12 then
        love.filesystem.write("account.dat", key)
        savedKey = key
    end
end

function login.update(dt)
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

    -- Solve PoW incrementally (non-blocking)
    if powSolving and powChallenge and powDifficulty then
        local batchEnd = powCurrentAttempt + powBatchSize
        for i = powCurrentAttempt, batchEnd do
            local nonce = tostring(i)
            local hash = sha256.sha256_binary(powChallenge .. nonce)
            if sha256.hasLeadingZeros(hash, powDifficulty) then
                powNonce = nonce
                powSolving = false
                statusMsg = "Connecting..."
                login.finishConnect()
                return
            end
        end
        powCurrentAttempt = batchEnd + 1
        powProgress = math.min(powCurrentAttempt / 2000000, 0.99)
        statusMsg = "Loading..."

        if powCurrentAttempt > 10000000 then
            powSolving = false
            errorMsg = "Connection failed (too many attempts)"
            errorTimer = 5
            mode = MODE_RETRY
        end
    end
end

function login.draw()
    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()

    -- Background
    love.graphics.setColor(0.08, 0.08, 0.14, fadeIn)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Stars (pre-generated positions)
    love.graphics.setColor(1, 1, 1, 0.2 * fadeIn)
    if loginStars then
        for i = 1, #loginStars do
            local s = loginStars[i]
            love.graphics.circle("fill", s.x, s.y, s.r)
        end
    end

    -- Back button
    love.graphics.setFont(fonts.detail)
    love.graphics.setColor(0.5, 0.5, 0.6, fadeIn)
    love.graphics.print("< Back", 15, 12)

    -- Server name
    local shard = _G.selectedShard or { name = "Unknown" }
    love.graphics.setFont(fonts.detail)
    love.graphics.setColor(0.5, 0.7, 0.5, fadeIn * 0.7)
    love.graphics.printf("Server: " .. shard.name, 0, 12, W - 15, "right")

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.94, 0.7, 0.2, fadeIn)
    love.graphics.printf("MMOLite", 0, 40, W, "center")

    if mode == MODE_RETRY then
        login.drawRetry(W, H)
    elseif mode == MODE_SOLVING or mode == MODE_CONNECTING then
        login.drawProgress(W, H)
    elseif mode == MODE_PASSWORD then
        login.drawPasswordPrompt(W, H)
    elseif mode == MODE_PIN_ENTRY then
        login.drawPinEntry(W, H)
    elseif mode == MODE_PIN_SETUP then
        login.drawPinSetup(W, H)
    end

    -- Error message
    if errorMsg then
        love.graphics.setFont(fonts.status)
        love.graphics.setColor(1, 0.3, 0.3, fadeIn * math.min(1, errorTimer))
        love.graphics.printf(errorMsg, 20, H - 45, W - 40, "center")
    end
end

function login.drawPinEntry(W, H)
    love.graphics.setFont(fonts.subtitle)
    love.graphics.setColor(0.7, 0.7, 0.8, fadeIn * 0.8)
    love.graphics.printf("Welcome Back", 0, 100, W, "center")

    love.graphics.setFont(fonts.detail)
    love.graphics.setColor(0.6, 0.6, 0.7, fadeIn * 0.6)
    love.graphics.printf("Enter your PIN to continue", 0, 128, W, "center")

    -- Saved key hint
    if savedKey then
        love.graphics.setFont(fonts.detail)
        love.graphics.setColor(0.5, 0.6, 0.4, fadeIn * 0.5)
        love.graphics.printf("Account: " .. savedKey:sub(1, 4) .. "..." .. savedKey:sub(-2), 0, 152, W, "center")
    end

    local fieldW = 300
    local fieldH = 45
    local fieldX = (W - fieldW) / 2
    local fieldY = 180
    login.drawField(pinField, fieldX, fieldY, fieldW, fieldH)

    -- Connect button
    local btnW = 200
    local btnH = 50
    local btnX = (W - btnW) / 2
    local btnY = fieldY + fieldH + 30

    local canConnect = #pinField.text >= 4
    if canConnect then
        love.graphics.setColor(0.15, 0.35, 0.55, 0.95 * fadeIn)
    else
        love.graphics.setColor(0.15, 0.15, 0.2, 0.6 * fadeIn)
    end
    love.graphics.rectangle("fill", btnX, btnY, btnW, btnH, 8, 8)
    if canConnect then
        love.graphics.setColor(0.4, 0.6, 1.0, 0.7 * fadeIn)
    else
        love.graphics.setColor(0.3, 0.3, 0.4, 0.4 * fadeIn)
    end
    love.graphics.rectangle("line", btnX, btnY, btnW, btnH, 8, 8)

    love.graphics.setFont(fonts.button)
    love.graphics.setColor(canConnect and 1 or 0.4, canConnect and 1 or 0.4, canConnect and 1 or 0.4, fadeIn)
    love.graphics.printf("Connect", btnX, btnY + 14, btnW, "center")

    love.graphics.setFont(fonts.detail)
    love.graphics.setColor(0.5, 0.5, 0.65, fadeIn * 0.5)
    love.graphics.printf("Press Escape for shard selection", 0, btnY + btnH + 15, W, "center")
end

function login.drawRetry(W, H)
    love.graphics.setFont(fonts.subtitle)
    love.graphics.setColor(0.7, 0.7, 0.8, fadeIn * 0.8)
    love.graphics.printf("Connection Failed", 0, 120, W, "center")

    if savedKey then
        love.graphics.setFont(fonts.detail)
        love.graphics.setColor(0.5, 0.6, 0.4, fadeIn * 0.5)
        love.graphics.printf("Account: " .. savedKey:sub(1, 4) .. "..." .. savedKey:sub(-2), 0, 155, W, "center")
    end

    -- Retry button
    local btnW = 200
    local btnH = 50
    local btnX = (W - btnW) / 2
    local btnY = 190

    love.graphics.setColor(0.15, 0.35, 0.55, 0.95 * fadeIn)
    love.graphics.rectangle("fill", btnX, btnY, btnW, btnH, 8, 8)
    love.graphics.setColor(0.4, 0.6, 1.0, 0.7 * fadeIn)
    love.graphics.rectangle("line", btnX, btnY, btnW, btnH, 8, 8)

    love.graphics.setFont(fonts.button)
    love.graphics.setColor(1, 1, 1, fadeIn)
    love.graphics.printf("Retry", btnX, btnY + 14, btnW, "center")

    love.graphics.setFont(fonts.detail)
    love.graphics.setColor(0.5, 0.5, 0.65, fadeIn * 0.5)
    love.graphics.printf("Press Escape for shard selection", 0, btnY + btnH + 15, W, "center")
end

function login.drawProgress(W, H)
    local centerY = H / 2 - 40
    love.graphics.setFont(fonts.subtitle)
    love.graphics.setColor(0.7, 0.8, 1.0, fadeIn)
    love.graphics.printf(statusMsg, 40, centerY, W - 80, "center")

    -- Loading indicator (no detailed progress bar)
    if powSolving then
        -- Just show the spinner below, no bar
    end

    -- Spinner
    local spinY = centerY + 70
    local t = love.timer.getTime()
    for i = 0, 7 do
        local angle = t * 3 + i * math.pi / 4
        local alpha = (1 - i / 8) * fadeIn * 0.8
        love.graphics.setColor(0.4, 0.6, 1.0, alpha)
        local dx = math.cos(angle) * 15
        local dy = math.sin(angle) * 15
        love.graphics.circle("fill", W / 2 + dx, spinY + dy, 3)
    end
end

function login.drawPinSetup(W, H)
    love.graphics.setFont(fonts.subtitle)
    love.graphics.setColor(0.7, 0.8, 0.6, fadeIn * 0.9)
    love.graphics.printf("Welcome to MMOLite!", 0, 95, W, "center")

    love.graphics.setFont(fonts.detail)
    love.graphics.setColor(0.6, 0.7, 0.6, fadeIn * 0.7)
    love.graphics.printf("Your account has been created. Set a PIN to secure it.", 40, 123, W - 80, "center")

    -- Show the assigned key
    if receivedKey then
        love.graphics.setFont(fonts.key)
        love.graphics.setColor(0.4, 0.5, 0.35, fadeIn * 0.6)
        love.graphics.printf("Your key (saved automatically):", 0, 158, W, "center")

        love.graphics.setFont(fonts.key)
        love.graphics.setColor(0.85, 0.75, 0.3, fadeIn * 0.9)
        love.graphics.printf(receivedKey, 0, 176, W, "center")
    end

    local fieldW = 300
    local fieldH = 45
    local fieldX = (W - fieldW) / 2
    local fieldY = 210
    pinField.label = "Choose a PIN"
    pinField.placeholder = "4-8 alphanumeric PIN"
    login.drawField(pinField, fieldX, fieldY, fieldW, fieldH)

    -- Set PIN button
    local btnW = 200
    local btnH = 50
    local btnX = (W - btnW) / 2
    local btnY = fieldY + fieldH + 30

    local canSet = #pinField.text >= 4
    if canSet then
        love.graphics.setColor(0.2, 0.4, 0.2, 0.95 * fadeIn)
    else
        love.graphics.setColor(0.15, 0.15, 0.2, 0.6 * fadeIn)
    end
    love.graphics.rectangle("fill", btnX, btnY, btnW, btnH, 8, 8)
    if canSet then
        love.graphics.setColor(0.3, 0.7, 0.3, 0.7 * fadeIn)
    else
        love.graphics.setColor(0.3, 0.3, 0.4, 0.4 * fadeIn)
    end
    love.graphics.rectangle("line", btnX, btnY, btnW, btnH, 8, 8)

    love.graphics.setFont(fonts.button)
    love.graphics.setColor(canSet and 1 or 0.4, canSet and 1 or 0.4, canSet and 1 or 0.4, fadeIn)
    love.graphics.printf("Set PIN", btnX, btnY + 14, btnW, "center")

    love.graphics.setFont(fonts.detail)
    love.graphics.setColor(0.5, 0.5, 0.6, fadeIn * 0.5)
    love.graphics.printf("You'll need this PIN to log in next time", 0, btnY + btnH + 15, W, "center")
end

function login.drawPasswordPrompt(W, H)
    love.graphics.setFont(fonts.subtitle)
    love.graphics.setColor(0.9, 0.7, 0.5, fadeIn * 0.9)
    love.graphics.printf("Server Password Required", 0, 100, W, "center")

    love.graphics.setFont(fonts.detail)
    love.graphics.setColor(0.6, 0.6, 0.7, fadeIn * 0.6)
    love.graphics.printf("This server is password protected", 0, 128, W, "center")

    local fieldW = 300
    local fieldH = 45
    local fieldX = (W - fieldW) / 2
    local fieldY = 165
    login.drawField(passwordField, fieldX, fieldY, fieldW, fieldH)

    -- Connect button
    local btnW = 200
    local btnH = 50
    local btnX = (W - btnW) / 2
    local btnY = fieldY + fieldH + 30

    local canConnect = #passwordField.text > 0
    if canConnect then
        love.graphics.setColor(0.15, 0.35, 0.55, 0.95 * fadeIn)
    else
        love.graphics.setColor(0.15, 0.15, 0.2, 0.6 * fadeIn)
    end
    love.graphics.rectangle("fill", btnX, btnY, btnW, btnH, 8, 8)
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(canConnect and 1 or 0.4, canConnect and 1 or 0.4, canConnect and 1 or 0.4, fadeIn)
    love.graphics.printf("Connect", btnX, btnY + 14, btnW, "center")
end

function login.drawField(field, x, y, w, h)
    -- Label
    love.graphics.setFont(fonts.label)
    love.graphics.setColor(0.7, 0.7, 0.8, fadeIn * 0.8)
    love.graphics.print(field.label, x, y - 18)

    -- Background
    if field.active then
        love.graphics.setColor(0.12, 0.15, 0.25, 0.95 * fadeIn)
    else
        love.graphics.setColor(0.1, 0.1, 0.16, 0.85 * fadeIn)
    end
    love.graphics.rectangle("fill", x, y, w, h, 6, 6)

    -- Border
    if field.active then
        love.graphics.setColor(0.4, 0.6, 1.0, 0.8 * fadeIn)
    else
        love.graphics.setColor(0.3, 0.3, 0.4, 0.5 * fadeIn)
    end
    love.graphics.rectangle("line", x, y, w, h, 6, 6)

    -- Text or placeholder
    love.graphics.setFont(fonts.input)
    local displayText = field.text
    if field.masked and #displayText > 0 then
        displayText = string.rep("*", #displayText)
    end

    if #field.text == 0 then
        love.graphics.setColor(0.4, 0.4, 0.5, fadeIn * 0.5)
        love.graphics.print(field.placeholder, x + 10, y + 11)
    else
        love.graphics.setColor(1, 1, 1, fadeIn)
        love.graphics.print(displayText, x + 10, y + 11)
    end

    -- Cursor
    if field.active and cursorVisible then
        local textW = fonts.input:getWidth(displayText)
        love.graphics.setColor(1, 1, 1, fadeIn * 0.8)
        love.graphics.rectangle("fill", x + 10 + textW + 1, y + 8, 2, h - 16)
    end
end

function login.setActiveField(field)
    pinField.active = false
    passwordField.active = false
    if field then
        field.active = true
        activeField = field
        cursorTimer = 0
        cursorVisible = true
    else
        activeField = nil
    end
end

function login.mousepressed(x, y, button)
    if button ~= 1 then return end
    audio.playClick()

    local W = love.graphics.getWidth()

    -- Back button
    if x < 80 and y < 30 then
        if mode == MODE_SOLVING or mode == MODE_CONNECTING then
            powSolving = false
            if _G.pendingClient then
                _G.pendingClient:disconnect()
                _G.pendingClient = nil
            end
        end
        _G.switchScene("shards")
        return
    end

    if mode == MODE_RETRY then
        -- Retry button
        local btnW = 200
        local btnX = (W - btnW) / 2
        local btnY = 190
        local btnH = 50
        if x >= btnX and x <= btnX + btnW and y >= btnY and y <= btnY + btnH then
            login.startConnect(savedKey, nil)
            return
        end

    elseif mode == MODE_PIN_ENTRY then
        local fieldW = 300
        local fieldX = (W - fieldW) / 2
        local fieldY = 180
        local fieldH = 45

        -- PIN field click
        if x >= fieldX and x <= fieldX + fieldW and y >= fieldY and y <= fieldY + fieldH then
            login.setActiveField(pinField)
            return
        end

        -- Connect button
        local btnW = 200
        local btnX = (W - btnW) / 2
        local btnY = fieldY + fieldH + 30
        local btnH = 50
        if x >= btnX and x <= btnX + btnW and y >= btnY and y <= btnY + btnH then
            if #pinField.text >= 4 then
                login.startConnect(savedKey, pinField.text)
            end
            return
        end

        login.setActiveField(nil)

    elseif mode == MODE_PIN_SETUP then
        local fieldW = 300
        local fieldX = (W - fieldW) / 2
        local fieldY = 210
        local fieldH = 45

        -- PIN field click
        if x >= fieldX and x <= fieldX + fieldW and y >= fieldY and y <= fieldY + fieldH then
            login.setActiveField(pinField)
            return
        end

        -- Set PIN button
        local btnW = 200
        local btnX = (W - btnW) / 2
        local btnY = fieldY + fieldH + 30
        local btnH = 50
        if x >= btnX and x <= btnX + btnW and y >= btnY and y <= btnY + btnH then
            if #pinField.text >= 4 then
                login.submitPinSetup()
            end
            return
        end

        login.setActiveField(nil)

    elseif mode == MODE_PASSWORD then
        local fieldW = 300
        local fieldX = (W - fieldW) / 2
        local fieldY = 165
        local fieldH = 45

        if x >= fieldX and x <= fieldX + fieldW and y >= fieldY and y <= fieldY + fieldH then
            login.setActiveField(passwordField)
            return
        end

        local btnW = 200
        local btnX = (W - btnW) / 2
        local btnY = fieldY + fieldH + 30
        local btnH = 50
        if x >= btnX and x <= btnX + btnW and y >= btnY and y <= btnY + btnH then
            if #passwordField.text > 0 then
                login.submitPassword()
            end
            return
        end

        login.setActiveField(nil)
    end
end

function login.keypressed(key)
    if key == "escape" then
        if mode == MODE_PIN_SETUP then
            -- Can't skip PIN setup
            return
        end
        if mode == MODE_SOLVING or mode == MODE_CONNECTING then
            powSolving = false
            if _G.pendingClient then
                _G.pendingClient:disconnect()
                _G.pendingClient = nil
            end
        end
        _G.switchScene("shards")
        return
    end

    if mode == MODE_RETRY then
        if key == "return" or key == "kpenter" then
            login.startConnect(savedKey, nil)
            return
        end
    end

    if mode == MODE_PIN_ENTRY or mode == MODE_PIN_SETUP then
        if key == "return" or key == "kpenter" then
            if #pinField.text >= 4 then
                if mode == MODE_PIN_ENTRY then
                    login.startConnect(savedKey, pinField.text)
                else
                    login.submitPinSetup()
                end
            end
            return
        end

        if activeField then
            if key == "backspace" then
                activeField.text = activeField.text:sub(1, -2)
                cursorTimer = 0
                cursorVisible = true
            end
        end
    end

    if mode == MODE_PASSWORD then
        if key == "return" or key == "kpenter" then
            if #passwordField.text > 0 then
                login.submitPassword()
            end
            return
        end
        if activeField and key == "backspace" then
            activeField.text = activeField.text:sub(1, -2)
            cursorTimer = 0
            cursorVisible = true
        end
    end
end

function login.textinput(text)
    if activeField and (mode == MODE_PIN_ENTRY or mode == MODE_PIN_SETUP) then
        if text:match("^[a-zA-Z0-9]$") and #activeField.text < 8 then
            activeField.text = activeField.text .. text
            cursorTimer = 0
            cursorVisible = true
        end
    end
    if activeField and mode == MODE_PASSWORD then
        if #activeField.text < 64 then
            activeField.text = activeField.text .. text
            cursorTimer = 0
            cursorVisible = true
        end
    end
end

function login.startConnect(accountKey, pin)
    mode = MODE_SOLVING
    statusMsg = "Loading..."
    powSolving = false

    local shard = _G.selectedShard
    if not shard then
        errorMsg = "No shard selected"
        errorTimer = 3
        _G.switchScene("shards")
        return
    end

    -- Store auth params for after PoW is solved
    _G.pendingAuth = {
        accountKey = accountKey,
        pin = pin,
    }

    -- Skip PoW for offline mode or localhost connections
    local isLocal = _G.offlineMode
        or shard.offline
        or shard.host == "127.0.0.1"
        or shard.host == "localhost"

    if isLocal then
        powChallenge = "offline"
        powNonce = "0"
        powSolving = false
        statusMsg = "Connecting..."
        login.finishConnect()
        return
    end

    -- Fetch PoW challenge (async)
    net.fetchChallenge(shard.host, shard.port, "connect", function(challenge, err)
        if not challenge then
            errorMsg = "Failed to get challenge: " .. tostring(err)
            errorTimer = 4
            if savedKey then
                mode = MODE_RETRY
            else
                _G.switchScene("shards")
            end
            return
        end

        powChallenge = challenge.challenge
        powDifficulty = challenge.difficulty
        powCurrentAttempt = 0
        powProgress = 0
        powSolving = true
        statusMsg = "Loading..."
    end)
end

function login.finishConnect()
    mode = MODE_CONNECTING
    statusMsg = "Connecting to server..."

    local shard = _G.selectedShard
    local auth = _G.pendingAuth or {}

    -- Build Socket.IO auth params
    local authParams = {
        powChallenge = powChallenge,
        powNonce = powNonce,
    }
    if auth.accountKey then
        authParams.accountKey = auth.accountKey
    end
    if auth.pin then
        authParams.pin = auth.pin
    end
    if auth.serverPassword then
        authParams.serverPassword = auth.serverPassword
    end

    -- Connect via Socket.IO
    local client = net.Client.new()

    -- Clear any stale listeners from a previous connection cycle
    client:off("connect")
    client:off("identity")
    client:off("connect_error")
    client:off("error")
    client:off("pin_required")
    client:off("password_required")

    client:on("connect", function(data)
        statusMsg = "Connected! Loading..."
    end)

    client:on("identity", function(data)
        -- Ignore identity events that are character-switch re-emissions
        -- (those are handled by character_select scene)
        if data and data.isCharacterSwitch then return end

        -- Store connection info globally
        _G.gameClient = client
        _G.identity = data
        _G.pendingClient = nil

        -- Save the account key from server (but NOT in offline mode —
        -- offline servers create throwaway accounts that would overwrite
        -- the player's real production account key)
        local accountData = data and data.account
        if accountData and accountData.key and not _G.offlineMode and not _G.isServerHost then
            login.saveKey(accountData.key)

            -- PIN setup skipped — standalone desktop game, no security benefit.
            -- if accountData.needsPin then
            --     receivedKey = accountData.key
            --     pinField.text = ""
            --     pinField.label = "Choose a PIN"
            --     pinField.placeholder = "4-8 alphanumeric PIN"
            --     mode = MODE_PIN_SETUP
            --     login.setActiveField(pinField)
            --     return
            -- end
        end

        -- Go to character select screen
        _G.switchScene("character_select")
    end)

    client:on("connect_error", function(err)
        local msg = "Connection failed"
        if type(err) == "table" and err.message then
            msg = err.message
        elseif type(err) == "string" then
            msg = err
        end
        errorMsg = msg
        errorTimer = 5
        _G.pendingClient = nil
        if savedKey then
            mode = MODE_RETRY
        else
            _G.switchScene("shards")
        end
    end)

    client:on("error", function(data)
        local msg = "Server error"
        if type(data) == "table" and data.message then msg = data.message end
        errorMsg = msg
        errorTimer = 5
        _G.pendingClient = nil
        if savedKey then
            mode = MODE_RETRY
        else
            _G.switchScene("shards")
        end
    end)

    client:on("pin_required", function(data)
        -- PIN no longer required — server should not send this, but handle gracefully
        _G.pendingClient = nil
        errorMsg = "Server requested PIN (unexpected). Retrying..."
        errorTimer = 4
        mode = MODE_RETRY
    end)

    client:on("password_required", function(data)
        -- Server requires a password
        _G.pendingClient = nil
        client:disconnect()
        errorMsg = "Server requires a password"
        errorTimer = 4
        mode = MODE_PASSWORD
        passwordField.text = ""
        login.setActiveField(passwordField)
    end)

    -- Store auth params for reconnection support
    _G.serverAuth = authParams

    -- Store client globally so update loop can drive it
    _G.pendingClient = client

    -- connect() is fully async — errors come via events
    client:connect(shard.host, shard.port, authParams)
end

function login.submitPinSetup()
    if not _G.gameClient then
        errorMsg = "Not connected to server"
        errorTimer = 3
        return
    end

    local pin = pinField.text
    if #pin < 4 then
        errorMsg = "PIN must be at least 4 characters"
        errorTimer = 3
        return
    end

    statusMsg = "Setting PIN..."

    -- Remove any previous listeners to prevent stacking
    _G.gameClient:off("pin_set_success")
    _G.gameClient:off("pin_set_error")

    -- Listen for response (one-shot)
    _G.gameClient:on("pin_set_success", function(data)
        _G.gameClient:off("pin_set_success")
        _G.gameClient:off("pin_set_error")
        _G.switchScene("character_select")
    end)

    _G.gameClient:on("pin_set_error", function(data)
        _G.gameClient:off("pin_set_success")
        _G.gameClient:off("pin_set_error")
        local msg = "Failed to set PIN"
        if type(data) == "table" and data.message then msg = data.message end
        errorMsg = msg
        errorTimer = 4
    end)

    -- Send PIN setup event
    _G.gameClient:emit("account_set_pin", { pin = pin })
end

function login.submitPassword()
    -- Retry connection with server password
    local auth = _G.pendingAuth or {}
    auth.serverPassword = passwordField.text
    _G.pendingAuth = auth
    login.startConnect(auth.accountKey or savedKey, auth.pin)
end

function login.mousemoved() end

return login
