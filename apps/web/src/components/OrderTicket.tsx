import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Info, ShieldCheck } from 'lucide-react';
import type { Snapshot, Pair, OrderRequest } from '@fx/contracts';
import { money, price } from '../lib/format';
export function OrderTicket({
  snapshot,
  pair,
  busy,
  onOrder,
}: {
  snapshot: Snapshot;
  pair: Pair;
  busy: boolean;
  onOrder: (order: OrderRequest) => void;
}) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy'),
    [units, setUnits] = useState('1000'),
    [leverage, setLeverage] = useState<1 | 5 | 10 | 20>(1);
  const q = snapshot.quotes.find((q) => q.pair === pair)!,
    base = snapshot.economies.find((e) => e.currency === pair.split('/')[0])!;
  const amount = Number(units),
    valid = Number.isInteger(amount) && amount >= 100 && amount <= 100000;
  const notional = valid ? amount * base.usdValue : 0,
    margin = notional / leverage,
    fee = notional * 0.00002,
    spreadCost = notional * (q.spreadBps / 10000 + 0.000005);
  const sufficient = margin + fee + spreadCost <= snapshot.account.freeMargin;
  return (
    <section className="panel order-panel">
      <div className="panel-title">
        <h2>交易指令</h2>
        <span className="subtle-badge">市价单</span>
      </div>
      <div className="direction-tabs">
        <button onClick={() => setSide('buy')} className={side === 'buy' ? 'buy active' : ''}>
          <ArrowUpRight size={16} /> 做多 / 买入
        </button>
        <button onClick={() => setSide('sell')} className={side === 'sell' ? 'sell active' : ''}>
          <ArrowDownLeft size={16} /> 做空 / 卖出
        </button>
      </div>
      <div className="order-quote">
        <span>{side === 'buy' ? '买入价 ASK' : '卖出价 BID'}</span>
        <strong className={side === 'buy' ? 'positive' : 'negative'}>
          {price(side === 'buy' ? q.ask : q.bid, pair)}
        </strong>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && sufficient && !busy)
            onOrder({ requestId: crypto.randomUUID(), pair, side, units: amount, leverage });
        }}
      >
        <label className="field-label" htmlFor="order-units">
          交易数量 <span>{pair.split('/')[0]}</span>
        </label>
        <div className="number-field">
          <input
            id="order-units"
            type="number"
            min="100"
            max="100000"
            step="100"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            required
          />
          <span>单位</span>
        </div>
        <div className="field-label">
          杠杆倍数 <span>最高 20×</span>
        </div>
        <div className="leverage-options">
          {([1, 5, 10, 20] as const).map((n) => (
            <button
              type="button"
              key={n}
              className={leverage === n ? 'selected' : ''}
              onClick={() => setLeverage(n)}
            >
              {n}×
            </button>
          ))}
        </div>
        <dl className="order-summary">
          <div>
            <dt>名义敞口（约）</dt>
            <dd>${money(notional)}</dd>
          </div>
          <div>
            <dt>预计保证金</dt>
            <dd>${money(margin)}</dd>
          </div>
          <div>
            <dt>开仓手续费</dt>
            <dd>${money(fee)}</dd>
          </div>
          <div>
            <dt>可用保证金</dt>
            <dd>${money(snapshot.account.freeMargin)}</dd>
          </div>
        </dl>
        <button
          className={`submit-order ${side === 'sell' ? 'short' : ''}`}
          disabled={busy || !valid || !sufficient}
          type="submit"
        >
          {!valid
            ? '输入 100–100,000 单位'
            : !sufficient
              ? '可用保证金不足'
              : busy
                ? '处理中…'
                : `${side === 'buy' ? '买入做多' : '卖出做空'} ${pair.split('/')[0]}`}
          <ArrowUpRight size={17} />
        </button>
        <p className="order-note">
          <Info size={12} /> 成交包含点差与滑点，报价可能发生变化。
        </p>
        <details className="order-learning">
          <summary>杠杆与成本怎么理解？</summary>
          <p>
            这单持有 {valid ? amount.toLocaleString() : '—'} {pair.split('/')[0]}，名义敞口约 $
            {money(notional)}。保证金 = 敞口 ÷ {leverage}
            。固定数量下，提高杠杆只减少保证金，不会把盈亏再次乘以杠杆。
          </p>
          <p>
            按当前美元折算近似，价格变化 1% 对应约 ${money(notional * 0.01)}{' '}
            盈亏（未扣成本）。点差、滑点和开平仓手续费使刚开仓通常亏损；其他货币折算汇率也可能变化。
          </p>
        </details>
      </form>
      <div className="virtual-note">
        <ShieldCheck size={14} /> 全部交易均使用虚拟资金
      </div>
    </section>
  );
}
