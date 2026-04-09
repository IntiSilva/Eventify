import 'server-only';

import { PaymentStatus } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { resolveTicketStateForSucceededPayment } from '@/lib/payments/ticketState';
import type { ViewerTicketRecord } from '@/types/api';

export async function listViewerTicketsForUser(userId: string): Promise<ViewerTicketRecord[]> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error('Missing user id');
  }

  const payments = await prisma.payment.findMany({
    where: {
      userId: normalizedUserId,
      status: PaymentStatus.succeeded,
      amountCents: { gt: 0 },
      event: {
        isPaid: true,
      },
    },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    select: {
      id: true,
      amountCents: true,
      currency: true,
      createdAt: true,
      event: {
        select: {
          id: true,
          title: true,
          date: true,
          location: true,
          eventTimeZone: true,
        },
      },
      refundRequest: {
        select: {
          status: true,
          stripeRefundId: true,
          createdAt: true,
          updatedAt: true,
          refundSucceededAt: true,
        },
      },
    },
  });

  return Promise.all(
    payments.map(async (payment) => {
      const ticketState = await resolveTicketStateForSucceededPayment({
        paymentId: payment.id,
        amountCents: payment.amountCents,
        refundRequest: payment.refundRequest
          ? {
              status: payment.refundRequest.status,
              stripeRefundId: payment.refundRequest.stripeRefundId,
            }
          : null,
      });

      return {
        paymentId: payment.id,
        event: {
          id: payment.event.id,
          title: payment.event.title,
          date: payment.event.date.toISOString(),
          location: payment.event.location,
          eventTimeZone: payment.event.eventTimeZone,
        },
        payment: {
          amountCents: payment.amountCents,
          currency: payment.currency,
          paidAt: payment.createdAt.toISOString(),
        },
        ticketState,
        refund: payment.refundRequest
          ? {
              status: payment.refundRequest.status,
              requestedAt: payment.refundRequest.createdAt.toISOString(),
              updatedAt: payment.refundRequest.updatedAt.toISOString(),
              succeededAt: payment.refundRequest.refundSucceededAt
                ? payment.refundRequest.refundSucceededAt.toISOString()
                : undefined,
            }
          : null,
      } satisfies ViewerTicketRecord;
    })
  );
}
