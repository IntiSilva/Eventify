import { useEffect, useState } from 'react';
import { getMyRefundContextForEvent } from '@/app/(dashboard)/rsvp/actions';
import { useViewerPaymentStatus } from '@/lib/payments/useViewerPaymentStatus';
import { getPaidTriggerAriaLabel } from '../helpers/menuHelpers';

type MenuMode = 'editable' | 'non-editable';

type UseMenuRefundEntryStateParams = {
  eventId: string;
  mode: MenuMode;
  isOpen: boolean;
  isEventPaid: boolean;
  currentUserId: string | null;
  isCreatorViewingOwnEvent: boolean;
};

type RefundContextSuccess = Extract<
  Awaited<ReturnType<typeof getMyRefundContextForEvent>>,
  { success: true }
>;

type RefundEntryEligibility = {
  canRequest: RefundContextSuccess['data']['canRequest'];
  blockedMessage: RefundContextSuccess['data']['blockedMessage'];
};

export default function useMenuRefundEntryState({
  eventId,
  mode,
  isOpen,
  isEventPaid,
  currentUserId,
  isCreatorViewingOwnEvent,
}: UseMenuRefundEntryStateParams) {
  const [refundEntryEligibility, setRefundEntryEligibility] =
    useState<RefundEntryEligibility | null>(null);
  const [isRefundEligibilityLoading, setIsRefundEligibilityLoading] = useState(false);

  const shouldFetchPaidStatus =
    mode === 'non-editable' && isEventPaid && isOpen && !isCreatorViewingOwnEvent;

  const {
    data: viewerPaymentStatus,
    isLoading: isViewerPaymentStatusLoading,
    ticketState,
    hasTicketHistory,
    ticketHistoryPillLabel,
    userId: viewerStatusUserId,
  } = useViewerPaymentStatus(eventId, shouldFetchPaidStatus);

  const isPaidTicketState = ticketState === 'paid';
  const shouldPrimeRefundEligibility =
    mode === 'non-editable' && isOpen && isPaidTicketState && Boolean(currentUserId);

  useEffect(() => {
    let cancelled = false;

    if (!shouldPrimeRefundEligibility) {
      setRefundEntryEligibility(null);
      setIsRefundEligibilityLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsRefundEligibilityLoading(true);

    void (async () => {
      try {
        const result = await getMyRefundContextForEvent(eventId);
        if (cancelled) return;

        if (result.success) {
          setRefundEntryEligibility({
            canRequest: result.data.canRequest,
            blockedMessage: result.data.blockedMessage,
          });
          return;
        }

        setRefundEntryEligibility({
          canRequest: false,
          blockedMessage: result.message,
        });
      } catch {
        if (cancelled) return;
        setRefundEntryEligibility({
          canRequest: false,
          blockedMessage: "Couldn't check refund availability right now.",
        });
      } finally {
        if (!cancelled) {
          setIsRefundEligibilityLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, shouldPrimeRefundEligibility]);

  const isRefundEligibilityPending =
    shouldPrimeRefundEligibility &&
    (isRefundEligibilityLoading || refundEntryEligibility === null);

  const isViewerPaymentStatusPending =
    shouldFetchPaidStatus && isViewerPaymentStatusLoading && !viewerPaymentStatus;

  const refundCtaState: 'loading' | 'available' | 'unavailable' = !currentUserId
    ? 'unavailable'
    : isViewerPaymentStatusPending
    ? 'loading'
    : isPaidTicketState
    ? isRefundEligibilityPending
      ? 'loading'
      : refundEntryEligibility?.canRequest
      ? 'available'
      : 'unavailable'
    : 'unavailable';

  const refundBlockedMessage =
    isPaidTicketState && refundCtaState === 'unavailable'
      ? refundEntryEligibility?.blockedMessage ?? null
      : null;

  const canOpenRefundView = refundCtaState === 'available';

  const shouldShowTicketHistoryPill =
    mode === 'non-editable' &&
    isEventPaid &&
    hasTicketHistory &&
    Boolean(ticketHistoryPillLabel);

  const paidTriggerLabel = ticketHistoryPillLabel;
  const paidTriggerAriaLabel = getPaidTriggerAriaLabel(ticketHistoryPillLabel);
  const isRefundedTicketHistory = ticketHistoryPillLabel === 'Refunded';

  const isPaymentStatusLoading = Boolean(shouldFetchPaidStatus && isViewerPaymentStatusLoading);

  return {
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
  };
}
