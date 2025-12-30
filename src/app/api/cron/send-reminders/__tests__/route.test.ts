import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CronSendRemindersResponse } from '@/types/api';

// -----------------------------
// Hoisted mocks (safe for vi.mock hoisting)
// -----------------------------
const h = vi.hoisted(() => ({
  // Prisma RSVP table stubs
  findManyMock: vi.fn(),
  updateMock: vi.fn(),

  // Brevo send stub
  sendTransacEmailMock: vi.fn(),

  // Keep original env to restore after each test
  ENV_SNAPSHOT: { ...process.env },
}));

// prisma client mock
vi.mock('@/lib/prisma', () => ({
  prisma: {
    rSVP: {
      findMany: h.findManyMock,
      update: h.updateMock,
    },
  },
}));

// Brevo SDK mock (matches: TransactionalEmailsApi + TransactionalEmailsApiApiKeys.apiKey)
vi.mock('@getbrevo/brevo', () => {
  class TransactionalEmailsApi {
    setApiKey(_key: unknown, _value: string) {
      // no-op
    }
    sendTransacEmail(payload: unknown) {
      return h.sendTransacEmailMock(payload);
    }
  }

  const TransactionalEmailsApiApiKeys = { apiKey: 'apiKey' } as const;

  return { TransactionalEmailsApi, TransactionalEmailsApiApiKeys };
});

// React Email render mock (ReactElement -> HTML string)
vi.mock('@react-email/render', () => ({
  render: vi.fn(async () => '<html><body>mock</body></html>'),
}));

// Email template mocks: return a simple React element
vi.mock('@/app/(dashboard)/emails/Reminder48hEmail', () => ({
  default: (): React.ReactElement => React.createElement('div', null, '48h'),
}));
vi.mock('@/app/(dashboard)/emails/ReminderDayOfEmail', () => ({
  default: (): React.ReactElement => React.createElement('div', null, 'DayOf'),
}));

// Time helper mock: deterministic output if it gets called
vi.mock('@/lib/reminders', () => ({
  getEventTimeContext: () => '10:00',
}));

describe('/api/cron/send-reminders (mini)', () => {
  beforeEach(() => {
    // Fresh mocks each test
    h.findManyMock.mockReset();
    h.updateMock.mockReset();
    h.sendTransacEmailMock.mockReset();

    // Minimal env so the route doesn't bail out with 500
    process.env.CRON_SECRET = 's3cr3t';
    process.env.BREVO_API_KEY = 'brevo_test';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@example.com';
  });

  afterEach(() => {
    // Restore env to the original snapshot
    process.env = { ...h.ENV_SNAPSHOT };
    vi.restoreAllMocks();
  });

  it('returns 401 and does NOT hit DB when Authorization header is wrong', async () => {
    // IMPORTANT: reload the module after env is set so it captures current env
    vi.resetModules();
    const { GET } = await import('@/app/api/cron/send-reminders/route');

    const req = new Request(
      'http://localhost/api/cron/send-reminders?secret=s3cr3t',
      {
        headers: { authorization: 'Bearer wrong' },
      }
    );

    const res = await GET(req);
    expect(res.status).toBe(401);

    // Ensure we never touched the DB or Brevo
    expect(h.findManyMock).not.toHaveBeenCalled();
    expect(h.updateMock).not.toHaveBeenCalled();
    expect(h.sendTransacEmailMock).not.toHaveBeenCalled();

    const json = (await res.json()) as CronSendRemindersResponse;

    expect(json.success).toBe(false);
    if (!json.success) {
      expect(json.error).toMatch(/unauthorized/i);
    }
  });

  it('marks reminderSentAt when RSVP has no user email and does NOT call Brevo', async () => {
    // One RSVP ready to notify but with user.email = null
    const now = new Date();
    h.findManyMock.mockResolvedValueOnce([
      {
        id: 'rsvp_1',
        status: 'confirmed',
        reminderScheduledAt: new Date(now.getTime() - 1000),
        reminderSentAt: null,
        reminderPreferenceType: 'FORTY_EIGHT_HOURS',
        reminderOffsetMinutes: null,
        user: {
          email: null, // <-- key condition
          username: 'jdoe',
          firstName: 'Jane',
        },
        event: {
          id: 'evt_1',
          title: 'Party',
          date: new Date(now.getTime() + 3600_000),
          location: 'BA',
          eventTimeZone: 'America/Argentina/Buenos_Aires',
        },
      },
    ]);

    // IMPORTANT: reset + dynamic import AFTER env is set so module-level constants read them
    vi.resetModules();
    const { GET } = await import('@/app/api/cron/send-reminders/route');

    // Request passes auth (header)
    const req = new Request(
      'http://localhost/api/cron/send-reminders?secret=s3cr3t',
      {
        headers: { authorization: 'Bearer s3cr3t' },
      }
    );

    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as CronSendRemindersResponse;
    expect(body.success).toBe(true);
    if (body.success) {
      // No emails were sent because the RSVP lacked an email
      expect(body.sentCount).toBe(0);
      expect(typeof body.message).toBe('string');
    }

    // Ensure we updated reminderSentAt exactly once
    expect(h.updateMock).toHaveBeenCalledTimes(1);
    const updateArg = h.updateMock.mock.calls[0][0];
    expect(updateArg).toMatchObject({ where: { id: 'rsvp_1' } });
    expect(updateArg.data.reminderSentAt).toBeInstanceOf(Date);

    // And Brevo was never called
    expect(h.sendTransacEmailMock).not.toHaveBeenCalled();
  });

  it('sends an email via Brevo and marks reminderSentAt on success', async () => {
    const now = new Date();

    h.findManyMock.mockResolvedValueOnce([
      {
        id: 'rsvp_2',
        status: 'confirmed',
        reminderScheduledAt: new Date(now.getTime() - 1000),
        reminderSentAt: null,
        reminderPreferenceType: 'FORTY_EIGHT_HOURS',
        reminderOffsetMinutes: null,
        user: {
          email: 'jane@example.com',
          username: 'jdoe',
          firstName: 'Jane',
        },
        event: {
          id: 'evt_2',
          title: 'Concert',
          date: new Date(now.getTime() + 3600_000),
          location: 'BA',
          eventTimeZone: 'America/Argentina/Buenos_Aires',
        },
      },
    ]);

    h.sendTransacEmailMock.mockResolvedValueOnce({ messageId: 'brevo_123' });

    vi.resetModules();
    const { GET } = await import('@/app/api/cron/send-reminders/route');

    const req = new Request('http://localhost/api/cron/send-reminders', {
      headers: { authorization: 'Bearer s3cr3t' },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as CronSendRemindersResponse;
    expect(body.success).toBe(true);
    if (body.success) {
      expect(body.sentCount).toBe(1);
    }

    expect(h.sendTransacEmailMock).toHaveBeenCalledTimes(1);
    expect(h.updateMock).toHaveBeenCalledTimes(1);
    expect(h.updateMock.mock.calls[0][0]).toMatchObject({
      where: { id: 'rsvp_2' },
    });
  });
});
