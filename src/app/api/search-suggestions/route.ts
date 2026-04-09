import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import { CURRENTLY_ATTENDING_RSVP_WHERE } from '@/lib/rsvpAttendance';
import { normalizeStringForSearch, normalizeUsername } from '@/lib/utils';
import { SUGGESTION_LIMIT } from '@/lib/constants';
import { auth } from '@clerk/nextjs/server';
import type { ApiErrorResponse, SearchSuggestionsResponse } from '@/types/api';

type Field = 'title' | 'location' | 'creator';
type Scope = 'global' | 'organizer' | 'admin' | 'agenda';

function isValidField(v: string | null): v is Field {
  return v === 'title' || v === 'location' || v === 'creator';
}

function isValidScope(v: string | null): v is Scope {
  return v === 'global' || v === 'organizer' || v === 'admin' || v === 'agenda';
}

function buildScopedEventWhere(
  scope: Scope,
  clerkId?: string,
  adminUserId?: string
): Prisma.EventWhereInput {
  if (scope === 'organizer') {
    if (!clerkId) {
      throw new Error('Missing authenticated user for organizer scope');
    }
    return { createdBy: clerkId, archivedAt: null };
  }
  if (scope === 'admin') {
    if (!adminUserId) {
      throw new Error('Missing required userId for admin scope');
    }
    return { createdBy: adminUserId, archivedAt: null };
  }
  if (scope === 'agenda') {
    if (!clerkId) {
      throw new Error('Missing authenticated user for agenda scope');
    }
    return {
      archivedAt: null,
      rsvps: {
        some: {
          userId: clerkId,
          ...CURRENTLY_ATTENDING_RSVP_WHERE,
        },
      },
    };
  }
  return { archivedAt: null };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const field = url.searchParams.get('field');
    const query = (url.searchParams.get('query') || '').trim();
    const rawScope = url.searchParams.get('scope');

    if (rawScope !== null && !isValidScope(rawScope)) {
      const body: ApiErrorResponse = {
        success: false,
        error: 'Invalid "scope" param',
      };
      return NextResponse.json(body, { status: 400 });
    }

    const scope: Scope = rawScope ?? 'global';
    const adminUserId = url.searchParams.get('userId')?.trim() || undefined;
    const { userId: clerkId, sessionClaims } = await auth();
    const requesterRole = sessionClaims?.publicMetadata?.role;

    if (!isValidField(field)) {
      const body: ApiErrorResponse = {
        success: false,
        error: 'Invalid "field" param',
      };
      return NextResponse.json(body, { status: 400 });
    }

    if ((scope === 'organizer' || scope === 'agenda') && !clerkId) {
      const body: ApiErrorResponse = {
        success: false,
        error: 'Unauthorized',
      };
      return NextResponse.json(body, { status: 401 });
    }

    if (scope === 'admin') {
      if (!clerkId) {
        const body: ApiErrorResponse = {
          success: false,
          error: 'Unauthorized',
        };
        return NextResponse.json(body, { status: 401 });
      }

      if (requesterRole !== 'admin') {
        const body: ApiErrorResponse = {
          success: false,
          error: 'Forbidden',
        };
        return NextResponse.json(body, { status: 403 });
      }

      if (!adminUserId) {
        const body: ApiErrorResponse = {
          success: false,
          error: 'Missing "userId" param for admin scope',
        };
        return NextResponse.json(body, { status: 400 });
      }
    }

    // Less than 2 chars => return an empty success (not an error)
    if (query.length < 2) {
      const body: SearchSuggestionsResponse = {
        success: true,
        data: [],
      };
      return NextResponse.json(body);
    }

    const qSearch = normalizeStringForSearch(query);
    const qUser = normalizeUsername(query);

    const eventWhere = buildScopedEventWhere(
      scope,
      clerkId ?? undefined,
      adminUserId ?? undefined
    );

    if (field === 'title') {
      const rows = await prisma.event.findMany({
        where: { ...eventWhere, normalizedTitle: { contains: qSearch } },
        distinct: ['title'],
        orderBy: { title: 'asc' },
        take: SUGGESTION_LIMIT,
        select: { title: true },
      });

      const body: SearchSuggestionsResponse = {
        success: true,
        data: rows.map((r) => r.title),
      };
      return NextResponse.json(body);
    }

    if (field === 'location') {
      const rows = await prisma.event.findMany({
        where: { ...eventWhere, normalizedLocation: { contains: qSearch } },
        distinct: ['location'],
        orderBy: { location: 'asc' },
        take: SUGGESTION_LIMIT,
        select: { location: true },
      });

      const body: SearchSuggestionsResponse = {
        success: true,
        data: rows.map((r) => r.location),
      };
      return NextResponse.json(body);
    }

    // field === 'creator'
    const users = await prisma.user.findMany({
      where: {
        normalizedUsername: { contains: qUser },
        createdEvents: { some: { ...eventWhere } },
      },
      orderBy: { username: 'asc' },
      take: SUGGESTION_LIMIT,
      select: { username: true },
    });

    const body: SearchSuggestionsResponse = {
      success: true,
      data: users.map((u) => u.username),
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error('[api/search-suggestions] GET error:', err);

    const body: ApiErrorResponse = {
      success: false,
      error: 'Failed to fetch suggestions',
    };
    return NextResponse.json(body, { status: 500 });
  }
}
