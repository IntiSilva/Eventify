'use client';

import { useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import Searchbar, { type SearchbarFilters } from '../Searchbar/Searchbar';
import SearchResultsTitle from '../AnimatedText/SearchResultsTitle';
import OrganizerEvents from './OrganizerEvents';
import OrganizerCarousel from './OrganizerCarousel';
import OrganizerSignalDeck from './OrganizerSignalDeck';
import { AuroraButton } from '../CommonButtons/AuroraButton';
import { buildOrganizerQS } from '@/lib/utils';

import {
  useStoreWriters,
} from '@/contexts/EventsContext';
import type { EditableEvent } from '@/types/event';
import type { OrganizerEventsContext, PaginatedMetadata } from '@/types/api';
import type { RefundViewerCounts } from '@/components/Payments/refunds/types/refunds';
import type {
  OrganizerOverviewSnapshot,
  OrganizerOverviewTimeSeriesSnapshot,
} from '@/lib/data';
import { useMediaQuery } from '@/lib/hooks';
import AnimatedIcon from '../LordIcons/AnimatedIcon';
import { CalendarAnimatedIcon } from '@/lib/icons';


type OrganizerInitialPayload = {
  data: EditableEvent[];
  metadata: PaginatedMetadata;
  context: OrganizerEventsContext;
};

interface OrganizerPageClientWrapperProps {
  initialPayload: OrganizerInitialPayload;
  popularEvents: EditableEvent[];
  monthlyEvents: EditableEvent[];
  isSearchMode: boolean;
  refundCounts: RefundViewerCounts;
  overviewSnapshot: OrganizerOverviewSnapshot;
  overviewTimeSeries: OrganizerOverviewTimeSeriesSnapshot;
  isStripeReady: boolean;
}

export default function OrganizerPageClientWrapper({
  initialPayload,
  popularEvents,
  monthlyEvents,
  isSearchMode,
  refundCounts,
  overviewSnapshot,
  overviewTimeSeries,
  isStripeReady,
}: OrganizerPageClientWrapperProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const titleRef = useRef<HTMLHeadingElement>(null);

  // Same breakpoint as the list
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const pageSize = isDesktop ? 8 : 6;

  // URL → filters
  const SWR_search   = searchParams.get('search')   || '';
  const SWR_location = searchParams.get('location') || '';
  const SWR_category = searchParams.get('category') || '';
  const SWR_date     = searchParams.get('date')     || '';
  const SWR_paidRaw  = searchParams.get('paid');
  const SWR_paid     = SWR_paidRaw === 'paid' || SWR_paidRaw === 'free' ? SWR_paidRaw : 'all';

  const filters: SearchbarFilters = useMemo(() => ({
    search:   SWR_search   || undefined,
    location: SWR_location || undefined,
    category: SWR_category || undefined,
    date:     SWR_date     || undefined,
    paid:     SWR_paid,
  }), [SWR_search, SWR_location, SWR_category, SWR_date, SWR_paid]);

  const spotlightEvent = useMemo<EditableEvent | null>(() => {
    if (popularEvents.length > 0) return popularEvents[0];
    if (monthlyEvents.length > 0) return monthlyEvents[0];
    if (initialPayload.data.length > 0) return initialPayload.data[0];
    return null;
  }, [popularEvents, monthlyEvents, initialPayload.data]);

  // Stable key (does not include limit; the list will refetch if the limit differs)
  const searchKey = useMemo(() => {
    return buildOrganizerQS({
      filters: {
        search: SWR_search,
        location: SWR_location,
        category: SWR_category,
        date: SWR_date,
        paid: SWR_paid,
      },
    }) || 'ALL';
  }, [SWR_search, SWR_location, SWR_category, SWR_date, SWR_paid]);

  // Seed SSR data into the store as-is (eventsPerPage may be 8)
  const { upsertEditableEvents, setSearchPage } = useStoreWriters();
  const seededRef = useRef<string | null>(null);
  
  useLayoutEffect(() => {
    if (!initialPayload?.data?.length) return;

    const seedKey = `${searchKey}:${pageSize}:${initialPayload.metadata.currentPage}`;
    if (seededRef.current === seedKey) return; // evita double-seed en dev
    seededRef.current = seedKey;

    // 1) Upsert todas las entidades (ok)
    upsertEditableEvents(initialPayload.data);

    // 2) Importante: page ids acorde al pageSize REAL del cliente
    const ids = initialPayload.data.slice(0, pageSize).map(e => e.id);

    const totalEvents = initialPayload.metadata.totalEvents ?? ids.length;

    setSearchPage(searchKey, initialPayload.metadata.currentPage, ids, {
      ...initialPayload.metadata,
      currentPage: initialPayload.metadata.currentPage,
      eventsPerPage: pageSize,
      totalPages: Math.max(1, Math.ceil(totalEvents / pageSize)),
    });
  }, [initialPayload, searchKey, pageSize, upsertEditableEvents, setSearchPage]);

  // Smooth scroll to the title (fixed offset + rAF)
  const NAVBAR_COLLAPSED_HEIGHT = 52;
  const SCROLL_OFFSET = NAVBAR_COLLAPSED_HEIGHT + 4; // adjust to your navbar
  const scrollToTitle = useCallback(() => {
    const el = titleRef.current;
    if (!el) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const y = el.getBoundingClientRect().top + (window.scrollY || 0) - SCROLL_OFFSET;

    window.scrollTo({
      top: Math.max(0, y),
      behavior: prefersReduced ? 'auto' : 'smooth',
    });
  }, [SCROLL_OFFSET]);


  const handleOrganizerSearch = (f: SearchbarFilters) => {
    router.push(`/organizer?${buildOrganizerQS({ filters: f })}`);
  };
const completelyEmpty = !isSearchMode && !initialPayload.context.hasAnyEventsEver;

// Early return: empty state hero
if (completelyEmpty) {
  return (
    <div className="px-4 py-10 md:py-14">
      <div className="mx-auto max-w-2xl">
        {/* Card del hero (más oscuro + blur) */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/5 supports-[backdrop-filter]:backdrop-blur-[6px] p-8 md:p-10 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
          {/* Radiales sutiles, ahora DENTRO del card y clippeados */}
          <div className="pointer-events-none absolute right-0 top-0 translate-x-1/4 -translate-y-1/4 h-56 w-56 rounded-full bg-emerald-500/15 blur-3xl" />
          <div className="pointer-events-none absolute left-0 bottom-0 -translate-x-1/4 translate-y-1/4 h-64 w-64 rounded-full bg-rose-500/15 blur-3xl" />

          {/* Icono mínimo */}
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10 shadow-inner">
              <AnimatedIcon
                icon={CalendarAnimatedIcon}
                state='in'
                size={24}
                colors={{primary: '#e4e4e7'}}
                aria-hidden="true"
              />
          </div>

          <h2 className="text-center text-2xl md:text-3xl font-heading font-semibold text-white">
            You don&apos;t have any events yet
          </h2>

          <p className="mt-3 text-center text-base text-zinc-200">
            Create your first event to invite your audience, manage RSVPs and reminders,
            and keep everything organized in one place.
          </p>

          <div className="mt-6 flex justify-center">
            <AuroraButton className="cursor-pointer text-sm md:text-base font-display">
              <Link href="/events/new">Create event</Link>
            </AuroraButton>
          </div>

          <p className="mt-3 text-center text-sm text-zinc-300">
            Tip: you can edit details later — title, date, location, and more.
          </p>
        </div>
      </div>
    </div>
  );
}


  return (
    <div className="space-y-6">
      {initialPayload.context.hasAnyEventsEver && (
        <OrganizerSignalDeck
          refundCounts={refundCounts}
          overviewSnapshot={overviewSnapshot}
          overviewTimeSeries={overviewTimeSeries}
          spotlightEvent={spotlightEvent}
          isStripeReady={isStripeReady}
        />
      )}

      {/* Searchbar */}
      <div className="w-full md:w-[410px] md:ml-0">
        <Searchbar
          isScrolled={isDesktop ? false : true}
          isDesktop={true}
          isNarrowScreen={false}
          onSearchSubmit={handleOrganizerSearch}
          disableCreatorFilter
          suggestionMode="server"
          suggestionScope={{ type: 'organizer' }}
        />
      </div>

      {/* Results title */}
      <SearchResultsTitle
        searchTerm={SWR_search || undefined}
        category={SWR_category || undefined}
        location={SWR_location || undefined}
        date={SWR_date || undefined}
        paid={SWR_paid}
        creatorLabel="Organized by"
        as="h2"
        className="mb-4 md:mb-6"
        compact={!isDesktop}
      />

      {/* Promotional sections (when not in search mode) */}
      {!isSearchMode && (
        <div className="space-y-8 md:px-14">
          {popularEvents.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-2xl text-white font-bold font-heading">
                Your Popular Events
              </h2>
              <OrganizerCarousel
                initialEvents={popularEvents}
                cardAnimationDelay={0.1}
              />
            </div>
          )}

          {monthlyEvents.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-2xl text-white font-bold font-heading">
                Coming this Month
              </h2>
              <OrganizerCarousel
                initialEvents={monthlyEvents}
                cardAnimationDelay={0.3}
              />
            </div>
          )}
        </div>
      )}

      {/* Anchor for scrolling when changing pages */}
      {!isSearchMode && (
        <h2
          ref={titleRef}
          className="text-2xl text-white font-bold font-heading scroll-mt-16"
        >
          All Your Events
        </h2>
      )}

      {/* Paged list with internal pagination; onPageNav → smooth scroll */}
      <OrganizerEvents
        searchKey={searchKey}
        pageSize={pageSize}
        filters={filters}
        onPageNav={scrollToTitle}
        hasSsrSeed={initialPayload.data.length > 0}
      />
    </div>
  );
}
