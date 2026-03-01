-- scenes/combat-ui.lua
-- Full combat UI for tactical turn-based combat
-- Renders initiative bar, action bar, tile overlays, unit overlays, HUD, banners, timers
-- Part of MMOLite client

local audio = require("lib.audio")

local combatUI = {}

-- ============================================================================
-- State
-- ============================================================================
local initialized = false
local combatData = nil         -- Full combat state from server
local myUnitId = nil           -- This player's unit ID
local isMyTurn = false
local selectedAction = nil     -- 'move', 'attack', 'ability1', 'ability2', 'ability3', 'wait'
local hoveredTile = nil        -- {x, y} tile mouse is over
local moveRange = {}           -- Set of "x,y" -> true for blue tiles
local attackRange = {}         -- Set of "x,y" -> true for red tiles
local abilityRange = {}        -- Set of "x,y" -> {true, aoeRadius} for orange tiles
local pathPreview = {}         -- Array of {x,y} tiles for dotted path line
local initiative = {}          -- Sorted array of {unitId, name, ct, type, isActive}
local turnTimer = 0            -- Seconds remaining in turn
local turnTimerMax = 15
local turnBanner = nil         -- {text, elapsed, duration} for "YOUR TURN" etc
local damageNumbers = {}       -- Tracked here for HUD (combat-anim.lua handles rendering)
local tileEffects = {}         -- {x, y, type} from server for tile overlay rendering
local syncAttackRange = {}     -- Green tiles for ally sync range
local reactionPrompt = nil     -- {attackerId, damage, attackType, options, timer, elapsed}
local activeBorderPulse = 0    -- Sin wave timer for active unit border pulse
local turnNumber = 0
local equippedCardData = {}    -- Array of {name, range, combatType, ...} for ability slots 1-3

-- ============================================================================
-- UI Layout Constants
-- ============================================================================
local TILE_SIZE = 32
local INITIATIVE_BAR_HEIGHT = 48
local INITIATIVE_PORTRAIT_SIZE = 32
local ACTION_BAR_HEIGHT = 64
local ACTION_SLOT_SIZE = 48
local ACTION_SLOTS = 6         -- [ATK] [C1] [C2] [C3] [WAIT] [END]
local HUD_WIDTH = 180
local HUD_PADDING = 8

-- ============================================================================
-- Colors
-- ============================================================================
local COLORS = {
    move       = {0.2, 0.4, 0.8, 0.35},
    attack     = {0.8, 0.2, 0.2, 0.35},
    ability    = {0.9, 0.5, 0.1, 0.35},
    sync       = {0.2, 0.8, 0.3, 0.35},
    path       = {0.9, 0.9, 0.9, 0.6},
    hovered    = {1, 1, 1, 0.3},
    playerBorders = {
        {0.3, 0.5, 1},
        {0.3, 0.8, 0.3},
        {1, 0.6, 0.2},
        {0.7, 0.3, 0.9},
    },
    enemyBorder  = {0.9, 0.2, 0.2},
    activeBorder = {1, 0.85, 0},
    tileEffectColors = {
        BURNING     = {1, 0.3, 0, 0.4},
        FROZEN      = {0.3, 0.6, 1, 0.4},
        POISONED    = {0.3, 0.8, 0.2, 0.4},
        ELECTRIFIED = {1, 1, 0.2, 0.4},
        SMOKE       = {0.5, 0.5, 0.5, 0.5},
        WATER       = {0.2, 0.4, 0.9, 0.3},
        OIL         = {0.3, 0.2, 0.1, 0.4},
        BRAMBLE     = {0.4, 0.6, 0.2, 0.4},
    },
}

-- ============================================================================
-- Local Performance References
-- ============================================================================
local math_floor = math.floor
local math_sin   = math.sin
local math_abs   = math.abs
local math_min   = math.min
local math_max   = math.max
local math_pi    = math.pi

-- ============================================================================
-- Font Cache
-- ============================================================================
local fontCache = {}
local function getFont(size)
    if not fontCache[size] then
        fontCache[size] = love.graphics.newFont(size)
    end
    return fontCache[size]
end

-- ============================================================================
-- Helpers
-- ============================================================================

local function tileKey(x, y)
    return x .. "," .. y
end

local function getMyUnit()
    if not combatData or not combatData.units or not myUnitId then return nil end
    for _, u in ipairs(combatData.units) do
        if u.id == myUnitId then return u end
    end
    return nil
end

local function getUnitAt(tx, ty)
    if not combatData or not combatData.units then return nil end
    for _, u in ipairs(combatData.units) do
        if u.x == tx and u.y == ty and (u.hp or 0) > 0 then return u end
    end
    return nil
end

local function isEnemy(unit)
    return unit and unit.type == "enemy"
end

local function getPlayerIndex(unit)
    if not unit or not combatData or not combatData.units then return 1 end
    local idx = 0
    for _, u in ipairs(combatData.units) do
        if u.type == "player" then
            idx = idx + 1
            if u.id == unit.id then return idx end
        end
    end
    return 1
end

-- ============================================================================
-- BFS Utilities
-- ============================================================================

local function bfsFloodFill(startX, startY, maxCost, grid, units)
    local visited = {}
    local result = {}
    local queue = {{x = startX, y = startY, cost = 0}}
    visited[tileKey(startX, startY)] = true

    local dirs = {{0, -1}, {0, 1}, {-1, 0}, {1, 0}}

    while #queue > 0 do
        local current = table.remove(queue, 1)
        if current.cost > 0 then
            result[tileKey(current.x, current.y)] = true
        end

        if current.cost < maxCost then
            for _, d in ipairs(dirs) do
                local nx, ny = current.x + d[1], current.y + d[2]
                local key = tileKey(nx, ny)
                if not visited[key] then
                    visited[key] = true
                    -- Check grid bounds and walkability
                    local walkable = true
                    if grid then
                        local row = grid[ny + 1]
                        if not row then
                            walkable = false
                        else
                            local tile = row[nx + 1]
                            if not tile or tile == 0 then
                                walkable = false
                            end
                        end
                    end
                    -- Check unit occupancy (other units block movement)
                    if walkable and units then
                        for _, u in ipairs(units) do
                            if u.x == nx and u.y == ny and (u.hp or 0) > 0 and u.id ~= myUnitId then
                                walkable = false
                                break
                            end
                        end
                    end
                    if walkable then
                        queue[#queue + 1] = {x = nx, y = ny, cost = current.cost + 1}
                    end
                end
            end
        end
    end
    return result
end

local function bfsPath(fromX, fromY, toX, toY, grid, units)
    if fromX == toX and fromY == toY then return {} end

    local visited = {}
    local parent = {}
    local queue = {{x = fromX, y = fromY}}
    visited[tileKey(fromX, fromY)] = true

    local dirs = {{0, -1}, {0, 1}, {-1, 0}, {1, 0}}
    local found = false

    while #queue > 0 and not found do
        local current = table.remove(queue, 1)
        if current.x == toX and current.y == toY then
            found = true
            break
        end
        for _, d in ipairs(dirs) do
            local nx, ny = current.x + d[1], current.y + d[2]
            local key = tileKey(nx, ny)
            if not visited[key] then
                visited[key] = true
                local walkable = true
                if grid then
                    local row = grid[ny + 1]
                    if not row then
                        walkable = false
                    else
                        local tile = row[nx + 1]
                        if not tile or tile == 0 then
                            walkable = false
                        end
                    end
                end
                if walkable and units then
                    -- Allow destination tile even if occupied (for attack targets)
                    if not (nx == toX and ny == toY) then
                        for _, u in ipairs(units) do
                            if u.x == nx and u.y == ny and (u.hp or 0) > 0 and u.id ~= myUnitId then
                                walkable = false
                                break
                            end
                        end
                    end
                end
                if walkable then
                    parent[key] = {x = current.x, y = current.y}
                    queue[#queue + 1] = {x = nx, y = ny}
                end
            end
        end
    end

    if not found then return {} end

    -- Reconstruct path
    local path = {}
    local cx, cy = toX, toY
    while not (cx == fromX and cy == fromY) do
        table.insert(path, 1, {x = cx, y = cy})
        local p = parent[tileKey(cx, cy)]
        if not p then break end
        cx, cy = p.x, p.y
    end
    return path
end

-- ============================================================================
-- Init
-- ============================================================================

function combatUI.init(data)
    if not data then return end

    combatData = data
    myUnitId = data.myUnitId
    turnNumber = data.turnNumber or 1
    initialized = true
    isMyTurn = false
    selectedAction = nil
    hoveredTile = nil
    moveRange = {}
    attackRange = {}
    abilityRange = {}
    pathPreview = {}
    damageNumbers = {}
    tileEffects = {}
    syncAttackRange = {}
    reactionPrompt = nil
    activeBorderPulse = 0
    turnTimer = turnTimerMax
    turnBanner = nil

    -- Build initiative order from data
    initiative = {}
    if data.initiative then
        for _, entry in ipairs(data.initiative) do
            initiative[#initiative + 1] = {
                unitId   = entry.unitId or entry.id,
                name     = entry.name or "?",
                ct       = entry.ct or 0,
                type     = entry.type or "enemy",
                isActive = entry.isActive or false,
            }
        end
    elseif data.units then
        for _, u in ipairs(data.units) do
            initiative[#initiative + 1] = {
                unitId   = u.id,
                name     = u.name or "Unit",
                ct       = u.ct or 0,
                type     = u.type or "enemy",
                isActive = false,
            }
        end
        -- Sort by CT descending
        table.sort(initiative, function(a, b) return a.ct > b.ct end)
    end

    combatUI.showTurnBanner("COMBAT START")
end

-- ============================================================================
-- Update
-- ============================================================================

function combatUI.update(dt)
    if not initialized then return end

    -- Turn timer countdown
    if isMyTurn and turnTimer > 0 then
        turnTimer = turnTimer - dt
        if turnTimer < 0 then turnTimer = 0 end
    end

    -- Turn banner animation
    if turnBanner then
        turnBanner.elapsed = turnBanner.elapsed + dt
        if turnBanner.elapsed >= turnBanner.duration then
            turnBanner = nil
        end
    end

    -- Active border pulse
    activeBorderPulse = activeBorderPulse + dt * 4

    -- Reaction prompt timer
    if reactionPrompt then
        reactionPrompt.elapsed = (reactionPrompt.elapsed or 0) + dt
        if reactionPrompt.elapsed >= (reactionPrompt.timer or 3) then
            reactionPrompt = nil
        end
    end

    -- Update hovered tile from mouse position (needs camera, so done in handleClick context)
end

-- ============================================================================
-- State Update (from server events)
-- ============================================================================

function combatUI.updateState(data)
    if not data or not initialized then return end

    -- Update unit data
    if data.units then
        combatData.units = data.units
    end

    -- Selective unit updates (from combat_result)
    if data.unitUpdates then
        for _, upd in ipairs(data.unitUpdates) do
            if combatData.units then
                for _, u in ipairs(combatData.units) do
                    if u.id == upd.id then
                        if upd.x ~= nil then u.x = upd.x end
                        if upd.y ~= nil then u.y = upd.y end
                        if upd.hp ~= nil then u.hp = upd.hp end
                        if upd.mp ~= nil then u.mp = upd.mp end
                        if upd.ap ~= nil then u.ap = upd.ap end
                        if upd.rp ~= nil then u.rp = upd.rp end
                        if upd.ct ~= nil then u.ct = upd.ct end
                        if upd.momentumShield ~= nil then u.momentumShield = upd.momentumShield end
                        if upd.statusEffects ~= nil then u.statusEffects = upd.statusEffects end
                        break
                    end
                end
            end
        end
    end

    -- Update initiative
    if data.initiative then
        initiative = {}
        for _, entry in ipairs(data.initiative) do
            initiative[#initiative + 1] = {
                unitId   = entry.unitId or entry.id,
                name     = entry.name or "?",
                ct       = entry.ct or 0,
                type     = entry.type or "enemy",
                isActive = entry.isActive or false,
            }
        end
    end

    -- Update tile effects
    if data.tileEffects then
        tileEffects = data.tileEffects
    end

    -- Turn number
    if data.turnNumber then
        turnNumber = data.turnNumber
    end
end

-- ============================================================================
-- Draw (main entry point)
-- ============================================================================

function combatUI.draw(cameraX, cameraY)
    if not initialized then return end

    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()

    -- World-space draws (affected by camera)
    combatUI.drawTileOverlays(cameraX, cameraY)
    combatUI.drawTileEffects(cameraX, cameraY)
    combatUI.drawUnitOverlays(cameraX, cameraY)

    -- Screen-space draws (fixed position)
    combatUI.drawInitiativeBar(W, H)
    combatUI.drawActionBar(W, H)
    combatUI.drawCombatHUD(W, H)
    combatUI.drawTurnTimer(W, H)
    combatUI.drawTurnBanner(W, H)
    combatUI.drawReactionPrompt(W, H)
end

-- ============================================================================
-- Tile Overlays (movement, attack, ability range)
-- ============================================================================

function combatUI.drawTileOverlays(cameraX, cameraY)
    local ts = TILE_SIZE
    local ox = -(cameraX or 0)
    local oy = -(cameraY or 0)

    -- Blue move range tiles
    if selectedAction == "move" or selectedAction == nil then
        for key, _ in pairs(moveRange) do
            local kx, ky = key:match("^(-?%d+),(-?%d+)$")
            if kx then
                local tx, ty = tonumber(kx), tonumber(ky)
                love.graphics.setColor(COLORS.move[1], COLORS.move[2], COLORS.move[3], COLORS.move[4])
                love.graphics.rectangle("fill", tx * ts + ox, ty * ts + oy, ts, ts)
            end
        end
    end

    -- Red attack range tiles
    if selectedAction == "attack" then
        for key, _ in pairs(attackRange) do
            local kx, ky = key:match("^(-?%d+),(-?%d+)$")
            if kx then
                local tx, ty = tonumber(kx), tonumber(ky)
                love.graphics.setColor(COLORS.attack[1], COLORS.attack[2], COLORS.attack[3], COLORS.attack[4])
                love.graphics.rectangle("fill", tx * ts + ox, ty * ts + oy, ts, ts)
            end
        end
    end

    -- Orange ability range tiles
    if selectedAction and selectedAction:sub(1, 7) == "ability" then
        for key, val in pairs(abilityRange) do
            local kx, ky = key:match("^(-?%d+),(-?%d+)$")
            if kx then
                local tx, ty = tonumber(kx), tonumber(ky)
                love.graphics.setColor(COLORS.ability[1], COLORS.ability[2], COLORS.ability[3], COLORS.ability[4])
                love.graphics.rectangle("fill", tx * ts + ox, ty * ts + oy, ts, ts)
            end
        end
    end

    -- Green sync attack range tiles
    for key, _ in pairs(syncAttackRange) do
        local kx, ky = key:match("^(-?%d+),(-?%d+)$")
        if kx then
            local tx, ty = tonumber(kx), tonumber(ky)
            love.graphics.setColor(COLORS.sync[1], COLORS.sync[2], COLORS.sync[3], COLORS.sync[4])
            love.graphics.rectangle("fill", tx * ts + ox, ty * ts + oy, ts, ts)
        end
    end

    -- White hovered tile highlight
    if hoveredTile then
        love.graphics.setColor(COLORS.hovered[1], COLORS.hovered[2], COLORS.hovered[3], COLORS.hovered[4])
        love.graphics.rectangle("fill", hoveredTile.x * ts + ox, hoveredTile.y * ts + oy, ts, ts)
        love.graphics.setColor(1, 1, 1, 0.5)
        love.graphics.rectangle("line", hoveredTile.x * ts + ox, hoveredTile.y * ts + oy, ts, ts)
    end

    -- Dotted path preview
    if #pathPreview > 1 then
        love.graphics.setColor(COLORS.path[1], COLORS.path[2], COLORS.path[3], COLORS.path[4])
        local dashLen = 4
        local gapLen = 4
        for i = 1, #pathPreview - 1 do
            local ax = pathPreview[i].x * ts + ts / 2 + ox
            local ay = pathPreview[i].y * ts + ts / 2 + oy
            local bx = pathPreview[i + 1].x * ts + ts / 2 + ox
            local by = pathPreview[i + 1].y * ts + ts / 2 + oy
            -- Simple dashed line approximation
            local dx = bx - ax
            local dy = by - ay
            local dist = math.sqrt(dx * dx + dy * dy)
            if dist > 0 then
                local nx, ny = dx / dist, dy / dist
                local drawn = 0
                local drawing = true
                while drawn < dist do
                    local segLen = drawing and dashLen or gapLen
                    segLen = math_min(segLen, dist - drawn)
                    if drawing then
                        love.graphics.line(
                            ax + nx * drawn, ay + ny * drawn,
                            ax + nx * (drawn + segLen), ay + ny * (drawn + segLen)
                        )
                    end
                    drawn = drawn + segLen
                    drawing = not drawing
                end
            end
        end
        -- Draw circle at destination
        local last = pathPreview[#pathPreview]
        love.graphics.setColor(1, 1, 1, 0.7)
        love.graphics.circle("line", last.x * ts + ts / 2 + ox, last.y * ts + ts / 2 + oy, 6)
    end
end

-- ============================================================================
-- Tile Effects (burning, frozen, etc.)
-- ============================================================================

function combatUI.drawTileEffects(cameraX, cameraY)
    local ts = TILE_SIZE
    local ox = -(cameraX or 0)
    local oy = -(cameraY or 0)
    local t = love.timer.getTime()

    for _, eff in ipairs(tileEffects) do
        local col = COLORS.tileEffectColors[eff.type]
        if col then
            local alpha = col[4] or 0.4
            -- Per-type animation
            if eff.type == "BURNING" then
                -- Flickering alpha
                alpha = alpha + math_sin(t * 8 + eff.x * 3.7 + eff.y * 2.3) * 0.15
            elseif eff.type == "SMOKE" then
                -- Slow drift
                alpha = alpha + math_sin(t * 2 + eff.x * 1.1) * 0.08
            elseif eff.type == "ELECTRIFIED" then
                -- Rapid flicker
                alpha = alpha + math_sin(t * 15 + eff.x * 5) * 0.2
            end
            alpha = math_max(0.05, math_min(alpha, 0.8))
            love.graphics.setColor(col[1], col[2], col[3], alpha)
            love.graphics.rectangle("fill", eff.x * ts + ox, eff.y * ts + oy, ts, ts)
        end
    end
end

-- ============================================================================
-- Unit Overlays (HP bars, status icons, active border)
-- ============================================================================

function combatUI.drawUnitOverlays(cameraX, cameraY)
    if not combatData or not combatData.units then return end
    local ts = TILE_SIZE
    local ox = -(cameraX or 0)
    local oy = -(cameraY or 0)
    local t = love.timer.getTime()

    for _, unit in ipairs(combatData.units) do
        if (unit.hp or 0) > 0 then
            local px = unit.x * ts + ox
            local py = unit.y * ts + oy

            -- Active unit pulsing gold border
            local unitIsActive = false
            for _, ini in ipairs(initiative) do
                if ini.unitId == unit.id and ini.isActive then
                    unitIsActive = true
                    break
                end
            end
            if unitIsActive then
                local pulse = 0.6 + math_sin(activeBorderPulse) * 0.4
                love.graphics.setColor(COLORS.activeBorder[1], COLORS.activeBorder[2], COLORS.activeBorder[3], pulse)
                love.graphics.setLineWidth(2)
                love.graphics.rectangle("line", px - 1, py - 1, ts + 2, ts + 2)
                love.graphics.setLineWidth(1)
            end

            -- HP bar above unit
            local barW = ts - 4
            local barH = 3
            local barX = px + 2
            local barY = py - 6
            local maxHp = unit.maxHp or 100
            local hp = unit.hp or 0
            local ratio = maxHp > 0 and (hp / maxHp) or 0

            -- Bar background
            love.graphics.setColor(0, 0, 0, 0.7)
            love.graphics.rectangle("fill", barX - 1, barY - 1, barW + 2, barH + 2)

            -- Bar fill (green > yellow > red based on ratio)
            local r, g
            if ratio > 0.5 then
                r = (1 - ratio) * 2
                g = 0.8
            else
                r = 0.9
                g = ratio * 1.6
            end
            love.graphics.setColor(r, g, 0, 0.9)
            love.graphics.rectangle("fill", barX, barY, barW * math_max(ratio, 0), barH)

            -- Momentum shield bar (cyan, below HP)
            local shield = unit.momentumShield or 0
            if shield > 0 then
                local shieldMax = unit.maxMp or unit.mp or 3
                local shieldRatio = shieldMax > 0 and (shield / shieldMax) or 0
                love.graphics.setColor(0.3, 0.8, 1, 0.8)
                love.graphics.rectangle("fill", barX, barY + barH + 1, barW * math_min(shieldRatio, 1), 2)
            end

            -- Status effect icons (small colored dots above HP bar)
            if unit.statusEffects and #unit.statusEffects > 0 then
                local dotSize = 4
                local dotY = barY - dotSize - 2
                local startX = barX
                for si, se in ipairs(unit.statusEffects) do
                    if si > 6 then break end -- max 6 visible icons
                    local dotX = startX + (si - 1) * (dotSize + 2)
                    local statusColor = COLORS.tileEffectColors[se.type or se.name or ""]
                    if statusColor then
                        love.graphics.setColor(statusColor[1], statusColor[2], statusColor[3], 0.9)
                    elseif se.positive then
                        love.graphics.setColor(0.3, 0.9, 0.3, 0.9)
                    else
                        love.graphics.setColor(0.9, 0.3, 0.3, 0.9)
                    end
                    love.graphics.rectangle("fill", dotX, dotY, dotSize, dotSize)
                end
            end
        end
    end
end

-- ============================================================================
-- Initiative Bar (top of screen)
-- ============================================================================

function combatUI.drawInitiativeBar(W, H)
    local barH = INITIATIVE_BAR_HEIGHT
    local portSize = INITIATIVE_PORTRAIT_SIZE

    -- Background
    love.graphics.setColor(0, 0, 0, 0.75)
    love.graphics.rectangle("fill", 0, 0, W, barH)
    love.graphics.setColor(0.3, 0.3, 0.4, 0.5)
    love.graphics.line(0, barH, W, barH)

    if #initiative == 0 then return end

    local totalW = #initiative * (portSize + 8)
    local startX = math_floor((W - totalW) / 2)
    local portY = math_floor((barH - portSize - 8) / 2) + 2
    local font = getFont(12)
    local smallFont = getFont(9)

    for i, entry in ipairs(initiative) do
        local ix = startX + (i - 1) * (portSize + 8)

        -- Portrait box
        local isPlayer = (entry.type == "player")
        local isDead = (entry.ct or 0) < 0

        if isDead then
            love.graphics.setColor(0.2, 0.2, 0.2, 0.5)
        else
            love.graphics.setColor(0.15, 0.15, 0.2, 0.9)
        end
        love.graphics.rectangle("fill", ix, portY, portSize, portSize, 3, 3)

        -- Border color
        if entry.isActive then
            local pulse = 0.7 + math_sin(activeBorderPulse) * 0.3
            love.graphics.setColor(COLORS.activeBorder[1], COLORS.activeBorder[2], COLORS.activeBorder[3], pulse)
            love.graphics.setLineWidth(2)
        elseif isPlayer then
            local pIdx = 1
            if combatData and combatData.units then
                local pi = 0
                for _, u in ipairs(combatData.units) do
                    if u.type == "player" then
                        pi = pi + 1
                        if u.id == entry.unitId then pIdx = pi; break end
                    end
                end
            end
            local c = COLORS.playerBorders[((pIdx - 1) % 4) + 1]
            love.graphics.setColor(c[1], c[2], c[3], isDead and 0.3 or 0.9)
            love.graphics.setLineWidth(1)
        else
            love.graphics.setColor(COLORS.enemyBorder[1], COLORS.enemyBorder[2], COLORS.enemyBorder[3], isDead and 0.3 or 0.9)
            love.graphics.setLineWidth(1)
        end
        love.graphics.rectangle("line", ix, portY, portSize, portSize, 3, 3)
        love.graphics.setLineWidth(1)

        -- Unit initial letter
        local initial = (entry.name or "?"):sub(1, 1):upper()
        love.graphics.setFont(font)
        if isDead then
            love.graphics.setColor(0.4, 0.4, 0.4, 0.5)
        elseif isPlayer then
            love.graphics.setColor(0.9, 0.9, 1, 0.9)
        else
            love.graphics.setColor(1, 0.7, 0.7, 0.9)
        end
        local tw = font:getWidth(initial)
        love.graphics.print(initial, ix + math_floor((portSize - tw) / 2), portY + math_floor((portSize - font:getHeight()) / 2))

        -- Dead X overlay
        if isDead then
            love.graphics.setColor(0.8, 0.2, 0.2, 0.6)
            love.graphics.setLineWidth(2)
            love.graphics.line(ix + 4, portY + 4, ix + portSize - 4, portY + portSize - 4)
            love.graphics.line(ix + portSize - 4, portY + 4, ix + 4, portY + portSize - 4)
            love.graphics.setLineWidth(1)
        end

        -- CT fill bar underneath portrait
        local ctBarY = portY + portSize + 2
        local ctBarH = 3
        local ctVal = math_max(0, math_min(entry.ct or 0, 100))
        love.graphics.setColor(0.2, 0.2, 0.3, 0.8)
        love.graphics.rectangle("fill", ix, ctBarY, portSize, ctBarH)
        if ctVal > 0 and not isDead then
            local ctRatio = ctVal / 100
            if entry.isActive then
                love.graphics.setColor(1, 0.85, 0, 0.9)
            elseif isPlayer then
                love.graphics.setColor(0.3, 0.6, 1, 0.9)
            else
                love.graphics.setColor(0.8, 0.3, 0.3, 0.9)
            end
            love.graphics.rectangle("fill", ix, ctBarY, portSize * ctRatio, ctBarH)
        end
    end

    -- Turn number (right side of initiative bar)
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.7, 0.7, 0.8, 0.8)
    local turnText = "Turn " .. turnNumber
    if turnNumber >= 12 then
        love.graphics.setColor(1, 0.3, 0.3, 0.9)
    end
    love.graphics.print(turnText, W - smallFont:getWidth(turnText) - 10, 4)
end

-- ============================================================================
-- Action Bar (bottom center)
-- ============================================================================

function combatUI.drawActionBar(W, H)
    W = W or love.graphics.getWidth()
    H = H or love.graphics.getHeight()
    local barH = ACTION_BAR_HEIGHT
    local slotSize = ACTION_SLOT_SIZE
    local totalW = ACTION_SLOTS * (slotSize + 6) - 6
    local barX = math_floor((W - totalW) / 2) - 10
    local barY = H - barH - 6

    -- Background
    love.graphics.setColor(0, 0, 0, 0.75)
    love.graphics.rectangle("fill", barX - 8, barY - 4, totalW + 16, barH + 8, 6, 6)
    love.graphics.setColor(0.3, 0.3, 0.4, 0.5)
    love.graphics.rectangle("line", barX - 8, barY - 4, totalW + 16, barH + 8, 6, 6)

    local keys   = {"1",   "2",  "3",  "4",  "Q",    "Spc"}
    local actions = {"attack", "ability1", "ability2", "ability3", "wait", "end_turn"}

    local font = getFont(11)
    local smallFont = getFont(9)
    local tinyFont = getFont(8)
    local myUnit = getMyUnit()

    for i = 1, ACTION_SLOTS do
        local sx = barX + (i - 1) * (slotSize + 6)
        local sy = barY + 2

        local isSelected = (selectedAction == actions[i])
        local isDisabled = not isMyTurn
        local isEmptySlot = false  -- true if ability slot has no card equipped

        -- Resolve the display label for this slot
        local label
        if i == 1 then
            label = "ATK"
        elseif i >= 2 and i <= 4 then
            local cardIdx = i - 1
            local cardInfo = equippedCardData[cardIdx]
            if cardInfo and cardInfo.name then
                label = cardInfo.name
            else
                -- Check unit equippedCards as fallback (if server provides them)
                local unitCards = (myUnit and myUnit.equippedCards) or {}
                local unitCard = unitCards[cardIdx]
                if unitCard and type(unitCard) == "table" and unitCard.name then
                    label = unitCard.name
                elseif unitCard then
                    -- Card exists but no name data available
                    label = "C" .. cardIdx
                else
                    label = "Empty"
                    isEmptySlot = true
                end
            end
        elseif i == 5 then
            label = "WAIT"
        else
            label = "END"
        end

        -- Check specific disabled conditions
        if not isDisabled and myUnit then
            if i == 1 and (myUnit.ap or 0) <= 0 then
                isDisabled = true
            elseif i >= 2 and i <= 4 then
                if isEmptySlot then
                    isDisabled = true
                elseif (myUnit.ap or 0) <= 0 then
                    isDisabled = true
                end
            end
        end
        -- Empty ability slots are always disabled regardless of turn state
        if isEmptySlot then
            isDisabled = true
        end

        -- Slot background
        if isDisabled and isEmptySlot then
            love.graphics.setColor(0.1, 0.1, 0.12, 0.5)
        elseif isDisabled then
            love.graphics.setColor(0.15, 0.15, 0.18, 0.7)
        elseif isSelected then
            love.graphics.setColor(0.25, 0.3, 0.4, 0.9)
        else
            love.graphics.setColor(0.18, 0.18, 0.22, 0.9)
        end
        love.graphics.rectangle("fill", sx, sy, slotSize, slotSize, 4, 4)

        -- Slot border
        if isSelected then
            love.graphics.setColor(1, 0.85, 0, 0.9)
            love.graphics.setLineWidth(2)
        elseif isDisabled then
            love.graphics.setColor(0.3, 0.3, 0.35, 0.4)
            love.graphics.setLineWidth(1)
        else
            love.graphics.setColor(0.5, 0.5, 0.6, 0.6)
            love.graphics.setLineWidth(1)
        end
        love.graphics.rectangle("line", sx, sy, slotSize, slotSize, 4, 4)
        love.graphics.setLineWidth(1)

        -- Label text: use printf with word-wrap for long ability names
        if isEmptySlot then
            love.graphics.setColor(0.35, 0.35, 0.4, 0.4)
        elseif isDisabled then
            love.graphics.setColor(0.4, 0.4, 0.45, 0.5)
        elseif isSelected then
            love.graphics.setColor(1, 0.95, 0.8, 1)
        else
            love.graphics.setColor(0.8, 0.8, 0.85, 0.9)
        end

        -- For ability slots (i=2..4) with long names, use smaller font and word-wrap
        local isAbilitySlot = (i >= 2 and i <= 4 and not isEmptySlot)
        local labelFont = font
        if isAbilitySlot and font:getWidth(label) > slotSize - 4 then
            labelFont = tinyFont
            -- Truncate if still too wide even with tiny font
            if tinyFont:getWidth(label) > (slotSize - 4) * 2 then
                -- Truncate to fit roughly 2 lines
                local maxChars = #label
                while maxChars > 1 and tinyFont:getWidth(label:sub(1, maxChars) .. "..") > (slotSize - 4) * 2 do
                    maxChars = maxChars - 1
                end
                label = label:sub(1, maxChars) .. ".."
            end
        end
        love.graphics.setFont(labelFont)

        if isAbilitySlot and labelFont == tinyFont then
            -- Multi-line centered rendering for long ability names
            love.graphics.printf(label, sx + 2, sy + 4, slotSize - 4, "center")
        else
            -- Single-line centered rendering for short labels
            local lw = labelFont:getWidth(label)
            love.graphics.print(label, sx + math_floor((slotSize - lw) / 2), sy + math_floor((slotSize - labelFont:getHeight()) / 2))
        end

        -- Key hint below slot
        love.graphics.setFont(smallFont)
        love.graphics.setColor(0.5, 0.5, 0.55, 0.6)
        local kw = smallFont:getWidth(keys[i])
        love.graphics.print(keys[i], sx + math_floor((slotSize - kw) / 2), sy + slotSize + 2)
    end
end

-- ============================================================================
-- Combat HUD (left side)
-- ============================================================================

function combatUI.drawCombatHUD(W, H)
    local myUnit = getMyUnit()
    if not myUnit then return end

    local hudX = HUD_PADDING
    local hudY = INITIATIVE_BAR_HEIGHT + HUD_PADDING
    local hudW = HUD_WIDTH

    -- Background
    love.graphics.setColor(0, 0, 0, 0.7)
    love.graphics.rectangle("fill", hudX - 4, hudY - 4, hudW + 8, 200, 6, 6)

    local font = getFont(12)
    local smallFont = getFont(10)
    local tinyFont = getFont(9)
    local y = hudY

    -- HP bar (large)
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.9, 0.9, 0.9, 0.8)
    love.graphics.print("HP", hudX, y)
    y = y + 14

    local barW = hudW - 4
    local barH = 14
    local hp = myUnit.hp or 0
    local maxHp = myUnit.maxHp or 100
    local hpRatio = maxHp > 0 and (hp / maxHp) or 0

    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", hudX, y, barW, barH)
    local r, g = 0.9, 0.8 * hpRatio
    if hpRatio > 0.5 then r = (1 - hpRatio) * 2; g = 0.8 end
    love.graphics.setColor(r, g, 0, 0.9)
    love.graphics.rectangle("fill", hudX, y, barW * math_max(hpRatio, 0), barH)
    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.setFont(tinyFont)
    love.graphics.printf(math_floor(hp) .. " / " .. math_floor(maxHp), hudX, y + 2, barW, "center")
    y = y + barH + 6

    -- Mana bar (if applicable)
    local maxMana = myUnit.maxMana or myUnit.maxMp or 0
    if maxMana > 0 then
        love.graphics.setFont(smallFont)
        love.graphics.setColor(0.6, 0.7, 1, 0.8)
        love.graphics.print("Mana", hudX, y)
        y = y + 14
        local mana = myUnit.mana or 0
        local manaRatio = maxMana > 0 and (mana / maxMana) or 0
        love.graphics.setColor(0, 0, 0, 0.6)
        love.graphics.rectangle("fill", hudX, y, barW, 10)
        love.graphics.setColor(0.2, 0.4, 0.9, 0.9)
        love.graphics.rectangle("fill", hudX, y, barW * manaRatio, 10)
        love.graphics.setColor(1, 1, 1, 0.8)
        love.graphics.setFont(tinyFont)
        love.graphics.printf(math_floor(mana) .. " / " .. math_floor(maxMana), hudX, y, barW, "center")
        y = y + 14
    end

    -- MP dots
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.8, 0.8, 0.9, 0.8)
    love.graphics.print("MP", hudX, y)
    local mpMax = myUnit.maxMp or 3
    local mpCur = myUnit.mp or 0
    local dotSize = 8
    local dotGap = 4
    local dotStartX = hudX + 28
    for d = 1, mpMax do
        if d <= mpCur then
            love.graphics.setColor(0.3, 0.5, 1, 0.9)
            love.graphics.circle("fill", dotStartX + (d - 1) * (dotSize + dotGap), y + 6, dotSize / 2)
        else
            love.graphics.setColor(0.3, 0.3, 0.4, 0.5)
            love.graphics.circle("line", dotStartX + (d - 1) * (dotSize + dotGap), y + 6, dotSize / 2)
        end
    end
    y = y + 18

    -- AP dot
    love.graphics.setFont(smallFont)
    love.graphics.setColor(0.8, 0.8, 0.9, 0.8)
    love.graphics.print("AP", hudX, y)
    local ap = myUnit.ap or 0
    if ap > 0 then
        love.graphics.setColor(1, 0.85, 0.2, 0.9)
        love.graphics.circle("fill", dotStartX, y + 6, dotSize / 2)
    else
        love.graphics.setColor(0.3, 0.3, 0.4, 0.5)
        love.graphics.circle("line", dotStartX, y + 6, dotSize / 2)
    end

    -- RP dot
    love.graphics.setColor(0.8, 0.8, 0.9, 0.8)
    love.graphics.print("RP", hudX + 56, y)
    local rp = myUnit.rp or 0
    if rp > 0 then
        love.graphics.setColor(0.5, 0.8, 1, 0.9)
        love.graphics.circle("fill", dotStartX + 56, y + 6, dotSize / 2)
    else
        love.graphics.setColor(0.3, 0.3, 0.4, 0.5)
        love.graphics.circle("line", dotStartX + 56, y + 6, dotSize / 2)
    end
    y = y + 18

    -- Momentum Shield
    local shield = myUnit.momentumShield or 0
    if shield > 0 then
        love.graphics.setColor(0.3, 0.8, 1, 0.9)
        love.graphics.setFont(smallFont)
        love.graphics.print("Shield: " .. shield, hudX, y)
        y = y + 16
    end

    -- Turn number
    love.graphics.setFont(tinyFont)
    love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
    love.graphics.print("Turn " .. turnNumber, hudX, y)
    y = y + 14

    -- Exhaustion warning
    if turnNumber >= 10 then
        love.graphics.setFont(smallFont)
        if turnNumber >= 12 then
            local flash = 0.6 + math_sin(love.timer.getTime() * 6) * 0.4
            love.graphics.setColor(1, 0.15, 0.15, flash)
            love.graphics.print("EXHAUSTION!", hudX, y)
        else
            love.graphics.setColor(1, 0.8, 0.2, 0.9)
            love.graphics.print("Exhaustion soon...", hudX, y)
        end
    end
end

-- ============================================================================
-- Turn Banner (center screen)
-- ============================================================================

function combatUI.drawTurnBanner(W, H)
    if not turnBanner then return end

    local elapsed = turnBanner.elapsed
    local duration = turnBanner.duration
    local text = turnBanner.text

    -- Fade phases: in 0-0.2, hold 0.2-0.5, out 0.5-0.8
    local alpha = 0
    local fadeIn = 0.2
    local holdEnd = 0.5
    local fadeOut = duration

    if elapsed < fadeIn then
        alpha = elapsed / fadeIn
    elseif elapsed < holdEnd then
        alpha = 1
    elseif elapsed < fadeOut then
        alpha = 1 - (elapsed - holdEnd) / (fadeOut - holdEnd)
    end
    alpha = math_max(0, math_min(alpha, 1))

    if alpha <= 0 then return end

    local isEnemy = (text == "ENEMY TURN")
    local isVictory = (text == "VICTORY")
    local isDefeat = (text == "DEFEAT")

    -- Shadow
    local bigFont = getFont(isEnemy and 28 or 36)
    love.graphics.setFont(bigFont)

    local textW = bigFont:getWidth(text)
    local tx = math_floor((W - textW) / 2)
    local ty = math_floor(H / 2 - bigFont:getHeight() / 2) - 20

    -- Gold shadow for YOUR TURN / VICTORY
    if not isEnemy and not isDefeat then
        love.graphics.setColor(0.8, 0.6, 0, alpha * 0.5)
        love.graphics.print(text, tx + 2, ty + 2)
    end

    -- Main text
    if isEnemy then
        love.graphics.setColor(0.9, 0.25, 0.25, alpha)
    elseif isVictory then
        love.graphics.setColor(0.2, 1, 0.3, alpha)
    elseif isDefeat then
        love.graphics.setColor(0.9, 0.15, 0.15, alpha)
    else
        love.graphics.setColor(1, 1, 1, alpha)
    end
    love.graphics.print(text, tx, ty)
end

-- ============================================================================
-- Turn Timer
-- ============================================================================

function combatUI.drawTurnTimer(W, H)
    if not isMyTurn then return end

    local timerX = W - 60
    local timerY = INITIATIVE_BAR_HEIGHT + 8
    local seconds = math.ceil(math_max(turnTimer, 0))
    local font = getFont(20)

    love.graphics.setFont(font)

    -- Color by time remaining
    local r, g, b = 1, 1, 1
    if seconds <= 5 then
        local flash = 0.6 + math_sin(love.timer.getTime() * 8) * 0.4
        r, g, b = 1, 0.2, 0.2
        love.graphics.setColor(r, g, b, flash)
    elseif seconds <= 10 then
        r, g, b = 1, 0.85, 0.2
        love.graphics.setColor(r, g, b, 0.9)
    else
        love.graphics.setColor(r, g, b, 0.7)
    end

    local text = tostring(seconds)
    local tw = font:getWidth(text)
    love.graphics.print(text, timerX + math_floor((40 - tw) / 2), timerY)
end

-- ============================================================================
-- Reaction Prompt
-- ============================================================================

function combatUI.drawReactionPrompt(W, H)
    if not reactionPrompt then return end

    local options = reactionPrompt.options or {}
    if #options == 0 then return end

    local boxW = 200
    local btnH = 32
    local boxH = 40 + #options * (btnH + 4) + 30
    local boxX = W - boxW - 40
    local boxY = math_floor(H / 2 - boxH / 2)

    -- Background
    love.graphics.setColor(0, 0, 0, 0.85)
    love.graphics.rectangle("fill", boxX, boxY, boxW, boxH, 6, 6)
    love.graphics.setColor(0.8, 0.4, 0.1, 0.8)
    love.graphics.rectangle("line", boxX, boxY, boxW, boxH, 6, 6)

    -- Title
    local font = getFont(13)
    local smallFont = getFont(11)
    love.graphics.setFont(font)
    love.graphics.setColor(1, 0.85, 0.5, 1)
    love.graphics.printf("REACTION", boxX, boxY + 8, boxW, "center")

    -- Timer bar
    local timeLeft = math_max(0, (reactionPrompt.timer or 3) - (reactionPrompt.elapsed or 0))
    local timerRatio = (reactionPrompt.timer or 3) > 0 and (timeLeft / (reactionPrompt.timer or 3)) or 0
    love.graphics.setColor(0.3, 0.3, 0.3, 0.6)
    love.graphics.rectangle("fill", boxX + 10, boxY + 26, boxW - 20, 4)
    love.graphics.setColor(0.9, 0.6, 0.1, 0.9)
    love.graphics.rectangle("fill", boxX + 10, boxY + 26, (boxW - 20) * timerRatio, 4)

    -- Option buttons
    local btnY = boxY + 38
    love.graphics.setFont(smallFont)
    for i, opt in ipairs(options) do
        local bx = boxX + 10
        local by = btnY + (i - 1) * (btnH + 4)
        local bw = boxW - 20

        -- Button
        love.graphics.setColor(0.2, 0.2, 0.25, 0.9)
        love.graphics.rectangle("fill", bx, by, bw, btnH, 4, 4)
        love.graphics.setColor(0.6, 0.6, 0.7, 0.7)
        love.graphics.rectangle("line", bx, by, bw, btnH, 4, 4)

        -- Label
        local label = opt.name or opt.label or opt
        if type(label) ~= "string" then label = tostring(label) end
        love.graphics.setColor(0.9, 0.9, 0.95, 0.95)
        love.graphics.printf(label, bx, by + math_floor((btnH - smallFont:getHeight()) / 2), bw, "center")
    end
end

-- ============================================================================
-- Internal: recalculate abilityRange after selecting an ability action
-- ============================================================================

local function updateAbilityRangeForAction(action)
    abilityRange = {}
    if not action or action:sub(1, 7) ~= "ability" then return end
    local abilityIdx = tonumber(action:sub(8))
    if not abilityIdx then return end
    local myUnit = getMyUnit()
    if not myUnit then return end
    abilityRange = combatUI.calculateAbilityRange(myUnit, abilityIdx)
end

-- ============================================================================
-- Input: Mouse Click
-- ============================================================================

function combatUI.handleClick(x, y, cameraX, cameraY)
    if not initialized then return nil end

    local W = love.graphics.getWidth()
    local H = love.graphics.getHeight()

    -- Check reaction prompt buttons first
    if reactionPrompt and reactionPrompt.options then
        local options = reactionPrompt.options
        local boxW = 200
        local btnH = 32
        local boxH = 40 + #options * (btnH + 4) + 30
        local boxX = W - boxW - 40
        local boxY = math_floor(H / 2 - boxH / 2)
        local btnY = boxY + 38

        for i, opt in ipairs(options) do
            local bx = boxX + 10
            local by = btnY + (i - 1) * (btnH + 4)
            local bw = boxW - 20
            if x >= bx and x <= bx + bw and y >= by and y <= by + btnH then
                local choice = opt.id or opt.name or opt.label or opt
                if type(choice) ~= "string" then choice = tostring(choice) end
                reactionPrompt = nil
                return { type = "reaction", data = { choice = choice } }
            end
        end
    end

    -- Check action bar clicks
    local barH = ACTION_BAR_HEIGHT
    local slotSize = ACTION_SLOT_SIZE
    local totalW = ACTION_SLOTS * (slotSize + 6) - 6
    local barX = math_floor((W - totalW) / 2) - 10
    local barY = H - barH - 6

    local actions = {"attack", "ability1", "ability2", "ability3", "wait", "end_turn"}

    if y >= barY - 4 and y <= barY + barH + 4 then
        for i = 1, ACTION_SLOTS do
            local sx = barX + (i - 1) * (slotSize + 6)
            local sy = barY + 2
            if x >= sx and x <= sx + slotSize and y >= sy and y <= sy + slotSize then
                if not isMyTurn then return nil end

                if actions[i] == "wait" then
                    selectedAction = nil
                    abilityRange = {}
                    audio.playClick()
                    return { type = "wait", data = {} }
                elseif actions[i] == "end_turn" then
                    selectedAction = nil
                    abilityRange = {}
                    audio.playClick()
                    return { type = "end_turn", data = {} }
                else
                    selectedAction = actions[i]
                    updateAbilityRangeForAction(selectedAction)
                    audio.playClick()
                    return nil -- action selected, waiting for tile target
                end
            end
        end
    end

    -- Check tile clicks (world space)
    if not isMyTurn then return nil end

    local worldX = x + (cameraX or 0)
    local worldY = y + (cameraY or 0)
    local tileX = math_floor(worldX / TILE_SIZE)
    local tileY = math_floor(worldY / TILE_SIZE)
    local key = tileKey(tileX, tileY)

    -- Move action
    if selectedAction == "move" or selectedAction == nil then
        if moveRange[key] then
            selectedAction = nil
            return { type = "move", data = { x = tileX, y = tileY } }
        end
    end

    -- Attack action
    if selectedAction == "attack" then
        if attackRange[key] then
            local target = getUnitAt(tileX, tileY)
            if target and isEnemy(target) then
                selectedAction = nil
                audio.playSwordDraw()
                return { type = "attack", data = { targetId = target.id, x = tileX, y = tileY } }
            end
        end
        return nil
    end

    -- Ability action
    if selectedAction and selectedAction:sub(1, 7) == "ability" then
        if abilityRange[key] then
            local abilityIdx = tonumber(selectedAction:sub(8))
            selectedAction = nil
            abilityRange = {}
            return { type = "ability", data = { abilityIndex = abilityIdx, x = tileX, y = tileY } }
        end
        return nil
    end

    -- No explicit action selected: auto-select based on tile content
    if selectedAction == nil then
        local target = getUnitAt(tileX, tileY)
        if target and isEnemy(target) and attackRange[key] then
            return { type = "attack", data = { targetId = target.id, x = tileX, y = tileY } }
        end
        if moveRange[key] then
            return { type = "move", data = { x = tileX, y = tileY } }
        end
    end

    return nil
end

-- ============================================================================
-- Input: Key Press
-- ============================================================================

function combatUI.handleKey(key)
    if not initialized then return nil end

    if key == "escape" then
        selectedAction = nil
        abilityRange = {}
        return nil
    end

    if not isMyTurn then return nil end

    if key == "1" then
        if selectedAction == "attack" then
            -- Already selected; could confirm if cursor on valid target
            return nil
        end
        selectedAction = "attack"
        abilityRange = {}
        return nil
    elseif key == "2" then
        selectedAction = "ability1"
        updateAbilityRangeForAction(selectedAction)
        return nil
    elseif key == "3" then
        selectedAction = "ability2"
        updateAbilityRangeForAction(selectedAction)
        return nil
    elseif key == "4" then
        selectedAction = "ability3"
        updateAbilityRangeForAction(selectedAction)
        return nil
    elseif key == "q" then
        selectedAction = nil
        abilityRange = {}
        return { type = "wait", data = {} }
    elseif key == "space" then
        selectedAction = nil
        abilityRange = {}
        return { type = "end_turn", data = {} }
    end

    return nil
end

-- ============================================================================
-- Input: Mouse Move (update hovered tile and path preview)
-- ============================================================================

function combatUI.handleMouseMove(x, y, cameraX, cameraY)
    if not initialized then return end

    local worldX = x + (cameraX or 0)
    local worldY = y + (cameraY or 0)
    local tileX = math_floor(worldX / TILE_SIZE)
    local tileY = math_floor(worldY / TILE_SIZE)

    hoveredTile = { x = tileX, y = tileY }

    -- Update path preview if hovering a move-range tile
    local myUnit = getMyUnit()
    if myUnit and moveRange[tileKey(tileX, tileY)] and (selectedAction == "move" or selectedAction == nil) then
        local grid = combatData and combatData.grid or nil
        local units = combatData and combatData.units or nil
        pathPreview = bfsPath(myUnit.x, myUnit.y, tileX, tileY, grid, units)
        -- Prepend player position for path drawing
        if #pathPreview > 0 then
            table.insert(pathPreview, 1, {x = myUnit.x, y = myUnit.y})
        end
    else
        pathPreview = {}
    end
end

-- ============================================================================
-- Public Setters
-- ============================================================================

function combatUI.showTurnBanner(text)
    turnBanner = {
        text = text or "",
        elapsed = 0,
        duration = 0.8,
    }
    audio.playTurnBanner()
end

function combatUI.setMyTurn(isTurn, turnData)
    isMyTurn = isTurn
    turnTimer = turnTimerMax
    selectedAction = nil
    pathPreview = {}

    if isTurn then
        combatUI.showTurnBanner("YOUR TURN")

        -- Calculate ranges from turnData or current unit state
        local myUnit = getMyUnit()
        if myUnit then
            local grid = combatData and combatData.grid or nil
            local units = combatData and combatData.units or nil
            local mp = myUnit.mp or myUnit.maxMp or 3

            -- Update unit resources from turnData
            if turnData then
                if turnData.mp ~= nil then myUnit.mp = turnData.mp; mp = turnData.mp end
                if turnData.ap ~= nil then myUnit.ap = turnData.ap end
                if turnData.rp ~= nil then myUnit.rp = turnData.rp end
            end

            moveRange = combatUI.calculateMoveRange(myUnit, grid, units)
            attackRange = combatUI.calculateAttackRange(myUnit, units)
        else
            moveRange = {}
            attackRange = {}
        end
        abilityRange = {}
        syncAttackRange = {}
    else
        if not isTurn and turnBanner and turnBanner.text == "YOUR TURN" then
            -- Don't overwrite an existing non-turn banner
        end
        moveRange = {}
        attackRange = {}
        abilityRange = {}
        syncAttackRange = {}
    end
end

function combatUI.calculateMoveRange(unit, grid, units)
    if not unit then return {} end
    local mp = unit.mp or unit.maxMp or 3
    return bfsFloodFill(unit.x, unit.y, mp, grid, units)
end

function combatUI.calculateAttackRange(unit, units)
    if not unit then return {} end
    local result = {}
    local combat = unit.combat or {}
    local weaponRange = combat.attackRange or 1

    if weaponRange <= 1 then
        -- Melee: tiles adjacent to current position and all reachable positions
        local positions = {{x = unit.x, y = unit.y}}
        -- Also include all move range positions for melee reach
        for key, _ in pairs(moveRange) do
            local kx, ky = key:match("^(-?%d+),(-?%d+)$")
            if kx then
                positions[#positions + 1] = {x = tonumber(kx), y = tonumber(ky)}
            end
        end
        local dirs = {{0, -1}, {0, 1}, {-1, 0}, {1, 0}}
        for _, pos in ipairs(positions) do
            for _, d in ipairs(dirs) do
                local nx = pos.x + d[1]
                local ny = pos.y + d[2]
                local key = tileKey(nx, ny)
                -- Only mark if an enemy is there
                if units then
                    for _, u in ipairs(units) do
                        if u.x == nx and u.y == ny and (u.hp or 0) > 0 and isEnemy(u) then
                            result[key] = true
                            break
                        end
                    end
                end
            end
        end
    else
        -- Ranged: all tiles within weapon range from current position
        for dy = -weaponRange, weaponRange do
            for dx = -weaponRange, weaponRange do
                local dist = math_abs(dx) + math_abs(dy)
                if dist > 0 and dist <= weaponRange then
                    local nx = unit.x + dx
                    local ny = unit.y + dy
                    local key = tileKey(nx, ny)
                    -- Only mark if an enemy is there
                    if units then
                        for _, u in ipairs(units) do
                            if u.x == nx and u.y == ny and (u.hp or 0) > 0 and isEnemy(u) then
                                result[key] = true
                                break
                            end
                        end
                    end
                end
            end
        end
    end
    return result
end

function combatUI.calculateAbilityRange(unit, abilityIdx)
    if not unit then return {} end
    local card = equippedCardData[abilityIdx]
    local abilityRange_val = (card and card.range) or 3  -- default range 3 if no data
    if abilityRange_val <= 0 then
        -- Self-target abilities (range 0): only the caster's tile
        local result = {}
        result[tileKey(unit.x, unit.y)] = true
        return result
    end
    -- BFS flood fill by Manhattan distance only (abilities can target over walls)
    local result = {}
    for dy = -abilityRange_val, abilityRange_val do
        for dx = -abilityRange_val, abilityRange_val do
            local dist = math_abs(dx) + math_abs(dy)
            if dist > 0 and dist <= abilityRange_val then
                result[tileKey(unit.x + dx, unit.y + dy)] = true
            end
        end
    end
    return result
end

function combatUI.calculatePathPreview(fromX, fromY, toX, toY, grid, units)
    return bfsPath(fromX, fromY, toX, toY, grid, units)
end

function combatUI.setEquippedCards(cards)
    equippedCardData = {}
    if not cards then return end
    for i, card in ipairs(cards) do
        if i > 3 then break end  -- only 3 ability slots
        if card and type(card) == "table" then
            equippedCardData[i] = {
                name       = card.name or nil,
                range      = card.range or nil,
                combatType = card.combatType or nil,
                cardId     = card.cardId or card.id or nil,
            }
        end
    end
end

function combatUI.setTileEffects(effects)
    if effects then
        tileEffects = effects
    end
end

function combatUI.setReactionPrompt(data)
    if not data then return end
    reactionPrompt = {
        attackerId = data.attackerId,
        damage = data.damage,
        attackType = data.attackType,
        options = data.options or {},
        timer = data.timer or 3,
        elapsed = 0,
    }
end

function combatUI.clearReactionPrompt()
    reactionPrompt = nil
end

function combatUI.cleanup()
    initialized = false
    combatData = nil
    myUnitId = nil
    isMyTurn = false
    selectedAction = nil
    hoveredTile = nil
    moveRange = {}
    attackRange = {}
    abilityRange = {}
    pathPreview = {}
    initiative = {}
    turnTimer = 0
    turnBanner = nil
    damageNumbers = {}
    tileEffects = {}
    syncAttackRange = {}
    reactionPrompt = nil
    activeBorderPulse = 0
    turnNumber = 0
    equippedCardData = {}
end

function combatUI.isInitialized()
    return initialized
end

-- Expose for external queries (e.g., game.lua integration)
function combatUI.getSelectedAction()
    return selectedAction
end

function combatUI.getIsMyTurn()
    return isMyTurn
end

function combatUI.getMyUnitId()
    return myUnitId
end

return combatUI
