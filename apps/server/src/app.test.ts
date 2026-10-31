import { afterEach, it, expect } from 'vitest';
import { createApp } from './app';
import type { Snapshot } from '@fx/contracts';
import { Session } from './session';
const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup() {
  const app = createApp({ timer: false });
  apps.push(app);
  const res = await app.inject({ method: 'POST', url: '/api/sessions' });
  expect(res.statusCode).toBe(201);
  return { app, id: res.json<Snapshot>().sessionId };
}
it('creates independent sessions and exposes no RNG or seed', async () => {
  const { app, id } = await setup();
  const other = (await app.inject({ method: 'POST', url: '/api/sessions' })).json<Snapshot>();
  expect(other.sessionId).not.toBe(id);
  const view = (await app.inject(`/api/sessions/${id}`)).json();
  expect(view.account.balance).toBe(10000);
  expect(view.quotes).toHaveLength(870);
  expect(view.random).toBeUndefined();
  expect(view.source.kind).toBe('historical');
});
it('handles concurrent duplicate orders once, closes and records costs', async () => {
  const { app, id } = await setup();
  const req = {
    method: 'POST' as const,
    url: `/api/sessions/${id}/orders`,
    payload: {
      requestId: crypto.randomUUID(),
      pair: 'EUR/USD',
      side: 'buy',
      units: 1000,
      leverage: 10,
    },
  };
  const result = await Promise.all([app.inject(req), app.inject(req)]);
  expect(result.map((r) => r.statusCode)).toEqual([200, 200]);
  const state = result[1].json<Snapshot>();
  expect(state.account.positions).toHaveLength(1);
  const closed = await app.inject({
    method: 'POST',
    url: `/api/sessions/${id}/positions/${state.account.positions[0].id}/close`,
    payload: {},
  });
  expect(closed.json<Snapshot>().account.positions).toHaveLength(0);
  expect(closed.json<Snapshot>().account.balance).toBeLessThan(10000);
});
it('publishes a validated report at the scheduled time and advances quotes', async () => {
  const { app, id } = await setup();
  let state: Snapshot;
  for (let i = 0; i < 3; i++) {
    const r = await app.inject({
      method: 'POST',
      url: `/api/sessions/${id}/control`,
      payload: { step: 60 },
    });
    expect(r.statusCode).toBe(200);
    state = r.json();
  }
  expect(state!.minute).toBe(180);
  expect(state!.events.some((e) => e.kind === 'report' && e.minute === 180)).toBe(true);
  expect(state!.agent.nextReport).toBe(360);
  expect(state!.running).toBe(false);
});
it('rejects invalid controls, orders, and unknown sessions', async () => {
  const { app, id } = await setup();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/sessions/${id}/control`,
        payload: { speed: 999 },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/sessions/${id}/orders`,
        payload: { pair: 'FAKE/USD' },
      })
    ).statusCode,
  ).toBe(400);
  expect((await app.inject(`/api/sessions/${crypto.randomUUID()}`)).statusCode).toBe(404);
});
it('discards invalid agent output without corrupting the market', async () => {
  const s = new Session({ propose: async () => ({ economy: 'EUR', price: 100000 }) });
  const before = s.world.economies.map((e) => e.usdValue);
  await s.direct('report');
  expect(s.agent.rejected).toBe(1);
  expect(s.world.events).toHaveLength(0);
  expect(s.world.economies.map((e) => e.usdValue)).toEqual(before);
});
