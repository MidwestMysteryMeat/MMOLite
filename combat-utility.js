// combat-utility.js
// Utility-based action scoring for tactical combat AI.
// Evaluates candidate actions (move+attack, ability, retreat, hold) and
// returns a ranked list for decideTurnAction to consume.
//
// Each action is scored as a composite of:
//   - Positional value (influence map tile score at destination)
//   - Attack opportunity (can attack a target after moving?)
//   - Ability opportunity (can use a tactical ability?)
//   - Archetype preference (flanking, range-keeping, aggro)
//   - HP-based urgency (retreat, heal, desperation)

'use strict';

var combatGrid = require('./combat-grid');
var combatInfluence = require('./combat-influence');
var combatAstar = require('./combat-astar');
var dungeonAI = require('./dungeon-ai');

var chebyshevDist = combatGrid.chebyshevDist;
var manhattanDist = combatGrid.manhattanDist;

var ARCHETYPES = dungeonAI.ARCHETYPES;

// ---------------------------------------------------------------------------
// Archetype-specific influence weights
// ---------------------------------------------------------------------------

var ARCHETYPE_WEIGHTS = {
  bruiser:     { threat: -0.15, support: 0.2, danger: -0.4, control: -0.05 },
  skirmisher:  { threat: -0.3,  support: 0.15, danger: -0.6, control: -0.2 },
  ranged:      { threat: -0.5,  support: 0.1, danger: -0.5, control: -0.4 },
  controller:  { threat: -0.4,  support: 0.25, danger: -0.5, control: -0.3 },
  support:     { threat: -0.5,  support: 0.4, danger: -0.6, control: -0.4 },
  elite:       { threat: -0.1,  support: 0.1, danger: -0.3, control: -0.05 },
};

// ---------------------------------------------------------------------------
// Action candidate generation
// ---------------------------------------------------------------------------

// Generate and score all candidate actions for an enemy unit.
// Returns sorted array of { type, score, movePath, targetId, abilityId }
// Best action is at index 0.
function scoreActions(enemy, combat, players, floor) {
  var alivePlayers = [];
  for (var i = 0; i < players.length; i++) {
    if (players[i].alive) alivePlayers.push(players[i]);
  }
  if (alivePlayers.length === 0) return [{ type: 'wait', score: 0 }];

  var arch = ARCHETYPES[enemy.archetype] || ARCHETYPES.bruiser;
  var weights = ARCHETYPE_WEIGHTS[enemy.archetype] || ARCHETYPE_WEIGHTS.bruiser;
  var influenceLayers = combatInfluence.generateInfluence(combat, enemy.id);

  var mp = enemy.mp || 2;
  var ap = enemy.ap || 1;
  var attackRange = (enemy.combat && enemy.combat.range) ? enemy.combat.range : 1;
  var hpPct = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;

  var candidates = [];

  // --- 1. Score targets ---
  var targetScores = _scoreTargets(enemy, alivePlayers, arch, combat);

  // --- 2. Direct attack (already adjacent) ---
  for (var ti = 0; ti < targetScores.length; ti++) {
    var ts = targetScores[ti];
    var dist = chebyshevDist(enemy.x, enemy.y, ts.target.x, ts.target.y);
    if (dist <= attackRange && ap > 0) {
      candidates.push({
        type: 'attack',
        score: 20 + ts.score,
        movePath: [],
        targetId: ts.target.id,
        abilityId: null,
      });
    }
  }

  // --- 3. Move + attack candidates ---
  if (mp > 0 && ap > 0) {
    for (var mi = 0; mi < targetScores.length; mi++) {
      var mts = targetScores[mi];
      var target = mts.target;

      // Try flanking path first for skirmishers
      var path = null;
      if (arch.flankPreference > 0.5) {
        path = combatAstar.flankPath(combat, enemy.x, enemy.y, target, mp, influenceLayers);
      }

      // Fall back to approach path
      if (!path) {
        path = combatAstar.approachPath(
          combat, enemy.x, enemy.y, target.x, target.y, mp, influenceLayers, 0.5
        );
      }

      if (path && path.length > 1) {
        var finalPos = path[path.length - 1];
        var finalDist = chebyshevDist(finalPos.x, finalPos.y, target.x, target.y);

        if (finalDist <= attackRange) {
          // Can attack after moving
          var posScore = combatInfluence.scoreTile(influenceLayers, finalPos.x, finalPos.y, weights);
          candidates.push({
            type: 'move_attack',
            score: 15 + mts.score + posScore * 5,
            movePath: path,
            targetId: target.id,
            abilityId: null,
          });
        } else {
          // Move closer but can't attack yet
          var approachScore = combatInfluence.scoreTile(influenceLayers, finalPos.x, finalPos.y, weights);
          var closingBonus = (manhattanDist(enemy.x, enemy.y, target.x, target.y) - manhattanDist(finalPos.x, finalPos.y, target.x, target.y)) * 2;
          candidates.push({
            type: 'move',
            score: 5 + closingBonus + approachScore * 3,
            movePath: path,
            targetId: null,
            abilityId: null,
          });
        }
      }
    }
  }

  // --- 4. Ability candidates ---
  if (enemy.abilities && enemy.abilities.length > 0 && ap > 0) {
    var allies = [];
    combat.units.forEach(function(unit) {
      if (unit.type === 'enemy' && unit.alive && unit.id !== enemy.id && !unit.isPlayerSummon) {
        allies.push(unit);
      }
    });

    for (var ai = 0; ai < enemy.abilities.length; ai++) {
      var ability = enemy.abilities[ai];
      var abilityScore = dungeonAI.scoreTacticalAbility(
        enemy, ability, targetScores[0] ? targetScores[0].target : null,
        allies, floor.grid, floor.width, floor.height
      );

      if (abilityScore > -900) {
        var bestAbilityTarget = targetScores[0] ? targetScores[0].target : null;
        candidates.push({
          type: 'ability',
          score: abilityScore + 8,
          movePath: [],
          targetId: bestAbilityTarget ? bestAbilityTarget.id : null,
          abilityId: ability.id,
        });
      }
    }
  }

  // --- 5. Retreat (low HP, archetype supports it) ---
  if (arch.retreatThreshold > 0 && hpPct < arch.retreatThreshold && mp > 0) {
    var nearestPlayer = targetScores[0] ? targetScores[0].target : alivePlayers[0];
    var retreatPath = combatAstar.fleePath(
      combat, enemy.x, enemy.y,
      nearestPlayer.x, nearestPlayer.y,
      mp, influenceLayers
    );
    if (retreatPath && retreatPath.length > 1) {
      // Retreat urgency scales inversely with HP
      var retreatUrgency = (1 - hpPct) * 30;
      candidates.push({
        type: 'move',
        score: retreatUrgency,
        movePath: retreatPath,
        targetId: null,
        abilityId: null,
      });
    }
  }

  // --- 6. Kite (ranged/controller: move away when too close) ---
  if (arch.keepDistance && mp > 0) {
    var closestPlayer = null;
    var closestDist = Infinity;
    for (var ki = 0; ki < alivePlayers.length; ki++) {
      var kd = chebyshevDist(enemy.x, enemy.y, alivePlayers[ki].x, alivePlayers[ki].y);
      if (kd < closestDist) { closestDist = kd; closestPlayer = alivePlayers[ki]; }
    }
    if (closestPlayer && closestDist <= 1) {
      var kitePath = combatAstar.fleePath(
        combat, enemy.x, enemy.y,
        closestPlayer.x, closestPlayer.y,
        mp, influenceLayers
      );
      if (kitePath && kitePath.length > 1) {
        candidates.push({
          type: 'move',
          score: 18, // kiting is high priority for ranged
          movePath: kitePath,
          targetId: null,
          abilityId: null,
        });
      }
    }
  }

  // --- 7. Wait (always available as fallback) ---
  candidates.push({ type: 'wait', score: 0, movePath: [], targetId: null, abilityId: null });

  // Sort by score descending
  candidates.sort(function(a, b) { return b.score - a.score; });

  return candidates;
}

// ---------------------------------------------------------------------------
// Target scoring (threat + opportunity)
// ---------------------------------------------------------------------------

function _scoreTargets(enemy, players, arch, combat) {
  var results = [];

  for (var i = 0; i < players.length; i++) {
    var p = players[i];
    var score = dungeonAI.calculateThreatScore(enemy, p, p.combat || {});

    // Archetype aggro weight
    score *= (arch.aggroWeight || 1.0);

    // Kill opportunity: target is low enough to kill in ~1 hit
    var enemyAtk = (enemy.combat && enemy.combat.atk) ? enemy.combat.atk : 10;
    if (p.hp <= enemyAtk * 1.5) {
      score += 15; // finish-off bonus
    }

    // Proximity bonus (beyond what threatScore gives)
    var dist = manhattanDist(enemy.x, enemy.y, p.x, p.y);
    if (dist <= 2) score += 5;

    results.push({ target: p, score: score });
  }

  results.sort(function(a, b) { return b.score - a.score; });
  return results;
}

// ---------------------------------------------------------------------------
// Simplified decision: pick best action from scored candidates
// ---------------------------------------------------------------------------

// Returns the top-scoring action, with small random variance to avoid
// perfectly predictable behavior.
function pickBestAction(candidates) {
  if (!candidates || candidates.length === 0) return { type: 'wait' };
  if (candidates.length === 1) return candidates[0];

  // Add small random variance to top candidates
  var topN = Math.min(3, candidates.length);
  var best = candidates[0];
  var bestScore = best.score + (Math.random() - 0.5) * 2;

  for (var i = 1; i < topN; i++) {
    var c = candidates[i];
    var variedScore = c.score + (Math.random() - 0.5) * 2;
    if (variedScore > bestScore) {
      best = c;
      bestScore = variedScore;
    }
  }

  return best;
}

module.exports = {
  scoreActions: scoreActions,
  pickBestAction: pickBestAction,
};
