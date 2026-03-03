-- game-handlers/base-raid.lua
-- Base raid alerts, waves, ending

local M = {}

M.EVENTS = {
    "base_raid_alert", "raid_wave", "raid_ended",
    "raid_enemy_attack", "raid_object_damaged", "raid_object_destroyed",
}

function M.register(client, game, ctx)
    local ui      = ctx.ui
    local players = ctx.players
    local getMyId = ctx.getMyId

    client:on("base_raid_alert", function(data)
        if not data then return end
        ui.baseRaidAlert = {
            plotZoneId = data.plotZoneId,
            message = data.message or "Your base is under attack!",
            alertDuration = data.alertDuration or 60000,
            receivedAt = love.timer.getTime(),
        }
        game.addChatMessage("[RAID ALERT] " .. (data.message or "Your base is under threat!"), {1.0, 0.2, 0.2})
    end)

    client:on("raid_wave", function(data)
        if not data then return end
        ui.baseRaidWaves = data.enemies or {}
        game.addChatMessage("[RAID] " .. (data.message or "Wave incoming!"), {1.0, 0.4, 0.2})
    end)

    client:on("raid_ended", function(data)
        if not data then return end
        ui.baseRaidEnded = data
        ui.baseRaidAlert = nil
        ui.baseRaidWaves = {}
        if data.result == "victory" then
            game.addChatMessage("[RAID] Victory! " .. (data.message or ""), {0.3, 1.0, 0.3})
        else
            game.addChatMessage("[RAID] " .. (data.message or "Defeat"), {1.0, 0.3, 0.3})
        end
    end)

    -- Personal: an enemy attacked the local player during a raid
    client:on("raid_enemy_attack", function(data)
        if not data then return end
        local myId = getMyId()
        local me = players[myId]
        if me then
            game.addFloatingText({
                text  = "-" .. (data.damage or 0) .. " [" .. (data.enemyName or "Enemy") .. "]",
                x     = me.x, y = me.y - 50,
                color = {1, 0.3, 0.3},
                timer = 2.5,
            })
        end
    end)

    -- Broadcast: a placed structure took damage during a raid
    client:on("raid_object_damaged", function(data)
        if not data then return end
        local typeName = (data.objectType or "structure"):gsub("_", " ")
        game.addChatMessage(
            "[RAID] " .. (data.enemyName or "Enemy") .. " damaged a " .. typeName ..
            " (" .. (data.hp or 0) .. "/" .. (data.maxHp or 0) .. " HP)",
            {1, 0.6, 0.2}
        )
    end)

    -- Broadcast: a placed structure was destroyed during a raid
    client:on("raid_object_destroyed", function(data)
        if not data then return end
        game.addChatMessage(
            data.message or ("[RAID] A " .. ((data.objectType or "structure"):gsub("_", " ")) .. " was destroyed!"),
            {1, 0.2, 0.2}
        )
    end)
end

return M
