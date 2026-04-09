import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { RSVPStatus } from "@/generated/prisma";
import { getEventWithRsvps, getEventsWithDetails } from "@/lib/data";
import type { EventByIdResponse, ApiErrorResponse } from "@/types/api";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      const body: ApiErrorResponse = {
        success: false,
        error: "Unauthorized",
      };
      return NextResponse.json(body, { status: 401 });
    }

    const { id } = await params;

    if (!id) {
      const body: ApiErrorResponse = {
        success: false,
        error: "Missing event id",
      };
      return NextResponse.json(body, { status: 400 });
    }

    const url = new URL(req.url);
    const rawStatus = url.searchParams.get("rsvpStatus");
    if (
      rawStatus !== null &&
      rawStatus !== RSVPStatus.confirmed &&
      rawStatus !== RSVPStatus.pending &&
      rawStatus !== RSVPStatus.canceled
    ) {
      const body: ApiErrorResponse = {
        success: false,
        error: "Invalid rsvpStatus",
      };
      return NextResponse.json(body, { status: 400 });
    }

    const status: RSVPStatus =
      rawStatus === null ? RSVPStatus.confirmed : rawStatus;

    if (status === RSVPStatus.confirmed) {
      const events = await getEventsWithDetails({
        where: { id },
        take: 1,
      });

      const event = events[0];
      if (!event) {
        const body: ApiErrorResponse = {
          success: false,
          error: "Not found",
        };
        return NextResponse.json(body, { status: 404 });
      }

      const body: EventByIdResponse = {
        success: true,
        data: event,
      };
      return NextResponse.json(body);
    }

    const full = await getEventWithRsvps(id);
    if (!full) {
      const body: ApiErrorResponse = {
        success: false,
        error: "Not found",
      };
      return NextResponse.json(body, { status: 404 });
    }

    const data = { ...full, rsvps: full.rsvps.filter((r) => r.status === status) };

    const body: EventByIdResponse = {
      success: true,
      data,
    };

    return NextResponse.json(body);
  } catch (error) {
    console.error("[API /events/[id]] Error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";

    const body: ApiErrorResponse = {
      success: false,
      error: `Failed to fetch event: ${msg}`,
    };

    return NextResponse.json(body, { status: 500 });
  }
}
