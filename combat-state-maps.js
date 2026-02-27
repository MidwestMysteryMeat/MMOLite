// combat-state-maps.js
// Shared module-level Maps for tracking MMO-inspired card effects across combat.
// Keyed by unitId. Each extracted combat module requires this directly.

'use strict';

module.exports = {
  hotStreakCounts: new Map(),
  comboState: new Map(),
  playerClones: new Map(),
  lilyTokens: new Map(),
  soulShards: new Map(),
  dancePartners: new Map(),
  staggerDoTs: new Map(),
  deathShrouds: new Map(),
  soulstones: new Map(),
  intercepts: new Map(),
  innervates: new Map(),
  fadeActive: new Map(),
  divineInvulnerability: new Map(),
};
