import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { PaymentStatus } from '@/generated/prisma';
import { resolveTicketStateForSucceededPayment } from '@/lib/payments/ticketState';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

export async function GET(req: Request) {
  const includeDebugPaymentFields = process.env.NODE_ENV !== 'production';
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get('eventId')?.trim();

  if (!eventId) {
    return NextResponse.json({ error: 'Missing eventId' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const payment = await prisma.payment.findFirst({
    where: {
      eventId,
      userId,
      status: PaymentStatus.succeeded,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      amountCents: true,
      currency: true,
      createdAt: true,
      payoutTarget: true,
      destinationAccountId: true,
      id: true,
      refundRequest: {
        select: {
          status: true,
          stripeRefundId: true,
        },
      },
    },
  });

  const ticketState = payment
    ? await resolveTicketStateForSucceededPayment({
        paymentId: payment.id,
        amountCents: payment.amountCents,
        refundRequest: payment.refundRequest,
      })
    : 'none';

  return NextResponse.json(
    {
      eventId,
      ticketState,
      alreadyPaid: ticketState === 'paid',
      payment: payment
        ? {
            amountCents: payment.amountCents,
            currency: payment.currency,
            paidAt: payment.createdAt.toISOString(),
            ...(includeDebugPaymentFields
              ? {
                  payoutTarget: payment.payoutTarget,
                  destinationAccountId: payment.destinationAccountId,
                }
              : {}),
          }
        : undefined,
    },
    {
      headers: NO_STORE_HEADERS,
    }
  );
}
