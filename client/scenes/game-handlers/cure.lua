-- game-handlers/cure.lua
-- Affliction cure success/error

local M = {}

M.EVENTS = { "cure_success", "cure_error" }

function M.register(client, game, ctx)
    local players = ctx.players
    local getAccount = ctx.getAccount
    local chat = ctx.chat
    local getMyId = ctx.getMyId

    client:on("cure_success", function(data)
        if not data then return end
        local account = getAccount()
        if data.coinsRemaining ~= nil and account then
            account.coins = data.coinsRemaining
        end
        table.insert(chat.messages, {
            authorName = "System",
            authorColor = "#44FF88",
            content = data.message or "Affliction cured.",
            isSystem = true,
        })
        local myId = getMyId()
        local me = players[myId]
        if me then
            game.addFloatingText({ text = "Cured!", x = me.x, y = me.y - 40, color = {0.3, 1, 0.5}, timer = 2.5 })
        end
    end)

    client:on("cure_error", function(data)
        if not data then return end
        table.insert(chat.messages, {
            authorName = "System",
            authorColor = "#FF4444",
            content = data.message or "Cure failed.",
            isSystem = true,
        })
    end)
end

return M
