import type { UserProfileForAvatar } from '@/types/rsvp';

let cached: UserProfileForAvatar | null | undefined = undefined;
let inflight: Promise<UserProfileForAvatar | null> | null = null;

export function getCachedViewerUser() { return cached; }
export function setCachedViewerUser(v: UserProfileForAvatar | null) { cached = v; }
export function clearCachedViewerUser() { cached = undefined; }

export async function primeViewerUser(): Promise<UserProfileForAvatar | null> {
  if (cached !== undefined) return cached ?? null;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/viewer/user', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return (cached = null);
      const data = (await res.json()) as UserProfileForAvatar | null;
      return (cached = data ?? null);
    } catch {
      return (cached = null);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
