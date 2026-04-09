'use client';

import React, {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { motion } from 'motion/react';
import { useTiltedListEngine, type Direction } from './internal/useTiltedListEngine';
import TiltedListEventRow from '@/components/Agenda/tilted-list/TiltedListEventRow';
import type { EventWithCreatorAndRsvps } from '@/types/event';
import type { ScrollFeel } from './internal/scrollMath';
import { cn } from '@/lib/utils';

/* ──────────────────────────────────────────────────────────────────
   Public props ( the engine is encapsulated in useTiltedListEngine)
   ────────────────────────────────────────────────────────────────── */

export interface TiltedInfiniteListProps {
  events: EventWithCreatorAndRsvps[];
  onDetails: (ev: EventWithCreatorAndRsvps) => void;

  /* Geometry */
  itemHeight?: number;
  gap?: number;
  buffer?: number;
  width?: CSSProperties['width'];

  /* Tilt */
  tiltEnabled?: boolean;
  tiltDirection?: 'left' | 'right';
  tiltAmountDeg?: number;
  tiltShiftX?: number;

  /* Autoplay */
  autoplayPxPerSec?: number; // 0 = off
  autoplayDirection?: Direction;
  pauseOnHover?: boolean;

  /* Aesthetics */
  className?: string;
  getRowClassName?: (ev: EventWithCreatorAndRsvps) => string;

  /* Accessibility / motion */
  respectReducedMotion?: boolean;

  /* Intro animation */
  playIntro?: boolean;
  introStagger?: number;
  introDuration?: number;
  introScaleFrom?: number;

  /* Initial peek */
  initialPeekRatio?: number;

  /* Parallax */
  parallaxEnabled?: boolean;
  parallaxVelocityToPx?: number;
  parallaxMaxOffset?: number;
  parallaxTitleFactor?: number;
  parallaxActionsFactor?: number;
  parallaxMetaFactor?: number;
  parallaxAutoplayFactor?: number;

  /* Container height (optional; otherwise uses default layout) */
  containerHeight?: number | string;

  /* Integration with the upper wrapper */
  searchActive?: boolean;
  searchFocusIds?: ReadonlySet<string> | string[];
  onPauseAutoplay?: () => void;
  selectedRowPopDepth?: number; // px
  selectedRowScale?: number;
  alwaysPerspectiveForZPop?: boolean;

  /* Selection (controlled/uncontrolled) */
  selectedRowId?: string | null;
  onSelectRow?: (id: string | null) => void;

  /* Order badge */
  showOrderNumbers?: boolean;
  getOrderNumber?: (id: string) => number | null;

  /* Windowing cap */
  maxRenderCount?: number;
  wheelFeel?: 'trackpad' | 'wheel' | 'buttery' | 'tight';
  wheelFeelOverride?: Partial<ScrollFeel>;

  /** Infinite wrap (default true). When false, list clamps at ends */
  infinite?: boolean;

  /** Allow wheel-at-edge release to native page scrolling (finite mode only). */
  allowWheelPageEdgeRelease?: boolean;


  /* Logs */
  debug?: boolean;
}

/* ──────────────────────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────────────────────── */

export default function TiltedInfiniteList(props: TiltedInfiniteListProps) {
  const {
    events,
    onDetails,

    /* Geometry */
    itemHeight = 140,
    gap = 12,
    buffer = 5,
    width = 'clamp(720px, 58vw, 880px)',

    /* Tilt */
    tiltEnabled = true,
    tiltDirection = 'left',
    tiltAmountDeg = 17,
    tiltShiftX = 5,

    /* Autoplay */
    autoplayPxPerSec = 40,
    autoplayDirection = 'up',
    pauseOnHover = true,

    /* Aesthetics */
    className,
    getRowClassName,

    /* Accessibility / motion */
    respectReducedMotion = true,

    /* Intro animation */
    playIntro = true,
    introStagger = 0.06,
    introDuration = 0.35,
    introScaleFrom = 0.96,

    /* Initial peek */
    initialPeekRatio = 0.35,

    /* Parallax */
    parallaxEnabled = true,
    parallaxVelocityToPx = 0.02,
    parallaxMaxOffset = 16,
    parallaxTitleFactor = 1.0,
    parallaxActionsFactor = 0.7,
    parallaxMetaFactor = 0.4,
    parallaxAutoplayFactor = 4,

    /* Container */
    containerHeight,

    /* Integration with wrapper */
    searchActive = false,
    searchFocusIds,
    onPauseAutoplay,
    alwaysPerspectiveForZPop = true,
    selectedRowPopDepth = 15,
    selectedRowScale = 1.015,

    /* Selection */
    selectedRowId: selectedRowIdProp,
    onSelectRow,

    /* Order badge */
    showOrderNumbers = true,
    getOrderNumber,

    /* Windowing cap */
    maxRenderCount,

    /* Infinite vs finite mode */
    infinite = false,
    allowWheelPageEdgeRelease = true,

    /* Logs */
    debug = false,
  } = props;

  /* ───────────────────────── Derived values ───────────────────────── */

  const count = Math.max(0, events.length);
  const stride = itemHeight + gap;

  const ariaLabel = "RSVP events list";

// Top slack: so that the first row isnt covered by the top edge fade, and 
// to give some extra room in finite mode for the selected row to pop out without being visually cut off.
// In infinite mode we can skip this since the list wraps around seamlessly.
const finiteTopSlackPx = 
  !infinite
    ? Math.round(stride * (tiltEnabled ? 1.5 : 0.2))
    : 0; // smaller tilt slack + extra list-mode room for selected-row pop/glow

// Bottom slack: what we were already using to make the last row look complete on tilt.
const finiteBottomSlackPx =
  !infinite && tiltEnabled ? Math.round(itemHeight * 1.2) : Math.round(itemHeight * 0.5);

  // Controlled vs uncontrolled selection
  const isControlled = typeof selectedRowIdProp !== 'undefined';
  const [internalSelectedRowId, setInternalSelectedRowId] = useState<string | null>(null);
  const selectedRowId = isControlled ? (selectedRowIdProp ?? null) : internalSelectedRowId;

  const setSelectedRowId = useCallback(
    (id: string | null) => {
      if (isControlled) onSelectRow?.(id);
      else setInternalSelectedRowId(id);
    },
    [isControlled, onSelectRow]
  );

  const handleRowInteract = useCallback(
    (rowId: string) => {
      setSelectedRowId(rowId);
    },
    [setSelectedRowId]
  );

  // Build the indices of items matching the current search
  const searchFocusIndices = useMemo(() => {
    if (!searchActive) return undefined;
    if (!searchFocusIds) return undefined;

    const isMatch =
      searchFocusIds instanceof Set
        ? (id: string) => searchFocusIds.has(id)
        : (id: string) => (searchFocusIds as string[]).includes(id);

    const out: number[] = [];
    for (let i = 0; i < events.length; i++) {
      if (isMatch(events[i].id)) out.push(i);
    }
    return out.length ? out : undefined;
  }, [searchActive, searchFocusIds, events]);

  /* ───────────────────────── Engine hookup ───────────────────────── */

  const {
    windowStartAbs,
    renderCount,

    //introDone,
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
  } = useTiltedListEngine({
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
    searchFocusIndices,
    selectedRowId,
    onClearSelection: () => setSelectedRowId(null),

    scrollDeselectPx: 8,
    wheelFeel: props.wheelFeel,
    wheelFeelOverride: props.wheelFeelOverride,
    infinite,
    allowWheelPageEdgeRelease,
    finiteStartSlackPx: finiteTopSlackPx,
    finiteEndSlackPx: finiteBottomSlackPx,
    debug,
  });

  /* ───────────────────────── Presentational tilt ───────────────────────── */

  const tiltAnimate = useMemo(() => {
    const s = tiltAmountDeg;
    const z = tiltDirection === 'left' ? -s : s;
    const skewX = tiltDirection === 'left' ? s : -s;

    return tiltEnabled
      ? { rotateX: 15, rotateZ: z, skewX, transformPerspective: 1000 }
      : { rotateX: 0, rotateZ: 0, skewX: 0, transformPerspective: 1000 };
  }, [tiltEnabled, tiltDirection, tiltAmountDeg]);

  /* ───────────────────────── Windowed row rendering ───────────────────────── */

  const hasSelection = selectedRowId != null;
  const rows: ReactNode[] = [];

  // Per-render hoists (avoid recomputation per row)
  const skewDeg = tiltEnabled ? (tiltDirection === 'left' ? tiltAmountDeg : -tiltAmountDeg) : 0;
  const TAN_SKEW = Math.tan((skewDeg * Math.PI) / 180);
  const SKEW_COMP_FACTOR = 3.5;

  // Only apply parallax when granted permission and tilt it's on
  const parallaxActive = parallaxEnabled && tiltEnabled;

  const TRANS_SEL = {
    z: { duration: 0.32, ease: [0.16, 0.84, 0.24, 1.0] as const },
    x: { duration: 0.32, ease: [0.16, 0.84, 0.24, 1.0] as const },
    scale: { duration: 0.32, ease: [0.16, 0.84, 0.24, 1.0] as const },
  };
  const TRANS_NORM = {
    z: { duration: 0.22, ease: [0.33, 0.0, 0.2, 1.0] as const },
    x: { duration: 0.22, ease: [0.33, 0.0, 0.2, 1.0] as const },
    scale: { duration: 0.22, ease: [0.33, 0.0, 0.2, 1.0] as const },
  };

  for (let i = 0; i < renderCount; i++) {
    const absIndex = windowStartAbs + i;
    const dataIndex = infinite ? modulo(absIndex, count) : absIndex;
    if (!infinite && (dataIndex < 0 || dataIndex >= count)) {
      continue;
    }
    const ev = events[dataIndex];
    const key = infinite ? `${absIndex}:${ev.id}` : ev.id;
    const top = absIndex * stride;

    const row3DActive = !runIntro || activated3D.has(dataIndex);
    const isSel = selectedRowId === ev.id;
    const zPop = isSel ? selectedRowPopDepth : 0;
    const scl = isSel ? selectedRowScale : 1;
    const xForPop = isSel ? TAN_SKEW * (zPop * SKEW_COMP_FACTOR) : 0;

    const orderNumber =
      showOrderNumbers && getOrderNumber ? getOrderNumber(ev.id) : null;

    rows.push(
      <li
        key={key}
        className="absolute left-0 right-0 overflow-visible"
        style={{
          top: `${top}px`,
          height: `${itemHeight}px`,
          zIndex: isSel ? 40 : 10,
          transformStyle: 'preserve-3d',
          willChange: 'transform',
        }}
        onPointerEnter={onRowPointerEnter}
        onPointerLeave={() => {
          onRowPointerLeave();   // no args
          onPauseAutoplay?.();   // let wrapper soft-pause autoplay if desired
        }}
        aria-label={ev.title}
      >
        <motion.div
          className="h-full"
          initial={
            runIntro
              ? (autoplayPxPerSec > 0
                  ? { opacity: 0, scale: introScaleFrom, y: 0, z: 0, x: 0 }
                  : { opacity: 0, scale: introScaleFrom, y: 22, z: 0, x: 0 })
              : { opacity: 1, scale: 1, y: 0, z: zPop, x: xForPop }
          }
          animate={{ opacity: 1, y: 0, z: zPop, x: xForPop, scale: scl }}
          transition={
            runIntro
              ? { duration: introDuration, delay: i * introStagger, ease: 'easeOut' }
              : (isSel ? TRANS_SEL : TRANS_NORM)
          }
          onAnimationComplete={runIntro ? () => { mark3DActive(dataIndex); } : undefined}
          style={{ transformStyle: 'preserve-3d', willChange: 'transform' } as React.CSSProperties}
        >
          <TiltedListEventRow
            event={ev}
            onDetails={onDetails}
            className={getRowClassName?.(ev)}
            inner3DActive={row3DActive}
            stackTiltEnabled={tiltEnabled}
            stackTiltDirection={tiltDirection}
            stackTiltAmountDeg={tiltAmountDeg}
            parallaxTitleY={parallaxActive ? yTitleMV : undefined}
            parallaxActionsY={parallaxActive ? yActionsMV : undefined}
            parallaxMetaY={parallaxActive ? yMetaMV : undefined}
            isSelected={isSel}
            onRowInteract={handleRowInteract}
            orderNumber={orderNumber}
          />
        </motion.div>
      </li>
    );
  }

  /* ───────────────────────── Empty state ───────────────────────── */

  if (count === 0) {
    return (
      <div
        ref={containerRef}
        className={cn(
          'relative w-full overflow-x-hidden overflow-y-hidden select-none',
          '[--fade-top:56px] md:[--fade-top:96px]',
          '[--fade-bottom:56px] md:[--fade-bottom:96px]',
          '[mask-image:linear-gradient(to_bottom,transparent_0,black_var(--fade-top),black_calc(100%-var(--fade-bottom)),transparent_100%)]',
          '[-webkit-mask-image:linear-gradient(to_bottom,transparent_0,black_var(--fade-top),black_calc(100%-var(--fade-bottom)),transparent_100%)]',
        )}
        style={containerStyle(tiltEnabled, containerHeight)}
        role="region"
        aria-label={ariaLabel}
      />
    );
  }

  /* ───────────────────────── Main render ───────────────────────── */

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full overflow-x-hidden overflow-y-hidden select-none',
        // Top fade: stronger in Tilt, softer in List
        tiltEnabled ? '[--fade-top:56px] md:[--fade-top:96px]' : '[--fade-top:10px] md:[--fade-top:12px]',
        // Bottom fade: keep equal or slightly lower in List
        tiltEnabled ? '[--fade-bottom:56px] md:[--fade-bottom:96px]' : '[--fade-bottom:24px] md:[--fade-bottom:28px]',
        // Same mask in both modes
        '[mask-image:linear-gradient(to_bottom,transparent_0,black_var(--fade-top),black_calc(100%-var(--fade-bottom)),transparent_100%)]',
        '[-webkit-mask-image:linear-gradient(to_bottom,transparent_0,black_var(--fade-top),black_calc(100%-var(--fade-bottom)),transparent_100%)]',
        className,
      )}
      style={containerStyle(tiltEnabled, containerHeight)}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="region"
      aria-label={ariaLabel}
    >
      {/* Stack-level tilt wrapper */}
      <motion.div
        className="relative mx-auto"
        style={{
          width,
          transformStyle: 'preserve-3d',
          backfaceVisibility: 'hidden',
          transformOrigin: 'center center',
          x: tiltShiftX,
          height: '100%',
          minHeight: '100%',
          // Keep perspective even if tilt is off but a row pops-out in Z
          perspective: (!tiltEnabled && alwaysPerspectiveForZPop && hasSelection) ? 900 : undefined,
        } as React.CSSProperties}
        initial={tiltAnimate}
        animate={tiltAnimate}
        transition={{ duration: 0.45, ease: 'easeInOut' }}
      >
        {/* Track (translateY) */}
        <ul
          ref={trackRef}
          role="list"
          className="relative list-none m-0 p-0"
          style={{
            height: '100%',
            willChange: 'transform',
            transformStyle: 'preserve-3d', // prevents 3D flattening
            contain: 'layout',
            isolation: 'isolate',
          }}
        >
          {rows}
        </ul>
      </motion.div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Container Styles
   ────────────────────────────────────────────────────────────────── */

function containerStyle(tilt: boolean, heightOverride?: number | string): React.CSSProperties {
  const height =
    heightOverride !== undefined
      ? (typeof heightOverride === 'number' ? `${heightOverride}px` : heightOverride)
      : 'calc(100dvh - 180px)';

  return {
    // List region owns drag interactions (including touch) locally.
    touchAction: 'none',
    WebkitTransform: 'translateZ(0)',
    transform: 'translateZ(0)',
    willChange: 'transform',
    height,
    perspective: tilt ? '1000px' : 'none',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    overscrollBehaviorY: 'contain',
    cursor: 'default',
  };
}
