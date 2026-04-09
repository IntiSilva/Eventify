import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GlobalMutate } from '@/lib/mutateHelpers';
import {
  buildViewerPaymentStatusKey,
  isConfirmedCountKey,
  revalidateAfterCheckout,
  scheduleSecondPassRevalidate,
} from '@/lib/payments/revalidateAfterCheckout';

describe('revalidateAfterCheckout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('revalidates viewer-status tuple, event list families, and confirmed-count family', async () => {
    const mutateMock = vi.fn().mockResolvedValue(undefined);

    await revalidateAfterCheckout({
      mutate: mutateMock as unknown as GlobalMutate,
      eventId: 'evt_1',
      userId: 'user_1',
    });

    expect(mutateMock).toHaveBeenCalledWith([
      '/api/payments/viewer-status',
      'evt_1',
      'user_1',
    ]);

    const predicates = mutateMock.mock.calls
      .map(([key]) => key)
      .filter((key): key is (value: unknown) => boolean => typeof key === 'function');

    expect(predicates.length).toBeGreaterThanOrEqual(2);
    expect(
      predicates.some((predicate) => predicate('/api/events?dateGroup=upcoming'))
    ).toBe(true);
    expect(
      predicates.some((predicate) => predicate('/api/agenda/upcoming-events?viewTz=UTC'))
    ).toBe(true);
    expect(
      predicates.some((predicate) => predicate('/api/events/confirmed-count?ids=evt_1'))
    ).toBe(true);
  });

  it('schedules exactly one delayed second pass', async () => {
    vi.useFakeTimers();
    const mutateMock = vi.fn().mockResolvedValue(undefined);

    scheduleSecondPassRevalidate({
      mutate: mutateMock as unknown as GlobalMutate,
      eventId: 'evt_2',
      userId: 'user_2',
      delayMs: 10,
    });

    expect(mutateMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);

    expect(mutateMock).toHaveBeenCalledWith([
      '/api/payments/viewer-status',
      'evt_2',
      'user_2',
    ]);

    const confirmedPredicate = mutateMock.mock.calls
      .map(([key]) => key)
      .find(
        (key): key is (value: unknown) => boolean =>
          typeof key === 'function' && key('/api/events/confirmed-count?ids=evt_2')
      );

    expect(confirmedPredicate).toBeTypeOf('function');
  });

  it('builds viewer-status tuple key and confirmed-count matcher correctly', () => {
    expect(buildViewerPaymentStatusKey('evt_3', 'user_3')).toEqual([
      '/api/payments/viewer-status',
      'evt_3',
      'user_3',
    ]);

    expect(isConfirmedCountKey('/api/events/confirmed-count?ids=evt_3')).toBe(true);
    expect(isConfirmedCountKey('/api/events?dateGroup=upcoming')).toBe(false);
  });
});
