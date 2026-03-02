// vip-overflow.js — VIP lapse overflow logic
// Marks excess pets/companions as dormant when VIP lapses.
// Clears dormant flags when VIP reactivates.

var vipPerks = require('./vip-perks');

// ---------------------------------------------------------------------------
// applyOverflow — called when VIP lapses (tier goes from 'vip' to 'free')
// ---------------------------------------------------------------------------

function applyOverflow(account, vipStatus) {
  if (!account) return;

  // Pets: VIP allows 3, free allows 2
  var maxPets = vipPerks.getMaxPets(vipStatus);
  var pets = account.petData || [];
  if (pets.length > maxPets) {
    // Sort by evolution stage descending — keep highest-evolved active
    pets.sort(function(a, b) {
      return (b.evolutionStage || 0) - (a.evolutionStage || 0);
    });
    for (var pi = 0; pi < pets.length; pi++) {
      pets[pi].dormant = (pi >= maxPets);
    }
  }

  // Companions: VIP allows 3, free allows 2
  var maxCompanions = vipPerks.getMaxCompanions(vipStatus);
  var companions = account.companions || [];
  if (companions.length > maxCompanions) {
    // Sort by damage output descending — keep strongest active
    companions.sort(function(a, b) {
      return (b.damage || b.baseDamage || 0) - (a.damage || a.baseDamage || 0);
    });
    for (var ci = 0; ci < companions.length; ci++) {
      companions[ci].dormant = (ci >= maxCompanions);
    }
  }
}

// ---------------------------------------------------------------------------
// clearOverflow — called when VIP reactivates
// ---------------------------------------------------------------------------

function clearOverflow(account) {
  if (!account) return;

  var pets = account.petData || [];
  for (var pi = 0; pi < pets.length; pi++) {
    if (pets[pi].dormant) pets[pi].dormant = false;
  }

  var companions = account.companions || [];
  for (var ci = 0; ci < companions.length; ci++) {
    if (companions[ci].dormant) companions[ci].dormant = false;
  }
}

module.exports = {
  applyOverflow: applyOverflow,
  clearOverflow: clearOverflow,
};
