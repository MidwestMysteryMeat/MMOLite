-- game-handlers/cards.lua
-- Card collection, pack open, equip, fuse, vendor, loadout, evolution, curse

local M = {}

M.EVENTS = {
    "card_collection", "card_pack_opened", "card_equipped", "card_unequipped",
    "card_fuse_result", "card_error",
    "card_vendor_bought", "card_vendor_sold", "card_vendor_catalog",
    "card_loadout_saved", "card_loadouts",
    "card_evolution_complete", "card_evolution_info", "card_curse_cleansed",
}

function M.register(client, game, ctx)
    local players = ctx.players
    local getAccount = ctx.getAccount
    local rpg = ctx.rpg
    local ui = ctx.ui
    local getMyId = ctx.getMyId
    local setPackReveal = ctx.setPackReveal

    client:on("card_collection", function(data)
        if data then
            rpg.cards = data.cards or {}
            rpg.equippedCards = data.equippedCards or {}
            rpg.cardSlots = data.cardSlots or 4
            rpg.pendingPacks = data.pendingPacks or 0
            rpg.cardEffects = data.effects or {}
            rpg.rarityInfo = data.rarityInfo or {}
        end
    end)

    client:on("card_pack_opened", function(data)
        if data then
            game._audio.playPackOpen()
            rpg.pendingPacks = data.pendingPacks or 0
            if data.cards and #data.cards > 0 then
                setPackReveal({
                    cards = data.cards,
                    currentIndex = 1,
                    timer = 0,
                    phase = "flip",
                    flipProgress = 0,
                    done = false,
                })
            end
            if client then client:emit("get_cards", {}) end
        end
    end)

    client:on("card_equipped", function(data)
        if data then
            rpg.equippedCards = data.equippedCards or {}
            rpg.cardEffects = data.effects or {}
        end
    end)

    client:on("card_unequipped", function(data)
        if data then
            rpg.equippedCards = data.equippedCards or {}
            rpg.cardEffects = data.effects or {}
        end
    end)

    client:on("card_fuse_result", function(data)
        local myId = getMyId()
        if data and data.success and data.newCard and myId and players[myId] then
            game.addFloatingText({
                text = "Fusion: " .. data.newCard.name .. " [" .. data.newCard.rarity .. "]!",
                x = players[myId].x, y = players[myId].y - 40,
                color = { 1, 0.6, 1 }, timer = 4,
            })
            if client then client:emit("get_cards", {}) end
        end
    end)

    client:on("card_error", function(data)
        local myId = getMyId()
        if data and data.message and myId and players[myId] then
            game.addFloatingText({
                text = data.message,
                x = players[myId].x, y = players[myId].y - 40,
                color = { 1, 0.3, 0.3 }, timer = 2.5,
            })
        end
    end)

    client:on("card_vendor_bought", function(data)
        if data then
            local account = getAccount()
            if account then account.coins = data.coins end
            local myId = getMyId()
            if myId and players[myId] then
                game.addFloatingText({
                    text = "Purchased card!",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = { 0.3, 1, 0.5 }, timer = 2.5,
                })
            end
            if client then client:emit("get_cards", {}) end
        end
    end)

    client:on("card_vendor_sold", function(data)
        if data then
            local account = getAccount()
            if account then account.coins = data.coins end
            local myId = getMyId()
            if myId and players[myId] then
                game.addFloatingText({
                    text = "Sold for " .. (data.coinsReceived or 0) .. " coins",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = { 1, 0.85, 0.2 }, timer = 2.5,
                })
            end
            if client then client:emit("get_cards", {}) end
            ui.selectedCard = nil
        end
    end)

    client:on("card_vendor_catalog", function(data)
        if data then
            game._cardVendor.catalog = data.cards or {}
        end
    end)

    client:on("card_loadout_saved", function(data)
        if data then
            game._cardLoadouts.loadouts = data.loadouts or { nil, nil, nil, nil, nil }
            local myId = getMyId()
            if myId and players[myId] then
                game.addFloatingText({
                    text = "Loadout saved!",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = { 0.5, 0.8, 1 }, timer = 2,
                })
            end
        end
    end)

    client:on("card_loadouts", function(data)
        if data then
            game._cardLoadouts.loadouts = data.loadouts or { nil, nil, nil, nil, nil }
        end
    end)

    client:on("card_evolution_complete", function(data)
        if not data then return end
        local cardName = (data.card and data.card.name) or "Card"
        game.addChatMessage("Evolution complete: " .. cardName .. " (Path " .. (data.path or "?") .. ")", {0.6, 0.3, 1})
        if client then client:emit("get_cards", {}) end
    end)

    client:on("card_evolution_info", function(data)
        if not data then return end
        if data.evolvable and data.paths then
            game.addChatMessage("Card is ready to evolve! Paths available: " .. #data.paths, {0.7, 0.5, 1})
        end
    end)

    client:on("card_curse_cleansed", function(data)
        if not data then return end
        local cardName = (data.card and data.card.name) or "Card"
        game.addChatMessage("Curse cleansed from " .. cardName .. "!", {0.3, 1, 0.3})
        if client then client:emit("get_cards", {}) end
    end)
end

return M
