import CheckoutOverlayShell from '@/components/Checkout/CheckoutOverlayShell';
import CheckoutClient from '../../../checkout/[eventId]/CheckoutClient';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { createOrReusePaymentIntentForEvent } from '@/lib/payments/intent';
import { NotFoundError, isPaymentError } from '@/lib/payments/errors';

type CheckoutLoadResult =
  | {
      ok: true;
      result: Awaited<ReturnType<typeof createOrReusePaymentIntentForEvent>>;
    }
  | { ok: false; error: unknown };

async function loadCheckoutState(
  eventId: string,
  userId: string
): Promise<CheckoutLoadResult> {
  try {
    return {
      ok: true,
      result: await createOrReusePaymentIntentForEvent({ eventId, userId }),
    };
  } catch (error: unknown) {
    return { ok: false, error };
  }
}

export default async function CheckoutInterceptPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const { userId } = await auth();

  if (!userId) {
    return (
      <CheckoutOverlayShell title="Complete Ticket Payment" eventId={eventId}>
        <div className="text-lg text-zinc-300 space-y-3 py-6">
          <p>You need to sign in to complete this purchase.</p>
          <Link
            href="/sign-in"
            className="inline-block px-3 py-1.5 bg-white text-black rounded text-sm font-medium hover:bg-zinc-200"
          >
            Sign in
          </Link>
        </div>
      </CheckoutOverlayShell>
    );
  }

  const checkoutLoad = await loadCheckoutState(eventId, userId);

  if (!checkoutLoad.ok) {
    const error = checkoutLoad.error;
    const message = isPaymentError(error)
      ? error.message
      : 'Failed to initialize payment';

    const showNotFoundInfo = error instanceof NotFoundError;

    return (
      <CheckoutOverlayShell title="Complete Ticket Payment" eventId={eventId}>
        <div className="text-sm text-rose-500 space-y-2 py-4">
          <p className="font-semibold">{message}</p>
          {showNotFoundInfo && (
            <p className="text-xs text-zinc-400">
              The event could not be found. Please check the link.
            </p>
          )}
        </div>
      </CheckoutOverlayShell>
    );
  }

  const result = checkoutLoad.result;

  if (result.state === 'PAYMENT_IN_PROGRESS') {
    return (
      <CheckoutOverlayShell title="Complete Ticket Payment" eventId={eventId}>
        <CheckoutClient
          eventId={eventId}
          userId={userId}
          state={result.state}
          event={result.event}
          paymentIntentId={result.paymentIntentId}
          clientSecret={result.clientSecret}
          publishableKey={result.publishableKey}
        />
      </CheckoutOverlayShell>
    );
  }

  return (
    <CheckoutOverlayShell title="Complete Ticket Payment" eventId={eventId}>
      <div className="text-sm text-zinc-300 space-y-3 py-6">
        <p>Your payment has already been recorded for this event.</p>
        <p className="text-xs text-zinc-400">
          Attendance is only confirmed after final server validation. If the
          event can no longer accept attendees, an automatic refund may be in
          progress.
        </p>
      </div>
    </CheckoutOverlayShell>
  );
}
