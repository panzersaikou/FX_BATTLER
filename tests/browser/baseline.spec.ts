import { test, expect, type Page } from '@playwright/test';
import { createApp } from '../../apps/server/src/app';
import { TwelveDataBaselineProvider } from '../../apps/server/src/twelve-data';
import { referenceFixture } from '../../apps/server/src/twelve-data.fixtures';

// Browser + real API/session code, with only the paid upstream replaced by a fixture.
async function routeApi(page: Page, app: ReturnType<typeof createApp>) {
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const response = await app.inject({
      method: request.method() as 'GET' | 'POST' | 'DELETE',
      url: url.pathname + url.search,
      ...(request.postData()
        ? { payload: request.postData()!, headers: { 'content-type': 'application/json' } }
        : {}),
    });
    await route.fulfill({
      status: response.statusCode,
      contentType: 'application/json',
      body: response.body,
    });
  });
}

test('reference provenance, failed reset preserves the game, and explicit demo switch', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let now = Date.parse('2026-11-01T00:01:00Z'),
    fail = false,
    calls = 0;
  const provider = new TwelveDataBaselineProvider(
    'test-key',
    async () => {
      calls++;
      return new Response(
        JSON.stringify(fail ? { status: 'error', code: 429 } : referenceFixture()),
        { status: 200 },
      );
    },
    () => now,
  );
  const app = createApp({ timer: false, baseline: provider });
  try {
    await routeApi(page, app);
    await page.goto('/');
    await page.getByRole('button', { name: '新的一局', exact: true }).click();
    await page.getByRole('combobox', { name: '开局汇率来源' }).selectOption('reference');
    await page.getByRole('button', { name: '开启新的一局', exact: true }).click();
    await expect(page.getByText('使用较旧快照 · 查看时间')).toBeVisible();
    await page.locator('.baseline-panel summary').click();
    await expect(page.locator('.baseline-content tbody tr')).toHaveCount(8);
    await expect(page.getByText('报价距开局已超过 2 小时', { exact: false })).toBeVisible();
    await expect(page.locator('.baseline-content')).toContainText('2026/10/30 20:00:00');
    await expect(page.locator('.baseline-content')).toContainText('1 JPY = 0.006666667');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: 'test-results/reference-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '买入做多 EUR' }).click();
    await expect(page.getByRole('button', { name: '平仓', exact: true })).toBeVisible();
    const oldId = await page.evaluate(() => sessionStorage.getItem('fx-session'));
    expect(calls).toBe(1);
    now += 97 * 3_600_000;
    fail = true;
    await page.getByRole('button', { name: '新的一局', exact: true }).click();
    await page.getByRole('combobox', { name: '开局汇率来源' }).selectOption('reference');
    await page.getByRole('button', { name: '开启新的一局', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('超过 96 小时');
    expect(await page.evaluate(() => sessionStorage.getItem('fx-session'))).toBe(oldId);
    await expect(page.getByRole('button', { name: '平仓', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: '开局汇率来源' }).selectOption('historical');
    await page.getByRole('button', { name: '开启新的一局', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('模拟行情 · 2023 历史基准 + 开局扰动')).toBeVisible();
    await expect(page.getByRole('button', { name: '平仓', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('fx-session'))).not.toBe(oldId);
    expect(calls).toBe(2);
  } finally {
    await app.close();
  }
});

test('offline default uses no API; failed reference selection preserves historical game', async ({
  page,
}) => {
  let calls = 0;
  const provider = new TwelveDataBaselineProvider('test-key', async () => {
    calls++;
    return new Response(JSON.stringify({ status: 'error', code: 429 }));
  });
  const app = createApp({ timer: false, baseline: provider });
  try {
    await routeApi(page, app);
    await page.goto('/');
    await expect(page.getByText('模拟行情 · 2023 历史基准 + 开局扰动')).toBeVisible();
    expect(calls).toBe(0);
    const oldId = await page.evaluate(() => sessionStorage.getItem('fx-session'));
    await page.getByRole('button', { name: '新的一局', exact: true }).click();
    await page.getByRole('combobox', { name: '开局汇率来源' }).selectOption('reference');
    await page.getByRole('button', { name: '开启新的一局', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('额度');
    await page.getByRole('button', { name: '开启新的一局', exact: true }).click();
    await expect(page.getByRole('button', { name: '开启新的一局', exact: true })).toBeEnabled();
    expect(calls).toBe(1);
    expect(await page.evaluate(() => sessionStorage.getItem('fx-session'))).toBe(oldId);
    await page.getByRole('combobox', { name: '开局汇率来源' }).selectOption('historical');
    await page.getByRole('button', { name: '开启新的一局', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls).toBe(1);
  } finally {
    await app.close();
  }
});
