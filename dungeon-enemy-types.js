'use strict';

var BOSS_MECHANICS = {
  resurrect: {
    id: 'resurrect',
    name: 'Undying Will',
    description: 'Resurrects once at 50% HP with new abilities',
    onDeath: function(boss) {
      if (!boss._hasResurrected) {
        boss._hasResurrected = true;
        boss.hp = Math.floor(boss.maxHp * 0.5);
        boss.name = boss.name + ' (Reborn)';
        if (boss.phases && boss.phases.length > 0) {
          var lastPhase = boss.phases[boss.phases.length - 1];
          if (lastPhase.abilities) boss.abilities = lastPhase.abilities;
        }
        boss.atk = Math.floor(boss.atk * 1.3);
        boss.changed = true;
        return { resurrected: true, message: boss.name + ' refuses to die!' };
      }
      return null;
    },
  },

  death_aoe: {
    id: 'death_aoe',
    name: 'Lingering Doom',
    description: 'Leaves a damaging zone for 8 turns after death',
    onDeath: function(boss) {
      return {
        deathZone: true,
        zoneX: boss.x,
        zoneY: boss.y,
        zoneRadius: 3,
        zoneDamage: Math.floor(boss.atk * 0.4),
        zoneDuration: 8,
        message: 'The ground seethes with ' + (boss.element || 'dark') + ' energy!',
      };
    },
  },

  shield_phase: {
    id: 'shield_phase',
    name: 'Warded Shell',
    description: 'Immune to damage until shield-bearers are slain',
    onSpawn: function(boss, floor) {
      boss._shieldActive = true;
      boss._shieldCount = 2;
      return {
        spawnMinions: true,
        minionCount: 2,
        minionTemplate: {
          id: boss.id + '_ward',
          name: 'Ward of ' + boss.name.split(' ')[0],
          hp: Math.floor(boss.maxHp * 0.15),
          atk: Math.floor(boss.atk * 0.3),
          def: Math.floor(boss.def * 0.5),
          xp: Math.floor(boss.xp * 0.1),
          gold: Math.floor(boss.gold * 0.05),
          isShieldBearer: true,
          linkedBossId: boss.id,
        },
      };
    },
    onMinionDeath: function(boss) {
      boss._shieldCount = Math.max(0, (boss._shieldCount || 0) - 1);
      if (boss._shieldCount <= 0) {
        boss._shieldActive = false;
        boss.changed = true;
        return { shieldBroken: true, message: boss.name + "'s ward shatters!" };
      }
      return null;
    },
    modifyDamage: function(boss, damage) {
      if (boss._shieldActive) return 0;
      return damage;
    },
  },

  summon_portals: {
    id: 'summon_portals',
    name: 'Rift Caller',
    description: 'Summons portals that spawn minions every 4 turns',
    onPhaseChange: function(boss) {
      return {
        spawnPortals: true,
        portalCount: 2,
        portalHp: Math.floor(boss.maxHp * 0.1),
        portalSpawnRate: 4,
        portalMinionTemplate: {
          id: boss.id + '_spawn',
          name: 'Rift Spawn',
          hp: Math.floor(boss.maxHp * 0.05),
          atk: Math.floor(boss.atk * 0.25),
          def: Math.floor(boss.def * 0.3),
          xp: 5,
          gold: 2,
        },
      };
    },
  },

  split: {
    id: 'split',
    name: 'Mitosis',
    description: 'Splits into two weaker copies at 50% HP',
    onPhaseChange: function(boss) {
      if (!boss._hasSplit && boss.hp <= boss.maxHp * 0.5) {
        boss._hasSplit = true;
        var splitHp = Math.floor(boss.hp * 0.6);
        return {
          splitBoss: true,
          copyTemplate: {
            id: boss.id + '_copy',
            name: boss.name + ' (Fragment)',
            hp: splitHp,
            maxHp: splitHp,
            atk: Math.floor(boss.atk * 0.7),
            def: Math.floor(boss.def * 0.7),
            xp: Math.floor(boss.xp * 0.3),
            gold: Math.floor(boss.gold * 0.3),
            isBoss: false,
          },
          message: boss.name + ' fractures into two!',
        };
      }
      return null;
    },
  },

  regenerator: {
    id: 'regenerator',
    name: 'Relentless Vitality',
    description: 'Regenerates 3% max HP per turn; must be burst down',
    onTick: function(boss) {
      var regenAmount = Math.floor(boss.maxHp * 0.03);
      boss.hp = Math.min(boss.maxHp, boss.hp + regenAmount);
      boss.changed = true;
      return { healed: regenAmount };
    },
  },

  reflect: {
    id: 'reflect',
    name: 'Thorned Hide',
    description: 'Reflects 25% of damage taken back to attacker',
    modifyDamage: function(boss, damage) {
      return damage;
    },
    onDamaged: function(boss, damage, attacker) {
      var reflected = Math.floor(damage * 0.25);
      return { reflectDamage: reflected, message: boss.name + ' thorns lash back!' };
    },
  },

  fury: {
    id: 'fury',
    name: 'Berserker Fury',
    description: 'Attack power increases as HP drops',
    modifyAtk: function(boss) {
      var hpPct = boss.hp / boss.maxHp;
      var mult = 1.0 + (1.0 - hpPct);
      return Math.floor(boss.atk * mult);
    },
  },
};

var CLASS_TEMPLATES = {
  pyromancer: {
    id: 'pyromancer',
    name: 'Pyromancer',
    suffix: 'the Scorching',
    statMult: { hp: 1.1, atk: 1.3, def: 0.9 },
    abilities: [
      { id: 'fireball', name: 'Fireball', damage: 1.6, range: 3, windUp: 2, cooldown: 5, weight: 12, effect: 'burn', effectChance: 0.5 },
    ],
    element: 'fire',
  },
  frostweaver: {
    id: 'frostweaver',
    name: 'Frostweaver',
    suffix: 'the Frozen',
    statMult: { hp: 1.1, atk: 1.2, def: 1.1 },
    abilities: [
      { id: 'frost_bolt', name: 'Frost Bolt', damage: 1.3, range: 3, windUp: 2, cooldown: 4, weight: 11, effect: 'slow', effectChance: 0.4 },
    ],
    element: 'ice',
  },
  berserker: {
    id: 'berserker',
    name: 'Berserker',
    suffix: 'the Frenzied',
    statMult: { hp: 1.3, atk: 1.4, def: 0.7 },
    abilities: [
      { id: 'frenzy_strike', name: 'Frenzy Strike', damage: 2.0, range: 1, windUp: 1, cooldown: 4, weight: 14 },
    ],
  },
  shadow: {
    id: 'shadow',
    name: 'Shadow',
    suffix: 'the Veiled',
    statMult: { hp: 0.9, atk: 1.3, def: 0.8 },
    abilities: [
      { id: 'shadow_strike', name: 'Shadow Strike', damage: 1.8, range: 1, windUp: 1, cooldown: 5, weight: 12, effect: 'bleed', effectChance: 0.4 },
    ],
    element: 'dark',
  },
  healer: {
    id: 'healer',
    name: 'Healer',
    suffix: 'the Mending',
    statMult: { hp: 1.2, atk: 0.8, def: 1.2 },
    abilities: [
      { id: 'heal_pulse', name: 'Heal Pulse', heals: true, healAmount: 20, range: 3, windUp: 2, cooldown: 6, weight: 15 },
    ],
  },
  venomancer: {
    id: 'venomancer',
    name: 'Venomancer',
    suffix: 'the Toxic',
    statMult: { hp: 1.0, atk: 1.2, def: 1.0 },
    abilities: [
      { id: 'venom_spit', name: 'Venom Spit', damage: 1.1, range: 2, windUp: 2, cooldown: 4, weight: 11, effect: 'poison', effectChance: 0.6 },
    ],
    element: 'poison',
  },
  stormcaller: {
    id: 'stormcaller',
    name: 'Stormcaller',
    suffix: 'the Charged',
    statMult: { hp: 1.0, atk: 1.3, def: 0.9 },
    abilities: [
      { id: 'chain_lightning', name: 'Chain Lightning', damage: 1.4, range: 3, windUp: 2, cooldown: 5, weight: 12, effect: 'stun', effectChance: 0.2 },
    ],
    element: 'lightning',
  },
  guardian: {
    id: 'guardian',
    name: 'Guardian',
    suffix: 'the Bulwark',
    statMult: { hp: 1.5, atk: 0.8, def: 1.6 },
    abilities: [
      { id: 'shield_bash', name: 'Shield Bash', damage: 1.0, range: 1, windUp: 2, cooldown: 4, weight: 10, effect: 'stun', effectChance: 0.3 },
    ],
  },
};

var CLASS_TEMPLATE_KEYS = Object.keys(CLASS_TEMPLATES);

var BOSS_MECHANIC_MAP = {
  sk_lord:          'shield_phase',
  cc_queen:         'reflect',
  ff_matriarch:     'split',
  lr_titan:         'death_aoe',
  fd_queen:         'fury',
  fr_king:          'regenerator',
  by_lord:          'resurrect',
  sr_lich:          'summon_portals',
  ot_avatar:        'regenerator',
  st_king:          'resurrect',
  if_overlord:      'fury',
  hm_patriarch:     'summon_portals',
  tv_kraken:        'death_aoe',
  pw_father:        'death_aoe',
  er_keeper:        'shield_phase',
  gw_director:      'split',
  ob_warlord:       'fury',
  mp_caliph:        'reflect',
  fc_sovereign:     'death_aoe',
  gv_overlord:      'summon_portals',
  ao_watcher:       'death_aoe',
  sc_archbishop:    'resurrect',
  pl_architect:     'split',
  cs_solanthis:     'shield_phase',
  ip_malachar:      'fury',
  dd_vyraxion:      'death_aoe',
  vc_count:         'regenerator',
  ls_archlich:      'resurrect',
  cw_engine:        'reflect',
  at_consciousness: 'split',
  dj_rex:           'fury',
  sh_broodmother:   'summon_portals',
  sd_leviathan:     'regenerator',
  ad_thing:         'reflect',
  wd_fenris:        'fury',
  tc_grothak:       'regenerator',
  rv_mayor:         'summon_portals',
};

var ENEMY_RANKS = {
  normal:   { id: 'normal',   namePfx: '',          statMult: { hp: 1.0,  atk: 1.0,  def: 1.0  }, xpMult: 1.0,  goldMult: 1.0,  templateCount: 0, color: null },
  elite:    { id: 'elite',    namePfx: 'Elite ',    statMult: { hp: 1.5,  atk: 1.3,  def: 1.2  }, xpMult: 1.8,  goldMult: 1.5,  templateCount: 1, color: { r: 255, g: 220, b: 50 } },
  rare:     { id: 'rare',     namePfx: 'Rare ',     statMult: { hp: 2.0,  atk: 1.5,  def: 1.4  }, xpMult: 2.5,  goldMult: 2.0,  templateCount: 1, color: { r: 255, g: 140, b: 40 } },
  champion: { id: 'champion', namePfx: 'Champion ', statMult: { hp: 3.0,  atk: 1.8,  def: 1.6  }, xpMult: 4.0,  goldMult: 3.0,  templateCount: 2, color: { r: 220, g: 50, b: 50 } },
};

function promoteEnemy(enemy, rank, templates, rng) {
  var rankDef = ENEMY_RANKS[rank] || ENEMY_RANKS.normal;
  if (rank === 'normal') return enemy;

  enemy.hp = Math.floor(enemy.hp * rankDef.statMult.hp);
  enemy.maxHp = enemy.hp;
  enemy.atk = Math.floor(enemy.atk * rankDef.statMult.atk);
  enemy.def = Math.floor(enemy.def * rankDef.statMult.def);
  enemy.xp = Math.floor(enemy.xp * rankDef.xpMult);
  enemy.gold = Math.floor(enemy.gold * rankDef.goldMult);
  enemy.rank = rank;
  enemy.rankColor = rankDef.color;

  var appliedTemplates = [];
  var templatePool = templates || CLASS_TEMPLATE_KEYS;
  for (var t = 0; t < rankDef.templateCount && templatePool.length > 0; t++) {
    var idx = Math.floor((rng || Math.random)() * templatePool.length);
    var templateKey = templatePool[idx];
    var tmpl = CLASS_TEMPLATES[templateKey];
    if (!tmpl) continue;

    enemy.hp = Math.floor(enemy.hp * tmpl.statMult.hp);
    enemy.maxHp = enemy.hp;
    enemy.atk = Math.floor(enemy.atk * tmpl.statMult.atk);
    enemy.def = Math.floor(enemy.def * tmpl.statMult.def);

    if (!enemy.abilities) enemy.abilities = [];
    for (var a = 0; a < tmpl.abilities.length; a++) {
      enemy.abilities.push(tmpl.abilities[a]);
    }

    if (tmpl.element) enemy.element = tmpl.element;

    appliedTemplates.push(tmpl);
  }

  var suffix = '';
  if (appliedTemplates.length > 0) {
    suffix = ' ' + appliedTemplates[appliedTemplates.length - 1].suffix;
  }
  enemy.name = rankDef.namePfx + enemy.name + suffix;
  enemy.appliedTemplates = appliedTemplates.map(function(t) { return t.id; });

  return enemy;
}

module.exports = {
  BOSS_MECHANICS: BOSS_MECHANICS,
  CLASS_TEMPLATES: CLASS_TEMPLATES,
  CLASS_TEMPLATE_KEYS: CLASS_TEMPLATE_KEYS,
  BOSS_MECHANIC_MAP: BOSS_MECHANIC_MAP,
  ENEMY_RANKS: ENEMY_RANKS,
  promoteEnemy: promoteEnemy,
};
