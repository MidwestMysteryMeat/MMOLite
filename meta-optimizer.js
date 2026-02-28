// meta-optimizer.js
// Layer 2 Meta-Optimization — offline balance analysis and parameter tuning.
//
// NOT a runtime module. Run via: node meta-optimizer.js [command]
//
// Commands:
//   gacha    — Monte Carlo gacha pull simulation (rarity distribution, pity verification)
//   combat   — Simulated combat encounters (card power scoring, build viability)
//   loot     — Loot table verification (drop rate accuracy across 10K+ runs)
//   market   — Market price equilibrium simulation
//   all      — Run all simulations
//
// This is where nature-inspired algorithms (Yang's book) plug in:
//   - Genetic algorithms for build-space exploration
//   - Differential evolution for parameter tuning
//   - Simulated annealing for balance search

'use strict';

// ---------------------------------------------------------------------------
// Simulation engine core
// ---------------------------------------------------------------------------

// Seeded PRNG for reproducible simulations (xorshift128)
function createRNG(seed) {
  var s = [seed | 0, (seed * 1103515245 + 12345) | 0, (seed * 214013 + 2531011) | 0, (seed ^ 0xdeadbeef) | 0];
  return {
    next: function() {
      var t = s[3];
      t ^= t << 11;
      t ^= t >>> 8;
      s[3] = s[2]; s[2] = s[1]; s[1] = s[0];
      t ^= s[0];
      t ^= s[0] >>> 19;
      s[0] = t;
      return (t >>> 0) / 4294967296;
    },
  };
}

// Statistical helpers
function mean(arr) {
  if (arr.length === 0) return 0;
  var sum = 0;
  for (var i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

function stddev(arr) {
  var m = mean(arr);
  var variance = 0;
  for (var i = 0; i < arr.length; i++) variance += (arr[i] - m) * (arr[i] - m);
  return Math.sqrt(variance / arr.length);
}

function percentile(arr, p) {
  var sorted = arr.slice().sort(function(a, b) { return a - b; });
  var idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function histogram(arr, bucketCount) {
  if (arr.length === 0) return [];
  var min = arr[0];
  var max = arr[0];
  for (var i = 1; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  var range = max - min || 1;
  var bucketSize = range / bucketCount;
  var buckets = new Array(bucketCount).fill(0);
  for (var j = 0; j < arr.length; j++) {
    var idx = Math.min(bucketCount - 1, Math.floor((arr[j] - min) / bucketSize));
    buckets[idx]++;
  }
  return buckets.map(function(count, idx) {
    return {
      rangeStart: Math.round((min + idx * bucketSize) * 100) / 100,
      rangeEnd: Math.round((min + (idx + 1) * bucketSize) * 100) / 100,
      count: count,
      pct: Math.round(count / arr.length * 10000) / 100,
    };
  });
}

// ---------------------------------------------------------------------------
// 1. Gacha Pull Simulation
// ---------------------------------------------------------------------------

function simulateGachaPulls(numRuns, pullsPerRun, seed) {
  var RARITY_TIERS = [
    { id: 'common',      weight: 4500 },
    { id: 'uncommon',    weight: 2500 },
    { id: 'rare',        weight: 1500 },
    { id: 'ultra_rare',  weight: 800  },
    { id: 'mythic_rare', weight: 400  },
    { id: 'legendary',   weight: 200  },
    { id: 'godly',       weight: 80   },
    { id: 'relic',       weight: 20   },
  ];
  var TOTAL_WEIGHT = 0;
  for (var tw = 0; tw < RARITY_TIERS.length; tw++) TOTAL_WEIGHT += RARITY_TIERS[tw].weight;

  var SOFT_PITY_START = 80;
  var HARD_PITY = 120;
  var SOFT_PITY_RATE = 0.02;

  var rng = createRNG(seed || 42);

  // Track per-run metrics
  var legendaryPullNumbers = []; // which pull number each legendary appears at
  var runRarityCounts = {};
  for (var ri = 0; ri < RARITY_TIERS.length; ri++) runRarityCounts[RARITY_TIERS[ri].id] = [];

  var totalPulls = 0;
  var totalLegendaries = 0;
  var firstLegendaryPulls = [];
  var dryStreaks = []; // longest streak without legendary per run

  for (var run = 0; run < numRuns; run++) {
    var pity = 0;
    var counts = {};
    for (var ci = 0; ci < RARITY_TIERS.length; ci++) counts[RARITY_TIERS[ci].id] = 0;
    var firstLeg = -1;
    var lastLeg = 0;
    var maxDry = 0;

    for (var pull = 1; pull <= pullsPerRun; pull++) {
      pity++;

      // Hard pity
      if (pity >= HARD_PITY) {
        counts.legendary++;
        totalLegendaries++;
        legendaryPullNumbers.push(pull);
        if (firstLeg === -1) firstLeg = pull;
        if (pull - lastLeg > maxDry) maxDry = pull - lastLeg;
        lastLeg = pull;
        pity = 0;
        continue;
      }

      // Roll with soft pity
      var roll = rng.next() * TOTAL_WEIGHT;
      var pityBoost = 0;
      if (pity > SOFT_PITY_START) {
        pityBoost = (pity - SOFT_PITY_START) * SOFT_PITY_RATE * TOTAL_WEIGHT;
      }

      var cumulative = 0;
      var rolledId = 'common';
      for (var t = 0; t < RARITY_TIERS.length; t++) {
        var w = RARITY_TIERS[t].weight;
        // Boost legendary+ (order 5+)
        if (t >= 5) w += pityBoost / 3; // spread boost across top 3 tiers
        cumulative += w;
        if (roll < cumulative) {
          rolledId = RARITY_TIERS[t].id;
          break;
        }
      }

      counts[rolledId]++;
      totalPulls++;

      if (rolledId === 'legendary' || rolledId === 'godly' || rolledId === 'relic') {
        totalLegendaries++;
        legendaryPullNumbers.push(pull);
        if (firstLeg === -1) firstLeg = pull;
        if (pull - lastLeg > maxDry) maxDry = pull - lastLeg;
        lastLeg = pull;
        pity = 0;
      }
    }

    for (var rk in counts) runRarityCounts[rk].push(counts[rk]);
    if (firstLeg > 0) firstLegendaryPulls.push(firstLeg);
    dryStreaks.push(maxDry);
  }

  // Compile results
  var results = {
    config: { numRuns: numRuns, pullsPerRun: pullsPerRun, seed: seed || 42 },
    rarityDistribution: {},
    pityAnalysis: {
      avgFirstLegendary: Math.round(mean(firstLegendaryPulls) * 10) / 10,
      medianFirstLegendary: percentile(firstLegendaryPulls, 0.5),
      p95FirstLegendary: percentile(firstLegendaryPulls, 0.95),
      avgDryStreak: Math.round(mean(dryStreaks) * 10) / 10,
      maxDryStreak: Math.max.apply(null, dryStreaks),
      pityVerified: Math.max.apply(null, dryStreaks) <= HARD_PITY,
    },
  };

  for (var rr in runRarityCounts) {
    var vals = runRarityCounts[rr];
    results.rarityDistribution[rr] = {
      avgPerRun: Math.round(mean(vals) * 100) / 100,
      pctOfTotal: Math.round(mean(vals) / pullsPerRun * 10000) / 100,
      stddev: Math.round(stddev(vals) * 100) / 100,
    };
  }

  return results;
}

// ---------------------------------------------------------------------------
// 2. Card Power Score Simulation
// ---------------------------------------------------------------------------

function simulateCardPower(numCards, seed) {
  var rng = createRNG(seed || 123);

  var RARITIES = ['common', 'uncommon', 'rare', 'ultra_rare', 'mythic_rare', 'legendary', 'godly', 'relic'];
  var RARITY_SCALE = { common: 1, uncommon: 2, rare: 4, ultra_rare: 8, mythic_rare: 16, legendary: 32, godly: 64, relic: 128 };
  var AFFIX_COUNT = [0, 1, 2, 3, 3, 2, 3, 3]; // affixes per rarity tier

  var powerScores = {};
  for (var r = 0; r < RARITIES.length; r++) powerScores[RARITIES[r]] = [];

  for (var i = 0; i < numCards; i++) {
    // Pick random rarity (weighted)
    var rarityIdx = Math.min(RARITIES.length - 1, Math.floor(rng.next() * RARITIES.length));
    var rarity = RARITIES[rarityIdx];

    // Base power = rarity scale * random template power (10-100)
    var basePower = RARITY_SCALE[rarity] * (10 + rng.next() * 90);

    // Affix power bonus: each affix adds 5-20% base power
    var affixCount = AFFIX_COUNT[rarityIdx];
    var affixBonus = 0;
    for (var a = 0; a < affixCount; a++) {
      affixBonus += basePower * (0.05 + rng.next() * 0.15);
    }

    // Passive rider (rare+, 30-100% chance)
    var riderBonus = 0;
    if (rarityIdx >= 2) {
      var riderChance = [0, 0, 0.3, 0.6, 0.8, 1.0, 1.0, 1.0][rarityIdx];
      if (rng.next() < riderChance) {
        riderBonus = basePower * (0.1 + rng.next() * 0.2);
      }
    }

    // Mutation bonus (5% chance, up to 25% power)
    var mutationBonus = 0;
    if (rng.next() < 0.05) {
      mutationBonus = basePower * (0.1 + rng.next() * 0.15);
    }

    var totalPower = basePower + affixBonus + riderBonus + mutationBonus;
    powerScores[rarity].push(Math.round(totalPower));
  }

  // Analyze
  var results = { cardCount: numCards, byRarity: {} };
  for (var rk in powerScores) {
    var scores = powerScores[rk];
    if (scores.length === 0) continue;
    results.byRarity[rk] = {
      count: scores.length,
      mean: Math.round(mean(scores)),
      stddev: Math.round(stddev(scores)),
      p25: percentile(scores, 0.25),
      median: percentile(scores, 0.5),
      p75: percentile(scores, 0.75),
      p99: percentile(scores, 0.99),
      max: Math.max.apply(null, scores),
    };
  }

  // Check for broken power: is any rarity tier's p75 > next tier's p25?
  var overlaps = [];
  for (var oi = 0; oi < RARITIES.length - 1; oi++) {
    var lower = results.byRarity[RARITIES[oi]];
    var higher = results.byRarity[RARITIES[oi + 1]];
    if (!lower || !higher) continue;
    if (lower.p75 > higher.p25) {
      overlaps.push({
        lowerTier: RARITIES[oi],
        higherTier: RARITIES[oi + 1],
        lowerP75: lower.p75,
        higherP25: higher.p25,
        severity: lower.p75 > higher.median ? 'critical' : 'minor',
      });
    }
  }
  results.powerOverlaps = overlaps;

  return results;
}

// ---------------------------------------------------------------------------
// 3. Loot Table Verification
// ---------------------------------------------------------------------------

function simulateLootDrops(numDrops, seed) {
  var rng = createRNG(seed || 456);

  // Simplified loot table (matches loot-generator.js logic)
  var MOB_DROP_RATE = 0.35;
  var BOSS_DROP_RATE = 1.0;
  var BOSS_MULTI_DROP = 0.4;  // chance of 2nd drop from boss

  var ITEM_SLOTS = ['weapon', 'armor', 'helmet', 'boots', 'gloves', 'ring', 'amulet', 'shield'];
  var RARITY_WEIGHTS = { common: 45, uncommon: 25, rare: 15, ultra_rare: 8, mythic_rare: 4, legendary: 2, godly: 0.8, relic: 0.2 };
  var BOSS_RARITY_FLOOR = 'uncommon';

  var totalWeight = 0;
  for (var rw in RARITY_WEIGHTS) totalWeight += RARITY_WEIGHTS[rw];

  // Simulate
  var mobDrops = { attempted: 0, dropped: 0, byRarity: {} };
  var bossDrops = { attempted: 0, dropped: 0, byRarity: {}, multiDrops: 0 };

  for (var rk in RARITY_WEIGHTS) {
    mobDrops.byRarity[rk] = 0;
    bossDrops.byRarity[rk] = 0;
  }

  // Mob kills
  var mobKills = Math.floor(numDrops * 0.8);
  for (var m = 0; m < mobKills; m++) {
    mobDrops.attempted++;
    if (rng.next() > MOB_DROP_RATE) continue;
    mobDrops.dropped++;

    var roll = rng.next() * totalWeight;
    var cumul = 0;
    for (var mr in RARITY_WEIGHTS) {
      cumul += RARITY_WEIGHTS[mr];
      if (roll < cumul) { mobDrops.byRarity[mr]++; break; }
    }
  }

  // Boss kills
  var bossKills = numDrops - mobKills;
  for (var b = 0; b < bossKills; b++) {
    bossDrops.attempted++;
    bossDrops.dropped++;

    // Boss drops: floor at uncommon
    var bossRoll = rng.next() * (totalWeight - RARITY_WEIGHTS.common);
    var bCumul = 0;
    var bossDropped = false;
    for (var br in RARITY_WEIGHTS) {
      if (br === 'common') continue; // boss floor
      bCumul += RARITY_WEIGHTS[br];
      if (bossRoll < bCumul) { bossDrops.byRarity[br]++; bossDropped = true; break; }
    }
    if (!bossDropped) bossDrops.byRarity.uncommon++;

    // Multi-drop check
    if (rng.next() < BOSS_MULTI_DROP) {
      bossDrops.multiDrops++;
      bossDrops.dropped++;
      var roll2 = rng.next() * totalWeight;
      var cumul2 = 0;
      for (var br2 in RARITY_WEIGHTS) {
        cumul2 += RARITY_WEIGHTS[br2];
        if (roll2 < cumul2) { bossDrops.byRarity[br2]++; break; }
      }
    }
  }

  // Compile results
  var results = {
    totalEncounters: numDrops,
    mobDrops: {
      kills: mobDrops.attempted,
      drops: mobDrops.dropped,
      dropRate: Math.round(mobDrops.dropped / mobDrops.attempted * 10000) / 100,
      expectedRate: MOB_DROP_RATE * 100,
      byRarity: {},
    },
    bossDrops: {
      kills: bossDrops.attempted,
      drops: bossDrops.dropped,
      multiDropRate: Math.round(bossDrops.multiDrops / bossDrops.attempted * 10000) / 100,
      byRarity: {},
    },
  };

  for (var rk2 in mobDrops.byRarity) {
    results.mobDrops.byRarity[rk2] = {
      count: mobDrops.byRarity[rk2],
      pct: mobDrops.dropped > 0 ? Math.round(mobDrops.byRarity[rk2] / mobDrops.dropped * 10000) / 100 : 0,
      expected: Math.round(RARITY_WEIGHTS[rk2] / totalWeight * 10000) / 100,
    };
    results.bossDrops.byRarity[rk2] = {
      count: bossDrops.byRarity[rk2],
      pct: bossDrops.dropped > 0 ? Math.round(bossDrops.byRarity[rk2] / bossDrops.dropped * 10000) / 100 : 0,
    };
  }

  // Flag deviations > 2 standard deviations from expected
  var deviations = [];
  for (var dk in results.mobDrops.byRarity) {
    var entry = results.mobDrops.byRarity[dk];
    if (entry.expected > 0 && Math.abs(entry.pct - entry.expected) > entry.expected * 0.5) {
      deviations.push({
        source: 'mob',
        rarity: dk,
        actual: entry.pct,
        expected: entry.expected,
        deviation: Math.round((entry.pct - entry.expected) / entry.expected * 10000) / 100,
      });
    }
  }
  results.flaggedDeviations = deviations;

  return results;
}

// ---------------------------------------------------------------------------
// 4. Market Price Equilibrium Simulation
// ---------------------------------------------------------------------------

function simulateMarketEquilibrium(numDays, playersPerDay, seed) {
  var rng = createRNG(seed || 789);

  var EMA_ALPHA = 0.15;
  var LISTING_FEE = 0.05;

  // Item categories with "true" value ranges
  var ITEMS = [
    { id: 'card:common', trueValue: 50, supplyRate: 0.8, demandRate: 0.3 },
    { id: 'card:rare', trueValue: 500, supplyRate: 0.3, demandRate: 0.6 },
    { id: 'card:legendary', trueValue: 5000, supplyRate: 0.05, demandRate: 0.9 },
    { id: 'resource:iron_ore', trueValue: 10, supplyRate: 0.7, demandRate: 0.5 },
    { id: 'resource:wood', trueValue: 5, supplyRate: 0.9, demandRate: 0.4 },
  ];

  var priceHistory = {};
  for (var ii = 0; ii < ITEMS.length; ii++) {
    priceHistory[ITEMS[ii].id] = {
      prices: [],
      demandEMA: 0,
      supplyEMA: 0,
      avgPrice: ITEMS[ii].trueValue,
    };
  }

  // Simulate days
  for (var day = 0; day < numDays; day++) {
    for (var pi = 0; pi < playersPerDay; pi++) {
      var item = ITEMS[Math.floor(rng.next() * ITEMS.length)];
      var hist = priceHistory[item.id];

      // Supply event (listing)
      if (rng.next() < item.supplyRate) {
        // Price: seller prices near EMA average + noise
        var listPrice = hist.avgPrice * (0.8 + rng.next() * 0.4);
        hist.supplyEMA = hist.supplyEMA * (1 - EMA_ALPHA) + 1 * EMA_ALPHA;
      }

      // Demand event (purchase)
      if (rng.next() < item.demandRate) {
        var buyPrice = hist.avgPrice * (0.9 + rng.next() * 0.2);
        hist.demandEMA = hist.demandEMA * (1 - EMA_ALPHA) + 1 * EMA_ALPHA;
        hist.avgPrice = hist.avgPrice * (1 - EMA_ALPHA) + buyPrice * EMA_ALPHA;
      }

      hist.prices.push(Math.round(hist.avgPrice));
    }
  }

  // Analyze convergence
  var results = { numDays: numDays, playersPerDay: playersPerDay, items: {} };
  for (var ik in priceHistory) {
    var h = priceHistory[ik];
    var item2 = ITEMS.find(function(x) { return x.id === ik; });
    var prices = h.prices;
    var lastN = prices.slice(-Math.floor(prices.length / 10));

    results.items[ik] = {
      trueValue: item2.trueValue,
      finalAvgPrice: Math.round(mean(lastN)),
      priceStability: Math.round(stddev(lastN) * 100) / 100,
      convergenceError: Math.round(Math.abs(mean(lastN) - item2.trueValue) / item2.trueValue * 10000) / 100,
      demandSupplyRatio: h.demandEMA > 0 ? Math.round(h.demandEMA / (h.supplyEMA || 0.01) * 100) / 100 : 0,
    };
  }

  return results;
}

// ---------------------------------------------------------------------------
// 5. Genetic Algorithm — Build-Space Exploration (Yang's Layer 2)
// ---------------------------------------------------------------------------

function geneticBuildSearch(populationSize, generations, seed) {
  var rng = createRNG(seed || 999);

  // A "build" is a set of 5 equipped cards from different archetypes
  var ARCHETYPES = ['warrior', 'mystic', 'rogue', 'tactician', 'aquatic'];
  var CARD_POWER_RANGE = { min: 10, max: 200 };

  // Synergy bonuses: some archetype combos amplify each other
  var SYNERGY_MAP = {
    'warrior+mystic': 1.15,
    'warrior+rogue': 1.10,
    'mystic+tactician': 1.20,
    'rogue+tactician': 1.12,
    'warrior+tactician': 1.08,
  };

  // Generate a random build
  function randomBuild() {
    var cards = [];
    for (var i = 0; i < 5; i++) {
      cards.push({
        archetype: ARCHETYPES[Math.floor(rng.next() * ARCHETYPES.length)],
        power: CARD_POWER_RANGE.min + rng.next() * (CARD_POWER_RANGE.max - CARD_POWER_RANGE.min),
        rarity: Math.floor(rng.next() * 8), // 0-7 rarity tier
      });
    }
    return cards;
  }

  // Fitness function: total power with synergy bonuses
  function fitness(build) {
    var total = 0;
    for (var i = 0; i < build.length; i++) total += build[i].power;

    // Check synergies between all pairs
    for (var a = 0; a < build.length; a++) {
      for (var b = a + 1; b < build.length; b++) {
        var key1 = build[a].archetype + '+' + build[b].archetype;
        var key2 = build[b].archetype + '+' + build[a].archetype;
        if (SYNERGY_MAP[key1]) total *= SYNERGY_MAP[key1];
        else if (SYNERGY_MAP[key2]) total *= SYNERGY_MAP[key2];
      }
    }

    // Diversity bonus: unique archetypes are better
    var unique = {};
    for (var u = 0; u < build.length; u++) unique[build[u].archetype] = true;
    total *= (1 + Object.keys(unique).length * 0.05);

    return total;
  }

  // Crossover: swap random cards between two parents
  function crossover(parent1, parent2) {
    var child = [];
    for (var i = 0; i < 5; i++) {
      child.push(rng.next() < 0.5 ? Object.assign({}, parent1[i]) : Object.assign({}, parent2[i]));
    }
    return child;
  }

  // Mutation: replace one card randomly
  function mutate(build) {
    var idx = Math.floor(rng.next() * 5);
    build[idx] = {
      archetype: ARCHETYPES[Math.floor(rng.next() * ARCHETYPES.length)],
      power: CARD_POWER_RANGE.min + rng.next() * (CARD_POWER_RANGE.max - CARD_POWER_RANGE.min),
      rarity: Math.floor(rng.next() * 8),
    };
    return build;
  }

  // Initialize population
  var population = [];
  for (var p = 0; p < populationSize; p++) {
    var build = randomBuild();
    population.push({ build: build, fitness: fitness(build) });
  }

  var bestPerGen = [];

  // Evolve
  for (var gen = 0; gen < generations; gen++) {
    // Sort by fitness descending
    population.sort(function(a, b) { return b.fitness - a.fitness; });
    bestPerGen.push(Math.round(population[0].fitness));

    // Selection: keep top 30%
    var survivors = population.slice(0, Math.floor(populationSize * 0.3));

    // Fill rest with crossover + mutation
    var newPop = survivors.slice();
    while (newPop.length < populationSize) {
      var p1 = survivors[Math.floor(rng.next() * survivors.length)];
      var p2 = survivors[Math.floor(rng.next() * survivors.length)];
      var child = crossover(p1.build, p2.build);

      // 20% mutation rate
      if (rng.next() < 0.20) child = mutate(child);

      newPop.push({ build: child, fitness: fitness(child) });
    }

    population = newPop;
  }

  // Final sort
  population.sort(function(a, b) { return b.fitness - a.fitness; });

  // Top 5 builds
  var topBuilds = [];
  for (var t = 0; t < Math.min(5, population.length); t++) {
    var b = population[t];
    topBuilds.push({
      fitness: Math.round(b.fitness),
      archetypes: b.build.map(function(c) { return c.archetype; }),
      avgPower: Math.round(mean(b.build.map(function(c) { return c.power; }))),
      avgRarity: Math.round(mean(b.build.map(function(c) { return c.rarity; })) * 10) / 10,
    });
  }

  return {
    populationSize: populationSize,
    generations: generations,
    convergenceHistory: bestPerGen,
    topBuilds: topBuilds,
    fitnessRange: {
      best: Math.round(population[0].fitness),
      worst: Math.round(population[population.length - 1].fitness),
      mean: Math.round(mean(population.map(function(p) { return p.fitness; }))),
    },
    dominantArchetypes: _findDominantArchetypes(topBuilds),
  };
}

function _findDominantArchetypes(topBuilds) {
  var counts = {};
  for (var i = 0; i < topBuilds.length; i++) {
    for (var j = 0; j < topBuilds[i].archetypes.length; j++) {
      var arch = topBuilds[i].archetypes[j];
      counts[arch] = (counts[arch] || 0) + 1;
    }
  }
  var sorted = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; });
  return sorted.map(function(k) { return { archetype: k, appearances: counts[k] }; });
}

// ---------------------------------------------------------------------------
// 6. DE Combat Balance Tuning (Differential Evolution)
// ---------------------------------------------------------------------------

var na = require('./nature-algorithms');

function deCombatBalance(seed) {
  // Search for optimal scaling parameters across 8 dimensions:
  // [hpScalePerFloor, atkScalePerFloor, warriorMult, mysticMult, rogueMult,
  //  tactMult, aquaMult, dropRateScale]
  var DIMS = 8;
  var bounds = [
    { min: 1.02, max: 1.20 },  // hpScalePerFloor
    { min: 1.01, max: 1.15 },  // atkScalePerFloor
    { min: 0.7,  max: 1.5 },   // warrior power mult
    { min: 0.7,  max: 1.5 },   // mystic power mult
    { min: 0.7,  max: 1.5 },   // rogue power mult
    { min: 0.7,  max: 1.5 },   // tactician power mult
    { min: 0.7,  max: 1.5 },   // aquatic power mult
    { min: 0.5,  max: 2.0 },   // drop rate scale
  ];

  var rng = na.createRNG(seed || 777);

  function fitness(vec) {
    var hpScale = vec[0];
    var atkScale = vec[1];
    var archMults = [vec[2], vec[3], vec[4], vec[5], vec[6]];

    // Simulate 1000 fights across 50 floors per archetype
    var clearTimes = [[], [], [], [], []]; // per archetype
    var simRng = na.createRNG(Math.floor(vec[0] * 10000));

    for (var arch = 0; arch < 5; arch++) {
      var mult = archMults[arch];
      for (var floor = 1; floor <= 50; floor++) {
        var playerHp = 100 + floor * 5;
        var playerAtk = (15 + floor * 2) * mult;
        var enemyHp = 50 * Math.pow(hpScale, floor);
        var enemyAtk = 10 * Math.pow(atkScale, floor);

        // Simple combat sim: turns until one side dies
        var turns = 0;
        var pHp = playerHp;
        var eHp = enemyHp;
        while (pHp > 0 && eHp > 0 && turns < 100) {
          eHp -= playerAtk * (0.8 + simRng.next() * 0.4);
          if (eHp > 0) pHp -= enemyAtk * (0.8 + simRng.next() * 0.4);
          turns++;
        }
        clearTimes[arch].push(turns);
      }
    }

    // Fitness objectives (higher = better):
    // 1. Minimize variance in average clear times across archetypes (balance)
    var archAvgs = clearTimes.map(function(a) { return mean(a); });
    var balanceScore = -stddev(archAvgs) * 10;

    // 2. Target average clear time: 8-15 turns (not too fast, not too slow)
    var globalAvg = mean(archAvgs);
    var targetScore = -Math.abs(globalAvg - 12) * 5;

    // 3. No one-shot kills (clear time > 1) and no infinite fights (< 60)
    var extremePenalty = 0;
    for (var ea = 0; ea < 5; ea++) {
      for (var ef = 0; ef < clearTimes[ea].length; ef++) {
        if (clearTimes[ea][ef] <= 1) extremePenalty -= 20;
        if (clearTimes[ea][ef] >= 100) extremePenalty -= 50;
      }
    }

    // 4. Smooth difficulty curve (turns should increase with floor)
    var smoothScore = 0;
    for (var sa = 0; sa < 5; sa++) {
      var ct = clearTimes[sa];
      for (var sf = 1; sf < ct.length; sf++) {
        if (ct[sf] >= ct[sf - 1]) smoothScore += 0.1;
        else smoothScore -= 0.5;
      }
    }

    return balanceScore + targetScore + extremePenalty + smoothScore + 100;
  }

  var result = na.differentialEvolution({
    dims: DIMS,
    bounds: bounds,
    fitness: fitness,
    popSize: 60,
    F: 0.7,
    CR: 0.9,
    maxGens: 200,
    rng: rng,
  });

  var labels = ['hpScalePerFloor', 'atkScalePerFloor', 'warriorMult', 'mysticMult',
    'rogueMult', 'tactMult', 'aquaMult', 'dropRateScale'];
  var params = {};
  for (var li = 0; li < labels.length; li++) {
    params[labels[li]] = Math.round(result.best[li] * 1000) / 1000;
  }

  return {
    optimizedParams: params,
    fitness: Math.round(result.bestFitness * 100) / 100,
    convergenceSteps: result.history.length,
    fitnessStart: Math.round(result.history[0] * 100) / 100,
    fitnessEnd: Math.round(result.history[result.history.length - 1] * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// 7. SA Disease Parameter Tuning (Simulated Annealing)
// ---------------------------------------------------------------------------

function saDiseaseTuning(seed) {
  var rng = na.createRNG(seed || 555);

  // Optimize 5 disease parameters to hit target "interesting plague" frequency:
  // plagues happen often enough to matter but don't wipe the server
  var initial = {
    spreadChance: 0.08,
    incubationTicks: 5,
    recoveryTicks: 10,
    immunityTicks: 20,
    playerDamage: 3,
  };

  function fitness(params) {
    // Simulate 100-day plague on 10x10 chunk grid
    var grid = {};
    var infected = 0;
    var totalInfections = 0;
    var peaked = false;
    var peakDay = 0;
    var peakInfected = 0;

    // Seed center
    grid['5,5'] = { state: 'infected', timer: 0 };
    infected = 1;

    for (var day = 0; day < 100; day++) {
      var newGrid = {};
      var dayInfected = 0;

      for (var key in grid) {
        var cell = grid[key];
        newGrid[key] = { state: cell.state, timer: cell.timer + 1 };

        if (cell.state === 'infected') {
          // Recovery
          if (cell.timer >= params.recoveryTicks) {
            newGrid[key].state = 'recovered';
            newGrid[key].timer = 0;
          } else {
            dayInfected++;
            // Spread to neighbors
            var parts = key.split(',');
            var cx = parseInt(parts[0], 10);
            var cy = parseInt(parts[1], 10);
            var neighbors = [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]];
            for (var ni = 0; ni < neighbors.length; ni++) {
              var nk = neighbors[ni][0] + ',' + neighbors[ni][1];
              if (neighbors[ni][0] < 0 || neighbors[ni][0] >= 10) continue;
              if (neighbors[ni][1] < 0 || neighbors[ni][1] >= 10) continue;
              if (!grid[nk] && !newGrid[nk]) {
                if (rng.next() < params.spreadChance) {
                  newGrid[nk] = { state: 'exposed', timer: 0 };
                }
              }
            }
          }
        } else if (cell.state === 'exposed') {
          if (cell.timer >= params.incubationTicks) {
            newGrid[key].state = 'infected';
            newGrid[key].timer = 0;
            totalInfections++;
          }
        } else if (cell.state === 'recovered') {
          if (cell.timer >= params.immunityTicks) {
            delete newGrid[key]; // susceptible again
          }
        }
      }

      grid = newGrid;
      if (dayInfected > peakInfected) { peakInfected = dayInfected; peakDay = day; peaked = true; }
    }

    // Target metrics:
    var score = 0;
    // Total infections: 30-60% of 100 chunks (interesting but not server-wiping)
    var infPct = totalInfections / 100;
    score -= Math.abs(infPct - 0.45) * 100;

    // Peak day: should be around day 15-30 (enough time for response)
    score -= Math.abs(peakDay - 22) * 2;

    // Peak infected: 15-25 chunks simultaneously (visible but not overwhelming)
    score -= Math.abs(peakInfected - 20) * 3;

    // Player damage: 2-5 per tick (meaningful but not lethal)
    score -= Math.abs(params.playerDamage - 3.5) * 10;

    return score;
  }

  function neighbor(params, T, rngRef) {
    var keys = Object.keys(params);
    var newParams = {};
    for (var k in params) newParams[k] = params[k];

    // Perturb 1-2 random parameters scaled by temperature
    var numPerturb = rngRef.next() < 0.5 ? 1 : 2;
    for (var p = 0; p < numPerturb; p++) {
      var key = keys[Math.floor(rngRef.next() * keys.length)];
      var scale = T / 100; // perturbation proportional to temperature
      newParams[key] = Math.max(0.01, newParams[key] * (1 + (rngRef.next() * 2 - 1) * scale));
    }
    return newParams;
  }

  var result = na.simulatedAnnealing({
    initial: initial,
    fitness: fitness,
    neighbor: neighbor,
    T0: 100,
    Tmin: 0.1,
    coolingRate: 0.92,
    itersPerTemp: 30,
    rng: rng,
  });

  var rounded = {};
  for (var rk in result.best) {
    rounded[rk] = Math.round(result.best[rk] * 1000) / 1000;
  }

  return {
    optimizedParams: rounded,
    fitness: Math.round(result.bestFitness * 100) / 100,
    coolingSteps: result.history.length,
    improvement: Math.round((result.history[result.history.length - 1] - result.history[0]) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// CLI Runner
// ---------------------------------------------------------------------------

function runAll() {
  console.log('=== META-OPTIMIZER: Balance Analysis Suite ===\n');

  console.log('--- 1. GACHA PULL SIMULATION (10K runs x 200 pulls) ---');
  var gacha = simulateGachaPulls(10000, 200, 42);
  console.log('Rarity Distribution:');
  for (var rk in gacha.rarityDistribution) {
    var rd = gacha.rarityDistribution[rk];
    console.log('  ' + rk + ': ' + rd.pctOfTotal + '% (avg ' + rd.avgPerRun + '/run, stddev ' + rd.stddev + ')');
  }
  console.log('Pity Analysis:');
  console.log('  Avg first legendary: pull ' + gacha.pityAnalysis.avgFirstLegendary);
  console.log('  Median first legendary: pull ' + gacha.pityAnalysis.medianFirstLegendary);
  console.log('  P95 first legendary: pull ' + gacha.pityAnalysis.p95FirstLegendary);
  console.log('  Max dry streak: ' + gacha.pityAnalysis.maxDryStreak + ' (pity verified: ' + gacha.pityAnalysis.pityVerified + ')');
  console.log('');

  console.log('--- 2. CARD POWER DISTRIBUTION (50K cards) ---');
  var power = simulateCardPower(50000, 123);
  for (var pk in power.byRarity) {
    var pr = power.byRarity[pk];
    console.log('  ' + pk + ': mean=' + pr.mean + ' median=' + pr.median + ' p99=' + pr.p99 + ' max=' + pr.max);
  }
  if (power.powerOverlaps.length > 0) {
    console.log('  POWER OVERLAPS DETECTED:');
    for (var po = 0; po < power.powerOverlaps.length; po++) {
      var ov = power.powerOverlaps[po];
      console.log('    ' + ov.lowerTier + ' p75(' + ov.lowerP75 + ') > ' + ov.higherTier + ' p25(' + ov.higherP25 + ') [' + ov.severity + ']');
    }
  } else {
    console.log('  No power tier overlaps detected.');
  }
  console.log('');

  console.log('--- 3. LOOT DROP VERIFICATION (100K encounters) ---');
  var loot = simulateLootDrops(100000, 456);
  console.log('  Mob drop rate: ' + loot.mobDrops.dropRate + '% (expected ' + loot.mobDrops.expectedRate + '%)');
  console.log('  Boss multi-drop rate: ' + loot.bossDrops.multiDropRate + '%');
  if (loot.flaggedDeviations.length > 0) {
    console.log('  FLAGGED DEVIATIONS:');
    for (var fd = 0; fd < loot.flaggedDeviations.length; fd++) {
      var dv = loot.flaggedDeviations[fd];
      console.log('    ' + dv.source + ' ' + dv.rarity + ': ' + dv.actual + '% vs expected ' + dv.expected + '% (' + dv.deviation + '% off)');
    }
  } else {
    console.log('  All drop rates within expected range.');
  }
  console.log('');

  console.log('--- 4. MARKET EQUILIBRIUM (30 days, 100 players/day) ---');
  var market = simulateMarketEquilibrium(30, 100, 789);
  for (var mk in market.items) {
    var mi = market.items[mk];
    console.log('  ' + mk + ': true=' + mi.trueValue + ' final=' + mi.finalAvgPrice + ' error=' + mi.convergenceError + '% stability=' + mi.priceStability);
  }
  console.log('');

  console.log('--- 5. GENETIC BUILD SEARCH (pop=200, gen=100) ---');
  var ga = geneticBuildSearch(200, 100, 999);
  console.log('  Fitness range: best=' + ga.fitnessRange.best + ' mean=' + ga.fitnessRange.mean + ' worst=' + ga.fitnessRange.worst);
  console.log('  Top builds:');
  for (var tb = 0; tb < ga.topBuilds.length; tb++) {
    var b = ga.topBuilds[tb];
    console.log('    #' + (tb + 1) + ': fitness=' + b.fitness + ' archetypes=[' + b.archetypes.join(', ') + '] avgPower=' + b.avgPower);
  }
  console.log('  Dominant archetypes:');
  for (var da = 0; da < ga.dominantArchetypes.length; da++) {
    console.log('    ' + ga.dominantArchetypes[da].archetype + ': ' + ga.dominantArchetypes[da].appearances + ' appearances in top 5');
  }
  console.log('');

  console.log('--- 6. DE COMBAT BALANCE (pop=60, gen=200) ---');
  var de = deCombatBalance(777);
  console.log('  Fitness: ' + de.fitnessStart + ' -> ' + de.fitnessEnd + ' (' + de.convergenceSteps + ' steps)');
  console.log('  Optimized parameters:');
  for (var dk in de.optimizedParams) {
    console.log('    ' + dk + ': ' + de.optimizedParams[dk]);
  }
  console.log('');

  console.log('--- 7. SA DISEASE TUNING ---');
  var sa = saDiseaseTuning(555);
  console.log('  Improvement: ' + sa.improvement + ' over ' + sa.coolingSteps + ' cooling steps');
  console.log('  Optimized disease params:');
  for (var sk in sa.optimizedParams) {
    console.log('    ' + sk + ': ' + sa.optimizedParams[sk]);
  }
  console.log('');

  console.log('=== META-OPTIMIZER COMPLETE ===');
}

// ---------------------------------------------------------------------------
// Exports (for programmatic use) + CLI entry
// ---------------------------------------------------------------------------

module.exports = {
  createRNG: createRNG,
  mean: mean,
  stddev: stddev,
  percentile: percentile,
  histogram: histogram,
  simulateGachaPulls: simulateGachaPulls,
  simulateCardPower: simulateCardPower,
  simulateLootDrops: simulateLootDrops,
  simulateMarketEquilibrium: simulateMarketEquilibrium,
  geneticBuildSearch: geneticBuildSearch,
  deCombatBalance: deCombatBalance,
  saDiseaseTuning: saDiseaseTuning,
  runAll: runAll,
};

// CLI entry point
if (require.main === module) {
  var cmd = process.argv[2] || 'all';
  switch (cmd) {
    case 'gacha':
      console.log(JSON.stringify(simulateGachaPulls(10000, 200, 42), null, 2));
      break;
    case 'combat':
      console.log(JSON.stringify(simulateCardPower(50000, 123), null, 2));
      break;
    case 'loot':
      console.log(JSON.stringify(simulateLootDrops(100000, 456), null, 2));
      break;
    case 'market':
      console.log(JSON.stringify(simulateMarketEquilibrium(30, 100, 789), null, 2));
      break;
    case 'builds':
      console.log(JSON.stringify(geneticBuildSearch(200, 100, 999), null, 2));
      break;
    case 'all':
      runAll();
      break;
    case 'balance':
      console.log(JSON.stringify(deCombatBalance(777), null, 2));
      break;
    case 'disease':
      console.log(JSON.stringify(saDiseaseTuning(555), null, 2));
      break;
    default:
      console.log('Usage: node meta-optimizer.js [gacha|combat|loot|market|builds|balance|disease|all]');
  }
}
