import { randomInt, randomUUID } from 'node:crypto';
import {
  type Snapshot,
  type Pair,
  type OrderRequest,
  type AgentStatus,
  type ScenarioProvider,
  type AgentObservation,
  type MarketBaseline,
  type SimulationSpeed,
  type ClockControl,
  type EventSuggestion,
  type EventSuggestionInput,
  type OpeningBrief,
  type AgentProvider,
  type ScenarioContext,
  type EventProposal,
  suggestionSchema,
} from '@fx/contracts';
import {
  createWorld,
  createAccount,
  advanceMarket,
  quote,
  accountView,
  applyEvent,
  openPosition,
  closePosition,
  enforceMargin,
  historicalBaseline,
  baselineDataset,
  openingBriefs,
  SimulationError,
  type World,
} from '@fx/simulation';
import { LocalScenarioProvider, validateDecision, AgentFailure } from '@fx/agents';
import { AgentQueue } from './agent-queue';

export class Session {
  readonly id = randomUUID();
  readonly world: World;
  readonly account = createAccount();
  readonly openingBriefs: OpeningBrief[];
  readonly suggestions: EventSuggestion[] = [];
  running = false;
  speed: SimulationSpeed = 1;
  revision = 0;
  touched = Date.now();
  agent: AgentStatus = {
    mode: 'local',
    availability: 'unconfigured',
    configurationMessage: '尚未配置 Agent 密钥；当前使用本地导演。',
    externalAccepted: 0,
    fallbacks: 0,
    jobs: [],
    phase: 'observing',
    lastRun: null,
    nextReport: 180,
    accepted: 0,
    rejected: 0,
    summary: '正在观察经济状态，下一份经济报告将于 3 小时后发布。',
  };
  private queue = Promise.resolve();
  private director?: AgentQueue;
  private disposed = false;
  private readonly now: () => number;
  private lastWallMs: number;
  private pendingSeconds = 0;
  private tickPending = false;
  private requests = new Map<string, string>();
  constructor(
    private provider: ScenarioProvider = new LocalScenarioProvider(),
    private baseline: MarketBaseline = historicalBaseline(),
    options: {
      now?: () => number;
      seed?: number;
      externalProvider?: AgentProvider;
      agentMode?: 'local' | 'external';
      agentMessage?: string;
      offline?: boolean;
      agentDeadlineMs?: number;
    } = {},
  ) {
    this.baseline = structuredClone(baseline);
    this.world = createWorld(options.seed ?? randomInt(1, 2 ** 30), baseline.rates, {
      roster: baseline.roster,
      jitter: baseline.kind === 'historical',
    });
    this.now = options.now ?? (() => performance.now());
    this.openingBriefs = openingBriefs(this.world.economies);
    this.lastWallMs = this.now();
    this.agent.availability = options.offline
      ? 'offline'
      : options.externalProvider
        ? 'configured'
        : 'unconfigured';
    this.agent.configurationMessage =
      options.agentMessage ??
      (options.offline
        ? '离线 HTML 使用本地导演；外部 Agent 需要运行后端。'
        : options.externalProvider
          ? '后端 Agent 已配置，远端调用将在事件排程时验证。'
          : this.agent.configurationMessage);
    if (options.externalProvider) {
      this.director = new AgentQueue(
        options.externalProvider,
        () => this.observation(),
        (fn) => this.exclusive(fn),
        () => this.directorChanged(),
        options.agentDeadlineMs,
      );
      this.agent.mode = options.agentMode ?? 'local';
    }
  }
  exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  /** Use elapsed monotonic time, never the number of timer callbacks. Call inside exclusive(). */
  async syncClock() {
    if (this.disposed) return;
    const now = this.now();
    const elapsedMs = Math.max(0, now - this.lastWallMs);
    this.lastWallMs = now;
    if (!this.running) return;
    this.pendingSeconds += (elapsedMs / 1000) * this.speed;
    const seconds = Math.floor(this.pendingSeconds + 1e-9);
    this.pendingSeconds = Math.max(0, this.pendingSeconds - seconds);
    if (seconds) await this.advanceSeconds(seconds);
  }
  tick(): Promise<void> {
    if (this.tickPending || !this.running) return Promise.resolve();
    this.tickPending = true;
    return this.exclusive(() => this.syncClock()).finally(() => {
      this.tickPending = false;
    });
  }
  async control(input: ClockControl) {
    // Settle the previous speed first, so a speed change never affects elapsed time retroactively.
    await this.syncClock();
    if (input.running !== undefined) this.running = input.running;
    if (input.speed !== undefined) this.speed = input.speed;
    if (input.step) {
      this.running = false;
      await this.advanceSeconds(input.step * 60);
    }
    this.revision++;
  }
  async advanceSeconds(seconds: number) {
    if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('无效的模拟秒数');
    // Same hazard per MARKET second at every speed (formerly 0.8% per five market minutes).
    const surpriseChance = 1 - Math.pow(1 - 0.008, 1 / 300);
    for (let i = 0; i < seconds; i++) {
      if (this.disposed) break;
      advanceMarket(this.world, () => enforceMargin(this.world, this.account), 1);
      if (this.director?.ready.length) await this.flushDirector();
      const due = this.suggestions.find(
        (s) => s.status === 'queued' && this.world.minute + 1e-9 >= s.dueAt,
      );
      if (due)
        await this.direct(
          ['inflation', 'growth', 'industry', 'credit'].includes(due.topic) ? 'report' : 'surprise',
          due,
        );
      if (this.world.minute >= this.agent.nextReport) {
        await this.direct('report');
        this.agent.nextReport += 180;
      } else if (this.world.eventRandom.uniform() < surpriseChance) await this.direct('surprise');
      enforceMargin(this.world, this.account);
      // Long catch-up stays responsive without dropping simulation time, events or margin checks.
      if ((i + 1) % 3600 === 0 && i + 1 < seconds)
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (seconds) this.revision++;
  }
  suggest(raw: EventSuggestionInput) {
    const input = suggestionSchema.parse(raw);
    const prior = this.suggestions.find((s) => s.requestId === input.requestId);
    if (prior) {
      for (const key of Object.keys(input) as (keyof EventSuggestionInput)[])
        if (prior[key] !== input[key]) throw new SimulationError('重复建议的内容不一致');
      return;
    }
    if (!this.world.economies.some((e) => e.currency === input.economy))
      throw new SimulationError('本局不支持该经济体');
    if (
      this.suggestions.filter((s) => ['queued', 'generating'].includes(s.status)).length >= 5 ||
      this.suggestions.length >= 50
    )
      throw new SimulationError('最多同时等待 5 条建议，每局最多提交 50 条');
    this.suggestions.push({
      ...input,
      id: input.requestId,
      submittedAt: this.world.minute,
      dueAt: this.world.minute + input.delayMinutes,
      status: 'queued',
      reason: '等待游戏时间到达；届时按最新经济状态校验。',
    });
    this.revision++;
  }
  cancelSuggestion(id: string) {
    const s = this.suggestions.find((s) => s.id === id);
    if (!s) throw new SimulationError('建议不存在');
    if (s.status === 'cancelled') return;
    if (!['queued', 'generating'].includes(s.status))
      throw new SimulationError('已经处理的建议不能撤销');
    s.status = 'cancelled';
    this.director?.cancel(id);
    s.reason = '玩家已取消，未改变市场。';
    this.revision++;
  }
  private observation(): AgentObservation {
    return structuredClone({
      minute: this.world.minute,
      economies: this.world.economies,
      recentEvents: this.world.events.slice(0, 40),
      openingBriefs: this.openingBriefs,
      global: {
        energyIndex: this.world.macro.energyIndex,
        riskAversion: this.world.macro.riskAversion,
      },
      tradeLinks: this.world.tradeLinks,
    });
  }
  private directorChanged() {
    if (!this.director || this.disposed) return;
    this.agent.jobs = this.director.jobs;
    if (this.agent.jobs.some((j) => j.status === 'generating' || j.status === 'queued')) {
      this.agent.phase = 'generating';
      this.agent.summary = '正在后台生成情景，行情和交易继续运行。';
    } else if (this.agent.jobs.some((j) => j.status === 'ready')) {
      this.agent.phase = 'ready';
      this.agent.summary = '情景结果已就绪；下一次推进游戏时间时重新校验并处理。';
    }
    this.revision++;
  }
  setAgentMode(mode: 'local' | 'external') {
    if (mode === 'external' && !this.director)
      throw new SimulationError(this.agent.configurationMessage);
    if (mode === this.agent.mode) return;
    this.director?.cancel();
    for (const s of this.suggestions)
      if (s.status === 'generating') {
        s.status = 'queued';
        s.reason = '模式已切换，下一次推进时由当前导演重新处理。';
      }
    this.agent.mode = mode;
    this.agent.phase = 'observing';
    this.agent.summary =
      mode === 'external'
        ? '外部 Agent 已启用；到达事件排程时才调用模型。'
        : '已切回本地导演；先前未发布的模型结果已取消。';
    this.revision++;
  }
  dispose() {
    this.disposed = true;
    this.running = false;
    this.director?.cancel();
  }
  async direct(kind: 'report' | 'surprise', suggestion?: EventSuggestion) {
    if (this.disposed) return;
    const economies = this.world.economies;
    let n = this.world.eventRandom.uniform() * economies.reduce((s, e) => s + e.importance, 0);
    const target = suggestion
      ? economies.find((e) => e.currency === suggestion.economy)!
      : (economies.find((e) => (n -= e.importance) <= 0) ?? economies[0]);
    const context: ScenarioContext = {
      economy: target.currency,
      kind,
      surprise: this.world.eventRandom.normal() * 0.22,
      suggestion: suggestion
        ? suggestionSchema.parse(
            Object.fromEntries(
              Object.keys(suggestionSchema.shape).map((key) => [
                key,
                suggestion[key as keyof EventSuggestion],
              ]),
            ),
          )
        : undefined,
    };
    this.agent.lastRun = this.world.minute;
    if (this.agent.mode === 'external' && this.director) {
      if (suggestion) {
        suggestion.status = 'generating';
        suggestion.reason = '已进入后台生成队列，仍可取消。';
      }
      this.director.enqueue(context);
      return;
    }
    await this.localEvent(context, suggestion);
  }
  private publish(
    raw: unknown,
    context: ScenarioContext,
    suggestion: EventSuggestion | undefined,
    generator: 'local' | 'external' | 'fallback',
    jobId?: string,
  ) {
    const decision = validateDecision(
      { decision: 'publish', event: raw, reason: '按发生时经济状态重新校验' },
      this.observation(),
      context,
    );
    if (decision.decision !== 'publish') throw new Error('无效事件');
    const event = applyEvent(this.world, decision.event);
    event.origin = suggestion ? 'user-directed' : 'director';
    event.generator = generator;
    event.agentJobId = jobId;
    if (suggestion) {
      event.suggestionId = suggestion.id;
      suggestion.status = 'applied';
      suggestion.eventId = event.id;
      suggestion.reason =
        generator === 'fallback'
          ? '外部生成不可用，已按当前状态使用本地情景降级。'
          : '已通过发生时的经济校验，价格由经济引擎计算。';
    }
    enforceMargin(this.world, this.account);
    this.agent.accepted++;
    if (generator === 'external') this.agent.externalAccepted++;
    if (generator === 'fallback') this.agent.fallbacks++;
    this.agent.phase = generator === 'fallback' ? 'fallback' : 'published';
    this.agent.summary =
      generator === 'fallback'
        ? '本次事件已使用本地情景降级，来源已记录。'
        : '事件通过当前经济状态校验，已发布并传导至市场。';
    this.revision++;
    return event;
  }
  private reject(suggestion: EventSuggestion | undefined, reason: string) {
    if (suggestion) {
      suggestion.status = 'rejected';
      suggestion.reason = reason;
    }
    this.agent.phase = 'rejected';
    this.agent.rejected++;
    this.agent.summary = reason;
    this.revision++;
  }
  private async localEvent(
    context: ScenarioContext,
    suggestion?: EventSuggestion,
    failure?: AgentFailure,
    jobId?: string,
  ) {
    try {
      const raw = await this.provider.propose(this.observation(), context);
      return this.publish(raw, context, suggestion, failure ? 'fallback' : 'local', jobId);
    } catch {
      this.reject(
        suggestion,
        failure
          ? `${failure.message}；本地情景也未通过校验，没有改变市场。`
          : '情景未通过经济校验，没有改变市场。',
      );
    }
  }
  private async flushDirector() {
    if (!this.director || this.agent.mode !== 'external' || this.disposed) return;
    for (const job of this.director.ready) {
      const suggestion = job.public.suggestionId
        ? this.suggestions.find((s) => s.id === job.public.suggestionId)
        : undefined;
      if (suggestion?.status === 'cancelled') {
        this.director.finish(job, 'cancelled', '人工建议已取消。');
        continue;
      }
      let failure = job.failure;
      // An explicit refusal stays refused even if the player leaves the market paused for hours.
      if (!failure && job.result?.decision === 'reject') {
        try {
          const decision = validateDecision(job.result, this.observation(), job.context);
          this.reject(suggestion, `Agent 未采纳：${decision.reason}`);
          this.director.finish(job, 'rejected', `Agent 未采纳：${decision.reason}`);
          continue;
        } catch {
          failure = new AgentFailure('invalid_response');
        }
      }
      if (!failure && this.world.minute - job.observationMinute > 180)
        failure = new AgentFailure('stale');
      if (!failure) {
        try {
          const decision = validateDecision(job.result, this.observation(), job.context);
          if (decision.decision === 'reject') {
            this.reject(suggestion, `Agent 未采纳：${decision.reason}`);
            this.director.finish(job, 'rejected', `Agent 未采纳：${decision.reason}`);
            continue;
          }
          const event = this.publish(
            decision.event as EventProposal,
            job.context,
            suggestion,
            'external',
            job.public.id,
          );
          this.director.finish(job, 'applied', decision.reason, event.id);
          continue;
        } catch {
          failure = new AgentFailure('stale');
        }
      }
      const event = await this.localEvent(job.context, suggestion, failure, job.public.id);
      this.director.finish(
        job,
        event ? 'fallback' : 'rejected',
        `${failure.message}；${event ? '使用当前经济状态生成本地情景。' : '本地情景也被拒绝，市场未受此次任务影响。'}`,
        event?.id,
      );
    }
  }
  order(input: OrderRequest) {
    const body = JSON.stringify(input),
      prior = this.requests.get(input.requestId);
    if (prior) {
      if (prior !== body) throw new Error('重复请求的内容不一致');
      return;
    }
    openPosition(this.world, this.account, input);
    this.requests.set(input.requestId, body);
    this.revision++;
    // Keep all successful keys for this bounded, in-memory session: eviction would permit replay.
  }
  close(id: string) {
    closePosition(this.world, this.account, id);
    this.revision++;
  }
  snapshot(pair: Pair): Snapshot {
    if (!this.world.pairs.includes(pair)) throw new Error('本局不支持该货币对');
    return {
      sessionId: this.id,
      revision: this.revision,
      minute: this.world.minute,
      running: this.running,
      speed: this.speed,
      source: {
        ...(this.baseline.kind === 'reference'
          ? {
              kind: 'reference' as const,
              asOf: this.baseline.asOf,
              reference: structuredClone(this.baseline.reference),
            }
          : this.baseline.kind === 'historical'
            ? {
                kind: 'historical' as const,
                asOf: null,
                dataset: this.baseline.dataset,
                year: this.baseline.year,
              }
            : { kind: 'demo' as const, asOf: null }),
        label:
          this.baseline.kind === 'reference'
            ? '模拟行情 · 参考汇率起点'
            : '模拟行情 · 2023 历史基准 + 开局扰动',
      },
      baselineDataset,
      quotes: this.world.pairs.map((p) => quote(this.world, p)),
      chartPair: pair,
      candles: this.world.candles[pair],
      economies: this.world.economies,
      events: this.world.events,
      openingBriefs: this.openingBriefs,
      suggestions: this.suggestions,
      macro: this.world.macro,
      tradeLinks: this.world.tradeLinks,
      account: accountView(this.world, this.account),
      agent: this.agent,
    };
  }
}
