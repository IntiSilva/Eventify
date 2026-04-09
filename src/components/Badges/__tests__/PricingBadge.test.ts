import { describe, expect, it } from 'vitest';
import { resolvePricingBadgeState } from '@/components/Badges/PricingBadge';

const NOW = new Date('2026-03-31T20:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

describe('resolvePricingBadgeState', () => {
  it('returns in_progress during the first 8 hours after start and overrides paid/free', () => {
    const paidState = resolvePricingBadgeState({
      isPaid: true,
      eventStart: new Date(NOW.getTime() - HOUR_MS),
      now: NOW,
    });
    const freeState = resolvePricingBadgeState({
      isPaid: false,
      eventStart: new Date(NOW.getTime() - HOUR_MS),
      now: NOW,
    });

    expect(paidState).toBe('in_progress');
    expect(freeState).toBe('in_progress');
  });

  it('returns ended after 8 hours and overrides paid/free', () => {
    const paidState = resolvePricingBadgeState({
      isPaid: true,
      eventStart: new Date(NOW.getTime() - (8 * HOUR_MS + 1)),
      now: NOW,
    });
    const freeState = resolvePricingBadgeState({
      isPaid: false,
      eventStart: new Date(NOW.getTime() - (8 * HOUR_MS + 1)),
      now: NOW,
    });

    expect(paidState).toBe('ended');
    expect(freeState).toBe('ended');
  });

  it('does not return ended during the first 8 hours after start', () => {
    const exactlyEightHours = resolvePricingBadgeState({
      isPaid: true,
      eventStart: new Date(NOW.getTime() - 8 * HOUR_MS),
      now: NOW,
    });

    expect(exactlyEightHours).toBe('in_progress');
  });

  it('keeps normal paid/free states before the event starts', () => {
    const paidState = resolvePricingBadgeState({
      isPaid: true,
      eventStart: new Date(NOW.getTime() + HOUR_MS),
      now: NOW,
    });
    const freeState = resolvePricingBadgeState({
      isPaid: false,
      eventStart: new Date(NOW.getTime() + HOUR_MS),
      now: NOW,
    });

    expect(paidState).toBe('paid');
    expect(freeState).toBe('free');
  });
});

