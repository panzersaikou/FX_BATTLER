import { z } from 'zod';
import type { BaselineProvider, Currency, MarketBaseline, ReferenceQuote } from '@fx/contracts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const referencePolicy = {
  cacheMs: HOUR,
  staleMs: 2 * HOUR,
  maxAgeMs: 96 * HOUR,
  maxSkewMs: 10 * MINUTE,
  maxAttemptsPerDay: 24, // 8 symbols per attempt: reserve at most 192 credits locally.
} as const;
export const referenceSymbols = [
  { currency: 'EUR', symbol: 'EUR/USD', inverse: false },
  { currency: 'JPY', symbol: 'USD/JPY', inverse: true },
  { currency: 'GBP', symbol: 'GBP/USD', inverse: false },
  { currency: 'CHF', symbol: 'USD/CHF', inverse: true },
  { currency: 'CAD', symbol: 'USD/CAD', inverse: true },
  { currency: 'AUD', symbol: 'AUD/USD', inverse: false },
  { currency: 'NZD', symbol: 'NZD/USD', inverse: false },
  { currency: 'MXN', symbol: 'USD/MXN', inverse: true },
] as const;

export class BaselineError extends Error {
  readonly statusCode = 503;
  constructor(
    readonly code: string,
    message: string,
    readonly retryAt?: number,
  ) {
    super(message);
  }
}
export type MarketFetcher = (
  url: string,
  init: { signal: AbortSignal; redirect: 'error' },
) => Promise<Pick<Response, 'ok' | 'status' | 'headers' | 'json'>>;
type CachedReference = {
  asOf: string;
  fetchedAt: number;
  rates: Record<Currency, number>;
  quotes: ReferenceQuote[];
};
const seriesSchema = z.object({
  status: z.literal('ok'),
  meta: z.object({ symbol: z.string(), interval: z.literal('1min') }),
  values: z.array(z.object({ datetime: z.string(), close: z.string() })).min(1),
});
function invalid(message: string): never {
  throw new BaselineError('INVALID_REFERENCE', message);
}
function upstreamError(code: number, retryAt?: number) {
  if (code === 429)
    return new BaselineError(
      'PROVIDER_LIMIT',
      'Twelve Data 额度或频率受限，请稍后重试，或主动选择离线历史基准。',
      retryAt,
    );
  if (code === 401 || code === 403)
    return new BaselineError(
      'PROVIDER_ACCESS',
      'Twelve Data 认证、套餐权限或网络访问受限，暂时无法取得参考汇率。',
    );
  return new BaselineError(
    'PROVIDER_UNAVAILABLE',
    'Twelve Data 暂时不可用，请稍后重试，或主动选择离线历史基准。',
  );
}
function responseCode(data: unknown): number | undefined {
  if (data && typeof data === 'object' && 'status' in data && data.status === 'error') {
    return 'code' in data && typeof data.code === 'number' ? data.code : 500;
  }
}
function parseReference(data: unknown, now: number): CachedReference {
  const batch = z.record(z.unknown()).safeParse(data);
  if (!batch.success) return invalid('行情返回格式错误，未创建新世界。');
  const topCode = responseCode(data);
  if (topCode) throw upstreamError(topCode);
  const quotes: ReferenceQuote[] = referenceSymbols.map(({ currency, symbol, inverse }) => {
    const item = batch.data[symbol];
    const code = responseCode(item);
    if (code) throw upstreamError(code);
    const parsed = seriesSchema.safeParse(item);
    if (!parsed.success || parsed.data.meta.symbol !== symbol)
      return invalid(`${symbol} 缺失或格式不正确，未混用演示汇率。`);
    const { datetime, close: rawClose } = parsed.data.values[0];
    // Explicit timezone=UTC in the request; reject ambiguous or impossible dates.
    const timestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(datetime)
      ? Date.parse(datetime.replace(' ', 'T') + 'Z')
      : NaN;
    if (
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ') !== datetime
    )
      return invalid(`${symbol} 的报价时间无效。`);
    if (timestamp > now + 2 * MINUTE) return invalid(`${symbol} 的报价时间超前，未使用该数据。`);
    if (now - timestamp > referencePolicy.maxAgeMs)
      throw new BaselineError(
        'REFERENCE_EXPIRED',
        `${symbol} 的报价已超过 96 小时，不能用于新的参考汇率世界。`,
      );
    const close = /^\d+(\.\d+)?$/.test(rawClose) ? Number(rawClose) : NaN;
    if (!Number.isFinite(close) || close < 1e-8 || close > 1e8)
      return invalid(`${symbol} 的报价不是有效的正数。`);
    return {
      currency,
      symbol,
      close,
      usdValue: inverse ? 1 / close : close,
      asOf: new Date(timestamp).toISOString(),
    };
  });
  const times = quotes.map((q) => Date.parse(q.asOf));
  if (Math.max(...times) - Math.min(...times) > referencePolicy.maxSkewMs)
    return invalid('各币种报价时间相差超过 10 分钟，未拼接成同一个市场快照。');
  return {
    asOf: new Date(Math.min(...times)).toISOString(),
    fetchedAt: now,
    rates: { USD: 1, ...Object.fromEntries(quotes.map((q) => [q.currency, q.usdValue])) } as Record<
      Currency,
      number
    >,
    quotes,
  };
}

/** One shared instance per server. No network during simulation or status reads. */
export class TwelveDataBaselineProvider implements BaselineProvider {
  private cache?: CachedReference;
  private inFlight?: Promise<CachedReference>;
  private lastError?: BaselineError;
  private retryAt = 0;
  private budgetDay = '';
  private attempts = 0;
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: MarketFetcher,
    private readonly now: () => number = Date.now,
  ) {
    if (!apiKey.trim()) throw new BaselineError('REFERENCE_NOT_CONFIGURED', '参考汇率尚未配置。');
  }
  private async refresh(): Promise<CachedReference> {
    const now = this.now(),
      day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.budgetDay) {
      this.budgetDay = day;
      this.attempts = 0;
    }
    if (now < this.retryAt) throw this.lastError ?? upstreamError(429, this.retryAt);
    if (this.attempts >= referencePolicy.maxAttemptsPerDay)
      throw new BaselineError(
        'LOCAL_BUDGET',
        '本服务今日的参考行情预算已用完；已有游戏可以继续运行。',
        Date.parse(`${day}T00:00:00Z`) + 24 * HOUR,
      );
    this.attempts++;
    this.retryAt = now + MINUTE;
    const url = new URL('https://api.twelvedata.com/time_series');
    url.search = new URLSearchParams({
      symbol: referenceSymbols.map((s) => s.symbol).join(','),
      interval: '1min',
      outputsize: '1',
      timezone: 'UTC',
      order: 'desc',
      format: 'JSON',
      apikey: this.apiKey,
    }).toString();
    try {
      const response = await this.fetcher(url.href, {
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      if (!response.ok) {
        const retry = response.headers.get('retry-after');
        const retryMs =
          retry && /^\d+$/.test(retry)
            ? this.now() + Number(retry) * 1000
            : Date.parse(retry ?? '');
        throw upstreamError(
          response.status,
          Number.isFinite(retryMs) ? Math.max(this.now() + MINUTE, retryMs) : undefined,
        );
      }
      const result = parseReference(await response.json(), this.now());
      this.cache = result;
      this.lastError = undefined;
      return result;
    } catch (error) {
      // Never propagate upstream messages, request URLs, or exception causes containing the key.
      const safe = error instanceof BaselineError ? error : upstreamError(503);
      this.retryAt = Math.max(this.retryAt, safe.retryAt ?? this.now() + 5 * MINUTE);
      this.lastError = new BaselineError(safe.code, safe.message, this.retryAt);
      throw this.lastError;
    }
  }
  async load(): Promise<MarketBaseline> {
    let result = this.cache;
    let delivery: 'downloaded' | 'cache' | 'fallback' = 'cache';
    let refreshError: BaselineError | undefined;
    if (!result || this.now() - result.fetchedAt >= referencePolicy.cacheMs) {
      try {
        this.inFlight ??= this.refresh().finally(() => {
          this.inFlight = undefined;
        });
        result = await this.inFlight;
        delivery = 'downloaded';
      } catch (error) {
        refreshError = error instanceof BaselineError ? error : upstreamError(503);
        delivery = 'fallback';
      }
    }
    if (!result) throw refreshError ?? upstreamError(503);
    const now = this.now(),
      age = Math.max(0, now - Date.parse(result.asOf));
    if (age > referencePolicy.maxAgeMs)
      throw new BaselineError(
        'REFERENCE_EXPIRED',
        '可用参考汇率已超过 96 小时；请等待数据恢复，或主动选择离线历史基准。',
      );
    const warnings: string[] = [];
    if (age > referencePolicy.staleMs)
      warnings.push('报价距开局已超过 2 小时，可能是休市或数据延迟；请以原始报价时间为准。');
    if (refreshError) warnings.push(`本次更新未成功，使用上次完整快照。${refreshError.message}`);
    return {
      kind: 'reference',
      roster: ['USD', ...referenceSymbols.map((s) => s.currency)],
      asOf: result.asOf,
      rates: { ...result.rates },
      reference: {
        provider: 'twelve-data',
        interval: '1min',
        fetchedAt: new Date(result.fetchedAt).toISOString(),
        selectedAt: new Date(now).toISOString(),
        ageAtStartSeconds: Math.floor(age / 1000),
        delivery,
        staleAtStart: age > referencePolicy.staleMs || !!refreshError,
        warnings,
        quotes: result.quotes.map((q) => ({ ...q })),
      },
    };
  }
}
