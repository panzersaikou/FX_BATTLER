import { describe, it, expect } from 'vitest';
import {
  createWorld,
  advanceMarket,
  createAccount,
  openPosition,
  closePosition,
  quote,
  mid,
  economy,
  accountView,
  enforceMargin,
  applyEvent,
  demoRates,
} from './index';
import type { OrderRequest, EventProposal } from '@fx/contracts';

const order = (patch: Partial<OrderRequest> = {}): OrderRequest => ({
  requestId: 'f3f2d9f6-8944-4b13-a7f5-9535ed552dd7',
  pair: 'EUR/USD',
  side: 'buy',
  units: 1000,
  leverage: 10,
  ...patch,
});
describe('market invariants', () => {
  it('starts exactly at the baseline, including the synthetic chart endpoint', () => {
    const w = createWorld();
    expect(economy(w, 'EUR').usdValue).toBe(demoRates.EUR);
    expect(w.candles['EUR/USD'].at(-1)!.close).toBeCloseTo(demoRates.EUR, 12);
    expect(w.minute).toBe(0);
  });
  it('rejects missing, negative and non-unit USD baselines', () => {
    expect(() => createWorld(1, { ...demoRates, JPY: NaN })).toThrow();
    expect(() => createWorld(1, { ...demoRates, USD: 2 })).toThrow();
  });
  it('preserves reciprocal and triangular rates without executable spread arbitrage', () => {
    const w = createWorld(100);
    for (let i = 0; i < 30; i++) advanceMarket(w);
    expect(mid(w, 'EUR/USD') * mid(w, 'USD/JPY')).toBeCloseTo(mid(w, 'EUR/JPY'), 10);
    expect(mid(w, 'GBP/EUR') * mid(w, 'EUR/GBP')).toBeCloseTo(1, 12);
    expect(
      quote(w, 'EUR/USD').bid * quote(w, 'USD/JPY').bid * quote(w, 'JPY/EUR').bid,
    ).toBeLessThan(1);
  });
  it('is deterministic and unaffected by the player portfolio', () => {
    const a = createWorld(47),
      b = createWorld(47),
      account = createAccount();
    openPosition(a, account, order());
    for (let i = 0; i < 80; i++) {
      advanceMarket(a);
      advanceMarket(b);
    }
    expect(a.economies).toEqual(b.economies);
    expect(a.candles).toEqual(b.candles);
  });
  it('produces valid OHLC and positive prices', () => {
    const w = createWorld(7);
    for (let i = 0; i < 100; i++) advanceMarket(w);
    for (const history of Object.values(w.candles))
      for (const c of history) {
        expect(c.low).toBeGreaterThan(0);
        expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
        expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      }
  });
  it('propagates USD events and updates the current candle', () => {
    const w = createWorld(),
      before = mid(w, 'EUR/USD');
    const p: EventProposal = {
      economy: 'USD',
      kind: 'report',
      topic: 'inflation',
      title: '美国价格调查高于预期',
      description: '市场重新评估未来政策路径和价格压力。',
      expected: 2.8,
      actual: 3.1,
    };
    applyEvent(w, p);
    expect(economy(w, 'USD').usdValue).toBe(1);
    expect(mid(w, 'EUR/USD')).toBeLessThan(before);
    expect(w.candles['EUR/USD'].at(-1)!.close).toBe(mid(w, 'EUR/USD'));
  });
});
describe('account and execution', () => {
  it('charges spread, slippage and both fees on an immediate round trip', () => {
    const w = createWorld(),
      a = createAccount();
    const p = openPosition(w, a, order());
    expect(accountView(w, a).unrealized).toBeLessThan(0);
    expect(a.balance).toBeLessThan(10000);
    closePosition(w, a, p.id);
    expect(a.positions).toHaveLength(0);
    expect(a.fills).toHaveLength(2);
    expect(a.balance).toBeLessThan(10000);
    expect(a.balance).toBeCloseTo(
      10000 + a.fills[0].pnl - a.fills.reduce((sum, f) => sum + f.fee, 0),
      8,
    );
    expect(accountView(w, a).feesPaid).toBeGreaterThan(0);
    expect(accountView(w, a).usedMargin).toBe(0);
  });
  it('marks shorts at the ask and converts JPY P&L to dollars', () => {
    const w = createWorld(),
      a = createAccount();
    const p = openPosition(w, a, order({ pair: 'USD/JPY', side: 'sell' }));
    economy(w, 'JPY').usdValue *= 1.01;
    const mark = quote(w, 'USD/JPY').ask;
    expect(accountView(w, a).positions[0].pnl).toBeCloseTo(
      (p.entry - mark) * p.units * economy(w, 'JPY').usdValue,
      8,
    );
    expect(accountView(w, a).positions[0].pnl).toBeGreaterThan(0);
  });
  it('rejects insufficient margin without changing balances or positions', () => {
    const w = createWorld(),
      a = createAccount();
    expect(() => openPosition(w, a, order({ units: 100000, leverage: 1 }))).toThrow('保证金不足');
    expect(a).toEqual(createAccount());
  });
  it('liquidates when equity falls below the margin threshold', () => {
    const w = createWorld(),
      a = createAccount();
    openPosition(w, a, order({ units: 100000, leverage: 20 }));
    economy(w, 'EUR').usdValue *= 0.9;
    enforceMargin(w, a);
    expect(a.positions).toHaveLength(0);
    expect(a.fills[0].action).toBe('liquidation');
    expect(a.balance).toBeLessThan(a.initialBalance);
  });
});
