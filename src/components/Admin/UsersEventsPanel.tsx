'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';

import Searchbar, { type SearchbarFilters } from '../Searchbar/Searchbar';
import SearchResultsTitle from '../AnimatedText/SearchResultsTitle';
import SimpleEventCard from '../Cards/SimpleEventCard';
import AnimatedCarouselArrow from '../LordIcons/AnimatedCarouselArrow';
import { useMenu } from '@/contexts/MenuContext';

import {
  useStoreWriters,
  useSearchPage,
  useEventsByIds,
  useBulkWarmup,
  useInvalidationWriters,
} from '@/contexts/EventsContext';

import { useMediaQuery, useConfirmedCounts } from '@/lib/hooks';
import { bloomItemVariants, gridStaggerVariants, GRID_STAGGER_OUT, ITEM_EXIT_DURATION } from '@/lib/animations';

import {
  patchEventEverywhere,
  patchEventEverywhereShallow,
  type GlobalMutate,
} from '@/lib/mutateHelpers';

import type { EditableEvent, EventWithCreatorAndRsvps } from '@/types/event';
import { RSVPStatus } from '@/generated/prisma';
import { buildAdminQS } from '@/lib/utils';
import { isApiErrorResponse, type AdminEventsResponse, type PaginatedMetadata, type EventByIdResponse } from '@/types/api';

/* =====================================================================================
 * Logging helpers and filter signature
 * ===================================================================================== */

const LOG = false;

type UepPayload =
  | { from: string; to: string } // set filters
  | { from: number; to: number; totalPages?: number; tp?: number; currentPage?: number } // pagination/settings
  | { url: string; currentPage: number; limit?: number; filters?: SearchbarFilters; searchKey?: string } // fetch start/cancel
  | { requestedPage: number; idsCount: number; meta: PaginatedMetadata } // fetch done
  | { n: number; ms: number } // exit done
  | { id: string; page: number; searchKey: string } // delete invalidate
  | { EXIT_GUARD_MS: number; pendingPage: number; currentPage: number } // exit guard
  | { rollbackTo: number } // exit guard rollback
  | { filtersSig?: string; pageSize?: number } // resets extra
  | {
      currentPage: number; readyPage: number; pendingPage: number | null;
      reqHas: boolean; visHas: boolean;
      reqMeta: PaginatedMetadata | undefined; visMeta: PaginatedMetadata | undefined;
      isExiting: boolean; exitDone: boolean; isPaginating: boolean;
      pageSize: number; searchKey: string;
    }; // state dump

const uep = (label: string, payload?: UepPayload) => {
  if (!LOG) return;
  try { console.log(`[UEP] ${label}`, payload ?? ''); }
  catch { console.log(`[UEP] ${label}`); }
};

// Stable signature to avoid resets caused only by object reference changes
function filtersSignature(f: SearchbarFilters): string {
  const p = new URLSearchParams();
  if (f.search?.trim())   p.set('search',   f.search.trim());
  if (f.category)         p.set('category', f.category);
  if (f.location?.trim()) p.set('location', f.location.trim());
  if (f.date)             p.set('date',     f.date);
  return p.toString(); // e.g.: "search=foo&date=2025-08-07"
}

/* --- Small defensive fetch in case the user opens before warm-up lands --- */
async function fetchConfirmedFull(
  id: string
): Promise<EventWithCreatorAndRsvps | null> {
  const res = await fetch(
    `/api/events/${id}?rsvpStatus=${RSVPStatus.confirmed}`,
    { cache: "no-store" }
  );

  const json = (await res.json().catch(() => null)) as EventByIdResponse | null;

  if (!res.ok || !json || isApiErrorResponse(json)) return null;

  return json.data;
}

/* =====================================================================================
 * TYPES (panel-local API)
 * ===================================================================================== */

type PageNavEvent = {
  userId: string;
  from: number;
  to: number;
  reason: 'next' | 'prev' | 'filters' | 'pagesize';
};


type ResetExtra = { filtersSig?: string; pageSize?: number };

export default function UsersEventsPanel({
  userId,
  onPageNav,
}: {
  userId: string;
  onPageNav?: (e: PageNavEvent) => void;
}) {
  /* ----------------------------------------------------------------------------- */
  /* UI & FILTER STATE                                                             */
  /* ----------------------------------------------------------------------------- */

  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  const [filters, setFilters] = useState<SearchbarFilters>({});
  const filtersSig = useMemo(() => filtersSignature(filters), [filters]);

  // Safe filters setter (won’t trigger if content didn’t change)
  const setFiltersSafe = useCallback((next: SearchbarFilters) => {
    const nextSig = filtersSignature(next);
    if (nextSig === filtersSig) return;
    uep('SET FILTERS', { from: filtersSig, to: nextSig });
    setFilters(next);
  }, [filtersSig]);

  // Pagination state machine
  const [currentPage, setCurrentPage] = useState(1);                   // requested (what I want)
  const [readyPage, setReadyPage] = useState(1);                       // visible
  const [pendingPage, setPendingPage] = useState<number | null>(null); // target
  const [isExiting, setIsExiting] = useState(false);                   // exit in progress
  const [exitDone, setExitDone] = useState(false);                     // exit finished (does not gate the swap)
  const [isPending, startTransition] = useTransition();                // React transition

  // Refs to read current state WITHOUT re-triggering effects due to deps
  const currentPageRef = useRef(currentPage);
  const readyPageRef   = useRef(readyPage);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { readyPageRef.current = readyPage; }, [readyPage]);

  const lastNavEventRef = useRef<PageNavEvent | null>(null);

  // Media / UI
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isNarrowScreen = useMediaQuery('(max-width: 390px)');
  const pageSize = isDesktop ? 8 : 6;

  // Ref for pageSize (safe reset only if it actually changes)
  const prevPageSizeRef = useRef<number>(pageSize);
  useEffect(() => { prevPageSizeRef.current = pageSize; }, [pageSize]);

  const { open: openMenu } = useMenu();

  // didMountRef: avoids re-render and is used for initial animation
  const didMountRef = useRef(false);
  useEffect(() => { didMountRef.current = true; }, []);

  // Guard for resets (avoid running on first render)
  const didMountResetRef = useRef(false);
  useEffect(() => { didMountResetRef.current = true; }, []);

  /* ----------------------------------------------------------------------------- */
  /* SEARCH KEY (namespaced by "admin" + userId)                                   */
  /* ----------------------------------------------------------------------------- */
  const searchKey = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.location) params.set('location', filters.location);
    if (filters.category) params.set('category', filters.category);
    if (filters.date) params.set('date', filters.date);
    return `admin:${userId}:${params.toString() || 'ALL'}`;
  }, [userId, filters]);

  const searchKeyRef = useRef(searchKey);
  useEffect(() => { searchKeyRef.current = searchKey; }, [searchKey]);

  /* ----------------------------------------------------------------------------- */
  /* READ CURRENT/REQUESTED PAGES FROM STORE                                       */
  /* ----------------------------------------------------------------------------- */
  const vis = useSearchPage(searchKey, readyPage);   // visible
  const req = useSearchPage(searchKey, currentPage); // requested

  // Staleness: requested page exists but with a different pageSize
  const reqIsStale = req.hasPage && ((req.meta?.eventsPerPage ?? pageSize) !== pageSize);

  const { ids: pageIds, meta } = vis;
  const eventsFromStore = useEventsByIds(pageIds);

  const entityById = useMemo(
    () => new Map(eventsFromStore.map((e) => [e.id, e] as const)),
    [eventsFromStore]
  );

  // confirmed counts per id (fallback when full entity isn’t available yet)
  const counts = useConfirmedCounts(pageIds);

  /* ----------------------------------------------------------------------------- */
  /* BULK WARM-UP: confirmed RSVPs                                                 */
  /* ----------------------------------------------------------------------------- */
  useBulkWarmup(pageIds, { rsvpStatus: RSVPStatus.confirmed });

  /* ----------------------------------------------------------------------------- */
  /* STORE WRITERS                                                                 */
  /* ----------------------------------------------------------------------------- */
  const { upsertEvents, upsertEditableEvents, setSearchPage } = useStoreWriters();
  const { invalidateSearchPage, removeEvents } = useInvalidationWriters();

  /* ----------------------------------------------------------------------------- */
  /* RESETS: helpers, filters, and pageSize -> page 1 (only if they truly change)  */
  /* ----------------------------------------------------------------------------- */

  // Invalidate page 1 of the current visible key (stable)
  const invalidatePage1 = useCallback(() => {
    invalidateSearchPage(searchKeyRef.current, 1);
  }, [invalidateSearchPage]);

  // Robust reset to page 1, with logs and onPageNav. Uses refs to read the current state.

  const resetToFirstPage = useCallback(
    (reason: 'filters' | 'pagesize', extra?: ResetExtra) => {
      const from = currentPageRef.current;
      const ready = readyPageRef.current;

      // If already at 1/1 → just invalidate and exit (no animation)
      if (from === 1 && ready === 1) {
        uep(`RESET by ${reason} (no-op nav) -> invalidate only`, extra);
        invalidatePage1();
        return;
      }

      // Save the nav event; scrolling will be done after the swap
      lastNavEventRef.current = { userId, from, to: 1, reason };
      uep(`RESET by ${reason} -> 1`, { from, to: 1, ...extra });

      setPendingPage(1);
      setIsExiting(true);
      setExitDone(false);
      startTransition(() => setCurrentPage(1));
    },
    [userId, startTransition, invalidatePage1]
  );

  // Track previous filters signature to detect a REAL CHANGE
  const prevFiltersSigRef = useRef<string>(filtersSig);
  useEffect(() => {
    // Avoid running on the first reset render
    if (!didMountResetRef.current) {
      prevFiltersSigRef.current = filtersSig;
      return;
    }

    const prev = prevFiltersSigRef.current;
    const next = filtersSig;
    if (prev === next) return; // did not actually change

    prevFiltersSigRef.current = next;

    // Centralize the reset (will perform invalidate-only if already at 1/1)
    resetToFirstPage('filters', { filtersSig: next });
  }, [filtersSig, resetToFirstPage]);

  // pageSize -> reset to 1 ONLY if the actual limit changes
  const prevPageSizeInitRef = useRef<boolean>(false);
  useEffect(() => {
    const prev = prevPageSizeRef.current;
    const next = pageSize;

    // Avoid reset on the initial render
    if (!prevPageSizeInitRef.current) {
      prevPageSizeInitRef.current = true;
      prevPageSizeRef.current = next;
      return;
    }

    if (prev === next) return; // didn’t truly change
    prevPageSizeRef.current = next;

    // are we already at 1/1?
    const wasNoOp = (currentPageRef.current === 1 && readyPageRef.current === 1);

    // Centralize the reset (if it was a no-op, it invalidates inside)
    resetToFirstPage('pagesize', { pageSize: next });

    // For pageSize, you also want to invalidate when resetting:
    if (!wasNoOp) invalidatePage1();
  }, [pageSize, resetToFirstPage, invalidatePage1]);

  /* ----------------------------------------------------------------------------- */
  /* FETCH requested page if missing or stale                                      */
  /* ----------------------------------------------------------------------------- */
  useEffect(() => {
    if (req.hasPage && !reqIsStale) return;

    const limit = pageSize;
    const url =
      `/api/admin/events/${userId}?` +
      buildAdminQS({ page: currentPage, limit, filters });

    let cancelled = false;

   (async () => {
      try {
        uep('FETCH start', { url, currentPage, limit, filters, searchKey });

        const res = await fetch(url, { cache: 'no-store' });

        // Attempt to parse JSON once.
        // If the response is HTML or invalid JSON => json will be null.
        const json = (await res.json().catch(() => null)) as AdminEventsResponse | null;

        if (cancelled) return;

        // 1) Network error, non-OK status, or non-JSON response.
        if (!res.ok || !json) {
          throw new Error(`HTTP ${res.status}`);
        }

        // 2) Logical API error: { success:false, error:string }
        if (isApiErrorResponse(json)) {
          throw new Error(json.error);
        }

        // Success: json is PaginatedSuccess<EditableEvent>
        upsertEditableEvents(json.data);

        const ids = json.data.map((e) => e.id);
        const requestedPage = currentPage;

        setSearchPage(searchKey, requestedPage, ids, {
          ...json.metadata,
          currentPage: requestedPage,
          eventsPerPage: pageSize, // used for staleness detection
        });

        uep('FETCH done -> setSearchPage', {
          requestedPage,
          idsCount: ids.length,
          meta: json.metadata,
        });
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (cancelled) return;
        uep('FETCH error', { url, currentPage });
        console.error(error);
      }
    })().catch(() => {
      // Prevent uncaught promise errors in development environments
    });



    return () => {
      cancelled = true;
      uep('FETCH cancel guard (cancelled=true) for', { url, currentPage });
    };
  }, [
    req.hasPage,
    reqIsStale,
    searchKey,
    currentPage,
    filters,
    userId,
    upsertEditableEvents,
    setSearchPage,
    pageSize,
  ]);

  /* ----------------------------------------------------------------------------- */
  /* LOADING / METADATA                                                            */
  /* ----------------------------------------------------------------------------- */
  const loading = !vis.hasPage && eventsFromStore.length === 0;
  const isPaginating = currentPage !== readyPage && !req.hasPage;

  const totalPages = vis.hasPage ? (meta?.totalPages ?? 1) : 1;
  const uiCurrent  = currentPage; // UI reflects the requested page

  /* ----------------------------------------------------------------------------- */
  /* Pagination handlers                                                            */
  /* ----------------------------------------------------------------------------- */
  const handleNextPage = () => {
    if (currentPage < totalPages) {
      const target = currentPage + 1;
      // Save the nav event; scrolling will be done after the swap
      lastNavEventRef.current = { userId, from: currentPage, to: target, reason: 'next' };
      uep('NEXT', { from: currentPage, to: target, totalPages });
      setPendingPage(target);
      setIsExiting(true);
      setExitDone(false);
      startTransition(() => setCurrentPage(target));
    }
  };
  const handlePreviousPage = () => {
    if (currentPage > 1) {
      const target = currentPage - 1;
      // Save the nav event; scrolling will be done after the swap
      lastNavEventRef.current = { userId, from: currentPage, to: target, reason: 'prev' };
      uep('PREV', { from: currentPage, to: target });
      setPendingPage(target);
      setIsExiting(true);
      setExitDone(false);
      startTransition(() => setCurrentPage(target));
    }
  };

  /* ----------------------------------------------------------------------------- */
  /* CLAMP: adjust currentPage to the visible totalPages (only when appropriate)   */
  /* ----------------------------------------------------------------------------- */
  useEffect(() => {
    if (isExiting) return;            // don’t clamp during exit
    if (pendingPage != null) return;  // nor with a pending target
    if (!vis.hasPage) return;

    const tp = meta?.totalPages ?? 1;
    if (tp && currentPage > tp) {
      uep('CLAMP currentPage -> totalPages', { from: currentPage, to: tp, tp });
      setCurrentPage(tp);
    }
  }, [
    isExiting,
    pendingPage,
    vis.hasPage,
    meta?.totalPages,
    currentPage,
  ]);

  /* ----------------------------------------------------------------------------- */
  /* Exit timer (animations only; doesn’t gate the swap)                           */
  /* ----------------------------------------------------------------------------- */
  useEffect(() => {
    if (!isExiting) return;
    const n = eventsFromStore.length;
    const ms = ((Math.max(n - 1, 0) * GRID_STAGGER_OUT) + ITEM_EXIT_DURATION) * 1000;
    const t = setTimeout(() => {
      setExitDone(true);
      uep('EXIT DONE', { n, ms });
    }, ms);
    return () => clearTimeout(t);
  }, [isExiting, eventsFromStore.length]);

  /* ----------------------------------------------------------------------------- */
  /* SWAP: as soon as the requested page is ready and not stale (independent of exitDone) */
  /* ----------------------------------------------------------------------------- */
  useEffect(() => {
    if (!isExiting) return;
    if (pendingPage == null) return;
    if (currentPage !== pendingPage) return;     // requested/target coherence
    if (!req.hasPage || reqIsStale) return;

    uep('SWAP -> readyPage', { from: readyPage, to: pendingPage, currentPage });
    setReadyPage(pendingPage);
    setIsExiting(false);
    setExitDone(false);
    setPendingPage(null);

    // Once the new page is visible, trigger the accordion scroll
    if (onPageNav && lastNavEventRef.current) {
      onPageNav(lastNavEventRef.current);
      lastNavEventRef.current = null;
    }

  }, [
    isExiting,
    pendingPage,
    currentPage,
    req.hasPage,
    reqIsStale,
    readyPage,
    onPageNav
  ]);

  /* ----------------------------------------------------------------------------- */
  /* GUARD RAIL: if exit finishes and requested page never arrives, cancel exit    */
  /* ----------------------------------------------------------------------------- */
  useEffect(() => {
    if (!isExiting) return;
    if (!exitDone) return;
    if (pendingPage == null) return;
    if (currentPage !== pendingPage) return;
    if (req.hasPage) return;

    const EXIT_GUARD_MS = 4000;
    uep('EXIT GUARD start', { EXIT_GUARD_MS, pendingPage, currentPage });
    const t = setTimeout(() => {
      uep('EXIT GUARD rollback (page not arrived)', { rollbackTo: readyPage });
      setCurrentPage(readyPage);
      setIsExiting(false);
      setExitDone(false);
      setPendingPage(null);
    }, EXIT_GUARD_MS);
    return () => clearTimeout(t);
  }, [isExiting, exitDone, pendingPage, currentPage, req.hasPage, readyPage]);

  /* ----------------------------------------------------------------------------- */
  /* DEBUG: machine state                                                          */
  /* ----------------------------------------------------------------------------- */
  useEffect(() => {
    uep('STATE', {
      currentPage,
      readyPage,
      pendingPage,
      reqHas: req.hasPage,
      visHas: vis.hasPage,
      reqMeta: req.meta,
      visMeta: meta,
      isExiting,
      exitDone,
      isPaginating,
      pageSize,
      searchKey,
    });
  }, [
    currentPage, readyPage, pendingPage,
    req.hasPage, vis.hasPage,
    req.meta, meta,
    isExiting, exitDone,
    isPaginating, pageSize, searchKey,
  ]);

  /* ----------------------------------------------------------------------------- */
  /* UPDATE FROM CARD (EditableEvent)                                              */
  /* ----------------------------------------------------------------------------- */
  const handleCardUpdate = useCallback(
    async (updatedEditable: EditableEvent) => {
      setUpdatingIds((prev) => new Set(prev).add(updatedEditable.id));
      try {
        const prevFull = entityById.get(updatedEditable.id);
        const merged: EventWithCreatorAndRsvps = prevFull
          ? ({ ...prevFull, ...updatedEditable } as EventWithCreatorAndRsvps)
          : (updatedEditable as unknown as EventWithCreatorAndRsvps);

        upsertEditableEvents([merged]);
        patchEventEverywhereShallow((() => {}) as unknown as GlobalMutate, updatedEditable);
      } finally {
        setUpdatingIds((prev) => {
          const next = new Set(prev);
          next.delete(updatedEditable.id);
          return next;
        });
      }
    },
    [entityById, upsertEditableEvents]
  );

  /* ----------------------------------------------------------------------------- */
  /* UPDATE FROM MENU (full entity after save)                                     */
  /* ----------------------------------------------------------------------------- */
  const handleMenuUpdate = useCallback(
    async (updatedFull: EventWithCreatorAndRsvps) => {
      setUpdatingIds((prev) => new Set(prev).add(updatedFull.id));
      try {
        upsertEvents([updatedFull]);
        patchEventEverywhere((() => {}) as unknown as GlobalMutate, updatedFull);
      } finally {
        setUpdatingIds((prev) => {
          const next = new Set(prev);
          next.delete(updatedFull.id);
          return next;
        });
      }
    },
    [upsertEvents]
  );

  /* ----------------------------------------------------------------------------- */
  /* DELETE handler (this view owns its key/page)                                  */
  /* ----------------------------------------------------------------------------- */
  const handleMenuDelete = useCallback((id: string) => {
    uep('DELETE invalidate', { id, page: currentPage, searchKey });
    invalidateSearchPage(searchKey, currentPage);
    removeEvents([id]);
  }, [invalidateSearchPage, removeEvents, searchKey, currentPage]);

  /* ----------------------------------------------------------------------------- */
  /* DETAILS / MENU                                                                */
  /* ----------------------------------------------------------------------------- */
  const handleDetailsClick = useCallback(async (event: EditableEvent) => {
    const maybeFull = entityById.get(event.id);
    if (!maybeFull?.rsvps) {
      const full = await fetchConfirmedFull(event.id);
      if (full) upsertEvents([full]);
    }
    openMenu(event.id, {
      mode: 'editable',
      onEventUpdate: handleMenuUpdate,
      onEventDeleted: handleMenuDelete,
    });
  }, [entityById, upsertEvents, openMenu, handleMenuUpdate, handleMenuDelete]);

  /* ----------------------------------------------------------------------------- */
  /* RENDER                                                                        */
  /* ----------------------------------------------------------------------------- */
  return (
    <div className="space-y-6 px-2 py-4 md:p-4 bg-zinc-900/50 rounded-b-lg" style={{ overflowAnchor: 'none' }}>
      {/* Filters */}
      <div className="w-full md:w-[410px]">
        <Searchbar
          isScrolled={isDesktop ? false : true}
          isDesktop={isDesktop}
          isNarrowScreen={isNarrowScreen}
          onSearchSubmit={setFiltersSafe}
          disableCreatorFilter={true}
          suggestionMode="server"
          suggestionScope={{ type: 'admin', userId }}
        />
      </div>

      {/* Title */}
      <SearchResultsTitle
        searchTerm={filters.search}
        category={filters.category}
        location={filters.location}
        date={filters.date}
        as="h3"
        className="px-1 md:px-0 -mt-1 mb-2"
        compact
      />

      {/* Loading */}
      {loading && (
        <div className="flex justify-center p-4">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
        </div>
      )}

      {/* Empty state */}
      {!loading && eventsFromStore.length === 0 && (
        <p className="text-zinc-400 col-span-full mt-4 text-center">
          No events found for this user.
        </p>
      )}

      {/* Grid */}
      {!loading && eventsFromStore.length > 0 && (
        <motion.div
          className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-4"
          key={`${searchKey}:${readyPage}:${pageSize}`}
          variants={gridStaggerVariants}
          initial={didMountRef.current ? 'initial' : false}
          animate={isExiting ? 'exit' : 'animate'}
          aria-busy={isPaginating || isPending}
          style={{ pointerEvents: (isPaginating || isPending) ? 'none' : 'auto' }}
        >
          {eventsFromStore.map((event) => {
            const full = entityById.get(event.id);
            const confirmedCount = Array.isArray(full?.rsvps)
              ? full!.rsvps!.filter((r) => r.status === RSVPStatus.confirmed).length
              : (counts[event.id] ?? 0);

            return (
              <motion.div key={event.id} variants={bloomItemVariants} layout>
                <SimpleEventCard
                  event={event as EditableEvent}
                  showAdminControls={true}
                  onDetailsClick={handleDetailsClick}
                  onEventUpdate={handleCardUpdate}
                  isUpdating={updatingIds.has(event.id)}
                  attendeesConfirmedCount={confirmedCount}
                  animateCounterWhenInView
                />
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-3 pt-4">
          <AnimatedCarouselArrow
            direction="left"
            onClick={handlePreviousPage}
            disabled={currentPage === 1 || loading || isPaginating || isExiting || isPending}
            isDesktop={isDesktop}
            variant="pagination"
            size={36}
            mobileSize={28}
          />
          <span className="text-white text-sm">
            {uiCurrent} / {totalPages}
          </span>
          <AnimatedCarouselArrow
            direction="right"
            onClick={handleNextPage}
            disabled={currentPage === totalPages || loading || isPaginating || isExiting || isPending}
            isDesktop={isDesktop}
            variant="pagination"
            size={36}
            mobileSize={28}
          />
        </div>
      )}
    </div>
  );
}
