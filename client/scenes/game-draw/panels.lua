-- scenes/game-draw/panels.lua
-- Portal, NPC shop, bank, trade, and admin panel draw and input handlers.

local panels = {}

-- 'game' is an alias for the game table — all function bodies can use game._xxx as before
local game
local fonts, ui, rpg

local getAccount      -- getter: returns current account (reassignable in game.lua)
local getMmoInventory -- getter: returns current mmoInventory
local getClient       -- getter: returns current client socket

-- Portal Travel Panel
-- ---------------------------------------------------------------------------
local PORTAL_W = 420
local PORTAL_H = 420
local PORTAL_ROW_H = 38
local PORTAL_LIST_TOP = 80     -- y offset from panel top where list starts
local PORTAL_LIST_BOT = 50     -- reserved space at bottom for message/close

local function drawPortalPanel(W, H)
    local pw = math.min(PORTAL_W, W - 40)
    local ph = math.min(PORTAL_H, H - 60)
    local px = math.floor((W - pw) / 2)
    local py = math.floor((H - ph) / 2)

    -- Store panel rect for click handling
    game._portal._panelX = px
    game._portal._panelY = py
    game._portal._panelW = pw
    game._portal._panelH = ph

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background (dark with blue/purple tint)
    love.graphics.setColor(0.05, 0.05, 0.14, 0.96)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    -- Border (blue/purple)
    love.graphics.setColor(0.35, 0.3, 0.7, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)
    love.graphics.setLineWidth(1)

    -- Title bar
    love.graphics.setColor(0.08, 0.06, 0.18, 0.9)
    love.graphics.rectangle("fill", px, py, pw, 30, 8, 8)
    love.graphics.rectangle("fill", px, py + 20, pw, 10)
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.6, 0.55, 1, 1)
    love.graphics.printf("Portal Nexus", px + 10, py + 4, pw - 50, "left")

    -- Close button (X)
    local closeX = px + pw - 30
    local closeY = py + 4
    local closeW = 24
    local closeH = 22
    love.graphics.setColor(0.5, 0.15, 0.15, 0.8)
    love.graphics.rectangle("fill", closeX, closeY, closeW, closeH, 4, 4)
    love.graphics.setColor(1, 0.5, 0.5, 1)
    love.graphics.rectangle("line", closeX, closeY, closeW, closeH, 4, 4)
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf("X", closeX, closeY + 2, closeW, "center")
    game._portal._closeBtn = { x = closeX, y = closeY, w = closeW, h = closeH }

    -- Current zone indicator
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.55, 0.55, 0.7, 0.8)
    local currentZoneName = (zone and zone.name) or "Unknown"
    love.graphics.printf("Current zone: " .. currentZoneName, px + 10, py + 34, pw - 20, "left")

    -- Cooldown timer display
    local now = love.timer.getTime()
    local cooldownRemaining = game._portal.cooldownEnd - now
    local onCooldown = cooldownRemaining > 0
    if onCooldown then
        love.graphics.setFont(fonts.hud)
        love.graphics.setColor(1, 0.6, 0.2, 0.9)
        love.graphics.printf("Cooldown: " .. math.ceil(cooldownRemaining) .. "s", px + 10, py + 50, pw - 20, "left")
    end

    -- Subtitle / instruction
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.65, 0.7)
    local subtitleY = onCooldown and (py + 66) or (py + 50)
    love.graphics.printf("Select a destination to teleport", px + 10, subtitleY, pw - 20, "left")

    -- Destination list
    local listX = px + 8
    local listY = py + PORTAL_LIST_TOP
    local listW = pw - 16
    local listH = ph - PORTAL_LIST_TOP - PORTAL_LIST_BOT
    local rowH = PORTAL_ROW_H

    -- Scissor clip for scrollable list
    love.graphics.setScissor(listX, listY, listW, listH)

    game._portal._rowBtns = {}
    local destinations = game._portal.destinations or {}
    local currentZoneId = zone and zone.id

    if #destinations == 0 then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
        love.graphics.printf("Loading destinations...", listX, listY + 20, listW, "center")
    else
        local mx, my = love.mouse.getPosition()
        for i, dest in ipairs(destinations) do
            local ry = listY + (i - 1) * rowH - game._portal.scroll
            -- Skip offscreen rows for performance
            if ry + rowH > listY and ry < listY + listH then
                local isCurrent = currentZoneId and (dest.zoneId == currentZoneId)
                local isHovered = mx >= listX and mx <= listX + listW and my >= ry and my < ry + rowH and my >= listY and my < listY + listH
                local isDisabled = isCurrent or onCooldown

                -- Row background
                if isCurrent then
                    love.graphics.setColor(0.12, 0.12, 0.18, 0.5)
                elseif isHovered and not isDisabled then
                    love.graphics.setColor(0.15, 0.12, 0.32, 0.9)
                else
                    love.graphics.setColor(0.07, 0.07, 0.14, 0.6)
                end
                love.graphics.rectangle("fill", listX, ry, listW, rowH - 2, 4, 4)

                -- Row border on hover
                if isHovered and not isDisabled then
                    love.graphics.setColor(0.5, 0.4, 0.9, 0.6)
                    love.graphics.rectangle("line", listX, ry, listW, rowH - 2, 4, 4)
                end

                -- Portal type icon (small colored dot)
                local dotX = listX + 12
                local dotY = ry + math.floor(rowH / 2) - 1
                if dest.type == "personal" then
                    love.graphics.setColor(0.2, 0.9, 0.6, isCurrent and 0.4 or 0.9)
                else
                    love.graphics.setColor(0.5, 0.4, 1, isCurrent and 0.4 or 0.9)
                end
                love.graphics.circle("fill", dotX, dotY, 4)

                -- Destination name
                love.graphics.setFont(fonts.hud)
                if isCurrent then
                    love.graphics.setColor(0.4, 0.4, 0.5, 0.5)
                elseif isDisabled then
                    love.graphics.setColor(0.5, 0.5, 0.55, 0.6)
                else
                    love.graphics.setColor(0.85, 0.82, 1, 1)
                end
                local nameText = dest.name or dest.id or "???"
                love.graphics.print(nameText, listX + 24, ry + 4)

                -- Race / type flavor text
                love.graphics.setFont(fonts.small)
                if isCurrent then
                    love.graphics.setColor(0.35, 0.35, 0.45, 0.4)
                else
                    love.graphics.setColor(0.5, 0.48, 0.65, 0.65)
                end
                local flavor = ""
                if dest.type == "personal" then
                    flavor = "Personal Portal"
                else
                    flavor = PORTAL_TOWN_RACE[dest.zoneId] or "Anchor Town"
                end
                if isCurrent then
                    flavor = flavor .. "  (current)"
                end
                love.graphics.print(flavor, listX + 24, ry + 20)

                -- Store row hit rect for click handling
                game._portal._rowBtns[i] = {
                    x = listX, y = ry, w = listW, h = rowH - 2,
                    destId = dest.id,
                    destName = dest.name,
                    zoneId = dest.zoneId,
                    isCurrent = isCurrent,
                    isDisabled = isDisabled,
                    visible = (ry + rowH > listY and ry < listY + listH),
                }
            end
        end
    end

    love.graphics.setScissor()

    -- Scroll indicator (thin bar on the right if content overflows)
    local totalContentH = #destinations * rowH
    if totalContentH > listH then
        local barH = math.max(20, listH * (listH / totalContentH))
        local barY = listY + (game._portal.scroll / (totalContentH - listH)) * (listH - barH)
        love.graphics.setColor(0.4, 0.35, 0.7, 0.4)
        love.graphics.rectangle("fill", px + pw - 10, barY, 4, barH, 2, 2)
    end

    -- Message / error text area
    if game._portal.message then
        love.graphics.setFont(fonts.npc)
        local mc = game._portal.message.color or {1, 0.7, 0.3}
        love.graphics.setColor(mc[1], mc[2], mc[3], 0.9)
        love.graphics.printf(game._portal.message.text or "", px + 10, py + ph - 42, pw - 20, "center")
    end
end

local function handlePortalClick(mx, my)
    local client = getClient()
    if not game._portal.show then return false end

    local px = game._portal._panelX or 0
    local py = game._portal._panelY or 0
    local pw = game._portal._panelW or PORTAL_W
    local ph = game._portal._panelH or PORTAL_H

    -- Click outside panel: close
    if mx < px or mx > px + pw or my < py or my > py + ph then
        game._portal.show = false
        return true
    end

    -- Close button
    if game._portal._closeBtn then
        local btn = game._portal._closeBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            game._portal.show = false
            return true
        end
    end

    -- Destination row clicks
    if game._portal._rowBtns then
        local listY = py + PORTAL_LIST_TOP
        local listH = ph - PORTAL_LIST_TOP - PORTAL_LIST_BOT
        for _, btn in pairs(game._portal._rowBtns) do
            if btn.visible and not btn.isDisabled
                and mx >= btn.x and mx <= btn.x + btn.w
                and my >= btn.y and my <= btn.y + btn.h
                and my >= listY and my < listY + listH then
                -- Send game._portal travel request
                if client then
                    client:emit("portal_travel", { destinationId = btn.destId })
                end
                -- Show "Teleporting..." message while we wait for server response
                game._portal.message = {
                    text = "Teleporting to " .. (btn.destName or "destination") .. "...",
                    color = {0.6, 0.6, 1},
                    timer = 10,
                }
                return true
            end
        end
    end

    -- Clicked inside panel but not on any interactive element: consume click
    return true
end

-- NPC Shop panel constants
local NPC_SHOP_W = 520
local NPC_SHOP_H = 440
local NPC_SHOP_ITEM_H = 32
local NPC_SHOP_LIST_TOP = 90    -- offset from panel top to first item
local NPC_SHOP_LIST_BOT = 110   -- space reserved at bottom for controls

-- Helper: format resource name (iron_ore -> Iron Ore)
local function formatResourceName(name)
    if not name or name == "" then return "Unknown" end
    return name:gsub("_", " "):gsub("(%a)([%w]*)", function(a, b) return a:upper() .. b end)
end

-- Helper: get items to display in sell tab (player inventory resources with sell prices)
local function getNpcShopSellItems()
    local mmoInventory = getMmoInventory()
    local items = {}
    if not mmoInventory then return items end
    -- Iterate all resources in inventory that have a quantity > 0
    -- We need to match against the current shop's price data if available
    for key, qty in pairs(mmoInventory) do
        if type(qty) == "number" and qty > 0 and key ~= "items" then
            local sellPrice = nil
            local trend = "stable"
            -- Look up sell price from loaded prices
            if game._npcShop.prices then
                for _, p in ipairs(game._npcShop.prices) do
                    if p.resource == key then
                        sellPrice = p.sellPrice
                        trend = p.trend or "stable"
                        break
                    end
                end
            end
            -- If no price found in current shop, item may still be sellable
            -- (server allows selling anything with a base price)
            -- We show it with a "?" price; the server will calculate the actual price
            table.insert(items, {
                resource = key,
                name = formatResourceName(key),
                sellPrice = sellPrice,
                quantity = qty,
                trend = trend,
            })
        end
    end
    -- Sort alphabetically by name
    table.sort(items, function(a, b) return a.name < b.name end)
    return items
end

-- NPC Shop: draw panel
local function drawNpcShop(W, H)
    local account = getAccount()
    local pw = math.min(NPC_SHOP_W, W - 40)
    local ph = math.min(NPC_SHOP_H, H - 60)
    local px = math.floor((W - pw) / 2)
    local py = math.floor((H - ph) / 2)

    -- Store panel rect for click handling
    game._npcShop._panelX = px
    game._npcShop._panelY = py
    game._npcShop._panelW = pw
    game._npcShop._panelH = ph

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.06, 0.07, 0.12, 0.96)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    -- Border
    love.graphics.setColor(0.25, 0.55, 0.35, 0.8)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title bar
    love.graphics.setColor(0.1, 0.18, 0.12, 0.9)
    love.graphics.rectangle("fill", px, py, pw, 30, 8, 8)
    love.graphics.rectangle("fill", px, py + 20, pw, 10)
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.3, 0.95, 0.5, 1)
    love.graphics.printf(game._npcShop.shopName or "Shop", px + 10, py + 4, pw - 50, "left")

    -- Close button (X)
    local closeX = px + pw - 30
    local closeY = py + 4
    local closeW = 24
    local closeH = 22
    love.graphics.setColor(0.5, 0.15, 0.15, 0.8)
    love.graphics.rectangle("fill", closeX, closeY, closeW, closeH, 4, 4)
    love.graphics.setColor(1, 0.5, 0.5, 1)
    love.graphics.rectangle("line", closeX, closeY, closeW, closeH, 4, 4)
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf("X", closeX, closeY + 2, closeW, "center")
    game._npcShop._closeBtn = { x = closeX, y = closeY, w = closeW, h = closeH }

    -- Shop description
    if game._npcShop.shopDesc and game._npcShop.shopDesc ~= "" then
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(0.6, 0.7, 0.6, 0.7)
        love.graphics.printf(game._npcShop.shopDesc, px + 10, py + 32, pw - 20, "left")
    end

    -- Shop selector (dropdown-like row of shop names if shopList is available)
    local shopSelectorY = py + 46
    if game._npcShop.shopList and #game._npcShop.shopList > 1 then
        love.graphics.setFont(fonts.small)
        local shopBtnW = math.floor((pw - 20) / math.min(#game._npcShop.shopList, 7))
        game._npcShop._shopBtns = {}
        for i, shop in ipairs(game._npcShop.shopList) do
            if i > 7 then break end  -- max 7 shop buttons
            local sx = px + 10 + (i - 1) * shopBtnW
            local sy = shopSelectorY
            local active = (shop.id == game._npcShop.shopId)
            if active then
                love.graphics.setColor(0.15, 0.35, 0.2, 0.95)
            else
                love.graphics.setColor(0.1, 0.12, 0.16, 0.7)
            end
            love.graphics.rectangle("fill", sx, sy, shopBtnW - 2, 18, 3, 3)
            love.graphics.setColor(active and 0.4 or 0.25, active and 0.8 or 0.4, active and 0.5 or 0.35, active and 1 or 0.6)
            love.graphics.rectangle("line", sx, sy, shopBtnW - 2, 18, 3, 3)
            -- Truncate name to fit
            local label = shop.name or shop.id
            if fonts.small:getWidth(label) > shopBtnW - 8 then
                while #label > 3 and fonts.small:getWidth(label .. "..") > shopBtnW - 8 do
                    label = label:sub(1, -2)
                end
                label = label .. ".."
            end
            love.graphics.setColor(active and 0.9 or 0.6, active and 1 or 0.7, active and 0.9 or 0.6, active and 1 or 0.7)
            love.graphics.printf(label, sx, sy + 2, shopBtnW - 2, "center")
            game._npcShop._shopBtns[i] = { x = sx, y = sy, w = shopBtnW - 2, h = 18, shopId = shop.id, shopName = shop.name, shopDesc = shop.description or "" }
        end
    else
        game._npcShop._shopBtns = nil
    end

    -- Buy/Sell tabs
    local tabY = py + 68
    local tabW = math.floor((pw - 20) / 2)
    game._npcShop._buyTabBtn = { x = px + 10, y = tabY, w = tabW - 2, h = 22 }
    game._npcShop._sellTabBtn = { x = px + 10 + tabW, y = tabY, w = tabW - 2, h = 22 }

    love.graphics.setFont(fonts.hud)
    -- Buy tab
    if game._npcShop.tab == "buy" then
        love.graphics.setColor(0.15, 0.3, 0.2, 0.95)
    else
        love.graphics.setColor(0.08, 0.1, 0.14, 0.7)
    end
    love.graphics.rectangle("fill", game._npcShop._buyTabBtn.x, tabY, game._npcShop._buyTabBtn.w, 22, 4, 4)
    love.graphics.setColor(game._npcShop.tab == "buy" and 0.4 or 0.25, game._npcShop.tab == "buy" and 0.9 or 0.5, game._npcShop.tab == "buy" and 0.5 or 0.35, 1)
    love.graphics.printf("Buy", game._npcShop._buyTabBtn.x, tabY + 2, game._npcShop._buyTabBtn.w, "center")

    -- Sell tab
    if game._npcShop.tab == "sell" then
        love.graphics.setColor(0.3, 0.2, 0.1, 0.95)
    else
        love.graphics.setColor(0.08, 0.1, 0.14, 0.7)
    end
    love.graphics.rectangle("fill", game._npcShop._sellTabBtn.x, tabY, game._npcShop._sellTabBtn.w, 22, 4, 4)
    love.graphics.setColor(game._npcShop.tab == "sell" and 0.95 or 0.5, game._npcShop.tab == "sell" and 0.75 or 0.45, game._npcShop.tab == "sell" and 0.3 or 0.25, 1)
    love.graphics.printf("Sell", game._npcShop._sellTabBtn.x, tabY + 2, game._npcShop._sellTabBtn.w, "center")

    -- Item list area
    local listX = px + 8
    local listY = py + NPC_SHOP_LIST_TOP + 4
    local listW = pw - 16
    local listH = ph - NPC_SHOP_LIST_TOP - NPC_SHOP_LIST_BOT
    local itemH = NPC_SHOP_ITEM_H

    -- Clip region for scrollable list
    love.graphics.setScissor(listX, listY, listW, listH)

    local items = {}
    local sellItems = nil
    if game._npcShop.tab == "buy" then
        items = game._npcShop.prices or {}
    else
        sellItems = getNpcShopSellItems()
        items = sellItems
    end

    -- Column headers
    local headerY = listY - game._npcShop.scroll
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.5, 0.6, 0.55, 0.8)
    love.graphics.print("Item", listX + 6, headerY)
    if game._npcShop.tab == "buy" then
        love.graphics.printf("Price", listX, headerY, listW - 60, "right")
        love.graphics.printf("Trend", listX, headerY, listW - 6, "right")
    else
        love.graphics.printf("Qty", listX + listW * 0.45, headerY, 40, "center")
        love.graphics.printf("Price", listX, headerY, listW - 60, "right")
        love.graphics.printf("Trend", listX, headerY, listW - 6, "right")
    end

    -- Separator under header
    love.graphics.setColor(0.3, 0.4, 0.35, 0.4)
    love.graphics.line(listX, headerY + 14, listX + listW, headerY + 14)

    -- Item rows
    game._npcShop._itemRects = {}
    local startRow = headerY + 16
    for i, item in ipairs(items) do
        local iy = startRow + (i - 1) * itemH
        -- Skip if fully above or below visible area
        if iy + itemH >= listY and iy < listY + listH then
            local isSelected = (game._npcShop.selected == i)

            -- Row background
            if isSelected then
                love.graphics.setColor(0.15, 0.35, 0.25, 0.7)
            elseif i % 2 == 0 then
                love.graphics.setColor(0.08, 0.1, 0.12, 0.3)
            else
                love.graphics.setColor(0, 0, 0, 0)
            end
            love.graphics.rectangle("fill", listX, iy, listW, itemH - 2, 3, 3)

            if isSelected then
                love.graphics.setColor(0.3, 0.7, 0.45, 0.6)
                love.graphics.rectangle("line", listX, iy, listW, itemH - 2, 3, 3)
            end

            -- Item name
            love.graphics.setFont(fonts.chat)
            love.graphics.setColor(0.9, 0.9, 0.85, 0.95)
            local displayName = item.name or formatResourceName(item.resource)
            love.graphics.print(displayName, listX + 8, iy + (itemH - fonts.chat:getHeight()) / 2 - 1)

            -- Price
            love.graphics.setFont(fonts.hud)
            local price
            if game._npcShop.tab == "buy" then
                price = item.buyPrice
            else
                price = item.sellPrice
            end
            if price then
                love.graphics.setColor(1, 0.85, 0.2, 1)
                love.graphics.printf(tostring(price) .. "c", listX, iy + (itemH - fonts.hud:getHeight()) / 2 - 1, listW - 60, "right")
            else
                love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
                love.graphics.printf("--", listX, iy + (itemH - fonts.hud:getHeight()) / 2 - 1, listW - 60, "right")
            end

            -- Quantity (sell tab)
            if game._npcShop.tab == "sell" and item.quantity then
                love.graphics.setFont(fonts.npc)
                love.graphics.setColor(0.7, 0.8, 0.7, 0.9)
                love.graphics.printf(tostring(item.quantity), listX + listW * 0.45, iy + (itemH - fonts.npc:getHeight()) / 2, 40, "center")
            end

            -- Trend indicator
            love.graphics.setFont(fonts.npc)
            local trend = item.trend or "stable"
            if trend == "up" then
                love.graphics.setColor(0.3, 1, 0.3, 0.9)
                love.graphics.printf("^", listX, iy + (itemH - fonts.npc:getHeight()) / 2, listW - 8, "right")
            elseif trend == "down" then
                love.graphics.setColor(1, 0.3, 0.3, 0.9)
                love.graphics.printf("v", listX, iy + (itemH - fonts.npc:getHeight()) / 2, listW - 8, "right")
            else
                love.graphics.setColor(0.5, 0.5, 0.5, 0.6)
                love.graphics.printf("-", listX, iy + (itemH - fonts.npc:getHeight()) / 2, listW - 8, "right")
            end
        end
        -- Store rect for click detection (absolute screen coords)
        game._npcShop._itemRects[i] = { x = listX, y = iy, w = listW, h = itemH - 2 }
    end

    love.graphics.setScissor()

    -- Bottom controls area
    local ctrlY = py + ph - NPC_SHOP_LIST_BOT + 4
    love.graphics.setColor(0.08, 0.1, 0.14, 0.6)
    love.graphics.rectangle("fill", px + 4, ctrlY - 4, pw - 8, NPC_SHOP_LIST_BOT - 8, 4, 4)

    -- Coins display
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(1, 0.85, 0.2, 1)
    local coinText = "Coins: " .. (account and account.coins or 0)
    love.graphics.print(coinText, px + 14, ctrlY)

    -- Selected item info + amount controls
    if game._npcShop.selected and game._npcShop.selected >= 1 and game._npcShop.selected <= #items then
        local sel = items[game._npcShop.selected]
        local selName = sel.name or formatResourceName(sel.resource)

        -- Selected item name
        love.graphics.setFont(fonts.chat)
        love.graphics.setColor(0.85, 0.9, 0.85, 0.9)
        love.graphics.print(selName, px + 14, ctrlY + 20)

        -- Amount controls: [-] [amount] [+]
        local amtY = ctrlY + 40
        local minusBtnX = px + 14
        local minusBtnW = 30
        local amtLabelX = minusBtnX + minusBtnW + 4
        local amtLabelW = 50
        local plusBtnX = amtLabelX + amtLabelW + 4
        local plusBtnW = 30
        local btnH = 24

        -- Minus button
        love.graphics.setColor(0.2, 0.15, 0.15, 0.9)
        love.graphics.rectangle("fill", minusBtnX, amtY, minusBtnW, btnH, 4, 4)
        love.graphics.setColor(0.6, 0.4, 0.4, 1)
        love.graphics.rectangle("line", minusBtnX, amtY, minusBtnW, btnH, 4, 4)
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.setFont(fonts.ui)
        love.graphics.printf("-", minusBtnX, amtY + 1, minusBtnW, "center")
        game._npcShop._minusBtn = { x = minusBtnX, y = amtY, w = minusBtnW, h = btnH }

        -- Amount label
        love.graphics.setColor(0.1, 0.12, 0.16, 0.9)
        love.graphics.rectangle("fill", amtLabelX, amtY, amtLabelW, btnH, 4, 4)
        love.graphics.setColor(0.3, 0.4, 0.35, 0.8)
        love.graphics.rectangle("line", amtLabelX, amtY, amtLabelW, btnH, 4, 4)
        love.graphics.setFont(fonts.hud)
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.printf(tostring(game._npcShop.amount), amtLabelX, amtY + 3, amtLabelW, "center")

        -- Plus button
        love.graphics.setColor(0.15, 0.2, 0.15, 0.9)
        love.graphics.rectangle("fill", plusBtnX, amtY, plusBtnW, btnH, 4, 4)
        love.graphics.setColor(0.4, 0.6, 0.4, 1)
        love.graphics.rectangle("line", plusBtnX, amtY, plusBtnW, btnH, 4, 4)
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.setFont(fonts.ui)
        love.graphics.printf("+", plusBtnX, amtY + 1, plusBtnW, "center")
        game._npcShop._plusBtn = { x = plusBtnX, y = amtY, w = plusBtnW, h = btnH }

        -- Max button (quick set to max affordable or max owned)
        local maxBtnX = plusBtnX + plusBtnW + 8
        local maxBtnW = 40
        love.graphics.setColor(0.15, 0.18, 0.25, 0.9)
        love.graphics.rectangle("fill", maxBtnX, amtY, maxBtnW, btnH, 4, 4)
        love.graphics.setColor(0.35, 0.45, 0.6, 1)
        love.graphics.rectangle("line", maxBtnX, amtY, maxBtnW, btnH, 4, 4)
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(0.8, 0.85, 1, 1)
        love.graphics.printf("Max", maxBtnX, amtY + 5, maxBtnW, "center")
        game._npcShop._maxBtn = { x = maxBtnX, y = amtY, w = maxBtnW, h = btnH }

        -- Total cost / earnings
        local price = game._npcShop.tab == "buy" and sel.buyPrice or sel.sellPrice
        if price then
            local total = price * game._npcShop.amount
            love.graphics.setFont(fonts.hud)
            love.graphics.setColor(0.6, 0.7, 0.65, 0.8)
            local totalLabel = game._npcShop.tab == "buy" and "Total: " or "Earn: "
            love.graphics.printf(totalLabel, px + pw * 0.5, amtY + 3, pw * 0.2, "right")
            love.graphics.setColor(1, 0.85, 0.2, 1)
            love.graphics.printf(tostring(total) .. "c", px + pw * 0.7, amtY + 3, pw * 0.25, "left")
        end

        -- Confirm button
        local confirmBtnW = 120
        local confirmBtnH = 28
        local confirmBtnX = px + pw - confirmBtnW - 14
        local confirmBtnY = ctrlY + 65
        local canTransact = not game._npcShop.transactionLock
        if game._npcShop.tab == "buy" then
            local bgR, bgG, bgB = 0.12, 0.3, 0.18
            local brR, brG, brB = 0.3, 0.7, 0.4
            if not canTransact then bgR, bgG, bgB = 0.15, 0.15, 0.15; brR, brG, brB = 0.3, 0.3, 0.3 end
            love.graphics.setColor(bgR, bgG, bgB, 0.95)
            love.graphics.rectangle("fill", confirmBtnX, confirmBtnY, confirmBtnW, confirmBtnH, 5, 5)
            love.graphics.setColor(brR, brG, brB, 1)
            love.graphics.rectangle("line", confirmBtnX, confirmBtnY, confirmBtnW, confirmBtnH, 5, 5)
            love.graphics.setFont(fonts.hud)
            love.graphics.setColor(1, 1, 1, canTransact and 1 or 0.4)
            love.graphics.printf("Buy", confirmBtnX, confirmBtnY + 5, confirmBtnW, "center")
        else
            local bgR, bgG, bgB = 0.3, 0.2, 0.08
            local brR, brG, brB = 0.7, 0.5, 0.2
            if not canTransact then bgR, bgG, bgB = 0.15, 0.15, 0.15; brR, brG, brB = 0.3, 0.3, 0.3 end
            love.graphics.setColor(bgR, bgG, bgB, 0.95)
            love.graphics.rectangle("fill", confirmBtnX, confirmBtnY, confirmBtnW, confirmBtnH, 5, 5)
            love.graphics.setColor(brR, brG, brB, 1)
            love.graphics.rectangle("line", confirmBtnX, confirmBtnY, confirmBtnW, confirmBtnH, 5, 5)
            love.graphics.setFont(fonts.hud)
            love.graphics.setColor(1, 1, 1, canTransact and 1 or 0.4)
            love.graphics.printf("Sell", confirmBtnX, confirmBtnY + 5, confirmBtnW, "center")
        end
        game._npcShop._confirmBtn = { x = confirmBtnX, y = confirmBtnY, w = confirmBtnW, h = confirmBtnH }
    else
        game._npcShop._minusBtn = nil
        game._npcShop._plusBtn = nil
        game._npcShop._maxBtn = nil
        game._npcShop._confirmBtn = nil
    end

    -- Feedback message
    if game._npcShop.message and game._npcShop.message.timer and game._npcShop.message.timer > 0 then
        love.graphics.setFont(fonts.chat)
        local alpha = math.min(1, game._npcShop.message.timer)
        love.graphics.setColor(game._npcShop.message.color[1], game._npcShop.message.color[2], game._npcShop.message.color[3], alpha)
        love.graphics.printf(game._npcShop.message.text, px + 14, ctrlY + 68, pw - 28, "left")
    end

    -- Loading state
    if not game._npcShop.prices and game._npcShop.tab == "buy" then
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.6, 0.6, 0.7, 0.7 + 0.3 * math.sin(love.timer.getTime() * 3))
        love.graphics.printf("Loading prices...", px, py + ph / 2 - 20, pw, "center")
    end

    -- Escape hint
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.4, 0.45, 0.4, 0.5)
    love.graphics.printf("Esc to close", px, py + ph - 16, pw - 10, "right")
end

-- NPC Shop: handle click, returns true if click was consumed
local function handleNpcShopClick(mx, my)
    local client = getClient()
    local account = getAccount()
    local mmoInventory = getMmoInventory()
    if not game._npcShop.show then return false end

    local px = game._npcShop._panelX or 0
    local py = game._npcShop._panelY or 0
    local pw = game._npcShop._panelW or NPC_SHOP_W
    local ph = game._npcShop._panelH or NPC_SHOP_H

    -- Click outside panel: close shop
    if mx < px or mx > px + pw or my < py or my > py + ph then
        game._npcShop.show = false
        return true
    end

    -- Close button
    if game._npcShop._closeBtn then
        local btn = game._npcShop._closeBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            game._npcShop.show = false
            return true
        end
    end

    -- Shop selector buttons
    if game._npcShop._shopBtns then
        for _, btn in ipairs(game._npcShop._shopBtns) do
            if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
                if btn.shopId ~= game._npcShop.shopId then
                    game._npcShop.shopId = btn.shopId
                    game._npcShop.shopName = btn.shopName or btn.shopId
                    game._npcShop.shopDesc = btn.shopDesc or ""
                    game._npcShop.prices = nil
                    game._npcShop.selected = nil
                    game._npcShop.amount = 1
                    game._npcShop.scroll = 0
                    if client then
                        client:emit("npc_shop_prices", { shopId = btn.shopId })
                    end
                end
                return true
            end
        end
    end

    -- Buy/Sell tab buttons
    if game._npcShop._buyTabBtn then
        local btn = game._npcShop._buyTabBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            game._npcShop.tab = "buy"
            game._npcShop.selected = nil
            game._npcShop.amount = 1
            game._npcShop.scroll = 0
            return true
        end
    end
    if game._npcShop._sellTabBtn then
        local btn = game._npcShop._sellTabBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            game._npcShop.tab = "sell"
            game._npcShop.selected = nil
            game._npcShop.amount = 1
            game._npcShop.scroll = 0
            return true
        end
    end

    -- Item list clicks
    if game._npcShop._itemRects then
        local listY = py + NPC_SHOP_LIST_TOP + 4
        local listH = ph - NPC_SHOP_LIST_TOP - NPC_SHOP_LIST_BOT
        for i, rect in ipairs(game._npcShop._itemRects) do
            if mx >= rect.x and mx <= rect.x + rect.w and my >= rect.y and my <= rect.y + rect.h then
                -- Make sure click is within visible list area
                if my >= listY and my < listY + listH then
                    game._npcShop.selected = i
                    game._npcShop.amount = 1
                    return true
                end
            end
        end
    end

    -- Amount minus button
    if game._npcShop._minusBtn then
        local btn = game._npcShop._minusBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            game._npcShop.amount = math.max(1, game._npcShop.amount - 1)
            return true
        end
    end

    -- Amount plus button
    if game._npcShop._plusBtn then
        local btn = game._npcShop._plusBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            game._npcShop.amount = math.min(100, game._npcShop.amount + 1)
            return true
        end
    end

    -- Max button
    if game._npcShop._maxBtn then
        local btn = game._npcShop._maxBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            local items = {}
            if game._npcShop.tab == "buy" then
                items = game._npcShop.prices or {}
            else
                items = getNpcShopSellItems()
            end
            if game._npcShop.selected and game._npcShop.selected >= 1 and game._npcShop.selected <= #items then
                local sel = items[game._npcShop.selected]
                if game._npcShop.tab == "buy" then
                    -- Max affordable
                    local coins = (account and account.coins) or 0
                    local price = sel.buyPrice or 0
                    if price > 0 then
                        game._npcShop.amount = math.min(100, math.max(1, math.floor(coins / price)))
                    end
                else
                    -- Max owned
                    local qty = sel.quantity or 0
                    game._npcShop.amount = math.min(100, math.max(1, qty))
                end
            end
            return true
        end
    end

    -- Confirm button (Buy / Sell)
    if game._npcShop._confirmBtn then
        local btn = game._npcShop._confirmBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            if not game._npcShop.transactionLock and client then
                local items = {}
                if game._npcShop.tab == "buy" then
                    items = game._npcShop.prices or {}
                else
                    items = getNpcShopSellItems()
                end
                if game._npcShop.selected and game._npcShop.selected >= 1 and game._npcShop.selected <= #items then
                    local sel = items[game._npcShop.selected]
                    game._npcShop.transactionLock = true
                    if game._npcShop.tab == "buy" then
                        client:emit("npc_shop_buy", {
                            shopId = game._npcShop.shopId,
                            resource = sel.resource,
                            amount = game._npcShop.amount,
                        })
                    else
                        client:emit("npc_shop_sell", {
                            resource = sel.resource,
                            amount = game._npcShop.amount,
                        })
                    end
                end
            end
            return true
        end
    end

    -- Consume click inside panel (prevent world interaction)
    return true
end

-- ========================================================================
-- P2P Trade Panel
-- ========================================================================

local TRADE_W = 620
local TRADE_H = 470
local TRADE_ITEM_H = 26
local TRADE_INV_TOP = 70       -- offset from panel top to inventory list start
local TRADE_INV_BOT = 80       -- space reserved at bottom for controls
local TRADE_COL_GAP = 10       -- gap between left/right columns

-- Helper: build a flat list of tradeable inventory items (resources + cards)
local function getTradableInventory()
    local mmoInventory = getMmoInventory()
    local items = {}
    -- Resources
    if mmoInventory then
        for key, qty in pairs(mmoInventory) do
            if type(qty) == "number" and qty > 0 and key ~= "items" then
                -- Subtract any already-offered amount of this resource
                local offeredAmt = 0
                for _, oi in ipairs(game._trade.myOffer.items) do
                    if oi.type == "resource" and oi.resource == key then
                        offeredAmt = offeredAmt + (oi.amount or 0)
                    end
                end
                local available = qty - offeredAmt
                if available > 0 then
                    table.insert(items, {
                        type = "resource",
                        resource = key,
                        name = formatResourceName(key),
                        amount = available,
                    })
                end
            end
        end
    end
    -- Sort resources alphabetically
    table.sort(items, function(a, b) return a.name < b.name end)
    -- Cards
    if rpg.cards then
        for _, card in ipairs(rpg.cards) do
            -- Check card is not already in our offer
            local alreadyOffered = false
            for _, oi in ipairs(game._trade.myOffer.items) do
                if oi.type == "card" and oi.cardInstanceId == card.instanceId then
                    alreadyOffered = true
                    break
                end
            end
            if not alreadyOffered then
                table.insert(items, {
                    type = "card",
                    cardInstanceId = card.instanceId,
                    name = (card.name or "Card") .. " [" .. (card.rarity or "?") .. "]",
                    rarity = card.rarity,
                })
            end
        end
    end
    return items
end

-- Helper: send current offer to server
local function emitTradeOffer()
    local client = getClient()
    if not client or not game._trade.tradeId then return end
    client:emit("trade_offer", {
        tradeId = game._trade.tradeId,
        items = game._trade.myOffer.items,
        chips = game._trade.myOffer.chips,
    })
    -- Reset confirmations locally (server resets them too)
    game._trade.myConfirmed = false
    game._trade.theirConfirmed = false
end

-- Helper: check if our offer has at least one item or coins
local function hasOfferContent()
    return #game._trade.myOffer.items > 0 or game._trade.myOffer.chips > 0
end

-- Rarity color lookup for card items
local RARITY_COLORS = {
    common =      {0.7, 0.7, 0.7},
    uncommon =    {0.3, 0.9, 0.3},
    rare =        {0.3, 0.5, 1.0},
    ultra_rare =  {0.7, 0.3, 1.0},
    mythic_rare = {1.0, 0.4, 0.7},
    legendary =   {1.0, 0.75, 0.2},
    godly =       {1.0, 0.9, 0.4},
    relic =       {1.0, 0.3, 0.3},
}

-- ---------------------------------------------------------------------------
-- Bank Vault UI
-- ---------------------------------------------------------------------------
local BANK_W = 540
local BANK_H = 480
local BANK_ITEM_H = 30

local function drawBank(W, H)
    local account = getAccount()
    if not game._bank.data then
        -- Still loading
        love.graphics.setColor(0, 0, 0, 0.6)
        love.graphics.rectangle("fill", 0, 0, W, H)
        love.graphics.setFont(fonts.title)
        love.graphics.setColor(1, 0.85, 0.3, 1)
        love.graphics.printf("Loading vault...", 0, H / 2 - 20, W, "center")
        return
    end

    local pw = math.min(BANK_W, W - 40)
    local ph = math.min(BANK_H, H - 60)
    local px = math.floor((W - pw) / 2)
    local py = math.floor((H - ph) / 2)

    game._bank._panelX = px
    game._bank._panelY = py
    game._bank._panelW = pw
    game._bank._panelH = ph

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.06, 0.06, 0.1, 0.96)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    love.graphics.setColor(0.7, 0.6, 0.2, 0.8)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)

    -- Title bar
    love.graphics.setColor(0.15, 0.12, 0.05, 0.9)
    love.graphics.rectangle("fill", px, py, pw, 30, 8, 8)
    love.graphics.rectangle("fill", px, py + 20, pw, 10)
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(1, 0.85, 0.3, 1)
    love.graphics.printf("Bank Vault", px + 10, py + 4, pw - 50, "left")

    -- Close button
    local closeX = px + pw - 30
    local closeY = py + 4
    love.graphics.setColor(0.5, 0.15, 0.15, 0.8)
    love.graphics.rectangle("fill", closeX, closeY, 24, 22, 4, 4)
    love.graphics.setColor(1, 0.5, 0.5, 1)
    love.graphics.rectangle("line", closeX, closeY, 24, 22, 4, 4)
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf("X", closeX, closeY + 2, 24, "center")
    game._bank._closeBtn = { x = closeX, y = closeY, w = 24, h = 22 }

    -- Tab row
    local tabs = { "gold", "resources", "items" }
    local tabLabels = { gold = "Gold", resources = "Resources", items = "Items" }
    local tabW = math.floor((pw - 20) / #tabs)
    local tabY = py + 34
    game._bank._tabBtns = {}
    love.graphics.setFont(fonts.hud)
    for i, tabId in ipairs(tabs) do
        local tx = px + 10 + (i - 1) * tabW
        local active = (game._bank.tab == tabId)
        if active then
            love.graphics.setColor(0.2, 0.18, 0.08, 0.95)
        else
            love.graphics.setColor(0.1, 0.1, 0.14, 0.7)
        end
        love.graphics.rectangle("fill", tx, tabY, tabW - 2, 22, 4, 4)
        if active then
            love.graphics.setColor(1, 0.85, 0.3, 1)
        else
            love.graphics.setColor(0.6, 0.55, 0.4, 0.8)
        end
        love.graphics.printf(tabLabels[tabId], tx, tabY + 3, tabW - 2, "center")
        game._bank._tabBtns[i] = { x = tx, y = tabY, w = tabW - 2, h = 22, tab = tabId }
    end

    -- Slot info
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.6, 0.55, 0.4, 0.7)
    local slotText = "Vault: " .. #game._bank.data.items .. "/" .. game._bank.data.maxSlots .. " items"
    love.graphics.printf(slotText, px + 10, tabY + 26, pw - 20, "right")

    -- Wallet display
    local walletGold = 0
    if identity and identity.account then walletGold = identity.account.chips or 0 end
    love.graphics.setColor(1, 0.85, 0.3, 0.8)
    love.graphics.printf("Wallet: " .. walletGold .. "g", px + 10, tabY + 26, pw - 20, "left")

    -- Content area
    local contentY = tabY + 44
    local contentH = ph - (contentY - py) - 40

    -- Feedback message
    if game._bank.message and game._bank.message.timer and game._bank.message.timer > 0 then
        love.graphics.setFont(fonts.chat)
        love.graphics.setColor(game._bank.message.color[1], game._bank.message.color[2], game._bank.message.color[3], math.min(1, game._bank.message.timer))
        love.graphics.printf(game._bank.message.text, px + 10, py + ph - 36, pw - 20, "center")
    end

    if game._bank.tab == "gold" then
        game.drawBankGoldTab(px, py, pw, ph, contentY, contentH)
    elseif game._bank.tab == "resources" then
        game.drawBankResourcesTab(px, py, pw, ph, contentY, contentH)
    elseif game._bank.tab == "items" then
        game.drawBankItemsTab(px, py, pw, ph, contentY, contentH)
    end
end

local function drawBankGoldTab(px, py, pw, ph, contentY, contentH)
    local account = getAccount()
    local midX = px + pw / 2
    local bankGold = game._bank.data.gold or 0
    local walletGold = 0
    if identity and identity.account then walletGold = identity.account.chips or 0 end

    love.graphics.setFont(fonts.title)
    love.graphics.setColor(1, 0.85, 0.3, 1)
    love.graphics.printf("Bank: " .. bankGold .. " gold", px + 10, contentY + 10, pw - 20, "center")

    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(0.8, 0.75, 0.5, 0.8)
    love.graphics.printf("Wallet: " .. walletGold .. " gold", px + 10, contentY + 40, pw - 20, "center")

    -- Amount selector
    local amountY = contentY + 75
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(0.7, 0.65, 0.4, 0.9)
    love.graphics.printf("Amount:", px + 30, amountY + 3, 70, "left")

    -- Minus button
    local minBtnX = px + 110
    love.graphics.setColor(0.2, 0.15, 0.08, 0.9)
    love.graphics.rectangle("fill", minBtnX, amountY, 30, 24, 4, 4)
    love.graphics.setColor(0.8, 0.7, 0.3, 1)
    love.graphics.rectangle("line", minBtnX, amountY, 30, 24, 4, 4)
    love.graphics.printf("-", minBtnX, amountY + 3, 30, "center")
    game._bank._goldMinusBtn = { x = minBtnX, y = amountY, w = 30, h = 24 }

    -- Amount display
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf(tostring(game._bank.amount), minBtnX + 34, amountY + 3, 80, "center")

    -- Plus button
    local plusBtnX = minBtnX + 118
    love.graphics.setColor(0.2, 0.15, 0.08, 0.9)
    love.graphics.rectangle("fill", plusBtnX, amountY, 30, 24, 4, 4)
    love.graphics.setColor(0.8, 0.7, 0.3, 1)
    love.graphics.rectangle("line", plusBtnX, amountY, 30, 24, 4, 4)
    love.graphics.printf("+", plusBtnX, amountY + 3, 30, "center")
    game._bank._goldPlusBtn = { x = plusBtnX, y = amountY, w = 30, h = 24 }

    -- Max button
    local maxBtnX = plusBtnX + 36
    love.graphics.setColor(0.2, 0.15, 0.08, 0.9)
    love.graphics.rectangle("fill", maxBtnX, amountY, 40, 24, 4, 4)
    love.graphics.setColor(0.8, 0.7, 0.3, 1)
    love.graphics.rectangle("line", maxBtnX, amountY, 40, 24, 4, 4)
    love.graphics.printf("Max", maxBtnX, amountY + 3, 40, "center")
    game._bank._goldMaxBtn = { x = maxBtnX, y = amountY, w = 40, h = 24 }

    -- Deposit / Withdraw buttons
    local btnY = amountY + 40
    local btnW = math.floor((pw - 60) / 2)
    local canAct = not game._bank.transactionLock

    -- Deposit
    local depX = px + 20
    if canAct then
        love.graphics.setColor(0.12, 0.25, 0.12, 0.9)
    else
        love.graphics.setColor(0.15, 0.15, 0.15, 0.7)
    end
    love.graphics.rectangle("fill", depX, btnY, btnW, 30, 4, 4)
    love.graphics.setColor(0.3, 0.8, 0.4, canAct and 1 or 0.4)
    love.graphics.rectangle("line", depX, btnY, btnW, 30, 4, 4)
    love.graphics.printf("Deposit", depX, btnY + 6, btnW, "center")
    game._bank._depositGoldBtn = { x = depX, y = btnY, w = btnW, h = 30 }

    -- Withdraw
    local witX = px + 40 + btnW
    if canAct then
        love.graphics.setColor(0.25, 0.12, 0.08, 0.9)
    else
        love.graphics.setColor(0.15, 0.15, 0.15, 0.7)
    end
    love.graphics.rectangle("fill", witX, btnY, btnW, 30, 4, 4)
    love.graphics.setColor(0.8, 0.5, 0.3, canAct and 1 or 0.4)
    love.graphics.rectangle("line", witX, btnY, btnW, 30, 4, 4)
    love.graphics.printf("Withdraw", witX, btnY + 6, btnW, "center")
    game._bank._withdrawGoldBtn = { x = witX, y = btnY, w = btnW, h = 30 }

    -- Expand vault button
    if game._bank.data.nextExpansionCost then
        local expY = btnY + 50
        local expW = pw - 40
        love.graphics.setColor(0.08, 0.08, 0.18, 0.9)
        love.graphics.rectangle("fill", px + 20, expY, expW, 30, 4, 4)
        love.graphics.setColor(0.4, 0.35, 0.7, 0.8)
        love.graphics.rectangle("line", px + 20, expY, expW, 30, 4, 4)
        love.graphics.setFont(fonts.hud)
        love.graphics.setColor(0.7, 0.65, 1, canAct and 1 or 0.4)
        love.graphics.printf("Expand Vault (+10 slots) — " .. game._bank.data.nextExpansionCost .. "g", px + 20, expY + 6, expW, "center")
        game._bank._expandBtn = { x = px + 20, y = expY, w = expW, h = 30 }
    else
        game._bank._expandBtn = nil
    end
end

local function drawBankResourcesTab(px, py, pw, ph, contentY, contentH)
    -- Build combined resource list: game._bank resources + inventory resources
    local mmoInventory = getMmoInventory()
    local allResources = {}
    local seen = {}

    -- Bank resources
    if game._bank.data.resources then
        for res, qty in pairs(game._bank.data.resources) do
            if qty > 0 then
                allResources[#allResources + 1] = { resource = res, bankQty = qty, invQty = 0 }
                seen[res] = #allResources
            end
        end
    end

    -- Inventory resources
    if mmoInventory then
        for key, qty in pairs(mmoInventory) do
            if type(qty) == "number" and qty > 0 and key ~= "items" then
                if seen[key] then
                    allResources[seen[key]].invQty = qty
                else
                    allResources[#allResources + 1] = { resource = key, bankQty = 0, invQty = qty }
                    seen[key] = #allResources
                end
            end
        end
    end

    table.sort(allResources, function(a, b) return a.resource < b.resource end)

    -- Header
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.6, 0.55, 0.4, 0.7)
    love.graphics.printf("Resource", px + 12, contentY, 140, "left")
    love.graphics.printf("Bank", px + 160, contentY, 60, "center")
    love.graphics.printf("Inv", px + 225, contentY, 60, "center")

    -- Scrollable list
    local listY = contentY + 16
    local listH = contentH - 50
    love.graphics.setScissor(px + 5, listY, pw - 10, listH)
    game._bank._resourceRows = {}

    for i, entry in ipairs(allResources) do
        local rowY = listY + (i - 1) * BANK_ITEM_H - game._bank.scroll
        if rowY + BANK_ITEM_H > listY and rowY < listY + listH then
            local isSelected = (game._bank.selected == i)
            if isSelected then
                love.graphics.setColor(0.2, 0.18, 0.08, 0.8)
            elseif i % 2 == 0 then
                love.graphics.setColor(0.08, 0.08, 0.12, 0.4)
            else
                love.graphics.setColor(0.06, 0.06, 0.1, 0.2)
            end
            love.graphics.rectangle("fill", px + 6, rowY, pw - 12, BANK_ITEM_H - 2, 3, 3)

            love.graphics.setFont(fonts.chat)
            love.graphics.setColor(0.9, 0.85, 0.7, 1)
            love.graphics.printf(formatResourceName(entry.resource), px + 12, rowY + 6, 140, "left")
            love.graphics.setColor(1, 0.85, 0.3, 0.9)
            love.graphics.printf(tostring(entry.bankQty), px + 160, rowY + 6, 60, "center")
            love.graphics.setColor(0.7, 0.8, 0.9, 0.9)
            love.graphics.printf(tostring(entry.invQty), px + 225, rowY + 6, 60, "center")

            -- Deposit button
            if entry.invQty > 0 then
                local depX2 = px + pw - 140
                love.graphics.setColor(0.1, 0.2, 0.1, 0.9)
                love.graphics.rectangle("fill", depX2, rowY + 2, 56, BANK_ITEM_H - 6, 3, 3)
                love.graphics.setColor(0.3, 0.7, 0.4, 1)
                love.graphics.rectangle("line", depX2, rowY + 2, 56, BANK_ITEM_H - 6, 3, 3)
                love.graphics.setFont(fonts.small)
                love.graphics.printf("Dep", depX2, rowY + 6, 56, "center")
            end

            -- Withdraw button
            if entry.bankQty > 0 then
                local witX2 = px + pw - 76
                love.graphics.setColor(0.2, 0.1, 0.05, 0.9)
                love.graphics.rectangle("fill", witX2, rowY + 2, 56, BANK_ITEM_H - 6, 3, 3)
                love.graphics.setColor(0.7, 0.5, 0.3, 1)
                love.graphics.rectangle("line", witX2, rowY + 2, 56, BANK_ITEM_H - 6, 3, 3)
                love.graphics.setFont(fonts.small)
                love.graphics.printf("Wit", witX2, rowY + 6, 56, "center")
            end

            game._bank._resourceRows[i] = {
                y = rowY, resource = entry.resource,
                bankQty = entry.bankQty, invQty = entry.invQty,
                depBtn = entry.invQty > 0 and { x = px + pw - 140, y = rowY + 2, w = 56, h = BANK_ITEM_H - 6 } or nil,
                witBtn = entry.bankQty > 0 and { x = px + pw - 76, y = rowY + 2, w = 56, h = BANK_ITEM_H - 6 } or nil,
            }
        end
    end
    love.graphics.setScissor()

    -- Amount selector at bottom
    local amountY = contentY + contentH - 30
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(0.7, 0.65, 0.4, 0.9)
    love.graphics.printf("Qty: " .. game._bank.amount, px + 10, amountY + 4, 80, "left")

    local minBtnX = px + 95
    love.graphics.setColor(0.2, 0.15, 0.08, 0.9)
    love.graphics.rectangle("fill", minBtnX, amountY, 26, 22, 3, 3)
    love.graphics.setColor(0.8, 0.7, 0.3, 1)
    love.graphics.printf("-", minBtnX, amountY + 2, 26, "center")
    game._bank._resMinusBtn = { x = minBtnX, y = amountY, w = 26, h = 22 }

    local plusBtnX = minBtnX + 30
    love.graphics.setColor(0.2, 0.15, 0.08, 0.9)
    love.graphics.rectangle("fill", plusBtnX, amountY, 26, 22, 3, 3)
    love.graphics.setColor(0.8, 0.7, 0.3, 1)
    love.graphics.printf("+", plusBtnX, amountY + 2, 26, "center")
    game._bank._resPlusBtn = { x = plusBtnX, y = amountY, w = 26, h = 22 }

    local maxBtnX = plusBtnX + 30
    love.graphics.setColor(0.2, 0.15, 0.08, 0.9)
    love.graphics.rectangle("fill", maxBtnX, amountY, 36, 22, 3, 3)
    love.graphics.setColor(0.8, 0.7, 0.3, 1)
    love.graphics.printf("Max", maxBtnX, amountY + 2, 36, "center")
    game._bank._resMaxBtn = { x = maxBtnX, y = amountY, w = 36, h = 22 }
end

local function drawBankItemsTab(px, py, pw, ph, contentY, contentH)
    local mmoInventory = getMmoInventory()
    local bankItems = game._bank.data.items or {}
    local invItems = (mmoInventory and mmoInventory.items) or {}

    -- Column headers
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.6, 0.55, 0.4, 0.7)
    love.graphics.printf("Bank Items (" .. #bankItems .. "/" .. game._bank.data.maxSlots .. ")", px + 12, contentY, (pw / 2) - 20, "left")
    love.graphics.printf("Inventory (" .. #invItems .. "/100)", px + pw / 2 + 8, contentY, (pw / 2) - 20, "left")

    local listY = contentY + 16
    local listH = contentH - 16
    local colW = math.floor((pw - 20) / 2)

    -- Bank items column
    love.graphics.setScissor(px + 5, listY, colW, listH)
    game._bank._bankItemRows = {}
    for i, item in ipairs(bankItems) do
        local rowY = listY + (i - 1) * BANK_ITEM_H - game._bank.scroll
        if rowY + BANK_ITEM_H > listY and rowY < listY + listH then
            if i % 2 == 0 then
                love.graphics.setColor(0.08, 0.08, 0.12, 0.4)
            else
                love.graphics.setColor(0.06, 0.06, 0.1, 0.2)
            end
            love.graphics.rectangle("fill", px + 6, rowY, colW - 2, BANK_ITEM_H - 2, 2, 2)

            -- Item name
            love.graphics.setFont(fonts.small)
            local itemName = item.name or item.type or "Item"
            love.graphics.setColor(0.9, 0.85, 0.7, 1)
            love.graphics.printf(itemName, px + 10, rowY + 4, colW - 50, "left")

            -- Withdraw arrow
            love.graphics.setColor(0.7, 0.5, 0.3, 1)
            love.graphics.printf(">", px + colW - 20, rowY + 4, 16, "center")

            game._bank._bankItemRows[i] = { y = rowY, item = item, index = i - 1, btn = { x = px + 6, y = rowY, w = colW - 2, h = BANK_ITEM_H - 2 } }
        end
    end
    love.graphics.setScissor()

    -- Divider
    love.graphics.setColor(0.7, 0.6, 0.2, 0.4)
    love.graphics.line(px + colW + 8, listY, px + colW + 8, listY + listH)

    -- Inventory items column
    local invX = px + colW + 12
    love.graphics.setScissor(invX, listY, colW, listH)
    game._bank._invItemRows = {}
    for i, item in ipairs(invItems) do
        local rowY = listY + (i - 1) * BANK_ITEM_H - game._bank.scroll
        if rowY + BANK_ITEM_H > listY and rowY < listY + listH then
            if i % 2 == 0 then
                love.graphics.setColor(0.08, 0.08, 0.12, 0.4)
            else
                love.graphics.setColor(0.06, 0.06, 0.1, 0.2)
            end
            love.graphics.rectangle("fill", invX, rowY, colW - 6, BANK_ITEM_H - 2, 2, 2)

            -- Deposit arrow
            love.graphics.setColor(0.3, 0.7, 0.4, 1)
            love.graphics.printf("<", invX + 4, rowY + 4, 16, "center")

            -- Item name
            love.graphics.setFont(fonts.small)
            local itemName = item.name or item.type or "Item"
            love.graphics.setColor(0.9, 0.85, 0.7, 1)
            love.graphics.printf(itemName, invX + 24, rowY + 4, colW - 34, "left")

            game._bank._invItemRows[i] = { y = rowY, item = item, btn = { x = invX, y = rowY, w = colW - 6, h = BANK_ITEM_H - 2 } }
        end
    end
    love.graphics.setScissor()
end

-- Bank: hit test helper
local function _hitTest(btn, mx, my)
    if not btn then return false end
    return mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h
end

local function handleBankClick(mx, my)
    local client = getClient()
    local account = getAccount()
    local mmoInventory = getMmoInventory()
    if not game._bank.show then return false end
    if not game._bank._panelX then return false end

    -- Click outside panel closes it
    if mx < game._bank._panelX or mx > game._bank._panelX + game._bank._panelW
       or my < game._bank._panelY or my > game._bank._panelY + game._bank._panelH then
        game._bank.show = false
        return true
    end

    -- Close button
    if _hitTest(game._bank._closeBtn, mx, my) then
        game._bank.show = false
        return true
    end

    -- Tabs
    if game._bank._tabBtns then
        for _, btn in ipairs(game._bank._tabBtns) do
            if _hitTest(btn, mx, my) then
                game._bank.tab = btn.tab
                game._bank.selected = nil
                game._bank.scroll = 0
                game._bank.amount = 1
                return true
            end
        end
    end

    if game._bank.transactionLock then return true end

    -- Gold tab controls
    if game._bank.tab == "gold" then
        if _hitTest(game._bank._goldMinusBtn, mx, my) then
            game._bank.amount = math.max(1, game._bank.amount - (love.keyboard.isDown("lshift") and 100 or 10))
            return true
        end
        if _hitTest(game._bank._goldPlusBtn, mx, my) then
            game._bank.amount = game._bank.amount + (love.keyboard.isDown("lshift") and 100 or 10)
            return true
        end
        if _hitTest(game._bank._goldMaxBtn, mx, my) then
            -- Set to max available for the likely action
            local walletGold = identity and identity.account and identity.account.chips or 0
            local bankGold = game._bank.data and game._bank.data.gold or 0
            game._bank.amount = math.max(walletGold, bankGold)
            return true
        end
        if _hitTest(game._bank._depositGoldBtn, mx, my) and client then
            game._bank.transactionLock = true
            client:emit("bank_deposit_gold", { amount = game._bank.amount })
            return true
        end
        if _hitTest(game._bank._withdrawGoldBtn, mx, my) and client then
            game._bank.transactionLock = true
            client:emit("bank_withdraw_gold", { amount = game._bank.amount })
            return true
        end
        if _hitTest(game._bank._expandBtn, mx, my) and client then
            game._bank.transactionLock = true
            client:emit("bank_buy_slots", {})
            return true
        end
        return true
    end

    -- Resources tab controls
    if game._bank.tab == "resources" then
        if _hitTest(game._bank._resMinusBtn, mx, my) then
            game._bank.amount = math.max(1, game._bank.amount - (love.keyboard.isDown("lshift") and 10 or 1))
            return true
        end
        if _hitTest(game._bank._resPlusBtn, mx, my) then
            game._bank.amount = game._bank.amount + (love.keyboard.isDown("lshift") and 10 or 1)
            return true
        end
        if _hitTest(game._bank._resMaxBtn, mx, my) then
            game._bank.amount = 999
            return true
        end
        -- Resource row deposit/withdraw buttons
        if game._bank._resourceRows then
            for _, row in pairs(game._bank._resourceRows) do
                if row.depBtn and _hitTest(row.depBtn, mx, my) and client then
                    game._bank.transactionLock = true
                    client:emit("bank_deposit_resource", { resource = row.resource, amount = math.min(game._bank.amount, row.invQty) })
                    return true
                end
                if row.witBtn and _hitTest(row.witBtn, mx, my) and client then
                    game._bank.transactionLock = true
                    client:emit("bank_withdraw_resource", { resource = row.resource, amount = math.min(game._bank.amount, row.bankQty) })
                    return true
                end
            end
        end
        return true
    end

    -- Items tab controls
    if game._bank.tab == "items" then
        -- Bank item rows (click to withdraw)
        if game._bank._bankItemRows then
            for _, row in pairs(game._bank._bankItemRows) do
                if _hitTest(row.btn, mx, my) and client then
                    game._bank.transactionLock = true
                    client:emit("bank_withdraw_item", { itemIndex = row.index })
                    return true
                end
            end
        end
        -- Inventory item rows (click to deposit)
        if game._bank._invItemRows then
            for _, row in pairs(game._bank._invItemRows) do
                if _hitTest(row.btn, mx, my) and client then
                    game._bank.transactionLock = true
                    client:emit("bank_deposit_item", { itemId = row.item.id })
                    return true
                end
            end
        end
        return true
    end

    return true
end

-- Draw the game._trade panel
local function drawTradePanel(W, H)
    local pw = math.min(TRADE_W, W - 40)
    local ph = math.min(TRADE_H, H - 60)
    local px = math.floor((W - pw) / 2)
    local py = math.floor((H - ph) / 2)

    -- Store panel rect for click handling
    game._trade._panelX = px
    game._trade._panelY = py
    game._trade._panelW = pw
    game._trade._panelH = ph

    -- Dim background
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.07, 0.06, 0.1, 0.96)
    love.graphics.rectangle("fill", px, py, pw, ph, 8, 8)
    -- Amber/gold border to distinguish from shop
    love.graphics.setColor(0.75, 0.6, 0.2, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, pw, ph, 8, 8)
    love.graphics.setLineWidth(1)

    -- Title
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(1, 0.85, 0.3, 1)
    love.graphics.printf("Trade with " .. game._trade.partnerName, px + 10, py + 8, pw - 60, "left")

    -- Close / Cancel button (top right)
    local closeW, closeH = 22, 22
    local closeX = px + pw - closeW - 8
    local closeY = py + 6
    love.graphics.setColor(0.6, 0.2, 0.2, 0.9)
    love.graphics.rectangle("fill", closeX, closeY, closeW, closeH, 4, 4)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.setFont(fonts.name)
    love.graphics.printf("X", closeX, closeY + 3, closeW, "center")
    game._trade._closeBtn = { x = closeX, y = closeY, w = closeW, h = closeH }

    -- Divider line under title
    love.graphics.setColor(0.75, 0.6, 0.2, 0.3)
    love.graphics.line(px + 10, py + 34, px + pw - 10, py + 34)

    -- Status line
    love.graphics.setFont(fonts.npc)
    local statusText, statusColor
    if game._trade.myConfirmed and game._trade.theirConfirmed then
        statusText = "Both confirmed! Completing trade..."
        statusColor = {0.3, 1, 0.4, 1}
    elseif game._trade.myConfirmed then
        statusText = "Waiting for partner to confirm..."
        statusColor = {1, 0.85, 0.3, 1}
    elseif game._trade.theirConfirmed then
        statusText = "Partner confirmed. Review and confirm your offer."
        statusColor = {0.4, 0.8, 1, 1}
    else
        statusText = "Add items to your offer, then confirm."
        statusColor = {0.6, 0.65, 0.7, 1}
    end
    love.graphics.setColor(statusColor)
    love.graphics.printf(statusText, px + 10, py + 38, pw - 20, "center")

    -- Column layout
    local colW = math.floor((pw - TRADE_COL_GAP - 20) / 2)
    local leftX = px + 10
    local rightX = leftX + colW + TRADE_COL_GAP
    local colTop = py + 56
    local colH = ph - 56 - TRADE_INV_BOT

    -- ===================== LEFT COLUMN: Your Offer =====================
    -- Column header
    love.graphics.setFont(fonts.chat)
    love.graphics.setColor(0.9, 0.8, 0.4, 1)
    love.graphics.printf("Your Offer", leftX, colTop, colW, "center")
    if game._trade.myConfirmed then
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.2, 1, 0.3, 1)
        love.graphics.printf("CONFIRMED", leftX, colTop + 1, colW - 4, "right")
    end

    -- Offered items list (top half of column)
    local offeredTop = colTop + 20
    local offeredH = math.floor(colH * 0.38)  -- ~38% for offered items
    love.graphics.setColor(0.04, 0.04, 0.08, 0.6)
    love.graphics.rectangle("fill", leftX, offeredTop, colW, offeredH, 4, 4)
    love.graphics.setColor(0.5, 0.45, 0.2, 0.5)
    love.graphics.rectangle("line", leftX, offeredTop, colW, offeredH, 4, 4)

    love.graphics.setFont(fonts.npc)
    game._trade._offeredRects = {}
    if #game._trade.myOffer.items == 0 and game._trade.myOffer.chips == 0 then
        love.graphics.setColor(0.5, 0.5, 0.55, 0.6)
        love.graphics.printf("(empty)", leftX, offeredTop + offeredH / 2 - 6, colW, "center")
    else
        local oy = offeredTop + 2
        -- Draw offered items
        for i, item in ipairs(game._trade.myOffer.items) do
            if oy + TRADE_ITEM_H > offeredTop + offeredH then break end
            local label
            if item.type == "resource" then
                label = formatResourceName(item.resource) .. " x" .. (item.amount or 1)
                love.graphics.setColor(0.85, 0.85, 0.9, 1)
            else
                -- Card
                label = item.name or ("Card:" .. (item.cardInstanceId or "?"):sub(1, 8))
                local rc = RARITY_COLORS[item.rarity] or {0.7, 0.7, 0.7}
                love.graphics.setColor(rc[1], rc[2], rc[3], 1)
            end
            love.graphics.printf(label, leftX + 4, oy + 4, colW - 30, "left")
            -- Remove [x] button
            love.graphics.setColor(1, 0.35, 0.35, 0.9)
            love.graphics.printf("x", leftX + colW - 20, oy + 4, 16, "center")
            game._trade._offeredRects[i] = { x = leftX + colW - 24, y = oy, w = 22, h = TRADE_ITEM_H }
            oy = oy + TRADE_ITEM_H
        end
        -- Show offered coins line
        if game._trade.myOffer.chips > 0 then
            if oy + TRADE_ITEM_H <= offeredTop + offeredH then
                love.graphics.setColor(1, 0.85, 0.3, 1)
                love.graphics.printf("Coins: " .. game._trade.myOffer.chips, leftX + 4, oy + 4, colW - 8, "left")
            end
        end
    end

    -- Inventory list (bottom portion of column)
    local invLabelY = offeredTop + offeredH + 4
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.7, 0.7, 0.75, 0.8)
    love.graphics.printf("Inventory (click to add)", leftX, invLabelY, colW, "center")

    local invTop = invLabelY + 14
    local invH = colTop + colH - invTop
    love.graphics.setColor(0.04, 0.04, 0.08, 0.6)
    love.graphics.rectangle("fill", leftX, invTop, colW, invH, 4, 4)
    love.graphics.setColor(0.3, 0.35, 0.25, 0.4)
    love.graphics.rectangle("line", leftX, invTop, colW, invH, 4, 4)

    -- Store region for scroll clipping
    game._trade._invRegion = { x = leftX, y = invTop, w = colW, h = invH }

    local invItems = getTradableInventory()
    game._trade._invItems = invItems  -- cache for click handler
    game._trade._invRects = {}

    love.graphics.setScissor(leftX, invTop, colW, invH)
    local iy = invTop + 2 - game._trade.myScroll
    for i, item in ipairs(invItems) do
        if iy + TRADE_ITEM_H > invTop and iy < invTop + invH then
            local label
            if item.type == "resource" then
                label = item.name .. " (" .. item.amount .. ")"
                love.graphics.setColor(0.8, 0.82, 0.85, 1)
            else
                label = item.name
                local rc = RARITY_COLORS[item.rarity] or {0.7, 0.7, 0.7}
                love.graphics.setColor(rc[1], rc[2], rc[3], 1)
            end
            love.graphics.printf(label, leftX + 4, iy + 4, colW - 28, "left")
            -- [+] indicator
            love.graphics.setColor(0.3, 0.9, 0.3, 0.8)
            love.graphics.printf("+", leftX + colW - 20, iy + 4, 16, "center")
        end
        game._trade._invRects[i] = { x = leftX, y = iy, w = colW, h = TRADE_ITEM_H }
        iy = iy + TRADE_ITEM_H
    end
    -- Track max scroll
    local maxScroll = math.max(0, #invItems * TRADE_ITEM_H - invH + 4)
    if game._trade.myScroll > maxScroll then game._trade.myScroll = maxScroll end
    love.graphics.setScissor()

    -- ===================== RIGHT COLUMN: Their Offer =====================
    love.graphics.setFont(fonts.chat)
    love.graphics.setColor(0.6, 0.8, 1, 1)
    love.graphics.printf("Their Offer", rightX, colTop, colW, "center")
    if game._trade.theirConfirmed then
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.2, 1, 0.3, 1)
        love.graphics.printf("CONFIRMED", rightX, colTop + 1, colW - 4, "right")
    end

    local theirTop = colTop + 20
    local theirH = colH  -- full column height for their offer (read-only)
    love.graphics.setColor(0.04, 0.04, 0.08, 0.6)
    love.graphics.rectangle("fill", rightX, theirTop, colW, theirH, 4, 4)
    love.graphics.setColor(0.2, 0.35, 0.5, 0.5)
    love.graphics.rectangle("line", rightX, theirTop, colW, theirH, 4, 4)

    love.graphics.setFont(fonts.npc)
    if #game._trade.theirOffer.items == 0 and game._trade.theirOffer.chips == 0 then
        love.graphics.setColor(0.5, 0.5, 0.55, 0.6)
        love.graphics.printf("(waiting for offer...)", rightX, theirTop + theirH / 2 - 6, colW, "center")
    else
        local ty = theirTop + 2
        for _, item in ipairs(game._trade.theirOffer.items) do
            if ty + TRADE_ITEM_H > theirTop + theirH then break end
            local label
            if item.type == "resource" then
                label = formatResourceName(item.resource or "?") .. " x" .. (item.amount or 1)
                love.graphics.setColor(0.85, 0.85, 0.9, 1)
            elseif item.type == "card" then
                label = "Card: " .. (item.cardInstanceId or "?"):sub(1, 12)
                love.graphics.setColor(0.7, 0.6, 1, 1)
            else
                label = tostring(item.type or "???")
                love.graphics.setColor(0.7, 0.7, 0.7, 1)
            end
            love.graphics.printf(label, rightX + 4, ty + 4, colW - 8, "left")
            ty = ty + TRADE_ITEM_H
        end
        -- Their coins
        if game._trade.theirOffer.chips > 0 then
            if ty + TRADE_ITEM_H <= theirTop + theirH then
                love.graphics.setColor(1, 0.85, 0.3, 1)
                love.graphics.printf("Coins: " .. game._trade.theirOffer.chips, rightX + 4, ty + 4, colW - 8, "left")
            end
        end
    end

    -- ===================== BOTTOM CONTROLS =====================
    local ctrlY = py + ph - TRADE_INV_BOT + 4

    -- Coin input field (left side)
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.7, 0.7, 0.75, 0.8)
    love.graphics.print("Offer Coins:", leftX, ctrlY)

    local inputX = leftX + 78
    local inputW = colW - 78
    local inputH = 20
    -- Input box background
    if game._trade.coinInputActive then
        love.graphics.setColor(0.12, 0.11, 0.18, 1)
    else
        love.graphics.setColor(0.06, 0.06, 0.1, 0.8)
    end
    love.graphics.rectangle("fill", inputX, ctrlY - 2, inputW, inputH, 3, 3)
    love.graphics.setColor(game._trade.coinInputActive and {0.75, 0.6, 0.2, 0.9} or {0.4, 0.35, 0.25, 0.5})
    love.graphics.rectangle("line", inputX, ctrlY - 2, inputW, inputH, 3, 3)
    -- Input text / placeholder
    love.graphics.setColor(1, 0.9, 0.5, 1)
    local displayText = game._trade.coinInput
    if displayText == "" then
        love.graphics.setColor(0.5, 0.5, 0.55, 0.5)
        displayText = "0"
    end
    -- Blinking cursor when active
    if game._trade.coinInputActive then
        local cursorBlink = math.floor(love.timer.getTime() * 2) % 2 == 0
        if cursorBlink then
            displayText = displayText .. "|"
        end
    end
    love.graphics.printf(displayText, inputX + 4, ctrlY, inputW - 8, "left")
    game._trade._coinInputRect = { x = inputX, y = ctrlY - 2, w = inputW, h = inputH }

    -- "Set" button next to coin input to apply coins to offer
    local setBtnW = 36
    local setBtnX = leftX + colW - setBtnW
    local setBtnY = ctrlY + inputH + 4
    love.graphics.setColor(0.5, 0.45, 0.2, 0.9)
    love.graphics.rectangle("fill", setBtnX, setBtnY, setBtnW, 18, 3, 3)
    love.graphics.setColor(1, 0.9, 0.5, 1)
    love.graphics.printf("Set", setBtnX, setBtnY + 1, setBtnW, "center")
    game._trade._coinSetBtn = { x = setBtnX, y = setBtnY, w = setBtnW, h = 18 }

    -- Current coin balance label
    love.graphics.setColor(0.55, 0.55, 0.6, 0.7)
    love.graphics.printf("Balance: " .. (account and account.coins or 0), leftX, setBtnY + 2, colW - setBtnW - 8, "left")

    -- Confirm button (right side bottom)
    local confirmW = colW
    local confirmH = 28
    local confirmX = rightX
    local confirmY = ctrlY + 4
    local canConfirm = hasOfferContent() and not game._trade.myConfirmed
    if game._trade.myConfirmed then
        love.graphics.setColor(0.15, 0.5, 0.2, 0.9)
    elseif canConfirm then
        love.graphics.setColor(0.2, 0.6, 0.3, 0.9)
    else
        love.graphics.setColor(0.25, 0.25, 0.3, 0.6)
    end
    love.graphics.rectangle("fill", confirmX, confirmY, confirmW, confirmH, 4, 4)
    love.graphics.setFont(fonts.chat)
    if game._trade.myConfirmed then
        love.graphics.setColor(0.4, 1, 0.5, 1)
        love.graphics.printf("CONFIRMED", confirmX, confirmY + 5, confirmW, "center")
    elseif canConfirm then
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.printf("Confirm Trade", confirmX, confirmY + 5, confirmW, "center")
    else
        love.graphics.setColor(0.5, 0.5, 0.55, 0.6)
        love.graphics.printf("Confirm Trade", confirmX, confirmY + 5, confirmW, "center")
    end
    game._trade._confirmBtn = { x = confirmX, y = confirmY, w = confirmW, h = confirmH }

    -- Cancel button (below confirm)
    local cancelW = colW
    local cancelH = 22
    local cancelX = rightX
    local cancelY = confirmY + confirmH + 6
    love.graphics.setColor(0.5, 0.2, 0.2, 0.8)
    love.graphics.rectangle("fill", cancelX, cancelY, cancelW, cancelH, 4, 4)
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(1, 0.7, 0.7, 1)
    love.graphics.printf("Cancel Trade", cancelX, cancelY + 3, cancelW, "center")
    game._trade._cancelBtn = { x = cancelX, y = cancelY, w = cancelW, h = cancelH }

    -- Message feedback (bottom center)
    if game._trade.message and game._trade.message.timer and game._trade.message.timer > 0 then
        local alpha = math.min(1, game._trade.message.timer)
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(game._trade.message.color[1], game._trade.message.color[2], game._trade.message.color[3], alpha)
        love.graphics.printf(game._trade.message.text, px + 14, py + ph - 16, pw - 28, "center")
    end

    -- Escape hint
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.4, 0.4, 0.35, 0.5)
    love.graphics.printf("Esc to cancel", px, py + ph - 16, pw - 10, "right")
end

-- Draw the incoming game._trade request popup (small overlay near top of screen)
local function drawTradeRequestPopup(W, H)
    if not game._trade.pendingRequest then return end

    local popW = 340
    local popH = 60
    local popX = math.floor((W - popW) / 2)
    local popY = 10

    -- Background
    love.graphics.setColor(0.08, 0.07, 0.12, 0.95)
    love.graphics.rectangle("fill", popX, popY, popW, popH, 6, 6)
    -- Gold border
    love.graphics.setColor(0.75, 0.6, 0.2, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", popX, popY, popW, popH, 6, 6)
    love.graphics.setLineWidth(1)

    -- Text
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(1, 0.9, 0.5, 1)
    local msg = (game._trade.pendingRequest.fromName or "???") .. " wants to trade"
    love.graphics.printf(msg, popX + 10, popY + 6, popW - 20, "center")

    -- Timer text
    if game._trade._pendingTimer then
        love.graphics.setColor(0.6, 0.6, 0.65, 0.6)
        love.graphics.printf(math.ceil(game._trade._pendingTimer) .. "s", popX + popW - 40, popY + 6, 30, "right")
    end

    -- Accept button
    local btnW = 80
    local btnH = 22
    local btnY = popY + 30
    local acceptX = popX + popW / 2 - btnW - 10
    love.graphics.setColor(0.2, 0.55, 0.25, 0.9)
    love.graphics.rectangle("fill", acceptX, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Accept (Y)", acceptX, btnY + 3, btnW, "center")
    game._trade._acceptBtn = { x = acceptX, y = btnY, w = btnW, h = btnH }

    -- Decline button
    local declineX = popX + popW / 2 + 10
    love.graphics.setColor(0.55, 0.2, 0.2, 0.9)
    love.graphics.rectangle("fill", declineX, btnY, btnW, btnH, 4, 4)
    love.graphics.setColor(1, 0.7, 0.7, 1)
    love.graphics.printf("Decline (N)", declineX, btnY + 3, btnW, "center")
    game._trade._declineBtn = { x = declineX, y = btnY, w = btnW, h = btnH }
end

-- Trade panel: handle click, returns true if click was consumed
local function handleTradeClick(mx, my)
    local client = getClient()
    if not game._trade.show then return false end

    local px = game._trade._panelX or 0
    local py = game._trade._panelY or 0
    local pw = game._trade._panelW or TRADE_W
    local ph = game._trade._panelH or TRADE_H

    -- Click outside panel: cancel game._trade
    if mx < px or mx > px + pw or my < py or my > py + ph then
        if game._trade.tradeId and client then
            client:emit("trade_cancel", { tradeId = game._trade.tradeId })
        end
        resetTradeState()
        return true
    end

    -- Close button
    if game._trade._closeBtn then
        local btn = game._trade._closeBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            if game._trade.tradeId and client then
                client:emit("trade_cancel", { tradeId = game._trade.tradeId })
            end
            resetTradeState()
            return true
        end
    end

    -- Cancel button
    if game._trade._cancelBtn then
        local btn = game._trade._cancelBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            if game._trade.tradeId and client then
                client:emit("trade_cancel", { tradeId = game._trade.tradeId })
            end
            resetTradeState()
            return true
        end
    end

    -- Confirm button
    if game._trade._confirmBtn then
        local btn = game._trade._confirmBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            if hasOfferContent() and not game._trade.myConfirmed and client and game._trade.tradeId then
                client:emit("trade_confirm", { tradeId = game._trade.tradeId })
                game._trade.myConfirmed = true
            end
            return true
        end
    end

    -- Coin input field click (activate/deactivate)
    if game._trade._coinInputRect then
        local btn = game._trade._coinInputRect
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            game._trade.coinInputActive = true
            return true
        else
            -- Clicking elsewhere deactivates coin input
            game._trade.coinInputActive = false
        end
    end

    -- Coin "Set" button
    if game._trade._coinSetBtn then
        local btn = game._trade._coinSetBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            local amount = tonumber(game._trade.coinInput) or 0
            amount = math.floor(amount)
            local maxCoins = (account and account.coins) or 0
            amount = math.max(0, math.min(amount, maxCoins))
            game._trade.myOffer.chips = amount
            game._trade.coinInput = amount > 0 and tostring(amount) or ""
            emitTradeOffer()
            return true
        end
    end

    -- Remove offered item [x] buttons
    if game._trade._offeredRects then
        for i, rect in pairs(game._trade._offeredRects) do
            if mx >= rect.x and mx <= rect.x + rect.w and my >= rect.y and my <= rect.y + rect.h then
                -- Remove item from offer
                if game._trade.myOffer.items[i] then
                    table.remove(game._trade.myOffer.items, i)
                    emitTradeOffer()
                end
                return true
            end
        end
    end

    -- Inventory item clicks (add to offer)
    if game._trade._invRects and game._trade._invItems then
        local region = game._trade._invRegion
        for i, rect in pairs(game._trade._invRects) do
            if mx >= rect.x and mx <= rect.x + rect.w and my >= rect.y and my <= rect.y + rect.h then
                -- Must be in visible region
                if region and my >= region.y and my < region.y + region.h then
                    local item = game._trade._invItems[i]
                    if item then
                        if item.type == "resource" then
                            -- Check if this resource is already in the offer; if so, increment
                            local found = false
                            for _, oi in ipairs(game._trade.myOffer.items) do
                                if oi.type == "resource" and oi.resource == item.resource then
                                    oi.amount = (oi.amount or 0) + 1
                                    found = true
                                    break
                                end
                            end
                            if not found then
                                -- Max 10 item slots (server limit)
                                if #game._trade.myOffer.items < 10 then
                                    table.insert(game._trade.myOffer.items, {
                                        type = "resource",
                                        resource = item.resource,
                                        amount = 1,
                                    })
                                end
                            end
                        elseif item.type == "card" then
                            -- Add card (one per slot)
                            if #game._trade.myOffer.items < 10 then
                                table.insert(game._trade.myOffer.items, {
                                    type = "card",
                                    cardInstanceId = item.cardInstanceId,
                                    name = item.name,
                                    rarity = item.rarity,
                                })
                            end
                        end
                        emitTradeOffer()
                    end
                end
                return true
            end
        end
    end

    -- Consume click inside panel
    return true
end

-- Trade request popup: handle click, returns true if consumed
local function handleTradeRequestClick(mx, my)
    local client = getClient()
    if not game._trade.pendingRequest then return false end

    -- Accept button
    if game._trade._acceptBtn then
        local btn = game._trade._acceptBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            if client then
                client:emit("trade_accept", { tradeId = game._trade.pendingRequest.tradeId })
            end
            return true
        end
    end

    -- Decline button
    if game._trade._declineBtn then
        local btn = game._trade._declineBtn
        if mx >= btn.x and mx <= btn.x + btn.w and my >= btn.y and my <= btn.y + btn.h then
            if client then
                client:emit("trade_cancel", { tradeId = game._trade.pendingRequest.tradeId })
            end
            game._trade.pendingRequest = nil
            game._trade._pendingTimer = nil
            return true
        end
    end

    return false
end

-- Admin panel overlay (F10 for server hosts)
local function drawAdminPanel(W, H)
    if not game._admin.showPanel then return end

    local panelW = 300
    local panelX = W - panelW
    local panelY = 0
    local panelH = H
    local font = fonts.ui or love.graphics.getFont()
    local smallFont = fonts.chat or fonts.npc or font
    local lineH = font:getHeight() + 4
    local smallLineH = smallFont:getHeight() + 4

    -- Semi-transparent dark background
    love.graphics.setColor(0, 0, 0, 0.85)
    love.graphics.rectangle("fill", panelX, panelY, panelW, panelH)
    -- Border
    love.graphics.setColor(0.4, 0.4, 0.6, 0.8)
    love.graphics.rectangle("line", panelX, panelY, panelW, panelH)

    local y = panelY + 12
    local padX = panelX + 12
    local contentW = panelW - 24

    -- Title
    love.graphics.setFont(font)
    love.graphics.setColor(1, 0.85, 0.2, 1)
    love.graphics.printf("Server Admin Panel", padX, y, contentW, "center")
    y = y + lineH + 4

    -- Separator
    love.graphics.setColor(0.4, 0.4, 0.6, 0.5)
    love.graphics.line(padX, y, padX + contentW, y)
    y = y + 8

    -- Server name
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.7, 0.7, 0.8, 1)
    local shardName = (_G.selectedShard and _G.selectedShard.name) or "Unknown Server"
    love.graphics.printf("Server: " .. shardName, padX, y, contentW, "left")
    y = y + smallLineH + 2

    -- Connected players header
    love.graphics.setColor(0.6, 0.9, 1, 1)
    love.graphics.printf("Connected Players:", padX, y, contentW, "left")
    y = y + smallLineH + 2

    -- Player list with kick buttons
    local playerCount = 0
    for id, p in pairs(players) do
        playerCount = playerCount + 1
        local isMe = (id == myId)
        local pName = p.name or p.username or ("Player " .. tostring(id):sub(1, 8))

        -- Player name
        if isMe then
            love.graphics.setColor(0.3, 1, 0.3, 1)
            love.graphics.printf("  " .. pName .. " (you)", padX, y, contentW - 60, "left")
        else
            love.graphics.setColor(0.9, 0.9, 0.9, 1)
            love.graphics.printf("  " .. pName, padX, y, contentW - 60, "left")

            -- Kick button
            local btnX = padX + contentW - 50
            local btnY = y - 1
            local btnW = 46
            local btnH = smallLineH - 2
            love.graphics.setColor(0.6, 0.15, 0.15, 0.8)
            love.graphics.rectangle("fill", btnX, btnY, btnW, btnH, 3, 3)
            love.graphics.setColor(1, 0.5, 0.5, 1)
            love.graphics.rectangle("line", btnX, btnY, btnW, btnH, 3, 3)
            love.graphics.setColor(1, 1, 1, 1)
            love.graphics.printf("Kick", btnX, btnY + 1, btnW, "center")
        end
        y = y + smallLineH + 1

        -- Clamp if too many players
        if y > panelH - 200 then
            love.graphics.setColor(0.5, 0.5, 0.5, 1)
            love.graphics.printf("  ... and more", padX, y, contentW, "left")
            y = y + smallLineH
            break
        end
    end

    if playerCount == 0 then
        love.graphics.setColor(0.5, 0.5, 0.5, 1)
        love.graphics.printf("  No players in zone", padX, y, contentW, "left")
        y = y + smallLineH
    end

    -- Separator
    y = y + 8
    love.graphics.setColor(0.4, 0.4, 0.6, 0.5)
    love.graphics.line(padX, y, padX + contentW, y)
    y = y + 10

    -- XP Rate control
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.8, 0.8, 1, 1)
    love.graphics.printf("XP Rate: " .. string.format("%.1fx", game._admin.xpRate), padX, y, contentW - 80, "left")

    -- - button
    local btnMX = padX + contentW - 75
    local btnPX = padX + contentW - 35
    local btnSize = 28

    love.graphics.setColor(0.3, 0.3, 0.5, 0.9)
    love.graphics.rectangle("fill", btnMX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(0.5, 0.5, 0.8, 1)
    love.graphics.rectangle("line", btnMX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("-", btnMX, y, btnSize, "center")

    -- + button
    love.graphics.setColor(0.3, 0.3, 0.5, 0.9)
    love.graphics.rectangle("fill", btnPX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(0.5, 0.5, 0.8, 1)
    love.graphics.rectangle("line", btnPX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("+", btnPX, y, btnSize, "center")

    y = y + btnSize + 8

    -- Drop Rate control
    love.graphics.setColor(0.8, 0.8, 1, 1)
    love.graphics.printf("Drop Rate: " .. string.format("%.1fx", game._admin.dropRate), padX, y, contentW - 80, "left")

    -- - button
    love.graphics.setColor(0.3, 0.3, 0.5, 0.9)
    love.graphics.rectangle("fill", btnMX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(0.5, 0.5, 0.8, 1)
    love.graphics.rectangle("line", btnMX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("-", btnMX, y, btnSize, "center")

    -- + button
    love.graphics.setColor(0.3, 0.3, 0.5, 0.9)
    love.graphics.rectangle("fill", btnPX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(0.5, 0.5, 0.8, 1)
    love.graphics.rectangle("line", btnPX, y - 2, btnSize, btnSize, 3, 3)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("+", btnPX, y, btnSize, "center")

    y = y + btnSize + 12

    -- Admin result message
    if game._admin.resultMsg and game._admin.resultMsg.timer > 0 then
        local alpha = math.min(1, game._admin.resultMsg.timer)
        love.graphics.setColor(game._admin.resultMsg.color[1], game._admin.resultMsg.color[2], game._admin.resultMsg.color[3], alpha)
        love.graphics.printf(game._admin.resultMsg.text, padX, y, contentW, "center")
        y = y + smallLineH + 4
    end

    -- Shutdown warning
    if game._admin.shutdownWarning and game._admin.shutdownWarning > 0 then
        love.graphics.setColor(1, 0.2, 0.2, 1)
        love.graphics.printf("SHUTDOWN IN " .. math.ceil(game._admin.shutdownWarning) .. "s", padX, y, contentW, "center")
        y = y + smallLineH + 4
    end

    -- Separator before shutdown button
    y = math.max(y, panelH - 50)
    love.graphics.setColor(0.4, 0.4, 0.6, 0.5)
    love.graphics.line(padX, y - 6, padX + contentW, y - 6)

    -- Shutdown server button
    local shutBtnW = contentW - 20
    local shutBtnH = 30
    local shutBtnX = padX + 10
    local shutBtnY = y
    love.graphics.setColor(0.5, 0.1, 0.1, 0.9)
    love.graphics.rectangle("fill", shutBtnX, shutBtnY, shutBtnW, shutBtnH, 4, 4)
    love.graphics.setColor(1, 0.3, 0.3, 1)
    love.graphics.rectangle("line", shutBtnX, shutBtnY, shutBtnW, shutBtnH, 4, 4)
    love.graphics.setFont(font)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("Shutdown Server", shutBtnX, shutBtnY + (shutBtnH - font:getHeight()) / 2, shutBtnW, "center")

    -- Footer hint
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.4, 0.4, 0.5, 0.7)
    love.graphics.printf("F10 or Esc to close", padX, panelH - smallLineH - 4, contentW, "center")
end

-- Handle game._admin panel mouse clicks
local function handleAdminPanelClick(mx, my)
    local client = getClient()
    if not game._admin.showPanel or not client then return false end

    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()
    local panelW = 300
    local panelX = W - panelW

    -- Not inside the panel
    if mx < panelX or mx > W then return false end

    local smallFont = fonts.chat or fonts.npc or fonts.ui or love.graphics.getFont()
    local font = fonts.ui or love.graphics.getFont()
    local lineH = font:getHeight() + 4
    local smallLineH = smallFont:getHeight() + 4
    local padX = panelX + 12
    local contentW = panelW - 24

    -- Reconstruct Y positions to match draw
    local y = 12 + lineH + 4 + 8 + smallLineH + 2 + smallLineH + 2

    -- Scan player list for kick buttons
    for id, p in pairs(players) do
        local isMe = (id == myId)
        if not isMe then
            local btnX = padX + contentW - 50
            local btnY = y - 1
            local btnW = 46
            local btnH = smallLineH - 2
            if mx >= btnX and mx <= btnX + btnW and my >= btnY and my <= btnY + btnH then
                client:emit("admin_kick_player", { targetId = id })
                game._admin.resultMsg = { text = "Kick sent...", color = {1, 0.8, 0.3}, timer = 3 }
                return true
            end
        end
        y = y + smallLineH + 1
        if y > H - 200 then
            y = y + smallLineH
            break
        end
    end

    -- Move past separator to rate controls
    y = y + 8 + 10

    -- XP Rate buttons
    local btnSize = 28
    local btnMX = padX + contentW - 75
    local btnPX = padX + contentW - 35

    -- XP Rate - button (clamped to server-valid range 0.5-5.0)
    if mx >= btnMX and mx <= btnMX + btnSize and my >= y - 2 and my <= y - 2 + btnSize then
        game._admin.xpRate = math.max(0.5, game._admin.xpRate - 0.5)
        client:emit("admin_update_rules", { xpRate = game._admin.xpRate, dropRate = game._admin.dropRate })
        return true
    end
    -- XP Rate + button
    if mx >= btnPX and mx <= btnPX + btnSize and my >= y - 2 and my <= y - 2 + btnSize then
        game._admin.xpRate = math.min(5.0, game._admin.xpRate + 0.5)
        client:emit("admin_update_rules", { xpRate = game._admin.xpRate, dropRate = game._admin.dropRate })
        return true
    end

    y = y + btnSize + 8

    -- Drop Rate - button (clamped to server-valid range 0.5-5.0)
    if mx >= btnMX and mx <= btnMX + btnSize and my >= y - 2 and my <= y - 2 + btnSize then
        game._admin.dropRate = math.max(0.5, game._admin.dropRate - 0.5)
        client:emit("admin_update_rules", { xpRate = game._admin.xpRate, dropRate = game._admin.dropRate })
        return true
    end
    -- Drop Rate + button
    if mx >= btnPX and mx <= btnPX + btnSize and my >= y - 2 and my <= y - 2 + btnSize then
        game._admin.dropRate = math.min(5.0, game._admin.dropRate + 0.5)
        client:emit("admin_update_rules", { xpRate = game._admin.xpRate, dropRate = game._admin.dropRate })
        return true
    end

    -- Shutdown button (at bottom of panel)
    local shutBtnW = contentW - 20
    local shutBtnH = 30
    local shutBtnX = padX + 10
    local shutBtnY = math.max(y + btnSize + 12 + (game._admin.resultMsg and game._admin.resultMsg.timer and game._admin.resultMsg.timer > 0 and (smallLineH + 4) or 0) + (game._admin.shutdownWarning and game._admin.shutdownWarning > 0 and (smallLineH + 4) or 0), H - 50)
    if mx >= shutBtnX and mx <= shutBtnX + shutBtnW and my >= shutBtnY and my <= shutBtnY + shutBtnH then
        client:emit("admin_shutdown", {})
        game._admin.resultMsg = { text = "Shutdown command sent", color = {1, 0.5, 0.2}, timer = 5 }
        return true
    end

    -- Consume click inside panel even if no button hit (prevents world interaction)
    return true
end

function panels.init(gameRef, ctx)
    game = gameRef
    fonts = ctx.fonts
    ui = ctx.ui
    rpg = ctx.rpg
    getAccount = ctx.getAccount
    getMmoInventory = ctx.getMmoInventory
    getClient = ctx.getClient
    -- Register draw and input functions onto game table
    gameRef.drawPortalPanel        = drawPortalPanel
    gameRef.handlePortalClick      = handlePortalClick
    gameRef.drawNpcShop            = drawNpcShop
    gameRef.handleNpcShopClick     = handleNpcShopClick
    gameRef.drawBank               = drawBank
    gameRef.drawBankGoldTab        = drawBankGoldTab
    gameRef.drawBankResourcesTab   = drawBankResourcesTab
    gameRef.drawBankItemsTab       = drawBankItemsTab
    gameRef.handleBankClick        = handleBankClick
    gameRef.drawTradePanel         = drawTradePanel
    gameRef.drawTradeRequestPopup  = drawTradeRequestPopup
    gameRef.handleTradeClick       = handleTradeClick
    gameRef.handleTradeRequestClick = handleTradeRequestClick
    gameRef.drawAdminPanel         = drawAdminPanel
    gameRef.handleAdminPanelClick  = handleAdminPanelClick
end

return panels
