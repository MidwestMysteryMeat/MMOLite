import re

path     = "F:/LOVE - Gacha/MMOLite/client/scenes/game.lua"
out_path = "F:/LOVE - Gacha/MMOLite/client/scenes/game-input.lua"

with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()

# Find exact bounds by locating the function declarations
def find_line(pattern, start=0):
    pat = re.compile(pattern)
    for i in range(start, len(lines)):
        if pat.match(lines[i]):
            return i
    raise ValueError(f"Pattern not found: {pattern}")

kp_start  = find_line(r'^function game\.keypressed\b')
unload_start = find_line(r'^function game\.unload\b')
INPUT_START = kp_start
INPUT_END   = unload_start  # exclusive

print(f"Extracting lines {INPUT_START+1}..{INPUT_END} ({INPUT_END - INPUT_START} lines)")

FUNC_NAMES = ["keypressed", "textinput", "mousepressed", "mousemoved", "wheelmoved"]

INJECT_MAP = {
    "keypressed": [
        "    local zone                = getZone()\n",
        "    local myId               = getMyId()\n",
        "    local client             = getClient()\n",
        "    local skills             = getSkills()\n",
        "    local hoverResource      = getHoverResource()\n",
        "    local hoverObject        = getHoverObject()\n",
        "    local hoverConnection    = getHoverConnection()\n",
        "    local corpseLootPanel    = getCorpseLootPanel()\n",
        "    local containerLootPanel = getContainerLootPanel()\n",
        "    local packReveal         = getPackReveal()\n",
        "    local zoneMonsters       = getZoneMonsters()\n",
        "    local zoneCorpses        = getZoneCorpses()\n",
        "    local zoneWorldContainers = getZoneWorldContainers()\n",
        "    local monsterAttackCooldown = getMonsterAttackCooldown()\n",
    ],
    "textinput": [
        "    local client = getClient()\n",
    ],
    "mousepressed": [
        "    local zone               = getZone()\n",
        "    local myId               = getMyId()\n",
        "    local client             = getClient()\n",
        "    local corpseLootPanel    = getCorpseLootPanel()\n",
        "    local containerLootPanel = getContainerLootPanel()\n",
        "    local packReveal         = getPackReveal()\n",
        "    local equipSlotButtons      = getEquipSlotButtons()\n",
        "    local inventoryItemButtons  = getInventoryItemButtons()\n",
        "    local craftingButtons       = getCraftingButtons()\n",
    ],
    "mousemoved": [
        "    local client = getClient()\n",
    ],
    "wheelmoved": [
        "    local mapZoom = getMapZoom()\n",
    ],
}

HEADER = """\
-- scenes/game-input.lua
-- Keyboard and mouse input: keypressed, textinput, mousepressed, mousemoved, wheelmoved.

local game_input = {}

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

"""

def make_footer(func_names):
    parts = [
        "\nfunction game_input.init(gameRef, ctx)\n",
        "    game                     = gameRef\n",
        "    dungeon                  = ctx.dungeon\n",
        "    camera                   = ctx.camera\n",
        "    rpg                      = ctx.rpg\n",
        "    players                  = ctx.players\n",
        "    chat                     = ctx.chat\n",
        "    overworld                = ctx.overworld\n",
        "    tcState                  = ctx.tcState\n",
        "    ui                       = ctx.ui\n",
        "    knowledge                = ctx.knowledge\n",
        "    combatUI                 = ctx.combatUI\n",
        "    combatAnim               = ctx.combatAnim\n",
        "    gridInv                  = ctx.gridInv\n",
        "    permadeath               = ctx.permadeath\n",
        "    DTILE                    = ctx.DTILE\n",
        "    CONTEXT_MENU_ITEMS_BASE  = ctx.CONTEXT_MENU_ITEMS_BASE\n",
        "    getClient                = ctx.getClient\n",
        "    getZone                  = ctx.getZone\n",
        "    getMyId                  = ctx.getMyId\n",
        "    getSkills                = ctx.getSkills\n",
        "    getHoverResource         = ctx.getHoverResource\n",
        "    getHoverObject           = ctx.getHoverObject\n",
        "    getHoverConnection       = ctx.getHoverConnection\n",
        "    getCorpseLootPanel       = ctx.getCorpseLootPanel\n",
        "    getContainerLootPanel    = ctx.getContainerLootPanel\n",
        "    getPackReveal            = ctx.getPackReveal\n",
        "    getZoneMonsters          = ctx.getZoneMonsters\n",
        "    getZoneCorpses           = ctx.getZoneCorpses\n",
        "    getZoneWorldContainers   = ctx.getZoneWorldContainers\n",
        "    getMapZoom               = ctx.getMapZoom\n",
        "    getMonsterAttackCooldown = ctx.getMonsterAttackCooldown\n",
        "    getEquipSlotButtons      = ctx.getEquipSlotButtons\n",
        "    getInventoryItemButtons  = ctx.getInventoryItemButtons\n",
        "    getCraftingButtons       = ctx.getCraftingButtons\n",
        "    setCorpseLootPanel       = ctx.setCorpseLootPanel\n",
        "    setContainerLootPanel    = ctx.setContainerLootPanel\n",
        "    setPackReveal            = ctx.setPackReveal\n",
        "    setMapZoom               = ctx.setMapZoom\n",
        "    setMonsterAttackCooldown = ctx.setMonsterAttackCooldown\n",
        "    -- Register input handlers onto game table\n",
    ]
    for fn in func_names:
        parts.append(f"    gameRef.{fn} = {fn}\n")
    parts += ["end\n", "\n", "return game_input\n"]
    return parts

output = [HEADER]
pending_inject = None

for line in lines[INPUT_START:INPUT_END]:
    m = re.match(r'^function game\.(\w+)\(', line)
    if m:
        fname = m.group(1)
        new_line = line.replace("function game." + fname + "(", "local function " + fname + "(", 1)
        output.append(new_line)
        pending_inject = INJECT_MAP.get(fname)
        continue

    if pending_inject is not None:
        for il in pending_inject:
            output.append(il)
        pending_inject = None

    output.append(line)

output.extend(make_footer(FUNC_NAMES))
text = "".join(output)

# --- Setter replacements (regex preserves indentation) ---
text = re.sub(r'(\s+)corpseLootPanel = nil\n',    r'\1setCorpseLootPanel(nil)\n',    text)
text = re.sub(r'(\s+)containerLootPanel = nil\n', r'\1setContainerLootPanel(nil)\n', text)
text = re.sub(r'(\s+)packReveal = nil\n',         r'\1setPackReveal(nil)\n',         text)
text = re.sub(r'(\s+)monsterAttackCooldown = 0\.8\n', r'\1setMonsterAttackCooldown(0.8)\n', text)
text = re.sub(r'(\s+)resetTradeState\(\)\n',      r'\1game.resetTradeState()\n',      text)

# --- mapZoom in keypressed: inline getter/setter pattern ---
text = text.replace(
    "mapZoom = math.min(50, mapZoom * 1.5)",
    "setMapZoom(math.min(50, getMapZoom() * 1.5))"
)
text = text.replace(
    "mapZoom = math.max(1, mapZoom / 1.5)",
    "setMapZoom(math.max(1, getMapZoom() / 1.5))"
)

# --- mapZoom in wheelmoved: local was injected at start; sync back before final end ---
text = text.replace(
    "    if ui.showWorldMap then\n        if y > 0 then\n            mapZoom = math.min(50, mapZoom * 1.3)\n        elseif y < 0 then\n            mapZoom = math.max(1, mapZoom / 1.3)\n        end\n    end\nend\n",
    "    if ui.showWorldMap then\n        if y > 0 then\n            mapZoom = math.min(50, mapZoom * 1.3)\n        elseif y < 0 then\n            mapZoom = math.max(1, mapZoom / 1.3)\n        end\n    end\n    setMapZoom(mapZoom)\nend\n"
)

# --- addFloatingText alias -> game.addFloatingText ---
text = text.replace("addFloatingText({", "game.addFloatingText({")

print(f"Setter replacements verified.")
print(f"  corpseLootPanel=nil:    {text.count('setCorpseLootPanel(nil)')}")
print(f"  containerLootPanel=nil: {text.count('setContainerLootPanel(nil)')}")
print(f"  packReveal=nil:         {text.count('setPackReveal(nil)')}")
print(f"  monsterAttackCooldown:  {text.count('setMonsterAttackCooldown(0.8)')}")
print(f"  resetTradeState:        {text.count('game.resetTradeState()')}")
print(f"  addFloatingText:        {text.count('game.addFloatingText(')}")
print(f"  setMapZoom (keypressed):{text.count('setMapZoom(math.min')  + text.count('setMapZoom(math.max')}")
print(f"  setMapZoom (wheelmoved):{text.count('setMapZoom(mapZoom)')}")

with open(out_path, "w", encoding="utf-8") as f:
    f.write(text)

print(f"\nWritten ~{text.count(chr(10))} lines to game-input.lua")
