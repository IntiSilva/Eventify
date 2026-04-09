'use client';

import { ArrowLeft, CalendarClock } from 'lucide-react';

import { useViewerTz } from '@/contexts/ViewerTzContext';
import { Separator } from '@/components/ui/separator';
import { cn, formatPrice } from '@/lib/utils';
import type { ViewerTicketRecord } from '@/types/api';

type MyTicketDetailsProps = {
  ticket: ViewerTicketRecord;
  isEventOpenable: boolean;
  onBack: () => void;
  onViewEvent?: (eventId: string) => void;
};

function getTicketStateLabel(ticketState: ViewerTicketRecord['ticketState']): string {
  switch (ticketState) {
    case 'refund_pending':
      return 'Refund pending';
    case 'refunded':
      return 'Refunded';
    case 'paid':
    default:
      return 'Paid';
  }
}

function getTicketStateClass(ticketState: ViewerTicketRecord['ticketState']): string {
  switch (ticketState) {
    case 'refund_pending':
      return 'border-amber-500/30 bg-amber-950/40 text-amber-200';
    case 'refunded':
      return 'border-zinc-700/80 bg-zinc-900/60 text-zinc-300';
    case 'paid':
    default:
      return 'border-emerald-600/30 bg-emerald-950/30 text-emerald-200';
  }
}

function getTicketStateNarrative(ticketState: ViewerTicketRecord['ticketState']): string {
  switch (ticketState) {
    case 'refund_pending':
      return 'Your refund request is being processed. Your purchase remains in review until the request is resolved.';
    case 'refunded':
      return 'This ticket purchase has been refunded. If you want to attend again, you may need to purchase a new ticket.';
    case 'paid':
    default:
      return 'Your ticket purchase is confirmed and active for this event.';
  }
}

function formatRefundStatus(status: string): string {
  return String(status)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-right text-sm text-zinc-200">{value}</dd>
    </div>
  );
}

export default function MyTicketDetails({
  ticket,
  isEventOpenable,
  onBack,
  onViewEvent,
}: MyTicketDetailsProps) {
  const { formatDate } = useViewerTz();

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-8 items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/45 px-3 text-xs text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/70"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to tickets
      </button>

      <section className="rounded-xl border border-zinc-800/90 bg-black/40 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium',
              getTicketStateClass(ticket.ticketState)
            )}
          >
            {getTicketStateLabel(ticket.ticketState)}
          </span>
        </div>
        <h3 className="mt-2 text-base font-semibold text-zinc-100">{ticket.event.title}</h3>
        <p className="mt-1 text-sm text-zinc-400">{getTicketStateNarrative(ticket.ticketState)}</p>
      </section>

      <section className="space-y-2 rounded-xl border border-zinc-800/90 bg-black/35 p-3.5">
        <h4 className="text-xs uppercase tracking-[0.14em] text-zinc-400">Event summary</h4>
        <Separator className="bg-zinc-800/80" />
        <dl className="space-y-2">
          <DetailRow
            label="When"
            value={formatDate(ticket.event.date, undefined, {
              showYear: true,
              weekday: 'long',
              month: 'long',
            })}
          />
          <DetailRow label="Location" value={ticket.event.location} />
          <DetailRow label="Event timezone" value={ticket.event.eventTimeZone} />
        </dl>
      </section>

      <section className="space-y-2 rounded-xl border border-zinc-800/90 bg-black/35 p-3.5">
        <h4 className="text-xs uppercase tracking-[0.14em] text-zinc-400">Ticket payment</h4>
        <Separator className="bg-zinc-800/80" />
        <dl className="space-y-2">
          <DetailRow
            label="Amount paid"
            value={formatPrice(ticket.payment.amountCents, ticket.payment.currency) || '\u2014'}
          />
          <DetailRow
            label="Purchased"
            value={formatDate(ticket.payment.paidAt, undefined, {
              showYear: true,
              weekday: 'none',
              month: 'short',
            })}
          />
        </dl>
      </section>

      {ticket.refund || ticket.ticketState !== 'paid' ? (
        <section className="space-y-2 rounded-xl border border-zinc-800/90 bg-black/35 p-3.5">
          <h4 className="text-xs uppercase tracking-[0.14em] text-zinc-400">Refund snapshot</h4>
          <Separator className="bg-zinc-800/80" />
          {ticket.refund ? (
            <dl className="space-y-2">
              <DetailRow label="Request state" value={formatRefundStatus(ticket.refund.status)} />
              {ticket.refund.requestedAt ? (
                <DetailRow
                  label="Requested"
                  value={formatDate(ticket.refund.requestedAt, undefined, {
                    showYear: true,
                    weekday: 'none',
                    month: 'short',
                  })}
                />
              ) : null}
              {ticket.refund.updatedAt ? (
                <DetailRow
                  label="Last update"
                  value={formatDate(ticket.refund.updatedAt, undefined, {
                    showYear: true,
                    weekday: 'none',
                    month: 'short',
                  })}
                />
              ) : null}
              {ticket.refund.succeededAt ? (
                <DetailRow
                  label="Refunded at"
                  value={formatDate(ticket.refund.succeededAt, undefined, {
                    showYear: true,
                    weekday: 'none',
                    month: 'short',
                  })}
                />
              ) : null}
            </dl>
          ) : (
            <p className="text-sm text-zinc-500">Refund details are not available for this purchase.</p>
          )}
        </section>
      ) : null}

      {isEventOpenable && onViewEvent ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onViewEvent(ticket.event.id)}
            className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/50 px-3 text-xs text-zinc-100 transition-colors hover:border-zinc-600 hover:bg-zinc-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/70"
          >
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            View event
          </button>
        </div>
      ) : null}
    </div>
  );
}
