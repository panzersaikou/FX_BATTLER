import {
  currencies,
  type Currency,
  type Economy,
  type Pair,
  type Candle,
  type Quote,
  type Account,
  type AccountView,
  type OrderRequest,
  type EventProposal,
  type MarketEvent,
  type Position,
  type MacroWorld,
  type TradeLink,
  proposalSchema,
} from '@fx/contracts';
import { advanceEconomy, initialGlobal, recordTransmission, clamp } from './economics';
export { advanceEconomy, tradeLinks } from './economics';
import { historicalRates, buildTradeLinks, baselineDataset } from './catalog';
import { initializeEconomies } from './initialization';
export { historicalRates, baselineDataset } from './catalog';

export class SimulationError extends Error {}
export class Random {
  constructor(private state: number) {}
  uniform() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  normal() {
    return (
      Math.sqrt(-2 * Math.log(Math.max(1e-12, this.uniform()))) *
      Math.cos(2 * Math.PI * this.uniform())
    );
  }
}
export const allPairs: Pair[] = currencies.flatMap((a) =>
  currencies.filter((b) => b !== a).map((b) => `${a}/${b}` as Pair),
);
export interface World {
  minute: number;
  macro: MacroWorld;
  tradeLinks: TradeLink[];
  economies: Economy[];
  pairs: Pair[];
  pairLegs: [Pair, Economy, Economy, Candle[]][];
  candles: Record<string, Candle[]>;
  events: MarketEvent[];
  random: Random;
  eventRandom: Random;
  volatility: number;
  sequence: number;
}
/** Legacy export name; these are attributed historical annual averages. */
export const demoRates = historicalRates;
export function historicalBaseline() {
  return {
    kind: 'historical' as const,
    asOf: null,
    dataset: baselineDataset.version,
    year: baselineDataset.year,
    rates: { ...historicalRates },
  };
}
export function createWorld(
  seed = 2026,
  rates: Partial<Record<Currency, number>> = historicalRates,
  options: { roster?: readonly Currency[]; jitter?: boolean } = {},
): World {
  const roster = options.roster ?? currencies;
  if (
    !roster.includes('USD') ||
    roster.length < 2 ||
    new Set(roster).size !== roster.length ||
    rates.USD !== 1 ||
    roster.some((c) => !currencies.includes(c) || !Number.isFinite(rates[c]) || rates[c]! <= 0)
  )
    throw new SimulationError('无效的汇率基准');
  const economies = initializeEconomies(
    roster,
    rates,
    options.jitter ?? false,
    new Random(seed ^ 0x496b33),
  );
  const opening = Object.fromEntries(economies.map((e) => [e.currency, e.usdValue]));
  const byCode = new Map(economies.map((e) => [e.currency, e]));
  const pairs = roster.flatMap((a) =>
    roster.filter((b) => a !== b).map((b) => `${a}/${b}` as Pair),
  );
  const candles: Record<string, Candle[]> = Object.fromEntries(pairs.map((p) => [p, []]));
  const pairLegs = pairs.map((p) => {
    const [a, b] = p.split('/') as [Currency, Currency];
    return [p, byCode.get(a)!, byCode.get(b)!, candles[p]] as [Pair, Economy, Economy, Candle[]];
  });
  const world: World = {
    minute: -360,
    macro: initialGlobal(),
    tradeLinks: buildTradeLinks(roster),
    economies,
    pairs,
    pairLegs,
    candles,
    events: [],
    random: new Random(seed),
    eventRandom: new Random(seed ^ 0x7a452),
    volatility: 1,
    sequence: 0,
  };
  for (let i = 0; i < 72; i++) advanceMarket(world, undefined, 300, 60);
  const scales = Object.fromEntries(
    economies.map((e) => [e.currency, opening[e.currency] / e.usdValue]),
  );
  for (const [p, a, b] of pairLegs) {
    const scale = scales[a.currency] / scales[b.currency];
    for (const bar of world.candles[p])
      for (const key of ['open', 'high', 'low', 'close'] as const) bar[key] *= scale;
  }
  for (const e of economies) {
    e.usdValue = opening[e.currency];
    e.initialUsdValue = e.usdValue;
  }
  return world;
}
export function economy(world: World, currency: Currency) {
  return world.economies.find((e) => e.currency === currency)!;
}
export function mid(world: World, pair: Pair) {
  const [a, b] = pair.split('/') as [Currency, Currency];
  return economy(world, a).usdValue / economy(world, b).usdValue;
}
export function quote(world: World, pair: Pair): Quote {
  const [a, b] = pair.split('/') as [Currency, Currency];
  const base = economy(world, a),
    counter = economy(world, b);
  const price = mid(world, pair);
  const spreadBps =
    (base.spreadBps + counter.spreadBps) *
    (1 + Math.max(base.stress, counter.stress) * 3) *
    world.volatility;
  return {
    pair,
    mid: price,
    bid: price * (1 - spreadBps / 20000),
    ask: price * (1 + spreadBps / 20000),
    spreadBps,
    changePct: (price / (base.initialUsdValue / counter.initialUsdValue) - 1) * 100,
  };
}
/** Keep candle duration independent of clock speed. The final candle may still be forming. */
export function advanceMarket(
  world: World,
  onTick?: () => void,
  seconds = 300,
  integrationSeconds: 1 | 60 = 1,
) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new SimulationError('无效的模拟时长');
  let second = Math.round(world.minute * 60);
  const end = second + seconds;
  while (second < end) {
    const candleEnd = (Math.floor(second / 300) + 1) * 300;
    const step = Math.min(integrationSeconds, end - second, candleEnd - second);
    if (second % 300 === 0)
      for (const [, base, counter, history] of world.pairLegs) {
        if (history[history.length - 1]?.minute !== candleEnd / 60) {
          const v = base.usdValue / counter.usdValue;
          history.push({ minute: candleEnd / 60, open: v, high: v, low: v, close: v });
          if (history.length > 120) history.shift();
        }
      }
    const dt = step / 86400;
    const minuteFraction = step / 60;
    world.volatility = Math.max(
      0.65,
      Math.min(
        2.5,
        world.volatility +
          (1 - Math.exp(-0.015 * minuteFraction)) * (1 - world.volatility) +
          0.025 * Math.sqrt(minuteFraction) * world.random.normal(),
      ),
    );
    const dollar = world.random.normal(),
      risk = world.random.normal(),
      europe = world.random.normal();
    const us = economy(world, 'USD');
    const euro = world.economies.find((e) => e.currency === 'EUR'),
      krone = world.economies.find((e) => e.currency === 'DKK');
    const pegRatio = euro && krone ? krone.usdValue / euro.usdValue : 0;
    for (const e of world.economies) {
      if (e.currency === 'USD' || (e.currency === 'DKK' && euro)) continue;
      // Shared factors correlate currencies; these coefficients still require empirical calibration.
      const factor =
        -0.4 * dollar +
        0.3 * e.riskLoading * risk +
        (e.region === '欧洲' ? 0.25 * europe : 0) +
        0.75 * world.random.normal();
      const policySurprise = e.expectedRate - e.policyRate - (us.expectedRate - us.policyRate);
      const drift =
        0.0008 * policySurprise -
        0.00005 * (e.inflation - us.inflation) +
        0.0007 * (e.macro.capitalFlowIndex - us.macro.capitalFlowIndex) +
        0.00003 * (e.macro.tradeBalanceIndex - us.macro.tradeBalanceIndex) +
        0.00015 * (e.macro.growthExpectation - us.macro.growthExpectation);
      const shock =
        e.dailyVol *
        world.volatility *
        Math.sqrt(dt) *
        factor *
        (e.structure.regime === 'managed' ? 0.7 : 1);
      e.usdValue *= Math.exp(drift * dt + shock);
    }
    if (euro && krone) {
      const anchor = krone.initialUsdValue / euro.initialUsdValue;
      const ratio =
        pegRatio *
        Math.exp(
          -0.5 * Math.log(pegRatio / anchor) * dt + 0.0005 * Math.sqrt(dt) * world.random.normal(),
        );
      krone.usdValue = euro.usdValue * clamp(ratio, anchor * 0.9775, anchor * 1.0225);
    }
    for (let i = 0; i < world.pairLegs.length; i++) {
      const leg = world.pairLegs[i],
        history = leg[3];
      const v = leg[1].usdValue / leg[2].usdValue,
        bar = history[history.length - 1];
      bar.high = Math.max(bar.high, v);
      bar.low = Math.min(bar.low, v);
      bar.close = v;
    }
    second += step;
    world.minute = second / 60;
    onTick?.();
    if (second > 0 && second % 3600 === 0) {
      for (const decision of advanceEconomy(world)) applyEvent(world, decision);
      onTick?.();
    }
  }
}
export function applyEvent(world: World, raw: EventProposal): MarketEvent {
  const p = proposalSchema.parse(raw);
  const euro = world.economies.find((e) => e.currency === 'EUR'),
    krone = world.economies.find((e) => e.currency === 'DKK');
  const pegRatio = euro && krone ? krone.usdValue / euro.usdValue : 0;
  const e = economy(world, p.economy),
    delta = p.actual - p.expected;
  const strength: Record<Currency, number> = Object.fromEntries(
    currencies.map((c) => [c, 0]),
  ) as Record<Currency, number>;
  const healthy = e.confidence > 0.55 && e.growth > 0;
  let effects: string[];
  switch (p.topic) {
    case 'industry':
      e.domestic.businessClimate = p.actual;
      e.macro.demandImpulse = clamp(e.macro.demandImpulse + delta * 0.1, -2, 2);
      strength[e.currency] = delta * 0.00025;
      effects = ['工业调查改变企业预期', '投资与产出通过时滞响应', '就业与贸易伙伴需求随后变化'];
      break;
    case 'credit':
      e.domestic.creditGrowth = p.actual;
      e.macro.demandImpulse = clamp(e.macro.demandImpulse + delta * 0.08, -2, 2);
      strength[e.currency] = delta * 0.0002 * (e.domestic.bankStress < 40 ? 1 : -0.5);
      effects = ['信贷条件调查改变融资预期', '消费和住房逐步响应', '银行风险与资金流向反馈到汇率'];
      break;
    case 'fiscal':
      e.domestic.fiscalBalanceGDP = p.actual;
      e.macro.demandImpulse = clamp(e.macro.demandImpulse - delta * 0.4, -2, 2);
      e.macro.riskPremium = clamp(e.macro.riskPremium - delta * 0.1, 0, 20);
      strength[e.currency] = -delta * 0.00015 * (e.domestic.governmentDebtGDP > 90 ? -1 : 1);
      effects = [
        '财政支出变化影响需求',
        '预算赤字逐步传导到政府债务',
        '融资成本与风险溢价影响资金流向',
      ];
      break;
    case 'inflation':
      e.macro.inflationExpectation = p.actual;
      strength[e.currency] = delta * 0.0015 * (healthy ? 1 : -0.6);
      effects = [
        '调查修正通胀预期',
        '央行反应函数逐小时重估政策路径',
        '实际利率在会议时调整，增长与就业随后缓慢响应',
      ];
      break;
    case 'growth':
      e.macro.growthExpectation = p.actual;
      e.macro.demandImpulse = clamp(e.macro.demandImpulse + delta * 0.25, -2, 2);
      strength[e.currency] = delta * 0.0012;
      effects = [
        '增长预期与需求信号变化',
        '本国需求影响贸易伙伴出口',
        '就业与利率预期通过时滞反馈',
      ];
      break;
    case 'supply':
      e.macro.supplyPressure = p.actual;
      e.stress = clamp(e.stress + delta * 0.003, 0.05, 0.9);
      strength[e.currency] = -delta * 0.00015;
      effects = ['供应链压力指数变化', '进口成本与产出逐步变化', '通胀、增长与政策预期随后响应'];
      break;
    case 'confidence':
      e.confidence = p.actual / 100;
      e.stress = clamp(e.stress - delta * 0.002, 0.05, 0.9);
      strength[e.currency] = delta * 0.0003;
      effects = [
        '信心变化调整风险溢价',
        '风险调整后收益影响资金流向',
        '资金流动反馈到货币价值与点差',
      ];
      break;
    case 'energy': {
      world.macro.energyIndex = p.actual;
      const shock = delta / p.expected;
      world.macro.riskAversion = clamp(world.macro.riskAversion + Math.max(0, shock) * 0.3, 0, 1);
      for (const target of world.economies)
        strength[target.currency] =
          shock *
          0.015 *
          (target.macro.commodityExportExposure - target.macro.energyImportExposure);
      effects = [
        '全球能源指数变化',
        '能源进口方与商品出口方受到不同影响',
        '贸易条件、进口成本与通胀逐小时传导',
      ];
      break;
    }
    case 'policy':
      e.policyRate = p.actual;
      strength[e.currency] = delta * 0.0015 * (healthy ? 1 : 0.5);
      effects = [
        '央行在预定会议调整实际利率',
        '相对实际收益与资金流向变化',
        '融资成本通过时滞传导到增长和就业',
      ];
      break;
  }
  // USD is the numeraire. Relative strengths update all cross rates coherently.
  for (const target of world.economies)
    if (target.currency !== 'USD')
      target.usdValue *= Math.exp(strength[target.currency] - strength.USD);
  if (euro && krone) {
    const anchor = krone.initialUsdValue / euro.initialUsdValue;
    krone.usdValue =
      euro.usdValue *
      clamp(pegRatio * Math.exp(strength.DKK * 0.1), anchor * 0.9775, anchor * 1.0225);
  }
  const event: MarketEvent = {
    ...p,
    id: `evt-${++world.sequence}`,
    minute: world.minute,
    importance:
      p.topic === 'energy' || e.importance >= 0.75
        ? 'high'
        : e.importance >= 0.4
          ? 'medium'
          : 'low',
    effects,
  };
  for (const [pair, base, counter] of world.pairLegs) {
    const bar = world.candles[pair].at(-1);
    if (bar && bar.minute >= world.minute && bar.minute - 5 <= world.minute) {
      const v = base.usdValue / counter.usdValue;
      bar.close = v;
      bar.high = Math.max(bar.high, v);
      bar.low = Math.min(bar.low, v);
    }
  }
  recordTransmission(world, {
    economy: e.currency,
    channel: 'event',
    before: p.expected,
    after: p.actual,
    unit: ['inflation', 'growth', 'policy', 'credit', 'fiscal'].includes(p.topic) ? '%' : '指数',
    summary: effects.join(' → '),
  });
  world.events.unshift(event);
  world.events = world.events.slice(0, 60);
  return event;
}
export function createAccount(): Account {
  return { initialBalance: 10_000, balance: 10_000, positions: [], fills: [] };
}
function toUsd(world: World, pair: Pair, value: number) {
  return value * economy(world, pair.split('/')[1] as Currency).usdValue;
}
function positionPnl(world: World, p: Position, price: number) {
  return toUsd(world, p.pair, (price - p.entry) * p.units * (p.side === 'buy' ? 1 : -1));
}
export function accountView(world: World, account: Account): AccountView {
  const positions = account.positions.map((p) => {
    const q = quote(world, p.pair),
      mark = p.side === 'buy' ? q.bid : q.ask;
    return { ...p, mark, pnl: positionPnl(world, p, mark) };
  });
  const unrealized = positions.reduce((n, p) => n + p.pnl, 0),
    usedMargin = positions.reduce((n, p) => n + p.margin, 0),
    equity = account.balance + unrealized;
  return {
    ...account,
    positions,
    unrealized,
    usedMargin,
    equity,
    freeMargin: equity - usedMargin,
    marginLevel: usedMargin ? (equity / usedMargin) * 100 : null,
    feesPaid: account.fills.reduce((n, f) => n + f.fee, 0),
  };
}
export function openPosition(world: World, account: Account, order: OrderRequest): Position {
  if (account.positions.length >= 20) throw new SimulationError('当前最多同时持有 20 笔仓位');
  const q = quote(world, order.pair),
    usdNotional = order.units * economy(world, order.pair.split('/')[0] as Currency).usdValue;
  const margin = usdNotional / order.leverage,
    fee = usdNotional * 0.00002;
  const slippage = q.mid * 0.000005;
  const entry = order.side === 'buy' ? q.ask + slippage : q.bid - slippage;
  const p: Position = {
    id: `pos-${++world.sequence}`,
    pair: order.pair,
    side: order.side,
    units: order.units,
    leverage: order.leverage,
    entry,
    margin,
    openedAt: world.minute,
    entryFee: fee,
  };
  const initialLoss = positionPnl(world, p, order.side === 'buy' ? q.bid : q.ask);
  if (margin + fee - initialLoss > accountView(world, account).freeMargin)
    throw new SimulationError('可用保证金不足，请减少数量或调整杠杆');
  account.balance -= fee;
  account.positions.push(p);
  account.fills.unshift({
    id: `fill-${++world.sequence}`,
    positionId: p.id,
    pair: p.pair,
    action: 'open',
    side: p.side,
    units: p.units,
    price: entry,
    fee,
    pnl: 0,
    minute: world.minute,
  });
  return p;
}
export function closePosition(world: World, account: Account, id: string, liquidation = false) {
  const p = account.positions.find((p) => p.id === id);
  if (!p) throw new SimulationError('该仓位已平仓或不存在');
  const q = quote(world, p.pair),
    price = p.side === 'buy' ? q.bid - q.mid * 0.000005 : q.ask + q.mid * 0.000005;
  const pnl = positionPnl(world, p, price),
    fee = p.units * economy(world, p.pair.split('/')[0] as Currency).usdValue * 0.00002;
  account.balance += pnl - fee;
  account.positions = account.positions.filter((x) => x.id !== id);
  account.fills.unshift({
    id: `fill-${++world.sequence}`,
    positionId: p.id,
    pair: p.pair,
    action: liquidation ? 'liquidation' : 'close',
    side: p.side === 'buy' ? 'sell' : 'buy',
    units: p.units,
    price,
    fee,
    pnl,
    minute: world.minute,
  });
}
export function enforceMargin(world: World, account: Account) {
  let view = accountView(world, account);
  while (view.marginLevel !== null && view.marginLevel < 50 && view.positions.length) {
    const worst = [...view.positions].sort((a, b) => a.pnl - b.pnl)[0];
    closePosition(world, account, worst.id, true);
    view = accountView(world, account);
  }
}

export { fxHistory, openingBriefs } from './context';
export { historyCross, weeklyHistory } from './history';
