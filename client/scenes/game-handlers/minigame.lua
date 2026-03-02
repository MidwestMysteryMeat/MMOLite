-- game-handlers/minigame.lua
-- Crafting quality minigame

local M = {}

M.EVENTS = { "craft_minigame" }

function M.register(client, game)
    client:on("craft_minigame", function(data)
        if not data then return end
        game._minigame.active = true
        game._minigame.recipeId = data.recipeId
        game._minigame.duration = data.duration or 3000
        game._minigame.windowStart = data.windowStart or 400
        game._minigame.windowEnd = data.windowEnd or 600
        game._minigame.expiresAt = love.timer.getTime() + (data.duration or 3000) / 1000
        game._minigame.barPos = 0
        game._minigame.barDir = 1
        game._minigame.startedAt = love.timer.getTime()
        game._minigame.result = nil
        game._minigame.resultTimer = 0
    end)
end

return M
