-- game-handlers/buildings.lua
-- Building entry results and deed/ownership info display.

local M = {}

M.EVENTS = { "building_enter_result", "building_deed_info" }

function M.register(client, game)
    client:on("building_enter_result", function(data)
        if not data then return end
        -- Store for the draw layer / zone transition logic to consume
        game._buildingEnter = {
            buildingId     = data.buildingId or "",
            interiorZoneId = data.interiorZoneId or "",
            ownerId        = data.ownerId,
            ownerName      = data.ownerName,
            leaseKey       = data.leaseKey,
            isOwner        = data.isOwner or false,
            label          = data.label or "",
        }
        -- If the building has an interior zone, request entry via zone_enter
        if data.interiorZoneId and data.interiorZoneId ~= "" then
            client:emit("zone_enter", { zoneId = data.interiorZoneId })
        end
    end)

    client:on("building_deed_info", function(data)
        if not data then return end
        game._buildingDeedInfo = {
            buildingId = data.buildingId or "",
            zoneId     = data.zoneId or "",
            label      = data.label or "",
            ownerId    = data.ownerId,
            ownerName  = data.ownerName,
            leaseKey   = data.leaseKey,
            hasDeed    = data.hasDeed or false,
        }
    end)
end

return M
