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

import { GET } from '@/app/api/organizer/payments/route';

describe('GET /api/organizer/payments', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    h.auth.mockReset();
    h.listAdminPayments.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns 401 when requester is unauthenticated', async () => {
    h.auth.mockResolvedValue({ userId: null, sessionClaims: null });

    const res = await GET(new Request('http://localhost/api/organizer/payments'));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({
      success: false,
      error: 'Unauthorized',
    });
    expect(h.listAdminPayments).not.toHaveBeenCalled();
  });

  it('returns 403 when requester role is not organizer/admin', async () => {
    h.auth.mockResolvedValue({
      userId: 'user_1',
      sessionClaims: {
        publicMetadata: { role: 'user' },
      },
    });

    const res = await GET(new Request('http://localhost/api/organizer/payments'));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json).toEqual({
      success: false,
      error: 'Forbidden',
    });
    expect(h.listAdminPayments).not.toHaveBeenCalled();
  });

  it('forces ownerClerkId to requesterId even when query attempts widening', async () => {
    h.auth.mockResolvedValue({
      userId: 'org_123',
      sessionClaims: {
        publicMetadata: { role: 'organizer' },
      },
    });
    h.listAdminPayments.mockResolvedValue({
      data: [],
      hasMore: false,
      availableCurrencies: ['usd'],
      filter: {
        search: null,
        paymentStatus: 'all',
        currency: null,
        refundState: 'all',
        payoutTarget: 'all',
        limit: 40,
      },
    });

    const res = await GET(
      new Request(
        'http://localhost/api/organizer/payments?ownerClerkId=org_other&limit=50&paymentStatus=succeeded'
      )
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(h.listAdminPayments).toHaveBeenCalledWith({
      limit: 50,
      search: null,
      paymentStatus: 'succeeded',
      currency: null,
      refundState: 'all',
      payoutTarget: 'all',
      ownerClerkId: 'org_123',
    });
    expect(json.success).toBe(true);
  });
});
