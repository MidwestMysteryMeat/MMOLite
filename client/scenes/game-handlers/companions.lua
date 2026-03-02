-- game-handlers/companions.lua
-- Companion hire, dismiss, list, status, error

local M = {}

M.EVENTS = {
    "companion_hired", "companion_error", "companion_list",
    "companion_dismissed", "companion_status",
}

function M.register(client, game)
    client:on("companion_hired", function(data)
        if not data then return end
        game._companions.message = "Hired " .. (data.companion and data.companion.name or "companion") .. "!"
        game._companions.messageTimer = 3
        if client then client:emit("companion_list", {}) end
    end)

    client:on("companion_error", function(data)
        if not data then return end
        game._companions.message = data.message or "Error"
        game._companions.messageTimer = 3
    end)

    client:on("companion_list", function(data)
        if not data then return end
        game._companions.companions = data.companions or {}
    end)

    client:on("companion_dismissed", function(data)
        if not data then return end
        game._companions.message = "Companion dismissed"
        game._companions.messageTimer = 3
        if client then client:emit("companion_list", {}) end
    end)

    client:on("companion_status", function(data)
        if not data then return end
        for i, c in ipairs(game._companions.companions) do
            if c.id == data.id then
                game._companions.companions[i] = data
                break
            end
        end
    end)
end

return M
