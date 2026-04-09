import 'server-only';

import { render } from '@react-email/render';
import {
  TransactionalEmailsApi,
  TransactionalEmailsApiApiKeys,
} from '@getbrevo/brevo';
import { RefundRequestStatus } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import RefundConfirmationEmail from '@/app/(dashboard)/emails/RefundConfirmationEmail';

type SenderInfo = { name?: string; email: string };

type SendRefundEmailResult =
  | { sent: true }
  | {
      sent: false;
      reason:
        | 'not-found'
        | 'already-sent'
        | 'not-ready'
        | 'missing-email';
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

function getReferenceCopy(reference: string | null): string | null {
  if (!reference) return null;
  return 'You can share this reference with your bank to help locate the refund. It may take 5-10 business days to appear.';
}

export async function sendRefundConfirmationEmailIfNeeded(
  refundRequestId: string
): Promise<SendRefundEmailResult> {
  const refundRequest = await prisma.refundRequest.findUnique({
    where: { id: refundRequestId },
    select: {
      id: true,
      status: true,
      stripeRefundId: true,
      refundEmailSentAt: true,
      refundReference: true,
      payment: {
        select: {
          amountCents: true,
          currency: true,
          stripePaymentIntentId: true,
          stripeChargeId: true,
          user: {
            select: {
              email: true,
              username: true,
              firstName: true,
            },
          },
          event: {
            select: {
              title: true,
              date: true,
              location: true,
              eventTimeZone: true,
            },
          },
        },
      },
    },
  });

  if (!refundRequest) {
    console.warn(
      `[refund-email] refund request ${refundRequestId} not found, skipping confirmation email`
    );
    return { sent: false, reason: 'not-found' };
  }

  if (refundRequest.refundEmailSentAt) {
    return { sent: false, reason: 'already-sent' };
  }

  if (refundRequest.status !== RefundRequestStatus.succeeded) {
    return { sent: false, reason: 'not-ready' };
  }

  if (!refundRequest.payment.user.email) {
    console.warn(
      `[refund-email] refund request ${refundRequest.id} has no buyer email, skipping confirmation`
    );
    return { sent: false, reason: 'missing-email' };
  }

  const brevoApiKey = process.env.BREVO_API_KEY;
  const emailFrom = process.env.EMAIL_FROM_ADDRESS;
  if (!brevoApiKey || !emailFrom) {
    throw new Error(
      `[refund-email] missing BREVO_API_KEY or EMAIL_FROM_ADDRESS for refund request ${refundRequest.id}`
    );
  }

  const sender = parseSender(emailFrom);
  const attendeeName =
    refundRequest.payment.user.firstName ||
    refundRequest.payment.user.username ||
    refundRequest.payment.user.email;
  const eventTimeZone = refundRequest.payment.event.eventTimeZone ?? 'UTC';
  const eventDateTime = formatEventDateTime(
    new Date(refundRequest.payment.event.date),
    eventTimeZone
  );
  const refundAmountFormatted = formatAmount(
    refundRequest.payment.amountCents,
    refundRequest.payment.currency
  );

  const htmlContent = await render(
    RefundConfirmationEmail({
      attendeeName,
      buyerEmail: refundRequest.payment.user.email,
      eventName: refundRequest.payment.event.title,
      eventDateTime,
      eventTimeZone,
      eventLocation: refundRequest.payment.event.location ?? null,
      refundAmountFormatted,
      refundCurrency: refundRequest.payment.currency.toUpperCase(),
      refundReference: refundRequest.refundReference,
      refundReferenceNote: getReferenceCopy(refundRequest.refundReference),
      refundId: refundRequest.stripeRefundId,
      paymentIntentId: refundRequest.payment.stripePaymentIntentId,
      chargeId: refundRequest.payment.stripeChargeId,
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
        email: refundRequest.payment.user.email,
        name: attendeeName,
      },
    ],
    subject: `Refund confirmed: ${refundRequest.payment.event.title}`,
    htmlContent,
  });

  const markedSent = await prisma.refundRequest.updateMany({
    where: {
      id: refundRequest.id,
      refundEmailSentAt: null,
    },
    data: {
      refundEmailSentAt: new Date(),
    },
  });

  if (markedSent.count === 0) {
    console.warn(
      `[refund-email] refund request ${refundRequest.id} was already marked as sent after delivery`
    );
    return { sent: false, reason: 'already-sent' };
  }

  const messageId = result?.body?.messageId;
  console.log(
    `[refund-email] sent refund confirmation for refund request ${refundRequest.id}` +
      (messageId ? ` (messageId: ${messageId})` : '')
  );
  return { sent: true };
}
