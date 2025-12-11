'use client';

import { useMemo, useState, type MouseEvent } from 'react';
import MorphIcon from '../LordIcons/MorphIcon';
import {
  PlayAnimatedIcon,
  PauseAnimatedIcon,
  PlayPauseAnimatedIconMorph,
  PausePlayAnimatedIconMorph,
} from '@/lib/icons';
import { cn } from '@/lib/utils';

/* ──────────────────────────────────────────────────────────────────
   Types
   ────────────────────────────────────────────────────────────────── */

type Shape = 'play' | 'pause';

type IconColors = {
  primary: string;
  secondary?: string;
};

export interface AutoplayButtonProps {
  /** Current autoplay state controlled by the parent. */
  isPlaying: boolean;
  /** Toggle callback from parent (source of truth). */
  onToggle?: () => void;

  /** Gate rendering until upstream logic is ready (avoids hydration flicker). */
  bootstrapped?: boolean;

  /** Visuals */
  className?: string;
  size?: number;
  colors?: IconColors;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;

  /** Intro animation timing passed down to MorphIcon */
  introDelay?: number;
  introDuration?: number;
}

/* =================================================================
   Public wrapper — gates rendering until `bootstrapped` is true
   ================================================================= */

export default function AutoplayButton(props: AutoplayButtonProps) {
  const {
    bootstrapped = true, // default: render immediately if caller doesn’t gate
    ...rest
  } = props;

  if (!bootstrapped) return null;
  return <AutoplayButtonCore {...rest} />;
}

/* =================================================================
   Core — stable “group pick” + morphing driven by `isPlaying`
   ================================================================= */

type CoreProps = Omit<AutoplayButtonProps, 'bootstrapped'>;

function AutoplayButtonCore({
  isPlaying,
  onToggle,
  className,
  size = 28,
  colors,
  title = 'Autoplay',
  ariaLabel = 'Toggle autoplay',
  disabled,
  introDelay,
  introDuration,
}: CoreProps) {
  /**
   * Pick a group ONCE at mount and never change it again.
   * This avoids setState in effects and keeps forward/reverse mapping stable.
   * If we mount while playing, the “base” icon is Pause; otherwise Play.
   */
  const [group] = useState<Shape>(() => (isPlaying ? 'pause' : 'play'));

  /** Intro icon is fixed by the chosen group. */
  const introIcon = useMemo(
    () => (group === 'play' ? PlayAnimatedIcon : PauseAnimatedIcon),
    [group]
  );

  /**
   * Morph icon pair depends on the chosen group (directionality):
   *  - If group === 'play':    play → pause (forward), pause → play (reverse)
   *  - If group === 'pause':   pause → play (forward), play → pause (reverse)
   * MorphIcon internally uses `isMorphed` to drive forward/reverse.
   */
  const morphIcon = useMemo(
    () =>
      group === 'play'
        ? PlayPauseAnimatedIconMorph
        : PausePlayAnimatedIconMorph,
    [group]
  );

  /**
   * Drive the morph with a stable rule:
   *  - When group === 'play':   morphed === isPlaying
   *  - When group === 'pause':  morphed === !isPlaying
   *
   * This keeps the visual state aligned with `isPlaying` without
   * needing effects or additional local state.
   */
  const isMorphed = group === 'pause' ? !isPlaying : isPlaying;

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (disabled) return;
    onToggle?.();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'inline-flex items-center justify-center rounded-full cursor-pointer',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600',
        'disabled:opacity-50 disabled:pointer-events-none',
        className
      )}
      
      aria-label={ariaLabel}
      aria-pressed={isPlaying}
      title={title}
      disabled={disabled}
    >
      <MorphIcon
        introIcon={introIcon}
        icon={morphIcon}
        /** Drives forward/reverse inside MorphIcon. */
        isMorphed={isMorphed}
        /** Let MorphIcon handle intro timing. */
        playIntro
        introDelay={introDelay}
        introDuration={introDuration}
        size={size}
        colors={colors}
        className="pointer-events-none select-none"
      />
    </button>
  );
}
