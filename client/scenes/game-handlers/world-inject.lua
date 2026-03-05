-- game-handlers/world-inject.lua
-- Handles live world-state injections pushed by the writing tool and quest system:
--   zone_npc_added       — a new NPC was deployed to the current zone
--   fixture_spawned      — a new fixture/placed-object appeared in the zone
--   quest_marker_added   — a quest marker was placed on the zone map
--   zone_connection_added — a new enterable connection appeared in the zone

local M = {}

M.EVENTS = { "zone_npc_added", "fixture_spawned", "quest_marker_added", "zone_connection_added" }

function M.register(client, game, ctx)
    -- NPC injected into the current zone by the writing tool
    client:on("zone_npc_added", function(data)
        if not data then return end
        if not game._zoneNpcs then game._zoneNpcs = {} end
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

    -- A fixture site was spawned in the current zone.
    -- Injects directly into the live placedObjects table so hover detection
    -- and drawing work without any additional changes.
    client:on("fixture_spawned", function(data)
        if not data or not data.placedObject then return end
        local obj = data.placedObject

        -- Live table reference — hover detection and drawPlacedObjects pick this up
        if ctx then
            local es = ctx.getEntityState()
            if es and es.placedObjects then
                local found = false
                for i, o in ipairs(es.placedObjects) do
                    if o.id == obj.id then
                        es.placedObjects[i] = obj
                        found = true
                        break
                    end
                end
                if not found then
                    table.insert(es.placedObjects, obj)
                end
            end
        end

        -- Also keep game._zonePlacedObjects in sync (used by quest marker drawing)
        if not game._zonePlacedObjects then game._zonePlacedObjects = {} end
        local found2 = false
        for i, o in ipairs(game._zonePlacedObjects) do
            if o.id == obj.id then
                game._zonePlacedObjects[i] = obj
                found2 = true
                break
            end
        end
        if not found2 then
            table.insert(game._zonePlacedObjects, obj)
        end
    end)

    -- A quest marker was placed on this zone's map
    client:on("quest_marker_added", function(data)
        if not data or not data.marker then return end
        if not game._questMarkers then game._questMarkers = {} end
        local marker = data.marker
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

    -- A new enterable connection appeared (procedural quest location, live deploy).
    -- Injects into the live connections table so drawConnections and hover
    -- detection both pick it up immediately for existing zone occupants.
    client:on("zone_connection_added", function(data)
        if not data or not data.connection then return end
        local conn = data.connection
        if ctx then
            local es = ctx.getEntityState()
            if es and es.connections then
                local found = false
                for i, c in ipairs(es.connections) do
                    if c.targetZone == conn.targetZone then
                        es.connections[i] = conn
                        found = true
                        break
                    end
                end
                if not found then
                    table.insert(es.connections, conn)
                end
            end
        end
    end)
end

return M
