import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createOrReusePaymentIntentForEvent } from '@/lib/payments/intent';
import {
  isPaymentError,
  mapPaymentErrorToStatusCode,
} from '@/lib/payments/errors';

export const runtime = 'nodejs';

type Body = { eventId?: string };

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = (await req.json()) as Body;
    if (!body.eventId) {
      return NextResponse.json(
        { success: false, error: 'Missing eventId' },
        { status: 400 }
      );
    }

    const result = await createOrReusePaymentIntentForEvent({
      eventId: body.eventId,
      userId,
    });

    // Return unified ticket-state result for client-side handling
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error('[POST /api/payments/create-intent] error', error);

    if (isPaymentError(error)) {
      const statusCode = mapPaymentErrorToStatusCode(error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: statusCode }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to create payment intent' },
      { status: 500 }
    );
  }
}
