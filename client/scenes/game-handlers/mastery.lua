-- game-handlers/mastery.lua
-- Mastery tree status, invest result, reset result

local M = {}

M.EVENTS = { "mastery_tree_status", "mastery_invest_result", "mastery_reset_result" }

function M.register(client, game, ctx)
    local mastery = ctx.mastery

    client:on("mastery_tree_status", function(data)
        if not data then return end
        if data.error then
            mastery.message = data.error
            mastery.messageTimer = 3
            return
        end
        mastery.skillName = data.skillName
        mastery.tree = data.tree
        mastery.invested = data.invested or {}
        mastery.points = data.points or 0
        mastery.skillLevel = data.skillLevel or 1
        mastery.hoverNode = nil
    end)

    client:on("mastery_invest_result", function(data)
        if not data then return end
        if data.ok then
            mastery.invested[data.nodeId] = data.rank
            mastery.points = data.pointsLeft
            mastery.message = "Invested!"
        else
            mastery.message = data.error or "Failed"
        end
        mastery.messageTimer = 2
    end)

    client:on("mastery_reset_result", function(data)
        if not data then return end
        if data.ok then
            mastery.message = "Reset! Refunded " .. data.refundedPoints .. " pts (cost: " .. data.goldCost .. "g)"
            mastery.points = mastery.points + data.refundedPoints
            mastery.invested = {}
        else
            mastery.message = data.error or "Failed"
        end
        mastery.messageTimer = 3
    end)
end

return M
