-- scenes/game-draw/dungeon.lua
-- Dungeon floor, entities, HUD, raid UI, party panels, and context menu draw functions.

local dungeon_draw = {}

-- 'game' alias — all game._xxx references work unchanged
local game

-- Direct table refs (mutated in-place, safe to capture at init time)
local dungeon, camera, fonts, ui, tcState

-- Getters for reassignable module-level locals in game.lua
local getFadeIn, getMyId, getSkills

-- Tile type constants (mirror game.lua DTILE)
local DTILE = {
    WALL = 0, FLOOR = 1, CORRIDOR = 2, DOOR = 3,
    STAIRS_UP = 4, STAIRS_DOWN = 5, ENTRANCE = 6, EXIT = 7,
    CHEST = 8, TRAP = 9, CAMP_SPOT = 10, SHRINE = 11,
    BOSS_DOOR = 12, SHORTCUT = 13, CORPSE = 14,
}

-- Context menu layout constants and base items
local CONTEXT_MENU_ITEM_HEIGHT  = 28
local CONTEXT_MENU_WIDTH        = 160
local CONTEXT_MENU_HEADER_HEIGHT = 26
local CONTEXT_MENU_PADDING      = 4
local CONTEXT_MENU_ITEMS_BASE = {
    { label = "Add Friend",      action = "friend"      },
    { label = "Invite to Party", action = "party"       },
    { label = "Trade",           action = "game._trade" },
    { label = "Duel (PvP)",      action = "duel"        },
    { label = "View Profile",    action = "profile"     },
    { label = "Whisper",         action = "whisper"     },
}

-- Build context menu items, appending Kick if we are party leader and target is in party
local function getContextMenuItems(targetId)
    local myId = getMyId()
    local items = {}
    for _, item in ipairs(CONTEXT_MENU_ITEMS_BASE) do
        table.insert(items, item)
    end
    if game._raid.partyData and game._raid.partyData.leader == myId and targetId then
        local targetInParty = false
        for _, m in ipairs(game._raid.partyData.members) do
            if m.id == targetId then targetInParty = true; break end
        end
        if targetInParty then
            table.insert(items, { label = "Kick from Party", action = "party_kick" })
        end
    end
    return items
end

local function revealFog(tileX, tileY)
    local skills = getSkills()
    -- Server now drives fog of war via dungeon_visibility_update.
    -- This is kept as a minimal fallback for initial entrance reveal
    -- before the first server visibility update arrives.
    local radius = 2
    if skills and skills.dungeon_dwelling and skills.dungeon_dwelling.level >= 5 then
        radius = 3
    end
    for dy = -radius, radius do
        for dx = -radius, radius do
            local fx = tileX + dx
            local fy = tileY + dy
            if fx >= 0 and fy >= 0 and dungeon.fogWidth > 0 and fx < dungeon.fogWidth and fy < (dungeon.fogHeight or 9999) then
                dungeon.fog[fx .. "," .. fy] = true
                local idx = fy * dungeon.fogWidth + fx
                if dungeon.fogState[idx] ~= nil then
                    dungeon.fogState[idx] = 2 -- VISIBLE
                end
            end
        end
    end
end

local function drawDungeonFloor()
    local skills = getSkills()
    if not dungeon.grid then return end
    local ts = 32  -- tile size

    -- Viewport culling: calculate visible tile range from camera
    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()
    local startTileX = math.max(1, math.floor(camera.x / ts))
    local startTileY = math.max(1, math.floor(camera.y / ts))
    local endTileX = math.min(#(dungeon.grid[1] or {}), math.ceil((camera.x + W) / ts) + 1)
    local endTileY = math.min(#dungeon.grid, math.ceil((camera.y + H) / ts) + 1)

    -- Default theme colors
    local wallColor = {0.15, 0.12, 0.18}
    local floorColor = {0.3, 0.28, 0.25}
    local corridorColor = {0.25, 0.22, 0.2}
    local doorColor = {0.5, 0.35, 0.15}
    local stairsUpColor = {0.3, 0.6, 0.3}
    local stairsDownColor = {0.6, 0.3, 0.3}
    local chestColor = {0.8, 0.7, 0.2}
    local trapColor = {0.7, 0.2, 0.2}
    local campColor = {0.6, 0.5, 0.2}
    local shrineColor = {0.4, 0.4, 0.8}
    local bossDoorColor = {0.8, 0.1, 0.1}
    local shortcutColor = {0.3, 0.7, 0.7}

    -- Apply theme color overrides if available (server sends 0-255, LOVE needs 0-1)
    if dungeon.themeColor then
        if dungeon.themeColor.wall then
            wallColor = {(dungeon.themeColor.wall.r or 38) / 255, (dungeon.themeColor.wall.g or 31) / 255, (dungeon.themeColor.wall.b or 46) / 255}
        end
        if dungeon.themeColor.floor then
            floorColor = {(dungeon.themeColor.floor.r or 77) / 255, (dungeon.themeColor.floor.g or 71) / 255, (dungeon.themeColor.floor.b or 64) / 255}
        end
        if dungeon.themeColor.accent then
            corridorColor = {(dungeon.themeColor.accent.r or 64) / 255, (dungeon.themeColor.accent.g or 56) / 255, (dungeon.themeColor.accent.b or 51) / 255}
            doorColor = {(dungeon.themeColor.accent.r or 128) / 255, (dungeon.themeColor.accent.g or 89) / 255, (dungeon.themeColor.accent.b or 38) / 255}
        end
    end

    for y = startTileY, endTileY do
        if not dungeon.grid[y] then break end
        for x = startTileX, endTileX do
            local tile = dungeon.grid[y][x]
            if not tile then break end
            local px = (x - 1) * ts
            local py = (y - 1) * ts
            local fogKey = (x - 1) .. "," .. (y - 1)

            -- Three-state fog check
            local fogIdx = (y - 1) * dungeon.fogWidth + (x - 1)
            local fogVal = dungeon.fogState[fogIdx] or 0
            -- Fallback: if fogState not set, use legacy fog table
            if fogVal == 0 and dungeon.fog[fogKey] then fogVal = 2 end

            if fogVal >= 1 then
                -- Revealed or remembered tile (darkness now handled by lighting canvas)
                if tile == DTILE.WALL then
                    -- Base wall color
                    love.graphics.setColor(wallColor[1], wallColor[2], wallColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    -- Brick/stone pattern for visibility
                    love.graphics.setColor(wallColor[1] * 0.7, wallColor[2] * 0.7, wallColor[3] * 0.7)
                    love.graphics.rectangle("line", px, py, ts, ts)
                    -- Highlight top-left edges (raised look)
                    love.graphics.setColor(wallColor[1] * 1.3, wallColor[2] * 1.3, wallColor[3] * 1.3, 0.4)
                    love.graphics.line(px, py + ts, px, py)
                    love.graphics.line(px, py, px + ts, py)
                    -- Shadow bottom-right edges
                    love.graphics.setColor(0, 0, 0, 0.3)
                    love.graphics.line(px + ts, py, px + ts, py + ts)
                    love.graphics.line(px, py + ts, px + ts, py + ts)
                elseif tile == DTILE.FLOOR then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    -- Subtle floor grid for depth
                    love.graphics.setColor(floorColor[1] * 0.85, floorColor[2] * 0.85, floorColor[3] * 0.85, 0.3)
                    love.graphics.rectangle("line", px, py, ts, ts)
                elseif tile == DTILE.CORRIDOR then
                    love.graphics.setColor(corridorColor[1], corridorColor[2], corridorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    -- Subtle corridor grid
                    love.graphics.setColor(corridorColor[1] * 0.85, corridorColor[2] * 0.85, corridorColor[3] * 0.85, 0.3)
                    love.graphics.rectangle("line", px, py, ts, ts)
                elseif tile == DTILE.DOOR then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(doorColor[1], doorColor[2], doorColor[3])
                    love.graphics.rectangle("fill", px + 4, py + 2, ts - 8, ts - 4, 2, 2)
                elseif tile == DTILE.STAIRS_UP then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(stairsUpColor[1], stairsUpColor[2], stairsUpColor[3])
                    love.graphics.polygon("fill", px + ts/2, py + 4, px + 4, py + ts - 4, px + ts - 4, py + ts - 4)
                elseif tile == DTILE.STAIRS_DOWN then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(stairsDownColor[1], stairsDownColor[2], stairsDownColor[3])
                    love.graphics.polygon("fill", px + 4, py + 4, px + ts - 4, py + 4, px + ts/2, py + ts - 4)
                elseif tile == DTILE.CHEST then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(chestColor[1], chestColor[2], chestColor[3])
                    love.graphics.rectangle("fill", px + 6, py + 8, ts - 12, ts - 14, 2, 2)
                elseif tile == DTILE.TRAP then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    -- Only show trap if triggered or player has trap detection
                    local showTrap = false
                    for _, t in ipairs(dungeon.traps) do
                        if t.x == x - 1 and t.y == y - 1 and t.triggered then showTrap = true; break end
                    end
                    if not showTrap and skills and skills.dungeon_dwelling and skills.dungeon_dwelling.level >= 5 then
                        showTrap = true
                    end
                    if showTrap then
                        love.graphics.setColor(trapColor[1], trapColor[2], trapColor[3], 0.5)
                        love.graphics.rectangle("fill", px + 4, py + 4, ts - 8, ts - 8)
                    end
                elseif tile == DTILE.CAMP_SPOT then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(campColor[1], campColor[2], campColor[3], 0.3)
                    love.graphics.circle("fill", px + ts/2, py + ts/2, 4)
                elseif tile == DTILE.SHRINE then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(shrineColor[1], shrineColor[2], shrineColor[3])
                    love.graphics.circle("fill", px + ts/2, py + ts/2, 6)
                elseif tile == DTILE.BOSS_DOOR then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(bossDoorColor[1], bossDoorColor[2], bossDoorColor[3])
                    love.graphics.rectangle("fill", px + 2, py + 2, ts - 4, ts - 4, 3, 3)
                    love.graphics.setColor(1, 0.8, 0.1)
                    love.graphics.circle("fill", px + ts/2, py + ts/2, 4)
                elseif tile == DTILE.SHORTCUT then
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    love.graphics.setColor(shortcutColor[1], shortcutColor[2], shortcutColor[3])
                    love.graphics.circle("line", px + ts/2, py + ts/2, 8)
                elseif tile == DTILE.CORPSE then
                    -- Floor base
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                    -- Bone-white skull + crossbones shape
                    love.graphics.setColor(0.7, 0.65, 0.55, 0.8)
                    love.graphics.circle("fill", px + ts/2, py + ts/2 - 2, 5)
                    love.graphics.rectangle("fill", px + ts/2 - 6, py + ts/2 + 3, 12, 3)
                else
                    -- Unknown/entrance/exit — render as floor
                    love.graphics.setColor(floorColor[1], floorColor[2], floorColor[3])
                    love.graphics.rectangle("fill", px, py, ts, ts)
                end

                -- Apply remembered dimming overlay (darken remembered tiles)
                if fogVal == 1 then
                    love.graphics.setColor(0, 0, 0, 0.75)
                    love.graphics.rectangle("fill", px, py, ts, ts)
                end

                -- Subtle grid lines in turn-based mode
                if dungeon.turnBasedMode and fogVal >= 2 then
                    love.graphics.setColor(1, 1, 1, 0.08)
                    love.graphics.rectangle("line", px, py, ts, ts)
                end
            else
                -- Unrevealed tile (fog of war) — black
                love.graphics.setColor(0.03, 0.03, 0.05)
                love.graphics.rectangle("fill", px, py, ts, ts)
            end
        end
    end
end

local function drawDungeonEntities()
    local ts = 32

    -- Draw camps
    for _, camp in ipairs(dungeon.camps) do
        local cx = camp.x * ts + ts/2
        local cy = camp.y * ts + ts/2
        local fogKey = camp.x .. "," .. camp.y
        if dungeon.fog[fogKey] then
            -- Campfire
            if camp.campfire then
                love.graphics.setColor(1, 0.6, 0.1, 0.8)
            else
                love.graphics.setColor(0.5, 0.4, 0.2, 0.6)
            end
            love.graphics.circle("fill", cx, cy, 6)
            -- Owner name
            love.graphics.setFont(fonts.small)
            love.graphics.setColor(0.8, 0.7, 0.5, 0.7)
            love.graphics.printf(camp.ownerName or "Camp", cx - 30, cy + 10, 60, "center")
        end
    end

    -- Draw chests
    for _, chest in ipairs(dungeon.chests) do
        local cx = chest.x * ts
        local cy = chest.y * ts
        local fogKey = chest.x .. "," .. chest.y
        if dungeon.fog[fogKey] then
            if chest.opened then
                love.graphics.setColor(0.4, 0.35, 0.15, 0.5)
            else
                love.graphics.setColor(0.9, 0.75, 0.2, 0.9)
            end
            love.graphics.rectangle("fill", cx + 8, cy + 10, 16, 12, 2, 2)
            if not chest.opened then
                love.graphics.setColor(0.7, 0.5, 0.1)
                love.graphics.rectangle("fill", cx + 12, cy + 14, 8, 4, 1, 1)
            end
        end
    end

    -- Draw NPCs
    for i, npc in ipairs(dungeon.npcs) do
        if not npc.claimed then
            local nx = npc.x * ts + ts/2
            local ny = npc.y * ts + ts/2
            local fogKey = npc.x .. "," .. npc.y
            if dungeon.fog[fogKey] then
                love.graphics.setColor(0.3, 0.7, 1, 0.9)
                love.graphics.circle("fill", nx, ny, 8)
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.5, 0.8, 1, 0.8)
                love.graphics.printf(npc.type or "NPC", nx - 30, ny - 18, 60, "center")
            end
        end
    end

    -- Draw corpses
    for _, cr in ipairs(dungeon.corpses) do
        local crx = cr.x * ts
        local cry = cr.y * ts
        local fogKey = cr.x .. "," .. cr.y
        if dungeon.fog[fogKey] then
            if cr.examined then
                -- Dimmed out
                love.graphics.setColor(0.4, 0.35, 0.3, 0.4)
            else
                -- Brighter bone with subtle glow
                love.graphics.setColor(0.8, 0.75, 0.6, 0.9)
            end
            -- Skull shape
            love.graphics.circle("fill", crx + ts/2, cry + ts/2 - 2, 6)
            -- Crossbones
            love.graphics.rectangle("fill", crx + ts/2 - 7, cry + ts/2 + 4, 14, 2)
            if not cr.examined then
                -- Glow effect for unexamined
                love.graphics.setColor(0.9, 0.85, 0.6, 0.2 + math.sin(love.timer.getTime() * 3) * 0.1)
                love.graphics.circle("fill", crx + ts/2, cry + ts/2, 10)
            end
        end
    end

    -- Draw placed torches
    for _, torch in ipairs(dungeon.placedTorches) do
        local tx = torch.x * ts + ts/2
        local ty = torch.y * ts + ts/2
        local tFogIdx = torch.y * dungeon.fogWidth + torch.x
        local tFogVal = dungeon.fogState[tFogIdx] or 0
        if tFogVal >= 1 then
            -- Torch base
            love.graphics.setColor(0.5, 0.35, 0.1, 0.9)
            love.graphics.rectangle("fill", tx - 2, ty - 6, 4, 12)
            -- Flame glow (pulsing)
            local pulse = math.sin(love.timer.getTime() * 6) * 0.15 + 0.85
            love.graphics.setColor(1, 0.7, 0.1, pulse * 0.6)
            love.graphics.circle("fill", tx, ty - 8, 5)
            love.graphics.setColor(1, 0.5, 0.0, pulse * 0.3)
            love.graphics.circle("fill", tx, ty - 8, 10)
        end
    end

    -- Draw thermal vision blips (through-wall heat signatures)
    if dungeon.visionType == "thermal" and dungeon.thermalEntities then
        local time = love.timer.getTime()
        for _, ent in ipairs(dungeon.thermalEntities) do
            local hx = ent.x * ts + ts/2
            local hy = ent.y * ts + ts/2
            local pulse = math.sin(time * 4) * 0.3 + 0.7
            if ent.type == "enemy" then
                love.graphics.setColor(1, 0.3, 0.1, pulse * 0.6)
            else
                love.graphics.setColor(1, 0.6, 0.2, pulse * 0.4)
            end
            love.graphics.circle("fill", hx, hy, 6 + math.sin(time * 3) * 2)
            love.graphics.setColor(1, 0.2, 0.0, pulse * 0.2)
            love.graphics.circle("fill", hx, hy, 10 + math.sin(time * 2) * 3)
        end
    end

    -- Draw tremor sense indicators (expanding ripple waves with type-specific visuals)
    if dungeon.tremorIndicators then
        local time = love.timer.getTime()
        for _, ind in ipairs(dungeon.tremorIndicators) do
            local rx = ind.x * ts + ts/2
            local ry = ind.y * ts + ts/2
            local intensity = ind.intensity or 0.5
            local rippleSpeed = ind.moving and 2.5 or 1.5
            local ripplePhase = (time * rippleSpeed) % 1
            local rippleRadius = ripplePhase * 16 * intensity
            local rippleAlpha = (1 - ripplePhase) * 0.5 * intensity

            if ind.type == "boss" then
                -- Boss: large red pulsing rings
                love.graphics.setColor(1, 0.2, 0.2, rippleAlpha)
                rippleRadius = ripplePhase * 24
            elseif ind.type == "trap" then
                -- Trap: sharp yellow warning pulses
                love.graphics.setColor(1, 1, 0.2, rippleAlpha * 1.2)
            elseif ind.type == "machine" then
                -- Machine/construct: steady orange-copper hum rings
                local mechPulse = math.sin(time * 6) * 0.15 + 0.5
                love.graphics.setColor(0.9, 0.6, 0.2, mechPulse * intensity)
                -- Draw gear-like indicator (diamond shape)
                love.graphics.polygon("line",
                    rx, ry - 8,
                    rx + 8, ry,
                    rx, ry + 8,
                    rx - 8, ry)
            elseif ind.type == "chest" then
                -- Chest/container: faint teal click-click pulses
                love.graphics.setColor(0.3, 0.8, 0.7, rippleAlpha * 0.8)
            elseif ind.type == "shrine" then
                -- Shrine/energy source: soft white glow hum
                local shrPulse = math.sin(time * 3) * 0.2 + 0.4
                love.graphics.setColor(0.9, 0.9, 1.0, shrPulse * intensity)
            elseif ind.type == "door" then
                -- Door: rectangular amber pulse
                love.graphics.setColor(0.8, 0.7, 0.3, rippleAlpha)
                love.graphics.rectangle("line", rx - 6, ry - 8, 12, 16)
            elseif ind.type == "player" then
                -- Other player: blue-green footstep ripples
                love.graphics.setColor(0.3, 0.7, 0.9, rippleAlpha)
            else
                -- Enemy movement: standard gray-blue ripples
                love.graphics.setColor(0.6, 0.6, 0.8, rippleAlpha)
            end

            -- Draw ripple rings (skip for door/machine which use custom shapes)
            if ind.type ~= "door" and ind.type ~= "machine" then
                love.graphics.setLineWidth(2)
                love.graphics.circle("line", rx, ry, rippleRadius)
                if ind.moving then
                    -- Moving entities get a second inner ring
                    love.graphics.circle("line", rx, ry, rippleRadius * 0.5)
                end
                love.graphics.setLineWidth(1)
            elseif ind.type == "machine" then
                -- Machine gets concentric vibration rings
                love.graphics.setLineWidth(1)
                local mRing = (time * 4) % 1
                love.graphics.circle("line", rx, ry, mRing * 12)
            end

            -- Draw label text for non-enemy types when close
            if ind.label and ind.type ~= "enemy" then
                local playerDist = math.sqrt((ind.x - (dungeon.playerX or 0))^2 + (ind.y - (dungeon.playerY or 0))^2)
                if playerDist <= 5 then
                    love.graphics.setColor(0.8, 0.8, 0.6, 0.6 * intensity)
                    local font = love.graphics.getFont()
                    local labelW = font:getWidth(ind.label)
                    love.graphics.print(ind.label, rx - labelW/2, ry + 10)
                end
            end
        end
    end

    -- Draw enemies (server-filtered: only visible enemies sent)
    for i, enemy in ipairs(dungeon.enemies) do
        if enemy.alive ~= false then
            -- Interpolate movement (real-time mode)
            local drawX, drawY = enemy.x, enemy.y
            if enemy.moveTimer and enemy.moveTimer > 0 and enemy.prevX then
                local t = enemy.moveTimer / 0.15
                drawX = enemy.x + (enemy.prevX - enemy.x) * t
                drawY = enemy.y + (enemy.prevY - enemy.y) * t
            end
            -- Turn-based mode: smooth lerp from old to new position
            if enemy.lerpTimer and enemy.lerpTimer > 0 and enemy.lerpFromX then
                local t = enemy.lerpTimer / 0.25
                drawX = enemy.x + (enemy.lerpFromX - enemy.x) * t
                drawY = enemy.y + (enemy.lerpFromY - enemy.y) * t
            end
            local ex = drawX * ts + ts/2
            local ey = drawY * ts + ts/2
            -- Enemies are server-filtered so always draw if in the list
            if true then
                local aiState = enemy.aiState or "idle"
                local archetype = enemy.archetype or "bruiser"
                local radius = enemy.isBoss and 12 or 7

                -- Archetype-based body color
                if archetype == "bruiser" then
                    love.graphics.setColor(0.8, 0.25, 0.2, 0.9)
                elseif archetype == "skirmisher" then
                    love.graphics.setColor(0.9, 0.6, 0.1, 0.9)
                elseif archetype == "ranged" then
                    love.graphics.setColor(0.4, 0.7, 0.2, 0.9)
                elseif archetype == "controller" then
                    love.graphics.setColor(0.5, 0.3, 0.9, 0.9)
                elseif archetype == "support" then
                    love.graphics.setColor(0.2, 0.8, 0.7, 0.9)
                elseif archetype == "elite" then
                    love.graphics.setColor(1, 0.85, 0.1, 0.9)
                else
                    love.graphics.setColor(0.6, 0.3, 0.3, 0.9)
                end

                -- Attack flash (red pulse)
                if enemy.attackFlashTimer and enemy.attackFlashTimer > 0 then
                    love.graphics.setColor(1, 0.1, 0.1, 0.95)
                end

                -- Draw body
                love.graphics.circle("fill", ex, ey, radius)

                -- Wind-up telegraph: pulsing ring around enemy when attacking
                if enemy.isAttacking then
                    local pulse = math.sin(love.timer.getTime() * 12) * 0.3 + 0.7
                    love.graphics.setColor(1, 0.2, 0.2, pulse)
                    love.graphics.setLineWidth(2)
                    love.graphics.circle("line", ex, ey, radius + 4 + math.sin(love.timer.getTime() * 8) * 2)
                    love.graphics.setLineWidth(1)
                end

                -- Facing indicator (small triangle)
                local facing = enemy.facing or "down"
                love.graphics.setColor(1, 1, 1, 0.6)
                local fx, fy = 0, 0
                if facing == "right" then fx, fy = radius + 3, 0
                elseif facing == "left" then fx, fy = -(radius + 3), 0
                elseif facing == "up" then fx, fy = 0, -(radius + 3)
                else fx, fy = 0, radius + 3 end
                love.graphics.circle("fill", ex + fx, ey + fy, 2)

                -- AI state indicator (small icon above)
                if aiState == "alert" or aiState == "evaluate" then
                    love.graphics.setColor(1, 1, 0, 0.9)
                    love.graphics.print("!", ex - 3, ey - radius - 22)
                elseif aiState == "position" or aiState == "attack" or aiState == "recover" or aiState == "reposition" then
                    love.graphics.setColor(1, 0.2, 0.2, 0.9)
                    love.graphics.setFont(fonts.small)
                    love.graphics.print("!", ex - 3, ey - radius - 22)
                elseif aiState == "reset" then
                    love.graphics.setColor(1, 0.6, 0, 0.7)
                    love.graphics.print("?", ex - 3, ey - radius - 22)
                end

                -- Name
                love.graphics.setFont(fonts.small)
                local nameColor = enemy.isBoss and {1, 0.85, 0.2, 0.9} or {1, 0.8, 0.8, 0.8}
                love.graphics.setColor(unpack(nameColor))
                love.graphics.printf(enemy.name or "Enemy", ex - 40, ey - radius - 14, 80, "center")

                -- HP bar
                if enemy.hp and enemy.maxHp and enemy.maxHp > 0 then
                    local barW = enemy.isBoss and 36 or 24
                    local barH = enemy.isBoss and 4 or 3
                    local barX = ex - barW/2
                    local barY = ey + radius + 2
                    local ratio = math.max(0, enemy.hp / enemy.maxHp)
                    love.graphics.setColor(0.2, 0, 0, 0.7)
                    love.graphics.rectangle("fill", barX, barY, barW, barH)
                    love.graphics.setColor(1 - ratio, ratio, 0, 0.9)
                    love.graphics.rectangle("fill", barX, barY, barW * ratio, barH)
                end
            end
        end
    end

    -- Echolocation sonar ring (kept as distinct world-space mechanic)
    if dungeon.visionType == "echolocation" then
        local time = love.timer.getTime()
        local pulsePhase = (time * 0.5) % 1
        local px = dungeon.playerTileX or 0
        local py = dungeon.playerTileY or 0
        local ringRadius = pulsePhase * 8 * ts
        local ringAlpha = 1 - pulsePhase
        love.graphics.setColor(0.3, 0.6, 1, ringAlpha * 0.4)
        love.graphics.setLineWidth(2)
        love.graphics.circle("line", px * ts + ts / 2, py * ts + ts / 2, ringRadius)
        love.graphics.setLineWidth(1)
    end

    -- True Seeing golden pulsing outline circles around visible enemies
    if dungeon.visionType == "true_seeing" and dungeon.enemies then
        local time = love.timer.getTime()
        local pulse = math.sin(time * 3) * 0.15 + 0.55
        love.graphics.setColor(1, 0.85, 0.2, pulse)
        love.graphics.setLineWidth(2)
        for _, enemy in ipairs(dungeon.enemies) do
            if enemy.alive ~= false then
                local ex = (enemy.x or 0) * ts + ts / 2
                local ey = (enemy.y or 0) * ts + ts / 2
                love.graphics.circle("line", ex, ey, 14)
            end
        end
        love.graphics.setLineWidth(1)
    end

    -- Draw magic auras (visible when magic_sense or true_seeing is active)
    if dungeon.magicAuras and (dungeon.visionType == "magic_sense" or dungeon.visionType == "true_seeing") then
        local time = love.timer.getTime()
        local auraColors = {
            cursed = {0.8, 0, 0.2},
            enchanted = {0.3, 0.5, 1},
            blessed = {1, 0.9, 0.3},
            corrupted = {0.4, 0, 0.5},
            haunted = {0.6, 0.8, 1},
            invisible = {0.9, 0.9, 0.9},
        }
        for _, aura in ipairs(dungeon.magicAuras) do
            local color = auraColors[aura.type] or {1, 1, 1}
            local pulse = math.sin(time * 2 + (aura.x or 0) * 0.5) * 0.2 + 0.5
            local intensity = aura.intensity or 0.5
            love.graphics.setColor(color[1], color[2], color[3], pulse * intensity)
            love.graphics.circle("fill", ((aura.x or 0) - 0.5) * ts, ((aura.y or 0) - 0.5) * ts, ts * 0.6)
        end
    end

    -- Draw downed player indicators (permadeath)
    if next(permadeath.downedPlayers) then
        local time = love.timer.getTime()
        for sid, dp in pairs(permadeath.downedPlayers) do
            local dx = dp.x * ts + ts/2
            local dy = dp.y * ts + ts/2
            local pulse = 0.5 + 0.5 * math.sin(time * 4)
            -- Red cross marker
            love.graphics.setColor(1, 0.2, 0.2, pulse)
            love.graphics.setLineWidth(3)
            love.graphics.line(dx - 8, dy - 8, dx + 8, dy + 8)
            love.graphics.line(dx - 8, dy + 8, dx + 8, dy - 8)
            love.graphics.setLineWidth(1)
            -- Name label
            love.graphics.setFont(fonts.chat or fonts.main)
            love.graphics.setColor(1, 0.3, 0.3, 0.9)
            love.graphics.printf(dp.name .. " (DOWNED)", dx - 60, dy - 22, 120, "center")
        end
    end
end

-- Vision bar config
local VISION_BAR = {
    { id = "normal",       abbr = "NM", color = {0.5, 0.5, 0.5} },
    { id = "thermal",      abbr = "TH", color = {1.0, 0.5, 0.1} },
    { id = "night",        abbr = "NV", color = {0.2, 1.0, 0.3} },
    { id = "tremor",       abbr = "TR", color = {0.8, 0.6, 0.2} },
    { id = "echolocation", abbr = "EC", color = {0.3, 0.6, 1.0} },
    { id = "magic_sense",  abbr = "MS", color = {0.5, 0.1, 0.8} },
    { id = "true_seeing",  abbr = "TS", color = {1.0, 0.85, 0.2} },
}

local VISION_MANA_COSTS = {
    normal = 0, thermal = 2, night = 1, tremor = 1,
    echolocation = 3, magic_sense = 2, true_seeing = 4,
}

local VISION_DESCRIPTIONS = {
    normal       = "Standard vision",
    thermal      = "See heat signatures through walls",
    night        = "See clearly in darkness",
    tremor       = "Detect ground vibrations",
    echolocation = "Sonar pulses reveal all entities",
    magic_sense  = "Perceive magical auras",
    true_seeing  = "See through all illusions",
}

local function drawVisionBar(W)
    local available = dungeon.availableVisions or {"normal"}
    local current = dungeon.visionType or "normal"
    local slotW, slotH = 54, 28
    local spacing = 3
    local totalW = #available * (slotW + spacing) - spacing
    local barX = W - totalW - 12
    local barY = 10

    for i, visionId in ipairs(available) do
        local cfg = nil
        for _, v in ipairs(VISION_BAR) do
            if v.id == visionId then cfg = v; break end
        end
        if not cfg then cfg = { id = visionId, abbr = visionId:sub(1,2):upper(), color = {0.5,0.5,0.5} } end

        local sx = barX + (i - 1) * (slotW + spacing)
        local isActive = (visionId == current)
        local isHovered = (game._visionHoveredSlot == i)

        -- Background
        if isActive then
            love.graphics.setColor(cfg.color[1] * 0.3, cfg.color[2] * 0.3, cfg.color[3] * 0.3, 0.9)
        else
            love.graphics.setColor(0.08, 0.08, 0.12, 0.8)
        end
        love.graphics.rectangle("fill", sx, barY, slotW, slotH, 3, 3)

        -- Border
        if isActive then
            local pulse = math.sin(love.timer.getTime() * 3) * 0.15 + 0.85
            love.graphics.setColor(cfg.color[1], cfg.color[2], cfg.color[3], pulse)
            love.graphics.setLineWidth(2)
            love.graphics.rectangle("line", sx, barY, slotW, slotH, 3, 3)
            love.graphics.setLineWidth(1)
        elseif isHovered then
            love.graphics.setColor(cfg.color[1], cfg.color[2], cfg.color[3], 0.6)
            love.graphics.rectangle("line", sx, barY, slotW, slotH, 3, 3)
        else
            love.graphics.setColor(0.3, 0.3, 0.4, 0.5)
            love.graphics.rectangle("line", sx, barY, slotW, slotH, 3, 3)
        end

        -- Abbreviation text
        love.graphics.setFont(fonts.small)
        if isActive then
            love.graphics.setColor(cfg.color[1], cfg.color[2], cfg.color[3], 1)
        else
            love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
        end
        love.graphics.printf(cfg.abbr, sx, barY + 3, slotW, "center")

        -- Mana cost (bottom-right, small)
        local manaCost = VISION_MANA_COSTS[visionId] or 0
        if manaCost > 0 then
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.3, 0.6, 1, 0.7)
            love.graphics.print(tostring(manaCost), sx + slotW - 10, barY + slotH - 10)
        end
    end

    -- Store bar geometry for click/hover detection
    game._visionBarRect = { x = barX, y = barY, slotW = slotW, slotH = slotH, spacing = spacing, count = #available }

    -- Tooltip on hover
    if game._visionHoveredSlot then
        local idx = game._visionHoveredSlot
        local visionId = available[idx]
        if visionId then
            local cfg = nil
            for _, v in ipairs(VISION_BAR) do
                if v.id == visionId then cfg = v; break end
            end
            if not cfg then cfg = { id = visionId, abbr = visionId:sub(1,2):upper(), color = {0.5,0.5,0.5} } end

            local tipX = barX + (idx - 1) * (slotW + spacing)
            local tipY = barY + slotH + 4
            local tipW = 200
            local name = visionId:gsub("_", " "):gsub("^%l", string.upper)
            local desc = VISION_DESCRIPTIONS[visionId] or ""
            local manaCost = VISION_MANA_COSTS[visionId] or 0
            local tipH = 44 + (manaCost > 0 and 14 or 0)

            -- Clamp tooltip to screen
            if tipX + tipW > W - 4 then tipX = W - tipW - 4 end

            love.graphics.setColor(0.06, 0.06, 0.10, 0.92)
            love.graphics.rectangle("fill", tipX, tipY, tipW, tipH, 4, 4)
            love.graphics.setColor(cfg.color[1], cfg.color[2], cfg.color[3], 0.6)
            love.graphics.rectangle("line", tipX, tipY, tipW, tipH, 4, 4)

            love.graphics.setFont(fonts.small)
            love.graphics.setColor(cfg.color[1], cfg.color[2], cfg.color[3], 1)
            love.graphics.print(name, tipX + 6, tipY + 4)

            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.7, 0.7, 0.8, 0.9)
            love.graphics.print(desc, tipX + 6, tipY + 20)

            if manaCost > 0 then
                love.graphics.setColor(0.3, 0.6, 1, 0.8)
                love.graphics.print("Mana/turn: " .. manaCost, tipX + 6, tipY + 34)
            end
        end
    end
end

local function drawDungeonHUD(W, H)
    -- Hit flash overlay (red vignette when taking damage)
    if dungeon.hitFlashTimer and dungeon.hitFlashTimer > 0 then
        local a = dungeon.hitFlashTimer / 0.2 * 0.3
        love.graphics.setColor(1, 0, 0, a)
        love.graphics.rectangle("fill", 0, 0, W, H)
    end

    -- Boss phase flash (purple pulse)
    if dungeon.bossPhaseFlash and dungeon.bossPhaseFlash > 0 then
        local a = dungeon.bossPhaseFlash / 0.5 * 0.25
        love.graphics.setColor(0.6, 0, 0.8, a)
        love.graphics.rectangle("fill", 0, 0, W, H)
    end

    -- Top bar: floor info
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", 0, 0, W, 36)

    love.graphics.setFont(fonts.hud)

    -- Dungeon name + floor
    local dungeonName = "The Rift"
    if dungeon.id and dungeon.id ~= "rift" then
        dungeonName = dungeon.id:gsub("cave_", "Cave "):gsub("_", ", ")
    end
    love.graphics.setColor(0.9, 0.8, 1, 0.9)
    love.graphics.print(dungeonName .. "  |  Floor " .. dungeon.floorNum, 10, 8)

    -- Theme
    if dungeon.theme then
        local themeName = dungeon.theme:gsub("_", " "):gsub("(%a)([%w_']*)", function(a, b) return a:upper()..b end)
        love.graphics.setColor(0.6, 0.5, 0.8, 0.7)
        love.graphics.print(themeName, 300, 8)
    end

    -- Boss floor indicator
    if dungeon.floor and dungeon.floor.isBossFloor then
        love.graphics.setColor(1, 0.2, 0.2, 0.9)
        love.graphics.print("BOSS FLOOR", W - 120, 8)
    end

    -- Turn-based mode: initiative bar + action hints (BG3 style)
    if dungeon.turnBasedMode then
        -- Initiative bar across top
        local ini = dungeon.turnModeInitiative or {}
        if #ini > 0 then
            local portSize = 28
            local spacing = 6
            local totalW = #ini * (portSize + spacing)
            local startX = math.floor((W - totalW) / 2)
            local portY = 4

            for idx, entry in ipairs(ini) do
                local ix = startX + (idx - 1) * (portSize + spacing)
                local isPlayer = (entry.type == "player")

                -- Portrait background
                love.graphics.setColor(0.1, 0.1, 0.15, 0.9)
                love.graphics.rectangle("fill", ix, portY, portSize, portSize, 3, 3)

                -- Border: gold if active, blue for player, red for enemy
                if entry.isActive then
                    local pulse = 0.7 + math.sin(love.timer.getTime() * 4) * 0.3
                    love.graphics.setColor(1, 0.85, 0, pulse)
                    love.graphics.setLineWidth(2)
                elseif isPlayer then
                    love.graphics.setColor(0.3, 0.5, 1, 0.9)
                    love.graphics.setLineWidth(1)
                else
                    love.graphics.setColor(0.9, 0.2, 0.2, 0.9)
                    love.graphics.setLineWidth(1)
                end
                love.graphics.rectangle("line", ix, portY, portSize, portSize, 3, 3)
                love.graphics.setLineWidth(1)

                -- Unit initial letter
                local initial = ((entry.name or "?"):sub(1, 1)):upper()
                love.graphics.setFont(fonts.hud)
                if isPlayer then
                    love.graphics.setColor(0.9, 0.9, 1, 0.9)
                else
                    love.graphics.setColor(1, 0.7, 0.7, 0.9)
                end
                local tw = fonts.hud:getWidth(initial)
                love.graphics.print(initial, ix + math.floor((portSize - tw) / 2), portY + math.floor((portSize - fonts.hud:getHeight()) / 2))

                -- CT bar under portrait
                local ctBarY = portY + portSize + 1
                love.graphics.setColor(0.2, 0.2, 0.3, 0.8)
                love.graphics.rectangle("fill", ix, ctBarY, portSize, 2)
                local ctVal = math.max(0, math.min(entry.ct or 0, 100))
                if ctVal > 0 then
                    if entry.isActive then
                        love.graphics.setColor(1, 0.85, 0, 0.9)
                    elseif isPlayer then
                        love.graphics.setColor(0.3, 0.6, 1, 0.9)
                    else
                        love.graphics.setColor(0.8, 0.3, 0.3, 0.9)
                    end
                    love.graphics.rectangle("fill", ix, ctBarY, portSize * (ctVal / 100), 2)
                end
            end
        end

        -- Action hints bar (below initiative)
        if dungeon.turnModeMyTurn then
            love.graphics.setColor(0.2, 1, 0.3, 0.9)
            love.graphics.setFont(fonts.small)
            local dashText = dungeon.turnModeDashed and "  (Dashed)" or "  [X] Dash"
            love.graphics.print("YOUR TURN  |  Moves: " .. dungeon.turnModeMovesRemaining .. dashText .. "  |  [Enter] End Turn", W / 2 - 140, 38)
        else
            love.graphics.setColor(0.8, 0.6, 0.2, 0.7)
            love.graphics.setFont(fonts.small)
            love.graphics.print("Waiting...", W / 2 - 30, 38)
        end
    end

    -- Pitch Black floor warning
    if dungeon.isPitchBlack then
        local pbPulse = math.sin(love.timer.getTime() * 3) * 0.15 + 0.85
        love.graphics.setColor(0.6, 0, 0.8, pbPulse)
        love.graphics.setFont(fonts.small)
        love.graphics.print("PITCH BLACK", W / 2 - 40, 10)
    end

    -- Vision selector bar (clickable, color-coded slots)
    drawVisionBar(W)

    -- Torch/Lantern timer
    if dungeon.hasTorch or dungeon.hasLantern then
        local lightLabel = dungeon.hasLantern and "Lantern" or "Torch"
        local lightColor = dungeon.hasLantern and {1, 0.9, 0.5, 0.9} or {1, 0.6, 0.1, 0.9}
        love.graphics.setColor(lightColor[1], lightColor[2], lightColor[3], lightColor[4])
        love.graphics.print(lightLabel .. " Active", W - 220, 22)
    end

    -- HP / Mana / Stamina bars (left side, below top bar)
    local barX = 10
    local barY = 42
    local barW = 160
    local barH = 12
    local barSpacing = 16

    -- HP bar (red)
    local hp = dungeon.playerHp or 100
    local maxHp = dungeon.playerMaxHp or 100
    local hpRatio = maxHp > 0 and (hp / maxHp) or 0
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", barX - 1, barY - 1, barW + 2, barH + 2)
    love.graphics.setColor(0.6, 0, 0, 0.8)
    love.graphics.rectangle("fill", barX, barY, barW, barH)
    love.graphics.setColor(0.2 + 0.8 * (1 - hpRatio), 0.8 * hpRatio, 0, 0.9)
    love.graphics.rectangle("fill", barX, barY, barW * hpRatio, barH)
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf(math.floor(hp) .. " / " .. math.floor(maxHp), barX, barY, barW, "center")

    -- Mana bar (blue)
    barY = barY + barSpacing
    local mana = dungeon.playerMana or 50
    local maxMana = dungeon.playerMaxMana or 50
    local manaRatio = maxMana > 0 and (mana / maxMana) or 0
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", barX - 1, barY - 1, barW + 2, barH + 2)
    love.graphics.setColor(0, 0, 0.5, 0.8)
    love.graphics.rectangle("fill", barX, barY, barW, barH)
    love.graphics.setColor(0.2, 0.4, 0.9, 0.9)
    love.graphics.rectangle("fill", barX, barY, barW * manaRatio, barH)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf(math.floor(mana) .. " / " .. math.floor(maxMana), barX, barY, barW, "center")

    -- Stamina bar (green)
    barY = barY + barSpacing
    local stam = dungeon.playerStamina or 100
    local maxStam = dungeon.playerMaxStamina or 100
    local stamRatio = maxStam > 0 and (stam / maxStam) or 0
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", barX - 1, barY - 1, barW + 2, barH + 2)
    love.graphics.setColor(0, 0.3, 0, 0.8)
    love.graphics.rectangle("fill", barX, barY, barW, barH)
    love.graphics.setColor(0.2, 0.8, 0.2, 0.9)
    love.graphics.rectangle("fill", barX, barY, barW * stamRatio, barH)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf(math.floor(stam) .. " / " .. math.floor(maxStam), barX, barY, barW, "center")

    -- Level and XP (below stamina bar)
    barY = barY + barSpacing + 4
    love.graphics.setFont(fonts.small)
    local playerLevel = rpg.level or 1
    local playerXp = rpg.xp or 0
    local xpNeeded = 250 * playerLevel
    love.graphics.setColor(0.9, 0.85, 0.5, 0.9)
    love.graphics.print("Lv." .. playerLevel, barX, barY)
    -- XP bar
    local xpBarY = barY + 14
    local xpRatio = xpNeeded > 0 and (playerXp / xpNeeded) or 0
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", barX - 1, xpBarY - 1, barW + 2, barH + 2)
    love.graphics.setColor(0.3, 0.3, 0.1, 0.8)
    love.graphics.rectangle("fill", barX, xpBarY, barW, barH)
    love.graphics.setColor(0.9, 0.85, 0.3, 0.9)
    love.graphics.rectangle("fill", barX, xpBarY, barW * math.min(xpRatio, 1), barH)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.printf(playerXp .. " / " .. xpNeeded .. " XP", barX, xpBarY, barW, "center")

    -- Weapon Special charge bar (below stamina, left side)
    if game._itemUI.weaponSpecialName then
        local wsBarX = 10
        local wsBarY = barY + barSpacing + 24
        local wsBarW = 160
        local wsBarH = 10
        local wsRatio = game._itemUI.weaponSpecialMax > 0 and (game._itemUI.weaponSpecialCharge / game._itemUI.weaponSpecialMax) or 0

        love.graphics.setColor(0, 0, 0, 0.6)
        love.graphics.rectangle("fill", wsBarX - 1, wsBarY - 1, wsBarW + 2, wsBarH + 2)
        love.graphics.setColor(0.3, 0.15, 0.05, 0.8)
        love.graphics.rectangle("fill", wsBarX, wsBarY, wsBarW, wsBarH)
        -- Fill: orange to red gradient based on charge
        local r = 0.8 + 0.2 * wsRatio
        local g = 0.4 * (1 - wsRatio * 0.5)
        love.graphics.setColor(r, g, 0.1, 0.9)
        love.graphics.rectangle("fill", wsBarX, wsBarY, wsBarW * math.min(wsRatio, 1), wsBarH)
        -- Label
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(1, 0.8, 0.3, 0.9)
        love.graphics.printf(game._itemUI.weaponSpecialName .. "  " .. math.floor(game._itemUI.weaponSpecialCharge) .. "/" .. game._itemUI.weaponSpecialMax, wsBarX, wsBarY - 1, wsBarW, "center")

        -- Ready indicator (pulsing glow when full)
        if wsRatio >= 1 then
            local pulse = 0.6 + 0.4 * math.sin(love.timer.getTime() * 4)
            love.graphics.setColor(1, 0.6, 0.1, pulse * 0.4)
            love.graphics.rectangle("fill", wsBarX - 2, wsBarY - 2, wsBarW + 4, wsBarH + 4, 2, 2)
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(1, 0.9, 0.3, pulse)
            love.graphics.print("[F] Activate", wsBarX + wsBarW + 6, wsBarY - 1)
        end
    end

    -- Inscription hotbar (bottom-left, above controls hint)
    if #game._itemUI.inscriptionSlots > 0 then
        local insY = H - 52
        local insX = 10
        local insW = 40
        local insH = 30
        local insSpacing = 4

        for i, ins in ipairs(game._itemUI.inscriptionSlots) do
            local ix = insX + (i - 1) * (insW + insSpacing)

            -- Background
            local onCooldown = ins.cooldownLeft and ins.cooldownLeft > 0
            if onCooldown then
                love.graphics.setColor(0.15, 0.1, 0.1, 0.8)
            else
                love.graphics.setColor(0.1, 0.12, 0.2, 0.85)
            end
            love.graphics.rectangle("fill", ix, insY, insW, insH, 3, 3)

            -- Border
            if onCooldown then
                love.graphics.setColor(0.4, 0.2, 0.2, 0.6)
            else
                love.graphics.setColor(0.4, 0.5, 0.8, 0.7)
            end
            love.graphics.rectangle("line", ix, insY, insW, insH, 3, 3)

            -- Keybind number
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.6, 0.6, 0.7, 0.6)
            love.graphics.print(tostring(i), ix + 2, insY + 1)

            -- Inscription name (truncated)
            local insName = ins.name or ("Slot " .. i)
            if #insName > 5 then insName = insName:sub(1, 4) .. "." end
            love.graphics.setFont(fonts.small)
            if onCooldown then
                love.graphics.setColor(0.5, 0.3, 0.3, 0.7)
            else
                love.graphics.setColor(0.8, 0.7, 1, 0.9)
            end
            love.graphics.print(insName, ix + 3, insY + 12)

            -- Cooldown overlay
            if onCooldown then
                local cdMax = ins.cooldownMax or 1
                local cdRatio = ins.cooldownLeft / math.max(cdMax, 1)
                love.graphics.setColor(0, 0, 0, 0.5 * cdRatio)
                love.graphics.rectangle("fill", ix, insY, insW, insH * cdRatio, 3, 3)
                love.graphics.setFont(fonts.npc)
                love.graphics.setColor(1, 0.4, 0.4, 0.9)
                love.graphics.printf(string.format("%.0f", ins.cooldownLeft), ix, insY + 8, insW, "center")
            end
        end
    end

    -- Controls hint (updated)
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    local controlsStr = "[WASD] Move  [Click/Space] Attack  [E] Interact  [J] Quests"
    if #game._itemUI.inscriptionSlots > 0 then controlsStr = controlsStr .. "  [1-4] Inscriptions" end
    if game._itemUI.weaponSpecialName then controlsStr = controlsStr .. "  [F] Special" end
    love.graphics.print(controlsStr, 10, H - 18)

    -- Minimap (top-right corner) — cached to canvas, updated on visibility changes
    if dungeon.grid then
        local mapScale = 2
        local mapW = #dungeon.grid[1] * mapScale
        local mapH = #dungeon.grid * mapScale
        local mapX = W - mapW - 10
        local mapY = 42

        -- Background
        love.graphics.setColor(0, 0, 0, 0.6)
        love.graphics.rectangle("fill", mapX - 2, mapY - 2, mapW + 4, mapH + 4)

        -- Rebuild minimap canvas if dirty (set by dungeon_visibility_update handler)
        if dungeon._minimapDirty or not dungeon._minimapCanvas then
            if dungeon._minimapCanvas then dungeon._minimapCanvas:release() end
            local mmCanvas = love.graphics.newCanvas(mapW, mapH)
            love.graphics.setCanvas(mmCanvas)
            love.graphics.clear(0, 0, 0, 0)
            love.graphics.origin()
            for y = 1, #dungeon.grid do
                for x = 1, #dungeon.grid[y] do
                    local fogKey = (x-1) .. "," .. (y-1)
                    if dungeon.fog[fogKey] then
                        local tile = dungeon.grid[y][x]
                        if tile == DTILE.WALL then
                            love.graphics.setColor(0.3, 0.25, 0.35, 0.8)
                        elseif tile == DTILE.STAIRS_UP then
                            love.graphics.setColor(0.3, 0.8, 0.3, 0.9)
                        elseif tile == DTILE.STAIRS_DOWN or tile == DTILE.EXIT then
                            love.graphics.setColor(0.8, 0.3, 0.3, 0.9)
                        elseif tile == DTILE.BOSS_DOOR then
                            love.graphics.setColor(1, 0.1, 0.1, 0.9)
                        else
                            love.graphics.setColor(0.5, 0.45, 0.4, 0.6)
                        end
                        love.graphics.rectangle("fill", (x-1) * mapScale, (y-1) * mapScale, mapScale, mapScale)
                    end
                end
            end
            love.graphics.setCanvas()
            dungeon._minimapCanvas = mmCanvas
            dungeon._minimapDirty = false
        end

        -- Draw cached minimap
        love.graphics.setColor(1, 1, 1, 1)
        love.graphics.draw(dungeon._minimapCanvas, mapX, mapY)

        -- Player dot on minimap (always drawn fresh)
        love.graphics.setColor(0, 1, 0, 1)
        love.graphics.rectangle("fill",
            mapX + dungeon.playerTileX * mapScale,
            mapY + dungeon.playerTileY * mapScale,
            mapScale, mapScale)

        -- Enemy dots on minimap (always drawn fresh)
        for _, e in ipairs(dungeon.enemies) do
            if e.alive ~= false then
                local efKey = e.x .. "," .. e.y
                if dungeon.fog[efKey] then
                    love.graphics.setColor(1, 0.2, 0.2, 0.8)
                    love.graphics.rectangle("fill",
                        mapX + e.x * mapScale,
                        mapY + e.y * mapScale,
                        mapScale, mapScale)
                end
            end
        end
    end
end

local function drawDirectorUI(W, H)
    -- World event banners (center-top, gold/amber, fade in/out)
    for i, ev in ipairs(game._directorEvents) do
        local alpha = ev.fadeIn or 1
        -- Fade out in last 1 second
        if ev.timer < 1 then
            alpha = alpha * ev.timer
        end
        if alpha > 0 then
            local bannerY = 44 + (i - 1) * 50
            local bannerW = math.min(500, W - 40)
            local bannerX = (W - bannerW) / 2

            -- Lich events use purple theme, others use gold
            local isLich = (ev.type == "lich" or ev.type == "lich_horde" or ev.type == "lich_attack" or ev.type == "lich_cleanse" or ev.type == "lich_counter")
            if isLich then
                -- Purple banner background
                love.graphics.setColor(0.1, 0.02, 0.15, 0.8 * alpha)
                love.graphics.rectangle("fill", bannerX, bannerY, bannerW, 44, 6, 6)
                love.graphics.setColor(0.6, 0.15, 0.8, 0.8 * alpha)
                love.graphics.rectangle("line", bannerX, bannerY, bannerW, 44, 6, 6)
                love.graphics.setFont(fonts.hud)
                love.graphics.setColor(0.8, 0.3, 1, alpha)
                love.graphics.printf(ev.title, bannerX + 8, bannerY + 4, bannerW - 16, "center")
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.75, 0.6, 0.9, 0.9 * alpha)
                love.graphics.printf(ev.description, bannerX + 8, bannerY + 22, bannerW - 16, "center")
            else
                -- Banner background
                love.graphics.setColor(0.15, 0.1, 0, 0.75 * alpha)
                love.graphics.rectangle("fill", bannerX, bannerY, bannerW, 44, 6, 6)
                -- Gold border
                love.graphics.setColor(0.9, 0.75, 0.2, 0.8 * alpha)
                love.graphics.rectangle("line", bannerX, bannerY, bannerW, 44, 6, 6)
                -- Title
                love.graphics.setFont(fonts.hud)
                love.graphics.setColor(1, 0.85, 0.2, alpha)
                love.graphics.printf(ev.title, bannerX + 8, bannerY + 4, bannerW - 16, "center")
                -- Description
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.95, 0.9, 0.7, 0.9 * alpha)
                love.graphics.printf(ev.description, bannerX + 8, bannerY + 22, bannerW - 16, "center")
            end
        end
    end

    -- Zone ticker (bottom-right, small messages)
    local tickerX = W - 260
    local tickerY = H - 30
    for i = #game._zoneTicker, 1, -1 do
        local zt = game._zoneTicker[i]
        local alpha = 1
        if zt.timer < 1 then alpha = zt.timer end

        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.5, 0.7, 0.9, 0.6 * alpha)
        love.graphics.printf(zt.message, tickerX, tickerY, 250, "right")
        tickerY = tickerY - 16
    end
end

local function drawRaidUI(W, H)
    if not game._raid.state then return end

    if game._raid.state.state == "waiting" and game._raid.state.barrierActive then
        -- Waiting room: player counter + atmospheric text
        local boxW = 320
        local boxH = 80
        local boxX = (W - boxW) / 2
        local boxY = H / 2 - boxH / 2

        -- Dark background
        love.graphics.setColor(0.05, 0.02, 0.1, 0.85)
        love.graphics.rectangle("fill", boxX, boxY, boxW, boxH, 8, 8)
        -- Purple border
        love.graphics.setColor(0.6, 0.2, 0.8, 0.8)
        love.graphics.rectangle("line", boxX, boxY, boxW, boxH, 8, 8)

        -- Player count
        love.graphics.setFont(fonts.hud)
        local countText = game._raid.state.playerCount .. " / " .. game._raid.state.minPlayers .. " Players Ready"
        local countColor = game._raid.state.playerCount >= game._raid.state.minPlayers and {0.2, 1, 0.3} or {1, 0.85, 0.3}
        love.graphics.setColor(countColor[1], countColor[2], countColor[3], 1)
        love.graphics.printf(countText, boxX, boxY + 10, boxW, "center")

        -- Pulsing atmospheric text
        local pulse = 0.5 + 0.5 * math.sin(love.timer.getTime() * 2)
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.6, 0.3, 0.8, 0.5 + 0.3 * pulse)
        love.graphics.printf("A massive presence lurks beyond the barrier...", boxX + 8, boxY + 38, boxW - 16, "center")

        -- Boss name
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(0.9, 0.5, 0.2, 0.8)
        love.graphics.printf(game._raid.state.bossName, boxX, boxY + 58, boxW, "center")
    end

    -- Raid boss health bar (full-width bar at top)
    if game._raid.bossHp and game._raid.state and game._raid.state.state == "active" then
        local barH = 28
        local barPad = 40
        local barW = W - barPad * 2
        local barY = 42

        -- Background
        love.graphics.setColor(0, 0, 0, 0.8)
        love.graphics.rectangle("fill", barPad - 2, barY - 2, barW + 4, barH + 4, 4, 4)

        -- HP bar (dark red base, bright red fill)
        love.graphics.setColor(0.3, 0, 0, 0.9)
        love.graphics.rectangle("fill", barPad, barY, barW, barH, 3, 3)

        local hpRatio = game._raid.bossHp.maxHp > 0 and (game._raid.bossHp.hp / game._raid.bossHp.maxHp) or 0
        -- Color shifts: purple for lich, red->orange for others
        local r, g, b
        if game._raid.phase then
            r = 0.5 + 0.3 * (1 - hpRatio)
            g = 0.1
            b = 0.6 + 0.2 * hpRatio
        else
            r = 0.8 + 0.2 * (1 - hpRatio)
            g = 0.1 + 0.3 * (1 - hpRatio)
            b = 0
        end
        love.graphics.setColor(r, g, b, 0.95)
        love.graphics.rectangle("fill", barPad, barY, barW * hpRatio, barH, 3, 3)

        -- Phase threshold markers on HP bar
        local phaseThresholds = { 0.7, 0.4, 0.15 }
        for _, threshold in ipairs(phaseThresholds) do
            local markerX = barPad + barW * threshold
            love.graphics.setColor(1, 1, 1, 0.4)
            love.graphics.setLineWidth(1)
            love.graphics.line(markerX, barY, markerX, barY + barH)
        end

        -- Boss name + phase
        love.graphics.setFont(fonts.hud)
        love.graphics.setColor(1, 1, 1, 1)
        local bossLabel = game._raid.bossHp.name
        if game._raid.phase then
            bossLabel = bossLabel .. " - " .. (game._raid.phase.phaseName or "Phase " .. game._raid.phase.phase)
        elseif game._raid.bossHp.phase and game._raid.bossHp.phase > 1 then
            bossLabel = bossLabel .. " (Phase " .. game._raid.bossHp.phase .. ")"
        end
        love.graphics.printf(bossLabel, barPad, barY + 2, barW, "center")

        -- HP numbers
        love.graphics.setFont(fonts.small)
        love.graphics.setColor(1, 1, 1, 0.8)
        local hpText = math.floor(game._raid.bossHp.hp) .. " / " .. math.floor(game._raid.bossHp.maxHp)
        love.graphics.printf(hpText, barPad, barY + 16, barW, "center")

        -- Phylactery HP bars (phase 2)
        if #game._raid.phylacteries > 0 then
            local phylY = barY + barH + 6
            local phylBarW = (barW - 20) / 4
            for pi, phyl in ipairs(game._raid.phylacteries) do
                local phylX = barPad + (pi - 1) * (phylBarW + 5)
                local phylRatio = phyl.maxHp > 0 and (phyl.hp / phyl.maxHp) or 0

                -- Background
                love.graphics.setColor(0.1, 0, 0.1, 0.8)
                love.graphics.rectangle("fill", phylX, phylY, phylBarW, 14, 2, 2)

                -- HP fill (purple)
                love.graphics.setColor(0.6, 0.2, 0.8, 0.9)
                love.graphics.rectangle("fill", phylX, phylY, phylBarW * phylRatio, 14, 2, 2)

                -- Label
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(1, 1, 1, 0.8)
                love.graphics.printf("Phylactery " .. pi, phylX, phylY + 1, phylBarW, "center")
            end
        end
    end

    -- Lich game._raid corruption zones on dungeon floor (pulsing purple squares)
    if dungeon.inDungeon and #game._raid.corruptionZones > 0 then
        for _, zone in ipairs(game._raid.corruptionZones) do
            local zoneAlpha = 0.3 + math.sin(corruption.animTimer * 4) * 0.15
            love.graphics.setColor(0.5, 0.1, 0.6, zoneAlpha)
            local tileSize = 32
            local zx = zone.x * tileSize - (camera and camera.x or 0)
            local zy = zone.y * tileSize - (camera and camera.y or 0)
            local zSize = (zone.radius * 2 + 1) * tileSize
            love.graphics.rectangle("fill", zx - zone.radius * tileSize, zy - zone.radius * tileSize, zSize, zSize)
            -- Warning border
            love.graphics.setColor(0.8, 0.2, 1, zoneAlpha + 0.2)
            love.graphics.setLineWidth(2)
            love.graphics.rectangle("line", zx - zone.radius * tileSize, zy - zone.radius * tileSize, zSize, zSize)
            -- Damage text
            love.graphics.setFont(fonts.small)
            love.graphics.setColor(1, 0.3, 0.6, zoneAlpha + 0.3)
            love.graphics.printf("-" .. zone.damage, zx - 20, zy - 8, 40, "center")
        end
    end
end

local function drawDungeonPrompts(W, H)
    local fadeIn = getFadeIn()
    if not dungeon.inDungeon or not dungeon.grid then return end

    -- Check what's at the player's current tile
    local tile = nil
    if dungeon.grid[dungeon.playerTileY + 1] then
        tile = dungeon.grid[dungeon.playerTileY + 1][dungeon.playerTileX + 1]
    end

    love.graphics.setFont(fonts.ui)

    if tile == DTILE.STAIRS_DOWN or tile == DTILE.EXIT then
        love.graphics.setColor(0.6, 1, 0.6, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
        love.graphics.printf("Press E to descend", 0, H / 2 - 80, W, "center")
    elseif tile == DTILE.STAIRS_UP or tile == DTILE.ENTRANCE then
        if dungeon.floorNum > 1 then
            love.graphics.setColor(0.6, 1, 0.6, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
            love.graphics.printf("Press E to ascend", 0, H / 2 - 80, W, "center")
        else
            love.graphics.setColor(0.6, 1, 0.6, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
            love.graphics.printf("Press E to exit dungeon", 0, H / 2 - 80, W, "center")
        end
    elseif tile == DTILE.BOSS_DOOR then
        love.graphics.setColor(1, 0.3, 0.3, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
        love.graphics.printf("Press E to enter Boss Room", 0, H / 2 - 80, W, "center")
    end

    -- Check for adjacent chest
    for _, chest in ipairs(dungeon.chests) do
        if not chest.opened then
            local dx = math.abs(chest.x - dungeon.playerTileX)
            local dy = math.abs(chest.y - dungeon.playerTileY)
            if dx <= 1 and dy <= 1 and (dx + dy) <= 1 then
                love.graphics.setColor(1, 0.85, 0.2, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
                love.graphics.printf("Press E to open chest", 0, H / 2 - 60, W, "center")
                break
            end
        end
    end

    -- Check for adjacent NPC
    for i, npc in ipairs(dungeon.npcs) do
        if not npc.claimed then
            local dx = math.abs(npc.x - dungeon.playerTileX)
            local dy = math.abs(npc.y - dungeon.playerTileY)
            if dx <= 1 and dy <= 1 and (dx + dy) <= 1 then
                love.graphics.setColor(0.5, 0.8, 1, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
                love.graphics.printf("Press E to talk to " .. (npc.type or "NPC"), 0, H / 2 - 60, W, "center")
                break
            end
        end
    end

    -- Check for adjacent corpse
    for _, cr in ipairs(dungeon.corpses) do
        if not cr.examined then
            local dx = math.abs(cr.x - dungeon.playerTileX)
            local dy = math.abs(cr.y - dungeon.playerTileY)
            if dx <= 1 and dy <= 1 and (dx + dy) <= 1 then
                love.graphics.setColor(0.8, 0.75, 0.6, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
                love.graphics.printf("Press E to examine remains", 0, H / 2 - 60, W, "center")
                break
            end
        end
    end

    -- Check for adjacent enemy (attack prompt)
    for i, enemy in ipairs(dungeon.enemies) do
        if enemy.alive ~= false then
            local dx = math.abs(enemy.x - dungeon.playerTileX)
            local dy = math.abs(enemy.y - dungeon.playerTileY)
            if dx <= 1 and dy <= 1 then
                love.graphics.setColor(1, 0.3, 0.3, fadeIn * (0.7 + math.sin(love.timer.getTime() * 4) * 0.3))
                love.graphics.printf("Click or Space to attack " .. (enemy.name or "Enemy"), 0, H / 2 - 60, W, "center")
                break
            end
        end
    end

    -- Combat join offer prompt
    if dungeon.combatJoinOffer and not tcState.inCombat then
        local offer = dungeon.combatJoinOffer
        local alpha = fadeIn * (0.7 + math.sin(love.timer.getTime() * 3) * 0.3)
        love.graphics.setColor(1, 0.8, 0.2, alpha)
        local msg = string.format("Nearby combat! %d allies vs %d enemies — Press J to join (%.0fs)",
            offer.allyCount or 0, offer.enemyCount or 0, math.max(0, offer.timer))
        love.graphics.printf(msg, 0, H / 2 - 100, W, "center")
    end
end

local function drawDungeonQuests(W, H)
    if not dungeon.progress or not dungeon.progress.dailyQuests then return end

    local panelW = 300
    local panelH = 250
    local px = W / 2 - panelW / 2
    local py = H / 2 - panelH / 2

    -- Background
    love.graphics.setColor(0.05, 0.05, 0.1, 0.9)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.4, 0.3, 0.6, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)

    -- Title
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(0.9, 0.8, 1)
    love.graphics.printf("Daily Dungeon Quests", px, py + 10, panelW, "center")

    -- Quests
    love.graphics.setFont(fonts.chat)
    local qy = py + 40
    local quests = dungeon.progress.dailyQuests
    if type(quests) == "table" then
        for _, q in ipairs(quests) do
            local completed = q.completed
            local questText = q.name or q.description or q.desc or ""
            if completed then
                love.graphics.setColor(0.3, 0.8, 0.3, 0.8)
                love.graphics.print("[DONE] " .. questText, px + 10, qy)
            else
                love.graphics.setColor(0.8, 0.8, 0.9, 0.9)
                love.graphics.print("[ ] " .. questText, px + 10, qy)
            end
            love.graphics.setColor(0.6, 0.5, 0.3, 0.7)
            love.graphics.print("  Reward: " .. (q.xpReward or 0) .. " XP, " .. (q.goldReward or 0) .. " gold", px + 10, qy + 16)
            qy = qy + 38
        end
    end

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("[J] to close", px, py + panelH - 18, panelW, "center")
end

local function drawLeaderboard(W, H)
    if not dungeon.progress or not dungeon.progress.leaderboard then return end

    local panelW = 350
    local panelH = 300
    local px = W / 2 - panelW / 2
    local py = H / 2 - panelH / 2

    -- Background
    love.graphics.setColor(0.05, 0.05, 0.1, 0.9)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.6, 0.5, 0.2, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)

    -- Title
    love.graphics.setFont(fonts.ui)
    love.graphics.setColor(1, 0.85, 0.2)
    love.graphics.printf("Hall of Heroes", px, py + 10, panelW, "center")

    -- Deepest floor leaderboard
    love.graphics.setFont(fonts.chat)
    love.graphics.setColor(0.8, 0.7, 1, 0.9)
    love.graphics.print("Deepest Floor:", px + 10, py + 40)

    local lb = dungeon.progress.leaderboard.deepestFloor or {}
    local ly = py + 60
    for rank, entry in ipairs(lb) do
        if rank > 10 then break end
        love.graphics.setColor(0.7, 0.7, 0.8, 0.8)
        love.graphics.print(rank .. ". " .. (entry.name or "???") .. " — Floor " .. (entry.floor or 0), px + 20, ly)
        ly = ly + 18
    end

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("[L] to close", px, py + panelH - 18, panelW, "center")
end

local function drawPartyPanel(W, H)
    local myId = getMyId()
    local panelW = 280
    local panelH = 360
    local px = (W - panelW) / 2
    local py = (H - panelH) / 2

    -- Background overlay
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, W, H)

    -- Panel background
    love.graphics.setColor(0.08, 0.09, 0.14, 0.95)
    love.graphics.rectangle("fill", px, py, panelW, panelH, 8, 8)
    love.graphics.setColor(0.3, 0.5, 0.8, 0.8)
    love.graphics.setLineWidth(2)
    love.graphics.rectangle("line", px, py, panelW, panelH, 8, 8)
    love.graphics.setLineWidth(1)

    -- Title
    love.graphics.setFont(fonts.title)
    love.graphics.setColor(0.4, 0.7, 1, 1)
    love.graphics.printf("Party", px, py + 10, panelW, "center")

    local contentY = py + 42

    if not game._raid.partyData then
        -- Not in a party
        love.graphics.setFont(fonts.chat)
        love.graphics.setColor(0.6, 0.6, 0.7, 0.8)
        love.graphics.printf("You are not in a party.", px + 10, contentY, panelW - 20, "center")
        contentY = contentY + 30

        -- Create Party button
        local btnW = 140
        local btnH = 30
        local btnX = px + (panelW - btnW) / 2
        local btnY = contentY + 5
        love.graphics.setColor(0.15, 0.3, 0.5, 0.9)
        love.graphics.rectangle("fill", btnX, btnY, btnW, btnH, 5, 5)
        love.graphics.setColor(0.3, 0.6, 0.9, 0.8)
        love.graphics.rectangle("line", btnX, btnY, btnW, btnH, 5, 5)
        love.graphics.setFont(fonts.hud)
        love.graphics.setColor(0.8, 0.9, 1, 1)
        love.graphics.printf("Create Party", btnX, btnY + 7, btnW, "center")

        -- Store button area for click detection
        ui._partyCreateBtn = { x = btnX, y = btnY, w = btnW, h = btnH }
        contentY = btnY + btnH + 15

        -- Pending invite section
        if game._raid.partyInvitePending then
            love.graphics.setColor(0.3, 0.3, 0.5, 0.6)
            love.graphics.line(px + 15, contentY, px + panelW - 15, contentY)
            contentY = contentY + 8

            love.graphics.setFont(fonts.chat)
            love.graphics.setColor(0.4, 0.7, 1, 1)
            love.graphics.printf("Invite from: " .. (game._raid.partyInvitePending.fromName or "?"), px + 10, contentY, panelW - 20, "center")
            contentY = contentY + 22

            -- Accept / Decline buttons
            local halfW = 80
            local accX = px + panelW / 2 - halfW - 8
            local decX = px + panelW / 2 + 8
            local ibtnH = 26

            -- Accept
            love.graphics.setColor(0.15, 0.35, 0.15, 0.9)
            love.graphics.rectangle("fill", accX, contentY, halfW, ibtnH, 4, 4)
            love.graphics.setColor(0.3, 0.8, 0.3, 0.8)
            love.graphics.rectangle("line", accX, contentY, halfW, ibtnH, 4, 4)
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(0.5, 1, 0.5, 1)
            love.graphics.printf("Accept", accX, contentY + 6, halfW, "center")

            -- Decline
            love.graphics.setColor(0.35, 0.15, 0.15, 0.9)
            love.graphics.rectangle("fill", decX, contentY, halfW, ibtnH, 4, 4)
            love.graphics.setColor(0.8, 0.3, 0.3, 0.8)
            love.graphics.rectangle("line", decX, contentY, halfW, ibtnH, 4, 4)
            love.graphics.setFont(fonts.npc)
            love.graphics.setColor(1, 0.5, 0.5, 1)
            love.graphics.printf("Decline", decX, contentY + 6, halfW, "center")

            ui._partyAcceptBtn = { x = accX, y = contentY, w = halfW, h = ibtnH }
            ui._partyDeclineBtn = { x = decX, y = contentY, w = halfW, h = ibtnH }
        else
            ui._partyAcceptBtn = nil
            ui._partyDeclineBtn = nil
        end
    else
        -- In a party: member list
        love.graphics.setFont(fonts.hud)
        love.graphics.setColor(0.6, 0.7, 0.8, 0.7)
        love.graphics.printf("Members (" .. #game._raid.partyData.members .. ")", px + 10, contentY, panelW - 20, "left")
        contentY = contentY + 22

        for i, member in ipairs(game._raid.partyData.members) do
            local my = contentY + (i - 1) * 38
            if my + 38 > py + panelH - 80 then break end

            -- Member row background
            local isLeader = (member.id == game._raid.partyData.leader)
            local isSelf = (member.id == myId)
            if isSelf then
                love.graphics.setColor(0.12, 0.18, 0.25, 0.8)
            else
                love.graphics.setColor(0.1, 0.1, 0.16, 0.7)
            end
            love.graphics.rectangle("fill", px + 8, my, panelW - 16, 34, 4, 4)

            -- Leader crown indicator
            if isLeader then
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(1, 0.85, 0.2, 0.9)
                love.graphics.print("*", px + 14, my + 4)
            end

            -- Member name
            love.graphics.setFont(fonts.chat)
            local mr, mg, mb = game.hexToRGB(member.color or "#FFFFFF")
            love.graphics.setColor(mr, mg, mb, 0.95)
            local nameX = isLeader and (px + 26) or (px + 16)
            love.graphics.print(member.name or "?", nameX, my + 4)

            -- Level display (from players table if available)
            local memberPlayer = players[member.id]
            if isSelf and rpg.level then
                love.graphics.setFont(fonts.small)
                love.graphics.setColor(0.7, 0.7, 0.8, 0.7)
                love.graphics.printf("Lv." .. rpg.level, px + 8, my + 4, panelW - 24, "right")
            end

            -- HP bar for self (we only know our own HP in dungeon)
            if isSelf and (dungeon.inDungeon or tcState.inCombat) then
                local hpRatio = dungeon.playerMaxHp > 0 and (dungeon.playerHp / dungeon.playerMaxHp) or 1
                local barX = nameX
                local barY = my + 22
                local barW = panelW - 40
                local barH = 6
                love.graphics.setColor(0.2, 0, 0, 0.6)
                love.graphics.rectangle("fill", barX, barY, barW, barH, 2, 2)
                love.graphics.setColor(0.2 + 0.8 * (1 - hpRatio), 0.8 * hpRatio, 0, 0.8)
                love.graphics.rectangle("fill", barX, barY, barW * hpRatio, barH, 2, 2)
            end
        end

        contentY = contentY + #game._raid.partyData.members * 38 + 8

        -- Separator
        love.graphics.setColor(0.3, 0.3, 0.5, 0.4)
        love.graphics.line(px + 15, contentY, px + panelW - 15, contentY)
        contentY = contentY + 8

        -- Invite button + text input
        love.graphics.setFont(fonts.npc)
        love.graphics.setColor(0.6, 0.7, 0.8, 0.8)
        love.graphics.print("Invite player:", px + 14, contentY)
        contentY = contentY + 16

        -- Invite text input
        local inputW = panelW - 80
        local inputH = 22
        local inputX = px + 10
        local inputY = contentY
        if game._raid.partyInviteActive then
            love.graphics.setColor(0.12, 0.12, 0.2, 0.9)
        else
            love.graphics.setColor(0.08, 0.08, 0.12, 0.7)
        end
        love.graphics.rectangle("fill", inputX, inputY, inputW, inputH, 3, 3)
        if game._raid.partyInviteActive then
            love.graphics.setColor(0.3, 0.5, 0.8, 0.7)
        else
            love.graphics.setColor(0.2, 0.3, 0.4, 0.5)
        end
        love.graphics.rectangle("line", inputX, inputY, inputW, inputH, 3, 3)

        love.graphics.setFont(fonts.npc)
        if game._raid.partyInviteActive then
            love.graphics.setColor(1, 1, 1, 0.95)
            love.graphics.print(game._raid.partyInviteInput .. (math.floor(love.timer.getTime() * 2) % 2 == 0 and "|" or ""), inputX + 4, inputY + 4)
        elseif #game._raid.partyInviteInput > 0 then
            love.graphics.setColor(0.8, 0.8, 0.8, 0.8)
            love.graphics.print(game._raid.partyInviteInput, inputX + 4, inputY + 4)
        else
            love.graphics.setColor(0.4, 0.4, 0.5, 0.5)
            love.graphics.print("Username...", inputX + 4, inputY + 4)
        end

        -- Send invite button
        local sendW = 55
        local sendX = px + panelW - sendW - 10
        love.graphics.setColor(0.15, 0.3, 0.5, 0.9)
        love.graphics.rectangle("fill", sendX, inputY, sendW, inputH, 3, 3)
        love.graphics.setColor(0.3, 0.6, 0.9, 0.8)
        love.graphics.rectangle("line", sendX, inputY, sendW, inputH, 3, 3)
        love.graphics.setColor(0.8, 0.9, 1, 1)
        love.graphics.printf("Invite", sendX, inputY + 4, sendW, "center")

        ui._raid.partyInviteInput = { x = inputX, y = inputY, w = inputW, h = inputH }
        ui._partyInviteSendBtn = { x = sendX, y = inputY, w = sendW, h = inputH }

        contentY = inputY + inputH + 12

        -- Leave / Disband button
        local isLeader = (game._raid.partyData.leader == myId)
        local leaveBtnW = 120
        local leaveBtnH = 28
        local leaveBtnX = px + (panelW - leaveBtnW) / 2
        local leaveBtnY = py + panelH - leaveBtnH - 30

        if isLeader then
            love.graphics.setColor(0.35, 0.12, 0.12, 0.9)
            love.graphics.rectangle("fill", leaveBtnX, leaveBtnY, leaveBtnW, leaveBtnH, 5, 5)
            love.graphics.setColor(0.8, 0.3, 0.3, 0.8)
            love.graphics.rectangle("line", leaveBtnX, leaveBtnY, leaveBtnW, leaveBtnH, 5, 5)
            love.graphics.setFont(fonts.hud)
            love.graphics.setColor(1, 0.5, 0.5, 1)
            love.graphics.printf("Disband Party", leaveBtnX, leaveBtnY + 6, leaveBtnW, "center")
        else
            love.graphics.setColor(0.25, 0.15, 0.12, 0.9)
            love.graphics.rectangle("fill", leaveBtnX, leaveBtnY, leaveBtnW, leaveBtnH, 5, 5)
            love.graphics.setColor(0.7, 0.4, 0.3, 0.8)
            love.graphics.rectangle("line", leaveBtnX, leaveBtnY, leaveBtnW, leaveBtnH, 5, 5)
            love.graphics.setFont(fonts.hud)
            love.graphics.setColor(1, 0.7, 0.5, 1)
            love.graphics.printf("Leave Party", leaveBtnX, leaveBtnY + 6, leaveBtnW, "center")
        end

        ui._partyLeaveBtn = { x = leaveBtnX, y = leaveBtnY, w = leaveBtnW, h = leaveBtnH }
    end

    -- Close hint
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
    love.graphics.printf("[Y] or [ESC] to close", px, py + panelH - 18, panelW, "center")
end

local function drawPartyHUD(W, H)
    local myId = getMyId()
    if not game._raid.partyData or not game._raid.partyData.members then return end
    if #game._raid.partyData.members <= 1 then return end  -- don't show if solo

    -- Compact member list (top-right, below minimap or compass area)
    local hudX = W - 170
    local hudY = 36
    -- If in dungeon, offset below minimap
    if dungeon.inDungeon and dungeon.grid then
        local mapScale = 2
        local mapH = #dungeon.grid * mapScale
        hudY = 42 + mapH + 10
    end

    -- Background
    local memberCount = #game._raid.partyData.members
    local hudH = 12 + memberCount * 18
    love.graphics.setColor(0, 0, 0, 0.45)
    love.graphics.rectangle("fill", hudX - 4, hudY - 2, 164, hudH, 4, 4)

    -- Header
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.4, 0.7, 1, 0.8)
    love.graphics.print("Party (" .. memberCount .. ")", hudX, hudY)

    -- Members
    for i, member in ipairs(game._raid.partyData.members) do
        local my = hudY + 12 + (i - 1) * 18
        local isSelf = (member.id == myId)
        local isLeader = (member.id == game._raid.partyData.leader)

        -- Leader indicator
        if isLeader then
            love.graphics.setColor(1, 0.85, 0.2, 0.9)
            love.graphics.print("*", hudX, my)
        end

        -- Name
        local mr, mg, mb = game.hexToRGB(member.color or "#FFFFFF")
        if isSelf then
            love.graphics.setColor(mr, mg, mb, 1)
        else
            love.graphics.setColor(mr, mg, mb, 0.8)
        end
        local nameX = isLeader and (hudX + 10) or hudX
        local displayName = member.name or "?"
        if #displayName > 14 then displayName = displayName:sub(1, 13) .. "." end
        love.graphics.print(displayName, nameX, my)

        -- Compact HP bar for self (only in dungeon)
        if isSelf and (dungeon.inDungeon or tcState.inCombat) then
            local hpRatio = dungeon.playerMaxHp > 0 and (dungeon.playerHp / dungeon.playerMaxHp) or 1
            local barX = hudX + 100
            local barY = my + 3
            local barW = 52
            local barH = 5
            love.graphics.setColor(0.2, 0, 0, 0.5)
            love.graphics.rectangle("fill", barX, barY, barW, barH, 1, 1)
            love.graphics.setColor(0.2 + 0.8 * (1 - hpRatio), 0.8 * hpRatio, 0, 0.8)
            love.graphics.rectangle("fill", barX, barY, barW * hpRatio, barH, 1, 1)
        end
    end
end

local function drawPartyInvitePrompt(W, H)
    if not game._raid.partyInvitePending then return end

    -- Floating prompt at top-center
    local promptW = 300
    local promptH = 50
    local promptX = (W - promptW) / 2
    local promptY = 50

    -- Background
    love.graphics.setColor(0.05, 0.08, 0.15, 0.9)
    love.graphics.rectangle("fill", promptX, promptY, promptW, promptH, 6, 6)
    love.graphics.setColor(0.3, 0.5, 0.8, 0.8)
    love.graphics.rectangle("line", promptX, promptY, promptW, promptH, 6, 6)

    -- Text
    love.graphics.setFont(fonts.chat)
    love.graphics.setColor(0.4, 0.7, 1, 1)
    love.graphics.printf((game._raid.partyInvitePending.fromName or "?") .. " invited you to a party!", promptX + 8, promptY + 6, promptW - 16, "center")

    -- Accept/Decline hints
    love.graphics.setFont(fonts.small)
    love.graphics.setColor(0.5, 0.8, 0.5, 0.8)
    love.graphics.printf("Open Party panel [Y] to respond", promptX + 8, promptY + 28, promptW - 16, "center")
end

local function drawContextMenu()
    local ctx = ui.contextMenu
    if not ctx then return end

    local ctxItems = ctx.items or CONTEXT_MENU_ITEMS_BASE
    local mx, my = love.mouse.getPosition()
    local itemCount = #ctxItems
    local menuH = CONTEXT_MENU_HEADER_HEIGHT + itemCount * CONTEXT_MENU_ITEM_HEIGHT + CONTEXT_MENU_PADDING * 2
    local menuW = CONTEXT_MENU_WIDTH
    local menuX = ctx.x
    local menuY = ctx.y

    -- Clamp menu to screen bounds
    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()
    if menuX + menuW > W then menuX = W - menuW - 2 end
    if menuY + menuH > H then menuY = H - menuH - 2 end
    if menuX < 2 then menuX = 2 end
    if menuY < 2 then menuY = 2 end

    -- Drop shadow
    love.graphics.setColor(0, 0, 0, 0.4)
    love.graphics.rectangle("fill", menuX + 3, menuY + 3, menuW, menuH, 6, 6)

    -- Background
    love.graphics.setColor(0.08, 0.08, 0.14, 0.95)
    love.graphics.rectangle("fill", menuX, menuY, menuW, menuH, 6, 6)

    -- Border
    love.graphics.setColor(0.4, 0.45, 0.6, 0.8)
    love.graphics.setLineWidth(1)
    love.graphics.rectangle("line", menuX, menuY, menuW, menuH, 6, 6)

    -- Header: player name
    love.graphics.setFont(fonts.hud)
    love.graphics.setColor(0.9, 0.8, 0.3, 1)
    love.graphics.printf(ctx.targetName or "Player", menuX + 8, menuY + 5, menuW - 16, "left")

    -- Separator line under header
    love.graphics.setColor(0.3, 0.35, 0.5, 0.6)
    love.graphics.line(menuX + 6, menuY + CONTEXT_MENU_HEADER_HEIGHT, menuX + menuW - 6, menuY + CONTEXT_MENU_HEADER_HEIGHT)

    -- Determine which item the mouse is hovering over
    local hoverIdx = nil
    local itemsStartY = menuY + CONTEXT_MENU_HEADER_HEIGHT + CONTEXT_MENU_PADDING
    if mx >= menuX and mx <= menuX + menuW then
        for i = 1, itemCount do
            local iy = itemsStartY + (i - 1) * CONTEXT_MENU_ITEM_HEIGHT
            if my >= iy and my < iy + CONTEXT_MENU_ITEM_HEIGHT then
                hoverIdx = i
                break
            end
        end
    end
    ctx.hoverIndex = hoverIdx

    -- Draw each menu item
    love.graphics.setFont(fonts.chat)
    for i, item in ipairs(ctxItems) do
        local iy = itemsStartY + (i - 1) * CONTEXT_MENU_ITEM_HEIGHT

        -- Hover highlight
        if hoverIdx == i then
            love.graphics.setColor(0.25, 0.3, 0.5, 0.7)
            local hlX = menuX + 3
            local hlW = menuW - 6
            love.graphics.rectangle("fill", hlX, iy, hlW, CONTEXT_MENU_ITEM_HEIGHT, 3, 3)
        end

        -- Item-specific icon color
        if item.action == "friend" then
            love.graphics.setColor(0.4, 0.9, 0.4, 1)
        elseif item.action == "party" then
            love.graphics.setColor(0.4, 0.7, 1, 1)
        elseif item.action == "game._trade" then
            love.graphics.setColor(1, 0.85, 0.2, 1)
        elseif item.action == "duel" then
            love.graphics.setColor(1, 0.35, 0.35, 1)
        elseif item.action == "profile" then
            love.graphics.setColor(0.7, 0.7, 0.85, 1)
        elseif item.action == "whisper" then
            love.graphics.setColor(0.85, 0.6, 1, 1)
        elseif item.action == "party_kick" then
            love.graphics.setColor(1, 0.5, 0.3, 1)
        else
            love.graphics.setColor(0.8, 0.8, 0.8, 1)
        end

        -- Small icon indicator (dot)
        love.graphics.circle("fill", menuX + 14, iy + CONTEXT_MENU_ITEM_HEIGHT / 2, 3)

        -- Label text
        if hoverIdx == i then
            love.graphics.setColor(1, 1, 1, 1)
        else
            love.graphics.setColor(0.78, 0.78, 0.85, 0.95)
        end
        love.graphics.print(item.label, menuX + 24, iy + (CONTEXT_MENU_ITEM_HEIGHT - fonts.chat:getHeight()) / 2)
    end
end

function dungeon_draw.init(gameRef, ctx)
    game     = gameRef
    dungeon  = ctx.dungeon
    camera   = ctx.camera
    fonts    = ctx.fonts
    ui       = ctx.ui
    tcState  = ctx.tcState
    getFadeIn = ctx.getFadeIn
    getMyId   = ctx.getMyId
    getSkills = ctx.getSkills
    -- Register all functions onto the game table
    gameRef.revealFog = revealFog
    gameRef.drawDungeonFloor = drawDungeonFloor
    gameRef.drawDungeonEntities = drawDungeonEntities
    gameRef.drawDungeonHUD = drawDungeonHUD
    gameRef.drawDirectorUI = drawDirectorUI
    gameRef.drawRaidUI = drawRaidUI
    gameRef.drawDungeonPrompts = drawDungeonPrompts
    gameRef.drawDungeonQuests = drawDungeonQuests
    gameRef.drawLeaderboard = drawLeaderboard
    gameRef.drawPartyPanel = drawPartyPanel
    gameRef.drawPartyHUD = drawPartyHUD
    gameRef.drawPartyInvitePrompt = drawPartyInvitePrompt
    gameRef.drawContextMenu = drawContextMenu
end

dungeon_draw.getContextMenuItems = getContextMenuItems

function dungeon_draw.updateVisionBarHover(mx, my)
    local rect = game._visionBarRect
    if not rect then game._visionHoveredSlot = nil; return end
    for i = 1, rect.count do
        local sx = rect.x + (i - 1) * (rect.slotW + rect.spacing)
        if mx >= sx and mx <= sx + rect.slotW and my >= rect.y and my <= rect.y + rect.slotH then
            game._visionHoveredSlot = i
            return
        end
    end
    game._visionHoveredSlot = nil
end

function dungeon_draw.handleVisionBarClick(mx, my, button, client)
    if button ~= 1 then return false end
    local rect = game._visionBarRect
    if not rect then return false end
    local available = dungeon.availableVisions or {"normal"}
    for i = 1, rect.count do
        local sx = rect.x + (i - 1) * (rect.slotW + rect.spacing)
        if mx >= sx and mx <= sx + rect.slotW and my >= rect.y and my <= rect.y + rect.slotH then
            local visionId = available[i]
            if visionId and visionId ~= (dungeon.visionType or "normal") then
                if client then client:emit("dungeon_toggle_vision", { visionType = visionId }) end
            end
            return true
        end
    end
    return false
end

return dungeon_draw
