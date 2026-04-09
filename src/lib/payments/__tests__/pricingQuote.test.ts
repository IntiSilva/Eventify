import { afterEach, describe, expect, it } from 'vitest';
import {
  buildEventPricingQuote,
  buildOrganizerPricingQuote,
} from '@/lib/payments/pricingQuote.server';

const ORIGINAL_PLATFORM_FEE_BPS = process.env.PLATFORM_FEE_BPS;
const ORIGINAL_PLATFORM_FEE_CENTS = process.env.PLATFORM_FEE_CENTS;
const ORIGINAL_STRIPE_ESTIMATED_FEE_BPS = process.env.STRIPE_ESTIMATED_FEE_BPS;
const ORIGINAL_STRIPE_ESTIMATED_FIXED_FEE_CENTS =
  process.env.STRIPE_ESTIMATED_FIXED_FEE_CENTS;

afterEach(() => {
  process.env.PLATFORM_FEE_BPS = ORIGINAL_PLATFORM_FEE_BPS;
  process.env.PLATFORM_FEE_CENTS = ORIGINAL_PLATFORM_FEE_CENTS;
  process.env.STRIPE_ESTIMATED_FEE_BPS = ORIGINAL_STRIPE_ESTIMATED_FEE_BPS;
  process.env.STRIPE_ESTIMATED_FIXED_FEE_CENTS =
    ORIGINAL_STRIPE_ESTIMATED_FIXED_FEE_CENTS;
});

describe('pricing quote builder', () => {
  it('applies platform fee in organizer mode', () => {
    process.env.PLATFORM_FEE_BPS = '1000';
    delete process.env.PLATFORM_FEE_CENTS;
    process.env.STRIPE_ESTIMATED_FEE_BPS = '290';
    process.env.STRIPE_ESTIMATED_FIXED_FEE_CENTS = '30';

    const quote = buildEventPricingQuote({
      ticketAmountCents: 10_000,
      currency: 'usd',
      previewMode: 'organizer',
    });

    expect(quote.previewMode).toBe('organizer');
    expect(quote.exact.ticketAmountCents).toBe(10_000);
    expect(quote.exact.platformFeeAmountCents).toBe(1_000);
    expect(quote.estimated.stripeFeeAmountCents).toBe(320);
    expect(quote.estimated.finalNetAmountCents).toBe(8_680);
    expect(quote.estimated.organizerNetAmountCents).toBe(8_680);
  });

  it('does not apply platform fee in admin mode', () => {
    process.env.PLATFORM_FEE_BPS = '1000';
    delete process.env.PLATFORM_FEE_CENTS;
    process.env.STRIPE_ESTIMATED_FEE_BPS = '290';
    process.env.STRIPE_ESTIMATED_FIXED_FEE_CENTS = '30';

    const quote = buildEventPricingQuote({
      ticketAmountCents: 10_000,
      currency: 'usd',
      previewMode: 'admin',
    });

    expect(quote.previewMode).toBe('admin');
    expect(quote.exact.ticketAmountCents).toBe(10_000);
    expect(quote.exact.platformFeeAmountCents).toBe(0);
    expect(quote.estimated.stripeFeeAmountCents).toBe(320);
    expect(quote.estimated.finalNetAmountCents).toBe(9_680);
    expect(quote.estimated.organizerNetAmountCents).toBe(9_680);
  });

  it('keeps organizer helper behavior', () => {
    process.env.PLATFORM_FEE_BPS = '1000';
    delete process.env.PLATFORM_FEE_CENTS;

    const quote = buildOrganizerPricingQuote({
      ticketAmountCents: 1_000,
      currency: 'usd',
    });

    expect(quote.previewMode).toBe('organizer');
    expect(quote.exact.platformFeeAmountCents).toBe(100);
  });
});

