import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentStatus, RSVPStatus } from '@/generated/prisma';

const h = vi.hoisted(() => ({
  prisma: {
    payment: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));

import { confirmPaidRsvpByIntent } from '@/lib/payments/confirmPaidRsvp';

describe('confirmPaidRsvpByIntent', () => {
  beforeEach(() => {
    h.prisma.payment.findUnique.mockReset();
    h.prisma.$transaction.mockReset();
  });

  it('returns early when already succeeded and linked to RSVP', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      status: PaymentStatus.succeeded,
      eventId: 'evt_1',
      userId: 'user_1',
      rsvpId: 'rsvp_1',
    });

    const out = await confirmPaidRsvpByIntent('pi_1');

    expect(out).toEqual({ alreadyProcessed: true, paymentId: 'pay_1', rsvpId: 'rsvp_1' });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('upserts confirmed RSVP in transaction when pending', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      status: PaymentStatus.pending,
      eventId: 'evt_1',
      userId: 'user_1',
      rsvpId: null,
    });

    h.prisma.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const tx = {
        rSVP: {
          upsert: vi.fn().mockResolvedValue({ id: 'rsvp_1', status: RSVPStatus.confirmed }),
          count: vi.fn().mockResolvedValue(3),
        },
        payment: {
          update: vi.fn().mockResolvedValue({}),
        },
        event: {
          update: vi.fn().mockResolvedValue({}),
        },
      };
      const out = await cb(tx);
      expect(tx.rSVP.upsert).toHaveBeenCalled();
      expect(tx.payment.update).toHaveBeenCalled();
      expect(tx.event.update).toHaveBeenCalled();
      return out;
    });

    const out = await confirmPaidRsvpByIntent('pi_1');

    expect(out).toEqual(expect.objectContaining({
      alreadyProcessed: false,
      paymentId: 'pay_1',
      rsvpId: 'rsvp_1',
      confirmedCount: 3,
    }));
  });
});
