// handlers/npc-loader.js
// Loads handcrafted NPC JSON files from data/npcs/ and provides the lore
// brain — a topic-based knowledge pool that lets NPCs discuss races,
// politics, world events, and local gossip with players.
//
// Usage:
//   var npcLoader = require('./npc-loader');
//   npcLoader.loadNpcs();                           // call once at startup
//   var enriched = npcLoader.enrichNpc(zoneNpc);    // merge JSON data
//   var topics   = npcLoader.getAvailableTopics(enriched);
//   var text     = npcLoader.getTopicResponse(enriched, 'event_rift', account);

var fs   = require('fs');
var path = require('path');

// ── NPC file registry ─────────────────────────────────────────────────────────
var NPC_DATA = {};   // id → full NPC object from JSON

function loadNpcs(npcDir) {
  npcDir = npcDir || path.join(__dirname, '..', 'data', 'npcs');
  if (!fs.existsSync(npcDir)) {
    fs.mkdirSync(npcDir, { recursive: true });
    return;
  }
  var files = fs.readdirSync(npcDir).filter(function(f) { return f.endsWith('.json'); });
  for (var i = 0; i < files.length; i++) {
    try {
      var raw  = fs.readFileSync(path.join(npcDir, files[i]), 'utf8');
      var data = JSON.parse(raw);
      var list = Array.isArray(data) ? data : [data];
      for (var j = 0; j < list.length; j++) {
        if (list[j].id) NPC_DATA[list[j].id] = list[j];
      }
    } catch(e) {
      console.warn('[npc-loader] Failed to load', files[i], ':', e.message);
    }
  }
}

// Merge zone NPC definition with handcrafted JSON data.
// Zone fields (id, name, x, y) win on conflict — they are the canonical
// world position. Extra fields (portrait, traits, lore, etc.) come from JSON.
function enrichNpc(npc) {
  var extra = NPC_DATA[npc.id];
  if (!extra) return npc;
  var merged = Object.assign({}, extra, npc);
  // Convert sleepStart/sleepEnd hours to sleepPhases array if not already set
  if (merged.sleepStart !== undefined && !merged.sleepPhases) {
    merged.sleepPhases = _hoursToPhases(merged.sleepStart, merged.sleepEnd != null ? merged.sleepEnd : 6);
  }
  return merged;
}

function getNpcData(id) { return NPC_DATA[id] || null; }

// Map hour-based schedule to the four world phases (night/dawn/day/dusk)
var PHASE_RANGES = [
  { phase: 'night', start: 22, end: 6  },   // 10pm → 6am  (wraps midnight)
  { phase: 'dawn',  start: 6,  end: 9  },
  { phase: 'day',   start: 9,  end: 18 },
  { phase: 'dusk',  start: 18, end: 22 },
];

function _hoursToPhases(sleepStart, sleepEnd) {
  var phases = [];
  for (var i = 0; i < PHASE_RANGES.length; i++) {
    var p = PHASE_RANGES[i];
    if (p.start > p.end) {
      // Overnight range (wraps midnight)
      if (sleepStart > p.start || sleepEnd <= p.end) phases.push(p.phase);
    } else {
      if (sleepStart < p.end && sleepEnd > p.start) phases.push(p.phase);
    }
  }
  return phases;
}

// ── Lore knowledge pool ───────────────────────────────────────────────────────
// Each topic has:
//   default   — generic response any NPC gives
//   role      — { roleName: "..." } overrides for specific NPC roles
//   race      — { raceName: "..." } overrides based on NPC's own race
//   unknown   — response when NPC doesn't know this topic (optional)

var KNOWLEDGE_POOL = {

  // ── Races ──────────────────────────────────────────────────────────────────

  race_human: {
    label: 'Humans',
    default: "Humans? Adaptable lot. They built most of what you see in the Dominion — or what's left of it after the rifts. The Dominion calls them the chosen race, which humans are more than happy to believe.",
    role: {
      guard:     "We keep the peace. Humans built this civilization and we defend it. Simple as that.",
      priest:    "Humanity was the architect of the Atlas and the cause of Calidar's fall. Five hundred years later we carry that debt. Humility is the only appropriate response.",
      innkeeper: "Most of my customers are human, so I find them agreeable enough. They tip about average.",
      sage:      "Humans are the youngest of the major races but the most politically dominant post-Atlas. Their short lives breed ambition that older races sometimes lack.",
      orc_npc:   "Humans call themselves civilized. They destroyed a city with a divine weapon and called it justice. I call it convenient.",
    },
    race: {
      elf:       "Your kind is... energetic, I'll grant you that. Quick to build, quick to tear down. Five centuries feels like a heartbeat to me — your whole Dominion rose and wobbled in what I'd call a long nap.",
      orc:       "Humans claimed dominion over us when their Dominion was young. We've outlasted every empire they've named. We'll outlast this one too.",
    },
  },

  race_elf: {
    label: 'Elves',
    default: "Elves live long enough to see their own mistakes come back around. That tends to make them careful — or bitter, depending on the elf. Most are concentrated in the northern forests now. Calidar's fall hit them hard.",
    role: {
      priest:    "Elves and Dark Elves once shared Calidar. The Vel'sharath sought the absent gods through research. The Reclamation Sect sought divine punishment for humanity. Heaven's Atlas ended both movements — and the city. The tragedy is that neither side survived to see whether they were right.",
      sage:      "Elven lifespan breeds a particular kind of patience. They remember the world before the Atlas. Some remember Calidar as it stood. That living memory makes them invaluable — and sometimes unbearable to speak with.",
      guard:     "Elves I've worked with are steady soldiers. Long memory, longer grudges. Just don't bring up Calidar unless you want a very long evening.",
      merchant:  "Elven crafted goods are rare and expensive. They don't rush anything. A commission to an elven smith might arrive after you're dead.",
    },
    race: {
      elf:       "We remember Calidar. Not as history — as loss. The forests we have now are beautiful, yes. They are not what we had.",
      darkelf:   "Our kin scattered after the Atlas. Most went north. We went... elsewhere. We do not speak of it lightly.",
      human:     "I've dealt with elves since I was young. Patient, precise, occasionally infuriating. But they built things that lasted, which is more than most of my kin managed.",
    },
  },

  race_orc: {
    label: 'Orcs',
    default: "Orcs settled the eastern highlands long before the Dominion existed. They're clannish, tough, and have very long memories when it comes to being underestimated. Picking a fight with an orc clan over a misunderstanding tends to be a short story.",
    role: {
      guard:    "Good fighters if they're on your side. Most orc clans keep to their own lands and cause no trouble. The ones that come to town usually want trade, not conflict.",
      innkeeper:"Orcs tend to drink heavily and tip generously. They're welcome here as long as they don't break the chairs.",
      sage:     "Orc oral tradition preserves pre-Atlas history with surprising accuracy. Their scholars — they call them Memory-Keepers — have records of the world as it was before Calidar fell.",
    },
    race: {
      orc:  "Clan comes first. Always has, always will. The Dominion tried to incorporate us for two hundred years and never quite managed it. We're still here.",
      human:"Orcs are proud and I respect that. The Dominion has never had an easy relationship with them, which is mostly our fault.",
    },
  },

  race_dwarf: {
    label: 'Dwarves',
    default: "Dwarves have lived underground since before anyone was keeping records. The rifts trouble them more than most — the secondary rifts have been opening in cave systems, which is essentially their front doorstep.",
    role: {
      blacksmith: "My craft came from dwarf tradition. Not directly — I never studied under one. But the techniques trace back. They knew stone and metal before the rest of us figured out bronze.",
      guard:      "Dwarven tunnel-guards are nothing to laugh at. Deep roads, tight quarters, dark. They're built for it.",
      sage:       "Dwarf rune-engineering predates human writing. They built things under the mountains that still function five hundred years later. The Dominion borrows from their techniques constantly, without acknowledgment.",
    },
    race: {
      dwarf: "The deeps are getting dangerous. Rifts opening below the third tier, things coming through that shouldn't exist. It's a problem we'd appreciate more help addressing.",
    },
  },

  race_gnome: {
    label: 'Gnomes',
    default: "Gnomes are organized — almost aggressively so. They run council-states rather than kingdoms, debate everything in writing, and produce more official documents per capita than any other race. They're also curious almost to the point of danger.",
    role: {
      sage:      "Gnomish scholars contributed significantly to what we know about pre-Atlas cosmology. Their council transcripts from Year 499 are some of the most precise records of the period just before — and just after — the rifts began multiplying.",
      merchant:  "Gnomish trade agreements are ironclad and extremely detailed. Read every clause. Twice.",
      innkeeper: "Gnome travelers always have exact coin, always ask about the local pest situation, and always leave the room in better condition than they found it. Ideal guests.",
    },
  },

  race_goblin: {
    label: 'Goblins',
    default: "Goblins adapt faster than any other race — city, wilderness, underground, it doesn't matter. They're survivors. The Dominion classified them as a problem race for two centuries before quietly relying on their labor to keep half its aqueducts running.",
    role: {
      guard:     "Goblins. Clever. Opportunistic. Usually harmless unless cornered or hungry. Or bored.",
      merchant:  "Goblin traders are sharp. Don't let the size fool you — they'll find your blind spot in a negotiation faster than you can blink.",
      sage:      "Goblin ecological knowledge is unparalleled. They understand biomes, creature behavior, and resource distribution better than any formal institution I've studied at. They just don't write most of it down.",
    },
  },

  race_lizardfolk: {
    label: 'Lizard Folk',
    default: "Lizard Folk are older than the Dominion, older than the Atlas disaster, possibly older than the gods' active involvement in this world. They don't tend to care much about politics unless it floods their swamps.",
    role: {
      sage:    "Lizard Folk record history through scale-patterns and ritual song rather than text. Linguists who can interpret their oldest traditions believe they have accounts of the world from before any of the current races emerged as dominant powers.",
      priest:  "Lizard Folk worship is oriented toward ancestor spirits, not gods. They find our theological arguments somewhat baffling, from what I've been told.",
      guard:   "Long-lived, calm under pressure, good eyesight. I'd recruit more of them if they'd take the posting.",
    },
  },

  race_catfolk: {
    label: 'Cat Folk',
    default: "Cat Folk turn up everywhere — merchants, wanderers, hired swords, thieves. They don't form large nations, preferring loose networks of clans connected by trade and bloodline. Their luck is legendary enough that some people won't gamble with them.",
    role: {
      merchant:  "Cat Folk are the most mobile trading partners I deal with. Routes change constantly, goods are eclectic, but the luck factor is real — I've never seen one take a genuinely bad deal.",
      innkeeper: "They always check every room before settling, and they sleep in odd positions, but they're good company. Storytellers.",
      guard:     "Fast. Preternaturally aware of their surroundings. I'd say uncanny but they'd take it as a compliment.",
    },
    race: {
      catfolk: "We go where we're needed. Or where it's interesting. Usually both, if we're lucky — which we are.",
    },
  },

  race_darkelf: {
    label: 'Dark Elves',
    default: "Dark Elves are near-extinct now. Calidar was their joint capital with the High Elves — the Atlas destroyed it. Most accounts say only scattered clans survived, hidden deep in places the Dominion hasn't reached. You're unlikely to encounter one.",
    role: {
      priest: "The Reclamation Sect was Dark Elven in composition. They believed the gods would punish humanity for its hubris. Heaven's Atlas fell before their petition was answered — or perhaps it was the answer. The theology of that event is... contested.",
      sage:   "Whatever records the Dark Elves kept of their pre-Atlas civilization were lost with Calidar. We have only what the High Elves remember, filtered through five centuries of grief, and a handful of recovered Vel'sharath documents.",
    },
  },

  // ── Factions / Politics ───────────────────────────────────────────────────

  faction_dominion: {
    label: 'The Holy Dominion',
    default: "The Dominion has controlled most of the continent since the Atlas. They frame it as divine mandate — protecting humanity in the gods' absence. Critics call it an empire that learned to use religious language. Both things can be true.",
    role: {
      guard:     "The Dominion gives us order. The rifts give us purpose. I don't ask more than that.",
      priest:    "The Dominion's founding theology is sound in places and strained in others. They claim mandate from Helios — but Helios has been sealed below Solara Cathedral for five hundred years. A mandate from a dormant god is... interpretable.",
      merchant:  "The Dominion controls the major trade routes. You work within their system or you work in the margins. Most of us work within the system.",
      sage:      "Post-Atlas, the Dominion moved to fill a power vacuum. That's historically accurate. Whether the specific framing they chose — divine mandate, human exceptionalism — served the population well is a separate question.",
    },
    race: {
      orc:   "The Dominion is a human institution dressed in religious robes. We've watched it from the outside. It's efficient and it's useful and we don't trust it.",
      elf:   "They carry the weight of what humans did to Calidar. Some of their priests understand this. Most prefer not to discuss it.",
    },
  },

  faction_freeholds: {
    label: 'The Free Holds',
    default: "The Free Holds — officially 'The Free Holds of Stone' — are loosely governed territories that never fully accepted Dominion authority. Mostly dwarf clans, independent human settlements, and mixed communities in the highlands. More freedom, less infrastructure.",
    role: {
      merchant:  "Trade in the Free Holds is harder to navigate — no single trade authority, twenty different local customs — but the margins are better if you know the routes.",
      guard:     "The Free Holds don't have a standing army. They have a lot of people who know the terrain very well and are willing to defend it. Functionally similar.",
      innkeeper: "Travelers from the Free Holds tend to have better stories. They've actually seen things the Dominion doesn't officially acknowledge.",
    },
  },

  // ── World Events ──────────────────────────────────────────────────────────

  event_rift: {
    label: 'The Rift',
    default: "The Rift sits where Solara's Cathedral District stood — where the Dominion warrior deployed Heaven's Atlas, five hundred years ago. It's a spatial tear, a wound in the world. Things come out of it. Dungeon floors extend from it. Secondary rifts have been spreading across the continent for decades now.",
    role: {
      guard:    "The Rift is why we exist in the current form. Every generation produces people brave or foolish enough to go in. Some come back changed. Some don't come back.",
      priest:   "Theologically, the Rift is the divine punishment placed at the site of the Atlas deployment. The god who placed it — the Dark Elven deity — has not communicated since. Whether that means it is completed or ongoing is something we argue about weekly.",
      sage:     "The Rift's internal geometry doesn't follow our physics. Floors don't correspond to physical depth. Time is irregular. We've documented entities inside it — we call them the Hollow — that seem to occupy multiple forms simultaneously.",
      innkeeper:"Everyone who goes into the Rift needs a drink first and a meal when they come back. I have a regular relationship with the Rift. Professional, you understand.",
    },
  },

  event_atlas: {
    label: "Heaven's Atlas",
    default: "Heaven's Atlas was a Dominion weapon — divine in origin, catastrophic in effect. Deployed five hundred years ago against Calidar, the joint elven capital, it destroyed the city and everyone in it. Two movements of scholars and radicals, gone. The Rift opened at the deployment site as punishment.",
    role: {
      priest:  "The Atlas was not sanctioned by any living god. The Dominion soldier who deployed it was punished — we believe he still exists inside the Rift, changed by it. The Rift is the response from the divine. Five centuries of it.",
      sage:    "We don't know the Atlas's full mechanism. The Dominion destroyed most records of its construction. What we know comes from survivors and what was preserved in Vel'sharath documents.",
    },
    race: {
      elf:     "I know what the Atlas did. I had family in Calidar. I speak of it only when I must.",
      darkelf: "The Atlas silenced both our voices — the Vel'sharath who studied, the Reclamation Sect who petitioned. Neither had time to be wrong or right. We were simply gone.",
    },
  },

  event_calidar: {
    label: 'Calidar',
    default: "Calidar was the joint High Elven and Dark Elven capital — a city built in a desert oasis, remarkable for existing at all given the climate. It housed two movements: the Vel'sharath, who researched the absence of gods, and the Reclamation Sect, who wanted divine punishment for humanity. Heaven's Atlas destroyed both.",
    role: {
      priest:  "The Vel'sharath were not villains. They used something called the Lesser Lens to try to locate absent gods. Curiosity, not malice. The Reclamation Sect were angrier but their grievance was real. Neither deserved what happened.",
      sage:    "Pre-Atlas Calidar was architecturally and intellectually one of the most significant cities in recorded history. We have fragments. Documents the Vel'sharath left behind. Accounts from survivors who fled before the strike. It is not enough.",
    },
  },

  event_soldier: {
    label: 'The Soldier',
    default: "The Soldier — no one uses his name, if he had one — was the Dominion warrior who deployed Heaven's Atlas against Calidar. As punishment, a Dark Elven deity trapped him inside the Rift. Five hundred years later, accounts say he's still in there. Immortal. Changed. Pushing fragments of himself out through the secondary rifts.",
    role: {
      priest:  "He was sent inside to retrieve five divine beings — what we call the Five Souls. He found them, according to recovered accounts, at the twenty-fifth floor. Then the god took them back and left divine fragments embedded in his limbs and head instead. He cannot die. He cannot leave. He is trying to reach Helios, below Solara Cathedral.",
      sage:    "The Soldier is the most documented entity inside the Rift for which we have first-person accounts. His descriptions of the Hollow, the Rift's internal logic, and the behavior of divine fragments are the closest thing we have to Rift science.",
      guard:   "There's a story about a Dominion soldier stuck in the Rift since Year Zero. Some of my men take it literally. Some take it as a warning about obedience to unjust orders.",
    },
  },

  event_helios: {
    label: 'Helios',
    default: "Helios is the name given to a demi-god — half divine parent, half mortal mother — sealed below Solara Cathedral at Year Zero. He's not dead, from what the priests say, but barely alive. Unconscious. Unreachable. The Dominion considers him significant enough to protect the site.",
    role: {
      priest:  "Helios is why the Cathedral still stands. He is not a god but carries divine essence that could, in theory, be restored. Whether restoration would benefit anyone is debated — a newly awakened divine being of uncertain disposition, in a world that's changed greatly in his absence, is not obviously a solution to our problems.",
      sage:    "The theology around Helios is the most politically charged topic in the Dominion. He's simultaneously a symbol of hope, a point of vulnerability, and a potential liability. The Cathedral District sits atop the Rift's entry point. The architecture of that problem is not accidental.",
    },
  },

  event_hollow: {
    label: 'The Hollow',
    default: "The Hollow are what lives inside the Rift — entities that look like people or creatures but aren't quite. Empty eyes. They can shift between species mid-movement. Descriptions sound wrong even when they're clear. Most dungeon explorers report encountering them on the deeper floors.",
    role: {
      guard:  "I tell my recruits: if the eyes are empty, don't try to talk to it. Don't try to reason with it. You move back to the stairwell and you come back with more people.",
      sage:   "The Hollow appear to be the original inhabitants of whatever space the Rift occupies — or things that became what they are through long exposure to Rift conditions. They seem to perceive us the way we perceive them: as wrong. Deeply wrong.",
      priest: "Whether the Hollow have souls is a question the Church has not officially answered. That silence has been very useful to everyone who wishes to fight them without moral complication.",
    },
  },

  // ── Magic & Lore ──────────────────────────────────────────────────────────

  topic_magic: {
    label: 'Magic',
    default: "Magic still works — barely. After the Atlas and the rifts, something in the world's deeper structure shifted. Raw spellcasting is less reliable than it was. Most magic now runs through items, runes, or the card system the Sanctum developed as a workaround.",
    role: {
      sage:    "Pre-Atlas magic was significantly more powerful and stable than what we work with now. The Vel'sharath in Calidar were researching the connection between divine absence and magical degradation. We don't know what they found.",
      healer:  "Healing magic works but takes more out of the caster than it should. I use it sparingly and supplement with herbs. Old practitioners say it wasn't always like this.",
      priest:  "The Church teaches that magic operates through divine permission. The gods' absence explains magical instability. Skeptics say the Atlas damaged something structural in the world that has nothing to do with permission.",
    },
  },

  topic_magic_ban: {
    label: 'The Magic Restrictions',
    default: "The Dominion maintains restrictions on certain categories of magic — primarily anything that interacts with divine essence, rift phenomena, or mass-scale destruction. Officially this is public safety. Unofficially, the list of restricted magic overlaps suspiciously with things that could threaten the Dominion's authority.",
    role: {
      priest:  "The Church supports the restrictions. After Heaven's Atlas, unrestricted access to divine-adjacent magic seems genuinely dangerous. I understand why people resent it. I also understand why cities that existed near unrestricted practitioners no longer exist.",
      sage:    "The magic ban categorically restricts research into the Lesser Lens — the tool the Vel'sharath used to try locating absent gods. The fact that the ban specifically targets that mechanism suggests someone knows more about what it does than they're admitting.",
    },
  },

  lore_gods: {
    label: 'The Gods',
    default: "The gods are absent. Have been for as long as anyone can confirm through reliable records. The Dominion teaches they're watching but not intervening. The Dark Elven theology held that they could be petitioned. The Vel'sharath thought they could be found. None of these groups are around to tell us how it went.",
    role: {
      priest:  "Absence is not the same as nonexistence. We have evidence of divine action — the Rift itself, the punishment of the Soldier, the sealing of Helios. Something responded. Whether those things are still responding, and to what, is the central question of my faith.",
      sage:    "Divine entities demonstrably exist — Helios is one, and is documented. What we call 'gods' are a higher tier whose absence we cannot fully explain. The working hypothesis is that something happened that caused or required that absence. We don't know what.",
    },
  },

  lore_fortuna: {
    label: 'Fortuna — The Continent',
    default: "This continent is called Fortuna. The Dominion calls it 'The Enlightened Continent,' which is the kind of name an empire gives a place when it wants to imply ownership. The rest of us usually just say Fortuna.",
    role: {
      sage:     "Fortuna's geography shifted noticeably after the Atlas. The desert where Calidar stood expanded. The rift zone around Solara altered local weather patterns. Secondary rifts have been slowly reshaping terrain across the continent for decades.",
      innkeeper:"This is home. Best food, worst weather, most interesting strangers. I wouldn't trade it.",
    },
  },

  lore_year500: {
    label: 'The Current Era',
    default: "Year 500 Post-Atlas. Five centuries since Calidar fell and the Rift opened. The Dominion calls it a golden age. The secondary rifts spreading across the continent suggest a more complicated picture. We manage.",
    role: {
      priest:  "Year 500 feels significant theologically. Five centuries is long enough for myths to calcify into doctrine and for doctrine to calcify into politics. I try to keep the actual theological questions alive underneath the official positions.",
      sage:    "The rift expansion rate has been accelerating over the past forty years. If the trend holds, Year 550 will look very different from today. The Dominion's current posture assumes stability. Stability is not guaranteed.",
      guard:   "Five hundred years of keeping things together. I respect that, even if the people at the top haven't always deserved it.",
    },
  },

  // ── Local knowledge ───────────────────────────────────────────────────────

  rumor_local: {
    label: 'Local Rumours',
    default: "There are always stories. Travelers through here mention secondary rifts opening north of the pass — not confirmed, but three different people said it. Also, the miller's apprentice claims he saw something with empty eyes near the old mill road after dark. He's seventeen and prone to dramatics, but.",
    role: {
      innkeeper: "This is where I earn my living, stranger. Sit down, let me pour you something, and I'll tell you everything I've heard in the past week. Most of it's probably true.",
      merchant:  "I hear things between towns. The rift situation north of here is getting serious enough that some traders are going around rather than through. Adds three days but they say it's worth it.",
      guard:     "Officially I can't share patrol reports. Unofficially: don't walk the east road after dusk alone until further notice.",
    },
  },

  directions: {
    label: 'Travel & Directions',
    default: "Where are you headed? I know the local roads well enough. The Dominion keeps the main routes maintained — secondary roads are another matter, especially near rift activity.",
    role: {
      innkeeper: "I've heard enough travelers' routes that I've become a decent map in my own right. Tell me where you're going.",
      guard:     "Safe routes currently: north road, south road below the ridge. East road is subject to patrol restriction, don't ask me why, I'm following orders I wasn't given reasons for.",
      merchant:  "I know every shortcut between here and the major trade hubs. Some of them are technically on private land. You didn't hear that from me.",
    },
  },
};

// ── Topic access by role ───────────────────────────────────────────────────────
// Default topics a NPC knows based on their role, even without a handcrafted JSON.
var ALL_TOPICS = Object.keys(KNOWLEDGE_POOL);

var ROLE_TOPICS = {
  innkeeper:   ['rumor_local', 'directions', 'race_human', 'race_elf', 'race_orc', 'race_dwarf', 'race_goblin', 'race_catfolk', 'event_rift', 'lore_fortuna', 'lore_year500'],
  blacksmith:  ['directions', 'rumor_local', 'topic_magic', 'race_dwarf', 'faction_freeholds'],
  merchant:    ['directions', 'rumor_local', 'faction_dominion', 'faction_freeholds', 'race_human', 'race_gnome', 'race_catfolk'],
  guard:       ['faction_dominion', 'directions', 'event_rift', 'race_human', 'event_soldier'],
  healer:      ['topic_magic', 'lore_gods', 'event_atlas', 'race_human', 'race_elf', 'event_hollow'],
  banker:      ['faction_dominion', 'faction_freeholds', 'directions', 'rumor_local'],
  quest_giver: ['event_rift', 'event_soldier', 'rumor_local', 'event_hollow', 'lore_year500'],
  sage:        ALL_TOPICS,
  priest:      ['lore_gods', 'event_atlas', 'event_helios', 'topic_magic_ban', 'event_calidar', 'event_soldier', 'race_darkelf', 'faction_dominion', 'topic_magic', 'lore_year500'],
  farmer:      ['rumor_local', 'directions', 'lore_fortuna'],
  civilian:    ['rumor_local', 'directions'],
  thief:       ['rumor_local', 'faction_dominion', 'directions'],
  knight:      ['faction_dominion', 'event_rift', 'event_soldier', 'race_human', 'race_orc', 'lore_year500'],
  ranger:      ['directions', 'rumor_local', 'event_rift', 'event_hollow', 'lore_fortuna', 'race_orc', 'race_lizardfolk'],
  wizard:      ['topic_magic', 'topic_magic_ban', 'event_atlas', 'lore_gods', 'race_elf', 'race_darkelf', 'event_calidar'],
};

// ── Public API ────────────────────────────────────────────────────────────────

// Return list of topic objects this NPC is willing to discuss.
function getAvailableTopics(npc) {
  var topics = [];
  // Handcrafted JSON may list explicit knowledge topics
  var known = (npc.knowledge && npc.knowledge.length) ? npc.knowledge
    : (ROLE_TOPICS[npc.role] || ROLE_TOPICS[npc.type] || ROLE_TOPICS.civilian);
  for (var i = 0; i < known.length; i++) {
    var topicId = known[i];
    var topicDef = KNOWLEDGE_POOL[topicId];
    if (topicDef) {
      topics.push({ id: topicId, label: topicDef.label });
    }
  }
  return topics;
}

// Return the NPC's response text for a given topic.
// Prioritises: handcrafted knowledge[topic] → role variant → race variant → default → unknown.
function getTopicResponse(npc, topicId, account) {
  var topicDef = KNOWLEDGE_POOL[topicId];
  if (!topicDef) return "I don't know much about that.";

  // Check if NPC knows the topic at all
  var known = (npc.knowledge && npc.knowledge.length) ? npc.knowledge
    : (ROLE_TOPICS[npc.role] || ROLE_TOPICS[npc.type] || ROLE_TOPICS.civilian);
  if (known !== ALL_TOPICS && known.indexOf(topicId) === -1) {
    return topicDef.unknown || "That's not something I know about, I'm afraid.";
  }

  // 1. Handcrafted per-topic text in NPC's own JSON takes priority
  if (npc.knowledge && typeof npc.knowledge === 'object' && !Array.isArray(npc.knowledge)) {
    var custom = npc.knowledge[topicId];
    if (typeof custom === 'string') return custom;
  }

  // 2. Role variant
  var role = npc.role || npc.type || '';
  if (topicDef.role && topicDef.role[role]) return topicDef.role[role];

  // 3. Race variant (NPC's own race)
  var race = npc.race || '';
  if (topicDef.race && topicDef.race[race]) return topicDef.race[race];

  // 4. Trait-flavored prefix (brave/scholarly/gruff etc.)
  var base = topicDef.default || "I have little to say on that.";
  return _applyVoiceTone(base, npc.voiceTone, npc.traits);
}

// Lightly modify response delivery based on voice tone / traits.
// Does NOT change the lore content — only framing words.
function _applyVoiceTone(text, voiceTone, traits) {
  if (!voiceTone && (!traits || !traits.length)) return text;
  traits = traits || [];

  var prefix = '';
  if (voiceTone === 'gruff')      prefix = '';   // gruff NPCs just say it
  if (voiceTone === 'scholarly')  prefix = 'If you want the accurate version: ';
  if (voiceTone === 'warm')       prefix = 'Happy to share what I know. ';
  if (voiceTone === 'mysterious') prefix = 'An interesting question. ';
  if (voiceTone === 'weary')      prefix = 'I\'ve been asked this before. ';
  if (voiceTone === 'nervous')    prefix = 'I\'m not really supposed to talk about this, but — ';
  if (voiceTone === 'boisterous') prefix = 'Now THAT\'s a topic! ';
  if (voiceTone === 'cold')       prefix = '';

  if (!prefix && traits.indexOf('gossip') !== -1)   prefix = 'Between you and me — ';
  if (!prefix && traits.indexOf('paranoid') !== -1)  prefix = 'Keep your voice down. ';
  if (!prefix && traits.indexOf('scholarly') !== -1) prefix = 'Technically speaking: ';

  return prefix + text;
}

module.exports = {
  loadNpcs,
  enrichNpc,
  getNpcData,
  getAvailableTopics,
  getTopicResponse,
};
