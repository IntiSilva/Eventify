import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';
import { RSVPStatus } from '@/generated/prisma';
import Reminder48hEmail from '@/app/(dashboard)/emails/Reminder48hEmail';
import ReminderDayOfEmail from '@/app/(dashboard)/emails/ReminderDayOfEmail';
import { getEventTimeContext } from '@/lib/reminders';
import type {
  CronSendRemindersResponse,
  ApiErrorResponse,
} from '@/types/api'; // Response union types for success/error

const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM_ADDRESS;
const cronSecret = process.env.CRON_SECRET;

/**
 * Cron-only endpoint that:
 * 1) Authenticates with a shared secret (header + query param).
 * 2) Finds confirmed RSVPs whose reminderScheduledAt is due and not yet sent.
 * 3) Sends the correct reminder email via Resend.
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
  if (!process.env.RESEND_API_KEY || !emailFrom) {
    console.error(
      'CRON CRITICAL ERROR: RESEND_API_KEY or EMAIL_FROM_ADDRESS not configured.'
    );
    const body: ApiErrorResponse = {
      success: false,
      error: 'Incomplete server configuration.',
    };
    return NextResponse.json(body, { status: 500 });
  }

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
        status: RSVPStatus.confirmed,
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
      let emailReactElement: React.ReactElement;

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
        // 5) Send email through Resend
        const { data, error } = await resend.emails.send({
          from: emailFrom,
          to: user.email,
          subject: emailSubject,
          react: emailReactElement,
        });

        if (error) {
          console.error(
            `CRON ERROR Resend: Failed to send to ${user.email} (RSVP ID: ${rsvp.id}). Error: ${error.message}`
          );
        } else {
          console.log(
            `CRON SUCCESS: Email sent to ${user.email} (RSVP ID: ${rsvp.id}). Resend ID: ${data?.id}`
          );

          // 6) Mark as sent so it won't be re-processed next run
          await prisma.rSVP.update({
            where: { id: rsvp.id },
            data: { reminderSentAt: new Date() },
          });

          emailsSentCount++;
        }
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
