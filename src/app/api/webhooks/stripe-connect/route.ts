export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import {
  getStripeConnectWebhookSecret,
  stripe,
} from '@/lib/stripe';
import {
  buildStripeConnectOnboardingCompletedAtUpdate,
  buildStripeConnectUserUpdateFromAccount,
  shouldMarkStripeConnectOnboardingCompleted,
} from '@/lib/payments/stripeConnectSync';

function readStripeConnectClerkId(account: Stripe.Account): string | null {
  const value = account.metadata?.clerkId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function assertMetadataBindingConsistency(params: {
  clerkId: string;
  accountId: string;
}): Promise<void> {
  const { clerkId, accountId } = params;

  const accountOwner = await prisma.user.findUnique({
    where: { stripeConnectAccountId: accountId },
    select: { clerkId: true },
  });

  if (accountOwner && accountOwner.clerkId !== clerkId) {
    console.warn(
      `[stripe-connect-webhook] account ${accountId} is already bound to clerkId=${accountOwner.clerkId}; refusing metadata reassignment to clerkId=${clerkId}; returning 500 so Stripe retries`
    );
    throw new Error(
      `Connected account ${accountId} is already bound to a different user (${accountOwner.clerkId})`
    );
  }

  const targetUser = await prisma.user.findUnique({
    where: { clerkId },
    select: { stripeConnectAccountId: true },
  });

  if (
    targetUser?.stripeConnectAccountId &&
    targetUser.stripeConnectAccountId !== accountId
  ) {
    console.warn(
      `[stripe-connect-webhook] clerkId=${clerkId} is already bound to account ${targetUser.stripeConnectAccountId}; refusing reassignment to account ${accountId}; returning 500 so Stripe retries`
    );
    throw new Error(
      `User ${clerkId} is already bound to connected account ${targetUser.stripeConnectAccountId}`
    );
  }
}

async function syncConnectedAccountStatus(account: Stripe.Account): Promise<void> {
  const now = new Date();
  const clerkId = readStripeConnectClerkId(account);

  if (clerkId) {
    await assertMetadataBindingConsistency({
      clerkId,
      accountId: account.id,
    });
  }

  const where = clerkId
    ? { clerkId }
    : { stripeConnectAccountId: account.id };
  const result = await prisma.user.updateMany({
    where,
    data: buildStripeConnectUserUpdateFromAccount(account, now),
  });

  if (result.count === 0) {
    if (clerkId) {
      console.warn(
        `[stripe-connect-webhook] no user found for clerkId=${clerkId} account=${account.id}; returning 500 so Stripe retries`
      );
      throw new Error(
        `No user found for connected account ${account.id} with metadata clerkId=${clerkId}`
      );
    }

    console.warn(
      `[stripe-connect-webhook] no user found for connected account ${account.id}`
    );
    return;
  }

  if (!shouldMarkStripeConnectOnboardingCompleted(account)) {
    return;
  }

  await prisma.user.updateMany({
    where: clerkId
      ? {
          clerkId,
          stripeConnectOnboardingCompletedAt: null,
        }
      : {
          stripeConnectAccountId: account.id,
          stripeConnectOnboardingCompletedAt: null,
        },
    data: buildStripeConnectOnboardingCompletedAtUpdate(now),
  });
}

export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json(
      { success: false, error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      getStripeConnectWebhookSecret()
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid signature';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }

  try {
    if (event.type === 'account.updated') {
      const account = event.data.object as Stripe.Account;
      await syncConnectedAccountStatus(account);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(
      `[POST /api/webhooks/stripe-connect] failed to process ${event.type}`,
      error
    );
    return NextResponse.json(
      { success: false, error: 'Webhook handling failed' },
      { status: 500 }
    );
  }
}
