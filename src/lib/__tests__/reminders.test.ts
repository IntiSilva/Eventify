// reminders.test.ts
// Vitest unit tests for src/lib/reminders.ts helpers.
// Notes:
// - We freeze time with vi.useFakeTimers() per test and always restore real timers in afterEach.
// - Times are carefully chosen to reflect America/New_York (EST on 2025-03-01).
// - We assert both absolute and relative wording windows.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { calcReminderUTC, getEventTimeContext } from '../reminders';
import type { ReminderType } from '@/generated/prisma';

// Event happens at 2025-03-01T16:00:00.000Z (which is 11:00 AM local in New York, still EST on that date)
const EVENT_TZ = 'America/New_York';
const EVENT_DATE_UTC = new Date('2025-03-01T16:00:00.000Z');

// Human-readable absolute time label in the event timezone (en-US, HH:MM AM/PM)
const ABSOLUTE_LABEL = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: EVENT_TZ,
}).format(EVENT_DATE_UTC);

// Helper to call calcReminderUTC with a compact signature
const reminder = (type: ReminderType, offsetMin?: number) =>
  calcReminderUTC(EVENT_DATE_UTC, EVENT_TZ, type, offsetMin).toISOString();

describe('calcReminderUTC', () => {
  it('returns expected UTC timestamps for reminder offsets', () => {
    // 48 hours before the event time
    expect(reminder('FORTY_EIGHT_HOURS')).toBe('2025-02-27T16:00:00.000Z');

    // Same day reminder = 4 hours before the event time
    expect(reminder('SAME_DAY')).toBe('2025-03-01T12:00:00.000Z');

    // Minutes before = N minutes before the event time
    expect(reminder('MINUTES_BEFORE', 30)).toBe('2025-03-01T15:30:00.000Z');
  });
});

describe('getEventTimeContext', () => {
  // Always restore real timers
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses relative language when within the configurable window', () => {
    // Window rule: relative if 0 < diff <= (offsetMin + 15)
    // Here: offset 45 → window top = 60 min. Now is 30 min before → relative.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-01T15:30:00.000Z')); // 10:30 AM local (30 min before)
    expect(getEventTimeContext(EVENT_DATE_UTC, 45, EVENT_TZ)).toBe('in approximately 30 min');
  });

  it('falls back to absolute time outside the reminder window', () => {
    // Well outside the (offset + 15) window
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-02-28T15:30:00.000Z'));
    expect(getEventTimeContext(EVENT_DATE_UTC, 45, EVENT_TZ)).toBe(`at ${ABSOLUTE_LABEL}`);
  });

  it('formats the event time when the reminder offset is null', () => {
    // No offset configured → always absolute
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-01T10:00:00.000Z'));
    expect(getEventTimeContext(EVENT_DATE_UTC, null, EVENT_TZ)).toBe(`at ${ABSOLUTE_LABEL}`);
  });

  // ------------------------------
  // Additional edge/boundary cases
  // ------------------------------

  it('treats exactly (offset + 15) minutes before as relative ("~1 h")', () => {
    // offset = 45 → window top = 60. Exactly 60 min before should still be relative.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-01T15:00:00.000Z')); // 10:00 AM local (60 min before)
    expect(getEventTimeContext(EVENT_DATE_UTC, 45, EVENT_TZ)).toBe('in approximately 1 h');
  });

  it('falls back to absolute just above the window (> offset + 15)', () => {
    // 61 minutes before → outside the window → absolute
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-01T14:59:00.000Z')); // 9:59 AM local (61 min before)
    expect(getEventTimeContext(EVENT_DATE_UTC, 45, EVENT_TZ)).toBe(`at ${ABSOLUTE_LABEL}`);
  });

  it('formats "~H h" when minutes < 5 (e.g., 1 h 4 min)', () => {
    // 64 minutes before with a large window (offset = 120 → top = 135) → relative
    // Minutes leftover < 5 → only hours
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-01T14:56:00.000Z')); // 9:56 AM local (1 h 4 min before)
    expect(getEventTimeContext(EVENT_DATE_UTC, 120, EVENT_TZ)).toBe('in approximately 1 h');
  });

  it('includes minutes when minutes ≥ 5 (e.g., 1 h 5 min)', () => {
    // 65 minutes before with a large window (offset = 120) → relative
    // Minutes leftover ≥ 5 → include minutes
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-01T14:55:00.000Z')); // 9:55 AM local (1 h 5 min before)
    expect(getEventTimeContext(EVENT_DATE_UTC, 120, EVENT_TZ)).toBe('in approximately 1 h 5 min');
  });
});
