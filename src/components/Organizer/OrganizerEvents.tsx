'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  useTransition,
} from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';

import SimpleEventCard from '@/components/Cards/SimpleEventCard';
import AnimatedCarouselArrow from '../LordIcons/AnimatedCarouselArrow';
import { useMenu } from '@/contexts/MenuContext';

import { useMediaQuery, useConfirmedCounts } from '@/lib/hooks';
import {
  bloomItemVariants,
  gridStaggerVariants,
  GRID_STAGGER_OUT,
  ITEM_EXIT_DURATION,
} from '@/lib/animations';

import {
  useSearchPage,
  useEventsByIds,
  useBulkWarmup,
  useStoreWriters,
  useInvalidationWriters,
} from '@/contexts/EventsContext';

import { swrKeys } from '@/lib/swrKeys';
import { buildOrganizerQS } from '@/lib/utils';
import type { SearchbarFilters } from '../Searchbar/Searchbar';

import type { EditableEvent, EventWithCreatorAndRsvps } from '@/types/event';
import {
  type OrganizerEventsResponse,
  type EventByIdResponse,
  isApiErrorResponse,
} from '@/types/api';
import { RSVPStatus } from '@/generated/prisma';
import {
  patchEventEverywhere,
  patchEventEverywhereShallow,
  type GlobalMutate,
} from '@/lib/mutateHelpers';

type PageNavEvent = {
  from: number;
  to: number;
  reason: 'next' | 'prev' | 'filters' | 'pagesize';
};

type OrganizerEventsProps = {
  /** Stable key built by the wrapper (does NOT include limit). */
  searchKey: string;
  /** Page size calculated by the wrapper (desktop 8 / mobile 6). */
  pageSize: number;
  filters: SearchbarFilters;
  /** Used ONLY by pagination buttons to report navigation. */
  onPageNav?: (e: PageNavEvent) => void;
};

// Defensive fetch if warm-up hasn't populated the FULL entity yet
async function fetchConfirmedFull(
  id: string,
): Promise<EventWithCreatorAndRsvps | null> {
  const res = await fetch(
    `/api/events/${id}?rsvpStatus=${RSVPStatus.confirmed}`,
    { cache: 'no-store' },
  );

  const json = (await res.json().catch(() => null)) as EventByIdResponse | null;

  if (!res.ok || !json || isApiErrorResponse(json)) return null;

  return json.data;
}

export default function OrganizerEvents({
  searchKey,
  pageSize,
  filters,
  onPageNav,
}: OrganizerEventsProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  // State machine
  const [currentPage, setCurrentPage] = useState(1); // requested page
  const [readyPage, setReadyPage] = useState(1); // visible page
  const [pendingPage, setPendingPage] = useState<number | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const [exitDone, setExitDone] = useState(false);
  const [isPending, startTransition] = useTransition();
  const didMountRef = useRef(false);
  const lastNavEventRef = useRef<PageNavEvent | null>(null);

  // When filters or pageSize change, restart to page 1 with an exit transition
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true; // avoid initial blur on first render
      return;
    }
    setPendingPage(1);
    setIsExiting(true);
    setExitDone(false);
    startTransition(() => setCurrentPage(1));
  }, [filters, pageSize, startTransition]);

  // Store reads: visible vs requested
  const vis = useSearchPage(searchKey, readyPage);
  const req = useSearchPage(searchKey, currentPage);

  const { ids: pageIds, meta } = vis;
  const eventsFromStore = useEventsByIds(pageIds);

  // Warm-up + confirmed counts
  useBulkWarmup(pageIds, { rsvpStatus: RSVPStatus.confirmed });
  const counts = useConfirmedCounts(pageIds);

  // Writers / menu
  const { upsertEvents, upsertEditableEvents, setSearchPage } =
    useStoreWriters();
  const { removeEvents } = useInvalidationWriters();
  const { open: openMenu } = useMenu();

  // Staleness: if requested page exists but with a different eventsPerPage, refetch it
  const reqIsStale =
    req.hasPage && (req.meta?.eventsPerPage ?? pageSize) !== pageSize;

  // Fetch when the requested page is missing or stale
  useEffect(() => {
    if (req.hasPage && !reqIsStale) return;

    const url =
      `${swrKeys.organizer.list()}?` +
      buildOrganizerQS({
        page: currentPage,
        limit: pageSize, // real limit
        filters: {
          search: filters.search || '',
          location: filters.location || '',
          category: filters.category || '',
          date: filters.date || '',
        },
      });

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });

        const json = (await res.json().catch(() => null)) as
          | OrganizerEventsResponse
          | null;
        if (cancelled) return;

        // 1) HTTP / no-json
        if (!res.ok || !json) throw new Error(`HTTP ${res.status}`);

        // 2) API logical error
        if (isApiErrorResponse(json)) throw new Error(json.error);

        // 3) success
        upsertEditableEvents(json.data);

        const ids = json.data.map((e) => e.id);
        const requestedPage = currentPage;

        setSearchPage(searchKey, requestedPage, ids, {
          ...json.metadata,
          currentPage: requestedPage,
          eventsPerPage: pageSize, // staleness key
        });
      } catch (err) {
        if (cancelled) return;
        console.error(err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    req.hasPage,
    reqIsStale,
    searchKey,
    currentPage,
    pageSize,
    filters,
    upsertEditableEvents,
    setSearchPage,
  ]);

  // Loading/meta
  const loading = !vis.hasPage && eventsFromStore.length === 0;
  const totalPages = vis.hasPage ? meta?.totalPages ?? 1 : 1;
  const uiCurrent = currentPage;

  // Pagination
  const goToPage = useCallback(
    (target: number, reason: PageNavEvent['reason']) => {
      // We store the navigation event, but we DO NOT scroll yet
      lastNavEventRef.current = { from: currentPage, to: target, reason };

      setPendingPage(target);
      setIsExiting(true);
      setExitDone(false);
      startTransition(() => setCurrentPage(target));
    },
    [currentPage, startTransition],
  );

  const handleNext = () => {
    if (currentPage < totalPages) goToPage(currentPage + 1, 'next');
  };

  const handlePrev = () => {
    if (currentPage > 1) goToPage(currentPage - 1, 'prev');
  };

  // Exit completion (stagger out + single item exit duration)
  useEffect(() => {
    if (!isExiting) return;
    const n = eventsFromStore.length;
    const ms =
      (Math.max(n - 1, 0) * GRID_STAGGER_OUT + ITEM_EXIT_DURATION) * 1000;
    const t = setTimeout(() => setExitDone(true), ms);
    return () => clearTimeout(t);
  }, [isExiting, eventsFromStore.length]);

  // Atomic swap when exit finished AND target page is ready
  useEffect(() => {
    if (!isExiting) return;
    if (!exitDone) return;
    if (!req.hasPage || reqIsStale) return; // wait for refetch consistent with pageSize
    if (pendingPage == null) return;

    // 1) Page swap: the new page becomes visible
    setReadyPage(pendingPage);
    setIsExiting(false);
    setExitDone(false);
    setPendingPage(null);

    // 2) Now that the swap is atomic and the new page is ready,
    //    we trigger the smooth scroll exactly once.
    if (onPageNav && lastNavEventRef.current) {
      onPageNav(lastNavEventRef.current);
      lastNavEventRef.current = null;
    }
  }, [isExiting, exitDone, req.hasPage, reqIsStale, pendingPage, onPageNav]);

  // Clamp when totalPages shrinks
  useEffect(() => {
    if (!vis.hasPage) return;
    const tp = meta?.totalPages ?? 1;
    if (tp && currentPage > tp) setCurrentPage(tp);
  }, [vis.hasPage, meta?.totalPages, currentPage]);

  // Edit/menu handlers
  const entityById = useMemo(
    () => new Map(eventsFromStore.map((e) => [e.id, e] as const)),
    [eventsFromStore],
  );

  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  const handleCardUpdate = useCallback(
    async (updatedEditable: EditableEvent) => {
      setUpdatingIds((prev) => new Set(prev).add(updatedEditable.id));
      try {
        // EditableEvent -> partial patch (date normalized + local keys inside the writer)
        upsertEditableEvents([updatedEditable]);
        // Shallow patch for external caches (SWR) remains the same
        patchEventEverywhereShallow(
          (() => {}) as unknown as GlobalMutate,
          updatedEditable,
        );
      } finally {
        setUpdatingIds((prev) => {
          const next = new Set(prev);
          next.delete(updatedEditable.id);
          return next;
        });
      }
    },
    [upsertEditableEvents],
  );

  const handleMenuUpdate = useCallback(
    async (updatedFull: EventWithCreatorAndRsvps) => {
      setUpdatingIds((prev) => new Set(prev).add(updatedFull.id));
      try {
        upsertEvents([updatedFull]);
        patchEventEverywhere(
          (() => {}) as unknown as GlobalMutate,
          updatedFull,
        );
      } finally {
        setUpdatingIds((prev) => {
          const next = new Set(prev);
          next.delete(updatedFull.id);
          return next;
        });
      }
    },
    [upsertEvents],
  );

  const handleMenuDelete = useCallback(
    (id: string) => {
      // Without invalidating: the next read will refetch if needed
      removeEvents([id]);
    },
    [removeEvents],
  );

  const handleDetailsClick = useCallback(
    async (event: EditableEvent) => {
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
    },
    [entityById, upsertEvents, openMenu, handleMenuUpdate, handleMenuDelete],
  );

  // Render
  return (
    <div className="space-y-4">
      {loading && (
        <div className="flex justify-center p-4">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
        </div>
      )}

      {!loading && eventsFromStore.length === 0 && (
        <p className="text-center text-zinc-400">No events found.</p>
      )}

      {!loading && eventsFromStore.length > 0 && (
        <motion.div
          key={`${searchKey}:${readyPage}:${pageSize}`} // remount if only the limit changes
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4"
          variants={gridStaggerVariants}
          initial="initial"
          animate={isExiting ? 'exit' : 'animate'}
          aria-busy={isExiting || isPending}
          style={{ pointerEvents: isExiting || isPending ? 'none' : 'auto' }}
        >
          {eventsFromStore.slice(0, pageSize).map((event) => {
            const full = entityById.get(event.id);
            const confirmedCount = Array.isArray(full?.rsvps)
              ? full!.rsvps!.filter(
                  (r) => r.status === RSVPStatus.confirmed,
                ).length
              : counts[event.id] ?? 0;

            return (
              <motion.div key={event.id} variants={bloomItemVariants} layout>
                <SimpleEventCard
                  event={event as EditableEvent}
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

      {meta?.totalPages && meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <AnimatedCarouselArrow
            direction="left"
            onClick={handlePrev}
            disabled={currentPage === 1 || isExiting || isPending}
            isDesktop={isDesktop}
            variant="pagination"
            size={36}
            mobileSize={28}
          />

          <span className="text-sm text-white">
            {uiCurrent} / {meta.totalPages}
          </span>

          <AnimatedCarouselArrow
            direction="right"
            onClick={handleNext}
            disabled={currentPage === meta.totalPages || isExiting || isPending}
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
