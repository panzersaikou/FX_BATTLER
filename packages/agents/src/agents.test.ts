import { it, expect } from 'vitest';
import { createWorld, applyEvent, economy } from '@fx/simulation';
import type { AgentObservation } from '@fx/contracts';
import { LocalScenarioProvider, validateProposal } from './index';
const observation = (w = createWorld()): AgentObservation => ({
  minute: w.minute,
  economies: w.economies,
  recentEvents: w.events,
  global: w.macro,
  tradeLinks: w.tradeLinks,
});
it('produces a bounded observation and alternates report topics using event memory', async () => {
  const world = createWorld(),
    provider = new LocalScenarioProvider();
  const first = validateProposal(
    await provider.propose(observation(world), { economy: 'EUR', kind: 'report', surprise: 0.2 }),
    observation(world),
    'EUR',
    'report',
  );
  expect(first.topic).toBe('inflation');
  expect(first.actual - first.expected).toBeCloseTo(0.06);
  applyEvent(world, first);
  const second = validateProposal(
    await provider.propose(observation(world), { economy: 'EUR', kind: 'report', surprise: -0.2 }),
    observation(world),
    'EUR',
    'report',
  );
  expect(second.topic).toBe('growth');
  applyEvent(world, second);
  for (const topic of ['industry', 'credit'] as const) {
    const o = observation(world);
    const proposal = validateProposal(
      await provider.propose(o, { economy: 'EUR', kind: 'report', surprise: 0.2 }),
      o,
      'EUR',
      'report',
    );
    expect(proposal.topic).toBe(topic);
    expect(() =>
      validateProposal({ ...proposal, actual: proposal.actual + 3 }, o, 'EUR', 'report'),
    ).toThrow();
    applyEvent(world, proposal);
  }
});
it('chooses supply disruption for a stressed supply chain and energy for exposed economies', async () => {
  const world = createWorld(),
    provider = new LocalScenarioProvider();
  economy(world, 'EUR').macro.supplyPressure = 20;
  const supply = await provider.propose(observation(world), {
    economy: 'EUR',
    kind: 'surprise',
    surprise: 0.3,
  });
  expect(validateProposal(supply, observation(world), 'EUR', 'surprise').topic).toBe('supply');
  const energy = await provider.propose(observation(world), {
    economy: 'CAD',
    kind: 'surprise',
    surprise: 0.3,
  });
  expect(validateProposal(energy, observation(world), 'CAD', 'surprise').topic).toBe('energy');
});
it('rejects price commands, arbitrary state mutations, stale baselines and fabricated central-bank decisions', async () => {
  const o = observation(),
    p = await new LocalScenarioProvider().propose(o, {
      economy: 'EUR',
      kind: 'report',
      surprise: 0.2,
    });
  for (const invalid of [
    { ...p, price: 99 },
    { ...p, impact: { stress: 2 } },
    { ...p, economy: 'USD' },
    { ...p, actual: 10 },
    { ...p, expected: 9 },
    { ...p, topic: 'policy', kind: 'policy', expected: 2.75, actual: 3 },
  ]) {
    expect(() => validateProposal(invalid, o, 'EUR', 'report')).toThrow();
  }
});
it('all local branches stay valid for stressed and low-boundary state values', async () => {
  const world = createWorld(),
    provider = new LocalScenarioProvider();
  for (const e of world.economies)
    for (const kind of ['report', 'surprise'] as const)
      for (const surprise of [-10, 0, 10]) {
        const o = observation(world),
          p = await provider.propose(o, { economy: e.currency, kind, surprise });
        expect(() => validateProposal(p, o, e.currency, kind)).not.toThrow();
      }
});
