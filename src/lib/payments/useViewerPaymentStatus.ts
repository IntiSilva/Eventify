'use client';

import { useUser } from '@clerk/nextjs';
import useSWR from 'swr';
import type { ViewerTicketState } from '@/types/payments/stripe';

export type ViewerPaymentStatusResponse = {
  eventId: string;
  ticketState: ViewerTicketState;
  alreadyPaid: boolean;
  payment?: {
    amountCents: number;
    currency: string;
    paidAt: string;
    payoutTarget?: 'platform' | 'organizer';
    destinationAccountId?: string | null;
  };
};

export type TicketHistoryPillLabel = 'Paid' | 'Refunded';

export function hasViewerTicketHistory(ticketState: ViewerTicketState | null | undefined): boolean {
  return (
    ticketState === 'paid' ||
    ticketState === 'refund_pending' ||
    ticketState === 'refunded'
  );
}

export function getTicketHistoryPillLabel(
  ticketState: ViewerTicketState | null | undefined
): TicketHistoryPillLabel | null {
  if (ticketState === 'refunded') {
    return 'Refunded';
  }

  if (ticketState === 'paid' || ticketState === 'refund_pending') {
    return 'Paid';
  }

  return null;
}

const fetchViewerPaymentStatus = async (
  [, eventId]: readonly [string, string, string]
): Promise<ViewerPaymentStatusResponse> => {
  const res = await fetch(`/api/payments/viewer-status?eventId=${encodeURIComponent(eventId)}`, {
    cache: 'no-store',
    credentials: 'include',
  });
  const json = (await res.json()) as ViewerPaymentStatusResponse | { error?: string };

  if (!res.ok) {
    throw new Error(('error' in json && json.error) || `HTTP ${res.status}`);
  }

  return json as ViewerPaymentStatusResponse;
};

export function useViewerPaymentStatus(eventId: string | null | undefined, enabled: boolean) {
  const { user } = useUser();
  const userId = user?.id ?? null;

  const swr = useSWR<ViewerPaymentStatusResponse>(
    enabled && eventId && userId ? (['/api/payments/viewer-status', eventId, userId] as const) : null,
    fetchViewerPaymentStatus,
    {
      revalidateOnMount: true,
      revalidateIfStale: true,
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
    }
  );

  const ticketState = swr.data?.ticketState ?? 'none';

  return {
    ...swr,
    ticketState,
    hasTicketHistory: hasViewerTicketHistory(ticketState),
    ticketHistoryPillLabel: getTicketHistoryPillLabel(ticketState),
    userId,
    isSignedIn: Boolean(userId),
  };
}

