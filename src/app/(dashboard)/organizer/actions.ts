'use server';

import { auth } from '@clerk/nextjs/server';
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import type Stripe from 'stripe';
import { UserRole } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import {
  buildStripeConnectOnboardingCompletedAtUpdate,
  buildStripeConnectUserUpdateFromAccount,
  shouldMarkStripeConnectOnboardingCompleted,
} from '@/lib/payments/stripeConnectSync';
import type { StripeConnectStatus } from '@/types/stripeConnect';

type StartConnectOnboardingResult =
  | { success: true; url: string; status: StripeConnectStatus }
  | { success: false; error: string; status?: StripeConnectStatus };

type RefreshConnectStatusResult =
  | { success: true; status: StripeConnectStatus }
  | { success: false; error: string; status?: StripeConnectStatus };

type GetConnectStatusResult =
  | { success: true; status: StripeConnectStatus }
  | { success: false; error: string; status?: StripeConnectStatus };

type OrganizerConnectUser = {
  clerkId: string;
  role: UserRole;
  email: string;
  stripeConnectAccountId: string | null;
  stripeConnectChargesEnabled: boolean;
  stripeConnectPayoutsEnabled: boolean;
  stripeConnectDetailsSubmitted: boolean;
  stripeConnectOnboardingCompletedAt: Date | null;
  stripeConnectStatusUpdatedAt: Date | null;
};

const CONNECT_ACCOUNT_CREATION_PREFIX = 'creating:';
const CONNECT_SETUP_IN_PROGRESS_ERROR =
  'Stripe Connect setup is already in progress. Please retry in a few seconds.';

function normalizeSiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function normalizeHostCandidate(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const firstValue = raw.split(',')[0]?.trim();
  if (!firstValue) return null;

  try {
    const normalized = new URL(
      firstValue.includes('://') ? firstValue : `https://${firstValue}`
    );
    return normalized.host.toLowerCase();
  } catch {
    return null;
  }
}

function getConfiguredSiteUrl(): string {
  return normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL) || 'http://localhost:3000';
}

function getAllowedSiteHosts(): Set<string> {
  const allowed = new Set<string>([
    'localhost',
    'localhost:3000',
    '127.0.0.1',
    '127.0.0.1:3000',
    '[::1]',
    '[::1]:3000',
  ]);

  const configuredHost = normalizeHostCandidate(getConfiguredSiteUrl());
  if (configuredHost) {
    allowed.add(configuredHost);
  }

  const extraHosts = process.env.STRIPE_CONNECT_ALLOWED_HOSTS;
  if (extraHosts) {
    for (const entry of extraHosts.split(',')) {
      const normalized = normalizeHostCandidate(entry);
      if (normalized) {
        allowed.add(normalized);
      }
    }
  }

  return allowed;
}

function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.startsWith('localhost:') ||
    host === '127.0.0.1' ||
    host.startsWith('127.0.0.1:') ||
    host === '[::1]' ||
    host.startsWith('[::1]:')
  );
}


function getAllowedOrigin(
  rawOrigin: string | null | undefined,
  allowedHosts: Set<string>
): string | null {
  const origin = normalizeSiteUrl(rawOrigin);
  if (!origin) return null;

  const host = normalizeHostCandidate(origin);
  if (!host || !allowedHosts.has(host)) return null;

  // Allow http only for localhost/127/[::1]
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === 'http:' && !isLocalHost(host)) {
      return null;
    }
  } catch {
    return null;
  }

  return origin;
}
function getAllowedHeaderHost(
  rawHost: string | null | undefined,
  allowedHosts: Set<string>
): string | null {
  const host = normalizeHostCandidate(rawHost);
  if (!host || !allowedHosts.has(host)) return null;

  return host;
}

async function getSiteUrl(): Promise<string> {
  const headerStore = await headers();
  const allowedHosts = getAllowedSiteHosts();

  const origin = getAllowedOrigin(headerStore.get('origin'), allowedHosts);
  if (origin) return origin;

  const forwardedProto = headerStore.get('x-forwarded-proto');
  const forwardedHost = headerStore.get('x-forwarded-host') ?? headerStore.get('host');
  const allowedHost = getAllowedHeaderHost(forwardedHost, allowedHosts);

  if (allowedHost) {
    const protoFromHeader =
      forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : null;

    // Http if host is local; if not, force https.
    const inferredProtocolRaw = protoFromHeader ?? (isLocalHost(allowedHost) ? 'http' : 'https');
    const inferredProtocol =
      inferredProtocolRaw === 'http' && !isLocalHost(allowedHost) ? 'https' : inferredProtocolRaw;

    const inferred = normalizeSiteUrl(`${inferredProtocol}://${allowedHost}`);
    if (inferred) return inferred;
  }

  return getConfiguredSiteUrl();
}

function isConnectCreationClaim(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(CONNECT_ACCOUNT_CREATION_PREFIX);
}

function isStripeAccountMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const maybeWithCode = error as { code?: string; raw?: { code?: string } };
  const code = maybeWithCode.code ?? maybeWithCode.raw?.code;
  if (code === 'resource_missing') return true;

  return error.message.toLowerCase().includes('no such account');
}

function mapStatus(user: OrganizerConnectUser): StripeConnectStatus {
  return {
    accountId: user.stripeConnectAccountId,
    chargesEnabled: user.stripeConnectChargesEnabled,
    payoutsEnabled: user.stripeConnectPayoutsEnabled,
    detailsSubmitted: user.stripeConnectDetailsSubmitted,
    onboardingCompletedAt: user.stripeConnectOnboardingCompletedAt
      ? user.stripeConnectOnboardingCompletedAt.toISOString()
      : null,
    statusUpdatedAt: user.stripeConnectStatusUpdatedAt
      ? user.stripeConnectStatusUpdatedAt.toISOString()
      : null,
  };
}

async function getAuthorizedOrganizer(): Promise<
  { ok: true; user: OrganizerConnectUser } | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: 'Unauthorized' };

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: {
      clerkId: true,
      role: true,
      email: true,
      stripeConnectAccountId: true,
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
      stripeConnectDetailsSubmitted: true,
      stripeConnectOnboardingCompletedAt: true,
      stripeConnectStatusUpdatedAt: true,
    },
  });

  if (!user) return { ok: false, error: 'User not found' };
  if (user.role !== UserRole.organizer) {
    return { ok: false, error: 'Only organizers can connect Stripe payouts' };
  }

  return { ok: true, user };
}

async function releaseConnectClaim(clerkId: string, claimValue: string): Promise<void> {
  try {
    await prisma.user.updateMany({
      where: {
        clerkId,
        stripeConnectAccountId: claimValue,
      },
      data: {
        stripeConnectAccountId: null,
      },
    });
  } catch (error) {
    console.warn(
      `[stripe-connect] failed to release account creation claim for ${clerkId}`,
      error
    );
  }
}

async function retrieveExistingConnectAccount(
  user: OrganizerConnectUser,
  accountId: string
): Promise<Stripe.Account | null> {
  try {
    return await stripe.accounts.retrieve(accountId);
  } catch (error) {
    if (!isStripeAccountMissingError(error)) {
      throw error;
    }

    console.warn(
      `[stripe-connect] account ${accountId} missing for ${user.clerkId}; clearing stale id before recreate`
    );
    await prisma.user.updateMany({
      where: {
        clerkId: user.clerkId,
        stripeConnectAccountId: accountId,
      },
      data: {
        stripeConnectAccountId: null,
      },
    });
    return null;
  }
}

async function syncUserFromStripeAccount(
  user: OrganizerConnectUser,
  account: Stripe.Account
): Promise<OrganizerConnectUser> {
  const now = new Date();
  const shouldSetOnboardingCompletedAt =
    shouldMarkStripeConnectOnboardingCompleted(account) &&
    user.stripeConnectOnboardingCompletedAt === null;

  return prisma.user.update({
    where: { clerkId: user.clerkId },
    data: {
      ...buildStripeConnectUserUpdateFromAccount(account, now),
      ...(shouldSetOnboardingCompletedAt
        ? buildStripeConnectOnboardingCompletedAtUpdate(now)
        : {}),
    },
    select: {
      clerkId: true,
      role: true,
      email: true,
      stripeConnectAccountId: true,
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
      stripeConnectDetailsSubmitted: true,
      stripeConnectOnboardingCompletedAt: true,
      stripeConnectStatusUpdatedAt: true,
    },
  });
}

async function createConnectAccountWithClaim(
  user: OrganizerConnectUser,
  attempt = 0
): Promise<Stripe.Account> {
  const claimValue = `${CONNECT_ACCOUNT_CREATION_PREFIX}${randomUUID()}`;
  const claimed = await prisma.user.updateMany({
    where: {
      clerkId: user.clerkId,
      stripeConnectAccountId: null,
    },
    data: {
      stripeConnectAccountId: claimValue,
    },
  });

  if (claimed.count === 0) {
    const latest = await prisma.user.findUnique({
      where: { clerkId: user.clerkId },
      select: { stripeConnectAccountId: true },
    });

    if (!latest) {
      throw new Error('User not found');
    }

    const latestAccountId = latest.stripeConnectAccountId;
    if (!latestAccountId) {
      if (attempt >= 1) {
        throw new Error('Could not start Stripe Connect setup. Please retry.');
      }
      return createConnectAccountWithClaim(user, attempt + 1);
    }

    if (isConnectCreationClaim(latestAccountId)) {
      throw new Error(CONNECT_SETUP_IN_PROGRESS_ERROR);
    }

    const existing = await retrieveExistingConnectAccount(user, latestAccountId);
    if (existing) {
      return existing;
    }

    if (attempt >= 1) {
      throw new Error('Could not recreate Stripe Connect account. Please retry.');
    }
    return createConnectAccountWithClaim(user, attempt + 1);
  }

  try {
    const created = await stripe.accounts.create({
      type: 'express',
      country: process.env.STRIPE_CONNECT_DEFAULT_COUNTRY || 'US',
      email: user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        clerkId: user.clerkId,
      },
    });

    const swapped = await prisma.user.updateMany({
      where: {
        clerkId: user.clerkId,
        stripeConnectAccountId: claimValue,
      },
      data: {
        stripeConnectAccountId: created.id,
      },
    });

    if (swapped.count === 0) {
      console.error(
        `[stripe-connect] failed to persist account ${created.id} for ${user.clerkId}; claim was lost`
      );
      throw new Error('Could not finalize Stripe Connect setup. Please retry.');
    }

    return created;
  } catch (error) {
    await releaseConnectClaim(user.clerkId, claimValue);
    throw error;
  }
}

async function ensureConnectAccount(user: OrganizerConnectUser): Promise<Stripe.Account> {
  if (user.stripeConnectAccountId) {
    if (isConnectCreationClaim(user.stripeConnectAccountId)) {
      throw new Error(CONNECT_SETUP_IN_PROGRESS_ERROR);
    }

    const existing = await retrieveExistingConnectAccount(
      user,
      user.stripeConnectAccountId
    );
    if (existing) {
      return existing;
    }
  }

  return createConnectAccountWithClaim(user);
}

export async function getConnectStatus(): Promise<GetConnectStatusResult> {
  const authz = await getAuthorizedOrganizer();
  if (!authz.ok) return { success: false, error: authz.error };

  return { success: true, status: mapStatus(authz.user) };
}

export async function refreshConnectStatus(): Promise<RefreshConnectStatusResult> {
  const authz = await getAuthorizedOrganizer();
  if (!authz.ok) return { success: false, error: authz.error };
  const { user } = authz;

  if (!user.stripeConnectAccountId) {
    return { success: true, status: mapStatus(user) };
  }

  try {
    const account = await stripe.accounts.retrieve(user.stripeConnectAccountId);
    const updated = await syncUserFromStripeAccount(user, account);
    revalidatePath('/organizer');
    return { success: true, status: mapStatus(updated) };
  } catch (error) {
    console.error(
      `[stripe-connect] failed to refresh status for user ${user.clerkId}`,
      error
    );
    return {
      success: false,
      error: 'Could not refresh Stripe Connect status. Please try again.',
      status: mapStatus(user),
    };
  }
}

export async function startConnectOnboarding(): Promise<StartConnectOnboardingResult> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { success: false, error: 'Missing STRIPE_SECRET_KEY' };
  }

  const authz = await getAuthorizedOrganizer();
  if (!authz.ok) return { success: false, error: authz.error };

  const baseUrl = await getSiteUrl();
  try {
    const account = await ensureConnectAccount(authz.user);
    const updatedUser = await syncUserFromStripeAccount(authz.user, account);

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      type: 'account_onboarding',
      refresh_url: `${baseUrl}/organizer?stripe_connect=refresh`,
      return_url: `${baseUrl}/organizer?stripe_connect=return`,
    });

    revalidatePath('/organizer');
    return { success: true, url: accountLink.url, status: mapStatus(updatedUser) };
  } catch (error) {
    const safeMessage =
      error instanceof Error && error.message === CONNECT_SETUP_IN_PROGRESS_ERROR
        ? error.message
        : 'Could not start Stripe onboarding. Please try again.';

    console.error(
      `[stripe-connect] failed to start onboarding for user ${authz.user.clerkId}`,
      error
    );
    return {
      success: false,
      error: safeMessage,
      status: mapStatus(authz.user),
    };
  }
}
