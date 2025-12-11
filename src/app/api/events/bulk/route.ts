import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { RSVPStatus } from "@/generated/prisma";
import { getEventsWithDetails } from "@/lib/data";
import type { ApiErrorResponse, EventsBulkResponse } from "@/types/api";

type Body = {
  ids: string[];
  rsvpStatus?: RSVPStatus; // 'confirmed' | 'pending' | 'canceled'
};

export async function POST(req: Request) {
  try {
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      const errBody: ApiErrorResponse = {
        success: false,
        error: "Invalid JSON",
      };
      return NextResponse.json(errBody, { status: 400 });
    }

    const rawIds = Array.isArray(body.ids) ? body.ids : [];
    const ids = [
      ...new Set(
        rawIds.filter(
          (s): s is string => typeof s === "string" && s.trim().length > 0
        )
      ),
    ];

    // rsvpStatus comes from JSON => validate it
    const rawStatus = body.rsvpStatus;
    const status =
      rawStatus === RSVPStatus.confirmed ||
      rawStatus === RSVPStatus.pending ||
      rawStatus === RSVPStatus.canceled
        ? rawStatus
        : undefined;

    if (ids.length === 0) {
      const okBody: EventsBulkResponse = {
        success: true,
        data: [],
      };
      return NextResponse.json(okBody, { status: 200 });
    }

    // Case 1: confirmed → reuse getEventsWithDetails (already filters in DB)
    if (status === RSVPStatus.confirmed) {
      const events = await getEventsWithDetails({
        where: { id: { in: ids } },
        orderBy: { date: "asc" },
        take: ids.length,
      });

      const okBody: EventsBulkResponse = {
        success: true,
        data: events,
      };
      return NextResponse.json(okBody, { status: 200 });
    }

    // Case 2: other statuses or no status → fetch full and filter (or not) in the same query
    const events = await prisma.event.findMany({
      where: { id: { in: ids } },
      include: {
        creator: {
          select: {
            clerkId: true,
            username: true,
            firstName: true,
            lastName: true,
            imageUrl: true,
            hasImage: true,
            role: true,
          },
        },
        rsvps: {
          // if another status comes in (pending/canceled), filter here; otherwise, fetch all
          where: status ? { status } : undefined,
          select: {
            id: true,
            createdAt: true,
            updatedAt: true,
            userId: true,
            eventId: true,
            status: true,
            reminderPreferenceType: true,
            reminderOffsetMinutes: true,
            reminderScheduledAt: true,
            reminderSentAt: true,
            user: {
              select: {
                clerkId: true,
                username: true,
                firstName: true,
                lastName: true,
                imageUrl: true,
                hasImage: true,
                role: true,
              },
            },
          },
        },
      },
    });

    const okBody: EventsBulkResponse = {
      success: true,
      data: events,
    };
    return NextResponse.json(okBody, { status: 200 });
  } catch (error) {
    console.error("[API /events/bulk] Error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";

    const errBody: ApiErrorResponse = {
      success: false,
      error: `Failed to fetch events: ${msg}`,
    };
    return NextResponse.json(errBody, { status: 500 });
  }
}
