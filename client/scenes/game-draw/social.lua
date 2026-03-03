-- scenes/game-draw/social.lua
-- Farming, knowledge, death, karma, factions, companions, pets, jail, ascension,
-- guild, crafting minigame, notifications, sync, and audio settings panel draw functions.

local social = {}

-- 'game' alias — all game._xxx references work unchanged
local game

-- Direct table refs (mutated in-place, safe to capture at init time)
local fonts, ui, knowledge

-- Getters for reassignable module-level locals in game.lua
local getClient, getZone

-- ---------------------------------------------------------------------------
-- Farming Panel
-- ---------------------------------------------------------------------------

local FARMING_TABS = {"crops", "animals", "build"}
local FARMING_TAB_LABELS = {crops = "Crops", animals = "Animals", build = "Build"}

local SEED_NAMES = {
    wheat_seed = "Wheat Seed", herb_seed = "Herb Seed", vegetable_seed = "Vegetable Seed",
    mushroom_spore = "Mushroom Spore", berry_seed = "Berry Seed", tea_leaf_seed = "Tea Leaf Seed",
    pumpkin_seed = "Pumpkin Seed", corn_seed = "Corn Seed", rare_flower_seed = "Rare Flower Seed",
    ancient_seed = "Ancient Seed",
}

local CROP_STAGE_NAMES = {"Seed", "Sprout", "Growing", "Mature", "Withered"}
local CROP_STAGE_COLORS = {
    {0.5, 0.4, 0.3}, {0.4, 0.7, 0.3}, {0.3, 0.8, 0.3}, {0.9, 0.8, 0.2}, {0.5, 0.3, 0.2}
}

local ANIMAL_NAMES = {
    chicken = "Chicken", cow = "Cow", sheep = "Sheep", pig = "Pig", bee_hive = "Bee Hive"
}

local function drawFarmingPanel(W, H)
    local pw = math.min(700, W - 40)
    local ph = math.min(520, H - 60)
    local px = (W - pw) / 2
    local py = (H - ph) / 2

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.06, 0.08, 0.05, 0.95)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    love.graphics.setColor(0.3, 0.55, 0.25, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.4, 0.8, 0.3)
    love.graphics.print("Farm & Ranch", px + 15, py + 10)

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.5)
    love.graphics.printf("[F] Close", px, py + 14, pw - 15, "right")

    -- Tabs
    local tabY = py + 40
    local tabW = math.floor((pw - 30) / #FARMING_TABS)
    love.graphics.setFont(fonts.ui)
    for i, tab in ipairs(FARMING_TABS) do
        local tx = px + 15 + (i - 1) * tabW
        local active = (ui.farmingTab == tab)
        if active then
            love.graphics.setColor(0.25, 0.45, 0.2, 0.9)
        else
            love.graphics.setColor(0.12, 0.15, 0.1, 0.7)
        end
        love.graphics.rectangle("fill", tx, tabY, tabW - 4, 30, 4, 4)
        love.graphics.setColor(active and {0.8, 1, 0.7} or {0.5, 0.6, 0.5})
        love.graphics.printf(FARMING_TAB_LABELS[tab], tx, tabY + 6, tabW - 4, "center")
    end

    local contentY = tabY + 40
    local contentH = ph - (contentY - py) - 10

    if ui.farmingTab == "crops" then
        game._drawCropsTab(px, contentY, pw, contentH)
    elseif ui.farmingTab == "animals" then
        game._drawAnimalsTab(px, contentY, pw, contentH)
    elseif ui.farmingTab == "build" then
        game._drawBuildTab(px, contentY, pw, contentH)
    end
end

local function _drawCropsTab(px, cy, pw, ch)
    love.graphics.setFont(fonts.main)
    local crops = ui.farmCrops
    local y = cy + 5

    if #crops == 0 then
        love.graphics.setColor(0.5, 0.6, 0.5)
        love.graphics.printf("No crops planted. Place a Crop Plot or Garden Bed, then press [E] to plant seeds.", px + 20, y, pw - 40, "center")
        -- Show plantable seeds from inventory
        y = y + 40
        love.graphics.setColor(0.4, 0.8, 0.3)
        love.graphics.print("Available Seeds:", px + 20, y)
        y = y + 20
        local hasSeed = false
        if resources then
            for seedType, seedName in pairs(SEED_NAMES) do
                local amt = resources[seedType] or 0
                if amt > 0 then
                    hasSeed = true
                    love.graphics.setColor(0.7, 0.8, 0.6)
                    love.graphics.print(string.format("  %s x%d", seedName, amt), px + 25, y)
                    y = y + 18
                end
            end
        end
        if not hasSeed then
            love.graphics.setColor(0.4, 0.4, 0.4)
            love.graphics.print("  No seeds. Buy from Seed Merchant or harvest wild plants.", px + 25, y)
        end
        return
    end

    -- Header
    love.graphics.setColor(0.4, 0.8, 0.3)
    love.graphics.print("Plot", px + 20, y)
    love.graphics.print("Crop", px + 100, y)
    love.graphics.print("Stage", px + 250, y)
    love.graphics.print("Progress", px + 370, y)
    love.graphics.print("Watered", px + 500, y)
    y = y + 22
    love.graphics.setColor(0.3, 0.4, 0.25, 0.5)
    love.graphics.rectangle("fill", px + 15, y, pw - 30, 1)
    y = y + 5

    for i, crop in ipairs(crops) do
        if y > cy + ch - 20 then break end
        local stage = (crop.stage or 0) + 1
        local stageCol = CROP_STAGE_COLORS[stage] or {0.6, 0.6, 0.6}

        love.graphics.setColor(0.6, 0.7, 0.6)
        love.graphics.print("#" .. i, px + 20, y)

        love.graphics.setColor(0.8, 0.9, 0.7)
        local seedName = SEED_NAMES[crop.seedType] or crop.seedType or "?"
        love.graphics.print(seedName:gsub("_seed", ""):gsub("_spore", ""), px + 100, y)

        love.graphics.setColor(stageCol)
        love.graphics.print(CROP_STAGE_NAMES[stage] or "?", px + 250, y)

        -- Progress bar
        local prog = crop.growthProgress or 0
        local barX, barW = px + 370, 110
        love.graphics.setColor(0.15, 0.2, 0.1)
        love.graphics.rectangle("fill", barX, y + 2, barW, 12, 3, 3)
        love.graphics.setColor(stageCol[1], stageCol[2], stageCol[3], 0.8)
        love.graphics.rectangle("fill", barX, y + 2, barW * math.min(1, prog), 12, 3, 3)
        love.graphics.setColor(0.9, 0.9, 0.9)
        love.graphics.setFont(fonts.small)
        love.graphics.printf(math.floor(prog * 100) .. "%", barX, y + 1, barW, "center")
        love.graphics.setFont(fonts.main)

        -- Watered indicator
        if crop.wateredToday then
            love.graphics.setColor(0.3, 0.6, 1)
            love.graphics.print("Yes", px + 510, y)
        else
            love.graphics.setColor(0.7, 0.4, 0.3)
            love.graphics.print("No", px + 510, y)
        end

        y = y + 22
    end

    -- Plant seed prompt if a plot is selected
    if ui.farmingPlotId then
        y = math.max(y + 10, cy + ch - 80)
        love.graphics.setColor(0.3, 0.5, 0.25, 0.6)
        love.graphics.rectangle("fill", px + 15, y, pw - 30, 70, 4, 4)
        love.graphics.setColor(0.6, 0.9, 0.5)
        love.graphics.print("Select a seed to plant (click):", px + 25, y + 5)
        local sx = px + 25
        local sy = y + 25
        if resources then
            for seedType, seedName in pairs(SEED_NAMES) do
                local amt = resources[seedType] or 0
                if amt > 0 then
                    love.graphics.setColor(0.7, 0.85, 0.6)
                    love.graphics.print(seedName .. " x" .. amt, sx, sy)
                    sx = sx + 150
                    if sx > px + pw - 160 then
                        sx = px + 25
                        sy = sy + 18
                    end
                end
            end
        end
    end
end

local function _drawAnimalsTab(px, cy, pw, ch)
    love.graphics.setFont(fonts.main)
    local animals = ui.farmAnimals
    local y = cy + 5

    if #animals == 0 then
        love.graphics.setColor(0.5, 0.6, 0.5)
        love.graphics.printf("No animals yet. Place an Animal Pen, then buy animals from the Rancher shop.", px + 20, y, pw - 40, "center")
        return
    end

    -- Header
    love.graphics.setColor(0.4, 0.8, 0.3)
    love.graphics.print("Pen", px + 20, y)
    love.graphics.print("Animal", px + 80, y)
    love.graphics.print("Name", px + 180, y)
    love.graphics.print("Happy", px + 310, y)
    love.graphics.print("Products", px + 400, y)
    y = y + 22
    love.graphics.setColor(0.3, 0.4, 0.25, 0.5)
    love.graphics.rectangle("fill", px + 15, y, pw - 30, 1)
    y = y + 5

    for i, pen in ipairs(animals) do
        if pen.animals then
            for j, ani in ipairs(pen.animals) do
                if y > cy + ch - 20 then break end
                love.graphics.setColor(0.6, 0.7, 0.6)
                love.graphics.print("#" .. i, px + 20, y)

                love.graphics.setColor(0.8, 0.9, 0.7)
                love.graphics.print(ANIMAL_NAMES[ani.animalType] or ani.animalType, px + 80, y)

                love.graphics.setColor(0.7, 0.8, 0.9)
                love.graphics.print(ani.name or "-", px + 180, y)

                -- Happiness bar
                local hap = ani.happiness or 0
                local hapCol = hap >= 50 and {0.3, 0.8, 0.3} or (hap >= 25 and {0.8, 0.7, 0.2} or {0.8, 0.3, 0.2})
                local barX, barW = px + 310, 70
                love.graphics.setColor(0.15, 0.2, 0.1)
                love.graphics.rectangle("fill", barX, y + 2, barW, 12, 3, 3)
                love.graphics.setColor(hapCol)
                love.graphics.rectangle("fill", barX, y + 2, barW * (hap / 100), 12, 3, 3)
                love.graphics.setColor(0.9, 0.9, 0.9)
                love.graphics.setFont(fonts.small)
                love.graphics.printf(hap .. "%", barX, y + 1, barW, "center")
                love.graphics.setFont(fonts.main)

                -- Pending products
                local prodStr = ""
                if ani.pendingProducts and #ani.pendingProducts > 0 then
                    for _, prod in ipairs(ani.pendingProducts) do
                        if prodStr ~= "" then prodStr = prodStr .. ", " end
                        prodStr = prodStr .. (prod.type or "?") .. " x" .. (prod.amount or 1)
                    end
                    love.graphics.setColor(0.9, 0.85, 0.4)
                else
                    prodStr = "-"
                    love.graphics.setColor(0.5, 0.5, 0.5)
                end
                love.graphics.print(prodStr, px + 400, y)

                y = y + 22
            end
        end
    end

    -- Hint
    love.graphics.setColor(0.4, 0.5, 0.4)
    love.graphics.setFont(fonts.small)
    love.graphics.printf("[E] near pen to feed/collect", px + 15, cy + ch - 18, pw - 30, "center")
end

local function _drawBuildTab(px, cy, pw, ch)
    love.graphics.setFont(fonts.main)
    local y = cy + 5

    love.graphics.setColor(0.4, 0.8, 0.3)
    love.graphics.print("Farming Structures", px + 20, y)
    y = y + 22

    local buildItems = {
        {name = "Crop Plot", desc = "Plant crops here (craft from wood + stone)"},
        {name = "Garden Bed", desc = "Enhanced crop plot (craft from wood + fertilizer)"},
        {name = "Animal Pen", desc = "House animals (craft from wood + iron bar)"},
        {name = "Water Trough", desc = "Water source for crops (200px range)"},
        {name = "Well", desc = "Large water source (400px range)"},
        {name = "Scarecrow", desc = "Prevents crop withering (15% per scarecrow)"},
        {name = "Sprinkler", desc = "Auto-waters crops within 150px"},
    }

    for _, item in ipairs(buildItems) do
        if y > cy + ch - 20 then break end
        love.graphics.setColor(0.7, 0.85, 0.6)
        love.graphics.print(item.name, px + 25, y)
        love.graphics.setColor(0.5, 0.6, 0.5)
        love.graphics.print(item.desc, px + 180, y)
        y = y + 20
    end

    y = y + 15
    love.graphics.setColor(0.4, 0.8, 0.3)
    love.graphics.print("Furniture Effects", px + 20, y)
    y = y + 22

    local furnitureItems = {
        {name = "Bed", desc = "Sleep to gain +2 VIG, +10% XP for 10min"},
        {name = "Bookshelf", desc = "+5% all skill XP on plot (stacks 3x)"},
        {name = "Lantern", desc = "-10% night penalty on plot (stacks 6x)"},
        {name = "Clock", desc = "+5% crop growth speed"},
        {name = "Trophy Mount", desc = "+1 Presence per trophy (max 5)"},
    }

    for _, item in ipairs(furnitureItems) do
        if y > cy + ch - 20 then break end
        love.graphics.setColor(0.7, 0.8, 0.9)
        love.graphics.print(item.name, px + 25, y)
        love.graphics.setColor(0.5, 0.55, 0.6)
        love.graphics.print(item.desc, px + 180, y)
        y = y + 20
    end

    love.graphics.setColor(0.4, 0.5, 0.4)
    love.graphics.setFont(fonts.small)
    love.graphics.printf("Open Inventory [I] > Crafting to build structures", px + 15, cy + ch - 18, pw - 30, "center")
end

local function handleFarmingClick(mx, my)
    local client = getClient()
    local W, H = love.graphics.getDimensions()
    local pw = math.min(700, W - 40)
    local ph = math.min(520, H - 60)
    local px = (W - pw) / 2
    local py = (H - ph) / 2

    -- Outside panel = close
    if mx < px or mx > px + pw or my < py or my > py + ph then
        ui.showFarming = false
        ui.farmingPlotId = nil
        return true
    end

    -- Tab clicks
    local tabY = py + 40
    local tabW = math.floor((pw - 30) / #FARMING_TABS)
    if my >= tabY and my <= tabY + 30 then
        for i, tab in ipairs(FARMING_TABS) do
            local tx = px + 15 + (i - 1) * tabW
            if mx >= tx and mx <= tx + tabW - 4 then
                ui.farmingTab = tab
                return true
            end
        end
    end

    -- Seed selection when a plot is selected (crops tab)
    if ui.farmingTab == "crops" and ui.farmingPlotId and resources then
        local contentY = tabY + 40
        local contentH = ph - (contentY - py) - 10
        local seedY = math.max(contentY + (#ui.farmCrops * 22) + 50, contentY + contentH - 80)
        if my >= seedY + 25 then
            local sx = px + 25
            local sy = seedY + 25
            for seedType, seedName in pairs(SEED_NAMES) do
                local amt = resources[seedType] or 0
                if amt > 0 then
                    local tw = 150
                    if mx >= sx and mx <= sx + tw and my >= sy and my <= sy + 18 then
                        if client then
                            client:emit("plant_seed", { cropPlotId = ui.farmingPlotId, seedType = seedType })
                            ui.farmingPlotId = nil
                        end
                        return true
                    end
                    sx = sx + 150
                    if sx > px + pw - 160 then
                        sx = px + 25
                        sy = sy + 18
                    end
                end
            end
        end
    end

    return true -- consume click within panel
end

-- ---------------------------------------------------------------------------
-- Knowledge Panel
-- ---------------------------------------------------------------------------

-- Rarity colors for books
local RARITY_COLORS = {
    common = {0.6, 0.6, 0.6},
    uncommon = {0.13, 0.8, 0.13},
    rare = {0.2, 0.53, 1},
    ultra_rare = {0.67, 0.27, 1},
    mythic_rare = {1, 0.67, 0},
    legendary = {1, 0.4, 0},
    godly = {1, 0, 0},
    relic = {1, 1, 1},
}

local KNOWLEDGE_TABS = {"glossary", "lore", "books", "codex"}
local KNOWLEDGE_TAB_LABELS = {glossary = "Glossary", lore = "Lore", books = "Books", codex = "Codex"}

local function drawKnowledgePanel(W, H)
    local pw = math.min(750, W - 40)
    local ph = math.min(580, H - 60)
    local px = (W - pw) / 2
    local py = (H - ph) / 2

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.06, 0.07, 0.12, 0.95)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    love.graphics.setColor(0.35, 0.4, 0.65, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.8, 0.75, 0.4, 1)
    love.graphics.printf("Knowledge", px, py + 10, pw, "center")

    -- Tab buttons
    local tabW = (pw - 40) / #KNOWLEDGE_TABS
    local tabY = py + 42
    love.graphics.setFont(fonts.ui)
    for i, tabId in ipairs(KNOWLEDGE_TABS) do
        local tx = px + 20 + (i - 1) * tabW
        local isActive = knowledge.tab == tabId
        if isActive then
            love.graphics.setColor(0.25, 0.28, 0.45, 1)
        else
            love.graphics.setColor(0.12, 0.13, 0.2, 1)
        end
        love.graphics.rectangle("fill", tx, tabY, tabW - 4, 28, 4, 4)
        if isActive then
            love.graphics.setColor(0.7, 0.8, 1, 1)
        else
            love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
        end
        love.graphics.printf(KNOWLEDGE_TAB_LABELS[tabId] or tabId, tx, tabY + 6, tabW - 4, "center")
    end

    -- Content area
    local contentY = tabY + 36
    local contentH = ph - (contentY - py) - 10

    -- Scissor to clip scrollable content
    love.graphics.setScissor(px + 5, contentY, pw - 10, contentH)

    if knowledge.tab == "glossary" then
        game.drawKnowledgeGlossary(px, contentY, pw, contentH)
    elseif knowledge.tab == "lore" then
        game.drawKnowledgeLore(px, contentY, pw, contentH)
    elseif knowledge.tab == "books" then
        game.drawKnowledgeBooks(px, contentY, pw, contentH)
    elseif knowledge.tab == "codex" then
        game.drawKnowledgeCodex(px, contentY, pw, contentH)
    end

    love.graphics.setScissor()

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.5, 0.6)
    love.graphics.printf("B to close | Scroll to navigate", px, py + ph - 16, pw, "center")
end

local function drawKnowledgeGlossary(px, cy, pw, ch)
    local terms = knowledge.glossaryTerms
    local unlocked = knowledge.glossaryUnlocked or {}
    if not terms then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.5, 0.8)
        love.graphics.printf("Loading glossary...", px, cy + 20, pw, "center")
        return
    end

    -- Build unlocked set for fast lookup
    local unlockedSet = {}
    for _, id in ipairs(unlocked) do unlockedSet[id] = true end

    local y = cy + 5 - knowledge.scrollY
    love.graphics.setFont(fonts.ui)

    -- Category filter header
    love.graphics.setColor(0.6, 0.65, 0.8, 0.9)
    love.graphics.printf("Filter: " .. (knowledge.glossaryFilter == "all" and "All" or knowledge.glossaryFilter), px + 15, y, pw - 30, "left")
    y = y + 22

    -- Group terms by category
    local categories = {}
    local catOrder = {}
    for _, t in ipairs(terms) do
        if knowledge.glossaryFilter == "all" or t.category == knowledge.glossaryFilter then
            if not categories[t.category] then
                categories[t.category] = {}
                table.insert(catOrder, t.category)
            end
            table.insert(categories[t.category], t)
        end
    end
    table.sort(catOrder)

    for _, cat in ipairs(catOrder) do
        if y + 20 > cy - 20 and y < cy + ch + 20 then
            love.graphics.setFont(fonts.ui)
            love.graphics.setColor(0.6, 0.75, 1, 0.9)
            local catLabel = cat:sub(1, 1):upper() .. cat:sub(2)
            love.graphics.print("-- " .. catLabel .. " --", px + 15, y)
        end
        y = y + 22

        for _, term in ipairs(categories[cat]) do
            local isUnlocked = unlockedSet[term.id]
            if y + 40 > cy - 20 and y < cy + ch + 20 then
                if isUnlocked then
                    love.graphics.setFont(fonts.ui)
                    love.graphics.setColor(0.9, 0.85, 0.5, 1)
                    love.graphics.print(term.term, px + 25, y)
                    love.graphics.setFont(fonts.small)
                    love.graphics.setColor(0.75, 0.75, 0.8, 0.9)
                    love.graphics.printf(term.definition, px + 25, y + 16, pw - 55, "left")
                    -- Calculate wrapped text height
                    local font = fonts.small
                    local _, wraps = font:getWrap(term.definition, pw - 55)
                    y = y + 18 + #wraps * font:getHeight()
                else
                    love.graphics.setFont(fonts.ui)
                    love.graphics.setColor(0.35, 0.35, 0.4, 0.7)
                    love.graphics.print("???", px + 25, y)
                    love.graphics.setFont(fonts.small)
                    love.graphics.setColor(0.3, 0.3, 0.35, 0.6)
                    love.graphics.print("[Undiscovered]", px + 25, y + 16)
                    y = y + 34
                end
            else
                -- Skip rendering but still advance y
                if isUnlocked then
                    local font = fonts.small
                    local _, wraps = font:getWrap(term.definition, pw - 55)
                    y = y + 18 + #wraps * font:getHeight()
                else
                    y = y + 34
                end
            end
            y = y + 4
        end
        y = y + 6
    end
end

local function drawKnowledgeLore(px, cy, pw, ch)
    local data = knowledge.loreData
    if not data then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.5, 0.8)
        love.graphics.printf("Loading lore...", px, cy + 20, pw, "center")
        return
    end

    -- Sub-tabs: timeline, races, factions, geography
    local subTabs = {"timeline", "races", "factions", "geography"}
    local subLabels = {timeline = "Timeline", races = "Races", factions = "Factions", geography = "Geography"}
    local stW = (pw - 40) / #subTabs
    local stY = cy + 3
    love.graphics.setFont(fonts.small)
    for i, st in ipairs(subTabs) do
        local sx = px + 20 + (i - 1) * stW
        local isActive = knowledge.loreSubTab == st
        if isActive then
            love.graphics.setColor(0.2, 0.22, 0.35, 0.9)
        else
            love.graphics.setColor(0.1, 0.1, 0.15, 0.7)
        end
        love.graphics.rectangle("fill", sx, stY, stW - 3, 22, 3, 3)
        love.graphics.setColor(isActive and {0.8, 0.85, 1, 1} or {0.45, 0.45, 0.5, 0.7})
        love.graphics.printf(subLabels[st], sx, stY + 4, stW - 3, "center")
    end

    local y = stY + 30 - knowledge.scrollY

    if knowledge.loreSubTab == "timeline" and data.timeline then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.8, 0.75, 0.4, 1)
        love.graphics.print("World Timeline", px + 15, y)
        y = y + 24
        love.graphics.setFont(fonts.small)
        for _, entry in ipairs(data.timeline) do
            if y > cy - 40 and y < cy + ch + 40 then
                love.graphics.setColor(0.5, 0.7, 1, 0.9)
                local yearStr = entry.year < 0 and ("Y" .. entry.year) or ("Year " .. entry.year)
                love.graphics.print(yearStr, px + 15, y)
                love.graphics.setColor(0.85, 0.82, 0.7, 1)
                love.graphics.print(entry.title or "", px + 90, y)
                y = y + 16
                love.graphics.setColor(0.6, 0.6, 0.65, 0.8)
                love.graphics.printf(entry.description or "", px + 25, y, pw - 55, "left")
                local font = fonts.small
                local _, wraps = font:getWrap(entry.description or "", pw - 55)
                y = y + #wraps * font:getHeight() + 8
            else
                local font = fonts.small
                local _, wraps = font:getWrap(entry.description or "", pw - 55)
                y = y + 16 + #wraps * font:getHeight() + 8
            end
        end
    elseif knowledge.loreSubTab == "races" and data.races then
        love.graphics.setFont(fonts.ui)
        for raceId, race in pairs(data.races) do
            if y > cy - 60 and y < cy + ch + 60 then
                love.graphics.setColor(0.9, 0.8, 0.3, 1)
                love.graphics.setFont(fonts.ui)
                love.graphics.print((race.name or raceId) .. " — " .. (race.title or ""), px + 15, y)
                y = y + 20
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.7, 0.7, 0.75, 0.9)
                love.graphics.printf(race.summary or "", px + 25, y, pw - 55, "left")
                local font = fonts.small
                local _, wraps = font:getWrap(race.summary or "", pw - 55)
                y = y + #wraps * font:getHeight() + 12
            else
                local font = fonts.small
                local _, wraps = font:getWrap(race.summary or "", pw - 55)
                y = y + 20 + #wraps * font:getHeight() + 12
            end
        end
    elseif knowledge.loreSubTab == "factions" and data.factions then
        love.graphics.setFont(fonts.ui)
        for fId, fac in pairs(data.factions) do
            if y > cy - 60 and y < cy + ch + 60 then
                love.graphics.setColor(0.7, 0.8, 1, 1)
                love.graphics.setFont(fonts.ui)
                love.graphics.print(fac.name or fId, px + 15, y)
                y = y + 20
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.65, 0.65, 0.7, 0.9)
                love.graphics.printf(fac.summary or fac.purpose or "", px + 25, y, pw - 55, "left")
                local font = fonts.small
                local _, wraps = font:getWrap(fac.summary or fac.purpose or "", pw - 55)
                y = y + #wraps * font:getHeight() + 12
            else
                local font = fonts.small
                local _, wraps = font:getWrap(fac.summary or fac.purpose or "", pw - 55)
                y = y + 20 + #wraps * font:getHeight() + 12
            end
        end
    elseif knowledge.loreSubTab == "geography" and data.geography then
        love.graphics.setFont(fonts.ui)
        for _, geo in ipairs(data.geography) do
            if y > cy - 60 and y < cy + ch + 60 then
                love.graphics.setColor(0.5, 0.8, 0.5, 1)
                love.graphics.setFont(fonts.ui)
                love.graphics.print(geo.name or "", px + 15, y)
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.5, 0.55, 0.5, 0.7)
                love.graphics.print(geo.terrain or "", px + 200, y + 2)
                y = y + 20
                love.graphics.setColor(0.65, 0.65, 0.7, 0.9)
                love.graphics.printf(geo.description or "", px + 25, y, pw - 55, "left")
                local font = fonts.small
                local _, wraps = font:getWrap(geo.description or "", pw - 55)
                y = y + #wraps * font:getHeight() + 12
            else
                local font = fonts.small
                local _, wraps = font:getWrap(geo.description or "", pw - 55)
                y = y + 20 + #wraps * font:getHeight() + 12
            end
        end
    end
end

local function drawKnowledgeBooks(px, cy, pw, ch)
    -- If reading a book, show full content
    if knowledge.bookContent then
        local bc = knowledge.bookContent
        local y = cy + 5 - knowledge.scrollY

        -- Back button hint
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.5, 0.5, 0.6, 0.7)
        love.graphics.print("Right-click or press Escape to go back", px + 15, y)
        y = y + 20

        -- Title
        love.graphics.setFont(fonts.title)
        local rc = RARITY_COLORS[bc.rarity] or {0.6, 0.6, 0.6}
        love.graphics.setColor(rc[1], rc[2], rc[3], 1)
        love.graphics.printf(bc.title or "Untitled", px + 15, y, pw - 30, "center")
        y = y + 30

        -- Author
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
        love.graphics.printf("by " .. (bc.author or "Unknown"), px + 15, y, pw - 30, "center")
        y = y + 24

        if bc.dangerous then
            love.graphics.setColor(1, 0.3, 0.3, 0.9)
            love.graphics.printf("[FORBIDDEN KNOWLEDGE]", px + 15, y, pw - 30, "center")
            y = y + 20
        end

        -- Content
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.8, 0.78, 0.7, 1)
        love.graphics.printf(bc.content or "", px + 20, y, pw - 45, "left")
        return
    end

    local bks = knowledge.books
    if not bks then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.5, 0.8)
        love.graphics.printf("Loading books...", px, cy + 20, pw, "center")
        return
    end

    if #bks == 0 then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.5, 0.8)
        love.graphics.printf("No books discovered yet.\nExplore dungeons to find books in chests and boss loot.", px + 15, cy + 30, pw - 30, "center")
        return
    end

    local y = cy + 5 - knowledge.scrollY
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.7, 0.7, 0.8, 0.9)
    love.graphics.print("Discovered Books (" .. #bks .. ")", px + 15, y)
    y = y + 24

    for idx, bk in ipairs(bks) do
        if y > cy - 30 and y < cy + ch + 30 then
            -- Book entry
            local rc = RARITY_COLORS[bk.rarity] or {0.6, 0.6, 0.6}
            love.graphics.setColor(0.1, 0.11, 0.18, 0.8)
            love.graphics.rectangle("fill", px + 12, y, pw - 24, 36, 4, 4)
            love.graphics.setColor(rc[1], rc[2], rc[3], 0.6)
            love.graphics.rectangle("line", px + 12, y, pw - 24, 36, 4, 4)

            love.graphics.setFont(fonts.ui)
            love.graphics.setColor(rc[1], rc[2], rc[3], 1)
            love.graphics.print(bk.title or "Untitled", px + 20, y + 3)

            love.graphics.setFont(fonts.small)
            love.graphics.setColor(0.55, 0.55, 0.6, 0.7)
            local meta = (bk.category or "") .. " | " .. (bk.rarity or "")
            if bk.dangerous then meta = meta .. " | FORBIDDEN" end
            if bk.partOfCodex then meta = meta .. " | CODEX" end
            love.graphics.print(meta, px + 20, y + 20)
        end
        y = y + 42
    end
end

local function drawKnowledgeCodex(px, cy, pw, ch)
    local cdx = knowledge.codex
    if not cdx then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.5, 0.8)
        love.graphics.printf("Loading codex...", px, cy + 20, pw, "center")
        return
    end

    local y = cy + 10 - knowledge.scrollY

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.9, 0.7, 0.2, 1)
    love.graphics.printf("The Vel'sharath Covenant", px, y, pw, "center")
    y = y + 32

    -- Progress bar
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.6, 0.6, 0.7, 0.9)
    love.graphics.printf("Fragments: " .. (cdx.fragmentsFound or 0) .. " / " .. (cdx.fragmentsTotal or 7), px, y, pw, "center")
    y = y + 24

    local barW = pw - 80
    local barX = px + 40
    love.graphics.setColor(0.15, 0.15, 0.2, 1)
    love.graphics.rectangle("fill", barX, y, barW, 14, 3, 3)
    local fill = cdx.fragmentsTotal > 0 and (cdx.fragmentsFound / cdx.fragmentsTotal) or 0
    love.graphics.setColor(0.8, 0.6, 0.1, 0.9)
    love.graphics.rectangle("fill", barX, y, barW * fill, 14, 3, 3)
    y = y + 24

    -- Fragment list
    if cdx.fragments then
        love.graphics.setFont(fonts.ui)
        for _, frag in ipairs(cdx.fragments) do
            if frag.found then
                love.graphics.setColor(0.8, 0.75, 0.3, 1)
                love.graphics.print("[Found] " .. (frag.id or ""), px + 30, y)
            else
                love.graphics.setColor(0.35, 0.35, 0.4, 0.6)
                love.graphics.print("[???] Undiscovered fragment", px + 30, y)
            end
            y = y + 22
        end
    end
    y = y + 10

    -- Assembled codex text
    if cdx.isComplete and cdx.assembledCodex then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(1, 0.85, 0.2, 1)
        love.graphics.printf("CODEX ASSEMBLED", px, y, pw, "center")
        y = y + 26
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.85, 0.8, 0.65, 1)
        love.graphics.printf(cdx.assembledCodex.content or "", px + 20, y, pw - 45, "left")
    elseif not cdx.isComplete then
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.4, 0.4, 0.5, 0.7)
        love.graphics.printf("Collect all 7 fragments from deep within the Rift to assemble the covenant...", px + 20, y, pw - 45, "center")
    end
end

-- Knowledge discovery game._notifications (floating popups)
local function drawKnowledgeNotifications(W, H)
    if #knowledge.notifications == 0 then return end

    local ny = 80
    for _, notif in ipairs(knowledge.notifications) do
        local alpha = math.min(1, notif.timer / 0.5)  -- fade out in last 0.5s
        if notif.type == "book" then
            local rc = RARITY_COLORS[notif.rarity] or {0.6, 0.6, 0.6}
            love.graphics.setColor(0.05, 0.06, 0.1, 0.85 * alpha)
            love.graphics.rectangle("fill", W - 310, ny, 300, 40, 6, 6)
            love.graphics.setColor(rc[1], rc[2], rc[3], 0.7 * alpha)
            love.graphics.rectangle("line", W - 310, ny, 300, 40, 6, 6)
            love.graphics.setFont(fonts.small)
            love.graphics.setColor(rc[1], rc[2], rc[3], alpha)
            love.graphics.print("Book Discovered!", W - 300, ny + 4)
            love.graphics.setFont(fonts.ui)
            love.graphics.setColor(1, 1, 1, alpha)
            love.graphics.printf(notif.title, W - 300, ny + 18, 280, "left")
        elseif notif.type == "term" then
            love.graphics.setColor(0.05, 0.06, 0.1, 0.85 * alpha)
            love.graphics.rectangle("fill", W - 310, ny, 300, 30, 6, 6)
            love.graphics.setColor(0.4, 0.5, 0.8, 0.7 * alpha)
            love.graphics.rectangle("line", W - 310, ny, 300, 30, 6, 6)
            love.graphics.setFont(fonts.small)
            love.graphics.setColor(0.7, 0.8, 1, alpha)
            love.graphics.print("Glossary Unlocked: " .. (notif.term or ""), W - 300, ny + 8)
        end
        ny = ny + 46
    end
end

-- Handle knowledge panel mouse clicks and scrolling
local function handleKnowledgeClick(mx, my, button)
    local client = getClient()
    if not ui.showKnowledge then return false end

    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()
    local pw = math.min(750, W - 40)
    local ph = math.min(580, H - 60)
    local px = (W - pw) / 2
    local py = (H - ph) / 2

    -- Outside panel = close
    if mx < px or mx > px + pw or my < py or my > py + ph then
        ui.showKnowledge = false
        return true
    end

    -- Right-click while reading a book = go back
    if button == 2 and knowledge.bookContent then
        knowledge.bookContent = nil
        knowledge.scrollY = 0
        return true
    end

    -- Tab buttons
    local tabW = (pw - 40) / #KNOWLEDGE_TABS
    local tabY = py + 42
    for i, tabId in ipairs(KNOWLEDGE_TABS) do
        local tx = px + 20 + (i - 1) * tabW
        if mx >= tx and mx <= tx + tabW - 4 and my >= tabY and my <= tabY + 28 then
            knowledge.tab = tabId
            knowledge.scrollY = 0
            knowledge.bookContent = nil
            if client then
                client:emit("knowledge_get", { tab = tabId })
            end
            return true
        end
    end

    -- Lore sub-tabs
    if knowledge.tab == "lore" then
        local subTabs = {"timeline", "races", "factions", "geography"}
        local stW = (pw - 40) / #subTabs
        local contentY = tabY + 36
        local stY = contentY + 3
        for i, st in ipairs(subTabs) do
            local sx = px + 20 + (i - 1) * stW
            if mx >= sx and mx <= sx + stW - 3 and my >= stY and my <= stY + 22 then
                knowledge.loreSubTab = st
                knowledge.scrollY = 0
                return true
            end
        end
    end

    -- Book click: open book for reading
    if knowledge.tab == "books" and not knowledge.bookContent and knowledge.books and button == 1 then
        local contentY = tabY + 36
        local bkY = contentY + 5 - knowledge.scrollY + 24  -- offset by header
        for _, bk in ipairs(knowledge.books) do
            if my >= bkY and my <= bkY + 36 and mx >= px + 12 and mx <= px + pw - 12 then
                knowledge.scrollY = 0
                if client then
                    client:emit("knowledge_read_book", { bookId = bk.id })
                end
                return true
            end
            bkY = bkY + 42
        end
    end

    -- Glossary category filter click (click on "Filter:" label cycles)
    if knowledge.tab == "glossary" and button == 1 then
        local contentY = tabY + 36
        local filterY = contentY + 5 - knowledge.scrollY
        if my >= filterY and my <= filterY + 20 and mx >= px + 15 and mx <= px + 200 then
            local cats = {"all", "combat", "cards", "skills", "races", "world", "economy", "housing", "dungeons", "crafting", "factions"}
            local cur = knowledge.glossaryFilter
            for ci = 1, #cats do
                if cats[ci] == cur then
                    knowledge.glossaryFilter = cats[(ci % #cats) + 1]
                    knowledge.scrollY = 0
                    break
                end
            end
            return true
        end
    end

    return true  -- consume click (panel is open)
end

-- ---------------------------------------------------------------------------
-- Permadeath UI: Bleedout Overlay
-- ---------------------------------------------------------------------------

local function drawBleedoutOverlay(W, H)
    -- Red pulsing vignette
    local pulse = 0.3 + 0.15 * math.sin(love.timer.getTime() * 3)
    love.graphics.setColor(0.5, 0, 0, pulse)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Dark center overlay
    love.graphics.setColor(0, 0, 0, 0.5)
    love.graphics.rectangle("fill", W/2 - 200, H/2 - 80, 400, 160, 8, 8)
    love.graphics.setColor(0.8, 0.2, 0.2, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", W/2 - 200, H/2 - 80, 400, 160, 8, 8)
    love.graphics.setLineWidth(1)

    -- "DOWNED" text
    love.graphics.setFont(fonts.ui or fonts.main)
    love.graphics.setColor(1, 0.2, 0.2, 1)
    love.graphics.printf("DOWNED", 0, H/2 - 65, W, "center")

    -- Timer
    local secs = math.ceil(permadeath.bleedoutTimer)
    local mins = math.floor(secs / 60)
    local remSecs = secs % 60
    love.graphics.setFont(fonts.main or fonts.chat)
    love.graphics.setColor(1, 0.8, 0.3, 1)
    love.graphics.printf(string.format("Bleedout: %d:%02d", mins, remSecs), 0, H/2 - 35, W, "center")

    -- Cause of death
    love.graphics.setColor(0.8, 0.6, 0.6, 0.9)
    love.graphics.printf(permadeath.causeOfDeath or "", 0, H/2 - 10, W, "center")

    -- Rescue prompt
    love.graphics.setColor(0.7, 0.9, 0.7, 0.7 + 0.3 * math.sin(love.timer.getTime() * 2))
    love.graphics.printf("Waiting for rescue...", 0, H/2 + 20, W, "center")
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("Another player can revive you by pressing E nearby", 0, H/2 + 45, W, "center")
end

-- ---------------------------------------------------------------------------
-- Permadeath UI: Death Epitaph Screen
-- ---------------------------------------------------------------------------

local function drawPermaDeathScreen(W, H)
    -- Full black overlay
    love.graphics.setColor(0, 0, 0, 0.9)
    love.graphics.rectangle("fill", 0, 0, W, H)

    local hero = permadeath.deathHero
    if not hero then
        love.graphics.setFont(fonts.ui or fonts.main)
        love.graphics.setColor(0.8, 0.2, 0.2, 1)
        love.graphics.printf("PERMADEATH", 0, H/2 - 40, W, "center")
        love.graphics.setFont(fonts.main or fonts.chat)
        love.graphics.setColor(0.7, 0.7, 0.7, 0.8)
        love.graphics.printf("Press Enter to continue", 0, H/2 + 20, W, "center")
        return
    end

    -- Ornamental border
    love.graphics.setColor(0.4, 0.2, 0.2, 0.6)
    love.graphics.setLineWidth(3)
    love.graphics.rectangle("line", 60, 40, W - 120, H - 80, 10, 10)
    love.graphics.setLineWidth(1)

    -- "REST IN PEACE" header
    love.graphics.setFont(fonts.ui or fonts.main)
    love.graphics.setColor(0.9, 0.7, 0.3, 1)
    love.graphics.printf("REST IN PEACE", 0, 70, W, "center")

    -- Hero name
    love.graphics.setColor(1, 0.9, 0.7, 1)
    love.graphics.printf(hero.name or "Unknown Hero", 0, 110, W, "center")

    -- Race + Level
    love.graphics.setFont(fonts.main or fonts.chat)
    love.graphics.setColor(0.7, 0.7, 0.8, 0.9)
    local raceStr = (hero.race or "Unknown") .. "  |  Level " .. (hero.level or 1)
    love.graphics.printf(raceStr, 0, 145, W, "center")

    -- Cause of death
    love.graphics.setColor(0.9, 0.3, 0.3, 1)
    love.graphics.printf(hero.causeOfDeath or "Fell in the dungeon", 0, 180, W, "center")

    -- Dungeon info
    love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
    local dungeonInfo = ""
    if hero.dungeonId then dungeonInfo = hero.dungeonId end
    if hero.floorNum then dungeonInfo = dungeonInfo .. "  Floor " .. hero.floorNum end
    love.graphics.printf(dungeonInfo, 0, 210, W, "center")

    -- Stats
    local dp = hero.dungeonProgress or {}
    love.graphics.setColor(0.6, 0.7, 0.6, 0.8)
    local statsY = 250
    love.graphics.printf("Enemies Slain: " .. (dp.totalKills or 0), 0, statsY, W, "center")
    love.graphics.printf("Bosses Defeated: " .. (dp.bossesKilled or 0), 0, statsY + 22, W, "center")
    love.graphics.printf("Deepest Floor: " .. (dp.deepestFloor or 0), 0, statsY + 44, W, "center")
    love.graphics.printf("Guild Rank: " .. (dp.guildRank or "Stone"), 0, statsY + 66, W, "center")

    -- Coins
    love.graphics.setColor(0.9, 0.8, 0.3, 0.8)
    love.graphics.printf("Coins Lost: " .. (hero.chips or 0), 0, statsY + 100, W, "center")

    -- Continue button
    local pulse = 0.6 + 0.4 * math.sin(love.timer.getTime() * 2)
    love.graphics.setColor(0.7, 0.7, 0.7, pulse)
    love.graphics.printf("Press Enter to continue", 0, H - 100, W, "center")

    if not permadeath.hasCharsLeft then
        love.graphics.setColor(0.9, 0.6, 0.2, 0.8)
        love.graphics.printf("No characters remaining — you will create a new one", 0, H - 70, W, "center")
    end
end

-- ---------------------------------------------------------------------------
-- Permadeath UI: Hall of Heroes (in-game)
-- ---------------------------------------------------------------------------

local function drawHallOfHeroes(W, H)
    local dlgW = 500
    local dlgH = 420
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
    love.graphics.setFont(fonts.ui or fonts.main)
    love.graphics.setColor(0.9, 0.7, 0.3, 1)
    love.graphics.printf("Hall of Heroes", dlgX, dlgY + 12, dlgW, "center")

    love.graphics.setFont(fonts.chat or fonts.main)
    love.graphics.setColor(0.6, 0.5, 0.7, 0.8)
    love.graphics.printf("Fallen permadeath characters memorialized here", dlgX, dlgY + 38, dlgW, "center")

    local heroes = permadeath.hallOfHeroesList
    if #heroes == 0 then
        love.graphics.setFont(fonts.main or fonts.chat)
        love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
        love.graphics.printf("No fallen heroes yet.", dlgX, dlgY + 120, dlgW, "center")
    else
        local entryH = 60
        local listY = dlgY + 60
        local maxVisible = math.floor((dlgH - 85) / entryH)
        for i = 1, math.min(#heroes, maxVisible) do
            local hero = heroes[#heroes - i + 1] -- newest first
            local ey = listY + (i - 1) * entryH

            love.graphics.setColor(0.12, 0.1, 0.16, 0.8)
            love.graphics.rectangle("fill", dlgX + 10, ey, dlgW - 20, entryH - 4, 4, 4)

            love.graphics.setFont(fonts.main or fonts.chat)
            love.graphics.setColor(0.9, 0.8, 0.6, 1)
            love.graphics.print((hero.name or "Unknown") .. "  Lv." .. (hero.level or 1), dlgX + 20, ey + 4)

            love.graphics.setFont(fonts.chat or fonts.main)
            love.graphics.setColor(0.7, 0.6, 0.8, 0.9)
            love.graphics.print(hero.race or "Unknown", dlgX + 20, ey + 22)

            love.graphics.setColor(0.8, 0.3, 0.3, 0.9)
            love.graphics.print(hero.causeOfDeath or "Unknown", dlgX + 120, ey + 22)

            love.graphics.setColor(0.5, 0.5, 0.6, 0.7)
            local floorInfo = ""
            if hero.dungeonId then floorInfo = hero.dungeonId end
            if hero.floorNum then floorInfo = floorInfo .. " F" .. hero.floorNum end
            love.graphics.print(floorInfo, dlgX + 20, ey + 38)

            local dp = hero.dungeonProgress or {}
            love.graphics.setColor(0.5, 0.6, 0.5, 0.7)
            love.graphics.print("Kills: " .. (dp.totalKills or 0) .. "  Bosses: " .. (dp.bossesKilled or 0), dlgX + 200, ey + 38)
        end
    end

    -- Close hint
    love.graphics.setFont(fonts.chat or fonts.main)
    love.graphics.setColor(0.5, 0.5, 0.5, 0.6)
    love.graphics.printf("Press ESC or H to close", dlgX, dlgY + dlgH - 20, dlgW, "center")
end

-- =========================================================================
-- Karma HUD (small indicator, always visible)
-- =========================================================================
local function drawKarmaHUD(W, H)
    local zone = getZone()
    if not zone then return end
    local font = fonts.chat or fonts.main or _G.getFont(12)
    love.graphics.setFont(font)

    local x = 10
    local y = H - 40
    local barW = 100
    local barH = 8

    -- Karma label + value
    local kVal = game._karma.karma or 0
    local kColor
    if kVal > 20 then kColor = {0.3, 0.9, 0.4}
    elseif kVal < -20 then kColor = {0.9, 0.3, 0.3}
    else kColor = {0.7, 0.7, 0.7} end

    love.graphics.setColor(kColor[1], kColor[2], kColor[3], 0.9)
    love.graphics.print("Karma: " .. math.floor(kVal), x, y - 14)

    -- Bar background
    love.graphics.setColor(0.15, 0.15, 0.2, 0.7)
    love.graphics.rectangle("fill", x, y, barW, barH, 3, 3)

    -- Bar fill (centered at 50, positive goes right, negative goes left)
    local mid = barW / 2
    local fillW = math.abs(kVal) / 100 * mid
    if kVal > 0 then
        love.graphics.setColor(0.3, 0.8, 0.4, 0.8)
        love.graphics.rectangle("fill", x + mid, y, fillW, barH, 0, 3)
    elseif kVal < 0 then
        love.graphics.setColor(0.8, 0.3, 0.3, 0.8)
        love.graphics.rectangle("fill", x + mid - fillW, y, fillW, barH, 3, 0)
    end

    -- Center mark
    love.graphics.setColor(0.5, 0.5, 0.5, 0.5)
    love.graphics.rectangle("fill", x + mid - 1, y, 2, barH)

    -- Guard hostile warning
    if game._karma.isGuardHostile then
        love.graphics.setColor(1, 0.2, 0.2, 0.7 + math.sin(love.timer.getTime() * 4) * 0.3)
        love.graphics.print("HOSTILE", x + barW + 8, y - 4)
    end

    -- Bounty indicator
    if game._karma.activeBounty then
        love.graphics.setColor(1, 0.6, 0.1, 0.8)
        love.graphics.print("Bounty: " .. (game._karma.activeBounty.amount or 0) .. "g", x + barW + 8, y - 18)
    end
end

-- =========================================================================
-- Faction Rep Panel (/ key toggle)
-- =========================================================================
local function drawFactionPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local panelW = 360
    local panelH = 400
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    -- Background
    love.graphics.setColor(0.06, 0.06, 0.12, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.35, 0.30, 0.50, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    -- Title
    love.graphics.setFont(font)
    love.graphics.setColor(0.85, 0.80, 0.60, 1)
    love.graphics.printf("Faction Reputation", px, py + 10, panelW, "center")

    -- Faction list
    love.graphics.setFont(smallFont)
    local cy = py + 36
    if game._karma.factions and next(game._karma.factions) then
        for factionId, f in pairs(game._karma.factions) do
            if cy + 40 > py + panelH - 20 then break end
            -- Name + level
            love.graphics.setColor(0.9, 0.85, 0.7, 1)
            love.graphics.print((f.name or factionId), px + 12, cy)
            love.graphics.setColor(0.6, 0.7, 0.9, 0.9)
            love.graphics.print((f.levelName or "Neutral") .. " (Lv" .. (f.level or 0) .. ")", px + 12, cy + 16)

            -- Rep bar
            local barX = px + 200
            local barW = 140
            local barH = 10
            local pts = f.points or 0
            local maxPts = 1000  -- rough max per level
            local ratio = math.min(1, math.max(0, (pts % maxPts) / maxPts))
            love.graphics.setColor(0.15, 0.15, 0.2, 0.7)
            love.graphics.rectangle("fill", barX, cy + 8, barW, barH, 3, 3)
            love.graphics.setColor(0.3, 0.5, 0.9, 0.8)
            love.graphics.rectangle("fill", barX, cy + 8, barW * ratio, barH, 3, 3)
            love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
            love.graphics.rectangle("line", barX, cy + 8, barW, barH, 3, 3)

            -- Discount
            if f.discount and f.discount ~= 0 then
                local discText = string.format("%+d%%", math.floor(f.discount * 100))
                love.graphics.setColor(0.4, 0.9, 0.4, 0.8)
                love.graphics.print(discText, barX + barW + 6, cy + 6)
            end

            cy = cy + 38
        end
    else
        love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
        love.graphics.printf("No faction data yet", px, cy + 20, panelW, "center")
    end

    -- Close hint
    love.graphics.setColor(0.5, 0.5, 0.5, 0.5)
    love.graphics.printf("Press / or ESC to close", px, py + panelH - 18, panelW, "center")
end

-- =========================================================================
-- Companion Panel (U key)
-- =========================================================================
local function drawCompanionPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local panelW = 400
    local panelH = 420
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.06, 0.06, 0.10, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.30, 0.40, 0.50, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.85, 0.85, 0.70, 1)
    love.graphics.printf("Companions", px, py + 10, panelW, "center")

    love.graphics.setFont(smallFont)
    local cy = py + 36

    -- Available classes to hire
    local COMP_CLASSES = {"warrior", "ranger", "mage", "healer", "thief", "bard"}
    love.graphics.setColor(0.7, 0.7, 0.8, 0.8)
    love.graphics.print("Hire (click class):", px + 12, cy)
    cy = cy + 18
    for i, cls in ipairs(COMP_CLASSES) do
        local bx = px + 12 + (i - 1) * 62
        local mx, my = love.mouse.getPosition()
        local hover = mx >= bx and mx <= bx + 58 and my >= cy and my <= cy + 20
        love.graphics.setColor(hover and {0.3, 0.5, 0.7, 0.9} or {0.18, 0.20, 0.28, 0.8})
        love.graphics.rectangle("fill", bx, cy, 58, 20, 4, 4)
        love.graphics.setColor(0.8, 0.8, 0.9, 1)
        love.graphics.printf(cls:sub(1, 1):upper() .. cls:sub(2), bx, cy + 3, 58, "center")
    end
    cy = cy + 28

    -- Hired companions list
    love.graphics.setColor(0.6, 0.7, 0.8, 0.6)
    love.graphics.line(px + 12, cy, px + panelW - 12, cy)
    cy = cy + 6

    if #game._companions.companions == 0 then
        love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
        love.graphics.printf("No companions hired", px, cy + 10, panelW, "center")
    else
        for _, c in ipairs(game._companions.companions) do
            if cy + 50 > py + panelH - 30 then break end
            love.graphics.setColor(0.12, 0.14, 0.20, 0.8)
            love.graphics.rectangle("fill", px + 10, cy, panelW - 20, 46, 4, 4)

            love.graphics.setColor(0.9, 0.85, 0.7, 1)
            love.graphics.print((c.name or "???") .. "  Lv" .. (c.level or 1), px + 16, cy + 4)
            love.graphics.setColor(0.6, 0.7, 0.8, 0.9)
            love.graphics.print(c.class or "?", px + 16, cy + 20)

            -- HP bar
            local barX = px + 150
            local barW = 80
            local hp = c.hp or 0
            local maxHp = c.maxHp or 1
            love.graphics.setColor(0.15, 0.15, 0.2, 0.7)
            love.graphics.rectangle("fill", barX, cy + 22, barW, 8, 3, 3)
            love.graphics.setColor(0.3, 0.8, 0.3, 0.8)
            love.graphics.rectangle("fill", barX, cy + 22, barW * (hp / maxHp), 8, 3, 3)

            -- Wage + dismiss button
            love.graphics.setColor(0.8, 0.7, 0.4, 0.7)
            love.graphics.print("Wage: " .. (c.dailyWage or 0) .. "g/day", px + 250, cy + 4)

            local dBx = px + panelW - 70
            local mx, my = love.mouse.getPosition()
            local dHover = mx >= dBx and mx <= dBx + 50 and my >= cy + 20 and my <= cy + 38
            love.graphics.setColor(dHover and {0.7, 0.2, 0.2, 0.9} or {0.4, 0.15, 0.15, 0.7})
            love.graphics.rectangle("fill", dBx, cy + 20, 50, 18, 3, 3)
            love.graphics.setColor(0.9, 0.7, 0.7, 1)
            love.graphics.printf("Dismiss", dBx, cy + 22, 50, "center")

            cy = cy + 50
        end
    end

    -- Message
    if game._companions.messageTimer > 0 and game._companions.message then
        love.graphics.setColor(0.9, 0.9, 0.5, math.min(1, game._companions.messageTimer))
        love.graphics.printf(game._companions.message, px, py + panelH - 36, panelW, "center")
    end

    love.graphics.setColor(0.5, 0.5, 0.5, 0.5)
    love.graphics.printf("U to close", px, py + panelH - 18, panelW, "center")
end

-- =========================================================================
-- Pet Panel (O key)
-- =========================================================================
local function drawPetPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local panelW = 400
    local panelH = 420
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.06, 0.08, 0.06, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.30, 0.50, 0.30, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.70, 0.90, 0.70, 1)
    love.graphics.printf("Pets", px, py + 10, panelW, "center")

    love.graphics.setFont(smallFont)
    local cy = py + 36

    if #game._pets.pets == 0 then
        love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
        love.graphics.printf("No pets tamed. Find creatures in the wild!", px, cy + 20, panelW, "center")
    else
        for _, p in ipairs(game._pets.pets) do
            if cy + 65 > py + panelH - 30 then break end
            local isActive = (game._pets.activePetId == p.id)
            love.graphics.setColor(isActive and {0.15, 0.22, 0.15, 0.9} or {0.12, 0.14, 0.18, 0.8})
            love.graphics.rectangle("fill", px + 10, cy, panelW - 20, 58, 4, 4)
            if isActive then
                love.graphics.setColor(0.4, 0.8, 0.4, 0.5)
                love.graphics.setLineWidth(2)
                love.graphics.rectangle("line", px + 10, cy, panelW - 20, 58, 4, 4)
                love.graphics.setLineWidth(1)
            end

            -- Name + type + stage
            love.graphics.setColor(0.9, 0.9, 0.8, 1)
            love.graphics.print((p.name or p.type or "???") .. "  Lv" .. (p.level or 1), px + 16, cy + 4)
            love.graphics.setColor(0.6, 0.7, 0.8, 0.8)
            love.graphics.print("Stage: " .. (p.stage or 1) .. "  Speed: " .. (p.currentSpeed or p.speed or "?"), px + 16, cy + 20)

            -- Hunger bar
            local hungerPct = (p.hunger or 50) / 100
            love.graphics.setColor(0.5, 0.5, 0.6, 0.5)
            love.graphics.print("Hunger:", px + 16, cy + 36)
            love.graphics.setColor(0.15, 0.15, 0.2, 0.7)
            love.graphics.rectangle("fill", px + 80, cy + 38, 60, 8, 3, 3)
            love.graphics.setColor(0.8, 0.6, 0.2, 0.8)
            love.graphics.rectangle("fill", px + 80, cy + 38, 60 * hungerPct, 8, 3, 3)

            -- Happiness bar
            local happyPct = (p.happiness or 50) / 100
            love.graphics.setColor(0.5, 0.5, 0.6, 0.5)
            love.graphics.print("Happy:", px + 160, cy + 36)
            love.graphics.setColor(0.15, 0.15, 0.2, 0.7)
            love.graphics.rectangle("fill", px + 220, cy + 38, 60, 8, 3, 3)
            love.graphics.setColor(0.9, 0.4, 0.6, 0.8)
            love.graphics.rectangle("fill", px + 220, cy + 38, 60 * happyPct, 8, 3, 3)

            -- Feed + Set Active buttons
            local mx, my = love.mouse.getPosition()
            local feedX = px + panelW - 120
            local feedHover = mx >= feedX and mx <= feedX + 50 and my >= cy + 4 and my <= cy + 22
            love.graphics.setColor(feedHover and {0.3, 0.6, 0.3, 0.9} or {0.18, 0.28, 0.18, 0.7})
            love.graphics.rectangle("fill", feedX, cy + 4, 50, 18, 3, 3)
            love.graphics.setColor(0.8, 0.9, 0.8, 1)
            love.graphics.printf("Feed", feedX, cy + 6, 50, "center")

            local actX = px + panelW - 60
            local actHover = mx >= actX and mx <= actX + 46 and my >= cy + 4 and my <= cy + 22
            love.graphics.setColor(actHover and {0.3, 0.4, 0.7, 0.9} or {0.18, 0.18, 0.30, 0.7})
            love.graphics.rectangle("fill", actX, cy + 4, 46, 18, 3, 3)
            love.graphics.setColor(0.8, 0.8, 0.95, 1)
            love.graphics.printf(isActive and "Rest" or "Set", actX, cy + 6, 46, "center")

            cy = cy + 62
        end
    end

    if game._pets.messageTimer > 0 and game._pets.message then
        love.graphics.setColor(0.9, 0.9, 0.5, math.min(1, game._pets.messageTimer))
        love.graphics.printf(game._pets.message, px, py + panelH - 36, panelW, "center")
    end

    love.graphics.setColor(0.5, 0.5, 0.5, 0.5)
    love.graphics.printf("O to close", px, py + panelH - 18, panelW, "center")
end

-- =========================================================================
-- Jail Panel (auto-opens when jailed)
-- =========================================================================
local function drawJailPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local panelW = 340
    local panelH = 260
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    -- Dark overlay
    love.graphics.setColor(0, 0, 0, 0.5)
    love.graphics.rectangle("fill", 0, 0, W, H)

    love.graphics.setColor(0.08, 0.04, 0.04, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.50, 0.25, 0.25, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.9, 0.3, 0.3, 1)
    love.graphics.printf("JAILED", px, py + 12, panelW, "center")

    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.8, 0.7, 0.6, 1)
    love.graphics.printf("Crime: " .. (game._jail.crimeLabel or game._jail.crime or "Unknown"), px + 12, py + 44, panelW - 24, "center")

    -- Timer
    local elapsed = love.timer.getTime() - game._jail.lastUpdate
    local remaining = math.max(0, (game._jail.remainingMs or 0) / 1000 - elapsed)
    local mins = math.floor(remaining / 60)
    local secs = math.floor(remaining % 60)
    love.graphics.setColor(0.9, 0.8, 0.6, 1)
    love.graphics.printf("Time remaining: " .. string.format("%d:%02d", mins, secs), px, py + 72, panelW, "center")

    -- Bail button
    local mx, my = love.mouse.getPosition()
    local bailX = px + panelW / 2 - 80
    local bailY = py + 120
    local bailHover = mx >= bailX and mx <= bailX + 160 and my >= bailY and my <= bailY + 36
    love.graphics.setColor(bailHover and {0.5, 0.4, 0.15, 0.9} or {0.3, 0.25, 0.10, 0.8})
    love.graphics.rectangle("fill", bailX, bailY, 160, 36, 6, 6)
    love.graphics.setColor(0.9, 0.8, 0.5, 1)
    love.graphics.printf("Pay Bail: " .. (game._jail.bail or 0) .. "g", bailX, bailY + 8, 160, "center")

    -- Serve time button
    local serveY = bailY + 48
    local serveHover = mx >= bailX and mx <= bailX + 160 and my >= serveY and my <= serveY + 36
    love.graphics.setColor(serveHover and {0.3, 0.3, 0.4, 0.9} or {0.18, 0.18, 0.25, 0.8})
    love.graphics.rectangle("fill", bailX, serveY, 160, 36, 6, 6)
    love.graphics.setColor(0.7, 0.7, 0.8, 1)
    love.graphics.printf("Serve Time", bailX, serveY + 8, 160, "center")

    if game._jail.messageTimer > 0 and game._jail.message then
        love.graphics.setColor(0.9, 0.9, 0.5, math.min(1, game._jail.messageTimer))
        love.graphics.printf(game._jail.message, px, py + panelH - 30, panelW, "center")
    end
end

-- =========================================================================
-- Ascension Panel (; key)
-- =========================================================================
local function drawAscensionPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local tinyFont = fonts.small or _G.getFont(10)
    local panelW = 500
    local panelH = 450
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.04, 0.04, 0.10, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.40, 0.35, 0.60, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.80, 0.70, 1.00, 1)
    love.graphics.printf("Ascension", px, py + 10, panelW, "center")

    -- Stats bar
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.7, 0.7, 0.8, 0.9)
    love.graphics.printf("Ascensions: " .. (game._ascension.ascensionCount or 0) ..
        "   AP: " .. (game._ascension.ascensionPoints or 0), px, py + 32, panelW, "center")

    -- Ascend button (if eligible)
    if game._ascension.canAscend then
        local mx, my = love.mouse.getPosition()
        local bx = px + panelW / 2 - 60
        local by = py + 54
        local bHover = mx >= bx and mx <= bx + 120 and my >= by and my <= by + 28
        love.graphics.setColor(bHover and {0.6, 0.4, 0.9, 0.9} or {0.35, 0.25, 0.55, 0.8})
        love.graphics.rectangle("fill", bx, by, 120, 28, 6, 6)
        love.graphics.setColor(1, 0.9, 0.5, 1)
        love.graphics.printf("ASCEND", bx, by + 5, 120, "center")
    end

    -- Ascension tree
    local cy = py + 90
    love.graphics.setFont(smallFont)
    if game._ascension.tree then
        local nodeI = 0
        for nodeId, nodeData in pairs(game._ascension.tree) do
            if cy + 38 > py + panelH - 30 then break end
            nodeI = nodeI + 1
            local rank = (game._ascension.ascensionTree and game._ascension.ascensionTree[nodeId]) or 0
            local maxRank = nodeData.maxRank or 3
            local cost = nodeData.cost or 1

            local mx, my = love.mouse.getPosition()
            local nx = px + 12
            local nw = panelW - 24
            local nHover = mx >= nx and mx <= nx + nw and my >= cy and my <= cy + 34

            love.graphics.setColor(nHover and {0.18, 0.18, 0.30, 0.9} or {0.12, 0.12, 0.22, 0.8})
            love.graphics.rectangle("fill", nx, cy, nw, 34, 4, 4)

            -- Node name + rank
            local nameColor = rank >= maxRank and {0.5, 0.9, 0.5} or {0.8, 0.8, 0.9}
            love.graphics.setColor(nameColor[1], nameColor[2], nameColor[3], 1)
            love.graphics.print((nodeData.name or nodeId), nx + 8, cy + 2)

            love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
            love.graphics.print("Rank: " .. rank .. "/" .. maxRank .. "  Cost: " .. cost .. " AP", nx + 8, cy + 18)

            -- Description
            if nodeData.desc then
                love.graphics.setColor(0.5, 0.5, 0.6, 0.7)
                love.graphics.printf(nodeData.desc, nx + 200, cy + 4, nw - 210, "left")
            end

            -- Invest indicator
            if nHover and rank < maxRank and (game._ascension.ascensionPoints or 0) >= cost then
                love.graphics.setColor(0.9, 0.8, 0.3, 0.9)
                love.graphics.printf("Click to invest", nx, cy + 8, nw - 8, "right")
            end

            cy = cy + 38
        end
    else
        love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
        love.graphics.printf("Reach level 100 to unlock ascension", px, cy + 20, panelW, "center")
    end

    if game._ascension.messageTimer > 0 and game._ascension.message then
        love.graphics.setColor(0.9, 0.9, 0.5, math.min(1, game._ascension.messageTimer))
        love.graphics.printf(game._ascension.message, px, py + panelH - 36, panelW, "center")
    end

    love.graphics.setColor(0.5, 0.5, 0.5, 0.5)
    love.graphics.printf("; to close", px, py + panelH - 18, panelW, "center")
end

-- =========================================================================
-- Guild Panel (G key)
-- =========================================================================
local function drawGuildPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local panelW = 500
    local panelH = 460
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.06, 0.06, 0.08, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.35, 0.35, 0.50, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.80, 0.80, 0.90, 1)
    love.graphics.printf(game._guild.guildName and ("Guild: " .. game._guild.guildName) or "Guilds", px, py + 10, panelW, "center")

    -- Tabs
    love.graphics.setFont(smallFont)
    local tabs
    if game._guild.guildId then
        tabs = {"info", "members", "chat", "vault"}
    else
        tabs = {"browse", "create"}
    end

    local tabW = 70
    local tabStartX = px + 10
    local tabY = py + 34
    local mx, my = love.mouse.getPosition()
    for i, tab in ipairs(tabs) do
        local tx = tabStartX + (i - 1) * (tabW + 4)
        local isActive = (game._guild.tab == tab)
        local tHover = mx >= tx and mx <= tx + tabW and my >= tabY and my <= tabY + 22
        love.graphics.setColor(isActive and {0.25, 0.25, 0.40, 0.9} or tHover and {0.18, 0.18, 0.28, 0.8} or {0.12, 0.12, 0.18, 0.6})
        love.graphics.rectangle("fill", tx, tabY, tabW, 22, 4, 4)
        love.graphics.setColor(isActive and {1, 0.9, 0.6} or {0.7, 0.7, 0.8})
        love.graphics.printf(tab:sub(1,1):upper() .. tab:sub(2), tx, tabY + 3, tabW, "center")
    end

    local contentY = tabY + 28
    local contentH = panelH - (contentY - py) - 24

    if game._guild.tab == "browse" then
        -- Browse available guilds
        local cy = contentY
        if #game._guild.guildList == 0 then
            love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
            love.graphics.printf("No guilds found", px, cy + 20, panelW, "center")
        else
            for _, g in ipairs(game._guild.guildList) do
                if cy + 36 > contentY + contentH then break end
                local gHover = mx >= px + 10 and mx <= px + panelW - 10 and my >= cy and my <= cy + 32
                love.graphics.setColor(gHover and {0.18, 0.20, 0.30, 0.9} or {0.12, 0.14, 0.20, 0.7})
                love.graphics.rectangle("fill", px + 10, cy, panelW - 20, 32, 4, 4)
                love.graphics.setColor(0.9, 0.85, 0.7, 1)
                love.graphics.print(g.name or "???", px + 16, cy + 2)
                love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
                love.graphics.print("Leader: " .. (g.leaderName or "?") .. "  " .. (g.memberCount or 0) .. "/" .. (g.maxMembers or 50), px + 16, cy + 16)
                if gHover then
                    love.graphics.setColor(0.4, 0.8, 0.4, 0.9)
                    love.graphics.printf("Click to join", px + 10, cy + 8, panelW - 26, "right")
                end
                cy = cy + 36
            end
        end

    elseif game._guild.tab == "create" then
        -- Create guild form
        love.graphics.setColor(0.7, 0.7, 0.8, 0.8)
        love.graphics.print("Guild Name:", px + 20, contentY + 10)
        love.graphics.setColor(0.12, 0.12, 0.20, 0.9)
        love.graphics.rectangle("fill", px + 20, contentY + 28, panelW - 40, 24, 4, 4)
        love.graphics.setColor(0.9, 0.9, 0.9, 1)
        love.graphics.print(game._guild.createName .. (game._guild.createActive and "_" or ""), px + 26, contentY + 32)

        local createBx = px + panelW / 2 - 50
        local createBy = contentY + 70
        local createHover = mx >= createBx and mx <= createBx + 100 and my >= createBy and my <= createBy + 28
        love.graphics.setColor(createHover and {0.3, 0.5, 0.3, 0.9} or {0.18, 0.28, 0.18, 0.8})
        love.graphics.rectangle("fill", createBx, createBy, 100, 28, 6, 6)
        love.graphics.setColor(0.9, 0.9, 0.7, 1)
        love.graphics.printf("Create", createBx, createBy + 5, 100, "center")

    elseif game._guild.tab == "members" or game._guild.tab == "info" then
        -- Member list
        local cy = contentY
        for _, m in ipairs(game._guild.members) do
            if cy + 22 > contentY + contentH then break end
            local roleColor = m.role == "leader" and {1, 0.85, 0.3} or m.role == "officer" and {0.5, 0.7, 1} or {0.7, 0.7, 0.7}
            love.graphics.setColor(roleColor[1], roleColor[2], roleColor[3], 1)
            love.graphics.print((m.name or "???") .. " [" .. (m.role or "member") .. "]", px + 20, cy)
            cy = cy + 20
        end
        if #game._guild.members == 0 then
            love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
            love.graphics.printf("No members loaded", px, contentY + 20, panelW, "center")
        end

        -- Leave button
        local lx = px + panelW - 80
        local ly = py + panelH - 40
        local lHover = mx >= lx and mx <= lx + 60 and my >= ly and my <= ly + 22
        love.graphics.setColor(lHover and {0.6, 0.2, 0.2, 0.9} or {0.3, 0.12, 0.12, 0.7})
        love.graphics.rectangle("fill", lx, ly, 60, 22, 4, 4)
        love.graphics.setColor(0.9, 0.6, 0.6, 1)
        love.graphics.printf("Leave", lx, ly + 3, 60, "center")

    elseif game._guild.tab == "chat" then
        -- Chat messages
        local cy = contentY
        for _, msg in ipairs(game._guild.messages) do
            if cy + 16 > contentY + contentH - 30 then break end
            love.graphics.setColor(0.6, 0.8, 1, 0.9)
            love.graphics.print(msg.authorName .. ": ", px + 16, cy)
            love.graphics.setColor(0.8, 0.8, 0.8, 1)
            love.graphics.print(msg.content, px + 16 + smallFont:getWidth(msg.authorName .. ": "), cy)
            cy = cy + 16
        end

        -- Chat input
        local inputY = contentY + contentH - 24
        love.graphics.setColor(0.12, 0.12, 0.18, 0.9)
        love.graphics.rectangle("fill", px + 14, inputY, panelW - 28, 22, 4, 4)
        love.graphics.setColor(0.8, 0.8, 0.8, 1)
        love.graphics.print(game._guild.chatInput .. (game._guild.chatActive and "_" or ""), px + 20, inputY + 3)

    elseif game._guild.tab == "vault" then
        -- Vault contents
        local cy = contentY
        if game._guild.vault then
            love.graphics.setColor(0.8, 0.75, 0.5, 0.9)
            love.graphics.print("Resources:", px + 16, cy)
            cy = cy + 18
            if game._guild.vault.resources then
                for resName, amount in pairs(game._guild.vault.resources) do
                    if cy + 14 > contentY + contentH then break end
                    love.graphics.setColor(0.7, 0.7, 0.7, 0.9)
                    love.graphics.print("  " .. resName .. ": " .. amount, px + 20, cy)
                    cy = cy + 14
                end
            end
            cy = cy + 8
            love.graphics.setColor(0.8, 0.75, 0.5, 0.9)
            love.graphics.print("Cards: " .. (#(game._guild.vault.cards or {})), px + 16, cy)
        else
            love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
            love.graphics.printf("Loading vault...", px, cy + 20, panelW, "center")
        end
    end

    if game._guild.messageTimer > 0 and game._guild.message then
        love.graphics.setColor(0.9, 0.9, 0.5, math.min(1, game._guild.messageTimer))
        love.graphics.printf(game._guild.message, px, py + panelH - 36, panelW, "center")
    end

    love.graphics.setColor(0.5, 0.5, 0.5, 0.5)
    love.graphics.printf("] to close", px, py + panelH - 18, panelW, "center")
end

-- =========================================================================
-- Crafting Minigame (timing bar)
-- =========================================================================
local function drawCraftingMinigame(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)

    -- Dark overlay
    love.graphics.setColor(0, 0, 0, 0.4)
    love.graphics.rectangle("fill", 0, 0, W, H)

    local barW = 400
    local barH = 30
    local panelW = barW + 40
    local panelH = 120
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.06, 0.06, 0.10, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.45, 0.35, 0.20, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.9, 0.8, 0.5, 1)
    love.graphics.printf("Crafting — Click in the sweet spot!", px, py + 8, panelW, "center")

    -- Bar background
    local bx = px + 20
    local by = py + 40
    love.graphics.setColor(0.15, 0.15, 0.2, 0.9)
    love.graphics.rectangle("fill", bx, by, barW, barH, 4, 4)

    -- Sweet spot zone (green)
    local zoneStart = (game._minigame.windowStart / 1000) * barW
    local zoneEnd = (game._minigame.windowEnd / 1000) * barW
    love.graphics.setColor(0.2, 0.6, 0.2, 0.5)
    love.graphics.rectangle("fill", bx + zoneStart, by, zoneEnd - zoneStart, barH)

    -- Perfect center (bright green line)
    local perfectPos = bx + (zoneStart + zoneEnd) / 2
    love.graphics.setColor(0.4, 1, 0.4, 0.7)
    love.graphics.rectangle("fill", perfectPos - 1, by, 2, barH)

    -- Moving indicator
    if not game._minigame.result then
        local indicatorX = bx + (game._minigame.barPos / 1000) * barW
        love.graphics.setColor(1, 0.9, 0.3, 1)
        love.graphics.rectangle("fill", indicatorX - 2, by - 4, 4, barH + 8, 2, 2)
    end

    -- Result text
    if game._minigame.result then
        local rColor
        if game._minigame.result == "perfect" then rColor = {0.3, 1, 0.3}
        elseif game._minigame.result == "good" then rColor = {0.7, 0.9, 0.3}
        else rColor = {0.9, 0.3, 0.3} end
        love.graphics.setFont(font)
        love.graphics.setColor(rColor[1], rColor[2], rColor[3], 1)
        love.graphics.printf(game._minigame.result:upper() .. "!", px, py + panelH - 34, panelW, "center")
    else
        love.graphics.setFont(smallFont)
        love.graphics.setColor(0.6, 0.6, 0.6, 0.7)
        love.graphics.printf("Click or press Space to strike!", px, py + panelH - 26, panelW, "center")
    end
end

-- =========================================================================
-- Patrol Units (overworld markers)
-- =========================================================================
local function drawPatrolUnits()
    local smallFont = fonts.small or _G.getFont(10)
    love.graphics.setFont(smallFont)
    for _, patrol in pairs(game._patrolUnits) do
        local px = patrol.x or 0
        local py = patrol.y or 0
        -- Shield icon (triangle + circle)
        love.graphics.setColor(0.3, 0.5, 0.8, 0.8)
        love.graphics.circle("fill", px, py, 8)
        love.graphics.setColor(0.5, 0.7, 1, 0.9)
        love.graphics.circle("line", px, py, 8)
        -- Label
        love.graphics.setColor(0.6, 0.7, 0.9, 0.8)
        love.graphics.printf(patrol.name or "Patrol", px - 30, py - 18, 60, "center")
    end
end

-- =========================================================================
-- Notifications (guard warnings, durability, dungeon events)
-- =========================================================================
local function drawNotifications(W, H)
    if #game._notifications == 0 then return end
    local font = fonts.chat or fonts.main or _G.getFont(12)
    love.graphics.setFont(font)
    local cy = 60
    for _, n in ipairs(game._notifications) do
        local alpha = math.min(1, n.timer / (n.maxTimer * 0.3))
        love.graphics.setColor(0, 0, 0, 0.6 * alpha)
        local tw = font:getWidth(n.text) + 20
        love.graphics.rectangle("fill", (W - tw) / 2, cy - 2, tw, 20, 4, 4)
        love.graphics.setColor(n.color[1], n.color[2], n.color[3], alpha)
        love.graphics.printf(n.text, 0, cy, W, "center")
        cy = cy + 24
    end
end

-- =========================================================================
-- Sync Panel (F11 — cross-server character sync)
-- =========================================================================
local function drawSyncPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local titleFont = fonts.header or _G.getFont(16)
    local panelW = 320
    local panelH = game._sync.confirm and 220 or 200
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.5)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.12, 0.12, 0.18, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.4, 0.5, 0.7, 0.6)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)

    -- Title
    love.graphics.setFont(titleFont)
    love.graphics.setColor(0.9, 0.9, 1)
    love.graphics.printf("Character Sync", px, py + 12, panelW, "center")

    -- Description
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.6, 0.65, 0.7)
    love.graphics.printf("Transfer character data between servers", px + 15, py + 40, panelW - 30, "center")

    if game._sync.confirm then
        -- Confirmation dialog
        love.graphics.setFont(font)
        love.graphics.setColor(1, 0.8, 0.3)
        love.graphics.printf("Warning", px, py + 75, panelW, "center")
        love.graphics.setFont(smallFont)
        love.graphics.setColor(0.8, 0.75, 0.65)
        love.graphics.printf("This will replace your character on this server with your saved data. Continue?", px + 20, py + 100, panelW - 40, "center")

        local btnW = 130
        local btnH = 32
        local yesX = px + panelW / 2 - btnW - 10
        local noX = px + panelW / 2 + 10
        local confirmY = py + panelH - 50

        -- Yes button
        love.graphics.setColor(0.7, 0.3, 0.3, 0.8)
        love.graphics.rectangle("fill", yesX, confirmY, btnW, btnH, 4, 4)
        love.graphics.setColor(1, 0.9, 0.9)
        love.graphics.setFont(font)
        love.graphics.printf("Yes, Load", yesX, confirmY + 8, btnW, "center")

        -- No button
        love.graphics.setColor(0.3, 0.3, 0.4, 0.8)
        love.graphics.rectangle("fill", noX, confirmY, btnW, btnH, 4, 4)
        love.graphics.setColor(0.8, 0.8, 0.9)
        love.graphics.printf("Cancel", noX, confirmY + 8, btnW, "center")
    else
        -- Two buttons: Save and Load
        local btnW = 130
        local btnH = 32
        local saveX = px + panelW / 2 - btnW - 10
        local loadX = px + panelW / 2 + 10
        local btnY = py + 100

        -- Save button
        love.graphics.setColor(0.2, 0.45, 0.3, 0.8)
        love.graphics.rectangle("fill", saveX, btnY, btnW, btnH, 4, 4)
        love.graphics.setColor(0.9, 1, 0.9)
        love.graphics.setFont(font)
        love.graphics.printf("Save Character", saveX, btnY + 8, btnW, "center")

        -- Load button
        love.graphics.setColor(0.3, 0.3, 0.55, 0.8)
        love.graphics.rectangle("fill", loadX, btnY, btnW, btnH, 4, 4)
        love.graphics.setColor(0.9, 0.9, 1)
        love.graphics.printf("Load Character", loadX, btnY + 8, btnW, "center")

        -- Status message
        if game._sync.status then
            love.graphics.setFont(smallFont)
            local statusY = btnY + btnH + 15
            if game._sync.status == "saving" then
                love.graphics.setColor(0.7, 0.7, 0.4)
                love.graphics.printf("Saving...", px, statusY, panelW, "center")
            elseif game._sync.status == "saved" then
                love.graphics.setColor(0.4, 0.9, 0.4)
                love.graphics.printf("Snapshot saved!", px, statusY, panelW, "center")
            elseif game._sync.status == "loading" then
                love.graphics.setColor(0.7, 0.7, 0.4)
                love.graphics.printf("Loading...", px, statusY, panelW, "center")
            elseif game._sync.status == "error" then
                love.graphics.setColor(1, 0.4, 0.4)
                love.graphics.printf(game._sync.error or "Sync failed", px, statusY, panelW, "center")
            end
        end
    end

    -- Close hint
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.4, 0.4, 0.5)
    love.graphics.printf("F11 or Escape to close", px, py + panelH - 20, panelW, "center")
end

local function drawAudioSettingsPanel(W, H)
    local font = fonts.ui or _G.getFont(14)
    local smallFont = fonts.chat or _G.getFont(12)
    local panelW = 360
    local panelH = 400
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    -- Background
    love.graphics.setColor(0.06, 0.06, 0.10, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.30, 0.40, 0.50, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    -- Title
    love.graphics.setFont(font)
    love.graphics.setColor(0.85, 0.85, 0.70, 1)
    love.graphics.printf("Settings", px, py + 10, panelW, "center")

    -- Audio section header
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.55, 0.65, 0.75, 0.8)
    love.graphics.print("AUDIO", px + 16, py + 36)
    love.graphics.setColor(0.25, 0.30, 0.40, 0.5)
    love.graphics.line(px + 60, py + 44, px + panelW - 16, py + 44)

    -- Sliders
    local categories = {"master", "music", "sfx", "ambient", "ui", "footsteps"}
    local labels = {master="Master", music="Music", sfx="SFX", ambient="Ambient", ui="UI", footsteps="Footsteps"}
    local sliderX = px + 130
    local sliderW = panelW - 160
    local cy = py + 52
    local vols = game._audio.getVolumes()

    for _, cat in ipairs(categories) do
        local v = vols[cat] or 0
        -- Label
        love.graphics.setColor(0.75, 0.75, 0.85, 1)
        love.graphics.print(labels[cat], px + 16, cy + 2)
        -- Track background
        love.graphics.setColor(0.15, 0.15, 0.22, 0.9)
        love.graphics.rectangle("fill", sliderX, cy + 6, sliderW, 10, 4, 4)
        -- Filled portion
        local fillW = sliderW * v
        if cat == "master" then
            love.graphics.setColor(0.55, 0.75, 0.90, 0.9)
        else
            love.graphics.setColor(0.40, 0.60, 0.75, 0.9)
        end
        love.graphics.rectangle("fill", sliderX, cy + 6, fillW, 10, 4, 4)
        -- Knob
        local knobX = sliderX + fillW
        love.graphics.setColor(0.90, 0.90, 0.95, 1)
        love.graphics.circle("fill", knobX, cy + 11, 7)
        love.graphics.setColor(0.50, 0.60, 0.70, 0.8)
        love.graphics.circle("line", knobX, cy + 11, 7)
        -- Percentage
        love.graphics.setColor(0.60, 0.60, 0.70, 0.9)
        love.graphics.printf(math.floor(v * 100) .. "%", sliderX + sliderW + 6, cy + 2, 40, "left")

        cy = cy + 34
    end

    -- Graphics section header
    cy = cy + 8
    love.graphics.setColor(0.55, 0.65, 0.75, 0.8)
    love.graphics.print("GRAPHICS", px + 16, cy)
    love.graphics.setColor(0.25, 0.30, 0.40, 0.5)
    love.graphics.line(px + 80, cy + 8, px + panelW - 16, cy + 8)
    cy = cy + 18

    -- Lighting quality toggle buttons
    love.graphics.setColor(0.75, 0.75, 0.85, 1)
    love.graphics.print("Lighting", px + 16, cy + 4)

    local currentQ = lighting.getQuality()
    local qualOpts = {"low", "medium", "high"}
    local qualLabels = {low = "Low", medium = "Medium", high = "High"}
    local mx, my = love.mouse.getPosition()
    local btnW = 70
    local btnSpacing = 8
    local btnX = sliderX
    game._settingsQualBtns = {}
    for qi, qk in ipairs(qualOpts) do
        local bx = btnX + (qi - 1) * (btnW + btnSpacing)
        local by = cy
        local bh = 26
        local isActive = (currentQ == qk)
        local isHover = mx >= bx and mx <= bx + btnW and my >= by and my <= by + bh

        if isActive then
            love.graphics.setColor(0.35, 0.55, 0.70, 0.95)
        elseif isHover then
            love.graphics.setColor(0.22, 0.32, 0.42, 0.85)
        else
            love.graphics.setColor(0.14, 0.18, 0.25, 0.8)
        end
        love.graphics.rectangle("fill", bx, by, btnW, bh, 4, 4)

        if isActive then
            love.graphics.setColor(0.50, 0.70, 0.85, 0.8)
        else
            love.graphics.setColor(0.30, 0.38, 0.48, 0.6)
        end
        love.graphics.rectangle("line", bx, by, btnW, bh, 4, 4)

        love.graphics.setColor(isActive and {1, 1, 1, 1} or {0.65, 0.65, 0.75, 0.9})
        love.graphics.printf(qualLabels[qk], bx, by + 5, btnW, "center")

        game._settingsQualBtns[qi] = { x = bx, y = by, w = btnW, h = bh, quality = qk }
    end

    -- Close button
    local closeY = py + panelH - 42
    local closeX = px + panelW / 2 - 50
    local hover = mx >= closeX and mx <= closeX + 100 and my >= closeY and my <= closeY + 30
    love.graphics.setColor(hover and {0.30, 0.45, 0.60, 0.9} or {0.18, 0.22, 0.30, 0.8})
    love.graphics.rectangle("fill", closeX, closeY, 100, 30, 5, 5)
    love.graphics.setColor(0.80, 0.80, 0.90, 1)
    love.graphics.printf("Close", closeX, closeY + 7, 100, "center")

    -- Hint
    love.graphics.setColor(0.45, 0.45, 0.55, 0.6)
    love.graphics.printf("F9 to toggle", px, py + panelH - 16, panelW, "center")
end

-- =========================================================================
-- VIP & Sovereign Panel (F4)
-- =========================================================================
local VIP_SHOP_CATS = { "all", "storage", "character", "cosmetic", "convenience" }
local VIP_SHOP_CAT_LABELS = {
    all = "All", storage = "Storage", character = "Chars",
    cosmetic = "Cosmetic", convenience = "Util",
}

local function drawVipPanel(W, H)
    local font  = fonts.ui or _G.getFont(14)
    local small = fonts.chat or _G.getFont(12)
    local tiny  = fonts.small or _G.getFont(10)
    local panelW = 560
    local panelH = 520
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.05, 0.06, 0.12, 0.97)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.60, 0.50, 0.20, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.90, 0.75, 0.30, 1)
    love.graphics.printf("VIP & Sovereign", px, py + 10, panelW, "center")
    love.graphics.setFont(tiny)
    love.graphics.setColor(0.45, 0.45, 0.55, 0.6)
    love.graphics.printf("F4 to close", px, py + 14, panelW - 12, "right")

    -- Tab buttons
    local tabY = py + 38
    local tabs = {
        { id = "status", label = "Status",         x = px + 16,  w = 110 },
        { id = "shop",   label = "Sovereign Shop", x = px + 132, w = 170 },
    }
    love.graphics.setFont(small)
    for _, tab in ipairs(tabs) do
        local active = (game._vip.tab == tab.id)
        love.graphics.setColor(active and {0.25, 0.20, 0.08, 0.9} or {0.12, 0.12, 0.16, 0.7})
        love.graphics.rectangle("fill", tab.x, tabY, tab.w, 24, 4, 4)
        love.graphics.setColor(active and {0.80, 0.65, 0.20, 0.8} or {0.40, 0.35, 0.20, 0.5})
        love.graphics.rectangle("line", tab.x, tabY, tab.w, 24, 4, 4)
        love.graphics.setColor(active and {1, 0.9, 0.6, 1} or {0.55, 0.50, 0.35, 0.8})
        love.graphics.printf(tab.label, tab.x, tabY + 4, tab.w, "center")
    end

    local contentY = tabY + 34
    local isVip = (game._vip.tier == "vip")

    if game._vip.tab == "status" then
        -- Tier badge
        love.graphics.setFont(font)
        if isVip then
            love.graphics.setColor(0.95, 0.80, 0.20, 1)
            love.graphics.print("* VIP", px + 16, contentY)
        else
            love.graphics.setColor(0.60, 0.60, 0.65, 1)
            love.graphics.print("FREE", px + 16, contentY)
        end

        -- Balance + tokens (right-aligned)
        love.graphics.setFont(small)
        love.graphics.setColor(0.70, 0.85, 0.55, 1)
        love.graphics.printf("SC: " .. (game._vip.sovereignBalance or 0), px, contentY, panelW - 16, "right")
        love.graphics.setColor(0.55, 0.65, 0.85, 1)
        love.graphics.printf("Tokens: " .. (game._vip.tokenInventory or 0), px, contentY + 18, panelW - 16, "right")

        -- Expiry / status line
        love.graphics.setFont(small)
        if isVip and (game._vip.expiresAt or 0) > 0 then
            local secsLeft = math.max(0, math.floor((game._vip.expiresAt / 1000) - os.time()))
            local daysLeft = math.floor(secsLeft / 86400)
            local hrsLeft  = math.floor((secsLeft % 86400) / 3600)
            love.graphics.setColor(0.75, 0.90, 0.55, 0.9)
            love.graphics.print("Expires: " .. daysLeft .. "d " .. hrsLeft .. "h", px + 16, contentY + 22)
        else
            love.graphics.setColor(0.55, 0.55, 0.60, 0.7)
            love.graphics.print("Subscribe to gain VIP access.", px + 16, contentY + 22)
        end

        -- Separator
        love.graphics.setColor(0.40, 0.35, 0.15, 0.4)
        love.graphics.rectangle("fill", px + 12, contentY + 46, panelW - 24, 1)

        -- Perks list
        love.graphics.setFont(small)
        love.graphics.setColor(0.70, 0.65, 0.45, 0.9)
        love.graphics.print("VIP Benefits:", px + 16, contentY + 54)

        local perks = {
            "+ 12% XP gain",
            "No portal cooldown",
            "Auction fee: 2%  (free: 5%)",
            "Max pets: 3  (free: 2)",
            "Max companions: 3  (free: 2)",
            "+ 3% card pull luck",
        }
        love.graphics.setFont(tiny)
        local ry = contentY + 72
        for _, perk in ipairs(perks) do
            love.graphics.setColor(isVip and {0.85, 0.85, 0.65, 1} or {0.45, 0.45, 0.50, 0.7})
            love.graphics.print("• " .. perk, px + 24, ry)
            ry = ry + 16
        end

        -- Use VIP Token button
        if (game._vip.tokenInventory or 0) > 0 and not isVip then
            local mx, my = love.mouse.getPosition()
            local bx = px + panelW / 2 - 80
            local by = ry + 18
            local hover = mx >= bx and mx <= bx + 160 and my >= by and my <= by + 32
            love.graphics.setColor(hover and {0.5, 0.40, 0.10, 0.9} or {0.30, 0.24, 0.07, 0.8})
            love.graphics.rectangle("fill", bx, by, 160, 32, 6, 6)
            love.graphics.setColor(0.85, 0.65, 0.15, 0.8)
            love.graphics.rectangle("line", bx, by, 160, 32, 6, 6)
            love.graphics.setFont(small)
            love.graphics.setColor(0.95, 0.80, 0.30, 1)
            love.graphics.printf("Use VIP Token", bx, by + 8, 160, "center")
        end

    else
        -- ---- SOVEREIGN SHOP TAB ----
        game._vip._shopBuyBtns = {}  -- reset each frame so stale rects can't be clicked
        local catW = math.floor((panelW - 32) / #VIP_SHOP_CATS)
        love.graphics.setFont(tiny)
        for ci, cat in ipairs(VIP_SHOP_CATS) do
            local cx = px + 16 + (ci - 1) * catW
            local active = (game._vip.shopCategoryFilter == cat)
            love.graphics.setColor(active and {0.22, 0.18, 0.06, 0.9} or {0.10, 0.10, 0.14, 0.7})
            love.graphics.rectangle("fill", cx, contentY, catW - 2, 22, 3, 3)
            love.graphics.setColor(active and {0.75, 0.60, 0.20, 0.7} or {0.30, 0.28, 0.18, 0.4})
            love.graphics.rectangle("line", cx, contentY, catW - 2, 22, 3, 3)
            love.graphics.setColor(active and {1, 0.9, 0.5, 1} or {0.50, 0.48, 0.38, 0.8})
            love.graphics.printf(VIP_SHOP_CAT_LABELS[cat], cx, contentY + 4, catW - 2, "center")
        end

        local listY   = contentY + 26
        local rowH    = 36
        local listEnd = py + panelH - 36

        if #game._vip.shopItems == 0 then
            love.graphics.setFont(small)
            love.graphics.setColor(0.5, 0.5, 0.55, 0.7)
            love.graphics.printf("Loading...", px, listY + 20, panelW, "center")
        else
            local filtered = {}
            for _, item in ipairs(game._vip.shopItems) do
                if game._vip.shopCategoryFilter == "all" or item.category == game._vip.shopCategoryFilter then
                    table.insert(filtered, item)
                end
            end
            if #filtered == 0 then
                love.graphics.setFont(small)
                love.graphics.setColor(0.5, 0.5, 0.55, 0.7)
                love.graphics.printf("No items in this category.", px, listY + 20, panelW, "center")
            else
                local scroll = math.max(0, math.min(game._vip.shopScroll, math.max(0, #filtered - 1)))
                game._vip.shopScroll = scroll
                game._vip._shopBuyBtns = {}

                local mx, my = love.mouse.getPosition()
                local cy = listY
                for ii = scroll + 1, #filtered do
                    if cy + rowH > listEnd then break end
                    local item   = filtered[ii]
                    local rowHov = mx >= px + 8 and mx <= px + panelW - 8 and my >= cy and my <= cy + rowH
                    love.graphics.setColor(rowHov and {0.14, 0.12, 0.06, 0.9} or {0.09, 0.09, 0.11, 0.7})
                    love.graphics.rectangle("fill", px + 8, cy, panelW - 16, rowH - 2, 3, 3)

                    -- Name
                    love.graphics.setFont(small)
                    if item.owned then
                        love.graphics.setColor(0.55, 0.80, 0.45, 1)
                    elseif item.locked then
                        love.graphics.setColor(0.50, 0.50, 0.55, 0.7)
                    else
                        love.graphics.setColor(0.90, 0.85, 0.65, 1)
                    end
                    love.graphics.print(item.name or "?", px + 14, cy + 3)

                    -- Description
                    love.graphics.setFont(tiny)
                    love.graphics.setColor(0.60, 0.58, 0.48, 0.8)
                    love.graphics.print(item.description or "", px + 14, cy + 19)

                    -- Cost
                    love.graphics.setColor(0.70, 0.85, 0.55, 0.9)
                    love.graphics.printf((item.cost or 0) .. " SC", px, cy + 3, panelW - 70, "right")

                    -- Status button
                    local bx  = px + panelW - 62
                    local by2 = cy + 7
                    if item.owned then
                        love.graphics.setColor(0.20, 0.35, 0.20, 0.7)
                        love.graphics.rectangle("fill", bx, by2, 50, 22, 3, 3)
                        love.graphics.setColor(0.50, 0.80, 0.45, 1)
                        love.graphics.printf("Owned", bx, by2 + 4, 50, "center")
                    elseif item.locked then
                        love.graphics.setColor(0.18, 0.18, 0.22, 0.7)
                        love.graphics.rectangle("fill", bx, by2, 50, 22, 3, 3)
                        love.graphics.setColor(0.40, 0.40, 0.45, 0.8)
                        love.graphics.printf("Locked", bx, by2 + 4, 50, "center")
                    else
                        local bhov = mx >= bx and mx <= bx + 50 and my >= by2 and my <= by2 + 22
                        love.graphics.setColor(bhov and {0.40, 0.32, 0.10, 0.9} or {0.25, 0.20, 0.06, 0.8})
                        love.graphics.rectangle("fill", bx, by2, 50, 22, 3, 3)
                        love.graphics.setColor(0.85, 0.70, 0.25, 1)
                        love.graphics.rectangle("line", bx, by2, 50, 22, 3, 3)
                        love.graphics.setColor(1, 0.90, 0.55, 1)
                        love.graphics.printf("Buy", bx, by2 + 4, 50, "center")
                        table.insert(game._vip._shopBuyBtns, { x = bx, y = by2, w = 50, h = 22, itemId = item.id })
                    end

                    cy = cy + rowH
                end

                if #filtered > math.floor((listEnd - listY) / rowH) then
                    love.graphics.setFont(tiny)
                    love.graphics.setColor(0.40, 0.40, 0.45, 0.5)
                    love.graphics.printf("Scroll to see more", px, py + panelH - 22, panelW - 8, "right")
                end
            end
        end
    end

    -- Message feedback
    if (game._vip.messageTimer or 0) > 0 and game._vip.message then
        love.graphics.setFont(small)
        love.graphics.setColor(0.90, 0.90, 0.55, math.min(1, game._vip.messageTimer))
        love.graphics.printf(game._vip.message, px, py + panelH - 22, panelW, "center")
    end
end

-- =========================================================================
-- Bounties Panel (F5)
-- =========================================================================
local function drawBountiesPanel(W, H)
    local font  = fonts.ui or _G.getFont(14)
    local small = fonts.chat or _G.getFont(12)
    local tiny  = fonts.small or _G.getFont(10)
    local panelW = 420
    local panelH = 360
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.08, 0.04, 0.04, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.70, 0.30, 0.20, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.90, 0.40, 0.25, 1)
    love.graphics.printf("Active Bounties", px, py + 10, panelW, "center")
    love.graphics.setFont(tiny)
    love.graphics.setColor(0.45, 0.45, 0.55, 0.6)
    love.graphics.printf("F5 to close", px, py + 14, panelW - 12, "right")

    local bounties = game._karma.bounties or {}
    if #bounties == 0 then
        love.graphics.setFont(small)
        love.graphics.setColor(0.5, 0.5, 0.55, 0.7)
        love.graphics.printf("No active bounties.", px, py + 90, panelW, "center")
    else
        -- Header row
        love.graphics.setFont(tiny)
        love.graphics.setColor(0.55, 0.40, 0.30, 0.8)
        love.graphics.print("Target", px + 16, py + 44)
        love.graphics.printf("Reward", px, py + 44, panelW - 16, "right")

        love.graphics.setColor(0.40, 0.25, 0.20, 0.4)
        love.graphics.rectangle("fill", px + 12, py + 58, panelW - 24, 1)

        local cy = py + 64
        love.graphics.setFont(small)
        for i, bounty in ipairs(bounties) do
            if cy + 34 > py + panelH - 28 then break end
            love.graphics.setColor((i % 2 == 0) and {0.10, 0.07, 0.05, 0.7} or {0.08, 0.05, 0.04, 0.5})
            love.graphics.rectangle("fill", px + 8, cy, panelW - 16, 32, 3, 3)

            love.graphics.setColor(0.90, 0.75, 0.55, 1)
            love.graphics.print(bounty.username or "Unknown", px + 14, cy + 4)

            love.graphics.setFont(tiny)
            love.graphics.setColor(0.60, 0.55, 0.45, 0.8)
            love.graphics.print(bounty.reason or "", px + 14, cy + 20)

            love.graphics.setFont(small)
            love.graphics.setColor(0.90, 0.70, 0.20, 1)
            love.graphics.printf((bounty.amount or 0) .. "g", px, cy + 8, panelW - 14, "right")

            cy = cy + 36
        end
    end

    if (game._karma.messageTimer or 0) > 0 and game._karma.message then
        love.graphics.setFont(small)
        love.graphics.setColor(0.9, 0.9, 0.5, math.min(1, game._karma.messageTimer))
        love.graphics.printf(game._karma.message, px, py + panelH - 22, panelW, "center")
    end

    love.graphics.setFont(tiny)
    love.graphics.setColor(0.45, 0.45, 0.55, 0.5)
    love.graphics.printf("F5 to close", px, py + panelH - 16, panelW, "center")
end

-- =========================================================================
-- Rumors Log Panel (F6)
-- =========================================================================
local function drawRumorsPanel(W, H)
    local font  = fonts.ui or _G.getFont(14)
    local small = fonts.chat or _G.getFont(12)
    local tiny  = fonts.small or _G.getFont(10)
    local panelW = 440
    local panelH = 400
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.07, 0.06, 0.04, 0.96)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.55, 0.48, 0.20, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.85, 0.75, 0.40, 1)
    love.graphics.printf("Rumor Log", px, py + 10, panelW, "center")
    love.graphics.setFont(tiny)
    love.graphics.setColor(0.45, 0.45, 0.55, 0.6)
    love.graphics.printf("F6 to close", px, py + 14, panelW - 12, "right")

    local rumors = game._rumors.list or {}
    if #rumors == 0 then
        love.graphics.setFont(small)
        love.graphics.setColor(0.5, 0.5, 0.55, 0.7)
        love.graphics.printf("No rumors recorded this session.\nVisit towns to hear rumors.", px + 20, py + 100, panelW - 40, "center")
    else
        local scroll    = game._rumors.scroll or 0
        local rowH      = 44
        local listStart = py + 42
        local listEnd   = py + panelH - 20
        local maxRows   = math.floor((listEnd - listStart) / rowH)

        scroll = math.max(0, math.min(scroll, math.max(0, #rumors - maxRows)))
        game._rumors.scroll = scroll

        love.graphics.setFont(small)
        local cy = listStart
        for i = #rumors - scroll, math.max(1, #rumors - scroll - maxRows + 1), -1 do
            if cy + rowH > listEnd then break end
            local rumor = rumors[i]
            love.graphics.setColor(0.10, 0.09, 0.06, 0.7)
            love.graphics.rectangle("fill", px + 8, cy, panelW - 16, rowH - 4, 3, 3)

            love.graphics.setFont(tiny)
            love.graphics.setColor(0.55, 0.50, 0.35, 0.8)
            local locStr = (rumor.zone or "?") .. "  " .. (rumor.time or "")
            love.graphics.print(locStr, px + 14, cy + 3)

            love.graphics.setFont(small)
            love.graphics.setColor(0.85, 0.80, 0.60, 1)
            love.graphics.printf(rumor.text or "", px + 14, cy + 17, panelW - 28, "left")

            cy = cy + rowH
        end

        if #rumors > maxRows then
            love.graphics.setFont(tiny)
            love.graphics.setColor(0.40, 0.40, 0.45, 0.5)
            love.graphics.printf("Scroll to navigate", px, py + panelH - 16, panelW - 8, "right")
        end
    end
end

-- =========================================================================
-- Environment Panel (F7: Weather + Ecology)
-- =========================================================================
local WEATHER_ICONS = {
    clear = "Clear", cloudy = "Cloudy", rain = "Rain", storm = "Storm",
    fog = "Fog", snow = "Snow", blizzard = "Blizzard", heatwave = "Heatwave",
    sandstorm = "Sandstorm", ash = "Ash Fall",
}
local ECOLOGY_STATE_NAMES = { [-1] = "Unknown", [0] = "Barren", [1] = "Sparse",
    [2] = "Recovering", [3] = "Balanced", [4] = "Thriving", [5] = "Abundant" }

local function drawEnvironmentPanel(W, H)
    local font  = fonts.ui or _G.getFont(14)
    local small = fonts.chat or _G.getFont(12)
    local tiny  = fonts.small or _G.getFont(10)
    local panelW = 380
    local panelH = 310
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.04, 0.08, 0.06, 0.96)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.25, 0.55, 0.35, 0.7)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    love.graphics.setFont(font)
    love.graphics.setColor(0.55, 0.85, 0.60, 1)
    love.graphics.printf("Environment", px, py + 10, panelW, "center")
    love.graphics.setFont(tiny)
    love.graphics.setColor(0.45, 0.45, 0.55, 0.6)
    love.graphics.printf("F7 to close", px, py + 14, panelW - 12, "right")

    -- === Weather section ===
    love.graphics.setFont(small)
    love.graphics.setColor(0.50, 0.75, 0.85, 0.9)
    love.graphics.print("Weather", px + 16, py + 40)

    local weather    = game._weather
    local weatherKey = weather.weather or "clear"
    local weatherLbl = WEATHER_ICONS[weatherKey] or weatherKey
    love.graphics.setFont(font)
    love.graphics.setColor(0.85, 0.90, 0.95, 1)
    love.graphics.print(weatherLbl, px + 16, py + 58)

    -- Intensity bar
    love.graphics.setFont(tiny)
    love.graphics.setColor(0.55, 0.55, 0.60, 0.8)
    love.graphics.print("Intensity:", px + 16, py + 80)
    local barX    = px + 90
    local barW    = panelW - 110
    local intPct  = math.max(0, math.min(1, weather.intensity or 0.5))
    love.graphics.setColor(0.15, 0.18, 0.22, 0.8)
    love.graphics.rectangle("fill", barX, py + 81, barW, 10, 3, 3)
    local intCol  = intPct < 0.4 and {0.3, 0.7, 0.9} or intPct < 0.75 and {0.8, 0.7, 0.2} or {0.9, 0.3, 0.2}
    love.graphics.setColor(intCol[1], intCol[2], intCol[3], 0.85)
    love.graphics.rectangle("fill", barX, py + 81, barW * intPct, 10, 3, 3)
    love.graphics.setColor(0.50, 0.55, 0.60, 0.5)
    love.graphics.printf(math.floor(intPct * 100) .. "%", barX, py + 78, barW, "right")

    -- Wind
    love.graphics.setColor(0.55, 0.55, 0.60, 0.8)
    love.graphics.print("Wind: " .. (weather.wind or "calm"), px + 16, py + 96)

    -- Biome (if available)
    if weather.biome then
        love.graphics.setColor(0.50, 0.60, 0.55, 0.7)
        love.graphics.print("Biome: " .. weather.biome, px + 16, py + 112)
    end

    -- Separator
    love.graphics.setColor(0.25, 0.45, 0.30, 0.4)
    love.graphics.rectangle("fill", px + 12, py + 130, panelW - 24, 1)

    -- === Ecology section ===
    love.graphics.setFont(small)
    love.graphics.setColor(0.45, 0.80, 0.50, 0.9)
    love.graphics.print("Ecology", px + 16, py + 140)

    local eco     = game._ecology
    local ecState = eco.state or -1
    local ecName  = eco.name or "Unknown"
    local stateLbl = ECOLOGY_STATE_NAMES[ecState] or ("Level " .. ecState)

    love.graphics.setFont(font)
    love.graphics.setColor(0.75, 0.90, 0.65, 1)
    love.graphics.print(ecName, px + 16, py + 158)

    love.graphics.setFont(small)
    love.graphics.setColor(0.60, 0.70, 0.60, 0.9)
    love.graphics.print("State: " .. stateLbl, px + 16, py + 180)

    -- Resource bonus bar
    local bonus   = eco.resourceBonus or 1.0
    local bonusPct = math.max(0, math.min(2, bonus))
    love.graphics.setFont(tiny)
    love.graphics.setColor(0.55, 0.55, 0.60, 0.8)
    love.graphics.print("Resource:", px + 16, py + 200)
    love.graphics.setColor(0.15, 0.20, 0.15, 0.8)
    love.graphics.rectangle("fill", px + 90, py + 201, panelW - 110, 10, 3, 3)
    local bCol = bonusPct >= 1.0 and {0.35, 0.75, 0.40} or {0.75, 0.40, 0.25}
    love.graphics.setColor(bCol[1], bCol[2], bCol[3], 0.85)
    love.graphics.rectangle("fill", px + 90, py + 201, (panelW - 110) * math.min(1, bonusPct), 10, 3, 3)
    local bonusLabel = bonus >= 1.0 and ("+" .. math.floor((bonus - 1) * 100) .. "%") or ("-" .. math.floor((1 - bonus) * 100) .. "%")
    love.graphics.setColor(0.70, 0.80, 0.60, 0.9)
    love.graphics.printf(bonusLabel, px + 90, py + 198, panelW - 110, "right")

    love.graphics.setFont(tiny)
    love.graphics.setColor(0.45, 0.45, 0.55, 0.5)
    love.graphics.printf("F7 to close", px, py + panelH - 16, panelW, "center")
end

-- =========================================================================
-- Quest Log Panel (J key)
-- =========================================================================
local function drawQuestLog(W, H)
    local ql = game._questLog
    if not ql then return end

    local panelW = 420
    local panelH = math.min(H - 60, 520)
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    love.graphics.setColor(0.05, 0.06, 0.12, 0.96)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.40, 0.35, 0.60, 0.75)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    -- Title
    love.graphics.setFont(fonts.bold or fonts.ui or love.graphics.getFont())
    love.graphics.setColor(0.90, 0.80, 0.40, 1)
    love.graphics.printf("Quest Log", px, py + 10, panelW, "center")

    local font      = fonts.main or love.graphics.getFont()
    local smallFont = fonts.small or fonts.chat or love.graphics.getFont()
    local cy = py + 36
    local mx, my = love.mouse.getPosition()
    local activeList  = ql.active   or {}
    local completedList = ql.completed or {}

    -- Active quests
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.70, 0.75, 0.90, 0.8)
    love.graphics.print("Active (" .. #activeList .. ")", px + 14, cy)
    cy = cy + 18

    if #activeList == 0 then
        love.graphics.setFont(smallFont)
        love.graphics.setColor(0.45, 0.45, 0.55, 0.6)
        love.graphics.print("  No active quests.", px + 14, cy)
        cy = cy + 18
    else
        for _, q in ipairs(activeList) do
            if cy + 58 > py + panelH - 30 then break end
            -- Quest name
            love.graphics.setFont(font)
            love.graphics.setColor(0.90, 0.88, 0.70, 1)
            love.graphics.print(q.name or q.questId, px + 14, cy)
            cy = cy + 18
            -- Description (truncated)
            if q.description and q.description ~= "" then
                love.graphics.setFont(smallFont)
                love.graphics.setColor(0.60, 0.60, 0.70, 0.75)
                love.graphics.printf(q.description, px + 18, cy, panelW - 50, "left")
                cy = cy + 14
            end
            -- Progress bar
            local progress    = q.progress    or 0
            local targetCount = q.targetCount or 1
            local ratio       = math.min(1, math.max(0, progress / targetCount))
            local barX = px + 18
            local barW = panelW - 80
            love.graphics.setColor(0.12, 0.12, 0.18, 0.8)
            love.graphics.rectangle("fill", barX, cy + 1, barW, 9, 3, 3)
            local barColor = ratio >= 1 and {0.3, 0.9, 0.3} or {0.3, 0.55, 0.9}
            love.graphics.setColor(barColor[1], barColor[2], barColor[3], 0.85)
            love.graphics.rectangle("fill", barX, cy + 1, barW * ratio, 9, 3, 3)
            love.graphics.setColor(0.4, 0.4, 0.55, 0.5)
            love.graphics.rectangle("line", barX, cy + 1, barW, 9, 3, 3)
            -- Progress label
            love.graphics.setFont(smallFont)
            love.graphics.setColor(0.70, 0.80, 0.70, 1)
            love.graphics.print(progress .. "/" .. targetCount, barX + barW + 4, cy)
            cy = cy + 16

            -- Separator
            love.graphics.setColor(0.25, 0.25, 0.35, 0.5)
            love.graphics.line(px + 14, cy, px + panelW - 14, cy)
            cy = cy + 6
        end
    end

    -- Completed count
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.45, 0.75, 0.45, 0.75)
    love.graphics.print("Completed: " .. #completedList, px + 14, py + panelH - 26)

    -- Close hint
    love.graphics.setColor(0.40, 0.40, 0.50, 0.5)
    love.graphics.printf("J or ESC to close", px, py + panelH - 16, panelW, "center")
end

-- =========================================================================
-- Quest Tracker HUD (always visible when quests are active)
-- =========================================================================
local function drawQuestTrackerHUD(W, H)
    local ql = game._questLog
    if not ql or not ql.active or #ql.active == 0 then return end

    -- Show only the first active quest as a compact indicator (top-right)
    local q       = ql.active[1]
    local progress    = q.progress    or 0
    local targetCount = q.targetCount or 1
    local ratio       = math.min(1, math.max(0, progress / targetCount))

    local boxW = 220
    local boxH = 36
    local bx   = W - boxW - 10
    local by   = 10

    love.graphics.setColor(0.04, 0.04, 0.10, 0.82)
    love.graphics.rectangle("fill", bx, by, boxW, boxH, 5, 5)
    love.graphics.setColor(0.35, 0.30, 0.55, 0.65)
    love.graphics.setLineWidth(1)
    love.graphics.rectangle("line", bx, by, boxW, boxH, 5, 5)

    local font = fonts.small or fonts.chat or love.graphics.getFont()
    love.graphics.setFont(font)
    love.graphics.setColor(0.85, 0.80, 0.50, 1)
    love.graphics.printf(q.name or q.questId, bx + 4, by + 4, boxW - 8, "left")

    -- Progress bar
    local barX = bx + 4
    local barW = boxW - 8
    love.graphics.setColor(0.10, 0.10, 0.16, 0.8)
    love.graphics.rectangle("fill", barX, by + 22, barW, 7, 2, 2)
    local barColor = ratio >= 1 and {0.3, 0.9, 0.3} or {0.4, 0.6, 0.95}
    love.graphics.setColor(barColor[1], barColor[2], barColor[3], 0.85)
    love.graphics.rectangle("fill", barX, by + 22, barW * ratio, 7, 2, 2)

    -- Progress text (right side)
    love.graphics.setColor(0.65, 0.75, 0.65, 0.9)
    love.graphics.printf(progress .. "/" .. targetCount, bx, by + 19, boxW - 4, "right")

    -- More indicator
    if #ql.active > 1 then
        love.graphics.setColor(0.50, 0.50, 0.60, 0.6)
        love.graphics.printf("+" .. (#ql.active - 1) .. " more  (J)", bx, by + boxH + 1, boxW, "right")
    else
        love.graphics.setColor(0.40, 0.40, 0.50, 0.45)
        love.graphics.printf("J for quest log", bx, by + boxH + 1, boxW, "right")
    end
end

function social.init(gameRef, ctx)
    game      = gameRef
    fonts     = ctx.fonts
    ui        = ctx.ui
    knowledge = ctx.knowledge
    getClient = ctx.getClient
    getZone   = ctx.getZone
    -- Register all functions onto the game table
    gameRef.drawFarmingPanel = drawFarmingPanel
    gameRef._drawCropsTab   = _drawCropsTab
    gameRef._drawAnimalsTab = _drawAnimalsTab
    gameRef._drawBuildTab   = _drawBuildTab
    gameRef.handleFarmingClick = handleFarmingClick
    gameRef.drawKnowledgePanel = drawKnowledgePanel
    gameRef.drawKnowledgeGlossary = drawKnowledgeGlossary
    gameRef.drawKnowledgeLore = drawKnowledgeLore
    gameRef.drawKnowledgeBooks = drawKnowledgeBooks
    gameRef.drawKnowledgeCodex = drawKnowledgeCodex
    gameRef.drawKnowledgeNotifications = drawKnowledgeNotifications
    gameRef.handleKnowledgeClick = handleKnowledgeClick
    gameRef.drawBleedoutOverlay = drawBleedoutOverlay
    gameRef.drawPermaDeathScreen = drawPermaDeathScreen
    gameRef.drawHallOfHeroes = drawHallOfHeroes
    gameRef.drawKarmaHUD = drawKarmaHUD
    gameRef.drawFactionPanel = drawFactionPanel
    gameRef.drawCompanionPanel = drawCompanionPanel
    gameRef.drawPetPanel = drawPetPanel
    gameRef.drawJailPanel = drawJailPanel
    gameRef.drawAscensionPanel = drawAscensionPanel
    gameRef.drawGuildPanel = drawGuildPanel
    gameRef.drawCraftingMinigame = drawCraftingMinigame
    gameRef.drawPatrolUnits = drawPatrolUnits
    gameRef.drawNotifications = drawNotifications
    gameRef.drawSyncPanel = drawSyncPanel
    gameRef.drawAudioSettingsPanel = drawAudioSettingsPanel
    gameRef.drawVipPanel           = drawVipPanel
    gameRef.drawBountiesPanel      = drawBountiesPanel
    gameRef.drawRumorsPanel        = drawRumorsPanel
    gameRef.drawEnvironmentPanel   = drawEnvironmentPanel
    gameRef.drawQuestLog           = drawQuestLog
    gameRef.drawQuestTrackerHUD    = drawQuestTrackerHUD
end

return social
