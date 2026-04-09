import type { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server';
import { getUserUpcomingEvents } from '@/lib/data';
import { swrKeys } from '@/lib/swrKeys';
import AgendaPageClientWrapper from '@/components/Agenda/AgendaPageClientWrapper';
import DashboardPageWrapper from '@/components/DashboardPageWrapper';


export const metadata: Metadata = { title: 'My Agenda' }

/**
 * Responsibilities:
 * - Fetch the initial payload server-side (upcoming events for the current user).
 * - Echo the viewer TZ cookie via lib/data (no cookie reads here).
 * - Delegate rendering/rehydration to a client wrapper component.
 *
 * Notes:
 * - Ordering is Event.date ASC (UTC). The client may display dates in the viewer TZ,
 *   but ordering remains stable since it's based on the actual instant.
 */
export default async function AgendaPage() {
  // Server-side auth guard. You can redirect to sign-in if desired.
  const { userId } = await auth();
  if (!userId) {
    return (
      <div className="container mx-auto px-4 py-10 text-zinc-300">
        You must be signed in to see your upcoming events.
      </div>
    );
  }

  // Initial SSR payload (includes viewerTzFromCookie if available).
  const { events, viewerTzFromCookie } = await getUserUpcomingEvents(userId, {
    readViewerTzCookie: true,
    take: 30, // tune or remove if full list is needed
  });

  // SWR key includes the viewer TZ for cache separation.
  const swrKey = swrKeys.agenda.upcoming(viewerTzFromCookie);

  return (
    <DashboardPageWrapper>
      <div className="container mx-auto px-3 xs4:px-4 pt-6 lg:pt-6 space-y-6">
        <AgendaPageClientWrapper initialEvents={events} swrKey={swrKey} />
      </div>
    </DashboardPageWrapper>
  );
}
