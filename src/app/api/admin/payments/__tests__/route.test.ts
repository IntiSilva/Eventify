import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  listAdminPayments: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: h.auth,
}));

vi.mock('@/lib/admin/payments', () => ({
  listAdminPayments: h.listAdminPayments,
}));

import { GET } from '@/app/api/admin/payments/route';

describe('GET /api/admin/payments', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    h.auth.mockReset();
    h.listAdminPayments.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns 401 when requester is not signed in', async () => {
    h.auth.mockResolvedValue({ userId: null, sessionClaims: null });

    const res = await GET(new Request('http://localhost/api/admin/payments'));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({
      success: false,
      error: 'Unauthorized',
    });
    expect(h.listAdminPayments).not.toHaveBeenCalled();
  });

  it('returns 403 when requester is not admin', async () => {
    h.auth.mockResolvedValue({
      userId: 'user_1',
      sessionClaims: {
        publicMetadata: { role: 'user' },
      },
    });

    const res = await GET(new Request('http://localhost/api/admin/payments'));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({
      success: false,
      error: 'Forbidden',
    });
    expect(h.listAdminPayments).not.toHaveBeenCalled();
  });

  it('delegates parsed filters to the admin payments query for admin users', async () => {
    h.auth.mockResolvedValue({
      userId: 'admin_1',
      sessionClaims: {
        publicMetadata: { role: 'admin' },
      },
    });
    h.listAdminPayments.mockResolvedValue({
      data: [],
      hasMore: false,
      availableCurrencies: ['eur', 'usd'],
      filter: {
        search: 'buyer',
        paymentStatus: 'succeeded',
        currency: 'USD',
        refundState: 'processing',
        payoutTarget: 'organizer',
        limit: 55,
      },
    });

    const res = await GET(
      new Request(
        'http://localhost/api/admin/payments?limit=55&search=buyer&paymentStatus=succeeded&currency=USD&refundState=processing&payoutTarget=organizer'
      )
    );
    const body = await res.json();

    expect(h.listAdminPayments).toHaveBeenCalledWith({
      limit: 55,
      search: 'buyer',
      paymentStatus: 'succeeded',
      currency: 'USD',
      refundState: 'processing',
      payoutTarget: 'organizer',
    });
    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: [],
      hasMore: false,
      availableCurrencies: ['eur', 'usd'],
      filter: {
        search: 'buyer',
        paymentStatus: 'succeeded',
        currency: 'USD',
        refundState: 'processing',
        payoutTarget: 'organizer',
        limit: 55,
      },
    });
  });

  it('normalizes invalid query params before delegating', async () => {
    h.auth.mockResolvedValue({
      userId: 'admin_1',
      sessionClaims: {
        publicMetadata: { role: 'admin' },
      },
    });
    h.listAdminPayments.mockResolvedValue({
      data: [],
      hasMore: false,
      availableCurrencies: [],
      filter: {
        search: null,
        paymentStatus: 'all',
        currency: null,
        refundState: 'all',
        payoutTarget: 'all',
        limit: 40,
      },
    });

    await GET(
      new Request(
        'http://localhost/api/admin/payments?limit=not-a-number&paymentStatus=invalid&currency=12&refundState=invalid&payoutTarget=invalid'
      )
    );

    expect(h.listAdminPayments).toHaveBeenCalledWith({
      limit: undefined,
      search: null,
      paymentStatus: 'all',
      currency: null,
      refundState: 'all',
      payoutTarget: 'all',
    });
  });

  it('returns 500 when list query throws', async () => {
    h.auth.mockResolvedValue({
      userId: 'admin_1',
      sessionClaims: {
        publicMetadata: { role: 'admin' },
      },
    });
    h.listAdminPayments.mockRejectedValue(new Error('db down'));

    const res = await GET(new Request('http://localhost/api/admin/payments'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: 'Failed to fetch admin payments: db down',
    });
  });
});
