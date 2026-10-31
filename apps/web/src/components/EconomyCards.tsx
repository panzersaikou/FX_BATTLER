import type { Snapshot, Currency } from '@fx/contracts';
import { useState } from 'react';
import { signed } from '../lib/format';

export function EconomyCards({
  snapshot,
  compact = false,
  selected,
  onSelect,
}: {
  snapshot: Snapshot;
  compact?: boolean;
  selected?: Currency;
  onSelect?: (currency: Currency) => void;
}) {
  const [search, setSearch] = useState(''),
    [region, setRegion] = useState('all');
  const visible = snapshot.economies.filter(
    (e) =>
      (region === 'all' || e.region === region) &&
      `${e.name} ${e.currency}`.toLowerCase().includes(search.toLowerCase()),
  );
  const totalWeight = snapshot.economies.reduce((v, e) => v + e.importance, 0);
  return (
    <>
      {!compact && (
        <div className="economy-filters">
          <label>
            查找国家或货币
            <input
              aria-label="查找经济体"
              value={search}
              onChange={(ev) => setSearch(ev.target.value)}
              placeholder="中国 / CNY / 巴西…"
            />
          </label>
          <label>
            区域
            <select
              aria-label="经济体区域"
              value={region}
              onChange={(ev) => setRegion(ev.target.value)}
            >
              <option value="all">全部区域</option>
              {[...new Set(snapshot.economies.map((e) => e.region))].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <span>
            {visible.length} / {snapshot.economies.length} 个经济体
          </span>
        </div>
      )}
      <div className={compact ? 'economy-mini-list' : 'economy-grid'}>
        {(compact ? snapshot.economies.slice(0, 3) : visible).map((e) => {
          const delta = (e.usdValue / e.initialUsdValue - 1) * 100;
          return (
            <article
              key={e.currency}
              className={`economy-card ${compact ? 'compact' : ''} ${selected === e.currency ? 'selected-economy' : ''}`}
            >
              <div className="economy-heading">
                <span className={`country-code country-${e.flag}`}>{e.flag}</span>
                <div>
                  <h3>{e.name}</h3>
                  <span>
                    {e.currency} · {e.region}
                  </span>
                </div>
                <span className="economy-condition">
                  {e.stress > 0.25 ? '压力上升' : '运行平稳'}
                </span>
              </div>
              <div className="economy-stats">
                <div>
                  <span>政策利率</span>
                  <b>
                    {e.policyRate.toFixed(2)}
                    <small>%</small>
                  </b>
                </div>
                <div>
                  <span>通胀</span>
                  <b>
                    {e.inflation.toFixed(2)}
                    <small>%</small>
                  </b>
                </div>
                <div>
                  <span>增长</span>
                  <b>
                    {e.growth.toFixed(1)}
                    <small>%</small>
                  </b>
                </div>
              </div>
              {!compact && (
                <>
                  <div className="macro-card-stats">
                    <span>
                      进口成本 <b>{e.macro.importCostIndex.toFixed(2)}</b>
                    </span>
                    <span>
                      政策预期 <b>{e.expectedRate.toFixed(2)}%</b>
                    </span>
                    <span>
                      失业率 <b>{e.macro.unemployment.toFixed(2)}%</b>
                    </span>
                    <span>
                      资金流向{' '}
                      <b className={e.macro.capitalFlowIndex >= 0 ? 'positive' : 'negative'}>
                        {signed(e.macro.capitalFlowIndex, 3)}
                      </b>
                    </span>
                  </div>
                  <div className="confidence-line">
                    <span>市场信心</span>
                    <div>
                      <i style={{ width: `${e.confidence * 100}%` }} />
                    </div>
                    <b>{Math.round(e.confidence * 100)}</b>
                  </div>
                  {onSelect && (
                    <button className="economy-inspect" onClick={() => onSelect(e.currency)}>
                      查看{e.name}传导 →
                    </button>
                  )}
                  <div className="economy-footer">
                    <span>事件抽样份额 {((e.importance / totalWeight) * 100).toFixed(1)}%</span>
                    <b className={delta >= 0 ? 'positive' : 'negative'}>
                      {signed(delta)}% <small>兑美元</small>
                    </b>
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
      {!visible.length && !compact && <p className="macro-empty">没有匹配的经济体。</p>}
    </>
  );
}
