// nature-algorithms.js
// Core nature-inspired optimization algorithms (Yang's framework).
// Layer 2 meta-optimization + selective Layer 1 runtime use.
//
// Algorithms:
//   DE  — Differential Evolution (balance tuning, scaling curve search)
//   BA  — Bat Algorithm (adaptive director thresholds)
//   GA  — Genetic Algorithm (build-space exploration, pet evolution variance)
//   SA  — Simulated Annealing (parameter search, equilibrium finding)
//   ACO — Ant Colony Optimization (NPC patrol pathing, pheromone trails)

'use strict';

// ---------------------------------------------------------------------------
// Shared PRNG — xorshift128 for reproducible offline simulations
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 1. Differential Evolution (DE/rand/1/bin)
// ---------------------------------------------------------------------------
// Storn & Price, 1997. Self-adaptive step sizes via population difference vectors.
// Best for: high-dimensional continuous optimization (combat balance, drop rates).

/**
 * @param {object} opts
 *   dims       {number}     - number of dimensions
 *   bounds     {Array}      - [{min,max}] per dimension
 *   fitness    {Function}   - fitness(vector) -> number (higher = better)
 *   popSize    {number}     - population size (default: 10 * dims)
 *   F          {number}     - mutation scaling factor (default: 0.7)
 *   CR         {number}     - crossover rate (default: 0.9)
 *   maxGens    {number}     - max generations (default: 500)
 *   rng        {object}     - optional seeded RNG
 * @returns {object} { best, bestFitness, history }
 */
function differentialEvolution(opts) {
  var dims = opts.dims;
  var bounds = opts.bounds;
  var fitFn = opts.fitness;
  var NP = opts.popSize || dims * 10;
  var F = opts.F !== undefined ? opts.F : 0.7;
  var CR = opts.CR !== undefined ? opts.CR : 0.9;
  var maxGens = opts.maxGens || 500;
  var rng = opts.rng || { next: Math.random };

  // Initialize population within bounds
  var pop = [];
  var fitnesses = [];
  for (var i = 0; i < NP; i++) {
    var vec = new Array(dims);
    for (var d = 0; d < dims; d++) {
      vec[d] = bounds[d].min + rng.next() * (bounds[d].max - bounds[d].min);
    }
    pop.push(vec);
    fitnesses.push(fitFn(vec));
  }

  var bestIdx = 0;
  for (var bi = 1; bi < NP; bi++) {
    if (fitnesses[bi] > fitnesses[bestIdx]) bestIdx = bi;
  }

  var history = [fitnesses[bestIdx]];

  // Evolution loop
  for (var gen = 0; gen < maxGens; gen++) {
    for (var target = 0; target < NP; target++) {
      // Pick 3 distinct random indices != target
      var r1, r2, r3;
      do { r1 = Math.floor(rng.next() * NP); } while (r1 === target);
      do { r2 = Math.floor(rng.next() * NP); } while (r2 === target || r2 === r1);
      do { r3 = Math.floor(rng.next() * NP); } while (r3 === target || r3 === r1 || r3 === r2);

      // Mutant vector: v = x_r1 + F * (x_r2 - x_r3)
      var mutant = new Array(dims);
      for (var md = 0; md < dims; md++) {
        mutant[md] = pop[r1][md] + F * (pop[r2][md] - pop[r3][md]);
        // Clamp to bounds
        if (mutant[md] < bounds[md].min) mutant[md] = bounds[md].min;
        if (mutant[md] > bounds[md].max) mutant[md] = bounds[md].max;
      }

      // Binomial crossover
      var trial = new Array(dims);
      var jrand = Math.floor(rng.next() * dims); // guarantee at least one from mutant
      for (var cd = 0; cd < dims; cd++) {
        trial[cd] = (rng.next() < CR || cd === jrand) ? mutant[cd] : pop[target][cd];
      }

      // Selection
      var trialFit = fitFn(trial);
      if (trialFit >= fitnesses[target]) {
        pop[target] = trial;
        fitnesses[target] = trialFit;
        if (trialFit > fitnesses[bestIdx]) bestIdx = target;
      }
    }

    history.push(fitnesses[bestIdx]);
  }

  return {
    best: pop[bestIdx].slice(),
    bestFitness: fitnesses[bestIdx],
    history: history,
    finalPopulation: pop,
  };
}

// ---------------------------------------------------------------------------
// 2. Bat Algorithm (BA)
// ---------------------------------------------------------------------------
// Yang, 2010. Frequency-tuned echolocation with adaptive loudness/pulse rate.
// Best for: adaptive runtime parameter tuning (director tension thresholds).

/**
 * @param {object} opts
 *   dims       {number}     - number of dimensions
 *   bounds     {Array}      - [{min,max}] per dimension
 *   fitness    {Function}   - fitness(vector) -> number (higher = better)
 *   popSize    {number}     - bat count (default: 20)
 *   fMin       {number}     - min frequency (default: 0)
 *   fMax       {number}     - max frequency (default: 2)
 *   A0         {number}     - initial loudness (default: 0.9)
 *   r0         {number}     - initial pulse rate (default: 0.1)
 *   alpha      {number}     - loudness decay (default: 0.9)
 *   gamma      {number}     - pulse rate growth (default: 0.9)
 *   maxIter    {number}     - max iterations (default: 200)
 *   rng        {object}     - optional seeded RNG
 * @returns {object} { best, bestFitness, history, bats }
 */
function batAlgorithm(opts) {
  var dims = opts.dims;
  var bounds = opts.bounds;
  var fitFn = opts.fitness;
  var n = opts.popSize || 20;
  var fMin = opts.fMin !== undefined ? opts.fMin : 0;
  var fMax = opts.fMax !== undefined ? opts.fMax : 2;
  var A0 = opts.A0 !== undefined ? opts.A0 : 0.9;
  var r0 = opts.r0 !== undefined ? opts.r0 : 0.1;
  var alpha = opts.alpha !== undefined ? opts.alpha : 0.9;
  var gamma = opts.gamma !== undefined ? opts.gamma : 0.9;
  var maxIter = opts.maxIter || 200;
  var rng = opts.rng || { next: Math.random };

  // Initialize bats
  var bats = [];
  for (var i = 0; i < n; i++) {
    var pos = new Array(dims);
    var vel = new Array(dims);
    for (var d = 0; d < dims; d++) {
      pos[d] = bounds[d].min + rng.next() * (bounds[d].max - bounds[d].min);
      vel[d] = 0;
    }
    bats.push({
      position: pos,
      velocity: vel,
      frequency: fMin + rng.next() * (fMax - fMin),
      loudness: A0,
      pulseRate: r0,
      fitness: fitFn(pos),
    });
  }

  // Find global best
  var gBest = bats[0].position.slice();
  var gBestFit = bats[0].fitness;
  for (var gi = 1; gi < n; gi++) {
    if (bats[gi].fitness > gBestFit) {
      gBestFit = bats[gi].fitness;
      gBest = bats[gi].position.slice();
    }
  }

  var history = [gBestFit];

  // Main loop
  for (var iter = 0; iter < maxIter; iter++) {
    for (var bi = 0; bi < n; bi++) {
      var bat = bats[bi];

      // Update frequency
      bat.frequency = fMin + (fMax - fMin) * rng.next();

      // Update velocity and position
      var newPos = new Array(dims);
      for (var vd = 0; vd < dims; vd++) {
        bat.velocity[vd] += (bat.position[vd] - gBest[vd]) * bat.frequency;
        newPos[vd] = bat.position[vd] + bat.velocity[vd];
      }

      // Local search: if random > pulse rate, perturb around best
      if (rng.next() > bat.pulseRate) {
        var avgLoudness = 0;
        for (var al = 0; al < n; al++) avgLoudness += bats[al].loudness;
        avgLoudness /= n;
        for (var ld = 0; ld < dims; ld++) {
          newPos[ld] = gBest[ld] + (rng.next() * 2 - 1) * avgLoudness;
        }
      }

      // Clamp to bounds
      for (var cd = 0; cd < dims; cd++) {
        if (newPos[cd] < bounds[cd].min) newPos[cd] = bounds[cd].min;
        if (newPos[cd] > bounds[cd].max) newPos[cd] = bounds[cd].max;
      }

      var newFit = fitFn(newPos);

      // Accept if better AND random < loudness (accept probabilistically)
      if (rng.next() < bat.loudness && newFit > bat.fitness) {
        bat.position = newPos;
        bat.fitness = newFit;

        // Decrease loudness, increase pulse rate
        bat.loudness *= alpha;
        bat.pulseRate = r0 * (1 - Math.exp(-gamma * (iter + 1)));
      }

      // Update global best
      if (bat.fitness > gBestFit) {
        gBestFit = bat.fitness;
        gBest = bat.position.slice();
      }
    }

    history.push(gBestFit);
  }

  return {
    best: gBest,
    bestFitness: gBestFit,
    history: history,
    bats: bats.map(function(b) {
      return { position: b.position.slice(), fitness: b.fitness, loudness: b.loudness, pulseRate: b.pulseRate };
    }),
  };
}

// ---------------------------------------------------------------------------
// 3. Genetic Algorithm (GA)
// ---------------------------------------------------------------------------
// Holland, 1975. Crossover + mutation on discrete/continuous solution vectors.
// Best for: combinatorial optimization (build exploration, pet stat inheritance).

/**
 * @param {object} opts
 *   createIndividual  {Function}     - () -> individual
 *   fitness           {Function}     - (individual) -> number
 *   crossover         {Function}     - (parent1, parent2, rng) -> child
 *   mutate            {Function}     - (individual, rng) -> individual
 *   popSize           {number}       - population size (default: 100)
 *   eliteCount        {number}       - elites preserved (default: 5)
 *   mutationRate      {number}       - probability of mutation (default: 0.15)
 *   maxGens           {number}       - max generations (default: 200)
 *   rng               {object}       - optional seeded RNG
 * @returns {object} { best, bestFitness, history, diversity }
 */
function geneticAlgorithm(opts) {
  var createFn = opts.createIndividual;
  var fitFn = opts.fitness;
  var crossFn = opts.crossover;
  var mutateFn = opts.mutate;
  var popSize = opts.popSize || 100;
  var eliteCount = opts.eliteCount || 5;
  var mutationRate = opts.mutationRate || 0.15;
  var maxGens = opts.maxGens || 200;
  var rng = opts.rng || { next: Math.random };

  // Initialize
  var population = [];
  for (var i = 0; i < popSize; i++) {
    var ind = createFn(rng);
    population.push({ individual: ind, fitness: fitFn(ind) });
  }

  var history = [];

  for (var gen = 0; gen < maxGens; gen++) {
    // Sort descending by fitness
    population.sort(function(a, b) { return b.fitness - a.fitness; });
    history.push(population[0].fitness);

    // Elitism: keep top N
    var newPop = population.slice(0, eliteCount);

    // Tournament selection + crossover to fill rest
    while (newPop.length < popSize) {
      // Tournament: pick 3 random, keep best
      var p1 = _tournamentSelect(population, 3, rng);
      var p2 = _tournamentSelect(population, 3, rng);

      var child = crossFn(p1.individual, p2.individual, rng);

      // Mutation
      if (rng.next() < mutationRate) {
        child = mutateFn(child, rng);
      }

      newPop.push({ individual: child, fitness: fitFn(child) });
    }

    population = newPop;
  }

  // Final sort
  population.sort(function(a, b) { return b.fitness - a.fitness; });

  return {
    best: population[0].individual,
    bestFitness: population[0].fitness,
    history: history,
    topN: population.slice(0, 10).map(function(p) {
      return { individual: p.individual, fitness: p.fitness };
    }),
  };
}

function _tournamentSelect(pop, k, rng) {
  var best = null;
  for (var i = 0; i < k; i++) {
    var idx = Math.floor(rng.next() * pop.length);
    if (!best || pop[idx].fitness > best.fitness) best = pop[idx];
  }
  return best;
}

// ---------------------------------------------------------------------------
// 4. Simulated Annealing (SA)
// ---------------------------------------------------------------------------
// Kirkpatrick et al., 1983. Accept worse solutions probabilistically via temperature.
// Best for: single-solution trajectory search with many local optima.

/**
 * @param {object} opts
 *   initial    {any}        - initial solution
 *   fitness    {Function}   - fitness(solution) -> number (higher = better)
 *   neighbor   {Function}   - neighbor(solution, temperature, rng) -> solution
 *   T0         {number}     - initial temperature (default: 100)
 *   Tmin       {number}     - minimum temperature (default: 0.01)
 *   coolingRate {number}    - geometric cooling factor (default: 0.95)
 *   itersPerTemp {number}   - iterations per temperature level (default: 50)
 *   rng        {object}     - optional seeded RNG
 * @returns {object} { best, bestFitness, history, finalTemp }
 */
function simulatedAnnealing(opts) {
  var current = opts.initial;
  var fitFn = opts.fitness;
  var neighborFn = opts.neighbor;
  var T = opts.T0 || 100;
  var Tmin = opts.Tmin || 0.01;
  var coolingRate = opts.coolingRate || 0.95;
  var itersPerTemp = opts.itersPerTemp || 50;
  var rng = opts.rng || { next: Math.random };

  var currentFit = fitFn(current);
  var best = current;
  var bestFit = currentFit;
  var history = [bestFit];

  while (T > Tmin) {
    for (var i = 0; i < itersPerTemp; i++) {
      var candidate = neighborFn(current, T, rng);
      var candidateFit = fitFn(candidate);
      var delta = candidateFit - currentFit;

      // Accept if better, or probabilistically if worse
      if (delta > 0 || rng.next() < Math.exp(delta / T)) {
        current = candidate;
        currentFit = candidateFit;

        if (currentFit > bestFit) {
          best = current;
          bestFit = currentFit;
        }
      }
    }

    T *= coolingRate;
    history.push(bestFit);
  }

  return {
    best: best,
    bestFitness: bestFit,
    history: history,
    finalTemp: T,
  };
}

// ---------------------------------------------------------------------------
// 5. Ant Colony Optimization (ACO)
// ---------------------------------------------------------------------------
// Dorigo, 1992. Pheromone trails on graph edges guide ant path selection.
// Best for: graph-based pathing (NPC patrols, faction routes, horde movement).

/**
 * Create an ACO state for a chunk-grid-based world.
 * Pheromone is stored per 'cx,cy' key. Multiple factions share the grid
 * with separate pheromone layers.
 *
 * @param {object} opts
 *   factions       {Array}    - faction IDs (e.g. ['lich','luminary','bandit'])
 *   evaporationRate {number}  - pheromone decay per tick (default: 0.05)
 *   depositAmount  {number}   - pheromone deposited per ant step (default: 1.0)
 *   alpha          {number}   - pheromone importance (default: 1.0)
 *   beta           {number}   - heuristic importance (default: 2.0)
 *   initialPheromone {number} - starting pheromone on all edges (default: 0.1)
 * @returns {object} ACO state with methods
 */
function createACO(opts) {
  var factions = opts.factions || [];
  var evapRate = opts.evaporationRate || 0.05;
  var depositAmt = opts.depositAmount || 1.0;
  var alphaExp = opts.alpha || 1.0;
  var betaExp = opts.beta || 2.0;
  var initPheromone = opts.initialPheromone || 0.1;

  // pheromone[factionId]['cx,cy'] = level
  var pheromone = {};
  for (var fi = 0; fi < factions.length; fi++) {
    pheromone[factions[fi]] = {};
  }

  // Get pheromone level at a chunk for a faction
  function getPheromone(factionId, cx, cy) {
    var layer = pheromone[factionId];
    if (!layer) return initPheromone;
    var key = cx + ',' + cy;
    return layer[key] !== undefined ? layer[key] : initPheromone;
  }

  // Deposit pheromone at a chunk
  function deposit(factionId, cx, cy, amount) {
    if (!pheromone[factionId]) pheromone[factionId] = {};
    var key = cx + ',' + cy;
    pheromone[factionId][key] = (pheromone[factionId][key] || initPheromone) + (amount || depositAmt);
  }

  // Evaporate all pheromone (called each tick)
  function evaporate() {
    for (var fid in pheromone) {
      var layer = pheromone[fid];
      for (var key in layer) {
        layer[key] *= (1 - evapRate);
        if (layer[key] < initPheromone * 0.1) delete layer[key];
      }
    }
  }

  // Choose next chunk for an ant based on pheromone + heuristic
  // heuristicFn(cx, cy, targetCX, targetCY) -> desirability (higher = better)
  function chooseNext(factionId, currentCX, currentCY, candidates, heuristicFn, targetCX, targetCY) {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    var probs = new Array(candidates.length);
    var total = 0;

    for (var ci = 0; ci < candidates.length; ci++) {
      var c = candidates[ci];
      var tau = getPheromone(factionId, c.cx, c.cy);
      var eta = heuristicFn ? heuristicFn(c.cx, c.cy, targetCX, targetCY) : 1.0;

      // Repulsion: reduce attractiveness if enemy faction has pheromone here
      var repulsion = 1.0;
      for (var rfid in pheromone) {
        if (rfid === factionId) continue;
        var enemyPher = getPheromone(rfid, c.cx, c.cy);
        if (enemyPher > initPheromone * 2) {
          repulsion *= Math.max(0.1, 1.0 / (1 + enemyPher * 0.3));
        }
      }

      var prob = Math.pow(tau, alphaExp) * Math.pow(Math.max(0.01, eta), betaExp) * repulsion;
      probs[ci] = prob;
      total += prob;
    }

    if (total <= 0) return candidates[Math.floor(Math.random() * candidates.length)];

    // Roulette wheel selection
    var roll = Math.random() * total;
    var cumul = 0;
    for (var si = 0; si < candidates.length; si++) {
      cumul += probs[si];
      if (roll <= cumul) return candidates[si];
    }
    return candidates[candidates.length - 1];
  }

  // Get all pheromone data for a faction (for serialization / visualization)
  function getLayer(factionId) {
    return pheromone[factionId] || {};
  }

  // Get top-N pheromone chunks for a faction (patrol route visualization)
  function getHotspots(factionId, topN) {
    var layer = pheromone[factionId] || {};
    var entries = [];
    for (var key in layer) {
      entries.push({ key: key, level: layer[key] });
    }
    entries.sort(function(a, b) { return b.level - a.level; });
    return entries.slice(0, topN || 20);
  }

  // Reset a single faction's pheromone
  function resetFaction(factionId) {
    pheromone[factionId] = {};
  }

  // Reset all pheromone
  function resetAll() {
    for (var fid in pheromone) pheromone[fid] = {};
  }

  // Serialize state
  function getState() {
    return { pheromone: pheromone };
  }

  // Load state
  function loadState(saved) {
    if (saved && saved.pheromone) pheromone = saved.pheromone;
  }

  return {
    getPheromone: getPheromone,
    deposit: deposit,
    evaporate: evaporate,
    chooseNext: chooseNext,
    getLayer: getLayer,
    getHotspots: getHotspots,
    resetFaction: resetFaction,
    resetAll: resetAll,
    getState: getState,
    loadState: loadState,
  };
}

// ---------------------------------------------------------------------------
// GA helpers for pet evolution
// ---------------------------------------------------------------------------

// Crossover two stat objects: uniform crossover with normalization
function petStatCrossover(parentStats, templateStats, rng) {
  var rand = rng || { next: Math.random };
  var child = {};
  for (var key in templateStats) {
    // 60% template, 40% parent (biased toward species standard)
    if (rand.next() < 0.6) {
      child[key] = templateStats[key];
    } else {
      child[key] = parentStats[key] !== undefined ? parentStats[key] : templateStats[key];
    }
  }
  return child;
}

// Mutate pet stats: small random perturbation
function petStatMutate(stats, mutationStrength, happinessBias, rng) {
  var rand = rng || { next: Math.random };
  var mutated = {};
  for (var key in stats) {
    var val = stats[key];
    if (typeof val !== 'number') { mutated[key] = val; continue; }
    // ±10% perturbation, biased positive if happiness is high
    var perturbation = (rand.next() * 2 - 1) * mutationStrength * val;
    if (happinessBias > 0.5) perturbation = Math.abs(perturbation) * happinessBias;
    mutated[key] = Math.max(0, val + perturbation);
  }
  return mutated;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createRNG: createRNG,

  // Core algorithms
  differentialEvolution: differentialEvolution,
  batAlgorithm: batAlgorithm,
  geneticAlgorithm: geneticAlgorithm,
  simulatedAnnealing: simulatedAnnealing,
  createACO: createACO,

  // GA helpers
  petStatCrossover: petStatCrossover,
  petStatMutate: petStatMutate,
};
