import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('beginner guide teaches a manual trade without resetting the world; chart tools work', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/');
  await expect(page.getByRole('region', { name: '开局背景' })).toBeVisible();
  await page.locator('.opening-story summary').first().click();
  await expect(page.locator('.opening-story[open]')).toContainText('本局贷款利率起点');
  await page.screenshot({ path: 'artifacts/v0.3-opening.png', fullPage: true });
  await page.getByRole('button', { name: '切换为收盘折线' }).click();
  await expect(page.locator('.price-line')).toHaveCount(1);
  await page.getByRole('button', { name: '15 分钟', exact: true }).click();
  const chart = page.getByRole('img', { name: /EUR\/USD 15 分钟模拟 收盘折线/ });
  await chart.focus();
  await chart.press('ArrowLeft');
  await expect(page.locator('.chart-crosshair')).toHaveCount(1);
  await page.getByRole('button', { name: '十字光标', exact: true }).click();
  await expect(page.locator('.chart-crosshair')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '十字光标', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: '重置图表视图' }).click();
  await expect(page.locator('.price-line')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '5 分钟', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '展开图表' }).click();
  await expect(page.getByRole('dialog', { name: 'EUR/USD K 线图' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '开始新手教程 →' }).click();
  await page.getByRole('button', { name: '这组报价上涨', exact: true }).click();
  await expect(page.locator('.lesson-quiz')).toContainText('盈利仍需覆盖点差');
  await page.locator('.learning-panel').screenshot({ path: 'artifacts/v0.3-tutorial.png' });
  await page.getByRole('button', { name: '教程第 2 步：看懂 K 线与时间' }).click();
  await page.getByRole('button', { name: '展开图表' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: '新手教程' })).toBeVisible();
  await page.getByRole('button', { name: '教程第 4 步：亲手开一笔小仓位' }).click();
  await page.getByRole('button', { name: '买入做多 EUR', exact: true }).click();
  await expect(page.locator('.lesson-result')).toContainText('已记录练习开仓');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '平仓', exact: true }).click();
  await expect(page.locator('.lesson-result')).toContainText('练习交易已平仓');
  await page.getByRole('button', { name: '退出新手教程' }).click();
  await expect(page.getByRole('button', { name: /成交记录/ })).toHaveText('成交记录 2');
  expect(errors).toEqual([]);
});

test('suggestions execute on schedule and real history exports observed data, with missing coverage explicit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/');
  await page.getByRole('button', { name: /提出一个事件建议/ }).click();
  await page
    .getByRole('textbox', { name: '事件背景建议' })
    .fill('能源运输发生中断，影响工业进口成本');
  await page.getByRole('button', { name: '提交情景建议' }).click();
  await expect(page.locator('[aria-label="事件建议队列"]').getByText('等待发生')).toBeVisible();
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 6000 });
  await page.locator('.director-panel').screenshot({ path: 'artifacts/v0.3-director.png' });
  await page.getByRole('button', { name: '推进一小时' }).click();
  await expect(page.getByText('已进入市场', { exact: true })).toBeVisible();
  await expect(page.locator('.event-item').filter({ hasText: '人工情景' })).toHaveCount(1);
  await page.getByRole('button', { name: '历史数据', exact: true }).click();
  await expect(page.getByRole('img', { name: 'EUR/USD 现实历史周采样曲线' })).toBeVisible();
  await expect(page.locator('.history-provenance')).toContainText('2026-10-23');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载此货币对日频 CSV' }).click();
  const file = await downloading;
  const csv = await readFile((await file.path())!, 'utf8');
  expect(csv).toContain('date,pair,reference_rate');
  expect(csv.split('\n').length).toBeGreaterThan(400);
  await page.locator('.history-panel').screenshot({ path: 'artifacts/v0.3-history.png' });
  await page.getByRole('combobox', { name: '历史基础货币' }).selectOption('VND');
  await expect(page.getByText('此组合缺少真实历史数据；不会用模拟曲线代替。')).toBeVisible();
  await expect(page.getByRole('button', { name: '下载此货币对日频 CSV' })).toBeDisabled();
  await page.getByRole('combobox', { name: '历史基础货币' }).selectOption('EUR');
  await page.getByRole('combobox', { name: '历史计价货币' }).selectOption('JPY');
  await expect(page.getByRole('img', { name: 'EUR/JPY 现实历史周采样曲线' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/v0.3-history-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '交易终端', exact: true }).click();
  await page.getByRole('button', { name: /提出一个事件建议/ }).click();
  await page.getByRole('button', { name: '提交情景建议' }).click();
  await expect(page.getByText('等待发生', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消建议', exact: true }).click();
  await expect(page.getByText('已取消', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
