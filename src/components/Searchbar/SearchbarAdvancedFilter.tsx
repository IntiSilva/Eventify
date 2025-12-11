'use client'

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { startOfDay, addYears } from 'date-fns';
import { X } from 'lucide-react';
import MorphIcon from '../LordIcons/MorphIcon';
import AutocompleteInput from './AutocompleteInput';
import { Button } from '../ui/button';
import { DateTimePicker } from '../ui/datetime-picker';
import { SettingsSliderAnimatedIcon, SettingsSliderAnimatedIconClick } from '@/lib/icons';
import { SearchbarFilterExtension, type SuggestionScope } from './Searchbar'; // Assuming Searchbar exports this
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

// This type should mirror the filters in the main Searchbar component
interface SearchbarAdvancedFilterState {
  location: string;
  creator: string;
  date?: Date;
}

interface SearchbarAdvancedFilterProps {
  isDesktop: boolean;
  isNarrowScreen: boolean;
  isScrolled: boolean;
  isVisible: boolean;
  isPanelOpen: boolean;
  onPanelToggle: (isOpen: boolean) => void;
  initialFilters: SearchbarAdvancedFilterState;
  onApplyFilters: (filters: SearchbarAdvancedFilterState) => void;
  disableCreatorFilter?: boolean;
  suggestionMode?: 'server' | 'local';
  suggestionScope?: SuggestionScope;
  localIndex?: Array<{ title: string; location: string; creatorLabel: string }>;
}

export default function SearchbarAdvancedFilter({
  isDesktop,
  isNarrowScreen,
  isScrolled,
  isVisible,
  isPanelOpen,
  onPanelToggle,
  initialFilters,
  onApplyFilters,
  disableCreatorFilter = false,
  suggestionMode = 'server',
  suggestionScope = { type: 'global' },
  localIndex,
}: SearchbarAdvancedFilterProps) {
  const [location, setLocation] = useState(initialFilters.location);
  const [creator, setCreator] = useState(initialFilters.creator);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(initialFilters.date);

  const handleApply = () => {
    onApplyFilters({
      location,
      creator,
      date: selectedDate,
    });
    onPanelToggle(false);
  };

  const handleClearAll = () => {
    const nextLocation = '';
    const nextCreator = '';
    const nextDate: Date | undefined = undefined;

    setLocation(nextLocation);
    setCreator(nextCreator);
    setSelectedDate(nextDate);

    onApplyFilters({
      location: nextLocation,
      creator: nextCreator,
      date: nextDate,
    });
     onPanelToggle(false);
  };


  if (!isVisible) return null;

  return (
    <div className={cn("relative", !isDesktop && "order-first")}>
      <Popover open={isPanelOpen} onOpenChange={onPanelToggle} modal={false}>
        <PopoverTrigger asChild>
          <button
            data-testid="sb-adv-open"
            onClick={() => onPanelToggle(!isPanelOpen)}
            className={cn(
              "flex items-center overflow-visible justify-center rounded-full transition-all duration-300 ease-in-out shrink-0",
              isNarrowScreen
                ? (isScrolled ? 'w-[28px] h-[28px]' : 'w-[32px] h-[32px]')
                : (isScrolled ? 'w-[33px] h-[33px]' : 'w-9 h-9'),
            )}
            aria-label="Advanced Filters"
            aria-expanded={isPanelOpen}
          >
            <MorphIcon
              icon={SettingsSliderAnimatedIconClick}
              introIcon={SettingsSliderAnimatedIcon}
              isMorphed={isPanelOpen}
              playIntro={isVisible}
              introDelay={300}
              introDuration={400}
              size={isNarrowScreen ? (isScrolled ? 16 : 18) : (isScrolled ? 20 : 22)}
              colors={{ primary: '#ffffff' }}
              className='cursor-pointer transition-transform duration-200 ease-in'
            />
          </button>
        </PopoverTrigger>

        {/* Border/Tab extension anchored to the bar */}
        <AnimatePresence>
          {isPanelOpen && (
            <SearchbarFilterExtension
              isDesktop={isDesktop}
              isNarrowScreen={isNarrowScreen}
              isScrolled={isScrolled}
            />
          )}
        </AnimatePresence>

        {/* Portaled content to avoid clipping inside accordions */}
        <PopoverContent
          side="bottom"
          align={isDesktop ? "end" : "start"}
          sideOffset={8}
          className="z-[200] p-0 bg-transparent border-none shadow-none"
        >
          <motion.div
            data-testid="sb-adv-panel"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className={cn(
              "w-72 bg-black border border-zinc-700 rounded-lg shadow-xl p-4",
              isDesktop ? "origin-top-right" : "origin-top-left"
            )}
          >
            <h3 className="text-white font-semibold mb-4 text-lg">Advanced Filtering</h3>

            <div className="space-y-4">
              <div data-testid="sb-location" >

                <label htmlFor="location-filter" className="text-sm font-medium text-zinc-300 block mb-1">
                  Place
                </label>
                <AutocompleteInput
                  field="location"
                  value={location}
                  onValueChange={setLocation}
                  placeholder="E.g. Buenos Aires"
                  mode={suggestionMode}
                  scope={suggestionScope}
                  localIndex={localIndex}
                />
              </div>

              {!disableCreatorFilter && (
                <div data-testid="sb-creator" >
                  <label htmlFor="creator-filter" className="text-sm font-medium text-zinc-300 block mb-1">
                    Creator
                  </label>
                  <AutocompleteInput
                    field="creator"
                    value={creator}
                    onValueChange={setCreator}
                    placeholder="e.g. intisilva"
                    mode={suggestionMode}
                    scope={suggestionScope}
                    localIndex={localIndex}
                  />
                </div>
              )}

              <div>
                <label htmlFor="date-filter" className="text-sm font-medium text-zinc-300 block mb-1">
                  Date
                </label>
                <div className="relative" data-testid="sb-date">
                  <DateTimePicker
                    granularity="day"
                    displayFormat={{ hour24: 'PPP', hour12: 'PP' }}
                    value={selectedDate}
                    onChange={setSelectedDate}
                    hidden={{
                      before: startOfDay(new Date()),
                      after: addYears(startOfDay(new Date()), 2),
                    }}
                    yearRange={2}
                    className="bg-black text-white [&>span]:text-zinc-300 border-zinc-700 hover:bg-white hover:text-black hover:[&>span]:text-black data-[state=open]:ring-2 data-[state=open]:ring-emerald-500 cursor-pointer transition-colors duration-200 ease-in"
                    popoverContentClassName="z-[300]"
                    lockPrevAtCurrentMonth={true} // Lock to current month
                    filterPastMonthsInSelect={true}
                  />
                  {selectedDate && (
                    <Button
                      data-testid="sb-clear"
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 text-zinc-400 hover:text-white"
                      onClick={() => setSelectedDate(undefined)}
                    >
                      <X size={16} />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-between">

              <Button
                data-testid="sb-clear-all"
                onClick={handleClearAll}
                className="text-white border border-zinc-500 bg-zinc-700/30 hover:bg-zinc-600/50 hover:border-zinc-400 transition-colors duration-200 ease-in"

              >
                Clear filters
              </Button>

              <Button data-testid="sb-apply" onClick={handleApply} className="bg-emerald-950/50 border border-emerald-800 text-white hover:bg-emerald-900/60 hover:border-emerald-700 transition-colors duration-200 ease-in">
                Apply Filters
              </Button>
            </div>
          </motion.div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
