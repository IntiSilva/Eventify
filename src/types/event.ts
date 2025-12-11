import type { Event, User, RSVP, UserRole } from "@/generated/prisma";

export type UserProfileForAvatar = Pick<User, 'clerkId' | 'username' | 'firstName' | 'lastName' | 'imageUrl' | 'hasImage' | 'role'>;

export type EventWithCreatorAndRsvps = Event & {
    creator: UserProfileForAvatar;
    rsvps: (Pick<RSVP,
         'status' |
         'reminderPreferenceType' |
         'reminderOffsetMinutes' |
         'reminderScheduledAt' |
         'reminderSentAt'> & {user: UserProfileForAvatar } ) []
}

export type EditableEvent = Pick<
  Event,
  | "id"
  | "title"
  | "description"
  | "date"
  | "location"
  | "category"
  | "featured"
  | "featuredByAdmin"
  | "contactEmail"
  | "contactPhone"
  | "contactPhoneApps"
  | "eventTimeZone"
>;


export type RolesForEvents = Extract<UserRole, 'admin' | 'organizer'>;

export type UserWithEvents = {
    clerkId: string;
    username: string;
    firstName?: string | null; 
    lastName?: string | null;
    imageUrl?: string | null;
    hasImage?: boolean | null;
    role: RolesForEvents
    createdEvents: EditableEvent[];
}