-- game-handlers/npc-shop.lua
-- NPC shop list, prices, buy, sell, error

local M = {}

M.EVENTS = {
    "npc_shop_list", "npc_shop_prices_result",
    "npc_shop_bought", "npc_shop_sold", "npc_shop_error",
}

function M.register(client, game, ctx)
    local players = ctx.players
    local getAccount = ctx.getAccount
    local getMmoInventory = ctx.getMmoInventory
    local setMmoInventory = ctx.setMmoInventory
    local getMyId = ctx.getMyId

    client:on("npc_shop_list", function(data)
        if not data or not data.shops then return end
        game._npcShop.shopList = data.shops
        if #data.shops > 0 and not game._npcShop.prices then
            local firstShop = data.shops[1]
            game._npcShop.shopId = firstShop.id
            game._npcShop.shopName = firstShop.name or "Shop"
            game._npcShop.shopDesc = firstShop.description or ""
            client:emit("npc_shop_prices", { shopId = firstShop.id })
        end
    end)

    client:on("npc_shop_prices_result", function(data)
        if not data or not data.prices then return end
        game._npcShop.prices = data.prices
        if data.shop then
            game._npcShop.shopId = data.shop.id or game._npcShop.shopId
            game._npcShop.shopName = data.shop.name or game._npcShop.shopName
            game._npcShop.shopDesc = data.shop.description or ""
        end
        game._npcShop.selected = nil
        game._npcShop.scroll = 0
        game._npcShop.amount = 1
    end)

    client:on("npc_shop_bought", function(data)
        if not data then return end
        game._npcShop.transactionLock = false
        local account = getAccount()
        if data.coins ~= nil and account then
            account.coins = data.coins
        end
        if data.inventory then
            local inv = getMmoInventory()
            for k, v in pairs(data.inventory) do
                inv[k] = v
            end
        end
        game._npcShop.message = {
            text = data.message or "Purchase complete!",
            color = {0.3, 1, 0.4},
            timer = 3,
        }
        local myId = getMyId()
        if myId and players[myId] then
            game.addFloatingText({
                text = data.message or "Bought!",
                x = players[myId].x, y = players[myId].y - 40,
                color = {0.3, 1, 0.4},
                timer = 2.5,
            })
        end
        if client then
            client:emit("npc_shop_prices", { shopId = game._npcShop.shopId })
        end
    end)

    client:on("npc_shop_sold", function(data)
        if not data then return end
        game._npcShop.transactionLock = false
        local account = getAccount()
        if data.coins ~= nil and account then
            account.coins = data.coins
        end
        if data.inventory then
            local inv = getMmoInventory()
            for k, v in pairs(data.inventory) do
                inv[k] = v
            end
        end
        game._npcShop.message = {
            text = data.message or "Sale complete!",
            color = {0.3, 1, 0.4},
            timer = 3,
        }
        local myId = getMyId()
        if myId and players[myId] then
            game.addFloatingText({
                text = data.message or "Sold!",
                x = players[myId].x, y = players[myId].y - 40,
                color = {1, 0.85, 0.3},
                timer = 2.5,
            })
        end
        if client then
            client:emit("npc_shop_prices", { shopId = game._npcShop.shopId })
        end
    end)

    client:on("npc_shop_error", function(data)
        if not data then return end
        game._npcShop.transactionLock = false
        game._npcShop.message = {
            text = data.message or "Transaction failed",
            color = {1, 0.3, 0.3},
            timer = 4,
        }
        local myId = getMyId()
        if myId and players[myId] then
            game.addFloatingText({
                text = data.message or "Error",
                x = players[myId].x, y = players[myId].y - 40,
                color = {1, 0.3, 0.3},
                timer = 2.5,
            })
        end
    end)
end

return M
