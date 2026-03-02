-- game-handlers/environment.lua
-- Disease, weather, influence, ecology events

local M = {}

M.EVENTS = {
    "disease_status", "disease_contracted", "disease_symptom",
    "weather_info", "influence_info", "ecology_info",
}

function M.register(client, game)
    client:on("disease_status", function(data)
        if data then
            game._disease.playerDiseases = data.diseases or {}
            game._disease.chunkDiseases = data.chunkDiseases or {}
        end
    end)

    client:on("disease_contracted", function(data)
        if data then
            game._disease.contractedFlash = 3.0
            game._disease.contractedName = data.name or "Unknown Disease"
            table.insert(game._directorEvents, {
                title = "Disease Contracted",
                description = data.message or ("You have contracted " .. (data.name or "a disease")),
                type = "disease",
                timer = 8,
            })
        end
    end)

    client:on("disease_symptom", function(data)
        if data then
            game._disease.symptomMsg = (data.name or "Disease") .. ": " .. (data.damage or 0) .. " damage"
            game._disease.symptomTimer = 2.0
        end
    end)

    client:on("weather_info", function(data)
        if data then
            game._weather.weather = data.weather or "clear"
            game._weather.intensity = data.intensity or 0.5
            game._weather.wind = data.wind and data.wind.name or "east"
        end
    end)

    client:on("influence_info", function(data)
        if data then
            game._influence.controlling = data.controlling
            game._influence.area = data.area or {}
        end
    end)

    client:on("ecology_info", function(data)
        if data then
            game._ecology.state = data.state or -1
            game._ecology.name = data.name or "unknown"
            game._ecology.resourceBonus = data.resourceBonus or 1.0
        end
    end)
end

return M
