'use client';

import { useState, useEffect, useRef } from 'react';
import AnimatedIcon from './AnimatedIcon';
import { cn } from '@/lib/utils';

type AnimationData = object;

type IconColors = {
  primary: string;
  secondary?: string;
};

interface InToHoverIconProps {
  inIcon: AnimationData;
  hoverIcon?: AnimationData;
  actionIcon?: AnimationData;
  inColors?: IconColors;
  hoverColors?: IconColors;
  actionColors?: IconColors;
  resetTrigger: unknown;
  isParentHovered?: boolean;
  isDesktop: boolean;
  size?: number;
  className?: string;
  onClick?: () => void;
  playTrigger?: boolean;
  onActionComplete?: () => void;
  introDelay?: number;
  onIconReady?: () => void;
}

export default function InToHoverIcon({
  inIcon,
  hoverIcon,
  actionIcon,
  inColors,
  hoverColors,
  actionColors,
  resetTrigger,
  isParentHovered,
  isDesktop,
  size = 20,
  className,
  onClick,
  playTrigger = false,
  onActionComplete,
  introDelay = 0,
  onIconReady,
}: InToHoverIconProps) {
  const [showHoverStateIcon, setShowHoverStateIcon] = useState(false);
  const [isHoverAnimating, setIsHoverAnimating] = useState(false);
  const [isActionAnimating, setIsActionAnimating] = useState(false);
  const [isSelfHovered, setIsSelfHovered] = useState(false);
  const [isMobileActionPlaying, setIsMobileActionPlaying] = useState(false);
  const [playIntro, setPlayIntro] = useState(false);
  const prevHoveredRef = useRef(false);
  const hasNotifiedReadyRef = useRef(false);

  const notifyIconReady = () => {
    if (hasNotifiedReadyRef.current) return;
    hasNotifiedReadyRef.current = true;
    onIconReady?.();
  };

  const isControlledExternally = typeof isParentHovered === 'boolean';
  const isHoverActive = isControlledExternally ? isParentHovered : isSelfHovered;


    // Restart the intro trigger when resetTrigger or delay changes
  useEffect(() => {
      let offTimer: number | null = null;
      let startTimer: number | null = null;
      // Turn off on the next tick
      offTimer = window.setTimeout(() => setPlayIntro(false), 0);
      // Then turn on after delay
      const ms = Math.max(0, introDelay ?? 0);
      startTimer = window.setTimeout(() => setPlayIntro(true), ms);
      return () => {
        if (offTimer) window.clearTimeout(offTimer);
        if (startTimer) window.clearTimeout(startTimer);
      };
    }, [resetTrigger, introDelay]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowHoverStateIcon(false);
      setIsHoverAnimating(false);
      setIsActionAnimating(false);
      setIsMobileActionPlaying(false);
      prevHoveredRef.current = false;
    }, 200);
    return () => clearTimeout(timer);
  }, [resetTrigger]);

  useEffect(() => {
    const was = prevHoveredRef.current;
    const rising = !was && isHoverActive && !isHoverAnimating;
    if (rising || (playTrigger && !isHoverAnimating)) {
      requestAnimationFrame(() => setIsHoverAnimating(true));
    }
    prevHoveredRef.current = isHoverActive;
  }, [isHoverActive, isHoverAnimating, playTrigger]);

  useEffect(() => {
    if (playTrigger && !isActionAnimating) {
      requestAnimationFrame(() => setIsActionAnimating(true));
    }
  }, [playTrigger, isActionAnimating])

  const selfHoverHandlers = isControlledExternally
    ? {}
    : {
        onMouseEnter: () => setIsSelfHovered(true),
        onMouseLeave: () => setIsSelfHovered(false),
      };

  // --- Mobile logic ---
  if (!isDesktop) {
    if (!actionIcon) {
      return (
        <div className={cn('relative', className)} style={{ width: size, height: size }} onClick={onClick}>
          <AnimatedIcon
            icon={inIcon}
            size={size}
            state="in"
            colors={inColors}
            play={playIntro}
            onReady={notifyIconReady}
          />
        </div>
      );
    }
    return (
      <div
        className={cn('relative cursor-pointer', className)}
        style={{ width: size, height: size }}
        onClick={() => {
          if (isMobileActionPlaying) return;
          setIsMobileActionPlaying(true);
        }}
      >
        {isMobileActionPlaying ? (
          <AnimatedIcon
            key="action-icon"
            icon={actionIcon}
            state="click" // On mobile, the action is always 'click'
            size={size}
            colors={actionColors}
            play={true}
            onComplete={() => {
              onActionComplete?.();
              setIsMobileActionPlaying(false);
            }}
          />
        ) : (
          <AnimatedIcon
            key="in-icon"
            icon={inIcon}
            size={size}
            colors={inColors}
            state="in"
            play={playIntro}
            onReady={notifyIconReady}
          />
        )}
      </div>
    );
  }

  // --- Desktop logic ---
  return (
    <div className={cn('relative', className)} style={{ width: size, height: size }} {...selfHoverHandlers} onClick={onClick}>
      {/* INITIAL state */}
      <div className={cn('absolute inset-0', showHoverStateIcon || isActionAnimating ? 'opacity-0' : 'opacity-100')}>
        <AnimatedIcon
          icon={inIcon}
          size={size}
          state="in"
          colors={inColors}
          onComplete={() => setShowHoverStateIcon(true)}
          play={playIntro}
          onReady={notifyIconReady}
        />
      </div>

      {/* HOVER state */}
      <div className={cn('absolute inset-0', showHoverStateIcon && !isActionAnimating ? 'opacity-100' : 'opacity-0')}>
        <AnimatedIcon
          icon={hoverIcon!}
          size={size}
          state="hover"
          colors={hoverColors}
          disableInternalHover={true}
          play={isHoverAnimating}
          onComplete={() => setIsHoverAnimating(false)}
        />
      </div>

      {/* ACTION state */}
      {actionIcon && (
        <div className={cn('absolute inset-0', isActionAnimating ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
          <AnimatedIcon
            icon={actionIcon}
            size={size}
            state="click"
            play={isActionAnimating}
            onComplete={() => {
              setIsActionAnimating(false);
              onActionComplete?.();
            }}
            colors={actionColors}
          />
        </div>
      )}
    </div>
  );
}
