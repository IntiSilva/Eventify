import { NextResponse } from "next/server";
import { RSVPStatus } from "@/generated/prisma";
import { getEventWithRsvps, getEventsWithDetails } from "@/lib/data";
import type { EventByIdResponse, ApiErrorResponse } from "@/types/api";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      const body: ApiErrorResponse = {
        success: false,
        error: "Missing event id",
      };
      return NextResponse.json(body, { status: 400 });
    }

    const url = new URL(req.url);
    const rawStatus = url.searchParams.get("rsvpStatus") ?? undefined;

    const status: RSVPStatus | undefined =
      rawStatus === RSVPStatus.confirmed ||
      rawStatus === RSVPStatus.pending ||
      rawStatus === RSVPStatus.canceled
        ? rawStatus
        : undefined;

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

    const data =
      status
        ? { ...full, rsvps: full.rsvps.filter((r) => r.status === status) }
        : full;

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