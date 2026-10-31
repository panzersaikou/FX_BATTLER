import type { DomesticReading, DomesticState, Economy } from '@fx/contracts';
import { observations } from './catalog';

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const lag = (current: number, target: number, hours: number) =>
  current + (target - current) * (1 - Math.exp(-Math.LN2 / hours));
/** Structural model priors, not observed stress statistics. Keep country differences during lags. */
export function pressurePriors(e: Pick<Economy, 'currency' | 'structure'>) {
  const o = observations[e.currency];
  const household = clamp(
    16 +
      1.1 * o.unemployment +
      0.15 * Math.max(0, o.inflation - 3) +
      1.5 * e.structure.baseRiskPremium,
    10,
    65,
  );
  const bank = clamp(
    8 +
      0.3 * household +
      Math.max(0, e.structure.creditGDP - 100) * 0.04 +
      2 * e.structure.baseRiskPremium,
    8,
    60,
  );
  return { household, bank };
}
export function domesticReading(e: Economy, minute: number): DomesticReading {
  const d = e.domestic;
  return {
    minute,
    growth: e.growth,
    inflation: e.inflation,
    unemployment: e.macro.unemployment,
    consumptionGrowth: d.consumptionGrowth,
    investmentGrowth: d.investmentGrowth,
    businessClimate: d.businessClimate,
    creditGrowth: d.creditGrowth,
    housingGrowth: d.housingGrowth,
    bankStress: d.bankStress,
  };
}
export function initialDomestic(
  e: Pick<Economy, 'currency' | 'growth' | 'inflation' | 'policyRate' | 'structure'>,
): DomesticState {
  const o = observations[e.currency];
  const prior = pressurePriors(e);
  return {
    consumptionGrowth: e.growth,
    investmentGrowth: e.growth * 1.2,
    businessClimate: clamp(50 + e.growth - 2, 35, 65),
    wageGrowth: e.inflation + e.growth * 0.4,
    creditGrowth: clamp(e.inflation + e.growth, 0, 70),
    lendingRate: e.policyRate + 2 + e.structure.baseRiskPremium,
    housingGrowth: clamp(e.inflation + e.growth * 0.3, -10, 60),
    householdStress: prior.household,
    bankStress: prior.bank,
    fiscalBalanceGDP: -3,
    governmentDebtGDP: o.debt ?? 60,
    currentAccountGDP: o.currentAccountUsd === null ? 0 : (o.currentAccountUsd / o.gdp) * 100,
    reserveBuffer: 100,
    lastUpdateMinute: 0,
    nextBriefMinute: 24 * 60,
    brief: '开局状态：历史统计提供结构起点，内部景气、信贷与财政路径由模型推演。',
    drivers: [],
    history: [],
  };
}

/** Hourly latent conditions / nowcasts, not fabricated hourly official statistics. */
export function advanceDomestic(e: Economy, minute: number, globalRisk: number): DomesticState {
  const d = e.domestic,
    m = e.macro;
  const prior = pressurePriors(e);
  const realLoan = d.lendingRate - m.inflationExpectation;
  const realWage = d.wageGrowth - e.inflation;
  const householdStress = lag(
    d.householdStress,
    clamp(
      prior.household +
        2.5 * (m.unemployment - m.baselineUnemployment) +
        2 * Math.max(0, -realWage) +
        1.5 * Math.max(0, realLoan - m.neutralRealRate) +
        8 * globalRisk,
      5,
      95,
    ),
    240,
  );
  const bankStress = lag(
    d.bankStress,
    clamp(
      prior.bank +
        0.35 * (householdStress - prior.household) +
        Math.max(0, -d.housingGrowth) * 1.4 +
        15 * globalRisk,
      3,
      95,
    ),
    168,
  );
  const lendingRate = lag(
    d.lendingRate,
    e.policyRate + 1.5 + m.riskPremium + bankStress * 0.025,
    48,
  );
  const consumptionGrowth = lag(
    d.consumptionGrowth,
    clamp(
      m.potentialGrowth +
        0.45 * realWage -
        0.5 * (realLoan - m.neutralRealRate) -
        0.03 * (householdStress - 25) +
        0.5 * m.demandImpulse,
      -12,
      15,
    ),
    168,
  );
  const investmentGrowth = lag(
    d.investmentGrowth,
    clamp(
      m.potentialGrowth +
        0.5 * m.foreignDemand +
        0.18 * (d.businessClimate - 50) -
        0.8 * (realLoan - m.neutralRealRate) -
        0.05 * m.supplyPressure -
        0.04 * (bankStress - 15),
      -18,
      20,
    ),
    240,
  );
  const creditGrowth = lag(
    d.creditGrowth,
    clamp(
      e.inflation + e.growth - 0.6 * (realLoan - m.neutralRealRate) - 0.05 * (bankStress - 15),
      -15,
      90,
    ),
    168,
  );
  const businessClimate = lag(
    d.businessClimate,
    clamp(
      50 +
        1.2 * (e.growth - m.potentialGrowth) +
        0.7 * m.foreignDemand +
        0.5 * m.demandImpulse -
        0.06 * m.supplyPressure -
        0.08 * (bankStress - 15),
      25,
      75,
    ),
    24,
  );
  const housingGrowth = lag(
    d.housingGrowth,
    clamp(
      0.5 * e.inflation + 0.3 * creditGrowth - 0.9 * realLoan - 0.07 * (householdStress - 25),
      -20,
      70,
    ),
    720,
  );
  const wageGrowth = lag(
    d.wageGrowth,
    clamp(
      m.inflationExpectation + 0.35 * e.growth - 0.4 * (m.unemployment - m.baselineUnemployment),
      -5,
      100,
    ),
    720,
  );
  const fiscalBalanceGDP = lag(
    d.fiscalBalanceGDP,
    clamp(
      -3 +
        0.4 * (e.growth - m.potentialGrowth) -
        0.015 * Math.max(0, d.governmentDebtGDP - 60) -
        0.07 * Math.max(0, lendingRate - 5),
      -15,
      8,
    ),
    720,
  );
  const annualNominal = Math.max(-0.2, (e.growth + e.inflation) / 100);
  const governmentDebtGDP = clamp(
    d.governmentDebtGDP + (-fiscalBalanceGDP - annualNominal * d.governmentDebtGDP) / (365 * 24),
    0,
    350,
  );
  const initialCA = observations[e.currency].currentAccountUsd;
  const caAnchor = initialCA === null ? 0 : (initialCA / observations[e.currency].gdp) * 100;
  const currentAccountGDP = lag(
    d.currentAccountGDP,
    clamp(
      caAnchor + 0.18 * m.tradeBalanceIndex - 0.08 * (consumptionGrowth - m.potentialGrowth),
      -30,
      40,
    ),
    720,
  );
  const reserveBuffer = lag(
    d.reserveBuffer,
    clamp(100 + currentAccountGDP - 8 * Math.max(0, -m.capitalFlowIndex) - 5 * globalRisk, 25, 140),
    240,
  );
  const result = {
    ...d,
    consumptionGrowth,
    investmentGrowth,
    businessClimate,
    wageGrowth,
    creditGrowth,
    lendingRate,
    housingGrowth,
    householdStress,
    bankStress,
    fiscalBalanceGDP,
    governmentDebtGDP,
    currentAccountGDP,
    reserveBuffer,
    lastUpdateMinute: minute,
  };
  if (minute >= d.nextBriefMinute) {
    result.nextBriefMinute += 1440;
    result.drivers = [
      `实际贷款利率 ${realLoan.toFixed(2)}% 影响消费与投资`,
      `伙伴需求差 ${m.foreignDemand.toFixed(2)} pp 传导到企业景气`,
      `家庭压力 ${householdStress.toFixed(1)}、银行压力 ${bankStress.toFixed(1)} 影响信贷供给`,
    ];
    result.brief = `${e.name}每日内部观察：消费预期 ${consumptionGrowth.toFixed(2)}%，投资预期 ${investmentGrowth.toFixed(2)}%，工业景气 ${businessClimate.toFixed(1)}。${bankStress > 35 ? '融资风险偏高。' : '融资压力暂时可控。'}这些是模拟估计，并非当日官方数据。`;
  }
  const reading = domesticReading({ ...e, domestic: result }, minute);
  result.history = [...d.history, reading].slice(-49);
  return result;
}
