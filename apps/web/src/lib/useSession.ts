import { useCallback, useEffect, useRef, useState } from 'react';
import type { BaselineMode, BaselineStatus, Pair, Snapshot } from '@fx/contracts';

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  url: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) throw new RequestError(data.error ?? '连接失败', response.status);
  return data as T;
}
export function useSession(pair: Pair, onPairChange?: (pair: Pair) => void) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [baselineStatus, setBaselineStatus] = useState<BaselineStatus | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const sessionId = useRef<string | null>(null),
    activePair = useRef(pair),
    mounted = useRef(true),
    mutation = useRef(false);
  activePair.current = pair;
  const apply = useCallback((data: Snapshot) => {
    if (
      !mounted.current ||
      data.sessionId !== sessionId.current ||
      data.chartPair !== activePair.current
    )
      return;
    setSnapshot((old) =>
      old?.sessionId === data.sessionId && old.revision > data.revision ? old : data,
    );
  }, []);
  const initialize = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const status = await request<BaselineStatus>('/api/baseline');
      if (mounted.current) setBaselineStatus(status);
      const saved = sessionStorage.getItem('fx-session');
      let data: Snapshot;
      if (saved) {
        try {
          data = await request<Snapshot>(
            `/api/sessions/${saved}?pair=${encodeURIComponent(activePair.current)}`,
          );
        } catch (error) {
          if (!(error instanceof RequestError) || error.status !== 404) throw error;
          sessionStorage.removeItem('fx-session');
          data = await request<Snapshot>('/api/sessions', {});
        }
      } else data = await request<Snapshot>('/api/sessions', {});
      if (!mounted.current) return;
      sessionId.current = data.sessionId;
      sessionStorage.setItem('fx-session', data.sessionId);
      if (data.chartPair !== activePair.current)
        data = await request<Snapshot>(
          `/api/sessions/${data.sessionId}?pair=${encodeURIComponent(activePair.current)}`,
        );
      apply(data);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : '连接失败，请重试');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [apply]);
  useEffect(() => {
    mounted.current = true;
    void initialize();
    return () => {
      mounted.current = false;
    };
  }, [initialize]);
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      if (sessionId.current && !mutation.current)
        try {
          const data = await request<Snapshot>(
            `/api/sessions/${sessionId.current}?pair=${encodeURIComponent(pair)}`,
          );
          if (!stopped) apply(data);
        } catch (e) {
          if (!stopped) setError(e instanceof Error ? e.message : '行情连接失败');
        }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pair, apply]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const act = async (path: string, body: unknown, message?: string) => {
    if (!sessionId.current || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      const data = await request<Snapshot>(
        `/api/sessions/${sessionId.current}/${path}?pair=${encodeURIComponent(activePair.current)}`,
        body,
      );
      apply(data);
      if (message) setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const reset = async (baseline?: BaselineMode) => {
    if (mutation.current) return false;
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      const newSession = await request<Snapshot>('/api/sessions', { baseline }),
        oldId = sessionId.current;
      sessionId.current = newSession.sessionId;
      sessionStorage.setItem('fx-session', newSession.sessionId);
      if (!newSession.quotes.some((q) => q.pair === activePair.current)) {
        activePair.current = 'EUR/USD';
        onPairChange?.('EUR/USD');
      }
      const data =
        activePair.current === 'EUR/USD'
          ? newSession
          : await request<Snapshot>(
              `/api/sessions/${newSession.sessionId}?pair=${encodeURIComponent(activePair.current)}`,
            );
      apply(data);
      setNotice('新一局已创建，初始虚拟资金 $10,000');
      if (oldId) await request(`/api/sessions/${oldId}`, undefined, 'DELETE').catch(() => {});
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '新建失败');
      return false;
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  return {
    snapshot,
    baselineStatus,
    error,
    busy,
    notice,
    act,
    reset,
    retry: initialize,
    clearError: () => setError(''),
  };
}
