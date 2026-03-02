-- game-handlers/pets.lua
-- Pet tame, feed, list, set active, error

local M = {}

M.EVENTS = {
    "pet_tamed", "pet_error", "pet_list", "pet_fed", "pet_active_set",
}

function M.register(client, game)
    client:on("pet_tamed", function(data)
        if not data then return end
        game._pets.message = "Tamed " .. (data.pet and data.pet.name or "pet") .. "!"
        game._pets.messageTimer = 3
        if client then client:emit("pet_list", {}) end
    end)

    client:on("pet_error", function(data)
        if not data then return end
        game._pets.message = data.message or "Error"
        game._pets.messageTimer = 3
    end)

    client:on("pet_list", function(data)
        if not data then return end
        game._pets.pets = data.pets or {}
        for _, p in ipairs(game._pets.pets) do
            if p.isActive then game._pets.activePetId = p.id end
        end
    end)

    client:on("pet_fed", function(data)
        if not data then return end
        for _, p in ipairs(game._pets.pets) do
            if p.id == data.petId then
                p.hunger = data.hunger
                p.happiness = data.happiness
                break
            end
        end
        game._pets.message = "Pet fed!"
        game._pets.messageTimer = 2
    end)

    client:on("pet_active_set", function(data)
        if not data then return end
        game._pets.activePetId = data.petId
        game._pets.message = data.petId and "Pet set as active" or "Pet dismissed from active"
        game._pets.messageTimer = 2
    end)
end

return M
