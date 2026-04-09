'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import Autoplay from 'embla-carousel-autoplay';
import type { EditableEvent, EventWithCreatorAndRsvps } from '@/types/event';
import { useMediaQuery } from '@/lib/hooks';
import SimpleEventCard from '../Cards/SimpleEventCard';
import { useMenu } from '@/contexts/MenuContext';
import AnimatedCarouselArrow from '../LordIcons/AnimatedCarouselArrow';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel';

import { useStoreWriters, useBulkWarmup, useInvalidationWriters } from '@/contexts/EventsContext';
import { patchEventEverywhere, type GlobalMutate } from '@/lib/mutateHelpers';
import { useConfirmedCounts } from '@/lib/hooks';
import { RSVPStatus } from '@/generated/prisma';

/* =====================================================================================
 * PROPS
 * ===================================================================================== */

interface OrganizerCarouselProps {
  initialEvents: EditableEvent[];
  autoplay?: boolean;
  /** Base delay between card animations (seconds). */
  cardAnimationDelay?: number;
}

/* =====================================================================================
 * COMPONENT
 * ===================================================================================== */

export default function OrganizerCarousel({
  initialEvents,
  autoplay = false,
  cardAnimationDelay = 0.1,
}: OrganizerCarouselProps) {
  /* ----------------------------------------------------------------------------- */
  /* MEDIA QUERIES                                                                 */
  /* ----------------------------------------------------------------------------- */
  const isLg = useMediaQuery('(min-width: 1024px)');
  const isMd = useMediaQuery('(min-width: 768px)');
  const isDesktop = isMd;

  /* ----------------------------------------------------------------------------- */
  /* STORE WRITERS                                                                 */
  /* ----------------------------------------------------------------------------- */
  const { upsertEvents } = useStoreWriters();
  const { removeEvents } = useInvalidationWriters();

  /* ----------------------------------------------------------------------------- */
  /* LOCAL STATE                                                                   */
  /* ----------------------------------------------------------------------------- */
  const [events, setEvents] = useState<EditableEvent[]>(() => initialEvents ?? []);
  // IDs derived from props (stable; do not depend on local state)
  const ids = useMemo(() => initialEvents.map((e) => e.id), [initialEvents]);

  // Confirmed counts (batch endpoint; independent from warm-up)
  const counts = useConfirmedCounts(ids);

  // Centralized warm-up: loads FULL events (with confirmed RSVPs) for all IDs
  useBulkWarmup(ids, { rsvpStatus: RSVPStatus.confirmed });

  // If SSR re-renders and props change, keep local list in sync
  useEffect(() => {
    setEvents(initialEvents ?? []);
  }, [initialEvents]);

  /* ----------------------------------------------------------------------------- */
  /* CAROUSEL STATE                                                                */
  /* ----------------------------------------------------------------------------- */
  const [carouselApi, setCarouselApi] = useState<CarouselApi | null>(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [activeIndexes, setActiveIndexes] = useState<number[]>([]);

  const autoplayPlugin = useRef(Autoplay({ delay: 4000, stopOnInteraction: true }));

  /* ----------------------------------------------------------------------------- */
  /* MENU                                                                          */
  /* ----------------------------------------------------------------------------- */
  const { open: openMenu } = useMenu();

  const handleEventUpdate = useCallback((updated: EventWithCreatorAndRsvps) => {
    // Merge into local list (instant feedback) and store (single source of truth)
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? { ...e, ...updated } : e)));
    upsertEvents([updated]);
    patchEventEverywhere((() => {}) as unknown as GlobalMutate, updated);
  }, [upsertEvents]);

  /** Archive from Menu → optimistic local filter + optional store cleanup. */
  const handleEventArchived = useCallback((id: string) => {
    // 1) Optimistic local feedback: remove from this carousel instantly.
    setEvents((prev) => prev.filter((e) => e.id !== id));
    // 2) Optional store cleanup so the entity doesn't linger in other views.
    removeEvents([id]);
  }, [removeEvents]);

  // With prior warm-up, no extra fetching is needed here
  const handleDetailsClick = useCallback((event: EditableEvent) => {
    openMenu(event.id, {
      mode: 'editable',
      onEventUpdate: handleEventUpdate,
      onEventArchived: handleEventArchived,
    });
  }, [openMenu, handleEventUpdate, handleEventArchived]);

  /* ----------------------------------------------------------------------------- */
  /* NAV / IN-VIEW                                                                 */
  /* ----------------------------------------------------------------------------- */
  const scrollPrev = useCallback(() => carouselApi?.scrollPrev(), [carouselApi]);
  const scrollNext = useCallback(() => carouselApi?.scrollNext(), [carouselApi]);

  const updateCarouselState = useCallback(
    (api: CarouselApi) => {
      if (!api) return;

      if (!events || events.length === 0) {
        setCanScrollPrev(false);
        setCanScrollNext(false);
        setActiveIndexes([]);
        return;
      }

      const nextCanScrollPrev = api.canScrollPrev();
      const nextCanScrollNext = api.canScrollNext();

      setCanScrollPrev((prev) => (prev === nextCanScrollPrev ? prev : nextCanScrollPrev));
      setCanScrollNext((prev) => (prev === nextCanScrollNext ? prev : nextCanScrollNext));

      let cardsToShow = 2;
      if (isLg) cardsToShow = 4;
      else if (isMd) cardsToShow = 3;

      // Qué slides están en vista
      const inViewIndexes = api.slidesInView(); // si tu versión soporta target: api.slidesInView(true)
      const lastIndex = events.length - 1;

      if (!nextCanScrollNext && lastIndex >= 0 && !inViewIndexes.includes(lastIndex)) {
        inViewIndexes.push(lastIndex);
      }

      const sortedInView = [...inViewIndexes].sort((a, b) => a - b);

      const nextActiveIndexes = !nextCanScrollNext
        ? sortedInView.slice(-cardsToShow)
        : sortedInView.slice(0, cardsToShow);

      setActiveIndexes((prev) => {
        if (
          prev.length === nextActiveIndexes.length &&
          prev.every((v, i) => v === nextActiveIndexes[i])
        ) {
          return prev; // nada cambió → no re-render
        }
        return nextActiveIndexes;
      });
    },
    [events, isLg, isMd]
  );

  useEffect(() => {
    const api = carouselApi;
    if (!api) return;

    const handler = () => updateCarouselState(api);

    // Estado inicial
    updateCarouselState(api);

    // 1) Cuando se re-inicializa (resize, etc.)
    api.on('reInit', handler);
    // 2) Cuando algún slide entra o sale del viewport
    api.on('slidesInView', handler);
    // 3) Por si querés sincronizar también con cambio de snap
    api.on('select', handler);

    return () => {
      api.off('reInit', handler);
      api.off('slidesInView', handler);
      api.off('select', handler);
    };
  }, [carouselApi, updateCarouselState]);


  const showArrows = isDesktop && events.length > (isLg ? 4 : isMd ? 3 : 2);

  /* ----------------------------------------------------------------------------- */
  /* RENDER                                                                        */
  /* ----------------------------------------------------------------------------- */
  if (!events || events.length === 0) return null;

  return (
    <>
      <div className="relative">
        <Carousel
          setApi={setCarouselApi}
          plugins={autoplay ? [autoplayPlugin.current] : []}
          className="w-full"
          onMouseEnter={autoplay ? () => autoplayPlugin.current.stop() : undefined}
          onMouseLeave={autoplay ? () => autoplayPlugin.current.reset() : undefined}
          opts={{ align: 'start', loop: false }}
        >
          <CarouselContent className="-ml-2 md:mr-2 py-6">
            {events.map((event, index) => {
              const confirmedCount = counts[event.id] ?? 0;
              return (
                <CarouselItem
                  key={event.id}
                  className="pl-3 xs4:pl-4 basis-[47%] md:basis-1/3 lg:basis-1/4"
                >
                  <div className="h-full">
                    <SimpleEventCard
                      event={event}
                      onDetailsClick={handleDetailsClick}
                      isActive={activeIndexes.includes(index)}
                      animationIndex={index}
                      cardAnimationDelay={cardAnimationDelay}
                      attendeesConfirmedCount={confirmedCount}
                    />
                  </div>
                </CarouselItem>
              );
            })}
          </CarouselContent>
        </Carousel>

        {showArrows && (
          <>
            <AnimatedCarouselArrow
              direction="left"
              onClick={scrollPrev}
              disabled={!canScrollPrev}
              isDesktop={isDesktop}
              className="-left-12 md:-left-14"
            />
            <AnimatedCarouselArrow
              direction="right"
              onClick={scrollNext}
              disabled={!canScrollNext}
              isDesktop={isDesktop}
              className="-right-12 md:-right-14"
            />
          </>
        )}
      </div>
    </>
  );
}
