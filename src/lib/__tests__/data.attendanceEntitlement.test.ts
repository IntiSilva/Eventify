import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  eventFindManyMock: vi.fn(),
  rsvpCountMock: vi.fn(),
  cookiesMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    event: {
      findMany: h.eventFindManyMock,
    },
    rSVP: {
      count: h.rsvpCountMock,
    },
  },
}));

vi.mock('next/headers', () => ({
  cookies: h.cookiesMock,
}));

import {
  getUserUpcomingEvents,
  getUserUpcomingRsvpCount,
} from '@/lib/data';

describe('agenda read model entitlement filters', () => {
  beforeEach(() => {
    h.eventFindManyMock.mockReset();
    h.rsvpCountMock.mockReset();
    h.cookiesMock.mockReset();
    h.cookiesMock.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });
  });

  it('getUserUpcomingEvents requires confirmed + active entitlement', async () => {
    h.eventFindManyMock.mockResolvedValueOnce([]);

    await getUserUpcomingEvents('user_1');

    const args = h.eventFindManyMock.mock.calls[0]?.[0];
    expect(args).toMatchObject({
      where: {
        archivedAt: null,
        date: { gte: expect.any(Date) },
        rsvps: {
          some: {
            userId: 'user_1',
            status: 'confirmed',
            attendanceEntitlementStatus: 'active',
          },
        },
      },
      include: {
        rsvps: {
          where: {
            userId: 'user_1',
            status: 'confirmed',
            attendanceEntitlementStatus: 'active',
          },
        },
      },
    });
  });

  it('getUserUpcomingRsvpCount counts only confirmed + active entitlement rows', async () => {
    h.rsvpCountMock.mockResolvedValueOnce(3);

    const count = await getUserUpcomingRsvpCount('user_2');

    expect(count).toBe(3);
    expect(h.rsvpCountMock).toHaveBeenCalledWith({
      where: {
        userId: 'user_2',
        status: 'confirmed',
        attendanceEntitlementStatus: 'active',
        event: {
          archivedAt: null,
          date: { gte: expect.any(Date) },
        },
      },
    });
  });
});
