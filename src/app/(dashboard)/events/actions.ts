'use server'

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z, ZodFormattedError } from "zod";
import { revalidatePath } from "next/cache";
import { EventCategory, UserRole, Prisma, PaymentStatus } from "@/generated/prisma";
import type { EventWithCreatorAndRsvps } from "@/types/event";
import type { EventFormSerialized, UpdateEventFormSerialized } from "@/types/eventPayloads";
import {
  DEFAULT_EVENT_TZ,
  computeEventLocalKeys,
  canonicalizeTimeZone,
  isValidIanaTimeZone,
  normalizeStringForSearch,
} from "@/lib/utils";
import { startOfDay, addYears, differenceInMinutes } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { isStripeConnectReady } from "@/lib/payments/stripeConnectReadiness";
import {
  buildEventPricingQuote,
  type EventPricingQuote,
  type PricingPreviewMode,
} from "@/lib/payments/pricingQuote.server";

/**
 * Business-rule validation for event scheduling.
 * - Not in the past
 * - Absolute minimum lead time: +4h from now (no same-day gating)
 * - No more than 2 years into the future (local)z
 */

const FOUR_HOURS_MS = 240 * 60 * 1000;

function validateBusinessRules(utcInstant: Date, eventTz: string) {
  const now = new Date();
  const localNow = toZonedTime(now, eventTz);
  const localEvent = toZonedTime(utcInstant, eventTz);

  // No past/started events (absolute instant)
  if (utcInstant.getTime() <= now.getTime()) {
    throw new Error("Event date/time cannot be in the past.");
  }

  // Absolute +4h minimum lead time (exactly 4h is allowed)
  const leadTimeMs = utcInstant.getTime() - now.getTime();
  if (leadTimeMs < FOUR_HOURS_MS) {
    throw new Error("Event must be at least 4 hours from now.");
  }

  // Max 2 years ahead (in event TZ)
  const twoYearsLater = new Date(localNow);
  twoYearsLater.setFullYear(twoYearsLater.getFullYear() + 2);
  if (localEvent.getTime() > twoYearsLater.getTime()) {
    throw new Error("Event date must be within the next 2 years (event time zone).");
  }
}

type PricingState = {
  isPaid: boolean;
  priceCents: number | null;
  currency: string | null;
};

const MARKETPLACE_PAID_EVENT_GATE_MESSAGE =
  "Paid events require an organizer with a fully enabled Stripe Connect account. Complete account details and enable charges and payouts before creating or updating paid events.";
const INVALID_PAID_EVENT_OWNER_MESSAGE =
  "Paid events must be owned by an organizer or admin account.";

type PaidEventCreatorRoutingState = {
  role: UserRole;
  stripeConnectAccountId: string | null;
  stripeConnectPayoutsEnabled: boolean;
  stripeConnectChargesEnabled: boolean;
  stripeConnectDetailsSubmitted: boolean;
};

function getPaidEventMarketplaceGateError(input: {
  isPaidFinalState: boolean;
  creator: PaidEventCreatorRoutingState | null | undefined;
}): string | null {
  if (!input.isPaidFinalState) return null;
  if (!input.creator) {
    return INVALID_PAID_EVENT_OWNER_MESSAGE;
  }

  if (input.creator.role === UserRole.admin) {
    return null;
  }

  if (input.creator.role !== UserRole.organizer) {
    return INVALID_PAID_EVENT_OWNER_MESSAGE;
  }

  const hasRoutingReadiness = isStripeConnectReady({
    stripeConnectAccountId: input.creator.stripeConnectAccountId,
    stripeConnectPayoutsEnabled: input.creator.stripeConnectPayoutsEnabled,
    stripeConnectChargesEnabled: input.creator.stripeConnectChargesEnabled,
    stripeConnectDetailsSubmitted: input.creator.stripeConnectDetailsSubmitted,
  });

  return hasRoutingReadiness ? null : MARKETPLACE_PAID_EVENT_GATE_MESSAGE;
}

function normalizePricingState(input: {
  isPaid: boolean | null | undefined;
  priceCents: number | null | undefined;
  currency: string | null | undefined;
}): PricingState {
  const isPaid = Boolean(input.isPaid);
  const currency = input.currency ? input.currency.toUpperCase() : null;
  if (!isPaid) {
    return { isPaid: false, priceCents: null, currency: null };
  }
  return {
    isPaid: true,
    priceCents: input.priceCents ?? null,
    currency,
  };
}

function pricingStatesEqual(a: PricingState, b: PricingState): boolean {
  return a.isPaid === b.isPaid && a.priceCents === b.priceCents && a.currency === b.currency;
}

function isCompletePaidPricing(pricing: PricingState): boolean {
  return pricing.isPaid ? Boolean(pricing.priceCents && pricing.currency) : true;
}

function requestedPricingFieldChange(data: UpdateEventInput): boolean {
  return data.isPaid !== undefined || data.priceCents !== undefined || data.currency !== undefined;
}

function isPricingLockedForEventStart(eventStart: Date, now = new Date()): boolean {
  // Final policy: exactly 4h remaining is allowed, so only block when strictly < 240 min.
  return differenceInMinutes(eventStart, now) < 240;
}

function formatDateFieldError<T extends Record<string, unknown>>(message: string): ZodFormattedError<T> {
  return new z.ZodError([
    {
      code: z.ZodIssueCode.custom,
      path: ["date"],
      message,
    },
  ]).format() as ZodFormattedError<T>;
}

const EVENT_WITH_CREATOR_AND_RSVPS_ARGS = Prisma.validator<Prisma.EventDefaultArgs>()({
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

type EventWithCreatorAndRsvpsDbPayload = Prisma.EventGetPayload<typeof EVENT_WITH_CREATOR_AND_RSVPS_ARGS>;

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
    isPaid: z.boolean().optional(),
    priceCents: z.number().int().positive().nullable().optional(),
    currency: z.string().length(3).nullable().optional(),
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
  .refine(
    (data) => !data.isPaid || (!!data.priceCents && !!data.currency),
    {
      message: "Paid events require price and currency.",
      path: ["priceCents"],
    }
  )
  .superRefine((data, ctx) => {
    try {
      const nowUTC = new Date();
      const eventUTC = new Date(data.date);
      const tz = canonicalizeTimeZone(data.eventTimeZone ?? DEFAULT_EVENT_TZ);
      const nowTz = toZonedTime(nowUTC, tz);
      const eventTz = toZonedTime(eventUTC, tz);

      // Past/started (absolute instant)
      if (eventUTC.getTime() <= nowUTC.getTime()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Event date cannot be in the past.", path: ["date"] });
        return;
      }

      // Absolute +4h minimum lead time (exactly 240 min is allowed)
      const leadTimeMs = eventUTC.getTime() - nowUTC.getTime();
      if (leadTimeMs < FOUR_HOURS_MS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Event must be at least 4 hours from now.",
          path: ["date"],
        });
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

const EventPricingPreviewSchema = z.object({
  isPaid: z.boolean(),
  priceCents: z.number().int().positive().nullable(),
  currency: z.string().length(3).nullable(),
  previewMode: z.enum(["organizer", "admin"]),
});

export type EventPricingPreviewData = EventPricingQuote;

export type EventPricingPreviewResult =
  | { success: true; data: EventPricingPreviewData | null }
  | { success: false; message: string; data: null };

export async function getEventPricingPreview(input: {
  isPaid: boolean;
  priceCents: number | null;
  currency: string | null;
  previewMode: PricingPreviewMode;
}): Promise<EventPricingPreviewResult> {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return { success: false, message: "Unauthorized: User not logged in.", data: null };
  }

  const parsed = EventPricingPreviewSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid pricing preview payload.",
      data: null,
    };
  }

  const { isPaid, priceCents, currency, previewMode } = parsed.data;
  if (!isPaid || !priceCents || !currency) {
    return { success: true, data: null };
  }

  return {
    success: true,
    data: buildEventPricingQuote({
      ticketAmountCents: priceCents,
      currency,
      previewMode,
    }),
  };
}

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
    select: {
      role: true,
      clerkId: true,
      stripeConnectAccountId: true,
      stripeConnectPayoutsEnabled: true,
      stripeConnectChargesEnabled: true,
      stripeConnectDetailsSubmitted: true,
    },
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

  const { title, description, date, location, category, contactEmail, contactPhone, contactPhoneApps, eventTimeZone, isPaid, priceCents, currency } =
    result.data;

  const marketplaceGateError = getPaidEventMarketplaceGateError({
    isPaidFinalState: Boolean(isPaid),
    creator: user,
  });
  if (marketplaceGateError) {
    return {
      success: false,
      message: marketplaceGateError,
      errors: null,
    };
  }

  const finalEventTzRaw = eventTimeZone ?? DEFAULT_EVENT_TZ;
  const finalEventTz = canonicalizeTimeZone(finalEventTzRaw);
  const eventDateUTC = new Date(date);

  try {
    // Business rules in event TZ
    validateBusinessRules(eventDateUTC, finalEventTz);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid event date value.";
    return {
      success: false,
      message: "Validation failed. Please check the form fields.",
      errors: formatDateFieldError<EventFormSerialized>(message),
    };
  }

  try {
    // Compute local keys for event TZ
    const { eventLocalDateKey, eventLocalMinuteOfDay } = computeEventLocalKeys(eventDateUTC, finalEventTz);

    const normalizedPricing = normalizePricingState({
      isPaid,
      priceCents,
      currency,
    });

    await prisma.$transaction(async (tx) => {
      const createdEvent = await tx.event.create({
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
          isPaid: normalizedPricing.isPaid,
          priceCents: normalizedPricing.priceCents,
          currency: normalizedPricing.currency,
        },
        select: { id: true },
      });

      const initialPriceVersion = await tx.eventPriceVersion.create({
        data: {
          eventId: createdEvent.id,
          versionNumber: 1,
          isPaid: normalizedPricing.isPaid,
          amountCents: normalizedPricing.priceCents,
          currency: normalizedPricing.currency,
          createdBy: clerkId,
        },
        select: { id: true },
      });

      await tx.event.update({
        where: { id: createdEvent.id },
        data: { currentPriceVersionId: initialPriceVersion.id },
      });
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
    isPaid: z.boolean().optional(),
    priceCents: z.number().int().positive().nullable().optional(),
    currency: z.string().length(3).nullable().optional(),
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

        // Past/started (absolute instant)
        if (eventUTC.getTime() <= nowUTC.getTime()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Event date cannot be in the past.", path: ["date"] });
          return;
        }

        // Absolute +4h minimum lead time (exactly 240 min is allowed)
        const leadTimeMs = eventUTC.getTime() - nowUTC.getTime();
        if (leadTimeMs < FOUR_HOURS_MS) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Event must be at least 4 hours from now.",
            path: ["date"],
          });
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
    select: {
      role: true,
      clerkId: true,
      stripeConnectAccountId: true,
      stripeConnectPayoutsEnabled: true,
      stripeConnectChargesEnabled: true,
      stripeConnectDetailsSubmitted: true,
    },
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
  // Scalar-only update payload to avoid Prisma checked/unchecked XOR conflicts.
  const dataToUpdate: Prisma.EventUncheckedUpdateInput = {};

  // Normalize title/location if present
  if (result.data.title !== undefined) {
    dataToUpdate.title = result.data.title;
    dataToUpdate.normalizedTitle = normalizeStringForSearch(result.data.title);
  }
  if (result.data.location !== undefined) {
    dataToUpdate.location = result.data.location;
    dataToUpdate.normalizedLocation = normalizeStringForSearch(result.data.location);
  }

  // Simple scalar fields (ticketing/pricing fields are handled below with policy checks)
  if (result.data.description !== undefined) dataToUpdate.description = result.data.description;
  if (result.data.category !== undefined) dataToUpdate.category = result.data.category;
  if (result.data.featuredByAdmin !== undefined) dataToUpdate.featuredByAdmin = result.data.featuredByAdmin;

  // Contact fields (nullable)
  if (result.data.contactEmail !== undefined) dataToUpdate.contactEmail = result.data.contactEmail;
  if (result.data.contactPhone !== undefined) dataToUpdate.contactPhone = result.data.contactPhone;
  if (result.data.contactPhoneApps !== undefined) dataToUpdate.contactPhoneApps = result.data.contactPhoneApps;

  // --- Ticketing/pricing policy (server is source of truth) ---
  const pricingInputTouched = requestedPricingFieldChange(result.data);
  const existingPricing = normalizePricingState({
    isPaid: existing.isPaid,
    priceCents: existing.priceCents,
    currency: existing.currency,
  });
  const nextPricing = normalizePricingState({
    isPaid: result.data.isPaid ?? existingPricing.isPaid,
    priceCents: result.data.priceCents !== undefined ? result.data.priceCents : existingPricing.priceCents,
    currency: result.data.currency !== undefined ? result.data.currency : existingPricing.currency,
  });
  const pricingChanged = pricingInputTouched && !pricingStatesEqual(existingPricing, nextPricing);

  // Final-state validation (update payload is partial, so this must use persisted values)
  if (pricingInputTouched && !isCompletePaidPricing(nextPricing)) {
    return { success: false, message: "Paid events require price and currency.", errors: null };
  }

  const paidEventCreator =
    nextPricing.isPaid
      ? existing.createdBy === user.clerkId
        ? user
        : await prisma.user.findUnique({
            where: { clerkId: existing.createdBy },
            select: {
              role: true,
              clerkId: true,
              stripeConnectAccountId: true,
              stripeConnectPayoutsEnabled: true,
              stripeConnectChargesEnabled: true,
              stripeConnectDetailsSubmitted: true,
            },
          })
      : null;

  const marketplaceGateError = getPaidEventMarketplaceGateError({
    isPaidFinalState: nextPricing.isPaid,
    creator: paidEventCreator,
  });
  if (marketplaceGateError) {
    return {
      success: false,
      message: marketplaceGateError,
      errors: null,
    };
  }

  if (pricingChanged) {
    // Final policy: pricing lock is evaluated against persisted event start (anti-bypass).
    if (isPricingLockedForEventStart(existing.date)) {
      return {
        success: false,
        message: "Pricing changes are locked within 4 hours of the event start.",
        errors: null,
      };
    }

    const isPaidToFree = existingPricing.isPaid && !nextPricing.isPaid;
    const currencyChanged = nextPricing.currency !== existingPricing.currency;

    if (isPaidToFree || currencyChanged) {
      const succeededPayment = await prisma.payment.findFirst({
        where: { eventId: existing.id, status: PaymentStatus.succeeded },
        select: { id: true },
      });

      if (succeededPayment) {
        if (isPaidToFree) {
          return {
            success: false,
            message: "Cannot switch this event to free because at least one payment has already succeeded.",
            errors: null,
          };
        }
        if (currencyChanged) {
          return {
            success: false,
            message: "Cannot change currency because at least one payment has already succeeded.",
            errors: null,
          };
        }
      }
    }

    dataToUpdate.isPaid = nextPricing.isPaid;
    dataToUpdate.priceCents = nextPricing.priceCents;
    dataToUpdate.currency = nextPricing.currency;
  }

  // --- Date/TZ handling ---
  // Determine final TZ after this update. If either date or TZ changes, recompute local keys.
  const incomingTz = result.data.eventTimeZone;
  const finalEventTz = canonicalizeTimeZone(incomingTz ?? existing.eventTimeZone ?? DEFAULT_EVENT_TZ);

  if (result.data.date !== undefined) {
    const newUtcDate = new Date(result.data.date);

    try {
      // Business rules in final TZ
      validateBusinessRules(newUtcDate, finalEventTz);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid event date value.";
      return {
        success: false,
        message: "Validation failed. Please check the form fields.",
        errors: formatDateFieldError<UpdateEventInput>(message),
      };
    }

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
    const updated: EventWithCreatorAndRsvpsDbPayload = pricingChanged
      ? await prisma.$transaction(async (tx) => {
          const now = new Date();

          const latestPriceVersion = await tx.eventPriceVersion.findFirst({
            where: { eventId: existing.id },
            orderBy: { versionNumber: "desc" },
            select: { versionNumber: true },
          });
          const nextVersionNumber = (latestPriceVersion?.versionNumber ?? 0) + 1;

          if (existing.currentPriceVersionId) {
            await tx.eventPriceVersion.updateMany({
              where: { id: existing.currentPriceVersionId, supersededAt: null },
              data: { supersededAt: now },
            });
          }

          const createdPriceVersion = await tx.eventPriceVersion.create({
            data: {
              eventId: existing.id,
              versionNumber: nextVersionNumber,
              isPaid: nextPricing.isPaid,
              amountCents: nextPricing.priceCents,
              currency: nextPricing.currency,
              createdBy: clerkId,
              effectiveAt: now,
            },
            select: { id: true },
          });

          const txData: Prisma.EventUncheckedUpdateInput = {
            ...dataToUpdate,
            currentPriceVersionId: createdPriceVersion.id,
          };

          return tx.event.update({
            where: { id: result.data.id },
            data: txData,
            ...EVENT_WITH_CREATOR_AND_RSVPS_ARGS,
          });
        })
      : await prisma.event.update({
          where: { id: result.data.id },
          data: dataToUpdate,
          ...EVENT_WITH_CREATOR_AND_RSVPS_ARGS,
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

/** Standard result for archive actions */
export type ArchiveEventResult = { success: boolean; message: string };

/**
 * ARCHIVE
 * - Auth & RBAC (admin/organizer + ownership for organizers)
 * - Returns a consistent JSON structure
 */
export async function archiveEvent(eventId: string): Promise<ArchiveEventResult> {
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
    return { success: false, message: "Forbidden: User does not have permission to archive events." };
  }

  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, createdBy: true },
  });
  if (!existing) return { success: false, message: "Event not found." };

  if (!isAdmin && isOrganizer && existing.createdBy !== clerkId) {
    return { success: false, message: "Forbidden: You can only archive your own events." };
  }

  try {
    await prisma.event.update({
      where: { id: eventId },
      data: { archivedAt: new Date() },
    });
    revalidatePath("/organizer");
    revalidatePath("/admin");
    revalidatePath("/");
    return { success: true, message: "Event archived successfully." };
  } catch (error) {
    console.error("Error archiving event:", error);
    return { success: false, message: "Database error: Failed to archive event." };
  }
}
