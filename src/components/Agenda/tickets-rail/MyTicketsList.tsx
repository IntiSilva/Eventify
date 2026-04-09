'use client';

import MyTicketCard from './MyTicketCard';
import MyTicketCardSkeleton from './MyTicketCardSkeleton';
import type { ViewerTicketRecord } from '@/types/api';

type MyTicketsListProps = {
  upcoming: ViewerTicketRecord[];
  past: ViewerTicketRecord[];
  openableEventIds: ReadonlySet<string>;
  onViewTicket: (paymentId: string) => void;
  onViewEvent?: (eventId: string) => void;
  loading?: boolean;
};

function TicketSection({
  title,
  emptyLabel,
  isPastSection,
  items,
  openableEventIds,
  onViewTicket,
  onViewEvent,
  loading = false,
  loadingCards = 1,
}: {
  title: string;
  emptyLabel: string;
  isPastSection: boolean;
  items: ViewerTicketRecord[];
  openableEventIds: ReadonlySet<string>;
  onViewTicket: (paymentId: string) => void;
  onViewEvent?: (eventId: string) => void;
  loading?: boolean;
  loadingCards?: number;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        {loading ? (
          <>
            <span className="skeleton h-3 w-20" />
            <span className="skeleton h-3 w-6" />
          </>
        ) : (
          <>
            <h3 className="text-xs uppercase tracking-[0.14em] text-zinc-100">{title}</h3>
            <span className="text-[11px] text-emerald-400">{items.length}</span>
          </>
        )}
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: loadingCards }).map((_, index) => (
            <MyTicketCardSkeleton key={`${title.toLowerCase()}-skeleton-${index}`} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-zinc-800/80 bg-black/25 px-3 py-2.5 text-sm text-zinc-500">
          {emptyLabel}
        </p>
      ) : (
        <div className="space-y-2.5">
          {items.map((ticket) => (
            <MyTicketCard
              key={ticket.paymentId}
              ticket={ticket}
              isPastEvent={isPastSection}
              isEventOpenable={openableEventIds.has(ticket.event.id)}
              onViewTicket={onViewTicket}
              onViewEvent={onViewEvent}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function MyTicketsList({
  upcoming,
  past,
  openableEventIds,
  onViewTicket,
  onViewEvent,
  loading = false,
}: MyTicketsListProps) {
  return (
    <div className="space-y-5">
      <TicketSection
        title="Upcoming"
        emptyLabel="No upcoming ticketed events."
        isPastSection={false}
        items={upcoming}
        openableEventIds={openableEventIds}
        onViewTicket={onViewTicket}
        onViewEvent={onViewEvent}
        loading={loading}
        loadingCards={2}
      />

      <TicketSection
        title="Past"
        emptyLabel="No past ticket records yet."
        isPastSection={true}
        items={past}
        openableEventIds={openableEventIds}
        onViewTicket={onViewTicket}
        onViewEvent={onViewEvent}
        loading={loading}
        loadingCards={1}
      />
    </div>
  );
}
