-- game-handlers/zone-items.lua
-- Zone ground items: personal pickup feedback and zone-wide removal

local M = {}

M.EVENTS = { "item_picked", "item_removed" }

function M.register(client, game, ctx)
    local players = ctx.players
    local getMyId = ctx.getMyId
    local getZone  = ctx.getZone

    client:on("item_picked", function(data)
        if not data then return end
        local name = (data.item and data.item.name) or "item"
        local myId = getMyId()
        local me = players[myId]
        if me then
            game.addFloatingText({
                text  = "+" .. name,
                x     = me.x, y = me.y - 40,
                color = {0.3, 1, 0.5},
                timer = 2.5,
            })
        end
        -- Remove from zone item list so it is not re-interactable
        local zone = getZone()
        if zone and zone.items and data.itemIndex then
            zone.items[data.itemIndex] = nil
        end
    end)

    client:on("item_removed", function(data)
        if not data or not data.itemIndex then return end
        local zone = getZone()
        if zone and zone.items then
            zone.items[data.itemIndex] = nil
        end
    end)
end

return M
