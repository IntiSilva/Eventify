// src/types/api.ts
import type { EditableEvent, EventWithCreatorAndRsvps } from "@/types/event";

/* =============================================================================
 * Shared API envelopes
 * =============================================================================
 *
 * Most API routes in this project follow a consistent envelope:
 *   - success: true  + data (payload)
 *   - success: false + error (message)
 *
 * NOTE:
 * Some tiny, internal "viewer cache" endpoints intentionally DO NOT use this
 * envelope (they return a raw primitive or entity). Examples:
 *   - GET /api/viewer/phone  -> string | null
 *   - GET /api/viewer/user   -> UserProfileForAvatar | null
 *
 * These are only used for client-side cache warming/priming (Navbar hover,
 * MenuContext, etc.), so keeping them raw avoids unnecessary unwrapping and
 * extra refactors in hot paths.
 */

export type ApiErrorResponse = {
  success: false;
  error: string;
};

export type ApiSuccessResponse<TData> = {
  success: true;
  data: TData;
};

export type ApiResponse<TData> = ApiSuccessResponse<TData> | ApiErrorResponse;

/**
 * Detects the standard error envelope:
 *   { success:false, error:string }
 */
export function isApiErrorResponse(v: unknown): v is ApiErrorResponse {
  if (typeof v !== "object" || v === null) return false;

  if (!("success" in v) || !("error" in v)) return false;

  const successValue = (v as { success?: unknown }).success;
  const errorValue = (v as { error?: unknown }).error;

  return successValue === false && typeof errorValue === "string";
}

/* =============================================================================
 * Standard pagination for event lists
 * ============================================================================= */

export type PaginatedMetadata = {
  totalEvents: number;
  totalPages: number;
  currentPage: number;
  eventsPerPage: number;
};

/**
 * Flat success shape for paginated endpoints:
 *   { success:true, data:TItem[], metadata:PaginatedMetadata }
 */
export type PaginatedSuccess<TItem> = {
  success: true;
  data: TItem[];
  metadata: PaginatedMetadata;
};

export type PaginatedApiResponse<TItem> =
  | PaginatedSuccess<TItem>
  | ApiErrorResponse;

/* =============================================================================
 * Events endpoints
 * ============================================================================= */

// GET /api/events/[id]
export type EventByIdResponse = ApiResponse<EventWithCreatorAndRsvps>;

// POST /api/events/bulk
export type EventsBulkResponse = ApiResponse<EventWithCreatorAndRsvps[]>;

// GET /api/events/confirmed-count
export type EventsConfirmedCountData = Record<string, number>;
export type EventsConfirmedCountResponse =
  ApiResponse<EventsConfirmedCountData>;

/* =============================================================================
 * Organizer endpoints
 * ============================================================================= */

// GET /api/organizer/events
export type OrganizerEventsResponse = PaginatedApiResponse<EditableEvent>;

// GET /api/organizer/monthly
export type OrganizerMonthlyEventsResponse = ApiResponse<EditableEvent[]>;

// GET /api/organizer/popular
export type OrganizerPopularEventData = EditableEvent & {
  _count: {
    rsvps: number; // Number of confirmed RSVPs (Prisma include brings _count)
  };
};

export type OrganizerPopularEventsResponse =
  ApiResponse<OrganizerPopularEventData[]>;

/* =============================================================================
 * Admin endpoints
 * ============================================================================= */

// GET /api/admin/events/[userId]
export type AdminEventsResponse = PaginatedApiResponse<EditableEvent>;

/* =============================================================================
 * Agenda endpoints
 * ============================================================================= */

// GET /api/agenda/upcoming-events
export type AgendaUpcomingEventsResponse =
  ApiResponse<EventWithCreatorAndRsvps[]>;

/* =============================================================================
 * Search suggestions endpoints
 * ============================================================================= */

// GET /api/search-suggestions?field=...&query=...
export type SearchSuggestionsResponse = ApiResponse<string[]>;

/* =============================================================================
 * Cron endpoints
 * ============================================================================= */

// GET /api/cron/send-reminders
export type CronSendRemindersSuccess = {
  success: true;
  sentCount: number; // 0 is valid as well
  message: string;   // Always present for cron/debug logs
};

export type CronSendRemindersResponse =
  | CronSendRemindersSuccess
  | ApiErrorResponse;

/* =============================================================================
 * Username availability endpoint
 * ============================================================================= */

export type UsernameAvailabilityData = {
  available: boolean;
  /**
   * Only present when available === false because of validation.
   * Either "invalid" or the message returned by validateUsername().
   */
  reason?: string;
};

// GET /api/username-availability
export type UsernameAvailabilityResponse =
  ApiResponse<UsernameAvailabilityData>;
