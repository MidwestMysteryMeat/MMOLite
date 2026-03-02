-- game-handlers/guild.lua
-- Guild create, error, list, update, leave, message, vault

local M = {}

M.EVENTS = {
    "guild_created", "guild_error", "guild_list_result", "guild_updated",
    "guild_left", "guild_message", "guild_vault_contents", "guild_vault_updated",
}

function M.register(client, game)
    client:on("guild_created", function(data)
        if not data then return end
        game._guild.guildId = data.guildId
        game._guild.guildName = data.name
        game._guild.members = data.members or {}
        game._guild.tab = "info"
        game._guild.message = "Guild created!"
        game._guild.messageTimer = 3
    end)

    client:on("guild_error", function(data)
        if not data then return end
        game._guild.message = data.message or "Guild error"
        game._guild.messageTimer = 3
    end)

    client:on("guild_list_result", function(data)
        if not data then return end
        game._guild.guildList = data.guilds or {}
    end)

    client:on("guild_updated", function(data)
        if not data then return end
        game._guild.guildId = data.guildId
        game._guild.members = data.members or game._guild.members
        game._guild.message = data.event or "Guild updated"
        game._guild.messageTimer = 2
    end)

    client:on("guild_left", function(data)
        game._guild.guildId = nil
        game._guild.guildName = nil
        game._guild.members = {}
        game._guild.vault = nil
        game._guild.messages = {}
        game._guild.tab = "browse"
        game._guild.message = "Left guild"
        game._guild.messageTimer = 3
    end)

    client:on("guild_message", function(data)
        if not data then return end
        table.insert(game._guild.messages, {
            authorName = data.authorName or "???",
            content = data.content or "",
            timestamp = data.timestamp or 0,
        })
        if #game._guild.messages > 100 then table.remove(game._guild.messages, 1) end
    end)

    client:on("guild_vault_contents", function(data)
        if not data then return end
        game._guild.vault = { cards = data.cards or {}, resources = data.resources or {} }
    end)

    client:on("guild_vault_updated", function(data)
        if not data then return end
        if data.resources then game._guild.vault = game._guild.vault or {}; game._guild.vault.resources = data.resources end
        if data.cards then game._guild.vault = game._guild.vault or {}; game._guild.vault.cards = data.cards end
        game._guild.message = data.event or "Vault updated"
        game._guild.messageTimer = 2
    end)
end

return M
