import { describe, it, expect } from 'vitest';
import { currencies } from '@fx/contracts';
import {
  createWorld,
  advanceEconomy,
  advanceMarket,
  economy,
  mid,
  applyEvent,
  historicalRates,
  baselineDataset,
} from './index';

function hours(w: ReturnType<typeof createWorld>, count: number) {
  for (let i = 0; i < count; i++) {
    w.minute += 60;
    for (const decision of advanceEconomy(w)) applyEvent(w, decision);
  }
}
describe('attributed historical world and correlated opening conditions', () => {
  it('covers 30 economies, 435 reciprocal pairs and verified annual core observations', () => {
    const w = createWorld();
    expect(w.economies).toHaveLength(30);
    expect(w.pairs).toHaveLength(870);
    expect(new Set(w.economies.map((e) => e.currency))).toEqual(new Set(currencies));
    expect(baselineDataset.year).toBe(2023);
    expect(baselineDataset.sources.inflation.indicator).toBe('FP.CPI.TOTL.ZG');
    expect(baselineDataset.sources.growth.indicator).toBe('NY.GDP.MKTP.KD.ZG');
    for (const e of w.economies) {
      for (const key of ['inflation', 'growth', 'unemployment', 'gdp', 'population', 'usdValue']) {
        const f = e.baseline.facts.find((f) => f.key === key)!;
        expect(f.kind).not.toBe('assumption');
        expect(Number.isFinite(f.value)).toBe(true);
        expect(baselineDataset.sources[f.sourceId!].mirror).toMatch(
          /githubusercontent.com\/datasets\/[^/]+\/[a-f0-9]{40}\//,
        );
      }
      expect(e.baseline.facts.find((f) => f.key === 'policyRate')?.kind).toBe('assumption');
      expect(e.usdValue).toBe(historicalRates[e.currency]);
    }
    // Missing 2023 credit/debt observations stay explicitly modeled, not fabricated source data.
    expect(economy(w, 'CAD').baseline.facts.find((f) => f.key === 'credit')?.kind).toBe(
      'assumption',
    );
    expect(economy(w, 'CNY').baseline.facts.find((f) => f.key === 'debt')?.sourceId).toBeNull();
    expect(economy(w, 'TRY').inflation).toBeGreaterThan(50);
  });
  it('reproducibly perturbs cycles without changing source facts, scale, population or the USD numeraire', () => {
    const a = createWorld(104, historicalRates, { jitter: true }),
      b = createWorld(104, historicalRates, { jitter: true }),
      c = createWorld(105, historicalRates, { jitter: true });
    expect(a.economies).toEqual(b.economies);
    expect(a.economies).not.toEqual(c.economies);
    for (const e of a.economies) {
      expect(e.baseline.facts).toEqual(economy(c, e.currency).baseline.facts);
      expect(Math.abs(Math.log(e.usdValue / historicalRates[e.currency]))).toBeLessThan(0.017);
      expect(e.structure.population).toBe(economy(c, e.currency).structure.population);
      expect(e.structure.gdpUsd).toBe(economy(c, e.currency).structure.gdpUsd);
      expect(
        a.candles[`${e.currency === 'USD' ? 'EUR' : e.currency}/USD`].at(-1)!.close,
      ).toBeCloseTo(economy(a, e.currency === 'USD' ? 'EUR' : e.currency).usdValue, 10);
    }
    expect(economy(a, 'USD').usdValue).toBe(1);
    expect(mid(a, 'CNY/INR') * mid(a, 'INR/BRL')).toBeCloseTo(mid(a, 'CNY/BRL'), 12);
  });
  it('keeps DKK linked to the euro through ordinary evolution and euro events', () => {
    const w = createWorld(33, historicalRates, { jitter: true });
    const anchor = mid(w, 'DKK/EUR');
    advanceMarket(w, undefined, 3600);
    const before = mid(w, 'DKK/EUR');
    const eur = economy(w, 'EUR');
    applyEvent(w, {
      economy: 'EUR',
      topic: 'inflation',
      kind: 'report',
      title: '欧洲通胀预期修正',
      description: '进口成本变化带动欧洲价格预期调整。',
      expected: eur.macro.inflationExpectation,
      actual: eur.macro.inflationExpectation + 0.2,
    });
    expect(mid(w, 'DKK/EUR')).toBeCloseTo(before, 12);
    expect(Math.abs(mid(w, 'DKK/EUR') / anchor - 1)).toBeLessThan(0.0225);
    expect(economy(w, 'DKK').usdValue).toBeGreaterThan(0);
  });
});
describe('domestic feedback, cadence and coverage', () => {
  it('higher lending costs reduce consumption and investment before labor adjusts', () => {
    const a = createWorld(),
      b = createWorld();
    economy(b, 'CNY').policyRate += 5;
    economy(b, 'CNY').domestic.lendingRate += 5;
    const jobs = economy(b, 'CNY').macro.unemployment;
    hours(a, 72);
    hours(b, 72);
    expect(economy(b, 'CNY').domestic.consumptionGrowth).toBeLessThan(
      economy(a, 'CNY').domestic.consumptionGrowth,
    );
    expect(economy(b, 'CNY').domestic.investmentGrowth).toBeLessThan(
      economy(a, 'CNY').domestic.investmentGrowth,
    );
    expect(economy(b, 'CNY').growth).toBeLessThan(economy(a, 'CNY').growth);
    expect(economy(b, 'CNY').macro.unemployment).not.toBe(jobs);
  });
  it('housing losses and household stress feed bank stress and lending costs', () => {
    const a = createWorld(),
      b = createWorld();
    economy(b, 'SEK').domestic.housingGrowth = -18;
    economy(b, 'SEK').domestic.householdStress = 85;
    hours(a, 96);
    hours(b, 96);
    expect(economy(b, 'SEK').domestic.bankStress).toBeGreaterThan(
      economy(a, 'SEK').domestic.bankStress,
    );
    expect(economy(b, 'SEK').domestic.lendingRate).toBeGreaterThan(
      economy(a, 'SEK').domestic.lendingRate,
    );
  });
  it('all economies get hourly readings, daily briefs and their own retained transmission history', () => {
    const w = createWorld();
    hours(w, 50);
    for (const e of w.economies) {
      expect(e.domestic.lastUpdateMinute).toBe(3000);
      expect(e.domestic.history).toHaveLength(49);
      expect(e.domestic.brief).toContain(e.name + '每日内部观察');
      expect(e.domestic.nextBriefMinute).toBe(4320);
      expect(e.domestic.drivers).toHaveLength(3);
      expect(w.macro.history.some((t) => t.economy === e.currency)).toBe(true);
      for (const value of Object.values(e.domestic))
        if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
  });
  it('fiscal and credit events have typed limits and influence economic conditions', () => {
    const w = createWorld(),
      e = economy(w, 'BRL'),
      demand = e.macro.demandImpulse;
    applyEvent(w, {
      economy: 'BRL',
      kind: 'surprise',
      topic: 'fiscal',
      title: '巴西预算支出调整',
      description: '模拟政府提高支出，财政余额转弱并逐步增加融资需求。',
      expected: e.domestic.fiscalBalanceGDP,
      actual: e.domestic.fiscalBalanceGDP - 0.3,
    });
    expect(e.macro.demandImpulse).toBeGreaterThan(demand);
    const fiscal = e.domestic.fiscalBalanceGDP;
    hours(w, 1);
    expect(e.domestic.fiscalBalanceGDP).not.toBe(fiscal);
  });
});
