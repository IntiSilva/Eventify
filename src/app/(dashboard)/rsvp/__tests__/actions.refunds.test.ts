import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PaymentPayoutTarget,
  PaymentStatus,
  RefundRequestSource,
  RefundRequestStatus,
  UserRole,
} from '@/generated/prisma';

const h = vi.hoisted(() => ({
  authUserId: 'buyer_1' as string | null,
  refundCutoffHours: 4,
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    refundRequest: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
  stripe: {
    refunds: {
      create: vi.fn(),
    },
    paymentIntents: {
      retrieve: vi.fn(),
    },
  },
  syncRefundRequestFromStripeRefund: vi.fn(),
  syncRsvpAttendanceEntitlementFromRefundStatus: vi.fn(),
  evaluateIsFullRefund: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: h.authUserId }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: h.prisma,
}));

vi.mock('@/lib/stripe', () => ({
  stripe: h.stripe,
}));

vi.mock('@/lib/constants', () => ({
  computeAutoFeatured: vi.fn(() => false),
}));

vi.mock('@/lib/payments/confirmPaidRsvp', () => ({
  linkRsvpToSucceededPayment: vi.fn(),
}));

vi.mock('@/lib/payments/refundConfig', () => ({
  getRefundRequestCutoffHours: () => h.refundCutoffHours,
}));

vi.mock('@/lib/payments/refunds', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments/refunds')>(
    '@/lib/payments/refunds'
  );
  return {
    ...actual,
    syncRefundRequestFromStripeRefund: h.syncRefundRequestFromStripeRefund,
  };
});

vi.mock('@/lib/payments/rsvpEntitlement', () => ({
  syncRsvpAttendanceEntitlementFromRefundStatus:
    h.syncRsvpAttendanceEntitlementFromRefundStatus,
  evaluateIsFullRefund: h.evaluateIsFullRefund,
}));

import {
  approveRefund,
  forceRefundByPayment,
  getMyRefundContextForEvent,
  listRefundRequestsForViewer,
  rejectRefund,
  requestRefund,
} from '@/app/(dashboard)/rsvp/actions';

const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('rsvp/actions refunds', () => {
  beforeEach(() => {
    vi.useRealTimers();
    h.authUserId = 'buyer_1';
    h.refundCutoffHours = 4;
    h.prisma.user.findUnique.mockReset();
    h.prisma.payment.findFirst.mockReset();
    h.prisma.payment.findUnique.mockReset();
    h.prisma.refundRequest.findMany.mockReset();
    h.prisma.refundRequest.findUnique.mockReset();
    h.prisma.refundRequest.create.mockReset();
    h.prisma.refundRequest.updateMany.mockReset();
    h.prisma.refundRequest.update.mockReset();
    h.stripe.refunds.create.mockReset();
    h.stripe.paymentIntents.retrieve.mockReset();
    h.syncRefundRequestFromStripeRefund.mockReset();
    h.syncRefundRequestFromStripeRefund.mockResolvedValue(undefined);
    h.syncRsvpAttendanceEntitlementFromRefundStatus.mockReset();
    h.syncRsvpAttendanceEntitlementFromRefundStatus.mockResolvedValue({
      kind: 'updated',
      paymentId: 'pay_default',
      rsvpId: 'rsvp_default',
      targetEntitlement: 'refund_pending_hold',
      previousEntitlement: 'active',
      lookup: 'payment_rsvp_id',
    });
    h.evaluateIsFullRefund.mockReset();
    h.evaluateIsFullRefund.mockReturnValue(true);
    consoleErrorSpy.mockClear();
  });

  it('requestRefund succeeds for the buyer on a succeeded payment', async () => {
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'buyer_1',
      role: UserRole.user,
    });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'buyer_1',
      status: PaymentStatus.succeeded,
      event: {
        date: new Date('2099-03-06T20:00:00.000Z'),
      },
      refundRequest: null,
    });
    h.prisma.refundRequest.create.mockResolvedValue({
      id: 'rr_1',
      paymentId: 'pay_1',
      status: RefundRequestStatus.requested,
      stripeRefundId: null,
    });

    const result = await requestRefund('pay_1', 'Unable to attend');

    expect(result).toEqual({
      success: true,
      message: expect.stringContaining('Refund request submitted'),
      data: {
        id: 'rr_1',
        paymentId: 'pay_1',
        status: RefundRequestStatus.requested,
        stripeRefundId: null,
      },
    });
    expect(h.prisma.refundRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentId: 'pay_1',
          requestedByUserId: 'buyer_1',
          source: RefundRequestSource.USER_REQUEST,
          reason: 'Unable to attend',
          status: RefundRequestStatus.requested,
        }),
      })
    );
    expect(h.syncRsvpAttendanceEntitlementFromRefundStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay_1',
        refundStatus: RefundRequestStatus.requested,
      })
    );
  });

  it('getMyRefundContextForEvent returns the latest succeeded payment and refund request', async () => {
    h.prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_1',
      status: PaymentStatus.succeeded,
      refundRequest: {
        id: 'rr_1',
        status: RefundRequestStatus.requested,
        reason: 'Scheduling conflict',
        createdAt: new Date('2026-02-27T18:00:00.000Z'),
      },
    });

    const result = await getMyRefundContextForEvent('evt_1');

    expect(result).toEqual({
      success: true,
      data: {
        paymentId: 'pay_1',
        paymentStatus: PaymentStatus.succeeded,
        refundRequest: {
          id: 'rr_1',
          status: RefundRequestStatus.requested,
          reason: 'Scheduling conflict',
          createdAt: '2026-02-27T18:00:00.000Z',
        },
        canRequest: false,
        blockedReason: null,
        blockedMessage: 'A refund request already exists for this payment.',
      },
    });
    expect(h.prisma.payment.findFirst).toHaveBeenCalledWith({
      where: {
        eventId: 'evt_1',
        userId: 'buyer_1',
        status: PaymentStatus.succeeded,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        event: {
          select: {
            date: true,
          },
        },
        refundRequest: {
          select: {
            id: true,
            status: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });
  });


  it('getMyRefundContextForEvent reports NO_PAYMENT when no completed payment exists', async () => {
    h.prisma.payment.findFirst.mockResolvedValue(null);

    const result = await getMyRefundContextForEvent('evt_1');

    expect(result).toEqual({
      success: true,
      data: {
        paymentId: null,
        paymentStatus: null,
        refundRequest: null,
        canRequest: false,
        blockedReason: 'NO_PAYMENT',
        blockedMessage: 'No payment found for this event.',
      },
    });
  });

  it('getMyRefundContextForEvent reports EVENT_STARTED when the event has already started', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00.000Z'));
    h.prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_started',
      status: PaymentStatus.succeeded,
      event: {
        date: new Date('2026-03-03T11:00:00.000Z'),
      },
      refundRequest: null,
    });

    const result = await getMyRefundContextForEvent('evt_started');

    expect(result).toEqual({
      success: true,
      data: {
        paymentId: 'pay_started',
        paymentStatus: PaymentStatus.succeeded,
        refundRequest: null,
        canRequest: false,
        blockedReason: 'EVENT_STARTED',
        blockedMessage: 'Refunds are unavailable because the event already started.',
      },
    });
    vi.useRealTimers();
  });

  it('getMyRefundContextForEvent reports CUTOFF when the refund window has closed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T20:00:00.000Z'));
    h.prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_cutoff',
      status: PaymentStatus.succeeded,
      event: {
        date: new Date('2026-03-01T23:59:00.000Z'),
      },
      refundRequest: null,
    });

    const result = await getMyRefundContextForEvent('evt_cutoff');

    expect(result).toEqual({
      success: true,
      data: {
        paymentId: 'pay_cutoff',
        paymentStatus: PaymentStatus.succeeded,
        refundRequest: null,
        canRequest: false,
        blockedReason: 'CUTOFF',
        blockedMessage: 'Refund requests must be submitted at least 4 hours before the event.',
      },
    });
    vi.useRealTimers();
  });
  it('getMyRefundContextForEvent returns a stable unauthorized code when the viewer is signed out', async () => {
    h.authUserId = null;

    const result = await getMyRefundContextForEvent('evt_1');

    expect(result).toEqual({
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Unauthorized. Please sign in to view refund status.',
      data: null,
    });
    expect(h.prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it('requestRefund rejects a non-owner buyer', async () => {
    h.authUserId = 'buyer_2';
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'buyer_2',
      role: UserRole.user,
    });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'buyer_1',
      status: PaymentStatus.succeeded,
      event: {
        date: new Date('2026-03-03T20:00:00.000Z'),
      },
      refundRequest: null,
    });

    const result = await requestRefund('pay_1');

    expect(result).toEqual({
      success: false,
      message: 'You can only request a refund for your own ticket.',
      data: null,
    });
    expect(h.prisma.refundRequest.create).not.toHaveBeenCalled();
  });

  it('listRefundRequestsForViewer scopes organizers to their own events', async () => {
    h.authUserId = 'org_1';
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'org_1',
      role: UserRole.organizer,
    });
    h.prisma.refundRequest.findMany.mockResolvedValue([
      {
        id: 'rr_1',
        status: RefundRequestStatus.requested,
        source: RefundRequestSource.USER_REQUEST,
        reason: 'Cannot attend',
        decisionNote: null,
        createdAt: new Date('2026-02-27T19:00:00.000Z'),
        stripeRefundId: null,
        attemptCount: 0,
        lastError: null,
        lastAttemptAt: null,
        payment: {
          id: 'pay_1',
          amountCents: 2500,
          currency: 'usd',
          payoutTarget: PaymentPayoutTarget.organizer,
          destinationAccountId: 'acct_refund_org',
          transferGroup: 'event:evt_1',
          applicationFeeAmount: 125,
          userId: 'buyer_1',
          user: {
            username: 'buyer',
            firstName: 'Maya',
            lastName: 'Lane',
            email: 'buyer@example.com',
          },
          eventId: 'evt_1',
          event: {
            title: 'Launch Party',
            createdBy: 'org_1',
            creator: {
              username: 'organizer',
              firstName: 'Nora',
              lastName: 'Hall',
              role: UserRole.organizer,
            },
          },
        },
      },
    ]);

    const result = await listRefundRequestsForViewer();

    expect(result).toEqual({
      success: true,
      data: [
        {
          refundRequestId: 'rr_1',
          status: RefundRequestStatus.requested,
          source: RefundRequestSource.USER_REQUEST,
          reason: 'Cannot attend',
          decisionNote: null,
          createdAt: '2026-02-27T19:00:00.000Z',
          paymentId: 'pay_1',
          eventId: 'evt_1',
          eventTitle: 'Launch Party',
          organizerClerkId: 'org_1',
          organizerUsername: 'organizer',
          organizerFirstName: 'Nora',
          organizerLastName: 'Hall',
          counterpartyRole: UserRole.organizer,
          buyerUserId: 'buyer_1',
          buyerUsername: 'buyer',
          buyerFirstName: 'Maya',
          buyerLastName: 'Lane',
          buyerEmail: 'buyer@example.com',
          amountCents: 2500,
          currency: 'usd',
          payoutTarget: PaymentPayoutTarget.organizer,
          destinationAccountId: 'acct_refund_org',
          transferGroup: 'event:evt_1',
          applicationFeeAmount: 125,
          stripeRefundId: null,
          attemptCount: 0,
          lastError: null,
          lastAttemptAt: null,
        },
      ],
      filter: {
        status: 'requested',
        limit: 30,
        source: 'all',
        payoutTarget: 'all',
        search: null,
      },
      hasMore: false,
    });
    expect(h.prisma.refundRequest.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            status: RefundRequestStatus.requested,
          },
          {
            payment: {
              event: {
                createdBy: 'org_1',
              },
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 31,
      select: {
        id: true,
        status: true,
        source: true,
        reason: true,
        decisionNote: true,
        createdAt: true,
        stripeRefundId: true,
        attemptCount: true,
        lastError: true,
        lastAttemptAt: true,
        payment: {
          select: {
            id: true,
            amountCents: true,
            currency: true,
            payoutTarget: true,
            destinationAccountId: true,
            transferGroup: true,
            applicationFeeAmount: true,
            userId: true,
            eventId: true,
            user: {
              select: {
                username: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            event: {
              select: {
                title: true,
                createdBy: true,
                creator: {
                  select: {
                    username: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('listRefundRequestsForViewer lets admins query succeeded refund requests with observability fields', async () => {
    h.authUserId = 'admin_1';
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'admin_1',
      role: UserRole.admin,
    });
    h.prisma.refundRequest.findMany.mockResolvedValue([
      {
        id: 'rr_admin',
        status: RefundRequestStatus.succeeded,
        source: RefundRequestSource.MANUAL_OVERRIDE,
        reason: 'Weather issue',
        decisionNote: 'Approved by admin',
        createdAt: new Date('2026-02-27T20:00:00.000Z'),
        stripeRefundId: 're_admin',
        attemptCount: 2,
        lastError: null,
        lastAttemptAt: new Date('2026-02-27T20:30:00.000Z'),
        payment: {
          id: 'pay_admin',
          amountCents: 4000,
          currency: 'usd',
          payoutTarget: PaymentPayoutTarget.platform,
          destinationAccountId: null,
          transferGroup: 'event:evt_7',
          applicationFeeAmount: null,
          userId: 'buyer_7',
          user: {
            username: 'buyerseven',
            firstName: 'Ari',
            lastName: 'Stone',
            email: 'buyer7@example.com',
          },
          eventId: 'evt_7',
          event: {
            title: 'Town Hall',
            createdBy: 'org_7',
            creator: {
              username: 'orgseven',
              firstName: 'Jules',
              lastName: 'Park',
              role: UserRole.admin,
            },
          },
        },
      },
    ]);

    const result = await listRefundRequestsForViewer({ status: 'succeeded', limit: 5 });

    expect(result).toEqual({
      success: true,
      data: [
        {
          refundRequestId: 'rr_admin',
          status: RefundRequestStatus.succeeded,
          source: RefundRequestSource.MANUAL_OVERRIDE,
          reason: 'Weather issue',
          decisionNote: 'Approved by admin',
          createdAt: '2026-02-27T20:00:00.000Z',
          paymentId: 'pay_admin',
          eventId: 'evt_7',
          eventTitle: 'Town Hall',
          organizerClerkId: 'org_7',
          organizerUsername: 'orgseven',
          organizerFirstName: 'Jules',
          organizerLastName: 'Park',
          counterpartyRole: UserRole.admin,
          buyerUserId: 'buyer_7',
          buyerUsername: 'buyerseven',
          buyerFirstName: 'Ari',
          buyerLastName: 'Stone',
          buyerEmail: 'buyer7@example.com',
          amountCents: 4000,
          currency: 'usd',
          payoutTarget: PaymentPayoutTarget.platform,
          destinationAccountId: null,
          transferGroup: 'event:evt_7',
          applicationFeeAmount: null,
          stripeRefundId: 're_admin',
          attemptCount: 2,
          lastError: null,
          lastAttemptAt: '2026-02-27T20:30:00.000Z',
        },
      ],
      filter: {
        status: 'succeeded',
        limit: 5,
        source: 'all',
        payoutTarget: 'all',
        search: null,
      },
      hasMore: false,
    });
    expect(h.prisma.refundRequest.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            status: RefundRequestStatus.succeeded,
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true,
        status: true,
        source: true,
        reason: true,
        decisionNote: true,
        createdAt: true,

        stripeRefundId: true,
        attemptCount: true,
        lastError: true,
        lastAttemptAt: true,
        payment: {
          select: {
            id: true,
            amountCents: true,
            currency: true,
            payoutTarget: true,
            destinationAccountId: true,
            transferGroup: true,
            applicationFeeAmount: true,
            userId: true,
            eventId: true,
            user: {
              select: {
                username: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            event: {
              select: {
                title: true,
                createdBy: true,
                creator: {
                  select: {
                    username: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('listRefundRequestsForViewer applies admin search/source/payout filters', async () => {
    h.authUserId = 'admin_1';
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'admin_1',
      role: UserRole.admin,
    });
    h.prisma.refundRequest.findMany.mockResolvedValue([]);

    const result = await listRefundRequestsForViewer({
      status: 'requested',
      source: 'manual_override',
      payoutTarget: 'organizer',
      search: 'maya',
      limit: 10,
    });

    expect(result).toEqual({
      success: true,
      data: [],
      filter: {
        status: 'requested',
        limit: 10,
        source: 'manual_override',
        payoutTarget: 'organizer',
        search: 'maya',
      },
      hasMore: false,
    });

    expect(h.prisma.refundRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { status: RefundRequestStatus.requested },
            { source: RefundRequestSource.MANUAL_OVERRIDE },
            { payment: { payoutTarget: PaymentPayoutTarget.organizer } },
            expect.objectContaining({
              OR: expect.arrayContaining([
                {
                  payment: {
                    event: {
                      title: { contains: 'maya', mode: 'insensitive' },
                    },
                  },
                },
                {
                  payment: {
                    user: {
                      email: { contains: 'maya', mode: 'insensitive' },
                    },
                  },
                },
              ]),
            }),
          ]),
        }),
        take: 11,
      })
    );
  });

  it('requestRefund rejects payments that have not succeeded', async () => {
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'buyer_1',
      role: UserRole.user,
    });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'buyer_1',
      status: PaymentStatus.pending,
      event: {
        date: new Date('2026-03-03T20:00:00.000Z'),
      },
      refundRequest: null,
    });

    const result = await requestRefund('pay_1');

    expect(result).toEqual({
      success: false,
      message: 'Only completed payments can be refunded.',
      data: null,
    });
    expect(h.prisma.refundRequest.create).not.toHaveBeenCalled();
  });


  it('requestRefund blocks buyers after the event starts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T20:00:00.000Z'));
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'buyer_1',
      role: UserRole.user,
    });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_started',
      userId: 'buyer_1',
      status: PaymentStatus.succeeded,
      event: {
        date: new Date('2026-03-03T19:00:00.000Z'),
      },
      refundRequest: null,
    });

    const result = await requestRefund('pay_started');

    expect(result).toEqual({
      success: false,
      message: 'Refund requests are closed because this event has already started.',
      data: null,
    });
    expect(h.prisma.refundRequest.create).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it('requestRefund blocks buyers inside the cutoff window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T20:00:00.000Z'));
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'buyer_1',
      role: UserRole.user,
    });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'buyer_1',
      status: PaymentStatus.succeeded,
      event: {
        date: new Date('2026-03-01T23:59:00.000Z'),
      },
      refundRequest: null,
    });

    const result = await requestRefund('pay_1');

    expect(result).toEqual({
      success: false,
      message: 'Refund requests must be submitted at least 4 hours before the event.',
      data: null,
    });
    expect(h.prisma.refundRequest.create).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('requestRefund allows buyers at or beyond the cutoff window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T20:00:00.000Z'));
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'buyer_1',
      role: UserRole.user,
    });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'buyer_1',
      status: PaymentStatus.succeeded,
      event: {
        date: new Date('2026-03-02T00:00:00.000Z'),
      },
      refundRequest: null,
    });
    h.prisma.refundRequest.create.mockResolvedValue({
      id: 'rr_2',
      paymentId: 'pay_1',
      status: RefundRequestStatus.requested,
      stripeRefundId: null,
    });

    const result = await requestRefund('pay_1', 'Need to cancel');

    expect(result.success).toBe(true);
    expect(h.prisma.refundRequest.create).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('requestRefund blocks admin buyers inside the cutoff window (no buyer-role bypass)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T20:00:00.000Z'));
    h.authUserId = 'admin_1';
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'admin_1',
      role: UserRole.admin,
    });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_admin',
      userId: 'admin_1',
      status: PaymentStatus.succeeded,
      event: {
        date: new Date('2026-03-01T23:59:00.000Z'),
      },
      refundRequest: null,
    });

    const result = await requestRefund('pay_admin');

    expect(result).toEqual({
      success: false,
      message: 'Refund requests must be submitted at least 4 hours before the event.',
      data: null,
    });
    expect(h.prisma.refundRequest.create).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('approveRefund creates exactly one Stripe refund across repeated calls and persists the result', async () => {
    h.authUserId = 'org_1';
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'org_1',
      role: UserRole.organizer,
    });
    h.prisma.refundRequest.findUnique
      .mockResolvedValueOnce({
        id: 'rr_1',
        paymentId: 'pay_1',
        status: RefundRequestStatus.requested,
        stripeRefundId: null,
        payment: {
          id: 'pay_1',
          status: PaymentStatus.succeeded,
          amountCents: 2500,
          stripeChargeId: 'ch_1',
          stripePaymentIntentId: 'pi_1',
          payoutTarget: PaymentPayoutTarget.organizer,
          event: {
            id: 'evt_1',
            createdBy: 'org_1',
          },
        },
      })
      .mockResolvedValueOnce({
        id: 'rr_1',
        paymentId: 'pay_1',
        status: RefundRequestStatus.succeeded,
        stripeRefundId: 're_1',
        payment: {
          id: 'pay_1',
          status: PaymentStatus.succeeded,
          amountCents: 2500,
          stripeChargeId: 'ch_1',
          stripePaymentIntentId: 'pi_1',
          payoutTarget: PaymentPayoutTarget.organizer,
          event: {
            id: 'evt_1',
            createdBy: 'org_1',
          },
        },
      });
    h.prisma.refundRequest.updateMany.mockResolvedValue({ count: 1 });
    h.stripe.refunds.create.mockResolvedValue({
      id: 're_1',
      status: 'succeeded',
    });
    h.prisma.refundRequest.update.mockResolvedValue({
      id: 'rr_1',
      paymentId: 'pay_1',
      status: RefundRequestStatus.succeeded,
      stripeRefundId: 're_1',
    });

    const first = await approveRefund('rr_1');
    const second = await approveRefund('rr_1');

    expect(first).toEqual({
      success: true,
      message: 'Refund completed successfully.',
      data: {
        id: 'rr_1',
        paymentId: 'pay_1',
        status: RefundRequestStatus.succeeded,
        stripeRefundId: 're_1',
      },
    });
    expect(second).toEqual({
      success: true,
      message: 'This refund has already been completed.',
      data: {
        id: 'rr_1',
        paymentId: 'pay_1',
        status: RefundRequestStatus.succeeded,
        stripeRefundId: 're_1',
      },
    });
    expect(h.stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(h.stripe.refunds.create).toHaveBeenCalledWith(
      {
        charge: 'ch_1',
        reverse_transfer: true,
        refund_application_fee: true,
        reason: 'requested_by_customer',
      },
      {
        idempotencyKey: 'refund:rr_1',
      }
    );
    expect(h.prisma.refundRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rr_1' },
        data: expect.objectContaining({
          stripeRefundId: 're_1',
          status: RefundRequestStatus.succeeded,
        }),
      })
    );
    expect(h.syncRsvpAttendanceEntitlementFromRefundStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay_1',
        refundStatus: RefundRequestStatus.succeeded,
        isFullRefund: true,
      })
    );
  });

  it('approveRefund persists lastError and increments attemptCount when Stripe refund execution fails', async () => {
    h.authUserId = 'org_1';
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'org_1',
      role: UserRole.organizer,
    });
    h.prisma.refundRequest.findUnique.mockResolvedValue({
      id: 'rr_fail',
      paymentId: 'pay_fail',
      status: RefundRequestStatus.requested,
      stripeRefundId: null,
      payment: {
        id: 'pay_fail',
        status: PaymentStatus.succeeded,
        amountCents: 3200,
        stripeChargeId: 'ch_fail',
        stripePaymentIntentId: 'pi_fail',
        payoutTarget: PaymentPayoutTarget.organizer,
        event: {
          id: 'evt_1',
          createdBy: 'org_1',
        },
      },
    });
    h.prisma.refundRequest.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    h.stripe.refunds.create.mockRejectedValue(new Error('Stripe timeout'));

    const result = await approveRefund('rr_fail');

    expect(result).toEqual({
      success: false,
      message: 'Refund processing failed. The refund request was marked as failed.',
      data: null,
    });
    expect(h.prisma.refundRequest.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: 'rr_fail',
          status: { in: [RefundRequestStatus.requested] },
        },
        data: expect.objectContaining({
          status: RefundRequestStatus.processing,
          attemptCount: { increment: 1 },
          lastError: null,
        }),
      })
    );
    expect(h.prisma.refundRequest.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'rr_fail' },
        data: expect.objectContaining({
          status: RefundRequestStatus.failed,
          lastError: 'Stripe timeout',
        }),
      })
    );
    expect(h.syncRsvpAttendanceEntitlementFromRefundStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay_fail',
        refundStatus: RefundRequestStatus.failed,
      })
    );
  });

  it('rejectRefund restores active entitlement mapping for the payment', async () => {
    h.authUserId = 'org_1';
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'org_1',
      role: UserRole.organizer,
    });
    h.prisma.refundRequest.findUnique
      .mockResolvedValueOnce({
        id: 'rr_reject',
        paymentId: 'pay_reject',
        status: RefundRequestStatus.requested,
        stripeRefundId: null,
        payment: {
          event: {
            createdBy: 'org_1',
          },
        },
      })
      .mockResolvedValueOnce({
        id: 'rr_reject',
        paymentId: 'pay_reject',
        status: RefundRequestStatus.rejected,
        stripeRefundId: null,
      });
    h.prisma.refundRequest.updateMany.mockResolvedValue({ count: 1 });

    const result = await rejectRefund('rr_reject', 'Policy denied');

    expect(result).toEqual({
      success: true,
      message: 'Refund request rejected.',
      data: {
        id: 'rr_reject',
        paymentId: 'pay_reject',
        status: RefundRequestStatus.rejected,
        stripeRefundId: null,
      },
    });
    expect(h.syncRsvpAttendanceEntitlementFromRefundStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay_reject',
        refundStatus: RefundRequestStatus.rejected,
      })
    );
  });

  it('forceRefundByPayment lets the organizer owner issue a refund inside the buyer cutoff window', async () => {
    h.authUserId = 'org_1';
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'org_1',
      role: UserRole.organizer,
    });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_manual',
      userId: 'buyer_1',
      status: PaymentStatus.succeeded,
      stripeChargeId: 'ch_manual',
      stripePaymentIntentId: 'pi_manual',
      payoutTarget: PaymentPayoutTarget.organizer,
      event: {
        createdBy: 'org_1',
      },
      refundRequest: null,
    });
    h.prisma.refundRequest.create.mockResolvedValue({
      id: 'rr_manual',
      paymentId: 'pay_manual',
      status: RefundRequestStatus.processing,
      stripeRefundId: null,
    });
    h.stripe.refunds.create.mockResolvedValue({
      id: 're_manual',
      status: 'succeeded',
    });
    h.prisma.refundRequest.update.mockResolvedValue({
      id: 'rr_manual',
      paymentId: 'pay_manual',
      status: RefundRequestStatus.succeeded,
      stripeRefundId: 're_manual',
    });

    const result = await forceRefundByPayment('pay_manual', 'Late venue closure');

    expect(result).toEqual({
      success: true,
      message: 'Refund completed successfully.',
      data: {
        id: 'rr_manual',
        paymentId: 'pay_manual',
        status: RefundRequestStatus.succeeded,
        stripeRefundId: 're_manual',
      },
    });
    expect(h.stripe.refunds.create).toHaveBeenCalledWith(
      {
        charge: 'ch_manual',
        reverse_transfer: true,
        refund_application_fee: true,
      },
      {
        idempotencyKey: 'force-refund:pay_manual',
      }
    );
    expect(h.prisma.refundRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: RefundRequestSource.MANUAL_OVERRIDE,
        }),
      })
    );
    expect(h.syncRsvpAttendanceEntitlementFromRefundStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay_manual',
        refundStatus: RefundRequestStatus.succeeded,
        isFullRefund: true,
      })
    );
  });

  it('forceRefundByPayment uses a simple Stripe refund for platform payout target payments', async () => {
    h.authUserId = 'admin_1';
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'admin_1',
      role: UserRole.admin,
    });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_platform',
      userId: 'buyer_2',
      status: PaymentStatus.succeeded,
      stripeChargeId: 'ch_platform',
      stripePaymentIntentId: 'pi_platform',
      payoutTarget: PaymentPayoutTarget.platform,
      event: {
        createdBy: 'admin_1',
      },
      refundRequest: null,
    });
    h.prisma.refundRequest.create.mockResolvedValue({
      id: 'rr_platform',
      paymentId: 'pay_platform',
      status: RefundRequestStatus.processing,
      stripeRefundId: null,
    });
    h.stripe.refunds.create.mockResolvedValue({
      id: 're_platform',
      status: 'succeeded',
    });
    h.prisma.refundRequest.update.mockResolvedValue({
      id: 'rr_platform',
      paymentId: 'pay_platform',
      status: RefundRequestStatus.succeeded,
      stripeRefundId: 're_platform',
    });

    const result = await forceRefundByPayment('pay_platform', 'Admin platform refund');

    expect(result.success).toBe(true);
    expect(h.stripe.refunds.create).toHaveBeenCalledWith(
      {
        charge: 'ch_platform',
      },
      {
        idempotencyKey: 'force-refund:pay_platform',
      }
    );
  });

  it('forceRefundByPayment rejects non-owner organizers', async () => {
    h.authUserId = 'org_2';
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'org_2',
      role: UserRole.organizer,
    });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_manual',
      userId: 'buyer_1',
      status: PaymentStatus.succeeded,
      stripeChargeId: 'ch_manual',
      stripePaymentIntentId: 'pi_manual',
      payoutTarget: PaymentPayoutTarget.organizer,
      event: {
        createdBy: 'org_1',
      },
      refundRequest: null,
    });

    const result = await forceRefundByPayment('pay_manual');

    expect(result).toEqual({
      success: false,
      message: 'You do not have permission to issue this refund.',
      data: null,
    });
    expect(h.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('forceRefundByPayment lets admins override rejected refund requests', async () => {
    h.authUserId = 'admin_1';
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'admin_1',
      role: UserRole.admin,
    });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_override',
      userId: 'buyer_1',
      status: PaymentStatus.succeeded,
      stripeChargeId: 'ch_override',
      stripePaymentIntentId: 'pi_override',
      payoutTarget: PaymentPayoutTarget.organizer,
      event: {
        createdBy: 'org_1',
      },
      refundRequest: {
        id: 'rr_override',
        paymentId: 'pay_override',
        status: RefundRequestStatus.rejected,
        stripeRefundId: null,
      },
    });
    h.prisma.refundRequest.updateMany.mockResolvedValue({ count: 1 });
    h.stripe.refunds.create.mockResolvedValue({
      id: 're_override',
      status: 'succeeded',
    });
    h.prisma.refundRequest.update.mockResolvedValue({
      id: 'rr_override',
      paymentId: 'pay_override',
      status: RefundRequestStatus.succeeded,
      stripeRefundId: 're_override',
    });

    const result = await forceRefundByPayment('pay_override', 'Admin override');

    expect(result).toEqual({
      success: true,
      message: 'Refund completed successfully.',
      data: {
        id: 'rr_override',
        paymentId: 'pay_override',
        status: RefundRequestStatus.succeeded,
        stripeRefundId: 're_override',
      },
    });
    expect(h.prisma.refundRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'rr_override',
          status: {
            in: [
              RefundRequestStatus.requested,
              RefundRequestStatus.failed,
              RefundRequestStatus.rejected,
              RefundRequestStatus.canceled,
            ],
          },
        },
        data: expect.objectContaining({
          status: RefundRequestStatus.processing,
          attemptCount: { increment: 1 },
          lastError: null,
        }),
      })
    );
  });

  it('forceRefundByPayment blocks organizers from overriding rejected refund requests', async () => {
    h.authUserId = 'org_1';
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'org_1',
      role: UserRole.organizer,
    });
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_rejected',
      userId: 'buyer_1',
      status: PaymentStatus.succeeded,
      stripeChargeId: 'ch_rejected',
      stripePaymentIntentId: 'pi_rejected',
      payoutTarget: PaymentPayoutTarget.organizer,
      event: {
        createdBy: 'org_1',
      },
      refundRequest: {
        id: 'rr_rejected',
        paymentId: 'pay_rejected',
        status: RefundRequestStatus.rejected,
        stripeRefundId: null,
      },
    });

    const result = await forceRefundByPayment('pay_rejected');

    expect(result).toEqual({
      success: false,
      message: 'Only admins can override rejected or canceled refund requests.',
      data: null,
    });
    expect(h.prisma.refundRequest.updateMany).not.toHaveBeenCalled();
    expect(h.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('forceRefundByPayment is idempotent for repeated calls and retries increment attemptCount on failed requests', async () => {
    h.authUserId = 'org_1';
    h.prisma.user.findUnique.mockResolvedValue({
      clerkId: 'org_1',
      role: UserRole.organizer,
    });
    h.prisma.payment.findUnique
      .mockResolvedValueOnce({
        id: 'pay_retry',
        userId: 'buyer_1',
        status: PaymentStatus.succeeded,
        stripeChargeId: 'ch_retry',
        stripePaymentIntentId: 'pi_retry',
        payoutTarget: PaymentPayoutTarget.organizer,
        event: {
          createdBy: 'org_1',
        },
        refundRequest: {
          id: 'rr_retry',
          paymentId: 'pay_retry',
          status: RefundRequestStatus.failed,
          stripeRefundId: null,
        },
      })
      .mockResolvedValueOnce({
        id: 'pay_retry',
        userId: 'buyer_1',
        status: PaymentStatus.succeeded,
        stripeChargeId: 'ch_retry',
        stripePaymentIntentId: 'pi_retry',
        payoutTarget: PaymentPayoutTarget.organizer,
        event: {
          createdBy: 'org_1',
        },
        refundRequest: {
          id: 'rr_retry',
          paymentId: 'pay_retry',
          status: RefundRequestStatus.succeeded,
          stripeRefundId: 're_retry',
        },
      });
    h.prisma.refundRequest.updateMany.mockResolvedValue({ count: 1 });
    h.stripe.refunds.create.mockResolvedValue({
      id: 're_retry',
      status: 'succeeded',
    });
    h.prisma.refundRequest.update.mockResolvedValue({
      id: 'rr_retry',
      paymentId: 'pay_retry',
      status: RefundRequestStatus.succeeded,
      stripeRefundId: 're_retry',
    });

    const first = await forceRefundByPayment('pay_retry', 'Retrying after manual review');
    const second = await forceRefundByPayment('pay_retry');

    expect(first.success).toBe(true);
    expect(second).toEqual({
      success: true,
      message: 'This refund has already been completed.',
      data: {
        id: 'rr_retry',
        paymentId: 'pay_retry',
        status: RefundRequestStatus.succeeded,
        stripeRefundId: 're_retry',
      },
    });
    expect(h.prisma.refundRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'rr_retry',
          status: { in: [RefundRequestStatus.requested, RefundRequestStatus.failed] },
        },
        data: expect.objectContaining({
          attemptCount: { increment: 1 },
          lastError: null,
        }),
      })
    );
    expect(h.stripe.refunds.create).toHaveBeenCalledTimes(1);
  });
});


