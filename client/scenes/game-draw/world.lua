-- scenes/game-draw/world.lua
-- Overworld zone rendering: monsters, terrain, resources, objects, players, HUD, chat.

local world_draw = {}

-- 'game' alias: all game._xxx references work unchanged
local game

-- Direct table refs (mutated in-place, safe to capture at init time)
local dungeon, camera, fonts, ui, rpg, players, resources
local floatingTexts, world, chat, overworld, tcState
local corruption, doom, sprint  -- not reassigned; no getter needed

-- getEntityState() returns current snapshot of all reassignable zone-entity locals:
--   zoneMonsters, zoneCorpses, zoneWorldContainers, connections,
--   corpseLootPanel, containerLootPanel, hoverObject, hoverResource,
--   identity, levelUpEffect, miniRifts, onboarding, packReveal,
--   placedObjects, riftDestroyVfx
local getEntityState
local getZone, getMyId, getFadeIn, getSkills, getAccount, getClient
local computeSprintBonuses

local TILE_SIZE = 32

local _portraitCache = {}

local function drawZoneMonsters()
    local myId = getMyId()
    local zoneMonsters = getEntityState().zoneMonsters
    if #zoneMonsters == 0 then return end
    local me = players[myId]
    local cullLeft = camera.x - 64
    local cullRight = camera.x + love.graphics.getWidth() + 64
    local cullTop = camera.y - 64
    local cullBottom = camera.y + love.graphics.getHeight() + 64

    local t = love.timer.getTime()
    for _, m in ipairs(zoneMonsters) do
        local mx = m.x or 0
        local my = m.y or 0
        -- Camera culling
        if mx >= cullLeft and mx <= cullRight and my >= cullTop and my <= cullBottom then
            local isChasing = (m.patrolMode == "chase")
            -- Subtle bob animation when moving
            local bob = 0
            if m.moving then
                bob = math.sin(t * 8) * 2
            end

            -- Body: colored circle (red/orange for idle, brighter red for chasing)
            local hpRatio = (m.maxHp and m.maxHp > 0) and (m.hp / m.maxHp) or 1
            local r, g
            if isChasing then
                -- Aggressive red pulsing
                local pulse = 0.5 + 0.5 * math.sin(t * 6)
                r = 0.9 + 0.1 * pulse
                g = 0.1 + 0.1 * pulse
            else
                r = 0.8 + 0.2 * (1 - hpRatio)
                g = 0.25 + 0.2 * hpRatio
            end
            love.graphics.setColor(r, g, 0.1, 0.9)
            love.graphics.circle("fill", mx, my + bob, 12)
            -- Outline (red highlight when chasing)
            if isChasing then
                love.graphics.setColor(0.9, 0.15, 0.1, 0.9)
            else
                love.graphics.setColor(0.4, 0.1, 0.1, 0.7)
            end
            love.graphics.setLineWidth(1.5)
            love.graphics.circle("line", mx, my + bob, 12)

            -- HP bar above
            local barW = 28
            local barH = 4
            local barX = mx - barW / 2
            local barY = my - 20
            love.graphics.setColor(0, 0, 0, 0.6)
            love.graphics.rectangle("fill", barX - 1, barY - 1, barW + 2, barH + 2, 2, 2)
            local gr = 1 - hpRatio
            local gg = hpRatio
            love.graphics.setColor(gr, gg, 0.1, 0.9)
            love.graphics.rectangle("fill", barX, barY, barW * hpRatio, barH, 1, 1)

            -- Monster name below
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(1, 0.7, 0.5, 0.8)
            local label = (m.name or "Monster")
            if m.level then label = "Lv" .. m.level .. " " .. label end
            love.graphics.printf(label, mx - 50, my + 16, 100, "center")

            -- "Space to attack" prompt if player is within 64px
            if me then
                local ddx = me.x - mx
                local ddy = me.y - my
                if ddx * ddx + ddy * ddy < 64 * 64 then
                    love.graphics.setFont(fonts.small)
                    love.graphics.setColor(1, 1, 0.5, 0.7 + 0.3 * math.sin(love.timer.getTime() * 4))
                    love.graphics.printf("Space to attack " .. (m.name or ""), mx - 60, my + 28, 120, "center")
                end
            end
        end
    end
end

-- ================================================================
-- Draw: Corpses & World Containers (world space)
-- ================================================================
local function drawCorpsesAndContainers()
    local myId = getMyId()
    local es = getEntityState()
    local zoneCorpses         = es.zoneCorpses
    local zoneWorldContainers = es.zoneWorldContainers
    local corpseLootPanel     = es.corpseLootPanel
    local containerLootPanel  = es.containerLootPanel
    local me = players[myId]
    local t = love.timer.getTime()

    -- Draw corpses as bone-white skull shapes
    for _, c in ipairs(zoneCorpses) do
        local cx, cy = c.x or 0, c.y or 0
        -- Bone white body
        love.graphics.setColor(0.85, 0.82, 0.7, 0.8)
        love.graphics.circle("fill", cx, cy, 8)
        -- X eyes
        love.graphics.setColor(0.4, 0.1, 0.1, 0.9)
        love.graphics.setLineWidth(1.5)
        love.graphics.line(cx - 4, cy - 3, cx - 1, cy)
        love.graphics.line(cx - 1, cy - 3, cx - 4, cy)
        love.graphics.line(cx + 1, cy - 3, cx + 4, cy)
        love.graphics.line(cx + 4, cy - 3, cx + 1, cy)
        -- Glow if has loot
        if c.hasItems or c.hasGold then
            local glow = 0.3 + 0.15 * math.sin(t * 3)
            love.graphics.setColor(1, 0.85, 0.3, glow)
            love.graphics.circle("line", cx, cy, 12)
        end
        -- Label
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.9, 0.85, 0.7, 0.7)
        love.graphics.printf(c.name or "Remains", cx - 50, cy + 12, 100, "center")
        -- Interact prompt
        if me then
            local dx = me.x - cx
            local dy = me.y - cy
            if dx * dx + dy * dy < 128 * 128 then
                love.graphics.setColor(1, 0.9, 0.5, 0.6 + 0.3 * math.sin(t * 4))
                love.graphics.printf("E to loot", cx - 40, cy + 24, 80, "center")
            end
        end
    end

    -- Draw world containers as small brown boxes
    for _, wc in ipairs(zoneWorldContainers) do
        local wx, wy = wc.x or 0, wc.y or 0
        -- Box body
        love.graphics.setColor(0.55, 0.35, 0.15, 0.9)
        love.graphics.rectangle("fill", wx - 8, wy - 6, 16, 12, 2, 2)
        -- Lid
        love.graphics.setColor(0.65, 0.42, 0.18, 0.9)
        love.graphics.rectangle("fill", wx - 9, wy - 8, 18, 4, 1, 1)
        -- Latch
        love.graphics.setColor(0.8, 0.7, 0.3, 0.8)
        love.graphics.rectangle("fill", wx - 2, wy - 4, 4, 3)
        -- Glow if has items
        if wc.hasItems then
            local glow = 0.25 + 0.15 * math.sin(t * 2.5)
            love.graphics.setColor(1, 0.9, 0.4, glow)
            love.graphics.circle("line", wx, wy, 14)
        end
        -- Label
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.8, 0.7, 0.5, 0.7)
        love.graphics.printf(wc.name or "Container", wx - 50, wy + 10, 100, "center")
        -- Interact prompt
        if me then
            local dx = me.x - wx
            local dy = me.y - wy
            if dx * dx + dy * dy < 128 * 128 then
                love.graphics.setColor(1, 0.9, 0.5, 0.6 + 0.3 * math.sin(t * 4))
                love.graphics.printf("E to loot", wx - 40, wy + 22, 80, "center")
            end
        end
    end
end

-- ================================================================
-- Draw: Loot Panel (screen-space overlay for corpse/container looting)
-- ================================================================
local function drawLootPanel(W, H)
    local es = getEntityState()
    local corpseLootPanel    = es.corpseLootPanel
    local containerLootPanel = es.containerLootPanel
    local panel = corpseLootPanel or containerLootPanel
    if not panel then return end

    local panelW = 280
    local panelH = 300
    local px = W / 2 - panelW / 2
    local py = H / 2 - panelH / 2

    -- Background
    love.graphics.setColor(0.08, 0.08, 0.12, 0.92)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 6, 6)
    love.graphics.setColor(0.5, 0.4, 0.25, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 6, 6)

    -- Title
    love.graphics.setFont(fonts.medium or _G.getFont(14))
    love.graphics.setColor(0.95, 0.9, 0.7)
    love.graphics.printf(panel.name or "Loot", px, py + 8, panelW, "center")

    local yOff = py + 32
    love.graphics.setFont(fonts.small or _G.getFont(11))

    -- Gold
    if panel.gold and panel.gold > 0 then
        love.graphics.setColor(1, 0.85, 0.2)
        love.graphics.print("Gold: " .. panel.gold, px + 10, yOff)
        yOff = yOff + 18
    end

    -- Resources
    if panel.resources then
        for resType, amount in pairs(panel.resources) do
            if amount > 0 then
                love.graphics.setColor(0.7, 0.9, 0.7)
                local resName = resType:gsub("_", " ")
                love.graphics.print(resName .. " x" .. amount, px + 10, yOff)
                yOff = yOff + 16
            end
        end
    end

    -- Items
    if panel.items and #panel.items > 0 then
        yOff = yOff + 4
        love.graphics.setColor(0.8, 0.8, 0.9, 0.6)
        love.graphics.line(px + 10, yOff, px + panelW - 10, yOff)
        yOff = yOff + 6

        for idx, item in ipairs(panel.items) do
            local rarity = item.rarity or "common"
            local rc = {0.7, 0.7, 0.7}
            if rarity == "uncommon" then rc = {0.3, 0.8, 0.3}
            elseif rarity == "rare" then rc = {0.3, 0.5, 1}
            elseif rarity == "ultra_rare" then rc = {0.7, 0.3, 0.9}
            elseif rarity == "legendary" then rc = {1, 0.7, 0.2}
            elseif rarity == "relic" then rc = {1, 0.3, 0.3} end

            love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
            love.graphics.print((item.name or "Item") .. " [" .. idx .. "]", px + 10, yOff)
            yOff = yOff + 16
            if yOff > py + panelH - 50 then break end
        end
    end

    -- Buttons
    local btnY = py + panelH - 36
    -- Take All
    love.graphics.setColor(0.2, 0.5, 0.2, 0.85)
    love.graphics.rectangle("fill", px + 10, btnY, 100, 26, 4, 4)
    love.graphics.setColor(0.9, 0.95, 0.9)
    love.graphics.printf("Take All", px + 10, btnY + 5, 100, "center")
    -- Close
    love.graphics.setColor(0.5, 0.2, 0.2, 0.85)
    love.graphics.rectangle("fill", px + panelW - 110, btnY, 100, 26, 4, 4)
    love.graphics.setColor(0.95, 0.85, 0.85)
    love.graphics.printf("Close", px + panelW - 110, btnY + 5, 100, "center")

    -- Store layout for click detection
    game._lootPanelRect = { x = px, y = py, w = panelW, h = panelH, btnY = btnY }
end

-- ================================================================
-- Draw: Level-Up Celebration (screen-space overlay)
-- ================================================================
local function drawLevelUpEffect(W, H)
    local levelUpEffect = getEntityState().levelUpEffect
    if not levelUpEffect or levelUpEffect.timer <= 0 then return end
    local a = levelUpEffect.alpha or 1

    -- Expanding golden ring
    local ringR = levelUpEffect.ringRadius or 0
    if ringR > 0 then
        local ringAlpha = math.max(0, a * (1 - ringR / 400))
        love.graphics.setColor(1, 0.85, 0.2, ringAlpha * 0.5)
        love.graphics.setLineWidth(3)
        love.graphics.circle("line", W / 2, H / 2, ringR)
        love.graphics.setLineWidth(1)
    end

    -- Pulsing golden glow behind text
    local pulse = 0.7 + 0.3 * math.sin(love.timer.getTime() * 6)
    love.graphics.setColor(1, 0.85, 0.2, a * pulse * 0.3)
    love.graphics.rectangle("fill", W / 2 - 160, H / 2 - 55, 320, 70, 10, 10)

    -- "LEVEL UP!" text
    love.graphics.setFont(fonts.levelUp)
    -- Shadow
    love.graphics.setColor(0, 0, 0, a * 0.7)
    love.graphics.printf("LEVEL UP!", 2, H / 2 - 48, W, "center")
    -- Golden text
    love.graphics.setColor(1, 0.85, 0.2, a)
    love.graphics.printf("LEVEL UP!", 0, H / 2 - 50, W, "center")

    -- "Level N" below
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(1, 1, 0.7, a * 0.9)
    love.graphics.printf("Level " .. (levelUpEffect.level or "?"), 0, H / 2 + 0, W, "center")
end

-- ================================================================
-- Draw: Card Pack Opening Animation (screen-space overlay)
-- ================================================================
local function drawPackReveal(W, H)
    local packReveal = getEntityState().packReveal
    if not packReveal then return end

    -- Rarity color lookup
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

    -- Dark overlay
    love.graphics.setColor(0, 0, 0, 0.8)
    love.graphics.rectangle("fill", 0, 0, W, H)

    local card = packReveal.cards[packReveal.currentIndex]
    if not card then
        -- All done or no card
        packReveal.done = true
        return
    end

    local cardW = 180
    local cardH = 250
    local cx = W / 2
    local cy = H / 2 - 20

    if packReveal.done then
        -- "Pack Complete!" message
        love.graphics.setFont(fonts.title)
        love.graphics.setColor(1, 0.85, 0.2, 1)
        love.graphics.printf("Pack Complete!", 0, H / 2 - 30, W, "center")
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(0.7, 0.7, 0.8, 0.8)
        love.graphics.printf("Click to close", 0, H / 2 + 10, W, "center")
        return
    end

    -- Card counter
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.7, 0.7, 0.8, 0.9)
    love.graphics.printf("Card " .. packReveal.currentIndex .. " / " .. #packReveal.cards, 0, cy - cardH / 2 - 40, W, "center")

    if packReveal.phase == "flip" then
        -- Flip animation: scale X from 1 to 0 to 1
        local prog = packReveal.flipProgress or 0
        local scaleX
        if prog < 0.5 then
            -- Shrinking (face-down side)
            scaleX = 1 - prog * 2
        else
            -- Growing (face-up side)
            scaleX = (prog - 0.5) * 2
        end
        scaleX = math.max(0.01, scaleX)

        local drawW = cardW * scaleX
        local drawX = cx - drawW / 2

        if prog < 0.5 then
            -- Face-down: dark rectangle
            love.graphics.setColor(0.15, 0.12, 0.2, 1)
            love.graphics.rectangle("fill", drawX, cy - cardH / 2, drawW, cardH, 6, 6)
            love.graphics.setColor(0.4, 0.3, 0.5, 0.8)
            love.graphics.setLineWidth(2)
            love.graphics.rectangle("line", drawX, cy - cardH / 2, drawW, cardH, 6, 6)
            -- "?" in center
            if drawW > 20 then
                love.graphics.setFont(fonts.title)
                love.graphics.setColor(0.6, 0.5, 0.7, 0.7)
                love.graphics.printf("?", drawX, cy - 12, drawW, "center")
            end
        else
            -- Face-up: show card with rarity border
            local rc = RARITY_COLORS[card.rarity] or {0.5, 0.5, 0.5}
            -- Card bg
            love.graphics.setColor(0.1, 0.1, 0.15, 1)
            love.graphics.rectangle("fill", drawX, cy - cardH / 2, drawW, cardH, 6, 6)
            -- Rarity glow border
            love.graphics.setColor(rc[1], rc[2], rc[3], 0.9)
            love.graphics.setLineWidth(3)
            love.graphics.rectangle("line", drawX, cy - cardH / 2, drawW, cardH, 6, 6)

            if drawW > 40 then
                -- Card name
                love.graphics.setFont(fonts.ui)
                love.graphics.setColor(1, 1, 1, 1)
                love.graphics.printf(card.name or "?", drawX + 8, cy - cardH / 2 + 20, drawW - 16, "center")
                -- Rarity
                love.graphics.setFont(fonts.chat)
                love.graphics.setColor(rc[1], rc[2], rc[3], 1)
                local rarityLabel = (card.rarity or "?"):gsub("_", " ")
                rarityLabel = rarityLabel:gsub("(%a)([%w_']*)", function(a2, b) return a2:upper()..b end)
                love.graphics.printf(rarityLabel, drawX + 8, cy - cardH / 2 + 50, drawW - 16, "center")
                -- Type
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
                local typeLabel = (card.type or "?"):gsub("_", " ")
                love.graphics.printf(typeLabel, drawX + 8, cy - cardH / 2 + 75, drawW - 16, "center")
                -- Style
                if card.style and card.style ~= "normal" then
                    love.graphics.setColor(1, 0.85, 0.2, 0.9)
                    love.graphics.printf(card.style, drawX + 8, cy - cardH / 2 + 95, drawW - 16, "center")
                end
            end
        end
    elseif packReveal.phase == "show" then
        -- Fully revealed card
        local rc = RARITY_COLORS[card.rarity] or {0.5, 0.5, 0.5}
        local drawX = cx - cardW / 2
        -- Card bg
        love.graphics.setColor(0.1, 0.1, 0.15, 1)
        love.graphics.rectangle("fill", drawX, cy - cardH / 2, cardW, cardH, 6, 6)
        -- Rarity glow border
        local glowPulse = 0.7 + 0.3 * math.sin(love.timer.getTime() * 4)
        love.graphics.setColor(rc[1], rc[2], rc[3], glowPulse)
        love.graphics.setLineWidth(3)
        love.graphics.rectangle("line", drawX, cy - cardH / 2, cardW, cardH, 6, 6)
        -- Outer glow
        love.graphics.setColor(rc[1], rc[2], rc[3], glowPulse * 0.2)
        love.graphics.setLineWidth(6)
        love.graphics.rectangle("line", drawX - 2, cy - cardH / 2 - 2, cardW + 4, cardH + 4, 8, 8)
        love.graphics.setLineWidth(1)

        -- Card name
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.printf(card.name or "?", drawX + 8, cy - cardH / 2 + 20, cardW - 16, "center")
        -- Rarity
        love.graphics.setFont(fonts.chat)
        love.graphics.setColor(rc[1], rc[2], rc[3], 1)
        local rarityLabel = (card.rarity or "?"):gsub("_", " ")
        rarityLabel = rarityLabel:gsub("(%a)([%w_']*)", function(a2, b) return a2:upper()..b end)
        love.graphics.printf(rarityLabel, drawX + 8, cy - cardH / 2 + 50, cardW - 16, "center")
        -- Type
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
        local typeLabel = (card.type or "?"):gsub("_", " ")
        love.graphics.printf(typeLabel, drawX + 8, cy - cardH / 2 + 75, cardW - 16, "center")
        -- Style
        if card.style and card.style ~= "normal" then
            love.graphics.setColor(1, 0.85, 0.2, 0.9)
            love.graphics.printf(card.style, drawX + 8, cy - cardH / 2 + 95, cardW - 16, "center")
        end

        -- Click hint
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.6, 0.6, 0.7, 0.6)
        love.graphics.printf("Click to continue", 0, cy + cardH / 2 + 15, W, "center")
    end
end

-- ================================================================
-- Draw: Onboarding Tip Banner (screen-space overlay)
-- ================================================================
local function drawOnboardingTip(W, H)
    local onboarding = getEntityState().onboarding
    if not onboarding.currentTip then return end
    local tip = onboarding.currentTip
    local text = tip.text or ""
    local a = 1
    -- Fade out during last 2 seconds
    if tip.timer < 2.0 then
        a = math.max(0, tip.timer / 2.0)
    end

    -- Semi-transparent dark banner at top center
    love.graphics.setFont(fonts.ui)
    local textW = fonts.ui:getWidth(text) + 40
    local bannerW = math.min(W - 40, math.max(300, textW))
    local bannerH = 36
    local bx = (W - bannerW) / 2
    local by = 50

    love.graphics.setColor(0, 0, 0, 0.7 * a)
    love.graphics.rectangle("fill", bx, by, bannerW, bannerH, 6, 6)
    love.graphics.setColor(0.5, 0.7, 1, 0.5 * a)
    love.graphics.setLineWidth(1)
    love.graphics.rectangle("line", bx, by, bannerW, bannerH, 6, 6)

    love.graphics.setColor(1, 1, 1, 0.95 * a)
    love.graphics.printf(text, bx, by + 8, bannerW, "center")
end

-- ================================================================
-- Draw: Overworld Monster Hit Vignette (screen-space, non-dungeon)
-- ================================================================
local function drawMonsterHitFlash(W, H)
    if dungeon.inDungeon then return end  -- dungeon handles its own flash
    if not dungeon.hitFlashTimer or dungeon.hitFlashTimer <= 0 then return end
    local a = math.min(1, dungeon.hitFlashTimer / 0.15) * 0.35
    love.graphics.setColor(1, 0, 0, a)
    love.graphics.rectangle("fill", 0, 0, W, H)
end

local function drawTerrain()
    local zone = getZone()
    if not zone or not zone.terrain then return end
    local t = love.timer.getTime()
    local terrain = zone.terrain

    -- Water borders
    if terrain.water then
        for _, side in ipairs(terrain.water) do
            -- Base water color
            love.graphics.setColor(0.15, 0.3, 0.55, 0.85)
            if side == "west" then
                love.graphics.rectangle("fill", 0, 0, TERRAIN_BORDER, zone.height)
                -- Wave edge
                love.graphics.setColor(0.25, 0.45, 0.7, 0.6)
                for wy = 0, zone.height, 8 do
                    local wx = TERRAIN_BORDER + math.sin(t * 2 + wy * 0.05) * 4
                    love.graphics.rectangle("fill", wx - 2, wy, 4, 8)
                end
                -- Foam line
                love.graphics.setColor(0.6, 0.75, 0.9, 0.4)
                for wy = 0, zone.height, 12 do
                    local wx = TERRAIN_BORDER + math.sin(t * 1.5 + wy * 0.07) * 3
                    love.graphics.rectangle("fill", wx - 1, wy, 2, 6)
                end
            elseif side == "east" then
                love.graphics.setColor(0.15, 0.3, 0.55, 0.85)
                love.graphics.rectangle("fill", zone.width - TERRAIN_BORDER, 0, TERRAIN_BORDER, zone.height)
                love.graphics.setColor(0.25, 0.45, 0.7, 0.6)
                for wy = 0, zone.height, 8 do
                    local wx = zone.width - TERRAIN_BORDER + math.sin(t * 2 + wy * 0.05) * 4
                    love.graphics.rectangle("fill", wx - 2, wy, 4, 8)
                end
                love.graphics.setColor(0.6, 0.75, 0.9, 0.4)
                for wy = 0, zone.height, 12 do
                    local wx = zone.width - TERRAIN_BORDER + math.sin(t * 1.5 + wy * 0.07) * 3
                    love.graphics.rectangle("fill", wx - 1, wy, 2, 6)
                end
            elseif side == "south" then
                love.graphics.setColor(0.15, 0.3, 0.55, 0.85)
                love.graphics.rectangle("fill", 0, zone.height - TERRAIN_BORDER, zone.width, TERRAIN_BORDER)
                love.graphics.setColor(0.25, 0.45, 0.7, 0.6)
                for wx = 0, zone.width, 8 do
                    local wy = zone.height - TERRAIN_BORDER + math.sin(t * 2 + wx * 0.05) * 4
                    love.graphics.rectangle("fill", wx, wy - 2, 8, 4)
                end
                love.graphics.setColor(0.6, 0.75, 0.9, 0.4)
                for wx = 0, zone.width, 12 do
                    local wy = zone.height - TERRAIN_BORDER + math.sin(t * 1.5 + wx * 0.07) * 3
                    love.graphics.rectangle("fill", wx, wy - 1, 6, 2)
                end
            end
        end
    end

    -- Mountain border
    if terrain.mountain then
        for _, side in ipairs(terrain.mountain) do
            if side == "north" then
                -- Mountain base
                love.graphics.setColor(0.35, 0.3, 0.25, 0.9)
                love.graphics.rectangle("fill", 0, 0, zone.width, TERRAIN_BORDER)
                -- Peaks
                love.graphics.setColor(0.45, 0.4, 0.35, 0.95)
                for px = 0, zone.width, 40 do
                    local peakH = 20 + math.sin(px * 0.1) * 10
                    love.graphics.polygon("fill",
                        px, TERRAIN_BORDER,
                        px + 20, TERRAIN_BORDER - peakH,
                        px + 40, TERRAIN_BORDER
                    )
                end
                -- Snow caps
                love.graphics.setColor(0.85, 0.85, 0.9, 0.7)
                for px = 0, zone.width, 40 do
                    local peakH = 20 + math.sin(px * 0.1) * 10
                    love.graphics.polygon("fill",
                        px + 12, TERRAIN_BORDER - peakH + 6,
                        px + 20, TERRAIN_BORDER - peakH,
                        px + 28, TERRAIN_BORDER - peakH + 6
                    )
                end
            end
        end
    end
end

-- Helper: render a chunk's static features to a Canvas (called once per chunk)
local function _renderChunkToCanvas(chunk, chunkSize)
    local canvas = love.graphics.newCanvas(chunkSize, chunkSize)
    love.graphics.setCanvas(canvas)
    love.graphics.clear(0, 0, 0, 0)
    love.graphics.origin()

    -- Biome background
    local bc = chunk.biomeColor
    if bc then
        love.graphics.setColor(bc.r / 255, bc.g / 255, bc.b / 255, 0.85)
    else
        love.graphics.setColor(0.1, 0.15, 0.08, 0.85)
    end
    love.graphics.rectangle("fill", 0, 0, chunkSize, chunkSize)

    -- Subtle grid lines
    love.graphics.setColor(1, 1, 1, 0.03)
    for gx = 0, chunkSize - 1, 32 do
        love.graphics.line(gx, 0, gx, chunkSize)
    end
    for gy = 0, chunkSize - 1, 32 do
        love.graphics.line(0, gy, chunkSize, gy)
    end

    -- Draw static features (non-animated: trees, caves, rocks, etc.)
    if chunk.features then
        for ty = 0, 15 do
            for tx = 0, 15 do
                local idx = ty * 16 + tx + 1
                local feat = chunk.features[idx]
                if feat and feat ~= 0 and feat ~= 1 and feat ~= 7 then -- skip animated features (1=river/lava, 7=ocean)
                    local ftx = tx * 32
                    local fty = ty * 32
                    if feat == 4 then
                        -- Dense forest / mushroom
                        if chunk._isHE then
                            love.graphics.setColor(0.25, 0.12, 0.30, 0.85)
                            love.graphics.circle("fill", ftx + 16, fty + 16, 18)
                            love.graphics.setColor(0.15, 0.25, 0.20, 0.7)
                            love.graphics.circle("fill", ftx + 10, fty + 12, 14)
                            love.graphics.circle("fill", ftx + 22, fty + 14, 13)
                            love.graphics.setColor(0.30, 0.15, 0.35, 0.5)
                            love.graphics.circle("fill", ftx + 16, fty + 8, 11)
                        else
                            love.graphics.setColor(0.08, 0.22, 0.08, 0.85)
                            love.graphics.circle("fill", ftx + 16, fty + 16, 18)
                            love.graphics.setColor(0.06, 0.18, 0.06, 0.7)
                            love.graphics.circle("fill", ftx + 10, fty + 12, 14)
                            love.graphics.circle("fill", ftx + 22, fty + 14, 13)
                            love.graphics.setColor(0.1, 0.25, 0.1, 0.5)
                            love.graphics.circle("fill", ftx + 16, fty + 8, 11)
                        end
                    elseif feat == 5 then
                        -- Cave entrance
                        love.graphics.setColor(0.35, 0.3, 0.25, 0.9)
                        love.graphics.rectangle("fill", ftx + 2, fty + 2, 28, 28, 6, 6)
                        love.graphics.setColor(0.05, 0.03, 0.02, 0.95)
                        love.graphics.rectangle("fill", ftx + 6, fty + 8, 20, 20, 4, 4)
                        love.graphics.setColor(0.45, 0.38, 0.3, 0.7)
                        love.graphics.arc("line", "open", ftx + 16, fty + 8, 10, math.pi, 2 * math.pi)
                    elseif feat == 2 then
                        -- Mountain/rock
                        love.graphics.setColor(0.4, 0.35, 0.3, 0.9)
                        love.graphics.polygon("fill", ftx + 16, fty + 2, ftx + 2, fty + 30, ftx + 30, fty + 30)
                        love.graphics.setColor(0.5, 0.45, 0.4, 0.5)
                        love.graphics.polygon("fill", ftx + 16, fty + 2, ftx + 20, fty + 12, ftx + 10, fty + 12)
                    elseif feat == 3 then
                        -- Sand/desert
                        love.graphics.setColor(0.7, 0.65, 0.45, 0.85)
                        love.graphics.rectangle("fill", ftx, fty, 32, 32)
                    elseif feat == 6 then
                        -- Swamp
                        love.graphics.setColor(0.2, 0.3, 0.15, 0.85)
                        love.graphics.rectangle("fill", ftx, fty, 32, 32)
                    end
                end
            end
        end
    end

    love.graphics.setCanvas()
    return canvas
end

local function drawGround()
    local zone = getZone()
    local es = getEntityState()
    local connections    = es.connections
    local placedObjects  = es.placedObjects
    local hoverObject    = es.hoverObject
    local hoverResource  = es.hoverResource
    if not zone then return end

    if overworld.chunkBased then
        -- Overworld: draw biome-colored chunks with canvas caching
        local W = love.graphics.getWidth()
        local H = love.graphics.getHeight()
        local camX = camera.x
        local camY = camera.y

        -- Determine visible chunk range
        local startCX = math.floor(camX / overworld.chunkSize) - 1
        local startCY = math.floor(camY / overworld.chunkSize) - 1
        local endCX = math.floor((camX + W) / overworld.chunkSize) + 1
        local endCY = math.floor((camY + H) / overworld.chunkSize) + 1

        for cy = startCY, endCY do
            for cx = startCX, endCX do
                local key = cx .. "," .. cy
                local chunk = overworld.chunks[key]
                local wx = cx * overworld.chunkSize
                local wy = cy * overworld.chunkSize
                if chunk then
                    -- Get or create cached canvas for this chunk
                    local cachedCanvas = overworld.chunkCanvases[key]
                    if not cachedCanvas then
                        chunk._isHE = overworld.isHollowEarth
                        cachedCanvas = _renderChunkToCanvas(chunk, overworld.chunkSize)
                        overworld.chunkCanvases[key] = cachedCanvas
                    end
                    -- Draw cached canvas
                    love.graphics.setColor(1, 1, 1, 1)
                    love.graphics.draw(cachedCanvas, wx, wy)

                    -- Draw animated features on top of cached canvas (rivers, lava, ocean)
                    if chunk.features then
                        for ty = 0, 15 do
                            for tx = 0, 15 do
                                local idx = ty * 16 + tx + 1
                                local feat = chunk.features[idx]
                                if feat == 1 then
                                    local ftx = wx + tx * TILE_SIZE
                                    local fty = wy + ty * TILE_SIZE
                                    if overworld.isHollowEarth then
                                        love.graphics.setColor(0.65, 0.20, 0.05, 0.9)
                                        love.graphics.rectangle("fill", ftx, fty, TILE_SIZE, TILE_SIZE)
                                        love.graphics.setColor(0.85, 0.40, 0.10, 0.3 + math.sin(overworld.riverAnimTimer * 2 + ftx * 0.1) * 0.15)
                                        love.graphics.rectangle("fill", ftx + 4, fty + 4, TILE_SIZE - 8, TILE_SIZE - 8)
                                    else
                                        love.graphics.setColor(0.16, 0.31, 0.63, 0.9)
                                        love.graphics.rectangle("fill", ftx, fty, TILE_SIZE, TILE_SIZE)
                                        love.graphics.setColor(0.25, 0.45, 0.75, 0.3)
                                        local flowOff = (overworld.riverAnimTimer * 40) % TILE_SIZE
                                        love.graphics.line(ftx + 8, fty + flowOff - TILE_SIZE, ftx + 8, fty + flowOff)
                                        love.graphics.line(ftx + 24, fty + flowOff - TILE_SIZE + 16, ftx + 24, fty + flowOff + 16)
                                    end
                                elseif feat == 7 then
                                    local ftx = wx + tx * TILE_SIZE
                                    local fty = wy + ty * TILE_SIZE
                                    love.graphics.setColor(0.55, 0.39, 0.22, 0.95)
                                    love.graphics.rectangle("fill", ftx, fty, TILE_SIZE, TILE_SIZE)
                                    love.graphics.setColor(0.45, 0.30, 0.15, 0.4)
                                    for px = 0, TILE_SIZE - 1, 6 do
                                        love.graphics.line(ftx + px, fty, ftx + px, fty + TILE_SIZE)
                                    end
                                    love.graphics.setColor(0.65, 0.50, 0.30, 0.3)
                                    love.graphics.line(ftx, fty, ftx + TILE_SIZE, fty)
                                    love.graphics.line(ftx, fty + TILE_SIZE - 1, ftx + TILE_SIZE, fty + TILE_SIZE - 1)
                                end
                            end
                        end
                    end

                    -- Chunk border (very subtle)
                    love.graphics.setColor(0, 0, 0, 0.08)
                    love.graphics.rectangle("line", wx, wy, overworld.chunkSize, overworld.chunkSize)

                    -- Lich Corruption overlay: purple tint on corrupted chunks
                    local cLevel = corruption.chunks[key]
                    if cLevel and cLevel > 0 then
                        local cAlpha = (cLevel / 100) * 0.35
                        local cPulse = math.sin(corruption.animTimer * 1.5 + cx * 0.3 + cy * 0.7) * 0.05
                        love.graphics.setColor(0.3, 0.05, 0.4, cAlpha + cPulse)
                        love.graphics.rectangle("fill", wx, wy, overworld.chunkSize, overworld.chunkSize)
                        -- Veiny tendrils at high corruption
                        if cLevel >= 50 then
                            love.graphics.setColor(0.5, 0.1, 0.6, (cLevel / 100) * 0.2)
                            local cs = overworld.chunkSize
                            for ti = 0, 3 do
                                local tx1 = wx + math.sin(corruption.animTimer * 0.5 + ti * 2.1) * cs * 0.3 + cs * 0.5
                                local ty1 = wy + math.cos(corruption.animTimer * 0.7 + ti * 1.7) * cs * 0.3 + cs * 0.5
                                local tx2 = wx + math.sin(corruption.animTimer * 0.3 + ti * 3.2) * cs * 0.4 + cs * 0.5
                                local ty2 = wy + math.cos(corruption.animTimer * 0.4 + ti * 2.3) * cs * 0.4 + cs * 0.5
                                love.graphics.setLineWidth(2)
                                love.graphics.line(tx1, ty1, tx2, ty2)
                                love.graphics.setLineWidth(1)
                            end
                        end
                    end
                else
                    -- Unloaded chunk: use nearby chunk's biome color or zone bg
                    local nearColor = nil
                    -- Try to sample color from an adjacent loaded chunk
                    for _, offset in ipairs({{1,0},{-1,0},{0,1},{0,-1}}) do
                        local nk = (cx + offset[1]) .. "," .. (cy + offset[2])
                        local nc = overworld.chunks[nk]
                        if nc and nc.biomeColor then
                            nearColor = nc.biomeColor
                            break
                        end
                    end
                    if nearColor then
                        love.graphics.setColor(nearColor.r / 255, nearColor.g / 255, nearColor.b / 255, 0.85)
                    else
                        love.graphics.setColor(0.28, 0.35, 0.22, 0.85)
                    end
                    love.graphics.rectangle("fill", wx, wy, overworld.chunkSize, overworld.chunkSize)
                end
            end
        end
    else
        -- Non-overworld: simple grid
        love.graphics.setColor(1, 1, 1, 0.04)
        for gx = 0, zone.width, TILE_SIZE do
            love.graphics.line(gx, 0, gx, zone.height)
        end
        for gy = 0, zone.height, TILE_SIZE do
            love.graphics.line(0, gy, zone.width, gy)
        end

        -- Zone border
        love.graphics.setColor(0.4, 0.4, 0.5, 0.3)
        love.graphics.setLineWidth(2)
        love.graphics.rectangle("line", 0, 0, zone.width, zone.height)
        love.graphics.setLineWidth(1)

        -- Zone name at top
        love.graphics.setFont(fonts.title)
        love.graphics.setColor(1, 1, 1, 0.15)
        love.graphics.printf(zone.name, 0, TERRAIN_BORDER + 10, zone.width, "center")
    end
end

local function drawPlots()
    local account = getAccount()
    local zone = getZone()
    if not overworld.chunkBased then return end
    local t = love.timer.getTime()
    local accKey = account and account.key or nil

    for _, plot in pairs(overworld.plots) do
        local isOwn = (overworld.myPlotId and plot.id == overworld.myPlotId)
        local px, py = plot.x, plot.y
        local pw, ph = plot.width or 512, plot.height or 512

        -- Fill
        if isOwn then
            love.graphics.setColor(0.2, 0.6, 0.2, 0.08 + math.sin(t * 2) * 0.02)
        else
            love.graphics.setColor(0.2, 0.3, 0.6, 0.06)
        end
        love.graphics.rectangle("fill", px, py, pw, ph)

        -- Border
        love.graphics.setLineWidth(2)
        if isOwn then
            love.graphics.setColor(0.3, 0.9, 0.3, 0.5 + math.sin(t * 3) * 0.15)
        else
            love.graphics.setColor(0.3, 0.5, 0.9, 0.35)
        end
        love.graphics.rectangle("line", px, py, pw, ph)
        love.graphics.setLineWidth(1)

        -- Corner markers
        local cornerSize = 12
        if isOwn then
            love.graphics.setColor(0.3, 0.9, 0.3, 0.7)
        else
            love.graphics.setColor(0.3, 0.5, 0.9, 0.5)
        end
        -- Top-left
        love.graphics.line(px, py, px + cornerSize, py)
        love.graphics.line(px, py, px, py + cornerSize)
        -- Top-right
        love.graphics.line(px + pw, py, px + pw - cornerSize, py)
        love.graphics.line(px + pw, py, px + pw, py + cornerSize)
        -- Bottom-left
        love.graphics.line(px, py + ph, px + cornerSize, py + ph)
        love.graphics.line(px, py + ph, px, py + ph - cornerSize)
        -- Bottom-right
        love.graphics.line(px + pw, py + ph, px + pw - cornerSize, py + ph)
        love.graphics.line(px + pw, py + ph, px + pw, py + ph - cornerSize)

        -- Owner name label at top center
        love.graphics.setFont(fonts.npc)
        if isOwn then
            love.graphics.setColor(0.3, 0.9, 0.3, 0.8)
        else
            love.graphics.setColor(0.5, 0.7, 1, 0.6)
        end
        love.graphics.printf(plot.ownerName or "???", px, py + 4, pw, "center")
    end
end

local function drawResources()
    local hoverResource = getEntityState().hoverResource
    local t = love.timer.getTime()

    -- Build resource list: from zone resources + loaded chunk resources
    local allResources = {}
    if resources then
        for _, r in ipairs(resources) do
            table.insert(allResources, r)
        end
    end
    if overworld.chunkBased then
        -- Add resources from visible chunks
        local W = love.graphics.getWidth()
        local H = love.graphics.getHeight()
        local camX = camera.x
        local camY = camera.y
        local startCX = math.floor(camX / overworld.chunkSize) - 1
        local startCY = math.floor(camY / overworld.chunkSize) - 1
        local endCX = math.floor((camX + W) / overworld.chunkSize) + 1
        local endCY = math.floor((camY + H) / overworld.chunkSize) + 1
        for cy = startCY, endCY do
            for cx = startCX, endCX do
                local key = cx .. "," .. cy
                local chunk = overworld.chunks[key]
                if chunk and chunk.resources then
                    for _, r in ipairs(chunk.resources) do
                        table.insert(allResources, r)
                    end
                end
            end
        end
    end

    -- Spatial culling bounds
    local cullM = 64
    local cLeft = camera.x - cullM
    local cRight = camera.x + love.graphics.getWidth() + cullM
    local cTop = camera.y - cullM
    local cBottom = camera.y + love.graphics.getHeight() + cullM

    for _, r in ipairs(allResources) do
        -- Skip offscreen resources
        if r.x < cLeft or r.x > cRight or r.y < cTop or r.y > cBottom then
            goto continue_resource
        end
        local alpha = 1.0
        if r.depleted then alpha = 0.2 end

        if r.type == "tree" then
            -- Trunk
            love.graphics.setColor(0.45, 0.3, 0.15, alpha)
            love.graphics.rectangle("fill", r.x - 4, r.y - 5, 8, 20, 2, 2)
            -- Leaves (green circle)
            love.graphics.setColor(0.2, 0.6, 0.2, alpha)
            love.graphics.circle("fill", r.x, r.y - 15, 16)
            -- Leaf highlight
            love.graphics.setColor(0.3, 0.7, 0.3, alpha * 0.6)
            love.graphics.circle("fill", r.x - 4, r.y - 18, 8)
            -- Gentle sway
            local sway = math.sin(t * 1.5 + r.x * 0.1) * 2
            love.graphics.setColor(0.25, 0.65, 0.25, alpha * 0.5)
            love.graphics.circle("fill", r.x + sway, r.y - 20, 6)

        elseif r.type == "stone" then
            -- Main rock body
            love.graphics.setColor(0.5, 0.5, 0.48, alpha)
            love.graphics.circle("fill", r.x, r.y, 14)
            -- Darker cracks
            love.graphics.setColor(0.35, 0.35, 0.33, alpha * 0.7)
            love.graphics.line(r.x - 6, r.y - 3, r.x + 2, r.y + 5)
            love.graphics.line(r.x + 3, r.y - 7, r.x - 1, r.y + 2)
            -- Highlight
            love.graphics.setColor(0.6, 0.6, 0.58, alpha * 0.5)
            love.graphics.circle("fill", r.x - 3, r.y - 5, 5)

        elseif r.type == "iron" then
            -- Rock body (darker)
            love.graphics.setColor(0.4, 0.38, 0.35, alpha)
            love.graphics.circle("fill", r.x, r.y, 14)
            -- Orange-rust ore flecks
            love.graphics.setColor(0.7, 0.45, 0.2, alpha * 0.8)
            love.graphics.circle("fill", r.x - 5, r.y - 3, 3)
            love.graphics.circle("fill", r.x + 4, r.y + 2, 2.5)
            love.graphics.circle("fill", r.x + 1, r.y - 6, 2)
            -- Metallic glint
            love.graphics.setColor(0.8, 0.55, 0.3, alpha * (0.3 + math.sin(t * 3 + r.x) * 0.2))
            love.graphics.circle("fill", r.x - 2, r.y - 4, 2)
        end

        -- Label
        love.graphics.setFont(fonts.npc)
        if r.depleted then
            love.graphics.setColor(0.5, 0.5, 0.5, 0.4)
            love.graphics.printf("(respawning)", r.x - 40, r.y + 18, 80, "center")
        else
            love.graphics.setColor(0.9, 0.9, 0.8, 0.6)
            love.graphics.printf(r.name, r.x - 40, r.y + 18, 80, "center")
        end

        -- Hover highlight
        if hoverResource and hoverResource.id == r.id and not r.depleted then
            love.graphics.setColor(1, 1, 0.5, 0.2 + math.sin(t * 4) * 0.1)
            love.graphics.setLineWidth(2)
            love.graphics.circle("line", r.x, r.y, 22)
            love.graphics.setLineWidth(1)
        end
        ::continue_resource::
    end
end

local function drawPlacedObjects()
    local placedObjects = getEntityState().placedObjects
    if not placedObjects then return end
    for _, obj in ipairs(placedObjects) do
        if obj.type == "forge" then
            -- Forge: dark red/orange brick shape
            love.graphics.setColor(0.5, 0.2, 0.1, 0.9)
            love.graphics.rectangle("fill", obj.x - 16, obj.y - 12, 32, 24, 3, 3)
            love.graphics.setColor(0.8, 0.4, 0.1, 0.8)
            love.graphics.rectangle("fill", obj.x - 8, obj.y - 8, 16, 12, 2, 2)
            -- Fire glow
            local t = love.timer.getTime()
            love.graphics.setColor(1, 0.5, 0.1, 0.4 + math.sin(t * 5) * 0.2)
            love.graphics.circle("fill", obj.x, obj.y - 4, 6)
        elseif obj.type == "iron_anvil" then
            -- Anvil: dark gray T-shape
            love.graphics.setColor(0.35, 0.35, 0.4, 0.9)
            love.graphics.rectangle("fill", obj.x - 14, obj.y - 6, 28, 12, 2, 2)
            love.graphics.rectangle("fill", obj.x - 6, obj.y - 14, 12, 8, 2, 2)
        elseif obj.type == "storage_chest" then
            -- Chest: brown box
            love.graphics.setColor(0.45, 0.3, 0.15, 0.9)
            love.graphics.rectangle("fill", obj.x - 12, obj.y - 8, 24, 16, 3, 3)
            love.graphics.setColor(0.6, 0.4, 0.2, 0.7)
            love.graphics.rectangle("fill", obj.x - 10, obj.y - 6, 20, 4, 2, 2)
            -- Lock indicator
            if obj.lockId then
                love.graphics.setColor(0.8, 0.7, 0.2, 0.9)
                love.graphics.circle("fill", obj.x, obj.y + 2, 3)
            end
        elseif obj.type == "wall" then
            love.graphics.setColor(0.45, 0.35, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 16, obj.y - 16, 32, 32, 2, 2)
            love.graphics.setColor(0.35, 0.25, 0.15, 0.7)
            love.graphics.line(obj.x - 16, obj.y, obj.x + 16, obj.y)
            love.graphics.line(obj.x, obj.y - 16, obj.x, obj.y + 16)
        elseif obj.type == "door" then
            love.graphics.setColor(0.5, 0.35, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 10, obj.y - 16, 20, 32, 2, 2)
            love.graphics.setColor(0.7, 0.5, 0.2, 0.8)
            love.graphics.circle("fill", obj.x + 5, obj.y, 2)
        elseif obj.type == "raft" then
            love.graphics.setColor(0.5, 0.35, 0.2, 0.85)
            love.graphics.rectangle("fill", obj.x - 20, obj.y - 12, 40, 24, 4, 4)
            love.graphics.setColor(0.4, 0.25, 0.15, 0.6)
            for lx = -16, 16, 8 do
                love.graphics.line(obj.x + lx, obj.y - 12, obj.x + lx, obj.y + 12)
            end
        elseif obj.type == "bridge" then
            -- Wider wooden platform with plank lines and rail edges
            love.graphics.setColor(0.55, 0.39, 0.22, 0.9)
            love.graphics.rectangle("fill", obj.x - 28, obj.y - 16, 56, 32, 3, 3)
            -- Plank lines
            love.graphics.setColor(0.45, 0.30, 0.15, 0.5)
            for lx = -24, 24, 7 do
                love.graphics.line(obj.x + lx, obj.y - 16, obj.x + lx, obj.y + 16)
            end
            -- Rail edges
            love.graphics.setColor(0.65, 0.50, 0.30, 0.7)
            love.graphics.rectangle("fill", obj.x - 28, obj.y - 16, 56, 3, 1, 1)
            love.graphics.rectangle("fill", obj.x - 28, obj.y + 13, 56, 3, 1, 1)
        elseif obj.type == "stone_wall" then
            love.graphics.setColor(0.5, 0.5, 0.5, 0.9)
            love.graphics.rectangle("fill", obj.x - 16, obj.y - 16, 32, 32, 2, 2)
            love.graphics.setColor(0.4, 0.4, 0.4, 0.6)
            love.graphics.line(obj.x - 16, obj.y - 5, obj.x + 16, obj.y - 5)
            love.graphics.line(obj.x - 16, obj.y + 5, obj.x + 16, obj.y + 5)
        elseif obj.type == "fence" or obj.type == "stone_fence" or obj.type == "iron_fence" then
            local c = obj.type == "fence" and {0.5, 0.35, 0.2} or obj.type == "stone_fence" and {0.5, 0.5, 0.5} or {0.4, 0.4, 0.5}
            love.graphics.setColor(c[1], c[2], c[3], 0.9)
            love.graphics.rectangle("fill", obj.x - 16, obj.y - 2, 32, 4, 1, 1)
            love.graphics.rectangle("fill", obj.x - 12, obj.y - 10, 3, 12)
            love.graphics.rectangle("fill", obj.x + 9, obj.y - 10, 3, 12)
        elseif obj.type == "crop_plot" or obj.type == "garden_bed" then
            -- Brown soil
            love.graphics.setColor(0.35, 0.25, 0.1, 0.9)
            love.graphics.rectangle("fill", obj.x - 20, obj.y - 20, 40, 40, 2, 2)
            -- Furrows
            love.graphics.setColor(0.3, 0.2, 0.08, 0.7)
            for fy = -16, 16, 8 do
                love.graphics.line(obj.x - 18, obj.y + fy, obj.x + 18, obj.y + fy)
            end
            -- Crop growth stages
            if obj.crop and obj.crop.stage then
                local stage = obj.crop.stage
                if stage == 0 then -- seed
                    love.graphics.setColor(0.5, 0.4, 0.2, 0.6)
                    love.graphics.circle("fill", obj.x, obj.y, 3)
                elseif stage == 1 then -- sprout
                    love.graphics.setColor(0.3, 0.7, 0.2, 0.8)
                    love.graphics.rectangle("fill", obj.x - 1, obj.y - 6, 2, 6)
                    love.graphics.circle("fill", obj.x, obj.y - 7, 3)
                elseif stage == 2 then -- growing
                    love.graphics.setColor(0.2, 0.7, 0.2, 0.9)
                    love.graphics.rectangle("fill", obj.x - 2, obj.y - 10, 4, 10)
                    love.graphics.circle("fill", obj.x, obj.y - 11, 5)
                    love.graphics.circle("fill", obj.x - 4, obj.y - 8, 3)
                    love.graphics.circle("fill", obj.x + 4, obj.y - 8, 3)
                elseif stage == 3 then -- mature
                    love.graphics.setColor(0.8, 0.7, 0.1, 0.9)
                    love.graphics.rectangle("fill", obj.x - 2, obj.y - 14, 4, 14)
                    love.graphics.circle("fill", obj.x, obj.y - 15, 6)
                    love.graphics.setColor(0.2, 0.6, 0.2, 0.8)
                    love.graphics.circle("fill", obj.x - 5, obj.y - 10, 4)
                    love.graphics.circle("fill", obj.x + 5, obj.y - 10, 4)
                elseif stage == 4 then -- withered
                    love.graphics.setColor(0.4, 0.3, 0.15, 0.6)
                    love.graphics.rectangle("fill", obj.x - 1, obj.y - 8, 2, 8)
                    love.graphics.setColor(0.5, 0.4, 0.2, 0.4)
                    love.graphics.circle("fill", obj.x, obj.y - 9, 4)
                end
            end
        elseif obj.type == "animal_pen" then
            love.graphics.setColor(0.5, 0.35, 0.2, 0.8)
            love.graphics.rectangle("line", obj.x - 24, obj.y - 24, 48, 48, 3, 3)
            love.graphics.rectangle("line", obj.x - 22, obj.y - 22, 44, 44, 2, 2)
            -- Gate
            love.graphics.setColor(0.6, 0.4, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 6, obj.y + 22, 12, 4)
        elseif obj.type == "well" then
            love.graphics.setColor(0.5, 0.5, 0.55, 0.9)
            love.graphics.circle("fill", obj.x, obj.y, 14)
            love.graphics.setColor(0.2, 0.4, 0.8, 0.7)
            love.graphics.circle("fill", obj.x, obj.y, 8)
        elseif obj.type == "scarecrow" then
            love.graphics.setColor(0.5, 0.35, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 1, obj.y - 16, 2, 24)
            love.graphics.rectangle("fill", obj.x - 10, obj.y - 10, 20, 2)
            love.graphics.setColor(0.7, 0.6, 0.3, 0.8)
            love.graphics.circle("fill", obj.x, obj.y - 18, 5)
        elseif obj.type == "sprinkler" then
            love.graphics.setColor(0.4, 0.4, 0.5, 0.9)
            love.graphics.circle("fill", obj.x, obj.y, 6)
            local t = love.timer.getTime()
            love.graphics.setColor(0.3, 0.6, 0.9, 0.3 + math.sin(t * 3) * 0.2)
            love.graphics.circle("line", obj.x, obj.y, 10 + math.sin(t * 2) * 3)
        elseif obj.type == "lantern" then
            love.graphics.setColor(0.6, 0.5, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 4, obj.y - 8, 8, 12, 2, 2)
            local t = love.timer.getTime()
            love.graphics.setColor(1, 0.8, 0.3, 0.4 + math.sin(t * 4) * 0.2)
            love.graphics.circle("fill", obj.x, obj.y - 4, 4)
        elseif obj.type == "clock" then
            love.graphics.setColor(0.5, 0.35, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 8, obj.y - 10, 16, 20, 3, 3)
            love.graphics.setColor(0.9, 0.85, 0.7, 0.8)
            love.graphics.circle("fill", obj.x, obj.y - 3, 5)
        elseif obj.type == "trophy_mount" then
            love.graphics.setColor(0.5, 0.35, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 10, obj.y - 6, 20, 12, 2, 2)
            love.graphics.setColor(0.7, 0.6, 0.4, 0.8)
            love.graphics.polygon("fill", obj.x, obj.y - 10, obj.x - 6, obj.y - 2, obj.x + 6, obj.y - 2)
        elseif obj.type == "bed" then
            love.graphics.setColor(0.5, 0.35, 0.2, 0.9)
            love.graphics.rectangle("fill", obj.x - 10, obj.y - 14, 20, 28, 3, 3)
            love.graphics.setColor(0.7, 0.5, 0.5, 0.8)
            love.graphics.rectangle("fill", obj.x - 8, obj.y - 12, 16, 10, 2, 2)
        elseif obj.type == "bookshelf" then
            love.graphics.setColor(0.45, 0.3, 0.15, 0.9)
            love.graphics.rectangle("fill", obj.x - 12, obj.y - 10, 24, 20, 2, 2)
            love.graphics.setColor(0.6, 0.2, 0.1, 0.7)
            love.graphics.rectangle("fill", obj.x - 10, obj.y - 8, 5, 6)
            love.graphics.setColor(0.2, 0.4, 0.6, 0.7)
            love.graphics.rectangle("fill", obj.x - 4, obj.y - 8, 5, 6)
            love.graphics.setColor(0.5, 0.5, 0.2, 0.7)
            love.graphics.rectangle("fill", obj.x + 2, obj.y - 8, 5, 6)
        else
            -- Generic fallback for unrecognized types
            love.graphics.setColor(0.5, 0.5, 0.5, 0.7)
            love.graphics.rectangle("fill", obj.x - 12, obj.y - 12, 24, 24, 3, 3)
            love.graphics.setColor(0.7, 0.7, 0.7, 0.5)
            love.graphics.rectangle("line", obj.x - 12, obj.y - 12, 24, 24, 3, 3)
        end

        -- Label
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(0.8, 0.8, 0.7, 0.5)
        local label = obj.type:gsub("_", " ")
        love.graphics.printf(label, obj.x - 40, obj.y + 18, 80, "center")

        -- Hover highlight
        if hoverObject and hoverObject.id == obj.id then
            love.graphics.setColor(0.5, 1, 0.5, 0.2 + math.sin(love.timer.getTime() * 4) * 0.1)
            love.graphics.setLineWidth(2)
            love.graphics.circle("line", obj.x, obj.y, 24)
            love.graphics.setLineWidth(1)
        end
    end
end

local function drawFloatingTexts()
    local fadeIn = getFadeIn()
    love.graphics.setFont(fonts.ui)
    for _, ft in ipairs(floatingTexts) do
        local a = math.min(1, ft.timer / 0.5)  -- fade out in last 0.5s
        love.graphics.setColor(ft.color[1], ft.color[2], ft.color[3], a * fadeIn)
        love.graphics.printf(ft.text, ft.x - 80, ft.y, 160, "center")
    end
end

-- ---------------------------------------------------------------------------
-- Mini-Rift overworld rendering: animated void portals
-- ---------------------------------------------------------------------------
local function drawMiniRifts()
    local fadeIn = getFadeIn()
    local es = getEntityState()
    local miniRifts      = es.miniRifts
    local riftDestroyVfx = es.riftDestroyVfx
    if not overworld.chunkBased then return end
    local t = love.timer.getTime()
    local math_sin = math.sin
    local math_cos = math.cos
    local math_pi = math.pi

    -- Spatial culling bounds
    local cullM = 120
    local cLeft = camera.x - cullM
    local cRight = camera.x + love.graphics.getWidth() + cullM
    local cTop = camera.y - cullM
    local cBottom = camera.y + love.graphics.getHeight() + cullM

    -- Difficulty color lookup
    local DIFF_COLORS = {
        easy    = {0.2, 0.9, 0.3},
        medium  = {1.0, 0.9, 0.2},
        hard    = {1.0, 0.55, 0.1},
        extreme = {1.0, 0.15, 0.15},
    }

    for _, rift in pairs(miniRifts) do
        local wx = rift.worldX or 0
        local wy = rift.worldY or 0

        -- Skip offscreen rifts
        if wx < cLeft or wx > cRight or wy < cTop or wy > cBottom then
            goto continue_rift
        end

        local cleared = rift.cleared
        local baseAlpha = cleared and 0.3 or 1.0

        -- Base radius scales with tier
        local tier = rift.tier or 1
        local baseR = 18 + tier * 6  -- tier 1=24, tier 2=30, tier 3=36, tier 4=42, tier 5=48

        -- Pulsing animation (outer glow)
        local pulse = math_sin(t * 2.5 + wx * 0.013 + wy * 0.017) * 0.15
        local glowR = baseR * (1.4 + pulse)

        -- Outer purple glow (pulsing)
        love.graphics.setColor(0.45, 0.1, 0.7, (0.25 + pulse * 0.5) * baseAlpha * fadeIn)
        love.graphics.circle("fill", wx, wy, glowR)

        -- Secondary glow ring
        love.graphics.setColor(0.6, 0.2, 0.9, (0.15 + pulse * 0.3) * baseAlpha * fadeIn)
        love.graphics.setLineWidth(2)
        love.graphics.circle("line", wx, wy, glowR)
        love.graphics.setLineWidth(1)

        -- Swirling inner void (dark purple/black rotating)
        local innerR = baseR * 0.95
        local swirl1 = t * 1.8 + wx * 0.007
        local swirl2 = t * 1.8 + wx * 0.007 + math_pi
        -- Two swirling arcs
        love.graphics.setColor(0.2, 0.02, 0.35, 0.8 * baseAlpha * fadeIn)
        love.graphics.arc("fill", "pie", wx, wy, innerR, swirl1, swirl1 + math_pi * 0.7)
        love.graphics.setColor(0.1, 0.0, 0.2, 0.9 * baseAlpha * fadeIn)
        love.graphics.arc("fill", "pie", wx, wy, innerR, swirl2, swirl2 + math_pi * 0.7)

        -- Main void body
        love.graphics.setColor(0.08, 0.0, 0.12, 0.9 * baseAlpha * fadeIn)
        love.graphics.circle("fill", wx, wy, innerR * 0.85)

        -- Dark core
        love.graphics.setColor(0.02, 0.0, 0.04, 0.95 * baseAlpha * fadeIn)
        love.graphics.circle("fill", wx, wy, innerR * 0.55)

        -- Sickly green center pulse (Atlas radiation)
        local greenPulse = 0.4 + math_sin(t * 4.5 + wy * 0.02) * 0.35
        love.graphics.setColor(0.3, 0.9, 0.2, greenPulse * 0.6 * baseAlpha * fadeIn)
        love.graphics.circle("fill", wx, wy, innerR * 0.25)
        love.graphics.setColor(0.5, 1, 0.3, greenPulse * 0.3 * baseAlpha * fadeIn)
        love.graphics.circle("fill", wx, wy, innerR * 0.15)

        -- Orbiting void particles (6 particles)
        for pi = 0, 5 do
            local angle = t * (1.2 + pi * 0.15) + pi * (math_pi * 2 / 6)
            local orbitR = baseR * (1.1 + math_sin(t * 2 + pi) * 0.15)
            local px = wx + math_cos(angle) * orbitR
            local py = wy + math_sin(angle) * orbitR
            local pAlpha = 0.5 + math_sin(t * 3 + pi * 1.5) * 0.3
            love.graphics.setColor(0.5, 0.15, 0.8, pAlpha * baseAlpha * fadeIn)
            love.graphics.circle("fill", px, py, 2 + math_sin(t * 4 + pi) * 0.8)
        end

        -- Outer edge shimmer ring
        love.graphics.setColor(0.7, 0.3, 1, (0.3 + pulse * 0.4) * baseAlpha * fadeIn)
        love.graphics.setLineWidth(1.5)
        love.graphics.circle("line", wx, wy, baseR)
        love.graphics.setLineWidth(1)

        -- Corruption radius indicator (subtle ground stain)
        local cRadius = rift.corruptionRadius or 0
        if cRadius > 0 and not cleared then
            local cPulse = math_sin(t * 0.8 + wx * 0.005) * 0.03
            love.graphics.setColor(0.25, 0.05, 0.35, (0.06 + cPulse) * fadeIn)
            love.graphics.circle("fill", wx, wy, cRadius)
            love.graphics.setColor(0.35, 0.08, 0.5, (0.08 + cPulse) * fadeIn)
            love.graphics.setLineWidth(1)
            love.graphics.circle("line", wx, wy, cRadius)
        end

        -- Name label above rift
        if not cleared then
            love.graphics.setFont(fonts.npc)
            local diffKey = rift.difficulty or "medium"
            local dc = DIFF_COLORS[diffKey] or DIFF_COLORS.medium
            love.graphics.setColor(dc[1], dc[2], dc[3], 0.9 * fadeIn)
            local name = rift.name or "Rift"
            local nameW = (fonts.npc):getWidth(name)
            love.graphics.print(name, wx - nameW / 2, wy - baseR - 22)

            -- Tier + floor count below name
            local info = "Tier " .. tier .. " [" .. (rift.totalFloors or "?") .. " floors]"
            local infoW = (fonts.npc):getWidth(info)
            love.graphics.setColor(dc[1], dc[2], dc[3], 0.65 * fadeIn)
            love.graphics.print(info, wx - infoW / 2, wy - baseR - 10)

            -- Player count indicator (if anyone is inside)
            local pc = rift.playerCount or 0
            if pc > 0 then
                local pcText = pc .. " inside"
                local pcW = (fonts.npc):getWidth(pcText)
                love.graphics.setColor(0.8, 0.8, 1, 0.6 * fadeIn)
                love.graphics.print(pcText, wx - pcW / 2, wy + baseR + 4)
            end
        else
            -- Cleared rift: dim label
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.5, 0.5, 0.5, 0.5 * fadeIn)
            local sealedText = (rift.name or "Rift") .. " (Sealed)"
            local sw = (fonts.npc):getWidth(sealedText)
            love.graphics.print(sealedText, wx - sw / 2, wy - baseR - 16)
        end

        ::continue_rift::
    end

    -- Rift destruction VFX: white flash implosion
    for _, vfx in ipairs(riftDestroyVfx) do
        local progress = 1 - (vfx.timer / vfx.maxTimer)
        local wx = vfx.worldX
        local wy = vfx.worldY

        if progress < 0.3 then
            -- Phase 1: expanding bright flash
            local p = progress / 0.3
            local flashR = 60 * p
            love.graphics.setColor(1, 1, 1, (1 - p * 0.5) * fadeIn)
            love.graphics.circle("fill", wx, wy, flashR)
            love.graphics.setColor(0.7, 0.4, 1, (0.8 - p * 0.3) * fadeIn)
            love.graphics.circle("fill", wx, wy, flashR * 0.6)
        elseif progress < 0.7 then
            -- Phase 2: implosion (shrinking ring)
            local p = (progress - 0.3) / 0.4
            local ringR = 60 * (1 - p)
            love.graphics.setColor(0.9, 0.8, 1, (1 - p) * 0.7 * fadeIn)
            love.graphics.setLineWidth(3 - p * 2)
            love.graphics.circle("line", wx, wy, ringR)
            love.graphics.setLineWidth(1)
            love.graphics.setColor(0.5, 0.2, 0.8, (1 - p) * 0.5 * fadeIn)
            love.graphics.circle("fill", wx, wy, ringR * 0.3)
        else
            -- Phase 3: fading spark
            local p = (progress - 0.7) / 0.3
            love.graphics.setColor(0.8, 0.6, 1, (1 - p) * 0.4 * fadeIn)
            love.graphics.circle("fill", wx, wy, 4 * (1 - p))
        end
    end
end

-- ---------------------------------------------------------------------------
-- Leviathan overworld rendering: large pulsing circles at positions
-- ---------------------------------------------------------------------------
local function drawLeviathans()
    local fadeIn = getFadeIn()
    if not overworld.leviathans then return end
    local t = love.timer.getTime()

    for _, lev in ipairs(overworld.leviathans) do
        local wx = lev.worldX or 0
        local wy = lev.worldY or 0

        -- Size based on tier
        local baseSize = 256
        if lev.tier == "massive" then baseSize = 512
        elseif lev.tier == "colossal" then baseSize = 768 end

        -- Pulsing animation
        local pulse = 1 + math.sin(t * 2 + wx * 0.01) * 0.08
        local size = baseSize * pulse

        -- Dark silhouette core
        love.graphics.setColor(0.05, 0.08, 0.15, 0.6 * fadeIn)
        love.graphics.circle("fill", wx, wy, size * 0.5)

        -- Danger pulse ring
        local ringPulse = 0.3 + math.sin(t * 3 + wy * 0.01) * 0.2
        love.graphics.setColor(0.8, 0.1, 0.1, ringPulse * fadeIn)
        love.graphics.setLineWidth(3)
        love.graphics.circle("line", wx, wy, size * 0.55)
        love.graphics.setLineWidth(1)

        -- Outer haze
        love.graphics.setColor(0.1, 0.15, 0.3, 0.15 * fadeIn)
        love.graphics.circle("fill", wx, wy, size * 0.7)

        -- Name label
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(1, 0.2, 0.2, 0.9 * fadeIn)
        local name = lev.name or "Leviathan"
        local tw = fonts.ui:getWidth(name)
        love.graphics.print(name, wx - tw / 2, wy - size * 0.55 - 20)
    end
end

-- ---------------------------------------------------------------------------
-- Leviathan HUD: warning/aggro banners + multi-part HP bars
-- ---------------------------------------------------------------------------
local function drawLeviathanHUD(W, H)
    local fadeIn = getFadeIn()
    -- Warning banner (amber, center-top)
    if overworld.leviathanWarning and overworld.leviathanWarningTimer > 0 then
        local warn = overworld.leviathanWarning
        local alpha = math.min(1, overworld.leviathanWarningTimer / 0.5)
        local bannerW = 500
        local bannerH = 50
        local bx = (W - bannerW) / 2
        local by = 60

        -- Background
        love.graphics.setColor(0.15, 0.1, 0, 0.85 * alpha * fadeIn)
        love.graphics.rectangle("fill", bx, by, bannerW, bannerH, 8, 8)
        love.graphics.setColor(1, 0.7, 0, 0.9 * alpha * fadeIn)
        love.graphics.setLineWidth(2)
        love.graphics.rectangle("line", bx, by, bannerW, bannerH, 8, 8)
        love.graphics.setLineWidth(1)

        -- Text
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(1, 0.85, 0.3, alpha * fadeIn)
        love.graphics.printf(warn.message or "Leviathan nearby!", bx + 10, by + 8, bannerW - 20, "center")

        -- Tier label
        love.graphics.setColor(1, 0.6, 0.2, 0.8 * alpha * fadeIn)
        love.graphics.printf("[" .. (warn.tier or "?") .. "]", bx + 10, by + 28, bannerW - 20, "center")
    end

    -- Aggro banner (red, center-top, with countdown + flee prompt)
    if overworld.leviathanAggro and overworld.leviathanAggroTimer > 0 then
        local aggro = overworld.leviathanAggro
        local alpha = math.min(1, overworld.leviathanAggroTimer)
        local bannerW = 500
        local bannerH = 65
        local bx = (W - bannerW) / 2
        local by = 60

        -- Red flash background
        local flash = 0.5 + math.sin(love.timer.getTime() * 8) * 0.3
        love.graphics.setColor(0.3 * flash, 0, 0, 0.9 * alpha * fadeIn)
        love.graphics.rectangle("fill", bx, by, bannerW, bannerH, 8, 8)
        love.graphics.setColor(1, 0.1, 0.1, 0.9 * alpha * fadeIn)
        love.graphics.setLineWidth(2)
        love.graphics.rectangle("line", bx, by, bannerW, bannerH, 8, 8)
        love.graphics.setLineWidth(1)

        -- Name + danger
        love.graphics.setFont(fonts.ui)
        love.graphics.setColor(1, 0.3, 0.3, alpha * fadeIn)
        love.graphics.printf((aggro.name or "Leviathan") .. " ATTACKS!", bx + 10, by + 6, bannerW - 20, "center")

        -- Countdown
        love.graphics.setColor(1, 1, 0.3, alpha * fadeIn)
        local countdown = string.format("%.1fs", math.max(0, overworld.leviathanAggroTimer))
        love.graphics.printf(countdown .. " - Press F to FLEE", bx + 10, by + 26, bannerW - 20, "center")

        -- Tier
        love.graphics.setColor(1, 0.5, 0.2, 0.8 * alpha * fadeIn)
        love.graphics.printf("[" .. (aggro.tier or "?") .. "]", bx + 10, by + 46, bannerW - 20, "center")
    end

    -- Multi-part HP bars (right side, during leviathan combat)
    if overworld.leviathanParts and overworld.leviathanCombatName then
        game.drawLeviathanPartBars(W, H)
    end
end

-- ---------------------------------------------------------------------------
-- Multi-part HP bars for leviathan combat (right side of screen)
-- ---------------------------------------------------------------------------
local function drawLeviathanPartBars(W, H)
    local fadeIn = getFadeIn()
    local barW = 180
    local barH = 18
    local gap = 6
    local rightPad = 20
    local topPad = 120

    local bx = W - barW - rightPad
    local by = topPad

    -- Title
    love.graphics.setFont(fonts.ui)
    local titleColor = overworld.leviathanEnraged and {1, 0.2, 0.2} or {0.8, 0.9, 1}
    love.graphics.setColor(titleColor[1], titleColor[2], titleColor[3], 0.95 * fadeIn)
    love.graphics.printf(overworld.leviathanCombatName or "Leviathan", bx, by - 24, barW, "center")

    -- Phase text
    if overworld.leviathanPhaseText and overworld.leviathanPhaseTimer > 0 then
        local pa = math.min(1, overworld.leviathanPhaseTimer / 0.5)
        love.graphics.setColor(1, 0.7, 0.2, pa * fadeIn)
        love.graphics.printf(overworld.leviathanPhaseText, bx - 50, by - 8, barW + 100, "center")
        by = by + 16
    end

    -- Sort parts by alive status (alive first)
    local sortedParts = {}
    for _, part in pairs(overworld.leviathanParts) do
        table.insert(sortedParts, part)
    end
    table.sort(sortedParts, function(a, b)
        if a.alive ~= b.alive then return a.alive end
        return (a.name or "") < (b.name or "")
    end)

    for _, part in ipairs(sortedParts) do
        -- Background
        love.graphics.setColor(0.1, 0.1, 0.15, 0.8 * fadeIn)
        love.graphics.rectangle("fill", bx, by, barW, barH, 3, 3)

        if part.alive then
            -- HP bar fill
            local pct = (part.maxHp and part.maxHp > 0) and (part.hp / part.maxHp) or 0
            pct = math.max(0, math.min(1, pct))

            -- Color gradient: green -> yellow -> red
            local r, g, b = 0.2, 0.8, 0.2
            if pct < 0.5 then
                r = 0.8 + (1 - pct * 2) * 0.2
                g = pct * 2 * 0.8
                b = 0.1
            elseif pct < 0.75 then
                r = 0.8
                g = 0.8
                b = 0.1
            end

            love.graphics.setColor(r, g, b, 0.85 * fadeIn)
            love.graphics.rectangle("fill", bx + 1, by + 1, (barW - 2) * pct, barH - 2, 2, 2)
        else
            -- Strike-through for destroyed parts
            love.graphics.setColor(0.5, 0.1, 0.1, 0.4 * fadeIn)
            love.graphics.rectangle("fill", bx + 1, by + 1, barW - 2, barH - 2, 2, 2)
            love.graphics.setColor(1, 0.2, 0.2, 0.7 * fadeIn)
            love.graphics.setLineWidth(2)
            love.graphics.line(bx + 4, by + barH / 2, bx + barW - 4, by + barH / 2)
            love.graphics.setLineWidth(1)
        end

        -- Border
        love.graphics.setColor(0.4, 0.5, 0.6, 0.7 * fadeIn)
        love.graphics.rectangle("line", bx, by, barW, barH, 3, 3)

        -- Part name
        love.graphics.setColor(1, 1, 1, (part.alive and 0.95 or 0.4) * fadeIn)
        love.graphics.printf(part.name or "?", bx + 4, by + 2, barW - 8, "left")

        -- HP text (if alive)
        if part.alive and part.maxHp and part.maxHp > 0 then
            love.graphics.setColor(1, 1, 1, 0.7 * fadeIn)
            love.graphics.printf(part.hp .. "/" .. part.maxHp, bx + 4, by + 2, barW - 8, "right")
        end

        by = by + barH + gap
    end
end

local function drawConnections()
    if not connections then return end

    local t = love.timer.getTime()
    for _, conn in ipairs(connections) do
        local pulse = 0.5 + math.sin(t * 3) * 0.3

        if conn.isPlotEntrance then
            -- Plot entrance: green house icon
            love.graphics.setColor(0.2, 0.6, 0.2, pulse * 0.5)
            love.graphics.rectangle("fill", conn.x - 18, conn.y - 12, 36, 28, 3, 3)
            -- Roof
            love.graphics.setColor(0.4, 0.25, 0.1, pulse * 0.7)
            love.graphics.polygon("fill", conn.x - 22, conn.y - 12, conn.x + 22, conn.y - 12, conn.x, conn.y - 28)
            -- Door
            love.graphics.setColor(0.3, 0.2, 0.1, pulse * 0.8)
            love.graphics.rectangle("fill", conn.x - 5, conn.y + 2, 10, 14, 2, 2)
            -- Outline
            love.graphics.setColor(0.3, 0.7, 0.3, pulse * 0.8)
            love.graphics.setLineWidth(2)
            love.graphics.rectangle("line", conn.x - 18, conn.y - 12, 36, 28, 3, 3)
            love.graphics.setLineWidth(1)
            -- Owner name label
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.4, 0.8, 0.4, 0.7)
            local label = (conn.ownerName or "Home")
            love.graphics.printf(label, conn.x - 60, conn.y - 44, 120, "center")
        elseif conn.targetZone == "rift_antechamber" then
            -- Rift entrance: dark purple swirling game._portal
            local riftPulse = 0.6 + math.sin(t * 4) * 0.4
            -- Outer glow
            love.graphics.setColor(0.3, 0.0, 0.4, riftPulse * 0.3)
            love.graphics.circle("fill", conn.x, conn.y, 42)
            -- Inner dark void
            love.graphics.setColor(0.1, 0.0, 0.15, riftPulse * 0.7)
            love.graphics.circle("fill", conn.x, conn.y, 32)
            -- Purple ring
            love.graphics.setColor(0.6, 0.1, 0.8, riftPulse * 0.9)
            love.graphics.setLineWidth(3)
            love.graphics.circle("line", conn.x, conn.y, 32)
            -- Inner swirl ring
            love.graphics.setColor(0.8, 0.2, 1.0, riftPulse * 0.6)
            love.graphics.setLineWidth(2)
            love.graphics.arc("line", "open", conn.x, conn.y, 20, t * 2, t * 2 + math.pi * 1.2)
            love.graphics.arc("line", "open", conn.x, conn.y, 20, t * 2 + math.pi, t * 2 + math.pi * 2.2)
            love.graphics.setLineWidth(1)
            -- Label
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.8, 0.3, 1.0, 0.9)
            love.graphics.printf("The Rift", conn.x - 60, conn.y - 52, 120, "center")
        elseif conn._proc then
            -- Procedural quest location — amber pulsing diamond
            local s = 18 + math.sin(t * 2.5) * 4
            love.graphics.setColor(0.9, 0.6, 0.1, pulse * 0.25)
            love.graphics.polygon("fill",
                conn.x,     conn.y - s,
                conn.x + s, conn.y,
                conn.x,     conn.y + s,
                conn.x - s, conn.y)
            love.graphics.setColor(1.0, 0.75, 0.2, pulse * 0.9)
            love.graphics.setLineWidth(2)
            love.graphics.polygon("line",
                conn.x,     conn.y - s,
                conn.x + s, conn.y,
                conn.x,     conn.y + s,
                conn.x - s, conn.y)
            love.graphics.setLineWidth(1)
            -- Inner glow dot
            love.graphics.setColor(1.0, 0.9, 0.4, pulse * 0.6)
            love.graphics.circle("fill", conn.x, conn.y, 5)
            -- Label
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(1.0, 0.85, 0.3, 0.9)
            love.graphics.printf(conn.label or "Quest Site", conn.x - 70, conn.y - s - 18, 140, "center")
        else
            -- Portal circle (default)
            love.graphics.setColor(0.3, 0.5, 1.0, pulse * 0.4)
            love.graphics.circle("fill", conn.x, conn.y, 30)
            love.graphics.setColor(0.4, 0.6, 1.0, pulse * 0.8)
            love.graphics.setLineWidth(2)
            love.graphics.circle("line", conn.x, conn.y, 30)
            love.graphics.setLineWidth(1)

            -- Arrow/direction indicator
            love.graphics.setColor(0.5, 0.7, 1.0, 0.6)
            love.graphics.setFont(fonts.npc)
            love.graphics.printf(conn.targetZone or "?", conn.x - 50, conn.y - 45, 100, "center")

            -- Direction arrow
            local arrowChar = ">"
            if conn.direction == "north" then arrowChar = "^"
            elseif conn.direction == "south" then arrowChar = "v"
            elseif conn.direction == "west" then arrowChar = "<"
            end
            love.graphics.setFont(fonts.ui)
            love.graphics.printf(arrowChar, conn.x - 10, conn.y - 8, 20, "center")
        end
    end
end

-- Find the other-player (not self) whose sprite bounding box contains
-- the given screen-space coordinates (sx, sy). Returns the player table
-- and its id, or nil if nothing is under the cursor.
local function getOtherPlayerAtScreen(sx, sy)
    local myId = getMyId()
    local wx = sx + math.floor(camera.x)
    local wy = sy + math.floor(camera.y)
    -- Player sprite bounding box: body from (x-8, y-32) to (x+8, y+12)
    -- Head radius 7 adds up top; name tag above. We use a generous click
    -- box of 20x48 centered on the player's (x, y-8) so it covers head+body.
    local HALF_W = 12
    local TOP = 34   -- above p.y
    local BOTTOM = 16 -- below p.y
    for id, p in pairs(players) do
        if id ~= myId then
            if wx >= p.x - HALF_W and wx <= p.x + HALF_W and
               wy >= p.y - TOP and wy <= p.y + BOTTOM then
                return p, id
            end
        end
    end
    return nil, nil
end

-- Execute a context menu action for the given target
local function executeContextMenuAction(action, targetId, targetName)
    local client = getClient()
    local myId = getMyId()
    if not client then return end
    if action == "friend" then
        client:emit("friend_request_by_id", { targetId = targetId })
        game.addFloatingText({
            text = "Friend request sent to " .. targetName,
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 40) or 0,
            color = { 0.4, 0.9, 0.4 },
            timer = 2.5,
        })
    elseif action == "party" then
        client:emit("party_invite", { targetId = targetId })
        game.addFloatingText({
            text = "Party invite sent to " .. targetName,
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 40) or 0,
            color = { 0.4, 0.7, 1 },
            timer = 2.5,
        })
    elseif action == "game._trade" then
        client:emit("trade_request", { targetId = targetId })
        -- Store target info so trade_started can resolve the partner name
        game._trade.partnerId = targetId
        game._trade.partnerName = targetName or "???"
        game.addFloatingText({
            text = "Trade request sent to " .. targetName,
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 40) or 0,
            color = { 1, 0.85, 0.2 },
            timer = 2.5,
        })
    elseif action == "duel" then
        game.addFloatingText({
            text = "Dueling not yet available",
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 40) or 0,
            color = { 0.6, 0.6, 0.6 },
            timer = 2.0,
        })
    elseif action == "profile" then
        client:emit("profile_request", { targetId = targetId })
    elseif action == "whisper" then
        -- Activate chat with /whisper <name> prefilled
        chat.active = true
        chat.input = "/whisper " .. targetName .. " "
    elseif action == "party_kick" then
        client:emit("party_kick", { targetId = targetId })
        game.addFloatingText({
            text = "Kicking " .. targetName .. " from party",
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 40) or 0,
            color = { 1, 0.5, 0.3 },
            timer = 2.5,
        })
    end
end

local function drawPlayer(p, isMe)
    -- Parse hex color
    local r, g, b = game.hexToRGB(p.color)

    -- Water mount visual: draw raft/boat beneath player when on water
    if isMe and rpg.mount and WATER_MOUNT_TYPES[rpg.mount] and overworld.chunkBased then
        local feat = game.getFeatureAtWorld(p.x, p.y)
        if game.isWaterFeature(feat) then
            if rpg.mount == "raft" then
                love.graphics.setColor(0.5, 0.35, 0.2, 0.8)
                love.graphics.rectangle("fill", p.x - 16, p.y - 6, 32, 20, 3, 3)
                love.graphics.setColor(0.4, 0.25, 0.15, 0.5)
                for lx = -12, 12, 6 do
                    love.graphics.line(p.x + lx, p.y - 6, p.x + lx, p.y + 14)
                end
            elseif rpg.mount == "boat" then
                love.graphics.setColor(0.45, 0.30, 0.18, 0.85)
                love.graphics.rectangle("fill", p.x - 18, p.y - 4, 36, 22, 5, 5)
                love.graphics.setColor(0.55, 0.40, 0.25, 0.6)
                love.graphics.rectangle("line", p.x - 18, p.y - 4, 36, 22, 5, 5)
                -- Mast
                love.graphics.setColor(0.5, 0.35, 0.2, 0.7)
                love.graphics.line(p.x, p.y - 4, p.x, p.y - 20)
            end
        end
    end

    -- Land mount visual: draw horse/caravan beneath player on overworld
    if isMe and rpg.mount and LAND_MOUNT_SPEED[rpg.mount] and overworld.chunkBased then
        if rpg.mount == "horse" then
            -- Horse body (brown ellipse beneath player)
            love.graphics.setColor(0.55, 0.35, 0.15, 0.85)
            love.graphics.ellipse("fill", p.x, p.y + 6, 18, 10)
            -- Horse head
            love.graphics.setColor(0.5, 0.3, 0.12, 0.9)
            love.graphics.ellipse("fill", p.x + 12, p.y - 2, 6, 5)
            -- Legs
            love.graphics.setColor(0.4, 0.25, 0.1, 0.7)
            love.graphics.rectangle("fill", p.x - 10, p.y + 12, 3, 8)
            love.graphics.rectangle("fill", p.x - 3, p.y + 12, 3, 8)
            love.graphics.rectangle("fill", p.x + 4, p.y + 12, 3, 8)
            love.graphics.rectangle("fill", p.x + 11, p.y + 12, 3, 8)
        elseif rpg.mount == "caravan" then
            -- Caravan wagon body
            love.graphics.setColor(0.45, 0.3, 0.15, 0.85)
            love.graphics.rectangle("fill", p.x - 20, p.y - 2, 40, 20, 3, 3)
            -- Canvas top
            love.graphics.setColor(0.7, 0.65, 0.5, 0.7)
            love.graphics.arc("fill", p.x, p.y - 2, 20, math.pi, 0)
            -- Wheels
            love.graphics.setColor(0.3, 0.2, 0.1, 0.9)
            love.graphics.circle("fill", p.x - 14, p.y + 18, 5)
            love.graphics.circle("fill", p.x + 14, p.y + 18, 5)
            love.graphics.setColor(0.5, 0.4, 0.25, 0.6)
            love.graphics.circle("line", p.x - 14, p.y + 18, 5)
            love.graphics.circle("line", p.x + 14, p.y + 18, 5)
        end
    end

    -- Ascension glow (eternal_mark)
    local hasAscGlow = (isMe and rpg.ascensionMark) or (not isMe and p.ascensionMark)
    if hasAscGlow then
        local t = love.timer.getTime()
        local pulse = 0.55 + 0.15 * math.sin(t * 2.0)
        local outerPulse = 22 + 3 * math.sin(t * 1.5)
        -- Outer golden halo
        love.graphics.setColor(1.0, 0.85, 0.3, pulse * 0.25)
        love.graphics.circle("fill", p.x, p.y - 2, outerPulse)
        -- Inner radiant glow
        love.graphics.setColor(1.0, 0.9, 0.5, pulse * 0.4)
        love.graphics.circle("fill", p.x, p.y - 2, 14)
    end

    -- Shadow
    love.graphics.setColor(0, 0, 0, 0.2)
    love.graphics.ellipse("fill", p.x, p.y + 14, 10, 4)

    -- Body
    love.graphics.setColor(r, g, b, 0.9)
    love.graphics.rectangle("fill", p.x - 8, p.y - 12, 16, 24, 3, 3)

    -- Head
    love.graphics.setColor(r + 0.1, g + 0.1, b + 0.1)
    love.graphics.circle("fill", p.x, p.y - 16, 7)

    -- Eyes (based on facing)
    love.graphics.setColor(0, 0, 0, 0.8)
    if p.facing == "down" or p.facing == nil then
        love.graphics.circle("fill", p.x - 2.5, p.y - 16, 1.5)
        love.graphics.circle("fill", p.x + 2.5, p.y - 16, 1.5)
    elseif p.facing == "up" then
        -- No eyes visible from behind
    elseif p.facing == "left" then
        love.graphics.circle("fill", p.x - 3, p.y - 16, 1.5)
    elseif p.facing == "right" then
        love.graphics.circle("fill", p.x + 3, p.y - 16, 1.5)
    end

    -- Name tag (CharacterName | Username)
    love.graphics.setFont(fonts.name)
    if isMe then
        love.graphics.setColor(1, 1, 1, 0.95)
    else
        love.graphics.setColor(0.8, 0.8, 0.8, 0.8)
    end
    local displayName = p.name
    if p.username and p.username ~= p.name then
        displayName = p.name .. " | " .. p.username
    end
    love.graphics.printf(displayName, p.x - 75, p.y - 32, 150, "center")

    -- Selection indicator for self
    if isMe then
        love.graphics.setColor(1, 1, 1, 0.3 + math.sin(love.timer.getTime() * 4) * 0.15)
        love.graphics.setLineWidth(1)
        love.graphics.circle("line", p.x, p.y, 18)
    end
end

-- NPC Dialogue Panel
local function drawDialoguePanel(W, H)
    local dlg = game._npcDialogue
    if not dlg.show then return end

    local topics      = (not dlg.topicMode) and dlg.availableTopics or nil
    local topicCount  = topics and #topics or 0
    local choiceCount = #dlg.choices
    local qOffers   = dlg.questOffers  or {}
    local qTurnins  = dlg.questTurnins or {}
    local questCount = #qOffers + #qTurnins

    -- Expand height when topics or quest offers are present
    local panelW   = math.min(640, W - 40)
    local baseH    = 210
    local topicH   = topicCount > 0 and (20 + topicCount * 22) or 0
    local questH   = questCount  > 0 and (26 + questCount  * 26) or 0
    local panelH   = baseH + topicH + questH
    local panelX   = (W - panelW) / 2
    local panelY   = H - panelH - 20

    -- Portrait dimensions (shown on left if available)
    local portW    = dlg.portrait and 72 or 0
    local textOffX = portW > 0 and (portW + 12) or 0

    -- Background
    love.graphics.setColor(0.05, 0.05, 0.12, 0.92)
    love.graphics.rectangle("fill", panelX, panelY, panelW, panelH, 8, 8)
    love.graphics.setColor(0.4, 0.5, 0.8, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", panelX, panelY, panelW, panelH, 8, 8)

    -- Portrait rendering (loads from assets/icons/portraits/ on demand, cached)
    if dlg.portrait then
        if not _portraitCache then _portraitCache = {} end
        local img = _portraitCache[dlg.portrait]
        if img == nil then
            local ok, loaded = pcall(love.graphics.newImage, "assets/icons/portraits/" .. dlg.portrait)
            _portraitCache[dlg.portrait] = ok and loaded or false
            img = _portraitCache[dlg.portrait]
        end
        if img then
            local iw, ih = img:getWidth(), img:getHeight()
            local scale  = math.min(portW / iw, portW / ih)
            love.graphics.setColor(1, 1, 1, 1)
            love.graphics.draw(img, panelX + 10, panelY + 10, 0, scale, scale)
        else
            -- Fallback placeholder when image fails to load
            love.graphics.setColor(0.15, 0.15, 0.25, 1)
            love.graphics.rectangle("fill", panelX + 10, panelY + 10, portW, portW, 4, 4)
            love.graphics.setColor(0.3, 0.35, 0.55, 1)
            love.graphics.setLineWidth(1)
            love.graphics.rectangle("line", panelX + 10, panelY + 10, portW, portW, 4, 4)
        end
        -- Race label under portrait
        if dlg.race then
            love.graphics.setColor(0.55, 0.6, 0.75, 1)
            love.graphics.setFont(fonts.small or fonts.main or love.graphics.getFont())
            love.graphics.printf(dlg.race, panelX + 10, panelY + portW + 14, portW, "center")
        end
    end

    -- NPC Name
    local nameX = panelX + 16 + textOffX
    love.graphics.setColor(1, 0.85, 0.3, 1)
    love.graphics.setFont(fonts.bold or love.graphics.getFont())
    love.graphics.print(dlg.npcName, nameX, panelY + 10)

    -- Topic-mode label
    if dlg.topicMode then
        love.graphics.setColor(0.5, 0.7, 1, 0.7)
        love.graphics.setFont(fonts.small or fonts.main or love.graphics.getFont())
        love.graphics.print("(on this topic)", nameX + 4, panelY + 28)
    end

    -- Dialogue text
    love.graphics.setColor(0.9, 0.9, 0.95, 1)
    love.graphics.setFont(fonts.main or love.graphics.getFont())
    local textW = panelW - 32 - textOffX
    love.graphics.printf(dlg.text, nameX, panelY + 38, textW, "left")

    local mx, my = love.mouse.getPosition()

    -- Dialogue tree choices
    local choiceY = panelY + 120
    for i, choice in ipairs(dlg.choices) do
        local label  = "[" .. i .. "] " .. (choice.label or "...")
        local cx     = panelX + 24
        local cw     = panelW - 48
        local ch     = 22
        local hover  = mx >= cx and mx <= cx + cw and my >= choiceY and my <= choiceY + ch
        if hover then
            love.graphics.setColor(0.3, 0.4, 0.7, 0.5)
            love.graphics.rectangle("fill", cx - 4, choiceY - 2, cw + 8, ch + 4, 4, 4)
            love.graphics.setColor(0.6, 0.8, 1, 1)
        else
            love.graphics.setColor(0.7, 0.75, 0.85, 1)
        end
        love.graphics.setFont(fonts.main or love.graphics.getFont())
        love.graphics.print(label, cx, choiceY)
        choiceY = choiceY + 24
    end

    -- Available topics section
    if topicCount > 0 then
        local sepY = panelY + baseH - 16
        love.graphics.setColor(0.3, 0.35, 0.55, 0.6)
        love.graphics.setLineWidth(1)
        love.graphics.line(panelX + 16, sepY, panelX + panelW - 16, sepY)

        love.graphics.setColor(0.55, 0.65, 0.85, 0.8)
        love.graphics.setFont(fonts.small or fonts.main or love.graphics.getFont())
        love.graphics.print("Ask about:", panelX + 16, sepY + 3)

        local topicY = sepY + 20
        for ti, topic in ipairs(topics) do
            local tx    = panelX + 24
            local tw    = panelW - 48
            local th    = 20
            local hover = mx >= tx and mx <= tx + tw and my >= topicY and my <= topicY + th
            if hover then
                love.graphics.setColor(0.25, 0.35, 0.6, 0.45)
                love.graphics.rectangle("fill", tx - 4, topicY - 1, tw + 8, th + 2, 3, 3)
                love.graphics.setColor(0.5, 0.75, 1, 1)
            else
                love.graphics.setColor(0.5, 0.6, 0.8, 0.85)
            end
            love.graphics.setFont(fonts.main or love.graphics.getFont())
            love.graphics.print("  " .. (topic.label or topic.id), tx, topicY)
            topicY = topicY + 22
        end
    end

    -- Quest offers / turnins (from writing-tool authored quests)
    if questCount > 0 then
        local qSepY = choiceY + 2
        love.graphics.setColor(0.40, 0.30, 0.10, 0.55)
        love.graphics.setLineWidth(1)
        love.graphics.line(panelX + 16, qSepY, panelX + panelW - 16, qSepY)
        love.graphics.setFont(fonts.small or fonts.main or love.graphics.getFont())
        love.graphics.setColor(0.85, 0.72, 0.28, 0.85)
        love.graphics.print("Quests:", panelX + 16, qSepY + 3)
        choiceY = qSepY + 22

        -- Turn-ins first (quest is complete, hand it in)
        for _, qt in ipairs(qTurnins) do
            local cx2  = panelX + 24
            local cw2  = panelW - 48
            local hover = mx >= cx2 and mx <= cx2 + cw2 and my >= choiceY and my <= choiceY + 22
            if hover then
                love.graphics.setColor(0.20, 0.45, 0.15, 0.50)
                love.graphics.rectangle("fill", cx2 - 4, choiceY - 2, cw2 + 8, 26, 4, 4)
                love.graphics.setColor(0.45, 1.0, 0.35, 1)
            else
                love.graphics.setColor(0.35, 0.85, 0.25, 1)
            end
            love.graphics.setFont(fonts.main or love.graphics.getFont())
            love.graphics.print("[Turn in] " .. (qt.name or qt.questId), cx2, choiceY)
            choiceY = choiceY + 26
        end

        -- New quest offers
        for _, qo in ipairs(qOffers) do
            local cx2  = panelX + 24
            local cw2  = panelW - 48
            local hover = mx >= cx2 and mx <= cx2 + cw2 and my >= choiceY and my <= choiceY + 22
            if hover then
                love.graphics.setColor(0.25, 0.30, 0.55, 0.50)
                love.graphics.rectangle("fill", cx2 - 4, choiceY - 2, cw2 + 8, 26, 4, 4)
                love.graphics.setColor(0.70, 0.85, 1.0, 1)
            else
                love.graphics.setColor(0.55, 0.70, 0.95, 1)
            end
            love.graphics.setFont(fonts.main or love.graphics.getFont())
            love.graphics.print("[Quest] " .. (qo.name or qo.questId), cx2, choiceY)
            choiceY = choiceY + 26
        end
    end

    -- Topic-mode: Back button
    if dlg.topicMode then
        local bx    = panelX + 24
        local by    = panelY + panelH - 30
        local bw    = 90
        local bh    = 22
        local hover = mx >= bx and mx <= bx + bw and my >= by and my <= by + bh
        love.graphics.setColor(hover and 0.3 or 0.15, hover and 0.4 or 0.2, hover and 0.7 or 0.45, 0.8)
        love.graphics.rectangle("fill", bx - 4, by - 2, bw + 8, bh + 4, 4, 4)
        love.graphics.setColor(0.7, 0.8, 1, 1)
        love.graphics.setFont(fonts.main or love.graphics.getFont())
        love.graphics.print("[Esc] Back", bx, by)
    end
end

-- Dedicated RNG for weather particles (avoids reseeding global math.random)
local weatherRng = love.math.newRandomGenerator()

local function drawWeather(W, H)
    if world.weather == "rain" or world.weather == "storm" then
        love.graphics.setColor(0.5, 0.6, 0.8, 0.08)
        love.graphics.rectangle("fill", 0, 0, W, H)

        -- Rain drops (using dedicated RNG, seeded by time frame)
        weatherRng:setSeed(math.floor(love.timer.getTime() * 10))
        local alpha = world.weather == "storm" and 0.4 or 0.2
        love.graphics.setColor(0.6, 0.7, 0.9, alpha)
        for i = 1, (world.weather == "storm" and 80 or 30) do
            local rx = weatherRng:random(0, W)
            local ry = weatherRng:random(0, H)
            love.graphics.line(rx, ry, rx - 2, ry + 8)
        end

    elseif world.weather == "fog" then
        love.graphics.setColor(0.7, 0.7, 0.7, 0.15)
        love.graphics.rectangle("fill", 0, 0, W, H)

    elseif world.weather == "snow" then
        weatherRng:setSeed(math.floor(love.timer.getTime() * 5))
        love.graphics.setColor(1, 1, 1, 0.5)
        for i = 1, 40 do
            local sx = weatherRng:random(0, W)
            local sy = weatherRng:random(0, H)
            love.graphics.circle("fill", sx, sy, 2)
        end
    end
end

local function drawSeasonVisual(W, H)
    local sv = world.seasonVisual
    if not sv then return end

    -- Color shift overlay (subtle screen tint)
    local cs = sv.colorShift
    if cs then
        local r = cs.r and (cs.r / 255) or 0
        local g = cs.g and (cs.g / 255) or 0
        local b = cs.b and (cs.b / 255) or 0
        -- Positive shift: add color, negative: subtract via blend
        if r > 0 or g > 0 or b > 0 then
            love.graphics.setColor(math.max(0, r), math.max(0, g), math.max(0, b), 0.06)
            love.graphics.rectangle("fill", 0, 0, W, H)
        end
        if r < 0 or g < 0 or b < 0 then
            love.graphics.setColor(math.abs(r), math.abs(g), math.abs(b), 0.04)
            love.graphics.rectangle("fill", 0, 0, W, H)
        end
    end

    -- Seasonal particles
    local effect = sv.particleEffect
    if not effect then return end

    weatherRng:setSeed(math.floor(love.timer.getTime() * 3))
    local t = love.timer.getTime()

    if effect == "snowfall" then
        -- Gentle persistent snowfall (lighter than weather snow)
        love.graphics.setColor(0.95, 0.95, 1, 0.35)
        for i = 1, 25 do
            local sx = weatherRng:random(0, W)
            local sy = (weatherRng:random(0, H) + t * 20 * (1 + i % 3)) % H
            local sz = 1 + (i % 3)
            love.graphics.circle("fill", sx, sy, sz)
        end

    elseif effect == "leaves" then
        -- Falling autumn leaves
        for i = 1, 15 do
            local lx = weatherRng:random(0, W)
            local ly = (weatherRng:random(0, H) + t * 15 * (1 + i % 2)) % H
            -- Warm autumn colors
            local leafColors = {
                {0.85, 0.45, 0.15},
                {0.80, 0.30, 0.10},
                {0.90, 0.60, 0.10},
                {0.70, 0.25, 0.05},
            }
            local lc = leafColors[(i % #leafColors) + 1]
            love.graphics.setColor(lc[1], lc[2], lc[3], 0.5)
            -- Small diamond shape for leaf
            local angle = t * 2 + i
            local dx = math.cos(angle) * 3
            local dy = math.sin(angle) * 2
            love.graphics.polygon("fill", lx + dx, ly - 3, lx + 3, ly + dy, lx - dx, ly + 3, lx - 3, ly - dy)
        end

    elseif effect == "pollen" then
        -- Floating pollen/petals
        love.graphics.setColor(1, 1, 0.7, 0.25)
        for i = 1, 20 do
            local px = (weatherRng:random(0, W) + math.sin(t + i) * 30) % W
            local py = (weatherRng:random(0, H) + math.cos(t * 0.7 + i) * 20) % H
            love.graphics.circle("fill", px, py, 1.5)
        end

    elseif effect == "shimmer" then
        -- Heat shimmer / distortion dots
        love.graphics.setColor(1, 0.95, 0.8, 0.15)
        for i = 1, 12 do
            local hx = weatherRng:random(0, W)
            local hy = H - weatherRng:random(0, math.floor(H * 0.4))
            local pulse = math.sin(t * 3 + i) * 0.5 + 0.5
            love.graphics.setColor(1, 0.95, 0.8, 0.08 + pulse * 0.08)
            love.graphics.circle("fill", hx, hy, 4 + pulse * 3)
        end
    end
end

local function drawHUD(W, H)
    local account = getAccount()
    local zone    = getZone()
    local skills  = getSkills()
    local fadeIn  = getFadeIn()
    -- Top bar
    love.graphics.setColor(0, 0, 0, 0.5)
    love.graphics.rectangle("fill", 0, 0, W, 32)

    love.graphics.setFont(fonts.hud)

    -- Zone name + dynamic HUD layout
    local hudX = 10
    if zone then
        love.graphics.setColor(0.9, 0.8, 0.3, fadeIn)
        love.graphics.print(zone.name, hudX, 7)
        hudX = hudX + fonts.hud:getWidth(zone.name) + 20

        -- Player count
        local pCount = 0
        for _ in pairs(players) do pCount = pCount + 1 end
        local pText = "Players: " .. pCount
        love.graphics.setColor(0.6, 0.7, 0.8, fadeIn * 0.7)
        love.graphics.print(pText, hudX, 7)
        hudX = hudX + fonts.hud:getWidth(pText) + 20

        -- Region name (for overworld/hollow earth chunks)
        if overworld.chunkBased and overworld.currentBiome then
            if overworld.isHollowEarth then
                love.graphics.setColor(0.6, 0.4, 0.9, fadeIn * 0.9)
                local heLabel = "[Hollow Earth] " .. overworld.currentBiome
                love.graphics.print(heLabel, hudX, 7)
                hudX = hudX + fonts.hud:getWidth(heLabel) + 20
            else
                love.graphics.setColor(0.8, 0.75, 0.4, fadeIn * 0.8)
                love.graphics.print(overworld.currentBiome, hudX, 7)
                hudX = hudX + fonts.hud:getWidth(overworld.currentBiome) + 20
            end
        end

        -- Corruption indicator (overworld only, when corruption is active)
        if corruption.globalInfo and corruption.globalInfo.totalChunks > 0 then
            local cText = "Corruption: " .. corruption.globalInfo.totalChunks
            if corruption.globalInfo.hordes > 0 then
                cText = cText .. " [" .. corruption.globalInfo.hordes .. " hordes]"
            end
            local cPulse = 0.7 + math.sin(corruption.animTimer * 2) * 0.15
            love.graphics.setColor(0.6, 0.15, 0.8, fadeIn * cPulse)
            love.graphics.print(cText, hudX, 7)
            hudX = hudX + fonts.hud:getWidth(cText) + 20
        end
    end

    -- Race + Level display
    if rpg.race then
        love.graphics.setColor(0.8, 0.7, 0.5, fadeIn * 0.9)
        local raceText = rpg.race:sub(1,1):upper() .. rpg.race:sub(2) .. " Lv." .. rpg.level
        love.graphics.print(raceText, hudX, 7)
        hudX = hudX + fonts.hud:getWidth(raceText) + 15
    end

    -- Top skills (just show 3 highest)
    if skills then
        local skillList = {}
        for sName, sData in pairs(skills) do
            if sData.level and sData.level > 1 then
                table.insert(skillList, { name = sName, level = sData.level })
            end
        end
        table.sort(skillList, function(a, b) return a.level > b.level end)
        local shown = 0
        for _, s in ipairs(skillList) do
            if shown >= 3 then break end
            local abbr = s.name:sub(1,1):upper() .. s.name:sub(2,3)
            local txt = abbr .. ":" .. s.level
            love.graphics.setColor(0.6, 0.7, 0.9, fadeIn * 0.8)
            love.graphics.print(txt, hudX, 7)
            hudX = hudX + fonts.hud:getWidth(txt) + 10
            shown = shown + 1
        end
    end

    -- Pending packs indicator
    if rpg.pendingPacks and rpg.pendingPacks > 0 then
        love.graphics.setColor(1, 0.85, 0.2, fadeIn * (0.7 + 0.3 * math.sin(love.timer.getTime() * 3)))
        local packText = "Packs: " .. rpg.pendingPacks
        love.graphics.print(packText, hudX, 7)
        hudX = hudX + fonts.hud:getWidth(packText) + 15
    end

    -- Plot indicator
    if overworld.chunkBased then
        if overworld.myPlotId then
            love.graphics.setColor(0.3, 0.9, 0.3, fadeIn * 0.9)
            love.graphics.print("Plot Claimed", hudX, 7)
            hudX = hudX + fonts.hud:getWidth("Plot Claimed") + 15
        else
            love.graphics.setColor(0.6, 0.5, 0.3, fadeIn * 0.6)
            love.graphics.print("[P] Claim Plot", hudX, 7)
            hudX = hudX + fonts.hud:getWidth("[P] Claim Plot") + 15
        end
    end

    -- Account info (coins)
    if account then
        love.graphics.setColor(1, 0.85, 0.2, fadeIn)
        love.graphics.printf("Coins: " .. (account.coins or 0), 0, 7, W - 10, "right")
    end

    -- World info
    love.graphics.setColor(0.6, 0.6, 0.7, fadeIn * 0.6)
    local worldText = world.timeOfDay
    if world.weather ~= "clear" then
        worldText = worldText .. " | " .. world.weather
    end
    love.graphics.printf(worldText, 0, 7, W - 150, "right")

    -- Identity
    if identity then
        love.graphics.setColor(0.5, 0.6, 0.7, fadeIn * 0.5)
        love.graphics.setFont(fonts.npc)
        love.graphics.print(identity.name .. "#" .. (identity.tag or "????"), 10, H - 18)
    end

    -- Stamina bar (only visible when not full or sprinting)
    local sprintBarMax = computeSprintBonuses().max
    if sprint.stamina < sprintBarMax or sprint.isSprinting then
        local barW = 120
        local barH = 6
        local barX = W / 2 - barW / 2
        local barY = 38
        local pct = sprint.stamina / sprintBarMax

        -- Background
        love.graphics.setColor(0, 0, 0, 0.5 * fadeIn)
        love.graphics.rectangle("fill", barX - 1, barY - 1, barW + 2, barH + 2, 2, 2)

        -- Fill color: green -> yellow -> red, flashing red when exhausted
        local r, g, b = 0.2, 0.8, 0.3
        if sprint.isExhausted then
            local flash = 0.6 + 0.4 * math.sin(love.timer.getTime() * 6)
            r, g, b = 0.9, 0.2, 0.2
            r = r * flash
        elseif pct < 0.25 then
            r, g, b = 0.9, 0.3, 0.2
        elseif pct < 0.5 then
            r, g, b = 0.9, 0.7, 0.2
        end
        love.graphics.setColor(r, g, b, 0.85 * fadeIn)
        love.graphics.rectangle("fill", barX, barY, barW * pct, barH, 2, 2)

        -- Label
        love.graphics.setFont(fonts.npc)
        if sprint.isExhausted then
            love.graphics.setColor(1, 0.3, 0.3, 0.9 * fadeIn)
            love.graphics.printf("EXHAUSTED", barX, barY + barH + 2, barW, "center")
        elseif sprint.isSprinting then
            love.graphics.setColor(0.8, 0.8, 0.3, 0.7 * fadeIn)
            love.graphics.printf("SPRINTING", barX, barY + barH + 2, barW, "center")
        end
    end

    -- Base game._raid alert banner
    if ui.baseRaidAlert then
        local alertAge = love.timer.getTime() - (ui.baseRaidAlert.receivedAt or 0)
        local alertDur = (ui.baseRaidAlert.alertDuration or 60000) / 1000
        if alertAge < alertDur + 5 then
            local flash = 0.7 + 0.3 * math.sin(love.timer.getTime() * 6)
            love.graphics.setColor(0.8, 0.1, 0.1, flash * fadeIn * 0.9)
            love.graphics.rectangle("fill", W/2 - 200, 60, 400, 36, 6, 6)
            love.graphics.setColor(1, 1, 1, fadeIn)
            love.graphics.setFont(fonts.ui)
            love.graphics.printf("BASE UNDER ATTACK! Press H for Home Teleport", W/2 - 195, 68, 390, "center")
            local remaining = math.max(0, math.ceil(alertDur - alertAge))
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(1, 0.8, 0.3, fadeIn)
            love.graphics.printf(remaining .. "s until enemies arrive", W/2 - 195, 88, 390, "center")
        end
    end

    -- Controls hint
    love.graphics.setFont(fonts.npc)
    love.graphics.setColor(0.5, 0.5, 0.6, fadeIn * 0.4)
    local sprintHint = overworld.chunkBased and "" or " | Shift:Sprint"
    love.graphics.printf("WASD:Move" .. sprintHint .. " | Enter:Chat | E:Interact | I:Inv | C:Char | K:Cards | M:Map | F:Farm | H:Home", 0, H - 18, W - 10, "right")
end

local function drawWorldSystemsHUD(W, H)
    -- Disease indicators (top-right area, below minimap)
    local diseaseY = 120
    local diseaseCount = 0
    for diseaseId, info in pairs(game._disease.playerDiseases) do
        diseaseCount = diseaseCount + 1
        local stateLabel = "?"
        if info.state == 1 then stateLabel = "Exposed"
        elseif info.state == 2 then stateLabel = "Infected"
        elseif info.state == 3 then stateLabel = "Quarantined"
        elseif info.state == 4 then stateLabel = "Recovering" end

        love.graphics.setColor(0.8, 0.2, 0.2, 0.9)
        love.graphics.printf(diseaseId:gsub("_", " ") .. " [" .. stateLabel .. "]",
            W - 220, diseaseY, 210, "right")
        diseaseY = diseaseY + 16
    end

    -- Disease contraction flash
    if game._disease.contractedFlash > 0 then
        local alpha = math.min(1, game._disease.contractedFlash)
        love.graphics.setColor(0.6, 0.0, 0.0, alpha * 0.3)
        love.graphics.rectangle("fill", 0, 0, W, H)
        love.graphics.setColor(1, 0.2, 0.2, alpha)
        love.graphics.printf(game._disease.contractedName or "Disease Contracted",
            0, H * 0.3, W, "center")
    end

    -- Disease symptom flash
    if game._disease.symptomTimer > 0 and game._disease.symptomMsg then
        local alpha = math.min(1, game._disease.symptomTimer)
        love.graphics.setColor(0.7, 0.1, 0.1, alpha)
        love.graphics.printf(game._disease.symptomMsg, 0, H * 0.4, W, "center")
    end

    -- Faction territory indicator (top-left, below HUD)
    if game._influence.controlling then
        love.graphics.setColor(0.7, 0.7, 0.3, 0.8)
        love.graphics.printf("Territory: " .. game._influence.controlling:gsub("_", " "),
            10, 90, 250, "left")
    end

    -- Ecology indicator
    if game._ecology.name ~= "unknown" then
        love.graphics.setColor(0.3, 0.7, 0.3, 0.6)
        local bonusStr = ""
        if game._ecology.resourceBonus ~= 1.0 then
            bonusStr = " (x" .. string.format("%.1f", game._ecology.resourceBonus) .. ")"
        end
        love.graphics.printf("Ecology: " .. game._ecology.name .. bonusStr,
            10, 106, 250, "left")
    end

    -- Wind direction (subtle)
    if game._weather.wind then
        love.graphics.setColor(0.6, 0.6, 0.8, 0.4)
        love.graphics.printf("Wind: " .. game._weather.wind, W - 120, H - 34, 110, "right")
    end

    love.graphics.setColor(1, 1, 1, 1)
end

local function drawDoomHUD(W, H)
    -- Doom ascension cinematic overlay (full screen, highest priority)
    if doom.showEvent then
        local progress = 1 - (doom.eventTimer / 8.0)
        if progress < 0.3 then
            -- Fade to white
            local a = progress / 0.3
            love.graphics.setColor(1, 1, 1, a)
            love.graphics.rectangle("fill", 0, 0, W, H)
        elseif progress < 0.5 then
            -- White to black
            local a = (progress - 0.3) / 0.2
            love.graphics.setColor(1 - a, 1 - a, 1 - a, 1)
            love.graphics.rectangle("fill", 0, 0, W, H)
        else
            -- Black with narrative text
            love.graphics.setColor(0, 0, 0, 1)
            love.graphics.rectangle("fill", 0, 0, W, H)
            local textAlpha = math.min(1, (progress - 0.5) * 4)
            love.graphics.setColor(0.8, 0.2, 0.2, textAlpha)
            love.graphics.setFont(fonts.header or _G.getFont(22))
            love.graphics.printf(doom.eventMessage or "The world resets.", 40, H / 2 - 30, W - 80, "center")
            love.graphics.setColor(0.5, 0.5, 0.5, textAlpha * 0.6)
            love.graphics.setFont(fonts.ui or _G.getFont(14))
            love.graphics.printf("Doom Ascension #" .. (doom.doomAscensionCount or 1), 40, H / 2 + 20, W - 80, "center")
        end
        return
    end

    -- Capital corruption warning flash
    if doom.flashTimer > 0 then
        local fa = doom.flashTimer / 3.0
        love.graphics.setColor(0.8, 0.1, 0.05, fa * 0.3)
        love.graphics.rectangle("fill", 0, 0, W, H)
        love.graphics.setColor(1, 0.3, 0.2, fa)
        love.graphics.setFont(fonts.header or _G.getFont(22))
        love.graphics.printf("The corruption has breached Solara.", 40, H / 2 - 40, W - 80, "center")
        love.graphics.setColor(0.7, 0.2, 0.15, fa * 0.8)
        love.graphics.setFont(fonts.ui or _G.getFont(14))
        love.graphics.printf("Beneath the Cathedral, Helios stirs in agony.", 40, H / 2, W - 80, "center")
    end

    -- Doom countdown timer (top-center, red pulsing)
    if doom.active and doom.remainingMs > 0 then
        local totalSec = math.floor(doom.remainingMs / 1000)
        local hours = math.floor(totalSec / 3600)
        local minutes = math.floor((totalSec % 3600) / 60)
        local seconds = totalSec % 60
        local timerStr = string.format("DOOM: %02d:%02d:%02d", hours, minutes, seconds)

        -- Pulse speed increases as time decreases (faster when < 1 hour)
        local pulseSpeed = doom.remainingMs < 3600000 and 6.0 or 2.0
        local pulse = 0.7 + 0.3 * math.abs(math.sin(love.timer.getTime() * pulseSpeed))

        -- Color: bright red when < 1 hour, normal red otherwise
        local r, g, b
        if doom.remainingMs < 3600000 then
            r, g, b = 1.0, 0.1, 0.05
        else
            r, g, b = 0.85, 0.15, 0.1
        end

        -- Background bar
        local tw = 260
        local th = 44
        local tx = (W - tw) / 2
        local ty = 8
        love.graphics.setColor(0, 0, 0, 0.7)
        love.graphics.rectangle("fill", tx, ty, tw, th, 6, 6)
        love.graphics.setColor(r * 0.3, 0, 0, 0.5 * pulse)
        love.graphics.rectangle("fill", tx, ty, tw, th, 6, 6)
        love.graphics.setColor(r, g, b, pulse)
        love.graphics.rectangle("line", tx, ty, tw, th, 6, 6)

        -- Timer text
        love.graphics.setFont(fonts.header or _G.getFont(20))
        love.graphics.setColor(r, g, b, pulse)
        love.graphics.printf(timerStr, tx, ty + 3, tw, "center")

        -- Subtitle
        love.graphics.setFont(fonts.npc or _G.getFont(10))
        love.graphics.setColor(0.6, 0.15, 0.1, pulse * 0.8)
        love.graphics.printf("Helios trembles.", tx, ty + 26, tw, "center")

        -- Red vignette when < 1 hour
        if doom.remainingMs < 3600000 then
            local vigAlpha = 0.08 * pulse
            love.graphics.setColor(0.6, 0, 0, vigAlpha)
            love.graphics.rectangle("fill", 0, 0, W, 40)
            love.graphics.rectangle("fill", 0, H - 40, W, 40)
            love.graphics.rectangle("fill", 0, 0, 40, H)
            love.graphics.rectangle("fill", W - 40, 0, 40, H)
        end
    end
end

local function drawChat(W, H)
    local fadeIn = getFadeIn()
    -- No chat in offline/solo mode
    if _G.offlineMode then return end

    local chatW = math.min(400, W * 0.45)
    local chatX = 5

    -- When chat is not active, show only a minimal hint + recent messages fade
    if not chat.active then
        -- Show last few messages briefly after they arrive (fade out)
        local now = love.timer.getTime()
        local recentCount = 0
        for i = #chat.messages, math.max(1, #chat.messages - 3), -1 do
            local msg = chat.messages[i]
            local age = now - (msg._localTime or 0)
            if age < 8 then recentCount = recentCount + 1 end
        end

        if recentCount > 0 then
            local lineH = 18
            local recentH = recentCount * lineH + 8
            local recentY = H - recentH - 30
            love.graphics.setColor(0, 0, 0, 0.25)
            love.graphics.rectangle("fill", chatX, recentY, chatW, recentH, 4, 4)
            love.graphics.setFont(fonts.chat)
            local drawn = 0
            for i = math.max(1, #chat.messages - 3), #chat.messages do
                local msg = chat.messages[i]
                local age = now - (msg._localTime or 0)
                if age < 8 then
                    local alpha = age < 6 and 1.0 or (1.0 - (age - 6) / 2)
                    local ly = recentY + 4 + drawn * lineH
                    local prefixW = 0
                    if msg.chatType == "shout" then
                        love.graphics.setColor(1, 0.8, 0.2, fadeIn * alpha * 0.9)
                        love.graphics.print("[SHOUT] ", chatX + 6, ly)
                        prefixW = fonts.chat:getWidth("[SHOUT] ")
                    end
                    local nr, ng, nb = game.hexToRGB(msg.authorColor or "#CCCCCC")
                    love.graphics.setColor(nr, ng, nb, fadeIn * alpha * 0.9)
                    local nameText = (msg.authorName or "?") .. ": "
                    love.graphics.print(nameText, chatX + 6 + prefixW, ly)
                    local nameW = fonts.chat:getWidth(nameText)
                    love.graphics.setColor(0.9, 0.9, 0.9, fadeIn * alpha * 0.85)
                    love.graphics.print(msg.content or "", chatX + 6 + prefixW + nameW, ly)
                    drawn = drawn + 1
                end
            end
        end

        -- Small hint at bottom-left
        love.graphics.setFont(fonts.small or _G.getFont(10))
        love.graphics.setColor(0.5, 0.5, 0.6, fadeIn * 0.35)
        love.graphics.print("[Enter] Chat", chatX + 4, H - 28)
        return
    end

    -- Full chat UI when active
    local chatH = 200
    local chatY = H - chatH - 25

    -- Chat background
    love.graphics.setColor(0, 0, 0, 0.5)
    love.graphics.rectangle("fill", chatX, chatY, chatW, chatH, 6, 6)
    love.graphics.setColor(0.3, 0.5, 0.8, 0.4)
    love.graphics.rectangle("line", chatX, chatY, chatW, chatH, 6, 6)

    -- Messages
    love.graphics.setFont(fonts.chat)
    local lineH = 18
    local visibleLines = math.floor(chatH / lineH) - 1
    local startIdx = math.max(1, #chat.messages - visibleLines + 1)

    for i = startIdx, #chat.messages do
        local msg = chat.messages[i]
        local lineIdx = i - startIdx
        local ly = chatY + 5 + lineIdx * lineH

        if ly + lineH > chatY + chatH - 25 then break end

        -- Shout prefix
        local prefixW = 0
        if msg.chatType == "shout" then
            love.graphics.setColor(1, 0.8, 0.2, fadeIn * 0.9)
            love.graphics.print("[SHOUT] ", chatX + 8, ly)
            prefixW = fonts.chat:getWidth("[SHOUT] ")
        end

        -- Author name
        local nr, ng, nb = game.hexToRGB(msg.authorColor or "#CCCCCC")
        love.graphics.setColor(nr, ng, nb, fadeIn * 0.9)
        local nameText = (msg.authorName or "?") .. ": "
        love.graphics.print(nameText, chatX + 8 + prefixW, ly)

        -- Message content
        local nameW = fonts.chat:getWidth(nameText)
        local contentAlpha = msg.chatType == "shout" and 1.0 or 0.85
        love.graphics.setColor(0.9, 0.9, 0.9, fadeIn * contentAlpha)
        love.graphics.print(msg.content or "", chatX + 8 + prefixW + nameW, ly)
    end

    -- Chat input bar
    local inputY = chatY + chatH - 24
    love.graphics.setColor(0.1, 0.1, 0.18, 0.9)
    love.graphics.rectangle("fill", chatX, inputY, chatW, 22, 4, 4)
    love.graphics.setColor(0.3, 0.5, 0.8, 0.6)
    love.graphics.rectangle("line", chatX, inputY, chatW, 22, 4, 4)

    -- "CHAT" indicator badge
    love.graphics.setFont(fonts.small)
    local badgeText = "CHAT"
    local badgeW = fonts.small:getWidth(badgeText) + 8
    love.graphics.setColor(0.2, 0.4, 0.7, 0.8)
    love.graphics.rectangle("fill", chatX + chatW - badgeW - 4, inputY - 16, badgeW, 14, 3, 3)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.print(badgeText, chatX + chatW - badgeW, inputY - 15)

    love.graphics.setFont(fonts.chatInput)
    love.graphics.setColor(1, 1, 1, fadeIn)
    love.graphics.print(chat.input .. (math.floor(love.timer.getTime() * 2) % 2 == 0 and "|" or ""), chatX + 6, inputY + 3)
end

function world_draw.init(gameRef, ctx)
    game           = gameRef
    dungeon        = ctx.dungeon
    camera         = ctx.camera
    fonts          = ctx.fonts
    ui             = ctx.ui
    rpg            = ctx.rpg
    players        = ctx.players
    resources      = ctx.resources
    floatingTexts  = ctx.floatingTexts
    world          = ctx.world
    chat           = ctx.chat
    overworld      = ctx.overworld
    tcState        = ctx.tcState
    corruption     = ctx.corruption
    doom           = ctx.doom
    sprint         = ctx.sprint
    getEntityState = ctx.getEntityState
    getZone        = ctx.getZone
    getMyId        = ctx.getMyId
    getFadeIn            = ctx.getFadeIn
    getSkills            = ctx.getSkills
    getAccount           = ctx.getAccount
    getClient            = ctx.getClient
    computeSprintBonuses = ctx.computeSprintBonuses
    -- Register draw functions onto the game table
    gameRef.drawZoneMonsters = drawZoneMonsters
    gameRef.drawCorpsesAndContainers = drawCorpsesAndContainers
    gameRef.drawLootPanel = drawLootPanel
    gameRef.drawLevelUpEffect = drawLevelUpEffect
    gameRef.drawPackReveal = drawPackReveal
    gameRef.drawOnboardingTip = drawOnboardingTip
    gameRef.drawMonsterHitFlash = drawMonsterHitFlash
    gameRef.drawTerrain = drawTerrain
    gameRef.drawGround = drawGround
    gameRef.drawPlots = drawPlots
    gameRef.drawResources = drawResources
    gameRef.drawPlacedObjects = drawPlacedObjects
    gameRef.drawFloatingTexts = drawFloatingTexts
    gameRef.drawMiniRifts = drawMiniRifts
    gameRef.drawLeviathans = drawLeviathans
    gameRef.drawLeviathanHUD = drawLeviathanHUD
    gameRef.drawLeviathanPartBars = drawLeviathanPartBars
    gameRef.drawConnections = drawConnections
    gameRef.drawPlayer = drawPlayer
    gameRef.drawDialoguePanel = drawDialoguePanel
    gameRef.drawWeather = drawWeather
    gameRef.drawSeasonVisual = drawSeasonVisual
    gameRef.drawHUD = drawHUD
    gameRef.drawWorldSystemsHUD = drawWorldSystemsHUD
    gameRef.drawDoomHUD = drawDoomHUD
    gameRef.drawChat = drawChat
end

world_draw.getOtherPlayerAtScreen   = getOtherPlayerAtScreen
world_draw.executeContextMenuAction = executeContextMenuAction

return world_draw
