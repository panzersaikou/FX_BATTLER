import { useEffect, useRef, useState } from 'react';
import type { Snapshot, Pair } from '@fx/contracts';
import { price, money } from '../lib/format';

type Destination = 'terminal' | 'economies' | 'events' | 'history';
const lessons = [
  { title: '读懂一组汇率', target: '.chart-panel', view: 'terminal' },
  { title: '看懂 K 线与时间', target: '.chart-panel', view: 'terminal' },
  { title: '先算敞口，再选杠杆', target: '.order-panel', view: 'terminal' },
  { title: '亲手开一笔小仓位', target: '.order-panel', view: 'terminal' },
  { title: '观察盈亏并平仓', target: '.positions-panel', view: 'terminal' },
  { title: '看事件如何进入经济', target: '.archive-panel', view: 'events' },
  { title: '分清现实数据与模拟', target: '.history-panel', view: 'history' },
] as const;
export function LearningTour({
  snapshot: s,
  pair,
  active,
  setActive,
  navigate,
}: {
  snapshot: Snapshot;
  pair: Pair;
  active: boolean;
  setActive: (v: boolean) => void;
  navigate: (v: Destination) => void;
}) {
  const [step, setStep] = useState(0),
    [answer, setAnswer] = useState('');
  const oldFills = useRef(new Set<string>());
  const session = useRef(s.sessionId);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (active) {
      oldFills.current = new Set(s.account.fills.map((f) => f.id));
      setStep(0);
      setAnswer('');
      navigate('terminal');
    }
    // Capture exactly when the player starts the guide, not every market tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => {
    if (session.current !== s.sessionId) {
      session.current = s.sessionId;
      setActive(false);
    }
  }, [s.sessionId, setActive]);
  useEffect(() => {
    if (!active) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) setActive(false);
    };
    document.addEventListener('keydown', escape);
    const target = document.querySelector(lessons[step].target);
    target?.classList.add('tour-target');
    return () => {
      target?.classList.remove('tour-target');
      document.removeEventListener('keydown', escape);
    };
  }, [active, step, setActive]);
  if (!active)
    return (
      <div className="learning-invite">
        <div>
          <strong>第一次接触外汇？</strong>
          <span>用 7 步认识这个页面，完成一次虚拟开仓与平仓。</span>
        </div>
        <button onClick={() => setActive(true)}>开始新手教程 →</button>
      </div>
    );
  const q = s.quotes.find((q) => q.pair === pair)!;
  const [base, quote] = pair.split('/');
  const baseEconomy = s.economies.find((e) => e.currency === base)!;
  const opened = s.account.fills.find((f) => !oldFills.current.has(f.id) && f.action === 'open');
  const closed =
    opened &&
    s.account.fills.some((f) => f.positionId === opened.positionId && f.action !== 'open');
  const lesson = lessons[step];
  const go = (next: number) => {
    setStep(next);
    setAnswer('');
    navigate(lessons[next].view);
  };
  const locate = () => {
    navigate(lesson.view);
    setTimeout(
      () =>
        document
          .querySelector(lesson.target)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      60,
    );
  };
  const quiz = (question: string, correct: string, wrong: string, explanation: string) => (
    <div className="lesson-quiz">
      <strong>{question}</strong>
      <div>
        <button onClick={() => setAnswer(explanation)}>{correct}</button>
        <button onClick={() => setAnswer(`再想一下。${explanation}`)}>{wrong}</button>
      </div>
      {answer && <p role="status">{answer}</p>}
    </div>
  );
  return (
    <>
      <section ref={panel} className="panel learning-panel" aria-label="新手教程">
        <div className="context-heading">
          <span className="eyebrow">LEARN BY DOING · {step + 1} / 7</span>
          <button onClick={() => setActive(false)} aria-label="退出新手教程">
            退出 ×
          </button>
        </div>
        <div className="lesson-progress">
          {lessons.map((l, i) => (
            <button
              key={l.title}
              className={i === step ? 'active' : ''}
              aria-label={`教程第 ${i + 1} 步：${l.title}`}
              aria-current={i === step ? 'step' : undefined}
              onClick={() => go(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <h2>{lesson.title}</h2>
        {step === 0 && (
          <>
            <p>
              当前 {pair} = {price(q.mid, pair)}，意思是{' '}
              <b>
                1 {base} 可以兑换约 {price(q.mid, pair)} {quote}
              </b>
              。前面是基础货币，后面是计价货币。做多这组货币，期待前者相对后者升值；做空则相反。
            </p>
            {quiz(
              `做多 ${pair}，哪种方向通常有利？`,
              '这组报价上涨',
              '这组报价下跌',
              `做多持有 ${base} 对 ${quote} 的上涨敞口。盈利仍需覆盖点差和手续费。`,
            )}
          </>
        )}
        {step === 1 && (
          <>
            <p>
              每根蜡烛记录一段时间的开盘 O、最高 H、最低 L、收盘
              C。绿色代表收盘高于开盘，红色相反。试试「15
              分钟」、折线按钮、十字光标和展开图表；展开后按 Esc 收起。
            </p>
            <p>
              「5 分钟 K 线」是每根蜡烛的长度。顶部「1×」是游戏速度：现实 1 秒 = 游戏 1
              秒。暂停后价格不变；「推进一小时」会执行这段时间的行情、事件与强平检查。
            </p>
            {quiz(
              '把 K 线切成 1 小时，会让市场加速吗？',
              '不会，只改变图表聚合',
              '会，市场立即快 12 倍',
              '图表周期和模拟速度独立设置。',
            )}
          </>
        )}
        {step === 2 && (
          <>
            <p>
              例如买 1,000 {base}，当前名义敞口约 ${money(baseEconomy.usdValue * 1000)}。1×
              杠杆占用约同额保证金；10×
              占用约十分之一。固定交易数量时，杠杆不会再次放大同一笔仓位的盈亏。
            </p>
            <p>
              余额是已结算资金；净值 = 余额 + 浮动盈亏；可用保证金 = 净值 − 已用保证金。保证金水平 =
              净值 ÷ 已用保证金，低于 50% 时系统会强平。新手可先用 1× 和 1,000 单位。
            </p>
            {quiz(
              '同样 1,000 单位，从 1× 换成 10× 会怎样？',
              '占用更少保证金',
              '同一价格变化的盈亏再乘 10',
              '数量决定敞口；杠杆决定保证金。用释放的保证金继续加仓才会增大总敞口。',
            )}
          </>
        )}
        {step === 3 && (
          <>
            <p>
              定位右侧「交易指令」，设置 <b>1,000 单位、1×</b>
              ，再亲手点击「买入做多」。这是当前虚拟账户的真实操作，会留下交易记录；教程不会自动交易或重置你的游戏。也可以跳过本步。
            </p>
            <p>
              买入按 ASK，平仓按
              BID，卖出相反。两者的差就是点差；另外还有手续费与滑点。因此即使暂停行情，刚开仓也通常显示小额亏损。
            </p>
            <div className="lesson-result" role="status">
              {opened
                ? `已记录练习开仓：${opened.pair} · ${opened.units} 单位。继续观察持仓。`
                : '等待你手动开仓，或选择下一步跳过。'}
            </div>
          </>
        )}
        {step === 4 && (
          <>
            <p>
              在「当前持仓」找到刚才的交易，查看入场价、浮动盈亏和保证金。你可以运行或推进时间观察，再点击该行「平仓」。平仓将浮动盈亏结算到余额，并收取平仓手续费。
            </p>
            <p>
              当前净值 <b>${money(s.account.equity)}</b>，浮动盈亏{' '}
              <b>${money(s.account.unrealized)}</b>
              。教程不要求你盈利；平仓后可在「成交记录」核对两次成交和成本。
            </p>
            <div className="lesson-result" role="status">
              {closed
                ? '练习交易已平仓，可以去成交记录复盘。'
                : opened
                  ? '练习仓位尚未平仓；如果已被强平，也会计入本步。'
                  : '尚未记录教程中的开仓；可返回上一步，也可跳过。'}
            </div>
          </>
        )}
        {step === 5 && (
          <>
            <p>
              开局就有几条模拟背景。开始后，每 3
              个游戏小时有一份经济观察，另有随机突发事件。展开事件能看到市场预期、公布结果和传导链；高于预期的增长与高于预期的通胀，影响路径并不相同。
            </p>
            <p>
              「经济体」能查看内部状态、贸易联系和数据来源；「世界导演」可排程人工建议。你主动安排的情景会标注来源，不是不可预测的市场新闻。
            </p>
            {quiz(
              '一个利好标题能保证汇率上涨吗？',
              '不能，要看预期差及其他因素',
              '能，消息好就买入',
              '市场同时受到估值、预期、资金流、风险与共同冲击影响。',
            )}
          </>
        )}
        {step === 6 && (
          <>
            <p>
              这里的两年档案保存现实日频参考汇率；交易终端的 K
              线是本局合成行情。缺失币种不会用假曲线补齐。你可以选择货币对并下载日频 CSV。
            </p>
            <p>
              经济统计目前以 2023
              年为共同基准，之后由模型演化。压力指数与政策利率包含假设；「现实基准与扰动」能逐项查证。当前支持市价开平仓，止盈止损、挂单和隔夜费用还未实现。
            </p>
          </>
        )}
        <div className="lesson-actions">
          <button onClick={locate}>定位本步操作区 ↗</button>
          <button disabled={step === 0} onClick={() => go(step - 1)}>
            上一步
          </button>
          <button
            className="primary-button"
            onClick={() => (step === 6 ? (setActive(false), navigate('terminal')) : go(step + 1))}
          >
            {step === 6 ? '完成教程，回到市场' : '下一步'}
          </button>
        </div>
      </section>
      <button
        className="back-to-lesson"
        onClick={() => panel.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
      >
        返回教程 · {step + 1}/7 ↑
      </button>
    </>
  );
}
