-- game-handlers/karma-factions.lua
-- Karma status, bounty list, faction status/list, guard hostility

local M = {}

M.EVENTS = {
    "karma_status", "bounty_list",
    "faction_status", "faction_list",
    "guard_hostile",
}

function M.register(client, game)
    client:on("karma_status", function(data)
        if not data then return end
        game._karma.karma = data.karma or 0
        game._karma.activeBounty = data.activeBounty
        game._karma.isGuardHostile = data.isGuardHostile or false
    end)

    client:on("bounty_list", function(data)
        if not data then return end
        game._karma.bounties = data.bounties or {}
    end)

    client:on("faction_status", function(data)
        if not data then return end
        game._karma.factions = data.factions or {}
    end)

    client:on("faction_list", function(data)
        if not data then return end
        game._karma.factionList = data.factions or {}
    end)

    client:on("guard_hostile", function(data)
        if not data then return end
        table.insert(game._notifications, { text = data.message or "Guards refuse to serve you!", color = {1, 0.3, 0.3}, timer = game.NOTIFICATION_DURATION, maxTimer = game.NOTIFICATION_DURATION })
        game._karma.isGuardHostile = true
    end)
end

return M
