import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('standalone HTML works with networking disabled and no server', async ({ page, context }) => {
  await context.setOffline(true);
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(r.url()));
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The managed browser blocks file:// navigation. Supply the exact artifact from memory;
  // no HTTP server or backend is started, and every other resource request is rejected.
  const documentUrl = 'http://127.0.0.1:4179/fx-battler-preview.html';
  const html = await readFile('artifacts/fx-battler-preview.html', 'utf8');
  await page.route('**/*', (route) =>
    route.request().url() === documentUrl
      ? route.fulfill({ status: 200, contentType: 'text/html', body: html })
      : route.abort(),
  );
  await page.goto(documentUrl);
  await expect(page.getByText('离线交互预览', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Agent 模式', exact: true })
      .getByRole('button', { name: '外部 Agent', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Agent 模式', exact: true })).toContainText(
    '外部 Agent 需要运行后端',
  );
  await expect(page.getByRole('combobox', { name: '模拟速度' })).toHaveValue('1');
  await expect(page.locator('.session-name strong')).toHaveText('09:00:00');
  await expect(page.getByRole('region', { name: '开局背景' })).toBeVisible();
  await page.getByRole('button', { name: '历史数据', exact: true }).click();
  await expect(page.getByRole('img', { name: 'EUR/USD 现实历史周采样曲线' })).toBeVisible();
  await page.getByRole('combobox', { name: '历史基础货币' }).selectOption('VND');
  await expect(page.getByText('此组合缺少真实历史数据；不会用模拟曲线代替。')).toBeVisible();
  await page.getByRole('button', { name: '交易终端', exact: true }).click();
  await page.getByRole('button', { name: /提出一个事件建议/ }).click();
  await page.getByRole('button', { name: '提交情景建议' }).click();
  await expect(page.getByText('等待发生', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始新手教程 →' }).click();
  await expect(page.getByRole('heading', { name: '读懂一组汇率' })).toBeVisible();
  await page.getByRole('button', { name: '退出新手教程' }).click();
  await page.getByRole('button', { name: '切换为收盘折线' }).click();
  await expect(page.locator('.price-line')).toHaveCount(1);
  await page.getByRole('button', { name: '开始模拟', exact: true }).click();
  await expect(page.locator('.session-name strong')).not.toHaveText('09:00:00');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始模拟', exact: true })).toBeEnabled();
  await expect(page.locator('.session-name strong')).toHaveText(/^09:00:0[1-9]$/);
  await page.getByRole('button', { name: '买入做多 EUR' }).click();
  await expect(page.getByRole('button', { name: '平仓', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '平仓', exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '推进一小时' }).click();
    await expect(page.getByRole('button', { name: '推进一小时' })).toBeEnabled();
  }
  await expect(page.locator('.event-item')).not.toHaveCount(0);
  await expect(page.getByText('已进入市场', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '经济体', exact: true }).click();
  await expect(page.locator('.economy-card')).toHaveCount(30);
  await expect(page.getByRole('region', { name: '经济传导观察' })).toBeVisible();
  await expect(page.locator('.transmission-log article')).not.toHaveCount(0);
  await page.getByRole('combobox', { name: '观察经济体' }).selectOption('CNY');
  await expect(page.getByRole('heading', { name: '中国 · 内部经济' })).toBeVisible();
  await expect(page.getByRole('img', { name: '中国工业景气指数趋势' })).toBeVisible();
  await page.getByRole('tab', { name: '现实基准与扰动' }).click();
  await expect(page.locator('.domestic-audit')).toContainText('历史统计');
  await page
    .locator('.domestic-panel')
    .screenshot({ path: 'artifacts/offline-world-baseline.png' });
  await page.getByRole('button', { name: '交易终端', exact: true }).click();
  await page.screenshot({ path: 'artifacts/preview-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '新的一局', exact: true }).click();
  await page.getByRole('button', { name: '开启新的一局', exact: true }).click();
  await expect(page.getByRole('button', { name: /成交记录/ })).toHaveText('成交记录 0');
  await page.reload();
  await expect(page.getByRole('button', { name: '买入做多 EUR' })).toBeEnabled();
  expect(errors).toEqual([]);
  expect(requests.every((url) => url === documentUrl)).toBe(true);
});
