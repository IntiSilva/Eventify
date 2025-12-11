"use client"

import { useState ,useEffect, useCallback, useSyncExternalStore} from "react"
import useSWR from 'swr';
import type { EventsConfirmedCountData, EventsConfirmedCountResponse } from "@/types/api";



/**
 * A media-query hook implemented with useSyncExternalStore.
 *
 * Why this approach?
 * - Avoids setState inside effects.
 * - Hydration-safe: SSR snapshot is stable.
 * - Works across browsers (addEventListener + legacy addListener fallback).
 * - Notifications are queued in a microtask to batch renders.
 */

type MediaQueryListLegacy = MediaQueryList & {
  addListener?: (h: (e: MediaQueryListEvent) => void) => void;
  removeListener?: (h: (e: MediaQueryListEvent) => void) => void;
};

/** Subscribes to MQ changes; queues notify in a microtask to avoid sync re-entrancy. */
function subscribeMql(mql: MediaQueryList, notify: () => void) {
  const onChange = () => {
    const run = notify;
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  };

  // Modern API
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  // Legacy Safari
  const legacy = mql as MediaQueryListLegacy;
  legacy.addListener?.(onChange);
  return () => legacy.removeListener?.(onChange);
}

/*
 * - SSR: returns a stable seed (false) to prevent hydration mismatches.
 * - Client: reads window.matchMedia(query).matches via getSnapshot().
 * - No conditional hooks; subscribe/getSnapshot are memoized per `query`.
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback((notify: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const mql = window.matchMedia(query);
    return subscribeMql(mql, notify);
  }, [query]);

  // Client snapshot: current truth of the media query
  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined') return false; // SSR seed
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  }, [query]);

  // Server snapshot: fixed value to avoid SSR/CSR divergence
  const getServerSnapshot = () => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}


export type CarouselBreakpointKey = 'base' | 'xs3' | 'xs4' | 'md';

export type CarouselBreakpoints = Record<Exclude<CarouselBreakpointKey, 'base'>, number>; // base carries no number

export function useBreakpointCarousel(breakpoints: CarouselBreakpoints): CarouselBreakpointKey {

  const getSnapshot = useCallback((): CarouselBreakpointKey => {
    if (typeof window === 'undefined') return 'base';
    const w = window.innerWidth || 0;
    if (w >= breakpoints.md)  return 'md';
    if (w >= breakpoints.xs4) return 'xs4';
    if (w >= breakpoints.xs3) return 'xs3';
    return 'base';
  }, [breakpoints]);

  const subscribe = useCallback((notify: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const onResize = () => {
      // group renders and avoid cascade issues
      if (typeof queueMicrotask === 'function') queueMicrotask(notify);
      else Promise.resolve().then(notify);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, () => 'base');
}


async function fetcher(url: string): Promise<EventsConfirmedCountData> {
  const res = await fetch(url);

  let json: EventsConfirmedCountResponse | null = null;
  try {
    json = (await res.json()) as EventsConfirmedCountResponse;
  } catch {
    // non-json edge case
  }

  if (!res.ok || !json || !json.success) {
    const msg =
      json && !json.success ? json.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return json.data;
}

export function useConfirmedCounts(ids: string[]) {
  const key = ids.length
    ? `/api/events/confirmed-count?ids=${encodeURIComponent(ids.join(','))}`
    : null;

  const { data } = useSWR<EventsConfirmedCountData>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
    refreshInterval: 60_000,
  });

  return data ?? {};
}

/**
 * Tracks whether the given element has ever entered the viewport.
 * Returns `true` the first time the element is at least `threshold`
 * visible and stays `true` permanently afterwards.
 */
export function useInViewportOnce<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  threshold = 0.4
) {
  const [hasBeenInView, setHasBeenInView] = useState(false);

  useEffect(() => {
    if (hasBeenInView) return;

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setHasBeenInView(true);
            obs.disconnect();
            break;
          }
        }
      },
      { threshold }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [hasBeenInView, ref, threshold]);

  return hasBeenInView;
}



/**
 * Global scroll lock with fine-grained exceptions:
 * - Prevents native page scrolling (wheel/touch/keyboard) while enabled.
 * - Lets a specific "region" keep receiving wheel/touch events (e.g., a 3D list engine)
 *   by stopping propagation only when the event comes from *outside* that region.
 * - Whitelists "native scroll pockets" (e.g., an overflow:auto toast body) so they
 *   can scroll natively even while the page is locked.
 *
 * How it works:
 * - We add capture-phase listeners on window with { passive:false } so preventDefault() is effective.
 * - For wheel/touch:
 *     • If the event originated inside a "native scroll pocket" => do nothing (allow native scrolling).
 *     • Else preventDefault() (block page scroll). Additionally, if the event target is outside
 *       the region, stopPropagation() so the region’s handler doesn't see unrelated events.
 * - For keyboard (space/pgup/pgdn/arrows/home/end):
 *     • Allow if focus is on an editable control or inside a "native scroll pocket".
 *     • Otherwise preventDefault() to block keyboard-driven page scroll.
 *
 * Usage:
 *   const listRef = useRef<HTMLDivElement>(null);
 *   useGlobalScrollGuard(listRef, { enabled: true, nativeScrollSelector: '[data-allow-scroll]' });
 */
export function useGlobalScrollGuard<T extends HTMLElement = HTMLElement>(
  regionRef: React.RefObject<T | null>,
  opts: { enabled?: boolean; nativeScrollSelector?: string } = {}
) {
  useEffect(() => {
    if (opts.enabled === false) return;

    const NATIVE_SEL = opts.nativeScrollSelector ?? '[data-allow-scroll]';

    /** Event with optional composedPath()/path in a type-safe way. */
    type ExtendedEvent = Event & {
      composedPath?: () => EventTarget[];
      path?: EventTarget[]; // non-standard in some browsers
    };

    /** Returns a robust event path (Shadow DOM–safe when available). */
    const getPath = (ev: Event): readonly EventTarget[] => {
      const e = ev as ExtendedEvent;
      if (typeof e.composedPath === 'function') return e.composedPath();
      if (Array.isArray(e.path)) return e.path;
      const t = ev.target;
      return t ? [t] : [];
    };

    /**
     * Whether the event is inside the "region" (e.g., your 3D list container).
     * If true, we let the event bubble to the region's own handlers.
     */
    const isInsideRegion = (ev: Event): boolean => {
      const el = regionRef.current;
      if (!el) return false;

      // Fast path: check Shadow DOM path membership.
      const path = getPath(ev);
      if (path.some((n) => n === el)) return true;

      // Fallback: classic DOM containment check.
      const t = ev.target;
      return t instanceof Node ? el.contains(t) : false;
    };

    /**
     * Whether the event originated within a "native scroll pocket"
     * matched by NATIVE_SEL (e.g., toast content with overflow:auto).
     * If true, we should *not* preventDefault() so the element can scroll natively.
     */
    const isInsideNative = (ev: Event): boolean => {
      // Check Shadow DOM path for a quick positive match.
      for (const n of getPath(ev)) {
        if (n instanceof Element && (n.matches(NATIVE_SEL) || n.closest(NATIVE_SEL))) {
          return true;
        }
      }
      // Fallback using target.closest.
      const t = ev.target;
      return t instanceof Element ? !!t.closest(NATIVE_SEL) : false;
    };

    /**
     * Wheel handler:
     * - If in native pocket => allow default (native scroll).
     * - Else prevent default to lock the page.
     * - If the event came from outside the region, also stop propagation so the region
     *   doesn't receive stray wheel events.
     */
    const onWheel = (e: WheelEvent) => {
      if (isInsideNative(e)) return; // allow native scrolling in the pocket
      e.preventDefault();            // lock global page scroll
      if (!isInsideRegion(e)) e.stopPropagation();
    };

    /**
     * Touch move handler (mobile):
     * Same logic as wheel.
     */
    const onTouchMove = (e: TouchEvent) => {
      if (isInsideNative(e)) return;
      e.preventDefault();
      if (!isInsideRegion(e)) e.stopPropagation();
    };

    /**
     * Keyboard scroll keys:
     * Block page scrolling unless:
     * - Focus is on an editable control (input/textarea/select or contentEditable), or
     * - Focus is inside a native scroll pocket.
     */
    const blockedKeys = new Set([
      ' ',
      'Spacebar',   // legacy
      'PageDown',
      'PageUp',
      'ArrowDown',
      'ArrowUp',
      'Home',
      'End',
    ]);

    const onKeyDown = (e: KeyboardEvent) => {
      if (!blockedKeys.has(e.key)) return;

      const active = document.activeElement as Element | null;

      // Allow when typing in an editable surface.
      const editable =
        active instanceof HTMLElement &&
        (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
      if (editable) return;

      // Allow keyboard scrolling when focus is inside a native scroll pocket.
      if (active && active.closest(NATIVE_SEL)) return;

      // Otherwise block page scroll.
      e.preventDefault();
    };

    // Capture phase + passive:false is required for preventDefault() to take effect on wheel/touch.
    const cap: AddEventListenerOptions = { passive: false, capture: true };

    window.addEventListener('wheel', onWheel, cap);
    window.addEventListener('touchmove', onTouchMove, cap);
    window.addEventListener('keydown', onKeyDown, { capture: true });

    return () => {
      window.removeEventListener('wheel', onWheel, cap);
      window.removeEventListener('touchmove', onTouchMove, cap);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [regionRef, opts.enabled, opts.nativeScrollSelector]);
}


// *************************   OGL HOOKS *************************

// Hook to detect the user's reduced motion preference
export function useReducedMotionOgl() {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');

    // notify sin argumentos: leemos mql.matches adentro
    const notify = () => {
      const run = () => setMatches(mql.matches);
      if (typeof queueMicrotask === 'function') queueMicrotask(run);
      else Promise.resolve().then(run);
    };

    // Seed (deja el valor correcto apenas monta el effect, sin setState síncrono)
    notify();

    const unsubscribe = subscribeMql(mql, notify);
    return unsubscribe;
  }, []);

  return matches;
}


// General-purpose Media Query hook (centralized here)
export function useMediaQueryOgl(query: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia(query);

    // notify sin argumentos: leemos mql.matches adentro
    const notify = () => {
      const run = () => setMatches(mql.matches);
      if (typeof queueMicrotask === 'function') queueMicrotask(run);
      else Promise.resolve().then(run);
    };

    // Seed cuando cambia el query (sin setState síncrono en el effect)
    notify();

    const unsubscribe = subscribeMql(mql, notify);
    return unsubscribe;
  }, [query]);

  return matches;
}

