'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion, useSpring, type MotionValue } from 'motion/react';
import {
  clamp, modulo, snapToDpr, wheelDeltaInPixels, easeInOutCubic, isInteractiveTarget,
  SCROLL_FEELS, type ScrollFeel, applyStep
} from './scrollMath';


/**
 * IMPORTANT
 * Why we disable "react-hooks/immutability" on a few lines
 * ---------------------------------------------------------
 * This engine uses React refs (e.g., `someRef.current = ...`) to hold mutable,
 * frame-by-frame state. Mutating `.current` is *intended and safe* in React
 * (outside render). However, the new `react-hooks/immutability` lint sometimes
 * flags these assignments as if we were mutating hook inputs — a known false
 * positive in this pattern.
 *
 * What we do:
 * - We keep the logic as-is (correct runtime behavior).
 * - We silence the lint *only on the exact assignments* with:
 *     // eslint-disable-next-line react-hooks/immutability
 *
 * Where we did it:
 * - Above the assignments to:
 *     - introDoneRef.current
 *     - recenteringRef.current
 *     - tickRef.current  (function assignment)
 *     - yAtSelectRef.current
 * - (For reference, before adding this header comment these were around lines:
 *   504, 582, 634, 685, 721, 994.)
 *
 * When to revisit:
 * - Remove the inline disables once the linter fixes this false-positive case.
 */


/** Scroll direction for autoplay. */
export type Direction = 'down' | 'up';

/** Public API: input parameters expected by the engine hook. */
export interface UseTiltedListEngineParams {
  /** Total number of items (e.g., events.length). */
  count: number;

  /** If false, disable wrap-around and clamp scrolling. */
  infinite?: boolean;
  /** If true, finite top/bottom outward wheel can handoff to page scroll. */
  allowWheelPageEdgeRelease?: boolean;

  /** Extra scroll slack at the top when infinite=false (in px). */
  finiteStartSlackPx?: number;

  /** Extra scroll slack at the end (in px) when infinite=false. */
  finiteEndSlackPx?: number;

  /** Row geometry: height + vertical gap (in pixels). */
  stride: number;
  /** Extra rows outside the viewport to avoid visible clipping. */
  buffer: number;
  /** Hard upper bound for rows to render (optional). */
  maxRenderCount?: number;

  /** Initial offset in pixels = stride * initialPeekRatio. */
  initialPeekRatio: number;

  /** Autoplay speed in px/s (0 = off) and its direction. */
  autoplayPxPerSec: number;
  autoplayDirection: Direction;
  /** If true, hovering a row pauses autoplay. */
  pauseOnHover: boolean;

  /** Intro gating (prevent autoplay/parallax until intro finishes). */
  playIntro: boolean;
  introStagger: number;
  introDuration: number;

  /** Honor prefers-reduced-motion (turns off autoplay/parallax if applicable). */
  respectReducedMotion: boolean;

  /** Parallax configuration for title/actions/meta blocks. */
  parallaxEnabled: boolean;
  parallaxVelocityToPx: number;
  parallaxMaxOffset: number;
  parallaxTitleFactor: number;
  parallaxActionsFactor: number;
  parallaxMetaFactor: number;
  parallaxAutoplayFactor: number;

  /** Search state: when search is active, do not auto-deselect on scroll. */
  searchActive: boolean;
  /** 0..count-1 indices of rows matching the search (optional). */
  searchFocusIndices?: number[];
  /** Currently selected row id (engine can auto-clear on scroll). */
  selectedRowId: string | null;
  /** Called when the engine decides to clear the selection due to scroll. */
  onClearSelection: () => void;

  /** Threshold in px to auto-deselect after selection if scrolled beyond this. */
  scrollDeselectPx?: number;

  /** Wheel feel preset and fine-grained overrides */
  wheelFeel?: keyof typeof SCROLL_FEELS;
  wheelFeelOverride?: Partial<ScrollFeel>;

  /** Enable debug logging. */
  debug?: boolean;
}

/** Public API: values and handlers returned by the engine hook. */
export interface UseTiltedListEngineReturn {
  /** Visible container height (px). */
  containerH: number;
  /** Virtual window start: absolute index to render from. */
  windowStartAbs: number;
  /** Number of rows to render (includes buffer). */
  renderCount: number;

  /** Intro flags. */
  introDone: boolean;
  runIntro: boolean;

  /** DOM refs: scrollable wrapper and translated track (UL). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  trackRef: React.RefObject<HTMLUListElement | null>;

  /** High-level input handlers (already include gating). */
  onWheel: (e: React.WheelEvent) => void;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;

  /** Row-level hover handlers (to pause/resume autoplay). */
  onRowPointerEnter: () => void;
  onRowPointerLeave: () => void;

  /** Parallax motion values. */
  yTitleMV: MotionValue<number>;
  yActionsMV: MotionValue<number>;
  yMetaMV: MotionValue<number>;

  /** “3D activated” registry by dataIndex (avoid 3D before intro ends). */
  activated3D: ReadonlySet<number>;
  mark3DActive: (dataIndex: number) => void;

  /** Pure helper re-exposed for convenience. */
  modulo: (n: number, m: number) => number;
}

/* ────────────────────────────────────────────────────────────────── */
/* Hook implementation                                                */
/* ────────────────────────────────────────────────────────────────── */

export function useTiltedListEngine(params: UseTiltedListEngineParams): UseTiltedListEngineReturn {
  const {
    count,
    stride,
    buffer,
    maxRenderCount,
    initialPeekRatio,

    autoplayPxPerSec,
    autoplayDirection,
    pauseOnHover,

    playIntro,
    introStagger,
    introDuration,

    respectReducedMotion,

    parallaxEnabled,
    parallaxVelocityToPx,
    parallaxMaxOffset,
    parallaxTitleFactor,
    parallaxActionsFactor,
    parallaxMetaFactor,
    parallaxAutoplayFactor,

    searchActive,
    selectedRowId,
    onClearSelection,
    scrollDeselectPx = 8,

    debug = false,
    searchFocusIndices,

    infinite = true,
    allowWheelPageEdgeRelease = true,
    finiteStartSlackPx = 0,
    finiteEndSlackPx = 0,
  } = params;

  // Stable logger: fixed identity, behavior controlled by `debug`
  const logRef = useRef<(...a: unknown[]) => void>(() => {});
  useEffect(() => {
    logRef.current = debug ? (...a) => console.log('[TiltedEngine]', ...a) : () => {};
  }, [debug]);
  const LOG = useCallback((...a: unknown[]) => logRef.current(...a), []);

  /* ───────────────────────── Visible height & windowing ───────────────────────── */

  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLUListElement>(null);

  const [containerH, setContainerH] = useState<number>(0);
  const visibleCount = Math.max(1, Math.ceil(containerH / Math.max(1, stride)));
  const renderCountBase = Math.max(visibleCount + buffer * 2, 1);
  const cap =
    Number.isFinite(maxRenderCount ?? NaN) && (maxRenderCount as number) > 0
      ? Math.floor(maxRenderCount as number)
      : Number.POSITIVE_INFINITY;
  const renderCount = infinite
    ? Math.min(renderCountBase, cap)
    : Math.min(renderCountBase, cap, count);

  const [windowStartAbs, setWindowStartAbs] = useState(0);
  const prevFirstVisibleRef = useRef(0);

  const wheelFeel = useMemo<ScrollFeel>(() => ({
     ...(SCROLL_FEELS[params.wheelFeel ?? 'trackpad']),
     ...(params.wheelFeelOverride ?? {}),
  }), [params.wheelFeel, params.wheelFeelOverride]);

  const onClearSelectionRef = useRef(onClearSelection);

  useEffect(() => {
  onClearSelectionRef.current = onClearSelection;
}, [onClearSelection]);


  const roRafRef = useRef<number | null>(null);
  const lastROHeightRef = useRef(0);
  const pendingROHeightRef = useRef<number | null>(null);

  // ResizeObserver: commit height changes with a micro-rAF to coalesce writes.
  useEffect(() => {
    if (!containerRef.current) return;

    const commit = (hRaw: number) => {
      const h = Math.max(0, Math.round(hRaw));
      if (h !== lastROHeightRef.current) {
        lastROHeightRef.current = h;
        setContainerH(h);
        if (debug) console.log('[TiltedEngine]', 'RO commit', { height: h });
      }
    };

    const schedule = (hRaw: number) => {
      pendingROHeightRef.current = hRaw;
      if (roRafRef.current != null) return;
      roRafRef.current = requestAnimationFrame(() => {
        roRafRef.current = null;
        const pending = pendingROHeightRef.current;
        pendingROHeightRef.current = null;
        if (pending == null) return;
        commit(pending);
      });
    };

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        schedule(entry.contentRect.height);
        break;
      }
    });

    const el = containerRef.current;
    ro.observe(el);
    // Initial measure
    schedule(el.getBoundingClientRect().height);

    return () => {
      ro.disconnect();
      if (roRafRef.current != null) {
        cancelAnimationFrame(roRafRef.current);
        roRafRef.current = null;
      }
      pendingROHeightRef.current = null;
    };
  }, [debug, LOG]);

  /* ───────────────────────── Motion prefs & resolved autoplay ───────────────────────── */

  const prefersReduced = useReducedMotion();
  const resolvedAutoplay =
    (respectReducedMotion && prefersReduced) || !infinite ? 0 : Math.max(0, autoplayPxPerSec);

  useEffect(() => {
    LOG('Resolved motion', { prefersReduced, respectReducedMotion, resolvedAutoplay });
  }, [prefersReduced, respectReducedMotion, resolvedAutoplay, LOG]);

  /* ───────────────────────── Scroll state & rAF clock ───────────────────────── */

  const smoothYRef = useRef(0);
  const finiteRangeRef = useRef<{ minY: number; maxY: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const lastTsRef = useRef<number | null>(null);

  const writeRafIdRef = useRef<number | null>(null);
  const lastWrittenYRef = useRef<number | null>(null);
  const prevAutoRef = useRef(false);

  const clampSmoothYFinite = useCallback(() => {
    const range = finiteRangeRef.current;
    if (!range) return; // no clamping in infinite mode

    const { minY, maxY } = range;
    if (smoothYRef.current < minY) smoothYRef.current = minY;
    if (smoothYRef.current > maxY) smoothYRef.current = maxY;
  }, []);

  /** Schedule a translateY update on the track (coalesced per frame). */
  const scheduleSetTrackY = useCallback(() => {
    if (writeRafIdRef.current != null) return;
    writeRafIdRef.current = requestAnimationFrame(() => {
      writeRafIdRef.current = null;
      const track = trackRef.current;
      if (!track) return;
      const snapped = snapToDpr(smoothYRef.current);
      if (lastWrittenYRef.current === snapped) return;
      lastWrittenYRef.current = snapped;
      track.style.transform = `translate3d(0, ${snapped}px, 0)`;
      if (debug) {
        if (lastLoggedYRef.current == null || Math.abs(snapped - lastLoggedYRef.current) >= stride) {
          lastLoggedYRef.current = snapped;
          LOG('Track Y updated', { y: snapped });
        }
      }
    });
  }, [debug, stride, LOG]);
  const lastLoggedYRef = useRef<number | null>(null);

  const startRAF = useCallback(() => {
    if (runningRef.current || !tickRef.current) return;
    runningRef.current = true;
    lastTsRef.current = null;
    rafRef.current = requestAnimationFrame((ts) => tickRef.current?.(ts));
    LOG('rAF started');
  }, [LOG]);

  const stopRAF = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    runningRef.current = false;
    LOG('rAF stopped');
  }, [LOG]);

  const ensureRunning = startRAF;

  type TickFn = (ts: number) => void;
  const tickRef = useRef<TickFn | null>(null);


  /* ───────────────────────── Live flags mirrored in refs so the rAF loop doesn't recreate ───────────────────────── */

  const resolvedAutoplayRef = useRef(resolvedAutoplay);
  useEffect(() => { resolvedAutoplayRef.current = resolvedAutoplay; }, [resolvedAutoplay]);

  const autoplayDirRef = useRef(autoplayDirection);
  useEffect(() => { autoplayDirRef.current = autoplayDirection; }, [autoplayDirection]);

  const searchActiveRef = useRef(searchActive);
  useEffect(() => { searchActiveRef.current = searchActive; }, [searchActive]);

  const selectedRowIdRef = useRef<string | null>(selectedRowId);
  useEffect(() => { selectedRowIdRef.current = selectedRowId; }, [selectedRowId]);

  /* ───────────────────────── Hover handling (pause autoplay) ───────────────────────── */

  const isHoveringRef = useRef(false);
  const rowHoverCountRef = useRef(0);

  const onRowPointerEnter = useCallback(() => {
    if (!pauseOnHover || recenteringRef.current) return;
    rowHoverCountRef.current += 1;
    isHoveringRef.current = rowHoverCountRef.current > 0;
    LOG('Hover enter', { count: rowHoverCountRef.current });
  }, [pauseOnHover, LOG]);

  const onRowPointerLeave = useCallback(() => {
    if (!pauseOnHover || recenteringRef.current) return;
    rowHoverCountRef.current = Math.max(0, rowHoverCountRef.current - 1);
    isHoveringRef.current = rowHoverCountRef.current > 0;
    LOG('Hover leave', { count: rowHoverCountRef.current });
    if (!isHoveringRef.current && resolvedAutoplay > 0 && introDoneRef.current && !recenteringRef.current) {
      LOG('Hover cleared → resume autoplay');
      ensureRunning();
    }
  }, [pauseOnHover, resolvedAutoplay, ensureRunning, LOG]);



  /* ───────────────────────── Inertia, wheel & drag ───────────────────────── */

  const pointerDownRef = useRef(false);
  const isDraggingRef = useRef(false);
  const dragCapturedRef = useRef(false);
  const startYRef = useRef(0);
  const lastYRef = useRef(0);
  const lastMoveTsRef = useRef<number | null>(null);
  const accumDyRef = useRef(0);
  const DRAG_THRESHOLD = 6;
  const EDGE_EPS = 0.75;

  const inertiaVelRef = useRef(0); // px/s
  const INERTIA_DECAY = 5.0;
  const INERTIA_MIN_V = 8;




  // maybeUpdateWindow is defined below; we intentionally keep it out of deps to avoid TDZ.

  const computeFirstVisible = useCallback(
    () => Math.floor((-smoothYRef.current) / stride),
    [stride]
  );

  const maybeUpdateWindow = useCallback(() => {
    const firstVisible = computeFirstVisible();

    // In infinite mode we maintain early-return for performace
    if (infinite && firstVisible === prevFirstVisibleRef.current) {
      return;
    }

    // Always update the last "first visible" row we detected.
    prevFirstVisibleRef.current = firstVisible;

    if (infinite) {
      const windowStart = firstVisible - buffer;
      setWindowStartAbs(windowStart);
      LOG('Window shift', {
        firstVisible,
        windowStartAbs: windowStart,
        renderCount,
      });
      return;
    }

    // Finite Mode: always recalc/clamp.
    const rawStart = firstVisible - buffer;
    const minStart = 0;
    const maxStart = Math.max(0, count - renderCount);
    const clampedStart = clamp(rawStart, minStart, maxStart);

    setWindowStartAbs(clampedStart);
    LOG('Window shift', {
      firstVisible,
      windowStartAbs: clampedStart,
      renderCount,
    });
  }, [buffer, renderCount, computeFirstVisible, infinite, count, LOG]);


  useEffect(() => {
    const totalH = count * stride;
    const viewportH = containerH;

    const extraTop =
      !infinite && finiteStartSlackPx > 0 ? finiteStartSlackPx : 0;
    const extraBottom =
      !infinite && finiteEndSlackPx > 0 ? finiteEndSlackPx : 0;

    if (infinite || count === 0) {
      // Infinite mode (or no items) → no finite range
      finiteRangeRef.current = null;
    } else if (totalH <= viewportH) {
      // List shorter than or equal to the viewport → clamp only to slack
      finiteRangeRef.current = {
        minY: -extraBottom, // small negative overscroll (downwards towards the bottom)
        maxY: extraTop,     // small positive overscroll (upwards towards the top)
      };
    } else {
      // List taller than the viewport → real scroll + slack
      const scrollTopMax = Math.max(0, totalH - viewportH + extraBottom);
      finiteRangeRef.current = {
        minY: -scrollTopMax, // all the way to the bottom (including extra bottom slack)
        maxY: extraTop,      // allow a bit of positive offset at the top
      };
    }

    if (!infinite) {
      clampSmoothYFinite();
      scheduleSetTrackY();
      maybeUpdateWindow();
    }
  }, [
    count,
    stride,
    containerH,
    infinite,
    finiteStartSlackPx,
    finiteEndSlackPx,
    clampSmoothYFinite,
    scheduleSetTrackY,
    maybeUpdateWindow,
  ]);



    const onWheel = useCallback((e: React.WheelEvent) => {
    if (recenteringRef.current) return;

    // Normalize to pixels (use containerH if deltaMode = "page")
    const rawPx   = wheelDeltaInPixels(e, Math.max(1, containerH));
    const deltaPx = applyStep(rawPx, wheelFeel);
    if (deltaPx === 0) return;

    // Finite mode: at physical edges, release wheel to native page scroll
    // so the user can exit the list zone without moving the cursor.
    if (allowWheelPageEdgeRelease && !infinite && finiteRangeRef.current) {
      const { minY, maxY } = finiteRangeRef.current;
      const y = smoothYRef.current;
      const atTopEdge = y >= (maxY - EDGE_EPS);
      const atBottomEdge = y <= (minY + EDGE_EPS);
      const tryingToLeaveTop = atTopEdge && deltaPx < 0;
      const tryingToLeaveBottom = atBottomEdge && deltaPx > 0;
      if (tryingToLeaveTop || tryingToLeaveBottom) {
        inertiaVelRef.current = 0;
        return;
      }
    }

    // The list owns wheel interaction while pointer is inside its region.
    if (e.cancelable) e.preventDefault();

    const velPart = wheelFeel.blend;
    const posPart = 1 - wheelFeel.blend;

    if (velPart > 0) inertiaVelRef.current += -deltaPx * wheelFeel.velScale * velPart;
    if (posPart > 0) smoothYRef.current    += -deltaPx * wheelFeel.posScale * posPart;

    if (!infinite) {
      clampSmoothYFinite();
    }

    scheduleSetTrackY();
    maybeUpdateWindow();
    ensureRunning();
  }, [containerH, wheelFeel, scheduleSetTrackY, maybeUpdateWindow, ensureRunning, allowWheelPageEdgeRelease, infinite, clampSmoothYFinite, EDGE_EPS]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(e.target)) return;
    if (recenteringRef.current) { e.preventDefault(); return; }
    if (e.pointerType === 'touch' && e.cancelable) {
      e.preventDefault();
    }

    pointerDownRef.current = true;
    isDraggingRef.current = false;
    dragCapturedRef.current = false;
    startYRef.current = e.clientY;
    lastYRef.current = e.clientY;
    accumDyRef.current = 0;
    lastMoveTsRef.current = performance.now();
    inertiaVelRef.current = 0;

    LOG('Pointer down', { y: e.clientY });
    ensureRunning();
  }, [ensureRunning, LOG]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(e.target)) return;
    if (recenteringRef.current) { e.preventDefault(); return; }
    if (!pointerDownRef.current) return;

    const now  = performance.now();
    const prev = lastMoveTsRef.current ?? now;
    const dt   = Math.max(0.001, (now - prev) / 1000);
    lastMoveTsRef.current = now;

    const dy = e.clientY - lastYRef.current;
    lastYRef.current = e.clientY;

    if (!isDraggingRef.current) {
      accumDyRef.current += Math.abs(e.clientY - startYRef.current);
      if (accumDyRef.current >= DRAG_THRESHOLD) {
        isDraggingRef.current = true;
        LOG('Drag start', { startY: startYRef.current, nowY: e.clientY, threshold: DRAG_THRESHOLD });

        if (!dragCapturedRef.current) {
          try { containerRef.current?.setPointerCapture(e.pointerId); dragCapturedRef.current = true; } catch {}
        }

        // Change cursor only after drag is confirmed.
        const el = containerRef.current;
        if (el) el.style.cursor = 'grabbing';
      } else {
        return; // keep click “clean”
      }
    }

    // Touch + finite list: when dragging past a hard edge, hand movement back
    // to document scroll to avoid trapping the user inside the list viewport.
    if (e.pointerType === 'touch' && !infinite && finiteRangeRef.current) {
      const { minY, maxY } = finiteRangeRef.current;
      const y = smoothYRef.current;
      const atTopEdge = y >= (maxY - EDGE_EPS);
      const atBottomEdge = y <= (minY + EDGE_EPS);
      const draggingOutTop = atTopEdge && dy > 0;
      const draggingOutBottom = atBottomEdge && dy < 0;

      if (draggingOutTop || draggingOutBottom) {
        window.scrollBy({ top: -dy, behavior: 'auto' });
        inertiaVelRef.current = 0;
        return;
      }
    }

    if (e.pointerType === 'touch' && e.cancelable) {
      e.preventDefault();
    }

    smoothYRef.current += dy * 1.2;

    if (!infinite) {
      clampSmoothYFinite();
    }
    scheduleSetTrackY();

    const v = dy * 1.2 / dt;
    inertiaVelRef.current = inertiaVelRef.current * 0.2 + v * 0.8;

    maybeUpdateWindow();
    ensureRunning();
  }, [ scheduleSetTrackY, maybeUpdateWindow, ensureRunning, LOG, infinite, clampSmoothYFinite]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(e.target)) return;
    if (recenteringRef.current) { e.preventDefault(); return; }

    if (dragCapturedRef.current) {
      try { containerRef.current?.releasePointerCapture(e.pointerId); } catch {}
      dragCapturedRef.current = false;
    }

    pointerDownRef.current = false;

    if (!isDraggingRef.current) {
      // Click without drag: do not touch the cursor (let button’s pointer win).
      inertiaVelRef.current = 0;
    } else {
      // Drag ended: back to “grab”.
      const el = containerRef.current;
      if (el) el.style.cursor = 'grab';
    }

    isDraggingRef.current = false;
  }, []);

  /* ───────────────────────── Intro gating ───────────────────────── */

  const [introDone, setIntroDone] = useState(false);
  const introDoneRef = useRef(false);

  useEffect(() => {
    if (!playIntro || prefersReduced) {

      // eslint-disable-next-line react-hooks/immutability
      introDoneRef.current = true;
      setIntroDone(true);
      LOG('Intro skipped');
      return;
    }
    const totalMs = (introDuration + Math.max(0, renderCount - 1) * introStagger + 0.05) * 1000;

    introDoneRef.current = false;
    setIntroDone(false);
    LOG('Intro scheduled', { totalMs, renderCount });
    const t = window.setTimeout(() => {


      introDoneRef.current = true;
      setIntroDone(true);
      LOG('Intro done');
    }, totalMs);

    return () => {
      window.clearTimeout(t);
      LOG('Intro canceled');
    };
  }, [playIntro, prefersReduced, renderCount, introDuration, introStagger, LOG]);

  /* ───────────────────────── Parallax springs ───────────────────────── */

  const yTitleMV = useSpring(0, { stiffness: 150, damping: 28, mass: 1.05 });
  const yActionsMV = useSpring(0, { stiffness: 145, damping: 30, mass: 1.07 });
  const yMetaMV = useSpring(0, { stiffness: 140, damping: 32, mass: 1.1 });

  const parallaxBaseRef = useRef(0);
  const lastParallaxRef = useRef({ title: 0, actions: 0, meta: 0 });
  const parallaxLatched = useRef(false);
  const idleFramesRef = useRef(0);

  const EPS = 0.001;
  const ZERO_SNAP = 0.25;
  const VEL_EPS_PX = 0.05;
  const IDLE_FRAMES_BEFORE_LATCH = 12;

  const q = useCallback(
    (v: number) => (Math.abs(v) < ZERO_SNAP ? 0 : Math.round(v * 1000) / 1000),
    []
  );

    // Reset parallax if autoplay gets disabled.
    useEffect(() => {
      if (resolvedAutoplay > 0) {
        rowHoverCountRef.current = 0;
        isHoveringRef.current = false;
        if (Math.abs(inertiaVelRef.current) < INERTIA_MIN_V) inertiaVelRef.current = 0;
        LOG('Autoplay enabled (guards reset)');
        return;
      }
      parallaxLatched.current = true;
      if (lastParallaxRef.current.title   !== 0) { yTitleMV.set(0);   lastParallaxRef.current.title   = 0; }
      if (lastParallaxRef.current.actions !== 0) { yActionsMV.set(0); lastParallaxRef.current.actions = 0; }
      if (lastParallaxRef.current.meta    !== 0) { yMetaMV.set(0);    lastParallaxRef.current.meta    = 0; }
      LOG('Autoplay disabled → parallax reset to 0');
    }, [resolvedAutoplay, yTitleMV, yActionsMV, yMetaMV, LOG]);

  /* ───────────────────────── Animated recenter to “peek” ───────────────────────── */

  const lastRecenterAtRef = useRef(0);
  const recenteringRef = useRef(false);
  const recenterRafIdRef = useRef<number | null>(null);

  const RECENTER_COOLDOWN_MS = 10_000;
  const V_MAX = 1100;
  const RECENTER_MIN_S = 0.25;
  const RECENTER_MAX_S = 1.5;
  const RECENTER_DEADZONE_PX = 8;

  /** Animate back to the baseline (initial peek). */
  const tryRecenterToStart = useCallback(() => {
    if (!infinite) return;
    lastRecenterAtRef.current = Date.now();
    
    // eslint-disable-next-line react-hooks/immutability
    recenteringRef.current = true;

    const startY = smoothYRef.current;
    const ratio  = clamp(initialPeekRatio, -1, 1);
    const peekPx = ratio * stride;
    const endY = -peekPx;

    const dist = Math.abs(endY - startY);
    let dur = dist / V_MAX;
    dur = Math.max(RECENTER_MIN_S, Math.min(RECENTER_MAX_S, dur));

    LOG('Recenter start', { from: startY, to: endY, duration: dur, peekPx });

    const t0 = performance.now();

    const step = (tNow: number) => {
      const t = Math.min(1, (tNow - t0) / (dur * 1000));
      const k = easeInOutCubic(t);
      smoothYRef.current = startY + (endY - startY) * k;
      scheduleSetTrackY();

      if (t < 1) {
        recenterRafIdRef.current = requestAnimationFrame(step);
      } else {
        smoothYRef.current = endY;
        const first = Math.floor(peekPx / stride);
        prevFirstVisibleRef.current = first;
        setWindowStartAbs(first - buffer);
        scheduleSetTrackY();
        maybeUpdateWindow();


        recenteringRef.current = false;

        recenterRafIdRef.current = null;
        LOG('Recenter complete', { endY, firstVisible: first, windowStartAbs: first - buffer });
      }
    };
    recenterRafIdRef.current = requestAnimationFrame(step);
  }, [buffer, initialPeekRatio, scheduleSetTrackY, maybeUpdateWindow, stride, LOG, infinite]);

  /** Animate to a given absolute index and leave it as “first visible”. */
  const scrollToAbsIndex = useCallback((targetAbsIndex: number) => {
    // Stop anything currently moving.
    if (recenterRafIdRef.current) {
      cancelAnimationFrame(recenterRafIdRef.current);
      recenterRafIdRef.current = null;
    }
    inertiaVelRef.current = 0;          // no competing inertia
    pointerDownRef.current = false;     // not dragging

    // eslint-disable-next-line react-hooks/immutability
    recenteringRef.current = true;

    const ratio  = clamp(initialPeekRatio, -1, 1);
    const peekPx = ratio * stride;
    const startY = smoothYRef.current;
    const endY   = -(targetAbsIndex * stride + peekPx);

    const dist = Math.abs(endY - startY);
    let dur = dist / V_MAX;
    dur = Math.max(RECENTER_MIN_S, Math.min(RECENTER_MAX_S, dur));

    const t0 = performance.now();
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / (dur * 1000));
      const e = ease(k);
      smoothYRef.current = startY + (endY - startY) * e;
      if (!infinite) {
        clampSmoothYFinite();
      }
      scheduleSetTrackY();

      if (k < 1) {
        recenterRafIdRef.current = requestAnimationFrame(step);
      } else {
        smoothYRef.current = endY;
        if (!infinite) {
          clampSmoothYFinite();
        }
        const first = targetAbsIndex + Math.floor(ratio);
        prevFirstVisibleRef.current = first;
        setWindowStartAbs(first - buffer);
        scheduleSetTrackY();
        maybeUpdateWindow();


        recenteringRef.current = false;

        recenterRafIdRef.current = null;
      }
    };
    recenterRafIdRef.current = requestAnimationFrame(step);
  }, [buffer, initialPeekRatio, scheduleSetTrackY, maybeUpdateWindow, stride, infinite, clampSmoothYFinite]);

  /* ───────────────────────── Jump to first matching search result ───────────────────────── */

  useEffect(() => {
    if (!searchActive || !searchFocusIndices?.length || count === 0) return;

    // Cancel any ongoing recenter animation so it does not compete with the jump.
    if (recenterRafIdRef.current) {
      cancelAnimationFrame(recenterRafIdRef.current);
      recenterRafIdRef.current = null;
    }

    // eslint-disable-next-line react-hooks/immutability
    recenteringRef.current = false;

    const c = count;
    // Absolute index of the first currently visible item.
    const firstAbs = Math.floor((-smoothYRef.current) / stride);

    // Find the FIRST match that lands at or below firstAbs.
    // If all are “above”, the ceil wraps to the next cycle.
    let bestAbs = Number.POSITIVE_INFINITY;

    for (const k of searchFocusIndices) {
      if (k < 0 || k >= c) continue;
      const n = Math.ceil((firstAbs - k) / c); // ensures cand >= firstAbs
      const cand = k + n * c;
      if (cand < bestAbs) bestAbs = cand;
    }

    if (Number.isFinite(bestAbs)) {
      // Use the existing helper: respects initialPeekRatio and leaves that item
      // as firstVisible = 0.
      scrollToAbsIndex(bestAbs);
    }
  }, [searchActive, searchFocusIndices, count, stride, scrollToAbsIndex]);

  /* ───────────────────────── Main loop (rAF) ───────────────────────── */

  useEffect(() => {

    const logAutoChange = (now: boolean) => {
      if (now !== prevAutoRef.current) {
        prevAutoRef.current = now;
        LOG('Autoplay state', now ? 'ON' : 'OFF');
      }
    };

    // eslint-disable-next-line react-hooks/immutability
    tickRef.current = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      let moved = false as boolean;
      let movedBy: 'inertia' | 'autoplay' | null = null;

      // Inertia
      if (!pointerDownRef.current && Math.abs(inertiaVelRef.current) >= INERTIA_MIN_V) {
        smoothYRef.current += inertiaVelRef.current * dt;
        // Exponential decay
        const decay = Math.exp(-INERTIA_DECAY * dt);
        inertiaVelRef.current *= decay;
        if (Math.abs(inertiaVelRef.current) < INERTIA_MIN_V) inertiaVelRef.current = 0;
        moved = true;
        movedBy = 'inertia';
      }

      // Autoplay (only after intro and with no inertia)
      const dir = (autoplayDirRef.current === 'down' ? 1 : -1);
      const canAutoplayNow =
        !pointerDownRef.current &&
        !recenteringRef.current &&
        introDoneRef.current &&
        inertiaVelRef.current === 0 &&
        (resolvedAutoplayRef.current ?? 0) > 0 &&
        !isHoveringRef.current;

      logAutoChange(canAutoplayNow);

      if (canAutoplayNow) {
        smoothYRef.current += dir * (resolvedAutoplayRef.current ?? 0) * dt;
        moved = true;
        if (!movedBy) movedBy = 'autoplay';
      }

      if (moved) {
        if (!infinite) {
          clampSmoothYFinite();
        }
        scheduleSetTrackY();
        maybeUpdateWindow();
        if (movedBy) LOG('Tick moved', { by: movedBy, y: smoothYRef.current });
      }

      // Auto-deselect on scroll (disabled while searching).
      if (selectedRowIdRef.current && !searchActiveRef.current) {
        const base = yAtSelectRef.current ?? smoothYRef.current;
        const delta = Math.abs(smoothYRef.current - base);
        if (delta > scrollDeselectPx) {
          LOG('Auto-deselect due to scroll', { delta, threshold: scrollDeselectPx });
          onClearSelectionRef.current?.();


          yAtSelectRef.current = null;

        }
      }

      // Parallax driver
      const parallaxOn = parallaxEnabled && !(respectReducedMotion && prefersReduced);
      const driveVel =
        Math.abs(inertiaVelRef.current) > 0
          ? inertiaVelRef.current
          : canAutoplayNow
            ? dir * resolvedAutoplay * parallaxAutoplayFactor
            : 0;

      const speedPx = Math.abs(driveVel) * parallaxVelocityToPx;
      if (speedPx <= VEL_EPS_PX) {
        idleFramesRef.current++;
      } else {
        if (parallaxLatched.current) LOG('Parallax unlatch');
        idleFramesRef.current = 0;
        parallaxLatched.current = false;
      }

      const raw = clamp(driveVel * parallaxVelocityToPx, -parallaxMaxOffset, parallaxMaxOffset);
      const LERP_RATE = 9;
      const alpha = 1 - Math.exp(-LERP_RATE * dt);
      const target = parallaxOn ? raw : 0;

      if (parallaxLatched.current && Math.abs(target) <= ZERO_SNAP) {
        // stay at 0
      } else {
        const before = parallaxBaseRef.current;
        parallaxBaseRef.current = before + (target - before) * alpha;

        if (
          idleFramesRef.current >= IDLE_FRAMES_BEFORE_LATCH &&
          Math.abs(parallaxBaseRef.current) <= ZERO_SNAP &&
          Math.abs(target) <= ZERO_SNAP
        ) {
          parallaxBaseRef.current = 0;

          if (lastParallaxRef.current.title !== 0) { yTitleMV.set(0); lastParallaxRef.current.title = 0; }
          if (lastParallaxRef.current.actions !== 0) { yActionsMV.set(0); lastParallaxRef.current.actions = 0; }
          if (lastParallaxRef.current.meta !== 0) { yMetaMV.set(0); lastParallaxRef.current.meta = 0; }

          parallaxLatched.current = true;
          LOG('Parallax latched at zero', { before, after: 0 });
        } else {
          const tTitle = q(parallaxBaseRef.current * parallaxTitleFactor);
          const tActions = q(parallaxBaseRef.current * parallaxActionsFactor);
          const tMeta = q(parallaxBaseRef.current * parallaxMetaFactor);

          if (Math.abs(tTitle - lastParallaxRef.current.title) > EPS) { yTitleMV.set(tTitle); lastParallaxRef.current.title = tTitle; }
          if (Math.abs(tActions - lastParallaxRef.current.actions) > EPS) { yActionsMV.set(tActions); lastParallaxRef.current.actions = tActions; }
          if (Math.abs(tMeta - lastParallaxRef.current.meta) > EPS) { yMetaMV.set(tMeta); lastParallaxRef.current.meta = tMeta; }
        }
      }

      // Recenter trigger (back to baseline/peek) when drifting too far.
      const COOLDOWN_OK = Date.now() - lastRecenterAtRef.current > RECENTER_COOLDOWN_MS;
      const NO_INTERACTION =
        !pointerDownRef.current &&
        inertiaVelRef.current === 0 &&
        !isHoveringRef.current &&
        !searchActiveRef.current &&
        !selectedRowIdRef.current &&
        introDoneRef.current;

      const ratio  = clamp(initialPeekRatio, -1, 1);
      const peekPx = ratio * stride;
      const baselineY = -peekPx;
      const distFromBaseline = Math.abs(smoothYRef.current - baselineY);
      const RECENTER_THRESHOLD = containerH * 3;

      if (infinite) {
        if (
          !recenteringRef.current &&
          COOLDOWN_OK &&
          NO_INTERACTION &&
          distFromBaseline > (RECENTER_THRESHOLD + RECENTER_DEADZONE_PX)
        ) {
          LOG('Recenter trigger', { distFromBaseline, RECENTER_THRESHOLD, baselineY, y: smoothYRef.current });
          tryRecenterToStart();
        }
      }

      // Schedule next frame (single place).
      const shouldContinue =
        pointerDownRef.current ||
        Math.abs(inertiaVelRef.current) >= INERTIA_MIN_V ||
        canAutoplayNow ||
        recenteringRef.current;

      if (shouldContinue) {
        rafRef.current = requestAnimationFrame((t) => tickRef.current?.(t));
      } else {
        LOG?.('[TiltedEngine] rAF stopped (no activity)');
        rafRef.current = null;
        runningRef.current = false;
      }
    };

    return () => {
      stopRAF();
      lastTsRef.current = null;

      if (recenterRafIdRef.current) {
        cancelAnimationFrame(recenterRafIdRef.current);
        recenterRafIdRef.current = null;
      }
      if (writeRafIdRef.current != null) {
        cancelAnimationFrame(writeRafIdRef.current);
        writeRafIdRef.current = null;
      }
      LOG('Tick cleanup');
    };
  }, [
      /* ---------------- Deps (no live flags) -------------- */
      /* Core motion inputs that can reshape physics/layout */
      containerH,
      initialPeekRatio,
      scrollDeselectPx,
      q,
      stride,
      resolvedAutoplay,

      /* Parallax controls */
      parallaxEnabled,
      parallaxVelocityToPx,
      parallaxMaxOffset,
      parallaxTitleFactor,
      parallaxActionsFactor,
      parallaxMetaFactor,
      parallaxAutoplayFactor,

      /* Motion reduction */
      respectReducedMotion,
      prefersReduced,

      /* External callbacks */
      tryRecenterToStart,
      scheduleSetTrackY,
      maybeUpdateWindow,
      stopRAF,
      clampSmoothYFinite,
      infinite,

      /* MotionValues (parallax layers) */
      yTitleMV,
      yActionsMV,
      yMetaMV,

      /* Debug */
      debug,
      LOG,
    ]);
  /* ───────────────────────── Initial peek before first paint ───────────────────────── */

  const didInitRef = useRef(false);
  useLayoutEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    const el = containerRef.current;
    if (el) el.style.cursor = count > 0 ? 'grab' : 'default';

    const ratio  = clamp(initialPeekRatio, -1, 1);
    const peekPx = ratio * stride;
    smoothYRef.current = -peekPx;

    const track = trackRef.current;
    if (track) {
      const snapped = snapToDpr(smoothYRef.current);
      track.style.transform = `translate3d(0, ${snapped}px, 0)`;
      lastWrittenYRef.current = snapped;
      LOG('Initial peek placed', { peekPx, snapped });
    } else {
      scheduleSetTrackY();
    }

    const first = Math.floor(peekPx / stride);
    prevFirstVisibleRef.current = first;
    setWindowStartAbs(first - buffer);
    if (debug) console.log('[TiltedEngine]', 'Initial window', { firstVisible: first, windowStartAbs: first - buffer });

    if (resolvedAutoplay > 0 && !recenteringRef.current) {
      if (debug) console.log('[TiltedEngine]', 'Ensure running on init (autoplay)');
      ensureRunning();
    }
  }, [resolvedAutoplay, count, scheduleSetTrackY, ensureRunning, buffer, stride, initialPeekRatio, debug, LOG, infinite, clampSmoothYFinite]);

  /* ───────────────────────── Robust reset on window blur ───────────────────────── */

  useEffect(() => {
    const onBlur = () => {
      pointerDownRef.current = false;
      isDraggingRef.current = false;
      inertiaVelRef.current = 0;
      const el = containerRef.current;
      if (el) el.style.cursor = count > 0 ? 'grab' : 'default';
      LOG('Window blur → reset drag/inertia');
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [count, LOG]);

  /* ───────────────────────── Re-arm loop when intro completes or autoplay toggles ───────────────────────── */

  useEffect(() => {
    const canRun = introDone && resolvedAutoplay > 0 && !recenteringRef.current;
    if (canRun) {
      LOG('Ensure running (autoplay/intro)');
      ensureRunning();
    } else {
      LOG('Ensure NOT running (gated)', { introDone, resolvedAutoplay, recentering: recenteringRef.current });
    }
  }, [introDone, resolvedAutoplay, ensureRunning, LOG]);

  /* ───────────────────────── Selection tracking (Y at selection time) ───────────────────────── */

  const yAtSelectRef = useRef<number | null>(null);
  useEffect(() => {
    // When selectedRowId changes externally, set the base Y for comparison.

    // eslint-disable-next-line react-hooks/immutability
    if (selectedRowId) yAtSelectRef.current = smoothYRef.current;


    else yAtSelectRef.current = null;

  }, [selectedRowId]);

  /* ───────────────────────── 3D activation by row (post intro) ───────────────────────── */

  const [activated3D, setActivated3D] = useState<Set<number>>(new Set());
  const mark3DActive = useCallback((dataIndex: number) => {
    setActivated3D(prev => {
      if (prev.has(dataIndex)) return prev;
      const next = new Set(prev);
      next.add(dataIndex);
      LOG('Row 3D active', { dataIndex });
      return next;
    });
  }, [LOG]);

  /* ───────────────────────── Derived flags ───────────────────────── */

  const runIntro = playIntro && !introDone;

  /* ───────────────────────── Public API ───────────────────────── */

  return {
    containerH,
    windowStartAbs,
    renderCount,

    introDone,
    runIntro,

    containerRef,
    trackRef,

    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,

    onRowPointerEnter,
    onRowPointerLeave,

    yTitleMV,
    yActionsMV,
    yMetaMV,

    activated3D,
    mark3DActive,

    modulo,
  };
}
