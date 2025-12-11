'use server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

/**
 * Server action that updates the authenticated user's phone number.
 * - Expects a normalized string (you can add formatting/normalization upstream).
 * - Updates Prisma by Clerk ID.
 */
export async function savePhone(phone: string) {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  await prisma.user.update({
    where: { clerkId: userId },
    data: { phoneNumber: phone.trim() },
  });
}
