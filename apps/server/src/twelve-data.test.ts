import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@fx/contracts';
import {
  BaselineError,
  TwelveDataBaselineProvider,
  referencePolicy,
  referenceSymbols,
} from './twelve-data';
import { referenceFixture } from './twelve-data.fixtures';
import { createApp } from './app';

const HOUR = 3_600_000;
const start = Date.parse('2026-10-30T12:01:00Z');
const fakeKey = 'test-only-key-do-not-use';
const json = (value: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers });
const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function setup() {
  let now = start;
  const fetcher = vi.fn(async () =>
    json(referenceFixture(new Date(now - 60_000).toISOString().slice(0, 19).replace('T', ' '))),
  );
  const provider = new TwelveDataBaselineProvider(fakeKey, fetcher, () => now);
  return {
    provider,
    fetcher,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('Twelve Data reference adapter', () => {
  it('normalizes both quote directions and records actual bar times without fabricating tick times', async () => {
    const fetcher = vi.fn(async () => json(referenceFixture()));
    const provider = new TwelveDataBaselineProvider(fakeKey, fetcher, () => start);
    const result = await provider.load();
    expect(result.rates.USD).toBe(1);
    expect(result.rates.EUR).toBe(1.16);
    expect(result.rates.JPY).toBeCloseTo(1 / 150, 12);
    expect(result.rates.CHF).toBe(1.25);
    expect(result.rates.EUR! / result.rates.JPY!).toBeCloseTo(174, 10);
    expect(result.kind).toBe('reference');
    if (result.kind !== 'reference') throw new Error('reference expected');
    expect(result.asOf).toBe('2026-10-30T12:00:00.000Z');
    expect(result.reference).toMatchObject({
      provider: 'twelve-data',
      interval: '1min',
      ageAtStartSeconds: 60,
      delivery: 'downloaded',
      staleAtStart: false,
    });
    expect(result.reference.quotes).toHaveLength(8);
    const [url, init] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    const request = new URL(url);
    expect(request.origin).toBe('https://api.twelvedata.com');
    expect(request.pathname).toBe('/time_series');
    expect(Object.fromEntries(request.searchParams)).toMatchObject({
      symbol: referenceSymbols.map((s) => s.symbol).join(','),
      timezone: 'UTC',
      outputsize: '1',
      interval: '1min',
      apikey: fakeKey,
    });
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('shares one in-flight request, clones snapshots, and refreshes only after an hour', async () => {
    const { provider, fetcher, advance } = setup();
    const results = await Promise.all(Array.from({ length: 12 }, () => provider.load()));
    expect(fetcher).toHaveBeenCalledTimes(1);
    results[0].rates.EUR = 99;
    if (results[0].kind === 'reference') results[0].reference.quotes[0].close = 99;
    advance(HOUR - 1);
    const cached = await provider.load();
    expect(cached).toMatchObject({ rates: { EUR: 1.16 }, reference: { delivery: 'cache' } });
    expect(cached.kind === 'reference' && cached.reference.quotes[0].close).toBe(1.16);
    expect(fetcher).toHaveBeenCalledTimes(1);
    advance(1);
    const refreshed = await provider.load();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(refreshed.asOf).not.toBe(results[1].asOf);
    expect(results[1].asOf).toBe('2026-10-30T12:00:00.000Z');
  });

  it.each([
    [
      'missing pair',
      (data: ReturnType<typeof referenceFixture>) => {
        delete data['USD/MXN'];
      },
    ],
    [
      'wrong symbol',
      (data: ReturnType<typeof referenceFixture>) => {
        data['USD/JPY'].meta.symbol = 'JPY/USD';
      },
    ],
    [
      'zero',
      (data: ReturnType<typeof referenceFixture>) => {
        data['EUR/USD'].values[0].close = '0';
      },
    ],
    [
      'non-finite',
      (data: ReturnType<typeof referenceFixture>) => {
        data['EUR/USD'].values[0].close = 'Infinity';
      },
    ],
    [
      'invalid date',
      (data: ReturnType<typeof referenceFixture>) => {
        data['EUR/USD'].values[0].datetime = '2026-02-30 12:00:00';
      },
    ],
    [
      'ambiguous timezone',
      (data: ReturnType<typeof referenceFixture>) => {
        data['EUR/USD'].values[0].datetime = '2026-10-30T12:00:00-05:00';
      },
    ],
    [
      'future quote',
      (data: ReturnType<typeof referenceFixture>) => {
        data['EUR/USD'].values[0].datetime = '2026-10-30 12:10:00';
      },
    ],
    [
      'timestamp skew',
      (data: ReturnType<typeof referenceFixture>) => {
        data['EUR/USD'].values[0].datetime = '2026-10-30 11:45:00';
      },
    ],
  ])('rejects an incomplete or corrupt batch: %s', async (_name, mutate) => {
    const data = referenceFixture();
    mutate(data);
    const provider = new TwelveDataBaselineProvider(
      fakeKey,
      async () => json(data),
      () => start,
    );
    await expect(provider.load()).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
  });

  it('labels weekend-aged data honestly and rejects data older than 96 hours', async () => {
    const friday = '2026-10-30 12:00:00';
    const weekend = new TwelveDataBaselineProvider(
      fakeKey,
      async () => json(referenceFixture(friday)),
      () => start + 36 * HOUR,
    );
    expect(await weekend.load()).toMatchObject({
      asOf: '2026-10-30T12:00:00.000Z',
      reference: { staleAtStart: true, ageAtStartSeconds: 36 * 3600 + 60 },
    });
    const expired = new TwelveDataBaselineProvider(
      fakeKey,
      async () => json(referenceFixture(friday)),
      () => start + 96 * HOUR,
    );
    await expect(expired.load()).rejects.toMatchObject({ code: 'REFERENCE_EXPIRED' });
  });

  it('uses only an intact, unexpired cache on failed refresh and discloses that failure', async () => {
    const { provider, fetcher, advance } = setup();
    const old = await provider.load();
    advance(HOUR);
    fetcher.mockImplementation(async () => json({ status: 'error', code: 429, message: fakeKey }));
    const fallback = await provider.load();
    expect(fallback).toMatchObject({
      rates: old.rates,
      asOf: old.asOf,
      reference: { delivery: 'fallback', staleAtStart: true },
    });
    expect(JSON.stringify(fallback)).not.toContain(fakeKey);
    await provider.load();
    expect(fetcher).toHaveBeenCalledTimes(2);
    advance(96 * HOUR);
    await expect(provider.load()).rejects.toMatchObject({ code: 'REFERENCE_EXPIRED' });
  });

  it('honors Retry-After, debounces failure retries, and sanitizes upstream messages', async () => {
    const { provider, fetcher, advance } = setup();
    fetcher.mockImplementation(async () =>
      json({ message: fakeKey }, 429, { 'retry-after': '3600' }),
    );
    await expect(provider.load()).rejects.toMatchObject({
      code: 'PROVIDER_LIMIT',
      retryAt: start + HOUR,
    });
    advance(30 * 60_000);
    await expect(provider.load()).rejects.not.toHaveProperty('message', fakeKey);
    expect(fetcher).toHaveBeenCalledTimes(1);
    advance(30 * 60_000);
    fetcher.mockImplementation(async () => {
      throw new Error(`failed request?apikey=${fakeKey}`);
    });
    await expect(provider.load()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])('does not expose credentials on upstream HTTP %i', async (status) => {
    const provider = new TwelveDataBaselineProvider(
      fakeKey,
      async () => json({ message: fakeKey }, status),
      () => start,
    );
    try {
      await provider.load();
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BaselineError);
      expect(error).toMatchObject({ code: 'PROVIDER_ACCESS' });
      expect(String(error)).not.toContain(fakeKey);
    }
  });

  it('enforces a local daily attempt budget including failures, resetting on the next UTC date', async () => {
    const { provider, fetcher, advance } = setup();
    fetcher.mockImplementation(async () => json({}, 503));
    for (let i = 0; i < referencePolicy.maxAttemptsPerDay; i++) {
      await expect(provider.load()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      advance(5 * 60_000);
    }
    await expect(provider.load()).rejects.toMatchObject({ code: 'LOCAL_BUDGET' });
    expect(fetcher).toHaveBeenCalledTimes(24);
    advance(24 * HOUR);
    await expect(provider.load()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(25);
  });
});

describe('reference session boundary', () => {
  it('status reads and demo choices spend no credits; polling/trading never reload an opening snapshot', async () => {
    const { provider, fetcher, advance } = setup();
    const app = createApp({ timer: false, baseline: provider });
    apps.push(app);
    expect((await app.inject('/api/baseline')).json()).toMatchObject({
      referenceAvailable: true,
      defaultMode: 'historical',
    });
    await app.inject('/api/health');
    expect(fetcher).not.toHaveBeenCalled();
    const demo = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { baseline: 'demo' },
    });
    expect(demo.json<Snapshot>().source.kind).toBe('historical');
    expect(fetcher).not.toHaveBeenCalled();
    const first = (
      await app.inject({ method: 'POST', url: '/api/sessions', payload: { baseline: 'reference' } })
    ).json<Snapshot>();
    expect(first.source.kind).toBe('reference');
    expect(first.quotes.find((q) => q.pair === 'EUR/JPY')?.mid).toBeCloseTo(174, 10);
    advance(2 * HOUR);
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${first.sessionId}/orders`,
      payload: {
        requestId: crypto.randomUUID(),
        pair: 'EUR/USD',
        side: 'buy',
        units: 1000,
        leverage: 5,
      },
    });
    const polled = (await app.inject(`/api/sessions/${first.sessionId}`)).json<Snapshot>();
    expect(polled.source).toEqual(first.source);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const second = (
      await app.inject({ method: 'POST', url: '/api/sessions', payload: { baseline: 'reference' } })
    ).json<Snapshot>();
    expect(second.source.asOf).not.toBe(first.source.asOf);
    expect((await app.inject(`/api/sessions/${first.sessionId}`)).json<Snapshot>().source).toEqual(
      first.source,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not silently create a demo after reference failure, and keeps existing sessions usable', async () => {
    const { provider, fetcher, advance } = setup();
    const app = createApp({ timer: false, baseline: provider });
    apps.push(app);
    const first = (
      await app.inject({ method: 'POST', url: '/api/sessions', payload: { baseline: 'reference' } })
    ).json<Snapshot>();
    advance(97 * HOUR);
    fetcher.mockImplementation(async () => json({ status: 'error', code: 401, message: fakeKey }));
    const failure = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { baseline: 'reference' },
    });
    expect(failure.statusCode).toBe(503);
    expect(failure.json().sessionId).toBeUndefined();
    expect(failure.body).not.toContain(fakeKey);
    expect((await app.inject(`/api/sessions/${first.sessionId}`)).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/api/sessions', payload: { baseline: 'demo' } }))
        .statusCode,
    ).toBe(201);
  });

  it('reports missing configuration and rejects invalid modes without making requests', async () => {
    const app = createApp({ timer: false });
    apps.push(app);
    expect((await app.inject('/api/baseline')).json()).toMatchObject({
      referenceAvailable: false,
      defaultMode: 'historical',
    });
    const reference = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { baseline: 'reference' },
    });
    expect(reference.statusCode).toBe(503);
    expect(reference.json().code).toBe('REFERENCE_NOT_CONFIGURED');
    expect(
      (await app.inject({ method: 'POST', url: '/api/sessions', payload: { baseline: 'live' } }))
        .statusCode,
    ).toBe(400);
  });
});
