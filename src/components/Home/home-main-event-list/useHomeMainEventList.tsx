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
import type {
  PaginatedApiResponse,
  PaginatedSuccess,
} from "@/types/api";

/* ---------------------------------------------------------------------- */
/*  Types                                                                 */
/* ---------------------------------------------------------------------- */
type ApiEventResponse = PaginatedApiResponse<EventWithCreatorAndRsvps>;
type ApiEventSuccess  = PaginatedSuccess<EventWithCreatorAndRsvps>;

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
    const message =
      json && !json.success ? json.error : `HTTP ${res.status}`;
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
    window.requestIdleCallback(idleCb, { timeout: 1500 });
  } else {
    setTimeout(cb, 0);
  }
};

/* ---------------------------------------------------------------------- */
/*  Hook                                                                  */
/* ---------------------------------------------------------------------- */
export function useHomeMainEventList(initialEventsPayload: HomeMainInitialPayload): UseHomeMainEventListResult {
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
  const progressiveSigRef = useRef<string | null>(null);

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
  const seedTotalPages = useMemo(
    () => Math.max(1, metaTotalPagesSeed ?? 1),
    [metaTotalPagesSeed]
  );

  /* ---------------------------- Store writers ------------------------- */
  const { upsertEvents, setSearchPage } = useStoreWriters();
  const { registerMainListKey, unregisterMainListKey } = useMainListSWRKeys();

  /* ------------------------------ URL filters ------------------------- */
  const params = useSearchParams();
  const urlSearch   = params.get('search')   || '';
  const urlCategory = params.get('category') || '';
  const urlLocation = params.get('location') || '';
  const urlCreator  = params.get('creator')  || '';
  const urlDate     = params.get('date')     || '';

  const filters: SearchbarFilters = useMemo(
    () => ({ search: urlSearch, category: urlCategory, location: urlLocation, creator: urlCreator, date: urlDate }),
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
  }, [urlSearch, urlCategory, urlLocation, urlCreator, urlDate]);

  
  /* -------------------------- Exclusions (Upcoming) ------------------- */
  const isAnyFilterActive = !!(urlSearch || urlCategory || urlLocation || urlCreator || urlDate);

  const { ids: visibleIds,   meta: visibleMeta,   hasPage: hasVisible   } = useSearchPage(searchKey, visiblePage);
  const { meta: requestedMeta, hasPage: hasRequested } = useSearchPage(searchKey, currentPage);

  const useFallback =
    currentPage === 1 &&
    !isAnyFilterActive &&
    Boolean(initialEventsPayload?.data?.length);

  const swrFallback = useMemo<ApiEventSuccess | undefined>(() => {
    if (!useFallback) return undefined;

    return {
      success: true,
      data: initialEventsPayload.data,
      metadata: initialEventsPayload.metadata,
    };
  }, [
    useFallback,
    initialEventsPayload.data,
    initialEventsPayload.metadata,
  ]);

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

  const shouldSkipRevalidateOnMount = !isAnyFilterActive && currentPage === 1 && hasRequested;

  const { error, isLoading, isValidating } = useSWR<ApiEventSuccess>(apiUrl, fetcher, {
    fallbackData: swrFallback,
    keepPreviousData: false,
    revalidateOnMount: !shouldSkipRevalidateOnMount,
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    onSuccess: (res, key) => {
      // res es success-only
      const arr = res.data ?? [];
      if (arr.length) upsertEvents(arr);

      const ids = arr.map(e => e.id);
      const requestedPage = extractPageFromKey(key) ?? currentPage;

      const safeEP = res.metadata.eventsPerPage ?? PAGE_SIZE_MAIN;
      const safeTE = res.metadata.totalEvents ?? ids.length;
      const safeTP = Math.max(1, Math.ceil(safeTE / safeEP));

      setSearchPage(searchKey, requestedPage, ids, {
        totalEvents:  safeTE,
        totalPages:   safeTP,
        currentPage:  requestedPage,
        eventsPerPage:safeEP,
      });

      if (requestedPage === currentPage) {
        requestAnimationFrame(() => setVisiblePage(currentPage));
      }
    },
  });

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
    if (!useFallback) { hydratedKeyRef.current = null; return; }
    if (hydratedKeyRef.current === searchKey) return;

    const initial = initialEventsPayload;
    const arr = initial?.data ?? [];
    if (arr.length) {
      upsertEvents(arr);

      const ids = arr.map((e) => e.id);
      const safeEP = initial.metadata.eventsPerPage ?? PAGE_SIZE_MAIN;
      const safeTE = initial.metadata.totalEvents   ?? ids.length;
      const safeTP = Math.max(1, Math.ceil(safeTE / safeEP));

      setSearchPage(searchKey, 1, ids, {
        totalEvents:  safeTE,
        totalPages:   safeTP,
        currentPage:  1,
        eventsPerPage:safeEP,
      });

      hydratedKeyRef.current = searchKey;
    }
  }, [useFallback, searchKey, initialEventsPayload, upsertEvents, setSearchPage]);

  /* ---------------------- Initial prefetch (2..5) --------------------- */
  useEffect(() => {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    if (nav.connection?.saveData) return;
    if (isAnyFilterActive) return;
    if (!seedDataLength) return;
    if (currentPage !== 1) return;
    if (!viewerTz) return;

    const stickyArr = Array.from(stickyUpcomingRef.current);
    const prefetchExcludeIds =
      (stickyArr.length ? stickyArr : initialEventsPayload.excludeFromMainListIds).slice().sort();
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
        await Promise.all(
          pages.map(async (page) => {
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
            const safeEP = res.metadata.eventsPerPage ?? PAGE_SIZE_MAIN;
            const safeTE = res.metadata.totalEvents ?? ids.length;
            const safeTP = Math.max(1, Math.ceil(safeTE / safeEP));

            setSearchPage(searchKey, page, ids, {
              totalEvents:   safeTE,
              totalPages:    safeTP,
              currentPage:   page,
              eventsPerPage: safeEP,
            });

            await (globalMutate as GlobalMutate)(url, res, { revalidate: false });
          })
        );

        // mark initial prefetched window (up to 5 or up to totalPages)
        prefetchedMaxRef.current = maxPage;
        progressiveSigRef.current = `${searchKey}|${prefetchExcludeKey}|${viewerTz ?? 'no-tz'}`;
      } catch {
        /* best effort */
      }
    };

    scheduleIdle(() => { void run(); });
    return () => { cancelled = true; };
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

  const pagePending =
    currentPage !== visiblePage &&
    !hasRequested &&
    !(currentPage === 1 && useFallback);

  /* ---------------- Progressive prefetch (6..10, …) ------------------- */
  useEffect(() => {
    // Only on HOME (no filters) and having at least the seed
    if (isAnyFilterActive) return;
    if (!seedDataLength) return;
    if (!viewerTz) return;

    // If filters/TZ/exclusions change, reset window signature
    const stickyArr = Array.from(stickyUpcomingRef.current);
    const excludeForPrefetch = (stickyArr.length ? stickyArr : initialEventsPayload.excludeFromMainListIds)
      .slice().sort();
    const exclKey = excludeForPrefetch.join(',');
    const curSig = `${searchKey}|${exclKey}|${viewerTz ?? 'no-tz'}`;

    if (progressiveSigRef.current !== curSig) {
      // signature changed: reset (but keep at least the initial if it already ran)
      prefetchedMaxRef.current = Math.max(prefetchedMaxRef.current, 5);
      progressiveSigRef.current = curSig;
    }

    // Do not prefetch if the visible page is still “settling”
    if (pagePending) return;
    if (!animSettledRef.current) return;

    const THRESHOLD = 2;   // “within 2 pages of the window edge”
    const CHUNK     = 5;   // fetch 5 more pages (e.g., 6..10)
    const currentMax = prefetchedMaxRef.current;

    // Prefer totalPages from visible/requested meta; otherwise from SSR p1
    const totalPagesFromMeta =
      (visibleMeta?.totalPages ?? requestedMeta?.totalPages ?? seedTotalPages);

    // Trigger when we’re close to the current window edge
    if (currentPage >= currentMax - THRESHOLD && currentMax < totalPagesFromMeta) {
      let cancelled = false;

      const nextStart = currentMax + 1;
      const nextEnd   = Math.min(currentMax + CHUNK, totalPagesFromMeta);
      if (nextStart > nextEnd) return;

      const pages = Array.from({ length: nextEnd - nextStart + 1 }, (_, i) => nextStart + i);

      const run = async () => {
        try {
          await Promise.all(
            pages.map(async (page) => {
              const qs = buildPaginatedEventsURL({
                page,
                limit: PAGE_SIZE_MAIN,
                filters,
                viewTz: viewerTz,
                excludeIds: excludeForPrefetch,
              });
              const url = swrKeys.events(qs);
              const res = await fetcher(url);
              if (cancelled) return;

              const arr = res.data ?? [];
              if (arr.length) upsertEvents(arr);

              const ids = arr.map((e) => e.id);
              const safeEP = res.metadata.eventsPerPage ?? PAGE_SIZE_MAIN;
              const safeTE = res.metadata.totalEvents ?? ids.length;
              const safeTP = Math.max(1, Math.ceil(safeTE / safeEP));

              setSearchPage(searchKey, page, ids, {
                totalEvents:   safeTE,
                totalPages:    safeTP,
                currentPage:   page,
                eventsPerPage: safeEP,
              });

              await (globalMutate as GlobalMutate)(url, res, { revalidate: false });
            })
          );

          prefetchedMaxRef.current = nextEnd; // advance the window
        } catch {
          /* best effort */
        }
      };

      scheduleIdle(() => { void run(); });
      return () => { cancelled = true; };
    }
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

  const events = hasVisible
    ? eventsFromStore
    : (canUseSSRSeed ? (initialEventsPayload?.data ?? []) : []);

  // Meta for UI
  const displayMeta =
    visibleMeta ??
    requestedMeta ??
    initialEventsPayload?.metadata;

  const totalPagesFromMeta =
    displayMeta?.totalPages ??
    Math.max(
      1,
      Math.ceil(
        (displayMeta?.totalEvents ?? events.length) /
        (displayMeta?.eventsPerPage ?? PAGE_SIZE_MAIN)
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

  // Smooth scroll only if triggered by the pagination buttons
  useEffect(() => {
    if (!userPagingRef.current) return;
    if (pagePending) return;
    const el = listTopRef.current;
    if (!el) { userPagingRef.current = false; return; }

    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
      userPagingRef.current = false;
    });
  }, [visiblePage, pagePending]);

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
    uiPage,           // re-measure when visible page changes
    events.length,    // re-measure if dataset length changes
    setActiveIndex,   // stable setter, included to satisfy lints
    cardRefs          // stable ref object; current is read inside rAF
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
      }
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
  };
}
