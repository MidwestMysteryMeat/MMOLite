-- game-handlers/placement.lua
-- Placement object removal result

local M = {}

M.EVENTS = { "remove_result" }

function M.register(client, game, ctx)
    local setMmoInventory = ctx.setMmoInventory
    local getMyId         = ctx.getMyId
    local players         = ctx.players

    client:on("remove_result", function(data)
        if not data then return end
        if data.inventory then
            setMmoInventory(data.inventory)
        end
        if not data.success then
            local myId = getMyId()
            local me = players[myId]
            if me then
                game.addFloatingText({
                    text  = data.message or "Cannot remove object",
                    x     = me.x,
                    y     = me.y - 40,
                    color = {1, 0.3, 0.3},
                    timer = 2.5,
                })
            end
        end
    end)
end

return M
