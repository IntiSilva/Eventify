'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { swrKeys } from '@/lib/swrKeys';
import { useEventsByIds, useList, useStoreWriters } from '@/contexts/EventsContext';
import { useSearchContext } from '@/contexts/SearchContext';
import { buildEventsQS } from '@/lib/utils';
import { useMediaQuery } from '@/lib/hooks';

import HomeMainEventList from './home-main-event-list/HomeMainEventList';
import HomeArcCarousel from './HomeArcCarousel';
import { BlobButton } from '../CommonButtons/BlobButton';
import { AuroraButton } from '../CommonButtons/AuroraButton';
import { ParticlesButton } from '../CommonButtons/ParticlesButton';
import AnimatedText from '../AnimatedText/AnimatedText';
import AnimatedIcon from '../LordIcons/AnimatedIcon';
import { LoadingDotsAnimatedIcon } from '@/lib/icons';
import SearchResultsTitle from '../AnimatedText/SearchResultsTitle';
import { FeaturedThresholdTooltip } from '../InfoTooltip';

import type { SearchbarFilters } from '@/components/Searchbar/Searchbar';
import type { HomePageData } from '@/lib/data';
import type { UserRole } from '@/generated/prisma';

/* =============================================================================
 * HEADER local presentational component
 * ============================================================================= */
function HeaderFullWidth({
  title,
  withActions = false,
  userRole,
  inlineAddon,
  isDesktop
}: {
  title: string;
  withActions?: boolean;
  userRole?: UserRole;
  inlineAddon?: React.ReactNode;
  isDesktop?: boolean;
}) {
  return (
    <div
      className="
        relative w-screen 
        -mx-[calc(50vw-50%)]
        px-4 lg:px-16 
        mb-6 lg:mb-8
        flex flex-col-reverse
        gap-3
      "
    >
      {/* Title at the bottom on mobile, left-aligned on desktop */}
      <AnimatedText
        as="h2"
        title={title}
        subtitle=""
        containerClassName="text-left self-stretch"
        headingClassName="text-4xl xs4:text-5xl md:text-5xl lg:tracking-widest font-bold font-display text-white opacity-0"
        inlineAddon={inlineAddon}
        splitMode={isDesktop ? 'char' : 'word'}
      />

      {/* Optional action buttons (right-aligned on desktop) */}
      {withActions ? (
        <div className="self-end lg:self-auto flex flex-wrap justify-end gap-4">
          {userRole === 'organizer' && (
            <AuroraButton emeraldBorder className="h-auto min-h-9 cursor-pointer text-xs text-white/90 py-1 md:py-1.5 px-2 font-display">
              <Link href="/organizer" className="whitespace-pre-line text-center">
                {'Manage\nMy Events'}
              </Link>
            </AuroraButton>
          )}
          {userRole === 'admin' && (
            <BlobButton className="h-auto min-h-9 cursor-pointer text-xs text-white/90 py-1 md:py-1.5 px-2 font-display">
              <Link href="/admin" className="whitespace-pre-line text-center">
                {'Manage\nAll Events'}
              </Link>
            </BlobButton>
          )}
          {userRole === 'user' && (
            <ParticlesButton
              glass="black"
              glassBlackAlpha={1}
              className="
                h-auto min-h-9
                px-4 py-1 md:py-1.5
                text-xs font-display
              "
            >
              <Link href="/agenda" className="whitespace-pre-line text-center">
                {'My\nAgenda'}
              </Link>
            </ParticlesButton>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* =====================================================================================
 * TYPES
 * ===================================================================================== */

interface HomePageClientWrapperProps extends HomePageData {
  /** Optional user role to show header actions (organizer/admin). */
  userRole?: UserRole;
}

/* =====================================================================================
 * COMPONENT
 * ===================================================================================== */

/**
 * Receives the full Home data payload (SSR/edge) and renders:
 * - Two carousels (Upcoming / Featured) when NOT in search mode
 * - A composed title + main list when in search mode
 * Also wires the global search (navbar) to push query params (public search).
 */
export default function HomePageClientWrapper({
  isSearchMode,
  currentSearchTerm,
  currentCategory,
  currentLocation,
  currentCreator,
  currentDate,
  upcomingEvents,
  featuredEvents,
  initialMainListPayload,
  userRole,
}: HomePageClientWrapperProps) {
  /* -----------------------------------------------------------------------------
   * ROUTER / CONTEXTS
   * ----------------------------------------------------------------------------- */
  const router = useRouter();
  const { setOnSearchSubmit } = useSearchContext();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  // -----------------------------------------------------------------------------
  // OPTIMISTIC "MODE" + CAROUSEL FALLBACK FROM CONTEXT
  // - Avoid waiting for SSR prop `isSearchMode` to flip back when clearing search.
  // - Use EventsContext as the persistent cache for carousels.
  // -----------------------------------------------------------------------------

  const [optimisticIsSearchMode, setOptimisticIsSearchMode] = useState(isSearchMode);
  const [optimisticFilters, setOptimisticFilters] = useState<SearchbarFilters>({});


  // Keep in sync when the server payload arrives
  useEffect(() => {
    setOptimisticIsSearchMode(isSearchMode);
  }, [isSearchMode]);

  const effectiveIsSearchMode = optimisticIsSearchMode;


// Anchor for "go back to list mode" scroll (above carousels)
const homeTopRef = useRef<HTMLDivElement>(null);
// We trigger scroll manually because router.push uses { scroll: false }
const [pendingScroll, setPendingScroll] = useState<'home' | 'search' | null>(null);


useEffect(() => {
  if (!pendingScroll) return;

  let cancelled = false;
  const TRIES_MAX = 12;

  const tick = (tries: number) => {
    if (cancelled) return;

    const target =
      pendingScroll === 'search'
        ? searchResultsTopRef.current
        : homeTopRef.current;

    if (target) {
      // Mobile search: same small delay you already use elsewhere so layout settles nicely
      const delay = !isDesktop && pendingScroll === 'search' ? 90 : 0;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
            setPendingScroll(null);
          }, delay);
        });
      });

      return;
    }

    if (tries >= TRIES_MAX) {
      setPendingScroll(null);
      return;
    }

    requestAnimationFrame(() => tick(tries + 1));
  };

  tick(0);
  return () => {
    cancelled = true;
  };
}, [pendingScroll, isDesktop]);

// Read cached carousel lists (persist across route transitions because provider is in layout)
const upcomingIds = useList('upcoming');
const featuredIds = useList('featured');

const cachedUpcomingEvents = useEventsByIds(upcomingIds);
const cachedFeaturedEvents = useEventsByIds(featuredIds);

// If SSR props are empty (typical while you're still on the "search payload"),
// fall back to the cached context data so the carousels can show instantly.
const upcomingFallback = upcomingEvents.length ? upcomingEvents : cachedUpcomingEvents;
const featuredFallback = featuredEvents.length ? featuredEvents : cachedFeaturedEvents;

// Safety: seed the store from SSR when the lists are empty (first load / hard refresh)
const { upsertEvents, setList } = useStoreWriters();
useEffect(() => {
  if (upcomingEvents.length && upcomingIds.length === 0) {
    upsertEvents(upcomingEvents);
    setList('upcoming', upcomingEvents.map(e => e.id));
  }
  if (featuredEvents.length && featuredIds.length === 0) {
    upsertEvents(featuredEvents);
    setList('featured', featuredEvents.map(e => e.id));
  }
}, [
  upcomingEvents,
  featuredEvents,
  upcomingIds.length,
  featuredIds.length,
  upsertEvents,
  setList,
]);


  const searchResultsTopRef = useRef<HTMLDivElement>(null);

  // Measure the height of your fixed navbar/searchbar and set the exponent as a CSS variable for `scroll-mt`.
  // This way we don't have to guess compensations when the title wraps
  useEffect(() => {
    const headerEl =
      document.querySelector('header') ||
      document.querySelector('nav');

    if (!headerEl) return;

    const update = () => {
      const h = headerEl.getBoundingClientRect().height;
      const px = Math.ceil(h + 12); // +12px de aire
      document.documentElement.style.setProperty('--home-search-scroll-mt', `${px}px`);
    };

    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Only for the "More Events" header and SearchResultsTitle busy indicator:
  // true only while the list still has 0 cards rendered and is actively loading.
  const [initialHeaderLoading, setInitialHeaderLoading] = useState(false);
  const handleInitialHeaderLoadingChange = useCallback((loading: boolean) => {
    setInitialHeaderLoading(loading);
  }, []);

  // Handles Home search navigation with an optimistic UI mode switch.
  // Immediately toggles search/list mode on the client (before SSR responds),
  // then updates the URL with the selected filters.
  const handlePublicSearch = useCallback(
  (filters: SearchbarFilters) => {
    const wantsSearch = Boolean(
      filters.search?.trim() ||
        filters.category ||
        filters.location?.trim() ||
        filters.creator?.trim() ||
        filters.date
    );

    // Flip UI immediately (don’t wait for SSR prop change)
    setOptimisticFilters(filters);
    setOptimisticIsSearchMode(wantsSearch);
    // Scroll up immediately on submit/close
    setPendingScroll(wantsSearch ? 'search' : 'home')

    const qs = buildEventsQS(filters);
    router.push(qs ? `/?${qs}` : '/', { scroll: false });
  },
  [router]
);

  /**
   * Register the public search handler into the SearchContext so the navbar search
   * can call it directly from any route.
   */
  useEffect(() => {
    setOnSearchSubmit(() => handlePublicSearch);
    return () => {
      // Cleanup: reset on unmount
      setOnSearchSubmit(() => () => {});
    };
  }, [setOnSearchSubmit, handlePublicSearch]);


  /* -----------------------------------------------------------------------------
   * RENDER
   * ----------------------------------------------------------------------------- */
  return (
    <>
        {/* Stable top anchor for returning to list mode */}
      <div
        ref={homeTopRef}
        aria-hidden
        className="h-0 mb-0 scroll-mt-[var(--home-search-scroll-mt,8rem)]"
      />
      {!effectiveIsSearchMode ? (
        <>
          {/* UPCOMING */}
          <HeaderFullWidth title="Upcoming Events" withActions userRole={userRole} isDesktop={isDesktop} />
          <section className="relative w-screen -mx-[calc(50vw-50%)]">
            {upcomingFallback.length ? (
              <HomeArcCarousel
                fallbackData={upcomingFallback}
                swrKey={swrKeys.events('?dateGroup=upcoming')}
                listName="upcoming"
              />
            ) : (
              <p className="px-4">No upcoming events.</p>
            )}
          </section>

          {/* FEATURED */}
          <HeaderFullWidth
            title="Featured Events"
            inlineAddon={
              <span className="relative -top-0.5">
                <FeaturedThresholdTooltip
                  className="bg-black hover:bg-black focus:bg-black"
                  side="top"
                  align="start"
                  triggerMode="both"
                />
              </span>
            }
            isDesktop={isDesktop}
          />
          <section className="relative w-screen -mx-[calc(50vw-50%)]">
            {featuredFallback.length ? (
              <HomeArcCarousel
                fallbackData={featuredFallback}
                swrKey={swrKeys.events('?featured=true')}
                listName="featured"
              />
            ) : (
              <p>No featured events.</p>
            )}
          </section>
        </>
      ) : (
        // SEARCH MODE: composed title that reflects current filters
        <>
          {/* Stable anchor for pagination in search (independent of title height) */}
          <div
            ref={searchResultsTopRef}
            aria-hidden
            className="h-0 mb-0 scroll-mt-[var(--home-search-scroll-mt,8rem)]"
          />

          <SearchResultsTitle
            searchTerm={(optimisticFilters.search ?? currentSearchTerm) || null}
            category={(optimisticFilters.category ?? currentCategory) || null}
            location={(optimisticFilters.location ?? currentLocation) || null}
            creator={(optimisticFilters.creator ?? currentCreator) || null}
            date={(optimisticFilters.date ?? currentDate) || null}
            creatorLabel="Organized by"
            as="h2"
            className="mb-6"
            isBusy={initialHeaderLoading}
            busyIconSize={isDesktop ? 24 : 20}
          />
        </>
      )}

      {/* MAIN LIST */}
      <section>
        {!effectiveIsSearchMode  && (
          <AnimatedText
            as="h2"
            title="More Events"
            containerClassName="text-center"
            // Make the heading an inline-block anchor so absolute loader doesn't affect centering.
            headingClassName="relative inline-block text-3xl lg:text-4xl lg:tracking-wider font-bold font-display text-white opacity-0"
            splitMode={isDesktop ? 'char' : 'word'}
            //Loader dots
            inlineAddon={
              <span
                className="
                  pointer-events-none
                  absolute left-full ml-1
                  -bottom-0.5 md:-bottom-1
                  inline-flex items-end justify-center
                "
                aria-hidden={!initialHeaderLoading}
              >
                {initialHeaderLoading ? (
                    <AnimatedIcon
                      icon={LoadingDotsAnimatedIcon}
                      state="loop"
                      disableInternalHover
                      size={isDesktop ? 22 : 18}
                      className="opacity-90"
                    />
                ) : null}
              </span>
            }
          />
        )}

        <HomeMainEventList
          initialEventsPayload={initialMainListPayload}
          onInitialLoadingChange={handleInitialHeaderLoadingChange}
          scrollTopAnchorRef={effectiveIsSearchMode ? searchResultsTopRef : undefined}
        />
      </section>
    </>
  );
}
