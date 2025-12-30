'use client';

import { useState, useId, useMemo } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { FormLabel } from '@/components/ui/form';
import { GROUPED_TZ, cn, formatTimeZoneLabel } from '@/lib/utils';
import { TimezoneInfoTooltip } from '../InfoTooltip';

export interface TimeZoneSelectorProps {
  tzMode: 'auto' | 'manual';
  onTzModeChange: (v: 'auto' | 'manual') => void;
  eventTimeZone?: string;
  onEventTimeZoneChange: (tz: string) => void;
  viewerTz: string;
  label?: string;
  className?: string;
  eventTzError?: string;
}

export function TimeZoneSelector({
  tzMode,
  onTzModeChange,
  eventTimeZone,
  onEventTimeZoneChange,
  viewerTz,
  className,
  eventTzError,
}: TimeZoneSelectorProps) {
  const baseId = useId();
  const autoId = `${baseId}-auto`;
  const manualId = `${baseId}-manual`;
  const isAuto = tzMode === 'auto';
  const isManual = tzMode === 'manual';

  // control popover open state so we can close it on selection
  const [open, setOpen] = useState(false);

  const formattedTz = useMemo(() => {
    return Object.fromEntries(
      Object.entries(GROUPED_TZ).map(([continent, zones]) => [
        continent,
        zones.map((tz) => ({ value: tz, label: formatTimeZoneLabel(tz) })),
      ])
    ) as Record<string, Array<{ value: string; label: string }>>;
  }, []);

  return (
    <div className={cn('flex flex-col items-start', className)}>
      <div className="mb-1.5 flex items-start gap-2">
        <FormLabel className="text-white font-heading">Timezone</FormLabel>
        <TimezoneInfoTooltip
          where="creator-form"
          side="right"
          align="start"
          popoverSide="top"
          popoverAlign="start"
          size="sm"
          triggerMode="both"
          ariaLabel="Help to understand timezones"
          className='w-4 h-4 mt-[1px]'
          maxWidth='max-w-xs md:max-w-sm'
        />
      </div>

      <RadioGroup
        onValueChange={(v) => onTzModeChange(v as 'auto' | 'manual')}
        value={tzMode}
        className="mt-2 flex flex-wrap items-center justify-start gap-4 md:gap-6"
      >
        {/* AUTO */}
        <div className="flex items-center gap-2 min-w-0">
          <RadioGroupItem
            id={autoId}
            value="auto"
            className={cn(
              'relative overflow-hidden bg-transparent !text-transparent shadow-none',
              'transition-[border-color,opacity,box-shadow] duration-500 ease-in-out',
              'data-[state=unchecked]:border-zinc-600',
              'data-[state=checked]:border-emerald-500',
              "before:content-[''] before:absolute before:inset-[2px] before:rounded-full before:transition-opacity before:duration-500 before:ease-in-out",
              'data-[state=unchecked]:before:bg-black data-[state=unchecked]:before:opacity-100',
              "data-[state=checked]:before:bg-[radial-gradient(circle_at_center,rgba(16,185,129,1)_0%,rgba(16,185,129,0.50)_55%,rgba(16,185,129,0.20)_80%,transparent_88%)] data-[state=checked]:before:opacity-100",
              "after:content-[''] after:absolute after:-inset-2 after:rounded-full after:transition-opacity after:duration-500 after:ease-in-out",
              'data-[state=unchecked]:after:opacity-0',
              "data-[state=checked]:after:opacity-100 data-[state=checked]:after:bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.55)_14%,transparent_72%)]",
              'data-[state=unchecked]:shadow-none',
              'data-[state=checked]:shadow-[0_0_16px_3px_rgba(16,185,129,0.60)]'
            )}
          />
          <label
            htmlFor={autoId}
            className={cn(
              'cursor-pointer font-semibold font-display text-xs transition-colors duration-300 select-none',
              isAuto ? 'text-emerald-400' : 'text-white'
            )}
          >
            Auto
          </label>

          <span
            className={cn(
              'text-zinc-400 text-sm transition-all duration-200 relative',
              isAuto
                ? 'opacity-100 translate-y-[1px]' // 1px downward shift when visible
                : 'opacity-0 -translate-y-0.5 pointer-events-none'
            )}
          >
            ({formatTimeZoneLabel(viewerTz)})
          </span>
        </div>

        {/* MANUAL */}
        <div className="flex items-center gap-2 min-w-0">
          <RadioGroupItem
            id={manualId}
            value="manual"
            className={cn(
              'relative overflow-hidden bg-transparent !text-transparent shadow-none',
              'transition-[border-color,opacity,box-shadow] duration-500 ease-in-out',
              'data-[state=unchecked]:border-zinc-600',
              'data-[state=checked]:border-rose-500',
              "before:content-[''] before:absolute before:inset-[2px] before:rounded-full before:transition-opacity before:duration-500 before:ease-in-out",
              'data-[state=unchecked]:before:bg-black data-[state=unchecked]:before:opacity-100',
              "data-[state=checked]:before:bg-[radial-gradient(circle_at_center,rgba(244,63,94,1)_0%,rgba(244,63,94,0.50)_55%,rgba(244,63,94,0.20)_80%,transparent_88%)] data-[state=checked]:before:opacity-100",
              "after:content-[''] after:absolute after:-inset-2 after:rounded-full after:transition-opacity after:duration-500 after:ease-in-out",
              'data-[state=unchecked]:after:opacity-0',
              "data-[state=checked]:after:opacity-100 data-[state=checked]:after:bg-[radial-gradient(circle_at_center,rgba(244,63,94,0.55)_14%,transparent_72%)]",
              'data-[state=unchecked]:shadow-none',
              'data-[state=checked]:shadow-[0_0_16px_3px_rgba(244,63,94,0.60)]'
            )}
          />
          <label
            htmlFor={manualId}
            className={cn(
              'cursor-pointer font-semibold font-display text-xs transition-colors duration-300 select-none',
              isManual ? 'text-rose-400' : 'text-white'
            )}
          >
            Manual
          </label>

          <div
            className={cn(
              'transition-all duration-200 flex-none',
              isManual ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-0.5 pointer-events-none'
            )}
          >
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="px-3 py-1.5 border border-zinc-700 rounded-md bg-black text-sm hover:bg-white hover:text-black transition-colors ease-in-out duration-300 whitespace-nowrap cursor-pointer"
                >
                  {eventTimeZone ? formatTimeZoneLabel(eventTimeZone) : 'Select TZ'}
                </button>
              </PopoverTrigger>

              <PopoverContent
                align="start"
                sideOffset={8}
                className="z-50 p-0 bg-black text-white border border-zinc-700 rounded-lg shadow-xl max-md:max-w-64"
              >
                <Command className="bg-black text-white">
                  {/* sticky input */}
                  <CommandInput
                    placeholder="Search timezone…"
                    className="sticky top-0 z-10 bg-black placeholder:text-zinc-400 px-3 pt-[3px] pb-0 mb-[3px] rounded-none border-b border-zinc-800"
                  />

                  {/* list with its own scroll */}
                  <CommandList className="max-h-[45dvh] overflow-y-auto overscroll-contain">
                    <CommandEmpty className="p-3 text-sm text-zinc-400">
                      No results.
                    </CommandEmpty>

                    {Object.entries(formattedTz).map(([continent, items]) => (
                      <CommandGroup
                        key={continent}
                        heading={continent}
                        className="px-2 py-1 [&>[cmdk-group-heading]]:text-emerald-400"
                      >
                        {items.map(({ value, label }) => (
                          <CommandItem
                            key={value}
                            // make the Command filter use the human-readable label
                            value={label}
                            onSelect={() => {
                              onEventTimeZoneChange(value); // ← store the original IANA
                              setOpen(false);
                            }}
                            className="cursor-pointer px-3 py-2 text-white
                                        hover:bg-emerald-200 hover:text-black
                                        data-[selected=true]:bg-emerald-200 data-[selected=true]:text-black
                                        focus:bg-emerald-200 focus:text-black"
                          >
                            {label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </RadioGroup>

      {eventTzError && isManual && (
        <p className="mt-2 text-xs text-rose-400">{eventTzError}</p>
      )}
    </div>
  );
}
