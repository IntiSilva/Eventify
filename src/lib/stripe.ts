import Stripe from 'stripe';

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  console.warn('[stripe] STRIPE_SECRET_KEY is not configured.');
}

export const stripe = new Stripe(secretKey || 'sk_test_missing');

export function getStripeWebhookSecret(): string {
  const value = process.env.STRIPE_WEBHOOK_SECRET;
  if (!value) throw new Error('Missing STRIPE_WEBHOOK_SECRET');
  return value;
}

export function getStripeConnectWebhookSecret(): string {
  const value = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!value) throw new Error('Missing STRIPE_CONNECT_WEBHOOK_SECRET');
  return value;
}
