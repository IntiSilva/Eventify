import { describe, expect, it } from 'vitest';
import {
  getEventJoinability,
  getEventJoinabilityBlockedMessage,
} from '@/lib/events/joinability';

describe('events/joinability', () => {
  it('returns joinable only when event is not archived and starts strictly after now', () => {
    const now = new Date('2026-03-06T15:00:00.000Z');

    expect(
      getEventJoinability({
        date: new Date('2026-03-06T15:01:00.000Z'),
        archivedAt: null,
        now,
      })
    ).toEqual({ isJoinable: true });

    expect(
      getEventJoinability({
        date: new Date('2026-03-06T15:00:00.000Z'),
        archivedAt: null,
        now,
      })
    ).toEqual({
      isJoinable: false,
      reason: 'EVENT_STARTED',
      message: getEventJoinabilityBlockedMessage('EVENT_STARTED'),
    });
  });

  it('fails closed for archived events regardless of date', () => {
    const now = new Date('2026-03-06T15:00:00.000Z');

    expect(
      getEventJoinability({
        date: new Date('2026-03-07T15:00:00.000Z'),
        archivedAt: new Date('2026-03-01T00:00:00.000Z'),
        now,
      })
    ).toEqual({
      isJoinable: false,
      reason: 'EVENT_ARCHIVED',
      message: getEventJoinabilityBlockedMessage('EVENT_ARCHIVED'),
    });
  });
});
