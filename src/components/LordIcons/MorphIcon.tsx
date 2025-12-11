'use client';

import { useState, useEffect, useRef } from 'react';
import AnimatedIcon from './AnimatedIcon';
import { cn } from '@/lib/utils';

// --- Props Interfaces (Updated) ---
type AnimationData = object;
type IconColors = { primary: string; secondary?: string };
interface MorphIconProps {
  icon: AnimationData; // Icon for the morph/interactive state
  introIcon?: AnimationData; // Icon for the intro animation
  isMorphed: boolean;
  playIntro?: boolean; // Trigger to start the intro animation
  introDelay?: number; // Delay before the intro starts
  introDuration?: number; // Intro animation duration
  size?: number;
  colors?: IconColors;
  className?: string;
}

export default function MorphIcon({
  icon,
  introIcon,
  isMorphed,
  playIntro = false,
  introDelay = 0,
  introDuration = 1000, // Default duration: 1s
  size = 20,
  colors,
  className,
}: MorphIconProps) {
  // --- Animation State Machine ---
  const [phase, setPhase] = useState<'idle' | 'intro' | 'active'>('idle');
  const [play, setPlay] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);

  // --- Effects to Orchestrate the Animation ---
  useEffect(() => {
    // Orchestrate the intro sequence when playIntro fires for the first time
    if (playIntro && phase === 'idle') {
      const delayTimer = setTimeout(() => {
        setPhase('intro'); // Switch to the 'intro' phase after the delay
        const durationTimer = setTimeout(() => {
          setPhase('active'); // Switch to the 'active' phase after the duration
        }, introDuration);

        // Cleanup of the second timer
        return () => clearTimeout(durationTimer);
      }, introDelay);

      // Cleanup of the first timer
      return () => clearTimeout(delayTimer);
    }
  }, [playIntro, phase, introDelay, introDuration]);

  useEffect(() => {
    // Detect isMorphed changes for interactive animation (only in active phase)
    // and schedule in microtask
    let cancelled = false;
    if (phase === 'active' && prevIsMorphedRef.current !== isMorphed) {
      const run = () => {
        if (cancelled) return;
        setDirection(isMorphed ? 1 : -1);
        setPlay(true);
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(run);
      else Promise.resolve().then(run);
    }
    prevIsMorphedRef.current = isMorphed;
    return () => { cancelled = true; };
  }, [isMorphed, phase]);

  const prevIsMorphedRef = useRef(isMorphed);

  // --- Render Based on Phase ---

  // If we're in the 'intro' phase AND we have an intro icon
  if (phase === 'intro' && introIcon) {
    return (
      <div className={cn('relative', className)} style={{ width: size, height: size }}>
        <AnimatedIcon icon={introIcon} state="in" size={size} colors={colors} />
      </div>
    );
  }

  // If we're in the 'active' phase, show the interactive morph icon
  if (phase === 'active') {
    return (
      <div className={cn('relative', className)} style={{ width: size, height: size }}>
        <AnimatedIcon
          icon={icon}
          state="morph"
          play={play}
          direction={direction}
          size={size}
          colors={colors}
          onComplete={() => setPlay(false)}
        />
      </div>
    );
  }

  // If we're in 'idle' or there's no introIcon, render nothing until the sequence starts
  return null;
}
