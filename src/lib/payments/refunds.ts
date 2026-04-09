import 'server-only';

import type Stripe from 'stripe';
import { RefundRequestStatus } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import { sendRefundConfirmationEmailIfNeeded } from '@/lib/payments/refundEmail';
import {
  evaluateIsFullRefund,
  syncRsvpAttendanceEntitlementFromRefundStatus,
} from '@/lib/payments/rsvpEntitlement';

export function mapStripeRefundStatusToRefundRequestStatus(
  status: Stripe.Refund['status'] | null | undefined
): RefundRequestStatus {
  switch (status) {
    case 'succeeded':
      return RefundRequestStatus.succeeded;
    case 'failed':
      return RefundRequestStatus.failed;
    case 'canceled':
      return RefundRequestStatus.canceled;
    case 'pending':
    case 'requires_action':
    default:
      return RefundRequestStatus.processing;
  }
}

export async function syncRefundRequestFromStripeRefund(refund: Stripe.Refund): Promise<void> {
  const freshRefund = await stripe.refunds.retrieve(refund.id);
  const nextStatus = mapStripeRefundStatusToRefundRequestStatus(freshRefund.status);
  const cardDestinationDetails = freshRefund.destination_details?.card;
  const result = await prisma.refundRequest.updateMany({
    where: { stripeRefundId: freshRefund.id },
    data: {
      status: nextStatus,
      refundReference: cardDestinationDetails?.reference ?? null,
      refundReferenceType: cardDestinationDetails?.reference_type ?? null,
      refundReferenceStatus: cardDestinationDetails?.reference_status ?? null,
      ...(nextStatus === RefundRequestStatus.succeeded
        ? { refundSucceededAt: new Date() }
        : {}),
    },
  });

  if (result.count === 0) {
    console.warn(
      `[refund-webhook] no refund request found for Stripe refund ${freshRefund.id} (status=${freshRefund.status ?? 'unknown'})`
    );
    return;
  }

  const refundRequest = await prisma.refundRequest.findUnique({
    where: { stripeRefundId: freshRefund.id },
    select: {
      id: true,
      paymentId: true,
      payment: {
        select: {
          amountCents: true,
        },
      },
    },
  });

  if (!refundRequest) {
    console.warn(
      `[refund-webhook] refund request ${freshRefund.id} was updated but could not be reloaded`
    );
    return;
  }

  const isFullRefund = evaluateIsFullRefund({
    refundAmountCents: freshRefund.amount,
    paymentAmountCents: refundRequest.payment.amountCents,
  });

  try {
    await syncRsvpAttendanceEntitlementFromRefundStatus({
      paymentId: refundRequest.paymentId,
      refundStatus: nextStatus,
      isFullRefund,
    });
  } catch (error) {
    console.error(
      `[refund-webhook] failed to sync RSVP entitlement for payment ${refundRequest.paymentId} (status=${nextStatus})`,
      error
    );
  }

  if (nextStatus !== RefundRequestStatus.succeeded) {
    return;
  }

  await sendRefundConfirmationEmailIfNeeded(refundRequest.id);
}
