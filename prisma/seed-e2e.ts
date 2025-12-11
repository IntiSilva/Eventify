import { addMinutes } from 'date-fns';
import {
  PrismaClient,
  UserRole,
  RSVPStatus,
  ReminderType,
} from '../src/generated/prisma';
import { normalizeUsername } from '../src/lib/utils';

const prisma = new PrismaClient();

type TzParts = { year: number; month: number; day: number; hour: number; minute: number };

function zonedParts(date: Date, timeZone: string): TzParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

function localKeys(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  const eventLocalDateKey = p.year * 10_000 + p.month * 100 + p.day;
  const eventLocalMinuteOfDay = p.hour * 60 + p.minute;
  return { eventLocalDateKey, eventLocalMinuteOfDay };
}

async function main() {
  console.log('⚙️  Resetting + seeding E2E data…');

  // --- Date & timezone constants
  const TZ = 'America/Argentina/Buenos_Aires';
  const now = new Date();

  const soon = addMinutes(now, 180); // ~3h from now: useful for reminders/validations
  const reminderSoon = addMinutes(now, 10); // ~10 min: triggers "too close to set a reminder"
  const future = addMinutes(now, 60 * 24 * 10); // ~10 days
  const featuredFuture = addMinutes(now, 60 * 24 * 7); // ~1 week

  // --- Base users
  const users = [
    { clerkId: 'e2e_admin',     email: 'e2e_admin@example.com',     username: 'e2e_admin',     role: UserRole.admin,     phone: '+5491144325353' },
    { clerkId: 'e2e_organizer', email: 'e2e_organizer@example.com', username: 'e2e_organizer', role: UserRole.organizer, phone: '+5491144335353' },
    { clerkId: 'e2e_user',      email: 'e2e_user@example.com',      username: 'e2e_user',      role: UserRole.user,      phone: null },
    // “fresh” simulates a newly created user coming from the webhook (no phone, default user role)
    { clerkId: 'e2e_fresh',     email: 'e2e_fresh@example.com',     username: 'fresh',         role: UserRole.user,      phone: null },
    // Extra users used to reach RSVP thresholds in tests
    { clerkId: 'e2e_user2',     email: 'e2e_user2@example.com',     username: 'user2',         role: UserRole.user,      phone: null },
    { clerkId: 'e2e_user3',     email: 'e2e_user3@example.com',     username: 'user3',         role: UserRole.user,      phone: null },
    { clerkId: 'e2e_user4',     email: 'e2e_user4@example.com',     username: 'user4',         role: UserRole.user,      phone: null },
  ] as const;

  for (const u of users) {
    await prisma.user.upsert({
      where: { clerkId: u.clerkId },
      create: {
        clerkId: u.clerkId,
        email: u.email,
        username: u.username,
        normalizedUsername: normalizeUsername(u.username),
        role: u.role,
        phoneNumber: u.phone,
        firstName: u.username,
        lastName: 'test',
        imageUrl: null,
        hasImage: false,
      },
      update: {
        email: u.email,
        username: u.username,
        normalizedUsername: normalizeUsername(u.username),
        role: u.role,
        phoneNumber: u.phone,
      },
    });
  }

  // --- Events
  const mkEvent = async (opts: {
    title: string;
    date: Date;
    category: 'music' | 'tech' | 'art' | 'sports';
    location: string;
    createdByClerkId: string;
    featured?: boolean;
    featuredByAdmin?: boolean;
    contactEmail?: string | null;
    contactPhone?: string | null;
  }) => {
    const { eventLocalDateKey, eventLocalMinuteOfDay } = localKeys(opts.date, TZ);
    return prisma.event.create({
      data: {
        title: opts.title,
        normalizedTitle: opts.title.toLowerCase(),
        description: `E2E seed: ${opts.title}`,
        date: opts.date,
        eventTimeZone: TZ,
        eventLocalDateKey,
        eventLocalMinuteOfDay,
        location: opts.location,
        normalizedLocation: opts.location.toLowerCase(),
        category: opts.category,
        featured: !!opts.featured,
        featuredByAdmin: !!opts.featuredByAdmin,
        createdBy: opts.createdByClerkId,
        contactEmail: opts.contactEmail ?? 'contact@example.com',
        contactPhone: opts.contactPhone ?? null,
      },
    });
  };

  const eventSoon = await mkEvent({
    title: 'E2E Soon Event',
    date: soon,
    category: 'tech',
    location: 'Buenos Aires',
    createdByClerkId: 'e2e_organizer',
    featured: false,
  });

  const reminderSoonEvent = await mkEvent({
    title: 'E2E Reminder Soon Event',
    date: reminderSoon,
    category: 'tech',
    location: 'Buenos Aires',
    createdByClerkId: 'e2e_organizer',
    featured: false,
  });

  const futureEvents = await Promise.all(
    Array.from({ length: 10 }, (_, i) => {
      const title =
        i === 0 ? 'E2E Future Event' : `E2E Future Event ${i + 1}`;

      return mkEvent({
        title,
        // spaced 1h apart starting at `future` (~10 days from now)
        date: addMinutes(future, i * 60),
        category: i % 2 === 0 ? 'music' : 'tech',
        location: i % 2 === 0 ? 'CABA' : 'Buenos Aires',
        createdByClerkId: 'e2e_organizer',
        featured: false,
      });
    }),
  );

  // We use the first one as the "main" event for RSVP threshold / Agenda tests
  const mainFutureEvent = futureEvents[0];

  const eventFeatured = await mkEvent({
    title: 'E2E Already Featured',
    date: featuredFuture,
    category: 'art',
    location: 'La Plata',
    createdByClerkId: 'e2e_organizer',
    featured: true,
    featuredByAdmin: true,
  });

  const kiritimatiTz = 'Pacific/Kiritimati';

  // Special event used by the Menu timezone-toggle E2E test.
  // - Date: ~10 days + 1h from now (based on `future`).
  // - Event timezone is very different from the base viewer timezone,
  //   so `showTzToggle` will be true in the UI.
  const tzMenuEventDate = addMinutes(future, 60);

  const {
    eventLocalDateKey: tzLocalDateKey,
    eventLocalMinuteOfDay: tzLocalMinuteOfDay,
  } = localKeys(tzMenuEventDate, kiritimatiTz);

  await prisma.event.create({
    data: {
      title: 'E2E TZ Menu Event',
      normalizedTitle: 'e2e tz menu event',
      description: 'E2E seed: E2E TZ Menu Event',
      date: tzMenuEventDate,
      eventTimeZone: kiritimatiTz,
      eventLocalDateKey: tzLocalDateKey,
      eventLocalMinuteOfDay: tzLocalMinuteOfDay,
      location: 'Kiritimati',
      normalizedLocation: 'kiritimati',
      category: 'music',
      featured: false,
      featuredByAdmin: false,
      createdBy: 'e2e_organizer',
      contactEmail: 'contact@example.com',
      contactPhone: null,
    },
  });

  // --- RSVPs (threshold + agenda scenarios)
  const rsvps: Array<{ userId: string; eventId: string; status: RSVPStatus }> = [
    { userId: 'e2e_user',  eventId: mainFutureEvent.id,  status: RSVPStatus.confirmed },
    { userId: 'e2e_user2', eventId: mainFutureEvent.id,  status: RSVPStatus.confirmed },
    { userId: 'e2e_user3', eventId: mainFutureEvent.id,  status: RSVPStatus.confirmed },
    { userId: 'e2e_user4', eventId: mainFutureEvent.id,  status: RSVPStatus.confirmed },

    { userId: 'e2e_user',  eventId: eventFeatured.id,  status: RSVPStatus.confirmed },
    { userId: 'e2e_user2', eventId: eventFeatured.id,  status: RSVPStatus.confirmed },
    { userId: 'e2e_user3', eventId: eventFeatured.id,  status: RSVPStatus.confirmed },
    { userId: 'e2e_user4', eventId: eventFeatured.id,  status: RSVPStatus.confirmed },

    { userId: 'e2e_user',  eventId: eventSoon.id,    status: RSVPStatus.confirmed },
    { userId: 'e2e_user2', eventId: eventSoon.id,    status: RSVPStatus.pending },

    { userId: 'e2e_user',  eventId: reminderSoonEvent.id,   status: RSVPStatus.confirmed },
  ];

  for (const r of rsvps) {
    await prisma.rSVP.upsert({
      where: { userId_eventId: { userId: r.userId, eventId: r.eventId } },
      create: {
        userId: r.userId,
        eventId: r.eventId,
        status: r.status,
        reminderPreferenceType: ReminderType.FORTY_EIGHT_HOURS,
        reminderOffsetMinutes: 2880,
      },
      update: {
        status: r.status,
      },
    });
  }

  console.log('✅ E2E seed completed.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
