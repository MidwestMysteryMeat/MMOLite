-- scenes/game-draw/cards.lua
-- Character sheet, card collection, mastery, and auction house draw functions.

local cards = {}

local _g          -- game table ref
local fonts, rpg, ui, mastery  -- set by init from ctx
local getAccount  -- getter function for reassignable 'account' local
local getSkills   -- getter function for reassignable 'skills' local

-- Private state (was file-scope in game.lua)
local RARITY_COLORS = {
    common = {0.53, 0.53, 0.53},
    uncommon = {0.13, 0.8, 0.13},
    rare = {0.2, 0.53, 1},
    ultra_rare = {0.67, 0.27, 1},
    mythic_rare = {1, 0.67, 0},
    legendary = {1, 0.4, 0},
    godly = {1, 0, 0},
    relic = {1, 1, 1},
}

local RARITY_ORDER = { common=1, uncommon=2, rare=3, ultra_rare=4, mythic_rare=5, legendary=6, godly=7, relic=8 }

local statAllocButtons = {}
local cardGridRects = {}
local cardGridCards = {}
local cardCollectionRect = {}
local _hoveredCardData = nil

function cards.getStatAllocButtons() return statAllocButtons end
function cards.getCardGridRects()    return cardGridRects    end
function cards.getCardGridCards()    return cardGridCards    end

-- Private helpers (verbatim from game.lua)
local function getCardEquipSlot(card)
    if not card or not card.instanceId then return nil end
    for i = 1, #rpg.equippedCards do
        if rpg.equippedCards[i] == card.instanceId then return i end
    end
    return nil
end

function cards.getCardEquipSlot(card) return getCardEquipSlot(card) end

local function getFirstEmptySlot()
    for i = 1, (rpg.cardSlots or 4) do
        if not rpg.equippedCards[i] then return i end
    end
    return nil
end

local function findCardByInstanceId(instanceId)
    for _, c in ipairs(rpg.cards) do
        if c.instanceId == instanceId then return c end
    end
    return nil
end

local function getFilteredCards()
    local cards = {}
    for _, card in ipairs(rpg.cards) do
        local pass = true
        if ui.cardFilter == "equipped" then
            pass = getCardEquipSlot(card) ~= nil
        elseif ui.cardFilter == "stat_boost" then
            pass = card.type == "stat_boost"
        elseif ui.cardFilter == "passive" then
            pass = card.type == "passive_perk" or card.type == "racial_feat"
        elseif ui.cardFilter == "active_ability" then
            pass = card.type == "active_ability"
        end
        if pass then table.insert(cards, card) end
    end

    -- Sort
    if ui.cardSort == "name" then
        table.sort(cards, function(a, b) return (a.name or "") < (b.name or "") end)
    elseif ui.cardSort == "type" then
        table.sort(cards, function(a, b)
            if a.type == b.type then return (a.name or "") < (b.name or "") end
            return (a.type or "") < (b.type or "")
        end)
    else -- rarity (default)
        table.sort(cards, function(a, b)
            local ra = RARITY_ORDER[a.rarity] or 0
            local rb = RARITY_ORDER[b.rarity] or 0
            if ra == rb then return (a.name or "") < (b.name or "") end
            return ra > rb
        end)
    end
    return cards
end

local function drawCharSheet(W, H)
    -- Clear mastery button hitboxes (rebuilt each frame)
    ui._masteryButtons = {}

    -- Full character sheet overlay
    local pw = math.min(650, W - 40)
    local ph = math.min(550, H - 60)
    local px = (W - pw) / 2
    local py = (H - ph) / 2

    -- Background
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", 0, 0, W, H)
    love.graphics.setColor(0.08, 0.09, 0.14, 0.95)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    love.graphics.setColor(0.4, 0.35, 0.6, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.9, 0.8, 0.3, 1)
    love.graphics.printf("Character Sheet", px, py + 10, pw, "center")

    -- Race + Level
    love.graphics.setFont(fonts.ui)
    local raceName = rpg.race and (rpg.race:sub(1,1):upper() .. rpg.race:sub(2)) or "Unknown"
    love.graphics.setColor(0.8, 0.75, 0.6, 1)
    love.graphics.printf(raceName .. "  |  Level " .. rpg.level, px, py + 40, pw, "center")

    -- XP bar
    local barW = pw - 40
    local barH = 12
    local barX = px + 20
    local barY = py + 65
    love.graphics.setColor(0.15, 0.15, 0.2, 1)
    love.graphics.rectangle("fill", barX, barY, barW, barH, 3, 3)
    local xpFill = rpg.xpNeeded > 0 and math.min(1, rpg.xp / rpg.xpNeeded) or 0
    love.graphics.setColor(0.3, 0.7, 1, 0.9)
    love.graphics.rectangle("fill", barX, barY, barW * xpFill, barH, 3, 3)
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(1, 1, 1, 0.8)
    love.graphics.printf("XP: " .. rpg.xp .. " / " .. rpg.xpNeeded, barX, barY - 1, barW, "center")

    -- Stats (left column)
    local statY = py + 90
    local statX = px + 20
    local colW = (pw - 40) / 2

    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.7, 0.8, 1, 1)
    love.graphics.print("Primary Stats", statX, statY)
    statY = statY + 25

    local STAT_LABELS = {
        { key = "vigor",     name = "Vigor",     abbr = "VIG", color = {0.9, 0.4, 0.4}, desc = "Increases HP pool, base armor, and HP regeneration" },
        { key = "might",     name = "Might",     abbr = "MGT", color = {0.9, 0.6, 0.3}, desc = "Increases melee and physical damage" },
        { key = "finesse",   name = "Finesse",   abbr = "FIN", color = {0.3, 0.9, 0.5}, desc = "Increases critical hit chance and dodge chance" },
        { key = "acumen",    name = "Acumen",    abbr = "ACU", color = {0.4, 0.6, 1.0}, desc = "Increases magic power and mana pool" },
        { key = "resolve",   name = "Resolve",   abbr = "RES", color = {0.8, 0.5, 0.9}, desc = "Increases magic resistance and HP regeneration" },
        { key = "presence",  name = "Presence",  abbr = "PRE", color = {1.0, 0.85, 0.3}, desc = "Improves trade prices, NPC favor, and luck" },
        { key = "ingenuity", name = "Ingenuity", abbr = "ING", color = {0.5, 0.9, 0.9}, desc = "Improves crafting quality and trap detection" },
    }

    love.graphics.setFont(fonts.main)
    statAllocButtons = {}  -- clear each frame
    local hoveredStatDesc = nil
    if rpg.stats then
        local fp = rpg.stats.freePoints or 0
        local btnSize = 20
        local mx, my = love.mouse.getPosition()

        for _, stat in ipairs(STAT_LABELS) do
            local val = rpg.stats[stat.key] or 5
            local labelW = 110
            local rowH = 18

            -- Hover detection over stat label area
            if mx >= statX and mx < statX + labelW and my >= statY and my < statY + rowH then
                hoveredStatDesc = stat.desc
            end

            love.graphics.setColor(stat.color[1], stat.color[2], stat.color[3], 0.9)
            love.graphics.print(stat.name, statX, statY)
            love.graphics.setColor(1, 1, 1, 1)
            love.graphics.print(tostring(val), statX + 110, statY)

            -- Draw [+] button when free points are available
            if fp > 0 then
                local btnX = statX + 140
                local btnY = statY - 1
                local hovered = mx >= btnX and mx < btnX + btnSize and my >= btnY and my < btnY + btnSize

                -- Button background
                if hovered then
                    love.graphics.setColor(0.3, 0.8, 0.3, 0.9)
                else
                    love.graphics.setColor(0.2, 0.55, 0.2, 0.8)
                end
                love.graphics.rectangle("fill", btnX, btnY, btnSize, btnSize, 3, 3)

                -- Button border
                if hovered then
                    love.graphics.setColor(0.5, 1.0, 0.5, 1)
                else
                    love.graphics.setColor(0.3, 0.7, 0.3, 0.6)
                end
                love.graphics.setLineWidth(1)
                love.graphics.rectangle("line", btnX, btnY, btnSize, btnSize, 3, 3)

                -- "+" text centered in button
                love.graphics.setColor(1, 1, 1, 1)
                love.graphics.printf("+", btnX, btnY + 2, btnSize, "center")

                -- Store hit rect for click handling
                statAllocButtons[#statAllocButtons + 1] = {
                    key = stat.key,
                    x = btnX, y = btnY, w = btnSize, h = btnSize,
                }
            end

            statY = statY + 20
        end

        -- Free points display
        if fp > 0 then
            statY = statY + 5
            love.graphics.setColor(1, 0.85, 0.2, 1)
            love.graphics.print("Free Points: " .. fp, statX, statY)
            statY = statY + 20
        end
    end

    -- Stat tooltip (drawn after all stats so it renders on top)
    if hoveredStatDesc then
        local mx, my = love.mouse.getPosition()
        love.graphics.setFont(fonts.main)
        local ttW = fonts.main:getWidth(hoveredStatDesc) + 16
        local ttH = 24
        local ttX = mx + 12
        local ttY = my - ttH - 4
        -- Keep tooltip on screen
        local sw = love.graphics.getWidth()
        if ttX + ttW > sw then ttX = sw - ttW - 4 end
        if ttY < 0 then ttY = my + 16 end
        love.graphics.setColor(0.08, 0.08, 0.12, 0.92)
        love.graphics.rectangle("fill", ttX, ttY, ttW, ttH, 4, 4)
        love.graphics.setColor(0.5, 0.6, 0.8, 0.7)
        love.graphics.setLineWidth(1)
        love.graphics.rectangle("line", ttX, ttY, ttW, ttH, 4, 4)
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.print(hoveredStatDesc, ttX + 8, ttY + 5)
    end

    -- Computed stats (if available)
    if rpg.computedStats then
        statY = statY + 10
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.7, 0.8, 1, 1)
        love.graphics.print("Derived Stats", statX, statY)
        statY = statY + 25
        love.graphics.setFont(fonts.main)

        local derived = {
            { label = "HP", value = rpg.computedStats.hp },
            { label = "Crit Chance", value = rpg.computedStats.critChance and string.format("%.1f%%", rpg.computedStats.critChance * 100) },
            { label = "Dodge", value = rpg.computedStats.dodgeChance and string.format("%.1f%%", rpg.computedStats.dodgeChance * 100) },
            { label = "Magic Resist", value = rpg.computedStats.magicResist and string.format("%.1f%%", rpg.computedStats.magicResist * 100) },
            { label = "XP Bonus", value = rpg.computedStats.xpBonus and string.format("%.0f%%", (rpg.computedStats.xpBonus - 1) * 100) },
        }
        for _, d in ipairs(derived) do
            if d.value then
                love.graphics.setColor(0.7, 0.7, 0.8, 0.9)
                love.graphics.print(d.label .. ": ", statX, statY)
                love.graphics.setColor(1, 1, 1, 1)
                love.graphics.print(tostring(d.value), statX + 120, statY)
                statY = statY + 18
            end
        end
    end

    -- Skills (right column)
    local skillX = px + 20 + colW
    local skillY = py + 90

    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.7, 0.8, 1, 1)
    love.graphics.print("Skills", skillX, skillY)
    skillY = skillY + 25

    love.graphics.setFont(fonts.main)
    local skills = getSkills()
    if skills then
        -- Sort skills by level descending
        local skillList = {}
        for sName, sData in pairs(skills) do
            table.insert(skillList, { name = sName, level = sData.level or 1, xp = sData.xp or 0 })
        end
        table.sort(skillList, function(a, b) return a.level > b.level end)

        local SKILL_COLORS = {
            mining = {0.6, 0.7, 0.9}, woodcutting = {0.5, 0.8, 0.5},
            farming = {0.4, 0.8, 0.3}, fishing = {0.3, 0.6, 0.9},
            cooking = {0.9, 0.6, 0.3}, glassworking = {0.6, 0.8, 1.0},
            crafting = {0.8, 0.7, 0.5}, cogworking = {0.7, 0.7, 0.8},
            magic = {0.6, 0.4, 1.0}, melee = {0.9, 0.4, 0.4},
        }

        for _, s in ipairs(skillList) do
            -- Skip sub-skills below level 2 to avoid clutter
            local isSub = s.name:find("_") ~= nil
            if not isSub or s.level > 1 then
                local displayName = s.name:gsub("_", " ")
                displayName = displayName:sub(1,1):upper() .. displayName:sub(2)
                local baseSkill = s.name:match("^([^_]+)")
                local col = SKILL_COLORS[baseSkill] or {0.6, 0.6, 0.7}

                love.graphics.setColor(col[1], col[2], col[3], 0.9)
                love.graphics.print(displayName, skillX, skillY)
                love.graphics.setColor(1, 1, 1, 1)
                love.graphics.print("Lv." .. s.level, skillX + 150, skillY)

                -- Mini XP bar
                local xpNeeded = 100 * s.level
                local fill = xpNeeded > 0 and math.min(1, s.xp / xpNeeded) or 0
                love.graphics.setColor(0.2, 0.2, 0.3, 0.8)
                love.graphics.rectangle("fill", skillX + 200, skillY + 3, 80, 10, 2, 2)
                love.graphics.setColor(col[1], col[2], col[3], 0.7)
                love.graphics.rectangle("fill", skillX + 200, skillY + 3, 80 * fill, 10, 2, 2)

                -- [M] mastery button
                local mbx = skillX + 290
                local mby = skillY
                local mbw, mbh = 20, 16
                local mx, my = love.mouse.getPosition()
                local mHover = mx >= mbx and mx < mbx + mbw and my >= mby and my < mby + mbh
                love.graphics.setColor(0.3, 0.5, 0.7, mHover and 1.0 or 0.6)
                love.graphics.rectangle("fill", mbx, mby, mbw, mbh, 3, 3)
                love.graphics.setColor(1, 1, 1, mHover and 1.0 or 0.8)
                love.graphics.print("M", mbx + 5, mby + 1)

                -- Store button hitbox for click detection
                if not ui._masteryButtons then ui._masteryButtons = {} end
                table.insert(ui._masteryButtons, { x = mbx, y = mby, w = mbw, h = mbh, skill = s.name })

                skillY = skillY + 18
                if skillY > py + ph - 30 then break end
            end
        end
    end

    -- Equipped cards section (bottom)
    local cardY = py + ph - 80
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.7, 0.8, 1, 1)
    love.graphics.print("Equipped Cards (" .. rpg.cardSlots .. " slots)", px + 20, cardY)
    cardY = cardY + 22

    love.graphics.setFont(fonts.small)
    local slotW = 70
    ui._charSheetSlots = {}
    for i = 1, 8 do
        local sx = px + 20 + (i - 1) * (slotW + 5)
        local mx, my = love.mouse.getPosition()
        local hovered = mx >= sx and mx < sx + slotW and my >= cardY and my < cardY + 30
        if i <= rpg.cardSlots then
            love.graphics.setColor(0.15, 0.18, 0.25, hovered and 0.95 or 0.9)
            love.graphics.rectangle("fill", sx, cardY, slotW, 30, 3, 3)
            if rpg.equippedCards[i] then
                -- Find the card to show its name
                local card = findCardByInstanceId(rpg.equippedCards[i])
                local cardName = card and card.name or "Card"
                local rc = card and RARITY_COLORS[card.rarity] or {0.8, 0.7, 0.3}
                -- Truncate name if too long
                if fonts.small:getWidth(cardName) > slotW - 4 then
                    while #cardName > 3 and fonts.small:getWidth(cardName .. "..") > slotW - 4 do
                        cardName = cardName:sub(1, -2)
                    end
                    cardName = cardName .. ".."
                end
                love.graphics.setColor(rc[1], rc[2], rc[3], 1)
                love.graphics.printf(cardName, sx, cardY + 8, slotW, "center")
                ui._charSheetSlots[i] = { x = sx, y = cardY, w = slotW, h = 30, instanceId = rpg.equippedCards[i] }
            else
                love.graphics.setColor(0.4, 0.4, 0.5, 0.6)
                love.graphics.printf("Empty", sx, cardY + 8, slotW, "center")
            end
            love.graphics.setColor(hovered and 0.6 or 0.4, hovered and 0.6 or 0.4, hovered and 0.7 or 0.5, hovered and 0.8 or 0.5)
            love.graphics.rectangle("line", sx, cardY, slotW, 30, 3, 3)
        else
            love.graphics.setColor(0.1, 0.1, 0.12, 0.5)
            love.graphics.rectangle("fill", sx, cardY, slotW, 30, 3, 3)
            love.graphics.setColor(0.2, 0.2, 0.25, 0.4)
            love.graphics.printf("Locked", sx, cardY + 8, slotW, "center")
        end
    end

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("[C] or [ESC] to close", px, py + ph - 18, pw, "center")
end

local function drawCardTooltip(card, W, H)
    if not card then return end
    local mx, my = love.mouse.getPosition()

    -- Build tooltip lines
    local lines = {}
    local colors = {}

    local function addLine(text, r, g, b, a)
        table.insert(lines, text)
        table.insert(colors, {r or 0.8, g or 0.8, b or 0.8, a or 1})
    end

    -- Header: name + rarity
    local rc = RARITY_COLORS[card.rarity] or {0.7, 0.7, 0.7}
    addLine(card.name or "?", rc[1], rc[2], rc[3])
    local rarLabel = (card.rarity or "?"):gsub("_", " ")
    local typeLabel = (card.type or "?"):gsub("_", " ")
    addLine(rarLabel .. " | " .. typeLabel, 0.6, 0.6, 0.7)

    -- Archetype
    if card.archetype then
        addLine("Archetype: " .. card.archetype:gsub("_", " "), 0.5, 0.7, 0.5)
    end

    addLine("", 0.3, 0.3, 0.3) -- separator

    -- Active ability stats
    if card.type == "active_ability" then
        -- Resource cost
        local costStr = nil
        if card.manaCost and card.manaCost > 0 then
            costStr = card.manaCost .. " Mana"
        elseif card.bloodlustCost and card.bloodlustCost > 0 then
            costStr = card.bloodlustCost .. " Bloodlust"
        elseif card.focusCost and card.focusCost > 0 then
            costStr = card.focusCost .. " Focus"
        elseif card.staminaCost and card.staminaCost > 0 then
            costStr = card.staminaCost .. " Stamina"
        elseif card.resourceType then
            local resName = card.resourceType:sub(1,1):upper() .. card.resourceType:sub(2)
            local cost = card.manaCost or card.bloodlustCost or card.focusCost or card.staminaCost or 0
            if cost > 0 then
                costStr = cost .. " " .. resName
            else
                costStr = resName
            end
        end
        if costStr then addLine("Cost: " .. costStr, 0.3, 0.7, 1) end

        -- Range
        if card.range then
            local rangeStr = card.range == 0 and "Self" or (card.range == 1 and "Melee (1)" or tostring(card.range) .. " tiles")
            addLine("Range: " .. rangeStr, 0.8, 0.8, 0.5)
        end

        -- Target
        if card.targetType then
            local targetStr = card.targetType:gsub("_", " ")
            targetStr = targetStr:sub(1,1):upper() .. targetStr:sub(2)
            addLine("Target: " .. targetStr, 0.7, 0.7, 0.8)
        end

        -- Cooldown
        if card.cooldown and card.cooldown > 0 then
            addLine("Cooldown: " .. card.cooldown .. " turns", 0.8, 0.6, 0.4)
        end

        -- AOE
        if card.aoeRadius and card.aoeRadius > 0 then
            addLine("AoE Radius: " .. card.aoeRadius, 1, 0.6, 0.3)
        end

        addLine("", 0.3, 0.3, 0.3) -- separator

        -- Damage
        if card.baseDamage and card.baseDamage > 0 then
            local dmgStr = tostring(card.baseDamage)
            if card.element then dmgStr = dmgStr .. " " .. card.element end
            dmgStr = dmgStr .. " damage"
            addLine(dmgStr, 1, 0.4, 0.3)
        end

        -- Healing
        if card.baseHeal and card.baseHeal > 0 then
            addLine(card.baseHeal .. " healing", 0.3, 1, 0.4)
        end

        -- Scaling
        if card.scalingStat and card.scalingFactor then
            local pct = math.floor(card.scalingFactor * 100)
            addLine("+" .. pct .. "% " .. card.scalingStat .. " scaling", 0.6, 0.8, 1)
        end

        -- Status effect
        if card.statusEffect then
            local dur = card.statusDuration and (" (" .. card.statusDuration .. " turns)") or ""
            addLine("Applies: " .. card.statusEffect:gsub("_", " ") .. dur, 1, 0.7, 0.3)
        end

        -- Tile effect
        if card.onHitTile or card.tileEffect then
            local tile = card.onHitTile or card.tileEffect
            addLine("Creates: " .. tile .. " tile", 0.7, 0.5, 1)
        end

    -- Passive perk / stat boost stats
    else
        if card.effects then
            for _, eff in ipairs(card.effects) do
                if type(eff) == "table" then
                    local effType = (eff.type or ""):gsub("_", " ")
                    if eff.value then
                        local valStr
                        if type(eff.value) == "number" and eff.value < 1 and eff.value > 0 then
                            valStr = "+" .. math.floor(eff.value * 100) .. "%"
                        else
                            valStr = "+" .. tostring(eff.value)
                        end
                        local detail = valStr .. " " .. effType
                        if eff.stat then detail = valStr .. " " .. eff.stat end
                        if eff.skill then detail = valStr .. " " .. eff.skill .. " XP" end
                        if eff.element then detail = detail .. " (" .. eff.element .. ")" end
                        addLine(detail, 0.5, 0.9, 0.6)
                    elseif eff.description then
                        addLine(eff.description, 0.5, 0.9, 0.6)
                    else
                        addLine(effType, 0.5, 0.9, 0.6)
                    end
                end
            end
        end

        -- Combat passive
        if card.combatPassive and type(card.combatPassive) == "table" then
            local cp = card.combatPassive
            local cpType = (cp.type or ""):gsub("_", " ")
            if cp.value then
                addLine("Combat: +" .. tostring(cp.value) .. " " .. cpType, 0.6, 0.7, 1)
            else
                addLine("Combat: " .. cpType, 0.6, 0.7, 1)
            end
        end
    end

    -- Description
    if card.description and card.description ~= "" then
        addLine("", 0.3, 0.3, 0.3)
        addLine(card.description, 0.7, 0.7, 0.7)
    end

    -- Tags
    if card.tags and #card.tags > 0 then
        local tagStr = table.concat(card.tags, ", ")
        addLine("Tags: " .. tagStr, 0.4, 0.4, 0.5)
    end

    -- Calculate tooltip size
    love.graphics.setFont(fonts.small)
    local lineH = 15
    local tooltipW = 220
    local tooltipH = #lines * lineH + 12
    local tx = mx + 16
    local ty = my - 10

    -- Keep on screen
    if tx + tooltipW > W - 4 then tx = mx - tooltipW - 8 end
    if ty + tooltipH > H - 4 then ty = H - tooltipH - 4 end
    if ty < 4 then ty = 4 end

    -- Draw background
    love.graphics.setColor(0.06, 0.06, 0.1, 0.95)
    love.graphics.rectangle("fill", tx, ty, tooltipW, tooltipH, 4, 4)
    love.graphics.setColor(0.4, 0.4, 0.5, 0.7)
    love.graphics.setLineWidth(1)
    love.graphics.rectangle("line", tx, ty, tooltipW, tooltipH, 4, 4)

    -- Draw lines
    for i, line in ipairs(lines) do
        local c = colors[i]
        love.graphics.setColor(c[1], c[2], c[3], c[4])
        love.graphics.printf(line, tx + 6, ty + 4 + (i - 1) * lineH, tooltipW - 12, "left")
    end
end

local function drawMasteryPanel(W, H)
    local pw = math.min(520, W - 40)
    local ph = math.min(480, H - 60)
    local px = (W - pw) / 2
    local py = (H - ph) / 2

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.08, 0.08, 0.12, 0.95)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    love.graphics.setColor(0.3, 0.4, 0.6, 0.8)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title
    love.graphics.setFont(fonts.ui)
    local skillLabel = mastery.skillName or "?"
    skillLabel = skillLabel:gsub("_", " ")
    skillLabel = skillLabel:sub(1,1):upper() .. skillLabel:sub(2)
    love.graphics.setColor(0.8, 0.9, 1, 1)
    love.graphics.printf(skillLabel .. " Mastery", px, py + 8, pw, "center")

    -- Points + skill level
    love.graphics.setFont(fonts.main)
    love.graphics.setColor(0.6, 0.8, 1, 0.9)
    love.graphics.print("Skill Lv." .. mastery.skillLevel .. "  |  Points: " .. mastery.points, px + 15, py + 32)

    -- Reset button
    local rbx, rby, rbw, rbh = px + pw - 80, py + 30, 65, 20
    local mx, my = love.mouse.getPosition()
    local rbHover = mx >= rbx and mx < rbx + rbw and my >= rby and my < rby + rbh
    love.graphics.setColor(0.6, 0.2, 0.2, rbHover and 0.9 or 0.5)
    love.graphics.rectangle("fill", rbx, rby, rbw, rbh, 4, 4)
    love.graphics.setColor(1, 1, 1, rbHover and 1 or 0.7)
    love.graphics.print("Reset", rbx + 12, rby + 2)
    ui._masteryResetBtn = { x = rbx, y = rby, w = rbw, h = rbh }

    -- Feedback message
    if mastery.message and mastery.messageTimer > 0 then
        love.graphics.setColor(1, 0.85, 0.2, math.min(1, mastery.messageTimer))
        love.graphics.printf(mastery.message, px + 10, py + ph - 22, pw - 20, "center")
    end

    if not mastery.tree then
        love.graphics.setColor(0.6, 0.6, 0.6, 0.8)
        love.graphics.printf("Loading...", px, py + ph / 2, pw, "center")
        return
    end

    -- Draw node grid (5 cols x 7 rows)
    local gridX = px + 30
    local gridY = py + 60
    local cellW = (pw - 60) / 5
    local cellH = (ph - 110) / 7
    local nodeR = math.min(cellW, cellH) * 0.3

    -- Branch colors
    local BRANCH_COLORS = {
        [-1] = {0.5, 0.6, 0.7},  -- root/foundation: gray
        [0]  = {0.9, 0.3, 0.3},  -- branch 0: red
        [1]  = {0.3, 0.5, 0.9},  -- branch 1: blue
        [2]  = {0.3, 0.8, 0.4},  -- branch 2: green
        [3]  = {1.0, 0.8, 0.2},  -- branch 3: gold
    }

    -- Build lookup for prerequisite lines
    local nodeById = {}
    for _, node in ipairs(mastery.tree) do
        nodeById[node.id] = node
    end

    -- Draw prerequisite lines first
    love.graphics.setLineWidth(2)
    for _, node in ipairs(mastery.tree) do
        local nx = gridX + node.x * cellW + cellW / 2
        local ny = gridY + node.y * cellH + cellH / 2
        if node.requires then
            for _, reqId in ipairs(node.requires) do
                local reqNode = nodeById[reqId]
                if reqNode then
                    local rx = gridX + reqNode.x * cellW + cellW / 2
                    local ry = gridY + reqNode.y * cellH + cellH / 2
                    local invested = (mastery.invested[reqId] or 0) >= 1
                    love.graphics.setColor(0.3, 0.4, 0.5, invested and 0.7 or 0.3)
                    love.graphics.line(rx, ry, nx, ny)
                end
            end
        end
    end
    love.graphics.setLineWidth(1)

    -- Draw nodes
    ui._masteryNodeHitboxes = {}
    mastery.hoverNode = nil
    for _, node in ipairs(mastery.tree) do
        local nx = gridX + node.x * cellW + cellW / 2
        local ny = gridY + node.y * cellH + cellH / 2
        local rank = mastery.invested[node.id] or 0
        local maxed = rank >= node.maxRank
        local available = rank < node.maxRank and mastery.points >= 1
        -- Check prereqs met
        if available and node.requires then
            for _, reqId in ipairs(node.requires) do
                if (mastery.invested[reqId] or 0) < 1 then
                    available = false
                    break
                end
            end
        end

        local col = BRANCH_COLORS[node.branch] or BRANCH_COLORS[-1]
        local hovered = (mx - nx)^2 + (my - ny)^2 < nodeR^2

        if hovered then mastery.hoverNode = node end

        -- Node circle
        if maxed then
            love.graphics.setColor(1, 0.85, 0.2, 0.95)
        elseif rank > 0 then
            love.graphics.setColor(col[1], col[2], col[3], 0.9)
        elseif available then
            love.graphics.setColor(col[1] * 0.6, col[2] * 0.6, col[3] * 0.6, 0.7)
        else
            love.graphics.setColor(0.25, 0.25, 0.3, 0.5)
        end
        love.graphics.circle("fill", nx, ny, nodeR)

        -- Border
        if hovered then
            love.graphics.setColor(1, 1, 1, 0.9)
        elseif maxed then
            love.graphics.setColor(1, 0.85, 0.2, 0.7)
        else
            love.graphics.setColor(0.4, 0.5, 0.6, 0.5)
        end
        love.graphics.circle("line", nx, ny, nodeR)

        -- Rank text inside node
        love.graphics.setFont(fonts.small)
        if rank > 0 or maxed then
            love.graphics.setColor(1, 1, 1, 1)
        else
            love.graphics.setColor(0.6, 0.6, 0.6, 0.6)
        end
        local rankText = rank .. "/" .. node.maxRank
        local tw = fonts.small:getWidth(rankText)
        love.graphics.print(rankText, nx - tw / 2, ny - 5)

        table.insert(ui._masteryNodeHitboxes, { x = nx, y = ny, r = nodeR, node = node })
    end

    -- Tooltip for hovered node
    if mastery.hoverNode then
        local node = mastery.hoverNode
        local rank = mastery.invested[node.id] or 0
        love.graphics.setFont(fonts.main)
        local ttW = 220
        local ttH = 70
        local ttX = math.min(mx + 15, W - ttW - 5)
        local ttY = math.min(my + 15, H - ttH - 5)
        love.graphics.setColor(0.05, 0.05, 0.1, 0.95)
        love.graphics.rectangle("fill", ttX, ttY, ttW, ttH, 4, 4)
        love.graphics.setColor(0.4, 0.5, 0.7, 0.8)
        love.graphics.rectangle("line", ttX, ttY, ttW, ttH, 4, 4)
        love.graphics.setColor(1, 0.9, 0.7, 1)
        love.graphics.print(node.name, ttX + 6, ttY + 4)
        love.graphics.setColor(0.7, 0.8, 0.9, 0.9)
        love.graphics.setFont(fonts.small)
        love.graphics.printf(node.desc, ttX + 6, ttY + 22, ttW - 12, "left")
        love.graphics.setColor(0.5, 0.7, 1, 0.8)
        love.graphics.print("Rank: " .. rank .. "/" .. node.maxRank, ttX + 6, ttY + 50)
    end

    -- ESC hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.print("[ESC] Close  |  Click node to invest", px + 10, py + ph - 18)
end

local function drawCardVendorTab(px, py, pw, ph)
    local mx, my = love.mouse.getPosition()

    -- Buy/Sell sub-tabs
    local subTabY = py
    local subTabW = math.floor((pw - 20) / 2)
    ui._vendorSubTabs = {}
    love.graphics.setFont(fonts.hud)

    for ti, tname in ipairs({"buy", "sell"}) do
        local tx = px + 10 + (ti - 1) * subTabW
        local active = (_g._cardVendor.tab == tname)
        if active then
            love.graphics.setColor(0.15, 0.3, 0.2, 0.95)
        else
            love.graphics.setColor(0.08, 0.1, 0.14, 0.7)
        end
        love.graphics.rectangle("fill", tx, subTabY, subTabW - 2, 20, 3, 3)
        love.graphics.setColor(active and 0.9 or 0.5, active and 0.9 or 0.5, active and 0.5 or 0.3, 1)
        love.graphics.printf(tname:sub(1,1):upper() .. tname:sub(2), tx, subTabY + 2, subTabW - 2, "center")
        ui._vendorSubTabs[ti] = { x = tx, y = subTabY, w = subTabW - 2, h = 20, tab = tname }
    end

    -- Coins display
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(1, 0.85, 0.2, 0.9)
    love.graphics.printf("Coins: " .. (getAccount() and getAccount().coins or 0), px + 10, py + ph - 6, pw - 20, "right")

    local filterH = 0
    if _g._cardVendor.tab == "buy" then
        -- ── Filter row: Type filter (All / Active / Passive / Stats) ──
        local typeFilterY = subTabY + 24
        local typeNames = {"all", "active", "passive", "stat"}
        local typeLabels = {all = "All", active = "Active", passive = "Passive", stat = "Stats"}
        local typeBtnW = math.floor((pw - 20) / #typeNames)
        ui._vendorTypeFilters = {}
        for ti, tkey in ipairs(typeNames) do
            local tx = px + 10 + (ti - 1) * typeBtnW
            local active = (_g._cardVendor.filterType == tkey)
            if active then
                love.graphics.setColor(0.2, 0.35, 0.5, 0.95)
            else
                love.graphics.setColor(0.1, 0.12, 0.16, 0.7)
            end
            love.graphics.rectangle("fill", tx, typeFilterY, typeBtnW - 2, 18, 3, 3)
            love.graphics.setColor(active and 1 or 0.5, active and 0.9 or 0.5, active and 0.7 or 0.4, 1)
            love.graphics.printf(typeLabels[tkey], tx, typeFilterY + 2, typeBtnW - 2, "center")
            ui._vendorTypeFilters[ti] = { x = tx, y = typeFilterY, w = typeBtnW - 2, h = 18, filter = tkey }
        end

        -- ── Filter row: Archetype filter (scrollable chips) ──
        local archFilterY = typeFilterY + 20
        -- Collect unique archetypes from catalog
        local archSet = {}
        local archOrder = {}
        for _, item in ipairs(_g._cardVendor.catalog) do
            local a = item.archetype or "utility"
            if not archSet[a] then
                archSet[a] = true
                table.insert(archOrder, a)
            end
        end
        table.sort(archOrder)

        local archNames = {"all"}
        for _, a in ipairs(archOrder) do table.insert(archNames, a) end
        local archLabels = {
            all = "All", melee_dps = "Melee", tank = "Tank", pure_defense = "Defense",
            support = "Support", glass_cannon = "Mage", assassin = "Assassin",
            scout = "Scout", cc_dot = "CC/DoT", night_hunter = "Hunter",
            grappler = "Grappler", aquatic = "Aquatic", utility = "Utility",
        }

        ui._vendorArchFilters = {}
        local ax = px + 10
        for ai, akey in ipairs(archNames) do
            local label = archLabels[akey] or akey:gsub("_", " ")
            local lblW = fonts.small:getWidth(label) + 12
            local active = (_g._cardVendor.filterArch == akey)
            if active then
                love.graphics.setColor(0.25, 0.4, 0.3, 0.95)
            else
                love.graphics.setColor(0.1, 0.12, 0.16, 0.7)
            end
            love.graphics.rectangle("fill", ax, archFilterY, lblW, 18, 3, 3)
            love.graphics.setColor(active and 0.7 or 0.4, active and 1 or 0.55, active and 0.7 or 0.4, 1)
            love.graphics.printf(label, ax, archFilterY + 2, lblW, "center")
            ui._vendorArchFilters[ai] = { x = ax, y = archFilterY, w = lblW, h = 18, filter = akey }
            ax = ax + lblW + 2
        end
        filterH = 44
    end

    local listY = subTabY + 26 + filterH
    local listH = ph - 36 - filterH
    local itemH = 32

    love.graphics.setScissor(px + 4, listY, pw - 8, listH)
    ui._vendorItemBtns = {}

    if _g._cardVendor.tab == "buy" then
        -- Filter catalog
        local filtered = {}
        for _, item in ipairs(_g._cardVendor.catalog) do
            local passArch = (_g._cardVendor.filterArch == "all") or (item.archetype == _g._cardVendor.filterArch)
            local passType = true
            if _g._cardVendor.filterType == "active" then
                passType = (item.type == "active_ability")
            elseif _g._cardVendor.filterType == "passive" then
                passType = (item.type == "passive_perk")
            elseif _g._cardVendor.filterType == "stat" then
                passType = (item.type == "stat_boost" or item.type == "skill_boost")
            end
            if passArch and passType then
                table.insert(filtered, item)
            end
        end

        if #_g._cardVendor.catalog == 0 then
            love.graphics.setFont(fonts.ui)
            love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
            love.graphics.printf("Loading catalog...", px, listY + 30, pw, "center")
        elseif #filtered == 0 then
            love.graphics.setFont(fonts.ui)
            love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
            love.graphics.printf("No cards match filters.", px, listY + 30, pw, "center")
        else
            love.graphics.setFont(fonts.small)
            for i, item in ipairs(filtered) do
                local iy = listY + (i - 1) * itemH - _g._cardVendor.scroll
                if iy + itemH >= listY and iy < listY + listH then
                    local rc = RARITY_COLORS[item.rarity] or {0.5, 0.5, 0.5}
                    local hovered = mx >= px + 10 and mx < px + pw - 10 and my >= iy and my < iy + itemH - 2

                    if hovered then
                        _hoveredCardData = item
                        love.graphics.setColor(0.15, 0.2, 0.25, 0.8)
                    elseif i % 2 == 0 then
                        love.graphics.setColor(0.08, 0.1, 0.12, 0.3)
                    else
                        love.graphics.setColor(0, 0, 0, 0)
                    end
                    love.graphics.rectangle("fill", px + 8, iy, pw - 16, itemH - 2, 3, 3)

                    -- Name
                    love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
                    love.graphics.print(item.name or "?", px + 14, iy + 2)

                    -- Archetype + type label
                    local archLabel = item.archetype or "?"
                    local typeLabel = (item.type or "?"):gsub("_"," ")
                    love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
                    love.graphics.print(archLabel:gsub("_"," ") .. " | " .. typeLabel, px + 14, iy + 15)

                    -- Price + Buy button
                    local buyW = 50
                    local buyX = px + pw - buyW - 14
                    love.graphics.setColor(1, 0.85, 0.2, 0.9)
                    love.graphics.printf(tostring(item.price or 0) .. "c", px + 14, iy + 8, pw - buyW - 40, "right")

                    local buyHovered = mx >= buyX and mx < buyX + buyW and my >= iy + 4 and my < iy + 4 + 22
                    love.graphics.setColor(0.2, 0.45, 0.25, buyHovered and 0.95 or 0.7)
                    love.graphics.rectangle("fill", buyX, iy + 4, buyW, 22, 3, 3)
                    love.graphics.setColor(1, 1, 1, buyHovered and 1 or 0.8)
                    love.graphics.printf("Buy", buyX, iy + 7, buyW, "center")

                    ui._vendorItemBtns[i] = { x = buyX, y = iy + 4, w = buyW, h = 22, cardId = item.cardId, action = "buy" }
                end
            end
        end
    else
        -- Sell tab: show unequipped cards
        local sellCards = {}
        for _, card in ipairs(rpg.cards) do
            if not getCardEquipSlot(card) then
                table.insert(sellCards, card)
            end
        end

        if #sellCards == 0 then
            love.graphics.setFont(fonts.ui)
            love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
            love.graphics.printf("No unequipped cards to sell.", px, listY + 30, pw, "center")
        else
            love.graphics.setFont(fonts.small)
            for i, card in ipairs(sellCards) do
                local iy = listY + (i - 1) * itemH - _g._cardVendor.scroll
                if iy + itemH >= listY and iy < listY + listH then
                    local rc = RARITY_COLORS[card.rarity] or {0.5, 0.5, 0.5}
                    local hovered = mx >= px + 10 and mx < px + pw - 10 and my >= iy and my < iy + itemH - 2

                    if hovered then
                        love.graphics.setColor(0.15, 0.2, 0.25, 0.8)
                    elseif i % 2 == 0 then
                        love.graphics.setColor(0.08, 0.1, 0.12, 0.3)
                    else
                        love.graphics.setColor(0, 0, 0, 0)
                    end
                    love.graphics.rectangle("fill", px + 8, iy, pw - 16, itemH - 2, 3, 3)

                    love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
                    love.graphics.print(card.name or "?", px + 14, iy + 2)

                    love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
                    love.graphics.print(((card.rarity or "?"):gsub("_"," ")), px + 14, iy + 15)

                    -- Estimated sell price (25% base value)
                    local baseValues = { common=50, uncommon=200, rare=500, ultra_rare=1500, mythic_rare=5000, legendary=15000, godly=50000, relic=200000 }
                    local baseVal = baseValues[card.rarity] or 50
                    if card.style == "holographic" then baseVal = math.floor(baseVal * 1.5)
                    elseif card.style == "golden" then baseVal = math.floor(baseVal * 2)
                    elseif card.style == "prismatic" then baseVal = math.floor(baseVal * 3)
                    elseif card.style == "void" then baseVal = math.floor(baseVal * 5) end
                    local sellPrice = math.max(1, math.floor(baseVal * 0.25))

                    love.graphics.setColor(1, 0.85, 0.2, 0.9)
                    love.graphics.printf(tostring(sellPrice) .. "c", px + 14, iy + 8, pw - 120, "right")

                    local sellW = 50
                    local sellX = px + pw - sellW - 14
                    local sellHovered = mx >= sellX and mx < sellX + sellW and my >= iy + 4 and my < iy + 4 + 22
                    love.graphics.setColor(0.5, 0.3, 0.15, sellHovered and 0.95 or 0.7)
                    love.graphics.rectangle("fill", sellX, iy + 4, sellW, 22, 3, 3)
                    love.graphics.setColor(1, 1, 1, sellHovered and 1 or 0.8)
                    love.graphics.printf("Sell", sellX, iy + 7, sellW, "center")

                    ui._vendorItemBtns[i] = { x = sellX, y = iy + 4, w = sellW, h = 22, cardInstanceId = card.instanceId, action = "sell" }
                end
            end
        end
    end

    love.graphics.setScissor()
end

local function drawCardLoadoutsTab(px, py, pw, ph)
    local mx, my = love.mouse.getPosition()
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.7, 0.8, 1, 0.9)
    love.graphics.printf("Card Loadouts", px + 10, py + 4, pw - 20, "center")

    local slotH = 50
    local startY = py + 30
    ui._loadoutBtns = {}

    for i = 1, 5 do
        local ly = startY + (i - 1) * (slotH + 6)
        local loadout = _g._cardLoadouts.loadouts[i]

        -- Background
        love.graphics.setColor(0.1, 0.12, 0.16, 0.8)
        love.graphics.rectangle("fill", px + 10, ly, pw - 20, slotH, 4, 4)
        love.graphics.setColor(0.3, 0.3, 0.4, 0.6)
        love.graphics.rectangle("line", px + 10, ly, pw - 20, slotH, 4, 4)

        -- Slot label
        love.graphics.setFont(fonts.hud)
        if loadout then
            love.graphics.setColor(0.9, 0.9, 0.8, 1)
            love.graphics.print(loadout.name or ("Loadout " .. i), px + 18, ly + 6)

            -- Show equipped card count
            local cardCount = 0
            for _, cid in ipairs(loadout.cards or {}) do
                if cid then cardCount = cardCount + 1 end
            end
            love.graphics.setFont(fonts.small)
            love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
            love.graphics.print(cardCount .. " cards saved", px + 18, ly + 24)

            -- Load button
            local loadBtnX = px + pw - 140
            local loadBtnW = 55
            local loadHovered = mx >= loadBtnX and mx < loadBtnX + loadBtnW and my >= ly + 10 and my < ly + 10 + 26
            love.graphics.setColor(0.2, 0.4, 0.3, loadHovered and 0.95 or 0.7)
            love.graphics.rectangle("fill", loadBtnX, ly + 10, loadBtnW, 26, 3, 3)
            love.graphics.setFont(fonts.hud)
            love.graphics.setColor(1, 1, 1, loadHovered and 1 or 0.8)
            love.graphics.printf("Load", loadBtnX, ly + 14, loadBtnW, "center")
            ui._loadoutBtns[#ui._loadoutBtns + 1] = { x = loadBtnX, y = ly + 10, w = loadBtnW, h = 26, action = "load", slotIndex = i - 1 }

            -- Overwrite button
            local saveBtnX = px + pw - 78
            local saveBtnW = 55
            local saveHovered = mx >= saveBtnX and mx < saveBtnX + saveBtnW and my >= ly + 10 and my < ly + 10 + 26
            love.graphics.setColor(0.4, 0.35, 0.15, saveHovered and 0.95 or 0.7)
            love.graphics.rectangle("fill", saveBtnX, ly + 10, saveBtnW, 26, 3, 3)
            love.graphics.setColor(1, 1, 1, saveHovered and 1 or 0.8)
            love.graphics.printf("Save", saveBtnX, ly + 14, saveBtnW, "center")
            ui._loadoutBtns[#ui._loadoutBtns + 1] = { x = saveBtnX, y = ly + 10, w = saveBtnW, h = 26, action = "save", slotIndex = i - 1 }
        else
            love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
            love.graphics.print("Empty Slot " .. i, px + 18, ly + 6)
            love.graphics.setFont(fonts.small)
            love.graphics.setColor(0.4, 0.4, 0.5, 0.5)
            love.graphics.print("Save current build here", px + 18, ly + 24)

            -- Save button
            local saveBtnX = px + pw - 78
            local saveBtnW = 55
            local saveHovered = mx >= saveBtnX and mx < saveBtnX + saveBtnW and my >= ly + 10 and my < ly + 10 + 26
            love.graphics.setColor(0.2, 0.4, 0.3, saveHovered and 0.95 or 0.7)
            love.graphics.rectangle("fill", saveBtnX, ly + 10, saveBtnW, 26, 3, 3)
            love.graphics.setFont(fonts.hud)
            love.graphics.setColor(1, 1, 1, saveHovered and 1 or 0.8)
            love.graphics.printf("Save", saveBtnX, ly + 14, saveBtnW, "center")
            ui._loadoutBtns[#ui._loadoutBtns + 1] = { x = saveBtnX, y = ly + 10, w = saveBtnW, h = 26, action = "save", slotIndex = i - 1 }
        end
    end
end

local function drawAuctionBrowse(px, py, pw, ph)
    local mx, my = love.mouse.getPosition()

    -- Search bar
    local searchY = py
    local searchW = pw - 120
    love.graphics.setColor(0.1, 0.1, 0.15, 0.9)
    love.graphics.rectangle("fill", px + 10, searchY, searchW, 20, 3, 3)
    love.graphics.setColor(_g._auction.searchActive and 0.5 or 0.3, _g._auction.searchActive and 0.5 or 0.3, _g._auction.searchActive and 0.7 or 0.4, 0.8)
    love.graphics.rectangle("line", px + 10, searchY, searchW, 20, 3, 3)
    love.graphics.setFont(fonts.small)
    if #_g._auction.filters.search > 0 then
        love.graphics.setColor(1, 1, 1, 0.9)
        love.graphics.print(_g._auction.filters.search, px + 14, searchY + 3)
    else
        love.graphics.setColor(0.4, 0.4, 0.5, 0.5)
        love.graphics.print("Search cards...", px + 14, searchY + 3)
    end
    _g._auction._searchBar = { x = px + 10, y = searchY, w = searchW, h = 20 }

    -- Search button
    local searchBtnX = px + 10 + searchW + 4
    local searchBtnW = 60
    local searchHovered = mx >= searchBtnX and mx < searchBtnX + searchBtnW and my >= searchY and my < searchY + 20
    love.graphics.setColor(0.2, 0.25, 0.4, searchHovered and 0.95 or 0.7)
    love.graphics.rectangle("fill", searchBtnX, searchY, searchBtnW, 20, 3, 3)
    love.graphics.setColor(1, 1, 1, searchHovered and 1 or 0.8)
    love.graphics.printf("Search", searchBtnX, searchY + 3, searchBtnW, "center")
    _g._auction._searchBtn = { x = searchBtnX, y = searchY, w = searchBtnW, h = 20 }

    -- Rarity filter buttons
    local filterY = searchY + 24
    local rarities = { "all", "common", "uncommon", "rare", "ultra_rare", "mythic_rare", "legendary" }
    local rarityLabels = { "All", "C", "UC", "R", "UR", "MR", "L" }
    local rBtnW = math.floor((pw - 20) / #rarities)
    _g._auction._rarityBtns = {}
    love.graphics.setFont(fonts.small)
    for ri, r in ipairs(rarities) do
        local rx = px + 10 + (ri - 1) * rBtnW
        local active = (_g._auction.filters.rarity == r) or (r == "all" and not _g._auction.filters.rarity)
        local rc = RARITY_COLORS[r] or {0.5, 0.5, 0.6}
        if active then
            love.graphics.setColor(rc[1] * 0.4, rc[2] * 0.4, rc[3] * 0.4, 0.9)
        else
            love.graphics.setColor(0.08, 0.1, 0.14, 0.6)
        end
        love.graphics.rectangle("fill", rx, filterY, rBtnW - 2, 16, 2, 2)
        love.graphics.setColor(active and rc[1] or 0.5, active and rc[2] or 0.5, active and rc[3] or 0.5, active and 1 or 0.6)
        love.graphics.printf(rarityLabels[ri], rx, filterY + 1, rBtnW - 2, "center")
        _g._auction._rarityBtns[ri] = { x = rx, y = filterY, w = rBtnW - 2, h = 16, rarity = r == "all" and nil or r }
    end

    -- Listings
    local listY = filterY + 22
    local listH = ph - (listY - py) - 24
    local itemH = 30

    love.graphics.setScissor(px + 4, listY, pw - 8, listH)
    _g._auction._listingBtns = {}

    if #_g._auction.listings == 0 then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
        love.graphics.printf("No listings found.", px, listY + 30, pw, "center")
    else
        love.graphics.setFont(fonts.small)
        for i, listing in ipairs(_g._auction.listings) do
            local iy = listY + (i - 1) * itemH - _g._auction.scroll
            if iy + itemH >= listY and iy < listY + listH then
                local rc = RARITY_COLORS[listing.rarity] or {0.5, 0.5, 0.5}
                local hovered = mx >= px + 10 and mx < px + pw - 10 and my >= iy and my < iy + itemH

                if hovered then
                    love.graphics.setColor(0.15, 0.15, 0.25, 0.8)
                elseif i % 2 == 0 then
                    love.graphics.setColor(0.08, 0.1, 0.12, 0.3)
                else
                    love.graphics.setColor(0, 0, 0, 0)
                end
                love.graphics.rectangle("fill", px + 8, iy, pw - 16, itemH - 2, 3, 3)

                -- Name with rarity color
                love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
                love.graphics.print(listing.name or "?", px + 14, iy + 3)

                -- Seller
                love.graphics.setColor(0.5, 0.5, 0.6, 0.7)
                love.graphics.print("by " .. (listing.sellerName or "?"), px + 14, iy + 15)

                -- Price
                love.graphics.setColor(1, 0.85, 0.2, 0.9)
                love.graphics.printf(tostring(listing.price or 0) .. "c", px + 14, iy + 8, pw - 100, "right")

                -- Buy button
                local buyW = 45
                local buyX = px + pw - buyW - 14
                local buyHovered = mx >= buyX and mx < buyX + buyW and my >= iy + 3 and my < iy + 3 + 22
                love.graphics.setColor(0.2, 0.35, 0.5, buyHovered and 0.95 or 0.7)
                love.graphics.rectangle("fill", buyX, iy + 3, buyW, 22, 3, 3)
                love.graphics.setColor(1, 1, 1, buyHovered and 1 or 0.8)
                love.graphics.printf("Buy", buyX, iy + 6, buyW, "center")

                _g._auction._listingBtns[i] = { x = buyX, y = iy + 3, w = buyW, h = 22, listingId = listing.id }
            end
        end
    end

    love.graphics.setScissor()

    -- Pagination
    local pageY = listY + listH + 2
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
    love.graphics.printf("Page " .. _g._auction.page .. "/" .. math.max(1, _g._auction.totalPages) .. " (" .. _g._auction.totalResults .. " results)", px + 10, pageY, pw - 20, "center")

    -- Prev/Next page buttons
    if _g._auction.page > 1 then
        local prevX = px + 10
        local prevHovered = mx >= prevX and mx < prevX + 30 and my >= pageY and my < pageY + 14
        love.graphics.setColor(0.3, 0.3, 0.5, prevHovered and 1 or 0.7)
        love.graphics.print("< Prev", prevX, pageY)
        _g._auction._prevPageBtn = { x = prevX, y = pageY, w = 40, h = 14 }
    else
        _g._auction._prevPageBtn = nil
    end
    if _g._auction.page < _g._auction.totalPages then
        local nextX = px + pw - 50
        local nextHovered = mx >= nextX and mx < nextX + 40 and my >= pageY and my < pageY + 14
        love.graphics.setColor(0.3, 0.3, 0.5, nextHovered and 1 or 0.7)
        love.graphics.printf("Next >", nextX, pageY, 40, "right")
        _g._auction._nextPageBtn = { x = nextX, y = pageY, w = 40, h = 14 }
    else
        _g._auction._nextPageBtn = nil
    end
end

local function drawAuctionSell(px, py, pw, ph)
    local mx, my = love.mouse.getPosition()

    -- Show unequipped cards to select for listing
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.7, 0.8, 1, 0.8)
    love.graphics.printf("Select a card to list:", px + 10, py, pw - 20, "left")

    -- Price input
    local priceY = py
    love.graphics.setColor(0.1, 0.1, 0.15, 0.9)
    love.graphics.rectangle("fill", px + pw - 180, priceY, 100, 20, 3, 3)
    love.graphics.setColor(_g._auction.priceActive and 0.5 or 0.3, _g._auction.priceActive and 0.5 or 0.3, _g._auction.priceActive and 0.7 or 0.4, 0.8)
    love.graphics.rectangle("line", px + pw - 180, priceY, 100, 20, 3, 3)
    love.graphics.setFont(fonts.small)
    if #_g._auction.sellPrice > 0 then
        love.graphics.setColor(1, 0.85, 0.2, 0.9)
        love.graphics.print(_g._auction.sellPrice .. "c", px + pw - 176, priceY + 3)
    else
        love.graphics.setColor(0.4, 0.4, 0.5, 0.5)
        love.graphics.print("Price...", px + pw - 176, priceY + 3)
    end
    _g._auction._priceInput = { x = px + pw - 180, y = priceY, w = 100, h = 20 }

    -- List button
    local listBtnX = px + pw - 72
    local listBtnW = 60
    local canList = _g._auction.sellCard and #_g._auction.sellPrice > 0
    local listHovered = canList and mx >= listBtnX and mx < listBtnX + listBtnW and my >= priceY and my < priceY + 20
    love.graphics.setColor(canList and 0.2 or 0.15, canList and 0.4 or 0.15, canList and 0.3 or 0.2, listHovered and 0.95 or 0.7)
    love.graphics.rectangle("fill", listBtnX, priceY, listBtnW, 20, 3, 3)
    love.graphics.setColor(1, 1, 1, canList and (listHovered and 1 or 0.8) or 0.4)
    love.graphics.printf("List", listBtnX, priceY + 3, listBtnW, "center")
    _g._auction._listBtn = { x = listBtnX, y = priceY, w = listBtnW, h = 20 }

    -- Card grid for selling
    local listY = py + 26
    local listH = ph - 36
    local itemH = 30

    love.graphics.setScissor(px + 4, listY, pw - 8, listH)
    _g._auction._sellCardBtns = {}

    local sellCards = {}
    for _, card in ipairs(rpg.cards) do
        if not getCardEquipSlot(card) then
            table.insert(sellCards, card)
        end
    end

    if #sellCards == 0 then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
        love.graphics.printf("No unequipped cards to sell.", px, listY + 30, pw, "center")
    else
        love.graphics.setFont(fonts.small)
        for i, card in ipairs(sellCards) do
            local iy = listY + (i - 1) * itemH - _g._auction.scroll
            if iy + itemH >= listY and iy < listY + listH then
                local rc = RARITY_COLORS[card.rarity] or {0.5, 0.5, 0.5}
                local isSelected = _g._auction.sellCard and _g._auction.sellCard.instanceId == card.instanceId
                local hovered = mx >= px + 10 and mx < px + pw - 10 and my >= iy and my < iy + itemH

                if isSelected then
                    love.graphics.setColor(0.2, 0.15, 0.35, 0.9)
                elseif hovered then
                    love.graphics.setColor(0.15, 0.15, 0.25, 0.8)
                elseif i % 2 == 0 then
                    love.graphics.setColor(0.08, 0.1, 0.12, 0.3)
                else
                    love.graphics.setColor(0, 0, 0, 0)
                end
                love.graphics.rectangle("fill", px + 8, iy, pw - 16, itemH - 2, 3, 3)

                if isSelected then
                    love.graphics.setColor(0.5, 0.4, 0.8, 0.6)
                    love.graphics.rectangle("line", px + 8, iy, pw - 16, itemH - 2, 3, 3)
                end

                love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
                love.graphics.print(card.name or "?", px + 14, iy + 3)
                love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
                love.graphics.print(((card.rarity or "?"):gsub("_"," ")) .. " | " .. ((card.type or "?"):gsub("_"," ")), px + 14, iy + 15)

                _g._auction._sellCardBtns[i] = { x = px + 8, y = iy, w = pw - 16, h = itemH - 2, card = card }
            end
        end
    end

    love.graphics.setScissor()
end

local function drawAuctionMyListings(px, py, pw, ph)
    local mx, my = love.mouse.getPosition()
    local itemH = 30

    love.graphics.setScissor(px + 4, py, pw - 8, ph)
    _g._auction._cancelBtns = {}

    if #_g._auction.myListings == 0 then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
        love.graphics.printf("You have no active listings.", px, py + 30, pw, "center")
    else
        love.graphics.setFont(fonts.small)
        for i, listing in ipairs(_g._auction.myListings) do
            local iy = py + (i - 1) * itemH - _g._auction.scroll
            if iy + itemH >= py and iy < py + ph then
                local rc = RARITY_COLORS[listing.rarity] or {0.5, 0.5, 0.5}
                local hovered = mx >= px + 10 and mx < px + pw - 10 and my >= iy and my < iy + itemH

                if hovered then
                    love.graphics.setColor(0.15, 0.15, 0.25, 0.8)
                elseif i % 2 == 0 then
                    love.graphics.setColor(0.08, 0.1, 0.12, 0.3)
                else
                    love.graphics.setColor(0, 0, 0, 0)
                end
                love.graphics.rectangle("fill", px + 8, iy, pw - 16, itemH - 2, 3, 3)

                love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
                love.graphics.print(listing.name or "?", px + 14, iy + 3)

                love.graphics.setColor(1, 0.85, 0.2, 0.9)
                love.graphics.printf(tostring(listing.price or 0) .. "c", px + 14, iy + 3, pw - 120, "right")

                -- Cancel button
                local cancelW = 55
                local cancelX = px + pw - cancelW - 14
                local cancelHovered = mx >= cancelX and mx < cancelX + cancelW and my >= iy + 3 and my < iy + 3 + 22
                love.graphics.setColor(0.5, 0.2, 0.15, cancelHovered and 0.95 or 0.7)
                love.graphics.rectangle("fill", cancelX, iy + 3, cancelW, 22, 3, 3)
                love.graphics.setColor(1, 1, 1, cancelHovered and 1 or 0.8)
                love.graphics.printf("Cancel", cancelX, iy + 6, cancelW, "center")

                _g._auction._cancelBtns[i] = { x = cancelX, y = iy + 3, w = cancelW, h = 22, listingId = listing.id }
            end
        end
    end

    love.graphics.setScissor()
end

local function drawAuctionHouse(W, H)
    local pw = math.min(650, W - 40)
    local ph = math.min(480, H - 60)
    local px = math.floor((W - pw) / 2)
    local py = math.floor((H - ph) / 2)
    local mx, my = love.mouse.getPosition()

    _g._auction._panelX = px
    _g._auction._panelY = py
    _g._auction._panelW = pw
    _g._auction._panelH = ph

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel
    love.graphics.setColor(0.06, 0.07, 0.12, 0.96)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    love.graphics.setColor(0.4, 0.35, 0.6, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title
    love.graphics.setColor(0.08, 0.12, 0.2, 0.9)
    love.graphics.rectangle("fill", px, py, pw, 30, 8, 8)
    love.graphics.rectangle("fill", px, py + 20, pw, 10)
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.6, 0.5, 1, 1)
    love.graphics.printf("Auction House", px + 10, py + 4, pw - 50, "left")

    -- Coins display
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(1, 0.85, 0.2, 0.9)
    love.graphics.printf("Coins: " .. (getAccount() and getAccount().coins or 0), px + 10, py + 8, pw - 60, "right")

    -- Close button
    local closeX = px + pw - 30
    local closeY = py + 4
    local closeW, closeH = 24, 22
    love.graphics.setColor(0.5, 0.15, 0.15, 0.8)
    love.graphics.rectangle("fill", closeX, closeY, closeW, closeH, 4, 4)
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf("X", closeX, closeY + 2, closeW, "center")
    _g._auction._closeBtn = { x = closeX, y = closeY, w = closeW, h = closeH }

    -- Tab bar: Browse | Sell | My Listings
    local tabY = py + 34
    local tabNames = { "browse", "sell", "my_listings" }
    local tabLabels = { "Browse", "Sell", "My Listings" }
    local tabW = math.floor((pw - 20) / #tabNames)
    _g._auction._tabBtns = {}
    love.graphics.setFont(fonts.hud)
    for ti, tname in ipairs(tabNames) do
        local tx = px + 10 + (ti - 1) * tabW
        local active = (_g._auction.tab == tname)
        if active then
            love.graphics.setColor(0.15, 0.15, 0.3, 0.95)
        else
            love.graphics.setColor(0.08, 0.1, 0.14, 0.7)
        end
        love.graphics.rectangle("fill", tx, tabY, tabW - 2, 22, 3, 3)
        love.graphics.setColor(active and 0.7 or 0.4, active and 0.6 or 0.4, active and 1 or 0.5, 1)
        love.graphics.printf(tabLabels[ti], tx, tabY + 2, tabW - 2, "center")
        _g._auction._tabBtns[ti] = { x = tx, y = tabY, w = tabW - 2, h = 22, tab = tname }
    end

    local contentY = tabY + 28
    local contentH = ph - (contentY - py) - 20

    if _g._auction.tab == "browse" then
        drawAuctionBrowse(px, contentY, pw, contentH)
    elseif _g._auction.tab == "sell" then
        drawAuctionSell(px, contentY, pw, contentH)
    else
        drawAuctionMyListings(px, contentY, pw, contentH)
    end

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("[J] or [ESC] to close", px, py + ph - 16, pw, "center")
end

local function drawCardCollectionTab(px, py, pw, ph)
    local mx, my = love.mouse.getPosition()

    -- Filter buttons
    local filterY = py
    local filters = {
        { id = "all", label = "All" },
        { id = "stat_boost", label = "Stat" },
        { id = "passive", label = "Passive" },
        { id = "active_ability", label = "Active" },
        { id = "equipped", label = "Equipped" },
    }
    local filterBtnW = math.floor((pw - 20) / #filters)
    ui._filterBtns = {}
    love.graphics.setFont(fonts.small)
    for fi, f in ipairs(filters) do
        local fx = px + 10 + (fi - 1) * filterBtnW
        local active = (ui.cardFilter == f.id)
        if active then
            love.graphics.setColor(0.25, 0.2, 0.1, 0.95)
        else
            love.graphics.setColor(0.1, 0.1, 0.14, 0.6)
        end
        love.graphics.rectangle("fill", fx, filterY, filterBtnW - 2, 16, 2, 2)
        love.graphics.setColor(active and 1 or 0.5, active and 0.85 or 0.5, active and 0.2 or 0.3, 1)
        love.graphics.printf(f.label, fx, filterY + 1, filterBtnW - 2, "center")
        ui._filterBtns[fi] = { x = fx, y = filterY, w = filterBtnW - 2, h = 16, filter = f.id }
    end

    -- Sort buttons
    local sortY = filterY + 20
    local sorts = {
        { id = "rarity", label = "Rarity" },
        { id = "name", label = "Name" },
        { id = "type", label = "Type" },
    }
    local sortBtnW = 60
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.7)
    love.graphics.print("Sort:", px + 10, sortY + 1)
    ui._sortBtns = {}
    for si, s in ipairs(sorts) do
        local sx = px + 50 + (si - 1) * (sortBtnW + 2)
        local active = (ui.cardSort == s.id)
        if active then
            love.graphics.setColor(0.15, 0.2, 0.3, 0.9)
        else
            love.graphics.setColor(0.1, 0.1, 0.14, 0.5)
        end
        love.graphics.rectangle("fill", sx, sortY, sortBtnW, 16, 2, 2)
        love.graphics.setColor(active and 0.6 or 0.4, active and 0.8 or 0.5, active and 1 or 0.5, 1)
        love.graphics.printf(s.label, sx, sortY + 1, sortBtnW, "center")
        ui._sortBtns[si] = { x = sx, y = sortY, w = sortBtnW, h = 16, sort = s.id }
    end

    -- Fusion mode indicator
    if _g._fusionMode.active and _g._fusionMode.card1 then
        love.graphics.setColor(0.9, 0.5, 1, 0.8 + 0.2 * math.sin(love.timer.getTime() * 4))
        love.graphics.printf("FUSION: Select a second card of same rarity (" .. (_g._fusionMode.card1.rarity or "?"):gsub("_"," ") .. ") — ESC to cancel", px + 10, sortY, pw - 20, "right")
    end

    -- Card grid
    local startY = sortY + 22
    local cardW = 130
    local cardH = 80
    local gap = 8
    local cols = math.floor((pw - 20) / (cardW + gap))
    local startX = px + (pw - cols * (cardW + gap) + gap) / 2

    local filteredCards = getFilteredCards()

    -- Clip region for scrollable list
    love.graphics.setScissor(px + 4, startY, pw - 8, ph - (startY - py) - 20)

    cardGridRects = {}
    cardGridCards = {}

    love.graphics.setFont(fonts.small)
    for i, card in ipairs(filteredCards) do
        local col = (i - 1) % cols
        local row = math.floor((i - 1) / cols)
        local cx = startX + col * (cardW + gap)
        local cy = startY + row * (cardH + gap) - ui.cardScrollY

        if cy + cardH >= startY and cy <= py + ph - 20 then
            local rc = RARITY_COLORS[card.rarity] or {0.5, 0.5, 0.5}
            local isHovered = mx >= cx and mx < cx + cardW and my >= cy and my < cy + cardH
            local isEquipped = getCardEquipSlot(card) ~= nil
            local isFusionTarget = _g._fusionMode.active and _g._fusionMode.card1 and
                card.rarity == _g._fusionMode.card1.rarity and card.instanceId ~= _g._fusionMode.card1.instanceId and
                not getCardEquipSlot(card)

            if isHovered then _hoveredCardData = card end

            -- Card background
            if isFusionTarget then
                love.graphics.setColor(0.3, 0.15, 0.35, 0.95)
            elseif isHovered then
                love.graphics.setColor(0.18, 0.18, 0.25, 0.95)
            else
                love.graphics.setColor(0.12, 0.12, 0.18, 0.9)
            end
            love.graphics.rectangle("fill", cx, cy, cardW, cardH, 4, 4)

            -- Rarity border
            local borderAlpha = isHovered and 1 or 0.8
            love.graphics.setColor(rc[1], rc[2], rc[3], borderAlpha)
            love.graphics.setLineWidth(card.style == "holographic" and 2 or 1)
            love.graphics.rectangle("line", cx, cy, cardW, cardH, 4, 4)

            -- Card name
            love.graphics.setColor(1, 1, 1, 0.95)
            love.graphics.printf(card.name or "?", cx + 4, cy + 4, cardW - 8, "left")

            -- Rarity label
            local rarityLabel = (card.rarity or "?"):gsub("_", " ")
            love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
            love.graphics.printf(rarityLabel, cx + 4, cy + 20, cardW - 8, "left")

            -- Type
            love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
            local typeLabel = (card.type or "?"):gsub("_", " ")
            love.graphics.printf(typeLabel, cx + 4, cy + 36, cardW - 8, "left")

            -- Style indicator
            if card.style and card.style ~= "normal" then
                love.graphics.setColor(1, 0.85, 0.2, 0.8)
                love.graphics.printf(card.style, cx + 4, cy + 52, cardW - 8, "left")
            end

            -- Fusion count
            if card.fusionCount and card.fusionCount > 0 then
                love.graphics.setColor(0.9, 0.5, 1, 0.9)
                love.graphics.printf("+" .. card.fusionCount, cx + 4, cy + cardH - 16, cardW - 8, "right")
            end

            -- Equipped indicator
            if isEquipped then
                love.graphics.setColor(0.3, 1, 0.3, 0.8)
                love.graphics.printf("EQUIPPED", cx + 4, cy + cardH - 16, cardW - 8, "left")
            end

            -- Fusion target highlight
            if isFusionTarget then
                love.graphics.setColor(0.9, 0.5, 1, 0.3 + 0.2 * math.sin(love.timer.getTime() * 5))
                love.graphics.rectangle("fill", cx, cy, cardW, cardH, 4, 4)
            end

            cardGridRects[i] = { x = cx, y = cy, w = cardW, h = cardH }
            cardGridCards[i] = card
        end
    end

    love.graphics.setScissor()

    if #filteredCards == 0 then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
        love.graphics.printf("No cards match this filter.", px, py + ph / 2 - 10, pw, "center")
    end

    -- Drop Rate Disclosure (shown when packs are pending)
    if rpg.pendingPacks and rpg.pendingPacks > 0 then
        local drx = px + pw - 148
        local dry = startY
        local drW = 140
        local drH = 128

        love.graphics.setColor(0.06, 0.06, 0.1, 0.92)
        love.graphics.rectangle("fill", drx, dry, drW, drH, 4, 4)
        love.graphics.setColor(0.4, 0.35, 0.5, 0.6)
        love.graphics.setLineWidth(1)
        love.graphics.rectangle("line", drx, dry, drW, drH, 4, 4)

        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(0.8, 0.8, 0.9, 0.9)
        love.graphics.printf("Drop Rates:", drx + 4, dry + 4, drW - 8, "center")

        local DROP_RATES = {
            { name = "Common",     rate = "45.0%", color = {0.53, 0.53, 0.53} },
            { name = "Uncommon",   rate = "25.0%", color = {0.13, 0.8, 0.13} },
            { name = "Rare",       rate = "15.0%", color = {0.2, 0.53, 1} },
            { name = "Ultra Rare", rate = " 8.0%", color = {0.67, 0.27, 1} },
            { name = "Mythic",     rate = " 4.0%", color = {1, 0.67, 0} },
            { name = "Legendary",  rate = " 2.0%", color = {1, 0.4, 0} },
            { name = "Godly",      rate = " 0.8%", color = {1, 0, 0} },
            { name = "Relic",      rate = " 0.2%", color = {1, 1, 1} },
        }

        love.graphics.setFont(fonts.small)
        for ri, entry in ipairs(DROP_RATES) do
            local ry = dry + 18 + ri * 12
            love.graphics.setColor(entry.color[1], entry.color[2], entry.color[3], 0.9)
            love.graphics.print(entry.name, drx + 8, ry)
            love.graphics.setColor(0.8, 0.8, 0.8, 0.8)
            love.graphics.printf(entry.rate, drx + 4, ry, drW - 12, "right")
        end
    end
end

local function drawCardDetailView(W, H)
    local card = ui.selectedCard
    if not card then return end

    local dw = math.min(400, W - 60)
    local dh = math.min(450, H - 80)
    local dx = (W - dw) / 2
    local dy = (H - dh) / 2
    local rc = RARITY_COLORS[card.rarity] or {0.5, 0.5, 0.5}
    local equipSlot = getCardEquipSlot(card)

    -- Dim behind
    love.graphics.setColor(0, 0, 0, 0.5)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel
    love.graphics.setColor(0.06, 0.07, 0.12, 0.97)
    love.graphics.rectangle("fill", dx, dy, dw, dh, 8, 8)
    love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", dx, dy, dw, dh, 8, 8)

    local cy = dy + 12

    -- Card name
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf(card.name or "Unknown Card", dx + 10, cy, dw - 20, "center")
    cy = cy + 28

    -- Rarity + Type + Archetype
    love.graphics.setFont(fonts.ui)
    local rarityLabel = (card.rarity or "?"):gsub("_", " "):upper()
    love.graphics.setColor(rc[1], rc[2], rc[3], 1)
    love.graphics.printf(rarityLabel, dx + 10, cy, dw - 20, "center")
    cy = cy + 20

    love.graphics.setFont(fonts.main)
    love.graphics.setColor(0.7, 0.7, 0.8, 0.9)
    local typeStr = (card.type or "?"):gsub("_", " ")
    if card.archetype then typeStr = typeStr .. "  |  " .. card.archetype end
    love.graphics.printf(typeStr, dx + 10, cy, dw - 20, "center")
    cy = cy + 18

    -- Style
    if card.style and card.style ~= "normal" then
        love.graphics.setColor(1, 0.85, 0.2, 0.9)
        love.graphics.printf("Style: " .. card.style, dx + 10, cy, dw - 20, "center")
        cy = cy + 16
    end

    -- Fusion count
    if card.fusionCount and card.fusionCount > 0 then
        love.graphics.setColor(0.9, 0.5, 1, 0.9)
        love.graphics.printf("Fusion Level: +" .. card.fusionCount, dx + 10, cy, dw - 20, "center")
        cy = cy + 16
    end

    cy = cy + 6

    -- Description
    if card.description and card.description ~= "" then
        love.graphics.setColor(0.8, 0.8, 0.7, 0.85)
        love.graphics.setFont(fonts.chat or fonts.main)
        love.graphics.printf(card.description, dx + 15, cy, dw - 30, "left")
        local _, descLines = (fonts.chat or fonts.main):getWrap(card.description, dw - 30)
        cy = cy + math.max(30, #descLines * (fonts.chat or fonts.main):getHeight())
    end

    -- Effects
    if card.effects and #card.effects > 0 then
        cy = cy + 4
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.6, 0.8, 0.6, 0.9)
        love.graphics.print("Effects:", dx + 15, cy)
        cy = cy + 14
        for _, eff in ipairs(card.effects) do
            local effText = eff.description or (eff.type .. ": " .. tostring(eff.value or ""))
            love.graphics.setColor(0.7, 0.9, 0.7, 0.85)
            love.graphics.printf("  " .. effText, dx + 15, cy, dw - 30, "left")
            cy = cy + 13
        end
    end

    -- Combat stats for active abilities
    if card.combatType then
        cy = cy + 4
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.6, 0.6, 0.9, 0.9)
        love.graphics.print("Combat:", dx + 15, cy)
        cy = cy + 14
        local combatLines = {}
        if card.baseDamage then table.insert(combatLines, "Damage: " .. card.baseDamage) end
        if card.manaCost then table.insert(combatLines, "Cost: " .. card.manaCost) end
        if card.range then table.insert(combatLines, "Range: " .. card.range) end
        if card.cooldown then table.insert(combatLines, "CD: " .. card.cooldown .. " turns") end
        love.graphics.setColor(0.7, 0.7, 0.9, 0.85)
        love.graphics.printf("  " .. table.concat(combatLines, "  |  "), dx + 15, cy, dw - 30, "left")
        cy = cy + 13
    end

    -- Action buttons at bottom
    local btnY = dy + dh - 40
    local btnH = 28
    local btnGap = 6
    local mx, my = love.mouse.getPosition()
    ui._cardDetailBtns = {}

    -- Calculate button layout
    local buttons = {}
    if not equipSlot then
        local emptySlot = getFirstEmptySlot()
        if emptySlot then
            table.insert(buttons, { id = "equip", label = "Equip", color = {0.2, 0.5, 0.3} })
        end
    else
        table.insert(buttons, { id = "unequip", label = "Unequip", color = {0.5, 0.3, 0.2} })
    end
    if not equipSlot then
        table.insert(buttons, { id = "fuse", label = "Fuse", color = {0.4, 0.2, 0.5} })
        table.insert(buttons, { id = "sell", label = "Sell", color = {0.5, 0.4, 0.15} })
        table.insert(buttons, { id = "game._auction", label = "Auction", color = {0.3, 0.3, 0.5} })
    end
    table.insert(buttons, { id = "close", label = "Close", color = {0.3, 0.3, 0.35} })

    local totalBtnW = 0
    local btnWidths = {}
    love.graphics.setFont(fonts.hud)
    for _, btn in ipairs(buttons) do
        local bw = math.max(70, fonts.hud:getWidth(btn.label) + 20)
        table.insert(btnWidths, bw)
        totalBtnW = totalBtnW + bw + btnGap
    end
    totalBtnW = totalBtnW - btnGap

    local bx = dx + (dw - totalBtnW) / 2
    for bi, btn in ipairs(buttons) do
        local bw = btnWidths[bi]
        local hovered = mx >= bx and mx < bx + bw and my >= btnY and my < btnY + btnH
        love.graphics.setColor(btn.color[1], btn.color[2], btn.color[3], hovered and 0.95 or 0.7)
        love.graphics.rectangle("fill", bx, btnY, bw, btnH, 4, 4)
        love.graphics.setColor(1, 1, 1, hovered and 1 or 0.8)
        love.graphics.printf(btn.label, bx, btnY + 5, bw, "center")
        ui._cardDetailBtns[bi] = { x = bx, y = btnY, w = bw, h = btnH, id = btn.id }
        bx = bx + bw + btnGap
    end
end

local function drawCardCollection(W, H)
    _hoveredCardData = nil  -- reset each frame

    local pw = math.min(750, W - 40)
    local ph = math.min(560, H - 60)
    local px = (W - pw) / 2
    local py = (H - ph) / 2
    cardCollectionRect = { px = px, py = py, pw = pw, ph = ph }

    -- Background
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", 0, 0, W, H)
    love.graphics.setColor(0.08, 0.09, 0.14, 0.95)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    love.graphics.setColor(0.5, 0.4, 0.2, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(1, 0.85, 0.2, 1)
    love.graphics.printf("Card Collection (" .. #rpg.cards .. "/1000)", px, py + 8, pw, "center")

    -- Pending packs
    if rpg.pendingPacks and rpg.pendingPacks > 0 then
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(1, 0.85, 0.2, 0.7 + 0.3 * math.sin(love.timer.getTime() * 3))
        love.graphics.printf(rpg.pendingPacks .. " Pack(s) Available! [Click to Open]", px, py + 32, pw, "center")
    end

    -- Tab bar: Collection | Vendor | Loadouts
    local tabY = py + 46
    local tabNames = { "collection", "vendor", "loadouts" }
    local tabLabels = { "Collection", "Shop", "Loadouts" }
    local tabW = math.floor((pw - 20) / #tabNames)
    ui._cardTabBtns = {}
    love.graphics.setFont(fonts.hud)
    for ti, tname in ipairs(tabNames) do
        local tx = px + 10 + (ti - 1) * tabW
        local active = (ui.cardTab == tname)
        if active then
            love.graphics.setColor(0.2, 0.3, 0.15, 0.95)
        else
            love.graphics.setColor(0.08, 0.1, 0.14, 0.7)
        end
        love.graphics.rectangle("fill", tx, tabY, tabW - 2, 20, 3, 3)
        love.graphics.setColor(active and 0.9 or 0.5, active and 0.9 or 0.5, active and 0.5 or 0.3, 1)
        love.graphics.printf(tabLabels[ti], tx, tabY + 2, tabW - 2, "center")
        ui._cardTabBtns[ti] = { x = tx, y = tabY, w = tabW - 2, h = 20, tab = tname }
    end

    if ui.cardTab == "vendor" then
        drawCardVendorTab(px, py + 70, pw, ph - 90)
    elseif ui.cardTab == "loadouts" then
        drawCardLoadoutsTab(px, py + 70, pw, ph - 90)
    else
        drawCardCollectionTab(px, py + 70, pw, ph - 90)
    end

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("[K] or [ESC] to close", px, py + ph - 16, pw, "center")

    -- Card detail overlay (drawn on top)
    if ui.selectedCard then
        drawCardDetailView(W, H)
    end

    -- Hover tooltip (drawn on top of everything)
    if _hoveredCardData and not ui.selectedCard then
        drawCardTooltip(_hoveredCardData, W, H)
    end
end

function cards.init(gameRef, ctx)
    _g = gameRef
    fonts = ctx.fonts
    rpg = ctx.rpg
    ui = ctx.ui
    mastery = ctx.mastery
    getAccount = ctx.getAccount
    getSkills = ctx.getSkills
    -- Register draw functions onto game table so existing callers work unchanged
    gameRef.drawCharSheet          = drawCharSheet
    gameRef.drawCardTooltip        = drawCardTooltip
    gameRef.drawMasteryPanel       = drawMasteryPanel
    gameRef.drawCardCollection     = drawCardCollection
    gameRef.drawCardCollectionTab  = drawCardCollectionTab
    gameRef.drawCardDetailView     = drawCardDetailView
    gameRef.drawCardVendorTab      = drawCardVendorTab
    gameRef.drawCardLoadoutsTab    = drawCardLoadoutsTab
    gameRef.drawAuctionHouse       = drawAuctionHouse
    gameRef.drawAuctionBrowse      = drawAuctionBrowse
    gameRef.drawAuctionSell        = drawAuctionSell
    gameRef.drawAuctionMyListings  = drawAuctionMyListings
end

return cards
