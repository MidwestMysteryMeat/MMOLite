-- game-handlers/patrol.lua
-- Faction patrol spawn, move, despawn, arrive

local M = {}

M.EVENTS = { "patrol_spawned", "patrol_moved", "patrol_despawned", "patrol_arrived" }

function M.register(client, game, ctx)
    local activePatrols = ctx.activePatrols

    client:on("patrol_spawned", function(data)
        if data and data.id then
            activePatrols[data.id] = {
                factionId = data.factionId,
                cx = data.cx, cy = data.cy,
                strength = data.strength or 1,
                description = data.description or "Patrol",
                hostile = data.hostile or false,
                color = data.color or "#ffffff",
            }
        end
    end)

    client:on("patrol_moved", function(data)
        if data and data.id and activePatrols[data.id] then
            activePatrols[data.id].cx = data.cx
            activePatrols[data.id].cy = data.cy
            activePatrols[data.id].strength = data.strength or activePatrols[data.id].strength
        end
    end)

    client:on("patrol_despawned", function(data)
        if data and data.id then
            activePatrols[data.id] = nil
        end
    end)

    client:on("patrol_arrived", function(data)
        if data and data.id then
            activePatrols[data.id] = nil
            if data.hostile then
                table.insert(game._directorEvents, {
                    title = (data.description or "Hostile Force") .. " Arrives!",
                    description = "A hostile force has reached its target.",
                    type = "patrol_arrived",
                    timer = 8,
                })
            end
        end
    end)
end

return M
