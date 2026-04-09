import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CheckoutEventForClient } from '@/types/event';

const h = vi.hoisted(() => ({
  router: {
    push: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
  },
  clearRsvpPending: vi.fn(),
  upsertEvents: vi.fn(),
  confirmPayment: vi.fn(),
  loadStripe: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={props.alt ?? ''} {...props} />
  ),
}));

vi.mock('@/contexts/EventsContext', () => ({
  useRsvpActions: () => ({
    clearRsvpPending: h.clearRsvpPending,
  }),
  useStoreWriters: () => ({
    upsertEvents: h.upsertEvents,
  }),
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: (...args: unknown[]) => h.loadStripe(...args),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useElements: () => ({}),
  useStripe: () => ({
    confirmPayment: h.confirmPayment,
  }),
}));

vi.mock('@/components/UserAvatar', () => ({
  __esModule: true,
  default: () => <div data-testid="user-avatar" />,
}));

vi.mock('@/components/LordIcons/AnimatedIcon', () => ({
  __esModule: true,
  default: () => <div data-testid="animated-icon" />,
}));

import CheckoutClient from '@/app/(dashboard)/checkout/[eventId]/CheckoutClient';

const EVENT: CheckoutEventForClient = {
  id: 'evt_1',
  title: 'Paid Event',
  description: 'Test event',
  date: new Date('2099-01-01T10:00:00.000Z'),
  location: 'Venue',
  category: 'tech',
  eventTimeZone: 'UTC',
  contactEmail: null,
  contactPhone: null,
  contactPhoneApps: null,
  isPaid: true,
  priceCents: 5000,
  currency: 'USD',
  creator: null,
};

describe('CheckoutClient pre-confirm gate', () => {
  beforeEach(() => {
    h.router.push.mockReset();
    h.router.back.mockReset();
    h.router.replace.mockReset();
    h.clearRsvpPending.mockReset();
    h.upsertEvents.mockReset();
    h.confirmPayment.mockReset();
    h.loadStripe.mockReset();
    h.loadStripe.mockResolvedValue({});
  });

  it('does not call stripe.confirmPayment when pre-confirm blocks and resets pending state', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: 'This event has already started and no longer accepts new attendance or ticket purchases.',
            errorCode: 'EVENT_NOT_JOINABLE',
          }),
          {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }
        )
      );

    render(
      <CheckoutClient
        eventId="evt_1"
        userId="user_1"
        state="PAYMENT_IN_PROGRESS"
        event={EVENT}
        paymentIntentId="pi_1"
        clientSecret="cs_test_1"
        publishableKey="pk_test_1"
      />
    );

    const payButton = screen.getByRole('button', { name: /Pay /i });
    await user.click(payButton);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/payments/pre-confirm',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    const body = fetchSpy.mock.calls[0]?.[1];
    expect(typeof body).toBe('object');
    const parsedBody = JSON.parse(String((body as RequestInit).body));
    expect(parsedBody).toEqual({
      eventId: 'evt_1',
      paymentIntentId: 'pi_1',
    });

    expect(h.confirmPayment).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        'This event has already started and no longer accepts new attendance or ticket purchases.'
      )
    ).toBeInTheDocument();
    expect(h.clearRsvpPending).toHaveBeenCalledWith('evt_1', 'user_1');
    await waitFor(() => {
      expect(payButton).toBeEnabled();
    });

    fetchSpy.mockRestore();
  });
});
