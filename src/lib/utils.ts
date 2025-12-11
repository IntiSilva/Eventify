import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { EventCategory } from "@/generated/prisma";
import type { Event } from "@/generated/prisma";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import type { SearchbarFilters } from "@/components/Searchbar/Searchbar";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function capitalizeFirstLetter(str: string | undefined | null) {
    if (!str) return str;
    const formattedString = str.replace(/_/g, ' ');
    return formattedString.charAt(0).toUpperCase() + formattedString.slice(1);
  }



export const fetcherSWR = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'Failed to fetch events');
  }

  return response.json();
};

/**
 * Formats an E.164 phone number for WhatsApp 'wa.me' links
 * by removing non-digit characters.
 * @param phoneNumber The phone number, ideally in E.164 format (e.g., "+5491122334455").
 * @returns A string of digits only (e.g., "5491122334455").
 */
export function formatPhoneNumberForWhatsApp(phoneNumber: string | null | undefined): string | null {
  if (!phoneNumber) {
    return null;
  }
  // Remove all non-digit characters
  return phoneNumber.replace(/\D/g, '');
}





export function getCategoryBadgeColors(category: EventCategory): string {
  switch (category) {
    case EventCategory.music:
      return "bg-purple-600 hover:bg-purple-700 text-purple-100 border-purple-800";
    case EventCategory.sports:
      return "bg-orange-500 hover:bg-orange-600 text-orange-100 border-orange-700";
    case EventCategory.education:
      return "bg-blue-600 hover:bg-blue-700 text-blue-100 border-blue-800";
    case EventCategory.tech:
      return "bg-stone-600 hover:bg-stone-700 text-stone-100 border-stone-800"; // Or a gray/silver
    case EventCategory.health:
      return "bg-green-600 hover:bg-green-700 text-green-100 border-green-800";
    case EventCategory.art:
      return "bg-pink-500 hover:bg-pink-600 text-pink-100 border-pink-700";
    case EventCategory.nightlife:
      return "bg-indigo-600 hover:bg-indigo-700 text-indigo-100 border-indigo-800";
    case EventCategory.gastronomy:
      return "bg-amber-500 hover:bg-amber-600 text-amber-50 border-amber-700";
    case EventCategory.films:
      return "bg-rose-600 hover:bg-rose-700 text-rose-100 border-rose-800";
    case EventCategory.theater:
      return "bg-red-700 hover:bg-red-800 text-red-100 border-red-900";
    case EventCategory.fitness:
      return "bg-lime-500 hover:bg-lime-600 text-lime-50 border-lime-700";
    case EventCategory.business:
      return "bg-slate-600 hover:bg-slate-700 text-slate-100 border-slate-800";
    case EventCategory.finance:
      return "bg-teal-600 hover:bg-teal-700 text-teal-100 border-teal-800";
    case EventCategory.fashion:
      return "bg-fuchsia-600 hover:bg-fuchsia-700 text-fuchsia-100 border-fuchsia-800";
    case EventCategory.travel:
      return "bg-cyan-500 hover:bg-cyan-600 text-cyan-100 border-cyan-700";
    case EventCategory.gaming:
      return "bg-violet-600 hover:bg-violet-700 text-violet-100 border-violet-800";
    case EventCategory.workshop:
      return "bg-yellow-500 hover:bg-yellow-600 text-yellow-50 border-yellow-700";
    default:
      return "bg-zinc-600 hover:bg-zinc-700 text-zinc-100 border-zinc-800";
  }
}



/**
 * Retrieves a single string value from a search parameter that might be a string or string[].
 * Returns the first value if it's an array, or the string itself if it's a string.
 * Returns undefined if the paramValue is undefined or not a string/array of strings.
 * @param paramValue The value from searchParams (string | string[] | undefined).
 * @returns The string value or undefined.
 */
export function getSingleSearchParam(paramValue: string | string[] | undefined): string | undefined {
  if (Array.isArray(paramValue)) {
    return paramValue[0]; // Take the first value if it's an array
  }
  if (typeof paramValue === 'string') {
    return paramValue;
  }
  return undefined; // Return undefined if not a string or array
}



export type BadgeState = 'none' | 'featured' | 'admin' | 'both';

export function getBadgeState(event: Pick<Event, 'featured' | 'featuredByAdmin'>): BadgeState {
  const isAdmin = event.featuredByAdmin;
  const isFeatured = event.featured;

  if (isAdmin && isFeatured) return 'both';
  if (isAdmin) return 'admin';
  if (isFeatured) return 'featured';
  return 'none';
}


/**
 * Normalizes a string for search: lowercases it,
 * removes accents, apostrophes and other special characters.
 * @param str The string to normalize.
 * @returns The normalized string.
 */
export function normalizeStringForSearch(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .normalize('NFD')                             // split diacritics
    .replace(/\p{Diacritic}/gu, '')              // remove accents
    .toLowerCase()
    .replace(/&/g, ' y ')                        // treat '&' consistently (or ' and ')
    .replace(/[:/|.,;!?#()[\]{}"'+=*_<>~-]/g, ' ') // separators → space
    .replace(/[^0-9a-záéíóúñü\s]/giu, ' ')       // remaining non-alphanumerics → space (safe)
    .replace(/\s+/g, ' ')                        // collapse repeated spaces
    .trim();
}

export const USERNAME_MIN = 4;
export const USERNAME_MAX = 25;

// Visible/allowed rule (UI + server):
// letters, numbers, dot, hyphen, and underscore.
export const USERNAME_REGEX = /^[a-zA-Z0-9._-]+$/;

export function normalizeUsername(u: string): string {
  return u
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function validateUsername(u: string): string | null {
  if (!u) return 'Required';
  if (u.length < USERNAME_MIN || u.length > USERNAME_MAX) {
    return `Must be ${USERNAME_MIN}-${USERNAME_MAX} chars`;
  }
  if (!USERNAME_REGEX.test(u)) {
    return 'Only letters, numbers, dot, dash and underscore';
  }
  return null;
}



export const DEFAULT_EVENT_TZ = "America/Argentina/Buenos_Aires"; // adjust if you want a different default

export function yyyymmddKey(d: Date): number {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return y * 10000 + m * 100 + day;
}

export function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** From a UTC instant and an event TZ, return the local keys */
export function computeEventLocalKeys(utcInstant: Date, eventTz: string): {
  eventLocalDateKey: number;
  eventLocalMinuteOfDay: number;
} {
  const local = toZonedTime(utcInstant, eventTz);
  return {
    eventLocalDateKey: yyyymmddKey(local),
    eventLocalMinuteOfDay: minuteOfDay(local),
  };
}

/** Converts 'YYYY-MM-DD' to an integer yyyymmdd */
export function parseYyyyMmDdToKey(yyyyMmDd: string): number {
  const [y, m, d] = yyyyMmDd.split("-").map((n) => parseInt(n, 10));
  return y * 10000 + m * 100 + d;
}

// canonicalization, validity, comparison by offset at an instant

export function canonicalizeTimeZone(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz })
      .resolvedOptions().timeZone;
  } catch {
    return tz; // let it pass; a validator will catch it later
  }
}

export function isValidIanaTimeZone(tz: string): boolean {
  try {
    if ('supportedValuesOf' in Intl && typeof (Intl as { supportedValuesOf?: (k: 'timeZone') => readonly string[] }).supportedValuesOf === 'function') {
      const list = (Intl as { supportedValuesOf: (k: 'timeZone') => readonly string[] }).supportedValuesOf('timeZone');
      const canon = canonicalizeTimeZone(tz);
      return list.includes(tz) || list.includes(canon);
    }
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}


/** offset in minutes of a TZ at the instant `at` (UTC) */
function offsetMinutesAt(tz: string, at: Date): number | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = fmt.formatToParts(at);
    const y  = Number(parts.find(p => p.type === 'year')?.value);
    const m  = Number(parts.find(p => p.type === 'month')?.value);
    const d  = Number(parts.find(p => p.type === 'day')?.value);
    const hh = Number(parts.find(p => p.type === 'hour')?.value);
    const mm = Number(parts.find(p => p.type === 'minute')?.value);
    const ss = Number(parts.find(p => p.type === 'second')?.value);

    const asUTC = Date.UTC(y, m - 1, d, hh, mm, ss);
    return Math.round((asUTC - at.getTime()) / 60000);
  } catch {
    return null;
  }
}

/**
 * Are they “equivalent” for the instant `at`?
 * 1) same canonical name → equal
 * 2) same offset that day → equivalent (don’t show “different TZ”)
 */
export function tzEqualForInstant(a: string, b: string, at: Date): boolean {
  const ca = canonicalizeTimeZone(a);
  const cb = canonicalizeTimeZone(b);
  if (ca === cb) return true;
  const oa = offsetMinutesAt(ca, at);
  const ob = offsetMinutesAt(cb, at);
  return oa !== null && ob !== null && oa === ob;
}


/**
 * Returns the browser-detected IANA time zone
 * (e.g., "America/Argentina/Buenos_Aires").
 *
 * ‼️  Only use this in code that runs on the **client**.
 *     In SSR/Node it will return undefined.
 */
export function getBrowserTimeZone(): string | undefined {
  if (typeof window === "undefined") return undefined; // SSR / Node
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Complete list of IANA time zones available in the runtime. */
export const IANA_TIMEZONES: string[] =
  typeof Intl?.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")          // ⬅️  all (≈ 600)
    : [];                                         // fallback (very old SSR)


/** Maps { "America": ["America/Buenos_Aires", …], "Europe": […] } */
export const GROUPED_TZ = IANA_TIMEZONES.reduce<Record<string, string[]>>(
  (acc, tz) => {
    const [continent] = tz.split("/");
    (acc[continent] ??= []).push(tz);
    return acc;
  },
  {}
);

/**
 * Converts an IANA time zone (e.g., "America/Buenos_Aires")
 * to a more readable format: "America/Buenos Aires"
 * - Keeps the continent as-is
 * - Replaces "_" with spaces only in the city/country part
 */
export function formatTimeZoneLabel(tz: string): string {
  if (!tz) return 'Unknown';

  const [continent, region] = tz.split('/');

  if (!continent || !region) return tz;

  const formattedRegion = region.replace(/_/g, ' ');

  return `${continent}/${formattedRegion}`;
}



/**
 * Build **one single** query string for `/api/events`.
 * – Only includes keys that are present and non-empty.  
 * – Adds `viewTz` (browser TZ) **exactly once**.
 */
export function buildEventsQS(
  filters: SearchbarFilters = {},
  viewTz?: string

) {
  const qs = new URLSearchParams();

  if (filters.search)    qs.set("search",   filters.search);
  if (filters.category)  qs.set("category", filters.category);
  if (filters.location)  qs.set("location", filters.location);
  if (filters.creator)   qs.set("creator",  filters.creator);
  if (filters.date)      qs.set("date",     filters.date);

  /* —— Visitor's TZ, received from the component —— */
  if (viewTz) qs.set("viewTz", viewTz);

  return qs.toString();        // «search=foo&viewTz=America/…»
}

/* ------------------------------------------------------------------ */
/* Organizer helpers                                                  */
/* ------------------------------------------------------------------ */

type OrgParams = {
  page?: number;
  limit?: number;
  filters?: SearchbarFilters;
};

/**
 * Builds the query string for `/api/organizer/events*`.
 * Never adds `viewTz`.
 */
export function buildOrganizerQS({ page, limit, filters = {} }: OrgParams) {
  const qs = new URLSearchParams();

  if (page)  qs.set("page",  String(page));
  if (limit) qs.set("limit", String(limit));

  if (filters.search)   qs.set("search",   filters.search);
  if (filters.category) qs.set("category", filters.category);
  if (filters.location) qs.set("location", filters.location);
  if (filters.date)     qs.set("date",     filters.date);

  /* creator filter doesn't exist in organizer */

  return qs.toString();              // "page=2&search=foo&date=2025-08-07"
}


/* ------------------------------------------------------------------ */
/* Admin helpers                                                      */
/* ------------------------------------------------------------------ */
type AdminParams = {
  page?: number;
  limit?: number;
  filters?: SearchbarFilters;
};

/**
 * Builds the query string for `/api/admin/events/[userId]`.
 * Only includes page, limit and the filters search | location | category | date.
 * Never adds `viewTz`.
 */
export function buildAdminQS({ page, limit, filters = {} }: AdminParams) {
  const qs = new URLSearchParams();

  if (page)  qs.set("page",  String(page));
  if (limit) qs.set("limit", String(limit));

  if (filters.search)   qs.set("search",   filters.search);
  if (filters.category) qs.set("category", filters.category);
  if (filters.location) qs.set("location", filters.location);
  if (filters.date)     qs.set("date",     filters.date);

  /* creator doesn't apply: userId comes in the route */

  return qs.toString();   // → "page=1&limit=10&search=foo&date=2025-08-07"
}



/**
 * Interprets the picker's Date as a "wall-clock" in the `eventTz` time zone
 * and converts it to a Date in UTC (ready for .toISOString() / DB).
 */
export function pickerDateToUtc(picked: Date, eventTz: string): Date {
  // Extract the wall-clock numbers the user chose
  const y  = picked.getFullYear();
  const m  = picked.getMonth();        // 0..11
  const d  = picked.getDate();
  const hh = picked.getHours();
  const mm = picked.getMinutes();
  const ss = 0
  const ms = 0
  // Build a "naive" Date with those fields (no zone)
  const wallClock = new Date(y, m, d, hh, mm, ss, ms);

  // Translate it from eventTz -> UTC (once)
  return fromZonedTime(wallClock, eventTz);
}

/**
 * Converts a UTC instant (ISO string or Date) to the "wall-clock" in zone `tz`.
 * Ideal to initialize the DateTimePicker when the event is in another TZ.
 */
export function utcIsoToWallClockDate(utcInput: string | Date, tz: string): Date {
  // Accepts Date or ISO string without forcing you to call .toISOString() outside
  const utc = typeof utcInput === "string" ? new Date(utcInput) : utcInput;

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    })
      .formatToParts(utc)
      .map((p) => [p.type, p.value])
  );

  // Build a "local" Date that shows the same event wall-clock in that TZ
  return new Date(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
}