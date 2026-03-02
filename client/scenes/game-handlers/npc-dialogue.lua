-- game-handlers/npc-dialogue.lua
-- NPC dialogue open/close

local M = {}

M.EVENTS = { "npc_dialogue", "npc_dialogue_end" }

function M.register(client, game)
    client:on("npc_dialogue", function(data)
        if not data then return end
        game._npcDialogue.show = true
        game._npcDialogue.npcName = data.npcName or "NPC"
        game._npcDialogue.text = data.text or "..."
        game._npcDialogue.choices = data.choices or {}
        game._npcDialogue.npcId = data.npcId or ""
    end)

    client:on("npc_dialogue_end", function(data)
        game._npcDialogue.show = false
        game._npcDialogue.text = ""
        game._npcDialogue.choices = {}
    end)
end

return M
