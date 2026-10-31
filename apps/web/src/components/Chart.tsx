import { useEffect, useMemo, useRef, useState } from 'react';
import type { Candle, Pair, Quote } from '@fx/contracts';
import { clock, price, signed } from '../lib/format';
import { CandlestickChart, Crosshair, Maximize2, ChartLine, RotateCcw } from 'lucide-react';

export function MarketChart({
  candles,
  quote: q,
  pair,
  loading,
}: {
  candles: Candle[];
  quote: Quote;
  pair: Pair;
  loading: boolean;
}) {
  const [interval, setInterval] = useState(5),
    [hover, setHover] = useState<number | null>(null),
    [expanded, setExpanded] = useState(false),
    [chartType, setChartType] = useState<'candles' | 'line'>('candles'),
    [crosshair, setCrosshair] = useState(true);
  const root = useRef<HTMLElement>(null);
  useEffect(() => setHover(null), [pair]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
      if (e.key === 'Tab') {
        const items = Array.from(
          root.current?.querySelectorAll<HTMLElement>('button, [tabindex="0"]') ?? [],
        );
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [expanded]);
  const bars = useMemo(() => {
    const grouped = new Map<number, Candle>();
    for (const c of candles) {
      const key = Math.floor((c.minute - 1) / interval) * interval;
      const prev = grouped.get(key);
      if (prev) {
        prev.high = Math.max(prev.high, c.high);
        prev.low = Math.min(prev.low, c.low);
        prev.close = c.close;
        prev.minute = c.minute;
      } else grouped.set(key, { ...c });
    }
    return [...grouped.values()].slice(-64);
  }, [candles, interval]);
  const width = 760,
    height = 300,
    left = 12,
    right = 83,
    bottom = 28,
    plotW = width - left - right,
    plotH = height - bottom - 12;
  const min = Math.min(...bars.map((b) => b.low)),
    max = Math.max(...bars.map((b) => b.high)),
    padding = Math.max((max - min) * 0.18, max * 0.0001);
  const low = min - padding,
    high = max + padding,
    y = (n: number) => 12 + ((high - n) / (high - low)) * plotH,
    dx = plotW / Math.max(1, bars.length),
    x = (i: number) => left + (i + 0.5) * dx;
  const selected = hover === null ? bars.at(-1) : bars[hover];
  return (
    <section
      ref={root}
      role={expanded ? 'dialog' : 'region'}
      aria-modal={expanded || undefined}
      className={`panel chart-panel ${expanded ? 'expanded' : ''}`}
      aria-label={`${pair} K 线图`}
    >
      <div className="chart-heading">
        <div className="pair-heading">
          <span className="pair-symbol">{pair.slice(0, 3).slice(0, 1)}</span>
          <div>
            <h2>{pair.replace('/', ' / ')}</h2>
            <span className="muted">外汇 · 合成中间价</span>
          </div>
        </div>
        <div className="chart-last">
          <strong>{price(q.mid, pair)}</strong>
          <span className={q.changePct >= 0 ? 'positive' : 'negative'}>
            {signed(q.changePct)}% <span className="muted">本局</span>
          </span>
        </div>
      </div>
      <div className="chart-tools">
        <div className="timeframes">
          <span className="timeframe-label">K 线周期</span>
          {[5, 15, 60].map((t) => (
            <button
              key={t}
              onClick={() => {
                setInterval(t);
                setHover(null);
              }}
              className={interval === t ? 'selected' : ''}
              aria-pressed={interval === t}
            >
              {t === 60 ? '1 小时' : `${t} 分钟`}
            </button>
          ))}
        </div>
        <div className="chart-tool-icons">
          <button
            title={chartType === 'candles' ? '切换为收盘折线' : '切换为 K 线'}
            aria-label={chartType === 'candles' ? '切换为收盘折线' : '切换为 K 线'}
            onClick={() => setChartType(chartType === 'candles' ? 'line' : 'candles')}
          >
            {chartType === 'candles' ? <ChartLine size={16} /> : <CandlestickChart size={16} />}
          </button>
          <button
            title="十字光标：鼠标、触摸或左右键查看"
            aria-label="十字光标"
            aria-pressed={crosshair}
            onClick={() => {
              setCrosshair(!crosshair);
              setHover(null);
            }}
          >
            <Crosshair size={16} />
          </button>
          <button
            title="恢复 5 分钟 K 线与十字光标"
            aria-label="重置图表视图"
            onClick={() => {
              setChartType('candles');
              setInterval(5);
              setCrosshair(true);
              setHover(null);
            }}
          >
            <RotateCcw size={15} />
          </button>
          <button
            aria-label={expanded ? '收起图表' : '展开图表'}
            onClick={() => setExpanded(!expanded)}
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </div>
      <div className="ohlc">
        <span>
          开 O <b>{selected ? price(selected.open, pair) : '—'}</b>
        </span>
        <span>
          高 H <b>{selected ? price(selected.high, pair) : '—'}</b>
        </span>
        <span>
          低 L <b>{selected ? price(selected.low, pair) : '—'}</b>
        </span>
        <span>
          收 C <b>{selected ? price(selected.close, pair) : '—'}</b>
        </span>
      </div>
      {loading ? (
        <div className="chart-loading">正在切换行情…</div>
      ) : (
        <svg
          className="candles"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          tabIndex={0}
          aria-label={`${pair} ${interval} 分钟模拟 ${chartType === 'candles' ? 'K 线' : '收盘折线'}，当前 ${price(q.mid, pair)}，左右键查看`}
          onKeyDown={(e) => {
            if (crosshair && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
              e.preventDefault();
              setHover(
                Math.max(
                  0,
                  Math.min(
                    bars.length - 1,
                    (hover ?? bars.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1),
                  ),
                ),
              );
            }
          }}
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            if (!crosshair) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const cursor = ((e.clientX - rect.left) / rect.width) * width;
            setHover(Math.max(0, Math.min(bars.length - 1, Math.floor((cursor - left) / dx))));
          }}
        >
          <defs>
            <linearGradient id="chart-glow" x1="0" x2="0" y1="0" y2="1">
              <stop stopColor="#a9cf82" stopOpacity=".035" />
              <stop offset="1" stopColor="#a9cf82" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x={left} y="12" width={plotW} height={plotH} fill="url(#chart-glow)" />
          {[0, 1, 2, 3, 4].map((i) => {
            const value = low + ((high - low) * i) / 4;
            return (
              <g key={i}>
                <line
                  x1={left}
                  y1={y(value)}
                  x2={width - right}
                  y2={y(value)}
                  stroke="#2b322c"
                  strokeDasharray="3 5"
                />
                <text x={width - right + 12} y={y(value) + 4} fill="#7e897f" fontSize="10">
                  {price(value, pair)}
                </text>
              </g>
            );
          })}
          {chartType === 'line' && (
            <polyline
              className="price-line"
              points={bars.map((b, i) => `${x(i)},${y(b.close)}`).join(' ')}
              stroke="#b8dc91"
              strokeWidth="2"
              fill="none"
            />
          )}
          {chartType === 'candles' &&
            bars.map((b, i) => (
              <g
                key={b.minute}
                fill={b.close >= b.open ? '#b8dc91' : '#e19187'}
                stroke={b.close >= b.open ? '#b8dc91' : '#e19187'}
              >
                <line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} strokeWidth="1" />
                <rect
                  x={x(i) - Math.max(2, dx * 0.58) / 2}
                  y={Math.min(y(b.open), y(b.close))}
                  width={Math.max(2, dx * 0.58)}
                  height={Math.max(1, Math.abs(y(b.open) - y(b.close)))}
                  strokeWidth="0"
                />
              </g>
            ))}
          {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
            const idx = Math.round((bars.length - 1) * f);
            return (
              <text
                key={i}
                x={x(idx)}
                y={height - 5}
                textAnchor="middle"
                fill="#7e897f"
                fontSize="10"
              >
                {bars[idx] ? clock(bars[idx].minute) : ''}
              </text>
            );
          })}
          {crosshair && hover !== null && bars[hover] && (
            <g className="chart-crosshair">
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1="12"
                y2={height - bottom}
                stroke="#858e79"
                strokeDasharray="3 3"
              />
              <line
                x1={left}
                x2={width - right}
                y1={y(bars[hover].close)}
                y2={y(bars[hover].close)}
                stroke="#858e79"
                strokeDasharray="3 3"
              />
              <text
                x={x(hover)}
                y="23"
                textAnchor={hover > bars.length * 0.7 ? 'end' : 'start'}
                fill="#e5efda"
                fontSize="10"
              >
                {clock(bars[hover].minute)} · {price(bars[hover].close, pair)}
              </text>
            </g>
          )}
          <line
            x1={left}
            x2={width - right}
            y1={y(q.mid)}
            y2={y(q.mid)}
            stroke="#b8dc91"
            opacity=".7"
            strokeDasharray="4 4"
          />
          <rect
            x={width - right + 3}
            y={y(q.mid) - 10}
            width="77"
            height="20"
            rx="3"
            fill="#b8dc91"
          />
          <text
            x={width - right + 41}
            y={y(q.mid) + 4}
            fill="#172016"
            textAnchor="middle"
            fontSize="11"
          >
            {price(q.mid, pair)}
          </text>
        </svg>
      )}
      <div className="chart-caption">
        <span>
          <i className="dot" /> 经济模拟行情
        </span>
        <span>
          点差 {q.spreadBps.toFixed(2)} bps · {chartType === 'candles' ? '每根 K 线' : '每个收盘点'}{' '}
          {interval} 分钟
        </span>
      </div>
    </section>
  );
}
