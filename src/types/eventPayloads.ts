import type { ContactPhoneApps, EventCategory } from "@/generated/prisma";

/**
 * Serialized payloads sent from UI forms to event server actions.
 * These are intentionally separate from UI form schemas (`src/schemas/events.ts`)
 * because client schemas operate on Date objects and UI-only fields.
 */
export type EventFormSerialized = {
  title: string;
  description: string;
  date: string; // UTC ISO from client
  location: string;
  category: EventCategory;
  contactEmail: string | null;
  contactPhone: string | null;
  contactPhoneApps?: ContactPhoneApps;
  eventTimeZone?: string | null; // optional IANA TZ from UI
  isPaid?: boolean;
  priceCents?: number | null;
  currency?: string | null;
};

export type UpdateEventFormSerialized = Partial<EventFormSerialized> & {
  id: string;
  featuredByAdmin?: boolean;
};
