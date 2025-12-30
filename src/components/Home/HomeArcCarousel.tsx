'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import useSWR from 'swr';
import { useSWRConfig } from 'swr';
import {
  motion,
  useMotionValue,
  cubicBezier,
  useSpring,
  useMotionValueEvent,
  wrap,
  animate,
  type AnimationPlaybackControls,
  type PanInfo,
  type Variants,
  type Transition,
} from 'motion/react';

import {
  useStoreWriters,
  useList,
  useEventsByIds,
  useFeaturedSWRKeys,
  useFeaturedChange,
  useEntitiesRef,
} from '@/contexts/EventsContext';
import { useViewerTz } from '@/contexts/ViewerTzContext';
import { patchEventEverywhere, type GlobalMutate } from '@/lib/mutateHelpers';
import { useBreakpointCarousel, type CarouselBreakpointKey } from '@/lib/hooks';

import type { EventWithCreatorAndRsvps } from '@/types/event';
import type { PaginatedApiResponse, PaginatedSuccess } from '@/types/api';
import ArcEventCard from '../Cards/ArcEventCard';
import { useMenu } from '@/contexts/MenuContext';
import { FEATURED_LIMIT } from '@/lib/constants';


/* =========================================================================
   Fetching
   ========================================================================= */

type ApiEventsResponse = PaginatedApiResponse<EventWithCreatorAndRsvps>;
type ApiEventsSuccess  = PaginatedSuccess<EventWithCreatorAndRsvps>;

/**
 * SWR fetcher for the carousel.
 * - Forces `cache: "no-store"` so the carousel always sees fresh data.
 * - Only resolves when `success: true`, otherwise throws a descriptive error.
 */
async function fetcher(url: string): Promise<ApiEventsSuccess> {
  const res = await fetch(url, { cache: "no-store" });

  let json: ApiEventsResponse | null = null;
  try {
    json = (await res.json()) as ApiEventsResponse;
  } catch {
    // non-json edge case (e.g. HTML error page)
  }

  if (!res.ok || !json || !json.success) {
    const message =
      json && !json.success ? json.error : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return json; // success:true, data, metadata
}

/* =========================================================================
   Layout & tuning
   ========================================================================= */

const BREAKPOINTS: Record<
  CarouselBreakpointKey,
  {
    cardWidth: number;
    gap: number;
    activeCards: number;
    curve: number;
    rotationFactor: number;
    popDistance: number;
  }
> = {
  base: { cardWidth: 145, gap: 19, activeCards: 2, curve: 20, rotationFactor: 1.3, popDistance: 30 },
  xs3:  { cardWidth: 157, gap: 26, activeCards: 2, curve: 14, rotationFactor: 4,   popDistance: 35 },
  xs4:  { cardWidth: 170, gap: 25, activeCards: 2, curve: 22, rotationFactor: 2,   popDistance: 38 },
  md:   { cardWidth: 250, gap: 55, activeCards: 4, curve: 45, rotationFactor: 6,   popDistance: 40 },
};

const MIN_SNAP_DISTANCE = 16;
const MIN_SNAP_VELOCITY = 150;

// Drag feel: how much the track moves relative to the pointer
const DRAG_FACTOR_DESKTOP = 0.8;
const DRAG_FACTOR_MOBILE  = 0.95;

// Inertia projection: how much swipe velocity affects the snap target
const VELOCITY_PROJECTION_DESKTOP = 0.22;
const VELOCITY_PROJECTION_MOBILE  = 0.30;

// Hard cap: maximum number of cards that can move per swipe
const MAX_CARDS_PER_SWIPE_DESKTOP = 3;
const MAX_CARDS_PER_SWIPE_MOBILE  = 2;

// Timing constants
const FLIP_MS = 500;
const EXIT_MS = 380;
const ENTER_DURATION_MS = 720;

const ENTER_TWEEN: Transition = {
  type: 'tween',
  duration: ENTER_DURATION_MS / 1000,
  ease: cubicBezier(0.22, 0.8, 0.2, 1),
};

const cardVariants: Variants = {
  enter:  { y: 84,  opacity: 0, scale: 0.965 },
  normal: (isEntering: boolean) => ({
    y: 0, opacity: 1, scale: 1,
    transition: isEntering ? ENTER_TWEEN : { duration: 0.001 }
  }),
  leave:  { y: 56,  opacity: 0, scale: 0.96, transition: { duration: EXIT_MS / 1000, ease: 'easeIn' } },
};

/* =========================================================================
   Helpers
   ========================================================================= */

type PanEvent = PointerEvent | MouseEvent | TouchEvent;
const MOUSE_PID = -1 as const;

/**
 * Normalizes a "pointer id" across Pointer / Touch / Mouse events.
 * We treat mouse as a single synthetic pointer with id = -1.
 */
const getPointerId = (e: PanEvent): number | null => {
  if ('pointerId' in e) return (e as PointerEvent).pointerId;
  if ('changedTouches' in e && e.changedTouches && e.changedTouches.length > 0) {
    return e.changedTouches[0].identifier ?? null;
  }
  return MOUSE_PID;
};

type HasIdDate = Pick<EventWithCreatorAndRsvps, 'id' | 'date'>;

/**
 * Stable ordering for events:
 * - primary: date ascending
 * - secondary: id ascending (tie-breaker for equal dates)
 */
const byDateIdAsc = (a: HasIdDate, b: HasIdDate) => {
  const ta = a.date instanceof Date ? a.date.getTime() : new Date(a.date).getTime();
  const tb = b.date instanceof Date ? b.date.getTime() : new Date(b.date).getTime();
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
};

/**
 * Maps a logical index (0..N-1, repeated infinitely) into
 * an absolute index inside the current visible window.
 *
 * This is used for the featured "enter" animation to decide whether the
 * newly inserted item is actually within the current viewport slice.
 */
function mapLogicalToAbsInWindow(
  targetLogical: number,
  total: number,
  windowStart: number,
  windowEnd: number
) {
  if (total <= 0) return -1;
  let abs = targetLogical;
  while (abs < windowStart) abs += total;
  while (abs > windowEnd) abs -= total;
  return abs >= windowStart && abs <= windowEnd ? abs : -1;
}

/* =========================================================================
   Props
   ========================================================================= */
type Props = {
  listName: 'featured' | 'upcoming';
  swrKey: string;
  fallbackData?: EventWithCreatorAndRsvps[];
};

/* =========================================================================
   Component
   ========================================================================= */
export default function HomeArcCarousel({ listName, swrKey, fallbackData }: Props) {
  /* ---------------- Derived list name ---------------- */
  const resolvedListName: 'featured' | 'upcoming' = useMemo(() => {
    if (listName) return listName;
    return swrKey.includes('featured=true') ? 'featured' : 'upcoming';
  }, [listName, swrKey]);

  /* ---------------- Local state ---------------------- */
  const [viewportWidth, setViewportWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  // Membership animations: id that should "enter" or "leave" with a vertical tween
  const [enteringId, setEnteringId] = useState<string | null>(null); // real-card enter
  const [leavingId, setLeavingId] = useState<string | null>(null);   // slide-down leave

  // Last "press" cancel callback registered by an ArcEventCard
  const cancelPressRef = useRef<(() => void) | null>(null);

  /**
   * Cards call this to register a cancel-press handler.
   * We assume only one card is "pressed" at a time, so we only store the last one.
   */
  const registerCancelPress = useCallback((cb: () => void) => {
    cancelPressRef.current = cb;

    // Return an unsubscribe so the card can clean up safely.
    return () => {
      if (cancelPressRef.current === cb) {
        cancelPressRef.current = null;
      }
    };
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  /* ---------------- Virtualization (window) ------------ */
  // Index of the first visible card in the infinite sequence (used to rebuild the window)
  const lastFirstVisibleIndex = useRef<number | null>(null);

  /**
   * cardsToRender:
   * - id: event id
   * - index: "infinite" index in the track (can be negative or > dataEvents.length)
   * - renderIndex: local index within the current React render
   */
  const [cardsToRender, setCardsToRender] = useState<
    Array<{ id: string; index: number; renderIndex: number }>
  >([]);

  // Prevents the motion listener from rebuilding the window while we are in the middle of a FLIP commit
  const isCommittingRef = useRef(false);

  const { open: openMenu, isOpen: isMenuOpen } = useMenu();

  /* ---------------- Store writers & SWR config ------- */
  const { upsertEvents, setList } = useStoreWriters();
  const { registerFeaturedKey, unregisterFeaturedKey } = useFeaturedSWRKeys();
  const entitiesRef = useEntitiesRef();

  /* ---------------- Viewer TZ + effective SWR key ---- */
  const { viewerTz } = useViewerTz();
  const effectiveKey = useMemo(() => {
    const [path, query = ''] = swrKey.split('?');
    const params = new URLSearchParams(query);
    if (viewerTz) params.set('viewTz', viewerTz);
    return `${path}?${params.toString()}`;
  }, [swrKey, viewerTz]);

  /* ---------------- SWR fetch + normalize ------------ */

  // Bridge fallbackData (array) into the typed SWR response shape
  const fallbackSuccess: ApiEventsSuccess | undefined = fallbackData
    ? {
        success: true,
        data: fallbackData,
        metadata: {
          totalEvents: fallbackData.length,
          totalPages: 1,
          currentPage: 1,
          eventsPerPage: fallbackData.length,
        },
      }
    : undefined;

  useSWR(
    effectiveKey,
    fetcher,
    {
      fallbackData: fallbackSuccess,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateOnMount: false,
      dedupingInterval: 60_000,
      onSuccess: (res) => {
        const arr = res.data;

        // 1) Normalize entities into the global store
        upsertEvents(arr);

        // 2) For featured, apply the same policy as tryInsert:
        //    byDateIdAsc + FEATURED_LIMIT to keep the list deterministic
        const normalized = resolvedListName === 'featured'
          ? arr.slice().sort(byDateIdAsc).slice(0, FEATURED_LIMIT)
          : arr;

        const nextIds = normalized.map(e => e.id);
        setList(resolvedListName, nextIds);
      }
    }
  );

  /* ---------------- Read list & entities -------------- */
  const ids = useList(resolvedListName);
  const eventsFromStore = useEventsByIds(ids);
  // Prefer store ids, but fall back to SSR/prop fallbackData ids so the first paint can render a track.
  const sourceIds = useMemo(() => {
    if (ids.length) return ids;
    if (fallbackData?.length) return fallbackData.map((e) => e.id);
    return [];
  }, [ids, fallbackData]);

  const sourceIdsKey = useMemo(() => sourceIds.join('|'), [sourceIds]);

  const dataEvents = useMemo<EventWithCreatorAndRsvps[]>(() => {
    if (eventsFromStore.length) return eventsFromStore;
    if (fallbackData?.length)   return fallbackData;
    return [];
  }, [eventsFromStore, fallbackData]);

  // Map for quick entities lookup (prefer store over fallback)
  const eventsMap = useMemo(() => {
    const m = new Map<string, EventWithCreatorAndRsvps>();
    for (const e of eventsFromStore) m.set(e.id, e);
    return m;
  }, [eventsFromStore]);

  /* ---------------- Breakpoints & layout -------------- */
  const breakpointMap = useMemo(() => ({ xs3: 390, xs4: 410, md: 768 }), []);
  const currentBreakpoint = useBreakpointCarousel(breakpointMap);
  const { cardWidth, gap, activeCards, curve, rotationFactor, popDistance } = useMemo(
    () => BREAKPOINTS[currentBreakpoint],
    [currentBreakpoint]
  );
  const isEven = activeCards % 2 === 0;
  const cardTotalWidth = cardWidth + gap;

  const isDesktop = currentBreakpoint === 'md';
  // Extra cards rendered outside the viewport for smoothness
  const RENDER_BUFFER = isDesktop ? 4 : 1;

  /* ---------------- Motion (drag→spring) --------------- */
  const dragX = useMotionValue(0);
  const smoothX = useSpring(dragX, {
    stiffness: currentBreakpoint === 'base' ? 175 : 215,
    damping: currentBreakpoint === 'base' ? 40 : 46,
    mass: 2.8,
  });
  const releaseAnimRef = useRef<AnimationPlaybackControls | null>(null);

  const stopReleaseAnim = () => {
    releaseAnimRef.current?.stop();
    releaseAnimRef.current = null;
  };


  /**
   * Rebuilds the window of visible cards whenever the "first visible index"
   * changes, based on the smoothed spring value.
   */
  useMotionValueEvent(smoothX, 'change', (latest) => {
    if (dataEvents.length === 0 || viewportWidth === 0 || isCommittingRef.current) return;

    const firstVisibleIndex = Math.floor((-latest - cardTotalWidth) / cardTotalWidth);
    if (lastFirstVisibleIndex.current !== firstVisibleIndex) {
      lastFirstVisibleIndex.current = firstVisibleIndex;

      const visibleCardCount =
        Math.ceil((viewportWidth + 2 * cardTotalWidth) / cardTotalWidth) + RENDER_BUFFER;

      const newCards = Array.from({ length: visibleCardCount }).map((_, i) => {
        const cardIndex = firstVisibleIndex + i;
        // `wrap` turns the infinite index into a stable event index (0..N-1)
        const eventIndex = wrap(0, dataEvents.length, cardIndex);
        const base = dataEvents[eventIndex];
        return { id: base.id, index: cardIndex, renderIndex: i };
      });

      setCardsToRender(newCards);
    }
  });

  /* ---------------- Register featured SWR key ---------- */
  useEffect(() => {
    if (resolvedListName !== 'featured' || !effectiveKey) return;
    registerFeaturedKey(effectiveKey);
    return () => unregisterFeaturedKey(effectiveKey);
  }, [resolvedListName, effectiveKey, registerFeaturedKey, unregisterFeaturedKey]);

  /* ---------------- Measure container width ------------ */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const w = Math.round(el.offsetWidth);
      // Avoid thrashing state for tiny sub-pixel changes
      setViewportWidth((prev) => (Math.abs(w - prev) < 1 ? prev : w));
    };

    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------------- Initial alignment ------------------ */
  const alignedOnceRef = useRef(false);

  /**
   * Align the carousel so that the "active zone" is centered
   * around the middle of the container on first layout.
   */
  useEffect(() => {
    if (viewportWidth === 0 || alignedOnceRef.current || dataEvents.length === 0) return;

    const alignmentPoint = isEven
      ? viewportWidth / 2 - cardWidth - gap / 2
      : viewportWidth / 2 - cardWidth / 2;

    dragX.set(alignmentPoint);
    alignedOnceRef.current = true;
  }, [viewportWidth, isEven, cardWidth, gap, dragX, dataEvents.length]);

  /* ---------------- First window build ----------------- */
  
  /**
   * Build an initial window for SSR / first paint, based on the current dragX.
   * After this, the motion listener will keep it updated.
   */
  useEffect(() => {
    if (sourceIds.length === 0 || viewportWidth === 0) return;

    const firstVisible = Math.floor((-dragX.get() - cardTotalWidth) / cardTotalWidth);
    const visibleCount =
      Math.ceil((viewportWidth + 2 * cardTotalWidth) / cardTotalWidth) + RENDER_BUFFER;

    const fresh = Array.from({ length: visibleCount }, (_, i) => {
      const cardIdx = firstVisible + i;
      const evtIdx = wrap(0, sourceIds.length, cardIdx);
      const id = sourceIds[evtIdx];
      return { id, index: cardIdx, renderIndex: i };
    });

    // Schedule the setState inside rAF to avoid layout thrash during commit
    const id = requestAnimationFrame(() => {
      setCardsToRender((prev) => {
        if (
          prev.length === fresh.length &&
          prev.every((p, i) => p.index === fresh[i].index && p.id === fresh[i].id)
        ) {
          return prev;
        }
        return fresh;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [sourceIds, sourceIdsKey, viewportWidth, cardTotalWidth, dragX, dataEvents.length, RENDER_BUFFER]);

  /* ---------------- One-time SSR hydration ------------- */
  /**
   * If we land with fallbackData but the list is still empty in the store,
   * hydrate the store once and wire the list to those ids.
   */
  const hydratedOnce = useRef(false);
  useEffect(() => {
    if (hydratedOnce.current || !fallbackData?.length || ids.length) return;
    upsertEvents(fallbackData);
    setList(resolvedListName, fallbackData.map((e) => e.id));
    hydratedOnce.current = true;
  }, [fallbackData, resolvedListName, ids.length, upsertEvents, setList]);

  /* ---------------- FLIP helpers ----------------------- */
  /**
   * Measure current rects for each event.id visible in DOM.
   * We map by event.id (stable identity). If duplicates appear (very small lists),
   * we keep the first occurrence — good enough for neighbor reflow.
   */
  const measureRects = useCallback(() => {
    const el = trackRef.current;
    const map = new Map<string, DOMRect>();
    if (!el) return map;
    el.querySelectorAll<HTMLElement>('[data-event-id]').forEach((node) => {
      const id = node.dataset.eventId!;
      if (!map.has(id)) {
        map.set(id, node.getBoundingClientRect());
      }
    });
    return map;
  }, []);

  /**
   * FLIP: animate neighbors from previous to next rects.
   * We key by event.id to follow the same item across reorders.
   */
  const flip = useCallback((prev: Map<string, DOMRect>, next: Map<string, DOMRect>) => {
    next.forEach((to, id) => {
      const from = prev.get(id);
      if (!from) return;
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (dx === 0 && dy === 0) return;

      const el = trackRef.current?.querySelector<HTMLElement>(`[data-event-id="${id}"]`);
      if (!el) return;

      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }],
        { duration: FLIP_MS, easing: 'cubic-bezier(.2,.8,.2,1)' }
      );
    });
  }, []);

  /* ---------------- Featured membership (BUS) ---------- */
  /**
   * Reacts to "featured" membership changes broadcasted from elsewhere.
   * Handles both:
   * - ENTER: inserting the event in the correct sorted position (+ optional enter + FLIP)
   * - EXIT: animating the removal when the event is visible
   */
  useFeaturedChange(({ id, toFeatured }) => {
    if (resolvedListName !== 'featured') return;

    const currentEvents = eventsFromStore;
    const currentIds = currentEvents.map((e) => e.id);

    // Visible window (if empty → commit directly, no animation)
    const hasWindow = cardsToRender.length > 0;
    const windowStart = hasWindow ? Math.min(...cardsToRender.map((c) => c.index)) : 0;
    const windowEnd   = hasWindow ? Math.max(...cardsToRender.map((c) => c.index)) : -1;

    // Best-effort candidate resolver (store/ref first)
    const resolveCandidate = (): EventWithCreatorAndRsvps | undefined =>
      entitiesRef.current[id] ||
      eventsMap.get(id) ||
      (fallbackData ?? []).find((e) => e.id === id) ||
      currentEvents.find((e) => e.id === id);

    if (toFeatured) {
      // ENTER: only if the candidate actually falls within the limited cut
      const tryInsert = (candidate: EventWithCreatorAndRsvps) => {
        const nextSorted = [...currentEvents, candidate].sort(byDateIdAsc);
        // Same rule as onSuccess (order + FEATURED_LIMIT)
        const limited = nextSorted.slice(0, FEATURED_LIMIT);
        const nextIds = limited.map(e => e.id);

        // 1) If it doesn't make the limit → do nothing
        if (!nextIds.includes(candidate.id)) return;

        // 2) If the order doesn't change → do nothing
        const sameOrder =
          currentIds.length === nextIds.length &&
          currentIds.every((id, i) => id === nextIds[i]);
        if (sameOrder) return;

        // 3) No visible window → commit directly (no FLIP, no "enter")
        if (!hasWindow) { setList('featured', nextIds); return; }

        // 4) If the candidate lands outside the visible window → commit without animating
        const targetLogical = limited.findIndex(e => e.id === candidate.id);
        const totalAfter = limited.length;
        const absIndex = mapLogicalToAbsInWindow(targetLogical, totalAfter, windowStart, windowEnd);
        if (absIndex === -1) { setList('featured', nextIds); return; }

        // 5) Visible → tween the candidate + FLIP neighbors
        isCommittingRef.current = true;
        const prev = measureRects();

        setEnteringId(candidate.id);
        setList('featured', nextIds);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const next = measureRects();
            flip(prev, next);
            isCommittingRef.current = false;
          });
        });

        setTimeout(() => setEnteringId(null), ENTER_DURATION_MS + 40);
      };

      const cand = resolveCandidate();
      if (cand) {
        tryInsert(cand);
        return;
      }

      // IMPORTANT: if we still don't have the candidate entity, DO NOT touch the list.
      // No "empty" commits; instead we retry once on the next frame.
      requestAnimationFrame(() => {
        const late = resolveCandidate();
        if (!late) return;
        tryInsert(late);
      });

      return;
    }

    // EXIT: if not in list, nothing to do
    if (!currentIds.includes(id)) return;

    const isVisible = cardsToRender.some((c) => c.id === id);
    if (!isVisible) {
      // Offscreen → commit directly
      setList('featured', currentIds.filter((x) => x !== id));
      return;
    }

    // Visible → slide-down first, then commit and FLIP neighbors
    setLeavingId(id);
    setTimeout(() => {
      isCommittingRef.current = true;
      const prev = measureRects();
      const nextIds = currentIds.filter((x) => x !== id);
      setList('featured', nextIds);

      requestAnimationFrame(() => {
        const next = measureRects();
        flip(prev, next);
        setLeavingId(null);
        isCommittingRef.current = false;
      });
    }, EXIT_MS);
  });

  /* ---------------- Gestures ------------------------------------------ */
  /**
   * gestureState:
   * - Tracks pointer identity (mouse / touch)
   * - Accumulates deltas to decide X vs Y
   * - Implements hysteresis so vertical scroll wins unless the user clearly wants horizontal drag
   * - Holds dragStartX so we can clamp how far a single drag can move the carousel
   */
  type GestureState = {
    decided: boolean;
    lock: 'x' | 'y' | null;
    accX: number;
    accY: number;
    velocityX: number;
    dragStartX: number;
    frames: number;
    provisionalX: boolean;
    active: boolean;
    skip: boolean;
    pointerId: number | null;
  };

  const gestureState = useRef<GestureState>({
    decided: false,
    lock: null,
    accX: 0,
    accY: 0,
    velocityX: 0,
    dragStartX: 0,
    frames: 0,
    provisionalX: false,
    active: false,
    skip: false,
    pointerId: null,
  });


  // Gesture classification thresholds
  const THRESHOLD_X = 6;
  const THRESHOLD_Y = 12;
  const MIN_FRAMES_FOR_X_LOCK = 2;
  const RECOVER_RATIO = 1.6;
  const H_RATIO_BASE = 1.1;
  const H_RATIO_BOOST = 1.4;
  const MAX_HORIZONTAL_BEFORE_NO_RECOVER = 24;

  // We disable interaction completely while the menu is open
  const interactionDisabled = isMenuOpen; // carousel stays interactive during enter/leave FLIP anims

  const resetGesture = () => {
    const g = gestureState.current;
    g.decided = false; g.lock = null; g.accX = 0; g.accY = 0; g.velocityX = 0; g.dragStartX = 0; g.frames = 0;
    g.provisionalX = false; g.active = false; g.skip = false; g.pointerId = null;
  };

  const handlePanStart = (e: PanEvent) => {
    const g = gestureState.current;
    const pid = getPointerId(e);
    stopReleaseAnim();

    if (interactionDisabled) {
      resetGesture();
      g.skip = true;
      g.pointerId = pid;
      return;
    }

    resetGesture();
    g.active = true;
    g.pointerId = pid;
    
    const startX = smoothX.get();
    dragX.set(startX);
    g.dragStartX = startX;
  };

  const handlePan = (e: PanEvent, info: PanInfo) => {
    const g = gestureState.current;
    const pid = getPointerId(e);
    const DRAG_FACTOR = isDesktop ? DRAG_FACTOR_DESKTOP : DRAG_FACTOR_MOBILE;

    if (g.pointerId !== null && pid !== null && pid !== g.pointerId) return;
    if (g.skip) return;

    if (interactionDisabled) {
      if (isDragging) setIsDragging(false);
      g.skip = true;
      g.active = false;
      return;
    }

    if (!g.active) return;

    const dx = info.delta.x;
    const dy = info.delta.y || 0;

    g.accX += dx;
    g.accY += dy;
    g.velocityX = info.velocity.x;
    g.frames++;

    const absX = Math.abs(g.accX);
    const absY = Math.abs(g.accY);

    if (!g.decided) {
      // Strong vertical intent → give the scroll the priority
      if (absY >= THRESHOLD_Y && absY >= absX + 6) {
        g.lock = 'y';
        g.decided = true;
        cancelPressRef.current?.();
        return;
      }

      // Dynamic hysteresis: the more vertical motion we have, the harder it is to switch to X
      const dynamicHysteresis = absY > 2 * THRESHOLD_Y ? H_RATIO_BOOST : H_RATIO_BASE;

      // Horizontal intent: requires enough X movement and enough frames
      if (
        absX >= THRESHOLD_X &&
        absX > absY * dynamicHysteresis &&
        g.frames >= MIN_FRAMES_FOR_X_LOCK
      ) {
        if (!g.provisionalX) {
          // First time we think X might win → provisional
          g.provisionalX = true;
        } else {
          // Second confirmation → lock to X and start dragging the carousel
          g.lock = 'x';
          g.decided = true;
          setIsDragging(true);
        }
      }

      // Late Y win (simple case)
      if (!g.decided && absY >= THRESHOLD_Y && absY > absX * H_RATIO_BASE) {
        g.lock = 'y';
        g.decided = true;
        cancelPressRef.current?.();
        return;
      }

      // Recovery: we thought it was X, but user changed direction early enough → go back to Y
      if (
        g.provisionalX &&
        !g.decided &&
        absY > absX * RECOVER_RATIO &&
        absX < MAX_HORIZONTAL_BEFORE_NO_RECOVER
      ) {
        g.provisionalX = false;
        g.lock = 'y';
        g.decided = true;
        cancelPressRef.current?.();
        return;
      }

      if (!g.decided || g.lock === 'y') return;
    }

    if (g.lock === 'x') {
      // Clamp how far a single drag can move the track (in card units)
      const maxCards = isDesktop
        ? MAX_CARDS_PER_SWIPE_DESKTOP
        : MAX_CARDS_PER_SWIPE_MOBILE;

      const maxDragDistance = maxCards * cardTotalWidth;

      if (g.accX > maxDragDistance) g.accX = maxDragDistance;
      if (g.accX < -maxDragDistance) g.accX = -maxDragDistance;

      const nextX = g.dragStartX + g.accX * DRAG_FACTOR;
      dragX.set(nextX);
    }
  };

  const clampNum = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const handlePanEnd = (e: PanEvent) => {
    const g = gestureState.current;

    // Ignore pan-end events from a different pointer (multi-touch / stray events)
    const pid = getPointerId(e);
    if (g.pointerId !== null && pid !== null && pid !== g.pointerId) return;

    // If we never actively started a valid drag, just cleanup.
    if (g.skip || !g.active) {
      if (isDragging) setIsDragging(false);
      resetGesture();
      return;
    }

    // If we didn't "lock" the gesture to X, do not snap the carousel (let scroll win).
    if (g.lock !== 'x') {
      if (isDragging) setIsDragging(false);
      resetGesture();
      return;
    }

    // We were dragging horizontally; end the dragging UI state.
    if (isDragging) setIsDragging(false);

    const totalDx = g.accX;
    const absTotalDx = Math.abs(totalDx);

    const el = containerRef.current;
    if (!el || dataEvents.length === 0) {
      resetGesture();
      return;
    }

    // The X position where the "active" card should be centered/aligned.
    // Even vs odd active-cards changes the center offset.
    const alignmentPoint = isEven
      ? el.offsetWidth / 2 - cardWidth - gap / 2
      : el.offsetWidth / 2 - cardWidth / 2;

    // Spring used when snapping to the target slot.
    const releaseSpring: { type: 'spring'; stiffness: number; damping: number; mass: number } = {
      type: 'spring',
      stiffness: isDesktop ? 400 : 260,
      damping: 45,
      mass: 1.1,
    };

    // Clamp velocity to avoid huge spikes that feel like a "slingshot" on mouse/touch.
    // (velocity is px/s)
    const vCap = isDesktop ? 2400 : 1700;
    const v = clampNum(g.velocityX, -vCap, vCap);

    // Cancel any previous release animation so it can't "fight" the new snap.
    stopReleaseAnim();

    // Small + slow gesture → just snap to nearest (no inertial jump).
    if (absTotalDx < MIN_SNAP_DISTANCE && Math.abs(v) < MIN_SNAP_VELOCITY) {
      const currentX = dragX.get();
      const nearestIndex = Math.round((alignmentPoint - currentX) / cardTotalWidth);
      const targetX = alignmentPoint - nearestIndex * cardTotalWidth;

      releaseAnimRef.current = animate(dragX, targetX, releaseSpring);
      resetGesture();
      return;
    }

    // Inertial snap:
    // 1) Read current track position.
    const currentX = dragX.get();

    // 2) Decide how many cards we're allowed to move in a single swipe.
    const maxStep = isDesktop ? MAX_CARDS_PER_SWIPE_DESKTOP : MAX_CARDS_PER_SWIPE_MOBILE;
    const maxDragDistance = maxStep * cardTotalWidth;

    // 3) Only apply velocity projection if the user didn't already drag "near the cap".
    //    If they already dragged a lot, adding velocity projection often feels like a fling.
    const allowVelocityProjection = absTotalDx < maxDragDistance * 0.8;

    const projectionFactor = isDesktop
      ? VELOCITY_PROJECTION_DESKTOP
      : VELOCITY_PROJECTION_MOBILE;

    const projectedX = allowVelocityProjection
      ? currentX + v * projectionFactor
      : currentX;

    // 4) Work with float indices to reduce rounding weirdness,
    //    then clamp the final step to [-maxStep, +maxStep].
    const currentIndexF = (alignmentPoint - currentX) / cardTotalWidth;
    const projectedIndexF = (alignmentPoint - projectedX) / cardTotalWidth;

    const rawStep = Math.round(projectedIndexF - currentIndexF);
    const clampedStep =
      rawStep > maxStep ? maxStep : rawStep < -maxStep ? -maxStep : rawStep;

    // 5) Compute final target index and animate to its X position.
    const targetIndex = Math.round(currentIndexF + clampedStep);
    const targetX = alignmentPoint - targetIndex * cardTotalWidth;

    releaseAnimRef.current = animate(dragX, targetX, releaseSpring);

    // Cleanup gesture state for the next interaction.
    resetGesture();
  };



  /* ---------------- Menu / updates ----------------------------------- */
  const handleDetails = (event: EventWithCreatorAndRsvps) => {
    openMenu(event.id, { mode: 'non-editable', onEventUpdate: handleEventUpdate });
  };

  const { mutate: swrMutate } = useSWRConfig();

  /**
   * When a card is edited from the menu:
   * - Update the entity in the store
   * - Patch this carousel's SWR cache
   * - Broadcast to all other lists via patchEventEverywhere
   */
  const handleEventUpdate = useCallback(
    async (updated: EventWithCreatorAndRsvps) => {
      setUpdatingIds((prev) => new Set(prev).add(updated.id));

      // 1) Update entity immediately
      upsertEvents([updated]);

      // 2) Patch SWR cache for this carousel
      await swrMutate(
        effectiveKey,
        (cached?: ApiEventsSuccess) =>
          cached
            ? {
                ...cached,
                data: cached.data.map((e) =>
                  e.id === updated.id ? updated : e
                ),
              }
            : cached,
        false
      );

      // 3) Broadcast globally to other lists / views
      patchEventEverywhere(swrMutate as GlobalMutate, updated);

      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(updated.id);
        return next;
      });
    },
    [swrMutate, effectiveKey, upsertEvents]
  );

  /* ---------------- Render ------------------------------------------- */
  // "Active zone" roughly encodes the horizontal region considered "front" for ArcEventCard
  const activeZoneWidth = activeCards * cardWidth + (activeCards - 1) * gap + cardWidth;
  const activeZoneHalfWidth = activeZoneWidth / 2;

  return (
    <>
      <motion.div
        ref={containerRef}
        className="relative w-full h-[430px] xs3:h-[450px] md:h-[600px] flex items-center overflow-hidden py-10 md:py-16 select-none touch-pan-y"
        style={{ cursor: isDragging ? 'grabbing' : isMenuOpen ? 'default' : 'grab' }}
        role="region"
        aria-roledescription="carousel"
        aria-label={resolvedListName === 'featured' ? 'Featured events' : 'Upcoming events'}
        onPanStart={handlePanStart}
        onPan={handlePan}
        onPanEnd={handlePanEnd}
      >
        <motion.div
          ref={trackRef}
          className="relative h-full w-full"
          style={{ x: smoothX }}
          role="list"
        >
          {cardsToRender.map(({ id, index, renderIndex }) => {
            const event = eventsMap.get(id) || dataEvents.find((e) => e.id === id);
            if (!event) return null;

            // Decide which animation variant to apply to this card
            const isEntering = enteringId === event.id;
            const isLeaving  = leavingId  === event.id;

            return (
              <div
                key={`${index}:${event.id}`}
                className="absolute top-0 h-full max-md:ml-0.5"
                data-event-id={event.id}
                style={{ width: cardWidth, left: index * (cardWidth + gap) }}
                role="listitem"
              >
                <motion.div
                  key={event.id}
                  className="h-full"
                  variants={cardVariants}
                  custom={isEntering}
                  initial={isEntering ? 'enter' : false}
                  animate={isLeaving ? 'leave' : 'normal'}
                >
                  <ArcEventCard
                    index={index}
                    renderIndex={renderIndex}
                    event={event}
                    onDetailsClick={handleDetails}
                    smoothX={smoothX}
                    cardTotalWidth={cardTotalWidth}
                    cardWidth={cardWidth}
                    viewportWidth={viewportWidth}
                    curve={curve}
                    activeZoneHalfWidth={activeZoneHalfWidth}
                    isDragging={isDragging}
                    rotationFactor={rotationFactor}
                    isEven={activeCards % 2 === 0}
                    popDistance={popDistance}
                    isUpdating={updatingIds.has(event.id)}
                    registerCancelPress={registerCancelPress}
                  />
                </motion.div>
              </div>
            );
          })}
        </motion.div>
      </motion.div>
    </>
  );
}
