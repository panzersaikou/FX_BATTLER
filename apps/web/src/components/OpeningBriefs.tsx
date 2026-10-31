import type { OpeningBrief } from '@fx/contracts';
export function OpeningBriefs({
  briefs,
  compact = false,
}: {
  briefs: OpeningBrief[];
  compact?: boolean;
}) {
  return (
    <section className="opening-briefs" aria-label="开局背景">
      <div className="context-heading">
        <h3>开场前的世界</h3>
        <span className="subtle-badge">模拟背景</span>
      </div>
      <p className="muted">
        由本局起点重建的近几日背景，已反映在开局状态中。不是现实新闻，不会再次施加价格冲击。
      </p>
      {(compact ? briefs.slice(0, 2) : briefs).map((b) => (
        <details key={b.id} className="opening-story">
          <summary>
            <span>
              {b.economy} · 开场前 {b.hoursBeforeStart} 小时
            </span>
            <strong>{b.title}</strong>
          </summary>
          <p>{b.description}</p>
          <p className="watch-prompt">{b.watch}</p>
        </details>
      ))}
    </section>
  );
}
