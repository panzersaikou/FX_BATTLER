import { describe, it, expect } from 'vitest';
import {
  createWorld,
  economy,
  advanceEconomy,
  applyEvent,
  advanceMarket,
  mid,
  type World,
} from './index';

function hours(world: World, count: number) {
  for (let i = 0; i < count; i++) {
    world.minute += 60;
    for (const event of advanceEconomy(world)) applyEvent(world, event);
  }
}
describe('causal macro transmission with explicit lags', () => {
  it('trade links are normalized, reference existing partners, and exclude self-trade', () => {
    const w = createWorld();
    for (const e of w.economies) {
      const links = w.tradeLinks.filter((l) => l.importer === e.currency);
      expect(links.reduce((s, l) => s + l.weight, 0)).toBeCloseTo(1, 12);
      expect(
        links.every(
          (l) => l.partner !== e.currency && w.economies.some((p) => p.currency === l.partner),
        ),
      ).toBe(true);
    }
  });
  it('currency depreciation feeds import costs, inflation expectations and the expected policy path', () => {
    const control = createWorld(4),
      weak = createWorld(4);
    economy(weak, 'EUR').usdValue *= 0.9;
    expect(economy(weak, 'EUR').macro.importCostIndex).toBe(100);
    hours(control, 96);
    hours(weak, 96);
    const a = economy(control, 'EUR'),
      b = economy(weak, 'EUR');
    expect(b.macro.importCostIndex).toBeGreaterThan(a.macro.importCostIndex);
    expect(b.macro.inflationExpectation).toBeGreaterThan(a.macro.inflationExpectation);
    expect(b.expectedRate).toBeGreaterThan(a.expectedRate);
    expect(b.policyRate).toBe(a.policyRate); // No meeting yet.
    expect(weak.macro.history.length).toBeGreaterThan(0);
  });
  it('a US demand shock spreads to trading partners, especially Canada', () => {
    const control = createWorld(),
      shock = createWorld();
    economy(shock, 'USD').growth = -3;
    hours(control, 48);
    hours(shock, 48);
    const ca = economy(shock, 'CAD').growth - economy(control, 'CAD').growth;
    const jp = economy(shock, 'JPY').growth - economy(control, 'JPY').growth;
    expect(ca).toBeLessThan(0);
    expect(jp).toBeLessThan(0);
    expect(ca).toBeLessThan(jp);
  });
  it('a global energy shock affects importers and commodity exporters differently', () => {
    const control = createWorld(),
      shock = createWorld();
    applyEvent(shock, {
      economy: 'CAD',
      kind: 'surprise',
      topic: 'energy',
      title: '全球能源市场供应趋紧',
      description: '能源价格指数上升，进口成本与出口收益同时变化。',
      expected: 100,
      actual: 110,
    });
    expect(mid(shock, 'EUR/USD')).toBeLessThan(mid(control, 'EUR/USD'));
    expect(mid(shock, 'CAD/USD')).toBeGreaterThan(mid(control, 'CAD/USD'));
    hours(control, 48);
    hours(shock, 48);
    expect(economy(shock, 'EUR').macro.importCostIndex).toBeGreaterThan(
      economy(control, 'EUR').macro.importCostIndex,
    );
    expect(economy(shock, 'CAD').macro.tradeBalanceIndex).toBeGreaterThan(
      economy(control, 'CAD').macro.tradeBalanceIndex,
    );
  });
  it('high nominal interest does not guarantee inflows when real returns and risk are poor', () => {
    const w = createWorld(),
      e = economy(w, 'MXN');
    e.policyRate = 20;
    e.expectedRate = 20;
    e.inflation = 19;
    e.macro.inflationExpectation = 19;
    e.confidence = 0.1;
    e.stress = 0.9;
    e.macro.riskPremium = 10;
    hours(w, 24);
    expect(e.macro.capitalFlowIndex).toBeLessThan(0);
  });
  it('capital-flow pressure feeds back into exchange-rate drift', () => {
    const a = createWorld(42),
      b = createWorld(42);
    economy(a, 'EUR').macro.capitalFlowIndex = 0.6;
    economy(b, 'EUR').macro.capitalFlowIndex = -0.6;
    advanceMarket(a, undefined, 60);
    advanceMarket(b, undefined, 60);
    expect(mid(a, 'EUR/USD')).toBeGreaterThan(mid(b, 'EUR/USD'));
  });
  it('policy changes occur at the meeting, are capped, and produce a public event', () => {
    const w = createWorld(),
      e = economy(w, 'EUR');
    e.inflation = 8;
    e.macro.inflationExpectation = 8;
    e.macro.nextPolicyMinute = 60;
    const original = e.policyRate;
    advanceMarket(w, undefined, 3599);
    expect(e.policyRate).toBe(original);
    advanceMarket(w, undefined, 1);
    expect(e.policyRate).toBe(original + 0.5);
    expect(w.events.find((event) => event.topic === 'policy')?.minute).toBe(60);
    expect(e.macro.nextPolicyMinute).toBe(60 + 42 * 1440);
  });
  it('growth news changes expectations immediately, but jobs respond with a lag', () => {
    const w = createWorld(),
      e = economy(w, 'EUR'),
      jobs = e.macro.unemployment,
      growth = e.growth;
    applyEvent(w, {
      economy: 'EUR',
      topic: 'growth',
      kind: 'report',
      expected: 1.1,
      actual: 0.9,
      title: '增长预期调查下修',
      description: '企业调查显示需求预期转弱，产出和就业将逐步调整。',
    });
    expect(e.growth).toBe(growth);
    expect(e.macro.unemployment).toBe(jobs);
    expect(e.macro.growthExpectation).toBe(0.9);
    hours(w, 48);
    expect(e.macro.unemployment).not.toBe(jobs);
  });
  it('simultaneous macro updates do not depend on iteration order', () => {
    const a = createWorld(),
      b = createWorld();
    b.economies.reverse();
    hours(a, 24);
    hours(b, 24);
    for (const e of a.economies) {
      const other = economy(b, e.currency);
      expect(other.growth).toBeCloseTo(e.growth, 12);
      expect(other.macro.capitalFlowIndex).toBeCloseTo(e.macro.capitalFlowIndex, 12);
    }
  });
  it('remains finite and bounded over 90 days of macro evolution', () => {
    const w = createWorld();
    w.macro.energyIndex = 180;
    economy(w, 'JPY').macro.supplyPressure = 60;
    hours(w, 90 * 24);
    for (const e of w.economies) {
      for (const value of Object.values(e.macro)) expect(Number.isFinite(value)).toBe(true);
      expect(e.inflation).toBeGreaterThanOrEqual(-5);
      expect(e.inflation).toBeLessThanOrEqual(100);
      expect(e.growth).toBeGreaterThanOrEqual(-5);
      expect(e.growth).toBeLessThanOrEqual(12);
      expect(Math.abs(e.macro.capitalFlowIndex)).toBeLessThanOrEqual(1);
      expect(e.usdValue).toBeGreaterThan(0);
    }
    expect(economy(w, 'USD').usdValue).toBe(1);
    expect(w.macro.history.length).toBeLessThanOrEqual(30 * 8);
  });
});
