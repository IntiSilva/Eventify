type MutateDebounced = (
  keys: readonly string[],
  pattern?: (k: unknown) => boolean,
  waitMs?: number
) => Promise<void>;

type SyncFeaturedChangeAndRevalidateParams = {
  prevFeatured: boolean;
  nextFeatured: boolean | null | undefined;
  eventId: string;
  emitFeaturedChange: (payload: { id: string; toFeatured: boolean }) => void;
  getFeaturedKeys: () => string[];
  getMainListKeys: () => string[];
  mutateDebounced: MutateDebounced;
  isEventsListKey: (k: unknown) => k is string;
};

export async function syncFeaturedChangeAndRevalidate({
  prevFeatured,
  nextFeatured,
  eventId,
  emitFeaturedChange,
  getFeaturedKeys,
  getMainListKeys,
  mutateDebounced,
  isEventsListKey,
}: SyncFeaturedChangeAndRevalidateParams): Promise<void> {
  const finalIsFeatured = Boolean(nextFeatured);
  const featuredChanged = prevFeatured !== finalIsFeatured;
  if (!featuredChanged) return;

  emitFeaturedChange({ id: eventId, toFeatured: finalIsFeatured });

  const featuredKeys = Array.from(new Set(getFeaturedKeys()));
  if (!finalIsFeatured) {
    const mainKeys = Array.from(new Set(getMainListKeys()));
    await mutateDebounced([...featuredKeys, ...mainKeys], isEventsListKey);
    return;
  }

  await mutateDebounced(featuredKeys);
}
