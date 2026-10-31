import { expect, it } from 'vitest';
import { currencies, type FxHistory } from '@fx/contracts';
import { fxHistory, openingBriefs } from './context';
import { historyCross, weeklyHistory } from './history';
import { createWorld, advanceEconomy } from './index';

it('preserves dated observed daily values, provenance, coverage and USD quote orientation', () => {
  expect(Object.keys(fxHistory.series)).toHaveLength(19);
  expect(fxHistory.missing).toHaveLength(10);
  expect(new Set(['USD', ...Object.keys(fxHistory.series), ...fxHistory.missing])).toEqual(
    new Set(currencies),
  );
  expect(fxHistory.sourceUrl).toContain('c28e171e36a46bd2941cf66156acd8efaf9906f5');
  expect(fxHistory.sha256).toMatch(/^[a-f0-9]{64}$/);
  for (const s of Object.values(fxHistory.series)) {
    expect(s.points.length).toBeGreaterThan(400);
    expect(new Set(s.points.map((p) => p[0])).size).toBe(s.points.length);
    expect(s.points.map((p) => p[0])).toEqual(s.points.map((p) => p[0]).sort());
    for (const [date, value] of s.points) {
      expect(date >= fxHistory.requestedStart && date <= fxHistory.requestedEnd).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(Number.isFinite(value)).toBe(true);
    }
  }
  // The public mirror already inverted FRED's USD-per-EUR source to LCU/USD.
  expect(historyCross(fxHistory, 'EUR', 'USD').at(-1)![1]).toBeCloseTo(1 / 0.8929, 10);
  expect(historyCross(fxHistory, 'USD', 'JPY').at(-1)![1]).toBeCloseTo(156.87, 6);
  expect(historyCross(fxHistory, 'VND', 'USD')).toEqual([]);
  expect(historyCross(fxHistory, 'USD', 'USD')).toEqual([]);
});
it('crosses only shared dates and samples the last observed day of a week without filling gaps', () => {
  const fixture: FxHistory = {
    ...fxHistory,
    series: {
      EUR: {
        seriesId: 'a',
        sourceUrl: '',
        points: [
          ['2025-01-02', 1.2],
          ['2025-01-03', 1.3],
          ['2025-01-06', 1.4],
        ],
      },
      GBP: {
        seriesId: 'b',
        sourceUrl: '',
        points: [
          ['2025-01-02', 1.5],
          ['2025-01-06', 1.6],
        ],
      },
    },
  };
  expect(historyCross(fixture, 'EUR', 'GBP')).toEqual([
    ['2025-01-02', 1.2 / 1.5],
    ['2025-01-06', 1.4 / 1.6],
  ]);
  expect(weeklyHistory(fixture.series.EUR.points)).toEqual([
    ['2025-01-03', 1.3],
    ['2025-01-06', 1.4],
  ]);
  for (const [i, p] of historyCross(fxHistory, 'EUR', 'JPY').entries())
    expect(p[1] * historyCross(fxHistory, 'JPY', 'EUR')[i][1]).toBeCloseTo(1, 10);
});
it('opening context does not mutate or replay shocks and structural stress differs by economy', () => {
  const world = createWorld(77),
    before = structuredClone(world.economies);
  const briefs = openingBriefs(world.economies);
  expect(briefs).toHaveLength(5);
  expect(world.economies).toEqual(before);
  expect(world.events).toHaveLength(0);
  expect(
    briefs.every(
      (b) => world.economies.some((e) => e.currency === b.economy) && b.hoursBeforeStart > 0,
    ),
  ).toBe(true);
  expect(new Set(world.economies.map((e) => e.domestic.householdStress)).size).toBeGreaterThan(20);
  for (let i = 0; i < 24; i++) {
    world.minute += 60;
    advanceEconomy(world);
  }
  expect(
    new Set(world.economies.map((e) => e.domestic.bankStress.toFixed(2))).size,
  ).toBeGreaterThan(20);
  // Relative reserve index normalization remains comparable; debt gaps remain explicit.
  expect(before.every((e) => e.domestic.reserveBuffer === 100)).toBe(true);
});
