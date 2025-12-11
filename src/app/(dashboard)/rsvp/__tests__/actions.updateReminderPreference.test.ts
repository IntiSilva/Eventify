import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import type { RSVPStatus, ReminderType } from '@/generated/prisma';
import type { ReminderResult } from '@/app/(dashboard)/rsvp/actions';


/* ───────────────────── Utility guard ───────────────────── */

type SuccessResult = Extract<ReminderResult, { success: true }>;

function expectSuccess(res: ReminderResult): asserts res is SuccessResult {
  if (!res.success) {
    throw new Error(`Expected success=true but got false. Message: ${res.message}`);
  }
}


/* ───────────────────── Console spies ───────────────────── */

type VoidFn = (...args: unknown[]) => void;
type FnMock = MockInstance<VoidFn>;

let logSpy: FnMock | undefined;
let errSpy: FnMock | undefined;
let warnSpy: FnMock | undefined;

export const consoleFeed = {
  logs: [] as string[],
  errors: [] as string[],
  warns: [] as string[],
};

function joinArgs(args: unknown[]): string {
  return args
    .map((x) => {
      if (typeof x === 'string') return x;
      try {
        return JSON.stringify(x);
      } catch {
        return String(x);
      }
    })
    .join(' ');
}

export function dumpConsole(prefix = ''): void {
  for (const l of consoleFeed.logs) process.stdout.write(`${prefix}LOG: ${l}\n`);
  for (const w of consoleFeed.warns) process.stdout.write(`${prefix}WARN: ${w}\n`);
  for (const e of consoleFeed.errors) process.stdout.write(`${prefix}ERR: ${e}\n`);
}

/* ─────────────────────────── HOISTED FIXTURES ─────────────────────────── */

const h = vi.hoisted(() => {
  const NOW = new Date('2099-01-01T12:00:00.000Z');

  const EVENT = {
    id: 'evt_1',
    date: new Date('2099-01-03T15:00:00.000Z'),
    eventTimeZone: 'America/Argentina/Buenos_Aires',
  };

  const RSVP = {
    id: 'rsvp_1',
    userId: 'user_123',
    eventId: EVENT.id,
    status: 'confirmed' as RSVPStatus,
    reminderPreferenceType: null as ReminderType | null,
    reminderOffsetMinutes: null as number | null,
    reminderScheduledAt: null as Date | null,
    reminderSentAt: null as Date | null,
    event: EVENT,
  };

  // 48 h esperado (UTC): 2099-01-01T15:00:00.000Z (BA -03:00)
  const SCHED_48H = new Date('2099-01-01T15:00:00.000Z');
  const SCHED_30M = new Date('2099-01-03T14:30:00.000Z');
  const SCHED_PAST = new Date('2099-01-01T11:54:00.000Z');

  const FORMAT_48H = '48 hours';
  const FORMAT_30M = '30 minutes';

  return { NOW, EVENT, RSVP, SCHED_48H, SCHED_30M, SCHED_PAST, FORMAT_48H, FORMAT_30M };
});

/* ─────────────────────────── HOISTED MOCKS ─────────────────────────── */

const m = vi.hoisted(() => {
  type Auth = () => Promise<{ userId: string | null }>;
  const authMock = vi.fn<Auth>(() => Promise.resolve({ userId: 'user_123' }));

  type RsvpRecord = {
    id: string;
    userId: string;
    eventId: string;
    status: RSVPStatus;
    reminderPreferenceType: ReminderType | null;
    reminderOffsetMinutes: number | null;
    reminderScheduledAt: Date | null;
    reminderSentAt: Date | null;
    event: { id: string; date: Date; eventTimeZone: string };
  };

  const findUniqueMock = vi.fn<
    (args: {
      where:
        | { userId_eventId: { userId: string; eventId: string } }
        | { id?: string };
      include?: { event: true };
      select?: Record<string, unknown>;
    }) => Promise<RsvpRecord | null>
  >(() => Promise.resolve({ ...h.RSVP }));

  const updateMock = vi.fn<
    (args: {
      where: { id: string };
      data: {
        reminderPreferenceType: ReminderType | null;
        reminderOffsetMinutes: number | null;
        reminderScheduledAt: Date | null;
        reminderSentAt: Date | null;
      };
      select: {
        status: true;
        reminderPreferenceType: true;
        reminderOffsetMinutes: true;
        reminderScheduledAt: true;
        reminderSentAt: true;
      };
    }) => Promise<{
      status: RSVPStatus;
      reminderPreferenceType: ReminderType | null;
      reminderOffsetMinutes: number | null;
      reminderScheduledAt: Date | null;
      reminderSentAt: Date | null;
    }>
  >(async ({ data }) => ({
    status: 'confirmed' as RSVPStatus,
    reminderPreferenceType: data.reminderPreferenceType,
    reminderOffsetMinutes: data.reminderOffsetMinutes,
    reminderScheduledAt: data.reminderScheduledAt,
    reminderSentAt: data.reminderSentAt,
  }));

  const calcReminderUTCMock = vi.fn<
    (eventDateUTC: Date, eventTz: string, type: ReminderType, minutes: number) => Date
  >();

  const formatOffsetMock = vi.fn<(minutes: number) => string>();

  return { authMock, findUniqueMock, updateMock, calcReminderUTCMock, formatOffsetMock };
});

/* ───────────────────────────── Module mocks ───────────────────────────── */

vi.mock('@clerk/nextjs/server', () => ({
  auth: m.authMock,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rSVP: {
      findUnique: m.findUniqueMock,
      findFirst: m.findUniqueMock,
      update: m.updateMock,
    },
  },
}));

vi.mock('@/lib/reminders', () => ({
  calcReminderUTC: m.calcReminderUTCMock,
  formatOffset: m.formatOffsetMock,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/* ──────────────────────────────── SUT ──────────────────────────────── */
import { updateReminderPreference } from '@/app/(dashboard)/rsvp/actions';

/* ───────────────────────────── Utilities ───────────────────────────── */

function expectNoDbWrite() {
  expect(m.updateMock).not.toHaveBeenCalled();
}

/* ─────────────────────────────── Tests ─────────────────────────────── */

describe('rsvp/actions.updateReminderPreference', () => {
  beforeEach(() => {
    // Console spies + capture
    consoleFeed.logs.length = 0;
    consoleFeed.errors.length = 0;
    consoleFeed.warns.length = 0;

    logSpy = vi.spyOn(console, 'log') as unknown as FnMock;
    errSpy = vi.spyOn(console, 'error') as unknown as FnMock;
    warnSpy = vi.spyOn(console, 'warn') as unknown as FnMock;

    logSpy.mockImplementation((...args) => {
      consoleFeed.logs.push(joinArgs(args));
    });
    errSpy.mockImplementation((...args) => {
      consoleFeed.errors.push(joinArgs(args));
    });
    warnSpy.mockImplementation((...args) => {
      consoleFeed.warns.push(joinArgs(args));
    });

    // Clock
    vi.useFakeTimers();
    vi.setSystemTime(h.NOW);

    // Mocks reset
    m.authMock.mockResolvedValue({ userId: 'user_123' });
    m.findUniqueMock.mockResolvedValue({ ...h.RSVP });
    m.updateMock.mockClear();
    m.calcReminderUTCMock.mockReset();
    m.formatOffsetMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();

    logSpy?.mockRestore();
    errSpy?.mockRestore();
    warnSpy?.mockRestore();
    logSpy = undefined;
    errSpy = undefined;
    warnSpy = undefined;

    vi.clearAllMocks();
  });

  it('schedules a 48h reminder and updates RSVP', async () => {
    console.log('[48H] NOW:', h.NOW.toISOString());
    console.log('[48H] EVENT:', JSON.stringify(h.EVENT));
    console.log('[48H] EXPECTED SCHED_48H:', h.SCHED_48H.toISOString());

    const OFFSET_48H = 48 * 60;
    m.calcReminderUTCMock.mockReturnValue(h.SCHED_48H);
    m.formatOffsetMock.mockReturnValue(h.FORMAT_48H);

    const res = await updateReminderPreference(h.EVENT.id, {
      preferenceType: 'FORTY_EIGHT_HOURS',
      offsetMinutes: OFFSET_48H,
    });

    dumpConsole('[48H] ');

    expect(res.success).toBe(true);

    // Verify calc and write
    expect(m.calcReminderUTCMock).toHaveBeenCalledWith(
      h.EVENT.date,
      h.EVENT.eventTimeZone,
      'FORTY_EIGHT_HOURS',
      OFFSET_48H
    );

    expect(m.updateMock).toHaveBeenCalledTimes(1);
    const call = m.updateMock.mock.calls[0][0];
    expect(call.where.id).toBe(h.RSVP.id);
    expect(call.data).toMatchObject({
      reminderPreferenceType: 'FORTY_EIGHT_HOURS',
      reminderOffsetMinutes: OFFSET_48H,
      reminderSentAt: null,
    });
    expect(call.data.reminderScheduledAt).toBe(h.SCHED_48H);
  });

  it('schedules a minutes-before reminder (30m) and stores offset', async () => {
    m.calcReminderUTCMock.mockReturnValue(h.SCHED_30M);
    m.formatOffsetMock.mockReturnValue(h.FORMAT_30M);

    const res = await updateReminderPreference(h.EVENT.id, {
      preferenceType: 'MINUTES_BEFORE',
      offsetMinutes: 30,
    });

    expect(res.success).toBe(true);
    expect(m.calcReminderUTCMock).toHaveBeenCalledWith(
      h.EVENT.date,
      h.EVENT.eventTimeZone,
      'MINUTES_BEFORE',
      30
    );

    expect(m.updateMock).toHaveBeenCalledTimes(1);
    const call = m.updateMock.mock.calls[0][0];
    expect(call.data).toMatchObject({
      reminderPreferenceType: 'MINUTES_BEFORE',
      reminderOffsetMinutes: 30,
      reminderScheduledAt: h.SCHED_30M,
      reminderSentAt: null,
    });
  });

  it('rejects when calculated scheduled time is in the past (no DB write)', async () => {
    // We pass validation (offset > 0) and force a past date
    m.calcReminderUTCMock.mockReturnValue(h.SCHED_PAST);

    const res = await updateReminderPreference(h.EVENT.id, {
      preferenceType: 'SAME_DAY',
      offsetMinutes: 10, // > 0 to avoid hitting the "invalid offset" branch
    });

    expect(res.success).toBe(false);
    expectNoDbWrite();
  });

  it('returns success:false when user is not authenticated', async () => {
    m.authMock.mockResolvedValue({ userId: null });

    const res = await updateReminderPreference(h.EVENT.id, {
      preferenceType: 'SAME_DAY',
      offsetMinutes: 60, // > 0 to avoid hitting the "invalid offset" branch
    });

    expect(res.success).toBe(false);
    expectNoDbWrite();
  });

  it('returns success:false when RSVP (user,event) is not found', async () => {
    m.findUniqueMock.mockResolvedValue(null);

    const res = await updateReminderPreference(h.EVENT.id, {
      preferenceType: 'SAME_DAY',
      offsetMinutes: 60, // > 0 to avoid hitting the "invalid offset" branch
    });

    expect(res.success).toBe(false);
    expectNoDbWrite();
  });


  it('clears reminder when user opts out (reminderDetails: null)', async () => {
    // Presetted reminder
    const prevSched = new Date('2099-01-03T14:30:00.000Z');
    m.findUniqueMock.mockResolvedValue({
      ...h.RSVP,
      reminderPreferenceType: 'MINUTES_BEFORE' as ReminderType,
      reminderOffsetMinutes: 30,
      reminderScheduledAt: prevSched,
      reminderSentAt: null,
    });

    const res = await updateReminderPreference(h.EVENT.id, null);

    expectSuccess(res); // from here on, res is SuccessResult

    expect(m.calcReminderUTCMock).not.toHaveBeenCalled();
    expect(m.updateMock).toHaveBeenCalledTimes(1);
    const call = m.updateMock.mock.calls[0][0];
    expect(call.where.id).toBe(h.RSVP.id);
    expect(call.data).toMatchObject({
      reminderPreferenceType: null,
      reminderOffsetMinutes:  null,
      reminderScheduledAt:    null,
      reminderSentAt:         null,
    });

    expect(res.updatedRsvp.reminderPreferenceType).toBeNull();
    expect(res.updatedRsvp.reminderOffsetMinutes).toBeNull();
    expect(res.updatedRsvp.reminderScheduledAt).toBeNull();
    expect(res.updatedRsvp.reminderSentAt).toBeNull();
  });

});
