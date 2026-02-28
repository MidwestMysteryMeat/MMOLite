-- scenes/race_select.lua
-- Race selection screen shown for new characters (account.race == nil).
-- Displays 8 races in a 2-column grid with stats, racial feats, and a
-- confirmation dialog before committing the permanent choice.

local net = require("lib.net")

local raceSelect = {}

local fonts = {}
local client = nil
local identity = nil
local fadeIn = 0

-- Race data (mirrored from server rpg-data.js)
local RACES = {
    { id = "human", name = "Human", lifespan = "70-90",
      bumps = "+1 Presence, +1 Resolve",
      feat = "Dominion Authority", featDesc = "+15% XP, +20% market, coercion/deception, -25% property cost, +15% poison weakness",
      langs = "Common", vision = "Normal",
      color = {0.9, 0.85, 0.7} },
    { id = "elf", name = "Elf", lifespan = "500-800",
      bumps = "+2 Acumen, +1 Finesse, -2 Vigor, -1 Might",
      feat = "Millennial Memory", featDesc = "+50% magic XP, +30% magic unlocks, -15% melee, -10% HP (frail), +25% poison weakness",
      langs = "Elvish, Common", vision = "Normal",
      color = {0.5, 0.9, 0.7} },
    { id = "orc", name = "Orc", lifespan = "300-500",
      bumps = "+2 Might, +1 Vigor, -1 Acumen",
      feat = "Khanate Vitality", featDesc = "+25% melee/archery, +10% mount speed, +25% HP, +2 HP regen/s",
      langs = "Orcish, Common", vision = "Normal",
      color = {0.6, 0.8, 0.4} },
    { id = "dwarf", name = "Dwarf", lifespan = "300-500",
      bumps = "+2 Vigor, +1 Ingenuity, -1 Finesse",
      feat = "Stone-Born Artisan", featDesc = "+25% mining/crafting, +15% jewel, Stone Skin, darkvision, tremor sense, 30% poison resist",
      langs = "Dwarvish, Common", vision = "Darkvision + Tremor Sense",
      color = {0.8, 0.6, 0.4} },
    { id = "gnome", name = "Gnome", lifespan = "200-350",
      bumps = "+2 Ingenuity, +1 Acumen, -1 Might",
      feat = "Tinker Savant", featDesc = "+50% cogworking XP, +25% engineering, automaton crafting, 20% poison resist",
      langs = "Gnomish, Common", vision = "Normal",
      color = {0.7, 0.7, 0.9} },
    { id = "goblin", name = "Goblin", lifespan = "30-60",
      bumps = "+2 Finesse, +1 Resolve, -1 Might",
      feat = "Guerrilla Instinct", featDesc = "+30% stealth, +20% stealth attack/lockpicking/thievery/archery, +30% speed, knives",
      langs = "Goblin, Common", vision = "Darkvision",
      color = {0.4, 0.7, 0.3} },
    { id = "lizardfolk", name = "Lizard Folk", lifespan = "600-800",
      bumps = "+1 Acumen, +1 Resolve, +1 Finesse, -1 Presence",
      feat = "Aquatic Heritage", featDesc = "Swim/dive freely, water breathing, +30% fishing, thermal vision, poison immune",
      langs = "Draconic, Common", vision = "Thermal",
      color = {0.3, 0.7, 0.7} },
    { id = "catfolk", name = "Cat Folk", lifespan = "60-80",
      bumps = "+2 Finesse, +1 Presence, -1 Vigor",
      feat = "Pattern Recognition", featDesc = "+20% card luck, +15% general luck, unarmed, +15% stealth/lockpick",
      langs = "Catfolk, Common", vision = "Darkvision",
      color = {0.9, 0.7, 0.5} },
}

local hoverIndex = nil
local selectedRace = nil  -- index into RACES when confirmation dialog is showing
local errorMessage = nil
local errorTimer = 0

-- Button bounds stored each frame for hit-testing (avoids duplicating layout math)
local confirmBtn = nil  -- { x, y, w, h }
local cancelBtn = nil   -- { x, y, w, h }

function raceSelect.load()
    fonts.title = love.graphics.newFont(28)
    fonts.subtitle = love.graphics.newFont(18)
    fonts.main = love.graphics.newFont(14)
    fonts.small = love.graphics.newFont(12)
    fonts.button = love.graphics.newFont(16)

    fadeIn = 0
    hoverIndex = nil
    selectedRace = nil
    errorMessage = nil
    errorTimer = 0
    confirmBtn = nil
    cancelBtn = nil

    client = _G.gameClient
    identity = _G.identity

    -- Guard: if the character already has a race, skip straight to game
    if identity and identity.account and identity.account.race then
        print("[raceSelect] Character already has race: " .. tostring(identity.account.race) .. " — skipping to game")
        _G.switchScene("game")
        return
    end

    if client then
        -- Clean up any stale listeners from a previous load before re-registering
        pcall(function() client:off("race_selected") end)
        pcall(function() client:off("race_select_error") end)
        client:on("race_selected", function(data)
            -- Race chosen successfully -- update local identity and transition
            if identity and identity.account then
                identity.account.race = data.race
                if data.rpgStats then
                    identity.account.rpgStats = data.rpgStats
                end
            end
            _G.switchScene("game")
        end)

        client:on("race_select_error", function(data)
            errorMessage = (data and data.message) or "Selection failed"
            errorTimer = 4
            selectedRace = nil
        end)
    end
end

function raceSelect.update(dt)
    fadeIn = math.min(1, fadeIn + dt * 2)

    if errorTimer > 0 then
        errorTimer = errorTimer - dt
        if errorTimer <= 0 then
            errorMessage = nil
        end
    end
end

-- -----------------------------------------------------------------------
-- Drawing
-- -----------------------------------------------------------------------

function raceSelect.draw()
    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()

    -- Dark background
    love.graphics.setColor(0.06, 0.07, 0.1, fadeIn)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.9, 0.8, 0.3, fadeIn)
    love.graphics.printf("Choose Your Race", 0, 30, W, "center")

    -- Subtitle warning
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.6, 0.6, 0.7, fadeIn * 0.7)
    love.graphics.printf("Race is permanent for this character.", 0, 65, W, "center")

    -- Race cards: 2 columns, 4 rows
    local cardW = math.min(420, (W - 60) / 2)
    local cardH = 148
    local gap = 8
    local startX = (W - cardW * 2 - gap) / 2
    local startY = 85
    local pad = 8 -- inner padding
    local textW = cardW - pad * 2 -- available text width

    for i, race in ipairs(RACES) do
        local col = (i - 1) % 2
        local row = math.floor((i - 1) / 2)
        local cx = startX + col * (cardW + gap)
        local cy = startY + row * (cardH + gap)

        local isHover = (hoverIndex == i)
        local isSelected = (selectedRace == i)

        -- Card background
        if isSelected then
            love.graphics.setColor(race.color[1] * 0.4, race.color[2] * 0.4, race.color[3] * 0.4, fadeIn * 0.9)
        elseif isHover then
            love.graphics.setColor(race.color[1] * 0.25, race.color[2] * 0.25, race.color[3] * 0.25, fadeIn * 0.8)
        else
            love.graphics.setColor(0.12, 0.13, 0.18, fadeIn * 0.8)
        end
        love.graphics.rectangle("fill", cx, cy, cardW, cardH, 6, 6)

        -- Card border
        if isHover or isSelected then
            love.graphics.setColor(race.color[1], race.color[2], race.color[3], fadeIn * 0.8)
        else
            love.graphics.setColor(0.3, 0.3, 0.35, fadeIn * 0.5)
        end
        love.graphics.setLineWidth(isSelected and 2 or 1)
        love.graphics.rectangle("line", cx, cy, cardW, cardH, 6, 6)

        -- Clip drawing to card bounds so nothing overflows
        love.graphics.setScissor(cx + 1, cy + 1, cardW - 2, cardH - 2)

        -- Race name + lifespan on same line
        love.graphics.setFont(fonts.subtitle)
        love.graphics.setColor(race.color[1], race.color[2], race.color[3], fadeIn)
        love.graphics.print(race.name, cx + pad, cy + 4)
        local nameW = fonts.subtitle:getWidth(race.name)
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.5, 0.5, 0.6, fadeIn * 0.7)
        love.graphics.print("  " .. race.lifespan .. " yrs", cx + pad + nameW, cy + 10)

        -- Stat bumps (wrapping)
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.7, 0.8, 0.9, fadeIn * 0.9)
        love.graphics.printf(race.bumps, cx + pad, cy + 28, textW, "left")

        -- Racial feat name in gold
        love.graphics.setColor(1, 0.85, 0.3, fadeIn * 0.9)
        love.graphics.printf(race.feat, cx + pad, cy + 44, textW, "left")

        -- Feat description (wrapping, muted color)
        love.graphics.setColor(0.8, 0.8, 0.7, fadeIn * 0.8)
        love.graphics.printf(race.featDesc, cx + pad, cy + 58, textW, "left")

        -- Languages (learnable note)
        love.graphics.setColor(0.5, 0.6, 0.8, fadeIn * 0.8)
        love.graphics.printf("Lang: " .. race.langs .. "  |  Vision: " .. race.vision, cx + pad, cy + 86, textW, "left")

        -- Languages can be learned note
        if race.id ~= "human" then
            love.graphics.setColor(0.4, 0.5, 0.6, fadeIn * 0.5)
            love.graphics.printf("(Other languages learnable over time)", cx + pad, cy + 100, textW, "left")
        else
            love.graphics.setColor(0.4, 0.5, 0.6, fadeIn * 0.5)
            love.graphics.printf("(Can learn other race languages over time)", cx + pad, cy + 100, textW, "left")
        end

        -- Remove scissor clip
        love.graphics.setScissor()

        -- Cache bounds for hover/click detection
        race._bounds = { x = cx, y = cy, w = cardW, h = cardH }
    end

    -- Reset line width after cards
    love.graphics.setLineWidth(1)

    -- Confirmation dialog overlay
    if selectedRace then
        raceSelect.drawConfirmDialog(W, H)
    end

    -- Error message banner at the bottom
    if errorMessage then
        love.graphics.setFont(fonts.button)
        local alpha = fadeIn * math.min(1, errorTimer)
        love.graphics.setColor(1, 0.3, 0.3, alpha)
        love.graphics.printf(errorMessage, 0, H - 50, W, "center")
    end
end

function raceSelect.drawConfirmDialog(W, H)
    local race = RACES[selectedRace]
    if not race then return end

    local dlgW = 320
    local dlgH = 120
    local dlgX = (W - dlgW) / 2
    local dlgY = (H - dlgH) / 2

    -- Dim overlay behind dialog
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Dialog background
    love.graphics.setColor(0.1, 0.1, 0.15, 0.95)
    love.graphics.rectangle("fill", dlgX, dlgY, dlgW, dlgH, 8, 8)

    -- Dialog border (race color)
    love.graphics.setColor(race.color[1], race.color[2], race.color[3], 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", dlgX, dlgY, dlgW, dlgH, 8, 8)
    love.graphics.setLineWidth(1)

    -- Prompt text
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Play as " .. race.name .. "?", dlgX, dlgY + 15, dlgW, "center")

    -- Warning
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.7, 0.6, 0.5, 0.9)
    love.graphics.printf("This choice is permanent!", dlgX, dlgY + 42, dlgW, "center")

    -- Button geometry
    local btnW = 100
    local btnH = 30
    local btnY = dlgY + dlgH - btnH - 15
    local cfmX = dlgX + dlgW / 2 - btnW - 10
    local cnlX = dlgX + dlgW / 2 + 10

    -- Confirm button
    love.graphics.setColor(0.2, 0.6, 0.2, 0.9)
    love.graphics.rectangle("fill", cfmX, btnY, btnW, btnH, 4, 4)
    love.graphics.setFont(fonts.button)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Confirm", cfmX, btnY + 6, btnW, "center")

    -- Cancel button
    love.graphics.setColor(0.6, 0.2, 0.2, 0.9)
    love.graphics.rectangle("fill", cnlX, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Cancel", cnlX, btnY + 6, btnW, "center")

    -- Store button bounds for hit-testing
    confirmBtn = { x = cfmX, y = btnY, w = btnW, h = btnH }
    cancelBtn  = { x = cnlX, y = btnY, w = btnW, h = btnH }
end

-- -----------------------------------------------------------------------
-- Input handlers
-- -----------------------------------------------------------------------

local function pointInRect(px, py, r)
    return r and px >= r.x and px <= r.x + r.w and py >= r.y and py <= r.y + r.h
end

function raceSelect.keypressed(key)
    if key == "escape" then
        if selectedRace then
            -- Close the confirmation dialog
            selectedRace = nil
        else
            -- Leave race selection, go back to character select
            _G.switchScene("character_select")
        end
    elseif key == "return" or key == "kpenter" then
        if selectedRace then
            raceSelect.confirmSelection()
        end
    end
end

function raceSelect.textinput(text)
    -- No text input on this screen
end

function raceSelect.mousepressed(x, y, button)
    if button ~= 1 then return end

    -- When the confirmation dialog is open, only process dialog clicks
    if selectedRace then
        if pointInRect(x, y, confirmBtn) then
            raceSelect.confirmSelection()
        elseif pointInRect(x, y, cancelBtn) then
            selectedRace = nil
        end
        -- Clicks outside the dialog buttons are intentionally ignored
        -- so the player cannot accidentally pick a different race card
        return
    end

    -- Check race card clicks
    for i, race in ipairs(RACES) do
        if pointInRect(x, y, race._bounds) then
            selectedRace = i
            return
        end
    end
end

function raceSelect.mousemoved(x, y)
    -- Disable hover while the dialog is open
    if selectedRace then
        hoverIndex = nil
        return
    end

    hoverIndex = nil
    for i, race in ipairs(RACES) do
        if pointInRect(x, y, race._bounds) then
            hoverIndex = i
            return
        end
    end
end

-- -----------------------------------------------------------------------
-- Network action
-- -----------------------------------------------------------------------

function raceSelect.confirmSelection()
    local race = RACES[selectedRace]
    if not race then return end

    if client then
        client:emit("race_select", { raceId = race.id })
    end
end

function raceSelect.unload()
    local client = _G.gameClient
    if client then
        pcall(function() client:off("race_selected") end)
        pcall(function() client:off("race_select_error") end)
    end
end

-- Resize: recreate fonts without re-running load() (which would re-register listeners)
function raceSelect.resize(w, h)
    fonts.title = love.graphics.newFont(28)
    fonts.subtitle = love.graphics.newFont(18)
    fonts.main = love.graphics.newFont(14)
    fonts.small = love.graphics.newFont(12)
    fonts.button = love.graphics.newFont(16)
end

return raceSelect
