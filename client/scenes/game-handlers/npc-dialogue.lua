-- game-handlers/npc-dialogue.lua
-- NPC dialogue open/close

local M = {}

M.EVENTS = { "npc_dialogue", "npc_dialogue_end" }

function M.register(client, game)
    client:on("npc_dialogue", function(data)
        if not data then return end
        game._npcDialogue.show            = true
        game._npcDialogue.npcId           = data.npcId or ""
        game._npcDialogue.npcName         = data.npcName or "NPC"
        game._npcDialogue.text            = data.text or "..."
        game._npcDialogue.choices         = data.choices or {}
        game._npcDialogue.portrait        = data.portrait or nil
        game._npcDialogue.race            = data.race or nil
        game._npcDialogue.traits          = data.traits or nil
        game._npcDialogue.voiceTone       = data.voiceTone or nil
        game._npcDialogue.availableTopics = data.availableTopics or nil
        game._npcDialogue.topicMode       = false
        -- Clear stale quest offers from prior interaction
        game._npcDialogue.questOffers     = nil
        game._npcDialogue.questTurnins    = nil
        game._npcDialogue.questNpcId      = ""
    end)

    client:on("npc_dialogue_end", function(data)
        game._npcDialogue.show            = false
        game._npcDialogue.npcId           = ""
        game._npcDialogue.text            = ""
        game._npcDialogue.choices         = {}
        game._npcDialogue.portrait        = nil
        game._npcDialogue.race            = nil
        game._npcDialogue.traits          = nil
        game._npcDialogue.voiceTone       = nil
        game._npcDialogue.availableTopics = nil
        game._npcDialogue.topicMode       = false
        game._npcDialogue.questOffers     = nil
        game._npcDialogue.questTurnins    = nil
        game._npcDialogue.questNpcId      = ""
    end)
end

return M
