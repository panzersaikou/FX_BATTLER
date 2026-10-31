import type {
  Currency,
  Economy,
  EconomyMacro,
  EventProposal,
  MacroWorld,
  TradeLink,
  Transmission,
} from '@fx/contracts';
import { currencies } from '@fx/contracts';
import { catalog, observations, buildTradeLinks } from './catalog';
import { advanceDomestic } from './domestic';

export const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const lag = (current: number, target: number, halfLifeHours: number) =>
  current + (target - current) * (1 - Math.exp(-Math.LN2 / halfLifeHours));
export const tradeLinks = buildTradeLinks(currencies);
export function initialMacro(e: Pick<Economy, 'currency' | 'inflation' | 'growth'>): EconomyMacro {
  const p = catalog[e.currency],
    o = observations[e.currency];
  const unemployment = o.unemployment;
  return {
    inflationExpectation: e.inflation,
    growthExpectation: e.growth,
    potentialGrowth: clamp(o.growth, 1.4, 6),
    inflationTarget: ['MXN', 'BRL', 'CLP', 'COP', 'PEN', 'HUF'].includes(e.currency)
      ? 3
      : e.currency === 'INR'
        ? 4
        : e.currency === 'TRY'
          ? 5
          : 2,
    neutralRealRate: 0.6 + p.baseRiskPremium * 0.6,
    unemployment,
    baselineUnemployment: unemployment,
    importCostIndex: 100,
    supplyPressure: 0,
    demandImpulse: 0,
    foreignDemand: 0,
    tradeBalanceIndex: 0,
    capitalFlowIndex: 0,
    riskPremium: p.baseRiskPremium + 0.4,
    importExposure: clamp(o.imports / 100, 0.15, 0.85),
    energyImportExposure: p.energyImports,
    commodityExportExposure: p.commodityExports,
    nextPolicyMinute: (7 + (currencies.indexOf(e.currency) % 24)) * 1440,
  };
}
export function initialGlobal(): MacroWorld {
  return { energyIndex: 100, riskAversion: 0.2, lastUpdateMinute: 0, history: [] };
}
export interface EconomicWorld {
  minute: number;
  economies: Economy[];
  macro: MacroWorld;
  tradeLinks: TradeLink[];
  sequence: number;
}
export function recordTransmission(
  world: EconomicWorld,
  entry: Omit<Transmission, 'id' | 'minute'>,
) {
  world.macro.history.unshift({ ...entry, id: `macro-${++world.sequence}`, minute: world.minute });
  const counts = new Map<Currency, number>();
  world.macro.history = world.macro.history.filter((t) => {
    const count = (counts.get(t.economy) ?? 0) + 1;
    counts.set(t.economy, count);
    return count <= 8;
  });
}
/** Hourly simultaneous update: every economy reads the SAME pre-update state. */
export function advanceEconomy(world: EconomicWorld): EventProposal[] {
  if (world.minute - world.macro.lastUpdateMinute < 60 - 1e-9) return [];
  // The market integrator visits each hourly boundary. Reject skipped intervals rather than erase them.
  if (world.minute - world.macro.lastUpdateMinute > 60 + 1e-9)
    throw new Error('宏观更新必须逐小时推进');
  // Only mutable state needs copying; immutable baseline and prior history are shared.
  const previous = world.economies.map((e) => ({
    ...e,
    macro: { ...e.macro },
    domestic: { ...e.domestic },
  }));
  const byCode = new Map(previous.map((e) => [e.currency, e]));
  const totalWeight = previous.reduce((s, e) => s + e.importance, 0);
  const globalRealYield =
    previous.reduce(
      (s, e) =>
        s + e.importance * (e.expectedRate - e.macro.inflationExpectation - e.macro.riskPremium),
      0,
    ) / totalWeight;
  const globalRisk = world.macro.riskAversion,
    energyChange = world.macro.energyIndex / 100 - 1;
  const decisions: EventProposal[] = [];
  const next = previous.map((e) => {
    const m = e.macro,
      links = world.tradeLinks.filter((link) => link.importer === e.currency);
    const foreignDemand = links.reduce((v, l) => {
      const p = byCode.get(l.partner)!;
      return v + l.weight * (p.growth - p.macro.potentialGrowth);
    }, 0);
    const fxBasket = links.reduce((v, l) => {
      const p = byCode.get(l.partner)!;
      return v + (l.weight * (p.usdValue / e.usdValue)) / (p.initialUsdValue / e.initialUsdValue);
    }, 0);
    const importTarget = clamp(
      100 * fxBasket * (1 + energyChange * m.energyImportExposure) * (1 + m.supplyPressure * 0.002),
      40,
      250,
    );
    const importCostIndex = lag(m.importCostIndex, importTarget, 72);
    const importedPressure = Math.log(importCostIndex / 100) * 100 * m.importExposure;
    const realTightness = e.policyRate - m.inflationExpectation - m.neutralRealRate;
    const tradeBalanceIndex = lag(
      m.tradeBalanceIndex,
      clamp(
        Math.log(fxBasket) * 100 * 0.5 +
          0.7 * foreignDemand -
          0.3 * (e.growth - m.potentialGrowth) +
          energyChange * 10 * (m.commodityExportExposure - m.energyImportExposure),
        -15,
        15,
      ),
      48,
    );
    const inflationTarget = clamp(
      m.inflationTarget +
        0.35 * importedPressure +
        0.05 * m.supplyPressure +
        0.12 * m.demandImpulse -
        0.12 * realTightness,
      -5,
      100,
    );
    const growthTarget = clamp(
      m.potentialGrowth +
        0.18 * (e.domestic.consumptionGrowth - m.potentialGrowth) +
        0.12 * (e.domestic.investmentGrowth - m.potentialGrowth) -
        0.015 * Math.max(0, e.domestic.bankStress - 20) +
        0.45 * foreignDemand +
        0.12 * tradeBalanceIndex +
        0.3 * m.demandImpulse -
        0.4 * realTightness -
        0.04 * m.supplyPressure +
        energyChange * 2 * (m.commodityExportExposure - m.energyImportExposure),
      -5,
      12,
    );
    const inflation = lag(e.inflation, inflationTarget, 2160),
      growth = lag(e.growth, growthTarget, 168);
    const inflationExpectation = lag(
      m.inflationExpectation,
      clamp(inflation + 0.15 * importedPressure, -5, 100),
      24,
    );
    const growthExpectation = lag(m.growthExpectation, growth, 24);
    const desiredRate = clamp(
      m.neutralRealRate +
        inflationExpectation +
        1.1 * (inflationExpectation - m.inflationTarget) +
        0.35 * (growth - m.potentialGrowth),
      -1,
      100,
    );
    const expectedRate = lag(e.expectedRate, desiredRate, 48);
    const stress = lag(
      e.stress,
      clamp(
        0.08 +
          0.22 * globalRisk +
          0.003 * m.supplyPressure +
          0.025 * Math.max(0, m.potentialGrowth - growth),
        0.05,
        0.9,
      ),
      24,
    );
    const confidence = lag(
      e.confidence,
      clamp(
        0.78 -
          0.18 * stress -
          0.025 * Math.max(0, inflation - m.inflationTarget) -
          0.02 * Math.max(0, m.potentialGrowth - growth),
        0.05,
        0.95,
      ),
      240,
    );
    const riskPremium = lag(
      m.riskPremium,
      e.structure.baseRiskPremium +
        1.3 * (1 - confidence) +
        1.1 * stress +
        0.6 * globalRisk * Math.max(0, e.riskLoading),
      24,
    );
    const relativeReturn = expectedRate - inflationExpectation - riskPremium - globalRealYield;
    const flowTarget = Math.tanh(
      0.35 * relativeReturn +
        0.2 * (confidence - 0.7) +
        0.1 * (growth - m.potentialGrowth) -
        0.5 * globalRisk * e.riskLoading,
    );
    const capitalFlowIndex = lag(m.capitalFlowIndex, flowTarget, 12);
    const unemployment = lag(
      m.unemployment,
      clamp(m.baselineUnemployment - 0.45 * (growth - m.potentialGrowth), 0.1, 40),
      720,
    );
    const result: Economy = {
      ...e,
      inflation,
      growth,
      confidence,
      stress,
      expectedRate,
      domestic: advanceDomestic(e, world.minute, globalRisk),
      macro: {
        ...m,
        importCostIndex,
        inflationExpectation,
        growthExpectation,
        foreignDemand,
        tradeBalanceIndex,
        capitalFlowIndex,
        riskPremium,
        unemployment,
        supplyPressure: lag(m.supplyPressure, 0, 72),
        demandImpulse: lag(m.demandImpulse, 0, 168),
      },
    };
    if (world.minute >= m.nextPolicyMinute) {
      const change = clamp(Math.round((desiredRate - e.policyRate) * 4) / 4, -0.5, 0.5);
      result.policyRate = clamp(e.policyRate + change, -1, 100);
      result.macro.nextPolicyMinute += 42 * 1440;
      decisions.push({
        economy: e.currency,
        kind: 'policy',
        topic: 'policy',
        expected: Number(e.expectedRate.toFixed(2)),
        actual: result.policyRate,
        title: `${e.name}央行${change > 0 ? '加息' : change < 0 ? '降息' : '维持利率'}${change ? ` ${Math.abs(change * 100).toFixed(0)} 个基点` : ''}`,
        description: `通胀预期 ${inflationExpectation.toFixed(2)}%，增长 ${growth.toFixed(2)}%。本次政策利率为 ${result.policyRate.toFixed(2)}%，此前市场预期 ${e.expectedRate.toFixed(2)}%。紧缩对需求和就业的影响将逐步传导。`,
      });
    }
    return result;
  });
  // Mutate existing records only after all calculations so array ordering cannot create instant contagion.
  for (const updated of next) {
    const old = byCode.get(updated.currency)!,
      target = world.economies.find((e) => e.currency === updated.currency)!;
    Object.assign(target, updated);
    const observations: [Transmission['channel'], number, number, string, string, number][] = [
      [
        'imports',
        old.macro.importCostIndex,
        updated.macro.importCostIndex,
        '指数',
        '贸易加权汇率、能源和供应链共同影响进口成本。',
        0.01,
      ],
      [
        'inflation',
        old.macro.inflationExpectation,
        updated.macro.inflationExpectation,
        '%',
        '进口成本与当前通胀逐步传导到通胀预期。',
        0.005,
      ],
      [
        'growth',
        old.growth,
        updated.growth,
        '%',
        '贸易伙伴需求、实际利率与供应压力影响增长。',
        0.001,
      ],
      [
        'policy',
        old.expectedRate,
        updated.expectedRate,
        '%',
        '通胀目标与增长缺口改变政策利率预期；实际利率等到会议调整。',
        0.005,
      ],
      [
        'capital',
        old.macro.capitalFlowIndex,
        updated.macro.capitalFlowIndex,
        '指数',
        '相对实际收益、风险溢价与避险偏好共同影响资金流向。',
        0.001,
      ],
      [
        'labor',
        old.macro.unemployment,
        updated.macro.unemployment,
        '%',
        '增长变化以较长时滞传导至就业。',
        0.001,
      ],
      [
        'trade',
        old.macro.tradeBalanceIndex,
        updated.macro.tradeBalanceIndex,
        '指数',
        '竞争力、伙伴需求和能源进出口共同改变贸易压力。',
        0.005,
      ],
    ];
    for (const [channel, before, after, unit, summary, threshold] of observations)
      if (Math.abs(after - before) >= threshold)
        recordTransmission(world, {
          economy: updated.currency,
          channel,
          before,
          after,
          unit,
          summary,
        });
  }
  world.macro.energyIndex = lag(world.macro.energyIndex, 100, 720);
  const stress = previous.reduce((s, e) => s + e.stress * e.importance, 0) / totalWeight;
  world.macro.riskAversion = lag(globalRisk, clamp(0.1 + 0.6 * stress, 0, 1), 72);
  world.macro.lastUpdateMinute = world.minute;
  return decisions;
}
