import type {
  AgentDecision,
  AgentObservation,
  AgentProvider,
  ScenarioContext,
} from '@fx/contracts';
import { AgentFailure, buildAgentMessages, decisionJsonSchema, validateDecision } from '@fx/agents';
import type { AgentConfig } from './agent-config';

type ResponseLike = {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  body: {
    cancel(): Promise<void>;
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
      releaseLock(): void;
    };
  } | null;
};
export type AgentFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect: 'error';
  },
) => Promise<ResponseLike>;
const MAX_RESPONSE_BYTES = 64 * 1024;
async function readBounded(response: ResponseLike, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) {
    void response.body?.cancel().catch(() => {});
    throw new AgentFailure('cancelled');
  }
  if (!response.body) throw new AgentFailure('invalid_response');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  let size = 0,
    text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) throw new AgentFailure('invalid_response');
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new AgentFailure('invalid_response');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    if (signal.aborted) throw new AgentFailure('cancelled');
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof AgentFailure) throw e;
    throw new AgentFailure('invalid_response');
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const end = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      end();
      reject(new AgentFailure('cancelled'));
    };
    const timer = setTimeout(() => {
      end();
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
/** Shared across sessions: actual attempts, including retries, spend the same wall-clock budget. */
export class HttpAgentProvider implements AgentProvider {
  private calls: number[] = [];
  private active = 0;
  private cooldownUntil = 0;
  private cooldownCode: 'rate_limit' | 'circuit_open' = 'rate_limit';
  private consecutiveFailures = 0;
  constructor(
    private readonly config: AgentConfig,
    private readonly fetcher: AgentFetch,
    private readonly now = Date.now,
  ) {}
  async generate(
    observation: AgentObservation,
    context: ScenarioContext,
    signal: AbortSignal,
  ): Promise<AgentDecision> {
    if (signal.aborted) throw new AgentFailure('cancelled');
    if (this.now() < this.cooldownUntil) throw new AgentFailure(this.cooldownCode);
    if (this.active >= this.config.maxConcurrent) throw new AgentFailure('busy');
    this.active++;
    let repair = false;
    try {
      for (let attempt = 0; ; attempt++) {
        if (signal.aborted) throw new AgentFailure('cancelled');
        this.calls = this.calls.filter((t) => this.now() - t < 60000);
        if (this.calls.length >= this.config.requestsPerMinute) throw new AgentFailure('budget');
        this.calls.push(this.now());
        try {
          const result = await this.attempt(observation, context, signal, repair);
          this.consecutiveFailures = 0;
          return result;
        } catch (error) {
          const failure = error instanceof AgentFailure ? error : new AgentFailure('network');
          const retryable = [
            'timeout',
            'network',
            'unavailable',
            'rate_limit',
            'invalid_response',
          ].includes(failure.code);
          if (!retryable || attempt >= this.config.maxRetries) throw failure;
          repair = failure.code === 'invalid_response';
          const delay = Math.max(300 * 2 ** attempt, this.cooldownUntil - this.now());
          // Honor long Retry-After by declining this job, not retrying early.
          if (delay > 3000) throw failure;
          await pause(delay, signal);
        }
      }
    } catch (error) {
      if (error instanceof AgentFailure && !['cancelled', 'budget', 'busy'].includes(error.code)) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= 3 && this.cooldownUntil < this.now() + 60000) {
          this.cooldownUntil = this.now() + 60000;
          this.cooldownCode = 'circuit_open';
        }
      }
      throw error;
    } finally {
      this.active--;
    }
  }
  private async attempt(
    observation: AgentObservation,
    context: ScenarioContext,
    parent: AbortSignal,
    repair: boolean,
  ): Promise<AgentDecision> {
    const controller = new AbortController();
    const cancel = () => controller.abort(new AgentFailure('cancelled'));
    parent.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(
      () => controller.abort(new AgentFailure('timeout')),
      this.config.timeoutMs,
    );
    let abortListener: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      abortListener = () =>
        reject(
          controller.signal.reason instanceof AgentFailure
            ? controller.signal.reason
            : new AgentFailure('cancelled'),
        );
      controller.signal.addEventListener('abort', abortListener, { once: true });
    });
    if (parent.aborted) cancel();
    try {
      return await Promise.race([
        aborted,
        (async () => {
          controller.signal.throwIfAborted();
          const response = await this.fetcher(this.config.endpoint, {
            method: 'POST',
            redirect: 'error',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify({
              model: this.config.model,
              stream: false,
              messages: buildAgentMessages(observation, context, repair),
              response_format:
                this.config.format === 'json_schema'
                  ? {
                      type: 'json_schema',
                      json_schema: {
                        name: 'fx_scenario',
                        strict: true,
                        schema: decisionJsonSchema,
                      },
                    }
                  : { type: 'json_object' },
              [this.config.tokenParameter]: 1600,
            }),
          });
          if (!response.ok) {
            // Never read/log upstream error bodies: gateways may echo headers or credentials.
            void response.body?.cancel().catch(() => {});
            if ([401, 403].includes(response.status)) throw new AgentFailure('auth');
            if (response.status === 429) {
              const header = response.headers.get('retry-after');
              const seconds =
                header && /^\d+(\.\d+)?$/.test(header)
                  ? Number(header) * 1000
                  : header
                    ? Date.parse(header) - this.now()
                    : 1000;
              this.cooldownUntil =
                this.now() + (Number.isFinite(seconds) ? Math.max(300, seconds) : 1000);
              this.cooldownCode = 'rate_limit';
              throw new AgentFailure('rate_limit');
            }
            if (response.status >= 500) throw new AgentFailure('unavailable');
            throw new AgentFailure('configuration');
          }
          const envelope = (await readBounded(response, controller.signal)) as {
            choices?: {
              finish_reason?: string;
              message?: { content?: unknown; refusal?: unknown };
            }[];
          };
          const choice = envelope?.choices?.[0];
          if (choice?.message?.refusal || choice?.finish_reason === 'content_filter')
            return {
              decision: 'reject' as const,
              event: null,
              reason: '模型服务未接受这次情景请求，没有生成事件。',
            };
          if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string')
            throw new AgentFailure('invalid_response');
          try {
            if (choice.message.content.includes(this.config.apiKey))
              throw new AgentFailure('invalid_response');
            return validateDecision(JSON.parse(choice.message.content), observation, context);
          } catch {
            throw new AgentFailure('invalid_response');
          }
        })(),
      ]);
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error instanceof AgentFailure) throw error;
      throw new AgentFailure('network');
    } finally {
      clearTimeout(timer);
      parent.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', abortListener);
    }
  }
}
