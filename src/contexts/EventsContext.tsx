'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';

import { RSVPStatus, UserRole, ReminderType } from '@/generated/prisma';
import type { EventWithCreatorAndRsvps, EditableEvent } from '@/types/event';
import type { EventsBulkResponse } from '@/types/api';
import { computeEventLocalKeys, DEFAULT_EVENT_TZ } from '@/lib/utils';
import { toggleRSVP } from '@/app/(dashboard)/rsvp/actions';
import { headTail, diffShallow } from '@/lib/debug';

/* ---------------------------------------------------------------------- */
/*  Debug toggle + helpers                                                */
/* ---------------------------------------------------------------------- */
const DEBUG_EVENTS = process.env.NEXT_PUBLIC_DEBUG_EVENTS === '1';

function logTableDiff(prev: unknown, next: unknown) {
  if (!DEBUG_EVENTS) return;
  const d = diffShallow(prev, next);
  if (Object.keys(d).length) console.table(d);
}



/* ---------------------------------------------------------------------- */
/*  LRU / TTL config for search buckets                                   */
/*  - Keeps recent searches/page caches bounded and fresh                  */
/* ---------------------------------------------------------------------- */
const MAX_SEARCH_KEYS   = 5;                 // max distinct search keys to keep
const MAX_PAGES_PER_KEY = 12;                 // per-key page cache cap (LRU)
const SEARCH_TTL_MS     = 10 * 60 * 1000;    // drop key if idle for 10 min

/* ---------------------------------------------------------------------- */
/*  Types & state shape                                                   */
/* ---------------------------------------------------------------------- */
type RsvpItem = EventWithCreatorAndRsvps['rsvps'][number];
type RsvpUser = EventWithCreatorAndRsvps['rsvps'][number]['user'];
type EventPartial = { id: string } & Partial<
  Omit<EventWithCreatorAndRsvps, 'rsvps' | 'creator'>
>;

type SearchBucket = {
  pages: Record<number, string[]>; // page -> event ids
  pageOrder: number[];             // LRU order (most recent first)
  meta?: {
    totalEvents: number;
    totalPages: number;
    currentPage: number;
    eventsPerPage: number;
  };
  lastAccess: number;              // used for TTL eviction
};

type EventsState = {
  // Normalized "full" events store (creator + rsvps when loaded)
  entities: Record<string, EventWithCreatorAndRsvps>;
  lists: {
    featured: string[];                            // ids currently shown in Featured carousels
    upcoming: string[];                            // (optional) another curated list
    search: Record<string, SearchBucket>;          // searchKey -> bucket
    searchKeyOrder: string[];                      // LRU of search keys
  };
};

const initialState: EventsState = {
  entities: {},
  lists: {
    featured: [],
    upcoming: [],
    search: {},
    searchKeyOrder: [],
  },
};

/* ---------------------------------------------------------------------- */
/*  Actions                                                               */
/* ---------------------------------------------------------------------- */
type Action =
  | { type: 'UPSERT_EVENTS'; events: EventWithCreatorAndRsvps[] }
  | { type: 'PATCH_EVENTS_PARTIAL'; patches: EventPartial[] }
  | { type: 'SET_LIST'; name: 'featured' | 'upcoming'; ids: string[] }
  | { type: 'ADD_TO_LIST'; name: 'featured' | 'upcoming'; id: string }
  | { type: 'REMOVE_FROM_LIST'; name: 'featured' | 'upcoming'; id: string }
  | { type: 'SET_SEARCH_PAGE'; key: string; page: number; ids: string[]; meta: SearchBucket['meta'] }
  | { type: 'TOUCH_SEARCH_KEY'; key: string; now: number }
  | { type: 'EVICT_STALE_KEYS'; now: number }
  | { type: 'TRIM_SEARCH_PAGES'; key: string; maxPages: number }
  | { type: 'APPLY_RSVP_OPT'; eventId: string; user: RsvpUser; attending: boolean }
  | { type: 'COMMIT_NEW_RSVP'; eventId: string; rsvp: RsvpItem }
  | { type: 'COMMIT_CANCEL_RSVP'; eventId: string; userId: string }
  | {
      type: 'COMMIT_UPDATE_REMINDER';
      eventId: string;
      userId: string;
      reminder: Pick<
        RsvpItem,
        'reminderPreferenceType' | 'reminderOffsetMinutes' | 'reminderScheduledAt' | 'reminderSentAt'
      >;
    }
  | { type: 'ROLLBACK_EVENT'; event: EventWithCreatorAndRsvps }
  | { type: 'INVALIDATE_SEARCH_PAGE'; key: string; page: number }
  | { type: 'REMOVE_EVENTS'; ids: string[] }
  | { type: 'REMOVE_IDS_FROM_SEARCH_PAGE'; key: string; page: number; removedIds: string[] };

/* ---------------------------------------------------------------------- */
/*  Pure reducer                                                          */
/* ---------------------------------------------------------------------- */
function reducer(state: EventsState, action: Action): EventsState {
  switch (action.type) {
    case 'UPSERT_EVENTS': {
      if (!action.events?.length) return state;
      if (DEBUG_EVENTS) {
        console.groupCollapsed('[CTX] UPSERT_EVENTS', {
          count: action.events.length,
          ids: action.events.map((e) => e.id),
        });
        try {
          for (const e of action.events) {
            const prev = state.entities[e.id];
            logTableDiff(prev, e);
          }
        } finally {
          console.groupEnd();
        }
      }
      const next = { ...state.entities };
      for (const e of action.events) next[e.id] = e;
      return { ...state, entities: next };
    }

    case 'PATCH_EVENTS_PARTIAL': {
       if (DEBUG_EVENTS) {
        console.groupCollapsed('[CTX] PATCH_EVENTS_PARTIAL', {
          count: action.patches.length,
          ids: action.patches.map((p) => p.id),
        });
        try {
          for (const p of action.patches) {
            if ('rsvps' in p || 'creator' in p) {
              console.warn('[CTX] partial includes rsvps/creator; ignoring those fields', p.id);
            }
            const prev = state.entities[p.id];
            const clean = Object.fromEntries(
              Object.entries(p).filter(([k, v]) => k !== 'rsvps' && k !== 'creator' && v !== undefined)
            );
            if (prev) {
              logTableDiff(prev, { ...prev, ...clean });
            } else {
              console.log('placeholder →', p.id, clean);
            }
          }
        } finally {
          console.groupEnd();
        }
      }
      const next = { ...state.entities };
      for (const p of action.patches) {
        const prev = next[p.id];
        if (!prev) {
          // Placeholder mínimo si aún no existe:
          next[p.id] = p as EventWithCreatorAndRsvps;
          continue;
        }
        // No sobreescribas rsvps/creator desde un parcial (y evitá undefined):
        const clean = Object.fromEntries(
          Object.entries(p).filter(([k, v]) => k !== 'rsvps' && k !== 'creator' && v !== undefined)
        );
        next[p.id] = { ...prev, ...clean };
      }
      return { ...state, entities: next };
    }

    case 'SET_LIST': {
      const cur = state.lists[action.name] ?? [];
      // Defensive deduplication in curated lists
      const next = Array.from(new Set((action.ids ?? []).filter(Boolean)));
      const sameOrder =
        cur.length === next.length &&
        cur.every((id, i) => id === next[i]);
      if (sameOrder) return state; // idempotent, avoids unnecessary renders
      return { ...state, lists: { ...state.lists, [action.name]: next } };
    }

    case 'ADD_TO_LIST': {
      const cur = state.lists[action.name] ?? [];
      if (cur.includes(action.id)) return state;
      return { ...state, lists: { ...state.lists, [action.name]: [...cur, action.id] } };
    }

    case 'REMOVE_FROM_LIST': {
      const cur = state.lists[action.name] ?? [];
      if (!cur.includes(action.id)) return state;
      return { ...state, lists: { ...state.lists, [action.name]: cur.filter(x => x !== action.id) } };
    }

    case 'SET_SEARCH_PAGE': {
      const now = Date.now();
      const prev = state.lists.search[action.key];
      const bucket: SearchBucket =
        prev ?? { pages: {}, pageOrder: [], meta: undefined, lastAccess: now };

      const pages = { ...bucket.pages, [action.page]: action.ids };
      const pageOrder = [action.page, ...bucket.pageOrder.filter(p => p !== action.page)];
      const meta = action.meta ?? bucket.meta;

      if (DEBUG_EVENTS) {
        console.groupCollapsed('[CTX] SET_SEARCH_PAGE');
        console.log({
          key: action.key,
          page: action.page,
          ids: headTail(action.ids),
          meta,
          beforeHas: { page: !!bucket.pages[action.page], keys: Object.keys(bucket.pages).length },
        });
        console.groupEnd();
      }

      const search = {
        ...state.lists.search,
        [action.key]: { pages, pageOrder, meta, lastAccess: now },
      };

      // Update LRU of search keys
      let keyOrder = [action.key, ...state.lists.searchKeyOrder.filter(k => k !== action.key)];

      // Enforce capacity: drop oldest keys
      if (keyOrder.length > MAX_SEARCH_KEYS) {
        const toEvict = keyOrder.slice(MAX_SEARCH_KEYS);
        for (const k of toEvict) delete search[k];
        keyOrder = keyOrder.slice(0, MAX_SEARCH_KEYS);
      }

      return { ...state, lists: { ...state.lists, search, searchKeyOrder: keyOrder } };
    }

    case 'TOUCH_SEARCH_KEY': {
      const bucket = state.lists.search[action.key];
      if (!bucket) return state;

      const search = {
        ...state.lists.search,
        [action.key]: { ...bucket, lastAccess: action.now },
      };

      const keyOrder = [action.key, ...state.lists.searchKeyOrder.filter(k => k !== action.key)];
      return { ...state, lists: { ...state.lists, search, searchKeyOrder: keyOrder } };
    }

    case 'EVICT_STALE_KEYS': {
      const search = { ...state.lists.search };
      let keyOrder = state.lists.searchKeyOrder.slice();

      for (const key of state.lists.searchKeyOrder) {
        const b = search[key];
        if (!b) continue;
        if (action.now - b.lastAccess > SEARCH_TTL_MS) {
          delete search[key];
          keyOrder = keyOrder.filter(k => k !== key);
        }
      }

      // Enforce capacity again (belt & suspenders)
      if (keyOrder.length > MAX_SEARCH_KEYS) {
        const toEvict = keyOrder.slice(MAX_SEARCH_KEYS);
        for (const k of toEvict) delete search[k];
        keyOrder = keyOrder.slice(0, MAX_SEARCH_KEYS);
      }

      return { ...state, lists: { ...state.lists, search, searchKeyOrder: keyOrder } };
    }

    case 'TRIM_SEARCH_PAGES': {
      const bucket = state.lists.search[action.key];
      if (!bucket) return state;
      if (bucket.pageOrder.length <= action.maxPages) return state;

     const max = Math.max(1, action.maxPages);
      const src = bucket.pageOrder; // LRU: most recent first

      // Always keep page 1 (if present), then fill up to "max" with the remaining pages in LRU order.
      const keepOrder: number[] = [];
      if (src.includes(1)) keepOrder.push(1);
      for (const p of src) {
        if (keepOrder.length >= max) break;
        if (p !== 1 && !keepOrder.includes(p)) keepOrder.push(p);
      }

      const pages = { ...bucket.pages };
      Object.keys(pages).forEach(k => {
        const pn = Number(k);
        if (!keepOrder.includes(pn)) delete pages[pn];
      });

      const nextBucket: SearchBucket = { ...bucket, pages, pageOrder: keepOrder };
      const search = { ...state.lists.search, [action.key]: nextBucket };
      return { ...state, lists: { ...state.lists, search } };
    }

    case 'APPLY_RSVP_OPT': {
      const evt = state.entities[action.eventId];
      if (!evt) return state;

      const rsvps = action.attending
        ? [
            ...evt.rsvps.filter(r => r.user.clerkId !== action.user.clerkId),
            {
              status: RSVPStatus.confirmed,
              reminderPreferenceType: null,
              reminderOffsetMinutes: null,
              reminderScheduledAt: null,
              reminderSentAt: null,
              user: action.user,
            } as RsvpItem,
          ]
        : evt.rsvps.filter(r => r.user.clerkId !== action.user.clerkId);

      return { ...state, entities: { ...state.entities, [evt.id]: { ...evt, rsvps } } };
    }

    case 'COMMIT_NEW_RSVP': {
      const evt = state.entities[action.eventId];
      if (!evt) return state;
      const rsvps = [
        ...evt.rsvps.filter(r => r.user.clerkId !== action.rsvp.user.clerkId),
        action.rsvp,
      ];
      return { ...state, entities: { ...state.entities, [evt.id]: { ...evt, rsvps } } };
    }

    case 'COMMIT_CANCEL_RSVP': {
      const evt = state.entities[action.eventId];
      if (!evt) return state;
      const rsvps = evt.rsvps.filter(r => r.user.clerkId !== action.userId);
      return { ...state, entities: { ...state.entities, [evt.id]: { ...evt, rsvps } } };
    }

    case 'COMMIT_UPDATE_REMINDER': {
      const evt = state.entities[action.eventId];
      if (!evt) return state;
      const rsvps = evt.rsvps.map(r =>
        r.user.clerkId === action.userId
          ? {
              ...r,
              reminderPreferenceType: action.reminder.reminderPreferenceType,
              reminderOffsetMinutes: action.reminder.reminderOffsetMinutes,
              reminderScheduledAt: action.reminder.reminderScheduledAt,
              reminderSentAt: action.reminder.reminderSentAt,
            }
          : r
      );
      return { ...state, entities: { ...state.entities, [evt.id]: { ...evt, rsvps } } };
    }

    case 'ROLLBACK_EVENT': {
      return { ...state, entities: { ...state.entities, [action.event.id]: action.event } };
    }

    case 'INVALIDATE_SEARCH_PAGE': {
      const bucket = state.lists.search[action.key];
      if (!bucket) return state;
      const pages = { ...bucket.pages };
      delete pages[action.page];
      const nextBucket = { ...bucket, pages };
      return {
        ...state,
        lists: { ...state.lists, search: { ...state.lists.search, [action.key]: nextBucket } },
      };
    }

    case 'REMOVE_EVENTS': {
      if (!action.ids?.length) return state;
      const removed = new Set(action.ids);

      // 1) entities
      const nextEntities = { ...state.entities };
      for (const id of action.ids) delete nextEntities[id];

      // 2) featured / upcoming
      const filterIds = (xs: string[]) => xs.filter((id) => !removed.has(id));
      const nextFeatured = filterIds(state.lists.featured);
      const nextUpcoming = filterIds(state.lists.upcoming);

      // 3) Search buckets: filter out removed IDs across ALL pages
      const nextSearch: typeof state.lists.search = {};
      for (const [key, bucket] of Object.entries(state.lists.search)) {
        const pages: Record<number, string[]> = {};
        for (const [p, ids] of Object.entries(bucket.pages)) {
          const pn = Number(p);
          pages[pn] = (ids ?? []).filter((id) => !removed.has(id));
        }
        nextSearch[key] = { ...bucket, pages };
      }

      return {
        ...state,
        entities: nextEntities,
        lists: {
          ...state.lists,
          featured: nextFeatured,
          upcoming: nextUpcoming,
          search: nextSearch,
        },
      };
    }

    case 'REMOVE_IDS_FROM_SEARCH_PAGE': {
      const bucket = state.lists.search[action.key];
      if (!bucket) return state;
      const current = bucket.pages[action.page] ?? [];
      const filtered = current.filter(id => !action.removedIds.includes(id));
      const pages = { ...bucket.pages, [action.page]: filtered };
      const nextBucket = { ...bucket, pages };
      return {
        ...state,
        lists: { ...state.lists, search: { ...state.lists.search, [action.key]: nextBucket } },
      };
    }

    default:
      return state;
  }
}

/* ---------------------------------------------------------------------- */
/*  Context & provider                                                    */
/*  - Also tracks SWR keys for targeted revalidation (featured/main).     */
/* ---------------------------------------------------------------------- */
type Store = {
  state: EventsState;
  dispatch: React.Dispatch<Action>;
  registerFeaturedKey: (swrKey: string) => void;
  unregisterFeaturedKey: (swrKey: string) => void;
  getFeaturedKeys: () => string[];
  registerMainListKey: (swrKey: string) => void;
  unregisterMainListKey: (swrKey: string) => void;
  getMainListKeys: () => string[];
};

const Ctx = createContext<Store | null>(null);

export function EventsContextProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Featured SWR keys registry
  const featuredKeysRef = useRef<Set<string>>(new Set());
  const registerFeaturedKey = useCallback((swrKey: string) => {
    if (swrKey) featuredKeysRef.current.add(swrKey);
  }, []);
  const unregisterFeaturedKey = useCallback((swrKey: string) => {
    if (swrKey) featuredKeysRef.current.delete(swrKey);
  }, []);
  const getFeaturedKeys = useCallback((): string[] => {
    return Array.from(featuredKeysRef.current);
  }, []);

  // Main list SWR keys registry
  const mainListKeysRef = useRef<Set<string>>(new Set());
  const registerMainListKey = useCallback((swrKey: string) => {
    if (swrKey) mainListKeysRef.current.add(swrKey);
  }, []);
  const unregisterMainListKey = useCallback((swrKey: string) => {
    if (swrKey) mainListKeysRef.current.delete(swrKey);
  }, []);
  const getMainListKeys = useCallback((): string[] => {
    return Array.from(mainListKeysRef.current);
  }, []);

  const value = useMemo<Store>(
    () => ({
      state,
      dispatch,
      registerFeaturedKey,
      unregisterFeaturedKey,
      getFeaturedKeys,
      registerMainListKey,
      unregisterMainListKey,
      getMainListKeys,
    }),
    [
      state,
      dispatch,
      registerFeaturedKey,
      unregisterFeaturedKey,
      getFeaturedKeys,
      registerMainListKey,
      unregisterMainListKey,
      getMainListKeys,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ---------------------------------------------------------------------- */
/*  Cross-component signals (Featured change bus)                         */
/*  - Lightweight Pub/Sub used by carousels to animate inserts/removals. */
/*    Menu emits; Featured carousel listens and commits list after anim. */
/* ---------------------------------------------------------------------- */

export type FeaturedChange = { id: string; toFeatured: boolean };

// Minimal in-memory pub/sub (module-scoped)
const featuredChangeSubs = new Set<(c: FeaturedChange) => void>();

export function emitFeaturedChange(change: FeaturedChange) {
  for (const fn of featuredChangeSubs) {
    try { fn(change); } catch {}
  }
}

/** Subscribe and get a stable unsubscribe (cleanup returns void). */
export function subscribeFeaturedChange(cb: (c: FeaturedChange) => void): () => void {
  featuredChangeSubs.add(cb);
  return () => { featuredChangeSubs.delete(cb); };
}

/** Hook-friendly subscription. */
export function useFeaturedChange(handler: (c: FeaturedChange) => void) {
  useEffect(() => {
    const unsub = subscribeFeaturedChange(handler);
    return () => { unsub(); };
  }, [handler]);
}

/* ---------------------------------------------------------------------- */
/*  Reading hooks                                                         */
/* ---------------------------------------------------------------------- */
function useStore(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('EventsContextProvider missing');
  return ctx;
}

export function useList(name: 'featured' | 'upcoming'): string[] {
  return useStore().state.lists[name];
}

export function useMainListSWRKeys() {
  const { registerMainListKey, unregisterMainListKey, getMainListKeys } = useStore();
  return { registerMainListKey, unregisterMainListKey, getMainListKeys };
}

export function useEventsByIds(ids: string[]): EventWithCreatorAndRsvps[] {
  const { state } = useStore();
  return ids
    .map(id => state.entities[id])
    .filter((e): e is EventWithCreatorAndRsvps => Boolean(e));
}

export function useEvent(eventId: string): EventWithCreatorAndRsvps | undefined {
  return useStore().state.entities[eventId];
}

/**
 * Read-only snapshot ref of the entities map.
 * Useful for transient reads (e.g., animation prep) without subscribing
 * the component to entity changes (avoids re-renders).
 */
export function useEntitiesRef() {
  const { state } = useStore();
  const ref = useRef(state.entities);

  // useLayoutEffect so the ref updates before paint
  useLayoutEffect(() => {
    ref.current = state.entities;
  }, [state.entities]);
  
  return ref;
}

export function useSearchPage(
  searchKey: string,
  page: number
): { ids: string[]; meta?: SearchBucket['meta']; hasPage: boolean } {
  const { state } = useStore();
  const bucket = state.lists.search[searchKey];
  const ids = bucket?.pages?.[page] ?? [];
  return { ids, meta: bucket?.meta, hasPage: !!bucket?.pages?.[page] };
}

export function useFeaturedSWRKeys() {
  const { registerFeaturedKey, unregisterFeaturedKey, getFeaturedKeys } = useStore();
  return { registerFeaturedKey, unregisterFeaturedKey, getFeaturedKeys };
}

/* ---------------------------------------------------------------------- */
/*  Writing hooks (lists / search)                                        */
/* ---------------------------------------------------------------------- */
export function useStoreWriters() {
  const { dispatch } = useStore();

  const upsertEvents = useCallback((events: EventWithCreatorAndRsvps[]) => {
    if (!events?.length) return;
    if (DEBUG_EVENTS) {
      console.log('[CTX] dispatch UPSERT_EVENTS', {
        count: events.length,
        ids: headTail(events.map((e) => e.id)),
      });
    }
    dispatch({ type: 'UPSERT_EVENTS', events });
  }, [dispatch]);

  const upsertEditableEvents = useCallback((evts: EditableEvent[]) => {
    if (!evts?.length) return;
    const patches = evts.map(e => {
      const date = typeof e.date === 'string' ? new Date(e.date) : e.date;
      const tz = e.eventTimeZone ?? DEFAULT_EVENT_TZ;
      const { eventLocalDateKey, eventLocalMinuteOfDay } = computeEventLocalKeys(date, tz);
      return {
        id: e.id,
        title: e.title,
        description: e.description,
        location: e.location,
        featured: e.featured,
        featuredByAdmin: e.featuredByAdmin,
        date,
        eventTimeZone: tz,
        eventLocalDateKey,
        eventLocalMinuteOfDay,
      } satisfies EventPartial;
    });
    if (DEBUG_EVENTS) {
      console.log('[CTX] dispatch PATCH_EVENTS_PARTIAL', {
        count: patches.length,
        ids: headTail(patches.map((p) => p.id)),
      });
    }
    dispatch({ type: 'PATCH_EVENTS_PARTIAL', patches });
  }, [dispatch]);


  const setList = useCallback((name: 'featured' | 'upcoming', ids: string[]) => {
    const deduped = Array.from(new Set((ids ?? []).filter(Boolean)));
    dispatch({ type: 'SET_LIST', name, ids: deduped });
  }, [dispatch]);

  const addToList = useCallback((name: 'featured' | 'upcoming', id: string) => {
    dispatch({ type: 'ADD_TO_LIST', name, id });
  }, [dispatch]);

  const removeFromList = useCallback((name: 'featured' | 'upcoming', id: string) => {
    dispatch({ type: 'REMOVE_FROM_LIST', name, id });
  }, [dispatch]);

  const setSearchPage = useCallback(
    (key: string, page: number, ids: string[], meta: SearchBucket['meta']) => {
      const now = Date.now();

      if (DEBUG_EVENTS) {
        console.groupCollapsed('[CTX] setSearchPage (writer)');
        console.log({ key, page, ids: headTail(ids), meta });
        console.groupEnd();
      }

      dispatch({ type: 'SET_SEARCH_PAGE', key, page, ids, meta });
      dispatch({ type: 'TOUCH_SEARCH_KEY', key, now });
      dispatch({ type: 'EVICT_STALE_KEYS', now });
      dispatch({ type: 'TRIM_SEARCH_PAGES', key, maxPages: MAX_PAGES_PER_KEY });
    },
    [dispatch]
  );

  return { upsertEvents, upsertEditableEvents, setList, addToList, removeFromList, setSearchPage };
}

/* ---------------------------------------------------------------------- */
/*  Invalidation hooks (search & delete)                                  */
/* ---------------------------------------------------------------------- */
export function useInvalidationWriters() {
  const { dispatch } = useStore();

  const invalidateSearchPage = useCallback((key: string, page: number) => {
    dispatch({ type: 'INVALIDATE_SEARCH_PAGE', key, page });
  }, [dispatch]);

  const removeEvents = useCallback((ids: string[]) => {
    if (ids?.length) dispatch({ type: 'REMOVE_EVENTS', ids });
  }, [dispatch]);

  const removeIdsFromSearchPage = useCallback(
    (key: string, page: number, removedIds: string[]) => {
      dispatch({ type: 'REMOVE_IDS_FROM_SEARCH_PAGE', key, page, removedIds });
    },
    [dispatch]
  );

  return { invalidateSearchPage, removeEvents, removeIdsFromSearchPage };
}

/* ---------------------------------------------------------------------- */
/*  Bulk warm-up layer (fetch "full" events in chunks)                    */
/*  - Dedupe across components + share in-flight requests                 */
/* ---------------------------------------------------------------------- */
const loadedKeys = new Set<string>();                   // (eventId|status) loaded
const inFlightByKey = new Map<string, Promise<void>>(); // shared in-flight
const DEFAULT_CHUNK_SIZE = 32;

function makeKey(eventId: string, status: RSVPStatus): string {
  return `${eventId}|${status}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Bulk loader that accepts many ids and loads "full" entities via /api/events/bulk.
 * - Dedupe: skips ids already loaded for the given status; shares in-flight promises.
 * - Chunking: splits into smaller requests to avoid oversized payloads.
 */
export function useBulkLoader() {
  const { upsertEvents } = useStoreWriters();

  const loadEventsBulk = useCallback(
    async (
      ids: string[],
      opts?: { rsvpStatus?: RSVPStatus; chunkSize?: number }
    ): Promise<void> => {
      const status = opts?.rsvpStatus ?? RSVPStatus.confirmed;
      const chunkSize = Math.max(1, opts?.chunkSize ?? DEFAULT_CHUNK_SIZE);

      const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
      if (!uniqueIds.length) return;

      const toAwait: Promise<void>[] = [];
      const toFetch: string[] = [];

      // Classify ids: already loaded, in-flight, or needs fetch
      uniqueIds.forEach(id => {
        const key = makeKey(id, status);
        const inflight = inFlightByKey.get(key);
        if (inflight) {
          toAwait.push(inflight);
        } else if (!loadedKeys.has(key)) {
          toFetch.push(id);
        }
      });

      if (toFetch.length) {
        for (const group of chunk(toFetch, chunkSize)) {
          const groupKeys = group.map(id => makeKey(id, status));

          const p = (async () => {
            try {
              const res = await fetch('/api/events/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: group, rsvpStatus: status }),
              });

              let json: EventsBulkResponse | null = null;
              try {
                json = (await res.json()) as EventsBulkResponse;
              } catch {
                // non-json edge case
              }

              if (!res.ok || !json || !json.success) {
                const msg =
                  json && !json.success ? json.error : `HTTP ${res.status}`;

                if (DEBUG_EVENTS) {
                  console.warn('[CTX] bulk load failed', {
                    status,
                    msg,
                    ids: group,
                  });
                }
                return;
              }

              const fulls = json.data;
              if (fulls.length) {
                if (DEBUG_EVENTS) {
                  console.log('[CTX] bulk loaded', {
                    count: fulls.length,
                    ids: headTail(fulls.map((e) => e.id)),
                  });
                }
                upsertEvents(fulls);
              }
            } finally {
              // Mark as loaded and clear in-flight (even on error) to avoid loops
              groupKeys.forEach(k => {
                loadedKeys.add(k);
                inFlightByKey.delete(k);
              });
            }
          })();

          groupKeys.forEach(k => inFlightByKey.set(k, p));
          toAwait.push(p);
        }
      }

      if (toAwait.length) await Promise.all(toAwait);
    },
    [upsertEvents]
  );

  return { loadEventsBulk };
}

/**
 * Convenience hook: warmup on mount/ids change.
 * - Uses a stable dependency key (status + sorted unique ids).
 * - Caller picks the RSVP status; defaults to confirmed.
 */
export function useBulkWarmup(
  ids: string[],
  opts?: { rsvpStatus?: RSVPStatus; chunkSize?: number }
) {
  const { loadEventsBulk } = useBulkLoader();

  const { status, chunkSize, uniqSorted } = useMemo(() => {
    const status = opts?.rsvpStatus ?? RSVPStatus.confirmed;
    const chunkSize = opts?.chunkSize; // (the loader already has an internal default)
    const uniqSorted = Array.from(new Set(ids)).filter(Boolean).sort();
    return { status, chunkSize, uniqSorted };
  }, [ids, opts?.rsvpStatus, opts?.chunkSize]);

  useEffect(() => {
    void loadEventsBulk(uniqSorted, { rsvpStatus: status, chunkSize });
  }, [status, chunkSize, uniqSorted, loadEventsBulk]);
}

/* ---------------------------------------------------------------------- */
/*  Mutations (RSVP / reminders)                                          */
/*  - Local optimistic ops + server reconciliation helpers                */
/* ---------------------------------------------------------------------- */
export function useRsvpActions() {
  const { state, dispatch } = useStore();

  const applyOptimistic = useCallback(
    (eventId: string, me: RsvpUser, attending: boolean) => {
      dispatch({ type: 'APPLY_RSVP_OPT', eventId, user: me, attending });
    },
    [dispatch]
  );

  const commitNewRsvp = useCallback(
    (eventId: string, rsvp: RsvpItem) => {
      dispatch({ type: 'COMMIT_NEW_RSVP', eventId, rsvp });
    },
    [dispatch]
  );

  const commitCancel = useCallback(
    (eventId: string, userId: string) => {
      dispatch({ type: 'COMMIT_CANCEL_RSVP', eventId, userId });
    },
    [dispatch]
  );

  const commitReminder = useCallback(
    (
      eventId: string,
      userId: string,
      reminder: Pick<
        RsvpItem,
        'reminderPreferenceType' | 'reminderOffsetMinutes' | 'reminderScheduledAt' | 'reminderSentAt'
      >
    ) => {
      dispatch({ type: 'COMMIT_UPDATE_REMINDER', eventId, userId, reminder });
    },
    [dispatch]
  );

  const rollbackEvent = useCallback(
    (prev: EventWithCreatorAndRsvps) => {
      dispatch({ type: 'ROLLBACK_EVENT', event: prev });
    },
    [dispatch]
  );

  // Thin wrapper around the server action: keeps the type local and stable
  const toggleRsvpOnServer = useCallback(async (eventId: string) => {
    return (await toggleRSVP(eventId)) as {
      message?: string;
      newRsvp?: {
        status: RSVPStatus;
        reminderPreferenceType?: ReminderType | null;
        reminderOffsetMinutes?: number | null;
        reminderScheduledAt?: string | Date | null;
        reminderSentAt?: string | Date | null;
        user: {
          clerkId: string;
          username: string;
          firstName?: string | null;
          lastName?: string | null;
          imageUrl?: string | null;
          hasImage?: boolean | null;
          role?: UserRole | null;
        };
      };
      rsvpCancelled?: boolean;
      userId?: string;
    };
  }, []);

  return {
    state,
    applyOptimistic,
    commitNewRsvp,
    commitCancel,
    commitReminder,
    rollbackEvent,
    toggleRsvpOnServer,
  };
}
