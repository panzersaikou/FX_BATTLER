import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Clock3,
  Globe2,
  Layers3,
  LayoutDashboard,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Search,
  ShieldCheck,
  SkipForward,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import type { BaselineMode, Pair } from '@fx/contracts';
import { simulationSpeeds, type SimulationSpeed } from '@fx/contracts';
import { EventList } from './components/EventList';
import { EconomyDashboard } from './components/EconomyDashboard';
import { MarketChart } from './components/Chart';
import { OrderTicket } from './components/OrderTicket';
import { BaselinePanel } from './components/BaselinePanel';
import { OpeningBriefs } from './components/OpeningBriefs';
import { AgentPanel } from './components/AgentPanel';
import { EventDirector } from './components/EventDirector';
import { HistoryPanel } from './components/HistoryPanel';
import { LearningTour } from './components/LearningTour';
import { useSession } from './lib/useSession';
import { clock, day, money, price, signed } from './lib/format';

const favorites: Pair[] = [
  'EUR/USD',
  'GBP/USD',
  'USD/JPY',
  'AUD/USD',
  'USD/CHF',
  'USD/CAD',
  'EUR/JPY',
  'USD/MXN',
  'USD/CNY',
  'USD/INR',
  'USD/BRL',
  'USD/KRW',
];
const navItems = [
  { id: 'terminal', label: '交易终端', icon: LayoutDashboard },
  { id: 'economies', label: '经济体', icon: Globe2 },
  { id: 'events', label: '事件档案', icon: Radio },
  { id: 'history', label: '历史数据', icon: Layers3 },
  { id: 'review', label: '交易复盘', icon: BookOpen },
] as const;
type View = (typeof navItems)[number]['id'];

export default function App() {
  const [view, setView] = useState<View>('terminal'),
    [pair, setPair] = useState<Pair>('EUR/USD'),
    [search, setSearch] = useState(''),
    [tab, setTab] = useState<'positions' | 'fills'>('positions'),
    [modal, setModal] = useState<'help' | 'reset' | null>(null),
    [newBaseline, setNewBaseline] = useState<BaselineMode>('historical'),
    [eventFilter, setEventFilter] = useState('all'),
    [tutorial, setTutorial] = useState(false);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = document.querySelector<HTMLElement>('.modal');
    const focusable = () =>
      Array.from(
        root?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, [tabindex="0"]',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModal(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable(),
        first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [modal]);
  const {
    snapshot: s,
    baselineStatus,
    error,
    busy,
    notice,
    act,
    reset,
    retry,
    clearError,
  } = useSession(pair, setPair);
  const q = s?.quotes.find((q) => q.pair === pair);
  const change = s ? s.account.equity - s.account.initialBalance : 0;
  const watch = s
    ? search
      ? s.quotes.filter((q) =>
          q.pair.toLowerCase().replace('/', '').includes(search.toLowerCase().replace('/', '')),
        )
      : favorites.flatMap((p) => {
          const q = s.quotes.find((q) => q.pair === p);
          return q ? [q] : [];
        })
    : [];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand-mark"
          aria-label="返回交易终端"
          onClick={() => setView('terminal')}
        >
          <TrendingUp size={25} />
        </button>
        <div className="side-navigation">
          {navItems.map((n) => (
            <button
              key={n.id}
              className={view === n.id ? 'active' : ''}
              onClick={() => setView(n.id)}
              title={n.label}
              aria-label={n.label}
            >
              <n.icon size={20} />
              <span>{n.label}</span>
            </button>
          ))}
        </div>
        <button className="side-help" onClick={() => setModal('help')} aria-label="玩法说明">
          <ShieldCheck size={21} />
          <span>玩法说明</span>
        </button>
        <span className="sidebar-version">V 0.4</span>
      </aside>
      <div className="workspace">
        {import.meta.env.MODE === 'offline' && (
          <div className="offline-preview-banner">
            离线体验版 · 无需服务器 · 数据仅保存在本页，刷新会重新开始
          </div>
        )}
        <header className="topbar">
          <div className="wordmark">
            FX<span>BATTLER</span>
            <i /> <small>经济模拟实验室</small>
          </div>
          <div className="topbar-right">
            <span className="simulation-label">
              <i className="dot" />
              {import.meta.env.MODE === 'offline' ? '离线交互预览' : '模拟模式'}
            </span>
            <span className="topbar-separator" />
            <button
              className="avatar"
              onClick={() => setModal('help')}
              aria-label="查看虚拟账户说明"
            >
              P
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                WORKSPACE <span>/</span>{' '}
                {view === 'terminal'
                  ? 'TRADING TERMINAL'
                  : view === 'economies'
                    ? 'WORLD ECONOMIES'
                    : view === 'events'
                      ? 'EVENT ARCHIVE'
                      : view === 'history'
                        ? 'HISTORICAL DATA'
                        : 'TRADING JOURNAL'}
              </div>
              <h1>
                {view === 'terminal'
                  ? '观察世界，交易变化。'
                  : view === 'economies'
                    ? '价格背后，是经济。'
                    : view === 'events'
                      ? '每一次变化，都有迹可循。'
                      : view === 'history'
                        ? '从真实历史，认识波动。'
                        : '把每一次判断，留给下一次。'}
              </h1>
              <p>
                {view === 'terminal'
                  ? '读懂预期与现实之间的距离，建立你的交易判断。'
                  : view === 'economies'
                    ? '不同经济体，不同节奏。各国内部状态持续更新，全球影响力决定独立事件的覆盖频率。'
                    : view === 'events'
                      ? '跟踪经济报告与突发事件，观察市场如何重新定价。'
                      : view === 'history'
                        ? '日频参考汇率本地存档，与本局模拟行情分别展示。'
                        : '回看成交、成本与持仓，理解自己的风险敞口。'}
              </p>
            </div>
            <button
              className="new-session"
              onClick={() => {
                setNewBaseline(baselineStatus?.defaultMode ?? 'historical');
                setModal('reset');
              }}
              disabled={!s || busy}
            >
              <Plus size={16} /> 新的一局
            </button>
          </div>
          {!s ? (
            <section className="panel loading-state">
              <Activity size={30} />
              <h2>{error ? '暂时无法进入市场' : '正在建立模拟世界'}</h2>
              <p>{error || '加载经济体、开局基准与虚拟账户…'}</p>
              {error && (
                <button className="primary-button" onClick={() => void retry()} disabled={busy}>
                  重新连接
                </button>
              )}
              {error && baselineStatus?.referenceAvailable && (
                <button
                  className="text-button"
                  onClick={() => void reset('historical')}
                  disabled={busy}
                >
                  改用历史基准开始
                </button>
              )}
            </section>
          ) : (
            <>
              <LearningTour
                snapshot={s}
                pair={pair}
                active={tutorial}
                setActive={setTutorial}
                navigate={setView}
              />
              <div className="session-strip">
                <div className="session-name">
                  <span className="session-dot" />
                  <b>自由沙盒</b>
                  <span className="session-divider">/</span>
                  <span>第 {String(day(s.minute)).padStart(2, '0')} 天</span>
                  <strong className="mono">{clock(s.minute, true)}</strong>
                  <span className="muted">游戏时间</span>
                </div>
                <div className="playback">
                  <span className="playback-state">{s.running ? '市场运行中' : '市场已暂停'}</span>
                  <button
                    title="推进 1 个游戏小时并暂停"
                    aria-label="推进一小时"
                    disabled={busy}
                    onClick={() => void act('control', { step: 60 })}
                  >
                    <SkipForward size={16} />
                    <span>+1h</span>
                  </button>
                  <select
                    className="speed-select"
                    aria-label="模拟速度"
                    title={`现实 1 秒 = 模拟 ${s.speed} 秒；K 线周期不会改变时间速度`}
                    disabled={busy}
                    value={s.speed}
                    onChange={(event) =>
                      void act('control', { speed: Number(event.target.value) as SimulationSpeed })
                    }
                  >
                    {simulationSpeeds.map((speed) => (
                      <option key={speed} value={speed}>
                        {speed === 1 ? '1× · 现实速度' : `${speed}× · 加速`}
                      </option>
                    ))}
                  </select>
                  <button
                    className="play-button"
                    disabled={busy}
                    onClick={() => void act('control', { running: !s.running })}
                  >
                    {s.running ? <Pause size={14} /> : <Play size={14} />}
                    <span>{s.running ? '暂停' : '开始模拟'}</span>
                  </button>
                </div>
              </div>
              <BaselinePanel source={s.source} status={baselineStatus} />
              <div className="metrics-grid">
                <div className="metric">
                  <span>
                    账户净值 <small>USD</small>
                  </span>
                  <strong>${money(s.account.equity)}</strong>
                  <div className={change >= 0 ? 'positive' : 'negative'}>
                    {change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} />}{' '}
                    {signed(change)} <span>本局总盈亏</span>
                  </div>
                </div>
                <div className="metric">
                  <span>浮动盈亏</span>
                  <strong
                    className={
                      s.account.unrealized === 0
                        ? ''
                        : s.account.unrealized > 0
                          ? 'positive'
                          : 'negative'
                    }
                  >
                    {s.account.unrealized >= 0 ? '+' : '−'}${money(Math.abs(s.account.unrealized))}
                  </strong>
                  <div className="muted">
                    {s.account.positions.length} 笔当前持仓 <span>按平仓报价计价</span>
                  </div>
                </div>
                <div className="metric">
                  <span>可用保证金</span>
                  <strong>${money(s.account.freeMargin)}</strong>
                  <div className="muted">
                    已用 ${money(s.account.usedMargin)}
                    <span className="margin-bar">
                      <i
                        style={{
                          width: `${Math.max(0, Math.min(100, (s.account.usedMargin / Math.max(s.account.equity, 1)) * 100))}%`,
                        }}
                      />
                    </span>
                  </div>
                </div>
                <div className="metric">
                  <span>
                    市场脉搏 <Activity size={14} />
                  </span>
                  <strong className="market-health">
                    {Math.max(...s.economies.map((e) => e.stress)) > 0.25 ? '波动升温' : '平稳运行'}
                    <span className="live-bars">
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  </strong>
                  <div className="muted">
                    {s.economies.length} 种货币 <span>{s.quotes.length / 2} 组交叉汇率</span>
                  </div>
                </div>
              </div>
              {view === 'terminal' && q && (
                <>
                  <div className="trading-grid">
                    <section className="panel watchlist">
                      <div className="panel-title">
                        <h2>市场行情</h2>
                        <span className="muted">FX</span>
                      </div>
                      <div className="search-field">
                        <Search size={13} />
                        <input
                          aria-label="搜索货币对"
                          placeholder="搜索货币对"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                      <div className="watch-label">
                        <span>货币对</span>
                        <span>价格 / 涨跌</span>
                      </div>
                      <div className="watch-items">
                        {watch.length ? (
                          watch.map((item) => (
                            <button
                              key={item.pair}
                              className={`watch-item ${pair === item.pair ? 'selected' : ''}`}
                              onClick={() => setPair(item.pair)}
                            >
                              <span>
                                <b>{item.pair}</b>
                                <small>{item.pair.includes('USD') ? '美元直盘' : '交叉货币'}</small>
                              </span>
                              <span>
                                <b>{price(item.mid, item.pair)}</b>
                                <small className={item.changePct >= 0 ? 'positive' : 'negative'}>
                                  {signed(item.changePct)}%
                                </small>
                              </span>
                            </button>
                          ))
                        ) : (
                          <p className="search-empty">没有匹配的货币对</p>
                        )}
                      </div>
                      <div className="watch-footer">
                        <Layers3 size={12} /> 统一基准 · 交叉计算
                      </div>
                    </section>
                    <MarketChart
                      candles={s.candles}
                      quote={q}
                      pair={pair}
                      loading={s.chartPair !== pair}
                    />
                    <OrderTicket
                      snapshot={s}
                      pair={pair}
                      busy={busy || s.chartPair !== pair}
                      onOrder={(order) =>
                        void act(
                          'orders',
                          order,
                          `${order.pair} ${order.side === 'buy' ? '做多' : '做空'}订单已成交`,
                        )
                      }
                    />
                  </div>
                  <div className="intelligence-grid">
                    <section className="panel event-panel">
                      <div className="panel-title">
                        <div className="heading-with-icon">
                          <Radio size={16} />
                          <h2>世界动态</h2>
                          <span className="counter">
                            {s.events.length
                              ? `${s.events.length} 条新事件`
                              : `${s.openingBriefs.length} 条背景`}
                          </span>
                        </div>
                        <button className="text-button" onClick={() => setView('events')}>
                          全部事件 <ArrowRight size={13} />
                        </button>
                      </div>
                      <div className="next-report">
                        <Clock3 size={14} />
                        <span>下一份经济观察</span>
                        <b>{clock(s.agent.nextReport)}</b>
                        <span className="muted">
                          还有 {Math.ceil(s.agent.nextReport - s.minute)} 分钟
                        </span>
                        <span className="report-label">游戏时间</span>
                      </div>
                      {s.events.length > 0 && <EventList events={s.events} compact />}
                      <OpeningBriefs briefs={s.openingBriefs} compact />
                    </section>
                    <section className="panel director-panel">
                      <div className="panel-title">
                        <div className="heading-with-icon">
                          <Sparkles size={16} />
                          <h2>世界导演</h2>
                        </div>
                        <span className="subtle-badge">
                          {s.agent.mode === 'external' ? '外部 Agent' : '本地情景'}
                        </span>
                      </div>
                      <div className="director-status">
                        <span className="director-orbit">
                          <Globe2 size={23} />
                        </span>
                        <div>
                          <h3>
                            {
                              {
                                observing: '正在观察世界',
                                generating: '正在后台生成',
                                ready: '情景已就绪',
                                published: '新的事件已发布',
                                fallback: '本次使用本地降级',
                                rejected: '情景未被采纳',
                              }[s.agent.phase]
                            }
                          </h3>
                          <p>经济状态 → 情景提议 → 校验 → 发布</p>
                        </div>
                      </div>
                      <p className="director-summary">{s.agent.summary}</p>
                      <AgentPanel agent={s.agent} busy={busy} act={act} />
                      <EventDirector snapshot={s} busy={busy} act={act} />
                      <div className="director-footer">
                        <span>
                          <i className="dot" /> 已发布 {s.agent.accepted} 个事件
                        </span>
                        <button className="text-button" onClick={() => setView('economies')}>
                          经济体观察 <ArrowRight size={12} />
                        </button>
                      </div>
                    </section>
                  </div>
                </>
              )}
              {view === 'economies' && (
                <>
                  <div className="section-intro">
                    <h2>
                      经济体观察 <span>{s.economies.length} 个经济体</span>
                    </h2>
                    <span>
                      <i className="dot" /> 历史基准 · 模拟经济状态
                    </span>
                  </div>
                  <EconomyDashboard snapshot={s} />
                  <div className="info-banner">
                    <InfoSymbol />
                    事件覆盖权重影响被选择的频率，不代表事件发生概率或货币强弱。当前为基础模型，尚未做历史数据校准。
                  </div>
                </>
              )}
              {view === 'events' && (
                <section className="panel archive-panel">
                  <div className="panel-title">
                    <h2>
                      事件时间线 <span className="counter">{s.events.length}</span>
                    </h2>
                    <select
                      aria-label="筛选事件"
                      value={eventFilter}
                      onChange={(e) => setEventFilter(e.target.value)}
                    >
                      <option value="all">全部事件</option>
                      <option value="report">经济报告</option>
                      <option value="surprise">突发事件</option>
                      <option value="policy">央行决议</option>
                    </select>
                  </div>
                  <EventList
                    events={s.events.filter((e) => eventFilter === 'all' || e.kind === eventFilter)}
                  />
                  <OpeningBriefs briefs={s.openingBriefs} />
                </section>
              )}
              {view === 'history' && <HistoryPanel />}
              {(view === 'terminal' || view === 'review') && (
                <section className="panel positions-panel">
                  <div className="positions-heading">
                    <div className="position-tabs">
                      <button
                        className={tab === 'positions' ? 'active' : ''}
                        onClick={() => setTab('positions')}
                      >
                        当前持仓 <span>{s.account.positions.length}</span>
                      </button>
                      <button
                        className={tab === 'fills' ? 'active' : ''}
                        onClick={() => setTab('fills')}
                      >
                        成交记录 <span>{s.account.fills.length}</span>
                      </button>
                    </div>
                    <span className="muted">
                      保证金水平{' '}
                      <b
                        className={
                          s.account.marginLevel !== null && s.account.marginLevel < 100
                            ? 'negative'
                            : ''
                        }
                      >
                        {s.account.marginLevel === null
                          ? '—'
                          : `${s.account.marginLevel.toFixed(1)}%`}
                      </b>
                    </span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          {(tab === 'positions'
                            ? [
                                '货币对 / 方向',
                                '数量',
                                '开仓价格',
                                '当前价格',
                                '保证金',
                                '浮动盈亏',
                                '操作',
                              ]
                            : [
                                '时间',
                                '货币对',
                                '类型 / 方向',
                                '数量',
                                '成交价格',
                                '手续费',
                                '已实现毛盈亏',
                              ]
                          ).map((t) => (
                            <th key={t}>{t}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tab === 'positions'
                          ? s.account.positions.map((p) => (
                              <tr key={p.id}>
                                <td>
                                  <b>{p.pair}</b>{' '}
                                  <span className={`side-badge ${p.side}`}>
                                    {p.side === 'buy' ? '多' : '空'}
                                  </span>
                                </td>
                                <td>{p.units.toLocaleString()}</td>
                                <td>{price(p.entry, p.pair)}</td>
                                <td>{price(p.mark, p.pair)}</td>
                                <td>${money(p.margin)}</td>
                                <td className={p.pnl >= 0 ? 'positive' : 'negative'}>
                                  {signed(p.pnl)}
                                </td>
                                <td>
                                  <button
                                    className="close-position"
                                    disabled={busy}
                                    onClick={() =>
                                      void act(
                                        `positions/${p.id}/close`,
                                        {},
                                        '仓位已平仓，盈亏已结算',
                                      )
                                    }
                                  >
                                    平仓
                                  </button>
                                </td>
                              </tr>
                            ))
                          : s.account.fills.map((f) => (
                              <tr key={f.id}>
                                <td>
                                  D{day(f.minute)} · {clock(f.minute)}
                                </td>
                                <td>
                                  <b>{f.pair}</b>
                                </td>
                                <td>
                                  {f.action === 'open'
                                    ? '开仓'
                                    : f.action === 'close'
                                      ? '平仓'
                                      : '强平'}{' '}
                                  · {f.side === 'buy' ? '买入' : '卖出'}
                                </td>
                                <td>{f.units.toLocaleString()}</td>
                                <td>{price(f.price, f.pair)}</td>
                                <td>${money(f.fee)}</td>
                                <td className={f.pnl >= 0 ? 'positive' : 'negative'}>
                                  {f.action === 'open' ? '—' : signed(f.pnl)}
                                </td>
                              </tr>
                            ))}
                      </tbody>
                    </table>
                    {(tab === 'positions' ? s.account.positions.length : s.account.fills.length) ===
                      0 && (
                      <div className="empty-positions">
                        <Layers3 size={21} />
                        <span>
                          {tab === 'positions'
                            ? '还没有持仓。观察市场，等待你的第一个判断。'
                            : '尚无成交记录，完成一笔交易后会显示在这里。'}
                        </span>
                      </div>
                    )}
                  </div>
                </section>
              )}
              <footer className="page-footer">
                <span>
                  <i className="dot" /> {s.source.label}
                </span>
                <span>
                  非实时市场数据 <i>·</i> 虚拟资金 <i>·</i> 世界由你的判断探索
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {(error || notice) && s && (
        <div className={`toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
          {error ? <Activity size={17} /> : <Check size={17} />}
          <span>{error || notice}</span>
          {error && (
            <button aria-label="关闭提示" onClick={clearError}>
              <X size={15} />
            </button>
          )}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setModal(null)} aria-label="关闭">
              <X size={18} />
            </button>
            <span className="modal-icon">
              {modal === 'reset' ? <RotateCcw size={25} /> : <Globe2 size={25} />}
            </span>
            <h2 id="modal-title">
              {modal === 'reset' ? '开始一个新的世界？' : '你的外汇经济实验室'}
            </h2>
            {modal === 'reset' ? (
              <>
                <p>
                  新局创建成功后将替换当前持仓和交易记录。新的世界从 $10,000
                  虚拟资金开始，市场起始暂停。
                </p>
                <label className="baseline-choice">
                  开局汇率来源
                  <select
                    aria-label="开局汇率来源"
                    value={newBaseline}
                    onChange={(e) => setNewBaseline(e.target.value as BaselineMode)}
                    disabled={busy}
                  >
                    <option value="historical">30 币种 · 2023 历史基准 + 开局扰动</option>
                    <option value="reference" disabled={!baselineStatus?.referenceAvailable}>
                      Twelve Data · 9 币种参考起点
                      {!baselineStatus?.referenceAvailable ? '（未配置）' : ''}
                    </option>
                  </select>
                </label>
                <p>
                  {newBaseline === 'reference'
                    ? '使用最近完整参考快照，报价时间可能早于今天。更新失败时会标明缓存来源；没有合格快照时保留当前游戏。'
                    : '使用带来源的 2023 年历史统计，加入相关小幅扰动。无需 API，不是今日市价。'}
                </p>
                {error && (
                  <p className="baseline-warning" role="alert">
                    {error}
                  </p>
                )}
                <div className="modal-actions">
                  <button onClick={() => setModal(null)}>继续当前游戏</button>
                  <button
                    className="primary-button"
                    onClick={() => {
                      void reset(newBaseline).then((ok) => {
                        if (ok) setModal(null);
                      });
                    }}
                    disabled={busy}
                  >
                    开启新的一局
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  观察经济报告与预期差，选择货币对交易。当前
                  {s?.source.kind === 'reference'
                    ? '以 Twelve Data 的参考汇率开局，之后独立模拟。可在「开局基准」查看原始报价时间。'
                    : '以 2023 年历史基准加受约束的扰动开局，不是当天真实汇率。'}
                </p>
                <ul>
                  <li>
                    默认 1×：现实 1 秒等于游戏 1 秒。可以选择 5×、15×、60×、300×
                    加速，暂停期间不推进时间。
                  </li>
                  <li>
                    K 线的「5 分钟」表示一根蜡烛覆盖 5
                    个游戏分钟，与运行速度分开设置；当前蜡烛会逐秒更新。
                  </li>
                  <li>每 3 个游戏小时有一份经济报告，期间可能出现突发事件。</li>
                  <li>做多按买价开仓、卖价平仓；做空相反。成交另有滑点和手续费。</li>
                  <li>保证金水平低于 50% 时会自动强平，极端行情可能出现负余额。</li>
                  <li>当前支持市价开平仓；挂单、止盈止损和隔夜费用将在后续加入。</li>
                </ul>
                <div className="modal-disclosure">
                  {s?.agent.mode === 'external'
                    ? '外部 Agent 已启用，事件后台生成并校验，异常时可降级为本地情景。'
                    : '当前使用本地导演。外部 Agent 代码已接通，配置后可在世界导演切换。'}
                  图表为合成行情，内部经济是基于历史统计的模型推演。
                  {import.meta.env.MODE === 'offline'
                    ? '当前全部在浏览器内运行，刷新或关闭本页会清除会话。'
                    : '会话保存在服务器内存中，重启会清除。'}
                </div>
                <button className="primary-button" onClick={() => setModal(null)}>
                  进入我的市场 <ArrowRight size={16} />
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setModal(null);
                    setTutorial(true);
                  }}
                >
                  从新手教程开始 →
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function InfoSymbol() {
  return <ShieldCheck size={16} />;
}
