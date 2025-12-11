export const runtime = 'nodejs';

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { prisma } from '@/lib/prisma';
import { UserRole, type Prisma } from '@/generated/prisma';
import type { WebhookEvent, UserJSON, DeletedObjectJSON } from '@clerk/nextjs/server';
import { normalizeUsername } from '@/lib/utils';

/**
 * Returns the user's primary email if available, otherwise falls back to the first email address.
 */
function getPrimaryEmail(userData: UserJSON): string | undefined {
  return (
    userData.email_addresses?.find((e) => e.id === userData.primary_email_address_id)?.email_address ||
    userData.email_addresses?.[0]?.email_address
  );
}

/**
 * Type guard for Prisma unique constraint violation (P2002).
 */
function isP2002(e: unknown): e is { code: 'P2002' } {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === 'P2002';
}

/**
 * Type guard for Prisma known request errors.
 */
function isPrismaKnownError(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return typeof e === 'object' && e !== null && 'code' in e && 'clientVersion' in e;
}

/**
 * Uniform logger for webhook errors with safe narrowing.
 */
function logWebhookError(prefix: string, err: unknown) {
  if (isPrismaKnownError(err)) {
    // Prisma errors with code metadata (P2002, P2025, etc.)
    console.error(prefix, { code: err.code, meta: err.meta });
  } else if (err instanceof Error) {
    // Standard Error
    console.error(prefix, err.message, err.stack);
  } else {
    // Any other unexpected shape
    console.error(prefix, err);
  }
}

// --- Helper: synchronous handler for user.created ---
// It reconciles or creates the provisional user in your DB
// and then sets public_metadata.onboarding = false in Clerk.
async function handleUserCreated(userData: UserJSON) {
  const clerkId = userData.id;
  const email = getPrimaryEmail(userData);

  // Safety guard: if Clerk somehow didn't send an id, we can't reconcile anything.
  if (!clerkId) {
    console.error('[Webhook] user.created: missing clerkId');
    return;
  }

  // Safety guard: we rely on email to reconcile or create the user record.
  if (!email) {
    console.error('[Webhook] user.created: missing email for', clerkId);
    return;
  }

  // Use Clerk's username when available, otherwise fall back to the raw clerkId.
  // We clamp to 25 characters to respect DB constraints / UI expectations.
  const username = (userData.username || clerkId).substring(0, 25);
  const normalizedUsername = normalizeUsername(username);

  // Normalize avatar information coming from Clerk.
  const nextHasImage = !!userData.has_image;
  const nextImageUrl = nextHasImage ? userData.image_url : null;

  // 1) Try to reconcile an existing user by clerkId (canonical link).
  const byClerk = await prisma.user.findUnique({ where: { clerkId } });

  if (byClerk) {
    // Existing row already linked to this Clerk user → just refresh profile fields.
    await prisma.user.update({
      where: { clerkId },
      data: {
        email,
        firstName: userData.first_name,
        lastName: userData.last_name,
        imageUrl: nextImageUrl,
        hasImage: nextHasImage,
        username,
        normalizedUsername,
      },
    });
  } else {
    // 2) No row for this clerkId → try reconciling by email (legacy / pre-Clerk account).
    const byEmail = await prisma.user.findUnique({ where: { email } });

    if (byEmail) {
      // We found a pre-existing account for this email, so we attach the new clerkId
      // and refresh the profile fields.
      await prisma.user.update({
        where: { email },
        data: {
          clerkId,
          firstName: userData.first_name,
          lastName: userData.last_name,
          imageUrl: nextImageUrl,
          hasImage: nextHasImage,
          username,
          normalizedUsername,
        },
      });
    } else {
      // 3) Completely new account: create the provisional user row.
      await prisma.user.create({
        data: {
          clerkId,
          email,
          username,
          normalizedUsername,
          firstName: userData.first_name,
          lastName: userData.last_name,
          imageUrl: nextImageUrl,
          hasImage: nextHasImage,
          role: UserRole.user, // default role for newly created users
        },
      });
    }
  }

  // 4) Only after the DB write succeeds, sync Clerk public metadata.
  if (!process.env.CLERK_SECRET_KEY) {
    console.error(
      '[Webhook] user.created: CLERK_SECRET_KEY missing, skipping metadata update',
    );
    return;
  }

  const metadataApiUrl = `https://api.clerk.com/v1/users/${clerkId}/metadata`;

  const clerkApiResponse = await fetch(metadataApiUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // At this point the user row exists in your DB but the in-app onboarding
      // has not been completed yet, so we mark onboarding as "not done".
      public_metadata: { onboarding: false },
    }),
  });

  // Log metadata errors but do not fail the webhook: the critical DB write
  // has already happened above, so this is a secondary concern.
  if (!clerkApiResponse.ok) {
    const body = await clerkApiResponse.text();
    console.error(
      `[Webhook] user.created: failed to update Clerk metadata for ${clerkId}.`,
      clerkApiResponse.status,
      body,
    );
  }
}


export async function POST(req: Request) {
  console.log('[Webhook] /api/webhooks/clerk received a POST request.');

  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    console.error('[Webhook] CLERK_WEBHOOK_SECRET is not set in environment variables.');
    return NextResponse.json({ success: false, error: 'Webhook secret not configured' }, { status: 500 });
  }

  // Read Svix headers required for signature verification
  const headerPayload = await headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    console.error('[Webhook] Missing one or more Svix verification headers.');
    return NextResponse.json({ success: false, error: 'Missing Svix verification headers' }, { status: 400 });
  }

  // Read the raw body and verify via Svix
  const payload = await req.text();
  const wh = new Webhook(WEBHOOK_SECRET);
  let evt: WebhookEvent;

  try {
    evt = wh.verify(payload, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as WebhookEvent;
    console.log('[Webhook] Successfully verified.');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Webhook] Verification failed:', msg);
    return NextResponse.json({ success: false, error: 'Webhook verification failed' }, { status: 400 });
  }

   const { type, data } = evt;
   console.log(`[Webhook] Received event type: ${type}`);

  // --- Synchronous handling for user.created ---
  if (type === 'user.created') {
    try {
      // We now wait for the DB + metadata work to complete before
      // acknowledging success to Clerk. This lets Clerk retry if Neon
      // is still waking up or the write fails.
      await handleUserCreated(data as UserJSON);

      return NextResponse.json({
        success: true,
        message: `Webhook processed. Event type: ${type}`,
      });
    } catch (err: unknown) {
      logWebhookError('[Webhook] user.created error:', err);

      // Tell Clerk this delivery failed so it can retry later.
      return NextResponse.json(
        { success: false, error: 'Failed to process user.created event' },
        { status: 500 },
      );
    }
  }

  // --- For all other event types, keep fire-and-forget behavior ---
  const responsePromise = NextResponse.json({
    success: true,
    message: `Webhook received. Event type: ${type}`,
  });

  if (type === 'user.updated') {
    // Handle user.updated: sync primary email, avatar, username, first name and last name
    (async () => {
      try {
        const userData = data as UserJSON;
        const clerkId = userData.id;
        if (!clerkId) return;

        const nextEmail = getPrimaryEmail(userData); // new primary email (if changed)
        const usernameRaw = userData.username?.slice(0, 25); // clamp to 25 chars
        const normalized = usernameRaw ? normalizeUsername(usernameRaw) : undefined;
        const nextFirst = userData.first_name
          ? userData.first_name.trim().slice(0, 50)
          : null; // clamp to 50 to match DB
        const nextLast = userData.last_name
          ? userData.last_name.trim().slice(0, 50)
          : null;

        // Read current values to avoid no-op updates
        const existing = await prisma.user.findUnique({
          where: { clerkId },
          select: {
            email: true,
            username: true,
            normalizedUsername: true,
            imageUrl: true,
            hasImage: true,
            firstName: true,
            lastName: true,
          },
        });

        // Build update payload only with actual changes
        const updateData: Prisma.UserUpdateInput = {};

        if (nextEmail && existing?.email !== nextEmail) {
          updateData.email = nextEmail;
        }

        // Avatar sync policy:
        // - If Clerk says has_image = true → store image_url and hasImage = true
        // - If Clerk says has_image = false → force imageUrl = null, hasImage = false
        const nextHasImage = !!userData.has_image;

        if (nextHasImage) {
          if (existing?.hasImage !== true) updateData.hasImage = true;
          if (existing?.imageUrl !== userData.image_url) {
            updateData.imageUrl = userData.image_url ?? null;
          }
        } else {
          // Only write if something actually changes (avoid no-ops)
          if (existing?.hasImage !== false || existing?.imageUrl !== null) {
            updateData.hasImage = false;
            updateData.imageUrl = null;
          }
        }

        if (existing?.firstName !== nextFirst) {
          updateData.firstName = nextFirst; // string | null
        }
        if (existing?.lastName !== nextLast) {
          updateData.lastName = nextLast; // string | null
        }

        // Username changes (if enabled in Clerk)
        const wantsUsernameChange =
          !!usernameRaw &&
          (existing?.username !== usernameRaw || existing?.normalizedUsername !== normalized);

        if (wantsUsernameChange && normalized) {
          updateData.username = usernameRaw;
          updateData.normalizedUsername = normalized;
        }

        if (Object.keys(updateData).length === 0) {
          console.log('[Webhook] user.updated -> no-op (no meaningful changes)');
          return;
        }

        try {
          await prisma.user.update({
            where: { clerkId },
            data: updateData,
          });
        } catch (e) {
          // If normalizedUsername unique constraint collides, still persist non-username fields
          if (isP2002(e) && wantsUsernameChange) {
            console.warn(
              '[Webhook] user.updated -> username collision (P2002). Saving non-username fields only.',
            );

            const rest: Prisma.UserUpdateInput = { ...updateData };
            delete rest.username;
            delete rest.normalizedUsername;

            if (Object.keys(rest).length > 0) {
              await prisma.user.update({
                where: { clerkId },
                data: rest,
              });
            }
          } else {
            throw e;
          }
        }

        console.log(
          `[Webhook] user.updated -> ${clerkId} (email: ${nextEmail ?? 'n/a'}, username: ${
            usernameRaw ?? 'n/a'
          })`,
        );
      } catch (err: unknown) {
        logWebhookError('[Webhook] user.updated error:', err);
      }
    })();
  } else if (type === 'user.deleted') {
    // Handle user.deleted: remove the user row; DB will cascade RSVPs/Events if configured
    (async () => {
      try {
        const userData = data as DeletedObjectJSON;
        const clerkId = userData.id;
        if (!clerkId) {
          console.error('[Webhook] user.deleted: missing clerkId');
          return;
        }

        const { count } = await prisma.user.deleteMany({ where: { clerkId } });
        if (count === 0) {
          console.warn(`[Webhook] user.deleted -> no-op (no row for clerkId ${clerkId})`);
        } else {
          console.log(
            `[Webhook] user.deleted -> deleted ${count} row(s) for clerkId ${clerkId} (cascade applied).`,
          );
        }
      } catch (err: unknown) {
        logWebhookError('[Webhook] user.deleted error:', err);
      }
    })();
  } else {
    // Any other event type is acknowledged but not acted upon
    console.log(
      `[Webhook] Received unhandled event type: ${type}. No action taken beyond acknowledgment.`,
    );
  }

  // Return the immediate acknowledgment response for non-user.created events
  return responsePromise;

}
