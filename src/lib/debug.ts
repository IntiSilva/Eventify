export const DEBUG_EVENTS = process.env.NEXT_PUBLIC_DEBUG_EVENTS === '1';

export const dlog = (...args: unknown[]) => {
  if (!DEBUG_EVENTS) return;
  console.log('%c[events]', 'color:#10b981', ...args);
};

export const dgroup = (label: string, ...extra: unknown[]) => {
  if (!DEBUG_EVENTS) return { end: () => {} };
  console.groupCollapsed('%c[events] ' + label, 'color:#10b981', ...extra);
  return { end: () => console.groupEnd() };
};

export function diffShallow(
  prev: unknown,
  next: unknown
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  if (typeof prev !== 'object' || prev === null || typeof next !== 'object' || next === null) {
    return out;
  }
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.forEach((k) => {
    // We don't compare shallow, if it's an array we show it's length
    const va = Array.isArray(a[k]) ? `[array:${(a[k] as unknown[]).length}]` : a[k];
    const vb = Array.isArray(b[k]) ? `[array:${(b[k] as unknown[]).length}]` : b[k];
    if (va !== vb) out[k] = { from: va, to: vb };
  });
  return out;
}

export function headTail<T>(
  arr: readonly T[] | null | undefined,
  n = 3
): { len: number; first: T[]; last: T[] } {
  const a = arr ?? [];
  const nn = Math.max(0, Math.floor(n));

  return {
    len: a.length,
    first: a.slice(0, nn),
    last: nn > 0 ? a.slice(-nn) : [],
  };
}
