// src/test/msw/handlers.ts
import { http, HttpResponse } from 'msw';

import type { EventWithCreatorAndRsvps } from '@/types/event';
import type {
  PaginatedApiResponse,
  SearchSuggestionsResponse,
  AgendaUpcomingEventsResponse,
} from '@/types/api';

type EventStub = {
  id: string;
  title: string;
  date?: string;
  location?: string;
  category?: string;
};

const ALL_EVENTS: EventStub[] = Array.from({ length: 15 }, (_, i) => ({
  id: `event-${i + 1}`,
  title: `Sample Event ${i + 1}`,
  location: i % 2 ? 'Buenos Aires' : 'Online',
  category: i % 3 ? 'music' : 'tech',
}));

export const handlers = [
  /* ------------------------------------------------------------------ */
  /*  /api/search-suggestions                                           */
  /*  ApiResponse<string[]>                                             */
  /* ------------------------------------------------------------------ */
  http.get('/api/search-suggestions', ({ request }) => {
    const url = new URL(request.url);
    const q = (url.searchParams.get('query') || '').toLowerCase();
    const pool = ['Rock Fest', 'Maratón BA', 'NodeConf', 'Art Basel', 'Film Night'];
    const out =
      q.length < 2 ? [] : pool.filter((s) => s.toLowerCase().includes(q)).slice(0, 8);

    const body = {
      success: true,
      data: out,
    } satisfies SearchSuggestionsResponse;

    return HttpResponse.json(body);
  }),

  /* ------------------------------------------------------------------ */
  /*  /api/events                                                       */
  /*  PaginatedApiResponse<EventWithCreatorAndRsvps>                    */
  /* ------------------------------------------------------------------*/

  // /api/events -> PaginatedApiResponse<EventWithCreatorAndRsvps>
  http.get('/api/events', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const limit = Number(url.searchParams.get('limit') ?? '6');
    const excludeRaw = url.searchParams.get('exclude') ?? '';
    const exclude = excludeRaw ? excludeRaw.split(',') : [];

    const filtered = ALL_EVENTS.filter((e) => !exclude.includes(e.id));
    const start = (page - 1) * limit;

    // mantenemos el stub liviano, pero casteamos para que el envelope quede tipado
    const data = filtered.slice(start, start + limit) as unknown as EventWithCreatorAndRsvps[];

    const metadata = {
      totalEvents: filtered.length,
      currentPage: page,
      eventsPerPage: limit,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
    };

    const body = {
      success: true,
      data,
      metadata,
    } satisfies PaginatedApiResponse<EventWithCreatorAndRsvps>;

    return HttpResponse.json(body);
  }),


    /* ------------------------------------------------------------------ */
  /*  /api/agenda/upcoming-events                                       */
  /*  Shape: ApiResponse<EventWithCreatorAndRsvps[]>                    */
  /* ------------------------------------------------------------------ */

  http.get('/api/agenda/upcoming-events', () => {
    const body = {
      success: true,
      data: [] as EventWithCreatorAndRsvps[],
    } satisfies AgendaUpcomingEventsResponse;

    return HttpResponse.json(body);
  }),
];
