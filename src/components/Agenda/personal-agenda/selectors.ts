import { addDays, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import type { EventWithCreatorAndRsvps } from '@/types/event';

const GROUP_MAX_ITEMS = 3;

export type PersonalAgendaGroups = {
  upNext: EventWithCreatorAndRsvps | null;
  todayItems: EventWithCreatorAndRsvps[];
  thisWeekItems: EventWithCreatorAndRsvps[];
  laterItems: EventWithCreatorAndRsvps[];
  cues: string[];
};

function toViewerStartOfDay(value: Date | string, viewerTz: string): Date {
  return startOfDay(toZonedTime(new Date(value), viewerTz));
}

function pickTopItems(items: EventWithCreatorAndRsvps[]): EventWithCreatorAndRsvps[] {
  return items.slice(0, GROUP_MAX_ITEMS);
}

function buildPlanningCues(
  upNext: EventWithCreatorAndRsvps | null,
  todayCount: number,
  thisWeekCount: number,
  now: Date
): string[] {
  const cues: string[] = [];

  if (upNext) {
    const myRsvp = upNext.rsvps?.[0];
    const hasReminder = Boolean(myRsvp?.reminderScheduledAt);
    const msUntilStart = new Date(upNext.date).getTime() - now.getTime();
    const hoursUntilStart = msUntilStart / 3_600_000;

    if (!hasReminder) {
      cues.push('No reminder is set for your next event.');
    } else {
      cues.push('Your next event has a reminder scheduled.');
    }

    if (hoursUntilStart > 0 && hoursUntilStart <= 24) {
      cues.push('Your next event starts within 24 hours.');
    } else if (hoursUntilStart > 24 && hoursUntilStart <= 48) {
      cues.push('Your next event starts within 48 hours.');
    }
  }

  const weekTotal = todayCount + thisWeekCount;
  if (weekTotal >= 2) {
    cues.push(`You have ${weekTotal} events over the next 7 days.`);
  } else if (weekTotal === 1) {
    cues.push('You have one event planned over the next 7 days.');
  }

  if (cues.length === 0) {
    cues.push('Your agenda is calm right now.');
  }

  return cues.slice(0, 3);
}

export function derivePersonalAgendaGroups(
  events: EventWithCreatorAndRsvps[],
  viewerTz: string,
  now: Date = new Date()
): PersonalAgendaGroups {
  const sorted = [...events].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const upNext = sorted[0] ?? null;

  const todayStart = toViewerStartOfDay(now, viewerTz);
  const tomorrowStart = addDays(todayStart, 1);
  const weekEnd = addDays(todayStart, 7);

  const todayItems: EventWithCreatorAndRsvps[] = [];
  const thisWeekItems: EventWithCreatorAndRsvps[] = [];
  const laterItems: EventWithCreatorAndRsvps[] = [];

  for (const event of sorted) {
    const eventDay = toViewerStartOfDay(event.date, viewerTz);
    if (eventDay.getTime() < tomorrowStart.getTime()) {
      todayItems.push(event);
      continue;
    }
    if (eventDay.getTime() < weekEnd.getTime()) {
      thisWeekItems.push(event);
      continue;
    }
    laterItems.push(event);
  }

  return {
    upNext,
    todayItems: pickTopItems(todayItems),
    thisWeekItems: pickTopItems(thisWeekItems),
    laterItems: pickTopItems(laterItems),
    cues: buildPlanningCues(upNext, todayItems.length, thisWeekItems.length, now),
  };
}

