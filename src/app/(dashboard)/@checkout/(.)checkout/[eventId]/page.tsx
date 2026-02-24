import CheckoutOverlayShell from '@/components/Checkout/CheckoutOverlayShell';
import CheckoutClient from '../../../checkout/[eventId]/CheckoutClient';
import { auth } from '@clerk/nextjs/server';
import { createOrReusePaymentIntentForEvent } from '@/lib/payments/intent';
import { NotFoundError, isPaymentError } from '@/lib/payments/errors';

export default async function CheckoutInterceptPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const { userId } = await auth();

  // If user not signed in, show message inside overlay
  if (!userId) {
    return (
      <CheckoutOverlayShell title="Complete Ticket Payment" eventId={eventId}>
        <div className="text-lg text-zinc-300 space-y-3 py-6">
          <p>You need to sign in to complete this purchase.</p>
          <a
            href="/sign-in"
            className="inline-block px-3 py-1.5 bg-white text-black rounded text-sm font-medium hover:bg-zinc-200"
          >
            Sign in
          </a>
        </div>
      </CheckoutOverlayShell>
    );
  }

  try {
    const result = await createOrReusePaymentIntentForEvent({ eventId, userId });

    if (result.state === 'PAYMENT_IN_PROGRESS') {
      return (
        <CheckoutOverlayShell title="Complete Ticket Payment" eventId={eventId}>
          <CheckoutClient
            eventId={eventId}
            userId={userId}
            state={result.state}
            event={result.event}
            clientSecret={result.clientSecret}
            publishableKey={result.publishableKey}
          />
        </CheckoutOverlayShell>
      );
    }

    // Already paid — show acknowledgement inside overlay
    return (
      <CheckoutOverlayShell title="Complete Ticket Payment" eventId={eventId}>
        <div className="text-sm text-zinc-300 space-y-3 py-6">
          <p>Your payment has already been recorded for this event.</p>
          <p className="text-xs text-zinc-400">If your RSVP is not visible yet, it should appear shortly. You can close this dialog to continue browsing.</p>
        </div>
      </CheckoutOverlayShell>
    );
  } catch (error: unknown) {
    const message =
      isPaymentError(error)
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
}

