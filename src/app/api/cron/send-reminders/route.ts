import { NextResponse } from 'next/server';
import { render } from '@react-email/render';
import {
  TransactionalEmailsApi,
  TransactionalEmailsApiApiKeys,
} from '@getbrevo/brevo';
import { prisma } from '@/lib/prisma';
import { CURRENTLY_ATTENDING_RSVP_WHERE } from '@/lib/rsvpAttendance';
import Reminder48hEmail from '@/app/(dashboard)/emails/Reminder48hEmail';
import ReminderDayOfEmail from '@/app/(dashboard)/emails/ReminderDayOfEmail';
import { getEventTimeContext } from '@/lib/reminders';
import type { ReactElement } from 'react';
import type {
  CronSendRemindersResponse,
  ApiErrorResponse,
} from '@/types/api';

const brevoApiKey = process.env.BREVO_API_KEY;
const emailFrom = process.env.EMAIL_FROM_ADDRESS;
const cronSecret = process.env.CRON_SECRET;

type SenderInfo = { name?: string; email: string };

function parseSender(from: string): SenderInfo {
  // Supports:
  // - "Name <email@domain.com>"
  // - "email@domain.com"
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1]?.trim().replace(/^"(.+)"$/, '$1');
    const email = match[2]?.trim();
    return name ? { name, email } : { email };
  }
  return { email: from.trim() };
}

/**
 * Cron-only endpoint that:
 * 1) Authenticates with a shared secret (Authorization header).
 * 2) Finds confirmed RSVPs whose reminderScheduledAt is due and not yet sent.
 * 3) Renders the correct React Email template to HTML and sends it via Brevo.
 * 4) Marks reminders as sent to avoid re-sending.
 */
export async function GET(request: Request) {
  // --- Simple auth guard: requires "Authorization: Bearer <CRON_SECRET>"
  const authHeader = request.headers.get('authorization');

  if (!cronSecret) {
    return NextResponse.json(
      { success: false, error: 'Missing CRON_SECRET.' },
      { status: 500 }
    );
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('Unauthorized attempt to access the reminder cron job.');
    const body: ApiErrorResponse = { success: false, error: 'Unauthorized' };
    return NextResponse.json(body, { status: 401 });
  }

  // --- Environment sanity check (avoid running cron with missing config)
  if (!brevoApiKey || !emailFrom) {
    console.error(
      'CRON CRITICAL ERROR: BREVO_API_KEY or EMAIL_FROM_ADDRESS not configured.'
    );
    const body: ApiErrorResponse = {
      success: false,
      error: 'Incomplete server configuration.',
    };
    return NextResponse.json(body, { status: 500 });
  }

  const brevo = new TransactionalEmailsApi();
  brevo.setApiKey(TransactionalEmailsApiApiKeys.apiKey, brevoApiKey);
  const sender = parseSender(emailFrom);

  const now = new Date();
  console.log(
    `CRON JOB (${now.toISOString()}): Searching for scheduled reminders to send.`
  );

  try {
    // 1) Fetch all due reminders that haven't been sent yet
    const rsvpsToNotify = await prisma.rSVP.findMany({
      where: {
        reminderScheduledAt: { lte: now },
        reminderSentAt: null,
        ...CURRENTLY_ATTENDING_RSVP_WHERE,
      },
      include: {
        user: { select: { email: true, username: true, firstName: true } },
        event: {
          select: {
            id: true,
            title: true,
            date: true,
            location: true,
            eventTimeZone: true,
          },
        },
      },
    });

    // 2) Early exit if nothing to do (still returns success)
    if (rsvpsToNotify.length === 0) {
      console.log('CRON: No pending reminders to send.');
      const body: CronSendRemindersResponse = {
        success: true,
        sentCount: 0,
        message: 'No pending reminders.',
      };
      return NextResponse.json(body);
    }

    console.log(
      `CRON: ${rsvpsToNotify.length} reminder(s) found. Processing...`
    );

    let emailsSentCount = 0;

    // 3) Process each RSVP independently to avoid one failure breaking the batch
    for (const rsvp of rsvpsToNotify) {
      // Skip users without email, but mark as sent to prevent infinite retries
      if (!rsvp.user.email) {
        console.warn(
          `CRON SKIP: RSVP ID ${rsvp.id} has no user email. Marking as sent to prevent loops.`
        );
        await prisma.rSVP.update({
          where: { id: rsvp.id },
          data: { reminderSentAt: new Date() },
        });
        continue;
      }

      const {
        event,
        user,
        reminderPreferenceType,
        reminderOffsetMinutes,
      } = rsvp;

      const eventDate = new Date(event.date);

      let emailSubject = '';
      let emailReactElement: ReactElement;

      // 4) Pick subject + email template depending on reminder type
      if (reminderPreferenceType === 'FORTY_EIGHT_HOURS') {
        emailSubject = `⏳ Reminder: ${event.title} is coming up soon!`;
        emailReactElement = Reminder48hEmail({
          username: user.firstName || user.username,
          eventName: event.title,
          eventDate: eventDate.toLocaleString('en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone: event.eventTimeZone,
          }),
          eventLocation: event.location,
        });
      } else if (
        reminderPreferenceType === 'SAME_DAY' ||
        reminderPreferenceType === 'MINUTES_BEFORE'
      ) {
        emailSubject = `⏰ ${event.title} is about to start!`;
        emailReactElement = ReminderDayOfEmail({
          username: user.firstName || user.username,
          eventName: event.title,
          eventTime: getEventTimeContext(
            eventDate,
            reminderOffsetMinutes,
            event.eventTimeZone
          ),
          eventLocation: event.location,
        });
      } else {
        // Unknown reminder type: skip but mark as sent to avoid loops
        console.warn(
          `CRON SKIP: Unknown reminder type ('${reminderPreferenceType}') for RSVP ID: ${rsvp.id}. Marking as sent.`
        );
        await prisma.rSVP.update({
          where: { id: rsvp.id },
          data: { reminderSentAt: new Date() },
        });
        continue;
      }

      try {
        // 5) Render React Email -> HTML, then send through Brevo
        const htmlContent = await render(emailReactElement);

        const result = await brevo.sendTransacEmail({
          sender: sender.name
            ? { name: sender.name, email: sender.email }
            : { email: sender.email },
          to: [
            {
              email: rsvp.user.email,
              name: user.firstName || user.username || undefined,
            },
          ],
          subject: emailSubject,
          htmlContent,
        });

        // Brevo SDK typically returns { body: { messageId: ... } }
        // Keep logs short but useful.
        const messageId = result?.body?.messageId;
        console.log(
          `CRON SUCCESS: Email sent to ${rsvp.user.email} (RSVP ID: ${rsvp.id}).` +
            (messageId ? ` MessageId: ${messageId}` : '')
        );

        // 6) Mark as sent so it won't be re-processed next run
        await prisma.rSVP.update({
          where: { id: rsvp.id },
          data: { reminderSentAt: new Date() },
        });

        emailsSentCount++;
      } catch (e) {
        console.error(
          `CRON CRITICAL: Exception while sending email or updating DB for RSVP ID ${rsvp.id}.`,
          e
        );
      }
    }

    console.log(
      `CRON: Process completed. ${emailsSentCount} out of ${rsvpsToNotify.length} emails were sent.`
    );

    const body: CronSendRemindersResponse = {
      success: true,
      sentCount: emailsSentCount,
      message: `Sent ${emailsSentCount} reminder(s).`,
    };
    return NextResponse.json(body);
  } catch (dbError) {
    // Any Prisma/DB error returns a standard API error response
    console.error('CRON CRITICAL: Database connection or query error.', dbError);
    const body: ApiErrorResponse = {
      success: false,
      error: 'Database error.',
    };
    return NextResponse.json(body, { status: 500 });
  }
}
