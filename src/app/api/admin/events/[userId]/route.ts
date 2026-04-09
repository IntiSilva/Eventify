import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getEventsByOrganizer } from '@/lib/data';
import type { AdminEventsResponse, ApiErrorResponse } from '@/types/api';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: requesterId, sessionClaims } = await auth();

    if (!requesterId) {
      const payload = {
        success: false,
        error: 'Unauthorized',
      } satisfies ApiErrorResponse;

      return NextResponse.json(payload, { status: 401 });
    }

    if (sessionClaims?.publicMetadata?.role !== 'admin') {
      console.warn(
        `[API /admin/events] Unauthorized access tried by user: ${sessionClaims?.sub}`
      );

      const payload = {
        success: false,
        error: 'Forbidden',
      } satisfies ApiErrorResponse;

      return NextResponse.json(payload, { status: 403 });
    }

    const { userId } = await params;
    const url = new URL(request.url);
    const filters = Object.fromEntries(url.searchParams.entries());

    //Strip out context from the response, as the value "hasAnyEventsEver" it's not needed in the panel for each organizer inside the admin page
    const { data, metadata } = await getEventsByOrganizer(userId, filters);

    const payload = {
      success: true,
      data,
      metadata,
    } satisfies AdminEventsResponse;

    return NextResponse.json(payload);
  } catch (error) {
    console.error('[API /admin/events] Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';

    const payload = {
      success: false,
      error: `Failed to fetch events: ${msg}`,
    } satisfies ApiErrorResponse;

    return NextResponse.json(payload, { status: 500 });
  }
}
