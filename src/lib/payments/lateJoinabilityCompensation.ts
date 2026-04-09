import 'server-only';

import type Stripe from 'stripe';
import {
  PaymentPayoutTarget,
  PaymentStatus,
  RefundRequestStatus,
  RefundRequestSource,
} from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import {
  mapStripeRefundStatusToRefundRequestStatus,
  syncRefundRequestFromStripeRefund,
} from '@/lib/payments/refunds';
import {
  evaluateIsFullRefund,
  syncRsvpAttendanceEntitlementFromRefundStatus,
} from '@/lib/payments/rsvpEntitlement';

const AUTO_COMPENSATION_REASON =
  'Automatic refund: payment completed after the event stopped accepting new attendance.';
const AUTO_COMPENSATION_NOTE = 'AUTO_COMPENSATION_EVENT_NOT_JOINABLE';

type PaymentForCompensation = {
  id: string;
  userId: string;
  status: PaymentStatus;
  amountCents: number;
  stripeChargeId: string | null;
  stripePaymentIntentId: string;
  payoutTarget: PaymentPayoutTarget;
  refundRequest: {
    id: string;
    status: RefundRequestStatus;
    stripeRefundId: string | null;
    reason: string | null;
  } | null;
};

function sanitizeErrorMessage(error: unknown, fallback: string): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : fallback;
  const normalized = raw.trim();
  return (normalized.length > 0 ? normalized : fallback).slice(0, 1000);
}

function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id;
  }
  return null;
}

async function resolveRefundChargeId(payment: PaymentForCompensation): Promise<string | null> {
  if (payment.stripeChargeId) {
    return payment.stripeChargeId;
  }

  try {
    const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId, {
      expand: ['latest_charge'],
    });

    return stripeObjectId(
      intent.latest_charge as string | { id: string } | null | undefined
    );
  } catch (error) {
    console.error(
      `[payment-compensation] failed to retrieve payment intent ${payment.stripePaymentIntentId} while resolving charge for payment ${payment.id}`,
      error
    );
    return null;
  }
}

async function markCompensationFailed(
  refundRequestId: string,
  paymentId: string,
  error: unknown
): Promise<void> {
  try {
    await prisma.refundRequest.updateMany({
      where: {
        id: refundRequestId,
        status: { not: RefundRequestStatus.succeeded },
      },
      data: {
        status: RefundRequestStatus.failed,
        lastError: sanitizeErrorMessage(
          error,
          'Automatic compensation refund failed and requires manual review.'
        ),
      },
    });
    await syncRsvpAttendanceEntitlementFromRefundStatus({
      paymentId,
      refundStatus: RefundRequestStatus.failed,
    });
  } catch (markError) {
    console.error(
      `[payment-compensation] failed to mark refund request ${refundRequestId} as failed`,
      markError
    );
  }
}

type PreparedCompensation =
  | {
      kind: 'already-in-progress-or-complete';
      refundRequestId: string;
      status: RefundRequestStatus;
      stripeRefundId: string | null;
    }
  | {
      kind: 'ready';
      refundRequestId: string;
    };

function isAlreadyCompensatingOrDone(status: RefundRequestStatus, stripeRefundId: string | null): boolean {
  if (stripeRefundId) return true;
  return status === RefundRequestStatus.processing || status === RefundRequestStatus.succeeded;
}

async function claimExistingRefundRequest(
  payment: PaymentForCompensation,
  attemptedAt: Date
): Promise<PreparedCompensation> {
  if (!payment.refundRequest) {
    throw new Error('Missing refund request while claiming compensation.');
  }

  if (
    isAlreadyCompensatingOrDone(
      payment.refundRequest.status,
      payment.refundRequest.stripeRefundId
    )
  ) {
    return {
      kind: 'already-in-progress-or-complete',
      refundRequestId: payment.refundRequest.id,
      status: payment.refundRequest.status,
      stripeRefundId: payment.refundRequest.stripeRefundId,
    };
  }

  const retryableStatuses: RefundRequestStatus[] = [
    RefundRequestStatus.requested,
    RefundRequestStatus.failed,
    RefundRequestStatus.rejected,
    RefundRequestStatus.canceled,
    RefundRequestStatus.approved,
  ];

  const claimResult = await prisma.refundRequest.updateMany({
    where: {
      id: payment.refundRequest.id,
      status: { in: retryableStatuses },
    },
    data: {
      source: RefundRequestSource.SYSTEM_COMPENSATION,
      status: RefundRequestStatus.processing,
      reason: payment.refundRequest.reason ?? AUTO_COMPENSATION_REASON,
      decisionNote: AUTO_COMPENSATION_NOTE,
      decidedAt: attemptedAt,
      attemptCount: { increment: 1 },
      lastAttemptAt: attemptedAt,
      lastError: null,
    },
  });

  if (claimResult.count > 0) {
    await syncRsvpAttendanceEntitlementFromRefundStatus({
      paymentId: payment.id,
      refundStatus: RefundRequestStatus.processing,
    });
    return { kind: 'ready', refundRequestId: payment.refundRequest.id };
  }

  const current = await prisma.refundRequest.findUnique({
    where: { id: payment.refundRequest.id },
    select: {
      id: true,
      status: true,
      stripeRefundId: true,
    },
  });

  if (current && isAlreadyCompensatingOrDone(current.status, current.stripeRefundId)) {
    return {
      kind: 'already-in-progress-or-complete',
      refundRequestId: current.id,
      status: current.status,
      stripeRefundId: current.stripeRefundId,
    };
  }

  throw new Error('Unable to claim compensation refund request for processing.');
}

async function prepareCompensation(
  payment: PaymentForCompensation,
  attemptedAt: Date
): Promise<PreparedCompensation> {
  if (payment.refundRequest) {
    return claimExistingRefundRequest(payment, attemptedAt);
  }

  try {
    const created = await prisma.refundRequest.create({
      data: {
        paymentId: payment.id,
        requestedByUserId: payment.userId,
        source: RefundRequestSource.SYSTEM_COMPENSATION,
        reason: AUTO_COMPENSATION_REASON,
        status: RefundRequestStatus.processing,
        decisionNote: AUTO_COMPENSATION_NOTE,
        decidedAt: attemptedAt,
        attemptCount: 1,
        lastAttemptAt: attemptedAt,
        lastError: null,
      },
      select: {
        id: true,
      },
    });
    await syncRsvpAttendanceEntitlementFromRefundStatus({
      paymentId: payment.id,
      refundStatus: RefundRequestStatus.processing,
    });
    return { kind: 'ready', refundRequestId: created.id };
  } catch (error) {
    console.error(
      `[payment-compensation] failed to create compensation refund request for payment ${payment.id}; attempting to reuse existing row`,
      error
    );

    const current = await prisma.refundRequest.findUnique({
      where: { paymentId: payment.id },
      select: {
        id: true,
        status: true,
        stripeRefundId: true,
        reason: true,
      },
    });

    if (!current) {
      throw new Error('Unable to create or recover compensation refund request.');
    }

    return claimExistingRefundRequest(
      {
        ...payment,
        refundRequest: {
          id: current.id,
          status: current.status,
          stripeRefundId: current.stripeRefundId,
          reason: current.reason,
        },
      },
      attemptedAt
    );
  }
}

export async function initiateLateJoinabilityCompensation(
  paymentId: string
): Promise<{
  status: 'already-handled' | 'refund-processing' | 'refund-succeeded';
  refundRequestId: string;
  stripeRefundId: string | null;
}> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      userId: true,
      status: true,
      amountCents: true,
      stripeChargeId: true,
      stripePaymentIntentId: true,
      payoutTarget: true,
      refundRequest: {
        select: {
          id: true,
          status: true,
          stripeRefundId: true,
          reason: true,
        },
      },
    },
  });

  if (!payment) {
    throw new Error(`Payment ${paymentId} not found for late-joinability compensation.`);
  }

  if (payment.status !== PaymentStatus.succeeded) {
    throw new Error(
      `Payment ${payment.id} is not succeeded (status=${payment.status}) and cannot be compensated yet.`
    );
  }

  const attemptedAt = new Date();
  const prepared = await prepareCompensation(payment, attemptedAt);
  if (prepared.kind === 'already-in-progress-or-complete') {
    return {
      status: 'already-handled',
      refundRequestId: prepared.refundRequestId,
      stripeRefundId: prepared.stripeRefundId,
    };
  }

  const chargeId = await resolveRefundChargeId(payment);
  if (!chargeId) {
    await markCompensationFailed(
      prepared.refundRequestId,
      payment.id,
      'Unable to resolve Stripe charge for automatic compensation refund.'
    );
    throw new Error(
      `Unable to resolve Stripe charge for compensation refund request ${prepared.refundRequestId}.`
    );
  }

  try {
    const refundParams: Stripe.RefundCreateParams = {
      charge: chargeId,
      reason: 'requested_by_customer',
    };

    if (payment.payoutTarget === PaymentPayoutTarget.organizer) {
      refundParams.reverse_transfer = true;
      refundParams.refund_application_fee = true;
    }

    const stripeRefund = await stripe.refunds.create(refundParams, {
      idempotencyKey: `late-joinability:${payment.id}`,
    });

    const mappedStatus = mapStripeRefundStatusToRefundRequestStatus(stripeRefund.status);
    const isFailureStatus =
      mappedStatus === RefundRequestStatus.failed || mappedStatus === RefundRequestStatus.canceled;

    await prisma.refundRequest.update({
      where: { id: prepared.refundRequestId },
      data: {
        stripeRefundId: stripeRefund.id,
        status: isFailureStatus ? RefundRequestStatus.failed : mappedStatus,
        lastError: isFailureStatus
          ? `Stripe returned refund status "${stripeRefund.status ?? 'unknown'}".`
          : null,
      },
    });

    const resolvedStatus = isFailureStatus ? RefundRequestStatus.failed : mappedStatus;
    const isFullRefund = evaluateIsFullRefund({
      refundAmountCents: stripeRefund.amount,
      paymentAmountCents: payment.amountCents,
    });
    await syncRsvpAttendanceEntitlementFromRefundStatus({
      paymentId: payment.id,
      refundStatus: resolvedStatus,
      isFullRefund,
    });

    if (mappedStatus === RefundRequestStatus.succeeded) {
      try {
        await syncRefundRequestFromStripeRefund(stripeRefund);
      } catch (error) {
        console.error(
          `[payment-compensation] refund sync fallback failed for request ${prepared.refundRequestId}`,
          error
        );
      }
    }

    if (isFailureStatus) {
      throw new Error(
        `Stripe returned non-success refund status "${stripeRefund.status ?? 'unknown'}".`
      );
    }

    return {
      status:
        mappedStatus === RefundRequestStatus.succeeded
          ? 'refund-succeeded'
          : 'refund-processing',
      refundRequestId: prepared.refundRequestId,
      stripeRefundId: stripeRefund.id,
    };
  } catch (error) {
    await markCompensationFailed(prepared.refundRequestId, payment.id, error);
    throw error;
  }
}
