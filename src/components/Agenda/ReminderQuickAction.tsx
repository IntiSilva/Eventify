'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import ReminderToastContent, { REMINDER_TOAST_ID } from '@/components/ReminderToastContent';
import type { EventWithCreatorAndRsvps } from '@/types/event';
import { useEvent, useRsvpActions, useStoreWriters } from '@/contexts/EventsContext';
import { cn } from '@/lib/utils';

import InToHoverIcon from '@/components/LordIcons/InToHoverIcon';
import { BellAnimatedIcon, BellAnimatedIconHover } from '@/lib/icons';

import {
  motion,
  useSpring,
  animate,
  useTransform,
  useMotionTemplate,
  useMotionValue,
  type MotionValue,
} from 'motion/react';

/* ──────────────────────────────────────────────────────────────────
   Props
   ────────────────────────────────────────────────────────────────── */

type Props = {
  event: EventWithCreatorAndRsvps;
  myRsvp?: EventWithCreatorAndRsvps['rsvps'][number] | null;
  className?: string;
  isDesktop?: boolean;
  onScheduledAtChange?: (d: Date | null) => void;

  /** Optional: 3D bases inherited from the row to integrate tilt/parallax. */
  baseZ?: MotionValue<number>;
  baseX?: MotionValue<number>;
  baseRotateX?: MotionValue<number>;
  baseRotateY?: MotionValue<number>;

  /** Optional: compensation parameters (must match TiltedListEventRow). */
  dirSign?: -1 | 0 | 1;
  xPerZ?: number;
  rotYBase?: number;

  /** Notify interaction (so the wrapper can pause autoplay & select the row). */
  onPressStart?: () => void;
};

/* ──────────────────────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────────────────────── */

export default function ReminderQuickAction({
  event,
  myRsvp,
  className,
  isDesktop = false,
  onScheduledAtChange,

  baseZ,
  baseX,
  baseRotateX,
  baseRotateY,
  dirSign = 0,
  xPerZ = 0,
  rotYBase = 0,

  onPressStart,
}: Props) {
  // Ensure the event exists in the store (commitReminder needs a target).
  const { upsertEvents } = useStoreWriters();
  useEffect(() => {
    upsertEvents([event]);
  }, [event, upsertEvents]);

  // Live event (fall back to prop on first render).
  const live = useEvent(event.id) ?? event;

  // Derive RSVP and reminder state.
  const effectiveRsvp = (live.rsvps?.[0] ?? myRsvp) || null;
  const reminderActive = Boolean(effectiveRsvp?.reminderScheduledAt);

  // Sync external listener with current scheduled date.
  const prevMsRef = useRef<number | null>(null);
  useEffect(() => {
    const currMs = effectiveRsvp?.reminderScheduledAt
      ? new Date(effectiveRsvp.reminderScheduledAt).getTime()
      : null;

    if (prevMsRef.current !== currMs) {
      prevMsRef.current = currMs;
      onScheduledAtChange?.(currMs ? new Date(currMs) : null);
    }
  }, [effectiveRsvp?.reminderScheduledAt, onScheduledAtChange]);

  // Actions.
  const { commitReminder } = useRsvpActions();

  const openReminderToast = useCallback(() => {
    toast.custom(
      () => (
        <ReminderToastContent
          eventId={live.id}
          eventDate={new Date(live.date)}
          onDismiss={() => toast.dismiss(REMINDER_TOAST_ID)}
          isDesktop={isDesktop}
          commitReminder={commitReminder}
        />
      ),
      { id: REMINDER_TOAST_ID, duration: 30000, classNames: { toast: 'z-[60]' } }
    );
  }, [live.id, live.date, isDesktop, commitReminder]);

  // Local hover state (for icon swap).
  const [hovered, setHovered] = useState(false);

  // Base classes and active/inactive variants.
  const baseClasses =
    'px-2.5 md:px-3 py-1.5 rounded-full inline-flex items-center transition-colors duration-200';
  const activeClasses =
    'border border-emerald-700 text-emerald-400 bg-emerald-950/50 hover:bg-emerald-900 hover:text-emerald-300';
  const inactiveClasses = 'border border-zinc-700 text-zinc-200 hover:border-zinc-500';

  /* ───────────────────────── 3D / press (same approach as Details) ───────────────────────── */

  const zeroMV = useMotionValue(0);
  const zBase = baseZ ?? zeroMV;
  const xBase = baseX ?? zeroMV;
  const rXBase = baseRotateX ?? zeroMV;
  const rYBase = baseRotateY ?? zeroMV;

  const press = useSpring(0, { stiffness: 900, damping: 40, mass: 0.6 });
  const pressDepth = isDesktop ? 16 : 12;

  const scaleMV   = useTransform(press, [0, 1], [1, 0.93]);
  const zPressMV  = useTransform(press, (t) => -pressDepth * t);
  const xPressMV  = useTransform(press, (t) => dirSign * (-pressDepth) * xPerZ * t);
  const rYPressMV = useTransform(press, (t) => -dirSign * (rotYBase * 0.5) * t);
  const rXPressMV = useTransform(press, (t) => -(1.5 + 2.0 * t));

  // Compose the full transform string (base + press).
  const btnTransform = useMotionTemplate`
    translateZ(${zBase}px) translateX(${xBase}px) rotateY(${rYBase}deg) rotateX(${rXBase}deg)
    translateZ(${zPressMV}px) translateX(${xPressMV}px) rotateY(${rYPressMV}deg) rotateX(${rXPressMV}deg)
    scale(${scaleMV})
  `;

  /* ───────────────────────── Render ───────────────────────── */

  return (
    <motion.button
      type="button"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={(e) => {
        // Avoid the outer track capturing drag.
        e.stopPropagation();
        onPressStart?.(); // pause autoplay + select the row
        e.currentTarget.setPointerCapture(e.pointerId);
        animate(press, 1);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        animate(press, 0);
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
        openReminderToast();
      }}
      onPointerCancel={(e) => {
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
        animate(press, 0);
      }}
      onPointerLeave={() => {
        // Let the <li> handle its own leave; just reset press.
        animate(press, 0);
      }}
      className={cn(
        baseClasses,
        reminderActive ? activeClasses : inactiveClasses,
        'select-none touch-manipulation transform-gpu will-change-transform cursor-pointer',
        className
      )}
      style={{ transformStyle: 'preserve-3d', transform: btnTransform }}
      aria-label={reminderActive ? 'Edit reminder' : 'Set reminder'}
      title={reminderActive ? 'Edit reminder' : 'Set reminder'}
    >
      <span className="pointer-events-none">
        <InToHoverIcon
          inIcon={BellAnimatedIcon}
          hoverIcon={BellAnimatedIconHover}
          inColors={{ primary: reminderActive ? '#34D399' : '#E5E7EB' }}
          hoverColors={{ primary: reminderActive ? '#6EE7B7' : '#FFFFFF' }}
          isParentHovered={hovered}
          isDesktop={isDesktop}
          size={isDesktop ? 18 : 15}
          introDelay={200}
          resetTrigger={effectiveRsvp?.reminderScheduledAt ?? reminderActive}
        />
      </span>
    </motion.button>
  );
}
