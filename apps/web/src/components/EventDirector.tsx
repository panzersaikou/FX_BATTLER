import { useState } from 'react';
import { eventTopicLabels, type EventSuggestionInput, type Snapshot } from '@fx/contracts';
import { clock, day } from '../lib/format';

type Act = (path: string, body: unknown, message?: string) => Promise<unknown>;
const statusLabel = {
  queued: '等待发生',
  generating: '后台生成中',
  applied: '已进入市场',
  rejected: '未通过校验',
  cancelled: '已取消',
};
export function EventDirector({
  snapshot: s,
  busy,
  act,
}: {
  snapshot: Snapshot;
  busy: boolean;
  act: Act;
}) {
  const [open, setOpen] = useState(false);
  const [economy, setEconomy] = useState('EUR');
  const [topic, setTopic] = useState<EventSuggestionInput['topic']>('supply');
  const [direction, setDirection] = useState<EventSuggestionInput['direction']>('up');
  const [strength, setStrength] = useState<EventSuggestionInput['strength']>('small');
  const [delay, setDelay] = useState(60);
  const [note, setNote] = useState('港口拥堵造成部分原材料交付延迟');
  return (
    <div className="suggestion-director">
      <button className="director-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '收起人工建议' : '提出一个事件建议'} <span>＋</span>
      </button>
      {open && (
        <form
          className="suggestion-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              'suggestions',
              {
                requestId: crypto.randomUUID(),
                economy,
                topic,
                direction,
                strength,
                delayMinutes: delay,
                note,
              },
              '建议已排程，推进游戏时间后会按届时经济状态校验',
            );
          }}
        >
          <p>
            你在设定沙盒情景，已知的人工安排会影响挑战公平性。建议只改变经济指标，汇率仍由市场模型决定。
          </p>
          <div className="suggestion-fields">
            <label>
              经济体
              <select
                aria-label="建议经济体"
                value={economy}
                onChange={(e) => setEconomy(e.target.value)}
              >
                {s.economies.map((e) => (
                  <option key={e.currency} value={e.currency}>
                    {e.name} · {e.currency}
                  </option>
                ))}
              </select>
            </label>
            <label>
              影响指标
              <select
                aria-label="建议指标"
                value={topic}
                onChange={(e) => setTopic(e.target.value as typeof topic)}
              >
                {Object.entries(eventTopicLabels)
                  .filter(([key]) => key !== 'policy')
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              指标方向
              <select
                aria-label="建议方向"
                value={direction}
                onChange={(e) => setDirection(e.target.value as typeof direction)}
              >
                <option value="up">指标上升</option>
                <option value="down">指标下降</option>
              </select>
            </label>
            <label>
              影响程度
              <select
                aria-label="建议强度"
                value={strength}
                onChange={(e) => setStrength(e.target.value as typeof strength)}
              >
                <option value="small">轻微</option>
                <option value="moderate">中等</option>
              </select>
            </label>
            <label>
              预计发生
              <select
                aria-label="建议发生时间"
                value={delay}
                onChange={(e) => setDelay(Number(e.target.value))}
              >
                <option value="60">1 游戏小时后</option>
                <option value="180">3 游戏小时后</option>
                <option value="360">6 游戏小时后</option>
              </select>
            </label>
          </div>
          <label>
            背景建议
            <textarea
              aria-label="事件背景建议"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              minLength={5}
              maxLength={240}
              required
              rows={3}
            />
          </label>
          <small>
            {s.agent.mode === 'external'
              ? 'Agent 会结合文字与当前经济状态生成情景，也可能拒绝矛盾建议。到达排程后开始后台生成，发布可能延后；暂停时不发布。'
              : '本地导演按结构化指标、方向和幅度生成事件；文字作为背景保留，不推理自由文本。'}
            能源影响全球；财政余额上升表示赤字缩小或盈余增加。
          </small>
          <button
            className="primary-button"
            disabled={
              busy ||
              note.trim().length < 5 ||
              s.suggestions.filter((x) => ['queued', 'generating'].includes(x.status)).length >= 5
            }
          >
            提交情景建议
          </button>
        </form>
      )}
      {s.suggestions.length > 0 && (
        <div className="suggestion-queue" aria-label="事件建议队列">
          {[...s.suggestions]
            .reverse()
            .slice(0, 8)
            .map((x) => (
              <article key={x.id}>
                <div>
                  <strong>
                    {x.economy} · {eventTopicLabels[x.topic]}
                  </strong>
                  <span className="subtle-badge">{statusLabel[x.status]}</span>
                </div>
                <p>{x.note}</p>
                <small>
                  D{day(x.dueAt)} {clock(x.dueAt)} · {x.reason}
                </small>
                {['queued', 'generating'].includes(x.status) && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void act(`suggestions/${x.id}/cancel`, {}, '建议已取消')}
                  >
                    取消建议
                  </button>
                )}
              </article>
            ))}
        </div>
      )}
    </div>
  );
}
