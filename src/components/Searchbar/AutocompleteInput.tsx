'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronsUpDown, X, Loader2 } from 'lucide-react';
import { cn, normalizeStringForSearch, normalizeUsername } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { SearchSuggestionsResponse, ApiErrorResponse } from '@/types/api';

type SuggestionScope =
  | { type: 'global' }
  | { type: 'organizer' }
  | { type: 'admin'; userId: string }
  | { type: 'agenda' };

interface AutocompleteInputProps {
  field: 'title' | 'location' | 'creator';
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;

  // === New suggestion props ===
  mode?: 'server' | 'local'; // default: 'server'
  scope?: SuggestionScope;   // default: { type: 'global' }
  localIndex?: Array<{ title: string; location: string; creatorLabel: string }>; // used when mode='local'
}

export default function AutocompleteInput({
  field,
  value,
  onValueChange,
  placeholder = 'Select an option...',
  className,

  mode = 'server',
  scope = { type: 'global' },
  localIndex,
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');

  // Debounced effect to query suggestions
  useEffect(() => {
    if (!inputValue || inputValue.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const timer = setTimeout(async () => {
      try {
        // --- LOCAL MODE: search within the provided index ---
        if (mode === 'local' && localIndex) {
          // choose normalization function depending on field
          const normalize =
            field === 'creator' ? normalizeUsername : normalizeStringForSearch;

          const q = normalize(inputValue);
          const out = new Set<string>();

          for (const e of localIndex) {
            const hay =
              field === 'creator' ? e.creatorLabel
              : field === 'location' ? e.location
              : e.title;

            if (normalize(hay).includes(q)) {
              out.add(hay);
              if (out.size >= 8) break;
            }
          }

          if (!cancelled) {
            setSuggestions(Array.from(out));
            setIsLoading(false); //  cerrar loader en local
          }
          return;
        }

        // --- SERVER MODE: query endpoint with scope ---
        const params = new URLSearchParams({ field, query: inputValue });
        if (scope?.type && scope.type !== 'global') {
          params.set('scope', scope.type);
          if (scope.type === 'admin') params.set('userId', scope.userId);
        }

        const res = await fetch(`/api/search-suggestions?${params.toString()}`);
        const json = (await res.json().catch(() => null)) as| SearchSuggestionsResponse | ApiErrorResponse | null;

        if (!cancelled) {
          if (!res.ok || !json || !json.success) {
            const errMsg =
              json && !json.success
                ? json.error
                : `HTTP ${res.status}`;
            console.error(`Failed to fetch suggestions for ${field}:`, errMsg);

            setSuggestions([]);
            return;
          }

          // json es SearchSuggestionsResponse: { success: true; data: string[] }
          setSuggestions(json.data);
        }
      } catch (error) {
        console.error(`Failed to fetch suggestions for ${field}:`, error);
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inputValue, field, mode, scope, localIndex]);

  const handleSelect = (currentValue: string) => {
    const newValue = currentValue === value ? '' : currentValue;
    onValueChange(newValue);
    setInputValue(newValue);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <PopoverTrigger asChild className="cursor-pointer">
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'w-full justify-between bg-black border-zinc-600 hover:text-black/80 transition-colors duration-200 ease-in',
              className,
              value ? 'text-white' : 'text-zinc-300/80'
            )}
            onClick={() => {
              // Open/close and prefill with current value if present
              setOpen((o) => !o);
              setInputValue(value);
            }}
          >
            <span className="truncate">{value || placeholder}</span>
            <ChevronsUpDown
              className={cn(
                'ml-2 h-4 w-4 shrink-0 text-emerald-700 transition-opacity',
                value ? 'invisible' : 'visible'
              )}
            />
          </Button>
        </PopoverTrigger>

        {value && (
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation(); // Prevent opening the popover when clearing
              onValueChange('');
              setInputValue('');
              setSuggestions([]);
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 text-emerald-700 hover:bg-transparent hover:text-white cursor-pointer"
            aria-label="Clear filter"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 bg-black border-zinc-700 text-white z-[200]"
        align="start"
      >
        <Command className="bg-black text-white">
          <CommandInput
            placeholder={`Search ${field}...`}
            value={inputValue}
            onValueChange={setInputValue}
            className="placeholder:!text-zinc-200"
          />
          <CommandList className="max-h-[300px] overflow-y-auto overflow-x-hidden p-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-emerald-900 [&::-webkit-scrollbar-thumb:hover]:bg-emerald-600 [&::-webkit-scrollbar-thumb:active]:bg-emerald-500">
            {isLoading && (
              <div className="p-2 flex justify-center items-center">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
            {!isLoading && suggestions.length === 0 && inputValue.length > 1 && (
              <CommandEmpty>No results found.</CommandEmpty>
            )}
            <CommandGroup>
              {suggestions.map((suggestion) => (
                <CommandItem
                  key={suggestion}
                  value={suggestion}
                  onSelect={handleSelect}
                  className="cursor-pointer !bg-black !text-white hover:!text-black hover:!bg-emerald-200"
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === suggestion ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {suggestion}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
