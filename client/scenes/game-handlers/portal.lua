-- game-handlers/portal.lua
-- Portal list, travel, error

local M = {}

M.EVENTS = { "portal_list", "portal_traveled", "portal_error" }

function M.register(client, game, ctx)
    local players = ctx.players
    local getMyId = ctx.getMyId

    client:on("portal_list", function(data)
        if not data then return end
        game._portal.destinations = data.destinations or {}
        game._portal.show = true
        game._portal.scroll = 0
    end)

    client:on("portal_traveled", function(data)
        if not data then return end
        game._audio.playPortal()
        game._portal.show = false
        game._portal.cooldownEnd = love.timer.getTime() + 30
        local destName = data.destinationName or "destination"
        local myId = getMyId()
        if myId and players[myId] then
            game.addFloatingText({
                text = "Teleported to " .. destName,
                x = players[myId].x, y = players[myId].y - 40,
                color = {0.5, 0.6, 1},
                timer = 3.5,
            })
        end
    end)

    client:on("portal_error", function(data)
        if not data then return end
        local msg = data.message or "Portal error"
        game._portal.message = {
            text = msg,
            color = {1, 0.35, 0.35},
            timer = 5,
        }
        local myId = getMyId()
        if not game._portal.show and myId and players[myId] then
            game.addFloatingText({
                text = msg,
                x = players[myId].x, y = players[myId].y - 40,
                color = {1, 0.35, 0.35},
                timer = 3,
            })
        end
        local remaining = msg:match("%((%d+)s remaining%)")
        if remaining then
            game._portal.cooldownEnd = love.timer.getTime() + tonumber(remaining)
        end
    end)
end

return M
