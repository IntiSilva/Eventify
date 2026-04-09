import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PaymentPayoutTarget,
  PaymentStatus,
  RSVPAttendanceEntitlementStatus,
  RSVPStatus,
} from '@/generated/prisma';
import type Stripe from 'stripe';

type TestTx = {
  rSVP: {
    upsert: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  payment: {
    update: ReturnType<typeof vi.fn>;
  };
  event: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

type TestTransactionCallback = (tx: TestTx) => Promise<unknown>;

const h = vi.hoisted(() => ({
  prisma: {
    payment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  stripe: {
    charges: {
      retrieve: vi.fn(),
    },
  },
  sendTicketPurchaseConfirmationEmailIfNeeded: vi.fn(),
  initiateLateJoinabilityCompensation: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/stripe', () => ({ stripe: h.stripe }));
vi.mock('@/lib/payments/ticketPurchaseEmail', () => ({
  sendTicketPurchaseConfirmationEmailIfNeeded: h.sendTicketPurchaseConfirmationEmailIfNeeded,
}));
vi.mock('@/lib/payments/lateJoinabilityCompensation', () => ({
  initiateLateJoinabilityCompensation: h.initiateLateJoinabilityCompensation,
}));

import { confirmPaidRsvpByIntent } from '@/lib/payments/confirmPaidRsvp';

const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

afterAll(() => {
  consoleWarnSpy.mockRestore();
});

describe('confirmPaidRsvpByIntent', () => {
  beforeEach(() => {
    h.prisma.payment.findUnique.mockReset();
    h.prisma.payment.update.mockReset();
    h.prisma.$transaction.mockReset();
    h.stripe.charges.retrieve.mockReset();
    h.sendTicketPurchaseConfirmationEmailIfNeeded.mockReset();
    h.initiateLateJoinabilityCompensation.mockReset();
    consoleWarnSpy.mockClear();
    h.sendTicketPurchaseConfirmationEmailIfNeeded.mockResolvedValue({
      sent: true,
    });
    h.initiateLateJoinabilityCompensation.mockResolvedValue({
      status: 'refund-processing',
      refundRequestId: 'rr_1',
      stripeRefundId: 're_1',
    });
  });

  it('returns early when already succeeded, linked, and ticket email already sent', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      status: PaymentStatus.succeeded,
      eventId: 'evt_1',
      userId: 'user_1',
      rsvpId: 'rsvp_1',
      ticketEmailSentAt: new Date('2026-02-26T00:00:00.000Z'),
      payoutTarget: PaymentPayoutTarget.organizer,
      applicationFeeAmount: 125,
      stripeChargeId: 'ch_1',
      stripeBalanceTransactionId: 'txn_1',
      stripeTransferId: 'tr_1',
      stripeApplicationFeeId: 'fee_1',
    });

    const out = await confirmPaidRsvpByIntent('pi_1');

    expect(out).toEqual({ alreadyProcessed: true, paymentId: 'pay_1', rsvpId: 'rsvp_1' });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.prisma.payment.update).not.toHaveBeenCalled();
    expect(h.sendTicketPurchaseConfirmationEmailIfNeeded).not.toHaveBeenCalled();
  });

  it('upserts confirmed RSVP in transaction when pending', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      status: PaymentStatus.pending,
      eventId: 'evt_1',
      userId: 'user_1',
      rsvpId: null,
      ticketEmailSentAt: null,
      payoutTarget: PaymentPayoutTarget.organizer,
      applicationFeeAmount: null,
      stripeChargeId: null,
      stripeBalanceTransactionId: null,
      stripeTransferId: null,
      stripeApplicationFeeId: null,
    });

    h.prisma.$transaction.mockImplementation(async (cb: TestTransactionCallback) => {
      const tx = {
        rSVP: {
          upsert: vi.fn().mockResolvedValue({ id: 'rsvp_1', status: RSVPStatus.confirmed }),
          count: vi.fn().mockResolvedValue(3),
        },
        payment: {
          update: vi.fn().mockResolvedValue({}),
        },
        event: {
          findUnique: vi.fn().mockResolvedValue({
            date: new Date('2099-01-01T12:00:00.000Z'),
            archivedAt: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      const out = await cb(tx);
      expect(tx.event.findUnique).toHaveBeenCalledWith({
        where: { id: 'evt_1' },
        select: { date: true, archivedAt: true },
      });
      expect(tx.rSVP.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            attendanceEntitlementStatus: RSVPAttendanceEntitlementStatus.active,
          }),
          update: expect.objectContaining({
            attendanceEntitlementStatus: RSVPAttendanceEntitlementStatus.active,
          }),
        })
      );
      expect(tx.payment.update).toHaveBeenCalled();
      expect(tx.event.update).toHaveBeenCalled();
      return out;
    });

    const out = await confirmPaidRsvpByIntent('pi_1');

    expect(out).toEqual(expect.objectContaining({
      alreadyProcessed: false,
      paymentId: 'pay_1',
      rsvpId: 'rsvp_1',
    }));
    expect(h.prisma.payment.update).not.toHaveBeenCalled();
    expect(h.sendTicketPurchaseConfirmationEmailIfNeeded).toHaveBeenCalledWith('pay_1');
  });

  it('marks payment succeeded but skips RSVP link when event is no longer joinable', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      status: PaymentStatus.pending,
      eventId: 'evt_started',
      userId: 'user_1',
      rsvpId: null,
      ticketEmailSentAt: null,
      payoutTarget: PaymentPayoutTarget.organizer,
      applicationFeeAmount: null,
      stripeChargeId: null,
      stripeBalanceTransactionId: null,
      stripeTransferId: null,
      stripeApplicationFeeId: null,
    });

    h.prisma.$transaction.mockImplementation(async (cb: TestTransactionCallback) => {
      const tx = {
        rSVP: {
          upsert: vi.fn(),
          count: vi.fn(),
        },
        payment: {
          update: vi.fn().mockResolvedValue({}),
        },
        event: {
          findUnique: vi.fn().mockResolvedValue({
            date: new Date('2000-01-01T12:00:00.000Z'),
            archivedAt: null,
          }),
          update: vi.fn(),
        },
      };
      const out = await cb(tx);
      expect(tx.event.findUnique).toHaveBeenCalled();
      expect(tx.rSVP.upsert).not.toHaveBeenCalled();
      expect(tx.event.update).not.toHaveBeenCalled();
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay_1' },
        data: {
          status: PaymentStatus.succeeded,
          rsvpId: null,
        },
      });
      return out;
    });

    const out = await confirmPaidRsvpByIntent('pi_1');

    expect(out).toEqual({
      alreadyProcessed: false,
      paymentId: 'pay_1',
      rsvpId: null,
    });
    expect(h.initiateLateJoinabilityCompensation).toHaveBeenCalledWith('pay_1');
    expect(h.sendTicketPurchaseConfirmationEmailIfNeeded).toHaveBeenCalledWith('pay_1');
  });

  it('persists Stripe charge/accounting fields from succeeded payment intent payload', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      status: PaymentStatus.succeeded,
      eventId: 'evt_1',
      userId: 'user_1',
      rsvpId: 'rsvp_1',
      ticketEmailSentAt: null,
      payoutTarget: PaymentPayoutTarget.organizer,
      applicationFeeAmount: 125,
      stripeChargeId: null,
      stripeBalanceTransactionId: null,
      stripeTransferId: null,
      stripeApplicationFeeId: null,
    });
    h.prisma.payment.update.mockResolvedValue({});
    h.stripe.charges.retrieve.mockResolvedValue({
      id: 'ch_1',
      balance_transaction: 'txn_1',
      transfer: 'tr_1',
      application_fee: 'fee_1',
    });

    await confirmPaidRsvpByIntent('pi_1', {
      id: 'pi_1',
      latest_charge: 'ch_1',
      transfer_group: 'event:evt_1',
      application_fee_amount: 125,
      transfer_data: { destination: 'acct_1' },
    } as unknown as Stripe.PaymentIntent);

    expect(h.prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_1' },
        data: expect.objectContaining({
          stripeChargeId: 'ch_1',
          stripeBalanceTransactionId: 'txn_1',
          stripeTransferId: 'tr_1',
          stripeApplicationFeeId: 'fee_1',
          destinationAccountId: 'acct_1',
          transferGroup: 'event:evt_1',
          applicationFeeAmount: 125,
        }),
      })
    );
    expect(h.stripe.charges.retrieve).toHaveBeenCalledWith('ch_1', {
      expand: ['balance_transaction', 'transfer', 'application_fee'],
    });
  });

  it('does not overwrite an existing payoutTarget when the webhook succeeds', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      status: PaymentStatus.succeeded,
      eventId: 'evt_1',
      userId: 'user_1',
      rsvpId: 'rsvp_1',
      ticketEmailSentAt: null,
      payoutTarget: PaymentPayoutTarget.organizer,
      applicationFeeAmount: 125,
      stripeChargeId: null,
      stripeBalanceTransactionId: null,
      stripeTransferId: null,
      stripeApplicationFeeId: null,
    });
    h.prisma.payment.update.mockResolvedValue({});
    h.stripe.charges.retrieve.mockResolvedValue({
      id: 'ch_1',
      balance_transaction: 'txn_1',
      transfer: 'tr_1',
      application_fee: 'fee_1',
    });

    await confirmPaidRsvpByIntent('pi_1', {
      id: 'pi_1',
      latest_charge: 'ch_1',
      transfer_group: 'event:evt_1',
      application_fee_amount: 125,
      transfer_data: { destination: 'acct_1' },
    } as unknown as Stripe.PaymentIntent);

    expect(h.prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_1' },
        data: expect.not.objectContaining({
          payoutTarget: expect.anything(),
        }),
      })
    );
  });

  it('uses expanded latest_charge accounting data without calling Stripe charge retrieve', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      status: PaymentStatus.succeeded,
      eventId: 'evt_1',
      userId: 'user_1',
      rsvpId: 'rsvp_1',
      ticketEmailSentAt: null,
      payoutTarget: PaymentPayoutTarget.organizer,
      applicationFeeAmount: 125,
      stripeChargeId: null,
      stripeBalanceTransactionId: null,
      stripeTransferId: null,
      stripeApplicationFeeId: null,
    });
    h.prisma.payment.update.mockResolvedValue({});

    await confirmPaidRsvpByIntent('pi_1', {
      id: 'pi_1',
      latest_charge: {
        id: 'ch_1',
        balance_transaction: 'txn_1',
        transfer: 'tr_1',
        application_fee: 'fee_1',
      },
    } as unknown as Stripe.PaymentIntent);

    expect(h.prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_1' },
        data: expect.objectContaining({
          stripeChargeId: 'ch_1',
          stripeBalanceTransactionId: 'txn_1',
          stripeTransferId: 'tr_1',
          stripeApplicationFeeId: 'fee_1',
        }),
      })
    );
    expect(h.stripe.charges.retrieve).not.toHaveBeenCalled();
  });

  it('does not fail confirmation when Stripe charge enrichment retrieve fails', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      status: PaymentStatus.succeeded,
      eventId: 'evt_1',
      userId: 'user_1',
      rsvpId: 'rsvp_1',
      ticketEmailSentAt: null,
      payoutTarget: PaymentPayoutTarget.organizer,
      applicationFeeAmount: null,
      stripeChargeId: null,
      stripeBalanceTransactionId: null,
      stripeTransferId: null,
      stripeApplicationFeeId: null,
    });
    h.prisma.payment.update.mockResolvedValue({});
    h.stripe.charges.retrieve.mockRejectedValue(new Error('stripe transient failure'));

    const out = await confirmPaidRsvpByIntent('pi_1', {
      id: 'pi_1',
      latest_charge: 'ch_1',
    } as unknown as Stripe.PaymentIntent);

    expect(out).toEqual({
      alreadyProcessed: true,
      paymentId: 'pay_1',
      rsvpId: 'rsvp_1',
    });
    expect(h.prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_1' },
        data: expect.objectContaining({
          stripeChargeId: 'ch_1',
        }),
      })
    );
    expect(h.sendTicketPurchaseConfirmationEmailIfNeeded).toHaveBeenCalledWith('pay_1');
  });

  it('skips Stripe charge retrieve when DB payment already has full accounting fields', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      status: PaymentStatus.succeeded,
      eventId: 'evt_1',
      userId: 'user_1',
      rsvpId: 'rsvp_1',
      ticketEmailSentAt: null,
      payoutTarget: PaymentPayoutTarget.organizer,
      applicationFeeAmount: 125,
      stripeChargeId: null,
      stripeBalanceTransactionId: 'txn_existing',
      stripeTransferId: 'tr_existing',
      stripeApplicationFeeId: 'fee_existing',
    });
    h.prisma.payment.update.mockResolvedValue({});

    await confirmPaidRsvpByIntent('pi_1', {
      id: 'pi_1',
      latest_charge: 'ch_1',
    } as unknown as Stripe.PaymentIntent);

    expect(h.stripe.charges.retrieve).not.toHaveBeenCalled();
    expect(h.prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_1' },
        data: expect.objectContaining({
          stripeChargeId: 'ch_1',
        }),
      })
    );
  });

  it('does not require application fee id when no application fee is expected on retry', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      status: PaymentStatus.succeeded,
      eventId: 'evt_1',
      userId: 'user_1',
      rsvpId: 'rsvp_1',
      ticketEmailSentAt: null,
      payoutTarget: PaymentPayoutTarget.organizer,
      applicationFeeAmount: 0,
      stripeChargeId: null,
      stripeBalanceTransactionId: 'txn_existing',
      stripeTransferId: 'tr_existing',
      stripeApplicationFeeId: null,
    });
    h.prisma.payment.update.mockResolvedValue({});

    await confirmPaidRsvpByIntent('pi_1', {
      id: 'pi_1',
      latest_charge: 'ch_1',
      application_fee_amount: 0,
    } as unknown as Stripe.PaymentIntent);

    expect(h.stripe.charges.retrieve).not.toHaveBeenCalled();
    expect(h.prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_1' },
        data: expect.objectContaining({
          stripeChargeId: 'ch_1',
          applicationFeeAmount: 0,
        }),
      })
    );
  });

  it('treats platform payouts as fully accounted without a transfer id', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_platform',
      status: PaymentStatus.succeeded,
      eventId: 'evt_platform',
      userId: 'user_1',
      rsvpId: 'rsvp_1',
      ticketEmailSentAt: null,
      payoutTarget: PaymentPayoutTarget.platform,
      applicationFeeAmount: null,
      stripeChargeId: null,
      stripeBalanceTransactionId: 'txn_existing',
      stripeTransferId: null,
      stripeApplicationFeeId: null,
    });
    h.prisma.payment.update.mockResolvedValue({});

    await confirmPaidRsvpByIntent('pi_platform', {
      id: 'pi_platform',
      latest_charge: 'ch_platform',
      transfer_group: 'event:evt_platform',
    } as unknown as Stripe.PaymentIntent);

    expect(h.stripe.charges.retrieve).not.toHaveBeenCalled();
    expect(h.prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_platform' },
        data: expect.objectContaining({
          stripeChargeId: 'ch_platform',
          transferGroup: 'event:evt_platform',
        }),
      })
    );
  });

  it('warns and keeps the persisted payoutTarget when Stripe payload routing disagrees', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_mismatch',
      status: PaymentStatus.succeeded,
      eventId: 'evt_mismatch',
      userId: 'user_1',
      rsvpId: 'rsvp_1',
      ticketEmailSentAt: null,
      payoutTarget: PaymentPayoutTarget.platform,
      applicationFeeAmount: null,
      stripeChargeId: null,
      stripeBalanceTransactionId: 'txn_existing',
      stripeTransferId: null,
      stripeApplicationFeeId: null,
    });
    h.prisma.payment.update.mockResolvedValue({});

    await confirmPaidRsvpByIntent('pi_mismatch', {
      id: 'pi_mismatch',
      latest_charge: 'ch_mismatch',
      transfer_group: 'event:evt_mismatch',
      transfer_data: { destination: 'acct_unexpected' },
    } as unknown as Stripe.PaymentIntent);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('payoutTarget mismatch between DB and Stripe intent; keeping persisted mode')
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('platform payoutTarget payment received unexpected destination routing')
    );
    expect(h.prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_mismatch' },
        data: expect.objectContaining({
          destinationAccountId: 'acct_unexpected',
          transferGroup: 'event:evt_mismatch',
          stripeChargeId: 'ch_mismatch',
        }),
      })
    );
    expect(h.prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          payoutTarget: expect.anything(),
        }),
      })
    );
  });
});
