-- game-handlers/crafting-advanced.lua
-- Gem socket, augment, imbue, inscribe results

local M = {}

M.EVENTS = { "gem_socket_result", "augment_result", "imbue_result", "inscribe_result" }

function M.register(client, game, ctx)
    local getMmoInventory = ctx.getMmoInventory
    local setMmoInventory = ctx.setMmoInventory

    client:on("gem_socket_result", function(data)
        if not data then return end
        if data.success then
            game.addChatMessage("Gem socketed successfully!", {0.3, 1, 0.3})
            if data.inventory then setMmoInventory(data.inventory) end
        end
    end)

    client:on("augment_result", function(data)
        if not data then return end
        if data.success then
            game.addChatMessage("Augment applied!", {0.3, 1, 0.3})
            if data.inventory then setMmoInventory(data.inventory) end
        end
    end)

    client:on("imbue_result", function(data)
        if not data then return end
        if data.success then
            game.addChatMessage("Imbue successful!", {0.4, 0.7, 1})
            if data.inventory then setMmoInventory(data.inventory) end
        end
    end)

    client:on("inscribe_result", function(data)
        if not data then return end
        if data.success then
            game.addChatMessage("Inscription applied!", {0.8, 0.6, 1})
            if data.inventory then setMmoInventory(data.inventory) end
            if data.inscriptions then
                game._itemUI.inscriptionSlots = data.inscriptions
            end
        end
    end)
end

return M
