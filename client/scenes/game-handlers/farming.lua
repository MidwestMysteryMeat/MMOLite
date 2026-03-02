-- game-handlers/farming.lua
-- Farm: seed, crop, animal, furniture events

local M = {}

M.EVENTS = {
    "seed_planted", "crop_watered", "crop_harvested", "crop_cleared",
    "crop_status", "farm_update", "farm_error",
    "animal_bought", "animal_placed", "animals_fed", "products_collected",
    "animal_named", "furniture_effect",
}

function M.register(client, game, ctx)
    local ui = ctx.ui
    local getMmoInventory = ctx.getMmoInventory
    local setMmoInventory = ctx.setMmoInventory

    client:on("seed_planted", function(data)
        if not data then return end
        game.addChatMessage("[Farming] Planted " .. (data.seedType or "seed"):gsub("_", " "), {0.4, 0.8, 0.3})
        if data.inventory then setMmoInventory(data.inventory) end
    end)

    client:on("crop_watered", function(data)
        if not data then return end
        game.addChatMessage("[Farming] Crop watered", {0.3, 0.7, 0.9})
    end)

    client:on("crop_harvested", function(data)
        if not data then return end
        local msg = "[Farming] Harvested " .. (data.amount or 1) .. "x " .. (data.output or "crop"):gsub("_", " ")
        if data.seedBack then msg = msg .. " (+1 seed back!)" end
        game.addChatMessage(msg, {0.4, 0.9, 0.3})
        if data.inventory then setMmoInventory(data.inventory) end
    end)

    client:on("crop_cleared", function(data)
        if not data then return end
        game.addChatMessage("[Farming] " .. (data.message or "Crop cleared"), {0.6, 0.6, 0.4})
    end)

    client:on("crop_status", function(data)
        if not data then return end
        ui.farmCrops = data.crops or {}
        ui.farmAnimals = data.animals or {}
    end)

    client:on("farm_update", function(data)
        if not data then return end
        if data.crops then ui.farmCrops = data.crops end
        if data.animals then ui.farmAnimals = data.animals end
    end)

    client:on("farm_error", function(data)
        if not data then return end
        game.addChatMessage("[Farming] " .. (data.message or "Error"), {0.9, 0.3, 0.3})
    end)

    client:on("animal_bought", function(data)
        if not data then return end
        game.addChatMessage("[Farming] Bought " .. (data.animal and data.animal.name or "animal"), {0.4, 0.8, 0.3})
    end)

    client:on("animal_placed", function(data)
        if not data then return end
        game.addChatMessage("[Farming] Animal placed in pen", {0.4, 0.8, 0.3})
    end)

    client:on("animals_fed", function(data)
        if not data then return end
        game.addChatMessage("[Farming] Animals fed!", {0.4, 0.8, 0.3})
        if data.inventory then setMmoInventory(data.inventory) end
    end)

    client:on("products_collected", function(data)
        if not data then return end
        local items = {}
        if data.collected then
            for k, v in pairs(data.collected) do
                table.insert(items, v .. "x " .. k:gsub("_", " "))
            end
        end
        game.addChatMessage("[Farming] Collected: " .. table.concat(items, ", "), {0.4, 0.9, 0.3})
        if data.inventory then setMmoInventory(data.inventory) end
    end)

    client:on("animal_named", function(data)
        if not data then return end
        game.addChatMessage("[Farming] Animal renamed to " .. (data.name or ""), {0.5, 0.7, 0.9})
    end)

    client:on("furniture_effect", function(data)
        if not data then return end
        game.addChatMessage("[Home] " .. (data.message or "Effect applied"), {0.6, 0.8, 1.0})
    end)
end

return M
