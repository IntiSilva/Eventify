import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
const ORIGINAL_ALLOWED_HOSTS = process.env.STRIPE_CONNECT_ALLOWED_HOSTS;

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  headers: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  stripe: {
    accounts: {
      retrieve: vi.fn(),
      create: vi.fn(),
    },
    accountLinks: {
      create: vi.fn(),
    },
  },
  revalidatePath: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: h.auth,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: h.prisma,
}));

vi.mock('@/lib/stripe', () => ({
  stripe: h.stripe,
}));

vi.mock('next/cache', () => ({
  revalidatePath: h.revalidatePath,
}));

vi.mock('next/headers', () => ({
  headers: h.headers,
}));

const importActions = () => import('@/app/(dashboard)/organizer/actions');

const makeOrganizer = (overrides?: Record<string, unknown>) => ({
  clerkId: 'org_123',
  role: 'organizer',
  email: 'organizer@example.com',
  stripeConnectAccountId: null,
  stripeConnectChargesEnabled: false,
  stripeConnectPayoutsEnabled: false,
  stripeConnectDetailsSubmitted: false,
  stripeConnectOnboardingCompletedAt: null,
  stripeConnectStatusUpdatedAt: null,
  ...overrides,
});

describe('organizer Stripe Connect actions', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.eventify.test';
    process.env.STRIPE_CONNECT_ALLOWED_HOSTS = 'eventify.test';
    h.auth.mockReset();
    h.auth.mockResolvedValue({ userId: 'org_123' });
    h.headers.mockReset();
    h.headers.mockResolvedValue(
      new Headers({
        origin: 'https://eventify.test',
      })
    );
    h.prisma.user.findUnique.mockReset();
    h.prisma.user.update.mockReset();
    h.prisma.user.updateMany.mockReset();
    h.prisma.user.updateMany.mockResolvedValue({ count: 1 });
    h.stripe.accounts.retrieve.mockReset();
    h.stripe.accounts.create.mockReset();
    h.stripe.accountLinks.create.mockReset();
    h.revalidatePath.mockReset();
  });

  it('startConnectOnboarding creates account + account link when organizer has no connected account', async () => {
    h.prisma.user.findUnique.mockResolvedValue(makeOrganizer());
    h.stripe.accounts.create.mockResolvedValue({
      id: 'acct_123',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });
    h.prisma.user.update.mockResolvedValue(
      makeOrganizer({
        stripeConnectAccountId: 'acct_123',
      })
    );
    h.stripe.accountLinks.create.mockResolvedValue({
      url: 'https://connect.stripe.test/onboarding',
    });

    const { startConnectOnboarding } = await importActions();
    const result = await startConnectOnboarding();

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.url).toBe('https://connect.stripe.test/onboarding');
    expect(result.status.statusUpdatedAt).toBeNull();
    expect(h.stripe.accounts.create).toHaveBeenCalledOnce();
    expect(h.prisma.user.updateMany).toHaveBeenCalledTimes(2);
    const claimCall = h.prisma.user.updateMany.mock.calls[0]?.[0] as {
      where: { stripeConnectAccountId: string | null };
    };
    expect(claimCall.where.stripeConnectAccountId).toBeNull();

    const swapCall = h.prisma.user.updateMany.mock.calls[1]?.[0] as {
      where: { stripeConnectAccountId: string };
      data: { stripeConnectAccountId: string };
    };
    expect(swapCall.where.stripeConnectAccountId.startsWith('creating:')).toBe(true);
    expect(swapCall.data.stripeConnectAccountId).toBe('acct_123');

    expect(h.stripe.accountLinks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'acct_123',
        type: 'account_onboarding',
        refresh_url: 'https://eventify.test/organizer?stripe_connect=refresh',
        return_url: 'https://eventify.test/organizer?stripe_connect=return',
      })
    );
    expect(h.revalidatePath).toHaveBeenCalledWith('/organizer');
  });

  it('falls back to NEXT_PUBLIC_SITE_URL when request headers use a non-allowlisted host', async () => {
    h.headers.mockResolvedValue(
      new Headers({
        origin: 'https://evil.example',
        host: 'evil.example',
      })
    );
    h.prisma.user.findUnique.mockResolvedValue(makeOrganizer());
    h.stripe.accounts.create.mockResolvedValue({
      id: 'acct_unsafe',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });
    h.prisma.user.update.mockResolvedValue(
      makeOrganizer({
        stripeConnectAccountId: 'acct_unsafe',
      })
    );
    h.stripe.accountLinks.create.mockResolvedValue({
      url: 'https://connect.stripe.test/onboarding',
    });

    const { startConnectOnboarding } = await importActions();
    const result = await startConnectOnboarding();

    expect(result.success).toBe(true);
    expect(h.stripe.accountLinks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        refresh_url: 'https://app.eventify.test/organizer?stripe_connect=refresh',
        return_url: 'https://app.eventify.test/organizer?stripe_connect=return',
      })
    );
  });

  it('refreshConnectStatus returns current stored status when organizer has no connected account yet', async () => {
    h.prisma.user.findUnique.mockResolvedValue(makeOrganizer());

    const { refreshConnectStatus } = await importActions();
    const result = await refreshConnectStatus();

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.status.accountId).toBeNull();
    expect(result.status.payoutsEnabled).toBe(false);
    expect(result.status.statusUpdatedAt).toBeNull();
    expect(h.stripe.accounts.retrieve).not.toHaveBeenCalled();
    expect(h.prisma.user.update).not.toHaveBeenCalled();
  });

  it('refreshConnectStatus syncs payouts-enabled flags from Stripe account', async () => {
    h.prisma.user.findUnique.mockResolvedValue(
      makeOrganizer({
        stripeConnectAccountId: 'acct_123',
      })
    );
    h.stripe.accounts.retrieve.mockResolvedValue({
      id: 'acct_123',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    });
    h.prisma.user.update.mockResolvedValue(
      makeOrganizer({
        stripeConnectAccountId: 'acct_123',
        stripeConnectChargesEnabled: true,
        stripeConnectPayoutsEnabled: true,
        stripeConnectDetailsSubmitted: true,
        stripeConnectOnboardingCompletedAt: new Date('2026-02-27T10:00:00.000Z'),
        stripeConnectStatusUpdatedAt: new Date('2026-02-27T10:01:00.000Z'),
      })
    );

    const { refreshConnectStatus } = await importActions();
    const result = await refreshConnectStatus();

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.status.accountId).toBe('acct_123');
    expect(result.status.payoutsEnabled).toBe(true);
    expect(result.status.chargesEnabled).toBe(true);
    expect(result.status.statusUpdatedAt).toBe('2026-02-27T10:01:00.000Z');
    expect(h.stripe.accounts.retrieve).toHaveBeenCalledWith('acct_123');
    expect(h.prisma.user.update).toHaveBeenCalledOnce();
    expect(h.revalidatePath).toHaveBeenCalledWith('/organizer');
  });

  it('getConnectStatus reads DB only and does not call Stripe', async () => {
    h.prisma.user.findUnique.mockResolvedValue(
      makeOrganizer({
        stripeConnectAccountId: 'acct_db',
        stripeConnectPayoutsEnabled: true,
        stripeConnectChargesEnabled: true,
        stripeConnectDetailsSubmitted: true,
        stripeConnectStatusUpdatedAt: new Date('2026-02-27T12:00:00.000Z'),
      })
    );

    const { getConnectStatus } = await importActions();
    const result = await getConnectStatus();

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.status.accountId).toBe('acct_db');
    expect(result.status.payoutsEnabled).toBe(true);
    expect(result.status.statusUpdatedAt).toBe('2026-02-27T12:00:00.000Z');
    expect(h.stripe.accounts.retrieve).not.toHaveBeenCalled();
    expect(h.stripe.accounts.create).not.toHaveBeenCalled();
    expect(h.stripe.accountLinks.create).not.toHaveBeenCalled();
  });

  it('getConnectStatus returns unauthorized when no organizer session is present', async () => {
    h.auth.mockResolvedValue({ userId: null });

    const { getConnectStatus } = await importActions();
    const result = await getConnectStatus();

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('Expected unauthorized result');
    }

    expect(result.error).toBe('Unauthorized');
    expect(h.stripe.accounts.retrieve).not.toHaveBeenCalled();
    expect(h.stripe.accounts.create).not.toHaveBeenCalled();
    expect(h.stripe.accountLinks.create).not.toHaveBeenCalled();
  });

  it('does not create a new account on transient retrieve errors', async () => {
    h.prisma.user.findUnique.mockResolvedValue(
      makeOrganizer({
        stripeConnectAccountId: 'acct_existing',
      })
    );
    h.stripe.accounts.retrieve.mockRejectedValue(
      Object.assign(new Error('Rate limited while retrieving account'), {
        code: 'rate_limit',
      })
    );

    const { startConnectOnboarding } = await importActions();
    const result = await startConnectOnboarding();

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('Expected failure result');
    }

    expect(h.stripe.accounts.create).not.toHaveBeenCalled();
    expect(h.prisma.user.updateMany).not.toHaveBeenCalled();
    expect(result.error).toBe('Could not start Stripe onboarding. Please try again.');
  });

  it('recreates account only when existing account is missing in Stripe', async () => {
    h.prisma.user.findUnique.mockResolvedValue(
      makeOrganizer({
        stripeConnectAccountId: 'acct_missing',
      })
    );
    h.stripe.accounts.retrieve.mockRejectedValueOnce(
      Object.assign(new Error('No such account: acct_missing'), {
        code: 'resource_missing',
      })
    );
    h.prisma.user.updateMany
      .mockResolvedValueOnce({ count: 1 }) // clear stale account id
      .mockResolvedValueOnce({ count: 1 }) // acquire claim
      .mockResolvedValueOnce({ count: 1 }); // swap claim to real account
    h.stripe.accounts.create.mockResolvedValue({
      id: 'acct_new',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });
    h.prisma.user.update.mockResolvedValue(
      makeOrganizer({
        stripeConnectAccountId: 'acct_new',
      })
    );
    h.stripe.accountLinks.create.mockResolvedValue({
      url: 'https://connect.stripe.test/onboarding',
    });

    const { startConnectOnboarding } = await importActions();
    const result = await startConnectOnboarding();

    expect(result.success).toBe(true);
    expect(h.stripe.accounts.create).toHaveBeenCalledOnce();
    expect(h.prisma.user.updateMany).toHaveBeenCalledTimes(3);
    expect(h.prisma.user.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        clerkId: 'org_123',
        stripeConnectAccountId: 'acct_missing',
      },
      data: {
        stripeConnectAccountId: null,
      },
    });
  });

  it('returns a clear in-progress error when another request holds the creation claim', async () => {
    h.prisma.user.findUnique
      .mockResolvedValueOnce(makeOrganizer())
      .mockResolvedValueOnce({
        stripeConnectAccountId: 'creating:other-request',
      });
    h.prisma.user.updateMany.mockResolvedValueOnce({ count: 0 });

    const { startConnectOnboarding } = await importActions();
    const result = await startConnectOnboarding();

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('Expected failure result');
    }

    expect(result.error).toContain('already in progress');
    expect(h.stripe.accounts.create).not.toHaveBeenCalled();
  });

  it('releases claim when account creation fails after claim is acquired', async () => {
    h.prisma.user.findUnique.mockResolvedValue(makeOrganizer());
    h.prisma.user.updateMany
      .mockResolvedValueOnce({ count: 1 }) // acquire claim
      .mockResolvedValueOnce({ count: 1 }); // release claim
    h.stripe.accounts.create.mockRejectedValue(new Error('Stripe network failure'));

    const { startConnectOnboarding } = await importActions();
    const result = await startConnectOnboarding();

    expect(result.success).toBe(false);
    expect(h.prisma.user.updateMany).toHaveBeenCalledTimes(2);
    const releaseCall = h.prisma.user.updateMany.mock.calls[1]?.[0] as {
      where: { stripeConnectAccountId: string };
      data: { stripeConnectAccountId: null };
    };
    expect(releaseCall.where.stripeConnectAccountId.startsWith('creating:')).toBe(
      true
    );
    expect(releaseCall.data.stripeConnectAccountId).toBeNull();
    expect(h.stripe.accountLinks.create).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
  process.env.STRIPE_CONNECT_ALLOWED_HOSTS = ORIGINAL_ALLOWED_HOSTS;
});
