'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useUser } from '@clerk/nextjs';
import { useSWRConfig } from 'swr';
import { RefundRequestStatus } from '@/generated/prisma';
import { useStoreWriters } from '@/contexts/EventsContext';
import {
  getMyRefundContextForEvent,
  requestRefund,
} from '@/app/(dashboard)/rsvp/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { revalidateAfterCheckout } from '@/lib/payments/revalidateAfterCheckout';
import { isCurrentlyAttendingRsvp } from '@/lib/rsvpAttendance';
import type { EventByIdResponse } from '@/types/api';
import type { EventWithCreatorAndRsvps } from '@/types/event';

type RefundContextSuccess = Extract<
  Awaited<ReturnType<typeof getMyRefundContextForEvent>>,
  { success: true }
>;

type RefundContextData = RefundContextSuccess['data'];
type RefundBlockedReason = Exclude<RefundContextData['blockedReason'], null>;

type RefundMenuViewProps = {
  eventId: string;
  isDesktop: boolean;
  onBack: () => void;
  onAttendanceRevoked?: (eventId: string) => void;
};

const BACK_BUTTON_CLASS_NAME =
  'h-8 rounded-lg border border-transparent bg-transparent px-2.5 text-zinc-300 transition-colors hover:border-zinc-700/70 hover:bg-zinc-900/60 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-600/40 focus-visible:ring-offset-0 active:bg-zinc-900/70';

const MODAL_REFUND_CTA_CLASS_NAME =
  'h-8 rounded-[0.7rem] border border-rose-700/60 bg-rose-950/30 px-3.5 text-rose-100 shadow-[0_0_0_1px_rgba(244,63,94,0.08),0_10px_24px_rgba(76,5,25,0.3)] transition-colors duration-200 hover:border-rose-500/60 hover:bg-rose-900/35 hover:text-rose-50 focus-visible:ring-2 focus-visible:ring-rose-600/35 focus-visible:ring-offset-0 active:bg-rose-900/45 disabled:opacity-60 disabled:hover:border-rose-700/60 disabled:hover:bg-rose-950/30';

function formatRefundStatus(status: RefundRequestStatus): string {
  switch (status) {
    case RefundRequestStatus.requested:
      return 'Requested';
    case RefundRequestStatus.processing:
      return 'Processing';
    case RefundRequestStatus.succeeded:
      return 'Succeeded';
    case RefundRequestStatus.failed:
      return 'Failed';
    case RefundRequestStatus.rejected:
      return 'Rejected';
    case RefundRequestStatus.canceled:
      return 'Canceled';
    case RefundRequestStatus.approved:
      return 'Approved';
    default:
      return status;
  }
}

function getRefundStatusCopy(status: RefundRequestStatus): string | null {
  switch (status) {
    case RefundRequestStatus.requested:
      return 'Waiting for organizer approval.';
    case RefundRequestStatus.processing:
      return 'Refund in progress.';
    case RefundRequestStatus.failed:
      return 'The refund could not be completed. Please contact support or the organizer.';
    case RefundRequestStatus.rejected:
      return 'This refund request was rejected.';
    case RefundRequestStatus.canceled:
      return 'This refund request was canceled.';
    case RefundRequestStatus.succeeded:
      return 'Your refund has been completed.';
    case RefundRequestStatus.approved:
      return 'This refund is approved and will be processed shortly.';
    default:
      return null;
  }
}

function getRefundStatusClassName(status: RefundRequestStatus): string {
  switch (status) {
    case RefundRequestStatus.succeeded:
      return 'border-emerald-700/70 bg-emerald-950/40 text-emerald-300';
    case RefundRequestStatus.failed:
    case RefundRequestStatus.rejected:
    case RefundRequestStatus.canceled:
      return 'border-rose-700/70 bg-rose-950/40 text-rose-300';
    case RefundRequestStatus.processing:
    case RefundRequestStatus.approved:
      return 'border-amber-700/70 bg-amber-950/40 text-amber-300';
    case RefundRequestStatus.requested:
    default:
      return 'border-sky-700/70 bg-sky-950/40 text-sky-300';
  }
}

function getBlockedReasonCopy(reason: RefundBlockedReason): string {
  switch (reason) {
    case 'NO_PAYMENT':
      return 'No completed payment was found for your account on this event.';
    case 'EVENT_STARTED':
      return 'This event has already started, so refund requests are closed.';
    case 'CUTOFF':
      return 'The refund request window has closed for this ticket.';
    case 'UNKNOWN':
    default:
      return 'Refund eligibility could not be determined right now.';
  }
}

function formatRequestedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return parsed.toLocaleString();
}

function RefundContextLoadingState() {
  return (
    <div className="space-y-4" aria-live="polite" aria-busy="true">
      <p className="sr-only">Loading refund details...</p>

      <div className="space-y-1.5">
        <div className="h-4 w-28 rounded bg-zinc-800/70 animate-pulse" />
        <div className="min-h-24 rounded-md border border-zinc-800 bg-black/40 p-3">
          <div className="h-4 w-[72%] rounded bg-zinc-800/70 animate-pulse" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="h-3 w-10 rounded bg-zinc-800/65 animate-pulse" />
        <Button
          type="button"
          size="sm"
          disabled
          aria-hidden
          tabIndex={-1}
          className={cn(
            MODAL_REFUND_CTA_CLASS_NAME,
            'pointer-events-none cursor-default text-transparent shadow-none'
          )}
        >
          Request refund
        </Button>
      </div>
    </div>
  );
}

export default function RefundMenuView({
  eventId,
  isDesktop,
  onBack,
  onAttendanceRevoked,
}: RefundMenuViewProps) {
  const { user } = useUser();
  const { mutate } = useSWRConfig();
  const { upsertEvents } = useStoreWriters();
  const viewerStatusUserId = user?.id ?? null;
  const [context, setContext] = useState<RefundContextData | null>(null);
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, startSubmitTransition] = useTransition();

  const loadContext = useCallback(
    async (options?: { showErrorToast?: boolean; asRefresh?: boolean }) => {
      if (options?.asRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        const result = await getMyRefundContextForEvent(eventId);
        if (result.success) {
          setContext(result.data);
          setLoadError(null);
        } else {
          setContext(null);
          setLoadError(result.message);
          if (options?.showErrorToast) {
            toast.error(result.message);
          }
        }
      } catch {
        const message = "Couldn't load refund status.";
        setContext(null);
        setLoadError(message);
        if (options?.showErrorToast) {
          toast.error(message);
        }
      } finally {
        if (options?.asRefresh) {
          setIsRefreshing(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [eventId]
  );

  useEffect(() => {
    void loadContext({ showErrorToast: true });
  }, [loadContext]);

  const handleRefresh = () => {
    void loadContext({ asRefresh: true, showErrorToast: true });
  };

  const refreshEventAttendanceSurfaces = useCallback(async (): Promise<boolean | null> => {
    try {
      const res = await fetch(`/api/events/${eventId}?rsvpStatus=confirmed`, {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!res.ok) return null;

      const payload = (await res.json()) as EventByIdResponse;
      if (!payload.success || !payload.data) return null;

      const updatedEvent = payload.data as EventWithCreatorAndRsvps;
      upsertEvents([updatedEvent]);

      if (!viewerStatusUserId) return null;
      const viewerRsvp = updatedEvent.rsvps.find((rsvp) => rsvp.user.clerkId === viewerStatusUserId);
      return viewerRsvp ? isCurrentlyAttendingRsvp(viewerRsvp) : false;
    } catch {
      return null;
    }
  }, [eventId, upsertEvents, viewerStatusUserId]);

  const handleRequestRefund = () => {
    const paymentId = context?.paymentId;
    if (!paymentId) return;

    startSubmitTransition(() => {
      void (async () => {
        const normalizedReason = reason.trim();
        const result = await requestRefund(
          paymentId,
          normalizedReason.length > 0 ? normalizedReason : null
        );

        if (!result.success) {
          await loadContext();
          toast.error(result.message);
          return;
        }

        const [, , isViewerCurrentlyAttending] = await Promise.all([
          loadContext(),
          viewerStatusUserId
            ? revalidateAfterCheckout({
                mutate,
                eventId,
                userId: viewerStatusUserId,
              })
            : Promise.resolve(),
          refreshEventAttendanceSurfaces(),
        ]);

        if (isViewerCurrentlyAttending === false) {
          onAttendanceRevoked?.(eventId);
        }

        setReason('');
        toast.success(result.message);
      })();
    });
  };

  const refundRequest = context?.refundRequest ?? null;
  const helperCopy = refundRequest ? getRefundStatusCopy(refundRequest.status) : null;
  const isRefreshDisabled = isLoading || isRefreshing;

  return (
    <div className="flex flex-col min-h-0">
      {isDesktop ? (
        <DialogHeader className="p-6 pb-4 shrink-0 text-left border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onBack}
              className={BACK_BUTTON_CLASS_NAME}
            >
              <ArrowLeft className="size-4" />
              <span>Back</span>
            </Button>
            <DialogTitle className="text-2xl font-bold font-heading text-emerald-500">
              Refund
            </DialogTitle>
          </div>
        </DialogHeader>
      ) : (
        <DrawerHeader className="p-6 pb-4 shrink-0 text-left border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onBack}
              className={BACK_BUTTON_CLASS_NAME}
            >
              <ArrowLeft className="size-4" />
              <span>Back</span>
            </Button>
            <DrawerTitle className="text-2xl font-bold font-heading text-emerald-500">
              Refund
            </DrawerTitle>
          </div>
        </DrawerHeader>
      )}

      <div
        className={cn(
          'flex-1 min-h-0 overflow-y-auto',
          '[&::-webkit-scrollbar]:w-1',
          '[&::-webkit-scrollbar-track]:bg-transparent',
          '[&::-webkit-scrollbar-thumb]:rounded-full',
          '[&::-webkit-scrollbar-thumb]:bg-emerald-900',
          '[&::-webkit-scrollbar-thumb:hover]:bg-emerald-500'
        )}
      >
        <div className="p-4 xs4:p-5 md:p-6">
          <div className="min-h-[16rem] rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-zinc-100">Request a refund</p>
                <p className="text-xs text-zinc-400">
                  Request a refund for your paid ticket. An organizer or admin must approve it.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {refundRequest ? (
                  <Badge
                    variant="outline"
                    className={cn(
                      'border px-2 py-0.5 text-[11px]',
                      getRefundStatusClassName(refundRequest.status)
                    )}
                  >
                    {formatRefundStatus(refundRequest.status)}
                  </Badge>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleRefresh}
                  disabled={isRefreshDisabled}
                  className="h-7 rounded-md border border-transparent bg-transparent px-2 text-[11px] text-zinc-400 hover:border-zinc-700/70 hover:bg-zinc-900/55 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-600/35 focus-visible:ring-offset-0"
                >
                  {isRefreshing ? 'Refreshing...' : 'Refresh'}
                </Button>
              </div>
            </div>

            <div className="mt-4 min-h-[13.75rem]">
              {isLoading ? (
                <RefundContextLoadingState />
              ) : loadError ? (
                <div className="space-y-3">
                  <p className="text-sm text-zinc-300">{loadError}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleRefresh}
                    disabled={isRefreshDisabled}
                    className="border-zinc-700 bg-zinc-900/60 text-xs text-zinc-200 hover:bg-zinc-800"
                  >
                    {isRefreshing ? 'Refreshing...' : 'Retry'}
                  </Button>
                </div>
              ) : refundRequest ? (
                <div className="space-y-2 text-sm text-zinc-300">
                  <p className="text-zinc-400">
                    Requested on {formatRequestedAt(refundRequest.createdAt)}
                  </p>
                  {refundRequest.reason ? (
                    <p className="leading-relaxed">
                      Reason:{' '}
                      <span className="text-zinc-200">{refundRequest.reason}</span>
                    </p>
                  ) : null}
                  {helperCopy ? <p className="text-zinc-400">{helperCopy}</p> : null}
                </div>
              ) : context?.canRequest ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`refund-reason-${eventId}`}
                      className="text-xs font-medium text-zinc-300"
                    >
                      Reason (optional)
                    </label>
                    <Textarea
                      id={`refund-reason-${eventId}`}
                      value={reason}
                      onChange={(event) => setReason(event.target.value.slice(0, 500))}
                      maxLength={500}
                      placeholder="Tell the organizer anything they should know."
                      className="min-h-24 border-zinc-800 bg-black/40 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-emerald-600/50"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] text-zinc-500">{reason.length}/500</p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleRequestRefund}
                      disabled={isSubmitting}
                      className={MODAL_REFUND_CTA_CLASS_NAME}
                    >
                      {isSubmitting ? 'Submitting...' : 'Request refund'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 rounded-lg border border-zinc-800 bg-black/20 p-4 text-sm text-zinc-300">
                  <p className="font-medium text-zinc-100">Refunds are not available right now</p>
                  <p className="text-zinc-400">
                    {getBlockedReasonCopy(context?.blockedReason ?? 'UNKNOWN')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

