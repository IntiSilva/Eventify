'use client';

import { useCallback, useMemo, useState } from 'react';
import type { EventWithCreatorAndRsvps } from '@/types/event';
import InToHoverIcon from '@/components/LordIcons/InToHoverIcon';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/lib/hooks';
import { TicketAnimatedIcon, TicketAnimatedIconHover } from '@/lib/icons';
import { useViewerTz } from '@/contexts/ViewerTzContext';
import { derivePersonalAgendaGroups } from './selectors';

type PersonalAgendaSectionProps = {
  events: EventWithCreatorAndRsvps[];
  onOpenDetails: (event: EventWithCreatorAndRsvps) => void;
  onJumpToList?: () => void;
  onOpenMyTickets?: () => void;
  className?: string;
};

function formatStartsIn(dateValue: Date | string, now: Date): string {
  const diffMs = new Date(dateValue).getTime() - now.getTime();
  if (diffMs <= 0) return 'Already started';

  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 60) {
    return `Starts in ${Math.max(1, totalMinutes)} min`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const remainingMinutes = totalMinutes % 60;
    if (remainingMinutes === 0) {
      return `Starts in ${totalHours}h`;
    }
    return `Starts in ${totalHours}h ${remainingMinutes}m`;
  }

  const totalDays = Math.floor(totalHours / 24);
  return `Starts in ${totalDays} day${totalDays === 1 ? '' : 's'}`;
}

function formatTimelineTime(
  dateValue: Date | string,
  viewerTz: string
): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: viewerTz,
  }).format(new Date(dateValue));
}

function formatTimelineDay(
  dateValue: Date | string,
  viewerTz: string
): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: viewerTz,
  }).format(new Date(dateValue));
}

function GroupList({
  label,
  emptyLabel,
  items,
  viewerTz,
  onOpenDetails,
}: {
  label: string;
  emptyLabel: string;
  items: EventWithCreatorAndRsvps[];
  viewerTz: string;
  onOpenDetails: (event: EventWithCreatorAndRsvps) => void;
}) {
  return (
    <section
      aria-label={`${label} events`}
      className="min-w-0 rounded-xl border border-zinc-800/80 bg-black/35 p-3"
    >
      <h3 className="text-[11px] uppercase tracking-[0.14em] text-zinc-400">
        {label}
      </h3>

      {items.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{emptyLabel}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li key={`plan-${label}-${item.id}`}>
              <button
                type="button"
                onClick={() => onOpenDetails(item)}
                className={cn(
                  'w-full min-w-0 rounded-md px-2 py-1.5 text-left transition-colors cursor-pointer',
                  'hover:bg-zinc-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/60'
                )}
              >
                <p className="truncate text-sm text-zinc-100">{item.title}</p>
                <p className="text-xs text-zinc-400">
                  {formatTimelineDay(item.date, viewerTz)} |{' '}
                  {formatTimelineTime(item.date, viewerTz)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function PersonalAgendaSection({
  events,
  onOpenDetails,
  onJumpToList,
  onOpenMyTickets,
  className,
}: PersonalAgendaSectionProps) {
  const { viewerTz, formatDate } = useViewerTz();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [isMyTicketsHovered, setIsMyTicketsHovered] = useState(false);
  const [isMyTicketsIconReady, setIsMyTicketsIconReady] = useState(false);
  const handleMyTicketsIconReady = useCallback(() => setIsMyTicketsIconReady(true), []);

  const model = useMemo(
    () => derivePersonalAgendaGroups(events, viewerTz),
    [events, viewerTz]
  );
  const now = new Date();

  const upNext = model.upNext;

  return (
    <section
      aria-label="Next on your agenda"
      className={cn(
        'w-full min-w-0 overflow-hidden rounded-2xl border border-zinc-800/70 bg-black/80 p-4 md:bg-black/35 md:p-5',
        'shadow-[0_0_0_1px_rgba(255,255,255,0.02)]',
        className
      )}
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2 md:mb-5">
        <p className="text-[11px] md:text-xs uppercase tracking-[0.18em] text-zinc-400">
          Next on your agenda
        </p>

        {onOpenMyTickets ? (
          <button
            type="button"
            onClick={onOpenMyTickets}
            onMouseEnter={() => setIsMyTicketsHovered(true)}
            onMouseLeave={() => setIsMyTicketsHovered(false)}
            disabled={!isMyTicketsIconReady}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/45 px-3 text-xs text-zinc-100 transition-colors',
              'hover:border-zinc-600 hover:bg-zinc-800/60',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/70',
              'transition-opacity duration-300 ease-in cursor-pointer',
              isMyTicketsIconReady ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
          >
            <span className="pointer-events-none">
              <InToHoverIcon
                inIcon={TicketAnimatedIcon}
                hoverIcon={TicketAnimatedIconHover}
                resetTrigger={events.length}
                isParentHovered={isMyTicketsHovered}
                isDesktop={isDesktop}
                onIconReady={handleMyTicketsIconReady}
              />
            </span>
            <span>My Tickets</span>
          </button>
        ) : null}
      </header>

      {upNext ? (
        <article className="min-w-0 rounded-xl border border-emerald-900/40 bg-emerald-950/35 p-3.5 md:bg-emerald-950/10 md:p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-emerald-300/80">
            Up next
          </p>
          <h2 className="mt-1 break-words text-lg md:text-xl font-semibold font-display text-zinc-100">
            {upNext.title}
          </h2>
          <p className="mt-1 break-words text-sm text-zinc-300">
            {formatDate(upNext.date, undefined, {
              showYear: false,
              weekday: 'long',
              month: 'long',
            })}
          </p>
          <p className="mt-0.5 text-sm text-zinc-400 break-words">{upNext.location}</p>
          <p className="mt-2 text-xs text-emerald-300/90">
            {formatStartsIn(upNext.date, now)}
          </p>

          <div className="mt-3 flex flex-wrap items-stretch gap-2 sm:items-center">
            <button
              type="button"
              onClick={() => onOpenDetails(upNext)}
              className={cn(
                'inline-flex items-center rounded-full border border-emerald-800/70 bg-emerald-950/50',
                'w-full justify-center px-3 py-1.5 text-xs md:text-sm text-emerald-200 transition-colors cursor-pointer sm:w-auto sm:justify-start',
                'hover:bg-emerald-900/45 hover:border-emerald-700/80',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/60'
              )}
            >
              Open details
            </button>

            {onJumpToList ? (
              <button
                type="button"
                onClick={() => onJumpToList()}
                className={cn(
                  'inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/40',
                  'w-full justify-center px-3 py-1.5 text-xs md:text-sm text-zinc-200 transition-colors cursor-pointer sm:w-auto sm:justify-start',
                  'hover:bg-zinc-800/60 hover:border-zinc-600',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600'
                )}
              >
                Jump to list
              </button>
            ) : null}
          </div>
        </article>
      ) : null}

      <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        <GroupList
          label="Today"
          emptyLabel="No events today."
          items={model.todayItems}
          viewerTz={viewerTz}
          onOpenDetails={onOpenDetails}
        />
        <GroupList
          label="This week"
          emptyLabel="No more events this week."
          items={model.thisWeekItems}
          viewerTz={viewerTz}
          onOpenDetails={onOpenDetails}
        />
        <GroupList
          label="Later"
          emptyLabel="Nothing later yet."
          items={model.laterItems}
          viewerTz={viewerTz}
          onOpenDetails={onOpenDetails}
        />
      </div>

      <div className="mt-3.5 border-t border-zinc-800/70 pt-3">
        <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
          Planning cues
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {model.cues.map((cue) => (
            <li
              key={cue}
              className="rounded-full border border-zinc-800/80 bg-zinc-900/50 px-2.5 py-1 text-[11px] text-zinc-300"
            >
              {cue}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
