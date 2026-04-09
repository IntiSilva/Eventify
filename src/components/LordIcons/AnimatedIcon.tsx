'use client';

import { useRef, useEffect } from 'react';
import { Player } from '@lordicon/react';
import { cn } from '@/lib/utils';

type PlayerProps = React.ComponentProps<typeof Player>;

interface AnimatedIconProps {
  icon: PlayerProps['icon'];
  size?: number;
  state: 'hover' | 'click' | 'loop' | 'loop-on-hover' | 'in' | 'morph';
  play?: boolean;
  disableInternalHover?: boolean;
  colors?: { primary: string; secondary?: string };
  direction?: 1 | -1;
  onReady?: () => void;
  onComplete?: () => void;
  className?: string;
  onClick?: () => void;
  persistAfterIn?: boolean;
}

export default function AnimatedIcon({
  icon,
  size = 32,
  state,
  play,
  disableInternalHover = false,
  colors,
  direction = 1,
  onReady,
  onComplete,
  className,
  onClick,
  persistAfterIn = false,
}: AnimatedIconProps) {
  const playerRef = useRef<Player>(null);
  const isPlayControlled = typeof play === 'boolean';

  const freeze = () => {
    const p = playerRef.current;
    if (!p) return;
    p.goToLastFrame?.();
    p.pause?.();
  };

  useEffect(() => {
    const p = playerRef.current;
    if (!play || !p) return;

    if (direction === -1) {
      p.goToLastFrame?.();
      p.pause?.();
      p.play?.();
    } else {
      p.goToFirstFrame?.();
      p.playFromBeginning?.();
    }
  }, [play, direction]);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    if (state === 'loop') {
      p.playFromBeginning?.();
      return;
    }
    // If `play` is controlled, let the `play` effect above drive "in" animations.
    if (state === 'in' && !isPlayControlled) {
      p.playFromBeginning?.();
    }
  }, [state, isPlayControlled]);

  const onMouseEnter = () => {
    if (disableInternalHover) return;
    if (state === 'hover' || state === 'loop-on-hover') playerRef.current?.playFromBeginning?.();
  };

  const onMouseLeave = () => {
    if (state === 'loop-on-hover') {
      playerRef.current?.pause?.();
      playerRef.current?.goToFirstFrame?.();
    }
  };

  const onInternalClick = () => {
    if (state === 'click') playerRef.current?.playFromBeginning?.();
    onClick?.();
  };

  const colorsString = colors
    ? `primary:${colors.primary}${colors.secondary ? `,secondary:${colors.secondary}` : ''}`
    : undefined;

  const handleComplete = () => {
    if (state === 'loop' || state === 'loop-on-hover') {
      playerRef.current?.playFromBeginning?.();
    }

    if (state === 'in' && persistAfterIn) {
      freeze();
    }

    onComplete?.();
  };

  return (
    <div
      style={{ width: size, height: size }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onInternalClick}
      className={cn(className)}
    >
      <Player
        ref={playerRef}
        icon={icon}
        size={size}
        state={state}
        colors={colorsString}
        direction={direction}
        onReady={onReady}
        onComplete={handleComplete}
      />
    </div>
  );
}
