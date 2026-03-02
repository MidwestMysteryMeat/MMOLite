-- game-handlers/knowledge.lua
-- Knowledge data, book content, discoveries, term unlocks

local M = {}

M.EVENTS = {
    "knowledge_data", "knowledge_book_content",
    "knowledge_book_discovered", "knowledge_term_unlocked",
}

function M.register(client, game, ctx)
    local knowledge = ctx.knowledge
    local ui = ctx.ui

    client:on("knowledge_data", function(data)
        if not data then return end
        local tab = data.tab or "glossary"
        if tab == "glossary" then
            knowledge.glossaryTerms = data.glossaryTerms
            knowledge.glossaryUnlocked = data.glossaryUnlocked or {}
        elseif tab == "lore" then
            knowledge.loreData = data.loreData
        elseif tab == "books" then
            knowledge.books = data.books
        elseif tab == "codex" then
            knowledge.codex = data.codex
        end
    end)

    client:on("knowledge_book_content", function(data)
        if not data then return end
        if data.error then
            knowledge.bookContent = nil
            return
        end
        knowledge.bookContent = data
    end)

    client:on("knowledge_book_discovered", function(data)
        if not data then return end
        table.insert(knowledge.notifications, {
            type = "book",
            title = data.title or "Unknown Book",
            rarity = data.rarity or "common",
            source = data.source or "unknown",
            timer = 5,
        })
        if ui.showKnowledge and knowledge.tab == "books" and client then
            client:emit("knowledge_get", { tab = "books" })
        end
    end)

    client:on("knowledge_term_unlocked", function(data)
        if not data then return end
        table.insert(knowledge.notifications, {
            type = "term",
            term = data.term or "Unknown",
            category = data.category or "",
            timer = 4,
        })
    end)
end

return M
