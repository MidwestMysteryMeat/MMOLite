-- game-handlers/combat-feedback.lua
-- Zone-broadcast combat visuals: ability use, DoT ticks

local M = {}

M.EVENTS = { "ability_used", "card_ability_used", "combat_ability_used", "dot_tick" }

function M.register(client, game, ctx)
    local players      = ctx.players
    local zoneMonsters = ctx.zoneMonsters

    -- Another player used an overworld ability — show brief label above them
    client:on("ability_used", function(data)
        if not data then return end
        local p = data.playerId and players[data.playerId]
        if not p then return end
        local label = data.abilityName or "Ability"
        if data.damage and data.damage > 0 then
            label = label .. " (" .. data.damage .. ")"
        end
        game.addFloatingText({
            text  = label,
            x     = p.x, y = p.y - 50,
            color = {0.6, 0.8, 1},
            timer = 2,
        })
    end)

    -- Another player used a card ability overworld — show brief label above them
    client:on("card_ability_used", function(data)
        if not data then return end
        local p = data.playerId and players[data.playerId]
        if not p then return end
        local label = data.cardName or "Card Ability"
        if data.damage and data.damage > 0 then
            label = label .. " (" .. data.damage .. ")"
        end
        game.addFloatingText({
            text  = label,
            x     = p.x, y = p.y - 50,
            color = {0.8, 0.6, 1},
            timer = 2,
        })
    end)

    -- Dungeon turn-based: a unit used a card ability — chat notification for party members
    client:on("combat_ability_used", function(data)
        if not data then return end
        game.addChatMessage("[Combat] " .. (data.cardName or "Ability") .. " used", {0.7, 0.5, 1})
    end)

    -- DoT tick on a zone monster — float damage above the monster
    client:on("dot_tick", function(data)
        if not data then return end
        for _, m in ipairs(zoneMonsters) do
            if m.id == data.monsterId then
                local mx = m.targetX or m.x or 0
                local my = m.targetY or m.y or 0
                game.addFloatingText({
                    text  = "-" .. (data.damage or 0),
                    x     = mx, y = my - 20,
                    color = {1, 0.5, 0.2},
                    timer = 1.5,
                })
                break
            end
        end
    end)
end

return M
