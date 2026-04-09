export type AdminPaymentStatusFilter =
  | "all"
  | "pending"
  | "succeeded"
  | "failed"
  | "canceled"

export type AdminPaymentStatus = Exclude<AdminPaymentStatusFilter, "all">

export type AdminPaymentRefundStateFilter =
  | "all"
  | "no_refund"
  | "requested"
  | "processing"
  | "failed"
  | "rejected"
  | "succeeded"
  | "canceled"

export type AdminPaymentRefundState = Exclude<AdminPaymentRefundStateFilter, "all">

export type AdminPaymentCurrencyFilter = "all" | string

export type AdminPaymentPayoutTargetFilter = "all" | "organizer" | "platform"

export type AdminPaymentListItem = {
  paymentId: string
  stripePaymentIntentId: string
  paymentStatus: AdminPaymentStatus
  createdAt: string
  amountCents: number
  currency: string
  payoutTarget: "platform" | "organizer"
  destinationAccountId: string | null
  transferGroup: string | null
  applicationFeeAmount: number | null
  stripeChargeId: string | null
  stripeBalanceTransactionId: string | null
  stripeTransferId: string | null
  stripeApplicationFeeId: string | null
  eventId: string
  eventTitle: string
  eventDate: string
  ownerClerkId: string
  ownerUsername: string | null
  ownerFirstName: string | null
  ownerLastName: string | null
  ownerRole: "admin" | "organizer" | "user" | null
  buyerUserId: string
  buyerUsername: string | null
  buyerFirstName: string | null
  buyerLastName: string | null
  buyerEmail: string | null
  refundState: AdminPaymentRefundState
  refundRequestId: string | null
  refundStatus:
    | "requested"
    | "approved"
    | "rejected"
    | "processing"
    | "succeeded"
    | "failed"
    | "canceled"
    | null
  refundSource: "USER_REQUEST" | "MANUAL_OVERRIDE" | "SYSTEM_COMPENSATION" | null
  refundCreatedAt: string | null
  refundDecisionNote: string | null
  stripeRefundId: string | null
  refundAttemptCount: number | null
  refundLastError: string | null
  refundLastAttemptAt: string | null
}

export type AdminPaymentListFilter = {
  search: string | null
  paymentStatus: AdminPaymentStatusFilter
  currency: string | null
  refundState: AdminPaymentRefundStateFilter
  payoutTarget: AdminPaymentPayoutTargetFilter
  limit: number
}

export type AdminPaymentsListApiSuccess = {
  success: true
  data: AdminPaymentListItem[]
  hasMore: boolean
  availableCurrencies: string[]
  filter: AdminPaymentListFilter
}

export type AdminPaymentsListApiError = {
  success: false
  error: string
}

export type AdminPaymentsListApiResponse =
  | AdminPaymentsListApiSuccess
  | AdminPaymentsListApiError
