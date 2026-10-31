import type { AgentStatus } from '@fx/contracts';
import { clock, day } from '../lib/format';
const labels = {
  queued: '排队中',
  generating: '生成中',
  ready: '等待推进校验',
  applied: 'Agent 已发布',
  fallback: '已本地降级',
  rejected: '已拒绝',
  cancelled: '已取消',
};
export function AgentPanel({
  agent,
  busy,
  act,
}: {
  agent: AgentStatus;
  busy: boolean;
  act: (path: string, body: unknown, message?: string) => Promise<unknown>;
}) {
  const configured = agent.availability === 'configured';
  return (
    <section className="agent-panel" aria-label="Agent 模式">
      <div className="agent-mode-buttons" role="group" aria-label="选择事件导演">
        <button
          aria-pressed={agent.mode === 'local'}
          disabled={busy || agent.mode === 'local'}
          onClick={() => void act('agent', { mode: 'local' })}
        >
          本地导演
        </button>
        <button
          aria-pressed={agent.mode === 'external'}
          disabled={busy || !configured || agent.mode === 'external'}
          onClick={() => void act('agent', { mode: 'external' })}
        >
          外部 Agent
        </button>
      </div>
      <p className="agent-configuration">{agent.configurationMessage}</p>
      <div className="agent-counters">
        <span>
          Agent 发布 <b>{agent.externalAccepted}</b>
        </span>
        <span>
          本地降级 <b>{agent.fallbacks}</b>
        </span>
        <span>
          未采纳 <b>{agent.rejected}</b>
        </span>
      </div>
      <details className="agent-explanation">
        <summary>Agent 如何工作？</summary>
        <p>
          到达事件时间 → 读取经济状态和事件记忆 → 后台生成 → 发生时重新校验 →
          经济传导。生成期间可交易；暂停时结果只等待，不改变价格。
        </p>
        <p>
          网络失败、限流、超时或过期结果会尝试本地降级，并标明来源；模型明确拒绝的建议会保留拒绝原因。切回本地模式会取消尚未发布的
          Agent 任务。
        </p>
        <p>
          模型不接收你的持仓或未来随机数，不能设置价格或账户余额。人工排程属于沙盒设定；经济合理性仍受模型与参数限制。
        </p>
        {!configured && (
          <p>
            {agent.availability === 'offline'
              ? '下载的单文件版不调用外部模型。配置外部 Agent 请运行项目后端。'
              : '代码已准备好。稍后在后端配置密钥、API 基地址与模型名称，重启后即可启用。密钥不会填写在这个页面。'}
          </p>
        )}
      </details>
      {agent.jobs.length > 0 && (
        <details className="agent-log" open>
          <summary>最近的 Agent 任务 · {agent.jobs.length}</summary>
          <div>
            {[...agent.jobs]
              .reverse()
              .slice(0, 8)
              .map((j) => (
                <article key={j.id}>
                  <div>
                    <strong>
                      {j.economy} · {j.kind === 'report' ? '经济观察' : '突发情景'}
                    </strong>
                    <span className={`agent-job-state ${j.status}`}>{labels[j.status]}</span>
                  </div>
                  <small>
                    D{day(j.createdMinute)} {clock(j.createdMinute)} · {j.id}
                    {j.eventId ? ` → ${j.eventId}` : ''}
                  </small>
                  <p>{j.reason}</p>
                </article>
              ))}
          </div>
        </details>
      )}
    </section>
  );
}
