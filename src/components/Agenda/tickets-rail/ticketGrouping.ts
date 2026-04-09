import type { ViewerTicketRecord } from '@/types/api';

export type GroupedViewerTickets = {
  upcoming: ViewerTicketRecord[];
  past: ViewerTicketRecord[];
};

function toSafeTimestamp(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function groupViewerTicketsByEventTime(
  tickets: ViewerTicketRecord[],
  now: Date = new Date()
): GroupedViewerTickets {
  const nowMs = now.getTime();

  const upcoming: ViewerTicketRecord[] = [];
  const past: ViewerTicketRecord[] = [];

  for (const ticket of tickets) {
    const eventMs = toSafeTimestamp(ticket.event.date);
    if (eventMs >= nowMs) {
      upcoming.push(ticket);
    } else {
      past.push(ticket);
    }
  }

  upcoming.sort((a, b) => {
    const dateDiff = toSafeTimestamp(a.event.date) - toSafeTimestamp(b.event.date);
    if (dateDiff !== 0) return dateDiff;
    return toSafeTimestamp(a.payment.paidAt) - toSafeTimestamp(b.payment.paidAt);
  });

  past.sort((a, b) => {
    const dateDiff = toSafeTimestamp(b.event.date) - toSafeTimestamp(a.event.date);
    if (dateDiff !== 0) return dateDiff;
    return toSafeTimestamp(b.payment.paidAt) - toSafeTimestamp(a.payment.paidAt);
  });

  return { upcoming, past };
}
