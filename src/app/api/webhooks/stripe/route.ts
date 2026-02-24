export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe, getStripeWebhookSecret } from '@/lib/stripe';
import { confirmPaidRsvpByIntent, markPaymentFailed, markPaymentProcessing, markPaymentCanceled } from '@/lib/payments/confirmPaidRsvp';

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
      await confirmPaidRsvpByIntent(intent.id);
    }

    // Informational state: processing
    if (event.type === 'payment_intent.processing') {
      const intent = event.data.object as Stripe.PaymentIntent;
      await markPaymentProcessing(intent.id);
    }

    // Final failure/cancel
    if (event.type === 'payment_intent.canceled' || event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object as Stripe.PaymentIntent;
      await markPaymentCanceled(intent.id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/webhooks/stripe] error', error);
    return NextResponse.json({ success: false, error: 'Webhook handling failed' }, { status: 500 });
  }
}
