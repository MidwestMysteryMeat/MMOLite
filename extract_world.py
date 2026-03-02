import re

path     = "F:/LOVE - Gacha/MMOLite/client/scenes/game.lua"
out_path = "F:/LOVE - Gacha/MMOLite/client/scenes/game-draw/world.lua"

with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()

WORLD_START = 6561
WORLD_END   = 8999

FUNC_NAMES = [
    "drawZoneMonsters", "drawCorpsesAndContainers", "drawLootPanel",
    "drawLevelUpEffect", "drawPackReveal", "drawOnboardingTip",
    "drawMonsterHitFlash", "drawTerrain", "drawGround", "drawPlots",
    "drawResources", "drawPlacedObjects", "drawFloatingTexts",
    "drawMiniRifts", "drawLeviathans", "drawLeviathanHUD", "drawLeviathanPartBars",
    "drawConnections", "drawPlayer", "drawDialoguePanel",
    "drawWeather", "drawSeasonVisual",
    "drawHUD", "drawWorldSystemsHUD", "drawDoomHUD", "drawChat",
]

INJECT_MAP = {
    "drawZoneMonsters":         ["    local myId = getMyId()\n",
                                 "    local zoneMonsters = getEntityState().zoneMonsters\n"],
    "drawCorpsesAndContainers": ["    local myId = getMyId()\n",
                                 "    local es = getEntityState()\n",
                                 "    local zoneCorpses         = es.zoneCorpses\n",
                                 "    local zoneWorldContainers = es.zoneWorldContainers\n",
                                 "    local corpseLootPanel     = es.corpseLootPanel\n",
                                 "    local containerLootPanel  = es.containerLootPanel\n"],
    "drawLootPanel":            ["    local es = getEntityState()\n",
                                 "    local corpseLootPanel    = es.corpseLootPanel\n",
                                 "    local containerLootPanel = es.containerLootPanel\n"],
    "drawLevelUpEffect":        ["    local levelUpEffect = getEntityState().levelUpEffect\n"],
    "drawPackReveal":           ["    local packReveal = getEntityState().packReveal\n"],
    "drawOnboardingTip":        ["    local onboarding = getEntityState().onboarding\n"],
    "drawTerrain":              ["    local zone = getZone()\n"],
    "drawGround":               ["    local zone = getZone()\n",
                                 "    local es = getEntityState()\n",
                                 "    local connections    = es.connections\n",
                                 "    local placedObjects  = es.placedObjects\n",
                                 "    local hoverObject    = es.hoverObject\n",
                                 "    local hoverResource  = es.hoverResource\n"],
    "drawPlots":                ["    local account = getAccount()\n",
                                 "    local zone = getZone()\n"],
    "drawResources":            ["    local hoverResource = getEntityState().hoverResource\n"],
    "drawPlacedObjects":        ["    local placedObjects = getEntityState().placedObjects\n"],
    "drawFloatingTexts":        ["    local fadeIn = getFadeIn()\n"],
    "drawMiniRifts":            ["    local fadeIn = getFadeIn()\n",
                                 "    local es = getEntityState()\n",
                                 "    local miniRifts      = es.miniRifts\n",
                                 "    local riftDestroyVfx = es.riftDestroyVfx\n"],
    "drawLeviathans":           ["    local fadeIn = getFadeIn()\n"],
    "drawLeviathanHUD":         ["    local fadeIn = getFadeIn()\n"],
    "drawLeviathanPartBars":    ["    local fadeIn = getFadeIn()\n"],
    "drawHUD":                  ["    local account = getAccount()\n",
                                 "    local zone    = getZone()\n",
                                 "    local skills  = getSkills()\n",
                                 "    local fadeIn  = getFadeIn()\n"],
    "drawChat":                 ["    local fadeIn = getFadeIn()\n"],
    "getOtherPlayerAtScreen":   ["    local myId = getMyId()\n"],
    "executeContextMenuAction": ["    local client = getClient()\n",
                                 "    local myId = getMyId()\n"],
}

HEADER = (
    "-- scenes/game-draw/world.lua\n"
    "-- Overworld zone rendering: monsters, terrain, resources, objects, players, HUD, chat.\n"
    "\n"
    "local world_draw = {}\n"
    "\n"
    "-- 'game' alias: all game._xxx references work unchanged\n"
    "local game\n"
    "\n"
    "-- Direct table refs (mutated in-place, safe to capture at init time)\n"
    "local dungeon, camera, fonts, ui, rpg, players, resources\n"
    "local floatingTexts, world, chat, overworld, tcState\n"
    "local corruption, doom, sprint  -- not reassigned; no getter needed\n"
    "\n"
    "-- getEntityState() returns current snapshot of all reassignable zone-entity locals:\n"
    "--   zoneMonsters, zoneCorpses, zoneWorldContainers, connections,\n"
    "--   corpseLootPanel, containerLootPanel, hoverObject, hoverResource,\n"
    "--   identity, levelUpEffect, miniRifts, onboarding, packReveal,\n"
    "--   placedObjects, riftDestroyVfx\n"
    "local getEntityState\n"
    "local getZone, getMyId, getFadeIn, getSkills, getAccount, getClient\n"
    "\n"
)

def make_footer(func_names):
    parts = [
        "\nfunction world_draw.init(gameRef, ctx)\n",
        "    game           = gameRef\n",
        "    dungeon        = ctx.dungeon\n",
        "    camera         = ctx.camera\n",
        "    fonts          = ctx.fonts\n",
        "    ui             = ctx.ui\n",
        "    rpg            = ctx.rpg\n",
        "    players        = ctx.players\n",
        "    resources      = ctx.resources\n",
        "    floatingTexts  = ctx.floatingTexts\n",
        "    world          = ctx.world\n",
        "    chat           = ctx.chat\n",
        "    overworld      = ctx.overworld\n",
        "    tcState        = ctx.tcState\n",
        "    corruption     = ctx.corruption\n",
        "    doom           = ctx.doom\n",
        "    sprint         = ctx.sprint\n",
        "    getEntityState = ctx.getEntityState\n",
        "    getZone        = ctx.getZone\n",
        "    getMyId        = ctx.getMyId\n",
        "    getFadeIn      = ctx.getFadeIn\n",
        "    getSkills      = ctx.getSkills\n",
        "    getAccount     = ctx.getAccount\n",
        "    getClient      = ctx.getClient\n",
        "    -- Register draw functions onto the game table\n",
    ]
    for fn in func_names:
        parts.append(f"    gameRef.{fn} = {fn}\n")
    parts += [
        "end\n", "\n",
        "world_draw.getOtherPlayerAtScreen   = getOtherPlayerAtScreen\n",
        "world_draw.executeContextMenuAction = executeContextMenuAction\n",
        "\n",
        "return world_draw\n",
    ]
    return parts

output = [HEADER]
pending_inject = None

for line in lines[WORLD_START:WORLD_END]:
    m_game  = re.match(r'^function game\.(_?\w+)\(', line)
    m_local = re.match(r'^local function (\w+)\(', line)

    if m_game:
        fname = m_game.group(1)
        new_line = line.replace("function game." + fname + "(", "local function " + fname + "(", 1)
        output.append(new_line)
        pending_inject = INJECT_MAP.get(fname)
        continue

    if m_local:
        fname = m_local.group(1)
        output.append(line)
        pending_inject = INJECT_MAP.get(fname)
        continue

    if pending_inject is not None:
        for il in pending_inject:
            output.append(il)
        pending_inject = None

    output.append(line)

output.extend(make_footer(FUNC_NAMES))

text = "".join(output)
# Replace bare addFloatingText( calls (only in executeContextMenuAction)
text = text.replace("        addFloatingText({", "        game.addFloatingText({")
replacements = text.count("game.addFloatingText(")
print(f"addFloatingText replacements: {replacements}")

with open(out_path, "w", encoding="utf-8") as f:
    f.write(text)

print(f"Written ~{text.count(chr(10))} lines to world.lua")
