import { prisma } from "@/lib/prisma"
import { cookies } from "next/headers"
import { addDays, startOfDay, startOfMonth, endOfMonth } from "date-fns"
import { toZonedTime } from "date-fns-tz"
import type { RolesForEvents, EventWithCreatorAndRsvps } from "@/types/event"
import { EventCategory, RSVPStatus, Prisma } from "@/generated/prisma"
import { getSingleSearchParam, normalizeStringForSearch, parseYyyyMmDdToKey, yyyymmddKey, canonicalizeTimeZone, isValidIanaTimeZone  } from "./utils"
import { deleteExpiredEvents } from "./cleanup"
import { FEATURED_LIMIT, PAGE_SIZE_MAIN } from "./constants"


// Safe TZ from cookie (or undefined if invalid)
async function getViewerTzFromCookie(): Promise<string | undefined> {
  const cookieStore = await cookies(); // Next 15: async
  const tzRaw = cookieStore.get('viewerTz')?.value;
  if (!tzRaw) return undefined;
  const canon = canonicalizeTimeZone(tzRaw);
  return isValidIanaTimeZone(canon) ? canon : undefined;
}

/** "Today" in the viewer's wall clock (if TZ is provided) or UTC (fallback) */
function computeTodayKeyOrUtc(whereTz?: string): {
  todayKey?: number;   // to compare against eventLocalDateKey
  nowUtc: Date;
  wallNow?: Date;      // in case other wall-clock derived values are needed
} {
  const nowUtc = new Date();
  if (whereTz) {
    const wallNow = toZonedTime(nowUtc, whereTz);
    const todayKey = yyyymmddKey(wallNow);
    return { todayKey, nowUtc, wallNow };
  }
  return { nowUtc };
}



export async function getEventsByOrganizer(
  clerkId: string,
  searchParams: { [key: string]: string | string[] | undefined }
) {
  if (!clerkId) throw new Error("No organizer ID was provided");

  await deleteExpiredEvents();

  /* ---------- 1) Pagination & basic filters ---------- */
  const page   = parseInt(getSingleSearchParam(searchParams.page)  || "1",  10);
  const limit  = parseInt(getSingleSearchParam(searchParams.limit) || "8",  10);
  const skip   = (page - 1) * limit;

  const searchTerm = getSingleSearchParam(searchParams.search);
  const location   = getSingleSearchParam(searchParams.location);
  const category   = getSingleSearchParam(searchParams.category) as EventCategory | undefined;
  const dateStr    = getSingleSearchParam(searchParams.date);   // 'YYYY-MM-DD' or undefined

  /* ---------- 2) WHERE clause ---------- */
  const whereClause: Prisma.EventWhereInput = {
    createdBy: clerkId,
  };

  if (searchTerm) {
    whereClause.normalizedTitle = {
      contains: normalizeStringForSearch(searchTerm),
    };
  }

  if (location) {
    whereClause.normalizedLocation = {
      contains: normalizeStringForSearch(location),
    };
  }

  if (category) {
    whereClause.category = category;
  }

  if (dateStr) {
    // Event's local day → denormalized key
    try {
      whereClause.eventLocalDateKey = parseYyyyMmDdToKey(dateStr);
    } catch {
      throw new Error("Invalid date format; expected YYYY-MM-DD");
    }
  } else {
    // default: only future events
    whereClause.date = { gte: new Date() };
  }

  /* ---------- 3) ORDER ---------- */
  const orderBy: Prisma.EventOrderByWithRelationInput[] = dateStr
    ? [{ eventLocalMinuteOfDay: "asc" }, { date: "asc" }]
    : [{ date: "asc" }];

  /* ---------- 4) DB queries ---------- */
  const [events, totalEvents] = await Promise.all([
    prisma.event.findMany({
      where: whereClause,
      orderBy,
      skip,
      take: limit,
    }),
    prisma.event.count({ where: whereClause }),
  ]);

  /* ---------- 5) Response shape ---------- */
  return {
    data: events,
    metadata: {
      totalEvents,
      currentPage   : page,
      eventsPerPage : limit,
      totalPages    : Math.ceil(totalEvents / limit),
    },
  };
}


export async function getUsersWithEvents() {

  await deleteExpiredEvents();
  
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { role: 'organizer' },
        { role: 'admin' },
      ],
    },
    select: {
      clerkId: true,
      username: true,
      firstName: true,
      lastName: true,
      imageUrl: true,
      hasImage: true,
      role: true,
      // Instead of fetching all events, we only count how many there are.
      _count: {
        select: {
          createdEvents: {
            where: {
              date: { gte: new Date() }, // We can keep filters in the count
            },
          }
        }
      }
    }
  });

  return users
      //Filter by the events count
    .filter((user) => user._count.createdEvents > 0)
    .map((user) => ({
      ...user,
      role: user.role as RolesForEvents,
    }));
}


/**
 * Fetches the most popular future events for a specific organizer.
 * Popularity is determined by the number of confirmed RSVPs.
 * @param clerkId The ID of the event organizer.
 * @param limit The maximum number of events to return.
 * @returns A promise that resolves to an array of popular events.
 */
export async function getPopularEventsByOrganizer(
  clerkId: string,
  limit: number = 24
) {
  if (!clerkId) throw new Error("No organizer ID was provided");
  if (limit <= 0) return [];

    //After this we don't need to filter by futures
   await deleteExpiredEvents();


  const events = await prisma.event.findMany({
    where: {
      createdBy: clerkId,
      rsvps: { some: { status: RSVPStatus.confirmed } }, // ≥1 confirmado
    },
    include: {
      _count: {
        select: {
          rsvps: { where: { status: RSVPStatus.confirmed } },
        },
      },
    },
    orderBy: [
      { rsvps: { _count: "desc" } },              // popular (total RSVPs)
      { date: "asc" },                            // stable tie-breaker
    ],
    take: limit,
  });

  return events;
}

/**
 * Fetches upcoming events for a specific organizer within the current month.
 * @param clerkId The ID of the event organizer.
 * @param limit The maximum number of events to return.
 * @returns A promise that resolves to an array of ALL events scheduled for this month.
 */
export async function getMonthlyEventsByOrganizer(
  clerkId: string,
) {
  if (!clerkId) throw new Error("No organizer ID was provided");

  await deleteExpiredEvents();

  const now = new Date();

  // First and last local key for the month (YYYYMMDD)
  const monthStartKey = yyyymmddKey(startOfMonth(now));
  const monthEndKey   = yyyymmddKey(endOfMonth(now));

  // If today falls within the month, we don't want past events ⇒ minKey = today
  const todayKey = yyyymmddKey(now);
  const minKey   = Math.max(monthStartKey, todayKey);

  const events = await prisma.event.findMany({
    where: {
      createdBy: clerkId,
      eventLocalDateKey: { gte: minKey, lte: monthEndKey },
    },
    orderBy: [
      { eventLocalDateKey: "asc" },
      { eventLocalMinuteOfDay: "asc" },
    ],
  });

  return events;
}



export async function getEventAttendees(eventId: string) {
    if(!eventId) throw new Error('Event ID is required to fetch attendees')
    await deleteExpiredEvents();
    return await prisma.rSVP.findMany({
        where: {eventId},
        select: {
            id: true,
            status: true,
            user: {
                select: {
                    username: true,
                    firstName: true,
                    lastName: true,
                    imageUrl: true,
                    hasImage: true,
                    clerkId: true,
                },
            },
        },
        orderBy: {createdAt: 'desc'}
    });
    
}

/**
 * Reusable function to fetch events with common includes (creator, RSVPs).
 * Ensures RSVPs are filtered by 'confirmed' status.
 * @param queryOptions Prisma.EventFindManyArgs for custom where, orderBy, take, skip.
 * @returns Promise<EventWithCreatorAndRsvps[]>
 */

export async function getEventsWithDetails(
  args: Omit<Prisma.EventFindManyArgs, 'include' | 'select'>
): Promise<EventWithCreatorAndRsvps[]> {
  const events = await prisma.event.findMany({
    ...args,
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
        where: { status: RSVPStatus.confirmed },
        select: {
          id: true,
          createdAt: true,
          userId: true,
          eventId: true,
          status: true,
          updatedAt: true,
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

  return events as EventWithCreatorAndRsvps[];
}


export async function getEventWithRsvps(eventId: string): Promise<EventWithCreatorAndRsvps | null> {
  return prisma.event.findUnique({
    where: { id: eventId },
    include: {
      creator: true,
      rsvps: { include: { user: true } },
    },
  });
}


/**
 * Fetch: upcoming events for a given user.
 * - Filters out past events using UTC `now`.
 * - Orders by the real instant (Event.date ASC) so the list matches the user's agenda regardless of TZ display.
 * - Includes only the current user's RSVP inside `event.rsvps` (compact payload with reminder fields).
 * - Optionally reads the viewer TZ cookie and echoes it back (to mirror Home SSR + rehydration pattern).
 *
 * Notes:
 * - We do NOT call deleteExpiredEvents() here to keep reads cheap; we already clean on key actions/cron.
 * - Return raw dates (ISO). Format in the component layer (viewer TZ vs event TZ).
 */
export async function getUserUpcomingEvents(
  userClerkId: string,
  opts?: {
    /** Optional: limit results for SSR payloads */
    take?: number;
    /** Optional: offset/pagination */
    skip?: number;
    /**
     * If true, read the `viewerTz` cookie here and return it as `viewerTzFromCookie`
     * (useful to follow your Home SSR + rehydration pattern).
     */
    readViewerTzCookie?: boolean;
  }
): Promise<{
  events: EventWithCreatorAndRsvps[];
  viewerTzFromCookie?: string;
}> {
  const now = new Date();

   let viewerTzFromCookie: string | undefined;
    if (opts?.readViewerTzCookie) {
      viewerTzFromCookie = await getViewerTzFromCookie();
    }

  const events = await prisma.event.findMany({
    where: {
      date: { gte: now }, // future-only (UTC)
      rsvps: {
        some: {
          userId: userClerkId,
          status: 'confirmed', // pending→confirmed is immediate today; explicit for clarity
        },
      },
    },
    orderBy: [
      { date: 'asc' }, // primary: actual time (stable across TZ views)
      { id: 'asc' },   // deterministic tie-breaker
    ],
    take: opts?.take,
    skip: opts?.skip,
    include: {
      // Minimal creator payload (avatar data)
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
      // Include ONLY the current user's RSVP (contains reminder fields we need)
      rsvps: {
        where: { userId: userClerkId },
        select: {
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

  return { events: events as EventWithCreatorAndRsvps[], viewerTzFromCookie };
}


// Lightweight count of user's upcoming confirmed RSVPs
export async function getUserUpcomingRsvpCount(userClerkId: string) {
  return prisma.rSVP.count({
    where: {
      userId: userClerkId,
      status: RSVPStatus.confirmed,
      event: { date: { gte: new Date() } },
    },
  });
}


/**
 * Defines the shape of the data returned for the Home Page.
 */
export interface HomePageData {
  isSearchMode: boolean;
  currentSearchTerm?: string;
  currentCategory?: EventCategory;
  currentLocation?: string;
  currentCreator?: string;
  currentDate?: string;
  upcomingEvents: EventWithCreatorAndRsvps[];
  featuredEvents: EventWithCreatorAndRsvps[];
  initialMainListPayload: {
    data: EventWithCreatorAndRsvps[];
    metadata: {
      totalEvents: number;
      currentPage: number;
      eventsPerPage: number;
      totalPages: number;
    };
     excludeFromMainListIds: string[];
  };
}



/**
 * Fetch everything the Home page needs.
 * Hybrid strategy:
 *  - HOME (no filters): SSR seed for the main list (page=1) + SSR carousels.
 *  - SEARCH (any filter present): no SSR list (empty seed) — the client will
 *    fetch via /api/events using the viewer's TZ from the client context.
 *  @param resolvedSearchParams The resolved searchParams object from the page.
 *  @returns Promise<HomePageData>
 */
export async function getHomePageData(
  resolvedSearchParams: { [key: string]: string | string[] | undefined }
): Promise<HomePageData> {
  await deleteExpiredEvents();

  console.log("[SERVER - getHomePageData] ResolvedSearchParams:", resolvedSearchParams); // LOG 1

   const viewerTzForCarousels = await getViewerTzFromCookie();
   const { wallNow, nowUtc } = computeTodayKeyOrUtc(viewerTzForCarousels);
   const today = startOfDay(wallNow ?? nowUtc);

  // -----------------------------
  // Parse URL params (server-side)
  // -----------------------------
  const currentSearchTerm     = getSingleSearchParam(resolvedSearchParams.search);
  const currentCategoryString = getSingleSearchParam(resolvedSearchParams.category);
  const currentCategory       = currentCategoryString as EventCategory | undefined;
  const currentLocation       = getSingleSearchParam(resolvedSearchParams.location);
  const currentCreator        = getSingleSearchParam(resolvedSearchParams.creator);
  const currentDate           = getSingleSearchParam(resolvedSearchParams.date);

  // Viewer TZ: from canonic cookie
  const viewTz = await getViewerTzFromCookie();

  console.log("[SERVER - getHomePageData] Parsed Filters:", {
    currentSearchTerm, currentCategory, currentLocation, currentCreator, currentDate
  }); // LOG 2

  // Search mode = any filter present (search/category/location/creator/date)
  const isSearchMode =
    !!currentSearchTerm || !!currentCategory || !!currentLocation || !!currentCreator || !!currentDate;

  // -----------------------------
  // Carousels are only fetched in HOME (no filters)
  // -----------------------------
  let upcomingEvents: EventWithCreatorAndRsvps[] = [];
  let featuredEvents: EventWithCreatorAndRsvps[] = [];
  let uniqueCarouselEventIds: string[] = [];

  if (!isSearchMode) {
    upcomingEvents = await getEventsWithDetails({
      where: { date: { gte: today, lt: startOfDay(addDays(today, 7)) } }, // next 7 days
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });

    featuredEvents = await getEventsWithDetails({
      where: { date: { gte: today }, OR: [{ featured: true }, { featuredByAdmin: true }] },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: FEATURED_LIMIT,
    });

    const upcomingIds = upcomingEvents.map(e => e.id);
    uniqueCarouselEventIds = [...new Set(upcomingIds)];
  }

  // ======================================================
  // Main list seed:
  //   HOME (no filters): SSR page=1 seed (respects viewer TZ via cookie)
  //   SEARCH (filters):  empty seed — client will fetch with TZ
  // ======================================================
  let initialMainListPayload: {
    data: EventWithCreatorAndRsvps[];
    metadata: {
      totalEvents: number;
      currentPage: number;
      eventsPerPage: number;
      totalPages: number;
    };
    excludeFromMainListIds: string[];
  };

  console.log("[SERVER - getHomePageData] isSearchMode:", isSearchMode, "currentDate:", currentDate, "viewTz:", viewTz);

  if (!isSearchMode) {
    // -----------------------------
    // HOME (no filters): SSR seed
    // -----------------------------
    const mainListWhereClause: Prisma.EventWhereInput = {};

    // Date window for the SSR seed:
    // - If a date sneaks in (shouldn't happen in HOME), use eventLocalDateKey for robustness.
    // - Otherwise, show future events:
    //    * with viewer TZ cookie → compare against the visitor's local yyyymmdd key
    //    * without TZ → compare against server UTC start-of-day
    if (currentDate) {
      mainListWhereClause.eventLocalDateKey = parseYyyyMmDdToKey(currentDate);
    } else {
      const base = viewTz ? toZonedTime(new Date(), viewTz) : new Date();
      if (viewTz) {
        mainListWhereClause.eventLocalDateKey = { gte: yyyymmddKey(base) };
      } else {
        mainListWhereClause.date = { gte: startOfDay(base) };
      }
    }

    // Avoid duplicating only with "upcoming" items
    if (uniqueCarouselEventIds.length > 0) {
      mainListWhereClause.id = { notIn: uniqueCarouselEventIds };
    }

    console.log("[SERVER - getHomePageData] Main List Prisma WhereClause:", JSON.stringify(mainListWhereClause, null, 2)); // LOG 3

    // Stable ordering (tie-break by id)
    const orderBy: Prisma.EventOrderByWithRelationInput[] = [{ date: "asc" }, { id: "asc" }];

    // Fetch SSR page 1
    const mainListEvents = await getEventsWithDetails({
      where: mainListWhereClause,
      orderBy,
      take: PAGE_SIZE_MAIN,
    });

    console.log(`[SERVER - getHomePageData] Found ${mainListEvents.length} initial main list events.`); // LOG 4

    const totalMainListEvents = await prisma.event.count({ where: mainListWhereClause });

    initialMainListPayload = {
      data: mainListEvents,
      metadata: {
        totalEvents: totalMainListEvents,
        currentPage: 1,
        eventsPerPage: PAGE_SIZE_MAIN,
        totalPages: Math.ceil(totalMainListEvents / PAGE_SIZE_MAIN),
      },
      excludeFromMainListIds: uniqueCarouselEventIds,
    };

    console.log("[SERVER - getHomePageData] excludeFromMainListIds:", initialMainListPayload.excludeFromMainListIds);
    console.log("[SERVER - getHomePageData] SSR main list payload built (HOME mode).");
  } else {
    // -----------------------------
    // SEARCH (filters present): API-first
    // -----------------------------
    // Do not SSR the list to avoid TZ drift and re-render flashes.
    // The client (HomeMainEventList) will fetch /api/events with viewer TZ from context.
    initialMainListPayload = {
      data: [],
      metadata: {
        totalEvents: 0,
        currentPage: 1,
        eventsPerPage: PAGE_SIZE_MAIN,
        totalPages: 1,
      },
      // In search mode we typically don't SSR carousels; passing [] is fine.
      excludeFromMainListIds: [],
    };

    console.log("[SERVER - getHomePageData] SEARCH MODE → skipping SSR main list (API-first).");
    console.log("[SERVER - getHomePageData] excludeFromMainListIds:", initialMainListPayload.excludeFromMainListIds);
  }

  // Final payload returned to the client wrapper.
  // We still return the parsed filters so SearchResultsTitle can render immediately on SSR.
  return {
    isSearchMode,
    currentSearchTerm,
    currentCategory,
    currentLocation,
    currentCreator,
    currentDate,
    upcomingEvents,
    featuredEvents,
    initialMainListPayload,
  };
}