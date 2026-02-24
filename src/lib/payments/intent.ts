import 'server-only';

import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import { PaymentStatus } from '@/generated/prisma';
import type { CheckoutEventForClient } from '@/types/event';
import type { TicketStateResult } from '@/types/payments/stripe';
import {
  NotFoundError,
  NotPayableError,
  AlreadyPaidError,
  StripeConfigError,
  StripeApiError,
} from '@/lib/payments/errors';

// ============================================================================
// TYPE GUARDS & HELPERS
// ============================================================================

/**
 * Reusable payment intent statuses.
 * These statuses indicate the intent can be used again by the client.
 * See: https://stripe.com/docs/payments/intents-api#intent-statuses
 */
const REUSABLE_INTENT_STATUSES = new Set<Stripe.PaymentIntent.Status>([
  'requires_payment_method',
  'requires_action',
  'requires_confirmation',
  'processing',
]);

/**
 * Check if a payment intent can be reused.
 * An intent is reusable if it hasn't been completed yet.
 */
function isReusableIntent(pi: Stripe.PaymentIntent): boolean {
  return REUSABLE_INTENT_STATUSES.has(pi.status);
}

/**
 * Get Stripe publishable key from environment, throw if missing.
 */
function getPublishableKey(): string {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    throw new StripeConfigError(
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY environment variable is not set'
    );
  }
  return key;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Creates or reuses a Stripe PaymentIntent for a paid event RSVP.
 *
 * - Fetches event and validates it's payable
 * - Reuses a pending Payment record if it exists (idempotent)
 * - Handles Stripe intent retrieval with proper status checks
 * - Returns clientSecret, paymentIntentId, and publishableKey for client
 *
 * @param eventId Event ID
 * @param userId User's Clerk ID (from Clerk auth)
 * @returns CreateOrReusePaymentIntentResult with payment details and event
 * @throws {NotFoundError} if event does not exist
 * @throws {NotPayableError} if event is not marked as payable
 * @throws {AlreadyPaidError} if payment already succeeded
 * @throws {StripeConfigError} if publishable key is missing
 * @throws {StripeApiError} if Stripe API call fails
 */
export async function createOrReusePaymentIntentForEvent({
  eventId,
  userId,
}: {
  eventId: string;
  userId: string;
}): Promise<TicketStateResult> {
  // 1) Fetch event and validate it exists
  const eventData = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      description: true,
      date: true,
      location: true,
      category: true,
      eventTimeZone: true,
      contactEmail: true,
      contactPhone: true,
      contactPhoneApps: true,
      isPaid: true,
      priceCents: true,
      currency: true,
      creator: {
        select: {
          clerkId: true,
          username: true,
          firstName: true,
          lastName: true,
          imageUrl: true,
          hasImage: true,
          role: true,
        },
      },
    },
  });

  if (!eventData) {
    throw new NotFoundError(`Event with ID ${eventId} not found`);
  }

  // 2) Validate event is payable
  if (!eventData.isPaid || !eventData.priceCents || !eventData.currency) {
    throw new NotPayableError(
      `Event ${eventId} is not payable (isPaid=${eventData.isPaid}, priceCents=${eventData.priceCents}, currency=${eventData.currency})`
    );
  }

  // At this point, priceCents and currency are guaranteed non-null
  const priceCents = eventData.priceCents;
  const currency = eventData.currency;

  // Normalize event for return type (as CheckoutEventForClient)
  const event: CheckoutEventForClient = {
    id: eventData.id,
    title: eventData.title,
    description: eventData.description ?? 'No description provided.',
    date: eventData.date,
    location: eventData.location ?? null,
    category: eventData.category ?? null,
    eventTimeZone: eventData.eventTimeZone ?? 'UTC',
    contactEmail: eventData.contactEmail ?? null,
    contactPhone: eventData.contactPhone ?? null,
    contactPhoneApps: eventData.contactPhoneApps ?? null,
    isPaid: eventData.isPaid,
    priceCents,
    currency,
    creator: eventData.creator,
  };

  // 3) Try to reuse an existing pending payment
  // First, check for any already succeeded payments (avoid duplicate charges)
  const succeededPayment = await prisma.payment.findFirst({
    where: { eventId: event.id, userId, status: PaymentStatus.succeeded },
    orderBy: { updatedAt: 'desc' },
  });

  if (succeededPayment) {
    // If there's a succeeded payment, check whether an RSVP exists and its status
    const existingRsvp = await prisma.rSVP.findFirst({
      where: { eventId: event.id, userId },
    });

    const rsvpPayload = existingRsvp
      ? {
          status: existingRsvp.status,
          user: { clerkId: existingRsvp.userId, username: undefined },
        }
      : undefined;

    const attendanceState = existingRsvp?.status === 'confirmed'
      ? 'ALREADY_PAID_ATTENDING'
      : 'ALREADY_PAID_NOT_ATTENDING';

    return {
      state: attendanceState,
      event,
      rsvp: rsvpPayload,
      paymentIntentId: succeededPayment.stripePaymentIntentId,
    } as TicketStateResult;
  }

  const existingPayment = await prisma.payment.findFirst({
    where: { eventId: event.id, userId, status: PaymentStatus.pending },
    orderBy: { updatedAt: 'desc' },
  });

  if (existingPayment) {
    try {
      const existingIntent = await stripe.paymentIntents.retrieve(
        existingPayment.stripePaymentIntentId
      );

      // If intent has already succeeded or requires capture, this is a duplicate payment attempt
      if (
        existingIntent.status === 'succeeded' ||
        existingIntent.status === 'requires_capture'
      ) {
        throw new AlreadyPaidError(
          `Payment has already been completed for this event`
        );
      }

      // Check if intent is still reusable
      if (isReusableIntent(existingIntent)) {
        const publishableKey = getPublishableKey();
        if (!existingIntent.client_secret) {
          throw new StripeApiError(
            'Retrieved payment intent missing client_secret'
          );
        }
        return {
          state: 'PAYMENT_IN_PROGRESS',
          clientSecret: existingIntent.client_secret,
          paymentIntentId: existingPayment.stripePaymentIntentId,
          publishableKey,
          event,
        };
      }

      // Intent is in a non-reusable, non-succeeded state (e.g., canceled/failed)
      // Log but continue to create a new one
      console.warn(
        `[payment-intent] existing intent has non-reusable status: ${existingIntent.status}`
      );
    } catch (e) {
      // If error is AlreadyPaidError, re-throw immediately
      if (e instanceof AlreadyPaidError) {
        throw e;
      }

      // If retrieval fails with Stripe API error, log and continue to create a new one
      if (e instanceof Stripe.errors.StripeError) {
        console.warn(
          `[payment-intent] failed to retrieve existing intent: ${e.message}`
        );
      } else {
        console.warn('[payment-intent] failed to retrieve existing intent:', e);
      }
    }
  }

  // 4) Create new PaymentIntent with idempotency key
  const idempotencyKey = `paid_rsvp_${event.id}_${userId}`;
  let paymentIntent: Stripe.PaymentIntent;

  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: priceCents,
        currency: currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        metadata: {
          eventId: event.id,
          userId,
        },
        description: `Eventify paid RSVP: ${event.title}`,
      },
      { idempotencyKey }
    );
  } catch (e) {
    if (e instanceof Stripe.errors.StripeError) {
      throw new StripeApiError(
        `Failed to create Stripe payment intent: ${e.message}`,
        e
      );
    }
    throw new StripeApiError(
      `Failed to create Stripe payment intent: ${String(e)}`,
      e
    );
  }

  // Ensure client_secret is present
  if (!paymentIntent.client_secret) {
    throw new StripeApiError(
      'Stripe returned payment intent without client_secret'
    );
  }

  // 5) Upsert Payment record (handle concurrent creates gracefully)
  try {
    await prisma.payment.create({
      data: {
        stripePaymentIntentId: paymentIntent.id,
        status: PaymentStatus.pending,
        amountCents: priceCents,
        currency: currency.toUpperCase(),
        eventId: event.id,
        userId,
      },
    });
  } catch (dbErr) {
    // Concurrent create; try to reuse the existing record
    console.warn(
      '[payment-intent] payment record create conflict, reusing:',
      dbErr
    );
    const created = await prisma.payment.findFirst({
      where: { eventId: event.id, userId },
      orderBy: { updatedAt: 'desc' },
    });

    if (created) {
      try {
        const fallbackIntent = await stripe.paymentIntents.retrieve(
          created.stripePaymentIntentId
        );
        const publishableKey = getPublishableKey();
        if (!fallbackIntent.client_secret) {
          throw new StripeApiError(
            'Retrieved fallback payment intent missing client_secret'
          );
        }
        return {
          state: 'PAYMENT_IN_PROGRESS',
          clientSecret: fallbackIntent.client_secret,
          paymentIntentId: created.stripePaymentIntentId,
          publishableKey,
          event,
        };
      } catch (e) {
        if (e instanceof Stripe.errors.StripeError) {
          throw new StripeApiError(
            `Failed to retrieve fallback payment intent: ${e.message}`,
            e
          );
        }
        throw new StripeApiError(
          `Failed to retrieve fallback payment intent: ${String(e)}`,
          e
        );
      }
    }

    // No fallback found; convert DB error to StripeApiError
    const dbErrorMsg =
      dbErr instanceof Error ? dbErr.message : String(dbErr);
    throw new StripeApiError(
      `Database error creating payment record: ${dbErrorMsg}`,
      dbErr
    );
  }

  // 6) Return success result (payment in progress)
  const publishableKey = getPublishableKey();
  return {
    state: 'PAYMENT_IN_PROGRESS',
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    publishableKey,
    event,
  } as TicketStateResult;
}
