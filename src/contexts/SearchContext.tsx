'use client';

import { createContext, useState, useContext, ReactNode } from 'react';
import type { SearchbarFilters } from '@/components/Searchbar/Searchbar'; // Import the interface

// 1) Define the shape of the data in our context
interface SearchContextType {
  showNavbarSearchbar: boolean;
  setShowNavbarSearchbar: (show: boolean) => void;
  onSearchSubmit: (filters: SearchbarFilters) => void;
  setOnSearchSubmit: (func: (filters: SearchbarFilters) => void) => void;
}

// 2) Create the Context
const SearchContext = createContext<SearchContextType | undefined>(undefined);

// 3) Create the Context Provider
export function SearchContextProvider({ children }: { children: ReactNode }) {
  const [showNavbarSearchbar, setShowNavbarSearchbar] = useState(true);
  const [onSearchSubmit, setOnSearchSubmit] = useState<(filters: SearchbarFilters) => void>(() => () => {});

  const value = {
    showNavbarSearchbar,
    setShowNavbarSearchbar,
    onSearchSubmit,
    setOnSearchSubmit, // Function that allows pages to “register” their own search logic
  };

  return (
    <SearchContext.Provider value={value}>
      {children}
    </SearchContext.Provider>
  );
}

// 4) Custom hook (unchanged)
export function useSearchContext() {
  const context = useContext(SearchContext);
  if (context === undefined) {
    throw new Error('useSearchContext must be used within a SearchContextProvider');
  }
  return context;
}
