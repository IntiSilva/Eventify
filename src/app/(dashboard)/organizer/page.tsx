import type { Metadata } from 'next'
import { getCurrentUserFromDb } from "@/lib/viewer";
import { getEventsByOrganizer, getPopularEventsByOrganizer, getMonthlyEventsByOrganizer, getUserUpcomingRsvpCount } from "@/lib/data";
import OrganizerPageClientWrapper from "@/components/Organizer/OrganizerPageClientWrapper";
import { AuroraButton } from "@/components/CommonButtons/AuroraButton";
import { ParticlesButton } from '@/components/CommonButtons/ParticlesButton';
import Link from "next/link";
import DashboardPageWrapper from "@/components/DashboardPageWrapper";
import type { SearchParamsPromise, RawSearchParams } from "@/types/globals";
import RippleGridBackground from "@/components/AnimatedBackgrounds/RippleGridBackground";

export const metadata: Metadata = { title: 'Organizer' }

interface OrganizerPageProps {
  searchParams?: SearchParamsPromise;
}

type PopularEvents = Awaited<ReturnType<typeof getPopularEventsByOrganizer>>;
type MonthlyEvents = Awaited<ReturnType<typeof getMonthlyEventsByOrganizer>>;

export default async function OrganizerPage({ searchParams }: OrganizerPageProps) {
  const user = await getCurrentUserFromDb();
  if (!user) {
    return (
      <DashboardPageWrapper>
        <p className="p-6 text-zinc-400">Unauthorized. Please sign in to view this page.</p>
      </DashboardPageWrapper>
    );
  }

  const resolvedSearchParams: RawSearchParams = searchParams ? await searchParams : {};
  const isSearchMode = !!(
    resolvedSearchParams.search ||
    resolvedSearchParams.category ||
    resolvedSearchParams.location ||
    resolvedSearchParams.date
  );

  const emptyPopular: PopularEvents = [];
  const emptyMonthly: MonthlyEvents = [];

  const popularPromise = isSearchMode
    ? Promise.resolve(emptyPopular)
    : getPopularEventsByOrganizer(user.clerkId, 24);

  const monthlyPromise = isSearchMode
    ? Promise.resolve(emptyMonthly)
    : getMonthlyEventsByOrganizer(user.clerkId);

  const [organizerDataPayload, upcomingRsvpCount, popularEvents, monthlyEvents] = await Promise.all([
    getEventsByOrganizer(user.clerkId, resolvedSearchParams),
    getUserUpcomingRsvpCount(user.clerkId),
    popularPromise,
    monthlyPromise,
  ]);
  const showMyAgendaBtn = upcomingRsvpCount > 0;
  const showCreateBtn   = organizerDataPayload.metadata.totalEvents! > 0;

  return (
    <DashboardPageWrapper>
      <div className="relative min-h-screen">
        <div
          className="
            fixed left-0 right-0
            top-[-40px] h-[calc(100vh+80px)]
            md:top-0 md:h-screen
            -z-10 bg-black
            pointer-events-none
          "
        >
          <RippleGridBackground
            gridColor="#1ACC80"
            rippleIntensity={0.01}
            gridSize={13}
            gridThickness={10}
            fadeDistance={0.5}
            vignetteStrength={2}
            glowIntensity={0.3}
            opacity={1}
            gridRotation={135}
            mouseInteraction
            mouseInteractionRadius={0.8}
          />
        </div>
        
        <section className="w-full max-w-7xl mx-auto py-8 space-y-6 px-2 xs2:px-4 md:px-6">
          <div className="flex flex-col gap-5 md:gap-1.5 mb-3 md:mb-8">
            
            {/* Acciones (derecha) */}
          {(showMyAgendaBtn || showCreateBtn) && (
            <div className="self-end flex gap-3 mr-2 md:mr-0">
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

              {showCreateBtn && (
                <AuroraButton
                  emeraldBorder
                  className="cursor-pointer text-xs md:text-sm text-white font-display py-5 md:py-5.5 md:leading-4 px-2 md:px-4"
                >
                  <Link href="/events/new" className="whitespace-pre-line text-center">
                    {"Create\nEvent"}
                  </Link>
                </AuroraButton>
              )}
            </div>
          )}


            <h1 className="text-4xl md:text-5xl text-white font-bold font-display self-start">
              Your Events
            </h1>
          </div>

          <OrganizerPageClientWrapper
            initialPayload={organizerDataPayload}
            popularEvents={popularEvents}
            monthlyEvents={monthlyEvents}
            isSearchMode={isSearchMode}
          />
        </section>
      </div>
    </DashboardPageWrapper>
  );
}
