import { afterEach, expect, it } from 'vitest';
import type { EventSuggestionInput, Snapshot } from '@fx/contracts';
import { Session } from './session';
import { createApp } from './app';
import { LocalScenarioProvider } from '@fx/agents';
const idea = (patch: Partial<EventSuggestionInput> = {}): EventSuggestionInput => ({
  requestId: crypto.randomUUID(),
  economy: 'EUR',
  topic: 'supply',
  direction: 'up',
  strength: 'small',
  delayMinutes: 60,
  note: '模拟港口拥堵造成部分原材料交付延迟',
  ...patch,
});
const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
it('queues without moving prices, executes once at game time, and keeps an auditable event link', async () => {
  const s = new Session(undefined, undefined, { seed: 100, now: () => 0 });
  const p = idea(),
    before = s.world.economies.map((e) => e.usdValue);
  s.suggest(p);
  s.suggest(p);
  expect(s.world.economies.map((e) => e.usdValue)).toEqual(before);
  expect(s.suggestions).toHaveLength(1);
  await s.syncClock();
  expect(s.suggestions[0].status).toBe('queued');
  await s.advanceSeconds(3599);
  expect(s.suggestions[0].status).toBe('queued');
  await s.advanceSeconds(1);
  expect(s.suggestions[0].status).toBe('applied');
  const event = s.world.events.find((e) => e.suggestionId === p.requestId)!;
  expect(event.origin).toBe('user-directed');
  expect(event.topic).toBe('supply');
  expect(event.actual).toBeGreaterThan(event.expected);
  expect(event.minute).toBe(60);
  expect(event.id).toBe(s.suggestions[0].eventId);
  await s.advanceSeconds(60);
  s.suggest(p);
  expect(s.world.events.filter((e) => e.suggestionId === p.requestId)).toHaveLength(1);
  expect(() => s.suggest({ ...p, note: '重复 ID 改成另一个建议' })).toThrow('重复建议');
});
it('cancelled suggestions never affect the market and queues are bounded', async () => {
  const s = new Session(undefined, undefined, { seed: 88, now: () => 0 });
  const p = idea();
  s.suggest(p);
  s.cancelSuggestion(p.requestId);
  s.cancelSuggestion(p.requestId);
  await s.advanceSeconds(3600);
  expect(s.world.events.some((e) => e.suggestionId === p.requestId)).toBe(false);
  for (let i = 0; i < 5; i++) s.suggest(idea());
  expect(() => s.suggest(idea())).toThrow('最多');
  expect(() => s.suggest({ ...idea(), price: 99 } as EventSuggestionInput)).toThrow();
});
it('an external provider sees state and context, never portfolio, and invalid output cannot move prices', async () => {
  let seen = false;
  const s = new Session(
    {
      propose: async (observation, context) => {
        seen = true;
        expect(observation).not.toHaveProperty('account');
        expect(observation).not.toHaveProperty('random');
        expect(observation.openingBriefs).toHaveLength(5);
        expect(context.suggestion?.note).toContain('港口');
        return { economy: 'EUR', price: 999, topic: 'supply' };
      },
    },
    undefined,
    { seed: 22 },
  );
  s.suggest(idea());
  const before = structuredClone(s.world.economies);
  await s.direct('surprise', s.suggestions[0]);
  expect(seen).toBe(true);
  expect(s.suggestions[0].status).toBe('rejected');
  expect(s.world.economies).toEqual(before);
  expect(s.world.events).toHaveLength(0);
});
it('re-evaluates expectations at execution and rejects a provider reversing the user direction', async () => {
  const local = new LocalScenarioProvider();
  const s = new Session(local, undefined, { seed: 22 });
  s.suggest(idea());
  const eur = s.world.economies.find((e) => e.currency === 'EUR')!;
  eur.macro.supplyPressure = 30;
  await s.direct('surprise', s.suggestions[0]);
  expect(s.world.events[0].expected).toBe(30);
  const bad = new Session({
    propose: async (o, c) => {
      const p = await local.propose(o, c);
      return { ...p, actual: p.expected - 0.1 };
    },
  });
  bad.suggest(idea());
  const before = bad.world.economies.map((e) => e.usdValue);
  await bad.direct('surprise', bad.suggestions[0]);
  expect(bad.suggestions[0].status).toBe('rejected');
  expect(bad.world.economies.map((e) => e.usdValue)).toEqual(before);
});
it('serves the archive independently and validates suggestion APIs before mutation', async () => {
  const app = createApp({ timer: false });
  apps.push(app);
  const history = await app.inject('/api/history');
  expect(history.statusCode).toBe(200);
  expect(Object.keys(history.json().series)).toHaveLength(19);
  const s = (await app.inject({ method: 'POST', url: '/api/sessions' })).json<Snapshot>();
  const path = `/api/sessions/${s.sessionId}/suggestions`,
    p = idea();
  const [a, b] = await Promise.all([
    app.inject({ method: 'POST', url: path, payload: p }),
    app.inject({ method: 'POST', url: path, payload: p }),
  ]);
  expect(a.statusCode).toBe(200);
  expect(b.json<Snapshot>().suggestions).toHaveLength(1);
  expect(
    (await app.inject({ method: 'POST', url: path, payload: { ...idea(), topic: 'policy' } }))
      .statusCode,
  ).toBe(400);
  expect(
    (await app.inject({ method: 'POST', url: path, payload: { ...idea(), note: 'x'.repeat(241) } }))
      .statusCode,
  ).toBe(400);
  const cancelled = await app.inject({
    method: 'POST',
    url: `${path}/${p.requestId}/cancel`,
    payload: {},
  });
  expect(cancelled.json<Snapshot>().suggestions[0].status).toBe('cancelled');
});
