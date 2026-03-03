-- game-handlers/quest.lua
-- Quest accept, progress, turnin, list, error, NPC quest offers

local M = {}

M.EVENTS = {
    "quest_accepted", "quest_progress", "quest_turnin_result",
    "quest_list_result", "quest_error", "npc_quest_offers",
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
        -- Persist in local quest log so tracker HUD and quest log panel can show it
        if not game._questLog then game._questLog = { active = {}, completed = {} } end
        for i, q in ipairs(game._questLog.active) do
            if q.questId == data.questId then
                table.remove(game._questLog.active, i)
                break
            end
        end
        table.insert(game._questLog.active, {
            questId     = data.questId,
            name        = data.name or data.questId,
            description = data.description or "",
            progress    = data.progress or 0,
            targetCount = data.targetCount or 1,
        })
    end)

    client:on("quest_progress", function(data)
        if not data then return end
        -- Update local progress
        if game._questLog then
            for _, q in ipairs(game._questLog.active) do
                if q.questId == data.questId then
                    q.progress    = data.progress
                    q.targetCount = data.targetCount
                    break
                end
            end
        end
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
        -- Move from active to completed in local quest log
        if data.success and data.questId and game._questLog then
            for i, q in ipairs(game._questLog.active) do
                if q.questId == data.questId then
                    table.remove(game._questLog.active, i)
                    break
                end
            end
            if data.questId then
                table.insert(game._questLog.completed, data.questId)
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

    -- Writing-tool quest offers pushed alongside npc_dialogue
    client:on("npc_quest_offers", function(data)
        if not data then return end
        game._npcDialogue.questOffers  = data.offers  or {}
        game._npcDialogue.questTurnins = data.turnins or {}
        game._npcDialogue.questNpcId   = data.npcId   or ""
    end)
end

return M
