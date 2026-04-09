import Navbar from "@/components/Navbar/Navbar";
import { cookies } from 'next/headers';
import { SearchContextProvider } from "@/contexts/SearchContext";
import { EventsContextProvider } from "@/contexts/EventsContext";
import { ViewerTzProvider } from '@/contexts/ViewerTzContext';
import SWRProvider from "@/components/providers/SWRProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MenuContextProvider } from "@/contexts/MenuContext";
import type { ReactNode } from 'react';
import { getCurrentUserPublic } from '@/lib/viewer';


export default async function DashboardLayout({
  children,
  checkout,
}: { children: ReactNode; checkout: ReactNode }) {
  const cookieStore = await cookies();
  const cookieTz = cookieStore.get('viewerTz')?.value ?? 'UTC';
  const viewer = await getCurrentUserPublic();
  return (
    <>
    <ViewerTzProvider initialViewerTz={cookieTz}>
      <SWRProvider>
        <EventsContextProvider>
          <SearchContextProvider>
             <TooltipProvider delayDuration={100} skipDelayDuration={300}>
         <MenuContextProvider>
          <Navbar viewerRole={viewer?.role ?? null} />
          <main className="flex-1 pt-[65px] pb-6">
            {children}
          </main>
          {checkout}
        </MenuContextProvider>
      </TooltipProvider>
    </SearchContextProvider>
      </EventsContextProvider>
        </SWRProvider>
          </ViewerTzProvider>
    </>
  );
}
