export interface AgentConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  format: 'json_schema' | 'json_object';
  tokenParameter: 'max_completion_tokens' | 'max_tokens';
  timeoutMs: number;
  maxRetries: number;
  requestsPerMinute: number;
  maxConcurrent: number;
}
export interface AgentSetup {
  config?: AgentConfig;
  defaultMode: 'local' | 'external';
  message: string;
}
/** Only server environment may choose a provider URL or supply credentials. Never return config to clients. */
export function readAgentSetup(env: Record<string, string | undefined>): AgentSetup {
  const pending = (message: string): AgentSetup => ({ defaultMode: 'local', message });
  if (!env.AGENT_API_KEY?.trim()) return pending('尚未配置 Agent 密钥；当前使用本地导演。');
  if (!env.AGENT_MODEL?.trim()) return pending('尚未配置 Agent 模型名称；当前使用本地导演。');
  try {
    const base = new URL(env.AGENT_BASE_URL?.trim() || 'https://api.openai.com/v1');
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
      throw new Error();
    const integer = (key: string, fallback: number, min: number, max: number) => {
      const value = env[key] === undefined ? fallback : Number(env[key]);
      if (!Number.isInteger(value) || value < min || value > max) throw new Error();
      return value;
    };
    const format = env.AGENT_RESPONSE_FORMAT ?? 'json_schema';
    const tokenParameter = env.AGENT_TOKEN_PARAMETER ?? 'max_completion_tokens';
    if (!['max_completion_tokens', 'max_tokens'].includes(tokenParameter)) throw new Error();
    if (
      !['json_schema', 'json_object'].includes(format) ||
      (env.AGENT_MODE && !['local', 'external'].includes(env.AGENT_MODE))
    )
      throw new Error();
    return {
      defaultMode: env.AGENT_MODE === 'external' ? 'external' : 'local',
      message: '后端 Agent 配置已加载，尚不代表远端认证已验证；选择外部模式后会在事件排程时调用。',
      config: {
        apiKey: env.AGENT_API_KEY.trim(),
        model: env.AGENT_MODEL.trim(),
        endpoint: base.toString().replace(/\/+$/, '') + '/chat/completions',
        format: format as AgentConfig['format'],
        tokenParameter: tokenParameter as AgentConfig['tokenParameter'],
        timeoutMs: integer('AGENT_TIMEOUT_MS', 10000, 100, 60000),
        maxRetries: integer('AGENT_MAX_RETRIES', 1, 0, 2),
        requestsPerMinute: integer('AGENT_REQUESTS_PER_MINUTE', 6, 1, 60),
        maxConcurrent: integer('AGENT_MAX_CONCURRENT', 2, 1, 5),
      },
    };
  } catch {
    return pending(
      'Agent 配置无效：检查 HTTPS 基地址、模式、输出格式及数值范围。当前使用本地导演。',
    );
  }
}
