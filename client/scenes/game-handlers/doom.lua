-- game-handlers/doom.lua
-- Doom countdown status, start, pause, resume, ascension event

local M = {}

M.EVENTS = {
    "doom_status", "doom_countdown_started", "doom_countdown_paused",
    "doom_countdown_resumed", "doom_ascension_event",
}

function M.register(client, game, ctx)
    local doom = ctx.doom

    client:on("doom_status", function(data)
        if data then
            doom.active = data.active or false
            doom.remainingMs = data.remainingMs or 0
            doom.pushbackCount = data.pushbackCount or 0
            doom.doomAscensionCount = data.doomAscensionCount or 0
            doom.capitalCorrupted = data.capitalCorrupted or false
            doom.lastUpdate = love.timer.getTime()
        end
    end)

    client:on("doom_countdown_started", function(data)
        if data then
            doom.active = true
            doom.remainingMs = 48 * 3600000
            doom.lastUpdate = love.timer.getTime()
            doom.capitalCorrupted = true
            doom.flashTimer = 3.0
            table.insert(game._directorEvents, {
                title = "DOOM APPROACHES",
                description = data.message or "The corruption has breached Solara.",
                type = "doom_started",
                timer = 10,
            })
        end
    end)

    client:on("doom_countdown_paused", function(data)
        if data then
            doom.active = false
            doom.remainingMs = data.remainingMs or 0
            doom.pushbackCount = data.pushbackCount or 0
            doom.capitalCorrupted = false
            doom.lastUpdate = love.timer.getTime()
            table.insert(game._directorEvents, {
                title = "Doom Paused",
                description = data.message or "The corruption recedes from Solara.",
                type = "doom_paused",
                timer = 8,
            })
        end
    end)

    client:on("doom_countdown_resumed", function(data)
        if data then
            doom.active = true
            doom.remainingMs = data.remainingMs or 0
            doom.capitalCorrupted = true
            doom.lastUpdate = love.timer.getTime()
            table.insert(game._directorEvents, {
                title = "DOOM RESUMES",
                description = data.message or "The corruption reclaims Solara.",
                type = "doom_resumed",
                timer = 8,
            })
        end
    end)

    client:on("doom_ascension_event", function(data)
        doom.showEvent = true
        doom.eventTimer = 8.0
        doom.eventMessage = data and data.message or "The world resets."
        doom.doomAscensionCount = data and data.doomAscensionCount or 0
    end)
end

return M
