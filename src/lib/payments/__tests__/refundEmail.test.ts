import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RefundRequestStatus } from '@/generated/prisma';

const h = vi.hoisted(() => ({
  prisma: {
    refundRequest: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  sendTransacEmailMock: vi.fn(),
  renderMock: vi.fn(async () => '<html><body>refund</body></html>'),
  ENV_SNAPSHOT: { ...process.env },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: h.prisma,
}));

vi.mock('@getbrevo/brevo', () => {
  class TransactionalEmailsApi {
    setApiKey(_key: unknown, _value: string) {
      // no-op
    }
    sendTransacEmail(payload: unknown) {
      return h.sendTransacEmailMock(payload);
    }
  }

  const TransactionalEmailsApiApiKeys = { apiKey: 'apiKey' } as const;
  return { TransactionalEmailsApi, TransactionalEmailsApiApiKeys };
});

vi.mock('@react-email/render', () => ({
  render: h.renderMock,
}));

vi.mock('@/app/(dashboard)/emails/RefundConfirmationEmail', () => ({
  default: (): React.ReactElement => React.createElement('div', null, 'Refund'),
}));

import { sendRefundConfirmationEmailIfNeeded } from '@/lib/payments/refundEmail';

describe('sendRefundConfirmationEmailIfNeeded', () => {
  beforeEach(() => {
    h.prisma.refundRequest.findUnique.mockReset();
    h.prisma.refundRequest.updateMany.mockReset();
    h.sendTransacEmailMock.mockReset();
    h.renderMock.mockClear();

    process.env.BREVO_API_KEY = 'brevo_test';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@example.com';
  });

  afterEach(() => {
    process.env = { ...h.ENV_SNAPSHOT };
  });

  it('sends once and writes refundEmailSentAt when the refund succeeded', async () => {
    h.prisma.refundRequest.findUnique.mockResolvedValue({
      id: 'rr_1',
      status: RefundRequestStatus.succeeded,
      stripeRefundId: 're_1',
      refundEmailSentAt: null,
      refundReference: '6990533368941588',
      payment: {
        amountCents: 3200,
        currency: 'USD',
        stripePaymentIntentId: 'pi_1',
        stripeChargeId: 'ch_1',
        user: {
          email: 'buyer@example.com',
          username: 'buyer',
          firstName: 'Alex',
        },
        event: {
          title: 'Concert Night',
          date: new Date('2026-03-20T20:00:00.000Z'),
          location: 'New York',
          eventTimeZone: 'America/New_York',
        },
      },
    });
    h.sendTransacEmailMock.mockResolvedValue({ body: { messageId: 'brevo_1' } });
    h.prisma.refundRequest.updateMany.mockResolvedValue({ count: 1 });

    const out = await sendRefundConfirmationEmailIfNeeded('rr_1');

    expect(out).toEqual({ sent: true });
    expect(h.sendTransacEmailMock).toHaveBeenCalledTimes(1);
    expect(h.prisma.refundRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'rr_1',
        refundEmailSentAt: null,
      },
      data: {
        refundEmailSentAt: expect.any(Date),
      },
    });
  });

  it('does not send again when refundEmailSentAt is already set', async () => {
    h.prisma.refundRequest.findUnique.mockResolvedValue({
      id: 'rr_1',
      status: RefundRequestStatus.succeeded,
      stripeRefundId: 're_1',
      refundEmailSentAt: new Date('2026-03-03T00:00:00.000Z'),
      refundReference: null,
      payment: {
        amountCents: 3200,
        currency: 'USD',
        stripePaymentIntentId: 'pi_1',
        stripeChargeId: 'ch_1',
        user: {
          email: 'buyer@example.com',
          username: 'buyer',
          firstName: 'Alex',
        },
        event: {
          title: 'Concert Night',
          date: new Date('2026-03-20T20:00:00.000Z'),
          location: 'New York',
          eventTimeZone: 'America/New_York',
        },
      },
    });

    const out = await sendRefundConfirmationEmailIfNeeded('rr_1');

    expect(out).toEqual({ sent: false, reason: 'already-sent' });
    expect(h.sendTransacEmailMock).not.toHaveBeenCalled();
    expect(h.prisma.refundRequest.updateMany).not.toHaveBeenCalled();
  });

  it('throws when Brevo send fails and does not mark refundEmailSentAt', async () => {
    h.prisma.refundRequest.findUnique.mockResolvedValue({
      id: 'rr_1',
      status: RefundRequestStatus.succeeded,
      stripeRefundId: 're_1',
      refundEmailSentAt: null,
      refundReference: null,
      payment: {
        amountCents: 3200,
        currency: 'USD',
        stripePaymentIntentId: 'pi_1',
        stripeChargeId: 'ch_1',
        user: {
          email: 'buyer@example.com',
          username: 'buyer',
          firstName: 'Alex',
        },
        event: {
          title: 'Concert Night',
          date: new Date('2026-03-20T20:00:00.000Z'),
          location: 'New York',
          eventTimeZone: 'America/New_York',
        },
      },
    });
    h.sendTransacEmailMock.mockRejectedValue(new Error('Brevo down'));

    await expect(sendRefundConfirmationEmailIfNeeded('rr_1')).rejects.toThrow('Brevo down');
    expect(h.prisma.refundRequest.updateMany).not.toHaveBeenCalled();
  });
});
