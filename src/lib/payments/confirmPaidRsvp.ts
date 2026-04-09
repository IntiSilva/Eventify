import type Stripe from 'stripe';
import {
  PaymentPayoutTarget,
  PaymentStatus,
  RSVPAttendanceEntitlementStatus,
  RSVPStatus,
} from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import { computeAutoFeatured } from '@/lib/constants';
import { sendTicketPurchaseConfirmationEmailIfNeeded } from '@/lib/payments/ticketPurchaseEmail';
import { getEventJoinability, type EventJoinabilityBlockedReason } from '@/lib/events/joinability';
import { initiateLateJoinabilityCompensation } from '@/lib/payments/lateJoinabilityCompensation';
import { CURRENTLY_ATTENDING_RSVP_WHERE } from '@/lib/rsvpAttendance';

type PaymentAccountingUpdateData = {
  payoutTarget?: PaymentPayoutTarget;
  destinationAccountId?: string;
  transferGroup?: string;
  applicationFeeAmount?: number;
  stripeChargeId?: string;
  stripeBalanceTransactionId?: string;
  stripeTransferId?: string;
  stripeApplicationFeeId?: string;
};

type PaymentAccountingEnrichmentContext = {
  paymentId: string;
  eventId: string;
  paymentIntentId: string;
};

function requiresApplicationFeeId(applicationFeeAmount: number | null | undefined): boolean {
  return typeof applicationFeeAmount === 'number' && applicationFeeAmount > 0;
}

function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id;
  }
  return null;
}

function inferLegacyPayoutTargetFromIntent(intent: Stripe.PaymentIntent): PaymentPayoutTarget {
  return stripeObjectId(intent.transfer_data?.destination ?? null)
    ? PaymentPayoutTarget.organizer
    : PaymentPayoutTarget.platform;
}

function toPaymentUpdateDataFromIntent(
  intent: Stripe.PaymentIntent,
  options?: {
    includePayoutTarget?: boolean;
  }
): PaymentAccountingUpdateData {
  const data: PaymentAccountingUpdateData = {};
  if (options?.includePayoutTarget) {
    data.payoutTarget = inferLegacyPayoutTargetFromIntent(intent);
  }

  const destinationAccountId = stripeObjectId(intent.transfer_data?.destination ?? null);
  if (destinationAccountId) data.destinationAccountId = destinationAccountId;

  if (typeof intent.transfer_group === 'string' && intent.transfer_group.length > 0) {
    data.transferGroup = intent.transfer_group;
  }

  if (typeof intent.application_fee_amount === 'number') {
    data.applicationFeeAmount = intent.application_fee_amount;
  }

  const chargeId = stripeObjectId(intent.latest_charge as string | { id: string } | null | undefined);
  if (chargeId) data.stripeChargeId = chargeId;

  return data;
}

async function enrichPaymentUpdateDataWithCharge(
  data: PaymentAccountingUpdateData,
  paymentIntent: Stripe.PaymentIntent,
  context: PaymentAccountingEnrichmentContext,
  payoutTarget: PaymentPayoutTarget,
  expectsApplicationFee: boolean
): Promise<PaymentAccountingUpdateData> {
  if (paymentIntent.latest_charge && typeof paymentIntent.latest_charge !== 'string') {
    const latestCharge = paymentIntent.latest_charge;
    const balanceTransactionId = stripeObjectId(
      latestCharge.balance_transaction as string | { id: string } | null | undefined
    );
    const transferId = stripeObjectId(
      latestCharge.transfer as string | { id: string } | null | undefined
    );
    const applicationFeeId = stripeObjectId(
      latestCharge.application_fee as string | { id: string } | null | undefined
    );

    if (balanceTransactionId) data.stripeBalanceTransactionId = balanceTransactionId;
    if (transferId) data.stripeTransferId = transferId;
    if (applicationFeeId) data.stripeApplicationFeeId = applicationFeeId;

    return data;
  }

  const latestChargeId = stripeObjectId(
    paymentIntent.latest_charge as string | { id: string } | null | undefined
  );
  if (!latestChargeId) return data;

  const missingAccountingFields =
    payoutTarget === PaymentPayoutTarget.organizer
      ? !data.stripeBalanceTransactionId ||
        !data.stripeTransferId ||
        (expectsApplicationFee && !data.stripeApplicationFeeId)
      : !data.stripeBalanceTransactionId;
  if (!missingAccountingFields) return data;

  try {
    const charge = await stripe.charges.retrieve(latestChargeId, {
      expand: ['balance_transaction', 'transfer', 'application_fee'],
    });
    const balanceTransactionId = stripeObjectId(
      charge.balance_transaction as string | { id: string } | null | undefined
    );
    const transferId = stripeObjectId(
      charge.transfer as string | { id: string } | null | undefined
    );
    const applicationFeeId = stripeObjectId(
      charge.application_fee as string | { id: string } | null | undefined
    );
    if (balanceTransactionId) data.stripeBalanceTransactionId = balanceTransactionId;
    if (transferId) data.stripeTransferId = transferId;
    if (applicationFeeId) data.stripeApplicationFeeId = applicationFeeId;
  } catch (error) {
    console.warn(
      `[payment-confirmation] unable to enrich charge accounting; continuing without expanded charge fields (paymentId=${context.paymentId}, eventId=${context.eventId}, paymentIntentId=${context.paymentIntentId})`,
      error
    );
  }

  return data;
}

/**
 * Shared helper: Link/create RSVP for an already-succeeded payment.
 * Idempotent upsert of RSVP + Payment linkage + featured recalc.
 * Only call when payment.status === succeeded.
 */
export type LinkRsvpToSucceededPaymentResult =
  | {
      linked: true;
      paymentId: string;
      rsvpId: string;
      confirmedCount: number;
      eventId: string;
    }
  | {
      linked: false;
      paymentId: string;
      eventId: string;
      blockedReason: EventJoinabilityBlockedReason;
    };

export async function linkRsvpToSucceededPayment(
  paymentId: string,
  userId: string,
  eventId: string
): Promise<LinkRsvpToSucceededPaymentResult> {
  const result = await prisma.$transaction<LinkRsvpToSucceededPaymentResult>(async (tx) => {
    const eventState = await tx.event.findUnique({
      where: { id: eventId },
      select: { date: true, archivedAt: true },
    });
    if (!eventState) {
      throw new Error(`Event not found for RSVP link: ${eventId}`);
    }

    const joinability = getEventJoinability({
      date: eventState.date,
      archivedAt: eventState.archivedAt,
    });
    if (!joinability.isJoinable) {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.succeeded,
          rsvpId: null,
        },
      });
      return {
        linked: false as const,
        paymentId,
        eventId,
        blockedReason: joinability.reason,
      };
    }

    const rsvp = await tx.rSVP.upsert({
      where: { userId_eventId: { userId, eventId } },
      create: {
        userId,
        eventId,
        status: RSVPStatus.confirmed,
        attendanceEntitlementStatus: RSVPAttendanceEntitlementStatus.active,
      },
      update: {
        status: RSVPStatus.confirmed,
        attendanceEntitlementStatus: RSVPAttendanceEntitlementStatus.active,
      },
      select: { id: true },
    });

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.succeeded,
        rsvpId: rsvp.id,
      },
    });

    const confirmedCount = await tx.rSVP.count({
      where: {
        eventId,
        ...CURRENTLY_ATTENDING_RSVP_WHERE,
      },
    });

    await tx.event.update({
      where: { id: eventId },
      data: { featured: computeAutoFeatured(confirmedCount) },
    });

    return {
      linked: true as const,
      paymentId,
      rsvpId: rsvp.id,
      confirmedCount,
      eventId,
    };
  });

  return result;
}

export async function confirmPaidRsvpByIntent(
  stripePaymentIntentId: string,
  paymentIntent?: Stripe.PaymentIntent
) {
  const payment = await prisma.payment.findUnique({
    where: { stripePaymentIntentId },
    select: {
      id: true,
      status: true,
      eventId: true,
      userId: true,
      rsvpId: true,
        ticketEmailSentAt: true,
        payoutTarget: true,
        applicationFeeAmount: true,
        stripeChargeId: true,
        stripeBalanceTransactionId: true,
      stripeTransferId: true,
      stripeApplicationFeeId: true,
    },
  });

  if (!payment) {
    throw new Error(`Payment not found for intent ${stripePaymentIntentId}`);
  }

  if (paymentIntent) {
    const persistedPayoutTarget: PaymentPayoutTarget | null = payment.payoutTarget;
    const inferredPayoutTarget = inferLegacyPayoutTargetFromIntent(paymentIntent);
    const baseUpdateData = toPaymentUpdateDataFromIntent(paymentIntent, {
      includePayoutTarget: persistedPayoutTarget === null,
    });
    const effectivePayoutTarget = persistedPayoutTarget ?? inferredPayoutTarget;

    if (
      persistedPayoutTarget &&
      persistedPayoutTarget !== inferredPayoutTarget
    ) {
      console.warn(
        `[payment-confirmation] payoutTarget mismatch between DB and Stripe intent; keeping persisted mode (paymentId=${payment.id}, eventId=${payment.eventId}, paymentIntentId=${paymentIntent.id}, persisted=${persistedPayoutTarget}, inferred=${inferredPayoutTarget})`
      );
    }

    if (
      effectivePayoutTarget === PaymentPayoutTarget.platform &&
      baseUpdateData.destinationAccountId
    ) {
      console.warn(
        `[payment-confirmation] platform payoutTarget payment received unexpected destination routing in Stripe intent (paymentId=${payment.id}, eventId=${payment.eventId}, paymentIntentId=${paymentIntent.id}, destination=${baseUpdateData.destinationAccountId})`
      );
    }

    if (
      effectivePayoutTarget === PaymentPayoutTarget.organizer &&
      !baseUpdateData.destinationAccountId
    ) {
      console.warn(
        `[payment-confirmation] organizer payoutTarget payment is missing destination routing in Stripe intent (paymentId=${payment.id}, eventId=${payment.eventId}, paymentIntentId=${paymentIntent.id})`
      );
    }

    const expectedApplicationFeeAmount =
      payment.applicationFeeAmount ?? baseUpdateData.applicationFeeAmount ?? null;
    const expectsApplicationFee =
      effectivePayoutTarget === PaymentPayoutTarget.organizer &&
      requiresApplicationFeeId(expectedApplicationFeeAmount);
    const paymentHasFullChargeAccounting = Boolean(
      payment.stripeBalanceTransactionId &&
      (effectivePayoutTarget !== PaymentPayoutTarget.organizer || payment.stripeTransferId) &&
      (!expectsApplicationFee || payment.stripeApplicationFeeId)
    );
    let updateData = baseUpdateData;
    if (!paymentHasFullChargeAccounting) {
      try {
        updateData = await enrichPaymentUpdateDataWithCharge(
          baseUpdateData,
          paymentIntent,
          {
            paymentId: payment.id,
            eventId: payment.eventId,
            paymentIntentId: paymentIntent.id,
          },
          effectivePayoutTarget,
          expectsApplicationFee
        );
      } catch (error) {
        console.warn(
          `[payment-confirmation] charge enrichment failed unexpectedly; continuing with base accounting fields (paymentId=${payment.id}, eventId=${payment.eventId}, paymentIntentId=${paymentIntent.id})`,
          error
        );
        updateData = baseUpdateData;
      }
    }
    if (Object.keys(updateData).length > 0) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: updateData,
      });
    }
  }

  const hasConfirmedRsvp =
    payment.status === PaymentStatus.succeeded && Boolean(payment.rsvpId);

  if (hasConfirmedRsvp && payment.ticketEmailSentAt) {
    return { alreadyProcessed: true, paymentId: payment.id, rsvpId: payment.rsvpId };
  }

  let alreadyProcessed = hasConfirmedRsvp;
  let resolvedRsvpId = payment.rsvpId;

  if (!hasConfirmedRsvp) {
    const result = await linkRsvpToSucceededPayment(
      payment.id,
      payment.userId,
      payment.eventId
    );
    alreadyProcessed = false;
    if (result.linked) {
      resolvedRsvpId = result.rsvpId;
    } else {
      resolvedRsvpId = null;
      console.warn(
        `[payment-confirmation] skipped RSVP linking for payment ${payment.id} because event is not joinable (${result.blockedReason})`
      );
      const compensation = await initiateLateJoinabilityCompensation(payment.id);
      console.warn(
        `[payment-confirmation] initiated late-success compensation for payment ${payment.id} (refundRequest=${compensation.refundRequestId}, status=${compensation.status}, stripeRefundId=${compensation.stripeRefundId ?? 'none'})`
      );
    }
  }

  const emailResult = await sendTicketPurchaseConfirmationEmailIfNeeded(payment.id);
  if (!emailResult.sent && emailResult.reason !== 'already-sent') {
    console.warn(
      `[payment-confirmation] ticket email not sent for payment ${payment.id} (reason: ${emailResult.reason})`
    );
  }

  return { alreadyProcessed, paymentId: payment.id, rsvpId: resolvedRsvpId };
}

export async function markPaymentFailed(stripePaymentIntentId: string) {
  await prisma.payment.updateMany({
    where: { stripePaymentIntentId },
    data: { status: PaymentStatus.failed },
  });
}

export async function markPaymentProcessing(stripePaymentIntentId: string) {
  // There is no explicit "processing" state in PaymentStatus; keep as pending
  await prisma.payment.updateMany({
    where: { stripePaymentIntentId },
    data: { status: PaymentStatus.pending },
  });
}

export async function markPaymentCanceled(stripePaymentIntentId: string) {
  // Treat cancellations as failed payments
  await prisma.payment.updateMany({
    where: { stripePaymentIntentId },
    data: { status: PaymentStatus.failed },
  });
}
