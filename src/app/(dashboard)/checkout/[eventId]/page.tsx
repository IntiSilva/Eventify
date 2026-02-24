import CheckoutClient from './CheckoutClient';
import DashboardPageWrapper from '@/components/DashboardPageWrapper';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { createOrReusePaymentIntentForEvent } from '@/lib/payments/intent';
import { NotFoundError, isPaymentError } from '@/lib/payments/errors';

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const { userId } = await auth();

  // Require sign-in for paid checkout
  if (!userId) {
    redirect('/sign-in');
  }

  try {
    const result = await createOrReusePaymentIntentForEvent({ eventId, userId });

    // If payment is in progress, render the Checkout flow
    if (result.state === 'PAYMENT_IN_PROGRESS') {
      return (
        <DashboardPageWrapper>
          <main className="mx-auto w-full p-4">
            <section
              className="
                mx-auto overflow-hidden rounded-xl border border-zinc-800 bg-black shadow-2xl
                !max-w-none !w-[min(72rem,calc(100vw-2rem))]
                2xl:!w-[min(80rem,calc(100vw-4rem))]
              "
            >
              <div className="p-6 pb-4 border-b border-zinc-800">
                <h1 className="text-2xl font-semibold text-white text-center">
                  Complete Ticket Payment
                </h1>
              </div>

              <div className="px-0.5 md:px-6 pt-3 pb-6">
                <CheckoutClient
                  eventId={eventId}
                  userId={userId}
                  state={result.state}
                  event={result.event}
                  clientSecret={result.clientSecret}
                  publishableKey={result.publishableKey}
                />
              </div>
            </section>
          </main>
        </DashboardPageWrapper>
      );
    }

    // ALREADY_PAID_* states: show acknowledgement and guidance
    return (
      <DashboardPageWrapper>
        <main className="mx-auto max-w-xl p-6">
          <h1 className="mb-4 text-2xl font-semibold text-white text-center">Ticket Payment</h1>
          <div className="text-zinc-300">
            <p className="mb-3">Your payment has already been recorded for this event.</p>
            <p className="text-sm text-zinc-400 mb-4">If your RSVP is not visible yet, it should appear shortly — webhooks and background reconciliation may take a moment.</p>
            <div className="flex gap-3">
              <a href="/agenda" className="inline-block px-3 py-1.5 bg-white text-black rounded text-sm font-medium hover:bg-zinc-200">Go to agenda</a>
              <a href={`/events/${eventId}`} className="inline-block px-3 py-1.5 border border-zinc-700 text-sm rounded text-zinc-200 hover:bg-zinc-900">View event</a>
            </div>
          </div>
        </main>
      </DashboardPageWrapper>
    );
  } catch (error: unknown) {
    const message =
      isPaymentError(error)
        ? error.message
        : 'Failed to initialize payment';

    const showNotFoundInfo = error instanceof NotFoundError;

    return (
      <DashboardPageWrapper>
        <main className="mx-auto max-w-xl p-6">
          <h1 className="mb-4 text-2xl font-semibold text-white text-center">
            Complete Ticket Payment
          </h1>
          <div className="text-rose-500">
            <p className="font-semibold">{message}</p>
            {showNotFoundInfo && (
              <p className="text-sm text-zinc-400 mt-2">
                The event could not be found. Please check the link.
              </p>
            )}
          </div>
        </main>
      </DashboardPageWrapper>
    );
  }
}

