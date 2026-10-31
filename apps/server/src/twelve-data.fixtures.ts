/** Synthetic provider payload for tests only; never a live-data fallback. */
export function referenceFixture(asOf = '2026-10-30 12:00:00') {
  const prices = {
    'EUR/USD': '1.1600',
    'USD/JPY': '150.00',
    'GBP/USD': '1.3200',
    'USD/CHF': '0.8000',
    'USD/CAD': '1.3800',
    'AUD/USD': '0.6600',
    'NZD/USD': '0.6000',
    'USD/MXN': '18.5000',
  };
  return Object.fromEntries(
    Object.entries(prices).map(([symbol, close]) => [
      symbol,
      {
        meta: {
          symbol,
          interval: '1min',
          currency_base: symbol.slice(0, 3),
          currency_quote: symbol.slice(4),
          type: 'Physical Currency',
        },
        values: [{ datetime: asOf, open: close, high: close, low: close, close }],
        status: 'ok',
      },
    ]),
  );
}
