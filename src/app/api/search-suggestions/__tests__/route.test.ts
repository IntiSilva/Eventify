import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../route';
import { normalizeStringForSearch, normalizeUsername } from '@/lib/utils';
import { SUGGESTION_LIMIT } from '@/lib/constants';
import type { SearchSuggestionsResponse } from '@/types/api';

const { mockAuth, eventFindMany, userFindMany } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  eventFindMany: vi.fn(),
  userFindMany: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: mockAuth }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    event: { findMany: eventFindMany },
    user: { findMany: userFindMany },
  },
}));

const buildRequest = (params: Record<string, string | undefined>) => {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && sp.set(k, v));
  return new Request(`http://localhost/api/search-suggestions?${sp.toString()}`);
};

describe('GET /api/search-suggestions', () => {
  beforeEach(() => {
    mockAuth.mockReset();
    eventFindMany.mockReset();
    userFindMany.mockReset();
    mockAuth.mockResolvedValue({});
  });

  it('returns 400 when "field" is invalid', async () => {
    const req = buildRequest({ field: 'foo', query: 'ab' });
    const res = await GET(req);
    const body = await res.json() as SearchSuggestionsResponse;

    expect(res.status).toBe(400);
    expect(body).toEqual({ success: false, error: 'Invalid "field" param' });
    expect(eventFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('returns empty success when query length < 2 and does not hit DB', async () => {
    const req = buildRequest({ field: 'title', query: 'a' });
    const res = await GET(req);
    const body = await res.json() as SearchSuggestionsResponse;

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: [] });
    expect(eventFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('queries DB when query length is exactly 2', async () => {
    const q = 'ab';
    const normalized = normalizeStringForSearch(q);
    eventFindMany.mockResolvedValue([{ title: 'AB Show' }]);

    const req = buildRequest({ field: 'title', query: q, scope: 'global' });
    const res = await GET(req);
    const body = await res.json() as SearchSuggestionsResponse;

    expect(res.status).toBe(200);
    expect(eventFindMany).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        normalizedTitle: { contains: normalized },
      },
      distinct: ['title'],
      orderBy: { title: 'asc' },
      take: SUGGESTION_LIMIT,
      select: { title: true },
    });

    expect(body).toEqual({ success: true, data: ['AB Show'] });
  });

  it('queries creators globally requiring at least one created event', async () => {
    userFindMany.mockResolvedValue([{ username: 'john' }]);

    const req = buildRequest({ field: 'creator', query: 'Jo', scope: 'global' });
    const res = await GET(req);
    const body = await res.json() as SearchSuggestionsResponse;

    expect(res.status).toBe(200);
    expect(userFindMany).toHaveBeenCalledWith({
      where: {
        normalizedUsername: { contains: normalizeUsername('Jo') },
        createdEvents: { some: { archivedAt: null } },
      },
      orderBy: { username: 'asc' },
      take: SUGGESTION_LIMIT,
      select: { username: true },
    });

    expect(body).toEqual({ success: true, data: ['john'] });
  });

  it('returns 400 when "scope" is invalid and does not hit DB', async () => {
    const req = buildRequest({
      field: 'title',
      query: 'Expo',
      scope: 'invalid_scope',
    });
    const res = await GET(req);
    const body = await res.json() as SearchSuggestionsResponse;

    expect(res.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: 'Invalid "scope" param',
    });
    expect(eventFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('returns 403 when non-admin user requests scope=admin', async () => {
    mockAuth.mockResolvedValue({
      userId: 'user_1',
      sessionClaims: {
        publicMetadata: { role: 'organizer' },
      },
    });

    const req = buildRequest({
      field: 'title',
      query: 'Expo',
      scope: 'admin',
      userId: 'admin_target_1',
    });
    const res = await GET(req);
    const body = await res.json() as SearchSuggestionsResponse;

    expect(res.status).toBe(403);
    expect(body).toEqual({
      success: false,
      error: 'Forbidden',
    });
    expect(eventFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated user requests scope=organizer', async () => {
    mockAuth.mockResolvedValue({});

    const req = buildRequest({
      field: 'title',
      query: 'Expo',
      scope: 'organizer',
    });
    const res = await GET(req);
    const body = await res.json() as SearchSuggestionsResponse;

    expect(res.status).toBe(401);
    expect(body).toEqual({
      success: false,
      error: 'Unauthorized',
    });
    expect(eventFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated user requests scope=agenda', async () => {
    mockAuth.mockResolvedValue({});

    const req = buildRequest({
      field: 'title',
      query: 'Expo',
      scope: 'agenda',
    });
    const res = await GET(req);
    const body = await res.json() as SearchSuggestionsResponse;

    expect(res.status).toBe(401);
    expect(body).toEqual({
      success: false,
      error: 'Unauthorized',
    });
    expect(eventFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('applies admin scope by filtering events by provided userId', async () => {
    mockAuth.mockResolvedValue({
      userId: 'admin_1',
      sessionClaims: {
        publicMetadata: { role: 'admin' },
      },
    });
    const normalized = normalizeStringForSearch('Expo');
    eventFindMany.mockResolvedValue([{ title: 'Expo 2025' }]);

    const req = buildRequest({
      field: 'title',
      query: 'Expo',
      scope: 'admin',
      userId: 'admin_target_1',
    });
    const res = await GET(req);
    const body = await res.json() as SearchSuggestionsResponse;

    expect(res.status).toBe(200);
    expect(eventFindMany).toHaveBeenCalledWith({
      where: {
        createdBy: 'admin_target_1',
        archivedAt: null,
        normalizedTitle: { contains: normalized },
      },
      distinct: ['title'],
      orderBy: { title: 'asc' },
      take: SUGGESTION_LIMIT,
      select: { title: true },
    });

    expect(body).toEqual({ success: true, data: ['Expo 2025'] });
  });

  it('returns 400 when scope=admin is missing required userId param', async () => {
    mockAuth.mockResolvedValue({
      userId: 'admin_1',
      sessionClaims: {
        publicMetadata: { role: 'admin' },
      },
    });

    const req = buildRequest({
      field: 'title',
      query: 'Expo',
      scope: 'admin',
    });
    const res = await GET(req);
    const body = await res.json() as SearchSuggestionsResponse;

    expect(res.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: 'Missing "userId" param for admin scope',
    });
    expect(eventFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('applies agenda scope for title (confirmed RSVPs of the current user)', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_777' });

    const normalized = normalizeStringForSearch('Jazz');
    eventFindMany.mockResolvedValue([{ title: 'Jazz Night' }]);

    const req = buildRequest({
      field: 'title',
      query: 'Jazz',
      scope: 'agenda',
    });
    const res = await GET(req);
    const body = await res.json() as SearchSuggestionsResponse;

    expect(res.status).toBe(200);
    expect(eventFindMany).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        rsvps: {
          some: {
            userId: 'clerk_777',
            status: 'confirmed',
            attendanceEntitlementStatus: 'active',
          },
        },
        normalizedTitle: { contains: normalized },
      },
      distinct: ['title'],
      orderBy: { title: 'asc' },
      take: SUGGESTION_LIMIT,
      select: { title: true },
    });

    expect(body).toEqual({ success: true, data: ['Jazz Night'] });
  });

  it('applies agenda scope for creator via createdEvents.some RSVP constraint', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_888' });
    userFindMany.mockResolvedValue([{ username: 'mary' }]);

    const req = buildRequest({
      field: 'creator',
      query: 'Ma',
      scope: 'agenda',
    });
    const res = await GET(req);
    const body = await res.json() as SearchSuggestionsResponse;

    expect(res.status).toBe(200);
    expect(userFindMany).toHaveBeenCalledWith({
      where: {
        normalizedUsername: { contains: normalizeUsername('Ma') },
        createdEvents: {
          some: {
            archivedAt: null,
            rsvps: {
              some: {
                userId: 'clerk_888',
                status: 'confirmed',
                attendanceEntitlementStatus: 'active',
              },
            },
          },
        },
      },
      orderBy: { username: 'asc' },
      take: SUGGESTION_LIMIT,
      select: { username: true },
    });

    expect(body).toEqual({ success: true, data: ['mary'] });
  });

  it('returns 500 on Prisma error', async () => {
    const normalized = normalizeStringForSearch('Rock');
    eventFindMany.mockRejectedValue(new Error('DB down'));

    const req = buildRequest({ field: 'title', query: 'Rock', scope: 'global' });
    const res = await GET(req);
    const body = await res.json() as SearchSuggestionsResponse;

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Failed to fetch suggestions' });

    expect(eventFindMany).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        normalizedTitle: { contains: normalized },
      },
      distinct: ['title'],
      orderBy: { title: 'asc' },
      take: SUGGESTION_LIMIT,
      select: { title: true },
    });
  });
});
