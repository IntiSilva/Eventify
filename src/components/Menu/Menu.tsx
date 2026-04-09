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
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'motion/react';
import { TimezoneInfoTooltip } from '@/components/InfoTooltip';

/* ---------------------------------------------------------------------- */
/*  App hooks & utils                                                     */
/* ---------------------------------------------------------------------- */
import { useMediaQuery } from '@/lib/hooks';
import {
  cn,
  getBadgeState,
  formatTimeZoneLabel,
  tzEqualForInstant,
  canonicalizeTimeZone,
} from '@/lib/utils';
import { getEventJoinability } from '@/lib/events/joinability';
import {
  filterCurrentlyAttendingRsvps,
  isCurrentlyAttendingRsvp,
} from '@/lib/rsvpAttendance';
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
import {
  formatMenuEventDate,
  isEventsListKey,
  isFullEvent,
} from './helpers/menuHelpers';
import { syncFeaturedChangeAndRevalidate } from './helpers/menuRsvpSyncHelpers';
import useCheckoutOpenFinalizer from './hooks/useCheckoutOpenFinalizer';
import useMenuRefundEntryState from './hooks/useMenuRefundEntryState';

/* ---------------------------------------------------------------------- */
/*  Types                                                                 */
/* ---------------------------------------------------------------------- */
import type { EventWithCreatorAndRsvps, EditableEvent } from '@/types/event';
import type { UserProfileForAvatar } from '@/types/rsvp';
import {
  RSVPAttendanceEntitlementStatus,
  RSVPStatus,
  UserRole,
} from '@/generated/prisma';

/* ---------------------------------------------------------------------- */
/*  Actions & SWR helpers                                                 */
/* ---------------------------------------------------------------------- */
import {
  toggleRSVP,
  reactivateAlreadyPaidRsvp,
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
  DialogTitle,
  DialogHeader,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerHeader,
} from '@/components/ui/drawer';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { ScrollArea } from '../ui/scroll-area';
import EditEventForm from '../FormsRelated/EditEventForm';
import MenuAttendeesSection from './sections/MenuAttendeesSection';
import MenuCreatorContactRow from './sections/MenuCreatorContactRow';
import MenuDescriptionBlock from './sections/MenuDescriptionBlock';
import MenuFooterActionsRight from './sections/MenuFooterActionsRight';
import MenuReminderIntroToast from './MenuReminderIntroToast';
import MenuTicketRow from './sections/MenuTicketRow';
import MenuViewHeader from './sections/MenuViewHeader';
import ReminderToastContent, { REMINDER_TOAST_ID } from '../ReminderToastContent';
import RefundMenuView from '../Payments/RefundMenuView';

/* ---------------------------------------------------------------------- */
/*  Lottie & icons                                                        */
/* ---------------------------------------------------------------------- */
import AnimatedIcon from '../LordIcons/AnimatedIcon';
import {
  CalendarAnimatedIcon,
  LocationAnimatedIcon,
} from '@/lib/icons';
import { StripeLogoDraw } from '../AnimatedLogos/AnimatedStripeLogo';
import { revalidateViewerPaymentStatus } from '@/lib/payments/revalidateAfterCheckout';

/* ====================================================================== */
/*  Constants                                                             */
/* ====================================================================== */
const PAID_REDIRECT_TOAST_ID = 'paid-rsvp-redirect';
const CHECKOUT_OPENED_EVENT = 'eventify:checkout-opened';

/* ====================================================================== */
/*  Props                                                                 */
/* ====================================================================== */

type BaseProps = {
  open: boolean;
  viewerUser?: UserProfileForAvatar | null;
  onOpenChange: (open: boolean) => void;
  onEventUpdate: (updatedEvent: EventWithCreatorAndRsvps) => void;
  onEventArchived?: (id: string) => void;
  onRsvpCancelled?: (id: string) => void;
};

// Back-compat + new by-id shape
type Props = (
  | { event: EventWithCreatorAndRsvps; mode: 'non-editable' }
  | { event: EditableEvent; mode: 'editable' }
  | { eventId: string; mode: 'non-editable' }
  | { eventId: string; mode: 'editable' }
) &
  BaseProps;

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
    async (
      keys: readonly string[],
      pattern?: (k: unknown) => boolean,
      waitMs = 120
    ) => {
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

// ---------------------------------------------------------------------
// Wrapper: keeps hook-count stable by doing the early-return *before* mounting
// the loaded child. It mirrors the current MenuContent props.
// ---------------------------------------------------------------------
function MenuContentWrapper(
  props: Props & {
    viewMode: 'view' | 'edit' | 'refund';
    setViewMode: (mode: 'view' | 'edit' | 'refund') => void;
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
  return <MenuContentLoaded {...props} eventId={eventId} event={liveSource} />;
}

/* ====================================================================== */
/*  MenuContent (shared by Dialog & Drawer)                               */
/* ====================================================================== */

function MenuContentLoaded(
  props: Props & {
    eventId: string;
    event: EditableEvent | EventWithCreatorAndRsvps;
    viewMode: 'view' | 'edit' | 'refund';
    setViewMode: (mode: 'view' | 'edit' | 'refund') => void;
    onOpenChange: (open: boolean) => void;
    isDesktop: boolean;
  }
) {
  const {
    mode,
    open: isOpen,
    onEventUpdate,
    onEventArchived,
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
  const [isPreparingCheckout, setIsPreparingCheckout] = useState(false);
  const [preparingCheckoutEventId, setPreparingCheckoutEventId] = useState<
    string | null
  >(null);
  const prepareTimeoutRef = useRef<number | null>(null);

  const previewLocationRef = useRef<HTMLParagraphElement>(null);
  const ghostLocationRef = useRef<HTMLParagraphElement>(null);

  // Duración total aprox de tu AnimatedStripeLogo.tsx:
  // (pathLength 1.0 + delay max 0.36) ~= 1.36s
  const PAID_TOAST_MIN_MS = 1400;

  const paidIntroStartRef = useRef<number | null>(null);
  const paidFinalizeRef = useRef<number | null>(null);

  const showPaidCheckoutToast = useCallback(() => {
    toast.loading(
      <span className="flex items-center leading-none">
        <span className="leading-none">Powered by</span>
        <StripeLogoDraw className="block h-6 w-auto translate-y-[1.5px]" />
      </span>,
      { id: PAID_REDIRECT_TOAST_ID, duration: 8000 }
    );
  }, []);

  /* -------------------------------------------------------------------- */
  /*  Global hooks & stores                                               */
  /* -------------------------------------------------------------------- */
  const pathname = usePathname();
  const router = useRouter();
  const { user: clerkUser, isSignedIn, isLoaded: isUserLoaded } = useUser();
  const { mutate } = useSWRConfig();
  const { getFeaturedKeys } = useFeaturedSWRKeys();
  const { getMainListKeys } = useMainListSWRKeys();
  const { upsertEvents } = useStoreWriters();
  const { commitReminder, setRsvpPending } = useRsvpActions();
  const { viewerTz, formatDate } = useViewerTz();
  const { mutateDebounced } = useDebouncedMutate();
  const canManage = pathname.startsWith('/organizer') || pathname.startsWith('/admin');

  // Normalize event TZ and compare by “equivalence” at the event instant (offset-aware)
  const eventTzRaw = live.eventTimeZone ?? 'UTC';
  const eventTz = canonicalizeTimeZone(eventTzRaw);
  const areTzEquivalent = tzEqualForInstant(eventTz, viewerTz, new Date(live.date));
  const showTzToggle = !areTzEquivalent;
  const badgeState = getBadgeState(live);
  const liveArchivedAt = 'archivedAt' in live ? live.archivedAt : null;
  const joinability = getEventJoinability({
    date: live.date,
    archivedAt: liveArchivedAt,
  });
  const isEventArchived =
    !joinability.isJoinable && joinability.reason === 'EVENT_ARCHIVED';

  const liveFull = useMemo(() => (isFullEvent(live) ? live : undefined), [live]);

  const currentUserId = clerkUser?.id ?? null;
  const creatorClerkId = live.creator?.clerkId ?? null;
  const isCreatorViewingOwnEvent = Boolean(currentUserId && creatorClerkId === currentUserId);
  const [paidPopoverOpen, setPaidPopoverOpen] = useState(false);
  const {
    viewerPaymentStatus,
    viewerStatusUserId,
    refundCtaState,
    refundBlockedMessage,
    canOpenRefundView,
    isPaymentStatusLoading,
    shouldShowTicketHistoryPill,
    paidTriggerLabel,
    paidTriggerAriaLabel,
    isRefundedTicketHistory,
  } = useMenuRefundEntryState({
    eventId,
    mode,
    isOpen,
    isEventPaid: Boolean(live.isPaid),
    currentUserId,
    isCreatorViewingOwnEvent,
  });

  type RsvpItem = EventWithCreatorAndRsvps['rsvps'][number];

  // Derived values from “liveFull” (live state)
  const rsvpsAll = useMemo<RsvpItem[]>(() => (liveFull ? liveFull.rsvps : []), [liveFull]);
  const confirmedAttendees = useMemo<RsvpItem[]>(
    () => filterCurrentlyAttendingRsvps(rsvpsAll),
    [rsvpsAll]
  );

  const currentUserRsvp = useMemo<RsvpItem | undefined>(() => {
    if (mode !== 'non-editable' || !isSignedIn || !currentUserId || !liveFull) return undefined;
    return liveFull.rsvps.find((r) => r.user.clerkId === currentUserId);
  }, [mode, isSignedIn, currentUserId, liveFull]);

  const isCurrentUserAttending = useMemo<boolean>(() => {
    return currentUserRsvp ? isCurrentlyAttendingRsvp(currentUserRsvp) : false;
  }, [currentUserRsvp]);
  const isJoinActionBlocked = !joinability.isJoinable && !isCurrentUserAttending;

  const handleRequestRefund = useCallback(() => {
    if (!canOpenRefundView) return;
    setPaidPopoverOpen(false);
    setViewMode('refund');
  }, [canOpenRefundView, setViewMode]);

  useEffect(() => {
    if (!isOpen || viewMode !== 'view') {
      setPaidPopoverOpen(false);
    }
  }, [isOpen, viewMode]);

  useEffect(() => {
    setPaidPopoverOpen(false);
  }, [eventId]);

  /* -------------------------------------------------------------------- */
  /*  Archive — close & notify parent                                       */
  /* -------------------------------------------------------------------- */
  const handleEventArchiveSuccess = (id: string) => {
    onOpenChange(false);
    onEventArchived?.(id);
  };

  /* -------------------------------------------------------------------- */
  /*  Paid RSVP flow (async helper)                                       */
  /* -------------------------------------------------------------------- */
  const preparePaidRsvp = async (eventForMode: EventWithCreatorAndRsvps): Promise<void> => {
    const paidJoinability = getEventJoinability({
      date: eventForMode.date,
      archivedAt: eventForMode.archivedAt,
    });
    if (!paidJoinability.isJoinable) {
      toast.error(paidJoinability.message, { id: PAID_REDIRECT_TOAST_ID });
      return;
    }

    setIsPreparingCheckout(true);
    setPreparingCheckoutEventId(eventForMode.id);
    paidIntroStartRef.current = performance.now();
    showPaidCheckoutToast();

    // safety fallback timer
    if (prepareTimeoutRef.current) window.clearTimeout(prepareTimeoutRef.current);
    prepareTimeoutRef.current = window.setTimeout(() => {
      setIsPreparingCheckout(false);
      setPreparingCheckoutEventId(null);
      toast.error('Checkout is taking too long. Please try again.', {
        id: PAID_REDIRECT_TOAST_ID,
        duration: 3000,
      });
    }, 8000);

    try {
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: eventForMode.id }),
      });

      const json = await res.json();
      if (!res.ok || !json?.success) {
        // Clear prepare state
        if (prepareTimeoutRef.current) window.clearTimeout(prepareTimeoutRef.current);
        setIsPreparingCheckout(false);
        setPreparingCheckoutEventId(null);
        const errMsg = json?.error ?? `HTTP ${res.status}`;
        toast.error(errMsg, { id: PAID_REDIRECT_TOAST_ID });
        return;
      }

      const data = json.data;

      if (data.state === 'PAYMENT_IN_PROGRESS') {
        // mark pending locally and navigate to checkout
        try {
          setRsvpPending(eventForMode.id, clerkUser!.id, data.paymentIntentId ?? undefined);
        } catch (e) {
          console.error(e);
        }

        // Clear fallback timer (checkout page will mount quickly)
        if (prepareTimeoutRef.current) window.clearTimeout(prepareTimeoutRef.current);
        // Keep the paid toast while redirecting
        router.push(`/checkout/${eventForMode.id}`);
        return;
      }

      if (data.state === 'ALREADY_PAID_ATTENDING' || data.state === 'ALREADY_PAID_NOT_ATTENDING') {
        // Handle already-paid scenarios
        if (data.state === 'ALREADY_PAID_NOT_ATTENDING') {
          // =================================================================
          // PAID REACTIVATION FLOW (already paid but not attending)
          // Apply optimistic UI + reconcile on server response
          // =================================================================

          const prevEvent = live as EventWithCreatorAndRsvps;
          const prevFeatured = Boolean(prevEvent.featured);

          if (prepareTimeoutRef.current) window.clearTimeout(prepareTimeoutRef.current);
          setIsPreparingCheckout(false);
          setPreparingCheckoutEventId(null);

          // Build optimistic RSVP for current user (same pattern as free flow)
          const optimisticUser: UserProfileForAvatar = {
            clerkId: clerkUser!.id,
            username: '',
            firstName: null,
            lastName: null,
            imageUrl: null,
            hasImage: false,
            role: UserRole.user,
          };

          const optimisticRsvp: EventWithCreatorAndRsvps['rsvps'][number] = {
            status: RSVPStatus.confirmed,
            attendanceEntitlementStatus: RSVPAttendanceEntitlementStatus.active,
            reminderPreferenceType: null,
            reminderOffsetMinutes: null,
            reminderScheduledAt: null,
            reminderSentAt: null,
            user: optimisticUser,
          };

          // Build optimistic event with updated RSVPs
          const nextRsvps = [
            ...prevEvent.rsvps.filter((r) => r.user.clerkId !== clerkUser!.id),
            optimisticRsvp,
          ];

          const nextConfirmedCount = nextRsvps.reduce(
            (acc, r) => acc + (isCurrentlyAttendingRsvp(r) ? 1 : 0),
            0
          );
          const optimisticFeatured = nextConfirmedCount >= FEATURED_THRESHOLD;

          const optimisticEvent: EventWithCreatorAndRsvps = {
            ...prevEvent,
            rsvps: nextRsvps,
            featured: optimisticFeatured,
          };

          // Immediately apply optimistic UI (toggle turns green, counts update)
          onEventUpdate?.(optimisticEvent);

          // Server reconciliation in transition
          startTransition(() => {
            reactivateAlreadyPaidRsvp(eventForMode.id)
              .then(async (reactivateResult) => {
                if (!reactivateResult.success) {
                  toast.error(reactivateResult.message, { id: PAID_REDIRECT_TOAST_ID });
                  // Rollback optimistic UI
                  onEventUpdate?.(prevEvent);
                  return;
                }

                if (reactivateResult.action !== 'reactivated' || !reactivateResult.updatedEvent) {
                  // Unexpected response
                  toast.error('Could not reactivate attendance.', { id: PAID_REDIRECT_TOAST_ID });
                  onEventUpdate?.(prevEvent);
                  return;
                }

                // Try to fetch authoritative, fully-hydrated event (with rsvps.user) from server
                try {
                  const bulk = await fetch('/api/events/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: [eventForMode.id], rsvpStatus: 'confirmed' }),
                  });
                  const jb = await bulk.json().catch(() => null);

                  let committedFinal: EventWithCreatorAndRsvps = {
                    ...optimisticEvent,
                    featured: reactivateResult.updatedEvent.featured,
                  };

                  if (bulk.ok && jb?.success && Array.isArray(jb.data) && jb.data.length) {
                    // Use authoritative event payload from server which includes full user profiles
                    committedFinal = jb.data[0] as EventWithCreatorAndRsvps;
                  }

                  // Commit to EventsContext using authoritative (or fallback) event
                  upsertEvents([committedFinal]);
                  onEventUpdate?.(committedFinal);

                  if (viewerStatusUserId) {
                    await revalidateViewerPaymentStatus({
                      mutate,
                      eventId: eventForMode.id,
                      userId: viewerStatusUserId,
                    });
                  }

                  await syncFeaturedChangeAndRevalidate({
                    prevFeatured,
                    nextFeatured: committedFinal.featured,
                    eventId: committedFinal.id,
                    emitFeaturedChange,
                    getFeaturedKeys,
                    getMainListKeys,
                    mutateDebounced,
                    isEventsListKey,
                  });

                  toast.success(reactivateResult.message, {
                    id: PAID_REDIRECT_TOAST_ID,
                    duration: 1000,
                  });
                } catch {
                  // If fetching the authoritative event fails, fall back to committing optimistic event
                  const committedFinal: EventWithCreatorAndRsvps = {
                    ...optimisticEvent,
                    featured: reactivateResult.updatedEvent.featured,
                  };
                  upsertEvents([committedFinal]);
                  onEventUpdate?.(committedFinal);

                  if (viewerStatusUserId) {
                    await revalidateViewerPaymentStatus({
                      mutate,
                      eventId: eventForMode.id,
                      userId: viewerStatusUserId,
                    });
                  }

                  await syncFeaturedChangeAndRevalidate({
                    prevFeatured,
                    nextFeatured: reactivateResult.updatedEvent.featured,
                    eventId: committedFinal.id,
                    emitFeaturedChange,
                    getFeaturedKeys,
                    getMainListKeys,
                    mutateDebounced,
                    isEventsListKey,
                  });
                  toast.success(reactivateResult.message, {
                    id: PAID_REDIRECT_TOAST_ID,
                    duration: 1000,
                  });
                }
              })
              .catch((err) => {
                console.error('[reactivate] error:', err);
                toast.error('Failed to restore attendance. Please try again.', {
                  id: PAID_REDIRECT_TOAST_ID,
                });
                // Rollback optimistic UI
                onEventUpdate?.(prevEvent);
              });
          });
          return;
        }

        // For ALREADY_PAID_ATTENDING, fetch authoritative event (user is already confirmed)
        try {
          const bulk = await fetch('/api/events/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [eventForMode.id], rsvpStatus: 'confirmed' }),
          });
          const jb = await bulk.json().catch(() => null);
          if (bulk.ok && jb?.success && Array.isArray(jb.data) && jb.data.length) {
            upsertEvents(jb.data);
          }
        } catch {
          // ignore fetch errors — fallback to global mutate
          mutateDebounced(
            getFeaturedKeys().concat(getMainListKeys()).filter(Boolean),
            isEventsListKey,
            50
          );
        } finally {
          if (viewerStatusUserId) {
            await revalidateViewerPaymentStatus({
              mutate,
              eventId: eventForMode.id,
              userId: viewerStatusUserId,
            }).catch(() => undefined);
          }

          if (prepareTimeoutRef.current) window.clearTimeout(prepareTimeoutRef.current);
          setIsPreparingCheckout(false);
          setPreparingCheckoutEventId(null);
          toast.success('Payment already recorded — you are registered for this event.', {
            id: PAID_REDIRECT_TOAST_ID,
          });
          return;
        }
      }
    } catch {
      if (prepareTimeoutRef.current) window.clearTimeout(prepareTimeoutRef.current);
      setIsPreparingCheckout(false);
      setPreparingCheckoutEventId(null);
      toast.error('Failed to prepare checkout. Please try again.', {
        id: PAID_REDIRECT_TOAST_ID,
      });
      return;
    }
  };

  /* -------------------------------------------------------------------- */
  /*  RSVP toggle (optimistic + server + lists + debounced revalidations) */
  /* -------------------------------------------------------------------- */
  const handleRsvpToggle = () => {
    if (!isSignedIn || !clerkUser) {
      return toast.error('Please sign in to attend events.');
    }
    if (mode !== 'non-editable' || !('rsvps' in live)) return;

    const eventForMode = live as EventWithCreatorAndRsvps;
    const clickJoinability = getEventJoinability({
      date: eventForMode.date,
      archivedAt: eventForMode.archivedAt,
    });
    if (!clickJoinability.isJoinable && !isCurrentUserAttending) {
      toast.error(clickJoinability.message);
      return;
    }

    if (!isCurrentUserAttending && eventForMode.isPaid && !isCreatorViewingOwnEvent) {
      // Paid RSVP flow — delegate to async handler
      preparePaidRsvp(eventForMode);
      return;
    }

    const toastId = toast.loading('Updating attendance...');

    const prevEvent = live as EventWithCreatorAndRsvps;
    const prevFeatured = Boolean(prevEvent.featured);

    // Reutilizamos el memo para conocer el estado previo
    const wasAttending = isCurrentUserAttending;

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
      currentUserRsvp?.user ??
      props.viewerUser ??
      creatorAsAvatar ?? {
        clerkId: clerkUser.id, // único dato confiable desde Clerk
        username: '',
        firstName: null,
        lastName: null,
        imageUrl: null,
        hasImage: false, // evita parpadeo hasta que llegue la DB
        role: UserRole.user,
      };

    // RSVP optimista (sin nombre/foto desde Clerk)
    const optimisticRsvp: EventWithCreatorAndRsvps['rsvps'][number] = {
      status: RSVPStatus.confirmed,
      attendanceEntitlementStatus: RSVPAttendanceEntitlementStatus.active,
      reminderPreferenceType: null,
      reminderOffsetMinutes: null,
      reminderScheduledAt: null,
      reminderSentAt: null,
      user: optimisticUser,
    };

    // Build next RSVPs
    const nextRsvps = wasAttending
      ? prevEvent.rsvps.filter(
          (r) => !(r.user.clerkId === clerkUser.id && isCurrentlyAttendingRsvp(r))
        )
      : [
          // limpiamos cualquier RSVP previo del mismo user (pending/cancelled) para evitar duplicados
          ...prevEvent.rsvps.filter((r) => r.user.clerkId !== clerkUser.id),
          optimisticRsvp,
        ];

    // Optimistic featured (respect admin)
    const nextConfirmedCount = nextRsvps.reduce(
      (acc, r) => acc + (isCurrentlyAttendingRsvp(r) ? 1 : 0),
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

    // Server roundtrip + reconciliation
    startTransition(() => {
      toggleRSVP(prevEvent.id)
        .then(async (data) => {
          if (!data?.success) {
            toast.error(data?.message || 'Could not update attendance.', { id: toastId });
            onEventUpdate?.(prevEvent); // rollback
            return;
          }

          // Reconcile with server data
          const baseEventAfterServer =
            data.action !== 'payment_required' && data.updatedEvent
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
              attendanceEntitlementStatus: r.attendanceEntitlementStatus ?? null,
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
              ...baseEventAfterServer.rsvps.filter((x) => x.user.clerkId !== serverRsvp.user.clerkId),
              serverRsvp,
            ];

            committedFinal = { ...baseEventAfterServer, rsvps: mergedRsvps };

            // Reminder toast
            setTimeout(() => {
              try {
                showReminderToast();
              } catch (e) {
                console.error(e);
              }
            }, 1800);
          } else if (data.action === 'cancelled') {
            const mergedRsvps = baseEventAfterServer.rsvps.filter((x) => x.user.clerkId !== data.userId);
            committedFinal = { ...baseEventAfterServer, rsvps: mergedRsvps };
            onRsvpCancelled?.(eventId);
          } else if (data.action === 'payment_required') {
            // Paid event detected during toggle — redirect to checkout flow
            // This is a safety fallback in case isPaid flag wasn't caught earlier
            try {
              setRsvpPending(data.eventId, clerkUser?.id ?? '', undefined);
            } catch (e) {
              console.error(e);
            }
            router.push(`/checkout/${data.eventId}`);
            return;
          }

          // Write entity to store
          upsertEvents([committedFinal]);
          onEventUpdate?.(committedFinal);

          await syncFeaturedChangeAndRevalidate({
            prevFeatured,
            nextFeatured: data.updatedEvent?.featured ?? committedFinal.featured,
            eventId: committedFinal.id,
            emitFeaturedChange,
            getFeaturedKeys,
            getMainListKeys,
            mutateDebounced,
            isEventsListKey,
          });

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
        <MenuReminderIntroToast
          onConfirm={() => {
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
          onCancel={() => {
            handleCancelReminder();
            toast.dismiss(t);
          }}
        />
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

    // Close the menu so the user can interact with the toast
    props.onOpenChange(false);
  };

  /* -------------------------------------------------------------------- */
  /*  Checkout overlay mount listener                                     */
  /* -------------------------------------------------------------------- */
  useCheckoutOpenFinalizer({
    checkoutOpenedEventName: CHECKOUT_OPENED_EVENT,
    isPreparingCheckout,
    preparingCheckoutEventId,
    prepareTimeoutRef,
    paidIntroStartRef,
    paidFinalizeRef,
    paidToastMinMs: PAID_TOAST_MIN_MS,
    paidRedirectToastId: PAID_REDIRECT_TOAST_ID,
    setIsPreparingCheckout,
    setPreparingCheckoutEventId,
    onOpenChange: props.onOpenChange,
  });

  /* -------------------------------------------------------------------- */
  /*  Render                                                              */
  /* -------------------------------------------------------------------- */
  const shouldShowTzBadgeEditable = mode === 'editable' && !areTzEquivalent;
  const shouldShowTzToggle = mode !== 'editable' && showTzToggle;
  const showTzHelp = shouldShowTzBadgeEditable || shouldShowTzToggle;
  const formattedEventDate = formatMenuEventDate({
    date: live.date,
    eventTz,
    viewerTz,
    mode,
    showTzToggle,
    viewEventTz,
    formatDate,
  });

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
        ) : viewMode === 'refund' ? (
          <motion.div
            key="refund"
            className="flex flex-col min-h-0"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.16, ease: 'easeInOut' }}
            style={{ willChange: 'opacity, transform' }}
          >
            <RefundMenuView
              eventId={eventId}
              isDesktop={isDesktop}
              onBack={() => setViewMode('view')}
              onAttendanceRevoked={onRsvpCancelled}
            />
          </motion.div>
        ) : (
          /* --- view mode --- */
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
              <MenuViewHeader
                isDesktop={isDesktop}
                title={live.title}
                isPaid={Boolean(live.isPaid)}
                eventStart={live.date}
                isEventArchived={isEventArchived}
                badgeState={badgeState}
              />

              {/* Body */}
              <div className="flex-1 min-h-0 py-2 md:py-3 px-4 xs4:px-5  ">
                {/* Description */}
                <MenuDescriptionBlock description={live.description} isDesktop={isDesktop} />

                {/* Meta (date/time + location + creator/contact) */}
                <div className="mb-4 border-t border-zinc-800 pt-4 font-sans">
                  <div className="flex items-center mb-3 gap-3 text-xs xs4:text-base xl:text-sm text-zinc-300">
                    <AnimatedIcon icon={CalendarAnimatedIcon} size={16} state="in" />

                    <div className="flex-1 min-w-0">
                      <span className="inline min-w-0">
                        <span data-testid="menu-event-date" className="whitespace-normal break-words">
                          {formattedEventDate}
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

                    {shouldShowTzBadgeEditable ? (
                      <div className="ml-auto flex flex-col items-end md:flex-row md:items-center md:gap-1">
                        <span className="text-2xs self-start ml-2 text-zinc-400 md:hidden">Timezone:</span>
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
                        {viewEventTz ? 'view in your timezone' : "view in event's timezone"}
                      </button>
                    ) : null}
                  </div>

                  <div className="flex items-start gap-3 text-zinc-300">
                    <AnimatedIcon icon={LocationAnimatedIcon} size={16} state="in" />
                    <div className="flex-1 min-w-0 relative">
                      {!isLocationOpen ? (
                        <p
                          ref={previewLocationRef}
                          title={live.location}
                          className={cn(
                            'text-xs xs4:text-sm whitespace-pre-wrap break-words hyphens-auto',
                            'line-clamp-2'
                          )}
                        >
                          {live.location}
                        </p>
                      ) : (
                        <ScrollArea
                          id="full-location"
                          aria-label="Full location"
                          className={cn(
                            'pr-3 relative overscroll-contain overflow-y-auto',
                            'max-h-12 xl:max-h-14 2xl:max-h-16',
                            '[&::-webkit-scrollbar]:w-1',
                            '[&::-webkit-scrollbar-track]:bg-transparent',
                            '[&::-webkit-scrollbar-thumb]:rounded-full',
                            '[&::-webkit-scrollbar-thumb]:bg-emerald-900',
                            '[&::-webkit-scrollbar-thumb:hover]:bg-emerald-600'
                          )}
                        >
                          <p className="text-xs xs4:text-sm whitespace-pre-wrap break-words hyphens-auto">
                            {live.location}
                          </p>
                        </ScrollArea>
                      )}

                      <p
                        ref={ghostLocationRef}
                        aria-hidden="true"
                        className={cn(
                          'absolute left-0 top-0 w-full pointer-events-none invisible',
                          'text-xs xs4:text-sm whitespace-pre-wrap break-words hyphens-auto'
                        )}
                      >
                        {live.location}
                      </p>

                      {canLocationExpand && (
                        <div className="mt-0.5 md:mt-1">
                          <button
                            onClick={() => setIsLocationOpen((v) => !v)}
                            className="text-emerald-500 hover:text-emerald-400 text-xs font-semibold underline-offset-2 hover:underline"
                            aria-expanded={isLocationOpen}
                            aria-controls="full-location"
                          >
                            {isLocationOpen ? 'Hide' : 'See more'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {mode === 'non-editable' && liveFull?.creator && (
                    <MenuCreatorContactRow
                      creator={liveFull.creator}
                      contactEmail={live.contactEmail}
                      contactPhone={live.contactPhone}
                      phoneApps={phoneApps}
                      phoneDigits={phoneDigits}
                      isOpen={isOpen}
                      isDesktop={isDesktop}
                      isMailHovered={isMailHovered}
                      isWhatsappHovered={isWhatsappHovered}
                      isTelegramHovered={isTelegramHovered}
                      onMailHoverChange={setIsMailHovered}
                      onWhatsappHoverChange={setIsWhatsappHovered}
                      onTelegramHoverChange={setIsTelegramHovered}
                    />
                  )}

                  {/* Ticket price (menu only) */}
                  <MenuTicketRow
                    isPaid={Boolean(live.isPaid)}
                    priceCents={live.priceCents}
                    currency={live.currency}
                    paidPopoverOpen={paidPopoverOpen}
                    onPaidPopoverOpenChange={setPaidPopoverOpen}
                    onRequestRefund={canOpenRefundView ? handleRequestRefund : undefined}
                    refundCtaState={refundCtaState}
                    refundBlockedMessage={refundBlockedMessage}
                    paymentStatus={viewerPaymentStatus}
                    isPaymentStatusLoading={isPaymentStatusLoading}
                    isSignedIn={Boolean(currentUserId)}
                    shouldShowTicketHistoryPill={shouldShowTicketHistoryPill}
                    paidTriggerLabel={paidTriggerLabel}
                    paidTriggerAriaLabel={paidTriggerAriaLabel}
                    isRefundedTicketHistory={isRefundedTicketHistory}
                  />

                </div>

                {/* Attendees */}
                <MenuAttendeesSection
                  confirmedAttendees={confirmedAttendees}
                  rsvpsAll={rsvpsAll}
                  isAttendeeListOpen={isAttendeeListOpen}
                  onAttendeeListOpenChange={setIsAttendeeListOpen}
                  mode={mode}
                />
              </div>

              {/* Footer (RSVP switch + reminder + manage) */}
              <div className="shrink-0 h-[67px] p-4 bg-zinc-900/50 border-t border-zinc-800 flex items-center justify-between gap-4">
                {/* Left: RSVP switch */}
                {mode === 'non-editable' && isUserLoaded && (
                  <div className="flex items-center space-x-3">
                    {(() => {
                      const isPaidCheckoutTarget =
                        mode === 'non-editable' &&
                        'rsvps' in live &&
                        !isCurrentUserAttending &&
                        !isCreatorViewingOwnEvent &&
                        Boolean((live as EventWithCreatorAndRsvps).isPaid);

                      const showPreparing =
                        isPreparingCheckout &&
                        preparingCheckoutEventId === eventId &&
                        isPaidCheckoutTarget;

                      return (
                        <>
                          <Switch
                            id={`rsvp-toggle-${eventId}`}
                            data-testid="rsvp-toggle"
                            checked={isCurrentUserAttending || showPreparing}
                            onCheckedChange={handleRsvpToggle}
                            disabled={isPending || showPreparing || !isSignedIn || isJoinActionBlocked}
                            className="data-[state=checked]:bg-emerald-600 data-[state=unchecked]:bg-zinc-700 cursor-pointer"
                          />
                          <Label
                            htmlFor={`rsvp-toggle-${eventId}`}
                            className="text-white font-medium select-none cursor-pointer"
                          >
                            {showPreparing
                              ? 'Preparing checkout...'
                              : isPending
                              ? 'Updating...'
                              : isCurrentUserAttending
                              ? 'You are Attending'
                              : isJoinActionBlocked
                              ? 'Event Closed'
                              : isPaidCheckoutTarget
                              ? 'Tap & Pay'
                              : 'Attend Event?'}
                          </Label>
                        </>
                      );
                    })()}
                  </div>
                )}

                {mode === 'editable' && <div />}

                {/* Right: reminders & manage */}
                <MenuFooterActionsRight
                  isCurrentUserAttending={isCurrentUserAttending}
                  currentUserRsvp={currentUserRsvp}
                  showReminderConfigToast={showReminderConfigToast}
                  isReminderBtnHovered={isReminderBtnHovered}
                  isChangeReminderHovered={isChangeReminderHovered}
                  onReminderBtnHoverChange={setIsReminderBtnHovered}
                  onChangeReminderHoverChange={setIsChangeReminderHovered}
                  isOpen={isOpen}
                  isDesktop={isDesktop}
                  canManage={canManage}
                  onEdit={() => setViewMode('edit')}
                  eventId={eventId}
                  onEventArchived={handleEventArchiveSuccess}
                />
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

function MenuViewModeBoundary({
  menuProps,
  isDesktop,
}: {
  menuProps: Props;
  isDesktop: boolean;
}) {
  const [viewMode, setViewMode] = useState<'view' | 'edit' | 'refund'>('view');

  // Reset inner view when closing (let the animation end)
  useEffect(() => {
    if (!menuProps.open) {
      const t = setTimeout(() => setViewMode('view'), 150);
      return () => clearTimeout(t);
    }
  }, [menuProps.open]);

  if (isDesktop) {
    return (
      <Dialog
        open={menuProps.open}
        onOpenChange={(next) => {
          document.documentElement.classList.toggle('dialog-open', next);
          menuProps.onOpenChange(next);
        }}
      >
        <DialogContent className="flex flex-col max-h-[97dvh] max-w-2xl [&_button]:cursor-pointer bg-black border-zinc-700 text-white p-0">
          <MenuContentWrapper
            {...menuProps}
            viewMode={viewMode}
            setViewMode={setViewMode}
            onOpenChange={menuProps.onOpenChange}
            isDesktop={isDesktop}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={menuProps.open} onOpenChange={menuProps.onOpenChange}>
      <DrawerContent
        className={cn(
          'bg-black border-zinc-700 text-white flex flex-col',
          'data-[vaul-drawer-direction=bottom]:max-h-[98dvh]'
        )}
      >
        <MenuContentWrapper
          {...menuProps}
          viewMode={viewMode}
          setViewMode={setViewMode}
          onOpenChange={menuProps.onOpenChange}
          isDesktop={isDesktop}
        />
      </DrawerContent>
    </Drawer>
  );
}

export default function Menu(props: Props) {
  const { open } = props; // <- expose `open` so effects can use it as before
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const menuEventId = 'event' in props ? props.event.id : props.eventId;

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

  return <MenuViewModeBoundary key={menuEventId} menuProps={props} isDesktop={isDesktop} />;
}
