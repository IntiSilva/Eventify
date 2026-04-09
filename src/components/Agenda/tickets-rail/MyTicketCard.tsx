'use client';

import { CalendarClock, MapPin, ReceiptText } from 'lucide-react';

import { useViewerTz } from '@/contexts/ViewerTzContext';
import { cn, formatPrice } from '@/lib/utils';
import type { ViewerTicketRecord } from '@/types/api';
import styles from './MyTicketCard.module.css';

type MyTicketCardProps = {
  ticket: ViewerTicketRecord;
  isPastEvent: boolean;
  isEventOpenable: boolean;
  onViewTicket: (paymentId: string) => void;
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
      return 'border-rose-700/40 bg-rose-900/30 text-rose-200';
    case 'paid':
    default:
      return 'border-emerald-600/30 bg-emerald-950/30 text-emerald-200';
  }
}

function getTicketStateHint(ticketState: ViewerTicketRecord['ticketState']): string {
  switch (ticketState) {
    case 'refund_pending':
      return 'Refund request in progress.';
    case 'refunded':
      return 'This purchase was refunded.';
    case 'paid':
    default:
      return 'Ticket confirmed.';
  }
}

export default function MyTicketCard({
  ticket,
  isPastEvent,
  isEventOpenable,
  onViewTicket,
  onViewEvent,
}: MyTicketCardProps) {
  const { formatDate } = useViewerTz();
  const isPastRefunded = isPastEvent && ticket.ticketState === 'refunded';
  const isCurrentTicket = !isPastEvent;

  return (
    <article
      className={cn(
        styles.ticketCardFrame,
        isCurrentTicket ? styles.ticketCardCurrent : null,
        isPastEvent ? (isPastRefunded ? styles.ticketCardPastRefunded : styles.ticketCardPast) : null
      )}
    >
      <div className={styles.ticketCardShell}>
        <h3 className="line-clamp-2 text-sm font-medium text-zinc-100 md:text-[15px]">
          {ticket.event.title}
        </h3>

        <div className="mt-2 space-y-1 px-2 text-xs text-zinc-400">
          <p className="flex items-start gap-1.5">
            <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
            <span className="leading-5">
              {formatDate(ticket.event.date, undefined, {
                showYear: true,
                weekday: 'short',
                month: 'short',
              })}
            </span>
          </p>
          <p className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
            <span className="line-clamp-1 leading-5 md:line-clamp-2">{ticket.event.location}</span>
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium',
              getTicketStateClass(ticket.ticketState)
            )}
          >
            {getTicketStateLabel(ticket.ticketState)}
          </span>

          <span className="inline-flex items-center gap-1 text-xs text-zinc-300">
            <ReceiptText className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
            <span>{formatPrice(ticket.payment.amountCents, ticket.payment.currency) || '\u2014'}</span>
          </span>
        </div>

        <div className="mt-2 px-2 text-[11px] text-zinc-500">
          <p>
            Paid{' '}
            {formatDate(ticket.payment.paidAt, undefined, {
              showYear: true,
              weekday: 'none',
              month: 'short',
            })}
          </p>
          <p className="mt-1">{getTicketStateHint(ticket.ticketState)}</p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onViewTicket(ticket.paymentId)}
            className={cn(
              'inline-flex h-8 items-center rounded-full border border-emerald-800/35 bg-white/[0.045] px-3 text-xs font-medium text-zinc-100 transition-colors',
              'cursor-pointer',
              'hover:border-emerald-700/45 hover:bg-white/[0.07]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50'
            )}
          >
            Ticket details
          </button>

          {isEventOpenable && onViewEvent ? (
            <button
              type="button"
              onClick={() => onViewEvent(ticket.event.id)}
              className={cn(
                'inline-flex h-8 items-center rounded-full border border-zinc-700 bg-zinc-900/50 px-3 text-xs text-zinc-100 transition-colors',
                'cursor-pointer',
                'hover:border-zinc-600 hover:bg-zinc-800/60',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/70'
              )}
            >
              View event
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
