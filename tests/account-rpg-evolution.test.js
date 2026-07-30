jest.mock('../rpg-data', () => ({
  CARD_BY_ID: {
    test_card: {
      evoCategory: 'test',
      evolutionThresholds: [100, 300, 700],
      evolutionStageEffects: {
        1: { type: 'stage_one', value: 1 },
        2: { type: 'stage_two', value: 2 },
      },
    },
  },
  RACES: {},
  MUTATION_POOL: [{ id: 'steady_growth', tier: 1, weight: 1 }],
  rollEvoAffix: jest.fn(() => null),
  addAffixToCard: jest.fn(),
  refreshCardEffects: jest.fn(),
  rollMutation: jest.fn(() => null),
  applyMutation: jest.fn(),
}));

const rpgData = require('../rpg-data');
const evolution = require('../account-rpg-evolution');

function makeCard(overrides) {
  return Object.assign({
    instanceId: 'card-instance-1',
    cardId: 'test_card',
    evolutionStage: 0,
    evolutionXp: 0,
    evolutionBonusLevel: 0,
    evolutionPath: null,
    effects: [],
    _baseEffects: [],
    affixes: [],
  }, overrides || {});
}

function makeAccount(card) {
  return {
    race: null,
    equippedCards: [card.instanceId],
    rpgCards: [card],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('a large XP grant consumes every earned evolution-stage threshold', () => {
  const card = makeCard();
  const result = evolution._applyCardEvoXp(makeAccount(card), card, 700);

  expect(card.evolutionStage).toBe(3);
  expect(card.pendingEvolutionChoice).toBe(true);
  expect(card._baseEffects.map(effect => effect.type)).toEqual(['stage_one', 'stage_two']);
  expect(result).toMatchObject({ newStage: 3, pendingChoice: true });
  expect(result.events.map(event => event.newStage)).toEqual([1, 2, 3]);
  expect(rpgData.rollMutation).toHaveBeenCalledTimes(3);
});

test('a single stage advance preserves the legacy result shape', () => {
  const card = makeCard();
  const result = evolution._applyCardEvoXp(makeAccount(card), card, 100);

  expect(result).toMatchObject({
    instanceId: card.instanceId,
    newStage: 1,
    pendingChoice: false,
  });
  expect(result.events).toBeUndefined();
});

test('banked post-max XP awards every earned bonus level', () => {
  const card = makeCard({
    evolutionStage: 3,
    evolutionXp: 700,
    pendingEvolutionChoice: true,
  });
  const result = evolution._applyCardEvoXp(makeAccount(card), card, 1000);

  expect(card.evolutionBonusLevel).toBe(2);
  expect(result).toMatchObject({ newStage: 3, pendingChoice: true });
  expect(result.events.map(event => event.bonusLevel)).toEqual([1, 2]);
  expect(rpgData.applyMutation).toHaveBeenCalledTimes(2);
});
