import {
  RefundRequestStatus,
  RSVPAttendanceEntitlementStatus,
} from '@/generated/prisma';

export function evaluateIsFullRefund(input: {
  refundAmountCents: number | null | undefined;
  paymentAmountCents: number | null | undefined;
}): boolean | null {
  if (
    typeof input.refundAmountCents !== 'number' ||
    typeof input.paymentAmountCents !== 'number'
  ) {
    return null;
  }

  if (input.refundAmountCents < 0 || input.paymentAmountCents < 0) {
    return null;
  }

  return input.refundAmountCents >= input.paymentAmountCents;
}

export function mapRefundStatusToAttendanceEntitlement(input: {
  refundStatus: RefundRequestStatus;
  isFullRefund?: boolean | null;
}): RSVPAttendanceEntitlementStatus {
  switch (input.refundStatus) {
    case RefundRequestStatus.requested:
    case RefundRequestStatus.approved:
    case RefundRequestStatus.processing:
      return RSVPAttendanceEntitlementStatus.refund_pending_hold;
    case RefundRequestStatus.succeeded:
      return input.isFullRefund === true
        ? RSVPAttendanceEntitlementStatus.revoked_refunded
        : RSVPAttendanceEntitlementStatus.active;
    case RefundRequestStatus.failed:
    case RefundRequestStatus.rejected:
    case RefundRequestStatus.canceled:
      return RSVPAttendanceEntitlementStatus.active;
    default:
      return RSVPAttendanceEntitlementStatus.active;
  }
}
