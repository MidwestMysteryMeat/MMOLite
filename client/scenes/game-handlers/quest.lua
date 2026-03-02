-- game-handlers/quest.lua
-- Quest accept, progress, turnin, list, error

local M = {}

M.EVENTS = {
    "quest_accepted", "quest_progress", "quest_turnin_result",
    "quest_list_result", "quest_error",
}

function M.register(client, game, ctx)
    local players = ctx.players
    local getMyId = ctx.getMyId

    client:on("quest_accepted", function(data)
        if not data then return end
        local myId = getMyId()
        local me = players[myId]
        if me then
            game.addFloatingText({ text = "Quest Accepted: " .. (data.name or data.questId), x = me.x, y = me.y - 60, color = {0.3, 1, 0.6}, timer = 3 })
        end
    end)

    client:on("quest_progress", function(data)
        if not data then return end
        local myId = getMyId()
        local me = players[myId]
        if me then
            local msg = "Quest: " .. data.questId .. " (" .. data.progress .. "/" .. data.targetCount .. ")"
            if data.complete then msg = msg .. " COMPLETE!" end
            game.addFloatingText({ text = msg, x = me.x, y = me.y - 60, color = data.complete and {1, 0.85, 0.2} or {0.7, 0.8, 1}, timer = 2.5 })
        end
    end)

    client:on("quest_turnin_result", function(data)
        if not data then return end
        local myId = getMyId()
        local me = players[myId]
        if me then
            if data.success and data.rewards then
                local msg = "Quest Complete!"
                if data.rewards.coins then msg = msg .. " +" .. data.rewards.coins .. " coins" end
                if data.rewards.xp then msg = msg .. " +" .. data.rewards.xp .. " XP" end
                game.addFloatingText({ text = msg, x = me.x, y = me.y - 60, color = {1, 0.85, 0.2}, timer = 3 })
            end
        end
    end)

    client:on("quest_list_result", function(data)
        if not data then return end
        game._questLog = { active = data.active or {}, completed = data.completed or {} }
    end)

    client:on("quest_error", function(data)
        if not data then return end
        local myId = getMyId()
        local me = players[myId]
        if me then
            game.addFloatingText({
                text = data.message or "Quest error",
                x = me.x, y = me.y - 40,
                color = {1, 0.3, 0.3},
                timer = 2.5,
            })
        end
    end)
end

return M
