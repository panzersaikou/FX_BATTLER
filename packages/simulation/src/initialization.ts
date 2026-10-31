import type { Currency, EconomicFact, Economy } from '@fx/contracts';
import { catalog, observations } from './catalog';
import { initialMacro, clamp } from './economics';
import { initialDomestic, domesticReading } from './domestic';

export function initializeEconomies(
  roster: readonly Currency[],
  rates: Partial<Record<Currency, number>>,
  jitter: boolean,
  rng: { normal: () => number },
): Economy[] {
  const global = clamp(rng.normal(), -2, 2),
    regions = new Map<string, number>();
  const economies = roster.map((currency) => {
    const p = catalog[currency],
      o = observations[currency];
    if (!regions.has(p.region)) regions.set(p.region, clamp(rng.normal(), -2, 2));
    const cycle = jitter
      ? clamp(0.3 * global + 0.3 * regions.get(p.region)! + 0.4 * rng.normal(), -2, 2)
      : 0;
    const inflationShock = jitter
      ? clamp(cycle * 0.12 + rng.normal() * 0.08, -0.35, 0.35) * Math.max(1, o.inflation / 10)
      : 0;
    const growth = o.growth + cycle * 0.25,
      inflation = clamp(o.inflation + inflationShock, -5, 100);
    const policyRate = clamp(o.inflation * 0.7 + (0.6 + p.baseRiskPremium * 0.6), -0.5, 60); // Explicit model proxy, not an observed central-bank rate.
    const structure = {
      regime: p.regime,
      specialization: p.specialization,
      gdpUsd: o.gdp,
      population: o.population,
      exportsGDP: o.exports,
      importsGDP: o.imports,
      investmentGDP: o.investment ?? 25,
      creditGDP: o.credit ?? 80,
      baseRiskPremium: p.baseRiskPremium,
    };
    const facts: EconomicFact[] = [];
    const fact = (
      key: string,
      label: string,
      unit: string,
      value: number | null,
      sourceId: string,
      fallback: number,
    ) =>
      facts.push({
        key,
        label,
        unit,
        value: value ?? fallback,
        kind: value === null ? 'assumption' : 'observed',
        sourceId: value === null ? null : sourceId,
      });
    fact('gdp', '名义 GDP', 'USD', o.gdp, 'gdp', 0);
    fact('population', '人口', '人', o.population, 'population', 0);
    fact('inflation', '年度 CPI 通胀', '%', o.inflation, 'inflation', 2);
    fact('growth', '实际 GDP 增长', '%', o.growth, 'growth', 2);
    fact('unemployment', '失业率（ILO 估计）', '%', o.unemployment, 'unemployment', 5);
    facts.push({
      key: 'usdValue',
      label: '年均汇率（1 单位货币）',
      unit: 'USD',
      value: 1 / o.lcuPerUsd,
      kind: 'derived',
      sourceId: 'lcuPerUsd',
    });
    fact('exports', '出口 / GDP', '%', o.exports, 'exports', 25);
    fact('imports', '进口 / GDP', '%', o.imports, 'imports', 25);
    fact('investment', '资本形成 / GDP', '%', o.investment, 'investment', 25);
    fact('credit', '私人信贷 / GDP', '%', o.credit, 'credit', 80);
    fact('debt', '中央政府债务 / GDP', '%', o.debt, 'debt', 60);
    facts.push({
      key: 'currentAccount',
      label: '经常账户 / GDP',
      unit: '%',
      value: o.currentAccountUsd === null ? 0 : (o.currentAccountUsd / o.gdp) * 100,
      kind: o.currentAccountUsd === null ? 'assumption' : 'derived',
      sourceId: o.currentAccountUsd === null ? null : 'currentAccountUsd',
    });
    facts.push({
      key: 'policyRate',
      label: '模型政策利率（非官方值）',
      unit: '%',
      value: policyRate,
      kind: 'assumption',
      sourceId: null,
    });
    const fxNoise = jitter
      ? clamp(0.2 * global + 0.25 * regions.get(p.region)! + 0.5 * rng.normal(), -1.5, 1.5)
      : 0;
    const fxScale = p.regime === 'managed' ? 0.003 : p.regime === 'eur-band' ? 0.0006 : 0.01;
    const usdValue = currency === 'USD' ? 1 : rates[currency]! * Math.exp(fxNoise * fxScale);
    const macro = initialMacro({ currency, inflation, growth });
    macro.unemployment = clamp(o.unemployment - cycle * 0.12, 0.1, 40);
    const e: Economy = {
      currency,
      name: p.name,
      region: p.region,
      flag: p.flag,
      usdValue,
      initialUsdValue: usdValue,
      inflation,
      growth,
      policyRate,
      expectedRate: policyRate + cycle * 0.08,
      confidence: clamp(0.72 + cycle * 0.04, 0.5, 0.9),
      stress: clamp(0.12 - cycle * 0.025, 0.05, 0.35),
      importance: Math.max(0.035, Math.sqrt(o.gdp / observations.USD.gdp)),
      dailyVol: p.dailyVol,
      riskLoading: p.riskLoading,
      spreadBps: p.spreadBps,
      macro,
      structure,
      domestic: initialDomestic({ currency, growth, inflation, policyRate, structure }),
      baseline: { year: 2023, facts, opening: {} },
    };
    e.domestic.businessClimate += cycle * 0.6;
    e.domestic.consumptionGrowth += cycle * 0.15;
    e.domestic.investmentGrowth += cycle * 0.25;
    return e;
  });
  const eur = economies.find((e) => e.currency === 'EUR'),
    dkk = economies.find((e) => e.currency === 'DKK');
  if (eur && dkk && jitter)
    dkk.usdValue =
      eur.usdValue * (rates.DKK! / rates.EUR!) * Math.exp(clamp(rng.normal(), -2, 2) * 0.0004);
  for (const e of economies) {
    e.initialUsdValue = e.usdValue;
    e.baseline.opening = {
      gdp: e.structure.gdpUsd,
      population: e.structure.population,
      inflation: e.inflation,
      growth: e.growth,
      unemployment: e.macro.unemployment,
      usdValue: e.usdValue,
      policyRate: e.policyRate,
      exports: e.structure.exportsGDP,
      imports: e.structure.importsGDP,
      investment: e.structure.investmentGDP,
      credit: e.structure.creditGDP,
      debt: e.domestic.governmentDebtGDP,
      currentAccount: e.domestic.currentAccountGDP,
    };
    Object.assign(
      e.baseline.opening,
      Object.fromEntries(
        Object.entries(e.domestic).filter(([, value]) => typeof value === 'number'),
      ),
    );
    e.domestic.history = [domesticReading(e, 0)];
  }
  return economies;
}
