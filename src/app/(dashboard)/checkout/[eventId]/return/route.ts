import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Return handler for Stripe redirect flows (3DS, etc).
 *
 * This route intercepts the Stripe redirect back from 3DS flows and performs
 * the following:
 * 1. Reads payment_intent_client_secret from query params (transiently only)
 * 2. Sets a short-lived, non-sensitive cookie containing only the payment_intent id
 * 3. Issues a 303 redirect to the clean success URL
 *
 * This ensures payment_intent_client_secret never appears in the final URL,
 * browser history, or referrer headers.
 *
 * Never logs the secret or client_secret query params.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  const url = new URL(req.url);

  // Read payment_intent id from query params (transient, not logged)
  const paymentIntentId = url.searchParams.get('payment_intent');

  // Build the response to the clean success URL
  const cleanUrl = new URL(`/checkout/${eventId}/success`, url.origin);

  const response = NextResponse.redirect(cleanUrl, {
    status: 303, // See Other - tells browser this is a temporary redirect with safe idempotency
  });

  // Set a short-lived, non-sensitive cookie containing only the payment_intent id
  // This allows the client to detect that we're returning from a 3DS redirect flow
  // and show the success state in the modal.
  // Non-HttpOnly: OK here because it contains only the intent id (not the secret)
  // Max-Age: 20 seconds (expiration: sufficient for page to load and detect)
  if (paymentIntentId) {
    response.cookies.set('stripe_return_intent', paymentIntentId, {
      maxAge: 20,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      httpOnly: false, // Non-HttpOnly so JS can read it
    });
  }

  return response;
}
