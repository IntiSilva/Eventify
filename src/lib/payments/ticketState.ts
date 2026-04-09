import 'server-only';

import { RefundRequestStatus } from '@/generated/prisma';
import { stripe } from '@/lib/stripe';
import { evaluateIsFullRefund } from '@/lib/payments/rsvpEntitlement';
import type { ViewerTicketState } from '@/types/payments/stripe';

type RefundRequestSnapshot =
  | {
      status: RefundRequestStatus;
      stripeRefundId: string | null;
    }
  | null
  | undefined;

export type SucceededPaymentTicketStateInput = {
  paymentId: string;
  amountCents: number;
  refundRequest: RefundRequestSnapshot;
};

export function getTicketStateWithoutStripeLookup(
  refundRequest: RefundRequestSnapshot
): Exclude<ViewerTicketState, 'none' | 'refunded'> | null {
  if (!refundRequest) return 'paid';

  switch (refundRequest.status) {
    case RefundRequestStatus.requested:
    case RefundRequestStatus.approved:
    case RefundRequestStatus.processing:
      return 'refund_pending';
    case RefundRequestStatus.failed:
    case RefundRequestStatus.rejected:
    case RefundRequestStatus.canceled:
      return 'paid';
    case RefundRequestStatus.succeeded:
      return null;
    default:
      return 'paid';
  }
}

export async function resolveTicketStateForSucceededPayment(
  input: SucceededPaymentTicketStateInput
): Promise<Exclude<ViewerTicketState, 'none'>> {
  const simpleState = getTicketStateWithoutStripeLookup(input.refundRequest);
  if (simpleState) return simpleState;

  if (!input.refundRequest?.stripeRefundId) {
    return 'paid';
  }

  try {
    const stripeRefund = await stripe.refunds.retrieve(input.refundRequest.stripeRefundId);
    const isFullRefund = evaluateIsFullRefund({
      refundAmountCents: stripeRefund.amount,
      paymentAmountCents: input.amountCents,
    });
    return isFullRefund === true ? 'refunded' : 'paid';
  } catch (error) {
    console.warn(
      `[ticket-state] failed to retrieve refund ${input.refundRequest.stripeRefundId} for payment ${input.paymentId}`,
      error
    );
    return 'paid';
  }
}
