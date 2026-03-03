-- game-handlers/equipment.lua
-- Equipment update, equip error, durability, abilities, food, repair

local M = {}

M.EVENTS = {
    "equipment_updated", "equip_error", "durability_info",
    "abilities_list", "ability_error", "ability_result", "cooldown_update",
    "card_ability_result", "card_ability_error", "card_cooldown_update",
    "food_consumed", "food_error", "repair_result", "repair_error",
    "card_abilities_list",
}

function M.register(client, game, ctx)
    local players = ctx.players
    local rpg = ctx.rpg
    local dungeon = ctx.dungeon
    local sprint = ctx.sprint
    local ui = ctx.ui
    local getMmoInventory = ctx.getMmoInventory
    local setMmoInventory = ctx.setMmoInventory
    local getMyId = ctx.getMyId
    local setDurabilityData = ctx.setDurabilityData

    client:on("equipment_updated", function(data)
        if not data or not data.equipment then return end
        if rpg then
            rpg.equipment = data.equipment
            rpg.dualWieldCombo = data.dualWieldCombo or nil
        end
        if data.durability then setDurabilityData(data.durability) end
    end)

    client:on("equip_error", function(data)
        if not data then return end
        local myId = getMyId()
        local me = players[myId]
        if me then
            game.addFloatingText({
                text = data.message or "Equip error",
                x = me.x, y = me.y - 40,
                color = {1, 0.3, 0.3},
                timer = 2,
            })
        end
    end)

    client:on("durability_info", function(data)
        if data and data.durability then
            setDurabilityData(data.durability)
            for slot, info in pairs(data.durability) do
                if info.broken then
                    table.insert(game._notifications, { text = slot .. " item broke!", color = {1, 0.2, 0.2}, timer = game.NOTIFICATION_DURATION, maxTimer = game.NOTIFICATION_DURATION })
                elseif info.low then
                    table.insert(game._notifications, { text = slot .. " durability low!", color = {1, 0.7, 0.2}, timer = game.NOTIFICATION_DURATION, maxTimer = game.NOTIFICATION_DURATION })
                end
            end
        end
    end)

    client:on("food_consumed", function(data)
        if not data then return end
        if data.inventory then setMmoInventory(data.inventory) end
        local myId = getMyId()
        local me = players[myId]
        if me then
            local msg = "+" .. (data.hpRestored or 0) .. " HP"
            if data.buff then msg = msg .. " | " .. (data.buff.stat or "") .. " +" .. (data.buff.value or 0) end
            game.addFloatingText({ text = msg, x = me.x, y = me.y - 40, color = {0.3, 1, 0.3}, timer = 2.5 })
        end
        sprint.stamina = math.min(sprint.MAX, sprint.stamina + sprint.FOOD_RESTORE)
        if ui.showGridInventory then client:emit("grid_sync", {}) end
    end)

    client:on("food_error", function(data)
        if not data then return end
        local myId = getMyId()
        local me = players[myId]
        if me then
            game.addFloatingText({ text = data.message or "Cannot eat that", x = me.x, y = me.y - 40, color = {1, 0.3, 0.3}, timer = 2 })
        end
    end)

    client:on("repair_result", function(data)
        if not data then return end
        if data.inventory then setMmoInventory(data.inventory) end
        if data.durability then setDurabilityData(data.durability) end
        local myId = getMyId()
        local me = players[myId]
        if me then
            game.addFloatingText({ text = data.message or "Item repaired!", x = me.x, y = me.y - 40, color = {0.3, 0.8, 1}, timer = 2 })
        end
    end)

    client:on("repair_error", function(data)
        if not data then return end
        local myId = getMyId()
        local me = players[myId]
        if me then
            game.addFloatingText({ text = data.message or "Repair failed", x = me.x, y = me.y - 40, color = {1, 0.3, 0.3}, timer = 2 })
        end
    end)

    client:on("abilities_list", function(data)
        if not data then return end
        game._abilityBar.abilities = data.abilities or {}
        game._abilityBar.weaponFamily = data.weaponFamily
    end)

    client:on("ability_error", function(data)
        if not data then return end
        game.addChatMessage(data.message or "Ability failed", {1, 0.3, 0.3})
    end)

    client:on("ability_result", function(data)
        if not data then return end
        if data.success == false then
            game.addChatMessage(data.error or "Ability missed", {1, 0.5, 0.3})
        end
    end)

    client:on("cooldown_update", function(data)
        if not data then return end
        if data.abilities then
            game._abilityBar.abilities = data.abilities
        end
        if data.mana ~= nil then dungeon.playerMana = data.mana end
        if data.maxMana ~= nil then dungeon.playerMaxMana = data.maxMana end
        if data.cardAbilities then
            game._abilityBar.cardAbilities = data.cardAbilities
        end
    end)

    client:on("card_ability_error", function(data)
        if not data then return end
        game.addChatMessage(data.message or "Card ability failed", {1, 0.4, 0.2})
    end)

    client:on("card_ability_result", function(data)
        if not data then return end
        if data.success == false then
            game.addChatMessage(data.error or "Card ability failed", {1, 0.5, 0.3})
        end
    end)

    client:on("card_cooldown_update", function(data)
        if not data then return end
        if data.cardAbilities then
            game._abilityBar.cardAbilities = data.cardAbilities
        end
        if data.mana ~= nil then dungeon.playerMana = data.mana end
        if data.maxMana ~= nil then dungeon.playerMaxMana = data.maxMana end
    end)

    client:on("card_abilities_list", function(data)
        if not data then return end
        game._abilityBar.cardAbilities = data.cardAbilities or {}
    end)
end

return M
