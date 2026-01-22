'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import {
  motion,
  useMotionValue,
  useSpring,
  useMotionTemplate,
  animate,
  useTransform,
  useMotionValueEvent,
  useReducedMotion,
  useTime,
  type Variants,
  type MotionValue,
  type AnimationPlaybackControls,
} from 'motion/react';

import { useMediaQuery } from '@/lib/hooks';
import { getBadgeState, capitalizeFirstLetter, getCategoryBadgeColors, cn } from '@/lib/utils';
import { useViewerTz } from '@/contexts/ViewerTzContext';

import type { EventWithCreatorAndRsvps } from '@/types/event';
import { RSVPStatus } from '@/generated/prisma';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import AdminFeaturedBadge from '../Badges/AdminFeaturedBadge';
import AuroraFeaturedBadge from '../Badges/AuroraFeaturedBadge';
import AvatarStack from '../AvatarStack';
import UserAvatar from '../UserAvatar';

/* =====================================================================================
 * CONSTANTS
 * ===================================================================================== */

const springValues = { damping: 30, stiffness: 100, mass: 1.5 } as const;

/** Desktop press-in/out behavior */
const DESK_SCALE = 0.8; // was 0.86 → much deeper press-in
const DESK_Z = 18; // a bit more depth to emphasize the effect
const DESK_IN = { stiffness: 320, damping: 22, mass: 0.95 };
const DESK_OUT = { stiffness: 260, damping: 20, mass: 1 };

/** Mobile press-in/out behavior (keyframed) */
const MOB_SCALE_TARGET = 0.9;
const MOB_KEYFRAME_DURATION = 0.07;
const MOB_KEYFRAME_EASE: [number, number, number, number] = [0.4, 0.0, 0.2, 1];
const MOB_Z_TARGET = -12;
const MOB_OUT = { stiffness: 320, damping: 26, mass: 0.9 };

// How close to the target we consider it “good enough” to open the menu
const PRESS_SETTLE_TOLERANCE_SCALE = 0.012; // ~1.2% difference
const PRESS_SETTLE_TOLERANCE_Z = 2; // Z can end within ±2

function waitUntil(
  value: MotionValue<number>,
  target: number,
  tolerance = 0.01,
): Promise<void> {
  return new Promise((resolve) => {
    // 🔹 Immediate check
    const current = value.get();
    if (Math.abs(current - target) <= tolerance) {
      resolve();
      return;
    }

    const unsubscribe = value.on('change', (v) => {
      if (Math.abs(v - target) <= tolerance) {
        unsubscribe();
        resolve();
      }
    });
  });
}

/* =====================================================================================
 * TYPES
 * ===================================================================================== */

type Props = {
  event: EventWithCreatorAndRsvps;
  onDetailsClick: (event: EventWithCreatorAndRsvps) => void;
  index: number;
  renderIndex: number;
  smoothX: MotionValue<number>;
  cardTotalWidth: number;
  cardWidth: number;
  viewportWidth: number;
  curve: number;
  activeZoneHalfWidth: number;
  isDragging: boolean;
  rotationFactor: number;
  isEven: boolean;
  /** Base pop-out distance for active cards (carousel/list). */
  popDistance: number;
  /** When true, the card is being updated (optimistic/refresh) — show skeleton blocks and damp interactions. */
  isUpdating?: boolean;
  variant?: 'carousel' | 'list';
  /** When in list on mobile, this marks the card as "active by scroll". */
  scrollActive?: boolean;
  /** Optional registry so the carousel can cancel a press when a vertical gesture is detected. */
  registerCancelPress?: (cb: () => void) => () => void;
  onEntryComplete?: (i: number) => void;
  effectsEnabled?: boolean;
};

const entryVariants: Variants = {
  initial: { y: 80, opacity: 0 },
  animate: (i: number) => ({
    y: 0,
    opacity: 1,
    transition: { type: 'spring', stiffness: 150, damping: 20, mass: 1, delay: i * 0.1 },
  }),
};

/* =====================================================================================
 * COMPONENT
 * ===================================================================================== */

function ArcEventCard({
  event,
  onDetailsClick,
  index,
  renderIndex,
  smoothX,
  cardTotalWidth,
  cardWidth,
  viewportWidth,
  curve,
  activeZoneHalfWidth,
  isDragging,
  rotationFactor,
  isEven,
  popDistance,
  isUpdating = false,
  variant = 'carousel',
  scrollActive = false,
  registerCancelPress,
  onEntryComplete,
  effectsEnabled = false,
}: Props) {
  /* -----------------------------------------------------------------------------
   * FLAGS (no hooks)
   * ----------------------------------------------------------------------------- */
  const isList = variant === 'list';
  const isCarousel = variant === 'carousel';
    // Performance gate (lo controla el carousel: inView && !isScrolling)
  const perfEffectsEnabled = effectsEnabled && !isUpdating;


  /* -----------------------------------------------------------------------------
   * HOOKS
   * ----------------------------------------------------------------------------- */
  const prefersReducedMotion = useReducedMotion();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isMobile = !isDesktop;
  const isMobileList = isList && isMobile;

  /* -----------------------------------------------------------------------------
   * REFS & LOCAL STATE
   * ----------------------------------------------------------------------------- */
  const cardRef = useRef<HTMLDivElement>(null);
  const [isActive, setIsActive] = useState(false);
  const [hasAnimatedEntry, setHasAnimatedEntry] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isPressing, setIsPressing] = useState(false);

  /* -----------------------------------------------------------------------------
   * POSITION METRICS (distance from viewport center)
   * ----------------------------------------------------------------------------- */
  const distanceFromCenter = useTransform(smoothX, (latestX) => {
    const cardLeft = index * cardTotalWidth;
    const cardCenterLocal = cardLeft + cardWidth / 2;
    const rel = latestX + cardCenterLocal - viewportWidth / 2;
    return Math.abs(rel);
  });

  useMotionValueEvent(distanceFromCenter, 'change', (latest) => {
    if (isCarousel) setIsActive(latest < activeZoneHalfWidth);
  });

  // Initial activation calculation with fresh values ALWAYS
  const computeInitialActiveRef = useRef<() => void>(() => {});
  computeInitialActiveRef.current = () => {
    if (!isCarousel) return;
    if (prefersReducedMotion) return;

    const currentX = smoothX.get();
    const cardLeftLocal = index * cardTotalWidth;
    const cardCenterLocal = cardLeftLocal + cardWidth / 2;
    const rel = currentX + cardCenterLocal - viewportWidth / 2;
    const shouldBeActive = Math.abs(rel) < activeZoneHalfWidth;

    // Avoid “second pop” if nothing changed
    setIsActive((prev) => (prev === shouldBeActive ? prev : shouldBeActive));
  };

  // Run once when the entry animation finishes
  useLayoutEffect(() => {
    if (!hasAnimatedEntry) return;
    computeInitialActiveRef.current();
  }, [hasAnimatedEntry]);

  /* -----------------------------------------------------------------------------
   * MOTION VALUES (tilt raw + springs, scale, Z-pop, curve)
   * ----------------------------------------------------------------------------- */
  const rotateX_raw = useMotionValue(0);
  const rotateY_raw = useMotionValue(0);
  const rotateX_float = useSpring(rotateX_raw, springValues);
  const rotateY_float = useSpring(rotateY_raw, springValues);
  const rotateX_display = isDesktop ? rotateX_float : rotateX_raw;
  const rotateY_display = isDesktop ? rotateY_float : rotateY_raw;

  const tiltIntensityRaw = useMotionValue(0);
  const tiltIntensity = useSpring(tiltIntensityRaw, {
    stiffness: 140,
    damping: 32,
    mass: 0.8,
  });

  const scale_float = useSpring(1, springValues);
  const innerZ = useSpring(0, springValues);

  const time = useTime();

  const halfViewport = viewportWidth / 2;
  const curveFactor = halfViewport > 0 ? curve / (halfViewport * halfViewport) : 0;
  const cardLeft = index * cardTotalWidth;
  const cardCenter = cardLeft + cardWidth / 2;

  const curveY = useTransform(smoothX, (latestX) => {
    const rel = latestX + cardCenter - halfViewport;
    return curveFactor * rel * rel;
  });

  const rotateZ = useTransform(smoothX, (latestX) => {
    if (curve === 0) return 0;
    const rel = latestX + cardCenter - halfViewport;
    return rel * (halfViewport > 0 ? rotationFactor / halfViewport : 0);
  });

  /* -----------------------------------------------------------------------------
   * EVENT DATA / DERIVED
   * ----------------------------------------------------------------------------- */
  const innerTransform = useMotionTemplate`translateZ(${innerZ}px)`;
  const { formatDate } = useViewerTz();
  const badgeState = useMemo(() => getBadgeState(event), [event]);

  const confirmedAttendeeCount = useMemo(
    () => event.rsvps.filter((r) => r.status === RSVPStatus.confirmed).length,
    [event.rsvps],
  );

  // Effective "active" for different contexts
  const activeByScroll = isMobileList && scrollActive;
  const effectiveActive = isCarousel ? isActive : activeByScroll ? true : false;

  // Pop-out configuration by context
  const POP_ACTIVE_CARD = Math.max(0, popDistance);
  const POP_ACTIVE_LIST = Math.max(0, Math.round(popDistance * 0.66));
  const POP_HOVER_EXTRA = 10;

  /* -----------------------------------------------------------------------------
   * SCALE & Z-POP (no tilt)
   * ----------------------------------------------------------------------------- */
  useEffect(() => {
    if (!hasAnimatedEntry || isPressing) return;

    // Base scale by context
    const baseScale =
      isCarousel ? (effectiveActive ? 1.05 : 1) : isMobileList ? (effectiveActive ? 1.03 : 1) : 1;

    const finalScale = isHovered ? 1.03 : baseScale;
    scale_float.set(finalScale);

    if (prefersReducedMotion) {
      innerZ.set(0);
      return;
    }

    // Base Z-pop by context
    const basePop = isCarousel
      ? effectiveActive
        ? POP_ACTIVE_CARD
        : 0
      : isList
      ? (effectiveActive || (isDesktop && isHovered) ? POP_ACTIVE_LIST : 0)
      : 0;

    innerZ.set(isHovered ? basePop + POP_HOVER_EXTRA : basePop);
  }, [
    hasAnimatedEntry,
    isPressing,
    isCarousel,
    isMobileList,
    effectiveActive,
    isHovered,
    prefersReducedMotion,
    isList,
    isDesktop,
    POP_ACTIVE_CARD,
    POP_ACTIVE_LIST,
    POP_HOVER_EXTRA,
    scale_float,
    innerZ,
  ]);

  /* -----------------------------------------------------------------------------
   * TILT INTENSITY GATE (when tilt is allowed to be “alive”)
   * ----------------------------------------------------------------------------- */
  useEffect(() => {

    if (!perfEffectsEnabled) return;

    // If the entry animation has not finished or the user prefers reduced motion,
    // do not enable tilt.
    if (!hasAnimatedEntry || prefersReducedMotion) {
      tiltIntensityRaw.set(0);
      return;
    }

    // On mobile we fully disable the floating tilt.
    if (!isDesktop) {
      tiltIntensityRaw.set(0);
      return;
    }

    // Does this layout currently support tilt?
    // (desktop carousel; mobile list path is currently disabled above)
    const relevantByLayout = isCarousel || isMobileList;

    // Is this card relevant right now (marked as active)?
    const relevantByState = effectiveActive || activeByScroll;

    // Is there a strong interaction that should temporarily turn off tilt?
    // If you ever want drag to stop tilt only on desktop, limit it to desktop:
    // const blockedByInteraction = isPressing || (isDesktop && isDragging);
    const blockedByInteraction = isPressing || isDragging;

    const target =
      relevantByLayout && relevantByState && !blockedByInteraction
        ? 1
        : 0;

    tiltIntensityRaw.set(target);
  }, [
    perfEffectsEnabled,
    isDesktop,
    hasAnimatedEntry,
    prefersReducedMotion,
    isCarousel,
    isMobileList,
    effectiveActive,
    activeByScroll,
    isPressing,
    isDragging,
    tiltIntensityRaw,
  ]);

  /* -----------------------------------------------------------------------------
   * FLOATING TILT
   * ----------------------------------------------------------------------------- */


  const shouldSubscribeFloatingTilt =
    perfEffectsEnabled &&
    hasAnimatedEntry &&
    !prefersReducedMotion &&
    isDesktop &&
    !isHovered &&
    (isCarousel || isMobileList) &&
    (effectiveActive || activeByScroll) &&
    !(isPressing || isDragging);

  useEffect(() => {

    if (!shouldSubscribeFloatingTilt) {
      rotateX_raw.stop();
      rotateY_raw.stop();
      rotateX_float.stop();
      rotateY_float.stop();

      tiltIntensityRaw.stop();
      tiltIntensity.stop();

      return;
    }

    const unsubscribe = time.on('change', (t) => {
      // Entry animation still running → keep the card flat
      if (!hasAnimatedEntry) {
        rotateX_raw.set(0);
        rotateY_raw.set(0);
        return;
      }

      // Reduced motion enabled → no tilt at all
      if (prefersReducedMotion) {
        rotateX_raw.set(0);
        rotateY_raw.set(0);
        return;
      }

      // On mobile we disable the continuous wobble
      if (!isDesktop) {
        rotateX_raw.set(0);
        rotateY_raw.set(0);
        return;
      }

      // While hovered on desktop, let the mouse-driven tilt take over
      if (isDesktop && isHovered) {
        return;
      }

      // If this layout does not use floating tilt, keep it flat
      if (!isCarousel && !isMobileList) {
        rotateX_raw.set(0);
        rotateY_raw.set(0);
        return;
      }

      const intensity = tiltIntensity.get();
      const seconds = t / 1000;

      const baseAmpX = effectiveActive ? 6 : 2;
      const baseAmpY = effectiveActive ? 4 : 1.5;

      // “Look towards the center” — bias tilt so cards subtly face the carousel center
      const currentX = smoothX.get();
      const cardLeftLocal = index * cardTotalWidth;
      const cardCenterLocal = cardLeftLocal + cardWidth / 2;
      const rel = currentX + cardCenterLocal - viewportWidth / 2;
      const directionMultiplier = isEven && rel < 0 ? -1 : 1;

      const waveX = Math.sin(seconds * 0.8 + index * 0.7) * baseAmpX * intensity;
      const waveY =
        Math.cos(seconds * 1.1 + index * 0.4) *
        baseAmpY *
        directionMultiplier *
        intensity;

      rotateX_raw.set(waveX);
      rotateY_raw.set(waveY);
    });

    return unsubscribe;
  }, [
    shouldSubscribeFloatingTilt,
    time,
    hasAnimatedEntry,
    prefersReducedMotion,
    isDesktop,
    isHovered,
    isCarousel,
    isMobileList,
    effectiveActive,
    activeByScroll,
    tiltIntensity,
    smoothX,
    index,
    cardTotalWidth,
    cardWidth,
    viewportWidth,
    isEven,
    rotateX_raw,
    rotateY_raw,
    rotateX_float,
    rotateY_float,
    tiltIntensityRaw,
    tiltIntensity,
  ]);

  /* -----------------------------------------------------------------------------
   * CLEAR HOVER WHEN DRAG STARTS
   * ----------------------------------------------------------------------------- */
  const isHoveredRef = useRef(isHovered);

  useEffect(() => {
    isHoveredRef.current = isHovered;
  }, [isHovered]);

  const effectCtxRef = useRef({
    isCarousel,
    isMobileList,
    activeByScroll,
    activeZoneHalfWidth,
    POP_ACTIVE_CARD,
    POP_ACTIVE_LIST,
  });

  useEffect(() => {
    effectCtxRef.current = {
      isCarousel,
      isMobileList,
      activeByScroll,
      activeZoneHalfWidth,
      POP_ACTIVE_CARD,
      POP_ACTIVE_LIST,
    };
  }, [isCarousel, isMobileList, activeByScroll, activeZoneHalfWidth, POP_ACTIVE_CARD, POP_ACTIVE_LIST]);

  useEffect(() => {
    if (!isDragging || !isHoveredRef.current) return;

    setIsHovered(false);
    rotateX_raw.set(0);
    rotateY_raw.set(0);

    const ctx = effectCtxRef.current;
    if (ctx.isCarousel) {
      const posActive = distanceFromCenter.get() < ctx.activeZoneHalfWidth;
      setIsActive(posActive);
      scale_float.set(posActive ? 1.05 : 1);
      innerZ.set(posActive ? ctx.POP_ACTIVE_CARD : 0);
    } else if (ctx.isMobileList) {
      scale_float.set(ctx.activeByScroll ? 1.03 : 1);
      innerZ.set(ctx.activeByScroll ? ctx.POP_ACTIVE_LIST : 0);
    } else {
      scale_float.set(1);
      innerZ.set(0);
    }
  }, [isDragging, distanceFromCenter, innerZ, rotateX_raw, rotateY_raw, scale_float]);

  /* -----------------------------------------------------------------------------
   * HOVER (desktop)
   * ----------------------------------------------------------------------------- */
  const handleMouseEnter = () => {
    if (!perfEffectsEnabled) return;
    if (!isDesktop || isDragging) return;
    setIsHovered(true);
  };

  const handleMouseLeave = () => {

    if (!isDesktop) return;
    //Always clean hover
    setIsHovered(false);
    //Don't calculate if perf disabled
    if (!perfEffectsEnabled) return;

    if (isCarousel) {
      const posActive = distanceFromCenter.get() < activeZoneHalfWidth;
      setIsActive(posActive);
      scale_float.set(posActive ? 1.05 : 1);
      innerZ.set(posActive ? POP_ACTIVE_CARD : 0);
    } else if (isMobileList) {
      scale_float.set(activeByScroll ? 1.03 : 1);
      innerZ.set(activeByScroll ? POP_ACTIVE_LIST : 0);
    } else {
      scale_float.set(1);
      innerZ.set(0);
    }

    rotateX_raw.set(0);
    rotateY_raw.set(0);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!perfEffectsEnabled) return;
    if (!isHovered || !cardRef.current || !isDesktop || isDragging || prefersReducedMotion) return;
    const rect = cardRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - rect.width / 2;
    const offsetY = e.clientY - rect.top - rect.height / 2;
    rotateX_raw.set((offsetY / rect.height / 2) * 50);
    rotateY_raw.set((offsetX / rect.width / 2) * 50);
  };

  /* -----------------------------------------------------------------------------
   * PRESS (pointer) BEHAVIOR
   * ----------------------------------------------------------------------------- */
  const pressBaseRef = useRef<{ scale: number; innerZ: number } | null>(null);
  // Animation controls for press-in (scale + Z)
  const pressInScaleControlsRef = useRef<AnimationPlaybackControls | null>(null);
  const pressInZControlsRef = useRef<AnimationPlaybackControls | null>(null);

  const pressIn = () => {
    if (!perfEffectsEnabled) return;
    if (prefersReducedMotion || isDragging) return;
    setIsPressing(true);
    pressBaseRef.current = { scale: scale_float.get(), innerZ: innerZ.get() };

    const base = pressBaseRef.current!;

    // 🔹 If there is a previous press-in animation running, stop it first
    pressInScaleControlsRef.current?.stop();
    pressInZControlsRef.current?.stop();
    pressInScaleControlsRef.current = null;
    pressInZControlsRef.current = null;

    if (isDesktop) {
      pressInScaleControlsRef.current = animate(scale_float, base.scale * DESK_SCALE, DESK_IN);
      pressInZControlsRef.current = animate(innerZ, base.innerZ + DESK_Z, DESK_IN);
    } else {
      // On mobile, ensure tilt is flat before pressing
      rotateX_raw.set(0);
      rotateY_raw.set(0);
      const kfScale = [base.scale, base.scale * (MOB_SCALE_TARGET + 0.04), base.scale * MOB_SCALE_TARGET];
      const kfZ = [base.innerZ, base.innerZ + MOB_Z_TARGET];
      pressInScaleControlsRef.current = animate(scale_float, kfScale, {
        duration: MOB_KEYFRAME_DURATION,
        ease: MOB_KEYFRAME_EASE,
      });
      pressInZControlsRef.current = animate(innerZ, kfZ, {
        duration: MOB_KEYFRAME_DURATION,
        ease: MOB_KEYFRAME_EASE,
      });
    }
  };

  const pressOut = useCallback(async () => {
    const snap = pressBaseRef.current;
    setIsPressing(false);
    if (!snap) return;

    // 🔹 1) Stop any ongoing press-in animation
    pressInScaleControlsRef.current?.stop();
    pressInZControlsRef.current?.stop();
    pressInScaleControlsRef.current = null;
    pressInZControlsRef.current = null;

    const targetScale = snap.scale;
    const targetZ = snap.innerZ;

    // 🔹 2) Animate back to the base snapshot (press-out)
    if (isDesktop) {
      animate(scale_float, targetScale, DESK_OUT);
      animate(innerZ, targetZ, DESK_OUT);
    } else {
      animate(scale_float, targetScale, MOB_OUT);
      animate(innerZ, targetZ, MOB_OUT);
    }

    // 🔹 3) Wait until both values are close enough to the target
    await Promise.all([
      waitUntil(scale_float, targetScale, PRESS_SETTLE_TOLERANCE_SCALE),
      waitUntil(innerZ, targetZ, PRESS_SETTLE_TOLERANCE_Z),
    ]);

    // 🔹 4) Final clamp to avoid tiny residual deltas
    scale_float.set(targetScale);
    innerZ.set(targetZ);
  }, [isDesktop, scale_float, innerZ]);

  /* -----------------------------------------------------------------------------
   * CANCEL-PRESS REGISTRY (stable)
   * ----------------------------------------------------------------------------- */
  const isPressingRef = useRef(isPressing);
  useEffect(() => {
    isPressingRef.current = isPressing;
  }, [isPressing]);

  useEffect(() => {
    if (!registerCancelPress) return;
    const unregister = registerCancelPress(() => {
      if (isPressingRef.current) {
        void pressOut();
      }
    });

    return unregister;
  }, [registerCancelPress, pressOut]);

  /* -----------------------------------------------------------------------------
   * ELEVATION (z-index raise on active/hover)
   * ----------------------------------------------------------------------------- */
  const elevated =
    isHovered ||
    (isMobileList && effectiveActive) ||
    (isCarousel && effectiveActive) ||
    (isMobileList && scale_float.get() > 1.001);

  const raiseZ = isList && elevated;

  /* -----------------------------------------------------------------------------
   * CREATOR DYNAMIC FONT SIZE
   * ----------------------------------------------------------------------------- */

  const creatorUsername = event?.creator?.username ?? '';
  const creatorLen = creatorUsername.length;

  const usernameSize = useMemo(() => {
    if (isList) {
      // LIST MODE (md+): slightly more permissive at each length range
      if (creatorLen <= 22) return 'md:text-xl md:align-text-bottom';
      return 'md:text-base';
    }

    // CARD (non-list) — mobile + desktop
    if (creatorLen <= 12) return 'md:text-lg md:tracking-normal md:align-sub';
    if (creatorLen <= 16) return 'text-3xs md:text-sm md:tracking-tight md:align-top';
    if (creatorLen <= 20) return 'text-3xs md:text-xs md:tracking-tight';
    if (creatorLen <= 23) return 'text-4xs md:text-2xs md:tracking-tight';
    return 'text-4xs md:text-[9px] md:tracking-tight';
  }, [creatorLen, isList]);

  /* -----------------------------------------------------------------------------
   * PERFORMANCE LAYERING
   * ----------------------------------------------------------------------------- */
  const needsTransformLayer =
    perfEffectsEnabled && (isHovered || effectiveActive || isPressing || isDragging);

  const cardWillChange: React.CSSProperties['willChange'] = needsTransformLayer ? 'transform' : 'auto';



  /* -----------------------------------------------------------------------------
   * GUARDS
   * ----------------------------------------------------------------------------- */
  if (viewportWidth === 0) return null;

  /* -----------------------------------------------------------------------------
   * RENDER
   * ----------------------------------------------------------------------------- */
  return (
    <motion.div
      className={cn(
        'h-full w-full [perspective:1200px] overflow-visible',
        isList ? 'h-[335px] md:h-[505px]' : 'h-full',
      )}
      style={{ y: curveY, rotateZ, position: 'relative', zIndex: raiseZ ? 30 : 'auto' }}
    >
      <div className="h-full w-full [perspective:800px] overflow-visible">
        <motion.div
          ref={cardRef}
          className="h-full w-full transform-gpu"
          style={{
            rotateX: rotateX_display,
            rotateY: rotateY_display,
            scale: scale_float,
            transformStyle: 'preserve-3d',
            willChange: cardWillChange,
          }}
          variants={entryVariants}
          initial="initial"
          animate="animate"
          custom={renderIndex}
          onAnimationComplete={() => {
            setHasAnimatedEntry(true);
            onEntryComplete?.(renderIndex);
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onMouseMove={handleMouseMove}
        >
          <Card
            data-testid="arc-card-root"
            className="h-full bg-black border border-zinc-700 flex flex-col"
            style={{ transformStyle: 'preserve-3d' }}
          >
            <CardContent
              className={cn(
                'relative flex flex-col h-full md:py-4 4xl:!py-8 2k:!py-10 4k:!py-12',
                isList ? 'px-1.5 xs3:px-2.5 md:px-3 ' : 'px-1 xs3:px-2 md:px-2.5',
                isUpdating && 'pointer-events-none',
              )}
              style={{ transformStyle: 'preserve-3d' }}
            >
              {/* Category badge */}
              <motion.div
                className="absolute -top-5.5 left-1.5 md:-top-4.5 md:left-2.5 z-10"
                style={{ transform: innerTransform }}
              >
                {isUpdating ? (
                  <div
                    className={cn(
                      isList ? 'h-5 w-20 md:h-7 md:w-28' : 'h-4 w-16 md:h-6 md:w-20',
                      'skeleton',
                    )}
                  />
                ) : (
                  <Badge
                    className={cn(
                      'whitespace-nowrap border max-md:rounded-sm',
                      isList
                        ? 'text-2xs md:text-sm px-1.5 md:px-3 py-0.5 md:py-1'
                        : 'text-3xs md:text-xs px-1 md:px-2 py-0 md:py-1',
                      getCategoryBadgeColors(event.category),
                    )}
                  >
                    {capitalizeFirstLetter(event.category)}
                  </Badge>
                )}
              </motion.div>

              {/* Featured/Admin badges */}
              {badgeState !== 'none' && (
                <motion.div
                  className={cn('absolute z-10 flex', {
                    '-bottom-4.5 left-1.5 md:-bottom-4 md:left-2 flex-col gap-y-1 xs3:gap-y-1.5':
                      badgeState === 'both',
                    '-bottom-3 left-1.5': badgeState === 'featured' || badgeState === 'admin',
                  })}
                  style={{ transform: innerTransform }}
                >
                  {isUpdating ? (
                    <>
                      <div className="h-4 w-20 md:h-5 md:w-24 skeleton" />
                      {badgeState === 'both' && (
                        <div className="h-4 w-20 md:h-5 md:w-24 skeleton" />
                      )}
                    </>
                  ) : (
                    <>
                      {(badgeState === 'admin' || badgeState === 'both') && (
                        <AdminFeaturedBadge variant={variant} />
                      )}
                      {(badgeState === 'featured' || badgeState === 'both') && (
                        <AuroraFeaturedBadge variant={variant} />
                      )}
                    </>
                  )}
                </motion.div>
              )}

              {/* Content */}
              <div className="flex flex-col flex-grow md:space-y-3" style={{ transformStyle: 'preserve-3d' }}>
                {/* Title */}
                <div
                  className={cn(
                    'flex items-center justify-center',
                    isList ? 'min-h-24 md:min-h-36' : 'min-h-32 md:min-h-36',
                  )}
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  {isUpdating ? (
                    <div
                      className={cn(
                        isList ? 'h-6 md:h-8 w-4/5 md:w-3/4' : 'h-5 md:h-7 w-3/4 md:w-2/3',
                        'skeleton',
                      )}
                    />
                  ) : (
                    <motion.h3
                      data-testid="arc-card-title"
                      className={cn(
                        'font-semibold font-heading text-center bg-gradient-to-br from-emerald-400 to-cyan-400 text-transparent bg-clip-text text-shadow-sm text-shadow-emerald-900/50',
                        isList ? 'text-xl md:text-3xl' : 'text-md md:text-2xl',
                      )}
                      style={{ transform: innerTransform }}
                    >
                      {event.title}
                    </motion.h3>
                  )}
                </div>

                {/* Description */}
                <div className="h-10 md:h-16 ">
                  {isUpdating ? (
                    <div className="space-y-1.5">
                      <div className="h-3 md:h-4 w-full skeleton" />
                      <div className="h-3 md:h-4 w-5/6 md:w-4/5 skeleton" />
                    </div>
                  ) : (
                    <p
                      className={cn(
                        isList ? 'text-xs md:text-base' : 'text-2xs md:text-sm',
                        'text-zinc-400 line-clamp-2 md:line-clamp-3',
                      )}
                    >
                      {event.description}
                    </p>
                  )}
                </div>

                {/* Meta: date / creator */}
                <div className="space-y-1.5 md:space-y-2.5">
                  {/* Date */}
                  {isUpdating ? (
                    <div
                      className={cn(
                        isList ? 'h-3.5 md:h-5 w-3/5' : 'h-3 md:h-4 w-1/2',
                        'skeleton',
                      )}
                    />
                  ) : (
                    <p className={cn(isList ? 'text-xs md:text-lg' : 'text-2xs md:text-sm', 'text-zinc-200')}>
                      {formatDate(event.date)}
                    </p>
                  )}

                  {/* Creator */}
                  <div className={cn(isList ? 'text-sm md:text-xl' : 'text-xs md:text-sm', 'text-zinc-200')}>
                    {isUpdating ? (
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            isList ? 'h-3.5 md:h-5 w-20 md:w-28' : 'h-3 md:h-4 w-16 md:w-24',
                            'skeleton',
                          )}
                        />
                        <div
                          className={cn(
                            isList ? 'size-5 md:size-7' : 'size-5 md:size-6',
                            'rounded-full skeleton',
                          )}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center min-w-0">
                        <span className="shrink-0">By:</span>
                        <span
                          className={cn(
                            isList ? 'text-xs' : 'text-2xs',
                            'ml-1',
                            'font-display leading-tight lowercase',
                            'text-transparent bg-clip-text',
                            'bg-[linear-gradient(110deg,#d4d4d8_0%,#d4d4d8_44%,#27272a_49%,#ffffff_53%,#d4d4d8_60%,#d4d4d8_100%)]',
                            'bg-[length:250%_100%] animate-bg-shine',
                            'truncate min-w-0',
                            usernameSize,
                          )}
                        >
                          {event.creator.username}
                        </span>
                        <div className="ml-2 shrink-0 self-center">
                          <UserAvatar
                            {...event.creator}
                            className="size-5 md:size-7"
                            variant="creator"
                          />
                        </div>
                      </div>
                    )}
                  </div>


                  {/* Attendees */}
                  {confirmedAttendeeCount > 0 && (
                    <div>
                      {isUpdating ? (
                        <>
                          <div
                            className={cn(
                              'mb-1',
                              isList ? 'h-3 md:h-4 w-16' : 'h-2.5 w-14',
                              'skeleton',
                            )}
                          />
                          <div
                            className={cn(
                              isList ? 'h-6 md:h-10 w-24 md:w-36' : 'h-5 md:h-9 w-20 md:w-32',
                              'skeleton',
                            )}
                          />
                        </>
                      ) : (
                        <div
                          className={cn(
                            'flex items-center gap-2 md:gap-1',
                            'md:flex-col md:items-start',
                          )}
                        >
                          <p
                            className={cn(
                              'text-zinc-200',
                              isList ? 'text-xs md:text-md' : 'text-2xs',
                            )}
                          >
                            Attendees:
                          </p>
                          <AvatarStack
                            rsvps={event.rsvps}
                            maxVisible={3}
                            avatarSizeClassName={
                              isList ? 'size-5 md:size-9' : 'size-4 md:size-8'
                            }
                            userAvatarProps={{
                              borderVariant: 'static',
                              density: 'compact',
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* CTA */}
              <div
                className="flex justify-end mt-auto max-md:pb-1.5 pt-2"
                style={{ transformStyle: 'preserve-3d' }}
              >
                <motion.div style={{ transform: innerTransform }}>
                  {/* Mobile button */}
                  {isMobile && (
                    <Button
                      data-testid="arc-card-details"
                      variant="secondary"
                      disabled={isUpdating}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        pressIn();
                      }}
                      onPointerUp={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();

                        // Wait for press-out to settle back to the base state
                        await pressOut();

                        if (!isUpdating) onDetailsClick(event);
                      }}
                      onPointerCancel={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        void pressOut();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      className={cn(
                        'cursor-pointer transition-transform',
                        isList ? 'px-3 py-1.5 text-sm' : 'px-1.5 py-1 text-xs',
                      )}
                      size={isList ? 'sm' : 'xs'}
                    >
                      Details
                    </Button>
                  )}

                  {/* Desktop button */}
                  {isDesktop && (
                    <Button
                      data-testid="arc-card-details"
                      variant="secondary"
                      disabled={isUpdating}
                      onPointerDown={() => {
                        pressIn();
                      }}
                      onPointerUp={async () => {
                        // Wait for the press-out animation before mutating anything else
                        await pressOut();
                        setIsHovered(false);

                        if (isCarousel) {
                          const posAct = distanceFromCenter.get() < activeZoneHalfWidth;
                          setIsActive(posAct);
                          scale_float.set(posAct ? 1.05 : 1);
                          innerZ.set(posAct ? POP_ACTIVE_CARD : 0);
                        } else if (isMobileList) {
                          scale_float.set(activeByScroll ? 1.03 : 1);
                          innerZ.set(activeByScroll ? POP_ACTIVE_LIST : 0);
                        } else {
                          setIsActive(false);
                          scale_float.set(1);
                          innerZ.set(0);
                        }

                        if (!isUpdating) onDetailsClick(event);
                      }}
                      onPointerCancel={() => {
                        void pressOut();
                        setIsHovered(false);
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                      }}
                      className={cn(
                        'cursor-pointer transition-transform',
                        isList ? 'px-4 py-2 text-base' : 'px-3 py-1.5 text-sm',
                      )}
                      size={isList ? 'default' : 'sm'}
                    >
                      Details
                    </Button>
                  )}
                </motion.div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}

/* =====================================================================================
 * MEMO
 * ===================================================================================== */

export default memo(ArcEventCard);
