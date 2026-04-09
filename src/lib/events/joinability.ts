export type EventJoinabilityBlockedReason = 'EVENT_ARCHIVED' | 'EVENT_STARTED';

export type EventJoinabilityResult =
  | { isJoinable: true }
  | {
      isJoinable: false;
      reason: EventJoinabilityBlockedReason;
      message: string;
    };

type DateLike = Date | string | number;

export type EventJoinabilityInput = {
  date: DateLike;
  archivedAt?: DateLike | null;
  now?: Date;
};

export function getEventJoinabilityBlockedMessage(
  reason: EventJoinabilityBlockedReason
): string {
  if (reason === 'EVENT_ARCHIVED') {
    return 'This event is archived and no longer accepts new attendance or ticket purchases.';
  }
  return 'This event has already started and no longer accepts new attendance or ticket purchases.';
}

function toDate(value: DateLike | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getEventJoinability(
  input: EventJoinabilityInput
): EventJoinabilityResult {
  const now = input.now ?? new Date();
  const archivedAt = toDate(input.archivedAt);
  if (archivedAt) {
    return {
      isJoinable: false,
      reason: 'EVENT_ARCHIVED',
      message: getEventJoinabilityBlockedMessage('EVENT_ARCHIVED'),
    };
  }

  const eventStart = toDate(input.date);
  if (!eventStart || eventStart.getTime() <= now.getTime()) {
    return {
      isJoinable: false,
      reason: 'EVENT_STARTED',
      message: getEventJoinabilityBlockedMessage('EVENT_STARTED'),
    };
  }

  return { isJoinable: true };
}
