import type { BaselineDataset, Currency, EconomyStructure } from '@fx/contracts';
import data from './data/world-baseline.json' with { type: 'json' };

const { economies, ...metadata } = data;
export const baselineDataset: BaselineDataset = metadata;
export const observations = economies;
// Regimes and transmission sensitivities below are scenario assumptions, not measured coefficients.
type ProfileRow = [
  Currency,
  string,
  string,
  string,
  string,
  EconomyStructure['regime'],
  number,
  number,
  number,
  number,
  number,
];
const rows: ProfileRow[] = [
  ['USD', '美国', '北美', 'US', '消费、科技与金融', 'floating', 0.15, 0.006, 0.5, 0.15, 0.15],
  ['EUR', '欧元区', '欧洲', 'EU', '制造业与服务业', 'floating', 0.2, 0.006, 0.6, 0.7, 0.05],
  ['JPY', '日本', '亚洲', 'JP', '先进制造与能源进口', 'floating', 0.15, 0.007, 0.7, 0.8, 0.02],
  ['GBP', '英国', '欧洲', 'GB', '服务业与金融', 'floating', 0.25, 0.007, 0.8, 0.55, 0.1],
  ['CHF', '瑞士', '欧洲', 'CH', '医药、金融与避险需求', 'floating', 0.1, 0.005, 0.9, 0.45, 0.02],
  ['CAD', '加拿大', '北美', 'CA', '能源与对美制造贸易', 'floating', 0.3, 0.006, 0.9, 0.1, 0.8],
  ['AUD', '澳大利亚', '大洋洲', 'AU', '矿产出口与亚洲需求', 'floating', 0.3, 0.008, 1, 0.15, 0.65],
  ['NZD', '新西兰', '大洋洲', 'NZ', '农业出口与住房融资', 'floating', 0.4, 0.009, 1.5, 0.4, 0.3],
  ['MXN', '墨西哥', '拉美', 'MX', '对美制造业供应链', 'floating', 1.5, 0.012, 3, 0.25, 0.3],
  ['CNY', '中国', '亚洲', 'CN', '制造、投资与内需', 'managed', 0.8, 0.004, 1.8, 0.5, 0.1],
  ['INR', '印度', '亚洲', 'IN', '内需、服务与能源进口', 'managed', 1.2, 0.005, 2.2, 0.7, 0.05],
  ['KRW', '韩国', '亚洲', 'KR', '半导体与出口制造', 'floating', 0.5, 0.009, 1.8, 0.85, 0.02],
  ['SGD', '新加坡', '亚洲', 'SG', '转口贸易与金融', 'managed', 0.2, 0.004, 1.3, 0.7, 0.02],
  ['IDR', '印度尼西亚', '亚洲', 'ID', '商品出口与内需', 'managed', 1.4, 0.008, 3, 0.25, 0.6],
  ['THB', '泰国', '亚洲', 'TH', '旅游、汽车与电子制造', 'managed', 0.8, 0.007, 2.2, 0.6, 0.1],
  ['MYR', '马来西亚', '亚洲', 'MY', '电子制造与能源出口', 'managed', 0.9, 0.007, 2.3, 0.25, 0.55],
  ['PHP', '菲律宾', '亚洲', 'PH', '消费、服务与海外收入', 'managed', 1.2, 0.007, 2.8, 0.7, 0.05],
  ['VND', '越南', '亚洲', 'VN', '出口制造与外商投资', 'managed', 1.4, 0.004, 4, 0.4, 0.15],
  ['BRL', '巴西', '拉美', 'BR', '农业、矿产与内需', 'floating', 2, 0.014, 3.5, 0.15, 0.75],
  ['CLP', '智利', '拉美', 'CL', '铜出口与外部需求', 'floating', 1, 0.012, 3, 0.6, 0.7],
  ['COP', '哥伦比亚', '拉美', 'CO', '能源出口与内需', 'floating', 1.8, 0.015, 4, 0.15, 0.75],
  ['PEN', '秘鲁', '拉美', 'PE', '矿产出口与投资', 'managed', 1.2, 0.006, 3.2, 0.3, 0.75],
  ['ZAR', '南非', '非洲', 'ZA', '矿产、能源瓶颈与就业', 'floating', 2, 0.015, 4, 0.35, 0.65],
  ['TRY', '土耳其', '欧洲', 'TR', '制造、外部融资与通胀', 'managed', 3, 0.018, 6, 0.75, 0.05],
  ['PLN', '波兰', '欧洲', 'PL', '欧洲制造业供应链', 'floating', 0.8, 0.009, 2.5, 0.65, 0.1],
  ['CZK', '捷克', '欧洲', 'CZ', '汽车与欧洲工业需求', 'floating', 0.5, 0.007, 2.5, 0.65, 0.02],
  ['HUF', '匈牙利', '欧洲', 'HU', '欧洲制造与外部融资', 'floating', 1.2, 0.011, 3.2, 0.75, 0.02],
  ['SEK', '瑞典', '欧洲', 'SE', '制造与住房信贷', 'floating', 0.3, 0.009, 1.7, 0.3, 0.25],
  ['NOK', '挪威', '欧洲', 'NO', '石油、天然气与海运', 'floating', 0.2, 0.011, 1.8, 0.05, 0.95],
  ['DKK', '丹麦', '欧洲', 'DK', '医药、航运与欧元联系', 'eur-band', 0.15, 0.001, 1.3, 0.3, 0.25],
];
export const catalog = Object.fromEntries(
  rows.map(
    ([
      currency,
      name,
      region,
      flag,
      specialization,
      regime,
      baseRiskPremium,
      dailyVol,
      spreadBps,
      energyImports,
      commodityExports,
    ]) => [
      currency,
      {
        currency,
        name,
        region,
        flag,
        specialization,
        regime,
        baseRiskPremium,
        dailyVol,
        spreadBps,
        energyImports,
        commodityExports,
        riskLoading: ['JPY', 'CHF', 'USD'].includes(currency) ? -0.6 : 0.4 + baseRiskPremium * 0.3,
      },
    ],
  ),
) as Record<
  Currency,
  {
    currency: Currency;
    name: string;
    region: string;
    flag: string;
    specialization: string;
    regime: EconomyStructure['regime'];
    baseRiskPremium: number;
    dailyVol: number;
    spreadBps: number;
    energyImports: number;
    commodityExports: number;
    riskLoading: number;
  }
>;

export const historicalRates = Object.fromEntries(
  rows.map(([currency]) => [currency, 1 / observations[currency].lcuPerUsd]),
) as Record<Currency, number>;
const corridors: Partial<Record<Currency, Partial<Record<Currency, number>>>> = {
  CAD: { USD: 18 },
  MXN: { USD: 22 },
  USD: { CAD: 6, MXN: 6, CNY: 1.5 },
  AUD: { CNY: 5, JPY: 3, NZD: 8 },
  NZD: { AUD: 22, CNY: 4 },
  CHF: { EUR: 6 },
  GBP: { EUR: 3 },
  DKK: { EUR: 7 },
  SEK: { EUR: 4, NOK: 4 },
  NOK: { EUR: 4, GBP: 3 },
  PLN: { EUR: 6 },
  CZK: { EUR: 8 },
  HUF: { EUR: 7 },
  KRW: { CNY: 3, USD: 2 },
  VND: { CNY: 4, USD: 3 },
  JPY: { CNY: 2, USD: 2 },
  CLP: { CNY: 4 },
  PEN: { CNY: 3 },
  COP: { USD: 3 },
};
export function buildTradeLinks(roster: readonly Currency[]) {
  return roster.flatMap((importer) => {
    const candidates = roster
      .filter((c) => c !== importer)
      .map((partner) => ({
        importer,
        partner,
        weight:
          Math.sqrt(observations[partner].gdp) *
          (catalog[partner].region === catalog[importer].region ? 2 : 1) *
          (corridors[importer]?.[partner] ?? 1),
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6);
    const total = candidates.reduce((n, c) => n + c.weight, 0);
    return candidates.map((c) => ({ ...c, weight: c.weight / total }));
  });
}
