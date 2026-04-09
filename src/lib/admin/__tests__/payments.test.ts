import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentStatus, RefundRequestStatus } from '@/generated/prisma';

const h = vi.hoisted(() => ({
  prisma: {
    payment: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: h.prisma,
}));

import { listAdminPayments } from '@/lib/admin/payments';

function makePaymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay_1',
    stripePaymentIntentId: 'pi_1',
    status: PaymentStatus.succeeded,
    createdAt: new Date('2026-03-20T10:00:00.000Z'),
    amountCents: 5000,
    currency: 'USD',
    payoutTarget: 'organizer',
    destinationAccountId: 'acct_1',
    transferGroup: 'group_1',
    applicationFeeAmount: 500,
    stripeChargeId: 'ch_1',
    stripeBalanceTransactionId: 'txn_1',
    stripeTransferId: 'tr_1',
    stripeApplicationFeeId: 'fee_1',
    event: {
      id: 'evt_1',
      title: 'Paid Event',
      date: new Date('2026-03-22T10:00:00.000Z'),
      createdBy: 'owner_1',
      creator: {
        username: 'owneruser',
        firstName: 'Owner',
        lastName: 'Admin',
        role: 'admin',
      },
    },
    user: {
      clerkId: 'buyer_1',
      username: 'buyeruser',
      firstName: 'Buyer',
      lastName: 'Person',
      email: 'buyer@example.com',
    },
    refundRequest: null,
    ...overrides,
  };
}

function makeCurrencyRows(currencies: string[]) {
  return currencies.map((currency) => ({ currency }));
}

describe('lib/admin/listAdminPayments', () => {
  beforeEach(() => {
    h.prisma.payment.findMany.mockReset();
  });

  it('queries paid-event payments across statuses with recent-first order and hasMore slicing', async () => {
    h.prisma.payment.findMany
      .mockResolvedValueOnce([
        makePaymentRow({ id: 'pay_3', status: PaymentStatus.failed }),
        makePaymentRow({ id: 'pay_2', status: PaymentStatus.pending }),
        makePaymentRow({ id: 'pay_1', status: PaymentStatus.succeeded }),
      ])
      .mockResolvedValueOnce(makeCurrencyRows(['usd', 'ars']));

    const result = await listAdminPayments({ limit: 2 });

    const listCallArgs = h.prisma.payment.findMany.mock.calls[0]?.[0];
    const currencyCallArgs = h.prisma.payment.findMany.mock.calls[1]?.[0];
    expect(listCallArgs.where).toMatchObject({
      amountCents: { gt: 0 },
      event: { isPaid: true },
    });
    expect(listCallArgs.where.status).toBeUndefined();
    expect(listCallArgs.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(listCallArgs.take).toBe(3);
    expect(currencyCallArgs.where).toEqual({
      amountCents: { gt: 0 },
      event: { isPaid: true },
    });
    expect(currencyCallArgs.select).toEqual({ currency: true });
    expect(currencyCallArgs.distinct).toEqual(['currency']);

    expect(result.hasMore).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data.map((item) => item.paymentId)).toEqual(['pay_3', 'pay_2']);
    expect(result.data.map((item) => item.paymentStatus)).toEqual(['failed', 'pending']);
    expect(result.availableCurrencies).toEqual(['ars', 'usd']);
  });

  it('maps dto fields and keeps payment status separate from refund relation state', async () => {
    h.prisma.payment.findMany
      .mockResolvedValueOnce([
        makePaymentRow({
          id: 'pay_with_refund',
          refundRequest: {
            id: 'rr_1',
            status: RefundRequestStatus.approved,
            source: 'MANUAL_OVERRIDE',
            createdAt: new Date('2026-03-21T09:00:00.000Z'),
            decisionNote: 'approved by admin',
            stripeRefundId: 're_1',
            attemptCount: 2,
            lastError: null,
            lastAttemptAt: null,
          },
        }),
      ])
      .mockResolvedValueOnce(makeCurrencyRows(['usd']));

    const result = await listAdminPayments();
    const payment = result.data[0];

    expect(payment.paymentId).toBe('pay_with_refund');
    expect(payment.paymentStatus).toBe('succeeded');
    expect(payment.refundStatus).toBe('approved');
    expect(payment.refundState).toBe('processing');
    expect(payment.refundLastAttemptAt).toBeNull();
    expect(payment.ownerRole).toBe('admin');
  });

  it('builds payment status + payout target + refund filters and normalizes limit/search', async () => {
    h.prisma.payment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(makeCurrencyRows(['usd', 'eur']));
    const longSearch = `  ${'buyer-lookup-'.repeat(12)}  `;

    const result = await listAdminPayments({
      limit: 999,
      search: longSearch,
      paymentStatus: 'pending',
      currency: 'USD',
      refundState: 'processing',
      payoutTarget: 'platform',
    });

    const listCallArgs = h.prisma.payment.findMany.mock.calls[0]?.[0];
    const currencyCallArgs = h.prisma.payment.findMany.mock.calls[1]?.[0];
    expect(listCallArgs.take).toBe(121);
    expect(listCallArgs.where.AND[0]).toEqual({ status: PaymentStatus.pending });
    expect(listCallArgs.where.AND[1]).toEqual({ payoutTarget: 'platform' });
    expect(listCallArgs.where.AND[2]).toEqual({
      refundRequest: {
        status: {
          in: [RefundRequestStatus.processing, RefundRequestStatus.approved],
        },
      },
    });
    expect(listCallArgs.where.AND[4]).toEqual({
      currency: {
        equals: 'USD',
        mode: 'insensitive',
      },
    });
    expect(currencyCallArgs.where).toEqual({
      amountCents: { gt: 0 },
      event: { isPaid: true },
    });

    expect(result.filter.limit).toBe(120);
    expect(result.filter.paymentStatus).toBe('pending');
    expect(result.filter.currency).toBe('USD');
    expect(result.filter.refundState).toBe('processing');
    expect(result.filter.payoutTarget).toBe('platform');
    expect(result.filter.search).toBe(longSearch.trim().slice(0, 80));
    expect(result.availableCurrencies).toEqual(['eur', 'usd']);
  });

  it('builds no_refund filter and returns hasMore false when rows <= limit', async () => {
    h.prisma.payment.findMany
      .mockResolvedValueOnce([makePaymentRow({ id: 'pay_1' })])
      .mockResolvedValueOnce(makeCurrencyRows(['usd']));

    const result = await listAdminPayments({
      limit: 10,
      paymentStatus: 'failed',
      refundState: 'no_refund',
    });

    const args = h.prisma.payment.findMany.mock.calls[0]?.[0];
    expect(args.where.AND[0]).toEqual({ status: PaymentStatus.failed });
    expect(args.where.AND[2]).toEqual({ refundRequest: null });
    expect(result.hasMore).toBe(false);
    expect(result.data).toHaveLength(1);
    expect(result.filter.currency).toBeNull();
    expect(result.filter.payoutTarget).toBe('all');
  });
});
