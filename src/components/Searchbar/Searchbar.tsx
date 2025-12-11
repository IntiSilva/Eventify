'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { EventCategory } from '@/generated/prisma';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence, Variants } from 'motion/react';
import { cn } from '@/lib/utils';
import SearchbarCategoryFilter from './SearchbarCategoryFilter';
import SearchToggleIcon from '../LordIcons/SearchToggleIcon';
import SearchInputWithAutocomplete from './SearchInputWithAutocomplete';
import SearchbarAdvancedFilter from './SearchbarAdvancedFilter';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';

/* -----------------------------
 * Date helpers (local string + naive parse)
 * ---------------------------- */
const toLocalYYYYMMDD = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
};

const parseYYYYMMDDAsLocal = (s?: string | null) => {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  // Use 00:01 local time to avoid edge-cases around exactly 00:00
  return new Date(y, m - 1, d, 0, 1, 0, 0);
};


  /* -----------------------------
   * Animation variants
   * ---------------------------- */
  const inputContainerVariants: Variants = {
    hidden: { width: 0 },
    visible: { width: 'auto' },
  };

  const contentVariants: Variants = {
    hidden: {
      opacity: 0,
      transition: { duration: 0.1 }
    },
    visible: {
      opacity: 1,
      transition: { delay: 0.1, duration: 0.2 }
    },
  };

  const borderVariants: Variants = {
    hidden: { pathLength: 0, opacity: 0 },
    visible: { pathLength: 1.01, opacity: 1, transition: { duration: 0.4, ease: "easeInOut", delay: 0.1 } },
    exit: { opacity: 0, transition: { duration: 0.1 } }
  };

  const borderExtensionVariants: Variants = {
    hidden: { pathLength: 0, opacity: 0 },
    visible: { pathLength: 1, opacity: 1 },
    exit: { pathLength: 0, opacity: 0 },
  };


// ======================================================================
// === 1) Animated Border Extension Component (Exported for reuse)    ===
// ======================================================================

interface SearchbarFilterExtensionProps {
  isDesktop: boolean;
  isNarrowScreen: boolean;
  isScrolled: boolean;
}



export function SearchbarFilterExtension({ isDesktop, isNarrowScreen, isScrolled }: SearchbarFilterExtensionProps) {
  const strokeWidth = 1.5;
  const buttonDiameter = isNarrowScreen
    ? (isScrolled ? 28 : 32)
    : (isScrolled ? 33 : 36);
  const topPosition = isNarrowScreen ? 0 : 0;
  const buttonRadius = buttonDiameter / 2;
  const pathHeight = buttonDiameter;

  const straightExtension = 0;
  const drawDuration = 0.6;
  const drawEasing: [number, number, number, number] = [0.42, 0, 0.58, 1];

  const extensionWidth = isNarrowScreen ? 20 + straightExtension : 30 + straightExtension;
  const viewBoxWidth = extensionWidth + buttonRadius;
  const halfStroke = strokeWidth / 2;
  const arcRadius = buttonRadius - halfStroke;

  const d = isDesktop
    ? `M 0,${halfStroke} L ${viewBoxWidth},${halfStroke} A ${arcRadius},${arcRadius} 0 0,1 ${viewBoxWidth},${pathHeight - halfStroke} L 0,${pathHeight - halfStroke}`
    : `M ${viewBoxWidth},${halfStroke} L 0,${halfStroke} A ${arcRadius},${arcRadius} 0 0,0 0,${pathHeight - halfStroke} L ${viewBoxWidth},${pathHeight - halfStroke}`;

  return (
    <motion.svg
      className="absolute pointer-events-none overflow-visible"
      style={
        isDesktop
          ? { right: '50%', top: topPosition, width: viewBoxWidth, height: pathHeight }
          : { left: '50%',  top:  topPosition, width: viewBoxWidth, height: pathHeight }
      }
      viewBox={`0 0 ${viewBoxWidth} ${pathHeight}`}
      preserveAspectRatio="none"
      overflow="visible"
    >
      <motion.path
        d={d}
        fill="none"
        stroke="rgb(5 150 105)"
        strokeWidth={strokeWidth}
        variants={borderExtensionVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        transition={{ duration: drawDuration, ease: drawEasing }}
      />
    </motion.svg>
  );
}

// ======================================================================
// === 2) Main Searchbar Component                                    ===
// ======================================================================

export interface SearchbarFilters {
  search?: string;
  category?: string;
  location?: string;
  creator?: string;
  date?: string;
}

// Server-side suggestions context
export type SuggestionScope =
  | { type: 'global' }
  | { type: 'organizer' }
  | { type: 'admin'; userId: string }
  | { type: 'agenda' };

interface SearchbarProps {
  onVisibilityChange?: (isVisible: boolean) => void;
  isScrolled: boolean;
  isDesktop: boolean;
  isNarrowScreen: boolean;
  onSearchSubmit?: (filters: SearchbarFilters) => void;
  disableCreatorFilter?: boolean;

  /**
   * Suggestions behavior:
   * - 'server': fetch from /api/search-suggestions with scope (organizer/admin/agenda/global)
   * - 'local' : use localSuggestionIndex provided by parent (e.g., /agenda page)
   */
  suggestionMode?: 'server' | 'local';

  /** Context to restrict server-side suggestions */
  suggestionScope?: SuggestionScope;

  /**
   * Local suggestions index (used when suggestionMode='local').
   * Minimal shape needed by children.
   */
  localSuggestionIndex?: Array<{
    title: string;
    location: string;
    creatorLabel: string;
  }>;

  /** Open the “no results” pop-under (controlled by parent wrapper). */
  notFoundOpen?: boolean;
  /** Message shown inside the “no results” pop-under. */
  notFoundText?: string | null;
  /** Called when pop-under closes (click outside / Escape). */
  onNotFoundClose?: () => void;
}

export default function Searchbar({
  onVisibilityChange,
  isScrolled,
  isDesktop,
  isNarrowScreen,
  onSearchSubmit,
  disableCreatorFilter = false,


  suggestionMode = 'server',
  suggestionScope = { type: 'global' } as SuggestionScope,
  localSuggestionIndex,
  notFoundOpen = false,
  notFoundText = null,
  onNotFoundClose,
}: SearchbarProps) {
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  /* -----------------------------
   * State
   * ---------------------------- */
  const [inputValue, setInputValue] = useState(searchParams.get('search') || '');
  const [location, setLocation] = useState(searchParams.get('location') || '');
  const [creator, setCreator] = useState(searchParams.get('creator') || '');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    searchParams.has('date') ? parseYYYYMMDDAsLocal(searchParams.get('date')) : undefined
  );

  // Keep category locally to detect/close correctly
  const [categoryLocal, setCategoryLocal] = useState<EventCategory | ''>(
    (searchParams.get('category') as EventCategory) || ''
  );

  // 1) Derived from the URL
  const hasSearchParams = useMemo(() => {
    return (
      searchParams.has('search') ||
      searchParams.has('category') ||
      searchParams.has('location') ||
      searchParams.has('creator') ||
      searchParams.has('date')
    );
  }, [searchParams]);

  // 2) Local toggle
  const [isLocalOpen, setIsLocalOpen] = useState(false);

  // 2b) Flag for optimistic closing until the URL is cleared
  const [dismissUntilUrlSettles, setDismissUntilUrlSettles] = useState(false);

  // 3) Effective visibility (derived + optimistic closing)
  const isSearchUIVisible = isLocalOpen || (!dismissUntilUrlSettles && hasSearchParams);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);


  /* -----------------------------
   * Effects
   * ---------------------------- */

  // Only notify effective visibility
  useEffect(() => {
    onVisibilityChange?.(isSearchUIVisible);
  }, [isSearchUIVisible, onVisibilityChange]);

  useEffect(() => {
    if (isSearchUIVisible && inputRef.current) inputRef.current.focus();
  }, [isSearchUIVisible]);

  /* -----------------------------
   * Handlers
   * ---------------------------- */
  const handleSearchExecution = useCallback(
    (newFilters: Partial<SearchbarFilters> = {}) => {
      const localSelectedCategory = categoryLocal || undefined;
      const requestedCategory =
        'category' in newFilters ? (newFilters.category || undefined) : undefined;
      const currentCategory = requestedCategory ?? localSelectedCategory;

      const filters: SearchbarFilters = {
        search: inputValue.trim() || undefined,
        category: currentCategory,
        location: location.trim() || undefined,
        creator: creator.trim() || undefined,
        date: selectedDate ? toLocalYYYYMMDD(selectedDate) : undefined,
        ...newFilters,
      };
      onSearchSubmit?.(filters);
    },
    [inputValue, location, creator, selectedDate, categoryLocal, onSearchSubmit]
  );

  const handleToggleSearchUI = () => {
    const willBeVisible = !isSearchUIVisible;
    setIsLocalOpen(willBeVisible);

    if (willBeVisible) {
      // Al abrir: tomar snapshot de la URL y precargar campos
      setDismissUntilUrlSettles(false);

      const urlSearch = searchParams.get('search') || '';
      const urlLocation = searchParams.get('location') || '';
      const urlCreator = searchParams.get('creator') || '';
      const urlDate = searchParams.has('date')
        ? parseYYYYMMDDAsLocal(searchParams.get('date'))
        : undefined;
      const urlCategory = (searchParams.get('category') as EventCategory) || '';

      // Estas llamadas se “batchean” automáticamente en handlers de eventos
      setInputValue(urlSearch);
      setLocation(urlLocation);
      setCreator(urlCreator);
      setSelectedDate(urlDate);
      setCategoryLocal(urlCategory);
      return; // evitá ejecutar el branch de cierre
    }

    // Al cerrar: limpiar local y notificar si había filtros
    setDismissUntilUrlSettles(true);

    const hadLocal =
      inputValue.trim().length > 0 ||
      location.trim().length > 0 ||
      creator.trim().length > 0 ||
      !!selectedDate ||
      !!categoryLocal;

    const hadURL = hasSearchParams;

    setInputValue('');
    setLocation('');
    setCreator('');
    setSelectedDate(undefined);
    setCategoryLocal('');
    setIsFilterPanelOpen(false);

    if (hadLocal || hadURL) {
      onSearchSubmit?.({});
    }
  };

  const handleAdvancedFilterApply = useCallback(
    (advanced: { location: string; creator: string; date?: Date }) => {
      setLocation(advanced.location);
      setCreator(advanced.creator);
      setSelectedDate(advanced.date);

      // microtask to execute search after states are flushed
      const run = () =>
        handleSearchExecution({
          location: advanced.location.trim() || undefined,
          creator: advanced.creator.trim() || undefined,
          date: advanced.date ? toLocalYYYYMMDD(advanced.date) : undefined,
        });
      if (typeof queueMicrotask === 'function') queueMicrotask(run);
      else Promise.resolve().then(run);
    },
    [handleSearchExecution]
  );

  /* -----------------------------
   * Suggestion prop adapters (keep children backward compatible)
   * ---------------------------- */
  const inputSuggestionProps: Record<string, unknown> = {};
  if (suggestionMode) inputSuggestionProps.mode = suggestionMode;
  if (suggestionScope) inputSuggestionProps.scope = suggestionScope;
  if (suggestionMode === 'local' && localSuggestionIndex) {
    // Main input only needs titles
    inputSuggestionProps.localIndex = localSuggestionIndex.map(e => ({ title: e.title }));
  }

  const advSuggestionProps: Record<string, unknown> = {};
  if (suggestionMode) advSuggestionProps.suggestionMode = suggestionMode;
  if (suggestionScope) advSuggestionProps.suggestionScope = suggestionScope;
  if (suggestionMode === 'local' && localSuggestionIndex) {
    advSuggestionProps.localIndex = localSuggestionIndex;
  }


  /* -----------------------------
   * Render
   * ---------------------------- */
  return (
    <div className={cn('flex items-center w-full justify-between')}>
      <div
        data-testid="searchbar"
        className={cn(
          'relative flex items-center rounded-full transition-all duration-300 flex-1 min-w-0',
          isDesktop ? 'flex-row justify-between' : 'flex-row-reverse justify-start',
          isSearchUIVisible && !isDesktop && 'w-full',
          isSearchUIVisible ? 'bg-black' : ''
        )}
      >
        <AnimatePresence>
          {isSearchUIVisible && (
            <motion.svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              aria-hidden="true"
            >
              <motion.rect
                x="0.75"
                y="0.75"
                width="calc(100% - 1.5px)"
                height="calc(100% - 1.5px)"
                rx="18"
                ry="18"
                stroke="rgb(5 150 105)"
                strokeWidth="1.5"
                fill="none"
                variants={borderVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              />
            </motion.svg>
          )}
        </AnimatePresence>

        <SearchToggleIcon
          data-testid="sb-toggle"
          isSearchUIVisible={isSearchUIVisible}
          isScrolled={isScrolled}
          isDesktop={isDesktop}
          isNarrowScreen={isNarrowScreen}
          onClick={handleToggleSearchUI}
        />

        <motion.div
          className={cn('flex items-center overflow-hidden flex-1 min-w-0')}
          variants={inputContainerVariants}
          initial="hidden"
          animate={isSearchUIVisible ? 'visible' : 'hidden'}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <AnimatePresence>
            {isSearchUIVisible && (
              <motion.div
                className={cn('flex items-center flex-1 min-w-0')}
                variants={contentVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
              >
                <SearchInputWithAutocomplete
                  value={inputValue}
                  onValueChange={setInputValue}
                  onSearchSubmit={(filters) => handleSearchExecution(filters)}
                  isScrolled={isScrolled}
                  isNarrowScreen={isNarrowScreen}
                  {...inputSuggestionProps}
                />

                <motion.div
                  className="w-px h-6 bg-zinc-700"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { delay: 0.2 } }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                />

                <div className="flex-shrink-0">
                  <SearchbarCategoryFilter
                    isScrolled={isScrolled}
                    isDesktop={isDesktop}
                    isNarrowScreen={isNarrowScreen}
                    onCategoryChange={(category) => {
                      setCategoryLocal(category ?? '');
                      handleSearchExecution({ category });
                    }}
                    selectedCategory={categoryLocal}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* “No results” pop-under (anchored to the pill) */}
        <Popover
          open={notFoundOpen}
          onOpenChange={(o) => { if (!o) onNotFoundClose?.(); }}
        >
          {/* Invisible anchor below the pill */}
          <PopoverAnchor className="absolute left-0 top-full h-0 w-0" />
          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={6}
            avoidCollisions
            className={cn(
              'w-auto max-w-[min(92vw,520px)] p-0',
              'rounded-xl border shadow-md',
              'bg-black/80 supports-[backdrop-filter]:bg-black/60 backdrop-blur',
              'border-zinc-800/60',
              'z-50'
            )}
            role="status"
            aria-live="polite"
          >
            <div className="px-3 py-2">
              {notFoundText && <p className="text-sm text-zinc-200">{notFoundText}</p>}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <SearchbarAdvancedFilter
        isDesktop={isDesktop}
        isNarrowScreen={isNarrowScreen}
        isScrolled={isScrolled}
        isVisible={isSearchUIVisible}
        initialFilters={{ location, creator, date: selectedDate }}
        onApplyFilters={handleAdvancedFilterApply}
        disableCreatorFilter={disableCreatorFilter}
        isPanelOpen={isFilterPanelOpen}
        onPanelToggle={setIsFilterPanelOpen}
        {...advSuggestionProps}
      />
    </div>
  );
}
