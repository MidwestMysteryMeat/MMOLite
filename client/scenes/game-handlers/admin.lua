-- game-handlers/admin.lua
-- Server rules, shutdown, kick, admin result

local M = {}

M.EVENTS = {
    "server_rules_updated", "server_shutdown", "admin_kicked", "admin_result",
}

function M.register(client, game, ctx)
    local players = ctx.players
    local getMyId = ctx.getMyId

    client:on("server_rules_updated", function(data)
        if not data then return end
        if data.xpRate then game._admin.xpRate = data.xpRate end
        if data.dropRate then game._admin.dropRate = data.dropRate end
        game._admin.resultMsg = { text = "Rules updated", color = {0.3, 1, 0.3}, timer = 3 }
    end)

    client:on("server_shutdown", function(data)
        game._admin.shutdownWarning = 10
        local myId = getMyId()
        game.addFloatingText({
            text = "SERVER SHUTTING DOWN",
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 60) or 0,
            color = {1, 0.2, 0.2},
            timer = 10,
        })
    end)

    client:on("admin_kicked", function(data)
        local myId = getMyId()
        game.addFloatingText({
            text = data and data.message or "You have been kicked by an admin",
            x = players[myId] and players[myId].x or 0,
            y = players[myId] and (players[myId].y - 40) or 0,
            color = {1, 0.3, 0.3},
            timer = 5,
        })
        if client and client.disconnect then
            client:disconnect()
        end
        _G.switchScene("shards")
    end)

    client:on("admin_result", function(data)
        if not data then return end
        game._admin.resultMsg = {
            text = data.message or "Action completed",
            color = data.success and {0.3, 1, 0.3} or {1, 0.3, 0.3},
            timer = 4,
        }
    end)
end

return M
