import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getEventsByOrganizer } from '@/lib/data';
import type { OrganizerEventsResponse, ApiErrorResponse } from '@/types/api';

export async function GET(request: Request) {
  try {
    // 1. Protect the route: make sure the user is authenticated
    const { userId, sessionClaims } = await auth();
    if (!userId) {
      const body: ApiErrorResponse = {
        success: false,
        error: 'Unauthorized',
      };
      return NextResponse.json(body, { status: 401 });
    }

    /* Verify role */
    const role = sessionClaims?.publicMetadata?.role;
    if (role !== 'organizer' && role !== 'admin') {
      const body: ApiErrorResponse = {
        success: false,
        error: 'Forbidden',
      };
      return NextResponse.json(body, { status: 403 });
    }

    // 2. Extract the searchParams from the request URL
    const { searchParams } = new URL(request.url);

    // Convert searchParams into a simple object our function understands
    const filters = Object.fromEntries(searchParams.entries());

    // 3. Call our data function that handles all the logic
    const result = await getEventsByOrganizer(userId, filters);

    // 4. Return the result as JSON (standard envelope)
    const body: OrganizerEventsResponse = {
      success: true,
      ...result, // { data, metadata }
    };

    return NextResponse.json(body);

  } catch (error) {
      console.error('[API /organizer/events] Error fetching events:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred';

      const body: ApiErrorResponse = {
        success: false,
        error: `Failed to fetch organizer events: ${errorMessage}`,
      };

      return NextResponse.json(body, { status: 500 });
    }
}
