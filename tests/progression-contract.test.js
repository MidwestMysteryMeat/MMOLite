const fs = require('fs');
const path = require('path');
const skills = require('../account-skills');
const rpgData = require('../rpg-data');

test('documented skill progression matches the executable formula and cap', () => {
  expect(skills.xpForLevel(10)).toBe(Math.floor(80 * Math.pow(10, 1.7)));
  expect(skills.SKILL_MAX_LEVEL).toBe(Infinity);
});

test('documented overall progression matches the executable formula and cap', () => {
  expect(rpgData.overallXpForLevel(10)).toBe(Math.floor(200 * Math.pow(10, 1.6)));
  expect(rpgData.MAX_OVERALL_LEVEL).toBe(Infinity);
  expect(rpgData.XP_SPILLOVER_RATE).toBe(0.10);
});

test('the architecture reference carries the current formulas', () => {
  const docs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ARCHITECTURE.md'), 'utf8');
  expect(docs).toContain('floor(80 * n^1.7)');
  expect(docs).toContain('floor(200 * n^1.6)');
  expect(docs).toContain('SKILL_MAX_LEVEL = Infinity');
  expect(docs).toContain('MAX_OVERALL_LEVEL = Infinity');
});
