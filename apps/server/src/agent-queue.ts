import type {
  AgentDecision,
  AgentJob,
  AgentObservation,
  AgentProvider,
  ScenarioContext,
} from '@fx/contracts';
import { AgentFailure } from '@fx/agents';

export interface ReadyJob {
  public: AgentJob;
  context: ScenarioContext;
  observationMinute: number;
  result?: AgentDecision;
  failure?: AgentFailure;
  controller?: AbortController;
}
/** Network work runs outside Session.exclusive; only short status commits enter that queue. */
export class AgentQueue {
  private entries: ReadyJob[] = [];
  private active: string | null = null;
  private sequence = 0;
  private count = 0;
  constructor(
    private readonly provider: AgentProvider,
    private readonly observe: () => AgentObservation,
    private readonly commit: (fn: () => void) => Promise<void>,
    private readonly changed: () => void,
    private readonly deadlineMs = 25000,
  ) {}
  get jobs() {
    return this.entries.map((j) => ({ ...j.public }));
  }
  get ready() {
    return this.entries.filter((j) => j.public.status === 'ready');
  }
  enqueue(context: ScenarioContext): boolean {
    const pending = this.entries.filter((j) =>
      ['queued', 'generating', 'ready'].includes(j.public.status),
    ).length;
    const minute = this.observe().minute;
    const job: ReadyJob = {
      public: {
        id: `agent-${++this.sequence}`,
        economy: context.economy,
        kind: context.kind,
        createdMinute: minute,
        status: 'queued',
        suggestionId: context.suggestion?.requestId,
        reason: '等待后台生成；不会暂停行情。',
      },
      context: structuredClone(context),
      observationMinute: minute,
    };
    if (this.count >= 100 || pending >= 4) {
      job.failure = new AgentFailure(this.count >= 100 ? 'budget' : 'queue_full');
      job.public.status = 'ready';
      job.public.reason = `${job.failure.message}，等待本地降级。`;
      this.entries.push(job);
      this.changed();
      return false;
    }
    this.count++;
    this.entries.push(job);
    this.prune();
    this.changed();
    this.startNext();
    return true;
  }
  finish(job: ReadyJob, status: AgentJob['status'], reason: string, eventId?: string) {
    job.public.status = status;
    job.public.reason = reason;
    job.public.eventId = eventId;
    job.result = undefined;
    job.failure = undefined;
    this.prune();
    this.changed();
  }
  cancel(suggestionId?: string) {
    for (const j of this.entries) {
      if (suggestionId && j.public.suggestionId !== suggestionId) continue;
      if (!['queued', 'generating', 'ready'].includes(j.public.status)) continue;
      j.public.status = 'cancelled';
      j.public.reason = '任务已取消，后到结果不会进入市场。';
      j.controller?.abort();
      j.result = undefined;
      j.failure = undefined;
    }
    this.changed();
  }
  private prune() {
    while (this.entries.length > 24) {
      const index = this.entries.findIndex(
        (j) => !['queued', 'generating', 'ready'].includes(j.public.status),
      );
      if (index < 0) break;
      this.entries.splice(index, 1);
    }
  }
  private startNext() {
    if (this.active) return;
    const job = this.entries.find((j) => j.public.status === 'queued');
    if (!job) return;
    const observation = this.observe();
    job.observationMinute = observation.minute;
    job.public.status = 'generating';
    job.public.reason = '正在后台生成；交易和时间推进继续运行。';
    const controller = new AbortController();
    job.controller = controller;
    this.active = job.public.id;
    this.changed();
    let abortListener: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      abortListener = () =>
        reject(
          controller.signal.reason instanceof AgentFailure
            ? controller.signal.reason
            : new AgentFailure('cancelled'),
        );
      controller.signal.addEventListener('abort', abortListener, { once: true });
    });
    const timer = setTimeout(() => controller.abort(new AgentFailure('timeout')), this.deadlineMs);
    void (async () => {
      let result: AgentDecision | undefined, failure: AgentFailure | undefined;
      try {
        result = await Promise.race([
          aborted,
          Promise.resolve().then(() =>
            this.provider.generate(observation, job.context, controller.signal),
          ),
        ]);
      } catch (error) {
        failure = error instanceof AgentFailure ? error : new AgentFailure('network');
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', abortListener);
      }
      await this.commit(() => {
        if (job.public.status !== 'cancelled') {
          job.result = result;
          job.failure = failure;
          job.public.status = 'ready';
          job.public.reason = failure
            ? `${failure.message}，下次推进时尝试本地降级。`
            : '已收到结果，等待游戏推进时重新校验；未发布前不展示内容。';
        }
        job.controller = undefined;
        this.active = null;
        this.changed();
        this.startNext();
      });
    })().catch(() => {
      /* Session teardown may discard a pending status commit. */
    });
  }
}
