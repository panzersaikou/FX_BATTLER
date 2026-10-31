import { expect, test, type Page } from '@playwright/test';
import { createApp } from '../../apps/server/src/app';
import { HttpAgentProvider } from '../../apps/server/src/agent-http';
import { readAgentSetup } from '../../apps/server/src/agent-config';
async function routeApi(page: Page, app: ReturnType<typeof createApp>) {
  await page.route('**/api/**', async (route) => {
    const r = route.request(),
      url = new URL(r.url());
    const response = await app.inject({
      method: r.method() as 'GET' | 'POST' | 'DELETE',
      url: url.pathname + url.search,
      ...(r.postData()
        ? { payload: r.postData()!, headers: { 'content-type': 'application/json' } }
        : {}),
    });
    await route.fulfill({
      status: response.statusCode,
      contentType: 'application/json',
      body: response.body,
    });
  });
}
test('real agent HTTP adapter and queue drive UI using fixture model responses, including fallback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  let release!: () => void,
    fail = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const config = readAgentSetup({
    AGENT_API_KEY: 'fixture-only-never-user-key',
    AGENT_MODEL: 'fixture-model',
  }).config!;
  const provider = new HttpAgentProvider(config, async (_url, init) => {
    await gate;
    if (fail) return new Response('fixture failure', { status: 401 });
    const state = JSON.parse(JSON.parse(init.body).messages[1].content);
    const topic = Object.keys(state.constraints)[0],
      bound = state.constraints[topic];
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                decision: 'publish',
                reason: '测试响应：供应链约束影响进口成本，后续传导至通胀。',
                event: {
                  ...state.task,
                  topic,
                  expected: bound.expected,
                  actual: Math.round((bound.expected + bound.maxDelta * 0.5) * 100) / 100,
                  title: '模拟物流交付受阻，企业调整生产计划',
                  description:
                    '这是一条用于验证 Agent 工作流的模拟事件：物流延误增加进口成本，企业可能延后投资；不对应真实新闻。',
                },
              }),
            },
          },
        ],
      }),
    );
  });
  const app = createApp({
    timer: false,
    agent: {
      provider,
      defaultMode: 'local',
      message: '工作流演练：使用测试模型响应，不访问真实 AI 服务。',
    },
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await routeApi(page, app);
    await page.goto('/');
    const panel = page.getByRole('region', { name: 'Agent 模式', exact: true });
    await panel.getByRole('button', { name: '外部 Agent', exact: true }).click();
    await expect(panel.getByRole('button', { name: '外部 Agent', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: /提出一个事件建议/ }).click();
    await page.getByRole('button', { name: '提交情景建议', exact: true }).click();
    await page.getByRole('button', { name: '推进一小时' }).click();
    await expect(page.getByText('后台生成中', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '买入做多 EUR', exact: true }).click();
    await expect(page.getByRole('button', { name: '平仓', exact: true })).toBeVisible();
    release();
    await expect(panel.getByText('等待推进校验', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '推进一小时' }).click();
    await expect(
      page.locator('.event-item').filter({ hasText: '人工情景' }).getByText('Agent 生成'),
    ).toBeVisible();
    fail = true;
    await page.getByRole('button', { name: '提交情景建议', exact: true }).click();
    await page.getByRole('button', { name: '推进一小时' }).click();
    await expect(panel.getByText('等待推进校验', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '推进一小时' }).click();
    await expect(
      page.locator('.event-item').getByText('本地降级', { exact: true }).first(),
    ).toBeVisible();
    await expect(panel.locator('.agent-log')).toContainText('认证或权限失败');
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 6000 });
    await panel.screenshot({ path: 'artifacts/v0.4-agent-workflow-demo.png' });
    await panel.getByRole('button', { name: '本地导演', exact: true }).click();
    await expect(panel.getByRole('button', { name: '本地导演', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    expect(await page.content()).not.toContain('fixture-only-never-user-key');
  } finally {
    release();
    await app.close();
  }
});

test('without a key the director explains configuration and remains playable locally', async ({
  page,
}) => {
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Agent 模式', exact: true });
  await expect(panel.getByRole('button', { name: '外部 Agent', exact: true })).toBeDisabled();
  await expect(panel).toContainText('尚未配置 Agent 密钥');
  await panel.getByText('Agent 如何工作？', { exact: true }).click();
  await expect(panel).toContainText('代码已准备好');
  await panel.screenshot({ path: 'artifacts/v0.4-agent-setup.png' });
  await expect(page.getByRole('button', { name: '买入做多 EUR', exact: true })).toBeEnabled();
});
