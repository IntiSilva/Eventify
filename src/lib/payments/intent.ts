import 'server-only';

import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import { PaymentPayoutTarget, PaymentStatus, RSVPStatus } from '@/generated/prisma';
import type { CheckoutEventForClient } from '@/types/event';
import type { TicketStateResult } from '@/types/payments/stripe';
import {
  NotFoundError,
  NotPayableError,
  EventNotJoinableError,
  AlreadyPaidError,
  ConnectNotReadyError,
  StripeConfigError,
  StripeApiError,
} from '@/lib/payments/errors';
import { computePlatformApplicationFeeAmountCents } from '@/lib/payments/pricingQuote.server';
import {
  isStripeConnectReady,
} from '@/lib/payments/stripeConnectReadiness';
import { getEventJoinability } from '@/lib/events/joinability';
import { resolveTicketStateForSucceededPayment } from '@/lib/payments/ticketState';
import { hasActiveAttendanceEntitlement } from '@/lib/rsvpAttendance';

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
 * For stale-price pending intents:
 * - pre-confirmation intents can be canceled and replaced with a new current-price intent
 * - in-flight intents are allowed to continue at the locked old price
 */
const CANCELABLE_STALE_INTENT_STATUSES = new Set<Stripe.PaymentIntent.Status>([
  'requires_payment_method',
  'requires_confirmation',
]);

const IN_FLIGHT_LOCKED_INTENT_STATUSES = new Set<Stripe.PaymentIntent.Status>([
  'requires_action',
  'processing',
]);

/**
 * Check if a payment intent can be reused.
 * An intent is reusable if it hasn't been completed yet.
 */
function isReusableIntent(pi: Stripe.PaymentIntent): boolean {
  return REUSABLE_INTENT_STATUSES.has(pi.status);
}

function isPayableCheckoutIntent(pi: Stripe.PaymentIntent): boolean {
  return REUSABLE_INTENT_STATUSES.has(pi.status);
}

function canCancelStaleIntent(pi: Stripe.PaymentIntent): boolean {
  return CANCELABLE_STALE_INTENT_STATUSES.has(pi.status);
}

function isInFlightLockedPriceIntent(pi: Stripe.PaymentIntent): boolean {
  return IN_FLIGHT_LOCKED_INTENT_STATUSES.has(pi.status);
}

function isRedirectlessAutomationCompatibleIntent(
  pi: Stripe.PaymentIntent
): boolean {
  return pi.automatic_payment_methods?.allow_redirects === 'never';
}

function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id;
  }
  return null;
}

async function markPendingPaymentCanceled(paymentId: string): Promise<void> {
  try {
    const result = await prisma.payment.updateMany({
      where: { id: paymentId, status: PaymentStatus.pending },
      data: { status: PaymentStatus.canceled },
    });
    if (result.count === 0) {
      console.warn(
        `[payment-intent] skipped local cancel update for payment ${paymentId}; status was no longer pending`
      );
    }
  } catch (e) {
    console.warn('[payment-intent] failed to mark local payment as canceled:', e);
  }
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

type StripePaymentRouting =
  | {
      payoutTarget: 'organizer';
      destinationAccountId: string;
      transferGroup: string;
      applicationFeeAmount: number | null;
    }
  | {
      payoutTarget: 'platform';
      destinationAccountId: null;
      transferGroup: string;
      applicationFeeAmount: null;
    };

function resolveStripePaymentRouting(input: {
  event: Pick<CheckoutEventForClient, 'id'>;
  amountCents: number;
  creator: {
    role: string;
    stripeConnectAccountId: string | null;
    stripeConnectPayoutsEnabled: boolean;
    stripeConnectChargesEnabled: boolean;
    stripeConnectDetailsSubmitted: boolean;
  };
}): StripePaymentRouting {
  if (input.creator.role === 'admin') {
    return {
      payoutTarget: PaymentPayoutTarget.platform,
      destinationAccountId: null,
      transferGroup: `event:${input.event.id}`,
      applicationFeeAmount: null,
    };
  }

  if (input.creator.role !== 'organizer') {
    throw new NotPayableError(
      'Paid events must be owned by an organizer or admin account.'
    );
  }

  const organizerAccountId = input.creator.stripeConnectAccountId;
  const organizerConnectReady = isStripeConnectReady({
    stripeConnectAccountId: organizerAccountId,
    stripeConnectPayoutsEnabled: input.creator.stripeConnectPayoutsEnabled,
    stripeConnectChargesEnabled: input.creator.stripeConnectChargesEnabled,
    stripeConnectDetailsSubmitted: input.creator.stripeConnectDetailsSubmitted,
  });

  if (!organizerConnectReady || typeof organizerAccountId !== 'string') {
    throw new ConnectNotReadyError(
      'The organizer has not finished Stripe Connect payouts setup yet. Please try again later.'
    );
  }

  return {
    payoutTarget: PaymentPayoutTarget.organizer,
    destinationAccountId: organizerAccountId,
    transferGroup: `event:${input.event.id}`,
    applicationFeeAmount: computePlatformApplicationFeeAmountCents(input.amountCents),
  };
}

function hasExpectedRouting(
  paymentIntent: Stripe.PaymentIntent,
  routing: StripePaymentRouting
): boolean {
  const actualDestinationAccountId = stripeObjectId(paymentIntent.transfer_data?.destination ?? null);
  const actualApplicationFeeAmount =
    typeof paymentIntent.application_fee_amount === 'number'
      ? paymentIntent.application_fee_amount
      : null;

  if (
    typeof paymentIntent.transfer_group !== 'string' ||
    paymentIntent.transfer_group !== routing.transferGroup
  ) {
    return false;
  }

  if (routing.payoutTarget === PaymentPayoutTarget.organizer) {
    const expectedApplicationFeeAmount = routing.applicationFeeAmount ?? null;
    return (
      actualDestinationAccountId === routing.destinationAccountId &&
      actualApplicationFeeAmount === expectedApplicationFeeAmount
    );
  }

  return actualDestinationAccountId === null && actualApplicationFeeAmount === null;
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
  disallowRedirects,
}: {
  eventId: string;
  userId: string;
  disallowRedirects?: boolean;
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
      archivedAt: true,
      currentPriceVersionId: true,
      currentPriceVersion: {
        select: {
          id: true,
          isPaid: true,
          amountCents: true,
          currency: true,
        },
      },
      creator: {
        select: {
          clerkId: true,
          username: true,
          firstName: true,
          lastName: true,
          imageUrl: true,
          hasImage: true,
          role: true,
          stripeConnectAccountId: true,
          stripeConnectPayoutsEnabled: true,
          stripeConnectChargesEnabled: true,
          stripeConnectDetailsSubmitted: true,
        },
      },
    },
  });

  if (!eventData) {
    throw new NotFoundError(`Event with ID ${eventId} not found`);
  }

  const joinability = getEventJoinability({
    date: eventData.date,
    archivedAt: eventData.archivedAt,
  });
  if (!joinability.isJoinable) {
    throw new EventNotJoinableError(joinability.message);
  }

  const currentPricingSource = eventData.currentPriceVersion ?? null;
  if (eventData.currentPriceVersionId && !currentPricingSource) {
    console.warn(
      `[payment-intent] event ${eventId} has currentPriceVersionId=${eventData.currentPriceVersionId} but relation was not found; falling back to denormalized event pricing`
    );
  }

  const resolvedIsPaid = currentPricingSource?.isPaid ?? eventData.isPaid;
  const resolvedPriceCents = currentPricingSource?.amountCents ?? eventData.priceCents;
  const resolvedCurrency = currentPricingSource?.currency ?? eventData.currency;
  const resolvedPriceVersionId = currentPricingSource?.id ?? null;
  const isCreatorViewingOwnEvent = eventData.creator?.clerkId === userId;

  // 2) Validate event is payable (versioned pricing is source of truth, with rollout fallback)
  if (!resolvedIsPaid || !resolvedPriceCents || !resolvedCurrency) {
    throw new NotPayableError(
      `Event ${eventId} is not payable (isPaid=${resolvedIsPaid}, priceCents=${resolvedPriceCents}, currency=${resolvedCurrency})`
    );
  }

  // Product rule: creators attend their own paid events via RSVP (no checkout/payment flow).
  if (isCreatorViewingOwnEvent) {
    throw new NotPayableError(
      'Event creators can attend their own paid events without purchasing a ticket.'
    );
  }

  // At this point, priceCents and currency are guaranteed non-null
  const priceCents = resolvedPriceCents;
  const currency = resolvedCurrency;

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
    isPaid: resolvedIsPaid,
    priceCents,
    currency,
    creator: eventData.creator,
  };

  let repurchaseDiscriminator: string | null = null;

  // 3) First, check for any already succeeded payments (avoid duplicate charges)
  const succeededPayment = await prisma.payment.findFirst({
    where: { eventId: event.id, userId, status: PaymentStatus.succeeded },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      stripePaymentIntentId: true,
      amountCents: true,
      refundRequest: {
        select: {
          status: true,
          stripeRefundId: true,
        },
      },
    },
  });

  if (succeededPayment) {
    const ticketState = await resolveTicketStateForSucceededPayment({
      paymentId: succeededPayment.id,
      amountCents: succeededPayment.amountCents,
      refundRequest: succeededPayment.refundRequest,
    });

    if (ticketState === 'refund_pending') {
      throw new AlreadyPaidError(
        'Your previous ticket refund is still processing. You can purchase again once it is completed.'
      );
    }

    if (ticketState === 'refunded') {
      // Full refund succeeded. Allow repurchase by continuing with PI creation flow.
      repurchaseDiscriminator = `repurchase_${succeededPayment.id}`;
    } else {
      // If there's a succeeded payment, check whether an RSVP exists and its status
      const existingRsvp = await prisma.rSVP.findFirst({
        where: { eventId: event.id, userId },
        select: {
          status: true,
          attendanceEntitlementStatus: true,
        },
      });

      const rsvpPayload = existingRsvp
        ? {
            status: existingRsvp.status,
            user: { clerkId: userId, username: undefined },
          }
        : undefined;

      const attendanceState =
        existingRsvp?.status === RSVPStatus.confirmed &&
        hasActiveAttendanceEntitlement(existingRsvp.attendanceEntitlementStatus)
          ? 'ALREADY_PAID_ATTENDING'
          : 'ALREADY_PAID_NOT_ATTENDING';

      return {
        state: attendanceState,
        event,
        rsvp: rsvpPayload,
        paymentIntentId: succeededPayment.stripePaymentIntentId,
      } as TicketStateResult;
    }
  }

  const paymentRouting = resolveStripePaymentRouting({
    event,
    amountCents: priceCents,
    creator: eventData.creator,
  });
  const requiresNonRedirectPaymentMethods = Boolean(disallowRedirects);

  // 4) Try to reuse an existing pending payment
  const existingPayment = await prisma.payment.findFirst({
    where: { eventId: event.id, userId, status: PaymentStatus.pending },
    orderBy: { updatedAt: 'desc' },
  });

  if (existingPayment) {
    const pendingMatchesCurrentVersion =
      existingPayment.priceVersionId === resolvedPriceVersionId;
    const paymentSnapshotEvent: CheckoutEventForClient = {
      ...event,
      isPaid: true,
      priceCents: existingPayment.amountCents,
      currency: existingPayment.currency,
    };

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

      let mustCreateReplacementIntent = false;
      if (
        requiresNonRedirectPaymentMethods &&
        !isRedirectlessAutomationCompatibleIntent(existingIntent)
      ) {
        if (canCancelStaleIntent(existingIntent)) {
          try {
            await stripe.paymentIntents.cancel(existingPayment.stripePaymentIntentId);
            await markPendingPaymentCanceled(existingPayment.id);
            mustCreateReplacementIntent = true;
          } catch (cancelErr) {
            if (cancelErr instanceof Stripe.errors.StripeError) {
              throw new StripeApiError(
                `Failed to cancel pending payment intent that requires redirects: ${cancelErr.message}`,
                cancelErr
              );
            }
            throw new StripeApiError(
              `Failed to cancel pending payment intent that requires redirects: ${String(cancelErr)}`,
              cancelErr
            );
          }
        } else if (existingIntent.status === 'canceled') {
          await markPendingPaymentCanceled(existingPayment.id);
          mustCreateReplacementIntent = true;
        } else {
          throw new StripeApiError(
            `Existing pending payment intent (${existingIntent.id}) requires redirect-capable methods and cannot be reused for non-interactive sandbox confirmation while in status "${existingIntent.status}".`
          );
        }
      }

      if (
        !mustCreateReplacementIntent &&
        !hasExpectedRouting(existingIntent, paymentRouting)
      ) {
        if (canCancelStaleIntent(existingIntent)) {
          try {
            await stripe.paymentIntents.cancel(existingPayment.stripePaymentIntentId);
            await markPendingPaymentCanceled(existingPayment.id);
            mustCreateReplacementIntent = true;
          } catch (cancelErr) {
            if (cancelErr instanceof Stripe.errors.StripeError) {
              throw new StripeApiError(
                `Failed to cancel pending payment intent with mismatched payout routing: ${cancelErr.message}`,
                cancelErr
              );
            }
            throw new StripeApiError(
              `Failed to cancel pending payment intent with mismatched payout routing: ${String(cancelErr)}`,
              cancelErr
            );
          }
        } else if (existingIntent.status === 'canceled') {
          await markPendingPaymentCanceled(existingPayment.id);
          mustCreateReplacementIntent = true;
        } else {
          throw new ConnectNotReadyError(
            'A previous checkout is still in progress with different payout routing. Please wait a moment and try again.'
          );
        }
      }

      // Current-version pending intent: normal reuse behavior
      if (
        !mustCreateReplacementIntent &&
        pendingMatchesCurrentVersion &&
        isReusableIntent(existingIntent)
      ) {
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
          event: paymentSnapshotEvent,
        };
      }

      if (!mustCreateReplacementIntent && !pendingMatchesCurrentVersion) {
        // Finalized policy: if an old-price checkout is already in-flight, let it continue.
        if (isInFlightLockedPriceIntent(existingIntent)) {
          const publishableKey = getPublishableKey();
          if (!existingIntent.client_secret) {
            throw new StripeApiError(
              'Retrieved stale in-flight payment intent missing client_secret'
            );
          }
          return {
            state: 'PAYMENT_IN_PROGRESS',
            clientSecret: existingIntent.client_secret,
            paymentIntentId: existingPayment.stripePaymentIntentId,
            publishableKey,
            event: paymentSnapshotEvent,
          };
        }

        // Stale, pre-confirmation PI: cancel and recreate at latest price/version.
        if (canCancelStaleIntent(existingIntent)) {
          try {
            await stripe.paymentIntents.cancel(existingPayment.stripePaymentIntentId);
            await markPendingPaymentCanceled(existingPayment.id);
          } catch (cancelErr) {
            if (cancelErr instanceof Stripe.errors.StripeError) {
              throw new StripeApiError(
                `Failed to cancel stale payment intent: ${cancelErr.message}`,
                cancelErr
              );
            }
            throw new StripeApiError(
              `Failed to cancel stale payment intent: ${String(cancelErr)}`,
              cancelErr
            );
          }
        } else if (existingIntent.status === 'canceled') {
          await markPendingPaymentCanceled(existingPayment.id);
        } else {
          console.warn(
            `[payment-intent] stale existing intent has non-reusable status: ${existingIntent.status}`
          );
        }
      } else if (!mustCreateReplacementIntent) {
        // Current-version intent is non-reusable/non-succeeded (e.g., canceled/failed)
        if (existingIntent.status === 'canceled') {
          await markPendingPaymentCanceled(existingPayment.id);
        }
        console.warn(
          `[payment-intent] existing intent has non-reusable status: ${existingIntent.status}`
        );
      }
    } catch (e) {
      // If error is AlreadyPaidError, re-throw immediately
      if (e instanceof AlreadyPaidError) {
        throw e;
      }
      if (e instanceof ConnectNotReadyError) {
        throw e;
      }
      if (e instanceof StripeApiError) {
        throw e;
      }
      if (e instanceof StripeConfigError) {
        throw e;
      }

      // Safety hardening: fail closed when a pending payment row exists but Stripe retrieve fails.
      // We do not create a second PI because the existing pending PI may still be in-flight.
      if (e instanceof Stripe.errors.StripeError) {
        console.warn(
          `[payment-intent] failed to retrieve existing pending intent, refusing to create a new PI: ${e.message}`
        );
        throw new StripeApiError(
          'A payment is already in progress for this event. Please retry in a moment.',
          e
        );
      }
      console.warn(
        '[payment-intent] failed to inspect existing pending intent, refusing to create a new PI:',
        e
      );
      throw new StripeApiError(
        'A payment is already in progress for this event. Please retry in a moment.',
        e
      );
    }
  }

  // 5) Create new PaymentIntent with idempotency key
  const intentModeKey = requiresNonRedirectPaymentMethods
    ? 'non_redirect'
    : 'default';
  const idempotencyKey =
    `paid_rsvp_${event.id}_${userId}_${resolvedPriceVersionId ?? 'legacy'}_${paymentRouting.payoutTarget}_${intentModeKey}${repurchaseDiscriminator ? `_${repurchaseDiscriminator}` : ''}`;
  let paymentIntent: Stripe.PaymentIntent;
  const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
    amount: priceCents,
    currency: currency.toLowerCase(),
    automatic_payment_methods: requiresNonRedirectPaymentMethods
      ? { enabled: true, allow_redirects: 'never' }
      : { enabled: true },
    metadata: {
      eventId: event.id,
      userId,
      priceVersionId: resolvedPriceVersionId ?? 'legacy',
      amountCents: String(priceCents),
      currency: currency.toUpperCase(),
      payoutTarget: paymentRouting.payoutTarget,
    },
    description: `Eventify paid RSVP: ${event.title}`,
    transfer_group: paymentRouting.transferGroup,
  };

  if (paymentRouting.payoutTarget === PaymentPayoutTarget.organizer) {
    paymentIntentParams.transfer_data = {
      destination: paymentRouting.destinationAccountId,
    };
  }

  if (typeof paymentRouting.applicationFeeAmount === 'number') {
    paymentIntentParams.application_fee_amount =
      paymentRouting.applicationFeeAmount;
  }

  try {
    paymentIntent = await stripe.paymentIntents.create(
      paymentIntentParams,
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

  if (!isPayableCheckoutIntent(paymentIntent)) {
    throw new StripeApiError(
      `Stripe returned non-checkout payment intent status (${paymentIntent.status}) while preparing checkout.`
    );
  }

  // Ensure client_secret is present
  if (!paymentIntent.client_secret) {
    throw new StripeApiError(
      'Stripe returned payment intent without client_secret'
    );
  }

  // 6) Upsert Payment record (handle concurrent creates gracefully)
  try {
    await prisma.payment.create({
      data: {
        stripePaymentIntentId: paymentIntent.id,
        status: PaymentStatus.pending,
        amountCents: priceCents,
        currency: currency.toUpperCase(),
        eventId: event.id,
        userId,
        payoutTarget: paymentRouting.payoutTarget,
        priceVersionId: resolvedPriceVersionId,
        destinationAccountId: paymentRouting.destinationAccountId,
        transferGroup: paymentRouting.transferGroup,
        applicationFeeAmount: paymentRouting.applicationFeeAmount,
      },
    });
  } catch (dbErr) {
    // Concurrent create; try to reuse the existing record
    console.warn(
      '[payment-intent] payment record create conflict, reusing:',
      dbErr
    );
    const created = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (created) {
      try {
        const fallbackIntent = await stripe.paymentIntents.retrieve(
          created.stripePaymentIntentId
        );
        const publishableKey = getPublishableKey();
        if (!isPayableCheckoutIntent(fallbackIntent)) {
          if (!repurchaseDiscriminator) {
            throw new AlreadyPaidError(
              'A previous payment is already completed for this event. Please refresh and try again.'
            );
          }

          const recoveryIdempotencyKey = `${idempotencyKey}_recovery_${fallbackIntent.id}`;
          let recoveryIntent: Stripe.PaymentIntent;
          try {
            recoveryIntent = await stripe.paymentIntents.create(
              paymentIntentParams,
              { idempotencyKey: recoveryIdempotencyKey }
            );
          } catch (recoveryError) {
            if (recoveryError instanceof Stripe.errors.StripeError) {
              throw new StripeApiError(
                `Failed to create replacement Stripe payment intent: ${recoveryError.message}`,
                recoveryError
              );
            }
            throw new StripeApiError(
              `Failed to create replacement Stripe payment intent: ${String(recoveryError)}`,
              recoveryError
            );
          }

          if (!isPayableCheckoutIntent(recoveryIntent)) {
            throw new StripeApiError(
              `Replacement payment intent is not payable for checkout (${recoveryIntent.status}).`
            );
          }

          if (!recoveryIntent.client_secret) {
            throw new StripeApiError(
              'Replacement payment intent missing client_secret'
            );
          }

          try {
            await prisma.payment.create({
              data: {
                stripePaymentIntentId: recoveryIntent.id,
                status: PaymentStatus.pending,
                amountCents: priceCents,
                currency: currency.toUpperCase(),
                eventId: event.id,
                userId,
                payoutTarget: paymentRouting.payoutTarget,
                priceVersionId: resolvedPriceVersionId,
                destinationAccountId: paymentRouting.destinationAccountId,
                transferGroup: paymentRouting.transferGroup,
                applicationFeeAmount: paymentRouting.applicationFeeAmount,
              },
            });
          } catch (recoveryDbErr) {
            const recoveryCreated = await prisma.payment.findFirst({
              where: { stripePaymentIntentId: recoveryIntent.id },
            });
            if (!recoveryCreated) {
              throw recoveryDbErr;
            }
          }

          return {
            state: 'PAYMENT_IN_PROGRESS',
            clientSecret: recoveryIntent.client_secret,
            paymentIntentId: recoveryIntent.id,
            publishableKey,
            event,
          };
        }

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
          event: {
            ...event,
            isPaid: true,
            priceCents: created.amountCents,
            currency: created.currency,
          },
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

  // 7) Return success result (payment in progress)
  const publishableKey = getPublishableKey();
  return {
    state: 'PAYMENT_IN_PROGRESS',
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    publishableKey,
    event,
  } as TicketStateResult;
}
