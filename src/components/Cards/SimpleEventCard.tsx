'use client';

import { useRef, useState, useEffect, useLayoutEffect } from 'react';
import {
  motion,
  useSpring,
  useMotionTemplate,
  animate,
} from 'motion/react';
import type { AnimationPlaybackControls } from 'motion/react';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateEvent } from '@/app/(dashboard)/events/actions';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { Badge } from '@/components/ui/badge';
import AdminFeaturedBadge from '../Badges/AdminFeaturedBadge';
import AuroraFeaturedBadge from '../Badges/AuroraFeaturedBadge';
import PricingBadge from '../Badges/PricingBadge';
import AnimatedCounter from '../AnimatedText/AnimatedCounter';
import {
  getBadgeState,
  capitalizeFirstLetter,
  getCategoryBadgeColors,
  cn,
} from '@/lib/utils';
import { useViewerTz } from '@/contexts/ViewerTzContext';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import type { EditableEvent } from '@/types/event';
import { useMediaQuery, useInViewportOnce } from '@/lib/hooks';

/* ---------- Global config ---------------------------------------------- */
const springValues = { damping: 30, stiffness: 100, mass: 1.5 };
const INNER_Z_DESKTOP = 40;
const INNER_Z_MOBILE = 35; // more depth on mobile (<768px)

/* ---------- Lists counter tracking ---------------------------- */
/**
 * Tracks which event IDs have already played the AnimatedCounter
 * inside list/grid contexts (e.g. OrganizerEvents).
 * We only consult this when `animateCounterWhenInView` is true
 * so carousels are unaffected.
 */
const listAnimatedCounters = new Set<string>();

/* ---------- Props ------------------------------------------------------- */
interface SimpleEventCardProps {
  event: EditableEvent;
  showAdminControls?: boolean;
  onDetailsClick: (event: EditableEvent) => void;
  onEventUpdate?: (updated: EditableEvent) => void | Promise<void>;
  isActive?: boolean;
  animationIndex?: number;
  cardAnimationDelay?: number;
  isUpdating?: boolean;
  attendeesConfirmedCount?: number;
  animateCounterWhenInView?: boolean;
}

type XYControls = {
  x: AnimationPlaybackControls;
  y: AnimationPlaybackControls;
};

/* ======================================================================== */
export default function SimpleEventCard({
  event,
  showAdminControls = false,
  onDetailsClick,
  onEventUpdate,
  isActive = false,
  animationIndex = 0,
  cardAnimationDelay = 0.1,
  isUpdating = false,
  attendeesConfirmedCount,
  animateCounterWhenInView = false,
}: SimpleEventCardProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  const [hasAnimatedCounter, setHasAnimatedCounter] = useState(false);
  const hasBeenInView = useInViewportOnce(cardRef);

  // Has this event ID already animated its counter in lists?
  const hasEverAnimatedInList =
    animateCounterWhenInView && listAnimatedCounters.has(event.id);

  const { formatDate } = useViewerTz();

  /* ---------- Motion values -------------------------------------------- */
  const rotateX = useSpring(0, springValues);
  const rotateY = useSpring(0, springValues);
  const floatScale = useSpring(1, springValues);
  const floatInnerZ = useSpring(0, springValues);

  const innerTransform = useMotionTemplate`translateZ(${floatInnerZ}px)`;

  /* ---------- Pulse loading helper ------------------------------------- */
  const pulse = (extra = '') =>
    cn(isUpdating && 'animate-pulse opacity-60', extra);

  /* ---------- rAF-throttled hover -------------------------------------- */
  const rafId = useRef<number | null>(null);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!cardRef.current || !isDesktop) return;
    if (rafId.current) return;

    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      const rect = cardRef.current!.getBoundingClientRect();
      rotateX.set(
        ((e.clientY - rect.top - rect.height / 2) / (rect.height / 2)) * -12,
      );
      //Invert Y for natural feel
      rotateY.set(
        ((e.clientX - rect.left - rect.width / 2) / (rect.width / 2)) * -12,
      );
    });
  }

  /* Clean up rAF on unmount */
  useEffect(() => {
    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, []);

  /* ---------- Entry animation + loop ----------------------------------- */
  const animationControls = useRef<XYControls | null>(null);

  // Helper to stop and clean up in one place
  function stopCurrentAnimations() {
    const c = animationControls.current;
    if (!c) return;
    c.x.stop();
    c.y.stop();
    animationControls.current = null;
  }

  useEffect(() => {
    if (!isDesktop) {
      stopCurrentAnimations();
      rotateX.set(0);
      rotateY.set(0);
      return;
    }

    let canceled = false;

    // Transient controls in case cleanup happens mid-await
    let centerXCtl: AnimationPlaybackControls | null = null;
    let centerYCtl: AnimationPlaybackControls | null = null;
    let poseXCtl: AnimationPlaybackControls | null = null;
    let poseYCtl: AnimationPlaybackControls | null = null;

    const run = async () => {
      // Stop any previous loop/pose
      stopCurrentAnimations();

      if (isActive && !isHovered && hasEntered) {
        // 1) Center
        centerXCtl = animate(rotateX, 0, { duration: 1, ease: 'easeOut' });
        centerYCtl = animate(rotateY, 0, { duration: 1, ease: 'easeOut' });
        await Promise.all([centerXCtl.finished, centerYCtl.finished]);
        if (canceled) return;

        // 2) Initial pose
        poseXCtl = animate(rotateX, 8, { duration: 5, ease: 'easeOut' });
        poseYCtl = animate(rotateY, 6, { duration: 5, ease: 'easeOut' });
        animationControls.current = { x: poseXCtl, y: poseYCtl };
        await Promise.all([poseXCtl.finished, poseYCtl.finished]);
        if (canceled) return;

        // 3) Loop
        const loopX = animate(rotateX, [8, -8], {
          duration: 12,
          repeat: Infinity,
          repeatType: 'mirror',
          ease: 'easeInOut',
        });
        const loopY = animate(rotateY, [6, -6], {
          duration: 12,
          repeat: Infinity,
          repeatType: 'mirror',
          ease: 'easeInOut',
        });
        animationControls.current = { x: loopX, y: loopY };
      } else {
        // Quick reset
        stopCurrentAnimations();
        animate(rotateX, 0, { duration: 0.5, ease: 'easeOut' });
        animate(rotateY, 0, { duration: 0.5, ease: 'easeOut' });
      }
    };

    run();

    return () => {
      canceled = true;
      // Stop transients if they were running
      centerXCtl?.stop();
      centerYCtl?.stop();
      poseXCtl?.stop();
      poseYCtl?.stop();
      // Stop any loop/pose left running
      stopCurrentAnimations();
    };
  }, [isDesktop, isActive, isHovered, hasEntered, rotateX, rotateY]);

  /* ---------- Scale + Z-depth based on state --------------------------- */
  useEffect(() => {
    if (!isDesktop) {
      floatScale.set(1);
      floatInnerZ.set(0);
      return;
    }

    if (isActive && !isHovered && hasEntered) {
      floatScale.set(isDesktop ? 1.025 : 1.07); // mobile 1.07
      floatInnerZ.set(isDesktop ? INNER_Z_DESKTOP : INNER_Z_MOBILE);
    } else if (!isHovered) {
      floatScale.set(1);
      floatInnerZ.set(0);
      rotateX.set(0);
      rotateY.set(0);
    }
  }, [
    isDesktop,
    isActive,
    isHovered,
    hasEntered,
    floatScale,
    floatInnerZ,
    rotateX,
    rotateY,
  ]);

  /* ---------- AnimatedCounter trigger ---------------------------------- */
  // Decide WHEN to mount AnimatedCounter for this card
  useLayoutEffect(() => {
    if (!hasEntered) return;

    // SimpleEventCard in lists: if this event.id has already animated before,
    // we do not animate again in this or future mounts within lists.
    if (hasEverAnimatedInList) return;

    if (hasAnimatedCounter) return;

    // Carousel: animate when the card is active.
    // Lists: animate when the card has entered the viewport.
    const shouldEnable =
      (animateCounterWhenInView && hasBeenInView) ||
      (!animateCounterWhenInView && isActive);

    if (shouldEnable) {
      // We only track in the global Set when we are in "inViewport" mode (e.g. OrganizerEvents)
      if (animateCounterWhenInView) {
        listAnimatedCounters.add(event.id);
      }
      setHasAnimatedCounter(true);
    }
  }, [
    hasEntered,
    hasEverAnimatedInList,
    hasAnimatedCounter,
    animateCounterWhenInView,
    hasBeenInView,
    isActive,
    event.id,
  ]);

  /* ---------- Hover handlers ------------------------------------------- */
  function handleMouseEnter() {
    if (!isDesktop) return;
    setIsHovered(true);
    floatScale.set(1.05);
    floatInnerZ.set(isDesktop ? INNER_Z_DESKTOP : INNER_Z_MOBILE);
    stopCurrentAnimations();
  }

  function handleMouseLeave() {
    if (!isDesktop) return;
    setIsHovered(false);
  }

  /* ---------- Admin toggle --------------------------------------------- */
  const badgeState = getBadgeState(event);
  const useCompactInlineLowerBadges =
    showAdminControls && isDesktop && badgeState === 'both';

  const handleFeaturedChange = async (current: boolean) => {
    startTransition(async () => {
      try {
        const next = !current;
        await updateEvent({ id: event.id, featuredByAdmin: next });
        const updated: EditableEvent = { ...event, featuredByAdmin: next };
        onEventUpdate?.(updated);
        toast.success(
          `Event ${next ? 'marked' : 'unmarked'} as Admin's Pick.`,
        );
        router.refresh();
      } catch (err) {
        toast.error('Failed to update featured status.');
        console.error(err);
      }
    });
  };

  /* ---------- AnimatedCounter digits helper ---------------------------- */
  function placesFor(n: number): number[] {
    const v = Math.max(0, Math.floor(n));
    const len = String(v).length || 1;
    // e.g., 5 -> [1], 10 -> [10, 1], 999 -> [100, 10, 1]
    return Array.from({ length: len }, (_, i) => 10 ** (len - i - 1));
  }

  const digitsForCounter =
    typeof attendeesConfirmedCount === 'number'
      ? String(Math.max(0, Math.floor(attendeesConfirmedCount))).length || 1
      : 1;

  const counterFontSize = 22; // px

  /* ============================ JSX ==================================== */
  return (
    <motion.div
      ref={cardRef}
      className="h-full w-full transform-gpu [perspective:1200px]"
      style={{
        transform: useMotionTemplate`
          rotateX(${rotateX}deg)
          rotateY(${rotateY}deg)
        `,
        scale: floatScale,
        transformStyle: 'preserve-3d',
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{
        duration: 0.8,
        ease: 'easeInOut',
        delay: animationIndex * cardAnimationDelay,
      }}
      onAnimationComplete={() => setHasEntered(true)}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Card
        className="h-full border border-zinc-700 bg-black pt-6 pb-10 transition-shadow duration-300 ease-in-out md:py-6"
        style={{ transformStyle: 'preserve-3d' }}
      >
        <CardContent
          className="relative flex h-full flex-col justify-between p-2 md:p-4"
          style={{ transformStyle: 'preserve-3d' }}
        >
          {/* ---------- Category badge ------------------------------------ */}
          <motion.div
            className="absolute -top-6 left-1.5 z-10 md:-top-4 md:left-2"
            style={{ transform: innerTransform }}
          >
            <Badge
              className={cn(
                'max-md:rounded-sm cursor-default whitespace-nowrap border px-1 py-0 text-3xs md:px-2 md:py-1 md:text-xs',
                getCategoryBadgeColors(event.category),
                isUpdating && 'animate-pulse opacity-60',
              )}
            >
              {capitalizeFirstLetter(event.category)}
            </Badge>
          </motion.div>

          {/* Right-side badges stack (stacked under category-level area) */}
          <div className="absolute z-20 right-1.5 -top-4 md:-top-3 flex flex-col items-end gap-1">
            <PricingBadge
              isPaid={Boolean(event.isPaid)}
              eventStart={event.date}
              variant={isDesktop ? 'list' : 'carousel'}
              className="max-w-[6.5rem]"
            />
          </div>

          {/* ---------- Featured / Admin badges --------------------------- */}
          {badgeState !== 'none' && (
            <div
              className={cn(
                'absolute z-10 -bottom-9 left-1.5 md:-bottom-4',
                useCompactInlineLowerBadges
                  ? 'flex max-w-[calc(100%-0.75rem)] flex-row flex-wrap items-end gap-x-1 gap-y-1 md:gap-x-1.5'
                  : 'flex',
                !useCompactInlineLowerBadges &&
                  badgeState === 'both' &&
                  'flex-col gap-y-1 md:gap-y-1.5',
              )}
            >
              {(badgeState === 'admin' || badgeState === 'both') && (
                <div
                  className={
                    isUpdating ? 'flex animate-pulse opacity-60' : 'flex'
                  }
                >
                  <AdminFeaturedBadge />
                </div>
              )}

              {(badgeState === 'featured' || badgeState === 'both') && (
                <div
                  className={
                    isUpdating ? 'flex animate-pulse opacity-60' : 'flex'
                  }
                >
                  <AuroraFeaturedBadge />
                </div>
              )}
            </div>
          )}

          {/* ---------- Title + meta ------------------------------------- */}
          <div
            className="flex-grow space-y-3"
            style={{ transformStyle: 'preserve-3d' }}
          >
            <motion.h3
              className={pulse(
                'flex min-h-[120px] items-center justify-center bg-gradient-to-br from-emerald-400 to-cyan-900 bg-clip-text text-center font-heading text-md font-semibold text-transparent md:min-h-40 md:text-2xl',
              )}
              style={{ transform: innerTransform }}
            >
              {event.title}
            </motion.h3>

            <div className="min-h-16 space-y-2 text-start md:min-h-18">
              <p className="text-2xs text-zinc-400 md:text-sm">
                {formatDate(event.date, event.eventTimeZone)}
              </p>

              {/* Counter below the date */}
              {typeof attendeesConfirmedCount === 'number' && (
                <div className="flex items-center gap-1 md:gap-2">
                  <div className="flex items-center justify-center">
                    {hasAnimatedCounter ? (
                      // "Currently animating" state (first time on this mount)
                      <AnimatedCounter
                        value={attendeesConfirmedCount}
                        fontSize={counterFontSize}
                        places={placesFor(attendeesConfirmedCount)}
                        gradientFrom="transparent"
                        gradientTo="transparent"
                        gradientHeight={0}
                        textColor="white"
                      />
                    ) : hasEverAnimatedInList && animateCounterWhenInView ? (
                      // Lists: this event.id already animated in a previous mount.
                      // We render the same counter but in static mode (no animation).
                      <AnimatedCounter
                        value={attendeesConfirmedCount}
                        fontSize={counterFontSize}
                        places={placesFor(attendeesConfirmedCount)}
                        gradientFrom="transparent"
                        gradientTo="transparent"
                        gradientHeight={0}
                        textColor="white"
                        animated={false}
                      />
                    ) : (
                      // Per-digit dynamic skeleton
                      <div className="flex items-center justify-center gap-0.5 px-1">
                        {Array.from({ length: digitsForCounter }).map(
                          (_, idx) => (
                            <div
                              key={idx}
                              className="animate-pulse rounded-sm bg-white/10"
                              style={{
                                width: '1.4ch',
                                height: `${counterFontSize}px`,
                              }}
                            />
                          ),
                        )}
                      </div>
                    )}
                  </div>

                  <span className="text-2xs text-zinc-300 md:text-sm">
                    attendees
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ---------- Admin controls + Details button ------------------- */}
          <div className="mt-auto pt-3">
            {showAdminControls && (
              <div className="mb-3 flex items-center justify-end space-x-2 border-t border-zinc-700 pt-3">
                <Label
                  htmlFor={`featured-switch-${event.id}`}
                  className="select-none text-xs text-white md:text-sm"
                >
                  Admin&apos;s Pick
                </Label>
                <Switch
                  id={`featured-switch-${event.id}`}
                  checked={event.featuredByAdmin}
                  onCheckedChange={() =>
                    handleFeaturedChange(event.featuredByAdmin)
                  }
                  disabled={isPending}
                  className={cn(
                    // Colors by state
                    'data-[state=checked]:bg-emerald-600 data-[state=unchecked]:bg-zinc-600 cursor-pointer',
                    // Default size (mobile)
                    'h-3.5 w-7 [&>span]:h-3.5 [&>span]:w-3.5',
                    // Desktop size
                    'md:h-4.5 md:w-8 md:[&>span]:h-4 md:[&>span]:w-4',
                  )}
                />
              </div>
            )}

            <div className="flex justify-end">
              {isDesktop ? (
                <Button
                  variant="secondary"
                  onClick={() => onDetailsClick(event)}
                  className="cursor-pointer"
                >
                  Details / Edit
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => onDetailsClick(event)}
                  className="cursor-pointer px-1 py-[3px] text-xs xs4:px-1.5 xs4:py-1"
                  size="xs"
                >
                  Details / Edit
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
