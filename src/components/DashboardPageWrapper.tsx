'use client';

import { useEffect } from 'react';
import { useSearchContext } from '@/contexts/SearchContext';

export default function DashboardPageWrapper({ children }: { children: React.ReactNode }) {
  const { setShowNavbarSearchbar } = useSearchContext();

  useEffect(() => {
    // When a page using this wrapper loads, tell the Navbar to hide its Searchbar.
    setShowNavbarSearchbar(false);

    // When the user navigates away from this page, the cleanup function will run
    // and re-enable the Searchbar in the Navbar for other pages (like Home).
    return () => {
      setShowNavbarSearchbar(true);
    };
  }, [setShowNavbarSearchbar]); // The dependency array ensures this runs only on mount/unmount.

  return <>{children}</>;
}
