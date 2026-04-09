'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useSWRConfig } from 'swr';
import {
  MapPin,
  Calendar,
  Mail,
  Phone,
  Tag,
  Clock,
} from 'lucide-react';

import { loadStripe, type Appearance, type StripeElementsOptions } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

import type { CheckoutEventForClient } from '@/types/event';
import type { TicketState } from '@/types/payments/stripe';
import type { EventWithCreatorAndRsvps } from '@/types/event';
import type { EventByIdResponse } from '@/types/api';
import UserAvatar from '@/components/UserAvatar';
import { Badge } from '@/components/ui/badge';
import {
  capitalizeFirstLetter,
  cn,
  formatPrice,
  getCategoryBadgeColors,
} from '@/lib/utils';
import { useStoreWriters } from '@/contexts/EventsContext';
import { useRsvpActions } from '@/contexts/EventsContext';
import AnimatedIcon from '@/components/LordIcons/AnimatedIcon';
import { CheckAnimatedIcon } from '@/lib/icons';
import {
  revalidateAfterCheckout,
  scheduleSecondPassRevalidate,
} from '@/lib/payments/revalidateAfterCheckout';

function getContactPhoneAppsLabel(apps: CheckoutEventForClient['contactPhoneApps']): string | null {
  if (apps === 'whatsapp') return 'WhatsApp';
  if (apps === 'telegram') return 'Telegram';
  if (apps === 'both') return 'WhatsApp & Telegram';
  return null;
}

function CheckoutForm({
  event,
  eventId,
  userId,
  paymentIntentId,
  onSuccess,
  onError,
  reconcileAfterPayment,
}: {
  event: CheckoutEventForClient;
  eventId: string;
  userId: string;
  paymentIntentId: string;
  onSuccess: () => void;
  onError: (error: string) => void;
  reconcileAfterPayment: (eventId: string, userId: string) => Promise<void>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { clearRsvpPending } = useRsvpActions();

  const returnUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/checkout/${event.id}/return`;
  }, [event.id]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setPending(true);
    setError(null);

    try {
      const preConfirmRes = await fetch('/api/payments/pre-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, paymentIntentId }),
      });
      const preConfirmPayload = (await preConfirmRes.json().catch(() => null)) as
        | {
            success?: boolean;
            error?: string;
          }
        | null;

      if (!preConfirmRes.ok || !preConfirmPayload?.success) {
        const message =
          typeof preConfirmPayload?.error === 'string' &&
          preConfirmPayload.error.trim().length > 0
            ? preConfirmPayload.error
            : 'This checkout session can no longer be confirmed.';
        setError(message);
        setPending(false);
        onError(message);
        clearRsvpPending(eventId, userId);
        return;
      }

      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: 'if_required',
      });

      // If no redirect is needed, payment succeeded in-client
      if (result.paymentIntent?.status === 'succeeded') {
        setPending(false);
        // Fetch authoritative event and reconcile with context
        await reconcileAfterPayment(eventId, userId);
        onSuccess();
        return;
      }

      if (result.error?.message) {
        setError(result.error.message);
        setPending(false);
        onError(result.error.message);
        // Clear pending on error
        clearRsvpPending(eventId, userId);
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Payment confirmation failed. Please try again.';
      setError(message);
      setPending(false);
      onError(message);
      clearRsvpPending(eventId, userId);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}

      <button
        type="submit"
        disabled={pending || !stripe || !elements}
        className={cn(
          'h-11 w-full rounded-xl border border-zinc-700 bg-black text-white',
          'transition-colors hover:bg-white hover:text-black',
          'disabled:opacity-50 disabled:cursor-not-allowed'
        )}
      >
        {pending ? 'Processing...' : `Pay ${formatPrice(event.priceCents ?? 0, (event.currency ?? 'USD').toUpperCase())}`}
      </button>

      <p className="text-xs text-zinc-500">
        Payments are processed securely by Stripe.
      </p>
    </form>
  );
}

export default function CheckoutClient({
  eventId,
  userId,
  state,
  event,
  paymentIntentId,
  clientSecret,
  publishableKey,
}: {
  eventId: string;
  userId: string;
  state: TicketState;
  event: CheckoutEventForClient;
  paymentIntentId: string;
  clientSecret: string;
  publishableKey: string;
}) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { clearRsvpPending } = useRsvpActions();
  const { upsertEvents } = useStoreWriters();
  const secondPassTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [returnIntentId, setReturnIntentId] = useState<string | null>(null);
  const [, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (secondPassTimerRef.current) {
        clearTimeout(secondPassTimerRef.current);
        secondPassTimerRef.current = null;
      }
    };
  }, []);

  // Reconciliation after payment (used by both form success and 3DS return)
  const reconcileAfterPayment = useCallback(
    async (eventId: string, userId: string) => {
      try {
        const res = await fetch(`/api/events/${eventId}`);
        if (!res.ok) {
          console.error('Failed to fetch event after payment', res.status);
          return;
        }
        const data = (await res.json()) as EventByIdResponse;
        if (data.success && data.data) {
          // Upsert the authoritative event into EventsContext
          upsertEvents([data.data as EventWithCreatorAndRsvps]);
        }
      } catch (err) {
        console.error('Error reconciling event after payment:', err);
      } finally {
        try {
          await revalidateAfterCheckout({ mutate, eventId, userId });
        } catch (revalidateError) {
          console.error('Error revalidating checkout-related caches:', revalidateError);
        }

        if (secondPassTimerRef.current) {
          clearTimeout(secondPassTimerRef.current);
          secondPassTimerRef.current = null;
        }
        secondPassTimerRef.current = scheduleSecondPassRevalidate({
          mutate,
          eventId,
          userId,
        });

        // Clear pending regardless (webhook will reconcile if needed)
        clearRsvpPending(eventId, userId);
      }
    },
    [upsertEvents, clearRsvpPending, mutate]
  );

  // On mount, check for the non-sensitive return intent cookie (set by /return handler after 3DS redirect)
  useEffect(() => {
    const cookieName = 'stripe_return_intent';
    const cookies = document.cookie.split(';').map(c => c.trim());
    const returnCookie = cookies.find(c => c.startsWith(`${cookieName}=`));
    
    if (returnCookie) {
      const intentId = returnCookie.split('=')[1];
      if (intentId) {
        setReturnIntentId(intentId);
        // Clear the cookie from JS (server sets it; we consume and clear it)
        document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; Secure; SameSite=Lax`;
      }
    }
  }, []);

  // On 3DS return, reconcile and clear pending
  useEffect(() => {
    if (returnIntentId) {
      const reconcile = async () => {
        await reconcileAfterPayment(eventId, userId);
        setShowSuccess(true);
      };
      reconcile();
    }
  }, [returnIntentId, eventId, userId, reconcileAfterPayment]);

  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);

  const appearance = useMemo<Appearance>(() => {
    return {
      theme: 'night',
      variables: {
        colorBackground: '#000000',
        colorText: '#ffffff',
        colorTextSecondary: '#a1a1aa',
        colorTextPlaceholder: '#71717a',
        colorPrimary: '#10b981',
        borderRadius: '12px',
        spacingUnit: '4px',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial',
      },
      rules: {
        '.Input': {
          backgroundColor: 'rgba(24,24,27,0.6)',
          border: '1px solid rgba(63,63,70,1)',
        },
        '.Tab': {
          border: '1px solid rgba(63,63,70,1)',
          backgroundColor: 'rgba(24,24,27,0.35)',
        },
        '.Tab--selected': {
          border: '1px solid rgba(16,185,129,0.9)',
          boxShadow: '0 0 0 2px rgba(16,185,129,0.25)',
        },
        '.Label': { color: '#e4e4e7' },
      },
    };
  }, []);

  const elementsOptions = useMemo<StripeElementsOptions>(() => {
    return {
      clientSecret,
      appearance,
      loader: 'auto',
    };
  }, [clientSecret, appearance]);

  // Gate: only show if PAYMENT_IN_PROGRESS
  if (state !== 'PAYMENT_IN_PROGRESS') {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <p className="text-sm text-zinc-300">Payment state invalid</p>
      </div>
    );
  }

  const currency = (event.currency ?? 'USD').toUpperCase();
  const cents = event.priceCents ?? 0;
  const formattedTotal = formatPrice(cents, currency) || `${(cents / 100).toFixed(2)} ${currency}`;
  const contactPhoneAppsLabel = getContactPhoneAppsLabel(event.contactPhoneApps);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: summary (compact on desktop to avoid scroll) */}
      <section
        className={cn(
          'rounded-2xl border border-zinc-800 bg-black/40',
          'p-5 lg:p-6',
          'flex flex-col min-h-0'
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl lg:text-2xl font-bold text-white truncate">
              {event.title}
            </h1>
          </div>

          {/* Keep Back on mobile, desktop uses dialog close */}
          <button
            type="button"
            onClick={() => router.back()}
            className="lg:hidden text-sm text-zinc-400 hover:text-zinc-200 transition-colors whitespace-nowrap"
          >
            Back
          </button>
        </div>

        {/* Main content */}
        <div className="mt-4 flex-1 min-h-0 flex flex-col gap-4 lg:gap-5">
          {/* Event Details */}
          <div className="space-y-2 lg:space-y-2.5">
            {event.date && (
              <div className="flex items-center gap-3 text-sm">
                <Calendar className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="text-zinc-300">
                  {new Date(event.date).toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            )}

            {event.location && (
              <div className="flex items-start gap-3 text-sm">
                <MapPin className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                <span className="text-zinc-300 line-clamp-2">{event.location}</span>
              </div>
            )}

            {event.category && (
              <div className="flex items-center gap-3">
                <Tag className="h-4 w-4 text-emerald-500 shrink-0" />
                <Badge
                  className={cn(
                    'cursor-default whitespace-nowrap border px-2 py-0.5 text-xs font-medium',
                    getCategoryBadgeColors(event.category)
                  )}
                >
                  {capitalizeFirstLetter(event.category)}
                </Badge>
              </div>
            )}
          </div>

          {/* Organizer + Contact in a compact grid on desktop */}
          {(event.creator || event.contactEmail || event.contactPhone) && (
            <div className="border-t border-zinc-800 pt-4 lg:pt-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">
                {/* Organized by */}
                {event.creator ? (
                  <div>
                    <div className="text-xs text-zinc-500 mb-2">Organized by</div>
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        username={event.creator.username}
                        firstName={event.creator.firstName}
                        lastName={event.creator.lastName}
                        imageUrl={event.creator.imageUrl}
                        hasImage={event.creator.hasImage}
                        className="h-9 w-9"
                        variant="creator"
                        borderVariant="none"
                        density="compact"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white truncate">
                          {event.creator.firstName && event.creator.lastName
                            ? `${event.creator.firstName} ${event.creator.lastName}`
                            : `@${event.creator.username}`
                          }
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Contact */}
                {(event.contactEmail || event.contactPhone) ? (
                  <div>
                    <div className="text-xs text-zinc-500 mb-2">Contact</div>
                    <div className="space-y-2">
                      {event.contactEmail ? (
                        <a
                          href={`mailto:${event.contactEmail}`}
                          className="flex items-center gap-3 text-sm text-zinc-300 hover:text-white transition-colors"
                        >
                          <Mail className="h-4 w-4 text-zinc-500 shrink-0" />
                          <span className="truncate">{event.contactEmail}</span>
                        </a>
                      ) : null}

                      {event.contactPhone ? (
                        <a
                          href={`tel:${event.contactPhone}`}
                          className="flex items-center gap-3 text-sm text-zinc-300 hover:text-white transition-colors"
                        >
                          <Phone className="h-4 w-4 text-zinc-500 shrink-0" />
                          <span className="truncate">{event.contactPhone}</span>
                          {contactPhoneAppsLabel ? (
                            <span className="text-xs text-zinc-500 ml-auto shrink-0">
                              {contactPhoneAppsLabel}
                            </span>
                          ) : null}
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Meta row */}
          <div className="border-t border-zinc-800 pt-3 flex items-center justify-between text-xs">
            <div className="flex items-center pt-0.5 gap-2 text-zinc-400">
              <Clock className="h-3.5 w-3.5" />
              <span className="truncate">{event.eventTimeZone || 'UTC'}</span>
            </div>
          </div>

          {/* Description (clamped on desktop to avoid overflow) */}
          {event.description ? (
            <div className="border-t border-zinc-800 pt-3">
              <p className="text-sm text-zinc-400 leading-relaxed line-clamp-4 lg:line-clamp-3">
                {event.description}
              </p>
            </div>
          ) : null}

          {/* Pricing Card - KEPT EXACTLY AS-IS (only moved to bottom) */}
          <div className="mt-auto pt-2">
            <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-400">Amount due today</div>
              <div className="mt-2 text-4xl font-semibold text-white">{formattedTotal}</div>
              <div className="mt-4 h-px bg-zinc-800" />
              <div className="mt-4 flex items-center justify-between text-sm text-white">
                <span>Total</span>
                <span>{formattedTotal}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Right: payment (unchanged) */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-zinc-300">Payment</div>
          <Image src="/stripe-logo-white.svg" alt="Stripe" width={72} height={22} className="h-5 w-auto opacity-90" />
        </div>

        {showSuccess || returnIntentId ? (
          // Success state
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <AnimatedIcon icon={CheckAnimatedIcon} size={48} state="in" persistAfterIn  className='mb-4'/>
            <h2 className="text-xl font-semibold text-white mb-2">Payment submitted</h2>
            <p className="text-sm text-zinc-400 text-center mb-6">
              We are processing your payment result. Attendance is confirmed only after final server validation. If joining is no longer allowed, your payment will be refunded automatically.
            </p>
            <button
              onClick={() => router.push(`/agenda`)}
              className={cn(
                'h-11 px-6 rounded-xl border border-zinc-700 bg-emerald-600 text-white text-sm font-medium',
                'transition-colors hover:bg-emerald-700',
              )}
            >
              Go to agenda
            </button>
          </div>
        ) : (
          // Payment form
          <Elements stripe={stripePromise} options={elementsOptions}>
            <CheckoutForm 
              event={event} 
              eventId={eventId}
              userId={userId}
              paymentIntentId={paymentIntentId}
              onSuccess={() => setShowSuccess(true)}
              onError={(err) => setError(err)}
              reconcileAfterPayment={reconcileAfterPayment}
            />
          </Elements>
        )}
      </section>
    </div>
  );
}
