import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserUpcomingEvents } from "@/lib/data";
import type {
  AgendaUpcomingEventsResponse,
  ApiErrorResponse,
} from "@/types/api";

/**
 * GET /api/agenda/upcoming-events
 *
 * Returns the current user's upcoming events ordered by Event.date ASC.
 * - Auth required (Clerk).
 * - Optional pagination: ?take=number&skip=number
 * - Optional ?viewTz=... is accepted for cache-key symmetry, but ignored in server logic.
 *
 * Success:
 *   { success:true, data: EventWithCreatorAndRsvps[] }
 * Error:
 *   { success:false, error:string }
 */
export async function GET(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      const body: ApiErrorResponse = {
        success: false,
        error: "Unauthorized",
      };
      return NextResponse.json(body, { status: 401 });
    }

    const url = new URL(req.url);
    const takeParam = url.searchParams.get("take");
    const skipParam = url.searchParams.get("skip");
    // viewTz intentionally ignored (formatting is client-side)
    // Keeping it here allows the client to include it in the SWR key without breaking the route.
    // const viewTz = url.searchParams.get("viewTz");

    const take = takeParam
      ? Math.max(0, Number(takeParam)) || undefined
      : undefined;
    const skip = skipParam
      ? Math.max(0, Number(skipParam)) || undefined
      : undefined;

    const { events } = await getUserUpcomingEvents(userId, {
      take,
      skip,
      readViewerTzCookie: false,
    });

    const body: AgendaUpcomingEventsResponse = {
      success: true,
      data: events,
    };

    return NextResponse.json(body);
  } catch (error) {
    console.error("[API /agenda/upcoming-events] Error fetching events:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";

    const body: ApiErrorResponse = {
      success: false,
      error: `Failed to load upcoming events: ${msg}`,
    };

    return NextResponse.json(body, { status: 500 });
  }
}
