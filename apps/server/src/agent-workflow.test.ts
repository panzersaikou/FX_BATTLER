import { expect, it, afterEach } from 'vitest';
import { LocalScenarioProvider } from '@fx/agents';
import type {
  AgentDecision,
  AgentObservation,
  AgentProvider,
  EventSuggestionInput,
  ScenarioContext,
  Snapshot,
} from '@fx/contracts';
import { Session } from './session';
import { createApp } from './app';
const local = new LocalScenarioProvider();
const idea = (): EventSuggestionInput => ({
  requestId: crypto.randomUUID(),
  economy: 'EUR',
  topic: 'supply',
  direction: 'up',
  strength: 'small',
  delayMinutes: 60,
  note: '模拟港口延迟交付造成供应压力上升',
});
const decisions = async (o: AgentObservation, c: ScenarioContext): Promise<AgentDecision> => ({
  decision: 'publish',
  event: await local.propose(o, c),
  reason: '港口供给约束逐步进入进口成本与通胀预期。',
});
const settle = async (s: Session) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await s.exclusive(() => {});
};
const sessions: Session[] = [];
function make(provider: AgentProvider, deadlineMs = 1000) {
  const s = new Session(undefined, undefined, {
    externalProvider: provider,
    agentMode: 'external',
    seed: 44,
    now: () => 0,
    agentDeadlineMs: deadlineMs,
  });
  sessions.push(s);
  return s;
}
afterEach(() => sessions.splice(0).forEach((s) => s.dispose()));
function deferredProvider() {
  let resolve!: (d: AgentDecision) => void;
  let o!: AgentObservation, c!: ScenarioContext, signal!: AbortSignal;
  const provider: AgentProvider = {
    generate: async (observation, context, abort) => {
      o = observation;
      c = context;
      signal = abort;
      return new Promise<AgentDecision>((r) => {
        resolve = r;
      });
    },
  };
  return {
    provider,
    finish: async () => resolve(await decisions(o, c)),
    get signal() {
      return signal;
    },
    get observation() {
      return o;
    },
  };
}
it('network generation does not hold the transaction queue; ready events wait for a market step', async () => {
  const d = deferredProvider(),
    s = make(d.provider),
    p = idea();
  s.suggest(p);
  await s.exclusive(() => s.direct('surprise', s.suggestions[0]));
  expect(s.agent.phase).toBe('generating');
  await s.exclusive(() =>
    s.order({
      requestId: crypto.randomUUID(),
      pair: 'EUR/USD',
      side: 'buy',
      units: 1000,
      leverage: 1,
    }),
  );
  expect(s.account.positions).toHaveLength(1);
  await s.exclusive(() => s.advanceSeconds(1));
  expect(s.world.minute).toBe(1 / 60);
  expect(d.observation).not.toHaveProperty('account');
  expect(d.observation).not.toHaveProperty('random');
  await d.finish();
  await settle(s);
  expect(s.agent.phase).toBe('ready');
  expect(s.world.events).toHaveLength(0);
  expect(JSON.stringify(s.snapshot('EUR/USD').agent)).not.toContain('港口供给约束');
  await s.syncClock();
  expect(s.world.events).toHaveLength(0); // paused polling cannot publish
  await s.exclusive(() => s.advanceSeconds(1));
  const event = s.world.events.find((e) => e.suggestionId === p.requestId)!;
  expect(event.generator).toBe('external');
  expect(event.agentJobId).toBe(s.agent.jobs[0].id);
  expect(s.agent.jobs[0].status).toBe('applied');
  expect(s.agent.externalAccepted).toBe(1);
  await s.advanceSeconds(1);
  expect(s.agent.externalAccepted).toBe(1);
});
it('a material state change invalidates a result and falls back against current expectations', async () => {
  const d = deferredProvider(),
    s = make(d.provider);
  s.suggest(idea());
  await s.direct('surprise', s.suggestions[0]);
  s.world.economies.find((e) => e.currency === 'EUR')!.macro.supplyPressure = 30;
  await d.finish();
  await settle(s);
  await s.advanceSeconds(1);
  expect(s.world.events[0].expected).toBe(30);
  expect(s.world.events[0].generator).toBe('fallback');
  expect(s.agent.jobs[0].reason).toContain('过期');
  expect(s.agent.fallbacks).toBe(1);
});
it('honors explicit model refusal without silently applying the rejected suggestion locally', async () => {
  const s = make({
    generate: async () => ({
      decision: 'reject',
      event: null,
      reason: '人工背景与结构化指标方向矛盾，无法采纳。',
    }),
  });
  s.suggest(idea());
  await s.direct('surprise', s.suggestions[0]);
  await settle(s);
  s.world.minute = 181; // Refusals must not become local fallback after a long delay.
  await s.advanceSeconds(1);
  expect(s.suggestions[0].status).toBe('rejected');
  expect(s.agent.jobs[0].status).toBe('rejected');
  expect(s.world.events).toHaveLength(0);
  expect(s.agent.fallbacks).toBe(0);
});
it('cancellation, mode switch and disposal abort work and ignore late results', async () => {
  for (const action of ['cancel', 'mode', 'dispose'] as const) {
    const d = deferredProvider(),
      s = make(d.provider),
      p = idea();
    s.suggest(p);
    await s.direct('surprise', s.suggestions[0]);
    if (action === 'cancel') s.cancelSuggestion(p.requestId);
    if (action === 'mode') s.setAgentMode('local');
    if (action === 'dispose') s.dispose();
    expect(d.signal.aborted).toBe(true);
    await d.finish();
    await settle(s);
    await s.advanceSeconds(1);
    expect(s.world.events).toHaveLength(0);
    if (action === 'mode') expect(s.suggestions[0].status).toBe('queued');
  }
});
it('times out an uncooperative provider, and rejects expired results even if the numbers still match', async () => {
  const stuck = make({ generate: () => new Promise(() => {}) }, 15);
  stuck.suggest(idea());
  await stuck.direct('surprise', stuck.suggestions[0]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await settle(stuck);
  await stuck.advanceSeconds(1);
  expect(stuck.agent.jobs[0].status).toBe('fallback');
  expect(stuck.agent.jobs[0].reason).toContain('超时');
  const stale = make({ generate: decisions });
  stale.suggest(idea());
  await stale.direct('surprise', stale.suggestions[0]);
  await settle(stale);
  stale.world.minute = 181;
  await stale.advanceSeconds(1);
  expect(stale.agent.jobs[0].status).toBe('fallback');
});
it('bounds queue growth and rejects bad proposal data without direct price writes', async () => {
  const d = deferredProvider(),
    s = make(d.provider);
  for (let i = 0; i < 5; i++) await s.direct('report');
  expect(s.agent.jobs.filter((j) => ['queued', 'generating'].includes(j.status))).toHaveLength(4);
  await s.advanceSeconds(1);
  expect(s.agent.jobs[4].status).toBe('fallback');
  const invalid = make({
    generate: async () =>
      ({
        decision: 'publish',
        event: { price: 999 },
        reason: '任意写入价格的无效结果',
      }) as unknown as AgentDecision,
  });
  await invalid.direct('report');
  await settle(invalid);
  await invalid.advanceSeconds(1);
  expect(invalid.agent.externalAccepted).toBe(0);
  expect(invalid.agent.fallbacks).toBe(1);
  expect(invalid.world.economies.every((e) => e.usdValue > 0 && e.usdValue < 2)).toBe(true);
});
it('API mode selection is strict and session deletion aborts a live job', async () => {
  const d = deferredProvider(),
    app = createApp({
      timer: false,
      agent: { provider: d.provider, defaultMode: 'local', message: '测试后端已配置' },
    });
  try {
    const created = (await app.inject({ method: 'POST', url: '/api/sessions' })).json<Snapshot>();
    const root = `/api/sessions/${created.sessionId}`;
    const mode = await app.inject({
      method: 'POST',
      url: `${root}/agent`,
      payload: { mode: 'external' },
    });
    expect(mode.json<Snapshot>().agent.mode).toBe('external');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${root}/agent`,
          payload: { mode: 'external', apiKey: 'not-allowed' },
        })
      ).statusCode,
    ).toBe(400);
    await app.inject({ method: 'POST', url: `${root}/suggestions`, payload: idea() });
    await app.inject({ method: 'POST', url: `${root}/control`, payload: { step: 60 } });
    const state = (await app.inject(root)).json<Snapshot>();
    expect(state.suggestions[0].status).toBe('generating');
    expect((await app.inject({ method: 'DELETE', url: root })).statusCode).toBe(204);
    expect(d.signal.aborted).toBe(true);
    await d.finish();
    expect((await app.inject(root)).statusCode).toBe(404);
  } finally {
    await app.close();
  }
  const unavailable = createApp({ timer: false });
  try {
    const created = (
      await unavailable.inject({ method: 'POST', url: '/api/sessions' })
    ).json<Snapshot>();
    expect(
      (
        await unavailable.inject({
          method: 'POST',
          url: `/api/sessions/${created.sessionId}/agent`,
          payload: { mode: 'external' },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await unavailable.close();
  }
});
