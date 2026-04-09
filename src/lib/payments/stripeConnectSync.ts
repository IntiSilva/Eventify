import 'server-only';

import type Stripe from 'stripe';
import type { Prisma } from '@/generated/prisma';
import { isStripeConnectReady } from '@/lib/payments/stripeConnectReadiness';

export function buildStripeConnectUserUpdateFromAccount(
  account: Stripe.Account,
  now: Date
): Prisma.UserUpdateManyMutationInput {
  return {
    stripeConnectAccountId: account.id,
    stripeConnectChargesEnabled: Boolean(account.charges_enabled),
    stripeConnectPayoutsEnabled: Boolean(account.payouts_enabled),
    stripeConnectDetailsSubmitted: Boolean(account.details_submitted),
    stripeConnectStatusUpdatedAt: now,
  };
}

export function shouldMarkStripeConnectOnboardingCompleted(
  account: Pick<
    Stripe.Account,
    'id' | 'charges_enabled' | 'payouts_enabled' | 'details_submitted'
  >
): boolean {
  return isStripeConnectReady({
    stripeConnectAccountId: account.id,
    stripeConnectChargesEnabled: Boolean(account.charges_enabled),
    stripeConnectPayoutsEnabled: Boolean(account.payouts_enabled),
    stripeConnectDetailsSubmitted: Boolean(account.details_submitted),
  });
}

export function buildStripeConnectOnboardingCompletedAtUpdate(
  now: Date
): Prisma.UserUpdateManyMutationInput {
  return {
    stripeConnectOnboardingCompletedAt: now,
  };
}
