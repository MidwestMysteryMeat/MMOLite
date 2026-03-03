-- game-handlers/monster.lua
-- Monster capture/evolve, zone monsters, corpses, containers, combat

local M = {}

M.EVENTS = {
    "monster_capture_result", "monster_evolve_result",
    "zone_monsters", "zone_monster_spawned", "zone_monster_died",
    "zone_monster_positions",
    "zone_monster_killed", "zone_attack_error",
    "zone_corpse_spawned", "zone_corpse_removed", "loot_corpse_result",
    "zone_container_spawned", "zone_container_looted", "loot_container_result",
    "monster_roster", "monster_party_updated", "monster_error", "monster_renamed",
}

function M.register(client, game, ctx)
    local players = ctx.players
    local getAccount = ctx.getAccount
    local dungeon = ctx.dungeon
    local zoneMonsters = ctx.zoneMonsters
    local zoneCorpses = ctx.zoneCorpses
    local zoneWorldContainers = ctx.zoneWorldContainers
    local getMyId = ctx.getMyId
    local getCorpseLootPanel = ctx.getCorpseLootPanel
    local setCorpseLootPanel = ctx.setCorpseLootPanel
    local getContainerLootPanel = ctx.getContainerLootPanel
    local setContainerLootPanel = ctx.setContainerLootPanel

    client:on("monster_capture_result", function(data)
        if not data then return end
        local myId = getMyId()
        local me = players[myId]
        if me then
            if data.success then
                game.addFloatingText({ text = data.message or "Captured!", x = me.x, y = me.y - 60, color = {0.3, 1, 0.3}, timer = 3 })
            else
                game.addFloatingText({ text = data.message or "Capture failed!", x = me.x, y = me.y - 60, color = {1, 0.4, 0.4}, timer = 2.5 })
            end
        end
    end)

    client:on("monster_evolve_result", function(data)
        if not data then return end
        local myId = getMyId()
        local me = players[myId]
        if me then
            if data.success then
                game.addFloatingText({ text = (data.oldName or "Monster") .. " evolved into " .. (data.newName or "???") .. "!", x = me.x, y = me.y - 60, color = {1, 0.85, 0.2}, timer = 3 })
            else
                game.addFloatingText({ text = data.message or "Evolution failed!", x = me.x, y = me.y - 60, color = {1, 0.4, 0.4}, timer = 2.5 })
            end
        end
    end)

    client:on("zone_monsters", function(data)
        -- Clear and refill in-place to preserve table reference
        for i = #zoneMonsters, 1, -1 do zoneMonsters[i] = nil end
        if data and data.monsters then
            for _, m in ipairs(data.monsters) do
                table.insert(zoneMonsters, m)
            end
        end
    end)

    client:on("zone_monster_spawned", function(data)
        if not data then return end
        table.insert(zoneMonsters, data)
    end)

    client:on("zone_monster_died", function(data)
        if not data or not data.id then return end
        for i = #zoneMonsters, 1, -1 do
            if zoneMonsters[i].id == data.id then
                table.remove(zoneMonsters, i)
                break
            end
        end
    end)

    client:on("zone_monster_positions", function(data)
        if not data or not data.monsters then return end
        for _, upd in ipairs(data.monsters) do
            for _, m in ipairs(zoneMonsters) do
                if m.id == upd.id then
                    m.targetX = upd.x
                    m.targetY = upd.y
                    if upd.patrolMode then
                        m.patrolMode = upd.patrolMode
                    end
                    break
                end
            end
        end
    end)

    client:on("zone_monster_killed", function(data)
        if not data then return end
        local myId = getMyId()
        local me = players[myId]
        if me then
            if data.xp and data.xp > 0 then
                game.addFloatingText({
                    text = "+" .. data.xp .. " XP",
                    x = me.x, y = me.y - 50,
                    color = {0.5, 0.8, 1},
                    timer = 2,
                })
            end
            if data.gold and data.gold > 0 then
                game.addFloatingText({
                    text = "+" .. data.gold .. " gold",
                    x = me.x, y = me.y - 66,
                    color = {1, 0.85, 0.2},
                    timer = 2,
                })
            end
        end
    end)

    client:on("zone_attack_error", function(data)
        if not data then return end
        local myId = getMyId()
        local me = players[myId]
        if me then
            game.addFloatingText({
                text = data.message or "Attack failed",
                x = me.x, y = me.y - 30,
                color = {1, 0.3, 0.3},
                timer = 2,
            })
        end
    end)

    client:on("zone_corpse_spawned", function(data)
        if not data or not data.id then return end
        table.insert(zoneCorpses, data)
    end)

    client:on("zone_corpse_removed", function(data)
        if not data or not data.id then return end
        for i = #zoneCorpses, 1, -1 do
            if zoneCorpses[i].id == data.id then
                table.remove(zoneCorpses, i)
                break
            end
        end
        -- Close loot panel if viewing this corpse
        local clp = getCorpseLootPanel()
        if clp and clp.corpseId == data.id then
            setCorpseLootPanel(nil)
        end
    end)

    client:on("loot_corpse_result", function(data)
        if not data then return end
        if data.error then
            game.addChatMessage(data.error, {1, 0.4, 0.4})
            return
        end
        setCorpseLootPanel(data)
    end)

    client:on("zone_container_spawned", function(data)
        if not data or not data.id then return end
        table.insert(zoneWorldContainers, data)
    end)

    client:on("zone_container_looted", function(data)
        if not data or not data.id then return end
        for i = #zoneWorldContainers, 1, -1 do
            if zoneWorldContainers[i].id == data.id then
                table.remove(zoneWorldContainers, i)
                break
            end
        end
        local clp = getContainerLootPanel()
        if clp and clp.containerId == data.id then
            setContainerLootPanel(nil)
        end
    end)

    client:on("loot_container_result", function(data)
        if not data then return end
        if data.error then
            game.addChatMessage(data.error, {1, 0.4, 0.4})
            return
        end
        setContainerLootPanel(data)
    end)

    client:on("monster_roster", function(data)
        if not data then return end
        local account = getAccount()
        if account then
            account.monsters = data.monsters or {}
            account.activeParty = data.activeParty or {}
        end
    end)

    client:on("monster_error", function(data)
        if not data then return end
        local myId = getMyId()
        local me = players[myId]
        if me then
            game.addFloatingText({
                text  = data.message or "Monster action failed",
                x     = me.x,
                y     = me.y - 60,
                color = {1, 0.3, 0.3},
                timer = 2.5,
            })
        else
            game.addChatMessage(data.message or "Monster action failed", {1, 0.3, 0.3})
        end
    end)

    client:on("monster_renamed", function(data)
        if not data then return end
        local myId = getMyId()
        local me = players[myId]
        if me then
            game.addFloatingText({
                text  = "Renamed to \"" .. (data.name or "?") .. "\"",
                x     = me.x,
                y     = me.y - 60,
                color = {0.5, 0.9, 1},
                timer = 2.5,
            })
        end
        -- Update roster entry in account if cached
        local account = getAccount()
        if account and account.monsters then
            for _, m in ipairs(account.monsters) do
                if m.instanceId == data.monsterId then
                    m.nickname = data.name
                    break
                end
            end
        end
    end)

    client:on("monster_party_updated", function(data)
        if not data then return end
        local account = getAccount()
        if account then
            account.activeParty = data.activeParty or {}
        end
    end)
end

return M
