'use client';

import { useEffect, useState, useCallback, useMemo, memo } from 'react';
import type { EventWithCreatorAndRsvps } from '@/types/event';
import { useViewerTz } from '@/contexts/ViewerTzContext';
import ReminderQuickAction from '@/components/Agenda/ReminderQuickAction';
import {
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
  useMotionTemplate,
  type MotionValue,
} from 'motion/react';

import InToHoverIcon from '@/components/LordIcons/InToHoverIcon';
import { useMediaQuery } from '@/lib/hooks';
import { InfoAnimatedIcon, InfoAnimatedIconHover } from '@/lib/icons';

// Read live event from store (keeps all row instances in sync)
import { useEvent } from '@/contexts/EventsContext';
import { cn } from '@/lib/utils';

// Format as "YYYY-MM-DD · h:mm AM/PM" in viewer TZ
function formatReminderNumeric(d: string | Date, tz?: string) {
  const date = new Date(d);
  const ymd = date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: tz,
  });
  const hm = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  });
  return `${ymd} · ${hm}`;
}

type Props = {
  event: EventWithCreatorAndRsvps;
  className?: string;

  /** Set by TiltedInfiniteList when the row intro finishes */
  inner3DActive?: boolean;

  /** Stack tilt params passed from TiltedInfiniteList to orient the z-pop */
  stackTiltEnabled?: boolean;
  stackTiltDirection?: 'left' | 'right';
  stackTiltAmountDeg?: number;

  /** Layered parallax (already smoothed & clamped) from the list */
  parallaxTitleY?: MotionValue<number>;
  parallaxActionsY?: MotionValue<number>;
  parallaxMetaY?: MotionValue<number>;

  /** Wrapper handles menu opening */
  onDetails?: (ev: EventWithCreatorAndRsvps) => void;

  /** Selection hint (from wrapper) */
  isSelected?: boolean;

  /** Notify interaction (pause autoplay + select row) */
  onRowInteract?: (rowId: string) => void;
  orderNumber?: number | null; // 1-based, or null to hide
};

/**
 * Row with inner 3D layers (title, actions, meta) + tilt-compensated z-pop
 * and per-layer parallax driven by the list's scroll/drag velocity.
 */
function TiltedListEventRow({
  event,
  className,
  inner3DActive = false,
  stackTiltEnabled = false,
  stackTiltDirection = 'left',
  stackTiltAmountDeg = 18,
  parallaxTitleY,
  parallaxActionsY,
  parallaxMetaY,
  onDetails,
  isSelected = false,
  onRowInteract,
  orderNumber,
}: Props) {
  const { formatDate, viewerTz } = useViewerTz();
  const prefersReduced = useReducedMotion();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  // Single source of truth: live event from context (fallback to prop)
  const live = useEvent(event.id) ?? event;

  // Server gives only *my* RSVP in this page
  const myRsvp = live.rsvps?.[0] ?? null;
  const reminderScheduledAt = myRsvp?.reminderScheduledAt ?? null;

  /** Unified spring config */
  const SPR = {
    Z: { stiffness: 220, damping: 26, mass: 0.9 },
    X: { stiffness: 200, damping: 24, mass: 0.9 },
    R: { stiffness: 220, damping: 26, mass: 0.9 },
    Y: { stiffness: 200, damping: 26, mass: 0.9 }, // vertical parallax (title/meta)
    Y_ACTIONS: { stiffness: 200, damping: 24, mass: 0.9 }, // vertical parallax (actions)
    PRESS: { stiffness: 900, damping: 40, mass: 0.6 },
  } as const;

  const ACTIVE_TITLE_Z = 40;
  const ACTIVE_ACTIONS_Z = 30;
  const ACTIVE_META_Z = 14;

  /** Tilt-aware orientation for z-pop (compensate lateral drift) */
  const tiltIsOn = stackTiltEnabled && !prefersReduced;
  const dirSign = tiltIsOn ? (stackTiltDirection === 'left' ? +1 : -1) : 0;

  // How much lateral shift per unit Z (scaled by global tilt)
  const xPerZ = 0.7 * (stackTiltAmountDeg / 18);
  // Yaw based on global tilt intensity
  const rotYBase = 0.35 * stackTiltAmountDeg;
  // Small pitch to “push” towards the camera
  const rotXBase = Math.min(4, stackTiltAmountDeg * 0.2);

  /** Springs per layer (Z + lateral/rotational compensation) */
  const zTitle = useSpring(0, SPR.Z);
  const xTitle = useSpring(0, SPR.X);
  const rYTitle = useSpring(0, SPR.R);
  const rXTitle = useSpring(0, SPR.R);

  const zActions = useSpring(0, SPR.Z);
  const xActions = useSpring(0, SPR.X);
  const rYActions = useSpring(0, SPR.R);
  const rXActions = useSpring(0, SPR.R);

  const zMeta = useSpring(0, SPR.Z);
  const xMeta = useSpring(0, SPR.X);
  const rYMeta = useSpring(0, SPR.R);
  const rXMeta = useSpring(0, SPR.R);

  /** Local fallbacks for parallax MVs (if list didn't provide them) */
  const yTitleLocal = useSpring(0, SPR.Y);
  const yActionsLocal = useSpring(0, SPR.Y_ACTIONS);
  const yMetaLocal = useSpring(0, SPR.Y);

  // Resolved motion values to use in styles
  const yTitleMV = parallaxTitleY ?? yTitleLocal;
  const yActionsMV = parallaxActionsY ?? yActionsLocal;
  const yMetaMV = parallaxMetaY ?? yMetaLocal;

  // Parallax is considered “active” only if the list passed MVs
  const parallaxActive =
    !!parallaxTitleY || !!parallaxActionsY || !!parallaxMetaY;

  // Single press spring 0→1
  const press = useSpring(0, SPR.PRESS);

  // Use negative Z for button press to sink inward
  const pressDepth = isDesktop ? 16 : 12;

  const scaleMV = useTransform(press, [0, 1], [1, 0.93]);
  const zPressMV = useTransform(press, (t) => -pressDepth * t);
  const xPressMV = useTransform(press, (t) => dirSign * (-pressDepth) * xPerZ * t);
  const rYPressMV = useTransform(press, (t) => -dirSign * (rotYBase * 0.5) * t);
  const rXPressMV = useTransform(press, (t) => -(1.5 + 2.0 * t));

  // TOTAL transform strings
  const btnTransform = useMotionTemplate`
    translateZ(${zActions}px) translateX(${xActions}px) rotateY(${rYActions}deg) rotateX(${rXActions}deg)
    translateZ(${zPressMV}px) translateX(${xPressMV}px) rotateY(${rYPressMV}deg) rotateX(${rXPressMV}deg)
    scale(${scaleMV})
  `;

  const titleTransform = useMotionTemplate`
    translateZ(${zTitle}px) translateX(${xTitle}px) translateY(${yTitleMV}px)
    rotateY(${rYTitle}deg) rotateX(${rXTitle}deg)
  `;

  const metaTransform = useMotionTemplate`
    translateZ(${zMeta}px) translateX(${xMeta}px) translateY(${yMetaMV}px)
    rotateY(${rYMeta}deg) rotateX(${rXMeta}deg)
  `;

  /** Memoized 3D setpoints */
  const targetSetpoints = useMemo(() => {
    if (!inner3DActive || prefersReduced) {
      return {
        tZ: { title: 0, actions: 0, meta: 0 },
        tX: { title: 0, actions: 0, meta: 0 },
        tRY: { title: 0, actions: 0, meta: 0 },
        tRX: { title: 0, actions: 0, meta: 0 },
      } as const;
    }
    const tZ = { title: ACTIVE_TITLE_Z, actions: ACTIVE_ACTIONS_Z, meta: ACTIVE_META_Z };
    const tX = {
      title: dirSign * (tZ.title * xPerZ),
      actions: dirSign * (tZ.actions * xPerZ * 0.8),
      meta: dirSign * (tZ.meta * xPerZ * 0.55),
    };
    const tRY = {
      title: dirSign * (rotYBase * 1.0),
      actions: dirSign * (rotYBase * 0.75),
      meta: dirSign * (rotYBase * 0.45),
    };
    const tRX = {
      title: -rotXBase,
      actions: -(rotXBase * 0.8),
      meta: -(rotXBase * 0.5),
    };
    return { tZ, tX, tRY, tRX } as const;
  }, [inner3DActive, prefersReduced, dirSign, xPerZ, rotYBase, rotXBase]);

  /** Drive springs on activation/tilt changes */
  useEffect(() => {
    const { tZ, tX, tRY, tRX } = targetSetpoints;
    zTitle.set(tZ.title);      xTitle.set(tX.title);      rYTitle.set(tRY.title);   rXTitle.set(tRX.title);
    zActions.set(tZ.actions);  xActions.set(tX.actions);  rYActions.set(tRY.actions); rXActions.set(tRX.actions);
    zMeta.set(tZ.meta);        xMeta.set(tX.meta);        rYMeta.set(tRY.meta);     rXMeta.set(tRX.meta);
  }, [
    targetSetpoints,
    zTitle, xTitle, rYTitle, rXTitle,
    zActions, xActions, rYActions, rXActions,
    zMeta, xMeta, rYMeta, rXMeta,
  ]);

  const titleId = `event-${live.id}-title`;

  // Explicit hover for the icon (used by InToHoverIcon)
  const [detailsHovered, setDetailsHovered] = useState(false);
  const setHover = useCallback((v: boolean) => {
    setDetailsHovered((prev) => (prev === v ? prev : v));
  }, []);

  // Pointer/keyboard handlers
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onRowInteract?.(live.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    press.set(1);
  }, [onRowInteract, live.id, press]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    press.set(0);
    e.currentTarget.releasePointerCapture(e.pointerId);
    onDetails?.(live);
  }, [onDetails, press, live]);

  const handlePointerLeave = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    press.set(0);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }, [press]);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    press.set(0);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }, [press]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    // Space: press feedback; prevent scroll/native click
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      press.set(1);
      return;
    }
    // Enter: trigger directly (no visual press)
    if (e.key === 'Enter') {
      e.preventDefault();
      onDetails?.(live);
    }
  }, [press, onDetails, live]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    // Complete space cycle: release press and trigger
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      press.set(0);
      onDetails?.(live);
    }
  }, [press, onDetails, live]);

  const reminderText = useMemo(() => {
    return reminderScheduledAt
      ? `Reminder scheduled for: ${formatReminderNumeric(reminderScheduledAt, viewerTz)}`
      : null;
  }, [reminderScheduledAt, viewerTz]);

  const label = formatDate(live.date, undefined, {
    showYear: false,
    weekday: 'long',
    month: isDesktop ? 'long' : 'short',
  });

  return (
    <article
      className={cn(
        'h-full flex flex-col justify-between relative',
        'rounded-2xl bg-black/60 p-1.5 xs3:p-2 xs4:p-3 md:p-4',
        !isSelected && 'border border-zinc-800/60 hover:shadow-[0_0_0_1px_rgba(16,185,129,0.15)] transition-shadow duration-200 ease-in',
        isSelected && [
          'border border-transparent',
          'shadow-[0_0_0_1px_rgba(16,185,129,0.5),0_0_24px_rgba(16,185,129,0.35),0_0_64px_rgba(16,185,129,0.25)]',
          'focus-within:shadow-[0_0_0_1px_rgba(16,185,129,0.45),0_0_20px_rgba(16,185,129,0.34),0_0_48px_rgba(16,185,129,0.22)]',
          'transition-shadow duration-200 ease-in',
        ],
        className
      )}
      aria-labelledby={titleId}
    >
      {/* 3D context only for inner content */}
      <div className="h-full w-full [perspective:900px] overflow-visible">
        <motion.div className="h-full w-full" style={{ transformStyle: 'preserve-3d' }}>
          {/* Title + Quick actions */}
          <div className="flex items-start gap-3" style={{ transformStyle: 'preserve-3d' }}>
            {/* Title / meta column */}
            <div className="min-w-0 flex-1" style={{ transformStyle: 'preserve-3d' }}>
              {/* Title (3D) */}
              <motion.h3
                id={titleId}
                className={cn(
                  stackTiltEnabled ? '' : 'text-xs md:text-lg pointer-events-none',
                  'line-clamp-2 font-semibold font-display bg-gradient-to-br from-emerald-400 to-cyan-400 text-transparent bg-clip-text text-shadow-sm text-shadow-emerald-900/50 will-change-transform'
                )}
                style={
                  parallaxActive
                    ? { transform: titleTransform, transformStyle: 'preserve-3d' }
                    : { transform: 'none', transformStyle: 'preserve-3d' }
                }
              >
                {live.title}
              </motion.h3>

              {/* Date (3D) */}
              <motion.p
                className="mt-0.5 text-xs md:text-sm text-zinc-100 will-change-transform pointer-events-none whitespace-normal break-words"
                style={
                  parallaxActive
                    ? { transform: metaTransform, transformStyle: 'preserve-3d' }
                    : { transform: 'none', transformStyle: 'preserve-3d' }
                }
              >
                Starts{' '}
                <time dateTime={new Date(live.date).toISOString()}>{label}</time>
              </motion.p>

              {/* Location (flat) */}
              <p className="mt-0.5 truncate text-xs md:text-sm text-zinc-100 pointer-events-none">
                {live.location}
              </p>

              {/* Managed by (flat) */}
              <p className="mt-0.5 truncate text-xs md:text-sm text-zinc-100 pointer-events-none">
                Managed by{' '}
                <span className="underline underline-offset-3">
                  {live.creator?.username ?? 'Unknown'}
                </span>
              </p>
            </div>

            {/* Actions */}
            <motion.div
              className="flex items-center gap-2 shrink-0 relative z-10"
              data-no-drag
              onPointerDown={(e) => e.stopPropagation()}
              onPointerMove={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={
                parallaxActive
                  ? { y: yActionsMV, transformStyle: 'preserve-3d' }
                  : { transform: 'none', transformStyle: 'preserve-3d' }
              }
            >
              {/* Details */}
              <motion.button
                type="button"
                role="button"
                className="px-2.5 md:px-3 py-1.5 rounded-full border border-zinc-700 hover:border-zinc-500
                          transition-colors text-xs md:text-sm inline-flex items-center gap-2
                          select-none touch-manipulation transform-gpu will-change-transform cursor-pointer"
                style={{ transformStyle: 'preserve-3d', transform: btnTransform }}
                onHoverStart={() => setHover(true)}
                onHoverEnd={() => setHover(false)}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerLeave}
                onPointerCancel={handlePointerCancel}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}
                aria-label="Open details"
                title="Details"
              >
                <span className="pointer-events-none">
                  <InToHoverIcon
                    inIcon={InfoAnimatedIcon}
                    hoverIcon={InfoAnimatedIconHover}
                    inColors={{ primary: '#E5E7EB' }}
                    hoverColors={{ primary: '#E5E7EB' }}
                    resetTrigger={live.id}
                    isParentHovered={detailsHovered}
                    isDesktop={isDesktop}
                    size={isDesktop ? 18 : 15}
                    introDelay={300}
                  />
                </span>
              </motion.button>

              {/* Reminder */}
              <ReminderQuickAction
                event={live}
                myRsvp={myRsvp}
                isDesktop={isDesktop}
                baseZ={zActions}
                baseX={xActions}
                baseRotateX={rXActions}
                baseRotateY={rYActions}
                dirSign={dirSign}
                xPerZ={xPerZ}
                rotYBase={rotYBase}
                onPressStart={() => onRowInteract?.(live.id)}
              />
            </motion.div>
          </div>

          {/* Reminder slot (flat) */}
          <div className="mt-1 h-5 md:h-6 text-[11px] md:text-xs leading-5 md:leading-6 text-emerald-300 pointer-events-none">
            {reminderText}
          </div>
        </motion.div>
      </div>

      {orderNumber != null && (
        <div className="pointer-events-none absolute bottom-2 right-2 md:bottom-3 md:right-3 z-10">
          <div
            className={cn(
              'rounded-md border px-1.5 py-0.5',
              'text-[10px] md:text-xs font-mono tabular-nums',
              'bg-zinc-900/50 border-zinc-700/60 text-zinc-300/90',
              'backdrop-blur-[1px] select-none'
            )}
            aria-hidden
            title={`#${orderNumber}`}
          >
            {orderNumber}
          </div>
        </div>
      )}
    </article>
  );
}

// Lightweight comparator: event identity + flags/handlers/class.
// Visual content comes from the store via useEvent(id), so real changes
// propagate through React.memo via context.
const areEqualLite = (prev: Props, next: Props) => {
  // Row identity
  if (prev.event.id !== next.event.id) return false;

  // 3D flags / selection / class
  if (prev.inner3DActive !== next.inner3DActive) return false;
  if (prev.stackTiltEnabled !== next.stackTiltEnabled) return false;
  if (prev.stackTiltDirection !== next.stackTiltDirection) return false;
  if (prev.stackTiltAmountDeg !== next.stackTiltAmountDeg) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.className !== next.className) return false;

  // Handlers (ideally memoized in parent)
  if (prev.onDetails !== next.onDetails) return false;
  if (prev.onRowInteract !== next.onRowInteract) return false;

  return true;
};

export default memo(TiltedListEventRow, areEqualLite);
