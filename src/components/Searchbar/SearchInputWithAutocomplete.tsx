'use client'

import { useState, useEffect, useRef, Fragment } from 'react';
import { Input } from '@/components/ui/input';
import { Command, CommandGroup, CommandItem, CommandList, CommandSeparator } from '../ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizeStringForSearch } from '@/lib/utils';
import { SearchbarFilters } from './Searchbar';
import type { SearchSuggestionsResponse, ApiErrorResponse } from '@/types/api';

// Evita crear objetos/arrays nuevos en cada render
type GlobalScope = { type: 'global' };
type OrganizerScope = { type: 'organizer' };
type AdminScope = { type: 'admin'; userId: string };
type AgendaScope = { type: 'agenda' };
export type SuggestionScope = GlobalScope | OrganizerScope | AdminScope | AgendaScope;

// Default “global” con identidad estable
const DEFAULT_SCOPE: GlobalScope = { type: 'global' };
// Índice local mutable (no readonly) para que no choque con la prop
const EMPTY_INDEX: Array<{ title: string }> = [];


interface SearchInputWithAutocompleteProps {
  value: string;
  onValueChange: (value: string) => void;
  onSearchSubmit: (filters: SearchbarFilters) => void;
  isScrolled: boolean;
  isNarrowScreen?: boolean;

  // === New props ===
  mode?: 'server' | 'local'; // default: 'server'
  scope?: SuggestionScope;   // default: { type: 'global' }
  localIndex?: Array<{ title: string }>; // used only when mode='local'
}

export default function SearchInputWithAutocomplete({
  value,
  onValueChange,
  onSearchSubmit,
  isScrolled,
  isNarrowScreen,

  // safe defaults
  mode = 'server',
  scope: scopeProp,
  localIndex: localIndexProp,
}: SearchInputWithAutocompleteProps) {

    // Referencias estables si el padre no las pasa
  const scope: SuggestionScope = scopeProp ?? DEFAULT_SCOPE;
  const localIndex = localIndexProp ?? EMPTY_INDEX;
  const { type } = scope;
  const userId = type === 'admin' ? scope.userId : undefined;


  // Clave estable para deps del effect (sin objetos)
  const scopeKey = type === 'admin' ? `admin:${scope.userId}` : type;


  const inputRef = useRef<HTMLInputElement>(null);
  const hadTextRef = useRef(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // Save the value that panel had when closing, when user changes the input, lift the supression 
  // so the suggestions panel doesn't open after searching innecesarly.
  const suppressUntilChangeRef = useRef<string | null>(null);

  useEffect(() => {
    if (suppressUntilChangeRef.current !== null &&
        value !== suppressUntilChangeRef.current) {
      suppressUntilChangeRef.current = null;
    }
  }, [value]);

  // Debounced effect to fetch suggestions
      useEffect(() => {
    if (value.length < 2) {
      setSuggestions([]);
      setIsPanelOpen(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const timer = setTimeout(async () => {
      try {
        // MODO LOCAL
        if (mode === 'local') {
          const q = normalizeStringForSearch(value);
          const seen = new Set<string>();
          const out: string[] = [];

          for (const e of localIndex) {
            if (normalizeStringForSearch(e.title).includes(q)) {
              if (!seen.has(e.title)) {
                seen.add(e.title);
                out.push(e.title);
              }
            }
            if (out.length >= 8) break;
          }

          if (!cancelled) {
            const suppressed = suppressUntilChangeRef.current === value;
            setSuggestions(out);
            setIsPanelOpen(!suppressed && out.length > 0);
          }
          return;
        }

        // MODO SERVER
        const params = new URLSearchParams({ field: 'title', query: value });
        if (type !== 'global') {
          params.set('scope', type);
          if (type === 'admin' && userId) {
            params.set('userId', userId); // => exist and it's a string
          }
        }

        const res = await fetch(`/api/search-suggestions?${params.toString()}`);
        const json = (await res.json().catch(() => null)) as | SearchSuggestionsResponse | ApiErrorResponse | null;

        if (!cancelled) {
        // Network / HTTP / JSON or logical error => we log and return empty suggestions
        if (!res.ok || !json || !json.success) {
          const errMsg =
            json && !json.success
              ? json.error
              : `HTTP ${res.status}`;
          console.error('Failed to fetch title suggestions:', errMsg);

          setSuggestions([]);
          setIsPanelOpen(false);
          return;
        }
        // At this point json is SearchSuggestionsResponse (success: true, data: string[])
        const suppressed = suppressUntilChangeRef.current === value;
        const list = json.data;
        setSuggestions(list);
        setIsPanelOpen(!suppressed && list.length > 0);
      }
      } catch (err) {
        console.error('Failed to fetch title suggestions:', err);
        if (!cancelled) setIsPanelOpen(false);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };

  }, [value, mode, type, userId, scopeKey, localIndex]);



  // Prevent stale searches sticking around after clearing input with the “X”
  useEffect(() => {
    hadTextRef.current = value.trim().length > 0;
  }, [value]);

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Close and supress re-open until input changes
    suppressUntilChangeRef.current = value;
    setIsPanelOpen(false);

    onSearchSubmit({ search: value });
  };

  const handleSuggestionClick = (suggestion: string) => {
    onValueChange(suggestion);

    // Close and supress re-open until input changes
    suppressUntilChangeRef.current = suggestion;
    setIsPanelOpen(false);

    onSearchSubmit({ search: suggestion });
  };

  return (
    <Popover
      open={isPanelOpen}
      onOpenChange={(next) => {
        // If trigger tries to open (click/focus) but we are supressed
        // ignore it until the actual input changes.
        if (next && suppressUntilChangeRef.current === value) return;
        setIsPanelOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <form onSubmit={handleFormSubmit} className="flex-1 min-w-0">
          <Input
            data-testid="sb-input"
            ref={inputRef}
            type="search"
            aria-label='Search'
            placeholder="Search..."
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            className={cn(
              'w-full bg-transparent border-0 rounded-none text-white placeholder:text-zinc-400 focus-visible:ring-0',
              // Unified responsive sizing (fixed Tailwind important syntax)
              isNarrowScreen
                ? (isScrolled ? '!h-7 text-[11px]' : '!h-8 text-[12px]')
                : (isScrolled ? '!h-8 text-xs' : '!h-9 text-sm')
            )}
          />
        </form>
      </PopoverTrigger>

      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 bg-black border-zinc-700 text-white"
        align="start"
        // Prevent popover from stealing focus from the input when opening
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command className="bg-black">
          <CommandList className="max-h-[300px] overflow-y-auto overflow-x-hidden p-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-emerald-900 [&::-webkit-scrollbar-thumb:hover]:bg-emerald-600 [&::-webkit-scrollbar-thumb:active]:bg-emerald-500">
            {isLoading ? (
              <div className="p-3 text-sm text-zinc-400 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching...
              </div>
            ) : (
              <CommandGroup data-testid="sb-suggestions">
                {suggestions.map((suggestion, index) => (
                  <Fragment key={`${suggestion}-${index}`}>
                    <CommandItem
                      data-testid="sb-suggestion-item"
                      value={suggestion}
                      onSelect={() => handleSuggestionClick(suggestion)}
                      className="cursor-pointer !bg-black !text-white hover:!text-black hover:!bg-emerald-200 mb-1"
                    >
                      {suggestion}
                    </CommandItem>
                    {/* Separator between items, except the last one */}
                    {index < suggestions.length - 1 && (
                      <CommandSeparator className="bg-zinc-700 mx-2" />
                    )}
                  </Fragment>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
