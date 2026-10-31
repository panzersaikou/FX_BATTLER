import { createApp } from './app.ts';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EnvHttpProxyAgent, fetch } from 'undici';
import { TwelveDataBaselineProvider } from './twelve-data.ts';
import { readAgentSetup } from './agent-config.ts';
import { HttpAgentProvider } from './agent-http.ts';

// Local development convenience. Injected environment values take precedence.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const apiKey = process.env.TWELVE_DATA_API_KEY?.trim();
const agentSetup = readAgentSetup(process.env);
const dispatcher = apiKey || agentSetup.config ? new EnvHttpProxyAgent() : undefined;
const baseline = apiKey
  ? new TwelveDataBaselineProvider(apiKey, (url, init) => fetch(url, { ...init, dispatcher }))
  : undefined;
const agentProvider = agentSetup.config
  ? new HttpAgentProvider(agentSetup.config, (url, init) => fetch(url, { ...init, dispatcher }))
  : undefined;
const app = createApp({
  logger: true,
  baseline,
  agent: {
    provider: agentProvider,
    defaultMode: agentSetup.defaultMode,
    message: agentSetup.message,
    deadlineMs: agentSetup.config
      ? Math.min(
          120000,
          agentSetup.config.timeoutMs * (agentSetup.config.maxRetries + 1) +
            3500 * agentSetup.config.maxRetries +
            1000,
        )
      : undefined,
  },
});
app.addHook('onClose', async () => {
  await dispatcher?.close();
});
try {
  await app.listen({
    port: Number(process.env.PORT ?? 3001),
    host: process.env.HOST ?? '127.0.0.1',
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
