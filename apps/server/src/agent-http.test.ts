import { expect, it } from 'vitest';
import type { AgentObservation, ScenarioContext } from '@fx/contracts';
import { createWorld, openingBriefs } from '@fx/simulation';
import { LocalScenarioProvider, buildAgentMessages } from '@fx/agents';
import { HttpAgentProvider, type AgentFetch } from './agent-http';
import { readAgentSetup, type AgentConfig } from './agent-config';
const setup = (extra: Record<string, string | undefined> = {}) =>
  readAgentSetup({ AGENT_API_KEY: 'test-server-secret', AGENT_MODEL: 'fixture-model', ...extra });
const config = (extra: Partial<AgentConfig> = {}): AgentConfig => ({
  ...setup().config!,
  ...extra,
});
const w = createWorld(45);
const observation: AgentObservation = {
  minute: 0,
  economies: w.economies,
  recentEvents: w.events,
  openingBriefs: openingBriefs(w.economies),
  global: w.macro,
  tradeLinks: w.tradeLinks,
};
const context: ScenarioContext = { economy: 'EUR', kind: 'report', surprise: 0.1 };
const local = new LocalScenarioProvider();
const valid = async (o = observation, c = context) => ({
  decision: 'publish',
  event: await local.propose(o, c),
  reason: '国内成本变化通过进口价格传导至通胀预期。',
});
const response = (data: unknown, finish = 'stop') =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: finish, message: { content: JSON.stringify(data) } }],
    }),
    { status: 200 },
  );
const signal = () => new AbortController().signal;

it('loads server-only compatible settings and fails closed on missing or malformed configuration', () => {
  expect(readAgentSetup({}).config).toBeUndefined();
  expect(readAgentSetup({ AGENT_API_KEY: 'test' }).config).toBeUndefined();
  expect(setup().config!.endpoint).toBe('https://api.openai.com/v1/chat/completions');
  expect(setup().defaultMode).toBe('local');
  expect(setup({ AGENT_MODE: 'external' }).defaultMode).toBe('external');
  expect(
    setup({
      AGENT_BASE_URL: 'https://models.example/api/v1/',
      AGENT_RESPONSE_FORMAT: 'json_object',
      AGENT_TOKEN_PARAMETER: 'max_tokens',
    }).config,
  ).toMatchObject({
    endpoint: 'https://models.example/api/v1/chat/completions',
    format: 'json_object',
    tokenParameter: 'max_tokens',
  });
  for (const bad of [
    { AGENT_BASE_URL: 'http://models.example/v1' },
    { AGENT_BASE_URL: 'https://user:pass@models.example/v1' },
    { AGENT_BASE_URL: 'https://models.example/v1?key=leak' },
    { AGENT_TIMEOUT_MS: '-1' },
    { AGENT_MAX_RETRIES: '8' },
    { AGENT_REQUESTS_PER_MINUTE: 'Infinity' },
    { AGENT_MODE: 'unknown' },
  ])
    expect(setup(bad).config).toBeUndefined();
});
it('sends bounded state, event memory and suggestions but never portfolio, RNG, or unrelated object properties', async () => {
  const c = {
    ...context,
    suggestion: {
      requestId: crypto.randomUUID(),
      economy: 'EUR' as const,
      topic: 'growth' as const,
      direction: 'up' as const,
      strength: 'small' as const,
      delayMinutes: 60 as const,
      note: '虚构投资计划改善国内需求，但必须遵守模型边界',
    },
  };
  const prompt = JSON.stringify(
    buildAgentMessages(
      Object.assign({}, observation, {
        account: 'private-portfolio',
        random: 'private-rng',
        apiKey: 'private-key',
      }),
      c,
    ),
  );
  expect(prompt).toContain('虚构投资计划');
  expect(prompt).toContain('openingBackground');
  expect(prompt).not.toContain('private-portfolio');
  expect(prompt).not.toContain('private-rng');
  expect(prompt).not.toContain('private-key');
  let calls = 0;
  const fetcher: AgentFetch = async (url, init) => {
    calls++;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.redirect).toBe('error');
    expect(init.headers.Authorization).toBe('Bearer test-server-secret');
    expect(init.body).not.toContain('test-server-secret');
    const body = JSON.parse(init.body);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.max_completion_tokens).toBe(1600);
    expect(body.stream).toBe(false);
    return response(await valid());
  };
  const result = await new HttpAgentProvider(config(), fetcher).generate(
    observation,
    context,
    signal(),
  );
  expect(result.decision).toBe('publish');
  expect(calls).toBe(1);
});
it('repairs malformed/invalid output once with fresh instructions, then enforces economic limits', async () => {
  let calls = 0;
  const fetcher: AgentFetch = async (_url, init) => {
    calls++;
    if (calls === 1)
      return response({ ...(await valid()), event: { ...(await valid()).event, actual: 999 } });
    expect(init.body).toContain('上次响应未通过校验');
    return response(await valid());
  };
  expect(
    (await new HttpAgentProvider(config(), fetcher).generate(observation, context, signal()))
      .decision,
  ).toBe('publish');
  expect(calls).toBe(2);
  let badCalls = 0;
  const bad = new HttpAgentProvider(config(), async () => {
    badCalls++;
    return new Response('{not json');
  });
  await expect(bad.generate(observation, context, signal())).rejects.toMatchObject({
    code: 'invalid_response',
  });
  expect(badCalls).toBe(2);
});
it('retries transient service failures, but respects Retry-After and never retries authentication failures', async () => {
  let calls = 0;
  const transient = new HttpAgentProvider(config(), async () =>
    ++calls === 1 ? new Response('upstream details', { status: 503 }) : response(await valid()),
  );
  expect((await transient.generate(observation, context, signal())).decision).toBe('publish');
  expect(calls).toBe(2);
  let authCalls = 0;
  const auth = new HttpAgentProvider(config(), async () => {
    authCalls++;
    return new Response('test-server-secret in upstream error', { status: 401 });
  });
  await expect(auth.generate(observation, context, signal())).rejects.toMatchObject({
    code: 'auth',
    message: '模型服务认证或权限失败',
  });
  expect(authCalls).toBe(1);
  let limitedCalls = 0;
  const limited = new HttpAgentProvider(config(), async () => {
    limitedCalls++;
    return new Response('', { status: 429, headers: { 'Retry-After': '60' } });
  });
  await expect(limited.generate(observation, context, signal())).rejects.toMatchObject({
    code: 'rate_limit',
  });
  await expect(limited.generate(observation, context, signal())).rejects.toMatchObject({
    code: 'rate_limit',
  });
  expect(limitedCalls).toBe(1);
});
it('caps actual requests and concurrency across sessions, and reopens the budget with wall time', async () => {
  let now = 0,
    calls = 0;
  const provider = new HttpAgentProvider(
    config({ requestsPerMinute: 1 }),
    async () => {
      calls++;
      return response(await valid());
    },
    () => now,
  );
  await provider.generate(observation, context, signal());
  await expect(provider.generate(observation, context, signal())).rejects.toMatchObject({
    code: 'budget',
  });
  now = 60001;
  await provider.generate(observation, context, signal());
  expect(calls).toBe(2);
  const controller = new AbortController();
  const busy = new HttpAgentProvider(
    config({ maxConcurrent: 1, timeoutMs: 100 }),
    () => new Promise(() => {}),
  );
  const first = busy.generate(observation, context, controller.signal);
  await expect(busy.generate(observation, context, signal())).rejects.toMatchObject({
    code: 'busy',
  });
  controller.abort();
  await expect(first).rejects.toMatchObject({ code: 'cancelled' });
});
it('bounds response size and the entire response-body lifetime, not just HTTP headers', async () => {
  const oversized = new HttpAgentProvider(
    config({ maxRetries: 0 }),
    async () => new Response('x'.repeat(70000)),
  );
  await expect(oversized.generate(observation, context, signal())).rejects.toMatchObject({
    code: 'invalid_response',
  });
  let aborted = false,
    cancelled = false;
  const stuck = new HttpAgentProvider(
    config({ timeoutMs: 10, maxRetries: 0 }),
    async (_url, init) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
      });
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      );
    },
  );
  await expect(stuck.generate(observation, context, signal())).rejects.toMatchObject({
    code: 'timeout',
  });
  expect(aborted).toBe(true);
  expect(cancelled).toBe(true);
});
it('supports JSON-object compatibility, rejects truncation, and preserves explicit refusals', async () => {
  const reject = {
    decision: 'reject',
    event: null,
    reason: '该人工建议与经济方向矛盾，暂不采用。',
  };
  const provider = new HttpAgentProvider(
    config({ format: 'json_object', tokenParameter: 'max_tokens' }),
    async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.max_tokens).toBe(1600);
      return response(reject);
    },
  );
  expect(await provider.generate(observation, context, signal())).toEqual(reject);
  const cut = new HttpAgentProvider(config({ maxRetries: 0 }), async () =>
    response(await valid(), 'length'),
  );
  await expect(cut.generate(observation, context, signal())).rejects.toMatchObject({
    code: 'invalid_response',
  });
  const refusal = new HttpAgentProvider(
    config(),
    async () =>
      new Response(
        JSON.stringify({ choices: [{ finish_reason: 'stop', message: { refusal: 'refused' } }] }),
      ),
  );
  expect((await refusal.generate(observation, context, signal())).decision).toBe('reject');
});

it('cools down after consecutive failures and blocks credential echoes even in successful JSON', async () => {
  let now = 0,
    calls = 0;
  const provider = new HttpAgentProvider(
    config({ maxRetries: 0 }),
    async () => {
      calls++;
      return new Response('', { status: 503 });
    },
    () => now,
  );
  for (let i = 0; i < 3; i++)
    await expect(provider.generate(observation, context, signal())).rejects.toMatchObject({
      code: 'unavailable',
    });
  await expect(provider.generate(observation, context, signal())).rejects.toMatchObject({
    code: 'circuit_open',
  });
  expect(calls).toBe(3);
  now += 60001;
  await expect(provider.generate(observation, context, signal())).rejects.toMatchObject({
    code: 'unavailable',
  });
  expect(calls).toBe(4);
  const leak = new HttpAgentProvider(config({ maxRetries: 0 }), async () =>
    response({ ...(await valid()), reason: '错误网关回显 test-server-secret 认证信息' }),
  );
  await expect(leak.generate(observation, context, signal())).rejects.toMatchObject({
    code: 'invalid_response',
    message: '模型输出未通过结构或经济校验',
  });
});
