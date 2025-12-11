import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import { normalizeStringForSearch, normalizeUsername } from '@/lib/utils';
import { SUGGESTION_LIMIT } from '@/lib/constants';
import { auth } from '@clerk/nextjs/server';
import type { ApiErrorResponse, SearchSuggestionsResponse } from '@/types/api';

type Field = 'title' | 'location' | 'creator';
type Scope = 'global' | 'organizer' | 'admin' | 'agenda';

function isValidField(v: string | null): v is Field {
  return v === 'title' || v === 'location' || v === 'creator';
}

function buildScopedEventWhere(
  scope: Scope,
  clerkId?: string,
  adminUserId?: string
): Prisma.EventWhereInput {
  if (scope === 'organizer') {
    return clerkId ? { createdBy: clerkId } : {};
  }
  if (scope === 'admin') {
    return adminUserId ? { createdBy: adminUserId } : {};
  }
  if (scope === 'agenda') {
    return clerkId
      ? { rsvps: { some: { userId: clerkId, status: 'confirmed' } } }
      : {};
  }
  return {};
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const field = url.searchParams.get('field');
    const query = (url.searchParams.get('query') || '').trim();
    const scope = (url.searchParams.get('scope') || 'global') as Scope;
    const adminUserId = url.searchParams.get('userId') || undefined;

    if (!isValidField(field)) {
      const body: ApiErrorResponse = {
        success: false,
        error: 'Invalid "field" param',
      };
      return NextResponse.json(body, { status: 400 });
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

    const { userId: clerkId } = await auth();
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
