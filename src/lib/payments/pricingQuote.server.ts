import 'server-only';

import { getPlatformFeeBps, getPlatformFeeCents } from '@/lib/payments/platformFee.server';

const DEFAULT_STRIPE_ESTIMATED_FEE_BPS = 290;
const DEFAULT_STRIPE_ESTIMATED_FIXED_FEE_CENTS = 30;

export type EventPricingQuote = {
  previewMode: PricingPreviewMode;
  currency: string;
  exact: {
    ticketAmountCents: number;
    platformFeeAmountCents: number;
  };
  estimated: {
    stripeFeeAmountCents: number;
    finalNetAmountCents: number;
    organizerNetAmountCents: number;
  };
};

export type PricingPreviewMode = 'organizer' | 'admin';

function normalizeNonNegativeInt(value: string | undefined | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeAmountCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function getEstimatedStripeFeeBps(): number {
  const configured = normalizeNonNegativeInt(process.env.STRIPE_ESTIMATED_FEE_BPS);
  const resolved = configured ?? DEFAULT_STRIPE_ESTIMATED_FEE_BPS;
  return Math.min(resolved, 10_000);
}

function getEstimatedStripeFixedFeeCents(): number {
  const configured = normalizeNonNegativeInt(process.env.STRIPE_ESTIMATED_FIXED_FEE_CENTS);
  return configured ?? DEFAULT_STRIPE_ESTIMATED_FIXED_FEE_CENTS;
}

export function computePlatformApplicationFeeAmountCents(totalAmountCents: number): number | null {
  const normalizedAmount = normalizeAmountCents(totalAmountCents);
  if (normalizedAmount <= 0) return null;

  const fixedFee = getPlatformFeeCents();
  if (fixedFee > 0) {
    return Math.min(fixedFee, normalizedAmount);
  }

  const feeBps = getPlatformFeeBps();
  if (feeBps > 0) {
    const normalizedBps = Math.min(feeBps, 10_000);
    const bpsFee = Math.floor((normalizedAmount * normalizedBps) / 10_000);
    return bpsFee > 0 ? Math.min(bpsFee, normalizedAmount) : null;
  }

  return null;
}

export function computeEstimatedStripeProcessingFeeAmountCents(totalAmountCents: number): number {
  const normalizedAmount = normalizeAmountCents(totalAmountCents);
  if (normalizedAmount <= 0) return 0;

  const percentageFee = Math.floor((normalizedAmount * getEstimatedStripeFeeBps()) / 10_000);
  const estimated = percentageFee + getEstimatedStripeFixedFeeCents();
  return Math.min(estimated, normalizedAmount);
}

export function buildEventPricingQuote(input: {
  ticketAmountCents: number;
  currency: string;
  previewMode: PricingPreviewMode;
}): EventPricingQuote {
  const ticketAmountCents = normalizeAmountCents(input.ticketAmountCents);
  const platformFeeAmountCents = input.previewMode === 'organizer'
    ? (computePlatformApplicationFeeAmountCents(ticketAmountCents) ?? 0)
    : 0;
  const stripeFeeAmountCents =
    computeEstimatedStripeProcessingFeeAmountCents(ticketAmountCents);
  const finalNetAmountCents = Math.max(
    0,
    ticketAmountCents - platformFeeAmountCents - stripeFeeAmountCents
  );

  return {
    previewMode: input.previewMode,
    currency: input.currency.toUpperCase(),
    exact: {
      ticketAmountCents,
      platformFeeAmountCents,
    },
    estimated: {
      stripeFeeAmountCents,
      finalNetAmountCents,
      // Backward-compatible naming for organizer UI call sites.
      organizerNetAmountCents: finalNetAmountCents,
    },
  };
}

export function buildOrganizerPricingQuote(input: {
  ticketAmountCents: number;
  currency: string;
}): EventPricingQuote {
  return buildEventPricingQuote({
    ticketAmountCents: input.ticketAmountCents,
    currency: input.currency,
    previewMode: 'organizer',
  });
}
