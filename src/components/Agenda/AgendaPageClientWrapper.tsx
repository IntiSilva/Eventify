'use client';

import { useCallback, useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react';
import Link from 'next/link';
import useSWR, { MutatorCallback } from 'swr';
import type { EventWithCreatorAndRsvps } from '@/types/event';
import { useMenu } from '@/contexts/MenuContext';
import TiltedInfiniteList from './tilted-list/TiltedInfiniteList';
import AnimatedText from '@/components/AnimatedText/AnimatedText';
import {
  removeFromAgendaUpcomingList,
  type AgendaListData,
} from '@/lib/mutateHelpers';
import { useMediaQuery, useGlobalScrollGuard } from '@/lib/hooks';
import Searchbar, { type SearchbarFilters } from '@/components/Searchbar/Searchbar';
import { normalizeStringForSearch, normalizeUsername, cn } from '@/lib/utils';
import AutoplayButton from './AutoplayButton';
import ScrollArrowButton from './ScrollArrowButton';
import { ParticlesButton } from '../CommonButtons/ParticlesButton';
import AnimatedIcon from '../LordIcons/AnimatedIcon';
import { ViewAnimatedIcon } from '@/lib/icons';
import { AGENDA_LIST_INFINITE } from '@/lib/constants';

/* ──────────────────────────────────────────────────────────────────
   Types
   ────────────────────────────────────────────────────────────────── */

type Props = {
  initialEvents: EventWithCreatorAndRsvps[];
  swrKey: string;
};

type ViewMode = 'list' | 'tilt';

type SearchIndexRow = {
  id: string;
  title: string;
  description: string;
  location: string;
  category: string;
  creator: string;
  dateYmd: string; // YYYY-MM-DD (local)
};

/* ──────────────────────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────────────────────── */

export default function AgendaPageClientWrapper({ initialEvents, swrKey }: Props) {
  const { open: openMenu } = useMenu();

  // In Agenda we toggle between infinite/finite via a single constant.
  const infinite = AGENDA_LIST_INFINITE;

  // Autoplay controls should only be available when the list is infinite.
  const autoplaySupported = infinite;

  /* State: view mode & autoplay prefs (rehydrated from localStorage) */
  const [viewMode, setViewMode] = useState<ViewMode>('tilt');
  const [autoplayOn, setAutoplayOn] = useState<boolean>(true);
  const [autoplayPauseUntil, setAutoplayPauseUntil] = useState<number>(0); // wrapper-driven soft pause
  const [autoplayBootstrapped, setAutoplayBootstrapped] = useState(false);
  const [bootReady, setBootReady] = useState(false); // defer list render until LS is read

  const pauseTimerRef = useRef<number | null>(null);

  // Persisted preferences (load once before first paint of the list)
  useLayoutEffect(() => {
    try {
      const vm = localStorage.getItem('agenda:viewMode');
      if (vm === 'list' || vm === 'tilt') setViewMode(vm as ViewMode);

      const ap = localStorage.getItem('agenda:autoplay');
      if (ap != null) setAutoplayOn(!(ap === '0' || ap === 'false'));
    } finally {
      setAutoplayBootstrapped(true);
      setBootReady(true);
    }
  }, []);

  /* State: search */
  const [searchActive, setSearchActive] = useState(false);
  const [matchMap, setMatchMap] = useState<Map<string, number>>(new Map());
  const [notFoundText, setNotFoundText] = useState<string | null>(null);
  const [notFoundOpen, setNotFoundOpen] = useState(false);
  const notFoundTimerRef = useRef<number | null>(null);
  const NOT_FOUND_AUTO_MS = 3000; // auto-close in 3s

  function summarizeFilters(f: SearchbarFilters): string {
    const parts: string[] = [];
    if (f.search?.trim()) parts.push(`title "${f.search.trim()}"`);
    if (f.category?.trim()) parts.push(`category ${f.category.trim()}`);
    if (f.location?.trim()) parts.push(`place "${f.location.trim()}"`);
    if (f.creator?.trim()) parts.push(`creator "${f.creator.trim()}"`);
    if (f.date?.trim()) parts.push(`date ${f.date.trim()}`);
    return parts.join(' · ');
  }

  const openNotFound = useCallback((msg: string, ms = NOT_FOUND_AUTO_MS) => {
    // Update text only if it changed
    setNotFoundText((prev) => (prev === msg ? prev : msg));

    // If already open, just refresh the timer
    if (notFoundTimerRef.current) {
      clearTimeout(notFoundTimerRef.current);
      notFoundTimerRef.current = null;
    }
    if (!notFoundOpen) setNotFoundOpen(true);

    notFoundTimerRef.current = window.setTimeout(() => {
      setNotFoundOpen(false); // shadcn handles the animate-out
      notFoundTimerRef.current = null;
    }, ms);
  }, [notFoundOpen]);

  const closeNotFound = useCallback(() => {
    if (notFoundTimerRef.current) return;
    setNotFoundOpen(false); // do not change the text here
  }, []);

  /* Refs & scroll toggles */
  const heroRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useGlobalScrollGuard(listRef, { enabled: true, nativeScrollSelector: '[data-allow-scroll]' });

  const controlsBlockRef = useRef<HTMLDivElement>(null); // Searchbar + pill
  const [aboveH, setAboveH] = useState(0); // height to subtract in "list" mode
  const NAVBAR_SCROLLED_PX = 52;
  const LIST_TOP_GAP_PX = 8; // space you want below the navbar

  const [showingList, setShowingList] = useState(false);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  /* Breakpoints */
  const xs4Up = useMediaQuery('(min-width: 410px)');
  const xs3Up = useMediaQuery('(min-width: 390px)');
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isNarrowScreen = useMediaQuery('(max-width: 640px)');

  
  const effectiveViewMode: ViewMode = isDesktop ? viewMode : 'list';

  /* Density per breakpoint */
  const density = useMemo(
    () =>
      isDesktop
        ? { itemHeight: 150, gap: 12 }
        : xs4Up
          ? { itemHeight: 130, gap: 12 }
          : xs3Up
            ? { itemHeight: 128, gap: 10 }
            : { itemHeight: 120, gap: 10 },
    [xs4Up, xs3Up, isDesktop]
  );

  /* Tilt angle & slight right shift */
  const tiltDeg = isDesktop ? 17 : xs4Up ? 7.5 : xs3Up ? 7.5 : 8;
  const tiltShiftX = useMemo(() => (xs4Up ? 5 : xs3Up ? 4 : 6), [xs4Up, xs3Up]);

  /* Persist view mode on change */
  useEffect(() => {
    try {
      localStorage.setItem('agenda:viewMode', viewMode);
    } catch {}
  }, [viewMode]);

  /* Toggle autoplay (persisted) */
  const toggleAutoplay = useCallback(() => {
     // If autoplay is not supported (finite list), ignore user clicks.
    if (!autoplaySupported) return;
    
    setAutoplayOn((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('agenda:autoplay', next ? '1' : '0');
      } catch {}
      // If user turns PLAY on, clear any pending soft pause window
      if (next) setAutoplayPauseUntil?.(0);
      return next;
    });
  }, [autoplaySupported]);

  /* Soft pause (wrapper-controlled, does not touch persisted pref) */
  const softPauseAutoplay = useCallback((ms: number = 7000) => {
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    setAutoplayPauseUntil(Date.now() + ms);
    pauseTimerRef.current = window.setTimeout(() => {
      setAutoplayPauseUntil(0); // resume if no other constraints
      pauseTimerRef.current = null;
    }, ms);
  }, []);

  /* SWR: server provides data; no fetcher */
  const { data, mutate } = useSWR<AgendaListData>(swrKey, null, {
    fallbackData: initialEvents,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  /* Events to render */
  const events = useMemo(() => data ?? initialEvents, [data, initialEvents]);

  /* Stable order mapping (1-based) */
  const baseOrderMap = useMemo(() => {
    const m = new Map<string, number>();
    events.forEach((ev, i) => m.set(ev.id, i + 1));
    return m;
  }, [events]);

  const getOrderNumber = useCallback(
    (id: string) => baseOrderMap.get(id) ?? null,
    [baseOrderMap]
  );

  /* Mutations */
  const mutateReplaceEvent = useCallback(
    (updated: EventWithCreatorAndRsvps) => {
      const updater: MutatorCallback<AgendaListData> = (curr) => {
        if (!curr) return curr;
        return curr.map((e) => (e.id === updated.id ? updated : e));
      };

      void mutate(updater, { revalidate: false });
    },
    [mutate]
  );


  const mutateRemoveById = useCallback(
    (id: string) => {
      void removeFromAgendaUpcomingList(mutate, id, { current: data, initial: initialEvents });
    },
    [mutate, data, initialEvents]
  );

  /* Ordered events (search-first) */
  const orderedEvents = useMemo(() => {
    if (!searchActive || matchMap.size === 0) return events;

    const matches: typeof events = [];
    const others: typeof events = [];

    for (const ev of events) (matchMap.has(ev.id) ? matches : others).push(ev);

    matches.sort((a, b) => {
      const sa = matchMap.get(a.id)!;
      const sb = matchMap.get(b.id)!;
      if (sb !== sa) return sb - sa;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    return [...matches, ...others];
  }, [events, searchActive, matchMap]);

  /* IDs to highlight when search is active */
  const searchFocusIds = useMemo<ReadonlySet<string> | undefined>(() => {
    if (!searchActive) return undefined;
    if (!matchMap || matchMap.size === 0) return undefined;
    return new Set(matchMap.keys());
  }, [searchActive, matchMap]);

  /* Row shell classes based on search matching */
  const rowShellClasses = useCallback((id: string): string => {
    if (!searchActive || matchMap.size === 0) return '';

    const isMatch = (matchMap.get(id) ?? 0) > 0;

    if (isMatch) {
      // Matched row: subtle neutral shine
      return cn(
        'relative',
        'shine-border',
        'shadow-lg shadow-black/40',
        'transition-[opacity,filter,box-shadow] duration-200'
      );
    }

    // Non-matched row: deemphasize slightly
    return cn('opacity-35', 'saturate-75 contrast-90', 'transition-[opacity,filter] duration-200');
  }, [searchActive, matchMap]);

  /* Open details menu with callbacks */
  const handleDetails = useCallback(
    (ev: EventWithCreatorAndRsvps) => {
      setSelectedRowId(ev.id);
      openMenu(ev.id, {
        mode: 'non-editable',
        onEventUpdate: mutateReplaceEvent,
        onRsvpCancelled: mutateRemoveById,
      });
    },
    [openMenu, mutateReplaceEvent, mutateRemoveById]
  );

  /* ───────────────────────── Scroll helpers & detector ───────────────────────── */

  const [railShifted, setRailShifted] = useState(false);

  const SEAM_PX = 8;       // threshold to consider the list "visible"
  const OVERSHOOT_PX = 24; // small positive overshoot to avoid edge flicker

  // Scroll to the list (land below the seam)
  const scrollToList = useCallback(() => {
    const listTop = listRef.current?.getBoundingClientRect().top ?? 0;
    const top = window.scrollY + listTop + OVERSHOOT_PX;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, []);

  // Scroll back to the hero
  const scrollToHero = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Hysteresis-based detector (list vs hero)
  useEffect(() => {
    let raf = 0;
    const compute = () => {
      if (effectiveViewMode === 'list') {
        const base = NAVBAR_SCROLLED_PX + LIST_TOP_GAP_PX;
        const ENTER = base + 10; // threshold to enter (scrolling down)
        const LEAVE = base + 2;  // threshold to leave (scrolling up)
        const t = controlsBlockRef.current?.getBoundingClientRect().top ?? 0;
        setShowingList((prev) => (prev ? t <= LEAVE : t <= ENTER));
      } else {
        const heroBottom = heroRef.current?.getBoundingClientRect().bottom ?? 0;
        setShowingList(heroBottom <= SEAM_PX);
      }
    };
    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);

       // mark scrolling and assemble idle timer
     isScrollingRef.current = true;
      if (scrollIdleTimerRef.current) {
        clearTimeout(scrollIdleTimerRef.current);
        scrollIdleTimerRef.current = null;
      }
      scrollIdleTimerRef.current = window.setTimeout(() => {
        isScrollingRef.current = false;
        setOrientationShown(desiredOrientationRef.current);
        scrollIdleTimerRef.current = null;
      }, SCROLL_IDLE_MS);
    };
    const onResize = onScroll;

    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (raf) cancelAnimationFrame(raf);
      if (scrollIdleTimerRef.current) {
        clearTimeout(scrollIdleTimerRef.current);
        scrollIdleTimerRef.current = null;
      }
    };
  }, [effectiveViewMode, NAVBAR_SCROLLED_PX, LIST_TOP_GAP_PX, SEAM_PX]);

  // Do not shift the rail in list mode
  useEffect(() => {
    if (effectiveViewMode === 'tilt') setRailShifted(showingList);
  }, [showingList, effectiveViewMode]);

  /* Scroll arrow control */
  const handleArrowClick = useCallback(() => {
    isClickAnimatingRef.current = true;
    if (showingList) {
      if (effectiveViewMode === 'tilt') setRailShifted(false);
      scrollToHero();
    } else {
      if (effectiveViewMode === 'tilt') setRailShifted(true);
      scrollToList();
    }
  }, [showingList, effectiveViewMode, scrollToHero, scrollToList]);

  /* ───────────────────────── Search ───────────────────────── */

  function toLocalYMD(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  const searchIndex = useMemo<SearchIndexRow[]>(() => {
    return events.map((ev) => {

      return {
        id: ev.id,
        title: normalizeStringForSearch(ev.title),
        description: normalizeStringForSearch(ev.description),
        location: normalizeStringForSearch(ev.location),
        category: normalizeStringForSearch(String(ev.category)),
        creator: normalizeUsername(ev.creator.username),
        dateYmd: toLocalYMD(new Date(ev.date)),
      };
    });
  }, [events]);

  const localSuggestionIndex = useMemo(() => {
    return events.map((ev) => {

      return {
        title: ev.title,
        location: ev.location,
        creatorLabel: ev.creator.username,
      };
    });
  }, [events]);

  /** AND estricto: si un filtro está definido y no matchea, descarta la fila.
   *  Devolvemos también un score (solo para ordenar dentro de los matches). */
  function matchesAndScore(row: SearchIndexRow, f: SearchbarFilters): { ok: boolean; score: number } {
    let score = 0;
    // search: alcanza con que aparezca en alguno (title/desc/creator/location)
    if (f.search && f.search.trim()) {
      const q = normalizeStringForSearch(f.search);
      const hitTitle = q && row.title.includes(q);
      const hitDesc = q && row.description.includes(q);
      const hitCreator = q && row.creator.includes(q);
      const hitLoc = q && row.location.includes(q);
      if (!(hitTitle || hitDesc || hitCreator || hitLoc)) return { ok: false, score: 0 };
      // ranking opcional
      if (hitTitle)   score += 5;
      if (hitDesc)    score += 3;
      if (hitCreator) score += 2;
      if (hitLoc)     score += 1;
    }
    if (f.category && f.category.trim()) {
      const cat = normalizeStringForSearch(f.category);
      if (!(cat && row.category.includes(cat))) return { ok: false, score: 0 };
      score += 2;
    }
    if (f.location && f.location.trim()) {
      const loc = normalizeStringForSearch(f.location);
      if (!(loc && row.location.includes(loc))) return { ok: false, score: 0 };
      score += 2;
    }
    if (f.creator && f.creator.trim()) {
      const cr = normalizeUsername(f.creator);
      if (!(cr && row.creator.includes(cr))) return { ok: false, score: 0 };
      score += 2;
    }
    if (f.date && f.date.trim()) {
      if (row.dateYmd !== f.date) return { ok: false, score: 0 };
      score += 2;
    }
    return { ok: true, score };
  }

  const handleUserSearch = useCallback(
    (filters: SearchbarFilters) => {
      const n = (s?: string | null) => normalizeStringForSearch(s ?? '');
      const hasAny =
        !!n(filters.search) ||
        !!n(filters.category) ||
        !!n(filters.location) ||
        !!n(filters.creator) ||
        !!filters.date;

      if (!hasAny) {
        setSearchActive(false);
        setMatchMap(new Map());
        return;
      }

      const m = new Map<string, number>();
      for (const row of searchIndex) {
        const { ok, score } = matchesAndScore(row, filters);
        if (ok) m.set(row.id, score);
      }
 

      if (m.size === 0) {
        const summary = summarizeFilters(filters);
        const msg = summary ? `No results for ${summary}.` : 'No results with those filters.';
        openNotFound(msg); // open + program autoclose
      } else if (notFoundOpen && !notFoundTimerRef.current) {
        closeNotFound(); // close the popup if it was open
      }

      // When search turns on → clear selection and (on mobile) scroll to hero
      setSelectedRowId(null);
      setSearchActive(true);
      setMatchMap(m);

      if (!isDesktop) {
        setRailShifted(false);
        scrollToHero();
      }
    },
    [searchIndex, isDesktop, scrollToHero, notFoundOpen, openNotFound, closeNotFound]
  );

  /* ───────────────────────── View mode switches  ───────────────────────── */

  const handleSwitchToTilt = useCallback(() => {
    // 1) clear selection before switching
    setSelectedRowId(null);
    // 2) scroll to top and align rail
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setRailShifted(false);
    // 3) switch on the next frame (avoid running calculations mid-scroll)
    setTimeout(() => setViewMode('tilt'), 200);
  }, []);

  const handleSwitchToList = useCallback(() => {
    setSelectedRowId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setRailShifted(false);
    setTimeout(() => setViewMode('list'), 200);
  }, []);

  /* ───────────────────────── Derived layout & autoplay ───────────────────────── */

  // Visual orientation of the scroll arrow
  type Orientation = 'up' | 'down';
  const desiredOrientation: Orientation = showingList ? 'up' : 'down';

  // Scroll locks & orientation (delay rotation until click + scroll settle)
  const SCROLL_IDLE_MS = 400;
  const isClickAnimatingRef = useRef(false);
  const isScrollingRef = useRef(false);

  const [orientationShown, setOrientationShown] = useState<Orientation>(desiredOrientation);
  const desiredOrientationRef = useRef<Orientation>(desiredOrientation);
  desiredOrientationRef.current = desiredOrientation;

  const scrollIdleTimerRef = useRef<number | null>(null);

  const LIST_ROW_WIDTH_MOBILE = 'min(92vw, 620px)';
  const LIST_ROW_WIDTH_DESKTOP = 'clamp(820px, 66vw, 1120px)';
  const contentWidth =
    effectiveViewMode === 'list'
      ? (isDesktop ? LIST_ROW_WIDTH_DESKTOP : LIST_ROW_WIDTH_MOBILE)
      : (isDesktop ? 'clamp(720px, 58vw, 880px)' : '100%');

  // Parallax only for desktop + tilt
  const parallaxEnabled = isDesktop && effectiveViewMode === 'tilt';

  // Autoplay per mode (wrapper global gate is applied here)
  const AUTOPLAY_TILT_PXPS = 40;
  const AUTOPLAY_LIST_PXPS = 24;

  const effectiveAutoplayPxPerSec = useMemo(() => {
    // Hard gate: if the underlying list is finite, never drive autoplay.
    if (!autoplaySupported) return 0;
    if (!autoplayOn) return 0;
    // Respect current soft-pause window
    if (autoplayPauseUntil > Date.now()) return 0;
    // Disable while searching or with a selection
    if (searchActive || !!selectedRowId) return 0;
    // Normal case: speed based on mode
    return viewMode === 'tilt' ? AUTOPLAY_TILT_PXPS : AUTOPLAY_LIST_PXPS;
  }, [autoplaySupported, autoplayOn, searchActive, selectedRowId, autoplayPauseUntil, viewMode]);


  const pillVisible =
  bootReady && (viewMode === 'tilt' ? autoplayBootstrapped : true);

  /* Measure controls block height (for list container height calc) */
  useLayoutEffect(() => {
    const block = controlsBlockRef.current;
    if (!block) return;
    const h = Math.ceil(block.getBoundingClientRect().height);
    setAboveH(h);
  }, [isDesktop]);

  /* Clear selection if the selected item leaves the dataset */
  useEffect(() => {
    if (selectedRowId && !events.some((e) => e.id === selectedRowId)) {
      setSelectedRowId(null);
    }
  }, [events, selectedRowId]);

  /* On tab visibility loss → clear selection */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        setSelectedRowId(null);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  /* Render budget per breakpoint */
  const lgUp = useMediaQuery('(min-width: 1024px)');
  const maxRenderCount = useMemo(() => (lgUp ? 30 : isDesktop ? 24 : 18), [lgUp, isDesktop]);

  /* Stable row className getter */
  const getRowClassName = useCallback(
    (ev: EventWithCreatorAndRsvps) =>
      `transition-all duration-200 will-change-transform ${rowShellClasses(ev.id)}`,
    [ rowShellClasses]
  );

  /* Cleanup timers on unmount */
  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) {
        clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = null;
      }
      if (notFoundTimerRef.current) {
        clearTimeout(notFoundTimerRef.current);
        notFoundTimerRef.current = null;
      }
    };
  }, []);

  /* ───────────────────────── Empty state ───────────────────────── */

if (!events.length) {
  return (
    <div className="px-3 py-8 md:py-10">
      <div className="mx-auto max-w-lg">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/5 supports-[backdrop-filter]:backdrop-blur-[6px] p-6 md:p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
          <div className="pointer-events-none absolute right-0 top-0 translate-x-1/4 -translate-y-1/4 h-40 w-40 rounded-full bg-emerald-500/12 blur-3xl" />
          <div className="pointer-events-none absolute left-0 bottom-0 -translate-x-1/4 translate-y-1/4 h-48 w-48 rounded-full bg-rose-500/12 blur-3xl" />

          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10 shadow-inner">

   
            <AnimatedIcon icon={ViewAnimatedIcon} state="in" size={24} colors={{ primary: '#e4e4e7' }} aria-hidden="true" />
          </div>

          <h3 className="text-center text-xl md:text-2xl font-heading font-semibold text-white tracking-tight">
            No upcoming events
          </h3>
          <p className="mt-2 text-center text-sm md:text-base text-zinc-200 leading-relaxed">
            RSVP to an event and it will show up here.
          </p>

          <div className="mt-5 flex justify-center">
            <ParticlesButton className="inline-flex h-9 md:h-10 items-center px-4 md:px-5 rounded-xl text-[13px] md:text-sm font-display">
              <Link href="/">Discover events</Link>
            </ParticlesButton>
          </div>
        </div>
      </div>
    </div>
  );
}
  /* ───────────────────────── Main render ───────────────────────── */

  return (
    <div className="relative w-full">
      {/* HERO */}
      <div ref={heroRef} className="relative w-full min-h-[222px] xs4:min-h-[254px] md:min-h-[246px]">
        <AnimatedText
          as="h1"
          title="My Agenda"
          subtitle={`Upcoming: ${events.length}`}
          containerClassName="relative z-10"
          headingClassName="text-5xl xs4:text-6xl md:text-7xl font-semibold font-display text-start text-zinc-100 leading-none md:leading-normal tracking-widest"
          subtitleClassName="mt-3 xs4:mt-4 md:mt-2 text-sm xs4:text-base md:text-lg text-start text-zinc-300 italic"
        />

        <div ref={controlsBlockRef}>
          {/* Searchbar */}
          <div className="mt-3 md:mt-4 w-full md:w-[420px]">
            <Searchbar
              isScrolled={false}
              isDesktop={isDesktop}
              isNarrowScreen={isNarrowScreen}
              onSearchSubmit={handleUserSearch}
              suggestionMode="local"
              suggestionScope={{ type: 'agenda' }}
              localSuggestionIndex={localSuggestionIndex}
              notFoundOpen={notFoundOpen}
              notFoundText={notFoundText}
              onNotFoundClose={closeNotFound}
            />
          </div>

          {/* Controls (List/Tilt) + rail anchored to the pill */}
          <div className="mt-4 relative">
            {/* Pill row; in LIST we also place the controls to the left */}
            <div className="flex items-center justify-end gap-2">
              {/* Single controls block that changes layout depending on the mode */}
              <div
                className={cn(
                  effectiveViewMode === 'list'
                    ? 'order-1 static flex items-center gap-2' // LIST: inline left of the pill
                    : [
                        // TILT: rail below the pill
                        'order-1 absolute right-0 top-full mt-2 z-20',
                        'flex flex-col items-end gap-2',
                        'transition-transform duration-300 ease-in will-change-transform',
                        railShifted ? 'translate-y-14 xl:translate-y-18' : 'translate-y-0',
                      ]
                )}
              >
                {/* Autoplay toggle (visible in both modes) */}
                {autoplayBootstrapped && autoplaySupported && (
                  <AutoplayButton
                    isPlaying={autoplayOn}
                    onToggle={toggleAutoplay}
                    size={isDesktop ? 28 : 24}
                    colors={{ primary: '#E5E7EB' }}
                    className="h-8 w-8"
                    bootstrapped={autoplayBootstrapped}
                  />
                )}

                <ScrollArrowButton
                  desiredOrientation={orientationShown}
                  onClick={handleArrowClick}
                  isDesktop={isDesktop}
                  size={isDesktop ? 28 : 24}
                  inColors={{ primary: '#E5E7EB' }}
                  hoverColors={{ primary: '#E5E7EB' }}
                  actionColors={{ primary: '#E5E7EB' }}
                  ariaLabel={showingList ? 'View hero' : 'View full list'}
                  className="h-8 w-8"
                  onActionComplete={() => {
                    isClickAnimatingRef.current = false;
                    if (!isScrollingRef.current) {
                      setOrientationShown(desiredOrientationRef.current);
                    }
                  }}
                />
              </div>

              {/* Mode toggle pill */}
              {isDesktop && (
                  <div 
                    className={cn(
                      "order-2 inline-flex rounded-full border border-zinc-700 overflow-hidden",
                      "motion-safe:transition-opacity motion-safe:duration-300 motion-safe:ease-in",
                      pillVisible ? "opacity-100" : "opacity-0 pointer-events-none select-none"
                    )}
                    aria-hidden={!pillVisible}>
                    <button
                      type="button"
                      onClick={handleSwitchToList}
                      aria-pressed={viewMode === 'list'}
                      className={`px-3 py-1.5 text-sm cursor-pointer ${
                        viewMode === 'list'
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      List
                    </button>
                    <button
                      type="button"
                      onClick={handleSwitchToTilt}
                      aria-pressed={viewMode === 'tilt'}
                      className={`px-3 py-1.5 text-sm cursor-pointer ${
                        viewMode === 'tilt'
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Tilt
                    </button>
                  </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* LIST: full-bleed, fixed 100dvh. Bottom bleed to cancel layout pb-6 */}
      <div
        ref={listRef}
        className={cn(
          'relative w-[100vw] -mx-[calc((100vw-100%)/2)]',
          'overflow-hidden -mb-6',
        )}
      >
        {bootReady ? (
          <TiltedInfiniteList
            events={orderedEvents}
            onDetails={handleDetails}
            itemHeight={density.itemHeight}
            gap={density.gap}
            buffer={5}
            width={contentWidth}
            containerHeight={
              effectiveViewMode === 'list'
                ? `calc(100dvh - ${aboveH + NAVBAR_SCROLLED_PX + LIST_TOP_GAP_PX}px)`
                : '100dvh'
            }
            /* No tilt in List */
            tiltEnabled={effectiveViewMode === 'tilt'}
            tiltDirection="left"
            tiltAmountDeg={effectiveViewMode === 'tilt' ? tiltDeg : 0}
            tiltShiftX={effectiveViewMode === 'tilt' ? tiltShiftX : 0}
            /* Autoplay only in Tilt */
            autoplayPxPerSec={effectiveAutoplayPxPerSec}
            autoplayDirection="up"
            pauseOnHover
            onPauseAutoplay={() => softPauseAutoplay(3000)}
            selectedRowId={selectedRowId}
            onSelectRow={setSelectedRowId}
            getRowClassName={getRowClassName}
            searchActive={searchActive}
            searchFocusIds={searchFocusIds}
            maxRenderCount={maxRenderCount}
            initialPeekRatio={effectiveViewMode === 'list' ? -0.075 : 0.35}
            showOrderNumbers={!searchActive}
            getOrderNumber={getOrderNumber}
            wheelFeel="buttery"
            wheelFeelOverride={{ gain: 0.7 }}
            parallaxEnabled={parallaxEnabled}
            infinite={infinite}

          />
        ) : (
          /* Placeholder with the same height to avoid layout jumps while reading LS */
          <div
            style={{
              height:
                viewMode === 'list'
                  ? `calc(100dvh - ${aboveH + NAVBAR_SCROLLED_PX + LIST_TOP_GAP_PX}px)`
                  : '100dvh',
            }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
