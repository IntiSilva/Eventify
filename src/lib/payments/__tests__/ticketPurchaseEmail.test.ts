import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentStatus } from '@/generated/prisma';

const h = vi.hoisted(() => ({
  prisma: {
    payment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  sendTransacEmailMock: vi.fn(),
  renderMock: vi.fn(async () => '<html><body>ticket</body></html>'),
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

vi.mock('@/app/(dashboard)/emails/TicketPurchaseConfirmationEmail', () => ({
  default: (): React.ReactElement => React.createElement('div', null, 'Ticket'),
}));

import { sendTicketPurchaseConfirmationEmailIfNeeded } from '@/lib/payments/ticketPurchaseEmail';

describe('sendTicketPurchaseConfirmationEmailIfNeeded', () => {
  beforeEach(() => {
    h.prisma.payment.findUnique.mockReset();
    h.prisma.payment.update.mockReset();
    h.sendTransacEmailMock.mockReset();
    h.renderMock.mockClear();

    process.env.BREVO_API_KEY = 'brevo_test';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@example.com';
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  });

  afterEach(() => {
    process.env = { ...h.ENV_SNAPSHOT };
  });

  it('sends once and writes ticketEmailSentAt when payment is confirmed', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      status: PaymentStatus.succeeded,
      rsvpId: 'rsvp_1',
      amountCents: 1500,
      currency: 'USD',
      stripePaymentIntentId: 'pi_1',
      ticketEmailSentAt: null,
      user: {
        email: 'buyer@example.com',
        username: 'buyer',
        firstName: 'Alex',
      },
      event: {
        id: 'evt_1',
        title: 'Concert Night',
        date: new Date('2026-03-20T20:00:00.000Z'),
        location: 'New York',
        eventTimeZone: 'America/New_York',
      },
    });
    h.sendTransacEmailMock.mockResolvedValue({ body: { messageId: 'brevo_1' } });

    const out = await sendTicketPurchaseConfirmationEmailIfNeeded('pay_1');

    expect(out).toEqual({ sent: true });
    expect(h.sendTransacEmailMock).toHaveBeenCalledTimes(1);
    expect(h.prisma.payment.update).toHaveBeenCalledTimes(1);
    const updateArg = h.prisma.payment.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'pay_1' });
    expect(updateArg.data.ticketEmailSentAt).toBeInstanceOf(Date);
  });

  it('does not send again when ticketEmailSentAt is already set', async () => {
    h.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      status: PaymentStatus.succeeded,
      rsvpId: 'rsvp_1',
      amountCents: 1500,
      currency: 'USD',
      stripePaymentIntentId: 'pi_1',
      ticketEmailSentAt: new Date('2026-02-26T00:00:00.000Z'),
      user: {
        email: 'buyer@example.com',
        username: 'buyer',
        firstName: 'Alex',
      },
      event: {
        id: 'evt_1',
        title: 'Concert Night',
        date: new Date('2026-03-20T20:00:00.000Z'),
        location: 'New York',
        eventTimeZone: 'America/New_York',
      },
    });

    const out = await sendTicketPurchaseConfirmationEmailIfNeeded('pay_1');

    expect(out).toEqual({ sent: false, reason: 'already-sent' });
    expect(h.sendTransacEmailMock).not.toHaveBeenCalled();
    expect(h.prisma.payment.update).not.toHaveBeenCalled();
  });
});
