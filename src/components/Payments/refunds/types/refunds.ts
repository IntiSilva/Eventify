import type {
  PaymentPayoutTarget,
  RefundRequestSource,
  RefundRequestStatus,
  UserRole,
} from '@/generated/prisma'

export type RefundRequestListFilterStatus =
  | 'requested'
  | 'processing'
  | 'failed'
  | 'rejected'
  | 'succeeded'

export type RefundRequestListFilterSource =
  | 'all'
  | 'user_request'
  | 'manual_override'
  | 'system_compensation'

export type RefundRequestListFilterPayoutTarget =
  | 'all'
  | 'organizer'
  | 'platform'

export type RefundViewerCounts = {
  all: number
  requested: number
  processing: number
  failed: number
  rejected: number
  succeeded: number
  canceled: number
  needsAttention: number
}

export const EMPTY_REFUND_VIEWER_COUNTS: RefundViewerCounts = {
  all: 0,
  requested: 0,
  processing: 0,
  failed: 0,
  rejected: 0,
  succeeded: 0,
  canceled: 0,
  needsAttention: 0,
}

export type RefundRequestListItem = {
  refundRequestId: string
  status: RefundRequestStatus
  source: RefundRequestSource
  reason: string | null
  decisionNote: string | null
  createdAt: string
  paymentId: string
  eventId: string
  eventTitle: string
  organizerClerkId: string
  organizerUsername: string | null
  organizerFirstName: string | null
  organizerLastName: string | null
  counterpartyRole: UserRole | null
  buyerUserId: string
  buyerUsername: string | null
  buyerFirstName: string | null
  buyerLastName: string | null
  buyerEmail: string | null
  amountCents: number
  currency: string
  payoutTarget: PaymentPayoutTarget
  destinationAccountId: string | null
  transferGroup: string | null
  applicationFeeAmount: number | null
  stripeRefundId: string | null
  attemptCount: number
  lastError: string | null
  lastAttemptAt: string | null
}
