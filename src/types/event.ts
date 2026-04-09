import type { Event, User, RSVP, UserRole } from "@/generated/prisma";

export type UserProfileForAvatar = Pick<
  User,
  'clerkId' | 'username' | 'firstName' | 'lastName' | 'imageUrl' | 'hasImage' | 'role'
> &
  Partial<
    Pick<
      User,
      | 'stripeConnectAccountId'
      | 'stripeConnectPayoutsEnabled'
      | 'stripeConnectChargesEnabled'
      | 'stripeConnectDetailsSubmitted'
    >
  >;

export type EventWithCreatorAndRsvps = Event & {
    creator: UserProfileForAvatar;
    rsvps: (Pick<RSVP,
         'status' |
         'reminderPreferenceType' |
         'reminderOffsetMinutes' |
         'reminderScheduledAt' |
         'reminderSentAt'> &
         Partial<Pick<RSVP, 'attendanceEntitlementStatus'>> &
         {user: UserProfileForAvatar } ) []
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
  | "isPaid"
  | "priceCents"
  | "currency"
> & {
  creator?: UserProfileForAvatar | null;
};



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

// Lightweight event shape used by the checkout client
export type CheckoutEventForClient = Pick<
  Event,
  | 'id'
  | 'title'
  | 'description'
  | 'date'
  | 'location'
  | 'category'
  | 'eventTimeZone'
  | 'contactEmail'
  | 'contactPhone'
  | 'contactPhoneApps'
  | 'isPaid'
  | 'priceCents'
  | 'currency'
> & {
  creator: UserProfileForAvatar | null;
};
