// app/(dashboard)/admin/page.tsx
import type { Metadata } from 'next'
import {
  getAdminOverviewSnapshot,
  getAdminOverviewTimeSeriesSnapshot,
  getUsersForAdminManagement,
  getUserUpcomingRsvpCount,
} from "@/lib/data";
import { getCurrentUserFromDb } from '@/lib/viewer';
import AdminManagementShell from "@/components/Admin/AdminManagementShell";
import AdminOverviewPanel from "@/components/Admin/AdminOverviewPanel";
import Link from "next/link";
import DashboardPageWrapper from "@/components/DashboardPageWrapper";
import { BlobButton } from "@/components/CommonButtons/BlobButton";
import { ParticlesButton } from "@/components/CommonButtons/ParticlesButton";
import { getRefundCountsForViewer } from '@/app/(dashboard)/rsvp/actions';
import { EMPTY_REFUND_VIEWER_COUNTS } from '@/components/Payments/refunds/types/refunds';

export const metadata: Metadata = { title: 'Admin' }

/**
 * Admin Page
 *
 * Server component:
 * - Fetches admins/organizers who have created at least one event at any point.
 * - Fetches a compact admin overview snapshot from persisted data.
 * - Fetches refund inbox counts for the top-level admin refunds entry point.
 * - Renders the admin-management shell (list + selection-driven workspace).
 * - Organizer workspace mounts <UsersEventsPanel userId=... />, which handles
 *   organizer-scoped event filtering, pagination, and EventsContext hydration.
 */
export default async function AdminPage() {
  const me = await getCurrentUserFromDb();

  const [
    usersForAdminManagement,
    myRsvpCount,
    adminOverviewSnapshot,
    adminOverviewTimeSeries,
    refundCountsResult,
  ] = await Promise.all([
    getUsersForAdminManagement(),
    me ? getUserUpcomingRsvpCount(me.clerkId) : Promise.resolve(0),
    getAdminOverviewSnapshot(),
    getAdminOverviewTimeSeriesSnapshot(),
    getRefundCountsForViewer(),
  ]);

  const showMyAgendaBtn = myRsvpCount > 0;
  const organizersWithActiveEventsCount = usersForAdminManagement.filter(
    (user) => user.role === 'organizer' && user._count.createdEvents > 0
  ).length;
  const refundCounts = refundCountsResult.success
    ? refundCountsResult.data
    : EMPTY_REFUND_VIEWER_COUNTS;

  return (
    <DashboardPageWrapper>
      <main className="px-2 xs4:px-3 md:px-4 pt-6 space-y-6 text-white">
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

        <AdminOverviewPanel
          snapshot={adminOverviewSnapshot}
          timeSeries={adminOverviewTimeSeries}
          organizersWithActiveEventsCount={organizersWithActiveEventsCount}
          initialRefundCounts={refundCounts}
        />

        {usersForAdminManagement.length > 0 ? (
          <AdminManagementShell
            usersWithEvents={usersForAdminManagement}
            initialViewerClerkId={me?.clerkId ?? null}
          />
        ) : (
          <p className="text-gray-400 lg:pl-12">No admins or organizers have created events yet.</p>
        )}
      </main>
    </DashboardPageWrapper>
  );
}
