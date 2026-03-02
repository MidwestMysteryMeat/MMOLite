-- game-handlers/base-raid.lua
-- Base raid alerts, waves, ending

local M = {}

M.EVENTS = { "base_raid_alert", "raid_wave", "raid_ended" }

function M.register(client, game, ctx)
    local ui = ctx.ui

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
end

return M
