import type { CheckoutEventForClient } from '@/types/event';
import type { RSVPStatus } from '@/generated/prisma';

/**
 * Payment error codes for discriminated union pattern.
 * Server-only error classes in src/lib/payments/errors.ts use these codes.
 */
export type PaymentErrorCode =
  | 'NOT_FOUND'
  | 'NOT_PAYABLE'
  | 'EVENT_NOT_JOINABLE'
  | 'ALREADY_PAID'
  | 'CONNECT_NOT_READY'
  | 'STRIPE_CONFIG'
  | 'STRIPE_API';

/**
 * Result of successful payment intent creation or reuse.
 * Returned by createOrReusePaymentIntentForEvent from intent.ts.
 */
export type CreateOrReusePaymentIntentResult = {
  clientSecret: string;
  paymentIntentId: string;
  publishableKey: string;
  event: CheckoutEventForClient;
};

export type TicketState =
  | 'PAYMENT_IN_PROGRESS'
  | 'ALREADY_PAID_ATTENDING'
  | 'ALREADY_PAID_NOT_ATTENDING';

export type ViewerTicketState =
  | 'none'
  | 'paid'
  | 'refund_pending'
  | 'refunded';

export type TicketStateResult =
  | ({ state: 'PAYMENT_IN_PROGRESS' } & CreateOrReusePaymentIntentResult)
  | ({ state: 'ALREADY_PAID_ATTENDING' | 'ALREADY_PAID_NOT_ATTENDING' } & {
      event: CheckoutEventForClient;
      // Optional RSVP payload when available
      rsvp?: {
        status: RSVPStatus;
        user: { clerkId: string; username?: string | null };
      };
      // Optional existing payment id
      paymentIntentId?: string;
    });
