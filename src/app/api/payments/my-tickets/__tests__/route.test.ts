import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  listViewerTicketsForUser: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: h.auth,
}));

vi.mock('@/lib/payments/viewerTickets.server', () => ({
  listViewerTicketsForUser: h.listViewerTicketsForUser,
}));

import { GET } from '@/app/api/payments/my-tickets/route';

describe('GET /api/payments/my-tickets', () => {
  beforeEach(() => {
    h.auth.mockReset();
    h.listViewerTicketsForUser.mockReset();
  });

  it('returns 401 when requester is unauthenticated', async () => {
    h.auth.mockResolvedValue({ userId: null });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(json).toEqual({
      success: false,
      error: 'Unauthorized',
    });
    expect(h.listViewerTicketsForUser).not.toHaveBeenCalled();
  });

  it('calls user-scoped helper with the authenticated userId', async () => {
    h.auth.mockResolvedValue({ userId: 'user_1' });
    h.listViewerTicketsForUser.mockResolvedValue([
      {
        paymentId: 'pay_1',
        event: {
          id: 'evt_1',
          title: 'Paid Event',
          date: '2026-03-02T12:00:00.000Z',
          location: 'Buenos Aires',
          eventTimeZone: 'America/Argentina/Buenos_Aires',
        },
        payment: {
          amountCents: 5000,
          currency: 'USD',
          paidAt: '2026-03-01T12:00:00.000Z',
        },
        ticketState: 'paid',
        refund: null,
      },
    ]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(h.listViewerTicketsForUser).toHaveBeenCalledWith('user_1');
    expect(json).toEqual({
      success: true,
      data: {
        tickets: [
          {
            paymentId: 'pay_1',
            event: {
              id: 'evt_1',
              title: 'Paid Event',
              date: '2026-03-02T12:00:00.000Z',
              location: 'Buenos Aires',
              eventTimeZone: 'America/Argentina/Buenos_Aires',
            },
            payment: {
              amountCents: 5000,
              currency: 'USD',
              paidAt: '2026-03-01T12:00:00.000Z',
            },
            ticketState: 'paid',
            refund: null,
          },
        ],
      },
    });
  });
});
