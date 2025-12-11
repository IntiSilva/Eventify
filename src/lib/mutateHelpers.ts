import type { Key, MutatorCallback, MutatorOptions } from 'swr';
import { swrKeys } from '@/lib/swrKeys';
import type { EventWithCreatorAndRsvps } from '@/types/event';
import type { ReminderPatch } from '@/types/rsvp';
import type { PaginatedApiResponse } from '@/types/api';

type EventsListCache<T> = PaginatedApiResponse<T>;

/* --------------------------------------------------------------------- *
 *  GlobalMutate type                                                    *
 * --------------------------------------------------------------------- */
export type GlobalMutate = <Data>(
  key: Key | ((key: Key) => boolean),
  data?:
    | Data
    | Promise<Data>
    | ((currentData: Data | undefined) => Data | Promise<Data>),
  opts?: boolean | { revalidate?: boolean }
) => Promise<Data | undefined>;

/* --------------------------------------------------------------------- *
 *  Key matchers                                                         *
 * --------------------------------------------------------------------- */
const isHomeCarouselKey = (key: Key) =>
  typeof key === 'string' &&
  (key === swrKeys.events('?dateGroup=upcoming') ||
   key === swrKeys.events('?dateGroup=featured'));

const isMainListKey   = (key: Key) => typeof key === 'string' && key.startsWith('/api/events?');
const isOrganizerKey  = (key: Key) => typeof key === 'string' && key.startsWith('/api/organizer/events');
const isAdminKey      = (key: Key) => typeof key === 'string' && key.startsWith('/api/admin/events');
const isAgendaUpcomingKey = (key: Key) => typeof key === 'string' && key.startsWith('/api/agenda/upcoming-events');

const matchAnyList = (key: Key) =>
  isHomeCarouselKey(key) || isMainListKey(key) || isOrganizerKey(key) || isAdminKey(key) || isAgendaUpcomingKey(key);

/* --------------------------------------------------------------------- *
 *  patchEventEverywhere (full entity)                                   *
 * --------------------------------------------------------------------- */
export const patchEventEverywhere = (
  mutate: GlobalMutate,
  updated: EventWithCreatorAndRsvps
) =>
  mutate<EventsListCache<EventWithCreatorAndRsvps> | undefined>(
    matchAnyList,
    (cached) => {
      if (!cached || !('data' in cached) || !Array.isArray(cached.data)) return cached;

      return {
        ...cached,
        data: cached.data.map((e) => (e.id === updated.id ? updated : e)),
      };
    },
    false
  );


/* --------------------------------------------------------------------- *
 *  patchEventEverywhereShallow (top-level fields only)                  *
 * --------------------------------------------------------------------- */
export const patchEventEverywhereShallow = <T extends { id: string }>(
  mutate: GlobalMutate,
  patch: Partial<T> & { id: string }
) =>
  mutate<EventsListCache<T> | undefined>(
    matchAnyList,
    (cached) => {
      if (!cached || !('data' in cached) || !Array.isArray(cached.data)) return cached;

      return {
        ...cached,
        data: cached.data.map((e) =>
          e.id === patch.id ? ({ ...e, ...patch } as T) : e
        ),
      };
    },
    false
  );


/* --------------------------------------------------------------------- *
 *  patchReminderEverywhere                                              *
 *                                                                       *
 *  • Accepts an eventId and a ReminderPatch                              *
 *  • Updates ONLY the reminder fields of the matching user RSVP          *
 *  • Leaves the rest of the entity untouched                             *
 * --------------------------------------------------------------------- */
export const patchReminderEverywhere = (
  mutate: GlobalMutate,
  eventId: string,
  reminder: ReminderPatch
) =>
  mutate<EventsListCache<EventWithCreatorAndRsvps> | undefined>(
    matchAnyList,
    (cached) => {
      if (!cached || !('data' in cached) || !Array.isArray(cached.data)) return cached;

      return {
        ...cached,
        data: cached.data.map((evt) => {
          if (evt.id !== eventId) return evt;

          return {
            ...evt,
            rsvps: evt.rsvps.map((r) =>
              r.user.clerkId === reminder.userClerkId
                ? {
                    ...r,
                    status: reminder.status ?? r.status,
                    reminderPreferenceType: reminder.reminderPreferenceType,
                    reminderOffsetMinutes:  reminder.reminderOffsetMinutes,
                    reminderScheduledAt:    reminder.reminderScheduledAt,
                    reminderSentAt:         reminder.reminderSentAt,
                  }
                : r
            ),
          };
        }),
      };
    },
    false
  );




export type AgendaListData = EventWithCreatorAndRsvps[];

/**
 * Removes an event by id from the /agenda list.
 * - Uses the current cache value if it exists; otherwise falls back to `current` (e.g., data)
 *   or to `initial` (SSR).
 * - Returns the result of mutate() so you can chain if needed.
 */
export function removeFromAgendaUpcomingList(
  mutate: (
    data?:
      | AgendaListData
      | Promise<AgendaListData>
      | MutatorCallback<AgendaListData>,
    opts?: MutatorOptions<AgendaListData>
  ) => Promise<AgendaListData | undefined>,
  id: string,
  opts?: { current?: AgendaListData; initial?: EventWithCreatorAndRsvps[] }
) {
  const updater: MutatorCallback<AgendaListData> = (curr) => {
    const source = curr ?? opts?.current ?? opts?.initial ?? [];
    return source.filter((e) => e.id !== id);
  };

  return mutate(updater, { revalidate: false, populateCache: true });
}

/* --------------------------------------------------------------------- *
 *  revalidate helpers                                                    *
 * --------------------------------------------------------------------- */
export const revalidateEventLists = (mutate: GlobalMutate) =>
  mutate(matchAnyList);


// Updates ONLY the user's RSVP reminder fields in the /agenda list.
// Supports array or { events } shape
export function patchReminderInAgendaUpcomingList(
  mutate: (
    data?:
      | AgendaListData
      | Promise<AgendaListData>
      | MutatorCallback<AgendaListData>,
    opts?: MutatorOptions<AgendaListData>
  ) => Promise<AgendaListData | undefined>,
  eventId: string,
  userClerkId: string,
  reminder: ReminderPatch,
  opts?: { current?: AgendaListData; initial?: EventWithCreatorAndRsvps[] }
) {
  const updater: MutatorCallback<AgendaListData> = (curr) => {
    const source = curr ?? opts?.current ?? opts?.initial ?? [];

    const nextArr = source.map((e) => {
      if (e.id !== eventId) return e;

      const r0 = e.rsvps?.[0];
      if (!r0 || r0.user.clerkId !== userClerkId) return e;

      const nextRsvp = {
        ...r0,
        // same semantics you had before:
        status:
          'status' in reminder ? (reminder.status ?? r0.status) : r0.status,
        reminderPreferenceType:
          'reminderPreferenceType' in reminder
            ? reminder.reminderPreferenceType
            : r0.reminderPreferenceType,
        reminderOffsetMinutes:
          'reminderOffsetMinutes' in reminder
            ? reminder.reminderOffsetMinutes
            : r0.reminderOffsetMinutes,
        reminderScheduledAt:
          'reminderScheduledAt' in reminder
            ? reminder.reminderScheduledAt
            : r0.reminderScheduledAt,
        reminderSentAt:
          'reminderSentAt' in reminder
            ? reminder.reminderSentAt
            : r0.reminderSentAt,
      };

      return { ...e, rsvps: [nextRsvp] };
    });

    return nextArr;
  };

  return mutate(updater, { revalidate: false, populateCache: true });
}

