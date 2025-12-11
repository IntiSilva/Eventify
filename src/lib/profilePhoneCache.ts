'use client';

/**
 * In-memory cache for the current user's phone.
 *  - undefined => not loaded yet
 *  - null      => loaded, but empty
 *  - string    => loaded, has value
 */
let __phoneCached: string | null | undefined = undefined;
let __phoneInflight: Promise<string | null> | null = null;
let __phoneErrorLogged = false;

export function getCachedProfilePhone(): string | null | undefined {
  return __phoneCached;
}

/** Optional: commit a new value after a successful save */
export function setCachedProfilePhone(next: string | null): void {
  __phoneCached = next;
}

/** Prime once; subsequent calls reuse the same inflight promise */
export async function primeProfilePhone(): Promise<string | null> {
  if (__phoneCached !== undefined) return __phoneCached;
  if (__phoneInflight) return __phoneInflight;

  __phoneInflight = (async () => {
    try {
      const res = await fetch('/api/viewer/phone', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });

      if (!res.ok) {
        if (!__phoneErrorLogged && process.env.NODE_ENV !== 'production') {
          __phoneErrorLogged = true;
          console.error('[profilePhoneCache] /api/viewer/phone failed:', res.status, await res.text());
        }
        __phoneCached = null;
        return __phoneCached;
      }

      const data = (await res.json()) as string | null;
      __phoneCached = data ?? null;
      return __phoneCached;

    } catch (err) {
      if (!__phoneErrorLogged && process.env.NODE_ENV !== 'production') {
        __phoneErrorLogged = true;
        console.error('[profilePhoneCache] primeProfilePhone error:', err);
      }
      __phoneCached = null;
      return __phoneCached;

    } finally {
      __phoneInflight = null;
    }
  })();

  return __phoneInflight;
}
