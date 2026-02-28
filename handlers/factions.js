// handlers/factions.js
// Faction reputation system -- 11 factions, each with rep levels, shop discounts, guard hostility.
// Events: faction_status, faction_list

var FACTIONS = {
  holy_dominion:    { name: 'Holy Dominion',     homeZone: 'starter_town',    raceBonus: 'Human' },
  luminary_inquest: { name: 'Luminary Inquest',  homeZone: 'sylvaris',        raceBonus: 'Elf'   },
  iron_vanguard:    { name: 'Iron Vanguard',     homeZone: 'ironhold',        raceBonus: 'Dwarf' },
  khanate:          { name: 'The Khanate',       homeZone: 'kragmor',         raceBonus: 'Orc'   },
  veiled_hand:      { name: 'Veiled Hand',       homeZone: 'bonetrap',        raceBonus: 'Goblin'},
  lizard_covenant:  { name: 'Lizard Covenant',   homeZone: 'murkmire',        raceBonus: 'Lizard Folk' },
  tinkers_council:  { name: 'Tinkers Council',   homeZone: 'mechspire',       raceBonus: 'Gnome' },
  fortune_guild:    { name: 'Fortune Guild',     homeZone: 'fortunes_rest',   raceBonus: 'Cat Folk' },
  merchant_league:  { name: 'Merchant League',   homeZone: null,              raceBonus: null    },
  rift_wardens:     { name: 'Rift Wardens',      homeZone: null,              raceBonus: null    },
  adventure_guild:  { name: 'Adventure Guild',   homeZone: null,              raceBonus: null    },
};

// Rep levels: 0=Hated, 1=Hostile, 2=Unfriendly, 3=Neutral, 4=Friendly, 5=Honored, 6=Revered, 7=Exalted
var REP_LEVELS = ['Hated','Hostile','Unfriendly','Neutral','Friendly','Honored','Revered','Exalted'];
var REP_THRESHOLDS = [-10000, -3000, -1000, 0, 1000, 3000, 6000, 12000];

// Shop discount per rep level (0 = none, negative = surcharge)
var REP_SHOP_DISCOUNT = [-0.20, -0.10, -0.05, 0, 0.05, 0.10, 0.15, 0.20];

// Map zone IDs to their controlling faction
var ZONE_FACTION_MAP = {
  starter_town: 'holy_dominion',
  solara: 'holy_dominion',
  sylvaris: 'luminary_inquest',
  ironhold: 'iron_vanguard',
  kragmor: 'khanate',
  bonetrap: 'veiled_hand',
  murkmire: 'lizard_covenant',
  mechspire: 'tinkers_council',
  clockwork_harbor_town: 'tinkers_council',
  fortunes_rest: 'fortune_guild',
};

function getRepLevel(points) {
  var level = 0;
  for (var i = 0; i < REP_THRESHOLDS.length; i++) {
    if (points >= REP_THRESHOLDS[i]) level = i;
    else break;
  }
  return level;
}

function getRepLevelName(points) {
  return REP_LEVELS[getRepLevel(points)] || 'Neutral';
}

function getRepDiscount(points) {
  return REP_SHOP_DISCOUNT[getRepLevel(points)] || 0;
}

function isFactionHostile(factionRep, factionId) {
  if (!factionRep || !factionRep[factionId]) return false;
  var level = getRepLevel(factionRep[factionId]);
  return level <= 1; // Hated or Hostile
}

function getFactionForZone(zoneId) {
  return ZONE_FACTION_MAP[zoneId] || null;
}

// Add rep to a faction for an account
function addRep(account, factionId, delta) {
  if (!account.factionRep) account.factionRep = {};
  if (!account.factionRep[factionId]) account.factionRep[factionId] = 0;
  account.factionRep[factionId] = Math.max(-15000, Math.min(15000, account.factionRep[factionId] + delta));
  // Race bonus: +10% rep gain with home faction
  if (delta > 0 && FACTIONS[factionId] && account.race) {
    var f = FACTIONS[factionId];
    if (f.raceBonus === account.race) {
      account.factionRep[factionId] = Math.min(15000, account.factionRep[factionId] + Math.floor(delta * 0.10));
    }
  }
}

function init(io, socket, deps) {
  var accounts = deps.accounts;
  var socketAccountMap = deps.socketAccountMap;

  socket.on('faction_status', function() {
    var key = socketAccountMap.get(socket.id);
    if (!key) return;
    var account = accounts.loadAccount(key);
    if (!account) return;
    var rep = account.factionRep || {};
    var result = {};
    for (var fid in FACTIONS) {
      var pts = rep[fid] || 0;
      result[fid] = {
        name: FACTIONS[fid].name,
        points: pts,
        level: getRepLevel(pts),
        levelName: getRepLevelName(pts),
        discount: getRepDiscount(pts),
      };
    }
    socket.emit('faction_status', { factions: result });
  });

  socket.on('faction_list', function() {
    var list = [];
    for (var fid in FACTIONS) {
      list.push({
        id: fid,
        name: FACTIONS[fid].name,
        homeZone: FACTIONS[fid].homeZone,
        raceBonus: FACTIONS[fid].raceBonus,
      });
    }
    socket.emit('faction_list', { factions: list });
  });
}

module.exports = {
  init: init,
  FACTIONS: FACTIONS,
  REP_LEVELS: REP_LEVELS,
  REP_THRESHOLDS: REP_THRESHOLDS,
  REP_SHOP_DISCOUNT: REP_SHOP_DISCOUNT,
  ZONE_FACTION_MAP: ZONE_FACTION_MAP,
  getRepLevel: getRepLevel,
  getRepLevelName: getRepLevelName,
  getRepDiscount: getRepDiscount,
  isFactionHostile: isFactionHostile,
  getFactionForZone: getFactionForZone,
  addRep: addRep,
  applySeasonalOverrides: function(overrides) {
    if (overrides.FACTIONS)          { FACTIONS = overrides.FACTIONS;                   module.exports.FACTIONS = FACTIONS; }
    if (overrides.REP_THRESHOLDS)    { REP_THRESHOLDS = overrides.REP_THRESHOLDS;       module.exports.REP_THRESHOLDS = REP_THRESHOLDS; }
    if (overrides.REP_SHOP_DISCOUNT) { REP_SHOP_DISCOUNT = overrides.REP_SHOP_DISCOUNT; module.exports.REP_SHOP_DISCOUNT = REP_SHOP_DISCOUNT; }
    if (overrides.ZONE_FACTION_MAP)  { ZONE_FACTION_MAP = overrides.ZONE_FACTION_MAP;   module.exports.ZONE_FACTION_MAP = ZONE_FACTION_MAP; }
  },
};
