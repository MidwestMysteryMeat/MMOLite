-- game-handlers/npc-lore.lua
-- NPC topic responses (lore brain) and portrait/trait display updates.

local M = {}

M.EVENTS = { "npc_topic_response" }

function M.register(client, game)
    client:on("npc_topic_response", function(data)
        if not data then return end
        -- Reuse the dialogue panel to show the topic response as a new line of dialogue,
        -- clearing choices so the player returns to the topic list via the UI.
        game._npcDialogue.show     = true
        game._npcDialogue.npcName  = data.npcName or game._npcDialogue.npcName or "NPC"
        game._npcDialogue.text     = data.text or "..."
        game._npcDialogue.choices  = {}
        game._npcDialogue.npcId    = data.npcId or game._npcDialogue.npcId or ""
        if data.portrait then
            game._npcDialogue.portrait = data.portrait
        end
        game._npcDialogue.topicMode = true   -- flag so draw layer can show "Back" choice
    end)
end

return M
