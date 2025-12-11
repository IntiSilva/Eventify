'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Player } from '@lordicon/react';
import { cn } from '@/lib/utils';
import { ArrowAnimatedIconFull } from '@/lib/icons';

/* ──────────────────────────────────────────────────────────────────
   Types
   ────────────────────────────────────────────────────────────────── */

type IconColors = { primary: string; secondary?: string };

// Lordicon state names (must match your JSON states)
const S_IN = 'in-arrow-up' as const;          // intro
const S_HOVER = 'hover-arrow-up-2' as const;  // hover
const S_CLICK = 'hover-arrow-up-1' as const;  // click
type StateName = typeof S_IN | typeof S_HOVER | typeof S_CLICK;

export type ScrollArrowButtonProps = {
  /** Visual orientation requested by the parent (driven by external scroll). */
  desiredOrientation: 'up' | 'down';

  /** If provided, parent controls the hover state; otherwise hover is self-managed. */
  isParentHovered?: boolean;

  /** Needed to enable hover interactions only on desktop (same as your version). */
  isDesktop: boolean;

  /** Icon size (not the hit area). */
  size?: number;

  /** Per-state colors forwarded to Lordicon. */
  inColors?: IconColors;
  hoverColors?: IconColors;
  actionColors?: IconColors;

  /** Callback fired once the click animation has finished. */
  onActionComplete?: () => void;

  /** Click handler to execute the real scroll action (the wrapper implements it). */
  onClick?: () => void;

  /** Extra classes for the button. */
  className?: string;

  /** Accessible label (kept off-screen). We do not use `title`. */
  ariaLabel?: string;
};

/* ──────────────────────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────────────────────── */

export default function ScrollArrowButton({
  desiredOrientation,
  isParentHovered,
  isDesktop,
  size = 28,
  inColors,
  hoverColors,
  actionColors,
  onActionComplete,
  onClick,
  className,
  ariaLabel = 'Scroll',
}: ScrollArrowButtonProps) {
  /* Refs & local state */
  const playerRef = useRef<Player>(null);

  // Animation locks as refs (no re-render needed)
  const clickAnimatingRef = useRef(false);
  const hoverAnimatingRef = useRef(false);

  // Self-managed hover when parent does not provide one
  const [selfHover, setSelfHover] = useState(false);
  const hovered = typeof isParentHovered === 'boolean' ? isParentHovered : selfHover;
  const prevHoverRef = useRef(false);

  // Lordicon Player readiness
  const [ready, setReady] = useState(false);

  // Lordicon state (both in state and ref so onComplete is reliable)
  const [stateName, _setStateName] = useState<StateName>(S_IN);
  const stateRef = useRef<StateName>(stateName);
  const setStateName = (s: StateName) => {
    stateRef.current = s;
    _setStateName(s);
  };

  /* ───────────────────────── Lordicon helpers ───────────────────────── */

  /** Switch to a state and optionally play from the beginning (on next rAF). */
  const setAnimState = useCallback((next: StateName, playNow: boolean) => {
    setStateName(next);
    requestAnimationFrame(() => {
      const p = playerRef.current;
      if (!p) return;
      if (playNow) {
        p.goToFirstFrame?.();
        p.playFromBeginning?.();
      } else {
        p.pause?.();
      }
    });
  }, []);

  /** Back to IN and freeze on the last frame (idle). */
  const setStateFrozenIn = useCallback(() => {
    setAnimState(S_IN, false);
    requestAnimationFrame(() => {
      const p = playerRef.current;
      if (!p) return;
      p.goToLastFrame?.();
      p.pause?.();
    });
  }, [setAnimState]);

  /** Player is ready → play intro once and freeze. */
  const handleReady = useCallback(() => {
    setReady(true);
    setAnimState(S_IN, true);
  }, [setAnimState]);

  /** On any animation completion, decide the next step. */
  const handleComplete = useCallback(() => {
    const current = stateRef.current;
    if (current === S_IN) {
      const p = playerRef.current;
      p?.goToLastFrame?.();
      p?.pause?.();
      return;
    }
    if (current === S_HOVER) {
      hoverAnimatingRef.current = false;
      setStateFrozenIn();
      return;
    }
    if (current === S_CLICK) {
      clickAnimatingRef.current = false;
      onActionComplete?.();
      setStateFrozenIn();
    }
  }, [onActionComplete, setStateFrozenIn]);

  /* ───────────────────────── Effects ───────────────────────── */

  // Hover rising-edge (desktop only; ignore during click)
  useEffect(() => {
    if (!isDesktop || !ready) return;
    const was = prevHoverRef.current;
    if (!was && hovered && !clickAnimatingRef.current && !hoverAnimatingRef.current) {
      hoverAnimatingRef.current = true;
      requestAnimationFrame(() => setAnimState(S_HOVER, true));
    }
    prevHoverRef.current = hovered;
  }, [hovered, isDesktop, setAnimState, ready]);
  
  /* ───────────────────────── Colors per state ───────────────────────── */

  // Lordicon expects a single string like: "primary:#fff,secondary:#000"
  const colorsIn = useMemo(
    () =>
      inColors
        ? `primary:${inColors.primary ?? ''}${
            inColors.secondary ? `,secondary:${inColors.secondary}` : ''
          }`
        : undefined,
    [inColors]
  );
  const colorsHover = useMemo(
    () =>
      hoverColors
        ? `primary:${hoverColors.primary ?? ''}${
            hoverColors.secondary ? `,secondary:${hoverColors.secondary}` : ''
          }`
        : undefined,
    [hoverColors]
  );
  const colorsClick = useMemo(
    () =>
      actionColors
        ? `primary:${actionColors.primary ?? ''}${
            actionColors.secondary ? `,secondary:${actionColors.secondary}` : ''
          }`
        : undefined,
    [actionColors]
  );

  const colorsForState =
    stateName === S_HOVER ? colorsHover :
    stateName === S_CLICK ? colorsClick :
    colorsIn;

  /* ───────────────────────── UI handlers ───────────────────────── */

  const rotationClass = desiredOrientation === 'up' ? 'rotate-0' : 'rotate-180';

  // Self-managed hover only if parent did not provide it
  const hoverHandlers =
    typeof isParentHovered === 'boolean'
      ? {}
      : {
          onMouseEnter: () => setSelfHover(true),
          onMouseLeave: () => setSelfHover(false),
        };

  const handleButtonClick = () => {
    // Play the local “click pulse” animation
    if (ready && !clickAnimatingRef.current) {
      clickAnimatingRef.current = true;
      // If user clicks mid-hover, cancel hover and release lock
      hoverAnimatingRef.current = false;
      setAnimState(S_CLICK, true);
    }
    // Delegate the real scroll action to the parent
    onClick?.();
  };

  /* ───────────────────────── Render ───────────────────────── */

  return (
    <button
      type="button"
      onClick={handleButtonClick}
      aria-label={ariaLabel}
      className={cn(
        // minimal circular button, centered content
        'inline-grid place-items-center rounded-full select-none cursor-pointer',
        // accessible focus ring (we keep aria-label, avoid title)
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-0',
        // smooth rotation
        'origin-center transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] will-change-transform',
        rotationClass,
        className ?? 'h-10 w-10' // default 40×40 hit-area
      )}
      {...hoverHandlers}
    >
      <div
        className="grid place-items-center pointer-events-none"
        style={{ width: size, height: size }}
      >
        <Player
          ref={playerRef}
          icon={ArrowAnimatedIconFull}
          size={size}
          // We drive the animation using the JSON states
          state={stateName}
          direction={1}
          colors={colorsForState}
          onReady={handleReady}
          onComplete={handleComplete}
        />
      </div>
    </button>
  );
}
