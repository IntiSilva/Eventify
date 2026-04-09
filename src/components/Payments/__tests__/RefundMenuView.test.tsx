import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentStatus, RefundRequestStatus } from '@/generated/prisma';
import RefundMenuView from '@/components/Payments/RefundMenuView';

const h = vi.hoisted(() => ({
  getMyRefundContextForEvent: vi.fn(),
  requestRefund: vi.fn(),
  revalidateAfterCheckout: vi.fn(),
  upsertEvents: vi.fn(),
  mutate: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/app/(dashboard)/rsvp/actions', () => ({
  getMyRefundContextForEvent: h.getMyRefundContextForEvent,
  requestRefund: h.requestRefund,
}));

vi.mock('sonner', () => ({
  toast: h.toast,
}));

vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({
    user: { id: 'buyer_1' },
  }),
}));

vi.mock('swr', () => ({
  useSWRConfig: () => ({
    mutate: h.mutate,
  }),
}));

vi.mock('@/contexts/EventsContext', () => ({
  useStoreWriters: () => ({
    upsertEvents: h.upsertEvents,
  }),
}));

vi.mock('@/lib/payments/revalidateAfterCheckout', () => ({
  revalidateAfterCheckout: h.revalidateAfterCheckout,
}));

vi.mock('@/components/ui/dialog', () => ({
  DialogHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
}));

vi.mock('@/components/ui/drawer', () => ({
  DrawerHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DrawerTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
}));

describe('RefundMenuView', () => {
  beforeEach(() => {
    h.getMyRefundContextForEvent.mockReset();
    h.requestRefund.mockReset();
    h.revalidateAfterCheckout.mockReset();
    h.upsertEvents.mockReset();
    h.mutate.mockReset();
    h.toast.error.mockReset();
    h.toast.success.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the refund request form when the ticket is eligible', async () => {
    h.getMyRefundContextForEvent.mockResolvedValue({
      success: true,
      data: {
        paymentId: 'pay_1',
        paymentStatus: PaymentStatus.succeeded,
        refundRequest: null,
        canRequest: true,
        blockedReason: null,
      },
    });

    render(<RefundMenuView eventId="evt_1" isDesktop onBack={() => {}} />);

    expect(await screen.findByText('Reason (optional)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request refund' })).toBeInTheDocument();
  });

  it('renders the existing refund request summary when one already exists', async () => {
    h.getMyRefundContextForEvent.mockResolvedValue({
      success: true,
      data: {
        paymentId: 'pay_1',
        paymentStatus: PaymentStatus.succeeded,
        refundRequest: {
          id: 'rr_1',
          status: RefundRequestStatus.requested,
          reason: 'Need to cancel',
          createdAt: '2026-03-01T20:00:00.000Z',
        },
        canRequest: false,
        blockedReason: null,
      },
    });

    render(<RefundMenuView eventId="evt_1" isDesktop onBack={() => {}} />);

    expect(await screen.findByText(/Requested on/i)).toBeInTheDocument();
    expect(screen.getByText('Need to cancel')).toBeInTheDocument();
    expect(screen.getByText('Requested')).toBeInTheDocument();
  });

  it('renders a deterministic blocked state when the refund is unavailable', async () => {
    h.getMyRefundContextForEvent.mockResolvedValue({
      success: true,
      data: {
        paymentId: 'pay_1',
        paymentStatus: PaymentStatus.succeeded,
        refundRequest: null,
        canRequest: false,
        blockedReason: 'CUTOFF',
      },
    });

    render(<RefundMenuView eventId="evt_1" isDesktop onBack={() => {}} />);

    expect(
      await screen.findByText('Refunds are not available right now')
    ).toBeInTheDocument();
    expect(
      screen.getByText('The refund request window has closed for this ticket.')
    ).toBeInTheDocument();
  });

  it('submits the refund request with the captured payment id', async () => {
    const user = userEvent.setup();
    const onAttendanceRevoked = vi.fn();

    h.getMyRefundContextForEvent
      .mockResolvedValueOnce({
        success: true,
        data: {
          paymentId: 'pay_1',
          paymentStatus: PaymentStatus.succeeded,
          refundRequest: null,
          canRequest: true,
          blockedReason: null,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          paymentId: 'pay_1',
          paymentStatus: PaymentStatus.succeeded,
          refundRequest: {
            id: 'rr_2',
            status: RefundRequestStatus.requested,
            reason: 'Need to cancel',
            createdAt: '2026-03-02T18:00:00.000Z',
          },
          canRequest: false,
          blockedReason: null,
        },
      });

    h.requestRefund.mockResolvedValue({
      success: true,
      message: 'Refund requested.',
    });
    h.revalidateAfterCheckout.mockResolvedValue(undefined);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'evt_1',
            rsvps: [],
          },
        }),
      })
    );

    render(
      <RefundMenuView
        eventId="evt_1"
        isDesktop
        onBack={() => {}}
        onAttendanceRevoked={onAttendanceRevoked}
      />
    );

    await screen.findByText('Reason (optional)');
    await user.type(
      screen.getByLabelText('Reason (optional)'),
      'Need to cancel'
    );
    await user.click(screen.getByRole('button', { name: 'Request refund' }));

    await waitFor(() => {
      expect(h.requestRefund).toHaveBeenCalledWith('pay_1', 'Need to cancel');
    });
    await waitFor(() => {
      expect(h.revalidateAfterCheckout).toHaveBeenCalledWith({
        mutate: h.mutate,
        eventId: 'evt_1',
        userId: 'buyer_1',
      });
    });
    expect(h.upsertEvents).toHaveBeenCalled();
    expect(onAttendanceRevoked).toHaveBeenCalledWith('evt_1');
    await screen.findByText(/Requested on/i);
  });
});

