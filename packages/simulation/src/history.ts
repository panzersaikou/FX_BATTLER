import type { FxHistory } from '@fx/contracts';
/** Crosses use only shared observed dates, never forward-filled missing currencies/dates. */
export function historyCross(data: FxHistory, base: string, quote: string): [string, number][] {
  if (base === quote) return [];
  if ((base !== 'USD' && !data.series[base]) || (quote !== 'USD' && !data.series[quote])) return [];
  const a = data.series[base]?.points,
    b = data.series[quote]?.points;
  if (base === 'USD') return b.map(([date, value]) => [date, 1 / value]);
  if (quote === 'USD') return a.map(([date, value]) => [date, value]);
  const right = new Map(b);
  return a.flatMap(([date, value]) =>
    right.has(date) ? [[date, value / right.get(date)!] as [string, number]] : [],
  );
}
/** Keep the final observed date in each ISO-style Monday-based week. */
export function weeklyHistory(points: [string, number][]): [string, number][] {
  const weeks = new Map<number, [string, number]>();
  for (const point of points)
    weeks.set(Math.floor((Date.parse(point[0]) / 86400000 + 3) / 7), point);
  return [...weeks.values()];
}
