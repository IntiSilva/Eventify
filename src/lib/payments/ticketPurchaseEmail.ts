import 'server-only';

import { render } from '@react-email/render';
import {
  TransactionalEmailsApi,
  TransactionalEmailsApiApiKeys,
} from '@getbrevo/brevo';
import { PaymentStatus } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import TicketPurchaseConfirmationEmail from '@/app/(dashboard)/emails/TicketPurchaseConfirmationEmail';

type SenderInfo = { name?: string; email: string };

type SendTicketEmailResult =
  | { sent: true }
  | {
      sent: false;
      reason:
        | 'not-found'
        | 'already-sent'
        | 'not-ready'
        | 'missing-email'
        | 'missing-config'
        | 'send-failed';
    };

function parseSender(from: string): SenderInfo {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1]?.trim().replace(/^"(.+)"$/, '$1');
    const email = match[2]?.trim();
    return name ? { name, email } : { email };
  }
  return { email: from.trim() };
}

function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return raw.replace(/\/$/, '');
}

function formatEventDateTime(eventDate: Date, eventTimeZone: string): string {
  return eventDate.toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: eventTimeZone,
  });
}

function formatAmount(amountCents: number, currency: string): string {
  const normalizedCurrency = currency.toUpperCase();

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency,
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${normalizedCurrency}`;
  }
}

export async function sendTicketPurchaseConfirmationEmailIfNeeded(
  paymentId: string
): Promise<SendTicketEmailResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      rsvpId: true,
      amountCents: true,
      currency: true,
      stripePaymentIntentId: true,
      ticketEmailSentAt: true,
      user: {
        select: {
          email: true,
          username: true,
          firstName: true,
        },
      },
      event: {
        select: {
          id: true,
          title: true,
          date: true,
          location: true,
          eventTimeZone: true,
        },
      },
    },
  });

  if (!payment) {
    console.warn(
      `[ticket-email] payment ${paymentId} not found, skipping confirmation email`
    );
    return { sent: false, reason: 'not-found' };
  }

  if (payment.ticketEmailSentAt) {
    return { sent: false, reason: 'already-sent' };
  }

  if (payment.status !== PaymentStatus.succeeded || !payment.rsvpId) {
    return { sent: false, reason: 'not-ready' };
  }

  if (!payment.user.email) {
    console.warn(
      `[ticket-email] payment ${payment.id} has no user email, skipping purchase confirmation`
    );
    return { sent: false, reason: 'missing-email' };
  }

  const brevoApiKey = process.env.BREVO_API_KEY;
  const emailFrom = process.env.EMAIL_FROM_ADDRESS;
  if (!brevoApiKey || !emailFrom) {
    console.error(
      `[ticket-email] missing BREVO_API_KEY or EMAIL_FROM_ADDRESS; skipping payment ${payment.id}`
    );
    return { sent: false, reason: 'missing-config' };
  }

  const sender = parseSender(emailFrom);
  const attendeeName =
    payment.user.firstName || payment.user.username || payment.user.email;
  const eventTimeZone = payment.event.eventTimeZone ?? 'UTC';
  const eventDateTime = formatEventDateTime(new Date(payment.event.date), eventTimeZone);
  const amountFormatted = formatAmount(payment.amountCents, payment.currency);
  const eventUrl = `${getSiteUrl()}/events/${payment.event.id}`;

  try {
    const htmlContent = await render(
      TicketPurchaseConfirmationEmail({
        attendeeName,
        buyerEmail: payment.user.email,
        eventName: payment.event.title,
        eventDateTime,
        eventTimeZone,
        eventLocation: payment.event.location ?? null,
        amountFormatted,
        eventUrl,
      })
    );

    const brevo = new TransactionalEmailsApi();
    brevo.setApiKey(TransactionalEmailsApiApiKeys.apiKey, brevoApiKey);

    const result = await brevo.sendTransacEmail({
      sender: sender.name
        ? { name: sender.name, email: sender.email }
        : { email: sender.email },
      to: [
        {
          email: payment.user.email,
          name: attendeeName,
        },
      ],
      subject: `Ticket confirmed: ${payment.event.title}`,
      htmlContent,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { ticketEmailSentAt: new Date() },
    });

    const messageId = result?.body?.messageId;
    console.log(
      `[ticket-email] sent purchase confirmation for payment ${payment.id}` +
        (messageId ? ` (messageId: ${messageId})` : '')
    );
    return { sent: true };
  } catch (error) {
    console.error(
      `[ticket-email] failed to send purchase confirmation for payment ${payment.id}`,
      error
    );
    return { sent: false, reason: 'send-failed' };
  }
}
