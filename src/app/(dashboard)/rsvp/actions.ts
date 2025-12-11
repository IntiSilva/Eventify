'use server'

import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import type { ReminderType } from "@/generated/prisma"
import { RSVPStatus } from "@/generated/prisma"
import type { ToggleRsvpResult, UpdatedEventMinimal, ReminderPatch } from "@/types/rsvp";
import { calcReminderUTC } from "@/lib/reminders"
import { computeAutoFeatured } from "@/lib/constants"



// =================================================================
// ** HELPERS **
// =================================================================


// Recalculates confirmed count and updates `featured` in the DB.
//  Returns the minimal info the client needs to reconcile.
async function updateEventFeaturedAndCount(eventId: string): Promise<{ updatedEvent: UpdatedEventMinimal }> {
  const base = await prisma.event.findUnique({
    where: { id: eventId },
    select: { featured: true },
  });

  const confirmedCount = await prisma.rSVP.count({
    where: { eventId, status: RSVPStatus.confirmed },
  });

  const nextFeatured = computeAutoFeatured(confirmedCount);

  let updated: { id: string; featured: boolean; };
  if (base && base.featured === nextFeatured) {
    // no-op: already correct, skip UPDATE
    updated = { id: eventId, featured: base.featured };
  } else {
    updated = await prisma.event.update({
      where: { id: eventId },
      data: { featured: nextFeatured },
      select: { id: true, featured: true },
    });
  }

  return {
    updatedEvent: {
      ...updated,
      attendeesConfirmedCount: confirmedCount, // “extra” field for the UI
    },
  };
}



/**
 * Toggles the RSVP status for a user on a specific event.
 * If the user has an existing RSVP, it's removed (cancelled).
 * If not, a new 'confirmed' RSVP is created.
 * @param eventId The ID of the event to RSVP to.
 * @returns An object with the operation's result.
 */
export async function toggleRSVP(eventId: string): Promise<ToggleRsvpResult> {
    const { userId } = await auth();
    if (!userId) throw new Error('Unauthorized');

    // Look for an existing RSVP for this user and event.
    const existingRSVP = await prisma.rSVP.findUnique({
        where: {
            userId_eventId: {
                userId,
                eventId,
            },
        },
    });

    let result: ToggleRsvpResult;

    if (existingRSVP) {
        // If it exists, delete it (toggle off).
        await prisma.rSVP.delete({
            where: {
                userId_eventId: {
                    userId,
                    eventId,
                },
            },
        });

        console.log(`User ${userId} removed RSVP from event ${eventId}`);
        const { updatedEvent } = await updateEventFeaturedAndCount(eventId);

        // KEY CHANGE: Prepare a clear cancellation response.
        result = {
            success: true,
            action: "cancelled",
            message: "Attendance successfully cancelled.",
            rsvpCancelled: true,
            userId,
            updatedEvent, // Include updated event info
        };

    } else {
        // --- If it does not exist, create it ---
        const newRsvp = await prisma.rSVP.create({
            data: {
                userId,
                eventId,
                status: RSVPStatus.confirmed,
            },
            // IMPROVEMENT: Immediately include user data in the response.
            include: {
                user: {
                    select: {
                        clerkId: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        imageUrl: true,
                        hasImage: true,
                        role: true, // ← include 'role' for UserProfileForAvatar
                    }
                }
            }
        });

        console.log(`User ${userId} RSVP'd to event ${eventId}`);
        const { updatedEvent } = await updateEventFeaturedAndCount(eventId);

        // KEY CHANGE: Prepare the response with the new RSVP object.
        result = {
            success: true,
            action: "created",
            message: "Successfully confirmed attendance!",
            newRsvp: newRsvp,
            updatedEvent
        };
    }

    return result;
}

// Interface for the reminder input data.
interface ReminderInput {
    preferenceType: ReminderType; // e.g., FORTY_EIGHT_HOURS, SAME_DAY, MINUTES_BEFORE
    offsetMinutes: number;        // The exact offset in minutes before the event.
                                  // e.g., 48h = 2880, 4h = 240, 45m = 45
}

/**
 * Successful responses **must** include `updatedRsvp`.
 * Failure responses carry only a message.
 */
export type ReminderResult =
  | { success: true;  message: string; updatedRsvp: ReminderPatch }
  | { success: false; message: string };

/**
 * --- NEW SERVER ACTION ---
 * Updates or clears the reminder preference for a user's RSVP.
 * @param eventId The ID of the event.
 * @param reminderDetails An object with reminder preferences, or null to clear them.
 * @returns An object with the operation's result.
 */
export async function updateReminderPreference(
        eventId: string,
         reminderDetails: ReminderInput | null
        ): Promise<ReminderResult> {
    const { userId } = await auth();
    if (!userId) {
        console.error("Error: Unauthenticated user trying to update reminder preferences.");
        return { success: false, message: 'Unauthorized. Please sign in to update preferences.' };
    }

    try {
       /* ------------------------------------------------------------------
        * 1) Find RSVP with only the necessary fields
        * ------------------------------------------------------------------ */
        const rsvp = await prisma.rSVP.findUnique({
            where: { userId_eventId: { userId, eventId } },
            select: {
                id: true,
                status: true,
                reminderPreferenceType: true,
                reminderOffsetMinutes:  true,
                reminderScheduledAt:    true,
                reminderSentAt:         true,
                event: { select: { date: true, eventTimeZone: true } }, // only to calculate scheduledAt
            },
        });

        if (!rsvp) {
            console.warn(`RSVP not found for user ${userId}, event ${eventId} when setting reminder preference.`);
            return { success: false, message: "RSVP not found. Please RSVP to the event first." };
        }

        if (rsvp.status !== RSVPStatus.confirmed) {
            console.warn(`User ${userId} tried to set reminder for non-confirmed RSVP. Event: ${eventId}, Status: ${rsvp.status}`);
            return { success: false, message: "Reminders can only be set for confirmed RSVPs." };
        }

        const eventDate = new Date(rsvp.event.date); // Event date (assuming it's stored in UTC).
        const now = new Date();

        // If the user chooses "No reminders" (reminderDetails is null).
        if (reminderDetails === null) {
            const cleared = await prisma.rSVP.update({
                where: { id: rsvp.id },
                data: {
                    reminderPreferenceType: null,
                    reminderOffsetMinutes:  null,
                    reminderScheduledAt:    null,
                    reminderSentAt:         null,
                },
                select: { // same as above
                    status: true,
                    reminderPreferenceType: true,
                    reminderOffsetMinutes:  true,
                    reminderScheduledAt:    true,
                    reminderSentAt:         true,
                },
            });

            const patch: ReminderPatch = {
                userClerkId: userId,
                status: cleared.status,
                reminderPreferenceType: null,
                reminderOffsetMinutes:  null,
                reminderScheduledAt:    null,
                reminderSentAt:         null,
            };
            console.log(`User ${userId} opted out of reminders for event ${eventId}.`);
            return {
                success: true,
                message: "Reminder preference cleared successfully.",
                updatedRsvp: patch,
            };
        }

        // If the user chooses a specific reminder preference.
        const { preferenceType, offsetMinutes } = reminderDetails;
        
        // Ensure the offset is a positive number.
        if (offsetMinutes <= 0) {
            console.warn(`Invalid offsetMinutes: ${offsetMinutes} for event ${eventId}, user ${userId}.`);
            return { success: false, message: "Reminder time must be before the event."}
        }

        // Calculate the exact time the reminder should be sent.
        const calculatedScheduledAt = calcReminderUTC(
            eventDate,                         // UTC
            rsvp.event.eventTimeZone,          // event's own timezone
            preferenceType as ReminderType,
            offsetMinutes
        );

        // Validation: The calculated reminder time must not be in the past.
        // We give a small margin (e.g., 1 minute) for potential small delays.
        if (calculatedScheduledAt.getTime() < now.getTime() - 60 * 1000) {
            console.warn(`Calculated reminder time is in the past. Event: ${eventId}, User: ${userId}, Scheduled: ${calculatedScheduledAt.toISOString()}, Now: ${now.toISOString()}`);
            return { success: false, message: "Cannot schedule a reminder for a time that has already passed. Please choose a valid option." };
        }

        // Update the RSVP record with the new reminder details.
        const updated = await prisma.rSVP.update({
            where: { id: rsvp.id },
            data: {
                reminderPreferenceType: preferenceType,
                reminderOffsetMinutes:  offsetMinutes,
                reminderScheduledAt:    calculatedScheduledAt,
                reminderSentAt:         null,
            },
            select: { // only reminder and status fields
                status: true,
                reminderPreferenceType: true,
                reminderOffsetMinutes:  true,
                reminderScheduledAt:    true,
                reminderSentAt:         true,
            },
        });

        const patch: ReminderPatch = {
            userClerkId: userId,
            status: updated.status,
            reminderPreferenceType: updated.reminderPreferenceType,
            reminderOffsetMinutes:  updated.reminderOffsetMinutes,
            reminderScheduledAt:    updated.reminderScheduledAt,
            reminderSentAt:         updated.reminderSentAt,
        };

        console.log(`User ${userId} set reminder for event ${eventId}: Type: ${preferenceType}, Offset: ${offsetMinutes}m, Scheduled: ${calculatedScheduledAt.toISOString()}`);

        return {
            success: true,
            message: `Reminder scheduled! We'll notify you approx. ${formatOffset(offsetMinutes)} before the event.`,
            updatedRsvp: patch, // Return the updated RSVP patch
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to update reminder preference.";
        console.error(`Error updating reminder preference for user ${userId}, event ${eventId}:`, errorMessage, error);
        return { success: false, message: "Failed to update reminder preference." };
    }
}

/**
 * Helper function to format the offset in minutes into a user-friendly string.
 * @param offsetMinutes The offset in minutes.
 * @returns A formatted string (e.g., "2 days", "4 hours", "30 minutes").
 */
function formatOffset(offsetMinutes: number): string {
    if (offsetMinutes >= 60 * 24 * 2) { // 2 days or more
        return `${Math.round(offsetMinutes / (60 * 24))} days`;
    } else if (offsetMinutes >= 60 * 24) { // 1 day
        return `1 day`;
    } else if (offsetMinutes >= 60) { // Hours
        const hours = Math.floor(offsetMinutes / 60);
        const minutes = offsetMinutes % 60;
        if (minutes === 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
        return `${hours}h ${minutes}min`;
    } else { // Minutes
        return `${offsetMinutes} minutes`;
    }
}
