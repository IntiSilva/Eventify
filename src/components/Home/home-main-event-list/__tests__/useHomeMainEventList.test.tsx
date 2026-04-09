import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';

import { act, renderHookWithProviders, waitFor } from '@/test/test-utils';
import { useHomeMainEventList, type HomeMainInitialPayload } from '@/components/Home/home-main-event-list/useHomeMainEventList';
import { PAGE_SIZE_MAIN } from '@/lib/constants';
import { buildPaginatedEventsURL, buildSearchKey } from '@/lib/swrKeys';
import { normalizeStringForSearch } from '@/lib/utils';
import type { EventWithCreatorAndRsvps, UserProfileForAvatar } from '@/types/event';
import type { PaginatedSuccess, PaginatedMetadata } from '@/types/api';
import type { UserRole, EventCategory } from '@/generated/prisma';

/* ------------------------------------------------------------------ */
/* In-memory stores and helpers                                        */
/* ------------------------------------------------------------------ */

const eventsStore = new Map<string, EventWithCreatorAndRsvps>();
const searchBuckets = new Map<
  string,
  { pages: Map<number, string[]>; meta?: PaginatedMetadata }
>();
let upcomingList: string[] = [];

const registerMainKeyMock = vi.fn();
const unregisterMainKeyMock = vi.fn();
const openMenuMock = vi.fn();
const touchSearchPageMock = vi.fn();

const makeUser = (overrides: Partial<UserProfileForAvatar> = {}): UserProfileForAvatar => ({
  clerkId: 'clerk-1',
  username: 'organizer',
  firstName: 'Org',
  lastName: 'User',
  imageUrl: null,
  hasImage: false,
  role: 'organizer' as UserRole,
  ...overrides,
});

export const createEvent = (
  id: string,
  title: string,
  location = 'Buenos Aires'
): EventWithCreatorAndRsvps => {
  const now = new Date();
  const eventLocalDateKey = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  const eventLocalMinuteOfDay = now.getHours() * 60 + now.getMinutes();

  const normalizedTitle = normalizeStringForSearch(title);
  const normalizedLocation = normalizeStringForSearch(location);

  return {
    id,
    title,
    normalizedTitle,
    description: 'Event description',
    date: now, // Prisma DateTime as Date
    eventTimeZone: 'UTC',
    eventLocalDateKey,
    eventLocalMinuteOfDay,
    location,
    normalizedLocation,
    category: 'music' as EventCategory,
    featured: false,
    featuredByAdmin: false,
    createdBy: 'clerk-1',
    contactEmail: 'contact@example.com',
    contactPhone: null,
    contactPhoneApps: null,
    isPaid: false,
    priceCents: null,
    currency: null,
    currentPriceVersionId: null,
    archivedAt: null,
    createdAt: now,

    creator: makeUser(),
    rsvps: [],
  };
};

const seedSearchBucket = (
  key: string,
  page: number,
  ids: string[],
  meta?: PaginatedMetadata
) => {
  let bucket = searchBuckets.get(key);
  if (!bucket) {
    bucket = { pages: new Map(), meta };
    searchBuckets.set(key, bucket);
  }
  bucket.pages.set(page, ids);
  if ( meta ) bucket.meta = meta;
};

/* ------------------------------------------------------------------ */
/* Context & hooks mocks                                               */
/* ------------------------------------------------------------------ */

vi.mock('@/contexts/ViewerTzContext', () => ({
  useViewerTz: () => ({ viewerTz: 'UTC', setViewerTz: vi.fn(), formatDate: vi.fn() }),
}));

vi.mock('@/lib/hooks', () => ({
  useMediaQuery: () => true,
}));

vi.mock('@/contexts/MenuContext', () => ({
  useMenu: () => ({ open: openMenuMock }),
}));

const seenSearches: Array<{ key: string; page: number }> = [];
vi.mock('@/contexts/EventsContext', () => ({
  useStoreWriters: () => ({
    upsertEvents: (events: EventWithCreatorAndRsvps[]) => {
      events.forEach((event) => eventsStore.set(event.id, event));
    },
    setSearchPage: (
       key: string,
       page: number,
       ids: string[],
       meta?: PaginatedMetadata,
       _opts?: { touch?: 'front' | 'back'; anchorPage?: number }
     ) => {
       seedSearchBucket(key, page, ids, meta);
     },
    touchSearchPage: (key: string, page: number) => {
      touchSearchPageMock(key, page);
    },
  }),
  useSearchPage: (key: string, page: number) => {
    seenSearches.push({ key, page });
    const bucket = searchBuckets.get(key);
    const ids = bucket?.pages.get(page) ?? [];
    return { ids, meta: bucket?.meta, hasPage: bucket?.pages.has(page) ?? false };
  },
  useEventsByIds: (ids: string[]) => ids.map((id) => eventsStore.get(id)).filter(Boolean),
  useList: (name: string) => (name === 'upcoming' ? upcomingList : []),
  useMainListSWRKeys: () => ({
    registerMainListKey: registerMainKeyMock,
    unregisterMainListKey: unregisterMainKeyMock,
  }),
}));

vi.mock('@/lib/mutateHelpers', () => ({
  patchEventEverywhere: vi.fn(),
  revalidateEventLists: vi.fn(),
}));

/* ------------------------------------------------------------------ */
/* Search params mock                                                  */
/* ------------------------------------------------------------------ */

let searchParamsState = new URLSearchParams();

const updateSearchParams = (entries: Record<string, string | undefined>) => {
  searchParamsState = new URLSearchParams();
  Object.entries(entries).forEach(([key, value]) => {
    if (value) {
      searchParamsState.set(key, value);
    }
  });
};

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => searchParamsState.get(key),
    toString: () => searchParamsState.toString(),
    entries: () => searchParamsState.entries(),
  }),
}));

/* ------------------------------------------------------------------ */
/* Payload factory                                                     */
/* ------------------------------------------------------------------ */

const createInitialPayload = (ids: string[]): HomeMainInitialPayload => ({
  data: ids.map((id, index) => {
    const event = createEvent(id, `Event ${index + 1}`);
    eventsStore.set(id, event);
    return event as unknown as HomeMainInitialPayload['data'][number];
  }),
  metadata: {
    totalEvents: ids.length,
    totalPages: Math.max(1, Math.ceil(ids.length / PAGE_SIZE_MAIN)),
    currentPage: 1,
    eventsPerPage: PAGE_SIZE_MAIN,
  },
  excludeFromMainListIds: [],
});

/* ------------------------------------------------------------------ */
/* RAF control via spyOn                                              */
/* ------------------------------------------------------------------ */

const rafQueue: FrameRequestCallback[] = [];

let rafSpy: MockInstance<typeof window.requestAnimationFrame> | null = null;
let cancelSpy: MockInstance<typeof window.cancelAnimationFrame> | null = null;

const flushRaf = () => {
  // Execute all queued callbacks with a consistent timestamp
  const cbs = rafQueue.splice(0);
  cbs.forEach((cb) => cb(16));
};

const flushMicrotasks = async () => {
  // Advance microtask queue (e.g., SWR async flows)
  await Promise.resolve();
};

/* ------------------------------------------------------------------ */
/* Fetch helpers                                                       */
/* ------------------------------------------------------------------ */

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const extractUrl = (arg: RequestInfo | URL): URL => {
  if (typeof arg === 'string') return new URL(arg, 'http://localhost');
  if (arg instanceof URL) return arg;
  if (arg instanceof Request) return new URL(arg.url);
  // Fallback — should not happen in practice
  return new URL(String(arg), 'http://localhost');
};

const okPage = (
  data: EventWithCreatorAndRsvps[],
  metadata: PaginatedMetadata
): PaginatedSuccess<EventWithCreatorAndRsvps> => ({
  success: true,
  data,
  metadata,
});


/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('useHomeMainEventList', () => {
  beforeEach(() => {
    eventsStore.clear();
    searchBuckets.clear();
    upcomingList = [];
    registerMainKeyMock.mockReset();
    unregisterMainKeyMock.mockReset();
    openMenuMock.mockReset();
    touchSearchPageMock.mockReset();
    seenSearches.length = 0;
    updateSearchParams({});

    // Install RAF spies that queue callbacks; tests will call flushRaf()
    rafQueue.length = 0;
    rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        rafQueue.push(cb);
        return rafQueue.length; // simple numeric handle
      });

    cancelSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((handle: number) => {
        const idx = handle - 1;
        if (idx >= 0 && idx < rafQueue.length) {
          rafQueue[idx] = () => {};
        }
      });
  });

  afterEach(() => {
    rafSpy?.mockRestore();
    cancelSpy?.mockRestore();
    rafSpy = null;
    cancelSpy = null;

    // Restore any fetch spies created inside individual tests
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('resets pagination to page 1 when filters change with SSR fallback', async () => {
    const payload = createInitialPayload([
      'event-1',
      'event-2',
      'event-3',
      'event-4',
      'event-5',
      'event-6',
    ]);

    payload.metadata.totalPages = 2;
    payload.metadata.totalEvents = 9;

    const searchKey = buildSearchKey(
      { search: '', category: '', location: '', creator: '', date: '' },
      'UTC'
    );
    const pageTwoIds = ['event-7', 'event-8', 'event-9'];
    pageTwoIds.forEach((id, index) => {
      const event = createEvent(id, `Page2 ${index + 1}`);
      eventsStore.set(id, event);
    });

    seedSearchBucket(
      searchKey,
      1,
      payload.data.map((event) => event.id),
      payload.metadata
    );
    seedSearchBucket(searchKey, 2, pageTwoIds, {
      totalEvents: 9,
      totalPages: 2,
      currentPage: 2,
      eventsPerPage: PAGE_SIZE_MAIN,
    });

    // Return page-2 data as a real Response object
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        jsonResponse(
          okPage(
            pageTwoIds.map((id, index) => createEvent(id, `Fetched ${index}`)),
            {
              totalEvents: 9,
              totalPages: 2,
              currentPage: 2,
              eventsPerPage: PAGE_SIZE_MAIN,
            }
          )
        )
      );

    const { result, rerender } = renderHookWithProviders(() => useHomeMainEventList(payload));

    await waitFor(() => {
      expect(seenSearches.some((s) => s.page === 1)).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.uiTotalPages).toBe(2);
    });

    // 1) Go to page 2
    await act(async () => {
      result.current.handleNextPage();
    });
    await flushMicrotasks();
    flushRaf();

    await waitFor(() => {
      expect(result.current.uiPage).toBe(2);
    });

    // 2) Change filter -> reset to page 1
    await act(async () => {
      updateSearchParams({ category: 'music' });
      rerender();
    });
    await flushMicrotasks();
    flushRaf();

    await waitFor(() => {
      expect(result.current.uiPage).toBe(1);
    });

    // 2.1) Pre-seed page 1/2 for the new key so next-page is allowed
    const keyWithCategory = buildSearchKey(
      { search: '', category: 'music', location: '', creator: '', date: '' },
      'UTC'
    );
    const catPage1Ids = payload.data.map((e) => e.id);
    seedSearchBucket(keyWithCategory, 1, catPage1Ids, {
      totalEvents: 9,
      totalPages: 2,
      currentPage: 1,
      eventsPerPage: PAGE_SIZE_MAIN,
    });
    seedSearchBucket(keyWithCategory, 2, pageTwoIds, {
      totalEvents: 9,
      totalPages: 2,
      currentPage: 2,
      eventsPerPage: PAGE_SIZE_MAIN,
    });

    // 3) Go to page 2 again
    await act(async () => {
      result.current.handleNextPage();
    });
    await flushMicrotasks();
    flushRaf();

    await waitFor(() => {
      expect(result.current.uiPage).toBe(2);
    });

    fetchSpy.mockRestore();
  });

  it('skips revalidation on mount when cache is warm and filters are empty', () => {
    const payload = createInitialPayload(['event-1', 'event-2']);

    const searchKey = buildSearchKey(
      { search: '', category: '', location: '', creator: '', date: '' },
      'UTC'
    );
    seedSearchBucket(
      searchKey,
      1,
      payload.data.map((event) => event.id),
      payload.metadata
    );

    const apiQuery = buildPaginatedEventsURL({
      page: 1,
      limit: PAGE_SIZE_MAIN,
      filters: { search: '', category: '', location: '', creator: '', date: '' },
      viewTz: 'UTC',
      excludeIds: [],
    });
    const apiKey = `/api/events${apiQuery}`;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse(okPage(payload.data, payload.metadata))
    );

    renderHookWithProviders(() => useHomeMainEventList(payload), {
      swrFallback: {
        [apiKey]: okPage(payload.data, payload.metadata),
      },
    });

    // Since SWR cache is warm, no fetch should happen on mount
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('builds fetch URL with sorted exclude ids', async () => {
    upcomingList = ['event-3', 'event-1'];
    const payload = createInitialPayload(['event-2']);

    renderHookWithProviders(() => useHomeMainEventList(payload));

    await flushMicrotasks();
    flushRaf();

    await waitFor(() => {
      expect(registerMainKeyMock).toHaveBeenCalled();
    });

    const called = registerMainKeyMock.mock.calls[0][0];
    const url = extractUrl(called);

    expect(url.searchParams.get('exclude')).toBe('event-1,event-3');
  });

  it('includes viewerTz in the fetch URL (ensuring cache separation by TZ)', async () => {
    const payload = createInitialPayload(['e-1', 'e-2']);

    renderHookWithProviders(() => useHomeMainEventList(payload));
    await flushMicrotasks();
    flushRaf();

    await waitFor(() => {
      expect(registerMainKeyMock).toHaveBeenCalled();
    });
    const called = registerMainKeyMock.mock.calls[0][0];
    const url = extractUrl(called);

    // Assert TZ param is present
    expect(url.searchParams.get('viewTz')).toBe('UTC');
  });

  it('treats paid/free as an active filter and sends it in the fetch URL', async () => {
    const payload = createInitialPayload(['paid-1', 'paid-2']);
    updateSearchParams({ paid: 'free' });

    const { result } = renderHookWithProviders(() => useHomeMainEventList(payload));
    await flushMicrotasks();
    flushRaf();

    await waitFor(() => {
      expect(registerMainKeyMock).toHaveBeenCalled();
    });

    const called = registerMainKeyMock.mock.calls[0][0];
    const url = extractUrl(called);

    expect(url.searchParams.get('paid')).toBe('free');
    expect(result.current.isAnyFilterActive).toBe(true);
  });

  it('registers the main list key on mount and unregisters it on unmount', () => {
    const payload = createInitialPayload(['a', 'b', 'c']);

    const { unmount } = renderHookWithProviders(() => useHomeMainEventList(payload));

    // It should register exactly once
    expect(registerMainKeyMock).toHaveBeenCalledTimes(1);
    const registeredKey = registerMainKeyMock.mock.calls[0][0];
    expect(typeof registeredKey).toBe('string');
    expect(registeredKey.length).toBeGreaterThan(0);

    // On unmount, it should unregister with the same key
    unmount();
    expect(unregisterMainKeyMock).toHaveBeenCalledTimes(1);
    expect(unregisterMainKeyMock).toHaveBeenCalledWith(registeredKey);
  });

  it('merges SSR excludeFromMainListIds with upcoming list and sends a sorted exclude', async () => {
    // Seed upcoming list with two ids
    upcomingList = ['ssr-2', 'up-1'];

    // SSR payload excludes another id
    const base = createInitialPayload(['keep-1', 'keep-2']);
    const payload = {
      ...base,
      excludeFromMainListIds: ['ssr-1'],
    };

    renderHookWithProviders(() => useHomeMainEventList(payload));
    await flushMicrotasks();
    flushRaf();

    await waitFor(() => {
      expect(registerMainKeyMock).toHaveBeenCalled();
    });

    // Can register more than once: SSR-excludes can only exist on the first render
    const excludes = registerMainKeyMock.mock.calls
      .map((c) => extractUrl(c[0] as string).searchParams.get('exclude'))
      .filter(Boolean);

      expect(excludes).toContain('ssr-1,ssr-2,up-1');
  });
});
