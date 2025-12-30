'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import ArcEventCard from '@/components/Cards/ArcEventCard';
import ArcEventCardSkeleton from '@/components/Cards/ArcEventCardSkeleton';
import AnimatedCarouselArrow from '@/components/LordIcons/AnimatedCarouselArrow';
import AnimatedIcon from '@/components/LordIcons/AnimatedIcon';
import { LoadingCirclesAnimatedIcon } from '@/lib/icons';
import {
  useHomeMainEventList,
  type HomeMainInitialPayload,
} from '@/components/Home/home-main-event-list/useHomeMainEventList';

type Props = {
  initialEventsPayload: HomeMainInitialPayload;

  /**
   * Optional: lets a parent know when the list is actively fetching / transitioning pages.
   * Useful for coordinating external UI (e.g. show a loader next to SearchResultsTitle).
   */
  onBusyChange?: (busy: boolean) => void;

  /**
   * Only true during the *first load state* where there are still 0 cards rendered.
   * Intentionally ignores page transitions (pagePending) because pagination has its own loader.
   */
  onInitialLoadingChange?: (loading: boolean) => void;

  /**
   * When provided, the list behaves as "search-mode" in the parent (anchor used for search results).
   * We use its presence to detect optimistic mode switches (parent-mode vs URL-mode mismatch).
   */
  scrollTopAnchorRef?: { current: HTMLElement | null };
};

export default function HomeMainEventList({
  initialEventsPayload,
  onBusyChange,
  onInitialLoadingChange,
  scrollTopAnchorRef,
}: Props) {

  const {
    events,
    uiPage,
    uiTotalPages,
    pagePending,
    isLoading,
    error,

    isDesktop,
    smoothX,
    cardRefs,
    listTopRef,
    activeIndex,
    setActiveIndex,
    viewportWidth,

    handleNextPage,
    handlePreviousPage,
    handleDetailsClick,
    markPageAnimating,
    markPageSettled,

    updatingIds,
    popDistance,
    cardTotalWidth,
    cardWidth,
    rotationFactor,
    activeZoneHalfWidth,
    isAnyFilterActive,
  } = useHomeMainEventList(initialEventsPayload, scrollTopAnchorRef);

  const entriesRemainingRef = useRef(0);
  const pageSigRef = useRef('');

  const SKELETON_COUNT = 6;

  // -----------------------------------------------------------------------------------------------
  // MODE MISMATCH GUARD
  // -----------------------------------------------------------------------------------------------
  // Parent mode is derived from whether an anchor ref was provided (search-mode uses an anchor).
  const parentIsSearchMode = Boolean(scrollTopAnchorRef);

  // URL mode: single source of truth (computed inside the hook from URL params)
  const urlIsSearchMode = isAnyFilterActive;

  // When the parent flips optimistically but the URL hasn't settled yet,
  // we suppress rendering "stale" cards / empty state and show skeletons instead.
  const modeMismatch = parentIsSearchMode !== urlIsSearchMode;

  // A stable empty array reference to avoid changing deps on every render.
  const emptyEvents = useMemo(() => [], []);

  // Only render real cards when modes are consistent.
  const visibleEvents = useMemo(
    () => (modeMismatch ? emptyEvents : events),
    [modeMismatch, emptyEvents, events]
  );

  // Consider the list "busy" during mismatch as well, so the parent can show a loader.
  const busy = pagePending || isLoading || modeMismatch;

  // Initial header loading is:
  // - true while the list is fetching its first payload (no cards yet), OR
  // - true while we're in a mode mismatch (optimistic switch; hide stale UI).
  const initialHeaderLoading =
    modeMismatch || (isLoading && visibleEvents.length === 0 && !pagePending);

  // -----------------------------------------------------------------------------------------------
  // SKELETON LINGER (for fade-out)
  // -----------------------------------------------------------------------------------------------
  // NOTE: We intentionally do NOT set state synchronously inside effects (lint rule).
  // We show skeletons immediately via `initialHeaderLoading`, and only keep them mounted
  // briefly after loading ends via `lingerSkeleton`.
  const [lingerSkeleton, setLingerSkeleton] = useState<boolean>(initialHeaderLoading);

  // Skeleton should be rendered while we're actively loading OR while we're lingering.
  const showSkeleton = initialHeaderLoading || lingerSkeleton;

  useEffect(() => {
    if (initialHeaderLoading) {
      if (!lingerSkeleton) {
        const t = setTimeout(() => setLingerSkeleton(true), 0);
        return () => clearTimeout(t);
      }
      return;
    }

    if (!lingerSkeleton) return;

    const t = setTimeout(() => setLingerSkeleton(false), 200);
    return () => clearTimeout(t);
  }, [initialHeaderLoading, lingerSkeleton]);

  // -----------------------------------------------------------------------------------------------
  // Notify parent (optional)
  // -----------------------------------------------------------------------------------------------
  useEffect(() => {
    onInitialLoadingChange?.(initialHeaderLoading);
    return () => {
      if (initialHeaderLoading) onInitialLoadingChange?.(false);
    };
  }, [initialHeaderLoading, onInitialLoadingChange]);

  useEffect(() => {
    onBusyChange?.(busy);
    return () => {
      if (busy) onBusyChange?.(false);
    };
  }, [busy, onBusyChange]);

  // -----------------------------------------------------------------------------------------------
  // Page-entry animation coordination (only for the cards we actually render)
  // -----------------------------------------------------------------------------------------------
  useEffect(() => {
    // Signature: page + visible ids (so we don't animate during mismatch)
    const sig = `${uiPage}:${visibleEvents.map((e) => e.id).join(',')}`;

    if (pageSigRef.current !== sig) {
      pageSigRef.current = sig;

      entriesRemainingRef.current = visibleEvents.length;

      if (visibleEvents.length > 0) {
        markPageAnimating(); // cards started entering
      } else {
        markPageSettled(); // nothing to animate
      }
    }
  }, [uiPage, visibleEvents, markPageAnimating, markPageSettled]);

  const handleCardEntryDone = () => {
    if (entriesRemainingRef.current > 0) {
      entriesRemainingRef.current -= 1;
      if (entriesRemainingRef.current === 0) {
        markPageSettled(); // all cards finished entering
      }
    }
  };

  if (error) {
    return (
      <p className="text-center text-red-500">
        Error loading events: {error.message}
      </p>
    );
  }

  const shouldShowEmptyState =
    !modeMismatch &&
    !pagePending &&
    !isLoading &&
    !showSkeleton &&
    visibleEvents.length === 0;

  return (
    <div className="space-y-6">
      {/* Anchor for scroll; scroll-margin helps with headers/title */}
      <div ref={listTopRef} aria-hidden className="h-0 scroll-mt-32 md:scroll-mt-36" />

      {showSkeleton && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <ArcEventCardSkeleton
              key={`sk-${i}`}
              variant="list"
              visible={initialHeaderLoading}
            />
          ))}
        </div>
      )}

      {/* Empty state (suppressed during mismatch and while skeleton is fading out) */}
      {shouldShowEmptyState && (
        <p className="text-center font-semibold text-rose-800">
          No events found for the current selection.
        </p>
      )}

      {/* Main grid (suppressed during mismatch to avoid showing stale results) */}
      {visibleEvents.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleEvents.map((evt, i) => (
            <div
              key={evt.id}
              data-idx={i}
              ref={(el: HTMLDivElement | null) => {
                cardRefs.current[i] = el;
              }}
              onMouseEnter={() => !isDesktop && setActiveIndex(i)}
            >
              <ArcEventCard
                event={evt}
                index={i}
                renderIndex={i}
                smoothX={smoothX}
                cardTotalWidth={cardTotalWidth}
                cardWidth={cardWidth}
                viewportWidth={viewportWidth}
                curve={0}
                activeZoneHalfWidth={activeZoneHalfWidth}
                isDragging={false}
                rotationFactor={rotationFactor}
                isEven={false}
                popDistance={popDistance}
                isUpdating={updatingIds.has(evt.id)}
                onDetailsClick={handleDetailsClick}
                variant="list"
                scrollActive={activeIndex === i && !isDesktop}
                onEntryComplete={handleCardEntryDone}
              />
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {uiTotalPages > 1 && (
        <div className="relative flex items-center justify-center gap-5 md:gap-6 pt-4 h-12">
          <AnimatedCarouselArrow
            data-testid="home-paginator-prev"
            variant="pagination"
            direction="left"
            onClick={handlePreviousPage}
            disabled={uiPage === 1 || pagePending}
            isDesktop={isDesktop}
            size={32}
            mobileSize={24}
            className="mr-1"
          />

          {/* Keep the label perfectly centered; loader is absolutely positioned so it doesn't affect layout */}
          <div className="relative">
            <span
              data-testid="home-page-indicator"
              className="text-white text-sm select-none"
            >
              Page {uiPage} of {uiTotalPages}
            </span>

            {/* Appears on the RIGHT without shifting the centered label */}
            <span
              className="pointer-events-none absolute left-full ml-2.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-4 h-4 md:w-5 md:h-5"
              aria-hidden={!pagePending}
            >
              {pagePending ? (
                <>
                  <span className="sr-only">Loading page…</span>
                  <AnimatedIcon
                    icon={LoadingCirclesAnimatedIcon}
                    state="loop"
                    disableInternalHover
                    size={isDesktop ? 20 : 16}
                    className="opacity-90"
                  />
                </>
              ) : null}
            </span>
          </div>

          <AnimatedCarouselArrow
            data-testid="home-paginator-next"
            variant="pagination"
            direction="right"
            onClick={handleNextPage}
            disabled={uiPage === uiTotalPages || pagePending}
            isDesktop={isDesktop}
            size={32}
            mobileSize={24}
            className="ml-1"
          />
        </div>
      )}
    </div>
  );
}
