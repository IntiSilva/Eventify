import type { Prisma, User, RSVP, RSVPStatus, ReminderType, Event } from "@/generated/prisma";

/** Minimal user shape used everywhere we show avatars. */
export type UserProfileForAvatar = Pick<
  User,
  "clerkId" | "username" | "firstName" | "lastName" | "imageUrl" | "hasImage" | "role"
>;

/**
 * RSVP as returned by prisma.rSVP.create(...) in your toggle action,
 * including a minimal user payload for UI.
 *
 * Keep the 'include.user.select' in the action in sync with this type.
 */
export type RSVPWithUser = Prisma.RSVPGetPayload<{
  include: {
    user: {
      select: {
        clerkId: true;
        username: true;
        firstName: true;
        lastName: true;
        imageUrl: true;
        hasImage: true;
        role: true;
      };
    };
  };
}>;

/**
 * If you also keep an "event view" with a smaller RSVP item
 * (same idea you use in EventWithCreatorAndRsvps), keep a dedicated type.
 */
export type RsvpItemForEvent = Pick<
  RSVP,
  | "status"
  | "reminderPreferenceType"
  | "reminderOffsetMinutes"
  | "reminderScheduledAt"
  | "reminderSentAt"
> & { user: UserProfileForAvatar };



/**
 * Patch that updates only the “reminder” fields of the logged-in user’s RSVP.
 * This is the object returned by the server action
 * `updateReminderPreference`, which is then passed to patchEventEverywhere.
 */
export type ReminderPatch = {
  userClerkId: string;                    // identifies the RSVP that should change
  status: RSVPStatus;                     // usually “confirmed”; optional but useful
  reminderPreferenceType: ReminderType | null;
  reminderOffsetMinutes:  number | null;
  reminderScheduledAt:    Date | null;
  reminderSentAt:         Date | null;
};





export type UpdatedEventMinimal = Pick<Event, 'id' | 'featured'> & {
  /** Calculated Field (doesnt belong to Event prisma model) */
  attendeesConfirmedCount: number;
};

export type ToggleRsvpResult =
  | { success: true; action: "created"; message: string; newRsvp: RSVPWithUser; updatedEvent: UpdatedEventMinimal }
  | { success: true; action: "cancelled"; message: string; rsvpCancelled: true; userId: string; updatedEvent: UpdatedEventMinimal }
  | { success: true; action: "payment_required"; message: string; eventId: string; isPaid: true }
  | { success: true; action: "reactivated"; message: string; userId: string; updatedEvent: UpdatedEventMinimal }
  | { success: false; message: string };