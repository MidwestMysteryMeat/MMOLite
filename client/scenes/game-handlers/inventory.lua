-- game-handlers/inventory.lua
-- Loot item inventory and social equipped items (badge/title)

local M = {}

M.EVENTS = {
    "inventory_data", "equipped_updated",
    "item_sold", "special_crate_result", "key_drop", "death_respawn",
}

function M.register(client, game)
    client:on("inventory_data", function(data)
        if not data then return end
        game._lootInv.items    = data.inventory or {}
        game._lootInv.equipped = data.equipped  or {}
    end)

    client:on("equipped_updated", function(data)
        if not data then return end
        game._lootInv.equipped = data
    end)

    client:on("item_sold", function(data)
        if not data then return end
        local name = data.itemName or "item"
        local val  = data.sellValue or 0
        game.addChatMessage("Sold " .. name .. " for " .. val .. " coins", {1, 0.85, 0.2})
    end)

    client:on("special_crate_result", function(data)
        if not data then return end
        local crateName = (data.crate and data.crate.name) or "Crate"
        local names = {}
        if data.items then
            for _, entry in ipairs(data.items) do
                local n = (entry.item and entry.item.name) or entry.itemId or "item"
                table.insert(names, n)
            end
        end
        local label = #names > 0 and table.concat(names, ", ") or "nothing"
        game.addChatMessage(crateName .. " opened: " .. label, {1, 0.85, 0.4})
    end)

    client:on("key_drop", function(data)
        if not data then return end
        local name = (data.key and data.key.name) or "Key"
        game.addChatMessage("[Key] " .. name .. " dropped!", {1, 0.85, 0.2})
    end)

    client:on("death_respawn", function(data)
        if not data then return end
        game.addChatMessage(data.message or "You have been defeated.", {1, 0.3, 0.3})
    end)
end

return M
