'use client';

/* ---------------------------------------------------------------------- */
/*  React & libs                                                          */
/* ---------------------------------------------------------------------- */
import React, {
  useState,
  useTransition,
  useMemo,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'motion/react';
import { TimezoneInfoTooltip, AttendeesLegendTooltip } from "@/components/InfoTooltip";

/* ---------------------------------------------------------------------- */
/*  App hooks & utils                                                     */
/* ---------------------------------------------------------------------- */
import { useMediaQuery } from '@/lib/hooks';
import { cn, getBadgeState, formatTimeZoneLabel, tzEqualForInstant, canonicalizeTimeZone } from '@/lib/utils';
import { useViewerTz } from '@/contexts/ViewerTzContext';
import {
  useEvent,
  useRsvpActions,
  useFeaturedSWRKeys,
  useMainListSWRKeys,
  emitFeaturedChange,
  useStoreWriters,
} from '@/contexts/EventsContext';
import { FEATURED_THRESHOLD } from '@/lib/constants';

/* ---------------------------------------------------------------------- */
/*  Types                                                                 */
/* ---------------------------------------------------------------------- */
import type { EventWithCreatorAndRsvps, EditableEvent } from '@/types/event';
import type { UserProfileForAvatar } from '@/types/rsvp';
import { RSVPStatus, UserRole } from '@/generated/prisma';

/* ---------------------------------------------------------------------- */
/*  Actions & SWR helpers                                                 */
/* ---------------------------------------------------------------------- */
import {
  toggleRSVP,
  updateReminderPreference,
  type ReminderResult,
} from '@/app/(dashboard)/rsvp/actions';
import { patchReminderEverywhere } from '@/lib/mutateHelpers';

/* ---------------------------------------------------------------------- */
/*  UI components                                                         */
/* ---------------------------------------------------------------------- */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogHeader,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerHeader,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { ScrollArea } from '../ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { ChevronDown, ChevronUp } from 'lucide-react';
import UserAvatar from '../UserAvatar';
import AvatarStack from '../AvatarStack';
import EditEventForm from '../FormsRelated/EditEventForm';
import DeleteEventButton from './DeleteEventButton';
import ReminderToastContent, { REMINDER_TOAST_ID } from '../ReminderToastContent';
import AdminFeaturedBadge from '../Badges/AdminFeaturedBadge';
import AuroraFeaturedBadge from '../Badges/AuroraFeaturedBadge';

/* ---------------------------------------------------------------------- */
/*  Lottie & icons                                                        */
/* ---------------------------------------------------------------------- */
import Lottie from 'lottie-react';
import AnimatedIcon from '../LordIcons/AnimatedIcon';
import InToHoverIcon from '../LordIcons/InToHoverIcon';
import {
  WhatsappAnimatedIcon,
  WhatsappAnimatedIconHover,
  TelegramAnimatedIcon,
  TelegramAnimatedIconHover,
  LottieDoubleTapAnimatedIcon,
  CalendarAnimatedIcon,
  LocationAnimatedIcon,
  BellAnimatedIcon,
  BellAnimatedIconHover,
  MailAnimatedIcon,
  MailAnimatedIconHover,
  CheckAnimatedIcon,
  CheckAnimatedIconHover,
} from '@/lib/icons';

/* ====================================================================== */
/*  Props                                                                 */
/* ====================================================================== */

type BaseProps = {
  open: boolean;
  viewerUser?: UserProfileForAvatar | null;
  onOpenChange: (open: boolean) => void;
  onEventUpdate: (updatedEvent: EventWithCreatorAndRsvps) => void;
  onEventDeleted?: (id: string) => void;
  onRsvpCancelled?: (id: string) => void;
};

// Back-compat + new by-id shape
type Props = (
  | { event: EventWithCreatorAndRsvps; mode: 'non-editable' }
  | { event: EditableEvent; mode: 'editable' }
  | { eventId: string; mode: 'non-editable' }
  | { eventId: string; mode: 'editable' }
) & BaseProps;

/* ====================================================================== */
/*  Local helpers                                                         */
/* ====================================================================== */

/** Debounced revalidation for a set of SWR keys (plus optional predicate). */
function useDebouncedMutate() {
  const { mutate } = useSWRConfig();

  const debouncedRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    keys: Set<string>;
  }>({ timer: null, keys: new Set<string>() });

  const mutateDebounced = useCallback(
    async (keys: readonly string[], pattern?: (k: unknown) => boolean, waitMs = 120) => {
      const ref = debouncedRef.current;
      keys.forEach((k) => ref.keys.add(k));

      if (ref.timer) clearTimeout(ref.timer);
      await new Promise<void>((resolve) => {
        ref.timer = setTimeout(() => resolve(), waitMs);
      });

      const unique = Array.from(ref.keys);
      ref.keys.clear();
      ref.timer = null;

      await Promise.all(unique.map((k) => mutate(k)));
      if (pattern) await mutate(pattern);
    },
    [mutate]
  );

  return { mutateDebounced };
}

/** Predicate to match only events list keys (e.g., /api/events?...). */
const isEventsListKey = (k: unknown): k is string =>
  typeof k === 'string' && k.startsWith('/api/events?');

// ──────────────────────────────────────────────────────────────────────────────
// Wrapper: keeps hook-count stable by doing the early-return *before* mounting
// the loaded child. It mirrors the current MenuContent props.
// ──────────────────────────────────────────────────────────────────────────────
function MenuContentWrapper(
  props: Props & {
    viewMode: 'view' | 'edit';
    setViewMode: (mode: 'view' | 'edit') => void;
    onOpenChange: (open: boolean) => void;
    isDesktop: boolean;
  }
) {
  // Derive id and (optionally) a compat object (same logic you already use)
  const eventId =
    'eventId' in props && props.eventId
      ? props.eventId
      : 'event' in props
      ? props.event.id
      : '';

  const eventCompat: EditableEvent | EventWithCreatorAndRsvps | undefined =
    'event' in props ? props.event : undefined;

  // Only one hook in this component
  const eventFromContext = useEvent(eventId);

  // Choose the live source (store first, then compat)
  const liveSource: EditableEvent | EventWithCreatorAndRsvps | undefined =
    eventFromContext ?? eventCompat;

  // Safe early-return: no other hooks have been called here
  if (!liveSource) return null;

  // Hand off to the loaded child, which will contain *all* other hooks + JSX
  return (
    <MenuContentLoaded
      {...props}
      eventId={eventId}
      event={liveSource}
    />
  );
}

/* ====================================================================== */
/*  MenuContent (shared by Dialog & Drawer)                               */
/* ====================================================================== */

function MenuContentLoaded(
  props: Props & {
    eventId: string;
    event: EditableEvent | EventWithCreatorAndRsvps;
    viewMode: 'view' | 'edit';
    setViewMode: (mode: 'view' | 'edit') => void;
    onOpenChange: (open: boolean) => void;
    isDesktop: boolean;
  }
) {
  const {
    mode,
    open: isOpen,
    onEventUpdate,
    onEventDeleted,
    onRsvpCancelled,
    viewMode,
    setViewMode,
    onOpenChange,
    isDesktop,
    eventId,
    event,
  } = props;

  const live = event;

  /* -------------------------------------------------------------------- */
  /*  Local UI state                                                      */
  /* -------------------------------------------------------------------- */
  const [isAttendeeListOpen, setIsAttendeeListOpen] = useState(false);
  const [isLocationOpen, setIsLocationOpen] = useState(false);
  const [canLocationExpand, setCanLocationExpand] = useState(false);
  const [isMailHovered, setIsMailHovered] = useState(false);
  const [isWhatsappHovered, setIsWhatsappHovered] = useState(false);
  const [isTelegramHovered, setIsTelegramHovered] = useState(false);
  const [isReminderBtnHovered, setIsReminderBtnHovered] = useState(false);
  const [isChangeReminderHovered, setIsChangeReminderHovered] = useState(false);
  const [viewEventTz, setViewEventTz] = useState(false);
  const [isPending, startTransition] = useTransition();

  const previewLocationRef = useRef<HTMLParagraphElement>(null);
  const ghostLocationRef = useRef<HTMLParagraphElement>(null);

  /* -------------------------------------------------------------------- */
  /*  Global hooks & stores                                               */
  /* -------------------------------------------------------------------- */
  const pathname = usePathname();
  const { user: clerkUser, isSignedIn, isLoaded: isUserLoaded } = useUser();
  const { mutate } = useSWRConfig();
  const { getFeaturedKeys } = useFeaturedSWRKeys();
  const { getMainListKeys } = useMainListSWRKeys();
  const { upsertEvents } = useStoreWriters();
  const { commitReminder } = useRsvpActions();
  const { viewerTz, formatDate } = useViewerTz();
  const { mutateDebounced } = useDebouncedMutate();
  const canManage = pathname.startsWith('/organizer') || pathname.startsWith('/admin');


  // Normalize event TZ and compare by “equivalence” at the event instant (offset-aware)
  const eventTzRaw = live.eventTimeZone ?? 'UTC';
  const eventTz = canonicalizeTimeZone(eventTzRaw);
  const areTzEquivalent = tzEqualForInstant(eventTz, viewerTz, new Date(live.date));
  const showTzToggle = !areTzEquivalent;
  const badgeState = getBadgeState(live);

  // Type guard: detect if “live” is an EventWithCreatorAndRsvps
  function isFullEvent(e: EditableEvent | EventWithCreatorAndRsvps | undefined): e is EventWithCreatorAndRsvps {
    return !!e && 'rsvps' in e;
  }
  const liveFull = useMemo(() => (isFullEvent(live) ? live : undefined), [live]);

  const currentUserId = clerkUser?.id ?? null;

  type RsvpItem = EventWithCreatorAndRsvps['rsvps'][number];

  // Derived values from “liveFull” (live state)
  const rsvpsAll = useMemo<RsvpItem[]>(() => (liveFull ? liveFull.rsvps : []), [liveFull]);
  const confirmedAttendees = useMemo<RsvpItem[]>(
    () => rsvpsAll.filter((r: RsvpItem) => r.status === RSVPStatus.confirmed),
    [rsvpsAll]
  );

  const currentUserRsvp = useMemo<RsvpItem | undefined>(() => {
    if (mode !== 'non-editable' || !isSignedIn || !currentUserId || !liveFull) return undefined;
    return liveFull.rsvps.find((r) => r.user.clerkId === currentUserId);
  }, [mode, isSignedIn, currentUserId, liveFull]);

  const isCurrentUserAttending = useMemo<boolean>(() => {
    return currentUserRsvp?.status === RSVPStatus.confirmed;
  }, [currentUserRsvp]);

  /* -------------------------------------------------------------------- */
  /*  Delete → close & notify parent                                      */
  /* -------------------------------------------------------------------- */
  const handleEventDeletionSuccess = (id: string) => {
    onOpenChange(false);
    onEventDeleted?.(id);
  };

  /* -------------------------------------------------------------------- */
  /*  RSVP toggle (optimistic + server + lists + debounced revalidations) */
  /* -------------------------------------------------------------------- */
  const handleRsvpToggle = () => {
    if (!isSignedIn || !clerkUser) {
      return toast.error('Please sign in to attend events.');
    }
    if (mode !== 'non-editable' || !('rsvps' in live)) return;

    console.log('[Menu] toggleRSVP click', {
      id: eventId,
      mode,
      hasOnRsvpCancelled: typeof onRsvpCancelled === 'function',
    });
    const toastId = toast.loading('Updating attendance...');

    const prevEvent = live as EventWithCreatorAndRsvps;
    const prevFeatured = Boolean(prevEvent.featured);

    // Reutilizamos el memo para conocer el estado previo
    const wasAttending = isCurrentUserAttending;
    console.log('[Menu] wasAttending?', wasAttending, 'userId?', clerkUser?.id);

    // Si el current user es el creator, proyectamos el creator al shape "UserProfileForAvatar"
    const creatorAsAvatar: UserProfileForAvatar | undefined =
    prevEvent.creator?.clerkId === clerkUser.id
      ? {
          clerkId: prevEvent.creator.clerkId,
          username: prevEvent.creator.username,
          firstName: prevEvent.creator.firstName ?? null,
          lastName: prevEvent.creator.lastName ?? null,
          imageUrl: prevEvent.creator.imageUrl ?? null,
          hasImage: prevEvent.creator.hasImage ?? Boolean(prevEvent.creator.imageUrl),
          role: prevEvent.creator.role,
        }
      : undefined;

  // USER optimista: DB-first. Clerk solo aporta el clerkId si no hay datos en DB.
  const optimisticUser: UserProfileForAvatar =
    currentUserRsvp?.user
    ?? props.viewerUser
    ?? creatorAsAvatar
    ?? {
      clerkId: clerkUser.id,    // único dato confiable desde Clerk
      username: '',
      firstName: null,
      lastName: null,
      imageUrl: null,
      hasImage: false,          // evita parpadeo hasta que llegue la DB
      role: UserRole.user,
    };

    // RSVP optimista (sin nombre/foto desde Clerk)
    const optimisticRsvp: EventWithCreatorAndRsvps['rsvps'][number] = {
      status: RSVPStatus.confirmed,
      reminderPreferenceType: null,
      reminderOffsetMinutes: null,
      reminderScheduledAt: null,
      reminderSentAt: null,
      user: optimisticUser,
    };

    // Build next RSVPs
    const nextRsvps = wasAttending
      ? prevEvent.rsvps.filter(
          (r) => !(r.user.clerkId === clerkUser.id && r.status === RSVPStatus.confirmed)
        )
      : [
          // limpiamos cualquier RSVP previo del mismo user (pending/cancelled) para evitar duplicados
          ...prevEvent.rsvps.filter((r) => r.user.clerkId !== clerkUser.id),
          optimisticRsvp,
        ];

    // Optimistic featured (respect admin)
    const nextConfirmedCount = nextRsvps.reduce(
      (acc, r) => acc + (r.status === RSVPStatus.confirmed ? 1 : 0),
      0
    );
    const optimisticFeatured = nextConfirmedCount >= FEATURED_THRESHOLD;

    const optimisticEvent: EventWithCreatorAndRsvps = {
      ...prevEvent,
      rsvps: nextRsvps,
      featured: optimisticFeatured,
    };

    // Immediate UI
    onEventUpdate?.(optimisticEvent);

    console.log('[Menu] sending toggleRSVP to server…', { id: eventId });

    // Server roundtrip + reconciliation
    startTransition(() => {
      toggleRSVP(prevEvent.id)
        .then(async (data) => {
          console.log('[Menu] server responded', { id: eventId, data });

          if (!data?.success) {
            toast.error(data?.message || 'Could not update attendance.', { id: toastId });
            onEventUpdate?.(prevEvent); // rollback
            return;
          }

          // Reconcile with server data
          const baseEventAfterServer = data.updatedEvent
            ? {
                ...optimisticEvent,
                featured: data.updatedEvent.featured,
              }
            : optimisticEvent;

          let committedFinal: EventWithCreatorAndRsvps = baseEventAfterServer;

          if (data.action === 'created') {
            const r = data.newRsvp!;
            const serverRsvp: EventWithCreatorAndRsvps['rsvps'][number] = {
              status: r.status,
              reminderPreferenceType: r.reminderPreferenceType ?? null,
              reminderOffsetMinutes: r.reminderOffsetMinutes ?? null,
              reminderScheduledAt: r.reminderScheduledAt ?? null,
              reminderSentAt: r.reminderSentAt ?? null,
              user: {
                clerkId: r.user.clerkId,
                username: r.user.username,
                firstName: r.user.firstName ?? null,
                lastName: r.user.lastName ?? null,
                imageUrl: r.user.imageUrl ?? null,
                hasImage: r.user.hasImage ?? Boolean(r.user.imageUrl),
                role: r.user.role ?? UserRole.user,
              },
            };

            const mergedRsvps = [
              ...baseEventAfterServer.rsvps.filter(
                (x) => x.user.clerkId !== serverRsvp.user.clerkId
              ),
              serverRsvp,
            ];

            committedFinal = { ...baseEventAfterServer, rsvps: mergedRsvps };

            // Reminder toast (optional)
            setTimeout(() => {
              try { showReminderToast(); } catch {}
            }, 1800);

          } else if (data.action === 'cancelled') {
            console.log('[Menu] RSVP cancelled → notifying wrapper to remove row', eventId);
            const mergedRsvps = baseEventAfterServer.rsvps.filter(
              (x) => x.user.clerkId !== data.userId
            );
            committedFinal = { ...baseEventAfterServer, rsvps: mergedRsvps };
            onRsvpCancelled?.(eventId);
          }

          // Write entity to store
          upsertEvents([committedFinal]);
          onEventUpdate?.(committedFinal);

          // Emit bus if featured changed
          const finalIsFeatured = data.updatedEvent?.featured ?? committedFinal.featured;
          const featuredChanged = prevFeatured !== Boolean(finalIsFeatured);

          if (featuredChanged) {
            emitFeaturedChange({
              id: committedFinal.id,
              toFeatured: Boolean(finalIsFeatured),
            });

            const featuredKeys = Array.from(new Set(getFeaturedKeys()));
            if (!finalIsFeatured) {
              const mainKeys = Array.from(new Set(getMainListKeys()));
              await mutateDebounced([...featuredKeys, ...mainKeys], isEventsListKey);
            } else {
              await mutateDebounced(featuredKeys);
            }
          }

          toast.success(data.message || 'Update successful!', {
            id: toastId,
            duration: 1000,
          });
        })
        .catch((err) => {
          console.error(err);
          toast.error('Could not update attendance.', { id: toastId });
          onEventUpdate?.(prevEvent);
        });
    });
  };

  /* -------------------------------------------------------------------- */
  /*  Reminder handlers                                                   */
  /* -------------------------------------------------------------------- */
  const handleCancelReminder = () => {
    if (mode !== 'non-editable' || !isFullEvent(live)) return;

    startTransition(() => {
      toast.promise(updateReminderPreference(eventId, null), {
        loading: 'Cancelling reminder...',
        success: (data: ReminderResult) => {
          if (!data.success) return data.message;

          // 1) broadcast to SWR caches
          patchReminderEverywhere(mutate, eventId, data.updatedRsvp);

          // 2) write to EventsContext
          commitReminder(eventId, data.updatedRsvp.userClerkId, {
            reminderPreferenceType: null,
            reminderOffsetMinutes: null,
            reminderScheduledAt: null,
            reminderSentAt: null,
          });
          return data.message;
        },
        error: (err) => (err instanceof Error ? err.message : 'Failed to cancel reminder.'),
      });
    });
  };

  const showReminderToast = () => {
    toast.custom(
      (t) => (
        <div className="bg-black p-4 rounded-lg shadow-xl text-white w-full max-w-sm flex flex-col items-center text-center border border-zinc-700 font-sans">
          <p className="text-lg font-heading font-semibold">Would you like to be reminded?</p>
          <Lottie
            animationData={LottieDoubleTapAnimatedIcon}
            loop
            autoplay
            style={{ width: 60, height: 60, marginTop: '-10px' }}
          />
          <p className="text-xs text-zinc-400 -mt-2">(Double-Tap to interact)</p>
          <div className="flex space-x-3 w-full pt-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full flex-1 text-white hover:text-white focus:text-white bg-black border border-zinc-800 hover:bg-emerald-950/50 hover:border-emerald-800 focus:bg-emerald-950/50 focus:border-emerald-800 cursor-pointer transition-colors duration-200"
              onClick={() => {
                toast.dismiss(t);
                toast.custom(
                  () => (
                    <ReminderToastContent
                      eventId={eventId}
                      eventDate={new Date(live.date)}
                      onDismiss={() => toast.dismiss(REMINDER_TOAST_ID)}
                      doubleTap={false}
                      isDesktop={isDesktop}
                      commitReminder={commitReminder}
                    />
                  ),
                  { id: REMINDER_TOAST_ID, duration: 30000, classNames: { toast: 'z-[60]' } }
                );
              }}
            >
              Yes, please
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full flex-1 hover:bg-rose-950/50 hover:border hover:border-rose-800 focus:bg-rose-950/50 focus:border focus:border-rose-800 text-white hover:text-white focus:text-white cursor-pointer transition-colors duration-200"
              onClick={() => {
                handleCancelReminder();
                toast.dismiss(t);
              }}
            >
              No, thanks
            </Button>
          </div>
        </div>
      ),
      { duration: 5000, classNames: { toast: 'z-[60]' } }
    );
  };

  const showReminderConfigToast = () => {
    toast.custom(
      () => (
        <ReminderToastContent
          eventId={eventId}
          eventDate={new Date(live.date)}
          onDismiss={() => toast.dismiss(REMINDER_TOAST_ID)}
          isDesktop={isDesktop}
          commitReminder={commitReminder}
        />
      ),
      { id: REMINDER_TOAST_ID, duration: 30000, classNames: { toast: 'z-[60]' } }
    );

    //Close the menu so the user can interact with the toast
     props.onOpenChange(false);
  };

  /* -------------------------------------------------------------------- */
  /*  Date/time label helper                                              */
  /* -------------------------------------------------------------------- */
  function formatEventDate(): string {
    const iso = live.date;
    const evTz = eventTz; // use canonical

    if (mode === 'editable') return formatDate(iso, evTz);
    if (!showTzToggle) return formatDate(iso, evTz);

    const tzToUse = viewEventTz ? evTz : viewerTz;
    return formatDate(iso, tzToUse);
  }

  /* -------------------------------------------------------------------- */
  /*  Render                                                              */
  /* -------------------------------------------------------------------- */
  const isAdminBadge = badgeState === 'admin' || badgeState === 'both';
  const isAuroraBadge = badgeState === 'featured' || badgeState === 'both';

  const shouldShowTzBadgeEditable =
    mode === 'editable' && !areTzEquivalent;

  const shouldShowTzToggle =
    mode !== 'editable' && showTzToggle;

  const showTzHelp = shouldShowTzBadgeEditable || shouldShowTzToggle;

  const phoneDigits = live.contactPhone?.replace(/\D/g, '') ?? '';
  const phoneApps = live.contactPhoneApps ?? 'whatsapp';

  // Detect if the clamped location preview overflows, to decide whether to show “See more”
  useEffect(() => {
    const preview = previewLocationRef.current;
    const ghost = ghostLocationRef.current;
    if (!preview || !ghost) return;
    const update = () => {
      // Compare full (ghost) height vs clamped (preview) height
      setCanLocationExpand(ghost.scrollHeight > preview.clientHeight + 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(preview);
    ro.observe(ghost);
    return () => ro.disconnect();
  }, [live.location, isDesktop]);

  return (
    <motion.div layout layoutRoot className="flex flex-col min-h-0">
      <AnimatePresence initial={false} mode="wait">
        {viewMode === 'edit' ? (
          <motion.div
            key="edit"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="flex flex-col min-h-0"
            style={{ willChange: 'opacity, transform' }}
          >
            <>
              {isDesktop ? (
                <DialogHeader className="p-6 pb-4 shrink-0 text-left border-b border-zinc-800">
                  <DialogTitle className="text-2xl font-bold font-heading text-emerald-500">
                    Edit Event
                  </DialogTitle>
                </DialogHeader>
              ) : (
                <DrawerHeader className="p-6 pb-4 shrink-0 text-left border-b border-zinc-800">
                  <DrawerTitle className="text-2xl font-bold font-heading text-emerald-500">
                    Edit Event
                  </DrawerTitle>
                </DrawerHeader>
              )}

              <div
                className={cn(
                  'flex-1 min-h-0 pt-4',
                  'overflow-y-auto',
                  '[&::-webkit-scrollbar]:w-1',
                  '[&::-webkit-scrollbar-track]:bg-transparent',
                  '[&::-webkit-scrollbar-thumb]:rounded-full',
                  '[&::-webkit-scrollbar-thumb]:bg-emerald-900',
                  '[&::-webkit-scrollbar-thumb:hover]:bg-emerald-500'
                )}
              >
                <EditEventForm
                  key={eventId}
                  event={live as EditableEvent}
                  onCancel={() => setViewMode('view')}
                  onSuccess={(updated) => {
                    if (updated) onEventUpdate(updated);
                    setViewMode('view');
                  }}
                />
              </div>
            </>
          </motion.div>
        ) : (
          <motion.div
            key="view"
            className="flex flex-col min-h-0"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.16, ease: 'easeInOut' }}
            style={{ willChange: 'opacity, transform' }}
          >
            <>
              {/* Header + badges */}
              {isDesktop ? (
                <DialogHeader
                  className={cn(
                    'p-6 pb-4 relative shrink-0 text-left border-b border-zinc-800',
                    badgeState !== 'none' ? 'pb-8.5' : ''
                  )}
                >
                  {badgeState !== 'none' && (
                    <div
                      className={cn('absolute z-10 flex bottom-1 right-1.5', {
                        ' flex gap-x-1.5 items-end': badgeState === 'both',
                      })}
                    >
                      {isAdminBadge && <AdminFeaturedBadge />}
                      {isAuroraBadge && <AuroraFeaturedBadge />}
                    </div>
                  )}
                  <DialogTitle className="text-3xl font-semibold font-heading bg-gradient-to-br from-emerald-400 to-cyan-400 text-transparent bg-clip-text text-shadow-sm text-shadow-emerald-900/50">
                    {live.title}
                  </DialogTitle>
                </DialogHeader>
              ) : (
                <DrawerHeader className="p-6 pb-4 shrink-0 text-left border-b border-zinc-800">
                  {badgeState !== 'none' && (
                    <div
                      className={cn('absolute z-10 flex', {
                        '-top-4 right-1.5 flex-col gap-y-1.5 items-end':
                          badgeState === 'both',
                        '-top-4 right-1.5':
                          badgeState === 'featured' || badgeState === 'admin',
                      })}
                    >
                      {isAdminBadge && <AdminFeaturedBadge />}
                      {isAuroraBadge && <AuroraFeaturedBadge />}
                    </div>
                  )}
                  <DrawerTitle className="text-2xl xs4:text-3xl font-semibold font-heading bg-gradient-to-br from-emerald-400 to-cyan-400 text-transparent bg-clip-text text-shadow-sm text-shadow-emerald-900/50">
                    {live.title}
                  </DrawerTitle>
                </DrawerHeader>
              )}

              {/* Body */}
              <div className="flex-1 min-h-0 py-2 md:py-3 px-4 xs4:px-5  ">
                {/* Description */}
                {live.description && (
                  <div className="mb-2 md:mb-3">
                    <ScrollArea
                      className={cn(
                        'max-h-24 overflow-y-auto overscroll-contain',
                        '[&::-webkit-scrollbar]:w-1',
                        '[&::-webkit-scrollbar-track]:bg-transparent',
                        '[&::-webkit-scrollbar-thumb]:rounded-full',
                        '[&::-webkit-scrollbar-thumb]:bg-emerald-900',
                        '[&::-webkit-scrollbar-thumb:hover]:bg-emerald-600',
                        '[&::-webkit-scrollbar-thumb:hover]:cursor-pointer'
                      )}
                    >
                      {(() => {
                        const descriptionProps = {
                          className: 'text-xs xs4:text-sm text-zinc-200 font-sans pr-6',
                          children: live.description,
                        };
                        return isDesktop ? (
                          <DialogDescription {...descriptionProps} />
                        ) : (
                          <DrawerDescription {...descriptionProps} />
                        );
                      })()}
                    </ScrollArea>
                  </div>
                )}

                {/* Meta (date/time + location + creator/contact) */}
                <div className="mb-4 border-t border-zinc-800 pt-4 font-sans">
                  <div className="flex items-center mb-3 gap-3 text-xs xs4:text-base xl:text-sm text-zinc-300">
                    <AnimatedIcon icon={CalendarAnimatedIcon} size={16} state="in" />

                    {/* Group: Date + Tooltip (tooltip only if there’s TZ UI) */}
                    <div className="flex-1 min-w-0">
                      <span className="inline min-w-0">
                        <span
                          data-testid="menu-event-date"
                          className="whitespace-normal break-words"
                         >
                          {formatEventDate()}
                          </span>
                        {showTzHelp && (
                          <TimezoneInfoTooltip
                            where={mode === 'editable' ? 'menu-editable' : 'menu-badge'}
                            side="top"
                            align="start"
                            triggerMode="both"
                            size="sm"
                            ariaLabel="Timezone help"
                            eventTzDisplay={formatTimeZoneLabel(eventTz)}
                            viewerTz={viewerTz}
                            className="inline-flex align-baseline ml-2 -translate-y-[1px] shrink-0"
                          />
                        )}
                      </span>
                    </div>

                    {/* TZ UI */}
                    {shouldShowTzBadgeEditable ? (
                      <div className="ml-auto flex flex-col items-end md:flex-row md:items-center md:gap-1">
                        <span className="text-2xs self-start ml-2 text-zinc-400 md:hidden">
                          Timezone:
                        </span>
                        <span className="inline-flex items-center rounded-md bg-zinc-800/60 px-2 py-0.5 text-2xs">
                          <span className="hidden md:inline mr-1">Timezone:</span>
                          <span className="whitespace-nowrap">
                            {formatTimeZoneLabel(live.eventTimeZone)}
                          </span>
                        </span>
                      </div>
                    ) : shouldShowTzToggle ? (
                      <button
                        data-testid="menu-tz-toggle"
                        onClick={() => setViewEventTz((v) => !v)}
                        className="ml-auto px-2 py-0.5 rounded-md text-2xs bg-zinc-800/60 hover:bg-zinc-700 transition-colors"
                      >
                        {viewEventTz ? "view in your timezone" : "view in event's timezone"}
                      </button>
                    ) : null}
                  </div>

                  {/* Location */}
                  <div className="flex items-start gap-3 text-zinc-300">
                    <AnimatedIcon icon={LocationAnimatedIcon} size={16} state="in" />
                    <div className="flex-1 min-w-0 relative">
                      {/* Collapsed preview (clamped). Only visible when closed. */}
                      {!isLocationOpen && (
                        <p
                          ref={previewLocationRef}
                          title={live.location}
                          className={cn(
                            "text-xs xs4:text-sm whitespace-pre-wrap break-words hyphens-auto",
                            "line-clamp-2"
                          )}
                        >
                          {live.location}
                        </p>
                      )}

                      {/* Ghost (full height) to measure overflow; absolutely positioned, invisible */}
                      <p
                        ref={ghostLocationRef}
                        aria-hidden
                        className={cn(
                          "absolute opacity-0 -z-10 pointer-events-none",
                          "inset-x-0 top-0",
                          "text-xs xs4:text-sm whitespace-pre-wrap break-words hyphens-auto"
                        )}
                      >
                        {live.location}
                      </p>

                      {/* Expanded content with real scroll (bounded height) */}
                      {isLocationOpen && (
                        <ScrollArea
                          id="full-location"
                          aria-label="Full location"
                          className={cn(
                            "pr-3 relative overscroll-contain overflow-y-auto",
                            "max-h-12 xl:max-h-14 2xl:max-h-16",
                            "[&::-webkit-scrollbar]:w-1",
                            "[&::-webkit-scrollbar-track]:bg-transparent",
                            "[&::-webkit-scrollbar-thumb]:rounded-full",
                            "[&::-webkit-scrollbar-thumb]:bg-emerald-900",
                            "[&::-webkit-scrollbar-thumb:hover]:bg-emerald-600"
                          )}
                        >
                          <p className="text-xs xs4:text-sm whitespace-pre-wrap break-words hyphens-auto">
                            {live.location}
                          </p>
                        </ScrollArea>
                      )}

                      {/* Toggle action; only render if the text actually overflows */}
                      {canLocationExpand && (
                        <div className="mt-0.5 md:mt-1">
                          <button
                            onClick={() => setIsLocationOpen((v) => !v)}
                            className="text-emerald-500 hover:text-emerald-400 text-xs font-semibold underline-offset-2 hover:underline"
                            aria-expanded={isLocationOpen}
                            aria-controls="full-location"
                          >
                            {isLocationOpen ? "Hide" : "See more"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Creator + Contact */}
                  {mode === 'non-editable' && liveFull?.creator && (
                    <div className="flex justify-between">
                      <div className="flex items-center gap-3 text-zinc-300">
                        <div className="shrink-0">
                          <UserAvatar
                            {...liveFull.creator}
                            className="size-3.5"
                            fallbackClassName="text-[7px]"
                            iterationCount={2}
                            variant="creator"
                            borderVariant='animated'
                            density='normal'
                          />
                        </div>
                        <span className="flex items-baseline">
                          By: <p className="font-display text-xs xs4:text-sm ml-1">{liveFull.creator.username}</p>
                        </span>
                      </div>

                      {(live.contactEmail || live.contactPhone) && (
                        <div className="flex items-center gap-3">
                          {live.contactEmail && (
                            <Link
                              href={`mailto:${live.contactEmail}`}
                              className="p-1 rounded-full bg-transparent border border-transparent hover:border-white transition duration-300 ease-in-out cursor-pointer"
                              aria-label="Send an email"
                              onMouseEnter={() => setIsMailHovered(true)}
                              onMouseLeave={() => setIsMailHovered(false)}
                            >
                              <InToHoverIcon
                                inIcon={MailAnimatedIcon}
                                hoverIcon={MailAnimatedIconHover}
                                size={28}
                                resetTrigger={isOpen}
                                isParentHovered={isMailHovered}
                                isDesktop={isDesktop}
                                className="cursor-pointer"
                              />
                            </Link>
                          )}

                          {live.contactPhone && (phoneApps === 'whatsapp' || phoneApps === 'both') && (
                            <Link
                              href={`https://wa.me/${phoneDigits}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 rounded-full bg-transparent border border-transparent hover:border-white transition duration-300 ease-in-out cursor-pointer"
                              aria-label="Contact via WhatsApp"
                              onMouseEnter={() => setIsWhatsappHovered(true)}
                              onMouseLeave={() => setIsWhatsappHovered(false)}
                            >
                              <InToHoverIcon
                                inIcon={WhatsappAnimatedIcon}
                                hoverIcon={WhatsappAnimatedIconHover}
                                size={28}
                                resetTrigger={isOpen}
                                isParentHovered={isWhatsappHovered}
                                isDesktop={isDesktop}
                                className="cursor-pointer"
                              />
                            </Link>
                          )}
                          {live.contactPhone && (phoneApps === 'telegram' || phoneApps === 'both') && (
                            <Link
                              href={`https://t.me/+${phoneDigits}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-0.5 mt-[2px] rounded-full bg-transparent border border-transparent hover:border-white transition duration-300 ease-in-out cursor-pointer"
                              aria-label="Contact via Telegram"
                              onMouseEnter={() => setIsTelegramHovered(true)}
                              onMouseLeave={() => setIsTelegramHovered(false)}
                            >
                              <InToHoverIcon
                                inIcon={TelegramAnimatedIcon}
                                hoverIcon={TelegramAnimatedIconHover}
                                size={31}
                                resetTrigger={isOpen}
                                isParentHovered={isTelegramHovered}
                                isDesktop={isDesktop}
                                className="cursor-pointer"
                              />
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Attendees */}
                <div className="mt-2 xs4:mt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p
                        data-testid="attendees-count"
                        className="text-base xs4:text-md font-semibold font-heading text-zinc-200">
                          Attendees ({confirmedAttendees.length})
                      </p>
                      <AttendeesLegendTooltip
                        side="top"
                        align="start"
                        triggerMode="both"
                        size="sm"
                        ariaLabel="Attendees legend"
                        className='mt-1'
                      />
                    </div>
                    {confirmedAttendees.length > 0 && (
                      <AvatarStack
                        rsvps={rsvpsAll}
                        maxVisible={3}
                        avatarSizeClassName="size-8"
                      />
                    )}
                  </div>

                  {confirmedAttendees.length > 0 ? (
                    <Collapsible open={isAttendeeListOpen} onOpenChange={setIsAttendeeListOpen}>
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="link"
                          className="text-xs xs4:text-sm text-emerald-500 hover:text-emerald-400 p-0 h-auto font-semibold cursor-pointer"
                        >
                          {isAttendeeListOpen
                            ? 'Hide list'
                            : `See all ${confirmedAttendees.length} attendees`}
                          {isAttendeeListOpen ? (
                            <ChevronUp className="size-4 ml-1" />
                          ) : (
                            <ChevronDown className="size-4 ml-1" />
                          )}
                        </Button>
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <div className="pt-1.5 md:pt-2">
                          <ScrollArea data-allow-scroll className={cn(
                            "relative overflow-y-auto overscroll-y-contain pr-3",
                            "max-h-24 xs4:max-h-40",
                            "[@media(max-width:409px)_and_(max-height:690px)]:max-h-10",
                            "[@media(min-width:410px)_and_(max-height:790px)]:max-h-24",
                            '[&::-webkit-scrollbar]:w-1',
                            '[&::-webkit-scrollbar-track]:bg-transparent',
                            '[&::-webkit-scrollbar-thumb]:rounded-full',
                            '[&::-webkit-scrollbar-thumb]:bg-emerald-900',
                            '[&::-webkit-scrollbar-thumb:hover]:bg-emerald-600',
                            '[&::-webkit-scrollbar-thumb:hover]:cursor-pointer'
                            )}>
                            <ul className="space-y-2">
                              {confirmedAttendees.map((rsvp) => (
                                <li
                                  key={rsvp.user.clerkId}
                                  className="flex items-center space-x-3 p-1.5 rounded-md hover:bg-zinc-900 transition-colors"
                                >
                                  <UserAvatar {...rsvp.user} className="size-8" variant="attendee" borderVariant='static' density='compact'/>
                                  <span className="text-sm text-zinc-200 font-sans">
                                    {rsvp.user.username}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </ScrollArea>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : (
                    mode === 'non-editable' && (
                      <p className="text-sm text-zinc-500 italic mt-1 font-sans">
                        Be the first to attend!
                      </p>
                    )
                  )}
                </div>
              </div>

              {/* Footer (RSVP switch + reminder + manage) */}
              <div className="shrink-0 h-[67px] p-4 bg-zinc-900/50 border-t border-zinc-800 flex items-center justify-between gap-4">
                {/* Left: RSVP switch */}
                {mode === 'non-editable' && isUserLoaded && (
                  <div className="flex items-center space-x-3">
                    <Switch
                      id={`rsvp-toggle-${eventId}`}
                      data-testid="rsvp-toggle"
                      checked={isCurrentUserAttending}
                      onCheckedChange={handleRsvpToggle}
                      disabled={isPending || !isSignedIn}
                      className="data-[state=checked]:bg-emerald-600 data-[state=unchecked]:bg-zinc-700 cursor-pointer"
                    />
                    <Label
                      htmlFor={`rsvp-toggle-${eventId}`}
                      className="text-white font-medium select-none cursor-pointer"
                    >
                      {isPending
                        ? 'Updating...'
                        : isCurrentUserAttending
                        ? 'You are Attending'
                        : 'Attend Event?'}
                    </Label>
                  </div>
                )}

                {mode === 'editable' && <div />}

                {/* Right: reminders & manage */}
                <div className="flex items-center gap-2">
                  {isCurrentUserAttending && !currentUserRsvp?.reminderScheduledAt && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-auto py-1.5 px-2.5 border-emerald-700 text-emerald-400 bg-emerald-950/50 hover:bg-emerald-900 hover:text-emerald-300 transition-colors duration-200 cursor-pointer"
                      onClick={showReminderConfigToast}
                      onMouseEnter={() => setIsReminderBtnHovered(true)}
                      onMouseLeave={() => setIsReminderBtnHovered(false)}
                    >
                      <InToHoverIcon
                        inIcon={BellAnimatedIcon}
                        hoverIcon={BellAnimatedIconHover}
                        size={20}
                        resetTrigger={isOpen}
                        isParentHovered={isReminderBtnHovered}
                        isDesktop={isDesktop}
                        className="cursor-pointer"
                      />
                      Set Reminder
                    </Button>
                  )}

                  {isCurrentUserAttending && currentUserRsvp?.reminderScheduledAt && (
                    <div className="inline-flex h-8 md:h-9 items-center gap-2 text-xs text-zinc-300 px-3 bg-black/50 rounded-md leading-none">
                      <InToHoverIcon
                        size={16}
                        inIcon={CheckAnimatedIcon}
                        hoverIcon={CheckAnimatedIconHover}
                        isDesktop={isDesktop}
                        resetTrigger={isOpen}
                        isParentHovered={isChangeReminderHovered}
                      />
                      <span className="mt-px">Reminder active</span>
                      <button
                        onClick={showReminderConfigToast}
                        className="font-semibold text-emerald-500 hover:underline text-[11px] cursor-pointer"
                        onMouseEnter={() => setIsChangeReminderHovered(true)}
                        onMouseLeave={() => setIsChangeReminderHovered(false)}
                      >
                        (change)
                      </button>
                    </div>
                  )}

                  {canManage && (
                    <div className="flex gap-2">
                      <Button
                        onClick={() => setViewMode('edit')}
                        variant="secondary"
                        size="sm"
                        className={cn(
                          "cursor-pointer",
                          "border border-white/16 bg-white/[0.025] text-zinc-100",
                          "hover:bg-white/[0.10] hover:border-white/24 hover:text-white",
                          "focus-visible:ring-0 focus-visible:outline-none active:scale-95",
                          "transition-[background,border-color,color] duration-200 ease-out"
                        )}
                      >
                        Edit
                      </Button>
                      <DeleteEventButton
                        eventId={eventId}
                        onEventDeleted={handleEventDeletionSuccess}
                      />
                    </div>
                  )}
                </div>
              </div>
            </>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ====================================================================== */
/*  Menu (Dialog on desktop / Drawer on mobile)                           */
/* ====================================================================== */

export default function Menu(props: Props) {
  const { open } = props; // <- expose `open` so effects can use it as before
  const [viewMode, setViewMode] = useState<'view' | 'edit'>('view');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  // Reset inner view when closing (let the animation end)
  useEffect(() => {
    if (!props.open) {
      const t = setTimeout(() => setViewMode('view'), 150);
      return () => clearTimeout(t);
    }
  }, [props.open]);

  // Debug mount/unmount
  useEffect(() => {
    return () => {};
  }, []);

  // Keep body padding/margin neutralized while the dialog is open (desktop only)
  useEffect(() => {
    if (!isDesktop) return;
    if (!open) return;

    const prevPad = document.body.style.paddingRight;
    const prevMar = document.body.style.marginRight;

    document.body.style.paddingRight = '0px';
    document.body.style.marginRight = '0px';

    return () => {
      document.body.style.paddingRight = prevPad;
      document.body.style.marginRight = prevMar;
    };
  }, [open, isDesktop]);

  if (isDesktop) {
    return (
      <Dialog
        open={props.open}
        onOpenChange={(next) => {
          document.documentElement.classList.toggle('dialog-open', next);
          props.onOpenChange(next);
        }}
      >
        <DialogContent className="flex flex-col max-h-[97dvh] max-w-2xl [&_button]:cursor-pointer bg-black border-zinc-700 text-white p-0">
          <MenuContentWrapper
            {...props}
            viewMode={viewMode}
            setViewMode={setViewMode}
            onOpenChange={props.onOpenChange}
            isDesktop={isDesktop}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={props.open} onOpenChange={props.onOpenChange}>
      <DrawerContent className={cn(
        "bg-black border-zinc-700 text-white flex flex-col",
        "data-[vaul-drawer-direction=bottom]:max-h-[98dvh]"
      )}>
        <MenuContentWrapper
          {...props}
          viewMode={viewMode}
          setViewMode={setViewMode}
          onOpenChange={props.onOpenChange}
          isDesktop={isDesktop}
        />
      </DrawerContent>
    </Drawer>
  );
}
