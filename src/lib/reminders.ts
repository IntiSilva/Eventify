import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { subHours, addMinutes } from "date-fns";
import { ReminderType } from "@/generated/prisma";

/** Returns when (UTC) the reminder should fire */
export function calcReminderUTC(
  eventDateUTC: Date,
  eventTz: string,
  pref: ReminderType,
  offsetMin?: number
) {
  const local = toZonedTime(eventDateUTC, eventTz);          // step 1
  let localReminder: Date;

  switch (pref) {
    case "FORTY_EIGHT_HOURS":
      localReminder = subHours(local, 48);
      break;
    case "SAME_DAY":
      localReminder = subHours(local, 4);
      break;
    case "MINUTES_BEFORE":
      localReminder = addMinutes(local, -(offsetMin ?? 0));
      break;
  }

  return fromZonedTime(localReminder, eventTz);              // step 2 → UTC
}

/** Text like “in 45 min” or “at 7:00 PM” in the event’s time zone */
export function getEventTimeContext(
  eventDateUTC: Date,
  offsetMin: number | null,
  eventTz: string
) {
  const nowUTC   = new Date();
  const eventLocal = toZonedTime(eventDateUTC, eventTz);
  const nowLocal   = toZonedTime(nowUTC,       eventTz);

  if (offsetMin && offsetMin <= 24 * 60) {
    const diffMin = Math.round((eventLocal.getTime() - nowLocal.getTime()) / 60000);
    if (diffMin > 0 && diffMin <= offsetMin + 15) {
      if (diffMin < 60) return `in approximately ${diffMin} min`;
      const h = Math.floor(diffMin / 60);
      const m = diffMin % 60;
      return m < 5 ? `in approximately ${h} h` : `in approximately ${h} h ${m} min`;
    }
  }

  const label = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: eventTz,
  }).format(eventDateUTC);

  return `at ${label}`;
}
