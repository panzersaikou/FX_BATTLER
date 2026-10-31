import { useState } from 'react';
import { ChevronDown, Radio, Zap } from 'lucide-react';
import type { MarketEvent } from '@fx/contracts';
import { eventTopicLabels } from '@fx/contracts';
import { clock, day, signed } from '../lib/format';

export function EventList({
  events,
  compact = false,
}: {
  events: MarketEvent[];
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="event-list">
      {events.length ? (
        events.slice(0, compact ? 3 : 60).map((e) => (
          <article className={`event-item ${expanded === e.id ? 'open' : ''}`} key={e.id}>
            <button
              className="event-main"
              onClick={() => setExpanded(expanded === e.id ? null : e.id)}
              aria-expanded={expanded === e.id}
            >
              <span className={`event-icon ${e.kind === 'surprise' ? 'surprise' : ''}`}>
                {e.kind === 'surprise' ? <Zap size={17} /> : <Radio size={17} />}
              </span>
              <span className="event-content">
                <span className="event-meta">
                  <b>{e.economy}</b>
                  <span>{eventTopicLabels[e.topic]}</span>
                  {e.generator === 'external' && <span className="subtle-badge">Agent 生成</span>}
                  {e.generator === 'fallback' && <span className="subtle-badge">本地降级</span>}
                  {e.origin === 'user-directed' && <span className="subtle-badge">人工情景</span>}
                  <span className={`impact ${e.importance}`}>
                    {e.importance === 'high'
                      ? '高影响'
                      : e.importance === 'medium'
                        ? '中等影响'
                        : '局部影响'}
                  </span>
                </span>
                <strong>{e.title}</strong>
                <span className="event-preview">{e.description}</span>
              </span>
              <span className="event-time">
                D{day(e.minute)} · {clock(e.minute)}
                <ChevronDown size={13} />
              </span>
            </button>
            {expanded === e.id && (
              <div className="event-details">
                <p>{e.description}</p>
                <div>
                  <span>
                    市场预期{' '}
                    <b>
                      {e.expected.toFixed(2)}
                      {['inflation', 'growth', 'policy', 'credit', 'fiscal'].includes(e.topic)
                        ? '%'
                        : ' 指数'}
                    </b>
                  </span>
                  <span>
                    公布结果{' '}
                    <b>
                      {e.actual.toFixed(2)}
                      {['inflation', 'growth', 'policy', 'credit', 'fiscal'].includes(e.topic)
                        ? '%'
                        : ' 指数'}
                    </b>
                  </span>
                  <span>
                    预期差{' '}
                    <b className={e.actual >= e.expected ? 'accent' : 'positive'}>
                      {signed(e.actual - e.expected)}{' '}
                      {['inflation', 'growth', 'policy', 'credit', 'fiscal'].includes(e.topic)
                        ? 'pp'
                        : '点'}
                    </b>
                  </span>
                </div>
                <ol className="event-transmission">
                  {e.effects.map((effect) => (
                    <li key={effect}>{effect}</li>
                  ))}
                </ol>
                <small>事件改变经济状态与政策预期，价格仍受到其他因素影响。</small>
              </div>
            )}
          </article>
        ))
      ) : (
        <div className="empty-events">
          <span className="empty-orbit">
            <Radio size={23} />
          </span>
          <div>
            <h3>世界的下一条消息，正在酝酿。</h3>
            <p>每 3 个游戏小时发布一份经济观察，期间可能出现突发事件。</p>
            <span>开始模拟，或推进时间以等待发布。</span>
          </div>
        </div>
      )}
    </div>
  );
}
