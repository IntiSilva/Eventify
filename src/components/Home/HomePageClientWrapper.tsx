'use client';

import { useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { swrKeys } from '@/lib/swrKeys';
import { useSearchContext } from '@/contexts/SearchContext';
import { buildEventsQS } from '@/lib/utils';
import { useMediaQuery } from '@/lib/hooks';

import HomeMainEventList from './home-main-event-list/HomeMainEventList';
import HomeArcCarousel from './HomeArcCarousel';
import { BlobButton } from '../CommonButtons/BlobButton';
import { AuroraButton } from '../CommonButtons/AuroraButton';
import { ParticlesButton } from '../CommonButtons/ParticlesButton';
import AnimatedText from '../AnimatedText/AnimatedText';
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

  /**
   * Public search handler for the Home page.
   * Builds URLSearchParams from the Searchbar filters and navigates to "/".
   * Memoized for clean effect deps.
   */
  const handlePublicSearch = useCallback((filters: SearchbarFilters) => {
    const qs = buildEventsQS(filters); // sin viewTz en la URL pública
    router.push(qs ? `/?${qs}` : '/', { scroll: false });
  }, [router]);

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
      {!isSearchMode ? (
        <>
          {/* UPCOMING */}
          <HeaderFullWidth title="Upcoming Events" withActions userRole={userRole} isDesktop={isDesktop}/>
          {/* 
            Full-bleed section element for the carousel.
            We keep the simple pattern `w-screen -mx-[calc(50vw-50%)]` for edge-to-edge visuals,
            and rely on the global `html, body { overflow-x: clip; }` to prevent horizontal scroll.
            Thanks to `scrollbar-gutter: stable` and the body-compensation neutralization,
            opening the desktop Dialog no longer introduces a right-side gap nor triggers
            resize cascades in the carousel/background.
          */}
          <section className="relative w-screen -mx-[calc(50vw-50%)]">
            {upcomingEvents.length ? (
              <HomeArcCarousel
                fallbackData={upcomingEvents}
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
              <span className='relative -top-0.5'>
              <FeaturedThresholdTooltip
                className="bg-black hover:bg-black focus:bg-black"     // margen con el título
                side="top"
                align="start"
                triggerMode="both"   // hover + click
              />
              </span>
            }
            isDesktop={isDesktop}
          />
          <section className="relative w-screen -mx-[calc(50vw-50%)]">
            {featuredEvents.length ? (
              <HomeArcCarousel
                fallbackData={featuredEvents}
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
        <SearchResultsTitle
          searchTerm={currentSearchTerm}
          category={currentCategory}
          location={currentLocation}
          creator={currentCreator}
          date={currentDate}
          creatorLabel="Organized by"
          as="h2"
          className="mb-6"
        />
      )}

      {/* MAIN LIST */}
      <section>
        {!isSearchMode && (
          <AnimatedText
            as="h2"
            title="More Events"
            containerClassName="text-center"
            headingClassName="text-3xl lg:text-4xl lg:tracking-wider font-bold font-display text-white mb-6 lg:mb-8 opacity-0"
            splitMode={isDesktop ? 'char' : 'word'}
          />
        )}

        <HomeMainEventList
          initialEventsPayload={initialMainListPayload}
        />
      </section>
    </>
  );
}
