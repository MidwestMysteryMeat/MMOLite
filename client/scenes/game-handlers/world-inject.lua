-- game-handlers/world-inject.lua
-- Handles live world-state injections pushed by the writing tool:
--   zone_npc_added    — a new NPC was deployed to the current zone
--   fixture_spawned   — a new fixture/placed-object appeared in the zone
--   quest_marker_added — a quest marker was placed on the zone map

local M = {}

M.EVENTS = { "zone_npc_added", "fixture_spawned", "quest_marker_added" }

function M.register(client, game)
    -- NPC injected into the current zone by the writing tool
    client:on("zone_npc_added", function(data)
        if not data then return end
        if not game._zoneNpcs then game._zoneNpcs = {} end
        -- Replace or append; keyed by id so re-deploys don't duplicate
        local found = false
        for i, npc in ipairs(game._zoneNpcs) do
            if npc.id == data.id then
                game._zoneNpcs[i] = data
                found = true
                break
            end
        end
        if not found then
            table.insert(game._zoneNpcs, data)
        end
    end)

    -- A fixture site (mine, ruin, etc.) was spawned in the current zone
    client:on("fixture_spawned", function(data)
        if not data or not data.placedObject then return end
        if not game._zonePlacedObjects then game._zonePlacedObjects = {} end
        local obj = data.placedObject
        local found = false
        for i, o in ipairs(game._zonePlacedObjects) do
            if o.id == obj.id then
                game._zonePlacedObjects[i] = obj
                found = true
                break
            end
        end
        if not found then
            table.insert(game._zonePlacedObjects, obj)
        end
    end)

    -- A quest marker was placed on this zone's map
    client:on("quest_marker_added", function(data)
        if not data or not data.marker then return end
        if not game._questMarkers then game._questMarkers = {} end
        local marker = data.marker
        -- Replace existing marker for the same quest
        local found = false
        for i, m in ipairs(game._questMarkers) do
            if m.questId == marker.questId then
                game._questMarkers[i] = marker
                found = true
                break
            end
        end
        if not found then
            table.insert(game._questMarkers, marker)
        end
    end)
end

return M
