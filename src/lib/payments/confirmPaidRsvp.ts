import { PaymentStatus, RSVPStatus } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { computeAutoFeatured } from '@/lib/constants';

/**
 * Shared helper: Link/create RSVP for an already-succeeded payment.
 * Idempotent upsert of RSVP + Payment linkage + featured recalc.
 * Only call when payment.status === succeeded.
 */
export async function linkRsvpToSucceededPayment(
  paymentId: string,
  userId: string,
  eventId: string
) {
  const result = await prisma.$transaction(async (tx) => {
    const rsvp = await tx.rSVP.upsert({
      where: { userId_eventId: { userId, eventId } },
      create: {
        userId,
        eventId,
        status: RSVPStatus.confirmed,
      },
      update: {
        status: RSVPStatus.confirmed,
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
        status: RSVPStatus.confirmed,
      },
    });

    await tx.event.update({
      where: { id: eventId },
      data: { featured: computeAutoFeatured(confirmedCount) },
    });

    return { paymentId, rsvpId: rsvp.id, confirmedCount, eventId };
  });

  return result;
}

export async function confirmPaidRsvpByIntent(stripePaymentIntentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { stripePaymentIntentId },
    select: {
      id: true,
      status: true,
      eventId: true,
      userId: true,
      rsvpId: true,
    },
  });

  if (!payment) {
    throw new Error(`Payment not found for intent ${stripePaymentIntentId}`);
  }

  if (payment.status === PaymentStatus.succeeded && payment.rsvpId) {
    return { alreadyProcessed: true, paymentId: payment.id, rsvpId: payment.rsvpId };
  }

  const result = await linkRsvpToSucceededPayment(
    payment.id,
    payment.userId,
    payment.eventId
  );

  return { alreadyProcessed: false, ...result };
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
