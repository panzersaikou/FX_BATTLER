/** Build-only alias for node:crypto. Never included in the normal server build. */
export const randomUUID = () => globalThis.crypto.randomUUID();
export function randomInt(min: number, max: number) {
  const range = max - min;
  const ceiling = Math.floor(2 ** 32 / range) * range;
  const bytes = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(bytes);
  } while (bytes[0] >= ceiling);
  return min + (bytes[0] % range);
}
