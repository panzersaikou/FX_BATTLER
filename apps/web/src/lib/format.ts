export const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const price = (n: number, _pair: string) =>
  n.toFixed(
    n >= 100
      ? 3
      : n >= 1
        ? 5
        : Math.min(10, Math.max(6, Math.ceil(-Math.log10(Math.max(n, 1e-12))) + 4)),
  );
export const signed = (n: number, digits = 2) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
export function clock(minute: number, withSeconds = false) {
  const seconds = ((Math.round((minute + 540) * 60) % 86400) + 86400) % 86400;
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60];
  if (withSeconds) parts.push(seconds % 60);
  return parts.map((part) => String(part).padStart(2, '0')).join(':');
}
export const day = (minute: number) => Math.floor((minute + 540) / 1440) + 1;
