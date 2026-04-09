import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { EventCategory, Prisma } from '@/generated/prisma';
import { startOfDay, startOfMonth, addDays, addMonths, endOfMonth } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { CURRENTLY_ATTENDING_RSVP_WHERE } from '@/lib/rsvpAttendance';
import { normalizeStringForSearch, normalizeUsername, parseYyyyMmDdToKey, yyyymmddKey } from '@/lib/utils';
import { PAGE_SIZE_MAIN } from '@/lib/constants';
import type { PaginatedApiResponse, ApiErrorResponse } from '@/types/api';
import type { EventWithCreatorAndRsvps } from '@/types/event';

/* ------------------------------------------------------------------ */
/* Helpers — kept minimal               */
/* ------------------------------------------------------------------ */

function safeString(value: string | null): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function safeBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  const v = value.toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

type EventPaidFilterParam = 'all' | 'paid' | 'free';

function safePaidFilter(value: string | null): EventPaidFilterParam {
  if (!value) return 'all';
  const v = value.toLowerCase();
  if (v === 'paid') return 'paid';
  if (v === 'free') return 'free';
  return 'all';
}

function isValidEventCategory(categoryString: string | undefined): categoryString is EventCategory {
  if (!categoryString) return false;
  return (Object.values(EventCategory) as string[]).includes(categoryString);
}

// Parse comma-separated string into a string[]
function csv(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* GET /api/events                                                    */
/* ------------------------------------------------------------------ */

export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      const body: ApiErrorResponse = {
        success: false,
        error: 'Unauthorized',
      };
      return NextResponse.json(body, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    console.log('[API - /api/events] Request URL:', request.url); // LOG A

    /* -------------------- Read & validate params -------------------- */
    const categoryString = safeString(searchParams.get('category'));
    const categoryParam: EventCategory | undefined =
      isValidEventCategory(categoryString) ? categoryString : undefined;

    const locationParam  = safeString(searchParams.get('location'));
    const creatorParam   = safeString(searchParams.get('creator'));
    const dateParam      = safeString(searchParams.get('date'));      // "YYYY-MM-DD"
    const viewTzParam    = safeString(searchParams.get('viewTz'));    // IANA TZ (optional)
    const paidParam      = safePaidFilter(searchParams.get('paid'));

    // Accept both `search` and `searchTerm` for compatibility
    const searchTitleParam =
      safeString(searchParams.get('search')) ??
      safeString(searchParams.get('searchTerm'));

    const featuredParam  = safeBoolean(searchParams.get('featured'));
    const dateGroupParam = safeString(searchParams.get('dateGroup')); // "upcoming" | "thisMonth" | "later"

    // Accept both `excludeIds` (new) and `exclude` (current client) — minimal change
    const excludeCsv = searchParams.get('excludeIds') ?? searchParams.get('exclude');
    const excludeIdsParam = csv(excludeCsv);

    console.log('[API - /api/events] Parsed Params:', {
      searchTitleParam,
      categoryString,
      featuredParam,
      dateGroupParam,
      paidParam,
      viewTzParam,
      excludeIdsParam,
    });

    // Pagination (kept as-is)
    const pageRaw  = parseInt(searchParams.get('page')  || '1', 10);
    const limitRaw = parseInt(searchParams.get('limit') || String(PAGE_SIZE_MAIN), 10);
    const page  = Number.isFinite(pageRaw)  && pageRaw  > 0 ? pageRaw  : 1;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : PAGE_SIZE_MAIN;
    const skip  = (page - 1) * limit;

    // Invalid category -> 400
    if (categoryString && !categoryParam) {
      console.warn(`[API_EVENTS_GET] Invalid category value received: ${categoryString}`);

      const body: ApiErrorResponse = {
        success: false,
        error: `Invalid category: ${categoryString}`,
      };

      return NextResponse.json(body, { status: 400 });
    }

    /* -------------------- Build Prisma where clause -------------------- */
    const whereClause: Prisma.EventWhereInput = {
      archivedAt: null,
    };

    // DATE FILTER:
    // - If client passes `date=YYYY-MM-DD`:
    //    A) with `viewTz` -> interpret as viewer-local day using UTC window via fromZonedTime
    //    B) without `viewTz` -> match event-local denormalized key
    // - If no `date` and no `dateGroup`:
    //    Align with SSR behavior:
    //      * with `viewTz` -> eventLocalDateKey >= yyyymmddKey(viewer-local now)
    //      * without `viewTz` -> date >= startOfDay(server now)
    if (dateParam) {
      if (viewTzParam) {
        const [y, m, d] = dateParam.split('-').map(Number);
        if (!y || !m || !d) {
          const body: ApiErrorResponse = {
            success: false,
            error: 'Invalid date format. Expected YYYY-MM-DD.',
          };
          return NextResponse.json(body, { status: 400 });
        }
        const startWall = new Date(y, m - 1, d, 0, 0, 0, 0);
        const endWall   = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
        try {
          const startUtc = fromZonedTime(startWall, viewTzParam);
          const endUtc   = fromZonedTime(endWall, viewTzParam);
          whereClause.date = { gte: startUtc, lt: endUtc };
          console.log('[api/events] viewer day mode', { dateParam, viewTzParam, startUtc, endUtc });
        } catch {
          const body: ApiErrorResponse = {
            success: false,
            error: 'Invalid viewTz or date.',
          };
          return NextResponse.json(body, { status: 400 });
        }
      } else {
        try {
          whereClause.eventLocalDateKey = parseYyyyMmDdToKey(dateParam);
          console.log('[api/events] event-local day mode', {
            dateParam,
            eventLocalDateKey: whereClause.eventLocalDateKey,
          });
        } catch {
          const body: ApiErrorResponse = {
            success: false,
            error: 'Invalid date format. Expected YYYY-MM-DD.',
          };
          return NextResponse.json(body, { status: 400 });
        }
      }
    } else {
      if (!dateGroupParam) {
        if (viewTzParam) {
          // align with SSR default when viewTz is present
          const nowLocal = toZonedTime(new Date(), viewTzParam);
          whereClause.eventLocalDateKey = { gte: yyyymmddKey(nowLocal) };
        } else {
          // server fallback (historic behavior)
          whereClause.date = { gte: startOfDay(new Date()) };
        }
      }
    }

    // Category exact match (keep your enum)
    if (categoryParam) {
      whereClause.category = categoryParam;
    }

    // Title (normalized)
    if (searchTitleParam) {
      whereClause.normalizedTitle = {
        contains: normalizeStringForSearch(searchTitleParam),
      };
    }

    // Location (normalized)
    if (locationParam) {
      whereClause.normalizedLocation = {
        contains: normalizeStringForSearch(locationParam),
      };
    }

    // Creator (related user by normalizedUsername)
    if (creatorParam) {
      whereClause.creator = {
        is: {
          normalizedUsername: {
            contains: normalizeUsername(creatorParam),
          },
        },
      };
    }

    if (paidParam === 'paid') {
      whereClause.isPaid = true;
    } else if (paidParam === 'free') {
      whereClause.isPaid = false;
    }

    console.log('API Params Received: ', {
      searchTerm: searchParams.get('searchTerm'),
      category:   searchParams.get('category'),
    });
    console.log('API Prisma WhereClause (pre-feature/dateGroup): ', JSON.stringify(whereClause, null, 2));

    // dateGroup windows (only if no explicit `date`)
    const now = new Date();
    const todayStart = startOfDay(now);

    if (!dateParam && dateGroupParam) {
      if (dateGroupParam === 'upcoming') {
        whereClause.date = { gte: todayStart, lt: startOfDay(addDays(todayStart, 7)) };
      } else if (dateGroupParam === 'thisMonth') {
        whereClause.date = { gte: todayStart, lte: endOfMonth(now) };
      } else if (dateGroupParam === 'later') {
        whereClause.date = { gte: startOfDay(addMonths(startOfMonth(now), 1)) };
      }
    }

    // Featured filter
    if (featuredParam !== undefined) {
      if (featuredParam) {
        whereClause.OR = [{ featured: true }, { featuredByAdmin: true }];
      } else {
        whereClause.featured = false;
        whereClause.featuredByAdmin = false;
      }
    }

    // NEW: exclude ids (accept both `excludeIds` and `exclude` from the QS)
    if (excludeIdsParam.length > 0) {
      whereClause.id = { notIn: excludeIdsParam };
    }

    console.log('[API - /api/events] Prisma WhereClause (final):', JSON.stringify(whereClause, null, 2)); // LOG C
    console.log('[API] QS', Object.fromEntries(searchParams.entries()));

    /* -------------------- Ordering (stable) -------------------- */
    // Add `id: asc` as a tie-breaker to avoid “page drift” when many events share the same date
    const orderBy: Prisma.EventOrderByWithRelationInput[] =
      dateParam
        ? (viewTzParam
            ? [{ date: 'asc' }, { id: 'asc' }]
            : [{ eventLocalMinuteOfDay: 'asc' }, { date: 'asc' }, { id: 'asc' }])
        : [{ date: 'asc' }, { id: 'asc' }];

    console.log('[API] orderBy', orderBy);

    /* -------------------- Query -------------------- */
    const events = await prisma.event.findMany({
      where: whereClause,
      orderBy,
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
          where: { ...CURRENTLY_ATTENDING_RSVP_WHERE },
          select: {
            status: true,
            attendanceEntitlementStatus: true,
            reminderScheduledAt: true,
            reminderPreferenceType: true,
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
          orderBy: { createdAt: 'asc' },
        },
      },
      skip,
      take: limit,
    });

    console.log(`[API - /api/events] Found ${events.length} events for query.`);
    const totalEvents = await prisma.event.count({ where: whereClause });
    const totalPages  = Math.max(1, Math.ceil(totalEvents / limit));

    console.log('[API] ids', events.map(e => e.id));
    console.log('[API] meta', { totalEvents, totalPages, page, limit, skip });

    const body: PaginatedApiResponse<EventWithCreatorAndRsvps> = {
      success: true,
      data: events as unknown as EventWithCreatorAndRsvps[],
      metadata: {
        totalEvents,
        totalPages,
        currentPage: page,
        eventsPerPage: limit,
      },
    };

    return NextResponse.json(body);

  } catch (error) {
    console.error('[API_EVENTS_GET] Error fetching events:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch events.';
    const body: ApiErrorResponse = {
      success: false,
      error: errorMessage,
    };

    return NextResponse.json(body, { status: 500 });
  }
}
