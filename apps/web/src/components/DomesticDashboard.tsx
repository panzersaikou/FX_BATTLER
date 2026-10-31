import { useState } from 'react';
import type { DomesticReading, Economy, Snapshot } from '@fx/contracts';
import { clock, day, signed } from '../lib/format';

type Tab = 'activity' | 'finance' | 'fiscal' | 'baseline';
type Metric = [string, string, number, string, string];
const amount = (value: number, unit: string) =>
  unit === 'USD' && value > 1e9
    ? `${(value / 1e9).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 十亿美元`
    : unit === 'USD'
      ? value.toPrecision(7)
      : unit === '人'
        ? `${(value / 1e6).toFixed(2)} 百万人`
        : value < 0.001 && value > 0
          ? value.toPrecision(6)
          : value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
export function DomesticDashboard({
  economy: e,
  snapshot: s,
}: {
  economy: Economy;
  snapshot: Snapshot;
}) {
  const [tab, setTab] = useState<Tab>('activity');
  const [trend, setTrend] = useState<keyof Omit<DomesticReading, 'minute'>>('businessClimate');
  const d = e.domestic;
  const metrics: Record<Exclude<Tab, 'baseline'>, Metric[]> = {
    activity: [
      ['consumptionGrowth', '消费增长预期', d.consumptionGrowth, '%', '实际工资、就业与融资成本'],
      ['investmentGrowth', '投资增长预期', d.investmentGrowth, '%', '出口需求、贷款利率与企业景气'],
      ['businessClimate', '工业景气', d.businessClimate, '指数', '50 为模型中性水平，非官方 PMI'],
      ['wageGrowth', '工资增长预期', d.wageGrowth, '%', '通胀预期与劳动力市场'],
      ['growth', '实际增长估计', e.growth, '%', '内需、投资与外需共同作用'],
      ['unemployment', '失业率估计', e.macro.unemployment, '%', '就业以较长时滞响应增长'],
    ],
    finance: [
      ['creditGrowth', '信贷增长预期', d.creditGrowth, '%', '实际利率与银行风险'],
      ['lendingRate', '企业贷款利率', d.lendingRate, '%', '政策利率、风险溢价与银行压力'],
      ['housingGrowth', '住房价格增长预期', d.housingGrowth, '%', '信贷、收入与利率共同影响'],
      ['householdStress', '家庭偿债压力', d.householdStress, '/100', '工资、就业与实际融资成本'],
      ['bankStress', '银行压力', d.bankStress, '/100', '家庭偿债、住房与风险偏好'],
      ['reserveBuffer', '外储缓冲', d.reserveBuffer, '指数', '模拟起点 = 100，非真实储备金额'],
    ],
    fiscal: [
      ['fiscalBalanceGDP', '财政余额', d.fiscalBalanceGDP, '% GDP', '负数为赤字；当前属于情景估计'],
      [
        'debt',
        '中央政府债务',
        d.governmentDebtGDP,
        '% GDP',
        e.baseline.facts.find((f) => f.key === 'debt')?.kind === 'assumption'
          ? '缺少可比统计，60% 为模型占位；不是实际债务率'
          : '中央政府口径，不能等同于一般政府债务',
      ],
      ['currentAccount', '经常账户', d.currentAccountGDP, '% GDP', '历史起点叠加需求与贸易条件'],
      ['inflation', 'CPI 通胀估计', e.inflation, '%', '进口成本、供给与需求缓慢传导'],
    ],
  };
  const trendLabels: Record<keyof Omit<DomesticReading, 'minute'>, string> = {
    growth: '增长估计 %',
    inflation: '通胀估计 %',
    unemployment: '失业率 %',
    consumptionGrowth: '消费增长预期 %',
    investmentGrowth: '投资增长预期 %',
    businessClimate: '工业景气指数',
    creditGrowth: '信贷增长预期 %',
    housingGrowth: '住房增长预期 %',
    bankStress: '银行压力 /100',
  };
  const values = d.history.map((r) => r[trend]);
  const lo = Math.min(...values),
    hi = Math.max(...values),
    pad = Math.max((hi - lo) * 0.25, 0.02);
  const points = values
    .map(
      (v, i) =>
        `${20 + (i * 560) / Math.max(1, values.length - 1)},${130 - ((v - lo + pad) / (hi - lo + 2 * pad)) * 100}`,
    )
    .join(' ');
  const current: Record<string, number> = {
    ...e.baseline.opening,
    inflation: e.inflation,
    growth: e.growth,
    unemployment: e.macro.unemployment,
    usdValue: e.usdValue,
    policyRate: e.policyRate,
    debt: d.governmentDebtGDP,
    currentAccount: d.currentAccountGDP,
  };
  return (
    <section className="panel domestic-panel" aria-label="经济体内部状态">
      <div className="panel-title">
        <div>
          <h2>{e.name} · 内部经济</h2>
          <p className="domestic-subtitle">
            {e.structure.specialization} ·{' '}
            {e.structure.regime === 'eur-band'
              ? '欧元联系汇率模型'
              : e.structure.regime === 'managed'
                ? '管理浮动简化模型'
                : '浮动汇率模型'}
          </p>
        </div>
        <span className="subtle-badge">每游戏小时更新</span>
      </div>
      <div className="country-facts">
        <span>
          基准 GDP <b>{amount(e.structure.gdpUsd, 'USD')}</b>
        </span>
        <span>
          人口 <b>{amount(e.structure.population, '人')}</b>
        </span>
        <span>
          统计年份 <b>{e.baseline.year}</b>
        </span>
      </div>
      <details className="data-explainer">
        <summary>这些经济数据从哪里来？为什么有些数值相近？</summary>
        <p>
          GDP、人口、通胀、增长、失业与贸易结构来自世界银行 2023
          年统计（含后续修订）。在「现实基准与扰动」可逐项查看原始值、来源链接、假设与本局起点。
        </p>
        <p>
          贷款利率、景气、住房和压力指数是模型估计。家庭与银行压力现在依据各国就业、通胀、信贷结构和模型风险参数分别初始化；外储指数统一从
          100 开始，只表示相对变化。
        </p>
        <p>
          财政余额仍假设为 −3% GDP；缺失中央政府债务时以 60%、缺失信贷时以 80% GDP
          占位。这些占位不能用于真实国家比较。模型仍有共同通胀目标与均值回归，并未做完整历史校准。
        </p>
      </details>
      <div className="domestic-tabs" role="tablist" aria-label="内部经济分类">
        {(
          [
            ['activity', '实体经济'],
            ['finance', '金融与住房'],
            ['fiscal', '财政与外部'],
            ['baseline', '现实基准与扰动'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-controls="domestic-tabpanel"
            id={`domestic-tab-${id}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="domestic-tabpanel" aria-labelledby={`domestic-tab-${tab}`}>
        {tab === 'baseline' ? (
          <div className="domestic-audit">
            <p>
              历史基准为 {s.baselineDataset.year}{' '}
              年年度数据，包含后续修订；不是今日市价，也不构成当年可知信息集。开局扰动有界且相关，之后的变化均为模拟。规模、人口和结构比例保持原基准。
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>指标</th>
                    <th>原始基准</th>
                    <th>本局开局</th>
                    <th>当前模拟</th>
                    <th>依据</th>
                  </tr>
                </thead>
                <tbody>
                  {e.baseline.facts.map((f) => (
                    <tr key={f.key}>
                      <td>
                        {f.label}
                        <small className="audit-unit">{f.unit}</small>
                      </td>
                      <td>{amount(f.value, f.unit)}</td>
                      <td>{amount(e.baseline.opening[f.key], f.unit)}</td>
                      <td>{amount(current[f.key], f.unit)}</td>
                      <td>
                        {f.sourceId ? (
                          <a
                            href={s.baselineDataset.sources[f.sourceId].url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {f.kind === 'derived' ? '统计换算' : '历史统计'} · {e.baseline.year} ↗
                          </a>
                        ) : (
                          <span className="baseline-warning">模型假设</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              私人信贷和中央政府债务若缺少该年统计，明确使用模型假设。央行制度不同，当前“政策利率”统一为模拟融资政策代理，不冒充各国官方利率。贸易权重、行业敏感度、景气指数及家庭/银行压力均为模型参数。
            </p>
          </div>
        ) : (
          <>
            <div className="domestic-metrics">
              {metrics[tab].map(([key, label, value, unit, hint]) => (
                <article key={key}>
                  <span>{label}</span>
                  <strong>
                    {value.toFixed(2)} <small>{unit}</small>
                  </strong>
                  <p>{hint}</p>
                  {e.baseline.opening[key] !== undefined && (
                    <small className="domestic-delta">
                      较开局 {signed(value - e.baseline.opening[key], 3)}
                    </small>
                  )}
                </article>
              ))}
            </div>
            <div className="domestic-trend">
              <div className="trend-title">
                <h3>内部趋势 · 最近 {d.history.length} 个观测点</h3>
                <select
                  aria-label="内部趋势指标"
                  value={trend}
                  onChange={(ev) => setTrend(ev.target.value as typeof trend)}
                >
                  {Object.entries(trendLabels).map(([key, label]) => (
                    <option value={key} key={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {values.length > 1 ? (
                <svg
                  role="img"
                  aria-label={`${e.name}${trendLabels[trend]}趋势`}
                  viewBox="0 0 600 160"
                >
                  <line x1="20" y1="130" x2="580" y2="130" stroke="#364431" />
                  <polyline points={points} fill="none" stroke="#bcdf96" strokeWidth="2" />
                  <text x="20" y="151" fill="#8d9e86" fontSize="11">
                    D{day(d.history[0].minute)} {clock(d.history[0].minute)}
                  </text>
                  <text x="580" y="151" textAnchor="end" fill="#8d9e86" fontSize="11">
                    D{day(d.lastUpdateMinute)} {clock(d.lastUpdateMinute)}
                  </text>
                  <text x="20" y="18" fill="#bcdf96" fontSize="11">
                    {lo.toFixed(3)} — {hi.toFixed(3)}
                  </text>
                </svg>
              ) : (
                <p className="macro-empty">
                  开局观测已记录。推进 1 个游戏小时后查看趋势；不会把网页刷新当作经济数据更新。
                </p>
              )}
            </div>
            <div className="domestic-brief">
              <b>每日内部观察 · {e.name}</b>
              <p>{d.brief}</p>
              {d.drivers.length > 0 && (
                <ul>
                  {d.drivers.map((driver) => (
                    <li key={driver}>{driver}</li>
                  ))}
                </ul>
              )}
              <small>
                各经济体均持续更新；事件报道仍按影响力分配。下一份内部观察：D
                {day(d.nextBriefMinute)} {clock(d.nextBriefMinute)}
              </small>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
