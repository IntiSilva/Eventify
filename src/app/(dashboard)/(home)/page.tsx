import { auth } from "@clerk/nextjs/server";
import type { Metadata } from 'next'
import type {  UserRole } from "@/generated/prisma";
import { getHomePageData, type HomePageData } from "@/lib/data";
import HomePageClientWrapper from "@/components/Home/HomePageClientWrapper";
import type { SearchParamsPromise, RawSearchParams } from "@/types/globals";



export const metadata: Metadata = {
  title: 'Home',
  description: 'Find upcoming events and manage your own.',
  alternates: { canonical: '/' },
}

interface HomePageProps {
   searchParams?: SearchParamsPromise;
  };


export default async function Home({ searchParams }: HomePageProps) {

  //Get user role for conditional button
  const {sessionClaims} = await auth();
  const role = sessionClaims?.publicMetadata?.role as UserRole

  const resolvedSearchParams: RawSearchParams = searchParams
      ? await searchParams
      : {};

  // Fetch all data required for the page using the helper function
  const homePageData: HomePageData = await getHomePageData(resolvedSearchParams);



  return (
          <div className="container mx-auto px-4 pt-4 xs4:pt-6 space-y-12">
        <HomePageClientWrapper {...homePageData} userRole={role}/>
        </div>

  );
}
