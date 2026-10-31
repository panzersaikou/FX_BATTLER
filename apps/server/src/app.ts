import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import {
  controlSchema,
  orderSchema,
  pairSchema,
  sessionCreateSchema,
  suggestionSchema,
  agentControlSchema,
  type AgentProvider,
  type Pair,
  type BaselineProvider,
  type BaselineStatus,
} from '@fx/contracts';
import { SimulationError, fxHistory } from '@fx/simulation';
import { Session } from './session.ts';
import { DemoBaselineProvider } from './baseline.ts';
import { BaselineError } from './twelve-data.ts';

export function createApp(
  options: {
    timer?: boolean;
    logger?: boolean;
    baseline?: BaselineProvider;
    agent?: {
      provider?: AgentProvider;
      defaultMode: 'local' | 'external';
      message: string;
      deadlineMs?: number;
    };
  } = {},
) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 16_384 });
  const sessions = new Map<string, Session>();
  const demo = new DemoBaselineProvider();
  const baselineStatus: BaselineStatus = {
    referenceAvailable: !!options.baseline,
    defaultMode: 'historical',
    message: options.baseline
      ? '默认使用 30 币种历史基准；也可选择已配置的 9 币种 Twelve Data 接口模式。'
      : '30 币种历史基准无需 API，可查看统计年份、来源和本局扰动。',
  };
  let creating = 0;
  const get = (params: unknown) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(params);
    const s = sessions.get(id);
    if (!s) {
      const e = new Error('会话已过期，请开启新一局');
      Object.assign(e, { statusCode: 404 });
      throw e;
    }
    s.touched = Date.now();
    return s;
  };
  const pair = (query: unknown) =>
    z.object({ pair: pairSchema.default('EUR/USD') }).parse(query).pair as Pair;
  const sessionPair = (s: Session, query: unknown) => {
    const p = pair(query);
    if (!s.world.pairs.includes(p)) throw new SimulationError('本局不支持该货币对');
    return p;
  };
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof BaselineError) {
      if (error.retryAt)
        reply.header('Retry-After', Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000)));
      return reply.code(error.statusCode).send({ error: error.message, code: error.code });
    }
    if (error instanceof ZodError)
      return reply.code(400).send({ error: error.issues[0]?.message ?? '请求格式错误' });
    if (error instanceof SimulationError) return reply.code(400).send({ error: error.message });
    const status =
      error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (status >= 500) app.log.error(error);
    return reply.code(status).send({
      error:
        status >= 500
          ? '操作失败，请稍后重试'
          : error instanceof Error
            ? error.message
            : '请求失败',
    });
  });
  app.get('/api/health', async () => ({
    ok: true,
    mode: 'simulation',
    baseline: baselineStatus.defaultMode,
    agent: options.agent?.provider ? 'configured' : 'unconfigured',
  }));
  app.get('/api/baseline', async () => baselineStatus);
  app.get('/api/history', async () => fxHistory);
  app.post('/api/sessions/:id/agent', async (req) => {
    const s = get(req.params),
      body = agentControlSchema.parse(req.body),
      selectedPair = sessionPair(s, req.query);
    return s.exclusive(async () => {
      await s.syncClock();
      s.setAgentMode(body.mode);
      return s.snapshot(selectedPair);
    });
  });
  app.post('/api/sessions/:id/suggestions', async (req) => {
    const s = get(req.params),
      body = suggestionSchema.parse(req.body),
      selectedPair = sessionPair(s, req.query);
    return s.exclusive(async () => {
      await s.syncClock();
      s.suggest(body);
      return s.snapshot(selectedPair);
    });
  });
  app.post('/api/sessions/:id/suggestions/:suggestionId/cancel', async (req) => {
    const s = get(req.params),
      { suggestionId } = z.object({ suggestionId: z.string().uuid() }).parse(req.params),
      selectedPair = sessionPair(s, req.query);
    return s.exclusive(async () => {
      await s.syncClock();
      s.cancelSuggestion(suggestionId);
      return s.snapshot(selectedPair);
    });
  });
  app.post('/api/sessions', async (req, reply) => {
    const mode = sessionCreateSchema.parse(req.body ?? {}).baseline ?? baselineStatus.defaultMode;
    const provider = mode !== 'reference' ? demo : options.baseline;
    if (!provider)
      throw new BaselineError(
        'REFERENCE_NOT_CONFIGURED',
        '真实参考汇率尚未配置，请选择离线历史基准。',
      );
    for (const [id, s] of sessions)
      if (Date.now() - s.touched > 30 * 60_000) {
        s.dispose();
        sessions.delete(id);
      }
    if (sessions.size + creating >= 100)
      return reply.code(503).send({ error: '当前会话数量已满，请稍后再试' });
    creating++;
    try {
      const baseline = await provider.load();
      const s = new Session(undefined, baseline, {
        externalProvider: options.agent?.provider,
        agentMode: options.agent?.defaultMode,
        agentMessage: options.agent?.message,
        agentDeadlineMs: options.agent?.deadlineMs,
      });
      sessions.set(s.id, s);
      return reply.code(201).send(s.snapshot('EUR/USD'));
    } finally {
      creating--;
    }
  });
  app.get('/api/sessions/:id', async (req) => {
    const s = get(req.params),
      selectedPair = sessionPair(s, req.query);
    return s.exclusive(async () => {
      await s.syncClock();
      return s.snapshot(selectedPair);
    });
  });
  app.delete('/api/sessions/:id', async (req, reply) => {
    const s = get(req.params);
    await s.exclusive(() => {
      s.dispose();
      sessions.delete(s.id);
    });
    return reply.code(204).send();
  });
  app.post('/api/sessions/:id/control', async (req) => {
    const s = get(req.params);
    const body = controlSchema.parse(req.body),
      selectedPair = sessionPair(s, req.query);
    return s.exclusive(async () => {
      await s.control(body);
      return s.snapshot(selectedPair);
    });
  });
  app.post('/api/sessions/:id/orders', async (req) => {
    const s = get(req.params),
      order = orderSchema.parse(req.body);
    const selectedPair = sessionPair(s, req.query);
    if (!s.world.pairs.includes(order.pair)) throw new SimulationError('本局不支持该货币对');
    return s.exclusive(async () => {
      await s.syncClock();
      s.order(order);
      return s.snapshot(selectedPair);
    });
  });
  app.post('/api/sessions/:id/positions/:positionId/close', async (req) => {
    const s = get(req.params),
      { positionId } = z.object({ positionId: z.string().regex(/^pos-\d+$/) }).parse(req.params);
    const selectedPair = sessionPair(s, req.query);
    return s.exclusive(async () => {
      await s.syncClock();
      s.close(positionId);
      return s.snapshot(selectedPair);
    });
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  if (options.timer !== false)
    timer = setInterval(() => {
      for (const [id, s] of sessions) {
        if (Date.now() - s.touched > 30 * 60_000) {
          s.dispose();
          sessions.delete(id);
          continue;
        }
        void s.tick().catch((e) => app.log.error(e));
      }
    }, 250);
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
    for (const s of sessions.values()) s.dispose();
    sessions.clear();
  });
  const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  if (existsSync(webRoot)) {
    app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: '接口不存在' })
        : reply.sendFile('index.html'),
    );
  }
  return app;
}
