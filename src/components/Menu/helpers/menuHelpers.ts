import type { TicketHistoryPillLabel } from '@/lib/payments/useViewerPaymentStatus';
import type { EditableEvent, EventWithCreatorAndRsvps } from '@/types/event';

export const isEventsListKey = (k: unknown): k is string =>
  typeof k === 'string' && k.startsWith('/api/events?');

export function isFullEvent(
  e: EditableEvent | EventWithCreatorAndRsvps | undefined
): e is EventWithCreatorAndRsvps {
  return !!e && 'rsvps' in e;
}

type FormatMenuEventDateParams = {
  date: Date;
  eventTz: string;
  viewerTz: string;
  mode: 'editable' | 'non-editable';
  showTzToggle: boolean;
  viewEventTz: boolean;
  formatDate: (date: Date, tz: string) => string;
};

export function formatMenuEventDate({
  date,
  eventTz,
  viewerTz,
  mode,
  showTzToggle,
  viewEventTz,
  formatDate,
}: FormatMenuEventDateParams): string {
  if (mode === 'editable' || !showTzToggle) {
    return formatDate(date, eventTz);
  }

  const tzToUse = viewEventTz ? eventTz : viewerTz;
  return formatDate(date, tzToUse);
}

export function getPaidTriggerAriaLabel(
  ticketHistoryPillLabel: TicketHistoryPillLabel | null
): string {
  if (ticketHistoryPillLabel === 'Refunded') {
    return 'Open refunded ticket details';
  }

  if (ticketHistoryPillLabel === 'Paid') {
    return 'Open paid ticket details';
  }

  return 'Open ticket details';
}
