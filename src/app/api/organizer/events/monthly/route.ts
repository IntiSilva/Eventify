import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getMonthlyEventsByOrganizer } from '@/lib/data';
import type { OrganizerMonthlyEventsResponse, ApiErrorResponse } from '@/types/api';

// Endpoint to get an organizer's events for the current month.
export async function GET() {
  try {
    // 1. Protect the route by ensuring the user is authenticated.
    const { userId, sessionClaims } = await auth();
    if (!userId) {
      const body: ApiErrorResponse = {
        success: false,
        error: 'Unauthorized',
      };
      return NextResponse.json(body, { status: 401 });
    }


    // 2. Verify role
    const role = sessionClaims?.publicMetadata?.role;
    if (role !== 'organizer' && role !== 'admin') {
      const body: ApiErrorResponse = {
        success: false,
        error: 'Forbidden',
      };
      return NextResponse.json(body, { status: 403 });
    }

    // 3. Call our data function to fetch this month's events.
    //    We fetch up to 10 events.
    const monthlyEvents = await getMonthlyEventsByOrganizer(userId);
    const body: OrganizerMonthlyEventsResponse = {
      success: true,
      data: monthlyEvents,
    };
    return NextResponse.json(body);

  } catch (error) {
      console.error('[API /organizer/events/monthly] Error fetching events:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred';

      const body: ApiErrorResponse = {
        success: false,
        error: `Failed to fetch monthly events: ${errorMessage}`,
      };

      return NextResponse.json(body, { status: 500 });
    }
}
