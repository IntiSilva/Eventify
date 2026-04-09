import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type Stripe from 'stripe';
import { PaymentStatus } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import {
  isPaymentError,
  EventNotJoinableError,
  mapPaymentErrorToStatusCode,
  StripeApiError,
} from '@/lib/payments/errors';
import { getEventJoinability } from '@/lib/events/joinability';

export const runtime = 'nodejs';

type Body = {
  eventId?: string;
  paymentIntentId?: string;
};

const CONFIRMABLE_INTENT_STATUSES: ReadonlySet<Stripe.PaymentIntent.Status> = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
]);

type ErrorCode =
  | 'INVALID_INPUT'
  | 'PAYMENT_SESSION_INVALID'
  | 'PAYMENT_NOT_CONFIRMABLE'
  | 'EVENT_NOT_JOINABLE'
  | 'STRIPE_API';

function jsonError(status: number, error: string, errorCode: ErrorCode) {
  return NextResponse.json(
    {
      success: false,
      error,
      errorCode,
    },
    { status }
  );
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return jsonError(401, 'Unauthorized', 'PAYMENT_SESSION_INVALID');
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return jsonError(400, 'Invalid JSON body.', 'INVALID_INPUT');
    }

    const eventId = body.eventId?.trim();
    const paymentIntentId = body.paymentIntentId?.trim();
    if (!eventId || !paymentIntentId) {
      return jsonError(
        400,
        'Missing eventId or paymentIntentId.',
        'INVALID_INPUT'
      );
    }

    const payment = await prisma.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      select: {
        id: true,
        userId: true,
        eventId: true,
        amountCents: true,
        currency: true,
        status: true,
      },
    });

    if (!payment || payment.userId !== userId) {
      return jsonError(
        403,
        'This checkout session is not valid for your account.',
        'PAYMENT_SESSION_INVALID'
      );
    }

    if (payment.eventId !== eventId) {
      return jsonError(
        409,
        'This checkout session does not match the selected event.',
        'PAYMENT_SESSION_INVALID'
      );
    }

    if (payment.status !== PaymentStatus.pending) {
      return jsonError(
        409,
        'This payment can no longer be confirmed.',
        'PAYMENT_NOT_CONFIRMABLE'
      );
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        date: true,
        archivedAt: true,
      },
    });

    if (!event) {
      return jsonError(404, 'Event not found.', 'PAYMENT_SESSION_INVALID');
    }

    const joinability = getEventJoinability({
      date: event.date,
      archivedAt: event.archivedAt,
    });
    if (!joinability.isJoinable) {
      throw new EventNotJoinableError(joinability.message);
    }

    let intent;
    try {
      intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error) {
      throw new StripeApiError(
        `Failed to retrieve payment intent before confirmation: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error
      );
    }

    if (
      typeof intent.metadata.eventId === 'string' &&
      intent.metadata.eventId.length > 0 &&
      intent.metadata.eventId !== eventId
    ) {
      return jsonError(
        409,
        'This payment intent does not belong to the selected event.',
        'PAYMENT_SESSION_INVALID'
      );
    }

    if (
      typeof intent.metadata.userId === 'string' &&
      intent.metadata.userId.length > 0 &&
      intent.metadata.userId !== userId
    ) {
      return jsonError(
        409,
        'This payment intent does not belong to the authenticated user.',
        'PAYMENT_SESSION_INVALID'
      );
    }

    const intentCurrency = intent.currency?.toUpperCase() ?? null;
    if (
      intent.amount !== payment.amountCents ||
      !intentCurrency ||
      intentCurrency !== payment.currency.toUpperCase()
    ) {
      return jsonError(
        409,
        'This payment intent no longer matches the expected checkout amount.',
        'PAYMENT_SESSION_INVALID'
      );
    }

    if (!CONFIRMABLE_INTENT_STATUSES.has(intent.status)) {
      return jsonError(
        409,
        `This payment intent is not confirmable in its current state (${intent.status}).`,
        'PAYMENT_NOT_CONFIRMABLE'
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        paymentIntentId: intent.id,
        status: intent.status,
      },
    });
  } catch (error: unknown) {
    if (isPaymentError(error)) {
      const statusCode = mapPaymentErrorToStatusCode(error);
      return jsonError(
        statusCode,
        error.message,
        error.code === 'EVENT_NOT_JOINABLE' ? 'EVENT_NOT_JOINABLE' : 'STRIPE_API'
      );
    }

    console.error('[POST /api/payments/pre-confirm] error', error);
    return jsonError(500, 'Failed to validate payment confirmation.', 'STRIPE_API');
  }
}
