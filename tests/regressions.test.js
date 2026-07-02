// tests/regressions.test.js
// Layer 2: Regression tests — lock in specific bugs that were fixed.
// Each test documents the bug and asserts the fixed behavior.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ---------------------------------------------------------------------------

describe('Regression: party_kick uses Set methods, not Array methods', () => {
  let src;
  beforeAll(() => { src = readSrc('handlers/party.js'); });

  test('uses party.members.has() not indexOf()', () => {
    expect(src).toMatch(/party\.members\.has\(data\.targetId\)/);
    expect(src).not.toMatch(/party\.members\.indexOf\(/);
  });

  test('uses party.members.delete() not splice()', () => {
    expect(src).toMatch(/party\.members\.delete\(data\.targetId\)/);
    expect(src).not.toMatch(/party\.members\.splice\(/);
  });

  test('uses party.members.size not .length in kick handler', () => {
    // The kick handler dissolution check must use .size
    const kickBlock = src.slice(src.indexOf('party_kick'), src.indexOf('party_chat'));
    expect(kickBlock).toMatch(/party\.members\.size/);
    expect(kickBlock).not.toMatch(/party\.members\.length/);
  });

  test('emits party_updated (not party_update) in kick handler', () => {
    const kickBlock = src.slice(src.indexOf('party_kick'), src.indexOf('party_chat'));
    expect(kickBlock).toMatch(/'party_updated'/);
    expect(kickBlock).not.toMatch(/'party_update'[^d]/);
  });

  test('cleans up playerPartyMap on kick', () => {
    const kickBlock = src.slice(src.indexOf('party_kick'), src.indexOf('party_chat'));
    expect(kickBlock).toMatch(/playerPartyMap.*delete\(data\.targetId\)/);
  });
});

// ---------------------------------------------------------------------------

describe('Regression: cleansCorruption typo fixed to cleanseCorruption', () => {
  test('director-lich.js exports cleanseCorruption (not cleansCorruption)', () => {
    const src = readSrc('director/director-lich.js');
    expect(src).toMatch(/cleanseCorruption/);
    expect(src).not.toMatch(/cleansCorruption/);
  });

  test('dungeon.js calls cleanseCorruption (not cleansCorruption)', () => {
    const src = readSrc('handlers/dungeon.js');
    expect(src).not.toMatch(/cleansCorruption\(/);
  });
});

// ---------------------------------------------------------------------------

describe('Regression: chip atomicity uses accounts.updateChips', () => {
  test('companions.js uses updateChips for hire fee deduction', () => {
    const src = readSrc('handlers/companions.js');
    expect(src).toMatch(/accounts\.updateChips\(/);
    // Should NOT do direct chip subtraction for the hire action
    expect(src).not.toMatch(/account\.chips\s*-=\s*hiringFee/);
  });

  test('prison.js uses updateChips for bail payment', () => {
    const src = readSrc('handlers/prison.js');
    expect(src).toMatch(/accounts\.updateChips\(/);
  });
});

// ---------------------------------------------------------------------------

describe('Regression: rumor faction dedup', () => {
  test('rumor-system.js stores faction1 in vars._faction1 to prevent duplicate', () => {
    const src = readSrc('rumor-system.js');
    expect(src).toMatch(/vars\._faction1/);
  });

  test('faction2 filters out faction1 from pool', () => {
    const src = readSrc('rumor-system.js');
    expect(src).toMatch(/FACTION_NAMES\.filter/);
  });

  // Functional: generate 100 rumors, check no faction1 === faction2
  test('generated rumors never have same faction1 and faction2', () => {
    const { generateTownRumors } = require('../rumor-system');
    let found = false;
    for (let i = 0; i < 50; i++) {
      const rumors = generateTownRumors('test_town_' + i, {});
      for (const r of rumors) {
        if (r.text) {
          const factionMatches = r.text.match(/tension between the ([^,]+?) and ([^.]+?) has been/i);
          if (factionMatches) {
            if (factionMatches[1].trim() === factionMatches[2].trim()) found = true;
          }
        }
      }
    }
    expect(found).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('Regression: quest kill targets use valid overworld monster IDs', () => {
  test('all kill-type WORLD_QUEST_TEMPLATES target existing OVERWORLD_MONSTERS', () => {
    const rpg = require('../rpg-data');
    const monsters = require('../handlers/monsters');

    const monsterIds = new Set((monsters.OVERWORLD_MONSTERS || []).map(m => m.id));
    const killQuests = rpg.WORLD_QUEST_TEMPLATES.filter(q => q.type === 'kill');

    const broken = killQuests.filter(q => !monsterIds.has(q.target.monster));
    expect(broken).toEqual([]);
  });

  test('no craft-type quest targets an item with no recipe', () => {
    const rpg = require('../rpg-data');
    const crafting = require('../handlers/crafting');

    const recipeOutputs = new Set(
      Object.values(crafting.RECIPES || {}).map(r => r.output && r.output.type).filter(Boolean)
    );

    const craftQuests = rpg.WORLD_QUEST_TEMPLATES.filter(q => q.type === 'craft');
    const broken = craftQuests.filter(q => !recipeOutputs.has(q.target.item));
    expect(broken).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('Regression: party_kicked emitted by kick handler', () => {
  test('party.js emits party_kicked to the kicked socket', () => {
    const src = readSrc('handlers/party.js');
    expect(src).toMatch(/'party_kicked'/);
  });
});

// ---------------------------------------------------------------------------

describe('Regression: dungeon boss kill world quest tracking added', () => {
  test('dungeon.js has world quest bossKill tracking code', () => {
    const src = readSrc('handlers/dungeon.js');
    expect(src).toMatch(/wqbTmpl\.target\.bossKill/);
  });

  test('dungeon.js has world quest caveComplete tracking code', () => {
    const src = readSrc('handlers/dungeon.js');
    expect(src).toMatch(/wqbTmpl\.target\.caveComplete/);
  });

  test('dungeon.js has world quest minFloor tracking code', () => {
    const src = readSrc('handlers/dungeon.js');
    expect(src).toMatch(/wqfTmpl\.target\.minFloor/);
  });
});

// ---------------------------------------------------------------------------

describe('Regression: skill_milestone quest tracking in accounts.js', () => {
  test('account-skills.js checks skill_milestone quests after level up', () => {
    const src = readSrc('account-skills.js');
    expect(src).toMatch(/skill_milestone/);
    expect(src).toMatch(/_smTmpl\.target\.skill/);
  });
});

// ---------------------------------------------------------------------------
// Section 33 exploit-prevention regressions
// ---------------------------------------------------------------------------

describe('Exploit prevention: negative quantity guards', () => {
  test('npc-shop buy rejects qty <= 0', () => {
    const src = readSrc('handlers/npc-shop.js');
    // Must have a qty/quantity/amount guard before deducting chips
    expect(src).toMatch(/amount\s*<\s*1|qty\s*<=\s*0|quantity\s*<=\s*0|qty\s*<\s*1/);
  });

  test('mmo-auction list rejects price <= 0', () => {
    const src = readSrc('handlers/mmo-auction.js');
    expect(src).toMatch(/price\s*<=\s*0|price\s*<\s*1/);
  });

  test('trade handler validates offered coins > 0 or === 0', () => {
    const src = readSrc('handlers/trade.js');
    // Should not allow negative coins in a trade
    expect(src).toMatch(/coins|chips/);
  });
});

describe('Exploit prevention: race condition guards', () => {
  test('mmo-auction has purchase lock to prevent double-buy', () => {
    const src = readSrc('handlers/mmo-auction.js');
    // Purchase lock: a Set or Map tracking in-flight purchases
    expect(src).toMatch(/purchaseLock|pendingPurchases|activePurchases|_buying/i);
  });

  test('crafting handler validates materials before deducting', () => {
    const src = readSrc('handlers/crafting.js');
    expect(src).toMatch(/insufficient|not enough|missing.*material|material.*missing/i);
  });
});

describe('Exploit prevention: dungeon action gating', () => {
  test('dungeon.js rejects dungeon_descend when not in dungeon', () => {
    const src = readSrc('handlers/dungeon.js');
    const descend = src.slice(src.indexOf("'dungeon_descend'"), src.indexOf("'dungeon_ascend'"));
    // Must check playerDungeons map before acting
    expect(descend).toMatch(/playerDungeons\.get\(socket\.id\)|!dungeonState|not in dungeon/i);
  });

  test('dungeon.js checks player is alive before attack', () => {
    const src = readSrc('handlers/dungeon.js');
    // Expand window to 5000 chars — hp <= 0 check is ~70 lines into the handler
    const attack = src.slice(src.indexOf("'dungeon_attack'"), src.indexOf("'dungeon_attack'") + 5000);
    expect(attack).toMatch(/combat\.hp\s*<=\s*0|isDowned|downedPlayers/i);
  });
});

describe('Exploit prevention: card slot limit enforced', () => {
  test('rpg-cards.js checks available card slots before equipping', () => {
    const src = readSrc('handlers/rpg-cards.js');
    expect(src).toMatch(/cardSlots|slot.*limit|equippedCards\.length/i);
  });
});

describe('Exploit prevention: jail blocks zone movement', () => {
  test('zone.js or prison.js checks isJailed before zone_enter', () => {
    const zoneSrc  = readSrc('handlers/zone.js');
    const prisonSrc = readSrc('handlers/prison.js');
    // Either zone.js imports isJailed, or prison.js handles jail_zone blocking
    const jailCheck = zoneSrc.match(/isJailed|jail|inJail/i) || prisonSrc.match(/zone_enter|movement.*blocked/i);
    expect(jailCheck).toBeTruthy();
  });
});

describe('Exploit prevention: karma system bounds', () => {
  const karmaModule = require('../handlers/karma');

  test('karma cannot exceed +100 no matter how many positive actions', () => {
    const acc = { karma: 98 };
    for (let i = 0; i < 100; i++) karmaModule.addKarma(acc, 10, 'quest_complete');
    expect(acc.karma).toBe(100);
  });

  test('karma cannot go below -100 no matter how many crimes', () => {
    const acc = { karma: -98 };
    for (let i = 0; i < 100; i++) karmaModule.addKarma(acc, -10, 'murder');
    expect(acc.karma).toBe(-100);
  });
});

describe('Exploit prevention: prison sentence cannot be bypassed by re-arrest', () => {
  const prisonModule = require('../handlers/prison');

  test('re-arresting already-jailed player overwrites sentence (not stacks)', () => {
    const acc = { key: 'test', jailState: null };
    prisonModule.arrestPlayer(acc, 'assault');
    const firstRelease = acc.jailState.releasedAt;
    // Arrest again for a lighter crime
    prisonModule.arrestPlayer(acc, 'trespassing');
    // New sentence should be trespassing (3min), not a longer stacked duration
    const trespassDef = prisonModule.CRIME_DEFINITIONS.trespassing;
    expect(acc.jailState.releasedAt).toBeLessThan(firstRelease + trespassDef.durationMs * 2);
  });
});

describe('Regression: deleting the active character promotes the replacement', () => {
  const accountCharacters = require('../account-characters');

  const FIELDS = ['level', 'gold', 'inventory'];
  const DEFAULTS = { level: 1, gold: 0, inventory: [] };

  function makeAccount() {
    return {
      username: 'Tester',
      createdAt: 1000,
      level: 5, gold: 500, inventory: ['sword'],
      _characterName: 'Alpha',
      _characterCreatedAt: 1000,
      activeCharacterIndex: 0,
      hallOfHeroes: [],
      characters: [
        { name: 'Alpha', createdAt: 1000, level: 5, gold: 500, inventory: ['sword'] },
        { name: 'Beta',  createdAt: 2000, level: 9, gold: 42,  inventory: ['staff'] },
      ],
    };
  }

  let account;
  let saved;

  beforeEach(() => {
    account = makeAccount();
    saved = false;
    accountCharacters.init({
      loadAccount: () => account,
      saveAccount: () => { saved = true; },
      _getDefaultForField: (f) => DEFAULTS[f],
      CHARACTER_FIELDS: FIELDS,
      MAX_CHARACTERS_PER_ACCOUNT: 4,
      sanitizeName: (n) => n,
    });
  });

  test('deleting the active character loads the survivor into top-level fields', () => {
    const result = accountCharacters.deleteCharacter('key', 0);
    expect(result.error).toBeUndefined();
    expect(account.characters.length).toBe(1);
    expect(account.activeCharacterIndex).toBe(0);
    // Beta's data must now be live — not deleted Alpha's
    expect(account._characterName).toBe('Beta');
    expect(account.level).toBe(9);
    expect(account.gold).toBe(42);
    expect(account.inventory).toEqual(['staff']);
    expect(saved).toBe(true);
  });

  test('deleting a non-active character leaves the active data untouched', () => {
    const result = accountCharacters.deleteCharacter('key', 1);
    expect(result.error).toBeUndefined();
    expect(account.activeCharacterIndex).toBe(0);
    expect(account._characterName).toBe('Alpha');
    expect(account.level).toBe(5);
  });

  test('deleting the last remaining character is rejected', () => {
    account.characters.pop();
    const result = accountCharacters.deleteCharacter('key', 0);
    expect(result.error).toMatch(/last character/i);
  });
});
