import { Session } from '../../../server/src/session';
import { fxHistory } from '@fx/simulation';
import {
  controlSchema,
  orderSchema,
  pairSchema,
  sessionCreateSchema,
  suggestionSchema,
  agentControlSchema,
  type Pair,
} from '@fx/contracts';

/** Offline artifact only: use the SAME session/engine, with no network or credentials. */
const sessions = new Map<string, Session>();
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

globalThis.fetch = async (input, init) => {
  const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!path.startsWith('/api/')) throw new Error('离线预览不访问外部网络');
  const url = new URL(path, 'https://offline.invalid');
  const parts = url.pathname.split('/').filter(Boolean);
  const method = init?.method ?? 'GET';
  try {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    if (method === 'GET' && url.pathname === '/api/history') return response(fxHistory);
    if (method === 'GET' && url.pathname === '/api/baseline')
      return response({
        referenceAvailable: false,
        defaultMode: 'historical',
        message: '离线版使用 2023 年历史基准与开局扰动，不访问外部行情。',
      });
    if (method === 'POST' && url.pathname === '/api/sessions') {
      if (sessionCreateSchema.parse(body).baseline === 'reference')
        return response({ error: '离线版仅支持历史基准。' }, 503);
      const session = new Session(undefined, undefined, { offline: true });
      sessions.set(session.id, session);
      return response(session.snapshot('EUR/USD'), 201);
    }
    const session = sessions.get(parts[2]);
    if (!session) return response({ error: '离线会话已结束，请开启新一局' }, 404);
    if (method === 'DELETE' && parts.length === 3) {
      await session.exclusive(() => {
        session.dispose();
        sessions.delete(session.id);
      });
      return new Response(null, { status: 204 });
    }
    const pair = pairSchema.parse(url.searchParams.get('pair') ?? 'EUR/USD') as Pair;
    return await session.exclusive(async () => {
      if (method === 'POST' && parts[3] === 'control') {
        await session.control(controlSchema.parse(body));
      } else if (method === 'POST' && parts[3] === 'agent') {
        await session.syncClock();
        session.setAgentMode(agentControlSchema.parse(body).mode);
      } else if (method === 'POST' && parts[3] === 'suggestions' && parts.length === 4) {
        await session.syncClock();
        session.suggest(suggestionSchema.parse(body));
      } else if (method === 'POST' && parts[3] === 'suggestions' && parts[5] === 'cancel') {
        await session.syncClock();
        session.cancelSuggestion(parts[4]);
      } else if (method === 'POST' && parts[3] === 'orders') {
        await session.syncClock();
        session.order(orderSchema.parse(body));
      } else if (method === 'POST' && parts[3] === 'positions' && parts[5] === 'close') {
        await session.syncClock();
        session.close(parts[4]);
      } else if (method === 'GET' && parts.length === 3) {
        await session.syncClock();
      } else {
        return response({ error: '离线预览不支持此操作' }, 404);
      }
      return response(session.snapshot(pair));
    });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : '操作失败' }, 400);
  }
};

setInterval(() => {
  for (const session of sessions.values()) {
    void session.tick().catch(console.error);
  }
}, 250);
