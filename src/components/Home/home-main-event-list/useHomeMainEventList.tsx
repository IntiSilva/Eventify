'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { swrKeys, buildPaginatedEventsURL, buildSearchKey } from '@/lib/swrKeys';
import { useViewerTz } from '@/contexts/ViewerTzContext';
import { useSearchParams } from 'next/navigation';
import { useMediaQuery } from '@/lib/hooks';
import { useMenu } from '@/contexts/MenuContext';
import { useMotionValue, type MotionValue } from 'motion/react';

import { patchEventEverywhere, type GlobalMutate } from '@/lib/mutateHelpers';
import {
  useStoreWriters,
  useSearchPage,
  useEventsByIds,
  useList,
  useMainListSWRKeys,
} from '@/contexts/EventsContext';

import { PAGE_SIZE_MAIN } from '@/lib/constants';
import type { EventWithCreatorAndRsvps } from '@/types/event';
import type { SearchbarFilters } from '@/components/Searchbar/Searchbar';
import type { HomePageData } from '@/lib/data';
import type { PaginatedApiResponse, PaginatedSuccess } from '@/types/api';

/* ---------------------------------------------------------------------- */
/*  Types                                                                 */
/* ---------------------------------------------------------------------- */
type ApiEventResponse = PaginatedApiResponse<EventWithCreatorAndRsvps>;
type ApiEventSuccess = PaginatedSuccess<EventWithCreatorAndRsvps>;

export type HomeMainInitialPayload = HomePageData['initialMainListPayload'];

export type UseHomeMainEventListResult = {
  /* UI data */
  events: EventWithCreatorAndRsvps[];
  uiPage: number;
  uiTotalPages: number;
  pagePending: boolean;
  isLoading: boolean;
  isValidating: boolean;
  error: Error | undefined;

  /* layout / cards */
  isDesktop: boolean;
  smoothX: MotionValue;
  cardRefs: React.RefObject<(HTMLDivElement | null)[]>;
  listTopRef: React.RefObject<HTMLDivElement | null>;
  activeIndex: number | null;
  setActiveIndex: React.Dispatch<React.SetStateAction<number | null>>;
  viewportWidth: number;

  /* actions */
  handleNextPage: () => void;
  handlePreviousPage: () => void;
  handleDetailsClick: (evt: EventWithCreatorAndRsvps) => void;
  markPageAnimating: () => void;
  markPageSettled: () => void;

  /* helpers / state */
  updatingIds: Set<string>;
  popDistance: number;
  cardTotalWidth: number;
  cardWidth: number;
  rotationFactor: number;
  activeZoneHalfWidth: number;

  isAnyFilterActive: boolean;
};

/* ---------------------------------------------------------------------- */
/*  Helpers                                                               */
/* ---------------------------------------------------------------------- */

async function fetcher(key: string): Promise<ApiEventSuccess> {
  const res = await fetch(key, { cache: 'no-store' });

  let json: ApiEventResponse | null = null;
  try {
    json = (await res.json()) as ApiEventResponse;
  } catch {
    // non-json edge case
  }

  if (!res.ok || !json || !json.success) {
    const message = json && !json.success ? json.error : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return json; // success:true, data, metadata
}

const extractPageFromKey = (key: unknown): number | null => {
  if (typeof key !== 'string') return null;
  const i = key.indexOf('?');
  if (i < 0) return null;
  const qs = new URLSearchParams(key.slice(i + 1));
  const n = Number(qs.get('page') || '');
  return Number.isFinite(n) && n > 0 ? n : null;
};

const scheduleIdle = (cb: () => void) => {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const idleCb: IdleRequestCallback = () => cb();
    window.requestIdleCallback(idleCb, { timeout: 1200 });
  } else {
    setTimeout(cb, 0);
  }
};

const schedulePrefetch = (urgent: boolean, cb: () => void) => {
  if (urgent) {
    // If the user is paging fast, don't wait for idle time
    setTimeout(cb, 0);
    return;
  }
  scheduleIdle(cb);
};

/* ---------------------------------------------------------------------- */
/*  Hook                                                                  */
/* ---------------------------------------------------------------------- */
export function useHomeMainEventList(
  initialEventsPayload: HomeMainInitialPayload,
  scrollTopAnchorRef?: { current: HTMLElement | null }
): UseHomeMainEventListResult {
  /* ------------------------------- Local ------------------------------ */
  const [currentPage, setCurrentPage] = useState(1);
  const [visiblePage, setVisiblePage] = useState(1);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth || 1 : 1
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let raf = 0;
    const onResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setViewportWidth(window.innerWidth || 1);
        raf = 0;
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const listTopRef = useRef<HTMLDivElement>(null);
  const userPagingRef = useRef(false);
  const prefetchSigRef = useRef<string | null>(null);

  // Progressive prefetch window tracking
  const prefetchedMaxRef = useRef<number>(1); // highest page currently prefetched for the “HOME” window

  // Progressive prefetch control (prevents cancellation on rapid paging)
  const progressiveRef = useRef<{
    sig: string | null;
    epoch: number; // increments when signature changes
    running: boolean; // only one progressive job at a time
    plannedMax: number; // “reserved” window end (prevents re-trigger spam)
  }>({
    sig: null,
    epoch: 0,
    running: false,
    plannedMax: 1,
  });

  const isDesktop = useMediaQuery('(min-width: 768px)');
  const { open: openMenu } = useMenu();
  const { viewerTz } = useViewerTz();
  const { mutate: globalMutate } = useSWRConfig();

  // Cards layout
  const smoothX = useMotionValue(0);
  const cardWidth = 350;
  const cardGap = 20;
  const cardTotalWidth = cardWidth + cardGap;
  const activeZoneHalfWidth = 0;
  const rotationFactor = 0;
  const popDistance = isDesktop ? 40 : 35;

  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Animation settle signals to coordinate with progressive prefetch
  const animSettledRef = useRef(true);
  const markPageAnimating = () => {
    animSettledRef.current = false;
  };
  const markPageSettled = () => {
    animSettledRef.current = true;
  };

  const seedDataLength = useMemo(
    () => initialEventsPayload?.data?.length ?? 0,
    [initialEventsPayload?.data?.length]
  );

  const metaTotalPagesSeed = initialEventsPayload?.metadata?.totalPages;
  const seedTotalPages = useMemo(() => Math.max(1, metaTotalPagesSeed ?? 1), [metaTotalPagesSeed]);

  /* ---------------------------- Store writers ------------------------- */
  const { upsertEvents, setSearchPage, touchSearchPage } = useStoreWriters();
  const { registerMainListKey, unregisterMainListKey } = useMainListSWRKeys();

  /* ------------------------------ URL filters ------------------------- */
  const params = useSearchParams();
  const urlSearch = params.get('search') || '';
  const urlCategory = params.get('category') || '';
  const urlLocation = params.get('location') || '';
  const urlCreator = params.get('creator') || '';
  const urlDate = params.get('date') || '';

  const filters: SearchbarFilters = useMemo(
    () => ({
      search: urlSearch,
      category: urlCategory,
      location: urlLocation,
      creator: urlCreator,
      date: urlDate,
    }),
    [urlSearch, urlCategory, urlLocation, urlCreator, urlDate]
  );

  const searchKey = useMemo(() => buildSearchKey(filters, viewerTz), [filters, viewerTz]);

  // Reset page when filters change
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setCurrentPage(1);
      setVisiblePage(1);
    });
    return () => cancelAnimationFrame(id);
  }, [searchKey]);

  /* -------------------------- Exclusions (Upcoming) ------------------- */
  const isAnyFilterActive = !!(urlSearch || urlCategory || urlLocation || urlCreator || urlDate);

  const { ids: visibleIds, meta: visibleMeta, hasPage: hasVisible } = useSearchPage(
    searchKey,
    visiblePage
  );
  const { meta: requestedMeta, hasPage: hasRequested } = useSearchPage(searchKey, currentPage);

  useEffect(() => {
    // Only when we truly have that visible page in the store
    if (!hasVisible) return;

    // Key rule: don’t touch/trim while we’re in transition,
    // because visiblePage is still the “old” page and could prune what we’re fetching.
    if (currentPage !== visiblePage) return;

    touchSearchPage(searchKey, visiblePage);
  }, [hasVisible, currentPage, searchKey, visiblePage, touchSearchPage]);

  const useFallback =
    currentPage === 1 && !isAnyFilterActive && Boolean(initialEventsPayload?.data?.length);

  const swrFallback = useMemo<ApiEventSuccess | undefined>(() => {
    if (!useFallback) return undefined;

    return {
      success: true,
      data: initialEventsPayload.data,
      metadata: initialEventsPayload.metadata,
    };
  }, [useFallback, initialEventsPayload.data, initialEventsPayload.metadata]);

  const includeSSRExclusions = useFallback && !hasVisible && currentPage === 1;

  const upcomingIds = useList('upcoming');
  const stickyUpcomingRef = useRef<Set<string>>(new Set());
  const upcomingIdsKey = useMemo(() => (upcomingIds ?? []).join(','), [upcomingIds]);

  useEffect(() => {
    if (upcomingIds && upcomingIds.length) {
      stickyUpcomingRef.current = new Set(upcomingIds);
    }
  }, [upcomingIds, upcomingIdsKey]);

  const ssrExcludeIds = initialEventsPayload.excludeFromMainListIds;
  const ssrUpcomingSet = useMemo(() => new Set(ssrExcludeIds), [ssrExcludeIds]);

  const excludeIds = useMemo<string[]>(() => {
    if (isAnyFilterActive) return [];
    const set = new Set<string>();
    (upcomingIds ?? []).forEach((id) => set.add(id));
    if (includeSSRExclusions) {
      ssrUpcomingSet.forEach((id) => set.add(id));
    }
    return Array.from(set).sort();
  }, [isAnyFilterActive, upcomingIds, includeSSRExclusions, ssrUpcomingSet]);

  /* ------------------------- SWR key / fetch -------------------------- */
  const apiUrl = useMemo(() => {
    const qs = buildPaginatedEventsURL({
      page: currentPage,
      limit: PAGE_SIZE_MAIN,
      filters,
      viewTz: viewerTz,
      excludeIds,
    });
    return swrKeys.events(qs);
  }, [currentPage, filters, viewerTz, excludeIds]);

  useEffect(() => {
    if (!apiUrl) return;
    registerMainListKey(apiUrl);
    return () => unregisterMainListKey(apiUrl);
  }, [apiUrl, registerMainListKey, unregisterMainListKey]);

  // If we have a usable SSR seed for page 1 (HOME mode), don't revalidate on mount.
  // This prevents an extra CSR fetch on initial load when SSR payload is already present.
  const hasSsrSeedForPage1 = useFallback && Boolean(swrFallback);

  const shouldSkipRevalidateOnMount = hasSsrSeedForPage1 || hasRequested;

  const { data: swrData, error, isLoading, isValidating } = useSWR<ApiEventSuccess>(apiUrl, fetcher, {
    fallbackData: swrFallback,
    keepPreviousData: false,
    revalidateOnMount: !shouldSkipRevalidateOnMount,
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    onSuccess: (res, key) => {
      // res is success-only
      const arr = res.data ?? [];
      if (arr.length) upsertEvents(arr);

      const ids = arr.map((e) => e.id);
      const requestedPage = extractPageFromKey(key) ?? currentPage;

      const safeEP = res.metadata.eventsPerPage ?? PAGE_SIZE_MAIN;
      const safeTE = res.metadata.totalEvents ?? ids.length;
      const safeTP = Math.max(1, Math.ceil(safeTE / safeEP));

      setSearchPage(
        searchKey,
        requestedPage,
        ids,
        {
          totalEvents: safeTE,
          totalPages: safeTP,
          currentPage: requestedPage,
          eventsPerPage: safeEP,
        },
        { touch: 'front', anchorPage: requestedPage }
      );

      if (requestedPage === currentPage) {
        requestAnimationFrame(() => setVisiblePage(currentPage));
      }
    },
  });

  useEffect(() => {
    // Page 1 SSR: you already seed it in the hydration effect below; avoid duplicating work.
    if (currentPage === 1 && useFallback) return;

    // If it's already in the store, we're done.
    if (hasRequested) return;

    // If SWR doesn't have data yet, we can't seed.
    const arr = swrData?.data ?? [];
    if (!arr.length) return;

    // Key case:
    // SWR gave us data (possibly a cache hit) but the Context doesn't have that page yet.
    upsertEvents(arr);

    const ids = arr.map((e) => e.id);

    const safeEP = swrData!.metadata.eventsPerPage ?? PAGE_SIZE_MAIN;
    const safeTE = swrData!.metadata.totalEvents ?? ids.length;
    const safeTP = Math.max(1, Math.ceil(safeTE / safeEP));

    setSearchPage(
      searchKey,
      currentPage,
      ids,
      {
        totalEvents: safeTE,
        totalPages: safeTP,
        currentPage,
        eventsPerPage: safeEP,
      },
      { touch: 'front', anchorPage: currentPage }
    );
  }, [currentPage, useFallback, hasRequested, swrData, searchKey, upsertEvents, setSearchPage]);

  // Switch visible page when the requested one is already in the store (prefetch/SSR/cache)
  useEffect(() => {
    if (visiblePage === currentPage || !hasRequested) return;

    const next = currentPage;
    const run = () => setVisiblePage(next);

    if (typeof queueMicrotask === 'function') {
      queueMicrotask(run);
    } else {
      Promise.resolve().then(run);
    }
  }, [visiblePage, currentPage, hasRequested]);

  /* --------------------- SSR hydration (p1 fallback) ------------------ */
  const hydratedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!useFallback) {
      hydratedKeyRef.current = null;
      return;
    }
    if (hydratedKeyRef.current === searchKey) return;

    const initial = initialEventsPayload;
    const arr = initial?.data ?? [];
    if (arr.length) {
      upsertEvents(arr);

      const ids = arr.map((e) => e.id);
      const safeEP = initial.metadata.eventsPerPage ?? PAGE_SIZE_MAIN;
      const safeTE = initial.metadata.totalEvents ?? ids.length;
      const safeTP = Math.max(1, Math.ceil(safeTE / safeEP));

      setSearchPage(
        searchKey,
        1,
        ids,
        {
          totalEvents: safeTE,
          totalPages: safeTP,
          currentPage: 1,
          eventsPerPage: safeEP,
        },
        { touch: 'front', anchorPage: 1 }
      );

      hydratedKeyRef.current = searchKey;
    }
  }, [useFallback, searchKey, initialEventsPayload, upsertEvents, setSearchPage]);

  /* ---------------------- Initial prefetch (2..5) --------------------- */
  useEffect(() => {
    if (navigator.connection?.saveData) return;
    if (isAnyFilterActive) return;
    if (!seedDataLength) return;
    if (currentPage !== 1) return;
    if (!viewerTz) return;

    const stickyArr = Array.from(stickyUpcomingRef.current);
    const prefetchExcludeIds = (
      stickyArr.length ? stickyArr : initialEventsPayload.excludeFromMainListIds
    )
      .slice()
      .sort();
    const prefetchExcludeKey = prefetchExcludeIds.join(',');

    const initialTotalPages = seedTotalPages;
    const sig = `${searchKey}|${prefetchExcludeKey}|${viewerTz ?? 'no-tz'}|${initialTotalPages}`;
    if (prefetchSigRef.current === sig) return;
    prefetchSigRef.current = sig;

    const PREFETCH_TO = 5;
    const maxPage = Math.min(PREFETCH_TO, initialTotalPages);
    if (maxPage <= 1) return;

    const pages = Array.from({ length: maxPage - 1 }, (_, i) => i + 2);
    let cancelled = false;

    const run = async () => {
      try {
        const CONCURRENCY = 2;
        let idx = 0;

        const worker = async () => {
          while (!cancelled && idx < pages.length) {
            const page = pages[idx++];

            const qs = buildPaginatedEventsURL({
              page,
              limit: PAGE_SIZE_MAIN,
              filters,
              viewTz: viewerTz,
              excludeIds: prefetchExcludeIds,
            });
            const url = swrKeys.events(qs);
            const res = await fetcher(url);
            if (cancelled) return;

            const arr = res.data ?? [];
            if (arr.length) upsertEvents(arr);

            const ids = arr.map((e) => e.id);

            setSearchPage(searchKey, page, ids, undefined, { touch: 'back' });

            await (globalMutate as GlobalMutate)(url, res, { revalidate: false });
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, pages.length) }, () => worker())
        );

        // Mark initial prefetched window (up to 5 or up to totalPages)
        prefetchedMaxRef.current = maxPage;

        // Keep progressive signature in sync with the exclusions that were prefetched.
        progressiveRef.current.sig = `${searchKey}|${prefetchExcludeKey}|${viewerTz ?? 'no-tz'}`;
      } catch {
        /* best effort */
      }
    };

    schedulePrefetch(false, () => {
      void run();
    });
    return () => {
      cancelled = true;
    };
  }, [
    isAnyFilterActive,
    initialEventsPayload.excludeFromMainListIds,
    currentPage,
    viewerTz,
    filters,
    searchKey,
    seedDataLength,
    seedTotalPages,
    upsertEvents,
    setSearchPage,
    globalMutate,
  ]);

  const pagePending = currentPage !== visiblePage && !hasRequested && !(currentPage === 1 && useFallback);

  /* ---------------- Progressive prefetch (6..10, …) ------------------- */
  useEffect(() => {
    if (isAnyFilterActive) return;
    if (!seedDataLength) return;
    if (!viewerTz) return;

    // Build signature (filters/TZ/exclusions)
    const stickyArr = Array.from(stickyUpcomingRef.current);
    const excludeForPrefetch = (stickyArr.length
      ? stickyArr
      : initialEventsPayload.excludeFromMainListIds
    )
      .slice()
      .sort();

    const exclKey = excludeForPrefetch.join(',');
    const curSig = `${searchKey}|${exclKey}|${viewerTz ?? 'no-tz'}`;

    if (progressiveRef.current.sig !== curSig) {
      progressiveRef.current.sig = curSig;

      // Invalidate any in-flight job from old signature
      progressiveRef.current.epoch += 1;
      progressiveRef.current.running = false;

      // Keep at least the initial window
      prefetchedMaxRef.current = Math.max(prefetchedMaxRef.current, 5);
      progressiveRef.current.plannedMax = prefetchedMaxRef.current;
    }

    // Prefer totalPages from meta; fallback to SSR total
    const totalPagesFromMeta = visibleMeta?.totalPages ?? requestedMeta?.totalPages ?? seedTotalPages;

    // IMPORTANT: use "effective" max so we don't re-trigger while a job is scheduled/running
    const effectiveMax = Math.max(prefetchedMaxRef.current, progressiveRef.current.plannedMax);

    // Tuning knobs:
    const THRESHOLD = 3; // 3 => triggers at 7 when effectiveMax=10 (7..)
    const CHUNK = 5; // fetch 5 more pages (e.g., 11..15)

    // "Urgent" when the user is actively paging (don't wait for animations/idle)
    const urgent = userPagingRef.current;

    // Keep the “don’t compete with animations” policy ONLY when not urgent
    if (!urgent) {
      if (pagePending) return;
      if (!animSettledRef.current) return;
    }

    if (effectiveMax >= totalPagesFromMeta) return;

    // Trigger when we’re close to the window edge
    if (currentPage < effectiveMax - THRESHOLD) return;

    // Only one progressive job at a time
    if (progressiveRef.current.running) return;

    const nextStart = effectiveMax + 1;
    const nextEnd = Math.min(effectiveMax + CHUNK, totalPagesFromMeta);
    if (nextStart > nextEnd) return;

    // Reserve the window immediately so rapid paging doesn't re-trigger
    progressiveRef.current.plannedMax = nextEnd;
    progressiveRef.current.running = true;

    const epoch = progressiveRef.current.epoch;
    const pages = Array.from({ length: nextEnd - nextStart + 1 }, (_, i) => nextStart + i);

    schedulePrefetch(urgent, () => {
      void (async () => {
        try {
          const CONCURRENCY = 2;
          let idx = 0;

          const worker = async () => {
            while (idx < pages.length) {
              // Stop if signature changed mid-flight
              if (progressiveRef.current.epoch !== epoch) return;

              const page = pages[idx++];

              const qs = buildPaginatedEventsURL({
                page,
                limit: PAGE_SIZE_MAIN,
                filters,
                viewTz: viewerTz,
                excludeIds: excludeForPrefetch,
              });

              const url = swrKeys.events(qs);
              const res = await fetcher(url);

              if (progressiveRef.current.epoch !== epoch) return;

              const arr = res.data ?? [];
              if (arr.length) upsertEvents(arr);

              const ids = arr.map((e) => e.id);

              // IMPORTANT: keep prefetched pages from pushing out the active ones
              setSearchPage(searchKey, page, ids, undefined, { touch: 'back' });

              await (globalMutate as GlobalMutate)(url, res, { revalidate: false });
            }
          };

          await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, pages.length) }, () => worker())
          );

          if (progressiveRef.current.epoch !== epoch) return;

          // Advance the window only when job completes
          prefetchedMaxRef.current = nextEnd;
        } catch {
          /* best effort */
        } finally {
          // Only release if still same epoch
          if (progressiveRef.current.epoch === epoch) {
            progressiveRef.current.running = false;
          }
        }
      })();
    });
  }, [
    isAnyFilterActive,
    initialEventsPayload.excludeFromMainListIds,
    viewerTz,
    filters,
    searchKey,
    currentPage,
    visibleMeta?.totalPages,
    requestedMeta?.totalPages,
    seedDataLength,
    seedTotalPages,
    upsertEvents,
    setSearchPage,
    globalMutate,
    pagePending,
  ]);

  /* ----------------------------- Read store --------------------------- */
  const eventsFromStore = useEventsByIds(visibleIds);
  const canUseSSRSeed = useFallback && !hasVisible;

  const events = hasVisible ? eventsFromStore : canUseSSRSeed ? initialEventsPayload?.data ?? [] : [];

  // Meta for UI
  const displayMeta = visibleMeta ?? requestedMeta ?? initialEventsPayload?.metadata;

  const totalPagesFromMeta =
    displayMeta?.totalPages ??
    Math.max(
      1,
      Math.ceil(
        (displayMeta?.totalEvents ?? events.length) / (displayMeta?.eventsPerPage ?? PAGE_SIZE_MAIN)
      )
    );

  const uiPage = visiblePage;
  const uiTotalPages = totalPagesFromMeta;

  // Clamp if totalPages drops
  useEffect(() => {
    if (!totalPagesFromMeta) return;
    if (visiblePage > totalPagesFromMeta || currentPage > totalPagesFromMeta) {
      const id = requestAnimationFrame(() => {
        if (visiblePage > totalPagesFromMeta) setVisiblePage(totalPagesFromMeta);
        if (currentPage > totalPagesFromMeta) setCurrentPage(totalPagesFromMeta);
      });
      return () => cancelAnimationFrame(id);
    }
  }, [totalPagesFromMeta, visiblePage, currentPage]);

  // Smooth scroll only if triggered by the pagination buttons.
  // On mobile + search/filters, scroll to the stable anchor above SearchResultsTitle (passed from the wrapper).
  useEffect(() => {
    if (!userPagingRef.current) return;
    if (pagePending) return;

    const isMobileSearch = !isDesktop && isAnyFilterActive && Boolean(scrollTopAnchorRef?.current);
    const target = isMobileSearch ? scrollTopAnchorRef!.current : listTopRef.current;

    if (!target) {
      userPagingRef.current = false;
      return;
    }

    // Desktop (or no filters): keep the existing behavior
    if (!isMobileSearch) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        userPagingRef.current = false;
      });
      return;
    }

    // Mobile + filters: defer slightly so layout settles (title wrap / address bar / fonts).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
          userPagingRef.current = false;
        }, 90);
      });
    });
  }, [visiblePage, pagePending, isDesktop, isAnyFilterActive, scrollTopAnchorRef]);

  // Viewport-driven "active card" for mobile: pick the item closest to screen center on scroll/resize
  useEffect(() => {
    // Desktop doesn't use scroll-based activation
    if (isDesktop) return;

    let raf = 0;

    const measure = () => {
      raf = 0;

      const centerY = window.innerHeight / 2;
      let bestIdx = -1;
      let bestDist = Infinity;
      let bestThreshold = 120; // soft fallback

      for (let i = 0; i < cardRefs.current.length; i++) {
        const el = cardRefs.current[i];
        if (!el) continue;

        const rect = el.getBoundingClientRect();
        const mid = (rect.top + rect.bottom) / 2;
        const dist = Math.abs(mid - centerY);

        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
          // Not strictly exact: trigger when reasonably close to center
          bestThreshold = Math.max(120, rect.height * 0.55);
        }
      }

      setActiveIndex(bestIdx !== -1 && bestDist <= bestThreshold ? bestIdx : null);
    };

    const onScrollOrResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(measure);
    };

    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);
    // Measure on mount / when page or dataset changes
    onScrollOrResize();

    return () => {
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [
    isDesktop,
    uiPage, // re-measure when visible page changes
    events.length, // re-measure if dataset length changes
    setActiveIndex, // stable setter, included to satisfy lints
    cardRefs, // stable ref object; current is read inside rAF
  ]);

  /* ------------------------------ Handlers ---------------------------- */
  const handleDetailsClick = (evt: EventWithCreatorAndRsvps) => {
    openMenu(evt.id, {
      mode: 'non-editable',
      onEventUpdate: async (updated) => {
        setUpdatingIds((prev) => new Set(prev).add(updated.id));
        upsertEvents([updated]);
        patchEventEverywhere(globalMutate as GlobalMutate, updated);
        setUpdatingIds((prev) => {
          const next = new Set(prev);
          next.delete(updated.id);
          return next;
        });
      },
    });
  };

  const handleNextPage = () => {
    if (currentPage < uiTotalPages) {
      userPagingRef.current = true;
      setCurrentPage((p) => p + 1);
    }
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      userPagingRef.current = true;
      setCurrentPage((p) => p - 1);
    }
  };

  return {
    /* UI data */
    events,
    uiPage,
    uiTotalPages,
    pagePending,
    isLoading,
    isValidating,
    error,

    /* layout / cards */
    isDesktop,
    smoothX,
    cardRefs,
    listTopRef,
    activeIndex,
    setActiveIndex,
    viewportWidth,

    /* actions */
    handleNextPage,
    handlePreviousPage,
    handleDetailsClick,
    // animation signals
    markPageAnimating,
    markPageSettled,

    /* helpers / state */
    updatingIds,
    popDistance,
    cardTotalWidth,
    cardWidth,
    rotationFactor,
    activeZoneHalfWidth,

    isAnyFilterActive,
  };
}
