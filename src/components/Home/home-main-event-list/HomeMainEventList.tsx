'use client';

import { useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import ArcEventCard from '@/components/Cards/ArcEventCard';
import AnimatedCarouselArrow from '@/components/LordIcons/AnimatedCarouselArrow';
import { useHomeMainEventList, type HomeMainInitialPayload } from '@/components/Home/home-main-event-list/useHomeMainEventList';

type Props = {
  initialEventsPayload: HomeMainInitialPayload;
};

export default function HomeMainEventList({ initialEventsPayload }: Props) {

  const {
    events,
    uiPage,
    uiTotalPages,
    pagePending,
    isLoading,
    isValidating,
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
  } = useHomeMainEventList(initialEventsPayload);

  const entriesRemainingRef = useRef(0);
  const pageSigRef = useRef('');

  useEffect(() => {
  // Signature: page + visible ids
  const sig = `${uiPage}:${events.map(e => e.id).join(',')}`;

  if (pageSigRef.current !== sig) {
    pageSigRef.current = sig;

    entriesRemainingRef.current = events.length;
    if (events.length > 0) {
      markPageAnimating();   // cards started entering
    } else {
      markPageSettled();     // nothing to animate
    }
  }
}, [uiPage, events, markPageAnimating, markPageSettled]);

  const handleCardEntryDone = () => {
    if (entriesRemainingRef.current > 0) {
      entriesRemainingRef.current -= 1;
      if (entriesRemainingRef.current === 0) {
        markPageSettled();    // ALL cards finished
      }
    }
  };

  if (error) {
    return <p className="text-center text-red-500">Error loading events: {error.message}</p>;
  }

  return (
    <div className="space-y-6">
      {/* anchor for scroll; scroll-margin helps with headers/title */}
      <div ref={listTopRef} aria-hidden className="h-0 scroll-mt-32 md:scroll-mt-36" />

      {/* loaders */}
      {pagePending && (
        <div className="flex justify-center items-center p-4">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          <p className="ml-2 text-zinc-400">Loading events...</p>
        </div>
      )}
      {!pagePending && isValidating && !isLoading && (
        <div className="text-center text-sm text-zinc-500 py-2">Checking for updates…</div>
      )}

      {/* no events */}
      {!pagePending && !events.length && !isLoading && (
        <p className="text-center text-gray-500">No events found for the current selection.</p>
      )}

      {/* main grid */}
      {events.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((evt, i) => (
            <div
              key={evt.id}
              data-idx={i}
              ref={(el: HTMLDivElement | null) => { cardRefs.current[i] = el; }}
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

      {/* pagination */}
      {uiTotalPages > 1 && (
        <div className="relative flex items-center justify-center gap-3 pt-4 h-12">
          <AnimatedCarouselArrow
            data-testid="home-paginator-prev"
            variant="pagination"
            direction="left"
            onClick={handlePreviousPage}
            disabled={uiPage === 1}
            isDesktop={isDesktop}
            size={32}
            mobileSize={24}
            className="mr-1"
          />

          <span data-testid="home-page-indicator" className="text-white text-sm select-none">
            Page {uiPage} of {uiTotalPages}
          </span>

          <AnimatedCarouselArrow
            data-testid="home-paginator-next"
            variant="pagination"
            direction="right"
            onClick={handleNextPage}
            disabled={uiPage === uiTotalPages}
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
