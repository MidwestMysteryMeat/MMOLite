-- game-handlers/npc-action.lua
-- NPC action dispatch (server sends after dialogue choice with an action)

local M = {}

M.EVENTS = { "npc_action" }

function M.register(client, game, ctx)
    local players = ctx.players
    local chat = ctx.chat
    local getMyId = ctx.getMyId

    client:on("npc_action", function(data)
        if not data or not data.action then return end
        if data.action == "open_bank" then
            game.closeAllPanels()
            game._bank.show = true
            game._bank.tab = "gold"
            game._bank.selected = nil
            game._bank.amount = 1
            game._bank.scroll = 0
            game._bank.data = nil
            game._bank.transactionLock = false
            if client then client:emit("bank_open", {}) end
        elseif data.action == "healed" then
            local myId = getMyId()
            local me = players[myId]
            if me then
                game.addFloatingText({ text = "Healed!", x = me.x, y = me.y - 40, color = {0.3, 1, 0.5}, timer = 2.5 })
            end
        elseif data.action == "reveal_rumors" then
            if data.rumors then
                for _, rumor in ipairs(data.rumors) do
                    game.addChatMessage("[Rumor] " .. (rumor.text or rumor), {0.8, 0.67, 0.4})
                end
            end
        elseif data.action == "faction_rep_gained" then
            game.addChatMessage("[Faction] Reputation gained with " .. (data.factionId or "unknown"), {0.53, 0.8, 1})
        elseif data.action == "karma_changed" then
            game.addChatMessage("[Karma] Your karma is now " .. tostring(data.karma or 0), {0.67, 1, 0.67})
        end
    end)
end

return M
