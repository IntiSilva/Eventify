import Stripe from 'stripe';

const MISSING_STRIPE_SECRET_KEY_MESSAGE = '[stripe] STRIPE_SECRET_KEY is not configured.';

let stripeClient: Stripe | null = null;
let loggedMissingSecretKeyWarning = false;

function readStripeSecretKey(): string {
  const value = process.env.STRIPE_SECRET_KEY?.trim();
  if (!value) {
    if (!loggedMissingSecretKeyWarning) {
      console.warn(MISSING_STRIPE_SECRET_KEY_MESSAGE);
      loggedMissingSecretKeyWarning = true;
    }
    throw new Error(MISSING_STRIPE_SECRET_KEY_MESSAGE);
  }
  return value;
}

export function assertStripeConfigured(): void {
  readStripeSecretKey();
}

export function getStripe(): Stripe {
  if (stripeClient) {
    return stripeClient;
  }
  stripeClient = new Stripe(readStripeSecretKey());
  return stripeClient;
}

export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const client = getStripe();
    const value = Reflect.get(client as unknown as object, prop);
    return typeof value === 'function' ? value.bind(client) : value;
  },
  has(_target, prop) {
    return prop in getStripe();
  },
});

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
