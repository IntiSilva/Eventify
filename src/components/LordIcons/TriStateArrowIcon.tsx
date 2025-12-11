'use client';

import { useEffect, useRef, useState } from 'react';
import AnimatedIcon from '@/components/LordIcons/AnimatedIcon';
import { cn } from '@/lib/utils';

type AnimData = object;
type IconColors = { primary: string; secondary?: string };

export interface TriStateArrowIconProps {
  inIcon: AnimData;
  hoverIcon?: AnimData;
  clickIcon?: AnimData;
  inColors?: IconColors;
  hoverColors?: IconColors;
  clickColors?: IconColors;
  isDesktop: boolean;
  hovered?: boolean;
  playTrigger?: boolean;
  resetTrigger?: unknown;
  size?: number;
  className?: string;
  onActionComplete?: () => void;
}

export default function TriStateArrowIcon({
  inIcon,
  hoverIcon,
  clickIcon,
  inColors,
  hoverColors,
  clickColors,
  isDesktop,
  hovered,
  playTrigger = false,
  resetTrigger,
  size = 24,
  className,
  onActionComplete,
}: TriStateArrowIconProps) {
  // Tracks when the initial "in" (idle) animation has finished
  const [inFinished, setInFinished] = useState(false);
  // Animation control flags for hover and click
  const [hoverRunning, setHoverRunning] = useState(false);
  const [actionRunning, setActionRunning] = useState(false);

  // Reset everything when resetTrigger changes (replay the initial "in" animation)
  const prevReset = useRef(resetTrigger);
  useEffect(() => {
    let cancelled = false;
    if (prevReset.current !== resetTrigger) {
      prevReset.current = resetTrigger;
      const run = () => {
        if (cancelled) return;
        setInFinished(false);
        setHoverRunning(false);
        setActionRunning(false);
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(run);
      else Promise.resolve().then(run);
    }
    return () => { cancelled = true; };
  }, [resetTrigger]);

  // Hover rising edge: start only if not already running
  const prevHovered = useRef(!!hovered);
  useEffect(() => {
    let cancelled = false;
    const now = !!hovered;
    const prev = prevHovered.current;
    const canStartHover =
      isDesktop &&
      !!hoverIcon &&
      inFinished &&
      !actionRunning &&
      !hoverRunning;
    if (!prev && now && canStartHover) {
       const run = () => { if (cancelled) return; setHoverRunning(true); };
      if (typeof queueMicrotask === 'function') queueMicrotask(run);
      else Promise.resolve().then(run);
    }
    prevHovered.current = now;
    return () => { cancelled = true; };
  }, [hovered, isDesktop, hoverIcon, inFinished, actionRunning, hoverRunning]);

  // Click rising edge
  const prevPlay = useRef(playTrigger);
  useEffect(() => {
    let cancelled = false;
    const prev = prevPlay.current;
    if (!prev && playTrigger && !!clickIcon && !actionRunning) {
      const run = () => {
        if (cancelled) return;
        setActionRunning(true);
       setHoverRunning(false); // cancel any hover en progreso
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(run);
      else Promise.resolve().then(run);
    }
    prevPlay.current = playTrigger;
    return () => { cancelled = true; };
  }, [playTrigger, clickIcon, actionRunning]);

  // Ensure only one visual layer is shown at a time
  const showIn = !hoverRunning && !actionRunning;
  const showHover = hoverRunning && !actionRunning;
  const showAction = !!clickIcon && actionRunning;

  return (
    <div
      className={cn('relative inline-block', className)}
      style={{ width: size, height: size }}
    >
      {/* IN (idle) */}
      <div
        className={cn(
          'absolute inset-0',
          showIn ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        <AnimatedIcon
          key={`in-${String(resetTrigger)}`}
          icon={inIcon}
          size={size}
          state="in"
          colors={inColors}
          persistAfterIn
          onComplete={() => setInFinished(true)}
        />
      </div>

      {/* HOVER state */}
      {hoverIcon && (
        <div
          className={cn(
            'absolute inset-0',
            showHover ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
        >
          <AnimatedIcon
            icon={hoverIcon}
            size={size}
            state="hover"
            colors={hoverColors}
            disableInternalHover
            play={hoverRunning}
            onComplete={() => setHoverRunning(false)}
          />
        </div>
      )}

      {/* CLICK action */}
      {clickIcon && (
        <div
          className={cn(
            'absolute inset-0',
            showAction ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
        >
          <AnimatedIcon
            icon={clickIcon}
            size={size}
            state="click"
            colors={clickColors}
            play={actionRunning}
            onComplete={() => {
              setActionRunning(false);
              onActionComplete?.();
            }}
          />
        </div>
      )}
    </div>
  );
}
