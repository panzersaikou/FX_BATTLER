import { useEffect, useMemo, useState } from 'react';
import { currencies, type FxHistory, type Pair } from '@fx/contracts';
import { historyCross, weeklyHistory } from '@fx/simulation';
import { price, signed } from '../lib/format';

export function HistoryPanel() {
  const [data, setData] = useState<FxHistory | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [base, setBase] = useState('EUR'),
    [quote, setQuote] = useState('USD'),
    [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    let stopped = false;
    setError('');
    void fetch('/api/history')
      .then(async (r) => {
        if (!r.ok) throw new Error('读取失败');
        return r.json() as Promise<FxHistory>;
      })
      .then((d) => {
        if (!stopped) setData(d);
      })
      .catch(() => {
        if (!stopped) setError('历史数据读取失败，请重试。');
      });
    return () => {
      stopped = true;
    };
  }, [attempt]);
  const daily = useMemo(() => (data ? historyCross(data, base, quote) : []), [data, base, quote]);
  const weekly = useMemo(() => weeklyHistory(daily), [daily]);
  if (error)
    return (
      <section className="panel history-panel">
        <p role="alert">{error}</p>
        <button onClick={() => setAttempt((x) => x + 1)}>重新读取</button>
      </section>
    );
  if (!data) return <section className="panel history-panel">正在读取本地历史档案…</section>;
  const last = daily.at(-1),
    first = daily[0],
    selected = weekly[hover ?? weekly.length - 1];
  const pair = `${base}/${quote}` as Pair;
  const lo = Math.min(...weekly.map((x) => x[1])),
    hi = Math.max(...weekly.map((x) => x[1]));
  const start = first ? Date.parse(first[0]) : 0,
    span = last ? Date.parse(last[0]) - start : 1;
  const x = (date: string) => 40 + ((Date.parse(date) - start) / Math.max(1, span)) * 820;
  const y = (v: number) => 240 - ((v - lo) / Math.max(hi - lo, hi * 0.00001)) * 200;
  const download = () => {
    const rows = [
      'date,pair,reference_rate',
      ...daily.map(([date, value]) => `${date},${pair},${value.toPrecision(12)}`),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `fx-history-${base}-${quote}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="panel history-panel" aria-label="现实汇率历史">
      <div className="panel-title">
        <div>
          <h2>两年汇率档案</h2>
          <p className="muted">现实日频观测 · 独立于本局模拟 K 线</p>
        </div>
        <span className="subtle-badge">本地保存 · 无 API 额度</span>
      </div>
      <div className="history-provenance">
        <strong>
          {data.requestedStart} — {data.latestObservation}
        </strong>
        <span>
          目标截至 {data.requestedEnd}；最新数据早{' '}
          {Math.round(
            (Date.parse(data.requestedEnd) - Date.parse(data.latestObservation)) / 86400000,
          )}{' '}
          天
        </span>
        <p>
          美联储 H.10 / FRED，经公开镜像固定版本导入。19 种非美元货币 + USD 基准，可计算 190
          组无方向交叉组合。不是实时成交价，不含点差或日内高低价。
        </p>
      </div>
      <div className="history-controls">
        <label>
          基础货币
          <select
            aria-label="历史基础货币"
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
              setHover(null);
            }}
          >
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <span>/</span>
        <label>
          计价货币
          <select
            aria-label="历史计价货币"
            value={quote}
            onChange={(e) => {
              setQuote(e.target.value);
              setHover(null);
            }}
          >
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <button onClick={download} disabled={!daily.length}>
          下载此货币对日频 CSV
        </button>
      </div>
      {last && first ? (
        <>
          <div className="history-summary">
            <strong>
              {pair} · {selected?.[0]} · {selected ? price(selected[1], pair) : ''}
            </strong>
            <span className={last[1] >= first[1] ? 'positive' : 'negative'}>
              区间变化 {signed((last[1] / first[1] - 1) * 100)}%
            </span>
            <span>{daily.length} 个共同观测日 · 图中按周取最后观测</span>
          </div>
          <svg
            className="history-chart"
            viewBox="0 0 900 285"
            role="img"
            aria-label={`${pair} 现实历史周采样曲线`}
            tabIndex={0}
            onPointerLeave={() => setHover(null)}
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const cursor = ((e.clientX - r.left) / r.width) * 900;
              let index = 0;
              weekly.forEach((p, i) => {
                if (Math.abs(x(p[0]) - cursor) < Math.abs(x(weekly[index][0]) - cursor)) index = i;
              });
              setHover(index);
            }}
            onKeyDown={(e) => {
              if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                setHover(
                  Math.max(
                    0,
                    Math.min(
                      weekly.length - 1,
                      (hover ?? weekly.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1),
                    ),
                  ),
                );
              }
            }}
          >
            {[0, 0.5, 1].map((v) => (
              <g key={v}>
                <line
                  x1="40"
                  x2="860"
                  y1={y(lo + (hi - lo) * v)}
                  y2={y(lo + (hi - lo) * v)}
                  stroke="#354035"
                  strokeDasharray="4 6"
                />
                <text x="45" y={y(lo + (hi - lo) * v) - 6} fill="#94a190" fontSize="11">
                  {price(lo + (hi - lo) * v, pair)}
                </text>
              </g>
            ))}
            <polyline
              points={weekly.map((p) => `${x(p[0])},${y(p[1])}`).join(' ')}
              fill="none"
              stroke="#b8dc91"
              strokeWidth="2"
            />
            {selected && <circle cx={x(selected[0])} cy={y(selected[1])} r="4" fill="#e5efda" />}
            <text x="40" y="278" fill="#94a190" fontSize="12">
              {first[0]}
            </text>
            <text x="860" y="278" textAnchor="end" fill="#94a190" fontSize="12">
              {last[0]}
            </text>
          </svg>
          <p className="muted">
            连线仅辅助阅读。交叉价使用两个系列同一天的参考观测，缺失日期不补值；不同市场的采样时刻可能不同，不代表可成交套利机会。可用左右方向键查看采样点。
          </p>
        </>
      ) : (
        <p className="history-empty" role="status">
          {base === quote ? '请选择两种不同货币。' : '此组合缺少真实历史数据；不会用模拟曲线代替。'}
        </p>
      )}
      <details className="data-explainer">
        <summary>覆盖、来源与采集方法</summary>
        <p>
          尚未覆盖：{data.missing.join('、')}。USD 固定为
          1，是计价基准。原始日频数据已随项目保存，共{' '}
          {Object.values(data.series)
            .reduce((sum, s) => sum + s.points.length, 0)
            .toLocaleString()}{' '}
          条观测。
        </p>
        <p>
          游戏经济起点仍是可比的 2023 年年度统计；这个档案用于研究，不会把 2026 汇率静默混入 2023
          宏观状态。统计来源相隔多年时，不能声称是一套当前真实经济快照。
        </p>
        <a href={data.sourceUrl} target="_blank" rel="noreferrer">
          查看固定版本原始 CSV ↗
        </a>
        <div className="history-sources">
          {[...new Set([base, quote])]
            .filter((c) => data.series[c])
            .map((c) => (
              <a key={c} href={data.series[c].sourceUrl} target="_blank" rel="noreferrer">
                {c} · FRED {data.series[c].seriesId} ↗
              </a>
            ))}
        </div>
        <p>
          获取日期：{data.retrievedOn} · SHA-256：<code>{data.sha256}</code>
        </p>
      </details>
    </section>
  );
}
