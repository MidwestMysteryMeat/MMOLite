-- game-handlers/auction.lua
-- Auction house: listings, buy, sell, cancel, errors, mount change

local M = {}

M.EVENTS = {
    "mmo_auction_listings", "mmo_auction_listed", "mmo_auction_bought",
    "mmo_auction_cancelled", "mmo_auction_my_results", "mmo_auction_error",
    "mmo_auction_update", "mount_changed",
}

function M.register(client, game, ctx)
    local players = ctx.players
    local getAccount = ctx.getAccount
    local rpg = ctx.rpg
    local getMyId = ctx.getMyId

    client:on("mmo_auction_listings", function(data)
        if data then
            game._auction.listings = data.listings or {}
            game._auction.page = data.page or 1
            game._auction.totalPages = data.totalPages or 1
            game._auction.totalResults = data.totalResults or 0
        end
    end)

    client:on("mmo_auction_listed", function(data)
        local myId = getMyId()
        if data and myId and players[myId] then
            game.addFloatingText({
                text = "Listed: " .. (data.name or "item") .. " for " .. (data.price or 0) .. "c",
                x = players[myId].x, y = players[myId].y - 40,
                color = { 0.3, 1, 0.5 }, timer = 3,
            })
            if client then client:emit("get_cards", {}) end
        end
    end)

    client:on("mmo_auction_bought", function(data)
        local myId = getMyId()
        if data and myId and players[myId] then
            game.addFloatingText({
                text = "Purchased: " .. (data.name or "item"),
                x = players[myId].x, y = players[myId].y - 40,
                color = { 0.3, 1, 0.5 }, timer = 3,
            })
            local account = getAccount()
            if account then account.coins = data.coins end
            if client then client:emit("get_cards", {}) end
        end
    end)

    client:on("mmo_auction_cancelled", function(data)
        local myId = getMyId()
        if data and myId and players[myId] then
            game.addFloatingText({
                text = "Listing cancelled",
                x = players[myId].x, y = players[myId].y - 40,
                color = { 0.7, 0.7, 0.8 }, timer = 2,
            })
            if client then client:emit("get_cards", {}) end
        end
    end)

    client:on("mmo_auction_my_results", function(data)
        if data then
            game._auction.myListings = data.listings or {}
        end
    end)

    client:on("mmo_auction_error", function(data)
        local myId = getMyId()
        if data and data.message and myId and players[myId] then
            game.addFloatingText({
                text = data.message,
                x = players[myId].x, y = players[myId].y - 40,
                color = { 1, 0.3, 0.3 }, timer = 2.5,
            })
        end
    end)

    client:on("mmo_auction_update", function()
        if game._auction.show and client then
            client:emit("mmo_auction_browse", game._auction.filters or {})
        end
    end)

    client:on("mount_changed", function(data)
        if data then rpg.mount = data.mount end
    end)
end

return M
