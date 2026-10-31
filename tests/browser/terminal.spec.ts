import { test, expect } from '@playwright/test';

test('desktop: trade, close, advance reports, explore and reset', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: '模拟速度' })).toHaveValue('1');
  await expect(page.locator('.session-name strong')).toHaveText('09:00:00');
  await expect(page.getByRole('button', { name: '买入做多 EUR' })).toBeEnabled();
  await expect(page.getByText('模拟行情 · 2023 历史基准 + 开局扰动')).toBeVisible();
  await page.screenshot({ path: 'test-results/terminal-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '买入做多 EUR' }).click();
  await expect(page.getByRole('button', { name: '平仓', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '平仓', exact: true }).click();
  await expect(page.getByRole('button', { name: '平仓', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /成交记录/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '推进一小时' }).click();
    await expect(page.getByRole('button', { name: '推进一小时' })).toBeEnabled();
  }
  await expect(page.locator('.event-item')).not.toHaveCount(0);
  await page.getByRole('button', { name: '经济体', exact: true }).click();
  await expect(page.locator('.economy-card')).toHaveCount(30);
  await expect(page.getByRole('region', { name: '经济传导观察' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '观察经济体' })).toHaveValue('EUR');
  await page.getByRole('combobox', { name: '观察经济体' }).selectOption('CAD');
  await expect(page.getByRole('heading', { name: '加拿大的贸易联系' })).toBeVisible();
  await expect(page.locator('.transmission-log article')).not.toHaveCount(0);
  await page.screenshot({ path: 'test-results/economy-dashboard.png', fullPage: true });
  await page.locator('.trade-partner').first().click();
  await expect(page.getByRole('combobox', { name: '观察经济体' })).toHaveValue('USD');
  await page.getByRole('button', { name: '事件档案', exact: true }).click();
  await page.locator('.event-main').first().click();
  await expect(page.locator('.event-details')).toBeVisible();
  await expect(page.locator('.event-transmission li')).toHaveCount(3);
  await page.getByRole('button', { name: '交易终端', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索货币对' }).fill('GBPJPY');
  await page.locator('.watch-item').click();
  await expect(page.getByRole('heading', { name: 'GBP / JPY' })).toBeVisible();
  await page.getByRole('button', { name: '15 分钟', exact: true }).click();
  await expect(page.getByRole('img', { name: /GBP\/JPY 15 分钟/ })).toBeVisible();
  await page.getByRole('button', { name: '新的一局', exact: true }).click();
  await page.getByRole('button', { name: '开启新的一局', exact: true }).click();
  await expect(page.getByRole('button', { name: /成交记录/ })).toHaveText('成交记录 0');
  expect(errors).toEqual([]);
});

test('mobile: responsive layout and running clock', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始模拟', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '开始模拟', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '模拟速度' })).toHaveValue('1');
  await expect(page.locator('.session-name strong')).not.toHaveText('09:00:00', { timeout: 8000 });
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始模拟', exact: true })).toBeEnabled();
  await expect(page.locator('.session-name strong')).toHaveText(/^09:00:0[1-9]$/);
  await page.getByRole('combobox', { name: '模拟速度' }).selectOption('60');
  await expect(page.getByRole('button', { name: '开始模拟', exact: true })).toBeEnabled();
  await expect(page.getByRole('combobox', { name: '模拟速度' })).toHaveValue('60');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/terminal-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '经济体', exact: true }).click();
  await expect(page.locator('.economy-card')).toHaveCount(30);
  await page.screenshot({ path: 'test-results/economy-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
