import { test, expect } from '@playwright/test';

test('30-economy world exposes internal feedback, source audit and all currency trading', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('30 种货币')).toBeVisible();
  await page.getByRole('button', { name: '经济体', exact: true }).click();
  await expect(page.locator('.economy-card')).toHaveCount(30);
  await page.getByRole('combobox', { name: '观察经济体' }).selectOption('CNY');
  await expect(page.getByRole('heading', { name: '中国 · 内部经济' })).toBeVisible();
  await page.getByRole('tab', { name: '现实基准与扰动' }).click();
  await expect(page.locator('.domestic-audit')).toContainText('2023');
  await expect(page.locator('.domestic-audit a').first()).toHaveAttribute(
    'href',
    /data.worldbank.org\/indicator\//,
  );
  await expect(page.locator('.domestic-audit')).toContainText('模型假设');
  await page
    .locator('.domestic-panel')
    .screenshot({ path: 'artifacts/world-baseline-desktop.png' });
  await page.getByRole('tab', { name: '实体经济' }).click();
  await page.getByRole('button', { name: '推进一小时' }).click();
  await expect(page.getByRole('button', { name: '推进一小时' })).toBeEnabled();
  await expect(page.getByRole('img', { name: '中国工业景气指数趋势' })).toBeVisible();
  await expect(page.locator('.domestic-trend h3')).toHaveText('内部趋势 · 最近 2 个观测点');
  await expect(page.locator('.domestic-delta').first()).toBeVisible();
  await page.getByRole('tab', { name: '金融与住房' }).click();
  await expect(page.locator('.domestic-metrics')).toContainText('银行压力');
  await page.getByRole('combobox', { name: '内部趋势指标' }).selectOption('creditGrowth');
  await page
    .locator('.domestic-panel')
    .screenshot({ path: 'artifacts/world-domestic-desktop.png' });
  await page.getByRole('textbox', { name: '查找经济体' }).fill('巴西');
  await expect(page.locator('.economy-card')).toHaveCount(1);
  await page.getByRole('button', { name: '查看巴西传导 →' }).click();
  await expect(page.getByRole('heading', { name: '巴西 · 内部经济' })).toBeVisible();
  await page.getByRole('button', { name: '交易终端', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索货币对' }).fill('USDVND');
  await page.locator('.watch-item').click();
  await expect(page.getByRole('heading', { name: 'USD / VND' })).toBeVisible();
  await page.getByRole('button', { name: '买入做多 USD' }).click();
  await expect(page.getByRole('button', { name: '平仓', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '平仓', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索货币对' }).fill('VNDUSD');
  await page.locator('.watch-item').click();
  await expect(page.locator('.chart-last strong')).not.toHaveText('0.00000');
  expect(errors).toEqual([]);
});

test('expanded economy panels stay usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '经济体', exact: true }).click();
  await page.getByRole('combobox', { name: '观察经济体' }).selectOption('INR');
  await expect(page.getByRole('heading', { name: '印度 · 内部经济' })).toBeVisible();
  await page.getByRole('tab', { name: '财政与外部' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('tab', { name: '现实基准与扰动' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.domestic-panel').screenshot({ path: 'artifacts/world-domestic-mobile.png' });
});
