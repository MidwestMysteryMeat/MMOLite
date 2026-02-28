// ---------------------------------------------------------------------------
// NPC Dialogue Trees
// Extracted from rpg-data.js — zero coupling to any other module.
// ---------------------------------------------------------------------------

const NPC_DIALOGUES = {
  // Each NPC gets a dialogue tree keyed by npcId
  // Nodes: { text, choices: [{ label, nextNode, condition?, action? }] }

  npc_solara_priest: {
    start: {
      text: 'Blessings of the Light upon you, traveler. The Cathedral watches over all who seek guidance.',
      choices: [
        { label: 'Can you heal me?', nextNode: 'heal' },
        { label: 'Tell me about the Cathedral.', nextNode: 'lore_cathedral' },
        { label: 'Any tasks that need doing?', nextNode: 'quest_hook' },
        { label: 'Farewell.', nextNode: null },
      ],
    },
    heal: {
      text: 'Of course. Let the Light mend your wounds.',
      choices: [{ label: 'Thank you.', nextNode: null }],
      action: 'heal',
    },
    lore_cathedral: {
      text: 'The Solara Cathedral has stood for five centuries, built over the ruins of the old human capital. They say something ancient sleeps beneath its foundations... but such talk is discouraged.',
      choices: [
        { label: 'What sleeps beneath?', nextNode: 'lore_helios', condition: { type: 'skill', skill: 'magic', minLevel: 10 } },
        { label: 'I understand. Farewell.', nextNode: null },
      ],
    },
    lore_helios: {
      text: 'You have the gift of arcane sight, I see. There are whispers of a demi-god — Helios — sealed below. Drained of essence, barely alive. The Dominion forbids all access.',
      choices: [{ label: 'Interesting... farewell.', nextNode: null }],
    },
    quest_hook: {
      text: 'The outer farms report strange creatures at night. Herbs are running low for the wounded. Could you gather some for us?',
      choices: [
        { label: 'I\'ll gather herbs for you.', nextNode: 'quest_accept_herbs', action: 'give_quest', questId: 'wq_gather_herbs' },
        { label: 'Not right now.', nextNode: null },
      ],
    },
    quest_accept_herbs: {
      text: 'Bless you. Bring me 10 herbs and I shall reward you well.',
      choices: [{ label: 'On my way.', nextNode: null }],
    },
  },

  npc_solara_quartermaster: {
    start: {
      text: 'Imperial Quartermaster at your service. Finest goods in the Dominion.',
      choices: [
        { label: 'Show me your wares.', nextNode: null, action: 'open_shop' },
        { label: 'What\'s the latest news?', nextNode: 'gossip' },
        { label: 'Farewell.', nextNode: null },
      ],
    },
    gossip: {
      text: 'Trade caravans from Ironhold have been delayed. Something about creatures in the mountain passes. Prices on metals might go up.',
      choices: [{ label: 'Good to know.', nextNode: null }],
    },
  },

  npc_card_merchant: {
    start: {
      text: 'Ah, a collector! Elara Brightscroll, dealer in rare and powerful cards. What can I do for you?',
      choices: [
        { label: 'Browse cards.', nextNode: null, action: 'open_card_shop' },
        { label: 'How does card fusion work?', nextNode: 'fusion_info' },
        { label: 'Farewell.', nextNode: null },
      ],
    },
    fusion_info: {
      text: 'Combine two cards of the same rarity to create one of higher rarity. But beware — each card can only be fused twice in its lineage. Effects stack with a 5% bonus per fusion level.',
      choices: [
        { label: 'Show me your cards.', nextNode: null, action: 'open_card_shop' },
        { label: 'Thanks for the tip.', nextNode: null },
      ],
    },
  },

  guild_master: {
    start: {
      text: 'Welcome to the Adventure Guild. I am Guildmaster Aldric. Rift explorers, dungeon delvers, and glory seekers — all find purpose here.',
      choices: [
        { label: 'I want to join the guild.', nextNode: 'join', condition: { type: 'no_guild' } },
        { label: 'Tell me about the Rift.', nextNode: 'rift_info' },
        { label: 'Check my guild rank.', nextNode: 'rank_check', condition: { type: 'has_guild' } },
        { label: 'Farewell.', nextNode: null },
      ],
    },
    join: {
      text: 'Eager, are you? Membership costs 50 coins. You\'ll start as Stone rank. Prove yourself in the Rift to rise through the ranks.',
      choices: [
        { label: 'I\'ll join. (50 coins)', nextNode: 'joined', action: 'guild_join' },
        { label: 'I\'ll think about it.', nextNode: null },
      ],
    },
    joined: {
      text: 'Welcome aboard, Stone rank. Check the Quest Board for daily assignments. The Rift awaits.',
      choices: [{ label: 'Thank you, Guildmaster.', nextNode: null }],
    },
    rift_info: {
      text: 'The Rift is a spatial tear near the old capital. It changes daily — new layouts, new dangers. Floors get harder the deeper you go. Boss floors every 10th level. Camp wisely.',
      choices: [
        { label: 'What ranks can I achieve?', nextNode: 'ranks_info' },
        { label: 'Got it.', nextNode: null },
      ],
    },
    ranks_info: {
      text: 'Ten ranks: Stone, Copper, Iron, Silver, Gold, Platinum, Mithril, Orichalcum, Adamantine, and Relic. Each rank unlocks deeper floors and better daily quests.',
      choices: [{ label: 'I\'ll aim for the top.', nextNode: null }],
    },
    rank_check: {
      text: 'Let me check the records...',
      choices: [{ label: 'Thanks.', nextNode: null }],
      action: 'show_rank',
    },
  },

  npc_sylvaris_elder: {
    start: {
      text: 'The ancient woods welcome you. I am Elder Thalindra of Sylvaris. The trees remember what mortals forget.',
      choices: [
        { label: 'What do the trees remember?', nextNode: 'lore_trees' },
        { label: 'Do you have work for me?', nextNode: 'quest_hook' },
        { label: 'Farewell, Elder.', nextNode: null },
      ],
    },
    lore_trees: {
      text: 'They remember Calidar — the great oasis city that burned five centuries ago. Elves and Dark Elves once shared that jewel. Now it is ash and sand, and the Dark Elves are all but gone.',
      choices: [
        { label: 'What happened to the Dark Elves?', nextNode: 'lore_dark_elves', condition: { type: 'race', race: 'elf' } },
        { label: 'A sad tale.', nextNode: null },
      ],
    },
    lore_dark_elves: {
      text: 'Scattered to the winds. Some say a handful survive in the deepest caves. They were not all guilty of what the Reclamation Sect did... but Heaven\'s Atlas did not discriminate.',
      choices: [{ label: 'I see. Thank you.', nextNode: null }],
    },
    quest_hook: {
      text: 'The forest spirits are restless. Strange mushrooms have appeared near the southern groves. Bring me 5 mushrooms so I may study them.',
      choices: [
        { label: 'I\'ll investigate.', nextNode: 'quest_accept_mushroom', action: 'give_quest', questId: 'wq_gather_mushrooms' },
        { label: 'Perhaps later.', nextNode: null },
      ],
    },
    quest_accept_mushroom: {
      text: 'Be careful near the groves. Return when you have gathered five.',
      choices: [{ label: 'I\'ll return soon.', nextNode: null }],
    },
  },

  npc_ironhold_forgemaster: {
    start: {
      text: 'Hail! Forgemaster Grumdin of Ironhold. My anvil sings louder than any bard.',
      choices: [
        { label: 'Show me your shop.', nextNode: null, action: 'open_shop' },
        { label: 'I need something crafted.', nextNode: 'crafting_info' },
        { label: 'Tell me about Ironhold.', nextNode: 'lore_ironhold' },
        { label: 'Farewell.', nextNode: null },
      ],
    },
    crafting_info: {
      text: 'Bring me the materials and I\'ll make it sing. Iron bars, bronze bars, even mithril if you\'ve the skill. Higher crafting skill means better results.',
      choices: [{ label: 'Good to know.', nextNode: null }],
    },
    lore_ironhold: {
      text: 'Built into the mountain itself, Ironhold has never fallen to siege. Our stone-born artisans craft the finest weapons on Fortuna. Even the Dominion buys our steel.',
      choices: [{ label: 'Impressive.', nextNode: null }],
    },
  },

  npc_kragmor_warchief: {
    start: {
      text: 'Outsider. You stand in Kragmor, heart of the Khanate. Speak your purpose.',
      choices: [
        { label: 'I seek trade.', nextNode: null, action: 'open_shop' },
        { label: 'I want to prove my strength.', nextNode: 'strength' },
        { label: 'Tell me of the Khanate.', nextNode: 'lore_khanate' },
        { label: 'I mean no trouble. Farewell.', nextNode: null },
      ],
    },
    strength: {
      text: 'Strength is proven in battle, not words. The wilds around Kragmor are full of beasts. Bring me 3 boss trophies and the Khanate will respect you.',
      choices: [
        { label: 'Consider it done.', nextNode: 'quest_accept_trophies', action: 'give_quest', questId: 'wq_collect_trophies' },
        { label: 'Another time.', nextNode: null },
      ],
    },
    quest_accept_trophies: {
      text: 'We shall see. Return with proof.',
      choices: [{ label: 'I will.', nextNode: null }],
    },
    lore_khanate: {
      text: 'The Orcish Khanate has endured since before the Atlas fell. We answer to no Dominion. Our warriors are the strongest on Fortuna.',
      choices: [{ label: 'Formidable.', nextNode: null }],
    },
  },

  npc_bonetrap_dealer: {
    start: {
      text: '*hisses* Welcome to BoneTrap, fleshling. Best prices you\'ll find... if you don\'t ask where the goods came from.',
      choices: [
        { label: 'Show me what you\'ve got.', nextNode: null, action: 'open_shop' },
        { label: 'I need information.', nextNode: 'info' },
        { label: 'This place gives me the creeps. Bye.', nextNode: null },
      ],
    },
    info: {
      text: 'Information costs coin, friend. But I\'ll give you one for free: the tunnels beneath BoneTrap connect to places even goblins fear to tread. Dark things stir below.',
      choices: [
        { label: 'What dark things?', nextNode: 'dark_things', condition: { type: 'skill', skill: 'lockpicking', minLevel: 5 } },
        { label: 'I\'ll be careful.', nextNode: null },
      ],
    },
    dark_things: {
      text: 'Undead, mostly. But lately... something else. Creatures with hollow eyes that shift shape. The Hollow, some call them. Stay out of the deep tunnels.',
      choices: [{ label: 'Noted.', nextNode: null }],
    },
  },

  npc_murkmire_shaman: {
    start: {
      text: '*the air is thick with incense* The waters speak. You carry the scent of the surface. What brings you to Murkmire?',
      choices: [
        { label: 'I seek to trade.', nextNode: null, action: 'open_shop' },
        { label: 'Tell me of the water rituals.', nextNode: 'rituals', condition: { type: 'race', race: 'lizard_folk' } },
        { label: 'What can you tell me about this place?', nextNode: 'lore_murkmire' },
        { label: 'Farewell, Shaman.', nextNode: null },
      ],
    },
    rituals: {
      text: 'The old ways run deep in Murkmire. Water rituals, blood rituals — forbidden by the Dominion but sacred to our people. Only Lizard Folk may learn them.',
      choices: [{ label: 'I wish to learn.', nextNode: null, action: 'open_ritual_trainer' }],
    },
    lore_murkmire: {
      text: 'Murkmire sits where the great river meets the swamp. The Lizard Folk have lived here since before recorded history. We remember the old gods... even if they no longer answer.',
      choices: [{ label: 'The old gods?', nextNode: 'old_gods' }],
    },
    old_gods: {
      text: 'Divine beings who once walked among mortals. They withdrew after the Atlas incident. Some say they sleep. Others say they abandoned us. The truth? Even shamans do not know.',
      choices: [{ label: 'Thank you for sharing.', nextNode: null }],
    },
  },

  npc_mechspire_engineer: {
    start: {
      text: '*gears whirr* Ah! A visitor! Welcome to Mechspire, greatest achievement of Gnomish engineering! Mind the steam vents.',
      choices: [
        { label: 'I need supplies.', nextNode: null, action: 'open_shop' },
        { label: 'How does cogworking work?', nextNode: 'cogworking' },
        { label: 'Tell me about Mechspire.', nextNode: 'lore_mechspire' },
        { label: 'Goodbye.', nextNode: null },
      ],
    },
    cogworking: {
      text: 'Cogs, gears, springs — the holy trinity of engineering! Combine them at a workbench to create clockwork cores, automatons, even simple AI constructs. Ingenuity stat helps tremendously.',
      choices: [{ label: 'Fascinating.', nextNode: null }],
    },
    lore_mechspire: {
      text: 'Mechspire was built in Year 312 Post-Atlas. Three gnomish clans pooled their knowledge. Now it\'s the technological capital of Fortuna. Even the Dominion can\'t match our innovations.',
      choices: [{ label: 'Impressive work.', nextNode: null }],
    },
  },

  npc_fortunes_rest_dealer: {
    start: {
      text: '*purrs* Welcome to Fortune\'s Rest, where luck is currency and chance is king. What brings a traveler to our sandy paradise?',
      choices: [
        { label: 'I want to browse your wares.', nextNode: null, action: 'open_shop' },
        { label: 'Tell me about Cat Folk luck.', nextNode: 'luck_lore' },
        { label: 'Any work available?', nextNode: 'quest_hook' },
        { label: 'Just passing through.', nextNode: null },
      ],
    },
    luck_lore: {
      text: 'We Cat Folk have a saying: "Fortune favors the curious." Our Pattern Recognition lets us see probabilities others miss. Card packs, loot drops, even combat — we sense the odds.',
      choices: [{ label: 'Useful talent.', nextNode: null }],
    },
    quest_hook: {
      text: 'The desert caravans have been losing shipments to sand vipers. Clear out 5 of them and the Merchants\' Circle will pay handsomely.',
      choices: [
        { label: 'I\'ll handle it.', nextNode: 'quest_accept_vipers', action: 'give_quest', questId: 'wq_kill_vipers' },
        { label: 'Not interested.', nextNode: null },
      ],
    },
    quest_accept_vipers: {
      text: 'Watch for their burrows in the sand. They strike fast. Good hunting!',
      choices: [{ label: 'On my way.', nextNode: null }],
    },
  },

  portal_nexus: {
    start: {
      text: 'The Portal Nexus hums with arcane energy. Threads of light connect to distant anchor stones across Fortuna.',
      choices: [
        { label: 'Travel to another town.', nextNode: null, action: 'open_portal' },
        { label: 'How do portals work?', nextNode: 'portal_info' },
        { label: 'Leave the Nexus.', nextNode: null },
      ],
    },
    portal_info: {
      text: 'Each town maintains an anchor stone attuned to the Portal Nexus network. Step through and you\'ll arrive instantly. There\'s a 30-second cooldown between jumps. Personal portals can also be crafted on your plot.',
      choices: [{ label: 'Understood.', nextNode: null }],
    },
  },

  npc_seed_merchant: {
    start: {
      text: 'Fresh seeds, fine seeds! Everything you need to start your farm. Wheat, herbs, vegetables, even rare flowers!',
      choices: [
        { label: 'Show me your seeds.', nextNode: null, action: 'open_shop' },
        { label: 'How does farming work?', nextNode: 'farming_info' },
        { label: 'No thanks.', nextNode: null },
      ],
    },
    farming_info: {
      text: 'Plant seeds on your claimed plot. Water them daily. Higher farming skill means faster growth and better yields. Some crops are seasonal — check the almanac!',
      choices: [{ label: 'Thanks for the tip.', nextNode: null }],
    },
  },

  npc_rancher: {
    start: {
      text: 'Howdy! Looking to raise some animals? I\'ve got chickens, cows, sheep — even bees if you\'re brave enough.',
      choices: [
        { label: 'Show me animals for sale.', nextNode: null, action: 'open_shop' },
        { label: 'How does ranching work?', nextNode: 'ranching_info' },
        { label: 'Maybe later.', nextNode: null },
      ],
    },
    ranching_info: {
      text: 'Build a pen on your plot, buy an animal, feed it daily. Happy animals produce more — eggs, milk, wool. Keep the feed stocked and they\'ll practically raise themselves.',
      choices: [{ label: 'Sounds doable.', nextNode: null }],
    },
  },

  // ---- Generic type-based dialogues (apply to all NPCs of that type) ----

  innkeeper: {
    start: {
      text: "Welcome, traveler. The fire's warm and the ale's cold. What brings you in?",
      choices: [
        { label: 'Any rumors going around?', nextNode: 'rumors' },
        { label: 'I\'ll have a drink. (5 coins)', nextNode: 'drink' },
        { label: 'What can you tell me about this place?', nextNode: 'local_info' },
        { label: 'Nothing, just passing through.', nextNode: null },
      ],
    },
    rumors: {
      text: "Plenty of talk in here lately. Let me share what I've heard...",
      choices: [{ label: 'Tell me.', nextNode: null }],
      action: 'reveal_rumors',
    },
    drink: {
      text: "Here you go. Finest in the house — well, only thing in the house, but still.",
      choices: [{ label: 'Cheers.', nextNode: null }],
    },
    local_info: {
      text: 'Fortuna is a big world. The roads between towns can be treacherous. Stick to well-traveled paths and watch the weather — it changes fast in some biomes.',
      choices: [
        { label: 'What do you know about the Rift?', nextNode: 'rift_talk' },
        { label: 'Thanks for the info.', nextNode: null },
      ],
    },
    rift_talk: {
      text: "The Rift? Nobody goes in and comes back the same. Some say there's something trapped in there — been there for centuries. The Adventure Guild tracks who makes it how far. Stone rank to Relic, they say.",
      choices: [{ label: 'Interesting. Thanks.', nextNode: null }],
    },
  },

  bard: {
    start: {
      text: '*strums and pauses* Ah, a new face! Sit, listen. I carry songs from every corner of Fortuna.',
      choices: [
        { label: 'Sing me something.', nextNode: 'song' },
        { label: 'What news from the road?', nextNode: 'road_news' },
        { label: 'What\'s the history of this place?', nextNode: 'local_history' },
        { label: 'Another time.', nextNode: null },
      ],
    },
    song: {
      text: '"In the days before the Atlas fell, Calidar shone like heaven\'s well — two peoples, one oasis, one dream — until the Soldier chose what nothing should mean..." An old piece, from before the sky broke.',
      choices: [
        { label: 'What happened to Calidar?', nextNode: 'lore_calidar' },
        { label: 'Beautiful. Thank you.', nextNode: null },
      ],
    },
    lore_calidar: {
      text: "Heaven's Atlas. A weapon. A Dominion general deployed it five hundred years ago — burned the joint elven and dark elven capital to ash. The Rift is what was left behind in the old human capital. Nobody talks about it much. The Dominion prefers not to.",
      choices: [
        { label: 'What became of the elves?', nextNode: 'lore_elves' },
        { label: 'Dark history. Thank you.', nextNode: null },
      ],
    },
    lore_elves: {
      text: "Scattered. Some settled Sylvaris, some kept moving east. The Dark Elves... mostly gone. A handful survive in deep places. They remember what happened. They always will.",
      choices: [{ label: 'Heavy stuff. Thank you.', nextNode: null }],
    },
    road_news: {
      text: "I pick up a lot of stories between towns...",
      choices: [{ label: 'Let\'s hear them.', nextNode: null }],
      action: 'reveal_rumors',
    },
    local_history: {
      text: "Every town has a story carved in stone. This one goes back centuries — ask the oldest locals if you want the real version, not the cleaned-up one.",
      choices: [{ label: 'Good advice.', nextNode: null }],
    },
  },

  gossip: {
    start: {
      text: "*nursing a drink* You look like someone who pays attention. Good. Sit down.",
      choices: [
        { label: 'What have you heard?', nextNode: 'rumors' },
        { label: 'Leave me alone.', nextNode: null },
      ],
    },
    rumors: {
      text: "Not everything I know is safe to repeat loudly. But quietly...",
      choices: [{ label: 'Go on.', nextNode: null }],
      action: 'reveal_rumors',
    },
  },

  guard: {
    start: {
      text: 'State your business.',
      choices: [
        { label: 'Just passing through.', nextNode: 'allow' },
        { label: 'I live here.', nextNode: 'allow' },
        { label: 'None of your concern.', nextNode: 'suspicious' },
      ],
    },
    allow: {
      text: 'Move along. Keep out of trouble.',
      choices: [{ label: 'Of course.', nextNode: null }],
    },
    suspicious: {
      text: '...Watch yourself.',
      choices: [{ label: 'Gladly.', nextNode: null }],
    },
  },

  // ---- Faction liaison dialogue trees (keyed by NPC type) ----

  faction_liaison_dominion: {
    start: {
      text: 'You stand in the Hall of the Holy Dominion. The Light judges all who enter. State your purpose.',
      choices: [
        { label: 'What does the Dominion stand for?', nextNode: 'faction_info' },
        { label: 'I want to serve the Dominion.', nextNode: 'serve' },
        { label: 'My business is my own.', nextNode: null },
      ],
    },
    faction_info: {
      text: 'The Holy Dominion maintains order across Fortuna. We protect the innocent, enforce the law, and stand against the growing darkness — the Rift, the undead, the lich. Join us. Stand for something.',
      choices: [
        { label: 'How do I earn standing with the Dominion?', nextNode: 'earn_rep' },
        { label: 'Understood. Goodbye.', nextNode: null },
      ],
    },
    earn_rep: {
      text: "Complete quests for our priests and quartermasters. Uphold the law — your karma must remain clean. A criminal earns no favor here. The Light sees all deeds, good and ill.",
      choices: [{ label: 'Understood.', nextNode: null }],
    },
    serve: {
      text: 'We have need of disciplined hands.',
      choices: [
        { label: 'I\'m ready to serve.', nextNode: 'quest_offer', condition: { type: 'karma', min: 0 } },
        { label: 'My record isn\'t clean. Not yet.', nextNode: 'karma_bad', condition: { type: 'karma', max: -1 } },
      ],
    },
    quest_offer: {
      text: 'Good. Your service is noted in our records. The Dominion does not forget its friends.',
      choices: [
        { label: 'For the Light.', nextNode: null, action: 'faction_gain_rep', factionId: 'holy_dominion', amount: 100 },
      ],
    },
    karma_bad: {
      text: 'The Dominion is aware of your history. Cleanse yourself first. Good deeds wash away past sins. Return when your conscience is clear.',
      choices: [{ label: 'I understand.', nextNode: null }],
    },
  },

  faction_liaison_veiled_hand: {
    start: {
      text: "*a figure watches from the shadows* ...You don't look like law. Good. What do you want?",
      choices: [
        { label: 'Tell me about the Veiled Hand.', nextNode: 'faction_info' },
        { label: 'I want to work for you.', nextNode: 'work' },
        { label: 'Nothing. Wrong door.', nextNode: null },
      ],
    },
    faction_info: {
      text: "We move in the spaces between laws. Information, goods, services — all available if you know where to look. We don't ask where things came from. Neither should you.",
      choices: [
        { label: 'How do I prove myself?', nextNode: 'earn_rep' },
        { label: 'I see. Goodbye.', nextNode: null },
      ],
    },
    earn_rep: {
      text: "Useful people make useful allies. Gather intelligence. Move goods across difficult borders. Keep your head down and your hands dirty. We'll notice.",
      choices: [{ label: 'I can do that.', nextNode: null }],
    },
    work: {
      text: "Show me what you're capable of first. We don't trust strangers.",
      choices: [
        { label: "I've done some morally flexible work.", nextNode: 'work_dark', condition: { type: 'karma', max: -10 } },
        { label: "I'm willing to learn.", nextNode: 'work_new' },
      ],
    },
    work_dark: {
      text: "*smiles* Someone with a record. That's exactly what we need. You understand how the world actually works.",
      choices: [
        { label: "Let's work together.", nextNode: null, action: 'faction_gain_rep', factionId: 'veiled_hand', amount: 200 },
      ],
    },
    work_new: {
      text: "Clean hands aren't useful here. Come back when you've made some harder choices.",
      choices: [{ label: 'I will.', nextNode: null }],
    },
  },

  faction_liaison_rift_wardens: {
    start: {
      text: 'The Rift Wardens monitor the spreading tears — here, there, everywhere the spatial fabric weakens. You seek us out. Why?',
      choices: [
        { label: 'What are the Rift Wardens?', nextNode: 'faction_info' },
        { label: 'I want to help contain the Rift.', nextNode: 'help' },
        { label: 'Just curious.', nextNode: null },
      ],
    },
    faction_info: {
      text: "We were formed a century after the primary Rift appeared — when secondary tears began spreading. We track, map, and when possible seal them. The primary Rift cannot be sealed. But the others can. Usually.",
      choices: [
        { label: 'Tell me about the secondary tears.', nextNode: 'tears_info' },
        { label: 'How do I join?', nextNode: 'help' },
      ],
    },
    tears_info: {
      text: "Smaller versions of the Rift, appearing across Fortuna. Most are harmless — a few feet wide, quickly sealed. Some are not. One opened below Kragmor last year. Took three wardens to close it.",
      choices: [{ label: 'Troubling. Thank you.', nextNode: null }],
    },
    help: {
      text: 'We need those with knowledge of the Rift — what it does to people, to space, to magic.',
      choices: [
        { label: "I've delved deep into the Rift.", nextNode: 'join_rift', condition: { type: 'skill', skill: 'magic', minLevel: 5 } },
        { label: "I'm willing but new to this.", nextNode: 'join_any' },
      ],
    },
    join_rift: {
      text: 'Good. Your insight is valuable. Welcome to the Rift Wardens. The Rift grows more unstable each year.',
      choices: [
        { label: "I'm honored to serve.", nextNode: null, action: 'faction_gain_rep', factionId: 'rift_wardens', amount: 150 },
      ],
    },
    join_any: {
      text: 'Courage matters too. Report back once you have first-hand experience inside the Rift.',
      choices: [{ label: 'I will.', nextNode: null }],
    },
  },

  faction_liaison_merchant_league: {
    start: {
      text: 'Welcome to the Merchant League Counting House. Every coin tells a story. What brings you to our ledger?',
      choices: [
        { label: 'Tell me about the Merchant League.', nextNode: 'faction_info' },
        { label: 'I want to do business.', nextNode: 'business' },
        { label: 'Just looking around.', nextNode: null },
      ],
    },
    faction_info: {
      text: "The Merchant League controls the majority of legitimate trade on Fortuna. We have factors in every major town — neutral ground where even enemies may trade. We have no political allegiance. Only commerce.",
      choices: [
        { label: 'Neutral ground sounds useful.', nextNode: 'neutral_ground' },
        { label: 'How do I earn standing?', nextNode: 'earn_rep' },
      ],
    },
    neutral_ground: {
      text: 'Precisely. League buildings are protected. Merchants of any race, any past, may trade within our walls. We profit when all parties profit.',
      choices: [{ label: 'I like the sound of that.', nextNode: null }],
    },
    earn_rep: {
      text: 'Buy, sell, trade. The more coin you move through our system, the more we notice you. High standing earns discounts, bulk purchasing access, and trade intelligence.',
      choices: [
        { label: 'Register me with the League.', nextNode: null, action: 'faction_gain_rep', factionId: 'merchant_league', amount: 50 },
      ],
    },
    business: {
      text: 'The shops here are open to registered members and paying customers alike.',
      choices: [
        { label: 'Show me the wares.', nextNode: null, action: 'open_shop' },
        { label: 'Tell me more first.', nextNode: 'faction_info' },
      ],
    },
  },

  faction_liaison_iron_vanguard: {
    start: {
      text: "Iron Vanguard Barracks. State your business. We don't have time for pleasantries.",
      choices: [
        { label: 'Who are the Iron Vanguard?', nextNode: 'faction_info' },
        { label: 'I want to enlist.', nextNode: 'enlist' },
        { label: 'Wrong place. Leaving.', nextNode: null },
      ],
    },
    faction_info: {
      text: "We are the military arm of Ironhold, but our reach is continent-wide. We train fighters, hold the mountain passes, and respond to threats the holy patrols won't touch — the undead, the bandit lords, the rift-things.",
      choices: [
        { label: 'You deal with the undead?', nextNode: 'undead' },
        { label: 'How do I earn standing?', nextNode: 'earn_rep' },
      ],
    },
    undead: {
      text: "More and more lately. They're spreading from the Rift's edges. Whatever the lich is doing down there, it's bleeding out into the world. We handle containment while the wardens handle sealing.",
      choices: [{ label: 'Understood. Good work.', nextNode: null }],
    },
    earn_rep: {
      text: 'Prove yourself in combat. Dungeon delvers are respected here — the Rift tests people in ways no training ground can. Kill things. Stay alive. Come back.',
      choices: [{ label: 'Clear enough.', nextNode: null }],
    },
    enlist: {
      text: "We don't take just anyone. Show me you're worth the kit.",
      choices: [
        { label: "I've fought in the Rift.", nextNode: 'enlist_rift', condition: { type: 'skill', skill: 'melee', minLevel: 3 } },
        { label: "I'm still building my skills.", nextNode: 'enlist_low' },
      ],
    },
    enlist_rift: {
      text: "A fighter. Good. Welcome to the Iron Vanguard. Prove yourself further and ranks will follow.",
      choices: [
        { label: 'For Ironhold.', nextNode: null, action: 'faction_gain_rep', factionId: 'iron_vanguard', amount: 150 },
      ],
    },
    enlist_low: {
      text: "Come back when you've bloodied yourself a bit. We need soldiers.",
      choices: [{ label: 'I understand.', nextNode: null }],
    },
  },

  // ---- Generic ambient NPC dialogue trees ----

  wandering_merchant: {
    start: {
      text: "Ah, a traveler! I've been moving goods between towns for years. Looking to buy or trade? I've picked up some interesting things on the road.",
      choices: [
        { text: 'What do you have for sale?', nextNode: 'wares' },
        { text: 'Heard any news from the road?', nextNode: 'news', action: 'reveal_rumors' },
        { text: 'Safe travels.', nextNode: null },
      ],
    },
    wares: {
      text: "I carry herbs, tonics, and the occasional rare find. My prices are fair — I don't have a shop to maintain, after all.",
      choices: [
        { text: "I'll browse later. What news?", nextNode: 'news', action: 'reveal_rumors' },
        { text: 'Thanks, goodbye.', nextNode: null },
      ],
    },
    news: {
      text: 'On the road I heard... *lowers voice* ...things. Strange things. But I suppose you already got the local gossip.',
      choices: [
        { text: 'Thanks for the tips.', nextNode: null },
      ],
    },
  },

  farmer: {
    start: {
      text: "Hard day's work, that's what it takes. These fields don't tend themselves. You look like an adventurer — any trouble with the local wildlife lately?",
      choices: [
        { text: "Nothing I couldn't handle.", nextNode: 'chitchat' },
        { text: 'What grows around here?', nextNode: 'crops' },
        { text: 'Heard anything strange lately?', nextNode: 'rumors', action: 'reveal_rumors' },
        { text: 'Back to it, then.', nextNode: null },
      ],
    },
    chitchat: {
      text: "Good to know. These seasons have been strange. The crops are growing oddly — too fast in some places, not at all in others.",
      choices: [
        { text: 'Sounds like the land is troubled.', nextNode: null },
      ],
    },
    crops: {
      text: "Wheat, mostly. Some vegetables. The soil's rich here. Though lately there's been blight creeping in from the east — I blame whatever's happening in the old ruins.",
      choices: [
        { text: "I'll look into it.", nextNode: null },
      ],
    },
    rumors: {
      text: "Well, me and the other farmers have been talking... something's not right. But you probably know better than I do, coming from out there.",
      choices: [
        { text: 'Thanks, neighbor.', nextNode: null },
      ],
    },
  },

  civilian: {
    start: {
      text: 'Oh! You startled me. Are you one of those adventurers? I\'ve heard so many stories — do you really go into dungeons and fight monsters?',
      choices: [
        { text: "That's the job.", nextNode: 'impressed' },
        { text: 'What\'s happening around town?', nextNode: 'town_news', action: 'reveal_rumors' },
        { text: 'Just passing through.', nextNode: null },
      ],
    },
    impressed: {
      text: 'Incredible. I could never. I just help out at the market and keep my head down. Though... I did hear something the other day.',
      choices: [
        { text: 'Tell me.', nextNode: 'whisper', action: 'reveal_rumors' },
        { text: 'Best not to get involved.', nextNode: null },
      ],
    },
    whisper: {
      text: '*whispers* The inn has been busy with strange visitors at night. I don\'t know who they are. No one does.',
      choices: [
        { text: 'Interesting. Thank you.', nextNode: null },
      ],
    },
    town_news: {
      text: "Oh, you know, the usual. Market prices are strange, someone's goat got loose again... and there's been odd lights at the edge of town at night.",
      choices: [
        { text: 'Odd lights?', nextNode: 'lights' },
        { text: 'Thanks for the update.', nextNode: null },
      ],
    },
    lights: {
      text: "Yes, around midnight. Bluish. They vanish if you walk toward them. I've stopped looking.",
      choices: [
        { text: 'Wise choice. Stay safe.', nextNode: null },
      ],
    },
  },

  vampire_npc: {
    start: {
      text: '*The figure turns slowly, eyes reflecting light unnaturally.* Yesss... a warm one. It has been some time since I had... company.',
      choices: [
        { text: 'What are you doing here?', nextNode: 'identity' },
        { text: 'Back away slowly.', nextNode: 'flee' },
        { text: '[Attack]', nextNode: 'attack' },
      ],
    },
    identity: {
      text: 'What am I? I am what your kind made me, trespasser. This crypt is mine. The night is mine. You should leave... before you become mine too.',
      choices: [
        { text: "I'm not afraid of you.", nextNode: 'defiance' },
        { text: 'Maybe I should leave.', nextNode: null },
      ],
    },
    flee: {
      text: 'Sssmart. Run, warm one. Run while you still can.',
      choices: [
        { text: '[Leave]', nextNode: null },
      ],
    },
    attack: {
      text: '*The creature hisses and lunges\u2014*',
      choices: [
        { text: '[Fight]', nextNode: null },
      ],
    },
    defiance: {
      text: 'Then you are either very brave or very foolish. In my experience, they are the same thing. *The shadows deepen around you.*',
      choices: [
        { text: '[Stand your ground]', nextNode: null },
      ],
    },
  },

  jailer: {
    start: {
      text: "Quiet down in there. You're in the town jail. You can serve your time, or pay your bail — those are your options. Which'll it be?",
      choices: [
        { text: 'How long am I in for?', nextNode: 'time' },
        { text: 'I want to pay bail.', nextNode: 'bail' },
        { text: "I'll wait it out.", nextNode: 'wait' },
        { text: 'This is unjust!', nextNode: 'protest' },
      ],
    },
    time: {
      text: "Check your sentence papers. The guard captain sets the time, not me. I just make sure you stay.",
      choices: [
        { text: 'Fine.', nextNode: null },
      ],
    },
    bail: {
      text: "Bail? Sure, we take coin. You'll get the amount from the magistrate's notice on the wall. Pay up and you're free.",
      choices: [
        { text: '[Pay bail]', nextNode: null, action: 'open_bail' },
        { text: "I don't have enough.", nextNode: null },
      ],
    },
    wait: {
      text: "Smart choice. Time goes fast if you sleep. And if you behave, maybe I'll forget to lock the outer gate.",
      choices: [
        { text: '*Wait quietly.*', nextNode: null },
      ],
    },
    protest: {
      text: "Tell it to the magistrate. Not my job to care about guilt. My job is to make sure you don't leave until your time is done.",
      choices: [
        { text: '*Grumble and wait.*', nextNode: null },
      ],
    },
  },

  craftsman: {
    start: {
      text: "Can't talk long — got a commission due by tomorrow. You need something made, or are you just browsing?",
      choices: [
        { text: 'What do you make?', nextNode: 'craft_list' },
        { text: 'Any crafting tips?', nextNode: 'tips' },
        { text: 'Just looking.', nextNode: null },
      ],
    },
    craft_list: {
      text: "Mostly metalwork and tools. Some furniture if the price is right. Nothing fancy — I'm a working craftsman, not an artist.",
      choices: [
        { text: 'Good to know.', nextNode: null },
      ],
    },
    tips: {
      text: "Keep your tools sharp and your mind focused. Rush a craft and you'll get shoddy work. Take your time and you might surprise yourself with the quality.",
      choices: [
        { text: 'Thanks for the advice.', nextNode: null },
      ],
    },
  },

  banker: {
    start: {
      text: "Welcome to the vault. Your deposits are secured across every branch in Fortuna. How may I assist you today?",
      choices: [
        { text: 'I\'d like to access my vault.', nextNode: 'open_vault', action: 'open_bank' },
        { text: 'How does the bank work?', nextNode: 'explain' },
        { text: 'Never mind.', nextNode: null },
      ],
    },
    explain: {
      text: "We offer secure storage for gold, resources, and equipment. Your vault is accessible from any town banker. Items stored here are protected — even through world calamities.",
      choices: [
        { text: 'Open my vault.', nextNode: 'open_vault', action: 'open_bank' },
        { text: 'Can I expand my vault?', nextNode: 'expansion' },
        { text: 'Good to know.', nextNode: null },
      ],
    },
    expansion: {
      text: "Certainly. Additional vault space can be purchased with gold. Each expansion adds ten slots. Speak to me when you are ready.",
      choices: [
        { text: 'Open my vault.', nextNode: 'open_vault', action: 'open_bank' },
        { text: 'Thanks.', nextNode: null },
      ],
    },
    open_vault: {
      text: "Here are your vault contents. Take your time.",
      choices: [
        { text: 'Done.', nextNode: null },
      ],
    },
  },
};

module.exports = { NPC_DIALOGUES };
