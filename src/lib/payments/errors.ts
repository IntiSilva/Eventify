import 'server-only';

import type { PaymentErrorCode } from '@/types/payments/stripe';

/**
 * Base class for all payment-related errors.
 * Uses discriminated union pattern with `code` property.
 */
export abstract class PaymentError extends Error {
  abstract readonly code: PaymentErrorCode;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, PaymentError.prototype);
  }
}

/**
 * Event not found or not accessible.
 */
export class NotFoundError extends PaymentError {
  readonly code = 'NOT_FOUND' as const;

  constructor(message = 'Event not found') {
    super(message);
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Event exists but is not marked as payable (not paid, missing price, or currency).
 */
export class NotPayableError extends PaymentError {
  readonly code = 'NOT_PAYABLE' as const;

  constructor(message = 'Event is not payable') {
    super(message);
    Object.setPrototypeOf(this, NotPayableError.prototype);
  }
}

/**
 * Payment intent already succeeded or payment already confirmed for this user+event.
 */
export class AlreadyPaidError extends PaymentError {
  readonly code = 'ALREADY_PAID' as const;

  constructor(message = 'Payment has already been completed for this event') {
    super(message);
    Object.setPrototypeOf(this, AlreadyPaidError.prototype);
  }
}

/**
 * Stripe configuration is missing or invalid (e.g., publishable key not in env).
 */
export class StripeConfigError extends PaymentError {
  readonly code = 'STRIPE_CONFIG' as const;

  constructor(message = 'Stripe is not properly configured') {
    super(message);
    Object.setPrototypeOf(this, StripeConfigError.prototype);
  }
}

/**
 * Stripe API call failed (network error, API error, etc.).
 */
export class StripeApiError extends PaymentError {
  readonly code = 'STRIPE_API' as const;
  readonly raw?: unknown;

  constructor(message: string, raw?: unknown) {
    super(message);
    this.raw = raw;
    Object.setPrototypeOf(this, StripeApiError.prototype);
  }
}

/**
 * Discriminated union of all payment error types.
 */
export type DomainError =
  | NotFoundError
  | NotPayableError
  | AlreadyPaidError
  | StripeConfigError
  | StripeApiError;

/**
 * Type guard to determine if an error is a PaymentError.
 * Useful for catch blocks with `unknown` error types.
 */
export function isPaymentError(error: unknown): error is PaymentError {
  return error instanceof PaymentError;
}

/**
 * Map a PaymentError to an HTTP status code.
 * Uses discriminant pattern (error.code) for exhaustive switching.
 *
 * @param error PaymentError or other error type
 * @returns HTTP status code
 */
export function mapPaymentErrorToStatusCode(error: PaymentError): number {
  switch (error.code) {
    case 'NOT_FOUND':
      return 404; // Not Found
    case 'NOT_PAYABLE':
      return 400; // Bad Request
    case 'ALREADY_PAID':
      return 409; // Conflict
    case 'STRIPE_CONFIG':
      return 500; // Internal Server Error
    case 'STRIPE_API':
      return 502; // Bad Gateway
  }
}
