import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getPopularEventsByOrganizer } from '@/lib/data';
import { ORGANIZER_POPULAR_EVENTS_LIMIT } from '@/lib/constants';
import type { OrganizerPopularEventsResponse, ApiErrorResponse } from '@/types/api';

// Endpoint to fetch an organizer's most popular events.
export async function GET() {
  try {
    // 1. Protect the route, ensuring the user is authenticated.
    const { userId, sessionClaims } = await auth();
    if (!userId) {
      const body: ApiErrorResponse = {
        success: false,
        error: 'Unauthorized',
      };
      return NextResponse.json(body, { status: 401 });
    }

    /* 2️.  Verify role */
    const role = sessionClaims?.publicMetadata?.role;
    if (role !== 'organizer' && role !== 'admin') {
      const body: ApiErrorResponse = {
        success: false,
        error: 'Forbidden',
      };
      return NextResponse.json(body, { status: 403 });
    }

    // 3. Call our data function specific to popular events.
    const popularEvents = await getPopularEventsByOrganizer(userId, ORGANIZER_POPULAR_EVENTS_LIMIT);

    const body: OrganizerPopularEventsResponse = {
      success: true,
      data: popularEvents,
    };

    return NextResponse.json(body);

  } catch (error) {
      console.error('[API /organizer/events/popular] Error fetching events:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred';

      const body: ApiErrorResponse = {
        success: false,
        error: `Failed to fetch popular events: ${errorMessage}`,
      };

      return NextResponse.json(body, { status: 500 });
    }
}
