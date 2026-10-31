import { describe, expect, it } from 'vitest';
import { Session } from './session';
import { advanceMarket, createWorld, mid } from '@fx/simulation';

function timed(seed = 98) {
  let ms = 0;
  return {
    session: new Session(undefined, undefined, { seed, now: () => ms }),
    elapse: (delta: number) => {
      ms += delta;
    },
  };
}

describe('real elapsed time and explicit acceleration', () => {
  it('defaults to paused 1x; retains fractional seconds without counting paused time', async () => {
    const { session: s, elapse } = timed();
    expect(s.speed).toBe(1);
    expect(s.running).toBe(false);
    elapse(60_000);
    await s.syncClock();
    expect(s.world.minute).toBe(0);
    await s.control({ running: true });
    elapse(1_500);
    await s.syncClock();
    expect(s.world.minute * 60).toBe(1);
    elapse(500);
    await s.syncClock();
    expect(s.world.minute * 60).toBe(2);
    await s.control({ running: false });
    elapse(3_600_000);
    await s.syncClock();
    expect(s.world.minute * 60).toBe(2);
    await s.control({ running: true });
    elapse(1_000);
    await s.syncClock();
    expect(s.world.minute * 60).toBe(3);
  });
  it('settles elapsed time at the old speed before changing speed or pausing', async () => {
    const { session: s, elapse } = timed();
    await s.control({ running: true });
    elapse(2_000);
    await s.control({ speed: 60 });
    expect(s.world.minute * 60).toBe(2);
    elapse(1_000);
    await s.control({ running: false });
    expect(s.world.minute * 60).toBeCloseTo(62, 10);
    elapse(120_000);
    await s.control({ speed: 300 });
    expect(s.world.minute * 60).toBeCloseTo(62, 10);
  });
  it('a delayed timer produces the same world as frequent timer wakeups', async () => {
    const slow = timed(),
      frequent = timed();
    await slow.session.control({ running: true });
    await frequent.session.control({ running: true });
    slow.elapse(5_750);
    await slow.session.tick();
    for (let i = 0; i < 23; i++) {
      frequent.elapse(250);
      await frequent.session.tick();
    }
    expect(slow.session.world.minute * 60).toBe(5);
    expect(slow.session.world.economies).toEqual(frequent.session.world.economies);
    expect(slow.session.world.candles).toEqual(frequent.session.world.candles);
  });
  it('different speeds produce identical market paths for the same simulated duration', async () => {
    const real = timed(),
      fast = timed();
    await real.session.control({ running: true });
    await fast.session.control({ running: true, speed: 300 });
    real.elapse(3_600_000);
    await real.session.syncClock();
    fast.elapse(12_000);
    await fast.session.syncClock();
    expect(real.session.world.minute).toBe(60);
    expect(fast.session.world.minute).toBe(60);
    expect(real.session.world.macro).toEqual(fast.session.world.macro);
    expect(real.session.world.economies).toEqual(fast.session.world.economies);
    expect(real.session.world.candles).toEqual(fast.session.world.candles);
    expect(real.session.world.events).toEqual(fast.session.world.events);
  });
  it('manual advance remains an explicit one-hour jump and pauses the clock', async () => {
    const { session: s, elapse } = timed();
    await s.control({ running: true, speed: 300 });
    await s.control({ step: 60 });
    expect(s.world.minute).toBe(60);
    expect(s.running).toBe(false);
    elapse(10_000);
    await s.syncClock();
    expect(s.world.minute).toBe(60);
  });
});

it('a five-minute candle forms over 300 market seconds instead of one refresh', () => {
  const world = createWorld(),
    count = world.candles['EUR/USD'].length;
  advanceMarket(world, undefined, 1);
  expect(world.minute * 60).toBe(1);
  expect(world.candles['EUR/USD']).toHaveLength(count + 1);
  expect(world.candles['EUR/USD'].at(-1)!.minute).toBe(5);
  advanceMarket(world, undefined, 299);
  expect(world.minute).toBe(5);
  expect(world.candles['EUR/USD']).toHaveLength(count + 1);
  expect(world.candles['EUR/USD'].at(-1)!.close).toBe(mid(world, 'EUR/USD'));
  advanceMarket(world, undefined, 1);
  expect(world.candles['EUR/USD']).toHaveLength(count + 2);
  expect(world.candles['EUR/USD'].at(-1)!.minute).toBe(10);
});
