-- game-handlers/director.lua
-- World event banners, zone director updates

local M = {}

M.EVENTS = { "world_event", "zone_director_update" }

function M.register(client, game)
    client:on("world_event", function(data)
        if not data then return end
        table.insert(game._directorEvents, {
            title = data.title or "World Event",
            description = data.description or "",
            type = data.type or "unknown",
            timer = data.duration or 5,
            fadeIn = 0,
        })
    end)

    client:on("zone_director_update", function(data)
        if not data then return end
        table.insert(game._zoneTicker, {
            message = data.message or "",
            eventType = data.eventType or "info",
            timer = 5,
        })
    end)
end

return M
