import { prisma } from "@/lib/prisma";

/**
 * Deletes events whose date has already passed.
 * 1. Count how many there are (very cheap thanks to the index on `date`).
 * 2. If the count is > 0, perform the DELETE.
 * Associated RSVPs are removed automatically via `onDelete: Cascade`.
 */
export async function deleteExpiredEvents() {
  const now = new Date();

  // 1) Cheap query: are there expired events?
  const expiredCount = await prisma.event.count({
    where: { date: { lt: now } },
  });

  if (expiredCount === 0) return;

  // 2) Delete only if necessary.
  const { count } = await prisma.event.deleteMany({
    where: { date: { lt: now } },
  });

  console.log(`[cleanup] Removed ${count} expired event(s) at ${now.toISOString()}`);
}
