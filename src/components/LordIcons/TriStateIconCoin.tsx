"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import AnimatedIcon from "@/components/LordIcons/AnimatedIcon";

type AnimationData = object;
type IconColors = { primary: string; secondary?: string };

type Props = {
  /** Lottie for the intro animation (plays once on mount/reset) */
  inIcon: AnimationData;
  /** Lottie for the idle loop (runs while not selected) */
  loopIcon: AnimationData;
  /** Lottie for the click/confirm animation (freezes on last frame when selected) */
  clickIcon: AnimationData;

  /** Controlled selection */
  selected: boolean;
  /** Toggle callback – parent decides next selected state */
  onToggle?: (next: boolean) => void;

  size?: number;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;

  /** If true, after 'in' completes and NOT selected, start loop (default: true) */
  autoLoopAfterIn?: boolean;
  /** If true, after click completes and IS selected, freeze on last frame (default: true) */
  freezeAfterClick?: boolean;

  /** Optional color overrides */
  colors?: IconColors;
  loopColors?: IconColors;
  clickColors?: IconColors;

  /** Changing this value resets the whole sequence (in → loop/selected) */
  resetKey?: unknown;

  /** Lifecycle hooks */
  onInComplete?: () => void;
  onClickStart?: () => void;
  onClickComplete?: () => void;
};

type ClickPhase = "idle" | "play" | "frozen";

/**
 * Sequence:
 * - Mount/reset: plays `in`. When `in` completes:
 *   - if selected => show `click` frozen (confirm state), no loop
 *   - else if autoLoopAfterIn => start loop
 * - When selected toggles false -> true: play `click` then freeze on last frame
 * - When selected toggles true -> false: hide frozen click and return to loop
 */
export default function TriStateCoinIcon({
  inIcon,
  loopIcon,
  clickIcon,
  selected,
  onToggle,
  size = 28,
  className,
  ariaLabel = "coin",
  disabled = false,
  autoLoopAfterIn = true,
  freezeAfterClick = true,
  colors,
  loopColors,
  clickColors,
  resetKey,
  onInComplete,
  onClickStart,
  onClickComplete,
}: Props) {
  const [playingIn, setPlayingIn] = useState(true);
  const [loopOn, setLoopOn] = useState(false);
  const [clickPhase, setClickPhase] = useState<ClickPhase>("idle");

  // Reset sequence on mount or when resetKey changes
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      setPlayingIn(true);
      setLoopOn(false);
      setClickPhase("idle");
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
    return () => { cancelled = true; };
  }, [resetKey]);

  // Handle selected transitions (controlled)
  const prevSel = useRef<boolean>(selected);
  useEffect(() => {
     let cancelled = false;
    // false -> true : run click animation then freeze
    if (!prevSel.current && selected) {
      const run = () => {
        if (cancelled) return;
        setLoopOn(false);
        setClickPhase("play");
        onClickStart?.();
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(run);
      else Promise.resolve().then(run);
    }
    // true -> false : unselect => hide click layer and resume loop
    if (prevSel.current && !selected) {
      const run2 = () => {
        if (cancelled) return;
        setClickPhase("idle");
        setLoopOn(true);
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(run2);
      else Promise.resolve().then(run2);
    }
    prevSel.current = selected;
    return () => { cancelled = true; };
  }, [selected, onClickStart]);

  // After intro completes, decide next base state
  const handleInComplete = () => {
    setPlayingIn(false);
    if (selected) {
      // Start already in frozen confirm state
      setClickPhase("frozen");
      setLoopOn(false);
    } else if (autoLoopAfterIn) {
      setLoopOn(true);
    }
    onInComplete?.();
  };

  // When click anim completes
  const handleClickComplete = () => {
    if (freezeAfterClick) {
      setClickPhase("frozen"); // keep visible & paused on last frame
    } else {
      setClickPhase("idle");
      setLoopOn(true);
    }
    onClickComplete?.();
  };

  const handlePress = () => {
    if (disabled) return;
    onToggle?.(!selected);
  };

  return (
  <div
    className={cn(
      "inline-flex items-center justify-center",
      disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
      className
    )}
    onClick={handlePress}
    role="button"
    aria-label={ariaLabel}
    data-selected={selected ? "true" : "false"}
  >

    <div className="relative" style={{ width: size, height: size }}>
      {/* LOOP layer */}
      {loopOn && (
        <div className="absolute inset-0">
          <AnimatedIcon
            icon={loopIcon}
            size={size}
            state="loop"
            play
            colors={loopColors ?? colors}
          />
        </div>
      )}

      {/* IN layer */}
      {playingIn && (
        <div className="absolute inset-0">
          <AnimatedIcon
            icon={inIcon}
            size={size}
            state="in"
            play
            colors={colors}
            onComplete={handleInComplete}
          />
        </div>
      )}

      {/* CLICK layer (play ➜ frozen) */}
      {clickPhase !== "idle" && (
        <div className="absolute inset-0">
          <AnimatedIcon
            icon={clickIcon}
            size={size}
            state="click"
            play={clickPhase === "play"}
            colors={clickColors ?? colors}
            onComplete={handleClickComplete}
          />
        </div>
      )}
    </div>
  </div>
);
}
