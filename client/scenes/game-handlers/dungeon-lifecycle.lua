-- game-handlers/dungeon-lifecycle.lua
-- Broadcast dungeon lifecycle events (other players on the same floor)
-- and personal dungeon exit/force-exit events

local M = {}

M.EVENTS = {
    "dungeon_exit_complete", "dungeon_force_exit",
    "dungeon_chest_opened", "dungeon_npc_interacted",
    "dungeon_form_interactable_explored",
    "dungeon_animal_fled", "dungeon_animal_interacted",
}

function M.register(client, game, ctx)
    local dungeon = ctx.dungeon

    -- Personal: server confirms dungeon exit, zone_state will follow shortly
    client:on("dungeon_exit_complete", function(data)
        if not data then return end
        game.addChatMessage("You exit the dungeon.", {0.8, 0.8, 0.8})
    end)

    -- Personal: rift collapsed or forced exit — zone_state to overworld will follow
    client:on("dungeon_force_exit", function(data)
        if not data then return end
        game.addChatMessage(data.message or "You are expelled from the dungeon!", {1, 0.5, 0.2})
    end)

    -- Broadcast: another player opened a chest on this floor
    client:on("dungeon_chest_opened", function(data)
        if not data then return end
        if dungeon.chests then
            for _, c in ipairs(dungeon.chests) do
                if c.x == data.x and c.y == data.y then
                    c.opened = true
                    break
                end
            end
        end
        if data.openedBy then
            game.addChatMessage("[Dungeon] " .. data.openedBy .. " opened a chest", {0.8, 0.7, 0.3})
        end
    end)

    -- Broadcast: another player interacted with a dungeon NPC on this floor
    client:on("dungeon_npc_interacted", function(data)
        if not data then return end
        -- npcIndex is 0-based from JS; Lua ipairs arrays are 1-based
        if dungeon.npcs and data.npcIndex then
            local npc = dungeon.npcs[data.npcIndex + 1]
            if npc then npc.interacted = true end
        end
        if data.interactedBy then
            game.addChatMessage("[Dungeon] " .. data.interactedBy .. " spoke with an NPC", {0.7, 0.9, 0.7})
        end
    end)

    -- Broadcast: another player explored a form interactable — reveal shared tiles
    client:on("dungeon_form_interactable_explored", function(data)
        if not data then return end
        if dungeon.fog and dungeon.fogWidth and data.revealedTiles then
            for _, idx in ipairs(data.revealedTiles) do
                local fx = idx % dungeon.fogWidth
                local fy = math.floor(idx / dungeon.fogWidth)
                dungeon.fog[fx .. "," .. fy] = true
                if dungeon.fogState and dungeon.fogState[idx] ~= 2 then
                    dungeon.fogState[idx] = 1  -- REMEMBERED
                end
            end
        end
    end)

    -- Broadcast: an animal fled from another player on this floor
    client:on("dungeon_animal_fled", function(data)
        if not data then return end
        -- Animals are embedded in dungeon.floor; no separate list to prune
        -- No chat noise — fleeing is implicit from the other player's view
    end)

    -- Broadcast: another player interacted with an animal on this floor
    client:on("dungeon_animal_interacted", function(data)
        if not data then return end
        if data.interactedBy then
            game.addChatMessage("[Dungeon] " .. data.interactedBy .. " communed with an animal", {0.6, 0.9, 0.6})
        end
    end)
end

return M
