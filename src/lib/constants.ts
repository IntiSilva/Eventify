
/** Hard fallback used when no env is present */
export const FEATURED_THRESHOLD_DEFAULT = 5 as const;

/** Small helper to parse a positive integer with a safe fallback */
function parsePositiveInt(value: string | undefined | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * FEATURED_THRESHOLD can be overridden for e2e/dev via ENV.
 * Use NEXT_PUBLIC_ for client-side code (Menu/Badge) and plain for server.
 * At build/dev boot time, Next.js inlines these envs.
 */
const FEATURED_THRESHOLD_ENV =
  process.env.NEXT_PUBLIC_FEATURED_THRESHOLD ??
  process.env.FEATURED_THRESHOLD;

export const FEATURED_THRESHOLD: number = parsePositiveInt(
  FEATURED_THRESHOLD_ENV,
  FEATURED_THRESHOLD_DEFAULT
);


export const PAGE_SIZE_MAIN = 6 as const;   // More events
export const FEATURED_LIMIT = 20 as const;   // Featured carousel
export const SUGGESTION_LIMIT = 5;
export const ORGANIZER_POPULAR_EVENTS_LIMIT = 20 as const;
export const AGENDA_LIST_INFINITE = false;

/* Optional helper: applies threshold and respects admin */
export function computeAutoFeatured(
  confirmedCount: number,
): boolean {
  return confirmedCount >= FEATURED_THRESHOLD;
}
