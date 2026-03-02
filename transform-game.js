#!/usr/bin/env node
// transform-game.js — Apply all Phase A-C changes to game.lua in a single pass
// 1. Phase A: Move helpers to game table with local aliases
// 2. Add handlerModules require block
// 3. Replace static SCENE_EVENTS with dynamic builder
// 4. Add ctx + module registration in setupListeners
// 5. Remove extracted handler blocks (full blocks)

const fs = require('fs');
const path = require('path');

const gameFile = path.join(__dirname, 'client/scenes/game.lua');
let content = fs.readFileSync(gameFile, 'utf8');
let lines = content.split('\n');

// Load extracted event names from handler modules
const handlersDir = path.join(__dirname, 'client/scenes/game-handlers');
const extractedEvents = new Set();
for (const f of fs.readdirSync(handlersDir)) {
    if (!f.endsWith('.lua')) continue;
    const src = fs.readFileSync(path.join(handlersDir, f), 'utf8');
    for (const m of src.matchAll(/client:on\("([^"]+)"/g)) {
        extractedEvents.add(m[1]);
    }
}
console.log(`Extracted events from modules: ${extractedEvents.size}`);

// ============================================================
// STEP 1: Phase A — Move helpers to game table
// ============================================================

// 1a. debugLog (line 153)
const debugLogIdx = lines.findIndex(l => l === 'local function debugLog(msg)');
if (debugLogIdx === -1) throw new Error('Cannot find debugLog');
lines[debugLogIdx] = 'function game.debugLog(msg)';
// Insert alias after the closing 'end'
let debugLogEnd = debugLogIdx;
for (let j = debugLogIdx + 1; j < lines.length; j++) {
    if (lines[j] === 'end') { debugLogEnd = j; break; }
}
lines.splice(debugLogEnd + 1, 0, 'local debugLog = game.debugLog');

// 1b. addChatMessage (line ~219)
const addChatIdx = lines.findIndex(l => l === 'local function addChatMessage(text, rgbColor)');
if (addChatIdx === -1) throw new Error('Cannot find addChatMessage');
lines[addChatIdx] = 'function game.addChatMessage(text, rgbColor)';
let addChatEnd = addChatIdx;
for (let j = addChatIdx + 1; j < lines.length; j++) {
    if (lines[j] === 'end') { addChatEnd = j; break; }
}
lines.splice(addChatEnd + 1, 0, 'local addChatMessage = game.addChatMessage');

// 1c. NOTIFICATION_DURATION (line ~422)
const notifIdx = lines.findIndex(l => l === 'local NOTIFICATION_DURATION = 4.0');
if (notifIdx === -1) throw new Error('Cannot find NOTIFICATION_DURATION');
lines[notifIdx] = 'game.NOTIFICATION_DURATION = 4.0';
lines.splice(notifIdx + 1, 0, 'local NOTIFICATION_DURATION = game.NOTIFICATION_DURATION');

// 1d. addFloatingText (line ~486)
const addFloatIdx = lines.findIndex(l => l === 'local function addFloatingText(entry)');
if (addFloatIdx === -1) throw new Error('Cannot find addFloatingText');
lines[addFloatIdx] = 'function game.addFloatingText(entry)';
let addFloatEnd = addFloatIdx;
for (let j = addFloatIdx + 1; j < lines.length; j++) {
    if (lines[j] === 'end') { addFloatEnd = j; break; }
}
lines.splice(addFloatEnd + 1, 0, 'local addFloatingText = game.addFloatingText');

// 1e. resetTradeState (line ~802)
const resetTradeIdx = lines.findIndex(l => l === 'local function resetTradeState()');
if (resetTradeIdx === -1) throw new Error('Cannot find resetTradeState');
lines[resetTradeIdx] = 'function game.resetTradeState()';
let resetTradeEnd = resetTradeIdx;
for (let j = resetTradeIdx + 1; j < lines.length; j++) {
    if (lines[j] === 'end') { resetTradeEnd = j; break; }
}
lines.splice(resetTradeEnd + 1, 0, 'local resetTradeState = game.resetTradeState');

console.log('Phase A: 5 helpers moved to game table');

// ============================================================
// STEP 2: Add handlerModules require block after game._assets
// ============================================================
const assetsIdx = lines.findIndex(l => l.match(/^game\._assets\s*=/));
if (assetsIdx === -1) throw new Error('Cannot find game._assets');

const requireBlock = `
local handlerModules = {
    -- Phase B: pure (client, game) only
    require("scenes.game-handlers.karma-factions"),
    require("scenes.game-handlers.companions"),
    require("scenes.game-handlers.pets"),
    require("scenes.game-handlers.ascension"),
    require("scenes.game-handlers.guild"),
    require("scenes.game-handlers.minigame"),
    require("scenes.game-handlers.npc-dialogue"),
    require("scenes.game-handlers.environment"),
    require("scenes.game-handlers.director"),
    -- Phase C1: simple ctx
    require("scenes.game-handlers.admin"),
    require("scenes.game-handlers.portal"),
    require("scenes.game-handlers.jail"),
    require("scenes.game-handlers.quest"),
    require("scenes.game-handlers.doom"),
    require("scenes.game-handlers.patrol"),
    require("scenes.game-handlers.base-raid"),
    -- Phase C2: mmoInventory/account ctx
    require("scenes.game-handlers.bank"),
    require("scenes.game-handlers.npc-shop"),
    require("scenes.game-handlers.auction"),
    require("scenes.game-handlers.trade"),
    require("scenes.game-handlers.cure"),
    require("scenes.game-handlers.npc-action"),
    require("scenes.game-handlers.crafting-advanced"),
    -- Phase C3: complex ctx
    require("scenes.game-handlers.cards"),
    require("scenes.game-handlers.equipment"),
    require("scenes.game-handlers.knowledge"),
    require("scenes.game-handlers.mastery"),
    require("scenes.game-handlers.farming"),
    require("scenes.game-handlers.monster"),
}`.split('\n');

lines.splice(assetsIdx + 1, 0, ...requireBlock);
console.log('Step 2: handlerModules require block added');

// ============================================================
// STEP 3: Replace static SCENE_EVENTS with dynamic builder
// ============================================================

// Find the SCENE_EVENTS block
const sceneEvtStart = lines.findIndex(l => l === 'local SCENE_EVENTS = {');
if (sceneEvtStart === -1) throw new Error('Cannot find SCENE_EVENTS');

// Find its closing }
let sceneEvtEnd = sceneEvtStart;
for (let j = sceneEvtStart + 1; j < lines.length; j++) {
    if (lines[j].trim() === '}') { sceneEvtEnd = j; break; }
}

// Collect all events from the original SCENE_EVENTS that are NOT extracted
const inlineEvents = [];
for (let j = sceneEvtStart + 1; j < sceneEvtEnd; j++) {
    const matches = lines[j].matchAll(/"([^"]+)"/g);
    for (const m of matches) {
        if (!extractedEvents.has(m[1])) {
            inlineEvents.push(m[1]);
        }
    }
}

console.log(`Inline events (Phase D): ${inlineEvents.length}`);
console.log(`Extracted events: ${extractedEvents.size}`);
console.log(`Total: ${inlineEvents.length + extractedEvents.size}`);

// Build replacement
const inlineEventsStr = [];
// Group into lines of 4 events per line for readability
for (let k = 0; k < inlineEvents.length; k += 4) {
    const chunk = inlineEvents.slice(k, k + 4).map(e => `"${e}"`).join(', ');
    inlineEventsStr.push(`    ${chunk},`);
}

const replacement = [
    'local INLINE_EVENTS = {',
    ...inlineEventsStr,
    '}',
    '',
    '-- Build SCENE_EVENTS dynamically from inline + handler modules',
    'local SCENE_EVENTS = {}',
    'for _, evt in ipairs(INLINE_EVENTS) do',
    '    SCENE_EVENTS[#SCENE_EVENTS + 1] = evt',
    'end',
    'for _, mod in ipairs(handlerModules) do',
    '    if mod.EVENTS then',
    '        for _, evt in ipairs(mod.EVENTS) do',
    '            SCENE_EVENTS[#SCENE_EVENTS + 1] = evt',
    '        end',
    '    end',
    'end',
];

lines.splice(sceneEvtStart, sceneEvtEnd - sceneEvtStart + 1, ...replacement);
console.log('Step 3: SCENE_EVENTS replaced with dynamic builder');

// ============================================================
// STEP 4: Add ctx + module registration in setupListeners
// ============================================================

// Find setupListeners and the first client:on after the initial setup
const setupIdx = lines.findIndex(l => l.match(/^function game\.setupListeners\(\)/));
if (setupIdx === -1) throw new Error('Cannot find setupListeners');

// Find "client:emit("grid_sync"" which is right after gridInv.init
const gridSyncIdx = lines.findIndex((l, idx) => idx > setupIdx && l.match(/client:emit\("grid_sync"/));
if (gridSyncIdx === -1) throw new Error('Cannot find grid_sync emit');

const ctxBlock = [
    '',
    '    -- Build shared context for handler modules that need file-scope locals',
    '    local ctx = {',
    '        -- Tables (mutated in-place, never reassigned — direct refs work)',
    '        players = players, ui = ui, rpg = rpg, chat = chat,',
    '        dungeon = dungeon, overworld = overworld, sprint = sprint,',
    '        knowledge = knowledge, mastery = mastery, doom = doom,',
    '        activePatrols = activePatrols, corruption = corruption,',
    '        permadeath = permadeath, identity = identity,',
    '        zoneMonsters = zoneMonsters, zoneCorpses = zoneCorpses,',
    '        zoneWorldContainers = zoneWorldContainers,',
    '        -- Reassignable locals (need getter/setter)',
    '        getAccount = function() return account end,',
    '        getMmoInventory = function() return mmoInventory end,',
    '        setMmoInventory = function(inv) mmoInventory = inv end,',
    '        getMyId = function() return myId end,',
    '        getCorpseLootPanel = function() return corpseLootPanel end,',
    '        setCorpseLootPanel = function(p) corpseLootPanel = p end,',
    '        getContainerLootPanel = function() return containerLootPanel end,',
    '        setContainerLootPanel = function(p) containerLootPanel = p end,',
    '        setPackReveal = function(pr) packReveal = pr end,',
    '        setDurabilityData = function(d) durabilityData = d end,',
    '    }',
    '',
    '    -- Register all handler modules',
    '    for _, mod in ipairs(handlerModules) do',
    '        mod.register(client, game, ctx)',
    '    end',
];

lines.splice(gridSyncIdx + 1, 0, ...ctxBlock);
console.log('Step 4: ctx + module registration added');

// ============================================================
// STEP 5: Remove extracted handler blocks
// ============================================================

// Re-find setupListeners start (lines shifted from previous insertions)
const setupIdx2 = lines.findIndex(l => l.match(/^function game\.setupListeners\(\)/));

// Find all client:on blocks for extracted events and calculate their full ranges
function findHandlerRange(startLine) {
    // A client:on("event", function(data) block.
    // Track depth: block-openers add 1, 'end' subtracts 1.
    // The block ends when depth returns to 0.
    let depth = 0;
    for (let j = startLine; j < lines.length; j++) {
        const l = lines[j];
        // Remove comments and strings for analysis
        const cleaned = l.replace(/--.*/g, '').replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, '""');

        let opens = 0;
        let closes = 0;

        // Count function openings (anonymous)
        const funcs = cleaned.match(/\bfunction\s*\(/g);
        if (funcs) opens += funcs.length;

        // Count block openings: if...then, for...do, while...do
        // Each one that is NOT a single-line block (i.e., doesn't also have end on same line) is an open
        const ifMatch = cleaned.match(/\bif\b.*\bthen\b/g);
        if (ifMatch) opens += ifMatch.length;

        const forMatch = cleaned.match(/\bfor\b.*\bdo\b/g);
        if (forMatch) opens += forMatch.length;

        const whileMatch = cleaned.match(/\bwhile\b.*\bdo\b/g);
        if (whileMatch) opens += whileMatch.length;

        // Count all end keywords
        const ends = cleaned.match(/\bend\b/g);
        if (ends) closes += ends.length;

        // Single-line blocks: if...then...end / for...do...end / while...do...end
        // These have both an open and close on the same line, which already cancel.
        // No adjustment needed — the open and close both get counted and cancel out.

        depth += opens - closes;

        if (depth <= 0 && j > startLine) {
            return { start: startLine, end: j, lines: j - startLine + 1 };
        }
    }
    return null;
}

const ranges = [];
for (let i = setupIdx2; i < lines.length; i++) {
    const m = lines[i].match(/client:on\("([^"]+)"/);
    if (m && extractedEvents.has(m[1])) {
        const range = findHandlerRange(i);
        if (range) {
            ranges.push({ ...range, evt: m[1] });
            i = range.end; // skip past this block
        } else {
            console.error(`FAILED to find range for ${m[1]} at line ${i + 1}`);
        }
    }
}

console.log(`Found ${ranges.length} handler blocks to remove`);

// Sort descending by start line (remove from bottom first)
ranges.sort((a, b) => b.start - a.start);

let totalRemoved = 0;
for (const r of ranges) {
    // Also check if there's a blank line or comment-only line right before
    let removeStart = r.start;
    // Check for preceding blank line
    if (removeStart > 0 && lines[removeStart - 1].trim() === '') {
        removeStart--;
    }
    // Check for section comment like "-- Doom ascension events"
    if (removeStart > 0 && lines[removeStart - 1].trim().match(/^--/)) {
        removeStart--;
        // And preceding blank line before comment
        if (removeStart > 0 && lines[removeStart - 1].trim() === '') {
            removeStart--;
        }
    }

    const count = r.end - removeStart + 1;
    lines.splice(removeStart, count);
    totalRemoved += count;
}

// Clean up double blank lines
const cleaned = [];
let prevBlank = false;
for (const line of lines) {
    const isBlank = line.trim() === '';
    if (isBlank && prevBlank) continue;
    cleaned.push(line);
    prevBlank = isBlank;
}

fs.writeFileSync(gameFile, cleaned.join('\n'));
console.log(`\nRemoved ${totalRemoved} lines across ${ranges.length} blocks`);
console.log(`Final file: ${cleaned.length} lines (was ${content.split('\n').length})`);

// Verify: check no extracted events remain inline
const finalLines = cleaned;
const remaining = [];
const setupIdx3 = finalLines.findIndex(l => l.match(/^function game\.setupListeners\(\)/));
for (let i = setupIdx3; i < finalLines.length; i++) {
    const m = finalLines[i].match(/client:on\("([^"]+)"/);
    if (m && extractedEvents.has(m[1])) {
        remaining.push(`  line ${i+1}: ${m[1]}`);
    }
}
if (remaining.length > 0) {
    console.error(`\nWARNING: ${remaining.length} extracted events still inline:`);
    remaining.forEach(r => console.error(r));
} else {
    console.log('\nVERIFIED: No extracted events remain inline');
}

// Count inline client:on handlers
let inlineCount = 0;
for (let i = setupIdx3; i < finalLines.length; i++) {
    if (finalLines[i].match(/client:on\("/)) inlineCount++;
}
console.log(`Inline handlers remaining: ${inlineCount}`);

// Count module handlers
let moduleCount = 0;
for (const f of fs.readdirSync(handlersDir)) {
    if (!f.endsWith('.lua')) continue;
    const src = fs.readFileSync(path.join(handlersDir, f), 'utf8');
    moduleCount += (src.match(/client:on\("/g) || []).length;
}
console.log(`Module handlers: ${moduleCount}`);
console.log(`Total: ${inlineCount + moduleCount}`);
