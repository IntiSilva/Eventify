import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaidTicketInfoPopover from '@/components/Payments/PaidTicketInfoPopover';

vi.mock('@/components/LordIcons/AnimatedIcon', () => ({
  default: () => <span data-testid="loading-icon" />,
}));

vi.mock('@/lib/icons', () => ({
  LoadingCirclesAnimatedIcon: {},
}));

describe('PaidTicketInfoPopover', () => {
  it('renders a disabled CTA while checking purchase status', () => {
    render(
      <PaidTicketInfoPopover
        open
        isLoading
        isSignedIn
        refundCtaState="loading"
        onOpenChange={() => {}}
      >
        <button type="button">Trigger</button>
      </PaidTicketInfoPopover>
    );

    const button = screen.getByRole('button', { name: 'Checking purchase...' });
    expect(button).toBeDisabled();
    expect(screen.getByText('Loading payment details')).toBeInTheDocument();
  });

  it('hides the refund CTA when no purchase is found', () => {
    render(
      <PaidTicketInfoPopover
        open
        isSignedIn
        refundCtaState="unavailable"
        onOpenChange={() => {}}
      >
        <button type="button">Trigger</button>
      </PaidTicketInfoPopover>
    );

    expect(screen.getByText('No payment found for this account.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Request a refund' })
    ).not.toBeInTheDocument();
  });

  it('renders a button CTA for requesting a refund without navigating', async () => {
    const user = userEvent.setup();
    const onRequestRefund = vi.fn();

    render(
      <PaidTicketInfoPopover
        open
        isSignedIn
        refundCtaState="available"
        onRequestRefund={onRequestRefund}
        paymentStatus={{
          eventId: 'evt_1',
          ticketState: 'paid',
          alreadyPaid: true,
          payment: {
            amountCents: 2500,
            currency: 'usd',
            paidAt: '2026-03-01T20:00:00.000Z',
          },
        }}
        onOpenChange={() => {}}
      >
        <button type="button">Trigger</button>
      </PaidTicketInfoPopover>
    );

    const button = screen.getByRole('button', { name: 'Request a refund' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).not.toHaveAttribute('href');

    await user.click(button);

    expect(onRequestRefund).toHaveBeenCalledTimes(1);
    expect(screen.getByText('$25.00')).toBeInTheDocument();
    expect(screen.getByText(/Paid at/i)).toBeInTheDocument();
  });

  it('renders a disabled refund CTA with blocked reason when refund is unavailable for a paid ticket', async () => {
    const user = userEvent.setup();
    const onRequestRefund = vi.fn();

    render(
      <PaidTicketInfoPopover
        open
        isSignedIn
        refundCtaState="unavailable"
        refundBlockedMessage="Refund requests must be submitted at least 4 hours before the event."
        onRequestRefund={onRequestRefund}
        paymentStatus={{
          eventId: 'evt_1',
          ticketState: 'paid',
          alreadyPaid: true,
          payment: {
            amountCents: 2500,
            currency: 'usd',
            paidAt: '2026-03-01T20:00:00.000Z',
          },
        }}
        onOpenChange={() => {}}
      >
        <button type="button">Trigger</button>
      </PaidTicketInfoPopover>
    );

    const button = screen.getByRole('button', { name: 'Request a refund' });
    expect(button).toBeDisabled();
    expect(
      screen.getByText('Refund requests must be submitted at least 4 hours before the event.')
    ).toBeInTheDocument();

    await user.click(button);
    expect(onRequestRefund).not.toHaveBeenCalled();
  });
});
