 import { buildEventsQS } from "@/lib/utils";
 import type { SearchbarFilters } from "@/components/Searchbar/Searchbar";

export const swrKeys = {
  /* Home */
  events:     (qs = '')      => `/api/events${qs}`,
  byEventId:  (id: string)   => `/api/events/${id}`,

  /** Agenda — upcoming list ordered by Event.date ASC (UTC) */
  agenda: {
    /**
     * We include `viewTz` in the key so the client keeps separate caches
     * when the viewer's timezone changes (rehydration pattern like Home).
     */
    upcoming: (viewTz?: string) =>
      `/api/agenda/upcoming-events${viewTz ? `?viewTz=${encodeURIComponent(viewTz)}` : ""}`,
  },

  /* Viewer payments */
  payments: {
    myTickets: () => '/api/payments/my-tickets',
  },

  /* Organizer (always the current user) */
  organizer: {
    list:     ()             => '/api/organizer/events',
    popular:  ()             => '/api/organizer/events/popular',
    monthly:  ()             => '/api/organizer/events/monthly',
    byId:     (id: string)   => `/api/organizer/events/${id}`,
  },

  /* Admin — requires [userId] */
  admin: {
    list:     (userId: string)          => `/api/admin/events/${userId}`,
    byId:     (userId: string, id: string) =>
                 `/api/admin/events/${userId}/${id}`,
  },
};

/* ---------- Helpers for /api/events --------------- */
export type EventsFilters = SearchbarFilters;

type PaginationInput = {
  page:   number;
  limit:  number;
  filters: EventsFilters;
  viewTz?: string;
  excludeIds?: string[];
};

/**
 * Returns **only the paginated query string**:
 *   "?page=2&limit=8&search=foo&viewTz=America/…"
 *
 * The component will then pass it to `swrKeys.events(qs)`,
 * which already prefixes “/api/events”.
 */
export function buildPaginatedEventsURL({
  page,
  limit,
  filters,
  viewTz,
  excludeIds = [],
}: PaginationInput) {
  // Pass viewTz to buildEventsQS
  const qs = new URLSearchParams(buildEventsQS(filters, viewTz));

  qs.set("page",  String(page));
  qs.set("limit", String(limit));

  if (excludeIds.length) {
    // compact format: "id1,id2,id3"
    qs.set("exclude", excludeIds.join(","));
  }
  return `?${qs.toString()}`;
}

// Logical key for the search bucket in the context (without page)
export function buildSearchKey(filters: SearchbarFilters, viewTz?: string) {
  const qs = new URLSearchParams();
  qs.set('search',   filters.search   ?? '');
  qs.set('category', filters.category ?? '');
  qs.set('location', filters.location ?? '');
  qs.set('creator',  filters.creator  ?? '');
  qs.set('date',     filters.date     ?? '');
  qs.set('paid',     filters.paid     ?? 'all');
  if (viewTz) qs.set('viewTz', viewTz); // affects results, must be in the key
  return qs.toString(); // e.g. "search=&category=&...&date=2025-08-23&viewTz=America/…"
}
