import { z } from "zod";
import { startOfDay, addYears, addHours, isToday } from "date-fns";
import { isValidPhoneNumber } from "react-phone-number-input/min";
import { EventCategory, ContactPhoneApps } from "@/generated/prisma";

/**
 * UI form schemas for Create/Edit flows (RHF + client-side UX validation).
 * Server actions remain the source of truth for serialized payload validation
 * and business rules (pricing lock, payment-state restrictions, etc.).
 */

/** Base object with fields common to Create and Edit (NO superRefine here) */
const eventBase = z.object({
  title: z.string().trim().min(1, "Title is required").max(60, "Title cannot exceed 60 characters"),
  description: z.string().trim().min(1, "Description is required").max(5000, "Description cannot exceed 5000 characters"),
  location: z.string().trim().min(1, "Location is required").max(255, "Location cannot exceed 255 characters"),
  category: z.nativeEnum(EventCategory, { required_error: "Category is required" }),
  /** Viewer time zone handling */
  tzMode: z.enum(["auto", "manual"]),
  eventTimeZone: z.string().optional(),
  /** Contact info (at least one valid method is required) */
  contactEmail: z.string().trim().optional(),
  contactPhone: z.string().trim().optional(),
  contactPhoneApps: z.nativeEnum(ContactPhoneApps).optional(),
  useProfilePhone: z.boolean(),
  /** Paid event: form stores amount in major units (string); server gets priceCents */
  isPaid: z.boolean(),
  priceAmount: z.string().optional(),
  currency: z.string().optional(),
});

/** Values derived from the base schema */
type EventBaseValues = z.infer<typeof eventBase>;

/**
 * Cross-field refine used by both Create and Edit schemas.
 * Typed to the base shape; extended schemas (Create/Edit) are subtypes.
 */
function baseRefine(data: EventBaseValues, ctx: z.RefinementCtx): void {
  const email = data.contactEmail ?? "";
  const phone = data.contactPhone ?? "";

  // Validate email if present
  let okEmail = false;
  if (email) {
    if (!z.string().email().safeParse(email).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid email format.",
        path: ["contactEmail"],
      });
    } else {
      okEmail = true;
    }
  }

  // Validate phone if present (requires country code, e.g. +54...)
  let okPhone = false;
  if (phone) {
    if (!isValidPhoneNumber(phone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid phone number format. Please include country code (e.g., +54...).",
        path: ["contactPhone"],
      });
    } else {
      okPhone = true;
    }
  }

  // Require at least one valid contact method
  if (!okEmail && !okPhone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide at least one valid contact method (email or phone).",
      path: ["contactEmail"],
    });
  }

  // If phone is valid, contactPhoneApps must be provided
  if (okPhone && !data.contactPhoneApps) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Select how people will contact you by phone (WhatsApp, Telegram, or Both).",
      path: ["contactPhoneApps"],
    });
  }

  // If user chooses manual TZ, eventTimeZone must be set
  if (data.tzMode === "manual" && !data.eventTimeZone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Select a time zone.",
      path: ["eventTimeZone"],
    });
  }

  // Paid event: require amount > 0 and currency (3-letter code)
  if (data.isPaid) {
    const amount = (data.priceAmount ?? "").trim();
    const num = Number(amount);
    if (amount === "" || Number.isNaN(num) || num <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid price greater than 0.",
        path: ["priceAmount"],
      });
    }
    const curr = (data.currency ?? "").trim();
    if (curr.length !== 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a currency.",
        path: ["currency"],
      });
    }
  }
}

/**
 * Create schema:
 * - Not in the past
 * - If it's today, at least +4 hours from now
 */
export const createEventSchema = eventBase
  .extend({
    date: z
      .date({ required_error: "Date and time are required" })
      .min(startOfDay(new Date()), { message: "Event date cannot be in the past." })
      .refine((d) => !isToday(d) || d.getTime() >= addHours(new Date(), 4).getTime(), {
        message: "If the event is today, it must be at least 4 hours from now.",
      }),
  })
  .superRefine(baseRefine);

/**
 * Edit schema:
 * - Not in the past
 * - No more than 2 years into the future
 */
export const editEventSchema = eventBase
  .extend({
    date: z
      .date({ required_error: "Date is required" })
      .min(startOfDay(new Date()), { message: "Event date cannot be in the past." })
      .max(addYears(startOfDay(new Date()), 2), { message: "Event cannot be more than 2 years in the future." }),
  })
  .superRefine(baseRefine);

/** Form values */
export type CreateEventValues = z.infer<typeof createEventSchema>;
export type EditEventValues = z.infer<typeof editEventSchema>;

// Serialized action payload types live in `@/types/eventPayloads`.
