export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe, getStripeWebhookSecret } from '@/lib/stripe';
import {
  confirmPaidRsvpByIntent,
  markPaymentFailed,
  markPaymentProcessing,
  markPaymentCanceled,
} from '@/lib/payments/confirmPaidRsvp';
import { syncRefundRequestFromStripeRefund } from '@/lib/payments/refunds';

function logStripeDisputeEvent(eventType: Stripe.Event['type'], dispute: Stripe.Dispute) {
  const chargeId =
    typeof dispute.charge === 'string'
      ? dispute.charge
      : dispute.charge?.id ?? 'unknown';
  const paymentIntentId =
    typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id ?? 'unknown';
  const logMethod =
    eventType === 'charge.dispute.closed' ? console.info : console.warn;

  logMethod(
    `[stripe-dispute] ${eventType} disputeId=${dispute.id} chargeId=${chargeId} paymentIntentId=${paymentIntentId} status=${dispute.status ?? 'unknown'} reason=${dispute.reason ?? 'unknown'}`
  );
}

export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ success: false, error: 'Missing stripe-signature header' }, { status: 400 });
  }

  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, getStripeWebhookSecret());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid signature';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      await confirmPaidRsvpByIntent(intent.id, intent);
    }

    // Informational state: processing
    if (event.type === 'payment_intent.processing') {
      const intent = event.data.object as Stripe.PaymentIntent;
      await markPaymentProcessing(intent.id);
    }

    // Final failure/cancel
    if (event.type === 'payment_intent.canceled') {
      const intent = event.data.object as Stripe.PaymentIntent;
      await markPaymentCanceled(intent.id);
    }

    if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object as Stripe.PaymentIntent;
      await markPaymentFailed(intent.id);
    }

    if (event.type === 'refund.updated') {
      const refund = event.data.object as Stripe.Refund;
      await syncRefundRequestFromStripeRefund(refund);
    }

    if (
      event.type === 'charge.dispute.created' ||
      event.type === 'charge.dispute.updated' ||
      event.type === 'charge.dispute.closed'
    ) {
      const dispute = event.data.object as Stripe.Dispute;
      logStripeDisputeEvent(event.type, dispute);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/webhooks/stripe] error', error);
    return NextResponse.json({ success: false, error: 'Webhook handling failed' }, { status: 500 });
  }
}
