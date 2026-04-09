'use client';

import { Ticket, X } from 'lucide-react';

import { DrawerClose, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';

type MyTicketsRailHeaderProps = {
  count: number;
  loading: boolean;
};

export default function MyTicketsRailHeader({ count, loading }: MyTicketsRailHeaderProps) {
  return (
    <header className="border-b border-zinc-800/90 px-4 py-3.5 md:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <DrawerTitle className="flex items-center gap-2 text-base font-semibold text-zinc-100 md:text-lg">
            <Ticket className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
            <span>My Tickets</span>
          </DrawerTitle>
          <DrawerDescription className="mt-1 text-xs text-zinc-400">
            Your personal ticket history and current status.
          </DrawerDescription>
        </div>

        <DrawerClose asChild>
          <button
            type="button"
            aria-label="Close tickets panel"
            className={cn(
              'hidden h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/50 text-zinc-300 transition-colors md:inline-flex',
              'hover:border-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/70'
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </DrawerClose>
      </div>

      <p className="mt-2 text-[11px] text-zinc-500">
        {loading ? (
          'Loading tickets...'
        ) : (
          <>
            <span className="text-emerald-500">{count}</span> purchased tickets
          </>
        )}
      </p>
    </header>
  );
}
