-- game-handlers/jail.lua
-- Jail status, bail, serve time

local M = {}

M.EVENTS = { "jail_status", "jail_bail", "jail_serve_time" }

function M.register(client, game, ctx)
    local ui = ctx.ui

    client:on("jail_status", function(data)
        if not data then return end
        game._jail.inJail = data.inJail or false
        game._jail.crime = data.crime
        game._jail.crimeLabel = data.crimeLabel
        game._jail.remainingMs = data.remainingMs or 0
        game._jail.bail = data.bail or 0
        game._jail.jailZoneId = data.jailZoneId
        game._jail.lastUpdate = love.timer.getTime()
        if data.inJail and not ui.showJail then
            ui.showJail = true
        end
    end)

    client:on("jail_bail", function(data)
        if not data then return end
        if data.ok then
            game._jail.inJail = false
            game._jail.message = data.message or "Bail paid! You are free."
            ui.showJail = false
        else
            game._jail.message = data.error or "Cannot pay bail"
        end
        game._jail.messageTimer = 3
    end)

    client:on("jail_serve_time", function(data)
        if not data then return end
        if data.released then
            game._jail.inJail = false
            game._jail.message = data.message or "Time served. You are free."
            ui.showJail = false
        else
            game._jail.remainingMs = data.remainingMs or 0
            game._jail.lastUpdate = love.timer.getTime()
            game._jail.message = data.message or "Still serving time..."
        end
        game._jail.messageTimer = 3
    end)
end

return M
