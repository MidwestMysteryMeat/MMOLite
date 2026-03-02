-- game-handlers/bank.lua
-- Bank vault contents, result, error

local M = {}

M.EVENTS = { "bank_contents", "bank_result", "bank_error" }

function M.register(client, game, ctx)
    local getMmoInventory = ctx.getMmoInventory
    local setMmoInventory = ctx.setMmoInventory
    local identity = ctx.identity

    client:on("bank_contents", function(data)
        if data then
            game._bank.data = data
            game._bank.transactionLock = false
        end
    end)

    client:on("bank_result", function(data)
        if not data then return end
        game._bank.transactionLock = false
        if data.success then
            if data.bank then game._bank.data = data.bank end
            if data.chips ~= nil then
                if identity and identity.account then identity.account.chips = data.chips end
            end
            if data.inventory then
                setMmoInventory(data.inventory)
                if identity and identity.account then identity.account.mmoInventory = data.inventory end
            end
            if data.message then
                game._bank.message = { text = data.message, color = {1, 0.85, 0.2}, timer = 3 }
            end
        end
    end)

    client:on("bank_error", function(data)
        game._bank.transactionLock = false
        if data and data.message then
            game._bank.message = { text = data.message, color = {1, 0.3, 0.3}, timer = 3 }
        end
    end)
end

return M
