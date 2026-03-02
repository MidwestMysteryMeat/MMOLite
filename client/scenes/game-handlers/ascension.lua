-- game-handlers/ascension.lua
-- Ascension status, result, AP spending

local M = {}

M.EVENTS = {
    "ascension_status", "ascension_result", "ascension_ap_result",
}

function M.register(client, game)
    client:on("ascension_status", function(data)
        if not data then return end
        game._ascension.canAscend = data.canAscend or false
        game._ascension.ascensionCount = data.ascensionCount or 0
        game._ascension.ascensionPoints = data.ascensionPoints or 0
        game._ascension.ascensionTree = data.ascensionTree or {}
        game._ascension.tree = data.tree
    end)

    client:on("ascension_result", function(data)
        if not data then return end
        if data.ok then
            game._ascension.ascensionCount = data.ascensionCount or game._ascension.ascensionCount
            game._ascension.ascensionPoints = data.totalAp or game._ascension.ascensionPoints
            game._ascension.message = "Ascended! +" .. (data.apGained or 0) .. " AP"
            game._ascension.canAscend = false
        else
            game._ascension.message = data.error or "Cannot ascend"
        end
        game._ascension.messageTimer = 3
    end)

    client:on("ascension_ap_result", function(data)
        if not data then return end
        if data.ok then
            game._ascension.ascensionTree[data.nodeId] = data.rank
            game._ascension.ascensionPoints = data.apLeft
            game._ascension.message = "Invested in " .. data.nodeId .. " (rank " .. data.rank .. ")"
        else
            game._ascension.message = data.error or "Cannot invest"
        end
        game._ascension.messageTimer = 3
    end)
end

return M
