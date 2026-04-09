'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import AnimatedIcon from '@/components/LordIcons/AnimatedIcon';
import { CheckAnimatedIcon } from '@/lib/icons';

/**
 * This page is reached after a Stripe 3DS redirect has been cleaned by the return handler.
 * The URL is now clean (no payment_intent_client_secret).
 * The return handler has set a short-lived cookie with the payment_intent id.
 * The CheckoutClient (back on /checkout/[eventId]) detects this cookie on mount and shows success in-modal.
 *
 * This page serves as a fallback landing point with instructions to return to the modal.
 */
export default function CheckoutSuccessPage() {
  const router = useRouter();

  useEffect(() => {
    // If user lands here directly (not from a redirect), redirect back to /checkout
    // The CheckoutClient will handle cookie detection and show success modal
    // Give a short delay to ensure cookie is readable
    const timer = setTimeout(() => {
      router.replace('/agenda');
    }, 2000);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <main className="mx-auto max-w-xl p-6">
      <div className="flex flex-col items-center text-center">
        <AnimatedIcon icon={CheckAnimatedIcon} size={48} state="in" persistAfterIn  className='mb-4'/>
        <h1 className="text-2xl font-semibold text-white">Payment submitted</h1>
        <p className="mt-2 text-sm text-zinc-400">
          We are processing your payment result. Attendance is confirmed only after final server validation. If joining is no longer allowed, your payment will be refunded automatically.
        </p>
        <button
          onClick={() => router.push('/agenda')}
          className={cn(
            'mt-6 h-11 px-6 rounded-xl border border-zinc-700 bg-emerald-600 text-white text-sm font-medium',
            'transition-colors hover:bg-emerald-700',
          )}
        >
          Go to agenda
        </button>
      </div>
    </main>
  );
}
