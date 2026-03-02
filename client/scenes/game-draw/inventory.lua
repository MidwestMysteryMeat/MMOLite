-- scenes/game-draw/inventory.lua
-- Inventory, equipment, item tooltips, crafting tab, compass, world map, zone list.

local inventory_draw = {}

-- 'game' alias — all game._xxx references work unchanged
local game

-- Direct table refs (mutated in-place, safe to capture at init time)
local fonts, ui, rpg, players, camera, zoneList

-- Getters for reassignable module-level locals in game.lua
local getMmoInventory, getEquipment, getMyId, getZone, getFadeIn, getMapZoom

-- Populated each frame by draw functions; read by mousepressed via getters
local equipSlotButtons      = {}
local inventoryItemButtons  = {}
local craftingButtons       = {}

local function drawInventory(W, H)
    if not ui.showInventory then return end

    local panelW = math.min(700, W - 40)
    local panelH = math.min(560, H - 60)
    local panelX = (W - panelW) / 2
    local panelY = (H - panelH) / 2

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.05, 0.05, 0.1, 0.92)
    love.graphics.rectangle("fill", panelX, panelY, panelW, panelH, 8, 8)
    love.graphics.setColor(0.3, 0.3, 0.4, 0.6)
    love.graphics.rectangle("line", panelX, panelY, panelW, panelH, 8, 8)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.9, 0.85, 0.4, 1)
    love.graphics.printf("Inventory", panelX, panelY + 8, panelW, "center")

    -- Tabs
    local tabs = { "resources", "items", "crafting" }
    local tabW = panelW / 3
    love.graphics.setFont(fonts.hud)
    for i, tab in ipairs(tabs) do
        local tx = panelX + (i - 1) * tabW
        local ty = panelY + 35
        if ui.inventoryTab == tab then
            love.graphics.setColor(0.2, 0.25, 0.35, 0.9)
        else
            love.graphics.setColor(0.1, 0.12, 0.18, 0.7)
        end
        love.graphics.rectangle("fill", tx + 2, ty, tabW - 4, 24, 4, 4)
        love.graphics.setColor(0.8, 0.8, 0.9, ui.inventoryTab == tab and 1 or 0.5)
        love.graphics.printf(tab:sub(1,1):upper() .. tab:sub(2), tx + 2, ty + 4, tabW - 4, "center")
    end

    local contentY = panelY + 68
    local contentH = panelH - 78

    if ui.inventoryTab == "resources" then
        game.drawResourcesTab(panelX, contentY, panelW, contentH)
    elseif ui.inventoryTab == "items" then
        game.drawItemsTab(panelX, contentY, panelW, contentH)
    elseif ui.inventoryTab == "crafting" then
        game.drawCraftingTab(panelX, contentY, panelW, contentH)
    end
end

local function drawResourcesTab(px, py, pw, ph)
    local mmoInventory = getMmoInventory()
    local equipment    = getEquipment()
    love.graphics.setFont(fonts.zone)
    local items = {
        { name = "Wood", key = "wood", color = {0.45, 0.3, 0.15} },
        { name = "Stone", key = "stone", color = {0.5, 0.5, 0.48} },
        { name = "Iron Ore", key = "iron_ore", color = {0.7, 0.45, 0.2} },
        { name = "Iron Bar", key = "iron_bar", color = {0.6, 0.6, 0.65} },
    }
    for i, item in ipairs(items) do
        local iy = py + (i - 1) * 40 + 5
        -- Icon
        love.graphics.setColor(item.color[1], item.color[2], item.color[3], 0.9)
        love.graphics.circle("fill", px + 25, iy + 12, 10)
        -- Name and count
        love.graphics.setColor(0.9, 0.9, 0.85, 0.9)
        love.graphics.print(item.name, px + 45, iy + 3)
        love.graphics.setColor(1, 1, 0.7, 1)
        local count = mmoInventory[item.key] or 0
        love.graphics.printf(tostring(count), px, iy + 3, pw - 15, "right")
    end

    -- Equipment section
    local eqY = py + #items * 40 + 20
    love.graphics.setColor(0.6, 0.6, 0.7, 0.6)
    love.graphics.line(px + 10, eqY, px + pw - 10, eqY)
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(0.7, 0.7, 0.8, 0.8)
    love.graphics.print("Equipment", px + 15, eqY + 8)

    local axeName = equipment.axe and "Iron Axe" or "(none)"
    local pickName = equipment.pickaxe and "Iron Pickaxe" or "(none)"
    love.graphics.setFont(fonts.chat)
    love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
    love.graphics.print("Axe: " .. axeName, px + 20, eqY + 30)
    love.graphics.print("Pickaxe: " .. pickName, px + 20, eqY + 50)
end

-- B2 helper: auto-detect equipment slot from item type
local function getEquipSlotForItem(item)
    local t = item.type or ""
    -- Weapon types → main_hand (default), off_hand if main hand full
    if t:find("sword") or t:find("axe_weapon") or t:find("mace") or t:find("dagger")
       or t:find("staff") or t:find("wand") or t:find("bow") or t:find("crossbow")
       or t:find("spear") or t:find("scythe") then
        local eq = (rpg and rpg.equipment) or {}
        if eq.main_hand and not eq.off_hand then
            return "off_hand"
        end
        return "main_hand"
    end
    -- Shield → off_hand (default), main_hand if off_hand full
    if t:find("shield") then
        local eq = (rpg and rpg.equipment) or {}
        if eq.off_hand and not eq.main_hand then
            return "main_hand"
        end
        return "off_hand"
    end
    -- Armor slots
    if t:find("helm") or t:find("cap") or t:find("coif") or t:find("hood") then return "head" end
    if t:find("vest") or t:find("mail") or t:find("plate") and not t:find("leg") and not t:find("boot") and not t:find("gauntlet") then
        return "chest"
    end
    if t:find("pants") or t:find("legs") or t:find("greaves") then return "legs" end
    if t:find("boots") then return "feet" end
    if t:find("gloves") or t:find("gauntlets") then return "hands" end
    if t:find("undershirt") or t:find("chainmail") then return "undershirt" end
    if t:find("bracer") or t:find("armwrap") then return "arms" end
    -- Accessories — rings auto-find first empty slot
    if t:find("ring") then
        local eq = (rpg and rpg.equipment) or {}
        for i = 1, 6 do
            if not eq["ring" .. i] then return "ring" .. i end
        end
        return "ring1"
    end
    if t:find("amulet") or t:find("necklace") or t:find("pendant") then return "necklace" end
    if t:find("robe") then return "chest" end
    return "main_hand"  -- default fallback
end

-- Item display helpers (on game table to avoid upvalue overflow)
local function getItemRarityColor(item)
    if not item then return {0.85, 0.85, 0.8} end
    local r = item.rarity or "common"
    return game._itemUI.RARITY_COLORS[r] or {0.85, 0.85, 0.8}
end

local function getItemQualityColor(item)
    if not item or not item.quality then return nil end
    return game._itemUI.QUALITY_COLORS[item.quality] or nil
end

local function getItemDisplayName(item)
    if not item then return "?" end
    if item.displayName then return item.displayName end
    return item.name or item.type or "?"
end

local function isEquipmentItem(item)
    if not item or not item.type then return false end
    local t = item.type
    if item.stats or item.rarity or item.quality or item.sockets then return true end
    if t:find("sword") or t:find("axe_weapon") or t:find("mace") or t:find("dagger")
       or t:find("staff") or t:find("wand") or t:find("bow") or t:find("crossbow")
       or t:find("spear") or t:find("scythe") or t:find("shield") then return true end
    if t:find("helm") or t:find("cap") or t:find("coif") or t:find("hood")
       or t:find("vest") or t:find("mail") or t:find("plate") or t:find("robe")
       or t:find("pants") or t:find("legs") or t:find("greaves")
       or t:find("boots") or t:find("gloves") or t:find("gauntlets")
       or t:find("bracer") or t:find("armwrap") or t:find("undershirt") then return true end
    if t:find("ring") or t:find("amulet") or t:find("necklace") or t:find("pendant") then return true end
    return false
end

-- Item tooltip: draws a floating tooltip panel showing all procedural item stats
local function drawItemTooltip(W, H)
    if not game._itemUI.hoveredItem then return end
    local item = game._itemUI.hoveredItem
    local mx, my = game._itemUI.hoveredItemX, game._itemUI.hoveredItemY

    -- Build tooltip lines: { text, color, indent }
    local lines = {}
    local function addLine(text, color, indent)
        table.insert(lines, { text = text, color = color or {0.8, 0.8, 0.8}, indent = indent or 0 })
    end

    -- Item name (colored by rarity)
    local nameColor = game.getItemRarityColor(item)
    addLine(game.getItemDisplayName(item), nameColor)

    -- Quality badge
    if item.quality then
        local qc = game.getItemQualityColor(item) or {0.6, 0.6, 0.6}
        addLine(item.quality:sub(1,1):upper() .. item.quality:sub(2) .. " Quality", qc)
    end

    -- Rarity
    if item.rarity then
        local rc = game.getItemRarityColor(item)
        local rName = (item.rarity or ""):gsub("_", " ")
        rName = rName:gsub("(%a)([%w]*)", function(a, b) return a:upper() .. b end)
        addLine(rName, {rc[1] * 0.8, rc[2] * 0.8, rc[3] * 0.8})
    end

    -- Type
    if item.type then
        local typeName = item.type:gsub("_", " ")
        typeName = typeName:gsub("(%a)([%w]*)", function(a, b) return a:upper() .. b end)
        addLine(typeName, {0.5, 0.5, 0.6})
    end

    -- Separator
    addLine("---", {0.3, 0.3, 0.4})

    -- Base stats from .stats field
    if item.stats then
        local statLabels = {
            damage = "Damage", magicDamage = "Magic Dmg", defense = "Defense",
            magicResist = "Magic Resist", speed = "Atk Speed", critBonus = "Crit Bonus",
            blockChance = "Block Chance", range = "Range", hpBonus = "HP Bonus",
            manaBonus = "Mana Bonus", staminaBonus = "Stamina Bonus",
            lifeSteal = "Life Steal", hpRegen = "HP Regen", manaRegen = "Mana Regen",
            dodgeBonus = "Dodge", armorPen = "Armor Pen",
        }
        local statOrder = { "damage", "magicDamage", "defense", "magicResist", "speed",
            "critBonus", "blockChance", "range", "hpBonus", "manaBonus", "staminaBonus",
            "lifeSteal", "hpRegen", "manaRegen", "dodgeBonus", "armorPen" }
        for _, key in ipairs(statOrder) do
            local val = item.stats[key]
            if val and val ~= 0 then
                local label = statLabels[key] or key
                local valStr
                if key == "critBonus" or key == "blockChance" or key == "lifeSteal"
                   or key == "dodgeBonus" or key == "armorPen" then
                    valStr = string.format("%+.0f%%", val * 100)
                elseif key == "speed" then
                    valStr = string.format("%.2f", val)
                else
                    valStr = string.format("%+d", val)
                end
                local statColor = val > 0 and {0.4, 0.9, 0.4} or {0.9, 0.4, 0.4}
                addLine("  " .. label .. ": " .. valStr, statColor, 4)
            end
        end
    end

    -- Prefix/Suffix affixes
    if item.prefix then
        addLine("Prefix: " .. item.prefix.name, {0.5, 0.8, 1})
        if item.prefix.bonuses then
            for k, v in pairs(item.prefix.bonuses) do
                local valStr = type(v) == "number" and (v < 1 and string.format("+%.0f%%", v * 100) or string.format("+%d", v)) or tostring(v)
                addLine("  " .. k:gsub("_", " ") .. " " .. valStr, {0.4, 0.7, 0.9}, 8)
            end
        end
    end
    if item.suffix then
        addLine("Suffix: " .. item.suffix.name, {0.5, 0.8, 1})
        if item.suffix.bonuses then
            for k, v in pairs(item.suffix.bonuses) do
                local valStr = type(v) == "number" and (v < 1 and string.format("+%.0f%%", v * 100) or string.format("+%d", v)) or tostring(v)
                addLine("  " .. k:gsub("_", " ") .. " " .. valStr, {0.4, 0.7, 0.9}, 8)
            end
        end
    end

    -- Sockets
    if item.sockets and item.sockets > 0 then
        local gems = item.socketedGems or {}
        local filled = #gems
        addLine("Sockets: " .. filled .. "/" .. item.sockets, {0.9, 0.7, 0.2})
        for _, gem in ipairs(gems) do
            local gemName = type(gem) == "table" and (gem.name or gem.type or "gem") or tostring(gem)
            addLine("  [" .. gemName .. "]", {0.6, 0.9, 0.6}, 8)
        end
        for _ = filled + 1, item.sockets do
            addLine("  [ empty ]", {0.4, 0.4, 0.5}, 8)
        end
    end

    -- Augment
    if item.augment then
        local augName = type(item.augment) == "table" and (item.augment.name or "Augmented") or tostring(item.augment)
        addLine("Augment: " .. augName, {1, 0.6, 0.2})
    end

    -- Set bonus
    if item.setId then
        addLine("Set: " .. (item.setId:gsub("_", " "):gsub("(%a)([%w]*)", function(a, b) return a:upper() .. b end)), {0.2, 1, 0.6})
    end

    -- Unique effect
    if item.uniqueEffect then
        local ueName = type(item.uniqueEffect) == "table" and (item.uniqueEffect.name or item.uniqueEffect.type or "Unique") or tostring(item.uniqueEffect)
        addLine("Unique: " .. ueName, {1, 0.85, 0.3})
    end

    -- Weapon special
    if item.weaponSpecial then
        local wsName = type(item.weaponSpecial) == "table" and (item.weaponSpecial.name or "Special") or tostring(item.weaponSpecial)
        addLine("Special: " .. wsName, {1, 0.5, 0.5})
    end

    -- Wand properties
    if item.wandProps then
        addLine("Wand Spells:", {0.6, 0.4, 1})
        if item.wandProps.spells then
            for _, spell in ipairs(item.wandProps.spells) do
                local spName = type(spell) == "table" and (spell.name or "spell") or tostring(spell)
                addLine("  " .. spName, {0.5, 0.4, 0.9}, 8)
            end
        end
    end

    -- Inscription slots
    if item.inscriptionSlots and item.inscriptionSlots > 0 then
        local inscriptions = item.inscriptions or {}
        addLine("Inscriptions: " .. #inscriptions .. "/" .. item.inscriptionSlots, {0.8, 0.6, 1})
    end

    -- Durability
    if item.durability and item.maxDurability then
        local durRatio = item.maxDurability > 0 and (item.durability / item.maxDurability) or 0
        local durColor = durRatio > 0.5 and {0.3, 0.8, 0.3} or (durRatio > 0.25 and {0.8, 0.8, 0.2} or {0.9, 0.2, 0.2})
        addLine("Durability: " .. item.durability .. "/" .. item.maxDurability, durColor)
    end

    -- Calculate tooltip dimensions
    local lineH = 14
    local tooltipW = 220
    local tooltipH = #lines * lineH + 12

    -- Position tooltip near mouse, keep on screen
    local tx = mx + 16
    local ty = my
    if tx + tooltipW > W - 5 then tx = mx - tooltipW - 8 end
    if ty + tooltipH > H - 5 then ty = H - tooltipH - 5 end
    if ty < 5 then ty = 5 end

    -- Draw tooltip background
    love.graphics.setColor(0.04, 0.04, 0.08, 0.95)
    love.graphics.rectangle("fill", tx, ty, tooltipW, tooltipH, 4, 4)
    -- Rarity-colored border
    local borderColor = game.getItemRarityColor(item)
    love.graphics.setColor(borderColor[1], borderColor[2], borderColor[3], 0.6)
    love.graphics.rectangle("line", tx, ty, tooltipW, tooltipH, 4, 4)

    -- Draw lines
    love.graphics.setFont(fonts.npc)
    local ly = ty + 6
    for _, line in ipairs(lines) do
        if line.text == "---" then
            love.graphics.setColor(line.color[1], line.color[2], line.color[3], 0.4)
            love.graphics.line(tx + 8, ly + 5, tx + tooltipW - 8, ly + 5)
        else
            love.graphics.setColor(line.color[1], line.color[2], line.color[3], 1)
            love.graphics.print(line.text, tx + 6 + (line.indent or 0), ly)
        end
        ly = ly + lineH
    end
end

-- Draw loot notification popups (right side, stacked)
local function drawLootNotifications(W, H)
    if #game._itemUI.lootNotifications == 0 then return end
    love.graphics.setFont(fonts.chat)
    local notifH = 36
    local notifW = 260
    local baseX = W - notifW - 10
    local baseY = H - 60

    for i = #game._itemUI.lootNotifications, 1, -1 do
        local notif = game._itemUI.lootNotifications[i]
        local ny = baseY - (i - 1) * (notifH + 4)
        local alpha = notif.alpha or 1

        -- Background
        local rc = game._itemUI.RARITY_COLORS[notif.item.rarity or "common"] or {0.5, 0.5, 0.5}
        love.graphics.setColor(0.05, 0.05, 0.1, 0.9 * alpha)
        love.graphics.rectangle("fill", baseX, ny, notifW, notifH, 4, 4)
        love.graphics.setColor(rc[1], rc[2], rc[3], 0.7 * alpha)
        love.graphics.rectangle("line", baseX, ny, notifW, notifH, 4, 4)

        -- Source label
        local srcLabel = notif.source == "boss" and "BOSS DROP" or (notif.source == "chest" and "CHEST" or "LOOT")
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(0.6, 0.6, 0.5, 0.7 * alpha)
        love.graphics.print(srcLabel, baseX + 6, ny + 2)

        -- Item name (colored by rarity)
        love.graphics.setFont(fonts.chat)
        love.graphics.setColor(rc[1], rc[2], rc[3], alpha)
        local displayName = game.getItemDisplayName(notif.item)
        if #displayName > 30 then displayName = displayName:sub(1, 28) .. ".." end
        love.graphics.print(displayName, baseX + 6, ny + 16)

        -- Quality badge if present
        if notif.item.quality then
            local qc = game.getItemQualityColor(notif.item) or {0.5, 0.5, 0.5}
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(qc[1], qc[2], qc[3], 0.8 * alpha)
            love.graphics.printf(notif.item.quality, baseX, ny + 2, notifW - 6, "right")
        end
    end
end

-- B1: Equipment panel — shows all 14 equipment slots with durability
local function drawEquipmentPanel(W, H)
    local mmoInventory = getMmoInventory()
    if not ui.showEquipment then return end

    local panelW = 340
    local panelX = W - panelW - 10
    local panelY = 40
    local panelH = H - 80

    -- Panel background
    love.graphics.setColor(0.05, 0.05, 0.1, 0.92)
    love.graphics.rectangle("fill", panelX, panelY, panelW, panelH, 8, 8)
    love.graphics.setColor(0.3, 0.3, 0.4, 0.6)
    love.graphics.rectangle("line", panelX, panelY, panelW, panelH, 8, 8)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.9, 0.85, 0.4, 1)
    love.graphics.printf("Equipment", panelX, panelY + 8, panelW, "center")

    -- Equipment slots (18 total, 2 columns of 9)
    local slotNames = {
        "head", "chest", "undershirt", "arms", "hands", "legs", "feet", "main_hand", "off_hand",
        "ring1", "ring2", "ring3", "ring4", "ring5", "ring6", "necklace"
    }
    local slotLabels = {
        head = "Head", chest = "Chest", undershirt = "Undershirt", arms = "Arms",
        hands = "Hands", legs = "Legs", feet = "Feet",
        main_hand = "Main Hand", off_hand = "Off Hand",
        ring1 = "Ring 1", ring2 = "Ring 2", ring3 = "Ring 3",
        ring4 = "Ring 4", ring5 = "Ring 5", ring6 = "Ring 6",
        necklace = "Necklace"
    }

    local eq = (rpg and rpg.equipment) or {}
    local allItems = mmoInventory.items or {}
    local colW = (panelW - 20) / 2
    local startY = panelY + 42 - ui.equipmentScroll
    local slotH = 60
    equipSlotButtons = {}

    -- Check for low durability warning
    local hasLowDurability = false

    local slotsPerCol = math.ceil(#slotNames / 2)
    for idx, slot in ipairs(slotNames) do
        local col = (idx <= slotsPerCol) and 0 or 1
        local row = (idx <= slotsPerCol) and (idx - 1) or (idx - slotsPerCol - 1)
        local sx = panelX + 10 + col * colW
        local sy = startY + row * slotH

        -- Skip if off-screen
        if sy + slotH > panelY + 35 and sy < panelY + panelH then
            -- Slot background
            love.graphics.setColor(0.1, 0.12, 0.18, 0.8)
            love.graphics.rectangle("fill", sx, sy, colW - 6, slotH - 4, 4, 4)

            -- Slot label
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.5, 0.5, 0.6, 0.8)
            love.graphics.print(slotLabels[slot] or slot, sx + 4, sy + 2)

            -- Item name or empty
            local itemId = eq[slot]
            local itemName = "Empty"
            local itemObj = nil
            if itemId then
                for _, it in ipairs(allItems) do
                    if it.id == itemId then itemObj = it; itemName = game.getItemDisplayName(it); break end
                end
                if not itemObj then itemName = "Equipped" end
            end

            love.graphics.setFont(fonts.chat)
            if itemObj then
                -- Color by rarity
                local rc = game.getItemRarityColor(itemObj)
                love.graphics.setColor(rc[1], rc[2], rc[3], 1)
                -- Truncate long names
                if #itemName > 18 then itemName = itemName:sub(1, 16) .. ".." end
            elseif itemId then
                love.graphics.setColor(0.85, 0.85, 0.7, 1)
            else
                love.graphics.setColor(0.4, 0.4, 0.5, 0.5)
            end
            love.graphics.print(itemName, sx + 4, sy + 16)

            -- Socket indicator dots (small colored circles)
            if itemObj and itemObj.sockets and itemObj.sockets > 0 then
                local gems = itemObj.socketedGems or {}
                for si = 1, itemObj.sockets do
                    local dotX = sx + colW - 12 - (itemObj.sockets - si) * 8
                    local dotY = sy + 6
                    if si <= #gems then
                        love.graphics.setColor(0.3, 0.9, 0.3, 0.9) -- filled
                    else
                        love.graphics.setColor(0.3, 0.3, 0.4, 0.6) -- empty
                    end
                    love.graphics.circle("fill", dotX, dotY, 3)
                end
            end

            -- Hover detection for tooltip
            if itemObj then
                local emx, emy = love.mouse.getPosition()
                if emx >= sx and emx <= sx + colW - 6 and emy >= sy and emy <= sy + slotH - 4 then
                    game._itemUI.hoveredItem = itemObj
                    game._itemUI.hoveredItemX = emx
                    game._itemUI.hoveredItemY = emy
                end
            end

            -- Durability bar
            local dur = durabilityData[slot]
            if dur and dur.max and dur.max > 0 then
                local ratio = dur.current / dur.max
                local barW = colW - 12
                local barH = 6
                local barX = sx + 4
                local barY = sy + 32

                -- Background
                love.graphics.setColor(0.15, 0.15, 0.2, 0.8)
                love.graphics.rectangle("fill", barX, barY, barW, barH, 2, 2)

                -- Fill color based on ratio
                if ratio > 0.5 then
                    love.graphics.setColor(0.2, 0.8, 0.2, 0.9)
                elseif ratio > 0.25 then
                    love.graphics.setColor(0.8, 0.8, 0.2, 0.9)
                else
                    love.graphics.setColor(0.9, 0.2, 0.2, 0.9)
                    hasLowDurability = true
                end
                love.graphics.rectangle("fill", barX, barY, barW * ratio, barH, 2, 2)

                -- Durability text
                love.graphics.setFont(fonts.npc)
                love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
                love.graphics.print(dur.current .. "/" .. dur.max, sx + 4, sy + 40)
            end

            -- Buttons for equipped items
            if itemId then
                local btnY = sy + slotH - 18
                -- Remove button
                local rmX = sx + colW - 80
                love.graphics.setColor(0.4, 0.15, 0.15, 0.8)
                love.graphics.rectangle("fill", rmX, btnY, 34, 14, 3, 3)
                love.graphics.setFont(fonts.npc)
                love.graphics.setColor(1, 0.6, 0.6, 0.9)
                love.graphics.printf("Rm", rmX, btnY + 1, 34, "center")
                table.insert(equipSlotButtons, { slot = slot, action = "remove", x = rmX, y = btnY, w = 34, h = 14 })

                -- Repair button (if durability < max)
                if dur and dur.current < dur.max then
                    local rpX = sx + colW - 42
                    love.graphics.setColor(0.15, 0.3, 0.4, 0.8)
                    love.graphics.rectangle("fill", rpX, btnY, 34, 14, 3, 3)
                    love.graphics.setColor(0.6, 0.9, 1, 0.9)
                    love.graphics.printf("Fix", rpX, btnY + 1, 34, "center")
                    table.insert(equipSlotButtons, { slot = slot, action = "repair", x = rpX, y = btnY, w = 34, h = 14 })
                end
            end
        end
    end

    -- Dual-wield combo display
    if rpg and rpg.dualWieldCombo then
        local comboY = panelY + panelH - 80
        love.graphics.setColor(0.08, 0.08, 0.15, 0.9)
        love.graphics.rectangle("fill", panelX + 5, comboY - 4, panelW - 10, 60, 4, 4)
        love.graphics.setColor(0.4, 0.35, 0.2, 0.6)
        love.graphics.rectangle("line", panelX + 5, comboY - 4, panelW - 10, 60, 4, 4)

        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(1, 0.85, 0.3, 1)
        love.graphics.printf(rpg.dualWieldCombo.name or "Combo", panelX, comboY, panelW, "center")
        love.graphics.setColor(0.7, 0.8, 0.7, 0.8)
        love.graphics.printf(rpg.dualWieldCombo.description or "", panelX + 10, comboY + 14, panelW - 20, "center")
        -- Show unlocked skills
        if rpg.dualWieldCombo.skills then
            for i, skill in ipairs(rpg.dualWieldCombo.skills) do
                love.graphics.setColor(0.5, 0.8, 1, 0.9)
                love.graphics.print("  " .. skill, panelX + 20, comboY + 32 + (i-1)*12)
            end
        end
    end

    -- Low durability warning (pulsing red)
    if hasLowDurability then
        local pulse = 0.5 + 0.5 * math.sin(love.timer.getTime() * 4)
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(1, 0.2, 0.2, pulse)
        love.graphics.printf("! Low Durability !", panelX, panelY + panelH - 20, panelW, "center")
    end
end

-- B2: Enhanced items tab with filters and equip/use buttons
local function drawItemsTab(px, py, pw, ph)
    local mmoInventory = getMmoInventory()
    local equipment    = getEquipment()
    love.graphics.setFont(fonts.chat)
    local items = mmoInventory.items or {}
    local placeableTypes = { forge = true, iron_anvil = true, storage_chest = true, wall = true, door = true, raft = true, bridge = true }

    -- Equipment item types (weapons + armor)
    local equipmentTypes = {
        iron_sword = true, iron_axe_weapon = true, bronze_sword = true, dagger = true,
        iron_mace = true, staff = true, bow = true, crossbow = true, wand = true,
        iron_shield = true, bronze_shield = true, tower_shield = true,
        leather_cap = true, iron_helm = true, chain_coif = true, plate_helm = true,
        leather_vest = true, chain_mail = true, iron_plate = true, robe = true,
        leather_pants = true, chain_legs = true, plate_legs = true,
        leather_boots = true, iron_boots = true, plate_boots = true,
        leather_gloves = true, iron_gauntlets = true, plate_gauntlets = true,
        ring = true, amulet = true, cape = true, belt = true, earring = true, trinket = true,
    }
    -- Consumable item types (food, potions, scrolls)
    local consumableTypes = {}
    local foodKeys = {
        "cooked_fish", "bread", "stew", "mushroom", "shellfish", "seaweed",
        "herb_tea", "grilled_meat", "berry_jam",
        "potion_health", "potion_mana", "potion_strength", "potion_agility",
        "potion_intellect", "potion_resistance", "potion_speed",
        "elixir_vigor", "elixir_fortitude", "antidote",
        "ale", "mead", "wine", "spirits", "fortified_ale", "battle_brew",
        "scroll_of_protection", "scroll_of_strength", "scroll_of_haste",
    }
    for _, k in ipairs(foodKeys) do consumableTypes[k] = true end

    -- Filter subtabs
    local filters = { "all", "equipment", "consumable", "material" }
    local fW = pw / #filters
    love.graphics.setFont(fonts.npc)
    for i, f in ipairs(filters) do
        local fx = px + (i - 1) * fW
        if ui.inventoryItemFilter == f then
            love.graphics.setColor(0.2, 0.25, 0.35, 0.9)
        else
            love.graphics.setColor(0.1, 0.12, 0.18, 0.7)
        end
        love.graphics.rectangle("fill", fx + 2, py, fW - 4, 20, 3, 3)
        love.graphics.setColor(0.8, 0.8, 0.9, ui.inventoryItemFilter == f and 1 or 0.5)
        love.graphics.printf(f:sub(1,1):upper() .. f:sub(2), fx + 2, py + 3, fW - 4, "center")
    end

    local contentY = py + 26
    love.graphics.setFont(fonts.chat)
    inventoryItemButtons = {}

    -- Filter items
    local filtered = {}
    for _, item in ipairs(items) do
        local t = item.type or ""
        local isEquip = equipmentTypes[t] or game.isEquipmentItem(item)
        local isConsumable = consumableTypes[t] or (item.consumableType ~= nil)
        local show = false
        if ui.inventoryItemFilter == "all" then
            show = true
        elseif ui.inventoryItemFilter == "equipment" then
            show = isEquip
        elseif ui.inventoryItemFilter == "consumable" then
            show = isConsumable
        elseif ui.inventoryItemFilter == "material" then
            show = not isEquip and not isConsumable and not placeableTypes[t]
        end
        if show then table.insert(filtered, item) end
    end

    if #filtered == 0 then
        love.graphics.setColor(0.5, 0.5, 0.6, 0.5)
        love.graphics.printf("No items", px, contentY + 10, pw, "center")
        return
    end

    for i, item in ipairs(filtered) do
        local iy = contentY + (i - 1) * 32
        if iy + 32 > py + ph then break end
        local t = item.type or ""

        local isEquip = equipmentTypes[t] or game.isEquipmentItem(item)
        local isConsumable = consumableTypes[t] or (item.consumableType ~= nil)

        -- Row background (rarity-tinted for equipment)
        if isEquip then
            local rc = game.getItemRarityColor(item)
            love.graphics.setColor(rc[1] * 0.15, rc[2] * 0.15, rc[3] * 0.2 + 0.05, 0.8)
        elseif isConsumable then
            love.graphics.setColor(0.12, 0.18, 0.12, 0.8)
        elseif placeableTypes[t] then
            love.graphics.setColor(0.12, 0.18, 0.12, 0.8)
        else
            love.graphics.setColor(0.15, 0.15, 0.2, 0.7)
        end
        love.graphics.rectangle("fill", px + 8, iy, pw - 16, 30, 4, 4)

        -- Item name (colored by rarity for equipment)
        local displayName = game.getItemDisplayName(item)
        if #displayName > 26 then displayName = displayName:sub(1, 24) .. ".." end
        if isEquip or item.rarity then
            local rc = game.getItemRarityColor(item)
            love.graphics.setColor(rc[1], rc[2], rc[3], 1)
        elseif isConsumable and item.quality then
            local qc = game.getItemQualityColor(item) or {0.7, 0.9, 0.7}
            love.graphics.setColor(qc[1], qc[2], qc[3], 1)
        else
            love.graphics.setColor(0.85, 0.85, 0.8, 0.9)
        end
        love.graphics.print(displayName, px + 14, iy + 3)

        -- Socket dots + quality badge on same row
        if item.sockets and item.sockets > 0 then
            local gems = item.socketedGems or {}
            love.graphics.setFont(fonts.npc)
            for si = 1, math.min(item.sockets, 4) do
                local dotX = px + pw - 72 - (item.sockets - si) * 7
                local dotY = iy + 7
                if si <= #gems then
                    love.graphics.setColor(0.3, 0.9, 0.3, 0.9)
                else
                    love.graphics.setColor(0.3, 0.3, 0.4, 0.6)
                end
                love.graphics.circle("fill", dotX, dotY, 2.5)
            end
            love.graphics.setFont(fonts.chat)
        end

        -- Quantity if > 1
        if item.quantity and item.quantity > 1 then
            love.graphics.setColor(0.6, 0.6, 0.5, 0.7)
            love.graphics.print("x" .. item.quantity, px + 14, iy + 17)
        end

        -- Hover detection for tooltip
        local imx, imy = love.mouse.getPosition()
        if imx >= px + 8 and imx <= px + pw - 16 and imy >= iy and imy <= iy + 30 then
            game._itemUI.hoveredItem = item
            game._itemUI.hoveredItemX = imx
            game._itemUI.hoveredItemY = imy
        end

        -- Action buttons
        local btnX = px + pw - 62
        if isEquip then
            -- Equip button
            love.graphics.setColor(0.2, 0.3, 0.5, 0.8)
            love.graphics.rectangle("fill", btnX, iy + 4, 46, 22, 3, 3)
            love.graphics.setColor(0.6, 0.8, 1, 0.9)
            love.graphics.setFont(fonts.npc)
            love.graphics.printf("Equip", btnX, iy + 8, 46, "center")
            love.graphics.setFont(fonts.chat)
            table.insert(inventoryItemButtons, { item = item, action = "equip", x = btnX, y = iy + 4, w = 46, h = 22 })
        elseif isConsumable then
            -- Use button
            love.graphics.setColor(0.2, 0.4, 0.2, 0.8)
            love.graphics.rectangle("fill", btnX, iy + 4, 46, 22, 3, 3)
            love.graphics.setColor(0.6, 1, 0.6, 0.9)
            love.graphics.setFont(fonts.npc)
            love.graphics.printf("Use", btnX, iy + 8, 46, "center")
            love.graphics.setFont(fonts.chat)
            table.insert(inventoryItemButtons, { item = item, action = "use", x = btnX, y = iy + 4, w = 46, h = 22 })
        elseif placeableTypes[t] then
            -- Place button
            love.graphics.setColor(0.3, 0.7, 0.3, 0.8)
            love.graphics.setFont(fonts.npc)
            love.graphics.printf("Place", btnX, iy + 8, 46, "center")
            love.graphics.setFont(fonts.chat)
            table.insert(inventoryItemButtons, { item = item, action = "place", x = btnX, y = iy + 4, w = 46, h = 22 })
        end
    end
end

-- B3: Enhanced crafting tab — uses server-driven recipes with station filters
local function drawCraftingTab(px, py, pw, ph)
    local mmoInventory = getMmoInventory()
    -- Info: inventory crafting only shows basic (no-station) recipes
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("Basic Crafting  (forge/anvil/etc require stations)", px + 10, py + 2, pw - 20, "center")

    local ry = py + 22
    love.graphics.setFont(fonts.chat)
    craftingButtons = {}

    -- Use server recipes if available, fall back to hardcoded
    local recipeList = recipes
    if not recipeList or #recipeList == 0 then
        recipeList = {
            { id = "wooden_sword", name = "Wooden Sword", station = "none", materials = { { resource = "wood", amount = 8 } } },
            { id = "wooden_shield", name = "Wooden Shield", station = "none", materials = { { resource = "wood", amount = 6 } } },
            { id = "wooden_wand", name = "Wooden Wand", station = "none", materials = { { resource = "wood", amount = 5 } } },
            { id = "wooden_bow", name = "Wooden Bow", station = "none", materials = { { resource = "wood", amount = 10 } } },
            { id = "forge", name = "Forge", station = "none", materials = { { resource = "wood", amount = 20 }, { resource = "stone", amount = 15 } } },
            { id = "storage_chest", name = "Storage Chest", station = "none", materials = { { resource = "wood", amount = 10 } } },
            { id = "wall", name = "Wall", station = "none", materials = { { resource = "wood", amount = 5 } } },
        }
    end

    local shown = 0
    for _, recipe in ipairs(recipeList) do
        local station = recipe.station or recipe.workstation or "none"
        -- Only show basic (no station required) recipes in inventory crafting
        if station == "none" or station == "basic" then
            local itemY = ry + shown * 48
            if itemY + 48 > py + ph then break end

            -- Recipe card
            love.graphics.setColor(0.1, 0.12, 0.18, 0.8)
            love.graphics.rectangle("fill", px + 8, itemY, pw - 16, 44, 4, 4)

            -- Name
            love.graphics.setColor(0.9, 0.85, 0.6, 1)
            love.graphics.print(recipe.name or recipe.id or "?", px + 14, itemY + 3)

            -- Station badge
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.4, 0.5, 0.6, 0.7)
            love.graphics.print("[" .. station .. "]", px + 14, itemY + 18)

            -- Material costs with have/need coloring
            -- Normalize materials: server sends {wood=8, stone=15}, fallback uses {{resource="wood", amount=8}}
            local rawMats = recipe.materials or recipe.cost or {}
            local matList = {}
            if rawMats[1] then
                -- Array format
                matList = rawMats
            else
                -- Object format from server: {wood=8, stone=15}
                for res, amt in pairs(rawMats) do
                    if type(amt) == "number" then
                        table.insert(matList, { resource = res, amount = amt })
                    end
                end
            end

            local matStr = ""
            for mi, mat in ipairs(matList) do
                local resKey = mat.resource or mat.type or "?"
                local resName = resKey:gsub("_", " ")
                local need = mat.amount or mat.count or 1
                local have = mmoInventory[resKey] or 0
                if mi > 1 then matStr = matStr .. ", " end
                if have >= need then
                    matStr = matStr .. need .. " " .. resName
                else
                    matStr = matStr .. need .. " " .. resName .. " (" .. have .. ")"
                end
            end
            love.graphics.setColor(0.6, 0.6, 0.5, 0.7)
            love.graphics.print(matStr, px + 80, itemY + 18)
            love.graphics.setFont(fonts.chat)

            -- Can afford check
            local canAfford = true
            for _, mat in ipairs(matList) do
                local resKey = mat.resource or mat.type or ""
                local have = mmoInventory[resKey] or 0
                if have < (mat.amount or mat.count or 1) then canAfford = false; break end
            end

            -- Craft button
            local btnX = px + pw - 65
            if canAfford then
                love.graphics.setColor(0.2, 0.4, 0.2, 0.8)
            else
                love.graphics.setColor(0.3, 0.2, 0.2, 0.5)
            end
            love.graphics.rectangle("fill", btnX, itemY + 8, 50, 28, 4, 4)
            if canAfford then
                love.graphics.setColor(0.7, 1, 0.7, 0.9)
            else
                love.graphics.setColor(0.5, 0.4, 0.4, 0.5)
            end
            love.graphics.setFont(fonts.npc)
            love.graphics.printf("Craft", btnX, itemY + 15, 50, "center")
            love.graphics.setFont(fonts.chat)
            table.insert(craftingButtons, { recipe = recipe, x = btnX, y = itemY + 8, w = 50, h = 28, canAfford = canAfford })

            shown = shown + 1
        end
    end

    if shown == 0 then
        love.graphics.setColor(0.5, 0.5, 0.6, 0.5)
        love.graphics.printf("No recipes for this station", px, ry + 10, pw, "center")
    end
end

local function drawCompass(W, H)
    local myId = getMyId()
    local me = players[myId]
    if not me then return end

    local cx = W - 70
    local cy = 80
    local radius = 38

    -- Background circle
    love.graphics.setColor(0, 0, 0, 0.55)
    love.graphics.circle("fill", cx, cy, radius + 4)
    love.graphics.setColor(0.3, 0.3, 0.4, 0.5)
    love.graphics.setLineWidth(2)
    love.graphics.circle("line", cx, cy, radius + 4)
    love.graphics.setLineWidth(1)

    -- Cardinal directions
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.5)
    love.graphics.printf("N", cx - 6, cy - radius - 1, 12, "center")
    love.graphics.printf("S", cx - 6, cy + radius - 11, 12, "center")
    love.graphics.printf("W", cx - radius - 2, cy - 6, 12, "center")
    love.graphics.printf("E", cx + radius - 9, cy - 6, 12, "center")

    -- Helper: draw a directional arrow on the compass ring
    local function drawCompassArrow(targetX, targetY, color, label)
        local dx = targetX - me.x
        local dy = targetY - me.y
        local dist = math.sqrt(dx * dx + dy * dy)
        if dist < 1 then return end

        local angle = math.atan2(dy, dx)
        local arrowDist = radius - 6
        local ax = cx + math.cos(angle) * arrowDist
        local ay = cy + math.sin(angle) * arrowDist

        -- Arrow triangle
        local arrowSize = 7
        local tipX = cx + math.cos(angle) * (arrowDist + arrowSize)
        local tipY = cy + math.sin(angle) * (arrowDist + arrowSize)
        local perpAngle = angle + math.pi / 2
        local baseX1 = ax + math.cos(perpAngle) * 4
        local baseY1 = ay + math.sin(perpAngle) * 4
        local baseX2 = ax - math.cos(perpAngle) * 4
        local baseY2 = ay - math.sin(perpAngle) * 4

        love.graphics.setColor(color[1], color[2], color[3], 0.9)
        love.graphics.polygon("fill", tipX, tipY, baseX1, baseY1, baseX2, baseY2)

        -- Distance text
        local distText
        if dist > 10000 then
            distText = string.format("%.1fk", dist / 1000)
        else
            distText = tostring(math.floor(dist))
        end
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(color[1], color[2], color[3], 0.7)
        local labelX = cx + math.cos(angle) * (radius + 16)
        local labelY = cy + math.sin(angle) * (radius + 16)
        love.graphics.printf(label .. "\n" .. distText, labelX - 30, labelY - 10, 60, "center")
    end

    -- Town arrow (blue)
    if townPosition then
        drawCompassArrow(townPosition.x, townPosition.y, { 0.3, 0.6, 1.0 }, "Town")
    end

    -- Plot arrow (green) — only if player has a plot
    if overworld.myPlotId then
        for _, plot in pairs(overworld.plots) do
            if plot.id == overworld.myPlotId then
                local plotCenterX = plot.x + (plot.width or 512) / 2
                local plotCenterY = plot.y + (plot.height or 512) / 2
                drawCompassArrow(plotCenterX, plotCenterY, { 0.3, 0.9, 0.3 }, "Plot")
                break
            end
        end
    end
end

local function drawWorldMap(W, H)
    local myId = getMyId()
    local zone = getZone()
    local fadeIn = getFadeIn()
    local mapZoom = getMapZoom()
    -- Full-screen world map overlay
    love.graphics.setColor(0, 0, 0, 0.85)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Title
    love.graphics.setFont(fonts.title)
    if overworld.isHollowEarth then
        love.graphics.setColor(0.6, 0.4, 0.9, fadeIn)
        love.graphics.printf("Hollow Earth Map", 0, 10, W, "center")
    else
        love.graphics.setColor(0.9, 0.8, 0.3, fadeIn)
        love.graphics.printf("World Map", 0, 10, W, "center")
    end

    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.5, 0.5, 0.6, fadeIn * 0.6)
    love.graphics.printf("M/Esc: Close | Scroll/+/-: Zoom (" .. string.format("%.0f", mapZoom) .. "x)", 0, 34, W, "center")

    -- Map viewport
    local mapPad = 20
    local mapTop = 50
    local vpW = W - mapPad * 2
    local vpH = H - mapTop - 30

    -- World dimensions
    local worldW = (zone and zone.width) or 1024000
    local worldH = (zone and zone.height) or 1280000

    -- Base scale (fit whole world)
    local baseScaleX = vpW / worldW
    local baseScaleY = vpH / worldH
    local baseScale = math.min(baseScaleX, baseScaleY)
    local scale = baseScale * mapZoom

    -- Center on player when zoomed
    local me = players[myId]
    local centerWorldX = worldW / 2
    local centerWorldY = worldH / 2
    if me then
        centerWorldX = me.x
        centerWorldY = me.y
    end

    -- Map offset: center the view on player
    local mapCenterX = mapPad + vpW / 2
    local mapCenterY = mapTop + vpH / 2
    local mapX = mapCenterX - centerWorldX * scale
    local mapY = mapCenterY - centerWorldY * scale

    -- Clip to viewport
    love.graphics.setScissor(mapPad, mapTop, vpW, vpH)

    -- Render loaded chunks as colored tiles (no fog for unloaded)
    local chunkPxW = overworld.chunkSize * scale
    local chunkPxH = overworld.chunkSize * scale
    local minPx = math.max(1, chunkPxW)
    for _, chunk in pairs(overworld.chunks) do
        if chunk.biomeColor then
            local bc = chunk.biomeColor
            love.graphics.setColor(bc.r / 255, bc.g / 255, bc.b / 255, 0.9)
            local px = mapX + chunk.cx * overworld.chunkSize * scale
            local py = mapY + chunk.cy * overworld.chunkSize * scale
            -- Only draw if visible in viewport
            if px + minPx > mapPad and px < mapPad + vpW and py + minPx > mapTop and py < mapTop + vpH then
                love.graphics.rectangle("fill", px, py, math.max(minPx, chunkPxW + 0.5), math.max(minPx, chunkPxH + 0.5))
            end
        end
    end

    -- Draw rivers on world map
    if overworld.rivers and #overworld.rivers > 0 then
        love.graphics.setColor(0.16, 0.31, 0.63, 0.85)
        love.graphics.setLineWidth(math.max(1, 2 * mapZoom * 0.1))
        local tileWorldPx = 32  -- TILE_SIZE
        local tilesPerChunk = 16
        for _, river in ipairs(overworld.rivers) do
            local startWorldY = river.startCY * overworld.chunkSize
            local endWorldY = river.endCY * overworld.chunkSize
            local stepPx = math.max(overworld.chunkSize, overworld.chunkSize / (mapZoom * 0.1 + 1))
            local prevPx, prevPy = nil, nil
            for wy = startWorldY, endWorldY, stepPx do
                local worldTileY = wy / tileWorldPx
                local riverTileX = river.baseX * tilesPerChunk + math.sin(worldTileY * river.frequency + river.phase) * river.amplitude * tilesPerChunk
                local rwx = riverTileX * tileWorldPx
                local px = mapX + rwx * scale
                local py = mapY + wy * scale
                if prevPx and prevPy then
                    love.graphics.line(prevPx, prevPy, px, py)
                end
                prevPx = px
                prevPy = py
            end
        end
        love.graphics.setLineWidth(1)
    end

    -- Draw plots
    for _, plot in pairs(overworld.plots) do
        local px = mapX + plot.x * scale
        local py = mapY + plot.y * scale
        local pw = (plot.width or 512) * scale
        local ph = (plot.height or 512) * scale
        local isOwn = (overworld.myPlotId and plot.id == overworld.myPlotId)

        if isOwn then
            love.graphics.setColor(0.2, 0.9, 0.2, 0.6)
        else
            love.graphics.setColor(0.3, 0.5, 0.9, 0.4)
        end
        love.graphics.rectangle("fill", px, py, math.max(3, pw), math.max(3, ph))

        if isOwn then
            love.graphics.setColor(0.3, 1, 0.3, 0.9)
        else
            love.graphics.setColor(0.4, 0.6, 1, 0.7)
        end
        love.graphics.setLineWidth(2)
        love.graphics.rectangle("line", px, py, math.max(3, pw), math.max(3, ph))
        love.graphics.setLineWidth(1)

        -- Plot owner label (only if large enough on screen)
        if pw > 20 then
            love.graphics.setFont(fonts.npc)
            if isOwn then
                love.graphics.setColor(0.3, 1, 0.3, 0.9)
            else
                love.graphics.setColor(0.5, 0.7, 1, 0.7)
            end
            love.graphics.printf(plot.ownerName or "?", px, py + math.max(1, ph / 2 - 5), math.max(20, pw), "center")
        end
    end

    -- Town marker
    if townPosition then
        local tx = mapX + townPosition.x * scale
        local ty = mapY + townPosition.y * scale
        local iconSize = math.max(6, 4 + mapZoom * 0.5)
        love.graphics.setColor(0.9, 0.8, 0.2, 0.9)
        love.graphics.polygon("fill", tx, ty - iconSize, tx + iconSize * 0.75, ty, tx, ty + iconSize, tx - iconSize * 0.75, ty)
        love.graphics.setColor(1, 0.9, 0.3, 1)
        love.graphics.setFont(fonts.npc)
        love.graphics.printf("The Holy Dominion", tx - 50, ty + iconSize + 2, 100, "center")
    end

    -- Player position (pulsing white dot)
    if me then
        local px = mapX + me.x * scale
        local py = mapY + me.y * scale
        local pulse = 0.7 + math.sin(love.timer.getTime() * 4) * 0.3
        local dotSize = math.max(3, 2 + mapZoom * 0.3)
        love.graphics.setColor(1, 1, 1, pulse)
        love.graphics.circle("fill", px, py, dotSize)
        love.graphics.setColor(1, 1, 1, 0.5)
        love.graphics.circle("line", px, py, dotSize + 3)
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(1, 1, 1, 0.8)
        love.graphics.printf("You", px - 20, py + dotSize + 4, 40, "center")
    end

    love.graphics.setScissor()

    -- Viewport border
    love.graphics.setColor(0.3, 0.3, 0.4, 0.6)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", mapPad, mapTop, vpW, vpH)
    love.graphics.setLineWidth(1)

    -- Legend bar at bottom
    local legY = mapTop + vpH + 5
    love.graphics.setFont(fonts.npc)

    love.graphics.setColor(0.9, 0.8, 0.2, 0.8)
    love.graphics.rectangle("fill", mapPad, legY, 8, 8)
    love.graphics.setColor(0.7, 0.7, 0.7, 0.7)
    love.graphics.print("Town", mapPad + 12, legY - 1)

    love.graphics.setColor(0.2, 0.9, 0.2, 0.8)
    love.graphics.rectangle("fill", mapPad + 60, legY, 8, 8)
    love.graphics.setColor(0.7, 0.7, 0.7, 0.7)
    love.graphics.print("Your Plot", mapPad + 72, legY - 1)

    love.graphics.setColor(0.3, 0.5, 0.9, 0.8)
    love.graphics.rectangle("fill", mapPad + 140, legY, 8, 8)
    love.graphics.setColor(0.7, 0.7, 0.7, 0.7)
    love.graphics.print("Other Plots", mapPad + 152, legY - 1)

    love.graphics.setColor(0.16, 0.31, 0.63, 0.8)
    love.graphics.rectangle("fill", mapPad + 224, legY, 8, 8)
    love.graphics.setColor(0.7, 0.7, 0.7, 0.7)
    love.graphics.print("Rivers", mapPad + 236, legY - 1)

    love.graphics.setColor(1, 1, 1, 0.8)
    love.graphics.circle("fill", mapPad + 284, legY + 4, 3)
    love.graphics.setColor(0.7, 0.7, 0.7, 0.7)
    love.graphics.print("You", mapPad + 290, legY - 1)
end

local function drawZoneList(W, H)
    local zone = getZone()
    local fadeIn = getFadeIn()
    -- Semi-transparent overlay
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.9, 0.8, 0.3, fadeIn)
    love.graphics.printf("Zone Map", 0, 40, W, "center")

    love.graphics.setFont(fonts.zone)
    local startY = 90
    local listW = 350
    local itemH = 40
    local listX = (W - listW) / 2

    for i, z in ipairs(zoneList) do
        local y = startY + (i - 1) * (itemH + 6)
        local isCurrent = zone and zone.id == z.id

        if isCurrent then
            love.graphics.setColor(0.15, 0.3, 0.15, 0.9)
        else
            love.graphics.setColor(0.1, 0.1, 0.18, 0.85)
        end
        love.graphics.rectangle("fill", listX, y, listW, itemH, 6, 6)

        if isCurrent then
            love.graphics.setColor(0.3, 0.7, 0.3, 0.7)
        else
            love.graphics.setColor(0.3, 0.3, 0.4, 0.5)
        end
        love.graphics.rectangle("line", listX, y, listW, itemH, 6, 6)

        -- Zone name
        love.graphics.setColor(1, 1, 1, fadeIn)
        love.graphics.print(z.name, listX + 12, y + 4)

        -- Type and players
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(0.6, 0.6, 0.7, fadeIn * 0.7)
        love.graphics.print(z.type .. " | " .. (z.playerCount or 0) .. " players", listX + 12, y + 22)

        -- Badges
        if z.pvpEnabled then
            love.graphics.setColor(0.9, 0.3, 0.3, fadeIn * 0.7)
            love.graphics.print("PVP", listX + listW - 35, y + 4)
        end

        love.graphics.setFont(fonts.zone)
    end

    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(0.5, 0.5, 0.6, fadeIn * 0.6)
    love.graphics.printf("Press M or Escape to close", 0, startY + #zoneList * (itemH + 6) + 15, W, "center")
end

local function hexToRGB(hex)
    if not hex or type(hex) ~= "string" then return 0.8, 0.8, 0.8 end
    hex = hex:gsub("#", "")
    if #hex ~= 6 then return 0.8, 0.8, 0.8 end
    local r = tonumber(hex:sub(1, 2), 16) / 255
    local g = tonumber(hex:sub(3, 4), 16) / 255
    local b = tonumber(hex:sub(5, 6), 16) / 255
    return r or 0.8, g or 0.8, b or 0.8
end

function inventory_draw.init(gameRef, ctx)
    game            = gameRef
    fonts           = ctx.fonts
    ui              = ctx.ui
    rpg             = ctx.rpg
    players         = ctx.players
    camera          = ctx.camera
    zoneList        = ctx.zoneList
    getMmoInventory = ctx.getMmoInventory
    getEquipment    = ctx.getEquipment
    getMyId         = ctx.getMyId
    getZone         = ctx.getZone
    getFadeIn       = ctx.getFadeIn
    getMapZoom      = ctx.getMapZoom
    -- Register all functions onto the game table
    gameRef.drawInventory = drawInventory
    gameRef.drawResourcesTab = drawResourcesTab
    gameRef.getEquipSlotForItem = getEquipSlotForItem
    gameRef.getItemRarityColor = getItemRarityColor
    gameRef.getItemQualityColor = getItemQualityColor
    gameRef.getItemDisplayName = getItemDisplayName
    gameRef.isEquipmentItem = isEquipmentItem
    gameRef.drawItemTooltip = drawItemTooltip
    gameRef.drawLootNotifications = drawLootNotifications
    gameRef.drawEquipmentPanel = drawEquipmentPanel
    gameRef.drawItemsTab = drawItemsTab
    gameRef.drawCraftingTab = drawCraftingTab
    gameRef.drawCompass = drawCompass
    gameRef.drawWorldMap = drawWorldMap
    gameRef.drawZoneList = drawZoneList
    gameRef.hexToRGB = hexToRGB
end

inventory_draw.getEquipSlotButtons     = function() return equipSlotButtons end
inventory_draw.getInventoryItemButtons = function() return inventoryItemButtons end
inventory_draw.getCraftingButtons      = function() return craftingButtons end

return inventory_draw
