// app/(dashboard)/admin/page.tsx
import type { Metadata } from 'next'
import { getUsersWithEvents, getUserUpcomingRsvpCount } from "@/lib/data";
import { getCurrentUserFromDb } from '@/lib/viewer';
import UsersWithEventsAccordion from "@/components/Admin/UsersWithEventsAccordion";
import Link from "next/link";
import DashboardPageWrapper from "@/components/DashboardPageWrapper";
import { BlobButton } from "@/components/CommonButtons/BlobButton";
import { ParticlesButton } from "@/components/CommonButtons/ParticlesButton";

export const metadata: Metadata = { title: 'Admin' }

/**
 * Admin Page
 *
 * Server component:
 * - Fetches the list of users that have (or can have) events (username, role, and count).
 * - Renders an accordion with one section per user.
 * - Each section mounts <UsersEventsPanel userId=... />, which handles client-side
 *   pagination, filtering, and normalization into the EventsContext store.
 *
 * Notes:
 * - Keeping server data minimal here avoids double-fetching; detailed event pages are
 *   requested by the panel on demand with stable search keys (namespaced by user).
 */
export default async function AdminPage() {
  const me = await getCurrentUserFromDb();

  const [usersWithEvents, myRsvpCount] = await Promise.all([
    getUsersWithEvents(),
    me ? getUserUpcomingRsvpCount(me.clerkId) : Promise.resolve(0),
  ]);

  const showMyAgendaBtn = myRsvpCount > 0;

  return (
    <DashboardPageWrapper>
      <main className="px-4 py-6 space-y-6 text-white">
        <div className="flex flex-col lg:px-12 gap-5 md:gap-1.5 mb-3 md:mb-8">

          <div className="self-end flex flex-wrap items-center gap-3 mr-2 md:mr-0">
            {showMyAgendaBtn && (
              <ParticlesButton
                glass="black"
                glassBlackAlpha={1}
                className="h-auto min-h-9 px-2 md:px-4 py-1 md:py-1.5 text-xs font-display"
              >
                <Link href="/agenda" className="whitespace-pre-line text-center">
                  {'My\nAgenda'}
                </Link>
              </ParticlesButton>
            )}

            <BlobButton className="cursor-pointer text-xs md:text-sm text-white font-display py-5 md:py-5.5 md:leading-4 px-2 md:px-4 ml-2 md:ml-0">
              <Link href="/events/new" className="whitespace-pre-line text-center">
                {"Create\nEvent"}
              </Link>
            </BlobButton>
          </div>

          <h1 className="text-2xl md:text-5xl font-display font-bold">
            Manage All Events
          </h1>
        </div>

        {usersWithEvents.length > 0 ? (
          <UsersWithEventsAccordion usersWithEvents={usersWithEvents} />
        ) : (
          <p className="text-gray-400 lg:pl-12">No organizers with active events.</p>
        )}
      </main>
    </DashboardPageWrapper>
  );
}
