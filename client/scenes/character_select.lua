-- scenes/character_select.lua
-- Character selection screen shown between login and game.
-- Displays character cards, allows Play/New Character/Rename/Delete/Back.

local net = require("lib.net")
local audio = require("lib.audio")

local charSelect = {}

local fonts = {}
local client = nil
local identity = nil
local fadeIn = 0

-- Character list data from server
local characters = {}
local activeCharacterIndex = 0
local maxCharacters = 4
local selectedIndex = nil  -- which character card is highlighted/selected

-- UI state
local errorMessage = nil
local errorTimer = 0
local statusMessage = nil
local statusTimer = 0

-- Delete confirmation
local showDeleteConfirm = false
local deleteTargetIndex = nil
local deletePinInput = ""
local deletePinActive = false

-- New character dialog
local showNewCharDialog = false
local newCharName = ""
local newCharNameActive = false
local newCharPermadeath = false

-- Hall of Heroes
local showHallOfHeroes = false
local hallOfHeroesList = {}
local hallOfHeroesScrollY = 0

-- Rename dialog
local showRenameDialog = false
local nameLists = nil  -- { prefixes = {...}, names = {...} }
local renamePrefixIdx = 1
local renameNameIdx = 1
local renameNumber = 1
local renameOpenDropdown = nil  -- nil, "prefix", "name", "number"
local renameDropdownScroll = 0
local DROPDOWN_VISIBLE_ITEMS = 8
local DROPDOWN_ITEM_H = 22

-- Button bounds for hit-testing
local playBtn = nil
local newCharBtn = nil
local renameBtn = nil
local deleteBtn = nil
local backBtn = nil
local hallBtn = nil
local newCharPermadeathBtn = nil
local deleteConfirmBtn = nil
local deleteCancelBtn = nil
local newCharConfirmBtn = nil
local newCharCancelBtn = nil
local renameConfirmBtn = nil
local renameCancelBtn = nil
local renameRandomBtn = nil
-- Dropdown field bounds (for click detection)
local renamePrefixField = nil
local renameNameField = nil
local renameNumberField = nil
-- Dropdown list bounds (for click detection when open)
local renameDropdownBounds = nil

local function pointInRect(px, py, r)
    return r and px >= r.x and px <= r.x + r.w and py >= r.y and py <= r.y + r.h
end

local RACE_COLORS = {
    human = {0.9, 0.85, 0.7},
    elf = {0.5, 0.9, 0.7},
    orc = {0.6, 0.8, 0.4},
    dwarf = {0.8, 0.6, 0.4},
    gnome = {0.7, 0.7, 0.9},
    goblin = {0.4, 0.7, 0.3},
    lizardfolk = {0.3, 0.7, 0.7},
    catfolk = {0.9, 0.7, 0.5},
}

local RACE_NAMES = {
    human = "Human", elf = "Elf", orc = "Orc", dwarf = "Dwarf",
    gnome = "Gnome", goblin = "Goblin", lizardfolk = "Lizard Folk", catfolk = "Cat Folk",
}

function charSelect.load()
    fonts.title = love.graphics.newFont(28)
    fonts.subtitle = love.graphics.newFont(18)
    fonts.main = love.graphics.newFont(14)
    fonts.small = love.graphics.newFont(12)
    fonts.button = love.graphics.newFont(16)

    fadeIn = 0
    selectedIndex = nil
    errorMessage = nil
    errorTimer = 0
    statusMessage = nil
    statusTimer = 0
    showDeleteConfirm = false
    deleteTargetIndex = nil
    deletePinInput = ""
    deletePinActive = false
    showNewCharDialog = false
    newCharName = ""
    newCharNameActive = false
    newCharPermadeath = false
    showHallOfHeroes = false
    hallOfHeroesList = {}
    hallOfHeroesScrollY = 0
    showRenameDialog = false
    renameOpenDropdown = nil
    renameDropdownScroll = 0
    renamePrefixIdx = 1
    renameNameIdx = 1
    renameNumber = 1

    client = _G.gameClient
    identity = _G.identity

    -- Load character list from identity data
    if identity and identity.account and identity.account.characterList then
        local cl = identity.account.characterList
        characters = cl.characters or {}
        activeCharacterIndex = cl.activeCharacterIndex or 0
        maxCharacters = cl.maxCharacters or 4
        print("[charSelect] Loaded " .. #characters .. " characters from identity")
    else
        characters = {}
        activeCharacterIndex = 0
        maxCharacters = 4
        print("[charSelect] No characterList in identity, starting with 0 characters")
        if identity then
            print("[charSelect]   identity.account exists: " .. tostring(identity.account ~= nil))
            if identity.account then
                print("[charSelect]   identity.account.characterList exists: " .. tostring(identity.account.characterList ~= nil))
            end
        end
    end

    -- Pre-select the active character
    selectedIndex = activeCharacterIndex

    print("[charSelect] load: client=" .. tostring(client ~= nil) .. ", connected=" .. tostring(client and client.connected))

    if client then
        -- Remove stale listeners from previous scene loads to prevent accumulation
        client:off("character_list_result")
        client:off("character_created")
        client:off("character_deleted")
        client:off("character_switch_result")
        client:off("name_lists")
        client:off("character_renamed")
        client:off("hall_of_heroes_result")

        client:on("character_list_result", function(data)
            print("[charSelect] character_list_result received: " .. tostring(data ~= nil))
            if data and not data.error then
                characters = data.characters or {}
                activeCharacterIndex = data.activeCharacterIndex or 0
                maxCharacters = data.maxCharacters or 4
                print("[charSelect]   Got " .. #characters .. " characters from server")
            elseif data and data.error then
                errorMessage = data.error
                errorTimer = 4
                print("[charSelect]   character_list error: " .. tostring(data.error))
            else
                print("[charSelect]   character_list_result: data is nil or unexpected")
            end
        end)

        client:on("character_created", function(data)
            print("[charSelect] character_created received: " .. tostring(data ~= nil))
            if data and data.success then
                print("[charSelect]   Created character at index " .. tostring(data.characterIndex))
                if data.characterList then
                    characters = data.characterList.characters or {}
                    activeCharacterIndex = data.characterList.activeCharacterIndex or 0
                    maxCharacters = data.characterList.maxCharacters or 4
                end
                showNewCharDialog = false
                newCharName = ""
                newCharPermadeath = false
                -- Auto-switch to the new character and go to race select
                local newIdx = data.characterIndex
                if newIdx then
                    client:emit("character_switch", { index = newIdx })
                    statusMessage = "Switching..."
                    statusTimer = 3
                end
            elseif data and data.error then
                print("[charSelect]   character_create error: " .. tostring(data.error))
                errorMessage = data.error
                errorTimer = 4
                showNewCharDialog = false
            else
                print("[charSelect]   character_created: unexpected data format")
                errorMessage = "Unexpected server response"
                errorTimer = 4
            end
        end)

        client:on("character_deleted", function(data)
            if data and data.success then
                if data.characterList then
                    characters = data.characterList.characters or {}
                    activeCharacterIndex = data.characterList.activeCharacterIndex or 0
                    maxCharacters = data.characterList.maxCharacters or 4
                end
                showDeleteConfirm = false
                deletePinInput = ""
                selectedIndex = activeCharacterIndex
                statusMessage = "Character deleted"
                statusTimer = 3
            elseif data and data.error then
                errorMessage = data.error
                errorTimer = 4
                showDeleteConfirm = false
                deletePinInput = ""
            end
        end)

        client:on("name_lists", function(data)
            if data and data.prefixes and data.names then
                nameLists = { prefixes = data.prefixes, names = data.names }
                print("[charSelect] Received name lists: " .. #nameLists.prefixes .. " prefixes, " .. #nameLists.names .. " names")
            end
        end)

        client:on("character_renamed", function(data)
            if data and data.success then
                if data.characterList then
                    characters = data.characterList.characters or {}
                    activeCharacterIndex = data.characterList.activeCharacterIndex or 0
                    maxCharacters = data.characterList.maxCharacters or 4
                end
                -- Update identity name
                if data.newName and identity then
                    identity.name = data.newName
                    _G.identity = identity
                end
                showRenameDialog = false
                renameOpenDropdown = nil
                statusMessage = "Renamed to: " .. (data.newName or "?")
                statusTimer = 4
            elseif data and data.error then
                errorMessage = data.error
                errorTimer = 4
            end
        end)

        client:on("hall_of_heroes_result", function(data)
            if data and data.heroes then
                hallOfHeroesList = data.heroes
                showHallOfHeroes = true
            end
        end)

        client:off("identity")
        client:on("identity", function(data)
            print("[charSelect] identity event: isCharacterSwitch=" .. tostring(data and data.isCharacterSwitch))
            if data and data.isCharacterSwitch then
                -- Update global identity
                _G.identity = data
                identity = data
                if data.account and data.account.characterList then
                    characters = data.account.characterList.characters or {}
                    activeCharacterIndex = data.account.characterList.activeCharacterIndex or 0
                    maxCharacters = data.account.characterList.maxCharacters or 4
                end
                -- Check if the new character needs race selection
                if data.account and not data.account.race then
                    _G.switchScene("race_select")
                else
                    _G.switchScene("game")
                end
            end
        end)

        client:on("character_switch_result", function(data)
            if data and data.error then
                errorMessage = data.error
                errorTimer = 4
            end
        end)

        -- Request fresh character list
        local listSent = client:emit("character_list", {})
        print("[charSelect] Requested fresh character list, sent=" .. tostring(listSent))

        -- Request name lists for rename dialog (fetch once, cache locally)
        if not nameLists then
            client:emit("get_name_lists", {})
        end
    end
end

function charSelect.update(dt)
    fadeIn = math.min(1, fadeIn + dt * 2)

    if errorTimer > 0 then
        errorTimer = errorTimer - dt
        if errorTimer <= 0 then errorMessage = nil end
    end
    if statusTimer > 0 then
        statusTimer = statusTimer - dt
        if statusTimer <= 0 then statusMessage = nil end
    end
end

-- -----------------------------------------------------------------------
-- Drawing
-- -----------------------------------------------------------------------

function charSelect.draw()
    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()

    -- Dark background
    love.graphics.setColor(0.06, 0.07, 0.1, fadeIn)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.9, 0.8, 0.3, fadeIn)
    love.graphics.printf("Select Character", 0, 20, W, "center")

    -- Account name
    local username = (identity and identity.name) or "Player"
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.6, 0.6, 0.7, fadeIn * 0.7)
    love.graphics.printf("Account: " .. username, 0, 52, W, "center")

    -- Character cards
    local cardW = math.min(500, W - 60)
    local cardH = 70
    local gap = 8
    local startY = 80
    local startX = (W - cardW) / 2

    for i, char in ipairs(characters) do
        local idx = i - 1  -- 0-based index matching server
        local cy = startY + (i - 1) * (cardH + gap)
        local isSelected = (selectedIndex == idx)
        local isActive = (activeCharacterIndex == idx)

        local raceColor = RACE_COLORS[char.race] or {0.5, 0.5, 0.5}

        -- Card background
        if isSelected then
            love.graphics.setColor(raceColor[1] * 0.35, raceColor[2] * 0.35, raceColor[3] * 0.35, fadeIn * 0.9)
        else
            love.graphics.setColor(0.12, 0.13, 0.18, fadeIn * 0.8)
        end
        love.graphics.rectangle("fill", startX, cy, cardW, cardH, 6, 6)

        -- Card border
        if isSelected then
            love.graphics.setColor(raceColor[1], raceColor[2], raceColor[3], fadeIn * 0.9)
            love.graphics.setLineWidth(2)
        else
            love.graphics.setColor(0.3, 0.3, 0.35, fadeIn * 0.5)
            love.graphics.setLineWidth(1)
        end
        love.graphics.rectangle("line", startX, cy, cardW, cardH, 6, 6)
        love.graphics.setLineWidth(1)

        -- Active indicator
        if isActive then
            love.graphics.setColor(0.3, 0.9, 0.3, fadeIn * 0.8)
            love.graphics.circle("fill", startX + 16, cy + cardH / 2, 5)
        end

        -- Character name
        love.graphics.setFont(fonts.subtitle)
        love.graphics.setColor(raceColor[1], raceColor[2], raceColor[3], fadeIn)
        love.graphics.print(char.name or "Unnamed", startX + 30, cy + 8)

        -- Race + Level
        love.graphics.setFont(fonts.main)
        local raceName = char.race and (RACE_NAMES[char.race] or char.race) or "No Race"
        love.graphics.setColor(0.7, 0.7, 0.8, fadeIn * 0.9)
        love.graphics.print(raceName .. "  |  Level " .. (char.level or 1), startX + 30, cy + 32)

        -- Permadeath badge
        if char.permadeath then
            love.graphics.setFont(fonts.small)
            love.graphics.setColor(0.9, 0.2, 0.2, fadeIn)
            love.graphics.print("PERMADEATH", startX + cardW - 95, cy + 8)
        end

        -- Guild info
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.5, 0.5, 0.6, fadeIn * 0.7)
        local extra = ""
        if char.guildId then extra = extra .. "Guild: " .. char.guildId .. "  " end
        if char.hasPlot then extra = extra .. "[Plot]" end
        if #extra > 0 then
            love.graphics.print(extra, startX + 30, cy + 50)
        end

        -- Store bounds for hit-testing
        char._bounds = { x = startX, y = cy, w = cardW, h = cardH }
    end

    -- Buttons row (6 buttons: Play, New Char, Rename, Delete, Heroes, Back)
    local btnW = 90
    local btnH = 36
    local btnY = startY + #characters * (cardH + gap) + 20
    local btnGap = 6
    local totalBtnsW = btnW * 6 + btnGap * 5
    local btnStartX = (W - totalBtnsW) / 2

    -- Play button
    local canPlay = selectedIndex ~= nil and selectedIndex >= 0 and selectedIndex < #characters
    love.graphics.setFont(fonts.button)
    if canPlay then
        love.graphics.setColor(0.2, 0.6, 0.2, fadeIn * 0.9)
    else
        love.graphics.setColor(0.2, 0.3, 0.2, fadeIn * 0.5)
    end
    love.graphics.rectangle("fill", btnStartX, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 1, 1, canPlay and fadeIn or (fadeIn * 0.4))
    love.graphics.printf("Play", btnStartX, btnY + 9, btnW, "center")
    playBtn = { x = btnStartX, y = btnY, w = btnW, h = btnH }

    -- New Character button
    local canCreate = #characters < maxCharacters
    if canCreate then
        love.graphics.setColor(0.2, 0.4, 0.7, fadeIn * 0.9)
    else
        love.graphics.setColor(0.15, 0.2, 0.35, fadeIn * 0.5)
    end
    local bx2 = btnStartX + (btnW + btnGap)
    love.graphics.rectangle("fill", bx2, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 1, 1, canCreate and fadeIn or (fadeIn * 0.4))
    love.graphics.printf("New Char", bx2, btnY + 9, btnW, "center")
    newCharBtn = { x = bx2, y = btnY, w = btnW, h = btnH }

    -- Rename button
    local canRename = selectedIndex ~= nil and selectedIndex == activeCharacterIndex and #characters > 0
    if canRename then
        love.graphics.setColor(0.5, 0.4, 0.2, fadeIn * 0.9)
    else
        love.graphics.setColor(0.25, 0.2, 0.1, fadeIn * 0.5)
    end
    local bx3 = btnStartX + (btnW + btnGap) * 2
    love.graphics.rectangle("fill", bx3, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 1, 1, canRename and fadeIn or (fadeIn * 0.4))
    love.graphics.printf("Rename", bx3, btnY + 9, btnW, "center")
    renameBtn = { x = bx3, y = btnY, w = btnW, h = btnH }

    -- Delete button
    local canDelete = selectedIndex ~= nil and selectedIndex ~= activeCharacterIndex and #characters > 1
    if canDelete then
        love.graphics.setColor(0.6, 0.2, 0.2, fadeIn * 0.9)
    else
        love.graphics.setColor(0.3, 0.15, 0.15, fadeIn * 0.5)
    end
    local bx4 = btnStartX + (btnW + btnGap) * 3
    love.graphics.rectangle("fill", bx4, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 1, 1, canDelete and fadeIn or (fadeIn * 0.4))
    love.graphics.printf("Delete", bx4, btnY + 9, btnW, "center")
    deleteBtn = { x = bx4, y = btnY, w = btnW, h = btnH }

    -- Hall of Heroes button
    love.graphics.setColor(0.5, 0.3, 0.5, fadeIn * 0.9)
    local bx5 = btnStartX + (btnW + btnGap) * 4
    love.graphics.rectangle("fill", bx5, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 1, 1, fadeIn)
    love.graphics.printf("Heroes", bx5, btnY + 9, btnW, "center")
    hallBtn = { x = bx5, y = btnY, w = btnW, h = btnH }

    -- Back button
    love.graphics.setColor(0.4, 0.4, 0.4, fadeIn * 0.9)
    local bx6 = btnStartX + (btnW + btnGap) * 5
    love.graphics.rectangle("fill", bx6, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 1, 1, fadeIn)
    love.graphics.printf("Back", bx6, btnY + 9, btnW, "center")
    backBtn = { x = bx6, y = btnY, w = btnW, h = btnH }

    -- Slot count
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, fadeIn * 0.6)
    love.graphics.printf(#characters .. " / " .. maxCharacters .. " character slots", 0, btnY + btnH + 10, W, "center")

    -- Delete confirmation dialog
    if showDeleteConfirm then
        charSelect.drawDeleteDialog(W, H)
    end

    -- New character name dialog
    if showNewCharDialog then
        charSelect.drawNewCharDialog(W, H)
    end

    -- Rename dialog
    if showRenameDialog then
        charSelect.drawRenameDialog(W, H)
    end

    -- Hall of Heroes panel
    if showHallOfHeroes then
        charSelect.drawHallOfHeroes(W, H)
    end

    -- Status/error messages
    if statusMessage then
        love.graphics.setFont(fonts.button)
        love.graphics.setColor(0.3, 0.8, 0.3, fadeIn * math.min(1, statusTimer))
        love.graphics.printf(statusMessage, 0, H - 60, W, "center")
    end
    if errorMessage then
        love.graphics.setFont(fonts.button)
        love.graphics.setColor(1, 0.3, 0.3, fadeIn * math.min(1, errorTimer))
        love.graphics.printf(errorMessage, 0, H - 40, W, "center")
    end
end

function charSelect.drawDeleteDialog(W, H)
    local dlgW = 320
    local dlgH = 150
    local dlgX = (W - dlgW) / 2
    local dlgY = (H - dlgH) / 2

    -- Dim overlay
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Dialog bg
    love.graphics.setColor(0.1, 0.1, 0.15, 0.95)
    love.graphics.rectangle("fill", dlgX, dlgY, dlgW, dlgH, 8, 8)
    love.graphics.setColor(0.8, 0.3, 0.3, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", dlgX, dlgY, dlgW, dlgH, 8, 8)
    love.graphics.setLineWidth(1)

    -- Text
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Delete this character?", dlgX, dlgY + 12, dlgW, "center")

    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.7, 0.6, 0.5, 0.9)
    love.graphics.printf("This cannot be undone! Enter PIN to confirm.", dlgX, dlgY + 38, dlgW, "center")

    -- PIN input field
    local fieldW = 160
    local fieldH = 28
    local fieldX = dlgX + (dlgW - fieldW) / 2
    local fieldY = dlgY + 60
    love.graphics.setColor(0.15, 0.15, 0.2, 1)
    love.graphics.rectangle("fill", fieldX, fieldY, fieldW, fieldH, 4, 4)
    love.graphics.setColor(deletePinActive and {0.8, 0.6, 0.3} or {0.3, 0.3, 0.35})
    love.graphics.rectangle("line", fieldX, fieldY, fieldW, fieldH, 4, 4)
    love.graphics.setFont(fonts.main)
    love.graphics.setColor(1, 1, 1, 1)
    local displayPin = string.rep("*", #deletePinInput)
    love.graphics.print(displayPin, fieldX + 6, fieldY + 6)

    -- Buttons
    local btnW = 100
    local btnH = 30
    local btnY = dlgY + dlgH - btnH - 15
    local cfmX = dlgX + dlgW / 2 - btnW - 10
    local cnlX = dlgX + dlgW / 2 + 10

    love.graphics.setColor(0.6, 0.2, 0.2, 0.9)
    love.graphics.rectangle("fill", cfmX, btnY, btnW, btnH, 4, 4)
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Delete", cfmX, btnY + 6, btnW, "center")

    love.graphics.setColor(0.4, 0.4, 0.4, 0.9)
    love.graphics.rectangle("fill", cnlX, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Cancel", cnlX, btnY + 6, btnW, "center")

    deleteConfirmBtn = { x = cfmX, y = btnY, w = btnW, h = btnH }
    deleteCancelBtn = { x = cnlX, y = btnY, w = btnW, h = btnH }
end

function charSelect.drawNewCharDialog(W, H)
    local dlgW = 320
    local dlgH = 190
    local dlgX = (W - dlgW) / 2
    local dlgY = (H - dlgH) / 2

    -- Dim overlay
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Dialog bg
    love.graphics.setColor(0.1, 0.1, 0.15, 0.95)
    love.graphics.rectangle("fill", dlgX, dlgY, dlgW, dlgH, 8, 8)
    love.graphics.setColor(0.3, 0.5, 0.8, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", dlgX, dlgY, dlgW, dlgH, 8, 8)
    love.graphics.setLineWidth(1)

    -- Text
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("New Character", dlgX, dlgY + 12, dlgW, "center")

    -- Name input field
    local fieldW = 200
    local fieldH = 28
    local fieldX = dlgX + (dlgW - fieldW) / 2
    local fieldY = dlgY + 42
    love.graphics.setColor(0.15, 0.15, 0.2, 1)
    love.graphics.rectangle("fill", fieldX, fieldY, fieldW, fieldH, 4, 4)
    love.graphics.setColor(newCharNameActive and {0.3, 0.6, 0.9} or {0.3, 0.3, 0.35})
    love.graphics.rectangle("line", fieldX, fieldY, fieldW, fieldH, 4, 4)
    love.graphics.setFont(fonts.main)
    if #newCharName > 0 then
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.print(newCharName, fieldX + 6, fieldY + 6)
    else
        love.graphics.setColor(0.4, 0.4, 0.5, 0.7)
        love.graphics.print("Character name...", fieldX + 6, fieldY + 6)
    end

    -- Permadeath checkbox
    local cbX = fieldX
    local cbY = fieldY + fieldH + 10
    local cbSize = 16
    love.graphics.setColor(0.15, 0.15, 0.2, 1)
    love.graphics.rectangle("fill", cbX, cbY, cbSize, cbSize, 2, 2)
    if newCharPermadeath then
        love.graphics.setColor(0.9, 0.2, 0.2, 1)
    else
        love.graphics.setColor(0.3, 0.3, 0.35, 1)
    end
    love.graphics.rectangle("line", cbX, cbY, cbSize, cbSize, 2, 2)
    if newCharPermadeath then
        love.graphics.setColor(0.9, 0.2, 0.2, 1)
        love.graphics.setFont(fonts.main)
        love.graphics.print("X", cbX + 3, cbY + 1)
    end
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.9, 0.3, 0.3, 1)
    love.graphics.print("Permadeath (death anywhere is permanent)", cbX + cbSize + 6, cbY + 2)
    newCharPermadeathBtn = { x = cbX, y = cbY, w = cbSize + 200, h = cbSize }

    -- Buttons
    local btnW = 100
    local btnH = 30
    local btnY = dlgY + dlgH - btnH - 15
    local cfmX = dlgX + dlgW / 2 - btnW - 10
    local cnlX = dlgX + dlgW / 2 + 10

    love.graphics.setColor(0.2, 0.5, 0.7, 0.9)
    love.graphics.rectangle("fill", cfmX, btnY, btnW, btnH, 4, 4)
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Create", cfmX, btnY + 6, btnW, "center")

    love.graphics.setColor(0.4, 0.4, 0.4, 0.9)
    love.graphics.rectangle("fill", cnlX, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Cancel", cnlX, btnY + 6, btnW, "center")

    newCharConfirmBtn = { x = cfmX, y = btnY, w = btnW, h = btnH }
    newCharCancelBtn = { x = cnlX, y = btnY, w = btnW, h = btnH }
end

function charSelect.drawHallOfHeroes(W, H)
    local dlgW = 500
    local dlgH = 400
    local dlgX = (W - dlgW) / 2
    local dlgY = (H - dlgH) / 2

    -- Dim overlay
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel bg
    love.graphics.setColor(0.08, 0.06, 0.12, 0.95)
    love.graphics.rectangle("fill", dlgX, dlgY, dlgW, dlgH, 8, 8)
    love.graphics.setColor(0.6, 0.3, 0.6, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", dlgX, dlgY, dlgW, dlgH, 8, 8)
    love.graphics.setLineWidth(1)

    -- Title
    love.graphics.setFont(fonts.subtitle)
    love.graphics.setColor(0.9, 0.7, 0.3, 1)
    love.graphics.printf("Hall of Heroes", dlgX, dlgY + 12, dlgW, "center")

    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.6, 0.5, 0.7, 0.8)
    love.graphics.printf("Fallen permadeath characters memorialized here", dlgX, dlgY + 36, dlgW, "center")

    if #hallOfHeroesList == 0 then
        love.graphics.setFont(fonts.main)
        love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
        love.graphics.printf("No fallen heroes yet.", dlgX, dlgY + 100, dlgW, "center")
    else
        local entryH = 60
        local listY = dlgY + 55
        local maxVisible = math.floor((dlgH - 70) / entryH)
        for i = 1, math.min(#hallOfHeroesList, maxVisible) do
            local hero = hallOfHeroesList[#hallOfHeroesList - i + 1] -- newest first
            local ey = listY + (i - 1) * entryH

            -- Entry bg
            love.graphics.setColor(0.12, 0.1, 0.16, 0.8)
            love.graphics.rectangle("fill", dlgX + 10, ey, dlgW - 20, entryH - 4, 4, 4)

            -- Name + level
            love.graphics.setFont(fonts.button)
            love.graphics.setColor(0.9, 0.8, 0.6, 1)
            local heroName = (hero.name or "Unknown") .. "  Lv." .. (hero.level or 1)
            love.graphics.print(heroName, dlgX + 20, ey + 4)

            -- Race + cause of death
            love.graphics.setFont(fonts.small)
            love.graphics.setColor(0.7, 0.6, 0.8, 0.9)
            local raceName = hero.race or "Unknown"
            love.graphics.print(raceName, dlgX + 20, ey + 22)

            love.graphics.setColor(0.8, 0.3, 0.3, 0.9)
            love.graphics.print(hero.causeOfDeath or "Unknown cause", dlgX + 120, ey + 22)

            -- Floor info
            love.graphics.setColor(0.5, 0.5, 0.6, 0.7)
            local floorInfo = ""
            if hero.dungeonId then floorInfo = hero.dungeonId end
            if hero.floorNum then floorInfo = floorInfo .. " F" .. hero.floorNum end
            love.graphics.print(floorInfo, dlgX + 20, ey + 38)

            -- Stats
            local dp = hero.dungeonProgress or {}
            love.graphics.setColor(0.5, 0.6, 0.5, 0.7)
            love.graphics.print("Kills: " .. (dp.totalKills or 0) .. "  Bosses: " .. (dp.bossesKilled or 0), dlgX + 200, ey + 38)
        end
    end

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.5, 0.6)
    love.graphics.printf("Click anywhere or press ESC to close", dlgX, dlgY + dlgH - 20, dlgW, "center")
end

function charSelect.drawRenameDialog(W, H)
    if not nameLists then return end

    local dlgW = 440
    local dlgH = 210
    local dlgX = (W - dlgW) / 2
    local dlgY = (H - dlgH) / 2

    -- Dim overlay
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Dialog bg
    love.graphics.setColor(0.1, 0.1, 0.15, 0.95)
    love.graphics.rectangle("fill", dlgX, dlgY, dlgW, dlgH, 8, 8)
    love.graphics.setColor(0.6, 0.5, 0.2, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", dlgX, dlgY, dlgW, dlgH, 8, 8)
    love.graphics.setLineWidth(1)

    -- Title
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Rename Character", dlgX, dlgY + 12, dlgW, "center")

    -- Labels
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.7, 0.7, 0.8, 0.9)
    local col1X = dlgX + 20
    local col2X = dlgX + 160
    local col3X = dlgX + 330
    local labelY = dlgY + 40
    love.graphics.print("Prefix", col1X, labelY)
    love.graphics.print("Name", col2X, labelY)
    love.graphics.print("Number", col3X, labelY)

    -- Dropdown fields
    local fieldH = 26
    local fieldY = labelY + 16
    local field1W = 120
    local field2W = 150
    local field3W = 70

    -- Helper to draw a dropdown field
    local function drawDropdownField(fx, fy, fw, fh, text, isOpen, fieldId)
        love.graphics.setColor(0.15, 0.15, 0.2, 1)
        love.graphics.rectangle("fill", fx, fy, fw, fh, 3, 3)
        love.graphics.setColor(isOpen and {0.8, 0.7, 0.3} or {0.4, 0.4, 0.5})
        love.graphics.rectangle("line", fx, fy, fw, fh, 3, 3)
        love.graphics.setFont(fonts.main)
        love.graphics.setColor(1, 1, 1, 1)
        -- Truncate text to fit
        local maxChars = math.floor((fw - 20) / 7)
        local display = text
        if #display > maxChars then display = display:sub(1, maxChars) .. ".." end
        love.graphics.print(display, fx + 6, fy + 5)
        -- Down arrow
        love.graphics.setColor(0.6, 0.6, 0.7, 0.9)
        local ax = fx + fw - 14
        local ay = fy + fh / 2
        love.graphics.polygon("fill", ax, ay - 3, ax + 6, ay - 3, ax + 3, ay + 3)
    end

    local prefixText = nameLists.prefixes[renamePrefixIdx] or "?"
    local nameText = nameLists.names[renameNameIdx] or "?"
    local numberText = tostring(renameNumber)

    drawDropdownField(col1X, fieldY, field1W, fieldH, prefixText, renameOpenDropdown == "prefix")
    drawDropdownField(col2X, fieldY, field2W, fieldH, nameText, renameOpenDropdown == "name")
    drawDropdownField(col3X, fieldY, field3W, fieldH, numberText, renameOpenDropdown == "number")

    renamePrefixField = { x = col1X, y = fieldY, w = field1W, h = fieldH }
    renameNameField = { x = col2X, y = fieldY, w = field2W, h = fieldH }
    renameNumberField = { x = col3X, y = fieldY, w = field3W, h = fieldH }

    -- Preview
    local preview = prefixText .. " " .. nameText .. " " .. numberText
    if #preview > 20 then preview = preview:sub(1, 20) end
    love.graphics.setFont(fonts.subtitle)
    love.graphics.setColor(0.9, 0.8, 0.3, 1)
    love.graphics.printf(preview, dlgX, fieldY + fieldH + 14, dlgW, "center")

    -- Buttons: Random, Confirm, Cancel
    local btnW = 90
    local btnH = 30
    local btnY = dlgY + dlgH - btnH - 15
    local totalW = btnW * 3 + 10 * 2
    local startBtnX = dlgX + (dlgW - totalW) / 2

    -- Random button
    love.graphics.setColor(0.3, 0.3, 0.5, 0.9)
    love.graphics.rectangle("fill", startBtnX, btnY, btnW, btnH, 4, 4)
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Random", startBtnX, btnY + 6, btnW, "center")
    renameRandomBtn = { x = startBtnX, y = btnY, w = btnW, h = btnH }

    -- Confirm button
    love.graphics.setColor(0.5, 0.4, 0.15, 0.9)
    local cfmX = startBtnX + btnW + 10
    love.graphics.rectangle("fill", cfmX, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Rename", cfmX, btnY + 6, btnW, "center")
    renameConfirmBtn = { x = cfmX, y = btnY, w = btnW, h = btnH }

    -- Cancel button
    love.graphics.setColor(0.4, 0.4, 0.4, 0.9)
    local cnlX = cfmX + btnW + 10
    love.graphics.rectangle("fill", cnlX, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Cancel", cnlX, btnY + 6, btnW, "center")
    renameCancelBtn = { x = cnlX, y = btnY, w = btnW, h = btnH }

    -- Draw open dropdown list (on top of everything)
    if renameOpenDropdown then
        local items, selIdx, ddX, ddW
        if renameOpenDropdown == "prefix" then
            items = nameLists.prefixes
            selIdx = renamePrefixIdx
            ddX = col1X
            ddW = field1W
        elseif renameOpenDropdown == "name" then
            items = nameLists.names
            selIdx = renameNameIdx
            ddX = col2X
            ddW = field2W
        elseif renameOpenDropdown == "number" then
            items = {}
            for n = 1, 99 do items[n] = tostring(n) end
            selIdx = renameNumber
            ddX = col3X
            ddW = field3W
        end

        if items and #items > 0 then
            local visCount = math.min(#items, DROPDOWN_VISIBLE_ITEMS)
            local ddH = visCount * DROPDOWN_ITEM_H
            local ddY = fieldY + fieldH + 2

            -- Clamp scroll
            local maxScroll = math.max(0, #items - DROPDOWN_VISIBLE_ITEMS)
            if renameDropdownScroll > maxScroll then renameDropdownScroll = maxScroll end
            if renameDropdownScroll < 0 then renameDropdownScroll = 0 end

            -- Background
            love.graphics.setColor(0.08, 0.08, 0.12, 0.97)
            love.graphics.rectangle("fill", ddX, ddY, ddW, ddH, 3, 3)
            love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
            love.graphics.rectangle("line", ddX, ddY, ddW, ddH, 3, 3)

            -- Items
            love.graphics.setFont(fonts.small)
            -- Set scissor to clip items within dropdown bounds
            love.graphics.setScissor(ddX, ddY, ddW, ddH)
            for vi = 1, visCount do
                local itemIdx = vi + renameDropdownScroll
                if itemIdx <= #items then
                    local iy = ddY + (vi - 1) * DROPDOWN_ITEM_H
                    -- Highlight selected
                    if itemIdx == selIdx then
                        love.graphics.setColor(0.3, 0.3, 0.15, 0.8)
                        love.graphics.rectangle("fill", ddX + 1, iy, ddW - 2, DROPDOWN_ITEM_H)
                    end
                    love.graphics.setColor(1, 1, 1, itemIdx == selIdx and 1 or 0.8)
                    local itemText = items[itemIdx]
                    love.graphics.print(itemText, ddX + 6, iy + 4)
                end
            end
            love.graphics.setScissor()

            -- Scrollbar indicator if list is longer than visible
            if #items > DROPDOWN_VISIBLE_ITEMS then
                local sbH = ddH * (DROPDOWN_VISIBLE_ITEMS / #items)
                local sbY = ddY + (renameDropdownScroll / maxScroll) * (ddH - sbH)
                love.graphics.setColor(0.5, 0.5, 0.6, 0.5)
                love.graphics.rectangle("fill", ddX + ddW - 5, sbY, 4, sbH, 2, 2)
            end

            renameDropdownBounds = { x = ddX, y = ddY, w = ddW, h = ddH, items = items, visCount = visCount }
        end
    else
        renameDropdownBounds = nil
    end
end

-- -----------------------------------------------------------------------
-- Input handlers
-- -----------------------------------------------------------------------

function charSelect.keypressed(key)
    if showDeleteConfirm then
        if key == "escape" then
            showDeleteConfirm = false
            deletePinInput = ""
        elseif key == "backspace" then
            deletePinInput = deletePinInput:sub(1, -2)
        elseif key == "return" or key == "kpenter" then
            charSelect.confirmDelete()
        end
        return
    end

    if showHallOfHeroes then
        if key == "escape" then
            showHallOfHeroes = false
        end
        return
    end

    if showNewCharDialog then
        if key == "escape" then
            showNewCharDialog = false
            newCharName = ""
            newCharPermadeath = false
        elseif key == "backspace" then
            newCharName = newCharName:sub(1, -2)
        elseif key == "return" or key == "kpenter" then
            charSelect.confirmNewChar()
        end
        return
    end

    if showRenameDialog then
        if key == "escape" then
            if renameOpenDropdown then
                renameOpenDropdown = nil
            else
                showRenameDialog = false
            end
        elseif key == "return" or key == "kpenter" then
            if not renameOpenDropdown then
                charSelect.confirmRename()
            else
                renameOpenDropdown = nil
            end
        end
        return
    end

    if key == "escape" then
        if client then client:disconnect() end
        _G.switchScene("shards")
    elseif key == "return" or key == "kpenter" then
        charSelect.playSelected()
    elseif key == "up" then
        if selectedIndex and selectedIndex > 0 then
            selectedIndex = selectedIndex - 1
        end
    elseif key == "down" then
        if selectedIndex and selectedIndex < #characters - 1 then
            selectedIndex = selectedIndex + 1
        end
    end
end

function charSelect.textinput(text)
    if showDeleteConfirm then
        if #deletePinInput < 8 then
            deletePinInput = deletePinInput .. text
        end
        return
    end
    if showNewCharDialog then
        if #newCharName < 20 then
            newCharName = newCharName .. text
        end
        return
    end
end

function charSelect.mousepressed(x, y, button)
    if button ~= 1 then return end
    audio.playClick()

    if showDeleteConfirm then
        if pointInRect(x, y, deleteConfirmBtn) then
            charSelect.confirmDelete()
        elseif pointInRect(x, y, deleteCancelBtn) then
            showDeleteConfirm = false
            deletePinInput = ""
        end
        return
    end

    if showHallOfHeroes then
        showHallOfHeroes = false
        return
    end

    if showNewCharDialog then
        if pointInRect(x, y, newCharConfirmBtn) then
            charSelect.confirmNewChar()
        elseif pointInRect(x, y, newCharCancelBtn) then
            showNewCharDialog = false
            newCharName = ""
            newCharPermadeath = false
        elseif newCharPermadeathBtn and pointInRect(x, y, newCharPermadeathBtn) then
            newCharPermadeath = not newCharPermadeath
        end
        return
    end

    if showRenameDialog then
        -- Check dropdown list clicks first (if a dropdown is open)
        if renameOpenDropdown and renameDropdownBounds and pointInRect(x, y, renameDropdownBounds) then
            local relY = y - renameDropdownBounds.y
            local clickedVis = math.floor(relY / DROPDOWN_ITEM_H) + 1
            local clickedIdx = clickedVis + renameDropdownScroll
            if clickedIdx >= 1 and clickedIdx <= #renameDropdownBounds.items then
                if renameOpenDropdown == "prefix" then
                    renamePrefixIdx = clickedIdx
                elseif renameOpenDropdown == "name" then
                    renameNameIdx = clickedIdx
                elseif renameOpenDropdown == "number" then
                    renameNumber = clickedIdx
                end
            end
            renameOpenDropdown = nil
            renameDropdownScroll = 0
            return
        end

        -- Check dropdown field clicks (toggle open/close)
        if pointInRect(x, y, renamePrefixField) then
            if renameOpenDropdown == "prefix" then
                renameOpenDropdown = nil
            else
                renameOpenDropdown = "prefix"
                renameDropdownScroll = math.max(0, renamePrefixIdx - 4)
            end
            return
        elseif pointInRect(x, y, renameNameField) then
            if renameOpenDropdown == "name" then
                renameOpenDropdown = nil
            else
                renameOpenDropdown = "name"
                renameDropdownScroll = math.max(0, renameNameIdx - 4)
            end
            return
        elseif pointInRect(x, y, renameNumberField) then
            if renameOpenDropdown == "number" then
                renameOpenDropdown = nil
            else
                renameOpenDropdown = "number"
                renameDropdownScroll = math.max(0, renameNumber - 4)
            end
            return
        end

        -- Close any open dropdown when clicking elsewhere in dialog
        if renameOpenDropdown then
            renameOpenDropdown = nil
            renameDropdownScroll = 0
        end

        -- Button clicks
        if pointInRect(x, y, renameRandomBtn) then
            charSelect.randomizeName()
            return
        elseif pointInRect(x, y, renameConfirmBtn) then
            charSelect.confirmRename()
            return
        elseif pointInRect(x, y, renameCancelBtn) then
            showRenameDialog = false
            renameOpenDropdown = nil
            return
        end
        return
    end

    -- Character card clicks
    for i, char in ipairs(characters) do
        if pointInRect(x, y, char._bounds) then
            selectedIndex = i - 1  -- 0-based
            return
        end
    end

    -- Button clicks
    if pointInRect(x, y, playBtn) then
        charSelect.playSelected()
    elseif pointInRect(x, y, newCharBtn) then
        if #characters < maxCharacters then
            showNewCharDialog = true
            newCharName = ""
            newCharNameActive = true
        end
    elseif pointInRect(x, y, renameBtn) then
        if selectedIndex and selectedIndex == activeCharacterIndex and #characters > 0 then
            charSelect.openRenameDialog()
        end
    elseif pointInRect(x, y, deleteBtn) then
        if selectedIndex and selectedIndex ~= activeCharacterIndex and #characters > 1 then
            deleteTargetIndex = selectedIndex
            showDeleteConfirm = true
            deletePinInput = ""
            deletePinActive = true
        end
    elseif hallBtn and pointInRect(x, y, hallBtn) then
        if client then
            client:emit("hall_of_heroes", {})
        end
    elseif pointInRect(x, y, backBtn) then
        if client then client:disconnect() end
        _G.switchScene("shards")
    end
end

function charSelect.wheelmoved(x, y)
    if showRenameDialog and renameOpenDropdown then
        renameDropdownScroll = renameDropdownScroll - y
        -- Clamp will happen during draw
        return
    end
end

function charSelect.mousemoved(x, y)
    -- Could add hover effects here
end

-- -----------------------------------------------------------------------
-- Actions
-- -----------------------------------------------------------------------

function charSelect.playSelected()
    print("[charSelect] playSelected: selectedIndex=" .. tostring(selectedIndex) .. ", #characters=" .. #characters)
    if not selectedIndex or selectedIndex < 0 or selectedIndex >= #characters then return end
    if not client then return end

    -- If this is already the active character, just go to game or race_select
    if selectedIndex == activeCharacterIndex then
        local acct = identity and identity.account
        if acct and not acct.race then
            _G.switchScene("race_select")
        else
            _G.switchScene("game")
        end
        return
    end

    -- Switch to selected character (server will emit identity with isCharacterSwitch)
    client:emit("character_switch", { index = selectedIndex })
    statusMessage = "Switching character..."
    statusTimer = 5
end

function charSelect.confirmDelete()
    if not deleteTargetIndex or not client then return end
    client:emit("character_delete", {
        index = deleteTargetIndex,
        pin = deletePinInput,
    })
end

function charSelect.confirmNewChar()
    if not client then
        errorMessage = "Not connected"
        errorTimer = 3
        return
    end
    local name = newCharName
    if #name == 0 then name = "New Character" end
    print("[charSelect] confirmNewChar: sending character_create with name=" .. name)
    print("[charSelect]   client.connected=" .. tostring(client.connected))
    local sent = client:emit("character_create", { name = name, permadeath = newCharPermadeath })
    if sent then
        statusMessage = "Creating character..."
        statusTimer = 5
    else
        print("[charSelect]   emit returned false (not connected?)")
        errorMessage = "Connection lost - reconnect"
        errorTimer = 4
        showNewCharDialog = false
    end
end

function charSelect.openRenameDialog()
    if not nameLists then
        -- Request name lists if we don't have them yet
        if client then
            client:emit("get_name_lists", {})
        end
        errorMessage = "Loading name lists..."
        errorTimer = 2
        return
    end

    -- Try to parse current name to pre-select dropdowns
    local currentName = (identity and identity.name) or ""
    local foundPrefix, foundName, foundNumber = false, false, false

    -- Try to match prefix
    for i, p in ipairs(nameLists.prefixes) do
        if currentName:sub(1, #p) == p then
            renamePrefixIdx = i
            foundPrefix = true
            -- Try to match the rest
            local rest = currentName:sub(#p + 2)  -- skip the space
            for j, n in ipairs(nameLists.names) do
                if rest:sub(1, #n) == n then
                    renameNameIdx = j
                    foundName = true
                    local numStr = rest:sub(#n + 2)  -- skip the space
                    local num = tonumber(numStr)
                    if num and num >= 1 and num <= 99 then
                        renameNumber = num
                        foundNumber = true
                    end
                    break
                end
            end
            break
        end
    end

    -- Default to random if current name doesn't match pattern
    if not foundPrefix then renamePrefixIdx = math.random(1, #nameLists.prefixes) end
    if not foundName then renameNameIdx = math.random(1, #nameLists.names) end
    if not foundNumber then renameNumber = math.random(1, 99) end

    showRenameDialog = true
    renameOpenDropdown = nil
    renameDropdownScroll = 0
end

function charSelect.randomizeName()
    if not nameLists then return end
    renamePrefixIdx = math.random(1, #nameLists.prefixes)
    renameNameIdx = math.random(1, #nameLists.names)
    renameNumber = math.random(1, 99)
    renameOpenDropdown = nil
end

function charSelect.confirmRename()
    if not client or not nameLists then return end

    local prefix = nameLists.prefixes[renamePrefixIdx]
    local name = nameLists.names[renameNameIdx]
    if not prefix or not name then
        errorMessage = "Invalid selection"
        errorTimer = 3
        return
    end

    client:emit("character_rename", {
        prefix = prefix,
        name = name,
        number = renameNumber,
    })
    statusMessage = "Renaming..."
    statusTimer = 3
end

-- Resize: recreate fonts without re-running load() (which would re-register listeners)
function charSelect.resize(w, h)
    fonts.title = love.graphics.newFont(28)
    fonts.subtitle = love.graphics.newFont(18)
    fonts.main = love.graphics.newFont(14)
    fonts.small = love.graphics.newFont(12)
    fonts.button = love.graphics.newFont(16)
end

function charSelect.unload()
    local c = _G.gameClient
    if c then
        c:off("character_list_result")
        c:off("character_created")
        c:off("character_deleted")
        c:off("character_switch_result")
        c:off("name_lists")
        c:off("character_renamed")
        c:off("hall_of_heroes_result")
        c:off("identity")
    end
end

return charSelect
