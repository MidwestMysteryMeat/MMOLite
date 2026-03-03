-- scenes/game-input.lua
-- Keyboard and mouse input: keypressed, textinput, mousepressed, mousemoved, wheelmoved.

local game_input = {}

local dungeonDrawModule = require("scenes.game-draw.dungeon")
local worldDrawModule   = require("scenes.game-draw.world")

-- 'game' alias: all game._xxx references and game.xxx calls work unchanged
local game

-- Direct table refs (mutated in-place, safe to capture at init time)
local dungeon, camera, rpg, players, chat, overworld, tcState, ui, knowledge
local combatUI, combatAnim, gridInv, permadeath, DTILE, CONTEXT_MENU_ITEMS_BASE

-- Getters for reassignable module-level locals in game.lua
local getClient, getZone, getMyId, getSkills
local getHoverResource, getHoverObject, getHoverConnection
local getCorpseLootPanel, getContainerLootPanel, getPackReveal
local getZoneMonsters, getZoneCorpses, getZoneWorldContainers
local getMapZoom, getMonsterAttackCooldown
local getEquipSlotButtons, getInventoryItemButtons, getCraftingButtons

-- Setters for reassignable locals written by input handlers
local setCorpseLootPanel, setContainerLootPanel, setPackReveal
local setMapZoom, setMonsterAttackCooldown

local function keypressed(key)
    local zone                = getZone()
    local myId               = getMyId()
    local client             = getClient()
    local skills             = getSkills()
    local hoverResource      = getHoverResource()
    local hoverObject        = getHoverObject()
    local hoverConnection    = getHoverConnection()
    local corpseLootPanel    = getCorpseLootPanel()
    local containerLootPanel = getContainerLootPanel()
    local packReveal         = getPackReveal()
    local zoneMonsters       = getZoneMonsters()
    local zoneCorpses        = getZoneCorpses()
    local zoneWorldContainers = getZoneWorldContainers()
    local monsterAttackCooldown = getMonsterAttackCooldown()
    -- NPC Dialogue keyboard: number keys select choices
    if game._npcDialogue.show then
        if key == "escape" then
            if game._npcDialogue.topicMode then
                game._npcDialogue.topicMode = false  -- step back to dialogue, not close
            else
                game._npcDialogue.show = false
            end
            return
        end
        local num = tonumber(key)
        if num and num >= 1 and num <= #game._npcDialogue.choices then
            client:emit("npc_dialogue_choice", { choiceIndex = game._npcDialogue.choices[num].index })
            return
        end
    end

    -- Escape during zone loading OR error state returns to server select
    if not zone and key == "escape" then
        game._loadError = nil
        game._zoneLoadTimeout = nil
        _G.switchScene("shards")
        return
    end

    -- Permadeath death screen: Continue goes to character select
    if permadeath.showDeathScreen then
        if key == "return" or key == "kpenter" or key == "escape" then
            permadeath.showDeathScreen = false
            permadeath.deathHero = nil
            _G.switchScene("character_select")
        end
        return
    end

    -- Permadeath Hall of Heroes panel
    if permadeath.showHallOfHeroes then
        if key == "escape" or key == "h" then
            permadeath.showHallOfHeroes = false
        end
        return
    end

    -- Permadeath: while downed, only allow revive-related keys (E key is handled below)
    if permadeath.isDowned then
        return -- block all input while downed
    end

    -- Crafting minigame: space to click
    if game._minigame.active and not game._minigame.result then
        if key == "space" then
            local clickPos = math.floor(game._minigame.barPos)
            if clickPos >= game._minigame.windowStart and clickPos <= game._minigame.windowEnd then
                local mid = (game._minigame.windowStart + game._minigame.windowEnd) / 2
                local dist = math.abs(clickPos - mid)
                local range = (game._minigame.windowEnd - game._minigame.windowStart) / 2
                game._minigame.result = dist < range * 0.3 and "perfect" or "good"
            else
                game._minigame.result = "miss"
            end
            game._minigame.resultTimer = 1.5
            if client then client:emit("craft_minigame_result", { clickPos = clickPos }) end
            return
        end
    end

    -- Guild chat/create input handling
    if ui.showGuild then
        if game._guild.chatActive then
            if key == "return" or key == "kpenter" then
                if #game._guild.chatInput > 0 and client then
                    client:emit("guild_chat", { message = game._guild.chatInput })
                    game._guild.chatInput = ""
                end
                return
            elseif key == "backspace" then
                game._guild.chatInput = game._guild.chatInput:sub(1, -2)
                return
            elseif key == "escape" then
                game._guild.chatActive = false
                return
            end
        end
        if game._guild.createActive then
            if key == "return" or key == "kpenter" then
                game._guild.createActive = false
                return
            elseif key == "backspace" then
                game._guild.createName = game._guild.createName:sub(1, -2)
                return
            elseif key == "escape" then
                game._guild.createActive = false
                return
            end
        end
    end

    -- Dismiss context menu on Escape (highest priority)
    if ui.contextMenu and key == "escape" then
        ui.contextMenu = nil
        return
    end

    -- Close loot panel on Escape
    if (corpseLootPanel or containerLootPanel) and key == "escape" then
        setCorpseLootPanel(nil)
        setContainerLootPanel(nil)
        return
    end

    -- Pack reveal: block input (click advances/closes, Escape also closes)
    if packReveal then
        if key == "escape" then
            setPackReveal(nil)
        end
        return
    end

    -- Trade panel: Escape cancels game._trade
    if game._trade.show then
        if key == "escape" then
            if game._trade.tradeId and client then
                client:emit("trade_cancel", { tradeId = game._trade.tradeId })
            end
            game.resetTradeState()
        elseif key == "backspace" and game._trade.coinInputActive then
            game._trade.coinInput = game._trade.coinInput:sub(1, -2)
        end
        return  -- block all other input while game._trade panel is open
    end

    -- Trade pending request: accept/decline with Y/N keys
    if game._trade.pendingRequest then
        if key == "y" then
            if client then
                client:emit("trade_accept", { tradeId = game._trade.pendingRequest.tradeId })
            end
            -- Don't clear pendingRequest here; trade_started listener will do it
        elseif key == "n" then
            if client then
                client:emit("trade_cancel", { tradeId = game._trade.pendingRequest.tradeId })
            end
            game._trade.pendingRequest = nil
            game._trade._pendingTimer = nil
        end
        -- Don't return — allow other input while request popup is showing
    end

    -- Lich Raid gathering: Enter = force start, Escape = leave
    if game._raid.gathering and game._raid.gathering.phase == "gathering" then
        if (key == "return" or key == "kpenter") and client then
            client:emit("raid_force_start", {})
            return
        elseif key == "escape" and client then
            client:emit("dungeon_exit", {})
            game._raid.gathering = nil
            game._raid.myParty = nil
            return
        end
    end

    -- Portal panel: Escape closes it
    if game._portal.show then
        if key == "escape" then
            game._portal.show = false
            game._portal.scroll = 0
        end
        return  -- block all other input while game._portal panel is open
    end

    -- Auction panel: Escape closes it
    if game._auction.show then
        if key == "escape" then
            game._auction.show = false
            game._auction.selected = nil
            game._auction.scroll = 0
            game._auction.searchActive = false
            game._auction.priceActive = false
        elseif key == "backspace" then
            if game._auction.searchActive then
                game._auction.filters.search = game._auction.filters.search:sub(1, -2)
            elseif game._auction.priceActive then
                game._auction.sellPrice = game._auction.sellPrice:sub(1, -2)
            end
        elseif key == "return" or key == "kpenter" then
            if game._auction.searchActive and client then
                client:emit("mmo_auction_browse", {
                    search = game._auction.filters.search,
                    rarity = game._auction.filters.rarity,
                    page = 1,
                })
                game._auction.searchActive = false
            end
        end
        return
    end

    -- NPC Shop panel: Escape closes it
    if game._npcShop.show then
        if key == "escape" then
            game._npcShop.show = false
            game._npcShop.selected = nil
            game._npcShop.amount = 1
            game._npcShop.scroll = 0
        end
        return  -- block all other input while shop is open
    end

    -- Bank vault panel: Escape closes it
    if game._bank.show then
        if key == "escape" then
            game._bank.show = false
            game._bank.selected = nil
            game._bank.amount = 1
            game._bank.scroll = 0
        end
        return
    end

    if ui.showWorldMap then
        if key == "m" or key == "escape" then
            ui.showWorldMap = false
        elseif key == "=" or key == "+" or key == "kp+" then
            setMapZoom(math.min(50, getMapZoom() * 1.5))
        elseif key == "-" or key == "kp-" then
            setMapZoom(math.max(1, getMapZoom() / 1.5))
        end
        return
    end

    if ui.showZoneList then
        if key == "m" or key == "escape" then
            ui.showZoneList = false
        end
        return
    end

    if ui.showEquipment then
        if key == "g" or key == "escape" then
            ui.showEquipment = false
        end
        return
    end

    if ui.showGridInventory then
        if key == "i" or key == "escape" then
            ui.showGridInventory = false
        elseif gridInv.keypressed(key) then
            -- handled by grid inventory
        end
        return
    end

    if ui.showInventory then
        if key == "i" or key == "escape" then
            ui.showInventory = false
        end
        return
    end

    if ui.showMastery then
        if key == "escape" then
            ui.showMastery = false
        end
        return
    end

    if ui.showCharSheet then
        if key == "c" or key == "escape" then
            ui.showCharSheet = false
        end
        return
    end

    if ui.showCardCollection then
        if key == "escape" then
            if ui.selectedCard then
                ui.selectedCard = nil
            elseif game._fusionMode.active then
                game._fusionMode.active = false
                game._fusionMode.card1 = nil
            else
                ui.showCardCollection = false
                ui.cardTab = "collection"
            end
        elseif key == "k" then
            ui.showCardCollection = false
            ui.selectedCard = nil
            ui.cardTab = "collection"
            game._fusionMode.active = false
            game._fusionMode.card1 = nil
        end
        return
    end

    if ui.showPartyPanel then
        if game._raid.partyInviteActive then
            if key == "escape" then
                game._raid.partyInviteActive = false
                game._raid.partyInviteInput = ""
            elseif key == "return" or key == "kpenter" then
                -- Send invite on Enter
                if client and #game._raid.partyInviteInput > 0 and game._raid.partyData then
                    local targetId = nil
                    for id, p in pairs(players) do
                        if id ~= myId and p.name and p.name:lower() == game._raid.partyInviteInput:lower() then
                            targetId = id
                            break
                        end
                        if id ~= myId and p.username and p.username:lower() == game._raid.partyInviteInput:lower() then
                            targetId = id
                            break
                        end
                    end
                    if targetId then
                        client:emit("party_invite", { targetId = targetId })
                        game.addFloatingText({
                            text = "Invite sent to " .. game._raid.partyInviteInput,
                            x = players[myId] and players[myId].x or 0,
                            y = players[myId] and (players[myId].y - 40) or 0,
                            color = {0.4, 0.7, 1},
                            timer = 2.5,
                        })
                    else
                        game.addFloatingText({
                            text = "Player '" .. game._raid.partyInviteInput .. "' not found in zone",
                            x = players[myId] and players[myId].x or 0,
                            y = players[myId] and (players[myId].y - 40) or 0,
                            color = {1, 0.3, 0.3},
                            timer = 2.5,
                        })
                    end
                    game._raid.partyInviteInput = ""
                end
                game._raid.partyInviteActive = false
            elseif key == "backspace" then
                game._raid.partyInviteInput = game._raid.partyInviteInput:sub(1, -2)
            end
            return
        end
        if key == "y" or key == "escape" then
            ui.showPartyPanel = false
            game._raid.partyInviteActive = false
            game._raid.partyInviteInput = ""
        end
        return
    end

    -- Combat input routing (highest priority when in combat, after UI dismissals)
    if tcState.inCombat and not chat.active then
        -- Block input during animations
        if combatAnim.isPlaying() then return end

        local action = combatUI.handleKey(key)
        if action then
            if action.type == "end_turn" or action.type == "wait" then
                if tcState.combatMyTurn and client then
                    client:emit("tc_combat_action", {
                        combatId = tcState.combatId,
                        action = action.type,
                        data = action.data or {},
                    })
                    tcState.combatMyTurn = false
                    combatUI.setMyTurn(false, nil)
                end
            elseif action.type == "cancel" then
                -- Just cancel selection, handled in combatUI
            end
            return
        end
        -- Let escape and enter fall through to chat/UI
        if key ~= "escape" and key ~= "return" then return end
    end

    -- Accept combat join offer with J key
    if not tcState.inCombat and dungeon.combatJoinOffer and key == "j" then
        if client then
            client:emit("tc_combat_join_accept", { combatId = dungeon.combatJoinOffer.combatId })
        end
        dungeon.combatJoinOffer = nil
        return
    end

    if chat.active then
        if key == "escape" then
            chat.active = false
            chat.input = ""
        elseif key == "return" or key == "kpenter" then
            if #chat.input > 0 then
                -- Check for /party or /p prefix for party chat
                local partyMsg = chat.input:match("^/party%s+(.+)") or chat.input:match("^/p%s+(.+)")
                if partyMsg and game._raid.partyData then
                    client:emit("party_chat", { message = partyMsg })
                else
                    client:emit("zone_chat", { message = chat.input })
                end
                chat.input = ""
            end
            chat.active = false
        elseif key == "backspace" then
            chat.input = chat.input:sub(1, -2)
        end
        return
    end

    if (key == "return" or key == "kpenter") and dungeon.turnBasedMode and dungeon.turnModeMyTurn then
        -- End turn in BG3-style turn-based mode
        client:emit("dungeon_end_turn", {})
        dungeon.turnModeMyTurn = false
    elseif key == "x" and dungeon.turnBasedMode and dungeon.turnModeMyTurn and not dungeon.turnModeDashed then
        -- Dash: spend action to gain extra movement points
        client:emit("dungeon_dash", {})
    elseif (key == "return" or key == "kpenter") and not _G.offlineMode then
        chat.active = true
        chat.input = ""
    elseif key == "space" then
        -- Space bar: primary attack in dungeon (exploration mode only)
        if dungeon.inDungeon and dungeon.enemies and not tcState.inCombat then
            for i, enemy in ipairs(dungeon.enemies) do
                if enemy.alive ~= false then
                    local dx = math.abs(enemy.x - dungeon.playerTileX)
                    local dy = math.abs(enemy.y - dungeon.playerTileY)
                    if dx <= 1 and dy <= 1 then
                        client:emit("dungeon_attack", { enemyIndex = i - 1 })
                        return
                    end
                end
            end
        end
        -- Space bar: attack overworld monster (non-dungeon, non-combat)
        if not dungeon.inDungeon and not tcState.inCombat and monsterAttackCooldown <= 0 then
            local me = players[myId]
            if me and #zoneMonsters > 0 and client then
                -- Find nearest monster within 64px
                local nearestMonster = nil
                local nearestDistSq = 64 * 64
                for _, m in ipairs(zoneMonsters) do
                    local ddx = me.x - (m.x or 0)
                    local ddy = me.y - (m.y or 0)
                    local dSq = ddx * ddx + ddy * ddy
                    if dSq < nearestDistSq then
                        nearestDistSq = dSq
                        nearestMonster = m
                    end
                end
                if nearestMonster then
                    client:emit("zone_combat_engage", { monsterId = nearestMonster.id })
                    setMonsterAttackCooldown(0.8)
                    return
                end
            end
        end
    elseif key == "f" then
        -- Corruption cleanse (overworld, with purification crystal)
        if not dungeon.inDungeon and client then
            local me = players and players[myId]
            if me then
                local mcx = math.floor(me.x / overworld.chunkSize)
                local mcy = math.floor(me.y / overworld.chunkSize)
                local cKey = mcx .. "," .. mcy
                local cLevel = corruption.chunks[cKey]
                if cLevel and cLevel > 0 then
                    client:emit("corruption_cleanse", {})
                end
            end
        end
    elseif key == "r" and not chat.active then
        -- Card-based corruption cleanse (overworld, drains HP & mana)
        if not dungeon.inDungeon and client then
            local me = players and players[myId]
            if me then
                local mcx = math.floor(me.x / overworld.chunkSize)
                local mcy = math.floor(me.y / overworld.chunkSize)
                local cKey = mcx .. "," .. mcy
                local cLevel = corruption.chunks[cKey]
                if cLevel and cLevel > 0 and rpg.equippedCards and rpg.cards then
                    -- Find the first active overworld cleanse card
                    local cardLookup = {}
                    for _, c in ipairs(rpg.cards) do
                        if c and c.instanceId then cardLookup[c.instanceId] = c end
                    end
                    for _, eqId in ipairs(rpg.equippedCards) do
                        local card = eqId and cardLookup[eqId]
                        if card and card.effects then
                            for _, eff in ipairs(card.effects) do
                                if eff.type == "overworld_cleanse" then
                                    client:emit("corruption_card_cleanse", { cardId = card.cardId })
                                    return
                                end
                            end
                        end
                    end
                end
            end
        end
        -- Leviathan flee (during aggro window)
        if overworld.leviathanAggro and overworld.leviathanAggroTimer > 0 and client then
            client:emit("leviathan_flee", { leviathanId = overworld.leviathanAggro.leviathanId })
        end
    elseif key == "h" and not chat.active then
        if permadeath.showHallOfHeroes then
            -- Toggle hall of heroes off
            permadeath.showHallOfHeroes = false
        elseif love.keyboard.isDown("lshift") or love.keyboard.isDown("rshift") then
            -- Shift+H: Hall of Heroes (permadeath memorial)
            if client then
                client:emit("hall_of_heroes", {})
            end
        else
            -- H: Home teleport
            if client then
                client:emit("home_teleport", {})
            end
        end
    elseif key == "f" and dungeon.inDungeon and not tcState.inCombat and not chat.active then
        -- Activate weapon special
        if game._itemUI.weaponSpecialName and game._itemUI.weaponSpecialCharge >= game._itemUI.weaponSpecialMax and client then
            client:emit("dungeon_use_weapon_special", {})
        end
    elseif (key == "1" or key == "2" or key == "3" or key == "4") and dungeon.inDungeon and not tcState.inCombat and not chat.active then
        -- Activate inscription slot
        local slotIdx = tonumber(key)
        if slotIdx and game._itemUI.inscriptionSlots[slotIdx] and client then
            local ins = game._itemUI.inscriptionSlots[slotIdx]
            if not ins.cooldownLeft or ins.cooldownLeft <= 0 then
                client:emit("dungeon_use_inscription", { slotIndex = slotIdx })
            end
        end
    elseif key == "e" then
        -- Revive downed player (permadeath)
        if dungeon.inDungeon and next(permadeath.downedPlayers) then
            local px, py = dungeon.playerTileX, dungeon.playerTileY
            for sid, dp in pairs(permadeath.downedPlayers) do
                local dist = math.abs(dp.x - px) + math.abs(dp.y - py)
                if dist <= 2 then
                    client:emit("revive_player", { targetSocketId = sid })
                    break
                end
            end
        end
        -- Dungeon interactions
        if dungeon.inDungeon and dungeon.grid then
            local tile = nil
            if dungeon.grid[dungeon.playerTileY + 1] then
                tile = dungeon.grid[dungeon.playerTileY + 1][dungeon.playerTileX + 1]
            end
            -- Stairs/exit
            if tile == DTILE.STAIRS_DOWN or tile == DTILE.EXIT or tile == DTILE.BOSS_DOOR then
                client:emit("dungeon_descend", {})
            elseif tile == DTILE.STAIRS_UP or tile == DTILE.ENTRANCE then
                if dungeon.floorNum <= 1 then
                    client:emit("dungeon_exit", {})
                    dungeon.inDungeon = false
                else
                    client:emit("dungeon_ascend", {})
                end
            end
            -- Adjacent chest
            for _, chest in ipairs(dungeon.chests) do
                if not chest.opened then
                    local dx = math.abs(chest.x - dungeon.playerTileX)
                    local dy = math.abs(chest.y - dungeon.playerTileY)
                    if dx <= 1 and dy <= 1 and (dx + dy) <= 1 then
                        client:emit("dungeon_open_chest", { x = chest.x, y = chest.y })
                        break
                    end
                end
            end
            -- Adjacent NPC
            for i, npc in ipairs(dungeon.npcs) do
                if not npc.claimed then
                    local dx = math.abs(npc.x - dungeon.playerTileX)
                    local dy = math.abs(npc.y - dungeon.playerTileY)
                    if dx <= 1 and dy <= 1 and (dx + dy) <= 1 then
                        client:emit("dungeon_interact_npc", { npcIndex = i - 1 })
                        break
                    end
                end
            end
            -- Adjacent corpse
            for _, cr in ipairs(dungeon.corpses) do
                if not cr.examined then
                    local dx = math.abs(cr.x - dungeon.playerTileX)
                    local dy = math.abs(cr.y - dungeon.playerTileY)
                    if dx <= 1 and dy <= 1 and (dx + dy) <= 1 then
                        client:emit("dungeon_examine_corpse", { x = cr.x, y = cr.y })
                        break
                    end
                end
            end
            return  -- handled dungeon interaction
        end

        -- Interact with lootable corpse or world container (overworld)
        if not dungeon.inDungeon then
            local me = players[myId]
            if me then
                -- Check nearby corpses
                for _, c in ipairs(zoneCorpses) do
                    local dx = me.x - (c.x or 0)
                    local dy = me.y - (c.y or 0)
                    if dx * dx + dy * dy < 128 * 128 then
                        client:emit("loot_corpse", { corpseId = c.id })
                        return
                    end
                end
                -- Check nearby world containers
                for _, wc in ipairs(zoneWorldContainers) do
                    local dx = me.x - (wc.x or 0)
                    local dy = me.y - (wc.y or 0)
                    if dx * dx + dy * dy < 128 * 128 then
                        client:emit("loot_container", { containerId = wc.id })
                        return
                    end
                end
            end
        end

        -- Interact with zone connection or resource
        if hoverConnection then
            client:emit("zone_enter", {
                zoneId = hoverConnection.targetZone,
                fromZone = zone and zone.id,
            })
        elseif hoverResource and not hoverResource.depleted then
            -- Check skill level before sending
            local myLevel = 1
            local reqSkill = hoverResource.skill or "mining"
            if skills and skills[reqSkill] then
                myLevel = skills[reqSkill].level or 1
            end
            if myLevel >= (hoverResource.minLevel or 1) then
                client:emit("resource_harvest", { resourceId = hoverResource.id })
            end
        elseif overworld.hoverRift then
            -- Mini-rift interaction: enter as dungeon
            local rift = overworld.hoverRift
            if client then
                client:emit("dungeon_enter", { dungeonId = "minirift_" .. rift.riftId })
            end
        elseif overworld.hoverCave then
            -- Cave interaction
            if overworld.hoverCave.hollowEarth or overworld.hoverCave.surfaceExit then
                -- Transition between overworld / hollow earth
                if client then
                    client:emit("cave_enter", {
                        worldX = overworld.hoverCave.worldX,
                        worldY = overworld.hoverCave.worldY,
                        surfaceExit = overworld.hoverCave.surfaceExit or false,
                    })
                end
            else
                -- Non-hollow-earth cave: try entering as dungeon
                if client then
                    client:emit("cave_enter", {
                        worldX = overworld.hoverCave.worldX,
                        worldY = overworld.hoverCave.worldY,
                    })
                end
            end
        elseif hoverObject then
            -- Interact with placed object
            if hoverObject.type == "forge" or hoverObject.type == "advanced_forge" or hoverObject.type == "master_forge" then
                ui.showInventory = true
                ui.inventoryTab = "crafting"
                ui.craftingFilter = "forge"
            elseif hoverObject.type == "iron_anvil" then
                ui.showInventory = true
                ui.inventoryTab = "crafting"
                ui.craftingFilter = "anvil"
            elseif hoverObject.type == "alchemy_table" or hoverObject.type == "advanced_alchemy_table" or hoverObject.type == "master_alchemy_table" then
                ui.showInventory = true
                ui.inventoryTab = "crafting"
                ui.craftingFilter = "alchemy_table"
            elseif hoverObject.type == "loom" or hoverObject.type == "advanced_loom" or hoverObject.type == "master_loom" then
                ui.showInventory = true
                ui.inventoryTab = "crafting"
                ui.craftingFilter = "loom"
            elseif hoverObject.type == "brewery" or hoverObject.type == "advanced_brewery" or hoverObject.type == "master_brewery" then
                ui.showInventory = true
                ui.inventoryTab = "crafting"
                ui.craftingFilter = "brewery"
            elseif hoverObject.type == "enchanting_table" or hoverObject.type == "advanced_enchanting_table" then
                ui.showInventory = true
                ui.inventoryTab = "crafting"
                ui.craftingFilter = "enchanting_table"
            elseif hoverObject.type == "cauldron" then
                ui.showInventory = true
                ui.inventoryTab = "crafting"
                ui.craftingFilter = "cauldron"
            elseif hoverObject.type == "storage_chest" then
                client:emit("interact_object", { objectId = hoverObject.id, action = "open_chest" })
            elseif hoverObject.type == "crop_plot" or hoverObject.type == "garden_bed" then
                -- Crop interaction: plant/water/harvest depending on state
                if hoverObject.crop and hoverObject.crop.stage == 3 then
                    client:emit("harvest_crop", { cropPlotId = hoverObject.id })
                elseif hoverObject.crop and hoverObject.crop.stage < 3 then
                    client:emit("water_crop", { cropPlotId = hoverObject.id })
                else
                    -- No crop planted - open farming panel to plant
                    game.closeAllPanels()
                    ui.showFarming = true
                    ui.farmingTab = "crops"
                    ui.farmingPlotId = hoverObject.id
                    if client then client:emit("check_crops", {}) end
                end
            elseif hoverObject.type == "animal_pen" then
                -- Animal pen: feed or collect
                local hasProducts = false
                if hoverObject.animals then
                    for _, ani in ipairs(hoverObject.animals) do
                        if ani.pendingProducts and #ani.pendingProducts > 0 then
                            hasProducts = true
                            break
                        end
                    end
                end
                if hasProducts then
                    client:emit("animal_collect", { animalPenId = hoverObject.id })
                else
                    client:emit("animal_feed", { animalPenId = hoverObject.id })
                end
            elseif hoverObject.type == "bed" then
                client:emit("furniture_interact", { objectId = hoverObject.id, action = "sleep" })
            end
        end
        -- NPC interactions (town)
        if game._hoverNpc then
            if game._hoverNpc.type == "adventure_guild" then
                client:emit("dungeon_guild_signup", {})
            elseif game._hoverNpc.type == "dungeon_quest_board" then
                client:emit("dungeon_quest_list", {})
            elseif game._hoverNpc.type == "dungeon_leaderboard" then
                client:emit("dungeon_leaderboard", {})
            elseif game._hoverNpc.type == "dungeon_entrance" then
                client:emit("dungeon_enter", { dungeonId = "rift" })
            elseif game._hoverNpc.type == "portal_nexus" then
                game.closeAllPanels()
                game._portal.show = false  -- will be opened by portal_list listener
                game._portal.destinations = {}
                game._portal.scroll = 0
                game._portal.message = nil
                if client then
                    client:emit("portal_list")
                end
            elseif game._hoverNpc.type == "npc_shop" or game._hoverNpc.type == "shopkeeper" then
                game.closeAllPanels()
                game._npcShop.show = true
                game._npcShop.tab = "buy"
                game._npcShop.selected = nil
                game._npcShop.amount = 1
                game._npcShop.scroll = 0
                game._npcShop.prices = nil
                game._npcShop.shopList = nil
                game._npcShop.message = nil
                game._npcShop.transactionLock = false
                -- Use shopId from NPC data if available, otherwise fetch shop list
                local npcShopId = game._hoverNpc.shopId
                if npcShopId then
                    game._npcShop.shopId = npcShopId
                    game._npcShop.shopName = game._hoverNpc.name or "Shop"
                    client:emit("npc_shop_prices", { shopId = npcShopId })
                else
                    -- Default to general, but also fetch shop list for switching
                    game._npcShop.shopId = "general"
                    game._npcShop.shopName = game._hoverNpc.name or "General Store"
                    client:emit("npc_shop_browse", {})
                    client:emit("npc_shop_prices", { shopId = "general" })
                end
            elseif game._hoverNpc.type == "banker" then
                game.closeAllPanels()
                game._bank.show = true
                game._bank.tab = "gold"
                game._bank.selected = nil
                game._bank.amount = 1
                game._bank.scroll = 0
                game._bank.data = nil
                game._bank.transactionLock = false
                if client then
                    client:emit("bank_open", {})
                end
            end
        end
    elseif key == "m" then
        local wasOpen = overworld.chunkBased and ui.showWorldMap or ui.showZoneList
        game.closeAllPanels()
        if overworld.chunkBased then
            ui.showWorldMap = not wasOpen
        else
            ui.showZoneList = not wasOpen
        end
    elseif key == "i" then
        if ui.showGridInventory then
            ui.showGridInventory = false
            game._audio.playInventoryClose()
            return
        end
        game.closeAllPanels()
        ui.showGridInventory = true
        game._audio.playInventoryOpen()
        if client then
            client:emit("grid_sync", {})
        end
    elseif key == "g" then
        -- B1: Equipment panel toggle
        local wasOpen = ui.showEquipment
        game.closeAllPanels()
        ui.showEquipment = not wasOpen
        if ui.showEquipment and client then
            client:emit("get_equipment", {})
            client:emit("get_durability", {})
        end
    elseif key == "c" then
        local wasOpen = ui.showCharSheet
        game.closeAllPanels()
        ui.showCharSheet = not wasOpen
        if ui.showCharSheet and client then
            client:emit("get_rpg_stats", {})
        end
    elseif key == "k" then
        local wasOpen = ui.showCardCollection
        game.closeAllPanels()
        ui.showCardCollection = not wasOpen
        ui.cardTab = "collection"
        ui.selectedCard = nil
        game._fusionMode.active = false
        game._fusionMode.card1 = nil
        if ui.showCardCollection and client then
            client:emit("get_cards", {})
            client:emit("get_card_vendor_catalog", {})
            client:emit("get_card_loadouts", {})
        end
    elseif key == "b" then
        -- Knowledge panel toggle
        local wasOpen = ui.showKnowledge
        game.closeAllPanels()
        ui.showKnowledge = not wasOpen
        knowledge.scrollY = 0
        knowledge.bookContent = nil
        if ui.showKnowledge and client then
            client:emit("knowledge_get", { tab = knowledge.tab })
        end
    elseif key == "f" then
        -- Farming panel toggle
        local wasOpen = ui.showFarming
        game.closeAllPanels()
        ui.showFarming = not wasOpen
        if ui.showFarming and client then
            client:emit("check_crops", {})
        end
    elseif key == "p" then
        -- Plot claim/unclaim toggle
        if client and overworld.chunkBased then
            if overworld.myPlotId then
                if overworld.plotUnclaimPending then
                    overworld.plotUnclaimPending = false
                    client:emit("unclaim_plot", {confirmed = true})
                else
                    client:emit("unclaim_plot", {})
                end
            else
                client:emit("claim_plot", {})
            end
        end
    elseif key == "q" then
        -- Quick exit dungeon
        if dungeon.inDungeon then
            client:emit("dungeon_exit", {})
            dungeon.inDungeon = false
        end
    elseif key == "t" then
        if dungeon.inDungeon and not tcState.inCombat then
            -- Toggle turn-based overworld mode (BG3 style)
            client:emit("dungeon_toggle_turn_mode", {})
        elseif dungeon.inDungeon and not dungeon.hasTorch and not dungeon.hasLantern then
            -- Use torch in dungeon (fallback when in combat)
            client:emit("dungeon_use_torch", {})
        end
    elseif key == "v" then
        -- Toggle vision type in dungeon (cycles through available visions)
        if dungeon.inDungeon and client then
            client:emit("dungeon_toggle_vision", {})
        end
    elseif key == "j" then
        -- Toggle dungeon quests (when in dungeon) OR game._auction house (when in town)
        if dungeon.inDungeon or (zone and zone.id == "starter_town") then
            ui.showDungeonQuests = not ui.showDungeonQuests
            if ui.showDungeonQuests then
                client:emit("dungeon_quest_list", {})
            end
        else
            -- Auction house toggle
            local wasOpen = game._auction.show
            game.closeAllPanels()
            game._auction.show = not wasOpen
            if game._auction.show and client then
                client:emit("mmo_auction_browse", game._auction.filters or {})
            end
        end
    elseif key == "l" then
        -- Toggle leaderboard
        ui.showLeaderboard = not ui.showLeaderboard
        if ui.showLeaderboard then
            client:emit("dungeon_leaderboard", {})
        end
    elseif key == "y" then
        -- Toggle party panel
        local wasOpen = ui.showPartyPanel
        game.closeAllPanels()
        ui.showPartyPanel = not wasOpen
    elseif key == "u" and not chat.active then
        -- Toggle companion panel
        local wasOpen = ui.showCompanions
        game.closeAllPanels()
        ui.showCompanions = not wasOpen
        if ui.showCompanions and client then
            client:emit("companion_list", {})
        end
    elseif key == "o" and not chat.active then
        -- Toggle pet panel
        local wasOpen = ui.showPets
        game.closeAllPanels()
        ui.showPets = not wasOpen
        if ui.showPets and client then
            client:emit("pet_list", {})
        end
    elseif key == "]" and not chat.active then
        -- Toggle guild panel
        local wasOpen = ui.showGuild
        game.closeAllPanels()
        ui.showGuild = not wasOpen
        if ui.showGuild and client then
            if game._guild.guildId then
                client:emit("guild_vault_browse", {})
            else
                client:emit("guild_list", {})
            end
        end
    elseif key == "j" and not chat.active then
        -- Toggle quest log
        local wasOpen = ui.showQuestLog
        game.closeAllPanels()
        ui.showQuestLog = not wasOpen
        if ui.showQuestLog and client then
            client:emit("quest_list", {})
        end
    elseif key == ";" and not chat.active then
        -- Toggle ascension panel
        local wasOpen = ui.showAscension
        game.closeAllPanels()
        ui.showAscension = not wasOpen
        if ui.showAscension and client then
            client:emit("ascension_status", {})
        end
    elseif key == "/" and not chat.active then
        -- Toggle faction rep panel
        game._karma.showFactions = not game._karma.showFactions
        if game._karma.showFactions and client then
            client:emit("faction_status", {})
            client:emit("faction_list", {})
        end
    elseif key == "f4" and not chat.active then
        -- Toggle VIP & Sovereign panel
        local wasOpen = ui.showVip
        game.closeAllPanels()
        ui.showVip = not wasOpen
        if ui.showVip and client then
            client:emit("vip_status", {})
            client:emit("vip_sovereign_shop", {})
        end
    elseif key == "f5" and not chat.active then
        -- Toggle bounties panel
        game._karma.showBounties = not game._karma.showBounties
    elseif key == "f6" and not chat.active then
        -- Toggle rumors log panel
        local wasOpen = ui.showRumors
        game.closeAllPanels()
        ui.showRumors = not wasOpen
    elseif key == "f7" and not chat.active then
        -- Toggle environment panel (weather + ecology)
        local wasOpen = ui.showEnvironment
        game.closeAllPanels()
        ui.showEnvironment = not wasOpen
    elseif key == "f9" and not chat.active then
        -- Toggle audio settings panel
        local wasOpen = ui.showAudioSettings
        game.closeAllPanels()
        ui.showAudioSettings = not wasOpen
    elseif key == "f10" then
        -- Toggle game._admin panel (server hosts only)
        if _G.isServerHost then
            game._admin.showPanel = not game._admin.showPanel
        end
    elseif key == "f11" and not chat.active then
        -- Toggle sync panel (cross-server character sync)
        local wasOpen = game._sync.show
        game.closeAllPanels()
        game._sync.show = not wasOpen
        game._sync.confirm = false
        game._sync.status = nil
        game._sync.error = nil
    elseif key == "escape" then
        if ui.showKnowledge then
            if knowledge.bookContent then
                knowledge.bookContent = nil
                knowledge.scrollY = 0
            else
                ui.showKnowledge = false
            end
        elseif game._sync.show then
            game._sync.show = false
            game._sync.confirm = false
            game._sync.status = nil
        elseif game._admin.showPanel then
            game._admin.showPanel = false
        elseif ui.showDungeonQuests then
            ui.showDungeonQuests = false
        elseif ui.showLeaderboard then
            ui.showLeaderboard = false
        elseif ui.placementMode then
            ui.placementMode = false
            ui.placementType = nil
            ui.placementItemId = nil
        elseif ui.showQuestLog then
            ui.showQuestLog = false
        elseif ui.showCompanions then
            ui.showCompanions = false
        elseif ui.showPets then
            ui.showPets = false
        elseif ui.showGuild then
            ui.showGuild = false
        elseif ui.showAscension then
            ui.showAscension = false
        elseif ui.showJail then
            -- Can't close jail if still jailed
            if not game._jail.inJail then ui.showJail = false end
        elseif game._karma.showFactions then
            game._karma.showFactions = false
        elseif game._karma.showBounties then
            game._karma.showBounties = false
        elseif ui.showVip then
            ui.showVip = false
        elseif ui.showRumors then
            ui.showRumors = false
        elseif ui.showEnvironment then
            ui.showEnvironment = false
        elseif game._minigame.active then
            -- Can't escape minigame — must click or timeout
        else
            -- Go to character select (switch characters) instead of disconnecting
            _G.switchScene("character_select")
        end
    end
end

local function textinput(text)
    local client = getClient()
    -- Trade coin input takes priority when active
    if game._trade.show and game._trade.coinInputActive then
        -- Only accept digits
        if text:match("^%d$") and #game._trade.coinInput < 10 then
            game._trade.coinInput = game._trade.coinInput .. text
        end
        return
    end
    -- Guild chat/create input
    if ui.showGuild then
        if game._guild.chatActive then
            if #game._guild.chatInput < 200 then
                game._guild.chatInput = game._guild.chatInput .. text
            end
            return
        elseif game._guild.createActive then
            if #game._guild.createName < 30 then
                game._guild.createName = game._guild.createName .. text
            end
            return
        end
    end
    -- Auction inputs
    if game._auction.show then
        if game._auction.searchActive then
            if #game._auction.filters.search < 50 then
                game._auction.filters.search = game._auction.filters.search .. text
            end
            return
        elseif game._auction.priceActive then
            if text:match("^%d$") and #game._auction.sellPrice < 10 then
                game._auction.sellPrice = game._auction.sellPrice .. text
            end
            return
        end
    end
    if chat.active then
        if #chat.input < 200 then
            chat.input = chat.input .. text
        end
    elseif game._raid.partyInviteActive then
        if #game._raid.partyInviteInput < 30 then
            game._raid.partyInviteInput = game._raid.partyInviteInput .. text
        end
    end
end

local function mousepressed(x, y, button)
    local zone               = getZone()
    local myId               = getMyId()
    local client             = getClient()
    local corpseLootPanel    = getCorpseLootPanel()
    local containerLootPanel = getContainerLootPanel()
    local packReveal         = getPackReveal()
    local equipSlotButtons      = getEquipSlotButtons()
    local inventoryItemButtons  = getInventoryItemButtons()
    local craftingButtons       = getCraftingButtons()
    -- Grid inventory intercept
    if ui.showGridInventory then
        if gridInv.mousepressed(x, y, button) then return end
    end

    -- Crafting minigame click
    if game._minigame.active and not game._minigame.result and button == 1 then
        local clickPos = math.floor(game._minigame.barPos)
        if clickPos >= game._minigame.windowStart and clickPos <= game._minigame.windowEnd then
            local mid = (game._minigame.windowStart + game._minigame.windowEnd) / 2
            local dist = math.abs(clickPos - mid)
            local range = (game._minigame.windowEnd - game._minigame.windowStart) / 2
            game._minigame.result = dist < range * 0.3 and "perfect" or "good"
        else
            game._minigame.result = "miss"
        end
        game._minigame.resultTimer = 1.5
        if client then client:emit("craft_minigame_result", { clickPos = clickPos }) end
        return
    end

    -- Sync panel clicks
    if game._sync.show and button == 1 then
        local panelW = 320
        local panelH = game._sync.confirm and 220 or 200
        local px = (love.graphics.getWidth() - panelW) / 2
        local py = (love.graphics.getHeight() - panelH) / 2
        local btnW = 130
        local btnH = 32

        if game._sync.confirm then
            -- Confirmation dialog buttons
            local yesX = px + panelW / 2 - btnW - 10
            local noX = px + panelW / 2 + 10
            local confirmY = py + panelH - 50
            if x >= yesX and x <= yesX + btnW and y >= confirmY and y <= confirmY + btnH then
                -- Yes: read snapshot and send to server
                game._sync.status = "loading"
                local snapData = love.filesystem.read("account_snapshot.dat")
                if snapData and #snapData > 2 and client then
                    client:emit("sync_import", snapData)
                else
                    game._sync.status = "error"
                    game._sync.error = "No saved snapshot found"
                    game._sync.statusTimer = 3
                end
                game._sync.confirm = false
                return
            elseif x >= noX and x <= noX + btnW and y >= confirmY and y <= confirmY + btnH then
                game._sync.confirm = false
                return
            end
        else
            -- Save button
            local saveX = px + panelW / 2 - btnW - 10
            local loadX = px + panelW / 2 + 10
            local btnY = py + 100
            if x >= saveX and x <= saveX + btnW and y >= btnY and y <= btnY + btnH then
                -- Save: request fresh snapshot from server
                if client then
                    game._sync.status = "saving"
                    client:emit("snapshot_request")
                end
                return
            elseif x >= loadX and x <= loadX + btnW and y >= btnY and y <= btnY + btnH then
                -- Load: open confirmation dialog
                game._sync.confirm = true
                return
            end
        end
        return
    end

    -- Companion panel clicks
    if ui.showCompanions and button == 1 then
        local panelW = 400
        local panelH = 420
        local px = (love.graphics.getWidth() - panelW) / 2
        local py = (love.graphics.getHeight() - panelH) / 2

        -- Hire buttons
        local COMP_CLASSES = {"warrior", "ranger", "mage", "healer", "thief", "bard"}
        local cy = py + 54
        for i, cls in ipairs(COMP_CLASSES) do
            local bx = px + 12 + (i - 1) * 62
            if x >= bx and x <= bx + 58 and y >= cy and y <= cy + 20 then
                if client then client:emit("companion_hire", { companionClass = cls }) end
                return
            end
        end
        cy = cy + 34
        -- Dismiss buttons
        for _, c in ipairs(game._companions.companions) do
            local dBx = px + panelW - 70
            if x >= dBx and x <= dBx + 50 and y >= cy + 20 and y <= cy + 38 then
                if client then client:emit("companion_dismiss", { companionId = c.id }) end
                return
            end
            cy = cy + 50
        end
    end

    -- Pet panel clicks
    if ui.showPets and button == 1 then
        local panelW = 400
        local panelH = 420
        local px = (love.graphics.getWidth() - panelW) / 2
        local py = (love.graphics.getHeight() - panelH) / 2
        local cy = py + 36
        for _, p in ipairs(game._pets.pets) do
            local feedX = px + panelW - 120
            if x >= feedX and x <= feedX + 50 and y >= cy + 4 and y <= cy + 22 then
                if client then client:emit("pet_feed", { petId = p.id }) end
                return
            end
            local actX = px + panelW - 60
            if x >= actX and x <= actX + 46 and y >= cy + 4 and y <= cy + 22 then
                local newId = (game._pets.activePetId == p.id) and nil or p.id
                if client then client:emit("pet_set_active", { petId = newId }) end
                return
            end
            cy = cy + 62
        end
    end

    -- Jail panel clicks
    if ui.showJail and game._jail.inJail and button == 1 then
        local panelW = 340
        local panelH = 260
        local px = (love.graphics.getWidth() - panelW) / 2
        local py = (love.graphics.getHeight() - panelH) / 2
        local bailX = px + panelW / 2 - 80
        local bailY = py + 120
        if x >= bailX and x <= bailX + 160 and y >= bailY and y <= bailY + 36 then
            if client then client:emit("jail_bail", {}) end
            return
        end
        local serveY = bailY + 48
        if x >= bailX and x <= bailX + 160 and y >= serveY and y <= serveY + 36 then
            if client then client:emit("jail_serve_time", {}) end
            return
        end
    end

    -- Audio settings panel clicks
    if ui.showAudioSettings and button == 1 then
        local panelW = 360
        local panelH = 400
        local px = (love.graphics.getWidth() - panelW) / 2
        local py = (love.graphics.getHeight() - panelH) / 2
        local categories = {"master", "music", "sfx", "ambient", "ui", "footsteps"}
        local sliderX = px + 130
        local sliderW = panelW - 160
        local cy = py + 52
        for _, cat in ipairs(categories) do
            if y >= cy and y <= cy + 22 then
                local t = (x - sliderX) / sliderW
                if t >= -0.02 and t <= 1.02 then
                    t = math.max(0, math.min(1, t))
                    game._audio.setVolume(cat, t)
                    game._audioSliderDrag = cat
                    return
                end
            end
            cy = cy + 34
        end
        -- Lighting quality buttons
        if game._settingsQualBtns then
            for _, btn in ipairs(game._settingsQualBtns) do
                if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                    lighting.setQuality(btn.quality)
                    return
                end
            end
        end
        -- Close button
        local closeY = py + panelH - 42
        local closeX = px + panelW / 2 - 50
        if x >= closeX and x <= closeX + 100 and y >= closeY and y <= closeY + 30 then
            ui.showAudioSettings = false
            return
        end
    end

    -- Ascension panel clicks
    if ui.showAscension and button == 1 then
        local panelW = 500
        local panelH = 450
        local px = (love.graphics.getWidth() - panelW) / 2
        local py = (love.graphics.getHeight() - panelH) / 2

        -- Ascend button
        if game._ascension.canAscend then
            local bx = px + panelW / 2 - 60
            local by = py + 54
            if x >= bx and x <= bx + 120 and y >= by and y <= by + 28 then
                if client then client:emit("ascension_confirm", {}) end
                return
            end
        end

        -- Tree node clicks
        local cy = py + 90
        if game._ascension.tree then
            for nodeId, nodeData in pairs(game._ascension.tree) do
                if cy + 38 > py + panelH - 30 then break end
                local nx = px + 12
                local nw = panelW - 24
                if x >= nx and x <= nx + nw and y >= cy and y <= cy + 34 then
                    local rank = (game._ascension.ascensionTree and game._ascension.ascensionTree[nodeId]) or 0
                    local maxRank = nodeData.maxRank or 3
                    local cost = nodeData.cost or 1
                    if rank < maxRank and (game._ascension.ascensionPoints or 0) >= cost then
                        if client then client:emit("ascension_spend_ap", { nodeId = nodeId }) end
                    end
                    return
                end
                cy = cy + 38
            end
        end
    end

    -- Guild panel clicks
    if ui.showGuild and button == 1 then
        local panelW = 500
        local panelH = 460
        local px = (love.graphics.getWidth() - panelW) / 2
        local py = (love.graphics.getHeight() - panelH) / 2

        -- Tab clicks
        local tabs
        if game._guild.guildId then
            tabs = {"info", "members", "chat", "vault"}
        else
            tabs = {"browse", "create"}
        end
        local tabW = 70
        local tabStartX = px + 10
        local tabY = py + 34
        for i, tab in ipairs(tabs) do
            local tx = tabStartX + (i - 1) * (tabW + 4)
            if x >= tx and x <= tx + tabW and y >= tabY and y <= tabY + 22 then
                game._guild.tab = tab
                if tab == "vault" and client then client:emit("guild_vault_browse", {}) end
                if tab == "browse" and client then client:emit("guild_list", {}) end
                return
            end
        end

        local contentY = tabY + 28

        -- Browse: join guild
        if game._guild.tab == "browse" then
            local cy = contentY
            for _, g in ipairs(game._guild.guildList) do
                if x >= px + 10 and x <= px + panelW - 10 and y >= cy and y <= cy + 32 then
                    if client then client:emit("guild_join", { guildId = g.id }) end
                    return
                end
                cy = cy + 36
            end
        end

        -- Create: activate name input + create button
        if game._guild.tab == "create" then
            if x >= px + 20 and x <= px + panelW - 20 and y >= contentY + 28 and y <= contentY + 52 then
                game._guild.createActive = true
                game._guild.chatActive = false
                return
            end
            local createBx = px + panelW / 2 - 50
            local createBy = contentY + 70
            if x >= createBx and x <= createBx + 100 and y >= createBy and y <= createBy + 28 then
                if client and #game._guild.createName > 0 then
                    client:emit("guild_create", { name = game._guild.createName })
                end
                return
            end
        end

        -- Chat: activate input
        if game._guild.tab == "chat" then
            local contentH = panelH - (contentY - py) - 24
            local inputY = contentY + contentH - 24
            if x >= px + 14 and x <= px + panelW - 14 and y >= inputY and y <= inputY + 22 then
                game._guild.chatActive = true
                game._guild.createActive = false
                return
            end
        end

        -- Leave button (info/members tab)
        if game._guild.tab == "info" or game._guild.tab == "members" then
            local lx = px + panelW - 80
            local ly = py + panelH - 40
            if x >= lx and x <= lx + 60 and y >= ly and y <= ly + 22 then
                if client then client:emit("guild_leave", {}) end
                return
            end
        end
    end

    -- VIP panel clicks
    if ui.showVip and button == 1 then
        local W = love.graphics.getWidth()
        local H = love.graphics.getHeight()
        local panelW = 560
        local panelH = 520
        local px = (W - panelW) / 2
        local py = (H - panelH) / 2

        -- Tab switching
        local tabY = py + 38
        if y >= tabY and y <= tabY + 24 then
            if x >= px + 16 and x <= px + 126 then
                game._vip.tab = "status"
                return
            elseif x >= px + 132 and x <= px + 302 then
                game._vip.tab = "shop"
                if client then client:emit("vip_sovereign_shop", {}) end
                return
            end
        end

        local contentY = tabY + 34
        local isVip = (game._vip.tier == "vip")

        if game._vip.tab == "status" then
            -- Use VIP Token button (only visible when tokenInventory > 0 and not VIP)
            if (game._vip.tokenInventory or 0) > 0 and not isVip then
                -- Button is at py2 + 18 where py2 = contentY + 72 + 6*16 = contentY + 168
                local bx = px + panelW / 2 - 80
                local by = contentY + 168 + 18
                if x >= bx and x <= bx + 160 and y >= by and y <= by + 32 then
                    if client then client:emit("vip_consume_token", {}) end
                    return
                end
            end
        else
            -- Shop category filter tabs
            local nCats = 5
            local catW  = math.floor((panelW - 32) / nCats)
            local SHOP_CATS = { "all", "storage", "character", "cosmetic", "convenience" }
            for ci, cat in ipairs(SHOP_CATS) do
                local cx = px + 16 + (ci - 1) * catW
                if x >= cx and x <= cx + catW - 2 and y >= contentY and y <= contentY + 22 then
                    game._vip.shopCategoryFilter = cat
                    game._vip.shopScroll = 0
                    return
                end
            end

            -- Buy buttons (rects stored during draw)
            if game._vip._shopBuyBtns then
                for _, btn in ipairs(game._vip._shopBuyBtns) do
                    if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                        if client then client:emit("vip_sovereign_purchase", { itemId = btn.itemId }) end
                        return
                    end
                end
            end
        end
    end

    -- Loot panel click handling (corpse/container)
    if (corpseLootPanel or containerLootPanel) and button == 1 and game._lootPanelRect then
        local r = game._lootPanelRect
        if x >= r.x and x <= r.x + r.w and y >= r.y and y <= r.y + r.h then
            -- Take All button
            if y >= r.btnY and y <= r.btnY + 26 and x >= r.x + 10 and x <= r.x + 110 then
                if corpseLootPanel then
                    client:emit("take_all_corpse", { corpseId = corpseLootPanel.corpseId })
                elseif containerLootPanel then
                    client:emit("take_all_container", { containerId = containerLootPanel.containerId })
                end
                return
            end
            -- Close button
            if y >= r.btnY and y <= r.btnY + 26 and x >= r.x + r.w - 110 and x <= r.x + r.w - 10 then
                setCorpseLootPanel(nil)
                setContainerLootPanel(nil)
                return
            end
            -- Click on individual item (take it)
            local itemStartY = r.y + 32
            if corpseLootPanel and corpseLootPanel.gold and corpseLootPanel.gold > 0 then
                itemStartY = itemStartY + 18
            end
            local panel = corpseLootPanel or containerLootPanel
            if panel and panel.resources then
                for _ in pairs(panel.resources) do
                    itemStartY = itemStartY + 16
                end
            end
            itemStartY = itemStartY + 10 -- separator
            if panel and panel.items then
                for idx, _ in ipairs(panel.items) do
                    if y >= itemStartY and y <= itemStartY + 16 then
                        if corpseLootPanel then
                            client:emit("take_corpse_item", { corpseId = corpseLootPanel.corpseId, itemIndex = idx - 1 })
                        elseif containerLootPanel then
                            client:emit("take_container_item", { containerId = containerLootPanel.containerId, itemIndex = idx - 1 })
                        end
                        return
                    end
                    itemStartY = itemStartY + 16
                end
            end
            return
        end
    end

    -- NPC Dialogue click handling
    if game._npcDialogue.show and button == 1 then
        local dlg    = game._npcDialogue
        local W      = love.graphics.getWidth()
        local H      = love.graphics.getHeight()
        local topics      = (not dlg.topicMode) and dlg.availableTopics or nil
        local topicCount  = topics and #topics or 0
        local qOffers   = dlg.questOffers  or {}
        local qTurnins  = dlg.questTurnins or {}
        local questCount = #qOffers + #qTurnins
        local panelW = math.min(640, W - 40)
        local baseH  = 210
        local topicH = topicCount > 0 and (20 + topicCount * 22) or 0
        local questH = questCount  > 0 and (26 + questCount  * 26) or 0
        local panelH = baseH + topicH + questH
        local panelX = (W - panelW) / 2
        local panelY = H - panelH - 20

        -- Dialogue tree choices
        local choiceY = panelY + 120
        for i, choice in ipairs(dlg.choices) do
            local choiceX = panelX + 24
            local choiceW = panelW - 48
            local choiceH = 22
            if x >= choiceX and x <= choiceX + choiceW and y >= choiceY and y <= choiceY + choiceH then
                client:emit("npc_dialogue_choice", { choiceIndex = choice.index })
                return
            end
            choiceY = choiceY + 24
        end

        -- Topic buttons
        if topicCount > 0 then
            local sepY   = panelY + baseH - 16
            local topicY = sepY + 20
            for ti, topic in ipairs(topics) do
                local tx = panelX + 24
                local tw = panelW - 48
                local th = 20
                if x >= tx and x <= tx + tw and y >= topicY and y <= topicY + th then
                    client:emit("npc_ask_topic", { npcId = dlg.npcId, topicId = topic.id })
                    return
                end
                topicY = topicY + 22
            end
        end

        -- Quest offer / turn-in buttons
        if questCount > 0 then
            local qSepY  = choiceY + 2
            local questY = qSepY + 22
            -- Turn-ins first (order must match drawDialoguePanel)
            for _, qt in ipairs(qTurnins) do
                local cx2 = panelX + 24
                local cw2 = panelW - 48
                if x >= cx2 and x <= cx2 + cw2 and y >= questY and y <= questY + 22 then
                    client:emit("quest_turnin", { questId = qt.questId })
                    return
                end
                questY = questY + 26
            end
            for _, qo in ipairs(qOffers) do
                local cx2 = panelX + 24
                local cw2 = panelW - 48
                if x >= cx2 and x <= cx2 + cw2 and y >= questY and y <= questY + 22 then
                    client:emit("quest_accept", { questId = qo.questId, npcId = dlg.questNpcId })
                    return
                end
                questY = questY + 26
            end
        end

        -- Topic-mode Back button (Esc also handled in keypressed)
        if dlg.topicMode then
            local bx = panelX + 24
            local by = panelY + panelH - 30
            local bw = 90
            local bh = 22
            if x >= bx - 4 and x <= bx + bw + 4 and y >= by - 2 and y <= by + bh + 4 then
                dlg.topicMode = false
                return
            end
        end

        -- Click outside panel closes dialogue
        if x < panelX or x > panelX + panelW or y < panelY or y > panelY + panelH then
            game._npcDialogue.show = false
        end
        return
    end

    -- Pack reveal click handling (highest priority when active)
    if packReveal and button == 1 then
        if packReveal.done then
            -- Close the reveal
            setPackReveal(nil)
        elseif packReveal.phase == "show" then
            -- Advance to next card
            game.packRevealAdvance()
        elseif packReveal.phase == "flip" then
            -- Skip flip animation - jump to show
            packReveal.flipProgress = 1
            packReveal.phase = "show"
            packReveal.timer = 0
        end
        return
    end

    -- Trade panel click handling (highest priority when game._trade is open)
    if game._trade.show and button == 1 then
        if game.handleTradeClick(x, y) then
            return
        end
    end

    -- Trade pending request popup click handling
    if game._trade.pendingRequest and button == 1 then
        if game.handleTradeRequestClick(x, y) then
            return
        end
    end

    -- Portal panel click handling (highest priority when open)
    if game._portal.show and button == 1 then
        if game.handlePortalClick(x, y) then
            return
        end
    end

    -- NPC Shop click handling (highest priority when shop is open)
    if game._npcShop.show and button == 1 then
        if game.handleNpcShopClick(x, y) then
            return
        end
    end

    -- Bank vault click handling
    if game._bank.show and button == 1 then
        if game.handleBankClick(x, y) then
            return
        end
    end

    -- Admin panel click handling (highest priority when open)
    if game._admin.showPanel and button == 1 then
        if game.handleAdminPanelClick(x, y) then
            return
        end
    end

    -- Knowledge panel click handling
    if ui.showKnowledge then
        if game.handleKnowledgeClick(x, y, button) then
            return
        end
    end

    -- Farming panel click handling
    if ui.showFarming and button == 1 then
        if game.handleFarmingClick(x, y) then
            return
        end
    end

    -- Context menu: handle left-click on items or dismiss
    if ui.contextMenu then
        if button == 1 then
            local ctx = ui.contextMenu
            local ctxItems = ctx.items or CONTEXT_MENU_ITEMS_BASE
            if ctx.hoverIndex and ctx.hoverIndex >= 1 and ctx.hoverIndex <= #ctxItems then
                local item = ctxItems[ctx.hoverIndex]
                worldDrawModule.executeContextMenuAction(item.action, ctx.targetId, ctx.targetName)
            end
            -- Always close the menu on left-click (whether we hit an item or not)
            ui.contextMenu = nil
            return
        elseif button == 2 then
            -- Right-click also closes the menu (and might re-open on a different target below)
            ui.contextMenu = nil
            -- Fall through so the right-click-on-player check below can open a new menu
        end
    end

    -- Character sheet: stat allocation [+] buttons
    if ui.showCharSheet and button == 1 and #cardsDrawModule.getStatAllocButtons() > 0 then
        for _, btn in ipairs(cardsDrawModule.getStatAllocButtons()) do
            if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                if client then
                    client:emit("stat_allocate", { stat = btn.key })
                end
                return
            end
        end
    end

    -- Combat click routing
    if tcState.inCombat and button == 1 then
        if combatAnim.isPlaying() then return end
        local action = combatUI.handleClick(x, y, camera.x, camera.y)
        if action then
            if action.type == "move" or action.type == "attack" or action.type == "ability" then
                if tcState.combatMyTurn and client then
                    client:emit("tc_combat_action", {
                        combatId = tcState.combatId,
                        action = action.type,
                        data = action.data or {},
                    })
                    -- For move/attack, keep turn until server confirms end
                end
            elseif action.type == "wait" or action.type == "end_turn" then
                if tcState.combatMyTurn and client then
                    client:emit("tc_combat_action", {
                        combatId = tcState.combatId,
                        action = action.type,
                        data = {},
                    })
                    tcState.combatMyTurn = false
                    combatUI.setMyTurn(false, nil)
                end
            elseif action.type == "reaction" then
                if client then
                    client:emit("tc_combat_react", {
                        combatId = tcState.combatId,
                        reaction = action.data.choice,
                    })
                    combatUI.clearReactionPrompt()
                end
            end
        end
        return
    end

    -- Vision bar click (dungeon HUD, top-right)
    if dungeon.inDungeon and dungeonDrawModule.handleVisionBarClick(x, y, button, client) then
        return
    end

    -- Left-click attack in dungeon (exploration mode — triggers turn combat)
    if button == 1 and dungeon.inDungeon and dungeon.enemies and not tcState.inCombat then
        for i, enemy in ipairs(dungeon.enemies) do
            if enemy.alive ~= false then
                local dx = math.abs(enemy.x - dungeon.playerTileX)
                local dy = math.abs(enemy.y - dungeon.playerTileY)
                if dx <= 1 and dy <= 1 then
                    client:emit("dungeon_attack", { enemyIndex = i - 1 })
                    return
                end
            end
        end
    end

    -- Right-click on another player: open context menu
    if button == 2 and not ui.placementMode then
        local targetPlayer, targetId = worldDrawModule.getOtherPlayerAtScreen(x, y)
        if targetPlayer and targetId then
            ui.contextMenu = {
                x = x,
                y = y,
                targetId = targetId,
                targetName = targetPlayer.name or "Unknown",
                hoverIndex = nil,
                items = dungeonDrawModule.getContextMenuItems(targetId),
            }
            return
        end
    end

    -- Open card pack (when card collection is visible and packs are available)
    if ui.showCardCollection and button == 1 and rpg.pendingPacks and rpg.pendingPacks > 0 then
        local pw = math.min(750, love.graphics.getWidth() - 40)
        local px = (love.graphics.getWidth() - pw) / 2
        local py = (love.graphics.getHeight() - math.min(560, love.graphics.getHeight() - 60)) / 2
        -- Check if clicking the "Pack Available" area
        if y >= py + 30 and y <= py + 48 then
            if client then client:emit("card_open_pack", {}) end
            return
        end
    end

    -- Card collection click handling
    if ui.showCardCollection and button == 1 then
        -- Card detail view buttons (highest priority when open)
        if ui.selectedCard and ui._cardDetailBtns then
            for _, btn in ipairs(ui._cardDetailBtns) do
                if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                    if btn.id == "close" then
                        ui.selectedCard = nil
                    elseif btn.id == "equip" then
                        local emptySlot = getFirstEmptySlot()
                        if emptySlot and client then
                            client:emit("card_equip", { cardInstanceId = ui.selectedCard.instanceId, slotIndex = emptySlot - 1 })
                            ui.selectedCard = nil
                        end
                    elseif btn.id == "unequip" then
                        local slot = getCardEquipSlot(ui.selectedCard)
                        if slot and client then
                            client:emit("card_unequip", { slotIndex = slot - 1 })
                            ui.selectedCard = nil
                        end
                    elseif btn.id == "fuse" then
                        game._fusionMode.active = true
                        game._fusionMode.card1 = ui.selectedCard
                        ui.selectedCard = nil
                    elseif btn.id == "sell" then
                        if client then
                            client:emit("card_vendor_sell", { cardInstanceId = ui.selectedCard.instanceId })
                            ui.selectedCard = nil
                        end
                    elseif btn.id == "game._auction" then
                        -- Switch to game._auction sell tab with this card pre-selected
                        game._auction.sellCard = ui.selectedCard
                        game._auction.sellPrice = ""
                        game._auction.priceActive = true
                        ui.selectedCard = nil
                        ui.showCardCollection = false
                        game._auction.show = true
                        game._auction.tab = "sell"
                        if client then client:emit("mmo_auction_browse", {}) end
                    end
                    return
                end
            end
            -- Click outside detail view closes it
            ui.selectedCard = nil
            return
        end

        -- Tab buttons (Collection / Vendor / Loadouts)
        if ui._cardTabBtns then
            for _, btn in ipairs(ui._cardTabBtns) do
                if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                    ui.cardTab = btn.tab
                    ui.cardScrollY = 0
                    game._cardVendor.scroll = 0
                    game._cardVendor.filterArch = "all"
                    game._cardVendor.filterType = "all"
                    return
                end
            end
        end

        -- Collection tab specific clicks
        if ui.cardTab == "collection" then
            -- Filter buttons
            if ui._filterBtns then
                for _, btn in ipairs(ui._filterBtns) do
                    if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        ui.cardFilter = btn.filter
                        ui.cardScrollY = 0
                        return
                    end
                end
            end

            -- Sort buttons
            if ui._sortBtns then
                for _, btn in ipairs(ui._sortBtns) do
                    if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        ui.cardSort = btn.sort
                        return
                    end
                end
            end

            -- Card grid clicks
            for i, rect in pairs(cardsDrawModule.getCardGridRects()) do
                if rect and x >= rect.x and x < rect.x + rect.w and y >= rect.y and y < rect.y + rect.h then
                    local card = cardsDrawModule.getCardGridCards()[i]
                    if card then
                        if game._fusionMode.active and game._fusionMode.card1 then
                            -- Fusion mode: select second card
                            if card.rarity == game._fusionMode.card1.rarity and
                               card.instanceId ~= game._fusionMode.card1.instanceId and
                               not cardsDrawModule.getCardEquipSlot(card) then
                                if client then
                                    client:emit("card_fuse", {
                                        card1Id = game._fusionMode.card1.instanceId,
                                        card2Id = card.instanceId,
                                    })
                                end
                                game._fusionMode.active = false
                                game._fusionMode.card1 = nil
                            end
                        else
                            -- Normal click: open detail view
                            ui.selectedCard = card
                        end
                        return
                    end
                end
            end
        elseif ui.cardTab == "vendor" then
            -- Vendor sub-tab clicks
            if ui._vendorSubTabs then
                for _, btn in ipairs(ui._vendorSubTabs) do
                    if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        game._cardVendor.tab = btn.tab
                        game._cardVendor.scroll = 0
                        return
                    end
                end
            end

            -- Type filter clicks (All/Active/Passive/Stats)
            if ui._vendorTypeFilters then
                for _, btn in ipairs(ui._vendorTypeFilters) do
                    if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        game._cardVendor.filterType = btn.filter
                        game._cardVendor.scroll = 0
                        return
                    end
                end
            end

            -- Archetype filter clicks
            if ui._vendorArchFilters then
                for _, btn in ipairs(ui._vendorArchFilters) do
                    if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        game._cardVendor.filterArch = btn.filter
                        game._cardVendor.scroll = 0
                        return
                    end
                end
            end

            -- Vendor item buttons (buy/sell)
            if ui._vendorItemBtns then
                for _, btn in pairs(ui._vendorItemBtns) do
                    if btn and x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        if btn.action == "buy" and btn.cardId and client then
                            client:emit("card_vendor_buy", { cardId = btn.cardId })
                        elseif btn.action == "sell" and btn.cardInstanceId and client then
                            client:emit("card_vendor_sell", { cardInstanceId = btn.cardInstanceId })
                        end
                        return
                    end
                end
            end
        elseif ui.cardTab == "loadouts" then
            -- Loadout buttons
            if ui._loadoutBtns then
                for _, btn in ipairs(ui._loadoutBtns) do
                    if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        if btn.action == "save" and client then
                            client:emit("card_save_loadout", { slotIndex = btn.slotIndex, name = "Loadout " .. (btn.slotIndex + 1) })
                        elseif btn.action == "load" and client then
                            client:emit("card_load_loadout", { slotIndex = btn.slotIndex })
                        end
                        return
                    end
                end
            end
        end
        return
    end

    -- Character sheet slot clicks
    if ui.showCharSheet and button == 1 and ui._charSheetSlots then
        for i, slot in pairs(ui._charSheetSlots) do
            if slot and x >= slot.x and x < slot.x + slot.w and y >= slot.y and y < slot.y + slot.h then
                local card = findCardByInstanceId(slot.instanceId)
                if card then
                    ui.selectedCard = card
                    -- Switch to card collection to show the detail view
                    ui.showCharSheet = false
                    ui.showCardCollection = true
                    ui.cardTab = "collection"
                end
                return
            end
        end
    end

    -- Mastery [M] buttons in character sheet
    if ui.showCharSheet and button == 1 and ui._masteryButtons then
        for _, btn in ipairs(ui._masteryButtons) do
            if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                game.closeAllPanels()
                ui.showMastery = true
                mastery.skillName = btn.skill
                mastery.tree = nil
                mastery.invested = {}
                mastery.points = 0
                mastery.hoverNode = nil
                if client then
                    client:emit("mastery_tree_status", { skillName = btn.skill })
                end
                return
            end
        end
    end

    -- Mastery tree panel clicks
    if ui.showMastery and button == 1 then
        -- Reset button
        if ui._masteryResetBtn then
            local btn = ui._masteryResetBtn
            if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                if client and mastery.skillName then
                    client:emit("mastery_reset_tree", { skillName = mastery.skillName })
                end
                return
            end
        end
        -- Node clicks
        if ui._masteryNodeHitboxes then
            for _, hit in ipairs(ui._masteryNodeHitboxes) do
                if (x - hit.x)^2 + (y - hit.y)^2 < hit.r^2 then
                    if client and mastery.skillName then
                        client:emit("mastery_invest_point", { skillName = mastery.skillName, nodeId = hit.node.id })
                    end
                    return
                end
            end
        end
    end

    -- Auction house click handling
    if game._auction.show and button == 1 then
        -- Close button
        if game._auction._closeBtn then
            local btn = game._auction._closeBtn
            if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                game._auction.show = false
                return
            end
        end

        -- Tab buttons
        if game._auction._tabBtns then
            for _, btn in ipairs(game._auction._tabBtns) do
                if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                    game._auction.tab = btn.tab
                    game._auction.scroll = 0
                    if btn.tab == "browse" and client then
                        client:emit("mmo_auction_browse", {
                            search = game._auction.filters.search,
                            rarity = game._auction.filters.rarity,
                        })
                    elseif btn.tab == "my_listings" and client then
                        client:emit("mmo_auction_my_listings", {})
                    end
                    return
                end
            end
        end

        if game._auction.tab == "browse" then
            -- Search bar click
            if game._auction._searchBar then
                local sb = game._auction._searchBar
                game._auction.searchActive = x >= sb.x and x < sb.x + sb.w and y >= sb.y and y < sb.y + sb.h
                game._auction.priceActive = false
            end

            -- Search button
            if game._auction._searchBtn then
                local btn = game._auction._searchBtn
                if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                    if client then
                        client:emit("mmo_auction_browse", {
                            search = game._auction.filters.search,
                            rarity = game._auction.filters.rarity,
                            page = 1,
                        })
                    end
                    return
                end
            end

            -- Rarity filter buttons
            if game._auction._rarityBtns then
                for _, btn in ipairs(game._auction._rarityBtns) do
                    if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        game._auction.filters.rarity = btn.rarity
                        game._auction.page = 1
                        if client then
                            client:emit("mmo_auction_browse", {
                                search = game._auction.filters.search,
                                rarity = game._auction.filters.rarity,
                                page = 1,
                            })
                        end
                        return
                    end
                end
            end

            -- Listing buy buttons
            if game._auction._listingBtns then
                for _, btn in pairs(game._auction._listingBtns) do
                    if btn and x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        if client then
                            client:emit("mmo_auction_buy", { listingId = btn.listingId })
                        end
                        return
                    end
                end
            end

            -- Pagination
            if game._auction._prevPageBtn then
                local btn = game._auction._prevPageBtn
                if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                    game._auction.page = math.max(1, game._auction.page - 1)
                    if client then
                        client:emit("mmo_auction_browse", {
                            search = game._auction.filters.search,
                            rarity = game._auction.filters.rarity,
                            page = game._auction.page,
                        })
                    end
                    return
                end
            end
            if game._auction._nextPageBtn then
                local btn = game._auction._nextPageBtn
                if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                    game._auction.page = game._auction.page + 1
                    if client then
                        client:emit("mmo_auction_browse", {
                            search = game._auction.filters.search,
                            rarity = game._auction.filters.rarity,
                            page = game._auction.page,
                        })
                    end
                    return
                end
            end

        elseif game._auction.tab == "sell" then
            -- Price input click
            if game._auction._priceInput then
                local pi = game._auction._priceInput
                game._auction.priceActive = x >= pi.x and x < pi.x + pi.w and y >= pi.y and y < pi.y + pi.h
                game._auction.searchActive = false
            end

            -- List button
            if game._auction._listBtn and game._auction.sellCard and #game._auction.sellPrice > 0 then
                local btn = game._auction._listBtn
                if x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                    local price = tonumber(game._auction.sellPrice)
                    if price and price > 0 and client then
                        client:emit("mmo_auction_list_card", {
                            cardInstanceId = game._auction.sellCard.instanceId,
                            price = price,
                        })
                        game._auction.sellCard = nil
                        game._auction.sellPrice = ""
                    end
                    return
                end
            end

            -- Sell card selection
            if game._auction._sellCardBtns then
                for _, btn in pairs(game._auction._sellCardBtns) do
                    if btn and x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        game._auction.sellCard = btn.card
                        return
                    end
                end
            end

        elseif game._auction.tab == "my_listings" then
            -- Cancel buttons
            if game._auction._cancelBtns then
                for _, btn in pairs(game._auction._cancelBtns) do
                    if btn and x >= btn.x and x < btn.x + btn.w and y >= btn.y and y < btn.y + btn.h then
                        if client then
                            client:emit("mmo_auction_cancel", { listingId = btn.listingId })
                        end
                        return
                    end
                end
            end
        end
        return
    end

    -- Right-click or middle-click cancels placement mode
    if ui.placementMode and button == 2 then
        ui.placementMode = false
        ui.placementType = nil
        ui.placementItemId = nil
        return
    end

    -- Left-click in placement mode: place the object at world coords
    if ui.placementMode and button == 1 and not ui.showInventory then
        local wx = x + math.floor(camera.x)
        local wy = y + math.floor(camera.y)

        -- Check if inside own plot or in plot zone
        local canPlace = false
        if zone and zone.type == "plot" then
            canPlace = true
        elseif overworld.myPlotId then
            for _, plot in pairs(overworld.plots) do
                if plot.id == overworld.myPlotId then
                    if wx >= plot.x and wx < plot.x + plot.width and
                       wy >= plot.y and wy < plot.y + plot.height then
                        canPlace = true
                    end
                    break
                end
            end
        end

        if canPlace and client and ui.placementItemId then
            client:emit("place_object", {
                itemId = ui.placementItemId,
                x = wx,
                y = wy,
            })
        elseif not canPlace then
            if myId and players[myId] then
                game.addFloatingText({
                    text = "Must place inside your plot",
                    x = players[myId].x, y = players[myId].y - 40,
                    color = { 1, 0.3, 0.3 },
                    timer = 2.0,
                })
            end
        end
        return
    end

    -- Party panel click handling
    if ui.showPartyPanel and button == 1 then
        -- Create Party button
        if not game._raid.partyData and ui._partyCreateBtn then
            local btn = ui._partyCreateBtn
            if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                if client then client:emit("party_create", {}) end
                return
            end
        end

        -- Accept invite button
        if not game._raid.partyData and game._raid.partyInvitePending and ui._partyAcceptBtn then
            local btn = ui._partyAcceptBtn
            if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                if client then
                    client:emit("party_accept", { partyId = game._raid.partyInvitePending.partyId })
                end
                game._raid.partyInvitePending = nil
                return
            end
        end

        -- Decline invite button
        if not game._raid.partyData and game._raid.partyInvitePending and ui._partyDeclineBtn then
            local btn = ui._partyDeclineBtn
            if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                game._raid.partyInvitePending = nil
                return
            end
        end

        -- Invite input focus
        if game._raid.partyData and ui._raid.partyInviteInput then
            local inp = ui._raid.partyInviteInput
            if x >= inp.x and x <= inp.x + inp.w and y >= inp.y and y <= inp.y + inp.h then
                game._raid.partyInviteActive = true
                return
            else
                game._raid.partyInviteActive = false
            end
        end

        -- Send invite button
        if game._raid.partyData and ui._partyInviteSendBtn then
            local btn = ui._partyInviteSendBtn
            if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                if client and #game._raid.partyInviteInput > 0 then
                    -- Find player by name in current zone
                    local targetId = nil
                    for id, p in pairs(players) do
                        if id ~= myId and p.name and p.name:lower() == game._raid.partyInviteInput:lower() then
                            targetId = id
                            break
                        end
                        if id ~= myId and p.username and p.username:lower() == game._raid.partyInviteInput:lower() then
                            targetId = id
                            break
                        end
                    end
                    if targetId then
                        client:emit("party_invite", { targetId = targetId })
                        game.addFloatingText({
                            text = "Invite sent to " .. game._raid.partyInviteInput,
                            x = players[myId] and players[myId].x or 0,
                            y = players[myId] and (players[myId].y - 40) or 0,
                            color = {0.4, 0.7, 1},
                            timer = 2.5,
                        })
                    else
                        game.addFloatingText({
                            text = "Player '" .. game._raid.partyInviteInput .. "' not found in zone",
                            x = players[myId] and players[myId].x or 0,
                            y = players[myId] and (players[myId].y - 40) or 0,
                            color = {1, 0.3, 0.3},
                            timer = 2.5,
                        })
                    end
                    game._raid.partyInviteInput = ""
                    game._raid.partyInviteActive = false
                end
                return
            end
        end

        -- Leave/Disband button
        if game._raid.partyData and ui._partyLeaveBtn then
            local btn = ui._partyLeaveBtn
            if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                if client then
                    client:emit("party_leave", {})
                end
                return
            end
        end
    end

    if ui.showZoneList and button == 1 then
        local W = love.graphics.getWidth()
        local listW = 350
        local itemH = 40
        local listX = (W - listW) / 2
        local startY = 90

        for i, z in ipairs(zoneList) do
            local zy = startY + (i - 1) * (itemH + 6)
            if x >= listX and x <= listX + listW and y >= zy and y <= zy + itemH then
                if zone and zone.id ~= z.id then
                    client:emit("zone_enter", { zoneId = z.id })
                end
                ui.showZoneList = false
                return
            end
        end
    end

    if ui.showInventory and button == 1 then
        local W = love.graphics.getWidth()
        local H = love.graphics.getHeight()
        local panelW = math.min(700, W - 40)
        local panelH = math.min(560, H - 60)
        local panelX = (W - panelW) / 2
        local panelY = (H - panelH) / 2

        -- Tab clicks
        local tabW = panelW / 3
        for i, tab in ipairs({"resources", "items", "crafting"}) do
            local tx = panelX + (i - 1) * tabW
            local ty = panelY + 35
            if x >= tx + 2 and x <= tx + tabW - 2 and y >= ty and y <= ty + 24 then
                ui.inventoryTab = tab
                return
            end
        end

        -- B2: Enhanced items tab clicks (equip/use/place buttons)
        if ui.inventoryTab == "items" then
            local contentY = panelY + 68
            -- Item filter subtab clicks
            local filterList = { "all", "equipment", "consumable", "material" }
            local fW = panelW / #filterList
            for i, f in ipairs(filterList) do
                local fx = panelX + (i - 1) * fW
                if x >= fx + 2 and x <= fx + fW - 2 and y >= contentY and y <= contentY + 20 then
                    ui.inventoryItemFilter = f
                    return
                end
            end
            -- Check item action buttons
            for _, btn in ipairs(inventoryItemButtons) do
                if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                    if btn.action == "equip" and client then
                        -- Auto-detect slot from item type
                        local slot = game.getEquipSlotForItem(btn.item)
                        client:emit("equip_item", { slot = slot, itemId = btn.item.id })
                    elseif btn.action == "use" and client then
                        client:emit("consume_food_item", { itemId = btn.item.id })
                    elseif btn.action == "place" then
                        game.enterPlacementMode(btn.item.type, btn.item.id)
                    end
                    return
                end
            end
        end

        -- B3: Crafting tab clicks (craft buttons only, no station filters)
        if ui.inventoryTab == "crafting" then
            for _, btn in ipairs(craftingButtons) do
                if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                    if btn.canAfford and client then
                        client:emit("craft_item", { recipeId = btn.recipe.id })
                    end
                    return
                end
            end
        end
    end

    -- B1: Equipment panel click handling
    if ui.showEquipment and button == 1 then
        for _, btn in ipairs(equipSlotButtons) do
            if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
                if btn.action == "remove" and client then
                    client:emit("unequip_item", { slot = btn.slot })
                elseif btn.action == "repair" and client then
                    client:emit("repair_item", { slot = btn.slot })
                end
                return
            end
        end
    end
end

local function mousemoved(x, y)
    local client = getClient()
    -- Audio slider drag
    if game._audioSliderDrag then
        local panelW = 360
        local px = (love.graphics.getWidth() - panelW) / 2
        local sliderX = px + 130
        local sliderW = panelW - 160
        local t = math.max(0, math.min(1, (x - sliderX) / sliderW))
        game._audio.setVolume(game._audioSliderDrag, t)
    end
    -- Vision bar hover tracking
    if dungeon.inDungeon then
        dungeonDrawModule.updateVisionBarHover(x, y)
    end
    -- Forward to combat UI for tile hover / path preview
    if tcState.inCombat and combatUI then
        combatUI.handleMouseMove(x, y, camera.x, camera.y)
    end
end

local function wheelmoved(x, y)
    local mapZoom = getMapZoom()
    if ui.showGridInventory then
        if gridInv.wheelmoved(x, y) then return end
    end
    if ui.showEquipment then
        ui.equipmentScroll = math.max(0, ui.equipmentScroll - y * 30)
        return
    end
    if game._portal.show then
        game._portal.scroll = math.max(0, game._portal.scroll - y * 30)
        return
    end
    if game._trade.show then
        -- Scroll the inventory list in the game._trade panel
        game._trade.myScroll = math.max(0, game._trade.myScroll - y * 30)
        return
    end
    if game._npcShop.show then
        game._npcShop.scroll = math.max(0, game._npcShop.scroll - y * 30)
        return
    end
    if game._bank.show then
        game._bank.scroll = math.max(0, game._bank.scroll - y * 30)
        return
    end
    if game._auction.show then
        game._auction.scroll = math.max(0, game._auction.scroll - y * 30)
        return
    end
    if ui.showCardCollection then
        if ui.cardTab == "vendor" then
            game._cardVendor.scroll = math.max(0, game._cardVendor.scroll - y * 30)
        else
            ui.cardScrollY = math.max(0, ui.cardScrollY - y * 30)
        end
        return
    end
    if ui.showKnowledge then
        knowledge.scrollY = math.max(0, knowledge.scrollY - y * 30)
        return
    end
    if ui.showVip and game._vip.tab == "shop" then
        game._vip.shopScroll = math.max(0, game._vip.shopScroll - math.floor(y))
        return
    end
    if ui.showRumors then
        game._rumors.scroll = math.max(0, game._rumors.scroll - math.floor(y))
        return
    end
    if ui.showWorldMap then
        if y > 0 then
            mapZoom = math.min(50, mapZoom * 1.3)
        elseif y < 0 then
            mapZoom = math.max(1, mapZoom / 1.3)
        end
    end
    setMapZoom(mapZoom)
end

function game_input.init(gameRef, ctx)
    game                     = gameRef
    dungeon                  = ctx.dungeon
    camera                   = ctx.camera
    rpg                      = ctx.rpg
    players                  = ctx.players
    chat                     = ctx.chat
    overworld                = ctx.overworld
    tcState                  = ctx.tcState
    ui                       = ctx.ui
    knowledge                = ctx.knowledge
    combatUI                 = ctx.combatUI
    combatAnim               = ctx.combatAnim
    gridInv                  = ctx.gridInv
    permadeath               = ctx.permadeath
    DTILE                    = ctx.DTILE
    CONTEXT_MENU_ITEMS_BASE  = ctx.CONTEXT_MENU_ITEMS_BASE
    getClient                = ctx.getClient
    getZone                  = ctx.getZone
    getMyId                  = ctx.getMyId
    getSkills                = ctx.getSkills
    getHoverResource         = ctx.getHoverResource
    getHoverObject           = ctx.getHoverObject
    getHoverConnection       = ctx.getHoverConnection
    getCorpseLootPanel       = ctx.getCorpseLootPanel
    getContainerLootPanel    = ctx.getContainerLootPanel
    getPackReveal            = ctx.getPackReveal
    getZoneMonsters          = ctx.getZoneMonsters
    getZoneCorpses           = ctx.getZoneCorpses
    getZoneWorldContainers   = ctx.getZoneWorldContainers
    getMapZoom               = ctx.getMapZoom
    getMonsterAttackCooldown = ctx.getMonsterAttackCooldown
    getEquipSlotButtons      = ctx.getEquipSlotButtons
    getInventoryItemButtons  = ctx.getInventoryItemButtons
    getCraftingButtons       = ctx.getCraftingButtons
    setCorpseLootPanel       = ctx.setCorpseLootPanel
    setContainerLootPanel    = ctx.setContainerLootPanel
    setPackReveal            = ctx.setPackReveal
    setMapZoom               = ctx.setMapZoom
    setMonsterAttackCooldown = ctx.setMonsterAttackCooldown
    -- Register input handlers onto game table
    gameRef.keypressed = keypressed
    gameRef.textinput = textinput
    gameRef.mousepressed = mousepressed
    gameRef.mousemoved = mousemoved
    gameRef.wheelmoved = wheelmoved
end

return game_input
