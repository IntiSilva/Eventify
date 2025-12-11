'use server'

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z, ZodFormattedError } from "zod";
import { revalidatePath } from "next/cache";
import { EventCategory, UserRole, ContactPhoneApps, Prisma } from "@/generated/prisma";
import type { EventWithCreatorAndRsvps } from "@/types/event";
import {
  DEFAULT_EVENT_TZ,
  computeEventLocalKeys,
  yyyymmddKey,
  canonicalizeTimeZone,
  isValidIanaTimeZone,
  normalizeStringForSearch,
} from "@/lib/utils";
import { startOfDay, addYears, differenceInMinutes } from "date-fns";
import { toZonedTime } from "date-fns-tz";

/**
 * Business-rule validation in the event's time zone.
 * We view both instants (now, event) in the event TZ and then compare:
 * - Not in the past
 * - If it's the same local day, it must be +4h from now
 * - No more than 2 years into the future (local)z
 */
function validateBusinessRules(utcInstant: Date, eventTz: string) {
  const localNow = toZonedTime(new Date(), eventTz);
  const localEvent = toZonedTime(utcInstant, eventTz);

  // No past events (in event TZ)
  if (localEvent.getTime() < localNow.getTime()) {
    throw new Error("Event date/time is in the past (event time zone).");
  }

  // If same local day, require +4h
  const sameDay = yyyymmddKey(localEvent) === yyyymmddKey(localNow);
  if (sameDay) {
    const diffMin = differenceInMinutes(localEvent, localNow);
    if (diffMin < 240) {
      throw new Error("Same-day events must be at least +4 hours from now (event time zone).");
    }
  }

  // Max 2 years ahead (in event TZ)
  const twoYearsLater = new Date(localNow);
  twoYearsLater.setFullYear(twoYearsLater.getFullYear() + 2);
  if (localEvent.getTime() > twoYearsLater.getTime()) {
    throw new Error("Event date must be within the next 2 years (event time zone).");
  }
}

/** Serialized payload accepted by create() */
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
};

/** Serialized payload for update() (id required; other fields optional) */
export type UpdateEventFormSerialized = Partial<EventFormSerialized> & {
  id: string;
  featuredByAdmin?: boolean;
};

/**
 * Create schema (server accepts strings for dates):
 * - Keeps existing validations
 * - Adds optional `eventTimeZone` with IANA check
 * - Enforces at least one contact method (email or phone)
 * - Enforces date rules in provided/default TZ
 */
const CreateEventSchema = z
  .object({
    title: z.string().min(1).max(60, { message: "Title cannot exceed 60 characters" }),
    description: z.string().min(1).max(5000, { message: "Description is too long" }),
    date: z.string().refine((d) => !Number.isNaN(Date.parse(d)), { message: "Invalid date" }),
    location: z.string().min(1).max(255, { message: "Location is too long" }),
    category: z.nativeEnum(EventCategory),
    contactEmail: z.string().email({ message: "Invalid email address" }).nullable(),
    contactPhone: z.string().min(1, { message: "Phone number, if provided, cannot be empty." }).nullable(),
    contactPhoneApps: z.enum(["whatsapp", "telegram", "both"]).optional(),
    eventTimeZone: z
      .string()
      .min(1)
      .refine((tz) => isValidIanaTimeZone(tz), { message: "Invalid IANA time zone." })
      .optional(),
  })
  .refine(
    (data) => {
      const emailProvided = data.contactEmail !== null && data.contactEmail.trim() !== "";
      const phoneProvided = data.contactPhone !== null && data.contactPhone.trim() !== "";
      return emailProvided || phoneProvided;
    },
    {
      message: "At least one contact method (email or phone) must be provided.",
      path: ["contactEmail"],
    }
  )
  .superRefine((data, ctx) => {
    try {
      const utc = new Date(data.date);
      const tz = canonicalizeTimeZone(data.eventTimeZone ?? DEFAULT_EVENT_TZ);
      const nowTz = toZonedTime(new Date(), tz);
      const eventTz = toZonedTime(utc, tz);

      // Past (in event TZ)
      if (eventTz < nowTz) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Event date cannot be in the past.", path: ["date"] });
        return;
      }

      // If same day → require +4h
      const sameDay = yyyymmddKey(eventTz) === yyyymmddKey(nowTz);
      if (sameDay) {
        const diffMin = differenceInMinutes(eventTz, nowTz);
        if (diffMin < 240) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "If the event is today, it must be at least 4 hours from now.",
            path: ["date"],
          });
        }
      }

      // Max 2 years ahead
      const maxFuture = addYears(startOfDay(nowTz), 2);
      if (eventTz > maxFuture) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Event cannot be more than 2 years in the future.",
          path: ["date"],
        });
      }
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date value.", path: ["date"] });
    }
  });

export type CreateEventInput = z.infer<typeof CreateEventSchema>;
export type CreateEventResult =
  | { success: true; message: string; errors: null }
  | { success: false; message: string; errors: ZodFormattedError<EventFormSerialized> | null };

/**
 * CREATE
 * - Auth & RBAC (admin/organizer)
 * - Zod validation (includes eventTimeZone)
 * - Business rules validated in event TZ
 * - Serializes to UTC + denormalized local keys
 */
export async function createEvent(data: EventFormSerialized): Promise<CreateEventResult> {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return { success: false, message: "Unauthorized: User not logged in.", errors: null };
  }

  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { role: true, clerkId: true },
  });

  if (!user) {
    return { success: false, message: "Unauthorized: User not found.", errors: null };
  }

  const isAdmin = user.role === UserRole.admin;
  const isOrganizer = user.role === UserRole.organizer;
  if (!isAdmin && !isOrganizer) {
    return { success: false, message: "Forbidden: User does not have permission to create events.", errors: null };
  }

  // Zod validation (string payloads from client)
  const result = CreateEventSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.format();
    return { success: false, errors: issues, message: "Validation failed. Please check the form fields." };
  }

  const { title, description, date, location, category, contactEmail, contactPhone, contactPhoneApps, eventTimeZone } =
    result.data;

  const finalEventTzRaw = eventTimeZone ?? DEFAULT_EVENT_TZ;
  const finalEventTz = canonicalizeTimeZone(finalEventTzRaw);
  const eventDateUTC = new Date(date);

  try {
    // Business rules in event TZ
    validateBusinessRules(eventDateUTC, finalEventTz);

    // Compute local keys for event TZ
    const { eventLocalDateKey, eventLocalMinuteOfDay } = computeEventLocalKeys(eventDateUTC, finalEventTz);

    await prisma.event.create({
      data: {
        title,
        normalizedTitle: normalizeStringForSearch(title),
        description,
        date: eventDateUTC, // store UTC
        location,
        normalizedLocation: normalizeStringForSearch(location),
        category,
        createdBy: clerkId,
        contactEmail,
        contactPhone,
        contactPhoneApps,
        eventTimeZone: finalEventTz,
        eventLocalDateKey,
        eventLocalMinuteOfDay,
      },
    });

    // Revalidate public/organizer views
    revalidatePath("/");
    revalidatePath("/organizer");
    revalidatePath("/admin");

    return { success: true, message: "Event created successfully!", errors: null };
  } catch (error) {
    console.error("Error creating event:", error);
    return { success: false, message: "Database error: Failed to create event.", errors: null };
  }
}

/**
 * Update schema:
 * - Allows partial updates
 * - Validates optional `eventTimeZone` and `date` if provided
 * - If phone is provided (non-empty), requires `contactPhoneApps`
 */
const UpdateEventSchema = z
  .object({
    id: z.string(),
    title: z.string().min(1).max(60).optional(),
    description: z.string().min(1).max(5000).optional(),
    date: z.string().refine((d) => !Number.isNaN(Date.parse(d)), { message: "Invalid date" }).optional(),
    location: z.string().min(1).max(255).optional(),
    category: z.nativeEnum(EventCategory).optional(),
    contactEmail: z.string().email().nullable().optional(),
    contactPhone: z.string().min(1).nullable().optional(),
    contactPhoneApps: z.enum(["whatsapp", "telegram", "both"]).optional(),
    eventTimeZone: z
      .string()
      .min(1)
      .refine((tz) => isValidIanaTimeZone(tz), { message: "Invalid IANA time zone." })
      .optional(),
    featuredByAdmin: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    // If phone provided in this update and non-empty => require contactPhoneApps
    const phoneProvidedNow =
      data.contactPhone !== undefined ? data.contactPhone !== null && data.contactPhone.trim() !== "" : false;
    if (phoneProvidedNow && !data.contactPhoneApps) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select how people will contact you by phone (WhatsApp, Telegram or Both).",
        path: ["contactPhoneApps"],
      });
    }

    // If date provided, enforce temporal rules in provided/default TZ
    if (data.date !== undefined) {
      try {
        const nowUTC = new Date();
        const eventUTC = new Date(data.date);
        const tz = canonicalizeTimeZone(data.eventTimeZone ?? DEFAULT_EVENT_TZ);

        const nowTz = toZonedTime(nowUTC, tz);
        const eventTz = toZonedTime(eventUTC, tz);

        // Past (in event TZ)
        if (eventTz < nowTz) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Event date cannot be in the past.", path: ["date"] });
          return;
        }

        // If same day → require +4h
        const sameDay = yyyymmddKey(eventTz) === yyyymmddKey(nowTz);
        if (sameDay) {
          const diffMin = differenceInMinutes(eventTz, nowTz);
          if (diffMin < 240) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "If the event is today, it must be at least 4 hours from now.",
              path: ["date"],
            });
          }
        }

        // Max 2 years ahead
        const maxFuture = addYears(startOfDay(nowTz), 2);
        if (eventTz > maxFuture) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Event cannot be more than 2 years in the future.",
            path: ["date"],
          });
        }
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date value.", path: ["date"] });
      }
    }
  });

export type UpdateEventInput = z.infer<typeof UpdateEventSchema>;

type UpdateEventSuccess = {
  success: true;
  message: string;
  errors: null;
  updatedEvent: EventWithCreatorAndRsvps | null;
};

type UpdateEventFailure = {
  success: false;
  message: string;
  errors: ZodFormattedError<UpdateEventInput> | null;
};

export type UpdateEventResult = UpdateEventSuccess | UpdateEventFailure;

/**
 * UPDATE
 * - Auth & RBAC (admin/organizer + ownership for organizers)
 * - Zod validation (includes optional eventTimeZone)
 * - If date or eventTimeZone changes, recompute local keys using the resulting (UTC date, TZ)
 * - Normalize title/location when provided
 */
export async function updateEvent(
  rawData: UpdateEventFormSerialized
): Promise<UpdateEventResult> {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return { success: false, message: "Unauthorized: User not logged in.", errors: null };
  }

  const result = UpdateEventSchema.safeParse(rawData);
  if (!result.success) {
    const issues = result.error.format();
    return { success: false, errors: issues, message: "Validation failed. Please check the form fields." };
  }

  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { role: true, clerkId: true },
  });
  if (!user) {
    return { success: false, message: "Unauthorized: User not found.", errors: null };
  }

  const isAdmin = user.role === UserRole.admin;
  const isOrganizer = user.role === UserRole.organizer;
  if (!isAdmin && !isOrganizer) {
    return { success: false, message: "Forbidden: User does not have permission to update events.", errors: null };
  }

  const existing = await prisma.event.findUnique({ where: { id: result.data.id } });
  if (!existing) {
    return { success: false, message: "Event not found.", errors: null };
  }

  // Ownership check for organizers
  if (!isAdmin && isOrganizer && existing.createdBy !== clerkId) {
    return { success: false, message: "Forbidden: You can only update your own events.", errors: null };
  }

  // --- Build update payload ---
  const dataToUpdate: Prisma.EventUpdateInput = {};

  // Normalize title/location if present
  if (result.data.title !== undefined) {
    dataToUpdate.title = result.data.title;
    dataToUpdate.normalizedTitle = normalizeStringForSearch(result.data.title);
  }
  if (result.data.location !== undefined) {
    dataToUpdate.location = result.data.location;
    dataToUpdate.normalizedLocation = normalizeStringForSearch(result.data.location);
  }

  // Simple scalar fields
  if (result.data.description !== undefined) dataToUpdate.description = result.data.description;
  if (result.data.category !== undefined) dataToUpdate.category = result.data.category;
  if (result.data.featuredByAdmin !== undefined) dataToUpdate.featuredByAdmin = result.data.featuredByAdmin;

  // Contact fields (nullable)
  if (result.data.contactEmail !== undefined) dataToUpdate.contactEmail = result.data.contactEmail;
  if (result.data.contactPhone !== undefined) dataToUpdate.contactPhone = result.data.contactPhone;
  if (result.data.contactPhoneApps !== undefined) dataToUpdate.contactPhoneApps = result.data.contactPhoneApps;

  // --- Date/TZ handling ---
  // Determine final TZ after this update. If either date or TZ changes, recompute local keys.
  const incomingTz = result.data.eventTimeZone;
  const finalEventTz = canonicalizeTimeZone(incomingTz ?? existing.eventTimeZone ?? DEFAULT_EVENT_TZ);

  if (result.data.date !== undefined) {
    const newUtcDate = new Date(result.data.date);

    // Business rules in final TZ
    validateBusinessRules(newUtcDate, finalEventTz);

    // Compute new local keys
    const { eventLocalDateKey, eventLocalMinuteOfDay } = computeEventLocalKeys(newUtcDate, finalEventTz);
    dataToUpdate.date = newUtcDate;
    dataToUpdate.eventTimeZone = finalEventTz;
    dataToUpdate.eventLocalDateKey = eventLocalDateKey;
    dataToUpdate.eventLocalMinuteOfDay = eventLocalMinuteOfDay;

  // TZ-only change: recompute keys using existing date
  } else if (result.data.eventTimeZone !== undefined) {
    const { eventLocalDateKey, eventLocalMinuteOfDay } = computeEventLocalKeys(existing.date, finalEventTz);
    dataToUpdate.eventTimeZone = finalEventTz;
    dataToUpdate.eventLocalDateKey = eventLocalDateKey;
    dataToUpdate.eventLocalMinuteOfDay = eventLocalMinuteOfDay;
  }

  try {
    const updated = await prisma.event.update({
      where: { id: result.data.id },
      data: dataToUpdate,
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
          select: {
            status: true,
            reminderPreferenceType: true,
            reminderOffsetMinutes: true,
            reminderScheduledAt: true,
            reminderSentAt: true,
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
        },
      },
    });



    // Revalidate common views
    revalidatePath("/");
    revalidatePath("/organizer");
    revalidatePath("/admin");

    return {
      success: true,
      message: "Event updated successfully!",
      errors: null,
      updatedEvent: updated,
    };
  } catch (error) {
    console.error("Error updating event:", error);
    return { success: false, message: "Database error: Failed to update event.", errors: null };
  }
}

/** Standard result for delete actions */
export type DeleteEventResult = { success: boolean; message: string };

/**
 * DELETE
 * - Auth & RBAC (admin/organizer + ownership for organizers)
 * - Returns a consistent JSON structure
 */
export async function deleteEvent(eventId: string): Promise<DeleteEventResult> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return { success: false, message: "Unauthorized" };

  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { role: true, clerkId: true },
  });
  if (!user) return { success: false, message: "Forbidden: User not found." };

  const isAdmin = user.role === UserRole.admin;
  const isOrganizer = user.role === UserRole.organizer;
  if (!isAdmin && !isOrganizer) {
    return { success: false, message: "Forbidden: User does not have permission to delete events." };
  }

  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, createdBy: true },
  });
  if (!existing) return { success: false, message: "Event not found." };

  if (!isAdmin && isOrganizer && existing.createdBy !== clerkId) {
    return { success: false, message: "Forbidden: You can only delete your own events." };
  }

  try {
    await prisma.event.delete({ where: { id: eventId } });
    revalidatePath("/organizer");
    revalidatePath("/admin");
    revalidatePath("/");
    return { success: true, message: "Event deleted successfully." };
  } catch (error) {
    console.error("Error deleting event:", error);
    return { success: false, message: "Database error: Failed to delete event." };
  }
}
