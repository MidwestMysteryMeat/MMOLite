-- game-handlers/trade.lua
-- P2P trade: request, start, offer, confirm, complete, cancel, expire, error

local M = {}

M.EVENTS = {
    "trade_request_received", "trade_request_sent", "trade_started",
    "trade_offer_updated", "trade_partner_confirmed", "trade_completed",
    "trade_cancelled", "trade_expired", "trade_error",
}

function M.register(client, game, ctx)
    local players = ctx.players
    local getAccount = ctx.getAccount
    local getMmoInventory = ctx.getMmoInventory
    local setMmoInventory = ctx.setMmoInventory
    local getMyId = ctx.getMyId

    client:on("trade_request_received", function(data)
        if not data then return end
        game._trade.pendingRequest = {
            tradeId = data.tradeId,
            fromName = data.fromName or "???",
            fromId = data.fromId,
        }
        game._trade._pendingTimer = 25
    end)

    client:on("trade_request_sent", function(data)
        -- Already showed floating text from context menu action
    end)

    client:on("trade_started", function(data)
        if not data or not data.tradeId then return end
        if game._trade.pendingRequest and game._trade.pendingRequest.tradeId == data.tradeId then
            game._trade.partnerId = game._trade.pendingRequest.fromId
            game._trade.partnerName = game._trade.pendingRequest.fromName
        end
        game._trade.pendingRequest = nil
        game._trade._pendingTimer = nil
        game._trade.tradeId = data.tradeId
        game._trade.show = true
        game._trade.myOffer = { items = {}, chips = 0 }
        game._trade.theirOffer = { items = {}, chips = 0 }
        game._trade.myConfirmed = false
        game._trade.theirConfirmed = false
        game._trade.coinInput = ""
        game._trade.coinInputActive = false
        game._trade.myScroll = 0
        game._trade.offerScroll = 0
        game._trade.message = nil

        if (not game._trade.partnerName or game._trade.partnerName == "???") and game._trade.partnerId then
            local p = players[game._trade.partnerId]
            if p then
                game._trade.partnerName = p.name or "???"
            end
        end
    end)

    client:on("trade_offer_updated", function(data)
        if not data or data.tradeId ~= game._trade.tradeId then return end
        if data.offer then
            game._trade.theirOffer = {
                items = data.offer.items or {},
                chips = data.offer.chips or 0,
            }
        end
        game._trade.myConfirmed = false
        game._trade.theirConfirmed = false
    end)

    client:on("trade_partner_confirmed", function(data)
        if not data or data.tradeId ~= game._trade.tradeId then return end
        game._trade.theirConfirmed = true
    end)

    client:on("trade_completed", function(data)
        if not data then return end
        if data.inventory then
            local inv = getMmoInventory()
            for k, v in pairs(data.inventory) do
                inv[k] = v
            end
        end
        local account = getAccount()
        if data.coins ~= nil and account then
            account.coins = data.coins
        end
        if client then
            client:emit("get_cards", {})
        end
        local myId = getMyId()
        if myId and players[myId] then
            game.addFloatingText({
                text = "Trade completed!",
                x = players[myId].x, y = players[myId].y - 40,
                color = {0.3, 1, 0.4},
                timer = 3,
            })
        end
        game.resetTradeState()
    end)

    client:on("trade_cancelled", function(data)
        if not data then return end
        if game._trade.tradeId and data.tradeId == game._trade.tradeId then
            local myId = getMyId()
            if myId and players[myId] then
                game.addFloatingText({
                    text = "Trade cancelled",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = {1, 0.7, 0.2},
                    timer = 3,
                })
            end
            game.resetTradeState()
        end
        if game._trade.pendingRequest and game._trade.pendingRequest.tradeId == data.tradeId then
            game._trade.pendingRequest = nil
            game._trade._pendingTimer = nil
        end
    end)

    client:on("trade_expired", function(data)
        if not data then return end
        if game._trade.pendingRequest and game._trade.pendingRequest.tradeId == data.tradeId then
            game._trade.pendingRequest = nil
            game._trade._pendingTimer = nil
        end
        if game._trade.tradeId == data.tradeId and not game._trade.show then
            game.resetTradeState()
        end
    end)

    client:on("trade_error", function(data)
        if not data then return end
        local msg = data.message or "Trade error"
        if game._trade.show then
            game._trade.message = {
                text = msg,
                color = {1, 0.3, 0.3},
                timer = 4,
            }
        end
        local myId = getMyId()
        if myId and players[myId] then
            game.addFloatingText({
                text = msg,
                x = players[myId].x, y = players[myId].y - 40,
                color = {1, 0.3, 0.3},
                timer = 3,
            })
        end
        if msg:find("Trade failed") or msg:find("not found") then
            game.resetTradeState()
        end
    end)
end

return M
