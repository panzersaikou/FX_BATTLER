import { useState } from 'react';
import { ArrowRight, Network, TrendingUp } from 'lucide-react';
import type { Currency, Snapshot } from '@fx/contracts';
import { EconomyCards } from './EconomyCards';
import { DomesticDashboard } from './DomesticDashboard';
import { clock, day, signed } from '../lib/format';

export function EconomyDashboard({ snapshot: s }: { snapshot: Snapshot }) {
  const [selected, setSelected] = useState<Currency>('EUR');
  const e = s.economies.find((e) => e.currency === selected)!,
    m = e.macro;
  const history = s.macro.history.filter((t) => t.economy === selected).slice(0, 8);
  const partners = s.tradeLinks
    .filter((link) => link.importer === selected)
    .sort((a, b) => b.weight - a.weight);
  const stages = [
    ['货币兑美元', `${signed((e.usdValue / e.initialUsdValue - 1) * 100)}%`, '开局以来'],
    ['进口成本', m.importCostIndex.toFixed(2), '开局指数 = 100'],
    ['通胀预期', `${m.inflationExpectation.toFixed(2)}%`, '调查与成本传导'],
    ['政策利率预期', `${e.expectedRate.toFixed(2)}%`, `实际 ${e.policyRate.toFixed(2)}%`],
    ['资金流向', signed(m.capitalFlowIndex, 3), '正值流入 / 负值流出'],
  ];
  return (
    <>
      <section className="panel macro-overview" aria-label="经济传导观察">
        <div className="panel-title">
          <div className="heading-with-icon">
            <Network size={17} />
            <h2>传导观察</h2>
          </div>
          <select
            aria-label="观察经济体"
            value={selected}
            onChange={(event) => setSelected(event.target.value as Currency)}
          >
            {s.economies.map((e) => (
              <option key={e.currency} value={e.currency}>
                {e.name} · {e.currency}
              </option>
            ))}
          </select>
        </div>
        <div className="macro-global">
          <span>
            全球能源 <b>{s.macro.energyIndex.toFixed(2)}</b>
            <small>指数</small>
          </span>
          <span>
            避险倾向 <b>{(s.macro.riskAversion * 100).toFixed(1)}</b>
            <small>/ 100</small>
          </span>
          <span>
            宏观更新{' '}
            <b>
              {s.macro.lastUpdateMinute
                ? `D${day(s.macro.lastUpdateMinute)} ${clock(s.macro.lastUpdateMinute)}`
                : '开局状态'}
            </b>
            <small>每游戏小时</small>
          </span>
        </div>
        <div className="transmission-chain">
          {stages.map(([label, value, hint], i) => (
            <div className="transmission-stage" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{hint}</small>
              {i < stages.length - 1 && <ArrowRight size={14} />}
            </div>
          ))}
        </div>
        <div className="macro-context">
          <span>
            增长预期 <b>{m.growthExpectation.toFixed(2)}%</b>
          </span>
          <span>
            风险溢价 <b>{m.riskPremium.toFixed(2)} pp</b>
          </span>
          <span>
            下次央行会议{' '}
            <b>
              D{day(m.nextPolicyMinute)} {clock(m.nextPolicyMinute)}
            </b>
          </span>
        </div>
        <p className="macro-caption">
          各环节存在时滞；资金流向会反馈至汇率。增长和就业缓慢变化，实际政策利率只在会议时调整。
        </p>
      </section>
      <DomesticDashboard economy={e} snapshot={s} />
      <div className="macro-detail-grid">
        <section className="panel">
          <div className="panel-title">
            <h2>{e.name}的贸易联系</h2>
            <span className="subtle-badge">模拟权重</span>
          </div>
          <div className="trade-partners">
            {partners.map((link) => {
              const partner = s.economies.find((e) => e.currency === link.partner)!;
              const cost =
                partner.usdValue / e.usdValue / (partner.initialUsdValue / e.initialUsdValue) - 1;
              return (
                <button
                  key={link.partner}
                  className="trade-partner"
                  onClick={() => setSelected(link.partner)}
                >
                  <span>
                    <b>{partner.name}</b>
                    <small>
                      {partner.currency} · 增长 {partner.growth.toFixed(2)}%
                    </small>
                  </span>
                  <span className="trade-weight">
                    <i style={{ width: `${link.weight * 100}%` }} />
                  </span>
                  <span>{(link.weight * 100).toFixed(0)}%</span>
                  <span className={cost > 0 ? 'negative' : 'positive'}>
                    {signed(cost * 100)}%<small>汇率引起的进口价格变化</small>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="macro-caption">
            伙伴增长影响出口需求，双边汇率影响进口价格。权重按经济规模、区域和预设贸易联系构造，尚非真实双边贸易份额。
          </p>
        </section>
        <section className="panel">
          <div className="panel-title">
            <div className="heading-with-icon">
              <TrendingUp size={16} />
              <h2>变化记录 · {e.currency}</h2>
            </div>
            <span className="subtle-badge">最近 {history.length} 条</span>
          </div>
          <div className="transmission-log">
            {history.length ? (
              history.map((t) => (
                <article key={t.id}>
                  <div>
                    <time>
                      D{day(t.minute)} · {clock(t.minute)}
                    </time>
                    <b>
                      {t.before.toFixed(t.channel === 'event' ? 2 : 3)} →{' '}
                      {t.after.toFixed(t.channel === 'event' ? 2 : 3)} <small>{t.unit}</small>
                    </b>
                  </div>
                  <p>{t.summary}</p>
                </article>
              ))
            ) : (
              <p className="macro-empty">
                暂无变化记录。推进一个游戏小时后，可观察成本、预期和资金流向如何变化。
              </p>
            )}
          </div>
        </section>
      </div>
      <EconomyCards snapshot={s} selected={selected} onSelect={setSelected} />
    </>
  );
}
