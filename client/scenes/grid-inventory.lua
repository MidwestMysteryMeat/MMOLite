-- grid-inventory.lua — Tarkov-style 2D grid inventory UI
-- Drag-and-drop with ghost preview, rotation (R key), stack splitting,
-- paperdoll equipment display, container sub-grids, pocket grid.

local gridInventory = {}

-- Grid cell size in pixels
local CELL_SIZE = 48
local CELL_PAD = 2

-- Colors
local C = {
    bg        = {0.05, 0.05, 0.10, 0.95},
    cellEmpty = {0.12, 0.13, 0.18, 0.80},
    cellOccupied = {0.18, 0.20, 0.28, 0.90},
    cellHover = {0.30, 0.35, 0.50, 0.60},
    cellValid = {0.15, 0.50, 0.20, 0.40},
    cellInvalid = {0.55, 0.12, 0.12, 0.40},
    border    = {0.30, 0.30, 0.40, 0.60},
    itemBorder = {0.50, 0.50, 0.60, 0.80},
    text      = {0.90, 0.90, 0.85, 1.00},
    gold      = {0.90, 0.85, 0.40, 1.00},
    dimText   = {0.60, 0.60, 0.70, 0.70},
    pocket    = {0.20, 0.18, 0.30, 0.90},
    equip     = {0.10, 0.12, 0.20, 0.85},
    equipSlot = {0.15, 0.17, 0.25, 0.70},
    equipSlotHover = {0.25, 0.28, 0.40, 0.70},
    rarity = {
        common    = {0.70, 0.70, 0.70},
        uncommon  = {0.30, 0.80, 0.30},
        rare      = {0.30, 0.50, 1.00},
        ultra_rare= {0.70, 0.30, 0.90},
        mythic    = {1.00, 0.50, 0.15},
        legendary = {1.00, 0.85, 0.20},
        relic     = {1.00, 0.20, 0.20},
    },
}

-- State
local state = {
    grid = nil,           -- {cells, width, height, rev, placements}
    pocket = nil,         -- same shape, smaller
    equipment = {},       -- {slot -> itemId}
    containers = {},      -- {backpack/rig -> sub-grid}
    items = {},           -- array of item objects
    itemMap = {},         -- itemId -> item object (built from items array)
    rev = 0,

    -- Drag state
    dragging = nil,       -- {itemId, item, originGrid, originX, originY, rotated, offsetX, offsetY}
    dragRotated = false,

    -- Split dialog
    splitting = nil,      -- {itemId, item, maxCount, count, x, y}

    -- Context menu
    contextMenu = nil,    -- {itemId, item, x, y, options}

    -- Tooltip
    hoveredItem = nil,

    -- Layout positions (computed on draw)
    gridX = 0, gridY = 0,
    pocketX = 0, pocketY = 0,
    equipX = 0, equipY = 0,
}

-- Equipment paperdoll layout: slot -> {x, y, w, h} in relative grid units
local EQUIP_LAYOUT = {
    head      = {x=1, y=0, w=2, h=2},
    chest     = {x=1, y=2, w=2, h=3},
    undershirt= {x=3, y=2, w=2, h=2},
    arms      = {x=3, y=4, w=2, h=1},
    hands     = {x=0, y=5, w=2, h=1},
    legs      = {x=1, y=5, w=2, h=2},
    feet      = {x=1, y=7, w=2, h=1},
    main_hand = {x=-1, y=2, w=1, h=3},
    off_hand  = {x=5, y=2, w=1, h=3},
    ring1     = {x=-1, y=5, w=1, h=1},
    ring2     = {x=5, y=5, w=1, h=1},
    ring3     = {x=-1, y=6, w=1, h=1},
    ring4     = {x=5, y=6, w=1, h=1},
    ring5     = {x=-1, y=7, w=1, h=1},
    ring6     = {x=5, y=7, w=1, h=1},
    necklace  = {x=3, y=0, w=1, h=1},
    axe       = {x=-1, y=0, w=1, h=2},
    pickaxe   = {x=5, y=0, w=1, h=2},
    backpack  = {x=6, y=0, w=2, h=3},
    rig       = {x=6, y=3, w=2, h=2},
}

local client = nil
local fonts = nil
local game = nil
local resources = {}

function gridInventory.init(clientRef, fontsRef, gameRef)
    client = clientRef
    fonts = fontsRef
    game = gameRef

    -- Register socket events
    client:on("grid_state", function(data)
        gridInventory.applyFullState(data)
    end)

    client:on("grid_update", function(data)
        if data and data.rev then
            state.rev = data.rev
        end
        -- Request full state to keep it simple for now
        client:emit("grid_sync", {})
    end)

    client:on("grid_reject", function(data)
        if data and data.fullState then
            gridInventory.applyFullState(data.fullState)
        end
    end)

    client:on("grid_item_added", function(data)
        if data and data.item then
            table.insert(state.items, data.item)
            state.itemMap[data.item.id] = data.item
        end
        if data and data.rev then state.rev = data.rev end
        client:emit("grid_sync", {})
    end)
end

function gridInventory.setResources(res)
    resources = res or {}
end

function gridInventory.applyFullState(data)
    if not data then return end
    state.grid = data.grid
    state.pocket = data.pocket
    state.equipment = data.equipment or {}
    state.containers = data.containers or {}
    state.items = data.items or {}
    state.rev = data.rev or 0

    -- Build item map
    state.itemMap = {}
    for _, item in ipairs(state.items) do
        state.itemMap[item.id] = item
    end
end

function gridInventory.requestSync()
    if client then
        client:emit("grid_sync", {})
    end
end

-- =========================================================================
-- Drawing
-- =========================================================================

function gridInventory.draw(W, H)
    if not state.grid then return end

    love.graphics.setColor(0, 0, 0, 0.65)
    love.graphics.rectangle("fill", 0, 0, W, H)

    local gridW = state.grid.width * (CELL_SIZE + CELL_PAD) + CELL_PAD
    local gridH = state.grid.height * (CELL_SIZE + CELL_PAD) + CELL_PAD

    -- Equipment panel on the left
    local equipW = 8 * (CELL_SIZE * 0.6 + CELL_PAD) + CELL_PAD
    local equipH = 9 * (CELL_SIZE * 0.6 + CELL_PAD) + CELL_PAD

    local totalW = equipW + 20 + gridW + 20
    local startX = math.max(20, (W - totalW) / 2)
    local startY = math.max(40, (H - math.max(gridH, equipH) - 80) / 2)

    -- Title
    if fonts and fonts.title then love.graphics.setFont(fonts.title) end
    love.graphics.setColor(C.gold)
    love.graphics.printf("Inventory", 0, startY - 30, W, "center")

    -- Equipment paperdoll
    state.equipX = startX
    state.equipY = startY + 10
    gridInventory.drawEquipment(state.equipX, state.equipY)

    -- Main grid
    state.gridX = startX + equipW + 20
    state.gridY = startY + 10
    gridInventory.drawGrid(state.grid, state.gridX, state.gridY, "Main Inventory")

    -- Pocket grid (below equipment)
    local pocketGridH = (state.pocket and state.pocket.height or 2) * (CELL_SIZE + CELL_PAD) + CELL_PAD
    state.pocketX = state.equipX
    state.pocketY = state.equipY + equipH + 20
    if state.pocket then
        gridInventory.drawGrid(state.pocket, state.pocketX, state.pocketY, "Hidden Pocket")
    end

    -- Container sub-grids (below main grid)
    local containerY = state.gridY + gridH + 15
    if state.containers.backpack then
        gridInventory.drawGrid(state.containers.backpack, state.gridX, containerY, "Backpack")
        local bpH = state.containers.backpack.height * (CELL_SIZE + CELL_PAD) + CELL_PAD
        containerY = containerY + bpH + 15
    end
    if state.containers.rig then
        gridInventory.drawGrid(state.containers.rig, state.gridX, containerY, "Rig")
    end

    -- Capacity display + resources
    if state.grid then
        local used = 0
        if state.grid.cells then
            local seen = {}
            for _, id in pairs(state.grid.cells) do
                if not seen[id] then
                    seen[id] = true
                    used = used + 1
                end
            end
        end
        if fonts and fonts.chat then love.graphics.setFont(fonts.chat) end
        love.graphics.setColor(C.dimText)
        love.graphics.print(string.format("Grid: %d items", used), state.gridX, state.gridY + gridH + 2)

        -- Resource counts
        local resY = state.gridY + gridH + 18
        local resNames = {
            {key = "wood",     label = "Wood",     color = {0.65, 0.45, 0.25}},
            {key = "stone",    label = "Stone",    color = {0.60, 0.60, 0.60}},
            {key = "iron_ore", label = "Iron Ore", color = {0.50, 0.40, 0.35}},
            {key = "iron_bar", label = "Iron Bar", color = {0.70, 0.70, 0.75}},
            {key = "steel_bar",label = "Steel",    color = {0.55, 0.60, 0.70}},
            {key = "mithril_bar", label = "Mithril", color = {0.40, 0.60, 0.90}},
            {key = "gold_ore", label = "Gold Ore", color = {0.90, 0.85, 0.40}},
        }
        local resX = state.gridX
        for _, r in ipairs(resNames) do
            local val = resources[r.key] or 0
            if val > 0 then
                love.graphics.setColor(r.color[1], r.color[2], r.color[3], 0.9)
                love.graphics.print(r.label .. ": " .. val, resX, resY)
                resX = resX + 90
                if resX > state.gridX + gridW - 80 then
                    resX = state.gridX
                    resY = resY + 14
                end
            end
        end
    end

    -- Drag ghost
    if state.dragging then
        gridInventory.drawDragGhost()
    end

    -- Tooltip
    if state.hoveredItem and not state.dragging then
        gridInventory.drawTooltip(state.hoveredItem, love.mouse.getX(), love.mouse.getY())
    end

    -- Context menu
    if state.contextMenu then
        gridInventory.drawContextMenu()
    end

    -- Split dialog
    if state.splitting then
        gridInventory.drawSplitDialog(W, H)
    end

    -- Sort button
    local sortBtnX = state.gridX + gridW - 60
    local sortBtnY = state.gridY - 22
    love.graphics.setColor(0.15, 0.18, 0.28, 0.90)
    love.graphics.rectangle("fill", sortBtnX, sortBtnY, 55, 20, 4, 4)
    love.graphics.setColor(C.dimText)
    if fonts and fonts.chat then love.graphics.setFont(fonts.chat) end
    love.graphics.printf("Sort", sortBtnX, sortBtnY + 3, 55, "center")

    -- Controls hint
    love.graphics.setColor(0.5, 0.5, 0.6, 0.5)
    love.graphics.print("[R] Rotate  [RMB] Context  [ESC/I] Close", 10, H - 20)
end

function gridInventory.drawGrid(grid, gx, gy, label)
    if not grid then return end

    local w = grid.width
    local h = grid.height
    local pw = w * (CELL_SIZE + CELL_PAD) + CELL_PAD
    local ph = h * (CELL_SIZE + CELL_PAD) + CELL_PAD

    -- Label
    if label then
        if fonts and fonts.chat then love.graphics.setFont(fonts.chat) end
        love.graphics.setColor(C.dimText)
        love.graphics.print(label, gx, gy - 16)
    end

    -- Background
    love.graphics.setColor(C.bg)
    love.graphics.rectangle("fill", gx, gy, pw, ph, 4, 4)
    love.graphics.setColor(C.border)
    love.graphics.rectangle("line", gx, gy, pw, ph, 4, 4)

    -- Cells
    local mx, my = love.mouse.getPosition()
    local hoveredId = nil

    for cy = 0, h - 1 do
        for cx = 0, w - 1 do
            local cellX = gx + CELL_PAD + cx * (CELL_SIZE + CELL_PAD)
            local cellY = gy + CELL_PAD + cy * (CELL_SIZE + CELL_PAD)
            local key = cx .. "," .. cy
            local itemId = grid.cells and grid.cells[key]

            -- Cell background
            if itemId then
                love.graphics.setColor(C.cellOccupied)
            else
                love.graphics.setColor(C.cellEmpty)
            end
            love.graphics.rectangle("fill", cellX, cellY, CELL_SIZE, CELL_SIZE, 2, 2)

            -- Hover highlight
            if mx >= cellX and mx < cellX + CELL_SIZE and my >= cellY and my < cellY + CELL_SIZE then
                if state.dragging then
                    -- Show placement validity
                    local canPlace = gridInventory.checkPlacement(grid, cx, cy, state.dragging.item, state.dragRotated)
                    love.graphics.setColor(canPlace and C.cellValid or C.cellInvalid)
                else
                    love.graphics.setColor(C.cellHover)
                    if itemId then hoveredId = itemId end
                end
                love.graphics.rectangle("fill", cellX, cellY, CELL_SIZE, CELL_SIZE, 2, 2)
            end
        end
    end

    -- Draw items (only at their top-left placement position)
    if grid.placements then
        for itemId, pl in pairs(grid.placements) do
            local item = state.itemMap[itemId]
            if item then
                local iw = pl.rotated and (item.gridH or 1) or (item.gridW or 1)
                local ih = pl.rotated and (item.gridW or 1) or (item.gridH or 1)
                local ix = gx + CELL_PAD + pl.x * (CELL_SIZE + CELL_PAD)
                local iy = gy + CELL_PAD + pl.y * (CELL_SIZE + CELL_PAD)
                local ipw = iw * CELL_SIZE + (iw - 1) * CELL_PAD
                local iph = ih * CELL_SIZE + (ih - 1) * CELL_PAD

                -- Item background with rarity color
                local rc = C.rarity[item.rarity] or C.rarity.common
                love.graphics.setColor(rc[1], rc[2], rc[3], 0.25)
                love.graphics.rectangle("fill", ix, iy, ipw, iph, 2, 2)
                love.graphics.setColor(rc[1], rc[2], rc[3], 0.70)
                love.graphics.rectangle("line", ix, iy, ipw, iph, 2, 2)

                -- Item name (abbreviated)
                if fonts and fonts.chat then love.graphics.setFont(fonts.chat) end
                love.graphics.setColor(C.text)
                local displayName = item.baseName or item.name or item.type or "?"
                if #displayName > 8 and iw <= 1 then displayName = displayName:sub(1, 7) .. "." end
                love.graphics.printf(displayName, ix + 2, iy + iph/2 - 6, ipw - 4, "center")

                -- Stack count
                if item.stackSize and item.stackSize > 1 then
                    love.graphics.setColor(1, 1, 0.7, 1)
                    love.graphics.printf(tostring(item.stackSize), ix, iy + iph - 14, ipw - 3, "right")
                end
            end
        end
    end

    -- Update hovered item
    if hoveredId and not state.dragging then
        state.hoveredItem = state.itemMap[hoveredId]
    end
end

function gridInventory.drawEquipment(ex, ey)
    local slotSize = math.floor(CELL_SIZE * 0.6)
    local mx, my = love.mouse.getPosition()

    -- Background panel
    local pw = 8 * (slotSize + CELL_PAD) + CELL_PAD + 20
    local ph = 9 * (slotSize + CELL_PAD) + CELL_PAD + 20
    love.graphics.setColor(C.equip)
    love.graphics.rectangle("fill", ex - 10, ey - 10, pw, ph, 4, 4)
    love.graphics.setColor(C.border)
    love.graphics.rectangle("line", ex - 10, ey - 10, pw, ph, 4, 4)

    if fonts and fonts.chat then love.graphics.setFont(fonts.chat) end
    love.graphics.setColor(C.dimText)
    love.graphics.print("Equipment", ex, ey - 16)

    for slotName, layout in pairs(EQUIP_LAYOUT) do
        local sx = ex + (layout.x + 1) * (slotSize + CELL_PAD) + CELL_PAD
        local sy = ey + layout.y * (slotSize + CELL_PAD) + CELL_PAD
        local sw = layout.w * slotSize + (layout.w - 1) * CELL_PAD
        local sh = layout.h * slotSize + (layout.h - 1) * CELL_PAD

        local isHovered = mx >= sx and mx < sx + sw and my >= sy and my < sy + sh

        -- Slot background
        love.graphics.setColor(isHovered and C.equipSlotHover or C.equipSlot)
        love.graphics.rectangle("fill", sx, sy, sw, sh, 2, 2)

        local itemId = state.equipment[slotName]
        if itemId then
            local item = state.itemMap[itemId]
            if item then
                local rc = C.rarity[item.rarity] or C.rarity.common
                love.graphics.setColor(rc[1], rc[2], rc[3], 0.30)
                love.graphics.rectangle("fill", sx, sy, sw, sh, 2, 2)
                love.graphics.setColor(rc[1], rc[2], rc[3], 0.70)
                love.graphics.rectangle("line", sx, sy, sw, sh, 2, 2)

                love.graphics.setColor(C.text)
                local name = item.baseName or item.name or item.type or "?"
                if #name > 6 then name = name:sub(1, 5) .. "." end
                love.graphics.printf(name, sx + 1, sy + sh/2 - 6, sw - 2, "center")

                if isHovered then state.hoveredItem = item end
            end
        else
            -- Empty slot label
            love.graphics.setColor(0.35, 0.35, 0.45, 0.50)
            local slotLabel = slotName:gsub("_", " ")
            if #slotLabel > 8 then slotLabel = slotLabel:sub(1, 7) end
            love.graphics.printf(slotLabel, sx + 1, sy + sh/2 - 6, sw - 2, "center")
        end
    end
end

function gridInventory.drawDragGhost()
    if not state.dragging then return end
    local item = state.dragging.item
    local mx, my = love.mouse.getPosition()
    local iw = state.dragRotated and (item.gridH or 1) or (item.gridW or 1)
    local ih = state.dragRotated and (item.gridW or 1) or (item.gridH or 1)
    local pw = iw * CELL_SIZE + (iw - 1) * CELL_PAD
    local ph = ih * CELL_SIZE + (ih - 1) * CELL_PAD

    love.graphics.setColor(0.5, 0.6, 0.9, 0.45)
    love.graphics.rectangle("fill", mx - pw/2, my - ph/2, pw, ph, 2, 2)
    love.graphics.setColor(0.5, 0.6, 0.9, 0.80)
    love.graphics.rectangle("line", mx - pw/2, my - ph/2, pw, ph, 2, 2)

    if fonts and fonts.chat then love.graphics.setFont(fonts.chat) end
    love.graphics.setColor(1, 1, 1, 0.9)
    local name = item.baseName or item.name or item.type or "?"
    love.graphics.printf(name, mx - pw/2 + 2, my - 6, pw - 4, "center")
end

function gridInventory.drawTooltip(item, tx, ty)
    if not item then return end

    -- Build lines as {text, color} pairs
    local lines = {}
    local rc = C.rarity[item.rarity] or C.rarity.common
    table.insert(lines, { text = item.name or item.type or "Unknown", color = {rc[1], rc[2], rc[3], 1} })
    if item.rarity then table.insert(lines, { text = "Rarity: " .. item.rarity, color = C.dimText }) end
    if item.quality then table.insert(lines, { text = "Quality: " .. item.quality, color = {0.5, 0.8, 0.9, 0.9} }) end

    -- Stats
    if item.stats then
        for k, v in pairs(item.stats) do
            if type(v) == "number" and v ~= 0 then
                local statColor = v > 0 and {0.4, 0.9, 0.4, 0.9} or {0.9, 0.4, 0.4, 0.9}
                table.insert(lines, { text = k .. ": " .. (v > 0 and "+" or "") .. string.format("%.1f", v), color = statColor })
            end
        end
    end

    -- Damage / defense
    if item.damage and item.damage > 0 then
        table.insert(lines, { text = "Damage: " .. item.damage, color = {0.9, 0.6, 0.3, 1} })
    end
    if item.defense and item.defense > 0 then
        table.insert(lines, { text = "Defense: " .. item.defense, color = {0.3, 0.6, 0.9, 1} })
    end
    if item.magicDamage and item.magicDamage > 0 then
        table.insert(lines, { text = "Magic Dmg: " .. item.magicDamage, color = {0.6, 0.3, 0.9, 1} })
    end

    -- Affixes
    if item.affixes and #item.affixes > 0 then
        table.insert(lines, { text = "--- Affixes ---", color = {0.6, 0.6, 0.7, 0.6} })
        for _, aff in ipairs(item.affixes) do
            local label = aff.label or aff.id or "?"
            local tier = aff.tier and (" T" .. aff.tier) or ""
            table.insert(lines, { text = "  " .. label .. tier, color = {0.5, 0.8, 1, 0.9} })
        end
    end

    -- Mutations
    if item.mutations and #item.mutations > 0 then
        table.insert(lines, { text = "--- Mutations ---", color = {0.6, 0.6, 0.7, 0.6} })
        for _, mut in ipairs(item.mutations) do
            local label = mut.label or mut.id or "?"
            local tier = mut.tier and (" T" .. mut.tier) or ""
            table.insert(lines, { text = "  " .. label .. tier, color = {0.4, 0.9, 0.7, 0.9} })
        end
    end
    -- Single mutation field (older items)
    if item.mutation and not (item.mutations and #item.mutations > 0) then
        local mut = item.mutation
        local label = mut.label or mut.id or "?"
        table.insert(lines, { text = "Mutation: " .. label, color = {0.4, 0.9, 0.7, 0.9} })
    end

    -- Curses
    if item.curse then
        local curse = item.curse
        local label = curse.label or curse.id or "Cursed"
        table.insert(lines, { text = "CURSED: " .. label, color = {0.9, 0.2, 0.2, 1} })
    end

    -- Durability
    if item.durability and item.maxDurability then
        local ratio = item.durability / item.maxDurability
        local durColor = ratio > 0.5 and {0.6, 0.8, 0.6, 0.9} or ratio > 0.2 and {0.9, 0.7, 0.3, 0.9} or {0.9, 0.3, 0.3, 1}
        table.insert(lines, { text = "Durability: " .. item.durability .. "/" .. item.maxDurability, color = durColor })
    end

    -- Size + weight
    if item.gridW and item.gridH then
        table.insert(lines, { text = "Size: " .. item.gridW .. "x" .. item.gridH, color = C.dimText })
    end
    if item.weight then
        table.insert(lines, { text = string.format("Weight: %.1f", item.weight), color = C.dimText })
    end

    -- Sub-grid (container info)
    if item.subGrid then
        table.insert(lines, { text = "Container: " .. (item.subGrid.width or 0) .. "x" .. (item.subGrid.height or 0), color = {0.7, 0.5, 0.9, 0.9} })
    end

    if fonts and fonts.chat then love.graphics.setFont(fonts.chat) end
    local font = love.graphics.getFont()
    local lineH = font:getHeight() + 2
    local tipW = 220
    -- Calculate actual width needed
    for _, l in ipairs(lines) do
        local w = font:getWidth(l.text) + 16
        if w > tipW then tipW = w end
    end
    local tipH = #lines * lineH + 10

    -- Offset first, then clamp to screen (prevents tooltip overlapping cursor)
    tx = tx + 12
    ty = ty + 12
    local W, H = love.graphics.getDimensions()
    if tx + tipW + 10 > W then tx = W - tipW - 10 end
    if ty + tipH + 10 > H then ty = H - tipH - 10 end

    love.graphics.setColor(0.05, 0.05, 0.10, 0.95)
    love.graphics.rectangle("fill", tx, ty, tipW, tipH, 4, 4)
    love.graphics.setColor(C.border)
    love.graphics.rectangle("line", tx, ty, tipW, tipH, 4, 4)

    for i, l in ipairs(lines) do
        love.graphics.setColor(l.color)
        love.graphics.print(l.text, tx + 6, ty + 4 + (i-1) * lineH)
    end
end

function gridInventory.drawContextMenu()
    local cm = state.contextMenu
    if not cm then return end

    if fonts and fonts.chat then love.graphics.setFont(fonts.chat) end
    local font = love.graphics.getFont()
    local lineH = font:getHeight() + 6
    local menuW = 120
    local menuH = #cm.options * lineH + 6

    love.graphics.setColor(0.08, 0.08, 0.14, 0.95)
    love.graphics.rectangle("fill", cm.x, cm.y, menuW, menuH, 4, 4)
    love.graphics.setColor(C.border)
    love.graphics.rectangle("line", cm.x, cm.y, menuW, menuH, 4, 4)

    local mx, my = love.mouse.getPosition()
    for i, opt in ipairs(cm.options) do
        local oy = cm.y + 3 + (i-1) * lineH
        local hovered = mx >= cm.x and mx < cm.x + menuW and my >= oy and my < oy + lineH
        if hovered then
            love.graphics.setColor(0.25, 0.28, 0.40, 0.80)
            love.graphics.rectangle("fill", cm.x + 2, oy, menuW - 4, lineH, 2, 2)
        end
        love.graphics.setColor(C.text)
        love.graphics.print(opt.label, cm.x + 8, oy + 3)
    end
end

function gridInventory.drawSplitDialog(W, H)
    local sp = state.splitting
    if not sp then return end

    local dw, dh = 240, 120
    local dx = (W - dw) / 2
    local dy = (H - dh) / 2

    love.graphics.setColor(0.08, 0.08, 0.14, 0.95)
    love.graphics.rectangle("fill", dx, dy, dw, dh, 6, 6)
    love.graphics.setColor(C.border)
    love.graphics.rectangle("line", dx, dy, dw, dh, 6, 6)

    if fonts and fonts.hud then love.graphics.setFont(fonts.hud) end
    love.graphics.setColor(C.gold)
    love.graphics.printf("Split Stack", dx, dy + 10, dw, "center")

    if fonts and fonts.chat then love.graphics.setFont(fonts.chat) end
    love.graphics.setColor(C.text)
    love.graphics.printf("Amount: " .. sp.count .. " / " .. sp.maxCount, dx, dy + 40, dw, "center")

    -- Slider bar
    local barX = dx + 20
    local barY = dy + 65
    local barW = dw - 40
    local pct = sp.count / sp.maxCount
    love.graphics.setColor(0.20, 0.22, 0.30, 0.90)
    love.graphics.rectangle("fill", barX, barY, barW, 10, 3, 3)
    love.graphics.setColor(C.gold)
    love.graphics.rectangle("fill", barX, barY, barW * pct, 10, 3, 3)

    -- OK / Cancel buttons
    love.graphics.setColor(0.15, 0.40, 0.20, 0.90)
    love.graphics.rectangle("fill", dx + 30, dy + 88, 80, 22, 4, 4)
    love.graphics.setColor(C.text)
    love.graphics.printf("OK", dx + 30, dy + 91, 80, "center")

    love.graphics.setColor(0.40, 0.15, 0.15, 0.90)
    love.graphics.rectangle("fill", dx + 130, dy + 88, 80, 22, 4, 4)
    love.graphics.setColor(C.text)
    love.graphics.printf("Cancel", dx + 130, dy + 91, 80, "center")
end

-- =========================================================================
-- Placement validation (client-side prediction)
-- =========================================================================

function gridInventory.checkPlacement(grid, cx, cy, item, rotated)
    if not grid or not item then return false end
    local iw = rotated and (item.gridH or 1) or (item.gridW or 1)
    local ih = rotated and (item.gridW or 1) or (item.gridH or 1)

    if cx < 0 or cy < 0 or cx + iw > grid.width or cy + ih > grid.height then return false end

    for dy = 0, ih - 1 do
        for dx = 0, iw - 1 do
            local key = (cx + dx) .. "," .. (cy + dy)
            local existing = grid.cells and grid.cells[key]
            if existing and existing ~= (state.dragging and state.dragging.itemId) then
                return false
            end
        end
    end
    return true
end

-- =========================================================================
-- Input handling
-- =========================================================================

function gridInventory.mousepressed(x, y, button)
    -- Close context menu on any click outside it
    if state.contextMenu then
        local cm = state.contextMenu
        local font = love.graphics.getFont()
        local lineH = (font and font:getHeight() or 14) + 6
        local menuW = 120
        local menuH = #cm.options * lineH + 6
        if x >= cm.x and x < cm.x + menuW and y >= cm.y and y < cm.y + menuH then
            -- Click on context menu option
            local idx = math.floor((y - cm.y - 3) / lineH) + 1
            if idx >= 1 and idx <= #cm.options then
                cm.options[idx].action()
            end
        end
        state.contextMenu = nil
        return true
    end

    -- Split dialog
    if state.splitting then
        return gridInventory.handleSplitClick(x, y, button)
    end

    -- Sort button
    if state.grid then
        local gridW = state.grid.width * (CELL_SIZE + CELL_PAD) + CELL_PAD
        local sortBtnX = state.gridX + gridW - 60
        local sortBtnY = state.gridY - 22
        if x >= sortBtnX and x < sortBtnX + 55 and y >= sortBtnY and y < sortBtnY + 20 and button == 1 then
            client:emit("grid_sort", {rev = state.rev})
            return true
        end
    end

    if button == 1 then
        -- Try to start dragging from grid
        local gridItem, gridName, cellX, cellY = gridInventory.hitTestGrids(x, y)
        if gridItem then
            state.dragging = {
                itemId = gridItem.id,
                item = gridItem,
                originGrid = gridName,
                originX = cellX,
                originY = cellY,
                rotated = false,
            }
            state.dragRotated = false
            return true
        end

        -- Try to start dragging from equipment
        local eqSlot, eqItem = gridInventory.hitTestEquipment(x, y)
        if eqSlot and eqItem then
            state.dragging = {
                itemId = eqItem.id,
                item = eqItem,
                originGrid = "equipment",
                originSlot = eqSlot,
                rotated = false,
            }
            state.dragRotated = false
            return true
        end
    elseif button == 2 then
        -- Right-click context menu
        local gridItem = gridInventory.hitTestGrids(x, y)
        if gridItem then
            gridInventory.openContextMenu(gridItem, x, y)
            return true
        end
        local eqSlot, eqItem = gridInventory.hitTestEquipment(x, y)
        if eqSlot and eqItem then
            gridInventory.openEquipContextMenu(eqSlot, eqItem, x, y)
            return true
        end
    end

    return false
end

function gridInventory.mousereleased(x, y, button)
    if button ~= 1 or not state.dragging then return false end

    local drag = state.dragging
    state.dragging = nil

    -- Check drop on grid
    local targetGrid, cellX, cellY, gridName = gridInventory.getCellAtPos(x, y)
    if targetGrid and cellX then
        if drag.originGrid == "equipment" then
            -- Unequip to grid position
            client:emit("grid_unequip", {
                slot = drag.originSlot,
                rev = state.rev,
            })
        else
            -- Move within/between grids
            client:emit("grid_move", {
                itemId = drag.itemId,
                x = cellX,
                y = cellY,
                rotated = state.dragRotated,
                targetGrid = gridName,
                rev = state.rev,
            })
        end
        return true
    end

    -- Check drop on equipment slot
    local eqSlot = gridInventory.hitTestEquipmentSlot(x, y)
    if eqSlot then
        if drag.originGrid == "equipment" then
            -- Swap between equipment slots — not supported, just return
        else
            client:emit("grid_equip", {
                itemId = drag.itemId,
                slot = eqSlot,
                rev = state.rev,
            })
        end
        return true
    end

    -- Dropped outside any valid target — no-op (item stays in place)
    return true
end

function gridInventory.keypressed(key)
    if key == "r" and state.dragging then
        state.dragRotated = not state.dragRotated
        return true
    end
    return false
end

function gridInventory.wheelmoved(x, y)
    if state.splitting then
        state.splitting.count = math.max(1, math.min(state.splitting.maxCount, state.splitting.count + (y > 0 and 1 or -1)))
        return true
    end
    return false
end

-- =========================================================================
-- Hit testing
-- =========================================================================

function gridInventory.hitTestGrids(mx, my)
    -- Main grid
    local item, cellX, cellY = gridInventory.hitTestGrid(state.grid, state.gridX, state.gridY, mx, my)
    if item then return item, "grid", cellX, cellY end

    -- Pocket
    if state.pocket then
        item, cellX, cellY = gridInventory.hitTestGrid(state.pocket, state.pocketX, state.pocketY, mx, my)
        if item then return item, "pocket", cellX, cellY end
    end

    -- Container sub-grids (approximate positions)
    -- These are drawn below main grid, so calculate their positions
    if state.grid then
        local gridH = state.grid.height * (CELL_SIZE + CELL_PAD) + CELL_PAD
        local containerY = state.gridY + gridH + 15
        if state.containers.backpack then
            item, cellX, cellY = gridInventory.hitTestGrid(state.containers.backpack, state.gridX, containerY, mx, my)
            if item then return item, "backpack", cellX, cellY end
            local bpH = state.containers.backpack.height * (CELL_SIZE + CELL_PAD) + CELL_PAD
            containerY = containerY + bpH + 15
        end
        if state.containers.rig then
            item, cellX, cellY = gridInventory.hitTestGrid(state.containers.rig, state.gridX, containerY, mx, my)
            if item then return item, "rig", cellX, cellY end
        end
    end

    return nil
end

function gridInventory.hitTestGrid(grid, gx, gy, mx, my)
    if not grid then return nil end
    local relX = mx - gx - CELL_PAD
    local relY = my - gy - CELL_PAD
    if relX < 0 or relY < 0 then return nil end

    local cellX = math.floor(relX / (CELL_SIZE + CELL_PAD))
    local cellY = math.floor(relY / (CELL_SIZE + CELL_PAD))
    if cellX >= grid.width or cellY >= grid.height then return nil end

    local key = cellX .. "," .. cellY
    local itemId = grid.cells and grid.cells[key]
    if itemId then
        return state.itemMap[itemId], cellX, cellY
    end
    return nil, cellX, cellY
end

function gridInventory.getCellAtPos(mx, my)
    -- Main grid
    local grid = state.grid
    if grid then
        local relX = mx - state.gridX - CELL_PAD
        local relY = my - state.gridY - CELL_PAD
        if relX >= 0 and relY >= 0 then
            local cx = math.floor(relX / (CELL_SIZE + CELL_PAD))
            local cy = math.floor(relY / (CELL_SIZE + CELL_PAD))
            if cx < grid.width and cy < grid.height then
                return grid, cx, cy, "grid"
            end
        end
    end

    -- Pocket
    if state.pocket then
        local relX = mx - state.pocketX - CELL_PAD
        local relY = my - state.pocketY - CELL_PAD
        if relX >= 0 and relY >= 0 then
            local cx = math.floor(relX / (CELL_SIZE + CELL_PAD))
            local cy = math.floor(relY / (CELL_SIZE + CELL_PAD))
            if cx < state.pocket.width and cy < state.pocket.height then
                return state.pocket, cx, cy, "pocket"
            end
        end
    end

    return nil
end

function gridInventory.hitTestEquipment(mx, my)
    local slotSize = math.floor(CELL_SIZE * 0.6)
    for slotName, layout in pairs(EQUIP_LAYOUT) do
        local sx = state.equipX + (layout.x + 1) * (slotSize + CELL_PAD) + CELL_PAD
        local sy = state.equipY + layout.y * (slotSize + CELL_PAD) + CELL_PAD
        local sw = layout.w * slotSize + (layout.w - 1) * CELL_PAD
        local sh = layout.h * slotSize + (layout.h - 1) * CELL_PAD

        if mx >= sx and mx < sx + sw and my >= sy and my < sy + sh then
            local itemId = state.equipment[slotName]
            if itemId then
                return slotName, state.itemMap[itemId]
            end
            return slotName, nil
        end
    end
    return nil
end

function gridInventory.hitTestEquipmentSlot(mx, my)
    local slot, _ = gridInventory.hitTestEquipment(mx, my)
    return slot
end

-- =========================================================================
-- Context menus
-- =========================================================================

-- Consumable types for "Use" context action
local CONSUMABLE_TYPES = {
    cooked_fish = true, bread = true, stew = true, mushroom = true,
    shellfish = true, seaweed = true, herb_tea = true, grilled_meat = true,
    berry_jam = true, potion_health = true, potion_mana = true,
    potion_strength = true, potion_agility = true, potion_intellect = true,
    potion_resistance = true, potion_speed = true, elixir_vigor = true,
    elixir_fortitude = true, antidote = true, ale = true, mead = true,
    wine = true, spirits = true, fortified_ale = true, battle_brew = true,
    scroll_of_protection = true, scroll_of_strength = true, scroll_of_haste = true,
}

-- Placeable types for "Place" context action
local PLACEABLE_TYPES = {
    forge = true, iron_anvil = true, storage_chest = true,
    wall = true, door = true, raft = true, bridge = true,
    crop_plot = true, water_trough = true, crafting_table = true,
    upgrade_station = true, trading_booth = true, bed = true,
    bookshelf = true, cauldron = true, table = true, chair = true,
    barrel = true, crate = true, banner = true, loom = true,
    alchemy_table = true, enchanting_table = true, tanning_rack = true,
    brewery = true, jewelers_bench = true,
}

function gridInventory.openContextMenu(item, x, y)
    local options = {}

    -- Equip option
    if item.slot then
        local slot = gridInventory.getAutoEquipSlot(item)
        if slot then
            table.insert(options, {
                label = "Equip",
                action = function()
                    client:emit("grid_equip", {itemId = item.id, slot = slot, rev = state.rev})
                end,
            })
        end
    end

    -- Use/consume option for consumables
    local t = item.type or ""
    if CONSUMABLE_TYPES[t] or item.isConsumable or item.consumableType then
        table.insert(options, {
            label = "Use",
            action = function()
                client:emit("consume_food_item", {itemId = item.id})
            end,
        })
    end

    -- Place option for placeables
    if PLACEABLE_TYPES[t] then
        table.insert(options, {
            label = "Place",
            action = function()
                -- Enter placement mode in the game scene
                if game then
                    game.enterPlacementMode(item.type, item.id)
                end
            end,
        })
    end

    -- Move to pocket
    table.insert(options, {
        label = "To Pocket",
        action = function()
            client:emit("grid_pocket_move", {itemId = item.id, x = 0, y = 0, rev = state.rev})
        end,
    })

    -- Split stack
    if item.stackSize and item.stackSize > 1 then
        table.insert(options, {
            label = "Split",
            action = function()
                state.splitting = {
                    itemId = item.id,
                    item = item,
                    maxCount = item.stackSize - 1,
                    count = math.floor(item.stackSize / 2),
                }
            end,
        })
    end

    -- Drop
    table.insert(options, {
        label = "Drop",
        action = function()
            client:emit("grid_drop", {itemId = item.id, rev = state.rev})
        end,
    })

    state.contextMenu = {itemId = item.id, item = item, x = x, y = y, options = options}
end

function gridInventory.openEquipContextMenu(slot, item, x, y)
    local options = {}

    table.insert(options, {
        label = "Unequip",
        action = function()
            client:emit("grid_unequip", {slot = slot, rev = state.rev})
        end,
    })

    state.contextMenu = {itemId = item and item.id, item = item, x = x, y = y, options = options}
end

function gridInventory.getAutoEquipSlot(item)
    if not item then return nil end
    local s = item.slot
    if s == "weapon" then return "main_hand" end
    if s == "shield" then return "off_hand" end
    if s == "ring1" then return "ring1" end
    if s == "backpack" then return "backpack" end
    if s == "rig" then return "rig" end
    if s == "head" or s == "chest" or s == "undershirt" or s == "arms"
       or s == "hands" or s == "legs" or s == "feet" or s == "necklace" then
        return s
    end
    -- Tool types
    local t = item.type or ""
    if t:find("pickaxe") then return "pickaxe" end
    if t:find("axe") then return "axe" end
    return nil
end

-- =========================================================================
-- Split dialog handling
-- =========================================================================

function gridInventory.handleSplitClick(x, y, button)
    local sp = state.splitting
    if not sp then return false end

    local W, H = love.graphics.getDimensions()
    local dw, dh = 240, 120
    local dx = (W - dw) / 2
    local dy = (H - dh) / 2

    -- Slider
    local barX = dx + 20
    local barY = dy + 65
    local barW = dw - 40
    if y >= barY and y < barY + 10 and x >= barX and x < barX + barW then
        local pct = (x - barX) / barW
        sp.count = math.max(1, math.min(sp.maxCount, math.floor(pct * sp.maxCount + 0.5)))
        return true
    end

    -- OK button
    if x >= dx + 30 and x < dx + 110 and y >= dy + 88 and y < dy + 110 then
        client:emit("grid_split_stack", {
            itemId = sp.itemId,
            count = sp.count,
            x = 0, y = 0,
            rev = state.rev,
        })
        state.splitting = nil
        return true
    end

    -- Cancel button
    if x >= dx + 130 and x < dx + 210 and y >= dy + 88 and y < dy + 110 then
        state.splitting = nil
        return true
    end

    return true
end

-- =========================================================================
-- Update (called each frame)
-- =========================================================================

function gridInventory.update(dt)
    -- Reset hovered item each frame (redetermined during draw)
    state.hoveredItem = nil
end

-- =========================================================================
-- Getters for external use
-- =========================================================================

function gridInventory.hasGrid()
    return state.grid ~= nil
end

function gridInventory.getState()
    return state
end

return gridInventory
