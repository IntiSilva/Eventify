import {
  PaymentStatus,
  RefundRequestStatus,
  type PaymentPayoutTarget,
  type RefundRequestSource,
  type UserRole,
  type Prisma,
} from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import type {
  AdminPaymentCurrencyFilter,
  AdminPaymentListItem,
  AdminPaymentPayoutTargetFilter,
  AdminPaymentStatusFilter,
  AdminPaymentRefundState,
  AdminPaymentRefundStateFilter,
} from "@/components/Payments/payments/types/payments"

export type ListAdminPaymentsInput = {
  limit?: number
  search?: string | null
  paymentStatus?: AdminPaymentStatusFilter | null
  currency?: AdminPaymentCurrencyFilter | null
  refundState?: AdminPaymentRefundStateFilter | null
  payoutTarget?: AdminPaymentPayoutTargetFilter | null
  ownerClerkId?: string | null
}

export type ListAdminPaymentsResult = {
  data: AdminPaymentListItem[]
  hasMore: boolean
  filter: {
    search: string | null
    paymentStatus: AdminPaymentStatusFilter
    currency: string | null
    refundState: AdminPaymentRefundStateFilter
    payoutTarget: AdminPaymentPayoutTargetFilter
    limit: number
  }
  availableCurrencies: string[]
}

const DEFAULT_LIMIT = 40
const MAX_LIMIT = 120

function clampLimit(value?: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LIMIT
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value)))
}

function normalizeSearch(value?: string | null): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().slice(0, 80)
  return normalized.length > 0 ? normalized : null
}

function normalizePaymentStatus(
  value?: AdminPaymentStatusFilter | null
): AdminPaymentStatusFilter {
  switch (value) {
    case "pending":
    case "succeeded":
    case "failed":
    case "canceled":
      return value
    case "all":
    default:
      return "all"
  }
}

function normalizeCurrency(value?: AdminPaymentCurrencyFilter | null): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.toLowerCase() === "all") return null
  if (!/^[a-z]{3}$/i.test(normalized)) return null
  return normalized
}

function normalizePayoutTarget(
  value?: AdminPaymentPayoutTargetFilter | null
): AdminPaymentPayoutTargetFilter {
  switch (value) {
    case "organizer":
    case "platform":
      return value
    case "all":
    default:
      return "all"
  }
}

function normalizeOwnerClerkId(value?: string | null): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeRefundState(
  value?: AdminPaymentRefundStateFilter | null
): AdminPaymentRefundStateFilter {
  switch (value) {
    case "no_refund":
    case "requested":
    case "processing":
    case "failed":
    case "rejected":
    case "succeeded":
    case "canceled":
      return value
    case "all":
    default:
      return "all"
  }
}

function mapRefundStatusToState(
  status: RefundRequestStatus | null | undefined
): AdminPaymentRefundState {
  if (!status) return "no_refund"

  if (status === RefundRequestStatus.approved) {
    return "processing"
  }

  return status as AdminPaymentRefundState
}

function buildRefundWhere(
  refundState: AdminPaymentRefundStateFilter
): Prisma.PaymentWhereInput {
  switch (refundState) {
    case "no_refund":
      return { refundRequest: null }
    case "requested":
      return { refundRequest: { status: RefundRequestStatus.requested } }
    case "processing":
      return {
        refundRequest: {
          status: {
            in: [RefundRequestStatus.processing, RefundRequestStatus.approved],
          },
        },
      }
    case "failed":
      return { refundRequest: { status: RefundRequestStatus.failed } }
    case "rejected":
      return { refundRequest: { status: RefundRequestStatus.rejected } }
    case "succeeded":
      return { refundRequest: { status: RefundRequestStatus.succeeded } }
    case "canceled":
      return { refundRequest: { status: RefundRequestStatus.canceled } }
    case "all":
    default:
      return {}
  }
}

function buildPaymentStatusWhere(
  paymentStatus: AdminPaymentStatusFilter
): Prisma.PaymentWhereInput {
  switch (paymentStatus) {
    case "pending":
      return { status: PaymentStatus.pending }
    case "succeeded":
      return { status: PaymentStatus.succeeded }
    case "failed":
      return { status: PaymentStatus.failed }
    case "canceled":
      return { status: PaymentStatus.canceled }
    case "all":
    default:
      return {}
  }
}

function buildPayoutTargetWhere(
  payoutTarget: AdminPaymentPayoutTargetFilter
): Prisma.PaymentWhereInput {
  switch (payoutTarget) {
    case "organizer":
      return { payoutTarget: "organizer" }
    case "platform":
      return { payoutTarget: "platform" }
    case "all":
    default:
      return {}
  }
}

function buildCurrencyWhere(currency: string | null): Prisma.PaymentWhereInput {
  if (!currency) return {}
  return {
    currency: {
      equals: currency,
      mode: "insensitive",
    },
  }
}

function buildSearchWhere(search: string | null): Prisma.PaymentWhereInput {
  if (!search) return {}

  return {
    OR: [
      { id: { contains: search, mode: "insensitive" } },
      { stripePaymentIntentId: { contains: search, mode: "insensitive" } },
      { event: { title: { contains: search, mode: "insensitive" } } },
      { event: { creator: { username: { contains: search, mode: "insensitive" } } } },
      { event: { creator: { firstName: { contains: search, mode: "insensitive" } } } },
      { event: { creator: { lastName: { contains: search, mode: "insensitive" } } } },
      { user: { username: { contains: search, mode: "insensitive" } } },
      { user: { firstName: { contains: search, mode: "insensitive" } } },
      { user: { lastName: { contains: search, mode: "insensitive" } } },
      { user: { email: { contains: search, mode: "insensitive" } } },
    ],
  }
}

function toPaymentListItem(input: {
  id: string
  stripePaymentIntentId: string
  status: PaymentStatus
  createdAt: Date
  amountCents: number
  currency: string
  payoutTarget: PaymentPayoutTarget
  destinationAccountId: string | null
  transferGroup: string | null
  applicationFeeAmount: number | null
  stripeChargeId: string | null
  stripeBalanceTransactionId: string | null
  stripeTransferId: string | null
  stripeApplicationFeeId: string | null
  event: {
    id: string
    title: string
    date: Date
    createdBy: string
    creator: {
      username: string | null
      firstName: string | null
      lastName: string | null
      role: UserRole | null
    }
  }
  user: {
    clerkId: string
    username: string | null
    firstName: string | null
    lastName: string | null
    email: string | null
  }
  refundRequest: {
    id: string
    status: RefundRequestStatus
    source: RefundRequestSource
    createdAt: Date
    decisionNote: string | null
    stripeRefundId: string | null
    attemptCount: number
    lastError: string | null
    lastAttemptAt: Date | null
  } | null
}): AdminPaymentListItem {
  const refundState = mapRefundStatusToState(input.refundRequest?.status)

  return {
    paymentId: input.id,
    stripePaymentIntentId: input.stripePaymentIntentId,
    paymentStatus: input.status,
    createdAt: input.createdAt.toISOString(),
    amountCents: input.amountCents,
    currency: input.currency,
    payoutTarget: input.payoutTarget,
    destinationAccountId: input.destinationAccountId,
    transferGroup: input.transferGroup,
    applicationFeeAmount: input.applicationFeeAmount,
    stripeChargeId: input.stripeChargeId,
    stripeBalanceTransactionId: input.stripeBalanceTransactionId,
    stripeTransferId: input.stripeTransferId,
    stripeApplicationFeeId: input.stripeApplicationFeeId,
    eventId: input.event.id,
    eventTitle: input.event.title,
    eventDate: input.event.date.toISOString(),
    ownerClerkId: input.event.createdBy,
    ownerUsername: input.event.creator.username,
    ownerFirstName: input.event.creator.firstName,
    ownerLastName: input.event.creator.lastName,
    ownerRole: input.event.creator.role,
    buyerUserId: input.user.clerkId,
    buyerUsername: input.user.username,
    buyerFirstName: input.user.firstName,
    buyerLastName: input.user.lastName,
    buyerEmail: input.user.email,
    refundState,
    refundRequestId: input.refundRequest?.id ?? null,
    refundStatus: input.refundRequest?.status ?? null,
    refundSource: input.refundRequest?.source ?? null,
    refundCreatedAt: input.refundRequest?.createdAt.toISOString() ?? null,
    refundDecisionNote: input.refundRequest?.decisionNote ?? null,
    stripeRefundId: input.refundRequest?.stripeRefundId ?? null,
    refundAttemptCount: input.refundRequest?.attemptCount ?? null,
    refundLastError: input.refundRequest?.lastError ?? null,
    refundLastAttemptAt: input.refundRequest?.lastAttemptAt?.toISOString() ?? null,
  }
}

export async function listAdminPayments(
  input?: ListAdminPaymentsInput
): Promise<ListAdminPaymentsResult> {
  const limit = clampLimit(input?.limit)
  const search = normalizeSearch(input?.search)
  const paymentStatus = normalizePaymentStatus(input?.paymentStatus)
  const currency = normalizeCurrency(input?.currency)
  const refundState = normalizeRefundState(input?.refundState)
  const payoutTarget = normalizePayoutTarget(input?.payoutTarget)
  const ownerClerkId = normalizeOwnerClerkId(input?.ownerClerkId)

  const workspaceDomainWhere: Prisma.PaymentWhereInput = {
    amountCents: { gt: 0 },
    event: {
      isPaid: true,
      ...(ownerClerkId ? { createdBy: ownerClerkId } : {}),
    },
  }

  const baseAnd: Prisma.PaymentWhereInput[] = [
    buildPaymentStatusWhere(paymentStatus),
    buildPayoutTargetWhere(payoutTarget),
    buildRefundWhere(refundState),
    buildSearchWhere(search),
  ]

  const where: Prisma.PaymentWhereInput = {
    ...workspaceDomainWhere,
    AND: [...baseAnd, buildCurrencyWhere(currency)],
  }

  const rows = await prisma.payment.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      stripePaymentIntentId: true,
      status: true,
      createdAt: true,
      amountCents: true,
      currency: true,
      payoutTarget: true,
      destinationAccountId: true,
      transferGroup: true,
      applicationFeeAmount: true,
      stripeChargeId: true,
      stripeBalanceTransactionId: true,
      stripeTransferId: true,
      stripeApplicationFeeId: true,
      event: {
        select: {
          id: true,
          title: true,
          date: true,
          createdBy: true,
          creator: {
            select: {
              username: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
        },
      },
      user: {
        select: {
          clerkId: true,
          username: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      refundRequest: {
        select: {
          id: true,
          status: true,
          source: true,
          createdAt: true,
          decisionNote: true,
          stripeRefundId: true,
          attemptCount: true,
          lastError: true,
          lastAttemptAt: true,
        },
      },
    },
  })

  const hasMore = rows.length > limit
  const data = (hasMore ? rows.slice(0, limit) : rows).map(toPaymentListItem)

  const availableCurrencyRows = await prisma.payment.findMany({
    where: workspaceDomainWhere,
    select: { currency: true },
    distinct: ["currency"],
  })
  const availableCurrencies = availableCurrencyRows
    .map((row) => row.currency)
    .sort((a, b) => a.localeCompare(b))

  return {
    data,
    hasMore,
    availableCurrencies,
    filter: {
      search,
      paymentStatus,
      currency,
      refundState,
      payoutTarget,
      limit,
    },
  }
}
